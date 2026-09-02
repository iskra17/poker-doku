'use client';

import CgStage from '@/components/characters/CgStage';
import { getCharacterById } from '@/lib/characters';
import { teacherArtId, teacherDisplayName } from '@/lib/story/story-hub-rules';
import type { StoryRewardCutsceneView } from '@/lib/story/views';

interface RewardCutsceneProps {
  cutscene: StoryRewardCutsceneView | null;
  /** 방금 획득한 순간(배너)인지, 갤러리 다시보기인지 */
  justUnlocked?: boolean;
  onClose: () => void;
  /** 모달(프로필·기록실) 안에서 열 때 'modal' — CgStage z 레이어 */
  layer?: 'stage' | 'modal';
}

const KICKER: Readonly<Record<StoryRewardCutsceneView['kind'], string>> = Object.freeze({
  'event-cg': 'EVENT CG',
  belt: 'BELT CEREMONY',
  'boss-win': 'BOSS DEFEATED',
});

/** 스토리 보상 컷신 — 결산에서 새 CG를 풀스크린으로. 영상 파일이 붙으면 CgStage의 art 슬롯이 <video>로 바뀐다(P2). */
export default function RewardCutscene({ cutscene, justUnlocked = true, onClose, layer }: RewardCutsceneProps) {
  const profile = cutscene ? getCharacterById(teacherArtId(cutscene.characterId)) : null;
  const name = cutscene ? teacherDisplayName(cutscene.characterId, id => getCharacterById(id)?.name) : '';
  const badge = !cutscene || !justUnlocked
    ? null
    : cutscene.kind === 'belt'
      ? `🥋 ${cutscene.title}`
      : cutscene.kind === 'boss-win'
        ? `⚔ 보스 격파 — ${cutscene.title}`
        : `✦ 새로운 이벤트 CG — ${cutscene.title}`;
  return (
    <CgStage
      layer={layer}
      scene={cutscene ? {
        id: cutscene.id,
        art: cutscene.art,
        alt: `${name} — ${cutscene.title}`,
        name,
        color: profile?.color ?? '#ffd76a',
        kicker: KICKER[cutscene.kind],
        title: cutscene.title,
        caption: cutscene.caption,
        badge,
        hint: justUnlocked ? '기록실에서 다시 볼 수 있어요 · 탭하면 닫혀요' : undefined,
      } : null}
      onClose={onClose}
    />
  );
}
