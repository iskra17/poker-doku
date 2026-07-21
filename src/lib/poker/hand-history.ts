import type {
  ActionType, Card, GameMode, HandRank, PlayerStatus, PlayerType, Street,
} from './types';

/**
 * 핸드 히스토리 (GGPoker PokerCraft 방식 벤치마킹).
 * 엔진이 핸드 진행을 그대로 기록한 CompletedHandRecord(원본 — 전체 홀카드 포함)를 만들고,
 * 서버 저장 계층이 참여 휴먼별로 "히어로 관점" 마스킹(HandHistoryDetail)해 영속한다.
 * 원본 레코드는 엔진 밖(브로드캐스트·로그)으로 절대 내보내지 말 것 — 머킹된 패가 노출된다.
 */

/** 블라인드 포스팅도 액션 타임라인에 포함해 리플레이를 완결시킨다 */
export type HandHistoryActionKind = ActionType | 'post-sb' | 'post-bb';

export interface HandHistoryAction {
  street: Street;
  playerId: string;
  kind: HandHistoryActionKind;
  /** call=추가 투입액, raise/all-in=해당 스트리트 총 벳, post=실제 포스트액, fold/check=0 */
  amount: number;
}

export interface HandHistoryPlayer {
  id: string;
  name: string;
  type: PlayerType;
  seatIndex: number;
  /** BTN/SB/BB/UTG/HJ/CO — 헤즈업은 BTN/SB */
  position: string;
  /** 블라인드 포스팅 전 스택 */
  startingChips: number;
  /** 원본 레코드에선 항상 실카드. 히어로 관점 마스킹 후엔 본인/공개 좌석 외 null */
  holeCards: Card[] | null;
  totalContributed: number;
  won: number;
  /** won - totalContributed */
  profit: number;
  /** 쇼다운/올인 런아웃으로 공개된 좌석 (getPublicState의 revealed 계약과 동일 판정) */
  revealed: boolean;
  finalStatus: PlayerStatus;
  handRank: HandRank | null;
  handDescription: string | null;
}

export interface HandHistoryWinner {
  playerId: string;
  amount: number;
  handRank: HandRank | null;
  handDescription: string | null;
  potIndex: number;
}

/** 엔진이 endHand에서 완성하는 핸드 1개의 전체 기록 (서버 내부 전용 — 마스킹 전) */
export interface CompletedHandRecord {
  handNumber: number;
  smallBlind: number;
  bigBlind: number;
  /** 딜인된 플레이어만, 엔진 좌석 배열 순서 */
  players: HandHistoryPlayer[];
  actions: HandHistoryAction[];
  board: Card[];
  winners: HandHistoryWinner[];
  potTotal: number;
  rake: number;
  /** 경합 쇼다운(생존자 2인 이상) 여부 — false면 폴드 승리 */
  showdown: boolean;
}

/** 저장·조회용 히어로 관점 상세 (상대 홀카드는 공개분만) */
export interface HandHistoryDetail extends CompletedHandRecord {
  heroId: string;
  roomName: string;
  gameMode: GameMode;
  playedAt: number;
  /** 사이트 전역 핸드 ID (table_hand 정본 기록 링크 — 정본 저장 실패/구버전 기록은 없음) */
  tableHandId?: number | null;
}

/** 목록 조회용 요약 한 줄 */
export interface HandHistorySummary {
  id: number;
  playedAt: number;
  roomName: string;
  gameMode: GameMode;
  bigBlind: number;
  handNumber: number;
  profit: number;
  heroCards: Card[];
  board: Card[];
  /** 사이트 전역 핸드 ID (정본 링크 — 구버전 기록은 null) */
  tableHandId?: number | null;
}

/** 딜러부터 시계방향 딜인 순서에 대한 포지션 라벨 (6-max 기준) */
export function positionLabels(count: number): string[] {
  switch (count) {
    case 2: return ['BTN/SB', 'BB'];
    case 3: return ['BTN', 'SB', 'BB'];
    case 4: return ['BTN', 'SB', 'BB', 'UTG'];
    case 5: return ['BTN', 'SB', 'BB', 'UTG', 'CO'];
    default: return ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'];
  }
}
