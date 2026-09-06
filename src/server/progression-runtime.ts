import type {
  ProgressionRewardSummary,
  ProgressionSnapshot,
} from '../lib/progression/types';
import { eventLog } from './event-log';
import type {
  CompletedHandInput,
  ProgressionService,
  SngFinishInput,
  StoryChapterCompleteInput,
  StoryChapterCompleteResult,
  StoryDailyDrillsInput,
  StoryDailyDrillsResult,
} from './progression-service';

export type ProgressionRuntimeService = Pick<
  ProgressionService,
  | 'getRuntimeSnapshot'
  | 'recordRuntimeCompletedHand'
  | 'recordRuntimeSngFinish'
  | 'recordRuntimeStoryChapterComplete'
  | 'recordStoryChapterCompleteInTransaction'
  | 'hasStoryChapterEvent'
  | 'recordRuntimeStoryDailyDrills'
>;

export type ProgressionRuntimeEmitter = (
  profileId: string,
  snapshot: ProgressionSnapshot,
  summary: ProgressionRewardSummary,
) => void;

/**
 * 레벨 트리거 보상(보너스 CG) 즉시 반영 — 캐시/연습 핸드·SnG 정산이 **커밋된 뒤**에만 호출한다.
 * 스토리 결산·데일리·진행도 조회의 기존 reconcile 호출처는 그대로 둔다(결산 지급 목록을 가로채면 안 된다,
 * 2026-09-06 Astra 검토 P2 ②). 여기서 새 지급이 생기면 전송 스냅샷을 **그 뒤에** 다시 읽는다.
 */
export interface ProgressionRuntimeStoryRewards {
  reconcile(profileId: string, now: number): { granted: unknown[]; chips: number };
}

export interface RoomProgressionHooks {
  captureHandStart(input: CaptureHandStartInput): void;
  confirmHandStart(roomId: string, roomRunId: string, handNumber: number): void;
  cancelHand(roomId: string, roomRunId: string, handNumber: number): void;
  completeHand(input: CompleteHandInput): void;
  completeSng(input: CompleteSngInput): void;
  disposeRoom(roomId: string): void;
}

export type RuntimeGameMode = 'cash' | 'practice' | 'sng';

export interface RuntimeHandPlayer {
  profileId: string;
  fallbackCharacterId: string;
  dealt: boolean;
}

export interface CaptureHandStartInput {
  roomId: string;
  roomRunId: string;
  handNumber: number;
  mode: RuntimeGameMode;
  players: RuntimeHandPlayer[];
}

export interface CompleteHandInput {
  roomId: string;
  roomRunId: string;
  handNumber: number;
  pendingRemovalProfileIds: string[];
}

export interface CompleteSngInput {
  roomId: string;
  roomRunId: string;
  results: Array<{ profileId: string; place: number }>;
}

interface HandContext {
  mode: 'cash' | 'practice';
  selectedCharacterByProfileId: Map<string, string>;
}

/**
 * Converts authoritative RoomManager lifecycle events into durable progression events.
 * It deliberately has no access to winners, chip deltas, actions, or bet sizes.
 */
export class ProgressionRuntime {
  private readonly handContexts = new Map<string, HandContext>();
  private readonly tournamentCharacters = new Map<string, Map<string, string>>();
  private readonly pendingTournamentAdditions = new Map<string, string[]>();
  private readonly processedEvents = new Set<string>();

  constructor(
    private readonly service: ProgressionRuntimeService,
    private readonly emitReward: ProgressionRuntimeEmitter,
    private readonly now: () => number = Date.now,
    private readonly storyRewards?: ProgressionRuntimeStoryRewards,
  ) {}

  /**
   * 커밋 뒤 레벨 보상 reconcile — 실패는 격리하되 **반드시 로그로 남긴다**
   * (다음 진행도 조회·결산이 자기 치유하지만, 지급 누락이 아무 흔적 없이 사라지면 안 된다 —
   * 2026-09-06 Astra 구현 검토 P3). `story-reward-reconcile-failed`는 ops_event 영속 대상이다.
   */
  private reconcileLevelRewards(
    profileId: string,
    at: number,
    context: { mode: RuntimeGameMode; roomId: string; roomRunId: string },
  ): void {
    if (!this.storyRewards) return;
    try {
      this.storyRewards.reconcile(profileId, at);
    } catch (error) {
      // 핸드/토너먼트 진행을 보상 장애로 막지 않는다 — 맥락만 남기고 계속한다
      eventLog.log('story-reward-reconcile-failed', {
        roomId: context.roomId,
        playerId: profileId,
        data: {
          mode: context.mode,
          roomRunId: context.roomRunId,
          at,
          reason: error instanceof Error ? error.message : 'unknown',
        },
      });
    }
  }

  getSnapshot(
    profileId: string,
    fallbackCharacterId: string,
    at = this.now(),
  ): ProgressionSnapshot {
    return this.service.getRuntimeSnapshot(profileId, fallbackCharacterId, at);
  }

  captureHandStart(input: CaptureHandStartInput): void {
    const capturedAt = this.now();
    const selected = new Map<string, string>();
    for (const player of input.players) {
      if (!player.dealt || selected.has(player.profileId)) continue;
      const current = this.service.getRuntimeSnapshot(
        player.profileId,
        player.fallbackCharacterId,
        capturedAt,
      );
      selected.set(player.profileId, current.profile.selectedCharacterId);
    }

    if (input.mode === 'sng') {
      const lifecycle = lifecycleKey(input.roomId, input.roomRunId);
      let tournament = this.tournamentCharacters.get(lifecycle);
      if (!tournament) {
        tournament = new Map();
        this.tournamentCharacters.set(lifecycle, tournament);
      }
      const additions: string[] = [];
      for (const [profileId, characterId] of selected) {
        if (tournament.has(profileId)) continue;
        tournament.set(profileId, characterId);
        additions.push(profileId);
      }
      this.pendingTournamentAdditions.set(
        handKey(input.roomId, input.roomRunId, input.handNumber),
        additions,
      );
      return;
    }

    this.handContexts.set(handKey(input.roomId, input.roomRunId, input.handNumber), {
      mode: input.mode,
      selectedCharacterByProfileId: selected,
    });
  }

  confirmHandStart(roomId: string, roomRunId: string, handNumber: number): void {
    this.pendingTournamentAdditions.delete(handKey(roomId, roomRunId, handNumber));
  }

  cancelHand(roomId: string, roomRunId: string, handNumber: number): void {
    const key = handKey(roomId, roomRunId, handNumber);
    this.handContexts.delete(key);
    const additions = this.pendingTournamentAdditions.get(key);
    if (!additions) return;
    const lifecycle = lifecycleKey(roomId, roomRunId);
    const tournament = this.tournamentCharacters.get(lifecycle);
    for (const profileId of additions) tournament?.delete(profileId);
    if (tournament?.size === 0) this.tournamentCharacters.delete(lifecycle);
    this.pendingTournamentAdditions.delete(key);
  }

  completeHand(input: CompleteHandInput): void {
    const key = handKey(input.roomId, input.roomRunId, input.handNumber);
    const context = this.handContexts.get(key);
    if (!context) return;
    const pendingRemoval = new Set(input.pendingRemovalProfileIds);
    const completedAt = this.now();

    for (const [profileId, selectedCharacterId] of context.selectedCharacterByProfileId) {
      if (pendingRemoval.has(profileId)) continue;
      const processedKey = `hand:${key}:${profileId}`;
      if (this.processedEvents.has(processedKey)) continue;
      const rewardInput: CompletedHandInput = {
        profileId,
        roomId: input.roomId,
        roomRunId: input.roomRunId,
        handNumber: input.handNumber,
        mode: context.mode,
        selectedCharacterId,
        completedAt,
      };
      const reward = this.service.recordRuntimeCompletedHand(rewardInput);
      // 인연·도장 레벨이 이 핸드로 올랐을 수 있다 — 커밋 뒤 reconcile → 스냅샷 재조회
      this.reconcileLevelRewards(profileId, completedAt, {
        mode: context.mode,
        roomId: input.roomId,
        roomRunId: input.roomRunId,
      });
      const current = this.service.getRuntimeSnapshot(
        profileId,
        selectedCharacterId,
        completedAt,
      );
      this.emitReward(profileId, current, reward);
      this.processedEvents.add(processedKey);
    }
    this.handContexts.delete(key);
    const processedPrefix = `hand:${key}:`;
    for (const processedKey of this.processedEvents) {
      if (processedKey.startsWith(processedPrefix)) {
        this.processedEvents.delete(processedKey);
      }
    }
  }

  completeSng(input: CompleteSngInput): void {
    const tournament = this.tournamentCharacters.get(
      lifecycleKey(input.roomId, input.roomRunId),
    );
    if (!tournament) return;
    const completedAt = this.now();
    const seenProfiles = new Set<string>();

    for (const result of input.results) {
      if (seenProfiles.has(result.profileId)) continue;
      seenProfiles.add(result.profileId);
      const selectedCharacterId = tournament.get(result.profileId);
      if (!selectedCharacterId) continue;
      const processedKey = `sng:${input.roomId}:${input.roomRunId}:${result.profileId}`;
      if (this.processedEvents.has(processedKey)) continue;
      const rewardInput: SngFinishInput = {
        profileId: result.profileId,
        roomId: input.roomId,
        roomRunId: input.roomRunId,
        place: result.place,
        selectedCharacterId,
        completedAt,
      };
      const reward = this.service.recordRuntimeSngFinish(rewardInput);
      this.reconcileLevelRewards(result.profileId, completedAt, {
        mode: 'sng',
        roomId: input.roomId,
        roomRunId: input.roomRunId,
      });
      const current = this.service.getRuntimeSnapshot(
        result.profileId,
        selectedCharacterId,
        completedAt,
      );
      this.emitReward(result.profileId, current, reward);
      this.processedEvents.add(processedKey);
    }
  }

  /**
   * 수련 스토리 챕터 결산 — 방/핸드 수명주기와 무관한 개인 경로라 별도 컨텍스트가 없다.
   * 서비스가 멱등을 소유하므로 런타임은 emit만 가른다(중복 지급이면 카드를 다시 띄우지 않는다).
   */
  completeStoryChapter(
    input: StoryChapterCompleteInput,
  ): StoryChapterCompleteResult {
    const result = this.service.recordRuntimeStoryChapterComplete(input);
    if (!result.duplicate) {
      this.emitReward(input.profileId, result.snapshot, result.summary);
    }
    return result;
  }

  /**
   * 원자 결산 전용 — 호출자가 연 트랜잭션에 참여한다. 보상 카드(emit)는 커밋 뒤
   * `notifyStoryChapterReward`로 따로 띄운다(트랜잭션 안에서 소켓을 밀지 않는다).
   */
  completeStoryChapterInTransaction(
    input: StoryChapterCompleteInput,
  ): StoryChapterCompleteResult {
    return this.service.recordStoryChapterCompleteInTransaction(input);
  }

  /** 고정된 완주 이벤트가 이미 있는가 — 완료 횟수 증가 전 run 단위 멱등 검사 */
  hasStoryChapterEvent(input: {
    profileId: string;
    chapterId: string;
    runId: string;
    firstClear: boolean;
  }): boolean {
    return this.service.hasStoryChapterEvent(input);
  }

  /** 커밋 뒤 보상 카드 — 중복 지급이면 다시 띄우지 않는다 */
  notifyStoryChapterReward(profileId: string, result: StoryChapterCompleteResult): void {
    if (result.duplicate) return;
    this.emitReward(profileId, result.snapshot, result.summary);
  }

  /** 오늘의 수련 문제 3개 완료 — 하루 1회. */
  completeStoryDaily(input: StoryDailyDrillsInput): StoryDailyDrillsResult {
    const result = this.service.recordRuntimeStoryDailyDrills(input);
    if (!result.duplicate) {
      this.emitReward(input.profileId, result.snapshot, result.summary);
    }
    return result;
  }

  disposeRoom(roomId: string): void {
    for (const key of this.tournamentCharacters.keys()) {
      if (key.startsWith(`${roomId}:`)) this.tournamentCharacters.delete(key);
    }
    for (const key of this.pendingTournamentAdditions.keys()) {
      if (key.startsWith(`${roomId}:`)) this.pendingTournamentAdditions.delete(key);
    }
    for (const key of this.handContexts.keys()) {
      if (key.startsWith(`${roomId}:`)) this.handContexts.delete(key);
    }
    for (const key of this.processedEvents) {
      if (key.includes(`:${roomId}:`)) this.processedEvents.delete(key);
    }
  }
}

function lifecycleKey(roomId: string, roomRunId: string): string {
  return `${roomId}:${roomRunId}`;
}

function handKey(roomId: string, roomRunId: string, handNumber: number): string {
  return `${lifecycleKey(roomId, roomRunId)}:${handNumber}`;
}
