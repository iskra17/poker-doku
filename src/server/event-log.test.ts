import { describe, expect, it } from 'vitest';
import { tokenHint } from './event-log';

describe('transport token diagnostics', () => {
  it('uses a stable opaque keyed hint without exposing the raw prefix', () => {
    const token = '잘못된-복구문구-password-credential';
    const firstKey = Buffer.alloc(32, 1);
    const secondKey = Buffer.alloc(32, 2);

    const first = tokenHint(token, firstKey);

    expect(first).toMatch(/^t_[A-Za-z0-9_-]{12}$/);
    expect(first).toBe(tokenHint(token, firstKey));
    expect(first).not.toContain(token.slice(0, 6));
    expect(tokenHint(token, secondKey)).not.toBe(first);
    expect(tokenHint(undefined, firstKey)).toBe('none');
  });
});
