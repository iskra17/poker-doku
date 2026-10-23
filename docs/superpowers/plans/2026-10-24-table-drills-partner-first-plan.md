# 실제 테이블 수련 문제 + 파트너 중심 초반 (2026-10-24)

근거: 3모델 기획 회의(`qa-tmp/meeting-2026-10-24/`, GPT 6 Astra · Claude Opus 5.5 · Gemini 4 Argon 기록된 입장)와
사용자 결정(2026-10-24):

> 아르곤이 말한 운전면허 시험 같다는 느낌이 너무 강했어. 문제를 풀더라도 테이블 상황을 실제 테이블에서 보여주고,
> 거기서 애니메이션 느낌으로 어떤 판단을 실제 테이블에서 해야 하는지 보여주거나, 포지션 관련 질문도 실제 테이블
> 화면에서 보여주고, 족보 문제도 그렇게 하는 게 맞다고 봐. 그리고 남은 건 합의된 실행안으로 진행해줘.

정체성 문장(회의 합의): **미연시가 이유, 포커가 행동, 공부는 그 결과.**

## 범위

### 작업 A — 실제 테이블 수련 문제 (사용자 지시, 최우선)

목표: 드릴·함께 풀기·실력 배치 문항이 "상황 카드 + 보기 목록"이 아니라 **실전 테이블과 같은 타원 펠트 위의 한 장면**으로 보인다.
문제를 맞히거나 틀리면 **테이블 위에서 판단 과정이 애니메이션으로 재생**된다.

1. **테이블 외형 공유**: `PokerTable`의 레일·펠트·글로우 마크업을 표시 전용 `TableFelt`(가칭, `src/components/table/`)로 추출해
   `PokerTable`과 새 수련 테이블이 같이 쓴다. `PokerTable` 렌더 결과는 바뀌지 않아야 한다(수련 펠트 색 포함).
2. **`DrillTable`** (`src/components/story/`, 게임 store 비의존): `DrillSituation` → 타원 테이블.
   - 좌석 좌표는 `table-layout.ts`의 `SEATS`/`BET_POSITIONS`/`DEALER_BTN_POSITIONS`/`POT_POS`/`BOARD_POS`를 그대로 쓴다. 히어로는 하단 중앙(슬롯 0).
   - 좌석: 캐릭터 아바타·이름·포지션 배지·스택·홀카드(공개면 앞면, 아니면 뒷면). 빈 좌석은 흐린 자리로 표시.
   - D 버튼(그리고 위치가 확정되면 SB/BB 배지), 보드, 팟(칩 스택+금액), 콜 금액(히어로 앞).
   - 모바일 430px 폭에서 테이블이 화면 위쪽 절반 안에 들어오고 질문·보기가 스크롤 없이 이어져야 한다.
3. **좌석 모델 순수 함수** `src/lib/story/drill-table-model.ts`(+테스트): 상황 → `{ seats[6], dealerSeat, heroSeat, board, pot, toCall }`.
   - `DrillSituation`에 선택 필드 `heroSeatIndex?`·`dealerSeatIndex?`를 추가한다(공개 사양, 정답 아님).
   - 필드가 없으면 포지션 라벨(`positionLabels(6)` = BTN·SB·BB·UTG·HJ·CO, 좌석 번호는 시계 방향 증가)로 딜러와 좌석을 역산한다.
     라벨도 없으면(수기·함께 풀기) 빌런을 남은 슬롯에 순서대로 앉힌다.
   - **정답 누출 금지**: `pos-name`처럼 포지션이 정답인 문항은 라벨을 `?`로 둔 채 그린다. 좌석 번호·D 버튼 위치는 원래도 문제 문구로 공개되던 정보다.
4. **상황 재생(인트로)**: 새 문항이 뜨면 1~2초 동안 카드 딜링 → 보드가 스트리트 순으로 깔림 → 팟 칩이 모임 → 내 차례 강조. 탭하면 즉시 완성.
   `prefers-reduced-motion`이면 정지 화면. 보기 입력은 인트로 중에도 막지 않는다.
5. **판단 재생(채점 뒤)**: `DrillResult`를 받은 뒤에만 실행한다(채점 전 정답 계산·표시 금지). 카테고리별:
   - `hand-ranking`(누가 이기나·내 족보·넛츠): 공개된 각 좌석의 최고 5장을 클라이언트 `evaluateHand`로 계산해
     좌석 위에 족보 이름 배지를 차례로 띄우고, 이긴 쪽의 5장(보드+홀카드)을 강조, 팟 칩이 승자에게 미끄러진다.
   - `position` `pos-name`: D 버튼이 반짝인 뒤 BTN → SB → BB → UTG → HJ → CO 순으로 좌석마다 라벨이 시계 방향으로 붙고, 내 자리에서 멈춰 크게 강조.
   - `position` `pos-first-to-act`: 액션 순서대로 스포트라이트가 좌석을 옮겨 다니고 첫 좌석에 "첫 액션" 배지.
   - `action-pick` 정답(레인지·콜 판단 등): 정답 액션을 테이블 위에서 실연(폴드=히어로 카드가 뒤집혀 머크, 콜/레이즈=칩이 베팅 라인으로).
   - 그 밖의 카테고리: 히어로 좌석 강조 + 정답 라벨 말풍선(기본 폴백).
6. **문항 화면 재배치** (`DrillCard`): 테이블 → 출제자(교사/파트너) 말풍선으로 질문 → 보기. "문제 n/m" 텍스트는 점 진행 표시로 바꾼다
   (재출제 표시·콤보는 유지). 정답/오답 스탬프·해설 말풍선·[다음]은 유지한다.
7. **교체 대상**: `DrillCard`, `LessonPage` 함께 풀기, `PlacementSheet`의 `DrillTableView` → `DrillTable`. 함께 풀기에서도 단계 상황이 테이블에 반영된다.
8. **문구**: `pos-name` 상황 note를 "딜러 버튼(D)에서 시계 방향으로 세어 보세요." 류로 바꾼다(테이블이 좌석을 보여 주므로). 채점·seed 불변.

### 작업 B — 파트너 중심 초반 (회의 합의 1~3일 항목)

1. **파트너별 대사**: `SceneSayLine`(그리고 선택지 reply 라인)에 선택 필드 `byPartner?: Partial<Record<StoryHeroineId, { text: string; expression? }>>`.
   화자가 `'partner'`인 라인은 런타임 파트너 id로 해당 문장을 고른다(없으면 기본 `text`). `validateScene`이 byPartner 문장도 검사한다.
   Ch1의 모든 `'partner'` 라인을 히로인 6명 말투로 수기 작성한다(사쿠라 말더듬 존댓말·아라 반말 츤데레·하나 '당신' 분석 존댓말·
   클로이 스트리머체·비비안 존댓말 '자기'·엘레나 차분한 프로; 기존 `bond-scenes.ts`·`coach-lines.ts`·`drills/explain.ts` 말투를 정본으로 따른다).
2. **프롤로그 = 파트너의 사건**: 미야코의 "바로 두 문제를 풀어 볼게요" 문구를 지운다. 미야코 환영 1줄(기존 CG 유지) 뒤
   파트너 장면: 혼자 카드를 섞던 파트너 → **도장 「짝 대국」(2인 1조 연습 대회)에 나갈 짝이 없다**는 고민 → 선택지 → "일단 한 판 같이 쳐 보자" → 첫 핸드.
   새 CG 없이 기존 배경·스프라이트. 6~8줄, 건너뛰기 허용(ScenePlayer 기존 기능).
3. **첫 핸드에 결정**: Ch1 첫 핸드(`act1-ch01:first-hand`)에서만 파트너 실시간 훈수(`PartnerCoach`)를 켠다 —
   practice-table 스펙에 선택 필드(예: `partnerCoach: true`)를 두고 `coach-eligibility`가 스토리 방이라도 이 스텝이면 허용.
   지시문(perHandPrompt)은 "이번 핸드는 직접 골라 봐요 — 옆에서 파트너가 거들어요" 류로. 카드 고정(승리 패)은 그대로.
4. **내 승리 컷인 = 파트너**: `WinnerCutIn`에서 승자가 나(myPlayerId)이고 선택 파트너가 히로인이면 미야코 대신 파트너 + 파트너 대사
   (`partner-dialogue.ts`의 승리 대사 재사용 또는 히로인별 짧은 축하 대사). 다른 휴먼 승리는 기존 미야코 유지.
5. **온보딩 파트너 선택 화면**: 히로인 6명을 큰 카드(상반신·이름·성격 한 줄·대표 대사)로, 잠긴 마스코트 아바타는 접은 한 줄 안내로 분리.
   430×900에서 [익명 프로필 만들기] 버튼이 스크롤 없이 보여야 한다.
6. **기록실 잠금 칸 예고**: 잠긴 인연 씬·이벤트 CG·보너스 CG 칸에 캐릭터 이름 + 씬 제목 + 강하게 흐린 썸네일 + 해금 조건.
   원본 CG를 선명하게 보여 주지 않는다(회의 합의: 예고는 하되 원본은 아낀다). 보너스 탭은 0개 해금이어도 보인다(설정 `showBonusCg`가 켜진 경우).

### 작업 C — 회의 합의 1~3주 항목 중 이번 배치에 넣는 것

1. **Ch1 재구성(사건 단위·필수 문제 축소)**: 필수 드릴 6문 → 4문.
   - 사건 1: 프롤로그(파트너 고민) → 첫 핸드(훈수) → 첫 핸드 소감 → **첫 핸드 복기 문제 1문**(수기: 방금 친 A♠K♠ 보드, 누가 이겼나) + 원페어 vs 하이카드 1문.
   - 사건 2: 테이블의 언어 레슨(함께 풀기 포함) → 드릴 2문(`rank-who-wins`, `pos-name`) — `rank-best-hand` 2문은 필수에서 뺀다.
   - 사건 3: 연습 2핸드 → 스파링 → 에필로그(파트너가 "짝 대국 짝, 해 줄래?" — 선택지) → 결산.
   - 스텝 id·`FIRST_DRILL_CLEAR_STEP_ID`·빠른 진행(`fastModeSkip`, `drillSlotsFor`)·실력 확인(exam) 계약을 깨지 않는다.
2. **Ch2**: 사쿠라의 "가르칠 수 있을까 떨렸다" 고민을 프롤로그로 당기고(에필로그의 "지금은 안 떨리네요"가 회수), 파트너 한두 줄(byPartner)을
   프롤로그·에필로그에 넣는다. 필수 드릴 7문 → 4~5문(`range-percentile` 숫자 입력은 필수에서 제외). 레슨 함께 풀기의 숫자 키패드 단계는 보기 선택으로.
3. **Ch3**: 에필로그에 짝 대국 회수 1~2줄(1막 끝 — "짝으로 등록했다"). 대사 외 구조 변경 없음.

### 이번 배치에서 하지 않는 것

- 새 CG·영상 제작(회의 합의: 기존 자산 버전의 효과를 확인한 뒤), 로비 전면 개편(파트너 홈), Ch4 이후 대사, 라이브 핸드 중간 질문 인프라
  (사용자가 "실제 테이블 위 문제"로 방향을 정했으므로 대체), 서버 채점·seed·보상 계약 변경.

## 작업 분담

| 작업자 | 범위 | 소유 파일(겹치지 않게) |
|---|---|---|
| 구현 1 (Opus, `feat/table-drills`) | 작업 A 전부 | `src/components/table/PokerTable.tsx`·신규 `TableFelt`, `src/components/story/Drill*`·`LessonPage.tsx`·`PlacementSheet.tsx`, 신규 `src/lib/story/drill-table-*.ts`, `src/lib/story/drills/types.ts`, `src/lib/story/drills/templates/position.ts` |
| 구현 2 (Opus, `feat/partner-first`) | 작업 B·C | `src/lib/story/types.ts`·`scene` 검증, `src/components/story/ScenePlayer.tsx`, `src/lib/story/chapters/act1/**`, `src/lib/story/drills/templates/authored/act1.ts`, `src/components/characters/WinnerCutIn.tsx`, `src/components/onboarding/ProfileOnboarding.tsx`, `src/components/gallery/**`·`src/lib/gallery/**`, `src/lib/coach/coach-eligibility.ts`·`PartnerCoach` 연결부 |

## 검증

- 각 작업자: 관련 Vitest + `npx tsc --noEmit` + `npm run lint`(변경 파일).
- 통합(main 병합 후): 전체 Vitest `--maxWorkers=2` 1회, `npm run build`, 브라우저 신규 사용자 주행(430×900): 온보딩 → Ch1 완주 → Ch2 드릴까지,
  테이블 문제 인트로·판단 재생·포지션 문제·족보 문제 화면 캡처.
- 독립 검토(Fable): 정답 누출(채점 전 판단 재생·좌석 필드), Ch1/Ch2 스텝 변경이 진행 중 런·빠른 진행·실력 확인·보상에 주는 영향.
