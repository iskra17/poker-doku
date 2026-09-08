'use client';

import { motion } from 'framer-motion';
import { formatObjectiveDetailProgress, type ObjectiveHudLine } from '@/lib/story/story-live-rules';
import type { StoryLiveView } from '@/lib/story/views';

interface ObjectiveHudProps {
  tag: '연습' | '대결';
  handsPlayed: number;
  maxHands: number;
  /** 졸업 대결(실제 Sit & Go)이면 서버가 준 진행 상태 — 목표 대신 이 블록이 진행을 알린다 */
  tournament?: StoryLiveView['tournament'];
  /** 미션형이면 최소 핸드 수(조기 종료 가능), 아니면 null */
  minHands: number | null;
  /** 펼쳤을 때 목표 위에 놓는 진행 안내 (liveFinishHint) */
  finishHint: string | null;
  lines: ObjectiveHudLine[];
  /** 미션 내용을 표시하는가 (기본은 표시, 사용자가 스텝 안에서 접을 수 있다) */
  expanded: boolean;
  onToggle: () => void;
}

const TAG_STYLE: Record<'연습' | '대결', string> = {
  연습: 'border-cyber/60 bg-cyber/15 text-cyber',
  대결: 'border-blossom/60 bg-blossom/15 text-blossom',
};

function ObjectiveRow({ line }: { line: ObjectiveHudLine }) {
  const achieved = line.achieved === true;
  // 체크리스트 항목은 부모(any-k-of) 바로 아래에 들여쓴다 — 각각이 통과 조건으로 읽히면 안 된다
  const child = line.group === 'checklist';
  const typeLabel = child ? '체크리스트' : line.primary ? '통과 조건' : '보너스';
  const detail = formatObjectiveDetailProgress(line);
  return (
    <li className={`rounded-lg border border-mystic/20 bg-mystic/5 p-1.5 md:p-2 ${child ? 'ml-3' : ''}`}>
      <div className="flex flex-wrap items-center justify-between gap-1 text-[9px]">
        <span className={child ? 'text-mystic' : line.primary ? 'font-bold text-blossom' : 'text-mystic'}>{typeLabel}{achieved ? ' ✓' : ''}</span>
        <span className={detail ? 'tabular text-gilded' : achieved ? 'text-cyber' : 'text-ink-dim'}>
          {detail ?? (achieved ? '달성' : line.achieved === null ? '판정 대기' : '미달성')}
        </span>
      </div>
      <p className={`mt-1 whitespace-normal break-words text-[11px] leading-relaxed ${achieved ? 'text-cyber' : 'text-ink'}`}>{line.label}</p>
    </li>
  );
}

/**
 * 라이브 스텝 HUD — '연습'/'대결' 배지 + 진행 핸드 수 + 행동 목표(primary 먼저).
 * 미션은 기본으로 전부 보이고, 헤더에서 접거나 펼친다.
 */
export default function ObjectiveHud({ tag, handsPlayed, maxHands, minHands, finishHint, lines, expanded, onToggle, tournament }: ObjectiveHudProps) {
  // 미션형은 "N/최대" 카운터가 숙제처럼 읽히므로 진행 핸드 수만 보여 준다 — 상한은 안내 문구로
  const counter = minHands !== null || maxHands <= 0
    ? `${handsPlayed}핸드`
    : `${Math.min(handsPlayed, maxHands)}/${maxHands}핸드`;
  // 졸업 대결은 행동 목표가 없으므로 토너먼트 블록만 있어도 펼칠 수 있어야 한다
  const canExpand = lines.length > 0 || !!tournament;
  const tournamentBlock = tournament ? (
    <div className="mb-1 space-y-0.5 text-[9px] text-ink-dim" aria-label="졸업 대결 진행">
      <p>
        남은 인원 <span className="tabular font-bold text-ink">{tournament.alive}</span>/{tournament.entrants}
        {tournament.heroPlace !== null && <span className="ml-1 text-gilded">· 내 순위 {tournament.heroPlace}위</span>}
      </p>
      <p>
        레벨 {tournament.level} · 블라인드 <span className="tabular">{tournament.smallBlind}/{tournament.bigBlind}</span>
      </p>
    </div>
  ) : null;
  return (
    <>
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        className="pointer-events-auto flex max-h-full w-[min(200px,calc(100vw-1rem))] max-w-[calc(100vw-1rem)] flex-col overflow-hidden rounded-xl border border-mystic/30 bg-panel/92 p-2 shadow-lg backdrop-blur-sm md:w-[280px] md:max-w-[280px]"
      >
        <button
          type="button"
          onClick={onToggle}
          disabled={!canExpand}
          aria-expanded={canExpand ? expanded : undefined}
          aria-label={canExpand ? (expanded ? '미션 접기' : '미션 펼치기') : undefined}
          className="flex min-h-9 w-full shrink-0 items-center gap-2 rounded-lg text-left disabled:cursor-default"
        >
          <span className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold ${TAG_STYLE[tag]}`}>
            {tag}
          </span>
          <span className="tabular text-[10px] font-bold text-ink">{counter}</span>
          {canExpand && (
            <span className="ml-auto flex items-center gap-1 text-[10px] font-bold text-ink-dim">
              <span>{expanded ? '미션 접기' : '미션 펼치기'}</span>
              <span aria-hidden>{expanded ? '▲' : '▼'}</span>
            </span>
          )}
        </button>
        {canExpand && expanded && (
          <div className="mt-1.5 min-h-0 flex-1 overflow-y-auto border-t border-mystic/20 pt-1.5 scrollbar-thin">
            {tournamentBlock}
            {finishHint && <p className="mb-1 text-[9px] text-ink-dim">{finishHint}</p>}
            <ul className="space-y-1.5">
              {lines.map(line => <ObjectiveRow key={line.id} line={line} />)}
            </ul>
          </div>
        )}
      </motion.div>
    </>
  );
}
