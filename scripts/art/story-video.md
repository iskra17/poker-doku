# 컷신 영상(앰비언트 루프) 제작 절차 — MiniMax H3 fl2va (2026-09-03 파일럿)

CG 한 장 → 4.4초 무음 루프 영상. 첫 프레임 = 끝 프레임 = CG라서 `<video loop>`에서 이음새가 없다.
로컬 RTX 5090 + ComfyUI(Codex가 2026-08에 구축한 `C:\code\1. codex\AI-Image-Video\ComfyUI_windows_portable`, v0.34.0)로 만든다.
Wan 2.2 I2V 다운로드는 필요 없다 — 이미 설치된 **MiniMax H3**(`MiniMaxH3ImageToVideo`의 `first_frame`/`last_frame` 옵션)를 쓴다.

## 환경

- ComfyUI 포터블: `C:\code\1. codex\AI-Image-Video\ComfyUI_windows_portable` (python_embeded 3.13, torch 2.13+cu130)
- 모델: 포터블 `ComfyUI/models/` 안의 H3 5종(`minimax_h3_fl2va_pruned_int8_convrot` 21GB · `qwen3vl_32b_minimax_h3_nvfp4_awq` 15.7GB ·
  video VAE fp16 · audio VAE fp32 · `minimax_h3_fl2v_turbo_8step_v1.0` LoRA). D:\AI-Image-Video\models(Wan Animate 2·SDXL)는
  `extra_model_paths.yaml`로 함께 잡힌다.
- 기동(백그라운드, 입력·출력은 D 드라이브):

  ```powershell
  Start-Process -FilePath 'C:\code\1. codex\AI-Image-Video\ComfyUI_windows_portable\python_embeded\python.exe' `
    -ArgumentList '-s','ComfyUI\main.py','--windows-standalone-build','--input-directory','D:\AI-Image-Video\input','--output-directory','D:\AI-Image-Video\output','--temp-directory','D:\AI-Image-Video\temp' `
    -WorkingDirectory 'C:\code\1. codex\AI-Image-Video\ComfyUI_windows_portable' -WindowStyle Hidden
  # 준비 확인: curl http://127.0.0.1:8188/system_stats
  ```

  LM Studio가 모델을 VRAM에 올려 두었으면 먼저 언로드한다(H3는 피크 ~28GB).

## 절차

1. **입력 준비** — 리포의 CG webp를 PNG로 `D:\AI-Image-Video\input\pd-<cgId>.png`에 둔다(LoadImage는 input 최상위 파일만 목록에 올린다).
   `node -e "require('sharp')('public/assets/story/cg/act1-belt-yellow.webp').png().toFile('D:/AI-Image-Video/input/pd-story-cg-act1-belt-yellow.png')"`
2. **생성** — `scripts/art/story-video-h3.py`의 `CLIPS`에 `cgId: {seed, prompt}`를 추가하고 실행:
   `python scripts/art/story-video-h3.py v1 <cgId> [...]` (API `/prompt` 제출 → `/history` 폴링, 클립당 약 100초).
   출력: `D:\AI-Image-Video\output\poker-doku\<cgId>-v1_00001_.mp4` (768×1152·24fps·107프레임·H.264 crf14) + 제출 JSON.
   - 해상도 768×1152 = CG 원본(H3 네이티브 캔버스 768 짧은 변, 32 배수). 길이 107 = 17k+5 그리드(90=3.75s·107=4.46s·124=5.17s).
   - 프롬프트 규칙: 고정 카메라·줌/팬 금지, "start and end on the exact same frame", 대사·자막 금지, 캐릭터 외형을 한 문장으로
     다시 묘사(머리색·의상·소품), 움직임은 "subtle ambient motion only"로 꽃잎·머리카락·불꽃·눈 깜빡임 같은 미세 요소만 열거.
   - 검수: `ffmpeg -i <mp4> -vf "select='not(mod(n,21))',scale=384:-1,tile=6x1" -frames:v 1 sheet.jpg`로 6프레임 시트를 보고
     얼굴·의상이 유지되는지, 첫/끝 프레임이 같은지 확인한다. 흔들리면 seed만 바꿔 재생성(한 번에 한 요소만 조정).
3. **웹 인코딩** — 마지막 프레임(=첫 프레임 복제)을 버리고 106프레임으로 자른다:

   ```bash
   ffmpeg -i in.mp4 -frames:v 106 -an -c:v libvpx-vp9 -crf 32 -b:v 0 -row-mt 1 -deadline good -cpu-used 2 -pix_fmt yuv420p public/assets/story/video/<cgId>.webm
   ffmpeg -i in.mp4 -frames:v 106 -an -c:v libx264 -crf 26 -preset slow -pix_fmt yuv420p -movflags +faststart public/assets/story/video/<cgId>.mp4
   ```

   파일럿 결과 0.5~1.4MB(상한 2.5MB).
4. **등록** — `src/lib/assets/story-video.ts`의 `VIDEO_AVAILABLE`에 id 한 줄. 보상 CG는 카탈로그 아이템 id(`story-cg-…`),
   인연 씬은 `<character>-scene-lv<N>`. `RewardCutscene`·`BondSceneModal`·기록실 뷰어가 같은 매니페스트를 읽는다.
5. **확인** — 결산/기록실에서 CG 스테이지에 `<video>`가 뜨는지. 자동화 창처럼 문서가 `hidden`이면 Chrome이 무음 영상을 정지시키므로
   readyState·src만 보고 판단하지 말고 포그라운드 탭에서 재생을 본다.

## 파일럿 기록 (2026-09-03)

| id | seed | 생성 | webm / mp4 |
|---|---|---|---|
| story-cg-act1-belt-yellow | 509020260901 | 106초 | 0.73MB / 0.49MB |
| story-cg-act1-draco-boss | 509020260902 | 95초 | 1.10MB / 0.66MB |
| sakura-scene-lv5 | 509020260903 | 110초 | 1.43MB / 0.86MB |

## 2차 배치 기록 (2026-09-04) — 보상 CG 5 + 비비안 Lv5

| id | seed | 생성 | webm / mp4 |
|---|---|---|---|
| story-cg-act1-belt-white | 509020260904 | 105초 | 0.80MB / 0.50MB |
| story-cg-act1-sakura-garden | 509020260905 | 95초 | 1.13MB / 0.71MB |
| story-cg-act2-paeng-boss | 509020260906 | 105초 | 1.04MB / 0.68MB |
| story-cg-act2-ara-victory | 509020260907 | 95초 | 1.94MB / 1.02MB (칩이 많이 날려 가장 큼) |
| story-cg-act2-belt-blue | 509020260908 | 95초 | 0.81MB / 0.54MB |
| vivian-scene-lv5 | 509020260909 | 100초 | 0.90MB / 0.61MB |

- 인코딩은 `bash scripts/art/story-video-encode.sh v1 <cgId> [...]`(webm/mp4 동시, 106프레임)로 일괄.
- **러너 실행은 분리 프로세스로**: 에이전트 도구의 백그라운드 명령은 10분에 강제 종료되므로 6클립(≈10분)을 한 호출에 걸면 끊긴다 —
  PowerShell `Start-Process python … -RedirectStandardOutput <log>`로 띄우고 로그를 폴링한다. 러너는 폴링 예외를 삼키고 30초마다
  진행을 찍으며 900초를 넘기면 그 클립을 포기한다(2026-09-04 보강).
- 남은 것: 인연 씬 22장(사쿠라 Lv5·비비안 Lv5 외), 챕터 프롤로그/에필로그 씬 CG 12장. 같은 절차로 `CLIPS`에 프롬프트만 추가.

원본 mp4·제출 JSON은 `D:\AI-Image-Video\output\poker-doku\`에 보관(리포 밖). Wan Animate 2(구동 영상 모션 전이)는 CG 애니메이션엔
맞지 않아 쓰지 않았다 — 캐릭터가 춤추는 류의 클립이 필요해지면 `C:\code\1. codex\AI-Image-Video\scripts\run-chika-full-12fps-rife.ps1`
(12fps 생성 → RIFE 2배) 참고.
