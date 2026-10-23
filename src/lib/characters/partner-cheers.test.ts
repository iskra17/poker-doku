import { describe, expect, it } from 'vitest';
import { PROGRESSION_CHARACTER_IDS } from '@/lib/progression/types';
import { hasAwkwardPokerTerminology } from './poker-terminology';
import { hasPartnerWinCheer, partnerWinCheer } from './partner-cheers';

describe('partnerWinCheer', () => {
  it('히로인 6명 모두 축하 대사가 있고 결정론적으로 고른다', () => {
    for (const id of PROGRESSION_CHARACTER_IDS) {
      expect(hasPartnerWinCheer(id), id).toBe(true);
      const line = partnerWinCheer(id, 7);
      expect(line, id).toBeTruthy();
      expect(partnerWinCheer(id, 7)).toBe(line);
      expect(hasAwkwardPokerTerminology(line!), line!).toBe(false);
    }
  });

  it('히로인이 아니거나 파트너가 없으면 null (미야코 폴백)', () => {
    expect(partnerWinCheer('kapi', 1)).toBeNull();
    expect(partnerWinCheer(null, 1)).toBeNull();
    expect(hasPartnerWinCheer('dealer')).toBe(false);
  });

  it('음수·큰 seed도 범위 안에서 고른다', () => {
    expect(partnerWinCheer('ara', -1)).toBeTruthy();
    expect(partnerWinCheer('ara', 1_000_003)).toBeTruthy();
  });
});
