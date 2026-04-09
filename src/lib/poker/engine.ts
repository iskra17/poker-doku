import { Deck } from './deck';
import { evaluateHand, compareHands } from './evaluator';
import {
  GameState, Player, PlayerAction, ActionType, Street,
  Pot, WinResult, Card, RoomConfig,
} from './types';

export class PokerEngine {
  private deck: Deck = new Deck();
  private config: RoomConfig;
  state: GameState;

  constructor(config: RoomConfig, roomId: string) {
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
    };
  }

  addPlayer(player: Player): boolean {
    if (this.state.players.length >= this.config.maxPlayers) return false;
    if (this.state.players.find(p => p.seatIndex === player.seatIndex)) return false;
    this.state.players.push(player);
    return true;
  }

  removePlayer(playerId: string): Player | null {
    const idx = this.state.players.findIndex(p => p.id === playerId);
    if (idx === -1) return null;
    const [removed] = this.state.players.splice(idx, 1);
    return removed;
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
    if (!this.canStartHand()) return;

    this.deck.reset();
    this.state.isHandInProgress = true;
    this.state.communityCards = [];
    this.state.pots = [{ amount: 0, eligiblePlayerIds: [] }];
    this.state.currentBet = 0;
    this.state.minRaise = this.config.bigBlind;
    this.state.street = 'preflop';
    this.state.winners = null;
    this.state.lastAction = null;

    // Reset players
    for (const player of this.state.players) {
      if (player.chips > 0 && player.status !== 'sitting-out') {
        player.status = 'active';
        player.holeCards = [];
        player.currentBet = 0;
        player.hasActed = false;
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

    // Set eligible players for main pot
    this.state.pots[0].eligiblePlayerIds = activePlayers.map(p => p.id);

    // Set first actor (UTG, left of BB)
    this.setFirstActor();
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
  }

  private postBlind(player: Player, amount: number): void {
    const actual = Math.min(amount, player.chips);
    player.chips -= actual;
    player.currentBet = actual;
    this.state.pots[0].amount += actual;
    if (player.chips === 0) {
      player.status = 'all-in';
    }
  }

  private setFirstActor(): void {
    const active = this.state.players.filter(p => p.status !== 'sitting-out');
    const dealerPos = this.state.dealerIndex;

    if (this.state.street === 'preflop') {
      if (active.length === 2) {
        // Heads-up: dealer (SB) acts first preflop
        this.state.activePlayerIndex = dealerPos;
      } else {
        // UTG: left of BB
        const sbIdx = this.getNextActiveIndex(dealerPos);
        const bbIdx = this.getNextActiveIndex(sbIdx);
        this.state.activePlayerIndex = this.getNextActiveIndex(bbIdx);
      }
    } else {
      // Post-flop: first active player left of dealer
      this.state.activePlayerIndex = this.getNextActiveIndex(dealerPos);
    }
  }

  processAction(action: PlayerAction): { valid: boolean; handComplete: boolean } {
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
        this.state.pots[this.state.pots.length - 1].amount += callAmount;
        if (player.chips === 0) player.status = 'all-in';
        break;
      }

      case 'raise': {
        const raiseTotal = action.amount;
        const toAdd = raiseTotal - player.currentBet;
        if (toAdd > player.chips) return { valid: false, handComplete: false };
        player.chips -= toAdd;
        player.currentBet = raiseTotal;
        this.state.pots[this.state.pots.length - 1].amount += toAdd;
        this.state.minRaise = raiseTotal - this.state.currentBet;
        this.state.currentBet = raiseTotal;
        if (player.chips === 0) player.status = 'all-in';
        // Reset hasActed for other active players
        for (const p of this.state.players) {
          if (p.id !== player.id && p.status === 'active') {
            p.hasActed = false;
          }
        }
        break;
      }

      case 'all-in': {
        const allInAmount = player.chips;
        const totalBet = player.currentBet + allInAmount;
        if (totalBet > this.state.currentBet) {
          this.state.minRaise = Math.max(this.state.minRaise, totalBet - this.state.currentBet);
          this.state.currentBet = totalBet;
          for (const p of this.state.players) {
            if (p.id !== player.id && p.status === 'active') {
              p.hasActed = false;
            }
          }
        }
        player.currentBet = totalBet;
        this.state.pots[this.state.pots.length - 1].amount += allInAmount;
        player.chips = 0;
        player.status = 'all-in';
        break;
      }
    }

    player.hasActed = true;
    this.state.lastAction = action;

    // Check if only one player remains
    const remaining = this.getActivePlayers();
    if (remaining.filter(p => p.status !== 'all-in').length <= 1 && remaining.length <= 1) {
      // Everyone folded or one player left
      this.endHand();
      return { valid: true, handComplete: true };
    }

    // Check if betting round is complete
    if (this.isBettingRoundComplete()) {
      this.calculateSidePots();
      const handComplete = this.advanceStreet();
      return { valid: true, handComplete };
    }

    // Move to next player
    this.state.activePlayerIndex = this.getNextActiveIndex(this.state.activePlayerIndex);
    return { valid: true, handComplete: false };
  }

  getValidActions(player: Player): ActionType[] {
    const actions: ActionType[] = ['fold'];

    if (player.currentBet >= this.state.currentBet) {
      actions.push('check');
    } else {
      actions.push('call');
    }

    const minRaiseAmount = this.state.currentBet + this.state.minRaise;
    if (player.chips + player.currentBet > this.state.currentBet) {
      if (player.chips + player.currentBet >= minRaiseAmount) {
        actions.push('raise');
      }
      actions.push('all-in');
    }

    return actions;
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

  private calculateSidePots(): void {
    const allInPlayers = this.state.players
      .filter(p => p.status === 'all-in' || p.status === 'active')
      .sort((a, b) => a.currentBet - b.currentBet);

    if (allInPlayers.length === 0) return;

    const hasDifferentBets = new Set(allInPlayers.map(p => p.currentBet)).size > 1;
    const hasAllIn = allInPlayers.some(p => p.status === 'all-in');

    if (!hasDifferentBets || !hasAllIn) return;

    // Recalculate pots from scratch
    const pots: Pot[] = [];
    const betLevels = [...new Set(allInPlayers.map(p => p.currentBet))].sort((a, b) => a - b);
    let prevLevel = 0;

    for (const level of betLevels) {
      const diff = level - prevLevel;
      if (diff <= 0) continue;
      const eligible = this.state.players.filter(
        p => (p.status === 'active' || p.status === 'all-in') && p.currentBet >= level
      );
      const foldedContribution = this.state.players
        .filter(p => p.status === 'folded' && p.currentBet > prevLevel)
        .reduce((sum, p) => sum + Math.min(p.currentBet - prevLevel, diff), 0);

      pots.push({
        amount: diff * eligible.length + foldedContribution,
        eligiblePlayerIds: eligible.map(p => p.id),
      });
      prevLevel = level;
    }

    if (pots.length > 0) {
      this.state.pots = pots;
    }
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
  }

  getPublicState(forPlayerId?: string): GameState {
    return {
      ...this.state,
      players: this.state.players.map(p => ({
        ...p,
        holeCards: p.id === forPlayerId || this.state.street === 'showdown'
          ? p.holeCards
          : p.holeCards.map(() => ({ suit: 'spades', rank: '2' } as Card)), // hidden cards
      })),
    };
  }
}
