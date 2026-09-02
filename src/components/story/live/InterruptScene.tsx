'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import ScenePlayer from '@/components/story/ScenePlayer';
import type { Scene, StoryHeroineId } from '@/lib/story/types';

/** 핸드 종료 연출(승자 컷인·칩 이동)이 지나간 뒤 인터럽트를 연다 */
export const HAND_END_GRACE_MS = 5_500;

interface InterruptSceneProps {
  scene: Scene;
  partnerId: StoryHeroineId | null;
  /** 스텝+인터럽트를 식별하는 키 — 바뀌면 대기 타이머를 다시 건다 */
  gateKey: string;
  /**
   * 직전 hand-end 시각(epoch ms)을 돌려주는 게터. null이면 이 hold에서 핸드 종료를 못 봤다는 뜻이라
   * 곧바로 연다. 렌더 중 Date.now()를 못 쓰므로 effect 안에서만 호출한다.
   */
  lastHandEndAt: () => number | null;
  /** true면 hand-end 후 유예를 기다린다 (서버 hold 인터럽트). first-my-turn은 false */
  waitForHandEnd?: boolean;
  onFinish: () => void;
}

/**
 * 인터럽트 씬 — 테이블 위 모달로 ScenePlayer를 띄운다.
 * 서버 hold('scene')는 재생이 끝난 뒤 resume을 보내야 다음 핸드가 시작되고,
 * first-my-turn은 서버 hold가 없으므로(턴 타이머 진행 중) 닫기만 한다 — 항상 스킵 가능.
 */
export default function InterruptScene({
  scene, partnerId, gateKey, lastHandEndAt, waitForHandEnd = false, onFinish,
}: InterruptSceneProps) {
  const [ready, setReady] = useState(false);
  // 키가 바뀌면 대기 상태로 되돌린다 (effect 본문 setState 금지 — 렌더 중 보정 패턴)
  const [trackedKey, setTrackedKey] = useState(gateKey);
  if (trackedKey !== gateKey) {
    setTrackedKey(gateKey);
    setReady(false);
  }

  useEffect(() => {
    const at = waitForHandEnd ? lastHandEndAt() : null;
    const elapsed = at === null ? Number.POSITIVE_INFINITY : Date.now() - at;
    const delay = Math.max(0, HAND_END_GRACE_MS - elapsed);
    // delay 0이어도 타이머를 거쳐서 연다 — setState는 타이머 콜백에서만 (순수성 규칙)
    const timer = setTimeout(() => setReady(true), Math.min(delay, HAND_END_GRACE_MS));
    return () => clearTimeout(timer);
  }, [gateKey, waitForHandEnd, lastHandEndAt]);

  if (!ready) return null;

  return (
    <div className="pointer-events-auto absolute inset-0 z-40 flex items-center justify-center bg-abyss/75 px-3 backdrop-blur-[2px]">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md"
        role="dialog"
        aria-modal="true"
        aria-label="수련 이야기"
      >
        <ScenePlayer
          key={scene.id}
          scene={scene}
          partnerId={partnerId}
          onFinish={onFinish}
          allowSkip
          compact
        />
      </motion.div>
    </div>
  );
}
