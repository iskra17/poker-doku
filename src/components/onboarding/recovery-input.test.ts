import { describe, expect, it } from 'vitest';
import { reduceRecoveryInput } from './recovery-input';

describe('recovery input secret lifetime', () => {
  it('keeps only explicit edits and clears for every navigation/submission outcome', () => {
    const secret = '가게 가격 가구 가까이 가끔 가난 가늘 가득 가로 가방 가수 가슴';
    expect(reduceRecoveryInput('', { type: 'change', value: secret })).toBe(secret);
    for (const reason of ['submit', 'failure', 'success', 'back', 'legal-unchecked'] as const) {
      expect(reduceRecoveryInput(secret, { type: 'clear', reason })).toBe('');
    }
  });
});
