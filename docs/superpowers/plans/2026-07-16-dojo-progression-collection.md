# Dojo Progression and Collection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 포커 승패나 베팅 크기를 왜곡하지 않는 도장 레벨·캐릭터 친밀도·일일 과제·연속 수련·영구 수집 보상을 익명 프로필에 추가한다.

**Architecture:** 서버가 확정한 핸드·Sit & Go 완료 이벤트만 `ProgressionService`에 전달하고, 서비스는 버전이 고정된 balance config로 XP·친밀도·과제·연속 수련을 한 트랜잭션에서 계산한다. 모든 보상 이벤트는 room/hand 또는 tournament idempotency key를 가지며, 클라이언트는 공개 progression snapshot과 reward summary를 렌더링만 한다. 칩 지갑·포커 엔진·MMR에는 성장 수치가 입력되지 않는다.

**Tech Stack:** TypeScript 5, `node:sqlite`, Socket.IO 4, Zustand 5, React 19, Vitest 4, 기존 PokerEngine/RoomManager 이벤트 경계

---

## 전제와 파일 구조

먼저 [1단계 익명 프로필·칩 경제 계획](./2026-07-16-anonymous-profile-chip-economy.md)이 완료되어 `profiles`, `EconomyService`, `RoomEconomyHooks`, `profile-store`가 존재해야 한다. 이 계획은 현금성 가치가 없는 성장·수집만 추가하며 칩 지급은 추가하지 않는다.

새 파일:

- `src/lib/progression/types.ts` — 성장 snapshot, 과제, 보상 요약 DTO
- `src/lib/progression/balance.ts` — 버전 1 XP·친밀도·연습 감쇠 수치
- `src/lib/progression/balance.test.ts` — 레벨 경계·소수 누적 순수 테스트
- `src/lib/progression/missions.ts` — 허용 과제 catalog와 결정론적 배정
- `src/lib/progression/missions.test.ts` — 중복·reroll·행동 왜곡 방지 테스트
- `src/lib/collection/catalog.ts` — 칭호·테두리·컷인·인연 스킨 catalog
- `src/lib/collection/catalog.test.ts` — 보상 ID·캐릭터·asset renderer 계약
- `src/server/progression-repository.ts` — progression·mission·streak·inventory SQL
- `src/server/progression-repository.test.ts` — migration row mapping·lazy init 테스트
- `src/server/progression-service.ts` — 이벤트 처리와 reward grant 트랜잭션
- `src/server/progression-service.test.ts` — idempotency·감쇠·과제·연속 수련 테스트
- `src/server/progression-runtime.ts` — RoomManager 이벤트를 progression event로 변환
- `src/server/progression-runtime.test.ts` — 캐시/practice/SnG 통합 이벤트 테스트
- `src/server/progression-http.ts` — snapshot, 과제 reroll, 장착 API
- `src/server/progression-http.test.ts` — 인증·장착 소유권·응답 테스트
- `src/lib/store/progression-store.ts` — 로비/프로필/종료 요약 상태
- `src/lib/store/progression-store.test.ts` — socket snapshot·summary queue 테스트
- `src/components/lobby/MissionPanel.tsx` — 오늘 과제 3개와 무료 교체
- `src/components/profile/ProfileHub.tsx` — 성장·인연·보관함·기록·복구 탭
- `src/components/profile/ProgressionTab.tsx`
- `src/components/profile/AffinityTab.tsx`
- `src/components/profile/InventoryTab.tsx`
- `src/components/profile/RecordsTab.tsx`
- `src/components/table/ProgressionSummary.tsx` — 핸드/대회 종료 성장 요약
- `src/components/collection/EquippedCosmetics.tsx` — 테두리·칭호·인연 스킨 효과

수정 파일:

- `src/server/persistence/migrations.ts` — migration version 2
- `src/lib/profile/types.ts`, `src/server/profile-repository.ts` — 공개 snapshot과 선택 캐릭터
- `src/server/room-manager.ts`, `src/server/economy-runtime.ts` — 정산 뒤 progression hook
- `src/server/socket-handler.ts`, `src/server/http-handler.ts`, `src/server/index.ts` — 서비스 주입과 API
- `src/lib/realtime/protocol.ts` — `progression-update`, `reward-summary`
- `src/lib/store/profile-store.ts`, `src/app/page.tsx` — 로비 성장 상태
- `src/components/lobby/EconomyBar.tsx`, `src/components/layout/GameRoomView.tsx`, `src/components/layout/SettingsModal.tsx`
- `src/components/characters/CharacterImage.tsx`, `src/components/characters/WinnerCutIn.tsx`, `src/components/table/PlayerSeat.tsx` — 장착 cosmetic 렌더

## 버전 1 밸런스 계약

구현 시 아래 수치는 `PROGRESSION_BALANCE_V1`에 그대로 기록한다. 운영 조정은 기존 version을 수정하지 않고 version 2를 추가한다.

```ts
export const PROGRESSION_BALANCE_V1 = {
  version: 1,
  dojoMaxLevel: 50,
  dojoXpPerCompletedHand: 10_000,       // milli-XP
  dojoXpPerSngPlace: [160, 100, 70, 50, 40, 30].map(v => v * 1_000),
  dojoXpPerMission: 100_000,
  dojoXpForNextLevel: (level: number) => (100 + 25 * (level - 1)) * 1_000,
  affinityMaxLevel: 20,
  affinityPerCompletedHand: 2_000,      // milli-affinity
  affinityPerSngPlace: [30, 20, 15, 12, 10, 8].map(v => v * 1_000),
  affinityForNextLevel: (level: number) => (40 + 15 * (level - 1)) * 1_000,
  practiceFullRewardHandsPerKstDay: 30,
  practiceReducedRatePermille: 250,
  dailyMissionCount: 3,
  dailyFreeRerolls: 1,
  streakHandsRequired: 10,
  streakSngRequired: 1,
  weeklyRestPassGrant: 1,
  restPassCap: 1,
  streakFragmentEveryDays: 7,
} as const;
```

모든 XP와 친밀도는 milli-unit 정수로 저장해 25% 감쇠의 소수 보상을 잃지 않는다. UI만 `floor(milli / 1000)`로 표시한다.

허용 일일 과제는 아래 참여 목표만 사용한다.

- `COMPLETE_HANDS_ANY_10`
- `COMPLETE_HANDS_CASH_10`
- `COMPLETE_HANDS_PRACTICE_10`
- `COMPLETE_HANDS_ANY_20`
- `COMPLETE_ONE_SNG`
- `COMPLETE_TWO_MODES`

승리, 특정 패, 쇼다운, 올인, 콜/레이즈 횟수, 베팅 크기, 무리한 플레이를 요구하는 과제는 catalog에 넣지 않는다.

### Task 1: progression migration과 repository 구축

**Files:**
- Modify: `src/server/persistence/migrations.ts`
- Modify: `src/server/persistence/database.test.ts`
- Create: `src/server/progression-repository.ts`
- Test: `src/server/progression-repository.test.ts`

- [ ] **Step 1: migration version 2 실패 테스트 작성**

```ts
expect(database.latestMigration()).toBe(2);
expect(database.tableNames()).toEqual(expect.arrayContaining([
  'progression_profiles', 'character_affinity', 'daily_missions',
  'streak_state', 'inventory_items', 'profile_equipment', 'progression_events',
]));
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/server/persistence/database.test.ts`

Expected: FAIL because latest migration is still 1.

- [ ] **Step 3: version 2 schema 작성**

핵심 테이블은 다음 제약을 포함한다.

```sql
CREATE TABLE progression_profiles (
  profile_id TEXT PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  balance_version INTEGER NOT NULL,
  dojo_level INTEGER NOT NULL CHECK (dojo_level BETWEEN 1 AND 50),
  dojo_xp_milli INTEGER NOT NULL CHECK (dojo_xp_milli >= 0),
  selected_character_id TEXT NOT NULL,
  practice_date TEXT,
  practice_hands INTEGER NOT NULL DEFAULT 0 CHECK (practice_hands >= 0),
  completed_hands INTEGER NOT NULL DEFAULT 0 CHECK (completed_hands >= 0),
  cash_hands INTEGER NOT NULL DEFAULT 0 CHECK (cash_hands >= 0),
  practice_hands_total INTEGER NOT NULL DEFAULT 0 CHECK (practice_hands_total >= 0),
  sng_completions INTEGER NOT NULL DEFAULT 0 CHECK (sng_completions >= 0),
  best_streak INTEGER NOT NULL DEFAULT 0 CHECK (best_streak >= 0),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE character_affinity (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL,
  level INTEGER NOT NULL CHECK (level BETWEEN 1 AND 20),
  xp_milli INTEGER NOT NULL CHECK (xp_milli >= 0),
  PRIMARY KEY(profile_id, character_id)
) STRICT;

CREATE TABLE progression_events (
  idempotency_key TEXT PRIMARY KEY,
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  balance_version INTEGER NOT NULL,
  summary_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
) STRICT;
```

같은 migration에 `daily_missions`, `streak_state`, `inventory_items`, `profile_equipment`를 추가한다. 장착 slot은 `title|frame|skin|cutin`, inventory unique key는 `(profile_id,item_id)`다.

- [ ] **Step 4: 기존 프로필 lazy initialization 구현**

`ProgressionRepository.getOrCreate(profileId, selectedCharacterId)`가 level 1/xp 0, 선택 캐릭터 affinity level 1, streak 0/rest pass 0을 한 트랜잭션에서 만든다. startup 전체 backfill은 하지 않는다.

- [ ] **Step 5: repository compare-and-update helper 구현**

모든 write는 상위 `PokerDatabase.transaction()` 안에서만 호출한다. `progression_events` key가 이미 있으면 저장된 summary를 반환하고 상태를 다시 변경하지 않는다.

- [ ] **Step 6: migration·초기화 테스트 통과 확인**

Run: `npm test -- src/server/persistence/database.test.ts src/server/progression-repository.test.ts`

Expected: PASS for migration, lazy initialization, row guards, and duplicate initialization.

- [ ] **Step 7: 저장 계층 커밋**

```bash
git add src/server/persistence/migrations.ts src/server/persistence/database.test.ts src/server/progression-repository.ts src/server/progression-repository.test.ts
git commit -m "feat: add progression persistence schema"
```

### Task 2: 버전형 XP·친밀도 계산 구현

**Files:**
- Create: `src/lib/progression/types.ts`
- Create: `src/lib/progression/balance.ts`
- Test: `src/lib/progression/balance.test.ts`
- Create: `src/server/progression-service.ts`
- Create: `src/server/progression-service.test.ts`

- [ ] **Step 1: 레벨 경계와 감쇠 실패 테스트 작성**

```ts
expect(applyDojoXp({ level: 1, xpMilli: 99_000 }, 1_000)).toEqual({ level: 2, xpMilli: 0 });
expect(applyDojoXp({ level: 49, xpMilli: 1_299_000 }, 10_000)).toEqual({ level: 50, xpMilli: 0 });
expect(scaleReward(10_000, 250)).toBe(2_500);
```

레벨 50/친밀도 20에서는 overflow를 버리고 max level xp를 0으로 정규화한다.

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/lib/progression/balance.test.ts`

Expected: FAIL with missing balance module.

- [ ] **Step 3: balance registry와 순수 계산 구현**

```ts
export const BALANCE_BY_VERSION = new Map([[1, PROGRESSION_BALANCE_V1]]);

export function getBalance(version: number): ProgressionBalance {
  const balance = BALANCE_BY_VERSION.get(version);
  if (!balance) throw new Error(`UNKNOWN_PROGRESSION_BALANCE:${version}`);
  return balance;
}
```

이벤트 처리 시 profile의 version을 summary와 함께 기록한다. 기존 이벤트를 새 수치로 재계산하지 않는다.

- [ ] **Step 4: 공개 타입과 reward summary 정의**

```ts
export interface ProgressionRewardSummary {
  eventId: string;
  dojoXpMilli: number;
  dojoLevelsGained: number[];
  characterId: string;
  affinityMilli: number;
  affinityLevelsGained: number[];
  missionCompletions: MissionCompletion[];
  streak?: StreakChange;
  grantedItemIds: string[];
}
```

- [ ] **Step 5: `recordCompletedHand` 최소 구현**

이벤트 입력은 `{ profileId, roomId, handNumber, mode, selectedCharacterId, completedAt }`다. `mode === 'practice'`이면 KST 날짜별 완료 수 1~30은 1000 permille, 31번째부터 250 permille을 적용한다. cash/practice 모두 칩 결과·승패·베팅 크기를 입력으로 받지 않는다.

- [ ] **Step 6: `recordSngFinish` 최소 구현**

입력은 `{ profileId, roomId, place, selectedCharacterId, completedAt }`이며 place 1~6 배열의 XP/친밀도만 사용한다. casual SnG fee/prize 금액은 progression 서비스로 전달하지 않는다.

- [ ] **Step 7: exactly-once와 소수 누적 테스트 통과 확인**

Run: `npm test -- src/lib/progression/balance.test.ts src/server/progression-service.test.ts`

Expected: PASS for level 1→50, affinity 1→20, 30/31 practice boundary, 4 reduced hands accumulating exactly one full hand reward, duplicate event return.

- [ ] **Step 8: XP·친밀도 커밋**

```bash
git add src/lib/progression src/server/progression-service.ts src/server/progression-service.test.ts
git commit -m "feat: add versioned dojo and affinity growth"
```

### Task 3: 일일 과제 3개와 무료 1회 교체 구현

**Files:**
- Create: `src/lib/progression/missions.ts`
- Test: `src/lib/progression/missions.test.ts`
- Modify: `src/server/progression-repository.ts`
- Modify: `src/server/progression-service.ts`
- Modify: `src/server/progression-service.test.ts`

- [ ] **Step 1: 과제 허용 목록·배정 실패 테스트 작성**

```ts
expect(MISSION_CATALOG).toHaveLength(6);
expect(MISSION_CATALOG.map(m => m.metric)).not.toEqual(expect.arrayContaining([
  'wins', 'showdowns', 'allIns', 'raises', 'betSize',
]));
expect(assignDailyMissions('profile-a', '2026-07-16', 1)).toHaveLength(3);
```

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/lib/progression/missions.test.ts`

Expected: FAIL with missing mission catalog.

- [ ] **Step 3: 결정론적 3개 배정 구현**

`sha256(profileId:kstDate:balanceVersion)` 바이트를 seed로 사용해 중복 없는 3개를 선택한다. 같은 입력은 서버 재시작 뒤에도 같은 결과를 낸다. DB에는 선택 결과를 저장해 catalog 변경과 분리한다.

- [ ] **Step 4: 핸드·SnG 이벤트에 metric 반영**

완료 이벤트 한 건으로 `handsAny`, `handsCash`, `handsPractice`, `sngCompleted`, `modesCompleted`만 갱신한다. 과제 완료 순간 +100,000 milli-XP와 reward summary를 자동 지급하고 `rewarded_at`을 설정한다.

- [ ] **Step 5: 하루 한 번 특정 slot 교체 구현**

`rerollMission(profileId, kstDate, slot)`은 incomplete slot만 교체한다. 기존 2개와 당일 폐기된 mission ID를 제외하고 seed suffix `:reroll:1`로 새 과제를 고른다. 두 번째 요청과 완료 과제 요청은 명시적 오류다.

- [ ] **Step 6: 날짜 변경·중복 이벤트 테스트 통과 확인**

Run: `npm test -- src/lib/progression/missions.test.ts src/server/progression-service.test.ts`

Expected: PASS for three unique tasks, deterministic restart, one reroll, no duplicate XP, KST date rollover, two-mode set semantics.

- [ ] **Step 7: 과제 커밋**

```bash
git add src/lib/progression/missions.ts src/lib/progression/missions.test.ts src/server/progression-repository.ts src/server/progression-service.ts src/server/progression-service.test.ts
git commit -m "feat: add non-distorting daily missions"
```

### Task 4: 연속 수련과 월요일 휴식권 구현

**Files:**
- Modify: `src/server/progression-repository.ts`
- Modify: `src/server/progression-service.ts`
- Modify: `src/server/progression-service.test.ts`
- Create: `src/lib/progression/streak.ts`
- Test: `src/lib/progression/streak.test.ts`
- Create: `src/lib/collection/catalog.ts`

- [ ] **Step 1: 10핸드/1 SnG 자격과 휴식권 실패 테스트 작성**

테스트 clock은 KST를 사용한다. 9핸드는 미완료, 10핸드는 day 인정, SnG 1회는 즉시 인정, 월요일 grant는 cap 1, 하루 공백은 자동 소비, 이틀 공백은 streak reset이어야 한다.

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/lib/progression/streak.test.ts`

Expected: FAIL with missing streak module.

- [ ] **Step 3: lazy weekly grant 구현**

프로필 snapshot 조회와 progression event 처리 전에 `reconcileWeeklyRestPass(now)`를 호출한다. `last_week_key`보다 새로운 KST 월요일 주차면 +1하되 cap 1로 저장한다. scheduler가 없어도 정확히 한 번 지급돼야 한다.

- [ ] **Step 4: 일일 자격 누적 구현**

`streak_daily_progress(profile_id, kst_date, hands, sngs, qualified_at)`를 추가한다. 10번째 핸드 또는 첫 SnG에서만 `advanceStreakDay`를 한 번 호출한다.

- [ ] **Step 5: 공백과 자동 휴식권 소비 구현**

직전 인정 날짜와 오늘 사이 missed day가 1이고 pass가 있으면 pass 1개를 소비하고 streak를 유지한 채 오늘을 더한다. missed day가 2 이상이면 pass 하나로 메울 수 없으므로 current streak를 1로 재시작한다. 과거 날짜 이벤트는 streak를 역행 변경하지 않는다.

- [ ] **Step 6: 7일 주기 조각 보상 구현**

`src/lib/collection/catalog.ts`에 gameplay modifier가 없는 stackable `streak-fragment` 항목을 먼저 정의한다. 연속 일수가 7의 배수일 때 해당 inventory quantity를 +1한다. 14일에는 두 번째 조각을 주되 streak count는 14로 유지한다. idempotency key는 `streak-fragment:<profileId>:<qualifiedDate>`다.

- [ ] **Step 7: 경계 테스트 통과 확인**

Run: `npm test -- src/lib/progression/streak.test.ts src/server/progression-service.test.ts`

Expected: PASS for KST midnight, Monday grant, cap, auto-use, reset, day 7/14 fragments, duplicate qualification.

- [ ] **Step 8: 연속 수련 커밋**

```bash
git add src/lib/progression/streak.ts src/lib/progression/streak.test.ts src/lib/collection/catalog.ts src/server/progression-repository.ts src/server/progression-service.ts src/server/progression-service.test.ts
git commit -m "feat: add streaks and weekly rest passes"
```

### Task 5: 영구 cosmetic catalog·지급·장착 구현

**Files:**
- Modify: `src/lib/collection/catalog.ts`
- Test: `src/lib/collection/catalog.test.ts`
- Modify: `src/server/progression-service.ts`
- Modify: `src/server/progression-service.test.ts`
- Create: `src/server/progression-http.ts`
- Test: `src/server/progression-http.test.ts`
- Modify: `src/server/http-handler.ts`
- Modify: `src/server/index.ts`

- [ ] **Step 1: catalog 완전성 실패 테스트 작성**

각 item ID가 unique이고 모든 6명 캐릭터(`sakura`, `ara`, `hana`, `chloe`, `vivian`, `elena`)에 affinity 5/10/15/20 보상이 하나씩 있으며, 모든 아이템은 `gameplayModifiers: []`인지 검증한다.

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/lib/collection/catalog.test.ts`

Expected: FAIL with missing catalog.

- [ ] **Step 3: 도장 레벨 reward catalog 구현**

다음 지급표를 명시적으로 등록한다.

| 레벨 | 보상 |
|---:|---|
| 2 | 칭호 `새싹 도전자` |
| 5 | 프로필 테두리 `벚꽃` |
| 10 | 미야코 응원 emote |
| 15 | 칭호 `꾸준한 수련생` |
| 20 | 프로필 테두리 `청명` |
| 25 | 승리 컷인 효과 `집중선` |
| 30 | 칭호 `도장 상급생` |
| 35 | 프로필 테두리 `금빛` |
| 40 | 승리 컷인 효과 `승부의 순간` |
| 45 | 칭호 `백전연마` |
| 50 | 프로필 테두리 `도장 사범` |

- [ ] **Step 4: 캐릭터 affinity reward factory 구현**

캐릭터마다 level 5 `대사 꾸러미`, level 10 `인연 오라`, level 15 `인연 컷인`, level 20 `인연 스킨`을 만든다. 초기 인연 스킨은 새 bitmap 없이 기존 neutral/happy/sad 원화를 유지하고 캐릭터별 design token gradient·벚꽃/별빛 overlay를 적용하는 renderer variant다. 보상 이름은 UI에서 “{캐릭터명} 인연 스킨”으로 표시한다.

- [ ] **Step 5: 레벨 통과 보상 지급 구현**

한 이벤트가 여러 레벨을 넘으면 중간 reward를 모두 지급한다. `INSERT ... ON CONFLICT(profile_id,item_id) DO NOTHING`으로 영구 보상 중복을 막고 summary에는 이번에 새로 얻은 item만 넣는다.

- [ ] **Step 6: snapshot/reroll/equip HTTP API 구현**

```text
GET  /api/progression
POST /api/progression/missions/reroll   { slot }
POST /api/progression/character         { characterId }
POST /api/progression/equipment         { slot, itemId|null }
```

선택 character는 승인된 6명만 허용한다. 장착은 소유 item이며 catalog slot이 일치할 때만 허용한다. `skin` item의 character가 현재 선택 character와 다르면 409를 반환한다.

`src/server/index.ts`에서 `ProgressionRepository`와 `ProgressionService`를 한 번 생성해 HTTP router와 이후 RoomManager runtime이 같은 인스턴스를 공유하게 한다.

- [ ] **Step 7: 소유권·중복 지급 테스트 통과 확인**

Run: `npm test -- src/lib/collection/catalog.test.ts src/server/progression-service.test.ts src/server/progression-http.test.ts`

Expected: PASS for catalog coverage, crossed levels, duplicate grants, invalid character, unowned item, wrong slot, no gameplay modifiers.

- [ ] **Step 8: collection 커밋**

```bash
git add src/lib/collection src/server/progression-service.ts src/server/progression-service.test.ts src/server/progression-http.ts src/server/progression-http.test.ts src/server/http-handler.ts src/server/index.ts
git commit -m "feat: grant permanent cosmetic progression rewards"
```

### Task 6: RoomManager 완료 이벤트와 progression service 연결

**Files:**
- Create: `src/server/progression-runtime.ts`
- Test: `src/server/progression-runtime.test.ts`
- Modify: `src/server/room-manager.ts`
- Modify: `src/server/economy-runtime.ts`
- Modify: `src/server/socket-handler.ts`
- Modify: `src/server/index.ts`
- Modify: `src/lib/realtime/protocol.ts`
- Modify: `src/server/socket-handler.integration.test.ts`

- [ ] **Step 1: 모드별 이벤트 실패 테스트 작성**

cash 완료는 경제 정산 성공 뒤 reward, practice는 경제 원장 없이 reward, casual SnG는 최종 place reward, sitout/관전자/핸드 중 이탈자는 완료 reward 없음, 동일 hand 재호출은 한 번만 지급되는지 검증한다.

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/server/progression-runtime.test.ts`

Expected: FAIL with missing progression runtime.

- [ ] **Step 3: 완료 자격 snapshot 추가**

핸드 시작 직전 `dealtHumanProfileIds`와 `selectedCharacterByProfileId`를 RoomManager의 hand context에 저장한다. 종료 시 해당 player가 `pendingRemoval`이 아니고 핸드가 정상 정산된 경우만 시작 시점 캐릭터로 completed event를 만든다. 승패와 stack delta는 이벤트에서 제외한다.

- [ ] **Step 4: 경제→성장 순서 보장**

wallet cash는 `economy.afterHand()` 성공 후 progression을 호출한다. 경제 저장 실패 시 reward도 지급하지 않고 다음 핸드를 막는다. practice는 no-op 경제 성공 후 호출한다.

- [ ] **Step 5: SnG 최종 결과 fan-out 구현**

finished 전환 시 human results 각각에 `recordSngFinish`를 호출한다. 봇은 progression 대상이 아니다. 기존 종료 재공지나 retained room 재조회로 중복 지급되지 않도록 room/profile key를 사용한다.

- [ ] **Step 6: 개인 이벤트 emit 구현**

```ts
'progression-update': (snapshot: ProgressionSnapshot) => void;
'reward-summary': (summary: ProgressionRewardSummary) => void;
```

room broadcast가 아니라 해당 profile의 현재 socket에만 보낸다. 공개 game state에는 affinity·inventory를 넣지 않는다.

- [ ] **Step 7: 통합 테스트 통과 확인**

Run: `npm test -- src/server/progression-runtime.test.ts src/server/socket-handler.integration.test.ts src/server/economy-runtime.test.ts`

Expected: PASS for cash/practice/SnG, personal emit, idempotency, economic failure barrier, disconnected result persistence.

- [ ] **Step 8: 런타임 연결 커밋**

```bash
git add src/server/progression-runtime.ts src/server/progression-runtime.test.ts src/server/room-manager.ts src/server/economy-runtime.ts src/server/socket-handler.ts src/server/index.ts src/lib/realtime/protocol.ts src/server/socket-handler.integration.test.ts
git commit -m "feat: award progression from completed games"
```

### Task 7: 로비·프로필·종료 요약 UI 구현

**Files:**
- Create: `src/lib/store/progression-store.ts`
- Test: `src/lib/store/progression-store.test.ts`
- Create: `src/components/lobby/MissionPanel.tsx`
- Create: `src/components/profile/ProfileHub.tsx`
- Create: `src/components/profile/ProgressionTab.tsx`
- Create: `src/components/profile/AffinityTab.tsx`
- Create: `src/components/profile/InventoryTab.tsx`
- Create: `src/components/profile/RecordsTab.tsx`
- Create: `src/components/table/ProgressionSummary.tsx`
- Create: `src/components/collection/EquippedCosmetics.tsx`
- Modify: `src/lib/store/profile-store.ts`
- Modify: `src/app/page.tsx`
- Modify: `src/components/lobby/EconomyBar.tsx`
- Modify: `src/components/layout/GameRoomView.tsx`
- Modify: `src/components/layout/SettingsModal.tsx`
- Modify: `src/components/characters/CharacterImage.tsx`
- Modify: `src/components/characters/WinnerCutIn.tsx`
- Modify: `src/components/table/PlayerSeat.tsx`

- [ ] **Step 1: socket summary queue와 snapshot 실패 테스트 작성**

store가 HTTP snapshot을 받고 `progression-update`로 교체하며, `reward-summary`를 eventId당 한 번 queue하고 순서대로 소비하는지 검증한다.

- [ ] **Step 2: 실패 확인**

Run: `npm test -- src/lib/store/progression-store.test.ts`

Expected: FAIL with missing progression store.

- [ ] **Step 3: 로비 상태 표시 구현**

EconomyBar에 도장 레벨, 현재 XP progress, 선택 캐릭터 친밀도를 추가한다. MissionPanel은 3개 진행도와 남은 무료 교체를 표시하고, 완료 과제는 자동 수령 상태로 표현한다.

- [ ] **Step 4: ProfileHub 5개 탭 구현**

승인된 탭 `성장 / 인연 / 보관함 / 기록 / 복구`를 구현한다. 기록은 전체 완료 핸드, cash/practice/SnG 횟수, 최고 streak만 보여주며 승률로 보상을 주지 않는다. 기존 RecoveryPanel을 복구 탭에서 재사용한다.

- [ ] **Step 5: 장착 cosmetic 렌더 구현**

EquippedCosmetics가 frame/title/skin/cutin만 해석한다. `CharacterImage`는 skin overlay class를 추가하되 원본 art 경로와 expression fallback을 유지한다. PlayerSeat에는 본인 public title/frame만 필요한 최소 공개 DTO를 game state에 넣고, 다른 inventory 전체는 공개하지 않는다.

- [ ] **Step 6: 경기 종료 성장 요약 구현**

HandEconomySummary 다음에 XP, affinity, mission completion, streak, 새 item을 한 카드에서 보여준다. 중요한 item 획득만 기존 CharacterImage cut-in을 쓰고 일반 XP는 compact toast로 처리한다.

- [ ] **Step 7: UI 검증**

Run: `npm test -- src/lib/store/progression-store.test.ts`

Expected: PASS.

Run: `npm run lint`

Expected: PASS; 렌더 중 시각 계산에 `Date.now()`를 쓰지 않음.

Run: `npx tsc --noEmit`

Expected: PASS.

- [ ] **Step 8: 성장 UX 커밋**

```bash
git add src/lib/store/progression-store.ts src/lib/store/progression-store.test.ts src/lib/store/profile-store.ts src/components/lobby/MissionPanel.tsx src/components/profile src/components/table/ProgressionSummary.tsx src/components/collection src/app/page.tsx src/components/lobby/EconomyBar.tsx src/components/layout/GameRoomView.tsx src/components/layout/SettingsModal.tsx src/components/characters/CharacterImage.tsx src/components/characters/WinnerCutIn.tsx src/components/table/PlayerSeat.tsx
git commit -m "feat: add dojo progression and collection ux"
```

### Task 8: 2단계 전체 회귀와 수용 기준 검증

**Files:**
- Verify: entire repository

- [ ] **Step 1: 행동 왜곡 키워드와 gameplay modifier 검색**

Run: `rg -n "win(s)?|showdown|all.?in|raise|bet.?size|chip.?reward|rank.?point|gameplayModifiers" src/lib/progression src/lib/collection`

Expected: mission metric에 금지 행동 없음; `gameplayModifiers`는 빈 배열 선언/검증 외 사용 없음; placement XP는 SnG finish 처리에서만 존재.

- [ ] **Step 2: 집중 테스트 실행**

Run: `npm test -- src/lib/progression src/lib/collection src/server/progression-service.test.ts src/server/progression-runtime.test.ts src/server/progression-http.test.ts src/lib/store/progression-store.test.ts`

Expected: PASS.

- [ ] **Step 3: 전체 테스트 실행**

Run: `npm test`

Expected: PASS; 기존 엔진·사이드팟·이탈·세션·경제 회귀도 유지.

- [ ] **Step 4: 정적 검증과 production build**

Run: `npm run lint`

Expected: PASS.

Run: `npx tsc --noEmit`

Expected: PASS.

Run: `npm run build`

Expected: PASS.

- [ ] **Step 5: 수동 clock 수용 시나리오 실행**

개발 전용 injected clock 테스트 서버에서 다음을 확인한다.

1. 연습 30번째와 31번째 핸드 reward가 10/2.5 XP로 표시된다.
2. 새로고침 후에도 31번째 감쇠가 유지되고 소수 4회가 정확히 누적된다.
3. 10핸드 또는 SnG 1회로 오늘 streak가 한 번만 인정된다.
4. 월요일 휴식권은 1개를 넘지 않고 하루 공백에 자동 소비된다.
5. 레벨·친밀도 reward를 장착해도 valid action, stack, wallet, rake가 바뀌지 않는다.

- [ ] **Step 6: 임시 표식과 수치 자체 검수**

Run: `rg -n "TO[D]O|TB[D]|place[h]older|FIX[M]E" src/lib/progression src/lib/collection src/server/progression* src/components/profile src/components/lobby/MissionPanel.tsx`

Expected: no matches.

Run: `rg -n "30|250|50|20|10|weeklyRestPassGrant" src/lib/progression/balance.ts`

Expected: approved 30-hand, 25%, level 50, affinity 20, 10-hand, weekly pass values are present once in V1 config.

- [ ] **Step 7: 최종 2단계 커밋**

```bash
git status --short
git add -A
git commit -m "test: verify dojo progression phase"
```

새 변경이 없으면 빈 커밋을 만들지 않는다. 이 시점의 수용 기준은 다음과 같다.

- 모든 성장 보상은 완료 이벤트에만 의존하고 포커 행동/칩/확률을 바꾸지 않는다.
- 도장 레벨은 1~50, 각 캐릭터 친밀도는 독립 1~20이다.
- 봇 연습은 KST 일 30핸드까지 100%, 이후 25%이며 소수 보상이 보존된다.
- 과제 3개와 무료 교체 1회가 KST 날짜별 exactly-once로 동작한다.
- 10핸드/1 SnG streak, 월요일 휴식권 1개, 7일 조각 반복이 동작한다.
- 보상은 영구 inventory에 중복 없이 쌓이고 cosmetic slot만 변경한다.
