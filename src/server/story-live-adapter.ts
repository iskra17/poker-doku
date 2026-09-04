import { MasqueradeQuiz, shuffledMasqueradePool } from './story-masquerade';
import { reviewOpponentResponses } from './story-opponent-review';
/**
 * LiveTableAdapter — 수련 스토리 라이브 스텝(프리셋 '연습' / 스파링 '대결')을 실제 포커 방에 붙이는 어댑터.
 * `StoryRoomHooks`를 구현해 RoomManager에 주입되며, 스토리 방(config.storyChapterId) 한정으로만 호출된다.
 *
 * 소유권:
 * - 방 수명주기(생성·라인업 착석·hold/재개·해체)와 목표/리뷰/인터럽트 판정은 여기가 소유.
 * - 런 상태 머신(스텝 인덱스·결산)은 StoryRunCoordinator 소유 — 어댑터는 `events`로만 코디네이터에 알린다.
 * - 엔진은 불변: 프리셋은 생성자 deck 인자(ScenarioDeck)로만 들어간다.
 *
 * 히어로 이탈·타임아웃 계약(기획 B3(d)):
 * - 턴 타임아웃 자동 폴드 뒤 다음 핸드 직전 `beforeHand`가 히어로의 sitOutNext(sitOutAuto) 마킹을 해제하고
 *   'hold'(holdReason 'timeout') → 클라 [계속하기] = story-advance(target 'resume') → `resume()` → resumeRoom.
 * - 히어로가 딜인되지 않은 핸드는 handsPlayed·목표에 집계하지 않는다(방어 가드 — hold 계약상 원래 발생하지 않는다).
 * - 이탈은 abandon-story 단일 경로. 끊김은 grace 만료 → 좌석 회수 → 빈 방 dispose → `onRoomDisposed`가 세션을
 *   room-lost(hold)로 보존하고, 허브 「이어하기」(resume)가 같은 스텝을 **새 방**으로 재개한다(집계 유지).
 * - hold는 최대 `holdTimeoutMs`(10분) — 초과하면 방을 해체하고 room-lost 보존으로 전환한다(방/타이머 누수 방지).
 */
import type { PokerEngine } from '../lib/poker/engine';
import type { CompletedHandRecord } from '../lib/poker/hand-history';
import type { Player, RoomConfig } from '../lib/poker/types';
import type { BotDecision } from '../lib/bot/bot-ai';
import { createBotWithCharacter, type BotDisplayIdentity } from '../lib/bot/bot-manager';
import { DEALER_CHARACTER, getCharacterById, MASKED_BOT_CHARACTER } from '../lib/characters';
import type { RealtimeErrorCode } from '../lib/realtime/protocol';
import { ScenarioDeck, ScenarioDeckError } from '../lib/story/scenario-deck';
import {
  addHand,
  deriveHeroHandFacts,
  emptyTally,
  evaluateObjectives,
  liveScore,
  primaryObjectivesAllAchieved,
  primaryObjectivesMet,
  type ObjectiveTally,
} from '../lib/story/objectives';
import { reviewHand } from '../lib/story/review';
import { STORY_HEROINE_IDS, type Interrupt, type Step, type StoryHeroineId } from '../lib/story/types';
import type { BotThought, DecisionReview, ObjectiveProgressView, StoryHoldReason, StoryLiveView, StoryQuizRequest, StoryQuizReceipt, ObservationNote } from '../lib/story/views';
import { eventLog } from './event-log';
import type { RoomDisposeReason, RoomManager, StoryRoomHooks } from './room-manager';

export type LiveStep = Extract<Step, { kind: 'practice-table' | 'sparring' }>;

/** 라이브 스텝 종료 사유(이벤트 로그 전용) — 'objectives'는 미션형 조기 종료 */
export type LiveFinishReason = 'objectives' | 'max-hands' | 'table-short' | 'bust' | 'scripts' | 'operator-skip';

export interface LiveStepSummary {
  outcome: 'done' | 'failed' | 'abandoned';
  tag: '연습' | '대결';
  objectives: ObjectiveProgressView[];
  /** '연습' 스텝은 목표가 없으므로 null */
  primaryObjectivesMet: boolean | null;
  /** 등급 산정용 0~1 ('연습'은 null) */
  liveScore: number | null;
  handsPlayed: number;
  netBB: number;
}

export interface LiveEnterInput {
  profileId: string;
  runId: string;
  chapterId: string;
  chapterTitle: string;
  stepIndex: number;
  step: LiveStep;
  partnerId: StoryHeroineId | null;
  /**
   * 좌석별 **표시 identity 덮어쓰기**(가면) — 실제 성향은 라인업이 그대로 결정하고 얼굴만 바꾼다.
   * 생략한 좌석은 실제 캐릭터를 그대로 보여준다.
   */
  botDisplaysBySeat?: Readonly<Record<number, BotDisplayIdentity>>;
}

/** 소켓 계층이 구현 — 히어로 Player 생성·좌석 착석·room-joined 통지 */
export interface StoryLiveHeroPort {
  isOnline?(profileId: string): boolean;
  /**
   * 히어로를 방에 앉힌다: Player 구성 → roomManager.joinRoom → 세션 roomId 교체·socket.join → room-joined.
   * live 소켓이 없거나 착석 실패면 false (어댑터가 방을 정리한다).
   */
  seatHero(profileId: string, roomId: string, seat: { seatIndex: number; chips: number }): boolean;
}

/** 코디네이터가 구현 — 어댑터 → 런 상태 머신 통지 */
export interface StoryLiveEvents {
  /** 라이브 스텝 종료(방은 이미 해체됨) — 다음 스텝으로 진행 */
  onStepFinished(profileId: string, runId: string, summary: LiveStepSummary): void;
  /** hold/재개/목표 진행 등 뷰 변경 — 코디네이터가 story-update를 다시 보낸다 */
  onLiveChanged(profileId: string): void;
}

export interface LiveTableAdapterOptions {
  shuffleMasquerade?: () => string[];
  roomManager: RoomManager;
  hero: StoryLiveHeroPort;
  now?: () => number;
  /** hold 상한 (기본 10분) — 초과 시 방 해체 + room-lost 보존 */
  holdTimeoutMs?: number;
  /** 마지막 핸드 종료 → 방 해체까지 지연 (승리 연출 ~5.5s 뒤, 기본 6초) */
  finishDelayMs?: number;
  /** hold 타임아웃 스윕 주기 (기본 30초) */
  sweepIntervalMs?: number;
  /** 봇 속마음 노출 (Phase 2 Ch7+ — MVP는 수집만, 기본 false) */
  exposeBotThoughts?: boolean;
  /** 프리셋 덱 팩토리 (테스트 주입용) */
  deckFactory?: () => ScenarioDeck;
}

export type LiveCommandResult =
  | { ok: true }
  | { ok: false; code: RealtimeErrorCode; message: string };

/**
 * 좌석별 identity 계획 — **서버 전용**. 런 하나에서 한 번만 확정하고, 방이 사라졌다 다시 열려도
 * 같은 계획을 재사용한다(재개마다 성향을 다시 뽑으면 가면 뒤 상대가 바뀐다).
 * 어떤 스냅샷·이벤트로도 내보내지 않는다.
 */
interface StoryBotIdentity {
  seatIndex: number;
  /** 실제 행동 캐릭터 (getPublicState가 제거하는 축) */
  personalityId: string;
  /** 가면 표시값 — null이면 실제 캐릭터를 그대로 보여준다 */
  maskedDisplay: BotDisplayIdentity | null;
  /** 공개된 좌석은 이후 열리는 방에서도 실제 얼굴로 앉는다 */
  revealed: boolean;
}

interface MasqueradeSession {
  phase: 'observing' | 'quiz' | 'feedback' | 'revealed-play';
  quiz: MasqueradeQuiz | null;
  timer: NodeJS.Timeout | null;
  notes: ObservationNote[];
  responses: { opportunities: number; correct: number };
  revealedHands: number;
}
interface LiveSession {
  masquerade: MasqueradeSession | null;
  lastRecordedHand: string | null;
  profileId: string;
  runId: string;
  chapterId: string;
  chapterTitle: string;
  stepIndex: number;
  step: LiveStep;
  partnerId: StoryHeroineId | null;
  /** 진입 입력의 복사본 — 호출자가 나중에 손대도 세션 계획이 흔들리지 않는다 */
  botDisplaysBySeat: Record<number, BotDisplayIdentity> | undefined;
  /** openRoom이 최초 1회 확정 (재개 시 재사용) */
  botIdentities: StoryBotIdentity[] | null;
  roomId: string | null;
  deck: ScenarioDeck | null;
  /** 다음에 arm할 스크립트 index ('연습') */
  scriptCursor: number;
  /** 히어로가 딜인된 채 끝난 핸드 수 */
  handsPlayed: number;
  heroStartChips: number;
  netChips: number;
  tally: ObjectiveTally;
  lastReview: DecisionReview | null;
  botThoughts: BotThought[];
  firedInterrupts: Set<string>;
  hold: boolean;
  holdReason: StoryHoldReason | null;
  holdSince: number | null;
  interruptId: string | null;
  finishTimer: NodeJS.Timeout | null;
  /** 어댑터 자신이 dispose 중(story-end) — onRoomDisposed에서 room-lost로 오인하지 않게 */
  disposing: boolean;
}

const DEFAULT_HOLD_TIMEOUT_MS = 10 * 60_000;
const DEFAULT_FINISH_DELAY_MS = 6_000;
/** 종료 시 방 해체가 거절됐을 때(정산 미해결) 재시도 간격 */
const FINISH_RETRY_MS = 10_000;
const DEFAULT_SWEEP_INTERVAL_MS = 30_000;
const BOT_THOUGHT_KEEP = 6;

/** 진입 입력의 표시 덮어쓰기를 깊이 복사 — 호출자가 들고 있는 객체를 세션이 공유하지 않는다 */
function copyBotDisplays(
  input: Readonly<Record<number, BotDisplayIdentity>> | undefined,
): Record<number, BotDisplayIdentity> | undefined {
  if (!input) return undefined;
  const copy: Record<number, BotDisplayIdentity> = {};
  for (const [seat, display] of Object.entries(input)) {
    const seatIndex = Number(seat);
    if (!Number.isInteger(seatIndex)) continue;
    copy[seatIndex] = { name: display.name, characterId: display.characterId };
  }
  return copy;
}

export class LiveTableAdapter implements StoryRoomHooks {
  private readonly sessions = new Map<string, LiveSession>();
  private readonly byRoom = new Map<string, LiveSession>();
  private events: StoryLiveEvents | null = null;
  private readonly now: () => number;
  private readonly holdTimeoutMs: number;
  private readonly finishDelayMs: number;
  private readonly exposeBotThoughts: boolean;
  private readonly deckFactory: () => ScenarioDeck;
  private sweepTimer: NodeJS.Timeout | null = null;

  constructor(private readonly options: LiveTableAdapterOptions) {
    this.now = options.now ?? (() => Date.now());
    this.holdTimeoutMs = options.holdTimeoutMs ?? DEFAULT_HOLD_TIMEOUT_MS;
    this.finishDelayMs = options.finishDelayMs ?? DEFAULT_FINISH_DELAY_MS;
    this.exposeBotThoughts = options.exposeBotThoughts ?? false;
    this.deckFactory = options.deckFactory ?? (() => new ScenarioDeck());
    const sweepMs = options.sweepIntervalMs ?? DEFAULT_SWEEP_INTERVAL_MS;
    if (sweepMs > 0) {
      this.sweepTimer = setInterval(() => this.sweepHolds(), sweepMs);
      this.sweepTimer.unref?.();
    }
  }

  /** 코디네이터 연결 (순환 참조 회피 — 생성 후 바인딩) */
  bindEvents(events: StoryLiveEvents): void {
    this.events = events;
  }

  // ---------------------------------------------------------------------------
  // 코디네이터 → 어댑터 명령

  /**
   * 라이브 스텝 진입: 방 생성(hold 선세팅) → 라인업 착석 → 히어로 착석(room-joined) → hold 해제·첫 핸드 예약.
   * 같은 프로필의 세션이 room-lost 상태로 남아 있으면 집계를 이어받는다(「이어하기」).
   */
  enter(input: LiveEnterInput): 'entered' | 'unavailable' {
    const existing = this.sessions.get(input.profileId);
    if (existing?.roomId) {
      // 이미 방이 살아 있는 세션 — 중복 진입 금지 (재접속은 resend/restore 경로)
      return 'entered';
    }
    const session: LiveSession = existing && existing.runId === input.runId && existing.stepIndex === input.stepIndex
      ? existing
      : this.freshSession(input);
    this.sessions.set(input.profileId, session);
    if (!this.openRoom(session)) {
      // 방을 열지 못했다(히어로 소켓 없음·착석 실패 등). 스텝을 **건너뛰지 않고** room-lost hold로 보존해
      // 「이어하기」(resume)가 다시 연다 — 스파링을 건너뛰면 primary 목표 없이 챕터가 통과될 수 있다.
      this.markRoomLost(session, false);
    }
    return 'entered';
  }

  /** [계속하기]/「이어하기」 — hold 해제 후 다음 핸드 예약, 방이 없으면(room-lost) 새 방으로 재개 */
  resume(profileId: string, runId: string): LiveCommandResult {
    const session = this.sessions.get(profileId);
    if (!session || session.runId !== runId) {
      return { ok: false, code: 'stale-state', message: '이미 끝난 테이블 스텝이에요.' };
    }
    if (session.finishTimer) {
      return { ok: false, code: 'action-rejected', message: '결과를 정리하는 중이에요.' };
    }
    if (!session.roomId) {
      if (!this.openRoom(session)) {
        return { ok: false, code: 'server-error', message: '테이블을 다시 열지 못했어요. 잠시 후 다시 시도해 주세요.' };
      }
      if (!session.masquerade || session.masquerade.phase === 'observing' || session.masquerade.phase === 'revealed-play') return { ok: true };
    }
    if (session.masquerade && ['quiz', 'feedback'].includes(session.masquerade.phase)) {
      return this.resumeQuiz(session);
    }
    if (!session.hold) {
      return { ok: false, code: 'action-rejected', message: '지금은 진행 중이에요.' };
    }
    this.clearHold(session);
    this.options.roomManager.resumeRoom(session.roomId!);
    this.events?.onLiveChanged(profileId);
    return { ok: true };
  }

  /**
   * 포기/런 종료 — 방을 즉시 해체하고 세션을 버린다 (코디네이터 통지 없음).
   * 방을 닫을 수 없으면(정산 미해결 재시도 중) false — 세션·방 소유권을 유지해 고아 방을 만들지 않는다.
   */
  abandon(profileId: string): boolean {
    const session = this.sessions.get(profileId);
    if (!session) return true;
    return this.dropSession(session);
  }

  hasSession(profileId: string): boolean {
    return this.sessions.has(profileId);
  }

  /**
   * 운영자 스킵 — 현재 라이브 스텝을 "목표 전부 달성(done)"으로 즉시 끝낸다. 방이 있으면 해체(story-end)하고
   * 세션을 버린 뒤 onStepFinished를 **동기** 호출한다(승리 연출 대기·finish 타이머 무시). 정산 미해결로 방을 닫지
   * 못하면 'busy' — 세션·방 소유권은 그대로 둔다. 방이 이미 사라진 room-lost 보존 세션도 그대로 끝낸다.
   */
  forceFinish(profileId: string): 'finished' | 'no-session' | 'busy' {
    const session = this.sessions.get(profileId);
    if (!session) return 'no-session';
    const summary = this.summarizeForced(session);
    if (!this.disposeOwnRoom(session, 'story-end')) return 'busy';
    this.clearQuizTimer(session);
    this.clearFinishTimer(session);
    this.sessions.delete(session.profileId);
    const reason: LiveFinishReason = 'operator-skip';
    eventLog.log('story-step', {
      playerId: session.profileId,
      data: { runId: session.runId, event: 'live-finish', outcome: 'done', reason, handsPlayed: summary.handsPlayed, netBB: summary.netBB },
    });
    this.events?.onStepFinished(session.profileId, session.runId, summary);
    return 'finished';
  }

  /**
   * 가면 벗기기 — **서버 전용 seam**(소켓 이벤트 없음). 호출자는 좌석만 지목하고 실제 캐릭터는
   * 서버 계획에서만 나온다(클라가 정체를 제출할 수 없다). 방이 있으면 그 자리에서 얼굴을 바꾸고,
   * 방이 없으면 계획에만 남겨 다음 재개 방이 실제 얼굴로 앉는다. 좌석 id·성향은 절대 바꾸지 않는다.
   */
  revealBotIdentity(profileId: string, runId: string, seatIndex: number): LiveCommandResult {
    const session = this.sessions.get(profileId);
    if (!session || session.runId !== runId) {
      return { ok: false, code: 'stale-state', message: '이미 끝난 테이블 스텝이에요.' };
    }
    const identity = session.botIdentities?.find(candidate => candidate.seatIndex === seatIndex);
    // 가면·딜러는 얼굴일 뿐 공개할 정체가 아니다
    const actual = identity ? getCharacterById(identity.personalityId) : undefined;
    if (!identity || !actual || actual.id === DEALER_CHARACTER.id || actual.id === MASKED_BOT_CHARACTER.id) {
      return { ok: false, code: 'action-rejected', message: '공개할 봇 좌석을 찾지 못했어요.' };
    }
    if (identity.revealed) return { ok: true };

    let botId: string | null = null;
    if (session.roomId) {
      // 좌석 + 성향으로 찾는다 — 공개 id는 불투명하므로 좌석만으로는 다른 봇을 건드릴 수 있다
      const bot = this.options.roomManager.getRoom(session.roomId)?.engine.state.players.find(player => (
        player.seatIndex === seatIndex
        && player.type === 'bot'
        && player.personalityId === identity.personalityId
        && !player.pendingRemoval
      ));
      if (!bot) {
        return { ok: false, code: 'action-rejected', message: '공개할 봇 좌석을 찾지 못했어요.' };
      }
      botId = bot.id;
    }

    identity.revealed = true;
    if (session.roomId && botId && !this.options.roomManager.updateStoryBotDisplayIdentity(
      session.roomId,
      botId,
      { name: actual.name, characterId: actual.id },
    )) {
      // 방 갱신이 거절되면 계획도 되돌린다 — 좌석은 가면, 계획은 공개인 반쪽 상태를 남기지 않는다
      identity.revealed = false;
      return { ok: false, code: 'action-rejected', message: '봇 정체를 공개하지 못했어요.' };
    }
    this.events?.onLiveChanged(profileId);
    return { ok: true };
  }

  answerQuiz(profileId: string, request: StoryQuizRequest): LiveCommandResult & { receipt?: StoryQuizReceipt } {
    const session = this.sessions.get(profileId);
    if (!session || session.runId !== request.runId || !session.masquerade?.quiz) return { ok: false, code: 'stale-state', message: '현재 수련의 질문이 아니에요.' };
    const pendingId = session.masquerade.quiz.pending()?.quizId;
    const receipt = session.masquerade.quiz.answer(request.quizId, request.optionIndex, this.now());
    if (!receipt) return { ok: false, code: 'action-rejected', message: '이 질문에 없는 선택지예요.' };
    if (pendingId === request.quizId) { this.clearQuizTimer(session); this.afterQuizAnswer(session); }
    return { ok: true, receipt };
  }

  private online(session: LiveSession): boolean {
    if (this.options.hero.isOnline) return this.options.hero.isOnline(session.profileId);
    return !!session.roomId && this.options.roomManager.getRoom(session.roomId)?.engine.state.players.some(p => p.id === session.profileId && !p.isDisconnected) === true;
  }

  private clearQuizTimer(session: LiveSession): void {
    if (session.masquerade?.timer) clearTimeout(session.masquerade.timer);
    if (session.masquerade) session.masquerade.timer = null;
  }

  private issueQuiz(session: LiveSession): void {
    const mask = session.masquerade;
    if (!mask?.quiz || !this.online(session) || !session.roomId || mask.phase !== 'quiz') return;
    const question = mask.quiz.issue(this.now());
    if (!question) return;
    this.clearQuizTimer(session);
    mask.timer = setTimeout(() => {
      mask.timer = null;
      if (!this.sessions.has(session.profileId)) return;
      mask.quiz!.answer(question.quizId, null, this.now());
      this.afterQuizAnswer(session);
    }, Math.max(0, question.expiresAt - this.now()));
    this.events?.onLiveChanged(session.profileId);
  }

  private afterQuizAnswer(session: LiveSession): void {
    const mask = session.masquerade!;
    if (mask.quiz!.counts().answered === 4) {
      mask.phase = 'feedback';
      this.setHold(session, 'quiz');
      // Every answer is already locked before any identity mutation/broadcast.
      for (const identity of session.botIdentities ?? []) this.revealBotIdentity(session.profileId, session.runId, identity.seatIndex);
    } else if (this.online(session)) this.issueQuiz(session);
    this.events?.onLiveChanged(session.profileId);
  }

  private resumeQuiz(session: LiveSession): LiveCommandResult {
    const mask = session.masquerade!;
    if (!this.online(session)) return { ok: false, code: 'action-rejected', message: '다시 연결한 뒤 계속해 주세요.' };
    if (mask.phase === 'feedback') {
      if (mask.quiz?.counts().answered !== 4) return { ok: false, code: 'action-rejected', message: '네 질문을 모두 마쳐야 해요.' };
      for (const identity of session.botIdentities ?? []) {
        const revealed = this.revealBotIdentity(session.profileId, session.runId, identity.seatIndex);
        if (!revealed.ok) return revealed;
      }
      mask.phase = 'revealed-play';
      this.clearHold(session);
      this.options.roomManager.resumeRoom(session.roomId!);
    } else {
      if (mask.quiz?.pending()) return { ok: false, code: 'action-rejected', message: '먼저 질문에 답해 주세요.' };
      this.issueQuiz(session);
    }
    this.events?.onLiveChanged(session.profileId);
    return { ok: true };
  }

  private observeHand(session: LiveSession, record: CompletedHandRecord): void {
    const raised = new Set<string>();
    const called = new Set<string>();
    let maxBet = 0;
    for (const action of record.actions.filter(action => action.street === 'preflop')) {
      if (action.kind === 'call') called.add(action.playerId);
      if (action.kind === 'raise' || action.kind === 'all-in') {
        (action.amount > maxBet ? raised : called).add(action.playerId);
        maxBet = Math.max(maxBet, action.amount);
      } else if (action.kind === 'post-sb' || action.kind === 'post-bb') {
        maxBet = Math.max(maxBet, action.amount);
      }
    }
    for (const note of session.masquerade!.notes) {
      const player = record.players.find(p => p.seatIndex === note.seatIndex);
      if (!player) continue;
      note.hands++;
      if (raised.has(player.id) || called.has(player.id)) note.entered++;
      if (raised.has(player.id)) note.raised++;
      if (called.has(player.id)) note.called++;
    }
  }

  phase(profileId: string): 'live-hold' | 'live-play' | null {
    const session = this.sessions.get(profileId);
    if (!session) return null;
    return session.hold || !session.roomId ? 'live-hold' : 'live-play';
  }

  view(profileId: string): StoryLiveView | null {
    const session = this.sessions.get(profileId);
    if (!session) return null;
    return {
      roomId: session.roomId,
      tag: session.step.tag,
      hold: session.hold || !session.roomId,
      holdReason: session.masquerade && ['quiz', 'feedback'].includes(session.masquerade.phase) ? 'quiz' : !session.roomId ? 'room-lost' : session.holdReason,
      interruptId: session.interruptId,
      objectives: this.objectiveViews(session),
      handsPlayed: session.handsPlayed,
      maxHands: this.maxHands(session),
      minHands: session.step.kind === 'sparring' ? (session.step.minHands ?? null) : null,
      lastReview: session.lastReview,
      botThoughts: this.exposeBotThoughts && !session.masquerade ? [...session.botThoughts] : [],
      pendingQuiz: session.masquerade?.quiz?.pending() ?? null,
      ...(session.masquerade ? { masquerade: { phase: session.masquerade.phase, notes: session.masquerade.notes.map(n => ({ ...n })),
        feedback: session.masquerade.phase === 'feedback' || session.masquerade.phase === 'revealed-play' ? session.masquerade.quiz?.feedback() ?? null : null,
        answered: session.masquerade.quiz?.counts().answered ?? 0, required: 4 as const } } : {}),
    };
  }

  stats(): { sessions: number; rooms: number; holds: number } {
    let holds = 0;
    for (const session of this.sessions.values()) if (session.hold) holds += 1;
    return { sessions: this.sessions.size, rooms: this.byRoom.size, holds };
  }

  shutdown(): void {
    if (this.sweepTimer) {
      clearInterval(this.sweepTimer);
      this.sweepTimer = null;
    }
    for (const session of [...this.sessions.values()]) {
      this.clearQuizTimer(session);
      this.clearFinishTimer(session);
      // 종료 시엔 해체 실패(정산 미해결)를 따지지 않는다 — RoomManager.shutdown이 나머지를 정리한다
      this.disposeOwnRoom(session, 'story-end');
    }
    this.sessions.clear();
    this.byRoom.clear();
  }

  // ---------------------------------------------------------------------------
  // StoryRoomHooks (RoomManager → 어댑터)

  isHeld(roomId: string): boolean {
    const session = this.byRoom.get(roomId);
    return !!session && (session.hold || session.finishTimer !== null);
  }

  beforeHand(roomId: string, engine: PokerEngine): 'deal' | 'hold' {
    const session = this.byRoom.get(roomId);
    if (!session) return 'deal';
    if (session.finishTimer || (session.masquerade && ['quiz', 'feedback'].includes(session.masquerade.phase))) return 'hold';
    const state = engine.state;
    const hero = state.players.find(p => p.id === session.profileId);
    if (!hero || hero.pendingRemoval) return 'hold'; // 히어로 이탈 — leave 경로가 방을 정리한다

    if (hero.isDisconnected) {
      this.setHold(session, 'timeout');
      return 'hold';
    }
    if (hero.sitOutNext) {
      // 턴 타임아웃 자동 마킹(sitOutAuto) 해제 — 다음 핸드 딜아웃·봇끼리 진행을 막고 [계속하기]를 기다린다
      hero.sitOutNext = false;
      hero.sitOutAuto = undefined;
      hero.sitOutSinceHand = undefined;
      hero.sitOutSinceMs = undefined;
      if (hero.chips > 0 && hero.status === 'sitting-out') hero.status = 'waiting';
      this.setHold(session, 'timeout');
      return 'hold';
    }

    if (session.step.kind === 'practice-table') {
      if (session.scriptCursor >= session.step.scripts.length) {
        this.finish(session, 'done', 'scripts');
        return 'hold';
      }
      // 프리셋 핸드는 매번 같은 스택에서 — 히어로·봇 전원 스펙 스택으로 보정 (핸드 사이만, 엔진 무수정)
      this.refillPracticeStacks(session, state.players);
      // 프리셋을 깔 수 없으면 랜덤 딜로 스크립트를 소비하지 않는다 — 방을 닫고 room-lost 보존(이어하기가 재시도)
      if (!this.armScript(session, state.players)) return 'hold';
      return 'deal';
    }

    // 스파링: 히어로 파산은 실패, 상대 전멸은 완주
    if (hero.chips <= 0) {
      this.finish(session, 'failed', 'bust');
      return 'hold';
    }
    const funded = state.players.filter(p => !p.pendingRemoval && p.chips > 0);
    if (funded.length < 2) {
      this.finish(session, 'done', 'table-short');
      return 'hold';
    }
    return 'deal';
  }

  skipHandProgression(roomId: string): boolean {
    const session = this.byRoom.get(roomId);
    return session?.step.kind === 'practice-table';
  }

  onHandComplete(roomId: string): 'continue' | 'hold' | 'gone' {
    const session = this.byRoom.get(roomId);
    if (!session) return 'continue';
    const room = this.options.roomManager.getRoom(roomId);
    if (!room) return 'gone';
    const state = room.engine.state;
    const hero = state.players.find(p => p.id === session.profileId);
    // 히어로가 떠나는 중인 핸드(grace 만료·abandon)는 집계하지 않는다 — 방은 곧 해체된다
    if (!hero || hero.pendingRemoval) return 'continue';

    const record = room.engine.getCompletedHandRecord();
    const recordKey = `${roomId}:${state.handNumber}`;
    if (record && session.lastRecordedHand === recordKey) return session.hold ? 'hold' : 'continue';
    if (record) session.lastRecordedHand = recordKey;
    let facts: ReturnType<typeof deriveHeroHandFacts> | null = null;
    if (record && record.handNumber === state.handNumber) {
      facts = deriveHeroHandFacts(record, session.profileId);
      if (facts.dealtIn) {
        session.handsPlayed += 1;
        if (session.step.kind === 'practice-table') {
          session.scriptCursor = Math.min(session.step.scripts.length, session.scriptCursor + 1);
        } else {
          session.tally = addHand(session.tally, facts);
          session.lastReview = reviewHand(record, session.profileId);
          if (session.masquerade?.phase === 'observing') this.observeHand(session, record);
          if (session.masquerade?.phase === 'revealed-play') {
            session.masquerade.revealedHands++;
            const verdicts = reviewOpponentResponses(record, session.profileId, session.botIdentities ?? []);
            session.masquerade.responses.opportunities += verdicts.length;
            session.masquerade.responses.correct += verdicts.filter(v => v.mark === 'good').length;
            session.lastReview = { handNumber: record.handNumber, verdicts };
          }
        }
      }
    }
    session.netChips = hero.chips - session.heroStartChips;

    // 종료 판정
    if (session.step.kind === 'sparring' && hero.chips <= 0) {
      this.finish(session, 'failed', 'bust');
      return 'hold';
    }
    if (session.step.kind === 'practice-table' && session.scriptCursor >= session.step.scripts.length) {
      this.finish(session, 'done', 'scripts');
      return 'hold';
    }
    if (session.step.kind === 'sparring') {
      const mask = session.masquerade;
      if (mask?.phase === 'observing' && session.handsPlayed >= session.step.table.masquerade!.observeHands) {
        mask.phase = 'quiz';
        this.setHold(session, 'quiz');
        this.issueQuiz(session);
        return 'hold';
      }
      if (mask && ['quiz', 'feedback'].includes(mask.phase)) return 'hold';
      if (session.handsPlayed >= session.step.maxHands) {
        this.finish(session, 'done', 'max-hands');
        return 'hold';
      }
      // 미션형 조기 종료 — primary 목표를 전부 채웠으면 minHands부터 끝낸다 ("N핸드 채우기"가 아니라 "목표를 채우면 끝")
      if (session.step.minHands !== undefined
        && session.handsPlayed >= session.step.minHands
        && (!mask || (mask.phase === 'revealed-play' && mask.revealedHands >= session.step.table.masquerade!.revealedMinHands && mask.responses.opportunities >= 2))
        && primaryObjectivesAllAchieved(this.objectiveViews(session))) {
        this.finish(session, 'done', 'objectives');
        return 'hold';
      }
      const funded = state.players.filter(p => !p.pendingRemoval && p.chips > 0);
      if (funded.length < 2) {
        this.finish(session, 'done', 'table-short');
        return 'hold';
      }
      // 인터럽트 — 핸드 종료 시점 트리거만 서버가 hold한다 (first-my-turn은 클라 연출, 턴 타이머 안에서)
      const due = session.step.interrupts.find(interrupt => (
        !session.firedInterrupts.has(interrupt.id)
        && this.interruptDue(interrupt, session, record, facts?.dealtIn ?? false)
      ));
      if (due) {
        session.firedInterrupts.add(due.id);
        session.interruptId = due.id;
        this.setHold(session, 'scene');
        return 'hold';
      }
    }
    this.events?.onLiveChanged(session.profileId);
    return 'continue';
  }

  onBotActed(
    _roomId: string,
    playerId: string,
    decision: BotDecision,
    explanation?: { code: string; text: string },
  ): void {
    const session = this.byRoom.get(_roomId);
    if (!session || !explanation || session.masquerade) return;
    const room = this.options.roomManager.getRoom(_roomId);
    const bot = room?.engine.state.players.find(p => p.id === playerId);
    if (!room || !bot) return;
    session.botThoughts.push({
      handNumber: room.engine.state.handNumber,
      playerId,
      // 발화 시점의 **표시 얼굴**을 값으로 스냅샷한다 — 성향을 실으면 가면 봇의 정체가 뷰로 샌다
      characterId: bot.avatar,
      street: room.engine.state.street,
      action: decision.action,
      reason: explanation.code,
      text: explanation.text,
    });
    if (session.botThoughts.length > BOT_THOUGHT_KEEP) {
      session.botThoughts.splice(0, session.botThoughts.length - BOT_THOUGHT_KEEP);
    }
  }

  onPlayerLeave(roomId: string, playerId: string): void {
    const session = this.byRoom.get(roomId);
    if (!session || playerId !== session.profileId) return;
    eventLog.log('story-step', {
      roomId,
      playerId,
      data: { runId: session.runId, event: 'hero-left', handsPlayed: session.handsPlayed },
    });
    // 좌석이 빠지면 RoomManager가 빈 방을 즉시 dispose → onRoomDisposed가 room-lost 보존으로 전환
  }

  onRoomDisposed(roomId: string, reason: RoomDisposeReason): void {
    const session = this.byRoom.get(roomId);
    if (!session) return;
    this.byRoom.delete(roomId);
    if (session.disposing) return; // 자체 해체(story-end/idle) 중 — 후속 처리는 호출부(finish/dropSession/abort)가 담당
    if (reason === 'shutdown') {
      this.clearQuizTimer(session);
      this.clearFinishTimer(session);
      this.sessions.delete(session.profileId);
      return;
    }
    // grace 만료 회수·유휴 정리·hold 타임아웃 — 집계를 보존한 채 room-lost hold로 전환
    this.markRoomLost(session, true);
  }

  // ---------------------------------------------------------------------------
  // 내부

  private freshSession(input: LiveEnterInput): LiveSession {
    return {
      lastRecordedHand: null,
      masquerade: input.step.table.masquerade ? { phase: 'observing', quiz: null, timer: null, responses: { opportunities: 0, correct: 0 }, revealedHands: 0,
        notes: input.step.table.masquerade.seats.map(seatIndex => ({ seatIndex, hands: 0, entered: 0, raised: 0, called: 0 })) } : null,
      profileId: input.profileId,
      runId: input.runId,
      chapterId: input.chapterId,
      chapterTitle: input.chapterTitle,
      stepIndex: input.stepIndex,
      step: input.step,
      partnerId: input.partnerId,
      botDisplaysBySeat: copyBotDisplays(input.botDisplaysBySeat),
      botIdentities: null,
      roomId: null,
      deck: null,
      scriptCursor: 0,
      handsPlayed: 0,
      heroStartChips: input.step.table.heroStackBB * input.step.table.blinds.big,
      netChips: 0,
      tally: emptyTally(),
      lastReview: null,
      botThoughts: [],
      firedInterrupts: new Set(),
      hold: false,
      holdReason: null,
      holdSince: null,
      interruptId: null,
      finishTimer: null,
      disposing: false,
    };
  }

  /** 방 생성 → 라인업 → 히어로 착석 → hold 해제. 실패 시 방을 정리하고 false */
  private openRoom(session: LiveSession): boolean {
    const { step } = session;
    const table = step.table;
    const big = table.blinds.big;
    const heroChips = table.heroStackBB * big;
    const config: RoomConfig = {
      name: `수련 · ${session.chapterTitle}`,
      smallBlind: table.blinds.small,
      bigBlind: big,
      minBuyIn: heroChips,
      maxBuyIn: heroChips,
      maxPlayers: 6,
      economyMode: 'practice',
      turnTime: table.turnTimeSec,
      gameMode: 'cash',
      difficulty: table.difficulty,
      botCount: 0,
      tableType: 'bots',
      storyChapterId: session.chapterId,
      storyRunId: session.runId,
      storyHandTag: step.kind === 'practice-table' ? 'practice' : 'sparring',
      botThinkScale: table.botThinkScale,
    };
    // identity 계획은 방보다 먼저 확정한다 — 잘못된 표시 입력이면 방을 아예 만들지 않는다(원자적 거절).
    const identities = session.botIdentities ?? this.buildBotIdentityPlan(session);
    if (!identities) {
      eventLog.log('story-step', {
        playerId: session.profileId,
        data: { runId: session.runId, event: 'lineup-failed', reason: 'invalid-identity-plan' },
      });
      return false;
    }
    session.botIdentities = identities;

    const deck = step.kind === 'practice-table' ? this.deckFactory() : undefined;
    let roomId: string;
    try {
      roomId = this.options.roomManager.createRoom(config, false, undefined, deck);
    } catch {
      return false;
    }
    session.roomId = roomId;
    session.deck = deck ?? null;
    // 재개(room-lost 후)면 새 방의 히어로 스택은 마지막 스택을 이어받는다 — 스파링 netBB 연속성
    const heroSeatChips = step.kind === 'sparring' && session.handsPlayed > 0
      ? Math.max(big, session.heroStartChips + session.netChips)
      : heroChips;
    // hold를 좌석 채우기 전에 — joinRoom이 tryStartGame을 부르므로 착석 중 핸드가 시작되면 안 된다
    session.hold = true;
    session.holdReason = null;
    session.holdSince = this.now();
    session.interruptId = null;
    session.disposing = false;
    this.byRoom.set(roomId, session);

    const stackBySeat = new Map(table.lineup.map(seat => [seat.seatIndex, seat.stackBB * big]));
    for (const identity of identities) {
      // 이미 공개된 좌석은 실제 캐릭터로(표시 덮어쓰기 없이) 앉는다 — 공개는 새 방에도 이어진다
      const display = identity.revealed ? undefined : identity.maskedDisplay ?? undefined;
      const stack = stackBySeat.get(identity.seatIndex);
      const bot = stack === undefined
        ? null
        : createBotWithCharacter(identity.seatIndex, stack, identity.personalityId, table.difficulty, display);
      if (!bot || !this.options.roomManager.joinRoom(roomId, bot)) {
        // 라인업은 전원 착석이 전제 — 한 좌석이라도 빠지면 스크립트 villain 좌석·목표 상대가 어긋나므로 방을 열지 않는다
        eventLog.log('story-step', {
          roomId,
          playerId: session.profileId,
          data: { runId: session.runId, event: 'lineup-failed', seat: identity.seatIndex },
        });
        this.disposeOwnRoom(session, 'story-end');
        return false;
      }
    }
    if (!this.options.hero.seatHero(session.profileId, roomId, { seatIndex: table.heroSeat, chips: heroSeatChips })) {
      this.disposeOwnRoom(session, 'story-end');
      return false;
    }
    eventLog.log('story-step', {
      roomId,
      playerId: session.profileId,
      data: { runId: session.runId, event: 'live-enter', step: step.id, tag: step.tag, handsPlayed: session.handsPlayed },
    });
    if (session.masquerade && ['quiz', 'feedback'].includes(session.masquerade.phase)) {
      this.setHold(session, 'quiz');
    } else {
      this.clearHold(session);
      this.options.roomManager.resumeRoom(roomId);
    }
    return true;
  }

  /**
   * 좌석별 실제 성향 + 가면 표시를 **한 번만** 확정한다. 좌석 하나라도 실제 캐릭터를 못 정하거나
   * 표시 덮어쓰기가 부적합하면(빈 이름·미등록 캐릭터) null — 호출부가 방을 만들기 전에 거절한다.
   */
  private buildBotIdentityPlan(session: LiveSession): StoryBotIdentity[] | null {
    if (session.step.table.masquerade) {
      const pool = (this.options.shuffleMasquerade ?? shuffledMasqueradePool)();
      const plan = session.step.table.masquerade.seats.map((seatIndex, i) => ({ seatIndex, personalityId: pool[i],
        maskedDisplay: { name: `가면 ${String.fromCharCode(65 + i)}`, characterId: MASKED_BOT_CHARACTER.id }, revealed: false }));
      session.masquerade!.quiz = new MasqueradeQuiz(plan);
      return plan;
    }
    const refs = session.step.table.lineup.map(seat => seat.characterId);
    const used = new Set<string>();
    const plan: StoryBotIdentity[] = [];

    for (const seat of session.step.table.lineup) {
      const personalityId = this.resolveLineupCharacter(seat.characterId, session.partnerId, refs, used);
      const display = session.botDisplaysBySeat?.[seat.seatIndex];
      if (
        !personalityId
        || (display && (!display.name.trim() || !getCharacterById(display.characterId)))
      ) return null;
      plan.push({
        seatIndex: seat.seatIndex,
        personalityId,
        maskedDisplay: display ? { name: display.name.trim(), characterId: display.characterId } : null,
        revealed: false,
      });
      used.add(personalityId);
    }
    return plan;
  }

  /** 'partner' → 선택 파트너(없거나 라인업에 이미 있으면 다른 히로인), 그 외는 캐릭터 id 그대로 */
  private resolveLineupCharacter(
    ref: string,
    partnerId: StoryHeroineId | null,
    lineupRefs: readonly string[],
    used: ReadonlySet<string>,
  ): string | null {
    if (ref !== 'partner') return used.has(ref) ? null : ref;
    const taken = new Set([...lineupRefs.filter(r => r !== 'partner'), ...used]);
    if (partnerId && !taken.has(partnerId)) return partnerId;
    return STORY_HEROINE_IDS.find(id => !taken.has(id)) ?? null;
  }

  private refillPracticeStacks(session: LiveSession, players: Player[]): void {
    const table = session.step.table;
    const big = table.blinds.big;
    const specBySeat = new Map<number, number>(table.lineup.map(seat => [seat.seatIndex, seat.stackBB * big]));
    specBySeat.set(table.heroSeat, table.heroStackBB * big);
    for (const player of players) {
      if (player.pendingRemoval) continue;
      const target = specBySeat.get(player.seatIndex);
      if (target === undefined) continue;
      player.chips = target;
      if (player.type === 'bot') {
        player.sitOutNext = false;
        if (player.status === 'sitting-out') player.status = 'waiting';
      }
    }
  }

  /** 다음 스크립트를 덱에 arm. 실패하면 방을 닫고 room-lost 보존으로 전환한 뒤 false (랜덤 딜로 스크립트를 소비하지 않는다) */
  private armScript(session: LiveSession, players: Player[]): boolean {
    if (session.step.kind !== 'practice-table' || !session.deck) return true;
    const script = session.step.scripts[session.scriptCursor];
    if (!script) return true;
    // 엔진 딜인 규칙과 동일: pendingRemoval 제외·칩>0·끊김/자리비움 아님, seatIndex 오름차순 (startHand의 배열 정렬)
    const dealtSeatOrder = players
      .filter(p => !p.pendingRemoval && p.chips > 0 && !p.isDisconnected && !p.sitOutNext)
      .map(p => p.seatIndex)
      .sort((a, b) => a - b);
    try {
      session.deck.arm({ script, dealtSeatOrder, heroSeat: session.step.table.heroSeat });
      return true;
    } catch (error) {
      // 스크립트 불량(중복 카드 등)은 챕터 검증이 막는다 — 런타임 좌석 구성 불일치는 방을 닫고 이어하기로 재시도
      session.deck.disarm();
      eventLog.log('story-step', {
        roomId: session.roomId ?? undefined,
        playerId: session.profileId,
        data: {
          runId: session.runId,
          event: 'script-arm-failed',
          script: session.scriptCursor,
          reason: error instanceof ScenarioDeckError ? error.message : 'unknown',
        },
      });
      this.abortToRoomLost(session);
      return false;
    }
  }

  /** 진행 불가 상황에서 방을 닫고 room-lost hold로 보존 — 닫을 수 없으면(정산 미해결) [계속하기] hold로 대기 */
  private abortToRoomLost(session: LiveSession): void {
    if (!session.roomId) return;
    this.clearFinishTimer(session);
    if (!this.disposeOwnRoom(session, 'idle')) {
      this.setHold(session, 'timeout');
      return;
    }
    this.markRoomLost(session, true);
  }

  private markRoomLost(session: LiveSession, notify: boolean): void {
    this.clearFinishTimer(session);
    session.roomId = null;
    session.deck = null;
    session.hold = true;
    session.holdReason = 'room-lost';
    session.holdSince = null;
    session.interruptId = null;
    if (notify) this.events?.onLiveChanged(session.profileId);
  }

  private interruptDue(
    interrupt: Interrupt,
    session: LiveSession,
    record: CompletedHandRecord | null,
    heroDealt: boolean,
  ): boolean {
    const trigger = interrupt.trigger;
    switch (trigger.kind) {
      case 'hand-index':
        // 0-based: index번째 핸드가 끝난 직후
        return heroDealt && session.handsPlayed === trigger.index + 1;
      case 'first-showdown':
        return heroDealt && !!record?.showdown;
      case 'halfway':
        // 미션형(minHands)이면 조기 종료 전에 들리도록 minHands 기준으로 반환점을 잡는다
        return session.step.kind === 'sparring'
          && heroDealt
          && session.handsPlayed === Math.ceil((session.step.minHands ?? session.step.maxHands) / 2);
      case 'first-my-turn':
        return false; // 클라이언트 연출 (턴 타이머 안에서) — 서버 hold 없음
      default:
        return false;
    }
  }

  private objectiveViews(session: LiveSession): ObjectiveProgressView[] {
    if (session.step.kind !== 'sparring') return [];
    const counts = session.masquerade?.quiz?.counts();
    return evaluateObjectives(session.step.objectives, session.tally, session.masquerade ? {
      quiz: counts ? { ...counts, correct: counts.answered === 4 ? counts.correct : 0 } : { issued: 0, answered: 0, correct: 0, required: 4 },
      opponentResponse: session.masquerade.responses,
    } : undefined);
  }

  private maxHands(session: LiveSession): number {
    return session.step.kind === 'sparring' ? session.step.maxHands : session.step.scripts.length;
  }

  private setHold(session: LiveSession, reason: StoryHoldReason): void {
    session.hold = true;
    session.holdReason = reason;
    session.holdSince = this.now();
    if (reason !== 'scene') session.interruptId = null;
    this.events?.onLiveChanged(session.profileId);
  }

  private clearHold(session: LiveSession): void {
    session.hold = false;
    session.holdReason = null;
    session.holdSince = null;
    session.interruptId = null;
  }

  /** 스텝 종료 예약 — 승리 연출이 끝난 뒤 방을 해체하고 코디네이터에 결과를 넘긴다 */
  private finish(session: LiveSession, outcome: 'done' | 'failed', reason: LiveFinishReason): void {
    if (session.finishTimer) return;
    this.clearQuizTimer(session);
    const summary = this.summarize(session, outcome);
    const complete = (): void => {
      session.finishTimer = null;
      if (!this.disposeOwnRoom(session, 'story-end')) {
        // 정산 미해결(progression 재시도 중)로 아직 닫을 수 없다 — isHeld(finishTimer)가 hold를 유지한 채 잠시 뒤 재시도
        session.finishTimer = setTimeout(complete, FINISH_RETRY_MS);
        return;
      }
      this.sessions.delete(session.profileId);
      eventLog.log('story-step', {
        playerId: session.profileId,
        data: { runId: session.runId, event: 'live-finish', outcome, reason, handsPlayed: summary.handsPlayed, netBB: summary.netBB },
      });
      this.events?.onStepFinished(session.profileId, session.runId, summary);
    };
    if (this.finishDelayMs <= 0) {
      complete();
      return;
    }
    session.finishTimer = setTimeout(complete, this.finishDelayMs);
    this.events?.onLiveChanged(session.profileId);
  }

  private summarize(session: LiveSession, outcome: LiveStepSummary['outcome']): LiveStepSummary {
    const big = session.step.table.blinds.big;
    if (session.step.kind === 'practice-table') {
      return {
        outcome,
        tag: session.step.tag,
        objectives: [],
        primaryObjectivesMet: null,
        liveScore: null,
        handsPlayed: session.handsPlayed,
        netBB: 0,
      };
    }
    const objectives = this.objectiveViews(session);
    return {
      outcome,
      tag: session.step.tag,
      objectives,
      primaryObjectivesMet: outcome === 'failed' ? false : primaryObjectivesMet(objectives),
      liveScore: liveScore(objectives),
      handsPlayed: session.handsPlayed,
      netBB: Math.round((session.netChips / big) * 10) / 10,
    };
  }

  /** 운영자 스킵용 요약 — 모든 목표를 달성(progress=target)으로 채운 done 요약. '연습'은 목표가 없으니 그대로. */
  private summarizeForced(session: LiveSession): LiveStepSummary {
    const base = this.summarize(session, 'done');
    if (session.step.kind === 'practice-table' || session.masquerade) return base;
    const objectives = base.objectives.map(objective => ({
      ...objective,
      progress: objective.target ?? Math.max(objective.progress, 1),
      achieved: true,
    }));
    return { ...base, objectives, primaryObjectivesMet: true, liveScore: 1 };
  }

  private clearFinishTimer(session: LiveSession): void {
    if (session.finishTimer) {
      clearTimeout(session.finishTimer);
      session.finishTimer = null;
    }
  }

  /**
   * 어댑터 주도 방 해체 — 트랜잭션: RoomManager가 거절하면(정산 미해결·진행 중 wallet 핸드 등) 매핑·roomId를
   * 그대로 두고 false. 해체 중엔 disposing으로 onRoomDisposed의 room-lost 전환을 막는다.
   */
  private disposeOwnRoom(session: LiveSession, reason: RoomDisposeReason): boolean {
    const roomId = session.roomId;
    if (!roomId) return true;
    session.disposing = true;
    const disposed = this.options.roomManager.disposeRoom(roomId, reason);
    session.disposing = false;
    if (!disposed) return false;
    this.byRoom.delete(roomId);
    session.roomId = null;
    session.deck = null;
    return true;
  }

  /** 세션 폐기 — 방을 닫을 수 없으면 세션도 남긴다(소유권 유지). */
  private dropSession(session: LiveSession): boolean {
    if (!this.disposeOwnRoom(session, 'story-end')) return false;
    this.clearQuizTimer(session);
    this.clearFinishTimer(session);
    this.sessions.delete(session.profileId);
    return true;
  }

  /** hold 상한 초과 세션 — 방을 해체하고 room-lost 보존으로 전환 (타이머·방 누수 방지) */
  private sweepHolds(): void {
    const now = this.now();
    for (const session of this.sessions.values()) {
      if (!session.roomId || !session.hold || session.holdSince === null) continue;
      if (now - session.holdSince < this.holdTimeoutMs) continue;
      eventLog.log('story-step', {
        roomId: session.roomId,
        playerId: session.profileId,
        data: { runId: session.runId, event: 'hold-timeout', holdReason: session.holdReason },
      });
      // 닫을 수 없으면(정산 미해결) 다음 스윕에서 다시 시도한다
      this.abortToRoomLost(session);
    }
  }
}
