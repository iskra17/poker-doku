'use client';

import { useGallery } from './use-gallery';

/** 수련 허브 「기록실」 카드 — 섹션별 해금 수 + NEW 수, 탭하면 기록실 모달 */
export default function GalleryCard({ onOpen }: { onOpen: () => void }) {
  const { summary, newIds } = useGallery();
  const bond = summary.find(row => row.section === 'bond');
  const cg = summary.find(row => row.section === 'cg');
  const outfit = summary.find(row => row.section === 'outfit');
  const fresh = newIds.size;
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`기록실 열기${fresh > 0 ? ` — 새 항목 ${fresh}개` : ''}`}
      className="relative flex w-full flex-col items-start rounded-2xl border border-gilded/30 bg-gradient-to-br from-panel/90 to-elevated/60 p-4 text-left transition-colors hover:border-gilded/60"
    >
      <span className="flex items-center gap-2 text-sm font-bold text-gilded">
        <span aria-hidden>🖼</span> 기록실
        {fresh > 0 && <span className="rounded-full bg-blossom px-1.5 py-0.5 text-[9px] font-black tracking-wider text-white">NEW {fresh}</span>}
      </span>
      <span className="mt-1 text-[11px] text-ink-dim">모아 둔 인연 씬·이벤트 CG·의상·칭호를 다시 봐요.</span>
      <span className="mt-2 flex flex-wrap gap-1 text-[10px]">
        <span className="rounded bg-mystic/15 px-1.5 py-0.5 text-mystic">인연 씬 {bond?.unlocked ?? 0}/{bond?.total ?? 0}</span>
        <span className="rounded bg-blossom/15 px-1.5 py-0.5 text-blossom">CG {cg?.unlocked ?? 0}/{cg?.total ?? 0}</span>
        <span className="rounded bg-cyber/15 px-1.5 py-0.5 text-cyber">의상 {outfit?.unlocked ?? 0}/{outfit?.total ?? 0}</span>
      </span>
    </button>
  );
}
