'use client';

import CharacterImage from '@/components/characters/CharacterImage';
import CardComponent from '@/components/table/Card';
import { formatCard } from '@/lib/poker/card-notation';
import { getCharacterById } from '@/lib/characters';
import type { DrillSituation } from '@/lib/story/drills/types';

const formatChips = (chips: number): string => chips.toLocaleString('ko-KR');

interface DrillTableViewProps {
  situation: DrillSituation;
}

const STREET_LABEL: Record<DrillSituation['street'], string> = {
  preflop: '프리플랍',
  flop: '플랍',
  turn: '턴',
  river: '리버',
  showdown: '쇼다운',
};

/**
 * 드릴 상황 카드 — 미니 테이블: 상대 좌석(아바타·포지션·스택·공개 카드) / 보드 / 팟·콜 / 내 카드·포지션.
 * 팟은 A4 정의대로 "상대 벳 포함 총액" 하나만 보여 준다 (콜 금액은 별도).
 */
export default function DrillTableView({ situation }: DrillTableViewProps) {
  const hasVillains = situation.villains.length > 0;
  return (
    <div className="rounded-2xl border border-mystic/25 bg-abyss/60 p-3" aria-label="상황">
      {hasVillains && (
        <ul className="mb-2 flex flex-wrap justify-center gap-2" aria-label="상대">
          {situation.villains.map(villain => {
            const profile = getCharacterById(villain.characterId);
            return (
              <li key={villain.seatIndex} className="flex items-center gap-1.5 rounded-xl border border-mystic/20 bg-panel/70 px-2 py-1">
                <span className="h-8 w-8 shrink-0 overflow-hidden rounded-full border" style={{ borderColor: `${profile?.color ?? '#fff'}66` }}>
                  <CharacterImage characterId={villain.characterId} expression="neutral" round className="h-full w-full text-base" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[11px] font-bold text-ink">{profile?.name ?? villain.characterId}
                    <span className="ml-1 rounded bg-mystic/20 px-1 text-[9px] text-mystic">{villain.position}</span>
                    {villain.rangeTag && <span className="ml-1 rounded bg-gilded/20 px-1 text-[9px] text-gilded">{villain.rangeTag}</span>}
                  </span>
                  <span className="block text-[10px] text-ink-dim">{formatChips(villain.stackChips)}{villain.range ? ` · 가정 레인지: ${villain.range}` : ''}</span>
                </span>
                {villain.holeCards && (
                  <span className="ml-1 flex gap-0.5">
                    {villain.holeCards.map(card => <CardComponent key={formatCard(card)} card={card} size="2xs" />)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-col items-center gap-1.5">
        <p className="text-[10px] font-bold tracking-wider text-ink-dim">{STREET_LABEL[situation.street]}</p>
        {situation.board.length > 0 ? (
          <div className="flex gap-1" aria-label="보드">
            {situation.board.map(card => <CardComponent key={formatCard(card)} card={card} size="sm" />)}
          </div>
        ) : (
          <p className="text-[11px] text-ink-dim">보드 없음</p>
        )}
        <div className="flex items-center gap-3 text-xs">
          <span className="rounded-full border border-gilded/40 bg-gilded/10 px-3 py-1 font-bold text-gilded" aria-label="팟">
            팟 {formatChips(situation.potChips)}
            <span className="ml-1 text-[9px] font-normal text-ink-dim">(상대 벳 포함)</span>
          </span>
          {situation.toCallChips > 0 && (
            <span className="rounded-full border border-blossom/40 bg-blossom/10 px-3 py-1 font-bold text-blossom" aria-label="콜 금액">
              콜 {formatChips(situation.toCallChips)}
            </span>
          )}
        </div>
      </div>

      {/* 내 카드가 없는 상황(보드만 읽는 문제·rank-nuts)은 행 자체를 숨긴다 — 빈 자리 칩만 남으면 오해를 부른다 */}
      {situation.hero.length > 0 && (
        <div className="mt-2 flex items-center justify-center gap-3" aria-label="내 카드">
          <span className="rounded bg-cyber/20 px-1.5 py-0.5 text-[10px] font-bold text-cyber">나 · {situation.heroPosition}</span>
          <div className="flex gap-1">
            {situation.hero.map(card => <CardComponent key={formatCard(card)} card={card} size="md" highlight />)}
          </div>
          <span className="text-[10px] text-ink-dim">{formatChips(situation.heroStackChips)} · BB {situation.bigBlind}</span>
        </div>
      )}
      {situation.note && <p className="mt-2 text-center text-[11px] text-ink-dim">{situation.note}</p>}
    </div>
  );
}
