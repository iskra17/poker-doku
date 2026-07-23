import type {
  CompletedHandRecord,
  HandHistoryAction,
  HandHistoryActionKind,
} from './hand-history';
import type { Street } from './types';

export type PlayStreet = Exclude<Street, 'showdown'>;

export interface ReplayContributionState {
  pot: number;
  posts: number;
  streetBets: ReadonlyMap<string, number>;
}

export function createReplayContributionState(): ReplayContributionState {
  return {
    pot: 0,
    posts: 0,
    streetBets: new Map<string, number>(),
  };
}

export function applyReplayContribution(
  state: ReplayContributionState,
  action: HandHistoryAction,
): ReplayContributionState {
  const next = {
    ...state,
    streetBets: new Map(state.streetBets),
  };
  switch (action.kind) {
    case 'post-sb':
    case 'post-bb':
      next.pot += action.amount;
      next.posts += action.amount;
      next.streetBets.set(
        action.playerId,
        (next.streetBets.get(action.playerId) ?? 0) + action.amount,
      );
      break;
    case 'call':
      next.pot += action.amount;
      next.streetBets.set(
        action.playerId,
        (next.streetBets.get(action.playerId) ?? 0) + action.amount,
      );
      break;
    case 'raise':
    case 'all-in': {
      const previous = next.streetBets.get(action.playerId) ?? 0;
      next.pot += action.amount - previous;
      next.streetBets.set(action.playerId, action.amount);
      break;
    }
    case 'uncalled-return': {
      const previous = next.streetBets.get(action.playerId) ?? 0;
      next.pot -= action.amount;
      next.streetBets.set(action.playerId, previous - action.amount);
      break;
    }
    default:
      break;
  }
  return next;
}

/**
 * 스트리트 시작 시점 팟 (WPL/GG 컬럼 헤더 표기와 동일 의미 — 프리플랍은 블라인드 합).
 * raise/all-in 액션의 amount는 "그 스트리트 총 벳"이라 플레이어별 스트리트 벳을 추적해 증분만 더한다.
 * 도달하지 않은 스트리트는 null.
 */
export function computeStreetStartPots(
  record: CompletedHandRecord,
): Record<PlayStreet, number | null> {
  const startPots: Record<PlayStreet, number | null> = {
    preflop: null, flop: null, turn: null, river: null,
  };
  let state = createReplayContributionState();
  let current: PlayStreet = 'preflop';

  for (const action of record.actions) {
    if (action.street !== current && action.street !== 'showdown') {
      startPots[action.street as PlayStreet] = state.pot;
      state = { ...state, streetBets: new Map<string, number>() };
      current = action.street as PlayStreet;
    }
    state = applyReplayContribution(state, action);
  }
  startPots.preflop = state.posts;
  // 베팅 없이 런아웃된 스트리트 — 보드가 깔렸으면 진입 팟은 최종 팟과 같다
  if (record.board.length >= 3 && startPots.flop === null) startPots.flop = state.pot;
  if (record.board.length >= 4 && startPots.turn === null) startPots.turn = state.pot;
  if (record.board.length >= 5 && startPots.river === null) startPots.river = state.pot;
  return startPots;
}

export function formatReplayAction(
  kind: HandHistoryActionKind,
  formattedAmount: string,
): string {
  switch (kind) {
    case 'post-sb': return `SB ${formattedAmount}`;
    case 'post-bb': return `BB ${formattedAmount}`;
    case 'fold': return '폴드';
    case 'check': return '체크';
    case 'call': return `콜 ${formattedAmount}`;
    case 'raise': return `레이즈 ${formattedAmount}`;
    case 'all-in': return `올인 ${formattedAmount}`;
    case 'uncalled-return': return `미응수 반환 ${formattedAmount}`;
    default: return kind;
  }
}
