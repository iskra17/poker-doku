# 수련 스토리 — v74 플레이 피드백 4건 + BGM 다양화 세션 인계 (2026-09-03, 4차 세션)

브랜치 `feat/story-polish` (worktree `.worktrees/story-mode`), 커밋 체인 09a935d → … (B1~B6 + 아트/음악 + 문서). 계획:
`C:\Users\JEONG JAE HYEON\.claude\plans\velvet-coalescing-crane.md`, 기획 반영 `docs/spec-story-mode-2026-09.md` **Part U**, 규약 AGENTS.md
(스토리 섹션 "v74 플레이 피드백 4건 반영" bullet + `src/lib/sound/` 항목). **main ff 병합은 이 문서 커밋 직후 실행(태그 `story-polish`), origin 푸시·Fly 배포는 미실행 — 사용자 지시 시.**

## 사용자 피드백 → 반영

| 피드백 | 반영 | 커밋 |
|---|---|---|
| ① 문제 풀이 화면에 보드가 안 남는다 | 레슨 「함께 풀기」가 원인(드릴은 정상). `guided` 블록 `situation` 필수 + 단계 오버라이드, `DrillTableView` 상시 렌더, Ch1~3 5블록 작성, 검증 규칙 | 09a935d |
| ② 보상 CG 다시 보는 곳을 모르겠다 | 「기록실」 모달(인연 씬·이벤트 CG·의상·칭호·배경, NEW 배지) + 로비 헤더 🖼·허브 카드·결산 [기록실 보기], `CgStage layer='modal'`(모달 뒤 깔림 버그) | fbf2f44 |
| ③ 칭호가 리본 하나 | SVG `TitlePlate`(등급 토큰 4·띠 변형·문양 8, xs/sm/lg) + `resolveTitle` 통합, 좌석에서 스토리 칭호 사라지던 버그, 프로필 「내 칭호」 | ae4ea14 |
| ④ 연출 리소스 보강 | 씬 라인 `cg`/`effect` + ScenePlayer, 스토리 컷인(퍼펙트·미션 클리어·보스 격파), 영상 계약(VideoCutscene), 씬 CG 6장·사무실 배경 | 3bcf88f, 2440342, 6f8dcb6 |
| (추가) BGM 한 곡뿐이라 질림 | mood 9종 × 트랙 매니페스트, 자동 순환/선택/미리듣기/[다음 곡], 스토리 mood 배선, 징글 4종 + Suno 10곡·징글 4 배치 | 278a0b2, 57fe455 |

## 검증

- `npx tsc --noEmit` ✓ · `npm run lint` ✓ · 전체 vitest `--maxWorkers=4` **2,403 통과(193 파일)** · `npm run build` ✓.
- 브라우저(자동화 전용 창 — 사용자 탭 스로틀링 문제 없음): 로비 헤더 🎵·🖼 노출, 기록실 모달(칭호 탭 플레이트·배경 탭 3/4 해금·이벤트 CG 3/10) 및 CG 뷰어가 모달 위에 뜸,
  수련 허브 「기록실」 카드, Ch1 프롤로그 첫 라인 씬 CG(도장의 아침) 표시, 「함께 풀기」 상황 패널이 단계·피드백과 무관하게 유지되고 2단계에서 K♦3♣ 표시.
- **미검증(다음 세션 실주행)**: 스토리 컷인(드릴 퍼펙트·스파링 미션 클리어/보스 격파 — 실제 플레이 필요), BGM 순환·[다음 곡]·미리듣기 청취(자동재생 언락 뒤),
  징글 덕킹, 좌석 칭호 플레이트(봇 방 착석), 결산 [기록실 보기] 흐름, 390px 모바일 레이아웃, reduced-motion.

## 리소스 현황

- 아트: `public/assets/story/cg/scene-act1-ch0{1,2,3}-{prologue,epilogue}.webp` 6장 + `bg/dojo-office.webp` (`story-cgs.ts`·`story-backgrounds.ts` 등록). codex 샌드박스가 또 read-only였음 — `generated_images` 회수 절차([[reference_codex-image-gen]]).
- 음악: `public/assets/music/` 총 24MB — 신규 10곡 + `stinger-*.mp3` 4종(Suno, `audiopipe.suno.ai/?item_id=`로 수신, cdn1은 403). 스테이징 `C:\code\claude\poker-doku-art\story-rewards\music\{clips.txt,raw/}`(36클립 원본, 미채택 버전 포함).
  짧은 루프 주의: 긴장 드럼 36s·보스 19s·승급 9s — 질리면 Suno에서 긴 버전 재생성 후 파일만 교체.

## 다음 세션 순서

1. 사용자 지시 시 `git push origin main` + PowerShell `$env:USERPROFILE\.fly\bin\flyctl.exe deploy --ha=false` → healthz·에셋 서빙 확인.
2. 미검증 항목 실주행(위) — 특히 컷인 2종과 BGM 청취(루프 구간 `loopStart/loopEnd` 필요하면 매니페스트에 초 단위로).
3. 영상 파일럿 3클립: ComfyUI portable 설치 → `extra_model_paths.yaml`로 `D:\AI-Image-Video\models`(umt5 fp8 텍스트 인코더·Wan2.1 VAE·clip_vision_h 재사용) → Wan 2.2 I2V-A14B fp8 + lightx2v 4-step LoRA(폴백 TI2V-5B) → 720×1280 81f@16fps → RIFE 24fps → 4초 트림 → ffmpeg VP9 crf32 webm + H.264 crf26 mp4 ≤2.5MB → `public/assets/story/video/<cgId>.{webm,mp4}` + `story-video.ts VIDEO_AVAILABLE`. 대상 id: `story-cg-act1-belt-yellow`, `story-cg-act1-draco-boss`, `sakura-scene-lv5`.
4. 2막 데이터(미션형 목표 + 보상 템플릿), 아라/클로이/비비안/엘레나 의상.

## 함정·교훈

- 레슨 `guided` 블록에 situation을 빠뜨리면 `validateChapters`가 실패한다(act1.test·chapters.test) — 문장에만 보드를 적지 말 것.
- `Modal` 안에서 `CgStage`/`BondSceneModal`/`RewardCutscene`를 열 땐 `layer="modal"` 필수.
- Suno 폼은 JS React setter로 채우는 게 안정적, 한 호출에 4~5곡(CDP 45초). "very short N second" 프롬프트는 클립이 생성되지만 "Credits Refunded" 표시.
- 씬 CG 첫 캡처가 반투명하게 보이면 StoryStage/CgStage 페이드 애니메이션 중 — 2~3초 뒤 다시 캡처.
