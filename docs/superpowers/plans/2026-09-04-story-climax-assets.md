# Ch1~6 클라이맥스 CG·H3 영상 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (권장) 또는 `superpowers:executing-plans`로 태스크를 순서대로 실행한다. 이미지 생성 단계에서는 `imagegen` 스킬을 사용한다.

**Goal:** 기존 Ch1~6 스파링 인터럽트 여섯 곳에 클라이맥스 이벤트 CG를 추가하고, 승인된 정지 CG마다 RTX 5090 ComfyUI H3 기반 4.4초 앰비언트 루프를 제공한다.

**Architecture:** 기존 `SceneSayLine.cg → story-cgs.ts → ScenePlayer → story-video.ts` 파이프라인만 확장한다. 이미지와 영상 파일이 실제로 준비되기 전에는 매니페스트나 챕터 참조를 올리지 않으며, 여섯 스틸을 먼저 확정한 뒤 그 스틸을 H3의 first/last frame으로 사용한다. 정지 CG·영상·매니페스트·챕터 앵커는 최종 한 커밋에서 함께 등록한다.

**Tech Stack:** TypeScript, Vitest, 내장 `image_gen`, Sharp 변환 스크립트, RTX 5090 ComfyUI MiniMax H3 fl2va, ffmpeg/ffprobe

**설계 기준:** `docs/superpowers/specs/2026-09-04-story-climax-assets-design.md`

---

### Task 1: 생성 환경과 기존 계약 고정

**Files:**
- Read: `docs/superpowers/specs/2026-09-04-story-climax-assets-design.md`
- Read: `src/lib/assets/story-cgs.ts`
- Read: `src/lib/assets/story-video.ts`
- Read: `scripts/art/story-video-h3.py`
- Read: `scripts/art/story-video.md`
- Read: `scripts/art/story-video-encode.sh`

- [ ] **Step 1: 작업 트리와 기존 개수를 확인한다**

Run:

```powershell
git status --short
npx vitest run src/lib/assets/story-cgs.test.ts
npx vitest run src/lib/assets/story-video.test.ts
```

Expected: 작업 트리가 깨끗하고 기존 씬 CG 12개 및 영상 매니페스트 테스트가 통과한다. 전체 테스트·빌드·브라우저 E2E는 실행하지 않는다.

- [ ] **Step 2: 입력 레퍼런스와 출력 경로를 확인한다**

각 캐릭터의 `C:\code\claude\poker-doku-art\story-rewards\ref\*-showcase.png`, `*-neutral.png`가 존재하는지 확인한다. Ch3은 `draco-neutral.png`, `hana-showcase.png`, `hana-neutral.png` 세 장을 사용한다.

원본 출력 디렉터리와 프로젝트 출력 디렉터리가 존재하는지 확인하되 파일은 아직 만들지 않는다.

```powershell
Test-Path 'C:\code\claude\poker-doku-art\story-rewards\out\cg'
Test-Path 'public\assets\story\cg'
Test-Path 'public\assets\story\video'
```

---

### Task 2: 정지 클라이맥스 CG 여섯 장 생성·선정

**Files:**
- Create outside repo: `C:\code\claude\poker-doku-art\story-rewards\out\cg\scene-act1-ch01-climax.png`
- Create outside repo: `C:\code\claude\poker-doku-art\story-rewards\out\cg\scene-act1-ch02-climax.png`
- Create outside repo: `C:\code\claude\poker-doku-art\story-rewards\out\cg\scene-act1-ch03-climax.png`
- Create outside repo: `C:\code\claude\poker-doku-art\story-rewards\out\cg\scene-act2-ch04-climax.png`
- Create outside repo: `C:\code\claude\poker-doku-art\story-rewards\out\cg\scene-act2-ch05-climax.png`
- Create outside repo: `C:\code\claude\poker-doku-art\story-rewards\out\cg\scene-act2-ch06-climax.png`
- Create: `public/assets/story/cg/scene-act1-ch01-climax.webp`
- Create: `public/assets/story/cg/scene-act1-ch02-climax.webp`
- Create: `public/assets/story/cg/scene-act1-ch03-climax.webp`
- Create: `public/assets/story/cg/scene-act2-ch04-climax.webp`
- Create: `public/assets/story/cg/scene-act2-ch05-climax.webp`
- Create: `public/assets/story/cg/scene-act2-ch06-climax.webp`

- [ ] **Step 1: Ch1부터 Ch6까지 내장 `image_gen`을 서로 다른 여섯 호출로 실행한다**

각 호출은 설계 문서 4절의 공용 프롬프트와 해당 씬 델타를 결합하고 표에 적힌 레퍼런스만 첨부한다. 한 호출에서 복수 CG를 만들지 않는다.

생성 순서와 장면은 다음으로 고정한다.

1. `act1-ch01-climax`: 미야코가 첫 쇼다운 보드를 펼치는 따뜻한 도장 장면
2. `act1-ch02-climax`: 사쿠라가 침착하게 폴드하며 격려하는 반환점
3. `act1-ch03-climax`: 드라코가 팟을 밀고 하나가 뒤에서 관찰하는 오버벳 순간
4. `act2-ch04-climax`: 아라가 칩을 밀어붙이는 선제 타격
5. `act2-ch05-climax`: 클로이가 홀카드를 공개하는 방송형 쇼다운
6. `act2-ch06-climax`: 팽팽이 파란 칩 탑을 미는 냉기 어린 헤즈업 선전포고

- [ ] **Step 2: 생성 결과를 한 장씩 시각 검수한다**

`view_image`로 원본을 확인하며 정체성, 의상, 손가락/지느러미, 여분 인물, 텍스트·숫자·로고, 카드 판독 가능성, 세로 크롭을 검사한다. 실패하면 실패 항목 하나만 강화해 같은 CG를 최대 두 번 재생성한다. 세 번 모두 실패한 장면은 등록하지 않고 보류한다.

- [ ] **Step 3: 승인된 PNG를 고정 경로에 보존하고 WebP로 변환한다**

각 승인 PNG에 대해 다음 형식을 반복한다.

```powershell
node scripts/art/convert.mjs cg `
  'C:/code/claude/poker-doku-art/story-rewards/out/cg/scene-act1-ch01-climax.png' `
  'public/assets/story/cg/scene-act1-ch01-climax.webp'
```

Expected: 여섯 WebP가 768×1152로 디코딩되며 대략 90~180KB 범위다. 아직 커밋하지 않는다.

---

### Task 3: CG 매니페스트와 기존 인터럽트 앵커 연결

**Files:**
- Modify: `src/lib/assets/story-cgs.test.ts`
- Modify: `src/lib/gallery/catalog.test.ts`
- Modify: `src/lib/assets/story-cgs.ts`
- Modify: `src/lib/story/chapters/act1/ch01-dojo-gate.ts`
- Modify: `src/lib/story/chapters/act1/ch02-art-of-waiting.ts`
- Modify: `src/lib/story/chapters/act1/ch03-numbers-dont-lie.ts`
- Modify: `src/lib/story/chapters/act2/ch04-first-strike.ts`
- Modify: `src/lib/story/chapters/act2/ch05-take-what-is-yours.ts`
- Modify: `src/lib/story/chapters/act2/ch06-three-bet-temperature.ts`

- [ ] **Step 1: 매니페스트 개수 회귀 기대값을 먼저 갱신한다**

`story-cgs.test.ts`의 `SCENE_CG_IDS.length` 기대값을 12에서 18로, `gallery/catalog.test.ts`의 CG 섹션 합계를 19에서 25로 바꾼다. 이 시점 테스트는 새 ID가 아직 없으므로 실패해야 한다.

- [ ] **Step 2: `story-cgs.ts`에 여섯 CG를 등록한다**

각 챕터 블록을 `prologue → climax → epilogue` 순으로 정렬하고 다음 제목을 추가한다.

| ID | 제목 |
|---|---|
| `act1-ch01-climax` | `첫 쇼다운` |
| `act1-ch02-climax` | `기다림의 반환점` |
| `act1-ch03-climax` | `팟 두 배의 인사` |
| `act2-ch04-climax` | `선제 타격` |
| `act2-ch05-climax` | `스테이션의 쇼다운` |
| `act2-ch06-climax` | `빙점의 선전포고` |

`sceneCgChapterId`는 다음 정규식으로 바꾼다.

```ts
return id.replace(/-(prologue|climax|epilogue)$/, '');
```

`AVAILABLE` 주석의 수량을 씬 CG 18장으로 갱신한다.

- [ ] **Step 3: 여섯 기존 인터럽트 대사의 한 줄에만 `cg`를 추가한다**

| 파일 | 인터럽트 | 라인 |
|---|---|---|
| Ch1 | `act1-ch01:int-first-showdown` | 첫 번째 Miyako say line |
| Ch2 | `act1-ch02:int-halfway` | 유일한 Sakura say line |
| Ch3 | `act1-ch03:int-first-turn` | 두 번째 Draco say line |
| Ch4 | `act2-ch04:int-halfway` | 유일한 Ara say line |
| Ch5 | `act2-ch05:int-first-showdown` | 유일한 Chloe say line |
| Ch6 | `act2-ch06:int-first-turn` | 두 번째 Paeng say line |

기존 화자·본문·표정·`effect`는 바꾸지 않고 `bg`나 `music`도 추가하지 않는다.

- [ ] **Step 4: CG와 챕터 관련 테스트만 실행한다**

```powershell
npx vitest run src/lib/assets/story-cgs.test.ts
npx vitest run src/lib/gallery/catalog.test.ts
npx vitest run src/lib/story/chapters/act1/act1.test.ts
npx vitest run src/lib/story/chapters/act2/act2.test.ts
```

Expected: 각 파일이 통과하고 모든 `climax` ID가 올바른 챕터로 매핑된다. 아직 커밋하지 않는다.

---

### Task 4: H3 러너에 여섯 클립을 정의하고 로컬 생성

**Files:**
- Modify: `scripts/art/story-video-h3.py`
- Create outside repo: `D:\AI-Image-Video\input\pd-scene-<SceneCgId>.png` × 6
- Create outside repo: `D:\AI-Image-Video\output\poker-doku\scene-<SceneCgId>-v1_*.mp4` × 6

- [ ] **Step 1: `CLIPS`에 4차 배치 여섯 항목을 추가한다**

`# --- 2026-09-04 4차 배치: 클라이맥스 씬 CG 6 ---` 블록을 만들고 설계 문서 5절의 미세 동작 제약과 다음 시드를 사용한다.

```text
scene-act1-ch01-climax  509020260944
scene-act1-ch02-climax  509020260945
scene-act1-ch03-climax  509020260946
scene-act2-ch04-climax  509020260947
scene-act2-ch05-climax  509020260948
scene-act2-ch06-climax  509020260949
```

각 프롬프트에는 고정 카메라, 미세 주변 움직임만, 손·카드·칩 고정, 입 움직임 없음이 들어가야 한다. `STYLE`, `LENGTH=107`, 8-step 설정은 바꾸지 않는다.

- [ ] **Step 2: WebP 여섯 장을 ComfyUI 입력 PNG로 변환한다**

`pd-scene-<SceneCgId>.png` 이름으로 `D:\AI-Image-Video\input` 최상위에 둔다.

- [ ] **Step 3: VRAM을 확보하고 ComfyUI를 기동한다**

LM Studio에 로드된 모델을 먼저 언로드한다. 기존 포터블 ComfyUI를 숨김 창으로 시작한 뒤 다음 요청이 성공하는지 확인한다.

```powershell
Invoke-RestMethod http://127.0.0.1:8188/system_stats
```

- [ ] **Step 4: 별도 숨김 프로세스로 H3 여섯 클립을 생성한다**

```powershell
Start-Process python `
  -ArgumentList 'scripts/art/story-video-h3.py','v1','scene-act1-ch01-climax','scene-act1-ch02-climax','scene-act1-ch03-climax','scene-act2-ch04-climax','scene-act2-ch05-climax','scene-act2-ch06-climax' `
  -RedirectStandardOutput 'batch4.log' `
  -RedirectStandardError 'batch4.err.log' `
  -WindowStyle Hidden
```

`batch4.log`를 폴링해 ID별 `DONE`을 확인한다. 실패한 ID만 동일 시드로 다시 실행한다. 품질 재생성이 필요한 경우 원래 `CLIPS` 시드는 유지하고 `H3_SEED_OFFSET=1000`과 `v2`를 사용한다.

---

### Task 5: 영상 인코딩·시각 검수·매니페스트 등록

**Files:**
- Create: `public/assets/story/video/scene-act1-ch01-climax.webm`
- Create: `public/assets/story/video/scene-act1-ch01-climax.mp4`
- Create: `public/assets/story/video/scene-act1-ch02-climax.webm`
- Create: `public/assets/story/video/scene-act1-ch02-climax.mp4`
- Create: `public/assets/story/video/scene-act1-ch03-climax.webm`
- Create: `public/assets/story/video/scene-act1-ch03-climax.mp4`
- Create: `public/assets/story/video/scene-act2-ch04-climax.webm`
- Create: `public/assets/story/video/scene-act2-ch04-climax.mp4`
- Create: `public/assets/story/video/scene-act2-ch05-climax.webm`
- Create: `public/assets/story/video/scene-act2-ch05-climax.mp4`
- Create: `public/assets/story/video/scene-act2-ch06-climax.webm`
- Create: `public/assets/story/video/scene-act2-ch06-climax.mp4`
- Modify: `src/lib/assets/story-video.ts`
- Modify: `scripts/art/story-video.md`

- [ ] **Step 1: 여섯 원본을 WebM과 MP4로 인코딩한다**

```bash
bash scripts/art/story-video-encode.sh v1 \
  scene-act1-ch01-climax scene-act1-ch02-climax scene-act1-ch03-climax \
  scene-act2-ch04-climax scene-act2-ch05-climax scene-act2-ch06-climax
```

- [ ] **Step 2: 각 영상의 첫 프레임·루프 안정성과 파일 계약을 확인한다**

대표 프레임을 추출해 시각 확인하고, 모든 MP4/WebM에 대해 `ffprobe`로 768×1152, 약 4.42초, 106프레임, 오디오 없음, 파일당 2.5MB 이하를 확인한다. 손·카드·칩이 흔들리거나 입이 말하는 영상만 재생성한다.

- [ ] **Step 3: `VIDEO_AVAILABLE`과 배치 기록을 갱신한다**

`story-video.ts`의 챕터 씬 블록에 여섯 `scene-<SceneCgId>`를 추가하고 헤더 주석을 43클립에서 49클립으로 갱신한다. `scripts/art/story-video.md`에는 4차 배치의 ID, seed, 채택 버전, 생성 시간, WebM/MP4 용량과 최종 프롬프트를 기록한다.

- [ ] **Step 4: 최소 코드·에셋 검증을 실행한다**

```powershell
npx vitest run src/lib/assets/story-cgs.test.ts
npx vitest run src/lib/assets/story-video.test.ts
npx vitest run src/lib/gallery/catalog.test.ts
npx vitest run src/lib/story/chapters/act1/act1.test.ts
npx vitest run src/lib/story/chapters/act2/act2.test.ts
npx tsc --noEmit
```

Expected: 관련 테스트와 타입 검사가 모두 통과한다. 전체 Vitest, `npm run build`, 브라우저 자동화는 실행하지 않는다.

- [ ] **Step 5: 산출물 집합과 작업 트리를 검사한다**

CG 6장, 영상 12파일과 매니페스트 basename 집합이 정확히 일치하는지 확인하고 `git diff --check`를 실행한다.

- [ ] **Step 6: 전체 배치를 한 커밋으로 만든다**

```powershell
git add public/assets/story/cg public/assets/story/video src/lib/assets/story-cgs.ts src/lib/assets/story-cgs.test.ts src/lib/assets/story-video.ts src/lib/gallery/catalog.test.ts src/lib/story/chapters/act1 src/lib/story/chapters/act2 scripts/art/story-video-h3.py scripts/art/story-video.md
git commit -m "feat: 1·2막 클라이맥스 CG와 영상 추가"
```

Expected: 생성된 여섯 CG, 열두 영상, 코드 참조가 함께 커밋되고 `git status --short`가 비어 있다. push·merge·deploy는 별도 통합 단계에서 수행한다.
