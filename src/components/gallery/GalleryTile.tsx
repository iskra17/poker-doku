'use client';

import { useState } from 'react';
import TitlePlate from '@/components/cosmetics/TitlePlate';
import { resolveTitle } from '@/lib/cosmetics/titles';
import type { GalleryEntry, GallerySection } from '@/lib/gallery/catalog';

/** 잠금 칸에 흐린 예고 썸네일을 쓰는 섹션 — 의상·칭호·배경은 기존 🔒 칸 유지 */
const PREVIEW_SECTIONS: ReadonlySet<GallerySection> = new Set<GallerySection>(['bond', 'cg', 'bonus']);

/**
 * 기록실 타일 — 잠김(🔒 + 조건; 인연 씬·이벤트 CG·보너스는 인물·제목 + 흐린 예고 썸네일)·해금(이미지/칭호 플레이트 + 이름 + NEW).
 * 인연 탭 갤러리와 기록실 모달이 함께 쓴다. 배경은 가로, 나머지는 세로 2:3.
 */
export default function GalleryTile({ entry, isNew = false, onOpen }: { entry: GalleryEntry; isNew?: boolean; onOpen?: (entry: GalleryEntry) => void }) {
  const [broken, setBroken] = useState(false);
  const aspect = entry.section === 'bg' ? 'aspect-video' : 'aspect-[2/3]';
  if (!entry.unlocked && PREVIEW_SECTIONS.has(entry.section) && entry.art) {
    // 잠금 예고(2026-10-24 회의 합의 — "예고는 하되 원본은 아낀다"): 인물 이름 + 장면 제목 + 해금 조건,
    // 썸네일은 강하게 흐리고 어둡게만 — 원본을 선명하게 보여 주지 않는다.
    const label = [entry.characterName, entry.title ?? entry.name].filter(Boolean).join(' · ');
    return (
      <div
        aria-label={`잠김 — ${label} · ${entry.hint}`}
        title={`${label} · ${entry.hint}`}
        className={`relative ${aspect} overflow-hidden rounded-lg border border-white/10 bg-abyss/70`}
      >
        {!broken && (
          // eslint-disable-next-line @next/next/no-img-element -- 잠금 예고용 흐린 썸네일(webp)
          <img
            src={entry.art}
            alt=""
            aria-hidden
            draggable={false}
            onError={() => setBroken(true)}
            className="pointer-events-none h-full w-full scale-125 select-none object-cover opacity-60 blur-xl brightness-[0.35] saturate-50"
          />
        )}
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-abyss/30 px-1 text-center">
          <span className="text-sm" aria-hidden>🔒</span>
          {entry.characterName && <span className="mt-0.5 block text-[9px] font-bold leading-tight text-ink">{entry.characterName}</span>}
          <span className="line-clamp-2 block text-[8px] leading-tight text-ink/85">{entry.title ?? entry.name}</span>
          <span className="mt-0.5 line-clamp-2 block rounded bg-abyss/60 px-1 text-[8px] leading-tight text-gilded">{entry.hint}</span>
        </div>
      </div>
    );
  }
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
