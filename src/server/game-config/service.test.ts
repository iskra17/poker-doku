import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  openPokerDatabase,
  type PokerDatabase,
} from '../persistence/database';
import { GAME_CONFIG_DEFAULTS } from './registry';
import { GameConfigRepository } from './repository';
import {
  GameConfigService,
  GameConfigValidationError,
} from './service';
import { cfg, initGameConfig, resetGameConfigForTest } from './live';

describe('GameConfigService', () => {
  let database: PokerDatabase;

  beforeEach(() => {
    database = openPokerDatabase(':memory:');
  });

  afterEach(() => {
    resetGameConfigForTest();
    database.close();
  });

  const createService = (
    options: ConstructorParameters<typeof GameConfigService>[1] = {},
  ) => new GameConfigService(new GameConfigRepository(database), {
    logger: { warn: vi.fn() },
    ...options,
  });

  it('serves registry defaults when no override rows exist', () => {
    const service = createService();
    expect(service.get('economy.dailyGrant')).toBe(1_000);
    expect(service.get('economy.startingChips')).toBe(10_000);
    const snapshot = service.snapshot();
    expect(snapshot.every(view => !view.overridden)).toBe(true);
    expect(snapshot.find(view => view.key === 'economy.rescueTarget')?.value)
      .toBe(2_000);
  });

  it('prefers DB override over env default over code default', () => {
    const withEnv = createService({
      envDefaults: { 'ops.aiDialogueDailyMax': 500 },
    });
    expect(withEnv.get('ops.aiDialogueDailyMax')).toBe(500);

    withEnv.set({ 'ops.aiDialogueDailyMax': 50 });
    expect(withEnv.get('ops.aiDialogueDailyMax')).toBe(50);

    // 오버라이드 리셋 시 env 기본값으로 복원 (코드 기본값 200이 아니라)
    withEnv.set({ 'ops.aiDialogueDailyMax': null });
    expect(withEnv.get('ops.aiDialogueDailyMax')).toBe(500);
  });

  it('persists overrides across service re-instantiation (restart sim)', () => {
    const service = createService({ clock: () => 1_700_000_000_000 });
    const diff = service.set({
      'economy.dailyGrant': 2_000,
      'timer.turnTimeDefault': 20,
    });
    expect(diff).toEqual(expect.arrayContaining([
      { key: 'economy.dailyGrant', from: 1_000, to: 2_000 },
      { key: 'timer.turnTimeDefault', from: 15, to: 20 },
    ]));

    const restarted = createService();
    expect(restarted.get('economy.dailyGrant')).toBe(2_000);
    expect(restarted.get('timer.turnTimeDefault')).toBe(20);
    const view = restarted.snapshot()
      .find(item => item.key === 'economy.dailyGrant');
    expect(view).toMatchObject({
      overridden: true,
      value: 2_000,
      effectiveDefault: 1_000,
      updatedAt: 1_700_000_000_000,
    });
  });

  it('ignores unknown keys and out-of-range rows on hydration with warning', () => {
    const repository = new GameConfigRepository(database);
    repository.saveChanges([
      { key: 'ghost.removedKey', value: 42 },
      { key: 'economy.dailyGrant', value: 999_999_999 },
    ], 1_700_000_000_000);
    const warn = vi.fn();
    const service = createService({ logger: { warn } });
    expect(service.get('economy.dailyGrant')).toBe(1_000);
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it('resets an override with null and removes the row', () => {
    const service = createService();
    service.set({ 'economy.rescueDailyLimit': 5 });
    expect(service.get('economy.rescueDailyLimit')).toBe(5);

    const diff = service.set({ 'economy.rescueDailyLimit': null });
    expect(diff).toEqual([
      { key: 'economy.rescueDailyLimit', from: 5, to: 3 },
    ]);
    expect(service.get('economy.rescueDailyLimit')).toBe(3);
    expect(new GameConfigRepository(database).loadAll()).toEqual([]);
  });

  it('skips no-op writes and reports only real changes in the diff', () => {
    const service = createService();
    // 기본값과 같은 값을 저장하는 것도 오버라이드 고정이므로 diff에는 없지만 행은 생긴다
    const pinDiff = service.set({ 'economy.dailyGrant': 1_000 });
    expect(pinDiff).toEqual([]);
    expect(new GameConfigRepository(database).loadAll()).toHaveLength(1);

    // 오버라이드 없는 키의 리셋은 아무것도 하지 않는다
    const noopDiff = service.set({ 'economy.rescueTarget': null });
    expect(noopDiff).toEqual([]);
    expect(new GameConfigRepository(database).loadAll()).toHaveLength(1);
  });

  it('rejects the whole batch when any value is invalid (no partial apply)', () => {
    const service = createService();
    expect(() => service.set({
      'economy.dailyGrant': 5_000,
      'economy.rescueDailyLimit': 999,
    })).toThrow(GameConfigValidationError);
    expect(service.get('economy.dailyGrant')).toBe(1_000);

    expect(() => service.set({ 'nope.unknown': 1 }))
      .toThrow(GameConfigValidationError);
    expect(() => service.set({ 'economy.dailyGrant': 10.5 }))
      .toThrow(GameConfigValidationError);
  });

  it('enforces cross checks against the projected state', () => {
    const service = createService();
    // 목표(2000)를 threshold(800) 아래로 내리는 단독 업데이트 거부
    expect(() => service.set({ 'economy.rescueTarget': 500 }))
      .toThrow(GameConfigValidationError);
    // 함께 올리면 통과
    const diff = service.set({
      'economy.rescueThreshold': 3_000,
      'economy.rescueTarget': 5_000,
    });
    expect(diff).toHaveLength(2);
    // 이제 threshold(3000)만 목표(5000) 위로 올리는 것도 거부
    expect(() => service.set({ 'economy.rescueThreshold': 6_000 }))
      .toThrow(GameConfigValidationError);
  });

  it('collects korean validation messages per key', () => {
    const service = createService();
    try {
      service.set({ 'economy.dailyGrant': -5, 'ghost.key': 1 });
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(GameConfigValidationError);
      const errors = (error as GameConfigValidationError).errors;
      expect(errors).toHaveLength(2);
      expect(errors.map(item => item.key).sort())
        .toEqual(['economy.dailyGrant', 'ghost.key']);
    }
  });
});

describe('live cfg() singleton', () => {
  afterEach(() => resetGameConfigForTest());

  it('falls back to registry defaults before hydration', () => {
    expect(cfg('economy.rescueThreshold'))
      .toBe(GAME_CONFIG_DEFAULTS['economy.rescueThreshold']);
  });

  it('reads live values after initGameConfig and detaches on reset', () => {
    const database = openPokerDatabase(':memory:');
    try {
      const service = new GameConfigService(
        new GameConfigRepository(database),
        { logger: { warn: vi.fn() } },
      );
      initGameConfig(service);
      service.set({ 'economy.rescueThreshold': 1_500 });
      expect(cfg('economy.rescueThreshold')).toBe(1_500);

      resetGameConfigForTest();
      expect(cfg('economy.rescueThreshold')).toBe(800);
    } finally {
      database.close();
    }
  });
});
