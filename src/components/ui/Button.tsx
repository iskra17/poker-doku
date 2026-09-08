'use client';

import { motion } from 'framer-motion';

interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  className?: string;
}

const variants = {
  primary: 'bg-blossom text-abyss hover:bg-blossom-hot',
  secondary: 'border border-white/15 bg-elevated text-ink hover:border-blossom/45 hover:bg-panel',
  danger: 'bg-[#a85f63] text-white hover:bg-[#bd7075]',
  success: 'bg-cyber text-abyss hover:bg-[#8bcfc6]',
};

const sizes = {
  sm: 'min-h-11 px-3 text-sm',
  md: 'min-h-11 px-5 text-base',
  lg: 'min-h-12 px-8 text-lg',
};

export default function Button({
  children, onClick, variant = 'primary', size = 'md', disabled = false, className = '',
}: ButtonProps) {
  // onClick에 클릭 이벤트 객체를 전달하지 않는다 — 계약은 () => void. 이벤트가 새면 옵셔널 인자
  // 핸들러(onLeave(mode?) 등)를 거쳐 소켓 payload에 순환 참조가 실려 hasBinary 무한 재귀로
  // emit이 죽는다 (2026-07-22 SnG 종료 모달 먹통 버그).
  return (
    <motion.button
      whileHover={disabled ? {} : { scale: 1.01 }}
      whileTap={disabled ? {} : { scale: 0.98 }}
      onClick={onClick ? () => onClick() : undefined}
      disabled={disabled}
      className={`
        rounded-xl font-bold transition-colors duration-200
        ${variants[variant]} ${sizes[size]}
        ${disabled ? 'cursor-not-allowed opacity-40' : 'cursor-pointer'}
        ${className}
      `}
    >
      {children}
    </motion.button>
  );
}
