# Story Mask Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 수련 스토리 봇의 서버 내부 행동 성향과 공개 표시 정체성을 분리하고, 가면 상태가 네트워크·UI·채팅·대사에서 실제 캐릭터를 누출하지 않으면서 같은 런에서 안정적으로 공개 전환될 수 있게 한다.

**Architecture:** `Player.personalityId`는 `PokerEngine.state` 안에만 남기고 `PublicPlayer`/`PublicGameState` 투영에서 구조적으로 제거한다. 봇 생성 시 실제 캐릭터와 선택적 `BotDisplayIdentity`를 따로 받아 `name`/`avatar`만 공개 표시값으로 설정하며, 스토리 `LiveSession`이 좌석별 실제 성향·가면·공개 여부를 보존한다. 공개는 서버 전용 어댑터 명령이 `RoomManager`의 제한된 표시 갱신 API를 호출하는 방식으로 한 번만 브로드캐스트하며, 과거 채팅과 핸드 히스토리는 값 스냅샷으로 유지한다.

**Tech Stack:** TypeScript 5, Node.js 22 `crypto.randomUUID`, Next.js 16/React 19, Socket.io, Zustand, Vitest 4

---

## 파일 구조와 경계

- `src/lib/poker/types.ts`: 내부 `Player`/`GameState`와 공개 `PublicPlayer`/`PublicGameState`, 채팅 표시 스냅샷 계약.
- `src/lib/poker/engine.ts`: 공개 경계에서 `personalityId`와 비공개 홀카드를 새 객체로 정화.
- `src/lib/bot/bot-manager.ts`: 실제 성향과 표시 identity를 분리한 봇 생성 및 불투명 ID 발급.
- `src/lib/characters/index.ts`: 일반 봇 후보에는 포함되지 않는 `story-mask` 표시 프로필.
- `src/lib/realtime/protocol.ts`, `src/lib/events/game-events.ts`, `src/lib/store/game-store.ts`: 공개 상태만 클라이언트 타입으로 운반.
- `src/components/table/PlayerSeat.tsx`, `src/components/table/player-seat-visual.ts`, `src/components/table/PartnerReactions.tsx`, `src/components/characters/SeatSpeechBubble.tsx`, `src/components/characters/WinnerCutIn.tsx`, `src/components/characters/LoserCutIn.tsx`, `src/components/chat/ChatBubble.tsx`: 공개 `avatar` 또는 메시지 생성 시점의 `characterId`만 사용.
- `src/server/room-manager.ts`: 표시 전환, 채팅 스냅샷, 가면 공용 대사, 실제 캐릭터 AI 억제.
- `src/server/story-live-adapter.ts`: 런·스텝 단위 좌석 identity 계획, room-lost 재개, 서버 전용 reveal seam.
- `src/lib/store/game-store.leave.test.ts`: 새 필수 채팅 필드에 맞춘 기존 타입 fixture만 보정하며 이 파일 자체를 별도 실행하지 않는다.
- 신규/관련 회귀는 승인된 네 파일만 실행한다: `engine.public-state.test.ts`, `bot-manager.identity.test.ts`, `room-manager.story.test.ts`, `story-live-adapter.test.ts`.

### Task 1: 내부/공개 identity 원시 계약과 안전한 봇 생성

**Files:**
- Create: `src/lib/poker/engine.public-state.test.ts`
- Create: `src/lib/bot/bot-manager.identity.test.ts`
- Modify: `src/lib/poker/types.ts: Player, GameState 직후 공개 타입`
- Modify: `src/lib/poker/engine.ts: PokerEngine.getPublicState`
- Modify: `src/lib/bot/bot-manager.ts: buildBot, createBotWithCharacter, getUsedCharacterIds`
- Modify: `src/lib/characters/index.ts: DEALER_CHARACTER 뒤 MASKED_BOT_CHARACTER, getCharacterById`

- [ ] **Step 1: 공개 상태가 성향을 제거하고 내부 객체를 공유하지 않는 실패 테스트를 작성한다**

`src/lib/poker/engine.public-state.test.ts`를 다음 내용으로 만든다.

```ts
import { describe, expect, it } from 'vitest';
import { createBotWithCharacter } from '../bot/bot-manager';
import { setupTable } from './test-helpers';

describe('PokerEngine public player projection', () => {
  it('removes personalityId without mutating or aliasing the internal bot', () => {
    const { engine } = setupTable([1_000]);
    const bot = createBotWithCharacter(1, 1_000, 'sakura', 'easy')!;
    bot.holeCards = [
      { suit: 'spades', rank: 'A' },
      { suit: 'hearts', rank: 'K' },
    ];
    expect(engine.addPlayer(bot)).toBe(true);

    const publicState = engine.getPublicState(bot.id);
    const publicBot = publicState.players.find(player => player.id === bot.id)!;

    expect(Object.hasOwn(publicBot, 'personalityId')).toBe(false);
    expect(JSON.stringify(publicState)).not.toContain('personalityId');
    expect(publicState).not.toBe(engine.state);
    expect(publicBot).not.toBe(bot);
    expect(publicBot.holeCards).not.toBe(bot.holeCards);

    publicBot.name = '변경된 공개 이름';
    publicBot.holeCards[0].rank = '2';
    expect(bot.name).toBe('사쿠라');
    expect(bot.holeCards[0].rank).toBe('A');
    expect(bot.personalityId).toBe('sakura');
  });
});
```

- [ ] **Step 2: 봇 표시 identity·불투명 ID·가면 프로필·실제 성향 중복 방지 실패 테스트를 작성한다**

`src/lib/bot/bot-manager.identity.test.ts`를 다음 내용으로 만든다.

```ts
import { describe, expect, it } from 'vitest';
import { BOT_CHARACTERS, MASKED_BOT_CHARACTER, getCharacterById } from '../characters';
import { PokerEngine } from '../poker/engine';
import type { RoomConfig } from '../poker/types';
import { createBotWithCharacter, getUsedCharacterIds } from './bot-manager';

const CONFIG: RoomConfig = {
  name: 'identity test', smallBlind: 10, bigBlind: 20,
  minBuyIn: 100, maxBuyIn: 2_000, maxPlayers: 6,
  turnTime: 30, gameMode: 'cash', economyMode: 'practice',
};

describe('bot behavior/display identity', () => {
  it('keeps the real personality while publishing the requested display identity', () => {
    const bot = createBotWithCharacter(1, 2_000, 'sakura', 'easy', {
      name: '수상한 도전자',
      characterId: 'story-mask',
    })!;

    expect(bot).toMatchObject({
      name: '수상한 도전자',
      avatar: 'story-mask',
      personalityId: 'sakura',
    });
    expect(bot.id).toMatch(/^bot-[0-9a-f-]{36}$/);
    expect(bot.id).not.toContain('sakura');
  });

  it('rejects invalid display identities and the display-only mask as a behavior character', () => {
    expect(createBotWithCharacter(1, 2_000, 'sakura', 'easy', {
      name: '   ', characterId: 'story-mask',
    })).toBeNull();
    expect(createBotWithCharacter(1, 2_000, 'sakura', 'easy', {
      name: '가면', characterId: 'missing-character',
    })).toBeNull();
    expect(createBotWithCharacter(1, 2_000, 'story-mask', 'easy')).toBeNull();
  });

  it('registers the mask for presentation without adding it to random bot candidates', () => {
    expect(getCharacterById('story-mask')).toBe(MASKED_BOT_CHARACTER);
    expect(BOT_CHARACTERS.some(character => character.id === 'story-mask')).toBe(false);
  });

  it('deduplicates masked bots by their real personality, not their shared avatar', () => {
    const engine = new PokerEngine(CONFIG, 'identity-room');
    const display = { name: '가면 도전자', characterId: 'story-mask' };
    expect(engine.addPlayer(createBotWithCharacter(1, 2_000, 'sakura', 'easy', display)!)).toBe(true);
    expect(engine.addPlayer(createBotWithCharacter(2, 2_000, 'ara', 'easy', display)!)).toBe(true);

    expect(getUsedCharacterIds(engine)).toEqual(['sakura', 'ara']);
  });
});
```

- [ ] **Step 3: 두 신규 테스트가 기존 결합을 잡는지 확인한다**

Run:

```bash
npx vitest run src/lib/poker/engine.public-state.test.ts src/lib/bot/bot-manager.identity.test.ts
```

Expected: FAIL. `createBotWithCharacter`가 다섯 번째 인자를 받지 않고, `MASKED_BOT_CHARACTER`가 없으며, 공개 봇에 `personalityId`가 남는 실패가 보여야 한다.

- [ ] **Step 4: 내부 타입과 공개 타입을 분리한다**

`src/lib/poker/types.ts`에서 `Player`와 `GameState` 선언은 서버 내부 타입으로 그대로 두고 `GameState` 뒤에 다음을 추가한다. `personalityId`가 optional이어도 명시적으로 omit해야 클라이언트가 그 필드를 읽을 수 없다.

```ts
export type PublicPlayer = Omit<Player, 'personalityId'>;

export type PublicGameState = Omit<GameState, 'players'> & {
  players: PublicPlayer[];
};
```

- [ ] **Step 5: 표시 전용 가면 프로필을 일반 봇 배열 밖에 등록한다**

`src/lib/characters/index.ts`에서 `DEALER_CHARACTER` 뒤, `BOT_CHARACTERS` 앞에 다음 상수를 추가한다.

```ts
export const MASKED_BOT_CHARACTER: CharacterProfile = {
  id: 'story-mask',
  name: '수상한 도전자',
  nameNative: '???',
  nationality: '비공개',
  age: 0,
  color: '#7C6F9F',
  colorSecondary: '#332B49',
  emoji: '🎭',
  personality: 'masked',
  backstory: '정체를 숨긴 채 수련 테이블에 나타난 도전자.',
  styleSummary: '정체와 무관한 공용 가면 프로필.',
  greeting: '상대가 누구인지는 중요하지 않아. 카드를 보자.',
  winQuote: '이번 승부는 내가 가져갈게.',
  loseQuote: '좋은 승부였어. 다음 판을 보자.',
  bluffQuote: '결정할 시간이야.',
  foldQuote: '이번 패는 여기까지.',
  thinkingQuote: '잠깐 생각해 보지.',
  chatMessages: [
    '카드에 집중하자.',
    '아직 승부는 끝나지 않았어.',
    '좋은 선택인지 지켜보지.',
  ],
};
```

`getCharacterById`는 딜러·가면·일반 봇 순으로 조회하되, `BOT_CHARACTERS` 배열 자체는 바꾸지 않는다.

```ts
export function getCharacterById(id: string): CharacterProfile | undefined {
  if (id === DEALER_CHARACTER.id) return DEALER_CHARACTER;
  if (id === MASKED_BOT_CHARACTER.id) return MASKED_BOT_CHARACTER;
  return BOT_CHARACTERS.find(character => character.id === id);
}
```

- [ ] **Step 6: 봇 생성 API가 실제 성향과 표시 identity를 분리하고 불투명 ID를 발급하게 한다**

`src/lib/bot/bot-manager.ts`에 `node:crypto`의 `randomUUID`를 import하고 카운터를 제거한다. 표시 타입과 생성 경계를 다음 서명으로 맞춘다. 기존 네 번째 `skill` 인자를 유지하고 다섯 번째에 표시 identity를 둬 모든 기존 호출을 호환한다.

```ts
import { randomUUID } from 'node:crypto';

export interface BotDisplayIdentity {
  name: string;
  characterId: string;
}

function buildBot(
  character: CharacterProfile,
  seatIndex: number,
  buyIn: number,
  skill?: RoomDifficulty,
  displayIdentity?: BotDisplayIdentity,
): Player {
  const display = displayIdentity ?? {
    name: character.name,
    characterId: character.id,
  };
  return {
    id: `bot-${randomUUID()}`,
    name: display.name.trim(),
    type: 'bot',
    avatar: display.characterId,
    chips: buyIn,
    seatIndex,
    holeCards: [],
    currentBet: 0,
    totalContributed: 0,
    status: 'waiting',
    hasActed: false,
    personalityId: character.id,
    botSkill: skill,
  };
}

export function createBotWithCharacter(
  seatIndex: number,
  buyIn: number,
  characterId: string,
  skill?: RoomDifficulty,
  displayIdentity?: BotDisplayIdentity,
): Player | null {
  const character = getCharacterById(characterId);
  const playable = character
    && character.id !== 'dealer'
    && character.id !== 'story-mask';
  if (!playable) return null;
  if (displayIdentity && (
    !displayIdentity.name.trim()
    || !getCharacterById(displayIdentity.characterId)
  )) return null;
  return buildBot(character, seatIndex, buyIn, skill, displayIdentity);
}
```

`createBot`는 기존처럼 `buildBot(..., skill)`만 호출한다. `getUsedCharacterIds`는 현재 구현의 `p.type === 'bot' ? p.personalityId : p.avatar`를 그대로 유지한다.

- [ ] **Step 7: 공개 투영에서 성향을 구조 분해로 제외하고 홀카드를 깊이 복제한다**

`src/lib/poker/engine.ts`에 `PublicGameState`를 type import하고 `getPublicState` 반환부를 다음 형태로 바꾼다. 내부 객체에서 `delete`를 호출하지 않는다.

```ts
getPublicState(forPlayerId?: string): PublicGameState {
  const survivors = this.state.players.filter(
    player => player.status === 'active' || player.status === 'all-in',
  ).length;
  const showdownContested = this.state.street === 'showdown' && survivors >= 2;

  return {
    ...this.state,
    communityCards: this.state.communityCards.map(card => ({ ...card })),
    players: this.state.players.map(player => {
      const { personalityId: _personalityId, ...publicPlayer } = player;
      const revealed =
        (showdownContested || !!this.state.allInRunout)
        && (player.status === 'active' || player.status === 'all-in');
      return {
        ...publicPlayer,
        revealed,
        holeCards: player.id === forPlayerId || revealed
          ? player.holeCards.map(card => ({ ...card }))
          : player.holeCards.map(() => ({ suit: 'spades', rank: '2' } as Card)),
      };
    }),
  };
}
```

- [ ] **Step 8: 신규 identity 회귀를 통과시킨다**

Run:

```bash
npx vitest run src/lib/poker/engine.public-state.test.ts src/lib/bot/bot-manager.identity.test.ts
```

Expected: 두 파일 모두 PASS. 직렬화된 공개 상태에 `personalityId` 문자열이 없고, 내부 봇 성향·홀카드는 유지되어야 한다.

- [ ] **Step 9: 첫 단위를 커밋한다**

```bash
git add src/lib/poker/types.ts src/lib/poker/engine.ts src/lib/poker/engine.public-state.test.ts src/lib/bot/bot-manager.ts src/lib/bot/bot-manager.identity.test.ts src/lib/characters/index.ts
git commit -m "feat: separate bot behavior and display identity"
```

### Task 2: 공개 상태 타입을 네트워크와 클라이언트 끝까지 전파

**Files:**
- Modify: `src/lib/realtime/protocol.ts: GameUpdatePayload, RoomJoinedPayload, TournamentSeatAssigned, TableMovePayload`
- Modify: `src/lib/events/game-events.ts: GameEvent winners, diffGameState`
- Modify: `src/lib/store/game-store.ts: GameStore.gameState`
- Modify: `src/components/table/PlayerSeat.tsx: PlayerSeatProps, CharacterAvatar, CharacterShowcaseModal`
- Modify: `src/components/table/player-seat-visual.ts: SeatVisualPlayer`
- Modify: `src/components/table/PartnerReactions.tsx: seated partner lookup`
- Modify: `src/components/characters/SeatSpeechBubble.tsx: message display snapshot lookup`
- Modify: `src/components/characters/WinnerCutIn.tsx: bot cut-in source`
- Modify: `src/components/characters/LoserCutIn.tsx: bot cut-in source`

- [ ] **Step 1: 공개 프로토콜과 클라이언트 store의 타입을 먼저 좁힌다**

`src/lib/realtime/protocol.ts`에서 `GameState` import를 `PublicGameState`로 바꾸고 아래 네 필드를 모두 교체한다.

```ts
export interface GameUpdatePayload {
  roomId: string;
  state: PublicGameState;
}

export interface RoomJoinedPayload {
  roomId: string;
  gameState: PublicGameState;
  chatHistory: ChatMessage[];
}

export interface TournamentSeatAssigned {
  tournamentId: string;
  roomId: string;
  state: PublicGameState;
  chat: ChatMessage[];
}

export interface TableMovePayload {
  tournamentId: string;
  fromRoomId: string;
  roomId: string;
  gameState: PublicGameState;
  chatHistory: ChatMessage[];
}
```

`src/lib/store/game-store.ts`는 `GameState` 대신 `PublicGameState`를 import하고 store 필드를 좁힌다.

```ts
gameState: PublicGameState | null;
```

`src/lib/events/game-events.ts`도 공개 타입만 import하여 이벤트 경계를 다음처럼 바꾼다.

```ts
import type {
  ActionType,
  Card,
  PublicGameState,
  PublicPlayer,
  Street,
  WinResult,
} from '../poker/types';

// winners 이벤트 내부
players: PublicPlayer[];
economyMode: PublicGameState['economyMode'];

export function diffGameState(
  prev: PublicGameState | null,
  next: PublicGameState,
  myPlayerId: string | null,
): GameEvent[] {
```

- [ ] **Step 2: 타입 검사를 실행해 남아 있는 클라이언트 성향 의존을 확인한다**

Run:

```bash
npx tsc --noEmit
```

Expected: FAIL. store/event에서 직접 추론되는 `PartnerReactions`, `SeatSpeechBubble`, `WinnerCutIn`, `LoserCutIn`의 `PublicPlayer`에는 `personalityId`가 없다는 오류가 발생해야 한다. `Player.personalityId`가 optional이라 구조적으로 대입 가능한 `PlayerSeat`는 이 단계에서 자동으로 실패하지 않으므로 다음 단계에서 prop을 명시적으로 좁힌다.

- [ ] **Step 3: 좌석과 파트너 연출을 공개 avatar만 보도록 바꾼다**

`src/components/table/PlayerSeat.tsx`는 `Player` import/prop을 `PublicPlayer`로 바꾸고 두 캐릭터 키 계산을 하나로 단순화한다. 기존 `PlayerSeatProps` 전체를 다음 선언으로 교체한다.

```ts
import type { PublicPlayer } from '@/lib/poker/types';

interface PlayerSeatProps {
  player: PublicPlayer | null;
  isCurrentPlayer: boolean;
  isActive: boolean;
  position: { x: string; y: string };
  seatIndex: number;
  compact?: boolean;
  turnDuration?: number;
  turnTotalSeconds?: number;
  seatAction?: SeatAction | null;
  cardSide?: 'left' | 'right';
  onSit?: (seatIndex: number) => void;
}

// const avatarSize 선언 바로 다음
const characterId = player.avatar || 'player';

<CharacterAvatar
  characterId={characterId}
  size={avatarSize}
  isActive={isActive}
  expression={isBusted ? 'sad' : isAllIn ? 'confident' : expression}
/>

<CharacterShowcaseModal
  characterId={showcaseOpen ? characterId : null}
  onClose={() => setShowcaseOpen(false)}
/>
```

`src/components/table/player-seat-visual.ts`의 import와 Pick 기준도 공개 타입으로 좁힌다.

```ts
import type { PublicPlayer } from '@/lib/poker/types';

type SeatVisualPlayer = Pick<
  PublicPlayer,
  'status' | 'chips' | 'sitOutNext' | 'isDisconnected' | 'finishPlace'
>;
```

`src/components/table/PartnerReactions.tsx`의 착석 판정은 다음 한 줄로 바꾼다.

```ts
const partnerSeated = gameState?.players.some(
  player => player.type === 'bot'
    && player.avatar === partnerId
    && !player.pendingRemoval,
) ?? false;
```

- [ ] **Step 4: 말풍선과 승패 컷인이 현재 공개 표시값 또는 메시지 스냅샷만 사용하게 한다**

`src/components/characters/SeatSpeechBubble.tsx`는 이 커밋에서는 공개 좌석의 `avatar`만 사용한다. 메시지 생성 시점 스냅샷 전환은 `ChatMessage.characterId`를 도입하는 Task 3에서 같은 파일을 다시 좁힌다.

```ts
const player = state.gameState?.players.find(candidate => candidate.id === last.playerId);
if (!player) return;

const character = getCharacterById(player.avatar || '');
const mySeat = state.gameState?.players.find(candidate => candidate.id === state.myPlayerId)?.seatIndex ?? -1;
setBubble({
  id: last.id,
  displaySeatIndex: toDisplayIndex(player.seatIndex, mySeat),
  name: player.name,
  message: last.message,
  color: character?.color || '#A78BFA',
});
```

`src/components/characters/WinnerCutIn.tsx`의 봇 분기는 실제 성향 대신 공개 avatar/profile과 공개 name을 쓴다. 미등록 avatar도 일반 fallback으로 렌더한다.

```ts
if (player.type === 'bot') {
  const character = getCharacterById(player.avatar);
  cutIn = {
    characterId: player.avatar || 'player',
    name: player.name,
    quote: character?.winQuote ?? '이번 승부는 내가 가져갈게.',
    color: character?.color ?? '#A78BFA',
    amount: top.amount,
    cutinId: null,
  };
}
```

위 블록은 현재 `if (player.type === 'bot' && player.personalityId) { ... }` 블록만 교체한다. 바로 뒤의 `else` 휴먼 분기(`characterId: 'dealer'`, 미야코 축하 문장, `equippedCutin`)는 수정하지 않는다.

`src/components/characters/LoserCutIn.tsx`는 필터에서 `p.personalityId` 조건을 없애고 공개 avatar를 조회한다.

```ts
const losers = event.players.filter(
  player => !winnerIds.has(player.id)
    && (player.status === 'active' || player.status === 'all-in')
    && player.type === 'bot',
);

const character = getCharacterById(loser.avatar);
const cutIn: CutInData = {
  characterId: loser.avatar || 'player',
  name: loser.name,
  quote: character?.loseQuote ?? '이번 판은 아쉽네. 다음 승부를 보자.',
  color: character?.color ?? '#A78BFA',
  amount: loser.totalContributed,
};
```

- [ ] **Step 5: 클라이언트 타입과 정적 누출 감사를 통과시킨다**

Run:

```bash
npx tsc --noEmit
rg -n "personalityId|playerId\.split|split\('-'\)" src/components/table/PlayerSeat.tsx src/components/table/PartnerReactions.tsx src/components/characters/SeatSpeechBubble.tsx src/components/characters/WinnerCutIn.tsx src/components/characters/LoserCutIn.tsx
```

Expected: TypeScript PASS. `rg`는 출력 없이 exit code 1이어야 한다. 이 단계의 `rg`는 테스트 추가가 아니라 금지된 클라이언트 의존이 사라졌는지 보는 정적 감사다.

- [ ] **Step 6: 공개 클라이언트 경계를 커밋한다**

```bash
git add src/lib/realtime/protocol.ts src/lib/events/game-events.ts src/lib/store/game-store.ts src/components/table/PlayerSeat.tsx src/components/table/player-seat-visual.ts src/components/table/PartnerReactions.tsx src/components/characters/SeatSpeechBubble.tsx src/components/characters/WinnerCutIn.tsx src/components/characters/LoserCutIn.tsx
git commit -m "refactor: restrict clients to public player identity"
```

### Task 3: 표시 전환, 채팅 스냅샷, 가면 공용 대사

**Files:**
- Modify: `src/lib/poker/types.ts: ChatMessage`
- Modify: `src/server/room-manager.ts: updateStoryBotDisplayIdentity, bot chat/quip helpers, addChatMessage`
- Modify: `src/components/chat/ChatBubble.tsx: character lookup`
- Modify: `src/components/characters/SeatSpeechBubble.tsx: immutable chat display snapshot`
- Modify: `src/lib/store/game-store.leave.test.ts: ChatMessage fixtures`
- Test: `src/server/room-manager.story.test.ts`

- [ ] **Step 1: 표시 갱신의 불변성과 가면 대사/채팅 스냅샷 실패 테스트를 추가한다**

`src/server/room-manager.story.test.ts`의 describe-local 선언에 `onUpdate`와 `onChat`을 추가하고, 기존 `beforeEach`의 `manager = new RoomManager(() => {}, () => {}, undefined, { ... })` 한 호출만 `manager = new RoomManager(onUpdate, onChat, undefined, { ... })`로 교체한다. `progression`, `recordCompletedHand`, `onSeatReclaimed`, `onRoomDisposed` 초기화와 options 객체는 변경하지 않는다.

```ts
let onUpdate: ReturnType<typeof vi.fn>;
let onChat: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  onUpdate = vi.fn();
  onChat = vi.fn();
  story = makeStoryHooks();
  progression = {
    captureHandStart: vi.fn(),
    confirmHandStart: vi.fn(),
    cancelHand: vi.fn(),
    completeHand: vi.fn(),
    completeSng: vi.fn(),
    disposeRoom: vi.fn(),
  };
  recordCompletedHand = vi.fn();
  onSeatReclaimed = vi.fn<SeatReclaimedFn>();
  onRoomDisposed = vi.fn<RoomDisposedFn>();
  manager = new RoomManager(onUpdate, onChat, undefined, {
    progression: progression as unknown as RoomProgressionHooks,
    handHistory: { recordCompletedHand } as unknown as RoomHandHistoryHooks,
    onSeatReclaimed,
    onRoomDisposed,
  });
  manager.setStoryHooks(story.hooks);
});
```

기존 `afterEach`의 `vi.clearAllTimers()` 다음에는 이 테스트가 만든 `Math.random`/dialogue spy를 원복하도록 아래 한 줄을 넣는다.

```ts
vi.restoreAllMocks();
```

같은 describe에 다음 두 테스트를 추가한다.

```ts
it('스토리 봇 공개는 name/avatar만 바꾸고 한 번 브로드캐스트한다', () => {
  const roomId = manager.createRoom(storyConfig());
  const bot = createBotWithCharacter(1, 2_000, 'sakura', 'easy', {
    name: '수상한 도전자', characterId: 'story-mask',
  })!;
  expect(manager.joinRoom(roomId, makeHero())).toBe(true);
  expect(manager.joinRoom(roomId, bot)).toBe(true);
  const before = { id: bot.id, personalityId: bot.personalityId };
  onUpdate.mockClear();

  expect(manager.updateStoryBotDisplayIdentity(roomId, bot.id, {
    name: '사쿠라', characterId: 'sakura',
  })).toBe(true);

  expect(bot).toMatchObject({
    ...before,
    name: '사쿠라',
    avatar: 'sakura',
  });
  expect(onUpdate).toHaveBeenCalledTimes(1);
});

it('가면 봇은 실제 캐릭터 AI를 호출하지 않고 채팅의 당시 표시 identity를 보존한다', async () => {
  const roomId = manager.createRoom(storyConfig());
  const bot = createBotWithCharacter(1, 2_000, 'sakura', 'easy', {
    name: '수상한 도전자', characterId: 'story-mask',
  })!;
  expect(manager.joinRoom(roomId, makeHero())).toBe(true);
  expect(manager.joinRoom(roomId, bot)).toBe(true);
  const dialogue = (manager as unknown as {
    dialogue: { getLine: (...args: string[]) => Promise<string | null> };
  }).dialogue;
  const getLine = vi.spyOn(dialogue, 'getLine').mockResolvedValue('사쿠라 전용 대사');
  vi.spyOn(Math, 'random').mockReturnValue(0);

  manager.reactToThrowableHit(roomId, bot.id, '히어로', '종이비행기');
  await tick(1_000);

  expect(getLine).not.toHaveBeenCalled();
  expect(manager.getChatHistory(roomId).at(-1)).toMatchObject({
    playerId: bot.id,
    playerName: '수상한 도전자',
    characterId: 'story-mask',
    type: 'bot',
  });
  const maskedMessage = manager.getChatHistory(roomId).at(-1)!;

  expect(manager.updateStoryBotDisplayIdentity(roomId, bot.id, {
    name: '사쿠라', characterId: 'sakura',
  })).toBe(true);
  manager.reactToThrowableHit(roomId, bot.id, '히어로', '종이비행기');
  await tick(1_000);

  expect(getLine).toHaveBeenCalledWith(roomId, 'sakura', 'throwable-hit', expect.any(String));
  expect(maskedMessage).toMatchObject({
    playerName: '수상한 도전자', characterId: 'story-mask',
  });
  expect(manager.getChatHistory(roomId).at(-1)).toMatchObject({
    playerName: '사쿠라', characterId: 'sakura',
  });
});
```

- [ ] **Step 2: 관련 RoomManager 테스트가 새 API/필드 부재로 실패하는지 확인한다**

Run:

```bash
npx vitest run src/server/room-manager.story.test.ts
```

Expected: FAIL. `updateStoryBotDisplayIdentity`가 없고 채팅에 `characterId`가 없으며 가면 봇도 `DialogueManager.getLine`을 호출하는 실패가 보여야 한다.

- [ ] **Step 3: 채팅 DTO에 생성 시점 표시 캐릭터를 필수 nullable 필드로 추가한다**

`src/lib/poker/types.ts`의 `ChatMessage`를 다음과 같이 확장한다.

```ts
export interface ChatMessage {
  id: string;
  roomId: string;
  playerId: string;
  playerName: string;
  characterId: string | null;
  message: string;
  timestamp: number;
  type: 'player' | 'bot' | 'system';
}
```

`src/lib/store/game-store.leave.test.ts`의 두 `chatMessages` fixture에는 각각 `characterId: 'sakura'`를 추가한다. 이는 런타임 회귀 범위를 늘리는 것이 아니라 `npx tsc --noEmit`을 위한 필수 타입 fixture 보정이다.

- [ ] **Step 4: RoomManager에 스토리 봇 표시 갱신 API를 추가한다**

`src/server/room-manager.ts`는 `BotDisplayIdentity`를 type import하고 `setStoryHooks` 부근에 다음 공개 메서드를 추가한다. 방·스토리 여부·봇·등록 프로필·비어 있지 않은 이름을 모두 확인한 뒤에만 변경한다.

```ts
updateStoryBotDisplayIdentity(
  roomId: string,
  botId: string,
  display: BotDisplayIdentity,
): boolean {
  const room = this.rooms.get(roomId);
  const bot = room?.engine.state.players.find(player => (
    player.id === botId
    && player.type === 'bot'
    && !player.pendingRemoval
  ));
  if (
    !room
    || !this.isStoryRoom(room)
    || !bot
    || !display.name.trim()
    || !getCharacterById(display.characterId)
  ) return false;

  bot.name = display.name.trim();
  bot.avatar = display.characterId;
  this.onUpdate(roomId, room.engine);
  return true;
}
```

일반 캐시/SnG/MTT 방은 이 메서드가 false를 반환하며 변경·브로드캐스트하지 않는다. `id`, `personalityId`, 칩, 액션 상태는 건드리지 않는다.

- [ ] **Step 5: 모든 채팅 작성 경로가 characterId를 값으로 스냅샷하게 한다**

`src/server/room-manager.ts`의 현재 public `addChatMessage` 서명은 유지해 기존 호출/수명주기 테스트를 깨지 않는다. 방에 실제 좌석이 있으면 서버 상태의 `name/avatar`를 우선하고, 테스트처럼 임의 발신자를 넣는 내부 호출은 전달 이름과 `null`을 쓴다.

```ts
addChatMessage(
  roomId: string,
  playerId: string,
  playerName: string,
  message: string,
  type: ChatMessage['type'] = 'player',
): void {
  const player = this.rooms.get(roomId)?.engine.state.players.find(candidate => candidate.id === playerId);
  this.appendChatMessage({
    roomId,
    playerId,
    playerName: player?.name ?? playerName,
    characterId: type === 'system' ? null : player?.avatar ?? null,
    message,
    type,
  });
}
```

시스템/봇 helper는 다음 계약으로 맞추고 모든 호출부에서 현재 봇의 `avatar`를 넘긴다. 딜러 시작 메시지는 `'dealer'`, 시스템 공지는 `null`이다.

```ts
private sendSystemChat(roomId: string, message: string): void {
  this.appendChatMessage({
    roomId,
    playerId: 'system',
    playerName: 'System',
    characterId: null,
    message,
    type: 'system',
  });
}

private sendBotChat(
  roomId: string,
  botId: string,
  botName: string,
  characterId: string,
  message: string,
): void {
  this.appendChatMessage({
    roomId,
    playerId: botId,
    playerName: botName,
    characterId,
    message,
    type: 'bot',
  });
}
```

호출부는 다음 규칙으로 기계적으로 맞춘다.

```ts
this.sendBotChat(roomId, 'dealer', dealer.name, 'dealer', dealer.chatMessages[0]);
this.sendBotChat(roomId, activePlayer.id, activePlayer.name, activePlayer.avatar, msg);
this.sendBotChat(roomId, player.id, player.name, player.avatar, text);
```

- [ ] **Step 6: 가면 봇의 모든 상황 대사를 공용 표시 프로필로 라우팅한다**

`src/server/room-manager.ts`의 characters import에 `MASKED_BOT_CHARACTER`를 추가하고 다음 두 private helper를 추가한다. `avatar !== personalityId`이면 표시 avatar가 무엇이든 실제 캐릭터나 다른 캐릭터의 고유 말투 대신 하나의 공용 가면 문장만 사용한다.

```ts
private isMaskedBot(player: Player): boolean {
  return player.type === 'bot'
    && !!player.personalityId
    && player.avatar !== player.personalityId;
}

private maskedBotLine(player: Player, situationKey: string): string | null {
  if (situationKey === 'all-in') return MASKED_BOT_CHARACTER.bluffQuote;
  if (situationKey === 'bigpot-win' || situationKey === 'sng-champ') {
    return MASKED_BOT_CHARACTER.winQuote;
  }
  if (situationKey.startsWith('sng-bust')) return MASKED_BOT_CHARACTER.loseQuote;
  if (situationKey === 'throwable-hit') return MASKED_BOT_CHARACTER.chatMessages[0] ?? null;
  return MASKED_BOT_CHARACTER.chatMessages[0] ?? null;
}
```

`startBotLoop`와 `announceWinner`의 캐릭터 조회는 각각 아래처럼 바꿔 가면 봇의 일반 액션·승패 fallback도 공용 프로필에서 나오게 한다. 공개된 봇은 `avatar === personalityId`라 실제 프로필을 사용한다.

```ts
const character = this.isMaskedBot(activePlayer)
  ? MASKED_BOT_CHARACTER
  : getCharacterById(activePlayer.avatar);

const character = this.isMaskedBot(player)
  ? MASKED_BOT_CHARACTER
  : getCharacterById(player.avatar);
```

`botQuip`는 가면일 때 AI/cache 경로에 들어가기 전에 공용 문장을 동기 전송하고 반환한다.

```ts
private async botQuip(
  roomId: string,
  player: Player,
  situationKey: string,
  situation: string,
  fallback: string | null,
): Promise<void> {
  if (this.isMaskedBot(player)) {
    const text = this.maskedBotLine(player, situationKey);
    if (text) this.sendBotChat(roomId, player.id, player.name, player.avatar, text);
    return;
  }

  const line = await this.dialogue.getLine(
    roomId,
    player.personalityId || '',
    situationKey,
    situation,
  );
  const room = this.rooms.get(roomId);
  if (!room || !room.engine.state.players.some(candidate => candidate.id === player.id)) return;
  const text = line ?? fallback;
  if (text) this.sendBotChat(roomId, player.id, player.name, player.avatar, text);
}
```

이 조기 반환이 `all-in`, `bigpot-win`, `sng-bust-*`, `sng-champ`, `throwable-hit` 모두에 적용된다. 일반 fold/raise/chat은 이미 `getCharacterById(activePlayer.avatar)`에서 가면 프로필 문장을 고른다.

- [ ] **Step 7: ChatBubble이 ID 파싱 없이 메시지 스냅샷만 렌더하게 한다**

`src/components/chat/ChatBubble.tsx`의 캐릭터 조회 한 줄을 다음으로 교체한다.

```ts
const character = message.characterId
  ? getCharacterById(message.characterId)
  : undefined;
const nameColor = character?.color || '#A78BFA';
```

기존 emoji fallback `'👤'`는 유지한다. 봇뿐 아니라 캐릭터 아바타를 쓰는 휴먼 메시지도 생성 당시 색/이모지를 표시한다.

`src/components/characters/SeatSpeechBubble.tsx`도 현재 좌석의 name/avatar를 다시 읽지 않고 채팅 스냅샷을 사용한다. 좌석 조회는 `displaySeatIndex` 계산에만 둔다.

```ts
const player = state.gameState?.players.find(candidate => candidate.id === last.playerId);
if (!player) return;

const character = last.characterId
  ? getCharacterById(last.characterId)
  : undefined;
const mySeat = state.gameState?.players.find(candidate => candidate.id === state.myPlayerId)?.seatIndex ?? -1;
setBubble({
  id: last.id,
  displaySeatIndex: toDisplayIndex(player.seatIndex, mySeat),
  name: last.playerName,
  message: last.message,
  color: character?.color || '#A78BFA',
});
```

- [ ] **Step 8: RoomManager 관련 회귀와 타입 검사를 통과시킨다**

Run:

```bash
npx vitest run src/server/room-manager.story.test.ts
npx tsc --noEmit
```

Expected: 관련 테스트와 TypeScript 모두 PASS. 가면 대사 테스트에서 실제 `sakura` AI 호출은 공개 전 0회, 공개 후 1회이며 첫 채팅 객체의 `characterId`는 계속 `story-mask`여야 한다.

- [ ] **Step 9: 서버 표시·채팅 단위를 커밋한다**

```bash
git add src/lib/poker/types.ts src/server/room-manager.ts src/server/room-manager.story.test.ts src/components/chat/ChatBubble.tsx src/components/characters/SeatSpeechBubble.tsx src/lib/store/game-store.leave.test.ts
git commit -m "feat: snapshot masked bot presentation"
```

### Task 4: 런 단위 identity 계획과 서버 전용 reveal seam

**Files:**
- Modify: `src/server/story-live-adapter.ts: LiveEnterInput, LiveSession, freshSession, openRoom, onBotActed, revealBotIdentity`
- Test: `src/server/story-live-adapter.test.ts`

- [ ] **Step 1: 테스트 helper가 좌석별 표시 입력을 받을 수 있게 하고 재개/공개 실패 테스트를 작성한다**

`src/server/story-live-adapter.test.ts`의 `enter` helper에 입력을 추가한다.

```ts
function enter(
  step: LiveStep,
  partnerId: LiveEnterInput['partnerId'] = 'sakura',
  botDisplaysBySeat?: LiveEnterInput['botDisplaysBySeat'],
): string {
  const entered = adapter.enter({
    profileId: PROFILE,
    runId: RUN,
    chapterId: 'act1-ch01',
    chapterTitle: '도장의 문',
    stepIndex: 3,
    step,
    partnerId,
    botDisplaysBySeat,
  });
  expect(entered).toBe('entered');
  const roomId = adapter.view(PROFILE)?.roomId;
  expect(roomId).toBeTruthy();
  return roomId as string;
}
```

같은 describe에 다음 세 테스트를 추가한다.

```ts
it('room-lost 재개가 좌석별 실제 성향과 가면 표시 계획을 재사용한다', () => {
  const roomId = enter(practiceStep(), 'sakura', {
    1: { name: '가면 A', characterId: 'story-mask' },
  });
  const before = stateOf(roomId)!.players.find(player => player.seatIndex === 1)!;
  expect(before).toMatchObject({
    personalityId: 'sakura', name: '가면 A', avatar: 'story-mask',
  });

  manager.handleDisconnect(roomId, PROFILE, Date.now() + 60_000);
  expect(manager.handleGraceExpired(roomId, PROFILE)).toBe(false);
  expect(adapter.resume(PROFILE, RUN)).toEqual({ ok: true });

  const resumedRoomId = adapter.view(PROFILE)!.roomId!;
  const resumed = stateOf(resumedRoomId)!.players.find(player => player.seatIndex === 1)!;
  expect(resumed).toMatchObject({
    personalityId: before.personalityId,
    name: '가면 A',
    avatar: 'story-mask',
  });
});

it('공개는 stale 요청을 거절하고 현재 방에서는 id/personality를 보존한다', () => {
  const roomId = enter(practiceStep(), 'sakura', {
    1: { name: '가면 A', characterId: 'story-mask' },
  });
  const bot = stateOf(roomId)!.players.find(player => player.seatIndex === 1)!;
  const before = { id: bot.id, personalityId: bot.personalityId };

  expect(adapter.revealBotIdentity(PROFILE, 'old-run', 1)).toMatchObject({
    ok: false, code: 'stale-state',
  });
  expect(bot).toMatchObject({ name: '가면 A', avatar: 'story-mask' });

  expect(adapter.revealBotIdentity(PROFILE, RUN, 1)).toEqual({ ok: true });
  expect(bot).toMatchObject({
    ...before,
    name: '사쿠라',
    avatar: 'sakura',
  });
});

it('방이 없는 동안 공개하면 계획만 갱신하고 다음 재개 방에 실제 표시를 적용한다', () => {
  const roomId = enter(practiceStep(), 'sakura', {
    1: { name: '가면 A', characterId: 'story-mask' },
  });
  manager.handleDisconnect(roomId, PROFILE, Date.now() + 60_000);
  expect(manager.handleGraceExpired(roomId, PROFILE)).toBe(false);
  expect(adapter.view(PROFILE)!.roomId).toBeNull();

  expect(adapter.revealBotIdentity(PROFILE, RUN, 1)).toEqual({ ok: true });
  expect(adapter.resume(PROFILE, RUN)).toEqual({ ok: true });

  const resumedRoomId = adapter.view(PROFILE)!.roomId!;
  expect(stateOf(resumedRoomId)!.players.find(player => player.seatIndex === 1)).toMatchObject({
    personalityId: 'sakura', name: '사쿠라', avatar: 'sakura',
  });
});

it('잘못된 표시 identity면 라인업 전체를 열지 않고 room-lost hold로 남긴다', () => {
  expect(adapter.enter({
    profileId: PROFILE,
    runId: RUN,
    chapterId: 'act1-ch01',
    chapterTitle: '도장의 문',
    stepIndex: 3,
    step: practiceStep(),
    partnerId: 'sakura',
    botDisplaysBySeat: {
      1: { name: '가면 A', characterId: 'missing-character' },
    },
  })).toBe('entered');

  expect(manager.getRoomCount()).toBe(0);
  expect(adapter.view(PROFILE)).toMatchObject({
    roomId: null,
    hold: true,
    holdReason: 'room-lost',
  });
});
```

기존 봇 속마음 테스트에는 다음 assertion을 추가해 공개 표시값 스냅샷을 고정한다.

```ts
expect(thought.characterId).toBe(
  stateOf(roomId2)!.players.find(player => player.id === thought.playerId)!.avatar,
);
```

- [ ] **Step 2: 어댑터 테스트가 identity 계획/API 부재로 실패하는지 확인한다**

Run:

```bash
npx vitest run src/server/story-live-adapter.test.ts
```

Expected: FAIL. `LiveEnterInput.botDisplaysBySeat`와 `revealBotIdentity`가 없고, room-lost 재개가 저장된 좌석 계획을 사용하지 않는 실패가 보여야 한다.

- [ ] **Step 3: 라이브 입력과 세션에 불변 identity 계획을 추가한다**

`src/server/story-live-adapter.ts`에서 bot-manager import에 `BotDisplayIdentity`를 추가하고 characters의 `getCharacterById`를 import한 뒤 입력/세션 타입을 다음처럼 확장한다. 별도 챕터 데이터나 Ch7 퀴즈 필드는 만들지 않는다.

```ts
import { createBotWithCharacter, type BotDisplayIdentity } from '../lib/bot/bot-manager';
import { getCharacterById } from '../lib/characters';
```

```ts
export interface LiveEnterInput {
  profileId: string;
  runId: string;
  chapterId: string;
  chapterTitle: string;
  stepIndex: number;
  step: LiveStep;
  partnerId: StoryHeroineId | null;
  botDisplaysBySeat?: Readonly<Record<number, BotDisplayIdentity>>;
}

interface StoryBotIdentity {
  seatIndex: number;
  personalityId: string;
  maskedDisplay: BotDisplayIdentity | null;
  revealed: boolean;
}

interface LiveSession {
  profileId: string;
  runId: string;
  chapterId: string;
  chapterTitle: string;
  stepIndex: number;
  step: LiveStep;
  partnerId: StoryHeroineId | null;
  botDisplaysBySeat?: Readonly<Record<number, BotDisplayIdentity>>;
  botIdentities: StoryBotIdentity[] | null;
  roomId: string | null;
  deck: ScenarioDeck | null;
  scriptCursor: number;
  handsPlayed: number;
  heroStartChips: number;
  netChips: number;
  tally: ObjectiveTally;
  lastReview: DecisionReview | null;
  botThoughts: BotThought[];
  firedInterrupts: Set<string>;
  hold: boolean;
  holdReason: StoryHoldReason | null;
  holdSince: number | null;
  interruptId: string | null;
  finishTimer: NodeJS.Timeout | null;
  disposing: boolean;
}
```

`freshSession`은 호출자가 넘긴 표시 객체를 직접 공유하지 않도록 복사하되, 실제 캐릭터 해석은 한 번만 하는 `buildBotIdentityPlan`에 맡긴다.

```ts
private freshSession(input: LiveEnterInput): LiveSession {
  return {
    profileId: input.profileId,
    runId: input.runId,
    chapterId: input.chapterId,
    chapterTitle: input.chapterTitle,
    stepIndex: input.stepIndex,
    step: input.step,
    partnerId: input.partnerId,
    botDisplaysBySeat: input.botDisplaysBySeat
      ? Object.fromEntries(Object.entries(input.botDisplaysBySeat).map(([seat, display]) => [
          seat,
          { ...display },
        ]))
      : undefined,
    botIdentities: null,
    roomId: null,
    deck: null,
    scriptCursor: 0,
    handsPlayed: 0,
    heroStartChips: input.step.table.heroStackBB * input.step.table.blinds.big,
    netChips: 0,
    tally: emptyTally(),
    lastReview: null,
    botThoughts: [],
    firedInterrupts: new Set(),
    hold: false,
    holdReason: null,
    holdSince: null,
    interruptId: null,
    finishTimer: null,
    disposing: false,
  };
}
```

- [ ] **Step 4: 실제 lineup 해석을 최초 한 번만 수행하는 계획 빌더를 추가한다**

현재 `resolveLineupCharacter`를 재사용해 다음 private 메서드를 추가한다. 한 좌석이라도 실제 캐릭터나 표시 identity가 유효하지 않으면 `null`을 반환하여 방 전체가 `lineup-failed` 경로로 간다.

```ts
private buildBotIdentityPlan(session: LiveSession): StoryBotIdentity[] | null {
  const refs = session.step.table.lineup.map(seat => seat.characterId);
  const used = new Set<string>();
  const plan: StoryBotIdentity[] = [];

  for (const seat of session.step.table.lineup) {
    const personalityId = this.resolveLineupCharacter(
      seat.characterId,
      session.partnerId,
      refs,
      used,
    );
    const display = session.botDisplaysBySeat?.[seat.seatIndex];
    if (
      !personalityId
      || (display && (!display.name.trim() || !getCharacterById(display.characterId)))
    ) return null;
    plan.push({
      seatIndex: seat.seatIndex,
      personalityId,
      maskedDisplay: display ? { name: display.name.trim(), characterId: display.characterId } : null,
      revealed: false,
    });
    used.add(personalityId);
  }

  return plan;
}
```

`openRoom`은 기존 순서대로 방을 만들고 `session.roomId`, hold, `byRoom` 소유권을 먼저 설정한다. 그 직후 `session.botIdentities`가 `null`일 때만 위 메서드를 호출한다. `null`이면 `lineup-failed`를 기록하고 방을 `story-end`로 정리한 뒤 `false`를 반환한다. 현재 `const used`/`resolveLineupCharacter` 루프 전체는 다음 plan 기반 블록으로 교체한다.

```ts
const identities = session.botIdentities
  ?? this.buildBotIdentityPlan(session);
if (!identities) {
  eventLog.log('story-step', {
    roomId,
    playerId: session.profileId,
    data: {
      runId: session.runId,
      event: 'lineup-failed',
      reason: 'invalid-identity-plan',
    },
  });
  this.disposeOwnRoom(session, 'story-end');
  return false;
}
session.botIdentities = identities;

for (const identity of identities) {
  const seat = table.lineup.find(candidate => candidate.seatIndex === identity.seatIndex)!;
  const actual = getCharacterById(identity.personalityId);
  const display = identity.revealed || !identity.maskedDisplay
    ? undefined
    : identity.maskedDisplay;
  const bot = actual
    ? createBotWithCharacter(
        identity.seatIndex,
        seat.stackBB * big,
        identity.personalityId,
        table.difficulty,
        display,
      )
    : null;
  if (!bot || !this.options.roomManager.joinRoom(roomId, bot)) {
    eventLog.log('story-step', {
      roomId,
      playerId: session.profileId,
      data: {
        runId: session.runId,
        event: 'lineup-failed',
        seat: identity.seatIndex,
        characterId: identity.personalityId,
      },
    });
    this.disposeOwnRoom(session, 'story-end');
    return false;
  }
}
```

`session.botIdentities`는 `markRoomLost`에서 지우지 않고, `dropSession`/새 `freshSession`에서만 자연스럽게 폐기된다. 새 runId 또는 stepIndex의 `enter`는 기존 조건식대로 새 세션을 만들므로 이전 매핑을 재사용하지 않는다.

- [ ] **Step 5: 서버 전용 공개 명령을 원자적 검증 후 적용한다**

`LiveTableAdapter`의 공개 메서드로 다음을 추가한다. 소켓 protocol/handler에는 이벤트를 추가하지 않는다. 현재 방이 있으면 좌석과 성향을 먼저 검증한 후 계획을 바꾸고, RoomManager 실패 시 계획을 원복하여 부분 상태를 남기지 않는다.

```ts
revealBotIdentity(
  profileId: string,
  runId: string,
  seatIndex: number,
): LiveCommandResult {
  const session = this.sessions.get(profileId);
  if (!session || session.runId !== runId) {
    return { ok: false, code: 'stale-state', message: '이미 끝난 테이블 스텝이에요.' };
  }
  const identity = session.botIdentities?.find(candidate => candidate.seatIndex === seatIndex);
  const actual = identity ? getCharacterById(identity.personalityId) : undefined;
  if (!identity || !actual || actual.id === 'dealer' || actual.id === 'story-mask') {
    return { ok: false, code: 'action-rejected', message: '공개할 봇 좌석을 찾지 못했어요.' };
  }
  if (identity.revealed) return { ok: true };

  let botId: string | null = null;
  if (session.roomId) {
    const bot = this.options.roomManager.getRoom(session.roomId)?.engine.state.players.find(player => (
      player.seatIndex === seatIndex
      && player.type === 'bot'
      && player.personalityId === identity.personalityId
      && !player.pendingRemoval
    ));
    if (!bot) {
      return { ok: false, code: 'action-rejected', message: '공개할 봇 좌석을 찾지 못했어요.' };
    }
    botId = bot.id;
  }

  identity.revealed = true;
  if (session.roomId && botId && !this.options.roomManager.updateStoryBotDisplayIdentity(
    session.roomId,
    botId,
    { name: actual.name, characterId: actual.id },
  )) {
    identity.revealed = false;
    return { ok: false, code: 'action-rejected', message: '봇 정체를 공개하지 못했어요.' };
  }
  this.events?.onLiveChanged(profileId);
  return { ok: true };
}
```

이 메서드는 `profileId + runId + seatIndex`만 받으며 클라이언트가 실제 characterId를 제출할 수 없다. 현재 방이 없으면 `revealed`만 남고, 다음 `openRoom`에서 `display === undefined`가 되어 실제 이름/avatar가 적용된다.

- [ ] **Step 6: 봇 속마음도 공개 당시 avatar를 스냅샷하게 한다**

`LiveTableAdapter.onBotActed`의 `BotThought` 생성 필드 하나를 다음처럼 바꾼다.

```ts
characterId: bot.avatar,
```

`explanation.text` 생성은 기존 `bot-explain`의 캐릭터 중립 설명을 그대로 사용하고 실제 이름·고유 말투를 새로 넣지 않는다.

- [ ] **Step 7: 스토리 재개/공개 회귀를 통과시킨다**

Run:

```bash
npx vitest run src/server/story-live-adapter.test.ts
```

Expected: PASS. room-lost 전후 좌석 1의 `personalityId`와 가면 표시가 같고, 현재 방 공개는 id/성향을 보존하며, 방 없는 공개는 다음 방에 실제 이름/avatar로 반영되어야 한다.

- [ ] **Step 8: 스토리 identity 단위를 커밋한다**

```bash
git add src/server/story-live-adapter.ts src/server/story-live-adapter.test.ts
git commit -m "feat: preserve and reveal story bot identities"
```

### Task 5: 승인된 최소 회귀와 누출 최종 감사

**Files:**
- Verify only: 위 네 관련 테스트 파일과 전체 TypeScript 타입 그래프

- [ ] **Step 1: 승인된 관련 회귀 네 파일만 한 번에 실행한다**

Run:

```bash
npx vitest run src/lib/poker/engine.public-state.test.ts src/lib/bot/bot-manager.identity.test.ts src/server/room-manager.story.test.ts src/server/story-live-adapter.test.ts
```

Expected: 네 파일 모두 PASS. 전체 Vitest, `npm run build`, 브라우저 E2E, lint는 이 작업 범위에서 실행하지 않는다.

- [ ] **Step 2: 공개 타입 그래프를 검사한다**

Run:

```bash
npx tsc --noEmit
```

Expected: PASS, diagnostics 0.

- [ ] **Step 3: 금지된 누출 패턴과 변경 범위를 감사한다**

Run:

```bash
rg -n "personalityId|playerId\.split|split\('-'\)" src/components src/lib/store src/lib/events src/lib/realtime
git diff --check HEAD~4..HEAD
git status --short
```

Expected: 첫 명령은 클라이언트 공개 경로에서 출력이 없어야 한다. `git diff --check`는 출력 없이 성공하고, `git status --short`는 비어 있어야 한다. 서버의 `bot-manager`, `bot-ai`, `RoomManager`, `LiveTableAdapter` 내부 `personalityId` 사용은 의도된 행동 identity이므로 이 감사 경로에 포함하지 않는다.

## 구현 시 지켜야 할 비변경 계약

- `CompletedHandRecord.players[].name`은 `PokerEngine.finalizeHandRecord`가 핸드 완료 시 문자열로 복사하므로 DB migration이나 과거 기록 재작성 코드를 추가하지 않는다.
- `BOT_CHARACTERS`, `getRandomBotCharacter`, 인연/도감/파트너/해금 후보에는 `story-mask`를 넣지 않는다.
- `Player.personalityId`, `botSkill`, `decideBotAction`, HUD 성향 계산을 바꾸지 않는다.
- reveal 소켓 이벤트, Ch7 데이터, 퀴즈 채점, 공개 애니메이션, 서버 재시작을 넘는 매핑 영속화를 추가하지 않는다.
- 진행 중 핸드의 과거 action/chat/history를 소급 변경하지 않는다. 공개 뒤 새로 생성되는 표시 데이터만 실제 identity를 사용한다.
- `getPublicState`는 공개 객체만 새로 만들며 내부 `Player` 또는 실제 홀카드를 삭제·수정하지 않는다.
