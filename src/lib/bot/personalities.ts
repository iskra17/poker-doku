/**
 * 봇 HUD 스탯 데이터베이스.
 * 캐릭터별 포커 스타일을 실제 트래커(HUD) 지표로 수치화한다 — bot-ai.ts가 이 수치만 읽고
 * 레인지/빈도를 결정하므로, 여기 숫자를 바꾸면 그 봇의 플레이 스타일이 그대로 바뀐다.
 *
 * 해석 규약 (bot-ai.ts와의 계약):
 * - 레인지 스탯 (vpip/pfr/threeBet/coldCall/foldToThreeBet): "상위 X% 핸드" —
 *   hand-rankings.ts의 콤보 가중 백분위와 비교해 참여 레인지를 정한다.
 *   (vpip 24 = 상위 24% 핸드로 팟 참여 → 장기적으로 HUD vpip ≈ 24가 된다)
 * - 빈도 스탯 (limp/steal/cbetFlop/cbetTurn/checkRaise/donkBet/riverBluff/slowPlay/
 *   semiBluff/foldToCbet/aggression): 매 상황 독립시행 — rng() < stat/100 이면 실행.
 * - 사이징 (openRaiseBB/betSizePot): 금액 산출 기준.
 *
 * 모든 % 스탯은 0~100 정수 스케일.
 */
export interface BotPersonality {
  id: string;
  /** 아키타입 라벨 (한국어) — UI/디버깅/AI 대사 프롬프트용 */
  style: string;

  // --- 프리플랍 (레인지 %) ---
  vpip: number;           // 자발적 팟 참여 레인지
  pfr: number;            // 오픈 레이즈 레인지
  threeBet: number;       // 3벳 레인지
  coldCall: number;       // 레이즈에 콜로 참여하는 추가 레인지 (threeBet과 합산해 컨티뉴 레인지)
  foldToThreeBet: number; // 내 오픈이 3벳 당했을 때 폴드 빈도 (%)

  // --- 프리플랍 (빈도 %) ---
  limp: number;           // 오픈 대신 림프하는 빈도
  steal: number;          // 레이트 포지션(버튼/컷오프/SB) 스틸 오픈 가산 레인지 (%p)

  // --- 포스트플랍 (빈도 %) ---
  cbetFlop: number;       // 플랍 컨티뉴에이션 벳
  cbetTurn: number;       // 턴 배럴
  foldToCbet: number;     // 상대 벳에 약한 핸드로 폴드
  checkRaise: number;     // 체크레이즈
  donkBet: number;        // 어그레서가 아닌데 먼저 벳
  wtsd: number;           // 쇼다운 지향 — 마지널 핸드 콜다운 성향
  riverBluff: number;     // 리버 블러프
  semiBluff: number;      // 드로우 세미블러프
  slowPlay: number;       // 몬스터 슬로플레이
  aggression: number;     // 메이드 핸드 밸류 벳/레이즈 성향

  // --- 사이징 ---
  openRaiseBB: number;    // 오픈 레이즈 크기 (BB 배수)
  betSizePot: number;     // 기본 벳 크기 (팟 대비 %)
}

export const BOT_PERSONALITIES: Record<string, BotPersonality> = {
  // 사쿠라 — 록 (타이트 패시브): 좁은 레인지, 프리미엄 대기, 맞으면 조용히 밸류
  'sakura': {
    id: 'sakura',
    style: '록 (타이트 패시브)',
    vpip: 20, pfr: 11, threeBet: 3, coldCall: 9, foldToThreeBet: 75,
    limp: 60, steal: 4,
    cbetFlop: 52, cbetTurn: 38, foldToCbet: 58, checkRaise: 5, donkBet: 4,
    wtsd: 21, riverBluff: 4, semiBluff: 18, slowPlay: 35, aggression: 34,
    openRaiseBB: 2.5, betSizePot: 45,
  },
  // 아라 — LAG: 넓은 레인지 + 고압 베팅, 3벳/스틸 남발
  'ara': {
    id: 'ara',
    style: '루즈 어그레시브 (LAG)',
    vpip: 45, pfr: 35, threeBet: 12, coldCall: 10, foldToThreeBet: 35,
    limp: 3, steal: 14,
    cbetFlop: 76, cbetTurn: 58, foldToCbet: 32, checkRaise: 11, donkBet: 9,
    wtsd: 31, riverBluff: 16, semiBluff: 55, slowPlay: 8, aggression: 78,
    openRaiseBB: 3, betSizePot: 72,
  },
  // 하나 — TAG 정석파: 교과서 레인지, 좋은 핸드만 강하게
  'hana': {
    id: 'hana',
    style: '타이트 어그레시브 (TAG)',
    vpip: 24, pfr: 19, threeBet: 8, coldCall: 5, foldToThreeBet: 55,
    limp: 5, steal: 10,
    cbetFlop: 66, cbetTurn: 50, foldToCbet: 45, checkRaise: 8, donkBet: 3,
    wtsd: 26, riverBluff: 9, semiBluff: 42, slowPlay: 18, aggression: 68,
    openRaiseBB: 2.7, betSizePot: 62,
  },
  // 클로이 — 콜링 스테이션 (루즈 패시브): 뭐든 보고 싶어함, 거의 폴드 안 함
  'chloe': {
    id: 'chloe',
    style: '콜링 스테이션 (루즈 패시브)',
    vpip: 58, pfr: 7, threeBet: 2, coldCall: 48, foldToThreeBet: 25,
    limp: 78, steal: 3,
    cbetFlop: 40, cbetTurn: 28, foldToCbet: 15, checkRaise: 3, donkBet: 12,
    wtsd: 44, riverBluff: 3, semiBluff: 15, slowPlay: 12, aggression: 20,
    openRaiseBB: 2.2, betSizePot: 40,
  },
  // 비비안 — 매니악: 초공격, 블러프 최다, 판을 키움
  'vivian': {
    id: 'vivian',
    style: '매니악',
    vpip: 60, pfr: 44, threeBet: 16, coldCall: 14, foldToThreeBet: 22,
    limp: 3, steal: 18,
    cbetFlop: 85, cbetTurn: 68, foldToCbet: 22, checkRaise: 14, donkBet: 15,
    wtsd: 34, riverBluff: 26, semiBluff: 65, slowPlay: 5, aggression: 88,
    openRaiseBB: 3.5, betSizePot: 85,
  },
  // 엘레나 — 밸런스드 프로: 모든 지표 균형, 가끔 몬스터 트랩
  'elena': {
    id: 'elena',
    style: '밸런스드 프로',
    vpip: 27, pfr: 21, threeBet: 9, coldCall: 6, foldToThreeBet: 48,
    limp: 4, steal: 12,
    cbetFlop: 64, cbetTurn: 52, foldToCbet: 42, checkRaise: 9, donkBet: 5,
    wtsd: 28, riverBluff: 12, semiBluff: 45, slowPlay: 30, aggression: 62,
    openRaiseBB: 2.5, betSizePot: 60,
  },
};
