import type { ActionType } from '../lib/poker/types';
import type {
  CreateRoomRequest,
  JoinRoomRequest,
  LeaveRoomRequest,
  PlayerActionRequest,
} from '../lib/realtime/protocol';

export type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

const ACTIONS: readonly ActionType[] = ['fold', 'check', 'call', 'raise', 'all-in'];
const MODES = ['cash', 'sng'] as const;
const DIFFICULTIES = ['easy', 'normal', 'hard'] as const;
const TABLE_TYPES = ['bots', 'mixed', 'humans'] as const;
const CREATE_ECONOMY_MODES = ['wallet', 'practice'] as const;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
const INVALID_MESSAGE = '요청 형식이 올바르지 않아요.';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail<T>(): ParseResult<T> {
  return { ok: false, message: INVALID_MESSAGE };
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(CONTROL_CHARS, '').trim();
  if (!cleaned || cleaned.length > max) return null;
  return cleaned;
}

function optionalText(value: unknown, max: number): string | undefined | null {
  if (value === undefined || value === null || value === '') return undefined;
  return cleanText(value, max);
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function memberOf<T extends string>(value: unknown, values: readonly T[]): value is T {
  return typeof value === 'string' && values.includes(value as T);
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
): boolean {
  return Object.keys(value).every(key => allowed.includes(key));
}

export function parseJoinRoomRequest(input: unknown): ParseResult<JoinRoomRequest> {
  if (
    !isRecord(input)
    || !hasOnlyKeys(input, ['roomId', 'buyIn', 'seatIndex', 'password'])
  ) return fail();
  const roomId = cleanText(input.roomId, 100);
  const buyIn = finiteNumber(input.buyIn);
  const seatIndex = finiteNumber(input.seatIndex);
  const password = optionalText(input.password, 20);
  if (
    !roomId
    || buyIn === null
    || seatIndex === null
    || password === null
  ) return fail();

  return {
    ok: true,
    value: {
      roomId,
      buyIn,
      seatIndex: Math.trunc(seatIndex),
      ...(password ? { password } : {}),
    },
  };
}

export function parsePlayerActionRequest(input: unknown): ParseResult<PlayerActionRequest> {
  if (!isRecord(input)) return fail();
  const roomId = cleanText(input.roomId, 100);
  const amount = input.amount === undefined ? undefined : finiteNumber(input.amount);
  const handNumber = finiteNumber(input.expectedHandNumber);
  const actionSeq = finiteNumber(input.expectedActionSeq);
  if (
    !roomId
    || !memberOf(input.action, ACTIONS)
    || amount === null
    || handNumber === null
    || actionSeq === null
    || !Number.isInteger(handNumber)
    || handNumber < 0
    || !Number.isInteger(actionSeq)
    || actionSeq < 0
  ) return fail();

  return {
    ok: true,
    value: {
      roomId,
      action: input.action,
      expectedHandNumber: handNumber,
      expectedActionSeq: actionSeq,
      ...(amount === undefined ? {} : { amount }),
    },
  };
}

export function parseCreateRoomRequest(input: unknown): ParseResult<CreateRoomRequest> {
  if (!isRecord(input)) return fail();
  const name = cleanText(input.name, 40);
  const bigBlind = input.bigBlind === undefined ? 20 : finiteNumber(input.bigBlind);
  const turnTime = input.turnTime === undefined ? 8 : finiteNumber(input.turnTime);
  const botCount = input.botCount === undefined ? 2 : finiteNumber(input.botCount);
  const gameMode = input.gameMode === undefined ? 'cash' : input.gameMode;
  const difficulty = input.difficulty === undefined ? 'normal' : input.difficulty;
  const tableType = input.tableType === undefined ? 'mixed' : input.tableType;
  const economyMode = input.economyMode === undefined ? 'wallet' : input.economyMode;
  const password = optionalText(input.password, 20);
  if (
    !name
    || bigBlind === null
    || turnTime === null
    || botCount === null
    || password === null
    || !memberOf(gameMode, MODES)
    || !memberOf(difficulty, DIFFICULTIES)
    || !memberOf(tableType, TABLE_TYPES)
    || !memberOf(economyMode, CREATE_ECONOMY_MODES)
  ) return fail();

  return {
    ok: true,
    value: {
      name,
      bigBlind,
      turnTime,
      gameMode,
      difficulty,
      tableType,
      botCount: Math.trunc(botCount),
      economyMode,
      ...(password ? { password } : {}),
    },
  };
}

export function parseLeaveRoomRequest(input: unknown): ParseResult<LeaveRoomRequest> {
  if (input === undefined) return { ok: true, value: { mode: 'exit' } };
  if (!isRecord(input) || (input.mode !== 'exit' && input.mode !== 'sitout')) return fail();
  return { ok: true, value: { mode: input.mode } };
}
