'use client';

import { useProfileStore } from '@/lib/store/profile-store';
import { useGameStore } from '@/lib/store/game-store';
import { getRescueStatusText } from '@/lib/economy/status-format';
import CharacterImage from '@/components/characters/CharacterImage';
import Button from '@/components/ui/Button';

interface EconomyBarProps {
  onOpenSettings: () => void;
}

export default function EconomyBar({ onOpenSettings }: EconomyBarProps) {
  const profile = useProfileStore(state => state.profile);
  const economy = useProfileStore(state => state.economy);
  const action = useProfileStore(state => state.action);
  const error = useProfileStore(state => state.error);
  const recoveryWarning = useProfileStore(state => state.recoveryWarning);
  const claimDaily = useProfileStore(state => state.claimDaily);
  const claimRescue = useProfileStore(state => state.claimRescue);
  const activeSeat = useGameStore(state => state.rooms.find(room => room.mySeat)?.mySeat ?? null);

  if (!profile || !economy) return null;
  const busy = action === 'daily' || action === 'rescue';
  const activeSeatChips = activeSeat?.chips
    ?? (profile.wallet.activeEscrow > 0 ? profile.wallet.activeEscrow : null);

  return (
    <section className="mx-auto mb-4 w-full max-w-4xl px-4">
      <div className="rounded-2xl border border-mystic/20 bg-panel/85 p-4 backdrop-blur-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="block h-11 w-11 shrink-0 overflow-hidden rounded-full border border-mystic/40">
              <CharacterImage characterId={profile.avatarId} round className="h-full w-full text-2xl" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-mystic">{profile.alias}</p>
              <p className="text-xs text-ink-dim">
                지갑 <span className="font-bold text-gilded">{profile.wallet.balance.toLocaleString('ko-KR')}칩</span>
                {activeSeatChips !== null && <> · 좌석 {activeSeatChips.toLocaleString('ko-KR')}칩</>}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {recoveryWarning && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="rounded-full border border-blossom/30 bg-blossom/10 px-3 py-1.5 text-[11px] font-bold text-blossom"
              >
                ⚠ 복구 코드 미저장
              </button>
            )}
            <Button
              variant={economy.daily.claimed ? 'secondary' : 'primary'}
              size="sm"
              disabled={economy.daily.claimed || busy}
              onClick={() => void claimDaily()}
            >
              {economy.daily.claimed
                ? '오늘 무료 칩 받음'
                : action === 'daily'
                  ? '받는 중…'
                  : `일일 +${economy.daily.grantAmount.toLocaleString('ko-KR')}`}
            </Button>
          </div>
        </div>

        {economy.rescue.eligible && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gilded/30 bg-gilded/10 p-3">
            <div>
              <p className="text-sm font-bold text-gilded">미야코의 재도전 지원</p>
              <p className="text-xs text-ink-dim">
                {getRescueStatusText(economy.rescue, 0)} · 오늘 {economy.rescue.remainingToday}회 남음
              </p>
            </div>
            <Button
              variant="success"
              size="sm"
              disabled={busy}
              onClick={() => void claimRescue()}
            >
              {action === 'rescue' ? '지원 중…' : `${economy.rescue.grantAmount.toLocaleString('ko-KR')}칩 받기`}
            </Button>
          </div>
        )}
        {error && <p className="mt-2 text-center text-xs text-blossom">{error}</p>}
      </div>
    </section>
  );
}
