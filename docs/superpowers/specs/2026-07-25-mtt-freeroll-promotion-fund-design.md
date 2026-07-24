# MTT 프리롤·공용 운영 원장 설계

**작성일:** 2026-07-25
**상태:** 승인됨
**선행 설계:**

- `2026-07-24-mtt-scheduling-admin-design.md`
- `2026-07-24-mtt-late-registration-design.md`

이 문서는 선행 설계의 MTT `practice` 경제 모드를 `freeroll`로 교체하고,
프리롤의 실제 지갑 상금과 공용 운영 자금 원장을 정의한다.
유료 `wallet` MTT는 사람 전용으로 유지하며 예정 시작 시각의 최소 인원 미달 시 취소한다.
이 문서와 선행 설계가 충돌하면 이 문서가 우선한다.

## 1. 목표

1. 기존 표시용 연습 MTT를 실제 지갑 상금을 지급하는 `프리롤 토너먼트`로 교체한다.
2. 프리롤 상금은 프로필 운영자의 개인 지갑이 아니라 플랫폼 공용 운영 원장에서 출자한다.
3. 프리롤 봇은 정상 순위와 상금을 차지할 수 있고, 봇 몫은 공용 운영 원장으로 반환한다.
4. 유료 MTT에는 봇을 절대 착석시키지 않는다.
5. 예정 시작 시각에 실제 시작 가능한 인원이 부족하면 자금을 안전하게 반환한 뒤 취소한다.
6. 예약·반복·재시작·레이트 레지에서도 같은 경제 불변식을 유지한다.

## 2. 범위

### 포함

- MTT 공개 명칭과 신규 설정의 `practice` → `freeroll` 교체
- 공용 `promotion` 운영 잔액과 append-only 원장
- 프리롤 회차별 고정 총상금 예약
- 휴먼 상금의 실제 wallet 지급
- 봇 입상 상금의 운영 원장 반환
- 프리롤과 유료 MTT의 시작 인원 정책
- 취소·완주·장애·재시작의 멱등 정산
- `/admin` 운영 자금 조회·수동 조정·감사
- 기존 예약/반복 및 레이트 레지 설계와의 통합

### 제외

- cash·SnG의 `practice` 명칭이나 경제 계약 변경
- 프로필 운영자 개인 지갑을 이용한 프리롤 출자
- 자동 예산 충전, rake·수수료의 자동 운영 자금 전환
- 봇 상금의 차순위 휴먼 롤다운
- 프리롤 티켓, 위성 토너먼트, 스폰서별 별도 원장
- 진행 중 MTT의 핸드·덱·타이머 재시작 복구

## 3. 용어와 모드

MTT의 신규 공개·저장 모드는 다음 둘뿐이다.

```ts
type MttEconomyMode = 'freeroll' | 'wallet';
```

- `freeroll`
  - 휴먼 바이인과 수수료가 없다.
  - 공용 `promotion` 원장이 고정 총상금을 출자한다.
  - 운영자가 봇 충원 사용 여부를 선택할 수 있다.
- `wallet`
  - 휴먼이 바이인과 수수료를 에스크로에 예약한다.
  - 총상금은 실제 유료 참가자의 바이인 합계다.
  - 봇 충원은 입력·명령·도메인 경계에서 거절한다.

구버전 `economyMode:'practice'` 생성 요청은 한 배포 동안만 `freeroll`로 정규화한다.
신규 응답과 설정 스냅샷은 `practice`를 내보내거나 저장하지 않는다.
시작된 MTT 테이블이 엔진 내부 경제 정산을 피하기 위해 `RoomConfig.economyMode:'practice'`를
사용하는 구현 세부사항은 유지할 수 있지만, 이를 MTT 공개 모드로 노출하지 않는다.

## 4. 설정 스냅샷

선행 설계의 `TournamentConfigSnapshotV2` 경제·상금 부분을 다음으로 교체한다.
이 예약·반복 v2는 아직 배포되지 않았으므로 아래 정의가 첫 영속 v2 계약이다.

```ts
interface TournamentFieldPolicy {
  minEntrants: number;
  maxEntrants: number;
  botFillToMinimum: boolean;
}

type TournamentEconomyPolicy =
  | {
      mode: 'freeroll';
      promotionAccountId: 'global';
    }
  | {
      mode: 'wallet';
      productVersion: number;
      buyIn: number;
      fee: number;
    };

type PrizePoolPolicy =
  | {
      kind: 'promotion-funded';
      totalPrize: number;
    }
  | {
      kind: 'entry-pool';
    };
```

유효 조합은 정확히 둘이다.

```text
freeroll + promotion-funded
wallet   + entry-pool
```

다른 조합은 생성·복구 시 모두 거절한다.

- `minEntrants`: 2~48명, 기본 8명
- `maxEntrants`: `minEntrants` 이상 48명 이하
- 프리롤 총상금: 1~2,000,000,000의 안전한 정수
- wallet은 `botFillToMinimum=false`만 유효
- 프리롤은 운영자가 `botFillToMinimum`을 선택
- 인스턴스 생성 뒤 필드·경제·총상금 설정은 불변

## 5. 시작 인원 정책

시작 인원은 단순 등록자 수가 아니라 예정 시각에 다음 조건을 모두 만족하는 휴먼으로 계산한다.

- 현재 연결된 세션
- 해당 등록 attempt가 현재 정본
- 다른 cash·SnG·arena·seat waiter·MTT active claim 없음
- enrollment transaction에서 좌석 claim 성공

시작 규칙은 다음과 같다.

| 모드 | 봇 설정 | 실제 시작 조건 |
|---|---|---|
| `wallet` | 항상 꺼짐 | claim된 휴먼 `>= minEntrants` |
| `freeroll` | 켜짐 | claim된 휴먼 `>= 1`; 부족분만 `minEntrants`까지 봇 충원 |
| `freeroll` | 꺼짐 | claim된 휴먼 `>= minEntrants` |

공통 규칙:

- claim된 휴먼이 0명이면 프리롤도 시작하지 않는다.
- 휴먼이 `minEntrants` 이상이면 봇을 한 명도 추가하지 않는다.
- 봇은 `maxEntrants`, `initialEntrants`, `finalEntrants`, 순위와 입상 인원에 포함한다.
- 시작 후 봇을 새로 충원하거나 레이트 레지 휴먼과 교체하지 않는다.
- 자동 예정 시작에서 조건 미달이면 취소한다.
- 조기 수동 시작에서 조건 미달이면 `not-enough`만 반환하고 등록·경제 상태와 기존 예정 시각을 보존한다.
- 수동 회차 만료는 인원과 관계없이 취소한다.

취소 경제 처리:

- `wallet`: 참가자 전원의 바이인·수수료를 환불하고 나서 `cancelled/not-enough`
- `freeroll`: 예약한 총상금을 공용 운영 원장에 반환하고 나서 `cancelled/not-enough`
- 반환이 끝나기 전에는 `refund-pending`을 유지

## 6. 공용 운영 자금

### 6.1 잔액

`promotion_fund`는 플랫폼 전체가 공유하는 단일 계정이다.

```text
account_id              TEXT PRIMARY KEY CHECK (account_id = 'global')
balance                 INTEGER NOT NULL CHECK (balance >= 0)
version                 INTEGER NOT NULL CHECK (version >= 0)
updated_at              INTEGER NOT NULL
```

- 마이그레이션 시 잔액 0으로 한 번 생성한다.
- 모든 금액은 JavaScript safe integer와 SQLite 정수 범위를 함께 검사한다.
- 잔액을 음수로 만드는 조정이나 상금 예약은 거절한다.
- `balance`는 아직 예약되지 않은 **사용 가능 잔액**이다. 회차 예약 시 즉시 차감하고,
  현재 예약 총액은 `status='reserved'`인 상금 에스크로 합계로 별도 조회한다.
- 관리자 차감은 사용 가능 잔액만 줄일 수 있으며 이미 예약된 회차 상금을 침범할 수 없다.
- 프로필 운영자와 백오피스 관리자는 같은 공용 잔액을 사용한다.
- 자금 조정 권한은 백오피스 관리자에게만 있다.

### 6.2 append-only 원장

`promotion_fund_ledger`는 UPDATE·DELETE를 허용하지 않는다.

```text
id                      TEXT PRIMARY KEY
account_id              TEXT NOT NULL REFERENCES promotion_fund(account_id)
kind                    TEXT NOT NULL
delta                   INTEGER NOT NULL CHECK (delta <> 0)
balance_after           INTEGER NOT NULL CHECK (balance_after >= 0)
instance_id             TEXT
actor_kind              TEXT NOT NULL
actor_id                TEXT NOT NULL
reason                  TEXT NOT NULL
idempotency_key         TEXT NOT NULL UNIQUE
created_at              INTEGER NOT NULL
```

`kind`는 다음 값만 허용한다.

```text
admin-adjustment
freeroll-prize-reserve
freeroll-bot-prize-return
freeroll-prize-refund
```

`actor_kind`는 `backoffice-admin|operator-profile|system`만 허용한다.
`actor_id`는 각각 admin session principal, 운영자 profile ID, 고정 service principal을 저장한다.
관리자 수동 조정은 반드시 `backoffice-admin`, 회차 생성·취소 명령은 실제 호출 주체,
재시작·스케줄러 처리는 `system`을 사용한다.

관리자 조정은 다음을 강제한다.

- 0이 아닌 안전한 정수
- 요청당 절댓값 최대 2,000,000,000
- 5~200자의 공백 제거된 사유
- 차감 뒤 잔액 0 이상
- 요청별 UUID 멱등 키
- backoffice admin session을 식별하는 actor 종류·불변 ID, 처리 시각, 처리 후 잔액 보존
- HTTP 세션·CSRF·Origin·IP 제한
- 화면 내부 2단계 확인

`kind`, `actor_kind`, 금액·사유 범위는 DB CHECK로도 제한한다.
계정 balance 갱신, `version += 1`, 원장 INSERT, 회차 예약·반환에 필요한 에스크로와
instance CAS는 각각 하나의 `BEGIN IMMEDIATE` transaction에서 처리한다.
`balance_after`가 실제 갱신 잔액과 다르면 전체 rollback한다.

원장 행은 트리거로 UPDATE·DELETE를 거절한다. 봇 반환액이 0이면 `delta <> 0` 제약에 맞춰
`freeroll-bot-prize-return` 행을 만들지 않는다.

### 6.3 회차별 상금 에스크로

`tournament_prize_escrow`는 프리롤 인스턴스마다 최대 한 행이다.

```text
instance_id             TEXT PRIMARY KEY REFERENCES tournament_instance(id)
account_id              TEXT NOT NULL CHECK (account_id = 'global')
amount                  INTEGER NOT NULL CHECK (amount > 0)
status                  TEXT NOT NULL
human_paid              INTEGER NOT NULL DEFAULT 0 CHECK (human_paid >= 0)
bot_returned             INTEGER NOT NULL DEFAULT 0 CHECK (bot_returned >= 0)
settlement_fingerprint  TEXT
reserved_at             INTEGER NOT NULL
settled_at              INTEGER
refunded_at             INTEGER
updated_at              INTEGER NOT NULL
```

`status`는 `reserved|settled|refunded`만 허용한다.

불변식:

```text
reserved: human_paid = 0, bot_returned = 0
settled:  human_paid + bot_returned = amount
refunded: human_paid = 0, bot_returned = 0
```

`settlement_fingerprint`는 설정 버전, 최종 필드, 정렬된 전체 결과,
휴먼 지급 목록과 봇 반환액을 포함한다. 같은 fingerprint의 재호출만 멱등 성공한다.

`instance_id`, `account_id`, `amount`, `reserved_at`은 생성 뒤 불변이다.
허용된 상태 전이와 정산 열 갱신 외 UPDATE 및 모든 DELETE를 트리거로 거절한다.
`settled_at/refunded_at`은 해당 terminal status에서만 정확히 하나가 존재하고,
`reserved`에는 둘 다 없어야 한다.

인스턴스와 에스크로의 교차 불변식은 repository transaction과 복구 검증이 함께 강제한다.

```text
공개된 프리롤           → exact one reserved escrow, amount = config totalPrize
scheduled-hidden        → escrow 없음
payout-pending 프리롤   → reserved escrow + payout freeze + complete settlement plan
completed 프리롤        → settled escrow
refund-pending 프리롤   → reserved escrow, 신규 등록·게임 액션 금지
                           단 escrow 누락·금액·상태 불일치의 financial-invariant 격리는
                           현재 행을 보존하고 자동 종결 금지
cancelled 프리롤        → refunded escrow
                           또는 한 번도 공개·예약되지 않은 숨은 회차이며 escrow 없음
```

`payout-pending`은 `refund-pending|cancelled`로 갈 수 없고 정산 성공의 `completed`만 허용한다.
`settled` 회차의 취소와 `refund-pending` 회차의 새 settlement plan 생성은 거절한다.
에스크로 없이 직접 취소할 수 있는 숨은 회차 reason은
`promotion-insufficient|invalid-config|template-superseded|operator-cancel`로 제한한다.
모든 direct cancel·복구 분류 전에는 lifecycle과 실제 escrow status의 허용 행렬을 검사한다.
비종결 회차의 예상치 못한 `settled|refunded`, 다른 mode의 경제 행 등은
`refund-pending/financial-invariant`로 격리하고 자동 자금 이동·종결을 금지한다.

### 6.4 최종 정산 계획

등록 마감의 `payout_freeze_json`은 `finalEntrants`와 순위별 상금액만 고정한다.
그 시점에는 생존자의 최종 순위를 알 수 없으므로 휴먼 지급 목록이나 봇 반환액을 넣지 않는다.

마지막 생존자까지 확정되면 두 테이블에 최종 결과를 먼저 영속한다.
이 테이블은 wallet과 프리롤이 공통으로 사용한다.

```text
tournament_settlement
instance_id             TEXT PRIMARY KEY REFERENCES tournament_instance(id)
status                  TEXT NOT NULL CHECK (status IN ('pending', 'settled'))
payout_freeze_checksum  TEXT NOT NULL
final_entrants          INTEGER NOT NULL CHECK (final_entrants >= 1)
prize_pool              INTEGER NOT NULL CHECK (prize_pool > 0)
human_payout_total      INTEGER NOT NULL CHECK (human_payout_total >= 0)
bot_return_total        INTEGER NOT NULL CHECK (bot_return_total >= 0)
fingerprint             TEXT NOT NULL UNIQUE
created_at              INTEGER NOT NULL
settled_at              INTEGER
updated_at              INTEGER NOT NULL

tournament_settlement_result
instance_id             TEXT NOT NULL REFERENCES tournament_settlement(instance_id)
place                   INTEGER NOT NULL CHECK (place >= 1)
player_id               TEXT NOT NULL
participant_type        TEXT NOT NULL CHECK (participant_type IN ('human', 'bot'))
profile_id              TEXT
registration_attempt    INTEGER
display_name_snapshot   TEXT NOT NULL
prize                   INTEGER NOT NULL CHECK (prize >= 0)
disposition             TEXT NOT NULL
PRIMARY KEY (instance_id, place)
UNIQUE (instance_id, player_id)
```

repository는 계획 INSERT transaction에서 다음을 강제한다.

- 결과 행 수는 `final_entrants`와 같고 place가 `1..N`으로 연속한다.
- 시작 봇과 레이트 레지를 포함한 모든 committed 휴먼, 즉 최종 필드 전체가
  player ID 기준 정확히 한 번 등장한다.
- 휴먼은 `profile_id`와 시작에 사용한 `registration_attempt`가 반드시 있고
  같은 인스턴스에서 중복되지 않는다.
- 봇은 두 열이 모두 null이다.
- `sum(result.prize) = prize_pool`이다.
- 휴먼 행 상금 합계와 봇 행 상금 합계가 각각 header의 두 total과 같다.
- wallet은 봇 행과 `bot_return_total`을 허용하지 않는다.
- 프리롤 에스크로 금액, payout freeze의 prize pool, settlement prize pool이 같다.
- `disposition`은 상금이 있는 휴먼의 `wallet-credit`, 상금이 있는 봇의
  `promotion-return`, 상금 0인 행의 `none`만 허용한다.

`fingerprint`는 instance ID, config version, payout freeze checksum, 최종 필드,
place 오름차순의 모든
결과 행과 두 total을 canonical encoding한 뒤 계산한다. 동일 instance에 같은 fingerprint를
다시 저장하는 호출만 멱등 성공하고, 다른 결과는 충돌로 격리한다.
`tournament_settlement_result`는 정산 완료 뒤에도 순위표·감사·재시작 정본으로 보존하며
UPDATE/DELETE하지 않는다.
settlement header는 `pending → settled`와 `settled_at` 기록만 허용하고 다른 핵심 열의
UPDATE·모든 DELETE를 거절한다.

## 7. 상금 예약 시점

프리롤은 상금 예약이 성공한 뒤에만 참가자에게 공개한다.

- 즉시 노출 단발·수동 회차:
  - 인스턴스 생성, 운영 잔액 차감, 원장 기록, 상금 에스크로 생성을 한 transaction에서 수행
  - 잔액 부족이면 생성 요청을 `promotion-insufficient`로 거절
- 미래 `scheduled-hidden` 회차:
  - 설정 인스턴스는 먼저 만들 수 있다.
  - `visibleAt` 전이 transaction에서 운영 잔액과 인스턴스 상태를 다시 검사해 한 번만 예약
  - 예약 성공과 `scheduled-visible|registering` 전이를 원자적으로 수행
  - 잔액 부족이면 공개하지 않고 `cancelled/promotion-insufficient`
- 반복 템플릿:
  - 숨은 미래 회차 전체의 자금을 미리 잠그지 않는다.
  - 각 occurrence가 공개될 때 독립적으로 예약한다.
  - 자금 부족 회차는 tombstone으로 남겨 같은 occurrence를 중복 생성하지 않는다.

등록 시작과 로비 노출 시각이 같아도 상금 예약 transaction이 먼저 성공해야 한다.
공개 projection은 `reserved` 에스크로가 없는 프리롤을 절대 반환하지 않는다.

## 8. 완주 정산

프리롤의 총상금은 등록 인원과 무관하게 고정된다.
입상 인원과 순위별 금액은 선행 설계대로 `finalEntrants`와 선택한 payout snapshot으로 계산한다.
봇도 일반 참가자처럼 전체 순위와 상금 칸을 점유한다.

예:

```text
총상금 100,000
1위 봇   50,000 → promotion 반환
2위 휴먼 30,000 → 휴먼 wallet 지급
3위 휴먼 20,000 → 휴먼 wallet 지급
```

봇 몫을 다음 휴먼에게 내리거나 소각하지 않는다.

완주는 결과 고정과 자금 정산의 두 transaction으로 나눈다.

첫 transaction:

1. 불변 설정 스냅샷, payout freeze와 최종 필드를 읽는다.
2. 전체 결과가 휴먼 등록과 봇 player ID를 정확히 한 번씩 열거하는지 검증한다.
3. payout freeze로 각 점유 순위 상금을 계산한다.
4. 6.4절의 settlement header와 전체 결과 행을 저장한다.
5. 프리롤이면 에스크로에 같은 fingerprint를 기록한다.
6. 인스턴스를 `running → payout-pending`으로 CAS한다.

두 번째 transaction은 runtime 결과를 다시 계산하지 않고 저장된 settlement plan만 읽는다.

- wallet:
  1. started entry와 결과를 대조한 기존 MTT 정산 경로로 휴먼 상금을 지급한다.
  2. 모든 entry와 settlement를 settled, 인스턴스를 `completed`로 전이한다.
- 프리롤:
  1. entry buy-in 검증을 요구하지 않는 전용 `creditFreerollPrize()` 내부 경로로 휴먼에게
     `mtt-freeroll-prize:<instanceId>:<place>` 멱등 키와 지급 사유를 기록한다.
  2. 모든 봇 상금 합계를 `promotion_fund`에 반환하고 원장에 기록한다.
  3. `humanPaid + botReturned === escrow.amount`를 검증한다.
  4. 에스크로와 settlement를 `settled`, 인스턴스를 `completed`로 전이한다.

프리롤의 모든 휴먼 credit, 봇 반환, promotion ledger, 에스크로·settlement·instance 종결은
같은 SQLite connection의 한 transaction에서 처리한다. 기존 `settleMttTournament()`의
started entry·buy-in pool exact-match 검증을 우회해 호출하지 않고, 공통 하위 ledger primitive만
재사용한다.

정산이 실패하면 영속 settlement plan과 payout freeze를 유지한 채 재시도하며,
성공하기 전에는 `completed`로 전이하거나 회차를 정리하지 않는다.
서버 재시작도 같은 fingerprint와 결과 행으로 정산을 재개한다.

wallet도 완주 결과가 확정되면 같은 `payout-pending → completed` 경계를 사용한다.
완주한 wallet을 정산 오류 때문에 참가비 환불로 바꾸지 않는다.

## 9. 취소와 반환

프리롤 취소는 두 transaction으로 분리한다.

첫 transaction은 취소 가능 lifecycle을 다시 검사하고 인스턴스를
`refund-pending/closed`로 CAS해 새 등록·게임 액션을 차단한다.
상금은 아직 움직이지 않는다. 이 durable claim이 성공한 뒤 runtime을 멱등 정리한다.

두 번째 멱등 transaction:

1. 인스턴스가 같은 취소 generation의 `refund-pending`인지 확인한다.
2. `reserved` 상금 에스크로와 config 금액을 확인한다.
3. 총상금 전액을 `promotion_fund`에 반환한다.
4. `freeroll-prize-refund` 원장을 기록한다.
5. 에스크로를 `refunded`, 인스턴스를 `cancelled`로 전이한다.

두 번째 transaction이 실패해도 첫 claim은 rollback하지 않는다.
회차는 `refund-pending`에 남아 재시작·scheduler tick이 반환을 재개한다.

이미 `settled`인 프리롤은 취소할 수 없다.
이미 `refunded`인 동일 취소 재호출은 멱등 성공한다.
한 번도 공개·예약되지 않은 숨은 회차는 6.3절의 허용 reason에 한해 에스크로 없이
직접 `cancelled`가 될 수 있다.
`payout-pending|completed|cancelled`의 새 취소는 거절하며,
특히 `payout-pending`을 반환·환불 경로로 바꾸지 않는다.

wallet 취소는 선행 설계의 instance-wide 전액 환불을 유지한다.
두 모드 모두 금전 반환이 끝나기 전에 `cancelled`로 표시하지 않는다.

## 10. 재시작 복구

서버 수신 시작 전에 다음 순서로 조정한다.

1. `scheduled-hidden` 프리롤은 아직 자금을 예약하지 않는다.
2. 공개 가능한 프리롤은 상금 에스크로가 정확히 하나인지 검사한다.
3. `reserved` 에스크로를 가진 유효 pre-start 회차는 보존한다.
4. 만료·미달·invalid-config·stale-starting 중 경제 책임이 있는 회차만
   `refund-pending` 반환을 재개한다. 한 번도 예약되지 않은 숨은 invalid-config 회차는
   허용 reason으로 직접 취소하고, 공개 회차의 누락·불일치는 `financial-invariant`로 격리한다.
5. `running` 회차는 핸드 복구가 불가능하므로 취소하고:
   - 프리롤은 총상금 전액 반환
   - wallet은 참가비·수수료 전액 환불
6. 결과가 고정된 `payout-pending`은 취소하지 않고 영속 settlement plan으로 정산을 재개한다.
7. `completed|cancelled`이면서 금전 상태가 terminal인 회차만 보존 기한 뒤 정리한다.
8. `visibleAt`을 놓친 숨은 프리롤은 현재 시각에 funding CAS를 한 번 수행한다.

상금 에스크로와 원장 idempotency key가 불일치하거나 금액 보존이 깨진 회차는
자동 지급하지 않고 운영 경보 상태로 격리한다.

## 11. 레이트 레지와 봇

- 프리롤 총상금은 레이트 레지 중에도 변하지 않는다.
- wallet 총상금은 수락·확정된 유료 휴먼 바이인만큼 증가한다.
- 시작 봇은 레이트 레지 휴먼과 교체하지 않는다.
- 봇은 최종 필드, 입상 인원, H4H와 상금 점유에 계속 포함한다.
- 레이트 레지 신규 휴먼은 `maxEntrants`에서 시작 봇과 기존 휴먼을 뺀 자리만 사용할 수 있다.
- 프리롤은 신규 휴먼 등록에 경제 debit이 없지만 registration attempt와 cap claim은 동일하게 사용한다.
- 등록 마감에는 최종 필드와 place별 상금표만 freeze한다.
- 마지막 생존자 확정 때 전체 결과의 휴먼/봇 귀속을 settlement plan으로 별도 고정한다.

## 12. 공개 프로토콜과 UI

생성 요청의 경제·필드 부분은 다음 계약을 사용한다.

```ts
interface CreateTournamentRequestV2 {
  economyMode: 'freeroll' | 'wallet';
  minEntrants: number;
  maxEntrants: number;
  botFillToMinimum: boolean;
  prizePool:
    | { kind: 'promotion-funded'; totalPrize: number }
    | { kind: 'entry-pool' };
}
```

프리롤 생성 화면:

- `프리롤` 명칭
- `바이인 없음`
- 보장 총상금 입력과 운영 자금 예약 안내
- 봇 충원 체크박스
- `봇 입상 상금은 운영 기금으로 반환됩니다`

wallet 생성 화면:

- `유료 토너먼트` 또는 기존 `리얼 칩` 배지
- 바이인·수수료
- 봇 옵션 미노출
- `사람만 참가 · 최소 인원 미달 시 자동 취소 및 전액 환불`

로비 카드와 상세는 다음을 공통 표시한다.

- 현재 등록 휴먼 수, `minEntrants`, `maxEntrants`
- `최소 인원까지 봇 충원` 또는 `사람만 참가`
- 예정 시작·등록 마감과 미달 취소 정책
- 프리롤 고정 총상금과 봇 상금 반환 정책
- wallet 바이인·수수료·환불 정책
- 프리롤 상태는 `상금 예약 완료|상금 반환 처리 중|상금 지급 처리 중`
- wallet `refund-pending`은 `환불 처리 중`

MTT UI와 공개 문구에서 `연습 모드`, `연습용 상금`, `표시용 칩`을 사용하지 않는다.

## 13. `/admin` 운영 자금

토너먼트 탭에 다음을 추가한다.

- 사용 가능한 공용 운영 잔액
- 프리롤에 예약된 금액
- 최근 조정·예약·봇 상금 반환·취소 반환 원장
- `[운영 자금 조정]`

조정 API는 백오피스 admin session만 허용한다.
프로필 운영자 capability는 토너먼트 개설·운영에는 사용할 수 있지만 자금 조정에는 사용할 수 없다.

```text
GET  /api/admin/promotion-fund
POST /api/admin/promotion-fund/adjust
```

GET은 `?limit=1..100&before=<opaque-cursor>`로 원장을 페이지 조회하며
사용 가능 잔액, 현재 reserved 합계, ledger page와 다음 cursor를 함께 반환한다.

POST body:

```ts
{
  requestId: string;
  delta: number;
  reason: string;
}
```

응답은 현재 잔액과 생성된 ledger entry를 반환한다.
잔액 부족은 일반 `invalid`가 아니라 `promotion-insufficient`로 구분한다.

화면은 금액·증감 방향·사유 입력 뒤 두 번째 review 단계에서 변경 전후 잔액을 보여주고,
그 안의 실행 버튼으로만 요청한다. 브라우저 `confirm()`은 사용하지 않는다.
이는 UI 내부 draft/review이며 서버 mutation은 최종 실행 때 한 번만 전송한다.
서버 안전성은 admin session, CSRF, same-origin, rate limit과 UUID 멱등 키가 담당한다.

## 14. 운영 이벤트

다음 이벤트를 `ops_event` 화이트리스트에 추가한다.

```text
promotion-fund-adjust
mtt-freeroll-prize-reserve
mtt-freeroll-prize-reserve-failed
mtt-freeroll-prize-settle
mtt-freeroll-prize-refund
mtt-payout-pending
```

이벤트에는 instance/template ID, 금액, 처리 후 잔액, 결과 코드,
권한 주체와 idempotency key를 남긴다.
세션 토큰·인증 토큰·credential 값은 기록하지 않는다.

## 15. 마이그레이션과 호환성

아직 구현·배포되지 않은 예약 MTT v27/v28 마이그레이션에 다음을 함께 포함한다.

- `promotion_fund`
- `promotion_fund_ledger`
- `tournament_prize_escrow`
- `tournament_settlement`
- `tournament_settlement_result`
- `payout-pending` lifecycle과 관련 CHECK
- 정규화 `economy_mode`와 settlement owner/lease/retry 열
- 프리롤 경제·상금 config validation

이미 배포된 스키마를 중간 버전으로 가정한 추가 임시 마이그레이션은 만들지 않는다.
기존 v26 wallet MTT 에스크로와 SnG 6인 상품 검증은 유지한다.

호환 입력 `practice → freeroll`은 소켓과 admin HTTP의 공통 파서 한 곳에서만 수행한다.
도메인 매니저와 저장소는 `practice`를 받지 않는다.

## 16. 필수 테스트

1. 운영 잔액 초기값 0, 증감, 음수 잔액 거절, 사유 검증
2. 관리자 조정 UUID 멱등성과 append-only 감사
3. 즉시 프리롤 상금 예약과 잔액 부족 생성 거절
4. 숨은 반복 회차의 `visibleAt` 단일 예약과 부족 시 비공개 취소
5. 프리롤 취소 전액 반환과 중복 반환 방지
6. 휴먼 우승, 봇 우승, 휴먼·봇 동시 입상 정산
7. `humanPaid + botReturned === totalPrize`
8. 봇 ID가 profile wallet 지급 경로에 들어가지 않음
9. 프리롤 휴먼 0명 취소
10. 봇 사용 시 휴먼 1명 이상에서 최소 인원까지만 충원
11. 봇 미사용 프리롤 최소 미달 취소
12. 최소 이상 휴먼이면 봇 0명
13. wallet 봇 설정의 UI 미노출과 서버 거절
14. wallet 예정 시작 최소 미달 전액 환불
15. 조기 수동 `not-enough` 뒤 등록·경제 상태와 예약 시각 보존
16. refund 실패의 `refund-pending` 복구
17. 취소 claim 직후 crash·반환 실패에서도 durable `refund-pending`을 유지하고 다음 시작에 반환 재개
18. 정산 실패의 `payout-pending` 결과 freeze·정산 계획 영속과 재시작 재시도
19. 정산 계획의 전체 순위 연속성, 참가자 1회 열거, 휴먼 profile·봇 귀속, 합계 보존과 변조 거절
20. 프리롤 전용 wallet credit가 entry-pool 검증을 타지 않고 같은 transaction에서 멱등 지급
21. `payout-pending`의 cancel/refund 전이와 `refund-pending`의 settlement plan 생성 거절
22. 레이트 레지 후 고정 프리롤 총상금과 최종 필드 상금표
23. `practice` 호환 입력과 `freeroll` 전용 출력
24. admin 세션·CSRF·Origin·rate limit·무권한 조정 거절
25. 공개 summary/detail/card/admin 화면의 동일 명칭·금액·상태
26. 관련 Vitest, 전체 `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run build`

## 17. 구현·활성화 순서

1. v27/v28 원장·에스크로·instance lifecycle과 저장소
2. `/admin` 운영 자금 조회·조정
3. 스케줄러 funding CAS와 복구
4. 프리롤 생성·시작·봇 충원·취소
5. 전체 필드 정산과 `payout-pending`
6. 공개 프로토콜·로비·상세·생성 UI 명칭 교체
7. wallet 최소 인원 미달 취소·환불 강화
8. 레이트 레지와 반복 회차 통합
9. 전체 검증 후 기능 플래그 활성화

운영 자금 기능은 초기 잔액 0으로 배포한다.
관리자가 자금을 조정하고 원장·잔액을 확인한 뒤 프리롤 공개를 활성화한다.

## 18. 완료 기준

- MTT 공개 화면과 신규 설정에 `연습` 또는 `practice`가 남지 않는다.
- 프리롤은 공용 운영 잔액보다 큰 상금을 약속할 수 없다.
- `scheduled-visible`부터 `payout-pending`까지의 모든 활성 프리롤에는
  정확히 하나의 `reserved` 상금 에스크로가 있다.
- 프리롤은 휴먼 1명 이상일 때만 시작한다.
- 선택된 봇은 부족분만 최소 인원까지 채운다.
- 휴먼과 봇 상금의 합계가 예약한 총상금과 항상 같다.
- 휴먼 상금은 지갑에 지급되고 봇 상금은 운영 원장으로 반환된다.
- 유료 wallet MTT에는 봇이 없고 최소 인원 미달 시 전액 환불 후 취소된다.
- 서버 재시작과 중복 요청에도 예약·지급·반환이 한 번만 처리된다.
- 금전 상태가 terminal이 되기 전에 회차가 삭제되지 않는다.
