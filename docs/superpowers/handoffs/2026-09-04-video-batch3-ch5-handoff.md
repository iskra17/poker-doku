# 컷신 영상 3차 배치 · CH5 실주행 세션 인계 (2026-09-04, 8차 세션)

## 0. 현재 상태 한눈에

| 항목 | 상태 |
|---|---|
| 브랜치 | `feat/story-video-batch3` → main ff 병합, **origin 푸시 완료(`bd7cdd4`)**, worktree `.worktrees/story-mode`는 같은 커밋 |
| 영상 | `VIDEO_AVAILABLE` **43클립 전부** — 파일럿 3 + 2차 6 + **3차 34**(인연 씬 22 + 챕터 씬 CG 12). 씬 CG 영상 id는 `scene-<SceneCgId>`(`sceneCgVideoId`) |
| 코드 | ScenePlayer 라인 CG·기록실 SCENE CG 뷰어에 `VideoCutscene` 슬롯(CgStage와 같은 폴백 계약), `GalleryEntry.sceneCgId` |
| 실주행 | **CH5(클로이) 스파링 2회** — 1차 14핸드 max-hands 「A · 미통과」, 2차 **8핸드 primary 전부 달성 → 「MISSION CLEAR」 컷인 → 조기 종료(reason `objectives`) → 「S · 통과」** + 첫 완주 보상(밸류 장인 칭호·스트리머 후디·800칩) 지급 확인 |
| 검증 | 전체 vitest `--maxWorkers=4` 세션 시작 2449 통과 → 변경 후 **196파일/2451 통과** · `tsc --noEmit` ✓ · `npm run lint` ✓ · 영상 86파일 68MB(3차 34클립 ≈55MB, 클립당 ≤1.9MB) |
| 배포 | **Fly v81 = main `bd7cdd4`**(2026-09-04 사용자 지시로 `fly deploy --ha=false`, 이미지 302MB, healthz 200·영상 43클립 HTTP 200 확인) |
| 로컬 프로세스 | 세션 종료 시 dev 서버(3000)·ComfyUI(8188)·H3 러너 종료 확인 — 살아 있으면 `Stop-Process` |
| 메모리 | [[project_story-mode-plan]](8차 이력) · [[reference_browser-qa-recipe]](fiber 스냅샷 자동 플레이) · [[reference_comfyui-h3-video]](3차 배치 교훈) |

이전 인계 `2026-09-04-operator-video-handoff.md`(운영자 모드·자동화 함정 §4)와 `2026-09-03-act2-video-handoff.md`는 여전히 유효.

## 1. 새 세션 시작 절차

1. 이 문서 → AGENTS.md 스토리 섹션(v74 ④ 영상 bullet 갱신됨) → `scripts/art/story-video.md`(3차 배치 기록).
2. **사용자에게 먼저 묻는다**: 실기기 재생 피드백(§3). 푸시·배포(v81)는 이미 끝났다.
3. worktree `.worktrees/story-mode`에서 작업. dev 서버는 `npm run dev` 백그라운드 + `curl localhost:3000/healthz`.
4. QA는 운영자 모드(로고 7연타 → OP). 스파링 자동 플레이는 §4의 fiber 스냅샷 루프를 재사용.

## 2. 이번 세션에서 한 것

### 2-1. 컷신 영상 3차 배치 34클립
- `scripts/art/story-video-h3.py CLIPS`에 34개 프롬프트 추가(seed 509020260910~943, 캐릭터 외형을 프롬프트마다 재기술, "subtle ambient
  motion only"). 34클립을 **한 분리 프로세스**(`Start-Process python … -RedirectStandardOutput batch3.log`)로 순차 생성 — 클립당 95~120초,
  전체 약 60분. 검수는 6프레임 시트(`ffmpeg … tile=6x1`)로 얼굴·의상 유지·첫/끝 프레임 일치 확인 후 승인분을 곧바로
  `story-video-encode.sh`로 인코딩(생성과 병행). 재생성은 1건 — `scene-act2-ch04-epilogue`는 v1에서 한 프레임 입이 벌어져
  `H3_SEED_OFFSET=1000 … v2`(러너에 seed 오프셋 env 추가)로 다시 만들어 채택.
- 씬 CG 영상 슬롯: `story-video.ts sceneCgVideoId(id) = 'scene-'+id`, `ScenePlayer`는 라인 CG에 `VideoCutscene`(실패/reduced-motion → 정지
  img), `GalleryModal` SCENE CG 뷰어는 `entry.sceneCgId`로 같은 매니페스트를 읽는다. 테스트 `story-video.test.ts`(3차 배치·씬 CG id 규약).

### 2-2. CH5 스파링 실주행 (프로필 127.0.0.10 노을부엉이#9320, 운영자 스킵으로 씬·레슨·드릴·연습 통과)
- **1차(체크/콜 라인)**: 14핸드 max-hands 종료, 리버 첫 자유 액션이 벳인 핸드가 늦게 나와 「A · 미통과」(밸류벳 미달·에어 벳 0 달성·
  쇼다운 3 달성). 결산 [다시 도전]으로 재시작.
- **2차(탑페어+ c벳/밸류벳 라인)**: 1핸드 스트레이트 리버 벳 60/90(67%) → 첫 쇼다운 인터럽트 씬 → 8핸드 스트레이트 리버 벳 160/224(71%) →
  HUD 2/2·사이징 100%/50% → **「MISSION CLEAR」 컷인**(MutationObserver로 텍스트 관측) → 서버 `live-finish reason:'objectives' handsPlayed:8
  netBB:23` → 에필로그(선택지) → 결산 「S · 통과」, 첫 완주 보상 도장 XP +300·인연 +100(Lv1→3)·밸류 장인 칭호·클로이 스트리머 후디(S)·800칩,
  다음 보상 미리보기(파란띠 펠트·승급). 허브 카드 「CH5 · 클로이 · 완료」.
- 확인된 집계: `riverValueBet`은 리버 **첫 자유 액션**(toCall 0)이 벳일 때만 — 상대가 먼저 벳하면 기회가 아니다(콜만 가능). 결산 목표 행은
  숫자 없이 달성/미달/해당 없음만 표기하므로 1차의 「사이징 달성」은 13~14핸드에 밸류벳 1회가 있었다는 뜻(0/2 → 1/2 미달).

### 2-3. CH6 보스 팽팽 재주행 (같은 프로필, 3벳 온도 정책 — Chen 백분위를 페이지 안에서 복제)
- 15핸드 max-hands 종료, +23BB → 「S · 통과」(프리미엄 3벳·하위 폴드 **해당 없음**, 하위 4벳 0 달성, 보너스 2개 달성). 첫 완주 보상(얼음을 녹이다
  CG·파란띠 카드백·서울의 불꽃 CG·800칩) 지급, 결산의 보스 CG 컷신에서 `story-cg-act2-paeng-boss.webm` 로드 확인.
- 1핸드는 리로드 뒤 `window.__pdSnap`이 사라져 루프가 놀았고 60초 턴 타임아웃 → hold 'timeout' → 루프가 [계속하기]를 눌러 복귀(hold 경로 실주행).
- **보스 격파 컷인은 이번에도 미발생**: 팽팽이 오픈 레인지가 좁아 15핸드 동안 "오픈을 맞은 프리미엄" 기회가 0이었고, 하위 폴드도 기회 0(팽팽이 내 오픈에
  3벳을 한 번도 안 했다). `primaryObjectivesAllAchieved`는 null을 미달성으로 보므로 기회가 안 오면 조기 종료·컷인이 없다 — 기회 확률이 낮아
  플레이어도 거의 못 보는 연출. 판단 필요: CH6 primary를 "기회가 오면"이 아니라 히어로가 만들 수 있는 행동(예: 팽팽 3벳에 프리미엄 4벳/콜 구간 콜)으로
  바꾸거나, 보스 라인업의 봇 스탯(팽팽 vpip/pfr)을 스파링에서만 올리는 방안.

### 2-4. 배포 후 피드백 1건 — 아라 Lv15 「야시장」 꼬치 그립 (2026-09-04)
- 사용자: "꼬치를 손잡이가 아니라 고기 부분을 쥐고 있어 어색하다". 영상은 CG가 첫 프레임이라 **CG를 먼저 고쳤다**: gpt-image-2 edit 모드
  (`poker-doku-art/story-rewards/prompts/fix-ara-lv15{,-b}.txt`, `run-fix-ara-lv15{,-b}.sh`) 2라운드 6안 → b3 채택(손잡이 끝을 쥐고 고기는 시청자
  쪽 끝에). 1라운드는 "눈이 떠졌다"고 오판해 2라운드에 '감은 눈' 제약을 넣었는데, 원본 CG는 원래 눈을 뜬 표정이고 사용자 캡처가 영상의 깜빡임
  프레임이었다 — 결과는 원본과 같은 표정이라 문제없음(교훈은 story-video.md 3차 기록).
- `public/assets/characters/ara/scene-lv15.webp` 교체(convert.mjs cg) → `H3_SEED_OFFSET=2000 … v3`로 클립 재생성·인코딩 → 브랜치 `fix/ara-lv15-skewer`.

## 3. 못 한 것 / 판단 필요

- **파란띠 승급 연출**(2막 3챕터 완주 필요 — 이 프로필은 CH5·CH6 완료, CH4가 남음), 보스 격파 컷인(§2-3 — 기회 확률 문제, 설계 판단 필요),
  실패 씬 재생(미구현).
- **실기기 재생 확인**: 3차 34클립은 시트 검수만 — 자동화 창은 hidden이라 `<video>` 재생을 못 본다. 사용자 실기기 체크 항목: 인연 탭/기록실에서
  인연 씬 24장·이벤트 CG 탭 씬 CG 12장이 루프 재생되는지, ScenePlayer 라인 CG(CH1 프롤로그 첫 라인 등) 영상 전환이 자연스러운지,
  용량(webm 0.5~1.9MB).
- 결산 목표 행에 진행 숫자(예 1/2)를 함께 보여 줄지 — 현재는 라벨+달성/미달만.

## 4. 브라우저 자동 플레이 레시피(이번 세션 신규 — 상세는 [[reference_browser-qa-recipe]])

- 게임 상태는 DOM 파싱 대신 **React fiber에서 zustand 스냅샷**을 꺼낸다: `document.__reactContainer$*` → `hostRoot.stateNode.current` DFS로
  `type.name==='ActionBar'` fiber → `memoizedState` 훅 체인에서 `gameState`·`sendAction`을 가진 객체. `sendAction('raise', 총액)`은 raise-to.
- hidden 창의 setTimeout 스로틀은 **Web Worker 타이머**로 우회(300~400ms 폴링 정상). 루프는 `window.__playGen` 세대 토큰, 로그 `window.__playLog`.
- 루프가 함께 누르는 버튼: 코치마크(`화면을 탭하면 시작해요`), 인터럽트 씬 `건너뛰기`(방 안에서만), hold `계속하기`. 결산 리빌·[허브로]·[다시 도전]은
  실제 좌표 클릭(`getBoundingClientRect` × 1568/2560).
- CH5 정책(2차): 프리플랍 tier≥2면 3BB 오픈, ≤3BB 콜은 아무 핸드; 플랍/턴 탑페어+면 55% 팟 벳·콜은 팟 이하; 리버 탑페어+/메이드면 66% 팟 벳,
  아니면 체크/폴드(에어 벳 0). 14핸드 안에 2회 밸류벳 확률은 대략 절반 — 안 되면 [다시 도전].

## 5. 다음 세션 순서

1. 실기기 피드백(§3) 반영. 필요하면 특정 클립 seed 변경 재생성(`python scripts/art/story-video-h3.py v2 <id>` → 인코딩 → 파일 교체).
2. CH6 보스 격파 컷인 조건 판단(§2-3), 파란띠 승급(CH4 완주 필요).
3. 3막 데이터(비비안·클로이·엘레나, 가면 봇 identity 분리 선행) 또는 하드 모드.
