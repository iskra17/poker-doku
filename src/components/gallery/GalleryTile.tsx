'use client';

import { useState } from 'react';
import TitlePlate from '@/components/cosmetics/TitlePlate';
import { resolveTitle } from '@/lib/cosmetics/titles';
import type { GalleryEntry } from '@/lib/gallery/catalog';

/**
 * 기록실 타일 — 잠김(🔒 + 조건)·해금(이미지/칭호 플레이트 + 이름 + NEW).
 * 인연 탭 갤러리와 기록실 모달이 함께 쓴다. 배경은 가로, 나머지는 세로 2:3.
 */
export default function GalleryTile({ entry, isNew = false, onOpen }: { entry: GalleryEntry; isNew?: boolean; onOpen?: (entry: GalleryEntry) => void }) {
  const [broken, setBroken] = useState(false);
  const aspect = entry.section === 'bg' ? 'aspect-video' : 'aspect-[2/3]';
  if (!entry.unlocked) {
    return (
      <div
        aria-label={`잠김 — ${entry.name} · ${entry.hint}`}
        title={`${entry.name} · ${entry.hint}`}
        className={`flex ${aspect} flex-col items-center justify-center rounded-lg border border-white/10 bg-abyss/60 px-1 text-center`}
      >
        <span className="text-sm">🔒</span>
        <span className="mt-0.5 line-clamp-2 text-[8px] leading-tight text-ink-dim">{entry.hint}</span>
      </div>
    );
  }
  const title = entry.section === 'title' ? resolveTitle(entry.id) : null;
  return (
    <button
      type="button"
      onClick={() => onOpen?.(entry)}
      aria-label={`${entry.name}${isNew ? ' (새 항목)' : ''}`}
      className={`group relative ${aspect} overflow-hidden rounded-lg border ${isNew ? 'border-blossom/70' : 'border-gilded/30'} bg-panel/60`}
    >
      {entry.section === 'title' ? (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-b from-mystic/25 to-abyss/20 p-1.5">
          {title ? <TitlePlate title={title} size="sm" /> : <span className="text-[10px] text-ink">{entry.name}</span>}
        </div>
      ) : entry.art && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element -- 정적 CG/의상/배경 썸네일(webp)
        <img src={entry.art} alt={entry.name} draggable={false} onError={() => setBroken(true)} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-2xl" aria-hidden>🖼</div>
      )}
      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-abyss/85 to-transparent px-1 pb-0.5 pt-2 text-left text-[8px] font-bold text-white">
        {entry.name}
      </span>
      {isNew && (
        <span className="absolute right-1 top-1 rounded-full bg-blossom px-1.5 py-0.5 text-[8px] font-black tracking-wider text-white shadow" aria-hidden>
          NEW
        </span>
      )}
    </button>
  );
}
