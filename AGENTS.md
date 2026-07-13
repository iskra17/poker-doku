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
커스텀 서버라 Vercel 서버리스에는 부적합. 배포는 Fly.io 도쿄 단일 머신 (`fly.toml`+`Dockerfile`,
`fly deploy`) — 인메모리 상태라 `auto_stop_machines` 금지·머신 1대 고정(수직 확장만).
상세와 Vultr 대안은 `deploy/README.md`.

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
  스냅샷에 `turnTimeRemaining`이 실린다 (순서 주의). 기본 턴 시간 8초 — 초과 시 타임뱅크가
  남아 있으면 자동 사용(+30초)해 연장하고, 다 쓰면 자동 체크/폴드.
- **액션 규칙**: `getValidActions`는 응수 가능한 상대(active)가 없으면(전원 올인) 레이즈/올인을
  제공하지 않음 — 콜/폴드만 (ActionBar도 동일 조건으로 클라 측 숨김). 회귀 테스트:
  `engine.validactions.test.ts`.
- **클라이언트 이벤트 레이어**: 서버는 `game-update` 스냅샷만 push. `src/lib/events/game-events.ts`의
  `diffGameState()`가 prev/next를 비교해 이벤트(hand-start/action/bets-collected/winners 등)를 발행하고,
  사운드·애니메이션·액션로그·캐릭터 표정이 이 스트림을 구독한다. diff 안정성을 위해 서버가
  `handNumber`/`actionSeq` 카운터를 유지.
- **시트앤고(SnG)**: `RoomConfig.gameMode: 'cash'|'sng'`. UI 표기는 'Sit & Go'. 구조는
  `src/lib/poker/blind-schedule.ts` (시작 스택 1500, 3분마다 레벨 인상, 1~3위 50/30/20% 시상).
  엔진이 `state.tournament`(레벨/상금/순위 results)를 소유하고 getPublicState로 자동 브로드캐스트.
  순위 판정은 엔진(`finalizeTournamentHand` — 동시 탈락은 `handStartChips` 큰 쪽이 상위),
  레벨 타이밍/공지는 RoomManager. **시작 규칙**: 자동 봇 충원 없음 — 6인이 모두 모여야 자동 시작,
  또는 방장(`RoomConfig.hostId`, `state.hostId`로 노출)이 'sng-fill-bots'로 남는 자리를 봇 충원
  (`RoomManager.fillWithBots`). 시작 후 재충원·중도 참가·리바이 금지. 탈락한 휴먼은 좌석 유지
  상태로 관전(EliminationNotice가 순위 안내).
- **방 비밀번호/초대**: `RoomConfig.password`는 서버 전용(절대 gameState로 노출 금지),
  목록엔 `hasPassword`만 노출. join-room에서 검증. 초대 링크는 `/?room=<id>` — page.tsx가
  파싱해 닉네임 입력 후 JoinRoomModal 자동 오픈.
- **캐시 바이인**: 40~200BB 범위를 서버가 강제(create-room에서 min/maxBuyIn 재계산, join-room에서
  클램프). 입장 시 JoinRoomModal 슬라이더로 선택.

## 주요 디렉토리

- `src/server/` — 커스텀 서버, 소켓 핸들러, RoomManager(방/타이머/봇), SessionManager
- `src/lib/poker/` — 순수 게임 로직 (engine, evaluator, deck, types) + 테스트
- `src/lib/bot/` — 봇 AI. `personalities.ts`가 아키타입 DB (사쿠라=록, 류카=LAG, 하나=TAG,
  유키=콜링 스테이션, 아키라=매니악 — vpip/pfr/aggression/limp/threeBet/slowPlay/betSizing).
  `bot-ai.ts`는 프리플랍 티어 + evaluator 기반 포스트플랍 강도/드로우 감지로 결정. 숏스택(≤10BB)
  푸시/폴드 레이어는 결정론 — 테스트가 의존하므로 유지할 것.
- `src/lib/characters/` — 캐릭터 프로필/한국어 대사 (딜러 미야코, 사쿠라, 류카, 하나, 유키, 아키라)
- `src/lib/sound/` — Web Audio 합성 사운드 (에셋 파일 없음)
- `src/lib/assets/character-art.ts` — 일러스트 매니페스트 (이미지 없으면 이모지 fallback)
- `src/components/table/` — 테이블 UI. **세로형 단일 레이아웃** — 모든 화면에서 세로 타원 컬럼
  (`max-w-[min(440px,60dvh)]`) 하나를 중앙 렌더. 좌석/베팅/팟/딜러버튼 좌표는 `table-layout.ts`가
  단일 소스 (`getLayout()` 무인자). ActionBar는 fixed 오버레이가 아니라 GameRoomView flex 컬럼의
  고정 높이 하단 독(`ACTION_DOCK_HEIGHT`) — 턴 여부와 무관하게 높이 상수라 테이블 % 좌표가 흔들리지
  않음. 베팅 컨트롤은 포커룸 표준 문법: 좌측 [금액/프리셋+스테퍼/액션 버튼] 3행 + 우측 세로 벳
  슬라이더(`ui/VerticalSlider` — 아래=최소, 포인터 드래그 + 휠, 커스텀 구현).
- `src/components/characters/` — CharacterImage(2중 fallback), DealerCorner(우상단 딜러 미야코
  아바타+진행 말풍선, 설정으로 개별 숨김), SeatSpeechBubble, WinnerCutIn(우측)/LoserCutIn(좌측 —
  쇼다운 패배 봇 sad 컷인). 좌석 리액션: CharacterAvatar가 표정 변화 시 바운스/흔들림 모션,
  table/SeatEmote가 승/패/올인 이모지 버스트.
- **AI 상황 대사 (3층 전략)**: `src/server/dialogue-manager.ts`가 진입점 — ①기본 상황
  (폴드/레이즈 등)은 캐릭터 모듈의 스크립트 대사만, ②특별 순간(올인/빅팟/SnG 탈락·우승)은
  과거 생성된 대사 풀에서 재사용(캐릭터×상황키별 최대 12줄, `data/dialogue-cache.json`에
  스냅샷), ③풀이 부족할 때만 실시간 생성 후 풀에 적립 — 운영할수록 API 호출이 줄어든다.
  재사용을 위해 생성 프롬프트에 '구체 숫자 금지' 규칙 자동 첨부. 실시간 생성은
  `src/server/ai-dialogue.ts` — Gemini(기본 `gemini-2.5-flash-lite`, raw fetch, fight club
  korea의 bot-activity.ts 패턴), `GEMINI_API_KEY` 없으면 비활성. 비용 가드: 일일 상한
  (`AI_DIALOGUE_DAILY_MAX`=200)·방별 쿨다운(20s)·확률 게이팅(0.6)·429 PerDay 당일 중단,
  최종 폴백은 항상 스크립트 대사(`RoomManager.botQuip`). **스토리/스터디 모드 확장**:
  situationKey는 자유 문자열('story:ch1:intro' 등) — 키만 추가하면 같은 캐시·생성
  파이프라인을 타고, 사전 작성 대사는 호출부 fallback으로 공급하면 된다.
- `src/lib/store/settings-store.ts` — zustand persist 사용자 설정: 음소거, 덱 스타일
  (클래식/빅랭크)×컬러(2/4컬러), 딜러 아바타/말풍선 토글. 진입점은 TopBar ⚙️ → SettingsModal.
- 카드 수트 색은 `globals.css @theme`의 `suit-*` 토큰 + `card-theme.ts` 매핑이 단일 소스.
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

- 비참가자 관전 모드(방에 안 앉고 구경), 리바이(칩 0이면 관전 상태로 고정 — SnG 탈락자 관전은 구현됨),
  멀티 테이블 동시 플레이(1세션 1테이블)
- 멀티 테이블 토너먼트(MTT) — 시트앤고(단일 테이블)만 구현됨
- 어드민/모니터링 도구 없음. 방 운영 가드는 최소한만: 방 수 상한(MAX_ROOMS=30),
  휴먼 0명 유저 방 10분 후 자동 정리(기본 방 3개는 persistent로 제외)
- 영속성 없음 — 전부 인메모리, 서버 재시작 시 초기화. 단일 인스턴스 전제.
