'use client';

import { create, type StoreApi, type UseBoundStore } from 'zustand';
import type { EconomyStatus, PublicProfile } from '@/lib/profile/types';
import { useGameStore } from './game-store';

export type ProfilePhase =
  | 'loading'
  | 'anonymous'
  | 'creating'
  | 'recovering'
  | 'recovery-required'
  | 'ready';

export type ProfileAction =
  | 'rotating'
  | 'deleting'
  | 'daily'
  | 'rescue'
  | 'avatar'
  | null;

interface PublicGameIdentity {
  id: string;
  alias: string;
  avatarId: string;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface ProfileGameBridge {
  connect(): void;
  disconnect(): void;
  needsFreshConnection(): boolean;
  setPublicProfile(profile: PublicGameIdentity): void;
  clearPublicProfile(): void;
}

export interface ProfileStoreDependencies {
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
  storage: StorageLike;
  game: ProfileGameBridge;
}

export interface ProfileStoreState {
  phase: ProfilePhase;
  action: ProfileAction;
  profile: PublicProfile | null;
  economy: EconomyStatus | null;
  recoveryWords: string[] | null;
  recoveryWarning: boolean;
  error: string | null;
  bootstrap(): Promise<void>;
  refresh(): Promise<void>;
  create(avatarId: string): Promise<void>;
  recover(recoveryWords: string): Promise<void>;
  acknowledgeRecovery(): void;
  skipRecovery(): void;
  rotateRecovery(): Promise<void>;
  deleteProfile(confirmation: string): Promise<void>;
  claimDaily(): Promise<void>;
  claimRescue(): Promise<void>;
  /** 좌석 아바타 변경 — 해금 검증은 서버(/api/profile/avatar)가 담당 */
  changeAvatar(avatarId: string): Promise<void>;
  clearError(): void;
}

type ProfileStore = UseBoundStore<StoreApi<ProfileStoreState>>;

const RECOVERY_ACK_PREFIX = 'poker-doku-recovery-saved:';
const DEFAULT_ERROR = '요청을 처리하지 못했어요. 잠시 후 다시 시도해 주세요.';

export function recoveryAcknowledgementKey(profileId: string): string {
  return `${RECOVERY_ACK_PREFIX}${profileId}`;
}

export function normalizeRecoveryWords(value: string): string | null {
  const normalized = value.trim().split(/\s+/u).filter(Boolean).join(' ');
  return normalized.split(' ').length === 12 ? normalized : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function parseProfile(value: unknown): PublicProfile | null {
  if (!isRecord(value) || !isRecord(value.wallet)) return null;
  if (
    typeof value.id !== 'string'
    || typeof value.alias !== 'string'
    || typeof value.avatarId !== 'string'
    || !isNonnegativeSafeInteger(value.wallet.balance)
    || !isNonnegativeSafeInteger(value.wallet.activeEscrow)
  ) return null;
  return {
    id: value.id,
    alias: value.alias,
    avatarId: value.avatarId,
    wallet: {
      balance: value.wallet.balance,
      activeEscrow: value.wallet.activeEscrow,
    },
  };
}

const RESCUE_REASONS = new Set([
  'balance-threshold',
  'active-escrow',
  'cooldown',
  'daily-limit',
]);

function parseEconomyStatus(value: unknown): EconomyStatus | null {
  if (!isRecord(value) || !isRecord(value.daily) || !isRecord(value.rescue)) {
    return null;
  }
  const dailyAvailableAt = value.daily.availableAt;
  const rescueAvailableAt = value.rescue.availableAt;
  const reason = value.rescue.reason;
  if (
    typeof value.hasActiveSeat !== 'boolean'
    || typeof value.daily.claimed !== 'boolean'
    || !isNonnegativeSafeInteger(value.daily.grantAmount)
    || !isNonnegativeSafeInteger(dailyAvailableAt)
    || typeof value.rescue.eligible !== 'boolean'
    || !isNonnegativeSafeInteger(value.rescue.grantAmount)
    || !isNonnegativeSafeInteger(value.rescue.remainingToday)
    || value.rescue.remainingToday > 3
    || (rescueAvailableAt !== null && !isNonnegativeSafeInteger(rescueAvailableAt))
    || (reason !== null && (typeof reason !== 'string' || !RESCUE_REASONS.has(reason)))
  ) return null;
  return {
    hasActiveSeat: value.hasActiveSeat,
    daily: {
      claimed: value.daily.claimed,
      grantAmount: value.daily.grantAmount,
      availableAt: dailyAvailableAt,
    },
    rescue: {
      eligible: value.rescue.eligible,
      grantAmount: value.rescue.grantAmount,
      remainingToday: value.rescue.remainingToday,
      availableAt: rescueAvailableAt,
      reason: reason as EconomyStatus['rescue']['reason'],
    },
  };
}

function parseRecoveryWords(value: unknown): string[] | null {
  if (typeof value !== 'string') return null;
  const normalized = normalizeRecoveryWords(value);
  return normalized?.split(' ') ?? null;
}

function safeErrorMessage(value: unknown): string {
  if (!isRecord(value) || !isRecord(value.error)) return DEFAULT_ERROR;
  const message = value.error.message;
  if (
    typeof message !== 'string'
    || message.length < 1
    || message.length > 120
    || /[\r\n]/u.test(message)
    || !/[가-힣]/u.test(message)
  ) return DEFAULT_ERROR;
  return message;
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json() as unknown;
  } catch {
    return null;
  }
}

class ProfileRequestError extends Error {
  constructor(readonly userMessage: string) {
    super(userMessage);
    this.name = 'ProfileRequestError';
  }
}

async function requestJson(
  dependencies: ProfileStoreDependencies,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  let response: Response;
  try {
    response = await dependencies.fetch(path, {
      credentials: 'same-origin',
      cache: 'no-store',
      ...init,
    });
  } catch {
    throw new ProfileRequestError(DEFAULT_ERROR);
  }
  const payload = await readJson(response);
  if (!response.ok) throw new ProfileRequestError(safeErrorMessage(payload));
  return payload;
}

function postJson(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function requestErrorMessage(error: unknown): string {
  return error instanceof ProfileRequestError ? error.userMessage : DEFAULT_ERROR;
}

export function createProfileStore(
  dependencies: ProfileStoreDependencies,
): ProfileStore {
  let requestVersion = 0;
  let bootstrapPromise: Promise<void> | null = null;
  let refreshPromise: Promise<void> | null = null;
  let identityOperationPromise: Promise<void> | null = null;
  let connectedProfileId: string | null = null;
  const startIdentityOperation = (work: () => Promise<void>): Promise<void> => {
    if (identityOperationPromise) return identityOperationPromise;
    const pending = work().finally(() => {
      if (identityOperationPromise === pending) identityOperationPromise = null;
    });
    identityOperationPromise = pending;
    return pending;
  };
  const hasRecoveryAcknowledgement = (profileId: string): boolean => {
    try {
      return dependencies.storage.getItem(recoveryAcknowledgementKey(profileId)) === '1';
    } catch {
      return false;
    }
  };
  const rememberRecoveryAcknowledgement = (profileId: string): void => {
    try {
      dependencies.storage.setItem(recoveryAcknowledgementKey(profileId), '1');
    } catch {
      // The in-memory acknowledgement remains valid for this page lifetime.
    }
  };
  const forgetRecoveryAcknowledgement = (profileId: string): void => {
    try {
      dependencies.storage.removeItem(recoveryAcknowledgementKey(profileId));
    } catch {
      // Storage is optional; recovery words themselves are never persisted.
    }
  };

  return create<ProfileStoreState>((set, get) => {
    const resetAnonymous = (error: string | null): void => {
      connectedProfileId = null;
      dependencies.game.disconnect();
      dependencies.game.clearPublicProfile();
      set({
        phase: 'anonymous',
        action: null,
        profile: null,
        economy: null,
        recoveryWords: null,
        recoveryWarning: false,
        error,
      });
    };

    const publishReady = (
      profile: PublicProfile,
      economy: EconomyStatus,
      recoveryWarning: boolean,
    ): void => {
      const profileChanged = connectedProfileId !== null
        && connectedProfileId !== profile.id;
      if (profileChanged || dependencies.game.needsFreshConnection()) {
        dependencies.game.disconnect();
        dependencies.game.clearPublicProfile();
        connectedProfileId = null;
      }
      set({
        phase: 'ready',
        action: null,
        profile,
        economy,
        recoveryWords: null,
        recoveryWarning,
        error: null,
      });
      dependencies.game.setPublicProfile({
        id: profile.id,
        alias: profile.alias,
        avatarId: profile.avatarId,
      });
      if (connectedProfileId !== profile.id) {
        connectedProfileId = profile.id;
        dependencies.game.connect();
      }
    };

    const requireProfilePayload = (
      payload: unknown,
    ): { profile: PublicProfile; economy: EconomyStatus } => {
      if (!isRecord(payload)) throw new ProfileRequestError(DEFAULT_ERROR);
      const profile = parseProfile(payload.profile);
      const economy = parseEconomyStatus(payload.economy);
      if (!profile || !economy) throw new ProfileRequestError(DEFAULT_ERROR);
      return { profile, economy };
    };

    const requireRecoveryPayload = async (
      payload: unknown,
    ): Promise<{
      profile: PublicProfile;
      economy: EconomyStatus;
      recoveryWords: string[];
    }> => {
      if (!isRecord(payload)) throw new ProfileRequestError(DEFAULT_ERROR);
      const originalProfile = parseProfile(payload.profile);
      const recoveryWords = parseRecoveryWords(payload.recoveryWords);
      if (!originalProfile || !recoveryWords) {
        throw new ProfileRequestError(DEFAULT_ERROR);
      }
      const includedEconomy = parseEconomyStatus(payload.economy);
      if (includedEconomy) {
        return { profile: originalProfile, economy: includedEconomy, recoveryWords };
      }
      const session = await requestJson(dependencies, '/api/profile/session');
      if (!isRecord(session) || session.state !== 'ready') {
        throw new ProfileRequestError(DEFAULT_ERROR);
      }
      const refreshed = requireProfilePayload(session);
      if (refreshed.profile.id !== originalProfile.id) {
        throw new ProfileRequestError(DEFAULT_ERROR);
      }
      return { ...refreshed, recoveryWords };
    };

    const runAvatarChange = async (avatarId: string): Promise<void> => {
      if (get().phase !== 'ready' || get().action !== null) return;
      const version = ++requestVersion;
      set({ action: 'avatar', error: null });
      try {
        const payload = await requestJson(
          dependencies,
          '/api/profile/avatar',
          postJson({ avatarId }),
        );
        if (version !== requestVersion) return;
        if (!isRecord(payload)) throw new ProfileRequestError(DEFAULT_ERROR);
        const profile = parseProfile(payload.profile);
        if (!profile) throw new ProfileRequestError(DEFAULT_ERROR);
        const economy = get().economy;
        if (economy) {
          publishReady(profile, economy, get().recoveryWarning);
        } else {
          set({ action: null, profile });
        }
      } catch (error) {
        if (version === requestVersion) {
          set({ action: null, error: requestErrorMessage(error) });
        }
      }
    };

    const runClaim = async (kind: 'daily' | 'rescue'): Promise<void> => {
      if (get().phase !== 'ready' || get().action !== null) return;
      const version = ++requestVersion;
      set({ action: kind, error: null });
      try {
        const payload = await requestJson(
          dependencies,
          `/api/economy/${kind}`,
          postJson({}),
        );
        if (version !== requestVersion) return;
        const { profile, economy } = requireProfilePayload(payload);
        publishReady(profile, economy, get().recoveryWarning);
      } catch (error) {
        if (version !== requestVersion) return;
        const claimError = requestErrorMessage(error);
        try {
          const session = await requestJson(dependencies, '/api/profile/session');
          if (version !== requestVersion) return;
          if (isRecord(session) && session.state === 'ready') {
            const { profile, economy } = requireProfilePayload(session);
            publishReady(profile, economy, get().recoveryWarning);
            set({ error: claimError });
            return;
          }
          if (isRecord(session) && session.state === 'anonymous') {
            resetAnonymous(claimError);
            return;
          }
        } catch {
          // Preserve the authenticated snapshot when a best-effort refresh fails.
        }
        if (version === requestVersion) set({ action: null, error: claimError });
      }
    };

    return {
      phase: 'loading',
      action: null,
      profile: null,
      economy: null,
      recoveryWords: null,
      recoveryWarning: false,
      error: null,

      bootstrap: () => {
        if (bootstrapPromise) return bootstrapPromise;
        if (get().phase === 'recovery-required') return Promise.resolve();
        const version = ++requestVersion;
        set({ phase: 'loading', error: null });
        const work = (async () => {
          try {
            const payload = await requestJson(dependencies, '/api/profile/session');
            if (version !== requestVersion) return;
            if (isRecord(payload) && payload.state === 'anonymous') {
              resetAnonymous(null);
              return;
            }
            if (!isRecord(payload) || payload.state !== 'ready') {
              throw new ProfileRequestError(DEFAULT_ERROR);
            }
            const { profile, economy } = requireProfilePayload(payload);
            const acknowledged = hasRecoveryAcknowledgement(profile.id);
            publishReady(profile, economy, !acknowledged);
          } catch (error) {
            if (version !== requestVersion) return;
            resetAnonymous(requestErrorMessage(error));
          }
        })();
        const pending = work.finally(() => {
          if (bootstrapPromise === pending) bootstrapPromise = null;
        });
        bootstrapPromise = pending;
        return pending;
      },

      refresh: () => {
        if (get().phase !== 'ready' || get().action !== null) return Promise.resolve();
        if (refreshPromise) return refreshPromise;
        const version = ++requestVersion;
        set({ error: null });
        const work = (async () => {
          try {
            const payload = await requestJson(dependencies, '/api/profile/session');
            if (version !== requestVersion) return;
            if (isRecord(payload) && payload.state === 'ready') {
              const { profile, economy } = requireProfilePayload(payload);
              publishReady(profile, economy, get().recoveryWarning);
              return;
            }
            if (isRecord(payload) && payload.state === 'anonymous') {
              resetAnonymous(null);
              return;
            }
            throw new ProfileRequestError(DEFAULT_ERROR);
          } catch (error) {
            if (version === requestVersion) {
              set({ error: requestErrorMessage(error) });
            }
          }
        })();
        const pending = work.finally(() => {
          if (refreshPromise === pending) refreshPromise = null;
        });
        refreshPromise = pending;
        return pending;
      },

      create: avatarId => startIdentityOperation(async () => {
        const version = ++requestVersion;
        set({
          phase: 'creating', action: null, profile: null, economy: null,
          recoveryWords: null, recoveryWarning: false, error: null,
        });
        try {
          const payload = await requestJson(
            dependencies,
            '/api/profile/create',
            postJson({ avatarId, adultConfirmed: true }),
          );
          if (version !== requestVersion) return;
          const { profile, economy, recoveryWords } = await requireRecoveryPayload(payload);
          if (version !== requestVersion) return;
          if (connectedProfileId !== null || get().profile !== null) {
            dependencies.game.disconnect();
            dependencies.game.clearPublicProfile();
            connectedProfileId = null;
          }
          forgetRecoveryAcknowledgement(profile.id);
          set({
            phase: 'recovery-required',
            action: null,
            profile,
            economy,
            recoveryWords,
            recoveryWarning: true,
            error: null,
          });
        } catch (error) {
          if (version !== requestVersion) return;
          set({
            phase: 'anonymous', action: null, profile: null, economy: null,
            recoveryWords: null, recoveryWarning: false,
            error: requestErrorMessage(error),
          });
        }
      }),

      recover: recoveryInput => {
        if (identityOperationPromise) return identityOperationPromise;
        const normalized = normalizeRecoveryWords(recoveryInput);
        if (!normalized) {
          set({ phase: 'anonymous', error: '복구 단어 12개를 확인해 주세요.' });
          return Promise.resolve();
        }
        return startIdentityOperation(async () => {
          const version = ++requestVersion;
          set({
            phase: 'recovering', action: null, profile: null, economy: null,
            recoveryWords: null, recoveryWarning: false, error: null,
          });
          try {
            const payload = await requestJson(
              dependencies,
              '/api/profile/recover',
              postJson({ recoveryWords: normalized }),
            );
            if (version !== requestVersion) return;
            const { profile, economy, recoveryWords } = await requireRecoveryPayload(payload);
            if (version !== requestVersion) return;
            if (connectedProfileId !== null || get().profile !== null) {
              dependencies.game.disconnect();
              dependencies.game.clearPublicProfile();
              connectedProfileId = null;
            }
            forgetRecoveryAcknowledgement(profile.id);
            set({
              phase: 'recovery-required', action: null, profile, economy,
              recoveryWords, recoveryWarning: true, error: null,
            });
          } catch (error) {
            if (version !== requestVersion) return;
            set({
              phase: 'anonymous', action: null, profile: null, economy: null,
              recoveryWords: null, recoveryWarning: false,
              error: requestErrorMessage(error),
            });
          }
        });
      },

      acknowledgeRecovery: () => {
        const { phase, profile, economy } = get();
        if (phase !== 'recovery-required' || !profile || !economy) return;
        rememberRecoveryAcknowledgement(profile.id);
        publishReady(profile, economy, false);
      },

      skipRecovery: () => {
        const { phase, profile, economy } = get();
        if (phase !== 'recovery-required' || !profile || !economy) return;
        forgetRecoveryAcknowledgement(profile.id);
        publishReady(profile, economy, true);
      },

      rotateRecovery: async () => {
        const { profile, economy } = get();
        if (get().phase !== 'ready' || !profile || !economy || get().action !== null) return;
        const version = ++requestVersion;
        set({ action: 'rotating', error: null });
        try {
          const payload = await requestJson(
            dependencies,
            '/api/profile/recovery/rotate',
            postJson({}),
          );
          if (version !== requestVersion) return;
          const recoveryWords = isRecord(payload)
            ? parseRecoveryWords(payload.recoveryWords)
            : null;
          if (!recoveryWords) throw new ProfileRequestError(DEFAULT_ERROR);
          forgetRecoveryAcknowledgement(profile.id);
          set({
            phase: 'recovery-required', action: null, recoveryWords,
            recoveryWarning: true, error: null,
          });
        } catch (error) {
          if (version !== requestVersion) return;
          set({ phase: 'ready', action: null, error: requestErrorMessage(error) });
        }
      },

      deleteProfile: async confirmation => {
        if (get().phase !== 'ready' || get().action !== null) return;
        const version = ++requestVersion;
        const currentProfile = get().profile;
        set({ action: 'deleting', error: null });
        try {
          await requestJson(
            dependencies,
            '/api/profile',
            { ...postJson({ confirmation }), method: 'DELETE' },
          );
          if (version !== requestVersion) return;
          if (currentProfile) {
            forgetRecoveryAcknowledgement(currentProfile.id);
          }
          resetAnonymous(null);
        } catch (error) {
          if (version !== requestVersion) return;
          set({ phase: 'ready', action: null, error: requestErrorMessage(error) });
        }
      },

      claimDaily: () => runClaim('daily'),
      claimRescue: () => runClaim('rescue'),
      changeAvatar: avatarId => runAvatarChange(avatarId),
      clearError: () => set({ error: null }),
    };
  });
}

const browserStorage: StorageLike = {
  getItem: key => typeof window === 'undefined' ? null : window.localStorage.getItem(key),
  setItem: (key, value) => {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
  },
  removeItem: key => {
    if (typeof window !== 'undefined') window.localStorage.removeItem(key);
  },
};

const browserGame: ProfileGameBridge = {
  connect: () => useGameStore.getState().connect(),
  disconnect: () => useGameStore.getState().disconnect(),
  needsFreshConnection: () => useGameStore.getState().needsFreshConnection(),
  setPublicProfile: profile => useGameStore.getState().setPublicProfile(profile),
  clearPublicProfile: () => useGameStore.getState().clearPublicProfile(),
};

export const useProfileStore = createProfileStore({
  fetch: (input, init) => fetch(input, init),
  storage: browserStorage,
  game: browserGame,
});
