# 수련 스토리 가면 봇 identity 분리 기반 설계

## 배경과 목표

향후 수련 스토리에서 실제 캐릭터를 가면으로 숨겼다가 서버가 정한 전환점에 공개하려면, 봇의 포커 성향과 화면에 보이는 정체성을 분리해야 한다. 현재는 `Player.personalityId`, `Player.avatar`, `Player.name`, `Player.id`가 모두 실제 캐릭터를 직간접적으로 드러낸다. 특히 봇 ID가 `bot-${character.id}-...` 형식이고, 일부 클라이언트가 `personalityId` 또는 `playerId`를 캐릭터 조회 키로 사용한다.

이 기반 작업은 승인된 접근 1을 따른다.

- `Player.personalityId`는 서버 내부의 행동·성향 키로 유지한다.
- 공개 표시 identity는 기존 `Player.name`과 `Player.avatar`만 사용한다. `avatar` 값은 공개 캐릭터/가면 프로필의 `characterId`다.
- `Player.id`는 실제 캐릭터를 인코딩하지 않는 불투명 식별자다.
- 가면 해제는 서버가 같은 `Player`의 `name`과 `avatar`만 실제 캐릭터 값으로 바꾸는 표시 전환이다. `personalityId`와 `id`는 바꾸지 않는다.

따라서 가면을 쓴 동안에도 봇의 판단과 난이도는 실제 `personalityId`를 그대로 따르며, 클라이언트에는 가면 이름·아바타·공용 대사만 보인다.

## identity 계약

| 구분 | 필드 | 소유자 | 공개 여부 | 변경 규칙 |
|---|---|---|---|---|
| 행동 identity | `Player.personalityId` | 서버 | 비공개 | 봇 생성 후 가면 해제에도 불변 |
| 표시 identity | `Player.name` | 서버가 결정, 클라이언트가 표시 | 공개 | 가면 이름에서 실제 이름으로 전환 가능 |
| 표시 identity | `Player.avatar` | 서버가 결정, 클라이언트가 표시 | 공개 | 가면 `characterId`에서 실제 `characterId`로 전환 가능 |
| 개체 identity | `Player.id` | 서버 | 공개하되 의미 없음 | 생성 후 불변, 실제 캐릭터 문자열 포함 금지 |
| 채팅 스냅샷 | `ChatMessage.playerName`, `ChatMessage.characterId` | 서버 | 공개 | 메시지 생성 시점의 표시 identity로 고정 |

`createBotWithCharacter`는 실제 캐릭터 ID와 별개로 다음 선택 인자를 받는다.

```ts
interface BotDisplayIdentity {
  name: string;
  characterId: string;
}
```

표시 identity가 없으면 기존처럼 실제 캐릭터의 이름과 ID를 `name`과 `avatar`에 넣는다. 표시 identity가 있으면 `name`과 `avatar`에 각각 그 값을 넣되 `personalityId`는 실제 캐릭터 ID를 유지한다. 일반 `createBot`과 캐시·SnG·MTT 봇의 기본 동작은 바뀌지 않는다.

봇 ID는 `bot-<opaque token>` 형태로 만들 수 있지만 토큰 안에 캐릭터 ID, 이름, 좌석, 스토리 역할을 넣지 않는다. UUID 같은 서버 생성 고유 토큰을 사용하고, 모든 소비자는 ID를 동등성 비교와 이벤트 상관관계에만 사용한다. ID 문자열을 파싱해 타입이나 캐릭터를 추론하는 코드는 허용하지 않는다.

## 공개 상태와 불변성

`PokerEngine.state`의 `Player`에는 봇 판단을 위해 `personalityId`가 계속 존재한다. `getPublicState(forPlayerId)`는 공개 경계에서 모든 플레이어의 `personalityId`를 제거한다.

이때 내부 상태에서 `delete player.personalityId`를 실행하거나 원본 플레이어를 수정해서는 안 된다. `getPublicState`는 기존 홀카드 마스킹과 함께 다음 순서로 새 공개 스냅샷을 만든다.

1. 바깥 `GameState` 객체를 복제한다.
2. 각 내부 `Player`에서 `personalityId`를 구조 분해로 제외한다.
3. 공개용 플레이어 객체와 공개 또는 마스킹된 홀카드 배열을 새로 만든다.
4. 결과를 반환하되 `this.state`, 내부 `Player`, 실제 홀카드에는 어떤 변경도 남기지 않는다.

공개 프로토콜 타입은 `PublicPlayer = Omit<Player, 'personalityId'>`와 이를 사용하는 `PublicGameState`로 표현해 클라이언트가 다시 `personalityId`에 의존하지 못하게 한다. 엔진 내부와 봇 AI는 계속 `Player`/`GameState`를 사용한다. 공개 타입 분리는 런타임 삭제를 대신하지 않으며, 직렬화된 결과에 키 자체가 없다는 테스트가 최종 보안 계약이다.

## 가면 프로필과 봇 선택

공용 가면은 표시 전용 캐릭터 프로필로 등록한다. 좌석, 쇼케이스, 컷인, 채팅 색상과 이모지 fallback이 하나의 공개 `characterId`로 일관되게 렌더되어야 하기 때문이다.

- 가면 프로필 상수는 `MASKED_BOT_CHARACTER`, ID는 `story-mask`로 고정하고 `getCharacterById('story-mask')`로 조회할 수 있다.
- 가면 프로필에는 실제 캐릭터를 암시하지 않는 이름, 색, 이모지와 공용 승리·패배·폴드·블러프·일반 대사만 둔다.
- 가면 프로필은 `BOT_CHARACTERS` 배열에 넣지 않는다. `getRandomBotCharacter`, 해금, 인연, 도감, 파트너 선택의 후보가 되어서는 안 된다.
- 전용 일러스트가 아직 없거나 로드에 실패하면 기존 `CharacterImage`의 그라디언트·이모지 fallback을 사용한다. 실제 캐릭터 아트로 fallback하지 않는다.

`getUsedCharacterIds(engine)`는 표시용 `avatar`가 아니라 봇의 내부 `personalityId`를 계속 사용한다. 휴먼은 기존처럼 공개 프로필 `avatar`를 사용한다. 따라서 여러 봇이 같은 가면 아바타를 공유해도 실제 캐릭터 중복 방지 규칙은 유지된다.

## 스토리 매핑과 공개 전환

가면 매핑은 방이나 봇 ID가 아니라 수련 런의 라이브 세션이 소유한다. `LiveSession`에 좌석별 identity 계획을 보관한다.

```ts
type StoryBotIdentity = {
  seatIndex: number;
  personalityId: string;
  maskedDisplay: BotDisplayIdentity | null;
  revealed: boolean;
};
```

최초 `LiveTableAdapter.openRoom()`에서 라인업의 실제 캐릭터를 해석한 뒤 이 계획을 고정한다. 같은 런·같은 라이브 스텝에서 room-lost 후 새 방을 열 때는 라인업을 다시 추첨하거나 새 가면을 배정하지 않고 저장된 계획을 재사용한다. 일반 소켓 재접속은 기존 방의 서버 상태를 다시 받으므로 같은 표시 identity가 유지된다. `LiveSession`이 폐기되거나 다른 런·스텝으로 넘어갈 때만 계획도 폐기한다.

향후 Ch7가 사용할 서버 내부 API seam은 다음 두 동작만 제공한다.

1. 라이브 스텝 진입 입력에 좌석별 선택적 `BotDisplayIdentity`를 전달한다.
2. 서버가 `profileId + runId + seatIndex`로 해당 봇을 공개하라고 요청한다.

공개 요청은 세션 계획의 `revealed`를 먼저 고정한다. 현재 방이 있으면 어댑터가 `RoomManager.updateStoryBotDisplayIdentity`에 불투명 봇 ID와 실제 표시 identity를 전달하고, RoomManager가 스토리 방·봇 존재를 재검증한 뒤 그 봇의 `name`과 `avatar`만 갱신하여 새 공개 스냅샷을 브로드캐스트한다. 방이 없는 room-lost 상태라면 계획만 갱신하고 다음 방 생성 때 공개 상태로 만든다. 어느 경우에도 `personalityId`나 `Player.id`는 바꾸지 않는다. 이 API는 서버 코디네이터만 호출하며 클라이언트 소켓 명령으로 노출하지 않는다.

이번 기반 범위에는 이 seam을 소비하는 Ch7 챕터 데이터, 가면 정답, 퀴즈 판정, 공개 시점 연출이 포함되지 않는다.

## 공개 데이터 흐름

```text
실제 캐릭터 ID
  └─ 서버 createBotWithCharacter
       ├─ personalityId ──> bot-ai / getUsedCharacterIds / 서버 내부 스토리 판정
       ├─ name + avatar ──> getPublicState 정화 ──> game-update ──> 모든 좌석·컷인·말풍선·쇼케이스
       ├─ name + avatar ──> ChatMessage 스냅샷 ──> chat-message / chatHistory ──> ChatBubble
       └─ opaque id ──────> 액션·승자·채팅 상관관계만
```

클라이언트의 봇 시각·연출 경로는 모두 `player.avatar`만 캐릭터 조회 키로 쓴다.

- 좌석 아바타와 좌석 탭 쇼케이스
- 승자·패자 컷인
- 좌석 채팅 말풍선의 색상
- 테이블에 실제로 앉아 있는 파트너인지 확인하는 반응 연출
- 게임 이벤트가 운반하는 공개 플레이어 스냅샷

`player.personalityId || player.avatar` 같은 fallback은 제거한다. 공개 아바타가 없거나 알 수 없는 값이면 일반 실루엣·기본색으로 강등하며, 실제 성향이나 ID를 복구 경로로 사용하지 않는다.

현재 기본값이 꺼져 있지만 향후 클라이언트로 노출될 수 있는 `BotThought.characterId`도 `LiveTableAdapter.onBotActed`에서 실제 `personalityId`가 아니라 당시 공개 `avatar`를 스냅샷한다. 설명 텍스트가 특정 캐릭터 이름이나 고유 말투를 포함하지 않는다는 기존 봇 해설 계약은 유지한다.

## 채팅과 대사 정책

`ChatMessage`에는 메시지 생성 시점의 공개 아바타를 `characterId: string | null`로 스냅샷한다. 봇 메시지는 해당 봇의 현재 `Player.avatar`, 휴먼 메시지는 휴먼의 현재 공개 아바타, 딜러 메시지는 `dealer`, 시스템 메시지는 `null`로 기록한다.

`ChatBubble`은 더 이상 `message.playerId.split('-')`로 캐릭터를 추론하지 않는다. 오직 `message.characterId`를 사용하고 값이 없거나 조회되지 않으면 일반 아이콘과 기본색을 쓴다.

가면 단계에서는 실제 캐릭터 전용 AI·수기 대사를 모두 억제한다.

- `player.avatar !== player.personalityId`인 봇은 `DialogueManager.getLine`에 실제 `personalityId`를 넘기지 않는다. 캐시된 AI 문장도 조회하지 않는다.
- 액션, 올인, 큰 팟 승리, 일반 승리, 탈락, 우승, 투척 반응은 가면 프로필의 공용 문장 집합만 사용한다.
- 가면 봇 여러 명이 같은 공용 프로필과 대사 풀을 공유하는 것은 의도된 동작이다.
- 가면 해제 뒤 새로 생성되는 대사부터 기존 실제 캐릭터 AI·수기 대사 경로를 사용할 수 있다.

이 정책은 이름만 가려 놓고 말투·고유 인사·승패 대사로 정답이 새는 경로를 막는다. 봇의 베팅 성향 자체는 승인안대로 유지하므로 장기간 관찰을 통한 행동 추론까지 막는 익명화 기능은 아니다.

## 기존 스냅샷 의미

가면 해제는 과거 기록을 다시 쓰지 않는다.

- 이미 완료된 핸드 히스토리는 `CompletedHandRecord.players[].name`에 완료 당시 표시 이름을 복사해 둔다. 공개 전 완료된 기록은 가면 이름을 유지하며 DB 스키마나 과거 행을 수정하지 않는다.
- 이미 만들어진 채팅은 `playerName`과 새 `characterId`가 생성 시점 스냅샷이다. 공개 전 메시지는 계속 가면 이름·아바타로 보이고, 공개 후 새 메시지만 실제 이름·아바타를 사용한다.
- 공개 전 핸드가 끝나고 히스토리 초안이 확정된 다음 표시 전환을 수행하는 것이 기본 계약이다. 진행 중 핸드 한가운데의 이름 변경과 과거 핸드 재귀적 공개는 이 기반의 대상이 아니다.

같은 불투명 `playerId`로 공개 전후 이벤트를 연결할 수는 있다. 이는 공개 후 동일 인물임을 보여 주기 위한 게임 진행 identity이며, 공개 전 실제 캐릭터 문자열을 선행 노출하는 것은 아니다.

## 위협 모델과 누출 경로

보호 대상은 공개 전 실제 캐릭터 ID·이름·아트·고유 대사다. 신뢰 경계는 서버 내부 `PokerEngine.state`와 Socket.io/클라이언트 공개 payload 사이이다.

다음 누출을 회귀 대상으로 본다.

1. `game-update`, `game-update-public`, `room-joined`의 중첩 플레이어에 `personalityId`가 직렬화되는 경우
2. `Player.id`에 실제 캐릭터 ID가 포함되는 경우
3. 좌석·컷인·말풍선·쇼케이스·파트너 반응이 `personalityId`를 직접 읽거나 fallback으로 사용하는 경우
4. `ChatBubble`이 봇 ID를 파싱하거나 현재 좌석을 다시 조회해 과거 메시지의 아바타를 소급 변경하는 경우
5. AI 프롬프트, AI 캐시, 고유 승패·액션 대사가 실제 캐릭터를 드러내는 경우
6. room-lost 재개 때 실제 캐릭터 또는 가면 매핑을 다시 뽑아 전후 정보가 어긋나는 경우
7. 공개 전 핸드 히스토리나 채팅 스냅샷을 공개 전환 시 덮어쓰는 경우
8. 표시 전용 가면이 일반 랜덤 봇·인연·도감 후보로 섞이는 경우

서버 로그, 내부 봇 판단, 운영 진단에 존재하는 `personalityId`는 공개 payload가 아니므로 유지할 수 있다. 다만 공개 소켓 이벤트나 클라이언트 오류 메시지에 내부 객체를 통째로 넣어서는 안 된다. 네트워크 관찰자에게 봇의 베팅 패턴 자체를 숨기는 것은 비목표다.

## 오류와 fallback

- 실제 `characterId`가 없거나 딜러를 봇으로 요청하면 기존처럼 `createBotWithCharacter`는 `null`을 반환한다.
- 표시 identity가 명시됐는데 이름이 비거나 `characterId`가 등록되지 않았으면 실제 캐릭터로 조용히 fallback하지 않는다. 봇 생성을 실패시켜 스토리 방 전체를 열지 않고 기존 `lineup-failed`/room-lost 재개 경로를 탄다. 이는 오설정 시 정답이 노출되는 것보다 안전하다.
- 클라이언트가 알 수 없는 `avatar` 또는 `ChatMessage.characterId === null`을 받으면 일반 아이콘·기본색을 사용한다. ID 파싱이나 실제 캐릭터 추측은 하지 않는다.
- 공개 요청의 `profileId`, `runId`, `seatIndex`가 현재 세션과 맞지 않으면 `stale-state` 또는 거절 결과를 반환하고 어떤 플레이어도 부분 갱신하지 않는다.
- 공개 요청 시 방이 없어도 세션 계획의 공개 상태는 유지되어 다음 `openRoom`에 적용된다. 현재 방이 있으면 갱신 후 한 번 브로드캐스트한다.
- `getPublicState` 정화 중 오류가 나더라도 내부 `Player`를 수정하지 않았으므로 봇 행동 identity가 손상되지 않는다.

## 변경 범위

구현 시 수정할 파일은 다음으로 한정한다.

- `src/lib/poker/types.ts`
  - `PublicPlayer`, `PublicGameState`, `ChatMessage.characterId` 공개 계약
- `src/lib/poker/engine.ts`
  - 내부 상태를 변형하지 않는 `getPublicState` 정화 복제
- `src/lib/bot/bot-manager.ts`
  - 불투명 봇 ID, `BotDisplayIdentity`, 선택적 표시 identity, 내부 `getUsedCharacterIds`
- `src/lib/characters/index.ts`
  - `BOT_CHARACTERS` 밖의 공용 가면 표시 프로필과 조회
- `src/lib/realtime/protocol.ts`
  - `game-update`, `room-joined` 등 공개 payload를 `PublicGameState`로 명시
- `src/lib/events/game-events.ts`
  - 공개 플레이어/상태 타입만 이벤트로 전달
- `src/lib/store/game-store.ts`
  - 클라이언트 상태를 `PublicGameState`로 제한
- `src/server/room-manager.ts`
  - 채팅 표시 identity 스냅샷, 가면 공용 대사, 실제-character AI 억제
- `src/server/story-live-adapter.ts`
  - 런 단위 좌석 identity 계획, 방 재생성 시 재사용, 서버 전용 공개 API seam
- `src/components/table/PlayerSeat.tsx`
  - 좌석 아바타와 쇼케이스가 `avatar`만 사용
- `src/components/table/player-seat-visual.ts`
  - 공개 플레이어 타입 사용
- `src/components/table/PartnerReactions.tsx`
  - 착석 파트너 판정을 공개 `avatar`로만 수행
- `src/components/characters/SeatSpeechBubble.tsx`
  - 말풍선 색상 조회가 공개 `avatar`만 사용
- `src/components/characters/WinnerCutIn.tsx`
  - 봇 컷인이 공개 `avatar` 프로필만 사용
- `src/components/characters/LoserCutIn.tsx`
  - 봇 컷인이 공개 `avatar` 프로필만 사용
- `src/components/chat/ChatBubble.tsx`
  - `ChatMessage.characterId` 사용, `playerId` 파싱 제거

테스트 파일은 아래 최소 회귀 범위만 추가·수정한다.

- `src/lib/poker/engine.public-state.test.ts`
- `src/lib/bot/bot-manager.identity.test.ts`
- `src/server/room-manager.story.test.ts`
- `src/server/story-live-adapter.test.ts`

## 호환성

- 표시 identity 인자를 주지 않은 모든 기존 봇은 이전과 같은 이름·아바타·대사를 보인다.
- `personalityId`, `botSkill`, `bot-ai`, HUD 성향 계산은 서버에서 그대로 동작한다.
- `getUsedCharacterIds`는 실제 봇 캐릭터 중복 방지를 유지한다.
- 휴먼의 이름·아바타·코스메틱과 딜러 표시는 기존 계약을 유지한다.
- `ChatMessage.characterId`는 필수 nullable 필드로 도입하고 기존 테스트 fixture는 `null` 또는 공개 캐릭터 ID를 명시한다. 영속 채팅 저장소가 없으므로 데이터 마이그레이션은 없다.
- 핸드 히스토리 스키마에는 아바타가 없고 이름은 이미 값 스냅샷이므로 DB 마이그레이션이 없다.
- story live 세션과 방 상태가 인메모리인 현재 구조를 유지한다. 서버 재시작을 넘어 매핑을 복구하는 영속화는 포함하지 않는다.

## 최소 검증 계획

1. 공개 상태 정화
   - 내부 봇에는 `personalityId`가 남아 있다.
   - `getPublicState()` 결과의 모든 플레이어에는 `personalityId` 키가 없다.
   - 공개 상태 객체나 홀카드를 바꿔도 엔진 내부 identity와 실제 홀카드가 변하지 않는다.
2. 봇 생성과 중복 방지
   - 표시 identity를 준 봇은 `name/avatar`만 가면 값이고 `personalityId`는 실제 값이다.
   - 생성된 ID에 실제 캐릭터 ID가 포함되지 않는다.
   - 같은 가면을 쓴 복수 봇도 `getUsedCharacterIds`는 실제 캐릭터 ID를 반환한다.
3. 대사와 채팅
   - 가면 봇은 AI 생성기를 호출하지 않고 공용 가면 대사만 보낸다.
   - 채팅은 당시 `playerName/characterId`를 보존하며 공개 뒤에도 기존 메시지가 바뀌지 않는다.
4. 스토리 재개와 공개
   - room-lost 후 같은 런·스텝을 다시 열면 좌석별 실제/표시 매핑이 같다.
   - 공개는 `name/avatar`만 바꾸고 `id/personalityId`를 보존한다.
   - 방이 없는 동안 공개해도 다음 재개 방은 공개 identity로 생성된다.

검증 명령은 관련 Vitest 파일만 실행하고 공개 타입 경계를 확인하는 `npx tsc --noEmit`까지만 사용한다. 전체 Vitest, 전체 빌드, 브라우저 E2E는 이 기반의 최소 회귀 범위에 포함하지 않는다.

## 명시적 비목표

- Ch7 챕터 정의, 라인업, 가면 정답 데이터, 퀴즈 문항과 채점
- 공개 순간의 CG·애니메이션·사운드·대화 연출
- 봇 포커 전략, `personalityId`, 난이도 수치 변경
- 행동 패턴까지 동일하게 만드는 완전 익명화
- 과거 핸드 히스토리·채팅을 공개 후 실제 이름으로 재작성
- 가면 캐릭터의 인연, 해금, 도감, 파트너, 랜덤 봇 편입
- DB 스키마 변경 또는 서버 재시작을 넘는 매핑 영속화
- 일반 캐시·SnG·MTT의 캐릭터 선택 정책 변경
