'use client';

import { useEffect, useState } from 'react';
import CharacterImage from '@/components/characters/CharacterImage';
import { useGameStore } from '@/lib/store/game-store';
import { useWeeklyDojoStore } from '@/lib/store/weekly-dojo-store';
import type {
  WeeklyDojoAttemptView,
  WeeklyDojoLeaderboardEntry,
  WeeklyDojoView,
} from '@/lib/weekly-dojo/types';

/**
 * 주간 도장 — 아레나 안의 비동기 주간 도전 패널.
 *
 * 자급자족 컴포넌트다: 소켓 바인딩·조회·시작/포기까지 이 안에서 끝나므로 부모(ArenaLobby)는
 * `<WeeklyDojoPanel />` 한 줄만 렌더하면 되고, 아레나 시즌 활성 여부와도 무관하다.
 * 화면에 나오는 점수·순위·진행도는 전부 서버 뷰 그대로이며 여기서 계산하지 않는다.
 */

const FINISH_LABELS: Record<string, string> = {
  'max-hands': '20핸드 완주',
  bust: '파산',
  forfeit: '중간 종료',
  'table-short': '상대 소진',
};

function formatBB(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded.toFixed(1)}BB`;
}

function daysLeft(view: WeeklyDojoView): number {
  return Math.max(1, Math.ceil((view.weekEndsAt - view.serverNow) / 86_400_000));
}

export default function WeeklyDojoPanel() {
  const socket = useGameStore(state => state.socket);
  const connected = useGameStore(state => state.connected);
  const currentRoomId = useGameStore(state => state.currentRoomId);
  const view = useWeeklyDojoStore(state => state.view);
  const loadState = useWeeklyDojoStore(state => state.loadState);
  const pending = useWeeklyDojoStore(state => state.pending);
  const error = useWeeklyDojoStore(state => state.error);
  const [confirmingForfeit, setConfirmingForfeit] = useState(false);

  useEffect(() => {
    if (!socket) return;
    return useWeeklyDojoStore.getState().bindSocket(socket);
  }, [socket]);

  useEffect(() => {
    if (!socket || !connected) return;
    useWeeklyDojoStore.getState().refresh();
  }, [socket, connected]);

  const startAttempt = (): void => {
    setConfirmingForfeit(false);
    void useWeeklyDojoStore.getState().start();
  };
  const forfeitAttempt = (): void => {
    setConfirmingForfeit(false);
    void useWeeklyDojoStore.getState().forfeit();
  };

  if (!view) {
    return (
      <section
        aria-labelledby="weekly-dojo-title"
        className="rounded-2xl border border-mystic/25 bg-panel/90 p-4"
      >
        <h3 id="weekly-dojo-title" className="text-base font-bold text-ink">주간 도장</h3>
        <p aria-live="polite" className="mt-2 text-sm text-ink-dim">
          {loadState === 'error'
            ? error ?? '주간 도장 정보를 불러오지 못했어요.'
            : '주간 도장 기록을 불러오는 중이에요…'}
        </p>
        {loadState === 'error' && (
          <button
            type="button"
            onClick={() => useWeeklyDojoStore.getState().refresh()}
            className="mt-3 rounded-xl border border-mystic/30 bg-elevated px-3 py-2 text-sm font-bold text-ink"
          >
            다시 불러오기
          </button>
        )}
      </section>
    );
  }

  const live = view.live;
  const atMyTable = !!live?.roomId && live.roomId === currentRoomId;
  const capped = !live && view.completedCount >= view.rules.attemptsPerWeek;
  const ctaLabel = atMyTable
    ? '도전 진행 중'
    : live
      ? '이어하기'
      : capped
        ? '이번 주 도전 완료'
        : '도전 시작';

  return (
    <section
      aria-labelledby="weekly-dojo-title"
      className="rounded-2xl border border-mystic/25 bg-panel/90 p-4"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="weekly-dojo-title" className="text-base font-bold text-ink">주간 도장</h3>
        <p className="text-xs text-ink-dim">{daysLeft(view)}일 남음</p>
      </div>
      <p className="mt-1 text-xs text-ink-dim">
        같은 봇 5명과 100BB로 {view.rules.maxHands}핸드씩, 주 {view.rules.attemptsPerWeek}회.
      </p>

      <dl className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-elevated p-3">
          <dt className="text-xs text-ink-dim">이번 주 기록</dt>
          <dd className="mt-1 text-sm font-bold text-gilded">
            {view.totalNetBB === null
              ? `${view.completedCount}/${view.rules.attemptsPerWeek} 진행 중`
              : formatBB(view.totalNetBB)}
          </dd>
        </div>
        <div className="rounded-xl bg-elevated p-3">
          <dt className="text-xs text-ink-dim">순위</dt>
          <dd className="mt-1 text-sm font-bold text-ink">
            {view.rank === null
              ? '3회를 마치면 집계돼요'
              : `${view.rank}위 / ${view.entrants}명`}
          </dd>
        </div>
      </dl>

      <ul className="mt-2 flex gap-2" aria-label="도전 기록">
        {view.attempts.map(attempt => (
          <AttemptChip key={attempt.slot} attempt={attempt} />
        ))}
      </ul>

      <button
        type="button"
        onClick={startAttempt}
        disabled={pending || capped || atMyTable || !connected}
        aria-label={`주간 도장 ${ctaLabel}`}
        className="mt-3 w-full rounded-xl border border-blossom/45 bg-blossom/12 px-4 py-2.5 text-sm font-bold text-ink disabled:opacity-50"
      >
        {pending ? '준비 중…' : ctaLabel}
      </button>

      {live && !atMyTable && (
        <div className="mt-2">
          {confirmingForfeit
            ? (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={forfeitAttempt}
                  disabled={pending}
                  className="flex-1 rounded-xl border border-blossom/45 bg-elevated px-3 py-2 text-xs font-bold text-blossom disabled:opacity-50"
                >
                  {live.handsPlayed}핸드까지로 기록 닫기
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingForfeit(false)}
                  className="rounded-xl border border-mystic/25 bg-elevated px-3 py-2 text-xs font-bold text-ink-dim"
                >
                  취소
                </button>
              </div>
            )
            : (
              <button
                type="button"
                onClick={() => setConfirmingForfeit(true)}
                disabled={pending}
                className="w-full rounded-xl border border-mystic/25 bg-elevated px-3 py-2 text-xs font-bold text-ink-dim disabled:opacity-50"
              >
                {live.slot}번째 도전 지금 마치기 · {live.handsPlayed}/{view.rules.maxHands}핸드
              </button>
            )}
        </div>
      )}

      {error && (
        <p aria-live="polite" className="mt-2 text-xs text-blossom">{error}</p>
      )}
      {!connected && (
        <p aria-live="polite" className="mt-2 text-xs text-ink-dim">
          연결이 끊겨 있어요. 다시 연결되면 이어서 진행할 수 있어요.
        </p>
      )}

      <details className="mt-3 rounded-xl bg-elevated p-3">
        <summary className="cursor-pointer text-xs font-bold text-ink">규칙 자세히</summary>
        <ul className="mt-2 space-y-1 text-xs text-ink-dim">
          <li>
            시작 {view.rules.startingChips.toLocaleString()}칩({view.rules.startingBB}BB) ·
            블라인드 {view.rules.smallBlind}/{view.rules.bigBlind} ·
            한 도전 최대 {view.rules.maxHands}핸드
          </li>
          <li>지갑 칩·경기권을 쓰지 않고, 공식 아레나 점수에도 반영되지 않아요.</li>
          <li>도전을 시작하면 순번이 먼저 확정돼요. 중간에 나가도 이미 끝난 핸드는 남아요.</li>
          <li>점수는 끝난 핸드 기준 순 BB의 합계예요. 3회를 모두 마쳐야 순위에 들어가요.</li>
          <li>같은 점수는 공동 순위예요. 카드는 매번 새로 섞여요.</li>
          <li>
            상대(고정 {view.rules.lineupVersion}): {view.rules.lineup.map(seat => seat.name).join(' · ')}
          </li>
          <li>60핸드는 실력을 가리기엔 짧은 표본이에요. 주간 기록으로 즐겨 주세요.</li>
        </ul>
      </details>

      <Leaderboard view={view} />
    </section>
  );
}

function AttemptChip({ attempt }: { attempt: WeeklyDojoAttemptView }): React.ReactElement {
  const label = attempt.status === 'completed'
    ? formatBB(attempt.netBB)
    : attempt.status === 'live' ? '진행 중' : '미시작';
  const tone = attempt.status === 'completed'
    ? 'border-gilded/35 text-ink'
    : attempt.status === 'live' ? 'border-blossom/45 text-blossom' : 'border-mystic/20 text-ink-dim';
  return (
    <li className={`flex-1 rounded-xl border bg-elevated px-2 py-2 text-center ${tone}`}>
      <span className="block text-xs text-ink-dim">{attempt.slot}회차</span>
      <span className="mt-0.5 block text-xs font-bold">{label}</span>
      {attempt.finishReason && (
        <span className="mt-0.5 block text-[11px] text-ink-dim">
          {FINISH_LABELS[attempt.finishReason] ?? attempt.finishReason}
        </span>
      )}
    </li>
  );
}

function Leaderboard({ view }: { view: WeeklyDojoView }): React.ReactElement {
  const rows = view.nearby.length > 0 ? view.nearby : view.top;
  const heading = view.nearby.length > 0 && view.rank !== null ? '내 주변 순위' : '이번 주 상위';
  if (rows.length === 0) {
    return (
      <p className="mt-3 text-xs text-ink-dim">
        아직 3회를 모두 마친 사람이 없어요. 첫 기록의 주인공이 되어 보세요.
      </p>
    );
  }
  return (
    <div className="mt-3">
      <h4 className="text-xs font-bold text-ink-dim">{heading}</h4>
      <ol className="mt-2 space-y-1">
        {rows.map(entry => <LeaderboardRow key={entry.profileId} entry={entry} />)}
      </ol>
    </div>
  );
}

function LeaderboardRow(
  { entry }: { entry: WeeklyDojoLeaderboardEntry },
): React.ReactElement {
  return (
    <li
      className={`flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm ${
        entry.isMe ? 'bg-blossom/10 text-ink' : 'text-ink-dim'
      }`}
    >
      <span className="w-8 shrink-0 text-xs font-bold text-ink-dim">{entry.rank}위</span>
      <CharacterImage characterId={entry.avatarId} className="h-6 w-6 shrink-0 text-xs" />
      <span className="min-w-0 flex-1 truncate">{entry.alias}</span>
      <span className="shrink-0 text-xs font-bold text-gilded">{formatBB(entry.netBB)}</span>
    </li>
  );
}
