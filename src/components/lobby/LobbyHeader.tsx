'use client';

import NeonText from '../ui/NeonText';

export default function LobbyHeader() {
  return (
    <header className="relative py-5 md:py-8 text-center overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-purple-900/20 to-transparent" />

      <div className="relative z-10">
        <h1 className="text-3xl md:text-4xl font-bold">
          <NeonText size="lg" color="#A78BFA">
            POKER DOKU
          </NeonText>
        </h1>
        <p className="text-gray-400 text-xs md:text-sm mt-1.5 md:mt-2 italic">
          ~ Where cards meet destiny ~
        </p>
      </div>

      {/* Cherry blossom petals - fewer on mobile */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="petal absolute text-pink-300/30 text-sm md:text-lg animate-fall"
            style={{
              left: `${10 + i * 18}%`,
              animationDelay: `${i * 0.7}s`,
              animationDuration: `${3 + ((i * 7 + 3) % 5) * 0.5}s`,
            }}
          >
            🌸
          </div>
        ))}
      </div>
    </header>
  );
}
