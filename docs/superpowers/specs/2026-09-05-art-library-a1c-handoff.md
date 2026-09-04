# A1c 준비 상태 인계 — 생성 전

2026-09-05 07:57 KST 기준. **모델 다운로드 진행 중, 실제 이미지 생성 0장**이다.
최초4장의 준비와 가드 검증만 끝났으며, 총괄 요청에 따라 다운로드를 유지하고 작업자를 idle로 돌린다.
`models_verified=false`, 4개 job 모두 `planned`, 게임 export/승인 자산 없음.

## 현재 프로세스와 경로

- 단일 Range downloader PID **55488** (hidden). 다른 downloader를 추가하지 않는다.
- ComfyUI PID **57828**, `http://127.0.0.1:8188`, 현재 queue empty. GPU는 아트 작업 전용.
- 출력 루트: `D:/AI-Image-Video/output/poker-doku-library/a1c-20260905/`.
- 다운로드 로그: 위 루트의 `download.stdout.log`, `download.stderr.log`.
- 완료 검증 원장: `D:/AI-Image-Video/models/.downloads/poker-doku-qwen-edit-2511.json`.
  **4개 artifact의 VERIFIED 행/실파일 hash 확인 전에는 생성하지 않는다.**
- 고정 다운로드 계획: 같은 `.downloads/`의 `poker-doku-qwen-edit-2511-download-plan.json`.
- downloader 배타 lock: 같은 `.downloads/`의 `poker-doku-qwen-edit-download.lock`.

07:57 관측값: diffusion model **13,760,721,442 / 20,499,083,824 bytes**.
이후 encoder 9,384,670,680 bytes와 VAE/LoRA 순서로 이어진다. 원장은 각각의 완성·SHA 검증 뒤 갱신된다.
다운로드 속도는 대략 17~18MB/s이며, 총괄에게 약15분 추가 소요 가능성을 보고했다.

## 다운로드 전환 근거

이전 `download-art-models.py` PID58604가 새 partial 0byte 상태로 수분간 관측됐다.
설치된 huggingface_hub는 재시작마다 UUID 임시파일을 만들며 기존 partial을 이어받지 않는 구현이다.
총괄 승인 후 이 작업의 downloader만 종료하고, 기존 Xet partial 9,868,407,330 bytes의
offset0 / 1GiB / EOF-4096에서 공식 pinned URL Range 4KiB를 비교했다. 3개 모두 HTTP206,
정확한 Content-Range 및 로컬 바이트 일치를 확인했다. 현재 helper는 그 partial 뒤에 이어 쓴다.
최종 파일 전체 SHA-256이 일치해야만 모델 최종 경로로 rename한다.

이전 `.5de09d25.incomplete`도 전환 시점 최종 약1.65GB가 남았으며 보존했다.
기존 partial의 임의 삭제/모델 덮어쓰기/큰 파일 동시 다운로드는 하지 않는다.
Range 응답 offset·end·total이 다르면 즉시 중단, 네트워크 예외는 최대2회 재시도한다.
중단 후 helper 재시작은 동일 plan의 partial size부터 이어받지만, 살아 있는 PID/lock을 먼저 확인해야 한다.

## 준비된 첫4장

| job ID | seed | 의도 |
|---|---:|---|
| sakura-garden-tea-q1 | 509020261300 | 오른쪽 옆얼굴, 찻잔 아래 시선 |
| sakura-table-review-q1 | 509020261301 | 왼쪽 어깨 너머, 노트에 내린 시선 |
| elena-snow-window-q1 | 509020261302 | 왼쪽 창문 앞 옆얼굴, 창밖 눈 시선 |
| elena-analysis-q1 | 509020261303 | 왼쪽 3/4 측면, 칩 분석 시선 |

육안 확인한 각 캐릭터의 `public/assets/characters/<id>/showcase.webp` 전체(640×960)를
중성 회색 배경에 alpha 합성한 입력을 사용한다. 원본 crop/retouch 없이 인물·의상 전체를 전달한다.
기본 의상색·머리·눈·장신구·화풍 보존을 prompt에 명시하고 엘레나의 성숙한 눈/턱 비율도 명시했다.
입력은 `D:/AI-Image-Video/input/poker-doku-a1c-20260905/`.

레시피 근거: [공식 Qwen-Image-Edit-2511 문서](https://docs.comfy.org/tutorials/image/qwen/qwen-image-edit-2511)와
설치된 `comfyui_workflow_templates_json/templates/image_qwen_image_edit_2511_int8.json`.
공식 template은 출력 폴더 `official-int8-template.json`에 복사했고 hash를 manifest에 기록했다.
API graph는 template의 turbo switch를 true로 고정해 평탄화했다:
UNET int8 → AuraFlow shift3.1 → CFGNorm1 → Lightning LoRA1,
Qwen2.5VL image edit conditioning + 원본 VAE latent → 4 steps / Euler / simple / CFG1 / denoise1.
공식 FluxKontextImageScale에 따라 예상 출력은 832×1248이다.

## 준비 코드와 재개 명령

전용 worktree: `C:/code/claude/poker-doku/.worktrees/art-library-pilot`.
Python: `C:/code/1. codex/AI-Image-Video/ComfyUI_windows_portable/python_embeded/python.exe`.

- `scripts/art/poker-doku-library-qwen.py`: prepare / run / sheets. **prepare는 이미 완료, 다시 실행하지 않는다.**
- `scripts/art/workflows/poker-doku-qwen-edit-2511.json`: 실행할 고정 API graph.
- `scripts/art/poker-doku-library-qwen-manifest.json`: 첫4장 원장, 현재 전부 planned.
- `scripts/art/poker-doku-library-qwen-download.py`: 현재 진행 중인 단일 downloader.
- `scripts/art/poker-doku-library-qwen-test.py`, `poker-doku-library-qwen-download-test.py`: 가드 테스트.

다운로드 원장의 4개 verified artifact가 모두 준비되면:

```powershell
& 'C:/code/1. codex/AI-Image-Video/ComfyUI_windows_portable/python_embeded/python.exe' scripts/art/poker-doku-library-qwen.py run
& 'C:/code/1. codex/AI-Image-Video/ComfyUI_windows_portable/python_embeded/python.exe' scripts/art/poker-doku-library-qwen.py sheets
```

`run`은 모델 실파일 hash 4개를 다시 계산하고 정본/입력/workflow hash와 빈 큐를 확인한 뒤 제출한다.
순차4장 실행 동안 각 `.gpu.json`에 nvidia-smi의 전체GPU used/free/util/temp 표본을 2초 간격으로 기록한다.
각 job은 생성 초·peak GPU used MiB·prompt ID·출력 SHA를 보존한다. 메모리 표본은 데스크톱 사용량을
포함하며 모델 단독 VRAM과 구분한다.

`initial-four-contact.jpg`, `sakura-reference-compare.jpg`, `elena-reference-compare.jpg`와
전체 PNG를 총괄에게 즉시 전달한다. **첫4장 총괄 검수 전에는 5번째 제출 금지**다.
현재 runner는 초기4개 ID만 허용하므로, manifest에 다른 job을 추가해도 거절한다.
후속 승인이 있으면 총16상한 내 별도 명시 계획으로 확장해야 한다.

## 검증 상태

- 다운로드 Range/경로 가드 3 tests 통과.
- 초기4장/다른큐/불확실제출/출력분리 가드 4 tests 통과.
- 모든 API node의 required/optional 입력명을 현재 object_info에 대조해 통과.
- 원본 및 가공 입력 SHA-256 일치, queue empty 확인.
- 모델 로드/실제 생성/메모리 실측/화질 판정은 **아직 하지 않았다**.
- ComfyUI·기존 main 프로젝트 설정이나 모델을 덮어쓰지 않았다. A1/A1b 결과를 보존했다.
