'use client';

import { useState } from 'react';
import { useProfileStore } from '@/lib/store/profile-store';
import { useGameStore } from '@/lib/store/game-store';
import { getRescueStatusText } from '@/lib/economy/status-format';
import CharacterImage from '@/components/characters/CharacterImage';
import CharacterShowcaseModal from '@/components/characters/CharacterShowcaseModal';
import Button from '@/components/ui/Button';
import { useProgressionStore } from '@/lib/store/progression-store';
import { useArenaStore } from '@/lib/store/arena-store';

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
  const progression = useProgressionStore(state => state.snapshot);
  const progressionError = useProgressionStore(state => state.error);
  const arenaSnapshot = useArenaStore(state => state.snapshot);
  const [showcaseOpen, setShowcaseOpen] = useState(false);

  if (!profile || !economy) return null;
  const busy = action === 'daily' || action === 'rescue';
  const activeSeatChips = activeSeat?.chips
    ?? (profile.wallet.activeEscrow > 0 ? profile.wallet.activeEscrow : null);

  return (
    <section className="mx-auto mb-2 w-full max-w-4xl px-3 md:px-4">
      <div className="rounded-xl border border-white/10 bg-panel/90 p-2.5">
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            {/* 이 블록은 '나'의 정체성 행 — 파트너 얼굴은 PartnerCard가 유일한 로비 표면이다. */}
            <button
              type="button"
              onClick={() => setShowcaseOpen(true)}
              aria-label="내 아바타 보기"
              title="내 아바타 보기"
              className="block h-11 w-11 shrink-0 overflow-hidden rounded-full border border-white/15 transition-colors hover:border-blossom/60"
            >
              <CharacterImage
                characterId={profile.avatarId}
                skinId={progression?.equipment.skin}
                round
                className="h-full w-full text-2xl"
              />
            </button>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-ink">{profile.alias}</p>
              <p className="text-xs text-ink-dim">
                지갑 <span className="font-bold text-gilded">{profile.wallet.balance.toLocaleString('ko-KR')}칩</span>
                {activeSeatChips !== null && <> · 좌석 {activeSeatChips.toLocaleString('ko-KR')}칩</>}
                {arenaSnapshot?.enabled && (
                  <> · <span aria-label="아레나 경기권" title="아레나 경기권">경기권</span>{' '}
                    <span className="font-bold text-mystic">{arenaSnapshot.profile.availableTickets}장</span></>
                )}
              </p>
            </div>
          </div>

          <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
            {recoveryWarning && (
              <button
                type="button"
                onClick={onOpenSettings}
                className="min-h-11 rounded-lg border border-blossom/35 bg-blossom/10 px-2.5 text-xs font-bold text-blossom"
              >
                복구 코드 확인
              </button>
            )}
            {economy.daily.claimed ? (
              <span className="px-1 text-xs text-ink-dim">오늘 무료 칩 받음</span>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => void claimDaily()}
              >
                {action === 'daily' ? '받는 중…' : `일일 +${economy.daily.grantAmount.toLocaleString('ko-KR')}`}
              </Button>
            )}
            <Button variant="secondary" size="sm" onClick={onOpenSettings}>프로필</Button>
          </div>
        </div>

        {economy.rescue.eligible && (
          <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2.5 rounded-lg border border-gilded/30 bg-gilded/10 p-2.5">
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
        {!economy.rescue.eligible && (economy.rescue.reason === 'cooldown' || economy.rescue.reason === 'daily-limit') && (
          <p className="mt-2 text-xs text-ink-dim">{getRescueStatusText(economy.rescue, 0)}</p>
        )}
        {error && <p className="mt-2 text-center text-xs text-blossom">{error}</p>}
        {progressionError && <p className="mt-2 text-center text-xs text-blossom">{progressionError}</p>}
      </div>

      <CharacterShowcaseModal
        characterId={showcaseOpen ? profile.avatarId : null}
        onClose={() => setShowcaseOpen(false)}
      />
    </section>
  );
}
