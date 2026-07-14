'use client';

import { motion, AnimatePresence } from 'framer-motion';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export default function Modal({ isOpen, onClose, title, children }: ModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40"
            onClick={onClose}
          />
          {/* flex 센터링 래퍼 — 패널에 transform 클래스를 쓰지 않아 framer 애니메이션과 충돌 없음 */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className="w-full max-w-md max-h-full pointer-events-auto"
            >
              {/* 패널 — 화면보다 길어지면 본문만 내부 스크롤 */}
              <div className="bg-[#1a1028] border border-purple-500/30 rounded-2xl shadow-2xl shadow-purple-500/10 p-6 flex flex-col max-h-[calc(100dvh-2rem)]">
                <div className="flex items-center justify-between mb-4 flex-none">
                  <h2
                    className="text-xl font-bold text-purple-300"
                    style={{ textShadow: '0 0 10px rgba(168, 85, 247, 0.5)' }}
                  >
                    {title}
                  </h2>
                  <button
                    onClick={onClose}
                    className="text-gray-400 hover:text-white text-2xl leading-none"
                  >
                    &times;
                  </button>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin -mr-2 pr-2">
                  {children}
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
