import type { PokerEngine } from '../lib/poker/engine';
import type { Player } from '../lib/poker/types';
import { EconomyDomainError } from './economy-repository';
import type { EconomyService } from './economy-service';

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
}

export interface CashAdmissionEconomy {
  openCashEscrow(profileId: string, roomId: string, buyIn: number): unknown;
  rebuyCashEscrow(profileId: string, roomId: string, buyIn: number): unknown;
  cancelCashEscrow(profileId: string, roomId: string): unknown;
  hasActiveCashEscrow(profileId: string, roomId: string): boolean;
}

export class EconomyRuntime implements RoomEconomyHooks, CashAdmissionEconomy {
  constructor(private readonly economy: EconomyService) {}

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
    this.economy.settleCashRoom(roomId);
  }

  recoverActiveEscrows(): number {
    return this.economy.recoverActiveCashEscrows();
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
