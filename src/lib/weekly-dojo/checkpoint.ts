import { WEEKLY_DOJO_LINEUP } from './config';

/**
 * 주간 도장 **서버 전용** 경계 스냅샷.
 *
 * 확정된 핸드 경계마다 같은 트랜잭션에서 저장되고, 방을 다시 열 때 테이블 조건을 그대로
 * 되살린다. 이게 없으면 재개할 때마다 봇 5명이 시작 스택으로 리필되고 버튼이 처음으로 돌아가
 * **칩 풀·상대 조건·블라인드 순서가 리셋**된다(= 선택적 리셋 악용).
 *
 * 절대 공개 뷰(`WeeklyDojoView`)나 소켓 이벤트로 내보내지 말 것 — 상대 스택은 테이블 안에서만
 * 보여야 한다.
 */
export interface WeeklyDojoCheckpointSeat {
  readonly seatIndex: number;
  readonly characterId: string;
  readonly chips: number;
}

export interface WeeklyDojoCheckpoint {
  readonly v: 1;
  readonly lineupVersion: string;
  /** 직전 핸드의 버튼 좌석 — 다음 핸드는 여기서부터 한 칸 이동한다 */
  readonly dealerSeatIndex: number;
  readonly heroChips: number;
  readonly seats: readonly WeeklyDojoCheckpointSeat[];
}

const MAX_SEAT_INDEX = 5;
const MAX_CHIPS = 100_000_000;

function isChips(value: unknown): value is number {
  return Number.isSafeInteger(value)
    && (value as number) >= 0
    && (value as number) <= MAX_CHIPS;
}

function isSeatIndex(value: unknown): value is number {
  return Number.isSafeInteger(value)
    && (value as number) >= 0
    && (value as number) <= MAX_SEAT_INDEX;
}

export function serializeWeeklyDojoCheckpoint(
  checkpoint: WeeklyDojoCheckpoint,
): string {
  return JSON.stringify({
    v: 1,
    lineupVersion: checkpoint.lineupVersion,
    dealerSeatIndex: checkpoint.dealerSeatIndex,
    heroChips: checkpoint.heroChips,
    seats: checkpoint.seats.map(seat => ({
      seatIndex: seat.seatIndex,
      characterId: seat.characterId,
      chips: seat.chips,
    })),
  });
}

/**
 * 저장된 스냅샷을 방어적으로 읽는다. 좌석 수·중복·범위 중 하나라도 어긋나면 null —
 * 호출자는 "복원할 수 없는 시도"로 취급해야 하고, 절대 시작 스택으로 리필해선 안 된다.
 */
export function parseWeeklyDojoCheckpoint(
  json: string | null | undefined,
): WeeklyDojoCheckpoint | null {
  if (typeof json !== 'string' || json.length === 0) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (value.v !== 1) return null;
  if (typeof value.lineupVersion !== 'string' || value.lineupVersion.length === 0) return null;
  if (!isSeatIndex(value.dealerSeatIndex)) return null;
  if (!isChips(value.heroChips)) return null;
  if (!Array.isArray(value.seats) || value.seats.length !== WEEKLY_DOJO_LINEUP.length) return null;

  const seats: WeeklyDojoCheckpointSeat[] = [];
  const used = new Set<number>();
  for (const entry of value.seats) {
    if (typeof entry !== 'object' || entry === null) return null;
    const seat = entry as Record<string, unknown>;
    if (!isSeatIndex(seat.seatIndex) || used.has(seat.seatIndex as number)) return null;
    if (typeof seat.characterId !== 'string' || seat.characterId.length === 0) return null;
    if (!isChips(seat.chips)) return null;
    used.add(seat.seatIndex as number);
    seats.push({
      seatIndex: seat.seatIndex as number,
      characterId: seat.characterId,
      chips: seat.chips as number,
    });
  }
  return {
    v: 1,
    lineupVersion: value.lineupVersion,
    dealerSeatIndex: value.dealerSeatIndex as number,
    heroChips: value.heroChips as number,
    seats,
  };
}
