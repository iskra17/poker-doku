import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// 레벨 시간을 10초로 단축해 시뮬레이션이 블라인드 압박으로 빠르게 수렴하게 한다.
// mtt-structure가 import 시점에 env를 읽으므로 동적 import보다 먼저 세팅한다.
process.env.MTT_LEVEL_MS = '10000';

const { RoomManager } = await import('./room-manager');
const { TournamentManager } = await import('./tournament-manager');

/**
 * 봇 풀 런 시뮬레이션 — 실제 타이머/봇 루프/밸런싱/H4H/브레이크 경로를 끝까지 돌린다.
 * 결정론 검증(순위·밸런싱 단위)은 tournament-manager.test.ts가 담당하고,
 * 여기서는 "봇 8명 토너먼트가 사람 개입 없이 완주하는가"와 칩 보존만 본다.
 * (규모를 키우면 100/200명 확장 전 부하 측정 하네스가 된다 — spec §7-5)
 */
describe('MTT bot full-run simulation', () => {
  let roomManager: InstanceType<typeof RoomManager>;
  let manager: InstanceType<typeof TournamentManager>;

  beforeEach(() => {
    vi.useFakeTimers();
    roomManager = new RoomManager(() => {}, () => {});
    manager = new TournamentManager(roomManager, { isConnected: () => true });
  });

  afterEach(() => {
    manager.shutdown();
    roomManager.shutdown();
    vi.useRealTimers();
  });

  it('runs an 8-entrant bot tournament to completion', { timeout: 180_000 }, async () => {
    const created = manager.createTournament({
      name: '봇 풀 런',
      speed: 'hyper',
      maxEntrants: 8,
      tableSize: 6,
      startAt: null,
      botFill: true,
      turnTime: 8,
      hostId: 'h1',
    });
    if (!created.ok) throw new Error('create failed');
    manager.register(created.tournamentId, { id: 'h1', name: '호스트', avatar: 'ara' });
    expect(manager.startTournament(created.tournamentId, 'h1')).toBe('ok');

    // 유일한 휴먼은 자리비움 처리 — SnG/MTT 계약대로 딜인 유지 + 턴 1초 자동 폴드로
    // 테이블을 막지 않고 블라인드가 소진되게 한다
    const summary = manager.listTournaments('h1')[0];
    expect(summary.tableCount).toBe(2); // ceil(8/6)
    const myRoom = summary.myTableRoomId!;
    const me = roomManager.getRoom(myRoom)!.engine.state.players.find(p => p.id === 'h1')!;
    me.sitOutNext = true;

    // 최대 20분(시뮬레이션 시간) 진행 — 10초 레벨이라 블라인드가 곧 스택을 넘는다.
    // 진행 정체(핸드 수 무변화)가 2분 이상 지속되면 교착으로 판정해 즉시 실패시킨다.
    let lastHandTotal = -1;
    let stalledMs = 0;
    for (let i = 0; i < 240 && manager.listTournaments()[0].phase !== 'completed'; i++) {
      await vi.advanceTimersByTimeAsync(5_000);
      const handTotal = roomManager
        .getAdminRoomSummaries()
        .filter(room => room.mode === 'mtt')
        .reduce((sum, room) => sum + room.handNumber, 0);
      if (handTotal === lastHandTotal) {
        stalledMs += 5_000;
        const t = manager.listTournaments()[0];
        // 브레이크(하이퍼: 레벨 8 뒤 3분) 동안의 정체는 정상
        const detail = manager.getDetail(t.id);
        if (stalledMs > 200_000 && !detail?.clock?.onBreak) {
          throw new Error(
            `simulation stalled: hands=${handTotal} remaining=${t.remaining} tables=${t.tableCount}`,
          );
        }
      } else {
        stalledMs = 0;
        lastHandTotal = handTotal;
      }
    }

    const final = manager.listTournaments()[0];
    expect(final.phase).toBe('completed');

    const detail = manager.getDetail(final.id)!;
    expect(detail.standings.length).toBe(8);
    const places = detail.standings.map(r => r.place).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(places).toEqual(Array.from({ length: 8 }, (_, i) => i + 1));

    // 상금 사다리: 8명 필드 = 3명 입상, 합계 = 풀 전액
    const paid = detail.standings.filter(r => r.prize > 0);
    expect(paid.length).toBe(3);
    expect(paid.reduce((s, r) => s + r.prize, 0)).toBe(8 * 5000);

    // 칩 보존: 우승자가 전체 칩을 가진다 (이탈 없음 — 탈락 스택은 전부 팟으로 흘렀다)
    const tables = roomManager
      .getAdminRoomSummaries()
      .filter(room => room.mode === 'mtt');
    expect(tables.length).toBe(1); // 파이널 테이블만 보존
    const champId = detail.standings.find(r => r.place === 1)!.playerId;
    const champSeat = roomManager
      .getRoom(tables[0].id)!.engine.state.players.find(p => p.id === champId);
    expect(champSeat?.chips).toBe(8 * 5000);
  });
});
