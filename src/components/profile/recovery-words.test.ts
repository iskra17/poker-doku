import { describe, expect, it, vi } from 'vitest';
import {
  copyRecoveryWords,
  recoveryWordsIssuanceKey,
} from './recovery-words';

const FIRST = ['가게', '가격', '가구'];
const SECOND = ['나무', '나비', '나라'];

describe('recovery words presentation', () => {
  it('creates a new component issuance key for newly rotated words', () => {
    expect(recoveryWordsIssuanceKey(FIRST)).toBe(recoveryWordsIssuanceKey([...FIRST]));
    expect(recoveryWordsIssuanceKey(FIRST)).not.toBe(recoveryWordsIssuanceKey(SECOND));
  });

  it('reports clipboard absence and rejection without throwing', async () => {
    await expect(copyRecoveryWords(FIRST, undefined)).resolves.toBe('error');
    await expect(copyRecoveryWords(FIRST, {
      writeText: vi.fn(async () => { throw new Error('denied'); }),
    })).resolves.toBe('error');
  });

  it('copies the visible words and reports success', async () => {
    const writeText = vi.fn(async () => undefined);
    await expect(copyRecoveryWords(FIRST, { writeText })).resolves.toBe('success');
    expect(writeText).toHaveBeenCalledWith('가게 가격 가구');
  });
});
