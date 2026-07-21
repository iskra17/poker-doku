import { describe, it, expect } from 'vitest';
import { PokerEngine } from './engine';
import { makePlayer, act, actor } from './test-helpers';
import { RoomConfig, Player } from './types';

/**
 * 딜러 버튼 이동 순서 + SB/BB 위치 QA (2026-07-21 유저 피드백 "버튼/블라인드 찐빠").
 *
 * 계약:
 * - players 배열은 항상 seatIndex 오름차순 — 버튼/블라인드/액션 순서가 배열 순서로 돌기
 *   때문에, 배열이 입장 순서로 어긋나면 버튼이 테이블을 시계방향으로 돌지 않는다.
 * - 버튼 이동은 "무빙 버튼" 룰: 다음 핸드 버튼 = 좌석 순서상 다음 딜인 좌석.
 *   이탈/자리비움 좌석은 건너뛴다 (버튼 좌석 본인이 떠나면 떠난 좌석의 다음 좌석).
 * - 헤즈업은 버튼이 SB, 상대가 BB.
 */

const CONFIG: RoomConfig = {
  name: 'btn-test', smallBlind: 10, bigBlind: 20,
  minBuyIn: 100, maxBuyIn: 10000, maxPlayers: 6, turnTime: 30,
};

function makeEngine(seats: Array<[id: string, seatIndex: number]>): PokerEngine {
  const engine = new PokerEngine(CONFIG, 'btn-room');
  for (const [id, seatIndex] of seats) {
    expect(engine.addPlayer(makePlayer(id, 1000, seatIndex))).toBe(true);
  }
  return engine;
}

/** 현재 버튼 플레이어 */
function btn(engine: PokerEngine): Player {
  return engine.state.players[engine.state.dealerIndex];
}

/** 핸드 시작 직후의 SB/BB 플레이어 (포스팅 금액으로 식별 — 풀스택 전제) */
function blinds(engine: PokerEngine): { sb: Player; bb: Player } {
  const sb = engine.state.players.find(p => p.currentBet === CONFIG.smallBlind);
  const bb = engine.state.players.find(p => p.currentBet === CONFIG.bigBlind);
  expect(sb, 'SB 포스팅 좌석이 있어야 한다').toBeDefined();
  expect(bb, 'BB 포스팅 좌석이 있어야 한다').toBeDefined();
  return { sb: sb!, bb: bb! };
}

/** 폴드로 핸드를 즉시 종료 (마지막 생존자 1명이 남을 때까지) */
function foldOut(engine: PokerEngine): void {
  let guard = 0;
  while (engine.state.isHandInProgress && guard++ < 20) {
    act(engine, 'fold');
  }
  expect(engine.state.isHandInProgress).toBe(false);
}

describe('버튼 궤도 — 좌석 순서 유지', () => {
  it('players 배열은 입장 순서와 무관하게 seatIndex 오름차순으로 유지된다', () => {
    const engine = makeEngine([['a', 3], ['b', 0], ['c', 5], ['d', 1]]);
    expect(engine.state.players.map(p => p.seatIndex)).toEqual([0, 1, 3, 5]);
  });

  it('좌석을 건너뛰며 입장해도 버튼은 좌석 오름차순(시계방향)으로 돈다', () => {
    const engine = makeEngine([['a', 3], ['b', 0], ['c', 5]]);
    // 버튼 기준점을 좌석 5(c)로 — 첫 핸드 버튼은 다음 좌석인 0(b)
    engine.state.dealerIndex = engine.state.players.findIndex(p => p.id === 'c');

    const orbit: number[] = [];
    for (let i = 0; i < 4; i++) {
      engine.startHand();
      orbit.push(btn(engine).seatIndex);
      foldOut(engine);
    }
    expect(orbit).toEqual([0, 3, 5, 0]);
  });

  it('3인 핸드의 SB/BB는 버튼 다음 좌석 순서를 따른다', () => {
    const engine = makeEngine([['a', 1], ['b', 2], ['c', 4]]);
    engine.state.dealerIndex = 2; // 좌석4(c) → 첫 핸드 버튼 좌석1(a)
    engine.startHand();

    expect(btn(engine).id).toBe('a');
    const { sb, bb } = blinds(engine);
    expect(sb.id).toBe('b'); // 좌석2
    expect(bb.id).toBe('c'); // 좌석4
    // UTG(3인에선 버튼)가 첫 액터
    expect(actor(engine).id).toBe('a');
  });

  it('중간 좌석(봇 양보석)에 새 플레이어가 앉아도 궤도가 어긋나지 않는다', () => {
    const engine = makeEngine([['a', 0], ['b', 1], ['c', 2]]);
    engine.state.dealerIndex = 2;
    engine.startHand(); // 버튼 a(좌석0)
    foldOut(engine);

    // 좌석1의 b가 떠나고 (핸드 사이), 새 플레이어 n이 같은 좌석 1에 앉는다
    engine.processLeave('b');
    expect(engine.addPlayer(makePlayer('n', 1000, 1))).toBe(true);
    expect(engine.state.players.map(p => p.seatIndex)).toEqual([0, 1, 2]);

    engine.startHand();
    // 버튼은 a(좌석0) 다음인 좌석1의 n
    expect(btn(engine).id).toBe('n');
    const { sb, bb } = blinds(engine);
    expect(sb.id).toBe('c');
    expect(bb.id).toBe('a');
  });

  it('핸드 중 입장은 현재 핸드에 영향을 주지 않고, 다음 핸드부터 좌석 순서로 합류한다', () => {
    const engine = makeEngine([['a', 0], ['b', 1], ['c', 2]]);
    engine.state.dealerIndex = 2;
    engine.startHand(); // 버튼 a, SB b, BB c
    const actorBefore = actor(engine).id;

    expect(engine.addPlayer(makePlayer('n', 1000, 4))).toBe(true);
    // 진행 중 핸드의 턴/버튼은 그대로
    expect(actor(engine).id).toBe(actorBefore);
    expect(btn(engine).id).toBe('a');
    foldOut(engine);

    engine.startHand();
    // 배열이 좌석 순서로 재정렬되고, 버튼은 b(좌석1) — n(좌석4)은 BB 위치로 합류
    expect(engine.state.players.map(p => p.seatIndex)).toEqual([0, 1, 2, 4]);
    expect(btn(engine).id).toBe('b');
    const { sb, bb } = blinds(engine);
    expect(sb.id).toBe('c');
    expect(bb.id).toBe('n');
  });
});

describe('버튼 궤도 — 이탈 케이스', () => {
  it('버튼(BTN)이 핸드 사이에 나가면 버튼은 다음 좌석으로 간다 (좌석을 건너뛰지 않는다)', () => {
    const engine = makeEngine([['a', 0], ['b', 1], ['c', 2]]);
    engine.state.dealerIndex = 2;
    engine.startHand(); // 버튼 a
    foldOut(engine);

    engine.processLeave('a'); // 배열 인덱스 0의 버튼이 이탈 — 과거 클램프 버그 지점
    engine.startHand();

    // 남은 2인 헤즈업: 버튼(=SB)은 a의 다음 좌석인 b, BB는 c여야 한다.
    // (버그 시절엔 c가 버튼이 되어 b가 BB를 연속 납부했다)
    expect(btn(engine).id).toBe('b');
    const { sb, bb } = blinds(engine);
    expect(sb.id).toBe('b');
    expect(bb.id).toBe('c');
  });

  it('SB가 핸드 사이에 나가면 다음 핸드는 무빙 버튼 룰로 진행된다', () => {
    const engine = makeEngine([['a', 0], ['b', 1], ['c', 2], ['d', 3]]);
    engine.state.dealerIndex = 3;
    engine.startHand(); // 버튼 a, SB b, BB c, UTG d
    expect(btn(engine).id).toBe('a');
    expect(blinds(engine).sb.id).toBe('b');
    foldOut(engine);

    engine.processLeave('b'); // SB 이탈
    engine.startHand();

    // 무빙 버튼: 버튼은 a 다음의 남은 좌석 c로, SB d, BB a
    expect(btn(engine).id).toBe('c');
    const { sb, bb } = blinds(engine);
    expect(sb.id).toBe('d');
    expect(bb.id).toBe('a');
  });

  it('BB가 핸드 사이에 나가도 버튼은 정상 전진한다', () => {
    const engine = makeEngine([['a', 0], ['b', 1], ['c', 2], ['d', 3]]);
    engine.state.dealerIndex = 3;
    engine.startHand(); // 버튼 a, SB b, BB c
    foldOut(engine);

    engine.processLeave('c'); // BB 이탈
    engine.startHand();

    expect(btn(engine).id).toBe('b');
    const { sb, bb } = blinds(engine);
    expect(sb.id).toBe('d');
    expect(bb.id).toBe('a');
  });

  it('핸드 중 이탈한 버튼(pendingRemoval)은 다음 핸드에서 제거되고 버튼은 다음 좌석으로 간다', () => {
    const engine = makeEngine([['a', 0], ['b', 1], ['c', 2], ['d', 3]]);
    engine.state.dealerIndex = 3;
    engine.startHand(); // 버튼 a
    engine.processLeave('a'); // 핸드 중 이탈 → 폴드 + pendingRemoval
    foldOut(engine);

    engine.startHand();
    expect(engine.state.players.map(p => p.id)).toEqual(['b', 'c', 'd']);
    // 버튼은 a(좌석0)의 다음 좌석인 b
    expect(btn(engine).id).toBe('b');
    const { sb, bb } = blinds(engine);
    expect(sb.id).toBe('c');
    expect(bb.id).toBe('d');
  });

  it('버튼과 SB가 같은 핸드에서 동시 이탈해도 버튼은 떠난 버튼의 다음 남은 좌석으로 간다', () => {
    const engine = makeEngine([['a', 0], ['b', 1], ['c', 2], ['d', 3]]);
    engine.state.dealerIndex = 3;
    engine.startHand(); // 버튼 a, SB b
    engine.processLeave('a');
    engine.processLeave('b');
    foldOut(engine);

    engine.startHand();
    // 남은 c, d 헤즈업 — 버튼은 a 다음의 남은 좌석 c
    expect(btn(engine).id).toBe('c');
    const { sb, bb } = blinds(engine);
    expect(sb.id).toBe('c');
    expect(bb.id).toBe('d');
  });
});

describe('버튼 궤도 — 자리비움/헤즈업', () => {
  it('자리비움 좌석은 버튼과 블라인드에서 건너뛴다', () => {
    const engine = makeEngine([['a', 0], ['b', 1], ['c', 2], ['d', 3]]);
    engine.state.dealerIndex = 3;
    const b = engine.state.players.find(p => p.id === 'b')!;
    b.status = 'sitting-out';
    b.sitOutNext = true;

    engine.startHand();
    // 버튼 a(좌석0), SB는 b(좌석1)를 건너뛴 c, BB d
    expect(btn(engine).id).toBe('a');
    const { sb, bb } = blinds(engine);
    expect(sb.id).toBe('c');
    expect(bb.id).toBe('d');
    expect(b.holeCards).toHaveLength(0); // 딜인 제외
    foldOut(engine);

    // b 복귀 → 다음 핸드부터 정상 합류 (버튼은 a의 다음 좌석인 b로)
    b.status = 'waiting';
    b.sitOutNext = false;
    engine.startHand();
    expect(btn(engine).id).toBe('b');
    expect(blinds(engine).sb.id).toBe('c');
    expect(blinds(engine).bb.id).toBe('d');
  });

  it('헤즈업은 버튼이 SB를 내고 매 핸드 교대한다', () => {
    const engine = makeEngine([['a', 0], ['b', 1]]);
    engine.state.dealerIndex = 1;

    const seq: string[] = [];
    for (let i = 0; i < 4; i++) {
      engine.startHand();
      const { sb, bb } = blinds(engine);
      expect(sb.id).toBe(btn(engine).id); // HU: 버튼 = SB
      seq.push(`${sb.id}/${bb.id}`);
      foldOut(engine);
    }
    expect(seq).toEqual(['a/b', 'b/a', 'a/b', 'b/a']);
  });

  it('3인에서 한 명이 나가 헤즈업이 되면 직전 BB가 새 버튼(SB)이 된다', () => {
    const engine = makeEngine([['a', 0], ['b', 1], ['c', 2]]);
    engine.state.dealerIndex = 2;
    engine.startHand(); // 버튼 a, SB b, BB c
    foldOut(engine);

    engine.processLeave('b'); // SB가 떠남
    engine.startHand();
    // 버튼은 a 다음의 남은 좌석 c — 직전 BB인 c가 SB/버튼, a가 BB (BB 연속 납부 없음)
    expect(btn(engine).id).toBe('c');
    expect(blinds(engine).bb.id).toBe('a');
  });
});

describe('predictNextBigBlindId — 다음 BB 예측', () => {
  function expectPredictionMatches(engine: PokerEngine): void {
    const predicted = engine.predictNextBigBlindId();
    engine.startHand();
    expect(engine.state.isHandInProgress).toBe(true);
    expect(predicted).toBe(blinds(engine).bb.id);
  }

  it('일반 4인 테이블에서 실제 BB 배정과 일치한다', () => {
    const engine = makeEngine([['a', 0], ['b', 1], ['c', 2], ['d', 3]]);
    engine.state.dealerIndex = 3;
    for (let i = 0; i < 4; i++) {
      expectPredictionMatches(engine);
      foldOut(engine);
    }
  });

  it('자리비움/이탈 예약 좌석을 제외하고 예측한다', () => {
    const engine = makeEngine([['a', 0], ['b', 1], ['c', 2], ['d', 3]]);
    engine.state.dealerIndex = 3;
    engine.startHand();
    foldOut(engine);

    // c 자리비움(캐시: 다음 핸드 딜인 제외), d는 핸드 중 이탈로 pendingRemoval
    const c = engine.state.players.find(p => p.id === 'c')!;
    c.sitOutNext = true;
    c.status = 'sitting-out';
    const d = engine.state.players.find(p => p.id === 'd')!;
    d.pendingRemoval = true;
    expectPredictionMatches(engine);
  });

  it('헤즈업(딜인 2인)에서는 버튼 아닌 쪽을 BB로 예측한다', () => {
    const engine = makeEngine([['a', 0], ['b', 1]]);
    engine.state.dealerIndex = 1;
    for (let i = 0; i < 3; i++) {
      expectPredictionMatches(engine);
      foldOut(engine);
    }
  });

  it('딜인 가능 좌석이 2인 미만이면 null', () => {
    const engine = makeEngine([['a', 0], ['b', 1]]);
    engine.state.players.find(p => p.id === 'b')!.sitOutNext = true;
    expect(engine.predictNextBigBlindId()).toBeNull();
  });

  it('파산(0칩) 좌석은 예측에서 제외된다', () => {
    const engine = makeEngine([['a', 0], ['b', 1], ['c', 2]]);
    engine.state.dealerIndex = 2;
    engine.startHand();
    foldOut(engine);
    engine.state.players.find(p => p.id === 'b')!.chips = 0;
    expectPredictionMatches(engine);
  });
});
