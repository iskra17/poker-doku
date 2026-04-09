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
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 20 }}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-md"
          >
            <div className="bg-[#1a1028] border border-purple-500/30 rounded-2xl shadow-2xl shadow-purple-500/10 p-6">
              <div className="flex items-center justify-between mb-4">
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
              {children}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
