# 2026-09-06 R4(4막) 완료 · 보너스 CG 파이프라인 인계 — Fable 총괄

> 총괄 Claude Fable 5.1(`claude-fable-5-1`). 구현 Claude Opus(`claude-opus-5`, Agent 도구 `model: "opus"`), 검토 GPT 6 Astra
> (`codex exec -m gpt-6-astra -c model_reasoning_effort="high" -s read-only`). 이전 시작점: [2026-09-06-fable-orchestration.md](2026-09-06-fable-orchestration.md).
> 이번 세션은 **배포·push 없음**(사용자 지시 없었음). main HEAD `87f47d3` + 이 인계 배치.

## 1. 완료된 것

| 배치 | 내용 | 계획/검토 | main 병합 |
| --- | --- | --- | --- |
| R4a | MDF·SnG 드릴 템플릿(`drills/templates/{mdf,sng}.ts`, `sng-thresholds.ts`, 수기 `authored/act4.ts`) | `plans/2026-09-06-r4a-mdf-sng-drills-plan.md`, `reviews/2026-09-06-r4a-drills-astra.md` | `543dac6`(사소한 `sng-orbit-cost` 삭제 포함) |
| R4b | Ch10 폭풍 콜다운 · Ch11 올라운드(목표 kind `topair-calldown`·`no-air-reraise`·`overbet-decision`·`executed-any`·`any-k-of` 체크리스트, `'*review'` 복습 슬롯 + `reviewPool`, `'heroine-fill'` 라인업 토큰, 리뷰 정책 `overbetPolarized`, 보상 v37) | `plans/2026-09-06-r4b-ch10-ch11-plan.md`, `reviews/2026-09-06-r4b-act4-astra.md`·`r4b-impl-astra.md` | `af5386c` |
| R4c | Ch12 졸업 시험 — 실제 6인 practice SnG(`src/server/sng-structures.ts` 졸업 1,000칩/2분, 표준 1,500/3분 불변), `story_graduations`(v38) 선저장 영수증, 검은띠 코스메틱(카드백/펠트 v38), 졸업생/사범대리 칭호, `StoryRunMode 'graduation'`, Ch12 exam 비활성 | `plans/2026-09-06-r4c-ch12-graduation-plan.md`, `reviews/2026-09-06-r4c-graduation-astra.md`·`r4c-impl-astra.md`(P1 2·P2 3 → `87f47d3`에서 전부 수정) | `87f47d3` |

- 최종 전체 Vitest(`--maxWorkers=4`) 2,773 통과, main에서 `npm run build`·lint·tsc 통과.
  (junction 워크트리에서는 Turbopack이 `node_modules` 심링크를 거부하므로 build는 main에서만.)
- 계약 요점(코드가 정본): 졸업 모드 = 토너먼트 스파링·에필로그 씬·결산만 진입(`isGraduationStep`), 완료 기록·XP·인연·칩 없음·순위 영수증만.
  `belt:black`/`graduation:champion`은 단조 플래그(낮은 순위 재도전이 회수하지 않음). 검은띠 = `deriveBelt==='black'`(4막 3챕터 완주 + 플래그).
  결산 확정은 `completeChapterAtomic`(완료·XP·영수증 한 트랜잭션), 실패는 `persistPending` + 'persist' hold로 자동·수동 재시도, 운영자 skip도 저장 대기 뒤에만 통과.

## 2. Ch12 브라우저 QA (dev :3000, 프로필 벚꽃부엉이#8799 = `p_PjSJkc3FffxTvIPaItkDCw`, 운영자 모드)

| 항목 | 결과 |
| --- | --- |
| 허브 CH12 카드 | 실력 확인 버튼 없음. 완주 뒤 [다시]·[졸업 대결만] 2버튼, S·완료 1회 표시 |
| 실제 SnG | 6인 50BB(1,000칩) 10/20, 레벨 2분(`↑1:57`), 수련 테이블 리본·HUD 「남은 인원 N/6 · 레벨 · 탈락하거나 우승하면 끝나요」 |
| 재접속 / 자리비움 | 소켓 재연결 시 같은 좌석 복귀, 자리비움은 블라인드 계속 차감 + [게임 복귀] 버튼(SnG 계약) |
| 에필로그 분기 | 2위 → ITM 씬(사쿠라 파트너 씬 뒤 다른 파트너 씬은 서버가 스킵), 15/15 결산 준비 |
| 선저장 | 결산 전에 `story_graduations{place 2, entrants 6, mode full, source play}` + `belt:black='1'` 존재 |
| 결산(full) | 순위 카드 2/6위 「입상 — 검은띠 자격을 얻었어요」, S·PERFECT 9/9, 첫 완주 도장 XP +620·인연 +30×6, 보상 졸업생 칭호·퍼펙트 칭호·연습 칩 +800, CTA 허브로/다시 졸업 대결/다음 챕터/기록실. 검은띠 배너 없음(4막 미완주 — 정상) |
| DB(full 뒤) | `story_progress` act4-ch12 completions 1·best S, `story_rewards` 4건(graduate·first chips·S chips·perfect), `progression_events` 1건(v34 일반 레벨 보상 2종 동반 지급) |
| 졸업 재도전 | [졸업 대결만] → 씬·드릴 없이 즉시 SnG, 6위 탈락 → 에필로그 → 결산 「6/6위 · 순위만 기록돼요 — 수련 보상은 첫 완주 때 이미 받았어요」, 등급·드릴 통계·보상 카드 없음 |
| DB(재도전 뒤) | attempts 2·completions 1 유지, 영수증 4건 유지, 졸업 행 2건(두 번째 `mode graduation, place 6`), `belt:black` 유지, XP 이벤트 추가 없음 |

QA 데이터는 dev SQLite(`data/poker-doku.sqlite`)에만 있다. dev 서버는 종료했다.

## 3. 보너스 이벤트 CG 파이프라인 상태

- 계획·도구: `docs/superpowers/plans/2026-09-06-bonus-cg-pipeline.md`(`19c88e9`), `scripts/art/bonus-cg/*`, 라이브러리 원장 scope `'bonus'`.
- 산출: 원화 50장(GPT Image 2, 스테이징 `C:/code/claude/poker-doku-art/bonus-cg/out/<id>/<scene>.png`, 사쿠라 gym은 v2 재생성) + H3 루프 50개
  (원장 `D:/AI-Image-Video/output/poker-doku-library/bonus-cg-20260906`, 린 요가는 `bonus-lin-yoga-video-v4` — v1~v3 반려). 웹 인코딩 전부 2.5MB 이내.
- 원장 상태: 이미지 50 approved(총괄 1차 검수 — provisional), 영상 50 generated, 3 rejected. **사용자 최종 검수 전 approve-videos/export/등록 금지.**
- 이번 배치에 커밋한 도구 변경: 계획 JSON(사쿠라 gym 문구), `ledger_bonus.py`(`BONUS_SEED_OFFSET`/`BONUS_VIDEO_EXTRA`/`BONUS_MOTION_OVERRIDE`,
  `video_job_of` — 원장에서 최신 비반려 video job을 찾아 approve-videos/export가 `-v4` 같은 재생성 id를 자동 사용), `video-sheets.sh`(진행 중 클립 ffprobe 스킵),
  `video-montage.mjs`, 영수증 `recipes/bonus-cg-20260906/`(50×external+provenance), 영상 매니페스트 7개.
- **검토 화면**(2026-09-06 사용자 요청): `node scripts/art/bonus-cg/review-page.mjs`가 `<staging>/review/index.html`을 만들고
  `node scripts/art/bonus-cg/review-serve.mjs`(Range 206 지원 — python http.server는 Range 미지원이라 Chrome 영상이 멈춘다)로
  `http://127.0.0.1:8765/review/`에서 50루프(mp4/webm 100파일)+원화를 승인/반려·메모하고 [반려 목록]으로 「캐릭터:장면」 텍스트를 뽑는다.
  상태는 브라우저 localStorage(`bonus-cg-review-<batch>`), JSON 저장/불러오기 가능. 원장에서 최신 비반려 video job을 찾으므로 린 요가는 v4를 보여준다
  (`encode-probe/bonus-lin-yoga-video-v4.*`는 같은 설정으로 재인코딩해 추가). 반려 재생성 뒤에는 probe 재인코딩 + 페이지 재생성.
- 게임 연결 계약: `docs/superpowers/plans/2026-09-06-bonus-cg-integration-plan.md`(카탈로그 `line:'bonus'` 50항목, 트리거 affinity-level/dojo-level,
  임계 casual→sing→yoga→gym→beach = 인연 4/8/12/16/20·도장 10/20/30/40/50, 기록실 'bonus' 섹션, 설정 `showBonusCg`, v39, `VIDEO_AVAILABLE`).

## 4. 다음 시작점

1. 사용자의 반려 목록(「캐릭터:장면」)을 받는다. 반려는 원장 `review <job> rejected --sha256 <hash>` → 원화 재생성(`build-prompts.mjs` → `run-wave.sh` → `collect-outputs.mjs`)
   → `receipts`/`approve` → `video-manifest`(환경변수 변형) → `run --watch`. 야외 장면 재생성 시 모션 큐에서 실내 소품(커튼·김)을 뺀다(`BONUS_MOTION_OVERRIDE`).
2. 확정되면 포터블 파이썬으로 `ledger_bonus.py approve-videos <전체>` → `export <전체>`(`.worktrees/bonus-cg-assets`, 브랜치 `feat/bonus-cg-assets`)
   → 50쌍 커밋 → main ff.
3. Opus 구현 배치(워크트리 `.worktrees/bonus-cg-integration`)를 연결 계획대로 실행 → Astra 경계 검토(자격 판정·토글·NEW 기준선) → 총괄 통합.
4. push/deploy는 사용자 지시 때만. 후순위: 하드 모드·파트너별 Ch1 변주·2막 질문권·추가 의상.
