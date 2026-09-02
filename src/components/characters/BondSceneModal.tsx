'use client';

import { getCharacterById } from '@/lib/characters';
import { getBondSceneArt, type BondScene } from '@/lib/characters/bond-scenes';
import CgStage from './CgStage';

interface BondSceneModalProps {
  /** null이면 닫힘 */
  scene: BondScene | null;
  /** 방금 해금된 순간의 연출(헤더 배너)인지, 갤러리 다시보기인지 */
  justUnlocked?: boolean;
  onClose: () => void;
}

/**
 * 인연 씬 뷰어 — 이벤트 CG를 `CgStage`(패럴랙스·숨쉬기·타자기 캡션)로 재생.
 * 인연 마일스톤(5/10/15/20) 해금 순간과 인연 갤러리 다시보기가 함께 쓴다.
 */
export default function BondSceneModal({ scene, justUnlocked = false, onClose }: BondSceneModalProps) {
  const character = scene ? getCharacterById(scene.characterId) : null;
  return (
    <CgStage
      scene={scene && character ? {
        id: scene.id,
        art: getBondSceneArt(scene),
        alt: `${character.name} — ${scene.title}`,
        name: character.name,
        color: character.color,
        kicker: `BOND MEMORY · Lv.${scene.level}`,
        title: scene.title,
        caption: scene.caption,
        badge: justUnlocked ? `✦ 새로운 인연 씬 해금 — 인연 Lv.${scene.level}` : null,
      } : null}
      onClose={onClose}
    />
  );
}
