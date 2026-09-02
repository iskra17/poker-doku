# 수련 스토리 — 영상 파일럿 + 2막 데이터 세션 인계 (2026-09-03, 5차 세션)

브랜치 `feat/story-video-pilot` (worktree `.worktrees/story-mode`, main 9ce2615에서 분기). 기획 `docs/spec-story-mode-2026-09.md` **Part V**,
규약 AGENTS.md 스토리 섹션(데이터·드릴·보상 라인·v74 ④ 영상 bullet 갱신). 커밋: d3aea38(영상 파일럿 3클립 + 숫자 입력 잔존 수정) → 2막 배치 커밋.
**main ff 병합 완료(태그 `story-act2`), origin 푸시·Fly 배포는 미실행** — 사용자 지시 시 `git push origin main --tags`, `fly deploy --ha=false`(PowerShell `$env:USERPROFILE\.flyinlyctl.exe`).

## 새 세션 시작 절차

1. worktree `.worktrees/story-mode`에서 `git checkout -b feat/<topic>`(main 병합 뒤라면 main에서). `npm ci` 되어 있음.
2. 이 문서 + AGENTS.md 스토리 섹션 + 기획 Part V + `scripts/art/story-video.md`를 읽는다.
3. 메모리 [[project_story-mode-plan]]·[[reference_comfyui-h3-video]](ComfyUI 위치·H3 절차)·[[reference_codex-image-gen]](read-only 회수) 참고.
4. 브라우저 QA는 `tabs_context_mcp{createIfEmpty:true}` 창에서. **탭을 다 닫으면 다음 창이 277×73으로 열릴 수 있다** — `innerWidth`가 작으면
   탭을 닫고 다시 만들 것(resize_window는 효과 없었음). 문서가 hidden이면 무음 `<video>`·BGM은 정지된다 — readyState/DOM으로만 판정.
   드릴 답안은 DOM `innerText`(카드 랭크·수트가 텍스트로 나온다)를 읽고 JS로 버튼을 눌러 제출하는 게 스크린샷보다 빠르고 안정적이다.
5. dev 서버는 `npm run dev` 백그라운드 + `/healthz`; **서버 코드(챕터 레지스트리 등) 변경 후엔 재시작**(tsx는 watch 아님).

## 이번 세션 결과

### 영상 파일럿 (커밋 d3aea38)
- Codex가 만든 `C:\code\1. codex\AI-Image-Video\ComfyUI_windows_portable`(v0.34, torch 2.13+cu130)에 **MiniMax H3**가 이미 있어
  Wan 2.2 다운로드 없이 `MiniMaxH3ImageToVideo(first_frame = last_frame = CG)`로 768×1152·107f·24fps 루프를 클립당 ~100초에 뽑았다.
- 3클립(`story-cg-act1-belt-yellow`·`story-cg-act1-draco-boss`·`sakura-scene-lv5`) webm/mp4 ≤1.5MB 배치 + `VIDEO_AVAILABLE` 등록.
  러너 `scripts/art/story-video-h3.py`, 절차 `scripts/art/story-video.md`. 원본은 `D:\AI-Image-Video\output\poker-doku\`.
- 실주행 확인: Ch1·Ch3 실력 확인 퍼펙트 컷인(우측 상단 카드), 콤보 스탬프/토스트, 결산 S·보상 카드·CG 컷신·[기록실 보기]→기록실,
  드라코 보스 CG 스테이지에 `<video>` 로드(readyState 4), 1막 완주 노란띠 승급 CG도 `<video>` 로드, 보관함 칭호 장착 → Practice Dojo 좌석 플레이트,
  설정 사운드 탭 MusicTrackPicker 렌더. **BGM 청취·영상 실제 재생은 사용자 실기기 확인 필요**(자동화 창 hidden).
- 버그 수정: 연속 숫자 문항에서 이전 답이 입력칸에 남던 문제(`DrillCard`가 `DrillAnswerInput`을 문항 key로 리마운트).

### 2막 데이터 (Ch4~6)
- 드릴 템플릿 8종(`breakeven.ts`·`sizing.ts`·`opponent-type.ts`·`range.ts` 3벳 2종) + 수기 D-ACT 8문(`authored/act2.ts`), 해설 말투 아라·클로이
  (`explain.ts toCasual()` — 공용 core의 존댓말 어미를 반말로), 목표 kind 7종(`objectives.ts`), 3벳 임계(`open-thresholds.ts`).
- 챕터 `chapters/act2/ch04-first-strike.ts`·`ch05-take-what-is-yours.ts`·`ch06-three-bet-temperature.ts` + `act2.test.ts`(15 테스트),
  씬 CG 6장 + 보상 CG 3장(`public/assets/story/cg/*act2*`), 의상 아라 `jersey`·클로이 `stream`, 보상 카탈로그 16항목(v33), 파란띠 카드백/펠트.
- 실주행: 허브 2막 잠김 → Ch2 실력 확인으로 1막 완주 → 2막 개방 → Ch4 프롤로그 CG·개념 카드·함께 풀기 2블록·드릴 7문 서버 채점 전부 정답(퍼펙트)·
  연습 테이블 첫 핸드 K♥T♣ 딜 → 포기(abandon). **스파링·보스전(팽팽 HU 50BB)·Ch5·Ch6 라이브 스텝은 미실주행.**
- 검증: tsc ✓ · eslint ✓ · vitest 전체(--maxWorkers=4) — 실행 결과는 아래 「검증」.

## 다음 세션 순서

1. **사용자 실기기 피드백**: 영상 3클립 재생·루프 이음새, BGM 순환/미리듣기, 2막 대사 톤(아라 반말·클로이 스트리머체), 새 드릴 난이도.
2. 2막 라이브 스텝 실주행: Ch4 스파링(스틸·c벳·림프 0 목표 집계가 실제 핸드에서 맞게 도는지 — 특히 `steal-open`의 CO/BTN 판정·`no-limp`),
   Ch5(리버 밸류/에어/사이징), Ch6 보스 팽팽 헤즈업(`premium-3bet`·`fold-vs-3bet-junk`·`no-junk-4bet` — 헤즈업 포지션 라벨 'BTN/SB'/'BB'에서
   `OPEN_THRESHOLDS['BTN/SB']`가 undefined라 오픈 기회는 안 잡히지만 3벳 대면 사실은 포지션 무관). 필요하면 `objectives.ts` 보정.
3. 영상 확장: 나머지 보상 CG(백띠 수여·기다림의 뜰·팽팽 보스·아라 승리·파란띠 승급) + 인연 씬 — 절차 그대로, 클립당 ~2분.
4. 3막 데이터(비비안·클로이·엘레나, 가면 봇 identity 분리 선행) 또는 하드 모드.

## 함정·교훈

- codex `--sandbox workspace-write`를 줘도 샌드박스가 read-only로 뜨는 일이 반복된다 — 로그의 `call_*.png` 매핑(또는 Copy-Item 라인)으로
  `codex-home/generated_images/<세션>/`에서 회수. 매핑이 없는 배치는 파일 생성 시각 순 = IMAGE 순.
- 개념 카드 본문의 `1.5BB`·`3.5%` 같은 소수점은 act 테스트의 "2문장 이하" 검사에서 마침표로 세인다 — `1½BB`·`3½%`로 쓴다.
- `pickOne`에 빈 배열을 주면 throw → 생성 템플릿은 후보가 비면 `null`(리롤)을 돌려야 100시드 테스트가 산다.
- 히로인은 어떤 드릴에도 상대로 나오지 않는다(kit 규약, `generator.test.ts` 풀 단언) — D-TYPE 풀은 비히로인 봇 8명.
- 마이그레이션 버전을 올리면 `database.test.ts` 외에 `arena-legacy-season-upgrade.test.ts`의 `{ version: N }`도 함께 올린다.
- 결산 리빌은 synthetic click으로 안 넘어간다(포인터 이벤트) — 실제 클릭 좌표 사용.
