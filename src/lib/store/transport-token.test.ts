import { describe, expect, it, vi } from 'vitest';
import {
  createTransportTokenProvider,
  isValidTransportToken,
} from './transport-token';

describe('diagnostic transport token', () => {
  it('survives unavailable storage and remains stable in memory', () => {
    const storage = {
      getItem: vi.fn(() => { throw new DOMException('blocked', 'SecurityError'); }),
      setItem: vi.fn(() => { throw new DOMException('full', 'QuotaExceededError'); }),
    };
    const provider = createTransportTokenProvider({
      storage,
      randomUUID: () => '12345678-1234-4123-8123-123456789abc',
    });

    expect(provider.getToken()).toBe('12345678-1234-4123-8123-123456789abc');
    expect(provider.getToken()).toBe('12345678-1234-4123-8123-123456789abc');
    expect(storage.getItem).toHaveBeenCalledOnce();
  });

  it.each(['short', 'x'.repeat(10_000), 'contains spaces and secrets'])('replaces corrupt stored token %s', stored => {
    const storage = {
      getItem: vi.fn(() => stored),
      setItem: vi.fn(),
    };
    const provider = createTransportTokenProvider({
      storage,
      randomUUID: () => 'abcdefab-cdef-4abc-8def-abcdefabcdef',
    });

    expect(provider.getToken()).toBe('abcdefab-cdef-4abc-8def-abcdefabcdef');
    expect(storage.setItem).toHaveBeenCalledWith(
      'poker-doku-session',
      'abcdefab-cdef-4abc-8def-abcdefabcdef',
    );
  });

  it('uses a bounded opaque fallback when crypto.randomUUID is unavailable', () => {
    const provider = createTransportTokenProvider({ storage: null, randomUUID: undefined });

    const first = provider.getToken();
    expect(isValidTransportToken(first)).toBe(true);
    expect(first).toBe(provider.getToken());
    expect(first).not.toMatch(/credential|recovery/i);
  });
});
