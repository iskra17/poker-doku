# Poker Doku

일본 미소녀 연애 시뮬레이션 감성의 서버 권위 6-max 텍사스 홀덤 웹 게임입니다.
Next.js와 Socket.IO를 하나의 Node HTTP 서버로 실행하며, 운영 배포 대상은 Fly.io 도쿄
단일 머신입니다.

## 로컬 실행

```bash
npm install
npm run dev
```

검증 명령:

```bash
npm test
npx tsc --noEmit
npm run lint
npm run build
```

## 영속 예약 MTT 운영

운영자는 `/admin`에서 `DEBUG_LOG_TOKEN`으로 로그인합니다. 토큰은 로그인 요청에서만 쓰이며,
이후 API는 HttpOnly 관리자 세션과 CSRF로 보호됩니다. 프로모션 계정에 먼저 예산을 적립한 뒤
프리롤 또는 지갑 토너먼트 인스턴스/반복 템플릿을 만들고, 목록에서 등록·시작·정산 상태를
확인합니다.

영속 스케줄러 롤아웃 플래그는 의존 순서대로 설정합니다.

```text
MTT_SCHEDULER_V2_ENABLED=true
MTT_LATE_REG_ENABLED=true
MTT_WALLET_LATE_REG_ENABLED=true
```

코드 기본값은 모두 `false`이며, `fly.toml`의 운영 환경만 세 플래그를 명시적으로 켭니다.
장애 시에는 반대 순서(지갑 레이트 레지 → 레이트 레지 → 스케줄러)로 끕니다. 서버는 listen
전에 미완료 환불·지급과 스케줄을 복구하고, 정상 종료 시 스케줄러·재시도·배치·관리자 세션
자원을 모두 정리합니다.

배포와 SQLite 백업/복구 절차는 `deploy/README.md`를 참고하세요.
