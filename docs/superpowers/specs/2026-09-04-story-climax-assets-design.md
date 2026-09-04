# 1·2막 클라이맥스 CG 배치 설계 (2026-09-04)

수련 스토리 Ch1~Ch6 각 챕터의 **스파링 도중**에 풀스크린 이벤트 CG를 한 장씩 추가한다.
지금까지 씬 CG는 챕터 프롤로그/에필로그(= 스파링 전후 씬 스텝)에만 있어서, 정작 챕터의 감정 정점인
"실제로 붙는 순간"이 스프라이트 말풍선으로만 지나갔다. 이 배치는 **이미 존재하는 스파링 인터럽트 라인**에
CG를 붙여, 연출 정점을 프롤로그/에필로그와 같은 급으로 올린다.

새 씬·새 대사·새 트리거를 만들지 않는다. 붙이는 것은 기존 라인의 `cg` 필드 한 줄뿐이다.

---

## 1. 아키텍처 · 데이터 흐름

기존 씬 CG 파이프라인을 그대로 탄다. 새 개념·새 계약은 없다.

```
챕터 데이터(SceneSayLine.cg = 'act1-ch01-climax')
   └─ validateSayLine (chapters/index.ts)  … isSceneCgId 로 유니온 검증
   └─ ScenePlayer (components/story/ScenePlayer.tsx)
        ├─ getSceneCg(id)                 … story-cgs.ts → /assets/story/cg/scene-<id>.webp
        └─ getStoryVideo(sceneCgVideoId(id))
                                          … story-video.ts → /assets/story/video/scene-<id>.{webm,mp4}
             └─ VideoCutscene (파일 없음·디코딩 실패·1.5초 내 canplay 미도달 → 정지 CG, reduced-motion은 영상 미마운트)
기록실(GalleryModal)
   └─ buildGallery (lib/gallery/catalog.ts)
        └─ SCENE_CG_IDS 순회 → sceneCgChapterId(id) 로 챕터 매칭 → 그 챕터 완주 시 해금
```

핵심 두 가지:

- **`cg`는 그 라인에서만** 풀스크린이다(`bg`처럼 누적되지 않는다). 다음 라인에서 스프라이트로 돌아온다.
  따라서 인터럽트 씬의 "그 한 줄"에만 달면 되고, 인터럽트가 끝나면 자동으로 테이블 화면으로 복귀한다.
- **`sceneCgChapterId(id)`가 기록실 해금 키**다. 현재 구현은
  `id.replace(/-(prologue|epilogue)$/, '')` — `climax`를 정규식에 넣지 않으면
  `act1-ch01-climax`가 그대로 챕터 id로 쓰여 `chapters.find`가 실패하고, 기록실 항목이
  엉뚱한 힌트를 단 채 영구 잠긴다. 게다가 `story-cgs.test.ts`의
  `sceneCgChapterId(line.cg) === chapter.id` 단언이 바로 깨진다. 정규식 확장은 **필수이며 CG 등록과 같은 커밋**이다.

또 하나 주의: `story-cgs.ts`의 `AVAILABLE`은 `new Set(SCENE_CG_IDS)` — 즉 **유니온에 id를 넣는 순간
"배치됨"으로 간주**된다. 파일이 없으면 즉시 깨진 이미지가 된다. 그래서 매니페스트 등록은
webp 6장이 실제로 리포에 들어온 뒤, 같은 커밋에서만 한다(2절 순서 참조).

### 인터럽트 앵커 선정 규칙

스파링 스텝마다 인터럽트는 2개씩 있다. **CG 주인공과 말하는 사람이 같은 라인**에 붙인다.
둘 다 조건을 만족하면 뒤쪽(halfway/first-showdown) 인터럽트를 고른다 — 스파링 중반이 정점에 가깝다.
Ch3·Ch6은 뒤쪽 인터럽트의 화자가 주인공(드라코·팽팽)이 아니라 해설자(하나·아라)이므로,
주인공이 실제로 말하는 first-turn 라인을 앵커로 쓴다.

| 챕터 | 인터럽트 id | 트리거 | 앵커 라인(화자 · 본문 앞부분) | CG id | 제목 | H3 seed |
|---|---|---|---|---|---|---|
| Ch1 도장의 문 | `act1-ch01:int-first-showdown` | first-showdown | 1번째 · **miyako** 「쇼다운이에요♪ 마지막까지 남은 사람끼리…」 (`effect: 'flash'` 유지) | `act1-ch01-climax` | 첫 쇼다운 | 509020260944 |
| Ch2 기다림의 미학 | `act1-ch02:int-halfway` | halfway | 1번째(유일) · **sakura** 「반이 지났어요. 계속 폴드하고 있어도…」 | `act1-ch02-climax` | 기다림의 반환점 | 509020260945 |
| Ch3 숫자는 거짓말을 안 해요 | `act1-ch03:int-first-turn` | first-my-turn | 2번째 · **draco** 「팟 두 배!! 이게 내 인사야!!」 (`effect: 'shake'` 유지) | `act1-ch03-climax` | 팟 두 배의 인사 | 509020260946 |
| Ch4 먼저 치는 사람 | `act2-ch04:int-halfway` | halfway | 1번째(유일) · **ara** 「반 왔네. 스틸은 몇 번 했어?…」 | `act2-ch04-climax` | 선제 타격 | 509020260947 |
| Ch5 받을 건 받아야죠 | `act2-ch05:int-first-showdown` | first-showdown | 1번째(유일) · **chloe** 「오~ 쇼다운! 이겼든 졌든 상대 카드 봤지?」 | `act2-ch05-climax` | 스테이션의 쇼다운 | 509020260948 |
| Ch6 3벳의 온도 | `act2-ch06:int-first-turn` | first-my-turn | 2번째 · **paeng** 「…시작하지. 망설이면 얼어 죽는다.」 | `act2-ch06-climax` | 빙점의 선전포고 | 509020260949 |

트리거는 전부 기존 것을 재사용한다. `first-showdown`(Ch1·Ch5)은 미션형 조기 종료로 쇼다운 없이
끝나면 발화하지 않을 수 있다 — 이는 **의도된 best-effort**다. 기록실 해금은 인터럽트 발화가 아니라
`completed.has(chapterId)`가 결정하므로, 못 본 플레이어도 챕터를 끝내면 기록실에서 볼 수 있다.

---

## 2. 산출물 (Deliverables)

작업 순서 = 아래 순서. 앞 단계가 검수를 통과해야 다음으로 간다.

**A. 스틸 CG 6장** (이번 스펙 승인 후 첫 작업)

| 파일 | 규격 |
|---|---|
| `public/assets/story/cg/scene-act1-ch01-climax.webp` | 768×1152 webp q82 |
| `public/assets/story/cg/scene-act1-ch02-climax.webp` | 〃 |
| `public/assets/story/cg/scene-act1-ch03-climax.webp` | 〃 |
| `public/assets/story/cg/scene-act2-ch04-climax.webp` | 〃 |
| `public/assets/story/cg/scene-act2-ch05-climax.webp` | 〃 |
| `public/assets/story/cg/scene-act2-ch06-climax.webp` | 〃 |

원본 PNG는 리포 밖 아트 작업 공간에 남긴다:
`C:\code\claude\poker-doku-art\story-rewards\out\cg\scene-<id>.png` (게임 리포에 커밋하지 않는다).

**B. 앰비언트 루프 영상 12파일** (스틸 승인 후)

`public/assets/story/video/scene-<id>.webm` + `.mp4` × 6 id.
768×1152 · 24fps · 106프레임(≈4.42초) · 무음 · 각 ≤2.5MB.

**C. 코드/매니페스트 변경** (B 완료 후, 전부 한 커밋)

1. `src/lib/assets/story-cgs.ts`
   - `SceneCgId` 유니온 +6, `SCENE_CG_IDS` 배열 +6. 배열은 각 챕터 블록 안에서
     prologue → climax → epilogue 순으로 끼운다 — 기록실 정렬이 이 배열 순서다.
   - `SCENE_CG_TITLE` +6(위 표의 제목).
   - `sceneCgChapterId`의 정규식을 `/-(prologue|climax|epilogue)$/` 로 확장.
   - `AVAILABLE` 주석의 배치 일자·장수 갱신(12 → 18).
2. 챕터 데이터 6파일 — 위 표의 앵커 라인에 `cg: '<id>'` 한 줄 추가. **다른 필드는 건드리지 않는다**
   (기존 `effect: 'flash'` / `'shake'`, 화자, 본문, 표정 유지. `bg`·`music`은 추가하지 않는다 —
   인터럽트는 스파링 테이블 위에 뜨는 오버레이라 배경/BGM을 바꾸면 테이블로 복귀할 때 어긋난다).
   - `src/lib/story/chapters/act1/ch01-dojo-gate.ts`
   - `src/lib/story/chapters/act1/ch02-art-of-waiting.ts`
   - `src/lib/story/chapters/act1/ch03-numbers-dont-lie.ts`
   - `src/lib/story/chapters/act2/ch04-first-strike.ts`
   - `src/lib/story/chapters/act2/ch05-take-what-is-yours.ts`
   - `src/lib/story/chapters/act2/ch06-three-bet-temperature.ts`
3. `src/lib/assets/story-video.ts` — `VIDEO_AVAILABLE`에 `scene-<id>` 6줄 추가,
   헤더 주석의 클립 수 갱신(43 → 49).
4. `scripts/art/story-video-h3.py` — `CLIPS`에 6항목(seed·prompt) 추가. 3차 배치 블록 아래에
   `# --- 2026-09-04 4차 배치: 클라이맥스 씬 CG 6 ---` 구획 주석.
5. `scripts/art/story-video.md` — 「4차 배치 기록」 표(id · seed · 생성 시간 · webm/mp4 용량) 추가.
6. 기존 테스트의 개수 상수만 갱신(새 테스트 파일은 만들지 않는다):
   - `src/lib/assets/story-cgs.test.ts` — `expect(SCENE_CG_IDS.length).toBe(12)` → `18`.
   - `src/lib/gallery/catalog.test.ts` — cg 섹션 `total` `19` → `25`
     (보상 CG 7 + 씬 CG 18).

---

## 3. 씬별 아트 디렉션

공통: 세로 1024×1536로 생성 → 768×1152로 변환. 캐릭터 + 배경이 한 장에 그려진 **풀 씬 이벤트 CG**
(버스트업 아님). 시점은 **히어로 좌석에서 테이블 너머를 보는 시선** — 프롤로그/에필로그 CG가
"장면 소개"라면 클라이맥스 CG는 "지금 내 앞의 상대"다.

### Ch1 · `act1-ch01-climax` 「첫 쇼다운」 — 미야코

쇼다운 순간의 딜러. 미야코가 테이블 너머에서 몸을 살짝 앞으로 기울여 커뮤니티 카드를 펼치는 손동작,
따뜻한 도장 등불 아래 청록 펠트, 가운데로 밀린 칩 더미, 흩날리는 벚꽃잎. 표정은 밝고 들뜬 미소.
카드는 앞면이 보이지만 **랭크·수트는 흐릿한 추상 문양**. 골드 림라이트, 축제 같은 밝은 톤.

### Ch2 · `act1-ch02-climax` 「기다림의 반환점」 — 사쿠라

폴드를 반복하는 중반의 격려. 사쿠라가 테이블 너머에서 엎어놓은 카드 두 장을 손끝으로 앞으로 밀며
(폴드 동작) 수줍게 웃는다. 다른 손은 가슴 앞에 모음. 거의 손대지 않은 칩 스택이 옆에 가지런히,
등불 하나가 따뜻하게 켜진 조용한 도장 방. 홍조 + 눈은 살짝 아래. 핑크/크림 파스텔, 차분한 톤.

### Ch3 · `act1-ch03-climax` 「팟 두 배의 인사」 — 드라코 + 하나

오버벳의 순간. 전경 중앙에 아기 드래곤 드라코가 펠트 위에 서서 두 앞발로 칩 더미를 통째로 앞으로
밀며 입에서 작은 오렌지 불꽃을 뿜는 개구진 표정. 뒤쪽 한 켠에 하나가 안경을 밀어 올리며 침착하게
지켜보고, 그 옆 홀로그램 패널에는 **읽을 수 없는 추상 막대/도넛 도형**만 보라색으로 빛난다
(숫자·글자 금지). 보라 스터디 조명 + 불꽃의 주황 대비, 화면이 흔들릴 듯한 역동적 구도.

### Ch4 · `act2-ch04-climax` 「선제 타격」 — 아라

선제 타격. 아라가 테이블 위로 상체를 크게 기울여 한 손으로 칩 스택을 앞으로 밀어붙이고
(다른 손은 펠트를 짚음) 도발적으로 웃는다. 트윈테일이 움직임에 날린다. 저녁 노을이 장지문으로 들어오고
머리 위 종이 등불. 밀려나는 칩 몇 개가 튀어 오른다. 붉은/금빛 강한 대비, 스피드감.

### Ch5 · `act2-ch05-climax` 「스테이션의 쇼다운」 — 클로이

쇼다운 공개. 클로이가 양손으로 자기 홀카드 두 장을 뒤집어 보여주며 입을 크게 벌리고 활짝 웃는다.
옆에 삼각대 스마트폰과 링라이트가 하얗게 얼굴을 비추고, 보라 네온 등불이 뒤를 물들인다.
펠트 위엔 칩 무더기. 카드 앞면은 보이되 **문양은 추상적으로 뭉개서** 읽히지 않게.
하늘색 머리 + 화이트/네온퍼플, 방송 화면 같은 밝고 소란스러운 톤.

### Ch6 · `act2-ch06-climax` 「빙점의 선전포고」 — 팽팽

헤즈업 개시. 파란 펠트를 사이에 두고 둥근 펭귄 팽팽이 정면에서, 한쪽 지느러미로 파란 칩 탑을
앞으로 밀며 무표정하게 응시한다. 몸 주위에 냉기와 떠다니는 얼음 결정, 펠트에 서리.
차가운 블루 키라이트 + 뒤쪽 도장 등불의 주황 림라이트 대비, 어둡고 긴장된 톤. 조연·관객 없음(헤즈업).

### 전 씬 공통 금지·주의

- **텍스트 금지**: 글자·숫자·로고·워터마크·서명 일절 없음. 화이트보드/홀로그램/방송 오버레이는
  전부 추상 도형으로.
- **카드 판독 금지**: 랭크·수트가 읽히면 안 된다(엔진이 만드는 실제 핸드와 모순된다).
  앞면이 필요하면 흐릿한 추상 문양, 가능하면 카드 뒷면이나 각도로 가린다.
- **손가락**: 손이 화면에 크게 나오므로 손가락 개수·관절 왜곡을 최우선 검수 항목으로 둔다.
  "칩을 미는 손"은 손등 위주 각도로 요청해 리스크를 줄인다.
- **여분 인물 금지**: 지정한 캐릭터 외 인물·실루엣·관객을 넣지 않는다.
- **스타일 고정**: 기존 씬 CG 12장·보상 CG 7종과 같은 갸루게 애니 일러스트, 클린 라인아트, 소프트 셀셰이딩,
  파스텔-네온 위 다크 바이올렛 분위기. 화풍을 바꾸지 않는다.

---

## 4. 생성 · 선택 정책 (스틸)

**도구**: 내장 `image_gen`. CG 1장당 **호출 1회**, 6장이면 서로 다른 6회 — 한 호출에 여러 장을 묶지 않는다
(호출당 프롬프트가 짧고 뚜렷할수록 정체성 유지가 잘 되고, 재생성 대상을 특정하기 쉽다).

**정체성 레퍼런스**: `C:\code\claude\poker-doku-art\story-rewards\ref\` 의 기존 PNG를 그대로 쓴다.
생성 직전에 해당 파일을 읽어 컨텍스트에 올린 뒤, 프롬프트에도 외형을 문장으로 다시 적는다
(레퍼런스 + 텍스트 이중 고정 — 3차 배치에서 검증된 방식).

| 챕터 | 레퍼런스 파일 |
|---|---|
| Ch1 | `miyako-showcase.png`, `miyako-neutral.png` |
| Ch2 | `sakura-showcase.png`, `sakura-neutral.png` |
| Ch3 | `draco-neutral.png`, `hana-showcase.png`, `hana-neutral.png` |
| Ch4 | `ara-showcase.png`, `ara-neutral.png` |
| Ch5 | `chloe-showcase.png`, `chloe-neutral.png` |
| Ch6 | `paeng-showcase.png`, `paeng-neutral.png` |

보조 레퍼런스로 같은 캐릭터의 기존 CG(`public/assets/story/cg/scene-act2-ch04-prologue.webp` 등)를
함께 참고해 조명·채도 톤을 맞춘다.

### 공용 프롬프트 스켈레톤

```
STYLE: anime visual-novel (galge) event CG illustration, full scene with painted background,
clean lineart, soft cel shading, pastel-neon accent palette (#ff7eb6 pink, #6be4ff cyan,
#a78bfa purple, #ffd76a gold) over a dark violet atmosphere (#150c26), cinematic rim light,
portrait 1024x1536, opaque, tasteful and wholesome, no chibi.

CHARACTER CONSISTENCY: match the attached reference images exactly — face shape, eyes,
hair color and hairstyle, skin tone, proportions, signature accessories. Only pose,
expression, framing and scene change.

CAMERA: viewed from the hero's seat across the poker table, the character on the far side.

HARD CONSTRAINTS: NO text, NO letters, NO numbers, NO logos, NO watermark, NO signature.
Playing card ranks and suits must be unreadable — abstract blurred markings only.
Any whiteboard / hologram / broadcast overlay shows abstract shapes only, never symbols.
Hands must be anatomically correct with exactly five fingers; prefer back-of-hand angles.
Only the characters listed below — no crowd, no extra people, no silhouettes.

SCENE: <씬 델타>
```

### 씬 델타 (프롬프트의 `SCENE:` 본문)

- **Ch1** — Miyako, the dojo dealer (dark purple upswept hair with a gold flower ornament and hanging
  gold tassels, amber eyes, white shirt, gold bow tie, black-and-gold embroidered vest), leans slightly
  forward over a teal-felt poker table and spreads the community cards face-up with one hand at the
  moment of showdown; a large pot of chips is pushed to the center, warm paper-lantern light and
  drifting cherry petals fill the dojo room. Bright delighted smile, gold rim light, festive warm tone.
- **Ch2** — Sakura (short pink bob, white flower hairpin, pink eyes, cream cardigan over a white blouse
  with a pink ribbon) sits across the table and gently pushes two face-down cards forward with her
  fingertips — a fold — while her other hand rests over her chest; a barely-touched neat stack of chips
  sits beside her in a quiet lantern-lit dojo room. Shy encouraging smile, blush, eyes slightly lowered.
  Pink and cream pastels, calm patient mood.
- **Ch3** — In the foreground a small teal baby dragon (Draco: cream egg-shell hat, golden belly scales,
  tiny wings) stands on the felt and shoves an entire mound of chips forward with both front paws while
  puffing a small orange flame from its mouth, cheeky triumphant grin; behind and to one side Hana
  (long purple hair with a small side braid, thin glasses, dark purple suit) calmly pushes up her
  glasses, a violet holographic panel beside her glowing with abstract bars and rings only. Violet
  study lighting against the orange flame, dynamic off-balance composition.
- **Ch4** — Ara (long red twin-tails tied with black ribbons, sharp red eyes, black cropped jacket with
  gold trim and a gold dragon emblem over a red crop top) leans far across the green felt, shoving a
  chip stack forward with one hand while the other braces flat on the table, taunting grin, twin tails
  swinging with the motion; a few chips bounce loose, sunset light through shoji screens and a paper
  lantern overhead. Red and gold contrast, high-speed aggressive energy.
- **Ch5** — Chloe (fluffy light sky-blue wavy hair with snowflake clips and one upright strand, big blue
  eyes, blue-and-white hoodie with star patches) flips her two hole cards face-up with both hands at
  showdown, mouth wide open in a delighted grin; a smartphone on a small tripod and a glowing ring
  light wash her face white, purple neon lanterns behind, heaps of chips on the felt. The card faces are
  smeared and unreadable. Loud bright streaming-broadcast mood.
- **Ch6** — Heads-up across a blue-felt table: a large round black-and-white penguin creature (Paeng,
  ice-crystal crest, pale blue bow tie) faces the viewer head-on and pushes a tall tower of blue chips
  forward with one flipper, expressionless cold stare; freezing mist and floating ice crystals surround
  it, frost creeps across the felt. Cold blue key light against a warm orange lantern rim from behind,
  dim and tense, no other characters.

### 선택 정책

1. 1콜 → 후보 1장 → **반드시 눈으로 검수**(Read로 이미지 확인). 체크리스트:
   정체성(머리색·눈·의상·소품) / 손가락 / 글자·숫자 유무 / 카드 판독 여부 / 여분 인물 / 화풍·채도.
2. 통과하면 확정. 실패하면 **실패 항목 한 가지만 프롬프트에 추가·강조**해 재생성(같은 CG 최대 2회 재시도).
3. 3회로도 못 잡으면 그 CG는 보류하고 나머지를 진행한 뒤 사용자에게 보고한다 — 절대 어긋난 장을
   확정하지 않는다(보류분은 매니페스트·챕터 라인에서 빼고 나머지로 커밋).
4. 확정본은 `poker-doku-art/story-rewards/out/cg/scene-<id>.png`에 저장한 뒤 변환:

   ```bash
   node scripts/art/convert.mjs cg \
     "C:/code/claude/poker-doku-art/story-rewards/out/cg/scene-act1-ch01-climax.png" \
     public/assets/story/cg/scene-act1-ch01-climax.webp
   ```

---

## 5. 애니메이션 (H3 앰비언트 루프)

스틸 6장이 확정된 **뒤에만** 시작한다. CG가 바뀌면 영상도 다시 만들어야 하므로 순서를 뒤집지 않는다.

### 사전 조건

1. LM Studio가 모델을 VRAM에 올려 두었으면 **먼저 언로드**한다(H3 피크 ≈28GB).
2. ComfyUI 포터블 기동(백그라운드, 입출력은 D 드라이브):

   ```powershell
   Start-Process -FilePath 'C:\code\1. codex\AI-Image-Video\ComfyUI_windows_portable\python_embeded\python.exe' `
     -ArgumentList '-s','ComfyUI\main.py','--windows-standalone-build','--input-directory','D:\AI-Image-Video\input','--output-directory','D:\AI-Image-Video\output','--temp-directory','D:\AI-Image-Video\temp' `
     -WorkingDirectory 'C:\code\1. codex\AI-Image-Video\ComfyUI_windows_portable' -WindowStyle Hidden
   ```

   준비 확인: `curl http://127.0.0.1:8188/system_stats`.
3. 입력 PNG 배치 — `LoadImage`는 input 최상위 파일만 목록에 올린다:

   ```bash
   node -e "require('sharp')('public/assets/story/cg/scene-act1-ch01-climax.webp').png().toFile('D:/AI-Image-Video/input/pd-scene-act1-ch01-climax.png')"
   ```
4. **러너는 반드시 분리 프로세스**로 띄운다 — 에이전트 백그라운드 명령은 10분에 강제 종료되므로
   6클립(≈10~12분)을 한 호출에 걸면 끊긴다:

   ```powershell
   Start-Process python -ArgumentList 'scripts/art/story-video-h3.py','v1','scene-act1-ch01-climax','...' `
     -RedirectStandardOutput batch4.log -WindowStyle Hidden
   ```

   완료 대기는 로그 폴링(`grep -c DONE batch4.log`).

### 클립 제약

`story-video-h3.py`의 `STYLE` 상수(고정 카메라 · 줌/팬 금지 · 첫 프레임 = 끝 프레임 · 대사/자막/로고 금지)를
그대로 상속하고, 각 프롬프트는 다음만 추가한다.

- 캐릭터 외형 한 문장 재기술(머리색·눈·의상·소품) — 스틸 프롬프트의 정체성 문장을 재사용.
- 움직임은 **`Subtle ambient motion only`** 뒤에 미세 요소만 열거:
  벚꽃잎·머리카락·등불 흔들림·눈 깜빡임 1회·불꽃·얼음 결정 반짝임·먼지·네온 점멸 정도.
- **카드·칩·손은 고정**을 명시한다(`the cards, chips and her hands stay perfectly still`,
  `her pushing hand stays in place`). 여섯 장 모두 "칩을 미는/카드를 여는" 자세라, 손이 움직이면
  루프 이음새가 무너지고 액션이 반복되는 것처럼 보인다.
- 대사·자막 없음. 오디오는 인코딩에서 제거하므로 무음 전제.
- 길이 `LENGTH=107`(24fps → 4.46초), 인코딩에서 마지막 프레임(= 첫 프레임 복제)을 버려 106프레임 ≈4.42초.

시드는 `CLIPS`에 `509020260944`(Ch1) … `509020260949`(Ch6) 순서로 고정한다.
재생성이 필요하면 `CLIPS`를 고치지 말고 `H3_SEED_OFFSET=1000 … v2`(추가 실패 시 `2000 … v3`)로 돌린다.

### 인코딩

```bash
bash scripts/art/story-video-encode.sh v1 scene-act1-ch01-climax ...   # webm+mp4 동시, 106프레임
```

목표 용량 webm/mp4 각 ≤2.5MB(기존 배치 실측 0.5~1.9MB).

---

## 6. 검증 (최소 범위)

전체 스위트 · `npm run build` · 브라우저 자동화는 **하지 않는다**. 아래만 돌린다.
메모리 크래시 방지를 위해 vitest는 **한 번에 파일 하나**씩 실행한다.

```bash
npx vitest run src/lib/assets/story-cgs.test.ts          # 유니온·챕터 매칭·개수 18
npx vitest run src/lib/gallery/catalog.test.ts           # cg 섹션 total 25
npx vitest run src/lib/story/chapters/act1/act1.test.ts  # validateChapters (cg id 검증 포함)
npx vitest run src/lib/story/chapters/act2/act2.test.ts
npx tsc --noEmit                                         # 유니온 확장 타입 확인
```

파일 실체 확인:

```bash
ls -l public/assets/story/cg/scene-*-climax.webp
ls -l public/assets/story/video/scene-*-climax.webm public/assets/story/video/scene-*-climax.mp4
for f in public/assets/story/video/scene-*-climax.mp4; do
  ffprobe -v error -show_entries stream=width,height,nb_frames,codec_type \
          -show_entries format=duration,size -of default=nw=1 "$f"
done
```

기대값: webp 768×1152 · 대략 90~180KB, mp4/webm 768×1152 · 106프레임 · ≈4.42초 ·
오디오 스트림 없음 · 각 ≤2.5MB.

선택적 수동 확인 1건: 로비 → 기록실 「이벤트 CG」에서 새 6장이 해당 챕터 완주 조건과 함께 보이는지.
자동화 창처럼 문서가 `hidden`이면 Chrome이 무음 영상을 정지시키므로, 재생 확인은 포그라운드 탭에서 한다.

---

## 7. 실패 · 재시도 · 복구

| 상황 | 대응 |
|---|---|
| 스틸이 정체성·손·글자 검수에서 실패 | 실패 항목 하나만 강조해 같은 CG 재생성(최대 2회). 3회 실패 시 그 CG 보류 — 매니페스트·챕터 라인에서 제외하고 나머지로 커밋한 뒤 보고 |
| ComfyUI가 8188에 안 뜸 / VRAM 부족 | LM Studio 언로드 후 재기동, `/system_stats`로 확인. 그래도 안 되면 스틸까지만 커밋하고 영상은 다음 배치로 미룬다(영상 미등록이면 정지 CG로 정상 동작) |
| 러너가 중간에 끊김 | 남은 id만 인자로 다시 실행(`run`은 id 단위 독립). 로그의 마지막 `DONE`으로 재개 지점 판단 |
| 클립 한 개만 흔들림 / 입이 벌어짐 | `H3_SEED_OFFSET=1000 … v2`로 그 id만 재생성. `CLIPS` 시드 상수는 유지하고 채택 버전을 `story-video.md`에 기록 |
| 900초 타임아웃 | 러너가 그 클립을 포기하고 다음으로 넘어간다 — 배치 종료 후 실패분만 재실행 |
| CG를 나중에 수정하게 됨 | **영상도 반드시 재생성**한다(첫/끝 프레임이 CG와 달라 루프가 튄다). 아라 Lv15 선례 참조 |
| 커밋 후 이미지가 안 보임 | `AVAILABLE`이 `SCENE_CG_IDS` 전체라 파일 누락이 곧 깨진 이미지다. webp 6장 존재를 먼저 확인 |

**롤백**: 이 배치는 순수 추가다. 되돌릴 때는 커밋 하나를 revert하면 유니온·챕터 라인·영상 등록이
함께 사라지고 기존 씬 CG 12장 상태로 복귀한다. 부분 revert는 금지 — 챕터 라인만 남으면
`validateChapters`가 unknown cg로 throw한다.

---

## 8. 비목표 (이번 배치에서 하지 않는 것)

- Ch7 가면 봇 아트 / identity 분리
- 봇 30종 표정 확장
- 3막(Ch7~) 챕터 데이터·CG
- 신규 BGM·징글
- 실패 씬(`failScene`) CG, 하드 모드 연출
- 새 씬·새 대사·새 인터럽트 트리거 추가 (기존 라인에 `cg` 한 줄만 붙인다)
- 전체 테스트 스위트 · 프로덕션 빌드 · 브라우저 QA · 배포 (별도 지시 시)

위 항목은 후속 배치 후보로 남긴다.
