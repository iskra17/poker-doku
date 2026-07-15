# Poker Doku 멀티플레이 안정성·게임 UX 설계

**작성일:** 2026-07-15  
**상태:** 사용자 서면 검토 대기  
**배포 전제:** Fly.io 도쿄 단일 머신, 인메모리 상태, 최대 30개 방, 테이블당 6명

## 1. 목적

여러 휴먼이 동시에 접속·입장·액션·이탈·재접속·방 전환을 해도 다음 조건을 만족하게 한다.

- 한 세션은 한 시점에 하나의 소켓과 하나의 테이블만 제어한다.
- 이전 소켓, 이전 방, 이전 턴의 이벤트가 현재 게임 상태를 바꾸지 못한다.
- 잘못된 Socket.IO payload가 프로세스 예외나 다른 플레이어의 상태 손상을 일으키지 않는다.
- 장시간 운영해도 세션, 채팅, 종료된 방, 방별 AI 상태가 무한히 누적되지 않는다.
- 네트워크가 끊기거나 서버가 액션을 거절하면 사용자가 원인과 현재 상태를 즉시 이해한다.
- 핵심 보장은 실제 Socket.IO 클라이언트 여러 개를 사용하는 자동 통합 테스트로 증명한다.

## 2. 현재 상태에서 확인된 결함

### 2.1 소켓 소유권

`SessionManager.resolve()`는 같은 토큰으로 새 소켓이 연결되면 이전 `socketId` 매핑만 지운다.
이전 소켓 연결과 이벤트 핸들러는 살아 있고, 핸들러 클로저는 새 소켓과 같은 `Session` 객체를
참조한다. 따라서 이전 탭이 새 탭이 보고 있는 방에 액션·채팅·퇴장 이벤트를 보낼 수 있다.

### 2.2 방 경계 없는 개인 스냅샷

`RoomManager.onUpdate`의 개인 `game-update` 전송은 플레이어가 해당 엔진에 남아 있는지만 보고,
세션의 현재 `roomId`가 업데이트의 방과 같은지 확인하지 않는다. 핸드 중 이전 방을 떠난 플레이어는
`pendingRemoval`로 남으므로 이전 방 상태가 새 방의 현재 소켓에 전송될 수 있다. 클라이언트도
`currentRoomId`가 null인지 여부만 확인하고 업데이트가 어느 방에서 왔는지 검증하지 않는다.

### 2.3 액션 중복과 오래된 상태

현재 액션 payload에는 클라이언트가 보고 있던 `handNumber`와 `actionSeq`가 없다. 헤즈업에서
프리플랍 마지막 액터와 플랍 첫 액터가 같은 경우, 더블 클릭한 두 번째 체크가 다음 스트리트의
체크로 실행될 수 있다. 연결이 끊긴 상태에서 `socket.emit()`을 호출하면 Socket.IO 버퍼에 남은
입력이 재접속 후 전달될 수도 있다.

### 2.4 런타임 입력 검증 부재

TypeScript 이벤트 타입은 런타임 보장이 아니다. `join-room(null)`, `create-room(null)`,
`player-action(null)` 같은 입력은 핸들러의 속성 접근에서 예외를 낼 수 있다. 숫자에도 `Infinity`,
`NaN`, 객체형 문자열 등 비정상 값이 들어올 수 있다.

### 2.5 수명주기 누수

- 방에 들어간 적 없는 연결도 disconnect 후 `SessionManager`의 세 Map에 남는다.
- 시스템·봇 채팅은 휴먼 채팅과 달리 100개 상한을 적용하지 않는다.
- 영속 기본 방이 비어도 이전 채팅, `handNumber`, `actionSeq`가 남는다.
- 종료된 SnG에서 끊긴 휴먼 좌석은 계속 보존될 수 있어 방과 세션이 회수되지 않는다.
- AI 대사의 `lastCallByRoom`은 삭제된 방 ID를 정리하지 않는다.

### 2.6 플레이 피드백 부족

- 서버가 액션을 거절해도 클라이언트에는 결과를 보내지 않는다.
- 연결이 끊겨도 액션 버튼이 활성화되어 있다.
- 입장 승인 전에 `currentRoomId`를 설정해 빈 테이블 로딩 화면으로 먼저 이동한다.
- 모바일 채팅 배지는 미확인 수가 아니라 전체 기록 수를 표시한다.
- 채팅 제목과 빈 상태 문구에 영문이 남아 있다.

## 3. 범위 분해

전체 작업은 독립적으로 배포·검증할 수 있는 세 하위 프로젝트로 나눈다.

1. **실시간 프로토콜과 세션 격리**
   - typed protocol, 런타임 파서, 단일 활성 소켓, 방 경계, 액션 버전 검증, 작업별 ack,
     안전한 방 전환, 실제 Socket.IO 통합 테스트
2. **서버 수명주기와 운영 안정성**
   - 세션/채팅/방/AI 상태 상한, 종료 SnG 회수, 중앙 dispose, `/healthz`, 정상 종료,
     origin·요청 빈도 방어
3. **게임 플레이 복구 UX와 입력 피드백**
   - 재연결 상태, 액션 처리 중·거절 피드백, 입장 대기, 채팅 미확인 수, 전면 한국어,
     액션 버튼 의미 구분

각 하위 프로젝트는 별도의 구현 계획과 TDD 사이클을 사용한다. 다음 단계가 이전 단계의 공개 계약을
사용하므로 위 순서대로 진행한다.

## 4. 하위 프로젝트 1: 실시간 프로토콜과 세션 격리

### 4.1 공유 프로토콜 타입

`src/lib/realtime/protocol.ts`를 서버와 클라이언트가 함께 사용한다. Socket.IO의
`ClientToServerEvents`와 `ServerToClientEvents`를 명시하고, 요청 응답은 다음 공통 ack 형태를 쓴다.

```ts
export type RealtimeAck<T = undefined> =
  | { ok: true; data?: T }
  | { ok: false; code: RealtimeErrorCode; message: string };

export interface GameUpdatePayload {
  roomId: string;
  state: GameState;
}
```

`RealtimeErrorCode`는 최소한 `invalid-payload`, `rate-limited`, `room-not-found`,
`room-full`, `bad-password`, `session-replaced`, `stale-state`, `not-your-turn`,
`action-rejected`, `join-timeout`을 포함한다. 사용자 문구는 서버 또는 공용 매핑에서 한국어로
결정하며 클라이언트가 임의 서버 오류 문자열을 조합하지 않는다.

### 4.2 런타임 파서

`src/server/socket-payload.ts`는 모든 외부 입력을 `unknown`으로 받고 다음 원칙으로 파싱한다.

- 객체 여부를 먼저 확인한 뒤 속성에 접근한다.
- room ID는 비어 있지 않은 길이 100 이하 문자열만 허용한다.
- 닉네임은 제어 문자를 제거하고 trim 후 1~24자로 제한한다.
- 방 이름은 제어 문자를 제거하고 trim 후 1~40자로 제한한다.
- 숫자는 `Number.isFinite`를 통과한 값만 사용하며 정수화·범위 제한은 서버 정책으로 수행한다.
- action은 허용된 `ActionType`만 받는다.
- 비밀번호는 최대 20자이며 game state, room list, 로그에 포함하지 않는다.
- session token은 `/^[A-Za-z0-9._~-]{8,128}$/`를 만족할 때만 안정 세션 키로 사용한다. 그 외 값은 해당
  소켓에만 유효한 임시 세션으로 처리한다.

파서 실패는 프로세스 예외가 아니라 `invalid-payload` ack가 된다. 실패 payload 전체는 로그에
남기지 않고 이벤트명과 안전한 사유 코드만 남긴다.

### 4.3 단일 활성 소켓

`SessionManager.resolve()`는 세션과 함께 교체된 이전 `socketId`를 반환한다. 새 연결이 소유권을
획득하면 서버는 이전 소켓에 `session-replaced`를 보낸 뒤 `disconnect(true)`로 종료한다. 서버가
끊은 Socket.IO 연결은 자동 재접속하지 않으므로 두 탭이 서로 재접속시키는 루프를 만들지 않는다.

모든 상태 변경 이벤트에는 공통 소유권 가드를 한 번 더 적용한다.

```ts
sessions.isCurrentSocket(session.playerId, socket.id)
```

가드 실패 이벤트는 상태를 바꾸지 않는다. 이전 소켓의 disconnect는 최신 세션의 grace 타이머를
시작하지 않는다.

### 4.4 방이 포함된 상태 전송

개인 업데이트는 다음 두 조건을 모두 만족할 때만 전송한다.

- 해당 플레이어의 최신 세션 소켓이 존재한다.
- `session.roomId === updateRoomId`이다.

`game-update`는 `{ roomId, state }` envelope로 보낸다. 클라이언트는
`payload.roomId === currentRoomId`일 때만 적용한다. `pendingRoomId`는 입장 요청 UI에만 쓰며
일반 업데이트를 받을 권한으로 사용하지 않는다. `room-joined`가 현재 방을 확정하는 유일한 이벤트다.

### 4.5 버전이 붙은 플레이어 액션

클라이언트는 액션마다 보고 있던 상태 버전을 함께 보낸다.

```ts
export interface PlayerActionRequest {
  roomId: string;
  action: ActionType;
  amount?: number;
  expectedHandNumber: number;
  expectedActionSeq: number;
}
```

서버는 세션 방, 엔진 방, `handNumber`, `actionSeq`가 모두 일치할 때만 엔진에 전달한다. 첫 액션이
성공하면 `actionSeq`가 증가하므로 같은 화면에서 발생한 두 번째 클릭은 `stale-state`가 된다.
서버는 성공·거절 모두 ack하고, 클라이언트는 ack 또는 다음 스냅샷을 받기 전까지 액션 버튼을
잠근다. 3초 안에 ack가 없으면 잠금을 풀고 resync를 요청하며 임의 재전송은 하지 않는다.

클라이언트는 `socket.connected === false`일 때 상태 변경 이벤트를 emit하지 않는다. 특히 액션은
Socket.IO 오프라인 버퍼에 넣지 않는다.

### 4.6 안전한 입장과 방 전환

입장 처리는 Node 단일 이벤트 루프 안에서 다음 순서로 동기 커밋한다.

1. payload, 비밀번호, SnG 잠금, 연습방 휴먼 제한을 검증한다.
2. 목표 방에 기존 좌석이 있으면 복귀 가능성을 판단한다.
3. 신규 좌석이면 빈 좌석 또는 즉시 양보 가능한 봇 좌석을 확보한다.
4. 목표 방의 add/rejoin이 성공한 뒤에만 다른 방의 좌석을 정리한다.
5. 이전 Socket.IO room에서 leave하고 새 room에 join한다.
6. `session.roomId`를 새 방으로 바꾸고 `room-joined` 스냅샷을 보낸다.

목표 방이 만석이거나 핸드 중 봇 양보를 기다려야 하면 기존 좌석은 그대로 유지한다. 이 경우
`room-full` 또는 현재 정책의 `bot-seat-pending` ack를 보낸다. 같은 요청의 반복은 기존 좌석 복귀
경로로 처리되어 중복 플레이어를 만들지 않는다.

## 5. 하위 프로젝트 2: 서버 수명주기와 운영 안정성

### 5.1 세션 회수

`SessionManager`는 다음 조건을 모두 만족하는 세션을 즉시 제거한다.

- `socketId === null`
- `roomId === null`
- 활성 grace 타이머가 없음

로비에서 끊긴 세션은 disconnect 시 제거한다. grace 만료 후 좌석도 제거되면 `roomId`를 비우고
세션을 제거한다. 좌석이 보존된 캐시 자리비움과 진행 중 SnG는 재접속 계약 때문에 유지한다.
테스트·보호된 debug 통계를 위해 현재 session/socket/grace 개수만 노출한다.

### 5.2 방과 타이머의 중앙 dispose

방 삭제는 `RoomManager.disposeRoom(roomId)` 한 경로만 사용한다. 이 함수는 봇 루프, 턴 타이머,
핸드 시작 타이머, 자리비움 회수 타이머, 토너먼트 시계, 채팅, epoch, AI 방별 상태를 모두 지운다.
전체 서버 종료용 `RoomManager.dispose()`도 제공한다.

종료된 SnG는 결과 화면을 볼 수 있도록 10분간 유지한 뒤 정리한다. 그 전에 모든 휴먼이 완전히
나가면 즉시 정리한다. 시간 만료 시 연결된 참가자에게 `room-lost`를 보내고 세션의 `roomId`를
비운 뒤 로비 목록을 갱신한다.

### 5.3 채팅 상한과 영속 방 초기화

모든 채팅 종류는 하나의 `appendChatMessage()`를 통과하며 방당 최근 100개만 보존한다.
`getChatHistory()`는 내부 배열의 복사본을 반환한다.

영속 기본 방의 마지막 휴먼이 떠나면 다음 상태를 새 세션 기준으로 초기화한다.

- 채팅 기록
- `handNumber`, `actionSeq`, `lastAction`, `lastAggressorId`
- 보드, 팟, 승자, 액터·딜러 인덱스, 토너먼트 결과·시계
- 남은 봇과 플레이어

따라서 새 연습 플레이어가 이전 사용자의 이름·프리셋 채팅이나 `핸드 #14` 같은 카운터를 보지 않는다.

### 5.4 운영 경계

- `GET /healthz`는 Next 렌더링 없이 `{ "ok": true }`를 반환하며 Fly health check가 사용한다.
- `setupSocketHandlers()`는 sweep interval과 runtime 참조를 반환하고 종료 시 정리할 수 있어야 한다.
- `SIGTERM`과 `SIGINT`에서 신규 연결을 중단하고 Socket.IO와 HTTP 서버를 정상 종료한다.
- production Socket.IO origin은 동일 호스트 또는 `SOCKET_ALLOWED_ORIGINS`의 명시적 목록만 허용한다.
  origin이 없는 Node 클라이언트는 통합 테스트와 비브라우저 도구를 위해 허용한다.
- 액션은 2초당 12회, 입장은 10초당 5회, resync와 방 목록 요청은 합산 5초당 10회로 소켓별
  sliding-window 제한을 둔다. 방 생성은 기존 5초당 1회, 채팅은 기존 700ms당 1회를 유지한다.
  초과 요청은 `rate-limited`로 조용히 거절해 stdout 로그 증폭을 막는다.
- Fly 단일 머신·수직 확장 전제는 유지하며 Redis나 다중 인스턴스 동기화는 도입하지 않는다.

## 6. 하위 프로젝트 3: 게임 플레이 복구 UX와 입력 피드백

### 6.1 연결 상태

테이블 상단에 다음 상태를 텍스트와 색으로 함께 표시한다.

- 연결됨: 기존 작은 표시 유지
- 재연결 중: `연결이 끊겼어요. 안전하게 다시 연결하는 중…`
- 다른 탭에서 교체됨: `다른 탭에서 게임을 열어 이 탭의 연결이 종료됐어요.`
- 방 소실: 기존 `room-lost` 안내 후 로비 이동

재연결 중에는 액션, 채팅, 자리비움, 타임뱅크 입력을 비활성화한다. 테이블 스냅샷은 그대로 보여
사용자가 마지막 상태를 이해할 수 있게 하되, 조작 가능해 보이지 않게 한다.

### 6.2 입장 대기

`joinRoom()`은 `pendingRoomId`만 설정한다. 로비 카드와 모달에 `입장 확인 중…` 상태를 표시하고
`room-joined`가 와야 `currentRoomId`를 설정한다. 거절 또는 8초 timeout이면 현재 로비와 기존
보존 좌석을 유지한 채 해당 카드에 한국어 사유를 표시한다.

### 6.3 액션 피드백

- 클릭 즉시 선택한 액션 버튼에 처리 중 표시를 하고 나머지 액션을 잠근다.
- 성공 ack 또는 더 최신 `actionSeq` 스냅샷이 오면 처리 중 상태를 해제한다.
- `stale-state`이면 최신 상태를 요청하고 `상태가 바뀌어 액션을 다시 선택해 주세요.`를 표시한다.
- 연결·timeout이면 `액션 전송을 확인하지 못했어요. 현재 상태를 다시 불러왔습니다.`를 표시한다.
- 서버가 거절한 이유를 로비용 `joinError`로 보내 현재 테이블을 지우지 않는다.

액션 버튼은 디자인 토큰을 확장해 의미를 구분한다. 폴드는 중립, 체크·콜은 `cyber`, 벳·레이즈는
`blossom`, 올인은 `danger` 토큰을 사용한다. 색만으로 구분하지 않고 기존 한국어 라벨을 유지한다.

### 6.4 채팅

- `Chat`은 `채팅`, `No messages yet...`는 `아직 메시지가 없어요.`로 바꾼다.
- 모바일 배지는 패널이 닫힌 동안 새로 도착한 메시지만 센다.
- 패널을 열면 미확인 수를 0으로 만들고, 새 방 입장 시에도 초기화한다.
- 최대 표시 수는 `99+`이며 전체 채팅 기록 수를 미확인 수로 사용하지 않는다.

## 7. 오류 처리 계약

| 상황 | 서버 상태 변경 | 클라이언트 반응 |
|---|---:|---|
| malformed payload | 없음 | 작업별 한국어 오류, 현재 방 유지 |
| 이전 소켓 이벤트 | 없음 | 이전 소켓 종료 화면 유지 |
| 이전 방 업데이트 | 전송하지 않음 | 방 ID 불일치 payload도 폐기 |
| stale action version | 없음 | resync 후 재선택 안내 |
| 목표 방 입장 실패 | 기존 좌석 유지 | 로비 카드에 실패 사유 표시 |
| 액션 ack timeout | 임의 재전송 없음 | 입력 잠금 해제 후 resync |
| grace 내 재접속 | 좌석·칩 유지 | 한 번의 복구 스냅샷 적용 |
| grace 만료 캐시 비자리비움 | 좌석·세션 제거 | 다음 연결에서 로비 안내 |
| 종료 SnG 보존 만료 | 방·좌석·세션 연결 정리 | 결과 보존 종료 후 로비 이동 |

## 8. 테스트 목표

### 8.1 실제 Socket.IO 통합 테스트

테스트 전용 ephemeral HTTP 서버와 `socket.io-client`를 사용한다. runtime은 기본 방 생성과 sweep
주기를 선택적으로 끌 수 있고, 테스트 종료 시 모든 소켓·타이머를 닫는다.

필수 시나리오는 다음과 같다.

1. 서로 다른 토큰 6개가 동시에 사람만 방에 입장하면 player ID와 seat index가 모두 유일하다.
2. 7번째 입장은 안전하게 거절되고 기존 6개 좌석과 요청자의 이전 방 좌석은 바뀌지 않는다.
3. 같은 토큰의 두 번째 연결이 오면 첫 소켓은 교체되고 이후 액션·퇴장에 성공할 수 없다.
4. 핸드 중 A방에서 B방으로 이동한 세션은 A방의 개인 `game-update`를 받지 않는다.
5. 서로 다른 두 방의 update envelope를 주입해도 클라이언트 상태 적용기는 현재 room ID만 적용한다.
6. 같은 `expectedActionSeq`의 액션 두 개를 보내면 정확히 하나만 성공하고 엔진 `actionSeq`도 1만 증가한다.
7. `null`, 배열, 빈 객체, `Infinity`, 과도한 문자열 payload 뒤에도 같은 소켓의 `get-rooms`가 정상 응답한다.
8. disconnect 후 grace 내 같은 토큰 재접속은 player ID, 좌석, 칩을 보존하고 복구 공지를 한 번만 만든다.
9. 연결되지 않은 클라이언트의 액션 helper는 emit하지 않으며 재연결 후 자동 재생하지 않는다.

### 8.2 수명주기 테스트

1. 방에 들어가지 않은 세션은 disconnect 후 Map에서 제거된다.
2. grace 만료로 좌석이 제거된 세션도 제거된다.
3. 시스템·봇·휴먼 메시지를 섞어 150개 추가해도 기록은 최신 100개다.
4. 영속 방 reset 후 채팅은 0개, `handNumber`와 `actionSeq`는 0이다.
5. 종료 SnG 보존 시간이 지나면 방, 관련 타이머, 방별 AI 상태가 모두 제거된다.
6. runtime dispose 후 열린 interval과 timeout이 남지 않는다.
7. `/healthz`는 Next handler를 호출하지 않고 200 JSON을 반환한다.

### 8.3 UX 상태 테스트

네트워크 UI 판단은 순수 상태 전이 함수로 분리해 Vitest에서 검증한다.

1. join 요청만으로 현재 방이 바뀌지 않고 성공 ack/`room-joined`에서만 바뀐다.
2. disconnected 또는 action pending이면 액션 전송 가능 상태가 false다.
3. action ack success/stale/timeout이 각각 올바른 한국어 안내 상태를 만든다.
4. 다른 방 update는 상태와 게임 이벤트 diff를 모두 발생시키지 않는다.
5. 모바일 채팅 미확인 수는 닫힌 동안만 증가하고 열기·방 전환에서 0이 된다.

### 8.4 최종 게이트

아래 명령을 모두 새로 실행하고 exit code 0을 확인한다.

```bash
npm test
npm run lint
npx tsc --noEmit
npm run build
```

추가로 통합 테스트에서 소켓·타이머 미정리 경고가 없어야 하며, 실제 데스크톱과 모바일 크기에서
입장, 액션 처리 중, 연결 끊김, 재접속, 나가기·복귀 흐름을 확인한다.

## 9. 비목표

- Redis adapter 또는 여러 Fly 머신 간 상태 공유
- 계정·비밀번호 로그인과 다른 기기 간 좌석 복원
- 데이터베이스 영속화
- 비참가자 관전 모드, MTT, 멀티 테이블 동시 플레이
- 자유 텍스트 채팅
- 기존 포커 엔진의 팟·쇼다운 규칙 변경

이 항목은 현재 프로젝트의 단일 인스턴스·세션 토큰 모델을 넘어서는 별도 제품 설계가 필요하다.

## 10. 완료 정의

세 하위 프로젝트의 테스트 목표와 최종 게이트가 모두 통과하고, 코드 감사에서 다음을 직접 확인해야
완료로 판단한다.

- 모든 외부 Socket.IO payload가 런타임 파서를 통과한다.
- 모든 개인 상태 전송과 클라이언트 적용에 room ID 검증이 있다.
- 모든 상태 변경 이벤트에 최신 소켓 소유권 검증이 있다.
- 액션에는 hand/action 버전 검증과 ack가 있다.
- 세션·채팅·방·타이머·AI 상태의 생성과 정리 경로가 쌍을 이룬다.
- 연결·입장·액션 오류가 현재 게임을 지우는 전역 오류 처리로 합쳐지지 않는다.
- UI 문구는 한국어이고 새 색상은 `globals.css @theme` 토큰에서만 정의한다.
