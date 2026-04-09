'use client';

import { ChatMessage } from '@/lib/poker/types';
import { getCharacterById } from '@/lib/characters';

interface ChatBubbleProps {
  message: ChatMessage;
}

export default function ChatBubble({ message }: ChatBubbleProps) {
  if (message.type === 'system') {
    return (
      <div className="text-center py-1">
        <span className="text-gray-500 text-[11px] italic">{message.message}</span>
      </div>
    );
  }

  const character = message.type === 'bot' ? getCharacterById(message.playerId.split('-')[1] || '') : null;
  const nameColor = character?.color || '#A78BFA';

  return (
    <div className="flex gap-2 py-1 px-1 hover:bg-white/5 rounded">
      {/* Avatar indicator */}
      <div
        className="w-5 h-5 rounded-full flex-shrink-0 flex items-center justify-center text-[10px] mt-0.5"
        style={{ background: `${nameColor}30`, color: nameColor }}
      >
        {character?.emoji || '👤'}
      </div>
      <div className="min-w-0">
        <span className="font-bold text-xs mr-1.5" style={{ color: nameColor }}>
          {message.playerName}
        </span>
        <span className="text-gray-300 text-xs break-words">{message.message}</span>
      </div>
    </div>
  );
}
