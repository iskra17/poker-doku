'use client';

/* eslint-disable @next/next/no-img-element */

import { useState } from 'react';
import { useSettingsStore } from '@/lib/store/settings-store';
import NeonText from '../ui/NeonText';

/**
 * 로비 헤더.
 * - hero(기본): 온보딩 화면용 — 큰 로고를 중앙에 크게.
 * - compact: 로비 본화면용 — 화면을 아끼는 한 줄 바. 좌측 작은 로고 + 우측 아이콘 열.
 *   로비는 고정 헤더 + 테이블 목록만 스크롤 구조라 헤더가 얇아야 목록이 넓어진다.
 */
export default function LobbyHeader({ compact, onOpenSettings, onOpenFeedback, onOpenHistory, onOpenHelp }: {
  compact?: boolean;
  onOpenSettings?: () => void;
  onOpenFeedback?: () => void;
  onOpenHistory?: () => void;
  onOpenHelp?: () => void;
}) {
  const [logoError, setLogoError] = useState(false);
  const { muted, musicMuted, toggleAllMuted } = useSettingsStore();
  const allMuted = muted && musicMuted;

  if (!compact) {
    return (
      <header className="relative py-4 md:py-6 text-center overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-b from-purple-900/20 to-transparent" />
        <div className="relative z-10 flex flex-col items-center">
          {logoError ? (
            <h1 className="text-3xl md:text-4xl font-bold">
              <NeonText size="lg" color="#A78BFA">
                POKER DOKU
              </NeonText>
            </h1>
          ) : (
            <img
              src="/assets/logo.webp"
              alt="POKER DOKU"
              // mix-blend-screen: 네온 글로우 주변의 반투명 다크 헤일로를 다크 배경에 녹인다
              className="h-28 md:h-40 w-auto mix-blend-screen drop-shadow-[0_0_24px_rgba(255,126,182,0.35)]"
              onError={() => setLogoError(true)}
              draggable={false}
            />
          )}
        </div>
      </header>
    );
  }

  return (
    <header className="flex items-center justify-between gap-2 px-3 py-1.5 md:px-4">
      {logoError ? (
        <h1 className="text-lg font-bold">
          <NeonText size="sm" color="#A78BFA">POKER DOKU</NeonText>
        </h1>
      ) : (
        <img
          src="/assets/logo.webp"
          alt="POKER DOKU"
          className="h-10 w-auto mix-blend-screen drop-shadow-[0_0_12px_rgba(255,126,182,0.3)] md:h-12"
          onError={() => setLogoError(true)}
          draggable={false}
        />
      )}
      <div className="flex items-center gap-1.5">
        <IconButton label={allMuted ? '사운드 켜기' : '사운드 끄기'} onClick={toggleAllMuted}>
          <path d="M11 5 6 9H3v6h3l5 4V5z" fill="currentColor" stroke="none" />
          {allMuted ? (
            <path d="M22 4 4 22" className="text-red-400" />
          ) : (
            <>
              <path d="M15.5 8.5a5 5 0 0 1 0 7" />
              <path d="M18.5 5.5a9.5 9.5 0 0 1 0 13" />
            </>
          )}
        </IconButton>
        {onOpenHelp && (
          <IconButton label="도움말" onClick={onOpenHelp}>
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </IconButton>
        )}
        {onOpenHistory && (
          <IconButton label="핸드 히스토리" onClick={onOpenHistory}>
            <path d="M3 3v5h5" />
            <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
            <path d="M12 7v5l4 2" />
          </IconButton>
        )}
        {onOpenFeedback && (
          <IconButton label="문의 및 건의" onClick={onOpenFeedback}>
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </IconButton>
        )}
        {onOpenSettings && (
          <IconButton label="설정" onClick={onOpenSettings}>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34A1.7 1.7 0 0 0 14 20.92V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.93 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06A2 2 0 1 1 7.08 4.1l.06.06A1.7 1.7 0 0 0 9 4.5h.01A1.7 1.7 0 0 0 10.03 3V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.5 9v.01A1.7 1.7 0 0 0 21 10.03H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15z" />
          </IconButton>
        )}
      </div>
    </header>
  );
}

function IconButton({ label, onClick, children }: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="rounded-full border border-mystic/20 bg-panel/80 p-2 text-ink-dim transition-colors hover:text-ink"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  );
}
