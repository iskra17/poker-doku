# MTT 레이트 레지·공정 좌석 배정 설계

**작성일:** 2026-07-24
**상태:** 승인됨
**선행 설계:** `2026-07-24-mtt-scheduling-admin-design.md`

현재 AGENTS.md의 MTT v1 `프리즈아웃·레이트 레지 없음` 계약 중
`레이트 레지 없음`만 이 설계가 의도적으로 교체한다.
프리즈아웃은 계속 `프로필당 한 번만 착석, 리엔트리·리바이 없음`을 뜻한다.
구현 완료 시 AGENTS.md도 이 새 계약으로 함께 갱신한다.
2026-07-25에 승인된 `2026-07-25-mtt-freeroll-promotion-fund-design.md`가
이 문서의 MTT `practice`를 `freeroll`로 교체하고, 고정 총상금의 운영 원장 예약·
휴먼 지급·봇 상금 반환 계약을 추가한다. 충돌 시 2026-07-25 문서가 우선한다.

## 1. 목표

토너먼트가 시작된 뒤에도 운영자가 허용한 시간 동안 신규 참가자를 받되,
늦게 들어온 계정들을 한 테이블에 몰아넣어 발생할 수 있는 팀 플레이·시간 끌기 이점을 줄인다.

이번 설계의 핵심은 다음 네 가지다.

1. 레이트 레지는 서버 wall-clock 기준으로 명확하게 열고 닫는다.
2. 참가자는 시작 스택 전부를 받고 프리즈아웃 원칙을 유지한다.
3. 착석은 핸드 경계에서만 하며, 여러 명은 기존 필드와 최대한 섞어 분산한다.
4. 레이트 레지 마감 전 탈락 순위와 상금은 잠정 상태로 두고 마감 시 한 번 고정한다.

## 2. 플랫폼 관행과 채택 원칙

- PokerStars 토너먼트 규칙은 레이트 레지를 정해진 시간 동안 운영하고,
  지급 구간에 가까워지면 조기 종료할 수 있으며 좌석은 무작위로 배정한다고 설명한다.
  - https://www.pokerstars.com/poker/tournaments/rules/
- GGPoker 하우스 룰은 레이트 레지가 ITM 도달이나 참가 상한 등의 조건에서 닫힐 수 있고,
  좌석 배정과 테이블 밸런싱이 운영 규칙에 따라 이뤄진다고 설명한다.
  - https://ggpoker.com/house-rules/
- Poker TDA 2024 규칙은 레이트 레지 참가자가 전체 시작 스택을 받고 무작위 좌석 풀에
  들어가는 원칙을 제시한다.
  - https://www.pokertda.com/view-poker-tda-rules/

경쟁사의 비공개 어뷰징 탐지 알고리즘은 알 수 없으므로 그대로 재현한다고 주장하지 않는다.
Poker Doku는 공개 가능한 좌석 불변식, 기존 H4H, 짧은 기본 액션 시간,
서버 감사 로그를 조합해 공정성을 높인다.

## 3. 범위

### 포함

- 개설 시 레이트 레지 활성화 여부
- 속도별 기본 2레벨 등록 창
- 1·2·3레벨 빠른 선택과 계산된 마감 시각
- 서버 wall-clock 기반 마감
- 전체 시작 스택 지급
- 최소 스택 깊이, 참가 상한, 버블 도달에 따른 조기 마감
- 한 명 및 여러 명 동시 등록의 핸드 경계 착석
- 새 테이블이 필요할 때 기존 참가자와 혼합
- 등록 마감 전 잠정 상금과 지연된 최종 순위
- wallet 에스크로의 등록·실패 보상
- 공개 카운트다운과 좌석 배정 대기 UI

### 제외

- 리엔트리·리바이·애드온
- 등록 시 할인·위성 토너먼트 티켓
- 팀/클럽 소속 기반 강제 분리
- IP 하나당 한 계정 제한
- 머신러닝 기반 콜루전 판정
- 대기열 순번 판매나 우선 좌석

## 4. 설정

```ts
interface LateRegistrationPolicy {
  enabled: boolean;
  durationLevels: 1 | 2 | 3;
  minStartingStackBb: 20;
}
```

- 기본값은 `enabled=false`다.
- 활성화 시 권장 기본값은 `durationLevels=2`다.
- 프리셋 기준 기본 최대 창은 다음과 같다.
  - 스탠다드: 16분
  - 터보: 10분
  - 하이퍼: 6분
- 커스텀 구조는 첫 N개 블라인드 레벨의 지속 시간을 합산해 마감 epoch를 계산한다.
- 마감 epoch는 `actualStartedAt + 첫 N개 레벨 지속 시간 합계`다.
  예약 시작이 지연돼도 실제 플레이 시작 전 레이트 레지 시간이 소진되지 않는다.
- 중간에 브레이크가 있어도 wall-clock 마감 시각은 연장하지 않는다.
- 디렉터 일시정지, 서버 지연, 테이블별 핸드 길이 차이도 마감 시각을 연장하지 않는다.
- `minStartingStackBb=20`은 v1의 고정 안전선이다. 운영자가 더 불리한 진입 조건을 만들지 못하게
  설정 UI에서 변경할 수 없고 안내만 표시한다.

레이트 레지 설정은 토너먼트 인스턴스 스냅샷에 포함되며 등록이 열린 뒤 바꿀 수 없다.

## 5. 등록 상태

게임 진행 단계와 등록 가능 여부를 분리한다.

```ts
type TournamentRegistrationState =
  | 'not-open'
  | 'open-prestart'
  | 'locked-for-start'
  | 'open-late'
  | 'closing'
  | 'closed';
```

- `not-open`: 로비에는 보일 수 있지만 아직 등록할 수 없음
- `open-prestart`: 시작 전 일반 등록
- `locked-for-start`: 예정 시각 도달 또는 start CAS 뒤 신규 등록이 잠김
- `open-late`: 게임은 진행 중이고 레이트 레지 가능
- `closing`: 새 요청은 거절하고 이미 수락한 배치를 착석·정리 중
- `closed`: 필드·상금·순위 기준 고정

토너먼트 `phase='running'`이어도 `registrationState='open-late'`일 수 있다.
기존처럼 `phase !== 'registering'`만 보고 등록을 거절하지 않는다.

인스턴스와 등록 상태의 유효 조합은 다음뿐이다.

| 인스턴스 상태 | 등록 상태 | 의미 |
|---|---|---|
| `scheduled-hidden|scheduled-visible` | `not-open` | 예정·미등록 |
| `registering` | `open-prestart` | 시작 전 등록 |
| `start-delayed|starting` | `locked-for-start` | 신규 등록 잠금, `starting` 전까지만 기존 취소 가능 |
| `running` | `open-late` | 진행 중 레이트 레지 |
| `running` | `closing` | pending 배치 처리와 상금 고정 |
| `running` | `closed` | 고정 필드로 진행 |
| `payout-pending|refund-pending|cancelled|completed` | `closed` | 신규 등록 불가 |

`registration_state`와 아래 `registration_close_reason`은 `tournament_instance`에 영속한다.
`closing`은 runtime에만 존재하는 추정값이 아니며 중복 close 명령을 CAS로 막는다.

```ts
type RegistrationCloseReason =
  | 'late-reg-disabled'
  | 'time'
  | 'full'
  | 'stack-floor'
  | 'bubble'
  | 'final-table'
  | 'last-player'
  | 'tournament-cancelled'
  | 'tournament-completed';
```

실제 시작 성공 시:

- 레이트 레지 비활성: `locked-for-start → closed`, 첫 핸드 전에 상금 고정
- 레이트 레지 활성이고 시작 시점의 full·stack-floor·bubble·last-player 조건이 모두 거짓:
  `locked-for-start → open-late`
- 레이트 레지 활성이라도 시작 스냅샷에서 동적 마감 조건이 이미 참:
  `locked-for-start → closed`, `finalEntrants=initialEntrants`와 상금을
  running CAS의 immutable freeze plan으로 첫 공개·첫 핸드 전에 고정

공개 상태에는 다음을 포함한다.

```ts
interface PublicLateRegistrationState {
  state: TournamentRegistrationState;
  closesAt?: number;
  entrants: number;
  maxEntrants: number;
  startingStack: number;
  startingStackBb: number;
  payoutStatus: 'provisional' | 'final';
}
```

`closesAt`은 서버 epoch이며 클라이언트는 표시용 카운트다운만 계산한다.
마감 판정은 항상 서버가 한다.

## 6. 마감 조건

정상 레이트 레지는 다음 중 가장 먼저 발생한 조건에서 닫힌다.

1. 설정에서 계산한 `lateRegistrationClosesAt` 도달
2. 전체 필드가 `maxEntrants` 도달
3. 현재 적용 레벨에서 시작 스택이 20BB 미만
4. 생존자가 잠정 입상 인원 + 1명 이하가 되어 버블에 도달
5. 과거 2테이블 이상이었던 필드가 pending 포함 유효 생존자 기준으로
   파이널 테이블 정원을 초과한 상태에서 정원 이하로 교차
6. 유효 생존자가 마지막 1명에 도달

정확한 동적 조건은 다음과 같다.

```text
full:          acceptedEntrants >= maxEntrants
bubble:        effectiveRemaining <= paidPlaces(acceptedEntrants) + 1
final-table:   everMultiTable
               && previousEffectiveRemaining > tableSize
               && effectiveRemaining <= tableSize
last-player:   effectiveRemaining <= 1
```

신규 reserve는 `acceptedEntrants`와 `effectiveRemaining`을 각각 정확히 1 올린다.
v2 `paidPlaces(n)=ceil(n×p)`, `p∈{0.10,0.15,0.20}`는 한 명 증가 때 최대 1만 오르므로,
reserve 전 bubble이 거짓이면 reserve 뒤에도 거짓이다. 따라서 reserve write point가 새로 만드는
동적 close는 cap의 `full`뿐이며, bubble은 release·탈락·remove처럼 effectiveRemaining이 내려가는
write point에서 평가한다. 이 단조성은 payout 표의 필드별 property test로 고정한다.

별도의 임의 `레이트 레지 강제 연장` 액션은 v1에 두지 않는다.
참가자가 본 마감 조건을 운영자가 사후 변경하지 못하게 한다.

20BB 판정은 테이블별로 아직 적용되지 않은 로컬 블라인드가 아니라
토너먼트 단일 시계의 현재 `MttClockPosition`이 가리키는 global level BB를 사용한다.
일부 테이블이 긴 핸드 때문에 이전 레벨을 적용 중이어도 신규 참가 조건은 전 필드에서 하나다.
일시정지 중 디렉터가 시작 스택을 20BB 미만으로 만드는 forward `set-level`을 요청하면
등록 close CAS를 먼저 성공시킨 뒤 레벨을 적용한다. 낮은 레벨로 되돌려도 닫힌 등록은 다시 열지 않는다.

20BB는 등록 수락 순간의 조건이다. 25BB일 때 수락된 참가자가 긴 핸드를 기다리는 동안
global level이 올라 15BB가 되어도 환불하거나 시작 스택을 바꾸지 않고 약속한 전체 스택으로 착석시킨다.
공개 UI에는 `등록 시점 기준 · 좌석 대기 중 블라인드가 오를 수 있음`을 표시한다.

`lateRegistrationClosesAt`에는 TournamentManager의 단일 `lateRegTimer`를 건다.
등록이 시간 외 조건으로 먼저 닫히거나 토너먼트가 취소·완료·dispose될 때 반드시 해제한다.
일시정지·브레이크·테이블 생성은 이 타이머를 재무장하거나 연장하지 않는다.
등록 요청 자체도 상태만 믿지 않고 `now < lateRegistrationClosesAt`을 다시 검사한다.
이벤트 루프 지연으로 timer callback이 늦어져도 만료 뒤 요청을 수락하지 않는다.

동적 조건이 참이 되는 쓰기 지점도 고정한다.

- 시작 준비: prepared roster·초기 global level·상금 미리보기로 full/stack-floor/bubble/last-player를
  먼저 계산한다. 이미 참이면 `running/closed`와 immutable freeze plan을 한 transaction으로 기록하고,
  `open-late`를 한 프레임도 공개하지 않는다.
- 마지막 cap 슬롯 reserve: `pending_late_entrants += 1`과
  `open-late → closing/full`을 같은 transaction에서 처리한다.
- 자연 레벨업·forward set-level: 새 global BB를 적용하기 전에
  `open-late → closing/stack-floor` CAS를 먼저 처리한다.
- 핸드 완료: `MttRoomHooks.onHandComplete`의 동기 slice가 provisional 탈락과 alive count를 반영한 뒤
  bubble/final-table/last-player를 검사하고, 참이면 다음 핸드 예약이나 다른 socket event로 yield하기 전에
  `open-late → closing/<reason>` CAS와 전 테이블 closing hold를 먼저 잡는다.
- pending 등록 release·실패 보상: `pending_late_entrants`를 내린 뒤의
  `effectiveRemaining`으로 bubble/final-table/last-player를 다시 계산한다. 참이면 release와
  `open-late → closing/<reason>` close claim을 같은 SQLite transaction에서 기록하고,
  기존 seating hold를 풀거나 다음 핸드를 예약하기 전에 closing owner로 handoff한다.
- 디렉터 remove: 잔여 스택 forfeit·provisional 탈락·alive 감소를 반영한 뒤의
  `effectiveRemaining`으로 같은 조건을 다시 계산한다. 참이면 forfeit 원장과 close claim을
  같은 transaction에 기록하고 remove owner가 hold를 풀기 전에 closing owner로 handoff한다.

동일 event-loop에서 등록 transaction이 먼저 commit되면 그 참가자는 이미 수락된 pending으로 closing이 처리하고,
closing CAS가 먼저면 등록은 거절된다. 상태 판정을 비동기 UI update나 후속 timer에 맡기지 않는다.
둘 이상의 동적 조건이 동시에 참이면 `last-player → bubble → final-table → stack-floor → full → time`
순으로 하나의 close reason을 고정한다. 조건별 표시 우선순위일 뿐, 어느 이유로 닫혀도 등록은 다시 열지 않는다.

모든 MTT 다음 핸드 진입점은 메모리 hold만 검사하지 않는다.
`RoomManager.startNewHand()` 직전의 동기 `MttRoomHooks.checkNextHandGate()`가 DB의
`registration_state`, `registration_generation`, `registration_owner_token`을 현재 runtime projection과
비교한다. DB가 `closing`이면 해당 callback에서는 절대 핸드를 시작하지 않고,
DB close owner의 projection과 `late-reg-closing` hold를 동기적으로 채택한 뒤 continuation을 큐에 넣는다.
DB가 `closed`인데 runtime에 exact freeze version과 final field가 아직 적용되지 않았으면
`retry`로 persisted snapshot을 reconcile하고, terminal 상태면 새 핸드를 영구 차단한다.
DB와 runtime이 모두 `open-late`, 또는 exact `closed` projection으로 일치할 때만
나머지 합성 hold를 검사해 시작을 허용한다.
DB 읽기·채택이 실패하거나 상태 조합이 불명확해도 fail-closed로 `retry`를 반환한다.
따라서 close transaction commit 직후 command stack이 예외로 끝나더라도 이미 예약된 next-hand timer가
복구 tick보다 먼저 새 핸드를 열 수 없다.

```ts
type NextHandGateResult =
  | { status: 'allow' }
  | { status: 'held' }
  | { status: 'retry'; generation: number; ownerToken: string }
  | { status: 'terminal' };
```

`retry`는 단순 `false`가 아니다. RoomManager는 기존 pending start timer가 callback 진입 시 제거됐다는
전제에서 다음 생존성 계약을 수행한다.

- room별 opaque reconcile owner로 `mtt-state-reconcile` hold를 잡고,
  250ms→500ms→1s→2s→최대 5s의 capped backoff retry를 별도 lifecycle timer에 등록한다.
- manager tick도 같은 `(roomId, generation, ownerToken)`의 reconcile을 멱등 호출한다.
- DB read와 projection/freeze 적용이 성공하면 exact owner hold만 해제하고,
  `resumeRoom({ expectedHandNumber, expectedGeneration, ownerToken })`을 명시적으로 호출한다.
- `resumeRoom`은 진행 중 핸드 없음, 같은 handNumber/generation, 남은 합성 hold 없음,
  아직 next-hand timer 없음일 때만 하나를 예약한다. retry와 manager tick이 겹쳐도 두 핸드를 만들지 않는다.
- persistent fault는 hold를 유지하고 backoff를 계속하며 30초마다 throttled ops 경보를 남긴다.
  `disposeRoom()`과 terminal cancel/complete는 retry timer와 reconcile hold를 함께 지운다.
- `terminal`만 재시작을 영구 예약하지 않는다. 일반 `held`는 해당 hold owner의 기존 resume 계약을 따른다.

따라서 일시적인 SQLite read·projection fault는 플레이를 안전하게 멈추지만 영구 교착시키지 않고,
복구 뒤 정확히 한 번 다음 핸드를 재개한다.

정상 마감은 다음처럼 원자적으로 처리한다.

```text
OPEN_LATE
  → 새 등록 요청 차단
  → 모든 활성 테이블에 late-reg-closing hold
  → 진행 중 핸드만 완료하고 다음 핸드 시작 차단
  → 이미 수락한 pending 배치 착석 또는 실패 환불
  → 최종 참가 인원 확정
  → 총상금과 순위별 지급액 확정
  → 기존 탈락자의 최종 순위 재계산
  → CLOSED
  → H4H/ITM/파이널/우승 조건 평가
```

wall-clock 마감이 핸드 도중 도달해도 그 핸드를 중단하지 않는다.
먼저 끝난 테이블도 `late-reg-closing` hold에서 다른 테이블을 기다리며,
모든 진행 중 핸드의 탈락 배치를 수집한 뒤 한 번만 필드를 고정한다.
따라서 closing 도중 다른 테이블이 새 핸드를 시작해 순위·ITM 기준이 계속 변하지 않는다.

토너먼트 취소는 정상 마감과 다른 abort 경로다.

```text
최종 결과 전 instance lifecycle에서만 cancel
  → cancel CAS: 새 등록 차단 + operation generation 증가
      wallet   → refund-pending 영속
      freeroll → refund-pending 영속
  → 생성 방 정리
  → wallet은 pending 포함 모든 참가비 멱등 전액 환불
  → freeroll은 예약한 총상금을 공용 운영 원장에 전액 반환
  → 자금 반환 완료 뒤 cancelled
```

허용 lifecycle은
`scheduled-hidden|scheduled-visible|registering|start-delayed|starting|running`이다.
`payout-pending|completed|cancelled`의 새 취소는 명시적으로 거절한다.
등록 상태가 `closed`여도 아직 `running`이고 settlement plan이 없다면 운영 취소할 수 있지만,
결과가 고정된 `payout-pending`을 등록 상태만 보고 취소해서는 안 된다.

취소는 새 `finalEntrants`, 상금표, 최종 순위, H4H, ITM milestone을 만들지 않는다.
이미 startup/normal freeze가 commit된 뒤의 취소라면 그 immutable snapshot은 지우지 않고
`payout_freeze_aborted_at`을 기록해 감사용으로만 보존하며 공개·정산에서 무효화한다.
토너먼트 정상 완료는 반드시 그 전에 normal close를 끝낸 뒤에만 발생한다.
두 모드 모두 반환보다 `refund-pending`을 먼저 기록하므로 프로세스가 중간에 죽어도
재시작 조정이 남은 환불·상금 반환을 이어간다. runtime 방 정리는 idempotent하게 재시도하며,
취소된 runtime이 남아 있으면 다음 매니저 tick이 `disposeRoom()`을 다시 호출한다.

freeroll cancel의 첫 `BEGIN IMMEDIATE` transaction은 다음 durable claim만 수행한다.

- instance를 `refund-pending/closed/tournament-cancelled`로 claim
- `pending_late_entrants=0`
- pre-freeze면 `final_entrants/payout_freeze` null 유지,
  post-freeze면 exact 값을 보존하고 `payout_freeze_aborted_at`만 기록
- `registered|seat-claimed|late-pending|seated|eliminated|finished` 등록 행을 `cancelled`로 전이
- `ever_seated`와 누적 `committed_entrants`는 감사용으로 유지

두 번째 멱등 transaction이 같은 generation의 claim과 `reserved` 에스크로를 확인한 뒤
상금 전액을 공용 운영 원장에 반환하고 에스크로를 `refunded`, instance를 `cancelled`로 전이한다.
두 번째 transaction이 실패해도 첫 claim은 유지되어 다음 tick·재시작이 반환을 이어간다.

wallet cancel의 첫 CAS는 instance를 `refund-pending/closed/tournament-cancelled`로 잠그고,
기존 freeze가 있으면 exact 값을 보존한 채 `payout_freeze_aborted_at`을 기록하며,
환불 전 active claim을 성급하게 풀지 않는다. 이어지는 `voidMttTournament()`는 한 transaction에서
모든 `reserved|started` 경제 행의 전액 환불, 관련 등록 행의 `refunded` 전이,
`pending_late_entrants=0`, instance `cancelled` 전이를 함께 commit한다.
하나라도 실패하면 전체 rollback해 `refund-pending`과 active claim을 유지한다.
따라서 어느 crash 지점에서도 종결 instance 뒤 `seat-claimed|late-pending|seated`가 남아
프로필을 영구 잠그지 않는다.

환불 성공 여부와 live room 정리는 분리한다. cancel owner는 cancel CAS 직전에 모든 테이블에
owner-scoped `tournament-cancel` fence만 동기 설치하고, 같은 event-loop turn에서 `await` 없이
SQLite CAS를 끝낸다. CAS 전에는 timer/deadline을 해제하지 않으므로 실패하면 자신의 fence만
제거해 정확한 기존 진행을 계속한다. CAS가 성공한 뒤에만 action·turn·runout·bot·next-hand timer를
해제하고 session engagement/room projection을 지우며, `room-lost`를 보낸 뒤 모든 방을 멱등 dispose한다.
wallet 환불이나 프리롤 상금 반환이 계속 실패해도 `refund-pending` 회차의 핸드나 액션이
살아 있지 않으며, 자금 반환 재시도는 방이 없는 상태에서 진행한다.
active claim은 반환 transaction 성공 때까지 유지한다.

Node 이벤트 루프에서 등록 요청과 탈락 처리가 경합하면 먼저 상태를 변경한 서버 명령이 정본이다.
`closing`으로 바뀐 뒤 도착한 요청은 클라이언트가 이전 카운트다운을 보고 보냈더라도 거절한다.

버블 조건은 각 핸드 완료 배치 뒤와 다음 핸드 예약 전에 평가한다.
한 핸드의 다중 탈락으로 버블을 건너뛰면 그 탈락 배치를 먼저 반영하고 즉시 마감한 뒤
ITM 이벤트를 한 번만 계산한다.

## 7. 참가 자격과 칩

- 신규 프로필만 등록할 수 있다.
- 이미 등록했거나 탈락한 프로필은 다시 등록할 수 없다.
- 시작 전 등록했지만 체크인 실패로 전액 환불된 `no-show` 프로필은 참가한 것으로 보지 않는다.
  레이트 레지 창이 열려 있으면 새 에스크로로 한 번 등록할 수 있다.
- 착석 전 서버 실패로 정확한 attempt가 `cancelled|refunded`된 프로필도 창이 열려 있고
  `ever_seated=0`이면 새 `registrationAttempt`로 다시 요청할 수 있다.
- 다른 진행 중 wallet MTT에 참가 중인 프로필은 기존 경제 가드로 거절한다.
- 프리즈아웃이므로 추가 바이인이나 같은 토너먼트 재입장은 없다.
- 레이트 레지 참가자는 최초 참가자와 같은 전체 시작 스택을 받는다.
- 이미 지나간 블라인드나 앤티를 소급 공제하지 않는다.
- 현재 레벨 기준 시작 스택 BB를 등록 버튼 옆에 표시한다.
- 수락 뒤 좌석 배정 중 연결이 끊겨도 등록을 취소하지 않는다.
  좌석에 `away`로 착석시키고 블라인드·앤티가 정상 소진되게 한다.

IP는 한국 통신사 CGNAT에서 여러 정상 사용자가 공유할 수 있으므로 동일 IP 등록을 하드 차단하지 않는다.
중복 프로필, 기존 좌석, 경제 에스크로, 좌석 분산을 강제하고 IP 기반 콜루전 분석은 후속 운영 도구로 둔다.

### 7.1 필드 카운터와 pending 칩

현행 `seatedCount` 하나를 상금·상한·H4H에 공용으로 쓰지 않는다.
런타임은 다음 정본을 분리한다.

```ts
interface TournamentFieldCounters {
  initialEntrants: number;
  committedEntrants: number;
  pendingLateEntrants: number;
  aliveSeated: number;
  finalEntrants: number | null;
  everMultiTable: boolean;
  forfeitedChips: number;
}
```

`initialEntrants`, `committedEntrants`, `pendingLateEntrants`, `finalEntrants`, `everMultiTable`,
`forfeitedChips`는
`tournament_instance`의 DB 정본을 runtime이 projection한다. `aliveSeated`만 현재 live 엔진들에서 파생한다.
reserve는 같은 `BEGIN IMMEDIATE` transaction에서 다음 조건부 갱신이 정확히 한 행을 바꿀 때만 성공한다.

```text
pending_late_entrants += 1
WHERE registration_state = 'open-late'
  AND committed_entrants + pending_late_entrants < instance.max_entrants
```

commit은 같은 등록 attempt transaction에서 `pending -= 1, committed += 1`,
release는 `pending -= 1`을 적용한다. 음수나 상한 초과는 DB CHECK와 변경 행 수 검사로 거절한다.
따라서 메모리 큐가 유실되거나 동시에 여러 요청이 와도 cap 슬롯의 정본이 사라지지 않는다.

- `initialEntrants`: 시작 시 착석한 휴먼+봇, 이후 불변
- `committedEntrants`: 실제 좌석과 시작 스택이 생성된 누적 참가자 수
- `pendingLateEntrants`: 에스크로·상한 슬롯은 예약됐지만 아직 좌석을 받지 못한 수
- `acceptedEntrants = committedEntrants + pendingLateEntrants`: 잠정 필드와 cap 계산
- `aliveSeated`: 각 테이블 엔진의 실제 생존 좌석 합계
- `effectiveRemaining = aliveSeated + pendingLateEntrants`: 우승·파이널·버블 전이 보류용
- `finalEntrants`: 정상 마감 뒤 `pendingLateEntrants=0`일 때만 설정
- `everMultiTable`: table count가 한 번이라도 2 이상이 되면 true로 고정

용도는 고정한다.

| 계산 | 사용하는 값 |
|---|---|
| 등록 상한 | `acceptedEntrants` |
| wallet 모집 중 예상 총상금·입상자 | `acceptedEntrants` |
| 프리롤 총상금 | 회차의 `reserved` 상금 에스크로 금액 |
| 프리롤 모집 중 입상 인원·순위별 배분 | `acceptedEntrants` |
| 테이블 밸런싱 | `aliveSeated` + 이번 배치 |
| 우승·파이널 전이 가능 여부 | `effectiveRemaining` |
| H4H·ITM·확정 상금 | `finalEntrants`, `aliveSeated` |

pending 참가자는 아직 엔진 플레이어가 아니며 가상 칩을 만들지 않는다.
순위 참가자로 확정하지도 않고, pending이 존재하는 동안 우승·파이널·H4H 전이만 보류한다.
좌석과 wallet commit이 모두 성공하는 순간 시작 스택을 생성하고 `committedEntrants`를 1 올린다.
환불되면 `pendingLateEntrants`만 1 내리고 필드 이력에서 제외한다.

핸드 경계마다 다음 칩 불변식을 검사한다.

```text
각 진행 중 핸드: sum(player.chips + player.totalContributed)
각 핸드 사이: sum(player.chips)
위 테이블별 합계의 토너먼트 전체 합
  + forfeitedChips
  = committedEntrants × 해당 회차 startingStack
```

`totalContributed`는 dead contribution을 이미 포함하고 팟은 여기서 재유도되므로,
dead contribution이나 팟 금액을 위 합계에 다시 더하지 않는다.
pending은 좌변과 우변 어디에도 들어가지 않는다.

디렉터 `remove-player`는 진행 중 핸드라면 기존 pending-removal/fold 경로로 그 핸드 정산을 먼저 끝낸다.
그 뒤 안전 경계에서 다음 작은 saga를 실행한다.

```text
immutable ForfeitPlan(removalId, player/seat snapshot, remaining chips) 계산
→ 좌석/잔여 스택 silent 제거 + rollback journal
→ tournament_forfeit INSERT
   + forfeited_chips 증가
   + 등록/attempt provisional 또는 확정 탈락 전이 단일 DB CAS
   + 동적 마감 교차 시 generation/owner close claim을 같은 transaction에 기록
→ close claim이면 closing projection/hold 선점 후 remove owner handoff
→ runtime forfeited projection 갱신
→ 방/순위 publish
```

- **남은 chips만** forfeit한다. 이미 팟에 들어갔다가 정산된 `totalContributed`는 다시 더하지 않는다.
- DB CAS가 실패하면 publish 없이 journal로 좌석·스택·pending flags를 정확히 복원한다.
- DB commit 뒤 projection이 실패하면 다음 핸드를 hold하고 persisted `removal_id/amount`로
  silent 제거를 멱등 재적용한다. 좌석 상태 때문에 재적용할 수 없으면 전체 토너먼트를 안전 취소한다.
- 동일 `removalId` 재호출은 같은 player/amount일 때만 성공하며 이중 forfeit를 만들지 않는다.
- 일반 탈락·이동·cancel은 `forfeited_chips`를 변경하지 않으며 payout prize pool에도 포함하지 않는다.
  일반 플레이어 공개 상태에는 금액을 노출하지 않고 백오피스 감사 상세에만 표시한다.

3~6명 단일 테이블로 시작한 late-reg 회차는 `everMultiTable=false`이므로 파이널 테이블 조건만으로
시작 직후 닫히지 않는다.
등록 마감 전 7명 이상이 되어 두 번째 테이블을 만들면 그때부터 `everMultiTable=true`이고,
이후 실제 파이널 테이블로 다시 합쳐질 때 정상 조기 마감한다.
단일 테이블로 끝까지 유지되면 시간·상한·스택·버블·마지막 1명 중 다른 조건에서 닫고,
그 뒤 파이널 인트로를 진행한다.
2명으로 시작한 회차는 이미 1위 입상 기준의 버블이므로 bubble 조건으로 즉시 닫힌다.

## 8. 등록 트랜잭션

### 8.1 공통 순서

1. 프로필과 현재 소켓 소유권 검증
2. 토너먼트 ID와 등록 상태 검증
3. 중복·탈락·다른 토너먼트 참가 여부 검증
4. 상한의 좌석 한 칸을 원자적으로 예약
5. wallet이면 레이트 레지용 참가비+수수료 에스크로 예약
6. `tournament_registration`을 `late-pending`으로 기록
7. repository 결과가 `reserved`일 때만 key 기준 멱등 좌석 배정 큐에 추가
8. 새/기존 reserved는 `accepted=true, status='seating'`,
   기존 seated/terminal requestId는 저장된 결과를 그대로 반환

검증·상한 예약보다 로그를 먼저 남기지 않는다.

기존 `startMttTournament()`는 시작 시점의 전체 `reserved` 명단을 정확히 한 번에
`started`로 바꾸므로 진행 중 신규 참가에 재사용할 수 없다.
선행 설계의 `TournamentEnrollmentRepository`에 다음의 좁은 멱등 API를 추가한다.

```ts
type LateEntryKey =
  | {
      profileId: string;
      economyMode: 'freeroll';
      requestId: string;
      registrationAttempt: number;
    }
  | {
      profileId: string;
      economyMode: 'wallet';
      requestId: string;
      registrationAttempt: number;
      economyEntryAttempt: number;
    };

type NormalRegistrationCloseReason = Exclude<
  RegistrationCloseReason,
  'late-reg-disabled' | 'tournament-cancelled' | 'tournament-completed'
>;

interface RegistrationCloseClaim {
  generation: number;
  ownerToken: string;
  reason: NormalRegistrationCloseReason;
}

interface DynamicCloseCandidate {
  expectedGeneration: number;
  ownerToken: string;
  reason: 'bubble' | 'final-table' | 'last-player';
}

type LateEntryReservationResult =
  | {
      status: 'reserved';
      key: LateEntryKey;
      acceptedAt: number;
      closeClaim?: RegistrationCloseClaim;
    }
  | { status: 'seated'; key: LateEntryKey; acceptedAt: number }
  | {
      status: 'terminal';
      key: LateEntryKey;
      acceptedAt: number;
      resultCode: 'cancelled' | 'refunded' | 'no-show' | 'eliminated' | 'finished';
    };

type LateEntryReleaseResult =
  | {
      status: 'released' | 'already-released';
      closeClaim?: RegistrationCloseClaim;
    }
  | {
      status: 'closing';
      closeClaim: RegistrationCloseClaim;
    }
  | {
      status: 'terminal';
      resultCode: 'cancelled' | 'refunded' | 'no-show' | 'eliminated' | 'finished';
    };

interface TournamentEnrollmentRepository {
  reserveLateMttEntry(
    profileId: string,
    tournamentId: string,
    requestId: string,
    candidateCloseOwnerToken: string,
  ): LateEntryReservationResult;
  commitLateMttBatch(
    tournamentId: string,
    entries: ReadonlyArray<LateEntryKey>,
  ): void;
  releaseLateMttEntry(
    tournamentId: string,
    entry: LateEntryKey,
    closeCandidate: DynamicCloseCandidate | null,
  ): LateEntryReleaseResult;
}
```

- `reserveLateMttEntry`
  - 공통으로 등록 상태, active seat claim, `acceptedEntrants` 상한을 같은 transaction에서 검사한다.
  - 상한은 caller 인자가 아니라 DB instance의 immutable `max_entrants` 열을 읽어 조건부 갱신한다.
  - `candidateCloseOwnerToken`은 클라이언트 값이 아니라 command service가 요청마다 만든 opaque server token이다.
  - 동일 `requestId` attempt가 있으면 상태·잔액·cap을 바꾸지 않고
    저장된 `reserved|seated|terminal` discriminated 결과를 반환한다.
  - 새 `requestId`인 모든 모드에서만 `tournament_registration.registration_attempt`를 단조 증가시키고
    그 값이 든 key로 등록 행과 cap 슬롯을 예약한다.
  - 프리롤은 참가자별 경제 행을 만들지 않지만 회차의 `reserved` promotion 상금 에스크로를 검증한다.
  - wallet은 해당 토너먼트에 최소 한 개의 `started` 행이 있고, 모든 active 행이 같은
    incarnation·바이인·수수료의 `started` 또는 검증된 late `reserved`인지 확인한다.
  - wallet은 같은 토너먼트의 `started + late reserved` 합계로 경제 상한도 교차 검사하고,
    지갑에서 참가비+수수료를 에스크로로 이동해 정확한 새 `economyEntryAttempt` 행만 `reserved`로 둔다.
  - 같은 SQLite transaction에서 `tournament_registration='late-pending'`도 기록한다.
  - 이 예약으로 `committed+pending == max_entrants`가 되면 같은 transaction에서
    `open-late → closing/full`, `registration_generation+1`, owner token 기록,
    attempt의 close claim 기록까지 수행한다.
  - ack 유실 재호출은 새 시도를 만들지 않고 기존의 동일 `LateEntryKey`를 반환한다.
  - 기존 started 행과의 일시적 혼재는 레이트 레지 pending 상태에서만 허용한다.
  - command service는 `reserved.closeClaim`이 있으면 다른 실패 가능 작업이나 `await`보다 먼저
    동기 `adoptClosingProjection(generation, ownerToken)`으로 runtime 상태와 전 테이블 closing hold를 설치한다.
    그 뒤에만 key 기준 멱등 `ensureQueued()`하고 `status='seating'`으로 ack한다.
    `seated`는 현재 좌석/resync 결과, `terminal`은 저장된 resultCode를 API 오류/완료 상태로 그대로 매핑한다.
    terminal retry를 다시 큐에 넣거나 새 `seating` 성공으로 응답하지 않는다.
  - `adoptClosingProjection` 뒤 `ensureClosingFromDb(generation, ownerToken)` continuation을 큐에 넣는다.
    동일 requestId replay도 저장된 동일 claim을 반환하며 exact owner adoption은 멱등이다.
  - repository 반환 직후 command 자체가 예외로 끝나는 fault도
    `checkNextHandGate()`의 DB close-claim 검사로 막는다. manager tick은 복구 수단이지만 안전성의
    유일한 근거가 아니다.
  - 매 TournamentManager tick과 resync도 DB에서 `registration_state='closing'`인 instance를 찾아
    owner token으로 coordinator를 멱등 재구성한다. commit 뒤 command 예외가 나도 closing이 고착되지 않는다.
- `commitLateMttBatch`
  - silent 좌석 배정이 성공한 배치의 모든 `LateEntryKey`를 한 transaction에서 검증한다.
  - instance가 `running/(open-late|closing)`이고 current 등록 행과 attempt 이력이 모두
    exact key의 `late-pending`일 때만 최초 commit한다.
  - 재호출에서 current·attempt·wallet 경제 행이 모두 exact key의 `seated|started`이면
    이미 성공한 멱등 결과를 반환한다.
  - 한쪽이라도 `cancelled|refunded|no-show|eliminated|finished`이거나 서로 다른 상태면
    배치 전체를 rollback하며 terminal attempt를 `seated`로 되살리지 않는다.
  - wallet 신규 행만 `started`로 바꾸고 수수료를 소각한다.
    프리롤은 참가자 debit 없이 회차 상금 에스크로가 계속 `reserved`인지 검증한다.
  - 같은 transaction에서 각 등록 행을 `seated`, `ever_seated=1`로 바꾼다.
  - 같은 transaction에서 배치 크기만큼 `pending_late_entrants`를 내리고
    `committed_entrants`를 올린다.
  - 확정 plan의 최종 table count가 2 이상이면 같은 transaction에서
    `ever_multi_table=1`로 올리며 이후 table break에서도 절대 0으로 되돌리지 않는다.
  - 한 행이라도 검증에 실패하면 배치 전체를 rollback한다.
  - 같은 배치 재호출은 각 원장 키와 등록 상태를 검증하고 성공으로 반환한다.
- `releaseLateMttEntry`
  - 두 모드 모두 key의 `requestId`, `registrationAttempt`가 attempt 이력과 현재 등록 행에
    모두 일치하고 양쪽 상태가 `late-pending`일 때만 cap 슬롯과 상태를 처음 바꾼다.
  - 프리롤 key는 참가자 경제 SQL 없이 현재 `late-pending` 등록을 `cancelled`로 바꾼다.
  - wallet key는 지정한 `economyEntryAttempt`의 착석 전 `reserved` 행만
    참가비+수수료를 전액 반환한다.
  - 같은 transaction에서 `tournament_registration.economy_entry_attempt`도 그 시도와 일치할 때만
    wallet 등록 행을 `refunded`로 바꾼다.
  - 같은 transaction에서 `pending_late_entrants`를 정확히 1 내린다.
  - coordinator가 짧은 mutation slice에서 release 뒤의 `effectiveRemaining`을 계산해
    동적 close가 필요한 경우 현재 generation과 새 opaque owner가 든 `closeCandidate`를 전달한다.
    repository는 release와 `open-late → closing/<reason>`, generation 증가, owner 기록을
    한 transaction에서 처리하고 attempt의 close generation/owner/reason도 함께 기록해
    exact claim을 반환한다.
  - close claim이 반환되면 caller는 old seating/balance hold를 해제하기 전에
    동기 `adoptClosingProjection()`과 `CloseHandoff`를 완료한다.
    close CAS가 다른 closing owner 때문에 지면 release를 건드리지 않고 `status='closing'`과
    저장된 owner를 반환하며, cancel 때문에 지면 저장된 terminal 결과를 반환한다.
    caller가 임의로 hold를 풀거나 다음 핸드를 예약하지 않는다.
  - 이미 해제된 같은 key의 재호출은 성공이고, 더 새롭거나 오래된 시도와 다른 참가자 행은
    절대 건드리지 않는다.
  - `seated|started`가 된 key는 단건 release를 거절하고 전체 cancel/void 경로만 허용한다.

각 메서드는 경제 repository의 자체 transaction을 중첩 호출하지 않는다.
등록부·지갑·에스크로·원장 SQL을 같은 `PokerDatabase.transaction()` 안에서 처리한다.

등록 마감·정산 전에는 모든 late reserved 행이 `started` 또는 `refunded`여야 한다.
혼재 상태가 남아 있으면 상금 고정을 중단하고 좌석 배정/환불 조정을 먼저 실행한다.

### 8.2 wallet 참가 시도 세대

현재 `sng_entries`의 `UNIQUE(tournament_id, profile_id)`는 환불된 노쇼가 같은 회차에
새 에스크로로 등록되는 것을 막는다. 마이그레이션 v28에서 다음처럼 세대를 추가한다.

```text
entry_attempt INTEGER NOT NULL DEFAULT 1 CHECK (entry_attempt >= 1)
UNIQUE(tournament_id, profile_id, entry_attempt)
```

- 기존 행은 `entry_attempt=1`로 이관한다.
- SQLite는 기존 UNIQUE 제약을 제자리에서 제거할 수 없으므로 v28은
  `sng_entries`를 backup→새 STRICT 테이블→행 복사→인덱스 재생성 방식으로 원자적 rebuild한다.
- 새 시도는 같은 회차·프로필의 `MAX(entry_attempt)+1`을 transaction 안에서 할당한다.
- `one_active_sng_entry_per_profile` 부분 유일 인덱스는 그대로 유지해
  `reserved|started` 시도가 동시에 두 개 생기지 않게 한다.
- `tournament_registration.economy_entry_attempt`이 현재 경제 행 세대를 가리킨다.
- 별도 `tournament_registration.registration_attempt`는 프리롤과 wallet 모두에서 증가하며,
  좌석 planner·commit·release callback은 이 값을 반드시 함께 검증한다.
- 모든 reserve/refund/fee/pool/prize 원장 idempotency key에 `entry_attempt` 또는 entry ID를 포함한다.
- `ever_seated=1`이면 새 시도 세대를 만드는 것 자체를 거절한다.
- 환불된 노쇼·시작 전 취소자·착석 전 서버 실패자만
  `ever_seated=0`과 열린 레이트 레지 창을 모두 만족할 때 새 세대를 만들 수 있다.

정산은 해당 회차에서 `started`가 된 최종 시도만 결과 명단과 대조한다.
이전 `refunded` 시도는 순위와 상금 풀에서 제외하지만 감사 이력은 보존한다.

### 8.3 실패 보상

- 상한·에스크로·등록 transaction 안의 어느 단계든 실패:
  transaction 전체 rollback, 별도 환불 원장을 만들지 않음
- transaction commit 뒤 pending 큐 반영 전 예외:
  reserve 결과의 정확한 `LateEntryKey`를 넘긴 `releaseLateMttEntry` 보상 transaction으로
  프리롤 cap을 해제하거나 wallet을 전액 환불
- 좌석/방 생성 실패:
  - 해당 배치를 재시도 가능한 상태로 한 번 유지
  - 동일 안전 경계에서 1회 재시도
  - 최종 실패 시 프리롤은 registration/cap만 release하고 회차 상금 에스크로를 유지,
    wallet은 등록 취소·해당 attempt 전액 환불
- silent 좌석 배정 성공 후 `commitLateMttBatch` 실패:
  - 다음 핸드를 시작하지 않고 `late-reg-balance` hold 유지
  - 동일 멱등 키로 한 번 재시도
  - 재시도가 transaction 미commit을 확정하면 착석을 journal로 되돌리고
    정확한 reserved key만 release해 필드에서 제외
  - 재시도가 이미 commit된 `started|seated`를 확인하면 개인 release나 메모리 rollback을 금지하고
    committed 후속 경로를 계속 수행
- 클라이언트 ack 유실: 같은 profile+requestId 재요청은 기존
  `late-pending|seated|terminal` 결과를 정확히 반환

시작 뒤 자발적 취소는 허용하지 않는다. 이미 수락된 참가비는 토너먼트 필드에 들어간다.

### 8.4 pending 세션 보존

현재 `SessionManager.releaseIfIdle()`은 live socket·보존 room·grace timer가 모두 없으면
세션을 회수한다. late pending은 아직 `roomId`가 없으므로 별도 engagement가 필요하다.

```ts
interface TournamentEngagement {
  tournamentId: string;
  kind: 'late-pending';
}
```

- 등록 transaction 성공 뒤 현재 세션에 engagement를 묶는다.
- `releaseIfIdle()`은 engagement가 있으면 세션을 회수하지 않는다.
- disconnect는 등록 취소가 아니며 공개 플레이어 스냅샷으로 away 착석을 계속한다.
- 착석 성공 시 engagement를 지우는 것과 새 `roomId` 설정을 같은 서버 명령에서 처리한다.
- 환불·토너먼트 취소·최종 좌석 실패에서도 engagement를 지운다.
- 메모리 engagement는 편의를 위한 projection이고 정본은
  `tournament_registration='late-pending|seated'`와 live TournamentManager 좌석이다.
- 재접속 `resync`와 인증된 로비 진입은 profile ID로 등록부를 다시 조회한다.
  - `late-pending`: engagement를 재구성하고 `좌석 배정 중`을 반환
  - `seated`: `TournamentManager.locateEntrant(tournamentId, profileId)`로 live room을 찾아 `roomId`와
    전체 game/chat snapshot을 복구
  - `refunded|cancelled|eliminated|finished`: stale engagement를 제거
- DB의 `seated`와 live 좌석이 불일치하면 임의 방을 추측하거나
  `started` wallet entry 한 건만 release하지 않는다.
  - coordinator가 아직 보유한 committed journal과 plan으로, 다음 핸드 시작 전 같은 좌석을
    멱등 재적용하고 전체 불변식을 다시 검증한다.
  - journal이 없거나 좌석 재적용이 불가능하면 registration을 닫고 generation을 올린 뒤
    프리롤은 전체 토너먼트를 `refund-pending`으로 취소해 예약 상금을 운영 원장에 반환하고,
    wallet은 `refund-pending`에서 `voidMttTournament()`로 started를 포함한 전 참가자를 전액 환불한다.
- 중복 탭의 최신 소켓 소유권과 기존 `session-replaced` 계약은 그대로 적용한다.

engagement에는 세션 토큰을 복제해 저장하지 않으며 `SessionManager` 내부 매핑에만 둔다.
따라서 DB commit 뒤 세션 projection이나 emit이 실패해도 다음 resync가 권위 상태에서 복구한다.

## 9. 좌석 배정 안전 경계

### 9.1 공통 원칙

- 진행 중인 핸드에는 절대 플레이어를 삽입하거나 제거하지 않는다.
- 모든 신규 착석과 기존 플레이어 이동은 핸드 완료 뒤에만 수행한다.
- `players` 배열의 `seatIndex` 오름차순 불변식을 유지한다.
- 방 이동은 기존 `transferMttSeat` 경로를 사용해 칩과 세션을 보존한다.
- 배정 전 pending 참가자는 엔진 순위·칩 계산에는 들어가지 않고,
  `effectiveRemaining`으로 우승·파이널 전이만 보류한다.
- 배정 성공 브로드캐스트가 끝난 뒤에만 다음 핸드를 예약한다.

### 9.2 배치 수집

동시에 여러 요청이 들어왔을 때 요청 도착 순서가 좌석 이점을 만들지 않도록
최대 750ms의 짧은 배치 창으로 묶는다.

- 배치 안의 신규 참가자 순서는 CSPRNG로 섞는다.
- 테이블 인원 동률 선택도 CSPRNG로 결정한다.
- `Math.random()`은 사용하지 않는다.
- 테스트에서는 셔플 함수를 의존성으로 주입해 결과를 재현한다.
- 운영 로그에는 최종 배정과 배치 ID를 기록하고, 향후 결과를 예측할 수 있는 RNG 내부 상태는 기록하지 않는다.

750ms는 서버 배치 창이지 클라이언트 애니메이션 지연이 아니다.
한 명만 들어와도 현재 핸드가 끝날 때까지 `좌석 배정 중`으로 보일 수 있다.

### 9.3 작업 세대와 단일 실행

등록 수락, 750ms 배치 timer, 한 명 fast-path의 핸드 완료 callback, 전역 balance,
normal close, cancel은 토너먼트별 `LateRegistrationCoordinator` 하나를 통과한다.

```ts
interface LateRegistrationOperationState {
  generation: number;
  mutationSliceActive: boolean;
  activeOperation: null | {
    kind: 'seating' | 'balance' | 'director-remove' | 'closing' | 'cancel';
    ownerToken: string;
  };
  abortRequested: null | {
    cancelOwnerToken: string;
    reason: string;
  };
}
```

- coordinator는 논리 작업을 토너먼트별 single-flight로 유지하되,
  짧은 상태 변경 slice만 `mutationSliceActive` mutex로 직렬화한다.
- 핸드 종료나 barrier를 기다리는 동안 mutation mutex를 잡은 채 `await`하지 않는다.
  logical owner만 보존하고 slice를 끝낸다.
- `MttRoomHooks.onHandComplete`는 `(generation, ownerToken)`을 동기 검증해
  해당 barrier의 완료 표식만 남긴 뒤 continuation을 큐에 넣는다.
  continuation은 다음 mutation slice를 다시 획득한 뒤 plan/apply/freeze를 진행한다.
- 한 명 fast-path도 대상 핸드 경계를 기다릴 때 같은 방식으로 slice를 놓으므로,
  핸드 완료 callback이 coordinator 자신을 기다리는 교착을 만들지 않는다.
- timer·핸드 완료·배치 callback은 생성될 때의 `generation`과 고유 `ownerToken`을 캡처한다.
- `open-late → closing` 또는 cancel CAS를 소유한 작업은 generation을 1 올리고
  아직 실행되지 않은 배치 timer를 취소한다.
- callback 시작 시 generation, DB `registration_state`, owner를 모두 다시 검사한다.
  하나라도 다르면 아무 좌석·세션·hold도 바꾸지 않는 stale no-op이다.
- hold는 reason 문자열만으로 해제하지 않고 `(reason, ownerToken)`으로 획득·해제한다.
  오래된 seating callback이 새 closing 작업의 hold를 풀 수 없다.
- generation이 같아도 이전 seating A와 다음 seating B의 owner는 다르다.
  모든 callback·`finally`·hold 해제는 현재 `(generation, ownerToken)`과 모두 일치할 때만 실행한다.
- 이미 seating 작업이 single-flight 안에서 commit 중이면 closing은 그 작업 종료를 기다린 뒤
  새 generation으로 남은 등록을 처리한다. cancel은 아래 abort handoff 규칙을 따른다.
- closing은 큐 메모리만 믿지 않고 DB의 모든 `late-pending`을 다시 읽어
  이미 수락됐지만 callback이 무효화된 참가자까지 착석 또는 해제한다.
- 등록 transaction이 close CAS보다 먼저 commit됐지만 큐 반영 전에 generation이 바뀐 경우도
  위 DB drain이 소유권을 이어받는다. close CAS가 먼저면 등록 transaction 자체가 거절된다.

디렉터 `remove-player`도 같은 coordinator의 `director-remove` logical operation이다.

- open-late에서 먼저 소유권을 얻은 remove는 target hand boundary까지 기다린 뒤
  forfeit saga와 provisional elimination을 한 mutation slice로 처리한다.
- forfeit 뒤 `effectiveRemaining`이 동적 마감 조건을 처음 만족하면 forfeit DB transaction이
  새 close generation/owner를 함께 claim한다. remove owner는 결과 publish나 자신의 hold 해제보다 먼저
  `adoptClosingProjection()`을 실행하고 accepted remove intent를 `CloseHandoff`로 넘긴다.
- close trigger가 그 대기 중 먼저 등록을 잠가야 하면 새 closing owner가 accepted remove intent,
  target snapshot, hand-boundary completion을 `CloseHandoff`에 포함해 인계받고
  freeze plan 전에 반드시 적용하거나 전체 취소한다.
- `closing`에 진입한 뒤 도착한 새 remove 명령은 `close-in-progress`로 거절한다.
- `closed`에서의 remove는 별도 `director-remove` owner로 기존 확정 탈락 경로를 타며,
  freeze된 참가 인원·상금표 자체는 바꾸지 않는다.
- cancel은 remove를 선점한다. DB commit 전 remove는 journal rollback,
  이미 forfeit commit된 remove는 그대로 감사 원장에 남긴 채 전체 cancel/void한다.
- logical 우선순위는
  `cancel > closing(release/기수락 remove 인계) > director-remove > balance > seating`이다.

normal close가 기존 seating/balance owner를 무효화할 때 hold를 고아로 남기지 않는다.

1. coordinator가 기존 `{generation, ownerToken, heldReasons, barrierState}`를
   `CloseHandoff`로 캡처한다. accepted `director-remove`가 있으면 target/plan도 함께 캡처한다.
2. 새 closing owner의 `late-reg-closing` hold를 모든 활성 테이블에 먼저 설치한다.
3. 짧은 mutation slice 안에서 현재 active owner가 캡처값과 같은지 확인한 뒤,
   정확한 old token의 `late-reg-seating|late-reg-balance` hold만 revoke한다.
4. 그 뒤 이미 DB가 claim한 generation/owner를 runtime active operation에 투영하고
   old callback을 stale 처리한다.

old owner가 DB commit/rollback critical section 안이면 그 slice가 끝날 때까지 handoff를 시작하지 않는다.
closing hold가 이미 전 테이블을 막으므로 old hold를 제거하는 순간 새 핸드가 열리지 않는다.
handoff가 중단되면 DB의 closing owner가 다음 coordinator tick에서 전 테이블 closing hold를 재확인한 뒤
현재 owner와 다른 obsolete late hold를 exact token으로 정리한다.
cancel은 모든 방을 dispose하므로 이 adoption 절차 없이 terminal fence 경로를 쓴다.

cancel은 일반 FIFO 작업이 아니라 최우선 abort handoff다.

- SQLite transaction처럼 중단할 수 없는 동기 critical section이 실행 중이면
  `abortRequested`를 먼저 기록하고 그 section이 끝나는 즉시 cancel owner가 소유권을 넘겨받는다.
- 그 밖의 timer·핸드 경계·closing barrier 대기 중에는 cancel이 generation을 올리고
  `activeOperation={kind:'cancel', ownerToken: cancelOwnerToken}`으로 즉시 선점한다.
- 이전 owner는 모든 `await` 뒤와 final field/payout commit 직전에 owner/abort를 다시 검사한다.
  소유권을 잃으면 순위·상금·ITM을 만들지 않고 stale no-op로 끝난다.
- closing이 다른 테이블 핸드를 기다리는 중 cancel되면 대기를 즉시 해제하고
  normal freeze가 아니라 전체 refund/cancel 경로로 간다.
- seating rollback 자체가 실패한 내부 경로는 coordinator의 cancel 작업을 재귀적으로 `await`하지 않는다.
  현재 작업을 `handoff-to-cancel` 결과로 종료하고 cancel owner가 후속 cleanup/void를 수행한다.
- 이전 작업의 `finally`는 exact owner CAS가 실패하면 active operation, generation,
  다른 owner의 hold를 절대 지우지 않는다.

coordinator는 DB의 `registration_generation/registration_owner_token`을 장기 closing/cancel CAS 정본으로 쓰고
runtime state를 그 projection으로 유지한다. timer·핸드 callback 객체 자체는 메모리 전용이며,
진행 중 MTT는 재시작 시 안전 취소하므로 새 프로세스가 이전 callback을 재사용하지 않는다.

## 10. 한 명 진입

새 테이블이 필요하지 않은 한 명 등록은 전체 테이블 배리어를 만들지 않는다.

1. 현재 생존 인원이 가장 적은 테이블을 찾는다.
2. 동률이면 CSPRNG로 선택한다.
3. 선택 테이블의 현재 핸드가 끝나면 `late-reg-seating` hold를 건다.
4. 그 시점의 모든 테이블 생존 인원과 목표 테이블 수를 다시 계산한다.
5. 해당 테이블에 바로 착석해도 인원 차가 1 이하이고 table break가 필요 없을 때만 진행한다.
6. 조건이 달라졌으면 이 fast path를 취소하고 전역 `late-reg-balance`로 승격한다.
7. 빈 좌석 중 하나를 CSPRNG로 고르고 착석시킨다.
8. hold를 풀고 다음 핸드를 시작한다.

핸드 경계에서 좌석을 정하므로 진행 중 핸드의 버튼과 블라인드 위치를 변경하지 않는다.

## 11. 여러 명 진입과 새 테이블

배치가 새 테이블 생성이나 여러 기존 플레이어 이동을 요구하면
모든 활성 테이블에 `late-reg-balance` hold를 걸고 각 테이블의 현재 핸드 완료를 기다린다.
기본 15초 액션 시간과 기존 올인 런아웃이 끝난 뒤 한 번에 재배치한다.

### 11.1 목표 크기

```text
total = currentAliveSeated + acceptedLateEntrants
targetTableCount = ceil(total / tableMaxPlayers)
각 테이블 목표 인원 차이 <= 1
```

비어 있는 테이블을 미리 만들지 않는다. `targetTableCount`가 현재보다 클 때만 새 방을 만든다.

변경 전에 순수 `planLateRegistrationSeating()`이 전체 계획을 만든다.

```ts
interface LateRegistrationSeatingPlan {
  batchId: string;
  createTables: PlannedTable[];
  breakTables: PlannedTableBreak[];
  incumbentMoves: PlannedMove[];
  lateSeats: PlannedSeat[];
  finalTableSizes: ReadonlyMap<string, number>;
}
```

플래너는 중복 플레이어·중복 좌석·수용량·목표 크기·새 테이블 혼합 조건을 모두 검증한 뒤에만
실행 계획을 반환한다. 새 방 생성과 모든 목적 좌석 확보를 먼저 끝내고, 그다음 기존 참가자 이동,
신규 착석 순서로 적용한다. 잠금을 잡은 상태에서는 계획 입력이 바뀌지 않으므로 적용 단계는
실패하지 않는 내부 연산이어야 한다.

첫 상태 변경 전 실패하면 새 방을 정리하고 배치를 재시도하거나 환불한다.
상태 변경 뒤 예상하지 못한 내부 오류가 발생하면 적용 journal을 역순 실행해
신규 좌석 제거·기존 참가자 원위치·새 방 정리를 완료한 뒤 한 번만 재시도한다.
롤백까지 실패하면 부분 상태로 경기를 재개하지 않고 토너먼트를 안전 취소해 wallet 전액 환불한다.
영구 hold 상태로 운영자 수동 복구만 기다리는 경로는 만들지 않는다.

현재 `transferMttSeat`는 한 명 이동마다 즉시 `table-move`와 방 update를 보내므로
다좌석 계획 적용에 직접 반복 호출하지 않는다. RoomManager에 내부 배치 API를 추가한다.

```ts
transferMttSeatsBatch(plan, { broadcast: false }): AppliedTransferJournal;
```

- 모든 source player와 target seat를 다시 검증한 뒤 silent하게 적용한다.
- 적용 중 `players` 배열을 매번 seatIndex 순으로 유지한다.
- 최종 불변식 검증 뒤 영향받은 방마다 game update를 한 번만 보낸다.
- 이동한 기존 휴먼마다 최종 목적지의 `table-move`를 한 번만 보낸다.
- late entrant는 아래 전용 `tournament-seat-assigned` 이벤트를 받는다.

배치 적용 순서는 고정한다.

```text
전체 plan/room/session/seat 재검증
→ silent in-memory 이동·신규 좌석 생성 + rollback journal
→ 칩·좌석·테이블 크기 불변식 검증
→ commitLateMttBatch DB transaction
→ session roomId/engagement 갱신
→ 방별 game update 1회
→ 기존 이동자 table-move / 신규 참가자 tournament-seat-assigned
→ hold 해제
```

DB commit 전 오류는 journal로 메모리를 원복한다.
DB commit 뒤 단계는 원장·게임 상태를 바꾸지 않는 멱등 세션 projection과 best-effort emit만 두며,
emit 유실은 재접속 `resync`가 복구한다.
coordinator는 `AppliedTransferJournal`과 확정 plan을 세션 projection, 최종 DB↔live 불변식 검사,
방별 publish, hold 해제까지 보유한다. 그 뒤 다음 핸드가 실제 시작될 때 폐기한다.
DB commit 뒤 좌석 불일치가 발견되면 이 committed journal로 같은 좌석을 멱등 재적용하고,
불가능하면 개인 entry를 되돌리지 않고 8.4절의 전체 토너먼트 안전 취소를 수행한다.

현재 테이블 수가 `targetTableCount`보다 많으면 기존 table-break의 수용량 사전 검사를
같은 plan 안에서 먼저 수행한다. 일부 플레이어만 옮긴 채 테이블을 남기지 않는다.

### 11.2 분산 불변식

플래너의 최적화 우선순위는 다음과 같다.

1. 모든 좌석 수용량과 최종 테이블 인원 차이 1 이하
2. 새 테이블마다 기존 참가자 2명 이상 배치; 불가능하면 최소 1명
3. 한 테이블에 들어가는 같은 late batch 인원의 최댓값 최소화
4. 위 조건 안에서 기존 참가자 이동 수 최소화
5. 이동 후보는 다음 BB, 좌석은 기존 worst-position 규칙
6. 완전 동률은 CSPRNG

신규 참가자는 단순 라운드로빈이 아니라 각 목표 테이블의 남은 `target deficit`에 배정한다.
따라서 목표 크기를 초과하지 않으면서 같은 배치 집중도를 최소화한다.
필드 규모상 분리가 수학적으로 불가능한 경우에만 같은 배치 인원이 더 많이 함께 앉는다.
신규 참가자의 좌석은 합법적인 빈 좌석 풀에서 CSPRNG로 고른다.

### 11.3 예시

기존 10명이 두 테이블에 5명씩 있고 신규 6명이 동시에 들어오면 총 16명, 목표는 3테이블이다.

- 두 기존 테이블에서 기존 참가자 총 3명을 새 테이블로 이동
- 기존 참가자 분포를 4·3·3으로 만듦
- 신규 6명을 각 테이블에 2명씩 분산
- 최종 크기는 6·5·5

신규 6명이 새 테이블 한 곳에서 서로 폴드만 하며 시간을 끄는 구조를 만들지 않는다.

한 명 진입에서도 균형을 맞추기 위해 다른 진행 중 source 테이블의 플레이어 이동이 필요하면
단일 테이블 fast path를 중단하고 전역 `late-reg-balance` 계획으로 승격한다.

### 11.4 새 테이블 초기화

새 방은 일반 cash/SnG 기본값으로 만든 뒤 나중에 보정하지 않는다.
`TournamentManager.createLateRegistrationTable()`이 현재 런타임 스냅샷으로 한 번에 초기화한다.

- 동일 tournament ID와 table size
- 현재 global level의 SB/BB/BB ante
- 현재 level generation과 다음 핸드 적용 대기 값
- pause 누적, 브레이크 deadline, 레이트 레지 deadline
- `director-pause`, `scheduled-break`, `late-reg-closing|balance` 등 모든 현재 hold
- `initialEntrants`, `committedEntrants`, `pendingLateEntrants`, `aliveSeated`,
  `finalEntrants`, `everMultiTable`, `forfeitedChips` 전체 필드·칩 원장
- 잠정·확정 상금, stage, milestone, final theme
- MTT room hooks, 세션·채팅·핸드 히스토리 연결

초기화와 참가자 이동을 시작하기 전에 모든 필드를 검증한다.
진행 중 토너먼트에 만든 새 테이블이 level 1이나 열린 핸드 상태로 한 프레임이라도 브로드캐스트되지 않는다.
계획 rollback은 새 방을 `RoomManager.disposeRoom('late-reg-rollback')`으로 정리하고
TournamentManager의 room→tournament 매핑과 tables map에서도 제거해야 완료로 간주한다.

## 12. 기존 밸런싱과의 관계

공용 `TournamentHoldReason` union에 다음 세 값을 추가한다.

```ts
type LateRegistrationHoldReason =
  | 'late-reg-seating'
  | 'late-reg-balance'
  | 'late-reg-closing';

type MttStateReconcileHoldReason = 'mtt-state-reconcile';
```

- `tournament-cancel`은 공개 hold union에 넣지 않는 내부 terminal fence이며
  기존 `setup|complete`처럼 `publicHoldReasons()`에서 필터링한다.
- `mtt-state-reconcile`은 참가자에게 `토너먼트 상태 복구 중`으로 보이는 owner-scoped 안전 hold이며,
  room lifecycle timer와 manager tick이 exact owner로만 해제·재개한다.
- `late-reg-balance`와 `late-reg-closing`은 기존 `h4h-barrier`, `scheduled-break`, `director-pause`,
  `final-forming`, `final-intro`와 합성 가능한 별도 hold reason이다.
- 하나를 해제해도 다른 hold가 남아 있으면 다음 핸드를 시작하지 않는다.
- 우선순위는 다음과 같다.

```text
취소/완료
→ mtt-state-reconcile
→ director-pause
→ scheduled-break
→ late-reg-closing
→ late-reg-balance
→ late-reg-seating
→ final-forming/final-intro
→ h4h-barrier
```

- 브레이크 중 배치가 들어오면 이미 모든 테이블이 안전 경계이므로 즉시 착석하되,
  브레이크 hold는 유지한다.
- 디렉터 일시정지 중에도 마감 전 등록은 가능하다. 좌석은 안전 경계에서 배정하고
  정지 hold를 유지한다.
- 레이트 레지가 닫히기 전에는 H4H를 무장하지 않는다.
- 레이트 레지 마감과 필드 고정 직후 버블이면 H4H를 무장한다.
- 파이널 테이블이 형성되기 전에 레이트 레지를 먼저 닫는다.

## 13. 봇 정책

- 봇은 시작 순간 프리롤 최소 인원을 맞출 때만 추가한다.
- claim된 휴먼이 1명 이상이고 `minEntrants`보다 적을 때만 정확한 부족분을 추가한다.
- claim된 휴먼이 0명이면 봇을 추가하지 않고 회차를 취소해 예약 상금을 반환한다.
- 레이트 레지 휴먼이 들어와도 이미 플레이 중인 봇을 퇴장시키지 않는다.
  토너먼트 프리즈아웃 필드에 들어온 봇도 독립 참가자로 취급한다.
- 봇도 전체 필드와 등록 상한에 포함한다.
- wallet은 사람 전용이며 봇 설정을 서버가 거절한다.
- 시작 후 봇을 새로 충원하지 않는다.

봇을 늦은 휴먼과 교체하면 이미 납부한 블라인드, 상금 필드, 탈락 순위가 바뀌므로 금지한다.

## 14. 상금과 순위 고정

### 14.1 마감 전 상금

- wallet 총상금은 수락된 유료 참가자의 바이인 합계에 따라 증가한다.
- 프리롤 총상금은 공용 운영 원장에서 예약한 금액으로 고정되지만
  입상 인원과 순위별 배분은 필드에 따라 변할 수 있다.
- 프리롤 봇도 상금 순위를 점유한다. 휴먼 몫은 wallet에 지급하고 봇 몫은 운영 원장으로 반환한다.
- wallet은 `현재 등록 기준 예상 · 레이트 레지 마감 전 변동 가능`으로 표시한다.
- 프리롤은 `총상금 예약 완료 · 총액 고정 · 입상 인원/배분은 마감 전 변동 가능`으로 표시한다.
- ITM 축하 이벤트는 마감 전에 발생하지 않는다.

### 14.2 마감 전 탈락 순위

레이트 레지 중 탈락자가 나온 뒤 신규 참가자가 들어오면 최종 필드가 커지므로,
탈락 즉시 확정 순위 숫자를 부여하면 잘못된다.

예를 들어 8명으로 시작해 첫 탈락자가 나온 뒤 3명이 등록하면 첫 탈락자의 최종 순위는
8위가 아니라 11위가 되어야 한다.

따라서 마감 전에는 다음만 기록한다.

```ts
interface ProvisionalElimination {
  roomId: string;
  playerId: string;
  eliminatedAt: number;
  eliminationBatchSeq: number;
  eliminationSeq: number;
  handNumber: number;
  handStartChips: number;
  seatIndex: number;
  buttonSeatIndex: number;
  sameHandBatchId: string;
}
```

- `eliminationBatchSeq`와 `eliminationSeq`는 `TournamentRuntime`의 단조 증가 정수다.
  순위 정본은 이 sequence이며 `eliminatedAt`은 운영 표시·감사용이다.
  벽시계가 보정되어 millisecond 값이 역행해도 순위가 뒤집히지 않는다.
- UI에는 `레이트 레지 마감 후 순위 확정`을 표시한다.
- 같은 핸드에서 여러 명이 탈락하면 기존 계약대로 핸드 시작 칩이 많았던 사람이 상위다.
- 같은 핸드·같은 시작 칩이면 현재 `eliminationGroups()`와 동일하게 버튼 왼쪽 거리,
  안정적인 player ID 순으로 정렬한다.
- 서로 다른 테이블의 비-H4H 탈락은 서버가 부여한 `eliminationBatchSeq` 순으로 정렬하고
  millisecond 시각은 감사 표시로만 사용한다.
- 완전 동률이면 안정적인 `eliminationSeq`로만 결정하고 임의 클라이언트 시각을 사용하지 않는다.
- 탈락자는 로비로 돌아가도 상세 화면에서 마감 후 확정 순위를 볼 수 있다.

현행 `applyTournamentEliminations()`와 `onEliminated`는 `place`와 `prize`를 필수로 받으므로
open-late에서 가짜 순위 0을 주지 않는다.

```ts
engine.markMttEliminatedPendingRank(playerId): void;

onProvisionalEliminated({
  tournamentId,
  roomId,
  playerId,
  eliminationBatchSeq,
  message: '레이트 레지 마감 후 순위가 확정됩니다',
}): void;
```

- 엔진은 해당 플레이어를 다음 핸드 딜인에서 제외하고 안전 제거 가능 상태로 만들되
  `finishPlace`와 `prize`는 설정하지 않는다.
- 매니저는 `provisionalEliminations`에 전체 동률 스냅샷을 보존한다.
- 디렉터 강제 제거도 open-late에서는 같은 provisional 경로를 탄다.
- 마감 시 매니저가 최종 `results`를 생성하고 전체 테이블의 TournamentState와 상세 목록에 주입한다.
- 이미 로비로 돌아간 탈락자를 다시 엔진 좌석에 만들지는 않는다.
- 마감 뒤 새 탈락부터는 기존 확정 `applyTournamentEliminations()` 경로를 사용한다.

### 14.3 원자적 고정

closing owner는 모든 테이블 hold와 pending 정리가 끝난 뒤 순수 함수로 한 번의
`TournamentPayoutFreezePlan`을 만든다. 이 계획은 **등록 마감 시점의 상금 구조와 이미 탈락한
참가자의 확정 순위만** 고정한다. 아직 생존한 참가자의 최종 순위·지급 귀속은 이 시점에 알 수
없으므로 포함하지 않는다.

```ts
interface TournamentPayoutFreezePlan {
  generation: number;
  ownerToken: string;
  finalEntrants: number;
  payoutTableVersion: number;
  prizePool: number;
  payouts: ReadonlyArray<{ place: number; percent: number; amount: number }>;
  resolvedEliminations: ReadonlyArray<{
    playerId: string;
    participantType: 'human' | 'bot';
    profileId: string | null;
    place: number;
  }>;
  milestonesToEmit: ReadonlyArray<'h4h' | 'itm' | 'final-table' | 'winner'>;
  checksum: string;
}
```

고정 순서는 다음과 같다.

1. 모든 수락 배치가 `seated` 또는 terminal release이고,
   `pending_late_entrants=0`, wallet late 경제 행이 `started|refunded`,
   전 테이블이 closing hold라는 것을 재검증한다.
2. `finalEntrants=committedEntrants`, versioned payout, 잠정 탈락자의 최종 순위와
   이후 milestone 결정을 담은 immutable plan과 checksum을 계산한다.
3. 현재 runtime/table tournament state의 rollback snapshot을 잡는다.
4. plan을 모든 runtime/table에 **무방송** 적용하고 checksum·칩·순위 불변식을 검증한다.
5. owner/abort를 다시 확인한 뒤 한 `BEGIN IMMEDIATE` transaction에서
   `running/closing → running/closed`, close reason, `final_entrants`,
   `payout_freeze_version/json`을 CAS한다. 기대 generation/owner가 아니거나
   기존 freeze가 다른 checksum이면 전체 rollback한다.
6. DB CAS가 실패하면 runtime snapshot을 원복하고 같은 owner로 한 번 재시도한다.
   원복까지 실패하면 cancel handoff로 전체 토너먼트를 안전 취소한다.
7. DB commit 뒤 plan은 정본이다. late timer를 해제하고 tournament/game update를 한 번 publish한 뒤,
   아직 같은 owner이고 cancel 요청이 없을 때만 milestone을 멱등 ID로 발행하고 closing hold를 푼다.
8. emit·session projection 유실은 상태를 되돌리지 않고 `resync`가 DB freeze와 live runtime에서 복구한다.

DB commit 뒤에는 개인 entry rollback이나 상금표 재계산을 금지한다.
cancel이 freeze commit 뒤 publish 전에 선점하면 milestone은 발행하지 않고 전체 cancel/void로 가며,
이미 저장된 freeze JSON은 감사용 aborted snapshot으로만 남고 취소 UI·정산에는 사용하지 않는다.
wallet과 프리롤 정상 최종 정산은 이 exact version/checksum과 일치하는 고정 스냅샷만 수용한다.

마지막 생존자가 확정되면 별도의 immutable `TournamentSettlementPlan`을 만든다.
이 계획은 전체 `1..finalEntrants` 순위를 휴먼 profile 또는 봇 player에 정확히 한 번씩 귀속하고,
각 순위의 고정 상금, `humanPayoutTotal`, `botReturnTotal`과 fingerprint를 포함한다.
계획 전체를 `tournament_settlement`과 `tournament_settlement_result`에 영속하고
`running → payout-pending`을 같은 transaction에서 CAS한다. 지급 transaction은 runtime 결과를
다시 계산하지 않고 이 영속 계획만 읽는다. wallet은 휴먼 결과 지급을, 프리롤은 휴먼 지갑 지급과
봇 상금의 공용 운영 원장 반환을 완료한 뒤에만 `completed`로 전이한다.
정확한 테이블 구조와 멱등·복구 계약은
`2026-07-25-mtt-freeroll-promotion-fund-design.md` 6.4절을 따른다.
고정 후 신규 등록이나 상금표 변경은 거절한다.

## 15. 공개 UX

### 15.1 로비 카드와 상세

- `레이트 레지 진행 중` 배지
- 마감까지 카운트다운
- 현재 참가자 / 최대 참가자
- 시작 스택과 현재 BB 환산
- 현재 레벨
- wallet의 현재 등록 기준 예상 총상금과 입상 인원
- 프리롤의 예약 완료된 고정 총상금과 현재 예상 입상 인원
- 모드별 `총액/입상 인원/배분` 중 무엇이 마감 전 변하는지 구분한 안내
- 조건을 만족할 때 `지금 참가` 버튼

20BB 안전선에 가까워지면 다음처럼 명시한다.

```text
시작 스택 10,000 · 현재 25BB
다음 레벨에서 20BB 미만이 되면 등록이 조기 마감됩니다.
```

### 15.2 등록 직후

ack를 받으면 로비 버튼을 반복 누를 수 없게 하고 다음 상태를 보여준다.

```text
등록 완료
공정한 좌석 배정을 위해 현재 핸드 종료를 기다리는 중입니다.
```

기존 `table-move`는 `currentRoomId === fromRoomId`인 플레이어 이동 전용이므로
로비의 late entrant에게 재사용하지 않는다. 개인 이벤트를 새로 둔다.

```ts
interface TournamentSeatAssigned {
  tournamentId: string;
  roomId: string;
  state: PublicGameState;
  chat: ChatMessage[];
}
```

서버는 session projection 직전에 다음을 모두 재검증한다.

- 최신 소켓이 해당 세션 소유권을 가짐
- 기존 `session.roomId === null`
- pending engagement와 DB 등록이 같은 `tournamentId`를 가리킴

검증 뒤 서버는 engagement를 지우고 `session.roomId=roomId`로 projection한 다음
그 최신 소켓에만 이벤트를 보낸다. 클라이언트는 다음을 모두 만족할 때만 적용한다.

- 현재 `currentRoomId === null`
- 로컬 pending tournament ID가 이벤트 `tournamentId`와 일치

적용 시 게임 상태와 채팅을 통째로 교체하고 `currentRoomId=roomId`로 설정한다.
이전 로비 또는 다른 방 상태와 `diffGameState()`를 실행하지 않는다.
기존 참가자의 밸런싱 이동에는 계속 `table-move`를 사용한다.
이벤트를 잃었거나 session projection 뒤 소켓이 교체되면 `resync`가 DB 등록과 live 좌석에서
같은 전체 snapshot을 반환한다.

### 15.3 게임 중

TopBar 토너먼트 상세에는 레이트 레지 상태와 마감 시각을 보여준다.
기존 참가자는 신규 인원이 들어올 때마다 방해되는 전면 팝업을 보지 않는다.
테이블 밸런싱으로 본인이 이동할 때만 기존 `테이블 이동` 안내를 받는다.

## 16. API와 프로토콜

기존 등록 명령을 시작 전과 시작 후에 공용으로 사용한다.

```ts
interface RegisterTournamentCommand {
  tournamentId: string;
  requestId: string;
}

type RegisterTournamentResult =
  | {
      ok: true;
      status: 'registered' | 'seating' | 'seated';
      tournamentId: string;
      requestId: string;
    }
  | {
      ok: false;
      requestId: string;
      reason: 'request-terminal';
      terminalStatus: 'cancelled' | 'refunded' | 'no-show' | 'eliminated' | 'finished';
    }
  | {
      ok: false;
      requestId: string;
      reason:
        | 'not-open'
        | 'late-registration-closed'
        | 'full'
        | 'already-entered'
        | 'eliminated'
        | 'insufficient-balance'
        | 'other-tournament'
        | 'seating-failed';
    };
```

추가 또는 확장 이벤트:

- `tournament-update`: 등록 상태·마감 시각·잠정/확정 상금
- `late-registration-seating`: 개인 좌석 배정 대기 상태
- `tournament-seat-assigned`: 로비 pending 참가자의 최초 방 배정
- `table-move`: 이미 테이블에 있는 기존 참가자의 재배치

모든 개인 이벤트는 `tournamentId`, `roomId`가 있으면 `roomId`, 대상 세션 소유권을 검증한다.
세션 토큰은 payload에 넣지 않는다.

## 17. 운영 감사

다음 `ops_event`를 추가한다.

- `mtt-late-reg-open`
- `mtt-late-reg-accept`
- `mtt-late-reg-batch`
- `mtt-late-reg-seat`
- `mtt-late-reg-close`
- `mtt-payout-freeze`
- `mtt-late-reg-refund`
- `mtt-freeroll-prize-settle`
- `mtt-freeroll-prize-refund`
- `mtt-payout-pending`

배치 이벤트에는 다음을 기록한다.

- batch ID
- 요청 수와 성공·실패 수
- 배정 전후 테이블 크기
- 생성 테이블
- 이동한 기존 참가자와 이동 사유
- 신규 참가자의 최종 테이블·좌석
- 마감 사유
- 설정 버전

RNG 내부 상태, 인증 토큰, 세션 토큰, 원문 IP는 기록하지 않는다.

## 18. 실패와 경계 상황

- 마감 시각 직전 요청: 서버가 상한 슬롯과 에스크로를 확보한 시점이 마감 전이면 수락
- ack 전에 마감: 이미 수락된 요청은 착석, 새 재요청은 멱등 결과 반환
- 등록 후 연결 끊김: away 착석, 환불 없음
- 새 테이블 생성 실패: 배치 한 번 재시도 후 wallet 신규 참가자는 해당 attempt를 환불하고,
  프리롤 신규 참가자는 개인 자금 이동 없이 registration/cap만 release한다.
  프리롤 회차의 예약 상금 에스크로는 그대로 유지한다.
- 기존 테이블이 올인 런아웃 중: 쇼다운·정산 완료까지 기다림
- 브레이크 도달과 배치 경합: 브레이크 hold를 유지한 채 착석
- H4H 조건과 마감 경합: 먼저 등록을 닫고 상금을 고정한 뒤 H4H 판정
- 파이널 테이블 조건과 마감 경합: 먼저 등록을 닫고 모든 배치를 처리한 뒤 파이널 형성
- 실행 중 서버 재시작: wallet은 멱등 전액 환불, 프리롤은 예약 상금 전액 반환
- 결과가 고정된 `payout-pending` 재시작: 취소하지 않고 exact settlement plan으로 정산 재개
- 레이트 레지 중 마지막 생존자 1명: 등록을 즉시 닫고 필드를 고정한 뒤 우승 처리

## 19. 필수 테스트

테스트를 위한 테스트용 화면이나 가짜 제품 기능은 만들지 않는다.

1. 인스턴스 상태×등록 상태×등록 행 상태의 허용 조합과 CAS
2. 1·2·3레벨 절대시각 timer와 pause/break가 마감을 연장하지 않음
3. 상한, global 20BB, forward set-level, 2인 시작 bubble 즉시 마감,
   시작 2테이블·late 생성 2테이블 양쪽의 ever-multitable 영속과 파이널 조기 마감,
   모든 허용 필드에서 비-cap reserve는 paidPlaces 경계를 지나도 bubble을 새로 만들지 않는 단조성
4. 20BB 이상 수락 후 레벨이 올라가도 정확한 전체 시작 스택을 받음
5. 같은 프로필 재등록·탈락자 재등록 거절과 환불 노쇼 attempt 2 허용
6. v28 rebuild가 기존 sng entry·원장 연결을 보존
7. 한 명 대상 테이블이 기다리는 동안 바뀌면 재계산 후 global balance로 승격
8. 모든 필드/테이블/배치 크기의 planner property test: 수용량, 차이≤1, cohort 최소화
9. 5~6명 배치가 새 테이블에만 몰리지 않고 기존 참가자와 섞임
10. 새 테이블이 현재 level/ante/deadline/field/payout/hold를 첫 broadcast 전에 승계
11. silent 이동 뒤 batch DB commit 실패 시 journal 원복, emit 없음, 새 방 dispose
12. 모든 배치 후 seatIndex·버튼 궤도·전체 칩 보존
13. CSPRNG 경로에서 `Math.random()` 미사용
14. 프리롤·wallet reserve/commit/release, stale registration/economy attempt가 새 attempt를
   commit·취소·환불하지 않음, terminal 뒤 같은 requestId는 재청구하지 않고 새 requestId만 재등록,
   terminal union은 재큐잉되지 않음, 마지막 cap commit 뒤 command 예외가 나도
   이미 예약된 next-hand timer는 DB fail-closed gate에 막히고 exact close owner로 복구,
   일시 DB read/projection fault는 reconcile retry와 manager tick 뒤 정확히 한 핸드만 재개하며
   persistent fault·dispose·terminal 경로는 timer/hold를 누수하지 않음,
   commit 재시도, ack 유실 멱등성
15. pending disconnect 세션 보존, DB commit 뒤 session projection 실패의 resync 복구,
   away 착석, refund engagement 해제
16. committed 뒤 live 좌석 불일치가 journal로 복구되지 않으면 단건 release 없이 전체 안전 취소
17. 로비 전용 `tournament-seat-assigned` guard와 기존 `table-move` 격리
18. 마감 전 탈락 순위 잠정 처리, 단조 batch seq, 동률 규칙, 마감 후 최종 필드 재계산
19. closing barrier에서 전 테이블 현재 핸드만 끝나고 필드 고정 전 다음 핸드가 시작되지 않음
20. 정상 close 뒤 H4H·ITM·파이널·우승이 한 번만 발생
21. cancel/rollback은 payout·ITM을 만들지 않고 reserved+started를 전액 환불하며,
    pre-freeze null 유지/post-freeze snapshot abort 표시, 환불 실패 중에도
    cancel fence·session 정리·room dispose가 완료되고 CAS 실패 시 기존 timer가 계속 동작
22. stale batch/hand callback이 generation 변경 뒤 좌석을 만들거나 새 owner의 hold를 풀지 않음
23. rollback 실패의 cancel handoff가 self-deadlock 없이 끝나고,
    onHandComplete가 mutation mutex와 교착되지 않으며 closing 대기 중 cancel이 freeze/ITM 전에 선점
24. 모든 late hold와 기존 break/pause/final hold 합성
25. open-late/closed 디렉터 remove가 잔여 스택만 forfeited 원장에 넣고
    DB 실패 시 좌석 복원/commit 뒤 projection 실패 시 멱등 재적용하며
    closing race에서는 handoff 후 freeze 전에 반영하고
    `live+forfeited=committed×startingStack`을 유지
26. pending release와 director remove가 effectiveRemaining을 bubble/final-table/last-player
    경계 아래로 내릴 때 같은 transaction에서 closing을 claim하고,
    old hold 해제나 새 핸드 시작 전에 close handoff를 완료
27. 프리롤 휴먼 0명 취소, 최소 인원까지만 봇 충원, 고정 상금 유지,
    휴먼 지갑 지급+봇 상금 운영 원장 반환의 총합 보존과 payout-pending 재시작
28. 관련 Vitest, `npx tsc --noEmit`, `npm run lint`, `npm run build`

봇 48명 전체 완주 시뮬레이션은 제품 시작 경로가 아닌 테스트 하네스 부하 검증으로만 유지하고,
레이트 레지 핵심 경계만 추가 시나리오로 확장한다.

## 20. 완료 기준

- 운영자가 토너먼트별로 레이트 레지를 켜고 1·2·3레벨 중 창을 선택할 수 있다.
- 참가자는 마감 시각, 현재 스택 깊이, 변동 가능한 상금을 등록 전에 이해한다.
- 한 명은 균형이 가장 필요한 테이블로, 여러 명은 기존 필드와 섞여 배정된다.
- 진행 중 핸드의 플레이어 배열·팟·버튼 궤도를 건드리지 않는다.
- 등록 실패가 wallet 손실이나 유령 좌석을 남기지 않는다.
- 마감 전 탈락자의 최종 순위가 뒤늦은 참가자 때문에 잘못 확정되지 않는다.
- 마감 순간 필드·상금·순위가 한 번 고정되고 이후 H4H·ITM·정산이 그 정본만 사용한다.
