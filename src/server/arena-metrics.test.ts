import { describe, expect, it, vi } from 'vitest';
import { ArenaMetrics } from './arena-metrics';

const KST_DAY_ONE = Date.parse('2026-07-20T00:00:00+09:00');
const HOUR = 60 * 60 * 1_000;
const DAY = 24 * HOUR;

function createMetrics(overrides: {
  logger?: { log: (line: string) => void };
  collectTierDistribution?: () => Readonly<Record<string, number>> | null;
} = {}) {
  const lines: string[] = [];
  const metrics = new ArenaMetrics({
    logger: overrides.logger ?? { log: line => lines.push(line) },
    collectTierDistribution: overrides.collectTierDistribution,
  });
  return { metrics, lines };
}

function parseLastMetric(lines: string[]): Record<string, unknown> {
  const line = lines.at(-1);
  if (!line?.startsWith('[arena-metric] ')) {
    throw new Error(`missing metric line: ${line}`);
  }
  return JSON.parse(line.slice('[arena-metric] '.length));
}

describe('ArenaMetrics', () => {
  it('aggregates daily counters without any personal identifier', () => {
    const { metrics, lines } = createMetrics();
    const at = KST_DAY_ONE + HOUR;

    metrics.recordTicketGrant(2, at);
    metrics.recordTicketGrant(2, at + 1);
    metrics.recordTicketEscrow(2, at + 2);
    metrics.recordTicketConsume(2, at + 3);
    metrics.recordTicketRefund(1, at + 4);
    metrics.recordOfficialFormed(3, at + 5);
    metrics.recordOfficialCompleted({
      humanCount: 3,
      botCount: 3,
      botPlaceSum: 12,
      configVersion: 1,
      botVersion: 'arena-v1-hard',
      at: at + 6,
    });
    metrics.recordOfficialVoided(at + 7);
    metrics.recordTrainingFormed(at + 8);
    metrics.recordTrainingCompleted(at + 9);
    metrics.recordQueueWait(3_000, at + 10);
    metrics.flush(at + 11);

    const row = parseLastMetric(lines);
    expect(row).toMatchObject({
      date: '2026-07-20',
      tickets: { granted: 4, escrowed: 2, consumed: 2, refunded: 1 },
      official: { formed: 1, completed: 1, voided: 1 },
      training: { formed: 1, completed: 1 },
      officialHumanCounts: { '3': 1 },
      botPerformance: {
        '1:arena-v1-hard': { placeSum: 12, matches: 1 },
      },
    });
    expect(JSON.stringify(row)).not.toMatch(
      /profileId|alias|socket|device|credential|recovery|(?<![a-z])ip(?![a-z])/iu,
    );
  });

  it('buckets queue waits into the four second ranges by KST date', () => {
    const { metrics, lines } = createMetrics();
    const at = KST_DAY_ONE + 2 * HOUR;

    metrics.recordQueueWait(0, at);
    metrics.recordQueueWait(9_999, at);
    metrics.recordQueueWait(10_000, at);
    metrics.recordQueueWait(29_999, at);
    metrics.recordQueueWait(30_000, at);
    metrics.recordQueueWait(59_999, at);
    metrics.recordQueueWait(60_000, at);
    metrics.recordQueueWait(180_000, at);
    metrics.flush(at + 1);

    expect(parseLastMetric(lines)).toMatchObject({
      date: '2026-07-20',
      queueWaitSeconds: {
        '0-10': 2,
        '10-30': 2,
        '30-60': 2,
        '60+': 2,
      },
    });
  });

  it('flushes the finished KST day once the date rolls over', () => {
    const { metrics, lines } = createMetrics();

    metrics.recordTicketGrant(2, KST_DAY_ONE + DAY - 1);
    expect(lines).toHaveLength(0);

    metrics.recordTicketGrant(4, KST_DAY_ONE + DAY);

    expect(lines).toHaveLength(1);
    expect(parseLastMetric(lines)).toMatchObject({
      date: '2026-07-20',
      tickets: { granted: 2, escrowed: 0, consumed: 0, refunded: 0 },
    });

    metrics.flush(KST_DAY_ONE + DAY + 1);
    expect(parseLastMetric(lines)).toMatchObject({
      date: '2026-07-21',
      tickets: { granted: 4 },
    });
  });

  it('embeds the tier snapshot on flush and survives collector faults', () => {
    const collect = vi.fn()
      .mockReturnValueOnce({ bronze: 3, silver: 1 })
      .mockImplementationOnce(() => {
        throw new Error('collector down');
      });
    const { metrics, lines } = createMetrics({
      collectTierDistribution: collect,
    });
    const at = KST_DAY_ONE + HOUR;

    metrics.recordTicketGrant(2, at);
    metrics.flush(at + 1);
    expect(parseLastMetric(lines)).toMatchObject({
      date: '2026-07-20',
      tierDistribution: { bronze: 3, silver: 1 },
    });

    metrics.flush(at + 2);
    expect(parseLastMetric(lines)).toMatchObject({
      date: '2026-07-20',
      tierDistribution: null,
    });
  });

  it('close() flushes the open day exactly once and stays idempotent', () => {
    const { metrics, lines } = createMetrics();
    const at = KST_DAY_ONE + HOUR;

    metrics.recordOfficialVoided(at);
    metrics.close(at + 1);
    metrics.close(at + 2);

    expect(lines).toHaveLength(1);
    expect(parseLastMetric(lines)).toMatchObject({
      date: '2026-07-20',
      official: { formed: 0, completed: 0, voided: 1 },
    });
    metrics.recordOfficialVoided(at + 3);
    metrics.flush(at + 4);
    expect(lines).toHaveLength(1);
  });

  it('keeps logger faults from breaking metric recording', () => {
    const { metrics } = createMetrics({
      logger: {
        log: () => {
          throw new Error('stdout closed');
        },
      },
    });

    metrics.recordTicketGrant(2, KST_DAY_ONE + DAY - 1);
    expect(() => metrics.recordTicketGrant(2, KST_DAY_ONE + DAY)).not.toThrow();
    expect(() => metrics.flush(KST_DAY_ONE + DAY + 1)).not.toThrow();
  });
});
