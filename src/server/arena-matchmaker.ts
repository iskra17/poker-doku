import { MAX_ARENA_TIMER_DELAY_MS } from './arena-scheduler';
import type { ArenaQueueState } from '../lib/realtime/protocol';

const RANGE_STEP_MS = 10_000;
const FALLBACK_MS = 60_000;
const TRAINING_OFFER_MS = 30_000;
const MAX_SEATS = 6;
const CLEANUP_RETRY_BASE_MS = 100;
const CLEANUP_RETRY_MAX_MS = 5_000;
const CLOSE_CLEANUP_ATTEMPTS = 3;
const CLOSE_DRAIN_TIMEOUT_MS = 25;

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

export interface ArenaMatchmakerCloseReport {
  readonly pendingOfficialMatchIds: readonly string[];
  readonly pendingTrainingOfferIds: readonly string[];
}

type NotificationResult = unknown;

interface StoredOffer extends ArenaTrainingOffer {
  readonly profileId: string;
  readonly socketId: string;
  phase: 'offered' | 'creating' | 'cleanup';
  connected: boolean;
  rollbackDone: boolean;
  cleanupAttempts: number;
  retryAt?: number;
  result?: ArenaReservation | null;
  operationInFlight: boolean;
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
  readonly onQueueState?: (
    socketId: string,
    state: ArenaQueueState,
  ) => NotificationResult;
  readonly onTrainingOffered?: (
    socketId: string,
    offer: ArenaTrainingOffer,
  ) => NotificationResult;
  readonly onMatchFound?: (
    socketId: string,
    matchId: string,
  ) => NotificationResult;
  readonly onError?: (
    error: unknown,
    context: string,
  ) => NotificationResult;
  readonly setTimer?: (
    callback: () => void,
    delay: number,
  ) => ReturnType<typeof setTimeout>;
  readonly clearTimer?: (timer: ReturnType<typeof setTimeout>) => void;
}

export interface ArenaMatchmakerEventHandlers {
  readonly onQueueState?: (
    socketId: string,
    state: ArenaQueueState,
  ) => NotificationResult;
  readonly onTrainingOffered?: (
    socketId: string,
    offer: ArenaTrainingOffer,
  ) => NotificationResult;
  readonly onMatchFound?: (
    socketId: string,
    matchId: string,
  ) => NotificationResult;
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
  #lifecycleGeneration = 0;
  #closePromise: Promise<ArenaMatchmakerCloseReport> | undefined;
  #events: ArenaMatchmakerEventHandlers;
  readonly #onError?: ArenaMatchmakerOptions['onError'];

  constructor(options: ArenaMatchmakerOptions) {
    this.#options = options;
    this.#now = options.now ?? Date.now;
    this.#events = options;
    this.#onError = options.onError;
  }

  setEventHandlers(handlers: ArenaMatchmakerEventHandlers): void {
    this.#events = handlers;
  }

  #safeNotify(
    context: string,
    callback: (() => NotificationResult) | undefined,
  ): void {
    const generation = this.#lifecycleGeneration;
    if (!callback || !this.#isOpenGeneration(generation)) return;
    try {
      const result = callback();
      if (isPromiseLike(result)) {
        void Promise.resolve(result).catch(error => {
          if (this.#isOpenGeneration(generation)) {
            this.#reportNotificationError(error, context, generation);
          }
        });
      }
    } catch (error) {
      this.#reportNotificationError(error, context, generation);
    }
  }

  #reportNotificationError(
    error: unknown,
    context: string,
    generation: number,
  ): void {
    if (!this.#onError || !this.#isOpenGeneration(generation)) return;
    try {
      const result = this.#onError(error, context);
      if (isPromiseLike(result)) {
        void Promise.resolve(result).catch(() => undefined);
      }
    } catch {
      // Reporting is diagnostic only and must never control match lifecycle.
    }
  }

  start(): void {
    if (this.#closed || this.#started) return;
    this.#started = true;
    this.#schedule();
  }

  close(): Promise<ArenaMatchmakerCloseReport> {
    if (this.#closePromise) return this.#closePromise;
    this.#closed = true;
    const closeGeneration = ++this.#lifecycleGeneration;
    const officialOperationInFlight = this.#processing;
    const trainingOperationsInFlight = new Set(
      [...this.#offers.values()]
        .filter(offer => offer.operationInFlight),
    );
    let resolveClose!: (report: ArenaMatchmakerCloseReport) => void;
    let rejectClose!: (error: unknown) => void;
    const closePromise = new Promise<ArenaMatchmakerCloseReport>(
      (resolve, reject) => {
        resolveClose = resolve;
        rejectClose = reject;
      },
    );
    this.#closePromise = closePromise;
    if (this.#timer) (this.#options.clearTimer ?? clearTimeout)(this.#timer);
    this.#timer = undefined;
    this.#started = false;
    this.#processing = false;
    this.#queue.clear();
    for (const [profileId, offer] of this.#offers) {
      offer.connected = false;
      if (offer.phase === 'offered') this.#offers.delete(profileId);
    }
    for (const state of this.#candidates.values()) state.connected.clear();
    void this.#drainClose(
      closeGeneration,
      officialOperationInFlight,
      trainingOperationsInFlight,
    ).then(resolveClose, rejectClose);
    return closePromise;
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
    this.#safeNotify('queue-state', () =>
      this.#events.onQueueState?.(entry.socketId, state));
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
    this.#safeNotify('queue-state', () =>
      this.#events.onQueueState?.(socketId, { status: 'idle' }));
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
    const generation = this.#lifecycleGeneration;
    this.#processing = true;
    const operation = this.#runTick(at, generation);
    void operation.then(
      () => {
        if (this.#isOpenGeneration(generation)) this.#processing = false;
      },
      () => {
        if (this.#isOpenGeneration(generation)) this.#processing = false;
      },
    );
    return operation;
  }

  async #runTick(at: number, generation: number): Promise<void> {
    if (!this.#isOpenGeneration(generation)) return;
    try {
      let cleanupAttempted = false;
      for (const state of this.#candidates.values()) {
        if (state.phase === 'cleanup' && (state.retryAt ?? 0) <= at) {
          cleanupAttempted = true;
          await this.#attemptOfficialCleanup(state, generation);
          if (!this.#isOpenGeneration(generation)) return;
        }
      }
      for (const offer of this.#offers.values()) {
        if (offer.phase === 'cleanup' && (offer.retryAt ?? 0) <= at) {
          cleanupAttempted = true;
          await this.#attemptTrainingCleanup(offer, generation);
          if (!this.#isOpenGeneration(generation)) return;
        }
      }
      if (cleanupAttempted) return;
      for (const [profileId, offer] of this.#offers) {
        if (offer.phase === 'offered' && offer.expiresAt <= at) {
          this.#offers.delete(profileId);
          this.#safeNotify('queue-state', () =>
            this.#events.onQueueState?.(offer.socketId, { status: 'idle' }));
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
        await this.#formOfficial(selected, generation);
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
          operationInFlight: false,
          completion,
          resolveCompletion,
        } satisfies StoredOffer;
        this.#offers.set(anchor.profileId, offer);
        this.#safeNotify('queue-state', () =>
          this.#events.onQueueState?.(anchor.socketId, {
            status: 'training-offered',
          }));
        this.#safeNotify('training-offered', () =>
          this.#events.onTrainingOffered?.(anchor.socketId, {
            offerId: offer.offerId,
            expiresAt: offer.expiresAt,
          }));
        return;
      }
    } finally {
      if (this.#isOpenGeneration(generation)) {
        this.#processing = false;
        this.#schedule();
      }
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
    offer.operationInFlight = true;
    const generation = this.#lifecycleGeneration;
    const operation = this.#createTraining(offer, generation);
    void operation.catch(() => undefined);
    return offer.completion;
  }

  async #createTraining(
    offer: StoredOffer,
    generation: number,
  ): Promise<void> {
    let result: ArenaReservation | null = null;
    try {
      result = await this.#options.createTrainingRoom(
        offer.profileId,
        offer.socketId,
      );
    } catch {
      if (!this.#isOpenGeneration(generation)) return;
      result = null;
    }
    if (!this.#isOpenGeneration(generation)) return;
    offer.result = result;
    if (
      result
      && !this.#closed
      && this.#offers.get(offer.profileId) === offer
      && offer.connected
      && offer.phase === 'creating'
    ) {
      offer.operationInFlight = false;
      this.#offers.delete(offer.profileId);
      offer.resolveCompletion(result);
      this.#safeNotify('match-found', () =>
        this.#events.onMatchFound?.(offer.socketId, result.matchId));
      this.#schedule();
      return;
    }
    offer.phase = 'cleanup';
    await this.#attemptTrainingCleanup(offer, generation);
    if (this.#isOpenGeneration(generation)) {
      offer.operationInFlight = false;
    }
  }

  async #formOfficial(
    entries: readonly ArenaQueueEntry[],
    generation: number,
  ): Promise<void> {
    if (!this.#isOpenGeneration(generation)) return;
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
      this.#safeNotify('queue-state', () =>
        this.#events.onQueueState?.(entry.socketId, { status: 'forming' }));
      if (!this.#isOpenGeneration(generation)) return;
    }
    const isValid = (): boolean => (
      this.#isOpenGeneration(generation)
      && this.#candidates.get(candidate.candidateId) === state
      && state.connected.size === entries.length
    );

    let reservation: ArenaReservation | null = null;
    try {
      reservation = await this.#options.reserveOfficial(candidate, isValid);
    } catch {
      if (!this.#isOpenGeneration(generation)) return;
      this.#restoreCandidate(state, false);
      return;
    }
    if (!this.#isOpenGeneration(generation)) return;
    if (!reservation) {
      this.#restoreCandidate(state, false);
      return;
    }
    state.reservation = reservation;
    if (!isValid()) {
      state.phase = 'cleanup';
      await this.#attemptOfficialCleanup(state, generation);
      return;
    }
    state.phase = 'creating';
    state.rollbackRequired = true;
    let created: boolean;
    try {
      created = await this.#options.createOfficialRoom(reservation, candidate);
    } catch {
      if (!this.#isOpenGeneration(generation)) return;
      created = false;
    }
    if (!this.#isOpenGeneration(generation)) return;
    if (!created) {
      state.phase = 'cleanup';
      await this.#attemptOfficialCleanup(state, generation);
      return;
    }
    if (!isValid()) {
      state.phase = 'cleanup';
      await this.#attemptOfficialCleanup(state, generation);
      return;
    }
    this.#candidates.delete(candidate.candidateId);
    for (const entry of entries) {
      if (!state.connected.has(entry.profileId)) continue;
      this.#safeNotify('match-found', () =>
        this.#events.onMatchFound?.(entry.socketId, reservation.matchId));
    }
  }

  async #attemptOfficialCleanup(
    state: CandidateState,
    generation: number,
  ): Promise<void> {
    if (!this.#isOpenGeneration(generation)) return;
    const reservation = state.reservation;
    if (!reservation || state.phase !== 'cleanup') return;
    state.retryAt = undefined;
    if (state.rollbackRequired && !state.rollbackDone) {
      try {
        await this.#options.rollbackOfficialRoom(
          reservation,
          state.candidate,
        );
      } catch {
        if (!this.#isOpenGeneration(generation)) return;
        this.#deferCleanup(state);
        return;
      }
      if (!this.#isOpenGeneration(generation)) return;
      state.rollbackDone = true;
    }
    if (!state.voidDone) {
      try {
        await this.#options.voidOfficial(reservation.matchId);
      } catch {
        if (!this.#isOpenGeneration(generation)) return;
        this.#deferCleanup(state);
        return;
      }
      if (!this.#isOpenGeneration(generation)) return;
      state.voidDone = true;
    }
    this.#restoreCandidate(state, true);
  }

  async #attemptTrainingCleanup(
    offer: StoredOffer,
    generation: number,
  ): Promise<void> {
    if (!this.#isOpenGeneration(generation)) return;
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
      } catch {
        if (!this.#isOpenGeneration(generation)) return;
        this.#deferCleanup(offer);
        return;
      }
      if (!this.#isOpenGeneration(generation)) return;
      offer.rollbackDone = true;
    }
    this.#offers.delete(offer.profileId);
    offer.resolveCompletion(null);
    if (!this.#closed && offer.connected) {
      this.#safeNotify('queue-state', () =>
        this.#events.onQueueState?.(offer.socketId, { status: 'idle' }));
    }
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

  async #drainClose(
    closeGeneration: number,
    officialOperationInFlight: boolean,
    trainingOperationsInFlight: ReadonlySet<StoredOffer>,
  ): Promise<ArenaMatchmakerCloseReport> {
    const deadline = Date.now() + CLOSE_DRAIN_TIMEOUT_MS;
    for (let attempt = 0; attempt < CLOSE_CLEANUP_ATTEMPTS; attempt += 1) {
      const officialCleanup = officialOperationInFlight
        ? []
        : [...this.#candidates.values()]
            .filter(state => state.phase === 'cleanup');
      const trainingCleanup = [...this.#offers.values()]
        .filter(offer => (
          offer.phase === 'cleanup'
          && !trainingOperationsInFlight.has(offer)
        ));
      if (officialCleanup.length === 0 && trainingCleanup.length === 0) {
        break;
      }
      for (const state of officialCleanup) {
        if (Date.now() >= deadline) break;
        await this.#attemptOfficialCloseCleanup(
          state,
          closeGeneration,
          deadline,
        );
        if (!this.#isCloseGeneration(closeGeneration)) break;
      }
      for (const offer of trainingCleanup) {
        if (Date.now() >= deadline) break;
        await this.#attemptTrainingCloseCleanup(
          offer,
          closeGeneration,
          deadline,
        );
        if (!this.#isCloseGeneration(closeGeneration)) break;
      }
      if (
        Date.now() >= deadline
        || !this.#isCloseGeneration(closeGeneration)
      ) break;
    }

    const pendingOfficialMatchIds = [...this.#candidates.values()]
      .map(state => state.reservation?.matchId)
      .filter((matchId): matchId is string => !!matchId)
      .sort(binaryCompare);
    const pendingTrainingOfferIds = [...this.#offers.values()]
      .filter(offer => offer.phase !== 'offered')
      .map(offer => offer.offerId)
      .sort(binaryCompare);
    for (const offer of this.#offers.values()) {
      if (offer.phase !== 'offered') offer.resolveCompletion(null);
    }
    this.#candidates.clear();
    this.#offers.clear();
    if (this.#timer) {
      (this.#options.clearTimer ?? clearTimeout)(this.#timer);
      this.#timer = undefined;
    }
    if (this.#isCloseGeneration(closeGeneration)) {
      this.#lifecycleGeneration += 1;
    }
    return Object.freeze({
      pendingOfficialMatchIds: Object.freeze(pendingOfficialMatchIds),
      pendingTrainingOfferIds: Object.freeze(pendingTrainingOfferIds),
    });
  }

  async #attemptOfficialCloseCleanup(
    state: CandidateState,
    closeGeneration: number,
    deadline: number,
  ): Promise<void> {
    if (!this.#isCloseGeneration(closeGeneration)) return;
    const reservation = state.reservation;
    if (!reservation || state.phase !== 'cleanup') return;
    if (state.rollbackRequired && !state.rollbackDone) {
      const rollback = await this.#settleCloseDependency(
        () => this.#options.rollbackOfficialRoom(
          reservation,
          state.candidate,
        ),
        closeGeneration,
        deadline,
      );
      if (
        rollback !== 'fulfilled'
        || !this.#isCloseGeneration(closeGeneration)
      ) return;
      state.rollbackDone = true;
    }
    if (!state.voidDone) {
      const voided = await this.#settleCloseDependency(
        () => this.#options.voidOfficial(reservation.matchId),
        closeGeneration,
        deadline,
      );
      if (
        voided !== 'fulfilled'
        || !this.#isCloseGeneration(closeGeneration)
      ) return;
      state.voidDone = true;
    }
    this.#candidates.delete(state.candidate.candidateId);
  }

  async #attemptTrainingCloseCleanup(
    offer: StoredOffer,
    closeGeneration: number,
    deadline: number,
  ): Promise<void> {
    if (
      !this.#isCloseGeneration(closeGeneration)
      || offer.phase !== 'cleanup'
    ) return;
    if (!offer.rollbackDone) {
      const rollback = await this.#settleCloseDependency(
        () => this.#options.rollbackTrainingRoom(
          offer.profileId,
          offer.socketId,
          offer.offerId,
          offer.result ?? null,
        ),
        closeGeneration,
        deadline,
      );
      if (
        rollback !== 'fulfilled'
        || !this.#isCloseGeneration(closeGeneration)
      ) return;
      offer.rollbackDone = true;
    }
    this.#offers.delete(offer.profileId);
    offer.resolveCompletion(null);
  }

  #settleCloseDependency(
    operation: () => Promise<unknown>,
    closeGeneration: number,
    deadline: number,
  ): Promise<'fulfilled' | 'rejected' | 'timed-out'> {
    const remaining = deadline - Date.now();
    if (remaining <= 0 || !this.#isCloseGeneration(closeGeneration)) {
      return Promise.resolve('timed-out');
    }
    return new Promise(resolve => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled || !this.#isCloseGeneration(closeGeneration)) return;
        settled = true;
        resolve('timed-out');
      }, remaining);
      let dependency: Promise<unknown>;
      try {
        dependency = Promise.resolve(operation());
      } catch {
        clearTimeout(timer);
        settled = true;
        resolve('rejected');
        return;
      }
      void dependency.then(
        () => {
          if (settled || !this.#isCloseGeneration(closeGeneration)) return;
          clearTimeout(timer);
          settled = true;
          resolve('fulfilled');
        },
        () => {
          if (settled || !this.#isCloseGeneration(closeGeneration)) return;
          clearTimeout(timer);
          settled = true;
          resolve('rejected');
        },
      );
    });
  }

  #restoreCandidate(state: CandidateState, resetJoinedAt: boolean): void {
    this.#candidates.delete(state.candidate.candidateId);
    if (this.#closed) return;
    const joinedAt = this.#now();
    const restoredEntries: ArenaQueueEntry[] = [];
    for (const entry of state.candidate.entries) {
      if (!state.connected.has(entry.profileId)) continue;
      const restored = Object.freeze({
        ...entry,
        joinedAt: resetJoinedAt ? joinedAt : entry.joinedAt,
      });
      this.#queue.set(entry.profileId, restored);
      restoredEntries.push(restored);
    }
    for (const restored of restoredEntries) {
      this.#safeNotify('queue-state', () =>
        this.#events.onQueueState?.(restored.socketId, {
          status: 'queued',
          joinedAt: restored.joinedAt,
        }));
    }
  }

  #rankedQueue(): ArenaQueueEntry[] {
    return [...this.#queue.values()].sort((left, right) =>
      left.joinedAt - right.joinedAt || binaryCompare(left.profileId, right.profileId));
  }

  #isOpenGeneration(generation: number): boolean {
    return !this.#closed && this.#lifecycleGeneration === generation;
  }

  #isCloseGeneration(generation: number): boolean {
    return this.#closed && this.#lifecycleGeneration === generation;
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

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    value !== null
    && (typeof value === 'object' || typeof value === 'function')
    && 'then' in value
    && typeof value.then === 'function'
  );
}
