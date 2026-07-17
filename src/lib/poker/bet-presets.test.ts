import { describe, it, expect } from 'vitest';
import {
  computeBetPresets,
  sanitizePreflopPresets,
  sanitizePostflopPresets,
  PREFLOP_PRESET_DEFAULT,
  POSTFLOP_PRESET_DEFAULT,
  PREFLOP_MULT_MIN,
  PREFLOP_MULT_MAX,
  POSTFLOP_PCT_MIN,
  POSTFLOP_PCT_MAX,
} from './bet-presets';

/**
 * 베팅 프리셋 계약 — ActionBar 버튼과 설정 편집기가 공유하는 단일 소스.
 * 프리플랍은 직전 베팅의 배수(오픈 스팟에선 BB 배수와 동일), 포스트플랍은 팟 %.
 * 사용자 편집값(localStorage)은 신뢰하지 않고 항상 sanitize를 거친다.
 */

describe('computeBetPresets', () => {
  it('프리플랍 오픈: 현재 벳(BB)의 배수 — 2.5x = 2.5BB 오픈', () => {
    const presets = computeBetPresets(
      { street: 'preflop', currentBet: 20, potSize: 30, minRaiseTo: 40, maxRaiseTo: 2000 },
      [2, 2.2, 2.5, 3],
      POSTFLOP_PRESET_DEFAULT,
    );
    expect(presets).toEqual([
      { label: '2x', amount: 40 },
      { label: '2.2x', amount: 44 },
      { label: '2.5x', amount: 50 },
      { label: '3x', amount: 60 },
    ]);
  });

  it('프리플랍 3벳 스팟: 상대 레이즈의 배수로 계산되고 최소 레이즈 밑으로 내려가지 않는다', () => {
    const presets = computeBetPresets(
      { street: 'preflop', currentBet: 60, potSize: 90, minRaiseTo: 200, maxRaiseTo: 2000 },
      [2, 3],
      POSTFLOP_PRESET_DEFAULT,
    );
    expect(presets[0]).toEqual({ label: '2x', amount: 200 }); // 120 < minRaiseTo → 클램프
    expect(presets[1]).toEqual({ label: '3x', amount: 200 }); // 180 < minRaiseTo → 클램프
  });

  it('포스트플랍: 팟 % + 현재 벳 기준, 스택 최대(올인)를 넘지 않는다', () => {
    const presets = computeBetPresets(
      { street: 'flop', currentBet: 0, potSize: 100, minRaiseTo: 20, maxRaiseTo: 80 },
      PREFLOP_PRESET_DEFAULT,
      [33, 50, 75, 100],
    );
    expect(presets).toEqual([
      { label: '33%', amount: 33 },
      { label: '50%', amount: 50 },
      { label: '75%', amount: 75 },
      { label: '100%', amount: 80 }, // 100 > maxRaiseTo → 올인 클램프
    ]);
  });
});

describe('sanitize — 사용자 편집값 정리', () => {
  it('배열이 아니거나 전부 쓰레기값이면 기본값으로 되돌린다', () => {
    expect(sanitizePreflopPresets(undefined)).toEqual(PREFLOP_PRESET_DEFAULT);
    expect(sanitizePreflopPresets('2,3')).toEqual(PREFLOP_PRESET_DEFAULT);
    expect(sanitizePostflopPresets([NaN, -5, 'x'])).toEqual(POSTFLOP_PRESET_DEFAULT);
  });

  it('범위를 벗어난 값은 클램프하고, 슬롯 순서는 입력 그대로 유지한다', () => {
    expect(sanitizePreflopPresets([0.5, 99, 3, 2])).toEqual([
      PREFLOP_MULT_MIN, PREFLOP_MULT_MAX, 3, 2,
    ]);
    expect(sanitizePostflopPresets([5, 999, 75, 33])).toEqual([
      POSTFLOP_PCT_MIN, POSTFLOP_PCT_MAX, 75, 33,
    ]);
  });

  it('프리플랍은 0.1 단위, 포스트플랍은 정수로 반올림한다', () => {
    expect(sanitizePreflopPresets([2.24999, 2.55])).toEqual([2.2, 2.6]);
    expect(sanitizePostflopPresets([33.4, 66.6])).toEqual([33, 67]);
  });

  it('4슬롯을 초과하면 앞의 4개만 유지한다', () => {
    expect(sanitizePreflopPresets([2, 2.2, 2.5, 3, 4, 5])).toEqual([2, 2.2, 2.5, 3]);
  });
});
