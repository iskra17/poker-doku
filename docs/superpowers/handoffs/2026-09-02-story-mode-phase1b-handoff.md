# 2026-09-02 세션 인계 — 수련 스토리 모드 Phase 1b (라이브 스텝)

날짜: 2026-09-02 KST (Phase 0·1 인계 문서의 다음 세션)
저장소: `C:\code\claude\poker-doku`, 작업 worktree `.worktrees/story-mode`(브랜치 `feat/story-mode`)
태그 `story-p1b` = `f948b53`(Phase 1b 완료). main에 ff 병합. **origin 미푸시·Fly 미배포**(프로덕션은 여전히 v71 = Phase 0 이전).
기획: `docs/spec-story-mode-2026-09.md` Part C 1b.0~1b.6 · 아키텍처 요약: `AGENTS.md` "수련 스토리 모드 › 라이브 스텝 (Phase 1b)".

## 이번 세션에서 한 것 (커밋 13개, cf81b78..f948b53)

| 커밋 | 내용 |
|---|---|
| 7e41d3f | 1b.2 `ScenarioDeck`(`deck.ts` cards protected, 원샷 arm, 좌석 딜 순서 절대 배치, CSPRNG 잔여) + 17 테스트 |
| 57d29f7 | 1b.4 `bot-explain.ts`(19종 코드·카드 정보 없는 한국어 문장) + `processBotTurn {explain}` 옵션 + 32 테스트 |
| d65492f | 1b.3 `objectives.ts`(10 kind '기회 중 실행' 규약)·`review.ts`(👍/🤔/⚠ 4자리) + 34 테스트 |
| b49b64e | **1b.0 RoomManager `StoryRoomHooks` #1~#14** + `RoomConfig` 확장 + `room-manager.story.test.ts` 24케이스(비스토리 spy 0 포함), 기존 스위트 무수정 |
| 95b0f96 | **1b.1 `LiveTableAdapter`** + 코디네이터 `setLiveAdapter`/resume/completeLiveStep/결산 + 소켓 배선(seatHero 포트·가드) + 13 테스트 |
| 5f73e7e | `room-lost {reason:'story-end'}` |
| d0955a6 | AGENTS.md 갱신 |
| 7d8e4a5 | Sol(Codex) 2차 리뷰 반영: 진입 실패 = room-lost 보존(스킵 금지), 런↔실전 참가 상호 배타, 트랜잭션 abandon/finish, 챕터 검증 확장 + 코디네이터 라이브 포트 테스트 4건 |
| 3ba340e | **1b.5 클라**: `StoryOverlay`(목표 HUD·hold 패널·인터럽트 씬·결정 리뷰 시트·연습 배너)·`CoachPanel`·수련 그만두기 확인·room-lost 이어하기·`story-live-rules.ts`·HelpModal |
| a4c6677 | first-showdown 인터럽트 회귀(합성 + 실제 Ch1 스텝) |
| f948b53 | 라이브 스텝 종료 복귀 시 세션 리캡 모달 억제 |

서브에이전트: Opus 5개(1b.2/1b.3/1b.4/1b.0 테스트/1b.5 클라), Codex(Sol) 읽기 전용 리뷰 2회(1b.0 diff → blocking 4건 반영, 1b.1 어댑터 → blocking 3건 반영). 코디네이터·어댑터·RoomManager 삽입은 직접 작성.

## 검증 상태

- 전체 vitest **2,311 통과**(178 파일) + 이후 추가 테스트 3건(a4c6677) 단일 파일 통과, `npx tsc --noEmit` 0, `npm run lint` 0, `npm run build` 통과.
- 브라우저 실주행(Part D ④⑤, Ch1 재도전): 허브 → VN → 레슨(함께 풀기) → 드릴 6/6 → **'연습' 프리셋 2핸드**(히어로 A♠K♠·보드 A♥K♦7♣2♦9♠·카피 Q♥Q♦ = 스크립트 그대로, 핸드 히스토리 `story_tag='practice'`, +163) → **스파링 10핸드**(목표 HUD 진행·✓, first-my-turn 씬, first-showdown 씬 hold→resume(서버 로그 seq 46), 결정 리뷰 시트(⚠ 프리플랍 콜), **턴 타임아웃 → "시간이 지나 잠시 멈췄어요" [계속하기] → 재개**, 핸드 XP 토스트, 코치 라인 "필요 승률 22% (콜 30 · 팟 138)") → live-finish(netBB -9.6) → 에필로그 진입. 콘솔 에러 0. 실전 회귀: Practice Dojo 정상(스토리 UI 없음·자리비움 버튼 유지).
- **미검증**: 에필로그 → 결산(ChapterResult live 요약) → 허브 반영의 브라우저 확인 — 에필로그 도달 직후 dev 서버 프로세스가 출력 없이 종료(exit 1)됐다. 서버 로그에 예외 흔적 없음(live-finish 이후 타 앱 탭의 404 요청을 한동안 정상 처리) → 외부 kill로 추정. 코디네이터 테스트(`story-run-coordinator.test.ts` 라이브 포트 4건)가 같은 경로(completeLiveStep → 에필로그 → 결산 passed/live 요약)를 고정하고 있으나 **다음 세션 첫 작업으로 Ch2 실주행 끝까지** 확인할 것.
- 브라우저 자동 주행 함정: 탭이 백그라운드(`visibilityState hidden`)면 CDP evaluate 45초 타임아웃이 잦다 — 루프는 12~14초 단위, 타임아웃된 루프도 페이지 안에서 계속 실행되므로(인터럽트 씬을 자동 스킵했다) 서버 이벤트 로그(`[evt] story-step target:"resume"`)로 교차 확인.

## 되돌리면 안 되는 결정 (이번 세션 추가분)

- **훅 호출은 전부 `isStoryRoom(config.storyChapterId)` 뒤** — 비스토리 방 실행 경로 불변(회귀 spy 0). `MttRoomHooks`와 일반화하지 않는다.
- **`beforeHand`는 `engine.startHand()` 앞, `sitOutAuto` 소거 루프 전** — 타임아웃 마킹을 어댑터가 보고 해제할 수 있는 유일한 지점. 여기서 'hold'면 시작 취소.
- **'연습' 핸드는 `captureHandStart`+`completeHand` 둘 다 생략**(`tracksProgression` 가드) — 한쪽만 빼면 progression 런타임 hand context 고아.
- **스토리 방 생성 fail-closed**: 훅 미주입·economyMode≠practice·`botThinkScale` 비정상·스토리 전용 필드 단독 → throw. 초대 코드 미발급, 목록 미노출, join-room은 본인 좌석 재입장만.
- **이탈은 `abandon-story` 단일 경로**: toggleSitOut/나가기 예약/leave-room/탑업 거절, 스토리 런이 살아 있으면(방 없는 씬·드릴 포함) 다른 방 착석·방 생성·아레나 대기·토너 등록 거절, 반대로 착석/토너/아레나 중엔 start-story-chapter 거절.
- **진입 실패는 스킵이 아니라 room-lost hold**(`enter()`는 항상 'entered') — 스파링을 건너뛰면 primary 목표 없이 통과된다. 'unavailable'은 어댑터 부재 의미로만 남긴다.
- **방 해체는 트랜잭션**(`disposeOwnRoom` false면 세션·byRoom·roomId·런 유지, abandon은 server-error 재시도 안내, finish는 10초 재시도). `disposing` 플래그가 `onRoomDisposed` 재진입 가드.
- **`first-my-turn` 인터럽트는 클라 연출**(서버 hold 없음, 턴 타이머 안에서), 나머지 3종은 서버 hold('scene') + `live.interruptId`. hold 상한 10분 스윕은 room-lost 전환.
- **봇 속마음은 수집만**(`exposeBotThoughts` 기본 false) — Ch7 전엔 뷰에 싣지 않는다.
- `room-lost {reason:'story-end'}`는 클라가 토스트 없이 방 상태만 비운다; 세션 리캡 모달도 스토리 런이 있으면 띄우지 않는다.
- 챕터 검증: 라인업 캐릭터는 로스터 봇만(딜러 불가), 목표/인터럽트 id 챕터 전역 유일.

## 다음에 할 일 (우선순위 순)

1. **Ch2 브라우저 실주행 끝까지**(에필로그 → 결산 live 요약 → 허브 반영, halfway 인터럽트) + dev 서버 프로세스 종료 원인 재관찰(재현되면 `server-shutdown.ts` 경로·메모리 확인).
2. 사용자 지시 시 `git push origin main` + `fly deploy --ha=false`(v30 마이그레이션 포함, 다운타임 없음).
3. Phase 2 후보: 실패 씬(`failScene`) 재생, `pendingQuiz` 라이브 리딩 퀴즈, 봇 속마음 노출(Ch7)·가면 identity, 2막 데이터, 스토리 BGM, v31 스토리 XP 아이템 트리거.
4. 세션 운영 메모: **에이전트 4개 병렬 vitest로 메모리 크래시 2회** — 동시 에이전트 ≤2, 단일 파일 vitest, 전체 스위트는 `--maxWorkers=4`로 1회만.
