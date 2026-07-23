'use client';

import { useCallback, useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import CardComponent from '../table/Card';
import { HAND_RANK_KO } from '@/lib/poker/evaluator';
import {
  computeStreetStartPots,
  formatReplayAction,
  type PlayStreet,
} from '@/lib/poker/hand-history-replay';
import { useSettingsStore } from '@/lib/store/settings-store';
import type {
  CompletedHandRecord,
  HandHistoryAction,
  HandHistoryDetail,
  HandHistorySummary,
} from '@/lib/poker/hand-history';
import type { Card } from '@/lib/poker/types';

/**
 * 핸드 히스토리 (GGPoker PokerCraft + WPL 리플레이 벤치마킹):
 * 목록(내 홀카드·보드·수익) → 상세는 블라인드~리버 5개 스트리트 컬럼에 액션을 세로로 쌓아
 * 스크롤 없이 한 화면에 담는다. 금액 칩/BB 토글·닉네임/포지션 토글은 GGPoker 방식.
 * 데이터는 /api/hands (프로필 쿠키 인증, 본인 핸드만).
 */
interface HandHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type HandDetail = HandHistoryDetail & { id: number };

const LOAD_ERROR = '핸드 히스토리를 불러오지 못했어요. 잠시 후 다시 시도해주세요.';
const STREET_ORDER: PlayStreet[] = ['preflop', 'flop', 'turn', 'river'];
const STREET_LABEL: Record<PlayStreet, string> = {
  preflop: '프리플랍',
  flop: '플랍',
  turn: '턴',
  river: '리버',
};
/** 포지션별 식별 색 — GG의 좌석 컬러처럼 컬럼을 훑을 때 같은 플레이어를 쉽게 따라가게 한다 */
const POSITION_COLOR: Record<string, string> = {
  'BTN': 'text-gilded',
  'BTN/SB': 'text-gilded',
  'SB': 'text-cyber',
  'BB': 'text-blossom',
  'UTG': 'text-mystic',
  'HJ': 'text-emerald-400',
  'CO': 'text-orange-300',
};

function formatChips(amount: number): string {
  return amount.toLocaleString('ko-KR');
}

/** BB 환산 — 소수 1자리, 정수면 소수점 생략 */
function formatBB(amount: number, bigBlind: number): string {
  const bb = amount / Math.max(1, bigBlind);
  const rounded = Math.round(bb * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)} BB`;
}

function formatProfit(amount: number, inBB: boolean, bigBlind: number): string {
  const sign = amount > 0 ? '+' : amount < 0 ? '-' : '';
  const abs = Math.abs(amount);
  return `${sign}${inBB ? formatBB(abs, bigBlind) : formatChips(abs)}`;
}

function profitColor(amount: number): string {
  if (amount > 0) return 'text-green-400';
  if (amount < 0) return 'text-red-400';
  return 'text-ink-dim';
}

function formatPlayedAt(playedAt: number): string {
  return new Date(playedAt).toLocaleString('ko-KR', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 해당 스트리트에 새로 깔린 보드 카드 */
function streetCards(street: PlayStreet, board: Card[]): Card[] {
  switch (street) {
    case 'preflop': return [];
    case 'flop': return board.slice(0, 3);
    case 'turn': return board.slice(3, 4);
    case 'river': return board.slice(4, 5);
  }
}

/** 승자/쇼다운 블록을 붙일 컬럼 — 핸드가 끝난 스트리트 */
function finalStreet(record: CompletedHandRecord): PlayStreet {
  if (record.showdown || record.board.length >= 5) return 'river';
  const last = record.actions[record.actions.length - 1];
  return last && last.street !== 'showdown' ? last.street : 'preflop';
}

function MiniCards({ cards, size = '2xs' }: { cards: Card[]; size?: '2xs' | 'xs' | 'sm' }) {
  return (
    <span className="inline-flex gap-0.5">
      {cards.map((card, index) => (
        <CardComponent key={`${card.rank}${card.suit}${index}`} card={card} size={size} />
      ))}
    </span>
  );
}

/** [칩|BB] 같은 2단 세그먼트 토글 */
function SegmentToggle({ options, active, onToggle }: {
  options: [string, string];
  active: 0 | 1;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex overflow-hidden rounded-lg border border-mystic/25 text-[10px] font-bold"
    >
      {options.map((label, index) => (
        <span
          key={label}
          className={`px-2 py-1 transition-colors ${
            active === index ? 'bg-purple-600 text-white' : 'bg-panel/60 text-ink-dim'
          }`}
        >
          {label}
        </span>
      ))}
    </button>
  );
}

function HandListRow({ item, inBB, onSelect }: {
  item: HandHistorySummary;
  inBB: boolean;
  onSelect: (id: number) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(item.id)}
      className="flex w-full items-center gap-2 rounded-xl border border-mystic/20 bg-panel/85 px-2.5 py-2 text-left transition-colors hover:border-blossom/40"
    >
      <MiniCards cards={item.heroCards} size="xs" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-bold text-ink">
          {item.roomName}
          <span className="ml-1 font-normal text-ink-dim">#{item.handNumber}</span>
        </span>
        <span className="block text-[10px] text-ink-dim">
          {formatPlayedAt(item.playedAt)} · BB {formatChips(item.bigBlind)}
          {item.gameMode === 'sng' ? ' · Sit & Go' : ''}
        </span>
      </span>
      {item.board.length > 0
        ? <MiniCards cards={item.board} />
        : <span className="text-[10px] text-ink-dim/60">보드 없음</span>}
      <span className={`w-16 shrink-0 text-right text-xs font-bold ${profitColor(item.profit)}`}>
        {formatProfit(item.profit, inBB, item.bigBlind)}
      </span>
    </button>
  );
}

function HandDetailView({ hand, onBack }: { hand: HandDetail; onBack: () => void }) {
  const inBB = useSettingsStore(s => s.historyBBView);
  const toggleBB = useSettingsStore(s => s.toggleHistoryBBView);
  const hideNames = useSettingsStore(s => s.historyHideNames);
  const toggleNames = useSettingsStore(s => s.toggleHistoryHideNames);

  const playerById = new Map(hand.players.map(p => [p.id, p]));
  const hero = playerById.get(hand.heroId);
  const startPots = computeStreetStartPots(hand);
  const resultStreet = finalStreet(hand);
  const amountText = (amount: number) => inBB ? formatBB(amount, hand.bigBlind) : formatChips(amount);

  const positionOf = (playerId: string) => playerById.get(playerId)?.position ?? '?';
  const displayName = (playerId: string) => {
    const player = playerById.get(playerId);
    if (!player) return '?';
    return player.id === hand.heroId ? '나' : player.name;
  };

  const actionText = (kind: HandHistoryAction['kind'], amount: number): string =>
    formatReplayAction(kind, amountText(amount));

  // 블라인드 포스팅은 별도 컬럼 (WPL 방식) — 프리플랍 컬럼은 실제 액션만
  const postActions = hand.actions.filter(a => a.kind === 'post-sb' || a.kind === 'post-bb');
  const streetActions = (street: PlayStreet) =>
    hand.actions.filter(a => a.street === street && a.kind !== 'post-sb' && a.kind !== 'post-bb');

  const winnersByPlayer = new Map<string, number>();
  for (const w of hand.winners) {
    winnersByPlayer.set(w.playerId, (winnersByPlayer.get(w.playerId) ?? 0) + w.amount);
  }
  const revealedLosers = hand.players.filter(
    p => p.revealed && p.holeCards && !winnersByPlayer.has(p.id),
  );

  const actionCell = (playerId: string, text: string, emphasized: boolean, key: string) => {
    const isHero = playerId === hand.heroId;
    return (
      <div
        key={key}
        className={`rounded-md border px-1 py-0.5 ${
          isHero ? 'border-blossom/40 bg-blossom/10' : 'border-mystic/15 bg-panel/70'
        }`}
      >
        {!hideNames && (
          <p className="truncate text-[9px] leading-tight text-ink-dim">{displayName(playerId)}</p>
        )}
        <p className="text-[10px] leading-tight">
          <span className={`font-bold ${POSITION_COLOR[positionOf(playerId)] ?? 'text-ink-dim'}`}>
            {positionOf(playerId)}
          </span>{' '}
          <span className={emphasized ? 'font-bold text-ink' : 'text-ink-dim'}>{text}</span>
        </p>
      </div>
    );
  };

  /** 승자·쇼다운 결과 블록 — 핸드가 끝난 스트리트 컬럼 맨 아래에 붙는다 */
  const resultBlock = (
    <div className="space-y-1">
      {hand.winners.map((winner, index) => {
        const player = playerById.get(winner.playerId);
        const isHero = winner.playerId === hand.heroId;
        return (
          <div
            key={`win-${index}`}
            className={`rounded-md border px-1 py-1 ${
              isHero ? 'border-gilded/60 bg-gilded/15' : 'border-gilded/30 bg-panel/70'
            }`}
          >
            <p className="text-[9px] leading-tight text-ink-dim">
              🏆 <span className={`font-bold ${POSITION_COLOR[positionOf(winner.playerId)] ?? ''}`}>
                {positionOf(winner.playerId)}
              </span>
              {!hideNames && <span className="ml-0.5">{displayName(winner.playerId)}</span>}
            </p>
            <p className="text-[10px] font-bold leading-tight text-gilded">+{amountText(winner.amount)}</p>
            {winner.handRank && (
              <p className="text-[9px] leading-tight text-gilded/80">{HAND_RANK_KO[winner.handRank]}</p>
            )}
            {player?.revealed && player.holeCards && (
              <div className="mt-0.5"><MiniCards cards={player.holeCards} /></div>
            )}
          </div>
        );
      })}
      {revealedLosers.map(player => (
        <div key={`shown-${player.id}`} className="rounded-md border border-mystic/15 bg-panel/70 px-1 py-1">
          <p className="text-[9px] leading-tight text-ink-dim">
            <span className={`font-bold ${POSITION_COLOR[player.position] ?? ''}`}>{player.position}</span>
            {!hideNames && <span className="ml-0.5">{player.id === hand.heroId ? '나' : player.name}</span>}
          </p>
          <div className="mt-0.5"><MiniCards cards={player.holeCards!} /></div>
          {player.handRank && (
            <p className="text-[9px] leading-tight text-ink-dim">{HAND_RANK_KO[player.handRank]}</p>
          )}
        </div>
      ))}
    </div>
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded-lg border border-mystic/25 bg-panel/85 px-2.5 py-1 text-xs text-ink-dim transition-colors hover:text-ink"
        >
          ← 목록
        </button>
        <div className="flex gap-1.5">
          <SegmentToggle options={['칩', 'BB']} active={inBB ? 1 : 0} onToggle={toggleBB} />
          <SegmentToggle options={['닉네임', '포지션']} active={hideNames ? 1 : 0} onToggle={toggleNames} />
        </div>
      </div>

      {/* 요약 헤더 — 결과·내 카드·메타를 한 줄에 (보드는 스트리트 컬럼에서 공개) */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-mystic/20 bg-panel/85 px-3 py-2">
        {hero?.holeCards && <MiniCards cards={hero.holeCards} size="xs" />}
        {hero && (
          <span className={`text-base font-bold ${profitColor(hero.profit)}`}>
            {formatProfit(hero.profit, inBB, hand.bigBlind)}
          </span>
        )}
        {hero?.handRank && (
          <span className="text-[11px] font-bold text-gilded">{HAND_RANK_KO[hero.handRank]}</span>
        )}
        {hero && <span className="text-[10px] text-ink-dim">내 포지션 <b className="text-cyber">{hero.position}</b></span>}
        <span className="ml-auto text-right text-[9px] leading-tight text-ink-dim">
          {hand.roomName} #{hand.handNumber}{hand.gameMode === 'sng' ? ' · Sit & Go' : ''}
          <br />
          {formatPlayedAt(hand.playedAt)} · 블라인드 {formatChips(hand.smallBlind)}/{formatChips(hand.bigBlind)}
          {' · '}팟 {amountText(hand.potTotal)}
          {hand.rake > 0 && ` (레이크 ${amountText(hand.rake)})`}
        </span>
      </div>

      {/* 스트리트 컬럼 — WPL/GG 방식: 세로 스크롤 대신 5컬럼에 액션을 나눠 담는다 */}
      <div className="grid grid-cols-5 gap-1">
        <div className="min-w-0">
          <div className="mb-1 rounded-md bg-abyss/60 px-1 py-1 text-center">
            <p className="text-[9px] font-bold text-mystic">블라인드</p>
            <p className="text-[9px] text-ink-dim">&nbsp;</p>
          </div>
          <div className="space-y-1">
            {postActions.map((action, index) =>
              actionCell(action.playerId, actionText(action.kind, action.amount), false, `post-${index}`))}
          </div>
        </div>
        {STREET_ORDER.map(street => {
          const actions = streetActions(street);
          const dealt = streetCards(street, hand.board);
          const startPot = startPots[street];
          const reached = street === 'preflop' || startPot !== null;
          return (
            <div key={street} className="min-w-0">
              <div className={`mb-1 rounded-md px-1 py-1 text-center ${reached ? 'bg-abyss/60' : 'bg-abyss/25'}`}>
                <p className={`text-[9px] font-bold ${reached ? 'text-mystic' : 'text-ink-dim/40'}`}>
                  {STREET_LABEL[street]}
                </p>
                <p className="text-[9px] text-gilded">
                  {reached && startPot !== null && startPot > 0 ? amountText(startPot) : ' '}
                </p>
                {dealt.length > 0 && (
                  <div className="mt-0.5 flex justify-center"><MiniCards cards={dealt} /></div>
                )}
              </div>
              <div className="space-y-1">
                {actions.map((action, index) => actionCell(
                  action.playerId,
                  actionText(action.kind, action.amount),
                  action.kind === 'raise' || action.kind === 'all-in',
                  `${street}-${index}`,
                ))}
                {street === resultStreet && resultBlock}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function HandHistoryModal({ isOpen, onClose }: HandHistoryModalProps) {
  // items === null → 아직 로드 전 (열릴 때 fetch, 닫힐 때 초기화 — 재오픈 시 새로 가져온다)
  const [items, setItems] = useState<HandHistorySummary[] | null>(null);
  const [nextBefore, setNextBefore] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selected, setSelected] = useState<HandDetail | null>(null);
  const [detailLoadingId, setDetailLoadingId] = useState<number | null>(null);
  const inBB = useSettingsStore(s => s.historyBBView);
  const toggleBB = useSettingsStore(s => s.toggleHistoryBBView);

  const fetchPage = useCallback(async (before?: number) => {
    const params = new URLSearchParams({ limit: '20' });
    if (before !== undefined) params.set('before', String(before));
    const response = await fetch(`/api/hands?${params}`, {
      credentials: 'same-origin',
      cache: 'no-store',
    });
    if (!response.ok) throw new Error('HANDS_FETCH_FAILED');
    return await response.json() as {
      items: HandHistorySummary[];
      nextBefore: number | null;
    };
  }, []);

  useEffect(() => {
    if (!isOpen || items !== null) return;
    let cancelled = false;
    fetchPage().then(
      page => {
        if (cancelled) return;
        setItems(page.items);
        setNextBefore(page.nextBefore);
      },
      () => {
        if (!cancelled) setError(LOAD_ERROR);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [isOpen, items, fetchPage]);

  const closeAndReset = () => {
    setItems(null);
    setNextBefore(null);
    setError(null);
    setSelected(null);
    setDetailLoadingId(null);
    onClose();
  };

  const loadMore = async () => {
    if (nextBefore === null || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(nextBefore);
      setItems(previous => [...(previous ?? []), ...page.items]);
      setNextBefore(page.nextBefore);
    } catch {
      setError(LOAD_ERROR);
    } finally {
      setLoadingMore(false);
    }
  };

  const openDetail = async (id: number) => {
    if (detailLoadingId !== null) return;
    setDetailLoadingId(id);
    setError(null);
    try {
      const response = await fetch(`/api/hands/${id}`, {
        credentials: 'same-origin',
        cache: 'no-store',
      });
      if (!response.ok) throw new Error('HAND_FETCH_FAILED');
      const payload = await response.json() as { hand: HandDetail };
      setSelected(payload.hand);
    } catch {
      setError(LOAD_ERROR);
    } finally {
      setDetailLoadingId(null);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={closeAndReset} title="핸드 히스토리" maxWidthClass="max-w-xl">
      {selected ? (
        <HandDetailView hand={selected} onBack={() => setSelected(null)} />
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-end">
            <SegmentToggle options={['칩', 'BB']} active={inBB ? 1 : 0} onToggle={toggleBB} />
          </div>
          {error && <p className="text-xs text-blossom">{error}</p>}
          {items === null && !error && (
            <p className="py-6 text-center text-xs text-ink-dim">불러오는 중…</p>
          )}
          {items !== null && items.length === 0 && (
            <div className="py-8 text-center">
              <p className="text-2xl" aria-hidden>🃏</p>
              <p className="mt-2 text-xs text-ink-dim">
                아직 기록된 핸드가 없어요. 한 판 치고 오면 여기에 쌓입니다!
              </p>
            </div>
          )}
          {items?.map(item => (
            <HandListRow key={item.id} item={item} inBB={inBB} onSelect={openDetail} />
          ))}
          {nextBefore !== null && (
            <button
              type="button"
              onClick={loadMore}
              disabled={loadingMore}
              className="w-full rounded-xl border border-mystic/25 bg-panel/85 py-2 text-xs text-ink-dim transition-colors hover:text-ink disabled:opacity-40"
            >
              {loadingMore ? '불러오는 중…' : '더 보기'}
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}
