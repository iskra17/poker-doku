# Realtime Protocol and Session Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every Socket.IO state change belong to the latest socket, current room, and exact game-state version while proving the behavior with real multi-client integration tests.

**Architecture:** Add a shared typed protocol and runtime payload parsers at the socket boundary. Keep the server-authoritative `PokerEngine`, but add session takeover, room-scoped envelopes, action optimistic-concurrency fields, scoped acknowledgements, and an idempotent client connection state. Refactor socket setup to return a disposable runtime so tests can run real ephemeral HTTP/Socket.IO servers without leaking timers.

**Tech Stack:** TypeScript 5, Node HTTP, Socket.IO 4.8, socket.io-client 4.8, Zustand 5, Vitest 4, Next.js 16

---

## File map

- Create `src/lib/realtime/protocol.ts` — shared event payloads, acknowledgements, room-list shape, Socket.IO event maps.
- Create `src/server/socket-payload.ts` — runtime parsing and sanitization for every event carrying external data.
- Create `src/server/socket-payload.test.ts` — parser red/green coverage.
- Modify `src/server/session-manager.ts` — token normalization, latest-socket takeover metadata, socket ownership query.
- Modify `src/server/session-manager.test.ts` — takeover and ownership regression coverage.
- Modify `src/server/room-manager.ts` — runtime shutdown and reconnect-message idempotency needed by integration tests.
- Modify `src/server/socket-handler.ts` — typed protocol, disposable runtime, current-socket guard, room envelope, scoped ack, safe join ordering, versioned action.
- Modify `src/server/index.ts` — instantiate Socket.IO with the shared client/server event maps.
- Create `src/server/socket-test-harness.ts` — ephemeral real Socket.IO server/client helper used only by tests.
- Create `src/server/socket-handler.integration.test.ts` — simultaneous users, takeover, malformed input, room isolation, stale action coverage.
- Create `src/lib/store/realtime-state.ts` — pure room/update/action feedback decisions.
- Create `src/lib/store/realtime-state.test.ts` — client state-transition tests without a DOM.
- Modify `src/lib/store/game-store.ts` — typed/idempotent connection, acknowledged joins/actions, offline guard, room filtering.
- Modify `src/app/page.tsx` — keep lobby rendered during acknowledged join.
- Modify `src/components/layout/GameRoomView.tsx` — connection/action notice surface.
- Modify `src/components/table/ActionBar.tsx` — disable inputs while offline or awaiting action result.
- Modify `AGENTS.md` — record the new room/version/ack contracts.

## Task 1: Shared protocol and runtime payload parsers

**Files:**
- Create: `src/lib/realtime/protocol.ts`
- Create: `src/server/socket-payload.ts`
- Test: `src/server/socket-payload.test.ts`

- [ ] **Step 1: Write failing parser tests**

Create `src/server/socket-payload.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  parseCreateRoomRequest,
  parseJoinRoomRequest,
  parseLeaveRoomRequest,
  parsePlayerActionRequest,
} from './socket-payload';

describe('Socket.IO payload runtime parsing', () => {
  it.each([null, undefined, [], 'bad', 17])('join-room 객체가 아니면 거절한다: %j', input => {
    expect(parseJoinRoomRequest(input).ok).toBe(false);
  });

  it('join-room 문자열을 정리하고 숫자만 통과시킨다', () => {
    expect(parseJoinRoomRequest({
      roomId: ' room-1 ', playerName: '\u0000  홍길동  ', buyIn: 2000,
      seatIndex: 2, avatar: 'ara', password: 'pw',
    })).toEqual({
      ok: true,
      value: { roomId: 'room-1', playerName: '홍길동', buyIn: 2000, seatIndex: 2, avatar: 'ara', password: 'pw' },
    });
  });

  it.each([NaN, Infinity, -Infinity])('join-room 비유한 buyIn을 거절한다: %s', buyIn => {
    expect(parseJoinRoomRequest({ roomId: 'room-1', playerName: '나', buyIn, seatIndex: 0 }).ok).toBe(false);
  });

  it('player-action은 방과 상태 버전을 반드시 요구한다', () => {
    expect(parsePlayerActionRequest({ roomId: 'room-1', action: 'check' }).ok).toBe(false);
    expect(parsePlayerActionRequest({
      roomId: 'room-1', action: 'raise', amount: 120, expectedHandNumber: 3, expectedActionSeq: 9,
    })).toEqual({
      ok: true,
      value: { roomId: 'room-1', action: 'raise', amount: 120, expectedHandNumber: 3, expectedActionSeq: 9 },
    });
  });

  it('create-room은 제어문자를 지우고 허용 enum만 받는다', () => {
    expect(parseCreateRoomRequest({
      name: '\n 테스트 방 ', bigBlind: 50, turnTime: 8, gameMode: 'cash',
      difficulty: 'hard', tableType: 'humans', botCount: 0, password: '1234',
    })).toEqual({
      ok: true,
      value: {
        name: '테스트 방', bigBlind: 50, turnTime: 8, gameMode: 'cash', difficulty: 'hard',
        tableType: 'humans', botCount: 0, password: '1234',
      },
    });
    expect(parseCreateRoomRequest({ name: {}, bigBlind: Infinity }).ok).toBe(false);
  });

  it('leave-room은 payload 생략과 두 모드만 허용한다', () => {
    expect(parseLeaveRoomRequest(undefined)).toEqual({ ok: true, value: { mode: 'exit' } });
    expect(parseLeaveRoomRequest({ mode: 'sitout' })).toEqual({ ok: true, value: { mode: 'sitout' } });
    expect(parseLeaveRoomRequest({ mode: 'erase-everything' }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run the parser test and verify RED**

Run: `npm test -- src/server/socket-payload.test.ts`

Expected: FAIL because `./socket-payload` does not exist.

- [ ] **Step 3: Add the shared protocol types**

Create `src/lib/realtime/protocol.ts` with these exported contracts:

```ts
import type { Socket } from 'socket.io-client';
import type { ActionType, ChatMessage, GameState } from '../poker/types';

export type RealtimeErrorCode =
  | 'invalid-payload' | 'rate-limited' | 'room-not-found' | 'room-full'
  | 'bad-password' | 'sng-started' | 'practice-occupied' | 'bot-seat-pending'
  | 'session-replaced' | 'stale-state' | 'not-your-turn' | 'action-rejected'
  | 'join-timeout' | 'server-error';

export type RealtimeAck<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; code: RealtimeErrorCode; message: string };
export type AckCallback<T = undefined> = (ack: RealtimeAck<T>) => void;

export interface RoomListItem {
  id: string; name: string; playerCount: number; maxPlayers: number;
  blinds: string; status: string; mode?: string; locked?: boolean; hasPassword?: boolean;
  bigBlind?: number; minBuyIn?: number; maxBuyIn?: number;
  difficulty?: 'easy' | 'normal' | 'hard'; turnTime?: number; humanCount?: number;
  tableType?: 'bots' | 'mixed' | 'humans';
  mySeat?: { chips: number; sittingOut: boolean };
}

export interface JoinRoomRequest {
  roomId: string; playerName: string; buyIn: number; seatIndex: number;
  avatar?: string; password?: string;
}
export interface CreateRoomRequest {
  name: string; bigBlind: number; turnTime: number; gameMode: 'cash' | 'sng';
  difficulty: 'easy' | 'normal' | 'hard'; tableType: 'bots' | 'mixed' | 'humans';
  botCount: number; password?: string;
}
export interface LeaveRoomRequest { mode: 'exit' | 'sitout' }
export interface PlayerActionRequest {
  roomId: string; action: ActionType; amount?: number;
  expectedHandNumber: number; expectedActionSeq: number;
}
export interface GameUpdatePayload { roomId: string; state: GameState }
export interface RoomJoinedPayload {
  roomId: string; gameState: GameState; chatHistory: ChatMessage[];
}

export interface ServerToClientEvents {
  session: (data: { playerId: string }) => void;
  'session-replaced': (data: { message: string }) => void;
  'room-list': (rooms: RoomListItem[]) => void;
  'room-joined': (data: RoomJoinedPayload) => void;
  'room-lost': (data?: { message?: string }) => void;
  'room-created': (data: { roomId: string }) => void;
  'game-update': (data: GameUpdatePayload) => void;
  'game-update-public': (data: GameUpdatePayload) => void;
  'chat-message': (message: ChatMessage) => void;
}

export interface ClientToServerEvents {
  resync: (ack?: AckCallback) => void;
  'get-rooms': (ack?: AckCallback) => void;
  'join-room': (data: unknown, ack?: AckCallback<{ roomId: string }>) => void;
  'leave-room': (data?: unknown, ack?: AckCallback) => void;
  'player-action': (data: unknown, ack?: AckCallback<{ handNumber: number; actionSeq: number }>) => void;
  'toggle-sit-out': (ack?: AckCallback) => void;
  'use-time-bank': (ack?: AckCallback) => void;
  'send-chat': (data: unknown, ack?: AckCallback) => void;
  'create-room': (data: unknown, ack?: AckCallback<{ roomId: string }>) => void;
  'sng-fill-bots': (ack?: AckCallback) => void;
}

export type PokerClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;
```

- [ ] **Step 4: Implement parsers minimally**

Create `src/server/socket-payload.ts`:

```ts
import type { ActionType } from '../lib/poker/types';
import type {
  CreateRoomRequest, JoinRoomRequest, LeaveRoomRequest, PlayerActionRequest,
} from '../lib/realtime/protocol';

export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

const ACTIONS: readonly ActionType[] = ['fold', 'check', 'call', 'raise', 'all-in'];
const MODES = ['cash', 'sng'] as const;
const DIFFICULTIES = ['easy', 'normal', 'hard'] as const;
const TABLE_TYPES = ['bots', 'mixed', 'humans'] as const;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
const INVALID_MESSAGE = '요청 형식이 올바르지 않아요.';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail<T>(): ParseResult<T> {
  return { ok: false, message: INVALID_MESSAGE };
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(CONTROL_CHARS, '').trim();
  if (!cleaned || cleaned.length > max) return null;
  return cleaned;
}

function optionalText(value: unknown, max: number): string | undefined | null {
  if (value === undefined || value === null || value === '') return undefined;
  return cleanText(value, max);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function memberOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

export function parseJoinRoomRequest(input: unknown): ParseResult<JoinRoomRequest> {
  if (!isRecord(input)) return fail();
  const roomId = cleanText(input.roomId, 100);
  const playerName = cleanText(input.playerName, 24);
  const buyIn = finiteNumber(input.buyIn);
  const seatIndex = finiteNumber(input.seatIndex);
  const avatar = optionalText(input.avatar, 50);
  const password = optionalText(input.password, 20);
  if (!roomId || !playerName || buyIn === null || seatIndex === null || avatar === null || password === null) return fail();
  return {
    ok: true,
    value: {
      roomId, playerName, buyIn, seatIndex: Math.trunc(seatIndex),
      ...(avatar ? { avatar } : {}), ...(password ? { password } : {}),
    },
  };
}

export function parsePlayerActionRequest(input: unknown): ParseResult<PlayerActionRequest> {
  if (!isRecord(input)) return fail();
  const roomId = cleanText(input.roomId, 100);
  const amount = input.amount === undefined ? undefined : finiteNumber(input.amount);
  const hand = finiteNumber(input.expectedHandNumber);
  const seq = finiteNumber(input.expectedActionSeq);
  if (
    !roomId || !memberOf(input.action, ACTIONS) || amount === null
    || hand === null || seq === null || !Number.isInteger(hand) || hand < 0
    || !Number.isInteger(seq) || seq < 0
  ) return fail();
  return {
    ok: true,
    value: {
      roomId, action: input.action, expectedHandNumber: hand, expectedActionSeq: seq,
      ...(amount === undefined ? {} : { amount }),
    },
  };
}

export function parseCreateRoomRequest(input: unknown): ParseResult<CreateRoomRequest> {
  if (!isRecord(input)) return fail();
  const name = cleanText(input.name, 40);
  const bigBlind = input.bigBlind === undefined ? 20 : finiteNumber(input.bigBlind);
  const turnTime = input.turnTime === undefined ? 8 : finiteNumber(input.turnTime);
  const botCount = input.botCount === undefined ? 2 : finiteNumber(input.botCount);
  const gameMode = input.gameMode === undefined ? 'cash' : input.gameMode;
  const difficulty = input.difficulty === undefined ? 'normal' : input.difficulty;
  const tableType = input.tableType === undefined ? 'mixed' : input.tableType;
  const password = optionalText(input.password, 20);
  if (
    !name || bigBlind === null || turnTime === null || botCount === null || password === null
    || !memberOf(gameMode, MODES) || !memberOf(difficulty, DIFFICULTIES)
    || !memberOf(tableType, TABLE_TYPES)
  ) return fail();
  return {
    ok: true,
    value: {
      name, bigBlind, turnTime, gameMode, difficulty, tableType, botCount: Math.trunc(botCount),
      ...(password ? { password } : {}),
    },
  };
}

export function parseLeaveRoomRequest(input: unknown): ParseResult<LeaveRoomRequest> {
  if (input === undefined) return { ok: true, value: { mode: 'exit' } };
  if (!isRecord(input) || (input.mode !== 'exit' && input.mode !== 'sitout')) return fail();
  return { ok: true, value: { mode: input.mode } };
}
```

The parser rejects room IDs longer than 100 instead of slicing them, so two external IDs can never alias after
sanitization.

- [ ] **Step 5: Run parser tests and verify GREEN**

Run: `npm test -- src/server/socket-payload.test.ts`

Expected: 12 parameterized and direct tests pass.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/lib/realtime/protocol.ts src/server/socket-payload.ts src/server/socket-payload.test.ts
git commit -m "feat: 실시간 이벤트 프로토콜과 입력 파서 추가"
```

## Task 2: Session takeover and socket ownership

**Files:**
- Modify: `src/server/session-manager.ts`
- Modify: `src/server/session-manager.test.ts`

- [ ] **Step 1: Change tests first to require takeover metadata**

Update all existing `resolve()` uses to read `.session` and replace short fixtures such as `token-a`/`token-b`
with regex-valid `token-aaaa`/`token-bbbb`, then add:

```ts
it('같은 토큰의 새 소켓은 교체된 socketId를 반환하고 최신 소켓만 소유자다', () => {
  const sm = new SessionManager();
  const first = sm.resolve('token-1234', 'sock-1');
  const second = sm.resolve('token-1234', 'sock-2');

  expect(first.replacedSocketId).toBeNull();
  expect(second.session.playerId).toBe(first.session.playerId);
  expect(second.replacedSocketId).toBe('sock-1');
  expect(sm.isCurrentSocket(second.session.playerId, 'sock-1')).toBe(false);
  expect(sm.isCurrentSocket(second.session.playerId, 'sock-2')).toBe(true);
});

it('비정상 토큰은 안정 세션 키로 쓰지 않는다', () => {
  const sm = new SessionManager();
  const a = sm.resolve('x', 'sock-1').session;
  const b = sm.resolve('x', 'sock-2').session;
  expect(a.playerId).not.toBe(b.playerId);
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- src/server/session-manager.test.ts`

Expected: FAIL because `resolve()` does not return `replacedSocketId` and `isCurrentSocket()` is missing.

- [ ] **Step 3: Implement takeover ownership**

Add:

```ts
export interface SessionResolution {
  session: Session;
  replacedSocketId: string | null;
}

const SESSION_TOKEN_RE = /^[A-Za-z0-9._~-]{8,128}$/;

resolve(token: unknown, socketId: string): SessionResolution {
  const stableToken = typeof token === 'string' && SESSION_TOKEN_RE.test(token) ? token : null;
  const key = stableToken ?? socketId;
  let session = this.byToken.get(key);
  if (!session) {
    session = this.createSession(key);
  }
  this.clearGrace(session);
  const replacedSocketId = session.socketId && session.socketId !== socketId ? session.socketId : null;
  if (replacedSocketId) this.bySocketId.delete(replacedSocketId);
  session.socketId = socketId;
  this.bySocketId.set(socketId, session);
  return { session, replacedSocketId };
}

isCurrentSocket(playerId: string, socketId: string): boolean {
  return this.byPlayerId.get(playerId)?.socketId === socketId;
}
```

Extract the existing new-session block into private `createSession(key)` without changing player ID generation.
Keep `detachSocket()` behavior: an already replaced socket returns null and cannot start grace.

- [ ] **Step 4: Run session tests and verify GREEN**

Run: `npm test -- src/server/session-manager.test.ts`

Expected: all SessionManager tests pass.

- [ ] **Step 5: Commit Task 2**

```bash
git add src/server/session-manager.ts src/server/session-manager.test.ts
git commit -m "fix: 동일 세션은 최신 소켓만 소유하도록 격리"
```

## Task 3: Disposable socket runtime and real integration harness

**Files:**
- Modify: `src/server/socket-handler.ts`
- Modify: `src/server/room-manager.ts`
- Modify: `src/server/index.ts`
- Create: `src/server/socket-test-harness.ts`
- Create: `src/server/socket-handler.integration.test.ts`

- [ ] **Step 1: Write the first real-socket takeover test**

Create `src/server/socket-handler.integration.test.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { createSocketTestHarness, SocketTestHarness } from './socket-test-harness';

describe('Socket.IO 멀티클라이언트 경계', () => {
  let harness: SocketTestHarness | null = null;
  afterEach(async () => { await harness?.close(); harness = null; });

  it('같은 토큰의 새 연결이 이전 소켓을 서버 종료하고 소유권을 가져간다', async () => {
    harness = await createSocketTestHarness();
    const first = await harness.connect('same-token-1234');
    const replaced = new Promise<{ message: string }>(resolve => first.once('session-replaced', resolve));
    const disconnected = new Promise<string>(resolve => first.once('disconnect', resolve));

    const second = await harness.connect('same-token-1234');

    await expect(replaced).resolves.toEqual({ message: '다른 탭에서 게임을 열어 이 연결을 종료했어요.' });
    await expect(disconnected).resolves.toBe('io server disconnect');
    expect(first.connected).toBe(false);
    expect(harness.runtime.sessions.isCurrentSocket(second.playerId, second.socket.id)).toBe(true);
  });
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- src/server/socket-handler.integration.test.ts`

Expected: FAIL because `socket-test-harness` and the runtime return value do not exist.

- [ ] **Step 3: Return a disposable runtime from socket setup**

Change the signature to:

```ts
export interface SocketRuntimeOptions {
  createDefaultRooms?: boolean;
  sweepIntervalMs?: number;
  graceMs?: number;
}
export interface SocketRuntime {
  roomManager: RoomManager;
  sessions: SessionManager;
  close: () => void;
}

export function setupSocketHandlers(
  io: Server<ClientToServerEvents, ServerToClientEvents>,
  options: SocketRuntimeOptions = {},
): SocketRuntime
```

Default `createDefaultRooms=true`, `sweepIntervalMs=60_000`, and `graceMs=GRACE_MS`. Store the sweep interval
handle instead of discarding it; when the interval is `0`, do not create an interval. Instantiate
`Server<ClientToServerEvents, ServerToClientEvents>` in `src/server/index.ts`. Add `RoomManager.shutdown()` that clears every timer in `botIntervals`,
`pendingStartTimers`, `turnTimers`, and `sitOutAbandonTimers`, clears deadline/epoch Maps, and cancels each timer.
Return `close()` that clears the sweep interval and calls `roomManager.shutdown()`.

- [ ] **Step 4: Create the real-socket test harness**

Create `src/server/socket-test-harness.ts` with:

```ts
import { createServer, Server as HttpServer } from 'http';
import { AddressInfo } from 'net';
import { Server } from 'socket.io';
import { io as createClient } from 'socket.io-client';
import type { ClientToServerEvents, PokerClientSocket, ServerToClientEvents } from '../lib/realtime/protocol';
import { setupSocketHandlers, SocketRuntime } from './socket-handler';

export interface ConnectedTestClient { socket: PokerClientSocket; playerId: string }
export interface SocketTestHarness {
  io: Server<ClientToServerEvents, ServerToClientEvents>;
  httpServer: HttpServer;
  runtime: SocketRuntime;
  connect: (token: string) => Promise<ConnectedTestClient>;
  close: () => Promise<void>;
}

export async function createSocketTestHarness(): Promise<SocketTestHarness> {
  const httpServer = createServer();
  const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, { transports: ['websocket'] });
  const runtime = setupSocketHandlers(io, { createDefaultRooms: false, sweepIntervalMs: 0, graceMs: 50 });
  await new Promise<void>(resolve => httpServer.listen(0, '127.0.0.1', resolve));
  const port = (httpServer.address() as AddressInfo).port;
  const clients = new Set<PokerClientSocket>();

  const connect = (token: string) => new Promise<ConnectedTestClient>((resolve, reject) => {
    const socket: PokerClientSocket = createClient<ServerToClientEvents, ClientToServerEvents>(`http://127.0.0.1:${port}`, {
      transports: ['websocket'], auth: { sessionToken: token }, forceNew: true, reconnection: false,
    });
    clients.add(socket);
    socket.once('session', ({ playerId }) => resolve({ socket, playerId }));
    socket.once('connect_error', reject);
  });

  const close = async () => {
    for (const client of clients) client.disconnect();
    runtime.close();
    await new Promise<void>(resolve => io.close(() => resolve()));
    if (httpServer.listening) await new Promise<void>(resolve => httpServer.close(() => resolve()));
  };
  return { io, httpServer, runtime, connect, close };
}
```

- [ ] **Step 5: Disconnect the replaced socket in `connection`**

Use `const { session, replacedSocketId } = sessions.resolve(rawToken, socket.id)`. Before restoring a room:

```ts
if (replacedSocketId) {
  const previous = io.sockets.sockets.get(replacedSocketId);
  previous?.emit('session-replaced', { message: '다른 탭에서 게임을 열어 이 연결을 종료했어요.' });
  previous?.disconnect(true);
}
```

Add `ownsSession()` in the connection closure and call it before every state-changing event. Failed ownership
responds with `{ok:false, code:'session-replaced', message:'이 연결은 더 이상 현재 게임을 제어하지 않아요.'}`.

- [ ] **Step 6: Run integration and session tests**

Run: `npm test -- src/server/socket-handler.integration.test.ts src/server/session-manager.test.ts`

Expected: takeover test and all SessionManager tests pass with no open-handle warning.

- [ ] **Step 7: Commit Task 3**

```bash
git add src/server/socket-handler.ts src/server/room-manager.ts src/server/index.ts src/server/socket-test-harness.ts src/server/socket-handler.integration.test.ts
git commit -m "test: 실제 소켓 세션 교체 통합 경로 추가"
```

## Task 4: Safe payload boundary and scoped acknowledgements

**Files:**
- Modify: `src/server/socket-handler.ts`
- Modify: `src/server/socket-handler.integration.test.ts`

- [ ] **Step 1: Add malformed-payload integration tests**

Add this Promise helper, which rejects after 1 second:

```ts
import type { RealtimeAck } from '../lib/realtime/protocol';

function withAck<T>(send: (done: (ack: RealtimeAck<T>) => void) => void): Promise<RealtimeAck<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ack timeout')), 1_000);
    send(ack => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}
```

Test `join-room`,
`player-action`, `create-room`, `send-chat`, and `leave-room` with `null`, arrays, and empty objects. Assert each
returns `ok:false, code:'invalid-payload'`. Then emit `get-rooms` and assert a `room-list` event still arrives,
proving the server and socket survived.

```ts
const badJoin = await withAck(done => client.socket.emit('join-room', null, done));
expect(badJoin).toMatchObject({ ok: false, code: 'invalid-payload' });
const rooms = new Promise(resolve => client.socket.once('room-list', resolve));
client.socket.emit('get-rooms');
await expect(rooms).resolves.toEqual([]);
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- src/server/socket-handler.integration.test.ts -t "malformed"`

Expected: FAIL from current direct property access or missing ack.

- [ ] **Step 3: Parse `unknown` before every property access**

Import the Task 1 parsers. Change handler payload types to `unknown`, create:

```ts
const invalidPayload = <T>(ack?: AckCallback<T>) =>
  ack?.({ ok: false, code: 'invalid-payload', message: '요청 형식이 올바르지 않아요.' });
```

Use the relevant parser at the first line of each handler and return immediately on failure. For `send-chat`,
guard with `isRecord(data)` and a string `presetId`; export the record guard from `socket-payload.ts`.
Replace every `socket.emit('error', ...)` in join/create paths with the corresponding ack. Do not clear or change
`session.roomId` on a failed request.

- [ ] **Step 4: Run parser and malformed tests**

Run: `npm test -- src/server/socket-payload.test.ts src/server/socket-handler.integration.test.ts`

Expected: all tests pass; no uncaught exception output.

- [ ] **Step 5: Commit Task 4**

```bash
git add src/server/socket-handler.ts src/server/socket-payload.ts src/server/socket-handler.integration.test.ts
git commit -m "fix: 소켓 입력을 런타임 검증하고 작업별 응답 제공"
```

## Task 5: Room-scoped updates and non-destructive room switching

**Files:**
- Modify: `src/server/socket-handler.ts`
- Modify: `src/server/socket-handler.integration.test.ts`

- [ ] **Step 1: Write room-isolation and failed-switch tests**

Create two `humans` cash rooms through `harness.runtime.roomManager.createRoom()`. Join one client to room A and
then room B. Trigger `resumeRoom(roomA)` after the switch and collect personal `game-update` envelopes for 100ms.
Assert none has room A. Also fill a target humans room with six distinct clients, attempt to switch a seated
room-A client into it, assert `room-full`, and assert the room-A engine still contains that player.

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- src/server/socket-handler.integration.test.ts -t "방"`

Expected: FAIL because updates have no room envelope and the current handler leaves the old room before target
seat success is known.

- [ ] **Step 3: Envelope and filter every update**

In `onUpdate`, resolve the session and require `session.roomId === roomId` before personal emit:

```ts
const targetSession = sessions.getByPlayerId(player.id);
if (!targetSession?.socketId || targetSession.roomId !== roomId) continue;
io.sockets.sockets.get(targetSession.socketId)?.emit('game-update', {
  roomId,
  state: { ...engine.getPublicState(player.id), turnTimeRemaining },
});
```

Wrap the public update as `{roomId, state}` too. Every `room-joined` remains `{roomId, gameState, chatHistory}`.

- [ ] **Step 4: Reorder join as a synchronous commit**

Keep validation and target-seat discovery before any old-room mutation. For a target seat failure, ack and return.
For success, use this commit order:

```ts
const previousRoomId = session.roomId;
// target engine add/rejoin has succeeded here
if (previousRoomId && previousRoomId !== roomId) {
  roomManager.leaveRoom(previousRoomId, session.playerId);
  socket.leave(previousRoomId);
}
roomManager.leaveAllSeatsExcept(session.playerId, roomId);
session.roomId = roomId;
socket.join(roomId);
socket.emit('room-joined', snapshotFor(roomId, session.playerId));
ack?.({ ok: true, data: { roomId } });
```

Move bot-yield/full checks before the commit. If a hand-running bot is marked `pendingRemoval`, respond
`bot-seat-pending` and preserve the previous seat. If `roomManager.joinRoom()` returns false, preserve the previous
seat and respond `room-full`.

- [ ] **Step 5: Run room-isolation tests and full server tests**

Run: `npm test -- src/server/socket-handler.integration.test.ts src/server/room-manager.myseat.test.ts src/lib/poker/engine.leave.test.ts`

Expected: all tests pass and failed target joins preserve the old seat.

- [ ] **Step 6: Commit Task 5**

```bash
git add src/server/socket-handler.ts src/server/socket-handler.integration.test.ts
git commit -m "fix: 개인 상태를 현재 방에 격리하고 방 전환을 안전화"
```

## Task 6: Versioned action acknowledgement and double-click prevention

**Files:**
- Modify: `src/server/socket-handler.ts`
- Modify: `src/server/socket-handler.integration.test.ts`

- [ ] **Step 1: Write the heads-up double-check regression**

Join two clients to a humans room and wait for the hand. The dealer/SB calls, leaving the BB as the last preflop
actor. Emit two BB `check` requests with the same `expectedHandNumber` and `expectedActionSeq`. Assert exactly one
ack succeeds, one returns `stale-state`, the street is `flop`, and `actionSeq` increased by exactly one from the
captured version.

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- src/server/socket-handler.integration.test.ts -t "중복 액션"`

Expected: FAIL because the server ignores expected versions and has no action ack.

- [ ] **Step 3: Gate actions on room and version**

Immediately before `processPlayerAction`:

```ts
if (request.roomId !== session.roomId || request.roomId !== roomId) {
  ack?.({ ok: false, code: 'stale-state', message: '현재 테이블 상태가 바뀌었어요.' });
  return;
}
if (st.handNumber !== request.expectedHandNumber || st.actionSeq !== request.expectedActionSeq) {
  ack?.({ ok: false, code: 'stale-state', message: '상태가 바뀌어 액션을 다시 선택해 주세요.' });
  return;
}
```

After processing, respond with `{ok:true,data:{handNumber,actionSeq}}`; on false respond `action-rejected` with
`지금은 그 액션을 실행할 수 없어요.`. Keep the existing event-log before-state diagnostics.

- [ ] **Step 4: Run action regression and engine tests**

Run: `npm test -- src/server/socket-handler.integration.test.ts src/lib/poker/engine.validactions.test.ts src/lib/poker/engine.raise.test.ts`

Expected: one duplicate succeeds, one is stale, and all engine rules remain green.

- [ ] **Step 5: Commit Task 6**

```bash
git add src/server/socket-handler.ts src/server/socket-handler.integration.test.ts
git commit -m "fix: 상태 버전으로 중복·지연 액션 차단"
```

## Task 7: Client room filtering, offline guard, and acknowledged action state

**Files:**
- Create: `src/lib/store/realtime-state.ts`
- Create: `src/lib/store/realtime-state.test.ts`
- Modify: `src/lib/store/game-store.ts`
- Modify: `src/app/page.tsx`
- Modify: `src/components/layout/GameRoomView.tsx`
- Modify: `src/components/table/ActionBar.tsx`

- [ ] **Step 1: Write pure client-state tests**

Create `src/lib/store/realtime-state.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { canSendAction, shouldApplyGameUpdate, actionFailureMessage } from './realtime-state';

describe('실시간 클라이언트 상태 결정', () => {
  it('현재 방 업데이트만 적용한다', () => {
    expect(shouldApplyGameUpdate('room-a', 'room-a')).toBe(true);
    expect(shouldApplyGameUpdate('room-a', 'room-b')).toBe(false);
    expect(shouldApplyGameUpdate(null, 'room-a')).toBe(false);
  });

  it('연결 중이고 pending 액션이 없을 때만 보낼 수 있다', () => {
    expect(canSendAction(true, false)).toBe(true);
    expect(canSendAction(false, false)).toBe(false);
    expect(canSendAction(true, true)).toBe(false);
  });

  it('stale와 timeout을 사용자가 이해할 한국어로 바꾼다', () => {
    expect(actionFailureMessage('stale-state')).toBe('상태가 바뀌어 액션을 다시 선택해 주세요.');
    expect(actionFailureMessage('join-timeout')).toBe('액션 전송을 확인하지 못해 현재 상태를 다시 불러왔어요.');
  });
});
```

- [ ] **Step 2: Run and verify RED**

Run: `npm test -- src/lib/store/realtime-state.test.ts`

Expected: FAIL because `realtime-state.ts` does not exist.

- [ ] **Step 3: Implement pure decisions**

Create `src/lib/store/realtime-state.ts` with the three functions exactly matching the tests. Accept
`RealtimeErrorCode` in `actionFailureMessage()` and return the server-neutral fallback
`액션을 처리하지 못했어요. 다시 선택해 주세요.` for other codes.

- [ ] **Step 4: Make the store socket typed and `connect()` idempotent**

Import `RoomListItem`, export `type RoomInfo = RoomListItem` for the existing lobby components, and use
`PokerClientSocket` plus `GameUpdatePayload`. At the start of `connect()`:

```ts
const existing = get().socket;
if (existing) {
  if (!existing.connected && get().connectionState !== 'replaced') existing.connect();
  return;
}
```

Add store fields:

```ts
connectionState: 'connecting' | 'connected' | 'reconnecting' | 'replaced';
pendingAction: { handNumber: number; actionSeq: number } | null;
tableNotice: string | null;
```

Handle `session-replaced` by setting `connectionState:'replaced'` and the exact design message. The following
`disconnect` callback must preserve `replaced` instead of changing it to `reconnecting`; other disconnects set
`reconnecting`. Connect sets `connected` and clears only connection notices. This prevents `table/[id]`'s
`!connected` effect from reconnecting an intentionally replaced socket and making two tabs kick each other forever.

- [ ] **Step 5: Apply only current-room envelopes and stop optimistic room entry**

Change `game-update` to:

```ts
socket.on('game-update', ({ roomId, state }) => {
  if (!shouldApplyGameUpdate(get().currentRoomId, roomId)) return;
  const prev = get().gameState;
  const pending = get().pendingAction;
  const completed = pending && (state.handNumber !== pending.handNumber || state.actionSeq > pending.actionSeq);
  set({ gameState: state, ...(completed ? { pendingAction: null } : {}) });
  for (const event of diffGameState(prev, state, get().myPlayerId)) emitGameEvent(event);
});
```

`joinRoom()` sets only `pendingRoomId`, not `currentRoomId`. `room-joined` is the only handler that sets
`currentRoomId`. Join ack failure and timeout clear `pendingRoomId` and set `joinError` without clearing an existing
`currentRoomId` or `gameState`.

Delete the global `socket.on('error')` handler. `join-room` and `create-room` callbacks update lobby errors only;
`player-action` updates `tableNotice`; `leave-room`, chat, sit-out, and time-bank failures leave the current snapshot
intact. `createRoom()` closes its modal on a successful ack and exposes the Korean ack message on failure.

- [ ] **Step 6: Send versioned actions only while connected**

In `sendAction()` require `socket.connected`, `currentRoomId`, `gameState`, and no `pendingAction`. Capture the
version, set pending, then emit:

```ts
socket.emit('player-action', {
  roomId: currentRoomId,
  action,
  amount,
  expectedHandNumber: gameState.handNumber,
  expectedActionSeq: gameState.actionSeq,
}, ack => {
  if (ack.ok) {
    set({ pendingAction: null, tableNotice: null });
  } else {
    set({ pendingAction: null, tableNotice: actionFailureMessage(ack.code) });
    if (ack.code === 'stale-state') socket.emit('resync');
  }
});
```

Start a 3-second module-level action-ack timer. On expiry, clear pending, set the timeout message through
`actionFailureMessage('join-timeout')`, and emit `resync` only if still connected. Clear the timer on ack,
room update completion, room leave, room loss, and disconnect. Guard chat/sitout/timebank/create/join with
`socket.connected` so Socket.IO cannot buffer them offline.

- [ ] **Step 7: Surface state and disable action controls**

Keep the lobby visible while `pendingRoomId` is set and show `입장 확인 중…` near the selected room. In
`GameRoomView`, render a compact banner below `TopBar` for `reconnecting`, `replaced`, or `tableNotice`.
Pass `disabled={!connected || !!pendingAction}` behavior into every ActionBar action, time-bank, and sit-out button;
show `액션 확인 중…` in the waiting line while pending.

- [ ] **Step 8: Run client state, integration, lint, and type checks**

Run:

```bash
npm test -- src/lib/store/realtime-state.test.ts src/server/socket-handler.integration.test.ts
npx tsc --noEmit
npm run lint
```

Expected: all tests pass, TypeScript exits 0, ESLint exits 0 with no render-purity error.

- [ ] **Step 9: Commit Task 7**

```bash
git add src/lib/store/realtime-state.ts src/lib/store/realtime-state.test.ts src/lib/store/game-store.ts src/app/page.tsx src/components/layout/GameRoomView.tsx src/components/table/ActionBar.tsx
git commit -m "feat: 재연결과 액션 응답 상태를 UI에 반영"
```

## Task 8: Six-user concurrency and complete protocol regression matrix

**Files:**
- Modify: `src/server/socket-handler.integration.test.ts`
- Modify: `src/server/socket-test-harness.ts`

- [ ] **Step 1: Add simultaneous six-user and seventh-user tests**

Create a `humans` room with six seats. Connect six distinct stable tokens and emit all joins through
`Promise.all`. Assert all acks succeed, the engine contains six humans, and both player IDs and seat indexes have
Set size 6. Connect a seventh client that already owns a seat in a different room; attempt the full target and
assert `room-full`, target remains six, and the source still contains the seventh player.

- [ ] **Step 2: Add latest-socket mutation denial**

After takeover, call the server-side old socket listener path only through the disconnected client and wait 50ms;
assert its former seat and current room state do not change. Also assert the replaced disconnect did not set
`isDisconnected` on the player or start grace for the current session.

- [ ] **Step 3: Add reconnect resync exactly-once state assertions**

Seat a client, disconnect it, reconnect the same token within the harness 50ms grace, and assert player ID, seat,
and chips are unchanged. Count `다시 연결됐어요!` chat messages before and after explicit `resync`; assert the
count increases by one total, not twice. Implement this by changing `RoomManager.handleReconnect()` to send the
message only when `player.isDisconnected` was true before clearing it.

- [ ] **Step 4: Run the complete first-phase suite**

Run:

```bash
npm test -- src/server/socket-handler.integration.test.ts src/server/socket-payload.test.ts src/server/session-manager.test.ts src/lib/store/realtime-state.test.ts
```

Expected: all real-socket and pure protocol tests pass with unique seats, no cross-room updates, one duplicate
action rejected, malformed input survived, takeover enforced, and reconnect restored once.

- [ ] **Step 5: Commit Task 8**

```bash
git add src/server/socket-handler.integration.test.ts src/server/socket-test-harness.ts src/server/room-manager.ts
git commit -m "test: 6인 동시 접속과 재접속 프로토콜 회귀 고정"
```

## Task 9: Contract documentation and phase verification

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Document the authoritative realtime contract**

Add an architecture bullet stating:

```markdown
- **실시간 이벤트 격리**: 동일 세션 토큰은 최신 소켓 하나만 소유권을 가지며 구 소켓은
  `session-replaced` 후 서버 disconnect된다. 개인 `game-update`는 `{roomId,state}` envelope이고 서버는
  `session.roomId`, 클라는 `currentRoomId` 일치를 각각 검증한다. 플레이 액션은 클라가 본
  `expectedHandNumber`/`expectedActionSeq`를 보내며 서버 ack 전까지 중복 입력을 잠근다. 연결이 끊긴
  상태에서는 상태 변경 이벤트를 emit하지 않는다. 이 계약을 우회하면 구 탭 액션·방 상태 혼입·
  다음 스트리트 더블 액션이 재발한다. 회귀: `socket-handler.integration.test.ts`.
```

- [ ] **Step 2: Run fresh full verification for this phase**

Run in this exact order:

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```

Expected:

- Vitest: all files and tests pass, including the new real Socket.IO integration file.
- ESLint: exit 0.
- TypeScript: exit 0.
- Next production build: exit 0.

- [ ] **Step 3: Inspect cleanup and secret boundaries**

Run:

```bash
rg -n "socket\.on\(" src/server/socket-handler.ts
rg -n "game-update" src/server/socket-handler.ts src/lib/store/game-store.ts
rg -n "sessionToken|password" src/server src/lib/realtime
git diff --check
git status --short
```

Verify every data-bearing handler calls a parser, every personal update checks room ownership, and neither session
tokens nor passwords are added to game state, room list, ack data, or logs.

- [ ] **Step 4: Commit Task 9**

```bash
git add AGENTS.md
git commit -m "docs: 실시간 소켓 격리 계약 기록"
```

## Execution checkpoint

After Task 9, compare the implementation against sections 4 and 8.1 of
`docs/superpowers/specs/2026-07-15-multiplayer-reliability-ux-design.md`. Do not start the lifecycle phase until every
first-phase acceptance case has direct passing evidence. Record any behavior change discovered during real-socket
tests in the next lifecycle plan instead of silently widening this phase.
