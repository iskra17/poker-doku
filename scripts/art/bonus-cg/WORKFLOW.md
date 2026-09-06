# 보너스 이벤트 CG 제작 워크플로우 — GPT Image 2 원화 → MiniMax H3 루프 영상

> 2026-09-06 실제로 50장(캐릭터 10명 × 장면 5개)을 완주한 절차를 그대로 적은 운영 문서다.
> 사람(사용자)이 검수·승인하고, 에이전트(LLM)는 생성·등록·인코딩·연결만 맡는다. **에이전트는 승인을 대신하지 않는다.**
> 로컬 LLM(Qwen 등)에게 같은 작업을 시킬 때 이 문서를 통째로 주면 된다. 명령은 전부 Windows(Git Bash/PowerShell) 기준이다.

## 0. 한눈에 보기

```
계획 JSON(장면 문구) ─→ A. 원화 생성(codex exec = GPT Image 2) ─→ 사용자 검수(원화)
   ─→ B. 원장 등록(외부 이미지 영수증 + 승인) ─→ C. H3 루프 생성(ComfyUI, 로컬 GPU)
   ─→ D. 루프 검수(검토 화면) ─→ 반려분 재생성(원화 또는 루프만) ─→ E. export(webp + mp4/webm)
   ─→ F. 게임 등록(카탈로그·영상 매니페스트) ─→ 테스트·빌드·병합
```

한 장의 최종 산출물 3개: `public/assets/story/cg/bonus-<id>-<scene>.webp`(768×1152), `public/assets/story/video/bonus-<id>-<scene>.mp4`·`.webm`(4.4초 루프, 각 ≤2.5MB).

## 1. 환경과 경로

| 구분 | 값 |
| --- | --- |
| 저장소 | `C:/code/claude/poker-doku` (도구는 `scripts/art/bonus-cg/`, 원장 코드는 `scripts/art/library/`) |
| 스테이징(리포 밖 작업 폴더) | `C:/code/claude/poker-doku-art/bonus-cg` — `ref/`(참조 PNG) `prompts/`(생성 프롬프트) `out/<id>/<scene>.png`(원화) `logs/` `encode-probe/`(검토용 인코딩) `review/`(검토 화면) |
| codex CLI | 로컬 설치. 이미지 생성은 내장 `image_gen`(gpt-image-2)이 그리고 `-m gpt-5.5`는 오케스트레이터 모델. **`CODEX_HOME=/c/code/claude/poker-doku-art/story-rewards/codex-home`**(auth.json만 있는 우회 홈 — 기본 `~/.codex`는 훅/스킬 때문에 exec가 멈춘다) |
| ComfyUI 포터블 | `C:\code\1. codex\AI-Image-Video\ComfyUI_windows_portable` (RTX 5090 32GB). 입력 `D:\AI-Image-Video\input`, 출력 `D:\AI-Image-Video\output`. API `http://127.0.0.1:8188` |
| 포터블 파이썬 | `C:/code/1. codex/AI-Image-Video/ComfyUI_windows_portable/python_embeded/python.exe` (PIL 포함 — 원장 도구는 이걸로 실행) |
| 원장(SQLite 큐) | `D:/AI-Image-Video/output/poker-doku-library/bonus-cg-20260906/library.sqlite3` (`scope: 'bonus'`), GPU OS 락 `D:/AI-Image-Video/.poker-doku-gpu.lock` |
| H3 레시피 | `scripts/art/library/recipes/h3-fl2v-bonus.recipe.json` (워크플로 `h3-fl2v-a3.workflow.json`, 모델 SHA 고정) |
| 에셋 워크트리 | `C:/code/claude/poker-doku/.worktrees/bonus-cg-assets` (브랜치 `feat/bonus-cg-assets`) — export 대상 |
| ffmpeg/ffprobe | PATH에 있음(9.x) |

ComfyUI 기동(백그라운드) — 이미 떠 있으면 `curl -sf http://127.0.0.1:8188/system_stats`가 200:

```powershell
Start-Process -FilePath 'C:\code\1. codex\AI-Image-Video\ComfyUI_windows_portable\python_embeded\python.exe' `
  -ArgumentList '-s','ComfyUI\main.py','--windows-standalone-build','--input-directory','D:\AI-Image-Video\input','--output-directory','D:\AI-Image-Video\output','--temp-directory','D:\AI-Image-Video\temp' `
  -WorkingDirectory 'C:\code\1. codex\AI-Image-Video\ComfyUI_windows_portable' -WindowStyle Hidden
```

H3는 VRAM 피크 약 28GB·RAM 약 17GB를 상주시킨다. LM Studio 등이 VRAM을 잡고 있으면 먼저 내린다. **동시 실행 한도: GPU 워커 1개, CLI 에이전트(codex 웨이브 등) 포함 작업자 2개.**

## 2. 입력 — 계획 JSON

`scripts/art/bonus-cg/bonus-cg-plan-2026-09-06.json`이 단일 소스다. 구조:

```jsonc
{
  "batch": "bonus-cg-2026-09-06",
  "image": { "width": 1024, "height": 1536, "format": "png" },
  "style_refs": [ { "path": "ref/style-a.png", "from": "public/assets/story/cg/scene-act1-ch02-victory-v2.webp" }, ... ],   // 마감 품질 벤치마크 2장
  "content_rules": "Tasteful and non-explicit. Adult characters only (ages 19-27). ... no nudity, no lingerie, no text/logo/watermark.",
  "scenes": { "beach": { "title_ko": "여름 해변", "camera": "full-body or three-quarter, low horizon" }, "gym": {...}, "yoga": {...}, "sing": {...}, "casual": {...} },
  "characters": [ { "id": "sakura", "name_ko": "사쿠라", "age": 22, "identity": "...", "ref": "ref/sakura-showcase.png",
                    "scenes": { "beach": "Wearing a pastel pink frilled bikini top ..., she wades ankle-deep ...; full-body, gaze ...", ... } } ]
}
```

- 장면 문구 형식: `Wearing <의상>, she <행동/포즈> ...; <카메라/프레이밍>, gaze <시선>, <배경/조명>.` — 원장 영수증이 `Wearing …`에서 의상, `gaze …`에서 시선을 자동 추출한다.
- 캐릭터 참조 이미지는 리포 `public/assets/characters/<id>/showcase.webp`를 `build-prompts.mjs`가 PNG로 `ref/<id>-showcase.png`에 복사한다.
- 반려 뒤 재생성은 **이 JSON의 문구를 고치는 것부터** 시작한다(구도·포즈·렌더링 지시를 바꾼다).

## 3. 단계 A — 원화 생성 (GPT Image 2 via codex exec)

### A-1. 프롬프트 파일 만들기

```bash
cd C:/code/claude/poker-doku
node scripts/art/bonus-cg/build-prompts.mjs C:/code/claude/poker-doku-art/bonus-cg              # 전원 (캐릭터당 5장 프롬프트 prompts/<id>.txt)
node scripts/art/bonus-cg/build-prompts.mjs C:/code/claude/poker-doku-art/bonus-cg sakura:gym   # 특정 장면 1장 → prompts/sakura-gym.txt
node scripts/art/bonus-cg/build-prompts.mjs C:/code/claude/poker-doku-art/bonus-cg ingrid:beach ingrid:gym  # 같은 캐릭터 2장면 → prompts/ingrid-beach-gym.txt (파일 하나!)
```

**함정**: 같은 캐릭터의 여러 장면을 한 번에 주면 `<id>-<scene1>-<scene2>.txt` 한 파일로 합쳐진다. 다음 단계 웨이브 인자도 그 파일명(`ingrid-beach-gym`)을 써야 한다. 잘못 쓰면 빈 프롬프트로 codex가 돌고 "Send the task" 답만 남는다.

### A-2. 프롬프트 내용 (스크립트 없이 수동으로 만들 때 그대로 쓴다)

```
IMPORTANT: Non-interactive session. NEVER ask questions or offer options (no visual companion, no clarification). Proceed text-only and generate immediately with the built-in image generation tool. Do not stop until every requested file exists on disk. If saving a file is blocked, print the mapping "call_x.png -> <target path>" for each image and finish.

TASK: Create premium finished Japanese galge visual-novel EVENT CG illustrations (one character plus a fully painted environment in one image), portrait 1024x1536, opaque, no text/letters/logo/watermark/collage/split panels.
CONTENT RULES: <계획 JSON content_rules>
QUALITY BENCHMARK: ./ref/style-a.png and ./ref/style-b.png are the required finish benchmark — delicate fine linework, translucent layered hair highlights, luminous nuanced skin, richly painted environment with foreground/midground/background depth, dimensional cinematic lighting connected to the figure, soft detailed fabric. Match this polished painted EVENT-CG finish, not a thick-outlined flat cartoon and not a chibi.
CHARACTER CONSISTENCY: The character reference PNG is identity/wardrobe-base ONLY. FIRST open and study it and replicate the EXACT same face shape, eyes, hair color and hairstyle, skin tone, signature accessories and adult proportions. Only outfit, pose, expression and scene change as instructed. Do not copy the reference pose or its frontal composition.
After generating, verify each output file exists at the exact path and print its size in bytes. Overwrite if it exists.

Reference: ./ref/<id>-showcase.png (<name_ko> — <identity>, adult woman age <age>). Study it first; keep her unmistakable face and hair in every image.

Generate 5 EVENT CG illustrations of this SAME woman. Each image is a different scene with a different outfit, camera angle and framing — vary the composition strongly between images (at most one image may look at the camera directly).

IMAGE 1 → save ./out/<id>/beach.png — [여름 해변] <장면 문구> Camera: <scenes.beach.camera>.
IMAGE 2 → save ./out/<id>/gym.png — [헬스장] ...
...
```

재생성(1장)일 때 세 번째 문단은 `Generate 1 EVENT CG illustration(s) of this SAME woman — a regeneration of a specific scene. Keep her identity exactly and use the described composition.`

### A-3. 웨이브 실행 (캐릭터별 codex를 병렬 백그라운드로)

```bash
bash scripts/art/bonus-cg/run-wave.sh C:/code/claude/poker-doku-art/bonus-cg wave1 sakura ara hana        # 프롬프트 파일명(확장자 제외)들
bash scripts/art/bonus-cg/run-wave.sh C:/code/claude/poker-doku-art/bonus-cg regen2 ara-yoga chloe-casual ingrid-beach-gym
```

내부적으로 `codex exec --skip-git-repo-check --sandbox workspace-write -m gpt-5.5 "$(cat prompts/<name>.txt)" </dev/null > logs/<name>-<wave>.log`를 돈다.
로그 `logs/<wave>.done`에 `<name> exit=N`이 한 줄씩 쌓이고 전부 끝나면 `wave <tag> finished`가 찍힌다. 캐릭터당 5장 ≈ 3~6분, 병렬 5개까지 무리 없음.

- `</dev/null`이 없으면 stdin 대기로 영원히 멈춘다. `--sandbox workspace-write`가 없으면 저장이 막힌다.
- 안전 필터에 걸린 장면(해변 등)은 codex가 문구를 완화해 스스로 재시도한다 — 로그에 남으니 결과만 검수하면 된다.
- 저장이 막힌 경우("Saving ... was blocked") 이미지는 `<CODEX_HOME>/generated_images/<session>/call_*.png`에 남고 로그에 `call_x.png -> <경로>` 매핑이 찍힌다.

### A-4. 산출물 회수·시트

```bash
node scripts/art/bonus-cg/collect-outputs.mjs C:/code/claude/poker-doku-art/bonus-cg /c/code/claude/poker-doku-art/story-rewards/codex-home wave1   # 로그 매핑대로 out/에 복사(이미 있으면 건너뜀)
node scripts/art/bonus-cg/contact-sheet.mjs C:/code/claude/poker-doku-art/bonus-cg sakura   # sheets/sakura.jpg (5장 가로 시트, 사용자에게 보여 줄 용도)
```

### A-5. 원화 검수 기준(사용자) 와 에이전트 1차 필터

- 정체성: 참조와 같은 얼굴형·눈·머리색·머리 모양·피부·상징 액세서리. 나이·비율은 성인.
- 해부·손·소품 접촉·팔다리 비율(단축 원근 때문에 팔이 짧아 보이는 구도는 피한다 → 포즈를 바꿔 재생성).
- **거울·유리창·수면 반사 구도는 실패율이 높다**(머리 모양 불일치, 반사된 얼굴 왜곡). 처음부터 반사 없는 구도로 쓴다.
- 세트 안 다른 캐릭터와 렌더링 톤이 다르면(실사풍 피부·근육) 문구에 `clean cel-shaded anime finish exactly matching the other characters in the set — flat stylized skin tones with simple two-tone shading, softly stylized (not photorealistic) muscle definition, minimal wet-skin specular highlights` 를 붙여 재생성한다.
- 텍스트·로고·워터마크·콜라주 금지, 노출 규칙(content_rules) 준수.
- 반려 원화는 지우지 말고 `out/<id>/<scene>-v1-rejected.png`로 이름을 바꿔 보존한 뒤 같은 경로에 새로 뽑는다.

## 4. 단계 B — 원장 등록 (외부 원화 영수증 + 승인)

포터블 파이썬으로 실행하고 `PYTHONIOENCODING=utf-8`을 켠다(한글 출력 인코딩 오류 방지).

```bash
export PYTHONIOENCODING=utf-8
PY='C:/code/1. codex/AI-Image-Video/ComfyUI_windows_portable/python_embeded/python.exe'
STAGING=/c/code/claude/poker-doku-art/bonus-cg
"$PY" -B scripts/art/bonus-cg/ledger_bonus.py receipts "$STAGING" sakura:beach sakura:gym ...   # 영수증(provenance 포함) 작성 + 원장 import, 원화를 D:/AI-Image-Video/input/pd-bonus-<id>-<scene>.png 로 복사
"$PY" -B scripts/art/bonus-cg/ledger_bonus.py approve sakura:beach sakura:gym ...                # 사용자 검수가 끝난 것만! 정확한 output SHA로 review approved 기록
```

- job id = `bonus-<id>-<scene>`. **원화를 다시 뽑은 경우 같은 id는 재사용할 수 없다** → `BONUS_IMAGE_SUFFIX=v2`를 붙여 `bonus-<id>-<scene>-v2`로 등록하고, 이전 원화 job은 `library-worker.py --root <원장> review <job> rejected --sha256 <hash> --reason '...'`로 반려 표시한다.
  이후 단계(C·D·E)는 `image_job_of`가 "최신 비반려 원화"를 자동으로 찾으므로 접미를 신경 쓰지 않아도 되고, export 파일명은 항상 접미 없는 `bonus-<id>-<scene>`이다.
- 영수증은 리포 `scripts/art/library/recipes/bonus-cg-20260906/<job>.external.json` + `.provenance.json`(프롬프트·참조 SHA·원본 SHA)로 남겨 커밋한다.

## 5. 단계 C — H3 루프 영상 생성 (ComfyUI, 로컬 GPU)

### C-1. 매니페스트

```bash
"$PY" -B scripts/art/bonus-cg/ledger_bonus.py video-manifest sakura:beach sakura:gym ...   # 승인된 원화만 대상. recipes/bonus-cg-20260906.video-<N>-<첫 job>.manifest.json 작성 + import
```

기본 프롬프트(스크립트가 조립):

```
Animate the exact supplied premium anime event illustration with its fine linework, detailed fabric, luminous layered hair and softly painted cinematic lighting fully preserved.
One adult <age>-year-old woman (<name_ko>) in the same outfit. Subtle ambient motion only: <MOTION>. Hands, fingers, held objects and the pose remain fixed.
Camera completely locked, no pan, zoom, shake or parallax. No extra people, no letters, captions, new objects, costume change or detail simplification.
Preserve facial identity and anatomy throughout. Return naturally to the exact original pose and expression at the end for a seamless gentle ambient loop. <EXTRA>
```

`<MOTION>`은 장면 기본값(`ledger_bonus.py`의 `MOTION`)이고 환경변수로 바꾼다:

| 변수 | 용도 |
| --- | --- |
| `BONUS_VIDEO_SUFFIX=v2` | 새 video job id(`...-video-v2`) — 같은 원화의 루프 재생성 |
| `BONUS_SEED_OFFSET=1000` | seed 변경(기본 `509020266000 + index`) |
| `BONUS_MOTION_OVERRIDE='...'` | 장면 기본 모션 큐를 통째로 대체 |
| `BONUS_VIDEO_EXTRA='...'` | 프롬프트 끝에 덧붙일 문장 |

**모션 큐 규칙 (실패에서 배운 것)**

- **부정 지시는 역효과**: "no falling petals", "absolutely no smoke"처럼 금지어를 적으면 H3가 그 단어를 따라 꽃잎·연기를 그린다. 원치 않는 요소는 **언급 자체를 하지 않는다.** 필요하면 긍정 문장으로만: `The air is perfectly clear and still with nothing floating or drifting anywhere in the frame; only the listed subtle motions occur.`
- 실내·비 오는 거리 장면에 꽃잎·낙엽·눈·김(steam)·커튼 같은 단어를 넣지 않는다(기본 casual/yoga 큐에 들어 있던 `petals`·`curtain`이 실내 오락실·서점·노천카페·야외 요가에서 환각을 만들었다).
- 안전한 최소 구성: `subtle breathing, hair strands stirring slightly, a single slow blink` + 장면 고유의 빛 하나(오락기 화면 맥동, 램프 깜빡임, 젖은 돌길 반사 반짝임, 무대 조명 흔들림, 물결 반짝임).
- 검증된 예: 오락실 `arcade screen glow pulsing softly on her face and jacket, hair stirring slightly, a single slow blink` / 서점 `warm lamp light flickering softly across the shelves, ...` / 몰 셀카 `soft light glints sliding across the phone and shopping bags, ...` / 빗속 카페 `wet street reflections shimmering softly behind her, ...` / 야외 요가 `calm slow breathing, potted plant leaves stirring softly in the breeze, warm sunrise light shimmering gently, a single slow blink`.

### C-2. 실행

```bash
curl -sf http://127.0.0.1:8188/system_stats >/dev/null || echo "ComfyUI 먼저 기동"
"$PY" -B scripts/art/library-worker.py --root D:/AI-Image-Video/output/poker-doku-library/bonus-cg-20260906 run --watch --limit 24   # 대기 job을 최대 24개 순차 제출
"$PY" -B scripts/art/library-worker.py --root D:/AI-Image-Video/output/poker-doku-library/bonus-cg-20260906 status
```

- 클립당 약 90~120초(첫 클립은 모델 로드로 더 김). 출력 `results/<job>--<intent>--a1--r<recipe>_00001_.mp4`(768×1152·24fps·107프레임·H.264).
- 워커는 GPU OS 락을 잡는다 — 두 프로세스를 동시에 돌리지 말고 앞 프로세스가 끝난 뒤 새로 띄운다. 에이전트 도구의 백그라운드 명령은 10분 상한이 있으니 긴 배치는 PowerShell `Start-Process ... -RedirectStandardOutput <log>`로 분리 실행하고 로그를 본다.
- 프로세스가 죽으면 `reconcile`로 완료된 결과를 회수한다. 자동 재시도는 없다(job당 제출 3회 상한).

## 6. 단계 D — 루프 검수와 재생성

### D-1. 검토용 인코딩 + 검토 화면

```bash
cd /c/code/claude/poker-doku-art/bonus-cg
for job in bonus-sakura-beach-video ...; do SRC=$(ls /d/AI-Image-Video/output/poker-doku-library/bonus-cg-20260906/results/${job}--*.mp4 | head -1)
  ffmpeg -y -loglevel error -i "$SRC" -c:v libx264 -crf 26 -preset medium -pix_fmt yuv420p -movflags +faststart -an encode-probe/${job}.mp4
  ffmpeg -y -loglevel error -i "$SRC" -c:v libvpx-vp9 -crf 32 -b:v 0 -cpu-used 4 -pix_fmt yuv420p -an encode-probe/${job}.webm; done
cd C:/code/claude/poker-doku
node scripts/art/bonus-cg/review-page.mjs      # <staging>/review/index.html 생성 (원장에서 캐릭터·장면별 최신 비반려 원화·루프를 자동 추적)
node scripts/art/bonus-cg/review-serve.mjs     # http://127.0.0.1:8765/review/  (Range 206 지원 — python http.server는 영상이 안 뜬다)
```

검토 화면: 카드마다 루프(mp4/webm 전환)·원화·승인/반려·메모, 크게 보기(처음/끝 프레임 이음새 확인), [반려 목록] = `캐릭터:장면` 텍스트, 상태는 브라우저 localStorage에 저장되고 클립이 재생성되면 그 카드만 자동으로 미검토로 돌아온다.
에이전트 자체 1차 점검은 프레임 스트립으로: `ffmpeg -i encode-probe/<job>.mp4 -vf "select='not(mod(n,26))',scale=340:-1,tile=5x1" -frames:v 1 strip.jpg`.

### D-2. 판정 기준

카메라 고정(팬·줌·흔들림 없음), 얼굴·의상·손·소품 유지, 첫/끝 프레임 동일(이음새), 환각 소품 없음(꽃잎·연기·커튼·글자), 과한 표정 변화 없음(살짝 벌어진 입 정도는 허용).

### D-3. 결과 반영

```bash
"$PY" -B scripts/art/bonus-cg/ledger_bonus.py approve-videos sakura:beach ...          # 사용자 승인분
"$PY" -B scripts/art/library-worker.py --root <원장> review bonus-ara-casual-video rejected --sha256 <output_hash> --reason 'User review: floating petals'   # 반려
BONUS_VIDEO_SUFFIX=v2 BONUS_SEED_OFFSET=1000 BONUS_MOTION_OVERRIDE='...' "$PY" -B scripts/art/bonus-cg/ledger_bonus.py video-manifest ara:casual   # 루프만 재생성
```

원화까지 문제면 §3-A(JSON 문구 수정 → 1장 재생성) → §4(`BONUS_IMAGE_SUFFIX=v2` 등록) → §5로 돌아간다. 반려 사유는 원장 `--reason`에 남긴다.

## 7. 단계 E — export (게임 에셋)

```bash
"$PY" -B scripts/art/bonus-cg/ledger_bonus.py export sakura:beach sakura:gym ...
# → .worktrees/bonus-cg-assets/public/assets/story/cg/bonus-<id>-<scene>.webp (768×1152 q82)
#   .worktrees/bonus-cg-assets/public/assets/story/video/bonus-<id>-<scene>.{mp4,webm} (106프레임 4.4167초, ≤2,500,000바이트, 초과 시 실패)
cd .worktrees/bonus-cg-assets && git add public/assets/story && git commit -m "feat(art): export N bonus CG pairs"
cd ../.. && (cd .worktrees/bonus-cg-assets && git rebase main) && git merge --ff-only feat/bonus-cg-assets
```

export는 승인된 정확한 바이트만 받고, 같은 파일을 다시 export하면 no-op, 기존 파일 덮어쓰기는 거부한다(재생성본은 이전 파일을 먼저 지운 뒤 export).

## 8. 단계 F — 게임 등록

이미 연결된 보너스 라인(캐릭터 10명 × 장면 5개)은 파일만 바꾸면 끝이다(파일명이 고정). **새 캐릭터·새 장면을 늘릴 때만** 코드가 필요하다:

1. `src/lib/story/rewards/bonus-cg.ts` — 캐릭터/장면 목록·해금 임계·한국어 제목/캡션(캐릭터 문체) 추가 → 카탈로그 항목 `story-bonus-cg-<id>-<scene>` 자동 생성.
2. 마이그레이션 `src/server/persistence/migrations.ts`에 `story_reward_catalog` INSERT(UPDATE/DELETE 금지, 비히로인은 `character_id NULL`) + `database.test.ts` 버전 상수.
3. `src/lib/assets/story-video.ts`의 `VIDEO_AVAILABLE`은 `BONUS_CG_VIDEO_STEMS`를 spread하므로 자동. 테스트 `story-video.test.ts`가 파일 쌍 실재를 검사한다.
4. 검증: `npx vitest run <관련 파일>` → `npx tsc --noEmit` → `npm run lint` → main에서 `npm run build`. 계약 상세는 `docs/superpowers/plans/2026-09-06-bonus-cg-integration-plan.md` §6.

## 9. 체크리스트 (에이전트용)

- [ ] ComfyUI 살아 있음(`/system_stats` 200), VRAM 비어 있음, GPU 워커 1개만.
- [ ] `CODEX_HOME` 우회 홈 사용, `</dev/null`, `--sandbox workspace-write`, `-m gpt-5.5`.
- [ ] 웨이브 인자는 `prompts/` 실제 파일명(합본 파일명 주의).
- [ ] 원화 반려본은 `-v1-rejected.png`로 보존, 새 원화는 `BONUS_IMAGE_SUFFIX=v2`로 등록.
- [ ] H3 프롬프트에 금지어를 쓰지 않는다(부정 지시 금지), 실내 장면에 꽃잎·김·커튼 없음.
- [ ] 승인은 사용자만. 에이전트는 검토 화면/시트를 만들어 보여 주고 결과를 원장에 기록한다.
- [ ] export 전 크기 상한 2.5MB, 파일명 접미 없음, 커밋 후 main ff 병합.
- [ ] 브라우저에서 루프 확인은 **전면 탭**에서(백그라운드 탭은 1.5초 canplay 폴백으로 정지 CG가 보인다).
- [ ] `ls -l | awk` 같은 파싱은 사용자명 공백 때문에 깨진다 — `stat -c %s` 사용.

## 10. 참고 문서

- H3 단일 클립 절차·파일럿 기록: `scripts/art/story-video.md`, 러너 `scripts/art/story-video-h3.py`
- 원장 워커 명령 전체: `scripts/art/library/README.md`
- 배치 계획·게임 연결 계약: `docs/superpowers/plans/2026-09-06-bonus-cg-pipeline.md`, `2026-09-06-bonus-cg-integration-plan.md`
- 실제 진행 기록(반려 사유·재생성 판단): `docs/superpowers/handoffs/2026-09-06-r4-complete-handoff.md` §3·§5
