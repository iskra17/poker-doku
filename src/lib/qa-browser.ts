/** QA isolates transport identity and first-table guidance; profile credentials remain HttpOnly. */
export function isQaGame(): boolean {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('qa') === '1';
}

export function qaAwareStorage() {
  const qa = isQaGame();
  const storage = qa ? window.sessionStorage : window.localStorage;
  return {
    getItem: (key: string) => storage.getItem(qa ? `qa:${key}` : key),
    setItem: (key: string, value: string) => storage.setItem(qa ? `qa:${key}` : key, value),
  };
}

export function resetQaBrowserState(): void {
  // Only these QA-owned values reset. The normal account's browser settings stay intact.
  window.sessionStorage.removeItem('qa:poker-doku-session');
  window.sessionStorage.removeItem('qa:poker-doku-coachmarks-v1');
}
