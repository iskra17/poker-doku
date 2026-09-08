'use client';

import { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { resetQaBrowserState } from '@/lib/qa-browser';

export default function NewUserQa() {
  const [active, setActive] = useState<boolean | null>(null);
  const [csrf, setCsrf] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [frameKey, setFrameKey] = useState(0);
  const pending = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const options = { credentials: 'same-origin' as const, cache: 'no-store' as const, signal: controller.signal };
        const [session, qa] = await Promise.all([
          fetch('/api/admin/session', options), fetch('/api/admin/qa', options),
        ]);
        if (!session.ok || !qa.ok) throw new Error('백오피스 로그인 후 다시 열어 주세요.');
        const [auth, state] = await Promise.all([session.json(), qa.json()]);
        if (typeof auth.csrfToken !== 'string' || typeof state.active !== 'boolean') throw new Error('QA 상태를 확인하지 못했어요.');
        if (controller.signal.aborted) return;
        setCsrf(auth.csrfToken); setActive(state.active);
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '서버에 연결하지 못했어요.');
      }
    })();
    return () => controller.abort();
  }, []);

  const changeAccount = async (method: 'POST' | 'DELETE') => {
    if (!csrf || pending.current) return;
    pending.current = true; setError(null);
    flushSync(() => setBusy(true));
    // Unmount first so the old game cannot make a request using the new account's cookie.
    try {
      const response = await fetch('/api/admin/qa', {
        method, credentials: 'same-origin', cache: 'no-store', headers: { 'x-csrf-token': csrf },
      });
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403
        ? '백오피스에서 다시 로그인한 뒤 이용해 주세요.' : '계정을 전환하지 못했어요. 다시 시도해 주세요.');
      try { resetQaBrowserState(); } catch { /* Storage is optional; remount still resets in-memory state. */ }
      if (method === 'DELETE') {
        window.location.assign('/');
        return;
      }
      setActive(true); setFrameKey(key => key + 1);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '서버에 연결하지 못했어요.');
    } finally {
      pending.current = false; setBusy(false);
    }
  };

  return (
    <main className="flex h-dvh flex-col bg-abyss text-ink pt-safe">
      <header className="shrink-0 border-b border-gilded/30 bg-panel px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-sm font-bold text-gilded">새 사용자 QA</h1>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <a href="/admin" className="px-2 py-1 underline text-ink-dim">백오피스</a>
            {active && <>
              <button disabled={busy} onClick={() => void changeAccount('POST')} className="rounded border border-gilded/40 px-2 py-1 disabled:opacity-40">다시 처음부터</button>
              <button disabled={busy} onClick={() => void changeAccount('DELETE')} className="rounded bg-mystic/20 px-2 py-1 disabled:opacity-40">원래 계정 복귀</button>
            </>}
          </div>
        </div>
        {active && <p className="mt-1 text-[10px] text-ink-dim">실제 신규 계정으로 테스트 중 · 같은 브라우저의 다른 게임 탭은 닫아 주세요.</p>}
        {error && <p role="alert" className="mt-2 text-xs text-blossom">{error}</p>}
      </header>
      {active && !busy ? (
        <iframe key={frameKey} src="/?qa=1" title="신규 사용자 게임 테스트" className="min-h-0 w-full flex-1 border-0" allow="autoplay; fullscreen" />
      ) : (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-5">
          <div className="max-w-md space-y-4 rounded-2xl border border-mystic/30 bg-panel p-6">
            <h2 className="text-lg font-bold">가입 화면부터 다시 테스트하기</h2>
            <p className="text-sm leading-relaxed text-ink-dim">새 계정을 만들어 캐릭터 선택, 첫 수련, 문제 풀이와 보상을 직접 확인합니다. ‘다시 처음부터’를 누를 때마다 새로운 계정으로 시작해요.</p>
            <p className="text-sm leading-relaxed text-ink-dim">기존 계정의 진행도와 칩은 보존합니다. 테스트가 끝나면 ‘원래 계정 복귀’를 눌러 주세요. 테스트 중에는 같은 브라우저의 게임 계정이 전환되므로 다른 게임 탭은 닫아 주세요.</p>
            <button disabled={!csrf || active === null || busy} onClick={() => void changeAccount('POST')} className="w-full rounded-xl bg-gilded px-4 py-3 text-sm font-bold text-abyss disabled:opacity-40">
              {busy ? '계정 전환 중…' : active === null && !error ? 'QA 상태 확인 중…' : '새 사용자 테스트 시작'}
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
