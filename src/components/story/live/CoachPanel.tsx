'use client';

import { useMemo } from 'react';
import {
  computePotOdds,
  countOutsToRank,
  exactDrawPct,
  handRankOrder,
} from '@/lib/poker/learning';
import { evaluateHand } from '@/lib/poker/evaluator';
import type { Card, HandRank } from '@/lib/poker/types';
import type { HintLevel } from '@/lib/story/types';

/** handRankOrder의 역순 사다리 — "지금보다 한 단계 위 랭크"를 아우츠 목표로 삼는다 */
const RANK_LADDER: readonly HandRank[] = [
  'high-card', 'one-pair', 'two-pair', 'three-of-a-kind', 'straight',
  'flush', 'full-house', 'four-of-a-kind', 'straight-flush', 'royal-flush',
];

interface CoachPanelProps {
  /** 스텝의 힌트 레벨 — 1: 팟오즈 / 2: +아우츠 / 3: +한 줄 조언 */
  hints: HintLevel;
  holeCards: Card[];
  communityCards: Card[];
  /** 콜에 필요한 금액 (0이면 체크 가능 상황 — 팟오즈 없음) */
  toCall: number;
  /** 지금 중앙에 있는 총액 — **상대 벳 포함**(엔진 pots는 매 액션마다 재유도되어 이미 포함) */
  potTotal: number;
}

interface CoachLines {
  odds: string | null;
  draw: string | null;
  advice: string | null;
}

/**
 * 코치 오버레이(기획 A7 ②)의 인룸 한 줄 — ActionBar 독의 핸드 강도 뱃지 아래.
 * 계산은 전부 `learning.ts` 공용 코어를 쓴다(드릴 채점과 같은 값이어야 한다).
 * 팟오즈의 '팟'은 상대 벳을 포함한 중앙 총액이다 — "팟+벳" 표기로 바꾸면 정답이 20%/25%로 갈린다.
 */
function computeCoachLines({ hints, holeCards, communityCards, toCall, potTotal }: CoachPanelProps): CoachLines {
  if (hints < 1 || holeCards.length !== 2) return { odds: null, draw: null, advice: null };

  let required: number | null = null;
  let odds: string | null = null;
  if (toCall > 0 && potTotal > 0) {
    const potOdds = computePotOdds(toCall, potTotal);
    required = potOdds.pct;
    odds = `필요 승률 ${potOdds.pct.toFixed(0)}% (콜 ${toCall.toLocaleString()} · 팟 ${potTotal.toLocaleString()})`;
  }

  let draw: string | null = null;
  let equity: number | null = null;
  const board = communityCards;
  if (hints >= 2 && (board.length === 3 || board.length === 4)) {
    const current = evaluateHand(holeCards, board).rank;
    const nextRank = RANK_LADDER[handRankOrder(current) + 1];
    if (nextRank) {
      const result = countOutsToRank(holeCards, board, nextRank);
      const cardsToCome = board.length === 3 ? 2 : 1;
      if (result.outs.length > 0) {
        equity = exactDrawPct(result.outs.length, result.unseen, cardsToCome);
        draw = `개선 아우츠 ${result.outs.length}장 · 약 ${equity.toFixed(0)}%`;
      } else {
        draw = '개선 아우츠 없음 — 지금 패로 승부';
      }
    }
  }

  let advice: string | null = null;
  if (hints >= 3) {
    if (required !== null && equity !== null) {
      advice = equity >= required ? '가격이 맞아요 — 콜해도 좋은 스팟' : '가격이 안 맞아요 — 폴드 쪽';
    } else if (required !== null) {
      advice = '가격이 맞으면 콜, 아니면 폴드';
    } else {
      advice = '벳이 없을 땐 공짜 카드 — 서두르지 않아도 돼요';
    }
  }

  return { odds, draw, advice };
}

/** 코치 한 줄 — 힌트 레벨에 없는 항목은 그리지 않는다 (독 높이는 그대로) */
export default function CoachPanel(props: CoachPanelProps) {
  const { hints, holeCards, communityCards, toCall, potTotal } = props;
  const lines = useMemo(() => {
    // learning.ts는 입력이 어긋나면 throw한다(중복 카드 등) — 코치 한 줄 때문에 독이 죽지 않게 방어
    try {
      return computeCoachLines({ hints, holeCards, communityCards, toCall, potTotal });
    } catch {
      return { odds: null, draw: null, advice: null } satisfies CoachLines;
    }
  }, [hints, holeCards, communityCards, toCall, potTotal]);
  if (!lines.odds && !lines.draw && !lines.advice) return null;
  return (
    <div
      className="flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg border border-mystic/30 bg-mystic/10 px-2 py-0.5 text-[10px] leading-tight text-ink-dim"
      role="status"
      aria-label="수련 코치"
    >
      <span className="font-bold text-mystic">코치</span>
      {lines.odds && <span className="tabular">{lines.odds}</span>}
      {lines.draw && <span className="tabular text-cyber">{lines.draw}</span>}
      {lines.advice && <span className="text-ink">{lines.advice}</span>}
    </div>
  );
}
