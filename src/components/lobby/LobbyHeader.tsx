'use client';

/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from 'react';
import { registerSecretTap, type SecretTapState } from '@/lib/operator/secret-tap';
import { useGameStore } from '@/lib/store/game-store';
import { useOperatorStore } from '@/lib/store/operator-store';
import { useSettingsStore } from '@/lib/store/settings-store';
import GalleryNewDot from '../gallery/GalleryNewDot';
import NeonText from '../ui/NeonText';
import NowPlayingButton from './NowPlayingButton';

/**
 * 로비 헤더.
 * - hero(기본): 온보딩 화면용 — 큰 로고를 중앙에 크게.
 * - compact: 로비 본화면용 — 작은 로고와 핵심 사운드 제어만 남기고 나머지는 더보기 메뉴로 묶는다.
 */
export default function LobbyHeader({ compact, onOpenSettings, onOpenFeedback, onOpenHistory, onOpenHelp, onOpenGallery }: {
  compact?: boolean;
  onOpenSettings?: () => void;
  onOpenFeedback?: () => void;
  onOpenHistory?: () => void;
  onOpenHelp?: () => void;
  /** 기록실(인연 씬·이벤트 CG·의상·칭호 갤러리) — 새 항목이 있으면 NEW 점 */
  onOpenGallery?: () => void;
}) {
  const [logoError, setLogoError] = useState(false);
  const [utilityOpen, setUtilityOpen] = useState(false);
  const { muted, musicMuted, toggleAllMuted } = useSettingsStore();
  const allMuted = muted && musicMuted;

  // 비밀 제스처 — compact 로고를 3초 안에 7번 탭하면 운영자 모드 토글. 서버 capability(operator)가 없는
  // 프로필은 아무 반응이 없다(조용히 무시). 토글 결과는 2.4초 안내 후 사라지고, 켜져 있는 동안 'OP' 배지가 남는다.
  const isOperator = useGameStore(state => state.isOperator);
  const operatorEnabled = useOperatorStore(state => state.enabled);
  const toggleOperator = useOperatorStore(state => state.toggle);
  const tapRef = useRef<SecretTapState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 2_400);
    return () => clearTimeout(timer);
  }, [notice]);
  const onLogoTap = () => {
    if (!isOperator) return;
    const result = registerSecretTap(tapRef.current, Date.now());
    tapRef.current = result.state;
    if (!result.triggered) return;
    const enabled = toggleOperator();
    setNotice(enabled ? '운영자 모드 ON — 모든 보상 미리보기 · 수련 스킵' : '운영자 모드 OFF');
  };
  const operatorOn = isOperator && operatorEnabled;

  if (!compact) {
    return (
      <header className="relative overflow-hidden border-b border-white/10 py-4 text-center md:py-6">
        <div className="relative z-10 flex flex-col items-center">
          {logoError ? (
            <h1 className="text-3xl font-bold md:text-4xl">
              <NeonText size="lg" color="#D68189">
                POKER DOKU
              </NeonText>
            </h1>
          ) : (
            <img
              src="/assets/logo.webp"
              alt="POKER DOKU"
              className="h-28 w-auto opacity-90 mix-blend-screen md:h-40"
              onError={() => setLogoError(true)}
              draggable={false}
            />
          )}
        </div>
      </header>
    );
  }

  return (
    <header className="relative z-20 border-b border-white/10 bg-abyss/60 py-1.5">
      <div className="mx-auto flex w-full max-w-4xl items-center justify-between gap-2 px-3 md:px-4">
        {/* 로고 — 비밀 제스처 대상(운영자만 반응). 일반 유저에겐 그냥 로고라 button 의미론을 주지 않는다 */}
        <span className="flex select-none items-center gap-1.5" onClick={onLogoTap} data-testid="lobby-logo">
          {logoError ? (
            <h1 className="text-lg font-bold">
              <NeonText size="sm" color="#D68189">POKER DOKU</NeonText>
            </h1>
          ) : (
            <img
              src="/assets/logo.webp"
              alt="POKER DOKU"
              className="h-10 w-auto opacity-90 mix-blend-screen md:h-12"
              onError={() => setLogoError(true)}
              draggable={false}
            />
          )}
          {operatorOn && (
            <span
              className="rounded border border-gilded/60 bg-gilded/15 px-1 py-0.5 text-xs font-black tracking-wider text-gilded"
              title="운영자 모드 — 로고를 7번 탭하면 꺼져요"
              aria-label="운영자 모드 켜짐"
            >
              OP
            </span>
          )}
        </span>
        <div className="flex items-center gap-1">
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
          <NowPlayingButton onOpenSettings={onOpenSettings} />
          <button
            type="button"
            onClick={() => setUtilityOpen(value => !value)}
            aria-label="더보기"
            aria-expanded={utilityOpen}
            aria-controls="lobby-utility-menu"
            className="min-h-11 min-w-11 rounded-xl border border-white/10 bg-panel/80 px-2 text-sm font-bold text-ink-dim transition-colors hover:border-blossom/40 hover:text-ink"
          >
            {utilityOpen ? '닫기' : '더보기'}
          </button>
        </div>
      </div>
      {utilityOpen && (
        <div id="lobby-utility-menu" className="mx-auto mt-1 w-full max-w-4xl px-3 pb-2 md:px-4">
          <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-white/10 bg-panel p-1.5 sm:grid-cols-3 md:grid-cols-5">
            {onOpenGallery && (
              <span className="relative">
                <UtilityButton label="기록실" onClick={() => { setUtilityOpen(false); onOpenGallery(); }} />
                <GalleryNewDot />
              </span>
            )}
            {onOpenHelp && <UtilityButton label="도움말" onClick={() => { setUtilityOpen(false); onOpenHelp(); }} />}
            {onOpenHistory && <UtilityButton label="핸드 히스토리" onClick={() => { setUtilityOpen(false); onOpenHistory(); }} />}
            {onOpenFeedback && <UtilityButton label="문의 및 건의" onClick={() => { setUtilityOpen(false); onOpenFeedback(); }} />}
            {onOpenSettings && <UtilityButton label="설정" onClick={() => { setUtilityOpen(false); onOpenSettings(); }} />}
          </div>
        </div>
      )}
      {notice && (
        <p
          role="status"
          className="pointer-events-none absolute left-1/2 top-full z-20 mt-1 -translate-x-1/2 whitespace-nowrap rounded-lg border border-gilded/50 bg-abyss/95 px-3 py-1.5 text-xs font-bold text-gilded"
        >
          {notice}
        </p>
      )}
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
      className="min-h-11 min-w-11 rounded-xl border border-white/10 bg-panel/80 p-2 text-ink-dim transition-colors hover:border-blossom/40 hover:text-ink"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        {children}
      </svg>
    </button>
  );
}

function UtilityButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="min-h-11 rounded-lg px-3 text-left text-sm font-bold text-ink-dim transition-colors hover:bg-elevated hover:text-ink"
    >
      {label}
    </button>
  );
}
