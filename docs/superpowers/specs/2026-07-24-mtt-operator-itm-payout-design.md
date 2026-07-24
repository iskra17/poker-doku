# MTT 운영 권한·ITM 축하·상금 프리셋 설계

**작성일:** 2026-07-24  
**상태:** 승인됨  
**범위:** 멀티테이블 토너먼트(MTT)

## 1. 목표

이번 변경은 다음 세 가지를 한 묶음으로 완성한다.

1. 일반 프로필은 토너먼트를 만들거나 운영할 수 없고, 백오피스 또는 명시적으로 허용된 운영자 프로필만 만들고 운영한다.
2. 버블이 끝나 입상권(ITM)이 확정되는 순간 모든 활성 테이블에 서버 권위 축하 이벤트를 한 번만 노출한다.
3. 운영자는 토너먼트 생성 시 검증된 상금 구조 프리셋을 선택하고, 참가자는 등록 전부터 확정 구조를 확인한다.

클럽 단위 권한, DB 기반 역할 관리, 바운티·미스터리 바운티, 리엔트리·리바이, 레이트 등록은 이번 범위가 아니다.

## 2. 근거와 제품 원칙

- PokerStars는 토너먼트 종류와 참가 인원에 따라 상금 구조가 달라지며 일반 MTT 우승 몫은 대략 전체 상금의 12~20%라고 안내한다.
  - https://www.pokerstars.com/help/articles/trn-payout-structure/44864/
- WSOP 공식 계산기는 ITM 비율을 5·10·12·15·18·20·25% 중에서 고르게 하고 미니 캐시 기준을 노출한다.
  - https://www.wsop.com/payoutcalculator/
- GGPoker는 상금 구조가 참가 인원과 테이블 인원 등에 따라 달라지며 토너먼트 로비에 확정 상금을 공개한다고 규정한다.
  - https://ggpoker.com/house-rules/
- PokerStars의 일부 토너먼트는 ITM 도달 시 테이블 팝업으로 참가자에게 알린다.
  - https://www.pokerstars.com/help/articles/early-payouts-trn-explanation/

이를 그대로 복제하지 않고 다음 원칙으로 Poker Doku의 2~48인 실제 시작 필드에 맞춘다.

- 상금표는 등록 전에 공개하고 시작 후에는 불변이다.
- 운영자가 “입상 폭”과 “상위 집중도”를 프리셋으로 선택한다.
- ITM 알림은 시각적 축하만 담당하며 지갑 미니 캐시를 조기 지급하지 않는다.
- 실제 지갑 상금은 기존처럼 완주 시 한 번만 정산해 에스크로와 멱등성을 유지한다.

## 3. 권한 모델

### 3.1 운영 주체

서버가 이해하는 운영 주체는 다음 두 종류다.

```ts
export type TournamentAuthority =
  | { kind: 'backoffice' }
  | { kind: 'operator-profile'; profileId: string };
```

- `backoffice`: 기존 `DEBUG_LOG_TOKEN`으로 인증된 `/admin` 요청
- `operator-profile`: `TOURNAMENT_OPERATOR_PROFILE_IDS` 환경변수의 쉼표 구분 허용 목록에 포함된 프로필 ID

환경변수 값은 서버 시작 시 앞뒤 공백과 빈 항목을 제거해 `Set<string>`으로 파싱한다. 이 목록과 백오피스 토큰은 클라이언트 응답, 게임 상태, 이벤트 로그에 절대 포함하지 않는다.

### 3.2 단일 명령 계층

소켓과 HTTP가 `TournamentManager`를 직접 다르게 호출하지 않도록 `TournamentCommandService`를 둔다.

```ts
interface TournamentCommandService {
  canOperateProfile(profileId: string): boolean;
  create(authority: TournamentAuthority, input: TournamentCreateDraft): CreateTournamentResult;
  start(authority: TournamentAuthority, tournamentId: string): TournamentCommandResult;
  act(
    authority: TournamentAuthority,
    tournamentId: string,
    action: TournamentDirectorAction,
  ): TournamentCommandResult;
}
```

명령 서비스가 권한과 입력을 검증한 뒤 기존 매니저의 생성·시작·운영 기능을 호출한다. 모든 운영자 프로필과 백오피스는 누가 만들었는지와 관계없이 현재 토너먼트를 관리할 수 있다. 이는 교대 운영을 가능하게 하며 “개설자 개인이 접속을 끊으면 운영 불가” 문제를 없앤다.

### 3.3 클라이언트와 서버 방어

- `session` 이벤트에 비밀이 아닌 `capabilities: { createTournament: boolean }`를 추가한다.
- 로비의 `+ 토너먼트 개설` 버튼은 이 capability가 참인 운영자에게만 보인다.
- 일반 프로필이 개발자 도구로 `create-tournament`, `start-tournament`, `tournament-admin`을 직접 보내도 서버가 `forbidden`으로 거부한다.
- 일반 사용자는 계속 토너먼트 조회·등록·등록 취소·복귀를 할 수 있다.
- 백오피스에서 생성한 운영 전용 토너먼트는 어떤 선수도 자동 등록하지 않는다.
- 운영자 프로필이 게임 로비에서 생성해도 자동 등록하지 않는다. 참가하려면 다른 선수와 같은 등록 절차를 거친다.

### 3.4 백오피스 API

기존 조회 API를 유지하고 다음 명령을 추가한다.

```text
GET  /api/admin/tournaments
POST /api/admin/tournaments
POST /api/admin/tournaments/:id/actions
```

액션은 `start`, `pause`, `resume`, `set-level`, `remove-player`, `cancel`만 허용한다. 모든 요청은 기존 `DEBUG_LOG_TOKEN` exact-match 인증, JSON 크기 제한, 값 검증을 통과해야 한다.

`/admin` 토너먼트 탭에는 생성 폼과 기존 운영 액션을 배치한다. 생성 폼은 이름, 시작 시각, 속도, 정원, 봇 충원, 턴 시간, 경제 모드, 상금 프리셋을 제공한다. 지갑 모드에서는 봇 충원을 서버가 강제로 끈다.

## 4. 상금 프리셋

### 4.1 타입과 단일 소스

```ts
export type PayoutPresetId = 'standard' | 'flat' | 'top-heavy';

export function payoutPercents(
  entrants: number,
  presetId: PayoutPresetId = 'standard',
): readonly number[];

export function paidPlaces(
  entrants: number,
  presetId: PayoutPresetId = 'standard',
): number;

export function computePayouts(
  prizePool: number,
  entrants: number,
  presetId: PayoutPresetId = 'standard',
): number[];
```

프리셋 레지스트리는 `src/lib/poker/payout-table.ts`의 단일 소스다. 기존 호출 호환성을 위해 프리셋을 생략하면 `standard`를 사용한다.

### 4.2 확정 배분표

모든 배열은 1위부터의 퍼센트이며 합계는 정확히 100이다.

| 실제 시작 인원 | 표준형 `standard` | 넓은 입상형 `flat` | 상위 집중형 `top-heavy` |
|---|---|---|---|
| 2 | `[100]` | `[100]` | `[100]` |
| 3~4 | `[100]` | `[65, 35]` | `[100]` |
| 5~7 | `[65, 35]` | `[50, 30, 20]` | `[70, 30]` |
| 8~11 | `[50, 30, 20]` | `[40, 28, 19, 13]` | `[65, 35]` |
| 12~24 | `[40, 26, 19, 15]` | `[32, 23, 17, 12, 9, 7]` | `[50, 30, 20]` |
| 25~34 | `[38, 25, 16, 12, 9]` | `[25, 19, 15, 12, 10, 8, 6, 5]` | `[44, 27, 17, 12]` |
| 35~48 | `[30, 21, 15, 11, 9, 7.5, 6.5]` | `[20, 16, 13.5, 11, 9.5, 8, 7, 6, 5, 4]` | `[36, 25, 17, 12, 10]` |

`standard`는 현재 상금표와 동일해 기존 연습·지갑 토너먼트의 기본 결과를 바꾸지 않는다. `flat`은 소규모 친선·레크리에이션 대회용, `top-heavy`는 챔피언십형 운영용이다.

### 4.3 불변식

- 참가 인원은 정수이며 최소 2명이다.
- 지급 순위 수는 참가 인원보다 많을 수 없다.
- 각 비율은 양수이고 내림차순이다.
- 각 프리셋/인원 구간 비율 합계는 정확히 100이다.
- 정수 칩으로 내림한 뒤 남은 칩은 1위에게 귀속한다.
- `sum(computePayouts(...)) === prizePool`
- 토너먼트 생성 시 `payoutPreset`을 저장하며 등록 시작 이후 변경 API를 제공하지 않는다.
- 상세 로비, 테이블 토너먼트 상세, 백오피스, 이벤트 로그가 동일한 프리셋 ID와 계산 결과를 사용한다.

### 4.4 지갑 정산

`EconomyRepository.settleMttTournament`는 선택한 프리셋 ID를 입력으로 받고 그 프리셋의 예상 상금과 결과를 대조한다. 멱등 재호출도 프리셋을 포함해 동일 결과인지 검증한다.

별도 DB 마이그레이션은 만들지 않는다. 현재 MTT 런타임은 서버 재시작 시 미완료 에스크로를 환불하는 계약이므로, 정산 중인 런타임 프리셋을 새 영속 엔터티로 만들 필요가 없다.

## 5. ITM 서버 이벤트

### 5.1 공개 상태

```ts
export interface TournamentMilestone {
  seq: number;
  kind: 'itm';
  reachedAt: number;
  expiresAt: number;
  paidPlaces: number;
}

export interface TournamentState {
  // 기존 필드
  milestone?: TournamentMilestone;
}
```

`TournamentRuntime`은 `milestoneSeq`와 현재 milestone을 가진다. `flushTournamentPresentation()`이 동일 milestone을 모든 활성 테이블의 `TournamentState`에 주입한다.

### 5.2 발생 조건

탈락 묶음을 적용하기 직전과 직후를 비교한다.

```ts
beforeRemaining > paidPlaces
&& afterRemaining <= paidPlaces
&& currentMilestone.kind !== 'itm'
```

- 일반 테이블에서는 `assignEliminations()`의 전체 묶음 처리가 끝난 직후 검사한다.
- H4H에서는 모든 테이블의 동일 라운드 버스트를 모아 순위를 확정한 뒤 검사한다.
- 한 라운드에서 두 명 이상이 탈락해 잔여 인원이 입상 인원 아래로 건너뛰어도 한 번만 발생한다.
- 이벤트는 액션·토너먼트 시계·다음 핸드를 보류하지 않는다.
- 이벤트 유효 시간은 서버 기준 4.5초다.

발생 시 모든 활성 테이블에 시스템 채팅을 한 번씩 추가한다.

```text
🎉 버블 종료! 남은 선수 전원이 상금권에 진입했습니다.
```

입상 순위로 탈락한 선수는 기존 `EliminationNotice`에서 `N위 입상 · 상금 X`를 계속 확인한다.

## 6. ITM 클라이언트 연출

`ItmCelebration`을 `GameRoomView`의 테이블 오버레이 계층에 추가한다.

- 제목: `IN THE MONEY`
- 본문: `축하합니다! 상금권 진입이 확정되었습니다`
- 보조 문구: `N명 입상`
- 미야코 딜러 메시지와 벚꽃잎·금빛 색종이 파티클
- 표시 시간은 서버 `expiresAt`까지만이며 로컬에서 임의로 연장하지 않는다.
- `prefers-reduced-motion`이면 파티클과 확대·이동 애니메이션 없이 정적 배너만 표시한다.
- `role="status"`와 `aria-live="polite"`를 사용한다.
- `seq`를 키로 사용하고 이미 본 sequence는 다시 재생하지 않는다.
- 재접속 또는 테이블 이동 시 `expiresAt <= Date.now()`인 이벤트는 표시하지 않는다.
- 파티클은 고정 상수 배열을 사용해 렌더 중 `Math.random()`이나 `Date.now()`를 호출하지 않는다.
- 오버레이는 `pointer-events-none`이며 액션 버튼과 턴 타이머를 막지 않는다.

## 7. 공개 화면

- 로비 토너먼트 카드와 상세 모달에 프리셋 라벨을 표시한다.
- 상세 모달은 실제 참가 인원 기준 상금표를 계속 보여준다.
- 등록 중 미리보기는 봇 충원 토너먼트라면 정원, 그렇지 않으면 현재 등록 인원(최소 2명)을 기준으로 계산한다.
- 운영자 생성 모달과 백오피스 폼은 프리셋을 변경할 때 입상 인원, 1위 비중, 미니 캐시, 예상 상금을 즉시 갱신한다.
- 일반 사용자의 로비에는 생성 버튼이 전혀 보이지 않지만 서버 거부가 최종 보안 경계다.

## 8. 감사 로그

- `mtt-create`: `tournamentId`, 이름, 속도, 정원, 테이블 크기, 경제 모드, 상금 프리셋, `authorityKind`, 운영자 프로필 ID(프로필 주체일 때만)
- `mtt-director-action`: 기존 데이터에 `authorityKind`, 운영자 프로필 ID(해당 시)
- `mtt-itm`: `tournamentId`, 시작 인원, 입상 인원, 잔여 인원, milestone sequence

백오피스 토큰과 전체 운영자 허용 목록은 기록하지 않는다.

## 9. 오류 처리

- 권한 없음: `forbidden`
- 잘못된 프리셋 또는 생성 입력: `invalid-payload`
- 동시 토너먼트 상한: 기존 `limit`
- 이미 시작했거나 종료된 상태에서 부적절한 액션: 기존 `bad-state`
- 백오피스 JSON 오류: HTTP 400
- 백오피스 인증 오류: 기존 HTTP 403

권한 검사는 레이트리밋과 상세 운영 로그보다 먼저 수행해 비운영자의 요청이 상태나 로그를 변경하지 않게 한다.

## 10. 필수 검증

테스트를 위한 구현은 만들지 않고 다음 회귀만 추가한다.

1. 일반 프로필 생성·시작·운영 거부, 허용 운영자 성공, 백오피스 성공
2. 모든 프리셋과 2~48명에 대해 비율 합계·내림차순·입상 인원·정수 상금 합계 검증
3. 지갑 정산이 선택 프리셋을 강제하고 다른 프리셋 결과를 거부
4. 일반 버블, H4H 동시 버스트, 입상선을 건너뛰는 다중 버스트에서 ITM milestone이 한 번만 발생
5. 만료 milestone 재접속 시 연출 미표시
6. 관련 Vitest, `npx tsc --noEmit`, `npm run lint`, `npm run build`

브라우저 픽셀 비교나 스냅샷을 위한 전용 테스트 페이지는 만들지 않는다.
