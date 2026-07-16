import { describe, expect, it } from 'vitest';
import { canEnterExistingProfileRecovery } from './onboarding-rules';

describe('profile onboarding legal gate', () => {
  it('allows existing-profile recovery only after the legal confirmation', () => {
    expect(canEnterExistingProfileRecovery(false)).toBe(false);
    expect(canEnterExistingProfileRecovery(true)).toBe(true);
  });
});
