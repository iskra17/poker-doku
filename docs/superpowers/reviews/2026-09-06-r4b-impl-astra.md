# R4b 구현 검토 — GPT 6 Astra

> 2026-09-06. 모델 `gpt-6-astra`(codex exec, model_reasoning_effort=high, 읽기 전용). 대상: `feat/story-r4b-act4` 커밋 `59e70a3`·`3e7f69f`(main `19c88e9` 기준). 총괄(Fable 5.1) 판정: P1 2건·P2 1건·P3 1건 전부 수용 — 후속 커밋 `fix(story): address R4b review findings`에서 수정.

검토 범위는 `59e70a3`, `3e7f69f`입니다. 파일 수정 없이 타입 검사와 메모리 내 반례 재현을 수행했습니다.

1. **P1 — 보드만 만든 투페어로 `executed-any`를 달성합니다.**  
   [objectives.ts:587](C:/code/claude/poker-doku/.worktrees/story-r4b-act4/src/lib/story/objectives.ts:587)  
   입력: 히어로 `Ac Qd`, 보드 `Ks Kd 7h 7c 2s`. 프리플랍 상대 오픈에 콜, 플랍·턴 체크, 리버 첫 자유 액션에서 벳. 다른 기록에서는 오픈 기회를 놓쳤고 실행은 없다고 둡니다.  
   **기대:** 홀카드 관여가 없으므로 밸류 실행 제외, 목표 `false`. **실제:** `execValueOpportunity=true`, `execValue=true`여서 목표 `true`. 같은 보드에서 체크→폴드하면 존재하지 않는 기회 때문에 `null`이어야 할 목표가 `false`가 됩니다.  
   **최소 수정:** 새 `execValueOpportunity` 조건에 `heroMadeWithHole(hole, riverBoard)`를 추가하고 기존 `riverValueBet*`는 유지하세요.

2. **P1 — seed 충돌 64회 제한으로 기존 복습 노트가 삭제될 수 있습니다.**  
   [story-run-coordinator.ts:1056](C:/code/claude/poker-doku/.worktrees/story-r4b-act4/src/server/story-run-coordinator.ts:1056)  
   입력: `runId='r4b-collision'`, 세트 `ch11-drills`, `outs-count` 노트 65개, seed `3328359796…3328359860`, 모두 `box=3`.  
   **기대:** 기존 노트에 없는 seed. **실제:** 첫 슬롯이 기존 seed `3328359860`으로 출제됩니다. 정답은 [story-run-coordinator.ts:874](C:/code/claude/poker-doku/.worktrees/story-r4b-act4/src/server/story-run-coordinator.ts:874)의 `markCorrect`를 통해 해당 기존 노트를 졸업·삭제합니다.  
   **최소 수정:** 임의의 64회 제한을 없애고 미사용 seed를 찾은 뒤에만 큐에 넣으세요.

3. **P2 — 수기 템플릿만 있는 `reviewPool`을 검증기가 승인합니다.**  
   [chapters/index.ts:190](C:/code/claude/poker-doku/.worktrees/story-r4b-act4/src/lib/story/chapters/index.ts:190)  
   입력: Ch11의 풀을 `['act-ch10-overbet-fold']`로 교체하고 복습 노트는 비웁니다.  
   **기대:** 생성 템플릿 전용 계약 위반으로 검증 실패. **실제:** `validateChapters`는 `[]`을 반환하지만 런타임은 후보를 모두 제거하여 `enterDrillSet=false`, 8문항 세트를 건너뜁니다.  
   **최소 수정:** 풀 항목의 존재뿐 아니라 `source.kind === 'generated'`도 검증하세요.

4. **P3 — 결산에서 체크리스트 부모의 실제 진행값이 빠집니다.**  
   [RewardReveal.tsx:159](C:/code/claude/poker-doku/.worktrees/story-r4b-act4/src/components/story/RewardReveal.tsx:159)  
   입력: 부모 `progress=5`, `target=3`, `achieved=true`.  
   **기대:** `5/3 달성`. **실제:** 고정 라벨 `체크리스트 3/5`와 `달성`만 표시됩니다.  
   **최소 수정:** 부모에는 공용 진행 포매터를 적용하세요.

추가 `CompletedHandRecord` 경계 재현은 기대와 실제가 일치했습니다.

| 구체적인 입력 | 기대 = 실제 |
|---|---|
| `Kh Qs` / `Kc 9d 7s 4h 2c`, 앞선 배럴 콜, 리버 팟 300에 상대 올인 300, 히어로 잔여 1,850으로 콜 | 콜다운 실행, 오버벳 아님 |
| 같은 조건에서 리버 벳 303에 폴드 | 오버벳 기회·정답, 콜다운 아님 |
| `8h 7h` / 플랍 `9c 6d 2s`, 벳 100에 올인 레이즈 | 8아우츠 예외, `airReraise=0` |
| `As Kc`, 시작 스택 40, SB 25 납부 후 BB 50에 총액 40 올인 | 오픈 기회는 있으나 `execOpen=false` |

정상 확인 영역:

- 체크리스트 required/null 수학, 그룹의 점수·통과 판정 제외, 강제 완료 부모 재계산, HUD 순서·포매터는 계약과 일치합니다.
- 위 문제 외 복습의 노트 우선순위·생성 후보 필터·exam 경로·dailyPool·스킬 칩 확장은 맞습니다.
- Ch11의 partner-first 라인업, 명시 히로인 예약, 반복 fill 예외와 masquerade 경로는 맞습니다.
- Ch10·11 목표·핸드 수·보상 배선, 수기 문제의 팟 계산, v37 카탈로그 6개 항목의 INSERT 값은 일치합니다.
- 7개 재현 기록의 기존 사실은 `19c88e9`와 동일했습니다. `tsc --noEmit --incremental false`와 `git diff --check`도 통과했습니다.

**요약**

- **P1:** 홀카드 미관여 리버 벳이 실행 목표를 잘못 통과시킵니다.
- **P1:** 연속 seed 충돌로 기존 복습 노트가 삭제될 수 있습니다.
- **P2:** 수기 전용 복습 풀을 승인하여 드릴 세트가 생략됩니다.