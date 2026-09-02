'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { usePrefersReducedMotion } from '@/lib/hooks/use-reduced-motion';
import { playEffect } from '@/lib/sound/effects';
import { STAGE_TIMING_MS, buildRewardRevealPlan, stageAutoAdvanceMs, type RevealStage } from '@/lib/story/reward-view';
import type { ChapterResultView } from '@/lib/story/views';
import { usePresentationStore } from '@/lib/store/presentation-store';
import BeltBanner from './BeltBanner';
import RewardCutscene from './RewardCutscene';
import RewardItemCard, { type RewardCardItem } from './RewardItemCard';

interface RewardRevealProps {
  result: ChapterResultView;
  /** 마지막 단계('done')에 닿았을 때 1회 — 부모가 버튼 행을 켠다 */
  onDone: () => void;
}

const HOLD_KEY = 'reward-reveal';

const GRADE_COLOR: Record<ChapterResultView['grade'], string> = {
  S: 'text-gilded',
  A: 'text-cyber',
  B: 'text-mystic',
};

/**
 * 결산 보상 리빌 — 단계 상태 머신: 스탬프 → 통계 → 보상 카드 플립 → (새 CG) 풀스크린 컷신 → 띠 배너 → 다음 보상 → done.
 * - 단계 전이는 타이머 콜백·탭 핸들러에서만(effect 본문 setState 금지). 탭 1회 = 현재 단계 즉시 완료, 한 번 더 = 다음.
 * - 마운트~done 동안 `presentation-store` 'reward-reveal'을 잡아 인연 씬 모달·레벨업 필이 뒤에 오게 한다.
 * - reduced-motion: 전 단계를 한 번에 렌더(플립·타이머 없음), 컷신은 [CG 보기] 버튼으로.
 */
export default function RewardReveal({ result, onDone }: RewardRevealProps) {
  const reduced = usePrefersReducedMotion();
  const plan = useMemo(() => buildRewardRevealPlan(result), [result]);
  const lastIndex = plan.stages.length - 1;
  const [stageIndex, setStageIndex] = useState(() => (reduced ? lastIndex : 0));
  const [flipped, setFlipped] = useState(() => (reduced ? Number.MAX_SAFE_INTEGER : 0));
  const [manualCutscene, setManualCutscene] = useState(false);
  const hold = usePresentationStore(state => state.hold);
  const release = usePresentationStore(state => state.release);
  const doneRef = useRef(false);

  const stage: RevealStage = plan.stages[Math.min(stageIndex, lastIndex)];
  const indexOf = (target: RevealStage) => plan.stages.indexOf(target);
  const reached = (target: RevealStage) => indexOf(target) !== -1 && stageIndex >= indexOf(target);
  const cards: RewardCardItem[] = [
    ...plan.items.map(item => ({ kind: 'item' as const, item })),
    ...(plan.chips > 0 ? [{ kind: 'chips' as const, amount: plan.chips }] : []),
  ];

  // 무대 점유 — 외부 스토어 갱신은 effect에서
  useEffect(() => {
    hold(HOLD_KEY);
    return () => release(HOLD_KEY);
  }, [hold, release]);

  // done 도달 1회 통지
  useEffect(() => {
    if (stage !== 'done' || doneRef.current) return;
    doneRef.current = true;
    release(HOLD_KEY);
    onDone();
  }, [stage, release, onDone]);

  // 자동 진행 (탭이 없을 때)
  useEffect(() => {
    if (reduced) return;
    const ms = stageAutoAdvanceMs(stage, plan);
    if (ms === null) return;
    const timer = setTimeout(() => setStageIndex(index => Math.min(index + 1, lastIndex)), ms);
    return () => clearTimeout(timer);
  }, [stage, plan, reduced, lastIndex]);

  // 카드 플립 — 한 장씩
  useEffect(() => {
    if (reduced || stage !== 'items' || flipped >= cards.length) return;
    const timer = setTimeout(() => {
      setFlipped(count => count + 1);
      playEffect('reward');
    }, STAGE_TIMING_MS.itemFlipGap);
    return () => clearTimeout(timer);
  }, [stage, flipped, cards.length, reduced]);

  // 단계 진입 효과음
  useEffect(() => {
    if (reduced) return;
    if (stage === 'stamp') playEffect('reward');
    else if (stage === 'cutscene') playEffect('unlock');
    else if (stage === 'belt') playEffect('level-up');
  }, [stage, reduced]);

  const advance = () => setStageIndex(index => Math.min(index + 1, lastIndex));
  const handleTap = () => {
    if (stage === 'done' || stage === 'cutscene') return;
    if (stage === 'items' && flipped < cards.length) {
      setFlipped(cards.length);
      return;
    }
    advance();
  };

  const daily = result.chapterId === 'daily';
  const exam = result.mode === 'exam';
  const verdict = daily
    ? `오늘의 수련 ${result.drill.finalCorrect}/${result.drill.slots}문`
    : result.passed
      ? (exam ? '실력 확인 통과 — 챕터 완료로 기록했어요' : '통과')
      : (exam ? '실력 확인 미통과 — 수업으로 배워 볼까요?' : '미통과 — 다시 도전할 수 있어요');
  const accuracy = result.drill.answered > 0 ? Math.round((result.drill.correct / result.drill.answered) * 100) : null;
  const showCutscene = !reduced ? stage === 'cutscene' : manualCutscene;

  return (
    <div
      onClick={handleTap}
      className={stage === 'done' ? '' : 'cursor-pointer'}
      role="presentation"
      aria-live="polite"
    >
      {/* 스탬프 */}
      <motion.p
        initial={reduced ? false : { scale: 2, opacity: 0, rotate: -10 }}
        animate={{ scale: 1, opacity: 1, rotate: -6 }}
        transition={{ type: 'spring', stiffness: 260, damping: 18 }}
        className={`mt-2 mb-3 h-20 text-center text-6xl font-black leading-none ${GRADE_COLOR[result.grade]}`}
        aria-label={`등급 ${result.grade}`}
      >
        {result.grade}
      </motion.p>
      <p className={`text-center text-sm font-bold ${result.passed ? 'text-cyber' : 'text-blossom'}`}>{verdict}</p>
      {result.drill.perfect && (
        <p className="mt-1 text-center text-[11px] font-black tracking-widest text-gilded">★ PERFECT ★ 첫 시도 무오답</p>
      )}

      {/* 통계 + 목표 */}
      <motion.div initial={false} animate={{ opacity: reached('stats') ? 1 : 0, y: reached('stats') ? 0 : 6 }} transition={{ duration: reduced ? 0 : 0.35 }}>
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center text-[11px]">
          <div className="rounded-xl border border-mystic/20 bg-elevated/50 p-2">
            <dt className="text-ink-dim">드릴 정확도</dt>
            <dd className="text-sm font-bold text-ink">{accuracy === null ? '—' : `${accuracy}%`}</dd>
            <dd className="text-[10px] text-ink-dim">{result.drill.finalCorrect}/{result.drill.slots}문{result.drill.retrySkipped ? ' · 재출제 생략' : ''}</dd>
          </div>
          <div className="rounded-xl border border-mystic/20 bg-elevated/50 p-2">
            <dt className="text-ink-dim">최고 콤보</dt>
            <dd className="text-sm font-bold text-gilded">🔥{result.drill.bestStreak}</dd>
          </div>
          <div className="rounded-xl border border-mystic/20 bg-elevated/50 p-2">
            <dt className="text-ink-dim">힌트</dt>
            <dd className="text-sm font-bold text-ink">{result.drill.hintsUsed}회</dd>
          </div>
        </dl>
        {result.live && (
          <ul className="mt-2 space-y-1 text-[11px]" aria-label="목표">
            {result.live.objectives.map(objective => (
              <li key={objective.id} className="flex items-center justify-between rounded-lg border border-mystic/15 px-2 py-1">
                <span className="text-ink">{objective.primary ? '★ ' : '☆ '}{objective.label}</span>
                <span className={objective.achieved === null ? 'text-ink-dim' : objective.achieved ? 'text-cyber' : 'text-blossom'}>
                  {objective.achieved === null ? '해당 없음' : objective.achieved ? '달성' : '미달'}
                </span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 rounded-xl border border-gilded/30 bg-gilded/5 p-2 text-[11px] text-ink">
          <p className="font-bold text-gilded">{daily ? '오늘의 수련 보상' : result.rewards.firstClear ? '첫 완주 보상' : result.passed ? '재도전 보상' : '보상'}</p>
          {result.rewards.dojoXpMilli > 0 && <p>도장 XP +{Math.round(result.rewards.dojoXpMilli / 1000)}</p>}
          {result.rewards.affinity.map(grant => (
            <p key={grant.characterId} className="text-blossom">
              인연 +{Math.round(grant.milli / 1000)}
              {grant.levelBefore !== undefined && grant.levelAfter !== undefined && grant.levelAfter > grant.levelBefore
                ? ` · Lv.${grant.levelBefore} → Lv.${grant.levelAfter}`
                : ''}
            </p>
          ))}
          {result.rewards.dojoXpMilli === 0 && result.rewards.affinity.length === 0 && <p className="text-ink-dim">이번엔 없어요 — 통과하면 보상이 열려요</p>}
          {result.reviewNotesAdded > 0 && <p className="text-ink-dim">복습 노트에 {result.reviewNotesAdded}문 추가</p>}
        </div>
      </motion.div>

      {/* 보상 카드 */}
      {cards.length > 0 && reached('items') && (
        <section className="mt-3" aria-label="획득 보상">
          <p className="mb-1.5 text-[10px] font-bold tracking-wider text-gilded">
            획득 보상{plan.fallback ? ' (지급 예정)' : ''}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {cards.map((card, index) => (
              <RewardItemCard
                key={card.kind === 'chips' ? 'chips' : card.item.id}
                card={card}
                flipped={index < flipped}
                reducedMotion={reduced}
                onClick={reduced && card.kind === 'item' && card.item.kind === 'cg' && plan.cutscene?.id === card.item.id
                  ? () => setManualCutscene(true)
                  : undefined}
              />
            ))}
          </div>
          {reduced && plan.cutscene && (
            <button type="button" onClick={() => setManualCutscene(true)} className="mt-2 w-full rounded-lg border border-gilded/40 py-1.5 text-[11px] font-bold text-gilded">
              CG 보기 — {plan.cutscene.title}
            </button>
          )}
        </section>
      )}

      {/* 띠 승급 */}
      {plan.belt && reached('belt') && (
        <div className="mt-3">
          <BeltBanner belt={plan.belt} settled={stage !== 'belt'} reducedMotion={reduced} />
        </div>
      )}

      {/* 다음 보상 미리보기 */}
      {plan.next.length > 0 && reached('next') && (
        <section className="mt-3" aria-label="다음 보상">
          <p className="mb-1.5 text-[10px] font-bold tracking-wider text-ink-dim">다음 보상 미리보기</p>
          <div className="grid grid-cols-3 gap-2">
            {plan.next.map(item => (
              <RewardItemCard
                key={item.id}
                card={{ kind: 'item', item }}
                flipped
                reducedMotion
                locked={{ requirement: item.requirement }}
              />
            ))}
          </div>
        </section>
      )}

      {plan.unlockedScenes.length > 0 && reached('next') && (
        <p className="mt-2 text-center text-[11px] text-blossom">✦ 인연 씬 해금 — {plan.unlockedScenes.map(scene => scene.title).join(' · ')}</p>
      )}
      {reached('next') && (plan.cutscene || plan.unlockedScenes.length > 0 || plan.items.some(item => item.kind === 'cg' || item.kind === 'outfit' || item.kind === 'title')) && (
        <p className="mt-1 text-center text-[10px] text-ink-dim">받은 CG·씬·의상·칭호는 로비 🖼 기록실에서 언제든 다시 볼 수 있어요</p>
      )}

      {stage !== 'done' && !reduced && (
        <p className="mt-2 text-center text-[10px] text-ink-dim/80">탭하면 바로 넘어가요</p>
      )}

      <RewardCutscene
        cutscene={showCutscene ? plan.cutscene : null}
        onClose={() => {
          if (reduced) setManualCutscene(false);
          else advance();
        }}
      />
    </div>
  );
}
