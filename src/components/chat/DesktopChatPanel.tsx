'use client';

import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useGameStore } from '@/lib/store/game-store';
import ChatBubble from './ChatBubble';
import ChatPresetPicker from './ChatPresetPicker';

export default function DesktopChatPanel() {
  const { chatMessages, sendChat } = useGameStore();
  const [isCollapsed, setIsCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  // absolute 배치 — GameRoomView의 중앙 컨테이너(max-w) 안에 앉아 광폭 화면에서 테이블 곁에 붙는다
  return (
    <motion.div
      initial={{ x: 300 }}
      animate={{ x: 0 }}
      className={`absolute right-0 top-0 bottom-0 z-20 flex flex-col rounded-l-xl bg-[#0d0818]/95 backdrop-blur-md border-l border-purple-500/20 transition-all duration-300 ${isCollapsed ? 'w-10' : 'w-72'}`}
    >
      <button
        onClick={() => setIsCollapsed(!isCollapsed)}
        className="absolute -left-8 top-1/2 -translate-y-1/2 w-8 h-16 bg-[#0d0818]/90 border border-purple-500/20 border-r-0 rounded-l-lg flex items-center justify-center text-purple-400 hover:text-white transition-colors"
      >
        {isCollapsed ? '◀' : '▶'}
      </button>

      {!isCollapsed && (
        <>
          <div className="p-3 border-b border-purple-500/20">
            <h3
              className="text-purple-300 font-bold text-sm"
              style={{ textShadow: '0 0 10px rgba(168, 85, 247, 0.3)' }}
            >
              Chat
            </h3>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-2 space-y-0.5 scrollbar-thin">
            {chatMessages.map(msg => (
              <ChatBubble key={msg.id} message={msg} />
            ))}
            {chatMessages.length === 0 && (
              <p className="text-gray-600 text-xs text-center mt-4">No messages yet...</p>
            )}
          </div>

          {/* 프리셋 픽커 — 자유 타이핑 대신 문구/이모지 선택 */}
          <div className="p-2 border-t border-purple-500/20">
            <ChatPresetPicker onSend={sendChat} />
          </div>
        </>
      )}
    </motion.div>
  );
}
