# 2026-07-26 세션 인계

날짜: 2026-07-26 KST
저장소: `C:\code\claude\poker-doku` (main 체크아웃에서 직접 작업)
프로덕션: `poker-doku.fly.dev` — **Fly v69**, HEAD `2498698`
로컬·origin·프로덕션 모두 동일 커밋. 워킹 트리 깨끗.

## 이번 세션에서 배포한 것

| 릴리스 | 내용 |
|---|---|
| v66 | 토너먼트 반복/필드 정책 7태스크 (이전 세션 인계분 완료) + 운영 정리 |
| v67 | 토너먼트 개설 폼 날짜 입력 크래시 수정 |
| v68 | 칩 탑업 · 기본 테이블 사다리 · 토너먼트 빈 목록 문구 |
| v69 | 초대 코드(6자리) + 토너먼트 초대 링크 |

전체 검증: 146파일 1883테스트 통과, `tsc --noEmit`·`lint`·`build` 모두 통과.

## 다음 세션에서 알아야 할 계약

각 기능의 상세 계약은 커밋 메시지와 코드 주석에 있다. 여기엔 **되돌리면 안 되는 결정**만 적는다.

### 칩 탑업 (`project_cash-topup` 메모리 참조)
- **핸드 중에는 절대 칩을 올리지 않는다.** `checkpointCashHand`가 핸드 시작 스택을
  fingerprint로 굳히고 `settleCashHand`가 검증한다. 대신 `Player.pendingTopUpTarget`에
  예약하고 `RoomManager.applyPendingTopUps()`가 핸드 종료 때 반영한다.
- **0칩은 탑업이 아니라 리바이 소관.** 두 경로가 겹치면 지갑이 두 번 빠진다.
- escrow의 `amount`와 `checkpoint_amount`를 **함께** 올려야 한다.
- "델타 더하기"가 아니라 "목표 스택까지 채우기" — 델타는 같은 핸드 경계에서 멱등키가 충돌한다.

### 초대 코드
- 알파벳에서 `0/O`, `1/I/L` 제외 (`src/lib/invite/invite-code.ts`).
- **잘못 친 글자는 교정하지 말고 거절한다** — 조용히 다른 테이블로 보낼 수 있다.
- 6자리는 인증이 아니라 조회 키다. `resolve-invite`는 반드시 레이트리밋 뒤에 있어야 하고,
  방 비밀번호는 별개 레이어로 유지한다.
- 방·토너먼트가 같은 코드 공간(`InviteRegistry`)을 쓴다. 대상이 죽으면 즉시 회수한다.

### 도구 범위 (2026-07-25 수정)
저장소 루트에 체크아웃 사본이 여럿 산다(`.claude/worktrees`, `.worktrees`, `qa-tmp`).
vitest·eslint·tsc가 이들을 제외하도록 설정돼 있다 — **제외를 풀면 같은 스위트를 5벌 돌려
유령 실패가 난다**(사본들이 같은 임시 SQLite를 두고 경합). 사본 안에서 돌리는 건 정상 동작한다.

## 남은 작업

### 1. 초대 코드 영속화 (선택)
코드가 인메모리라 재배포 시 바뀐다. 방은 인메모리라 같은 수명이지만 **토너먼트는 DB에
남는데 코드만 새로 발급된다**. 링크(`?tournament=<id>`)는 계속 유효하므로 치명적이지 않다.
현재 트래픽에서는 과한 작업이라 보류했다.

### 2. 레거시 반복 템플릿 UI (작음)
프로덕션에 경계값 없는 레거시 템플릿 `d992ea52-2ae1-4a86-9933-728358ff2d80`이 비활성으로
남아 있다. `/admin` 반복 템플릿 패널에 **[활성화] 버튼이 그대로 보이는데 눌러도 서버가
`recurrence-boundary`로 거절**한다(재발 방지 가드는 정상 동작). 버튼을 숨기고
"마감 시각이 없어 재활성화 불가 — 새로 개설하세요" 안내로 바꾸면 좋다.

### 3. 프리롤 운영 기금
잔액이 **0**이다. 프리롤 토너먼트를 새로 열려면 `/admin`에서 먼저 충전해야 한다 —
안 그러면 회차가 `promotion-insufficient`로 자동 취소된다(이전 사고의 원인).

### 4. 이전 세션 워크트리 정리 (선택)
`.worktrees/tournament-recurrence-policy`는 main에 병합됐으니 지워도 된다:
```powershell
git worktree remove .worktrees/tournament-recurrence-policy
git branch -d feat/tournament-recurrence-policy
```
`.claude/worktrees/`의 blind-position-buttons·throwables와 `qa-tmp/prodqa`는 상태를 몰라
손대지 않았다. 도구가 무시하므로 남겨둬도 방해는 없다.

## 운영 접근

- 백오피스: `https://poker-doku.fly.dev/admin`, 토큰은 Fly 시크릿 `DEBUG_LOG_TOKEN`.
  머신 안에서 꺼내려면 `flyctl ssh console -a poker-doku -C "sh -c 'printenv DEBUG_LOG_TOKEN'"`.
  (이번 세션에서 대화에 노출됐으므로 교체를 권했다 —
  `fly secrets set DEBUG_LOG_TOKEN=$(openssl rand -hex 32) -a poker-doku`)
- 배포: `git push origin main && fly deploy --ha=false` (인메모리 상태 — 머신 1대 고정).
- 배포 중 뜨는 "not listening" 경고는 무해하다. listen 전에 마이그레이션·복구를 끝내는
  구조라 그 사이에 포트 스캔이 찍힌다.
