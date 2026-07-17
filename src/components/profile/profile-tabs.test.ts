import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROFILE_TABS, nextProfileTabIndex } from './profile-tabs';

describe('profile tab keyboard navigation', () => {
  it('wraps horizontal arrow navigation', () => {
    expect(nextProfileTabIndex(0, 'ArrowLeft')).toBe(PROFILE_TABS.length - 1);
    expect(nextProfileTabIndex(PROFILE_TABS.length - 1, 'ArrowRight')).toBe(0);
  });

  it('supports Home and End without changing for unrelated keys', () => {
    expect(nextProfileTabIndex(2, 'Home')).toBe(0);
    expect(nextProfileTabIndex(2, 'End')).toBe(PROFILE_TABS.length - 1);
    expect(nextProfileTabIndex(2, 'Enter')).toBe(2);
  });

  it('connects tabs to the active panel with roving tabindex', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/profile/ProfileHub.tsx'), 'utf8');
    expect(source).toContain('aria-controls={`${tabGroupId}-panel-${index}`}');
    expect(source).toContain('tabIndex={tab === value ? 0 : -1}');
    expect(source).toContain('aria-labelledby={`${tabGroupId}-tab-${PROFILE_TABS.indexOf(tab)}`}');
  });
});
