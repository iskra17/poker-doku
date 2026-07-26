# 레이트 레지스트레이션 배선 계획 (2026-07-26 QA P0-1)

## 결함 요약
영속(v2) MTT에서 `lateRegistration.enabled=true`면 `registrationState`가 영원히 `open-late`에
머물러 `checkCompletion()`(`tournament-manager.ts:2577-2587`)이 완료를 영구 거부한다.
결과: 토너먼트 미완료·정산 미실행·상금 미지급, 지각 등록자 영구 정체, 탈락자 화면 정지
(잠정 탈락 분기라 `finishPlace` 미설정 + `room-lost` 미발송).

원인은 **드라이버(호출부) 부재**다. 상태기계와 포트는 이미 다 있는데 아무도 구동하지 않는다.

## 조사 결론 — 무엇이 있고 무엇이 없나

**있음(수정 불필요)**
- `LateRegistrationCoordinator` 상태기계 전체 (`late-registration-coordinator.ts`)
- 코디네이터가 요구하는 포트 10종 전부 (`tournament-manager.ts:3156-3227`)
- `transferMttSeatsBatch` 원자적 저널 (`room-manager.ts:1148`)
- 순수 함수 `planLateRegistrationSeating`, `evaluateRegistrationClose`, `lateRegistrationClosesAt`
- ops 이벤트 화이트리스트(`mtt-late-reg-close`/`-batch`/`-seat`/`-refund`, `mtt-payout-freeze`)
- 취소·환불 전이 `releaseLateMttEntry` (`tournament-enrollment-repository.ts:595`)

**없음(구멍 3개)**
1. **마감 판정·클레임 드라이버** — `evaluateRegistrationClose`/`claimRegistrationClose`를 부르는
   프로덕션 코드가 0개. 토너먼트 단위 tick 타이머 자체가 없다.
2. **좌석 배치 어댑터** — `planLateRegistrationSeating`에 넘길 좌석별 `nextBigBlindOrder`를
   라이브 테이블에서 만드는 코드가 없다.
3. **미착석 late-pending 목록 조회** — `releaseLateMttEntry`는 있는데 `LateEntryKey`를
   얻을 읽기 메서드가 없다.

**강제 조건**: `persistTournamentPayoutFreeze`가 `pending_late_entrants = 0`을 CAS 조건으로
요구한다(`tournament-recovery-service.ts:203, 266`). 즉 **미착석 late-pending을 남긴 채로는
마감 자체가 불가능**하다. "닫기만 하고 나중에 처리" 축소안은 물리적으로 성립하지 않는다.

**함정**: 기존 공개 메서드 `adoptLateRegistrationClosing()`(`:3578`)은 hold만 조작하고 코디네이터
상태를 안 건드린다. 이걸 쓰면 `finishLateRegistration`의 `runCallback`이 항상 false를 반환한다.
드라이버는 반드시 `coordinator.adoptClosingProjection()`을 경유해야 한다.

## 단계 구분

### Stage 0 — "마감은 반드시 된다" (P0 수정 범위, 이번 커밋)
등록 창을 확실히 닫아 토너먼트가 정상 완주하게 만든다. 미착석 지각 등록자는 **취소·환불**하고
세션 잠김을 풀어 로비로 안내한다.

- 파일 3개, 프로토콜 변경 0, 클라이언트 계약 변경 0, 기존 공개 API 시그니처 변경 0
- 교착·정산 미실행·`finishPlace` 미설정·`room-lost` 미발송이 전부 해소된다
- **한계**: 지각 등록자가 실제로 착석하지는 못한다("등록 → 환불"). 그래서 개설 폼의
  레이트 레지 기본값을 "없음"으로 내린다 — 운영자가 의식적으로 켤 때만 쓰이도록.

구현 요소:
1. `TournamentEnrollmentRepository.listPendingLateEntries(tournamentId)` 추가
   (`listStartingCandidates` 패턴 승계 — `makeKeyFromRows` + `requireAttempt` 재사용)
2. `PersistentLateRegistrationPorts`에 **옵셔널** 메서드 3종 추가
   (`claimRegistrationClose` / `listPendingLateEntries` / `releaseLateMttEntry`).
   옵셔널이므로 미주입 시 드라이버 자동 비활성 — 기존 테스트 더블 안전.
3. `PersistentLateRegistrationInstance`에 옵셔널 `pendingLateEntrants` / `committedEntrants`
4. `TournamentRuntime`에 `lateRegPolicy` / `structureSegments` / `lateRegClosesAt` /
   `lateRegTimer` / `lateRegClosing` / `everMultiTable` / `previousEffectiveRemaining`
5. `TournamentRuntimeHooks.onLateRegistrationReleased?` 추가 → 소켓 계층이 세션
   `tournamentEngagement`를 풀고 `room-lost` 안내
6. 매니저 private 4종:
   - `armLateRegistrationClock(t)` — 절대 벽시계 `lateRegistrationClosesAt` 기준 타이머
     (일시정지 보정 없음 — `reserveLateMttEntry`가 같은 절대값으로 등록을 컷오프하므로
     pause-aware로 만들면 "등록은 거부되는데 마감은 안 되는" 새 불일치가 생긴다)
   - `maybeCloseLateRegistration(t)` — `evaluateRegistrationClose` 호출, throw는 삼키고 ops 로그
   - `claimLateRegistrationClose(t, reason)` — DB CAS → `coordinator.adoptClosingProjection`
   - `tryFinishLateRegistrationClose(t)` — 전 테이블 유휴일 때 drain(환불) → `finishLateRegistration`
7. 삽입점: `activatePreparedTournament`(무장), `onHandComplete`(판정·드레인),
   `cancelTournament`/`shutdown`/완료(타이머·잔여 정리)

### Stage 1 — 실제 착석 (후속, 이번 커밋 범위 밖)
`planLateRegistrationSeating` 입력 어댑터(좌석별 `nextBigBlindOrder` 유도)와
`seatPendingLateEntrants(t)` 구현. 신규 순수 모듈
`src/lib/tournament/late-registration-seat-order.ts` + `commitSeating` 경유 배치.
`transferMttSeatsBatch`가 전 테이블 유휴를 요구하므로 "hold 설치 후 다음 핸드 경계 1회만 시도,
실패 시 즉시 finish로 hold 해제" 정책을 권장한다.

## 계약 준수
- **소유권 분리**: 마감 판정·CAS·freeze·환불은 전부 `TournamentManager`. `RoomManager`는
  기존 `onHandComplete`/`checkNextHandGate` 훅만 사용하고 코드 추가 없음. 엔진 무수정.
- **핸드 경계 위임**: 타이머는 DB close CAS + hold 설치까지만. 실제 drain/freeze/resume은
  "전 테이블 유휴" 확인 후에만.
- **hold/배리어**: `adoptClosingProjection`이 새 fence를 먼저 걸고 구 owner를 나중에 해제하는
  no-start-gap 규약을 그대로 탄다.
- **DB가 durable authority**: 런타임은 미러. freeze 실패 시 hold 유지 + 유한 재시도(fail-closed).

## 주의할 기존 테스트
- `mtt-rollout.test.ts:187-204` — "late reg면 close를 스킵한다"는 그대로 둔다(드라이버가 생기며
  비로소 옳은 동작이 된다). `commitPersistentRunningRegistrationPolicy`는 건드리지 않는다.
- `tournament-manager.freeroll.test.ts` — `finishLateRegistration`을 직접 호출한다.
  **이 함수의 전제조건을 바꾸지 말 것.** drain은 새 private 안에서만.
- `tournament-manager.late-registration.test.ts` — 포트 더블이 2개 메서드만 제공.
  신규 포트는 전부 옵셔널이어야 한다.
- `tournament-manager.sim.test.ts` — fake timer 간섭 방지를 위해 무장 조건을
  `t.persistent && 포트 주입 && lateRegPolicy.enabled && registrationState==='open-late'`로 엄격히.
