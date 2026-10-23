'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import CharacterImage from '@/components/characters/CharacterImage';
import { useStoryLive } from '@/components/story/live/use-story-live';
import type { Expression } from '@/lib/assets/character-art';
import { getCharacterById } from '@/lib/characters';
import { adviseHero, followsAdvice, type CoachAdvice } from '@/lib/coach/coach-brain';
import { isPartnerCoachEligible } from '@/lib/coach/coach-eligibility';
import {
  coachActionLabel,
  coachAdviceLine,
  coachReactionLine,
  type CoachReaction,
} from '@/lib/coach/coach-lines';
import { onGameEvent } from '@/lib/events/game-events';
import { usePrefersReducedMotion } from '@/lib/hooks/use-reduced-motion';
import { playEffect } from '@/lib/sound/effects';
import { useGameStore } from '@/lib/store/game-store';
import { usePartnerCoachStore } from '@/lib/store/partner-coach-store';
import { useProgressionStore } from '@/lib/store/progression-store';
import { useSettingsStore } from '@/lib/store/settings-store';

/** 마지막으로 보여 준 훈수 — 내 액션이 오면 이것과 비교한다 */
interface ShownAdvice {
  advice: CoachAdvice;
  handNumber: number;
  /** 훈수 시점의 칩 + 현재 벳 — 슬라이더를 끝까지 올린 레이즈를 '올인 따름'으로 판정 */
  maxTotal: number;
}

interface ReactionView {
  key: number;
  kind: CoachReaction;
  text: string;
}

interface HandTally {
  handNumber: number;
  followed: number;
  lastFollowed: boolean;
}

const REACTION_MS: Record<CoachReaction, number> = {
  followed: 2_200,
  ignored: 2_200,
  'followed-won': 4_000,
  'followed-lost': 5_000,
};

const REACTION_EXPRESSION: Record<CoachReaction, Expression> = {
  followed: 'happy',
  ignored: 'neutral',
  'followed-won': 'happy',
  'followed-lost': 'neutral',
};

/**
 * 파트너 실시간 훈수 — 혼자 연습 테이블에서 내 차례마다 인연 파트너가 한 줄 조언하고,
 * [○○ 말대로 · 액션] 버튼 한 번으로 그대로 실행한다. 따르면 기뻐하고, 안 따라도 꾸짖지 않으며,
 * 따랐는데 쇼다운에서 지면 "결정은 맞았어요"로 위로한다.
 *
 * 노출 조건은 `coach-eligibility.ts` 단일 소스(봇만 상대하는 테이블 · 스토리/주간 도장/토너먼트/아레나 제외 —
 * 스토리는 챕터가 opt-in한 '연습' 스텝(`practice-table.partnerCoach`, Ch1 첫 핸드)만 예외).
 * 판단은 공개 스냅샷만 보는 `coach-brain.ts`, 대사는 `coach-lines.ts`. 서버 전송·보상은 없다(로컬 피드백만).
 * 위치는 테이블 영역 좌하단(액션 독 바로 위) — 독 높이는 그대로라 테이블 좌표가 흔들리지 않는다.
 */
export default function PartnerCoach() {
  const gameState = useGameStore(state => state.gameState);
  const myPlayerId = useGameStore(state => state.myPlayerId);
  const currentRoomId = useGameStore(state => state.currentRoomId);
  const rooms = useGameStore(state => state.rooms);
  const connected = useGameStore(state => state.connected);
  const pendingAction = useGameStore(state => state.pendingAction);
  const sendAction = useGameStore(state => state.sendAction);
  const enabled = useSettingsStore(state => state.partnerCoach);
  const selectedPartnerId = useProgressionStore(state => state.snapshot?.profile.selectedCharacterId ?? null);
  const followCount = usePartnerCoachStore(state => state.followCount);
  const { active: inStoryRoom, step: storyStep, run: storyRun } = useStoryLive();
  const reducedMotion = usePrefersReducedMotion();

  // 스토리 방은 챕터 데이터가 opt-in한 '연습' 스텝(Ch1 첫 핸드)에서만 — 파트너는 그 런의 파트너(라인업 'partner'와 같은 사람)
  const storyCoachStep = inStoryRoom && storyStep?.kind === 'practice-table' && storyStep.partnerCoach === true;
  const partnerId = inStoryRoom ? (storyRun?.context.partnerId ?? null) : selectedPartnerId;
  const character = partnerId ? getCharacterById(partnerId) ?? null : null;
  const roomTableType = rooms.find(room => room.id === currentRoomId)?.tableType;
  const eligible = !!character && isPartnerCoachEligible({
    enabled,
    gameState,
    myPlayerId,
    roomTableType,
    inStoryRoom,
    storyCoachStep,
  });

  const advice = useMemo(
    () => (eligible && gameState && myPlayerId ? adviseHero(gameState, myPlayerId) : null),
    [eligible, gameState, myPlayerId],
  );

  const [reaction, setReaction] = useState<ReactionView | null>(null);
  const [confirmAllInKey, setConfirmAllInKey] = useState<string | null>(null);
  const shownRef = useRef<ShownAdvice | null>(null);
  const tallyRef = useRef<HandTally>({ handNumber: -1, followed: 0, lastFollowed: false });
  const eligibleRef = useRef(false);
  const partnerRef = useRef<string | null>(null);
  const reactionTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 이벤트 콜백이 최신 값을 보도록 ref로 옮긴다 (렌더 중 ref 쓰기 금지 규칙)
  useEffect(() => {
    eligibleRef.current = eligible;
    partnerRef.current = character?.id ?? null;
  }, [eligible, character?.id]);

  useEffect(() => {
    if (!advice || !gameState || !myPlayerId) return;
    const me = gameState.players.find(player => player.id === myPlayerId);
    shownRef.current = {
      advice,
      handNumber: gameState.handNumber,
      maxTotal: me ? me.chips + me.currentBet : 0,
    };
  }, [advice, gameState, myPlayerId]);

  useEffect(() => {
    const show = (kind: CoachReaction, seed: number) => {
      const text = coachReactionLine(partnerRef.current, kind, seed);
      if (!text) return;
      if (reactionTimerRef.current) clearTimeout(reactionTimerRef.current);
      setReaction({ key: Date.now(), kind, text });
      reactionTimerRef.current = setTimeout(() => setReaction(null), REACTION_MS[kind]);
    };

    const unsubscribe = onGameEvent(event => {
      const store = useGameStore.getState();
      const me = store.myPlayerId;
      switch (event.type) {
        case 'hand-start':
          tallyRef.current = { handNumber: event.handNumber, followed: 0, lastFollowed: false };
          shownRef.current = null;
          break;
        case 'action': {
          if (!me || event.playerId !== me) break;
          const shown = shownRef.current;
          shownRef.current = null;
          const state = store.gameState;
          if (!shown || !eligibleRef.current || !state || shown.handNumber !== state.handNumber) break;
          // 턴 시간 초과 자동 처리(자리비움 마킹)는 내가 고른 액션이 아니다 — 반응하지 않는다
          const meNow = state.players.find(player => player.id === me);
          if (meNow?.sitOutNext) break;
          const followed = followsAdvice(shown.advice, event.actionType, event.amount, shown.maxTotal);
          if (tallyRef.current.handNumber !== state.handNumber) {
            tallyRef.current = { handNumber: state.handNumber, followed: 0, lastFollowed: false };
          }
          tallyRef.current.lastFollowed = followed;
          if (followed) {
            tallyRef.current.followed += 1;
            usePartnerCoachStore.getState().recordFollow(state.handNumber);
          }
          show(followed ? 'followed' : 'ignored', state.handNumber + state.actionSeq);
          break;
        }
        case 'winners': {
          const tally = tallyRef.current;
          tallyRef.current = { handNumber: -1, followed: 0, lastFollowed: false };
          if (!me || !eligibleRef.current || tally.handNumber !== event.handNumber || tally.followed === 0) break;
          if (event.winners.some(winner => winner.playerId === me)) {
            // 내가 가장 큰 팟을 가져간 핸드는 승리 컷인(WinnerCutIn)이 파트너의 "같이 이겼다"를 띄운다 —
            // 좌하단 반응까지 띄우면 모바일 하단 컷인과 겹친다(2026-10-24)
            const top = event.winners.reduce((a, b) => (b.amount > a.amount ? b : a));
            if (top.playerId !== me) show('followed-won', event.handNumber);
            break;
          }
          // 쇼다운까지 가서 졌고, 마지막 결정이 훈수대로였을 때만 "결정은 맞았어요"
          const mine = event.players.find(player => player.id === me);
          const wentToShowdown = event.winners.some(winner => winner.hand);
          if (mine && mine.status !== 'folded' && wentToShowdown && tally.lastFollowed) {
            show('followed-lost', event.handNumber);
          }
          break;
        }
      }
    });
    return () => {
      unsubscribe();
      if (reactionTimerRef.current) clearTimeout(reactionTimerRef.current);
    };
  }, []);

  const showingAdvice = !!advice && !!character;
  const showingReaction = !showingAdvice && !!reaction && !!character && eligible;
  const visible = showingAdvice || showingReaction;

  // PartnerReactions(같은 좌하단 자리)가 겹치지 않게 알린다 — 외부 store 동기화
  useEffect(() => {
    usePartnerCoachStore.getState().setBubbleVisible(visible);
  }, [visible]);
  useEffect(() => () => usePartnerCoachStore.getState().setBubbleVisible(false), []);

  if (!character || !gameState) return null;

  const me = gameState.players.find(player => player.id === myPlayerId);
  const decisionKey = `${gameState.handNumber}-${gameState.actionSeq}`;
  const seed = gameState.handNumber + gameState.actionSeq;
  const disabled = !connected || !!pendingAction;
  const confirming = advice?.action === 'all-in' && confirmAllInKey === decisionKey;

  const actionLabel = advice
    ? coachActionLabel(advice, {
      bigBlind: gameState.bigBlind,
      isBet: gameState.street !== 'preflop' && gameState.currentBet === 0,
      callIsAllIn: !!me && gameState.currentBet - me.currentBet >= me.chips,
    })
    : '';

  const onFollow = () => {
    if (!advice || disabled) return;
    // 올인은 ActionBar와 같은 2탭 확인 — 훈수 버튼이 오조작 방지를 우회하지 않게 한다
    if (advice.action === 'all-in' && !confirming) {
      playEffect('ui-click');
      setConfirmAllInKey(decisionKey);
      return;
    }
    playEffect('ui-click');
    setConfirmAllInKey(null);
    sendAction(advice.action, advice.amount);
  };

  const motionProps = reducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : {
      initial: { opacity: 0, y: 10, scale: 0.96 },
      animate: { opacity: 1, y: 0, scale: 1 },
      exit: { opacity: 0, scale: 0.96 },
    };

  return (
    <div
      className="pointer-events-none absolute bottom-1.5 left-1.5 z-40"
      // 히어로 좌석(하단 중앙)을 가리지 않도록 화면 절반에서 좌석 폭만큼 비운다 — 320px에서도 최소 폭 유지
      style={{ width: 'clamp(118px, calc(50% - 58px), 240px)' }}
    >
      <AnimatePresence mode="wait">
        {showingAdvice && advice && (
          <motion.div
            key={`advice-${decisionKey}`}
            {...motionProps}
            className="pointer-events-auto rounded-xl border bg-panel/92 px-2 py-1.5 shadow-lg backdrop-blur-sm"
            style={{ borderColor: `${character.color}66` }}
            role="status"
            aria-live="polite"
          >
            <div className="flex items-center gap-1.5">
              <span className="block h-7 w-7 shrink-0 overflow-hidden rounded-full">
                <CharacterImage characterId={character.id} expression="thinking" round className="h-full w-full text-sm" />
              </span>
              <span className="min-w-0 truncate text-[10px] font-bold" style={{ color: character.color }}>
                {character.name}의 훈수
              </span>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-ink">
              {coachAdviceLine(character.id, advice, seed)}
            </p>
            <button
              type="button"
              onClick={onFollow}
              disabled={disabled}
              className={`mt-1.5 w-full rounded-lg border px-1.5 py-1 text-[10.5px] font-bold leading-tight transition-colors
                ${confirming
                  ? 'border-blossom-hot bg-blossom-hot/25 text-white'
                  : 'border-blossom/50 bg-blossom/15 text-blossom hover:bg-blossom/25'}
                ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
            >
              {confirming ? (
                '올인 확정?'
              ) : (
                <>
                  <span className="inline-block">{character.name} 말대로</span>
                  {' · '}
                  <span className="inline-block">{actionLabel}</span>
                </>
              )}
            </button>
          </motion.div>
        )}
        {showingReaction && reaction && (
          <motion.div
            key={`reaction-${reaction.key}`}
            {...motionProps}
            className="relative rounded-xl border bg-panel/92 px-2 py-1.5 shadow-lg backdrop-blur-sm"
            style={{ borderColor: `${character.color}66` }}
            role="status"
            aria-live="polite"
          >
            <div className="flex items-start gap-1.5">
              <span className="relative block h-7 w-7 shrink-0 overflow-hidden rounded-full">
                <CharacterImage
                  characterId={character.id}
                  expression={REACTION_EXPRESSION[reaction.kind]}
                  round
                  className="h-full w-full text-sm"
                />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[10px] font-bold" style={{ color: character.color }}>
                  {character.name}
                </span>
                <span className="block text-[11px] leading-snug text-ink">{reaction.text}</span>
                {reaction.kind === 'followed' && followCount > 0 && (
                  <span className="mt-0.5 block text-[10px] text-blossom">
                    오늘 {character.name} 말대로 {followCount}번
                  </span>
                )}
              </span>
            </div>
            {reaction.kind === 'followed' && (
              <motion.span
                aria-hidden
                className="pointer-events-none absolute -top-2 left-4 text-base text-blossom"
                initial={reducedMotion ? { opacity: 1 } : { opacity: 0, y: 6, scale: 0.6 }}
                animate={reducedMotion ? { opacity: 1 } : { opacity: [0, 1, 1, 0], y: -18, scale: 1.15 }}
                transition={{ duration: reducedMotion ? 0 : 1.2, ease: 'easeOut' }}
              >
                ♥
              </motion.span>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
