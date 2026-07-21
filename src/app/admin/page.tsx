'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * 운영 백오피스 — DEBUG_LOG_TOKEN 토큰 게이트, 5초 주기 자동 갱신.
 * 서버 API: /api/admin/overview · /api/admin/profiles · /api/admin/events (admin-http.ts).
 * 개인정보 없음 — 익명 별명/활동 지표/칩 현황만 다룬다.
 */

const REFRESH_MS = 5_000;
const TOKEN_STORAGE_KEY = 'poker-doku-admin-token';

interface Overview {
  at: number;
  uptimeMs: number;
  memoryRssMb: number;
  sessions: { sessions: number; sockets: number; grace: number } | null;
  rooms: Array<{
    id: string; name: string; mode: string; tableType: string; economyMode: string;
    handNumber: number; handInProgress: boolean; humans: number; bots: number;
    sittingOut: number; disconnected: number; potTotal: number; blinds: string;
  }>;
  roomRuntime: Record<string, number> | null;
  eventLog: { total: number; oldest: number | null; newest: number | null };
  db: { profiles: number; feedback: number; handHistory: number; opsEvents: number };
}

interface AdminProfile {
  id: string;
  alias: string;
  createdAt: number;
  lastSeenAt: number | null;
  connectCount: number;
  wallet: { balance: number; activeEscrow: number };
  online: boolean;
  roomId: string | null;
  graceActive: boolean;
}

interface OpsEvent {
  id: number;
  at: number;
  type: string;
  roomId: string | null;
  playerId: string | null;
  data: Record<string, unknown>;
}

function timeAgo(ms: number | null): string {
  if (!ms) return '—';
  const diff = Date.now() - ms;
  if (diff < 60_000) return `${Math.max(1, Math.round(diff / 1000))}초 전`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}분 전`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}시간 전`;
  return `${Math.round(diff / 86_400_000)}일 전`;
}

function fmtUptime(ms: number): string {
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}분`;
  return `${Math.floor(m / 60)}시간 ${m % 60}분`;
}

export default function AdminPage() {
  // 저장된 토큰은 렌더 초기값으로 복원 (effect 내 setState 금지 규칙 — page.tsx 초대 링크와 동일 패턴)
  const [token, setToken] = useState(() => (
    typeof window === 'undefined' ? '' : window.localStorage.getItem(TOKEN_STORAGE_KEY) ?? ''
  ));
  const [tokenInput, setTokenInput] = useState(() => (
    typeof window === 'undefined' ? '' : window.localStorage.getItem(TOKEN_STORAGE_KEY) ?? ''
  ));
  const [authFailed, setAuthFailed] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [profiles, setProfiles] = useState<AdminProfile[]>([]);
  const [events, setEvents] = useState<OpsEvent[]>([]);
  const [eventType, setEventType] = useState('');
  const [lastError, setLastError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const query = `token=${encodeURIComponent(token)}`;
      const typeFilter = eventType
        ? `&type=${encodeURIComponent(eventType)}`
        : '';
      const [overviewRes, profilesRes, eventsRes] = await Promise.all([
        fetch(`/api/admin/overview?${query}`),
        fetch(`/api/admin/profiles?${query}&limit=100`),
        fetch(`/api/admin/events?${query}&limit=100${typeFilter}`),
      ]);
      if (overviewRes.status === 403) {
        setAuthFailed(true);
        return;
      }
      setAuthFailed(false);
      setOverview(await overviewRes.json() as Overview);
      const profilesBody = await profilesRes.json() as { profiles: AdminProfile[] };
      setProfiles(profilesBody.profiles ?? []);
      const eventsBody = await eventsRes.json() as { events: OpsEvent[] };
      setEvents(eventsBody.events ?? []);
      setLastError(null);
      setUpdatedAt(Date.now());
    } catch {
      setLastError('서버에 연결하지 못했어요');
    }
  }, [token, eventType]);

  useEffect(() => {
    if (!token) return;
    // 첫 갱신도 타이머 콜백으로 — effect 본문 직접 setState 금지 규칙 준수
    const initial = setTimeout(() => void refresh(), 0);
    const timer = setInterval(() => void refresh(), REFRESH_MS);
    return () => {
      clearTimeout(initial);
      clearInterval(timer);
    };
  }, [token, refresh]);

  const applyToken = () => {
    const value = tokenInput.trim();
    if (!value) return;
    window.localStorage.setItem(TOKEN_STORAGE_KEY, value);
    setAuthFailed(false);
    setToken(value);
  };

  if (!token || authFailed) {
    return (
      <main className="min-h-dvh bg-abyss flex items-center justify-center p-4">
        <div className="w-full max-w-sm rounded-2xl border border-mystic/30 bg-panel p-6">
          <h1 className="text-lg font-bold text-mystic mb-1">운영 백오피스</h1>
          <p className="text-xs text-ink-dim mb-4">
            DEBUG_LOG_TOKEN을 입력하세요.
            {authFailed && <span className="text-blossom"> — 토큰이 올바르지 않아요.</span>}
          </p>
          <input
            type="password"
            value={tokenInput}
            onChange={event => setTokenInput(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter') applyToken(); }}
            placeholder="운영 토큰"
            className="w-full rounded-xl border border-mystic/20 bg-elevated/70 p-3 text-sm text-ink outline-none focus:border-blossom/50"
          />
          <button
            type="button"
            onClick={applyToken}
            className="mt-3 w-full rounded-xl bg-blossom/20 border border-blossom/50 py-2 text-sm font-bold text-blossom hover:bg-blossom/30"
          >
            접속
          </button>
        </div>
      </main>
    );
  }

  const cards: Array<[string, string]> = overview ? [
    ['접속 소켓', String(overview.sessions?.sockets ?? '—')],
    ['세션', String(overview.sessions?.sessions ?? '—')],
    ['유예(grace)', String(overview.sessions?.grace ?? '—')],
    ['방', String(overview.rooms.length)],
    ['핸드 진행 중', String(overview.rooms.filter(room => room.handInProgress).length)],
    ['프로필', String(overview.db.profiles)],
    ['업타임', fmtUptime(overview.uptimeMs)],
    ['메모리', `${overview.memoryRssMb}MB`],
  ] : [];

  return (
    <main className="min-h-dvh overflow-y-auto bg-abyss p-4 text-ink">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-lg font-bold text-mystic">운영 백오피스</h1>
          <div className="text-[11px] text-ink-dim">
            {lastError
              ? <span className="text-blossom">{lastError}</span>
              : `${REFRESH_MS / 1000}초마다 갱신 · 마지막 ${timeAgo(updatedAt)}`}
          </div>
        </header>

        <section className="grid grid-cols-4 gap-2 md:grid-cols-8">
          {cards.map(([label, value]) => (
            <div key={label} className="rounded-xl border border-mystic/20 bg-panel/85 p-3 text-center">
              <div className="text-lg font-bold text-gilded tabular">{value}</div>
              <div className="text-[10px] text-ink-dim">{label}</div>
            </div>
          ))}
        </section>

        <section>
          <h2 className="mb-2 text-sm font-bold text-blossom">
            방 ({overview?.rooms.length ?? 0})
          </h2>
          <div className="overflow-x-auto rounded-xl border border-mystic/20 bg-panel/85">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] text-ink-dim">
                <tr>
                  {['이름', '모드', '구성', '경제', '블라인드', '핸드', '휴먼', '봇', '자리비움', '오프라인', '팟'].map(h => (
                    <th key={h} className="px-3 py-2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(overview?.rooms ?? []).map(room => (
                  <tr key={room.id} className="border-t border-white/5">
                    <td className="px-3 py-2 font-bold">{room.name}</td>
                    <td className="px-3 py-2">{room.mode}</td>
                    <td className="px-3 py-2">{room.tableType}</td>
                    <td className="px-3 py-2">{room.economyMode}</td>
                    <td className="px-3 py-2 tabular">{room.blinds}</td>
                    <td className="px-3 py-2 tabular">
                      #{room.handNumber}{room.handInProgress ? ' ▶' : ''}
                    </td>
                    <td className="px-3 py-2 tabular">{room.humans}</td>
                    <td className="px-3 py-2 tabular">{room.bots}</td>
                    <td className="px-3 py-2 tabular">{room.sittingOut}</td>
                    <td className="px-3 py-2 tabular">{room.disconnected}</td>
                    <td className="px-3 py-2 tabular">{room.potTotal.toLocaleString()}</td>
                  </tr>
                ))}
                {(overview?.rooms.length ?? 0) === 0 && (
                  <tr><td className="px-3 py-3 text-ink-dim" colSpan={11}>방 없음</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-bold text-blossom">
            프로필 (최근 활동순 {profiles.length})
          </h2>
          <div className="overflow-x-auto rounded-xl border border-mystic/20 bg-panel/85">
            <table className="w-full text-left text-xs">
              <thead className="text-[10px] text-ink-dim">
                <tr>
                  {['별명', '상태', '방', '지갑', '에스크로', '접속 횟수', '마지막 활동', '가입'].map(h => (
                    <th key={h} className="px-3 py-2">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {profiles.map(profile => (
                  <tr key={profile.id} className="border-t border-white/5">
                    <td className="px-3 py-2 font-bold">{profile.alias}</td>
                    <td className="px-3 py-2">
                      {profile.online
                        ? <span className="text-green-400">● 접속</span>
                        : profile.graceActive
                          ? <span className="text-gilded">◐ 유예</span>
                          : <span className="text-ink-dim">○ 오프라인</span>}
                    </td>
                    <td className="px-3 py-2 text-[10px] text-ink-dim">{profile.roomId ?? '—'}</td>
                    <td className="px-3 py-2 tabular text-gilded">{profile.wallet.balance.toLocaleString()}</td>
                    <td className="px-3 py-2 tabular">{profile.wallet.activeEscrow.toLocaleString()}</td>
                    <td className="px-3 py-2 tabular">{profile.connectCount}</td>
                    <td className="px-3 py-2">{timeAgo(profile.lastSeenAt)}</td>
                    <td className="px-3 py-2">{timeAgo(profile.createdAt)}</td>
                  </tr>
                ))}
                {profiles.length === 0 && (
                  <tr><td className="px-3 py-3 text-ink-dim" colSpan={8}>프로필 없음</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section>
          <div className="mb-2 flex items-center gap-2">
            <h2 className="text-sm font-bold text-blossom">운영 이벤트 (영속)</h2>
            <select
              value={eventType}
              onChange={event => setEventType(event.target.value)}
              className="rounded-lg border border-mystic/20 bg-elevated/70 px-2 py-1 text-[11px] text-ink"
            >
              <option value="">전체</option>
              <option value="server-start">server-start</option>
              <option value="http-reject">http-reject</option>
              <option value="join-room:reject">join-room:reject</option>
              <option value="grace-expired">grace-expired</option>
              <option value="hand-end">hand-end (정산 실패)</option>
            </select>
          </div>
          <div className="max-h-96 overflow-y-auto rounded-xl border border-mystic/20 bg-panel/85 p-2 font-mono text-[10px] leading-relaxed">
            {events.map(event => (
              <div key={event.id} className="border-b border-white/5 py-1">
                <span className="text-ink-dim">{new Date(event.at).toLocaleString('ko-KR')}</span>{' '}
                <span className="font-bold text-cyber">{event.type}</span>{' '}
                {event.roomId && <span className="text-ink-dim">room={event.roomId}</span>}{' '}
                {event.playerId && <span className="text-ink-dim">player={event.playerId}</span>}{' '}
                <span className="break-all text-ink">{JSON.stringify(event.data)}</span>
              </div>
            ))}
            {events.length === 0 && <div className="py-2 text-ink-dim">이벤트 없음</div>}
          </div>
        </section>
      </div>
    </main>
  );
}
