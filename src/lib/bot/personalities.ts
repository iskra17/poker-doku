/**
 * 봇 성향 데이터베이스.
 * 실제 포커 플레이어 아키타입을 캐릭터별로 부여한다 — bot-ai.ts가 이 수치만 읽고 행동을 결정하므로
 * 새 봇/밸런스 조정은 여기 수치만 바꾸면 된다.
 *
 * 아키타입 매핑:
 * - sakura: 록 (타이트 패시브) — 좁은 레인지, 맞으면 조용히 밸류
 * - ryuka:  루즈 어그레시브 (LAG) — 넓은 레인지 + 공격적 베팅/블러프
 * - hana:   타이트 어그레시브 (TAG) — 정석파, 좋은 핸드만 강하게
 * - yuki:   콜링 스테이션 (루즈 패시브) — 뭐든 보고 싶어함, 거의 폴드 안 함
 * - akira:  매니악 — 초공격적, 블러프 최다
 * - reika:  밸런스드 프로 — 모든 지표가 교과서 균형, 가끔 몬스터 슬로플레이 트랩
 */
export interface BotPersonality {
  id: string;
  /** 아키타입 라벨 (한국어) — UI/디버깅용 */
  style: string;
  vpip: number;           // 자발적 팟 참여율 (0-1, 높을수록 루즈)
  pfr: number;            // 프리플랍 레이즈 빈도 (0-1)
  aggression: number;     // 포스트플랍 공격성 (0-1)
  bluffFrequency: number; // 블러프 빈도 (0-1)
  foldToPressure: number; // 압박에 폴드하는 정도 (0-1, 높을수록 잘 접음)
  callDown: number;       // 마지널 핸드로 콜 따라가는 성향 (0-1)
  limp: number;           // 오픈 대신 림프하는 성향 (0-1, 패시브일수록 높음)
  threeBet: number;       // 프리플랍 3벳 빈도 (0-1)
  slowPlay: number;       // 몬스터 핸드 슬로플레이 빈도 (0-1)
  betSizing: number;      // 기본 벳 크기 (팟 대비 비율, 0.4~0.9)
}

export const BOT_PERSONALITIES: Record<string, BotPersonality> = {
  'sakura': {
    id: 'sakura',
    style: '록 (타이트 패시브)',
    vpip: 0.22,
    pfr: 0.12,
    aggression: 0.35,
    bluffFrequency: 0.06,
    foldToPressure: 0.65,
    callDown: 0.30,
    limp: 0.55,
    threeBet: 0.06,
    slowPlay: 0.35,
    betSizing: 0.45,
  },
  'ryuka': {
    id: 'ryuka',
    style: '루즈 어그레시브 (LAG)',
    vpip: 0.48,
    pfr: 0.38,
    aggression: 0.80,
    bluffFrequency: 0.38,
    foldToPressure: 0.18,
    callDown: 0.55,
    limp: 0.05,
    threeBet: 0.28,
    slowPlay: 0.10,
    betSizing: 0.75,
  },
  'hana': {
    id: 'hana',
    style: '타이트 어그레시브 (TAG)',
    vpip: 0.26,
    pfr: 0.22,
    aggression: 0.70,
    bluffFrequency: 0.18,
    foldToPressure: 0.38,
    callDown: 0.45,
    limp: 0.10,
    threeBet: 0.20,
    slowPlay: 0.20,
    betSizing: 0.65,
  },
  'yuki': {
    id: 'yuki',
    style: '콜링 스테이션 (루즈 패시브)',
    vpip: 0.65,
    pfr: 0.08,
    aggression: 0.18,
    bluffFrequency: 0.05,
    foldToPressure: 0.08,
    callDown: 0.85,
    limp: 0.80,
    threeBet: 0.03,
    slowPlay: 0.15,
    betSizing: 0.40,
  },
  'reika': {
    id: 'reika',
    style: '밸런스드 프로',
    vpip: 0.30,
    pfr: 0.24,
    aggression: 0.60,
    bluffFrequency: 0.22,
    foldToPressure: 0.30,
    callDown: 0.40,
    limp: 0.08,
    threeBet: 0.16,
    slowPlay: 0.30,
    betSizing: 0.60,
  },
  'akira': {
    id: 'akira',
    style: '매니악',
    vpip: 0.62,
    pfr: 0.45,
    aggression: 0.90,
    bluffFrequency: 0.50,
    foldToPressure: 0.12,
    callDown: 0.50,
    limp: 0.05,
    threeBet: 0.35,
    slowPlay: 0.05,
    betSizing: 0.85,
  },
};
