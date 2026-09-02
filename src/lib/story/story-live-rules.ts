/**
 * 라이브 스토리 스텝('연습' 프리셋 · '대결' 스파링)의 **인룸 표시 규칙** — 순수 함수.
 * 컴포넌트(StoryOverlay·ActionBar·GameRoomView·StoryStage)는 그리기만 하고 판정은 전부 여기서 한다.
 *
 * 계약 메모:
 * - 라이브 방 판정의 단일 소스는 `isStoryLiveRoom` — `run.live.roomId`와 게임 스토어의
 *   `currentRoomId`가 **둘 다 있고 같을 때만** 인룸이다. 서버가 방을 내리면 roomId가 null이 되고
 *   (holdReason 'room-lost') 그때는 로비의 StoryStage가 [이어하기]를 그린다.
 * - 인터럽트는 두 갈래다: 서버가 hold로 지목하는 것(`live.interruptId`)과, 서버가 hold하지 않고
 *   클라가 첫 내 턴에 스스로 재생하는 `first-my-turn`. 둘을 섞으면 서버 hold가 없는데 resume을
 *   보내거나(스텝 진행 어긋남) 턴 중에 두 번 뜬다.
 */
import type { HintLevel, Interrupt, Step } from './types';
import type {
  DecisionMark,
  ObjectiveProgressView,
  StoryHoldReason,
  StoryLiveView,
  StoryRunView,
} from './views';

/** 방을 여는 스텝 — 씬/레슨/드릴/결산 스텝과 구분한다 */
export type LiveStep = Extract<Step, { kind: 'practice-table' | 'sparring' }>;

/**
 * 지금 앉아 있는 방이 이 런의 라이브 방인가.
 * 오버레이·코치 패널·나가기 분기의 공통 게이트 (실전 방에서는 항상 false여야 한다).
 */
export function isStoryLiveRoom(run: StoryRunView | null, currentRoomId: string | null): boolean {
  const roomId = run?.live?.roomId ?? null;
  return !!roomId && !!currentRoomId && roomId === currentRoomId;
}

/** 라이브 스텝만 좁힌다 (아니면 null) */
export function asLiveStep(step: Step | null | undefined): LiveStep | null {
  if (!step) return null;
  return step.kind === 'practice-table' || step.kind === 'sparring' ? step : null;
}

/** 코치 오버레이 힌트 레벨 — 라이브 스텝이 아니면 0(표시 없음) */
export function liveHintLevel(step: Step | null | undefined): HintLevel {
  return asLiveStep(step)?.table.hints ?? 0;
}

/** '연습' 프리셋 스텝의 안내 문구 (스파링에는 없다) */
export function practicePrompt(step: Step | null | undefined): string | null {
  return step?.kind === 'practice-table' ? (step.perHandPrompt ?? null) : null;
}

/**
 * 서버가 hold(holdReason 'scene')로 지목한 인터럽트.
 * 재생이 끝나면 `story-advance(target:'resume')`로 hold를 풀어야 다음 핸드가 시작된다.
 */
export function pendingInterrupt(step: Step | null | undefined, live: StoryLiveView | null): Interrupt | null {
  const id = live?.interruptId;
  if (!id || step?.kind !== 'sparring') return null;
  return step.interrupts.find(interrupt => interrupt.id === id) ?? null;
}

/**
 * `first-my-turn` 인터럽트 — 서버는 이걸 hold하지 않는다(턴 타이머가 계속 돈다).
 * 클라가 스텝당 한 번, 처음 내 턴이 왔을 때 직접 열고 닫는다(서버 명령 없음).
 */
export function firstMyTurnInterrupt(step: Step | null | undefined): Interrupt | null {
  if (step?.kind !== 'sparring') return null;
  return step.interrupts.find(interrupt => interrupt.trigger.kind === 'first-my-turn') ?? null;
}

export interface ObjectiveHudLine {
  id: string;
  label: string;
  progress: number;
  /** 횟수 목표가 없는 목표(생존 등)는 null */
  target: number | null;
  /** 아직 판정 불가(기회 0 등)면 null */
  achieved: boolean | null;
  primary: boolean;
}

function toHudLine(objective: ObjectiveProgressView): ObjectiveHudLine {
  return {
    id: objective.id,
    label: objective.label,
    progress: objective.progress,
    target: objective.target,
    achieved: objective.achieved,
    primary: objective.primary,
  };
}

/**
 * HUD 표시 순서 — **primary(통과 조건) 먼저**, 그 안에서는 서버 순서를 그대로 둔다.
 * 보너스 목표가 통과 조건보다 위에 뜨면 "저것만 하면 되나" 오독이 난다.
 */
export function objectiveHudLines(view: StoryLiveView | null): ObjectiveHudLine[] {
  const objectives = view?.objectives ?? [];
  return [
    ...objectives.filter(objective => objective.primary).map(toHudLine),
    ...objectives.filter(objective => !objective.primary).map(toHudLine),
  ];
}

/** 결정 리뷰 판정 아이콘 (기획 A7 ③) */
export function reviewMarkGlyph(mark: DecisionMark): '👍' | '🤔' | '⚠' {
  switch (mark) {
    case 'good':
      return '👍';
    case 'hmm':
      return '🤔';
    case 'warn':
      return '⚠';
  }
}

export interface HoldCopy {
  title: string;
  body: string;
  cta: string;
}

/** 라이브 hold 안내 문구 — 인룸 패널(StoryOverlay)과 로비 스테이지(StoryStage)가 함께 쓴다 */
export function holdCopy(holdReason: StoryHoldReason | null): HoldCopy {
  switch (holdReason) {
    case 'timeout':
      return {
        title: '시간이 지나 잠시 멈췄어요',
        body: '생각할 시간이 지나서 이번 차례는 자동으로 처리했어요. 준비되면 이어서 할게요.',
        cta: '계속하기',
      };
    case 'scene':
      return {
        title: '잠깐 이야기가 있어요',
        body: '핸드가 끝났어요. 한마디 듣고 이어서 갈게요.',
        cta: '계속하기',
      };
    case 'room-lost':
      return {
        title: '테이블 연결이 끊겨 잠시 멈췄어요',
        body: '이어서 같은 자리에서 다시 시작해요.',
        cta: '이어하기',
      };
    default:
      return {
        title: '테이블 준비 중',
        body: '잠시만요, 자리를 준비하고 있어요.',
        cta: '계속하기',
      };
  }
}

/**
 * 로비 스테이지가 [이어하기] 버튼을 그려야 하는 상태인가.
 * 방이 사라진 hold('room-lost' 또는 hold인데 roomId가 없는 경우)만 사용자 조작이 필요하다 —
 * 착석 직전의 짧은 live-play(roomId 아직 없음)는 서버가 곧 방을 보내므로 안내만 한다.
 */
export function needsResumeFromLobby(run: StoryRunView | null): boolean {
  if (!run || run.live?.roomId) return false;
  if (run.live?.holdReason === 'room-lost') return true;
  return run.phase === 'live-hold' && !!run.live?.hold;
}
