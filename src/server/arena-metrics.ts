const KST_OFFSET_MS = 9 * 60 * 60 * 1_000;

type QueueWaitBucket = '0-10' | '10-30' | '30-60' | '60+';

interface BotPerformanceCell {
  placeSum: number;
  matches: number;
}

interface DailyBucket {
  readonly date: string;
  readonly tickets: {
    granted: number;
    escrowed: number;
    consumed: number;
    refunded: number;
  };
  readonly official: {
    formed: number;
    completed: number;
    voided: number;
  };
  readonly training: {
    formed: number;
    completed: number;
  };
  readonly queueWaitSeconds: Record<QueueWaitBucket, number>;
  readonly officialHumanCounts: Record<string, number>;
  readonly botPerformance: Record<string, BotPerformanceCell>;
}

export interface ArenaOfficialCompletionMetric {
  readonly humanCount: number;
  readonly botCount: number;
  readonly botPlaceSum: number;
  readonly configVersion: number;
  readonly botVersion: string;
  readonly at: number;
}

/**
 * Aggregate side of Arena telemetry. Per-match/per-profile audit lives in the
 * Arena SQLite tables; this stream never carries an identifier and stays safe
 * to ship to stdout.
 */
export interface ArenaServiceMetrics {
  recordTicketGrant(count: number, at: number): void;
  recordTicketEscrow(count: number, at: number): void;
  recordTicketConsume(count: number, at: number): void;
  recordTicketRefund(count: number, at: number): void;
  recordOfficialCompleted(input: ArenaOfficialCompletionMetric): void;
  recordOfficialVoided(at: number): void;
}

export interface ArenaQueueMetrics {
  recordQueueWait(waitMs: number, at: number): void;
}

export interface ArenaRoomMetrics {
  recordOfficialFormed(humanCount: number, at: number): void;
  recordTrainingFormed(at: number): void;
  recordTrainingCompleted(at: number): void;
}

export interface ArenaMetricsOptions {
  readonly logger?: { log: (line: string) => void };
  readonly collectTierDistribution?: () =>
    Readonly<Record<string, number>> | null;
}

function kstDate(at: number): string {
  return new Date(at + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function queueWaitBucket(waitMs: number): QueueWaitBucket {
  if (waitMs < 10_000) return '0-10';
  if (waitMs < 30_000) return '10-30';
  if (waitMs < 60_000) return '30-60';
  return '60+';
}

function emptyBucket(date: string): DailyBucket {
  return {
    date,
    tickets: { granted: 0, escrowed: 0, consumed: 0, refunded: 0 },
    official: { formed: 0, completed: 0, voided: 0 },
    training: { formed: 0, completed: 0 },
    queueWaitSeconds: { '0-10': 0, '10-30': 0, '30-60': 0, '60+': 0 },
    officialHumanCounts: {},
    botPerformance: {},
  };
}

export class ArenaMetrics
implements ArenaServiceMetrics, ArenaQueueMetrics, ArenaRoomMetrics {
  readonly #logger: { log: (line: string) => void };
  readonly #collectTierDistribution?: () =>
    Readonly<Record<string, number>> | null;
  #bucket: DailyBucket | null = null;
  #closed = false;

  constructor(options: ArenaMetricsOptions = {}) {
    this.#logger = options.logger ?? console;
    this.#collectTierDistribution = options.collectTierDistribution;
  }

  recordTicketGrant(count: number, at: number): void {
    this.#mutate(at, bucket => {
      bucket.tickets.granted += count;
    });
  }

  recordTicketEscrow(count: number, at: number): void {
    this.#mutate(at, bucket => {
      bucket.tickets.escrowed += count;
    });
  }

  recordTicketConsume(count: number, at: number): void {
    this.#mutate(at, bucket => {
      bucket.tickets.consumed += count;
    });
  }

  recordTicketRefund(count: number, at: number): void {
    this.#mutate(at, bucket => {
      bucket.tickets.refunded += count;
    });
  }

  recordOfficialFormed(humanCount: number, at: number): void {
    this.#mutate(at, bucket => {
      bucket.official.formed += 1;
      const key = String(humanCount);
      bucket.officialHumanCounts[key] =
        (bucket.officialHumanCounts[key] ?? 0) + 1;
    });
  }

  recordOfficialCompleted(input: ArenaOfficialCompletionMetric): void {
    this.#mutate(input.at, bucket => {
      bucket.official.completed += 1;
      if (input.botCount === 0) return;
      const key = `${input.configVersion}:${input.botVersion}`;
      const cell = bucket.botPerformance[key]
        ?? (bucket.botPerformance[key] = { placeSum: 0, matches: 0 });
      cell.placeSum += input.botPlaceSum;
      cell.matches += 1;
    });
  }

  recordOfficialVoided(at: number): void {
    this.#mutate(at, bucket => {
      bucket.official.voided += 1;
    });
  }

  recordTrainingFormed(at: number): void {
    this.#mutate(at, bucket => {
      bucket.training.formed += 1;
    });
  }

  recordTrainingCompleted(at: number): void {
    this.#mutate(at, bucket => {
      bucket.training.completed += 1;
    });
  }

  recordQueueWait(waitMs: number, at: number): void {
    this.#mutate(at, bucket => {
      bucket.queueWaitSeconds[queueWaitBucket(waitMs)] += 1;
    });
  }

  /** Emits the cumulative snapshot of the currently open KST day. */
  flush(at: number): void {
    if (this.#closed) return;
    this.#rollover(at);
    if (this.#bucket) this.#emit(this.#bucket);
  }

  close(at: number): void {
    if (this.#closed) return;
    this.flush(at);
    this.#closed = true;
    this.#bucket = null;
  }

  #mutate(at: number, apply: (bucket: DailyBucket) => void): void {
    if (this.#closed) return;
    this.#rollover(at);
    if (!this.#bucket) this.#bucket = emptyBucket(kstDate(at));
    apply(this.#bucket);
  }

  #rollover(at: number): void {
    const date = kstDate(at);
    if (this.#bucket && this.#bucket.date !== date) {
      this.#emit(this.#bucket);
      this.#bucket = null;
    }
  }

  #emit(bucket: DailyBucket): void {
    let tierDistribution: Readonly<Record<string, number>> | null = null;
    try {
      tierDistribution = this.#collectTierDistribution?.() ?? null;
    } catch {
      tierDistribution = null;
    }
    try {
      this.#logger.log(`[arena-metric] ${JSON.stringify({
        ...bucket,
        tierDistribution,
      })}`);
    } catch {
      // Metrics must never break gameplay or shutdown paths.
    }
  }
}
