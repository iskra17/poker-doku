# 운영 백오피스 등록 기기 로그인 유지

사용자 요청: 특정 등록 기기는 반복 운영 토큰 입력 없이 접속. 유지 기간은 **90일**로 확정(2026-09-08).

## 원인과 선택

현재 AdminSessionManager는 메모리 Map에 고정 2시간 세션을 저장하므로 시간 경과나 배포/재시작에 로그인 상태가 소멸한다.
단순 TTL 연장은 재시작을 해결하지 못한다. 운영 토큰 원문을 브라우저에 보관하는 방식도 사용하지 않는다.
선택한 브라우저에 한해 SQLite 영속 불투명 세션을 발급한다. 기기는 하드웨어 지문이 아닌 브라우저 쿠키 보유 단위다.

## 제품 동작

- 로그인 화면의 기본 해제된 체크박스: `이 기기에서 90일간 로그인 유지`. 선택 시 기기 이름 입력(선택, 최대 80자).
- 정상 운영 토큰으로 로그인한 경우에만 등록한다. 미선택은 기존 2시간 메모리 세션 계약을 유지한다.
- 등록 기기는 같은 사이트·브라우저로 재접속하면 GET session이 로그인 상태를 복원한다. 재접속 시 서버 만료와 쿠키를 90일로 연장한다.
- 새로고침, 브라우저 종료/재시작, 서버 재시작 후에도 자격을 유지한다. 쿠키 삭제, 90일 미접속, 등록 해제, 로그아웃,
  운영 원본 토큰 변경/제거 시 다시 로그인해야 한다. 장기 유지 기능을 활성화해도 이미 로그인한 세션을 자동 등록하지 않는다.
- 백오피스 `등록 기기` 패널에 이름·등록/최근접속/만료 시각·현재 기기를 표시하고 기기별 해제한다.
  현재 기기 해제 및 로그아웃은 영속 자격도 제거한다. 타 기기 해제는 그 기기의 다음 API 요청부터 적용한다.

## 서버·보안 계약

- 기존 `poker_doku_admin` HttpOnly·SameSite=Strict·Path=/api/admin·production Secure 쿠키를 사용한다.
  등록 자격은 CSPRNG 256bit 이상, DB에는 원문 쿠키/운영 토큰을 저장하지 않는다. 자격 조회 키는 원본 운영 토큰에 바인딩한 HMAC-SHA256
  등으로 만들어 원본 토큰 회전 후 옛 쿠키가 무효화되도록 한다. 등록 목록도 현재 원본 토큰 범위에 한정한다.
- CSRF 토큰과 공개 principal id는 쿠키 자격과 별도로 생성한다. POST/DELETE exact-origin+CSRF 및 로그인/변경 레이트리밋 유지.
- 영속 자격은 매 인증마다 DB 유효성 확인; 메모리 캐시로 원격 해제/만료를 우회하지 않는다. 갱신은 유효 행 조건부 UPDATE만 허용하여
  revoke와 겹친 요청이 삭제 행을 다시 생성하지 않는다. 원본 토큰 미설정 또는 저장소 실패는 fail closed.
- 다중 탭에서 GET session이 CSRF나 쿠키 자격을 불필요하게 회전하지 않는다. 고정 만료를 갱신하되 과거 응답으로 자격을 부활시키지 않는다.
- DB 마이그레이션은 v40, 담당자는 Opus 한 명. 만료 행 정리 및 등록 수 상한(현재 운영 토큰당 20개, 상한 초과는 명시 오류)을 둔다.
- DB 원문 자격 및 Set-Cookie는 JSON body·로그·localStorage에 노출하지 않는다. 등록 이름은 인증 요소가 아니며 IP/UA 고정 바인딩은 하지 않는다.

## HTTP/UI 공유 계약

```ts
// POST /api/admin/session
type LoginInput = { token: string; rememberDevice?: boolean; deviceName?: string };
// POST 201, GET 200 /api/admin/session — Set-Cookie는 HTTP 헤더로만
type SessionView = { principal: {kind:'backoffice-admin'; id:string; expiresAt:number}; csrfToken:string; expiresAt:number; remembered:boolean };
// GET /api/admin/devices
type DeviceList = {devices: Array<{id:string; name:string; createdAt:number; lastUsedAt:number; expiresAt:number; current:boolean}>};
// DELETE /api/admin/devices?id=<encoded id>, x-csrf-token, exact origin -> 204; current이면 쿠키 제거
// invalid body/id 400, unauthenticated 401, csrf/origin 403, max devices 409, persistence unavailable 503
```

기존 등록 로그인에서 remembered 필드 추가는 하위 호환이다. UI의 로그아웃 실패를 성공으로 표시하지 않으며,
네트워크/서버 오류를 잘못된 토큰으로 표시하지 않는다. 토큰 입력은 성공 즉시 비운다.

## 검증

실제 임시 SQLite로 서버 재생성 뒤 복원, 2시간/90일 경계, 89일 재접속 후 연장, 로그아웃/타 기기 해제 즉시 반영,
원본 토큰 회전/미설정, 잘못된 쿠키·중복 쿠키, CSRF/origin, 상한·입력검증, DB/JSON 자격 원문 비노출을 검증한다.
브라우저는 테스트 전용 DB·토큰으로 체크박스 로그인, 재접속, 기기 목록, 해제·로그아웃까지 검증한다. 운영 DB로 QA하지 않는다.

참고: [OWASP 세션 관리](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html),
[MDN Set-Cookie](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie).

## 역할·범위

Astra가 기획·통합, Fable 5.1이 설계/최종 인증 경계 리뷰, Opus가 서버/DB/회귀, Luna Max가 UI를 맡는다.
동시 작업자 최대 2명. 전체 테스트와 작업자 테스트를 겹치지 않는다. 이번 요청은 구현·검증·로컬 통합이며 push/배포는 별도 지시 때만.
