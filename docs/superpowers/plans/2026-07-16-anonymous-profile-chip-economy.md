# Anonymous Profile and Chip Economy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이메일·전화번호·실명 없이 복구 가능한 익명 프로필과 영속 무료 칩 지갑을 만들고, 캐시·일반 Sit & Go의 입장·레이크·정산·서버 재시작 복구를 원자적으로 처리한다.

**Architecture:** Node 22 내장 `node:sqlite`를 단일 동기 연결로 사용하고, HTTP의 HttpOnly 프로필 자격증명과 Socket.IO의 단기 재접속 세션을 분리한다. `EconomyService`가 지갑·좌석 에스크로·원장 트랜잭션의 유일한 변경 경계가 되며, `RoomManager`는 핸드 시작 전 체크포인트와 핸드 종료 후 정산 훅만 호출한다. 엔진은 캐시 레이크와 정산 수치만 계산하고 영속 저장을 알지 못한다.

**Tech Stack:** Next.js 16, TypeScript 5, Node.js 22.16+, `node:sqlite`, Socket.IO 4, Zustand 5, Vitest 4, Fly.io volume

---

## 구현 범위와 파일 구조

이 계획은 승인 설계의 1단계만 구현한다. 도장 레벨·친밀도·과제는 [2단계 계획](./2026-07-16-dojo-progression-collection.md), 포커 아레나는 [3단계 계획](./2026-07-16-poker-arena-seasons.md)에서 다룬다.

새 파일:

- `src/lib/profile/types.ts` — 클라이언트에 공개 가능한 프로필·지갑 DTO
- `src/lib/economy/rake.ts` — 캐시 레이크 순수 계산
- `src/lib/economy/rake.test.ts` — 레이크·사이드팟 배분 회귀 테스트
- `src/server/persistence/database.ts` — SQLite 연결, 트랜잭션, 종료
- `src/server/persistence/migrations.ts` — 버전 순서가 고정된 스키마 마이그레이션
- `src/server/persistence/database.test.ts` — 마이그레이션·제약·재개방 테스트
- `src/server/profile-repository.ts` — 프로필 자격증명 해시와 공개 정보 저장
- `src/server/profile-manager.ts` — 발급·인증·복구·삭제 규칙
- `src/server/profile-manager.test.ts` — 토큰·복구 코드·회전·별명 테스트
- `src/server/profile-http.ts` — 프로필/경제 HTTP API와 쿠키 처리
- `src/server/profile-http.test.ts` — 쿠키·오류 응답·민감정보 비노출 테스트
- `src/server/http-rate-limit.ts` — 네트워크 주소를 메모리에서만 쓰는 HTTP 속도 제한
- `src/server/http-rate-limit.test.ts` — window·sweep·비영속성 테스트
- `src/server/economy-repository.ts` — 지갑·원장·에스크로 SQL
- `src/server/economy-service.ts` — 일일 칩·구제·캐시·SnG 트랜잭션
- `src/server/economy-service.test.ts` — 중복 방지·잔액·복구·정산 테스트
- `src/server/economy-runtime.ts` — RoomManager용 경제 훅 어댑터
- `src/server/economy-runtime.test.ts` — 핸드 체크포인트·봇 손익·재시작 테스트
- `src/lib/store/profile-store.ts` — HTTP 프로필 부트스트랩과 경제 액션 상태
- `src/lib/store/profile-store.test.ts` — 부트스트랩·일일 칩·구제 상태 테스트
- `src/components/onboarding/ProfileOnboarding.tsx` — 성인 안내·캐릭터·복구 코드 3단계
- `src/components/profile/RecoveryPanel.tsx` — 복구 코드 재발급·프로필 삭제
- `src/components/lobby/EconomyBar.tsx` — 지갑·일일 보상·미야코 재도전 지원
- `src/components/table/HandEconomySummary.tsx` — 팟 지급·레이크 요약
- `src/server/persistence/backup.ts` — 암호화 SQLite 백업과 14일 보존
- `src/server/persistence/backup.test.ts` — 백업 integrity·암호화·retention 테스트

수정 파일:

- `package.json`, `package-lock.json`, `Dockerfile` — Node 22.16+ 런타임과 타입 선언 고정
- `fly.toml`, `deploy/README.md` — `/data` volume·백업·복원 절차
- `src/lib/poker/types.ts`, `src/lib/poker/engine.ts` — `handRake`, 경제 모드, 레이크 지급
- `src/lib/poker/engine.sidepots.test.ts` — 사이드팟+레이크 회귀
- `src/lib/realtime/protocol.ts`, `src/server/socket-payload.ts` — 프로필 기반 입장 계약
- `src/server/session-manager.ts`, `src/server/session-manager.test.ts` — 프로필 ID와 단기 소켓 세션 결합
- `src/server/http-handler.ts`, `src/server/index.ts` — 프로필 API·DB 수명주기·백업 연결
- `src/server/socket-handler.ts`, `src/server/socket-handler.integration.test.ts` — 쿠키 인증·에스크로 입장
- `src/server/socket-test-harness.ts` — 메모리 DB와 프로필 쿠키를 가진 테스트 클라이언트
- `src/server/room-manager.ts`, 관련 테스트 — 경제 훅·체크포인트·정산 실패 시 다음 핸드 차단
- `src/lib/store/game-store.ts`, `src/app/page.tsx`, `src/app/table/[id]/page.tsx` — 자유 닉네임 제거·프로필 부트스트랩
- `src/components/lobby/LobbyHeader.tsx`, `src/components/lobby/JoinRoomModal.tsx`, `src/components/layout/SettingsModal.tsx`, `src/components/layout/GameRoomView.tsx` — 경제/복구 UI
- `.gitignore` — 로컬 DB·백업 산출물 제외

## 고정 계약

구현 중 아래 수치나 의미를 임의 변경하지 않는다.

```ts
export const ECONOMY_RULES = {
  startingChips: 10_000,
  dailyGrant: 1_000,
  rescueThreshold: 800,
  rescueTarget: 2_000,
  rescueDailyLimit: 3,
  rescueCooldownMs: 4 * 60 * 60 * 1_000,
  cashRakeRate: 0.05,
  cashRakeCapBb: 5,
  casualSngFeeRate: 0.1,
} as const;
```

- KST 날짜 키는 `YYYY-MM-DD`, 서버 계산 함수 하나만 사용한다.
- 캐시 레이크는 플랍이 열린 핸드에만 `min(floor(totalContributed * 0.05), 5 * bigBlind)`이다.
- `sum(winner.amount) + handRake === sum(totalContributed)`를 핸드 종료마다 검증한다.
- 한 프로필에는 활성 경제 좌석이 최대 하나다.
- DB 쓰기가 실패하면 진행 중 핸드는 현재 스냅샷을 유지하되 다음 핸드는 시작하지 않는다.
- `tableType === 'bots'`인 Practice Dojo는 임시 연습 stack을 쓰며 wallet·escrow·레이크를 사용하지 않는다.
- 로그·게임 상태·HTTP 응답에 프로필 비밀 토큰, 복구 코드 원문, 방 비밀번호, 홀카드를 남기지 않는다.

### Task 1: Node/SQLite 기반과 마이그레이션 구축

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `Dockerfile`
- Create: `src/server/persistence/migrations.ts`
- Create: `src/server/persistence/database.ts`
- Test: `src/server/persistence/database.test.ts`
- Modify: `.gitignore`

- [ ] **Step 1: 실패하는 마이그레이션 테스트 작성**

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { openPokerDatabase, type PokerDatabase } from './database';

describe('openPokerDatabase', () => {
  let database: PokerDatabase | undefined;
  afterEach(() => database?.close());

  it('creates the phase-one schema exactly once', () => {
    database = openPokerDatabase(':memory:');
    const version = database.db.prepare(
      'SELECT MAX(version) AS version FROM schema_migrations',
    ).get() as { version: number };
    expect(version.version).toBe(1);
    expect(database.tableNames()).toEqual(expect.arrayContaining([
      'profiles', 'wallets', 'chip_ledger', 'seat_escrows',
      'daily_claims', 'rescue_claims', 'sng_entries',
    ]));
  });
});
```

- [ ] **Step 2: 테스트가 모듈 부재로 실패하는지 확인**

Run: `npm test -- src/server/persistence/database.test.ts`

Expected: FAIL with `Cannot find module './database'`.

- [ ] **Step 3: Node 최소 버전과 타입 선언 고정**

`package.json`에 다음을 추가·변경하고 `npm install @scure/bip39@2.2.0`로 lockfile을 갱신한다.

```json
"engines": { "node": ">=22.16.0 <23" },
"dependencies": { "@scure/bip39": "2.2.0" },
"devDependencies": { "@types/node": "^22.16.0" }
```

`Dockerfile`의 두 stage를 `FROM node:22.17-slim`으로 고정한다. 이 버전은 `DatabaseSync`와 비동기 `backup()`을 모두 제공한다.

- [ ] **Step 4: 버전형 마이그레이션 구현**

`migrations.ts`에 버전 1 SQL을 `STRICT` 테이블로 작성한다. 필수 제약은 다음과 같다.

```sql
CREATE TABLE profiles (
  id TEXT PRIMARY KEY,
  credential_hash TEXT NOT NULL UNIQUE,
  recovery_hash TEXT NOT NULL UNIQUE,
  alias TEXT NOT NULL UNIQUE,
  avatar_id TEXT NOT NULL,
  adult_confirmed_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE wallets (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  balance INTEGER NOT NULL CHECK (balance >= 0),
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE chip_ledger (
  id TEXT PRIMARY KEY,
  profile_id TEXT REFERENCES profiles(id) ON DELETE CASCADE,
  account TEXT NOT NULL CHECK (account IN ('wallet','escrow','bot','burn')),
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  ref_id TEXT,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL
) STRICT;

CREATE TABLE seat_escrows (
  id TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('cash','sng')),
  amount INTEGER NOT NULL CHECK (amount >= 0),
  checkpoint_amount INTEGER NOT NULL CHECK (checkpoint_amount >= 0),
  checkpoint_hand INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('active','settled')),
  updated_at INTEGER NOT NULL
) STRICT;
CREATE UNIQUE INDEX one_active_room_escrow
  ON seat_escrows(profile_id) WHERE status = 'active';
```

같은 migration에 날짜별 claim 테이블과 `sng_entries(room_id, profile_id, buy_in, fee, status, place, prize)`를 추가한다. `DatabaseSync` 생성 옵션은 `{ timeout: 5_000, enableForeignKeyConstraints: true }`, PRAGMA는 `journal_mode=WAL`, `synchronous=FULL`, `busy_timeout=5000`으로 고정한다.

- [ ] **Step 5: 중첩 없는 트랜잭션 헬퍼 구현**

```ts
transaction<T>(work: () => T): T {
  this.db.exec('BEGIN IMMEDIATE');
  try {
    const value = work();
    this.db.exec('COMMIT');
    return value;
  } catch (error) {
    this.db.exec('ROLLBACK');
    throw error;
  }
}
```

`openPokerDatabase(':memory:')`, `tableNames()`, `close()`를 노출하고 마이그레이션은 `schema_migrations`에 기록한 뒤 한 트랜잭션에서 적용한다.

- [ ] **Step 6: 재개방·FK·CHECK 회귀 테스트 추가 후 통과 확인**

Run: `npm test -- src/server/persistence/database.test.ts`

Expected: PASS, 4 tests including idempotent reopen, foreign-key rejection, and negative-balance rejection.

- [ ] **Step 7: 로컬 데이터 파일을 git에서 제외**

`.gitignore`에 다음을 추가한다.

```gitignore
/data/*.sqlite*
/data/backups/
```

- [ ] **Step 8: 기반 커밋**

```bash
git add package.json package-lock.json Dockerfile .gitignore src/server/persistence
git commit -m "feat: add sqlite persistence foundation"
```

### Task 2: 익명 프로필 발급·인증·복구 구현

**Files:**
- Create: `src/lib/profile/types.ts`
- Create: `src/server/profile-repository.ts`
- Create: `src/server/profile-manager.ts`
- Test: `src/server/profile-manager.test.ts`

- [ ] **Step 1: 외부 계약과 실패 테스트 작성**

```ts
describe('ProfileManager', () => {
  it('creates a safe alias, 256-bit credential, recovery words, and 10,000 chips', () => {
    const created = manager.create({ avatarId: 'sakura', adultConfirmed: true });
    expect(created.profile.alias).toMatch(/^[가-힣]+#[0-9]{4}$/);
    expect(Buffer.from(created.credential, 'base64url')).toHaveLength(32);
    expect(created.recoveryWords.split(' ')).toHaveLength(12);
    expect(created.profile.wallet.balance).toBe(10_000);
    expect(repo.dumpSecrets()).not.toContain(created.credential);
    expect(repo.dumpSecrets()).not.toContain(created.recoveryWords);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- src/server/profile-manager.test.ts`

Expected: FAIL with missing profile modules.

- [ ] **Step 3: 공개 DTO 정의**

`src/lib/profile/types.ts`에 아래 타입을 정의한다.

```ts
export interface PublicProfile {
  id: string;
  alias: string;
  avatarId: string;
  wallet: { balance: number; activeEscrow: number };
}

export type ProfileBootstrap =
  | { state: 'anonymous' }
  | { state: 'ready'; profile: PublicProfile };
```

비밀 자격증명과 복구 코드는 이 파일의 공개 DTO에 절대 넣지 않는다.

- [ ] **Step 4: 암호학·별명 순수 함수 구현**

`randomBytes(32).toString('base64url')`로 자격증명을 만든다. 각 secret마다 `randomBytes(16)` salt를 만들고 `scryptSync(secret, salt, 32)` 결과를 `$scrypt$v1$<salt>$<hash>` 형식으로 저장하며 `timingSafeEqual`로 검증한다. 복구 코드는 `@scure/bip39`의 `generateMnemonic(koreanWordlist, 128)`으로 12단어·128비트 엔트로피와 checksum을 보장한다. 입력은 NFKD+공백 정규화 후 `validateMnemonic`을 통과해야 하며 같은 salted hash 방식으로 저장한다. 별명은 승인된 명사/동물 목록 조합과 4자리 번호만 허용하며 최대 20회 충돌 재시도 후 명시적 오류를 낸다.

```ts
const ALIAS_PREFIXES = ['벚꽃', '달빛', '별빛', '새벽', '노을', '은빛', '구름', '여름', '겨울', '푸른'] as const;
const ALIAS_ANIMALS = ['여우', '고양이', '토끼', '수달', '참새', '판다', '사슴', '늑대', '부엉이', '펭귄'] as const;
const profileId = `p_${randomBytes(16).toString('base64url')}`;
```

- [ ] **Step 5: 생성 트랜잭션 구현**

`ProfileRepository.createWithWallet()`가 `profiles`, `wallets`, 최초 `chip_ledger`의 `PROFILE_START` +10,000을 한 트랜잭션에서 기록한다. idempotency key는 `profile-start:<profileId>`다.

- [ ] **Step 6: 복구 시 모든 장기 비밀 회전 구현**

`recover(recoveryWords)`는 기존 recovery hash를 조회하고 새 credential과 새 recovery words를 동시에 발급해 두 hash를 갱신한다. 이전 credential과 recovery words는 즉시 인증 실패해야 한다. `rotateRecovery(profileId)`도 동일하게 기존 복구 코드를 폐기한다.

- [ ] **Step 7: 삭제와 성인 확인 가드 구현**

`adultConfirmed !== true`이면 생성하지 않는다. `deleteProfile(profileId)`는 FK cascade로 모든 경제 데이터를 지운다. 활성 좌석이 있으면 `PROFILE_HAS_ACTIVE_ESCROW` 오류로 삭제를 거부한다.

- [ ] **Step 8: 경계 테스트 통과 확인**

Run: `npm test -- src/server/profile-manager.test.ts`

Expected: PASS for creation, collision retry, adult guard, credential authentication, recovery rotation, active-seat deletion guard.

- [ ] **Step 9: 프로필 도메인 커밋**

```bash
git add src/lib/profile src/server/profile-repository.ts src/server/profile-manager.ts src/server/profile-manager.test.ts
git commit -m "feat: add recoverable anonymous profiles"
```

### Task 3: 프로필 HTTP API와 HttpOnly 쿠키 연결

**Files:**
- Create: `src/server/profile-http.ts`
- Test: `src/server/profile-http.test.ts`
- Create: `src/server/http-rate-limit.ts`
- Test: `src/server/http-rate-limit.test.ts`
- Modify: `src/server/http-handler.ts`
- Modify: `src/server/index.ts`

- [ ] **Step 1: HTTP 계약 실패 테스트 작성**

다음 경로를 raw HTTP handler에서 검증한다.

```text
GET    /api/profile/session
POST   /api/profile/create       { avatarId, adultConfirmed }
POST   /api/profile/recover      { recoveryWords }
POST   /api/profile/recovery/rotate
DELETE /api/profile              { confirmation: "삭제" }
```

생성 응답만 `{ profile, recoveryWords }`를 한 번 반환하고 `Set-Cookie`에만 자격증명을 둔다. `GET session`은 자격증명이 없으면 `{ state: 'anonymous' }`를 200으로 반환한다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- src/server/profile-http.test.ts`

Expected: FAIL because profile routes are not handled.

- [ ] **Step 3: 쿠키 파서와 설정 함수 구현**

쿠키 이름은 `poker_doku_profile`, 속성은 다음과 같이 고정한다.

```ts
const attributes = [
  'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=31536000',
  ...(isProduction ? ['Secure'] : []),
];
```

원문 credential은 event log나 오류 객체에 포함하지 않는다. 삭제 시 동일 경로로 `Max-Age=0`을 설정한다.

- [ ] **Step 4: JSON 본문 제한과 오류 매핑 구현**

본문은 8KB에서 중단하고 잘못된 JSON은 400, 인증 실패는 401, 활성 좌석 삭제는 409, 중복/속도 제한은 429로 매핑한다. 모든 응답은 `Cache-Control: no-store`를 포함한다.

- [ ] **Step 5: 메모리 전용 HTTP rate limit 구현**

`TransientHttpRateLimiter`를 만들고 `operation:remoteAddress` key를 프로세스 메모리에만 둔다. profile create는 시간당 20회, recovery는 15분당 5회, daily/rescue는 분당 30회로 제한한다. raw address는 SQLite·event log·오류 응답에 기록하지 않고, 만료 key는 5분 sweep에서 제거한다.

- [ ] **Step 6: `createHttpRequestHandler` 의존성 주입**

```ts
createHttpRequestHandler(nextHandler, {
  profileManager,
  database,
})
```

`src/server/index.ts`에서 DB를 먼저 열고 서비스를 만든 뒤 HTTP와 Socket 런타임에 같은 인스턴스를 주입한다. 종료 순서는 Socket 런타임 shutdown → 백업 대기 → DB close → HTTP close다.

- [ ] **Step 7: 민감정보 비노출 테스트 통과 확인**

Run: `npm test -- src/server/profile-http.test.ts src/server/http-rate-limit.test.ts`

Expected: PASS for one-time recovery response, HttpOnly cookie, no-store, invalid body, recovery rotation, deletion cookie clear, transient rate limits, and responses containing no credential hash/address.

- [ ] **Step 8: HTTP 프로필 커밋**

```bash
git add src/server/profile-http.ts src/server/profile-http.test.ts src/server/http-rate-limit.ts src/server/http-rate-limit.test.ts src/server/http-handler.ts src/server/index.ts
git commit -m "feat: expose anonymous profile lifecycle api"
```

### Task 4: 실시간 세션을 프로필 ID에 결합

**Files:**
- Modify: `src/server/session-manager.ts`
- Modify: `src/server/session-manager.test.ts`
- Modify: `src/server/socket-handler.ts`
- Modify: `src/server/socket-test-harness.ts`
- Modify: `src/lib/realtime/protocol.ts`
- Modify: `src/server/socket-payload.ts`
- Modify: `src/server/socket-handler.integration.test.ts`

- [ ] **Step 1: 프로필 없는 소켓 거부와 안정 ID 테스트 작성**

```ts
it('uses the authenticated profile id as the public player id', async () => {
  const profile = harness.createProfile();
  const client = await harness.connect({ profileCookie: profile.cookie });
  expect(client.session.playerId).toBe(profile.id);
});

it('rejects a socket without a profile cookie', async () => {
  await expect(harness.connect()).rejects.toMatchObject({ message: 'profile-required' });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/server/session-manager.test.ts src/server/socket-handler.integration.test.ts`

Expected: FAIL because current sessions generate an unrelated player id.

- [ ] **Step 3: `SessionManager.resolve` 계약 변경**

```ts
resolve(transportToken: string | undefined, socketId: string, profileId: string): Session
```

`Session.playerId`는 항상 `profileId`다. localStorage transport token은 소켓 재접속과 grace timer 재결합에만 쓰며 장기 프로필 인증으로 사용하지 않는다. `profileId -> session` 인덱스를 추가해 같은 프로필의 다른 transport token 연결은 기존 소켓에 `session-replaced`를 보낸다.

- [ ] **Step 4: Socket.IO handshake 쿠키 인증 연결**

`socket.handshake.headers.cookie`에서 프로필 쿠키를 읽고 `ProfileManager.authenticateCredential()`을 호출한다. 실패하면 Socket.IO middleware에서 `next(new Error('profile-required'))`로 종료한다. 성공한 `profileId`는 `socket.data.profileId`에만 두며 credential은 두지 않는다.

- [ ] **Step 5: 자격증명 회전 시 기존 실시간 세션 폐기**

`SessionManager.revokeProfile(profileId)`를 추가한다. recovery rotate와 profile delete 성공 callback이 해당 profile의 socket에 `session-replaced`를 보낸 뒤 연결을 끊고 grace 규칙을 시작한다. 새 자격증명으로 연결한 브라우저가 같은 좌석을 복구하며, 이전 credential은 새 연결에 사용할 수 없다.

- [ ] **Step 6: 자유 닉네임 payload 제거**

`JoinRoomRequest`에서 `playerName`과 `avatar`를 제거한다.

```ts
export interface JoinRoomRequest {
  roomId: string;
  buyIn: number;
  seatIndex: number;
  password?: string;
}
```

서버는 인증된 `PublicProfile.alias`와 `avatarId`만 Player에 사용한다. 기존 클라이언트 문자열을 신뢰하는 분기를 삭제한다.

- [ ] **Step 7: 테스트 harness에 메모리 DB와 cookie jar 추가**

각 harness는 독립 `:memory:` DB를 열고 `createProfile()` helper가 반환한 `Cookie` 헤더로 클라이언트를 연결한다. `close()`에서 socket runtime 다음 DB를 닫는다.

- [ ] **Step 8: 전체 세션·소켓 회귀 통과 확인**

Run: `npm test -- src/server/session-manager.test.ts src/server/socket-handler.integration.test.ts src/server/socket-boundary.integration.test.ts`

Expected: PASS; 기존 resync, grace, room-lost, session-replaced 동작과 recovery rotation의 기존 socket 폐기도 유지.

- [ ] **Step 9: 실시간 인증 커밋**

```bash
git add src/server/session-manager.ts src/server/session-manager.test.ts src/server/socket-handler.ts src/server/socket-test-harness.ts src/lib/realtime/protocol.ts src/server/socket-payload.ts src/server/socket-handler.integration.test.ts
git commit -m "feat: bind realtime sessions to anonymous profiles"
```

### Task 5: 지갑·일일 칩·재도전 지원 서비스 구현

**Files:**
- Create: `src/server/economy-repository.ts`
- Create: `src/server/economy-service.ts`
- Test: `src/server/economy-service.test.ts`
- Modify: `src/server/profile-http.ts`
- Modify: `src/server/profile-http.test.ts`
- Modify: `src/server/index.ts`

- [ ] **Step 1: KST 날짜와 idempotency 실패 테스트 작성**

```ts
it('grants daily chips once per KST date without carry-over', () => {
  expect(service.claimDaily(id, atKst('2026-07-16T00:01')).granted).toBe(1_000);
  expect(() => service.claimDaily(id, atKst('2026-07-16T23:59')))
    .toThrowError('DAILY_ALREADY_CLAIMED');
  expect(service.claimDaily(id, atKst('2026-07-17T00:00')).granted).toBe(1_000);
});
```

구제 테스트는 지갑 799/800 경계, 활성 에스크로, 하루 3회, 성공 시점부터 4시간을 각각 포함한다.

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/server/economy-service.test.ts`

Expected: FAIL with missing economy modules.

- [ ] **Step 3: 지갑 원장 원자 연산 구현**

`applyWalletDelta(profileId, delta, reason, idempotencyKey, refId?)`는 `BEGIN IMMEDIATE` 안에서 현재 잔액을 읽고 음수 여부를 검사한 뒤 wallet과 ledger를 함께 갱신한다. 중복 key면 기존 결과를 반환하고 두 번 반영하지 않는다.

- [ ] **Step 4: 일일 청구 구현**

KST date key는 `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', ... })` 기반 순수 함수로 만든다. `daily_claims(profile_id, claim_date)` insert와 +1,000 원장을 한 트랜잭션에서 처리한다. 미청구분은 이월하지 않는다.

- [ ] **Step 5: 재도전 지원 구현**

활성 에스크로가 없고 wallet `< 800`일 때만 `2_000 - balance`를 지급한다. 당일 성공 claim 수가 3 미만이고 마지막 성공 시각에서 4시간이 지나야 한다. idempotency key는 `rescue:<profileId>:<kstDate>:<ordinal>`이다.

- [ ] **Step 6: 경제 HTTP endpoint 연결**

```text
POST /api/economy/daily
POST /api/economy/rescue
```

`src/server/index.ts`에서 `EconomyRepository`와 `EconomyService`를 생성해 profile HTTP router에 주입한다. 성공 응답은 `{ profile, transaction: { reason, delta } }`, 재청구/쿨다운은 409와 안전한 `availableAt`만 반환한다.

- [ ] **Step 7: 동시·반복 청구 테스트 통과 확인**

Run: `npm test -- src/server/economy-service.test.ts src/server/profile-http.test.ts`

Expected: PASS including repeated request idempotency, exact KST midnight, rescue cooldown, and nonnegative wallet.

- [ ] **Step 8: 무료 칩 서비스 커밋**

```bash
git add src/server/economy-repository.ts src/server/economy-service.ts src/server/economy-service.test.ts src/server/profile-http.ts src/server/profile-http.test.ts src/server/index.ts
git commit -m "feat: add free chip grants and rescue rules"
```

### Task 6: 5%·최대 5BB 캐시 레이크를 엔진에 구현

**Files:**
- Create: `src/lib/economy/rake.ts`
- Test: `src/lib/economy/rake.test.ts`
- Modify: `src/lib/poker/types.ts`
- Modify: `src/lib/poker/engine.ts`
- Modify: `src/lib/poker/engine.sidepots.test.ts`
- Modify: `src/lib/poker/engine.test.ts`

- [ ] **Step 1: 레이크 계약 테스트 작성**

```ts
expect(computeCashRake({ totalPot: 1_000, bigBlind: 20, flopDealt: true })).toBe(50);
expect(computeCashRake({ totalPot: 10_000, bigBlind: 20, flopDealt: true })).toBe(100);
expect(computeCashRake({ totalPot: 1_000, bigBlind: 20, flopDealt: false })).toBe(0);
```

사이드팟 테스트는 `[301, 199, 100]` 팟에서 배분 합이 계산된 rake와 같고 어느 팟도 음수가 되지 않는지 검증한다.

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/lib/economy/rake.test.ts src/lib/poker/engine.sidepots.test.ts`

Expected: FAIL because `computeCashRake` and `handRake` do not exist.

- [ ] **Step 3: 순수 레이크 계산·팟 배분 구현**

```ts
export function computeCashRake(input: RakeInput): number {
  if (!input.flopDealt || input.totalPot <= 0) return 0;
  return Math.min(Math.floor(input.totalPot * 0.05), input.bigBlind * 5);
}
```

`allocateRakeAcrossPots(pots, rake)`는 비례 몫을 floor하고 남는 칩을 fractional remainder가 큰 팟, 동일하면 낮은 pot index 순으로 1칩씩 배분한다.

- [ ] **Step 4: 엔진 공개 상태에 핸드 레이크 추가**

`GameState.handRake: number`를 추가하고 `startHand()`에서 0으로 초기화한다. `RoomConfig.economyMode?: 'practice' | 'wallet' | 'arena'`를 추가하며 레이크는 `gameMode === 'cash' && economyMode === 'wallet'`에만 적용한다.

- [ ] **Step 5: 지급용 팟을 분리해 endHand 수정**

`state.pots`는 계속 총 기여금 원장을 유지한다. `endHand()`에서 복제한 `payoutPots`에만 rake allocation을 빼고 승자 지급을 계산한다. 폴드 승리와 쇼다운 모두 같은 함수 경로를 사용한다.

- [ ] **Step 6: 엔진 불변식 추가**

핸드 종료 직후 아래를 계산하고 불일치 시 throw한다.

```ts
const contributed = this.state.players.reduce((sum, p) => sum + p.totalContributed, 0);
const paid = this.state.winners?.reduce((sum, win) => sum + win.amount, 0) ?? 0;
if (paid + this.state.handRake !== contributed) {
  throw new Error(`settlement invariant failed: ${paid}+${this.state.handRake}!=${contributed}`);
}
```

- [ ] **Step 7: 무플랍·메인팟·사이드팟·홀수칩 테스트 통과 확인**

Run: `npm test -- src/lib/economy/rake.test.ts src/lib/poker/engine.test.ts src/lib/poker/engine.sidepots.test.ts`

Expected: PASS and every cash settlement satisfies payout+rake=contribution.

- [ ] **Step 8: 레이크 커밋**

```bash
git add src/lib/economy src/lib/poker/types.ts src/lib/poker/engine.ts src/lib/poker/engine.test.ts src/lib/poker/engine.sidepots.test.ts
git commit -m "feat: apply capped cash game rake"
```

### Task 7: 캐시 좌석 에스크로와 핸드 체크포인트 구현

**Files:**
- Create: `src/server/economy-runtime.ts`
- Test: `src/server/economy-runtime.test.ts`
- Modify: `src/server/economy-repository.ts`
- Modify: `src/server/economy-service.ts`
- Modify: `src/server/room-manager.ts`
- Modify: `src/server/room-manager.lifecycle.test.ts`
- Modify: `src/server/socket-handler.ts`
- Modify: `src/server/socket-handler.integration.test.ts`
- Modify: `src/server/event-log.ts`

- [ ] **Step 1: 입장·핸드·퇴장 상태 전이 실패 테스트 작성**

시나리오는 wallet 10,000 → buy-in 4,000 입장 → wallet 6,000/escrow 4,000 → 핸드 후 stack 4,700/rake 100 → escrow 4,700 → 정상 퇴장 → wallet 10,700/escrow 없음이다.

- [ ] **Step 2: 서버 재시작 복구 실패 테스트 작성**

핸드 전 checkpoint가 4,000이고 진행 중 engine stack이 2,500인 상태에서 런타임을 재생성하면 wallet에 4,000을 반환하고 escrow를 닫아야 한다. 핸드 사이 checkpoint 4,700 상태면 4,700을 반환한다.

- [ ] **Step 3: 테스트 실패 확인**

Run: `npm test -- src/server/economy-runtime.test.ts`

Expected: FAIL with missing runtime.

- [ ] **Step 4: RoomManager 경제 훅 계약 추가**

```ts
export interface RoomEconomyHooks {
  beforeHand(roomId: string, engine: PokerEngine): void;
  afterHand(roomId: string, engine: PokerEngine): void;
  settleExit(roomId: string, player: Player): void;
  voidRoom(roomId: string): void;
}
```

`RoomManagerOptions.economy`로 주입하고 practice 방에서는 no-op을 쓴다.

- [ ] **Step 5: 캐시 입장 원자화**

socket `join-room`에서 RoomManager 좌석 추가 전에 `openCashEscrow(profileId, roomId, buyIn)`를 실행한다. 좌석 추가가 실패하면 같은 트랜잭션 의미로 `cancelEscrow()`를 즉시 환불한다. 재접속은 기존 escrow와 좌석을 재사용하고 다시 차감하지 않는다.

- [ ] **Step 6: 핸드 시작 체크포인트 연결**

`tryStartGame()`에서 `engine.startHand()` 직전 모든 human stack을 `checkpoint_amount`와 `checkpoint_hand = nextHandNumber`로 저장한다. 이 호출이 실패하면 핸드를 시작하지 않고 시스템 채팅으로 “저장 연결을 확인 중이에요”를 알린다.

- [ ] **Step 7: 핸드 종료 원장 반영**

각 human의 `handStartChips` 대비 종료 stack delta를 `CASH_HAND_WIN`/`CASH_HAND_LOSS`, 봇 전체 delta를 `BOT_NET_WIN`/`BOT_NET_LOSS`, 레이크를 `RAKE_BURN`으로 같은 트랜잭션에 기록한다. 검증식은 `humanDelta + botDelta + handRake === 0`이다. idempotency prefix는 `cash-hand:<roomId>:<handNumber>`다. Practice Dojo는 이 훅을 no-op으로 통과한다.

- [ ] **Step 8: 정상 이탈·자동 회수 정산 연결**

핸드 사이의 `leaveRoom`, sitout abandon, room dispose는 즉시 `settleExit()`한다. 핸드 중 명시 이탈은 `pendingEconomicExit`으로 표시하고 봇 loop를 계속 진행해 핸드를 정상 종료한 뒤 `afterHand()`와 `settleExit()` 순으로 처리한다. 활성 경제 핸드가 있는 방은 그 전에 reset/dispose하지 않는다. 네트워크 disconnect/grace 시작은 정산하지 않으며, 기존 SnG grace 보존 규칙도 유지한다.

- [ ] **Step 9: startup void 복구 구현**

서버 시작 시 `recoverActiveEscrows()`가 모든 cash escrow의 `checkpoint_amount`를 wallet에 `CASH_VOID_REFUND`로 반환하고 status를 settled로 만든다. idempotency key는 `void:<profileId>:<roomId>:<checkpointHand>`다.

- [ ] **Step 10: event log 안전 필드 추가**

hand-end에 `rake`, `paidTotal`, `settlementOk`만 추가한다. wallet 잔액, credential, recovery 정보는 기록하지 않는다.

- [ ] **Step 11: 경제 런타임과 기존 방 수명주기 테스트 통과 확인**

Run: `npm test -- src/server/economy-runtime.test.ts src/server/room-manager.lifecycle.test.ts src/server/socket-handler.integration.test.ts`

Expected: PASS for join rollback, exactly-once hand settlement, restart refund, disconnect preservation, clean exit, and room disposal.

- [ ] **Step 12: 캐시 영속성 커밋**

```bash
git add src/server/economy-runtime.ts src/server/economy-runtime.test.ts src/server/economy-repository.ts src/server/economy-service.ts src/server/room-manager.ts src/server/room-manager.lifecycle.test.ts src/server/socket-handler.ts src/server/socket-handler.integration.test.ts src/server/event-log.ts
git commit -m "feat: persist cash seats through escrow checkpoints"
```

### Task 8: 일반 Sit & Go 참가비와 상금 정산 구현

**Files:**
- Modify: `src/lib/poker/types.ts`
- Modify: `src/server/economy-service.ts`
- Modify: `src/server/economy-service.test.ts`
- Modify: `src/server/economy-runtime.ts`
- Modify: `src/server/economy-runtime.test.ts`
- Modify: `src/server/room-manager.ts`
- Modify: `src/server/socket-handler.ts`
- Modify: `src/server/socket-handler.integration.test.ts`
- Modify: `src/components/lobby/JoinRoomModal.tsx`

- [ ] **Step 1: 1,500+150 참가와 50/30/20 정산 실패 테스트 작성**

6명 참가 시 각 wallet에서 1,650이 차감되고 총 prize pool 9,000, fee burn 900이어야 한다. 결과는 1위 4,500, 2위 2,700, 3위 1,800, 나머지 0이다.

- [ ] **Step 2: 대기 취소와 서버 재시작 refund 테스트 작성**

시작 전 취소와 미완료 일반 SnG startup recovery는 buy-in+fee 전액을 반환한다. 시작 후 정상 탈락/disconnect는 반환하지 않는다.

- [ ] **Step 3: 테스트 실패 확인**

Run: `npm test -- src/server/economy-service.test.ts src/server/economy-runtime.test.ts`

Expected: FAIL because SNG entry transactions do not exist.

- [ ] **Step 4: 일반 SnG 경제 config 추가**

```ts
entryBuyIn: 1_500,
entryFee: 150,
economyMode: 'wallet'
```

엔진 안의 tournament chips/prizes는 현재 방식대로 pure buy-in만 사용한다. fee는 engine state에 더하지 않는다.

- [ ] **Step 5: 참가 reserve와 시작 commit 구현**

대기 좌석 입장 시 1,650을 `sng_entries`에 reserve한다. 6명 모두 모여 `startTournament` 직전에 모든 entry를 started로 전환하고 fee 900을 `SNG_FEE_BURN`으로 기록한다. 하나라도 저장 실패하면 토너먼트를 시작하지 않는다.

- [ ] **Step 6: 결과 정산 원자화**

`tournament.finished`가 처음 true가 된 시점에 6개 entry의 place/prize/status를 갱신하고 상위 3개 wallet을 같은 트랜잭션에서 지급한다. idempotency key는 `sng-prize:<roomId>:<profileId>`다.

- [ ] **Step 7: UI에 buy-in과 fee를 분리 표시**

JoinRoomModal에 `바이인 1,500 + 참가 수수료 150`과 `상금 풀에는 바이인만 포함`을 표시한다. 잔액 부족이면 입장 버튼을 비활성화한다.

- [ ] **Step 8: SnG 경제 통합 테스트 통과 확인**

Run: `npm test -- src/server/economy-service.test.ts src/server/economy-runtime.test.ts src/server/socket-handler.integration.test.ts`

Expected: PASS for reserve, cancel, six-player start, fee burn, exact prizes, duplicate finish, and restart refund.

- [ ] **Step 9: 일반 SnG 커밋**

```bash
git add src/lib/poker/types.ts src/server/economy-service.ts src/server/economy-service.test.ts src/server/economy-runtime.ts src/server/economy-runtime.test.ts src/server/room-manager.ts src/server/socket-handler.ts src/server/socket-handler.integration.test.ts src/components/lobby/JoinRoomModal.tsx
git commit -m "feat: settle casual sit and go economy"
```

### Task 9: 클라이언트 온보딩·지갑·복구 UX 구현

**Files:**
- Create: `src/lib/store/profile-store.ts`
- Test: `src/lib/store/profile-store.test.ts`
- Create: `src/components/onboarding/ProfileOnboarding.tsx`
- Create: `src/components/profile/RecoveryPanel.tsx`
- Create: `src/components/lobby/EconomyBar.tsx`
- Create: `src/components/table/HandEconomySummary.tsx`
- Modify: `src/lib/store/game-store.ts`
- Modify: `src/app/page.tsx`
- Modify: `src/app/table/[id]/page.tsx`
- Modify: `src/components/lobby/LobbyHeader.tsx`
- Modify: `src/components/layout/SettingsModal.tsx`
- Modify: `src/components/layout/GameRoomView.tsx`

- [ ] **Step 1: profile store HTTP 상태 테스트 작성**

`src/lib/store/profile-store.test.ts`를 만들고 anonymous → creating → recovery-required → ready, recovery 오류, daily/rescue 갱신을 mock fetch로 검증한다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `npm test -- src/lib/store/profile-store.test.ts`

Expected: FAIL because profile store does not exist.

- [ ] **Step 3: 프로필 부트스트랩 store 구현**

`bootstrap()`이 `/api/profile/session`을 호출한다. `state === ready`일 때만 `gameStore.connect()`를 호출한다. profile credential은 JS 상태나 localStorage에 저장하지 않는다.

- [ ] **Step 4: 3단계 온보딩 구현**

1. “청소년이용불가 / 해당 등급 기준 연령 미만 이용 불가 / 현금·현물 보상 없음 / 칩 환전·양도 불가” 확인
2. 캐릭터 선택과 서버 생성 별명 표시
3. 12단어 복구 코드 1회 표시, 복사·확인 checkbox

복구 코드 저장을 건너뛸 수는 있지만 로비와 설정에 경고 배지를 유지한다. 자유 텍스트 닉네임 입력은 삭제한다.

- [ ] **Step 5: 로비 경제 바 구현**

지갑 잔액, 활성 좌석 칩, 일일 1,000칩 청구 상태를 보여준다. 구제 조건일 때만 “미야코의 재도전 지원”을 노출하고 지급액/남은 횟수/다음 가능 시각을 표시한다.

- [ ] **Step 6: 복구·삭제 설정 구현**

SettingsModal에 RecoveryPanel을 추가해 새 코드 발급 시 이전 코드가 즉시 폐기됨을 명시한다. 삭제는 `삭제` 재입력을 요구하고 활성 좌석이면 먼저 게임을 나가도록 안내한다.

- [ ] **Step 7: 핸드 경제 요약 구현**

GameRoomView의 기존 winners 이벤트 뒤에 본인 stack 변화와 `레이크 {handRake}`를 표시한다. practice 방은 “연습 게임 · 레이크 없음”을 표시한다.

- [ ] **Step 8: UI·store 검증**

Run: `npm test -- src/lib/store/profile-store.test.ts`

Expected: PASS.

Run: `npm run lint`

Expected: PASS; effect 본문 직접 setState와 렌더 중 Date.now 사용 없음.

Run: `npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 9: 클라이언트 UX 커밋**

```bash
git add src/lib/store/profile-store.ts src/lib/store/profile-store.test.ts src/lib/store/game-store.ts src/app/page.tsx src/app/table/[id]/page.tsx src/components/onboarding src/components/profile src/components/lobby/EconomyBar.tsx src/components/lobby/LobbyHeader.tsx src/components/layout/SettingsModal.tsx src/components/layout/GameRoomView.tsx src/components/table/HandEconomySummary.tsx
git commit -m "feat: add anonymous onboarding and chip wallet ux"
```

### Task 10: Fly volume·매일 백업·14일 보존 구현

**Files:**
- Create: `src/server/persistence/backup.ts`
- Test: `src/server/persistence/backup.test.ts`
- Modify: `src/server/index.ts`
- Modify: `fly.toml`
- Modify: `deploy/README.md`

- [ ] **Step 1: 백업 파일명·보존 실패 테스트 작성**

고정 clock으로 `poker-doku-2026-07-16.sqlite`가 생성되고 15일 전 파일만 삭제되며 DB 파일과 WAL/SHM은 삭제 대상이 아님을 검증한다.

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/server/persistence/backup.test.ts`

Expected: FAIL with missing backup module.

- [ ] **Step 3: 공식 `node:sqlite` backup API 래퍼 구현**

`backup(database.db, destination)`을 사용하고 임시 파일에 완료한 뒤 같은 volume에서 최종 이름으로 rename한다. 백업 중복 실행을 Promise lock으로 막는다. 보존 정리는 `backups/` 아래 정규식에 맞는 파일에만 적용한다.

- [ ] **Step 4: 암호화 경계 구현**

`BACKUP_ENCRYPTION_KEY`가 설정되면 AES-256-GCM으로 `.sqlite.enc`를 만들고 평문 임시 파일을 삭제한다. production에서 key가 없으면 startup을 실패시킨다. 키 원문은 로그에 남기지 않는다.

- [ ] **Step 5: 시작·종료·매일 KST 스케줄 연결**

startup recovery 후 한 번, 매일 KST 04:00, 정상 shutdown 직전에 백업한다. 타이머는 24시간 고정 interval이 아니라 다음 KST 04:00을 매번 다시 계산해 DST/clock drift에 안전하게 한다.

- [ ] **Step 6: Fly volume mount 추가**

```toml
[env]
  POKER_DB_PATH = "/data/poker-doku.sqlite"
  POKER_BACKUP_DIR = "/data/backups"

[mounts]
  source = "poker_doku_data"
  destination = "/data"
```

- [ ] **Step 7: 운영 문서에 생성·복원·rollback 명령 기록**

`deploy/README.md`에 `fly volumes create poker_doku_data --region nrt --size 1`, secret 설정, 백업 복호화, 새 DB로 복원 후 health check 절차를 실제 명령으로 적는다. 공개 마케팅/유입 전 gate로 청소년이용불가 등급분류·표시와 웹보드게임 본인확인 의무 적용 여부의 공식 확인을 완료하도록 별도 checklist를 둔다.

- [ ] **Step 8: 백업 테스트 통과 확인**

Run: `npm test -- src/server/persistence/backup.test.ts src/server/persistence/database.test.ts`

Expected: PASS for backup integrity, encryption round-trip, retention, and lock.

- [ ] **Step 9: 운영 영속성 커밋**

```bash
git add src/server/persistence/backup.ts src/server/persistence/backup.test.ts src/server/index.ts fly.toml deploy/README.md
git commit -m "feat: persist and back up production economy data"
```

### Task 11: 1단계 전체 회귀와 수용 기준 검증

**Files:**
- Modify if needed: tests touched above only
- Verify: entire repository

- [ ] **Step 1: 민감정보 정적 검색**

Run: `rg -n "credential|recoveryWords|poker_doku_profile" src/server | rg "eventLog|console\.|gameState|socket\.emit"`

Expected: no credential/recovery value passed to logs or game state; cookie name in HTTP code is allowed.

- [ ] **Step 2: 집중 테스트 실행**

Run: `npm test -- src/server/profile-manager.test.ts src/server/profile-http.test.ts src/server/economy-service.test.ts src/server/economy-runtime.test.ts src/lib/economy/rake.test.ts src/lib/poker/engine.sidepots.test.ts src/server/socket-handler.integration.test.ts`

Expected: PASS.

- [ ] **Step 3: 전체 테스트 실행**

Run: `npm test`

Expected: PASS with no unhandled timer or open database handles.

- [ ] **Step 4: 정적 검증 실행**

Run: `npm run lint`

Expected: PASS.

Run: `npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 5: production build 실행**

Run: `npm run build`

Expected: PASS; Next production bundle completes.

- [ ] **Step 6: 로컬 production smoke test**

PowerShell에서 임시 경로와 키를 지정한다.

```powershell
$env:POKER_DB_PATH="$PWD\data\smoke.sqlite"
$env:POKER_BACKUP_DIR="$PWD\data\backups"
$env:BACKUP_ENCRYPTION_KEY="0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
npm start
```

별도 터미널에서 `Invoke-WebRequest http://localhost:3000/healthz`가 200인지, 브라우저 새 프로필 생성→일일 칩→캐시 입장→한 핸드→퇴장→서버 재시작 후 잔액 유지인지 확인한다.

- [ ] **Step 7: 임시 표식과 설계 수치 검색**

Run: `rg -n "TO[D]O|TB[D]|place[h]older|FIX[M]E|1BB|1000BB" src`

Expected: no matches. 별도 balance 테스트에서 5BB/10,000/1,000/800/2,000/3회/4시간을 검증한다.

- [ ] **Step 8: 최종 1단계 커밋**

```bash
git status --short
git add -A
git commit -m "test: verify anonymous chip economy phase"
```

새 변경이 없으면 빈 커밋을 만들지 않는다. 이 시점의 수용 기준은 다음과 같다.

- 새 브라우저는 성인 확인 후 익명 프로필과 10,000칩을 받는다.
- 이메일·전화번호·실명·자유 텍스트 별명을 받지 않는다.
- 복구 코드는 자격증명을 회전하며 운영자 복구 경로가 없다.
- 캐시 입장·핸드·정상 퇴장·강제 재시작에서 칩이 복제되거나 사라지지 않는다.
- 레이크는 플랍 이후 5%, 최대 5BB이고 지급액+레이크=총 기여금이다.
- 일반 SnG는 1,500+150, 상금 4,500/2,700/1,800으로 정확히 정산된다.
- Fly volume과 암호화 백업 복원 절차가 검증됐다.
