'use client';

/* eslint-disable @next/next/no-img-element */

import { useState } from 'react';
import NeonText from '../ui/NeonText';

export default function LobbyHeader() {
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
            src="/assets/logo.png"
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
