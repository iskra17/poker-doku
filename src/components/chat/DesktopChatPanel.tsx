'use client';

import { useState, useRef, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useGameStore } from '@/lib/store/game-store';
import ChatBubble from './ChatBubble';

export default function DesktopChatPanel() {
  const { chatMessages, sendChat } = useGameStore();
  const [input, setInput] = useState('');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  const handleSend = () => {
    const msg = input.trim();
    if (!msg) return;
    sendChat(msg);
    setInput('');
  };

  return (
    <motion.div
      initial={{ x: 300 }}
      animate={{ x: 0 }}
      className={`fixed right-0 top-0 bottom-0 z-20 flex flex-col bg-[#0d0818]/95 backdrop-blur-md border-l border-purple-500/20 transition-all duration-300 ${isCollapsed ? 'w-10' : 'w-72'}`}
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

          <div className="p-2 border-t border-purple-500/20">
            <div className="flex gap-2">
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSend()}
                placeholder="Type a message..."
                className="flex-1 bg-gray-800/50 border border-gray-700/50 rounded-lg px-3 py-1.5 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-purple-500/50"
              />
              <button
                onClick={handleSend}
                className="bg-purple-600 hover:bg-purple-500 text-white rounded-lg px-3 py-1.5 text-sm font-bold transition-colors"
              >
                ↵
              </button>
            </div>
          </div>
        </>
      )}
    </motion.div>
  );
}
