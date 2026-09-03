# 오케스트레이션 인계 — Claude(Fable 5.1) → GPT 5.6 sol (2026-09-04)

이 문서는 작업 주도권이 GPT 5.6 sol(Codex CLI)로 넘어가는 시점의 인계다. 코드 규약은 `AGENTS.md`(Codex도 읽는다)가 단일 소스이고,
여기에는 **AGENTS.md에 없는 것** — 사용자 방침, 환경·도구 절차, Claude 메모리에만 있던 사실, 현재 상태와 다음 순서 — 를 모았다.

## 0. 현재 상태

| 항목 | 상태 |
|---|---|
| main | `4954439` = origin/main(푸시 완료) — 영상 3차 배치 + 아라 Lv15 CG 보정까지 |
| 배포 | Fly **v82** = `4954439`(2026-09-04, 아라 Lv15 보정 포함). 머신 `48ed666a50d2e8`(nrt, 1대 고정), https://poker-doku.fly.dev |
| 최신 작업 | 수련 스토리 모드 1·2막(Ch1~6) 완성, 보상·연출·BGM·운영자 모드, **컷신 영상 43클립 전부 배치**, CH4~6 스파링 실주행 완료 |
| 직전 인계 | `docs/superpowers/handoffs/2026-09-04-video-batch3-ch5-handoff.md`(8차) ← `2026-09-04-operator-video-handoff.md`(7차) ← `2026-09-03-act2-video-handoff.md`(5차). 셋 다 유효 |
| 기획서 | `docs/spec-story-mode-2026-09.md`(Part A~V), `docs/spec-mtt-2026-07-23.md` |
| 워크트리 | `.worktrees/story-mode`(main과 동일 커밋, `npm ci` 완료) — 스토리 작업은 여기서 브랜치를 따서 진행 |

## 1. 사용자 방침 (Claude 메모리 `feedback_*`에서 옮김 — 반드시 지킬 것)

1. **모든 소통은 한국어**. 코드·주석·커밋 제목은 영문 관례(`feat:`/`fix:`/`docs:` + 한국어 본문 OK — 최근 커밋 참고).
2. **worktree 워크플로가 기본**: 별도 브랜치/worktree → 구현·검증(tsc·lint·vitest) → worktree에서 커밋 → 충돌 확인 후 main ff 병합. 세션을 병렬로 돌리므로 main 직접 작업 금지.
3. **배치마다 커밋**: 한 기능/수정 배치가 검증을 통과하면 묻지 말고 바로 커밋. **push·deploy는 사용자가 지시할 때만**(미푸시 커밋이 쌓이면 백업 공백을 가볍게 상기).
4. **메모리 크래시 방지**: 동시 서브에이전트 ≤2, vitest는 단일 파일 위주, 전체 스위트는 `npx vitest run --maxWorkers=4` 1회(약 56초, 현재 196파일/2451 통과). 테스트는 최소·결과 위주.
5. **포커 용어는 원어**(핸드·폴드·콜·레이즈·림프·3벳·팟·쇼다운·포지션) — 번역 금지(AGENTS.md 컨벤션).
6. 아트는 gpt-image-2(Codex 내장 image_gen), 음악은 Suno(계정 iskra17 Pro, 자유 사용 OK), 효과음은 Web Audio 합성 유지. 한 곡 반복은 질림 → 장면당 여러 트랙.
7. 사용자는 실기기(데스크톱 Chrome·모바일)로 직접 플레이하며 피드백을 준다 — 연출·영상·BGM은 시트/DOM 검증 후 **사용자 실기기 확인 항목**으로 넘긴다.

## 2. Claude 메모리 — 그대로 읽을 수 있다

Claude가 쓰던 메모리는 평문 마크다운이다. 인덱스 `C:\Users\JEONG JAE HYEON\.claude\projects\C--code-claude-poker-doku\memory\MEMORY.md`,
각 항목은 같은 폴더의 `*.md`. 특히: `project_deployment.md`(Fly 이력·함정), `reference_codex-image-gen.md`(이미지 생성 함정),
`reference_comfyui-h3-video.md`(영상), `reference_browser-qa-recipe.md`(QA), `reference_suno-music-gen.md`(BGM), `project_story-mode-plan.md`(스토리 이력),
`project_operator-mode.md`. 기획 원문은 `C:\Users\JEONG JAE HYEON\.claude\plans\staged-bouncing-backus.md`(= 리포 spec과 동일).
`reference_gemini-api-key.md`에는 키가 있으니 **어떤 문서·커밋에도 옮기지 말 것**.

## 3. 환경·실행

- 리포 `C:\code\claude\poker-doku`(main), 워크트리 `.worktrees/story-mode` 외 여러 개(`git worktree list`). 아트 스테이징 `C:\code\claude\poker-doku-art\story-rewards\{ref,out,prompts,logs,codex-home}`(리포 밖).
- dev 서버: `npm run dev`(tsx 커스텀 서버, :3000) — **서버 코드(챕터 데이터·objectives 등) 변경 후 재시작 필요**(tsx는 watch 아님). 준비 확인 `curl localhost:3000/healthz`. 끝나면 3000 리스너 종료.
  워크트리에서 dev 서버가 되는 건 `.worktrees/story-mode`뿐(node_modules 설치됨) — 다른 워크트리는 Turbopack이 junction을 거부한다.
- DB는 SQLite `data/poker-doku.sqlite`(워크트리별 별도). 마이그레이션 최신 v33 — 버전 올리면 `database.test.ts`·`arena-legacy-season-upgrade.test.ts` 상수도.
- 검증 3종: `npx tsc --noEmit` · `npm run lint` · `npx vitest run <파일>`.
- 긴 작업(영상 생성·배포)은 에이전트 도구의 시간 상한에 걸리지 않게 **분리 프로세스**(PowerShell `Start-Process … -RedirectStandardOutput <log>`)로 띄우고 로그를 폴링한다.

## 4. QA 절차 (브라우저)

- 신규 유저 격리: `http://127.0.0.N:3000`(N을 바꾸면 새 프로필, 쿠키는 포트 무시). `next.config.ts allowedDevOrigins`에 `127.0.0.*` 있음. 기존 테스트 프로필: 127.0.0.10 = 노을부엉이#9320(1막·CH5·CH6 완료, 운영자 ON).
- **운영자 모드**(AGENTS.md 「운영자 모드」): dev에선 전원 운영자 → 로비 로고 7연타 → OP 배지 → 잠긴 챕터 시작, [⏭ 스킵]으로 씬·레슨·드릴·연습 통과, 스파링만 실제 플레이. 스킵도 실제 보상 지급 경로(테스트 프로필로).
- 프로덕션 운영자: `OPERATOR_PROFILE_IDS` 시크릿 = 새벽참새#4125(`p_lQCfPcv1YEaXnchwdId2SA`), 여름토끼#9490(`p_OT35-SxJ6nzJAVEGdO8l2A`).
- Claude는 Chrome 확장(claude-in-chrome)으로 자동화했다 — GPT는 자체 브라우저 도구/Playwright를 쓰면 된다. 도구와 무관한 요령:
  - 게임 상태는 DOM 파싱 대신 **React fiber에서 zustand 스냅샷**: `document`의 `__reactContainer$*` → `hostRoot.stateNode.current` DFS로 `type.name==='ActionBar'` fiber →
    `memoizedState` 훅 체인에서 `gameState`·`sendAction`을 가진 객체. `sendAction('raise', 총액)`은 raise-to. 매 폴링마다 fiber를 다시 찾는다(페이지 리로드 시 재정의).
  - 창이 hidden이면 setTimeout이 1분 1회로 스로틀 → 페이지 안 루프는 Web Worker 타이머로 대기. framer-motion 종료 애니메이션이 얼어 닫힌 모달이 DOM에 남으니
    닫힘·컷인 판정은 텍스트/이벤트 기준으로, 필요하면 리로드.
  - 결산 리빌·[허브로]·[다시 도전]은 실제 좌표 클릭(synthetic click 무시). 라이브 스텝 턴 타이머 60초 → 타임아웃이면 hold(계속하기)로 복귀.
  - 스파링 자동 플레이 정책과 루프 코드는 8차 인계 §4(재현 가능).
- 로비 카드 상태는 스테일(방 구성 변경에만 갱신) — 핸드 타이밍은 서버 stdout `[evt]`(hand-start/hand-end/story-step) 기준.

## 5. 배포 (Fly.io)

- flyctl `%USERPROFILE%\.fly\bin\flyctl.exe`(PowerShell에서 `flyctl`, `fly` 별칭 없음). 명령은 **`fly deploy --ha=false`**(2대가 되면 인메모리 방이 쪼개진다). 원격 빌더, 빌드 컨텍스트 ~114MB(영상 포함), 이미지 ~300MB, 약 6분. 배포는 분리 프로세스+로그 폴링.
- 절대 금지: `auto_stop_machines` on, `scale count` 2 이상. 재시작 = 인메모리 방 소멸 → 한가한 시간대. healthz는 시작 복구 전 잠깐 503(정상), 이후 `fly status` 1/1 passing + `curl https://poker-doku.fly.dev/healthz` 200 확인.
- 시크릿: `GEMINI_API_KEY`(fight club 공유 키 — 429 잦으면 전용 키로 교체 절차는 `project_deployment.md`), `BACKUP_ENCRYPTION_KEY`(값 아무도 모름), `OPERATOR_PROFILE_IDS`, `DEBUG_LOG_TOKEN`. 변경은 `fly secrets set … --stage` 후 배포 때 적용.
- 볼륨 `poker_doku_data`(/data, SQLite+암호화 백업). 예산 상한 월 $20.
- 운영 조회: `/admin`(DEBUG_LOG_TOKEN 로그인), `fly logs --no-tail`(사용자 ID는 별명 태그로 필터).

## 6. 아트·영상 파이프라인

- **이미지(gpt-image-2)**: 스테이징에서 `CODEX_HOME=<스테이징>/codex-home codex exec --skip-git-repo-check --sandbox workspace-write -m gpt-5.5 "$(cat prompts/x.txt)" </dev/null`.
  프롬프트 맨 앞에 비인터랙티브 지시, 레퍼런스는 `./ref/*.png`를 view_image로 보게 하고, 저장 경로 명시 + 크기 출력 지시. `--sandbox workspace-write` 없으면 저장이 막힌다(회수는 `codex-home/generated_images/<세션>/call_*.png` 매핑).
  기존 CG 보정은 **edit 모드**(비비안 Lv5 목 보정·아라 Lv15 꼬치 그립이 선례 — `prompts/fix-*.txt`, `run-fix-*.sh`). 후처리 `node scripts/art/convert.mjs {bg|cg|bust|check}`.
  규격: 배경 1280, CG 768×1152(`public/assets/story/cg`, 인연 씬은 `public/assets/characters/<id>/scene-lv<N>.webp`), 버스트 512² 크로마키. 매니페스트 등록 필수(`story-backgrounds.ts`·`story-cgs.ts`·`character-art.ts`).
- **영상(MiniMax H3, 로컬 ComfyUI)**: 절차·프롬프트·배치 기록 전부 `scripts/art/story-video.md`. CG 한 장 → 4.4초 루프(첫=끝 프레임). 러너 `scripts/art/story-video-h3.py`(`H3_SEED_OFFSET`로 재생성), 인코딩 `story-video-encode.sh`, 등록 `story-video.ts VIDEO_AVAILABLE`(보상 CG=아이템 id, 인연 씬=`<id>-scene-lv<N>`, 씬 CG=`scene-<SceneCgId>`).
  CG를 고치면 영상도 다시 만들어야 한다(첫 프레임이 CG). 검수는 6프레임 시트. ComfyUI 기동/종료 명령은 story-video.md 「환경」.
- **BGM(Suno)**: `reference_suno-music-gen.md` 절차 → `public/assets/music/<id>.mp3` + `music-library.ts MUSIC_TRACKS` 한 줄. 징글은 `stinger-*.mp3`.

## 7. 다음 순서 (우선순위)

1. **아라 Lv15 「야시장」 CG 보정 — 완료(브랜치 `fix/ara-lv15-skewer` → main)**: 사용자 지적(꼬치를 고기 부분이 아니라 손잡이를 쥐게)으로 gpt-image-2 edit 모드 2라운드(6안) 중 b3 채택 → `public/assets/characters/ara/scene-lv15.webp` 교체 → `H3_SEED_OFFSET=2000 v3`로 영상 재생성·인코딩 → **Fly v82 배포 완료**. 후보 원본은 `poker-doku-art/story-rewards/out/fix/ara-scene-lv15-{a,b}{1,2,3}.png`(다른 안을 원하면 교체).
2. 사용자 실기기 피드백 반영: 영상 43클립 재생·씬 플레이어 라인 CG 전환·BGM.
3. CH6 보스 격파 컷인 설계 판단(8차 인계 §2-3 — 프리미엄 3벳 "기회"가 거의 안 와 컷인이 사실상 안 뜬다). 파란띠 승급 연출 실주행(2막 3챕터 완주 프로필 필요).
4. 3막 데이터(비비안·클로이·엘레나 담당, 가면 봇 identity 분리 선행, 비비안/엘레나 의상·해설 말투), 하드 모드, 실패 씬(`failScene`) 재생, 라이브 리딩 퀴즈·봇 속마음(Ch7). 미구현 목록은 AGENTS.md 「미구현」.
5. 스토리 XP로 넘긴 레벨의 카탈로그 아이템 미지급(v13 뷰 확장) — 알려진 범위.

## 8. 세션 종료 체크리스트

- 3000(dev)·8188(ComfyUI) 리스너 종료, 러너 프로세스 없음, 브라우저 자동화 탭 닫기.
- 커밋은 남기되 push/deploy는 지시 없으면 하지 않는다. 인계 문서는 `docs/superpowers/handoffs/<날짜>-<주제>-handoff.md`에 "현재 상태 표 → 한 것 → 못 한 것 → 다음 순서" 형식으로.
