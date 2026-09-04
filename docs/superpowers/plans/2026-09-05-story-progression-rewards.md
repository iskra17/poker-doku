# Story Progression Rewards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 총괄의 Fable 5.1 xhigh 사전 검토 판정과 구현 승인을 반영했다.

**Goal:** 스토리 XP로 도달한 일반 도장 및 모든 히로인 인연 레벨 아이템을 실시간 지급하고 기존 프로필의 누락분을 중복 없이 소급한다.

**Architecture:** v13의 이벤트 기반 영구 지급과 v32의 스토리 전용 지급은 그대로 유지한다. v34에 현재 서버 정본 레벨로 검증하는 정규화 영수증을 추가하고, 스토리 실시간 및 시작 시 소급이 동일한 자격 뷰와 저장소 함수를 사용한다. 과거 이벤트 JSON은 수정하지 않는다.

**Tech Stack:** TypeScript, Node SQLite `DatabaseSync`, `PokerDatabase.transaction`의 동기 `BEGIN IMMEDIATE`, Vitest.

---

## 1. 조사 결과와 고정 결정

기준 `92e508b`, 작업 브랜치 `fix/story-progression-rewards`. 상위 명세 `docs/superpowers/specs/2026-09-05-development-orchestration-design.md` §5 R1a 및 AGENTS.md를 따른다.

- `src/server/progression-service.ts`의 `applyStoryReward`는 히로인마다 XP를 CAS 갱신하고 `affinityTransitions`를 반환하지만, 영구 아이템은 지급하지 않는다. 저장 summary에는 첫 히로인만 있다. 이 summary를 재생하면 두 번째 이후 히로인의 누락을 복구할 수 없다.
- 일반 `applyReward`는 `getDojoRewardItems`/`getAffinityRewardItems`로 경계를 넘긴 아이템을 찾아 `grantPermanentInventoryItemInTransaction`에 전달한다. v13 `canonical_progression_reward_source_events`는 `completed-hand`/`sng-finish`만 엄격하게 허용한다. 그 뷰의 이벤트 화이트리스트를 넓히지 않는다.
- `collection_catalog`는 일반 레벨 보상 35개(도장 11개+6명×4개)와 조각을 가진다. TS `COLLECTION_CATALOG`와 DB 카탈로그 패리티를 유지한다. 카탈로그 보상 기준이나 캐릭터 명단을 새 서비스에 복사하지 않는다.
- v32/v33 `story_rewards`와 `story_reward_catalog`는 칭호/의상/칩/CG 등의 별도 계약이다. 이번 변경으로 이 테이블을 사용하거나 수정하지 않는다.
- 현재 인벤토리 INSERT는 DB 카탈로그 형태를 검증하며, v11 영구 영수증이 인벤토리를 생성하는 패턴이 있다. v34에도 별도 영수증→인벤토리 생성 트리거를 둔다. 기존 트리거를 DROP하지 않는다.

**증빙 단일 소스:** 신규 지급의 자격은 `progression_profiles`/`character_affinity`의 현재 값과 `collection_catalog`를 조인한 `eligible_progression_level_rewards` 뷰다. `progression_level_reward_grants`는 그 순간의 balance/level/XP/기준 레벨/캐릭터를 보존하는 불변 영수증이다. `source_event_id`는 실시간 지급의 감사 연결이며 레벨 자격을 대신하지 않는다. 이 구분으로 임의 이벤트를 인정하거나 과거 첫 히로인 요약을 확장할 필요가 없다.

**소급 시점: listen 전 전체 프로필, 프로필별 트랜잭션으로 고정.** lazy snapshot은 시작 시간을 줄이지만 미접속 기존 사용자는 보상 누락이 지속되고 HTTP/소켓/장착 등 모든 읽기 진입점을 변경해야 한다. 시작 시 전체 처리라면 배포 후 첫 응답부터 모든 기존 인벤토리가 일관된다. 단일 머신/동기 SQLite인 현재 구조에 맞춰 PK keyset 100명씩 읽고 각 프로필을 개별 커밋한다. 전체 DB를 하나의 트랜잭션으로 묶거나 생성자에서 실행하지 않는다. 보상 대상 여부와 무관하게 기존 `progression_profiles` 전부를 조사하며 프로필·인연 행을 새로 만들지 않는다.

시작 시간이 프로필 수에 비례한다는 비용을 수용한다. 빈 차집합이면 쓰기 0건이다. 시작 실패는 swallow하지 않고 서버 listen을 중단한다. 배포 후 시작 로그에 조사 프로필 수·실제 지급 수·소요시간만 남긴다(프로필 비밀/이벤트 JSON 로그 금지). 새 UI/관리 API/스케줄러/영속 커서 테이블은 추가하지 않는다.

## 2. 변경 파일과 함수

| 파일 | 변경 책임 |
|---|---|
| `src/server/persistence/migrations.ts` | 끝에 v34 `progression_level_reward_entitlements` 추가. 아래 뷰/영수증/검증/불변/인벤토리 트리거 |
| `src/server/progression-repository.ts` | `getMissingLevelRewardsInTransaction`, `grantLevelRewardsInTransaction`, `listProgressionProfileIdsAfter` 추가. 기존 `grantPermanentInventoryItemInTransaction` 변경하지 않음 |
| `src/server/progression-service.ts` | `applyStoryReward` 실시간 지급 연결, `reconcileLevelRewards`와 `reconcileAllLevelRewards` 추가 |
| `src/server/index.ts` | `initializePersistenceAndRecover`에서 서비스 구성 후 `reconcileAllLevelRewards(Date.now())` 실행. 기존 MTT 경제 복구의 상대 순서는 바꾸지 않음 |
| `src/server/progression-service.story.test.ts` | 실시간 레벨 경계/다중 히로인/일일/중복/롤백 회귀; 카탈로그 미지급을 단언한 기존 테스트 수정 |
| `src/server/progression-repository.test.ts` | 신규 저장소 API, 기존 영구 영수증 보유와 교차 멱등성 |
| `src/server/persistence/database.test.ts` | 최신 버전 34/테이블 목록, 신규 DB 가드, v33 업그레이드 및 재오픈 |
| `src/server/progression-service.level-rewards.test.ts` (신규) | 전체 소급·중단 복구·정본 다중 히로인·과거 이벤트 불변 |
| `AGENTS.md` | 구현 검증 이후 미완료 설명을 변경 결과와 신규 증빙 계약으로 갱신 |

`src/lib/collection/catalog.ts`는 조사/패리티 기준이며 수정 필요 없다. 클라이언트 summary 타입/파서/뷰, 스토리 챕터·채점·보상 경제량은 변경하지 않는다.

## 3. Task 1 — v34 스키마와 DB 가드

- [ ] 먼저 신규 테이블 존재/직접 SQL 부정 지급 거절 테스트를 작성해 현재 v33에서 실패시킨다.
- [ ] 다음 SQL을 신규 migration에 추가한다. 기존 v13/v32/v33 SQL은 한 글자도 수정하지 않는다.

```sql
CREATE VIEW eligible_progression_level_rewards AS
SELECT p.profile_id, c.item_id, c.source_kind, c.required_level,
       c.character_id, p.balance_version,
       CASE c.source_kind WHEN 'dojo-level' THEN p.dojo_level ELSE a.level END AS observed_level,
       CASE c.source_kind WHEN 'dojo-level' THEN p.dojo_xp_milli ELSE a.xp_milli END AS observed_xp_milli
FROM progression_profiles p
JOIN collection_catalog c ON c.stackable = 0
LEFT JOIN character_affinity a
  ON a.profile_id = p.profile_id AND a.character_id = c.character_id
WHERE (c.source_kind = 'dojo-level' AND p.dojo_level >= c.required_level)
   OR (c.source_kind = 'affinity-level' AND a.level >= c.required_level);

CREATE TABLE progression_level_reward_grants (
  profile_id TEXT NOT NULL REFERENCES progression_profiles(profile_id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES collection_catalog(item_id),
  source_kind TEXT NOT NULL CHECK(source_kind IN ('dojo-level','affinity-level')),
  required_level INTEGER NOT NULL CHECK(required_level BETWEEN 2 AND 50),
  character_id TEXT,
  balance_version INTEGER NOT NULL CHECK(balance_version = 1),
  observed_level INTEGER NOT NULL CHECK(observed_level BETWEEN 2 AND 50),
  observed_xp_milli INTEGER NOT NULL CHECK(observed_xp_milli BETWEEN 0 AND 9007199254740991),
  reason TEXT NOT NULL CHECK(reason IN ('story','reconcile-v34')),
  source_event_id TEXT,
  granted_at INTEGER NOT NULL CHECK(granted_at BETWEEN 0 AND 253402300799999),
  PRIMARY KEY(profile_id,item_id),
  CHECK((reason = 'story' AND source_event_id IS NOT NULL)
     OR (reason = 'reconcile-v34' AND source_event_id IS NULL)),
  FOREIGN KEY(source_event_id,profile_id)
    REFERENCES progression_events(idempotency_key,profile_id) ON DELETE NO ACTION
) STRICT;
CREATE INDEX idx_level_reward_grants_source_event
  ON progression_level_reward_grants(source_event_id,profile_id);

CREATE TRIGGER validate_level_reward_grant_insert
BEFORE INSERT ON progression_level_reward_grants
WHEN NOT EXISTS (
  SELECT 1 FROM eligible_progression_level_rewards e
  WHERE e.profile_id = NEW.profile_id AND e.item_id = NEW.item_id
    AND e.source_kind = NEW.source_kind AND e.required_level = NEW.required_level
    AND e.character_id IS NEW.character_id AND e.balance_version = NEW.balance_version
    AND e.observed_level = NEW.observed_level AND e.observed_xp_milli = NEW.observed_xp_milli
) OR EXISTS (
  SELECT 1 FROM inventory_items i
  WHERE i.profile_id = NEW.profile_id AND i.item_id = NEW.item_id
) OR EXISTS (
  SELECT 1 FROM permanent_progression_grants g
  WHERE g.profile_id = NEW.profile_id AND g.item_id = NEW.item_id
) OR (NEW.reason = 'story' AND NOT EXISTS (
  SELECT 1 FROM progression_events e
  WHERE e.idempotency_key = NEW.source_event_id AND e.profile_id = NEW.profile_id
    AND e.event_type IN ('story-chapter','story-daily-drills')
    AND e.balance_version = NEW.balance_version AND e.created_at = NEW.granted_at
    AND json_valid(e.summary_json)
    AND json_type(e.summary_json) = 'object'
    AND json_type(e.summary_json,'$.eventId') = 'text'
    AND json_type(e.summary_json,'$.grantedItemIds') = 'array'
    AND json_extract(e.summary_json,'$.eventId') = e.idempotency_key
    AND EXISTS (SELECT 1 FROM json_each(e.summary_json,'$.grantedItemIds') j
                WHERE j.type = 'text' AND j.value = NEW.item_id)
))
BEGIN SELECT RAISE(ABORT,'invalid level reward entitlement'); END;

CREATE TRIGGER sync_level_reward_inventory
AFTER INSERT ON progression_level_reward_grants
BEGIN
  INSERT INTO inventory_items(profile_id,item_id,quantity,granted_at,updated_at)
  VALUES(NEW.profile_id,NEW.item_id,1,NEW.granted_at,NEW.granted_at);
END;
CREATE TRIGGER freeze_level_reward_grant_update
BEFORE UPDATE ON progression_level_reward_grants
BEGIN SELECT RAISE(ABORT,'immutable level reward grant'); END;
CREATE TRIGGER freeze_level_reward_grant_delete
BEFORE DELETE ON progression_level_reward_grants
WHEN EXISTS(SELECT 1 FROM progression_profiles WHERE profile_id = OLD.profile_id)
BEGIN SELECT RAISE(ABORT,'immutable level reward grant'); END;
CREATE TRIGGER freeze_level_reward_event_update
BEFORE UPDATE ON progression_events
WHEN EXISTS(SELECT 1 FROM progression_level_reward_grants WHERE source_event_id = OLD.idempotency_key)
BEGIN SELECT RAISE(ABORT,'immutable level reward source event'); END;
CREATE TRIGGER freeze_level_reward_event_insert
BEFORE INSERT ON progression_events
WHEN EXISTS(SELECT 1 FROM progression_level_reward_grants
            WHERE source_event_id = NEW.idempotency_key)
BEGIN SELECT RAISE(ABORT,'immutable level reward source event'); END;
CREATE TRIGGER prevent_legacy_level_reward_double_receipt
BEFORE INSERT ON permanent_progression_grants
WHEN EXISTS(SELECT 1 FROM progression_level_reward_grants
            WHERE profile_id = NEW.profile_id AND item_id = NEW.item_id)
BEGIN SELECT RAISE(ABORT,'level reward already granted'); END;
CREATE TRIGGER protect_level_reward_inventory_update
BEFORE UPDATE ON inventory_items
WHEN EXISTS(SELECT 1 FROM progression_level_reward_grants
            WHERE profile_id = OLD.profile_id AND item_id = OLD.item_id)
BEGIN SELECT RAISE(ABORT,'immutable level reward inventory'); END;
CREATE TRIGGER protect_level_reward_inventory_delete
BEFORE DELETE ON inventory_items
WHEN EXISTS(SELECT 1 FROM progression_level_reward_grants
            WHERE profile_id = OLD.profile_id AND item_id = OLD.item_id)
 AND EXISTS(SELECT 1 FROM profiles WHERE id = OLD.profile_id)
BEGIN SELECT RAISE(ABORT,'immutable level reward inventory'); END;

CREATE TRIGGER protect_level_reward_inventory_insert
BEFORE INSERT ON inventory_items
WHEN EXISTS(SELECT 1 FROM progression_level_reward_grants
            WHERE profile_id = NEW.profile_id AND item_id = NEW.item_id)
 AND EXISTS(SELECT 1 FROM inventory_items
            WHERE profile_id = NEW.profile_id AND item_id = NEW.item_id)
BEGIN SELECT RAISE(ABORT,'immutable level reward inventory'); END;
```

신규 이벤트의 summary는 기존 `parseStoredSummary`/`parseProgressionRewardSummary`를 통과한 서버 생성값만 저장한다. SQL의 `source_event_id` 검증은 이벤트 종류·프로필·시각·아이템을 묶는 감사 가드이고, **현재 레벨 검증에 AND로 더해진 조건**이다. 미래 레벨·다른 히로인·임의 카탈로그 아이템은 이벤트 내용이 어떻든 지급 불가다. `reason='reconcile-v34'`는 어떤 이벤트도 허용하지 않으며 현재 정본 증빙을 필수로 요구한다. 임의 이벤트로 기존 v13 경로의 자격을 얻을 수 없다.

FK는 신규 실시간 경로가 이벤트를 먼저 INSERT하므로 지연 불필요다. 영수증 이후 source event DELETE는 FK가 차단한다. 인벤토리는 기존 `(profile_id,item_id)` PK와 catalog/shape 검증을 그대로 통과하며 신규 receipt AFTER INSERT가 원자적으로 만든다. 이후 보호 트리거가 인벤토리 UPDATE/DELETE를 막으므로 별도 nullable inventory-source 컬럼이나 기존 FK 교체가 필요 없다. 양쪽 receipt의 교차 존재 검사를 신규 BEFORE INSERT 두 개로 보장한다. 기존 영수증이 먼저면 신규 경로를, 신규 영수증이 먼저면 일반 경로의 직접 SQL 이중 영수증을 차단한다. 서비스의 정상 일반 지급은 기존 inventory 검사에서 false를 반환하므로 이 가드를 건드리지 않는다. 프로필 삭제 cascade는 기존 영구 영수증 정책과 동일하게 허용되도록 통합 테스트한다. `INSERT OR REPLACE`로 불변성을 우회하는 경우도 직접 SQL 테스트에 포함한다. 인벤토리 트리거는 충돌을 숨기지 않는다.

- [ ] v33 스키마 fixture에서 `sqlite_schema`의 기존 v13/v32 뷰·트리거 SQL을 저장하고 v34 적용 후 동등함을 단언한다. 기존 DB 테스트의 latest version 33 단언을 34로 바꾸되 과거 버전 fixture 단언은 유지한다.
- [ ] 실행: `npx vitest run src/server/persistence/database.test.ts --maxWorkers=4`. 새 가드와 기존 migration/카탈로그/장착 회귀가 모두 통과해야 한다.

## 4. Task 2 — 공용 저장소 지급 함수

- [ ] `src/server/progression-repository.ts`에 다음 타입/메서드를 추가한다. 외부 호출은 트랜잭션을 열지 않으며 모든 InTransaction 함수는 첫 줄 `this.assertTransaction()`을 호출한다.

```ts
export interface LevelRewardCandidate {
  itemId: string;
  sourceKind: 'dojo-level' | 'affinity-level';
  requiredLevel: number;
  characterId: ProgressionCharacterId | null;
  balanceVersion: number;
  observedLevel: number;
  observedXpMilli: number;
}
export type LevelRewardOrigin =
  | { reason: 'story'; sourceEventId: string }
  | { reason: 'reconcile-v34'; sourceEventId: null };
// getMissingLevelRewardsInTransaction(profileId: string): LevelRewardCandidate[]
// grantLevelRewardsInTransaction(profileId: string, candidates: readonly LevelRewardCandidate[],
//   origin: LevelRewardOrigin, grantedAt: number): string[]
// listProgressionProfileIdsAfter(after: string, limit = 100): string[]
```

후보 조회 SQL (snake_case 행을 위 타입으로 명시 매핑, 안정 순서):

```sql
SELECT e.* FROM eligible_progression_level_rewards e
WHERE e.profile_id = ?
  AND NOT EXISTS(SELECT 1 FROM inventory_items i
                 WHERE i.profile_id=e.profile_id AND i.item_id=e.item_id)
ORDER BY e.item_id;
```

기존 영수증이 있는데 인벤토리가 없는 손상은 건너뛰지 말고 `PROGRESSION_PERSISTENCE_INVALID`로 실패시킨다(새 trigger가 기존 receipt를 거절). 이미 인벤토리가 있는 경우 조회에서 빠지므로 보유 아이템의 시각·수량·원본 영수증은 변경하지 않는다. 정상 영구 보상 수량은 기존 DB shape 가드가 1로 보장한다.

지급은 `profileId`, timestamp를 기존 validator로 검증하고 candidates의 중복 ID를 거절한 뒤 아래 INSERT를 후보별로 실행한다. `INSERT ... ON CONFLICT DO NOTHING`으로 오류를 삼키지 않는다. 동일 트랜잭션에서 계산한 차집합이므로 정상 중복 호출은 후보 0개다. 잘못 전달된 stale 후보는 DB 가드가 거절한다.

```sql
INSERT INTO progression_level_reward_grants
(profile_id,item_id,source_kind,required_level,character_id,balance_version,
 observed_level,observed_xp_milli,reason,source_event_id,granted_at)
VALUES(?,?,?,?,?,?,?,?,?,?,?);
```

`run` 인수는 `[profileId,c.itemId,c.sourceKind,c.requiredLevel,c.characterId,c.balanceVersion,c.observedLevel,c.observedXpMilli,origin.reason,origin.sourceEventId,grantedAt]`. 각 INSERT 후 inventory의 `quantity=1, granted_at=updated_at=grantedAt`를 확인하고 불일치 시 기존 persistence error로 throw한다. 반환은 실제 INSERT된 IDs 순서다. 예상 candidate 목록과 실제 반환이 완전히 같아야 한다.

프로필 목록은 아래 SQL과 bounded 양의 limit를 사용한다. 모든 프로필 ID를 메모리에 적재하지 않는다.

```sql
SELECT profile_id FROM progression_profiles
WHERE profile_id > ? ORDER BY profile_id LIMIT ?;
```

- [ ] `ProgressionRepository`의 기존 오류 포장(`rethrowUnexpected`)과 타입 import 스타일을 유지한다. 신규 계층/별도 grant 서비스를 만들지 않는다.
- [ ] 실행: `npx vitest run src/server/progression-repository.test.ts --maxWorkers=4`.

## 5. Task 3 — 스토리 실시간 지급과 시작 소급

- [ ] `applyStoryReward`에서 기존 XP CAS 순서를 유지한다. 모든 affinity 갱신 및 progression CAS가 끝난 뒤 후보를 구한다. 첫 히로인만 보는 코드를 지급 판단에 사용하지 않는다.
- [ ] `summary.grantedItemIds`를 후보 itemId 목록으로 채운 뒤 기존 `insertProgressionEvent`를 **한 번만** 호출한다. 이어 `grantLevelRewardsInTransaction(...,{reason:'story',sourceEventId:input.eventId},input.completedAt)`를 실행하고 반환 목록 일치를 확인한다. 그 후 기존 `parseStoredSummary`로 반환한다.

```ts
const candidates = this.repository.getMissingLevelRewardsInTransaction(input.profile.profileId);
summary.grantedItemIds = candidates.map(candidate => candidate.itemId);
const inserted = this.repository.insertProgressionEvent({
  idempotencyKey: input.eventId, profileId: input.profile.profileId,
  eventType: input.eventType, balanceVersion: input.profile.balanceVersion,
  summary: { ...summary }, createdAt: input.completedAt,
});
const granted = this.repository.grantLevelRewardsInTransaction(
  input.profile.profileId, candidates,
  { reason: 'story', sourceEventId: input.eventId }, input.completedAt,
);
if (granted.length !== summary.grantedItemIds.length
    || granted.some((id, index) => id !== summary.grantedItemIds[index])) {
  throw new ProgressionPersistenceError('PROGRESSION_PERSISTENCE_INVALID');
}
return { summary: parseStoredSummary(inserted.event, input.eventId), affinityTransitions };
```

이 함수는 기존 `recordStoryReward` 소유의 단일 transaction 내부다. receipt/인벤토리/event 어느 단계든 실패하면 dojo XP·모든 affinity XP·summary INSERT·영수증·인벤토리가 함께 rollback한다. summary 필드 추가 없음. 기존 duplicate branch는 저장 summary 그대로 반환하고 새 지급/새 XP를 실행하지 않는다. v33 과거 duplicate의 빈 아이템 summary는 고치지 않으며 시작 소급이 인벤토리를 이미 고친다.

후보는 이번 경계만이 아닌 현재 레벨 전체 차집합이므로 이미 누락이 존재하는 테스트/외부 호출도 회복한다. 이때 summary의 아이템 목록에는 이번 지급 전체가 실리지만 `dojoLevelsGained`/`affinityLevelsGained`는 실제 이번 XP 전이 그대로다. 이것이 기존 v13 증빙 경로를 재사용하지 않는 이유다.

- [ ] 다음 public 메서드를 `ProgressionService`에 추가한다. 프로필 존재/시간 validator는 기존 방식을 사용한다.

```ts
reconcileLevelRewards(profileId: string, at = Date.now()): string[] {
  assertBoundedId(profileId);
  assertTimestamp(at);
  return this.database.transaction(() => {
    this.repository.getSnapshotInTransaction(profileId); // 없는 프로필을 만들지 않는다
    const candidates = this.repository.getMissingLevelRewardsInTransaction(profileId);
    return this.repository.grantLevelRewardsInTransaction(
      profileId, candidates, { reason: 'reconcile-v34', sourceEventId: null }, at,
    );
  });
}

reconcileAllLevelRewards(at = Date.now()): { profiles: number; granted: number } {
  assertTimestamp(at);
  let after = '';
  let profiles = 0;
  let granted = 0;
  for (;;) {
    const ids = this.repository.listProgressionProfileIdsAfter(after, 100);
    if (ids.length === 0) return { profiles, granted };
    for (const profileId of ids) {
      granted += this.reconcileLevelRewards(profileId, at).length;
      profiles += 1;
      after = profileId;
    }
  }
}
```

실행 순서 `initializePersistenceAndRecover`: 기존 스키마 migration → 서비스 초기화 및 기존 경제/MTT 복구 → arena 구성/복구 블록 → `progressionService.reconcileAllLevelRewards` 완료 → native backup 검사 → 기존 함수 return → listen. 호출은 arena 블록 직후이면서 native-backup 미지원 dev 조기 return 이전에 둔다. 이 함수 바깥 listener/route에서 추가 호출하지 않는다. 신규 프로필은 이후 story XP 발생 트랜잭션에서 자연 지급된다. 일반 핸드/SnG 지급 경로는 변경하지 않는다.

### Fable 사전 검토 수용 (구현 승인)

총괄이 실제 Fable 5.1 xhigh 검토 세 건을 코드와 대조해 수용했다. `getDuplicate`의 `validateStoredPermanentClaims`는 story-chapter/story-daily-drills에 한해서 신규 receipt의 `(profile_id,source_event_id)` 정확한 item 집합을 비교한다. 기존 hand/SnG receipt 검증은 유지한다. 옛 빈 summary는 빈 receipt와 맞아 정상 재전송되고 forged claim은 거절한다. SQLite 기본 recursive_triggers OFF에서 `INSERT OR REPLACE`는 DELETE 가드를 우회하므로, 새 receipt와 같은 inventory가 이미 존재할 때 BEFORE INSERT로 거절하는 별도 가드를 추가한다. 정상 sync의 최초 inventory INSERT는 아직 inventory가 없으므로 통과한다. 위 startup 위치도 dev 조기 return 전에 실행되도록 수정했다.

중단 복구: 프로필 A 커밋, B 중간 throw이면 B 전체만 rollback하고 startup 실패. 재시작은 A를 다시 조사하지만 후보 0개, B부터 실제 지급을 재개한다. 영속 커서가 없어 누락 프로필을 영구히 스킵하지 않는다. 같은 DB를 정상 종료/재오픈하여 영수증과 인벤토리가 남는지 확인한다.

## 6. Task 4 — 실행 가능한 회귀 테스트

아래 두 테스트는 기존 `progression-service.story.test.ts`의 describe 안에 그대로 추가한다(`seedProfile`, `database`, `service`, `AT` 기존 helper 사용). 최신 TS 카탈로그/DB parity가 테스트하는 기준을 사용한다.

```ts
it('grants dojo and both heroine rewards atomically and replays once', () => {
  seedProfile('profile-a', 'ara');
  database.db.prepare(`UPDATE progression_profiles
    SET dojo_level=2, dojo_xp_milli=0 WHERE profile_id=?`).run('profile-a');
  database.db.prepare(`INSERT INTO character_affinity(profile_id,character_id,level,xp_milli)
    VALUES (?, 'sakura', 5, 0), (?, 'hana', 10, 0)`).run('profile-a','profile-a');
  const input = {
    profileId:'profile-a', chapterId:'act1-ch01', runId:'reward-run',
    firstClear:true, grade:'A' as const, dojoXpMilli:1,
    affinity:[{ characterId:'sakura' as const,milli:1 },{ characterId:'hana' as const,milli:1 }],
    completedAt:AT,
  };
  const first = service.recordStoryChapterComplete(input);
  expect(first.summary.grantedItemIds.sort()).toEqual([
    'affinity-hana-aura','affinity-hana-dialogue-pack',
    'affinity-sakura-dialogue-pack','dojo-title-sprout-challenger',
  ]);
  const again = service.recordStoryChapterComplete(input);
  expect(again.duplicate).toBe(true);
  expect(again.summary).toEqual(first.summary);
  expect(database.db.prepare(`SELECT COUNT(*) n FROM progression_level_reward_grants`).get())
    .toEqual({n:4});
  expect(first.snapshot.profile.selectedCharacterId).toBe('ara');
});

it('reconciles all current heroine levels without rewriting historic summaries', () => {
  seedProfile('profile-a','ara');
  const first = service.recordStoryChapterComplete({
    profileId:'profile-a',chapterId:'act1-ch01',runId:'old-run',firstClear:true,
    grade:'A',dojoXpMilli:0,affinity:[],completedAt:AT,
  });
  const readEvent = () => database.db.prepare(`SELECT * FROM progression_events WHERE idempotency_key=?`)
    .get(first.summary.eventId);
  const before = readEvent();
  database.db.prepare(`INSERT INTO character_affinity(profile_id,character_id,level,xp_milli)
    VALUES (?, 'hana', 20, 0), (?, 'elena', 5, 0)`).run('profile-a','profile-a');
  expect(service.reconcileLevelRewards('profile-a',AT+1).sort()).toEqual([
    'affinity-elena-dialogue-pack','affinity-hana-aura','affinity-hana-cutin',
    'affinity-hana-dialogue-pack','affinity-hana-skin',
  ]);
  expect(service.reconcileLevelRewards('profile-a',AT+2)).toEqual([]);
  expect(readEvent()).toEqual(before);
});
```

**위 fixture는 누락 복구 검증이고 XP 경계 검증을 대신하지 않는다.** 같은 파일에 `import { getBalance } from '@/lib/progression/balance';`를 추가하고 다음 실제 경계 테스트를 넣는다.

```ts
it.each([0, 1])('grants only at the exact dojo and second heroine boundary: %i', milli => {
  seedProfile('profile-a','ara');
  const balance = getBalance(1);
  database.db.prepare(`UPDATE progression_profiles SET dojo_xp_milli=? WHERE profile_id=?`)
    .run(balance.dojoXpForNextLevel(1)-1,'profile-a');
  database.db.prepare(`INSERT INTO character_affinity(profile_id,character_id,level,xp_milli)
    VALUES (?, 'hana', 4, ?)`).run('profile-a',balance.affinityForNextLevel(4)-1);
  const result = service.recordStoryChapterComplete({
    profileId:'profile-a',chapterId:'act1-ch01',runId:'boundary',firstClear:true,
    grade:'A',dojoXpMilli:milli,
    affinity:[{characterId:'ara',milli:0},{characterId:'hana',milli}],completedAt:AT,
  });
  expect(result.summary.grantedItemIds).toEqual(milli === 1
    ? ['affinity-hana-dialogue-pack','dojo-title-sprout-challenger'] : []);
  expect(result.snapshot.profile.dojoLevel).toBe(milli === 1 ? 2 : 1);
  expect(affinityOf(result.snapshot,'hana')?.level).toBe(milli === 1 ? 5 : 4);
});
```

추가 경계는 `getBalance`의 실제 level별 요구 XP에서 1 milli 모자란 상태를 seed하고 0/1/요구량 합계 XP를 주어 바로 전/정확히/여러 레벨을 검증한다. 인연 레벨 9→10, 14→15, 19→20, 도장 4→5/9→10을 포함한다. story 상한을 초과하는 XP를 억지로 주지 않고 기존 `STORY_CHAPTER_MAX_*` 클램프 범위 내의 seed를 사용한다.

- [ ] 두 번째 히로인만 경계 넘음 / 여섯 히로인의 서로 다른 현재 레벨 / 선택된 파트너는 다른 캐릭터 / 없는 affinity 행의 level1 초기화 / max level 이후 추가 XP.
- [ ] story-only, 일반 XP→story, story→일반 XP, 완료 이벤트 재전송. 일반 지급을 이미 받은 아이템은 영수증·granted_at 유지. 반대로 v34 지급 후 일반 경로가 같은 보상을 지급하려 해도 기존 저장소 inventory 검사로 false 반환.
- [ ] daily의 실제 입력 DTO로 인연 4→5를 넘기고 `story-daily-drills` 감사 연결을 확인. daily는 도장 XP를 주지 않으므로 도장 레벨/XP가 불변임을 단언한다. first clear·S 개선·exam·재시도 런은 기존 story coordinator/reward 서비스 테스트와 함께 실행하여 XP 횟수/별도 칩·의상 지급량이 변하지 않는지 확인.
- [ ] `vi.spyOn(repository,'grantLevelRewardsInTransaction')`을 래핑해 원본 INSERT 후 throw한다. 호출 전후 `progression_profiles`, 모든 `character_affinity`, `progression_events`, 신규 receipt, `inventory_items`의 행을 비교해 전부 원상복구되는지 확인한다. `vi.restoreAllMocks()`를 afterEach에 추가한다.
- [ ] 전체 소급 중 두 번째 프로필에 같은 실패를 주입한다. 첫 프로필 receipt는 유지, 두 번째는 0개, 실패 제거 후 재실행 시 각 아이템 quantity1·receipt1개, 세 번째 재실행 지급 0건. PK 100명 페이지 경계의 101/102번째 프로필도 포함한다.
- [ ] DB 직접 SQL 공격: 낮은 현재 레벨·다른 캐릭터·다른 프로필 이벤트·다른 시각·잘못된 balance·observed XP 불일치·임의 이벤트 종류·존재하지 않는 이벤트·조각/아레나/스토리전용 item·수정/삭제/REPLACE 모두 거절. catalog의 실제 required_level 이상인 현재 정본만 허용.
- [ ] v33 DB fixture 생성은 `migrations.filter(m=>m.version<=33)`을 순서대로 적용하고 해당 schema_migrations 행을 기록하는 기존 database.test.ts fixture 패턴을 재사용한다. 여러 히로인 높은 레벨과 첫 히로인만 담긴 old summary를 넣고 close→`openPokerDatabase`→서비스 소급→close→재오픈한다. old summary 문자열·XP·counter·v13 receipt·v32 story_rewards·chip ledger를 전후 비교한다.
- [ ] 기존 컬렉션에서 인벤토리가 표시되고 일반 title/frame/cutin/skin 장착이 동작하는 기존 장착 테스트를 재사용한다. 선택하지 않은 히로인 skin 장착 제한도 유지된다. 신규 보상 알림용 UI는 추가하지 않는다.

검증 명령(구현 전에는 실행하지 않음):

```powershell
npx vitest run src/server/progression-service.story.test.ts src/server/progression-service.level-rewards.test.ts src/server/progression-repository.test.ts src/server/persistence/database.test.ts --maxWorkers=4
npx vitest run src/server/progression-service.test.ts src/server/progression-runtime.test.ts src/server/progression-http.test.ts src/lib/progression/reward-summary.test.ts --maxWorkers=4
npx tsc --noEmit
npm run lint
```

기존 story reward/coordinator 테스트 파일은 `rg --files src/server | rg 'story.*test'`로 확인해 해당 파일만 추가 실행한다. 통합 총괄이 전체 Vitest `--maxWorkers=4`를 배치당 1회 실행한다. 배포 전 build는 총괄 통합 단계에서 실행한다. npm 설치, push/deploy는 이 계획의 실행 범위가 아니다.

## 7. 완료 판정과 Fable 검토 초점

- [ ] 신규/기존 프로필은 같은 현재 정본 레벨에서 같은 35개 일반 보상 자격을 가진다. 두 번째 이후 히로인도 빠짐없다.
- [ ] 라이브 지급과 소급은 동일 자격 SQL과 영수증 생성 함수를 사용한다. 요약 재생/새로 고친 과거 JSON/선택된 히로인 필터로 소급하지 않는다.
- [ ] v13 뷰와 기존 가드의 SQL 동일성·기존 부정 지급 테스트가 보존되고 v32/v33 전용 보상/경제값은 불변이다.
- [ ] 모든 신규 receipt는 현재 정본과 대조 검증한 정규화 레벨/XP 증빙을 보존하며 원본 이벤트 갱신 없이 인벤토리에 연결된다.
- [ ] startup 한 번 완료 후 snapshot이 바로 보유를 노출한다. 프로필별 실패/재시작/중복 실행은 중복 지급이나 영구 누락을 만들지 않는다.
- [ ] Fable은 별도 receipt 경로가 v13을 우회하는 임의 지급 통로가 되지 않는지, 직접 SQL의 다른 프로필·캐릭터·미도달 레벨 공격을 우선 반증한다. 감사 event는 자격 증빙 자체가 아니라 추가 연결이라는 설계 판단을 명시적으로 검토한다.

## 8. 구현·검증 기록 (2026-09-05)

설계 단계 후 총괄이 Fable 5.1 xhigh의 세 지적을 수용하고 구현을 승인했다. 아래 실행 기록이 현재 완료 범위다.

- [x] v34 현재 레벨 자격 뷰/불변 영수증 및 인벤토리·원본 이벤트 가드 구현. v1~33 SQL 불변.
- [x] 스토리 XP 갱신과 모든 히로인 아이템 지급을 한 트랜잭션에 연결. 신규 receipt 집합과 summary 중복 검증 연결.
- [x] arena 복구 직후·dev native backup 미지원 return 이전에 전체 프로필 소급 연결.
- [x] 프로필별 중단/재실행 및 102명 keyset 페이지 경계, v33 파일 업그레이드/재오픈 검증.
- [x] 기존 inventory 보유·일반 XP/스토리 혼합·다중 레벨 점프·6명 서로 다른 레벨·인연 경계 5/10/15/20·데일리·원본 summary 불변 검증.
- [x] 신규 receipt, 인벤토리, 원본 이벤트 직접 SQL 부정 지급/변조 검증. 관련 총 12파일 387테스트 통과.
- [x] `npx tsc --noEmit` 통과. `npm run lint` 0 errors, 기존 `engine.ts:1316` `_personalityId` 미사용 경고 1건. 최종 변경 8개 TS 파일 대상 eslint 추가 실행은 0 errors/0 warnings.

실패를 먼저 확인한 주요 재현: 기존 코드는 1 milli로 도장 2/두 번째 히로인 인연 5를 넘겨도 보상이 `[]`였고, 소급 API가 없었다. 구현 중 `recursive_triggers=OFF`에서 source event `INSERT OR REPLACE`가 UPDATE 가드를 우회하는 것을 추가 재현해 총괄 수용 후 v34 전용 BEFORE INSERT 가드로 차단했다. 감사 이벤트의 `grantedItemIds`가 배열 대신 문자열인 직접 SQL도 거절 테스트에서 재현 후 JSON object/text/array 타입 조건을 추가했다. 정상 재전송은 저장소가 기존 이벤트를 먼저 반환하므로 새 INSERT 가드와 충돌하지 않는다.

워크트리 자체 `npm ci` 실행(공유 node_modules 없음). 현재 Node 22.14.0은 package 요구 `>=22.16.0 <23`보다 낮아 설치 시 engine 경고가 있었지만 위 검사들은 모두 실제 실행되었다. 전체 suite/build·실서비스 기동·브라우저 수동 확인은 총괄 통합 단계에 남긴다. push/deploy는 실행하지 않는다.

최종 관련 테스트 명령:

```powershell
npx vitest run src/server/progression-service.level-rewards.test.ts src/server/progression-service.story.test.ts src/server/progression-service.test.ts src/server/progression-repository.test.ts src/server/persistence/database.test.ts src/server/arena-legacy-season-upgrade.test.ts src/server/progression-runtime.test.ts src/server/progression-http.test.ts src/lib/progression/reward-summary.test.ts src/server/story-reward-service.test.ts src/server/story-run-coordinator.test.ts src/server/story-reward-repository.test.ts --maxWorkers=4
```
