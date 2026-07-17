'use client';

import { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

/** Chrome 계열의 beforeinstallprompt — 표준 타입이 없어 직접 선언 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISS_KEY = 'pwa-install-dismissed-at';
const INSTALLED_KEY = 'pwa-installed';
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000; // 닫기 후 7일간 다시 묻지 않음
const SHOW_DELAY_MS = 1500; // 첫 화면이 자리 잡은 뒤 슬며시 내려오게

function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari 홈화면 실행
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isSnoozed(): boolean {
  try {
    if (localStorage.getItem(INSTALLED_KEY)) return true;
    const at = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return at > 0 && Date.now() - at < SNOOZE_MS;
  } catch {
    return false;
  }
}

/**
 * PWA 설치 유도 배너 — 첫 접속 시 화면 상단에서 슬며시 내려온다.
 * Chrome/Edge/삼성인터넷: beforeinstallprompt를 가로채 커스텀 배너의 [설치]로 네이티브 프롬프트 호출.
 * iOS Safari: 설치 API가 없어 공유 → '홈 화면에 추가' 안내 문구로 대체.
 * 이미 설치(standalone 실행)됐거나 최근 닫았으면(7일) 표시하지 않는다.
 */
export default function InstallPrompt() {
  const [mode, setMode] = useState<'hidden' | 'install' | 'ios'>('hidden');
  const promptRef = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (isStandalone() || isSnoozed()) return;

    let showTimer: ReturnType<typeof setTimeout> | null = null;

    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      promptRef.current = e as BeforeInstallPromptEvent;
      if (showTimer) clearTimeout(showTimer);
      showTimer = setTimeout(() => setMode('install'), SHOW_DELAY_MS);
    };
    const onInstalled = () => {
      try { localStorage.setItem(INSTALLED_KEY, '1'); } catch { /* private mode */ }
      setMode('hidden');
    };

    window.addEventListener('beforeinstallprompt', onBeforeInstall);
    window.addEventListener('appinstalled', onInstalled);

    // iOS는 beforeinstallprompt가 없다 — Safari에서만 수동 안내
    const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isIos) {
      showTimer = setTimeout(() => setMode('ios'), SHOW_DELAY_MS);
    }

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
      window.removeEventListener('appinstalled', onInstalled);
      if (showTimer) clearTimeout(showTimer);
    };
  }, []);

  const dismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* private mode */ }
    setMode('hidden');
  };

  const install = async () => {
    const evt = promptRef.current;
    if (!evt) return;
    promptRef.current = null;
    setMode('hidden');
    await evt.prompt();
    const choice = await evt.userChoice;
    if (choice.outcome === 'accepted') {
      try { localStorage.setItem(INSTALLED_KEY, '1'); } catch { /* private mode */ }
    } else {
      try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* private mode */ }
    }
  };

  return (
    <AnimatePresence>
      {mode !== 'hidden' && (
        <motion.div
          initial={{ y: '-120%' }}
          animate={{ y: 0 }}
          exit={{ y: '-120%' }}
          transition={{ type: 'spring', damping: 22, stiffness: 260 }}
          className="fixed top-0 left-0 right-0 z-[90] px-3 pt-safe"
        >
          <div className="mx-auto mt-2 max-w-md rounded-2xl border border-purple-500/30 bg-[#151024]/95 backdrop-blur-md shadow-[0_8px_30px_rgba(0,0,0,0.6)] p-3 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element -- 정적 아이콘, next/image 불필요 */}
            <img src="/icons/icon-192.png" alt="" className="w-11 h-11 rounded-xl border border-white/10 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-white font-bold text-sm">포커 도장 설치</div>
              {mode === 'install' ? (
                <div className="text-gray-400 text-[11px] leading-tight">홈 화면에 추가하고 앱처럼 바로 실행하세요</div>
              ) : (
                <div className="text-gray-400 text-[11px] leading-tight">
                  Safari 공유 버튼 → <span className="text-purple-300 font-semibold">홈 화면에 추가</span>로 설치할 수 있어요
                </div>
              )}
            </div>
            {mode === 'install' && (
              <button
                onClick={install}
                className="shrink-0 px-3 py-1.5 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-bold transition-colors"
              >
                설치
              </button>
            )}
            <button
              onClick={dismiss}
              aria-label="닫기"
              className="shrink-0 w-7 h-7 rounded-full text-gray-500 hover:text-gray-300 text-lg leading-none"
            >
              &times;
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
