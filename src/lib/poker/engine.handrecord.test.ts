import { describe, expect, it } from 'vitest';
import { act, cards, completeRunout, setupTable } from './test-helpers';
import type { HandHistoryAction } from './hand-history';

/**
 * 엔진 핸드 히스토리 레코더 회귀.
 * 핵심 계약:
 * - endHand 시점에 getCompletedHandRecord()가 액션 타임라인(블라인드 포함)·보드·승자·수익을 완성한다.
 * - revealed는 getPublicState와 같은 판정(경합 쇼다운 생존자만) — 폴드 승리에선 아무도 공개되지 않는다.
 * - 레코드 원본은 전체 홀카드를 담는다 (마스킹은 저장 계층 책임).
 */
describe('PokerEngine hand record', () => {
  it('records a full showdown hand: posts, actions per street, board, winners, profits', () => {
    // p1=BTN, p2=SB, p3=BB (setupTable 계약) — p1이 투페어로 승리
    const { engine } = setupTable(
      [1000, 1000, 1000],
      'As Ks Jh Jd 2c 7d Ah Kh Qs 3s 9c',
    );
    engine.startHand();

    act(engine, 'raise', 60);  // p1 (UTG=BTN 3-handed)
    act(engine, 'call');       // p2 (SB, 50 추가)
    act(engine, 'fold');       // p3 (BB)
    act(engine, 'check');      // p2 (플랍)
    act(engine, 'raise', 40);  // p1 벳
    act(engine, 'call');       // p2
    act(engine, 'check');      // p2 (턴)
    act(engine, 'check');      // p1
    act(engine, 'check');      // p2 (리버)
    act(engine, 'check');      // p1 → 쇼다운

    const record = engine.getCompletedHandRecord();
    expect(record).not.toBeNull();
    expect(record!.handNumber).toBe(1);
    expect(record!.smallBlind).toBe(10);
    expect(record!.bigBlind).toBe(20);
    expect(record!.showdown).toBe(true);
    expect(record!.board).toEqual(cards('Ah Kh Qs 3s 9c'));
    expect(record!.potTotal).toBe(220);
    expect(record!.rake).toBe(0);

    // 액션 타임라인 — 포스팅부터 스트리트 순서대로
    expect(record!.actions.map(a => [a.street, a.playerId, a.kind, a.amount])).toEqual([
      ['preflop', 'p2', 'post-sb', 10],
      ['preflop', 'p3', 'post-bb', 20],
      ['preflop', 'p1', 'raise', 60],
      ['preflop', 'p2', 'call', 50],
      ['preflop', 'p3', 'fold', 0],
      ['flop', 'p2', 'check', 0],
      ['flop', 'p1', 'raise', 40],
      ['flop', 'p2', 'call', 40],
      ['turn', 'p2', 'check', 0],
      ['turn', 'p1', 'check', 0],
      ['river', 'p2', 'check', 0],
      ['river', 'p1', 'check', 0],
    ]);

    // 포지션/수익/공개 여부
    const byId = new Map(record!.players.map(p => [p.id, p]));
    expect(byId.get('p1')!.position).toBe('BTN');
    expect(byId.get('p2')!.position).toBe('SB');
    expect(byId.get('p3')!.position).toBe('BB');
    expect(byId.get('p1')!.profit).toBe(120);
    expect(byId.get('p2')!.profit).toBe(-100);
    expect(byId.get('p3')!.profit).toBe(-20);
    expect(byId.get('p1')!.revealed).toBe(true);
    expect(byId.get('p2')!.revealed).toBe(true);
    expect(byId.get('p3')!.revealed).toBe(false);
    expect(byId.get('p1')!.handRank).toBe('two-pair');
    expect(byId.get('p2')!.handRank).toBe('one-pair');
    expect(byId.get('p3')!.handRank).toBeNull();

    // 원본 레코드는 폴드한 패도 담는다 (마스킹 전)
    expect(byId.get('p3')!.holeCards).toEqual(cards('2c 7d'));

    expect(record!.winners).toEqual([{
      playerId: 'p1',
      amount: 220,
      handRank: 'two-pair',
      handDescription: expect.stringContaining('Two Pair'),
      potIndex: 0,
    }]);
  });

  it('fold win: no showdown, nobody revealed, empty board', () => {
    const { engine } = setupTable([1000, 1000, 1000]);
    engine.startHand();

    act(engine, 'fold'); // p1
    act(engine, 'fold'); // p2 → p3(BB) 승리

    const record = engine.getCompletedHandRecord();
    expect(record!.showdown).toBe(false);
    expect(record!.board).toEqual([]);
    expect(record!.players.every(p => !p.revealed)).toBe(true);
    expect(record!.players.every(p => p.handRank === null)).toBe(true);
    expect(record!.winners).toEqual([{
      playerId: 'p3', amount: 30, handRank: null, handDescription: null, potIndex: 0,
    }]);
    const p3 = record!.players.find(p => p.id === 'p3')!;
    expect(p3.won).toBe(30);
    expect(p3.profit).toBe(10);
  });

  it('all-in runout: both hands revealed, all-in and call amounts recorded', () => {
    // 헤즈업 — p1=BTN/SB, p2=BB. 프리플랍 올인 → 런아웃
    const { engine } = setupTable([500, 500], 'As Ad Kh Qd 2c 7h 9s 3d 5h');
    engine.startHand();

    act(engine, 'all-in');  // p1: 총 500
    act(engine, 'call');    // p2: 480 추가 → 올인 콜
    completeRunout(engine);

    const record = engine.getCompletedHandRecord();
    expect(record!.showdown).toBe(true);
    expect(record!.board).toHaveLength(5);
    const byId = new Map(record!.players.map(p => [p.id, p]));
    expect(byId.get('p1')!.position).toBe('BTN/SB');
    expect(byId.get('p2')!.position).toBe('BB');
    expect(byId.get('p1')!.revealed).toBe(true);
    expect(byId.get('p2')!.revealed).toBe(true);
    expect(byId.get('p1')!.handRank).toBe('one-pair');
    expect(byId.get('p1')!.profit).toBe(500);
    expect(byId.get('p2')!.profit).toBe(-500);

    const play = record!.actions.filter((a: HandHistoryAction) => a.kind !== 'post-sb' && a.kind !== 'post-bb');
    expect(play).toEqual([
      { street: 'preflop', playerId: 'p1', kind: 'all-in', amount: 500 },
      { street: 'preflop', playerId: 'p2', kind: 'call', amount: 480 },
    ]);
  });

  it('mid-hand leave is recorded as a fold action', () => {
    const { engine } = setupTable([1000, 1000, 1000]);
    engine.startHand();

    engine.processLeave('p3'); // BB가 핸드 중 이탈 (현재 액터 아님)
    act(engine, 'fold');       // p1 폴드 → p2 승리

    const record = engine.getCompletedHandRecord();
    expect(record!.actions.filter(a => a.kind === 'fold').map(a => a.playerId))
      .toEqual(['p3', 'p1']);
    const p3 = record!.players.find(p => p.id === 'p3')!;
    expect(p3.finalStatus).toBe('folded');
    expect(record!.winners![0].playerId).toBe('p2');
  });

  it('keeps the previous record until the next hand completes', () => {
    const { engine } = setupTable([1000, 1000, 1000]);
    engine.startHand();
    act(engine, 'fold');
    act(engine, 'fold');
    expect(engine.getCompletedHandRecord()!.handNumber).toBe(1);

    engine.startHand();
    // 새 핸드 진행 중에도 직전 완료 핸드 레코드가 유지된다 (RoomManager가 늦게 읽어도 안전)
    expect(engine.getCompletedHandRecord()!.handNumber).toBe(1);
    act(engine, 'fold');
    act(engine, 'fold');
    expect(engine.getCompletedHandRecord()!.handNumber).toBe(2);
  });
});
