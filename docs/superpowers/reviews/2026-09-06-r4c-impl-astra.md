# R4c 구현 검토 — GPT 6 Astra

> 2026-09-06. 모델 `gpt-6-astra`(codex exec, model_reasoning_effort=high, 읽기 전용). 대상: `feat/story-r4c-graduation` 커밋 7개(main `af5386c` 기준). 총괄(Fable 5.1) 판정: P1 2건·P2 3건 전부 수용 — 후속 커밋 `fix(story): address R4c review findings`에서 수정.

1. **P1 — 운영자 스킵으로 영수증 저장을 건너뛰고 통과합니다.** [story-run-coordinator.ts:795](C:/code/claude/poker-doku/.worktrees/story-r4c-graduation/src/server/story-run-coordinator.ts:795)  
   입력: 완료 이력이 있는 `graduation` 런에서 1위 → `recordGraduation` 실패 → 운영자 `skip` 반복. 기대: 저장 성공까지 대기. 실제: `skip`이 저장 대기 검사보다 먼저 처리되어 **영수증 0건·자격 플래그 없음·passed=true**로 종료합니다. 최소 수정: `persistPending` 검사를 `skip` 분기보다 먼저 적용하세요.

2. **P1 — 졸업 전용 결산의 reconcile 실패가 복구 경로를 벗어납니다.** [story-run-coordinator.ts:1623](C:/code/claude/poker-doku/.worktrees/story-r4c-graduation/src/server/story-run-coordinator.ts:1623)  
   입력: `graduation` 완주 후 결산에서 `reconcile`이 한 번 throw. 기대: `persistPending='completion'`, 오류 ack, 자동·resend 재시도. 실제: 예외가 그대로 전파되고 **pending=null·재시도 타이머 0개**, resend도 저장을 재시도하지 않습니다. 최소 수정: 졸업 분기도 공통 저장 예외 처리로 감싸세요.

3. **P2 — 올인한 생존자를 남은 인원에서 제외합니다.** [story-live-adapter.ts:603](C:/code/claude/poker-doku/.worktrees/story-r4c-graduation/src/server/story-live-adapter.ts:603)  
   입력: 6명 생존 중 히어로가 `status='all-in', chips=0, finishPlace=undefined`인 상태에서 재접속. 기대: 남은 인원 6명. 실제: **5명**입니다. 최소 수정: 핸드 진행 중 `active/all-in`인 0칩 좌석도 생존자로 포함하세요.

4. **P2 — 첫 완주 실패에도 사용할 수 없는 졸업 재도전 버튼을 노출합니다.** [ChapterResult.tsx:107](C:/code/claude/poker-doku/.worktrees/story-r4c-graduation/src/components/story/ChapterResult.tsx:107)  
   입력: Ch12 완료 0회, 첫 딜 후 방 소실로 순위 없이 종료. 기대: 처음부터 재도전만 제공. 실제: **[다시 졸업 대결]**도 표시되지만 클릭하면 서버가 `story-locked`로 거절합니다. 최소 수정: durable 완료 여부로 버튼을 제한하세요.

5. **P2 — 졸업 전용 결과에 드릴 등급·통계와 잘못된 보상 안내가 남습니다.** [ChapterResult.tsx:85](C:/code/claude/poker-doku/.worktrees/story-r4c-graduation/src/components/story/ChapterResult.tsx:85), [RewardReveal.tsx:182](C:/code/claude/poker-doku/.worktrees/story-r4c-graduation/src/components/story/RewardReveal.tsx:182)  
   입력: `graduation` 모드 1위. 기대: 순위 중심 결산과 보상 없는 재도전 안내. 실제: **B등급·드릴 0/0문·“통과하면 보상이 열려요”**가 표시됩니다. 최소 수정: `RewardReveal`에 졸업 모드 분기를 추가해 등급·드릴 통계·해당 문구를 제외하세요.

정상 확인: 실제 SQLite 메모리 DB에서 완료 트랜잭션 롤백·중복 재시도 후 **완료 1회·XP 이벤트 1건**, source 충돌, 단조 플래그, CASCADE, 카탈로그 일치와 검은띠 자격 조건을 확인했습니다.

정상 확인: 선저장 정상 경로, 모드 진입 가드·씬 분기, 첫 딜 전후 방 소실 처리, SnG 복귀·grace·유휴 보존, 표준 1,500/3분 구조, Ch12 데이터 검증과 `VIDEO_AVAILABLE` 무변경을 확인했습니다.

파일은 수정하지 않았습니다. Vitest는 읽기 전용 환경의 임시 디렉터리 생성 제한으로 실행되지 않아 메모리 재현과 렌더 검증을 사용했습니다.

**요약**

- **P1:** 저장 대기 중 운영자 스킵으로 영수증 유실, 졸업 결산 reconcile 예외 복구 누락.
- **P2:** 올인 생존 인원 오표시, 미완료자 재도전 버튼 노출, 졸업 결산의 등급·보상 안내 오류.