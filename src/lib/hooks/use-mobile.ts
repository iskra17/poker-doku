'use client';

import { useSyncExternalStore } from 'react';

const MOBILE_BREAKPOINT = 768;

function subscribeMobile(callback: () => void) {
  const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
  mql.addEventListener('change', callback);
  return () => mql.removeEventListener('change', callback);
}

function getSnapshotMobile() {
  return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`).matches;
}

function getServerSnapshotMobile() {
  return false; // SSR default: not mobile
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribeMobile, getSnapshotMobile, getServerSnapshotMobile);
}

function subscribeViewportHeight(callback: () => void) {
  window.addEventListener('resize', callback);
  window.visualViewport?.addEventListener('resize', callback);
  return () => {
    window.removeEventListener('resize', callback);
    window.visualViewport?.removeEventListener('resize', callback);
  };
}

function getSnapshotViewportHeight() {
  return window.innerHeight;
}

function getServerSnapshotViewportHeight() {
  return 0;
}

export function useViewportHeight(): number {
  return useSyncExternalStore(subscribeViewportHeight, getSnapshotViewportHeight, getServerSnapshotViewportHeight);
}
