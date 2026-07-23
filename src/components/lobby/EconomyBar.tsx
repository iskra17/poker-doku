'use client';

import { useState } from 'react';
import { useProfileStore } from '@/lib/store/profile-store';
import { useGameStore } from '@/lib/store/game-store';
import { getRescueStatusText } from '@/lib/economy/status-format';
import CharacterImage from '@/components/characters/CharacterImage';
import CharacterShowcaseModal from '@/components/characters/CharacterShowcaseModal';
import Button from '@/components/ui/Button';
import { getBalance, milliToUiUnits } from '@/lib/progression/balance';
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
  // 프로필 아바타 탭 → 캐릭터 쇼케이스 (덕질 포인트)
  const [showcaseOpen, setShowcaseOpen] = useState(false);

  if (!profile || !economy) return null;
  const busy = action === 'daily' || action === 'rescue';
  const activeSeatChips = activeSeat?.chips
    ?? (profile.wallet.activeEscrow > 0 ? profile.wallet.activeEscrow : null);
  const balance = progression ? getBalance(progression.profile.balanceVersion) : null;
  const dojoThreshold = progression && balance && progression.profile.dojoLevel < balance.dojoMaxLevel
    ? balance.dojoXpForNextLevel(progression.profile.dojoLevel) : 0;

  return (
    <section className="mx-auto mb-2 w-full max-w-4xl px-3 md:px-4">
      <div className="rounded-2xl border border-mystic/20 bg-panel/85 p-3 backdrop-blur-sm">
        {/* 한 줄 통합: 프로필 | 도장 레벨(우측 빈공간 활용) | 버튼. 좁은 화면에선 자연 줄바꿈 */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex min-w-0 items-center gap-3">
            {/* 이 블록은 '나'의 정체성 행 — 얼굴은 내 아바타(avatarId). 인연 파트너 얼굴은
                PartnerCard가 유일한 로비 표면이다 (아바타/인연 두 축 혼동 방지, 2026-07-23). */}
            <button
              type="button"
              onClick={() => setShowcaseOpen(true)}
              aria-label="내 아바타 보기"
              title="내 아바타 보기"
              className="block h-11 w-11 shrink-0 overflow-hidden rounded-full border border-mystic/40 transition-transform hover:scale-105"
            >
              <CharacterImage
                characterId={profile.avatarId}
                skinId={progression?.equipment.skin}
                round
                className="h-full w-full text-2xl"
              />
            </button>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold text-mystic">{profile.alias}</p>
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
          {progression && balance && (
            <div className="min-w-[150px] max-w-[240px] flex-1">
              <div className="flex justify-between text-[11px]">
                <span className="font-bold text-mystic">도장 Lv.{progression.profile.dojoLevel}</span>
                <span className="text-ink-dim">{dojoThreshold ? `${milliToUiUnits(progression.profile.dojoXpMilli)}/${milliToUiUnits(dojoThreshold)} XP` : '최고 레벨'}</span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-abyss"><div className="h-full bg-mystic" style={{ width: dojoThreshold ? `${Math.floor(progression.profile.dojoXpMilli / dojoThreshold * 100)}%` : '100%' }} /></div>
            </div>
          )}
          <div className="ml-auto flex items-center gap-2">
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
            <Button variant="secondary" size="sm" onClick={onOpenSettings}>프로필</Button>
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
        {progressionError && <p className="mt-2 text-center text-xs text-blossom">{progressionError}</p>}
      </div>

      <CharacterShowcaseModal
        characterId={showcaseOpen ? profile.avatarId : null}
        onClose={() => setShowcaseOpen(false)}
      />
    </section>
  );
}
