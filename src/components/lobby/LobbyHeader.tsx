'use client';

/* eslint-disable @next/next/no-img-element */

import { useState } from 'react';
import NeonText from '../ui/NeonText';

export default function LobbyHeader({ onOpenSettings, onOpenFeedback, onOpenHistory }: {
  onOpenSettings?: () => void;
  onOpenFeedback?: () => void;
  onOpenHistory?: () => void;
}) {
  const [logoError, setLogoError] = useState(false);

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
      {onOpenHistory && (
        <button
          type="button"
          onClick={onOpenHistory}
          aria-label="핸드 히스토리"
          className="absolute right-24 top-4 z-20 rounded-full border border-mystic/20 bg-panel/80 p-2 text-ink-dim transition-colors hover:text-ink"
        >
          {/* 히스토리(시계 되감기) 아이콘 */}
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 3v5h5" />
            <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
            <path d="M12 7v5l4 2" />
          </svg>
        </button>
      )}
      {onOpenFeedback && (
        <button
          type="button"
          onClick={onOpenFeedback}
          aria-label="문의 및 건의"
          className="absolute right-14 top-4 z-20 rounded-full border border-mystic/20 bg-panel/80 p-2 text-ink-dim transition-colors hover:text-ink"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
          </svg>
        </button>
      )}
      {onOpenSettings && (
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="설정"
          className="absolute right-4 top-4 z-20 rounded-full border border-mystic/20 bg-panel/80 p-2 text-ink-dim transition-colors hover:text-ink"
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34A1.7 1.7 0 0 0 14 20.92V21a2 2 0 1 1-4 0v-.09a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.93 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.09a1.7 1.7 0 0 0 1.56-1.11 1.7 1.7 0 0 0-.34-1.87l-.06-.06A2 2 0 1 1 7.08 4.1l.06.06A1.7 1.7 0 0 0 9 4.5h.01A1.7 1.7 0 0 0 10.03 3V3a2 2 0 1 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.5 9v.01A1.7 1.7 0 0 0 21 10.03H21a2 2 0 1 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15z" />
          </svg>
        </button>
      )}
    </header>
  );
}
