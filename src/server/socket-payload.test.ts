import { describe, expect, it } from 'vitest';
import {
  parseCreateRoomRequest,
  parseJoinRoomRequest,
  parseLeaveRoomRequest,
  parsePlayerActionRequest,
} from './socket-payload';

describe('Socket.IO payload runtime parsing', () => {
  it.each([null, undefined, [], 'bad', 17])('join-room 객체가 아니면 거절한다: %j', input => {
    expect(parseJoinRoomRequest(input).ok).toBe(false);
  });

  it('join-room 공개 필드만 정리하고 통과시킨다', () => {
    expect(parseJoinRoomRequest({
      roomId: ' room-1 ',
      buyIn: 2000,
      seatIndex: 2,
      password: 'pw',
    })).toEqual({
      ok: true,
      value: {
        roomId: 'room-1',
        buyIn: 2000,
        seatIndex: 2,
        password: 'pw',
      },
    });
  });

  it.each([
    { playerName: '위조 이름' },
    { avatar: 'ara' },
    { extra: true },
  ])('join-room 허용 목록 밖의 필드를 거절한다: %j', extra => {
    expect(parseJoinRoomRequest({
      roomId: 'room-1',
      buyIn: 2000,
      seatIndex: 0,
      ...extra,
    }).ok).toBe(false);
  });

  it.each([NaN, Infinity, -Infinity])('join-room 비유한 buyIn을 거절한다: %s', buyIn => {
    expect(parseJoinRoomRequest({
      roomId: 'room-1', buyIn, seatIndex: 0,
    }).ok).toBe(false);
  });

  it('외부 roomId는 100자를 넘으면 잘라 쓰지 않고 거절한다', () => {
    expect(parseJoinRoomRequest({
      roomId: 'r'.repeat(101),
      buyIn: 2000,
      seatIndex: 0,
    }).ok).toBe(false);
  });

  it('player-action은 방과 상태 버전을 반드시 요구한다', () => {
    expect(parsePlayerActionRequest({ roomId: 'room-1', action: 'check' }).ok).toBe(false);
    expect(parsePlayerActionRequest({
      roomId: 'room-1',
      action: 'raise',
      amount: 120,
      expectedHandNumber: 3,
      expectedActionSeq: 9,
    })).toEqual({
      ok: true,
      value: {
        roomId: 'room-1',
        action: 'raise',
        amount: 120,
        expectedHandNumber: 3,
        expectedActionSeq: 9,
      },
    });
  });

  it('create-room은 제어문자를 지우고 허용 enum만 받는다', () => {
    expect(parseCreateRoomRequest({
      name: '\n 테스트 방 ',
      bigBlind: 50,
      turnTime: 8,
      gameMode: 'cash',
      difficulty: 'hard',
      tableType: 'humans',
      botCount: 0,
      password: '1234',
    })).toEqual({
      ok: true,
      value: {
        name: '테스트 방',
        bigBlind: 50,
        turnTime: 8,
        gameMode: 'cash',
        difficulty: 'hard',
        tableType: 'humans',
        botCount: 0,
        economyMode: 'wallet', // 미지정 시 기본 wallet
        password: '1234',
      },
    });
    expect(parseCreateRoomRequest({ name: {}, bigBlind: Infinity }).ok).toBe(false);
  });

  it('create-room economyMode는 wallet/practice만 허용하고 기본은 wallet이다', () => {
    const base = { name: '연습 SnG', gameMode: 'sng' };
    const practice = parseCreateRoomRequest({ ...base, economyMode: 'practice' });
    expect(practice.ok).toBe(true);
    if (practice.ok) expect(practice.value.economyMode).toBe('practice');

    const defaulted = parseCreateRoomRequest(base);
    expect(defaulted.ok).toBe(true);
    if (defaulted.ok) expect(defaulted.value.economyMode).toBe('wallet');

    // arena 등 다른 economyMode는 클라이언트가 지정할 수 없다
    expect(parseCreateRoomRequest({ ...base, economyMode: 'arena' }).ok).toBe(false);
    expect(parseCreateRoomRequest({ ...base, economyMode: 1 }).ok).toBe(false);
  });

  it('leave-room은 payload 생략과 두 모드만 허용한다', () => {
    expect(parseLeaveRoomRequest(undefined)).toEqual({ ok: true, value: { mode: 'exit' } });
    expect(parseLeaveRoomRequest({ mode: 'sitout' })).toEqual({ ok: true, value: { mode: 'sitout' } });
    expect(parseLeaveRoomRequest({ mode: 'erase-everything' }).ok).toBe(false);
  });
});
