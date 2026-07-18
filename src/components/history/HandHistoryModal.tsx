'use client';

import { useCallback, useEffect, useState } from 'react';
import Modal from '../ui/Modal';
import CardComponent from '../table/Card';
import { HAND_RANK_KO } from '@/lib/poker/evaluator';
import type {
  HandHistoryAction,
  HandHistoryDetail,
  HandHistorySummary,
} from '@/lib/poker/hand-history';
import type { Card, Street } from '@/lib/poker/types';

/**
 * 핸드 히스토리 (GGPoker PokerCraft Game History 벤치마킹):
 * 목록(내 홀카드·보드·수익) → 핸드 클릭 시 스트리트별 액션 리플레이 상세.
 * 데이터는 /api/hands (프로필 쿠키 인증, 본인 핸드만).
 */
interface HandHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type HandDetail = HandHistoryDetail & { id: number };

const LOAD_ERROR = '핸드 히스토리를 불러오지 못했어요. 잠시 후 다시 시도해주세요.';
const STREET_LABEL: Record<Exclude<Street, 'showdown'>, string> = {
  preflop: '프리플랍',
  flop: '플랍',
  turn: '턴',
  river: '리버',
};
const STREET_ORDER: Exclude<Street, 'showdown'>[] = ['preflop', 'flop', 'turn', 'river'];

function formatChips(amount: number): string {
  return amount.toLocaleString('ko-KR');
}

function formatProfit(amount: number): string {
  return `${amount > 0 ? '+' : ''}${formatChips(amount)}`;
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

function actionLabel(action: HandHistoryAction): string {
  switch (action.kind) {
    case 'post-sb': return `SB ${formatChips(action.amount)}`;
    case 'post-bb': return `BB ${formatChips(action.amount)}`;
    case 'fold': return '폴드';
    case 'check': return '체크';
    case 'call': return `콜 ${formatChips(action.amount)}`;
    case 'raise': return `레이즈 ${formatChips(action.amount)}`;
    case 'all-in': return `올인 ${formatChips(action.amount)}`;
  }
}

/** 해당 스트리트에 새로 깔린 보드 카드 */
function streetCards(street: Exclude<Street, 'showdown'>, board: Card[]): Card[] {
  switch (street) {
    case 'preflop': return [];
    case 'flop': return board.slice(0, 3);
    case 'turn': return board.slice(3, 4);
    case 'river': return board.slice(4, 5);
  }
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

function HandListRow({ item, onSelect }: {
  item: HandHistorySummary;
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
        {formatProfit(item.profit)}
      </span>
    </button>
  );
}

function HandDetailView({ hand, onBack }: { hand: HandDetail; onBack: () => void }) {
  const playerById = new Map(hand.players.map(p => [p.id, p]));
  const hero = playerById.get(hand.heroId);
  const nameOf = (playerId: string): string => playerById.get(playerId)?.name ?? playerId;
  const revealedPlayers = hand.players.filter(p => p.revealed && p.holeCards);

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="rounded-lg border border-mystic/25 bg-panel/85 px-3 py-1.5 text-xs text-ink-dim transition-colors hover:text-ink"
      >
        ← 목록으로
      </button>

      <div className="rounded-xl border border-mystic/20 bg-panel/85 p-3">
        <p className="text-xs font-bold text-ink">
          {hand.roomName} <span className="font-normal text-ink-dim">#{hand.handNumber}</span>
        </p>
        <p className="mt-0.5 text-[10px] text-ink-dim">
          {formatPlayedAt(hand.playedAt)} · 블라인드 {formatChips(hand.smallBlind)}/{formatChips(hand.bigBlind)}
          {hand.gameMode === 'sng' ? ' · Sit & Go' : ''}
        </p>
        {hero && (
          <div className="mt-2 flex items-center gap-3">
            {hero.holeCards && <MiniCards cards={hero.holeCards} size="sm" />}
            <div>
              <p className="text-[10px] text-ink-dim">
                내 포지션 <span className="font-bold text-cyber">{hero.position}</span>
              </p>
              <p className={`text-sm font-bold ${profitColor(hero.profit)}`}>
                {formatProfit(hero.profit)}
              </p>
              {hero.handRank && (
                <p className="text-[10px] text-gilded">{HAND_RANK_KO[hero.handRank]}</p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="space-y-3">
        {STREET_ORDER.map(street => {
          const actions = hand.actions.filter(action => action.street === street);
          const dealt = streetCards(street, hand.board);
          if (actions.length === 0 && dealt.length === 0) return null;
          return (
            <div key={street}>
              <div className="mb-1 flex items-center gap-2">
                <span className="text-[11px] font-bold text-mystic">{STREET_LABEL[street]}</span>
                {dealt.length > 0 && <MiniCards cards={dealt} size="xs" />}
              </div>
              <ul className="space-y-0.5">
                {actions.map((action, index) => {
                  const isHero = action.playerId === hand.heroId;
                  const position = playerById.get(action.playerId)?.position;
                  return (
                    <li
                      key={`${street}-${index}`}
                      className={`flex justify-between rounded px-2 py-0.5 text-[11px] ${
                        isHero ? 'bg-blossom/10 text-ink' : 'text-ink-dim'
                      }`}
                    >
                      <span className="truncate">
                        {nameOf(action.playerId)}
                        {position && <span className="ml-1 text-[9px] text-ink-dim/70">{position}</span>}
                      </span>
                      <span className={action.kind === 'fold' ? '' : 'font-bold'}>
                        {actionLabel(action)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </div>
          );
        })}
      </div>

      {hand.showdown && revealedPlayers.length > 0 && (
        <div>
          <p className="mb-1 text-[11px] font-bold text-mystic">쇼다운</p>
          <ul className="space-y-1">
            {revealedPlayers.map(player => (
              <li key={player.id} className="flex items-center gap-2 text-[11px] text-ink-dim">
                {player.holeCards && <MiniCards cards={player.holeCards} size="xs" />}
                <span className={player.id === hand.heroId ? 'font-bold text-ink' : ''}>
                  {player.name}
                </span>
                {player.handRank && (
                  <span className="text-gilded">{HAND_RANK_KO[player.handRank]}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-xl border border-gilded/25 bg-panel/85 p-3">
        <p className="text-[11px] font-bold text-gilded">
          팟 {formatChips(hand.potTotal)}
          {hand.rake > 0 && <span className="ml-1 font-normal text-ink-dim">(레이크 {formatChips(hand.rake)})</span>}
        </p>
        <ul className="mt-1 space-y-0.5">
          {hand.winners.map((winner, index) => (
            <li key={index} className="flex justify-between text-[11px]">
              <span className={winner.playerId === hand.heroId ? 'font-bold text-ink' : 'text-ink-dim'}>
                🏆 {nameOf(winner.playerId)}
                {winner.handRank && (
                  <span className="ml-1 text-[9px] text-gilded">{HAND_RANK_KO[winner.handRank]}</span>
                )}
              </span>
              <span className="font-bold text-gilded">+{formatChips(winner.amount)}</span>
            </li>
          ))}
        </ul>
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
    <Modal isOpen={isOpen} onClose={closeAndReset} title="핸드 히스토리">
      {selected ? (
        <HandDetailView hand={selected} onBack={() => setSelected(null)} />
      ) : (
        <div className="space-y-2">
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
            <HandListRow key={item.id} item={item} onSelect={openDetail} />
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
