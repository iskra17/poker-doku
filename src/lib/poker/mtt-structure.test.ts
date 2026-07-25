import { describe, it, expect } from 'vitest';
import { MTT_STRUCTURES, mttClockAt, mttLevelAt } from './mtt-structure';
import type { TournamentStructureSegment } from '../tournament/tournament-config';

const MIN = 60_000;

describe('mtt blind structure', () => {
  it('standard: 100BB start, ante from level 4 (= 1BB)', () => {
    const s = MTT_STRUCTURES.standard;
    expect(s.startingStack / s.levels[0].bigBlind).toBe(100);
    expect(s.levels[0].ante).toBe(0);
    expect(s.levels[2].ante).toBe(0);
    expect(s.levels[3].ante).toBe(s.levels[3].bigBlind);
    expect(s.levels[3].smallBlind).toBe(150);
  });

  it('hyper: ante from level 1', () => {
    const s = MTT_STRUCTURES.hyper;
    expect(s.levels[0].ante).toBe(s.levels[0].bigBlind);
  });

  it('blind sequence increases by at most 2x per level', () => {
    for (const s of Object.values(MTT_STRUCTURES)) {
      for (let i = 1; i < s.levels.length; i++) {
        const ratio = s.levels[i].bigBlind / s.levels[i - 1].bigBlind;
        expect(ratio).toBeGreaterThan(1);
        expect(ratio).toBeLessThanOrEqual(2);
      }
    }
  });
});

describe('mttClockAt', () => {
  const s = { ...MTT_STRUCTURES.standard, levelDurationMs: 8 * MIN };

  it('starts at level 1 with full segment remaining', () => {
    const pos = mttClockAt(s, 0);
    expect(pos.levelIndex).toBe(0);
    expect(pos.onBreak).toBe(false);
    expect(pos.segmentRemainingMs).toBe(8 * MIN);
  });

  it('advances one level per duration', () => {
    expect(mttClockAt(s, 8 * MIN).levelIndex).toBe(1);
    expect(mttClockAt(s, 8 * MIN - 1).levelIndex).toBe(0);
    expect(mttClockAt(s, 3 * 8 * MIN + MIN).levelIndex).toBe(3);
  });

  it('inserts a break after every breakEveryLevels levels', () => {
    // 레벨 6 종료 시점(48분)부터 5분간 브레이크 — 레벨 표기는 다음 레벨(7 = index 6)
    const atBreak = mttClockAt(s, 6 * 8 * MIN + MIN);
    expect(atBreak.onBreak).toBe(true);
    expect(atBreak.levelIndex).toBe(6);
    expect(atBreak.segmentRemainingMs).toBe(4 * MIN);

    // 브레이크 종료 후 레벨 7 진행
    const after = mttClockAt(s, 6 * 8 * MIN + 5 * MIN + MIN);
    expect(after.onBreak).toBe(false);
    expect(after.levelIndex).toBe(6);
    expect(after.segmentRemainingMs).toBe(7 * MIN);
  });

  it('clock time accounts for prior breaks (level 13 needs 2 breaks elapsed)', () => {
    // 12레벨 = 96분 플레이 + 브레이크 2회(레벨 6, 12 이후) 10분
    const pos = mttClockAt(s, 12 * 8 * MIN + 2 * 5 * MIN);
    expect(pos.levelIndex).toBe(12);
    expect(pos.onBreak).toBe(false);
  });

  it('clamps at the final level with no countdown', () => {
    const pos = mttClockAt(s, 100 * 60 * MIN);
    expect(pos.levelIndex).toBe(s.levels.length - 1);
    expect(pos.onBreak).toBe(false);
    expect(pos.segmentRemainingMs).toBe(Infinity);
  });

  it('mttLevelAt clamps out-of-range indices', () => {
    expect(mttLevelAt(s, 999).level).toBe(s.levels.length);
    expect(mttLevelAt(s, 0).level).toBe(1);
  });
});

describe('absolute segment mttClockAt', () => {
  const start = Date.UTC(2026, 6, 25, 12);
  const segments: readonly TournamentStructureSegment[] = [
    {
      kind: 'level',
      durationMs: 5 * MIN,
      smallBlind: 50,
      bigBlind: 100,
      bigBlindAnte: 0,
    },
    { kind: 'break', durationMs: 10 * MIN },
    {
      kind: 'level',
      durationMs: 7 * MIN,
      smallBlind: 100,
      bigBlind: 200,
      bigBlindAnte: 200,
    },
    {
      kind: 'level',
      durationMs: 9 * MIN,
      smallBlind: 150,
      bigBlind: 300,
      bigBlindAnte: 300,
    },
  ];

  it('exposes the current break, next play blinds, and absolute end', () => {
    const pos = mttClockAt(segments, start, start + 6 * MIN);

    expect(pos.currentSegmentIndex).toBe(1);
    expect(pos.currentSegment.kind).toBe('break');
    expect(pos.onBreak).toBe(true);
    expect(pos.segmentEndsAt).toBe(start + 15 * MIN);
    expect(pos.bigBlind).toBe(200);
    expect(pos.bigBlindAnte).toBe(200);
    expect(pos.nextPlaySegmentIndex).toBe(2);
    expect(pos.nextPlaySegment?.kind).toBe('level');
  });

  it('holds the final play segment without a deadline', () => {
    const pos = mttClockAt(segments, start, start + 1_000 * MIN);

    expect(pos.currentSegmentIndex).toBe(3);
    expect(pos.currentSegment.kind).toBe('level');
    expect(pos.bigBlind).toBe(300);
    expect(pos.segmentEndsAt).toBeNull();
    expect(pos.nextPlaySegmentIndex).toBeNull();
    expect(pos.nextPlaySegment).toBeNull();
  });
});
