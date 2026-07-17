import type { MetadataRoute } from 'next';

// PWA 매니페스트 — Next가 /manifest.webmanifest로 서빙하고 <head>에 자동 링크한다.
// 아이콘은 public/icons (logo.webp에서 ffmpeg로 패딩 생성, 배경 #0d0818).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: '포커 도쿠 (Poker Doku)',
    short_name: '포커 도쿠',
    description: '미소녀 캐릭터와 함께하는 6-max 노리밋 홀덤 — 봇 연습부터 친구 대전까지',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0d0818',
    theme_color: '#0d0818',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      // maskable — 로고 주변에 이미 패딩이 있어 세이프존을 만족한다
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' as const },
    ],
  };
}
