# 운영자 모드 · 2막 실주행 · 컷신 영상 2차 세션 인계 (2026-09-04, 7차 세션)

## 0. 현재 상태 한눈에

| 항목 | 상태 |
|---|---|
| main | `ea99b76` = origin/main (푸시 완료), 태그 `story-act2`(d0bfabc) |
| 브랜치/worktree | `feat/operator-mode` = main, worktree `.worktrees/story-mode`(`npm ci` 완료) — 다음 세션은 여기서 `git checkout -b feat/<topic>` |
| 배포 | Fly **v80** = main `ea99b76`. 시크릿 `OPERATOR_PROFILE_IDS` = 새벽참새#4125(`p_lQCfPcv1YEaXnchwdId2SA`), 여름토끼#9490(`p_OT35-SxJ6nzJAVEGdO8l2A`) |
| 검증 | `npx tsc --noEmit` ✓ · `npm run lint` ✓ · 변경 파일 단위 vitest 전부 통과(전체 스위트는 이번 세션 미실행 — 다음 세션 시작 시 `--maxWorkers=4` 1회 권장) |
| 로컬 프로세스 | dev 서버·ComfyUI·자동화 브라우저 탭 모두 종료됨 |
| 규약 문서 | AGENTS.md 「운영자 모드」 bullet(신규), 스토리 섹션 영상 bullet(9클립), `scripts/art/story-video.md`(2차 배치 기록) |
| 메모리 | [[project_operator-mode]](신규) · [[project_story-mode-plan]](6·7차 이력) · [[reference_comfyui-h3-video]](2차 배치 교훈) · [[project_deployment]](v77~v80) |

이전 인계 `2026-09-03-act2-video-handoff.md`의 §1~§7은 여전히 유효하고, 그 문서 §8에 이번 세션 실주행 상세가 있다.

## 1. 새 세션 시작 절차

1. 이 문서 → AGENTS.md 스토리 섹션 + 「운영자 모드」 bullet → `scripts/art/story-video.md`.
2. worktree `.worktrees/story-mode`에서 `git checkout -b feat/<topic>` (main = feat/operator-mode).
3. dev 서버는 worktree에서 `npm run dev` 백그라운드 + `curl localhost:3000/healthz`. 끝나면 3000 포트 리스너 `Stop-Process`.
4. **QA는 운영자 모드로**: dev에선 모든 프로필이 운영자(env 없음) → 로비 로고를 3초 안에 7번 탭 → OP 배지. 잠긴 챕터를 바로 열고
   씬·레슨·드릴·연습 스텝은 [⏭ 스킵], 스파링만 실제로 친다. 스킵은 실제 완주 경로라 보상이 지급된다(테스트 프로필 사용).
5. 브라우저 자동화 함정은 §4.

## 2. 이번 세션에서 한 것 (커밋 순)

| 커밋 | 내용 |
|---|---|
| c1c7228 · e22716b | **운영자 모드** — 서버 capability `operator`(`operator-access.ts`), 잠긴 챕터 시작 우회, `story-advance target:'skip'`(드릴 퍼펙트 강제·라이브 `forceFinish`·결산 확정). 클라 로고 7연타(`secret-tap.ts`)·`operator-store`·기록실/인연 탭 전 항목 미리보기·의상 로컬 미리보기·[⏭ 스킵] |
| f233aba · efbc591 | 비비안 Lv5 「분장실」 CG — gpt-image-2 **edit 모드**로 목 길이 보정 2회(최종: 카라 상단이 윗입술 높이, 턱·목 노출 없음). 후보 PNG는 `poker-doku-art/story-rewards/out/fix/` |
| baada00 | 헤즈업 라벨(BTN/SB·BB)에서 Ch6 primary 3종 집계 회귀 테스트(오픈/스틸 기회는 헤즈업에서 세지 않음 명시) |
| 6963eb6 | 라이브 HUD 비율 목표 표기 `formatObjectiveProgress`(「0.7/0.7」→「100%/70%」) + 이전 인계 §8 |
| ea99b76 | **컷신 영상 2차 6클립**(백띠·파란띠 승급, 기다림의 뜰, 팽팽 보스, 아라 승리, 비비안 Lv5) + 러너 보강 + `story-video-encode.sh` |

운영: 사용자 지시로 push·deploy(v77~v80) 실행, `fly secrets set … --stage` → `fly secrets deploy`로 운영자 2계정 등록.

## 3. 실주행으로 확인한 것 / 못 한 것

**확인**
- 운영자 모드 전 기능(제스처 ON/OFF·기록실 19/19·영상 로드·CH6 7스텝 스킵→결산 S·의상 미리보기·OFF 시 원상복구).
- CH4 스파링 14핸드 자연 종료 → 결산 「B · 미통과」(스틸 1/2·c벳 0/1 미달, 림프 0 달성) — 목표 tally·결정 리뷰·핸드 카운터 정상.
- CH6 보스 팽팽 헤즈업 15핸드 자연 종료 → 결산 「S · 통과」(프리미엄 3벳 기회 0 = 「해당 없음」 판정 제외, 하위 폴드·4벳 0 달성, 보상 v33 지급).
- 영상: 사용자가 파일럿 3클립 품질 만족 회신. 2차 6클립은 6프레임 시트로 얼굴·의상 유지·루프 확인, v80에서 서빙 확인(HTTP 200).

**못 한 것**
- **CH5(클로이) 스파링** — 리버 밸류/에어/사이징 집계(`no-air-river-bet`·`value-bet-sizing`) 실주행.
- **미션 클리어·보스 격파 컷인** — 두 실주행 모두 max-hands 종료라 미발생(primary 전부 달성 + minHands 이후 조기 종료 경로).
- 파란띠 승급 연출(2막 3챕터 완주 필요), 실패 씬 `failScene` 재생(미구현 범위).
- 실기기에서 2차 6클립 재생 확인(자동화 창은 hidden이라 재생 불가).

## 4. 브라우저 자동화 함정 (이번 세션 신규)

- 자동화 창은 `document.visibilityState === 'hidden'` — **setTimeout 체인이 1분 1회로 스로틀**된다. 페이지 안 루프는 MessageChannel yield로 대기:
  `await new Promise(r => { const c = new MessageChannel(); c.port1.onmessage = r; c.port2.postMessage(0); })`.
- framer-motion(rAF)도 멈춰 **딜러 버튼 좌표로 포지션을 읽으면 안 된다** — 액션 로그의 첫 프리플랍 액터(=UTG, 5인은 UTG→CO→BTN→SB→BB)로 계산.
  헤즈업은 첫 액터가 BTN/SB.
- 히어로 홀카드는 `body.innerText`에서 `(나)` 직전 두 장(`(A|K|Q|J|10|[2-9])\n♠♥♦♣`). 카드·좌석에 aria-label 없음. 액션 버튼은 `폴드|체크|콜 N|레이즈 N`.
- 스크립트 하나가 45초를 넘기면 CDP 타임아웃 — 루프는 `window`에 걸어 두고(`__playGen` 세대 토큰으로 중복 루프 방지) 짧은 폴링으로 읽는다.
- 결산 리빌·[허브로]는 실제 좌표 클릭(synthetic click 무시). 카드 선택은 `'CHn ·'` 텍스트 leaf에서 위로 올라가 `시작` 버튼이 있고 다른 CH 텍스트가 없는 첫 조상.
- 턴 타이머(60초) 안에 응답하지 않으면 자리비움 hold → [계속하기]로 복귀.
- 에이전트 백그라운드 명령은 **10분에 강제 종료** — H3 러너처럼 긴 작업은 `Start-Process python … -RedirectStandardOutput <log>`로 분리 실행 후 로그 폴링.
- `codex exec` 편집 모드도 `--sandbox workspace-write`를 줘도 저장이 막힐 수 있다 — 로그의 `call_xxx.png -> ./out/…` 매핑으로 `codex-home/generated_images/<세션>/`에서 회수.

## 5. 다음 세션 순서

1. (선택) 전체 vitest `--maxWorkers=4` 1회로 회귀 확인.
2. **나머지 컷신 영상**: 인연 씬 22장(`<character>-scene-lv<N>`, 사쿠라·비비안 Lv5 제외) + 씬 CG 12장(`scene-act{1,2}-ch0N-{prologue,epilogue}` — 매니페스트 id 규약은
   `story-video.ts`에 씬 CG 분기 추가 필요). 절차: `story-video.md` §절차 + 2차 배치 기록. 클립당 ~100초, 6클립 배치를 분리 프로세스로.
3. **CH5 스파링 실주행** + 조기 종료 컷인 확인(primary를 minHands 안에 채우는 플레이 정책 필요 — 자동 플레이 루프는 이전 인계 §8 참고).
4. **3막 데이터**(비비안·클로이·엘레나, 가면 봇 identity 분리 선행) 또는 하드 모드. 비비안/엘레나 의상·해설 말투 포함.
5. 사용자 피드백 대기 항목: 결산 위 레벨업 필 겹침(이전 인계 §5), 2막 톤·드릴 난이도.
