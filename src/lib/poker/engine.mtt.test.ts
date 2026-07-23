import { describe, it, expect } from 'vitest';
import { setupTable, act, actor, makePlayer, completeRunout } from './test-helpers';

/**
 * MTT 모드 엔진 계약 — 테이블 로컬 우승 판정/순위 부여를 비활성하고
 * TournamentManager가 전역 순위를 주입한다 (spec-mtt-2026-07-23.md §4-2).
 */
describe('mtt mode engine', () => {
  it('creates tournament display state with ante mirror', () => {
    const { engine } = setupTable([1000, 1000], undefined, { gameMode: 'mtt', ante: 20 });
    expect(engine.state.tournament).toBeDefined();
    expect(engine.state.tournament!.ante).toBe(20);
    expect(engine.state.tournament!.finished).toBe(false);
  });

  it('does NOT declare a winner when table is down to one player', () => {
    const { engine } = setupTable([100, 2000], undefined, { gameMode: 'mtt' });
    // 매니저가 필드 정보를 주입한 상태를 흉내 (SnG였다면 entrants>0에서 로컬 우승 판정)
    engine.setTournamentField(48, [100000, 70000], false);
    engine.startHand();
    // p1(딜러=SB, 헤즈업) 올인 → p2 콜 → 한쪽 버스트
    while (engine.state.isHandInProgress && !engine.state.allInRunout) {
      const a = actor(engine);
      const valid = engine.getValidActions(a);
      act(engine, valid.includes('all-in') ? 'all-in' : 'call');
    }
    completeRunout(engine);
    expect(engine.state.isHandInProgress).toBe(false);

    const t = engine.state.tournament!;
    expect(t.finished).toBe(false); // 테이블 1명 생존 ≠ 토너먼트 우승
    expect(t.results.length).toBe(0); // 로컬 순위 부여 없음
    for (const p of engine.state.players) {
      expect(p.finishPlace).toBeUndefined();
    }
  });

  it('processLeave does not assign a local finish place in mtt', () => {
    const { engine } = setupTable([1000, 1000, 1000], undefined, { gameMode: 'mtt' });
    engine.setTournamentField(48, [], false);
    const { player } = engine.processLeave('p2');
    expect(player?.id).toBe('p2');
    expect(player?.finishPlace).toBeUndefined();
    expect(engine.state.tournament!.results.length).toBe(0);
    expect(engine.state.tournament!.finished).toBe(false);
  });

  it('applyTournamentEliminations injects global places and prizes', () => {
    const { engine } = setupTable([0, 0, 2000], undefined, { gameMode: 'mtt' });
    engine.applyTournamentEliminations([
      { playerId: 'p2', place: 17, prize: 0 },
      { playerId: 'p1', place: 18, prize: 0 },
    ]);
    const t = engine.state.tournament!;
    expect(engine.state.players.find(p => p.id === 'p1')!.finishPlace).toBe(18);
    expect(engine.state.players.find(p => p.id === 'p2')!.finishPlace).toBe(17);
    expect(t.results.map(r => r.place)).toEqual([17, 18]); // place 오름차순 정렬
    // 이미 확정된 순위는 덮어쓰지 않는다
    engine.applyTournamentEliminations([{ playerId: 'p1', place: 3, prize: 100 }]);
    expect(engine.state.players.find(p => p.id === 'p1')!.finishPlace).toBe(18);
    expect(t.results.length).toBe(2);
  });

  it('startTournament is a no-op in mtt (pool comes from the manager)', () => {
    const { engine } = setupTable([1000, 1000], undefined, { gameMode: 'mtt' });
    engine.startTournament(Date.now() + 60_000, 15, 30);
    expect(engine.state.tournament!.entrants).toBe(0);
    expect(engine.state.tournament!.prizes).toEqual([]);
  });

  it('setTournamentLevel propagates ante to config and state', () => {
    const { engine } = setupTable([10000, 10000, 10000], undefined, {
      gameMode: 'mtt', smallBlind: 50, bigBlind: 100,
    });
    engine.setTournamentLevel(4, 150, 300, 200, 400, 0, 300);
    engine.startHand();
    const t = engine.state.tournament!;
    expect(t.ante).toBe(300);
    expect(engine.state.bigBlind).toBe(300);
    const bb = engine.state.players.find(p => p.id === engine.state.bigBlindId)!;
    expect(bb.totalContributed).toBe(600); // 앤티 300 + BB 300
  });

  it('supports a 9-max table end to end', () => {
    const chips = Array.from({ length: 9 }, () => 1000);
    const { engine, initialTotal } = setupTable(chips, undefined, {
      gameMode: 'mtt', maxPlayers: 9, ante: 20,
    });
    expect(engine.state.players.length).toBe(9);
    // 10번째 좌석은 거부
    expect(engine.addPlayer(makePlayer('p10', 1000, 9))).toBe(false);

    engine.startHand();
    expect(engine.state.smallBlindId).toBe('p2');
    expect(engine.state.bigBlindId).toBe('p3');
    while (engine.state.isHandInProgress && !engine.state.allInRunout) {
      const a = actor(engine);
      const valid = engine.getValidActions(a);
      act(engine, valid.includes('check') ? 'check' : 'call');
    }
    completeRunout(engine);
    expect(engine.state.isHandInProgress).toBe(false);
    const stacks = engine.state.players.reduce((s, p) => s + p.chips, 0);
    expect(stacks).toBe(initialTotal);
  });
});
