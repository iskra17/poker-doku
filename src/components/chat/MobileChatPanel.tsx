'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '@/lib/store/game-store';
import { ACTION_DOCK_HEIGHT } from '../table/ActionBar';
import ChatBubble from './ChatBubble';
import ChatPresetPicker from './ChatPresetPicker';

export default function MobileChatPanel() {
  const { chatMessages, sendChat } = useGameStore();
  const [isOpen, setIsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 프리셋 전송 → 시트를 닫아 테이블 위 내 말풍선이 보이게 (전송 피드백 잠깐 보여준 뒤)
  const handleSend = (presetId: string) => {
    sendChat(presetId);
    setTimeout(() => setIsOpen(false), 350);
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  return (
    <>
      {/* Chat toggle button — 액션 독(불투명, z-30)보다 위에 떠야 가려지지 않는다 */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed right-3 z-30 w-10 h-10 rounded-full bg-purple-600/80 backdrop-blur-sm flex items-center justify-center text-white shadow-lg border border-purple-500/30"
        style={{ bottom: `calc(${ACTION_DOCK_HEIGHT + 12}px + var(--safe-bottom))` }}
      >
        💬
        {chatMessages.length > 0 && (
          <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 rounded-full text-[9px] flex items-center justify-center font-bold">
            {Math.min(chatMessages.length, 99)}
          </span>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 z-30"
              onClick={() => setIsOpen(false)}
            />
            {/* Bottom sheet */}
            <motion.div
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 300 }}
              className="fixed bottom-0 left-0 right-0 z-40 bg-[#0d0818]/98 backdrop-blur-md rounded-t-2xl border-t border-purple-500/20 flex flex-col pb-safe"
              style={{ maxHeight: '60dvh' }}
            >
              {/* Handle */}
              <div className="flex justify-center py-2">
                <div className="w-10 h-1 bg-gray-600 rounded-full" />
              </div>

              {/* Header */}
              <div className="px-4 pb-2 flex items-center justify-between">
                <h3 className="text-purple-300 font-bold text-sm">Chat</h3>
                <button onClick={() => setIsOpen(false)} className="text-gray-400 text-lg">&times;</button>
              </div>

              {/* Messages */}
              <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 space-y-0.5 scrollbar-thin">
                {chatMessages.map(msg => (
                  <ChatBubble key={msg.id} message={msg} />
                ))}
                {chatMessages.length === 0 && (
                  <p className="text-gray-600 text-xs text-center mt-4">No messages yet...</p>
                )}
              </div>

              {/* 프리셋 픽커 — 자유 타이핑 대신 문구/이모지 선택. 전송 시 시트 자동 닫힘 */}
              <div className="p-3 border-t border-purple-500/20">
                <ChatPresetPicker onSend={handleSend} />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
