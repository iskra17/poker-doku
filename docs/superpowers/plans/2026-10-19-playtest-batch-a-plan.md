# 플레이테스트 A 묶음 구현 계획 (2026-10-19)

근거: `qa-tmp/playtest-2026-10-18/SYNTHESIS.md`(Sonnet 5.5 · Gemini 4 Argon · GPT 6.1 sol 실제 플레이 리뷰).
목표: 싱글 초반 1시간의 "공부 먼저·파트너 부재·보상 안 보임"을 콘텐츠 구조 변경 없이 1~3일 안에 줄인다.
범위 밖(B/C 묶음): 챕터 3~5분 분할, Ch1 뒤 인연 미니 씬, 폴드 후 대기 채우기, 챕터 목적 재설계.

## 사용자 결정 (2026-10-19)

1. A3: **① 파트너 = 훈수 담당, 상대석에 앉히지 않는다.**
2. A1: **첫 핸드 1개만 정해진 승리로 둔다.** 그 뒤 연습·스파링은 기존처럼 결과를 보장하지 않는다.
3. A5-5: **추천안** — 미션 기본 펼침 계약 유지, 좁은 화면에서 크기만 줄인다. 자동 접힘은 하지 않는다.
4. 추가 지시: 인연 씬을 빨리 볼 수 있게 XP 요구를 낮춘다 → **A6**.
5. 구현자: Luna Max 대신 **GPT 6.1 sol**. Luna는 모든 작업에서 제외한다(AGENTS.md 갱신).

## 측정 목표 (같은 페르소나 재플레이로 확인)

| 지표 | 현재 | 목표 |
|---|---|---|
| 첫 라이브 핸드 도달 | 8~24분 (Ch1 7번째 스텝) | 3분 이내 |
| 파트너 첫 대사 → 다음 파트너 대사 | Ch1 프롤로그 뒤 에필로그까지 공백, Ch2는 0 | Ch1 첫 핸드 직후·Ch1 결산·Ch2 시작에 각 1회 |
| 다음 인연 씬까지 남은 거리 노출 | 프로필 인연 탭에만 | 결산·파트너 카드·수련 허브 |
| 혼자 연습 같은 얼굴 | 최대 3중 (내 아바타·BOT·훈수) | BOT 좌석에 파트너 중복 없음 |

## A1. Ch1 "한 핸드 먼저" — 0.5일

현재 Ch1 순서: 프롤로그 → 레슨 → 드릴 2 → 씬 → 레슨 → 드릴 4 → **연습(첫 라이브)** → 스파링 → 에필로그
(`src/lib/story/chapters/act1/ch01-dojo-gate.ts`).

변경:
1. 프롤로그 바로 뒤에 `practice-table` 스텝 `act1-ch01:first-hand`를 새로 넣는다. 스크립트 1핸드만 둔다.
   - 기존 연습 ①(A♠K♠ / 보드 A♥K♦7♣2♦9♠ / 카피 Q♥Q♦)을 이 스텝으로 옮긴다. 쇼다운에서 이기는 손이다.
   - `perHandPrompt`는 판단을 요구하지 않는다: "규칙은 나중에 배워요. 콜이나 체크로 끝까지 가 보세요♪"
   - 라인업·턴 90초·`botThinkScale`은 기존 연습과 같게 한다.
2. 그 뒤에 짧은 씬 `act1-ch01:first-hand-after`(파트너 1줄 + 미야코 1줄)를 둔다.
   - 내용: "방금 그게 투페어예요. 왜 이겼는지 지금부터 배워요." 이후 기존 레슨으로 이어진다.
3. 기존 `act1-ch01:practice`의 ①은 같은 손을 반복하지 않게 다른 밸류 핸드로 바꾼다. ②(7♦2♣ 폴드)는 유지한다.
4. (선택) 첫 드릴 `act1-ch01:drills`의 첫 문항을 수기 쉬운 문항(2인, 페어 vs 하이카드급)으로 바꾼다.
   리뷰에서 첫 문항이 풀하우스 vs 스트레이트 3파전으로 나왔다. 수기 문항은 `templates/authored/act1.ts`에 추가한다.

주의:
- 스텝 인덱스가 밀린다. 진행 중 런은 인메모리라 배포 시 이미 사라지므로 마이그레이션은 없다.
  `FIRST_DRILL_CLEAR_STEP_ID` 같은 마일스톤은 id 기준이라 영향이 없다.
- `act1.test.ts`(:145-157)가 스텝 종류 순서·연습 2핸드를 고정한다. 새 순서로 갱신한다.
- 학습은 빼지 않는다. 첫 핸드만 앞으로 당긴다.

## A2. 파트너가 선택을 기억하게 하기 — 0.5일

조사 결과: Ch1 선택 플래그(`choice:act1-ch01:greet`, `choice:act1-ch01:after`)는 저장되지만 어디서도 읽지 않는다.
대사 단위 조건 필드는 없고, 씬 단위 `requiresFlags`만 있다(Ch12 `partnerScene()` 선례).

변경:
1. **Ch2 시작 회상 씬** — Ch2 프롤로그 앞에 씬 스텝 3개를 둔다: `act1-ch02:recall-thanks|more|quiet`.
   - 각 씬은 `requiresFlags: { 'choice:act1-ch01:after': <값> }`이고, 화자 `'partner'` 2~3줄이다.
   - 맞지 않는 씬은 기존 `sceneMatches`가 건너뛴다. Ch1을 안 하고 Ch2부터 하면 셋 다 건너뛴다(1막 비선형 유지).
   - 엔진·스키마 변경은 없다. 대사는 Ch1처럼 6명 공통의 중립 말투로 쓴다(파트너별 변주는 후순위 유지).
2. **결산 파트너 한마디** — `RewardReveal` 통계 다음에 파트너 말풍선 1개를 띄운다.
   - 새 순수 모듈 `src/lib/story/result-lines.ts`: 히로인 6명 × {통과, S등급, 실패} 대사, 그 외는 중립 폴백.
   - 말투는 `coach-lines.ts`의 히로인 말투를 따른다. 톤 계약: 실패에도 탓하지 않는다.
   - 파트너 id는 클라 `StoryRunView.context.partnerId`를 쓴다. 서버 DTO 변경은 없다.

## A3. 혼자 연습의 파트너 역할 정리 — 0.25일 + 사용자 결정

원인(코드 확인):
- 진행도 행은 처음 만들 때 아바타 id로 파트너를 채운다. 온보딩 기본 아바타는 사쿠라다.
- `join-room`(`socket-handler.ts:3112`)이 `ensurePartnerBot`을 부르면 파트너 캐릭터 봇이 앉는다.
- `ensurePartnerBot`(`room-manager.ts:1869`)은 봇끼리만 중복을 보고, 휴먼 아바타는 보지 않는다.
  일반 봇 충원(`bot-manager.ts getUsedCharacterIds`)은 휴먼 아바타를 제외한다.
- 훈수(`PartnerCoach.tsx:77`)도 같은 파트너 id를 쓴다.

결정이 필요하다 (권장 ①):
- **① 파트너 = 훈수 담당, 상대석에는 앉히지 않는다.** `join-room`의 `ensurePartnerBot` 호출을 제거한다.
  내 편이 상대 칩을 뺏는 모순이 사라진다. 2026-07-22 리텐션 P0의 "파트너가 테이블에 있다"는 훈수·리액션이 대신 맡는다.
- ② 파트너를 상대로 유지한다. 내 아바타와 같을 때만 앉히지 않는다(가드 1줄). 상대와 훈수가 같은 얼굴인 문제는 남는다.

어느 쪽이든 `ensurePartnerBot`에 휴먼 아바타 가드를 추가한다(다른 호출 경로 대비).
회귀: `room-manager.partner.test.ts`에 아바타 = 파트너 케이스를 추가한다.

## A4. 다음 인연 씬 예고 — 0.5일

현재: 인연 씬은 Lv5/10/15/20이다(`bond-scenes.ts BOND_SCENE_LEVELS`). Lv5까지 총 250 XP가 필요하고,
Ch1 첫 완주는 파트너에게 +30 XP뿐이다. 남은 거리는 프로필 인연 탭에만 보인다.

변경:
1. `bond-scenes.ts`에 순수 함수 `nextBondScene(characterId, level, xpInLevel)`를 추가한다.
   반환값은 `{ level, title, xpRemaining } | null`이고, 단위 테스트를 둔다.
2. 이 값을 세 곳에 보여 준다.
   - `RewardReveal`: "인연 +N" 줄 아래에 "다음 인연 씬 「제목」 · Lv.5까지 N XP" + 진행 막대.
   - `PartnerCard`: "인연 Lv.N" 옆에 같은 요약을 한 줄로.
   - `StoryHub`: 파트너 영역에 같은 요약을 한 줄로.
3. 제목은 공개하되 장면 내용은 숨긴다(잠금 실루엣 유지).

알려진 한계: 거리가 멀어서(Ch1 뒤 220 XP 남음) 예고만으로는 첫 씬이 빨리 오지 않는다.
첫 인연 장면 자체를 당기는 일은 B 묶음(Ch1 뒤 미니 씬) 또는 XP 조정 결정으로 넘긴다.

## A6. 인연 씬을 빨리 보게 하기 (XP 완화) — 0.5일

현재 수치:
- 레벨업 곡선 `affinityForNextLevel(L) = 40 + 15(L-1)` XP. 누적 Lv2 40 · Lv4 165 · Lv5 250 · Lv7 465 · Lv10 900 · Lv20 3,325.
- 인연 씬 해금 Lv 5/10/15/20. 파트너가 버는 XP는 핸드당 2(하루 30핸드 뒤 ¼), Ch1 첫 완주 30, Ch11 100.
  다른 챕터의 +100은 그 챕터 교사에게만 간다. 그래서 파트너 첫 씬(250 XP)은 사실상 몇 주 뒤다.

곡선은 바꾸지 않는다. 진행도 행은 레벨과 레벨 안 XP를 저장하고, DB 트리거가 `balance_version = 1`을 고정한다.
곡선을 낮추면 기존 행의 "레벨 안 XP < 임계" 검증이 깨진다. 대신 아래 두 가지를 바꾼다.

1. **인연 씬 해금 레벨 5/10/15/20 → 2/4/7/10** (`bond-scenes.ts`).
   - 해금은 클라이언트에서 레벨로 파생하므로 DB 변경이 없다. 기존 유저는 레벨이 이미 넘었으면 즉시 열린다.
   - 씬 id(`<캐릭터>-lv5`)와 아트·영상 파일명(`scene-lv5`, `<캐릭터>-scene-lv5`)은 **그대로 둔다**.
     해금 레벨을 별도 필드(`unlockLevel`)로 분리한다. id를 바꾸면 기록실 NEW 기준선과 영상 매핑이 깨진다.
   - 인연 보상 아이템(`AFFINITY_REWARD_LEVELS` 5/10/15/20)과 보너스 CG(4/8/12/16/20)는 DB 카탈로그가 고정하므로 건드리지 않는다.
     `bond-scenes.ts` 머리 주석의 "보상 레벨과 정합" 문장을 고친다.
2. **챕터 첫 완주의 파트너 인연 XP 상향.**
   - Ch1: 파트너 30 → **50** (Lv2 = 40이므로 Ch1 결산에서 첫 인연 씬이 바로 열린다).
   - Ch2~Ch10: 교사 몫 +100은 유지하고 **파트너 +20**을 추가한다. 파트너가 교사와 같으면 합산된다(`firstClearRewards` 기존 동작).
   - 첫 완주 보상은 멱등 키로 1회만 지급되므로, 이미 깬 챕터의 소급 지급은 없다.

예상 결과(파트너 기준): Ch1 결산에서 첫 씬(Lv2). 1막(Ch1~3) 첫 완주 + 하루 30핸드면 약 150 XP로 Lv3 후반이다.
2~3일이면 둘째 씬(Lv4 = 165), 약 1주면 셋째(Lv7), 약 2주면 넷째(Lv10).

회귀: `bond-scenes.test.ts`, `story-video.test.ts`(영상 id 유지), `story-run-coordinator.test.ts`(해금 전이),
`act1.test.ts`·`act2.test.ts`·`act4.test.ts`(보상 수치), `AffinityTab`의 잠금 타일 "Lv.N" 표기가 해금 레벨을 쓰는지.

## A5. UI 잘림·가림·문구 묶음 — 1일

| # | 증상 | 위치 | 수정 |
|---|---|---|---|
| 1 | 드릴 해설 아래가 잘림 | `DrillMomentLayer.tsx:73` 말풍선(4.5초)이 `CoachBubble` 해설 위치를 덮음 | 말풍선을 카드 상단으로 옮기거나 카드 흐름 밖으로 |
| 2 | `출제 miyako` | `DrillCard.tsx:126` (sr-only, 화면낭독용) | :257처럼 `resolveSpeaker(...).name` 사용 |
| 3 | 레벨업 초상화 머리 잘림 | `ProgressionSummary.tsx:60` + `CharacterImage.tsx:81` 비원형 object-position 없음 | 비원형 이미지에 상단 기준 위치 |
| 4 | 최소 핸드 안내 없음 | `story-live-rules.ts:148` `liveFinishHint` | "최소 N핸드 · 목표를 다 채우면 끝나요 (최대 M핸드)" |
| 5 | 미션 패널이 보드를 가림 | `StoryOverlay.tsx:139-152`, `ObjectiveHud.tsx:74` | 좁은 화면에서 높이 상한·행 압축 (아래 결정 참고) |
| 6 | [프로필]이 마지막 설정 탭을 엶 | `SettingsModal.tsx:230` 탭 상태가 열 때 초기화되지 않음 | `initialTab` prop + 열릴 때 리셋, [프로필]은 프로필 탭 |
| 7 | 완전히 나간 뒤 로비 지갑·좌석이 낡음 | 핸드 중 이탈은 정산이 핸드 끝으로 미뤄지는데(`room-manager.ts:3535 settleExit`) 그 뒤 클라 갱신이 없음 | 재현 확인 후, 정산 뒤 개인화 room-list 재방송 + 클라가 좌석 요약이 사라지면 `refresh({afterCurrent:true})` |
| 8 | "쇼다운까지 가 보기" 미션 콜을 결정 리뷰가 질책 | `review.ts:129` 정책 훅은 Ch10 오버벳만, 호출부 `story-live-adapter.ts:733` | `reach-showdown` 목표 미달성 핸드의 콜 ⚠를 "미션을 위한 콜 — 실전이라면 …" 안내로 완화 |

5번 결정: 2026-09-05 피드백으로 "미션은 기본 펼침"이 계약이다. 이 계약은 유지하고 크기만 줄이는 것을 기본안으로 한다.
대안으로 "좁은 화면에서는 첫 핸드가 끝나면 자동으로 접힘"이 있다. 이 대안은 기존 계약을 바꾸므로 사용자 승인 뒤에만 적용한다.

이번 묶음에서 제외(미재현·추정): 장면 컷 중 턴 타이머 진행, Ch2 해질녘 대사와 낮 배경, 체크 개념 문구, 승자 해설의 비교값.
재플레이 때 함께 확인한다.

## 작업 배정과 순서

동시 작업자 최대 2명, worktree 분리, 파일 소유권으로 나눈다.

| 작업자 | 담당 | 소유 파일 |
|---|---|---|
| 1 (서버·스토리 데이터 — Claude Opus) | A1, A2-1, A3, A5-7 서버 쪽, A5-8, A6-2 | `chapters/act*/*`, 챕터 테스트, `templates/authored/act1.ts`, `room-manager.ts`(+partner 테스트), `socket-handler.ts`, `review.ts`, `story-live-adapter.ts` |
| 2 (클라 UI — GPT 6.1 sol) | A2-2, A4, A5-1~6, A5-7 클라 쪽, A6-1 | `RewardReveal.tsx`, `result-lines.ts`(신규), `bond-scenes.ts`(+테스트), `story-video*`, `story-run-coordinator.test.ts`(해금 레벨 단언만), `AffinityTab.tsx`, `PartnerCard.tsx`, `StoryHub.tsx`, `DrillMomentLayer.tsx`, `DrillCard.tsx`, `ProgressionSummary.tsx`, `CharacterImage.tsx`, `story-live-rules.ts`, `StoryOverlay.tsx`, `ObjectiveHud.tsx`, `SettingsModal.tsx`, `page.tsx`, `profile-store.ts` |

순서: 두 작업자 동시 시작 → 각자 관련 테스트(단일 파일 vitest) → main 통합 →
`npx tsc --noEmit`, `npm run lint`, 전체 vitest `--maxWorkers=2` 1회, `npm run build`.
리뷰: A3(봇 착석)·A5-7(지갑 표시)·A6(인연 보상 수치·해금)은 경제·좌석·보상 경계라 Fable 독립 검토 1회. 나머지는 통합 검증으로 충분하다.

## 완료 검증

1. 자동: 위 통합 검사 전부 통과.
2. 재플레이: `qa-tmp/playtest-2026-10-18/driver.py` 하네스와 같은 페르소나(새 유저, 430×900)로 1모델 이상 재플레이.
   측정 목표 표의 4개 지표를 기록해 이번 리뷰와 비교한다.
3. 수동 확인: 아바타 = 파트너인 새 계정으로 혼자 연습 입장 → BOT 좌석에 같은 얼굴 없음.
