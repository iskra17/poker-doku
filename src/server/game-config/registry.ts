/**
 * 런타임 게임 설정 레지스트리 — 백오피스 핫 컨피그의 단일 소스.
 *
 * 여기 선언된 항목만 어드민(/admin 게임 설정 탭)에서 조정할 수 있고, 서버 검증과 UI 렌더가
 * 모두 이 배열 하나에서 나온다. **서버 전용 모듈** — 클라이언트는 API 응답의 메타만 렌더하므로
 * 이 파일을 클라 번들로 import하지 말 것 (서버 상수 유출 차단).
 *
 * 1차 원칙: "어드민에 보이는 것 = 실제로 반영되는 것". 클라이언트 번들에 하드코딩된 값
 * (캐시 바이인 40~200BB, SnG 바이인/스택/블라인드 스케줄, 투척 쿨다운, 타임칩 연장 "+30초"
 * 문구)은 서버만 바꾸면 화면과 어긋나므로 레지스트리에 넣지 않는다 — 클라 동기화 채널이
 * 생기는 2차에서 확장. (타임칩 연장은 warning 표시로 넣었다가 2026-07-23 운영 결정으로 제외.)
 */

/**
 * 적용 방식 — UI 배지로 노출해 운영자가 "저장 = 즉시 반영"으로 오해하지 않게 한다.
 * - immediate: 다음 판정/호출부터 즉시 (호출 시 읽기 소비처)
 * - next-hand: 진행 중 핸드는 그대로, 다음 핸드 정산/시작부터
 * - new-room: 이미 만들어진 방은 유지, 새로 만드는 방부터
 */
export type GameConfigApplyMode = 'immediate' | 'next-hand' | 'new-room';
export type GameConfigGroup = 'economy' | 'table' | 'timer' | 'bot' | 'ops';

export interface GameConfigEntry {
  /** '그룹.카멜케이스' 형태 — DB game_config.key와 1:1 */
  key: string;
  /** 한국어 라벨 (어드민 UI 그대로 사용) */
  label: string;
  group: GameConfigGroup;
  min: number;
  max: number;
  unit?: 'ms' | 's' | 'chips' | 'bps' | 'BB' | '개' | '%';
  /** 코드 기본값의 유일한 정의처 — 소비처 리터럴은 전부 여기로 이동한다 */
  defaultValue: number;
  applyMode: GameConfigApplyMode;
  /** 운영 참고 사항 */
  description?: string;
  /** 정직한 경고 — 예: 클라 하드코딩 문구와 어긋날 수 있음 */
  warning?: string;
}

export const GAME_CONFIG_GROUP_LABELS: Record<GameConfigGroup, string> = {
  economy: '경제',
  table: '테이블',
  timer: '타이머',
  bot: '봇',
  ops: '운영',
};

export const GAME_CONFIG_REGISTRY = [
  // ── 경제 ──────────────────────────────────────────────────────────────
  {
    key: 'economy.startingChips',
    label: '온보딩 지급 칩',
    group: 'economy',
    min: 1_000,
    max: 1_000_000,
    unit: 'chips',
    defaultValue: 10_000,
    applyMode: 'immediate',
    description: '프로필 최초 생성 시 지갑에 넣어주는 칩 — 신규 프로필부터 적용 (기존 유저 소급 없음)',
  },
  {
    key: 'economy.dailyGrant',
    label: '일일 무료 칩',
    group: 'economy',
    min: 0,
    max: 100_000,
    unit: 'chips',
    defaultValue: 1_000,
    applyMode: 'immediate',
    description: 'KST 자정 리셋, 하루 1회 수동 수령 — 이미 수령한 유저는 당일 구액 유지',
  },
  {
    key: 'economy.rescueThreshold',
    label: '구제 발동 기준 잔액',
    group: 'economy',
    min: 0,
    max: 100_000,
    unit: 'chips',
    defaultValue: 800,
    applyMode: 'immediate',
    description: '지갑 잔액이 이 값 미만이면 구제(미야코의 재도전 지원) 수령 가능',
  },
  {
    key: 'economy.rescueTarget',
    label: '구제 목표 잔액',
    group: 'economy',
    min: 100,
    max: 100_000,
    unit: 'chips',
    defaultValue: 2_000,
    applyMode: 'immediate',
    description: '구제 수령 시 잔액을 이 값까지 채워준다 (지급액 = 목표 − 현재 잔액)',
  },
  {
    key: 'economy.rescueDailyLimit',
    label: '구제 일일 횟수',
    group: 'economy',
    min: 0,
    max: 20,
    unit: '개',
    defaultValue: 3,
    applyMode: 'immediate',
    description: 'KST 날짜 기준 하루 최대 수령 횟수 — 하향해도 이미 수령분 회수 없음',
  },
  {
    key: 'economy.rescueCooldownMs',
    label: '구제 쿨다운',
    group: 'economy',
    min: 0,
    max: 24 * 60 * 60 * 1_000,
    unit: 'ms',
    defaultValue: 4 * 60 * 60 * 1_000,
    applyMode: 'immediate',
    description: '직전 구제 수령 후 다음 수령까지 대기 시간',
  },
  {
    key: 'economy.rakeBps',
    label: '캐시 레이크율',
    group: 'economy',
    min: 0,
    max: 2_000,
    unit: 'bps',
    defaultValue: 500,
    applyMode: 'next-hand',
    description: '만분율(bps) — 500 = 5%. 정산 시 1회 계산이라 진행 중 핸드는 영향 없음',
  },
  {
    key: 'economy.rakeCapBB',
    label: '캐시 레이크 상한',
    group: 'economy',
    min: 0,
    max: 50,
    unit: 'BB',
    defaultValue: 5,
    applyMode: 'next-hand',
    description: '핸드당 레이크 상한 (빅블라인드 배수)',
  },
  // ── 테이블 ────────────────────────────────────────────────────────────
  {
    key: 'table.maxRooms',
    label: '최대 방 수',
    group: 'table',
    min: 1,
    max: 200,
    unit: '개',
    defaultValue: 30,
    applyMode: 'immediate',
    description: '하향해도 기존 방은 유지 — 신규 생성만 차단',
  },
  {
    key: 'table.sitoutMissedBbLimit',
    label: '자리비움 미납 오르빗 한도',
    group: 'table',
    min: 1,
    max: 20,
    unit: '개',
    defaultValue: 2,
    applyMode: 'immediate',
    description: '자리비움 좌석이 이 오르빗 수를 넘기면 자동 정리 (벽시계 하한과 AND 결합)',
  },
  {
    key: 'table.sitoutMinWallMs',
    label: '자리비움 정리 벽시계 하한',
    group: 'table',
    min: 0,
    max: 60 * 60 * 1_000,
    unit: 'ms',
    defaultValue: 120_000,
    applyMode: 'immediate',
    description: '봇만 남은 빠른 테이블에서 오르빗 기준이 과속하는 것을 막는 최소 경과 시간',
  },
  {
    key: 'table.sitoutAbandonMs',
    label: '자리 방치 회수 유예',
    group: 'table',
    min: 30_000,
    max: 60 * 60 * 1_000,
    unit: 'ms',
    defaultValue: 5 * 60_000,
    applyMode: 'immediate',
    description: '자리 떠난 좌석을 확실히 회수하는 타이머 — 새로 걸리는 타이머부터 적용',
  },
  {
    key: 'table.bustReclaimMs',
    label: '파산 리바이 유예',
    group: 'table',
    min: 5_000,
    max: 10 * 60 * 1_000,
    unit: 'ms',
    defaultValue: 30_000,
    applyMode: 'immediate',
    description: '캐시 파산(0칩) 좌석의 리바이 대기 시간 — BustNotice 카운트다운은 서버 deadline 기준이라 자동 일치',
  },
  // ── 타이머 ────────────────────────────────────────────────────────────
  {
    key: 'timer.turnTimeDefault',
    label: '기본 턴 시간',
    group: 'timer',
    min: 5,
    max: 60,
    unit: 's',
    defaultValue: 15,
    applyMode: 'new-room',
    description: '방 생성 시 턴 시간 미지정이면 이 값 — 이미 만들어진 방은 유지 (기존 방 반영은 정책 미정으로 보류)',
  },
  {
    key: 'timer.runoutStreetDelayMs',
    label: '올인 런아웃 스트리트 간격',
    group: 'timer',
    min: 200,
    max: 10_000,
    unit: 'ms',
    defaultValue: 1_600,
    applyMode: 'immediate',
    description: '올인 런아웃 연출에서 플랍→턴→리버→쇼다운 사이 간격',
  },
  {
    key: 'timer.disconnectedAutoActMs',
    label: '끊김 좌석 자동 처리 지연',
    group: 'timer',
    min: 100,
    max: 10_000,
    unit: 'ms',
    defaultValue: 1_000,
    applyMode: 'immediate',
    description: '접속 끊김/자리비움 좌석의 턴을 자동 체크/폴드하기까지의 지연',
  },
  {
    key: 'timer.graceMs',
    label: '재접속 유예',
    group: 'timer',
    min: 5_000,
    max: 10 * 60 * 1_000,
    unit: 'ms',
    defaultValue: 60_000,
    applyMode: 'immediate',
    description: '연결 끊김 후 좌석/칩을 보존하는 시간 — 끊기는 시점에 걸리는 유예부터 적용',
  },
  // ── 봇 ────────────────────────────────────────────────────────────────
  {
    key: 'bot.defaultBotCount',
    label: '캐시 방 기본 봇 수',
    group: 'bot',
    min: 0,
    max: 5,
    unit: '개',
    defaultValue: 2,
    applyMode: 'new-room',
    description: '방 생성 시 봇 수 미지정이면 이 값 (기본 제공 방 4개는 자체 설정 유지)',
  },
  {
    key: 'bot.thinkDelayPct',
    label: '봇 사고 시간 배율',
    group: 'bot',
    min: 10,
    max: 300,
    unit: '%',
    defaultValue: 100,
    applyMode: 'immediate',
    description: '100 = 기본 속도. 낮추면 봇이 빨리, 높이면 천천히 액션 (결정 난이도별 형태는 유지)',
  },
  // ── 운영 ──────────────────────────────────────────────────────────────
  {
    key: 'ops.aiDialogueDailyMax',
    label: 'AI 대사 일일 상한',
    group: 'ops',
    min: 0,
    max: 10_000,
    unit: '개',
    defaultValue: 200,
    applyMode: 'immediate',
    description: 'Gemini 실시간 생성 호출의 일일 상한 (0 = 생성 중단, 스크립트 대사만)',
  },
  {
    key: 'ops.aiDialogueCooldownMs',
    label: 'AI 대사 방별 쿨다운',
    group: 'ops',
    min: 0,
    max: 10 * 60 * 1_000,
    unit: 'ms',
    defaultValue: 20_000,
    applyMode: 'immediate',
  },
  {
    key: 'ops.aiDialogueChanceBps',
    label: 'AI 대사 생성 확률',
    group: 'ops',
    min: 0,
    max: 10_000,
    unit: 'bps',
    defaultValue: 6_000,
    applyMode: 'immediate',
    description: '만분율 — 6000 = 60% 확률로 생성 시도',
  },
] as const satisfies readonly GameConfigEntry[];

export type GameConfigKey = typeof GAME_CONFIG_REGISTRY[number]['key'];

export const GAME_CONFIG_DEFAULTS: Readonly<Record<GameConfigKey, number>> =
  Object.fromEntries(
    GAME_CONFIG_REGISTRY.map(entry => [entry.key, entry.defaultValue]),
  ) as Record<GameConfigKey, number>;

export function isGameConfigKey(key: string): key is GameConfigKey {
  return Object.prototype.hasOwnProperty.call(GAME_CONFIG_DEFAULTS, key);
}

/** 단일 min/max로 못 잡는 키 간 관계 검증 — 전체 유효할 때만 저장 (부분 적용 없음) */
export interface GameConfigCrossCheck {
  keys: readonly GameConfigKey[];
  message: string;
  validate: (get: (key: GameConfigKey) => number) => boolean;
}

export const GAME_CONFIG_CROSS_CHECKS: readonly GameConfigCrossCheck[] = [
  {
    keys: ['economy.rescueTarget', 'economy.rescueThreshold'],
    message: '구제 목표 잔액은 발동 기준 잔액보다 커야 합니다',
    validate: get => get('economy.rescueTarget') > get('economy.rescueThreshold'),
  },
];

/**
 * env 기반 기본값 오버라이드 — 우선순위: DB 오버라이드 > env > 코드 기본값.
 * 기존 운영 관행(AI_DIALOGUE_* env)을 깨지 않기 위한 브리지. 범위 밖 env는 클램프.
 */
export function resolveEnvConfigDefaults(
  env: Record<string, string | undefined>,
): Partial<Record<GameConfigKey, number>> {
  const overrides: Partial<Record<GameConfigKey, number>> = {};
  const applyInt = (key: GameConfigKey, raw: string | undefined) => {
    if (raw === undefined || raw === '') return;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const entry = GAME_CONFIG_REGISTRY.find(item => item.key === key);
    if (!entry) return;
    overrides[key] = Math.min(entry.max, Math.max(entry.min, Math.round(parsed)));
  };
  applyInt('ops.aiDialogueDailyMax', env.AI_DIALOGUE_DAILY_MAX);
  applyInt('ops.aiDialogueCooldownMs', env.AI_DIALOGUE_COOLDOWN_MS);
  if (env.AI_DIALOGUE_CHANCE !== undefined && env.AI_DIALOGUE_CHANCE !== '') {
    const chance = Number(env.AI_DIALOGUE_CHANCE);
    if (Number.isFinite(chance)) {
      overrides['ops.aiDialogueChanceBps'] = Math.min(
        10_000,
        Math.max(0, Math.round(chance * 10_000)),
      );
    }
  }
  return overrides;
}
