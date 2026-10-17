'use client';

import { useEffect, useRef, useState } from 'react';
import CardComponent from '@/components/table/Card';
import CharacterImage from '@/components/characters/CharacterImage';
import SkillBurstLayer from '@/components/effects/SkillBurstLayer';
import { parseCards } from '@/lib/poker/card-notation';
import { getSkillDef, requestSkillPreview } from '@/lib/skills/catalog';
import type { SkillReason, SkillTier } from '@/lib/skills/skill-trigger';
import { useSettingsStore, type SkillBurstMode } from '@/lib/store/settings-store';

/**
 * 연출 검토용 화면: 게임에 들어가지 않고 SkillBurstLayer(실제 게임과 같은 컴포넌트)를 버튼으로 재생한다.
 * 테이블은 흔들림 대상(data-skill-shake)을 보여 주기 위한 정적 목업이다.
 */

interface PreviewItem {
  tier: SkillTier;
  reason: SkillReason;
  bb: number;
  condition: string;
}

const ITEMS: PreviewItem[] = [
  { tier: 'small', reason: 'steal', bb: 8, condition: '쇼다운 없이 6BB 이상 팟' },
  { tier: 'small', reason: 'showdown-win', bb: 14, condition: '10BB 이상 쇼다운 승리' },
  { tier: 'medium', reason: 'big-pot', bb: 42, condition: '30BB 이상 팟 또는 스트레이트 이상' },
  { tier: 'big', reason: 'river-comeback', bb: 96, condition: '턴까지 지다가 리버 역전' },
  { tier: 'big', reason: 'all-in-win', bb: 120, condition: '올인이 걸린 20BB 이상 승리' },
  { tier: 'big', reason: 'monster', bb: 64, condition: '포카드 이상' },
];

const TIER_LABEL: Record<SkillTier, string> = { small: '소', medium: '중', big: '대' };
const MODE_LABEL: Record<Exclude<SkillBurstMode, 'off'>, string> = { full: '풀', lite: '라이트' };
const BOARD = parseCards('Qh Jd 4c 2s Td');
const AUTO_INTERVAL_MS = 2400;

export default function SkillBurstPreview() {
  const skillBurst = useSettingsStore(state => state.skillBurst);
  const setSkillBurst = useSettingsStore(state => state.setSkillBurst);
  const [lastIndex, setLastIndex] = useState<number | null>(null);
  const [auto, setAuto] = useState(false);
  const originalModeRef = useRef<SkillBurstMode | null>(null);
  const def = getSkillDef('sakura');

  // 이 화면에서 바꾼 강도는 나갈 때 원래 설정으로 되돌린다 (검토가 실제 게임 설정을 바꾸지 않게)
  useEffect(() => {
    originalModeRef.current = useSettingsStore.getState().skillBurst;
    if (originalModeRef.current === 'off') useSettingsStore.getState().setSkillBurst('full');
    return () => {
      if (originalModeRef.current) useSettingsStore.getState().setSkillBurst(originalModeRef.current);
    };
  }, []);

  const play = (index: number) => {
    const item = ITEMS[index];
    setLastIndex(index);
    requestSkillPreview({ tier: item.tier, reason: item.reason, bb: item.bb });
  };

  useEffect(() => {
    if (!auto) return;
    let next = 0;
    const id = setInterval(() => {
      const item = ITEMS[next];
      setLastIndex(next);
      requestSkillPreview({ tier: item.tier, reason: item.reason, bb: item.bb });
      next = (next + 1) % ITEMS.length;
    }, AUTO_INTERVAL_MS);
    return () => clearInterval(id);
  }, [auto]);

  return (
    <main className="flex min-h-dvh flex-col bg-abyss text-ink">
      <header className="px-4 pt-4">
        <h1 className="text-lg font-bold" style={{ fontFamily: 'var(--font-display)' }}>사쿠라 필살기 연출 미리보기</h1>
        <p className="mt-1 text-xs text-ink-dim">
          실제 게임과 같은 연출 컴포넌트를 재생해요. 개발 서버에서만 열리는 검토 화면이에요.
        </p>
      </header>

      {/* 흔들림 대상 목업 테이블 */}
      <div className="flex flex-1 items-center justify-center px-4 py-6">
        <div
          data-skill-shake
          className="relative flex aspect-[3/4] w-full max-w-[360px] flex-col items-center justify-center gap-4 rounded-[48%] border-8 border-elevated shadow-2xl"
          style={{ background: 'radial-gradient(ellipse at 50% 68%, var(--color-felt-hi) 0%, var(--color-felt-lo) 70%, var(--color-abyss) 100%)' }}
        >
          <span className="rounded-full bg-panel/80 px-3 py-1 text-xs font-bold text-gilded tabular">POT 2,400</span>
          <div className="flex gap-1">
            {BOARD.map(card => <CardComponent key={`${card.rank}${card.suit}`} card={card} size="sm" />)}
          </div>
          <span className="absolute bottom-6 block h-14 w-14 overflow-hidden rounded-full border-2 border-blossom">
            <CharacterImage characterId="sakura" expression="happy" className="h-full w-full text-2xl" />
          </span>
        </div>
      </div>

      <section className="space-y-3 border-t border-white/10 bg-panel px-4 pb-6 pt-4">
        <div className="flex items-center justify-between">
          <span className="text-sm">연출 강도</span>
          <div className="flex gap-1">
            {(Object.keys(MODE_LABEL) as Exclude<SkillBurstMode, 'off'>[]).map(mode => (
              <button
                key={mode}
                onClick={() => setSkillBurst(mode)}
                className={`rounded-lg border px-3 py-1 text-xs transition-colors
                  ${skillBurst === mode
                    ? 'border-blossom bg-blossom/10 font-bold text-blossom'
                    : 'border-white/10 bg-white/5 text-ink-dim hover:bg-white/10'}`}
              >
                {MODE_LABEL[mode]}
              </button>
            ))}
            <button
              onClick={() => setAuto(value => !value)}
              aria-pressed={auto}
              className={`rounded-lg border px-3 py-1 text-xs transition-colors
                ${auto
                  ? 'border-cyber bg-cyber/10 font-bold text-cyber'
                  : 'border-white/10 bg-white/5 text-ink-dim hover:bg-white/10'}`}
            >
              {auto ? '자동 반복 중' : '자동 반복'}
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {ITEMS.map((item, index) => (
            <button
              key={item.reason}
              onClick={() => play(index)}
              className={`rounded-xl border px-3 py-2 text-left transition-colors
                ${lastIndex === index ? 'border-blossom bg-blossom/10' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
            >
              <span className="flex items-center gap-1.5">
                <span className="rounded bg-elevated px-1.5 text-[11px] font-bold text-gilded">{TIER_LABEL[item.tier]}</span>
                <span className="text-sm font-bold">{def?.moves[item.reason].name}</span>
              </span>
              <span className="mt-0.5 block text-xs text-ink-dim">{item.condition}</span>
            </button>
          ))}
        </div>
        <p className="text-xs text-ink-dim">
          소리가 안 나면 화면을 한 번 누른 뒤 다시 재생하세요. 브라우저는 첫 터치 전 소리를 막아요.
        </p>
      </section>

      <SkillBurstLayer />
    </main>
  );
}
