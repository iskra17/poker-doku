'use client';

import { useEffect, useRef, useState } from 'react';
import { onGameEvent } from '@/lib/events/game-events';
import { useIsMobile } from '@/lib/hooks/use-mobile';
import { HAND_RANK_KO } from './HandStrengthBadge';

/**
 * 액션 로그 — 게임 이벤트를 구독해 최근 히스토리를 표시 (데스크톱 좌상단, 접이식).
 */

interface LogEntry {
  id: number;
  kind: 'divider' | 'action' | 'win';
  text: string;
}

let nextLogId = 1;
const MAX_ENTRIES = 50;

const ACTION_KO: Record<string, string> = {
  fold: '폴드',
  check: '체크',
  call: '콜',
  raise: '레이즈',
  'all-in': '올인',
};

const STREET_KO: Record<string, string> = {
  flop: '플랍',
  turn: '턴',
  river: '리버',
};

export default function ActionLog() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  // null = 기기 기본값 사용 (모바일은 접힘, 데스크톱은 펼침). 사용자가 토글하면 그 의도를 고정.
  const [userCollapsed, setUserCollapsed] = useState<boolean | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();
  const collapsed = userCollapsed ?? isMobile;

  useEffect(() => {
    const push = (items: Omit<LogEntry, 'id'>[]) => {
      setEntries(prev => [...prev, ...items.map(e => ({ ...e, id: nextLogId++ }))].slice(-MAX_ENTRIES));
    };

    return onGameEvent(event => {
      switch (event.type) {
        case 'hand-start':
          push([{ kind: 'divider', text: `─ 핸드 #${event.handNumber} ─` }]);
          break;
        case 'street-dealt': {
          const label = STREET_KO[event.street];
          if (label) push([{ kind: 'divider', text: `· ${label} ·` }]);
          break;
        }
        case 'action': {
          const action = event.actionType === 'raise' && event.isBet
            ? '벳'
            : ACTION_KO[event.actionType] ?? event.actionType;
          const amount = event.amount > 0 && event.actionType !== 'fold' && event.actionType !== 'check'
            ? ` ${event.amount.toLocaleString()}`
            : '';
          push([{ kind: 'action', text: `${event.playerName} ${action}${amount}` }]);
          break;
        }
        case 'winners': {
          push(event.winners.map(w => {
            const name = event.players.find(p => p.id === w.playerId)?.name ?? '?';
            const hand = w.hand ? ` (${HAND_RANK_KO[w.hand.rank]})` : '';
            return { kind: 'win' as const, text: `🏆 ${name} +${w.amount.toLocaleString()}${hand}` };
          }));
          break;
        }
      }
    });
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [entries]);

  return (
    <div className="absolute left-2 top-2 z-20 w-40 md:w-52">
      <button
        onClick={() => setUserCollapsed(!collapsed)}
        className="w-full flex items-center justify-between bg-panel/80 backdrop-blur-sm border border-white/10 rounded-t-lg px-2.5 py-1 text-[11px] font-bold text-ink-dim hover:text-ink transition-colors"
      >
        <span>액션 로그</span>
        <span>{collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed && (
        <div
          ref={scrollRef}
          className="bg-panel/60 backdrop-blur-sm border border-t-0 border-white/10 rounded-b-lg px-2.5 py-1.5 max-h-40 overflow-y-auto scrollbar-thin"
        >
          {entries.length === 0 && (
            <p className="text-ink-dim/60 text-[10px]">아직 기록이 없어요</p>
          )}
          {entries.map(e => (
            <p
              key={e.id}
              className={`text-[10px] leading-relaxed ${
                e.kind === 'divider' ? 'text-mystic/70 text-center' :
                e.kind === 'win' ? 'text-gilded font-bold' : 'text-ink-dim'
              }`}
            >
              {e.text}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
