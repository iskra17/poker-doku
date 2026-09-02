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
  /** 모달(프로필·기록실) 안에서 열 때 'modal' — CgStage z 레이어 */
  layer?: 'stage' | 'modal';
}

/**
 * 인연 씬 뷰어 — 이벤트 CG를 `CgStage`(패럴랙스·숨쉬기·타자기 캡션)로 재생.
 * 인연 마일스톤(5/10/15/20) 해금 순간과 인연 갤러리 다시보기가 함께 쓴다.
 */
export default function BondSceneModal({ scene, justUnlocked = false, onClose, layer }: BondSceneModalProps) {
  const character = scene ? getCharacterById(scene.characterId) : null;
  return (
    <CgStage
      layer={layer}
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
        hint: justUnlocked ? '기록실에서 다시 볼 수 있어요 · 탭하면 닫혀요' : undefined,
      } : null}
      onClose={onClose}
    />
  );
}
