# Poker Arena Seasons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 구매할 수 없는 동일한 경기권으로 참여하는 6-max Sit & Go 포커 아레나를 만들고, 배치·숨은 MMR 매칭·주간 그룹 승강·4주 시즌·cosmetic 보상을 서버 권위로 운영한다.

**Architecture:** `ArenaService`가 시즌·경기권·점수·MMR·그룹·보상을 SQLite 트랜잭션으로 관리하고, 인메모리 `ArenaMatchmaker`는 전용 큐의 대기자 선택만 담당한다. 공식 매치가 형성되면 경기권을 escrow로 옮기고 Arena 전용 RoomManager 방을 생성한다. 결과가 한 번 확정될 때 경기권을 소각하고 점수/MMR을 반영하며, 프로세스 재시작으로 결과가 없어진 매치는 void 처리해 escrow 경기권을 반환한다.

**Tech Stack:** TypeScript 5, `node:sqlite`, Socket.IO 4, 기존 6-max PokerEngine/SnG blind schedule, Zustand 5, React 19, Vitest 4, Fly.io 단일 머신

---

## 전제와 파일 구조

[1단계 익명 프로필·칩 경제 계획](./2026-07-16-anonymous-profile-chip-economy.md)과 [2단계 성장·수집 계획](./2026-07-16-dojo-progression-collection.md)이 먼저 완료되어야 한다. Arena는 wallet chip, cash rake, casual SnG fee를 사용하지 않는다. Arena 점수·경기권·MMR은 구매·선물·칩 전환이 불가능하다.

새 파일:

- `src/lib/arena/types.ts` — 시즌·티어·큐·리더보드 공개 DTO
- `src/lib/arena/rules.ts` — 점수·배치·동점·승강·soft reset 순수 규칙
- `src/lib/arena/rules.test.ts` — 모든 경계 수치 테스트
- `src/lib/arena/mmr.ts` — 숨은 multiplayer Elo 계산
- `src/lib/arena/mmr.test.ts` — MMR 대칭·clamp·봇 상대 테스트
- `src/lib/arena/config.ts` — version 1 시즌/큐/봇 구성
- `src/server/arena-repository.ts` — season/ticket/match/group/reward SQL
- `src/server/arena-repository.test.ts` — row guard·unique constraint·mapping 테스트
- `src/server/arena-service.ts` — 트랜잭션과 exactly-once 정산
- `src/server/arena-service.test.ts` — 경기권·배치·결과·시즌 테스트
- `src/server/arena-matchmaker.ts` — 60초 전용 큐와 MMR 범위 확대
- `src/server/arena-matchmaker.test.ts` — 사람 수·봇 충원·training offer 테스트
- `src/server/arena-runtime.ts` — match room 생성·결과·void 어댑터
- `src/server/arena-runtime.test.ts` — RoomManager 통합과 crash recovery
- `src/server/arena-scheduler.ts` — KST 주/시즌 lazy+timer 정산
- `src/server/arena-scheduler.test.ts` — 월요일·4주 경계·재실행 테스트
- `src/server/arena-http.ts` — snapshot·그룹/글로벌 leaderboard API
- `src/server/arena-http.test.ts` — 공개 필드·pagination·인증 테스트
- `src/server/arena-metrics.ts` — 익명 일별 집계와 queue histogram
- `src/server/arena-metrics.test.ts` — 개인 식별자 미저장 테스트
- `src/lib/store/arena-store.ts` — queue/season/ticket/result 클라이언트 상태
- `src/lib/store/arena-store.test.ts` — socket 상태 전이 테스트
- `src/server/arena-load.test.ts` — fake-clock 100명 queue 부하·timer 누수 테스트
- `src/components/arena/ArenaLobby.tsx`
- `src/components/arena/ArenaQueuePanel.tsx`
- `src/components/arena/ArenaLeaderboard.tsx`
- `src/components/arena/ArenaSeasonRewards.tsx`
- `src/components/arena/ArenaResultSummary.tsx`
- `src/components/arena/ArenaTrainingOffer.tsx`

수정 파일:

- `src/server/persistence/migrations.ts` — migration version 3
- `src/lib/poker/types.ts`, `src/lib/poker/engine.ts`, `src/lib/poker/engine.sng.test.ts` — Arena prize 0과 match metadata
- `src/lib/collection/catalog.ts`, 관련 테스트 — 시즌 reward item factory
- `src/server/room-manager.ts`, `src/server/socket-handler.ts`, `src/server/index.ts` — 전용 room/queue/runtime
- `src/lib/realtime/protocol.ts` — Arena client/server events
- `src/server/session-manager.ts` — 한 profile의 queue/active seat 배타성 확인에 사용할 현재 session 조회
- `src/server/http-handler.ts` — leaderboard route
- `src/app/page.tsx`, `src/components/lobby/EconomyBar.tsx`, `src/components/layout/GameRoomView.tsx`, `src/components/table/TournamentResultOverlay.tsx` — Arena UX
- `fly.toml`, `deploy/README.md` — feature flag·season epoch·공개 출시 gate

## Version 1 고정 규칙

```ts
export const ARENA_CONFIG_V1 = {
  version: 1,
  seasonWeeks: 4,
  startingTickets: 2,
  dailyTickets: 2,
  ticketCap: 10,
  queueTimeoutMs: 60_000,
  queueInitialMmrRange: 100,
  queueRangeStep: 50,
  queueRangeStepMs: 10_000,
  queueFallbackAtMs: 60_000,            // 이후 MMR 차이와 무관하게 oldest-first
  minimumHumansForOfficial: 2,
  seats: 6,
  startingStack: 1_500,
  placementMatches: 5,
  pointsByPlace: [100, 60, 35, 15, 5, 0],
  promotionGamesRequired: 3,
  weeklyMoveRate: 0.20,
  targetGroupMin: 20,
  targetGroupMax: 30,
  initialMmr: 1_000,
  placementMmrK: 48,
  normalMmrK: 32,
  mmrDeltaCap: 32,
  botVersion: 'arena-v1-hard',
} as const;
```

티어 순서는 `bronze, silver, gold, platinum, diamond, master`다. 배치 5경기 점수 합은 0~174 Bronze, 175~324 Silver, 325~500 Gold다. placement 경기 자체는 주간 그룹 점수에 포함하지 않고, 배치 완료 후 다음 공식전부터 그룹에 들어간다.

경기권 상태는 다음 전이만 허용한다.

```text
available --match formed--> escrow --result committed--> consumed
                                  \--match void-------> available
```

`available + active escrow <= 10`을 일일 충전과 refund 모두에서 지킨다. UI의 사용 가능 수는 available만 표시한다.

### Task 1: 점수·배치·MMR·승강 순수 규칙 구현

**Files:**
- Create: `src/lib/arena/types.ts`
- Create: `src/lib/arena/config.ts`
- Create: `src/lib/arena/rules.ts`
- Test: `src/lib/arena/rules.test.ts`
- Create: `src/lib/arena/mmr.ts`
- Test: `src/lib/arena/mmr.test.ts`

- [ ] **Step 1: placement와 동점 규칙 실패 테스트 작성**

```ts
expect(pointsForPlace(1)).toBe(100);
expect(pointsForPlace(6)).toBe(0);
expect(tierForPlacementTotal(174)).toBe('bronze');
expect(tierForPlacementTotal(175)).toBe('silver');
expect(tierForPlacementTotal(324)).toBe('silver');
expect(tierForPlacementTotal(325)).toBe('gold');
expect(tierForPlacementTotal(500)).toBe('gold');
```

동점 comparator는 주간 점수 내림차순 → 우승 수 → top3 수 → 평균 순위 오름차순 → 그 점수에 먼저 도달한 시각 → profile id 안정 정렬을 검증한다.

- [ ] **Step 2: 승강 경계 실패 테스트 작성**

5명/20명/30명 그룹, 3경기 미달, Bronze 강등 없음, Master 승급 없음, 4명 그룹 no-demotion+top1 조건을 table test로 작성한다.

- [ ] **Step 3: 테스트 실패 확인**

Run: `npm test -- src/lib/arena/rules.test.ts`

Expected: FAIL with missing Arena rule modules.

- [ ] **Step 4: 순수 점수·배치·정렬 구현**

`averagePlace`는 `placeSum / matches`, 경기 0은 Infinity다. 마지막 안정 tie-break profile ID는 결과를 결정론화할 뿐 사용자 UI에는 표시하지 않는다.

- [ ] **Step 5: 승강 선택 구현**

인원 5 이상은 `max(1, floor(n * 0.2))`명이다. 승급 후보는 주간 3경기 이상인 사람 중 정렬 상위, 강등 후보는 전체 정렬 하위다. Bronze는 강등 배열을 비우고 Master는 승급 배열을 비운다. 인원 5 미만은 강등 0명, 3경기 이상인 최상위 1명만 승급한다.

- [ ] **Step 6: soft reset 구현**

시즌 종료 tier에서 정확히 한 단계 아래로 이동하며 Bronze는 Bronze를 유지한다. 다음 시즌 placement는 다시 하지 않고 reset tier에서 시작하며 hidden MMR은 `round(1000 + (oldMmr - 1000) * 0.5)`로 중앙 회귀한다.

- [ ] **Step 7: multiplayer Elo 실패 테스트 작성**

```ts
expect(calculateMmrDelta({ playerMmr: 1000, opponentMmrs: [1000,1000,1000,1000,1000], place: 1, k: 32 })).toBe(16);
expect(calculateMmrDelta({ playerMmr: 1000, opponentMmrs: [1000,1000,1000,1000,1000], place: 6, k: 32 })).toBe(-16);
```

- [ ] **Step 8: MMR 구현**

실제 성적은 `(6 - place) / 5`, 기대값은 다섯 상대에 대한 Elo expected score 평균이다. `round(k * (actual - expected))` 후 ±32 clamp한다. placement 5경기는 K=48을 넣되 최종 delta cap은 ±32를 유지한다. 봇 MMR은 match config에 snapshot된 값으로 상대 배열에 포함한다.

- [ ] **Step 9: 순수 규칙 테스트 통과 확인**

Run: `npm test -- src/lib/arena/rules.test.ts src/lib/arena/mmr.test.ts`

Expected: PASS for all six places, placement boundaries, tie order, small groups, edge tiers, reset, MMR symmetry and clamp.

- [ ] **Step 10: Arena 규칙 커밋**

```bash
git add src/lib/arena
git commit -m "feat: define poker arena competitive rules"
```

### Task 2: Arena migration과 repository 구축

**Files:**
- Modify: `src/server/persistence/migrations.ts`
- Modify: `src/server/persistence/database.test.ts`
- Create: `src/server/arena-repository.ts`
- Test: `src/server/arena-repository.test.ts`

- [ ] **Step 1: migration version 3 실패 테스트 작성**

```ts
expect(database.latestMigration()).toBe(3);
expect(database.tableNames()).toEqual(expect.arrayContaining([
  'arena_seasons', 'arena_profiles', 'arena_ticket_escrows',
  'arena_matches', 'arena_entries', 'arena_groups',
  'arena_group_members', 'arena_weekly_settlements', 'arena_season_rewards',
]));
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/server/persistence/database.test.ts`

Expected: FAIL because latest migration is 2.

- [ ] **Step 3: version 3 핵심 schema 작성**

```sql
CREATE TABLE arena_profiles (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  season_id TEXT NOT NULL REFERENCES arena_seasons(id),
  available_tickets INTEGER NOT NULL CHECK (available_tickets BETWEEN 0 AND 10),
  last_daily_grant_date TEXT NOT NULL,
  placement_games INTEGER NOT NULL CHECK (placement_games BETWEEN 0 AND 5),
  placement_points INTEGER NOT NULL CHECK (placement_points BETWEEN 0 AND 500),
  tier TEXT CHECK (tier IN ('bronze','silver','gold','platinum','diamond','master')),
  mmr INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE arena_ticket_escrows (
  match_id TEXT NOT NULL,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('escrow','consumed','refunded')),
  created_at INTEGER NOT NULL,
  settled_at INTEGER,
  PRIMARY KEY(match_id, profile_id)
) STRICT;
```

`arena_matches`는 season/config/bot version, status `forming|playing|finished|void`, created/started/finished time을 가진다. `arena_entries`는 place/points/MMR before-after/result key를, group member는 주간 통계와 `score_reached_at`을 가진다.

- [ ] **Step 4: unique/idempotency 제약 추가**

`arena_entries(match_id,profile_id)`, `arena_weekly_settlements(season_id,week_key,group_id)`, `arena_season_rewards(season_id,profile_id,item_id)`를 unique로 만든다. 한 profile의 active match escrow가 하나뿐이도록 partial unique index를 추가한다.

- [ ] **Step 5: repository read/write row mapping 구현**

SQL row의 tier/status를 런타임 guard로 검증하고 공개 DTO mapper는 `mmr`, 내부 IDs, profile credential을 제외한다.

- [ ] **Step 6: migration·제약 테스트 통과 확인**

Run: `npm test -- src/server/persistence/database.test.ts src/server/arena-repository.test.ts`

Expected: PASS for migration, row guards, active escrow uniqueness, and duplicate result keys.

- [ ] **Step 7: Arena 저장 계층 커밋**

```bash
git add src/server/persistence/migrations.ts src/server/persistence/database.test.ts src/server/arena-repository.ts src/server/arena-repository.test.ts
git commit -m "feat: add poker arena persistence schema"
```

### Task 3: 4주 시즌과 경기권 lifecycle 구현

**Files:**
- Create: `src/server/arena-service.ts`
- Create: `src/server/arena-service.test.ts`
- Create: `src/server/arena-scheduler.ts`
- Test: `src/server/arena-scheduler.test.ts`
- Modify: `src/server/index.ts`
- Modify: `fly.toml`

- [ ] **Step 1: 시즌 window 실패 테스트 작성**

epoch `2026-07-20T00:00:00+09:00`에서 4주 구간, week 1~4, 정확한 월요일 00:00 KST 경계를 검증한다. 첫 구간은 `preseason: true`, 다음 구간부터 false다.

- [ ] **Step 2: 신규·일일 경기권 실패 테스트 작성**

신규 profile은 생성일 2장, 같은 날 추가 grant 없음, 다음 KST 날짜 +2, 여러 날 미접속 후 접속해도 누적 이월 없이 한 번 +2, 9→10 cap, escrow 포함 total cap을 검증한다.

- [ ] **Step 3: 실패 확인**

Run: `npm test -- src/server/arena-service.test.ts src/server/arena-scheduler.test.ts`

Expected: FAIL with missing Arena service/scheduler.

- [ ] **Step 4: season epoch config와 계산 구현**

production env `ARENA_SEASON_EPOCH_KST`를 필수로 파싱하고 Fly 기본값은 `2026-07-20T00:00:00+09:00`으로 둔다. `ARENA_PRESEASON_COUNT=1`, `ARENA_ENABLED=false`를 기본으로 설정한다. invalid offset/월요일 아님이면 startup을 실패시킨다.

- [ ] **Step 5: lazy season/profile initialization 구현**

snapshot이나 queue 진입 시 현재 season row를 `INSERT OR IGNORE`하고 profile을 starting tickets 2, placement 0, MMR 1000으로 만든다. 생성 KST date를 last grant date로 기록해 첫날 총 2장만 준다.

- [ ] **Step 6: 일일 자동 충전 구현**

마지막 grant date보다 오늘이 뒤면 정확히 +2만 시도한다. 여러 날 미접속을 이월하지 않는다. `available + activeEscrow`를 10까지 채우고 last date는 오늘로 갱신한다.

- [ ] **Step 7: ticket escrow 트랜잭션 구현**

`reserveMatchTickets(matchId, profileIds)`가 각 available에서 1을 빼고 escrow row를 만든다. 하나라도 부족하거나 active escrow/seat가 있으면 전체 rollback한다. 결과 확정은 consumed, void는 available에 1을 되돌리고 refunded로 바꾼다. daily grant가 active escrow를 cap 계산에 포함하므로 void refund로 10을 넘지 않는다.

- [ ] **Step 8: scheduler의 timer+startup reconciliation 구현**

startup, 다음 KST 월요일 00:00, 다음 season boundary에 `reconcile()`을 실행한다. 실제 settlement는 unique row로 멱등이어야 하며 timer는 매번 다음 절대 시각을 다시 계산한다.

- [ ] **Step 9: 시즌·경기권 테스트 통과 확인**

Run: `npm test -- src/server/arena-service.test.ts src/server/arena-scheduler.test.ts`

Expected: PASS for epoch, four weeks, preseason, grant no-carry, cap, reserve rollback, consume, void refund, repeated reconcile.

- [ ] **Step 10: 시즌·경기권 커밋**

```bash
git add src/server/arena-service.ts src/server/arena-service.test.ts src/server/arena-scheduler.ts src/server/arena-scheduler.test.ts src/server/index.ts fly.toml
git commit -m "feat: add arena seasons and free tickets"
```

### Task 4: 60초 숨은 MMR 전용 매칭 구현

**Files:**
- Create: `src/server/arena-matchmaker.ts`
- Test: `src/server/arena-matchmaker.test.ts`
- Modify: `src/server/session-manager.ts`
- Modify: `src/server/socket-handler.ts`
- Modify: `src/server/index.ts`
- Modify: `src/lib/realtime/protocol.ts`
- Modify: `src/server/socket-handler.integration.test.ts`

- [ ] **Step 1: queue 범위 확대 실패 테스트 작성**

fake clock으로 0초 ±100, 10초 ±150, 50초 ±350, 60초 이후 제한 해제를 검증한다. 60초 전에는 두 profile이 서로의 현재 허용 범위 안에 있을 때만 compatible이고, 60초가 된 가장 오래된 대기자는 MMR 차이와 무관하게 다음 대기자와 매칭할 수 있다.

- [ ] **Step 2: 2~6명 official/1명 training 실패 테스트 작성**

60초 시점 compatible 사람 2명이면 official match candidate와 봇 4석, 6명이면 봇 0석, 1명이면 match 없이 training offer가 나와야 한다.

- [ ] **Step 3: 실패 확인**

Run: `npm test -- src/server/arena-matchmaker.test.ts`

Expected: FAIL with missing matchmaker.

- [ ] **Step 4: 큐 상태와 공정 선택 구현**

queue entry는 `{ profileId, socketId, mmr, joinedAt }`만 메모리에 둔다. 가장 오래 기다린 entry를 anchor로 하고 compatible entry를 `joinedAt`, 그다음 profileId 순으로 최대 6명 선택한다. IP/device를 저장하거나 매칭 키로 쓰지 않는다.

- [ ] **Step 5: 배타성 guard 구현**

queue 진입 시 Arena enabled, authenticated profile, available ticket ≥1, active escrow 없음, 다른 room 좌석 없음, 이미 queue 아님을 확인한다. queue에 있는 동안 일반 `join-room`을 시도하면 서버가 일반 입장을 거부하고, 클라이언트가 queue를 명시적으로 취소해 확인 응답을 받은 뒤 다시 입장하게 한다.

- [ ] **Step 6: queue socket 계약 구현**

```ts
// Client -> Server
'arena-queue-join': (ack?: AckCallback) => void;
'arena-queue-leave': (ack?: AckCallback) => void;
'arena-training-accept': (data: { offerId: string }, ack?: AckCallback) => void;

// Server -> Client
'arena-queue-update': (data: ArenaQueueState) => void;
'arena-training-offered': (data: { offerId: string; expiresAt: number }) => void;
'arena-match-found': (data: { matchId: string }) => void;
```

- [ ] **Step 7: training offer lifecycle 구현**

사람 1명뿐이면 queue에서 제거하고 30초 유효 offer를 만든다. 수락하면 경기권 reserve 없이 training room을 만들고, 만료/거절이면 아무 상태도 바꾸지 않는다. training은 score/MMR/group/season stats를 기록하지 않는다.

- [ ] **Step 8: disconnect·중복 join 정리 구현**

queue 중 disconnect는 즉시 제거한다. match candidate가 DB reserve 전에 disconnect하면 후보 전체를 queue로 되돌린다. reserve 뒤 room join 실패는 match void와 ticket refund 후 연결된 사람만 새 joinedAt으로 queue에 재등록한다.

- [ ] **Step 9: matchmaker와 socket 통합 테스트 통과 확인**

Run: `npm test -- src/server/arena-matchmaker.test.ts src/server/socket-handler.integration.test.ts`

Expected: PASS for MMR range, oldest-first, 2/6 humans, one-person training, ticket/seat guard, disconnect, duplicate queue, no IP persistence.

- [ ] **Step 10: 매칭 커밋**

```bash
git add src/server/arena-matchmaker.ts src/server/arena-matchmaker.test.ts src/server/session-manager.ts src/server/socket-handler.ts src/server/index.ts src/lib/realtime/protocol.ts src/server/socket-handler.integration.test.ts
git commit -m "feat: add dedicated arena matchmaking queue"
```

### Task 5: Arena room과 exactly-once 결과 정산 구현

**Files:**
- Create: `src/server/arena-runtime.ts`
- Test: `src/server/arena-runtime.test.ts`
- Modify: `src/lib/poker/types.ts`
- Modify: `src/lib/poker/engine.ts`
- Modify: `src/lib/poker/engine.sng.test.ts`
- Modify: `src/server/room-manager.ts`
- Modify: `src/server/arena-service.ts`
- Modify: `src/server/arena-service.test.ts`
- Modify: `src/server/socket-handler.ts`
- Modify: `src/server/index.ts`

- [ ] **Step 1: Arena engine config 실패 테스트 작성**

Arena official/training 모두 6-max, starting stack 1500, 기존 `SNG_BLIND_SCHEDULE`, `TournamentState.prizes=[]`, 결과 prize 0, rake 0인지 검증한다.

- [ ] **Step 2: 결과·void 실패 테스트 작성**

official result는 ticket consumed+placement points+MMR을 한 번만 반영한다. 같은 결과 재호출은 기존 summary를 반환한다. process restart에서 playing match는 void+ticket refund이고 점수/MMR 변화가 없어야 한다.

- [ ] **Step 3: 실패 확인**

Run: `npm test -- src/lib/poker/engine.sng.test.ts src/server/arena-runtime.test.ts`

Expected: FAIL because Arena room mode does not exist.

- [ ] **Step 4: RoomConfig Arena metadata 추가**

```ts
competitionMode?: 'arena-official' | 'arena-training';
arenaMatchId?: string;
arenaBotVersion?: string;
```

`competitionMode`이 있으면 `gameMode='sng'`, `economyMode='arena'`, tableType mixed를 강제한다. room list에는 전용 queue 방을 노출하지 않는다.

- [ ] **Step 5: engine의 non-chip prize path 구현**

`startTournament()`에서 Arena는 `prizes=[]`를 유지하고 `recordFinish`의 prize는 0이다. 결과 place와 기존 동시 탈락 `handStartChips` tie-break는 그대로 재사용한다.

- [ ] **Step 6: match room 생성 구현**

reserve 성공 후 6개 seat에 사람 2~6명과 `arena-v1-hard` 고정 봇을 채운다. 봇 MMR snapshot은 human 평균을 50단위로 round한 값이며 800~1400 clamp한다. seat order는 server RNG로 shuffle하되 결과에 `matchConfigVersion`, `botVersion`, `botMmr`를 저장한다.

- [ ] **Step 7: 결과 트랜잭션 구현**

human마다 place points와 MMR delta를 계산한다. placementGames<5이면 placement 합/게임 수를 갱신하고 5번째에 initial tier를 정한다. 이미 배치된 profile은 group stats에 points/win/top3/place/score reached time을 반영한다. 모든 entry, profile, group, ticket escrow, match finished를 한 `BEGIN IMMEDIATE`에서 변경한다.

- [ ] **Step 8: 연결 종료 정책 유지**

공식전 시작 후 disconnect는 현재 SnG 규칙대로 seat/블라인드를 유지하고 자동 fold한다. disconnect를 이유로 ticket을 반환하지 않는다. 실제 서버 프로세스 중단이나 명시적 내부 match creation 실패만 void 사유다.

- [ ] **Step 9: startup orphan recovery 구현**

`recoverUnfinishedMatches()`가 `forming|playing` matches를 void로 바꾸고 모든 escrow를 refund한다. 프로세스 재시작 뒤 in-memory room은 존재하지 않으므로 어떤 playing match도 재개하려 하지 않는다.

- [ ] **Step 10: 통합 테스트 통과 확인**

Run: `npm test -- src/lib/poker/engine.sng.test.ts src/server/arena-service.test.ts src/server/arena-runtime.test.ts src/server/socket-handler.integration.test.ts`

Expected: PASS for official/training config, bot fill, place points, placement tier, hidden MMR update, duplicate result, disconnect continuation, crash refund.

- [ ] **Step 11: Arena 경기 런타임 커밋**

```bash
git add src/server/arena-runtime.ts src/server/arena-runtime.test.ts src/lib/poker/types.ts src/lib/poker/engine.ts src/lib/poker/engine.sng.test.ts src/server/room-manager.ts src/server/arena-service.ts src/server/arena-service.test.ts src/server/socket-handler.ts src/server/index.ts
git commit -m "feat: settle official poker arena matches"
```

### Task 6: 주간 그룹 배정·승강 정산 구현

**Files:**
- Modify: `src/server/arena-repository.ts`
- Modify: `src/server/arena-service.ts`
- Modify: `src/server/arena-service.test.ts`
- Modify: `src/server/arena-scheduler.ts`
- Modify: `src/server/arena-scheduler.test.ts`

- [ ] **Step 1: 그룹 배정 실패 테스트 작성**

배치 완료자의 다음 공식전에서만 group이 생기고, 같은 week/tier의 open group을 30명까지 채운 뒤 새 group을 생성하며, Master는 해당 week의 단일 global group을 쓰는지 검증한다.

- [ ] **Step 2: 주간 통계와 tie timestamp 실패 테스트 작성**

점수는 모든 official placement point 합, wins/top3/placeSum/matches가 한 경기씩 증가해야 한다. 같은 최종 점수면 더 일찍 그 점수에 도달한 사람이 위다. 이후 점수가 바뀌면 `score_reached_at`도 바뀐다.

- [ ] **Step 3: 실패 확인**

Run: `npm test -- src/server/arena-service.test.ts src/server/arena-scheduler.test.ts`

Expected: FAIL on missing group settlement behavior.

- [ ] **Step 4: 20~30명 group assignment 구현**

현재 tier의 가장 오래된 open group 중 member<30인 곳에 배정한다. 20명 미만이어도 week 중에는 group을 합치지 않아 순위를 이동시키지 않는다. Master는 `master-global:<seasonId>:<weekKey>` 하나만 사용해 30명 cap 예외를 둔다.

- [ ] **Step 5: Monday settlement 구현**

지난 KST week의 모든 group을 정렬하고 pure `selectWeeklyMoves` 결과를 적용한다. 승급/강등은 다음 week tier에 반영하되 종료된 group row는 불변으로 보존한다. unique settlement row가 있으면 no-op한다.

- [ ] **Step 6: 작은 그룹과 edge tier 처리 구현**

5명 미만: no demotion, 3경기 이상 top1만 promote. Bronze demotion 없음. Master promotion 없음, bottom 20% demotion은 적용한다. 한 사람이 promote와 demote 양쪽에 들 수 없도록 set 검증을 넣는다.

- [ ] **Step 7: settlement retry 원자성 구현**

group 하나의 moves와 settlement marker를 한 transaction에서 기록한다. group A 성공/group B 실패 시 재실행은 A를 건너뛰고 B부터 계속한다. season boundary와 week settlement가 같은 시각이면 week 4 settlement를 먼저 수행한다.

- [ ] **Step 8: 그룹/승강 테스트 통과 확인**

Run: `npm test -- src/server/arena-service.test.ts src/server/arena-scheduler.test.ts src/lib/arena/rules.test.ts`

Expected: PASS for group caps, Master global, all tie-breaks, 3-match minimum, 20%, small groups, edge tiers, partial retry.

- [ ] **Step 9: 주간 리그 커밋**

```bash
git add src/server/arena-repository.ts src/server/arena-service.ts src/server/arena-service.test.ts src/server/arena-scheduler.ts src/server/arena-scheduler.test.ts
git commit -m "feat: add weekly arena groups and movement"
```

### Task 7: 시즌 보상·글로벌 순위·soft reset 구현

**Files:**
- Modify: `src/lib/collection/catalog.ts`
- Modify: `src/lib/collection/catalog.test.ts`
- Modify: `src/server/arena-repository.ts`
- Modify: `src/server/arena-service.ts`
- Modify: `src/server/arena-service.test.ts`
- Modify: `src/server/arena-scheduler.ts`
- Modify: `src/server/arena-scheduler.test.ts`

- [ ] **Step 1: 시즌 보상 catalog 실패 테스트 작성**

season-scoped item factory가 participation emblem, Gold frame, Diamond featured skin, Master cut-in, top100 chroma+title, top10 numbered title 1~10, champion trophy/aura/Hall of Fame record를 모두 생성하는지 검증한다. gameplay modifier는 모두 빈 배열이다.

- [ ] **Step 2: 글로벌 순위 실패 테스트 작성**

시즌 official point 합에 주간과 같은 tie-break를 적용하고, 봇/training/placement 여부와 무관하게 모든 official human match point를 합산한다. placement도 시즌 글로벌 순위에는 포함한다.

- [ ] **Step 3: 실패 확인**

Run: `npm test -- src/lib/collection/catalog.test.ts src/server/arena-service.test.ts`

Expected: FAIL because Arena reward catalog and settlement are missing.

- [ ] **Step 4: 누적 tier reward 지급 구현**

official match 10회 이상이면 참가 emblem. final tier가 Gold 이상이면 Gold frame, Diamond 이상이면 featured skin, Master면 Master cut-in을 누적 지급한다. reward row와 inventory grant를 한 transaction에 넣는다.

- [ ] **Step 5: 글로벌 rank reward 구현**

top100은 chroma+`TOP 100`, top10은 정확한 최종 숫자가 새겨진 영구 title, rank1은 trophy+aura+Hall of Fame row를 지급한다. rank 범위 밖 profile에는 row를 만들지 않는다.

- [ ] **Step 6: preseason scarcity gate 구현**

`season.preseason=true`이면 10경기 참가 emblem만 지급하고 Gold/Master/global rank reward 및 Hall of Fame을 모두 억제한다. UI reward preview에도 “프리시즌: 희소 순위 보상 미지급”을 표시할 flag를 반환한다.

- [ ] **Step 7: soft reset와 다음 시즌 초기화 구현**

보상 정산 성공 후 각 profile tier를 한 단계 낮추고 MMR을 50% 중앙 회귀해 다음 season row로 복사한다. placementGames는 5로 유지해 재배치 없이 첫 official game부터 새 주간 group에 들어간다. 이전 시즌 데이터는 불변 보존한다.

- [ ] **Step 8: reward/season retry 테스트 통과 확인**

Run: `npm test -- src/lib/collection/catalog.test.ts src/server/arena-service.test.ts src/server/arena-scheduler.test.ts`

Expected: PASS for tier rewards, top100/10/1 boundaries, preseason suppression, duplicate settlement, reward+inventory atomicity, one-tier reset, MMR regression.

- [ ] **Step 9: 시즌 보상 커밋**

```bash
git add src/lib/collection/catalog.ts src/lib/collection/catalog.test.ts src/server/arena-repository.ts src/server/arena-service.ts src/server/arena-service.test.ts src/server/arena-scheduler.ts src/server/arena-scheduler.test.ts
git commit -m "feat: award and reset poker arena seasons"
```

### Task 8: Arena API·store·로비·리더보드 UI 구현

**Files:**
- Create: `src/server/arena-http.ts`
- Test: `src/server/arena-http.test.ts`
- Modify: `src/server/http-handler.ts`
- Modify: `src/server/index.ts`
- Create: `src/lib/store/arena-store.ts`
- Test: `src/lib/store/arena-store.test.ts`
- Create: `src/components/arena/ArenaLobby.tsx`
- Create: `src/components/arena/ArenaQueuePanel.tsx`
- Create: `src/components/arena/ArenaLeaderboard.tsx`
- Create: `src/components/arena/ArenaSeasonRewards.tsx`
- Create: `src/components/arena/ArenaResultSummary.tsx`
- Create: `src/components/arena/ArenaTrainingOffer.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/components/lobby/EconomyBar.tsx`
- Modify: `src/components/layout/GameRoomView.tsx`
- Modify: `src/components/table/TournamentResultOverlay.tsx`

- [ ] **Step 1: 공개 snapshot과 leaderboard 실패 테스트 작성**

```text
GET /api/arena
GET /api/arena/leaderboard/group?cursor=
GET /api/arena/leaderboard/global?cursor=
GET /api/arena/rewards
```

응답에는 alias, public cosmetic, score/place/matches/tier만 있고 MMR, credential, IP, recovery, wallet balance는 없어야 한다. page size는 50, cursor는 opaque signed value다.

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/server/arena-http.test.ts`

Expected: FAIL because Arena HTTP routes do not exist.

- [ ] **Step 3: API와 Cache-Control 구현**

개인 snapshot은 authenticated/no-store, group leaderboard는 5초 private cache, global leaderboard는 30초 public cache를 쓴다. feature flag off면 snapshot `{ enabled:false }`, queue socket은 `arena-disabled`를 반환한다.

- [ ] **Step 4: arena-store 상태 머신 테스트 작성**

idle→queued→training-offered 또는 match-found→playing→result의 허용 전이, queue cancel, socket reconnect snapshot 복구, duplicate result event 무시를 검증한다.

- [ ] **Step 5: arena-store 구현**

서버 deadline을 저장하고 UI count-down은 interval callback에서 state를 갱신한다. 렌더 중 `Date.now()`를 호출하지 않는다. hidden MMR field는 타입에 존재하지 않게 한다.

- [ ] **Step 6: 로비 정보 구조 구현**

기존 일반 방 영역 위에 `일반 게임 / 포커 아레나 / 수련 과제` 진입 카드를 둔다. EconomyBar에 Arena 경기권을 표시한다. ArenaLobby는 시즌 남은 기간, 배치 0/5 또는 tier, 이번 주 그룹 순위, 경기권을 우선 표시한다.

- [ ] **Step 7: queue와 training UX 구현**

대기 중 범위 숫자/MMR은 표시하지 않고 경과 시간과 “실력이 비슷한 상대를 찾는 중”만 보여준다. 60초 1인 offer는 “연습전 · 경기권/점수 사용 없음”을 명시하고 accept/로비로 버튼을 제공한다.

- [ ] **Step 8: leaderboard와 reward preview 구현**

배치 중에는 점수 합과 예상 tier를 숨기고 5/5 완료 후 공개한다. 주간 group은 본인 주변 행을 강조하고 승강선, 최소 3경기 조건, small group 예외를 설명한다. Master는 `글로벌 마스터` 라벨을 사용한다.

- [ ] **Step 9: result summary 구현**

ArenaResultSummary에 place, +points, weekly rank delta, placement progress 또는 tier를 보여준다. MMR은 보내거나 표시하지 않는다. training result에는 “연습전 결과는 시즌에 반영되지 않았어요”만 표시한다.

- [ ] **Step 10: UI/API 테스트와 정적 검증**

Run: `npm test -- src/server/arena-http.test.ts src/lib/store/arena-store.test.ts`

Expected: PASS.

Run: `npm run lint`

Expected: PASS.

Run: `npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 11: Arena UX 커밋**

```bash
git add src/server/arena-http.ts src/server/arena-http.test.ts src/server/http-handler.ts src/server/index.ts src/lib/store/arena-store.ts src/lib/store/arena-store.test.ts src/components/arena src/app/page.tsx src/components/lobby/EconomyBar.tsx src/components/layout/GameRoomView.tsx src/components/table/TournamentResultOverlay.tsx
git commit -m "feat: add poker arena lobby and leaderboards"
```

### Task 9: 익명 운영 지표·장애 복구·출시 gate 구현

**Files:**
- Create: `src/server/arena-metrics.ts`
- Test: `src/server/arena-metrics.test.ts`
- Modify: `src/server/arena-matchmaker.ts`
- Modify: `src/server/arena-runtime.ts`
- Modify: `src/server/index.ts`
- Modify: `deploy/README.md`
- Modify: `fly.toml`

- [ ] **Step 1: 개인 식별자 없는 metric 실패 테스트 작성**

metric row/JSON에 `profileId`, alias, IP, device, socketId가 없고 KST date, configVersion, botVersion, counter/histogram만 있는지 검증한다.

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/server/arena-metrics.test.ts`

Expected: FAIL with missing metrics module.

- [ ] **Step 3: 일별 aggregate 구현**

다음을 `arena_metrics_daily` upsert 또는 stdout `[arena-metric]` 집계로 기록한다.

- ticket grant/escrow/consume/refund 수
- official/training formed/completed/void 수
- queue wait histogram `0-10, 10-30, 30-60, 60+초`
- human count별 match 수 2~6
- tier 분포 snapshot
- configVersion+botVersion별 봇 place 합/경기 수

개별 match/profile ID는 metric payload에 넣지 않는다. transaction audit용 arena match table과 aggregate metric을 구분한다.

- [ ] **Step 4: health와 startup recovery 순서 구현**

startup은 DB migration → cash/SnG escrow recovery → Arena unfinished match refund → weekly/season reconcile → Socket accept 순서다. recovery 실패 시 `/healthz`는 503이고 queue를 열지 않는다.

- [ ] **Step 5: shutdown queue 정리 구현**

새 queue 진입을 닫고 아직 room이 시작되지 않은 forming match를 void/refund한다. 진행 중 공식전은 최대 graceful timeout 동안 결과를 기다리고, 프로세스가 끝나면 다음 startup recovery가 refund한다.

- [ ] **Step 6: 배포 문서의 법적/운영 gate 기록**

Arena feature flag를 true로 바꾸기 전에 다음 checkbox를 `deploy/README.md`에 둔다.

1. 대한민국 청소년이용불가 등급분류와 표시 완료
2. 웹보드게임 본인확인 의무가 현재 서비스에 적용되는지 공식 확인
3. 현금·현물·환전·양도·구매 기능 없음 재검증
4. 프리시즌 부하/봇 성적/queue p95 검증
5. SQLite volume과 암호화 백업 복원 rehearsal 완료

- [ ] **Step 7: metric/recovery 테스트 통과 확인**

Run: `npm test -- src/server/arena-metrics.test.ts src/server/arena-runtime.test.ts src/server/arena-scheduler.test.ts`

Expected: PASS for aggregate privacy, recovery order, forming/playing refunds, scheduler retry.

- [ ] **Step 8: 운영 안전장치 커밋**

```bash
git add src/server/arena-metrics.ts src/server/arena-metrics.test.ts src/server/arena-matchmaker.ts src/server/arena-runtime.ts src/server/index.ts deploy/README.md fly.toml
git commit -m "feat: harden poker arena operations"
```

### Task 10: 프리시즌 부하·전체 회귀·수용 기준 검증

**Files:**
- Create: `src/server/arena-load.test.ts`
- Verify: entire repository

- [ ] **Step 1: fake-clock 100명 queue 부하 테스트 작성**

100 profiles를 MMR 800~1400에 넣고 60초를 진행해 다음을 검증한다.

- profile은 최대 한 match에만 등장한다.
- official match는 human 2~6명이다.
- 모든 시작 match는 6석이다.
- 1명 leftover만 training offer를 받는다.
- reserve 실패 profile은 유실되지 않는다.
- queue timer/offer timer가 test 종료 후 0개다.

- [ ] **Step 2: 부하 테스트 실행**

Run: `npm test -- src/server/arena-load.test.ts`

Expected: PASS deterministically in under 5 seconds with fake timers.

- [ ] **Step 3: 집중 Arena 테스트 실행**

Run: `npm test -- src/lib/arena src/server/arena-service.test.ts src/server/arena-matchmaker.test.ts src/server/arena-runtime.test.ts src/server/arena-scheduler.test.ts src/server/arena-http.test.ts src/server/arena-metrics.test.ts src/lib/store/arena-store.test.ts src/server/arena-load.test.ts`

Expected: PASS.

- [ ] **Step 4: 전체 테스트 실행**

Run: `npm test`

Expected: PASS; 엔진/사이드팟/이탈/세션/경제/성장 회귀 포함.

- [ ] **Step 5: 정적 검증과 production build**

Run: `npm run lint`

Expected: PASS.

Run: `npx tsc --noEmit`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 6: 금지 결합 정적 검색**

Run: `rg -n "wallet|chip|payment|purchase|gift|email|phone|real.?name" src/lib/arena src/server/arena* src/components/arena`

Expected: wallet/chip은 `no wallet/chip prize` guard/test 설명 외 Arena 상태 변경에 없음; payment/purchase/gift/email/phone/real-name 수집 없음.

Run: `rg -n "mmr" src/components/arena src/lib/store/arena-store.ts src/lib/arena/types.ts`

Expected: public component/store/DTO에 MMR field 없음.

- [ ] **Step 7: 임시 표식과 승인 수치 검색**

Run: `rg -n "TO[D]O|TB[D]|place[h]older|FIX[M]E" src/lib/arena src/server/arena* src/components/arena`

Expected: no matches.

Run: `rg -n "seasonWeeks|startingTickets|dailyTickets|ticketCap|queueTimeoutMs|pointsByPlace|placementMatches|weeklyMoveRate" src/lib/arena/config.ts`

Expected: 4주, 2장, 일 +2, cap 10, 60초, 100/60/35/15/5/0, 5경기, 20%가 V1에 한 번씩 존재.

- [ ] **Step 8: 수동 프리시즌 수용 시나리오**

`ARENA_ENABLED=true`, fake 60초 clock인 staging에서 다음을 확인한다.

1. 사람 2명+봇 4명 official은 각 1장 escrow되고 결과 뒤 소각된다.
2. 사람 1명은 training offer만 받고 경기권/점수 변화가 없다.
3. 다섯 placement 합 174/175/324/325 경계가 정확하다.
4. group 4명/5명과 3경기 최소 조건의 승강선이 정확하다.
5. 공식전 중 client disconnect는 away로 끝까지 진행되고 결과가 반영된다.
6. 서버 강제 종료 후 match 점수는 반영되지 않고 경기권이 돌아온다.
7. 프리시즌에는 참가 emblem 외 희소 시즌 보상이 지급되지 않는다.

- [ ] **Step 9: 최종 3단계 커밋**

```bash
git status --short
git add -A
git commit -m "test: verify poker arena preseason"
```

새 변경이 없으면 빈 커밋을 만들지 않는다. 이 시점의 수용 기준은 다음과 같다.

- 경기권은 신규 2장·일 +2·최대 10이며 구매/선물/추가 획득 경로가 없다.
- 사람 2명 이상만 공식전이고 나머지는 고정 버전 봇으로 6석을 채운다.
- 1인 대기는 점수·경기권 없는 연습전만 제안한다.
- 공식전은 1500 stack/current blind/no chip fee/no rake/no chip prize다.
- placement, 주간 그룹, 승강, Master global, tie-break, soft reset이 승인 규칙과 같다.
- 결과는 exactly-once이며 서버 장애 전 미확정 match 경기권은 반환된다.
- MMR은 매칭 전용으로 끝까지 비공개이고 cosmetic만 시즌 보상으로 지급된다.
- 법적·등급·백업·프리시즌 검증 gate 전에는 production flag를 켜지 않는다.
