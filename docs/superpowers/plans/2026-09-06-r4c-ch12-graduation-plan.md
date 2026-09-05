# R4c Ch12 졸업 SnG 구현 계획 — Fable 총괄 확정

> 2026-09-06. 총괄 Claude Fable 5.1(max). 구현 Claude Opus(`claude-opus-5`), 워크트리 `.worktrees/story-r4c-graduation`(브랜치 `feat/story-r4c-graduation`,
> 기준: R4b 병합 뒤 main). 근거: [3·4막 확정 설계](../specs/2026-09-05-act3-act4-design.md) 「R4: Ch12 졸업 SnG」와 「총괄 확정 계약 R4 2~8」. Astra 검토 대상:
> 순위 확정/정산·재접속·중복 지급·졸업 대결만 재도전 경계(이 문서의 2·4·5항).

**목표:** 실제 엔진 `gameMode:'sng'` 6인 연습경제 SnG(1,000칩·2분)로 Ch12를 완료하고, 순위 receipt·검은띠 자격·졸업 대결만 재도전을 영속 계약으로 고정한다.
**제외:** 일반 SnG(1,500/3분) 동작 변경, MTT, 하드 모드, 새 아트(검은띠 카드백/펠트는 SVG/CSS).

## 0. 순서와 중간 커밋

(1) SnG 구조 레지스트리 + RoomManager 가드 → (2) 어댑터 토너먼트 정책 → (3) 영속 v38 + 완료 트랜잭션 → (4) 코디네이터 graduation 모드 → (5) Ch12 데이터·카탈로그 →
(6) 클라. 단계마다 커밋. 공유 파일(types/views/protocol/payload)은 (2)~(4)에서 한 번에 확정.

## 1. SnG 구조 레지스트리 (서버 전용) — 새 `src/server/sng-structures.ts`

`type SngStructureId = 'standard' | 'graduation'`, `resolveSngStructure(id = 'standard') → { id, startingStack, levelMs, levels: BlindLevel[] }`.
standard = 1,500 / `SNG_LEVEL_DURATION_MS` / `SNG_BLIND_SCHEDULE`; graduation = 1,000 / `Number(process.env.SNG_LEVEL_MS) || 2×60_000` / `SNG_BLIND_SCHEDULE`.
`levelIndexAtWith(startedAt, now, levelMs, levelCount)` 순수 함수(blind-schedule.ts, 기존 `levelIndexAt`은 standard 위임).
`RoomConfig.sngStructureId?: SngStructureId`는 **서버 전용**: `parseCreateRoomRequest`는 통과시키지 않고(테스트: 입력에 넣어도 value에 없음), `createRoom`은 storyChapterId 없는
방에서 'standard' 외 값을 throw. RoomManager 방 레코드에 `sngStructure`를 두고 시작 공지(`N분마다 인상`)·`startTournament(startedAt + levelMs)`·`applyBlindLevel`
(구조 levelMs/levels)·봇 스택(`fillEmptySeats(…, startingStack)`)이 같은 구조를 쓴다. 일반 SnG는 'standard'로 동작 불변(기존 SnG 테스트 통과가 증거).

## 2. 스토리 토너먼트 정책 — `LiveTableSpec.tournament?: { id: 'graduation-sng-v1'; sngStructureId: 'graduation' }`

검증기: sparring에서만, lineup 5석 전원 BOT_CHARACTERS(파트너/fill 토큰 불가), masquerade/reading 없음, `objectives.primary`·`bonus` 비움(순위가 통과 조건 — 검증기가
tournament 정책일 때만 primary 0 허용), maxHands ≥ 200(폭주 가드), turnTimeSec 30, botThinkScale 0.5, 히어로/라인업 stackBB는 무시되며 검증기는 0 초과만 본다.
어댑터:
- `openRoom`: `gameMode:'sng'`, `startingStack: 1000`, `sngStructureId:'graduation'`, 블라인드 = 구조 첫 레벨, min/maxBuyIn 1,000, 봇·히어로 전원 1,000칩. 첫 핸드 이후에는
  room-lost 재개로 새 방을 열지 않는다(아래).
- `beforeHand`: tournament 정책이면 timeout/disconnect hold·파산 실패·table-short를 적용하지 않고 `'deal'`(RoomManager SnG의 부재 딜인·자동 폴드가 진행). `finishTimer`면 'hold'.
- `onHandComplete`: 집계(handsPlayed·tally·review)는 기존대로. 종료 = `hero.finishPlace` 확정(탈락) 또는 `state.tournament.finished`(히어로 1위) →
  `finish(session,'done','tournament')`, `summary.tournament = { place, entrants }`(엔진 finishPlace/entrants만 — chips로 재추정 금지). `handsPlayed ≥ maxHands` →
  `finish('failed','max-hands')` 순위 없음(운영 오류 종료). 히어로 탈락 즉시 종료(봇 우승 대기 없음). 서버 `disposeRoom('story-end')`가 미완 SnG도 정리한다.
- `LiveStepSummary.tournament?: { place: number; entrants: number }`, `LiveFinishReason` += `'tournament'`. `skipHandProgression`: tournament 정책 true.
- `onRoomDisposed`(reason ≠ story-end): `handsPlayed === 0`이면 기존 room-lost 보존·재개 허용, `handsPlayed > 0`이면 순위 없는 종료 —
  `onStepFinished(outcome:'abandoned')`(방 재생성·스택 초기화 없음).
- `forceFinish`(운영자 스킵): tournament 정책은 `summary.tournament = { place: 1, entrants }`, 영수증 mode `'operator-skip'`으로 저장(자격 부여는 실제와 동일 — 운영자 계정 DB에
  남는다는 점을 문서화). 비운영자는 기존대로 거절.
RoomManager: `completeProgressionTournament`는 `isStoryRoom`이면 return(일반 SnG XP·스트릭·미션 차단) · `fillWithBots`는 스토리 방 거절 · `toggleSitOut`은 스토리 SnG 방에서
**복귀(sittingOut → waiting)만** 허용(자리비움 시작은 계속 거절) · `handleGraceExpired`는 SnG keep 유지(테스트로 고정) · `sweepIdleRooms`는 봇이 계속 플레이하므로 해당
없음(테스트: 부재 히어로 20핸드 자동 폴드 진행 동안 방 유지) · abandon-story = 방 해체 + 런 취소(보상·영수증 없음).

## 3. 영속 — v38 `story_graduations` + 카탈로그

```sql
CREATE TABLE story_graduations (
  profile_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  place INTEGER NOT NULL CHECK (place BETWEEN 1 AND 6),
  entrants INTEGER NOT NULL CHECK (entrants BETWEEN 2 AND 6 AND place <= entrants),
  mode TEXT NOT NULL CHECK (mode IN ('full','graduation','operator-skip')),
  fingerprint TEXT NOT NULL, finished_at INTEGER NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (profile_id, run_id)
) STRICT;  -- + UPDATE/DELETE 금지 트리거, INDEX (profile_id, finished_at)
```
`StoryRepository.recordGraduationInTransaction(profileId, { runId, place, entrants, mode, finishedAt })`: fingerprint = sha256(`profileId|runId|place|entrants|mode|finishedAt`).
같은 (profile, run) 행이 있고 fingerprint가 같으면 `'duplicate'`, 다르면 throw `STORY_GRADUATION_CONFLICT`; 신규면 INSERT + 플래그 단조 갱신(`setFlagsInTransaction`):
place ≤ 3 → `belt:black`='1', place = 1 → `graduation:champion`='1'(기존 '1'은 내리지 않는다). 반환 `{ status, itm, champion }`. `listGraduations(profileId)`(허브·결산 표시용).
카탈로그 트리거 `{ kind: 'graduation'; requirement: 'black-belt' | 'champion' }`: black-belt = `deriveBelt(chapters, completed, flags, curriculum) === 'black'`(**플래그만으로 지급
금지** — 4막 전체 완료 ∧ ITM 플래그), champion = black-belt ∧ `flags['graduation:champion'] === '1'`. `storyRewardSourceKey` `story-graduation:<requirement>`, `storyRewardRequirement`
문구. v38 INSERT: `story-title-graduate`(first act4-ch12) · `story-chips-act4-ch12-first` 500 · `story-chips-act4-ch12-s` 300 · `story-cardback-black-belt`(graduation black-belt) ·
`story-felt-black-belt`(graduation black-belt) · `story-chips-act4-complete` 1,000(act 4) · `story-title-master-deputy` 사범대리(graduation champion). 검은띠 카드백/펠트는
`Card.tsx`·`CardBackPreview.tsx`·`PokerTable.tsx`(`--color-story-felt-black-*`, 런타임 변수는 `:root`)에 갈색띠 패턴으로 등록. `database.test.ts` 37→38.

## 4. 완료 트랜잭션 (확정 계약 5·6)

- `StoryRewardPort.completeChapterAtomic?(input: completeChapter 입력 & { flags: Record<string,string>; graduation?: { runId; place; entrants; mode; finishedAt } })`.
  소켓 계층 구현: `database.transaction(() => { storyRepository.recordCompletionInTransaction(...); setFlagsInTransaction(flags); graduation && recordGraduationInTransaction(...);
  progression.recordStoryChapterCompleteInTransaction(...) })`. progression-service에 `recordStoryChapterCompleteInTransaction`(활성 tx 단언, `recordStoryReward` 본문을
  tx 유무로 분기 — 기존 public 메서드 동작·이벤트 id 불변).
- 코디네이터 `computeResult`: 포트에 atomic이 있으면 **모든 챕터의 full 완료**에 사용(없으면 기존 2단계 — 코디네이터 fake 포트 테스트 호환). 트랜잭션 예외 시 `run.result`를 만들지
  않고 throw → advance ack `server-error`, 런은 'result' phase 유지(재시도 = 같은 advance). 테스트: 첫 호출 throw → 두 번째 성공 → 완료 1회·영수증 1행·XP 이벤트 1건.
- graduation 모드 결산: `recordCompletion` 없음·XP/인연/칩 0·`completeChapter` 미호출 — 포트 `recordGraduationOnly(profileId, receipt)`가 영수증+플래그만 `database.transaction`.
  같은 run 재전달은 멱등(duplicate), 같은 run 다른 순위는 오류(결산 미확정 + 로그). 클라이언트 제출값은 순위에 쓰지 않는다(요약은 어댑터→코디네이터 내부 경로만).
- 카탈로그 지급은 확정 receipt/플래그에서 기존 `reconcile`이 멱등 처리(결산·허브 조회 자기 치유).

## 5. 코디네이터 graduation 모드

- `StoryRunMode` += `'graduation'`(views.ts, `story-payload.ts RUN_MODES`). `Chapter.examDisabled?: true`, `Chapter.graduation?: true`(Ch12만, 검증기: graduation 챕터는
  tournament sparring 정확히 1개 + examDisabled).
- `start(profileId, chapterId, 'graduation')`: `chapter.graduation` ∧ durable 완료(completions > 0) 필수(아니면 'story-locked'), 활성 런/어댑터 세션이 있으면 'story-busy'.
  운영자 우회 없음. `start(..., 'exam')`은 `examDisabled`면 'action-rejected'(허브도 버튼 숨김).
- enterStep(graduation): tournament sparring · `graduation: 'epilogue'` 마커가 있는 씬 스텝 · result만 진입(exam 모드처럼 인덱스 유지 스킵). drill DTO는 null, 드릴 요약 빈 값.
- 씬 플래그 분기: enterStep이 `scene.requiresFlags`를 **서버에서** 평가해 불일치 씬 스텝을 건너뛴다. 평가 플래그 = 저장 플래그 ∪ `run.flagsDelta` ∪ 런타임 플래그
  `{ partner: run.partnerId ?? 'miyako', 'graduation:outcome': 'champion'|'itm'|'out' }`(`run.runtimeFlags` — 영속하지 않는다). 기존 챕터는 requiresFlags를 쓰지 않으므로 동작
  불변(테스트로 고정). 클라 `sceneMatchesFlags`는 그대로 둔다.
- `completeLiveStep`: `summary.tournament` → `run.graduation = { place, entrants }` + 런타임 플래그 세팅; outcome 'abandoned'/'failed'(순위 없음) → 실패 결산(failScene·
  sparringRetry 없음, 안내 "결과 없이 끝났어요 — 허브에서 다시 도전"). tournament 스텝은 checkpoint 대상이 아니다.
- `computeResult` Ch12: full → passed = 드릴 완료 ∧ 순위 확정; graduation → passed = 순위 확정. `result.graduation = { place, entrants, itm: place ≤ 3, champion: place === 1,
  blackBelt: deriveBelt(after) === 'black', mode }`. `run.beltAtStart`를 start 시점에 스냅샷해 `beltAwarded` 계산(영수증 선기록으로 승급 연출이 누락되지 않게).
  full 첫 완료 = 완료 기록 + first XP 500,000 + 인연 all 30,000 + 영수증(같은 트랜잭션); full 재주행 = replay XP + 영수증; graduation = 영수증만.
- `StoryLiveView.tournament?: { alive: number; entrants: number; heroPlace: number | null; level: number; smallBlind: number; bigBlind: number }`, `liveFinishHint` 문구
  "탈락하거나 우승하면 끝나요 · 자리를 비워도 블라인드는 계속 나가요".

## 6. Ch12 「졸업 시험」 — teacher `miyako`, order 3, belt `black`, requires `[...STORY_CURRICULUM[3]]`, `examDisabled: true`, `graduation: true`, estimatedMinutes 35

steps: intro 씬(미야코) → lesson(SnG 산술·M·존(`sng-thresholds.ts` 수치 인용)·ITM·푸시/폴드 가정(칩 EV, 명시 콜 레인지)·졸업 규칙: 실제 순위로 끝남, 부재 중에도 블라인드
진행, 재접속 같은 방·스택, 3위 이내 검은띠 자격·1위 사범대리) → drill-set 9(per-run): `sng-stack-bb`, `sng-m-ratio`, `sng-next-level-bb`, `sng-stack-zone`, `sng-itm-distance`,
`act-ch12-push-btn-8bb`, `act-ch12-fold-utg-8bb`, `'*review'`×2(reviewPool = Ch11과 같은 풀) — 설계 "SNG6+종합2"를 R4a 최종 등록(생성 5 + 수기 2, `sng-orbit-cost`는
삭제됨)에 맞춰 SnG 7 + 종합 2로 확정(총괄 2026-09-06) → practice '8BB 푸시'(팽팽; hero `As 7d`, blinds 100/200, heroStackBB 8, villain
stackBB 15, scripts 2개 — 프리셋 스택 보정은 `refillPracticeStacks`가 담당) → sparring(tournament: `{ id:'graduation-sng-v1', sngStructureId:'graduation' }`, lineup
`['paeng','luna','vivian','elena','ingrid']`, blinds 10/20, turnTimeSec 30, botThinkScale 0.5, maxHands 400, objectives primary [] bonus []) → 에필로그 씬 스텝 9개
(`graduation:'epilogue'` 마커): outcome 3종(`requiresFlags: {'graduation:outcome': 'out'|'itm'|'champion'}`, speaker 'partner' 3~4줄 + 미야코 1줄 — 아직 받지 않은 띠를
수여하는 문장 금지, 승급 알림은 결산 `beltAwarded`가 담당) + 파트너별 마무리 씬 6개(`requiresFlags: { partner: <id> }`, 각 2줄, 해당 히로인 문체) → result. `failScene` 없음.
rewards: first dojo 500,000 · affinity `[{ target:'all', milli: 30_000 }]` · badgeId `story-title-graduate`; replay 50,000(full 재주행); gradeBonus A 50,000 / S 120,000.

## 7. 클라

payload RUN_MODES 'graduation' · store `startChapter(id,'graduation')` · 허브 Ch12 카드: exam 버튼 숨김(examDisabled), 완료 시 [졸업 대결만 재도전] · StoryStage 헤더
'졸업 대결 · 실제 6인 Sit & Go' · ObjectiveHud tournament 정보(남은 인원·레벨·블라인드·종료 조건) · ChapterResult/RewardReveal 순위 카드(place/entrants, ITM/우승/검은띠
자격 문구) + graduation 모드 CTA [허브로]/[다시 졸업 대결] · GameRoomView는 실제 SnG 표시 그대로(변경 없음), 수련 리본 유지 · 검은띠 카드백/펠트 렌더·장착.

## 8. 검증 (설계 필수 검증 4·5·6)

- `room-manager.story-sng.test.ts`: graduation 구조 1,000/2분(SNG_LEVEL_MS 단축)·일반 SnG 1,500/3분 불변·봇 스택·레벨 인상 공지·`completeProgressionTournament` 미호출·
  `fillWithBots` 거절·`toggleSitOut` 복귀만·grace keep·payload가 sngStructureId를 버림.
- `story-live-adapter.tournament.test.ts`(fake timers, 실제 RoomManager): 6인 완주·히어로 각 순위(1·3·6)·동시 탈락 handStartChips·칩 합 6,000 보존·disconnect 중 진행·
  재접속 같은 방/스택·포기 정리·maxHands 폭주 종료·room-lost 첫 핸드 전/후·forceFinish 영수증 mode.
- 코디네이터: full 첫 완료(XP/인연 all/영수증/플래그 한 트랜잭션)·4~6위 통과+검은띠 없음·1~3위 자격+4막 미완 시 갈색 유지·4막 전체 완료 뒤 승급(beltAwarded)·graduation 반복
  0 XP·0 인연·완료 횟수 불변·영수증 충돌·TX 실패 복구·exam 거절·비완료자 graduation 거절·씬 플래그 분기(outcome×partner)·기존 챕터 requiresFlags 비사용 불변.
- database/reward: v38 패리티·black-belt/champion entitlement(플래그만으로 미지급).
- `socket-handler.story.test.ts`: 실제 Socket.io로 Ch12 시작→SnG 착석→탈락/우승 결산 DTO(graduation 필드)→허브 [졸업 대결만 재도전] 재진입.
- 기본 시간 봇 시뮬레이션(SNG_LEVEL_MS 기본)으로 실제 진행 시간 구간을 보고(25분 예산 실측 — 강제 종료 없음).
브라우저(총괄): Ch12 순위 결산/재접속/졸업 대결만 재도전.

## Astra 검토 반영 (2026-09-06, 총괄 확정 — 위 1~8항보다 우선)

검토 원문 [reviews/2026-09-06-r4c-graduation-astra.md](../reviews/2026-09-06-r4c-graduation-astra.md)(`gpt-6-astra`, high). 지적 1~3 수용, 4~6 수용 가능(문구 보정만).

1. **방 재생성 경계 = 첫 딜 시작 여부**: `handsPlayed`는 핸드 완료 뒤에만 증가하므로 기준으로 쓰지 않는다. tournament 세션에 `dealStarted`(beforeHand가 'deal'을 처음
   돌려준 시점에 true)를 두고 `onRoomDisposed`/`resume`/`openRoom`이 공통으로 검사한다: false면 기존 room-lost 보존·재개, true면 순위 없는 종료(`abandoned`).
   이탈 경로 함수명은 `processLeave`(엔진 이탈 = 즉시 순위 부여) — 어댑터 종료 판정은 `assignFinishPlaces → checkTournamentEnd` 뒤 호출되는 `onHandComplete`에서 본다.
2. **복귀 버튼·상태 보존**: RoomManager 스토리 SnG 분기는 기존 `sitOutNext || status === 'sitting-out'` 판정을 그대로 쓰고 진행 중 `active/all-in`을 `waiting`으로 바꾸지 않는다
   (기존 복귀 분기의 조건 유지). `ActionBar.tsx:107`이 스토리 방에서 복귀 버튼까지 숨기므로 **스토리 SnG의 부재 상태(sitOutNext/sitting-out)에만 [게임 복귀]를 노출**한다(§7 추가).
   유휴 스윕 제외 근거는 휴먼 좌석 잔존이며 테스트는 그 조건을 단언한다.
3. **에필로그 전 선저장 + 멱등**: `completeLiveStep`(tournament 요약)에서 `run.pendingGraduation = { place, entrants, mode: run.mode, source: summary.source, finishedAt }`을
   **한 번 고정**하고 즉시 포트 `recordGraduation(profileId, receipt)`(단독 트랜잭션: receipt INSERT + 단조 플래그)로 저장한다. 성공 → 런타임 플래그 세팅·에필로그 진입.
   실패 → `run.phase = 'live-hold'`, `run.persistPending = 'graduation'`, 코디네이터가 합성한 `live` 뷰(`roomId: null, hold: true, holdReason: 'persist'`, tournament 순위 포함,
   `StoryHoldReason` += `'persist'`, 클라 문구 "결과를 저장하는 중이에요 — [다시 시도]")를 보내고, `advance(target:'resume')`·`resend`가 같은 receipt로 재시도한다(10초 자동
   재시도 최대 6회 병행). 이후 에필로그에서 포기해도 **확정된 receipt·자격은 보존**(포기 = 완료 기록·XP·인연·칩 없음에만 적용).
   결산: full 모드는 `run.pendingCompletion = { firstClear, grade, dojoXpMilli, affinity, flags }`를 **첫 계산 때 고정**하고 원자 포트 `completeChapterAtomic`이 한 트랜잭션에서
   ① 고정된 progression 이벤트 id 중복 검사(중복이면 완료 기록·플래그 갱신 없이 `duplicate` 반환 — run 단위 멱등) ② `recordCompletionInTransaction` ③ `setFlagsInTransaction`
   ④ receipt 재검증(같은 run·같은 fingerprint = duplicate OK, 불일치 = 오류) ⑤ `recordStoryChapterCompleteInTransaction`(활성 tx 참여 전용 경로)을 수행한다.
   카탈로그 `reconcile`·인연 씬 계산은 **커밋 뒤** 별도 호출(실패해도 완료 기록은 유지되며 재시도는 duplicate 경로로 XP·완료 횟수를 다시 늘리지 않는다 — 테스트 필수).
   예외는 소켓 advance 핸들러(`socket-handler.ts:1710` catch 없음)와 타이머 콜백 모두 코디네이터 안에서 잡아 `persistPending = 'completion'` 상태로 보존하고 advance/resend
   재시도로 연결한다(서버 로그 `story-step persist-failed`). receipt 테이블 DELETE 트리거는 v32 `story_rewards`처럼 부모 프로필 삭제 CASCADE를 허용한다.
   스키마에 `source TEXT NOT NULL CHECK (source IN ('play','operator-skip'))`를 추가하고 `mode`는 실제 run 모드(`full`|`graduation`)만 — 운영자 스킵 출처는 어댑터
   `LiveStepSummary.tournament.source`로 전달(현재 reason은 로그 전용).
4. **graduation 진입 순서**: durable 완료 검사·어댑터 세션 검사를 운영자 우회보다 먼저. 토너먼트 실패는 checkpoint 제외(retrySparring/sweepExpired와 무관). graduation 런 중
   운영자 스킵도 `run.mode === 'graduation'` 분기라 보상 0.
5. 서버 requiresFlags 스킵: 변경 없음(기존 챕터 미사용, exam 스킵 선례, StoryStage는 원본 stepIndex 조회).
6. 구조 레지스트리: 변경 없음. 문구 보정 — `parseCreateRoomRequest`는 요청을 거절하지 않고 **필드를 제거**한다(허용 필드 재구성). `competitionMode` 정규화 재사용 금지.
