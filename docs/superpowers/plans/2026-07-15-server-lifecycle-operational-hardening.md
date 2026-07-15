# Server Lifecycle and Operational Hardening Implementation Plan

> Execute in the existing `feat/realtime-protocol-session-isolation` worktree. Apply TDD for every behavior change and run each task's focused checks before committing.

**Goal:** Bound every long-lived in-memory collection and timer, cleanly expire rooms/sessions, and make the single-machine Fly deployment observable and safely stoppable without weakening the server-authoritative poker model.

**Architecture:** `SessionManager` owns session reclamation, while `RoomManager.disposeRoom()` becomes the only room deletion path. Socket handlers translate room disposal into `room-lost` and session cleanup. HTTP health, Socket.IO origin policy, rate limiting, and process shutdown are factored into pure/testable helpers around the existing custom server.

**Tech stack:** TypeScript, Socket.IO, Node HTTP, Next.js custom server, Vitest fake timers and real ephemeral sockets.

---

## Task 1: Reclaim idle sessions and expose bounded stats

**Files:**
- Modify: `src/server/session-manager.ts`
- Modify: `src/server/session-manager.test.ts`
- Modify: `src/server/socket-handler.ts`
- Modify: `src/server/socket-handler.integration.test.ts`

1. Add failing tests proving:
   - a disconnected lobby-only session is removed immediately;
   - a grace-expired cash session is removed when its seat is not kept;
   - a session with a preserved room or live socket is not removed;
   - stats report exact session/socket/grace counts.
2. Run `npm test -- src/server/session-manager.test.ts src/server/socket-handler.integration.test.ts` and confirm RED for the missing release API.
3. Add `SessionManager.releaseIfIdle(session): boolean`, `releaseByPlayerId(playerId)`, and `stats()`.
   A session is releasable only when `socketId === null`, `roomId === null`, and `graceTimer === null`.
4. In socket disconnect, release sessions with no room after detach. At grace expiry, clear `roomId` and release only when `RoomManager.handleGraceExpired()` says the seat was not kept.
5. Run the focused tests, `npx tsc --noEmit`, and `npm run lint`.
6. Commit: `fix: 좌석 없는 세션을 수명주기에 맞춰 회수`

## Task 2: Centralize chat retention and persistent-room reset

**Files:**
- Create: `src/server/room-manager.lifecycle.test.ts`
- Modify: `src/server/room-manager.ts`

1. Add failing fake-timer tests proving:
   - 150 mixed player/system/bot messages leave exactly the newest 100;
   - `getChatHistory()` returns a copy that cannot mutate internal history;
   - after the last human leaves a persistent room, players/chat are empty and `handNumber`, `actionSeq`, `lastAction`, and `lastAggressorId` are reset.
2. Run `npm test -- src/server/room-manager.lifecycle.test.ts` and confirm RED for unbounded system/bot chat and stale reset counters.
3. Route player, bot, and system chat through one `appendChatMessage()` helper with a 100-message slice.
4. Return a cloned array from `getChatHistory()`.
5. Replace field-by-field persistent reset with a fresh `PokerEngine(room.config, roomId)` after clearing every room timer and chat history. Preserve only room config, creation metadata, and `persistent`.
6. Run lifecycle, sit-out, room-list, engine leave, type, and lint checks.
7. Commit: `fix: 채팅 상한과 영속 방 초기화를 일원화`

## Task 3: Make room disposal authoritative and retain finished SnG briefly

**Files:**
- Modify: `src/server/room-manager.ts`
- Modify: `src/server/room-manager.lifecycle.test.ts`
- Modify: `src/server/ai-dialogue.ts`
- Modify: `src/server/dialogue-manager.ts`
- Modify: `src/server/socket-handler.ts`
- Modify: `src/server/socket-test-harness.ts`
- Modify: `src/server/socket-handler.integration.test.ts`

1. Add failing tests proving `disposeRoom(roomId)` clears:
   - bot, start, turn, sit-out, finished-room timers;
   - deadlines, epochs, tournament clocks, chat, AI room cooldown, and the room itself;
   - a second disposal is harmless.
2. Add a real-socket test with a short retention option: an occupied finished SnG expires, emits one `room-lost`, clears every participant session's `roomId`, and disappears from the room list.
3. Add `RoomManagerOptions { sngRetentionMs?: number }`, a finished-room timer Map, room-disposal callback, and runtime stats for tests.
4. Implement idempotent `disposeRoom()` and replace every direct `rooms.delete()`/partial cleanup path with it. `shutdown()` calls `disposeRoom()` for all rooms and then closes shared dialogue persistence.
5. Add `AIDialogue.disposeScope(roomId)` and forward it through `DialogueManager.disposeScope()`; add `DialogueManager.shutdown()` for its persist timer.
6. When a tournament first reaches `finished`, retain it for 10 minutes. Dispose immediately if all humans fully leave first. On timed disposal, the socket layer leaves rooms, emits `room-lost`, clears matching session room IDs, and prunes offline sessions.
7. Run lifecycle, SnG, socket integration, type, and lint checks.
8. Commit: `fix: 방 dispose와 종료 토너먼트 보존 수명주기 추가`

## Task 4: Add health endpoint and production origin policy

**Files:**
- Create: `src/server/http-handler.ts`
- Create: `src/server/http-handler.test.ts`
- Create: `src/server/socket-origin.ts`
- Create: `src/server/socket-origin.test.ts`
- Modify: `src/server/index.ts`
- Modify: `fly.toml`

1. Add failing tests proving:
   - `GET /healthz` returns 200 JSON `{ok:true}` without calling the Next handler;
   - debug-log routing remains protected;
   - production allows no-origin clients, same-host origins, and explicit `SOCKET_ALLOWED_ORIGINS`, but rejects unrelated origins;
   - development remains permissive.
2. Extract the special HTTP routing into `createHttpRequestHandler(nextHandler)` and keep the debug ring buffer in the custom-server process.
3. Implement `isSocketOriginAllowed(origin, host, options)` and use Socket.IO `allowRequest` in production. Parse the allow-list as comma-separated exact origins.
4. Change the Fly health check path from `/` to `/healthz`.
5. Run the new tests, server integration, type, lint, and build.
6. Commit: `feat: 헬스체크와 소켓 오리진 운영 경계 추가`

## Task 5: Bound high-frequency socket requests

**Files:**
- Create: `src/server/socket-rate-limit.ts`
- Create: `src/server/socket-rate-limit.test.ts`
- Modify: `src/server/socket-handler.ts`
- Modify: `src/server/socket-handler.integration.test.ts`

1. Add fake-clock unit tests for a sliding-window limiter and real-socket burst tests that assert `rate-limited` acks while the socket remains usable.
2. Cover these per-socket policies:
   - player action: 12 per 2 seconds;
   - join: 5 per 10 seconds;
   - resync plus get-rooms: 10 per 5 seconds;
   - create-room: 1 per 5 seconds;
   - chat: 1 per 700ms.
3. Implement one limiter per connection. Apply it after ownership/payload checks and before mutation. Do not log rate-limited payloads or amplify stdout.
4. Remove the ad-hoc room/chat timestamp fields after equivalent behavior is covered.
5. Run limiter, socket integration, engine action, type, and lint checks.
6. Commit: `fix: 소켓 요청 빈도를 슬라이딩 윈도우로 제한`

## Task 6: Gracefully stop the custom server

**Files:**
- Create: `src/server/server-shutdown.ts`
- Create: `src/server/server-shutdown.test.ts`
- Modify: `src/server/index.ts`

1. Add failing tests with fake closeable resources proving shutdown is idempotent and closes runtime, Socket.IO, HTTP, and Next in order even when one close reports an error.
2. Implement a single `shutdown(reason)` controller. Stop accepting new work, dispose runtime timers/sessions, close Socket.IO and HTTP, then close Next.
3. Register `SIGTERM` and `SIGINT` once after successful listen. Set a bounded forced-exit fallback for production, but clear it after clean completion.
4. Ensure startup rejection logs once and exits nonzero.
5. Run shutdown, HTTP, socket integration, type, lint, and build checks.
6. Commit: `feat: 커스텀 서버 정상 종료 경로 추가`

## Task 7: Dependency and build-root audit

**Files:**
- Possibly modify: `next.config.ts`, `package.json`, `package-lock.json`
- Create or modify only if evidence requires it.

1. Run `npm audit --omit=dev` and `npm audit` and record production versus development findings.
2. If production dependencies are vulnerable, apply the smallest non-breaking direct upgrade, then rerun the full suite and build. Do not run destructive `npm audit fix --force`.
3. Reproduce the Next workspace-root warning outside the nested worktree. If it also affects the real repository, set an explicit `turbopack.root` using the config directory; otherwise document it as a worktree-only warning and do not change app behavior.
4. Commit only if files change: `chore: 의존성과 빌드 루트 경고 정리`

## Task 8: Document and verify the lifecycle phase

**Files:**
- Modify: `AGENTS.md`

1. Document session pruning, `disposeRoom()`, 100-message chat retention, persistent-room clean reset, finished-SnG retention, `/healthz`, origin policy, request limits, and graceful shutdown.
2. Run in order:
   - `npm test`
   - `npm run lint`
   - `npx tsc --noEmit`
   - `npm run build`
3. Audit direct room deletion, timer creation, chat append, session token/password exposure, and process signal registration with `rg`.
4. Confirm runtime shutdown leaves no delayed test output or open-handle warning.
5. Commit: `docs: 서버 수명주기와 운영 계약 기록`

## Phase checkpoint

Do not begin the remaining UX/chat polish until every lifecycle acceptance case in design section 8.2 has direct passing evidence. Any behavior discovered outside this scope is recorded for the UX plan instead of silently widening lifecycle code.
