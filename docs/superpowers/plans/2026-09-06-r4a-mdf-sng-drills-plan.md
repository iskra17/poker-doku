# R4a MDF·SnG 드릴 구현 계획 — Fable 총괄 확정

> 2026-09-06. 총괄 Claude Fable 5.1(max). 구현 Claude Opus(`claude-opus-5`) 단일 작업자, 워크트리
> `.worktrees/story-r4a-drills`(브랜치 `feat/story-r4a-drills`, 기준 main `e0a97a7`). 검토 GPT 6 Astra(`gpt-6-astra`, high)는
> 확정 설계에 없는 가정 4건만 읽기 전용으로 본다. 근거: [3·4막 확정 설계](../specs/2026-09-05-act3-act4-design.md) 「드릴 생성과
> 포커 설명」 MDF/SnG 항목, [R3a 계획](2026-09-05-r3a-drills-plan.md)의 registry 규약.

**목표:** Ch10(MDF2)·Ch12(SNG6)가 지목할 MDF·SnG 문항을 기존 생성기·해설·공개 DTO·복습 계약에 추가한다.
**제외:** 챕터 데이터(Ch10~12)·코디네이터·소켓·어댑터·목표(objectives)·DB 마이그레이션·UI 컴포넌트 변경. `DrillSituation` DTO 확장 금지
(토너먼트 맥락은 `note`·문항 문장·`bigBlind`·스택 필드로 표현). 기존 템플릿 ID/문구/정답 변경 금지.

## 공통 규약 (R3a와 동일)

- seed 결정론·`Math.random` 금지·모호 문항 `null`→seed+1 리롤 ≤32·서버 채점 재생성·`toPublicDrillInstance`로 정답 제거.
- 숫자와 해설 facts는 같은 계산 결과에서 만든다. 문항에 없는 블라인드·가격·레인지를 가정하지 않는다.
- 상대는 `SUPPORT_CHARACTER_IDS`(조연 6)만. 히로인 6명은 출제자라 어떤 문항에도 상대로 나오지 않는다. 같은 문항 안 중복 없음.
- 포커 용어는 원어(핸드·폴드·콜·레이즈·팟·쇼다운). `characters/poker-terminology.ts` 검사 대상 문구 규칙 준수.
- 카테고리는 이미 존재하는 `'mdf'`·`'sng-math'`(`drills/types.ts`, 허브 라벨 `DRILL_CATEGORY_LABEL` 등록됨)를 쓴다. 신규 카테고리 없음.

## 1. 계산 코어 — `src/lib/poker/learning.ts`

`computeMdf(potBeforeBet, bet)` 추가(퍼센트, 반올림 전):
`mdf = P/(P+B)×100`, `callEquity = B/(P+2B)×100`(= `computePotOdds(B, P+B).requiredEquity`와 같은 값), `villainBreakeven = B/(P+B)×100`.
`learning.test.ts`에 (100,50)→66.67/25/33.33, (100,200)→33.33/40/66.67, (300,100)→75/20/25 고정. 입력 ≤0이면 throw.

## 2. MDF 생성 템플릿 3종 — `src/lib/story/drills/templates/mdf.ts` (category `'mdf'`)

공통 스팟: 리버, 상대(조연 1명)가 벳 전 팟 **P**에 **B**를 벳. `situation.potChips = P + B`(D-ODDS 정의: 상대 벳 포함 중앙 총액),
`toCallChips = B`. 문항과 `note`에 P·B·현재 총액을 모두 적는다(D-BE는 벳 전 팟, D-ODDS는 벳 포함 팟이라 표기를 못박는다).
히어로 핸드는 블러프 캐처: `evaluateHand(hero, board).rank`가 `high-card`/`pair`가 아니면 리롤. 스택 100BB, 벳 ≤ 스택.
(P,B)는 bb=20 기준 후보 `[100,50],[200,100],[100,75],[300,100],[150,50],[100,200],[100,300],[120,40],[160,80],[180,60],[90,30],[100,40],[100,80]`에서
뽑되 코드로 재검증: mdf·callEquity·villainBreakeven 셋 다 반올림 오차 ≤0.49(x.5 금지), 셋 사이 쌍별 간격 ≥4%p. 조건 미달은 리롤.
facts: `potBeforeBet, betChips, potChips(=P+B), mdf, callEquity, villainBreakeven, villainName, board, hero`(반올림 정수 + 소수1 `mdfExact` 등).

| id | 입력 | 문항 |
|---|---|---|
| `mdf-defend-pct` | numeric `%` tol 2 | "내 레인지가 최소 몇 % 방어(콜/레이즈)해야 상대의 0에퀴티 블러프가 자동 이익을 못 볼까요?" 정답 mdf |
| `mdf-choice` | 4지선다 | 정답 `mdf%`, 오답 `callEquity%`·`villainBreakeven%`·눈금 풀(20/25/33/40/50/60/67/75/80) 중 간격 ≥4 값. 부족하면 리롤 |
| `mdf-vs-call-equity` | 4지선다 | "MDF와 이 핸드로 콜할 때 필요한 승률을 올바르게 짝지은 것은?" 정답 `MDF m% · 필요 승률 c%`, 오답 = 서로 바꾼 짝·`MDF vb% · 필요 승률 c%`·`MDF m% · 필요 승률 vb%`. 네 문자열 모두 달라야 하며 아니면 리롤 |

해설(`explain.ts` core, 두 템플릿 공용 `mdfCore` + 짝 문항 전용): ① P는 벳 전 팟, B 벳으로 중앙 P+B, ② MDF = P/(P+B) = m% — "레인지 전체가
이만큼 방어하지 않으면 상대는 아무 카드로 벳해도 이익", ③ **콜 필요 승률은 B/(P+2B) = c%로 다른 숫자**, ④ 한계: "MDF는 레인지 기준이지 이
핸드의 의무 콜이 아니고, 실제 상대가 블러프를 덜 하면 그만큼 덜 방어해도 된다". 숫자는 facts에서만.

## 3. SnG 생성 템플릿 5종 — `src/lib/story/drills/templates/sng.ts` (category `'sng-math'`)

공통: 6-max SnG, 프리플랍, 보드 없음, 히어로 카드 2장은 뽑되(상황 카드가 내 스택/BB를 표시하려면 hero가 비면 안 됨) 정답과 무관함을 문항에
밝히지 않아도 된다(문항이 묻는 것은 스택·블라인드·인원). 블라인드 레벨은 `SNG_BLIND_SCHEDULE`(blind-schedule.ts) 인덱스 0~8에서 뽑고
`situation.bigBlind`는 그 레벨의 BB(ctx.bigBlind 미사용 — 상황 카드 `BB {bigBlind}` 표기가 실제 레벨). `potChips` = SB+BB(+앤티 합).
상대 = 조연 중 남은 인원−1명, 스택은 임의 400~4,000(100 단위). `note`에
"레벨 n (S/B), 앤티 a(없음), 남은 인원 k/6, 상금 3자리" 형식으로 맥락을 전부 적는다. 새 순수 모듈 `src/lib/story/sng-thresholds.ts`:
`PUSH_FOLD_MAX_BB = 10`, `SHORT_STACK_MAX_BB = 20`, `stackZone(bb) → 'push-fold' | 'short' | 'comfortable'`, 한국어 라벨. Ch12 레슨(R4c)이
같은 모듈을 인용한다.

| id | 입력 | 정답 |
|---|---|---|
| `sng-stack-bb` | numeric `bb` tol 1 | 스택 ÷ BB. 스택은 BB의 정수배(4~40BB)로 만든다 |
| `sng-m-ratio` | numeric `x` tol 0.5 | M = 스택 ÷ (SB+BB+앤티×남은 인원). 앤티 있는 변형 절반 이상(앤티는 BB의 10~12.5% 정수). 소수 1자리로 떨어지게 스택 선택, `mExact` facts |
| `sng-next-level-bb` | numeric `bb` tol 1 | 다음 레벨(`SNG_BLIND_SCHEDULE[i+1]`) BB로 나눈 스택. 정답 `round`, `exact` 소수1 facts. 마지막 레벨 인덱스는 뽑지 않음 |
| `sng-itm-distance` | 4지선다 고정 `['1명','2명','3명','이미 상금권']` | 남은 인원 k∈{3,4,5,6}, 상금 3자리 → k−3 (k=3이면 '이미 상금권') |
| `sng-stack-zone` | 3지선다 `['푸시/폴드 구간 (10BB 이하)','숏스택 (10~20BB)','여유 (20BB 초과)']` | `stackZone(스택/BB)`. 경계 ±1BB(9~11, 19~21)는 리롤 |

해설 core는 공식 한 줄 + 의미 한 줄(M은 "아무것도 안 하고 몇 오르빗 버티는가", 존/ITM은 "판단 기준일 뿐 자동 액션이 아니다", 캐시 임계와 다른
구조임을 한 문장). 필수 facts를 `REQUIRED_FACTS`에 등록.

## 4. 수기 푸시/폴드 2문 — `src/lib/story/drills/templates/authored/act4.ts` (category `'sng-math'`, `authored/index.ts`에 연결)

설계 원칙: "포지션/유효스택/앞 액션/상대 콜 가정이 명시된 수기 문항", 캐시용 프리플랍 임계(`open-thresholds.ts`) 재사용 금지, **칩 EV 기준
(ICM 무시)을 문항에 명시**. 정답은 명시 가정에서 계산한 EV 부호로만 정한다:
`pFoldAll = Π(1−c_i)`, 콜은 커버하는 한 명이 한다고 단순화, 콜 시 팟 = 내 스택×2 + 남은 데드 블라인드, `EV(푸시) = pFoldAll×블라인드 합 +
(1−pFoldAll)×(eq×팟 − 스택)`, 폴드 EV 0. 상대 콜 레인지는 `parseRange` 가능한 표기로 `villain.range`와 `note`에 적는다.

- `act-ch12-push-btn-8bb`: 블라인드 100/200 앤티 없음, 히어로 BTN 1,600(8BB) A♠7♦, 앞 전원 폴드, SB 2,400·BB 3,000. 가정 "SB·BB는 각각 상위 12%
  (`77+, A9s+, KTs+, QJs, ATo+, KQo`)로만 콜". 기대: pFoldAll ≈0.77, 콜 시 에퀴티 ≈35~38% → EV(푸시) > 0 → `raise`(올인). 옵션 `['fold','raise']`.
- `act-ch12-fold-utg-8bb`: 같은 블라인드, 히어로 UTG 1,600 9♠4♦, 뒤 5명 각각 상위 15%(`66+, A7s+, K9s+, QTs+, JTs, ATo+, KJo+`) 콜 가정.
  기대: pFoldAll ≈0.44, 에퀴티 ≈28% → EV < 0 → `fold`.

facts(`pFoldAll`, `equityIfCalled`, `evPush`, `range`)는 `estimateEquity(hero, [], parseRange(range), {samples ≥ 20_000, rng: mulberry32(고정)})`로
산출한 값을 파일 헤더에 기록하고, 테스트가 같은 방법으로 재계산해 ±2%p·EV 부호 일치를 고정한다. 해설 화자 tone은 미야코(Ch12 진행자) 기준으로
쓰되 실행 시 교사로 교체되는 기존 authored 계약을 따른다. 문항 문구에 "이 결정은 명시된 콜 가정과 칩 EV로만 계산한 것"을 넣는다.

## 5. 해설 말투 확장 — `explain.ts speak()`

`vivian`(Ch10 교사)·`elena` 폴백을 캐릭터 톤으로 바꾼다(캐릭터 모듈 `src/lib/characters/index.ts`의 greeting/winQuote 참조):
- 비비안: 반말·무대 은유(무대·막·연극·관객), 어미 「~지」「~군」, 호칭 「너」, 마무리에 「브라보」. 본문은 `toCasual` 적용.
- 엘레나: 반말, 문장 앞 「…」, 짧고 건조, 마무리 「…패는 거짓말을 안 해. 숫자도.」 계열. 본문 `toCasual` 적용.
`explain.test.ts`의 "나머지 히로인 폴백" 단언을 두 캐릭터의 반말 누출 없음(아라/클로이와 같은 정규식) 단언으로 교체. 미야코/사쿠라/하나/아라/클로이 불변.

## 6. 등록·테스트

- `generator.ts` `GENERATED_DEFINITIONS`에 `MDF_TEMPLATES`·`SNG_TEMPLATES` 추가, `authored/index.ts`에 `ACT4_AUTHORED_DRILLS`.
- 새 `src/lib/story/drills/r4-templates.test.ts`(r3-templates.test.ts 모델): ① 11개 ID 등록·생성, ② 100 seed 결정론(`toEqual` 재생성)·정답/오답 채점·
  public JSON에 `correct|explanation|facts|hint` 없음·힌트 `{key}` 치환 완료·카드 중복 없음·상대 조연 풀·중복 없음, ③ 수학 대조: MDF 세 값을
  `computePotOdds`/독립 공식으로 재계산, potChips = P+B·toCall = B, 오답 간격 ≥4; SnG는 `SNG_BLIND_SCHEDULE`·`stackZone`·note 인원으로 재계산,
  존 경계 미출제, ITM 분기 4종 모두 등장(seed 100개 중), ④ `Math.random` spy 0회, ⑤ `DRILL_CATEGORY_LABEL`·`chapterSkillCategories`가 `mdf`·`sng-math`
  포함, ⑥ 수기 2문 EV 재계산. 변형 수 >3.
- `explain.test.ts` 말투, `learning.test.ts` computeMdf, `generator.test.ts` 기존 단언 불변(EXPECTED_IDS에 추가하지 않음 — R3와 동일).

## 7. 검증·완료 조건

```text
npx vitest run src/lib/story/drills/r4-templates.test.ts src/lib/story/drills/generator.test.ts src/lib/story/drills/explain.test.ts \
  src/lib/story/drills/public.test.ts src/lib/poker/learning.test.ts src/lib/story/story-hub-rules.test.ts src/lib/story/chapters/chapters.test.ts --maxWorkers=2
npx tsc --noEmit
npx eslint <변경 파일>
git diff --check
```

완료 = 위 전부 통과 + 워크트리 커밋(메시지 `feat(story): add MDF and SnG drill templates for act 4`) + 보고(실제 모델 ID·변경 파일·테스트 수·
미해결 가정). 전체 suite/build/서버/브라우저/배포는 실행하지 않는다. 이 계획 문서와 `../reviews/2026-09-06-r4a-drills-astra.md`도 같은 커밋에 포함한다.

## Astra 검토 반영 (2026-09-06, 총괄 확정 — 위 1~6항보다 우선)

검토 원문 [reviews/2026-09-06-r4a-drills-astra.md](../reviews/2026-09-06-r4a-drills-astra.md)(`gpt-6-astra`, high). 지적 4건 전부 수용.

1. **MDF 단위·표기**: `computePotOdds(B, P+B).requiredEquity`는 0~1이다 — facts/테스트 비교는 `.pct` 또는 ×100. `villainBreakeven`은 해설·오답
   라벨에서 "상대 블러프의 손익분기 필요 폴드율"로 부른다. 4지선다 문항 문구에 "가장 가까운 정수 %"를 명시한다. 후보 13쌍은 모두 반올림·간격 규칙을 통과한다.
2. **SnG 존·M**: 존 라벨은 `'푸시/폴드 구간 (10BB 이하)' / '숏스택 (10BB 초과 ~ 20BB 이하)' / '여유 (20BB 초과)'`. M 해설에 "블라인드·인원이 고정되고
   추가 손익이 없다는 근사이며, 레벨이 오르는 실제 생존 시간과 다르다"를 넣는다. 앤티 변형 note: "연습 가정: 매 핸드 각자 a칩 앤티(개인 앤티 — 기본
   게임의 BB 앤티 방식과 다름)". 앤티 없는 M = 스택 ÷ (SB+BB)도 유효.
3. **수기 푸시/폴드**: 실측(`estimateEquity`, `mulberry32(20260906)`, 100,000 샘플) A♠7♦ ≈33.8%, 9♠4♦ ≈27.6% — 파일 헤더 값은 반드시 실측으로.
   "상위 X%" 표기 삭제 — 콜 확률 `c = rangeCombos(parseRange(range), hero).length / C(50,2)`로 통일(≈9.88%·14.45%). 문항 note에 가정 명시:
   단일 콜러(첫 콜러 이후 추가 콜 없음)·상대 간 카드 상관과 앞선 폴드 정보 무시·칩 EV(ICM 무시)·비교는 "폴드 vs 올인"만. 콜러별 팟은 BB 콜 3,300 /
   SB 콜 3,400 / 비블라인드 콜 3,500이므로 첫 콜러 확률로 가중해 `evPush`를 산출한다(콜 순서: BTN 문항 SB→BB, UTG 문항 HJ→CO→BTN→SB→BB).
   모든 상대 스택은 히어로 1,600을 커버(≥1,700)하도록 지정. 옵션 `['fold','all-in']`, 정답 `'all-in'`/`'fold'`. `situation.potChips = 300`, `toCallChips = 200`.
   순수 함수 `pushFoldEv({ heroStack, blindsTotal, callers: [{ callProb, potIfCalls }], equity })`를 `sng-thresholds.ts`에 두고 facts와 테스트가 같은 함수를 쓴다.
4. **테스트 계약**: `generator.test.ts:181`의 authored id 배열에 신규 2개 추가를 허용(유일한 기존 단언 수정 예외). 변형 수 >3 단언은 생성형 9종만.
   오답 검사는 `correct + tolerance + 1`(허용 오차 밖). 신규 문항 상대 풀은 조연 6명만 엄격 검사. SnG 생성 문항 `toCallChips`는 히어로가 블라인드 좌석이
   아니면 BB(콜 필요), BB 좌석이면 0 — note에 명시. facts는 `explanation.facts`에만, 공개 `note`에는 전제만 둔다.

**총괄 확정 (2026-09-06):** `sng-orbit-cost`는 정답이 상황 카드의 팟(SB+BB+앤티 합)과 같은 값이라 문항 가치가 없어 **삭제**한다 — 위 §3 표에서 제거했고, 등록만 남겨 두지 않는다(신규 ID 11 → 10).
