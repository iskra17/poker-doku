import { MAX_ARENA_TIMER_DELAY_MS } from './arena-scheduler';
import type { ArenaQueueState } from '../lib/realtime/protocol';

const RANGE_STEP_MS = 10_000;
const FALLBACK_MS = 60_000;
const TRAINING_OFFER_MS = 30_000;
const MAX_SEATS = 6;

export interface ArenaQueueEntry {
  readonly profileId: string;
  readonly socketId: string;
  readonly mmr: number;
  readonly joinedAt: number;
}

export interface ArenaOfficialCandidate {
  readonly candidateId: string;
  readonly entries: readonly ArenaQueueEntry[];
  readonly botCount: number;
}

export interface ArenaReservation {
  readonly matchId: string;
}

export interface ArenaTrainingOffer {
  readonly offerId: string;
  readonly expiresAt: number;
}

interface StoredOffer extends ArenaTrainingOffer {
  readonly profileId: string;
  readonly socketId: string;
}

interface CandidateState {
  readonly candidate: ArenaOfficialCandidate;
  readonly connected: Set<string>;
}

export interface ArenaMatchmakerOptions {
  readonly now?: () => number;
  readonly reserveOfficial: (
    candidate: ArenaOfficialCandidate,
    isCandidateValid: () => boolean,
  ) => Promise<ArenaReservation | null>;
  readonly createOfficialRoom: (
    reservation: ArenaReservation,
    candidate: ArenaOfficialCandidate,
  ) => Promise<boolean>;
  readonly voidOfficial: (matchId: string) => Promise<void>;
  readonly createTrainingRoom: (
    profileId: string,
    socketId: string,
  ) => Promise<ArenaReservation | null>;
  readonly onQueueState?: (socketId: string, state: ArenaQueueState) => void;
  readonly onTrainingOffered?: (
    socketId: string,
    offer: ArenaTrainingOffer,
  ) => void;
  readonly onMatchFound?: (socketId: string, matchId: string) => void;
  readonly setTimer?: (
    callback: () => void,
    delay: number,
  ) => ReturnType<typeof setTimeout>;
  readonly clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

export interface ArenaMatchmakerEventHandlers {
  readonly onQueueState?: (socketId: string, state: ArenaQueueState) => void;
  readonly onTrainingOffered?: (
    socketId: string,
    offer: ArenaTrainingOffer,
  ) => void;
  readonly onMatchFound?: (socketId: string, matchId: string) => void;
}

export function arenaMmrRangeForWait(waitMs: number): number | null {
  if (!Number.isFinite(waitMs) || waitMs < 0) {
    throw new Error('ARENA_QUEUE_TIME_INVALID');
  }
  if (waitMs >= FALLBACK_MS) return null;
  return 100 + 50 * Math.floor(waitMs / RANGE_STEP_MS);
}

export function areArenaEntriesCompatible(
  left: ArenaQueueEntry,
  right: ArenaQueueEntry,
  at: number,
): boolean {
  assertEntry(left);
  assertEntry(right);
  const leftRange = arenaMmrRangeForWait(at - left.joinedAt);
  const rightRange = arenaMmrRangeForWait(at - right.joinedAt);
  if (leftRange === null || rightRange === null) return true;
  const difference = Math.abs(left.mmr - right.mmr);
  return difference <= leftRange && difference <= rightRange;
}

export class ArenaMatchmaker {
  readonly #options: ArenaMatchmakerOptions;
  readonly #now: () => number;
  readonly #queue = new Map<string, ArenaQueueEntry>();
  readonly #offers = new Map<string, StoredOffer>();
  readonly #candidates = new Map<string, CandidateState>();
  #counter = 0;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #started = false;
  #closed = false;
  #processing = false;
  #events: ArenaMatchmakerEventHandlers;

  constructor(options: ArenaMatchmakerOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#events = options;
  }

  setEventHandlers(handlers: ArenaMatchmakerEventHandlers): void {
    this.#events = handlers;
  }

  start(): void {
    if (this.#closed || this.#started) return;
    this.#started = true;
    this.#schedule();
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    if (this.#timer) (this.#options.clearTimer ?? clearTimeout)(this.#timer);
    this.#timer = undefined;
    this.#queue.clear();
    this.#offers.clear();
    this.#candidates.clear();
  }

  join(entry: ArenaQueueEntry): ArenaQueueState {
    assertEntry(entry);
    if (this.#closed || this.hasBlockingParticipation(entry.profileId)) {
      throw new Error('ARENA_QUEUE_BUSY');
    }
    if ([...this.#queue.values()].some(item => item.socketId === entry.socketId)) {
      throw new Error('ARENA_QUEUE_BUSY');
    }
    const stored = Object.freeze({ ...entry });
    this.#queue.set(entry.profileId, stored);
    const state = { status: 'queued', joinedAt: entry.joinedAt } as const;
    this.#events.onQueueState?.(entry.socketId, state);
    this.#schedule(this.#queue.size >= 2);
    return state;
  }

  leave(profileId: string, socketId: string): boolean {
    const queued = this.#queue.get(profileId);
    if (queued?.socketId === socketId) {
      this.#queue.delete(profileId);
    } else {
      const offer = this.#offers.get(profileId);
      if (!offer || offer.socketId !== socketId) return false;
      this.#offers.delete(profileId);
    }
    this.#events.onQueueState?.(socketId, { status: 'idle' });
    this.#schedule();
    return true;
  }

  disconnect(socketId: string): void {
    for (const [profileId, entry] of this.#queue) {
      if (entry.socketId === socketId) this.#queue.delete(profileId);
    }
    for (const [profileId, offer] of this.#offers) {
      if (offer.socketId === socketId) this.#offers.delete(profileId);
    }
    for (const state of this.#candidates.values()) {
      for (const entry of state.candidate.entries) {
        if (entry.socketId === socketId) state.connected.delete(entry.profileId);
      }
    }
    this.#schedule();
  }

  hasBlockingParticipation(profileId: string): boolean {
    return this.#queue.has(profileId)
      || this.#offers.has(profileId)
      || [...this.#candidates.values()].some(state =>
        state.candidate.entries.some(entry => entry.profileId === profileId));
  }

  getPublicState(profileId: string): ArenaQueueState {
    const queued = this.#queue.get(profileId);
    if (queued) return { status: 'queued', joinedAt: queued.joinedAt };
    if (this.#offers.has(profileId)) return { status: 'training-offered' };
    if ([...this.#candidates.values()].some(state =>
      state.candidate.entries.some(entry => entry.profileId === profileId))) {
      return { status: 'forming' };
    }
    return { status: 'idle' };
  }

  inspectQueue(): ArenaQueueEntry[] {
    return this.#rankedQueue().map(entry => ({ ...entry }));
  }

  async tick(at = this.#now()): Promise<void> {
    if (this.#closed || this.#processing) return;
    this.#processing = true;
    try {
      for (const [profileId, offer] of this.#offers) {
        if (offer.expiresAt <= at) {
          this.#offers.delete(profileId);
          this.#events.onQueueState?.(offer.socketId, { status: 'idle' });
        }
      }
      const ranked = this.#rankedQueue();
      const anchor = ranked[0];
      if (!anchor) return;
      const selected = ranked
        .filter(entry => (
          entry.profileId === anchor.profileId
          || areArenaEntriesCompatible(anchor, entry, at)
        ))
        .slice(0, MAX_SEATS);
      if (selected.length >= 2) {
        await this.#formOfficial(selected);
        return;
      }
      if (at - anchor.joinedAt < FALLBACK_MS) return;
      if (selected.length === 1) {
        this.#queue.delete(anchor.profileId);
        const offer = {
          profileId: anchor.profileId,
          socketId: anchor.socketId,
          offerId: `training-${++this.#counter}`,
          expiresAt: at + TRAINING_OFFER_MS,
        };
        this.#offers.set(anchor.profileId, offer);
        this.#events.onQueueState?.(anchor.socketId, {
          status: 'training-offered',
        });
        this.#events.onTrainingOffered?.(anchor.socketId, {
          offerId: offer.offerId,
          expiresAt: offer.expiresAt,
        });
        return;
      }
    } finally {
      this.#processing = false;
      this.#schedule();
    }
  }

  async acceptTraining(
    profileId: string,
    socketId: string,
    offerId: string,
    at = this.#now(),
  ): Promise<ArenaReservation | null> {
    const offer = this.#offers.get(profileId);
    if (
      !offer
      || offer.socketId !== socketId
      || offer.offerId !== offerId
      || at >= offer.expiresAt
    ) return null;
    this.#offers.delete(profileId);
    const result = await this.#options.createTrainingRoom(profileId, socketId);
    if (result) this.#events.onMatchFound?.(socketId, result.matchId);
    else this.#events.onQueueState?.(socketId, { status: 'idle' });
    this.#schedule();
    return result;
  }

  async #formOfficial(entries: readonly ArenaQueueEntry[]): Promise<void> {
    for (const entry of entries) this.#queue.delete(entry.profileId);
    const candidate: ArenaOfficialCandidate = {
      candidateId: `candidate-${++this.#counter}`,
      entries: entries.map(entry => Object.freeze({ ...entry })),
      botCount: MAX_SEATS - entries.length,
    };
    const state: CandidateState = {
      candidate,
      connected: new Set(entries.map(entry => entry.profileId)),
    };
    this.#candidates.set(candidate.candidateId, state);
    for (const entry of entries) {
      this.#events.onQueueState?.(entry.socketId, { status: 'forming' });
    }
    const isValid = (): boolean => (
      !this.#closed && state.connected.size === entries.length
    );

    let reservation: ArenaReservation | null = null;
    try {
      reservation = await this.#options.reserveOfficial(candidate, isValid);
    } catch {
      this.#restoreCandidate(state, false);
      return;
    }
    if (!reservation) {
      this.#restoreCandidate(state, false);
      return;
    }
    if (!isValid()) {
      await this.#options.voidOfficial(reservation.matchId);
      this.#restoreCandidate(state, true);
      return;
    }
    let created = false;
    try {
      created = await this.#options.createOfficialRoom(reservation, candidate);
    } catch {
      created = false;
    }
    if (!created) {
      await this.#options.voidOfficial(reservation.matchId);
      this.#restoreCandidate(state, true);
      return;
    }
    this.#candidates.delete(candidate.candidateId);
    for (const entry of entries) {
      if (!state.connected.has(entry.profileId)) continue;
      this.#events.onMatchFound?.(entry.socketId, reservation.matchId);
    }
  }

  #restoreCandidate(state: CandidateState, resetJoinedAt: boolean): void {
    this.#candidates.delete(state.candidate.candidateId);
    const joinedAt = this.#now();
    for (const entry of state.candidate.entries) {
      if (!state.connected.has(entry.profileId)) continue;
      const restored = Object.freeze({
        ...entry,
        joinedAt: resetJoinedAt ? joinedAt : entry.joinedAt,
      });
      this.#queue.set(entry.profileId, restored);
      this.#events.onQueueState?.(entry.socketId, {
        status: 'queued',
        joinedAt: restored.joinedAt,
      });
    }
  }

  #rankedQueue(): ArenaQueueEntry[] {
    return [...this.#queue.values()].sort((left, right) =>
      left.joinedAt - right.joinedAt || binaryCompare(left.profileId, right.profileId));
  }

  #schedule(immediate = false): void {
    if (!this.#started || this.#closed || this.#processing) return;
    if (this.#timer) (this.#options.clearTimer ?? clearTimeout)(this.#timer);
    this.#timer = undefined;
    const now = this.#now();
    const queued = [...this.#queue.values()];
    const queueDue = queued.length <= 1
      ? queued.map(entry => entry.joinedAt + FALLBACK_MS)
      : queued.map(entry => {
        const waitMs = now - entry.joinedAt;
        if (waitMs < 0) return entry.joinedAt;
        if (waitMs >= FALLBACK_MS) return now + 1;
        const nextRangeStep = entry.joinedAt
          + (Math.floor(waitMs / RANGE_STEP_MS) + 1) * RANGE_STEP_MS;
        return Math.min(entry.joinedAt + FALLBACK_MS, nextRangeStep);
      });
    const due = [
      ...(immediate && queued.length >= 2 ? [now + 1] : queueDue),
      ...[...this.#offers.values()].map(offer => offer.expiresAt),
    ].sort((a, b) => a - b)[0];
    if (due === undefined) return;
    const delay = Math.min(
      MAX_ARENA_TIMER_DELAY_MS,
      Math.max(1, due - now),
    );
    const setTimer = this.#options.setTimer ?? setTimeout;
    this.#timer = setTimer(() => {
      this.#timer = undefined;
      void this.tick().catch(() => {
        this.#schedule();
      });
    }, delay);
  }
}

function assertEntry(entry: ArenaQueueEntry): void {
  if (
    !entry
    || typeof entry.profileId !== 'string'
    || entry.profileId.length === 0
    || typeof entry.socketId !== 'string'
    || entry.socketId.length === 0
    || !Number.isSafeInteger(entry.mmr)
    || !Number.isSafeInteger(entry.joinedAt)
    || entry.joinedAt < 0
  ) throw new Error('ARENA_QUEUE_ENTRY_INVALID');
}

function binaryCompare(left: string, right: string): number {
  if (left === right) return 0;
  return left < right ? -1 : 1;
}
