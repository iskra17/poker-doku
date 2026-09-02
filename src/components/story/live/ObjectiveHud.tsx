'use client';

import { motion } from 'framer-motion';
import type { ObjectiveHudLine } from '@/lib/story/story-live-rules';

interface ObjectiveHudProps {
  tag: '연습' | '대결';
  handsPlayed: number;
  maxHands: number;
  lines: ObjectiveHudLine[];
  /** 접힌 상태에서 펼쳤는가 (모바일 기본 접힘, 넓은 화면은 펼침) */
  expanded: boolean;
  onToggle: () => void;
}

const TAG_STYLE: Record<'연습' | '대결', string> = {
  연습: 'border-cyber/60 bg-cyber/15 text-cyber',
  대결: 'border-blossom/60 bg-blossom/15 text-blossom',
};

function ObjectiveRow({ line }: { line: ObjectiveHudLine }) {
  const achieved = line.achieved === true;
  const hasTarget = line.target !== null && line.target > 0;
  const ratio = hasTarget ? Math.min(1, line.progress / (line.target as number)) : achieved ? 1 : 0;
  return (
    <li className="flex items-center gap-1.5">
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
          {Math.min(line.progress, line.target as number)}/{line.target}
        </span>
      )}
      <span className="h-1 w-8 shrink-0 overflow-hidden rounded-full bg-white/10" aria-hidden>
        <span
          className={`block h-full rounded-full ${achieved ? 'bg-cyber' : 'bg-mystic'}`}
          style={{ width: `${Math.round(ratio * 100)}%` }}
        />
      </span>
    </li>
  );
}

/**
 * 라이브 스텝 HUD — '연습'/'대결' 배지 + 진행 핸드 수 + 행동 목표(primary 먼저).
 * 좁은 화면에선 배지+카운터만 남기고 탭으로 펼친다 (좌석/보드를 가리지 않게).
 */
export default function ObjectiveHud({ tag, handsPlayed, maxHands, lines, expanded, onToggle }: ObjectiveHudProps) {
  const counter = maxHands > 0 ? `${Math.min(handsPlayed, maxHands)}/${maxHands}핸드` : `${handsPlayed}핸드`;
  const canExpand = lines.length > 0;
  return (
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
        <ul className="mt-1.5 space-y-1 border-t border-mystic/20 pt-1.5">
          {lines.map(line => <ObjectiveRow key={line.id} line={line} />)}
        </ul>
      )}
    </motion.div>
  );
}
