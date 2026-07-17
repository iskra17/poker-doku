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
    <section className="mx-auto mb-4 w-full max-w-4xl px-4" aria-labelledby="daily-missions-title">
      <div className="rounded-2xl border border-mystic/20 bg-panel/85 p-4 backdrop-blur-sm">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 id="daily-missions-title" className="text-sm font-bold text-mystic">오늘의 수련</h2>
          <span className="text-[11px] text-ink-dim">무료 교체 {rerollUsed ? 0 : 1}회 남음</span>
        </div>
        <div className="grid gap-2 md:grid-cols-3">
          {missions.missions.map(mission => {
            const definition = MISSION_BY_ID.get(mission.missionId);
            const completed = mission.rewardedAt !== null;
            const percentage = Math.min(100, Math.floor((mission.progress / mission.target) * 100));
            return (
              <article key={mission.slot} className="rounded-xl border border-mystic/20 bg-elevated/50 p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h3 className="text-xs font-bold text-ink">{definition?.label ?? mission.missionId}</h3>
                    <p className="mt-1 text-[10px] text-ink-dim">
                      {completed ? '완료 · 보상 자동 수령' : `${mission.progress}/${mission.target}`}
                    </p>
                  </div>
                  {!completed && !rerollUsed && (
                    <button
                      type="button"
                      disabled={action !== null}
                      aria-label={`${definition?.label ?? '과제'} 무료 교체`}
                      onClick={() => void rerollMission(mission.slot)}
                      className="rounded-lg border border-mystic/30 px-2 py-1 text-[10px] font-bold text-mystic disabled:opacity-40"
                    >
                      교체
                    </button>
                  )}
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-abyss" role="progressbar" aria-label={`${definition?.label ?? '일일 과제'} 진행률`} aria-valuenow={percentage} aria-valuemin={0} aria-valuemax={100}>
                  <div className="h-full rounded-full bg-mystic" style={{ width: `${percentage}%` }} />
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
