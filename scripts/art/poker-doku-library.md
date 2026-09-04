# Poker Doku A1 일반 아트 파일럿

승인된 설계: `docs/superpowers/specs/2026-09-05-art-library-production-design.md`.
범위는 성인 사쿠라(22)·엘레나(27)의 일반 수련·일상 12장면, 각 2후보(24장)다.
기존 `public/` 정본 교체, 게임 연결, 보너스 CG, 새 모델 다운로드, 영상화, A2 영속 워커는 포함하지 않는다.

## 입력과 비교

- 정본: `public/assets/characters/{sakura,elena}/neutral.webp`. 생성 전에 육안 확인한 얼굴 크롭을
  밝은 회색 배경에 합성한다. 의상·머리/눈 색·장신구는 텍스트에도 고정한다.
- 얼굴 크롭은 IPAdapter Plus Face SDXL에만 전달한다. 전체 원본의 정면 자세를 복제하지 않는다.
- 몸의 구도는 별도 OpenPose 18점 도형으로 지정한다. 얼굴 방향은 코·눈·귀의 비대칭과 문장을
  함께 사용한다. 이 도형은 손가락이나 실제 카드 조작을 보장하지 않는다.
- 얼굴 강도는 0.35/0.55/0.75. 장면마다 두 강도를 동일 seed에서 비교하며 세 조합을 반복한다.
  이는 강도 탐색 24후보이고 독립 seed 24회가 아니다.
- 832×1216, Animagine XL 4.0 opt, Euler ancestral, 28 steps, CFG 5,
  얼굴 적용 0~0.75, OpenPose 0~0.65·강도 0.55(클로즈업 0.25).
- 해당 캐릭터로 알아볼 수 있는가와 요청한 시선·동작이 존재하는가를 따로 판정한다.
  정본과 화풍 차이, 장신구 증식, 손/팔 오류, 소품 의미 오류는 별도 보류 사유다.

## 실행

ComfyUI 포터블 Python:
`C:/code/1. codex/AI-Image-Video/ComfyUI_windows_portable/python_embeded/python.exe`.
설치된 `IPAdapterAdvanced`, `PrepImageForClipVision`, SDXL OpenPose ControlNet만 사용한다.
원본 workflow는 `character-consistency-face-lock-openpose-v3.json`과
`character-consistency-ipadapter-dual-reference-v2.json`이며 프로젝트 전용 graph로 복제했다.

1. `nvidia-smi`, 프로세스 목록, ComfyUI `/queue`를 확인한다. 다른 추론 작업이 있으면 시작하지 않는다.
   다른 사용자의 앱을 강제 종료하지 않는다. 출력 드라이브 여유는 최소 30GiB다.
2. ComfyUI를 `--listen 127.0.0.1`, D 드라이브 입력/출력으로 숨김 창에서 시작한다.
   시작 명령은 `story-video.md`와 같고 `-WindowStyle Hidden`을 지정한다.
3. `python scripts/art/poker-doku-library-test.py`로 큐 점유·중복 제출·24장 상한 검사를 실행한다.
4. 최초 한 번 `python scripts/art/poker-doku-library.py prepare`로 크롭·포즈·해시·manifest를 만든다.
   기존 manifest가 있으면 덮어쓰지 않는다.
5. `python scripts/art/poker-doku-library.py run --limit 2`로 초기 샘플을 확인한다.
   이어 `run --limit 22`로 나머지를 생성한다. 동일 ComfyUI 큐에 동시에 제출하지 않는다.
6. `python scripts/art/poker-doku-library.py sheets`로 캐릭터별 12장 컨택트시트를 만든다.

모든 생성물은 `D:/AI-Image-Video/output/poker-doku-library/a1-20260905/`에만 저장한다.
`scripts/art/poker-doku-library-manifest.json`은 원장 스냅샷이고 출력 폴더에도 복사된다.
모델·정본·얼굴크롭·workflow·개별 prompt·결과 SHA-256, seed, prompt ID와 초 단위 소요를 보존한다.
`system-stats.json`, `node-info.json`, ComfyUI 로그는 실행 환경 근거다.

## 한계와 복구

이것은 A1 단발 배치다. SQLite·pause/resume·시작프로그램·자동 재시도·자동 승인 기능이 없다.
제출 전 `unknown`, 응답 후 `submitted`와 prompt ID를 기록하며 네트워크 오류나 600초 초과 시
즉시 멈춘다. 불확실한 제출을 자동 재시도하지 않는다. 실패를 확인 없이 planned로 되돌리지 않는다.
중단 후 `/history/<prompt_id>`와 `/queue`, 저장된 PNG를 대조하는 작업은 수동이다.
동시에 새 배치나 다른 GPU 모델을 시작하지 않는다. 장치 오류를 우회하려고 앱을 종료하지 않는다.

## 판정

후보 상태(`generated`)와 편집 상태(`review_status`)는 분리한다. 에이전트의 `recommended`는
사람의 최종 승인이나 게임 배포 승인을 의미하지 않는다. 확장 조건은 캐릭터별 6장면 중
최소 4장면에서 얼굴 동일성과 계획한 방향·동작을 함께 만족하는 후보가 한 장 이상인 것이다.
계획에서 벗어난 예쁜 그림을 해당 장면의 성공으로 계산하지 않는다.

## 승인된 A1b 보정(최대 12장)

초기 24장의 실패를 확인한 총괄이 6실패장면×2후보만 추가 승인했다.
`poker-doku-library-correction.py prepare|run|sheets`는 별도
`poker-doku-library-correction-manifest.json`, `workflows/poker-doku-sdxl-correction.json`,
`D:/AI-Image-Video/output/poker-doku-library/a1b-20260905/`를 사용한다.
사쿠라 카드정리/결의/어깨너머 복기와 엘레나 창밖/코트/분석만 재시도한다.

변경은 장면문장 우선, 얼굴 참조 0.20/0.35·적용 0.25~0.85, Pose 0.8·종료 0.85
(클로즈업 0.5), 일부 팔·어깨 좌표, 크림/네이비 의상과 카메라 밖 시선 강조다.
이는 여러 조건을 함께 바꾼 보정 배치다. 개별 변수의 인과 효과를 입증한 실험으로 해석하지 않는다.
최초24장과 보정12장은 전부 보존하며 추가 자동 재시도나 A2 확장은 하지 않는다.
