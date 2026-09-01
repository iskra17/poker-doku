# 2026-09-02 세션 인계 — 수련 스토리 모드 Phase 0·1 (MVP)

날짜: 2026-09-02 KST
저장소: `C:\code\claude\poker-doku`, 작업은 worktree `.worktrees/story-mode`(브랜치 `feat/story-mode`)
로컬 main = `200ee9f`(태그 `story-p1`) — **origin에 push하지 않았다**(main이 origin보다 21커밋 앞섬).
프로덕션 Fly는 **v71(HEAD 8fa4ea8) 그대로, 스토리 모드 미배포**. 배포 지시 없이는 배포하지 말 것.
기획서: `docs/spec-story-mode-2026-09.md`(Part R = 2026-09-02 검토 반영 19건). 아키텍처 요약: `AGENTS.md` "수련 스토리 모드" 섹션.

## 이번 세션에서 한 것

1. 이전 세션 기획(플랜 파일 `~/.claude/plans/staged-bouncing-backus.md`)을 코드와 대조해 **19건 수정**하고
   repo `docs/spec-story-mode-2026-09.md`로 저장(01971cd). 플랜 파일과 docs는 동일 내용.
2. **Phase 0**(계산 코어·타입·v30·프로토콜·코디네이터 스켈레톤) → 태그 `story-p0`, main 병합.
3. **Phase 1 MVP**(드릴 생성기·상태 머신·보상·1막 3챕터·클라 허브/스테이지) → 태그 `story-p1`, main 병합.
   커밋 17개(Phase 0 5 + Phase 1 12). 서브에이전트: Opus 5개(0.2·0.3·1.1·1.4·1.5), 검수는 내가 직접.
4. 브라우저 실주행(기획 Part D ①②③) 통과 + 발견한 표시 이슈 7건 수정(9b80346·200ee9f).

## 검증 상태

- 전체 vitest **2,170 통과**(파일 169), `npm run lint` 0, `npx tsc --noEmit` 0, `npm run build` 통과.
- 불변식 증명: `git diff story-p0~5..story-p1 -- src/server/room-manager.ts src/lib/poker/engine.ts src/lib/poker/deck.ts` = 빈 출력.
- 브라우저(신규 프로필, 파트너 사쿠라): 허브 → Ch1 프롤로그·선택지 → 개념 카드 4장 → 함께 풀기 → 드릴 6문
  (힌트 1회, 서버 채점, 오답 재출제로 12문) → 에필로그 → 결산(B, 도장 +100·사쿠라 +30·뱃지·복습 노트 4)
  → 허브 반영(도장 Lv2, CH2 해금, 데일리 개방) → **드릴 중 새로고침 → 같은 문항 복원** → 오늘의 수련 3문(사쿠라 +5).
  콘솔 에러 0.

## 구조 (한 줄씩)

- 서버: `src/server/story-run-coordinator.ts`(방 무관 런 상태 머신, 프로필당 1런, 인메모리), `story-repository.ts`(v30),
  `story-payload.ts`(파서), `story-http.ts`(`GET /api/story`), `socket-handler.ts` story-* 8 이벤트,
  `progression-service.ts` `recordStoryChapterComplete`/`recordStoryDailyDrills`.
- 공용: `src/lib/story/`(types·views·chapters/act1·drills/generator+templates+explain·grading·unlocks·scene-cursor·
  drill-input·story-hub-rules), `src/lib/poker/`(learning·range·seeded-rng·card-notation).
- 클라: `src/lib/store/story-store.ts`, `src/components/story/`(StoryHub·ChapterCard·DailyDrillsCard·ReviewNotePanel·
  StoryStage·ScenePlayer·LessonPage·DrillCard·DrillTableView·DrillAnswerInput·CoachBubble·ChapterResult·StoryLifecycle),
  `page.tsx` 4번째 탭, `PartnerCard` CTA.

## 되돌리면 안 되는 결정

- **통과 = 드릴 세트 완료 + primary 행동 목표.** 스택≥시작 같은 결과 조건은 등급·뱃지 전용(P4 "결과 ≠ 결정").
  비율형 목표는 "기회 중 실행"만 — `vpip-range` 같은 절대 비율 kind를 되살리지 말 것.
- **팟오즈 문항의 '팟'은 상대 벳 포함 중앙 총액**(`computePotOdds(toCall, potTotal)`, 카드에 "(상대 벳 포함)" 표기).
  "팟+벳" 독법으로 바꾸면 정답이 25%/20%로 갈린다.
- **채점은 서버가 같은 seed로 재생성해서 한다.** 클라 DTO는 `toPublicDrillInstance`만(정답·해설·힌트 본문 없음,
  `public.test.ts`가 직렬화 누출 검증). 인스턴스 `seed`는 리롤 후가 아니라 **호출 seed**.
- **Phase 0~1은 room-manager/engine/deck 무수정.** RoomManager 훅 삽입은 Phase 1b.0에서만(기획 B3(d) #1~#14).
- **`hand_history.game_mode`에 'story-practice'를 넣지 말 것**(CHECK 위반) — v30 `story_tag` 컬럼 사용.
- **`drill_attempts.category`는 길이 제약만**(고정 IN 목록 금지 — 유형 추가마다 마이그레이션이 필요해짐).
- **스토리 XP는 카탈로그 영구 아이템을 못 준다**(v13 트리거가 completed-hand/sng-finish만 소스 허용).
  v31에서 `canonical_progression_reward_source_events` 뷰·트리거를 확장하기 전엔 스토리 XP로 넘긴 레벨의
  아이템이 미지급 — `progression-service.story.test.ts`가 이 동작(`grantedItemIds: []`)을 고정해 둠.
- **스토어 액션 이름에 `use` 접두 금지**(`useHint` → `requestHint`: react-hooks 린트가 훅으로 오인).
- **끝난 런은 `result`가 있을 때만 스토어에 보관**(결산 화면용, `dismissRun`이 지움). 포기 등 결산 없는 종료는 즉시 비움 —
  안 그러면 빈 풀스크린 스테이지가 남는다(200ee9f).
- 미야코 표기: 캐릭터 프로필 id는 `dealer`(이름 '딜러')이므로 스토리 UI는 `teacherDisplayName`/`teacherArtId`
  (`story-hub-rules.ts`)·`resolveSpeaker`(ScenePlayer)를 거쳐 '미야코'로 고정한다.

## 다음에 할 일 (우선순위 순)

1. **배포**(사용자 지시 시): `fly deploy --ha=false` — v30 마이그레이션 포함, 신규 테이블뿐이라 다운타임 없음.
   배포 전 `git push origin main`도 사용자 확인 후.
2. **Phase 1b 라이브 스텝** — `.worktrees/story-mode`에서 기획 Part C 1b.0부터:
   RoomManager 훅 #1~#14(`StoryRoomHooks`: isHeld·beforeHand 'deal'|'hold'·skipHandProgression·onHandComplete·
   onBotActed·onPlayerLeave) + `room-manager.story.test.ts`(비스토리 방 spy 0·hold→resume·타임아웃 후 딜아웃 없음·
   미납 BB 회수 없음·practice 스텝 `completeHand` 미호출). 핵심 함정은 기획 B3(d) "히어로 이탈·타임아웃 계약"과
   #6ⓐ(`progression.completeHand`가 MTT 분기보다 앞이라 호출 조건에 가드 필요).
   그다음 1b.1 `LiveTableAdapter`, 1b.2 `ScenarioDeck`(배치 순서 = `getActivePlayers()` 배열순, 번 카드 없음),
   1b.3 objectives/review, 1b.5 StoryOverlay, 1b.6 ch01~03 라이브 스텝 활성(현재는 코디네이터 `enterStep`이 스킵).
3. **v31**: 스토리 XP 아이템 지급 — 뷰·트리거 확장(위 제약).
4. 콘텐츠·아트: 파트너별 Ch1 대사 변주(현재 파트너 대사는 중립 말줄임체), 배경 3·미야코 표정 2·가면 아바타
   (gpt-image-2, `reference_codex-image-gen` 메모리), 2막 데이터.
5. 생성기 에이전트 제안(선택): `DrillSituation.heroSeatIndex`/`dealerSeatIndex` 필드 — 현재 `pos-name`은 포지션을 '?'로 가리고
   버튼 위치를 `note`로만 전달. 미니맵에 D 버튼을 그리려면 필요.

## 환경 메모

- worktree는 부모 `node_modules`를 상속해 테스트는 되지만 **`npm run build`는 worktree에 `npm ci`가 있어야** 통과(이미 설치됨).
- worktree dev 서버(`npm run dev`, 3000)는 dev DB가 worktree 로컬이라 신규 프로필 온보딩부터 시작.
  종료는 포트 3000 리스너 PID를 `Stop-Process`(`verify` 스킬 레시피).
- Claude Code Bash 툴은 명령 텍스트의 `\\`를 `\`로 접는다 — 파이썬 heredoc으로 정규식을 쓸 때 `chr(92)`로 우회했다.
- 브라우저 QA: 스크린샷 JPEG 축소로 카드가 뒷면처럼 보일 수 있다 — `zoom`으로 확인(실제로는 솔리드 4컬러 앞면).
  드릴 자동 주행 루프는 CDP 45초 한도 → 24초 단위로 끊을 것.
