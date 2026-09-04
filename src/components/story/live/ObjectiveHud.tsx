'use client';

import { motion } from 'framer-motion';
import { useState } from 'react';
import { formatObjectiveDetailProgress, formatObjectiveProgress, type ObjectiveHudLine } from '@/lib/story/story-live-rules';
import Modal from '@/components/ui/Modal';

interface ObjectiveHudProps {
  tag: '연습' | '대결';
  handsPlayed: number;
  maxHands: number;
  /** 미션형이면 최소 핸드 수(조기 종료 가능), 아니면 null */
  minHands: number | null;
  /** 펼쳤을 때 목표 위에 놓는 진행 안내 (liveFinishHint) */
  finishHint: string | null;
  lines: ObjectiveHudLine[];
  /** 접힌 상태에서 펼쳤는가 (모바일 기본 접힘, 넓은 화면은 펼침) */
  expanded: boolean;
  onToggle: () => void;
}

const TAG_STYLE: Record<'연습' | '대결', string> = {
  연습: 'border-cyber/60 bg-cyber/15 text-cyber',
  대결: 'border-blossom/60 bg-blossom/15 text-blossom',
};

function ObjectiveRow({ line, onOpen }: { line: ObjectiveHudLine; onOpen: () => void }) {
  const achieved = line.achieved === true;
  const hasTarget = line.target !== null && line.target > 0;
  const ratio = hasTarget ? Math.min(1, line.progress / (line.target as number)) : achieved ? 1 : 0;
  return (
    <li>
      <button type="button" onClick={onOpen} aria-label={`${line.label} — 미션 자세히 보기`}
        className="flex min-h-8 w-full items-center gap-1.5 rounded text-left hover:bg-mystic/10 focus-visible:outline-2 focus-visible:outline-cyber">
        <span
          className={`w-3 shrink-0 text-center text-[10px] ${achieved ? 'text-cyber' : 'text-ink-dim/60'}`}
          aria-hidden
        >
          {achieved ? '✓' : line.primary ? '•' : '·'}
        </span>
        <span className={`min-w-0 flex-1 truncate text-[10px] ${achieved ? 'text-cyber' : 'text-ink'}`}>
          {line.label}
        </span>
        {hasTarget && (
          <span className="shrink-0 tabular text-[10px] text-ink-dim">
            {formatObjectiveProgress(line)}
          </span>
        )}
        <span className="h-1 w-8 shrink-0 overflow-hidden rounded-full bg-white/10" aria-hidden>
          <span
            className={`block h-full rounded-full ${achieved ? 'bg-cyber' : 'bg-mystic'}`}
            style={{ width: `${Math.round(ratio * 100)}%` }}
          />
        </span>
      </button>
    </li>
  );
}

/**
 * 라이브 스텝 HUD — '연습'/'대결' 배지 + 진행 핸드 수 + 행동 목표(primary 먼저).
 * 좁은 화면에선 배지+카운터만 남기고 탭으로 펼친다 (좌석/보드를 가리지 않게).
 */
export default function ObjectiveHud({ tag, handsPlayed, maxHands, minHands, finishHint, lines, expanded, onToggle }: ObjectiveHudProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  // 미션형은 "N/최대" 카운터가 숙제처럼 읽히므로 진행 핸드 수만 보여 준다 — 상한은 안내 문구로
  const counter = minHands !== null || maxHands <= 0
    ? `${handsPlayed}핸드`
    : `${Math.min(handsPlayed, maxHands)}/${maxHands}핸드`;
  const canExpand = lines.length > 0;
  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        className="pointer-events-auto w-[168px] rounded-xl border border-mystic/30 bg-panel/92 p-1.5 shadow-lg backdrop-blur-sm"
      >
        <button
          type="button"
          onClick={onToggle}
          disabled={!canExpand}
          aria-expanded={canExpand ? expanded : undefined}
          className="flex w-full items-center gap-1.5 disabled:cursor-default"
        >
          <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${TAG_STYLE[tag]}`}>
            {tag}
          </span>
          <span className="tabular text-[10px] font-bold text-ink">{counter}</span>
          {canExpand && (
            <span className="ml-auto text-[9px] text-ink-dim" aria-hidden>{expanded ? '▲' : '▼'}</span>
          )}
        </button>
        {canExpand && expanded && (
          <div className="mt-1.5 border-t border-mystic/20 pt-1.5">
            {finishHint && <p className="mb-1 text-[9px] text-ink-dim">{finishHint}</p>}
            <ul className="space-y-1">
              {lines.map(line => <ObjectiveRow key={line.id} line={line} onOpen={() => setDetailsOpen(true)} />)}
            </ul>
          </div>
        )}
        {canExpand && (
          <button type="button" onClick={() => setDetailsOpen(true)} aria-haspopup="dialog"
            className="mt-1 min-h-10 w-full rounded-lg border border-mystic/30 text-xs font-bold text-cyber hover:bg-cyber/10 focus-visible:outline-2 focus-visible:outline-cyber">
            미션 전체보기
          </button>
        )}
      </motion.div>
      <Modal isOpen={detailsOpen} onClose={() => setDetailsOpen(false)} title="이번 수련 미션">
        <p className="text-sm text-ink-dim">{tag} · {counter}</p>
        {finishHint && <p className="mt-2 text-sm leading-relaxed text-ink">{finishHint}</p>}
        <ul className="mt-4 space-y-3">
          {lines.map(line => (
            <li key={line.id} className="rounded-xl border border-mystic/25 bg-mystic/5 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className={line.primary ? 'font-bold text-blossom' : 'text-mystic'}>{line.primary ? '통과 조건' : '보너스'}</span>
                <span className={line.achieved ? 'text-cyber' : 'text-ink-dim'}>
                  {line.achieved === true ? '✓ 달성' : line.achieved === null ? '아직 판정할 기회 없음' : '미달성'}
                </span>
              </div>
              <p className="mt-2 whitespace-normal break-words text-sm leading-relaxed text-ink">{line.label}</p>
              {formatObjectiveDetailProgress(line) && <p className="mt-2 text-sm tabular text-gilded">{formatObjectiveDetailProgress(line)}</p>}
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs leading-relaxed text-ink-dim">미션을 보는 동안에도 턴 시간은 계속 흘러요.</p>
        <button type="button" onClick={() => setDetailsOpen(false)}
          className="mt-3 min-h-11 w-full rounded-lg bg-cyber/15 text-sm font-bold text-cyber hover:bg-cyber/25">
          테이블로 돌아가기
        </button>
      </Modal>
    </>
  );
}
