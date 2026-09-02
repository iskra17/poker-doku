'use client';

import { useEffect } from 'react';
import { selectHeldByOthers, usePresentationStore } from '@/lib/store/presentation-store';
import { useProgressionStore } from '@/lib/store/progression-store';
import BondSceneModal from './BondSceneModal';

const HOLD_KEY = 'bond-scene';

/**
 * 인연 씬 해금 재생 — 해금 판정·큐는 progression-store(`bondSceneQueue`, 스냅샷 prev/next 비교)가 갖는다.
 * 이 컴포넌트는 큐의 머리를 모달로 그리는 순수 소비자라 로비·방 어디에 마운트돼도 큐가 유실되지 않는다
 * (2026-09-03: 컴포넌트 ref baseline은 마운트 경계마다 리셋돼 스토리 완주 뒤 로비에서 씬이 영영 안 뜨던 갭).
 * 다른 연출(결산 보상 리빌)이 무대를 잡고 있으면 끝날 때까지 기다린다.
 */
export default function BondSceneUnlockWatcher() {
  const scene = useProgressionStore(state => state.bondSceneQueue[0] ?? null);
  const shiftBondScene = useProgressionStore(state => state.shiftBondScene);
  const heldByOthers = usePresentationStore(state => selectHeldByOthers(state, HOLD_KEY));
  const hold = usePresentationStore(state => state.hold);
  const release = usePresentationStore(state => state.release);
  const open = !!scene && !heldByOthers;

  // 모달이 열린 동안 무대를 잡는다 (외부 스토어 갱신 — effect에서 허용)
  useEffect(() => {
    if (!open) return;
    hold(HOLD_KEY);
    return () => release(HOLD_KEY);
  }, [open, hold, release]);

  return (
    <BondSceneModal
      scene={open ? scene : null}
      justUnlocked
      onClose={shiftBondScene}
    />
  );
}
