'use client';

import { useState } from 'react';
import CharacterImage from '@/components/characters/CharacterImage';
import BondSceneModal from '@/components/characters/BondSceneModal';
import RewardCutscene from '@/components/story/RewardCutscene';
import { getCharacterById } from '@/lib/characters';
import {
  getBondSceneArt,
  getBondScenes,
  isBondSceneUnlocked,
  type BondScene,
} from '@/lib/characters/bond-scenes';
import { hasOutfitArt } from '@/lib/assets/character-art';
import { getBalance, milliToUiUnits } from '@/lib/progression/balance';
import { PROGRESSION_CHARACTER_IDS, type ProgressionCharacterId } from '@/lib/progression/types';
import { STORY_CHAPTERS } from '@/lib/story/chapters';
import {
  STORY_REWARD_CATALOG,
  storyRewardRequirement,
  toStoryRewardCutscene,
  type StoryRewardDefinition,
} from '@/lib/story/rewards/catalog';
import type { StoryRewardCutsceneView } from '@/lib/story/views';
import { useOperatorMode, useOperatorStore } from '@/lib/store/operator-store';
import { useProgressionStore } from '@/lib/store/progression-store';

/** 잠긴 갤러리 타일 — 🔒 + 해금 조건 */
function LockedTile({ label, hint }: { label: string; hint: string }) {
  return (
    <div
      aria-label={`잠김 — ${label} · ${hint}`}
      title={`${label} · ${hint}`}
      className="flex aspect-[2/3] flex-col items-center justify-center rounded-lg border border-white/10 bg-abyss/60 px-1 text-center"
    >
      <span className="text-sm">🔒</span>
      <span className="mt-0.5 line-clamp-2 text-[8px] leading-tight text-ink-dim">{hint}</span>
    </div>
  );
}

/**
 * 인연 탭 — 파트너 선택 + 히로인별 갤러리(인연 씬 · 스토리 이벤트 CG · 의상 옷장).
 * 아바타 탭은 "내 좌석 아바타" 축이고, 의상은 히로인 축이라 여기(인연 카드)에 둔다(2026-09-03).
 * 획득·장착 상태는 progression 스냅샷(inventory·cosmetics)이 소스, 정의는 스토리 보상 카탈로그.
 */
export default function AffinityTab() {
  const snapshot = useProgressionStore(state => state.snapshot);
  const action = useProgressionStore(state => state.action);
  const selectCharacter = useProgressionStore(state => state.selectCharacter);
  const setCosmetic = useProgressionStore(state => state.setCosmetic);
  const [viewingScene, setViewingScene] = useState<BondScene | null>(null);
  const [viewingCg, setViewingCg] = useState<StoryRewardCutsceneView | null>(null);
  // 운영자 모드 — CG·인연 씬은 전부 열어 보여 주고(뷰 오버라이드), 미보유 의상은 로컬 미리보기로 입혀 본다(서버 장착 아님)
  const operator = useOperatorMode();
  const outfitPreview = useOperatorStore(state => state.outfitPreview);
  const setOutfitPreview = useOperatorStore(state => state.setOutfitPreview);
  if (!snapshot) return null;
  const balance = getBalance(snapshot.profile.balanceVersion);
  const owned = new Set(snapshot.inventory.map(item => item.itemId));
  const viewable = (itemId: string): boolean => operator || owned.has(itemId);
  const cosmetics = snapshot.cosmetics;
  const dojoCgs = STORY_REWARD_CATALOG.filter(item => item.kind === 'cg' && !item.characterId);

  const cgTile = (item: StoryRewardDefinition) => {
    const cutscene = toStoryRewardCutscene(item);
    if (!viewable(item.id) || !cutscene) {
      return <LockedTile key={item.id} label={item.name} hint={storyRewardRequirement(item, STORY_CHAPTERS)} />;
    }
    return (
      <button
        key={item.id}
        type="button"
        onClick={() => setViewingCg(cutscene)}
        aria-label={`이벤트 CG 보기 — ${item.name}`}
        className="group relative aspect-[2/3] overflow-hidden rounded-lg border border-gilded/30"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={cutscene.art} alt={item.name} draggable={false} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-abyss/80 to-transparent px-1 pb-0.5 pt-2 text-left text-[8px] font-bold text-white">
          {item.name}
        </span>
      </button>
    );
  };

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-dim">
        함께 인연을 쌓는 파트너예요. 로비에 상주하고 혼자 연습 방에 합류해요.
        좌석에 보일 내 모습은 아바타 탭에서 바꿔요. 의상은 로비·수련 화면에서만 입어요.
      </p>
      {operator && (
        <p className="rounded-lg border border-gilded/40 bg-gilded/10 px-2 py-1 text-[10px] font-bold text-gilded" role="status">
          운영자 미리보기 — CG·인연 씬은 전부 열려 있고, 미보유 의상은 [미리보기]로 로비·수련 화면에 입혀 볼 수 있어요(실제 장착 아님)
        </p>
      )}

      {/* 도장 기록 — 히로인에 속하지 않는 CG(띠 수여 등) */}
      {dojoCgs.length > 0 && (
        <section className="rounded-xl border border-gilded/25 bg-elevated/40 p-3" aria-label="도장 기록">
          <h3 className="text-xs font-bold text-gilded">도장 기록</h3>
          <div className="mt-2 grid grid-cols-4 gap-1.5">{dojoCgs.map(cgTile)}</div>
        </section>
      )}

      {PROGRESSION_CHARACTER_IDS.map(characterId => {
        const character = getCharacterById(characterId);
        const affinity = snapshot.affinities.find(value => value.characterId === characterId);
        const selected = snapshot.profile.selectedCharacterId === characterId;
        const level = affinity?.level ?? 1;
        const threshold = level >= balance.affinityMaxLevel ? 0 : balance.affinityForNextLevel(level);
        const scenes = getBondScenes(characterId);
        const outfits = STORY_REWARD_CATALOG.filter(item => item.kind === 'outfit' && item.characterId === characterId);
        const cgs = STORY_REWARD_CATALOG.filter(item => item.kind === 'cg' && item.characterId === characterId);
        const equippedOutfit = cosmetics.outfits[characterId as ProgressionCharacterId] ?? null;
        const equippedOutfitId = equippedOutfit ? outfits.find(item => item.id === equippedOutfit)?.outfitId ?? null : null;
        return (
          <div
            key={characterId}
            className={`rounded-xl border p-3 transition-colors ${selected ? 'border-blossom bg-blossom/10' : 'border-mystic/20 bg-elevated/50'}`}
          >
            <button
              type="button"
              aria-pressed={selected}
              disabled={action !== null}
              onClick={() => void selectCharacter(characterId)}
              className="flex w-full items-center gap-3 text-left disabled:opacity-50"
            >
              <CharacterImage characterId={characterId} round outfitId={equippedOutfitId} className="h-11 w-11 shrink-0 text-xl" />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-bold text-ink">{character?.name ?? characterId} · 인연 {level}</span>
                <span className="block text-[10px] text-ink-dim">{threshold === 0 ? '최고 레벨' : `${milliToUiUnits(affinity?.xpMilli ?? 0)} / ${milliToUiUnits(threshold)} XP`}</span>
              </span>
              <span className="text-[10px] font-bold text-blossom">{selected ? '선택됨' : '선택'}</span>
            </button>

            {/* 인연 씬 갤러리 — 마일스톤(5/10/15/20) 해금 이벤트 CG 다시보기 */}
            <div className="mt-2 grid grid-cols-4 gap-1.5">
              {scenes.map(scene => {
                const unlocked = operator || isBondSceneUnlocked(scene, level);
                return unlocked ? (
                  <button
                    key={scene.id}
                    type="button"
                    onClick={() => setViewingScene(scene)}
                    aria-label={`인연 씬 보기 — ${scene.title}`}
                    className="group relative aspect-[2/3] overflow-hidden rounded-lg border border-white/15"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={getBondSceneArt(scene)}
                      alt={scene.title}
                      draggable={false}
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                    <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-abyss/80 to-transparent px-1 pb-0.5 pt-2 text-left text-[8px] font-bold text-white">
                      {scene.title}
                    </span>
                  </button>
                ) : (
                  <div
                    key={scene.id}
                    aria-label={`잠긴 인연 씬 — 인연 Lv.${scene.level} 해금`}
                    className="flex aspect-[2/3] flex-col items-center justify-center rounded-lg border border-white/10 bg-abyss/60 text-center"
                  >
                    <span className="text-sm">🔒</span>
                    <span className="mt-0.5 text-[8px] text-ink-dim">Lv.{scene.level}</span>
                  </div>
                );
              })}
            </div>

            {/* 스토리 이벤트 CG */}
            {cgs.length > 0 && (
              <div className="mt-2">
                <p className="text-[10px] font-bold text-ink-dim">이벤트 CG</p>
                <div className="mt-1 grid grid-cols-4 gap-1.5">{cgs.map(cgTile)}</div>
              </div>
            )}

            {/* 옷장 — 기본 + 카탈로그 의상(보유: 장착 칩, 미보유: 잠금 힌트) */}
            {outfits.length > 0 && (
              <div className="mt-2" aria-label={`${character?.name ?? characterId} 옷장`}>
                <p className="text-[10px] font-bold text-ink-dim">옷장</p>
                <div className="mt-1 flex flex-wrap gap-1">
                  <button
                    type="button"
                    disabled={action !== null || !equippedOutfit}
                    aria-pressed={!equippedOutfit}
                    onClick={() => void setCosmetic(`outfit:${characterId}`, null)}
                    className={`rounded-md border px-2 py-0.5 text-[10px] font-bold disabled:opacity-60 ${!equippedOutfit ? 'border-blossom bg-blossom/15 text-blossom' : 'border-mystic/30 text-ink-dim'}`}
                  >
                    기본
                  </button>
                  {outfits.map(item => {
                    const has = owned.has(item.id);
                    const equipped = equippedOutfit === item.id;
                    const artReady = item.outfitId ? hasOutfitArt(characterId, item.outfitId) : false;
                    // 운영자 미리보기 — 미보유 의상: 탭하면 로컬 미리보기 토글(다시 탭하면 해제)
                    if (operator && !has) {
                      const previewing = outfitPreview[characterId] === item.id;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          aria-pressed={previewing}
                          title={`운영자 미리보기 — ${item.description}${artReady ? '' : ' (일러스트 준비 중)'}`}
                          onClick={() => setOutfitPreview(characterId, previewing ? null : item.id)}
                          className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${previewing ? 'border-gilded bg-gilded/20 text-gilded' : 'border-gilded/40 border-dashed text-gilded/80'}`}
                        >
                          👁 {item.name.replace(`${character?.name ?? ''} · `, '')}
                          <span className="ml-1 font-normal">· {previewing ? '미리보기 중' : '미리보기'}</span>
                        </button>
                      );
                    }
                    return (
                      <button
                        key={item.id}
                        type="button"
                        disabled={action !== null || !has || equipped}
                        aria-pressed={equipped}
                        title={has ? (artReady ? item.description : `${item.description} (일러스트 준비 중 — 장착은 돼요)`) : `🔒 ${storyRewardRequirement(item, STORY_CHAPTERS)}`}
                        onClick={() => void setCosmetic(`outfit:${characterId}`, item.id)}
                        className={`rounded-md border px-2 py-0.5 text-[10px] font-bold disabled:opacity-60 ${
                          equipped ? 'border-blossom bg-blossom/15 text-blossom' : has ? 'border-gilded/40 text-gilded' : 'border-mystic/20 text-ink-dim'
                        }`}
                      >
                        {has ? '' : '🔒 '}{item.name.replace(`${character?.name ?? ''} · `, '')}
                        {!has && <span className="ml-1 font-normal">· {storyRewardRequirement(item, STORY_CHAPTERS)}</span>}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* 프로필 모달(z-100/110) 안이므로 뷰어는 modal 레이어(z-120) — 아니면 모달 뒤에 깔린다 */}
      <BondSceneModal scene={viewingScene} layer="modal" onClose={() => setViewingScene(null)} />
      <RewardCutscene cutscene={viewingCg} justUnlocked={false} layer="modal" onClose={() => setViewingCg(null)} />
    </div>
  );
}
