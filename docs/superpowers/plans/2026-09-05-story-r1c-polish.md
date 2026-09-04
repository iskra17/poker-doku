# Story R1c Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans. 총괄이 승인한 R1 실구현 리뷰·실제 모바일 QA 6건만 수정한다. 작업자 Astra Medium, 기준 `25738a9`, 브랜치 `fix/story-r1c-polish`.

**Goal:** 보상 정본 조회와 실패 결산 안내를 정확하게 맞추고, 관련 없는 데이터 문제로 소급이 실패하지 않게 한다.

**Architecture:** 서버 보상 금액·지급·마이그레이션은 유지한다. 소급은 최소 프로필 존재 조회만 하고, 실패 결과는 readonly preview의 실제 보유 집합으로 다음 보상을 계산한다. 클라이언트는 확정된 칩 보상 결과를 받을 때 서버 프로필을 재조회하며 진행 중인 이전 조회가 있으면 직후 한 번 재조회한다.

**Tech Stack:** TypeScript, SQLite, Zustand, React, Vitest.

## 변경과 검증

- [x] `progression-service.ts`의 `reconcileLevelRewards`: `getSnapshotInTransaction` 대신 `progression_profiles` 존재만 확인하는 저장소 메서드 사용. 없는 프로필 domain error 유지. `progression-service.level-rewards.test.ts`에 streak_state 없는 프로필/후보 0·실제 후보/없는 프로필 회귀.
- [x] `StoryStage.tsx`: failure-scene 헤더의 포기 버튼 숨김. 서버 abandon 명시 폐기 계약 유지.
- [x] `src/lib/store/story-wallet-refresh.ts` 신규: StoryStore 구독으로 ended+passed+chips>0을 profile/run별 한 번만 처리. 실패·포기·중복 스냅샷·동일 런 재수신은 조회하지 않는다. 프로필 식별이 다르면 무시한다. page.tsx effect에서 연결·해제한다.
- [x] `profile-store.ts` refresh에 선택적 `afterCurrent` 추가. 기본 호출의 기존 in-flight 합치기는 유지하고 보상 후 요청만 기존 조회 완료 뒤 trailing refresh를 1회 예약한다. 프로필이 바뀌면 예약한 조회를 취소한다. profile-store 테스트는 지연 응답으로 오래된 10000 응답 이후 10800 최신값과 동시 호출 중복 보호를 검증한다.
- [x] `Coachmarks.tsx`에 칩 안내 props 전달. `GameRoomView`가 story/practice/wallet-cash/tournament 문구를 실제 모드로 선택한다. wallet 캐시 기존 문구는 유지한다. 문구만 검사하는 테스트는 만들지 않는다.
- [x] Ch3/Ch6 `net-chips(minBB:0)` 보너스 라벨은 '시작 스택 이상으로 끝내기'. Ch6 failScene은 특정 3벳 실수를 단정하지 않는 아라 말투로 수정한다.
- [x] `story-run-coordinator.ts` 실패 computeResult: items=[]·chips=0·cutscene=null·unlockedScenes=[]를 명시하고 `rewards.preview` 보유 집합을 이용해 `nextStoryRewards`의 미획득 next만 반환. reconcile·완료 지급은 실행하지 않는다. 기존 보유/미보유 실패를 테스트한다.
- [x] 작은 P3: `sweepExpired`는 이번 호출에서 종료 뷰를 emit한 프로필 집합을 반환하고 `resend`는 그 프로필이면 true 반환한다. 후속 resend는 false로 유지한다. 만료 시 중복 emit 및 room-lost 중첩 회귀를 작성한다.

## 실행 순서

1. 자체 `npm ci` 후 최소 실패 회귀부터 실행한다.
2. 소급 최소 조회 및 서버 실패 결과/만료 재전송 수정.
3. wallet 구독/후행 조회 helper와 의미 있는 스토어 테스트.
4. 승인된 UI·문구만 수정.
5. 관련 Vitest `--maxWorkers=2`, `npx tsc --noEmit`, 변경 TS 파일 eslint, `git diff --check` 후 커밋한다.

마이그레이션/전체 suite/build/main 병합/push/deploy는 수행하지 않는다. 전체 제품 흐름 검증은 총괄 통합 단계에서 한 번 수행한다.

## 완료 기록

- 최초 회귀로 streak_state 없는 프로필의 불필요 소급 실패, 실패 결과의 next 미정의, 만료 resend false, 보상 전 refresh 응답만 재사용하는 문제를 확인한 뒤 수정했다.
- `refresh({afterCurrent:true})`는 동일 in-flight 요청 뒤 예약을 한 번만 만들며, 예약 시 requestVersion/프로필 ID가 바뀌거나 세션이 anonymous가 되면 후행 조회를 취소한다. 일반 refresh의 동시 호출 합치기는 유지한다.
- 지갑 10000의 지연 응답 이후 새 조회 10800 확인, 챕터 800칩·데일리 100칩 결산 구독, 중복/실패/포기/계정 전환 회귀를 포함했다.
- Ch6 first/S CG만 이미 보유한 실패에서 두 CG는 제외하고 다른 미획득 next를 유지한다. 실패 처리 중 reconcile 및 completeChapter 호출 수는 증가하지 않는다.
- 관련 16개 Vitest 파일 **312개 통과** (`--maxWorkers=2`). 마지막 Ch6 부분 보유 fixture 보강 후 coordinator **35개 재확인 통과**. `npx tsc --noEmit`, 변경 15개 TS/TSX 파일 eslint, `git diff --check` 모두 통과했다.
- 자체 `npm ci` 완료. Node 22.14.0에서 package의 >=22.16 engine 경고는 있었고, 실제 검사 실행에는 문제가 없었다.
- 마이그레이션 변경 없음. 실제 UI 재점검과 전체 suite/build는 총괄에게 인계한다. main 수정/병합/push/deploy는 실행하지 않았다.

관련 테스트 명령:

```powershell
npx vitest run src/server/progression-service.level-rewards.test.ts src/server/progression-service.story.test.ts src/server/progression-service.test.ts src/server/progression-repository.test.ts src/server/story-run-coordinator.test.ts src/server/story-live-adapter.test.ts src/server/story-reward-service.test.ts src/server/story-http.test.ts src/server/socket-handler.story.test.ts src/lib/store/profile-store.test.ts src/lib/store/story-store.test.ts src/lib/store/story-wallet-refresh.test.ts src/lib/story/reward-view.test.ts src/lib/story/chapters/act1/act1.test.ts src/lib/story/chapters/act2/act2.test.ts src/lib/story/chapters/chapters.test.ts --maxWorkers=2
```
