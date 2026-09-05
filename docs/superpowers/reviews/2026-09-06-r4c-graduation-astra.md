# R4c Ch12 졸업 SnG 계획 검토 — GPT 6 Astra

> 2026-09-06. 모델 `gpt-6-astra`(codex exec, model_reasoning_effort=high, 읽기 전용 sandbox). 대상: [R4c 계획](../plans/2026-09-06-r4c-ch12-graduation-plan.md)의 순위 확정·재접속·중복 지급·졸업 대결만 재도전 경계. 총괄(Fable 5.1) 판정: 1~3 수용(계획 「Astra 검토 반영」 절), 4~6 수용 가능(문구 보정).

**1. 순위 확정·방 종료 — 판정: 수정 필요**

- 순위 판정은 수용 가능합니다. [engine.ts:1257](/C:/code/claude/poker-doku/src/lib/poker/engine.ts:1257)의 `assignFinishPlaces → checkTournamentEnd`가 끝난 뒤 [RoomManager:3464](/C:/code/claude/poker-doku/src/server/room-manager.ts:3464)의 스토리 훅이 호출됩니다. 현재 이탈 함수명은 `removePlayer`가 아니라 `processLeave`이며, 이탈 즉시 순위를 부여합니다.
- 연습경제 SnG는 미완료 상태에서도 해체 가능합니다. 완료 시 선행하는 `finalizeFinishedTournament`도 계획의 progression 제외 가드가 있으면 문제없습니다. [disposeRoom:648](/C:/code/claude/poker-doku/src/server/room-manager.ts:648)은 종료 보존 타이머·턴·봇·시계를 모두 정리하므로 별도 정산 경쟁은 없습니다.
- **최소 수정:** `handsPlayed === 0`을 재생성 허용 조건으로 쓰면 안 됩니다. 이 값은 [핸드 완료 후에만 증가](/C:/code/claude/poker-doku/src/server/story-live-adapter.ts:674)하므로 첫 핸드 진행 중 방 소실도 새 스택으로 재개됩니다. 실제 첫 딜 시작 여부를 보존하고 `onRoomDisposed/resume/openRoom`에서 공통 검사하세요.

**2. 부재·재접속 — 판정: 수정 필요**

- SnG는 [다음 핸드 딜인](/C:/code/claude/poker-doku/src/server/room-manager.ts:2043)·[부재 자동 액션](/C:/code/claude/poker-doku/src/server/room-manager.ts:2840)·[grace 좌석 보존](/C:/code/claude/poker-doku/src/server/room-manager.ts:2628)이 유지됩니다. 유휴 스윕 제외 이유는 **봇 진행이 아니라 휴먼 좌석이 남기 때문**입니다.
- [resync 복원](/C:/code/claude/poker-doku/src/server/socket-handler.ts:1520)과 [본인 스토리 좌석 재입장](/C:/code/claude/poker-doku/src/server/socket-handler.ts:2256)은 허용됩니다. 리바이·파산 회수·착석 대기 경로도 이 SnG를 침범하지 않습니다.
- 복귀만 허용하는 서버 정책은 안전합니다. 단 [기존 판정](/C:/code/claude/poker-doku/src/server/room-manager.ts:2350)처럼 `sitOutNext || status === 'sitting-out'`을 사용하고, 진행 중 `active/all-in` 상태를 무조건 `waiting`으로 바꾸면 안 됩니다.
- **최소 수정:** [ActionBar:107](/C:/code/claude/poker-doku/src/components/table/ActionBar.tsx:107)이 스토리의 **복귀 버튼까지 숨깁니다**. 스토리 SnG의 부재 상태에만 버튼을 노출하는 변경을 §7에 추가하세요.

**3. 영속·중복 지급 — 판정: 수정 필요**

- **저장 시점이 승인 계약과 다릅니다.** [확정 계약 5](/C:/code/claude/poker-doku/docs/superpowers/specs/2026-09-05-act3-act4-design.md:108)는 에필로그 **전** receipt+자격 저장을 요구하지만 계획은 결산까지 미룹니다. `pendingGraduation`에 순위·mode·`finishedAt`을 한 번 고정하고 선저장한 뒤, 결산에서 완료+XP를 원자 확정하며 receipt를 재검증하세요.
- 트랜잭션 분리는 타당합니다. [StoryRepository:720](/C:/code/claude/poker-doku/src/server/story-repository.ts:720)은 기존 트랜잭션에 참여하지만 [progression:758](/C:/code/claude/poker-doku/src/server/progression-service.ts:758)은 새 트랜잭션을 엽니다. 전용 `InTransaction` 경로가 필요하며 카탈로그 reconcile·알림은 커밋 뒤 실행해야 합니다.
- **원자성만으로 멱등성이 생기지는 않습니다.** [완료 기록은 매번 증가](/C:/code/claude/poker-doku/src/server/story-repository.ts:629)하고 XP 중복 검사는 그 뒤입니다. 완료 커밋→[reconcile 실패](/C:/code/claude/poker-doku/src/server/story-run-coordinator.ts:1297)→재시도하면 `firstClear=false`로 바뀌어 [새 replay 이벤트](/C:/code/claude/poker-doku/src/server/progression-service.ts:701)까지 지급할 수 있습니다.
- **최소 수정:** 완료 입력·first/replay 판정을 고정하고, 동일 run 완료 재전달은 **완료 횟수 갱신 전** 차단하세요. “커밋 후 reconcile 실패”와 동일 입력 중복 테스트가 필요합니다.
- `throw → server-error ack`도 현재 자동 변환되지 않습니다. [socket-handler:1710](/C:/code/claude/poker-doku/src/server/socket-handler.ts:1710)에 catch가 없고 어댑터 완료는 타이머 콜백입니다. 결과를 보존하는 오류 처리와 advance/resend 재시도를 명시하세요.
- 스키마·단조 자격·`deriveBelt === 'black'`은 수용 가능합니다. DELETE 트리거는 [v32:6616](/C:/code/claude/poker-doku/src/server/persistence/migrations.ts:6616)처럼 부모 프로필 삭제의 CASCADE를 허용해야 합니다.
- `operator-skip` receipt도 기존 운영자 QA 계약상 수용 가능합니다. 다만 [현재 reason은 로그에만 있음](/C:/code/claude/poker-doku/src/server/story-live-adapter.ts:315)을 고려해 서버 내부 요약으로 출처를 전달하고, 실제 run 모드와 구분하세요.

**4. 졸업 대결만 재도전 — 판정: 수용 가능**

- 계획대로 durable 완료 검사와 어댑터 세션 검사를 운영자 우회보다 먼저 적용하면 됩니다. 현재 [start:515](/C:/code/claude/poker-doku/src/server/story-run-coordinator.ts:515)는 런만 검사하므로 계획의 세션 검사가 필요합니다.
- 토너먼트 실패를 checkpoint에서 제외하면 [retrySparring:371](/C:/code/claude/poker-doku/src/server/story-run-coordinator.ts:371)·`sweepExpired`와 충돌하지 않습니다. 후자는 checkpoint만 만료시키므로 새 graduation 런에 10분 제한이 생기지 않습니다.
- [hub activeRun](/C:/code/claude/poker-doku/src/server/story-run-coordinator.ts:460)은 모드와 무관하며, [클라이언트 스토어](/C:/code/claude/poker-doku/src/lib/store/story-store.ts:312)는 `run.drill=null`을 허용합니다. 결산의 드릴 통계·등급 표시도 graduation 분기로 제외하면 됩니다.
- Ch12 exam 거절·graduation durable 검사·서버 운영자 권한을 유지하면 일반 클라이언트의 우회는 없습니다. 운영자가 graduation 중 스킵해도 보상 분기는 `run.mode='graduation'`이므로 0이어야 합니다.
- **최소 수정:** 별도 모드 변경은 불필요합니다. 다만 3번의 선저장 이후 에필로그에서 포기해도 **이미 확정한 receipt는 보존**하도록 “포기=영수증 없음” 문구의 적용 시점을 한정하세요.

**5. 서버 `requiresFlags` 분기 — 판정: 수용 가능**

- 현재 `src/lib/story/chapters`에는 `requiresFlags` 사용이 없습니다.
- [enterStep:1003](/C:/code/claude/poker-doku/src/server/story-run-coordinator.ts:1003)의 exam 선례와 [StoryStage:85](/C:/code/claude/poker-doku/src/components/story/StoryStage.tsx:85)의 원본 `stepIndex` 조회에 맞으므로 서버 스킵이 호환됩니다.
- 저장 플래그→`flagsDelta`→runtime 순으로 덮어쓰고 runtime 값을 영속하지 않는 계약도 적절합니다.
- **최소 수정:** 없음. [sceneMatchesFlags](/C:/code/claude/poker-doku/src/lib/story/scene-cursor.ts:126)가 클라이언트에서 미사용이어도 서버가 진입을 결정하므로 문제없습니다.

**6. SnG 구조 레지스트리 — 판정: 수용 가능**

- 전용 `sngStructureId`가 최소 변경입니다. [competitionMode 정규화](/C:/code/claude/poker-doku/src/server/room-manager.ts:475)는 경제·참가자·난이도·아레나 정산까지 바꾸므로 재사용하면 안 됩니다.
- [parseCreateRoomRequest:145](/C:/code/claude/poker-doku/src/server/socket-payload.ts:145)의 허용 필드 재구성 방식으로 ID를 제거하면 외부 주입을 막습니다. 계획의 동작은 “요청 전체 거절”이 아니라 “필드 제거”입니다.
- 비테스트 `levelIndexAt` 호출자는 [applyBlindLevel:2983](/C:/code/claude/poker-doku/src/server/room-manager.ts:2983) 한 곳입니다. 첫 deadline·다음 블라인드·레벨 계산을 같은 구조로 연결하는 계획이 맞습니다.
- [시작 공지:2036](/C:/code/claude/poker-doku/src/server/room-manager.ts:2036)는 현재 표준 duration을 직접 사용합니다. 계획대로 구조 duration을 사용하고 일반 SnG·아레나는 standard를 유지하면 됩니다.
- **최소 수정:** 없음.

**요약**

- 방 재생성 경계를 완료 핸드 수가 아닌 **첫 딜 시작 여부**로 판정.
- 스토리 SnG의 ActionBar에 **복귀만** 노출하고 기존 상태 보존 분기 사용.
- 에필로그 전 receipt·자격 저장, 안정된 시각·운영자 출처 보존, 이후 포기 시 확정 기록 유지.
- 완료 입력 고정과 run 단위 멱등 가드 추가; 커밋 후 reconcile 실패에도 완료 횟수·replay XP 재지급 방지.
- DB 예외를 pending 상태와 오류 응답으로 처리하고 advance/resend 재시도 연결.
- 졸업 receipt DELETE 트리거에 프로필 삭제 CASCADE 예외 추가.