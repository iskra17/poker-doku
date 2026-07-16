import { describe, expect, it } from 'vitest';
import type { EconomyStatus } from '@/lib/profile/types';
import {
  formatEconomyAvailableAt,
  getRescueStatusText,
} from './status-format';

const NOW = Date.parse('2026-07-15T15:00:00.000Z');

describe('economy status formatting', () => {
  it('formats immediate, conditional, and future KST availability', () => {
    expect(formatEconomyAvailableAt(NOW, NOW)).toBe('지금 받을 수 있어요');
    expect(formatEconomyAvailableAt(null, NOW)).toBe('조건을 충족하면 받을 수 있어요');
    expect(formatEconomyAvailableAt(
      Date.parse('2026-07-15T19:00:00.000Z'),
      NOW,
    )).toBe('7월 16일 04:00부터');
  });

  it('uses only the server reason and timestamp for rescue guidance', () => {
    const rescue: EconomyStatus['rescue'] = {
      eligible: false,
      grantAmount: 0,
      remainingToday: 2,
      availableAt: Date.parse('2026-07-15T19:00:00.000Z'),
      reason: 'cooldown',
    };

    expect(getRescueStatusText(rescue, NOW)).toBe('다음 지원 · 7월 16일 04:00부터');
    expect(getRescueStatusText({
      ...rescue,
      reason: 'active-escrow',
      availableAt: null,
    }, NOW)).toBe('참가 중인 좌석 칩을 먼저 정산해 주세요');
  });
});
