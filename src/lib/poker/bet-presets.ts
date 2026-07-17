import type { GameState } from './types';

/**
 * 베팅 프리셋 — 계산·검증 단일 소스 (ActionBar 표시 + 설정 UI 공용).
 *
 * 온라인 포커룸 표준 문법을 따른다 (PokerStars 'Bet Slider Shortcuts' / GGPoker 프리셋):
 * - 프리플랍: 직전 베팅의 배수. 오픈 스팟(현재 벳 = BB)에선 그대로 BB 배수가 되고
 *   (2.5x = 2.5BB 오픈), 3벳+ 스팟에선 상대 레이즈의 배수가 된다 (2.2x 3벳 등).
 * - 포스트플랍: 팟 대비 % (33/50/75/100 등).
 * - 값은 사용자가 설정에서 편집한다 (스타즈와 같은 4슬롯). localStorage 값은 신뢰하지
 *   않으므로 읽는 쪽에서도 sanitize를 통과시킨다.
 */

export const PRESET_SLOTS = 4;

export const PREFLOP_PRESET_DEFAULT = [2, 2.2, 2.5, 3];
export const POSTFLOP_PRESET_DEFAULT = [33, 50, 75, 100];

/** 프리플랍 배수 허용 범위 — 1x 이하는 레이즈가 아니고, 10x 초과는 사실상 올인 영역 */
export const PREFLOP_MULT_MIN = 1.5;
export const PREFLOP_MULT_MAX = 10;
/** 포스트플랍 팟 % 허용 범위 */
export const POSTFLOP_PCT_MIN = 10;
export const POSTFLOP_PCT_MAX = 250;

function sanitizeList(
  values: unknown,
  fallback: number[],
  min: number,
  max: number,
  round: (v: number) => number,
): number[] {
  if (!Array.isArray(values)) return [...fallback];
  const cleaned = values
    .map(Number)
    .filter(v => Number.isFinite(v) && v > 0)
    .map(v => Math.min(max, Math.max(min, round(v))))
    .slice(0, PRESET_SLOTS);
  return cleaned.length > 0 ? cleaned : [...fallback];
}

/** 프리플랍 배수 목록 정리 — 0.1 단위 반올림 + 범위 클램프. 슬롯 순서는 사용자 입력 그대로 유지 */
export function sanitizePreflopPresets(values: unknown): number[] {
  return sanitizeList(
    values,
    PREFLOP_PRESET_DEFAULT,
    PREFLOP_MULT_MIN,
    PREFLOP_MULT_MAX,
    v => Math.round(v * 10) / 10,
  );
}

/** 포스트플랍 팟 % 목록 정리 — 정수 반올림 + 범위 클램프 */
export function sanitizePostflopPresets(values: unknown): number[] {
  return sanitizeList(
    values,
    POSTFLOP_PRESET_DEFAULT,
    POSTFLOP_PCT_MIN,
    POSTFLOP_PCT_MAX,
    Math.round,
  );
}

export interface BetPresetContext {
  street: GameState['street'];
  /** 현재 테이블 벳 (총액) */
  currentBet: number;
  /** 현재 팟 총액 */
  potSize: number;
  /** 최소 레이즈 총액 (currentBet + minRaise) */
  minRaiseTo: number;
  /** 내 최대 총액 (스택 + 이미 낸 벳) = 올인 */
  maxRaiseTo: number;
}

export interface BetPreset {
  label: string;
  amount: number;
}

/** 현재 스팟의 프리셋 버튼 목록 — 항상 [minRaiseTo, maxRaiseTo] 범위로 클램프된 총액 */
export function computeBetPresets(
  ctx: BetPresetContext,
  preflopPresets: unknown,
  postflopPresets: unknown,
): BetPreset[] {
  const clamp = (v: number) => Math.min(ctx.maxRaiseTo, Math.max(ctx.minRaiseTo, v));
  if (ctx.street === 'preflop') {
    return sanitizePreflopPresets(preflopPresets).map(m => ({
      label: `${m}x`,
      amount: clamp(Math.round(ctx.currentBet * m)),
    }));
  }
  return sanitizePostflopPresets(postflopPresets).map(p => ({
    label: `${p}%`,
    amount: clamp(Math.floor(ctx.currentBet + ctx.potSize * (p / 100))),
  }));
}
