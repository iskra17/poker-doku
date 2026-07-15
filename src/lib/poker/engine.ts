import { Deck } from './deck';
import { evaluateHand, compareHands } from './evaluator';
import {
  GameState, Player, PlayerAction, ActionType,
  Pot, WinResult, Card, RoomConfig,
} from './types';
import { SNG_PRIZE_SPLIT } from './blind-schedule';

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

export class PokerEngine {
  private deck: Deck;
  private config: RoomConfig;
  state: GameState;

  constructor(config: RoomConfig, roomId: string, deck: Deck = new Deck()) {
    this.deck = deck;
    this.config = config;
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
    const pool = this.state.players.reduce((sum, p) => sum + p.chips, 0);
    t.prizes = SNG_PRIZE_SPLIT.map(ratio => Math.round(pool * ratio));
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
    this.state.players.push(player);
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
      } else {
        if (idx <= this.state.dealerIndex) {
          this.state.dealerIndex = Math.max(0, this.state.dealerIndex - 1);
        }
        this.state.dealerIndex %= this.state.players.length;
      }
      return { player, handComplete: false };
    }

    player.pendingRemoval = true;
    const wasInHand = player.status === 'active' || player.status === 'all-in';
    const wasTheirTurn = this.state.players[this.state.activePlayerIndex]?.id === playerId;
    if (!wasInHand) return { player, handComplete: false };

    // 올인 이탈자도 폴드 처리 — 기여금은 dead money로 rebuildPots가 팟에 남긴다
    player.status = 'folded';
    this.rebuildPots();
    const { handComplete } = this.advanceAfterAction(wasTheirTurn);
    return { player, handComplete };
  }

  /** 제거 예약된 플레이어를 일괄 splice (핸드 시작 전에만 호출). dealerIndex 보정 포함 */
  removePendingPlayers(): void {
    for (let i = this.state.players.length - 1; i >= 0; i--) {
      if (!this.state.players[i].pendingRemoval) continue;
      this.state.players.splice(i, 1);
      if (i <= this.state.dealerIndex) {
        this.state.dealerIndex = Math.max(0, this.state.dealerIndex - 1);
      }
    }
    if (this.state.players.length > 0) {
      this.state.dealerIndex %= this.state.players.length;
    } else {
      this.state.dealerIndex = 0;
    }
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
    this.state.lastAction = null;
    this.state.lastAggressorId = null;

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
      this.postBlind(sbPlayer, this.config.smallBlind);
      this.postBlind(bbPlayer, this.config.bigBlind);
    } else {
      const sbIdx = this.getNextActiveIndex(dealerPos);
      const bbIdx = this.getNextActiveIndex(sbIdx);
      this.postBlind(this.state.players[sbIdx], this.config.smallBlind);
      this.postBlind(this.state.players[bbIdx], this.config.bigBlind);
    }

    this.state.currentBet = this.config.bigBlind;
    this.rebuildPots();
  }

  private postBlind(player: Player, amount: number): void {
    const actual = Math.min(amount, player.chips);
    player.chips -= actual;
    player.currentBet = actual;
    player.totalContributed += actual;
    if (player.chips === 0) {
      player.status = 'all-in';
    }
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
        break;
      }
    }

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

    // If only one (or zero) player can act, run out remaining streets
    if (actingPlayers.length <= 1 && activePlayers.length > 1) {
      // All players are all-in or only one can act - run out board
      return this.advanceStreet();
    }

    // Set first actor for new street
    this.setFirstActor();
    return false;
  }

  private endHand(): void {
    this.state.street = 'showdown';
    this.state.isHandInProgress = false;

    const activePlayers = this.getActivePlayers();

    // If only one player remains (everyone else folded)
    if (activePlayers.length === 1) {
      const winner = activePlayers[0];
      const totalPot = this.state.pots.reduce((sum, p) => sum + p.amount, 0);
      winner.chips += totalPot;
      this.state.winners = [{
        playerId: winner.id,
        amount: totalPot,
        hand: null,
        potIndex: 0,
      }];
      this.finalizeTournamentHand();
      return;
    }

    // Showdown: evaluate hands
    const winners: WinResult[] = [];
    for (let potIndex = 0; potIndex < this.state.pots.length; potIndex++) {
      const pot = this.state.pots[potIndex];
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
    this.finalizeTournamentHand();
  }

  /** 핸드 종료 후 시트앤고 탈락/종료 판정 */
  private finalizeTournamentHand(): void {
    if (!this.state.tournament || this.state.tournament.finished) return;
    this.assignFinishPlaces();
    this.checkTournamentEnd();
  }

  getPublicState(forPlayerId?: string): GameState {
    return {
      ...this.state,
      players: this.state.players.map(p => {
        // 쇼다운 생존자(active/all-in)만 공개. 폴드한 플레이어는 머킹(비공개)
        const revealed =
          this.state.street === 'showdown' &&
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
