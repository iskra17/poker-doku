'use client';

import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'framer-motion';
import CharacterImage from '@/components/characters/CharacterImage';
import CardComponent from '@/components/table/Card';
import ChipSVG, { decomposeChips } from '@/components/table/ChipSVG';
import TableFelt from '@/components/table/TableFelt';
import { BET_POSITIONS, BOARD_POS, DEALER_BTN_POSITIONS, POT_POS, SEATS, type TablePos } from '@/components/table/table-layout';
import { getCharacterById } from '@/lib/characters';
import { formatCard } from '@/lib/poker/card-notation';
import type { Card } from '@/lib/poker/types';
import { useProfileStore } from '@/lib/store/profile-store';
import { useProgressionStore } from '@/lib/store/progression-store';
import { buildDrillTableModel, planDrillDemo, type DrillDemo, type DrillTableModel, type DrillTableSeat } from '@/lib/story/drill-table-model';
import type { DrillCategory, DrillResult, DrillSituation } from '@/lib/story/drills/types';

/**
 * 수련 문제 테이블 — 실전 테이블(`PokerTable`)과 같은 타원 펠트(`TableFelt`) 위에 문제 상황을 앉힌다.
 * 게임 store에 의존하지 않는다 (상황은 props, 좌석 배치는 `drill-table-model.ts` 순수 함수).
 *
 * - 인트로(상황 재생): 카드 딜링 → 보드가 스트리트 순으로 → 팟 칩이 모임 → 내 차례 강조 (~1.6초, 탭하면 즉시 완성).
 *   `prefers-reduced-motion`이면 정지 화면. 보기 입력은 막지 않는다(입력은 부모 소관).
 * - 판단 재생: **`result`(서버 채점 결과)가 있을 때만** `planDrillDemo`로 계획한다. 채점 전에는 정답을 계산하지도
 *   보여 주지도 않는다 — 족보 평가·포지션 라벨 걷기·액션 순서 모두 result 이후.
 */

interface DrillTableProps {
  situation: DrillSituation;
  /** 문항 정체성 — 바뀌면 인트로를 다시 재생한다 (같은 키에서 상황만 바뀌면 새 카드만 딜링) */
  replayKey: string;
  category?: DrillCategory;
  templateId?: string;
  /** 서버 채점 결과 — 이 문항의 결과일 때만 넘긴다. 있을 때만 판단 재생 */
  result?: DrillResult | null;
  /** 인트로 재생 (기본 true) */
  intro?: boolean;
}

export default function DrillTable(props: DrillTableProps) {
  return (
    <MotionConfig reducedMotion="user">
      <DrillTableStage key={props.replayKey} {...props} />
    </MotionConfig>
  );
}

// ---------------------------------------------------------------------------
// 타임라인 — 단계 번호를 타이머 콜백에서만 올린다 (effect 본문 setState 금지 규칙)

function useTimeline(runKey: string | null, schedule: readonly number[]) {
  const [state, setState] = useState<{ key: string | null; step: number }>({ key: null, step: 0 });
  const scheduleKey = schedule.join(',');
  const total = schedule.length;
  useEffect(() => {
    if (runKey === null || scheduleKey === '') return;
    const times = scheduleKey.split(',').map(Number);
    const timers = times.map((at, index) => setTimeout(() => {
      setState(prev => (prev.key === runKey && prev.step >= index + 1 ? prev : { key: runKey, step: index + 1 }));
    }, at));
    return () => timers.forEach(clearTimeout);
  }, [runKey, scheduleKey]);
  const step = runKey !== null && state.key === runKey ? state.step : 0;
  const finish = useCallback(() => {
    if (runKey !== null) setState({ key: runKey, step: total });
  }, [runKey, total]);
  return { step, total, finish };
}

/** 누적 시각(ms) 배열 */
function cumulative(deltas: readonly number[]): number[] {
  let at = 0;
  return deltas.map(delta => (at += delta));
}

const INTRO = { cards: 1, flop: 2, turn: 3, river: 4, pot: 5, turn_glow: 6 } as const;
const INTRO_STEPS = 6;

function introSchedule(boardLength: number): number[] {
  return cumulative([
    120,
    boardLength >= 3 ? 460 : 0,
    boardLength >= 4 ? 320 : 0,
    boardLength >= 5 ? 320 : 0,
    300,
    420,
  ]);
}

function demoSchedule(demo: DrillDemo): number[] {
  switch (demo.kind) {
    case 'showdown':
      return cumulative([...demo.showdown.entries.map((_, i) => (i === 0 ? 200 : 520)), 520, 560]);
    case 'position-walk':
      return cumulative([150, 520, ...demo.sequence.slice(1).map(() => 340), 380]);
    case 'action-order':
      return cumulative([180, ...demo.order.slice(1).map(() => 380), 480]);
    case 'act':
      return cumulative([200, 700]);
    case 'answer':
      return [200];
  }
}

const formatChips = (chips: number): string => chips.toLocaleString('ko-KR');
const cardKey = (card: Card) => formatCard(card);

const STREET_LABEL: Record<DrillSituation['street'], string> = {
  preflop: '프리플랍',
  flop: '플랍',
  turn: '턴',
  river: '리버',
  showdown: '쇼다운',
};

// ---------------------------------------------------------------------------

function DrillTableStage({ situation, category, templateId, result = null, intro = true }: DrillTableProps) {
  const reduce = useReducedMotion() ?? false;
  const heroAvatarId = useProfileStore(state => state.profile?.avatarId ?? null);
  const feltId = useProgressionStore(state => state.snapshot?.cosmetics?.felt ?? null);
  const model = useMemo(() => buildDrillTableModel(situation, { heroAvatarId }), [situation, heroAvatarId]);

  const animateIntro = intro && !reduce;
  const introTimeline = useTimeline(animateIntro ? 'intro' : null, introSchedule(model.board.length));

  // 판단 재생 — 채점 결과가 있을 때만 계획한다 (정답 누출 금지)
  const demo = useMemo<DrillDemo | null>(
    () => (result ? planDrillDemo(model, result.correctAnswer, { category, templateId }) : null),
    [result, model, category, templateId],
  );
  const [demoRun, setDemoRun] = useState(0);
  const demoTimeline = useTimeline(demo && !reduce ? `demo:${demoRun}` : null, demo ? demoSchedule(demo) : []);
  const demoStep = demo ? (reduce ? demoTimeline.total : demoTimeline.step) : 0;
  const demoDone = demo !== null && demoStep >= demoTimeline.total;

  const introStep = !animateIntro || demo ? INTRO_STEPS : introTimeline.step;
  const introRunning = animateIntro && !demo && introStep < INTRO_STEPS;

  const handleTap = () => {
    if (introRunning) introTimeline.finish();
    else if (demo && !demoDone) demoTimeline.finish();
  };

  const visibleBoard = introStep >= INTRO.river ? model.board.length
    : introStep >= INTRO.turn ? Math.min(4, model.board.length)
      : introStep >= INTRO.flop ? Math.min(3, model.board.length) : 0;
  const cardsDealt = introStep >= INTRO.cards;
  const potShown = introStep >= INTRO.pot;
  const heroTurn = introStep >= INTRO.turn_glow && !demo && model.seats[0].holeCards.length > 0;

  const view = describeDemo(model, demo, demoStep);

  return (
    <div className="w-full">
      {/* 판단 재생 캡션 — 테이블 밖 고정 높이 줄 (상단 좌석 배지와 겹치지 않게, 레이아웃 흔들림 없이) */}
      <div className="flex h-4 items-center justify-center" aria-live="polite">
        <AnimatePresence mode="wait">
          {view.caption && (
            <motion.p
              key={view.caption}
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="max-w-full truncate text-center text-[11px] font-bold text-gilded"
            >
              {view.caption}
            </motion.p>
          )}
        </AnimatePresence>
      </div>
      <div
        className="relative mx-auto w-full select-none"
        style={{ maxWidth: 'min(100%, calc(44dvh * 10 / 11))', aspectRatio: '10 / 11' }}
        onClick={handleTap}
        role="group"
        aria-label={tableAriaLabel(model)}
      >
        <TableFelt story feltId={feltId} />

        {/* 팟 — 보드 위. 쇼다운 재생에서는 승자 앞으로 미끄러진다 */}
        {potShown && model.pot > 0 && (
          <motion.div
            className="absolute z-20"
            style={{ x: '-50%', y: '-78%' }}
            initial={{ left: POT_POS.x, top: POT_POS.y, opacity: 0, scale: 0.8 }}
            animate={{ left: view.potTarget.x, top: view.potTarget.y, opacity: 1, scale: 1 }}
            transition={{ duration: view.potTarget === POT_POS ? 0.3 : 0.6, ease: 'easeOut' }}
          >
            <PotPill amount={model.pot} street={STREET_LABEL[model.street]} withBet={model.toCall > 0} />
          </motion.div>
        )}
        {/* 팟 칩 모으기 — 인트로에서 한 번 */}
        {animateIntro && !demo && introStep === INTRO.pot && model.pot > 0 && model.seats.map(seat => (
          seat.occupant === 'empty' ? null : (
            <motion.div
              key={`gather-${seat.slot}`}
              className="pointer-events-none absolute z-10"
              style={{ x: '-50%', y: '-50%' }}
              initial={{ left: BET_POSITIONS[seat.slot].x, top: BET_POSITIONS[seat.slot].y, opacity: 1 }}
              animate={{ left: POT_POS.x, top: POT_POS.y, opacity: 0 }}
              transition={{ duration: 0.45, ease: 'easeIn' }}
            >
              <ChipSVG denom={decomposeChips(model.bigBlind, 1)[0]} size={14} />
            </motion.div>
          )
        ))}

        {/* 보드 */}
        <div className="absolute z-10" style={{ left: BOARD_POS.x, top: BOARD_POS.y, transform: 'translate(-50%, -50%)' }}>
          <div className="flex items-center gap-[3px]" aria-label="보드">
            {model.board.slice(0, visibleBoard).map((card, index) => (
              <CardComponent
                key={cardKey(card)}
                card={card}
                size="sm"
                delay={index < 3 ? index * 0.08 : 0}
                highlight={view.highlightCards?.has(cardKey(card)) ?? false}
                dimmed={view.highlightCards ? !view.highlightCards.has(cardKey(card)) : false}
              />
            ))}
            {Array.from({ length: Math.max(0, 5 - visibleBoard) }).map((_, index) => (
              <div key={`empty-${index}`} className="h-14 w-10 rounded-lg border-2 border-dashed border-white/10" />
            ))}
          </div>
        </div>

        {/* 좌석 */}
        {model.seats.map(seat => (
          <DrillSeat
            key={seat.slot}
            seat={seat}
            pos={SEATS[seat.slot]}
            cardsDealt={cardsDealt}
            dealDelay={seat.slot * 0.05}
            showSeatNumber={model.showSeatNumbers}
            highlightCards={view.highlightCards}
            label={view.labels.get(seat.slot) ?? null}
            badge={view.badges.get(seat.slot) ?? null}
            spotlight={view.spotlight === seat.slot || (heroTurn && seat.slot === 0)}
            mucked={view.mucked && seat.slot === 0}
          />
        ))}

        {/* D / SB / BB */}
        {model.dealerSlot !== null && (
          <PositionButton slot={model.dealerSlot} label="D" title="딜러 버튼" className="bg-gilded border-gilded text-[11px]" pulse={view.dealerPulse} />
        )}
        {model.sbSlot !== null && <PositionButton slot={model.sbSlot} label="SB" title="스몰 블라인드" className="bg-cyber border-cyber text-[8px]" />}
        {model.bbSlot !== null && <PositionButton slot={model.bbSlot} label="BB" title="빅 블라인드" className="bg-blossom border-blossom text-[8px]" />}

        {/* 내 앞 — 콜 금액 / 정답 액션 실연 / 정답 말풍선 */}
        <AnimatePresence>
          {heroTurn && model.toCall > 0 && (
            <motion.div
              key="to-call"
              className="absolute z-20"
              style={{ left: BET_POSITIONS[0].x, top: BET_POSITIONS[0].y, x: '-50%', y: '-50%' }}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
            >
              <span className="flex items-center gap-1 rounded-full border border-blossom/50 bg-black/60 px-2 py-0.5 text-[11px] font-bold text-blossom tabular-nums">
                콜 {formatChips(model.toCall)}
              </span>
            </motion.div>
          )}
          {view.act && (
            <motion.div
              key="act"
              className="absolute z-20"
              style={{ x: '-50%', y: '-50%' }}
              initial={{ left: SEATS[0].x, top: '82%', opacity: 0, scale: 0.7 }}
              animate={{ left: BET_POSITIONS[0].x, top: BET_POSITIONS[0].y, opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, ease: 'easeOut' }}
            >
              <ActChips label={view.act.label} chips={view.act.chips} action={view.act.action} />
            </motion.div>
          )}
          {view.answer && (
            <motion.div
              key="answer"
              className="absolute z-30 max-w-[78%]"
              style={{ left: '50%', top: BET_POSITIONS[0].y, x: '-50%', y: '-50%' }}
              initial={{ opacity: 0, scale: 0.85 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              <span className="block rounded-2xl border border-gilded/60 bg-panel/95 px-3 py-1 text-center text-[12px] font-bold leading-snug text-gilded shadow-lg line-clamp-2">
                정답 · {view.answer}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {demoDone && !reduce && (
          <button
            type="button"
            onClick={event => {
              event.stopPropagation();
              setDemoRun(run => run + 1);
            }}
            className="absolute bottom-[1%] right-[2%] z-30 rounded-full border border-mystic/40 bg-black/50 px-2 py-0.5 text-[10px] font-bold text-ink-dim hover:text-ink"
          >
            다시 보기
          </button>
        )}
        {introRunning && (
          <span className="pointer-events-none absolute bottom-[1%] right-[2%] z-30 text-[9px] text-ink-dim/70">탭하면 바로 보기</span>
        )}
      </div>
      <TableNotes situation={situation} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// 판단 재생 → 화면 요소

interface DemoView {
  caption: string | null;
  labels: Map<number, { text: string; emphasis: boolean }>;
  badges: Map<number, { text: string; tone: 'gilded' | 'cyber' | 'blossom' | 'ink' }>;
  spotlight: number | null;
  highlightCards: Set<string> | null;
  potTarget: TablePos;
  dealerPulse: boolean;
  mucked: boolean;
  act: { label: string; chips: number | null; action: string } | null;
  answer: string | null;
}

function describeDemo(model: DrillTableModel, demo: DrillDemo | null, step: number): DemoView {
  const view: DemoView = {
    caption: null, labels: new Map(), badges: new Map(), spotlight: null, highlightCards: null,
    potTarget: POT_POS, dealerPulse: false, mucked: false, act: null, answer: null,
  };
  if (!demo || step <= 0) return view;

  switch (demo.kind) {
    case 'showdown': {
      const { entries, winnerSlots } = demo.showdown;
      entries.forEach((entry, index) => {
        if (step >= index + 1) view.badges.set(entry.slot, { text: entry.rankName, tone: 'ink' });
      });
      view.spotlight = entries[Math.min(step, entries.length) - 1]?.slot ?? null;
      if (step >= entries.length + 1) {
        const keys = new Set<string>();
        for (const entry of entries) if (winnerSlots.includes(entry.slot)) entry.cards.forEach(card => keys.add(cardKey(card)));
        view.highlightCards = keys;
        view.spotlight = winnerSlots.length === 1 ? winnerSlots[0] : null;
        for (const slot of winnerSlots) {
          const entry = entries.find(e => e.slot === slot);
          if (entry) view.badges.set(slot, { text: entries.length > 1 ? `${entry.rankName} 승리` : entry.rankName, tone: 'gilded' });
        }
        if (entries.length > 1) {
          const winner = winnerSlots.length === 1 ? model.seats[winnerSlots[0]] : null;
          view.caption = winner ? `${winner.occupant === 'hero' ? '내' : `${winner.name}의`} 다섯 장이 가장 강해요` : '같은 족보 — 팟을 나눠요';
        } else {
          view.caption = '빛나는 다섯 장이 최고 족보예요';
        }
      }
      if (step >= entries.length + 2 && entries.length > 1 && winnerSlots.length === 1) view.potTarget = BET_POSITIONS[winnerSlots[0]];
      break;
    }
    case 'position-walk': {
      view.dealerPulse = step === 1;
      view.caption = 'D에서 시계 방향으로 BTN → SB → BB → UTG → HJ → CO';
      const shown = Math.min(Math.max(step - 1, 0), demo.sequence.length);
      demo.sequence.slice(0, shown).forEach(entry => view.labels.set(entry.slot, { text: entry.label, emphasis: false }));
      view.spotlight = shown > 0 ? demo.sequence[shown - 1].slot : null;
      if (step >= demo.sequence.length + 2) {
        view.labels.set(0, { text: demo.heroLabel, emphasis: true });
        view.spotlight = 0;
        view.caption = `내 자리는 ${demo.heroLabel}`;
      }
      break;
    }
    case 'action-order': {
      const shown = Math.min(step, demo.order.length);
      demo.order.slice(0, shown).forEach((entry, index) => {
        view.badges.set(entry.slot, index === 0 ? { text: '첫 액션', tone: 'gilded' } : { text: `${index + 1}번째`, tone: 'ink' });
      });
      view.spotlight = shown > 0 ? demo.order[shown - 1].slot : null;
      const first = demo.order[0];
      view.caption = model.street === 'preflop' ? '프리플랍은 BB 다음 자리(UTG)부터' : '플랍부터는 버튼 다음 자리(SB)부터';
      if (step > demo.order.length && first) {
        view.spotlight = first.slot;
        view.caption = `가장 먼저 액션하는 자리: ${first.label}`;
      }
      break;
    }
    case 'act': {
      view.spotlight = 0;
      view.badges.set(0, { text: demo.label, tone: demo.action === 'fold' ? 'blossom' : 'cyber' });
      if (demo.action === 'fold') view.mucked = true;
      else if (demo.action !== 'check') view.act = { label: demo.label, chips: demo.chips, action: demo.action };
      view.caption = `정답 액션: ${demo.label}`;
      break;
    }
    case 'answer': {
      view.spotlight = 0;
      view.answer = demo.label;
      break;
    }
  }
  return view;
}

// ---------------------------------------------------------------------------
// 하위 표시 요소

function DrillSeat({ seat, pos, cardsDealt, dealDelay, showSeatNumber, highlightCards, label, badge, spotlight, mucked }: {
  seat: DrillTableSeat;
  pos: TablePos;
  cardsDealt: boolean;
  dealDelay: number;
  showSeatNumber: boolean;
  highlightCards: Set<string> | null;
  label: { text: string; emphasis: boolean } | null;
  badge: { text: string; tone: 'gilded' | 'cyber' | 'blossom' | 'ink' } | null;
  spotlight: boolean;
  mucked: boolean;
}) {
  const seatNumber = showSeatNumber && seat.seatIndex !== null ? seat.seatIndex + 1 : null;
  if (seat.occupant === 'empty') {
    return (
      <div className="pointer-events-none absolute z-0" style={{ left: pos.x, top: pos.y, transform: 'translate(-50%, -50%)' }} aria-hidden>
        <div className="relative flex h-9 w-9 items-center justify-center rounded-full border-2 border-dashed border-white/15 bg-black/20">
          {seatNumber !== null && <span className="text-[9px] font-bold text-ink-dim/60">{seatNumber}</span>}
        </div>
        {label && <SeatLabel label={label} />}
      </div>
    );
  }

  const hero = seat.occupant === 'hero';
  const profile = seat.characterId ? getCharacterById(seat.characterId) : undefined;
  const color = profile?.color ?? 'var(--color-mystic)';
  const cardSide: 'left' | 'right' = seat.slot === 4 || seat.slot === 5 ? 'left' : 'right';
  const shownLabel = label?.text ?? seat.position;
  const cards = seat.holeCards;
  const faceSize = hero ? 'sm' : 'xs';

  return (
    <div className="absolute z-10" style={{ left: pos.x, top: pos.y, transform: 'translate(-50%, -50%)' }}>
      <div className="relative flex flex-col items-center">
        {/* 배지(족보·액션 순서·액션) — 아바타 위, 포지션 배지(아바타 우상단)보다 한 줄 위로 띄워 둘 다 읽히게 */}
        <AnimatePresence>
          {badge && (
            <motion.span
              key={badge.text}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className={`absolute bottom-full left-1/2 z-30 mb-3 whitespace-nowrap rounded-full border px-1.5 py-px text-[10px] font-black shadow ${BADGE_TONE[badge.tone]}`}
              style={{ x: '-50%' }}
            >
              {badge.text}
            </motion.span>
          )}
        </AnimatePresence>

        <motion.div
          className={`relative ${hero ? 'h-11 w-11' : 'h-10 w-10'} rounded-full`}
          animate={spotlight ? { scale: [1, 1.08, 1] } : { scale: 1 }}
          transition={spotlight ? { duration: 0.9, repeat: Infinity } : { duration: 0.2 }}
          style={{ boxShadow: spotlight ? `0 0 0 2px var(--color-gilded), 0 0 18px var(--color-gilded)` : `0 0 8px ${color}40` }}
        >
          <CharacterImage
            characterId={seat.characterId ?? 'player'}
            expression="neutral"
            round
            className="h-full w-full text-lg"
          />
          {/* 포지션 배지 */}
          {shownLabel && (
            <span
              className={`absolute -right-2 -top-1 z-20 rounded-full border px-1 text-[9px] font-black leading-tight ${
                label?.emphasis ? 'scale-125 border-gilded bg-gilded text-abyss'
                  : shownLabel === '?' ? 'border-mystic/60 bg-black/80 text-mystic'
                    : label ? 'border-gilded/70 bg-black/80 text-gilded' : 'border-cyber/50 bg-black/80 text-cyber'
              }`}
            >
              {shownLabel}
            </span>
          )}
          {seatNumber !== null && (
            <span className="absolute -left-1.5 -top-1 z-20 rounded-full bg-black/80 px-1 text-[8px] font-bold leading-tight text-ink-dim">{seatNumber}번</span>
          )}

          {/* 홀카드 — 아바타 옆 */}
          {cardsDealt && (cards.length > 0 || seat.cardBacks) && (
            <motion.div
              className="absolute top-1/2 z-20 flex gap-0.5"
              style={{ ...(cardSide === 'left' ? { right: 'calc(100% - 6px)' } : { left: 'calc(100% - 6px)' }), y: '-50%' }}
              animate={mucked ? { opacity: 0.35, y: '-80%', rotate: -10, scale: 0.85 } : { opacity: 1, y: '-50%', rotate: 0, scale: 1 }}
              transition={{ duration: 0.45 }}
            >
              {cards.length > 0
                ? cards.map((card, index) => (
                  <CardComponent
                    key={cardKey(card)}
                    card={card}
                    size={faceSize}
                    hidden={mucked}
                    delay={dealDelay + index * 0.08}
                    highlight={(hero && !highlightCards) || (highlightCards?.has(cardKey(card)) ?? false)}
                    dimmed={highlightCards ? !highlightCards.has(cardKey(card)) : false}
                  />
                ))
                : [0, 1].map(index => (
                  <CardComponent key={index} card={{ rank: 'A', suit: 'spades' }} hidden size="2xs" delay={dealDelay + index * 0.08} />
                ))}
            </motion.div>
          )}
        </motion.div>

        {/* 이름·스택 플레이트 */}
        <div className="relative z-20 -mt-1.5 min-w-[54px] rounded-md border border-white/10 bg-black/70 px-1.5 py-px text-center">
          <p className={`mx-auto max-w-[64px] truncate text-[10px] font-bold leading-tight ${hero ? 'text-blossom' : 'text-white'}`}>{seat.name}</p>
          {seat.stackChips !== null && (
            <p className="text-[9px] font-semibold leading-tight text-gilded tabular-nums">{formatChips(seat.stackChips)}</p>
          )}
        </div>
        {seat.rangeTag && (
          <span className="mt-0.5 rounded bg-gilded/20 px-1 text-[9px] font-bold text-gilded">{seat.rangeTag}</span>
        )}
      </div>
    </div>
  );
}

const BADGE_TONE: Record<'gilded' | 'cyber' | 'blossom' | 'ink', string> = {
  gilded: 'border-gilded bg-gilded text-abyss',
  cyber: 'border-cyber/70 bg-black/85 text-cyber',
  blossom: 'border-blossom/70 bg-black/85 text-blossom',
  ink: 'border-white/20 bg-black/85 text-ink',
};

function SeatLabel({ label }: { label: { text: string; emphasis: boolean } }) {
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.6 }}
      animate={{ opacity: 1, scale: 1 }}
      className="absolute left-1/2 top-1/2 rounded-full border border-gilded/60 bg-black/80 px-1 text-[9px] font-black text-gilded"
      style={{ x: '-50%', y: '-50%' }}
    >
      {label.text}
    </motion.span>
  );
}

function PositionButton({ slot, label, title, className, pulse = false }: { slot: number; label: string; title: string; className: string; pulse?: boolean }) {
  const pos = DEALER_BTN_POSITIONS[slot];
  return (
    <motion.div
      className="pointer-events-none absolute z-20"
      style={{ left: pos.x, top: pos.y, x: '-50%', y: '-50%' }}
      animate={pulse ? { scale: [1, 1.45, 1, 1.3, 1] } : { scale: 1 }}
      transition={{ duration: pulse ? 0.9 : 0.2 }}
    >
      <div className={`flex h-6 w-6 items-center justify-center rounded-full border-2 font-bold text-abyss shadow-sm ${className}`} title={title} aria-label={title}>
        {label}
      </div>
    </motion.div>
  );
}

function PotPill({ amount, street, withBet }: { amount: number; street: string; withBet: boolean }) {
  const chips = decomposeChips(amount, 3);
  return (
    <div className="flex flex-col items-center">
      <div className="flex items-center gap-1 rounded-full border border-gilded/40 bg-black/60 px-2 py-0.5 shadow-lg">
        <span className="text-[9px] font-bold text-ink-dim">{street}</span>
        <span className="flex -space-x-1.5">
          {chips.map((denom, index) => <ChipSVG key={index} denom={denom} size={13} />)}
        </span>
        <span className="text-[11px] font-bold text-gilded tabular-nums">팟 {formatChips(amount)}</span>
      </div>
      {withBet && <span className="mt-px text-[8px] text-ink-dim">상대 벳 포함</span>}
    </div>
  );
}

function ActChips({ label, chips, action }: { label: string; chips: number | null; action: string }) {
  const denoms = decomposeChips(chips ?? 100, 3);
  return (
    <div className="flex items-center gap-1 rounded-full border border-cyber/60 bg-black/70 px-2 py-0.5 shadow-lg">
      <span className="flex -space-x-1.5">
        {denoms.map((denom, index) => <ChipSVG key={index} denom={denom} size={13} />)}
      </span>
      <span className={`text-[11px] font-black ${action === 'all-in' ? 'text-blossom' : 'text-cyber'}`}>
        {label}{chips !== null && label.indexOf(formatChips(chips)) < 0 ? ` ${formatChips(chips)}` : ''}
      </span>
    </div>
  );
}

/** 테이블 아래 보조 정보 — 상황 설명·상대 레인지·블라인드 (표 안에 넣으면 좌석을 가린다) */
function TableNotes({ situation }: { situation: DrillSituation }) {
  const ranges = situation.villains.filter(villain => villain.range);
  const lines: ReactNode[] = [];
  if (situation.note) lines.push(<span key="note">{situation.note}</span>);
  for (const villain of ranges) {
    const name = getCharacterById(villain.characterId)?.name ?? villain.characterId;
    lines.push(<span key={`range-${villain.seatIndex}`}><span className="font-bold text-ink">{name}</span> 가정 레인지: {villain.range}</span>);
  }
  return (
    <div className="mt-1 space-y-0.5 text-center text-[11px] leading-snug text-ink-dim">
      {lines.map((line, index) => <p key={index}>{line}</p>)}
      <p className="text-[10px] text-ink-dim/70">블라인드 {formatChips(Math.round(situation.bigBlind / 2))}/{formatChips(situation.bigBlind)}</p>
    </div>
  );
}

function tableAriaLabel(model: DrillTableModel): string {
  const parts: string[] = [`${STREET_LABEL[model.street]} 테이블`];
  const hero = model.seats[0];
  if (hero.holeCards.length > 0) parts.push(`내 카드 ${hero.holeCards.map(formatCard).join(' ')}`);
  if (hero.position) parts.push(`내 포지션 ${hero.position}`);
  if (model.board.length > 0) parts.push(`보드 ${model.board.map(formatCard).join(' ')}`);
  parts.push(`팟 ${formatChips(model.pot)}`);
  if (model.toCall > 0) parts.push(`콜 ${formatChips(model.toCall)}`);
  for (const seat of model.seats) {
    if (seat.occupant !== 'villain') continue;
    const cards = seat.holeCards.length > 0 ? ` ${seat.holeCards.map(formatCard).join(' ')}` : '';
    parts.push(`${seat.name}${seat.position ? ` ${seat.position}` : ''}${cards}`);
  }
  return parts.join(', ');
}
