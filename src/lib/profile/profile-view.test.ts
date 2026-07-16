import { describe, expect, it } from 'vitest';
import { shouldRenderAuthenticatedTable } from './profile-view';

describe('authenticated table visibility', () => {
  it('never renders a stale table for a non-ready profile phase', () => {
    expect(shouldRenderAuthenticatedTable('anonymous', 'room-1')).toBe(false);
    expect(shouldRenderAuthenticatedTable('loading', 'room-1')).toBe(false);
    expect(shouldRenderAuthenticatedTable('recovery-required', 'room-1')).toBe(false);
    expect(shouldRenderAuthenticatedTable('ready', 'room-1')).toBe(true);
    expect(shouldRenderAuthenticatedTable('ready', null)).toBe(false);
  });
});
