'use client';

import { useGallery } from './use-gallery';

/** 로비 헤더 기록실 아이콘의 NEW 점 — 안 본 해금 항목이 있을 때만 */
export default function GalleryNewDot() {
  const { newIds } = useGallery();
  if (newIds.size === 0) return null;
  return (
    <span
      aria-label={`새 기록 ${newIds.size}개`}
      className="pointer-events-none absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-blossom px-1 text-[9px] font-black text-white shadow"
    >
      {newIds.size > 9 ? '9+' : newIds.size}
    </span>
  );
}
