'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnimatePresence, MotionConfig, motion, useReducedMotion } from 'framer-motion';
import ChipSVG, { decomposeChips } from '@/components/table/ChipSVG';
import PokerTableView, { type SeatDecor } from '@/components/table/PokerTableView';
import { BET_POSITIONS, POT_POS, SEAT_DEPTH, TABLE_ASPECT, type TablePos } from '@/components/table/table-layout';
import type { SeatAction } from '@/lib/hooks/use-seat-actions';
import { getCharacterById } from '@/lib/characters';
import { formatCard } from '@/lib/poker/card-notation';
import type { Card, PublicPlayer } from '@/lib/poker/types';
import { useProfileStore } from '@/lib/store/profile-store';
import { useProgressionStore } from '@/lib/store/progression-store';
import { buildDrillTableModel, planDrillDemo, type DemoAction, type DrillDemo, type DrillTableModel, type DrillTableSeat } from '@/lib/story/drill-table-model';
import type { DrillCategory, DrillResult, DrillSituation } from '@/lib/story/drills/types';

/**
 * 수련 문제 테이블 — 실전 캐시 테이블과 **같은 뷰**(`PokerTableView`: 좌석·카드·팟·칩·D/SB/BB)에 문제 상황을 앉힌다.
 * 게임 store에 의존하지 않는다 (상황은 props, 좌석 배치는 `drill-table-model.ts` 순수 함수 → 합성 공개 스냅샷).
 * 펠트는 실전 스토리 방과 같은 수련 테마(`storyTheme`), 비율은 실전 테이블 비율(`TABLE_ASPECT`) 그대로다.
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
  /** 판단 재생이 끝났을 때(모션 감소면 채점 직후) — 부모가 해설을 화면 안으로 스크롤하는 시점 */
  onReplayDone?: () => void;
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

/**
 * 실전 기준 크기 — 430×900 모바일에서 상단 바·액션 독을 뺀 실전 테이블 좌표 컨테이너(≈430×662).
 * 수련 테이블은 이 크기로 **실전 그대로** 그린 뒤 CSS scale 하나로 줄인다(컴포넌트 크기와 테이블 비율이 실전과 같다).
 */
const REF_W = 430;
const REF_H = Math.round(REF_W / TABLE_ASPECT);
/** ResizeObserver 측정 전 첫 렌더 배율 (430×900에서 56dvh 기준 근사) */
const INITIAL_SCALE = 0.76;

/** 컨테이너 폭에 맞춘 축소 배율 — setState는 ResizeObserver 콜백에서만 */
function useFitScale() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [scale, setScale] = useState(INITIAL_SCALE);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(entries => {
      const width = entries[0]?.contentRect.width ?? 0;
      if (width > 0) setScale(Math.round((width / REF_W) * 1000) / 1000);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, scale };
}

const STREET_LABEL: Record<DrillSituation['street'], string> = {
  preflop: '프리플랍',
  flop: '플랍',
  turn: '턴',
  river: '리버',
  showdown: '쇼다운',
};

/** 표시용 뒷면 카드 — 공개 스냅샷의 마스킹 placeholder와 같은 역할 (앞면은 그리지 않는다) */
const CARD_BACK: Card = { rank: '2', suit: 'clubs' };
const HERO_ID = 'drill-hero';

// ---------------------------------------------------------------------------

function DrillTableStage({ situation, category, templateId, result = null, intro = true, onReplayDone }: DrillTableProps) {
  const reduce = useReducedMotion() ?? false;
  const heroAvatarId = useProfileStore(state => state.profile?.avatarId ?? null);
  const heroAlias = useProfileStore(state => state.profile?.alias ?? null);
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

  // 판단 재생이 끝나면 부모에게 알린다 (해설 스크롤 시점) — 콜백은 최신 것을 ref로 읽는다
  const replayDoneRef = useRef(onReplayDone);
  useEffect(() => {
    replayDoneRef.current = onReplayDone;
  }, [onReplayDone]);
  useEffect(() => {
    if (demoDone) replayDoneRef.current?.();
  }, [demoDone, demoRun]);
  const { ref: fitRef, scale: fitScale } = useFitScale();

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
  const players = toPlayers(model, { cardsDealt, mucked: view.mucked, act: view.act, heroName: heroAlias || '플레이어' });
  const seatActions: Record<number, SeatAction> = view.act ? { 0: view.act.seatAction } : {};
  const activeSeatIndex = view.spotlight ?? (heroTurn ? 0 : -1);

  const seatDecor = (slot: number): SeatDecor | null => {
    const seat = model.seats[slot];
    if (!seat || seat.occupant === 'empty') return null;
    const label = view.labels.get(slot) ?? null;
    const badge = view.badges.get(slot) ?? null;
    return {
      avatarOverlay: (
        <SeatMarks
          label={label?.text ?? seat.position}
          labelState={label?.emphasis ? 'emphasis' : label ? 'revealed' : 'given'}
          seatNumber={model.showSeatNumbers && seat.seatIndex !== null ? seat.seatIndex + 1 : null}
          badge={badge}
        />
      ),
      footer: seat.rangeTag ? <span className="mt-0.5 rounded bg-gilded/20 px-1 text-[9px] font-bold text-gilded">{seat.rangeTag}</span> : undefined,
      highlightCards: view.highlightCards,
    };
  };

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
      {/* 실전 테이블을 실전 크기(REF_W×REF_H)로 그리고 통째로 축소 — 화면 위쪽 절반 남짓에 들어가도록 높이를 묶고 폭은 비율에서 얻는다 */}
      <div
        ref={fitRef}
        className="relative mx-auto select-none"
        style={{ width: `min(100%, calc(56dvh * ${TABLE_ASPECT}))`, aspectRatio: String(TABLE_ASPECT) }}
        onClick={handleTap}
        role="group"
        aria-label={tableAriaLabel(model)}
      >
        <div className="absolute left-0 top-0" style={{ width: REF_W, height: REF_H, transform: `scale(${fitScale})`, transformOrigin: '0 0' }}>
        <PokerTableView
          players={players}
          myPlayerId={HERO_ID}
          communityCards={model.board.slice(0, visibleBoard)}
          winningCards={view.highlightCards ?? undefined}
          pots={potShown && model.pot > 0 ? [{ amount: model.pot, eligiblePlayerIds: [] }] : []}
          dealerSeatIndex={model.dealerSlot ?? -1}
          sbSeatIndex={model.sbSlot ?? -1}
          bbSeatIndex={model.bbSlot ?? -1}
          activeSeatIndex={activeSeatIndex}
          seatActions={seatActions}
          compact
          storyTheme
          feltId={feltId}
          interactive={false}
          dealerPulse={view.dealerPulse}
          potPosition={view.potTarget}
          potExtra={potShown && model.pot > 0 ? (
            <p className="mt-0.5 whitespace-nowrap text-center text-[12px] font-bold text-ink-dim">
              {STREET_LABEL[model.street]}{model.toCall > 0 ? ' · 상대 벳 포함' : ''}
            </p>
          ) : null}
          seatDecor={seatDecor}
          renderEmptySeat={(slot, displaySlot, pos) => (
            <EmptySeat
              pos={pos}
              depth={SEAT_DEPTH[displaySlot]}
              seatNumber={model.showSeatNumbers && model.seats[slot].seatIndex !== null ? model.seats[slot].seatIndex! + 1 : null}
              label={view.labels.get(slot) ?? null}
            />
          )}
        >
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

        </PokerTableView>
        </div>

          {/* 내 앞 — 콜 금액 / 정답 말풍선. 축소 상자 밖(같은 비율 → 같은 % 좌표)에 그려 글자가 작아지지 않는다 */}
          <AnimatePresence>
            {heroTurn && model.toCall > 0 && (
              <motion.div
                key="to-call"
                className="pointer-events-none absolute z-20"
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
            {view.answer && (
              <motion.div
                key="answer"
                className="pointer-events-none absolute z-30 max-w-[78%]"
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
// 문제 상황 → 합성 공개 스냅샷 (실전 좌석 컴포넌트가 그대로 읽는 모양). 좌석 번호 = 표시 슬롯, 히어로 = 0

function toPlayers(model: DrillTableModel, options: {
  cardsDealt: boolean;
  mucked: boolean;
  act: DemoView['act'];
  heroName: string;
}): PublicPlayer[] {
  const players: PublicPlayer[] = [];
  for (const seat of model.seats) {
    if (seat.occupant === 'empty') continue;
    players.push(toPlayer(seat, options));
  }
  return players;
}

function toPlayer(seat: DrillTableSeat, options: { cardsDealt: boolean; mucked: boolean; act: DemoView['act']; heroName: string }): PublicPlayer {
  const hero = seat.occupant === 'hero';
  const faceUp = seat.holeCards.length > 0;
  const holeCards = !options.cardsDealt ? []
    : faceUp ? seat.holeCards
      : seat.cardBacks ? [CARD_BACK, CARD_BACK] : [];
  return {
    id: hero ? HERO_ID : `drill-seat-${seat.slot}`,
    name: hero ? options.heroName : seat.name,
    type: hero ? 'human' : 'bot',
    avatar: seat.characterId ?? 'player',
    chips: seat.stackChips ?? 0,
    seatIndex: seat.slot,
    holeCards,
    currentBet: hero && options.act?.chips ? options.act.chips : 0,
    totalContributed: 0,
    status: hero && options.mucked ? 'folded' : 'active',
    hasActed: false,
    revealed: !hero && faceUp,
  };
}

// ---------------------------------------------------------------------------
// 판단 재생 → 화면 요소

type BadgeTone = 'gilded' | 'cyber' | 'blossom' | 'ink';

interface DemoView {
  caption: string | null;
  labels: Map<number, { text: string; emphasis: boolean }>;
  badges: Map<number, { text: string; tone: BadgeTone }>;
  spotlight: number | null;
  highlightCards: Card[] | null;
  potTarget: TablePos;
  dealerPulse: boolean;
  mucked: boolean;
  act: { chips: number | null; seatAction: SeatAction } | null;
  answer: string | null;
}

function seatActionOf(action: DemoAction, chips: number | null): SeatAction {
  if (action === 'bet') return { type: 'raise', amount: chips ?? 0, isBet: true };
  return { type: action, amount: action === 'all-in' ? 0 : chips ?? 0 };
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
        const cards: Card[] = [];
        for (const entry of entries) if (winnerSlots.includes(entry.slot)) cards.push(...entry.cards);
        view.highlightCards = cards;
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
      // 실전 좌석과 같은 문법 — 액션 배지(플레이트) + 베팅 칩 스택(내 앞) + 폴드는 카드가 어두워진다
      view.spotlight = 0;
      if (demo.action === 'fold') view.mucked = true;
      if (step >= 1) view.act = { chips: demo.action === 'fold' || demo.action === 'check' ? null : demo.chips, seatAction: seatActionOf(demo.action, demo.chips) };
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
// 좌석 덧그림 — 실전 좌석(PlayerSeat) 아바타 위에 얹는 포지션·좌석 번호·재생 배지

const BADGE_TONE: Record<BadgeTone, string> = {
  gilded: 'border-gilded bg-gilded text-abyss',
  cyber: 'border-cyber/70 bg-black/85 text-cyber',
  blossom: 'border-blossom/70 bg-black/85 text-blossom',
  ink: 'border-white/20 bg-black/85 text-ink',
};

function SeatMarks({ label, labelState, seatNumber, badge }: {
  label: string | null;
  labelState: 'given' | 'revealed' | 'emphasis';
  seatNumber: number | null;
  badge: { text: string; tone: BadgeTone } | null;
}) {
  return (
    <>
      {/* 재생 배지(족보·액션 순서) — 아바타 위 한 줄 */}
      <AnimatePresence>
        {badge && (
          <motion.span
            key={badge.text}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className={`pointer-events-none absolute bottom-full left-1/2 z-40 mb-1 whitespace-nowrap rounded-full border px-2 py-px text-[13px] font-black shadow ${BADGE_TONE[badge.tone]}`}
            style={{ x: '-50%' }}
          >
            {badge.text}
          </motion.span>
        )}
      </AnimatePresence>
      {/* 포지션 배지 — 아바타 좌상단 (우측엔 홀카드가 붙는다) */}
      {label && (
        <span
          className={`pointer-events-none absolute -left-2 -top-1.5 z-40 rounded-full border px-1.5 text-[13px] font-black leading-tight ${
            labelState === 'emphasis' ? 'scale-125 border-gilded bg-gilded text-abyss'
              : label === '?' ? 'border-mystic/60 bg-black/80 text-mystic'
                : labelState === 'revealed' ? 'border-gilded/70 bg-black/80 text-gilded' : 'border-cyber/50 bg-black/80 text-cyber'
          }`}
        >
          {label}
        </span>
      )}
      {seatNumber !== null && (
        <span className="pointer-events-none absolute -left-4 top-1/2 z-40 -translate-y-1/2 rounded-full bg-black/80 px-1.5 text-[12px] font-bold leading-tight text-ink-dim">{seatNumber}번</span>
      )}
    </>
  );
}

function EmptySeat({ pos, depth, seatNumber, label }: {
  pos: TablePos;
  depth: number;
  seatNumber: number | null;
  label: { text: string; emphasis: boolean } | null;
}) {
  return (
    <div
      className="pointer-events-none absolute z-0"
      style={{ left: pos.x, top: pos.y, transform: `translate(-50%, -50%) scale(${depth})` }}
      aria-hidden
    >
      <div className="relative flex h-16 w-16 items-center justify-center rounded-full border-2 border-dashed border-white/15 bg-black/20">
        {seatNumber !== null && <span className="text-[13px] font-bold text-ink-dim/60">{seatNumber}번</span>}
        {label && (
          <motion.span
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            className="absolute -right-2 -top-1.5 rounded-full border border-gilded/60 bg-black/80 px-1.5 text-[13px] font-black text-gilded"
          >
            {label.text}
          </motion.span>
        )}
      </div>
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
    <div className="mt-2 space-y-0.5 text-center text-[11px] leading-snug text-ink-dim">
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
