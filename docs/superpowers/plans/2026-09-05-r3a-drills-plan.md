# R3a 콤보·리딩·넛츠 드릴 구현 계획

> 실행: Astra Medium, 단일 작업자. 승인된 설계에 따라 executing-plans/TDD를 사용하며 추가 승인·하위 에이전트 없이 진행한다.

**목표:** Ch8~9에서 사용할 정확한 콤보 계산·명시 레인지 가정 리딩·유일 넛츠 드릴을 기존 registry에 연결한다.
**구조:** `rangeCombos`/`evaluateHand`/`findNuts`를 재사용하는 순수 계산층과 seed 빌더를 분리한다. public DTO/답 입력 형식은 기존 numeric/multiple-choice를 사용한다.
**기술:** TypeScript, Vitest, 기존 포커 evaluator와 seeded RNG.

- [x] `drills/range-facts.test.ts`: 페어6/수딧4/오프수트12, hero+board blocker, 중복 토큰/빈 레인지, 명시 value/bluff 가정 분할 및 겹침 거절, 실제 홀카드 입력 부재를 먼저 검증한다.
- [x] `drills/range-facts.ts`: `countRangeFacts(range,hero,board)`와 `readRangeFacts({range,valueRange,bluffRange,hero,board})`를 구현한다. 입력은 공개된 레인지 가정과 알려진 카드뿐이며 모든 숫자는 같은 전수 열거 결과에서 산출한다.
- [x] `drills/templates/combos.ts`, `hand-reading.ts`: 3종씩 추가한다. 대표 단언 `countRangeFacts('AA, AA', cards('As 2h'), []).remaining === 3`, 보드 페어/두 블로커도 정확값을 고정한다. 리딩 문항은 공개 액션과 분류 가정을 note/question에 모두 명시한다.
- [x] `drills/templates/nuts.ts`와 전용 테스트: `findNuts(board,hero)` 최고 홀카드가 정확히1개일 때만 4지선다를 만든다. board-only 넛츠/동점/불가능 후보는 null→기존32회 리롤, 플러시/풀하우스/스트레이트 동점 경계를 검증한다.
- [x] `generator.ts`, `explain.ts`에 8개 ID를 등록하고 facts로 숫자·해설을 함께 만든다. `DrillTableView.tsx`의 레인지 표시를 명시 가정으로 고친다. 카테고리는 기존 combos/hand-reading/hand-ranking을 재사용한다.
- [x] 새 생성기 여러 seed의 결정론·정답 유일성·올바른/오답 채점·힌트 치환·public 정답 제거·조연 풀·카드 중복을 검증한다. registry 기반 챕터 스킬/복습 준비를 확인한다. 실제 챕터 슬롯은 R3b 소유다.
- [x] `npx vitest run <관련 파일> --maxWorkers=2`, `npx tsc --noEmit`, 변경 파일 ESLint, `git diff --check` 후 커밋/clean 보고한다. 전체 suite/build·서버·브라우저는 실행하지 않는다.

## 완료 및 R3b 인계

- 커리큘럼 권장 연결: Ch8 COMBO2=`combo-count`/`combo-blockers`; Ch9 COMBO2=`combo-blockers`/`combo-paired-board`, READ3=`read-value-combos`/`read-bluff-combos`/`read-removed-combos`, NUTS2=`nuts-unique-combo`/`nuts-blocked-combo`.
- 기존 `rank-nuts`는 족보 이름을 묻는 별도 템플릿으로 유지한다. 새 넛츠는 정확한 홀카드 2장 조합이 전수 비교의 유일 최고값일 때만 출제한다. 스트레이트/풀하우스가 최고 족보여도 여러 홀카드가 같은 값을 만들면 리롤한다. 보드 자체 넛츠도 임의 정답을 고르지 않는다.
- COMBO는 기본10가지·블로커6가지·페어보드4가지, READ는 4가지 공개 리버 상황과 수트 치환을 제공한다. READ 밸류/블러프의 모든 실제 콤보를 히어로 evaluator 값과 비교해 교육 가정의 내부 일관성을 검증했다.
- 신규 category는 만들지 않았다. 기존 combos/hand-reading/hand-ranking으로 통계와 허브 스킬 칩이 연결된다. coordinator의 dailyPool은 완료 챕터 슬롯에서 registry ID를 파생하므로 R3b의 실제 챕터 슬롯 연결 이후 자동으로 일일 출제에 들어간다. 복습도 templateId/seed 재생성 계약을 그대로 따른다. 이번에는 챕터/코디네이터/소켓/어댑터/목표/마이그레이션을 수정하지 않았다.
- `DrillTableView`에서 레인지를 가정으로 표시하고 `DrillAnswerInput` 및 `describeCorrectAnswer`는 콤보·아우츠·칩 단위를 한국어로 표시한다. wire unit/채점 규약은 유지한다.

검증:

```text
npx vitest run src/lib/story/drills/generator.test.ts src/lib/story/drills/public.test.ts src/lib/story/drills/explain.test.ts src/lib/story/drills/range-facts.test.ts src/lib/story/drills/r3-templates.test.ts src/lib/story/drills/templates/nuts.test.ts src/lib/story/drill-input.test.ts src/lib/story/story-hub-rules.test.ts src/lib/poker/range.test.ts src/lib/poker/learning.test.ts --maxWorkers=2
10파일 154개 통과 (신규 8종 각각100 seed=800문항 포함)

npx vitest run src/lib/story/drill-input.test.ts src/lib/story/drills/r3-templates.test.ts --maxWorkers=2
마지막 UI 단위 표기 변경 후 2파일14개 통과

npx tsc --noEmit — 통과
변경 TS/TSX 전체 ESLint — 통과; 마지막 변경4파일 재검증 통과
git diff --check — 통과
```

독립 npm ci 완료. Node22.14가 package engines >=22.16 <23 대비 경고를 냈으며 위 검사는 통과했다. 전체 suite/build/서버/브라우저/GPU/배포는 실행하지 않았다.
