'use client';

import { useEffect, useState } from 'react';
import BondSceneModal from '@/components/characters/BondSceneModal';
import CgStage, { type CgStageScene } from '@/components/characters/CgStage';
import RewardCutscene from '@/components/story/RewardCutscene';
import Modal from '@/components/ui/Modal';
import { getCharacterById } from '@/lib/characters';
import type { BondScene } from '@/lib/characters/bond-scenes';
import { GALLERY_SECTION_LABEL, GALLERY_SECTIONS, type GalleryEntry, type GallerySection } from '@/lib/gallery/catalog';
import { markSeen } from '@/lib/gallery/seen';
import { useStoryStore } from '@/lib/store/story-store';
import type { StoryRewardCutsceneView } from '@/lib/story/views';
import GalleryTile from './GalleryTile';
import { useGallery } from './use-gallery';

interface GalleryModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** 열 때 보여 줄 섹션 (기본: NEW가 있는 첫 섹션, 없으면 인연 씬) */
  initialSection?: GallerySection;
}

/**
 * 기록실 — 인연 씬·이벤트 CG·의상·칭호·배경을 한곳에서 다시 본다(로비 헤더 🖼·수련 허브 카드·결산 [기록실 보기]).
 * 탭 → 본 것으로 표시(NEW 해제) → 뷰어. 뷰어는 모달 위 레이어(`layer="modal"`).
 */
export default function GalleryModal({ isOpen, onClose, initialSection }: GalleryModalProps) {
  const { profileId, entries, summary, newIds } = useGallery();
  const progressStatus = useStoryStore(state => state.progressStatus);
  const load = useStoryStore(state => state.load);
  const [section, setSection] = useState<GallerySection>('bond');
  const [bond, setBond] = useState<BondScene | null>(null);
  const [cutscene, setCutscene] = useState<StoryRewardCutsceneView | null>(null);
  const [scene, setScene] = useState<CgStageScene | null>(null);

  // 로비 헤더에서 바로 열면 스토리 진행도가 아직 없을 수 있다 — 한 번 불러온다(배경·미리보기 해금 판정용)
  useEffect(() => {
    if (isOpen && progressStatus === 'idle') void load();
  }, [isOpen, progressStatus, load]);

  // 열릴 때 초기 섹션 — 지정값 > NEW가 있는 첫 섹션 > 인연 씬
  useEffect(() => {
    if (!isOpen) return;
    const firstNew = GALLERY_SECTIONS.find(candidate => entries.some(entry => entry.section === candidate && newIds.has(entry.id)));
    setSection(initialSection ?? firstNew ?? 'bond');
    // 항목 변화로 섹션이 튀지 않게 열리는 순간만 계산한다
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialSection]);

  const visible = entries.filter(entry => entry.section === section);
  const open = (entry: GalleryEntry) => {
    if (profileId) markSeen(profileId, [entry.id]);
    if (entry.section === 'bond' && entry.bond) {
      setBond(entry.bond);
    } else if (entry.section === 'cg' && entry.cutscene) {
      setCutscene(entry.cutscene);
    } else if (entry.section === 'cg' && entry.sceneCg && entry.art) {
      setScene({ id: entry.id, art: entry.art, alt: entry.name, name: '', color: '#ffd76a', kicker: 'SCENE CG', title: entry.name, caption: entry.caption ?? '', hint: '탭하면 닫혀요' });
    } else if (entry.section === 'outfit' && entry.art) {
      const character = entry.characterId ? getCharacterById(entry.characterId) : null;
      setScene({
        id: entry.id,
        art: entry.art,
        alt: entry.name,
        name: character?.name ?? '',
        color: character?.color ?? '#ffd76a',
        kicker: 'OUTFIT',
        title: entry.name,
        caption: entry.caption ?? '',
        hint: '옷장은 프로필 → 인연 탭에서 갈아입어요 · 탭하면 닫혀요',
      });
    } else if (entry.section === 'bg' && entry.art) {
      setScene({ id: entry.id, art: entry.art, alt: entry.name, name: '', color: '#a78bfa', kicker: 'BACKGROUND', title: entry.name, caption: '', hint: '탭하면 닫혀요' });
    }
  };
  const markAll = () => {
    if (profileId) markSeen(profileId, entries.filter(entry => entry.unlocked).map(entry => entry.id));
  };

  return (
    <>
      <Modal isOpen={isOpen} onClose={onClose} title="기록실" maxWidthClass="max-w-2xl">
        <div className="-mx-1 flex gap-1 overflow-x-auto pb-1 scrollbar-thin" role="tablist" aria-label="기록실 섹션">
          {summary.map(row => {
            const fresh = entries.filter(entry => entry.section === row.section && newIds.has(entry.id)).length;
            const active = row.section === section;
            return (
              <button
                key={row.section}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setSection(row.section)}
                className={`relative shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-bold ${active ? 'bg-blossom/15 text-blossom' : 'bg-elevated/50 text-ink-dim'}`}
              >
                {GALLERY_SECTION_LABEL[row.section]} <span className="font-normal">{row.unlocked}/{row.total}</span>
                {fresh > 0 && <span className="ml-1 rounded-full bg-blossom px-1 text-[8px] font-black text-white">{fresh}</span>}
              </button>
            );
          })}
        </div>

        <div className="mt-2 flex items-center justify-between text-[10px] text-ink-dim">
          <span>탭하면 크게 봐요 · 잠긴 항목은 조건을 채우면 열려요</span>
          {newIds.size > 0 && (
            <button type="button" onClick={markAll} className="rounded border border-mystic/30 px-1.5 py-0.5 font-bold text-ink-dim">
              모두 확인
            </button>
          )}
        </div>

        <div className="mt-2 grid grid-cols-3 gap-1.5 sm:grid-cols-4" role="tabpanel" aria-label={GALLERY_SECTION_LABEL[section]}>
          {visible.map(entry => (
            <GalleryTile key={entry.id} entry={entry} isNew={newIds.has(entry.id)} onOpen={open} />
          ))}
        </div>
        {visible.length === 0 && <p className="mt-4 text-center text-xs text-ink-dim">아직 이 섹션에 항목이 없어요.</p>}
      </Modal>

      <BondSceneModal scene={bond} layer="modal" onClose={() => setBond(null)} />
      <RewardCutscene cutscene={cutscene} justUnlocked={false} layer="modal" onClose={() => setCutscene(null)} />
      <CgStage scene={scene} layer="modal" onClose={() => setScene(null)} />
    </>
  );
}
