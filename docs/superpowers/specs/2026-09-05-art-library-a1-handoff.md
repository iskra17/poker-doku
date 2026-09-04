# A1 일반 아트 파일럿 결과 및 인계

2026-09-05. 작업 브랜치 `feat/art-library-pilot`, 전용 worktree
`C:/code/claude/poker-doku/.worktrees/art-library-pilot`.

## 결과

최초 24후보와 총괄이 추가 승인한 보정 12후보를 로컬 RTX 5090에서 생성하고 모두 컨택트시트로
검수했다. **양산 품질 게이트는 미통과, export 승인 0장**이다. 기존 정본·게임 코드·public 자산은
변경하지 않았다. A2 영속 워커, 영상, 새 모델 다운로드, LoRA, push/deploy는 수행하지 않았다.

| 배치 | 수량 | 실측 제출~결과 합계 | 중앙값 | 범위 |
|---|---:|---:|---:|---:|
| A1 | 24 | 239.66초 | 10.065초 | 8.04~16.07초 |
| A1b 보정 | 12 | 118.63초 | 10.045초 | 8.11~10.06초 |
| 합계 | 36 | 358.29초 | — | — |

위 시간은 순차 작업의 제출~결과 폴링 시간 합계다. 순수 GPU 커널 시간이나 사람이 검수한 시간을
포함한 프로젝트 총시간으로 오인하지 않는다. 콜드 체크포인트 로드가 포함된 첫 장은 16.07초였다.
36개 PNG 모두 832×1216 디코딩 성공, 기록 SHA-256 일치, 정확한 파일 중복 0개다.
같은 장면의 강도 비교 두 장은 같은 seed를 쓰므로 구도가 유사하며, 36개 독립 구도라는 뜻이 아니다.

## 결과 경로

모든 원본은 `D:/AI-Image-Video/output/poker-doku-library/` 아래에 있다.

- `a1-20260905/sakura-contact.jpg`, `a1-20260905/elena-contact.jpg`: 각 12장.
- `a1b-20260905/sakura-contact.jpg`, `a1b-20260905/elena-contact.jpg`: 각 보정 6장.
- 각 폴더의 `manifest.json`, `audit.json`, `review.json`, 개별 `.prompt.json`/`.history.json`과 PNG.
- `a1b-20260905/parent-manifest.json`: A1b 생성 시점의 A1 원장 스냅샷. parent hash 대조용.
- `system-stats.json`, `node-info.json`, 배치 stdout/stderr, ComfyUI 로그는 로컬 실행 환경 근거.

저장소에는 제작규약 `scripts/art/poker-doku-library.md`, 단발 runner, 보정 runner, API workflow 2개,
완료 manifest 2개, 검수표 `poker-doku-library-review.json`, 가드 테스트만 추가했다.
미검수 원본이나 선정 후보를 `public/`에 내보내지 않는다.

## 검수 판단

얼굴 유사성과 요청한 동작/시선은 별도 조건이다. 실패한 동작을 다른 장면 이름으로 바꾸어
성공으로 집계하지 않았다. 의상색이 달라진 그림은 기본 의상 재현으로 평가하지 않는다.

| 캐릭터·장면 | 유효한 변화 | 남은 문제 / 판정 |
|---|---|---|
| 사쿠라 카드정리 | A1b cream 색·카드 위 양팔 회복 | 손가락, 리본 누락, 정면 근접. 보류 |
| 사쿠라 정원 산책 | A1 c1 뒤돌아보기·전신 | 카메라 시선, 핑크 의상·장식 증식. 비교 후보 |
| 사쿠라 정원 차 | A1 c1 옆얼굴·찻잔 | 핑크 카디건·장식 변화. 비교 후보 |
| 사쿠라 결의 | cream 색 보정 | A1/A1b 모두 정면 응시, 보정은 머리 형태도 이상. 거절 |
| 사쿠라 어깨너머 복기 | A1b b2 어깨너머 복구 | 노트를 안 보고 돌아봄. 보류 |
| 사쿠라 강변 산책 | A1 c2 걷기·전신·환경 | 좌우 방향 반대, 의상 변화. 부분 성공 |
| 엘레나 창밖 | A1b b1 창밖을 향한 옆얼굴 | 원본보다 어려진 눈/턱. 비교 후보 |
| 엘레나 차 | A1 c2 옆얼굴·컵 시선 | 성숙한 얼굴 비율, 비 오는 환경 미반영. 비교 후보 |
| 엘레나 코트 | A1b b1 뒤돌기·코트 뒷모습 | 이미 입은 코트, 손이 깃을 잡지 않음. 보류 |
| 엘레나 분석 | A1b b1 측면·칩 시선 | 보정 prompt의 두 손은 지키지 않고 턱 괴기. 정본/소품 재검수 후보 |
| 엘레나 미소 | 미소 자체 | 카메라 응시·어려진 얼굴. 거절 |
| 엘레나 밤 정원 | A1 c1 옆얼굴·손짓·밤 환경 | 성숙한 얼굴과 손 최종 검수. 비교 후보 |

`review_candidate`는 사람에게 비교용으로 제안하는 상태이며 `approved`가 아니다. 사쿠라는
6장면 중 4장면의 방향·동작 충족 기준에 못 미치므로 전체 양산 게이트를 통과시키지 않았다.
엘레나의 정본은 길고 날카로운 눈매·성숙한 턱선인데 생성에서는 눈이 커지고 턱이 짧아지는
경향이 있다. 은발·정장·귀걸이가 남았다는 이유만으로 동일성 합격으로 간주하지 않는다.

## 재현 정보

- ComfyUI 0.34.0 / commit `12d5279438bfefc058a269eae805ceab6047777f`.
- IPAdapter commit `a0f451a5113cf9becb0847b92884cb10cbdec0ef`.
- Python 3.13.14, torch 2.13.0+cu130, RTX 5090 32GB, GPU 워커 1개.
- Animagine XL 4.0 opt SHA-256: `6327eca98bfb6538dd7a4edce22484a1bbc57a8cff6b11d075d40da1afb847ac`.
- IPAdapter Plus Face SDXL: `677ad8860204f7d0bfba12d29e6c31ded9beefdf3e4bbd102518357d31a292c1`.
- OpenPose SDXL: `b8524e557a7df60d081f5d4a0eb109967d107df217943bf88c2d99b9ebcc06c5`.
- 사쿠라 정본 SHA-256: `3fd5c4d89cc2f905d237680abc2c5823393d4103940d48d864a3263901bbbe47`.
- 엘레나 정본 SHA-256: `989caf3fbde29a36b65f65575aacecd3db4c4b8c0d0cdd0a2b85c14a9e29ca5f`.
- A1 seed: 사쿠라 `509020260950..955`, 엘레나 `509020261050..1055`.
  A1b seed `509020261200..1205`; 각 scene 두 후보는 동일 seed.
- 기타 모델/얼굴크롭/포즈/prompt/결과 hash는 manifest에 모두 기록했다.

A1은 얼굴 강도 0.35/0.55/0.75 세 값의 쌍 비교. A1b는 얼굴 강도 0.20/0.35와 적용 시작 지연,
강한 포즈, 팔좌표, 장면 우선 prompt를 함께 조정했다. 보정 원인의 개별 인과는 분리 검증하지 않았다.

## 검증·종료 상태

가드 unittest 4개: 24장/고유 ID, 비신규 작업 재제출 금지, 다른 큐 점유 시 거절,
미확정·실패 원장 수동 대조 전 재실행 금지. 구현 전 실패→구현 후 통과 확인.
세 Python 파일 구문 검사, JSON 파싱, 36개 디코딩/규격/hash 검사, 원본 hash 유지 확인.
게임 코드가 바뀌지 않아 전체 Vitest/Next build는 실행하지 않았다.

처음 GPU 유휴(1.8GB/1%) 및 ComfyUI 없음 확인 뒤 hidden PID 57828을 기동했다.
다른 앱을 종료하지 않았다. 두 배치 종료 후 큐가 비었음을 확인하고 `/free`로 모델/메모리를
해제했다(VRAM 약 2.6GB, GPU 4% 표시). ComfyUI는 localhost 유휴 서비스로만 남아 있고
생성 runner는 종료됐다. 무기한 생산이나 Windows 자동 시작 설정은 없다.

다음 품질 작업은 실제 검수된 비정면 정본과 손/소품 접촉을 제어하는 포즈 입력이 우선이다.
얼굴 강도만 높이거나 이 설정으로 대량 생성하지 않는다. 추가 배치·A2 실행은 총괄의 별도 범위다.

## 설치된 대체 모델·기존 편집 레시피 읽기 전용 조사

종료 시 D 드라이브 모델 트리와 ComfyUI 포터블 모델 트리 및 `extra_model_paths.yaml`을
대조했다. **확인한 정지 이미지 checkpoint는 Animagine XL 4.0 opt 한 개뿐**이다.
별도 FLUX, Qwen-Image/Edit checkpoint, diffusers 이미지 편집 모델은 해당 등록 경로에서
발견되지 않았다. 시스템 전체의 모든 다른 앱 캐시까지 검색했다는 뜻은 아니다.

- `D:/AI-Image-Video/models/checkpoints/animagine-xl-4.0-opt.safetensors` — 6,938,350,040 bytes.
- `D:/AI-Image-Video/models/diffusion_models/wan_animate_2_int8_convrot.safetensors` —
  16,653,175,528 bytes, 기존 영상 애니메이션 모델.
- `C:/code/1. codex/AI-Image-Video/ComfyUI_windows_portable/ComfyUI/models/diffusion_models/minimax_h3_fl2va_pruned_int8_convrot.safetensors` —
  20,970,379,616 bytes, 기존 영상 모델.
- 같은 포터블 `models/text_encoders/qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors`는 H3용
  텍스트/비전 인코더이며 Qwen-Image 편집 모델로 보고하지 않는다.

관련 기존 workflow는 모두 `C:/code/1. codex/AI-Image-Video/workflows/` 아래에 있다.

- `face-inpaint-selected-v1.json`
- `face-inpaint-proof-v1.json`, `face-inpaint-proof-v2.json` 및 동명 `-manifest.json`
- `character-consistency-face-lock-v2.json`~`character-consistency-face-lock-v6.json`
- `character-consistency-face-lock-openpose-v3.json`
- `character-consistency-ipadapter-dual-reference-v2.json`

`face-inpaint-selected-v1.json`도 Animagine checkpoint와 IPAdapter Plus Face를 사용한다.
경로와 loader만 확인했으며 다른 프로젝트 입력/출력을 이번 작업에 재사용하거나 생성하지 않았다.
