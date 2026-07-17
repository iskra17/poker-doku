'use client';

import { getBalance, milliToUiUnits } from '@/lib/progression/balance';
import { useProgressionStore } from '@/lib/store/progression-store';

export default function ProgressionTab() {
  const snapshot = useProgressionStore(state => state.snapshot);
  if (!snapshot) return <p className="text-xs text-ink-dim">성장 정보를 불러오는 중이에요.</p>;
  const profile = snapshot.profile;
  const balance = getBalance(profile.balanceVersion);
  const maximum = profile.dojoLevel === balance.dojoMaxLevel;
  const threshold = maximum ? 0 : balance.dojoXpForNextLevel(profile.dojoLevel);
  const percent = maximum ? 100 : Math.floor(profile.dojoXpMilli / threshold * 100);
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-mystic/20 bg-elevated/50 p-4">
        <p className="text-lg font-bold text-mystic">도장 레벨 {profile.dojoLevel}</p>
        <p className="text-xs text-ink-dim">{maximum ? '최고 레벨 달성' : `${milliToUiUnits(profile.dojoXpMilli)} / ${milliToUiUnits(threshold)} XP`}</p>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-abyss" role="progressbar" aria-label="도장 레벨 경험치" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-mystic" style={{ width: `${percent}%` }} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-center">
        <Stat label="연속 수련" value={`${snapshot.streak.currentStreak}일`} />
        <Stat label="휴식권" value={`${snapshot.streak.restPasses}장`} />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-mystic/20 bg-elevated/50 p-3"><p className="text-[10px] text-ink-dim">{label}</p><p className="font-bold text-gilded">{value}</p></div>;
}
