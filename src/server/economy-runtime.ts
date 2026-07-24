import type { PokerEngine } from '../lib/poker/engine';
import type { Player } from '../lib/poker/types';
import type { PayoutPresetId } from '../lib/poker/payout-table';
import { EconomyDomainError } from './economy-repository';
import { ECONOMY_RULES, type EconomyService } from './economy-service';

export interface CashHandPersistenceResult {
  paidTotal: number;
  rake: number;
}

export interface RoomEconomyHooks {
  beforeHand(roomId: string, engine: PokerEngine): void;
  cancelPreparedHand(roomId: string, engine: PokerEngine): boolean;
  afterHand(roomId: string, engine: PokerEngine): CashHandPersistenceResult;
  settleExit(roomId: string, player: Player): void;
  voidRoom(roomId: string): void;
  beforeTournament(roomId: string, engine: PokerEngine): void;
  cancelTournamentStart(roomId: string, engine: PokerEngine): boolean;
  afterTournament(roomId: string, engine: PokerEngine): void;
  cancelWaitingSng(roomId: string, player: Player): void;
}

export interface CashAdmissionEconomy {
  openCashEscrow(profileId: string, roomId: string, buyIn: number): unknown;
  rebuyCashEscrow(profileId: string, roomId: string, buyIn: number): unknown;
  cancelCashEscrow(profileId: string, roomId: string): unknown;
  hasActiveCashEscrow(profileId: string, roomId: string): boolean;
}

export interface SngAdmissionEconomy {
  reserveSngEntry(
    profileId: string,
    roomId: string,
    buyIn: number,
    fee: number,
  ): unknown;
  cancelSngEntry(profileId: string, roomId: string): unknown;
  hasActiveSngEntry(profileId: string, roomId: string): boolean;
}

/** wallet MTT — 토너 단위 에스크로 (키는 토너먼트 ID, 기본 상품가는 economy-service) */
export interface MttAdmissionEconomy {
  reserveMttEntry(
    profileId: string,
    tournamentId: string,
    maxEntrants: number,
  ): unknown;
  cancelMttEntry(profileId: string, tournamentId: string): unknown;
  startMttTournament(tournamentId: string, profileIds: readonly string[]): string;
  settleMttTournament(
    tournamentId: string,
    results: ReadonlyArray<{ playerId: string; place: number; prize: number }>,
    payoutPreset: PayoutPresetId,
  ): string;
  voidMttTournament(tournamentId: string): number;
}

export class EconomyRuntime implements
  RoomEconomyHooks,
  CashAdmissionEconomy,
  SngAdmissionEconomy,
  MttAdmissionEconomy {
  constructor(private readonly economy: EconomyService) {}

  reserveMttEntry(
    profileId: string,
    tournamentId: string,
    maxEntrants: number,
  ): unknown {
    return this.economy.reserveMttEntry(profileId, tournamentId, maxEntrants);
  }

  cancelMttEntry(profileId: string, tournamentId: string): unknown {
    return this.economy.cancelMttEntry(profileId, tournamentId);
  }

  startMttTournament(tournamentId: string, profileIds: readonly string[]): string {
    return this.economy.startMttTournament(tournamentId, profileIds);
  }

  settleMttTournament(
    tournamentId: string,
    results: ReadonlyArray<{ playerId: string; place: number; prize: number }>,
    payoutPreset: PayoutPresetId,
  ): string {
    return this.economy.settleMttTournament(tournamentId, results, payoutPreset);
  }

  voidMttTournament(tournamentId: string): number {
    return this.economy.voidMttTournament(tournamentId);
  }

  openCashEscrow(profileId: string, roomId: string, buyIn: number): unknown {
    return this.economy.openCashEscrow(profileId, roomId, buyIn);
  }

  rebuyCashEscrow(profileId: string, roomId: string, buyIn: number): unknown {
    return this.economy.rebuyCashEscrow(profileId, roomId, buyIn);
  }

  cancelCashEscrow(profileId: string, roomId: string): unknown {
    return this.economy.cancelCashEscrow(profileId, roomId);
  }

  hasActiveCashEscrow(profileId: string, roomId: string): boolean {
    return this.economy.hasActiveCashEscrow(profileId, roomId);
  }

  reserveSngEntry(
    profileId: string,
    roomId: string,
    buyIn: number,
    fee: number,
  ): unknown {
    return this.economy.reserveSngEntry(profileId, roomId, buyIn, fee);
  }

  cancelSngEntry(profileId: string, roomId: string): unknown {
    return this.economy.cancelSngEntry(profileId, roomId);
  }

  hasActiveSngEntry(profileId: string, roomId: string): boolean {
    return this.economy.hasActiveSngEntry(profileId, roomId);
  }

  beforeTournament(roomId: string, engine: PokerEngine): void {
    const { buyIn, fee } = this.requireWalletSng(engine);
    const tournament = engine.state.tournament;
    const entrants = engine.state.players.filter(player => (
      player.type === 'human' && !player.pendingRemoval
    ));
    if (
      !tournament
      || tournament.entrants !== 0
      || tournament.finished
      || engine.state.isHandInProgress
      || entrants.length !== 6
      || entrants.length !== engine.state.players.length
      || entrants.some(player => player.chips !== buyIn)
    ) {
      throw new EconomyDomainError('SNG_START_INVALID');
    }
    this.economy.startSngTournament(
      roomId,
      entrants.map(player => player.id),
      buyIn,
      fee,
    );
  }

  cancelTournamentStart(roomId: string, engine: PokerEngine): boolean {
    const { buyIn, fee } = this.requireWalletSng(engine);
    if (engine.state.tournament?.entrants !== 0) {
      throw new EconomyDomainError('SNG_START_INVALID');
    }
    const entrants = engine.state.players.filter(player => (
      player.type === 'human' && !player.pendingRemoval
    ));
    return this.economy.revertSngTournamentStart(
      roomId,
      entrants.map(player => player.id),
      buyIn,
      fee,
    );
  }

  afterTournament(roomId: string, engine: PokerEngine): void {
    const { buyIn, fee } = this.requireWalletSng(engine);
    const tournament = engine.state.tournament;
    if (!tournament?.finished || tournament.entrants !== 6) {
      throw new EconomyDomainError('SNG_SETTLEMENT_INVALID');
    }
    this.economy.settleSngTournament(
      roomId,
      tournament.results.map(result => ({
        playerId: result.playerId,
        place: result.place,
        prize: result.prize,
      })),
      buyIn,
      fee,
    );
  }

  cancelWaitingSng(roomId: string, player: Player): void {
    if (player.type !== 'human') return;
    this.economy.cancelSngEntry(player.id, roomId);
  }

  beforeHand(roomId: string, engine: PokerEngine): void {
    if (!this.economy.hasActiveCashEscrows(roomId)) return;
    const nextHandNumber = this.safeAdd(engine.state.handNumber, 1);
    const humans = engine.state.players
      .filter(player => player.type === 'human' && !player.pendingRemoval)
      .map(player => ({ profileId: player.id, amount: player.chips }));
    this.economy.checkpointCashHand(roomId, nextHandNumber, humans);
  }

  cancelPreparedHand(roomId: string, engine: PokerEngine): boolean {
    return this.economy.cancelPreparedCashHand(
      roomId,
      this.safeAdd(engine.state.handNumber, 1),
    );
  }

  afterHand(roomId: string, engine: PokerEngine): CashHandPersistenceResult {
    const paidTotal = this.sum(
      (engine.state.winners ?? []).map(winner => winner.amount),
      'CASH_SETTLEMENT_INVALID',
    );
    const rake = engine.state.handRake;
    if (!this.economy.hasActiveCashEscrows(roomId)) {
      return { paidTotal, rake };
    }
    if (engine.state.isHandInProgress || engine.state.handNumber < 1) {
      throw new EconomyDomainError('CASH_SETTLEMENT_INVALID');
    }

    const humans = engine.state.players
      .filter(player => player.type === 'human' && player.handStartChips !== undefined)
      .map(player => ({
        profileId: player.id,
        startAmount: player.handStartChips!,
        endAmount: player.chips,
      }));
    let botDelta = 0;
    for (const player of engine.state.players) {
      if (player.type !== 'bot' || player.handStartChips === undefined) continue;
      botDelta = this.safeAdd(
        botDelta,
        player.chips - player.handStartChips,
      );
    }
    this.economy.settleCashHand(
      roomId,
      engine.state.handNumber,
      humans,
      botDelta,
      rake,
    );
    return { paidTotal, rake };
  }

  settleExit(roomId: string, player: Player): void {
    if (player.type !== 'human') return;
    this.economy.settleCashExit(player.id, roomId);
  }

  voidRoom(roomId: string): void {
    this.economy.cancelWaitingSngRoom(roomId);
    this.economy.settleCashRoom(roomId);
  }

  recoverActiveEscrows(): number {
    return this.safeAdd(
      this.economy.recoverActiveCashEscrows(),
      this.economy.recoverIncompleteSngEntries(),
    );
  }

  private requireWalletSng(engine: PokerEngine): {
    buyIn: number;
    fee: number;
  } {
    if (!engine.state.tournament) {
      throw new EconomyDomainError('SNG_ENTRY_INVALID');
    }
    return {
      buyIn: ECONOMY_RULES.casualSngBuyIn,
      fee: ECONOMY_RULES.casualSngFee,
    };
  }

  private safeAdd(left: number, right: number): number {
    const value = left + right;
    if (!Number.isSafeInteger(value)) {
      throw new EconomyDomainError('CASH_SETTLEMENT_INVALID');
    }
    return value;
  }

  private sum(
    values: readonly number[],
    code: 'CASH_SETTLEMENT_INVALID',
  ): number {
    let total = 0;
    for (const value of values) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new EconomyDomainError(code);
      }
      total = this.safeAdd(total, value);
    }
    return total;
  }
}
