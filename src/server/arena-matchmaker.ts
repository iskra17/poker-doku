import { MAX_ARENA_TIMER_DELAY_MS } from './arena-scheduler';
import type { ArenaQueueState } from '../lib/realtime/protocol';

const RANGE_STEP_MS = 10_000;
const FALLBACK_MS = 60_000;
const TRAINING_OFFER_MS = 30_000;
const MAX_SEATS = 6;
const CLEANUP_RETRY_BASE_MS = 100;
const CLEANUP_RETRY_MAX_MS = 5_000;

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
  phase: 'offered' | 'creating' | 'cleanup';
  connected: boolean;
  rollbackDone: boolean;
  cleanupAttempts: number;
  retryAt?: number;
  result?: ArenaReservation | null;
  operation?: Promise<void>;
  completion: Promise<ArenaReservation | null>;
  resolveCompletion: (result: ArenaReservation | null) => void;
}

interface CandidateState {
  readonly candidate: ArenaOfficialCandidate;
  readonly connected: Set<string>;
  phase: 'reserving' | 'creating' | 'cleanup';
  reservation?: ArenaReservation;
  rollbackRequired: boolean;
  rollbackDone: boolean;
  voidDone: boolean;
  cleanupAttempts: number;
  retryAt?: number;
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
  /** Dispose only the created room; reservation void/refund remains matchmaker-owned. */
  readonly rollbackOfficialRoom: (
    reservation: ArenaReservation,
    candidate: ArenaOfficialCandidate,
  ) => Promise<void>;
  readonly voidOfficial: (matchId: string) => Promise<void>;
  readonly createTrainingRoom: (
    profileId: string,
    socketId: string,
  ) => Promise<ArenaReservation | null>;
  readonly rollbackTrainingRoom: (
    profileId: string,
    socketId: string,
    offerId: string,
    result: ArenaReservation | null,
  ) => Promise<void>;
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
  #processingOperation: Promise<void> | undefined;
  #closePromise: Promise<void> | undefined;
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

  close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#closed = true;
    if (this.#timer) (this.#options.clearTimer ?? clearTimeout)(this.#timer);
    this.#timer = undefined;
    this.#queue.clear();
    for (const [profileId, offer] of this.#offers) {
      offer.connected = false;
      if (offer.phase === 'offered') this.#offers.delete(profileId);
    }
    for (const state of this.#candidates.values()) state.connected.clear();
    this.#closePromise = this.#drainClose();
    return this.#closePromise;
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
      if (
        !offer
        || offer.socketId !== socketId
        || offer.phase !== 'offered'
      ) return false;
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
      if (offer.socketId !== socketId) continue;
      offer.connected = false;
      if (offer.phase === 'offered') this.#offers.delete(profileId);
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

  tick(at = this.#now()): Promise<void> {
    if (this.#closed || this.#processing) return Promise.resolve();
    this.#processing = true;
    const operation = this.#runTick(at);
    this.#processingOperation = operation;
    void operation.then(
      () => {
        if (this.#processingOperation === operation) {
          this.#processingOperation = undefined;
        }
      },
      () => {
        if (this.#processingOperation === operation) {
          this.#processingOperation = undefined;
        }
      },
    );
    return operation;
  }

  async #runTick(at: number): Promise<void> {
    try {
      let cleanupAttempted = false;
      for (const state of this.#candidates.values()) {
        if (state.phase === 'cleanup' && (state.retryAt ?? 0) <= at) {
          cleanupAttempted = true;
          await this.#attemptOfficialCleanup(state);
        }
      }
      for (const offer of this.#offers.values()) {
        if (offer.phase === 'cleanup' && (offer.retryAt ?? 0) <= at) {
          cleanupAttempted = true;
          await this.#attemptTrainingCleanup(offer);
        }
      }
      if (cleanupAttempted) return;
      for (const [profileId, offer] of this.#offers) {
        if (offer.phase === 'offered' && offer.expiresAt <= at) {
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
        let resolveCompletion!: (result: ArenaReservation | null) => void;
        const completion = new Promise<ArenaReservation | null>(resolve => {
          resolveCompletion = resolve;
        });
        const offer = {
          profileId: anchor.profileId,
          socketId: anchor.socketId,
          offerId: `training-${++this.#counter}`,
          expiresAt: at + TRAINING_OFFER_MS,
          phase: 'offered',
          connected: true,
          rollbackDone: false,
          cleanupAttempts: 0,
          completion,
          resolveCompletion,
        } satisfies StoredOffer;
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

  acceptTraining(
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
      || offer.phase !== 'offered'
      || at >= offer.expiresAt
    ) return Promise.resolve(null);
    offer.phase = 'creating';
    const operation = this.#createTraining(offer);
    offer.operation = operation;
    void operation.catch(() => undefined);
    return offer.completion;
  }

  async #createTraining(offer: StoredOffer): Promise<void> {
    let result: ArenaReservation | null = null;
    try {
      result = await this.#options.createTrainingRoom(
        offer.profileId,
        offer.socketId,
      );
    } catch {
      result = null;
    }
    offer.operation = undefined;
    offer.result = result;
    if (
      result
      && !this.#closed
      && this.#offers.get(offer.profileId) === offer
      && offer.connected
      && offer.phase === 'creating'
    ) {
      this.#offers.delete(offer.profileId);
      this.#events.onMatchFound?.(offer.socketId, result.matchId);
      offer.resolveCompletion(result);
      this.#schedule();
      return;
    }
    offer.phase = 'cleanup';
    await this.#attemptTrainingCleanup(offer);
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
      phase: 'reserving',
      rollbackRequired: false,
      rollbackDone: false,
      voidDone: false,
      cleanupAttempts: 0,
    };
    this.#candidates.set(candidate.candidateId, state);
    for (const entry of entries) {
      this.#events.onQueueState?.(entry.socketId, { status: 'forming' });
    }
    const isValid = (): boolean => (
      !this.#closed
      && this.#candidates.get(candidate.candidateId) === state
      && state.connected.size === entries.length
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
    state.reservation = reservation;
    if (!isValid()) {
      state.phase = 'cleanup';
      await this.#attemptOfficialCleanup(state);
      return;
    }
    state.phase = 'creating';
    state.rollbackRequired = true;
    let created: boolean;
    try {
      created = await this.#options.createOfficialRoom(reservation, candidate);
    } catch {
      created = false;
    }
    if (!created) {
      state.phase = 'cleanup';
      await this.#attemptOfficialCleanup(state);
      return;
    }
    if (!isValid()) {
      state.phase = 'cleanup';
      await this.#attemptOfficialCleanup(state);
      return;
    }
    this.#candidates.delete(candidate.candidateId);
    for (const entry of entries) {
      if (!state.connected.has(entry.profileId)) continue;
      this.#events.onMatchFound?.(entry.socketId, reservation.matchId);
    }
  }

  async #attemptOfficialCleanup(state: CandidateState): Promise<void> {
    const reservation = state.reservation;
    if (!reservation || state.phase !== 'cleanup') return;
    state.retryAt = undefined;
    if (state.rollbackRequired && !state.rollbackDone) {
      try {
        await this.#options.rollbackOfficialRoom(
          reservation,
          state.candidate,
        );
        state.rollbackDone = true;
      } catch {
        this.#deferCleanup(state);
        return;
      }
    }
    if (!state.voidDone) {
      try {
        await this.#options.voidOfficial(reservation.matchId);
        state.voidDone = true;
      } catch {
        this.#deferCleanup(state);
        return;
      }
    }
    this.#restoreCandidate(state, true);
  }

  async #attemptTrainingCleanup(offer: StoredOffer): Promise<void> {
    if (offer.phase !== 'cleanup') return;
    offer.retryAt = undefined;
    if (!offer.rollbackDone) {
      try {
        await this.#options.rollbackTrainingRoom(
          offer.profileId,
          offer.socketId,
          offer.offerId,
          offer.result ?? null,
        );
        offer.rollbackDone = true;
      } catch {
        this.#deferCleanup(offer);
        return;
      }
    }
    this.#offers.delete(offer.profileId);
    if (!this.#closed && offer.connected) {
      this.#events.onQueueState?.(offer.socketId, { status: 'idle' });
    }
    offer.resolveCompletion(null);
    this.#schedule();
  }

  #deferCleanup(
    state: Pick<CandidateState | StoredOffer, 'cleanupAttempts' | 'retryAt'>,
  ): void {
    state.cleanupAttempts += 1;
    const exponent = Math.min(state.cleanupAttempts - 1, 20);
    state.retryAt = this.#now() + Math.min(
      CLEANUP_RETRY_MAX_MS,
      CLEANUP_RETRY_BASE_MS * (2 ** exponent),
    );
    this.#schedule();
  }

  async #drainClose(): Promise<void> {
    while (true) {
      const processing = this.#processingOperation;
      const training = [...this.#offers.values()]
        .map(offer => offer.operation)
        .filter((operation): operation is Promise<void> => !!operation);
      if (processing || training.length > 0) {
        await Promise.allSettled([
          ...(processing ? [processing] : []),
          ...training,
        ]);
        continue;
      }

      const officialCleanup = [...this.#candidates.values()]
        .filter(state => state.phase === 'cleanup');
      const trainingCleanup = [...this.#offers.values()]
        .filter(offer => offer.phase === 'cleanup');
      if (officialCleanup.length === 0 && trainingCleanup.length === 0) {
        this.#candidates.clear();
        this.#offers.clear();
        if (this.#timer) {
          (this.#options.clearTimer ?? clearTimeout)(this.#timer);
          this.#timer = undefined;
        }
        return;
      }

      const nextRetryAt = Math.min(
        ...officialCleanup.map(state => state.retryAt ?? this.#now()),
        ...trainingCleanup.map(offer => offer.retryAt ?? this.#now()),
      );
      await this.#waitForCleanupRetry(Math.max(1, nextRetryAt - this.#now()));
      for (const state of officialCleanup) {
        await this.#attemptOfficialCleanup(state);
      }
      for (const offer of trainingCleanup) {
        await this.#attemptTrainingCleanup(offer);
      }
    }
  }

  #waitForCleanupRetry(delay: number): Promise<void> {
    return new Promise(resolve => {
      const setTimer = this.#options.setTimer ?? setTimeout;
      this.#timer = setTimer(() => {
        this.#timer = undefined;
        resolve();
      }, Math.min(MAX_ARENA_TIMER_DELAY_MS, Math.max(1, delay)));
    });
  }

  #restoreCandidate(state: CandidateState, resetJoinedAt: boolean): void {
    this.#candidates.delete(state.candidate.candidateId);
    if (this.#closed) return;
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
      ...[...this.#candidates.values()]
        .filter(state => state.phase === 'cleanup')
        .map(state => state.retryAt ?? now + 1),
      ...[...this.#offers.values()]
        .filter(offer => offer.phase === 'offered')
        .map(offer => offer.expiresAt),
      ...[...this.#offers.values()]
        .filter(offer => offer.phase === 'cleanup')
        .map(offer => offer.retryAt ?? now + 1),
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
