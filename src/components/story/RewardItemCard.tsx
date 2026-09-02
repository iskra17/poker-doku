'use client';

import { useState } from 'react';
import { motion } from 'framer-motion';
import CharacterImage from '@/components/characters/CharacterImage';
import { CardBackPreview, FeltPreview } from '@/components/cosmetics/CardBackPreview';
import { REWARD_KIND_LABEL } from '@/lib/story/reward-view';
import type { StoryRewardItemView, StoryRewardKind } from '@/lib/story/views';

export type RewardCardItem =
  | { kind: 'item'; item: StoryRewardItemView }
  | { kind: 'chips'; amount: number };

interface RewardItemCardProps {
  card: RewardCardItem;
  flipped: boolean;
  reducedMotion: boolean;
  /** 잠긴 미리보기(다음 보상) — 그레이스케일 + 조건 문구 */
  locked?: { requirement: string } | null;
  onClick?: () => void;
}

const KIND_ICON: Readonly<Record<StoryRewardKind, string>> = Object.freeze({
  title: '🎗',
  'card-back': '🂠',
  felt: '🟢',
  outfit: '👘',
  cg: '🖼',
  throwable: '💐',
  chips: '🪙',
});

function Front({ card }: { card: RewardCardItem }) {
  const [broken, setBroken] = useState(false);
  if (card.kind === 'chips') {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-gradient-to-b from-gilded/25 to-gilded/5">
        <span className="text-3xl" aria-hidden>🪙</span>
        <span className="text-lg font-black text-gilded">+{card.amount.toLocaleString()}</span>
      </div>
    );
  }
  const { item } = card;
  switch (item.kind) {
    case 'outfit':
      return item.characterId
        ? <CharacterImage characterId={item.characterId} expression="happy" round={false} outfitId={item.outfitId ?? null} className="h-full w-full text-4xl" />
        : <span className="text-4xl">👘</span>;
    case 'cg':
      return item.art && !broken
        // eslint-disable-next-line @next/next/no-img-element -- 정적 CG 썸네일(webp), next/image 최적화 대상 아님
        ? <img src={item.art} alt={item.name} className="h-full w-full object-cover" onError={() => setBroken(true)} draggable={false} />
        : <div className="flex h-full w-full items-center justify-center bg-gradient-to-b from-blossom/25 to-mystic/10 text-4xl" aria-hidden>🖼</div>;
    case 'card-back':
      return <CardBackPreview id={item.id} className="h-full w-full p-2" />;
    case 'felt':
      return <FeltPreview id={item.id} className="h-full w-full p-2" />;
    case 'throwable':
      return item.id.startsWith('throwable-') && !broken
        // eslint-disable-next-line @next/next/no-img-element -- 투척 스프라이트(webp) 소형 썸네일
        ? <img src={`/assets/throwables/${item.id.slice('throwable-'.length)}.webp`} alt={item.name} className="h-full w-full object-contain p-3" onError={() => setBroken(true)} draggable={false} />
        : <span className="text-4xl">💐</span>;
    default:
      return (
        <div className="flex h-full w-full items-center justify-center bg-gradient-to-b from-mystic/25 to-abyss/10 text-4xl" aria-hidden>
          {KIND_ICON[item.kind]}
        </div>
      );
  }
}

/**
 * 보상 카드 — 뒷면(카드백 무늬)에서 앞면(아트/아이콘 + 이름 + 종류 칩)으로 뒤집힌다.
 * 위치 이동은 framer `style={{x,y}}`만(트랜스폼 클래스 혼용 금지 규칙).
 */
export default function RewardItemCard({ card, flipped, reducedMotion, locked = null, onClick }: RewardItemCardProps) {
  const name = card.kind === 'chips' ? '연습 칩' : card.item.name;
  const kindLabel = card.kind === 'chips' ? REWARD_KIND_LABEL.chips : REWARD_KIND_LABEL[card.item.kind];
  const show = flipped || reducedMotion;
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className="relative aspect-[3/4] w-full text-left disabled:cursor-default"
      style={{ perspective: 800 }}
      aria-label={locked ? `${name} · ${locked.requirement}` : `${name} · ${kindLabel}`}
    >
      <motion.div
        className="relative h-full w-full"
        style={{ transformStyle: 'preserve-3d' }}
        initial={false}
        animate={{ rotateY: show ? 0 : 180 }}
        transition={reducedMotion ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 20 }}
      >
        {/* 앞면 */}
        <div
          className={`absolute inset-0 flex flex-col overflow-hidden rounded-xl border bg-panel ${locked ? 'border-mystic/20 grayscale' : 'border-gilded/50'}`}
          style={{ backfaceVisibility: 'hidden' }}
        >
          <div className="relative min-h-0 flex-1 overflow-hidden">
            <Front card={card} />
            {locked && (
              <div className="absolute inset-0 flex items-center justify-center bg-abyss/55 text-2xl" aria-hidden>🔒</div>
            )}
            {!locked && (
              <span className="absolute left-1 top-1 rounded-md bg-blossom px-1.5 text-[9px] font-black text-white">NEW</span>
            )}
          </div>
          <div className="px-1.5 py-1">
            <p className="truncate text-[11px] font-bold text-ink">{name}</p>
            <p className="truncate text-[9px] text-ink-dim">{locked ? locked.requirement : kindLabel}</p>
          </div>
        </div>
        {/* 뒷면 — 카드백 무늬 */}
        <div
          className="absolute inset-0 flex items-center justify-center overflow-hidden rounded-xl border border-gilded/40 bg-panel"
          style={{ backfaceVisibility: 'hidden', transform: 'rotateY(180deg)' }}
          aria-hidden
        >
          <CardBackPreview id="reward-back" className="h-full w-full p-1.5" />
          <span className="absolute text-[10px] font-black tracking-[0.3em] text-gilded/60">REWARD</span>
        </div>
      </motion.div>
    </button>
  );
}
