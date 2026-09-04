# R1b 실패 씬과 스파링 재도전 계약

승인된 개발 로드맵의 R1b-1/2를 구현하기 위한 설계. 기준 `92e508b`; 보상 마이그레이션 R1a와 파일 소유권을 분리한다.

## 사용자 흐름

1. full 챕터의 스파링이 미통과하면 성공 에필로그를 재생하지 않는다.
2. `failScene`이 있는 챕터는 서버 phase `failure-scene`에서 실패 씬을 재생한다. 건너뛰기도 같은 완료 명령을 사용한다. 씬이 없으면 미통과 결산으로 이동한다.
3. 실패 결산은 보상 0, 이전 완료/성적/획득 보상 보존. [스파링만 재도전], [처음부터], [허브로]를 구분한다.
4. 스파링만 재도전하면 앞서 완료한 씬·레슨·드릴·연습은 유지하고 실패한 스파링부터 새 방·새 스택·새 집계로 시작한다. 이후 남은 스텝은 정상 실행한다.
5. 재도전 자격이 사라졌으면 이유와 전체 재시작 방법을 안내한다. 사용자가 갑자기 잠긴 UI에서 멈추지 않는다.

## 실패 판정과 서버 소유권

- 라이브 어댑터의 `onStepFinished`에서 현재 스텝이 sparring이고 `primaryObjectivesMet === false` 또는 확정 실패 outcome일 때 실패 경로로 전환한다. 실패한 앞 스파링을 둔 채 뒤 스파링/성공 씬으로 진행하지 않는다.
- 일반 행동 목표의 기회 없음(null)은 기존 계약을 유지한다. exam 실패는 라이브 실패 씬/재도전 자격을 만들지 않고 기존 결산을 사용한다.
- 실패 결과 산출과 종료 처리를 분리한다. 실패 결과를 한 번 산출한 뒤 failure-scene→ended는 그 고정 결과만 사용한다. 씬 완료가 grade/reward/completion을 재계산하거나 성공 보상을 지급하지 않는다.
- `stepIndex`는 실패한 실제 스파링 인덱스를 유지한다. `phase`가 우선 분기되어야 하므로 `advance`/운영자 skip은 failure-scene을 처리한 뒤 기존 step.kind 분기로 넘어간다. 클라는 `chapter.failScene`을 사용하며 임의의 성공 씬을 고르지 않는다.
- 실패 씬 명령은 기존 `story-advance`의 runId/expectedStepIndex/target:'next'를 사용한다. 같은 명령 재전송은 이미 ended이면 추가 상태 변경·보상 없이 stale/no-run으로 거절한다.
- scene choice를 허용하지 않는 실패 씬 계약을 검증한다. 실패 씬에서 `story-choice`를 보내면 성공 에필로그 플래그를 바꾸지 못하게 거절한다.
- 실패 씬은 런에 남겨 재접속 시 같은 phase를 다시 보내되, 진행 중인 대사 줄 커서는 기존 ScenePlayer와 같이 클라이언트 상태다. 재접속 시 실패 씬 처음부터 재생할 수 있다.
- `refreshLive`와 `buildView`는 phase가 `live-play`/`live-hold`일 때만 어댑터를 조회한다. 실패 씬에서 늦은 live 갱신이 와도 phase를 덮어쓰지 않는다. ScenePlayer key는 runId와 failure phase를 포함한다.
- 실패한 요약은 미통과 결산의 목표·통계에는 반드시 포함한다. 재도전 checkpoint의 성공 `liveResults`에는 포함하지 않는다. 실패 결과 생성과 재도전용 복사본을 혼동하지 않는다.

## 재도전 정보

서버의 프로필별 저장소에 마지막 실패 정보 1개만 보관한다. 내용은 sourceRunId, chapterId, partnerId, sourceStepIndex, 복사한 drillSummary/choices/flagsDelta, 실패 지점 이전의 성공 liveResults, createdAt/expiresAt, consumedByRunId다. 인메모리이며 10분 후 만료한다. 정보는 클라이언트가 지정하거나 수정할 수 없다.

- result DTO는 자격을 알리는 `sparringRetry: { expiresAt } | null`만 가진다. 실패 runId는 이미 공개된 런 식별자를 사용한다. 내부 점수/진행 복사본은 보내지 않는다.
- 신규 소켓 `retry-story-sparring` 요청은 `{ failedRunId }`만 받는다. profileId는 인증 세션에서 취하며 기존 소켓 소유권·storyStart 제한·다른 실전 테이블 진입 가드를 적용한다.
- `retrySparring(profileId, failedRunId)`는 동일 프로필의 최신 실패, TTL, 실패 당시 full 모드, 실제 실패 스파링, 완료 드릴 상태, 현재 다른 런 없음, liveAdapter 존재와 `hasSession(profileId) === false`를 검증한다. 동일 재도전의 멱등 재전송 검사는 이 신규 진입 가드보다 먼저다.
- 새 runId를 발급하고 드릴 성적/앞 단계만 복사한다. 실패 스파링 결과와 이후 결과는 포함하지 않는다. partner는 원래 런의 값을 유지한다. 정상 어댑터 진입(entered 또는 접수된 room-lost hold) 후 recordAttemptStart를 한 번 남긴다. 이후 기록 예외도 새 런/방을 정리하고 자격은 보존한다.
- `enter` 실패/예외 때 새 런과 방을 정리하고 실패 정보를 소비하지 않는다. room-lost hold로 접수된 정상 어댑터 진입은 새 런이 책임지고 재개한다.
- 진입 성공 후 consumedByRunId를 기록한다. 같은 failedRunId 재전송 시 그 재도전 런이 아직 본인의 현재 런이면 현재 뷰+동일 runId를 반환한다. 스택 초기화나 추가 attempt를 하지 않는다. 다른 런으로 이동했거나 이미 끝났으면 거절한다.
- 재도전에서 다시 실패하면 최신 실패 정보로 교체한다. 성공·전체 재시작·새 데일리·프로필 폐기·명시 포기는 해당 보존 정보를 정리한다. [허브로]만 누른 경우 TTL 내 재접속 결과 복구를 지원할지와 UI 진입점은 아래 규칙을 따른다.
- 재접속에서 active 런이 없고 유효한 실패 결과가 남아 있으면 terminal 결과 뷰를 재전송할 수 있다. terminal은 `runs`가 아닌 별도 보존 맵에만 둔다. `getProgress.activeRun`/`getActiveRun`/다른 방 진입 가드는 ended 정보를 활성 런으로 세지 않는다. `resend`와 실제 socket resync 경로를 함께 검사한다. 허브에 새 재도전 배너를 추가하지 않는다.
- [허브로]는 기존 `abandon-story`를 통해 해당 failedRunId의 terminal 정보도 정리하고 로컬 결과를 닫는다. 수동으로 닫은 결과가 이후 socket 재접속 때 다시 열리지 않게 한다. 서버 abandon은 소유 runId가 일치하는 terminal만 삭제하고 새 활성 런에는 손대지 않는다.
- TTL 만료 시 재도전 정보만 회수한다. 만료된 결산을 가진 클라 요청에는 자격 만료 오류를 보내고 [처음부터]를 유지한다. 서버 재시작도 같은 이용 불가 경로다.
- 기존 socket-handler 유휴 스윕에 코디네이터 만료 정리를 연결하고 종료 시 전부 해제한다. 만료 실패 씬도 방 없는 종료 뷰를 보내 회수한다. 실패 단계에만 TTL을 적용하며 기존 일반 씬·드릴 런 전체의 수명 정책은 바꾸지 않는다.

## 파일 소유권

- 서버: `src/server/story-run-coordinator.ts`, 필요한 작은 `story-retry.ts` 순수 복사/자격 헬퍼, `src/server/story-payload.ts`, `src/server/socket-handler.ts`.
- 공유: `src/lib/story/views.ts`, `src/lib/realtime/protocol.ts`.
- 클라: `src/lib/store/story-store.ts`, `src/components/story/StoryStage.tsx`, `src/components/story/ChapterResult.tsx`.
- 테스트: 기존 coordinator/payload/store 테스트와 socket integration의 관련 사례. 새 헬퍼를 만들면 직접 동작 테스트를 추가한다.
- `progression-*`, DB 마이그레이션은 R1a 소유다. 이 배치는 새 DB 테이블 없이 재도전 10분 수명을 구현한다.

## 검증 사례

| 사례 | 기대 결과 |
|---|---|
| Ch3/Ch6 실패 | 성공 에필로그 미재생, failure-scene→미통과 결산 |
| 실패 씬 없음/시험 실패 | 기존 결산, 시험에는 스파링 재도전 자격 없음 |
| 실패 씬 중 재접속·next 두 번·choice 위조 | 같은 실패 씬 복구, 중복 부작용 없음, 플래그 변경 불가 |
| 이전 성공 프로필의 실패 | 완료·best grade·획득 보상 유지, 실패 보상 0 |
| 스파링 재도전 | 드릴 성적 유지, 새로운 방/스택/집계, 앞 단계 반복 없음 |
| 두 번째 스파링 실패 후 재도전 | 앞 성공 스파링만 보존, 실패/뒤 요약 제외 |
| 재도전 연타/ack 유실 | runId 하나, attempt 하나, 스택 리셋 한 번 |
| 다른 프로필·오래된 failedRunId·임의 점수/step | 거절, 게임/보상 상태 불변 |
| 유효시간 만료/서버 재시작 | 명확한 안내, 전체 재시작 가능 |
| 어댑터 착석 예외/room-lost | 예외는 자격 미소비, 정상 hold는 같은 새 런으로 복구 |
| 재도전 성공·반복 성공 | 첫 완주/재도전 보상 기존 멱등 규칙 유지 |
| 브라우저 모바일/데스크톱 | 실패 ScenePlayer, 세 CTA, pending/오프라인/만료 안내 확인 |

## 구현 순서

1. 실패 씬 분기 회귀를 먼저 실패시키고 결과 산출/종료 분리와 failure-scene을 구현한다.
2. 자격/만료/복사/멱등 재도전 회귀를 먼저 실패시키고 서버 메서드를 구현한다.
3. payload·소켓 소유권/arity/rate 가드와 클라 ACK 상태를 연결한다.
4. 실제 실패 씬·재도전 CTA를 브라우저와 소켓으로 검증한다.
5. Fable의 상태 전환·경합 검토를 반영한 뒤 커밋·통합한다.

## Fable 사전 검토와 총괄 판정

2026-09-05 실제 `claude-fable-5-1`, 요청 effort xhigh, 읽기 전용 검토 완료. 원본은 main `qa-tmp/expansion-reviews/r1-design.ndjson`의 result 이벤트다. 테스트 실행 결과로 취급하지 않는다.

- 수용: advance/skip/choose의 phase 우선 분기뿐 아니라 refreshLive/buildView와 ScenePlayer key도 명시했다.
- 수용: 기존 어댑터 세션이 남은 프로필의 신규 retry를 막는다. 실제 `enter`는 roomId가 있으면 runId와 무관하게 entered를 반환하므로 coordinator의 명시적 세션 없음 가드가 필요하다. room-lost 세션의 집계 상속 자체는 실제 코드상 같은 runId/stepIndex에만 일어난다.
- 수용: 정상 room-lost 접수와 예외를 구분하고 attempt 기록 순서를 고정했다.
- 수용: ended 보존 맵은 활성 런과 분리하고 실제 resync 호출부까지 검증한다. 결과를 수동으로 닫으면 보존 정보도 정리한다.
- 부분 수용: Fable은 실패 summary를 liveResults에 넣지 말라고 제안했다. 재도전 checkpoint에서는 제외하지만 미통과 결산에는 실패 목표와 통계가 필요하다. 결과 산출에 포함한 뒤 checkpoint에는 앞선 성공 요약만 복사하는 계약으로 고정했다.

총괄 판정: 위 수정 반영 조건으로 R1b 구현 진행. 새 보상량/DB 경로를 추가하지 않는다.
