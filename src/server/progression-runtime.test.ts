import { describe, expect, it, vi } from 'vitest';
import type {
  ProgressionRewardSummary,
  ProgressionSnapshot,
} from '../lib/progression/types';
import {
  ProgressionRuntime,
  type ProgressionRuntimeService,
} from './progression-runtime';

function snapshot(profileId: string, selectedCharacterId: 'sakura' | 'hana'): ProgressionSnapshot {
  return {
    profile: {
      profileId,
      balanceVersion: 1,
      dojoLevel: 1,
      dojoXpMilli: 0,
      selectedCharacterId,
      practiceDate: null,
      practiceHands: 0,
      completedHands: 0,
      cashHands: 0,
      practiceHandsTotal: 0,
      sngCompletions: 0,
      bestStreak: 0,
      createdAt: 1,
      updatedAt: 1,
    },
    affinities: [{
      profileId,
      characterId: selectedCharacterId,
      level: 1,
      xpMilli: 0,
    }],
    streak: {
      profileId,
      currentStreak: 0,
      restPasses: 0,
      lastQualifiedDate: null,
      lastWeekKey: null,
      createdAt: 1,
      updatedAt: 1,
    },
    inventory: [],
    equipment: { title: null, frame: null, skin: null, cutin: null },
  };
}

function summary(eventId: string, characterId: string): ProgressionRewardSummary {
  return {
    eventId,
    dojoXpMilli: 10_000,
    dojoLevelsGained: [],
    characterId,
    affinityMilli: 2_000,
    affinityLevelsGained: [],
    missionCompletions: [],
    grantedItemIds: [],
  };
}

function makeService(characters: Record<string, 'sakura' | 'hana'> = {}): {
  service: ProgressionRuntimeService;
  getRuntimeSnapshot: ReturnType<typeof vi.fn>;
  recordCompletedHand: ReturnType<typeof vi.fn>;
  recordSngFinish: ReturnType<typeof vi.fn>;
} {
  const getRuntimeSnapshot = vi.fn((profileId: string, fallback: string) => (
    snapshot(profileId, characters[profileId] ?? fallback as 'sakura' | 'hana')
  ));
  const recordCompletedHand = vi.fn(input => summary(
    `completed-hand:${input.profileId}:${input.roomId}:${input.handNumber}`,
    input.selectedCharacterId,
  ));
  const recordSngFinish = vi.fn(input => summary(
    `sng-finish:${input.profileId}:${input.roomId}`,
    input.selectedCharacterId,
  ));
  return {
    service: {
      getRuntimeSnapshot,
      recordRuntimeCompletedHand: recordCompletedHand,
      recordRuntimeSngFinish: recordSngFinish,
    },
    getRuntimeSnapshot,
    recordCompletedHand,
    recordSngFinish,
  };
}

describe('ProgressionRuntime', () => {
  it('awards only dealt cash humans who remain through settlement', () => {
    const service = makeService({ alice: 'hana' });
    const emitted: Array<{ profileId: string; eventId: string }> = [];
    const runtime = new ProgressionRuntime(
      service.service,
      (profileId, _snapshot, reward) => emitted.push({
        profileId,
        eventId: reward.eventId,
      }),
      () => 2_000,
    );

    runtime.captureHandStart({
      roomId: 'cash-room',
      roomRunId: 'run-a',
      handNumber: 7,
      mode: 'cash',
      players: [
        { profileId: 'alice', fallbackCharacterId: 'sakura', dealt: true },
        { profileId: 'left-mid-hand', fallbackCharacterId: 'sakura', dealt: true },
        { profileId: 'sitting-out', fallbackCharacterId: 'sakura', dealt: false },
      ],
    });
    runtime.completeHand({
      roomId: 'cash-room',
      roomRunId: 'run-a',
      handNumber: 7,
      pendingRemovalProfileIds: ['left-mid-hand'],
    });

    expect(service.recordCompletedHand).toHaveBeenCalledOnce();
    expect(service.recordCompletedHand).toHaveBeenCalledWith({
      profileId: 'alice',
      roomId: 'cash-room',
      roomRunId: 'run-a',
      handNumber: 7,
      mode: 'cash',
      selectedCharacterId: 'hana',
      completedAt: 2_000,
    });
    expect(service.recordCompletedHand.mock.calls[0][0]).not.toHaveProperty('won');
    expect(service.recordCompletedHand.mock.calls[0][0]).not.toHaveProperty('stackDelta');
    expect(emitted).toEqual([{
      profileId: 'alice',
      eventId: 'completed-hand:alice:cash-room:7',
    }]);
  });

  it('awards practice hands without an economy-dependent input', () => {
    const service = makeService();
    const runtime = new ProgressionRuntime(service.service, () => {}, () => 3_000);

    runtime.captureHandStart({
      roomId: 'practice-room',
      roomRunId: 'run-a',
      handNumber: 1,
      mode: 'practice',
      players: [{ profileId: 'trainee', fallbackCharacterId: 'sakura', dealt: true }],
    });
    runtime.completeHand({
      roomId: 'practice-room',
      roomRunId: 'run-a',
      handNumber: 1,
      pendingRemovalProfileIds: [],
    });

    expect(service.recordCompletedHand).toHaveBeenCalledWith(expect.objectContaining({
      profileId: 'trainee',
      mode: 'practice',
    }));
  });

  it('does not award or emit a completed hand twice', () => {
    const service = makeService();
    const emit = vi.fn();
    const runtime = new ProgressionRuntime(service.service, emit, () => 4_000);
    runtime.captureHandStart({
      roomId: 'cash-room',
      roomRunId: 'run-a',
      handNumber: 2,
      mode: 'cash',
      players: [{ profileId: 'alice', fallbackCharacterId: 'sakura', dealt: true }],
    });

    runtime.completeHand({
      roomId: 'cash-room', roomRunId: 'run-a', handNumber: 2, pendingRemovalProfileIds: [],
    });
    runtime.completeHand({
      roomId: 'cash-room', roomRunId: 'run-a', handNumber: 2, pendingRemovalProfileIds: [],
    });

    expect(service.recordCompletedHand).toHaveBeenCalledOnce();
    expect(emit).toHaveBeenCalledOnce();
  });

  it('fans out final SnG places to snapshotted humans and never bots', () => {
    const service = makeService({ human1: 'hana' });
    const emit = vi.fn();
    const runtime = new ProgressionRuntime(service.service, emit, () => 5_000);
    runtime.captureHandStart({
      roomId: 'sng-room',
      roomRunId: 'run-a',
      handNumber: 1,
      mode: 'sng',
      players: [
        { profileId: 'human1', fallbackCharacterId: 'sakura', dealt: true },
        { profileId: 'human2', fallbackCharacterId: 'sakura', dealt: true },
      ],
    });
    // A later final hand has only one survivor. The first-hand tournament snapshot is retained.
    runtime.captureHandStart({
      roomId: 'sng-room',
      roomRunId: 'run-a',
      handNumber: 9,
      mode: 'sng',
      players: [{ profileId: 'human1', fallbackCharacterId: 'sakura', dealt: true }],
    });

    runtime.completeSng({
      roomId: 'sng-room',
      roomRunId: 'run-a',
      results: [
        { profileId: 'human1', place: 1 },
        { profileId: 'bot-a', place: 2 },
        { profileId: 'human2', place: 3 },
      ],
    });

    expect(service.recordSngFinish.mock.calls.map(call => call[0])).toEqual([
      {
        profileId: 'human1', roomId: 'sng-room', roomRunId: 'run-a', place: 1,
        selectedCharacterId: 'hana', completedAt: 5_000,
      },
      {
        profileId: 'human2', roomId: 'sng-room', roomRunId: 'run-a', place: 3,
        selectedCharacterId: 'sakura', completedAt: 5_000,
      },
    ]);
    expect(emit.mock.calls.map(call => call[0])).toEqual(['human1', 'human2']);
  });

  it('does not re-award retained SnG results when completion is announced again', () => {
    const service = makeService();
    const runtime = new ProgressionRuntime(service.service, () => {}, () => 6_000);
    runtime.captureHandStart({
      roomId: 'sng-room',
      roomRunId: 'run-a',
      handNumber: 1,
      mode: 'sng',
      players: [{ profileId: 'human', fallbackCharacterId: 'sakura', dealt: true }],
    });
    const completion = {
      roomId: 'sng-room',
      roomRunId: 'run-a',
      results: [{ profileId: 'human', place: 1 }],
    };

    runtime.completeSng(completion);
    runtime.completeSng(completion);

    expect(service.recordSngFinish).toHaveBeenCalledOnce();
  });

  it('discards an SnG participant snapshot when the hand never starts', () => {
    const service = makeService();
    const runtime = new ProgressionRuntime(service.service, () => {}, () => 6_500);
    runtime.captureHandStart({
      roomId: 'sng-retry',
      roomRunId: 'run-a',
      handNumber: 1,
      mode: 'sng',
      players: [
        { profileId: 'removed-before-deal', fallbackCharacterId: 'sakura', dealt: true },
        { profileId: 'survivor', fallbackCharacterId: 'sakura', dealt: true },
      ],
    });
    runtime.cancelHand('sng-retry', 'run-a', 1);
    runtime.captureHandStart({
      roomId: 'sng-retry',
      roomRunId: 'run-a',
      handNumber: 1,
      mode: 'sng',
      players: [{ profileId: 'survivor', fallbackCharacterId: 'sakura', dealt: true }],
    });
    runtime.confirmHandStart('sng-retry', 'run-a', 1);

    runtime.completeSng({
      roomId: 'sng-retry',
      roomRunId: 'run-a',
      results: [
        { profileId: 'survivor', place: 1 },
        { profileId: 'removed-before-deal', place: 2 },
      ],
    });

    expect(service.recordSngFinish.mock.calls.map(call => call[0].profileId))
      .toEqual(['survivor']);
  });

  it('persists disconnected rewards while the personal emitter can decline delivery', () => {
    const service = makeService();
    const delivered: string[] = [];
    const connected = new Set<string>();
    const runtime = new ProgressionRuntime(
      service.service,
      profileId => {
        if (connected.has(profileId)) delivered.push(profileId);
      },
      () => 7_000,
    );
    runtime.captureHandStart({
      roomId: 'cash-room',
      roomRunId: 'run-a',
      handNumber: 3,
      mode: 'cash',
      players: [{ profileId: 'offline', fallbackCharacterId: 'sakura', dealt: true }],
    });

    runtime.completeHand({
      roomId: 'cash-room', roomRunId: 'run-a', handNumber: 3, pendingRemovalProfileIds: [],
    });

    expect(service.recordCompletedHand).toHaveBeenCalledOnce();
    expect(delivered).toEqual([]);
  });
});
