# Poker Doku (ポーカー道場)

일본 미소녀 연애 시뮬레이션(갸루게) 감성의 멀티플레이어 텍사스 홀덤 웹 게임.
캐릭터(딜러 미야코 + 봇 5명)가 중심인 6-max 노리밋 홀덤. UI는 전면 한국어.

## 실행

```bash
npm run dev    # 개발 서버 (tsx 커스텀 서버, localhost:3000)
npm run build  # Next 프로덕션 빌드 (배포 전 필수)
npm start      # 프로덕션 서버 (NODE_ENV=production일 때 빌드 산출물 서빙)
npm test       # vitest (엔진/사이드팟/이탈/세션 테스트)
npm run lint   # eslint (react-hooks 순수성 규칙 활성 — 렌더 중 Date.now() 금지 등)
npx tsc --noEmit
```

`dev`/`start` 모두 `tsx src/server/index.ts` — Next 핸들러와 Socket.io를 한 HTTP 서버에 결합한
커스텀 서버라 Vercel 서버리스에는 부적합. 배포는 Render(render.yaml) 같은 상시 프로세스 호스팅.

## 아키텍처

- **서버 권위 모델**: 게임 상태는 서버의 `PokerEngine`만 소유. 클라이언트는 수신 전용.
  홀카드는 `getPublicState(forPlayerId)`가 본인 것 외 placeholder로 마스킹. `revealed` 플래그가
  쇼다운 공개 여부의 유일한 계약 (클라이언트가 status로 추측하지 말 것).
- **팟 회계**: `Player.totalContributed`(핸드 누적 기여금)에서 `rebuildPots()`가 매번 팟 전체를
  재유도. 팟 계층은 올인 금액에서만 분할. 불변식: `sum(pots) === sum(totalContributed)`.
  절대 `pots[].amount +=` 증분 방식으로 되돌리지 말 것 (멀티 스트리트 소실 버그의 원인이었음).
- **핸드 중 이탈**: 진행 중엔 절대 splice 금지 — `pendingRemoval` 마킹 + 폴드, 다음 핸드 시작 시
  `removePendingPlayers()`가 일괄 제거 (dealerIndex 보정 포함).
- **재접속**: `src/server/session-manager.ts`. localStorage 토큰(비밀) ↔ playerId(공개) ↔ socketId
  매핑, disconnect 후 60초 grace 동안 좌석/칩 보존. 토큰을 gameState로 노출하지 말 것.
- **턴 타이머**: 서버가 deadline 관리. `startPlayerLoop()`를 `onUpdate()`보다 먼저 호출해야
  스냅샷에 `turnTimeRemaining`이 실린다 (순서 주의).
- **클라이언트 이벤트 레이어**: 서버는 `game-update` 스냅샷만 push. `src/lib/events/game-events.ts`의
  `diffGameState()`가 prev/next를 비교해 이벤트(hand-start/action/bets-collected/winners 등)를 발행하고,
  사운드·애니메이션·액션로그·캐릭터 표정이 이 스트림을 구독한다. diff 안정성을 위해 서버가
  `handNumber`/`actionSeq` 카운터를 유지.

## 주요 디렉토리

- `src/server/` — 커스텀 서버, 소켓 핸들러, RoomManager(방/타이머/봇), SessionManager
- `src/lib/poker/` — 순수 게임 로직 (engine, evaluator, deck, types) + 테스트
- `src/lib/bot/` — 봇 AI (캐릭터별 성향은 `personalities.ts`)
- `src/lib/characters/` — 캐릭터 프로필/한국어 대사 (딜러 미야코, 사쿠라, 류카, 하나, 유키, 아키라)
- `src/lib/sound/` — Web Audio 합성 사운드 (에셋 파일 없음)
- `src/lib/assets/character-art.ts` — 일러스트 매니페스트 (이미지 없으면 이모지 fallback)
- `src/components/table/` — 테이블 UI. 좌석/베팅/팟 좌표는 `table-layout.ts`가 단일 소스
- `src/components/characters/` — CharacterImage(2중 fallback), DialogueBox(VN 대사창),
  SeatSpeechBubble, WinnerCutIn
- `public/assets/` — Codex(gpt-image)로 생성한 캐릭터 일러스트 6명×3표정, 로고, 로비 배경

## 컨벤션

- UI 텍스트·시스템 채팅·캐릭터 대사는 한국어. 캐릭터별 말투 유지 (류카=츤데레 반말, 하나=분석 존댓말 등).
- 디자인 토큰은 `globals.css @theme` (blossom/cyber/mystic/gilded/panel 등) — 새 색상 하드코딩 금지.
- framer-motion 요소에서 Tailwind `-translate-*` 클래스와 transform 애니메이션을 섞지 말 것
  (framer가 transform을 덮어씀) — `style={{ x: '-50%', y: '-50%' }}` 사용.
- eslint react-hooks 순수성 규칙: effect 본문에서 직접 setState 금지 (외부 시스템 콜백에서만),
  렌더 중 `Date.now()` 금지.
- 카드/칩/버튼은 SVG/CSS로 제작. 이미지 생성은 캐릭터/배경/로고만.

## 미구현 (알려진 범위 제외)

- 관전 모드, 자발적 sit-out, 리바이(칩 0이면 관전 상태로 고정)
- 영속성 없음 — 전부 인메모리, 서버 재시작 시 초기화. 단일 인스턴스 전제.
