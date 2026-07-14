'use client';

import { useState } from 'react';
import { CHAT_CATEGORIES } from '@/lib/chat/presets';

interface ChatPresetPickerProps {
  onSend: (presetId: string) => void;
}

/**
 * 프리셋 채팅 픽커 — 자유 타이핑 대신 카테고리 탭 + 문구/이모지 버튼.
 * 탭하면 즉시 전송 (퀵챗 문법). 서버도 프리셋 id만 받으므로 우회 불가.
 */
export default function ChatPresetPicker({ onSend }: ChatPresetPickerProps) {
  const [category, setCategory] = useState(CHAT_CATEGORIES[0].id);
  const [sentId, setSentId] = useState<string | null>(null);

  const active = CHAT_CATEGORIES.find(c => c.id === category) ?? CHAT_CATEGORIES[0];
  const isEmoji = active.id === 'emoji';

  const handleTap = (id: string) => {
    onSend(id);
    // 전송 피드백 — 살짝 하이라이트 후 해제 (쿨다운 700ms와 얼추 맞춤)
    setSentId(id);
    setTimeout(() => setSentId(cur => (cur === id ? null : cur)), 700);
  };

  return (
    <div>
      {/* 카테고리 탭 */}
      <div className="flex gap-1 mb-2">
        {CHAT_CATEGORIES.map(c => (
          <button
            key={c.id}
            onClick={() => setCategory(c.id)}
            className={`flex-1 py-1 rounded-md text-[11px] font-bold transition-colors ${
              category === c.id
                ? 'bg-purple-600 text-white'
                : 'bg-gray-800/50 text-gray-400 hover:text-gray-200'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* 프리셋 그리드 — 이모지는 촘촘하게, 문구는 2열 */}
      <div className={`grid gap-1.5 ${isEmoji ? 'grid-cols-8' : 'grid-cols-2'}`}>
        {active.presets.map(p => (
          <button
            key={p.id}
            onClick={() => handleTap(p.id)}
            className={`rounded-lg border transition-all active:scale-95 ${
              isEmoji ? 'py-1.5 text-lg leading-none' : 'py-2 px-2 text-xs text-left'
            } ${
              sentId === p.id
                ? 'bg-purple-600 border-purple-400 text-white'
                : 'bg-gray-800/50 border-gray-700/30 text-gray-200 hover:border-purple-500/40'
            }`}
          >
            {p.text}
          </button>
        ))}
      </div>
    </div>
  );
}
