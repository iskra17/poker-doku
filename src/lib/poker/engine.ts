import { Deck } from './deck';
import { evaluateHand, compareHands } from './evaluator';
import {
  GameState, Player, PlayerAction, ActionType,
  Pot, WinResult, Card, RoomConfig,
} from './types';
import {
  positionLabels,
  type CompletedHandRecord,
  type HandHistoryAction,
} from './hand-history';
import { SNG_PRIZE_SPLIT } from './blind-schedule';
import { allocateRakeAcrossPots, computeCashRake } from '../economy/rake';

// 타임칩: N핸드 참여마다 1개 적립, 최대 보유량 제한
export const TIME_BANK_ACCRUAL_HANDS = 10;
export const TIME_BANK_MAX = 3;

/**
 * 어떤 액션이 합법인지 판정하는 **단일 소스**. 서버(PokerEngine.getValidActions)와
 * 클라이언트(ActionBar 버튼 노출)가 반드시 이 함수를 함께 쓴다 — 규칙을 양쪽에 각각 구현하면
 * 어긋나는 순간 "버튼은 보이는데 눌러도 서버가 거부하는" 먹통 버튼이 생긴다 (실제로 겪은 버그).
 *
 * 규칙:
 * - 콜/체크: 내 벳이 테이블 벳에 못 미치면 콜, 아니면 체크.
 * - 레이즈/올인: 응수할 상대(active)가 남아 있어야 의미가 있다. 전원 올인이면 초과분은
 *   아무도 콜할 수 없는 데드 액션이라 콜/폴드만 (표준 룰).
 * - 올인: 내 전 스택이 테이블 벳을 **넘길 수 있을 때만** 별도 액션. 스택이 콜 금액 이하면
 *   그 올인은 곧 콜(올인 콜)이라 콜이 이미 처리한다.
 * - 레이즈: 최소 레이즈액을 채울 수 있을 때만. 못 채우면 올인(언더레이즈)만 가능.
 */
export function computeValidActions(
  state: Pick<GameState, 'players' | 'currentBet' | 'minRaise'>,
  player: Pick<Player, 'id' | 'chips' | 'currentBet'>,
): ActionType[] {
  const actions: ActionType[] = ['fold'];

  if (player.currentBet >= state.currentBet) {
    actions.push('check');
  } else {
    actions.push('call');
  }

  const othersCanRespond = state.players.some(
    p => p.id !== player.id && p.status === 'active',
  );

  const myMaxTotal = player.chips + player.currentBet;
  const minRaiseAmount = state.currentBet + state.minRaise;
  if (othersCanRespond && myMaxTotal > state.currentBet) {
    if (myMaxTotal >= minRaiseAmount) {
      actions.push('raise');
    }
    actions.push('all-in');
  }

  return actions;
}

interface HandRecordDraft {
  handNumber: number;
  smallBlind: number;
  bigBlind: number;
  actions: HandHistoryAction[];
  participantIds: Set<string>;
  positions: Map<string, string>;
}

/**
 * 서버 런타임이 주입하는 훅 — lib 순수성 유지를 위해 엔진은 서버 설정을 직접 import하지
 * 않고, 정산 시점마다 provider를 호출해 현재 유효값을 읽는다 (핫 컨피그 next-hand 반영).
 */
export interface EngineRuntimeHooks {
  /** 캐시(wallet) 레이크 정책 — 미주입 시 rake.ts 기본값 (5% / 5BB 캡) */
  rakePolicy?: () => { rateBps: number; capBB: number };
}

export class PokerEngine {
  private deck: Deck;
  private config: RoomConfig;
  private readonly runtimeHooks: EngineRuntimeHooks;
  state: GameState;
  /** 진행 중 핸드의 히스토리 초안 — startHand가 열고 endHand가 완성한다 */
  private handRecordDraft: HandRecordDraft | null = null;
  /**
   * 마지막으로 완료된 핸드의 히스토리 (다음 핸드 시작까지 유지).
   * 전체 홀카드를 포함하므로 브로드캐스트·로그로 내보내지 말 것 — 히어로 관점 마스킹은
   * 저장 계층(HandHistoryService) 책임.
   */
  private completedHandRecord: CompletedHandRecord | null = null;

  constructor(
    config: RoomConfig,
    roomId: string,
    deck: Deck = new Deck(),
    runtimeHooks: EngineRuntimeHooks = {},
  ) {
    this.deck = deck;
    this.config = config;
    this.runtimeHooks = runtimeHooks;
    this.state = {
      id: roomId,
      players: [],
      communityCards: [],
      pots: [{ amount: 0, eligiblePlayerIds: [] }],
      currentBet: 0,
      minRaise: config.bigBlind,
      street: 'preflop',
      dealerIndex: 0,
      activePlayerIndex: -1,
      smallBlind: config.smallBlind,
      bigBlind: config.bigBlind,
      isHandInProgress: false,
      winners: null,
      handRake: 0,
      economyMode: config.economyMode,
      lastAction: null,
      turnTimer: config.turnTime,
      handNumber: 0,
      actionSeq: 0,
      hostId: config.hostId,
      ...(config.gameMode === 'sng'
        ? {
            tournament: {
              level: 1,
              smallBlind: config.smallBlind,
              bigBlind: config.bigBlind,
              nextSmallBlind: null,
              nextBigBlind: null,
              levelEndsAt: 0,
              entrants: 0,
              prizes: [],
              finished: false,
              results: [],
            },
          }
        : {}),
    };
  }

  // --- 시트앤고 토너먼트 ---

  /**
   * 토너먼트 개시 — 첫 핸드 시작 직전에 호출.
   * 참가 인원/상금 풀(총 칩 × 배분율)을 확정한다.
   */
  startTournament(levelEndsAt: number, nextSmallBlind: number | null, nextBigBlind: number | null): void {
    const t = this.state.tournament;
    if (!t || t.entrants > 0) return;
    t.entrants = this.state.players.length;
    if (this.config.competitionMode) {
      t.prizes = [];
    } else {
      const pool = this.state.players.reduce((sum, p) => sum + p.chips, 0);
      t.prizes = SNG_PRIZE_SPLIT.map(ratio => Math.round(pool * ratio));
    }
    t.levelEndsAt = levelEndsAt;
    t.nextSmallBlind = nextSmallBlind;
    t.nextBigBlind = nextBigBlind;
  }

  /**
   * 블라인드 레벨 인상 — 핸드 사이에만 호출할 것.
   * postBlinds/minRaise가 this.config를 라이브로 읽으므로 config도 함께 갱신한다.
   */
  setTournamentLevel(
    level: number,
    smallBlind: number,
    bigBlind: number,
    nextSmallBlind: number | null,
    nextBigBlind: number | null,
    levelEndsAt: number,
  ): void {
    const t = this.state.tournament;
    if (!t) return;
    this.config.smallBlind = smallBlind;
    this.config.bigBlind = bigBlind;
    this.state.smallBlind = smallBlind;
    this.state.bigBlind = bigBlind;
    t.level = level;
    t.smallBlind = smallBlind;
    t.bigBlind = bigBlind;
    t.nextSmallBlind = nextSmallBlind;
    t.nextBigBlind = nextBigBlind;
    t.levelEndsAt = levelEndsAt;
  }

  /** 순위 확정 기록 (상금은 표시용 — 칩에 더하지 않음) */
  private recordFinish(player: Player, place: number): void {
    const t = this.state.tournament;
    if (!t || player.finishPlace) return;
    player.finishPlace = place;
    t.results.push({
      playerId: player.id,
      name: player.name,
      place,
      prize: t.prizes[place - 1] ?? 0,
    });
    t.results.sort((a, b) => a.place - b.place);
  }

  /** 이번 핸드에서 버스트된 플레이어들의 순위 확정 (동시 탈락은 핸드 시작 스택이 큰 쪽이 상위) */
  private assignFinishPlaces(): void {
    const t = this.state.tournament;
    if (!t || t.finished) return;
    const busted = this.state.players.filter(
      p => p.chips <= 0 && !p.finishPlace && !p.pendingRemoval,
    );
    if (busted.length === 0) return;
    // 작은 스택부터 낮은 순위(큰 숫자) 부여
    busted.sort((a, b) => (a.handStartChips ?? 0) - (b.handStartChips ?? 0));
    let place = this.state.players.filter(p => !p.finishPlace && !p.pendingRemoval).length;
    for (const p of busted) {
      this.recordFinish(p, place--);
    }
  }

  /** 칩 보유자가 1명 남으면 우승 확정 + 토너먼트 종료 */
  private checkTournamentEnd(): void {
    const t = this.state.tournament;
    if (!t || t.finished || t.entrants === 0) return;
    const alive = this.state.players.filter(
      p => p.chips > 0 && !p.finishPlace && !p.pendingRemoval,
    );
    if (alive.length === 1) {
      this.recordFinish(alive[0], 1);
      t.finished = true;
    }
  }

  addPlayer(player: Player): boolean {
    if (this.state.players.length >= this.config.maxPlayers) return false;
    if (this.state.players.find(p => p.seatIndex === player.seatIndex)) return false;
    // 같은 id가 두 좌석을 잡으면 팟 회계(totalContributed 합산)와 턴 순서가 깨진다.
    // 호출부(join-room)가 멱등 경로로 먼저 걸러내지만, 여기서도 최종 방어한다.
    if (this.state.players.find(p => p.id === player.id)) return false;

    // 포지션(버튼/블라인드/액션 순서)은 전부 players 배열 순서로 돌기 때문에 배열은 항상
    // seatIndex 오름차순을 유지해야 한다 — 끝에 push만 하면 중간 좌석(봇 양보석 등)에 앉은
    // 플레이어가 배열 끝에 붙어 버튼이 테이블을 시계방향으로 돌지 않는다 (실제 신고된 찐빠).
    // 핸드 진행 중엔 배열 삽입이 dealerIndex/activePlayerIndex를 밀어내므로 끝에 붙이고,
    // startHand의 normalizeSeatOrder()가 다음 핸드 전에 정렬한다.
    if (this.state.isHandInProgress) {
      this.state.players.push(player);
      return true;
    }
    const insertIdx = this.state.players.findIndex(p => p.seatIndex > player.seatIndex);
    if (insertIdx === -1) {
      this.state.players.push(player);
    } else {
      this.state.players.splice(insertIdx, 0, player);
      // 버튼 앞에 끼어들면 버튼이 같은 사람을 가리키도록 한 칸 보정
      if (insertIdx <= this.state.dealerIndex) this.state.dealerIndex++;
    }
    return true;
  }

  /**
   * 플레이어 이탈 처리.
   * 핸드 진행 중에는 절대 splice하지 않는다 (dealerIndex/activePlayerIndex 밀림 방지).
   * 대신 폴드 + pendingRemoval 마킹으로 좌석을 유지하고, 다음 핸드 시작 시 일괄 제거한다.
   */
  processLeave(playerId: string): { player: Player | null; handComplete: boolean } {
    const idx = this.state.players.findIndex(p => p.id === playerId);
    if (idx === -1) return { player: null, handComplete: false };
    const player = this.state.players[idx];

    // 시트앤고 진행 중 이탈 = 현재 순위로 탈락 확정 (기록은 results에 남아 splice와 무관)
    const t = this.state.tournament;
    if (t && t.entrants > 0 && !t.finished && !player.finishPlace) {
      const alivePlace = this.state.players.filter(p => !p.finishPlace && !p.pendingRemoval).length;
      this.recordFinish(player, alivePlace);
      // 이탈자는 finishPlace가 생겨 alive 계산에서 빠짐 — 1명만 남으면 즉시 우승 확정
      this.checkTournamentEnd();
    }

    if (!this.state.isHandInProgress) {
      this.state.players.splice(idx, 1);
      if (this.state.players.length === 0) {
        this.state.dealerIndex = 0;
      } else if (idx < this.state.dealerIndex) {
        this.state.dealerIndex--;
      } else if (idx === this.state.dealerIndex) {
        // 버튼 좌석 본인이 떠나면 버튼은 "이전 좌석"이 기준이 되어야 다음 핸드의
        // advanceDealerButton이 떠난 좌석의 다음 좌석으로 자연 이동한다.
        // max(0, idx-1) 클램프는 인덱스 0의 버튼 이탈 시 0을 유지해 다음 좌석을 건너뛰었다
        // (예: [A,B,C]에서 버튼 A 이탈 → C가 버튼, B는 BB 연속 납부). 랩어라운드로 보정한다.
        this.state.dealerIndex = idx === 0 ? this.state.players.length - 1 : idx - 1;
      }
      this.state.dealerIndex %= this.state.players.length;
      return { player, handComplete: false };
    }

    player.pendingRemoval = true;
    const wasInHand = player.status === 'active' || player.status === 'all-in';
    const wasTheirTurn = this.state.players[this.state.activePlayerIndex]?.id === playerId;
    if (!wasInHand) return { player, handComplete: false };

    // 올인 이탈자도 폴드 처리 — 기여금은 dead money로 rebuildPots가 팟에 남긴다
    player.status = 'folded';
    this.handRecordDraft?.actions.push({
      street: this.state.street,
      playerId: player.id,
      kind: 'fold',
      amount: 0,
    });
    this.rebuildPots();
    const { handComplete } = this.advanceAfterAction(wasTheirTurn);
    return { player, handComplete };
  }

  /**
   * 제거 예약된 플레이어를 일괄 제거 (핸드 시작 전에만 호출).
   * 버튼 보정은 앵커 방식: dealerIndex에서 뒤로(랩어라운드) 걸어 제거되지 않는 첫 좌석을
   * 새 버튼 기준으로 삼는다 — 버튼 본인이 떠나도 advanceDealerButton이 "떠난 좌석의 다음
   * 좌석"으로 자연 이동한다. (이전의 max(0, i-1) 클램프는 인덱스 0의 버튼이 떠날 때
   * 다음 좌석 하나를 건너뛰게 했다.)
   */
  removePendingPlayers(): void {
    const players = this.state.players;
    const n = players.length;
    if (n === 0 || !players.some(p => p.pendingRemoval)) {
      if (n === 0) this.state.dealerIndex = 0;
      return;
    }
    let anchorId: string | null = null;
    for (let k = 0; k < n; k++) {
      const idx = (this.state.dealerIndex - k + n) % n;
      if (!players[idx]?.pendingRemoval) {
        anchorId = players[idx].id;
        break;
      }
    }
    this.state.players = players.filter(p => !p.pendingRemoval);
    const anchorIdx = anchorId
      ? this.state.players.findIndex(p => p.id === anchorId)
      : -1;
    this.state.dealerIndex = anchorIdx >= 0 ? anchorIdx : 0;
  }

  /**
   * players 배열을 seatIndex 오름차순으로 정렬 (버튼은 같은 사람 유지).
   * 포지션 로직이 전부 배열 순서를 따르므로, 핸드 중 입장(배열 끝 push)으로 어긋난 순서를
   * 다음 핸드 시작 전에 복원한다 — 이 정렬이 없으면 버튼/블라인드가 좌석 순서가 아니라
   * 입장 순서로 돈다. 핸드 진행 중 호출 금지 (activePlayerIndex가 밀린다).
   */
  private normalizeSeatOrder(): void {
    const dealer = this.state.players[this.state.dealerIndex];
    this.state.players.sort((a, b) => a.seatIndex - b.seatIndex);
    const idx = dealer
      ? this.state.players.findIndex(p => p.id === dealer.id)
      : -1;
    this.state.dealerIndex = idx >= 0 ? idx : 0;
  }

  getActivePlayers(): Player[] {
    return this.state.players.filter(p => p.status === 'active' || p.status === 'all-in');
  }

  getActingPlayers(): Player[] {
    return this.state.players.filter(p => p.status === 'active');
  }

  canStartHand(): boolean {
    const ready = this.state.players.filter(p => p.status !== 'sitting-out' && p.chips > 0);
    return ready.length >= 2;
  }

  startHand(): void {
    // 좌석 정렬 → 이탈자 제거 순서 — 정렬을 먼저 해야 removePendingPlayers의 버튼 앵커
    // 역방향 탐색이 좌석 순서 기준으로 돈다 (핸드 중 입장자는 배열 끝에 붙어 있으므로)
    this.normalizeSeatOrder();
    this.removePendingPlayers();
    if (this.state.tournament?.finished) return; // 토너먼트 종료 후 새 핸드 금지
    if (!this.canStartHand()) return;

    this.deck.reset();
    this.state.handNumber++;
    this.state.isHandInProgress = true;
    this.state.communityCards = [];
    this.state.pots = [{ amount: 0, eligiblePlayerIds: [] }];
    this.state.currentBet = 0;
    this.state.minRaise = this.config.bigBlind;
    this.state.street = 'preflop';
    this.state.winners = null;
    this.state.handRake = 0;
    this.state.lastAction = null;
    this.state.lastAggressorId = null;
    this.state.allInRunout = false;

    // Reset players
    for (const player of this.state.players) {
      player.totalContributed = 0;
      player.handStartChips = player.chips; // 동시 탈락 순위 판정용 스냅샷
      if (player.chips > 0 && player.status !== 'sitting-out') {
        player.status = 'active';
        player.holeCards = [];
        player.currentBet = 0;
        player.hasActed = false;
        // 타임칩 적립 — 참여 핸드 수 기준 (휴먼만)
        if (player.type === 'human') {
          player.handsPlayed = (player.handsPlayed ?? 0) + 1;
          if (player.handsPlayed % TIME_BANK_ACCRUAL_HANDS === 0) {
            player.timeBankChips = Math.min(TIME_BANK_MAX, (player.timeBankChips ?? 0) + 1);
          }
        }
      } else {
        player.status = 'sitting-out';
      }
    }

    // Move dealer button
    this.advanceDealerButton();

    // 히스토리 초안 개시 — 딜러 확정 직후·블라인드 포스팅 직전 (포스트도 액션으로 기록)
    this.beginHandRecord();

    // Post blinds
    this.postBlinds();

    // Deal hole cards
    const activePlayers = this.getActivePlayers();
    for (const player of activePlayers) {
      player.holeCards = this.deck.deal(2);
    }

    // Set first actor (UTG, left of BB)
    this.setFirstActor();

    // 블라인드 포스팅만으로 이미 액션이 불가능한 핸드(블라인드 올인 등)는 즉시 진행 —
    // 첫 액터가 없거나(전원 올인) 베팅 라운드가 이미 완결이면 보드를 런아웃한다.
    // 이 처리가 없으면 activePlayerIndex가 올인 좌석을 가리켜 게임이 교착된다.
    const firstActor = this.state.players[this.state.activePlayerIndex];
    if (!firstActor || firstActor.status !== 'active' || this.isBettingRoundComplete()) {
      this.advanceAfterAction(false);
    }
  }

  private advanceDealerButton(): void {
    const active = this.state.players.filter(p => p.status !== 'sitting-out');
    if (active.length === 0) return;

    let nextDealer = (this.state.dealerIndex + 1) % this.state.players.length;
    while (this.state.players[nextDealer].status === 'sitting-out') {
      nextDealer = (nextDealer + 1) % this.state.players.length;
    }
    this.state.dealerIndex = nextDealer;
  }

  private getNextActiveIndex(fromIndex: number): number {
    const n = this.state.players.length;
    let idx = (fromIndex + 1) % n;
    let attempts = 0;
    while (attempts < n) {
      if (this.state.players[idx].status === 'active') return idx;
      idx = (idx + 1) % n;
      attempts++;
    }
    return -1;
  }

  private postBlinds(): void {
    const active = this.state.players.filter(p => p.status !== 'sitting-out');
    if (active.length < 2) return;

    const dealerPos = this.state.dealerIndex;

    if (active.length === 2) {
      // Heads-up: dealer posts SB, other posts BB
      const sbPlayer = this.state.players[dealerPos];
      const bbIdx = this.getNextActiveIndex(dealerPos);
      const bbPlayer = this.state.players[bbIdx];
      this.postBlind(sbPlayer, this.config.smallBlind, 'post-sb');
      this.postBlind(bbPlayer, this.config.bigBlind, 'post-bb');
    } else {
      const sbIdx = this.getNextActiveIndex(dealerPos);
      const bbIdx = this.getNextActiveIndex(sbIdx);
      this.postBlind(this.state.players[sbIdx], this.config.smallBlind, 'post-sb');
      this.postBlind(this.state.players[bbIdx], this.config.bigBlind, 'post-bb');
    }

    this.state.currentBet = this.config.bigBlind;
    this.rebuildPots();
  }

  private postBlind(player: Player, amount: number, kind: 'post-sb' | 'post-bb'): void {
    const actual = Math.min(amount, player.chips);
    player.chips -= actual;
    player.currentBet = actual;
    player.totalContributed += actual;
    if (player.chips === 0) {
      player.status = 'all-in';
    }
    this.handRecordDraft?.actions.push({
      street: 'preflop',
      playerId: player.id,
      kind,
      amount: actual,
    });
  }

  /** 이 핸드에 딜인된 다음 좌석 (active/all-in) — 블라인드 올인자도 포지션 계산에 포함 */
  private getNextInHandIndex(fromIndex: number): number {
    const n = this.state.players.length;
    let idx = (fromIndex + 1) % n;
    for (let k = 0; k < n; k++) {
      const status = this.state.players[idx].status;
      if (status === 'active' || status === 'all-in') return idx;
      idx = (idx + 1) % n;
    }
    return -1;
  }

  private setFirstActor(): void {
    const active = this.state.players.filter(p => p.status !== 'sitting-out');
    const dealerPos = this.state.dealerIndex;

    if (this.state.street === 'preflop') {
      if (active.length === 2) {
        // Heads-up: dealer (SB) acts first preflop.
        // 블라인드 포스팅으로 이미 올인이면 액션 가능한 다음 좌석 (없으면 -1 — startHand가 즉시 진행 처리)
        this.state.activePlayerIndex = this.state.players[dealerPos]?.status === 'active'
          ? dealerPos
          : this.getNextActiveIndex(dealerPos);
      } else {
        // UTG: left of BB. 포지션(SB/BB)은 올인 여부와 무관하게 딜인 좌석 기준으로 계산해야
        // 블라인드 올인 시 첫 액터가 밀리지 않는다. 첫 액터 자체는 액션 가능(active) 좌석만.
        const sbIdx = this.getNextInHandIndex(dealerPos);
        const bbIdx = this.getNextInHandIndex(sbIdx);
        this.state.activePlayerIndex = this.getNextActiveIndex(bbIdx);
      }
    } else {
      // Post-flop: first active player left of dealer
      this.state.activePlayerIndex = this.getNextActiveIndex(dealerPos);
    }
  }

  /**
   * 다음 핸드에서 빅블라인드를 낼 것으로 예측되는 플레이어 id (딜인 2인 미만이면 null).
   * '다음 빅블라인드 전에 나가기' 예약 판정용 — 핸드 사이(핸드 종료 직후) 호출 전제.
   * 딜인 예측은 새 핸드 리셋 규칙을 미러링한다: 캐시는 칩 보유 + 접속 유지 + 비자리비움,
   * SnG는 칩 보유 좌석 전부(자리비움도 딜인 유지). 실제 핸드 시작 전에 좌석 구성이 바뀌면
   * 결과가 달라질 수 있는 예측치다. 회귀: engine.button.test.ts가 실제 BB 배정과 대조한다.
   */
  predictNextBigBlindId(): string | null {
    const isSng = !!this.state.tournament;
    const dealt = this.state.players
      .filter(p =>
        !p.pendingRemoval
        && p.chips > 0
        && (isSng || !(p.isDisconnected || p.sitOutNext)))
      .sort((a, b) => a.seatIndex - b.seatIndex);
    if (dealt.length < 2) return null;

    // 다음 버튼 = 현재 버튼 좌석 기준 좌석 순서상 다음 딜인 좌석 (advanceDealerButton 미러 —
    // 현재 버튼이 이탈 예약이어도 removePendingPlayers 앵커가 같은 좌석 기준을 유지한다)
    const anchorSeat = this.state.players[this.state.dealerIndex]?.seatIndex ?? -1;
    let btn = dealt.findIndex(p => p.seatIndex > anchorSeat);
    if (btn === -1) btn = 0;
    // 헤즈업은 버튼이 SB — 상대가 BB. 3인 이상은 버튼+2.
    const bbOffset = dealt.length === 2 ? 1 : 2;
    return dealt[(btn + bbOffset) % dealt.length].id;
  }

  processAction(action: PlayerAction): { valid: boolean; handComplete: boolean } {
    // 서버 권위 하드닝: 핸드 종료~다음 핸드 시작 사이의 stale 액션을 엔진 레벨에서도 거부
    if (!this.state.isHandInProgress) return { valid: false, handComplete: false };
    const player = this.state.players.find(p => p.id === action.playerId);
    if (!player || player.status !== 'active') return { valid: false, handComplete: false };
    if (this.state.players[this.state.activePlayerIndex]?.id !== action.playerId) {
      return { valid: false, handComplete: false };
    }

    const validActions = this.getValidActions(player);
    if (!validActions.includes(action.type)) return { valid: false, handComplete: false };

    // 히스토리용 액션 금액 — call은 추가 투입액, raise/all-in은 해당 스트리트 총 벳
    let recordedAmount = 0;

    switch (action.type) {
      case 'fold':
        player.status = 'folded';
        break;

      case 'check':
        break;

      case 'call': {
        const callAmount = Math.min(this.state.currentBet - player.currentBet, player.chips);
        player.chips -= callAmount;
        player.currentBet += callAmount;
        player.totalContributed += callAmount;
        if (player.chips === 0) player.status = 'all-in';
        recordedAmount = callAmount;
        break;
      }

      case 'raise': {
        // 서버 권위 검증: 금액은 [currentBet + minRaise, chips + currentBet] 범위여야 한다.
        // 언더레이즈는 올인일 때만 합법이며 액션을 재오픈하지 않는다 (표준 룰).
        if (!Number.isFinite(action.amount)) return { valid: false, handComplete: false };
        const raiseTotal = Math.floor(action.amount);
        const maxTotal = player.chips + player.currentBet;
        const minTotal = this.state.currentBet + this.state.minRaise;
        if (raiseTotal <= this.state.currentBet) return { valid: false, handComplete: false };
        if (raiseTotal > maxTotal) return { valid: false, handComplete: false };
        const isAllIn = raiseTotal === maxTotal;
        if (raiseTotal < minTotal && !isAllIn) return { valid: false, handComplete: false };

        const toAdd = raiseTotal - player.currentBet;
        player.chips -= toAdd;
        player.currentBet = raiseTotal;
        player.totalContributed += toAdd;
        recordedAmount = raiseTotal;
        const isFullRaise = raiseTotal >= minTotal;
        if (isFullRaise) this.state.minRaise = raiseTotal - this.state.currentBet;
        this.state.currentBet = raiseTotal;
        this.state.lastAggressorId = player.id;
        if (player.chips === 0) player.status = 'all-in';
        if (isFullRaise) {
          for (const p of this.state.players) {
            if (p.id !== player.id && p.status === 'active') {
              p.hasActed = false;
            }
          }
        }
        break;
      }

      case 'all-in': {
        const allInAmount = player.chips;
        const totalBet = player.currentBet + allInAmount;
        if (totalBet > this.state.currentBet) {
          const isFullRaise = totalBet >= this.state.currentBet + this.state.minRaise;
          if (isFullRaise) {
            this.state.minRaise = totalBet - this.state.currentBet;
            for (const p of this.state.players) {
              if (p.id !== player.id && p.status === 'active') {
                p.hasActed = false;
              }
            }
          }
          this.state.currentBet = totalBet;
          this.state.lastAggressorId = player.id;
        }
        player.currentBet = totalBet;
        player.totalContributed += allInAmount;
        player.chips = 0;
        player.status = 'all-in';
        recordedAmount = totalBet;
        break;
      }
    }

    this.handRecordDraft?.actions.push({
      street: this.state.street,
      playerId: player.id,
      kind: action.type,
      amount: recordedAmount,
    });

    player.hasActed = true;
    this.state.lastAction = action;
    this.state.actionSeq++;
    this.rebuildPots();

    const { handComplete } = this.advanceAfterAction(true);
    return { valid: true, handComplete };
  }

  /**
   * 액션(또는 이탈 폴드) 이후 공통 진행 로직:
   * 단독 생존 체크 → 베팅 라운드 완료 체크 → 턴 이동.
   * moveTurn=false면 턴 포인터를 옮기지 않는다 (현재 액터가 아닌 플레이어의 이탈 처리용).
   */
  private advanceAfterAction(moveTurn: boolean): { handComplete: boolean } {
    // Check if only one player remains (everyone else folded)
    const remaining = this.getActivePlayers();
    if (remaining.length <= 1) {
      this.endHand();
      return { handComplete: true };
    }

    // Check if betting round is complete
    if (this.isBettingRoundComplete()) {
      const handComplete = this.advanceStreet();
      return { handComplete };
    }

    // Move to next player
    if (moveTurn) {
      this.state.activePlayerIndex = this.getNextActiveIndex(this.state.activePlayerIndex);
    }
    return { handComplete: false };
  }

  getValidActions(player: Player): ActionType[] {
    return computeValidActions(this.state, player);
  }

  getCallAmount(player: Player): number {
    return Math.min(this.state.currentBet - player.currentBet, player.chips);
  }

  getMinRaiseAmount(): number {
    return this.state.currentBet + this.state.minRaise;
  }

  private isBettingRoundComplete(): boolean {
    const acting = this.getActingPlayers();
    if (acting.length === 0) return true;
    if (acting.length === 1 && acting[0].currentBet >= this.state.currentBet) return true;
    return acting.every(p => p.hasActed && p.currentBet === this.state.currentBet);
  }

  /**
   * 팟 재유도: 플레이어별 핸드 누적 기여금(totalContributed)에서 팟 계층 전체를 매번 다시 계산한다.
   * 스트리트 경계(currentBet 리셋)와 무관하므로 멀티 스트리트 사이드팟 금액 소실이 구조적으로 불가능.
   * 폴드한 플레이어의 기여금(dead money)도 자동 포함된다.
   * 팟 계층은 표준 룰대로 "올인 금액"에서만 분할한다 (올인이 없으면 항상 단일 팟).
   * 불변식: sum(pots.amount) === sum(players.totalContributed)
   */
  private rebuildPots(): void {
    const contributors = this.state.players.filter(p => p.totalContributed > 0);
    const contenders = this.state.players.filter(
      p => (p.status === 'active' || p.status === 'all-in') && p.totalContributed > 0
    );
    const total = contributors.reduce((s, p) => s + p.totalContributed, 0);

    if (total === 0 || contenders.length === 0) {
      this.state.pots = [{ amount: total, eligiblePlayerIds: contenders.map(p => p.id) }];
      return;
    }

    // 올인 컨텐더의 기여 레벨에서만 팟을 자른다 + 상위 전체를 담는 마지막 계층
    const allInLevels = [
      ...new Set(contenders.filter(p => p.status === 'all-in').map(p => p.totalContributed)),
    ].sort((a, b) => a - b);
    const levels: number[] = [...allInLevels, Infinity];

    const pots: Pot[] = [];
    let prev = 0;
    for (const level of levels) {
      const amount = contributors.reduce(
        (s, p) => s + Math.max(0, Math.min(p.totalContributed, level) - prev), 0);
      if (amount <= 0) {
        prev = level;
        continue;
      }
      const eligible = contenders.filter(p =>
        level === Infinity ? p.totalContributed > prev || allInLevels.length === 0 : p.totalContributed >= level,
      );
      if (eligible.length === 0 && pots.length > 0) {
        // 자격자 없는 잔여분(예: 올인 캡 초과 dead money)은 직전 팟에 귀속
        pots[pots.length - 1].amount += amount;
      } else {
        pots.push({
          amount,
          eligiblePlayerIds: (eligible.length > 0 ? eligible : contenders).map(p => p.id),
        });
      }
      prev = level;
    }

    this.state.pots = pots;
  }

  private advanceStreet(): boolean {
    // Reset for new street
    for (const player of this.state.players) {
      player.currentBet = 0;
      player.hasActed = false;
    }
    this.state.currentBet = 0;
    this.state.minRaise = this.config.bigBlind;

    const activePlayers = this.getActivePlayers();
    const actingPlayers = this.getActingPlayers();

    // 응수 가능한 플레이어가 1명 이하(전원 올인 등)인데 컨텐더는 남아 있으면 단계별 런아웃 모드.
    // 여기서 즉시 보드를 다 깔지 않는다 — 핸드를 먼저 공개(getPublicState revealed)하고,
    // RoomManager가 dealRunoutStreet()를 시간차로 호출해 플랍→턴→리버를 순차 공개한다.
    // (리버 베팅까지 끝난 뒤라면 남은 카드가 없으므로 곧장 쇼다운으로 간다)
    if (actingPlayers.length <= 1 && activePlayers.length > 1 && this.state.street !== 'river') {
      this.state.allInRunout = true;
      this.state.activePlayerIndex = -1;
      return false;
    }

    switch (this.state.street) {
      case 'preflop':
        this.state.street = 'flop';
        this.state.communityCards.push(...this.deck.deal(3));
        break;
      case 'flop':
        this.state.street = 'turn';
        this.state.communityCards.push(...this.deck.deal(1));
        break;
      case 'turn':
        this.state.street = 'river';
        this.state.communityCards.push(...this.deck.deal(1));
        break;
      case 'river':
        this.state.street = 'showdown';
        this.endHand();
        return true;
    }

    // Set first actor for new street
    this.setFirstActor();
    return false;
  }

  /**
   * 단계별 올인 런아웃 — 다음 스트리트를 한 번씩 깐다 (RoomManager 타이머가 시간차로 호출).
   * 리버까지 깔린 뒤 호출되면 쇼다운 정산까지 진행하고 true(핸드 종료)를 반환한다.
   */
  dealRunoutStreet(): boolean {
    if (!this.state.allInRunout || !this.state.isHandInProgress) {
      return !this.state.isHandInProgress;
    }
    switch (this.state.street) {
      case 'preflop':
        this.state.street = 'flop';
        this.state.communityCards.push(...this.deck.deal(3));
        return false;
      case 'flop':
        this.state.street = 'turn';
        this.state.communityCards.push(...this.deck.deal(1));
        return false;
      case 'turn':
        this.state.street = 'river';
        this.state.communityCards.push(...this.deck.deal(1));
        return false;
      default:
        this.endHand();
        return true;
    }
  }

  private endHand(): void {
    this.state.street = 'showdown';
    this.state.isHandInProgress = false;
    this.state.allInRunout = false;

    const activePlayers = this.getActivePlayers();
    const payoutPots = this.preparePayoutPots();

    // If only one player remains (everyone else folded)
    if (activePlayers.length === 1) {
      const winner = activePlayers[0];
      const totalPot = this.sumSettlementAmounts(
        payoutPots.map(pot => pot.amount),
        'fold payout pots',
      );
      winner.chips += totalPot;
      this.state.winners = [{
        playerId: winner.id,
        amount: totalPot,
        hand: null,
        potIndex: 0,
      }];
      this.assertSettlementInvariant(payoutPots);
      this.finalizeTournamentHand();
      this.finalizeHandRecord();
      return;
    }

    // Showdown: evaluate hands
    const winners: WinResult[] = [];
    for (let potIndex = 0; potIndex < payoutPots.length; potIndex++) {
      const pot = payoutPots[potIndex];
      const eligible = activePlayers.filter(p => pot.eligiblePlayerIds.includes(p.id));

      if (eligible.length === 0) continue;

      const evaluated = eligible.map(p => ({
        player: p,
        hand: evaluateHand(p.holeCards, this.state.communityCards),
      }));

      evaluated.sort((a, b) => compareHands(b.hand, a.hand));
      const bestValue = evaluated[0].hand.value;
      const potWinners = evaluated.filter(e => e.hand.value === bestValue);
      const share = Math.floor(pot.amount / potWinners.length);

      for (const w of potWinners) {
        w.player.chips += share;
        winners.push({
          playerId: w.player.id,
          amount: share,
          hand: w.hand,
          potIndex,
        });
      }

      // Handle remainder (odd chips go to first position)
      const remainder = pot.amount - share * potWinners.length;
      if (remainder > 0) {
        potWinners[0].player.chips += remainder;
        winners[winners.length - potWinners.length].amount += remainder;
      }
    }

    this.state.winners = winners;
    this.assertSettlementInvariant(payoutPots);
    this.finalizeTournamentHand();
    this.finalizeHandRecord();
  }

  /** 핸드 히스토리 초안 개시 — startHand에서 딜러 확정 직후·블라인드 포스팅 직전에 호출 */
  private beginHandRecord(): void {
    const n = this.state.players.length;
    const dealtIn: Player[] = [];
    for (let k = 0; k < n; k++) {
      const p = this.state.players[(this.state.dealerIndex + k) % n];
      if (p.status === 'active') dealtIn.push(p);
    }
    const labels = positionLabels(dealtIn.length);
    this.handRecordDraft = {
      handNumber: this.state.handNumber,
      smallBlind: this.config.smallBlind,
      bigBlind: this.config.bigBlind,
      actions: [],
      participantIds: new Set(dealtIn.map(p => p.id)),
      positions: new Map(dealtIn.map((p, i) => [p.id, labels[i] ?? ''])),
    };
  }

  /**
   * endHand 마지막에 호출 — 초안을 CompletedHandRecord로 완성한다.
   * revealed 판정은 getPublicState와 같은 계약(경합 쇼다운 생존자만)이어야 한다 —
   * 어긋나면 게임에선 머킹된 패가 히스토리에 노출된다.
   */
  private finalizeHandRecord(): void {
    const draft = this.handRecordDraft;
    if (!draft) return;
    this.handRecordDraft = null;

    const survivors = this.state.players.filter(
      p => p.status === 'active' || p.status === 'all-in',
    );
    const showdown = survivors.length >= 2;
    const winners = this.state.winners ?? [];
    const wonBy = new Map<string, number>();
    for (const w of winners) {
      wonBy.set(w.playerId, (wonBy.get(w.playerId) ?? 0) + w.amount);
    }

    const players = this.state.players
      .filter(p => draft.participantIds.has(p.id))
      .map(p => {
        const revealed = showdown && (p.status === 'active' || p.status === 'all-in');
        const evaluated =
          revealed && p.holeCards.length === 2 && this.state.communityCards.length === 5
            ? evaluateHand(p.holeCards, this.state.communityCards)
            : null;
        const won = wonBy.get(p.id) ?? 0;
        return {
          id: p.id,
          name: p.name,
          type: p.type,
          seatIndex: p.seatIndex,
          position: draft.positions.get(p.id) ?? '',
          startingChips: p.handStartChips ?? 0,
          holeCards: p.holeCards.map(c => ({ ...c })),
          totalContributed: p.totalContributed,
          won,
          profit: won - p.totalContributed,
          revealed,
          finalStatus: p.status,
          handRank: evaluated?.rank ?? null,
          handDescription: evaluated?.description ?? null,
        };
      });

    this.completedHandRecord = {
      handNumber: draft.handNumber,
      smallBlind: draft.smallBlind,
      bigBlind: draft.bigBlind,
      players,
      actions: draft.actions,
      board: this.state.communityCards.map(c => ({ ...c })),
      winners: winners.map(w => ({
        playerId: w.playerId,
        amount: w.amount,
        handRank: w.hand?.rank ?? null,
        handDescription: w.hand?.description ?? null,
        potIndex: w.potIndex,
      })),
      potTotal: this.state.players.reduce((s, p) => s + p.totalContributed, 0),
      rake: this.state.handRake,
      showdown,
    };
  }

  /** 마지막으로 완료된 핸드의 전체 기록 (마스킹 전 — 저장 계층 전용, 브로드캐스트 금지) */
  getCompletedHandRecord(): CompletedHandRecord | null {
    return this.completedHandRecord;
  }

  private preparePayoutPots(): Pot[] {
    const grossTotal = this.sumSettlementAmounts(
      this.state.pots.map(pot => pot.amount),
      'gross pots',
    );
    let rake = 0;
    let allocations: number[];

    try {
      if (this.config.gameMode === 'cash' && this.config.economyMode === 'wallet') {
        rake = computeCashRake({
          totalPot: grossTotal,
          bigBlind: this.state.bigBlind,
          flopDealt: this.state.communityCards.length >= 3,
          // 정산 시점마다 현재 레이크 정책을 읽는다 — 핫 컨피그가 다음 핸드부터 반영
          ...this.runtimeHooks.rakePolicy?.(),
        });
      }
      allocations = allocateRakeAcrossPots(
        this.state.pots.map(pot => pot.amount),
        rake,
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'invalid rake calculation';
      throw new Error(`settlement invariant failed: ${detail}`);
    }

    const payoutPots = this.state.pots.map((pot, index) => ({
      amount: pot.amount - allocations[index],
      eligiblePlayerIds: [...pot.eligiblePlayerIds],
    }));
    this.sumSettlementAmounts(
      payoutPots.map(pot => pot.amount),
      'net payout pots',
    );
    this.state.handRake = rake;
    return payoutPots;
  }

  private sumSettlementAmounts(amounts: readonly number[], label: string): number {
    let total = 0;
    for (const amount of amounts) {
      if (!Number.isSafeInteger(amount) || amount < 0) {
        throw new Error(`settlement invariant failed: ${label} contains invalid chip amount`);
      }
      total += amount;
      if (!Number.isSafeInteger(total)) {
        throw new Error(`settlement invariant failed: ${label} total is unsafe`);
      }
    }
    return total;
  }

  private assertSettlementInvariant(payoutPots: readonly Pot[]): void {
    const contributed = this.sumSettlementAmounts(
      this.state.players.map(player => player.totalContributed),
      'contributions',
    );
    const gross = this.sumSettlementAmounts(
      this.state.pots.map(pot => pot.amount),
      'gross pots',
    );
    const netPayout = this.sumSettlementAmounts(
      payoutPots.map(pot => pot.amount),
      'net payout pots',
    );
    const paid = this.sumSettlementAmounts(
      (this.state.winners ?? []).map(winner => winner.amount),
      'winner payouts',
    );
    const grossFromNet = this.sumSettlementAmounts(
      [netPayout, this.state.handRake],
      'net payout plus rake',
    );
    const settled = this.sumSettlementAmounts(
      [paid, this.state.handRake],
      'paid plus rake',
    );

    if (gross !== contributed) {
      throw new Error(
        `settlement invariant failed: gross pots ${gross} !== contributed ${contributed}`,
      );
    }
    if (grossFromNet !== gross) {
      throw new Error(
        `settlement invariant failed: net payout ${netPayout} + rake ${this.state.handRake} !== gross pots ${gross}`,
      );
    }
    if (settled !== contributed) {
      throw new Error(
        `settlement invariant failed: paid ${paid} + rake ${this.state.handRake} !== contributed ${contributed}`,
      );
    }
  }

  /** 핸드 종료 후 시트앤고 탈락/종료 판정 */
  private finalizeTournamentHand(): void {
    if (!this.state.tournament || this.state.tournament.finished) return;
    this.assignFinishPlaces();
    this.checkTournamentEnd();
  }

  getPublicState(forPlayerId?: string): GameState {
    // 쇼다운 '경합'(생존자 2인 이상)일 때만 공개 대상이다. endHand는 전원 폴드 승리에도
    // street='showdown'을 세팅하므로 생존자 수로 실제 쇼다운 여부를 구분해야 한다 —
    // 안 그러면 상대가 다 폴드했는데 승자 홀카드가 노출된다 (표준 룰: 쇼다운 없으면 머킹).
    const survivors = this.state.players.filter(
      p => p.status === 'active' || p.status === 'all-in',
    ).length;
    const showdownContested = this.state.street === 'showdown' && survivors >= 2;
    return {
      ...this.state,
      players: this.state.players.map(p => {
        // 쇼다운 경합 생존자(active/all-in)만 공개. 폴드한 플레이어·폴드 승자는 머킹(비공개).
        // 올인 런아웃 중에는 표준 룰대로 남은 핸드를 미리 공개한다 (베팅이 이미 닫혔으므로 안전).
        const revealed =
          (showdownContested || !!this.state.allInRunout) &&
          (p.status === 'active' || p.status === 'all-in');
        return {
          ...p,
          revealed,
          holeCards: p.id === forPlayerId || revealed
            ? p.holeCards
            : p.holeCards.map(() => ({ suit: 'spades', rank: '2' } as Card)), // hidden cards
        };
      }),
    };
  }
}
