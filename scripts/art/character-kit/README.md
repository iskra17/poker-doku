# 캐릭터 키트 — 턴어라운드 기반 의상·포즈 제작

히로인의 **턴어라운드(정면·3⁄4·측면·3⁄4 후면·후면)** 를 기준 원화로 두고, 같은 캐릭터의 새 의상과 포즈를 만든다.
원화는 리포 밖 `ART_ROOT`(기본 `C:/code/claude/poker-doku-art`)에 두고, 게임에는 검수·변환한 webp만 넣는다.

## 폴더

```
ART_ROOT/characters/<id>/
  bust-reference.png          # 기본 버스트 (public/assets/characters/<id>/confident.webp에서 변환)
  turnaround/{front,three-quarter,side,three-quarter-back,back}.png   # 1024×1536, #00ff00 배경
  jobs/<jobId>/{prompt.txt, out/, logs/, contact.png}                 # 러너가 만드는 작업 폴더
```

디자인 스펙(머리·눈·액세서리·기본 의상·화풍)은 `characters.json`에 캐릭터별로 적는다. 모든 프롬프트의 고정 문단이 된다.

## 실행

```bash
node scripts/art/character-kit/run.mjs scripts/art/character-kit/jobs/<job>.json --dry-run   # 프롬프트·레퍼런스 확인
node scripts/art/character-kit/run.mjs scripts/art/character-kit/jobs/<job>.json             # 생성 (수 분)
```

- 레퍼런스는 `-i`로 첨부하고 프롬프트는 stdin으로 보낸다. 격리 `CODEX_HOME`을 써서 전역 훅·스킬이 exec를 멈추지 않게 한다.
- 저장이 정책으로 막혀도 로그의 `생성 파일 → ./out/...` 매핑으로 `generated_images`에서 회수한다. 회수하지 못한 샷이 있으면 종료 코드 2.
- 모델은 `CHARACTER_KIT_MODEL`(기본 `gpt-5.6-sol`). 그림 품질은 모델과 무관하다(내장 image_gen).

## job 형식

```json
{
  "character": "sakura",
  "id": "outfit-stage-pilot",
  "kind": "outfit",                     // outfit: 옷만 교체 / pose: 기본 의상 유지
  "outfitId": "stage",
  "outfit": "의상 설명 (영어)",
  "references": ["bust", "front", "threeQuarter", "back"],
  "shots": [
    { "out": "bust/neutral.png", "framing": "bust", "direction": "표정·제스처 설명" }
  ]
}
```

`framing`: `bust`(1024² 버스트, 크로마키) · `fullbody`(1024×1536 전신, 크로마키) · `cg`(배경 있는 1024×1536 장면).

## 게임에 넣기 (의상)

1. `contact.png`로 검수한다. 얼굴·머리·헤어핀이 턴어라운드와 다르면 그 샷만 다시 만든다.
2. 버스트 3종을 변환한다:
   `node scripts/art/convert.mjs bust <job>/out/bust/neutral.png public/assets/characters/<id>/outfits/<outfitId>/neutral.webp` (happy·confident도 같게)
3. `src/lib/assets/character-art.ts`의 `OUTFITS`에 `<outfitId>: ['neutral','happy','confident']`를 등록한다.
4. 보상으로 지급하려면 `src/lib/story/rewards/catalog.ts`에 의상 항목을 추가하고, 다음 마이그레이션 INSERT에도 같은 항목을 넣는다 (AGENTS.md 보상 라인 규칙).

필살기 포즈는 `public/assets/characters/<id>/skill/<pose>.webp` + `character-art.ts`의 `SKILL_POSES` + `src/lib/skills/catalog.ts`의 `poses`에 연결한다.

## 새 캐릭터 준비

1. `characters.json`에 스펙을 추가한다.
2. 기본 버스트를 `bust-reference.png`로 둔다.
3. 턴어라운드 job(`kind: "pose"`, `fullbody` 5샷: 정면·3⁄4·측면·3⁄4 후면·후면, 같은 서 있는 자세)을 돌리고 `turnaround/`로 옮긴다.
   하반신처럼 기존 원화에 없는 부분은 `characters.json`의 `defaultOutfit`에 명시해 모든 뷰가 같게 나오도록 한다.
