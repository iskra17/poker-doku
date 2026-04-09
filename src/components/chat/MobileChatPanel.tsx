'use client';

import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useGameStore } from '@/lib/store/game-store';
import ChatBubble from './ChatBubble';

export default function MobileChatPanel() {
  const { chatMessages, sendChat } = useGameStore();
  const [input, setInput] = useState('');
  const [isOpen, setIsOpen] = useState(false);
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
    <>
      {/* Chat toggle button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="fixed bottom-20 right-3 z-20 w-10 h-10 rounded-full bg-purple-600/80 backdrop-blur-sm flex items-center justify-center text-white shadow-lg border border-purple-500/30"
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

              {/* Input */}
              <div className="p-3 border-t border-purple-500/20">
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={input}
                    onChange={e => setInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleSend()}
                    placeholder="Type a message..."
                    enterKeyHint="send"
                    className="flex-1 bg-gray-800/50 border border-gray-700/50 rounded-lg px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-purple-500/50"
                  />
                  <button
                    onClick={handleSend}
                    className="bg-purple-600 hover:bg-purple-500 text-white rounded-lg px-4 py-2 text-sm font-bold transition-colors"
                  >
                    ↵
                  </button>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
