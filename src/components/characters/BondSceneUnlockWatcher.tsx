'use client';

import { useEffect, useRef, useState } from 'react';
import { findNewlyUnlockedScenes, type BondScene } from '@/lib/characters/bond-scenes';
import { useProgressionStore } from '@/lib/store/progression-store';
import BondSceneModal from './BondSceneModal';

/**
 * 인연 씬 해금 감지 — 진행도 스냅샷의 인연 레벨 상승을 지켜보다 마일스톤(5/10/15/20)을
 * 넘는 순간 씬 모달을 띄운다. 첫 스냅샷은 기준선으로만 삼는다(기해금 씬 재생 방지).
 * 멀티 레벨 점프 시 씬을 큐로 순차 재생. 서버 상태 없음 — 레벨에서 파생.
 */
export default function BondSceneUnlockWatcher() {
  const [queue, setQueue] = useState<BondScene[]>([]);
  const baselineRef = useRef<Map<string, number> | null>(null);

  useEffect(() => {
    return useProgressionStore.subscribe(state => {
      const affinities = state.snapshot?.affinities;
      if (!affinities) return;
      if (baselineRef.current === null) {
        baselineRef.current = new Map(affinities.map(a => [a.characterId, a.level]));
        return;
      }
      const baseline = baselineRef.current;
      const unlocked: BondScene[] = [];
      for (const affinity of affinities) {
        const previous = baseline.get(affinity.characterId) ?? 1;
        if (affinity.level > previous) {
          unlocked.push(...findNewlyUnlockedScenes(affinity.characterId, previous, affinity.level));
          baseline.set(affinity.characterId, affinity.level);
        }
      }
      if (unlocked.length > 0) {
        setQueue(current => [...current, ...unlocked]);
      }
    });
  }, []);

  return (
    <BondSceneModal
      scene={queue[0] ?? null}
      justUnlocked
      onClose={() => setQueue(current => current.slice(1))}
    />
  );
}
