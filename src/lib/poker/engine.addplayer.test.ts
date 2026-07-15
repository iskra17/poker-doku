import { describe, it, expect } from 'vitest';
import { PokerEngine } from './engine';
import { makePlayer } from './test-helpers';
import { RoomConfig } from './types';

/**
 * addPlayer 방어 — 같은 id가 두 좌석을 잡으면 팟 회계(totalContributed 합산)와 턴 순서가 깨진다.
 * join-room의 멱등 경로가 1차 방어지만, 어떤 경로로 들어와도 엔진에서 막는다.
 */

const CONFIG: RoomConfig = {
  name: 'test', smallBlind: 10, bigBlind: 20,
  minBuyIn: 800, maxBuyIn: 4000, maxPlayers: 6, turnTime: 8,
};

describe('PokerEngine.addPlayer — 좌석/식별자 중복 방어', () => {
  it('같은 playerId가 다른 좌석으로 또 앉으려 하면 거절한다', () => {
    const engine = new PokerEngine(CONFIG, 'room-dup');
    expect(engine.addPlayer(makePlayer('hero', 2000, 0))).toBe(true);
    expect(engine.addPlayer(makePlayer('hero', 2000, 3))).toBe(false);
    expect(engine.state.players).toHaveLength(1);
    expect(engine.state.players[0].seatIndex).toBe(0);
  });

  it('같은 좌석을 다른 사람이 잡으려 하면 거절한다', () => {
    const engine = new PokerEngine(CONFIG, 'room-dup2');
    expect(engine.addPlayer(makePlayer('hero', 2000, 1))).toBe(true);
    expect(engine.addPlayer(makePlayer('villain', 2000, 1))).toBe(false);
    expect(engine.state.players).toHaveLength(1);
  });

  it('다른 사람이 다른 좌석에 앉는 정상 경로는 통과한다', () => {
    const engine = new PokerEngine(CONFIG, 'room-ok');
    expect(engine.addPlayer(makePlayer('hero', 2000, 0))).toBe(true);
    expect(engine.addPlayer(makePlayer('villain', 2000, 1))).toBe(true);
    expect(engine.state.players).toHaveLength(2);
  });

  it('정원(6)을 넘기면 거절한다', () => {
    const engine = new PokerEngine(CONFIG, 'room-full');
    for (let i = 0; i < 6; i++) {
      expect(engine.addPlayer(makePlayer(`p${i}`, 2000, i))).toBe(true);
    }
    expect(engine.addPlayer(makePlayer('late', 2000, 0))).toBe(false);
    expect(engine.state.players).toHaveLength(6);
  });
});
