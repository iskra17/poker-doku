# CH6 보스 격파 컷인 계약 설계

## 배경

2막 CH6 「3벳의 온도」 보스전은 `minHands=8`, `maxHands=15`이며 다음 primary 목표를 사용한다.

- 프리미엄 핸드로 3벳 1회
- 3벳을 맞은 하위 핸드 폴드 70% 이상
- 하위 핸드 4벳 0회

첫 두 목표는 카드와 팽팽의 액션에 따라 기회가 오지 않을 수 있다. 실제 15핸드 실주행에서도 두 목표가 모두 `achieved: null`이었지만, 판정 가능한 목표는 달성되어 결산은 「S · 통과」였다. 반면 라이브 컷인은 모든 primary가 `true`일 때만 발생하므로 `BOSS DEFEATED`가 나타나지 않았다.

## 목표

보스전이 `maxHands`에서 통과하면, 기회가 없어서 제외된 primary가 있더라도 결산 전에 `BOSS DEFEATED` 컷인을 한 번 표시한다. 조기 종료는 지금처럼 모든 primary가 실제 달성된 경우에만 허용한다.

## 설계 결정

### 1. 조기 종료와 최종 통과를 분리한다

`primaryObjectivesAllAchieved`는 미션형 조기 종료 전용으로 유지한다. `achieved: null`이 하나라도 있으면 조기 종료하지 않는다. 이를 완화하면 하위 4벳 0회처럼 처음부터 `true`인 상한형 목표 하나만으로 8핸드에 종료될 수 있다.

`liveMissionCutIn`은 다음 규칙으로 컷인을 결정한다.

| 상황 | 컷인 |
|---|---|
| 일반 스파링, `minHands` 이후 모든 primary 달성 | `MISSION CLEAR` |
| 보스전, `maxHands` 전 모든 primary 달성 | `BOSS DEFEATED` |
| 보스전, `maxHands` 전 `null` 또는 실패 포함 | 없음 |
| 보스전, `maxHands` 도달 후 `primaryObjectivesMet(...) === true` | `BOSS DEFEATED` |
| 보스전, `maxHands` 도달 후 판정 가능한 실패 포함 | 없음 |
| 보스전, `maxHands` 도달 후 primary가 전부 `null` | 없음 |

최종 통과 판정에는 결산과 동일한 `primaryObjectivesMet`을 사용한다. 따라서 라이브 연출과 결산 결과가 서로 모순되지 않는다.

### 2. 목표·덱·봇 성향은 바꾸지 않는다

CH6 목표 정의, 팽팽의 전역 HUD 성향, 덱과 딜링은 변경하지 않는다. 스파링에 프리셋 핸드를 삽입하지 않으며, 특정 결과를 만들기 위한 카드 조작도 하지 않는다.

팽팽의 오픈·3벳 빈도 조정은 이번 범위에서 제외한다. 최종 통과 컷인 보장만으로 현재 사용자 경험 문제를 해결하고, 이후 실기기 피드백에서 학습 기회 자체가 부족하다고 확인될 때 별도 설계한다.

### 3. 기존 연출 수명주기를 재사용한다

새 이벤트나 서버 상태를 추가하지 않는다. `StoryOverlay`가 이미 수신하는 `StoryLiveView`의 `handsPlayed`, `maxHands`, `objectives`만 사용한다. 기존 컷인 ID, 교사 아트, 팽팽 이름, 6초 라이브 종료 유예를 그대로 재사용한다.

`liveMissionCutIn`은 순수 함수로 유지하며 조건을 만족하지 않으면 `null`을 반환한다. 네트워크 오류나 영속성 변경은 없다.

## 변경 범위

- 수정: `src/lib/story/story-cut-ins.ts`
- 수정: `src/lib/story/story-cut-ins.test.ts`

다음 항목은 변경하지 않는다.

- `src/lib/story/objectives.ts`의 공통 판정 함수 의미
- `src/lib/story/chapters/act2/ch06-three-bet-temperature.ts` 목표 데이터
- 팽팽 personality와 봇 의사결정
- 등급·보상·`failScene`
- CG, 영상, BGM과 UI 레이아웃
- 스토리 XP 레벨 보상 및 3막

## 최소 검증

기존 단일 테스트 파일에 다음 회귀 사례만 추가한다.

1. 보스전이 `maxHands`에 도달했고 primary가 `true + null`이면 컷인을 반환한다.
2. 같은 목표 상태라도 `maxHands` 전에는 컷인을 반환하지 않는다.
3. `maxHands`에서 판정 가능한 primary가 실패하면 컷인을 반환하지 않는다.

실행 명령은 다음 하나다.

```powershell
npx vitest run src/lib/story/story-cut-ins.test.ts
```

공통 타입, 서버 I/O, UI 구조, 에셋을 바꾸지 않으므로 전체 Vitest, 전체 빌드, 브라우저 자동화는 이 배치의 필수 검증에 포함하지 않는다. 최종 실기기 확인에서는 CH6를 15핸드까지 진행해 통과했을 때 컷인이 결산보다 먼저 한 번 나타나는지만 확인한다.

## 에셋 판단

CH6 보스 CG·영상과 컷인용 아라 아트가 이미 배치되어 있으므로 신규 에셋을 만들지 않는다. 중복 에셋 생성 대신 3막 설계에서 챕터별 장면·보상 목록을 먼저 확정하고, 그 목록의 정지 CG를 만든 뒤 RTX 5090 ComfyUI로 대응 영상을 병렬 생성한다.
