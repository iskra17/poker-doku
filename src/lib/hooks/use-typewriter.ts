'use client';

import { useEffect, useState } from 'react';

/**
 * VN 스타일 타이핑 효과. skip()으로 즉시 완성.
 */
export function useTypewriter(text: string, speedMs = 25): { display: string; done: boolean; skip: () => void } {
  const [state, setState] = useState({ text, count: 0 });

  // 텍스트가 바뀌면 렌더 중 상태 보정 (effect 없이)
  if (state.text !== text) {
    setState({ text, count: 0 });
  }

  useEffect(() => {
    const interval = setInterval(() => {
      setState(s => {
        if (s.text !== text) return s;
        if (s.count >= text.length) return s;
        return { ...s, count: s.count + 1 };
      });
    }, speedMs);
    return () => clearInterval(interval);
  }, [text, speedMs]);

  const count = state.text === text ? state.count : 0;
  return {
    display: text.slice(0, count),
    done: count >= text.length,
    skip: () => setState({ text, count: text.length }),
  };
}
