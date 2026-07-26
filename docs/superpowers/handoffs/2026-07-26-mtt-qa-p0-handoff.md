# 2026-07-26 세션 인계 — 토너먼트 QA와 P0 3건

날짜: 2026-07-26 KST (앞선 같은 날 세션 `2026-07-26-session-handoff.md`의 후속)
저장소: `C:\code\claude\poker-doku` (main 직접 작업 → 이번엔 worktree 경유)
프로덕션: `poker-doku.fly.dev` — **Fly v70**, HEAD `d6e1210`
로컬 main = 배포본. 워킹 트리 깨끗(`qa-tmp/`는 gitignore).
**origin push는 하지 않았다** — 이 커밋의 유일한 사본은 로컬과 Fly 이미지다.

## 이번 세션에서 한 것

1. **토너먼트 기능 멀티 페르소나 QA** — 에이전트 10명(참가자 6·감사자 1·브라우저 UX 1·
   Codex 코드리뷰 1·반증 검증 1)을 로컬 프로덕션 빌드에 투입해 실제 토너먼트를 개설·등록·플레이.
2. **P0 3건 발견 → 같은 날 수정·배포** (v70).

## 배포된 수정 (v70, 커밋 `d6e1210`)

세 P0의 뿌리가 하나다: **영속 v2 전환에서 일부 경로가 v1 인메모리에 남아 있었다.**
엔진·회계·보안은 QA에서 전부 건강하다고 확인됐다(팟 불변식 위반 0, 침투 시도 전량 차단).

| # | 결함 | 수정 |
|---|---|---|
| P0-1 | 레이트 레지 **드라이버 부재** → `registrationState`가 영원히 `open-late` → `checkCompletion`이 완주 영구 거부 → 정산·상금 미실행, 탈락자 화면 정지(잠정 탈락 분기라 `finishPlace` 미설정·`room-lost` 미발송) | 마감 드라이버 신설(절대 벽시계 타이머 + 핸드 경계 판정 → `adoptClosingProjection` 경유 마감 → 미착석 late-pending 취소·환불 → freeze) |
| P0-2 | 디렉터 `cancel`이 인메모리 성공 시 early-return → 라이브 토너는 영속 경로 미도달 → DB `running` + 에스크로 잠김. 운영자는 라이브 목록에서 사라진 것만 보고 취소된 줄 안다 | `act()`가 두 경로를 **모두** 수행. 인메모리 성공은 영속 실패로 뒤집지 않음 |
| P0-3 | `get-tournament`가 인메모리만 조회 → 시작 전 토너는 항상 `room-not-found` → 클라가 "종료되어 정리되었습니다" 표시. 등록 버튼이 상세 모달에만 있어 **로비 등록 자체가 불가능** | 목록과 **같은 공개 투영**으로 상세 구성하는 폴백 추가 |

부수 변경: 개설 폼 `lateLevels` 기본값 `2 → 0`.

## 되돌리면 안 되는 결정

- **`checkCompletion`의 `registrationState !== 'closed'` 게이트를 완화해 P0-1을 "해결"하지 말 것.**
  그 게이트는 정산 일관성을 지킨다. 마감을 실제로 구동하는 것이 옳은 수정이다.
- **마감 시각은 절대 벽시계** (`lateRegistrationClosesAt`, 일시정지 보정 없음).
  `reserveLateMttEntry`가 같은 절대값으로 등록을 컷오프하므로, pause-aware로 바꾸면
  "등록은 거부되는데 마감은 안 되는" 새 불일치가 생긴다.
- **`persistTournamentPayoutFreeze` CAS가 `pending_late_entrants = 0`을 요구한다.**
  따라서 "등록만 닫고 late-pending은 나중에"는 물리적으로 불가능하다. 반드시 드레인이 먼저다.
- **`adoptLateRegistrationClosing()`(hold만 조작)을 드라이버에서 쓰지 말 것.**
  코디네이터 상태를 안 건드려서 `finishLateRegistration`의 `runCallback`이 항상 false가 된다.
  `coordinator.adoptClosingProjection()`을 써야 한다.
- **`finishLateRegistration`/`beginLateRegistrationOperation`/`commitLateRegistrationSeating`의
  시그니처·전제조건 불변.** 기존 테스트가 직접 호출한다. 드레인은 새 private 안에서만.
- **목록과 상세는 같은 `legacyPhase` 매핑을 공유해야 한다.** 각자 구현하면 P0-3 비대칭이 재발한다.

## 다음에 할 일 (우선순위 순)

### 1. Stage 1 — 지각 등록자 실제 착석 (P1)
지금은 "등록 → 마감 시 취소·환불"이다. 계획서 `docs/plan-latereg-wiring.md`에 상세가 있다.
필요한 것 두 가지:
- 신규 순수 모듈로 좌석별 `nextBigBlindOrder`(0..5 유일) 유도 —
  `PokerEngine.predictNextBigBlindId()`의 앵커 로직을 재사용하되 엔진은 수정하지 말고
  `state` 스냅샷만 읽는 순수 함수로.
- `seatPendingLateEntrants(t)` — `planLateRegistrationSeating` → `coordinator.commitSeating`.
  `transferMttSeatsBatch`가 **모든 영향 테이블의 유휴**를 요구하므로
  "hold 설치 후 다음 핸드 경계 1회만 시도, 실패 시 즉시 finish로 hold 해제" 정책 권장.
완료 전까지 개설 폼 기본값은 0으로 유지할 것.

### 2. v1 인메모리 잔재 전수 점검 (P1)
`tournamentManager`(인메모리)를 직접 호출하는 소켓 핸들러·명령 경로를 전부 훑어라.
이번에 같은 패턴이 **넷** 나왔다(P0-2, P0-3, 그리고 아래 둘). 더 있을 가능성이 높다.
- **`unregister-tournament`가 v2를 인식하지 못한다** (`socket-handler.ts:3182` 부근).
  DB에 등록이 실재해도 "등록 내역이 없어요"로 거부 → **v2 토너먼트는 등록 취소가 불가능하다.**
  QA에서 시작 전 `registered`·`late-pending` 양쪽 모두 재현됨. 미수정.
- 상세 모달이 못 뜨던 것과 같은 뿌리라 P0-3 폴백 패턴을 그대로 적용하면 된다.

### 3. QA에서 나온 나머지 (미수정, `qa-tmp/mtt-qa/reports/SUMMARY.md` 참조)
- P2: 노쇼 당사자가 상세에서 이유를 못 본다(목록엔 `myRegistrationStatus:'no-show'`가 있는데 상세엔 없음)
- P2: `mtt-table-break` 감사 이벤트 누락(테이블 통합 시점을 사후 재구성 불가)
- P2: 재등록이 `already-entered`가 아니라 `other-tournament`로 오분류(전자는 죽은 값)
- P2: 개설 실패 시 어느 필드가 문제인지 알 수 없음 — 파서는 구분해 던지는데
  command service가 `invalid-payload` 하나로 평탄화한다. 서버가 `issues[{path,code,message}]`를
  주고 클라가 필드에 매핑하는 것이 정공법
- P3: 어드민 API `live.economyMode`가 레거시 `"practice"` 노출

### 4. 개설 폼 UX 개편 (사용자 요청, 미착수)
사용자 원 불만 두 가지가 코드로 재현 확인됐다.
- 배경 클릭·ESC·✕가 모두 같은 `onClose`로 수렴해 확인 없이 폼을 언마운트하고,
  입력값은 폼 로컬 `useState`에만 있어 초안이 어디에도 없다. **제출 중에도 닫기가 살아 있어
  중복 개설 위험**(`requestId`가 마운트마다 새로 생성됨).
- 7단계 위저드에 이전 입력이 안 보인다. 실제 입력 22~34개 중 기본값 그대로 둬도 되는 것이
  대부분이고, 1단계는 입력이 2개뿐인데 모달 대부분이 빈 공간이다.
권고안(Codex 리뷰 + 브라우저 QA 합의): **위저드 폐기 → 조건부 섹션형 단일 스크롤 폼**.
순서 의존성이 실제로 있는 곳은 셋뿐(economyMode → 봇·상금 표시, 자동/수동 → 반복 노출,
customStructure → 스택·레벨시간). dirty일 때만 닫기 확인 + busy 중 닫기 차단 +
백오피스는 versioned localStorage 초안. 상세는 `qa-tmp/mtt-qa/reports/SUMMARY.md`와
`reports/codex-form-review.md`.

## QA 인프라 (재사용 가능, `qa-tmp/mtt-qa/` — gitignore)

| 파일 | 용도 |
|---|---|
| `QA-BRIEF.md` | 에이전트 공용 브리프(환경·도구·보고 형식·개설 페이로드 함정) |
| `player-cli.mjs` | 소켓 클라이언트 — 등록/취소/자동플레이/강제 끊김/폴링 |
| `admin-cli.mjs` | 백오피스 HTTP — 로그인·기금·개설·디렉터 명령 |
| `db-query.mjs` | QA DB 직접 조회 |
| `mtt-helper.mjs` | 공용 소켓 헬퍼(connect/emitAck/waitFor/autoplay) |
| `verify-latereg.mjs` | **P0-1 라이브 검증** — 레이트 레지 토너 완주·환불·잠김 해제 확인 |
| `admin-proxy.mjs` | 브라우저용 프록시(3002) — `x-forwarded-proto` 주입 |
| `reports/SUMMARY.md` | 종합 QA 리포트 |
| `reports/*.md` | 에이전트별 원본 리포트 10건 |
| `reports/shots/` | 브라우저 스크린샷 9장(개설 모달 소실 재현 포함) |

### 로컬 프로덕션 기동 함정 3종 (다시 겪지 말 것)
1. `NODE_ENV=production`은 `BACKUP_ENCRYPTION_KEY` 필수 **+ native sqlite backup이 Node 23.8+ 요구**.
   로컬 Node 22로는 기동 불가 → 포터블 Node 24를 받아 썼다.
2. `/admin` origin 검증이 Fly 프록시(`x-forwarded-proto`) 전제라 로컬 직접 접속은 403.
   `admin-proxy.mjs`가 헤더를 주입해 우회한다.
3. **worktree에서는 Next 빌드·dev가 안 된다.** node_modules 정션을 Turbopack이
   "filesystem root 밖"이라며 거부한다. 빌드·라이브 검증은 main 병합 후 또는
   main에 파일을 임시 복사해서 하고, 끝나면 `git checkout --`로 되돌릴 것.

## 검증 상태
`tsc --noEmit` 통과 · vitest **147파일 1891테스트 통과**(기존 테스트 수정 0건) ·
`lint` 통과 · `build` 통과 · Fly v70 헬스체크 정상.
배포 부팅 로그에 복구·환불 이벤트 0건 = 운영에는 아직 교착 인스턴스가 없었다.
