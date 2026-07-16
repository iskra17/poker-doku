import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createProfileStore,
  normalizeRecoveryWords,
  recoveryAcknowledgementKey,
} from './profile-store';

const PROFILE = {
  id: 'profile-1',
  alias: '벚꽃 여우',
  avatarId: 'sakura',
  wallet: { balance: 10_000, activeEscrow: 0 },
};

const ECONOMY = {
  hasActiveSeat: false,
  daily: {
    claimed: false,
    grantAmount: 1_000,
    availableAt: Date.parse('2026-07-16T03:00:00.000Z'),
  },
  rescue: {
    eligible: false,
    grantAmount: 0,
    remainingToday: 3,
    availableAt: null,
    reason: 'balance-threshold' as const,
  },
};

const WORDS = '가게 가격 가구 가까이 가끔 가난 가늘 가득 가로 가방 가수 가슴';
const NEW_WORDS = '나무 나비 나라 나름 나중 낮다 낳다 내년 너무 넓다 넘다 넣다';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
    entries: () => [...values.entries()],
  };
}

interface TestStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function setup(
  fetchImpl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>,
  storage: TestStorage = memoryStorage(),
) {
  const realtime = {
    currentRoomId: null as string | null,
    gameState: null as { id: string } | null,
  };
  const game = {
    connect: vi.fn(),
    disconnect: vi.fn(() => {
      realtime.currentRoomId = null;
      realtime.gameState = null;
    }),
    needsFreshConnection: vi.fn(() => false),
    setPublicProfile: vi.fn(),
    clearPublicProfile: vi.fn(),
  };
  const store = createProfileStore({ fetch: fetchImpl, storage, game });
  return { store, game, storage, realtime };
}

describe('anonymous profile store', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('bootstraps an anonymous session without connecting realtime', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ state: 'anonymous' }));
    const { store, game } = setup(fetchImpl);

    await store.getState().bootstrap();

    expect(store.getState()).toMatchObject({
      phase: 'anonymous',
      profile: null,
      economy: null,
      recoveryWords: null,
    });
    expect(fetchImpl).toHaveBeenCalledWith('/api/profile/session', {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    expect(game.connect).not.toHaveBeenCalled();
  });

  it('bootstraps a ready session, publishes only public identity, and connects once', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      state: 'ready', profile: PROFILE, economy: ECONOMY,
    }));
    const { store, game } = setup(fetchImpl);

    await Promise.all([
      store.getState().bootstrap(),
      store.getState().bootstrap(),
    ]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({
      phase: 'ready', profile: PROFILE, economy: ECONOMY,
      recoveryWarning: true,
    });
    expect(game.setPublicProfile).toHaveBeenCalledTimes(1);
    expect(game.setPublicProfile).toHaveBeenCalledWith({
      id: PROFILE.id, alias: PROFILE.alias, avatarId: PROFILE.avatarId,
    });
    expect(game.connect).toHaveBeenCalledTimes(1);
  });

  it('preserves a zero-chip active-seat flag independently of escrow amount', async () => {
    const zeroSeatProfile = {
      ...PROFILE,
      wallet: { balance: 799, activeEscrow: 0 },
    };
    const fetchImpl = vi.fn(async () => jsonResponse({
      state: 'ready',
      profile: zeroSeatProfile,
      economy: { ...ECONOMY, hasActiveSeat: true },
    }));
    const { store } = setup(fetchImpl);

    await store.getState().bootstrap();

    expect(store.getState().economy?.hasActiveSeat).toBe(true);
    expect(store.getState().profile?.wallet.activeEscrow).toBe(0);
  });

  it('rejects an out-of-contract rescue count without connecting', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      state: 'ready',
      profile: PROFILE,
      economy: {
        ...ECONOMY,
        rescue: { ...ECONOMY.rescue, remainingToday: 4 },
      },
    }));
    const { store, game } = setup(fetchImpl);

    await store.getState().bootstrap();

    expect(store.getState()).toMatchObject({ phase: 'anonymous', profile: null });
    expect(game.connect).not.toHaveBeenCalled();
  });

  it('keeps a valid session usable when acknowledgement storage is unavailable', async () => {
    const storage = {
      getItem: vi.fn(() => { throw new Error('storage blocked'); }),
      setItem: vi.fn(() => { throw new Error('storage blocked'); }),
      removeItem: vi.fn(() => { throw new Error('storage blocked'); }),
    };
    const fetchImpl = vi.fn(async () => jsonResponse({
      state: 'ready', profile: PROFILE, economy: ECONOMY,
    }));
    const { store, game } = setup(fetchImpl, storage);

    await store.getState().bootstrap();

    expect(store.getState()).toMatchObject({
      phase: 'ready', profile: PROFILE, recoveryWarning: true,
    });
    expect(game.connect).toHaveBeenCalledOnce();
  });

  it('refreshes a ready session without a loading flash or reconnect loop', async () => {
    const pending = deferred<Response>();
    const updated = { ...PROFILE, wallet: { balance: 9_000, activeEscrow: 1_000 } };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ state: 'ready', profile: PROFILE, economy: ECONOMY }))
      .mockImplementationOnce(() => pending.promise);
    const { store, game, realtime } = setup(fetchImpl);
    await store.getState().bootstrap();
    realtime.currentRoomId = 'room-1';
    realtime.gameState = { id: 'room-1' };

    const refresh = store.getState().refresh();
    expect(store.getState()).toMatchObject({ phase: 'ready', profile: PROFILE });
    pending.resolve(jsonResponse({ state: 'ready', profile: updated, economy: ECONOMY }));
    await refresh;

    expect(store.getState()).toMatchObject({ phase: 'ready', profile: updated });
    expect(game.connect).toHaveBeenCalledTimes(1);
    expect(realtime).toEqual({ currentRoomId: 'room-1', gameState: { id: 'room-1' } });
  });

  it('tears down profile A before publishing profile B from refresh', async () => {
    const profileB = { ...PROFILE, id: 'profile-2', alias: '달빛 수달' };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ state: 'ready', profile: PROFILE, economy: ECONOMY }))
      .mockResolvedValueOnce(jsonResponse({ state: 'ready', profile: profileB, economy: ECONOMY }));
    const { store, game, realtime } = setup(fetchImpl);
    await store.getState().bootstrap();
    realtime.currentRoomId = 'room-1';
    realtime.gameState = { id: 'room-1' };

    await store.getState().refresh();

    expect(game.disconnect).toHaveBeenCalledOnce();
    expect(game.setPublicProfile).toHaveBeenLastCalledWith({
      id: profileB.id, alias: profileB.alias, avatarId: profileB.avatarId,
    });
    expect(game.connect).toHaveBeenCalledTimes(2);
    expect(store.getState().profile).toEqual(profileB);
  });

  it('fresh reconnects a replaced same-profile socket but not a normal refresh', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ state: 'ready', profile: PROFILE, economy: ECONOMY }));
    const { store, game } = setup(fetchImpl);
    await store.getState().bootstrap();
    await store.getState().refresh();
    expect(game.disconnect).not.toHaveBeenCalled();
    expect(game.connect).toHaveBeenCalledTimes(1);

    game.needsFreshConnection.mockReturnValue(true);
    await store.getState().refresh();

    expect(game.disconnect).toHaveBeenCalledOnce();
    expect(game.connect).toHaveBeenCalledTimes(2);
  });

  it('tears down the old realtime identity on successful recovery until acknowledgement', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ state: 'ready', profile: PROFILE, economy: ECONOMY }))
      .mockResolvedValueOnce(jsonResponse({
        profile: PROFILE, economy: ECONOMY, recoveryWords: NEW_WORDS,
      }));
    const { store, game } = setup(fetchImpl);
    await store.getState().bootstrap();

    await store.getState().recover(WORDS);

    expect(store.getState().phase).toBe('recovery-required');
    expect(game.disconnect).toHaveBeenCalledOnce();
    expect(game.connect).toHaveBeenCalledTimes(1);
    store.getState().acknowledgeRecovery();
    expect(game.connect).toHaveBeenCalledTimes(2);
  });

  it('clears realtime identity when a forced bootstrap becomes anonymous', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ state: 'ready', profile: PROFILE, economy: ECONOMY }))
      .mockResolvedValueOnce(jsonResponse({ state: 'anonymous' }));
    const { store, game, realtime } = setup(fetchImpl);
    await store.getState().bootstrap();
    realtime.currentRoomId = 'room-1';
    realtime.gameState = { id: 'room-1' };

    await store.getState().bootstrap();

    expect(store.getState()).toMatchObject({
      phase: 'anonymous', profile: null, economy: null,
      recoveryWords: null, recoveryWarning: false, error: null,
    });
    expect(game.disconnect).toHaveBeenCalledOnce();
    expect(game.clearPublicProfile).toHaveBeenCalledOnce();
    expect(realtime).toEqual({ currentRoomId: null, gameState: null });
  });

  it('clears realtime identity when a forced bootstrap request fails', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ state: 'ready', profile: PROFILE, economy: ECONOMY }))
      .mockRejectedValueOnce(new Error('offline'));
    const { store, game, realtime } = setup(fetchImpl);
    await store.getState().bootstrap();
    realtime.currentRoomId = 'room-1';
    realtime.gameState = { id: 'room-1' };

    await store.getState().bootstrap();

    expect(store.getState()).toMatchObject({
      phase: 'anonymous', profile: null, economy: null,
      recoveryWords: null, recoveryWarning: false,
      error: '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.',
    });
    expect(game.disconnect).toHaveBeenCalledOnce();
    expect(game.clearPublicProfile).toHaveBeenCalledOnce();
    expect(realtime).toEqual({ currentRoomId: null, gameState: null });
  });

  it('retains the last ready snapshot when a refresh request fails', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ state: 'ready', profile: PROFILE, economy: ECONOMY }))
      .mockRejectedValueOnce(new Error('offline'));
    const { store, game, realtime } = setup(fetchImpl);
    await store.getState().bootstrap();
    realtime.currentRoomId = 'room-1';
    realtime.gameState = { id: 'room-1' };

    await store.getState().refresh();

    expect(store.getState()).toMatchObject({
      phase: 'ready', profile: PROFILE,
      error: '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.',
    });
    expect(game.connect).toHaveBeenCalledTimes(1);
    expect(game.disconnect).not.toHaveBeenCalled();
    expect(realtime).toEqual({ currentRoomId: 'room-1', gameState: { id: 'room-1' } });
  });

  it('clears realtime identity when a refresh confirms an anonymous session', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ state: 'ready', profile: PROFILE, economy: ECONOMY }))
      .mockResolvedValueOnce(jsonResponse({ state: 'anonymous' }));
    const { store, game } = setup(fetchImpl);
    await store.getState().bootstrap();

    await store.getState().refresh();

    expect(store.getState()).toMatchObject({ phase: 'anonymous', profile: null, economy: null });
    expect(game.disconnect).toHaveBeenCalledOnce();
    expect(game.clearPublicProfile).toHaveBeenCalledOnce();
  });

  it('creates with the exact public payload and waits for recovery acknowledgement', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        profile: PROFILE, recoveryWords: WORDS,
      }, 201))
      .mockResolvedValueOnce(jsonResponse({
        state: 'ready', profile: PROFILE, economy: ECONOMY,
      }));
    const { store, game } = setup(fetchImpl);

    const request = store.getState().create('sakura');
    expect(store.getState().phase).toBe('creating');
    await request;

    expect(fetchImpl).toHaveBeenCalledWith('/api/profile/create', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({ avatarId: 'sakura', adultConfirmed: true }),
    }));
    expect(fetchImpl).toHaveBeenLastCalledWith('/api/profile/session', {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    expect(store.getState()).toMatchObject({
      phase: 'recovery-required',
      profile: PROFILE,
      recoveryWords: WORDS.split(' '),
      recoveryWarning: true,
    });
    expect(game.connect).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent create operations to one profile POST', async () => {
    const pending = deferred<Response>();
    const fetchImpl = vi.fn(() => pending.promise);
    const { store } = setup(fetchImpl);

    const first = store.getState().create('sakura');
    const second = store.getState().create('ara');

    expect(second).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    pending.resolve(jsonResponse({
      profile: PROFILE, economy: ECONOMY, recoveryWords: WORDS,
    }, 201));
    await Promise.all([first, second]);
    expect(store.getState().phase).toBe('recovery-required');
  });

  it('deduplicates recover and ignores invalid/concurrent identity operations while it is in flight', async () => {
    const pending = deferred<Response>();
    const fetchImpl = vi.fn(() => pending.promise);
    const { store } = setup(fetchImpl);

    const first = store.getState().recover(WORDS);
    const invalid = store.getState().recover('두 단어');
    const competingCreate = store.getState().create('ara');

    expect(invalid).toBe(first);
    expect(competingCreate).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    pending.resolve(jsonResponse({
      profile: PROFILE, economy: ECONOMY, recoveryWords: NEW_WORDS,
    }));
    await Promise.all([first, invalid, competingCreate]);
    expect(store.getState()).toMatchObject({
      phase: 'recovery-required',
      recoveryWords: NEW_WORDS.split(' '),
      error: null,
    });
  });

  it('acknowledges or skips recovery words without persisting the secret', async () => {
    const storage = memoryStorage();
    const fetchImpl = vi.fn(async () => jsonResponse({
      profile: PROFILE, economy: ECONOMY, recoveryWords: WORDS,
    }, 201));
    const { store, game } = setup(fetchImpl, storage);
    await store.getState().create('sakura');

    store.getState().acknowledgeRecovery();
    expect(store.getState()).toMatchObject({
      phase: 'ready', recoveryWords: null, recoveryWarning: false,
    });
    expect(storage.setItem).toHaveBeenCalledWith(
      recoveryAcknowledgementKey(PROFILE.id),
      '1',
    );
    expect(JSON.stringify(storage.entries())).not.toContain(WORDS);
    expect(game.connect).toHaveBeenCalledTimes(1);

    await store.getState().rotateRecovery();
    expect(store.getState().phase).toBe('recovery-required');
    store.getState().skipRecovery();
    expect(store.getState()).toMatchObject({
      phase: 'ready', recoveryWords: null, recoveryWarning: true,
    });
    expect(storage.removeItem).toHaveBeenCalledWith(
      recoveryAcknowledgementKey(PROFILE.id),
    );
    expect(game.connect).toHaveBeenCalledTimes(1);
  });

  it('normalizes exactly twelve recovery words and keeps invalid recovery anonymous', async () => {
    expect(normalizeRecoveryWords(`  ${WORDS.replaceAll(' ', '  \n')} `)).toBe(WORDS);
    expect(normalizeRecoveryWords('하나 둘')).toBeNull();
    const fetchImpl = vi.fn(async () => jsonResponse({
      error: { code: 'PROFILE_RECOVERY_INVALID', message: '복구 문구가 유효하지 않습니다.' },
    }, 401));
    const { store, game } = setup(fetchImpl);

    await store.getState().recover(WORDS);

    expect(store.getState()).toMatchObject({
      phase: 'anonymous', profile: null, economy: null,
      error: '복구 문구가 유효하지 않습니다.',
    });
    expect(game.connect).not.toHaveBeenCalled();
  });

  it('requires newly rotated recovery words after a successful recovery', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        profile: PROFILE, recoveryWords: NEW_WORDS,
      }))
      .mockResolvedValueOnce(jsonResponse({
        state: 'ready', profile: PROFILE, economy: ECONOMY,
      }));
    const storage = memoryStorage({ [recoveryAcknowledgementKey(PROFILE.id)]: '1' });
    const { store, game } = setup(fetchImpl, storage);

    await store.getState().recover(WORDS);

    expect(fetchImpl).toHaveBeenCalledWith('/api/profile/recover', expect.objectContaining({
      body: JSON.stringify({ recoveryWords: WORDS }),
    }));
    expect(store.getState()).toMatchObject({
      phase: 'recovery-required',
      recoveryWords: NEW_WORDS.split(' '),
      recoveryWarning: true,
    });
    expect(storage.removeItem).toHaveBeenCalledWith(recoveryAcknowledgementKey(PROFILE.id));
    expect(game.connect).not.toHaveBeenCalled();
  });

  it('ignores stale bootstrap responses after a newer create succeeds', async () => {
    const pending = deferred<Response>();
    const fetchImpl = vi.fn()
      .mockImplementationOnce(() => pending.promise)
      .mockResolvedValueOnce(jsonResponse({
        profile: PROFILE, economy: ECONOMY, recoveryWords: WORDS,
      }, 201));
    const { store, game } = setup(fetchImpl);

    const bootstrap = store.getState().bootstrap();
    await store.getState().create('sakura');
    store.getState().acknowledgeRecovery();
    pending.resolve(jsonResponse({ state: 'anonymous' }));
    await bootstrap;

    expect(store.getState()).toMatchObject({
      phase: 'ready', profile: PROFILE,
    });
    expect(game.disconnect).not.toHaveBeenCalled();
    expect(game.clearPublicProfile).not.toHaveBeenCalled();
  });

  it('rotates recovery words atomically and retains ready data on failure', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ state: 'ready', profile: PROFILE, economy: ECONOMY }))
      .mockResolvedValueOnce(jsonResponse({ recoveryWords: NEW_WORDS }))
      .mockResolvedValueOnce(jsonResponse({ error: { message: '잠시 후 다시 시도해 주세요.' } }, 409));
    const { store } = setup(fetchImpl);
    await store.getState().bootstrap();

    await store.getState().rotateRecovery();
    expect(store.getState()).toMatchObject({
      phase: 'recovery-required', recoveryWords: NEW_WORDS.split(' '),
    });
    store.getState().skipRecovery();
    await store.getState().rotateRecovery();
    expect(store.getState()).toMatchObject({
      phase: 'ready', profile: PROFILE, economy: ECONOMY,
      error: '잠시 후 다시 시도해 주세요.',
    });
  });

  it('retains ready state on active-seat delete failure and clears everything on success', async () => {
    const seated = { ...PROFILE, wallet: { balance: 8_000, activeEscrow: 2_000 } };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ state: 'ready', profile: seated, economy: ECONOMY }))
      .mockResolvedValueOnce(jsonResponse({ error: { message: '참가 중인 게임의 칩을 먼저 정산해 주세요.' } }, 409))
      .mockResolvedValueOnce(jsonResponse({ ok: true }));
    const { store, game } = setup(fetchImpl);
    await store.getState().bootstrap();

    await store.getState().deleteProfile('삭제');
    expect(store.getState()).toMatchObject({
      phase: 'ready', profile: seated,
      error: '참가 중인 게임의 칩을 먼저 정산해 주세요.',
    });
    await store.getState().deleteProfile('삭제');
    expect(store.getState()).toMatchObject({
      phase: 'anonymous', profile: null, economy: null,
      recoveryWords: null, recoveryWarning: false,
    });
    expect(game.disconnect).toHaveBeenCalledTimes(1);
    expect(game.clearPublicProfile).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['claimDaily', '/api/economy/daily'],
    ['claimRescue', '/api/economy/rescue'],
  ] as const)('%s replaces profile and economy with the refreshed response', async (method, path) => {
    const updated = { ...PROFILE, wallet: { balance: 11_000, activeEscrow: 0 } };
    const refreshed = {
      ...ECONOMY,
      daily: { ...ECONOMY.daily, claimed: true },
    };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ state: 'ready', profile: PROFILE, economy: ECONOMY }))
      .mockResolvedValueOnce(jsonResponse({ profile: updated, economy: refreshed, transaction: { delta: 1_000 } }));
    const { store } = setup(fetchImpl);
    await store.getState().bootstrap();

    await store.getState()[method]();

    expect(fetchImpl).toHaveBeenLastCalledWith(path, expect.objectContaining({
      method: 'POST', body: '{}', credentials: 'same-origin', cache: 'no-store',
    }));
    expect(store.getState()).toMatchObject({ profile: updated, economy: refreshed, error: null });
  });

  it('refreshes authoritative economy status after a rejected claim', async () => {
    const refreshed = {
      ...ECONOMY,
      daily: { ...ECONOMY.daily, claimed: true },
    };
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ state: 'ready', profile: PROFILE, economy: ECONOMY }))
      .mockResolvedValueOnce(jsonResponse({ error: { message: '오늘 무료 칩을 이미 받았습니다.' } }, 409))
      .mockResolvedValueOnce(jsonResponse({ state: 'ready', profile: PROFILE, economy: refreshed }));
    const { store } = setup(fetchImpl);
    await store.getState().bootstrap();

    await store.getState().claimDaily();

    expect(fetchImpl).toHaveBeenLastCalledWith('/api/profile/session', {
      credentials: 'same-origin', cache: 'no-store',
    });
    expect(store.getState()).toMatchObject({
      phase: 'ready', economy: refreshed, action: null,
      error: '오늘 무료 칩을 이미 받았습니다.',
    });
  });

  it('never sends or stores a profile credential or recovery words outside recover', async () => {
    const storage = memoryStorage();
    const fetchImpl = vi.fn(async () => jsonResponse({ state: 'anonymous' }));
    const { store } = setup(fetchImpl, storage);
    await store.getState().bootstrap();

    const serializedBodies = (fetchImpl.mock.calls as unknown as Array<[
      RequestInfo | URL,
      RequestInit?,
    ]>)
      .map(call => `${String(call[0])}:${String(call[1]?.body ?? '')}`)
      .join('|');
    expect(serializedBodies).not.toMatch(/credential|cookie|sessionToken/i);
    expect(JSON.stringify(storage.entries())).not.toContain(WORDS);
  });
});
