import { afterEach, describe, expect, it, vi } from 'vitest';
import { qaAwareStorage, resetQaBrowserState } from './qa-browser';

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
}
afterEach(() => vi.unstubAllGlobals());
describe('QA browser state isolation', () => {
  it('keeps the ordinary transport identity and dismissed guide out of a QA game', () => {
    const localStorage = storage(), sessionStorage = storage();
    const location = { search: '' };
    vi.stubGlobal('window', { localStorage, sessionStorage, location });
    qaAwareStorage().setItem('poker-doku-session', 'original-session');
    qaAwareStorage().setItem('poker-doku-coachmarks-v1', '1');
    location.search = '?qa=1';
    expect(qaAwareStorage().getItem('poker-doku-session')).toBeNull();
    expect(qaAwareStorage().getItem('poker-doku-coachmarks-v1')).toBeNull();
    qaAwareStorage().setItem('poker-doku-session', 'test-session');
    expect(qaAwareStorage().getItem('poker-doku-session')).toBe('test-session');
    location.search = '';
    expect(qaAwareStorage().getItem('poker-doku-session')).toBe('original-session');
    expect(qaAwareStorage().getItem('poker-doku-coachmarks-v1')).toBe('1');
  });
  it('resets only QA-owned values so the next test gets a fresh connection and first-table guide', () => {
    const localStorage = storage(), sessionStorage = storage();
    vi.stubGlobal('window', { localStorage, sessionStorage, location: { search: '?qa=1' } });
    localStorage.setItem('poker-doku-session', 'original-session');
    sessionStorage.setItem('unrelated', 'keep');
    qaAwareStorage().setItem('poker-doku-session', 'test-session');
    qaAwareStorage().setItem('poker-doku-coachmarks-v1', '1');
    resetQaBrowserState();
    expect(qaAwareStorage().getItem('poker-doku-session')).toBeNull();
    expect(qaAwareStorage().getItem('poker-doku-coachmarks-v1')).toBeNull();
    expect(localStorage.getItem('poker-doku-session')).toBe('original-session');
    expect(sessionStorage.getItem('unrelated')).toBe('keep');
  });
});
