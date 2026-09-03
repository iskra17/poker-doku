# 수련 스토리 — 영상 파일럿 + 2막 데이터 세션 인계 (2026-09-03, 5차 세션)

## 0. 현재 상태 한눈에

| 항목 | 상태 |
|---|---|
| main | `68e9760` — 태그 `story-act2` (origin/main보다 4커밋 앞, **미푸시**) |
| 브랜치 | `feat/story-video-pilot` = main과 동일 커밋, worktree `.worktrees/story-mode` (`npm ci` 완료) |
| 배포 | Fly **v75 = 4차 세션(story-polish)** 그대로. 이번 세션 결과(영상·2막)는 **미배포** |
| 커밋 | d3aea38 영상 파일럿 3클립 + 숫자 입력 잔존 수정 → ae4dfce 2막 Ch4~6 → 77c9d83·68e9760 인계 문서 |
| 검증 | `npx tsc --noEmit` ✓ · `npm run lint` ✓ · vitest 전체 `--maxWorkers=4` **2,428 통과 / 2 skip (194 파일)** · 브라우저 실주행(아래 §3) |
| 로컬 프로세스 | dev 서버·ComfyUI 모두 종료됨. 자동화 브라우저 탭 없음 |
| 기획/규약 | `docs/spec-story-mode-2026-09.md` **Part V**, AGENTS.md 스토리 섹션(데이터·드릴·보상 라인·영상 bullet), `scripts/art/story-video.md` |
| 메모리 | [[project_story-mode-plan]](이력) · [[reference_comfyui-h3-video]](ComfyUI 위치·H3 절차, 새 파일) · [[reference_codex-image-gen]](read-only 회수) |

## 1. 새 세션 시작 절차

1. **사용자에게 먼저 묻는다**: 푸시·배포 여부(`git push origin main --tags` → `fly deploy --ha=false`, flyctl은 PowerShell로 사용자 홈 `.fly/bin/flyctl.exe`),
   그리고 실기기 피드백(§4 체크리스트). 배포는 사용자 지시 시에만.
2. worktree `.worktrees/story-mode`에서 `git checkout -b feat/<topic>`(main = feat/story-video-pilot이므로 그대로 분기).
3. 읽을 것: 이 문서 → AGENTS.md 스토리 섹션(「데이터」·「드릴」·「보상 라인」·v74 ④ 영상 bullet) → 기획 Part V → `scripts/art/story-video.md`.
4. dev 서버: worktree에서 `npm run dev` 백그라운드 + `curl localhost:3000/healthz`. **서버 코드(챕터 레지스트리·objectives 등) 변경 후엔 재시작**(tsx는 watch 아님).
   끝나면 3000 포트 리스너 `Stop-Process`.
5. 브라우저 QA(`claude-in-chrome`): `tabs_context_mcp{createIfEmpty:true}`로 자동화 창. 신규 유저 격리는 `http://127.0.0.N:3000`(N을 바꾸면 새 프로필).
   함정은 §6.

## 2. 이번 세션에서 한 것

### 2-1. 영상 파일럿 (커밋 d3aea38)
- 인계에 있던 "Wan 2.2 I2V 28GB 다운로드"는 불필요했다 — Codex(GPT 윈도우 앱)가 8/26~31에 만든
  `C:\code\1. codex\AI-Image-Video\ComfyUI_windows_portable`(v0.34, torch 2.13+cu130)에 **MiniMax H3**(fl2va, 첫/끝 프레임 컨디셔닝)가 이미 설치돼 있었다.
- `MiniMaxH3ImageToVideo(first_frame = last_frame = CG)` → 768×1152(CG 원본 = H3 네이티브) · 107프레임(17k+5 그리드) · 24fps · turbo 8-step → **클립당 ~100초**.
  첫 프레임 = 끝 프레임이라 `<video loop>` 이음새 없음, RIFE 불필요. 오디오는 버림(VideoCutscene muted).
- 배치: `public/assets/story/video/{story-cg-act1-belt-yellow, story-cg-act1-draco-boss, sakura-scene-lv5}.{webm,mp4}` (0.5~1.4MB) +
  `story-video.ts VIDEO_AVAILABLE` 3건 + 테스트. 러너 `scripts/art/story-video-h3.py`, 절차 `scripts/art/story-video.md`.
  원본 mp4·제출 JSON: `D:\AI-Image-Video\output\poker-doku\`.
- 버그 수정: 연속 숫자 문항에서 이전 답("8")이 다음 입력칸에 남던 문제 — `DrillCard`가 `DrillAnswerInput`을 문항 key로 리마운트.

### 2-2. 2막 「공격의 기본」 Ch4~6 (커밋 ae4dfce)
- **드릴 템플릿 8종**(`src/lib/story/drills/templates/`): `breakeven-fold-pct`·`breakeven-choice`(D-BE, 팟은 **벳 전** 금액) /
  `size-cbet-texture`·`size-river-value`(D-SIZE: 드라이 ⅓·웻 ¾, 스테이션 상대 ¾·에어 체크) / `type-from-hud`·`type-exploit`(D-TYPE, `personalities.ts`
  실제 HUD, VPIP 40↑ 루스·22↓ 니트·PFR ≥ VPIP×60% 어그레시브, 비히로인 봇 8명만) / `range-3bet-decision`·`range-vs-3bet`(3구간).
  3벳 임계 단일 소스 `open-thresholds.ts`(3벳 6 / 콜 12 · 4벳 3.5 / 콜 8). 수기 D-ACT 8문 `authored/act2.ts`.
- **해설 말투**: 아라(반말 츤데레)·클로이(스트리머체) 추가, 공용 core의 존댓말 어미는 `explain.ts toCasual()`이 반말로 바꾼다(비비안·엘레나는 여전히 폴백).
- **스파링 목표 kind 7종**(`types.ts OBJECTIVE_KINDS`·`objectives.ts`): `no-limp`·`steal-open`(CO/BTN)·`no-air-river-bet`·`value-bet-sizing`(params.minPct)·
  `premium-3bet`·`fold-vs-3bet-junk`·`no-junk-4bet`. 히어로 사실 확장: limped·stealOpportunity/stealOpen·riverAirBet·riverValueBetPct·facedOpen·
  premiumThreeBetOpportunity/premiumThreeBet·facedThreeBet·junkVsThreeBet·foldedVsThreeBet·junkFourBet.
- **챕터** `src/lib/story/chapters/act2/`: `ch04-first-strike.ts`(아라: 스틸·손익분기·c벳, 스파링 카피·모찌·사쿠라 12→14핸드) ·
  `ch05-take-what-is-yours.ts`(클로이: HUD 유형·밸류벳·사이징, 스파링 클로이·카피·유즈키) · `ch06-three-bet-temperature.ts`(아라+팽팽: 3구간,
  **보스 팽팽 HU 50BB 15핸드**, `failScene`). `requires = 1막 3챕터`(노란띠 뒤 개방), 2막 안 비선형. `act2.test.ts` 15건.
- **아트 15장**(codex gpt-image-2, `C:\code\claude\poker-doku-art\story-rewards\` 스테이징): 씬 CG 6(`scene-act2-ch0{4,5,6}-{prologue,epilogue}` →
  `story-cgs.ts` 12개 id) + 보상 CG 3(`act2-paeng-boss`·`act2-ara-victory`·`act2-belt-blue`) + 의상 아라 `jersey`·클로이 `stream` 3표정
  (`character-art.ts OUTFITS`).
- **보상 v33**: 카탈로그 16항목(칭호 「첫 스틸」·「밸류 장인」, 의상 2, 보스 CG·아라 CG·파란띠 승급 CG, 파란띠 카드백/펠트, 칩) + `migrations.ts` v33 INSERT
  (패리티 테스트), `titles.ts STYLE`, `Card.tsx`·`CardBackPreview.tsx`·`PokerTable.tsx`·`globals.css` 파란띠 변형.
- 테스트 수치 갱신: `generator.test`(20 템플릿·authored 10·상대 풀 9), `database.test`/`arena-legacy-season-upgrade.test`(version 33),
  `story-reward-service.test`·`socket-handler.story.test`(카탈로그 36), `gallery/catalog.test`(칭호 9·CG 19·씬 CG 12), `story-cgs.test`(12).

## 3. 실주행으로 확인한 것 / 못 한 것

**확인(자동화 창, 프로필 127.0.0.10)**
- Ch1·Ch3 실력 확인: 드릴 퍼펙트 컷인(우측 상단 「PERFECT 미야코/하나」 카드 + 「퍼펙트」 스탬프), 3/5 콤보 스탬프·토스트, 결산 S·보상 카드 플립·
  CG 컷신·[기록실 보기] → 기록실(이벤트 CG 탭·뷰어가 모달 위에 뜸), Ch3 결산 드라코 보스 CG 스테이지에 `<video>` 로드(webm, readyState 4, 768×1152).
- Ch2 실력 확인 → 1막 완주 → 노란띠 승급 CG도 `<video>` 로드 → 허브 「2막 · 공격의 기본」 잠김 해제(카드에 담당·드릴 유형 칩·보상 미리보기).
- 보관함에서 「백띠 수련생」 장착 → Practice Dojo 착석 → 좌석 이름 아래 SVG 칭호 플레이트.
- 설정 사운드 탭 `MusicTrackPicker`(mood별 라디오·▶) 렌더, 로비 🎵 팝오버.
- Ch4: 프롤로그 씬 CG(칩을 튕기는 아라) → 개념 카드 4장(공식 카드 포함) → 함께 풀기 2블록(상황 패널이 단계·피드백과 무관하게 유지, K♥T♣ 공개, 「다음 단계」·「완료」
  버튼) → 드릴 7문 **전부 서버 채점 정답(퍼펙트 플래그)**: breakeven 20%·c벳 텍스처 ¾·손익분기 4지 20%·수기 3문(레이즈 슬라이더 2~5BB) →
  연습 테이블 첫 핸드 K♥T♣ 딜(수련 테이블 테마·「연습 0/2핸드」·perHandPrompt 배너) → ← 「그만두기」로 abandon → 허브 정상.

**못 한 것(다음 세션)**
- 2막 **라이브 스텝**: Ch4 연습 2핸드·스파링(`steal-open`/`no-limp`/`cbet-when-aggressor` 집계), Ch5 전체(리버 밸류·에어·사이징 집계), Ch6 전체(보스 팽팽
  헤즈업 — 헤즈업 포지션 라벨은 `'BTN/SB'`·`'BB'`라 `OPEN_THRESHOLDS`에 없어 오픈/스틸 기회는 안 잡힌다. 3벳 대면 사실은 포지션 무관이므로 primary는 동작해야
  하지만 **실측 필요**). 미션 클리어/보스 격파 컷인, 2막 결산 보상 지급(v33 reconcile)·파란띠 승급·펠트/카드백 렌더.
- 영상·BGM **실제 재생**: 자동화 창은 `document.visibilityState === 'hidden'`이라 Chrome이 무음 영상·오디오를 정지시킨다. 사용자 실기기 확인.
- 390px 모바일 레이아웃, reduced-motion, 징글 덕킹.

## 4. 사용자 피드백 체크리스트 (먼저 물어볼 것)

1. 영상 3클립 — 결산/기록실에서 재생되는지, 루프 이음새(첫=끝 프레임 복제 1장 제거), 화질(VP9 crf32)·용량.
2. BGM — 순환·[다음 곡]·미리듣기 12초 복귀, 짧은 루프 3곡(긴장 36s·보스 19s·승급 9s) 질림 여부.
3. 2막 톤 — 아라 반말·클로이 스트리머체·팽팽 「…」, 해설의 `toCasual()` 어미가 어색한 곳.
4. 새 드릴 — HUD 유형 문항(VPIP/PFR 두 줄 규칙)과 3구간 문항 난이도, c벳 텍스처(드라이/웻 이분법) 납득 여부.
5. 결산 위에 「도장 Lv.N 달성」 레벨업 필이 겹쳐 뜨는 것(§5)이 거슬리는지.

## 5. QA 중 관찰(버그는 아니지만 판단 필요)

- 결산 RewardReveal이 버튼 단계에 이르면 로비 `StoryRewardLayer`의 레벨업 필(도장 Lv 달성)이 결산 카드 위에 겹쳐 뜬다 — hold/release 게이트가 리빌 완료
  시점에 풀리기 때문. 결산 닫힌 뒤로 미루려면 `presentation-store` release 시점을 [허브로]/[다음] 클릭으로 옮긴다.
- 자동화 창 스크린샷이 가끔 좌상단 1/3만 찍히거나 30초 타임아웃 — 렌더 아티팩트(레이아웃은 정상, `getBoundingClientRect`로 확인). 2~3초 뒤 재시도.
- 헤즈업(Ch6 보스) 포지션 라벨 `'BTN/SB'`는 `positionLabels(2)` 규약 — 스틸/오픈 판정에 필요하면 `objectives.ts`에서 `'BTN/SB'`를 BTN으로 매핑.

## 6. 함정·교훈(이번 세션)

- **codex `--sandbox workspace-write`를 줘도 read-only로 뜨는 일이 또 반복** — 로그의 ``- `neutral`: …call_x.png`` / `Copy-Item … -Destination` 라인으로
  `codex-home/generated_images/<세션>/`에서 회수. 매핑 라인이 없으면 파일 생성 시각 순 = IMAGE 순(이번엔 cg-f가 그랬고 시트로 확인).
- ComfyUI `LoadImage`는 input **최상위** 파일만 목록에 올린다 — 하위 폴더 대신 `pd-<id>.png`로 복사.
- 개념 카드 본문의 `1.5BB`·`3.5%` 소수점은 act 테스트의 "2문장 이하" 검사에 마침표로 세인다 — `1½BB`·`3½%`.
- 생성 템플릿은 후보가 비면 `pickOne` 대신 `null`(리롤) — 빈 배열 `pickOne`은 throw라 100시드 테스트가 죽는다.
- 히로인 6명은 어떤 드릴에도 상대로 나오지 않는다(kit 규약, `generator.test.ts` 풀 단언). D-TYPE 풀은 모찌·잉그리드·초코·구미·팽팽·린·카피·드라코.
- 마이그레이션 버전을 올리면 `database.test.ts`(2곳 + `{ version: N }` 다수) 외에 `arena-legacy-season-upgrade.test.ts`도 함께.
- 브라우저: 탭을 전부 닫으면 다음 자동화 창이 **277×73**으로 열릴 수 있다(`resize_window`는 안 먹음) → `innerWidth` 확인 후 탭 닫고 재생성.
  드릴은 DOM `innerText`(카드 랭크·수트 텍스트)로 읽고 JS로 버튼 클릭이 스크린샷보다 안정적. 결산 리빌은 synthetic click으로 안 넘어간다(실제 클릭 좌표).
  React range 슬라이더는 native setter + `input` 이벤트로 값 세팅.
- bash 안 Python heredoc에 `'''`·백슬래시 경로가 있으면 bash가 EOF 오류를 낸다 — 패치 스크립트는 Write 도구로 파일에 쓴 뒤 실행.

## 8. 2026-09-04 후속 세션 — 운영자 모드 + 2막 라이브 실주행 (7차)

**상태**: main = origin/main, Fly **v78** 배포(운영자 모드·비비안 Lv5 보정 포함). 시크릿 `OPERATOR_PROFILE_IDS`에 새벽참새#4125·여름토끼#9490 등록.

- **운영자 모드**(AGENTS.md 「운영자 모드」 bullet): 로비 로고 7연타 → OP 배지, 기록실/인연 탭 전 항목 미리보기, 잠긴 챕터 시작,
  StoryStage·StoryOverlay [⏭ 스킵](서버 `target:'skip'`). QA 시 이걸로 씬·드릴·연습 스텝을 건너뛰고 스파링만 실제로 친다.
- **CH4 스파링(카피·모찌·사쿠라·아라, 14핸드 상한) 실주행**: 14핸드 max-hands 자연 종료 → 에필로그 → 결산 「B · 미통과」
  (스틸 오픈 1/2 미달·c벳 0/1 미달·림프 0 달성, 보상 없음, 다음 보상 미리보기). 라이브 HUD·핸드 카운터·결정 리뷰 시트 정상.
- **CH6 보스 팽팽 헤즈업(50BB, 8~15핸드) 실주행**: 15핸드 max-hands 종료 → 결산 「S · 통과」 — 프리미엄 3벳 기회 0회는
  「해당 없음」(판정 제외), 3벳 맞은 하위 폴드 달성, 하위 4벳 0 달성, 칩 bonus 미달(−8BB). 보상 v33(얼음을 녹이다 CG·파란띠
  카드백·서울의 불꽃 CG·퍼펙트 칭호·800칩) 지급. **헤즈업 라벨(BTN/SB·BB)에서 3구간 사실이 포지션 무관으로 집계됨을
  `objectives.test.ts` 헤즈업 describe로 고정**(오픈/스틸 기회는 헤즈업에서 세지 않는 것도 명시).
- **고친 것**: ObjectiveHud 비율 목표 표기 — 하위 폴드 1/1이 「0.7/0.7」로 보이던 것을 `formatObjectiveProgress`(퍼센트)로.
- **못 한 것**: CH5(클로이 — 리버 밸류·에어·사이징 집계) 실주행, 미션 클리어/보스 격파 컷인(둘 다 max-hands 종료라 미발생),
  파란띠 승급(2막 3챕터 완주 필요), 실기기 영상·BGM 재생 확인은 사용자가 3클립 품질 만족으로 회신.
- **브라우저 자동화 함정(신규)**: 자동화 창은 `visibilityState==='hidden'`이라 **setTimeout 체인이 1분 1회로 스로틀**된다 —
  페이지 안 자동 플레이 루프는 MessageChannel yield(`await new Promise(r=>{const c=new MessageChannel();c.port1.onmessage=r;c.port2.postMessage(0)})`)
  로 대기해야 한다. framer-motion(rAF)도 멈춰 **딜러 버튼 좌표로 포지션을 읽으면 안 된다** — 액션 로그의 첫 프리플랍 액터(=UTG)로
  계산. 히어로 홀카드는 body innerText에서 `(나)` 직전 두 장. 카드/좌석엔 aria-label이 없다. 스크립트 하나가 45초를 넘기면
  CDP 타임아웃(루프는 window에 걸어 두고 짧은 폴링으로 읽기). 결산 리빌·[허브로]는 실제 좌표 클릭.

## 7. 다음 세션 순서

1. 사용자 피드백(§4) → 푸시/배포 지시 확인.
2. 2막 라이브 스텝 실주행(§3 못 한 것) — 헤즈업 라벨 보정이 필요하면 `objectives.ts` + 테스트.
3. 영상 확장: 나머지 보상 CG(백띠 수여·기다림의 뜰·팽팽 보스·아라 승리·파란띠 승급)와 인연 씬 — `story-video-h3.py CLIPS`에 프롬프트 추가, 클립당 ~2분.
   ComfyUI 기동·LM Studio 언로드는 [[reference_comfyui-h3-video]].
4. 3막 데이터(비비안·클로이·엘레나, 가면 봇 identity 분리 선행) 또는 하드 모드. 비비안/엘레나 의상·해설 말투는 3막에서.
