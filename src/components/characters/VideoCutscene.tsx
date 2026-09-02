'use client';

import { useEffect, useRef } from 'react';
import type { StoryVideo } from '@/lib/assets/story-video';

interface VideoCutsceneProps {
  video: StoryVideo;
  /** 첫 프레임 = CG — 로딩 중·실패 시에도 같은 그림 */
  poster: string;
  alt: string;
  className?: string;
  /** 파일 없음/디코딩 실패/1.5초 내 canplay 미도달 → 부모가 정지 CG로 교체 */
  onFallback: () => void;
}

const CANPLAY_TIMEOUT_MS = 1_500;

/**
 * 컷신 영상 슬롯 — muted·playsInline·autoPlay·loop(iOS 자동재생 조건), preload none + poster.
 * reduced-motion은 부모가 아예 마운트하지 않는다(정지 CG). 실패는 콜백으로만 알리고 스스로는 아무것도 그리지 않는다.
 */
export default function VideoCutscene({ video, poster, alt, className = '', onFallback }: VideoCutsceneProps) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let settled = false;
    const ok = () => { settled = true; };
    const fail = () => {
      if (settled) return;
      settled = true;
      onFallback();
    };
    el.addEventListener('canplay', ok, { once: true });
    el.addEventListener('error', fail, { once: true });
    const timer = setTimeout(fail, CANPLAY_TIMEOUT_MS);
    el.load();
    void el.play().catch(() => { /* 자동재생 차단 — poster가 보이므로 그대로 둔다 */ });
    return () => {
      clearTimeout(timer);
      el.removeEventListener('canplay', ok);
      el.removeEventListener('error', fail);
    };
  }, [video.webm, video.mp4, onFallback]);
  return (
    <video
      ref={ref}
      muted
      playsInline
      autoPlay
      loop
      preload="none"
      poster={poster}
      aria-label={alt}
      className={className}
      disablePictureInPicture
    >
      <source src={video.webm} type="video/webm" />
      <source src={video.mp4} type="video/mp4" />
    </video>
  );
}
