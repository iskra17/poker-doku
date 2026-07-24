# MTT 운영 백오피스·예약/반복 개설 설계

**작성일:** 2026-07-24
**상태:** 상위 방향 승인, 상세 설계 검토 대기
**대상:** Poker Doku 멀티테이블 토너먼트(MTT)

이 문서와 `2026-07-24-mtt-late-registration-design.md`는 한 구현 배치의 두 설계다.
여기서는 영속 설정·일정·개설 UI를, 두 번째 문서에서는 실제 진행 중 등록·좌석·순위 계약을 정의한다.
두 번째 문서의 `LateRegistrationPolicy`를 공용 설정 타입으로 사용한다.

## 1. 목표

운영자가 `/admin`에서 토너먼트의 모집·시작·구조·상금을 한 화면에서 이해하고,
예약된 단발 또는 반복 토너먼트를 서버 재시작에도 유실되지 않게 운영할 수 있도록 한다.

이번 설계는 다음 문제를 함께 해결한다.

1. 설정마다 드롭다운을 반복해서 여는 현재 개설 UI를 팝업형 설정 화면과 즉시 선택 가능한
   카드/라디오 방식으로 바꾼다.
2. 서버 기준 현재 시각, 로비 노출 시각, 등록 시작 시각, 실제 시작 시각을 분리한다.
3. 매시간·매일·매주 반복 토너먼트를 독립 인스턴스로 미리 생성하고 자동 시작한다.
4. `최소 시작 인원`, `등록 상한`, `봇 충원 목표`를 서로 다른 개념으로 분리한다.
5. 프리셋 구조의 설명을 강화하고 운영자가 블라인드·앤티·브레이크를 직접 편집할 수 있게 한다.
6. 총상금, 입상 인원과 입상률, 순위별 금액과 비율을 동시에 보여준다.
7. 예약·반복 설정과 등록 명단을 SQLite에 보존해 프로세스 재시작 뒤에도 복구한다.

## 2. 이번 범위와 후속 범위

### 포함

- 운영자 계정 및 백오피스 전용 개설 권한 유지
- 단발 즉시 모집, 단발 예약, 반복 예약
- 한국 표준시 기준 서버 시계와 모든 계산 결과 표시
- 로비 노출·등록 시작·토너먼트 시작의 독립 설정
- 최소 인원과 최대 인원의 분리
- practice 토너먼트의 최소 인원까지만 봇 충원
- wallet 토너먼트의 인원 미달 취소·전액 환불
- 스탠다드·터보·하이퍼 프리셋 설명
- 커스텀 블라인드 구조 편집
- 상금 구조의 금액·비율 상세 미리보기
- 예약 템플릿·회차·등록 명단 영속화와 재시작 조정
- 레이트 레지 설정을 담을 수 있는 버전형 설정 스냅샷

### 제외

- 바운티·미스터리 바운티
- 리엔트리·리바이·애드온
- 클럽 단위 토너먼트 개설 권한
- 외부 캘린더나 푸시 알림 연동
- 이미 진행 중인 MTT의 서버 재시작 후 핸드 단위 복구
- 운영자가 임의의 wallet 보장 상금을 발행하는 기능
- 수련 과제·출석·아레나 리더보드 변경

### 중복 정리와 후속 권장안

사용자 제안의 `인원 제한 완화`, `최소 인원`, `부족분 봇 충원`은 서로 다른 기능으로 만들지 않고
이 문서의 `minEntrants`, `maxEntrants`, `botFillToMinimum` 한 정책으로 통합한다.
`표준형/넓은 입상형`과 `직접 총상금`도 경쟁 옵션이 아니라 각각 분배 비율과 자금 출처로 분리한다.
레이트 레지는 후속으로 미루지 않고 같은 구현 배치의 두 번째 설계로 포함한다.

나머지는 다음 독립 프로젝트로 보존한다.

- 클럽: 클럽 소유권·역할·정산·감사 로그를 먼저 설계한 뒤 cash/MTT 개설 권한을 위임한다.
- 바운티/미스터리 바운티: 팟 엔진이 아니라 별도 bounty 원장·탈락 귀속·정산 프로젝트로 진행한다.
- 수련 과제: `AA 받기`, `플러시로 승리`처럼 운에 크게 좌우되는 조건은 필수 일일 과제로 두지 않는다.
  선택형 보너스·교체 가능한 과제로 두고, 올인 승리 과제는 무리한 플레이와 칩 덤핑을 유도할 수 있어
  봇·연습·비공개 방을 제외하는 정당성/어뷰징 규칙과 함께 설계한다.
- 출석: 1·2·3·5일만 보상하는 끊긴 표보다 7일 순환 트랙, KST 날짜 경계,
  중복 계정·소급 지급·보상 원장을 먼저 정의한다.
- 아레나: 누적 평생 XP보다 주간 시즌 Top 20과 전일 순위 변동을 권장한다.
  신규 사용자가 영구적으로 따라잡지 못하는 구조와 단순 판수 farming을 피하도록 유효 핸드 기준을 둔다.

이 후속 항목은 이번 MTT 경제·순위 계약과 섞지 않아 배포 위험과 테스트 범위를 제한한다.

## 3. 결정 근거

- PokerStars는 토너먼트마다 상금 구조와 입상 범위가 달라질 수 있고, 참가자는 등록 전에
  구조를 확인할 수 있게 한다.
  - https://www.pokerstars.com/help/articles/trn-payout-structure/44864/
- PokerStars Home Games는 입상 범위를 10%·15%·20%처럼 운영자가 이해하기 쉬운 단위로
  제시한다.
  - https://www.pokerstars.com/help/articles/hg-club-mngr-payout-strctre/89212/
- PokerNow MTT는 커스텀 블라인드 스케줄과 호스트 승인 등 운영자 중심 설정을 제공한다.
  - https://www.pokernow.com/mtt

다른 플랫폼의 비공개 구현을 복제하지 않는다. 참가자가 등록 전에 구조와 상금을 이해할 수 있고,
운영자가 반복 업무를 안전하게 자동화할 수 있다는 공통 원칙만 가져온다.

## 4. 핵심 도메인 분리

현재 `maxEntrants` 하나가 등록 상한, 봇 충원 목표, 시작 예상 필드를 동시에 표현한다.
다음처럼 분리한다.

```ts
interface TournamentFieldPolicy {
  minEntrants: number;
  maxEntrants: number;
  botFillToMinimum: boolean;
}
```

- `minEntrants`
  - 토너먼트를 시작할 수 있는 최소 필드다.
  - 허용 범위는 2~48명, 기본값은 8명이다.
  - 운영 UI의 권장 빠른 선택은 5명·8명·12명이고 직접 입력도 허용한다.
- `maxEntrants`
  - 등록 가능한 전체 필드의 절대 상한이다.
  - `minEntrants` 이상 48명 이하이고, 기본값은 48명이다.
  - 시작 시 최소 인원을 넘은 참가자는 상한까지 모두 수용한다.
- `botFillToMinimum`
  - practice에서만 사용할 수 있다.
  - 실제 체크인 인원이 최소 인원보다 적을 때 `minEntrants`까지만 봇을 채운다.
  - `maxEntrants`까지 봇으로 채우지 않는다.
  - wallet에서는 서버가 항상 `false`로 정규화한다.

상한에는 시작 시 착석한 봇도 포함한다. 예를 들어 최소 8명, 상한 24명인 practice에
휴먼 5명과 봇 3명이 시작하면 레이트 레지로 추가 수용할 수 있는 자리는 16개다.
최소와 상한을 같은 값으로 두면 봇 충원 후 필드가 가득 차므로 레이트 레지는 즉시 닫힌다.

### 4.1 인스턴스 설정 스냅샷

```ts
interface TournamentConfigSnapshotV2 {
  version: 2;
  name: string;
  economy:
    | { mode: 'practice' }
    | {
        mode: 'wallet';
        productVersion: number;
        buyIn: number;
        fee: number;
      };
  tableSize: 6;
  field: TournamentFieldPolicy;
  turnTimeSeconds: 8 | 15 | 30;
  structure: {
    sourcePresetId: 'standard' | 'turbo' | 'hyper' | null;
    startingStack: number;
    segments: TournamentStructureSegment[];
  };
  prizePool: PrizePoolPolicy;
  payout:
    | { tableVersion: 2; presetId: 'top-heavy'; paidFieldPercent: 10 }
    | { tableVersion: 2; presetId: 'standard'; paidFieldPercent: 15 }
    | { tableVersion: 2; presetId: 'flat'; paidFieldPercent: 20 };
  lateRegistration: LateRegistrationPolicy;
}
```

- v1 공개 테이블 레이아웃 계약을 유지해 `tableSize`는 6으로 고정한다.
- 커스텀 시작 스택은 1,000~1,000,000의 안전한 정수다.
- wallet 바이인·수수료는 인스턴스 생성 시 서버의 승인된 MTT 상품에서
  `{ productVersion, buyIn, fee }`를 펼쳐 저장하고 클라이언트 입력을 받지 않는다.
- 등록·시작·레이트 레지·정산·재시작 복구는 현재 배포의 상품 상수가 아니라
  인스턴스에 저장된 경제 상품 스냅샷만 사용한다.
- 지원 종료된 상품 버전은 기존 회차의 정산·환불을 위해 읽기 경로를 유지하되 새 회차 생성에는 쓰지 않는다.
- `hostId`나 권한 주체는 게임 설정이 아니라 인스턴스 메타데이터로 저장한다.
- 일정도 별도 정규화 열에 저장하고 설정 JSON 안에 중복 저장하지 않는다.
- 프리셋을 선택해도 인스턴스에는 ID만 저장하지 않고 당시의 시작 스택과 전체 세그먼트를 펼쳐 저장한다.
  이후 배포에서 프리셋 기본값이 바뀌어도 이미 생성된 회차의 구조는 변하지 않는다.
- 상금표는 `tableVersion`별 상수를 영구 보존한다. 같은 버전의 표를 배포에서 덮어쓰지 않고,
  새 표는 새 버전으로만 추가한다.

뒤 절에서 선언하는 타입을 포함해 이 스냅샷 하나가 백오피스 미리보기, 공개 상세,
스케줄러 복구, 게임 런타임, wallet 정산의 공통 입력이다.

## 5. 예약 모델

### 5.1 네 시각

각 회차는 epoch millisecond 정본으로 다음 시각을 가진다.

```ts
interface TournamentSchedule {
  visibleAt: number;
  registrationOpensAt: number;
  startsAt: number | null;
  manualStartExpiresAt: number | null;
}
```

- `visibleAt`: 로비에 예정 토너먼트가 처음 나타나는 시각
- `registrationOpensAt`: 참가 등록 버튼이 활성화되는 시각
- `startsAt`: 자동 시작 시각. `null`이면 운영자 수동 시작
- `manualStartExpiresAt`: 수동 모집 회차의 자동 만료 시각

자동 시작 회차는 반드시 다음 불변식을 만족한다.

```text
visibleAt <= registrationOpensAt <= startsAt
startsAt != null
manualStartExpiresAt == null
```

수동 모집 회차는 생성 즉시 노출·등록을 기본값으로 한다.
`startsAt == null`, `manualStartExpiresAt != null`,
`registrationOpensAt < manualStartExpiresAt`을 강제한다.
practice는 6시간 뒤, wallet은 20분 뒤를 자동 만료로 하며
wallet은 `manualStartExpiresAt - registrationOpensAt <= 20분`을 서버가 강제한다.
운영자가 만료 전에 직접 시작하거나 취소할 수 있고, 만료되면 practice 등록은 취소,
active wallet 경제 책임이 있는 회차는 `refund-pending`으로 잠근 뒤 전액 환불에 성공해야 닫는다.
wallet 모드여도 active 경제 행이 전혀 없으면 등록·attempt·counter와 instance를 한 transaction에서
바로 `cancelled`로 닫는다.
`/admin` 설정 팝업과 로비 카드에는 수동 시작 남은 시간, wallet의 20분 정상 모집 창,
만료 시 자동 환불을 함께 표시한다. 환불 저장소 장애 시에는 자금 안전을 위해 active claim이
20분을 넘어 유지될 수 있으며, 참가자에게 `환불 처리 중 · 다른 지갑 게임 잠금 유지`를 표시하고
백오피스 경보와 재시도 상태를 노출한다.

### 5.2 시간대

- DB와 프로토콜 정본은 UTC epoch millisecond다.
- v1 운영 시간대는 `Asia/Seoul`로 고정한다.
- `/admin`은 API 응답의 `serverNow`를 기준으로 클라이언트 시계 오차를 계산하고,
  `현재 서버 시각 HH:mm:ss`를 1초마다 표시한다.
- 브라우저 로컬 시각을 예약 정본으로 사용하지 않는다.
- KST에는 일광 절약 시간이 없지만, 반복 규칙에는 시간대를 명시해 추후 다른 지역 확장을 막지 않는다.

### 5.3 반복 규칙

```ts
type TournamentRecurrence =
  | { kind: 'hourly'; minute: number }
  | { kind: 'daily'; hour: number; minute: number }
  | { kind: 'weekly'; weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6; hour: number; minute: number };
```

- 단발 회차는 템플릿 없이 `TournamentInstance`를 직접 만들고 자체 `startsAt`을 가진다.
- `hourly`: 매시간 지정 분에 시작한다.
- `daily`: 매일 지정 시각에 시작한다.
- `weekly`: 매주 지정 요일·시각에 시작한다.
- 반복 회차는 반드시 자동 시작이며 `startsAt=null` 수동 모드와 조합할 수 없다.
- `visibleLeadMs`는 0~30일, practice `registrationLeadMs`는 0~7일,
  wallet `registrationLeadMs`는 앞 절의 경제 잠금 정책에 따라 0~20분이며
  항상 `visibleLeadMs >= registrationLeadMs`다.
- 반복 템플릿의 생성 horizon은 다음 셋 중 가장 먼 시각까지다.
  - 현재부터 48시간
  - 최소 다음 2회차가 포함되는 시각
  - `now + visibleLeadMs + 5분 reconcile 여유`
- 따라서 긴 사전 노출을 설정해도 회차가 `visibleAt` 뒤늦게 생성되는 일이 없다.
- 한 회차가 시작될 때 다음 2회차가 이미 존재하는지 다시 확인한다.
- `(templateId, revision, startsAt)`에 유일성 제약을 두어 재시작·중복 타이머에도
  같은 템플릿 버전의 회차를 하나만 생성한다.

예를 들어 매시간 정각 시작, 60분 전 로비 노출, 50분 전 등록 시작인 템플릿은
12:00 회차가 시작되는 순간 13:00 회차가 대기 목록에 나타나고 12:10부터 등록을 받는다.

### 5.4 템플릿과 회차

반복 규칙은 `TournamentTemplate`, 실제 플레이 단위는 `TournamentInstance`로 분리한다.

```ts
interface TournamentTemplate {
  id: string;
  revision: number;
  idempotencyKey: string;
  name: string;
  enabled: boolean;
  recurrence: TournamentRecurrence;
  timezone: 'Asia/Seoul';
  visibleLeadMs: number;
  registrationLeadMs: number;
  configSnapshot: TournamentConfigSnapshotV2;
}

interface ScheduledTournamentInstance {
  id: string;
  templateId: string | null;
  templateRevision: number | null;
  idempotencyKey: string;
  occurrenceKey: string;
  visibleAt: number;
  registrationOpensAt: number;
  startsAt: number | null;
  status: TournamentInstanceStatus;
  configSnapshot: TournamentConfigSnapshotV2;
}
```

각 인스턴스는 생성 시 템플릿 설정을 복사한 불변 스냅샷을 가진다.
템플릿 PATCH는 `If-Match: <revision>`을 요구하고 transaction에서 revision을 1 올린다.

- 아직 `scheduled-hidden`이고 등록 0명인 구 revision 회차는
  `cancelled/template-superseded`로 표시한다.
- 새 recurrence로 horizon의 occurrence 시각 집합을 다시 계산한다.
- 이미 visible/registered인 구 revision 회차가 같은 occurrence 시각을 점유하면 새 회차 생성을 건너뛴다.
- 나머지 새 occurrence만 새 revision 스냅샷으로 생성한다.
- config-only 수정이면 결과적으로 숨겨진 동일 시각 회차가 교체되고,
  recurrence 시각 수정이면 새 규칙의 시각으로 다시 생성된다.
- 이미 로비에 노출됐거나 등록을 받은 회차는 바뀌지 않는다.
- 응답과 UI에 `새 설정 적용 시작 회차`와 `기존 설정으로 고정된 회차` 목록을 보여준다.
- 따라서 weekly 템플릿을 수정해도 미리 생성된 두 회차 때문에 적용이 2주 늦어지지 않는다.

템플릿을 비활성화해도 이미 생성된 회차를 자동 취소하지 않는다. 회차 취소는 별도 명시 액션이다.

반복 회차의 `idempotencyKey`는 `template:<templateId>:r<revision>:<startsAt>`이다.
`occurrenceKey`는 해당 `startsAt` epoch의 10진 문자열로 고정한다.
단발 회차는 개설 모달이 만든 request ID를 사용하고 재시도에서도 같은 값을 보낸다.
따라서 네트워크 ack 유실 뒤 POST를 다시 보내도 다른 ID의 토너먼트가 하나 더 생기지 않는다.
템플릿 생성 POST도 개설 모달의 request ID를 `idempotencyKey`로 보내 같은 멱등 계약을 사용한다.

### 5.5 회차 상태

```ts
type TournamentInstanceStatus =
  | 'scheduled-hidden'
  | 'scheduled-visible'
  | 'registering'
  | 'start-delayed'
  | 'starting'
  | 'running'
  | 'refund-pending'
  | 'completed'
  | 'cancelled';
```

```text
scheduled-hidden
  → scheduled-visible
  → registering
  → start-delayed ─┐
                   ├→ starting → running → completed
                   │     ├────→ 원래 registering 또는 start-delayed
                   │     │       // 수동 start preflight 최소 미달
                   │     └────→ cancelled 또는 refund-pending → cancelled
                   └──────────→ cancelled 또는 refund-pending → cancelled
```

위 forward 흐름과 별개로 모든 비종결 상태의 취소는 다음 경제 책임 분기를 탄다.

```text
practice 또는 wallet 경제 행이 전혀 없음 → cancelled
wallet reserved/started 등 경제 책임 존재 → refund-pending → cancelled
```

practice는 `cancelled` CAS 뒤 남은 runtime/room 정리를 멱등 재시도한다.
wallet은 전액 환불이 모두 성공하기 전에는 `cancelled`로 전이하지 않는다.

- `scheduled-hidden`: DB와 백오피스에만 존재
- `scheduled-visible`: 로비에는 보이지만 등록 버튼은 잠김
- `registering`: 시작 전 등록 가능
- `start-delayed`: 실행 슬롯 부족으로 예정 시각을 넘겨 대기
- `starting`: DB에서 시작 소유권을 획득했고 경제·방 생성을 처리 중
- `running`: 실제 테이블이 생성되어 플레이 중
- `refund-pending`: 취소는 확정됐지만 wallet 환불 재시도가 남음
- `completed|cancelled`: 종결 상태

`actualStartedAt`은 `running` 전이 성공 순간에 한 번 기록한다.
블라인드 시계와 레이트 레지 wall-clock은 예정 시각이 아니라 `actualStartedAt`을 기준으로 한다.
일시정지나 브레이크가 블라인드 시계에는 반영되더라도 레이트 레지 마감 시각을 늦추지는 않는다.

`status`와 두 번째 설계의 `registration_state`는 서로 독립적으로 UPDATE하지 않는다.
모든 전이는 한 transaction의 composite CAS로 두 열을 함께 바꾸고,
DB CHECK가 두 번째 설계 5장의 유효 조합 밖의 행을 거절한다.
예를 들어 `registering/open-prestart → starting/locked-for-start`,
수동 최소 미달은 start CAS가 캡처한 source pair로 되돌아가
`registering/open-prestart` 또는 `start-delayed/locked-for-start`를 정확히 복원하고,
정상 레이트 레지 마감은 `running/open-late → running/closing → running/closed`다.

`status_reason`은 자유 텍스트가 아니라 다음 운영 코드 중 하나 또는 null이다.

```ts
type TournamentInstanceStatusReason =
  | 'capacity'
  | 'restart-checkin-grace'
  | 'not-enough'
  | 'missed-start'
  | 'invalid-config'
  | 'template-superseded'
  | 'operator-cancel'
  | 'server-restart-unrecoverable'
  | 'start-economy-failed'
  | 'room-create-failed';
```

상세 오류 문자열과 stack trace는 제한된 운영 로그에만 두고 공개 상태에는 위 코드만 노출한다.

## 6. 영속화

SQLite 마이그레이션 v27에 다음 STRICT 테이블을 추가한다.

### 6.1 `tournament_template`

```text
id                      TEXT PRIMARY KEY
revision                INTEGER NOT NULL CHECK (revision >= 1)
idempotency_key         TEXT NOT NULL UNIQUE
name                    TEXT NOT NULL
enabled                 INTEGER NOT NULL CHECK (enabled IN (0, 1))
timezone                TEXT NOT NULL CHECK (timezone = 'Asia/Seoul')
recurrence_json         TEXT NOT NULL
visible_lead_ms         INTEGER NOT NULL
registration_lead_ms    INTEGER NOT NULL
config_version          INTEGER NOT NULL
config_json             TEXT NOT NULL
created_by_kind         TEXT NOT NULL
created_by_profile_id   TEXT
created_at              INTEGER NOT NULL
updated_at              INTEGER NOT NULL
```

### 6.2 `tournament_instance`

```text
id                      TEXT PRIMARY KEY
template_id             TEXT REFERENCES tournament_template(id)
template_revision       INTEGER
idempotency_key         TEXT NOT NULL UNIQUE
occurrence_key          TEXT NOT NULL
visible_at              INTEGER NOT NULL
registration_opens_at   INTEGER NOT NULL
starts_at               INTEGER
manual_expires_at       INTEGER
status                  TEXT NOT NULL
status_reason           TEXT
registration_state      TEXT NOT NULL
registration_close_reason TEXT
registration_generation INTEGER NOT NULL DEFAULT 0 CHECK (registration_generation >= 0)
registration_owner_token TEXT
min_entrants            INTEGER NOT NULL CHECK (min_entrants BETWEEN 2 AND 48)
max_entrants            INTEGER NOT NULL CHECK (max_entrants BETWEEN min_entrants AND 48)
initial_entrants        INTEGER CHECK (initial_entrants IS NULL OR initial_entrants >= 1)
initial_bot_entrants    INTEGER CHECK (initial_bot_entrants IS NULL OR initial_bot_entrants >= 0)
committed_entrants      INTEGER CHECK (committed_entrants IS NULL OR committed_entrants >= 0)
pending_late_entrants   INTEGER NOT NULL DEFAULT 0 CHECK (pending_late_entrants >= 0)
final_entrants          INTEGER CHECK (final_entrants IS NULL OR final_entrants >= 1)
ever_multi_table        INTEGER NOT NULL DEFAULT 0 CHECK (ever_multi_table IN (0, 1))
forfeited_chips         INTEGER NOT NULL DEFAULT 0 CHECK (forfeited_chips >= 0)
payout_freeze_version   INTEGER
payout_freeze_json      TEXT
payout_freeze_aborted_at INTEGER
config_version          INTEGER NOT NULL
config_json             TEXT NOT NULL
created_by_kind         TEXT NOT NULL
created_by_profile_id   TEXT
director_profile_id     TEXT
start_attempt           INTEGER NOT NULL DEFAULT 0
next_retry_at           INTEGER
start_owner_id          TEXT
start_lease_until       INTEGER
created_at              INTEGER NOT NULL
updated_at              INTEGER NOT NULL
```

단발 회차는 `template_id=null`이고 `occurrence_key`에 회차 ID를 그대로 사용한다.
`actual_started_at`과 `completed_at` nullable 열도 두어 실제 시작과 종결 시각을 기록한다.
상태 문자열은 각 enum만 허용하는 CHECK와
`status`×`registration_state`의 유효 조합만 허용하는 composite CHECK를 둔다.
일정 CHECK는 자동 회차를
`starts_at IS NOT NULL AND manual_expires_at IS NULL AND visible_at <= registration_opens_at <= starts_at`,
수동 회차를
`starts_at IS NULL AND manual_expires_at IS NOT NULL AND visible_at <= registration_opens_at < manual_expires_at`
중 정확히 하나로 제한한다. wallet의 20분 상한은 검증된 `config_json`의 economy mode와
정규화 열을 함께 보는 생성 repository가 강제한다.
`registration_close_reason`은 등록 상태가 `closing|closed`일 때만 정규 enum 값을 가질 수 있고,
그 외에는 null이어야 한다.
`registration_generation/owner_token`은 open→closing·cancel 같은 장기 작업의 DB CAS 세대다.
새 owner가 선점할 때 generation을 올리고 token을 교체하며,
종결 뒤 token은 null로 지우되 generation은 감사·stale callback 검증을 위해 유지한다.
composite CHECK는 `registration_state='closing'`이면 owner token이 반드시 non-null이고,
`closed` 종결 transaction에서는 token을 null로 지우도록 강제한다.
필드 카운터는 시작 전 null/0이고 `running` 전이에서 `initial_entrants=committed_entrants`로 설정한다.
`min_entrants/max_entrants`는 인스턴스 생성 transaction에서 검증된 config snapshot과 함께 펼쳐 저장하고
이후 UPDATE를 금지한다.
레이트 레지 reserve/commit/release와 `final_entrants` 고정은 해당 등록 행과 같은 transaction에서
카운터도 함께 CAS하며, caller 값이 아니라 이 행의 `max_entrants`로
`committed_entrants + pending_late_entrants <= max_entrants`를 강제한다.
`aliveSeated`만 live 엔진들에서 파생하며 DB 카운터로 덮어쓰지 않는다.
테이블 CHECK/트리거는 `initial_bot_entrants <= initial_entrants <= committed_entrants`,
`final_entrants IS NULL OR (pending_late_entrants=0 AND final_entrants=committed_entrants)`도 강제한다.
`ever_multi_table`은 시작 prepared table이 2개 이상이면 running transaction에서 1로 세팅하고,
이후에는 0으로 되돌리는 UPDATE를 트리거로 거절한다.
`payout_freeze_version/json`은 `final_entrants`와 함께 null에서 한 번만 설정하며,
둘 중 하나만 존재하거나 이후 내용이 바뀌는 UPDATE를 CHECK/트리거로 거절한다.
freeze 뒤 토너먼트가 취소되면 내용을 지우지 않고 `payout_freeze_aborted_at`을 한 번 기록한다.
`payout_freeze_aborted_at IS NOT NULL`이면 freeze 세 열이 모두 존재하고 instance가
`refund-pending|cancelled`여야 하며, 정상 running/completed 회차에는 abort marker를 허용하지 않는다.
정산과 공개 payout은 이 값이 null인 freeze만 유효한 것으로 인정한다.
`forfeited_chips`는 디렉터 강제 퇴장으로 플레이에서 제거한 잔여 스택의 누적 원장이다.
일반 탈락·테이블 이동·레이트 레지 실패에서는 바꾸지 않는다.

같은 템플릿·시각의 유효 회차는 revision과 무관하게 하나만 허용한다.
운영자가 취소한 회차도 그 시각을 막는 tombstone으로 남기고,
템플릿 수정 과정에서 `template-superseded`로 취소한 숨은 회차만 교체를 허용한다.

```sql
CREATE UNIQUE INDEX one_effective_template_occurrence
ON tournament_instance(template_id, occurrence_key)
WHERE template_id IS NOT NULL
  AND (
    status <> 'cancelled'
    OR COALESCE(status_reason, '') <> 'template-superseded'
  );
```

따라서 `operator-cancel`, `not-enough`, `missed-start` 등으로 끝난 반복 회차를
다음 reconcile이나 템플릿 revision 변경이 같은 시각에 다시 만들지 않는다.
`template-superseded` 이력은 남기면서 숨은 구 revision만 새 revision 회차로 교체할 수 있다.

### 6.3 `tournament_registration`

```text
instance_id             TEXT NOT NULL REFERENCES tournament_instance(id)
profile_id              TEXT NOT NULL
public_player_json      TEXT NOT NULL
status                  TEXT NOT NULL
ever_seated             INTEGER NOT NULL DEFAULT 0 CHECK (ever_seated IN (0, 1))
registration_attempt    INTEGER NOT NULL DEFAULT 1 CHECK (registration_attempt >= 1)
economy_entry_attempt   INTEGER CHECK (economy_entry_attempt IS NULL OR economy_entry_attempt >= 1)
registered_at           INTEGER NOT NULL
updated_at              INTEGER NOT NULL
PRIMARY KEY(instance_id, profile_id)
```

`public_player_json`에는 현재 `MttEntrant`의 이름·아바타처럼 재구성에 필요한 공개 정보만 담는다.
세션 토큰, 소켓 ID, 인증 쿠키, 비밀번호는 절대 저장하지 않는다.
wallet 금액 정본은 기존 에스크로 저장소이며 이 테이블은 등록 오케스트레이션 상태만 가진다.
`registration_attempt`는 practice와 wallet 모두 재등록할 때 단조 증가해 stale 좌석/보상 callback을 막고,
`economy_entry_attempt`는 wallet일 때만 현재 `sng_entries.entry_attempt`를 가리킨다.

등록 상태는 다음 값만 허용한다.

```ts
type TournamentRegistrationStatus =
  | 'registered'
  | 'cancelled'
  | 'no-show'
  | 'seat-claimed'
  | 'late-pending'
  | 'seated'
  | 'eliminated'
  | 'finished'
  | 'refunded';
```

```text
registered → no-show
registered → seat-claimed → seated → eliminated 또는 finished
seat-claimed → registered                 // 경제·방 변경 전 수동 시작 rollback만
no-show|cancelled|refunded → registered 또는 late-pending  // 아직 한 번도 착석하지 않았을 때만
late-pending → seated
late-pending → refunded
registered|seat-claimed|late-pending|seated|eliminated|finished → refunded
                                                // wallet 토너먼트 abort
registered|seat-claimed|late-pending|seated|eliminated|finished → cancelled
                                                // practice 토너먼트 abort
```

한 번이라도 `seated`가 된 프로필은 같은 회차에서 다시 `registered|late-pending`으로 돌아갈 수 없다.
이를 위해 `ever_seated INTEGER CHECK (ever_seated IN (0,1))` 열을 두고 재등록 가드에 사용한다.
상태와 `ever_seated`는 경제 행과 같은 transaction에서 바꾼다.
`no-show|cancelled|refunded`에서 새 등록을 받으면 `registration_attempt`를 반드시 1 올리고,
모든 비동기 좌석·commit·release 작업은 자신이 캡처한 attempt가 현재 행과 일치할 때만 상태를 바꾼다.

practice는 여러 미래 회차의 pre-start `registered`를 허용하되
실제 게임 좌석 claim은 프로필당 하나만 허용한다.

```sql
CREATE UNIQUE INDEX one_active_mtt_claim_per_profile
ON tournament_registration(profile_id)
WHERE status IN ('seat-claimed', 'late-pending', 'seated');
```

- 시작 CAS 뒤 체크인 명단을 `seat-claimed`로 바꾸는 transaction이 먼저 claim을 획득한다.
- 같은 시각 다른 MTT가 먼저 claim했거나, SessionManager에 cash/SnG/arena/seat-waiter room이 있으면
  성공하는 시작 명단에서는 제외한다. 자동 시작·만료는 해당 회차에서 노쇼·환불 처리하고,
  수동 시작이 그 결과 최소 미달이면 등록 상태를 유지한다.
- 모든 cash/SnG/arena/join-room 진입 가드도 active MTT claim을 확인해 claim 뒤 다른 방 입장을 막는다.
- late 등록은 처음부터 `currentRoomId=null`, seat waiter 없음, arena 없음,
  다른 active claim 없음이 모두 참이어야 한다.
- 시작 실패가 경제·방 단계 전이면 `seat-claimed → registered`, 취소면 환불 상태로 전이한다.
- 우승자를 포함해 정상 완료까지 남은 좌석은 정산 transaction에서 `finished`로 바꿔 active claim을 해제한다.
- 이 계약은 wallet의 우연한 active escrow 가드에 의존하지 않으므로 practice에도 동일하게 적용된다.

wallet v1은 기존 `one_active_sng_entry_per_profile`과 active `seat_escrows` 계약을 유지한다.

- 한 번에 미래 wallet MTT 하나만 등록할 수 있다.
- 등록 중에는 cash/SnG/다른 wallet MTT 입장이 제한된다.
- 이를 숨기지 않고 등록 확인 화면에 `등록 취소 전까지 다른 지갑 게임에 참여할 수 없습니다`를 표시한다.
- 장시간 잠금을 막기 위해 wallet 회차의 `registrationLeadMs`는 최대 20분으로 제한한다.
  수동 wallet 회차도 등록 오픈부터 `manualStartExpiresAt`까지 최대 20분이며 만료 시 자동 취소·전액 환불한다.
  로비 노출은 등록 오픈보다 일찍 할 수 있다.
- 20분은 정상 등록·에스크로 대기 창의 상한이다. 만료 환불이 실패한 `refund-pending` 장애 상태에서는
  이중 사용 방지를 위해 active claim을 성공적인 환불 transaction까지 유지하므로 잠금이 더 길어질 수 있다.
  이 예외를 일반 모집 중으로 표시하거나 조용히 claim만 풀지 않는다.
- 여러 wallet 예약과 대기 중 cash 플레이는 자금 예약과 active seat escrow를 분리하는
  별도 경제 프로젝트로 남긴다.

### 6.4 `tournament_registration_attempt`

네트워크 ack 유실 뒤 오래된 등록 요청이 새 시도로 오인되지 않도록
현재 등록 projection과 별도로 요청 attempt 이력을 둔다.

```text
instance_id             TEXT NOT NULL
profile_id              TEXT NOT NULL
registration_attempt    INTEGER NOT NULL CHECK (registration_attempt >= 1)
request_id              TEXT NOT NULL
economy_entry_attempt   INTEGER
status                  TEXT NOT NULL
close_generation        INTEGER
close_owner_token       TEXT
close_reason            TEXT
created_at              INTEGER NOT NULL
updated_at              INTEGER NOT NULL
PRIMARY KEY(instance_id, profile_id, registration_attempt)
UNIQUE(instance_id, profile_id, request_id)
FOREIGN KEY(instance_id, profile_id)
  REFERENCES tournament_registration(instance_id, profile_id)
```

- 모든 pre-start/late 등록 명령은 클라이언트가 `crypto.randomUUID()`로 만든 `requestId`를 보낸다.
  서버는 UUID 형식과 길이를 검증하고 인증된 profile ID를 별도로 결합한다.
- transaction은 상태·잔액·상한을 바꾸기 전에 `(instance_id, profile_id, request_id)`를 먼저 조회한다.
- 기존 request가 있으면 attempt의 현재 또는 terminal 결과를 그대로 반환하고,
  새 debit·cap 예약·`registration_attempt` 증가를 절대 수행하지 않는다.
- 새 request ID일 때만 current row의 `registration_attempt+1`을 할당하고 attempt 행을 만든다.
- attempt `status`도 위 `TournamentRegistrationStatus` enum만 허용하되,
  과거 attempt는 terminal 상태가 된 뒤 다시 열지 않는다.
- 좌석 commit, release, no-show, cancel, refund는 current row와 정확한 attempt 행을
  같은 transaction에서 함께 갱신한다.
- 마지막 cap 슬롯 또는 pending release가 closing을 claim한 attempt는
  `close_generation/close_owner_token/close_reason`을 함께 저장한다.
  세 값은 모두 null이거나 모두 non-null이어야 하며 reason은 정규 close enum이어야 한다.
- stale callback은 `requestId`, `registrationAttempt`, wallet이면 `economyEntryAttempt`까지
  모두 일치해야 상태를 바꿀 수 있다.
- attempt 이력은 부모 등록 행과 함께 180일 보존한다.

따라서 첫 요청이 이미 환불·취소된 뒤 같은 패킷이 늦게 재도착해도 terminal 결과만 돌려주며,
사용자가 명시적으로 다시 누른 새 `requestId`만 새 attempt와 wallet 에스크로를 만들 수 있다.

### 6.5 `tournament_forfeit`

디렉터 강제 제거로 플레이에서 빠지는 잔여 스택은 append-only 원장으로 남긴다.

```text
removal_id              TEXT PRIMARY KEY
instance_id             TEXT NOT NULL REFERENCES tournament_instance(id)
player_id               TEXT NOT NULL
profile_id              TEXT
registration_attempt    INTEGER
amount                  INTEGER NOT NULL CHECK (amount >= 0)
hand_number             INTEGER NOT NULL
created_by_profile_id   TEXT
created_at              INTEGER NOT NULL
UNIQUE(instance_id, player_id)
```

같은 transaction에서 이 행 INSERT, `tournament_instance.forfeited_chips += amount`,
해당 휴먼 등록/attempt의 provisional 또는 확정 탈락 전이를 함께 처리한다.
원장은 UPDATE/DELETE를 금지하고 토너먼트 인스턴스와 같은 보존 주기를 적용한다.
봇은 `profile_id/registration_attempt=null`일 수 있지만 player ID와 칩 금액은 반드시 남긴다.

### 6.6 설정 JSON 경계

`config_json`은 임의 객체가 아니다.

- `config_version`별 서버 검증 함수가 전체 스키마를 검사한다.
- 읽기 실패나 미지원 버전은 템플릿을 비활성화하고 서버 전체를 막지 않는다.
  - wallet 경제 행이 전혀 없는 회차: 등록 행을 취소하고 `cancelled/invalid-config`
  - `reserved|started` wallet 경제 행이 하나라도 있는 회차:
    `refund-pending/invalid-config`, 경제 행 자체의 금액으로 전액 환불한 뒤에만 `cancelled`
- 숫자 범위, 문자열 길이, enum, 구조 행 수를 생성 시와 복구 시 모두 검증한다.
- 인스턴스 생성 뒤 `config_json`과 정규화된 일정 열은 어느 상태에서도 UPDATE하지 않는다.
- DB 트리거도 모든 회차의 `config_version`, `config_json`, `visible_at`,
  `registration_opens_at`, `starts_at`, `manual_expires_at`, `template_id`, `idempotency_key`,
  `min_entrants`, `max_entrants` 변경을 거절한다.

종결 회차와 등록 행은 운영 조회를 위해 180일 보존한 뒤 정리한다.
템플릿과 wallet 경제 원장은 이 정리 대상이 아니다.

## 7. 스케줄러와 런타임 경계

`TournamentManager`는 진행 중 게임과 테이블 오케스트레이션을 계속 담당한다.
예약·반복·복구는 새 `TournamentScheduler`가 담당한다.

```text
TournamentTemplateRepository
          │
          ▼
TournamentScheduler ── TournamentInstanceRepository
          │
          ▼
TournamentCommandService ── TournamentEnrollmentRepository
          │
          ▼
TournamentManager ── RoomManager
```

### 7.1 스케줄러 책임

- 반복 템플릿에서 미래 회차를 멱등 생성
- `visibleAt` 도달 회차를 로비 목록에 노출
- `registrationOpensAt` 도달 회차의 등록 허용
- `startsAt` 도달 회차를 명령 서비스로 시작
- 수동 회차 만료
- 프로세스 시작 시 예약 회차와 등록 명단 재구성
- 실패 이유와 다음 재시도 시각 기록

공개 `tournament-list`는 `TournamentManager`의 live runtime만 읽지 않는다.
저장소의 `scheduled-visible|registering|start-delayed|starting|refund-pending` 회차와
매니저의 `running` 회차를 ID 기준으로 합친 뒤 개인 등록·복귀 정보를 덧붙인다.
따라서 아직 방이 없는 예정 회차도 카드에 나타나고 시작 saga·환불 중 카드도 사라지지 않는다.

### 7.2 매니저 책임

- `starting` 회차의 불변 스냅샷과 확정 체크인 명단으로 owner-scoped setup hold 아래
  무방송 prepared runtime 생성
- `running` composite CAS 성공 뒤에만 시계·세션·브로드캐스트·첫 핸드 활성화
- 봇 충원, 테이블 생성, 게임 진행
- 레이트 레지와 좌석 배정
- 전역 순위·상금·H4H·파이널 테이블
- 완료·취소·wallet 정산

### 7.3 pre-start 등록의 정본

시작 전에는 `TournamentManager` runtime을 만들지 않는다.
`tournament_instance`와 `tournament_registration`이 예정·모집 회차의 유일한 정본이다.

`TournamentCommandService.register()`는 다음처럼 라우팅한다.

- pre-start 회차: `TournamentEnrollmentRepository.registerPreStart()`
- running + late-open 회차: 두 번째 설계의 late registration 경로
- running + closed 또는 종결 회차: 거절

`registerPreStart()`는 lifecycle만 믿지 않고 같은 enrollment transaction에서 서버 `now`와
정규화 일정 열을 다시 검사한다.

```text
공통: registrationOpensAt <= now
자동: now < startsAt
수동: now < manualStartExpiresAt
```

조건을 벗어나면 attempt·등록 행·지갑·에스크로를 전혀 바꾸지 않고 `registration-closed`를 반환한다.
스케줄러 timer가 늦어 DB가 아직 `registering/open-prestart`여도 만료 뒤 debit은 불가능하다.
만료 감지는 이어지는 scheduler tick이 멱등 취소/void owner를 획득하며, 등록 요청 자체가
그 취소보다 먼저 새 경제 책임을 만들지는 않는다.

시작 CAS를 얻은 뒤 명령 서비스가 DB 스냅샷과 등록 명단을 읽어
`TournamentManager.prepareFromInstance(snapshot, checkedInEntrants, ownerToken)`를 호출한다.
prepared runtime은 `mtt-setup` hold 아래 있으며 아직 공개·착석 projection·시계·핸드가 없다.
DB의 `running` CAS 뒤 `activatePreparedTournament(instanceId, ownerToken, actualStartedAt)`가
동일 runtime을 활성화한다. 매니저가 만드는 runtime ID는 인스턴스 ID와 같고
별도의 두 번째 토너먼트 객체를 만들지 않는다.
등록 취소·노쇼·상한 계산도 시작 전에는 DB에서만 수행한다.

`tournament_instance.id === TournamentRuntime.id === 공개 tournamentId
=== sng_entries.room_id`를 전 계층 불변식으로 둔다.
경제 계층의 `sng_entries.tournament_id`는 기존처럼 해당 에스크로 그룹의 incarnation ID이며
공개 tournament ID와 혼동하지 않는다.

공개 목록과 백오피스 상세는 pre-start 회차를 저장소에서, running 회차를 매니저에서 읽어
ID 기준으로 합친다. 이렇게 해야 메모리 runtime과 DB 등록부의 이중 정본이 생기지 않는다.

### 7.4 등록과 경제 원장의 단일 트랜잭션

`tournament_registration`과 기존 `sng_entries`를 각각 독립 repository transaction으로 쓰지 않는다.
현재 `PokerDatabase`는 nested transaction을 허용하지 않으므로,
새 `TournamentEnrollmentRepository`가 같은 DB 연결의 한 transaction에서 다음을 함께 처리한다.

```text
instance 상태·등록 상한 확인
→ wallet/seat escrow 이동 또는 환불
→ sng_entries 갱신
→ tournament_registration 갱신
→ commit
```

- 기존 `EconomyRepository.reserveMttEntry()`의 SQL 핵심은 transaction 내부에서 호출 가능한
  좁은 내부 메서드로 분리하고, 외부 공개 메서드는 계속 자체 transaction wrapper를 가진다.
- 등록 행 commit 전에는 매니저 큐나 소켓 상태를 바꾸지 않는다.
- practice는 경제 SQL이 없지만 같은 등록 transaction과 상태 가드를 사용한다.
- ack 유실 재요청은 `(instance_id, profile_id, request_id)` attempt 이력을 먼저 읽어
  저장된 reserved/seated/terminal 결과를 반환한다.
- 경제 원장만 성공하거나 등록 행만 성공하는 부분 결과는 허용하지 않는다.

현재의 5분 빈 토너먼트 TTL은 예약 회차에 적용하지 않는다.
회차 수명은 `startsAt`, `manualStartExpiresAt`, 운영자 취소로만 결정한다.
그렇지 않으면 하루 뒤 예약한 토너먼트가 시작 전에 사라진다.

### 7.5 동시 실행 상한

- 미래 DB 회차 수와 실제 게임 런타임 수를 분리한다.
- 동시에 `running`인 MTT는 현재 안전 상한 4개를 유지한다.
- 등록 중·노출 중 회차는 실행 상한에 포함하지 않고 DB에서 페이지 단위로 조회한다.
- 시작 시 실행 슬롯이 없으면 회차를 `start-delayed`로 표시하고 30초마다 재시도한다.
- 예정 `startsAt`에 도달하는 순간 신규 등록은 닫는다.
- `start-delayed` 동안 아직 시작하지 않은 등록자는 취소·전액 환불할 수 있다.
- CAS로 `starting`이 된 뒤에는 등록과 취소를 모두 잠근다.
- 각 재시도 직전 현재 등록 명단과 접속 상태를 다시 평가한다.
- 10분 이상 지연되면 자동 취소한다. wallet은 전액 환불하고 운영 이벤트를 남긴다.
- 백오피스는 템플릿 저장 시 향후 48시간의 명백한 시작 충돌을 경고하되,
  실제 종료 시각을 예측할 수 없으므로 저장 자체를 막지는 않는다.

## 8. 시작·체크인 정책

자동 또는 수동 시작 시 서버는 다음 순서로 처리한다.

1. 등록을 잠그고 중복 시작을 막는 `starting` CAS/lease를 획득한다.
   CAS 결과의 source lifecycle·registration state·reason·retry deadline을 `StartClaim`에 캡처한다.
   수동 시작 claim transaction은 `now < manualStartExpiresAt`을 함께 조건으로 검사한다.
   이미 만료됐으면 start claim을 만들지 않고 `expireManualInstance()`로 넘겨
   active wallet 경제 책임이 없으면 등록·attempt·counter와 instance를 atomic cancel하고,
   하나라도 있으면 `refund-pending`→instance-wide void를 실행한다.
2. 현재 접속 세션, 등록 명단, 다른 방·MTT active claim을 한 스냅샷으로 대조한다.
3. enrollment preflight transaction에서 실제 시작 가능한 휴먼만 `seat-claimed`로 claim하고,
   충돌한 등록자는 시작 가능 인원에서 제외한다.
4. claim된 휴먼 수와 practice 봇 충원 가능 수로 최소 시작 조건을 계산한다.
5. 운영자의 수동 시작이 최소 미달이면 같은 transaction에서 방금 만든 claim만
   `seat-claimed → registered`로 되돌리고 instance를 `StartClaim`의 정확한 source pair로 복원하며
   lease를 함께 해제한다.
   이 경로에서는 노쇼·환불·경제 원장을 전혀 바꾸지 않는다.
6. 자동 시작이 최소 미달이거나 수동 회차가 만료된 경우에만 미접속·충돌 등록자를 노쇼 처리하고
   회차를 취소한다.
   - wallet: 시작 에스크로 확정 전에 전액 환불
   - practice: 등록 행만 `no-show`로 변경
7. 시작 조건이 충족되면 미접속·충돌 등록자를 같은 방식으로 노쇼 처리하고
   claim된 휴먼 전원을 확정 체크인 명단으로 삼는다.
8. 휴먼이 `minEntrants` 이상이면 봇을 추가하지 않는다.
9. 휴먼이 최소보다 적고 practice + `botFillToMinimum=true`이면 부족분만 봇으로 채운다.
10. 휴먼이 1명도 없거나 봇 충원 후에도 최소를 만족할 수 없으면 취소한다.
11. wallet은 봇을 허용하지 않으므로 최소 미달이면 취소·전액 환불한다.
12. `initialEntrants`와 설정 스냅샷을 기록하고 테이블을 만든다.
13. 레이트 레지가 활성화된 경우 등록 창만 계속 열어 둔다.

`initialEntrants`는 시작 시 착석한 휴먼+봇 수이며 이후 변하지 않는다.
레이트 레지가 활성화된 회차의 최종 필드는 두 번째 설계에서 등록 마감 시 별도로 고정한다.

- 예약 자동 시작이 최소 인원을 만족하지 못하면 `not-enough` 취소·wallet 전액 환불한다.
- 운영자의 수동 시작 시도가 최소 인원을 만족하지 못하면 `not-enough`만 반환하고
  source가 `registering`이면 그대로 모집을 유지하고, `start-delayed`면 등록이 잠긴 지연 상태와
  기존 retry deadline을 유지한다. 위 preflight의 임시 claim 외 등록·경제 상태를 바꾸지 않는다.
- claim 획득과 인원 판정은 같은 `BEGIN IMMEDIATE` transaction에서 수행해,
  두 회차가 같은 프로필을 동시에 시작 명단에 넣지 못하게 한다.
- 수동 회차의 만료는 자동 취소이므로 인원과 무관하게 환불한다.
  practice 기본 만료는 등록 오픈 후 6시간, wallet 기본·최대 만료는 등록 오픈 후 20분이다.
- 수동 만료 timer와 scheduler tick은 callback 실행 시 `now >= manualStartExpiresAt`을 다시 검사한다.
  timer가 늦거나 운영자 수동 시작과 경합해도 expiry/start composite CAS 중 하나만 이기며,
  expiry가 이긴 뒤에는 새 등록·start claim이 모두 거절된다.

자동 시작과 등록 요청이 같은 이벤트 루프 틱에서 경합하면 서버가 먼저 처리한 명령 순서가 정본이다.
시작 락 이후 도착한 요청은 레이트 레지 조건을 만족할 때만 수용한다.

## 9. 블라인드 구조

### 9.1 프리셋

기존 세 구조를 유지하고 설정 카드에 실제 의미를 함께 표시한다.

- 스탠다드: 레벨당 8분, 충분한 플레이 시간
- 터보: 레벨당 5분, 빠른 진행
- 하이퍼: 레벨당 3분, 매우 빠른 진행

각 카드에는 시작 스택, 첫 세 레벨, 앤티 시작 레벨, 정기 브레이크 간격,
예상 레이트 레지 마감 시각을 보여준다.

### 9.2 커스텀 구조

```ts
type TournamentStructureSegment =
  | {
      kind: 'level';
      durationMs: number;
      smallBlind: number;
      bigBlind: number;
      bigBlindAnte: number;
    }
  | {
      kind: 'break';
      durationMs: number;
    };
```

- 블라인드 레벨은 최대 30개, 브레이크는 최대 8개다.
- 레벨 길이는 60초~60분이다.
- 브레이크는 60초~20분이다.
- `smallBlind > 0`, `bigBlind > smallBlind`, `bigBlindAnte >= 0`을 강제한다.
- 다음 레벨의 SB·BB는 이전 레벨보다 작아질 수 없다.
- 앤티는 해당 레벨 BB를 넘을 수 없다.
- 최소 3개 레벨이 필요하다.
- 마지막 레벨에 도달한 뒤에는 그 블라인드를 토너먼트 종료까지 유지하고 운영자에게 경고 배지를
  표시한다. 설정 화면은 충분한 레벨을 만들도록 안내한다.
- 등록이 열린 뒤 구조는 불변이다.
- 디렉터의 `set-level`은 기존 계약대로 일시정지 중에만 허용한다.

현재 `mttClockAt`의 균일한 `levelDurationMs` 계산은 세그먼트의 누적 지속 시간을 순회하는
단일 계산 함수로 교체한다. 프리셋도 같은 세그먼트 모델로 변환해 프리셋과 커스텀의 시계 경로를
하나로 유지한다.

## 10. 상금 구조

### 10.1 자금 출처

```ts
type PrizePoolPolicy =
  | { kind: 'entry-pool' }
  | { kind: 'fixed-practice'; totalPrize: number };
```

- wallet은 항상 `entry-pool`이다.
  - 총상금 = 실제 유료 참가자의 바이인 합계
  - 수수료는 총상금에 포함하지 않는다.
  - 운영자가 자금 출처 없이 임의의 보장 상금을 입력할 수 없다.
- practice는 v1에서 항상 `fixed-practice`다.
  - 1~2,000,000,000 범위의 표시용 칩이다.
  - 기본값은 `시작 스택 × minEntrants`이고 운영자가 직접 바꿀 수 있다.
  - 지갑에 입금되지 않으며 UI에 `연습용 상금`이라고 명시한다.
- wallet 보장 상금은 운영 자금 원장과 부족분 에스크로가 마련된 뒤 별도 프로젝트로 추가한다.

### 10.2 세 프리셋의 의미

세 프리셋은 입상률과 분배 성향을 함께 나타낸다.

| 프리셋 | 목표 입상률 | 성향 |
|---|---:|---|
| 상위 집중형 (`top-heavy`) | 10% | 우승·상위권 비중이 큼 |
| 표준형 (`standard`) | 15% | 기본 권장 구조 |
| 넓은 입상형 (`flat`) | 20% | 더 많은 참가자가 비교적 고르게 입상 |

입상 인원은 다음 식으로 계산한다.

```text
paidPlaces = clamp(ceil(finalEntrants × paidFieldPercent / 100), 1, finalEntrants)
```

48명 상한과 20% 입상률에서 최대 입상자는 10명이다.
`payout-table.ts`는 프리셋과 입상 인원 1~10명을 키로 하는 검수된 비율표를 사용한다.
각 행은 내림차순이고 합계가 정확히 100%여야 한다. 기존 비율표는 가능한 행을 재사용하고,
없는 입상 인원 행은 이웃 행 사이의 단조 보간으로 추가한다. v2의 정본 표는 다음과 같다.
같은 입상 인원 행이 여러 프리셋에 존재하면 1위 비율은
`top-heavy >= standard >= flat`이어야 한다.

| 입상자 수 | 상위 집중형 10% | 표준형 15% | 넓은 입상형 20% |
|---:|---|---|---|
| 1 | `100` | `100` | `100` |
| 2 | `65 / 35` | `65 / 35` | `65 / 35` |
| 3 | `50 / 30 / 20` | `50 / 30 / 20` | `50 / 30 / 20` |
| 4 | `44 / 27 / 17 / 12` | `40 / 26 / 19 / 15` | `36 / 27 / 21 / 16` |
| 5 | `42 / 24 / 15 / 11 / 8` | `38 / 25 / 16 / 12 / 9` | `34 / 24 / 18 / 14 / 10` |
| 6 | 해당 없음 | `32 / 23 / 17 / 12 / 9 / 7` | `28 / 22 / 18 / 14 / 10 / 8` |
| 7 | 해당 없음 | `30 / 21 / 15 / 11 / 9 / 7.5 / 6.5` | `27 / 20 / 16 / 12 / 10 / 8 / 7` |
| 8 | 해당 없음 | `27 / 19 / 14 / 11 / 9 / 8 / 6.5 / 5.5` | `25 / 19 / 15 / 12 / 10 / 8 / 6 / 5` |
| 9 | 해당 없음 | 해당 없음 | `22 / 17 / 14 / 12 / 10 / 8 / 7 / 6 / 4` |
| 10 | 해당 없음 | 해당 없음 | `20 / 16 / 13.5 / 11 / 9.5 / 8 / 7 / 6 / 5 / 4` |

상한 48명에서 각 목표 입상률로 도달할 수 없는 행은 `해당 없음`이며 호출 자체를 거절한다.

기존 회차와의 호환을 위해 설정 스냅샷 버전 1은 현재 필드 밴드 방식,
버전 2는 목표 입상률 방식으로 읽는다. 새 회차는 버전 2만 만든다.

정수 칩 반올림 후 남는 칩은 기존 계약대로 잔여 전부를 1위에 더해
`sum(payouts) === totalPrize`를 보장한다.

wallet 정산 저장소도 단순 `payoutPreset` 문자열만 받지 않고
`{ version, presetId, paidFieldPercent }` 스냅샷을 받는다.
저장소는 최종 참가 인원과 바이인 합계로 같은 v2 표를 다시 계산해,
매니저가 임의 금액을 넘기거나 구버전 표로 정산하는 것을 거절한다.
멱등 재호출은 설정 버전·최종 순위·상금이 모두 같을 때만 성공한다.

### 10.3 미리보기

설정 팝업과 공개 상세 화면은 같은 계산 함수를 사용해 다음을 모두 표시한다.

- 예상 또는 확정 총상금
- 예상 또는 확정 참가 인원
- 입상 인원과 전체 필드 대비 입상률
- 순위별 상금
- 순위별 총상금 대비 비율
- wallet 모집 중에는 `현재 등록 기준 예상`, 레이트 레지 중에는 `마감 전 변동 가능`
- 상금이 고정된 뒤에는 `확정`

운영 UI와 참가자 UI가 별도의 계산을 구현하지 않는다.

## 11. 백오피스 UI

### 11.1 진입

- `/admin` 토너먼트 탭 상단에 `+ 토너먼트 개설` 버튼을 둔다.
- 버튼을 누르면 데스크톱에서는 중앙 모달, 좁은 화면에서는 전체 화면 시트가 열린다.
- 현재의 긴 인라인 개설 폼은 제거한다.
- 기존 운영 중 토너먼트 목록과 디렉터 액션은 그대로 유지한다.

### 11.2 설정 순서

1. 기본 정보
2. 일정과 반복
3. 필드와 봇
4. 게임 속도와 커스텀 구조
5. 상금
6. 레이트 레지
7. 최종 검토

세 개의 대표 선택지가 있는 항목은 드롭다운 대신 카드형 라디오를 쓴다.

- 스탠다드 / 터보 / 하이퍼
- 8초 / 15초 / 30초 액션 시간
- 상위 집중 / 표준 / 넓은 입상

연속 숫자나 날짜를 라디오로 억지 변환하지 않는다.

- 최소·최대 인원: 숫자 입력 + 권장 빠른 선택
- 총상금: 숫자 입력
- 시각: 날짜·시각 입력
- 커스텀 구조: 행 편집기

### 11.3 일정 화면

- 상단 고정: `서버 현재 시각 2026-07-24 23:10:35 KST`
- 시작 방식: `지정 시각 자동 시작` / `운영자 수동 시작`
- 자동 시작 선택 시:
  - 시작 날짜·시각
  - 로비 노출 리드 타임
  - 등록 시작 리드 타임
  - 계산된 세 시각 미리보기
- 반복:
  - 없음 / 매시간 / 매일 / 매주
  - 반복 규칙에 맞는 분·시·요일 입력
  - 다음 3회차 시각 미리보기

잘못된 순서의 시각은 클라이언트에서 즉시 설명하고 서버도 동일하게 거절한다.

### 11.4 최종 검토

생성 버튼 바로 위에 다음 문장형 요약을 보여준다.

```text
7월 25일 00:00 KST 시작 · 23:30 로비 노출 · 23:40 등록 시작
최소 8명 / 최대 48명 · 연습 모드 · 최소 인원까지 봇 충원
스탠다드 8분 · 15초 액션 · 표준형 약 15% 입상
총상금 180,000 연습 칩 · 레이트 레지 2레벨
매시간 반복 · 다음 회차 01:00
```

위험하거나 모순된 조합은 생성 후 경고가 아니라 이 단계에서 막는다.

## 12. API와 권한

기존 `TournamentCommandService`를 모든 명령의 단일 경계로 유지한다.

```text
GET    /api/admin/tournaments
POST   /api/admin/tournaments
GET    /api/admin/tournament-templates
POST   /api/admin/tournament-templates
PATCH  /api/admin/tournament-templates/:id
POST   /api/admin/tournament-templates/:id/actions
POST   /api/admin/tournaments/:id/actions
```

템플릿 액션은 `enable`, `disable`, `generate-next`만 허용한다.
회차 액션은 기존 `start`, `pause`, `resume`, `set-level`, `remove-player`, `cancel`을 유지한다.

- 일반 프로필의 직접 호출은 계속 `forbidden`이다.
- 운영자 프로필과 백오피스만 개설할 수 있다.
- 권한 검사는 payload 파싱과 상태 변경·로그 기록보다 먼저 수행한다.
- 요청 본문 크기와 커스텀 구조 행 수를 제한한다.
- API는 모든 응답에 `serverNow`를 포함한다.

기존처럼 `?token=DEBUG_LOG_TOKEN`을 mutation URL에 붙이지 않는다.
URL은 브라우저 history, 프록시 로그, referrer에 남을 수 있고 현재 localStorage 보관도 XSS 노출 반경이 크다.

```text
GET    /api/admin/session
POST   /api/admin/session
DELETE /api/admin/session
GET    /api/admin/feedback
```

- 로그인 POST에서만 운영 토큰을 body로 받고 exact/constant-time 검증한다.
- 성공하면 2시간짜리 opaque admin session을 만들고
  `HttpOnly; SameSite=Strict; Secure(prod); Path=/api/admin` 쿠키로 보낸다.
- 인증된 GET은 페이지 새로고침 뒤 사용할 CSRF token과 만료 시각을 반환한다.
- 원본 운영 토큰은 쿠키·URL·localStorage·로그에 저장하지 않는다.
- 서버 재시작 시 admin session은 폐기되어 다시 로그인한다.
- session에는 별도 CSRF token을 두고 mutation은 `X-CSRF-Token`과 exact same-origin 검사를 모두 요구한다.
- 로그인은 IP당 5회/10분, admin mutation은 session당 30회/분으로 제한한다.
- 일반 운영자 프로필의 소켓 권한과 backoffice admin session은 별도 주체로 유지한다.
- `/api/admin/session` POST는 기존 admin session gate의 유일한 예외이며 자체 로그인 rate limit을 탄다.
- 현재 문의 탭은 `/api/debug/feedback?token=...`을 호출하므로 새 session-auth
  `/api/admin/feedback`으로 옮긴다. 기존 debug endpoint는 운영 호환용으로 유지하되 `/admin` UI는 쓰지 않는다.

### 12.1 공개 프로토콜 projection

내부 DB 상태 문자열을 기존 4값 `TournamentPhase`에 억지로 접지 않는다.

```ts
type PublicTournamentLifecycle =
  | 'upcoming'
  | 'registering'
  | 'start-delayed'
  | 'starting'
  | 'running'
  | 'refund-pending'
  | 'completed'
  | 'cancelled';

interface PublicTournamentSchedule {
  visibleAt: number;
  registrationOpensAt: number;
  scheduledStartsAt: number | null;
  manualStartExpiresAt: number | null;
  actualStartedAt: number | null;
}

interface PublicTournamentStructure {
  sourcePresetId: 'standard' | 'turbo' | 'hyper' | null;
  startingStack: number;
  segments: TournamentStructureSegment[];
  currentSegmentIndex: number | null;
  currentSegmentEndsAt: number | null;
}

interface PublicTournamentPayout {
  tableVersion: number;
  presetId: 'top-heavy' | 'standard' | 'flat';
  paidFieldPercent: 10 | 15 | 20;
  status: 'provisional' | 'final';
  totalPrize: number;
  payouts: Array<{ place: number; percent: number; amount: number }>;
}
```

`TournamentSummary`와 `TournamentDetail`은 공통으로 다음을 가진다.

- `lifecycle`, 제한된 `statusReason`
- 두 번째 설계의 `registrationState`, `registrationCloseReason`, `lateRegistrationClosesAt`
- 위 다섯 일정 시각. 자동 회차는 `scheduledStartsAt != null && manualStartExpiresAt == null`,
  수동 회차는 `scheduledStartsAt == null && manualStartExpiresAt != null`이다.
- `minEntrants`, `maxEntrants`, `initialEntrants`, `acceptedEntrants`,
  `pendingLateEntrants`, `aliveSeated`, `finalEntrants`
- 구조·상금 버전과 공개 projection
- 개인화 `myRegistrationStatus`, `mySeat`, `canRegister`, `canCancelRegistration`

`canRegister`와 백오피스의 수동 시작 가능 여부도 lifecycle 문자열만으로 계산하지 않고
응답의 `serverNow`와 위 deadline을 적용한다. timer가 늦은 짧은 구간에도 만료 회차의 버튼은 비활성이다.

기존 `phase` 필드는 한 배포 동안 deprecated adapter로 유지한다.

| lifecycle | legacy phase |
|---|---|
| `upcoming|registering|start-delayed|starting` | `registering` |
| `running|refund-pending` | `running` |
| `completed` | `completed` |
| `cancelled` | `cancelled` |

새 UI는 adapter를 읽지 않는다. 다음 호환 배포에서 `phase`를 제거한다.
기존 단일 `levelDurationMs`는 프리셋 요약용 optional 파생값으로만 남기고,
상세·시계는 항상 `segments`와 `currentSegmentEndsAt`을 읽는다.

`scheduled-hidden`은 백오피스에만 보인다. `starting`은 `시작 준비 중`,
`refund-pending`은 개인 등록자와 백오피스에 `환불 처리 중`으로 계속 노출하고,
active claim이 남아 있으면 다른 지갑 게임 잠금이 환불 성공까지 유지된다는 안내와 운영 경보를 함께 보여준다.
공개 일반 목록의 completed/cancelled 회차는 기존처럼 10분 뒤 숨기되 DB·백오피스 보존은 유지한다.

## 13. 재시작 복구

기존 `recoverIncompleteSngEntries()`는 모든 active SnG/MTT 행을 환불하므로 그대로 먼저 호출하면
보존해야 할 예약 회차의 wallet 등록까지 지워진다. 복구 API를 다음처럼 분리한다.

```ts
recoverIncompleteEntries({
  preserveReservedMttEntries: ReadonlyMap<
    string,
    ReadonlyMap<string, {
      economyEntryAttempt: number;
      buyIn: number;
      fee: number;
    }>
  >,
  deferToMttVoidInstanceIds: ReadonlySet<string>,
}): RecoveryResult;
```

- 바깥 key는 공개 instance/tournament ID이며 `sng_entries.room_id`와 비교한다.
  `sng_entries.tournament_id`는 공개 ID가 아니라 경제 incarnation ID다.
- DB에 `scheduled-hidden|scheduled-visible|registering|start-delayed`로 존재하고 설정이 유효하며,
  수동 회차라면 `now < manual_expires_at`이고,
  profile ID·`economy_entry_attempt`·buy-in·fee가 등록부와 정확히 일치하는 `reserved` 행만 보존한다.
- generic recovery는 `deferToMttVoidInstanceIds`의 어떤 경제 행도 개별 환불하지 않는다.
  이 집합은 아래 instance-wide `voidMttTournament()`만 소유한다.
- `starting|running|refund-pending` 회차는 라이브 게임 복구가 불가능하다.
  - active wallet 경제 행이 있으면 먼저 `refund-pending/closed`로 CAS하고 defer 집합에 추가
  - active wallet 경제 행이 없으면 instance, 등록 행·attempt, pending counter를
    한 transaction에서 `cancelled`로 정리
- 유효 회차 안이라도 allowlist에 없는 취소·노쇼·등록행 없는 고아 에스크로는 환불한다.
- SnG 복구 계약은 변경하지 않는다.
- `RecoveryResult`는 회차별 `{ refunded, failed, preserved }` 수를 반환한다.
  `failed>0`인 회차는 `refund-pending`에 남고, 전부 성공한 회차만 `cancelled`로 전이한다.

서버 시작 시 다음 순서로 조정한다.

1. DB 마이그레이션
2. 회차·등록·경제 행을 함께 읽고 한 `BEGIN IMMEDIATE` 분류 transaction에서:
   - 유효 pre-start reserved 행의 exact preserve map 생성
   - `starts_at IS NULL AND now >= manual_expires_at`인 만료 수동 회차는 preserve에서 제외하고,
     active wallet 책임이 없으면 economy mode와 무관하게 등록/attempt/claim/counter와 함께 atomic cancel,
     하나라도 있으면 `refund-pending/closed` CAS 뒤 defer 집합에 추가
   - active wallet 책임이 있는 `starting|running|refund-pending`과 invalid-config 회차를
     `refund-pending/closed`로 CAS하고 defer 집합 생성
   - wallet 책임이 없는 active practice 회차를 등록 claim/counter와 함께 atomic cancel
3. generic `recoverIncompleteEntries`에 preserve map과 defer 집합을 모두 넘겨,
   SnG와 어떤 유효/보류 MTT에도 속하지 않는 고아 행만 기존 정책으로 복구
4. defer 집합의 각 MTT는 `voidMttTournament()` 한 transaction으로
   `reserved|started` 경제 행, 등록/attempt, counters, instance를 함께 환불·종결
5. 환불 실패 회차는 `refund-pending`과 active claim을 유지하고 다음 startup/tick에 재시도
6. 템플릿에서 미래 회차 멱등 생성
7. pre-start 회차와 등록 명단 재구성
8. HTTP·Socket.io 수신 시작
9. 시작 시각을 놓친 회차에는 60초 재접속 체크인 유예 적용
10. 유예 후 현재 시각과 접속 세션을 기준으로 시작 또는 취소
11. 정상 스케줄러 루프 시작

재시작 시각이 예약 시각을 지난 경우:

- 10분 이내 지연이면 소켓 수신 후 60초 동안 기존 등록자의 재접속을 기다린다.
- 이 유예는 `start-delayed` + `status_reason='restart-checkin-grace'`로 표시하고
  신규 등록은 받지 않는다. 아직 `starting`이 아니므로 기존 등록자는 취소·환불할 수 있다.
- 유예 종료 뒤 최소 시작 조건을 만족하면 즉시 시작한다.
- 최소 조건을 만족하지 않으면 일반 미달 정책으로 취소·환불
- 10분을 넘겼으면 `missed-start`로 취소·환불

진행 중 MTT의 전체 핸드·덱·타이머 복구는 이번 범위가 아니다.
프로세스 재시작에서 `running` 인스턴스를 발견하면 현재 안전 계약대로
`server-restart-unrecoverable` 취소로 확정한다. active wallet 경제 행이 있으면 참가비를 멱등 환불하고,
없으면 등록 claim과 카운터를 원자적으로 닫아 practice 사용자를 잠그지 않는다.
부분 상태를 추측해 경기를 재개하지 않는다.

### 13.1 상태 전이의 CAS와 보상

여러 스케줄러 tick이나 운영자 명령이 같은 회차를 처리해도 한 경로만 소유권을 얻어야 한다.

스케줄러는 `BEGIN IMMEDIATE` transaction 안에서 다음을 함께 처리한다.

1. `status IN ('starting','running')`인 회차 수가 4 미만인지 검사
2. 대상이 `registering|start-delayed`이고 시작 조건을 만족하는지 재검사
3. 대상 한 행을 `starting`으로 CAS
4. `start_attempt+1`, 프로세스별 `start_owner_id`, 30초 `start_lease_until` 기록

슬롯 검사와 target CAS를 서로 다른 transaction으로 나누지 않는다.
따라서 두 due 회차가 동시에 `running<4`를 보고 모두 다섯 번째 슬롯을 차지할 수 없다.
변경 행이 1개일 때만 시작 saga를 수행한다.

```text
starting 기록
→ enrollment preflight: 좌석 claim·최소 인원 판정·노쇼 정리
→ wallet start escrow
→ mtt-setup(ownerToken) hold 아래 모든 테이블 무방송 생성·초기화
→ 전체 방/좌석/칩/설정 불변식 검증
→ 초기 full/stack-floor/bubble 조건과 immutable startup freeze plan 계산
→ starting/locked-for-start → running/(open-late 또는 closed)
   + exact checked-in attempts의 seat-claimed → seated/ever_seated=1
   + actualStartedAt + initial/committed counters
   + ever_multi_table=(prepared table count >= 2) 단일 enrollment transaction
   + closed이면 final_entrants와 versioned payout freeze 동시 기록
→ actualStartedAt 기준 시계·lateRegTimer·level/break timer 무장
→ 세션 room projection + 방/목록 최초 broadcast
→ owner가 일치하는 mtt-setup hold 해제 + 첫 핸드 예약
```

- `starting` 전에 방이나 경제 원장을 변경하지 않는다.
- prepared runtime은 DB가 아직 `starting`인 동안 다음을 전부 금지한다.
  - `onSeated`/session `roomId` projection
  - `game-update`, `tournament-update`, room-list broadcast
  - 블라인드·브레이크·레이트 레지 timer와 bot/player loop
  - 첫 핸드 및 다음 핸드 예약
- `mtt-setup` hold는 `(reason, ownerToken)`으로 소유하며 다른 cleanup이나 stale start가 풀 수 없다.
- `running` CAS가 반환한 단일 `actualStartedAt`을 모든 테이블 시계의 epoch로 사용한다.
- checked-in 등록 행·attempt 중 하나라도 예상 `seat-claimed`/attempt와 다르면
  instance running 전이와 전체 등록 갱신을 rollback하고 prepared runtime을 활성화하지 않는다.
- CAS/lease가 실패하면 prepared 방을 모두 `disposeRoom('mtt-start-rollback')`하고,
  practice는 취소, wallet은 `refund-pending`에서 `voidMttTournament()`를 수행한다.
- `running` CAS 뒤 activation이 실패해도 setup hold를 유지한 채 한 번 재시도하고,
  계속 실패하면 플레이를 시작하지 않고 같은 전체 안전 취소 경로를 탄다.
- wallet 확정 뒤 방 생성이 실패하면 `refund-pending`으로 전이하고 생성된 방을 모두 정리한 뒤
  `voidMttTournament()`를 재시도한다.
- 환불이 완료되기 전에는 `cancelled`로 표시하지 않는다.
- `refund-pending`은 지수 백오프로 계속 재시도하며 운영 경보를 남긴다.
- 재시작에서 발견한 `starting`도 같은 보상 경로를 탄다.
- 살아 있는 프로세스의 watchdog도 `start_lease_until < now`인 stale `starting`을 발견하면
  부분 시작 여부를 추측하지 않고 경제 책임을 조회한다.
  active wallet 행이 없으면 등록/attempt/claim/counter와 instance를 한 transaction에서 `cancelled`,
  하나라도 있으면 `refund-pending`으로 보낸 뒤 전체 `void`한다.
- 정상 saga는 긴 단계 전에 lease를 연장하고 `running` 전이에서 owner/lease를 null로 지운다.
- practice는 경제 단계가 없지만 같은 CAS와 방 정리 계약을 사용한다.
- 180일 정리는 `completed|cancelled`만 대상으로 하며 `refund-pending`은 절대 삭제하지 않는다.

## 14. 운영 이벤트

다음 이벤트를 `ops_event` 허용 목록에 추가한다.

- `mtt-template-create`
- `mtt-template-update`
- `mtt-instance-generate`
- `mtt-registration-open`
- `mtt-start-delayed`
- `mtt-scheduled-start`
- `mtt-scheduled-cancel`
- `mtt-scheduler-reconcile`

이벤트에는 토너먼트/템플릿 ID, 예정 시각, 실제 처리 시각, 설정 버전,
권한 주체 종류, 결과·오류 코드를 기록한다. 인증 토큰과 세션 토큰은 기록하지 않는다.

## 15. 실패 처리

- 중복 회차 생성: DB 유일성 제약을 성공으로 간주하고 기존 ID 반환
- 설정 JSON 손상: 자동 시작 금지. wallet 경제 행이 없으면 등록 취소 후 즉시 `cancelled`;
  경제 행이 있으면 `refund-pending`에서 행별 원금 전액 환불 후 `cancelled`
- 실행 슬롯 부족: 최대 10분 `start-delayed`, 이후 취소·환불
- 테이블 생성 일부 실패: 생성된 방을 `disposeRoom()`으로 되돌리고 회차 취소
- wallet 시작 에스크로 실패: 방을 만들지 않고 `refund-pending`으로 전이해 전체 취소·환불
- 템플릿 비활성화: 미래 생성만 중지, 기존 회차 불변
- 스케줄러 중복 실행: 인스턴스 상태 비교·갱신과 유일성 제약으로 멱등

## 16. 필수 테스트

테스트를 위한 별도 제품 코드는 만들지 않는다. 다음 회귀만 추가한다.

1. v27/v28 마이그레이션과 STRICT/부분 유일성/status×registration composite CHECK
2. 시간·일·주 반복 경계, 긴 visible lead를 덮는 horizon, 동일 reconcile 멱등성
3. 템플릿 PATCH의 recurrence 변경, hidden 교체, visible 구회차 점유, revision 충돌,
   operator-cancelled tombstone 재생성 방지
4. 서버 재시작 뒤 노출·등록·예약 시작 및 등록 명단 복구
5. exact recovery preserve/defer 집합이 pre-start를 보존하고 active MTT 경제 행의 개별 환불을 막으며,
   orphan·no-show·wrong attempt·금액 불일치는 올바른 generic/instance-wide 경로로만 환불
6. 예약 시각을 놓친 10분 이내 재접속 유예·시작과 10분 초과 취소
7. `visibleAt <= registrationOpensAt <= startsAt`, wallet 자동 등록 리드 최대 20분,
   수동 wallet 정상 등록·에스크로 창도 최대 20분이며 만료 시 전액 환불,
   환불 장애에서는 `refund-pending` active claim과 잠금이 유지되고 UI·운영 경보가 이를 표시,
   공개 `manualStartExpiresAt`으로 로비 카운트다운이 재시작·시계 보정 뒤에도 동일,
   timer 지연 뒤 등록·수동 start transaction은 deadline 재검사로 debit/start를 거절
8. running 3개에서 due 회차 2개 동시 claim 시 `starting+running <= 4`
9. stale starting lease watchdog과 단계별 crash 보상
10. running CAS 전 prepared 방이 session/broadcast/timer/hand를 시작하지 않고,
    exact seat-claimed attempts만 seated로 바꾸며 CAS·activation 실패가 전 방 dispose와 wallet void로 끝남
11. 최소 8명/상한 48명에서 휴먼 5명일 때 봇 3명만 충원
12. 최소 이상 휴먼은 봇 없이 전원 수용
13. 겹친 practice 예약은 실제 seat claim 한 개만 성공하고 다른 회차는 노쇼
14. 기존 cash/arena/seat-waiter가 있는 프로필의 start claim·late 등록 거절
15. wallet 인원 미달·invalid config·재시작 시 발견한 만료 수동 회차의 instance-wide 환불과
    환불 실패 시 `refund-pending` 유지, HTTP 수신 전 expired 회차가 preserve되지 않으며
    active 경제 행이 없는 wallet 수동 회차는 direct atomic cancel
16. 상품 상수가 바뀐 배포에서도 기존 `productVersion/buyIn/fee`로 start·settle
17. 수동 not-enough가 임시 seat claim까지 되돌리고 노쇼·경제 상태를 바꾸지 않은 채
    source `registering` 또는 `start-delayed` pair/retry deadline을 정확히 복원
18. 커스텀 세그먼트 누적 시계, 브레이크, 마지막 레벨
19. 새 상금 표의 입상률·내림차순·100%·정수 총합과 같은 입상 인원에서 프리셋별 1위 비율 순서
20. admin login 만료, HttpOnly cookie, CSRF, Origin, rate limit, 무권한 명령 거절
21. 공개 lifecycle/registration/custom segments의 legacy adapter
22. 관련 Vitest, `npx tsc --noEmit`, `npm run lint`, `npm run build`

브라우저 픽셀 비교용 페이지나 테스트 전용 UI는 만들지 않는다.

## 17. 구현·활성화 순서

한 기능 배치 안에서도 장애 반경을 줄이기 위해 다음 게이트 순서로 구현한다.

1. v27/v28 영속화, enrollment transaction, admin session, 공개 protocol adapter
2. 스케줄러·단발/반복 회차·재시작 reconcile
3. 개설 모달, 상금 v2 표시, 커스텀 구조 시계
4. practice 레이트 레지의 한 명 착석과 provisional 순위
5. practice 다중 배치·새 테이블·closing barrier
6. wallet late reserve/commit/refund와 전체 정산
7. 기존 회귀+빌드+브라우저 실제 흐름 검증 후 기능 플래그 활성화

중간 게이트에서 테스트가 실패한 상태로 다음 경제 단계로 넘어가지 않는다.
`MTT_SCHEDULER_V2_ENABLED`, `MTT_LATE_REG_ENABLED`, `MTT_WALLET_LATE_REG_ENABLED`은
구현 중 기본 off이며 각 경로가 완성된 뒤 최종 배포에서 순서대로 켠다.
이는 기능을 후속 과제로 미루는 것이 아니라 같은 승인 범위를 안전하게 완성하는 전달 순서다.

## 18. 완료 기준

- 운영자가 팝업 하나에서 일정·필드·구조·상금을 이해하고 개설할 수 있다.
- 매시간 템플릿은 다음 회차를 중복 없이 자동 생성한다.
- 서버 재시작 뒤 예약과 등록 명단이 복구된다.
- 봇은 practice 최소 인원까지만 채우며 wallet에는 절대 들어가지 않는다.
- 모든 공개 화면이 같은 상금 계산으로 금액과 비율을 표시한다.
- 예약 회차가 기존 5분 빈 토너먼트 TTL 때문에 사라지지 않는다.
- 레이트 레지 설계가 사용할 독립 시각·필드·설정 스냅샷 기반이 마련된다.
