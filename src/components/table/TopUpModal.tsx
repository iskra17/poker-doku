'use client';

import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { useGameStore } from '@/lib/store/game-store';
import { useProfileStore } from '@/lib/store/profile-store';
import { useChipFormatter } from '@/lib/hooks/use-chip-format';
import Button from '../ui/Button';

/**
 * 칩 추가(바이인 탑업) — 올인이 아니라 "조금 잃었을 때" 스택을 다시 채운다.
 *
 * 서버 계약과 맞춘 상한: 테이블 맥시멈은 200BB이고(create-room이 강제), 지갑 방은
 * 지갑 잔액을 넘길 수 없다. 그래서 목표 상한은 min(현재칩 + 잔액, 200BB)이다.
 * 실제 판정은 서버가 다시 하므로 여기 계산은 UI 편의일 뿐이다.
 *
 * 핸드 중 요청은 서버가 예약한다 — 핸드 시작 스택이 정산 fingerprint로 굳어 있어
 * 중간에 칩이 늘면 검증이 깨지기 때문(PokerStars도 다음 핸드부터 반영).
 */

const MAX_BUYIN_BB = 200;

export default function TopUpModal({ onClose }: { onClose: () => void }) {
  const { gameState, myPlayerId, requestCashTopUp } = useGameStore();
  const profile = useProfileStore(s => s.profile);
  const refreshProfile = useProfileStore(s => s.refresh);
  const formatChips = useChipFormatter();

  const me = gameState?.players.find(p => p.id === myPlayerId);
  const chips = me?.chips ?? 0;
  const isWallet = gameState?.economyMode === 'wallet';
  const balance = profile?.wallet.balance ?? 0;
  const tableMax = (gameState?.bigBlind ?? 0) * MAX_BUYIN_BB;
  const maxTarget = Math.min(isWallet ? chips + balance : tableMax, tableMax);
  const headroom = Math.max(0, maxTarget - chips);

  const [target, setTarget] = useState(maxTarget);

  // 잔액이 오래됐을 수 있다 — 모달을 열 때 한 번 갱신 (외부 시스템 호출)
  useEffect(() => {
    void refreshProfile();
  }, [refreshProfile]);

  if (!gameState || !me) return null;

  const added = Math.max(0, target - chips);
  const canSubmit = headroom > 0 && target > chips && target <= maxTarget;
  const pendingTarget = me.pendingTopUpTarget;

  const submit = () => {
    if (!canSubmit) return;
    requestCashTopUp(target, () => onClose());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 sm:items-center">
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-sm rounded-2xl border border-mystic/30 bg-panel p-4"
      >
        <h2 className="text-sm font-bold text-ink">칩 추가</h2>

        <dl className="mt-3 space-y-1 rounded-xl bg-abyss/50 p-3 text-xs">
          <div className="flex justify-between">
            <dt className="text-ink-dim">현재 스택</dt>
            <dd className="font-bold text-ink">{formatChips(chips)}</dd>
          </div>
          {isWallet && (
            <div className="flex justify-between">
              <dt className="text-ink-dim">내 지갑</dt>
              <dd className="font-bold text-gilded">{formatChips(balance)}</dd>
            </div>
          )}
          <div className="flex justify-between">
            <dt className="text-ink-dim">테이블 최대 ({MAX_BUYIN_BB}BB)</dt>
            <dd className="text-ink">{formatChips(tableMax)}</dd>
          </div>
        </dl>

        {headroom <= 0 ? (
          <p className="mt-3 rounded-xl bg-abyss/40 p-3 text-xs leading-5 text-ink-dim">
            {chips >= tableMax
              ? '이미 테이블 최대 스택이에요.'
              : '지갑 잔액이 부족해 칩을 추가할 수 없어요.'}
          </p>
        ) : (
          <>
            <label className="mt-4 block text-xs text-ink-dim">
              채울 목표 스택
              <input
                type="range"
                min={chips + 1}
                max={maxTarget}
                step={Math.max(1, gameState.bigBlind)}
                value={target}
                onChange={event => setTarget(Number(event.target.value))}
                className="mt-2 w-full accent-blossom"
              />
            </label>
            <div className="mt-1 flex items-baseline justify-between text-xs">
              <span className="text-ink-dim">
                +{formatChips(added)} 추가
              </span>
              <span className="font-bold text-ink">
                → {formatChips(target)}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              {([
                ['절반', chips + Math.floor(headroom / 2)],
                ['100BB', Math.min(maxTarget, gameState.bigBlind * 100)],
                ['최대', maxTarget],
              ] as const).map(([label, value]) => (
                <button
                  key={label}
                  type="button"
                  disabled={value <= chips}
                  onClick={() => setTarget(value)}
                  className="rounded-lg border border-mystic/25 bg-panel/60 py-1.5 text-[11px] font-bold text-ink disabled:opacity-40"
                >
                  {label}
                </button>
              ))}
            </div>
          </>
        )}

        {gameState.isHandInProgress && headroom > 0 && (
          <p className="mt-3 text-[11px] leading-5 text-ink-dim">
            지금은 핸드가 진행 중이라, 이번 핸드가 끝나면 반영돼요.
          </p>
        )}
        {pendingTarget !== undefined && (
          <p className="mt-2 text-[11px] leading-5 text-cyber">
            {formatChips(pendingTarget)}까지 채우도록 예약돼 있어요.
          </p>
        )}

        <div className="mt-4 flex gap-2">
          <Button variant="secondary" size="sm" onClick={onClose} className="flex-1">
            닫기
          </Button>
          <Button
            size="sm"
            disabled={!canSubmit}
            onClick={submit}
            className="flex-1"
          >
            칩 추가
          </Button>
        </div>
      </motion.div>
    </div>
  );
}
