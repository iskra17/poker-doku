'use client';

import { useEffect, useRef } from 'react';

interface VerticalSliderProps {
  min: number;
  max: number;
  step: number;
  value: number;
  onChange: (value: number) => void;
  /** 트랙 높이 (px) */
  height?: number;
  disabled?: boolean;
}

/**
 * 세로 벳 슬라이더 — 아래(최소)에서 위(최대)로.
 * 포커룸 표준 UX: 모바일은 엄지 드래그, PC는 드래그 + 마우스 휠.
 * 네이티브 input[type=range]의 세로 모드가 브라우저별로 제각각이라 포인터 이벤트로 직접 구현.
 */
export default function VerticalSlider({
  min, max, step, value, onChange, height = 132, disabled = false,
}: VerticalSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);

  const range = Math.max(max - min, 1);
  const ratio = Math.min(1, Math.max(0, (value - min) / range));

  const clampToStep = (raw: number): number => {
    const stepped = min + Math.round((raw - min) / step) * step;
    return Math.min(max, Math.max(min, stepped));
  };

  const valueFromPointer = (clientY: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.height === 0) return value;
    // 아래 = min, 위 = max
    const t = 1 - (clientY - rect.top) / rect.height;
    return clampToStep(min + t * range);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    draggingRef.current = true;
    // 캡처 실패(합성 이벤트 등)해도 값 변경은 진행돼야 한다
    try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* noop */ }
    onChange(valueFromPointer(e.clientY));
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!draggingRef.current || disabled) return;
    onChange(valueFromPointer(e.clientY));
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    draggingRef.current = false;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* noop */ }
  };

  // 마우스 휠 (PC): 위로 굴리면 증가. React onWheel은 passive라 preventDefault가 막히므로 직접 바인딩
  const stateRef = useRef({ value, step, min, max, disabled, onChange });
  useEffect(() => {
    stateRef.current = { value, step, min, max, disabled, onChange };
  }); // 매 렌더 후 최신 값 동기화 (렌더 중 ref 쓰기 금지 규칙 준수)
  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      const s = stateRef.current;
      if (s.disabled) return;
      e.preventDefault();
      const delta = e.deltaY < 0 ? s.step : -s.step;
      const next = Math.min(s.max, Math.max(s.min, s.value + delta));
      if (next !== s.value) s.onChange(next);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
      e.preventDefault();
      onChange(Math.min(max, value + step));
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
      e.preventDefault();
      onChange(Math.max(min, value - step));
    }
  };

  return (
    <div
      ref={trackRef}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-label="벳 금액"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onKeyDown={handleKeyDown}
      className={`relative w-9 select-none rounded-full bg-gray-800/80 border border-white/10
        focus:outline-none focus:ring-1 focus:ring-blossom/60
        ${disabled ? 'opacity-40' : 'cursor-pointer'}`}
      style={{ height, touchAction: 'none' }}
    >
      {/* 채움 (아래부터) */}
      <div
        className="absolute bottom-0 left-0 right-0 rounded-full bg-gradient-to-t from-purple-600 to-pink-500 pointer-events-none"
        style={{ height: `${ratio * 100}%` }}
      />
      {/* 손잡이 */}
      <div
        className="absolute left-1/2 w-7 h-7 -translate-x-1/2 translate-y-1/2 rounded-full bg-white shadow-[0_2px_8px_rgba(0,0,0,0.5)] border-2 border-pink-400 pointer-events-none"
        style={{ bottom: `${ratio * 100}%` }}
      />
    </div>
  );
}
