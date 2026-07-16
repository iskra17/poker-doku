import type {
  ProgressionRewardSummary,
  ProgressionSnapshot,
} from '../lib/progression/types';
import type {
  CompletedHandInput,
  ProgressionService,
  SngFinishInput,
} from './progression-service';

export type ProgressionRuntimeService = Pick<
  ProgressionService,
  'getRuntimeSnapshot' | 'recordRuntimeCompletedHand' | 'recordRuntimeSngFinish'
>;

export type ProgressionRuntimeEmitter = (
  profileId: string,
  snapshot: ProgressionSnapshot,
  summary: ProgressionRewardSummary,
) => void;

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
  ) {}

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
      const current = this.service.getRuntimeSnapshot(
        result.profileId,
        selectedCharacterId,
        completedAt,
      );
      this.emitReward(result.profileId, current, reward);
      this.processedEvents.add(processedKey);
    }
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
