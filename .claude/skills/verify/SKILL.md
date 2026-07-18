---
name: verify
description: Poker Doku 변경을 실제 앱에서 검증하는 레시피 — dev 서버 기동, 브라우저(claude-in-chrome)로 로비/게임 플로우 주행, HTTP API 프로브.
---

# Poker Doku 검증 레시피

## 기동

```bash
npm run dev   # 백그라운드로. tsx 커스텀 서버, http://localhost:3000
# 준비 확인: curl http://localhost:3000/healthz → {"ok":true}
```

- dev DB는 `data/poker-doku.sqlite` (WAL). 서버 기동 시 마이그레이션 자동 적용.
- 서버가 켜져 있어도 `node -e` + `new DatabaseSync(path, { readOnly: true })`로 동시 읽기 가능.
- 종료: 포트 3000 리스너 PID를 Stop-Process (백그라운드 태스크 kill만으론 안 죽을 수 있음).

## 브라우저 주행 (claude-in-chrome)

- 로컬 Chrome엔 보통 기존 프로필 쿠키가 있어 온보딩 없이 로비 진입됨.
- **좌표 클릭 함정**: 스크린샷 픽셀과 CSS 픽셀 스케일이 달라(예: 1461 vs 1712) 우상단
  아이콘류는 빗나간다. `javascript_tool`로 `document.querySelector('button[aria-label="..."]').click()`
  방식이 확실하다. 모달 존재 확인은 `[role="dialog"] h2` 텍스트로.
- PWA 설치 배너가 상단을 덮을 수 있음 — X로 닫고 진행.
- 게임 참가: 로비 '참가' → JoinRoomModal '앉기'. Practice Dojo(혼자 연습)가 봇 5명이라 제일 빠름.
- 핸드 자동 플레이 루프는 CDP 45초 타임아웃에 걸리므로 40초 이하로 끊어서 실행:
  버튼 텍스트 '체크'/'콜 N'을 폴링 클릭. 턴 8~20초 제한이라 지체하면 자동 폴드+자리비움
  (자리비움 좌석은 다음 핸드부터 딜인 제외 — 복귀는 '게임 복귀' 버튼).
- 핸드 종료 감지: 채팅에 '획득했습니다' 등장.

## HTTP API 프로브

- 인증이 필요한 API는 페이지 컨텍스트에서 `fetch('/api/...', { credentials: 'same-origin' })`가
  제일 간단 (프로필 쿠키 자동 첨부). curl은 무인증 401 확인용.
- 레이트리밋은 `http-rate-limit.ts` PROFILE_HTTP_RATE_POLICIES 참고 (예: handHistory 30회/분).

## 서버 상태 확인

- 이벤트 로그: `GET /api/debug/log?token=$DEBUG_LOG_TOKEN` (dev에선 토큰 미설정 시 403).
- dev 서버 stdout에 `[evt] {json}` 한 줄 로그.
