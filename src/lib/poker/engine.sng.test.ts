import { describe, it, expect } from 'vitest';
import { PokerEngine } from './engine';
import { Deck } from './deck';
import { RoomConfig } from './types';
import { RiggedDeck, makePlayer, act, totalStacks, completeRunout } from './test-helpers';

/**
 * 시트앤고 토너먼트 로직 테스트.
 * - 블라인드 레벨 인상이 다음 핸드 포스팅에 반영
 * - 버스트 → 순위(finishPlace) 확정, 동시 탈락은 핸드 시작 스택 순
 * - 1명 남으면 우승 확정 + finished, 상금 풀 배분(50/30/20)
 * - 이탈 = 현재 순위로 탈락 확정
 * - 종료 후 새 핸드 시작 금지
 */

function sngConfig(): RoomConfig {
  return {
    name: 'SNG Test',
    smallBlind: 10,
    bigBlind: 20,
    minBuyIn: 1500,
    maxBuyIn: 1500,
    maxPlayers: 6,
    turnTime: 30,
    gameMode: 'sng',
    startingStack: 1500,
  };
}

function arenaConfig(): RoomConfig {
  return {
    ...sngConfig(),
    name: 'Arena Test',
    economyMode: 'arena',
    competitionMode: 'arena-official',
    arenaMatchId: 'match-a',
    arenaBotVersion: 'arena-v1-hard',
  };
}

function setupSng(chipCounts: number[], riggedCodes?: string) {
  const deck = riggedCodes ? new RiggedDeck(riggedCodes) : new Deck();
  const engine = new PokerEngine(sngConfig(), 'sng-room', deck);
  chipCounts.forEach((chips, i) => {
    engine.addPlayer(makePlayer(`p${i + 1}`, chips, i));
  });
  engine.state.dealerIndex = chipCounts.length - 1; // startHand 후 딜러 = p1
  engine.startTournament(0, 15, 30);
  return { engine, initialTotal: chipCounts.reduce((a, b) => a + b, 0) };
}

function setupArena(chipCounts: number[], riggedCodes?: string) {
  const deck = riggedCodes ? new RiggedDeck(riggedCodes) : new Deck();
  const engine = new PokerEngine(arenaConfig(), 'arena-room', deck);
  chipCounts.forEach((chips, i) => {
    engine.addPlayer(makePlayer(`p${i + 1}`, chips, i));
  });
  engine.state.dealerIndex = chipCounts.length - 1;
  engine.startTournament(0, 15, 30);
  return engine;
}

describe('시트앤고: 토너먼트 초기화', () => {
  it('startTournament가 참가 인원과 상금 풀(50/30/20)을 확정한다', () => {
    const { engine } = setupSng([1500, 1500, 1500]);
    const t = engine.state.tournament!;
    expect(t.entrants).toBe(3);
    expect(t.prizes).toEqual([2250, 1350, 900]); // 4500 × 50/30/20%
    expect(t.finished).toBe(false);
  });

  it('아레나는 칩 상금 풀을 만들지 않고 모든 순위 상금을 0으로 기록한다', () => {
    const engine = setupArena(
      [2000, 500, 300],
      'As Ah Ks Kh Qs Qh 2c 3d 7h 8s Jc',
    );

    expect(engine.state.tournament!.entrants).toBe(3);
    expect(engine.state.tournament!.prizes).toEqual([]);
    engine.startHand();
    act(engine, 'all-in');
    act(engine, 'call');
    act(engine, 'call');
    completeRunout(engine);

    expect(engine.state.tournament!.finished).toBe(true);
    expect(engine.state.tournament!.results).toHaveLength(3);
    expect(engine.state.tournament!.results.every(result => result.prize === 0))
      .toBe(true);
    expect(engine.state.handRake).toBe(0);
  });

  it('캐시 게임 엔진에는 tournament 상태가 없다', () => {
    const config = { ...sngConfig(), gameMode: 'cash' as const };
    const engine = new PokerEngine(config, 'cash-room');
    expect(engine.state.tournament).toBeUndefined();
  });
});

describe('시트앤고: 블라인드 레벨 인상', () => {
  it('setTournamentLevel 후 다음 핸드부터 새 블라인드가 포스팅된다', () => {
    const { engine } = setupSng([1500, 1500, 1500]);

    engine.startHand();
    expect(engine.state.currentBet).toBe(20); // 레벨 1: 10/20
    act(engine, 'fold');
    act(engine, 'fold'); // BB 승리로 핸드 종료
    expect(engine.state.isHandInProgress).toBe(false);

    engine.setTournamentLevel(2, 15, 30, 25, 50, 0);
    engine.startHand();

    expect(engine.state.currentBet).toBe(30); // 레벨 2: 15/30
    expect(engine.state.smallBlind).toBe(15);
    expect(engine.state.bigBlind).toBe(30);
    expect(engine.state.tournament!.level).toBe(2);
    const sbPlayer = engine.state.players.find(p => p.currentBet === 15);
    expect(sbPlayer).toBeDefined();
  });
});

describe('시트앤고: 탈락 순위', () => {
  it('버스트된 플레이어는 남은 인원 수의 순위를 받는다', () => {
    // p1 AA / p2 KK / p3 32o, 보드 로우 — p3(빅블라인드 100칩)가 올인 후 패배
    const { engine, initialTotal } = setupSng(
      [1500, 1500, 100],
      'As Ah Ks Kh 2c 3d 4h 7s 9c Jd Qh',
    );

    engine.startHand();
    // 3인: 딜러 p1이 첫 액터. p3 올인까지 콜 진행
    act(engine, 'call');   // p1
    act(engine, 'call');   // p2 (SB 보충)
    act(engine, 'all-in'); // p3 (BB, 100)
    act(engine, 'call');   // p1
    act(engine, 'call');   // p2
    // 이후 스트리트: p2/p1 체크로 쇼다운까지
    while (engine.state.isHandInProgress) {
      act(engine, 'check');
    }

    const p3 = engine.state.players.find(p => p.id === 'p3')!;
    expect(p3.chips).toBe(0);
    expect(p3.finishPlace).toBe(3);
    expect(engine.state.tournament!.finished).toBe(false);
    expect(engine.state.tournament!.results).toHaveLength(1);
    expect(totalStacks(engine)).toBe(initialTotal);
  });

  it('동시 탈락은 핸드 시작 스택이 큰 쪽이 상위 순위를 받는다', () => {
    // p1 AA가 p2(500)/p3(300) 동시 커버 — p3가 더 숏스택이므로 3위, p2는 2위
    const { engine } = setupSng(
      [2000, 500, 300],
      'As Ah Ks Kh Qs Qh 2c 3d 7h 8s Jc',
    );

    engine.startHand();
    act(engine, 'all-in'); // p1 (딜러)
    act(engine, 'call');   // p2 → 올인
    act(engine, 'call');   // p3 → 올인 (전원 올인 → 단계별 런아웃)
    completeRunout(engine);

    expect(engine.state.isHandInProgress).toBe(false);
    const p2 = engine.state.players.find(p => p.id === 'p2')!;
    const p3 = engine.state.players.find(p => p.id === 'p3')!;
    expect(p2.finishPlace).toBe(2);
    expect(p3.finishPlace).toBe(3);

    // 2명 탈락 → 1명 생존 → 우승 확정 + 종료
    const t = engine.state.tournament!;
    expect(t.finished).toBe(true);
    const first = t.results.find(r => r.place === 1)!;
    expect(first.playerId).toBe('p1');
    expect(first.prize).toBe(Math.round(2800 * 0.5));
  });
});

describe('시트앤고: 이탈과 종료', () => {
  it('토너먼트 진행 중 이탈하면 현재 순위로 탈락 확정된다', () => {
    const { engine } = setupSng([1500, 1500, 1500]);
    engine.startHand();
    act(engine, 'fold');
    act(engine, 'fold'); // 핸드 종료

    engine.processLeave('p2');
    const t = engine.state.tournament!;
    expect(t.results.find(r => r.playerId === 'p2')?.place).toBe(3);
    expect(t.finished).toBe(false); // 2명 생존
  });

  it('종료된 토너먼트에서는 새 핸드가 시작되지 않는다', () => {
    const { engine } = setupSng(
      [2000, 500, 300],
      'As Ah Ks Kh Qs Qh 2c 3d 7h 8s Jc',
    );
    engine.startHand();
    act(engine, 'all-in');
    act(engine, 'call');
    act(engine, 'call');
    completeRunout(engine);
    expect(engine.state.tournament!.finished).toBe(true);

    engine.startHand();
    expect(engine.state.isHandInProgress).toBe(false);
  });
});
