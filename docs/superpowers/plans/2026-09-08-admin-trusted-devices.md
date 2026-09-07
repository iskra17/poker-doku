# Admin Trusted Devices Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. User has selected 90 days and authorized implementation.

**Goal:** 선택한 브라우저만 백오피스 로그인을 90일간 유지하며 재접속 시 자동 연장한다.
**Architecture:** 기존 2시간 메모리 세션에 명시적 opt-in SQLite 등록 세션을 추가한다. 등록 자격은 운영 토큰에 바인딩한 해시로 조회하고 매 API에서 해제/만료를 확인한다.
**Tech Stack:** Next/React, custom Node HTTP, node:sqlite, crypto, Vitest.

상세 계약: `docs/superpowers/specs/2026-09-08-admin-trusted-devices-design.md`.

## 1. 서버/DB — Opus 소유

Files: `src/server/admin-session.ts`, 새 `admin-device-repository.ts`, `admin-http.ts`, `http-handler.ts`,
`index.ts` production 주입, `persistence/migrations.ts`(v40), `persistence/database.test.ts`, 관련 신규/기존 admin 테스트.

- [ ] 실패 회귀부터 작성: 실제 임시 DB로 login rememberDevice 후 manager 재생성 시 authenticate 성공, 일반 세션은 소멸.
  `expect(restarted.authenticate(cookie, now + 3 * 3600000)).not.toBeNull()`; 일반 세션은 `toBeNull()`.
- [ ] `npx vitest run src/server/admin-session.test.ts src/server/admin-device-repository.test.ts --maxWorkers=2`로 미구현 실패 확인.
- [ ] v40·repository·세션 통합 구현. HMAC lookup 및 credential scope, 원문 비저장, 만료/폐기/상한 20, GET session 90일 갱신.
- [ ] HTTP 로그인 opt-in 및 기기 목록/해제 구현, production cookie/exact origin/CSRF 유지, 저장 실패는 503/인증 실패로 닫기.
- [ ] 실제 HTTP 테스트로 restart/expiry/renew/revoke/source rotation/잘못된 입력/원문 비노출 검증. DELETE 현재 기기 쿠키 제거 확인.
- [ ] 관련 admin 및 migration 검사 `--maxWorkers=2`, 변경 파일 lint 수행, 커밋. 전체 suite/build는 총괄에게 맡긴다.

## 2. UI — Luna Max 소유

Files: `src/app/admin/page.tsx`, 새 `src/components/admin/AdminDevicesPanel.tsx`와 필요한 UI 순수 helper/test만.

- [ ] 로그인 체크박스 기본 false·선택 기기 이름 및 명확한 90일/자동 연장 안내를 추가한다.
  요청 body는 `{token:value, rememberDevice, ...(rememberDevice ? {deviceName} : {})}`.
- [ ] session GET/POST의 `remembered`를 읽고 로그인 유지 상태를 표시한다. 새로고침의 기존 GET session 복원을 유지한다.
- [ ] 등록 기기 열기, GET 목록, 날짜·현재기기 표시, CSRF DELETE 및 현재 기기 해제 콜백을 구현한다.
- [ ] 요청 pending 중 중복 클릭 방지, 실제 오류 문구, 실패 로그아웃의 UI 상태 보존, 토큰 성공 시 즉시 비우기.
- [ ] 필요한 UI 회귀 및 변경 파일 lint 수행하고 커밋. 서버 파일·마이그레이션은 수정하지 않는다.

## 3. Astra 통합 / Fable 검토

- [ ] 서버/UI를 충돌 없이 통합한 차이에 Fable 인증 경계 리뷰를 받는다. 발견된 재현 가능한 결함은 담당 구현자가 수정한다.
- [ ] 전체 `npm test -- --maxWorkers=4` 1회, `npm run lint`, main 통합 후 `npm run build`, `npx tsc --noEmit`.
- [ ] 전용 QA DB/토큰·로컬 서버에서 로그인 유지/재접속/기기 해제 브라우저 검증. QA 프로세스는 이번에 띄운 것만 종료.
- [ ] AGENTS 인증 계약 및 핸드오프 갱신, 로컬 커밋·main 통합. push/배포하지 않는다.
