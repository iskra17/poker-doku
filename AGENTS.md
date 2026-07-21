# Poker Doku (ポーカー道場)

일본 미소녀 연애 시뮬레이션(갸루게) 감성의 멀티플레이어 텍사스 홀덤 웹 게임.
캐릭터(딜러 미야코 + 봇 16명)가 중심인 6-max 노리밋 홀덤. UI는 전면 한국어.
(봇 캐릭터가 좌석 수(6)보다 충분히 많아 히어로 프로필과 겹치지 않고 봇 5석을 채울 수 있다 —
캐릭터가 6명 미만으로 줄면 6인 플레이에서 중복이 재발하니 주의.)

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
`next.config.ts`의 `turbopack.root`는 상위 경로의 lockfile을 빌드 루트로 오인하는 경고를 막기 위해
프로젝트 루트로 명시한 것이므로 제거하지 말 것.

## 아키텍처

- **서버 권위 모델**: 게임 상태는 서버의 `PokerEngine`만 소유. 클라이언트는 수신 전용.
  홀카드는 `getPublicState(forPlayerId)`가 본인 것 외 placeholder로 마스킹. `revealed` 플래그가
  쇼다운 공개 여부의 유일한 계약 (클라이언트가 status로 추측하지 말 것). 공개는 쇼다운
  **경합**(생존자 2인 이상) 또는 올인 런아웃일 때만 — endHand가 폴드 승리에도 street='showdown'을
  세팅하므로 street만으로 공개를 판정하면 폴드 승자 카드가 노출된다 (2026-07-17 QA에서 수정).
- **팟 회계**: `Player.totalContributed`(핸드 누적 기여금)에서 `rebuildPots()`가 매번 팟 전체를
  재유도. 팟 계층은 올인 금액에서만 분할. 불변식: `sum(pots) === sum(totalContributed)`.
  절대 `pots[].amount +=` 증분 방식으로 되돌리지 말 것 (멀티 스트리트 소실 버그의 원인이었음).
- **핸드 중 이탈**: 진행 중엔 절대 splice 금지 — `pendingRemoval` 마킹 + 폴드, 다음 핸드 시작 시
  `removePendingPlayers()`가 일괄 제거 (dealerIndex 보정 포함).
- **올인 런아웃 단계 연출**: 응수 가능한 플레이어가 1명 이하로 베팅이 닫히면 엔진이 보드를 즉시
  깔지 않고 `state.allInRunout` 모드로 전환한다(activePlayerIndex=-1, 핸드는 진행 중). 이때
  getPublicState가 생존자 핸드를 미리 공개(revealed)하고, RoomManager `scheduleRunoutStreet()`가
  `dealRunoutStreet()`를 스트리트당 1.6초 간격으로 호출해 플랍→턴→리버→쇼다운을 순차 브로드캐스트
  한다 (타이머는 turnTimers 슬롯 재사용 — 기존 정리 경로를 그대로 탄다). 테스트에서 최종 결과만
  보려면 `completeRunout(engine)`(test-helpers) 사용. 회귀: `room-manager.runout-timeout.test.ts`.
- **재접속**: `src/server/session-manager.ts`. localStorage 토큰(비밀) ↔ playerId(공개) ↔ socketId
  매핑, disconnect 후 60초 grace 동안 좌석/칩 보존. 토큰을 gameState로 노출하지 말 것.
  grace 만료로 좌석이 실제 제거되는 경우(캐시 & 비자리비움)에만 `Player.disconnectGraceDeadline`
  (epoch ms)을 스냅샷에 실어 클라이언트(PlayerSeat)가 오프라인 회수 카운트다운 타임바를 그린다 —
  SnG/자리비움 좌석은 보존되므로 세팅 금지, 재접속·grace 만료 keep 시 해제.
  소켓 재연결 시 클라이언트가 `resync`를 보내고, 방/좌석이 사라졌으면(서버 재시작·유휴 정리·
  grace 만료) 서버가 `room-lost`로 응답 → 클라이언트는 안내와 함께 로비 복귀. 이 계약이 없으면
  서버 재시작 때 클라이언트가 죽은 방 스냅샷을 든 채 얼어붙는다. 캐시 게임에서 파산(0칩) 좌석의
  재입장(join-room 멱등 경로)은 새 바이인으로 리바이 처리 — **다른 좌석의 진행 중 핸드 동안에도 허용**
  (0칩 좌석은 startHand가 sitting-out 처리라 그 핸드에 없다. 진행 중 핸드에 살아 있는 올인
  0칩(active/all-in)만 제외 — '핸드 사이'로 제한하면 파산 직후 몇 초 틈을 놓친 리바이가 조용히
  무시된다). 리바이 성공 시 자리비움 마킹도 해제해 다음 핸드부터 딜인. 테이블 내 진입점은
  BustNotice [바로 리바이](wallet은 지갑 잔액 40BB 미만이면 불가 안내, practice는 기본 100BB).
  회귀: `socket-handler.integration.test.ts` 'grants a rebuy … live hand'.
- **세션 회수**: `SessionManager.releaseIfIdle()`은 live socket·보존 room·grace timer가 모두 없을
  때만 세션을 제거한다. 따라서 로비에서 끊긴 세션은 즉시, grace 만료로 좌석을 지키지 못한 세션은
  `roomId`를 비운 뒤 회수하고, live socket이나 보존 좌석이 있으면 유지한다. `stats()`는 현재
  session/socket/grace 개수만 노출해 Map 누적 여부를 관찰한다.
- **실시간 이벤트 격리**: 동일 세션 토큰은 최신 소켓 하나만 소유권을 가지며 구 소켓은
  `session-replaced` 후 서버 disconnect된다. 개인 `game-update`는 `{roomId,state}` envelope이고 서버는
  `session.roomId`, 클라는 `currentRoomId` 일치를 각각 검증한다. 플레이 액션은 클라가 본
  `expectedHandNumber`/`expectedActionSeq`를 보내며 서버 ack 전까지 중복 입력을 잠근다. 연결이 끊긴
  상태에서는 상태 변경 이벤트를 emit하지 않는다. 이 계약을 우회하면 구 탭 액션·방 상태 혼입·
  다음 스트리트 더블 액션이 재발한다. 회귀: `socket-handler.integration.test.ts`.
- **소켓 진입 가드**: production은 Origin 헤더가 없거나, Origin의 host(:port)가 요청 Host와
  일치하거나, 쉼표로 구분한 `SOCKET_ALLOWED_ORIGINS` 중 하나와 exact origin이 일치할 때만 허용한다.
  development는 모든 origin을 허용한다.
  `ClientToServerEvents` 타입은 런타임 신뢰 경계가 아니다. 모든 외부 이벤트는 먼저 payload 유무별
  arity와 마지막 ack의 함수 여부를 정규화하고, 잘못된 인자는 상태·로그에 닿기 전에 거절한다.
  요청 제한은 소켓별 sliding window로 `player-action`+`toggle-sit-out` 합산 12회/2초, 입장 5회/10초, `resync`+`get-rooms` 합산
  10회/5초, 방 생성 1회/5초, 채팅 1회/700ms다. 소유권과 payload를 먼저 검증하고 로그·상태 변경 전에
  제한해, 거절 payload가 로그를 증폭하거나 상태를 바꾸지 않게 한다.
  IP 단위 레이트리밋(HTTP API·소켓 profileAuth)의 클라이언트 키는 `client-address.ts`가 단일 소스 —
  XFF **마지막 홉**(신뢰 프록시가 append, 위조 불가) → Fly-Client-IP → 소켓 주소 순. 프록시 뒤에서
  `socket.remoteAddress`를 그대로 키로 쓰면 전 방문자가 버킷 하나를 공유해 트래픽 몰릴 때 전원이
  429를 받는다 (2026-07-21 디시 유입 장애). XFF 첫 항목으로 바꾸면 위조로 리밋이 우회되니 금지.
  회귀: `client-address.test.ts`.
- **방 수명주기**: 방 삭제는 idempotent한 `RoomManager.disposeRoom()`만 사용한다. 이 경로가 봇·핸드
  시작·턴·자리비움·종료 SnG 타이머와 deadline, 채팅, 토너먼트 시계, bot epoch, 방별 AI 대사 상태를
  함께 지운다. persistent 기본 방은 마지막 휴먼이 완전히 나가 유효 좌석이 0개가 되면 삭제 대신 새 `PokerEngine`으로 교체해
  플레이어·채팅·`handNumber`/`actionSeq`·`lastAction`/`lastAggressorId` 등 이전 핸드 상태를 남기지 않는다.
- **자리비움/나가기**: 나가기(TopBar ←)는 지킬 좌석이 있으면(칩>0 또는 올인, 미탈락) LeaveRoomModal로
  '자리비움 하고 나가기'(leave-room mode:'sitout')와 '완전히 나가기'를 물어본다. 정책은 `src/server/sitout.ts`
  + RoomManager. **공통 원칙**: 자리비움 좌석의 턴은 절대 기다리지 않는다 — 누른 순간이 본인 턴이면
  `toggleSitOut`이 즉시 `autoActFor`(체크 가능하면 체크, 아니면 폴드), 아니면 턴 도래 시
  `startPlayerLoop`의 autoAct가 1초 뒤 처리(`isDisconnected || sitOutNext`, 캐시/SnG 공통).
  이 가드를 SnG로 한정하면 캐시에서 턴 타이머(8초)+타임뱅크(30초)가 소진될 때까지 테이블이 멈춘다
  (2026-07-15 수정). **캐시**: 자리비움은 다음 핸드부터 딜인 제외, 대략 2오르빗
  (`shouldRemoveForMissedBlinds`, 경과 핸드÷인원)을 넘기면 자동 정리. 자리 떠난 좌석은 5분 `SITOUT_ABANDON_MS` 타이머로 확실히 회수
  (방 자가진행 불가 시 누수 방지, 복귀 시 `handleSeatRejoin`이 취소). 재입장은 자리비움 유지 + '게임 복귀'
  버튼(명시 복귀). **캐시 파산(0칩) 좌석 회수**: 미납 BB 정리가 chips<=0을 건너뛰므로 별도 경로 필수 —
  핸드 종료 시 `scheduleBustReclaims`가 `BUST_RECLAIM_MS`(30초 — 빠른 세션 회전용, 5분 방치 유예와 별개) 리바이
  유예를 걸고 `Player.bustReclaimDeadline`으로 BustNotice 카운트다운을 노출한다. 이후 핸드 종료마다
  재무장 금지(재무장하면 영영 만료 안 됨), 단 파산 전에 걸린 5분 자리비움 유예는 30초로 교체. grace 만료
  시엔 자리비움이라도 즉시 회수(지킬 칩이 없음. 진행 중 핸드의 올인 0칩은 팟 지분이 있어 제외). 리바이는
  `handleSeatRejoin`이 유예·카운트다운 해제. 서버 타이머 회수(파산·방치·미납 BB)는 `onSeatReclaimed` 훅이
  접속 중인 클라이언트를 room-lost로 로비 복귀시킨다. 2026-07-21 운영 로그의 방치 좌석 실측 후 도입,
  회귀: `room-manager.bust-reclaim.test.ts`. **SnG**: 자리비움/끊김도 딜인·블라인드 유지 + 턴 자동 폴드(away)로 블라인드 소진 →
  자연 탈락, 좌석은 토너먼트 종료까지 보존(grace 만료·`handleGraceExpired`에서 SnG는 무조건 keep). 회귀:
  `sitout.test.ts`(정리 판정), `room-manager.sitout-turn.test.ts`(턴 비점유). 로비 복귀 후 도착하는 game-update는 클라가 무시(currentRoomId null 가드).
  **로비 재입장 UX**: room-list는 소켓별 개인화 브로드캐스트(`getRoomList(forPlayerId)` →
  `mySeat: {chips, sittingOut}`, pendingRemoval 좌석 제외) — 로비가 보존 좌석을 알아보고
  '게임 복귀' 배너/카드 버튼으로 **바이인·비밀번호 없이 즉시 재입장**(JoinRoomModal 생략,
  SnG 잠금·만석 무시). 파산(0칩) 캐시 좌석만 리바이 모달(비밀번호는 여전히 생략). 서버 내부
  자동 정리(미납 BB/방치 회수)도 `onRoomsChanged` 콜백으로 로비에 즉시 반영. 다른 방에 앉으면
  기존 보존 좌석은 회수되므로(JoinRoomModal이 경고) 주의. 회귀: `room-manager.myseat.test.ts`.
- **턴 타이머**: 서버가 deadline 관리. `startPlayerLoop()`를 `onUpdate()`보다 먼저 호출해야
  스냅샷에 `turnTimeRemaining`이 실린다 (순서 주의). 기본 턴 시간 8초 — 초과 시 즉시 자동
  체크/폴드 + `sitOutNext` 자리비움 마킹. 단 시간 초과 마킹은 `sitOutAuto`(자동)로 구분:
  **같은 핸드의 남은 스트리트에서는 매번 기본 턴 시간을 그대로 주고**(1초 즉시 처리는 명시적
  자리비움·접속 끊김만), 본인이 액션하면 마킹째 자동 해제, 핸드가 끝나면 일반 자리비움으로
  전환된다(새 핸드 시작 시 `sitOutAuto` 소거 — 캐시 딜인 제외/SnG away 복귀. 부재 좌석이 매 핸드
  테이블을 붙잡지 않게 하는 안전장치이므로 유지할 것). 복귀는 ActionBar [게임 복귀] 또는 액션.
  타임칩(+30초)은 **자동 소모하지 않는다** — 본인이 턴 중에
  ActionBar 타임칩 버튼을 눌러야만 연장(`useTimeBank`). 부재중 좌석이 타임칩 수만큼 매 턴
  테이블을 붙잡는 문제로 2026-07-18에 자동 연장을 제거했으니 되살리지 말 것.
  회귀: `room-manager.sitout-turn.test.ts` (시간 초과 마킹 스트리트별 기본 시간 보장 포함).
- **액션 규칙**: `computeValidActions(state, player)` (engine.ts export)가 **단일 소스** —
  서버 `PokerEngine.getValidActions`와 클라 `ActionBar` 버튼 노출이 **같은 함수**를 쓴다.
  규칙을 양쪽에 각각 구현하지 말 것: 어긋나면 "버튼은 보이는데 서버가 거부하는" 먹통 버튼이 된다
  (2026-07-15에 실제로 발생 — 클라가 숏스택 조건을 빠뜨려 올인 버튼이 먹통이었다).
  ①응수 가능한 상대(active)가 없으면(전원 올인) 레이즈/올인 없음, ②올인은 내 전 스택이 테이블 벳을
  **넘길 수 있을 때만**(스택 ≤ 콜 금액이면 그 올인은 곧 콜 — 콜 버튼에 '(올인)' 표기),
  ③레이즈는 최소 레이즈액을 채울 때만(못 채우면 언더레이즈 올인). 회귀: `engine.validactions.test.ts`.
- **클라이언트 이벤트 레이어**: 서버는 `{roomId,state}` 형태의 `game-update` 스냅샷만 push. `src/lib/events/game-events.ts`의
  `diffGameState()`가 prev/next를 비교해 이벤트(hand-start/action/bets-collected/winners 등)를 발행하고,
  사운드·애니메이션·액션로그·캐릭터 표정이 이 스트림을 구독한다. diff 안정성을 위해 서버가
  `handNumber`/`actionSeq` 카운터를 유지.
- **시트앤고(SnG)**: `RoomConfig.gameMode: 'cash'|'sng'`. UI 표기는 'Sit & Go'. 구조는
  `src/lib/poker/blind-schedule.ts` (시작 스택 1500, 3분마다 레벨 인상, 1~3위 50/30/20% 시상).
  엔진이 `state.tournament`(레벨/상금/순위 results)를 소유하고 getPublicState로 자동 브로드캐스트.
  순위 판정은 엔진(`finalizeTournamentHand` — 동시 탈락은 `handStartChips` 큰 쪽이 상위),
  레벨 타이밍/공지는 RoomManager. **참가 방식**: create-room `economyMode`('wallet' 기본 |
  'practice') — wallet은 지갑 바이인 1500+수수료 150 에스크로라 **휴먼 6명 전용**(봇 채우기 불가,
  fillWithBots가 거부하고 UI도 버튼 숨김), practice는 무료(지갑 무관, entryBuyIn/Fee 없음, 상금은
  칩 풀 기반 표시용). **시작 규칙**: 자동 봇 충원 없음 — 6인이 모두 모여야 자동 시작, 또는
  (practice 한정) 방장(`RoomConfig.hostId`, `state.hostId`로 노출)이 'sng-fill-bots'로 남는 자리를
  봇 충원(`RoomManager.fillWithBots`). 시작 후 재충원·중도 참가·리바이 금지. 탈락한 휴먼은 좌석 유지
  상태로 관전(EliminationNotice가 순위 안내). 종료된 방은 결과 확인을 위해 10분 보존한 뒤
  `disposeRoom()`으로 정리하며, 연결된 참가자마다 `room-lost`를 한 번 보내고 모든 참가 세션의
  `roomId`를 비운다. 그 전에 모든 휴먼이 완전히 나가면 즉시 정리한다.
- **채팅은 프리셋 전용**: 휴먼 채팅은 `src/lib/chat/presets.ts`의 presetId만 서버(send-chat)가
  수용 — 욕설/비하 원천 차단 설계라 자유 텍스트 입력을 되살리지 말 것. 클라이언트 텍스트는
  신뢰하지 않고 서버가 id→문구 조회. UI는 ChatPresetPicker (카테고리 탭 + 탭 즉시 전송). 휴먼·
  시스템·봇 메시지는 모두 `appendChatMessage()`를 통과해 방별 최신 100개만 보존하고,
  `getChatHistory()`는 내부 배열의 복사본을 반환한다.
- **캐시 방 봇 정책**: `RoomConfig.botCount`(0~5, 기본 2)까지만 충원. 봇 좌석은 만석이 아님 —
  만석 입장 시 봇이 자리를 양보한다 (핸드 사이 즉시, 핸드 중엔 pendingRemoval + 재시도 안내).
  로비 만석 판정은 humanCount 기준 (RoomList.isRoomFull).
- **테이블 인원 구성**: `RoomConfig.tableType: 'bots'|'mixed'|'humans'` — UI 라벨은
  '🎯 혼자 연습'/'봇+사람'/'사람만'. bots를 '봇 전용'으로 부르지 말 것 (AI끼리 논다는 오해를
  부른다 — 차별점은 봇 상대가 아니라 다른 사람이 못 낀다는 점). bots는 휴먼 1명 제한
  (서버 이중 가드: socket-handler join-room + RoomManager.joinRoom, 로비 표기 '연습 중'),
  mixed는 기존 봇 양보 동작, humans는 봇 충원 0. create-room에서 botCount를
  구성이 결정(bots=5/mixed=1~5/humans=0), SnG는 mixed 고정. 로비에 구성 배지+필터 노출,
  기본 방에 봇 전용 'Practice Dojo' 추가(나머지 3개는 mixed). 좌석 UI는 봇에게 상시 BOT
  뱃지(PlayerSeat — `player.type`은 getPublicState로 이미 공개됨). 회귀:
  `room-manager.tabletype.test.ts`.
- **방 비밀번호/초대**: `RoomConfig.password`는 서버 전용(절대 gameState로 노출 금지),
  목록엔 `hasPassword`만 노출. join-room에서 검증. 초대 링크는 `/?room=<id>` — page.tsx가
  파싱해 닉네임 입력 후 JoinRoomModal 자동 오픈.
- **캐시 바이인**: 40~200BB 범위를 서버가 강제(create-room에서 min/maxBuyIn 재계산, join-room에서
  클램프). 입장 시 JoinRoomModal 슬라이더로 선택.

- **문의/건의(피드백)**: 로비 헤더 💬 → FeedbackModal → `POST /api/feedback` (프로필 쿠키 인증,
  분류 bug/idea/other + 내용 5~500자 — 검증 단일 소스는 `src/lib/feedback/rules.ts`, 클라·서버 공용).
  SQLite `feedback` 테이블(내용 불변 트리거, 프로필 삭제 시 profile_id만 NULL)에 영속.
  스팸 가드: IP당 5건/10분 + 프로필당 10건/일. 운영자 열람은
  `GET /api/debug/feedback?token=$DEBUG_LOG_TOKEN` (`&limit=&before=` 커서) — 별도 어드민 UI 없음.
  회귀: `feedback-http.test.ts`.
- **핸드 히스토리 (GGPoker PokerCraft 벤치마킹)**: 엔진이 핸드마다 진행 기록을 축적해
  endHand에서 완성한다 (`getCompletedHandRecord()`, 타입은 `src/lib/poker/hand-history.ts`) —
  블라인드 포스트 포함 액션 타임라인·스트리트별 보드·포지션·승자·수익·revealed.
  **revealed 판정은 getPublicState와 동일 계약**(경합 쇼다운/올인 런아웃 생존자만) — 어긋나면
  머킹 패가 히스토리로 유출된다. 원본 레코드는 전체 홀카드를 담으므로 브로드캐스트·로그 금지.
  RoomManager `handleCompletedHand`가 정산 성공 여부와 무관하게 방·핸드당 1회
  `options.handHistory.recordCompletedHand`(→ `HandHistoryService`) 호출, 참여 휴먼별
  "히어로 관점"으로 마스킹(상대 홀카드는 revealed만, 아니면 null)해 SQLite `hand_history`
  (마이그레이션 v21)에 영속 — 프로필당 최근 500핸드 보존, 초과분 자동 정리. 저장 실패는
  삼켜서 다음 핸드 진행을 막지 않는다. 조회는 `GET /api/hands`(목록, `?limit=&before=` 커서)
  / `GET /api/hands/:id`(상세, 본인 소유만 — 타인은 404로 존재 비노출), 프로필 쿠키 인증
  + 30회/분 제한. UI는 LobbyHeader·TopBar ⟲ 아이콘 → `HandHistoryModal`(목록 → 스트리트별
  액션 리플레이 상세). 마이그레이션 추가 시 `database.test.ts`의 최신 버전 상수도 함께 올릴 것.
  회귀: `engine.handrecord.test.ts`, `hand-history-http.test.ts`,
  `room-manager.hand-history.test.ts`.
- **운영 HTTP/플레이 이벤트 로그 (버그 역추적)**: 커스텀 HTTP 서버가 `GET|HEAD /healthz`를
  Next 핸들러 없이 직접 처리한다. `src/server/event-log.ts`의 인메모리 링 버퍼(5000개)
  + stdout `[evt] {json}` 한 줄. 조회는 `GET /api/debug/log?token=$DEBUG_LOG_TOKEN`
  (`&room=&player=&type=&limit=`) — 커스텀 서버(`server/index.ts`)가 직접 처리한다
  (Next 라우트로 옮기면 번들 경계에서 링 버퍼가 쪼개진다). `DEBUG_LOG_TOKEN` 미설정 시 403.
  기록: connect(tokenHint로 세션 구분)·join-room(request/seated/reject+좌석 스냅샷)·leave-room·
  player-action(거부 시 액션 전 스냅샷+valid 목록 — 먹통 버튼 추적의 핵심)·disconnect·
  grace-expired·hand-start·hand-end(팟 불변식 potTotal/contributedTotal 검증).
  **절대 남기지 말 것**: 세션 토큰 원문, 방 비밀번호, 홀카드. Fly엔 볼륨이 없어 재배포 시 소멸.
- **정상 종료**: 종료 컨트롤러는 idempotent하며 runtime(세션·방·타이머) → Socket.IO → HTTP → Next
  순서로 닫는다. `SIGTERM`/`SIGINT` 핸들러는 listen 성공 뒤 한 번만 등록하고, production 종료가
  10초를 넘기면 강제 실패 종료한다. 시작 실패도 생성된 자원을 같은 경로로 정리하고 nonzero로 끝낸다.

## 주요 디렉토리

- `src/server/` — 커스텀 서버, 소켓 핸들러, RoomManager(방/타이머/봇), SessionManager
- `src/lib/poker/` — 순수 게임 로직 (engine, evaluator, deck, types) + 테스트
- `src/lib/bot/` — 봇 AI. **HUD 스탯 기반**: `personalities.ts`가 캐릭터별 HUD DB
  (vpip/pfr/threeBet/coldCall/foldToThreeBet/limp/steal/cbetFlop·Turn/foldToCbet/checkRaise/
  donkBet/wtsd/riverBluff/semiBluff/slowPlay/aggression + 사이징, % 0~100) — 수치를 바꾸면
  그 봇의 스타일이 바뀐다. 해석 계약: **레인지 스탯**(vpip/pfr/3bet/coldCall)은
  `hand-rankings.ts`(Chen formula 169핸드 콤보 가중 백분위)와 비교한 "상위 X% 레인지",
  **빈도 스탯**(cbet 등)은 매 상황 독립시행(`rng() < stat/100`). `bot-ai.ts`의
  `decideBotAction(..., rng)`은 rng 주입으로 테스트 결정론화 (`bot-hud.test.ts`).
  c벳 스팟 판정은 `GameState.lastAggressorId`(엔진이 벳/레이즈마다 갱신). 숏스택(≤10BB)
  푸시/폴드 레이어와 딥스택 커밋 가드는 스탯 무관 결정론 — 테스트가 의존하므로 유지할 것.
- `src/lib/characters/` — 캐릭터 프로필/배경서사/한국어 대사. 다국적 로스터: 딜러 미야코(일본),
  사쿠라(일본·록), 아라(한국·LAG 츤데레), 하나(한국·TAG 분석가), 클로이(미국·콜링 스테이션
  스트리머), 비비안(프랑스·매니악 前 배우), 엘레나(러시아·밸런스드 프로). 캐릭터 id가
  아트 폴더·HUD 스탯·대사 풀의 공용 키 — id 변경 시 셋 다 함께 옮길 것 (2026-07 개편:
  ryuka→ara, yuki→chloe, akira→vivian, reika→elena, 일러스트는 재사용).
  2026-07-20 확장(+10, 총 봇 16명): 마스코트 7 — 모찌(햄스터·슈퍼 니트), 초코(시바견·ABC 정직),
  루나(검은 고양이·트래퍼), 구미(구미호·블러프 아티스트), 팽팽(펭귄·3벳 폭격기/콜드콜 없음),
  드라코(아기 드래곤·드로우 겜블러), 카피(카피바라·평화주의 림퍼) + 인간 3 — 유즈키(일본
  무녀·직감 돈크벳), 린(대만 차예사·스몰볼), 잉그리드(노르웨이 드러머·타이트 매니악).
  마스코트도 인간과 동일한 CharacterProfile/HUD 스탯 계약을 따른다 (나이·국적은 세계관 표기).
- `src/lib/sound/` — 효과음은 Web Audio 합성(에셋 없음), BGM은 `music-manager.ts`가
  `public/assets/music/{lobby,table,tension,victory}.mp3`(Suno 생성) 재생 — 장면 전환은
  로비(page.tsx)/테이블·우승(GameRoomView)/올인 긴장(game-events 구독), 설정에 효과음과
  별개 배경음악 토글(`musicMuted`)
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
  (솔리드 기본/빅랭크 — 클래식은 2026-07-21 삭제, persist v3가 solid로 마이그레이션)×컬러(2/4컬러),
  딜러 아바타/말풍선 토글. 진입점은 TopBar ⚙️ → SettingsModal.
- 카드 수트 색은 `globals.css @theme`의 `suit-*` 토큰 + `card-theme.ts` 매핑이 단일 소스.
- `public/assets/` — Codex(gpt-image)로 생성한 캐릭터 일러스트 17명×3표정(딜러 미야코+봇 16명),
  로고, 로비 배경

## 컨벤션

- UI 텍스트·시스템 채팅·캐릭터 대사는 한국어. 캐릭터별 말투 유지 (류카=츤데레 반말, 하나=분석 존댓말 등).
- 디자인 토큰은 `globals.css @theme` (blossom/cyber/mystic/gilded/panel 등) — 새 색상 하드코딩 금지.
- framer-motion 요소에서 Tailwind `-translate-*` 클래스와 transform 애니메이션을 섞지 말 것
  (framer가 transform을 덮어씀) — `style={{ x: '-50%', y: '-50%' }}` 사용.
- eslint react-hooks 순수성 규칙: effect 본문에서 직접 setState 금지 (외부 시스템 콜백에서만),
  렌더 중 `Date.now()` 금지.
- 카드/칩/버튼은 SVG/CSS로 제작. 이미지 생성은 캐릭터/배경/로고만.

## 미구현 (알려진 범위 제외)

- 비참가자 관전 모드(방에 안 앉고 구경 — 파산 좌석은 30초 리바이 유예 동안만 관전 가능,
  SnG 탈락자 관전은 토너먼트 종료까지 구현됨),
  멀티 테이블 동시 플레이(1세션 1테이블)
- 멀티 테이블 토너먼트(MTT) — 시트앤고(단일 테이블)만 구현됨
- `/healthz`와 보호된 debug-log endpoint 외에 별도 어드민 UI/대시보드는 없다. 방 운영 가드는 최소한만: 방 수 상한(MAX_ROOMS=30),
  휴먼 0명 유저 방 10분 후 자동 정리(기본 방 4개는 persistent로 제외)
- 영속성 없음 — 전부 인메모리, 서버 재시작 시 초기화. 단일 인스턴스 전제.
- 계정 없음 — 신원은 localStorage 세션 토큰뿐. **다른 기기·브라우저·시크릿창 = 다른 사람**이라
  이전 좌석이 유예 동안 오프라인으로 남고 새 좌석이 생긴다("○○가 2명" 현상 — 서버 로직은 정상,
  같은 브라우저로 돌아오면 좌석 복귀). 근본 해결엔 계정 체계가 필요하다.
