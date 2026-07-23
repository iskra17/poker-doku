'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 운영 백오피스 — DEBUG_LOG_TOKEN 토큰 게이트, 5초 주기 자동 갱신.
 * 상용 포커룸 백오피스(대시보드/테이블/플레이어/핸드 감사/CS/이벤트/인테그리티) 구조를
 * 단일 운영자 규모로 축소한 탭 레이아웃.
 * 서버 API: /api/admin/{overview,profiles,events,hands,security} + /api/debug/feedback.
 * 개인정보 없음 — 익명 별명/활동 지표/칩 현황만 다룬다.
 * 핸드 상세는 마스킹 전 정본(전체 홀카드) — 이 화면 밖으로 재공유 금지.
 */

const REFRESH_MS = 5_000;
const TOKEN_STORAGE_KEY = 'poker-doku-admin-token';
const FEEDBACK_SEEN_KEY = 'poker-doku-admin-feedback-seen';

// ---------- 서버 응답 타입 ----------

interface AdminSeat {
  seatIndex: number;
  name: string;
  type: string;
  chips: number;
  status: string;
  currentBet: number;
  sitOutNext: boolean;
  disconnected: boolean;
  pendingRemoval: boolean;
}

interface AdminRoom {
  id: string; name: string; mode: string; tableType: string; economyMode: string;
  handNumber: number; handInProgress: boolean; street: string | null;
  humans: number; bots: number; sittingOut: number; disconnected: number;
  potTotal: number; blinds: string; seats: AdminSeat[];
}

interface Overview {
  at: number;
  uptimeMs: number;
  memoryRssMb: number;
  sessions: { sessions: number; sockets: number; grace: number } | null;
  rooms: AdminRoom[];
  roomRuntime: Record<string, number> | null;
  eventLog: { total: number; oldest: number | null; newest: number | null };
  db: {
    profiles: number; feedback: number; handHistory: number;
    tableHands: number; opsEvents: number;
  };
  latestFeedbackId: number;
  handStats24h: { hands: number; rake: number; potTotal: number };
  retention?: {
    daily: Array<{ day: string; actives: number; hands: number }>;
    cohorts: Array<{ day: string; cohortSize: number; returnedD1: number; returnedW1: number }>;
    activation: { totalProfiles: number; playedOneHand: number; playedTenHands: number };
  };
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

interface FeedbackItem {
  id: number;
  alias: string;
  category: 'bug' | 'idea' | 'other';
  message: string;
  createdAt: number;
}

interface CardData { suit: 'hearts' | 'diamonds' | 'clubs' | 'spades'; rank: string }

interface TableHandSummary {
  id: number;
  roomId: string;
  roomName: string;
  gameMode: string;
  handNumber: number;
  bigBlind: number;
  potTotal: number;
  rake: number;
  showdown: boolean;
  playerCount: number;
  humanCount: number;
  board: CardData[];
  winners: Array<{ playerId: string; name: string; amount: number }>;
  playedAt: number;
}

interface ProfileHandSummary {
  id: number;
  playedAt: number;
  roomName: string;
  gameMode: string;
  bigBlind: number;
  handNumber: number;
  profit: number;
  heroCards: CardData[];
  board: CardData[];
  tableHandId: number | null;
}

interface HandDetailPlayer {
  id: string; name: string; type: string; seatIndex: number; position: string;
  startingChips: number; holeCards: CardData[] | null; totalContributed: number;
  won: number; profit: number; revealed: boolean; finalStatus: string;
  handDescription: string | null;
}

interface TableHandDetail {
  id: number;
  roomId: string;
  roomName: string;
  gameMode: string;
  playedAt: number;
  handNumber: number;
  smallBlind: number;
  bigBlind: number;
  players: HandDetailPlayer[];
  actions: Array<{ street: string; playerId: string; kind: string; amount: number }>;
  board: CardData[];
  winners: Array<{
    playerId: string; amount: number; handDescription: string | null; potIndex: number;
  }>;
  potTotal: number;
  rake: number;
  showdown: boolean;
}

interface SecuritySummary {
  windowHours: number;
  counts: Record<string, number>;
}

// MTT 토너먼트 탭 — /api/admin/tournaments (Phase 2)
interface AdminTournamentTable {
  roomId: string; no: number; players: number; humans: number; alive: number;
  handInProgress: boolean; held: string | null;
}

interface AdminTournamentStanding {
  playerId: string; name: string; chips: number; tableNo: number | null;
  place: number | null; prize: number;
}

interface AdminTournament {
  id: string; name: string; phase: string; speed: string; hostId: string;
  createdAt: number; startedAt: number | null; finishedAt: number | null;
  paused: boolean; level: number; onBreak: boolean; h4hActive: boolean;
  economyMode: 'practice' | 'wallet';
  entrantCount: number; seatedCount: number; remaining: number; prizePool: number;
  tables: AdminTournamentTable[]; standings: AdminTournamentStanding[];
}

// 런타임 게임 설정 (핫 컨피그) — 메타는 서버 레지스트리가 단일 소스, UI는 렌더만
interface GameConfigEntryView {
  key: string;
  label: string;
  group: string;
  min: number;
  max: number;
  unit?: string;
  applyMode: 'immediate' | 'next-hand' | 'new-room';
  description?: string;
  warning?: string;
  effectiveDefault: number;
  value: number;
  overridden: boolean;
  updatedAt: number | null;
}

interface GameConfigResponse {
  groupLabels: Record<string, string>;
  entries: GameConfigEntryView[];
}

interface GameConfigSaveResult {
  ok: boolean;
  message: string;
  errors?: Array<{ key: string; message: string }>;
}

/** 게임 설정 변경 이력 — config-change 감사 이벤트(ops_event)를 그대로 조회 */
const CONFIG_HISTORY_PATH = '/api/admin/events?limit=50&type=config-change';

// ---------- 표시 헬퍼 ----------

const TABS = [
  { key: 'dashboard', label: '대시보드' },
  { key: 'tables', label: '테이블' },
  { key: 'tournaments', label: '토너먼트' },
  { key: 'players', label: '플레이어' },
  { key: 'hands', label: '핸드' },
  { key: 'config', label: '게임 설정' },
  { key: 'feedback', label: '문의/리포트' },
  { key: 'events', label: '이벤트' },
  { key: 'security', label: '보안·공정성' },
] as const;
type TabKey = typeof TABS[number]['key'];

const SUIT_SYMBOL: Record<CardData['suit'], string> = {
  hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠',
};
const SUIT_CLASS: Record<CardData['suit'], string> = {
  hearts: 'text-suit-red',
  diamonds: 'text-suit-blue',
  clubs: 'text-suit-green',
  spades: 'text-ink',
};

const ACTION_LABEL: Record<string, string> = {
  'post-sb': 'SB', 'post-bb': 'BB', fold: '폴드', check: '체크',
  call: '콜', raise: '레이즈', 'all-in': '올인',
};

const STREET_LABEL: Record<string, string> = {
  preflop: '프리플랍', flop: '플랍', turn: '턴', river: '리버', showdown: '쇼다운',
};

const STATUS_LABEL: Record<string, string> = {
  waiting: '대기', active: '액티브', folded: '폴드',
  'all-in': '올인', 'sitting-out': '자리비움',
};

/** 보안 탭 신호 설명 — ops_event 화이트리스트와 동일한 축 */
const SECURITY_SIGNALS: Array<{ type: string; label: string; hint: string }> = [
  { type: 'http-reject', label: 'HTTP 거절 (429 등)', hint: '레이트리밋/KDF 게이트 거절 — 급증 시 부하 또는 무차별 대입 신호' },
  { type: 'join-room:reject', label: '입장 거부', hint: '만석/비밀번호 오류/검증 실패 — 특정 IP 반복이면 어뷰징 의심' },
  { type: 'grace-expired', label: '재접속 유예 만료', hint: '연결 품질 이상 또는 이탈 급증 관측' },
  { type: 'hand-end', label: '정산 실패 핸드', hint: '팟 불변식/DB 정산 오류 — 0이어야 정상. 발생 시 즉시 조사' },
  { type: 'room-lost', label: '방 소실 통지', hint: '서버 재시작·좌석 회수로 클라이언트를 로비로 복귀시킨 횟수' },
  { type: 'server-start', label: '서버 시작', hint: '재시작/배포 마커 — 의도치 않은 재시작이 있는지 확인' },
];

/** 공정성/서버 방어 아키텍처 체크리스트 — 코드로 강제되는 계약의 요약 (변경 시 함께 갱신) */
const INTEGRITY_CHECKLIST: Array<{ title: string; body: string }> = [
  {
    title: 'CSPRNG 셔플',
    body: '덱 셔플은 crypto.getRandomValues + rejection sampling 기반 Fisher-Yates. 시드 추측이 가능한 Math.random은 딜링 경로에서 금지 (deck.ts).',
  },
  {
    title: '서버 권위 상태',
    body: '게임 상태는 서버 PokerEngine만 소유. 클라이언트는 수신 전용이라 클라이언트가 해킹돼도 카드·팟을 조작할 수 없다. 액션은 서버가 computeValidActions로 재검증.',
  },
  {
    title: '홀카드 마스킹',
    body: '타인 홀카드는 쇼다운 경합/올인 런아웃 공개(revealed)만 전송. 폴드 승리 패는 절대 노출 안 됨 — 클라이언트 메모리를 뒤져도 상대 카드가 없다.',
  },
  {
    title: '팟 불변식',
    body: 'sum(pots) === sum(totalContributed)를 핸드 종료마다 검증하고 위반은 hand-end 이벤트로 영속. 칩 복제/증발을 즉시 탐지.',
  },
  {
    title: '입력 경계 방어',
    body: '모든 소켓 이벤트는 payload arity/타입 정규화 후 소유권 검증 → 레이트리밋(액션 12회/2초 등). Origin 가드 + IP 키(XFF 마지막 홉)로 위조 우회 차단.',
  },
  {
    title: '핸드 감사 체계',
    body: '핸드마다 전역 핸드 ID를 부여한 정본 기록(table_hand, UPDATE 금지 트리거)을 영속. 분쟁·콜루전 조사는 이 ID 기준. 정본 열람은 이 백오피스뿐.',
  },
];

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

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString('ko-KR', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

function CardsInline({ cards }: { cards: CardData[] | null }) {
  if (!cards || cards.length === 0) return <span className="text-ink-dim">—</span>;
  return (
    <span className="inline-flex gap-1">
      {cards.map((card, index) => (
        <span key={index} className={`font-bold tabular ${SUIT_CLASS[card.suit]}`}>
          {card.rank}{SUIT_SYMBOL[card.suit]}
        </span>
      ))}
    </span>
  );
}

function Amount({ value, signed = false }: { value: number; signed?: boolean }) {
  const color = !signed ? 'text-gilded' : value > 0 ? 'text-green-400' : value < 0 ? 'text-blossom' : 'text-ink-dim';
  const prefix = signed && value > 0 ? '+' : '';
  return <span className={`tabular ${color}`}>{prefix}{value.toLocaleString()}</span>;
}

function SectionBox({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-mystic/20 bg-panel/85 ${className}`}>
      {children}
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 whitespace-nowrap">{children}</th>;
}

// ---------- 메인 ----------

export default function AdminPage() {
  // 저장된 토큰은 렌더 초기값으로 복원 (effect 내 setState 금지 규칙 — page.tsx 초대 링크와 동일 패턴)
  const [token, setToken] = useState(() => (
    typeof window === 'undefined' ? '' : window.localStorage.getItem(TOKEN_STORAGE_KEY) ?? ''
  ));
  const [tokenInput, setTokenInput] = useState(() => (
    typeof window === 'undefined' ? '' : window.localStorage.getItem(TOKEN_STORAGE_KEY) ?? ''
  ));
  const [seenFeedbackId, setSeenFeedbackId] = useState(() => {
    if (typeof window === 'undefined') return 0;
    return parseInt(window.localStorage.getItem(FEEDBACK_SEEN_KEY) ?? '0', 10) || 0;
  });
  const [authFailed, setAuthFailed] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>('dashboard');
  const [overview, setOverview] = useState<Overview | null>(null);
  const [profiles, setProfiles] = useState<AdminProfile[]>([]);
  const [events, setEvents] = useState<OpsEvent[]>([]);
  const [feedback, setFeedback] = useState<FeedbackItem[]>([]);
  const [hands, setHands] = useState<TableHandSummary[]>([]);
  const [adminTournaments, setAdminTournaments] = useState<AdminTournament[]>([]);
  const [handDetail, setHandDetail] = useState<TableHandDetail | null>(null);
  const [security, setSecurity] = useState<SecuritySummary | null>(null);
  const [gameConfig, setGameConfig] = useState<GameConfigResponse | null>(null);
  const [configHistory, setConfigHistory] = useState<OpsEvent[]>([]);
  const [expandedRoomId, setExpandedRoomId] = useState<string | null>(null);
  const [expandedProfileId, setExpandedProfileId] = useState<string | null>(null);
  const [profileHands, setProfileHands] = useState<Record<string, ProfileHandSummary[]>>({});
  const [eventType, setEventType] = useState('');
  const [feedbackCategory, setFeedbackCategory] = useState('');
  const [handRoomFilter, setHandRoomFilter] = useState('');
  const [lastError, setLastError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  // 커서 페이지네이션 중(더 보기 사용)에는 폴링이 목록을 되감지 않게 한다
  const handsPagedRef = useRef(false);

  const api = useCallback(async <T,>(path: string): Promise<T | null> => {
    const joiner = path.includes('?') ? '&' : '?';
    const response = await fetch(`${path}${joiner}token=${encodeURIComponent(token)}`);
    if (response.status === 403) {
      setAuthFailed(true);
      return null;
    }
    if (!response.ok) return null;
    return await response.json() as T;
  }, [token]);

  const apiPost = useCallback(async <T,>(
    path: string,
    body: unknown,
  ): Promise<{ status: number; body: T | null }> => {
    const joiner = path.includes('?') ? '&' : '?';
    const response = await fetch(`${path}${joiner}token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (response.status === 403) {
      setAuthFailed(true);
      return { status: 403, body: null };
    }
    let parsed: T | null = null;
    try {
      parsed = await response.json() as T;
    } catch {
      parsed = null;
    }
    return { status: response.status, body: parsed };
  }, [token]);

  const refresh = useCallback(async () => {
    if (!token) return;
    try {
      const overviewBody = await api<Overview>('/api/admin/overview');
      if (overviewBody) {
        setAuthFailed(false);
        setOverview(overviewBody);
      }

      if (activeTab === 'players' || activeTab === 'dashboard') {
        const body = await api<{ profiles: AdminProfile[] }>('/api/admin/profiles?limit=100');
        if (body) setProfiles(body.profiles ?? []);
      }
      if (activeTab === 'events' || activeTab === 'dashboard') {
        const typeFilter = eventType ? `&type=${encodeURIComponent(eventType)}` : '';
        const body = await api<{ events: OpsEvent[] }>(`/api/admin/events?limit=100${typeFilter}`);
        if (body) setEvents(body.events ?? []);
      }
      if (activeTab === 'feedback') {
        const body = await api<{ items: FeedbackItem[] }>('/api/debug/feedback?limit=100');
        if (body) {
          setFeedback(body.items ?? []);
          // 문의 탭을 보고 있는 동안은 전부 읽음 처리 (feedback id는 단조 증가·미삭제)
          const latest = overviewBody?.latestFeedbackId ?? body.items?.[0]?.id ?? 0;
          if (latest > 0) {
            setSeenFeedbackId(prev => {
              const next = Math.max(prev, latest);
              window.localStorage.setItem(FEEDBACK_SEEN_KEY, String(next));
              return next;
            });
          }
        }
      }
      if (activeTab === 'tournaments') {
        const body = await api<{ tournaments: AdminTournament[] }>('/api/admin/tournaments');
        if (body) setAdminTournaments(body.tournaments ?? []);
      }
      if (activeTab === 'hands' && !handsPagedRef.current) {
        const roomFilter = handRoomFilter ? `&room=${encodeURIComponent(handRoomFilter)}` : '';
        const body = await api<{ hands: TableHandSummary[] }>(`/api/admin/hands?limit=50${roomFilter}`);
        if (body) setHands(body.hands ?? []);
      }
      if (activeTab === 'security') {
        const body = await api<SecuritySummary>('/api/admin/security?hours=24');
        if (body) setSecurity(body);
      }
      if (activeTab === 'config') {
        const body = await api<GameConfigResponse>('/api/admin/config');
        if (body) setGameConfig(body);
        const historyBody = await api<{ events: OpsEvent[] }>(CONFIG_HISTORY_PATH);
        if (historyBody) setConfigHistory(historyBody.events ?? []);
      }
      setLastError(null);
      setUpdatedAt(Date.now());
    } catch {
      setLastError('서버에 연결하지 못했어요');
    }
  }, [token, activeTab, eventType, handRoomFilter, api]);

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

  const newFeedbackCount = Math.max(0, (overview?.latestFeedbackId ?? 0) - seenFeedbackId);

  useEffect(() => {
    // 새 문의 알림 — 브라우저 탭 제목으로도 보이게 한다 (다른 탭 작업 중 인지용)
    document.title = newFeedbackCount > 0
      ? `(${newFeedbackCount}) 운영 백오피스`
      : '운영 백오피스';
  }, [newFeedbackCount]);

  const loadMoreHands = async () => {
    const last = hands[hands.length - 1];
    if (!last) return;
    const roomFilter = handRoomFilter ? `&room=${encodeURIComponent(handRoomFilter)}` : '';
    const body = await api<{ hands: TableHandSummary[] }>(
      `/api/admin/hands?limit=50&before=${last.id}${roomFilter}`,
    );
    if (body && body.hands.length > 0) {
      handsPagedRef.current = true;
      setHands(prev => [...prev, ...body.hands]);
    }
  };

  const openHandDetail = async (handId: number) => {
    const body = await api<{ hand: TableHandDetail }>(`/api/admin/hands/${handId}`);
    if (body) setHandDetail(body.hand);
  };

  const toggleProfileHands = async (profileId: string) => {
    if (expandedProfileId === profileId) {
      setExpandedProfileId(null);
      return;
    }
    setExpandedProfileId(profileId);
    if (!profileHands[profileId]) {
      const body = await api<{ hands: ProfileHandSummary[] }>(
        `/api/admin/hands?profile=${encodeURIComponent(profileId)}&limit=20`,
      );
      if (body) setProfileHands(prev => ({ ...prev, [profileId]: body.hands ?? [] }));
    }
  };

  const jumpToHand = (tableHandId: number) => {
    setActiveTab('hands');
    void openHandDetail(tableHandId);
  };

  const saveGameConfig = async (
    updates: Record<string, number | null>,
  ): Promise<GameConfigSaveResult> => {
    const { status, body } = await apiPost<{
      changes?: Array<{ key: string; from: number; to: number }>;
      errors?: Array<{ key: string; message: string }>;
      message?: string;
    }>('/api/admin/config', { updates });
    if (status === 200 && body) {
      const [refreshed, historyBody] = await Promise.all([
        api<GameConfigResponse>('/api/admin/config'),
        api<{ events: OpsEvent[] }>(CONFIG_HISTORY_PATH),
      ]);
      if (refreshed) setGameConfig(refreshed);
      if (historyBody) setConfigHistory(historyBody.events ?? []);
      const changes = body.changes ?? [];
      if (changes.length === 0) return { ok: true, message: '변경된 값이 없어요.' };
      const labelOf = (key: string) =>
        gameConfig?.entries.find(entry => entry.key === key)?.label ?? key;
      return {
        ok: true,
        message: `저장됨 — ${changes
          .map(change => `${labelOf(change.key)} ${change.from.toLocaleString()} → ${change.to.toLocaleString()}`)
          .join(' · ')}`,
      };
    }
    if (status === 400 && body?.errors) {
      return { ok: false, message: '저장 실패 — 입력값을 확인해주세요.', errors: body.errors };
    }
    if (status === 400) {
      return { ok: false, message: body?.message ?? '요청 형식이 올바르지 않아요.' };
    }
    return { ok: false, message: '저장에 실패했어요. 잠시 후 다시 시도해주세요.' };
  };

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

  const filteredFeedback = feedbackCategory
    ? feedback.filter(item => item.category === feedbackCategory)
    : feedback;

  return (
    // body가 overflow:hidden + fixed(게임 앱 전제)라 main을 h-dvh 스크롤 컨테이너로 만든다 —
    // min-h-dvh면 내용이 뷰포트를 넘어도 스크롤이 생기지 않는다 (게임 설정 탭에서 발견)
    <main className="h-dvh overflow-y-auto bg-abyss p-4 text-ink">
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-bold text-mystic">운영 백오피스</h1>
            {newFeedbackCount > 0 && activeTab !== 'feedback' && (
              <button
                type="button"
                onClick={() => setActiveTab('feedback')}
                className="rounded-full border border-blossom/50 bg-blossom/20 px-2.5 py-0.5 text-[11px] font-bold text-blossom hover:bg-blossom/30"
              >
                🔔 새 문의 {newFeedbackCount}건
              </button>
            )}
          </div>
          <div className="text-[11px] text-ink-dim">
            {lastError
              ? <span className="text-blossom">{lastError}</span>
              : `${REFRESH_MS / 1000}초마다 갱신 · 마지막 ${timeAgo(updatedAt)}`}
          </div>
        </header>

        <nav className="flex flex-wrap gap-1 rounded-xl border border-mystic/20 bg-panel/85 p-1">
          {TABS.map(tab => (
            <button
              key={tab.key}
              type="button"
              onClick={() => {
                setActiveTab(tab.key);
                if (tab.key === 'hands') handsPagedRef.current = false;
              }}
              className={`relative rounded-lg px-3 py-1.5 text-xs font-bold transition-colors ${
                activeTab === tab.key
                  ? 'bg-mystic/25 text-mystic'
                  : 'text-ink-dim hover:bg-white/5 hover:text-ink'
              }`}
            >
              {tab.label}
              {tab.key === 'feedback' && newFeedbackCount > 0 && (
                <span className="ml-1 rounded-full bg-blossom px-1.5 text-[10px] font-bold text-white">
                  {newFeedbackCount}
                </span>
              )}
            </button>
          ))}
        </nav>

        {activeTab === 'dashboard' && (
          <DashboardTab overview={overview} profiles={profiles} events={events} />
        )}
        {activeTab === 'tables' && (
          <TablesTab
            rooms={overview?.rooms ?? []}
            expandedRoomId={expandedRoomId}
            onToggle={id => setExpandedRoomId(prev => (prev === id ? null : id))}
          />
        )}
        {activeTab === 'tournaments' && (
          <TournamentsTab tournaments={adminTournaments} />
        )}
        {activeTab === 'players' && (
          <PlayersTab
            profiles={profiles}
            expandedProfileId={expandedProfileId}
            profileHands={profileHands}
            onToggle={id => void toggleProfileHands(id)}
            onJumpToHand={jumpToHand}
          />
        )}
        {activeTab === 'hands' && (
          <HandsTab
            hands={hands}
            rooms={overview?.rooms ?? []}
            roomFilter={handRoomFilter}
            onRoomFilterChange={value => {
              handsPagedRef.current = false;
              setHands([]);
              setHandRoomFilter(value);
            }}
            detail={handDetail}
            onOpenDetail={id => void openHandDetail(id)}
            onLoadMore={() => void loadMoreHands()}
            stats24h={overview?.handStats24h ?? null}
          />
        )}
        {activeTab === 'config' && (
          <ConfigTab config={gameConfig} history={configHistory} onSave={saveGameConfig} />
        )}
        {activeTab === 'feedback' && (
          <FeedbackTab
            items={filteredFeedback}
            total={feedback.length}
            category={feedbackCategory}
            onCategoryChange={setFeedbackCategory}
          />
        )}
        {activeTab === 'events' && (
          <EventsTab events={events} eventType={eventType} onEventTypeChange={setEventType} />
        )}
        {activeTab === 'security' && (
          <SecurityTab security={security} />
        )}
      </div>
    </main>
  );
}

// ---------- 대시보드 ----------

function DashboardTab({ overview, profiles, events }: {
  overview: Overview | null;
  profiles: AdminProfile[];
  events: OpsEvent[];
}) {
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
  const stats = overview?.handStats24h;
  const onlineCount = profiles.filter(profile => profile.online).length;
  const signalEvents = events.slice(0, 6);

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-4 gap-2 md:grid-cols-8">
        {cards.map(([label, value]) => (
          <div key={label} className="rounded-xl border border-mystic/20 bg-panel/85 p-3 text-center">
            <div className="text-lg font-bold text-gilded tabular">{value}</div>
            <div className="text-[10px] text-ink-dim">{label}</div>
          </div>
        ))}
      </section>

      <section className="grid grid-cols-2 gap-2 md:grid-cols-4">
        <div className="rounded-xl border border-cyber/25 bg-panel/85 p-3 text-center">
          <div className="text-lg font-bold text-cyber tabular">{stats?.hands.toLocaleString() ?? '—'}</div>
          <div className="text-[10px] text-ink-dim">24h 핸드 수</div>
        </div>
        <div className="rounded-xl border border-cyber/25 bg-panel/85 p-3 text-center">
          <div className="text-lg font-bold text-cyber tabular">{stats?.rake.toLocaleString() ?? '—'}</div>
          <div className="text-[10px] text-ink-dim">24h 레이크</div>
        </div>
        <div className="rounded-xl border border-cyber/25 bg-panel/85 p-3 text-center">
          <div className="text-lg font-bold text-cyber tabular">{stats?.potTotal.toLocaleString() ?? '—'}</div>
          <div className="text-[10px] text-ink-dim">24h 팟 총액</div>
        </div>
        <div className="rounded-xl border border-cyber/25 bg-panel/85 p-3 text-center">
          <div className="text-lg font-bold text-cyber tabular">{onlineCount}</div>
          <div className="text-[10px] text-ink-dim">접속 중 프로필</div>
        </div>
      </section>

      {/* same-install 리텐션 — 익명 로컬 프로필이라 사람 단위가 아닌 동일 설치본 기준 (레드팀 명명) */}
      {overview?.retention && (
        <section className="grid gap-2 md:grid-cols-2">
          <SectionBox className="p-3">
            <h2 className="mb-2 text-xs font-bold text-blossom">
              일일 활성 (14일, same-install)
              <span className="ml-2 font-normal text-ink-dim">
                활성화: 1핸드+ {overview.retention.activation.playedOneHand}
                /{overview.retention.activation.totalProfiles} ·
                10핸드+ {overview.retention.activation.playedTenHands}
              </span>
            </h2>
            <div className="space-y-0.5 font-mono text-[10px] leading-relaxed">
              {overview.retention.daily.length === 0 && <div className="text-ink-dim">기록 없음</div>}
              {overview.retention.daily.map(row => (
                <div key={row.day} className="flex justify-between">
                  <span className="text-ink-dim">{row.day}</span>
                  <span className="tabular">활성 {row.actives} · 핸드 {row.hands.toLocaleString()}</span>
                </div>
              ))}
            </div>
          </SectionBox>
          <SectionBox className="p-3">
            <h2 className="mb-2 text-xs font-bold text-blossom">신규 코호트 D1 / W1 복귀</h2>
            <div className="space-y-0.5 font-mono text-[10px] leading-relaxed">
              {overview.retention.cohorts.length === 0 && <div className="text-ink-dim">신규 프로필 없음</div>}
              {overview.retention.cohorts.map(row => (
                <div key={row.day} className="flex justify-between">
                  <span className="text-ink-dim">{row.day} (n={row.cohortSize})</span>
                  <span className="tabular">
                    D1 {row.cohortSize ? Math.round(row.returnedD1 / row.cohortSize * 100) : 0}% ·
                    W1 {row.cohortSize ? Math.round(row.returnedW1 / row.cohortSize * 100) : 0}%
                  </span>
                </div>
              ))}
            </div>
          </SectionBox>
        </section>
      )}

      <section className="grid gap-2 md:grid-cols-2">
        <SectionBox className="p-3">
          <h2 className="mb-2 text-xs font-bold text-blossom">DB 누적</h2>
          <div className="grid grid-cols-2 gap-y-1 text-xs">
            <span className="text-ink-dim">정본 핸드 (table_hand)</span>
            <span className="tabular text-right">{overview?.db.tableHands.toLocaleString() ?? '—'}</span>
            <span className="text-ink-dim">개인 핸드 기록</span>
            <span className="tabular text-right">{overview?.db.handHistory.toLocaleString() ?? '—'}</span>
            <span className="text-ink-dim">문의/건의</span>
            <span className="tabular text-right">{overview?.db.feedback.toLocaleString() ?? '—'}</span>
            <span className="text-ink-dim">운영 이벤트</span>
            <span className="tabular text-right">{overview?.db.opsEvents.toLocaleString() ?? '—'}</span>
          </div>
        </SectionBox>
        <SectionBox className="p-3">
          <h2 className="mb-2 text-xs font-bold text-blossom">최근 신호 이벤트</h2>
          {signalEvents.length === 0 && <div className="text-xs text-ink-dim">이벤트 없음</div>}
          <div className="space-y-1 font-mono text-[10px] leading-relaxed">
            {signalEvents.map(event => (
              <div key={event.id} className="truncate">
                <span className="text-ink-dim">{fmtTime(event.at)}</span>{' '}
                <span className="font-bold text-cyber">{event.type}</span>{' '}
                {event.roomId && <span className="text-ink-dim">{event.roomId}</span>}
              </div>
            ))}
          </div>
        </SectionBox>
      </section>
    </div>
  );
}

// ---------- 테이블 ----------

function TablesTab({ rooms, expandedRoomId, onToggle }: {
  rooms: AdminRoom[];
  expandedRoomId: string | null;
  onToggle: (id: string) => void;
}) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-bold text-blossom">방 ({rooms.length}) — 행을 누르면 좌석 상세</h2>
      <SectionBox className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[10px] text-ink-dim">
            <tr>
              {['이름', '모드', '구성', '경제', '블라인드', '핸드', '스트리트', '휴먼', '봇', '자리비움', '오프라인', '팟'].map(h => (
                <Th key={h}>{h}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rooms.map(room => (
              <RoomRows
                key={room.id}
                room={room}
                expanded={expandedRoomId === room.id}
                onToggle={() => onToggle(room.id)}
              />
            ))}
            {rooms.length === 0 && (
              <tr><td className="px-3 py-3 text-ink-dim" colSpan={12}>방 없음</td></tr>
            )}
          </tbody>
        </table>
      </SectionBox>
    </section>
  );
}

function RoomRows({ room, expanded, onToggle }: {
  room: AdminRoom;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="cursor-pointer border-t border-white/5 hover:bg-white/5"
        onClick={onToggle}
      >
        <td className="px-3 py-2 font-bold">{expanded ? '▾ ' : '▸ '}{room.name}</td>
        <td className="px-3 py-2">{room.mode}</td>
        <td className="px-3 py-2">{room.tableType}</td>
        <td className="px-3 py-2">{room.economyMode}</td>
        <td className="px-3 py-2 tabular">{room.blinds}</td>
        <td className="px-3 py-2 tabular">
          #{room.handNumber}{room.handInProgress ? ' ▶' : ''}
        </td>
        <td className="px-3 py-2">{room.street ? STREET_LABEL[room.street] ?? room.street : '—'}</td>
        <td className="px-3 py-2 tabular">{room.humans}</td>
        <td className="px-3 py-2 tabular">{room.bots}</td>
        <td className="px-3 py-2 tabular">{room.sittingOut}</td>
        <td className="px-3 py-2 tabular">{room.disconnected}</td>
        <td className="px-3 py-2 tabular">{room.potTotal.toLocaleString()}</td>
      </tr>
      {expanded && (
        <tr className="border-t border-white/5 bg-black/20">
          <td colSpan={12} className="px-3 py-2">
            <div className="mb-1 text-[10px] font-bold text-ink-dim">
              좌석 ({room.seats.length}) — room id: {room.id}
            </div>
            <table className="w-full text-left text-[11px]">
              <thead className="text-[10px] text-ink-dim">
                <tr>
                  {['좌석', '이름', '타입', '칩', '현재 벳', '상태', '플래그'].map(h => (
                    <Th key={h}>{h}</Th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {room.seats.map(seat => (
                  <tr key={seat.seatIndex} className="border-t border-white/5">
                    <td className="px-3 py-1 tabular">{seat.seatIndex}</td>
                    <td className="px-3 py-1 font-bold">{seat.name}</td>
                    <td className="px-3 py-1">
                      {seat.type === 'bot'
                        ? <span className="rounded bg-white/10 px-1 text-[9px] font-bold text-ink-dim">BOT</span>
                        : <span className="rounded bg-cyber/20 px-1 text-[9px] font-bold text-cyber">휴먼</span>}
                    </td>
                    <td className="px-3 py-1"><Amount value={seat.chips} /></td>
                    <td className="px-3 py-1 tabular">{seat.currentBet.toLocaleString()}</td>
                    <td className="px-3 py-1">{STATUS_LABEL[seat.status] ?? seat.status}</td>
                    <td className="px-3 py-1 text-[10px] text-ink-dim">
                      {[
                        seat.sitOutNext && '자리비움 예약',
                        seat.disconnected && '연결 끊김',
                        seat.pendingRemoval && '제거 대기',
                      ].filter(Boolean).join(' · ') || '—'}
                    </td>
                  </tr>
                ))}
                {room.seats.length === 0 && (
                  <tr><td className="px-3 py-2 text-ink-dim" colSpan={7}>좌석 없음</td></tr>
                )}
              </tbody>
            </table>
          </td>
        </tr>
      )}
    </>
  );
}

// ---------- 토너먼트 (MTT) ----------

const MTT_PHASE_LABEL: Record<string, string> = {
  registering: '등록 중', running: '진행 중', completed: '종료', cancelled: '취소됨',
};

function TournamentsTab({ tournaments }: { tournaments: AdminTournament[] }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-bold text-blossom">
        토너먼트 ({tournaments.length}) — 상태·테이블·스탠딩, 개입 이력은 이벤트 탭 mtt-* 필터
      </h2>
      {tournaments.length === 0 && (
        <SectionBox className="p-4 text-xs text-ink-dim">열려 있는 토너먼트 없음</SectionBox>
      )}
      {tournaments.map(t => (
        <SectionBox key={t.id} className="p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-bold text-ink">{t.name}</span>
            <span className="rounded bg-white/10 px-1.5 py-0.5">{MTT_PHASE_LABEL[t.phase] ?? t.phase}</span>
            <span className="text-ink-dim">{t.speed} · Lv.{t.level}</span>
            {t.economyMode === 'wallet' && (
              <span className="rounded bg-gilded/20 px-1.5 py-0.5 font-bold text-gilded">💰 wallet</span>
            )}
            {t.paused && <span className="rounded bg-blossom/20 px-1.5 py-0.5 font-bold text-blossom">⏸ 일시정지</span>}
            {t.onBreak && <span className="rounded bg-cyber/20 px-1.5 py-0.5 text-cyber">☕ 브레이크</span>}
            {t.h4hActive && <span className="rounded bg-gilded/20 px-1.5 py-0.5 text-gilded">⚔️ H4H</span>}
            <span className="ml-auto text-ink-dim">
              잔존 {t.remaining}/{t.seatedCount || t.entrantCount} · 풀 <Amount value={t.prizePool} />
            </span>
          </div>
          <div className="mt-1 text-[10px] text-ink-dim">
            id {t.id} · 호스트 {t.hostId.slice(0, 12)}… · 개설 {fmtTime(t.createdAt)}
            {t.startedAt !== null && ` · 시작 ${fmtTime(t.startedAt)}`}
            {t.finishedAt !== null && ` · 종료 ${fmtTime(t.finishedAt)}`}
          </div>
          {t.tables.length > 0 && (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <thead className="text-[10px] text-ink-dim">
                  <tr>
                    {['테이블', '방 ID', '좌석', '휴먼', '생존', '진행', '보류'].map(h => <Th key={h}>{h}</Th>)}
                  </tr>
                </thead>
                <tbody>
                  {t.tables.map(table => (
                    <tr key={table.roomId} className="border-t border-white/5">
                      <td className="px-3 py-1.5 font-bold">T{table.no}</td>
                      <td className="px-3 py-1.5 text-ink-dim">{table.roomId}</td>
                      <td className="px-3 py-1.5 tabular">{table.players}</td>
                      <td className="px-3 py-1.5 tabular">{table.humans}</td>
                      <td className="px-3 py-1.5 tabular">{table.alive}</td>
                      <td className="px-3 py-1.5">{table.handInProgress ? '▶ 핸드 중' : '대기'}</td>
                      <td className="px-3 py-1.5">{table.held ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {t.standings.length > 0 && (
            <details className="mt-2">
              <summary className="cursor-pointer text-[11px] text-ink-dim hover:text-ink">
                스탠딩 전체 ({t.standings.length}명)
              </summary>
              <div className="mt-1 max-h-64 overflow-y-auto">
                <table className="w-full text-left text-[11px]">
                  <tbody>
                    {t.standings.map((row, i) => (
                      <tr key={row.playerId} className="border-t border-white/5">
                        <td className="px-3 py-1 tabular text-ink-dim">{row.place ?? i + 1}</td>
                        <td className="px-3 py-1">{row.name}</td>
                        <td className="px-3 py-1 text-right tabular">
                          {row.place !== null
                            ? row.prize > 0 ? <Amount value={row.prize} signed /> : '탈락'
                            : row.chips.toLocaleString()}
                        </td>
                        <td className="px-3 py-1 text-right text-ink-dim">
                          {row.tableNo !== null ? `T${row.tableNo}` : ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}
        </SectionBox>
      ))}
    </section>
  );
}

// ---------- 플레이어 ----------

function PlayersTab({ profiles, expandedProfileId, profileHands, onToggle, onJumpToHand }: {
  profiles: AdminProfile[];
  expandedProfileId: string | null;
  profileHands: Record<string, ProfileHandSummary[]>;
  onToggle: (id: string) => void;
  onJumpToHand: (tableHandId: number) => void;
}) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-bold text-blossom">
        프로필 (최근 활동순 {profiles.length}) — 행을 누르면 최근 핸드
      </h2>
      <SectionBox className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="text-[10px] text-ink-dim">
            <tr>
              {['별명', '상태', '방', '지갑', '에스크로', '접속 횟수', '마지막 활동', '가입'].map(h => (
                <Th key={h}>{h}</Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {profiles.map(profile => (
              <ProfileRows
                key={profile.id}
                profile={profile}
                expanded={expandedProfileId === profile.id}
                hands={profileHands[profile.id]}
                onToggle={() => onToggle(profile.id)}
                onJumpToHand={onJumpToHand}
              />
            ))}
            {profiles.length === 0 && (
              <tr><td className="px-3 py-3 text-ink-dim" colSpan={8}>프로필 없음</td></tr>
            )}
          </tbody>
        </table>
      </SectionBox>
    </section>
  );
}

function ProfileRows({ profile, expanded, hands, onToggle, onJumpToHand }: {
  profile: AdminProfile;
  expanded: boolean;
  hands: ProfileHandSummary[] | undefined;
  onToggle: () => void;
  onJumpToHand: (tableHandId: number) => void;
}) {
  return (
    <>
      <tr
        className="cursor-pointer border-t border-white/5 hover:bg-white/5"
        onClick={onToggle}
      >
        <td className="px-3 py-2 font-bold">{expanded ? '▾ ' : '▸ '}{profile.alias}</td>
        <td className="px-3 py-2">
          {profile.online
            ? <span className="text-green-400">● 접속</span>
            : profile.graceActive
              ? <span className="text-gilded">◐ 유예</span>
              : <span className="text-ink-dim">○ 오프라인</span>}
        </td>
        <td className="px-3 py-2 text-[10px] text-ink-dim">{profile.roomId ?? '—'}</td>
        <td className="px-3 py-2"><Amount value={profile.wallet.balance} /></td>
        <td className="px-3 py-2 tabular">{profile.wallet.activeEscrow.toLocaleString()}</td>
        <td className="px-3 py-2 tabular">{profile.connectCount}</td>
        <td className="px-3 py-2">{timeAgo(profile.lastSeenAt)}</td>
        <td className="px-3 py-2">{timeAgo(profile.createdAt)}</td>
      </tr>
      {expanded && (
        <tr className="border-t border-white/5 bg-black/20">
          <td colSpan={8} className="px-3 py-2">
            <div className="mb-1 text-[10px] font-bold text-ink-dim">
              최근 핸드 (히어로 관점 · 최대 20) — 핸드 ID를 누르면 정본 상세
            </div>
            {!hands && <div className="py-1 text-xs text-ink-dim">불러오는 중…</div>}
            {hands && hands.length === 0 && (
              <div className="py-1 text-xs text-ink-dim">기록 없음</div>
            )}
            {hands && hands.length > 0 && (
              <table className="w-full text-left text-[11px]">
                <thead className="text-[10px] text-ink-dim">
                  <tr>
                    {['핸드 ID', '시각', '방', 'BB', '홀카드', '보드', '손익'].map(h => (
                      <Th key={h}>{h}</Th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {hands.map(hand => (
                    <tr key={hand.id} className="border-t border-white/5">
                      <td className="px-3 py-1">
                        {hand.tableHandId
                          ? (
                            <button
                              type="button"
                              onClick={() => onJumpToHand(hand.tableHandId!)}
                              className="font-bold text-cyber underline-offset-2 hover:underline"
                            >
                              #{hand.tableHandId}
                            </button>
                          )
                          : <span className="text-ink-dim">—</span>}
                      </td>
                      <td className="px-3 py-1 text-ink-dim">{fmtTime(hand.playedAt)}</td>
                      <td className="px-3 py-1">{hand.roomName}</td>
                      <td className="px-3 py-1 tabular">{hand.bigBlind}</td>
                      <td className="px-3 py-1"><CardsInline cards={hand.heroCards} /></td>
                      <td className="px-3 py-1"><CardsInline cards={hand.board} /></td>
                      <td className="px-3 py-1"><Amount value={hand.profit} signed /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

// ---------- 핸드 감사 ----------

function HandsTab({
  hands, rooms, roomFilter, onRoomFilterChange, detail, onOpenDetail, onLoadMore, stats24h,
}: {
  hands: TableHandSummary[];
  rooms: AdminRoom[];
  roomFilter: string;
  onRoomFilterChange: (value: string) => void;
  detail: TableHandDetail | null;
  onOpenDetail: (id: number) => void;
  onLoadMore: () => void;
  stats24h: { hands: number; rake: number; potTotal: number } | null;
}) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-bold text-blossom">핸드 감사 (정본 기록)</h2>
        <select
          value={roomFilter}
          onChange={event => onRoomFilterChange(event.target.value)}
          className="rounded-lg border border-mystic/20 bg-elevated/70 px-2 py-1 text-[11px] text-ink"
        >
          <option value="">모든 방</option>
          {rooms.map(room => (
            <option key={room.id} value={room.id}>{room.name}</option>
          ))}
        </select>
        {stats24h && (
          <span className="text-[11px] text-ink-dim">
            24h: 핸드 {stats24h.hands.toLocaleString()} · 레이크 {stats24h.rake.toLocaleString()}
          </span>
        )}
        <span className="ml-auto text-[10px] text-gilded">
          ⚠ 상세에는 머킹 패까지 담긴다 — 화면 밖 재공유 금지
        </span>
      </div>

      <div className="grid gap-2 lg:grid-cols-2">
        <SectionBox className="max-h-[36rem] overflow-auto">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-panel text-[10px] text-ink-dim">
              <tr>
                {['핸드 ID', '시각', '방', '핸드#', 'BB', '인원', '팟', '레이크', '종료', '승자'].map(h => (
                  <Th key={h}>{h}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {hands.map(hand => (
                <tr
                  key={hand.id}
                  className={`cursor-pointer border-t border-white/5 hover:bg-white/5 ${
                    detail?.id === hand.id ? 'bg-mystic/15' : ''
                  }`}
                  onClick={() => onOpenDetail(hand.id)}
                >
                  <td className="px-3 py-2 font-bold text-cyber">#{hand.id}</td>
                  <td className="px-3 py-2 text-[10px] text-ink-dim">{fmtTime(hand.playedAt)}</td>
                  <td className="px-3 py-2">{hand.roomName}</td>
                  <td className="px-3 py-2 tabular">{hand.handNumber}</td>
                  <td className="px-3 py-2 tabular">{hand.bigBlind}</td>
                  <td className="px-3 py-2 tabular">{hand.playerCount}({hand.humanCount})</td>
                  <td className="px-3 py-2"><Amount value={hand.potTotal} /></td>
                  <td className="px-3 py-2 tabular">{hand.rake.toLocaleString()}</td>
                  <td className="px-3 py-2">
                    {hand.showdown
                      ? <span className="text-cyber">쇼다운</span>
                      : <span className="text-ink-dim">폴드</span>}
                  </td>
                  <td className="px-3 py-2 text-[10px]">
                    {hand.winners.map(w => w.name).join(', ')}
                  </td>
                </tr>
              ))}
              {hands.length === 0 && (
                <tr><td className="px-3 py-3 text-ink-dim" colSpan={10}>기록 없음</td></tr>
              )}
            </tbody>
          </table>
          {hands.length >= 50 && (
            <button
              type="button"
              onClick={onLoadMore}
              className="w-full border-t border-white/5 py-2 text-xs font-bold text-ink-dim hover:bg-white/5 hover:text-ink"
            >
              더 보기
            </button>
          )}
        </SectionBox>

        <SectionBox className="max-h-[36rem] overflow-auto p-3">
          {!detail && (
            <div className="py-8 text-center text-xs text-ink-dim">
              왼쪽 목록에서 핸드를 선택하면 정본 상세(전체 홀카드·액션 타임라인)가 표시됩니다.
            </div>
          )}
          {detail && <HandDetailView detail={detail} />}
        </SectionBox>
      </div>
    </section>
  );
}

function HandDetailView({ detail }: { detail: TableHandDetail }) {
  const nameOf = (playerId: string): string =>
    detail.players.find(p => p.id === playerId)?.name ?? playerId;
  const streets = ['preflop', 'flop', 'turn', 'river'] as const;
  const boardUpTo = (street: string): CardData[] => {
    if (street === 'flop') return detail.board.slice(0, 3);
    if (street === 'turn') return detail.board.slice(0, 4);
    if (street === 'river') return detail.board.slice(0, 5);
    return [];
  };

  return (
    <div className="space-y-3 text-xs">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-base font-bold text-cyber">핸드 #{detail.id}</span>
        <span className="text-ink-dim">{detail.roomName} · 핸드번호 {detail.handNumber}</span>
        <span className="tabular text-ink-dim">
          블라인드 {detail.smallBlind}/{detail.bigBlind}
        </span>
        <span className="text-ink-dim">{fmtTime(detail.playedAt)}</span>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <span>팟 <Amount value={detail.potTotal} /></span>
        <span className="tabular text-ink-dim">레이크 {detail.rake.toLocaleString()}</span>
        <span>{detail.showdown ? '쇼다운 경합' : '폴드 종료'}</span>
        <span className="inline-flex items-center gap-1">
          보드 <CardsInline cards={detail.board} />
        </span>
      </div>

      <div>
        <div className="mb-1 font-bold text-blossom">플레이어</div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-[11px]">
            <thead className="text-[10px] text-ink-dim">
              <tr>
                {['좌석', '이름', '포지션', '홀카드', '시작칩', '투입', '손익', '결과'].map(h => (
                  <Th key={h}>{h}</Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detail.players.map(player => (
                <tr key={player.id} className="border-t border-white/5">
                  <td className="px-3 py-1 tabular">{player.seatIndex}</td>
                  <td className="px-3 py-1 font-bold">
                    {player.name}
                    {player.type === 'bot' && (
                      <span className="ml-1 rounded bg-white/10 px-1 text-[9px] text-ink-dim">BOT</span>
                    )}
                  </td>
                  <td className="px-3 py-1">{player.position}</td>
                  <td className="px-3 py-1">
                    <CardsInline cards={player.holeCards} />
                    {player.revealed && <span className="ml-1 text-[9px] text-cyber">공개</span>}
                  </td>
                  <td className="px-3 py-1 tabular">{player.startingChips.toLocaleString()}</td>
                  <td className="px-3 py-1 tabular">{player.totalContributed.toLocaleString()}</td>
                  <td className="px-3 py-1"><Amount value={player.profit} signed /></td>
                  <td className="px-3 py-1 text-[10px]">
                    {STATUS_LABEL[player.finalStatus] ?? player.finalStatus}
                    {player.handDescription ? ` · ${player.handDescription}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div>
        <div className="mb-1 font-bold text-blossom">액션 타임라인</div>
        {streets.map(street => {
          const actions = detail.actions.filter(action => action.street === street);
          if (actions.length === 0) return null;
          const streetBoard = boardUpTo(street);
          return (
            <div key={street} className="mb-2">
              <div className="mb-0.5 flex items-center gap-2 text-[10px] font-bold text-ink-dim">
                {STREET_LABEL[street]}
                {streetBoard.length > 0 && <CardsInline cards={streetBoard} />}
              </div>
              <div className="space-y-0.5">
                {actions.map((action, index) => (
                  <div key={index} className="flex items-center gap-2 text-[11px]">
                    <span className="min-w-24 font-bold">{nameOf(action.playerId)}</span>
                    <span className={
                      action.kind === 'fold' ? 'text-ink-dim'
                        : action.kind === 'all-in' ? 'font-bold text-blossom'
                          : action.kind === 'raise' ? 'text-gilded'
                            : 'text-ink'
                    }>
                      {ACTION_LABEL[action.kind] ?? action.kind}
                    </span>
                    {action.amount > 0 && (
                      <span className="tabular text-ink-dim">{action.amount.toLocaleString()}</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div>
        <div className="mb-1 font-bold text-blossom">승자</div>
        {detail.winners.map((winner, index) => (
          <div key={index} className="flex items-center gap-2 text-[11px]">
            <span className="font-bold">{nameOf(winner.playerId)}</span>
            <Amount value={winner.amount} />
            {winner.handDescription && <span className="text-ink-dim">{winner.handDescription}</span>}
            {winner.potIndex > 0 && (
              <span className="text-[9px] text-ink-dim">사이드팟 {winner.potIndex}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- 문의/리포트 ----------

function FeedbackTab({ items, total, category, onCategoryChange }: {
  items: FeedbackItem[];
  total: number;
  category: string;
  onCategoryChange: (value: string) => void;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-bold text-blossom">문의/리포트 (최근 {total})</h2>
        <select
          value={category}
          onChange={event => onCategoryChange(event.target.value)}
          className="rounded-lg border border-mystic/20 bg-elevated/70 px-2 py-1 text-[11px] text-ink"
        >
          <option value="">전체</option>
          <option value="bug">버그</option>
          <option value="idea">제안</option>
          <option value="other">기타</option>
        </select>
        <span className="text-[10px] text-ink-dim">이 탭을 보는 동안 자동 읽음 처리</span>
      </div>
      <SectionBox className="max-h-[32rem] overflow-y-auto">
        {items.map(item => (
          <div key={item.id} className="border-b border-white/5 p-3 text-xs">
            <div className="mb-1 flex items-center gap-2 text-[10px] text-ink-dim">
              <span className={`rounded px-1.5 py-0.5 font-bold ${
                item.category === 'bug'
                  ? 'bg-blossom/20 text-blossom'
                  : item.category === 'idea'
                    ? 'bg-cyber/20 text-cyber'
                    : 'bg-white/10 text-ink-dim'
              }`}>
                {item.category === 'bug' ? '버그' : item.category === 'idea' ? '제안' : '기타'}
              </span>
              <span className="font-bold text-ink">{item.alias}</span>
              <span>#{item.id}</span>
              <span>{timeAgo(item.createdAt)}</span>
            </div>
            <p className="whitespace-pre-wrap text-ink">{item.message}</p>
          </div>
        ))}
        {items.length === 0 && (
          <div className="p-3 text-xs text-ink-dim">문의 없음</div>
        )}
      </SectionBox>
    </section>
  );
}

// ---------- 이벤트 ----------

function EventsTab({ events, eventType, onEventTypeChange }: {
  events: OpsEvent[];
  eventType: string;
  onEventTypeChange: (value: string) => void;
}) {
  return (
    <section>
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-sm font-bold text-blossom">운영 이벤트 (영속)</h2>
        <select
          value={eventType}
          onChange={event => onEventTypeChange(event.target.value)}
          className="rounded-lg border border-mystic/20 bg-elevated/70 px-2 py-1 text-[11px] text-ink"
        >
          <option value="">전체</option>
          <option value="server-start">server-start</option>
          <option value="http-reject">http-reject</option>
          <option value="join-room:reject">join-room:reject</option>
          <option value="grace-expired">grace-expired</option>
          <option value="room-lost">room-lost</option>
          <option value="hand-end">hand-end (정산 실패)</option>
        </select>
      </div>
      <SectionBox className="max-h-[32rem] overflow-y-auto p-2 font-mono text-[10px] leading-relaxed">
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
      </SectionBox>
    </section>
  );
}

// ---------- 보안·공정성 ----------

function SecurityTab({ security }: { security: SecuritySummary | null }) {
  return (
    <div className="space-y-4">
      <section>
        <h2 className="mb-2 text-sm font-bold text-blossom">
          신호 이벤트 집계 (최근 {security?.windowHours ?? 24}시간)
        </h2>
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
          {SECURITY_SIGNALS.map(signal => {
            const count = security?.counts[signal.type] ?? 0;
            const alarm = signal.type === 'hand-end' && count > 0;
            return (
              <div
                key={signal.type}
                className={`rounded-xl border p-3 ${
                  alarm
                    ? 'border-blossom/60 bg-blossom/10'
                    : 'border-mystic/20 bg-panel/85'
                }`}
              >
                <div className={`text-lg font-bold tabular ${alarm ? 'text-blossom' : 'text-gilded'}`}>
                  {count.toLocaleString()}
                </div>
                <div className="text-[11px] font-bold text-ink">{signal.label}</div>
                <div className="mt-0.5 text-[10px] leading-snug text-ink-dim">{signal.hint}</div>
              </div>
            );
          })}
        </div>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-bold text-blossom">공정성·서버 방어 아키텍처</h2>
        <div className="grid gap-2 md:grid-cols-2">
          {INTEGRITY_CHECKLIST.map(item => (
            <SectionBox key={item.title} className="p-3">
              <div className="mb-1 text-xs font-bold text-cyber">✓ {item.title}</div>
              <p className="text-[11px] leading-snug text-ink-dim">{item.body}</p>
            </SectionBox>
          ))}
        </div>
      </section>
    </div>
  );
}

// ---------- 게임 설정 (핫 컨피그) ----------

const APPLY_MODE_BADGE: Record<GameConfigEntryView['applyMode'], { label: string; cls: string }> = {
  immediate: { label: '즉시 반영', cls: 'border-green-400/40 bg-green-400/10 text-green-400' },
  'next-hand': { label: '다음 핸드부터', cls: 'border-cyber/40 bg-cyber/10 text-cyber' },
  'new-room': { label: '새 방부터', cls: 'border-gilded/40 bg-gilded/10 text-gilded' },
};

const CONFIG_UNIT_LABEL: Record<string, string> = {
  ms: 'ms', s: '초', chips: '칩', bps: 'bps', BB: 'BB', '개': '개', '%': '%',
};

const APPLY_MODE_DESC: Record<GameConfigEntryView['applyMode'], string> = {
  immediate: '저장 즉시 다음 판정/호출부터 반영됩니다.',
  'next-hand': '진행 중인 핸드는 그대로 두고, 다음 핸드부터 반영됩니다.',
  'new-room': '이미 만들어진 방은 유지되고, 새로 만드는 방부터 반영됩니다.',
};

function fmtConfigValue(value: number, unit?: string): string {
  if (unit === 'ms') {
    return `${value.toLocaleString('ko-KR')}ms (${(value / 1000).toLocaleString('ko-KR')}초)`;
  }
  const unitLabel = unit ? CONFIG_UNIT_LABEL[unit] ?? unit : '';
  return `${value.toLocaleString('ko-KR')}${unitLabel}`;
}

/** 변경 이력은 연도까지 — 감사 기록이라 해를 넘겨도 시점이 특정돼야 한다 */
function fmtHistoryTime(ms: number): string {
  return new Date(ms).toLocaleString('ko-KR', {
    year: '2-digit', month: 'numeric', day: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
}

interface ConfigHistoryRow {
  eventId: number;
  at: number;
  key: string;
  from: number;
  to: number;
}

/** config-change 이벤트(data.changes[])를 항목 단위 행으로 평탄화 — 형식이 어긋난 데이터는 건너뛴다 */
function flattenConfigHistory(events: OpsEvent[]): ConfigHistoryRow[] {
  const rows: ConfigHistoryRow[] = [];
  for (const event of events) {
    const changes = (event.data as { changes?: unknown }).changes;
    if (!Array.isArray(changes)) continue;
    for (const change of changes as Array<{ key?: unknown; from?: unknown; to?: unknown }>) {
      if (typeof change?.key !== 'string') continue;
      if (typeof change.from !== 'number' || typeof change.to !== 'number') continue;
      rows.push({ eventId: event.id, at: event.at, key: change.key, from: change.from, to: change.to });
    }
  }
  return rows;
}

function ConfigTab({ config, history, onSave }: {
  config: GameConfigResponse | null;
  history: OpsEvent[];
  onSave: (updates: Record<string, number | null>) => Promise<GameConfigSaveResult>;
}) {
  // 편집 중(dirty) 키는 5초 폴링이 입력값을 덮지 않도록 로컬 초안으로 관리한다
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<GameConfigSaveResult | null>(null);
  // 변경 확정 대기 — to === null이면 기본값 복원 요청
  const [confirm, setConfirm] = useState<{ entry: GameConfigEntryView; to: number | null } | null>(null);

  if (!config) {
    return <SectionBox className="p-4 text-sm text-ink-dim">게임 설정을 불러오는 중…</SectionBox>;
  }

  const groups: Array<{ group: string; label: string; entries: GameConfigEntryView[] }> = [];
  for (const entry of config.entries) {
    const bucket = groups.find(item => item.group === entry.group);
    if (bucket) bucket.entries.push(entry);
    else {
      groups.push({
        group: entry.group,
        label: config.groupLabels[entry.group] ?? entry.group,
        entries: [entry],
      });
    }
  }

  const draftOf = (entry: GameConfigEntryView) => drafts[entry.key] ?? String(entry.value);
  const dirtyKeys = Object.keys(drafts).filter(key => {
    const entry = config.entries.find(item => item.key === key);
    return entry !== undefined && drafts[key] !== String(entry.value);
  });
  const errorOf = (key: string) =>
    result?.errors?.find(item => item.key === key)?.message ?? null;

  const discardDraft = (key: string) => {
    setDrafts(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  // [변경] 클릭 — 클라 선검증 통과 시에만 확인 모달 (범위 검증의 정본은 서버)
  const requestChange = (entry: GameConfigEntryView) => {
    const parsed = Number(draftOf(entry));
    if (!Number.isSafeInteger(parsed)) {
      setResult({
        ok: false,
        message: '입력값을 확인해주세요.',
        errors: [{ key: entry.key, message: '정수만 입력할 수 있습니다' }],
      });
      return;
    }
    if (parsed < entry.min || parsed > entry.max) {
      setResult({
        ok: false,
        message: '입력값을 확인해주세요.',
        errors: [{
          key: entry.key,
          message: `허용 범위는 ${entry.min.toLocaleString()}~${entry.max.toLocaleString()}입니다`,
        }],
      });
      return;
    }
    setResult(null);
    setConfirm({ entry, to: parsed });
  };

  const applyConfirm = async () => {
    if (!confirm) return;
    const { entry, to } = confirm;
    setSaving(true);
    const saved = await onSave({ [entry.key]: to });
    setSaving(false);
    setConfirm(null);
    setResult(saved);
    if (saved.ok) discardDraft(entry.key);
  };

  const historyRows = flattenConfigHistory(history);
  const entryByKey = new Map(config.entries.map(entry => [entry.key, entry]));

  return (
    <div className="space-y-4">
      <SectionBox className="p-3">
        <p className="text-[11px] leading-snug text-ink-dim">
          서버 배포 없이 게임 설정을 조정합니다 (SQLite 영속 — 재시작 후에도 유지).
          값을 고친 뒤 항목별 <span className="font-bold text-blossom">[변경]</span> 버튼을 누르면
          변경 내용을 한 번 더 확인한 후 반영됩니다.
          적용 방식 배지를 확인하세요: <span className="font-bold text-green-400">즉시 반영</span>은 다음 판정부터,{' '}
          <span className="font-bold text-cyber">다음 핸드부터</span>는 진행 중 핸드 종료 후,{' '}
          <span className="font-bold text-gilded">새 방부터</span>는 이미 만들어진 방에는 적용되지 않습니다.
          모든 변경은 아래 변경 이력에 감사 기록됩니다.
        </p>
      </SectionBox>

      {result && (
        <SectionBox className="p-3">
          <p className={`text-[11px] leading-snug ${result.ok ? 'text-green-400' : 'text-blossom'}`}>
            {result.message}
          </p>
        </SectionBox>
      )}

      {groups.map(group => (
        <section key={group.group} className="space-y-2">
          <h2 className="text-sm font-bold text-blossom">{group.label}</h2>
          <SectionBox className="divide-y divide-mystic/10">
            {group.entries.map(entry => {
              const badge = APPLY_MODE_BADGE[entry.applyMode];
              const draft = draftOf(entry);
              const draftNumber = Number(draft);
              const rowError = errorOf(entry.key);
              const dirty = dirtyKeys.includes(entry.key);
              return (
                <div key={entry.key} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5">
                  <div className="min-w-[220px] flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-ink">{entry.label}</span>
                      <span className={`rounded-full border px-1.5 py-px text-[10px] font-bold ${badge.cls}`}>
                        {badge.label}
                      </span>
                      {entry.overridden && (
                        <span className="rounded-full border border-blossom/40 bg-blossom/10 px-1.5 py-px text-[10px] font-bold text-blossom">
                          변경됨
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-ink-dim">{entry.key}</p>
                    {entry.description && (
                      <p className="mt-0.5 text-[11px] leading-snug text-ink-dim">{entry.description}</p>
                    )}
                    {entry.warning && (
                      <p className="mt-0.5 text-[11px] leading-snug text-gilded">⚠ {entry.warning}</p>
                    )}
                    {rowError && (
                      <p className="mt-0.5 text-[11px] font-bold text-blossom">{rowError}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={draft}
                      min={entry.min}
                      max={entry.max}
                      onChange={event => setDrafts(prev => ({ ...prev, [entry.key]: event.target.value }))}
                      className={`w-32 rounded-lg border bg-elevated/70 px-2 py-1.5 text-right text-sm tabular text-ink outline-none focus:border-blossom/50 ${
                        rowError
                          ? 'border-blossom/60'
                          : dirty
                            ? 'border-cyber/50'
                            : 'border-mystic/20'
                      }`}
                    />
                    <span className="w-8 text-[11px] text-ink-dim">
                      {entry.unit ? CONFIG_UNIT_LABEL[entry.unit] ?? entry.unit : ''}
                    </span>
                    <div className="w-40 text-right text-[11px] text-ink-dim">
                      {entry.unit === 'ms' && Number.isFinite(draftNumber) && (
                        <span className="mr-2 text-cyber">= {(draftNumber / 1000).toLocaleString()}초</span>
                      )}
                      <span>범위 {entry.min.toLocaleString()}~{entry.max.toLocaleString()}</span>
                    </div>
                    <div className="flex w-44 items-center justify-end gap-1.5">
                      {dirty ? (
                        <>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => discardDraft(entry.key)}
                            className="rounded-lg border border-mystic/30 px-2 py-1 text-[11px] text-ink-dim hover:bg-white/5 hover:text-ink"
                          >
                            취소
                          </button>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => requestChange(entry)}
                            className="rounded-lg border border-blossom/50 bg-blossom/20 px-3 py-1 text-[11px] font-bold text-blossom hover:bg-blossom/30"
                          >
                            변경
                          </button>
                        </>
                      ) : entry.overridden ? (
                        <button
                          type="button"
                          disabled={saving}
                          onClick={() => {
                            setResult(null);
                            setConfirm({ entry, to: null });
                          }}
                          className="rounded-lg border border-mystic/30 px-2 py-1 text-[11px] text-ink-dim hover:bg-white/5 hover:text-ink"
                        >
                          기본값 {entry.effectiveDefault.toLocaleString()} 복원
                        </button>
                      ) : (
                        <span className="text-[11px] text-ink-dim">
                          기본값 {entry.effectiveDefault.toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </SectionBox>
        </section>
      ))}

      <section className="space-y-2">
        <h2 className="text-sm font-bold text-blossom">변경 이력</h2>
        <SectionBox className="overflow-x-auto">
          {historyRows.length === 0 ? (
            <p className="p-4 text-sm text-ink-dim">아직 변경 이력이 없습니다.</p>
          ) : (
            <table className="w-full min-w-[560px] text-left text-xs">
              <thead>
                <tr className="border-b border-mystic/20 text-[10px] text-ink-dim">
                  <th className="px-3 py-2 font-normal">변경일시</th>
                  <th className="px-3 py-2 font-normal">변경 항목</th>
                  <th className="px-3 py-2 text-right font-normal">이전 수치</th>
                  <th className="px-2 py-2 font-normal" aria-hidden />
                  <th className="px-3 py-2 font-normal">변경 수치</th>
                </tr>
              </thead>
              <tbody>
                {historyRows.map((row, index) => {
                  const entry = entryByKey.get(row.key);
                  return (
                    <tr key={`${row.eventId}-${row.key}-${index}`} className="border-b border-mystic/10 last:border-b-0">
                      <td className="whitespace-nowrap px-3 py-2 tabular text-ink-dim">{fmtHistoryTime(row.at)}</td>
                      <td className="px-3 py-2">
                        <span className="font-bold text-ink">{entry?.label ?? row.key}</span>
                        {entry && <span className="ml-1.5 text-[10px] text-ink-dim">{row.key}</span>}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular text-ink-dim">
                        {fmtConfigValue(row.from, entry?.unit)}
                      </td>
                      <td className="px-2 py-2 text-center text-ink-dim">→</td>
                      <td className="whitespace-nowrap px-3 py-2 font-bold tabular text-cyber">
                        {fmtConfigValue(row.to, entry?.unit)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </SectionBox>
        <p className="text-[10px] text-ink-dim">
          최근 50건 표시 — 전체 기록은 이벤트 탭에서 type=config-change로 조회할 수 있어요.
        </p>
      </section>

      {confirm && (() => {
        const { entry } = confirm;
        const isReset = confirm.to === null;
        const toValue = confirm.to ?? entry.effectiveDefault;
        const badge = APPLY_MODE_BADGE[entry.applyMode];
        return (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
            onClick={() => {
              if (!saving) setConfirm(null);
            }}
          >
            <div
              role="dialog"
              aria-modal="true"
              className="w-full max-w-md space-y-3 rounded-2xl border border-mystic/30 bg-panel p-4"
              onClick={event => event.stopPropagation()}
            >
              <h3 className="text-sm font-bold text-ink">
                {isReset ? '기본값 복원 확인' : '설정 변경 확인'}
              </h3>
              <div>
                <p className="text-sm font-bold text-blossom">{entry.label}</p>
                <p className="text-[10px] text-ink-dim">{entry.key}</p>
              </div>
              <div className="rounded-xl border border-mystic/20 bg-elevated/50 p-3 text-center">
                <span className="text-sm tabular text-ink-dim">{fmtConfigValue(entry.value, entry.unit)}</span>
                <span className="mx-2 text-ink-dim">→</span>
                <span className="text-base font-bold tabular text-cyber">{fmtConfigValue(toValue, entry.unit)}</span>
              </div>
              <div className="flex items-start gap-2 text-[11px] leading-snug">
                <span className={`shrink-0 rounded-full border px-1.5 py-px text-[10px] font-bold ${badge.cls}`}>
                  {badge.label}
                </span>
                <span className="text-ink-dim">{APPLY_MODE_DESC[entry.applyMode]}</span>
              </div>
              {entry.warning && (
                <p className="text-[11px] leading-snug text-gilded">⚠ {entry.warning}</p>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => setConfirm(null)}
                  className="rounded-lg border border-mystic/30 px-3 py-1.5 text-sm text-ink-dim hover:bg-white/5 hover:text-ink"
                >
                  취소
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => void applyConfirm()}
                  className="rounded-lg border border-blossom/50 bg-blossom/20 px-4 py-1.5 text-sm font-bold text-blossom hover:bg-blossom/30"
                >
                  {saving ? '저장 중…' : isReset ? '기본값 복원' : '변경 확정'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
