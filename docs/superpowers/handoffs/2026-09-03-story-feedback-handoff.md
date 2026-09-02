# 2026-09-03 세션 인계 — 수련 스토리 v72 플레이 피드백 3건 반영

날짜: 2026-09-03 KST (Phase 1b 인계 문서의 다음 세션)
저장소: `C:\code\claude\poker-doku`, 작업 worktree `.worktrees/story-mode`(브랜치 `feat/story-mode`)
main에 ff 병합, 태그 `story-p1c`. **2026-09-03 사용자 지시로 origin 푸시(414d52e→5d841de, 태그 story-p1c) + Fly 배포 완료 → v73**(머신 48ed666a50d2e8, healthz ok, checks 1/1 passing. `~/.fly/bin/flyctl deploy --ha=false`).
기획: `docs/spec-story-mode-2026-09.md` **Part S**(본문과 어긋나면 Part S 우선) · 요약: `AGENTS.md` 수련 스토리 섹션 + 컨벤션(용어).

## 사용자 피드백(원문 요지) → 반영

| # | 피드백 | 반영 | 커밋 |
|---|---|---|---|
| ① | 핸드를 '손', 폴드를 '접는다'로 쓴 번역투가 어색 — 폴드·3벳·오픈 림프·오픈 레이즈는 원어로 | 챕터 1~3 대사·개념 카드·함께 풀기·드릴 해설(explain/authored/call-decision/range)·결정 리뷰·코치 패널·도움말 일괄 교체('손'→핸드, '접다'→폴드, '여는 손'→오픈 레이즈, '판'→핸드). AGENTS.md 컨벤션에 규칙 고정 | a817cd6 |
| ② | 완전 초보와 족보 아는 유저가 같은 선형 코스 → 흥미 상실. 부족한 부분을 골라 수련하는 리스트, 순서 무관 결과 기반 보상, 아는 내용 억지 플레이 최소화 | 1막 `requires` 해제(비선형) · 허브를 수련 목록으로(카드마다 드릴 유형 칩 + 내 정확도, ≥3문·<70% 약점 강조) · 추천 카드 `recommendChapter`(진행 중 > 약점 > 첫 방문 > 미완료 첫 순서, 제안일 뿐) · **실력 확인 `mode:'exam'`**(드릴만, 힌트 거절, `EXAM_PASS_SCORE` 0.85 이상이면 완료 기록+첫 완주 보상, 미통과는 결산 [수업 듣기]) · 띠 승급은 결산 `beltAwarded`가 알림(에필로그 순서 가정 제거) · 오늘의 수련 문제는 챕터 1개 완료로 개방 | 340de39 |
| ③ | 연습 테이블이 실전 캐시 테이블과 헷갈림 · '10/20핸드 채우기' 의무는 지루함 | **미션형 스파링**: `Step.sparring.minHands` — primary 전부 달성(판정 불가 없음)이면 조기 종료, `maxHands`는 상한. 목표 kind 추가 `reach-showdown`·`fold-hands`·`open-raise`(임계 `open-thresholds.ts` 단일 소스). 비율 kind 규약 `maxCount`=위반 상한 / `target`=실행 횟수(기회 0 → 판정 불가). 1막 목표 전면 교체(Ch1 쇼다운1·폴드1 min4/max12, Ch2 약한 핸드 폴드3·진입0·오픈 레이즈 기회 실행1 min6/max15, Ch3 값에 맞는 결정2·⚠≤1 min6/max15). HUD 'N핸드' + 「목표를 다 채우면 끝나요」. **시각**: `PokerTable storyTheme`(청록 story-felt 토큰·시안 레일·「수련 테이블」 워터마크)·GameRoomView 상시 리본·TopBar 수련 배지(초대·탑업 숨김) | f8b22f5 · 18fdedc |
| 문서 | AGENTS.md(용어 컨벤션·비선형/실력 확인·미션형·시각)·기획 Part S | | 648ffbf |

부수 수정: Ch3 「오즈 위반 ⚠ 1회 이하」가 구현에선 maxCount를 무시하고 100% 정확을 요구하던 불일치 → maxCount 규약으로 해소.

## 검증 상태

- 전체 vitest **178 파일 · 2,328 통과(2 skipped)** (`--maxWorkers=4` 1회), `npx tsc --noEmit` 0, `npm run lint` 0, `npm run build` 통과.
- 신규/갱신 회귀: objectives(사실 3종·kind 3종·maxCount·target 판정 불가·allAchieved)·adapter(조기 종료·판정 불가 유지)·act1(비선형·미션형 규약)·chapters(minHands 검증)·grading(examPassed)·payload(mode)·coordinator(exam 통과/미통과/거절·beltAwarded)·socket story(exam 시작·잘못된 mode)·hub-rules(스킬 칩·추천)·review(용어 문구).
- **브라우저 실주행(dev, 신규 프로필 127.0.0.77)**: 온보딩 → 허브(3챕터 전부 미수련·스킬 칩·[실력 확인]·추천 '처음이라면') → Ch1 [실력 확인] → 헤더 "실력 확인 · 힌트 없음 · 85점 이상 통과", 드릴 카드에 힌트 버튼 없음, 6/6 정답 → 결산 "SKILL CHECK · S · 실력 확인 통과 — 챕터 완료로 기록" + 첫 완주 보상(도장 +150·사쿠라 +30·백띠 뱃지) → 허브: Ch1 완료 S·칩 100%, 오늘의 수련 개방(사쿠라), 추천 CH2 '아직 안 한 수업 중 첫 순서'. 서버 로그 `story-step start mode:"exam"` → 드릴(2) → 결산(6) → ended 확인, 콘솔/서버 에러 0.
- **미검증(브라우저)**: ③의 **수련 테이블 시각(펠트·리본·TopBar 배지·HUD 안내)과 미션형 조기 종료의 실주행** — 자동화 Chrome 탭이 사용자 창의 백그라운드 탭이라 5분 뒤 intensive throttling(타이머 1분 1회)으로 React 상태 갱신이 멈춰 레슨 이후로 진행 불가. 사용자 창(YouTube)의 활성 탭을 바꾸지 않기로 하고 중단. **다음 세션 첫 작업**: 포그라운드 창에서 Ch1 [다시] → 연습 2핸드 → 스파링(폴드 1·쇼다운 1이면 4핸드 뒤 종료)까지 눈으로 확인. 이전 인계의 "Ch2 실주행 결산까지"도 아직 남아 있다(프로덕션 v72에선 사용자가 결산 화면까지 도달한 것으로 추정 — 피드백에 결산 언급 없음).

## 되돌리면 안 되는 결정 (이번 세션)

- **용어 원어 표기**(AGENTS.md 컨벤션) — '손'·'접다'·'판'·'열다' 금지. 새 콘텐츠도 동일.
- **requires는 데이터일 뿐, 1막은 비어 있다** — 해금 함수·검증은 유지(후속 막의 졸업 시험 등에만 사용). 순서 강제로 되돌리지 말 것.
- **실력 확인은 미완료 챕터 전용**, 힌트 서버 거절, 통과선 `EXAM_PASS_SCORE`(재출제 크레딧만으로 못 넘게 0.85). 스텝 인덱스는 원본 챕터 기준 유지(클라가 stepIndex로 데이터를 찾는다).
- **미션형 스파링**: `hands-played`를 primary로 두지 말 것(`act1.test.ts` 고정), 횟수형 primary 1개 이상. 판정 불가(null) primary는 조기 종료를 막고 maxHands 상한에서만 제외.
- 띠 승급 안내는 결산(`beltAwarded`) — 에필로그에 순서·승급 가정 문장 금지.
- 스토리 방 시각 요소는 전부 `useStoryLive().active` 게이트 — 실전 방 렌더 불변.

## 다음에 할 일

1. 포그라운드 브라우저로 ③ 시각·미션형 조기 종료 실주행 확인(위 미검증) → 필요 시 색·문구 조정.
2. (배포 완료 v73) `/api/debug/log?type=story-step`에서 `live-finish reason:"objectives"`(조기 종료)·`start mode:"exam"` 비율 관찰.
3. 후속 아이디어(미착수): 실력 확인 통과 챕터의 스파링만 별도로 도는 「스파링만」 버튼(스펙 A5-2 [스파링만 재도전]의 확장) · 2막 데이터부터 미션형 목표 규약으로 집필 · Ch2 `open-raise` 기회가 안 올 때 15핸드를 다 도는 체감 확인(필요하면 maxHands 12로 하향).
4. Phase 2 후보는 이전 인계 그대로(failScene·리딩 퀴즈·봇 속마음·2막·BGM·v31).

## 환경 함정(추가)

- 자동화 Chrome 탭이 **사용자 창의 백그라운드 탭**이면 5분 뒤 Chrome intensive throttling으로 `setTimeout`이 1분에 1회만 돌아 CDP evaluate 45초 타임아웃 + React 상태 갱신 정지. 짧은 스크립트(await 없이 클릭 1회)만 되고 진행 검증은 불가. 자동화 창을 별도 창으로 띄우거나 포그라운드에 둘 것. (`Get-Process chrome` MainWindowTitle로는 활성 창만 보인다 — EnumWindows로 Chrome_WidgetWin_1 창 목록 확인.)
- 신규 프로필 origin은 `127.0.0.77`을 이번 세션이 썼다(스테일 쿠키 401 방지 — 다음엔 다른 호스트).
