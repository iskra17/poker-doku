'use client';

interface NeonTextProps {
  children: React.ReactNode;
  color?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

const sizeMap = {
  sm: 'text-sm',
  md: 'text-lg',
  lg: 'text-2xl',
  xl: 'text-4xl',
};

export default function NeonText({ children, color = '#FF69B4', size = 'md', className = '' }: NeonTextProps) {
  return (
    <span
      className={`font-bold ${sizeMap[size]} ${className}`}
      style={{
        color: color,
        textShadow: `0 0 7px ${color}, 0 0 10px ${color}, 0 0 21px ${color}, 0 0 42px ${color}`,
      }}
    >
      {children}
    </span>
  );
}
