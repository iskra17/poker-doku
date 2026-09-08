'use client';

import { MISSION_CATALOG } from '@/lib/progression/missions';
import { useProgressionStore } from '@/lib/store/progression-store';

const MISSION_BY_ID = new Map(MISSION_CATALOG.map(mission => [mission.id, mission]));

export default function MissionPanel() {
  const missions = useProgressionStore(state => state.missions);
  const action = useProgressionStore(state => state.action);
  const rerollMission = useProgressionStore(state => state.rerollMission);
  if (!missions || missions.missions.length !== 3) return null;

  const rerollUsed = missions.missions.some(mission => mission.rerollCount > 0);
  return (
    <section className="mx-auto mb-4 w-full max-w-4xl px-3 md:px-4" aria-labelledby="daily-missions-title">
      <div className="rounded-xl border border-white/10 bg-panel/90 p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <div>
            <h2 id="daily-missions-title" className="text-base font-bold text-ink">오늘의 수련</h2>
            <p className="mt-0.5 text-xs text-ink-dim">완료할 때마다 수련 XP +100</p>
          </div>
          <span className="text-xs text-ink-dim">무료 교체 {rerollUsed ? 0 : 1}회 남음</span>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          {missions.missions.map(mission => {
            const definition = MISSION_BY_ID.get(mission.missionId);
            const completed = mission.rewardedAt !== null;
            const percentage = Math.min(100, Math.floor((mission.progress / mission.target) * 100));
            return (
              <article key={mission.slot} className="rounded-lg border border-white/10 bg-elevated/60 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="text-sm font-bold text-ink">{definition?.label ?? mission.missionId}</h3>
                    <p className="mt-1 text-xs text-ink-dim">
                      {completed ? '완료' : `${mission.progress}/${mission.target} 진행`}
                    </p>
                  </div>
                  {!completed && !rerollUsed && (
                    <button
                      type="button"
                      disabled={action !== null}
                      aria-label={`${definition?.label ?? '과제'} 무료 교체`}
                      onClick={() => void rerollMission(mission.slot)}
                      className="min-h-11 shrink-0 rounded-lg border border-white/15 px-2.5 text-xs font-bold text-mystic transition-colors hover:border-mystic/60 hover:text-ink disabled:opacity-40"
                    >
                      교체
                    </button>
                  )}
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-abyss" role="progressbar" aria-label={`${definition?.label ?? '일일 과제'} 진행률`} aria-valuenow={percentage} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full rounded-full bg-mystic transition-[width]" style={{ width: `${percentage}%` }} />
                </div>
                <p className="mt-2 text-xs font-bold text-gilded">수련 XP +100</p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
