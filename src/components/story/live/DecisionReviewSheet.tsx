'use client';

import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { reviewMarkGlyph } from '@/lib/story/story-live-rules';
import type { ActionType, Street } from '@/lib/poker/types';
import type { DecisionMark, DecisionReview } from '@/lib/story/views';

// 표시용 한국어 라벨 — ActionLog와 같은 관행 표기 (공용 상수 모듈은 아직 없다)
const STREET_KO: Record<Street, string> = {
  preflop: '프리플랍',
  flop: '플랍',
  turn: '턴',
  river: '리버',
  showdown: '쇼다운',
};

const ACTION_KO: Record<ActionType, string> = {
  fold: '폴드',
  check: '체크',
  call: '콜',
  raise: '레이즈',
  'all-in': '올인',
};

/** 승자 컷인·칩 이동이 지나간 뒤 슬라이드인 */
const SHOW_DELAY_MS = 1_500;
const VISIBLE_MS = 6_000;
const MAX_CHIPS = 4;

const MARK_STYLE: Record<DecisionMark, string> = {
  good: 'border-cyber/50 bg-cyber/10',
  hmm: 'border-gilded/50 bg-gilded/10',
  warn: 'border-blossom/50 bg-blossom/10',
};

interface DecisionReviewSheetProps {
  review: DecisionReview | null;
}

/**
 * 핸드 후 결정 리뷰 — 액션 독 바로 위 하단 시트. 핸드마다 최대 4개 판정 칩(👍/🤔/⚠).
 * 결과가 아니라 결정을 본다(배드빗도 👍) — 문구는 서버 review.ts가 만든 그대로 쓴다.
 * 독 높이(ACTION_DOCK_HEIGHT)는 건드리지 않고 중앙 컨테이너 바닥에 absolute로 얹는다.
 */
export default function DecisionReviewSheet({ review }: DecisionReviewSheetProps) {
  const handNumber = review?.handNumber ?? null;
  const [visible, setVisible] = useState(false);
  // 새 리뷰가 오면 다시 대기 상태로 (effect 본문 setState 금지 — 렌더 중 보정 패턴)
  const [trackedHand, setTrackedHand] = useState<number | null>(handNumber);
  if (trackedHand !== handNumber) {
    setTrackedHand(handNumber);
    setVisible(false);
  }

  useEffect(() => {
    if (handNumber === null) return;
    const show = setTimeout(() => setVisible(true), SHOW_DELAY_MS);
    const hide = setTimeout(() => setVisible(false), SHOW_DELAY_MS + VISIBLE_MS);
    return () => {
      clearTimeout(show);
      clearTimeout(hide);
    };
  }, [handNumber]);

  const verdicts = (review?.verdicts ?? []).slice(0, MAX_CHIPS);

  return (
    <AnimatePresence>
      {visible && review && verdicts.length > 0 && (
        <motion.div
          key={review.handNumber}
          onClick={() => setVisible(false)}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.24 }}
          role="status"
          aria-live="polite"
          className="pointer-events-auto absolute bottom-2 left-2 right-2 z-30 mr-14 rounded-2xl border border-mystic/30 bg-panel/95 p-2.5 text-left shadow-2xl backdrop-blur-sm md:right-auto md:mr-0 md:w-[340px]"
        >
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold tracking-widest text-mystic">결정 리뷰</span>
            <span className="tabular text-[10px] text-ink-dim">#{review.handNumber}핸드</span>
            <span className="ml-auto rounded-full border border-white/15 px-1.5 py-0.5 text-[9px] text-ink-dim">
              결과 ≠ 결정
            </span>
            <button
              type="button"
              onClick={() => setVisible(false)}
              aria-label="결정 리뷰 닫기"
              className="shrink-0 rounded-md px-1 text-[11px] text-ink-dim transition-colors hover:text-ink"
            >
              ✕
            </button>
          </div>
          <ul className="mt-1.5 space-y-1">
            {verdicts.map((verdict, index) => (
              <li
                key={`${verdict.street}-${verdict.action}-${index}`}
                className={`flex items-start gap-1.5 rounded-xl border px-2 py-1 ${MARK_STYLE[verdict.mark]}`}
              >
                <span className="text-xs leading-5" aria-hidden>{reviewMarkGlyph(verdict.mark)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[10px] font-bold text-ink">
                    {STREET_KO[verdict.street]} · {ACTION_KO[verdict.action]}
                    {verdict.amount > 0 && <span className="tabular font-normal text-ink-dim"> {verdict.amount.toLocaleString()}</span>}
                  </span>
                  <span className="block text-[10px] leading-snug text-ink-dim">{verdict.reason}</span>
                </span>
              </li>
            ))}
          </ul>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
