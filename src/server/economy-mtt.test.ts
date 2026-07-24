import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PokerDatabase } from './persistence/database';
import { openPokerDatabase } from './persistence/database';
import {
  EconomyDomainError,
  EconomyRepository,
} from './economy-repository';
import { EconomyService } from './economy-service';
import { computePayouts } from '@/lib/poker/payout-table';
import {
  MTT_WALLET_BUY_IN,
  MTT_WALLET_ENTRY_COST,
  MTT_WALLET_ENTRY_FEE,
} from '@/lib/economy/mtt-entry';

/**
 * wallet MTT 토너 단위 에스크로 회귀 (Phase 2 — spec-mtt §4-7).
 * sng_entries를 토너먼트 ID 키로 재사용한다 (v26에서 place CHECK 1..1000으로 확장).
 * - 예약/환불: 지갑 차감·전액 환불, 정원 상한, 이중 좌석 가드
 * - 시작: 수수료 소각 + started 전이 (멱등)
 * - 정산: payout-table 계단표 강제 + 상금 지급 + 재호출 멱등/충돌 판정
 * - 무효화: reserved/started 혼재 전원 전액 환불
 */

const MTT_ID = 'mtt-1721739600000-abcd1234';
const NOW = 1_721_739_600_000;

let database: PokerDatabase;
let repository: EconomyRepository;
let service: EconomyService;

beforeEach(() => {
  database = openPokerDatabase(':memory:');
  repository = new EconomyRepository(database);
  service = new EconomyService(repository, () => NOW);
});

afterEach(() => {
  database.close();
});

function seedProfile(profileId: string, balance = 5_000): void {
  database.db.prepare(`
    INSERT INTO profiles (
      id, credential_hash, credential_lookup, recovery_hash, recovery_lookup,
      alias, avatar_id, adult_confirmed_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'sakura', 1, 1, 1)
  `).run(
    profileId,
    `credential-hash:${profileId}`,
    `credential-lookup:${profileId}`,
    `recovery-hash:${profileId}`,
    `recovery-lookup:${profileId}`,
    `유저-${profileId}`,
  );
  database.db.prepare(`
    INSERT INTO wallets (profile_id, balance, updated_at) VALUES (?, ?, 1)
  `).run(profileId, balance);
}

function balanceOf(profileId: string): number {
  const row = database.db.prepare(
    'SELECT balance FROM wallets WHERE profile_id = ?',
  ).get(profileId) as { balance: number };
  return row.balance;
}

function seedEntrants(count: number): string[] {
  const ids: string[] = [];
  for (let i = 1; i <= count; i++) {
    const id = `p${i}`;
    seedProfile(id);
    service.reserveMttEntry(id, MTT_ID, 48);
    ids.push(id);
  }
  return ids;
}

describe('wallet MTT 에스크로', () => {
  it('예약은 지갑에서 참가비를 차감하고, 취소는 전액 환불한다', () => {
    seedProfile('p1');
    const entry = service.reserveMttEntry('p1', MTT_ID, 48);
    expect(entry.status).toBe('reserved');
    expect(balanceOf('p1')).toBe(5_000 - MTT_WALLET_ENTRY_COST);
    // 같은 토너 재예약은 멱등
    expect(service.reserveMttEntry('p1', MTT_ID, 48).id).toBe(entry.id);
    expect(balanceOf('p1')).toBe(5_000 - MTT_WALLET_ENTRY_COST);

    const refunded = service.cancelMttEntry('p1', MTT_ID);
    expect(refunded?.status).toBe('refunded');
    expect(balanceOf('p1')).toBe(5_000);
  });

  it('잔액 부족·이중 좌석·정원 초과를 거부한다', () => {
    seedProfile('poor', 100);
    expect(() => service.reserveMttEntry('poor', MTT_ID, 48))
      .toThrowError(expect.objectContaining({ code: 'INSUFFICIENT_BALANCE' }));

    seedProfile('busy');
    service.reserveSngEntry('busy', 'sng-room-1'); // 다른 상품의 활성 좌석
    expect(() => service.reserveMttEntry('busy', MTT_ID, 48))
      .toThrowError(expect.objectContaining({ code: 'SNG_ACTIVE_SEAT' }));

    seedProfile('a');
    seedProfile('b');
    seedProfile('late');
    service.reserveMttEntry('a', MTT_ID, 2);
    service.reserveMttEntry('b', MTT_ID, 2);
    expect(() => service.reserveMttEntry('late', MTT_ID, 2))
      .toThrowError(EconomyDomainError);
  });

  it('시작은 수수료만 소각하고(지갑 불변) started로 전이한다 — 재호출 멱등', () => {
    const ids = seedEntrants(3);
    service.startMttTournament(MTT_ID, ids);
    for (const id of ids) {
      expect(balanceOf(id)).toBe(5_000 - MTT_WALLET_ENTRY_COST);
    }
    const escrows = database.db.prepare(`
      SELECT amount FROM seat_escrows WHERE status = 'active'
    `).all() as Array<{ amount: number }>;
    expect(escrows).toHaveLength(3);
    expect(escrows.every(row => row.amount === MTT_WALLET_BUY_IN)).toBe(true);
    // 멱등 재호출
    expect(() => service.startMttTournament(MTT_ID, ids)).not.toThrow();
    // 명단 불일치는 거부
    expect(() => service.startMttTournament(MTT_ID, ids.slice(0, 2)))
      .toThrowError(EconomyDomainError);
  });

  it('정산은 payout-table 계단표를 강제하고 상금을 지갑에 지급한다', () => {
    const ids = seedEntrants(12);
    service.startMttTournament(MTT_ID, ids);

    const pool = MTT_WALLET_BUY_IN * 12;
    const ladder = computePayouts(pool, 12); // 4명 입상
    const results = ids.map((playerId, index) => ({
      playerId,
      place: index + 1,
      prize: ladder[index] ?? 0,
    }));

    // 계단표와 다른 상금은 거부
    expect(() => service.settleMttTournament(MTT_ID, [
      { ...results[0], prize: results[0].prize + 1 },
      ...results.slice(1),
    ])).toThrowError(expect.objectContaining({ code: 'SNG_SETTLEMENT_INVALID' }));

    service.settleMttTournament(MTT_ID, results);
    expect(balanceOf('p1')).toBe(5_000 - MTT_WALLET_ENTRY_COST + ladder[0]);
    expect(balanceOf('p4')).toBe(5_000 - MTT_WALLET_ENTRY_COST + ladder[3]);
    expect(balanceOf('p5')).toBe(5_000 - MTT_WALLET_ENTRY_COST); // 5위부터 상금 없음
    expect(balanceOf('p12')).toBe(5_000 - MTT_WALLET_ENTRY_COST);
    // 상금 합 = 풀 전액 (수수료 제외)
    expect(ladder.reduce((s, v) => s + v, 0)).toBe(pool);

    // 6위 초과 순위가 저장된다 (v26 place CHECK 확장 회귀)
    const places = database.db.prepare(`
      SELECT place FROM sng_entries WHERE room_id = ? ORDER BY place
    `).all(MTT_ID) as Array<{ place: number }>;
    expect(places.map(row => row.place)).toEqual(
      Array.from({ length: 12 }, (_, i) => i + 1),
    );

    // 같은 결과 재정산은 멱등, 다른 결과는 충돌
    expect(() => service.settleMttTournament(MTT_ID, results)).not.toThrow();
    expect(balanceOf('p1')).toBe(5_000 - MTT_WALLET_ENTRY_COST + ladder[0]);
    const swapped = results.map(result => (
      result.place === 1
        ? { ...result, playerId: results[1].playerId }
        : result.place === 2
          ? { ...result, playerId: results[0].playerId }
          : result
    ));
    expect(() => service.settleMttTournament(MTT_ID, swapped))
      .toThrowError(expect.objectContaining({ code: 'SNG_SETTLEMENT_CONFLICT' }));
  });

  it('공동 순위의 점유 상금을 나누고 같은 결과 재정산은 멱등이다', () => {
    const ids = seedEntrants(35);
    service.startMttTournament(MTT_ID, ids);

    const pool = MTT_WALLET_BUY_IN * ids.length;
    const ladder = computePayouts(pool, ids.length);
    const sharedPool = (ladder[5] ?? 0) + (ladder[6] ?? 0);
    const sharedBase = Math.floor(sharedPool / 2);
    const sharedRemainder = sharedPool - sharedBase * 2;
    const tiedIds = ['p6', 'p7'].sort((a, b) => a.localeCompare(b));
    expect(sharedRemainder).toBe(1);
    const results = ids.map((playerId, index) => {
      if (index < 5) {
        return { playerId, place: index + 1, prize: ladder[index] ?? 0 };
      }
      if (index < 7) {
        const tieIndex = tiedIds.indexOf(playerId);
        return {
          playerId,
          place: 6,
          prize: sharedBase + (tieIndex < sharedRemainder ? 1 : 0),
        };
      }
      return { playerId, place: index + 1, prize: ladder[index] ?? 0 };
    });

    expect(results.reduce((sum, result) => sum + result.prize, 0)).toBe(pool);
    service.settleMttTournament(MTT_ID, results);
    for (const playerId of tiedIds) {
      const tieIndex = tiedIds.indexOf(playerId);
      expect(balanceOf(playerId)).toBe(
        5_000 - MTT_WALLET_ENTRY_COST
        + sharedBase
        + (tieIndex < sharedRemainder ? 1 : 0),
      );
    }

    const balancesAfterFirstSettlement = ids.map(balanceOf);
    expect(() => service.settleMttTournament(MTT_ID, results)).not.toThrow();
    expect(ids.map(balanceOf)).toEqual(balancesAfterFirstSettlement);
    expect(database.db.prepare(`
      SELECT place FROM sng_entries
      WHERE room_id = ? AND profile_id IN ('p6', 'p7')
      ORDER BY profile_id
    `).all(MTT_ID)).toEqual([{ place: 6 }, { place: 6 }]);
  });

  it('무효화는 reserved/started 혼재 전원에게 전액(수수료 포함) 환불한다', () => {
    const ids = seedEntrants(4);
    // 2명만 시작 명단이 아닌 케이스는 없다 — 시작 전 취소(전원 reserved) 경로
    expect(service.voidMttTournament(MTT_ID)).toBe(4);
    for (const id of ids) expect(balanceOf(id)).toBe(5_000);

    // 시작 후 취소(전원 started) — 소각된 수수료까지 환불
    const restarted = ['q1', 'q2', 'q3'];
    for (const id of restarted) {
      seedProfile(id);
      service.reserveMttEntry(id, 'mtt-2', 48);
    }
    service.startMttTournament('mtt-2', restarted);
    expect(service.voidMttTournament('mtt-2')).toBe(3);
    for (const id of restarted) expect(balanceOf(id)).toBe(5_000);
  });

  it('SnG 6인 상품 계약은 그대로다 (정원 6 상한·기존 상금표)', () => {
    for (let i = 1; i <= 7; i++) seedProfile(`s${i}`);
    for (let i = 1; i <= 6; i++) {
      service.reserveSngEntry(`s${i}`, 'sng-room-9');
    }
    expect(() => service.reserveSngEntry('s7', 'sng-room-9'))
      .toThrowError(EconomyDomainError);
  });

  it('서버 재시작 복구가 미완 MTT 참가도 환불한다 (recoverIncompleteSngEntries 승계)', () => {
    const ids = seedEntrants(3);
    service.startMttTournament(MTT_ID, ids);
    expect(service.recoverIncompleteSngEntries()).toBe(3);
    for (const id of ids) expect(balanceOf(id)).toBe(5_000);
  });

  it('상수 무결성 — 참가비 = 바이인 + 수수료', () => {
    expect(MTT_WALLET_ENTRY_COST).toBe(MTT_WALLET_BUY_IN + MTT_WALLET_ENTRY_FEE);
  });
});
