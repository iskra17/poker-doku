const STORAGE_KEY = 'poker-doku-session';
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,128}$/u;

interface TokenStorage {
  getItem(key: string): unknown;
  setItem(key: string, value: string): void;
}

interface TransportTokenOptions {
  storage: TokenStorage | null;
  randomUUID?: (() => string) | undefined;
}

export interface TransportTokenProvider {
  getToken(): string;
}

let fallbackCounter = 0;

export function isValidTransportToken(value: unknown): value is string {
  return typeof value === 'string' && TOKEN_PATTERN.test(value);
}

function fallbackToken(): string {
  fallbackCounter += 1;
  let randomPart = '';
  try {
    randomPart = Math.random().toString(36).slice(2);
  } catch {
    randomPart = 'no_random_source';
  }
  return `t_${fallbackCounter.toString(36).padStart(8, '0')}_${randomPart.padEnd(16, '0')}`
    .slice(0, 128);
}

export function createTransportTokenProvider({
  storage,
  randomUUID,
}: TransportTokenOptions): TransportTokenProvider {
  let memoryToken: string | null = null;
  return {
    getToken: () => {
      if (memoryToken) return memoryToken;
      let stored: unknown = null;
      try {
        stored = storage?.getItem(STORAGE_KEY) ?? null;
      } catch {
        stored = null;
      }
      if (isValidTransportToken(stored)) {
        memoryToken = stored;
        return memoryToken;
      }
      let generated: unknown;
      try {
        generated = randomUUID?.();
      } catch {
        generated = null;
      }
      memoryToken = isValidTransportToken(generated) ? generated : fallbackToken();
      try {
        storage?.setItem(STORAGE_KEY, memoryToken);
      } catch {
        // Diagnostic token remains stable in module memory when storage is unavailable.
      }
      return memoryToken;
    },
  };
}

const browserProvider = createTransportTokenProvider({
  storage: {
    getItem: key => typeof window === 'undefined' ? null : window.localStorage.getItem(key),
    setItem: (key, value) => {
      if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
    },
  },
  randomUUID: () => {
    if (typeof globalThis.crypto?.randomUUID !== 'function') return '';
    return globalThis.crypto.randomUUID();
  },
});

export function getBrowserTransportToken(): string {
  return browserProvider.getToken();
}
