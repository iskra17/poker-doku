export const PROFILE_TABS = ['성장', '인연', '보관함', '기록', '복구'] as const;
export type ProfileTab = typeof PROFILE_TABS[number];

const NAVIGATION_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);

export function isProfileTabNavigationKey(key: string): boolean {
  return NAVIGATION_KEYS.has(key);
}

export function nextProfileTabIndex(currentIndex: number, key: string): number {
  if (key === 'Home') return 0;
  if (key === 'End') return PROFILE_TABS.length - 1;
  if (key === 'ArrowLeft') {
    return (currentIndex - 1 + PROFILE_TABS.length) % PROFILE_TABS.length;
  }
  if (key === 'ArrowRight') return (currentIndex + 1) % PROFILE_TABS.length;
  return currentIndex;
}
