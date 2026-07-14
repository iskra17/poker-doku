'use client';

import { useSettingsStore } from '@/lib/store/settings-store';
import { useGameStore } from '@/lib/store/game-store';
import { formatChipAmount } from '@/lib/format-chips';

/**
 * 칩/BB 표기 설정과 현재 방 빅블라인드를 묶은 금액 포매터.
 * 좌석 칩 플레이트의 토글 한 번으로 팟·베팅 스택·액션바 금액이 함께 바뀐다.
 */
export function useChipFormatter(): (amount: number, opts?: { compact?: boolean }) => string {
  const mode = useSettingsStore(s => s.chipDisplayMode);
  const bigBlind = useGameStore(s => s.gameState?.bigBlind ?? 0);
  return (amount, opts) => formatChipAmount(amount, mode, bigBlind, opts);
}
