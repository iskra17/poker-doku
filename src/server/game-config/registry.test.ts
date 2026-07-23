import { describe, expect, it } from 'vitest';
import {
  GAME_CONFIG_CROSS_CHECKS,
  GAME_CONFIG_DEFAULTS,
  GAME_CONFIG_GROUP_LABELS,
  GAME_CONFIG_REGISTRY,
  isGameConfigKey,
  resolveEnvConfigDefaults,
} from './registry';

describe('game config registry', () => {
  it('has unique keys in group.camelCase form', () => {
    const keys = GAME_CONFIG_REGISTRY.map(entry => entry.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const entry of GAME_CONFIG_REGISTRY) {
      expect(entry.key).toMatch(/^[a-z]+\.[a-zA-Z]+$/);
      expect(entry.key.startsWith(`${entry.group}.`)).toBe(true);
    }
  });

  it('keeps min <= defaultValue <= max with integer bounds', () => {
    for (const entry of GAME_CONFIG_REGISTRY) {
      expect(Number.isSafeInteger(entry.min)).toBe(true);
      expect(Number.isSafeInteger(entry.max)).toBe(true);
      expect(Number.isSafeInteger(entry.defaultValue)).toBe(true);
      expect(entry.min).toBeLessThanOrEqual(entry.defaultValue);
      expect(entry.defaultValue).toBeLessThanOrEqual(entry.max);
    }
  });

  it('labels every group used by entries', () => {
    for (const entry of GAME_CONFIG_REGISTRY) {
      expect(GAME_CONFIG_GROUP_LABELS[entry.group]).toBeTruthy();
    }
  });

  it('passes every cross check with pure defaults', () => {
    for (const check of GAME_CONFIG_CROSS_CHECKS) {
      expect(check.validate(key => GAME_CONFIG_DEFAULTS[key])).toBe(true);
      for (const key of check.keys) {
        expect(isGameConfigKey(key)).toBe(true);
      }
    }
  });

  it('resolves AI dialogue env defaults with clamping', () => {
    expect(resolveEnvConfigDefaults({})).toEqual({});
    expect(resolveEnvConfigDefaults({
      AI_DIALOGUE_DAILY_MAX: '500',
      AI_DIALOGUE_COOLDOWN_MS: '45000',
      AI_DIALOGUE_CHANCE: '0.25',
    })).toEqual({
      'ops.aiDialogueDailyMax': 500,
      'ops.aiDialogueCooldownMs': 45_000,
      'ops.aiDialogueChanceBps': 2_500,
    });
    // 범위 밖은 클램프, 파싱 불가는 무시
    expect(resolveEnvConfigDefaults({
      AI_DIALOGUE_DAILY_MAX: '999999',
      AI_DIALOGUE_CHANCE: '7',
      AI_DIALOGUE_COOLDOWN_MS: 'not-a-number',
    })).toEqual({
      'ops.aiDialogueDailyMax': 10_000,
      'ops.aiDialogueChanceBps': 10_000,
    });
  });
});
