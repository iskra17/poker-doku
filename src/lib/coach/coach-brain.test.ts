import { describe, expect, it } from 'vitest';
import { parseCards } from '../poker/card-notation';
import type { PlayerStatus, PublicGameState, PublicPlayer, Street } from '../poker/types';
import { adviseHero, followsAdvice, heroPosition, type CoachAdvice } from './coach-brain';

/**
 * 파트너 훈수 판단 회귀 — 실제 6인 테이블 스냅샷(블라인드 10/20)으로 고정한다.
 * 기본 좌석: dealer=0 → 0 BTN, 1 SB, 2 BB, 3 UTG, 4 HJ, 5 CO. pots는 엔진처럼 현재 벳까지 포함한 총액.
 */
const BB = 20;
const HERO = 'hero';

interface SeatSpec {
  chips?: number;
  bet?: number;
  status?: PlayerStatus;
  cards?: string;
}

interface TableSpec {
  heroAt: number;
  cards: string;
  heroChips?: number;
  street?: Street;
  board?: string;
  /** 좌석 index → 이번 스트리트 벳 (기본: 프리플랍이면 SB 10/BB 20) */
  bets?: Record<number, number>;
  seats?: Record<number, SeatSpec>;
  folded?: number[];
  currentBet?: number;
  minRaise?: number;
  /** 지난 스트리트까지 쌓인 팟 (현재 벳은 자동으로 더한다) */
  basePot?: number;
  dealer?: number;
  activeAt?: number;
  playerCount?: number;
}

function table(spec: TableSpec): PublicGameState {
  const street = spec.street ?? 'preflop';
  const count = spec.playerCount ?? 6;
  const dealer = spec.dealer ?? 0;
  const defaultBets: Record<number, number> = street === 'preflop'
    ? { [(dealer + 1) % count]: 10, [(dealer + 2) % count]: 20 }
    : {};
  const bets = { ...defaultBets, ...spec.bets };
  const players: PublicPlayer[] = Array.from({ length: count }, (_, index) => {
    const isHero = index === spec.heroAt;
    const seat = spec.seats?.[index] ?? {};
    const bet = seat.bet ?? bets[index] ?? 0;
    const status: PlayerStatus = seat.status
      ?? (spec.folded?.includes(index) ? 'folded' : 'active');
    return {
      id: isHero ? HERO : `bot${index}`,
      name: isHero ? '나' : `봇${index}`,
      type: isHero ? 'human' : 'bot',
      avatar: isHero ? 'sakura' : 'mochi',
      chips: (isHero ? spec.heroChips : seat.chips) ?? 2_000,
      seatIndex: index,
      holeCards: isHero ? parseCards(spec.cards) : [],
      currentBet: bet,
      totalContributed: bet,
      status,
      hasActed: false,
    };
  });
  const betTotal = players.reduce((sum, player) => sum + player.currentBet, 0);
  const currentBet = spec.currentBet ?? Math.max(0, ...players.map(player => player.currentBet));
  return {
    id: 'room-practice',
    players,
    communityCards: spec.board ? parseCards(spec.board) : [],
    pots: [{ amount: (spec.basePot ?? 0) + betTotal, eligiblePlayerIds: players.map(player => player.id) }],
    currentBet,
    minRaise: spec.minRaise ?? BB,
    street,
    dealerIndex: dealer,
    activePlayerIndex: spec.activeAt ?? spec.heroAt,
    smallBlind: 10,
    bigBlind: BB,
    isHandInProgress: true,
    smallBlindId: players[(dealer + 1) % count].id,
    bigBlindId: players[(dealer + 2) % count].id,
    winners: null,
    handRake: 0,
    economyMode: 'practice',
    lastAction: null,
    turnTimer: 15,
    handNumber: 7,
    actionSeq: 3,
  };
}

function advise(spec: TableSpec): CoachAdvice {
  const advice = adviseHero(table(spec), HERO);
  if (!advice) throw new Error('expected advice');
  return advice;
}

/** 히어로 혼자 남은 상대 1명과 플랍 이후를 치는 상황 — 나머지는 폴드 */
function headsUpPostflop(spec: Omit<TableSpec, 'heroAt' | 'folded'> & { villainBet?: number; villainStatus?: PlayerStatus }): TableSpec {
  return {
    heroAt: 2,
    street: spec.street ?? 'flop',
    folded: [0, 1, 3, 4],
    basePot: spec.basePot ?? 200,
    ...spec,
    bets: spec.villainBet ? { 5: spec.villainBet } : {},
    seats: spec.villainStatus ? { 5: { status: spec.villainStatus, chips: spec.villainStatus === 'all-in' ? 0 : 2_000 } } : undefined,
    minRaise: spec.villainBet ?? BB,
  };
}

describe('heroPosition', () => {
  it('딜러 기준 6인 라벨을 준다', () => {
    expect(heroPosition(table({ heroAt: 0, cards: 'As Kd' }), HERO)).toBe('BTN');
    expect(heroPosition(table({ heroAt: 3, cards: 'As Kd' }), HERO)).toBe('UTG');
    expect(heroPosition(table({ heroAt: 5, cards: 'As Kd' }), HERO)).toBe('CO');
  });

  it('자리비움 좌석은 세지 않는다 — 헤즈업은 BTN/SB', () => {
    const state = table({ heroAt: 0, cards: 'As Kd', playerCount: 3, seats: { 2: { status: 'sitting-out' } } });
    expect(heroPosition(state, HERO)).toBe('BTN/SB');
  });
});

describe('adviseHero — 프리플랍', () => {
  it('경계선 핸드 QJo: UTG에선 폴드, BTN에선 2.5BB 오픈 레이즈', () => {
    const utg = advise({ heroAt: 3, cards: 'Qs Jh' });
    expect(utg).toMatchObject({ action: 'fold', reason: 'fold-unopened' });
    expect(utg.facts).toMatchObject({ position: 'UTG', handTopPct: 16.4 });

    const btn = advise({ heroAt: 0, cards: 'Qs Jh', folded: [3, 4, 5] });
    expect(btn).toMatchObject({ action: 'raise', amount: 50, reason: 'open-raise' });
    expect(btn.facts).toMatchObject({ position: 'BTN', sizeBb: 2.5 });
  });

  it('BB는 SB 림프에 약한 핸드면 공짜 체크, 강한 핸드면 크게 레이즈', () => {
    const base = { heroAt: 2, folded: [0, 3, 4, 5], bets: { 1: 20, 2: 20 } };
    expect(advise({ ...base, cards: '7s 2h' })).toMatchObject({ action: 'check', reason: 'free-check' });
    const strong = advise({ ...base, cards: 'As Kh' });
    expect(strong).toMatchObject({ action: 'raise', amount: 80, reason: 'iso-raise' });
    expect(strong.facts.sizeBb).toBe(4);
  });

  it('림프가 들어온 팟에서 범위 안이면 림퍼 수만큼 키워서 레이즈', () => {
    const advice = advise({ heroAt: 5, cards: 'As Qh', bets: { 3: 20 }, folded: [4] });
    expect(advice).toMatchObject({ action: 'raise', amount: 80, reason: 'iso-raise' });
  });

  describe('오픈을 맞았을 때 (UTG 2.5BB 오픈, 히어로 CO)', () => {
    const facingOpen = { heroAt: 5, bets: { 3: 50 }, folded: [4], minRaise: 30 };

    it('프리미엄은 3벳 (오픈의 3배)', () => {
      const advice = advise({ ...facingOpen, cards: 'As Kh' });
      expect(advice).toMatchObject({ action: 'raise', amount: 150, reason: 'three-bet' });
      expect(advice.facts.sizeBb).toBe(7.5);
    });

    it('상위 12% 안은 콜, 그 밖은 폴드', () => {
      expect(advise({ ...facingOpen, cards: 'As Ts' })).toMatchObject({ action: 'call', reason: 'call-open' });
      expect(advise({ ...facingOpen, cards: 'Ks Th' })).toMatchObject({ action: 'fold', reason: 'fold-vs-open' });
    });

    it('BB는 작은 오픈에 넓게 방어하지만 큰 오픈에는 폴드', () => {
      const small = advise({ heroAt: 2, cards: 'Ks 9s', bets: { 3: 50 }, folded: [4, 5, 0, 1], minRaise: 30 });
      expect(small).toMatchObject({ action: 'call', reason: 'call-open' });
      const big = advise({ heroAt: 2, cards: 'Ks 9s', bets: { 3: 80 }, folded: [4, 5, 0, 1], minRaise: 60 });
      expect(big).toMatchObject({ action: 'fold', reason: 'fold-vs-open' });
    });
  });

  describe('3벳을 맞았을 때 (히어로 UTG 오픈 2.5BB → CO 3벳 7.5BB)', () => {
    const facing3bet = {
      heroAt: 3,
      heroChips: 1_950,
      bets: { 3: 50, 5: 150 },
      folded: [4, 0, 1, 2],
      minRaise: 100,
    };

    it('최상위는 4벳, 상위는 콜, 나머지는 폴드', () => {
      const kk = advise({ ...facing3bet, cards: 'Ks Kh' });
      expect(kk).toMatchObject({ action: 'raise', amount: 345, reason: 'four-bet' });
      expect(kk.facts.sizeBb).toBe(17.3);
      expect(advise({ ...facing3bet, cards: 'Ts Th' })).toMatchObject({ action: 'call', reason: 'call-three-bet' });
      expect(advise({ ...facing3bet, cards: 'As 5s' })).toMatchObject({ action: 'fold', reason: 'fold-vs-three-bet' });
    });

    it('레이즈하지 않은 자리에서도 재레이즈 크기의 벳이면 3벳 기준을 쓴다', () => {
      const cold = { heroAt: 0, bets: { 3: 50, 5: 150 }, folded: [4], minRaise: 100 };
      expect(advise({ ...cold, cards: 'Qs Qh' })).toMatchObject({ action: 'raise', reason: 'four-bet' });
      expect(advise({ ...cold, cards: 'Ks Qh' })).toMatchObject({ action: 'fold', reason: 'fold-vs-three-bet' });
    });
  });

  describe('숏스택 (12BB 이하) 푸시/폴드', () => {
    it('언오픈이면 상위 20%는 올인, 그 밖은 폴드', () => {
      const push = advise({ heroAt: 0, heroChips: 200, cards: 'As Th', folded: [3, 4, 5] });
      expect(push).toMatchObject({ action: 'all-in', reason: 'short-push' });
      expect(push.facts.stackBb).toBe(10);
      expect(advise({ heroAt: 0, heroChips: 200, cards: 'Ks 9s', folded: [3, 4, 5] }))
        .toMatchObject({ action: 'fold', reason: 'short-fold' });
    });

    it('레이즈를 맞으면 상위 10%로 좁힌다', () => {
      const vsRaise = { heroAt: 5, heroChips: 200, bets: { 3: 50 }, folded: [4], minRaise: 30 };
      expect(advise({ ...vsRaise, cards: 'As Th' })).toMatchObject({ action: 'fold', reason: 'short-fold' });
      expect(advise({ ...vsRaise, cards: 'Ts Th' })).toMatchObject({ action: 'all-in', reason: 'short-push' });
    });

    it('콜 금액이 스택 이상이면 올인 훈수가 콜(올인)로 내려간다', () => {
      const advice = advise({
        heroAt: 5,
        heroChips: 100,
        cards: 'Ts Th',
        seats: { 3: { bet: 500, chips: 0, status: 'all-in' } },
        folded: [4, 0, 1, 2],
        minRaise: 480,
      });
      expect(advice).toMatchObject({ action: 'call', reason: 'short-push' });
      expect(advice.amount).toBeUndefined();
    });
  });

  it('상대 올인에 프리미엄이면 4벳 대신 콜 (레이즈 불가 → 이유도 call-strong으로)', () => {
    const advice = advise({
      heroAt: 5,
      cards: 'As Ah',
      seats: { 3: { bet: 1_000, chips: 0, status: 'all-in' } },
      folded: [4, 0, 1, 2],
      minRaise: 980,
    });
    expect(advice).toMatchObject({ action: 'call', reason: 'call-strong' });
  });
});

describe('adviseHero — 플랍 이후', () => {
  it('셋은 팟 66% 밸류 벳', () => {
    const advice = advise(headsUpPostflop({ cards: '7s 7h', board: '7d Kc 2s' }));
    expect(advice).toMatchObject({ action: 'raise', amount: 132, reason: 'value-bet' });
    expect(advice.facts).toMatchObject({ made: 'three-of-a-kind', sizeBb: 6.6 });
  });

  it('탑페어는 팟 절반 씬 밸류 — 리버에선 체크로 팟 조절', () => {
    expect(advise(headsUpPostflop({ cards: 'As Kh', board: 'Kd 7c 2s' })))
      .toMatchObject({ action: 'raise', amount: 100, reason: 'thin-value' });
    expect(advise(headsUpPostflop({ street: 'river', cards: 'As Kh', board: 'Kd 7c 2s 9h 4d' })))
      .toMatchObject({ action: 'check', reason: 'pot-control' });
  });

  it('플랍 플러시 드로우는 세미 블러프 — 리버까지 확률을 보여 준다', () => {
    const advice = advise(headsUpPostflop({ cards: '6s 5s', board: 'Ks 8s 2d' }));
    expect(advice).toMatchObject({ action: 'raise', amount: 100, reason: 'semi-bluff' });
    expect(advice.facts).toMatchObject({ outs: 9, drawPct: 35 });
  });

  it('애매한 패(약한 페어·노페어)는 체크', () => {
    expect(advise(headsUpPostflop({ cards: '7h 6h', board: 'Kd 7c 2s' })))
      .toMatchObject({ action: 'check', reason: 'pot-control' });
    expect(advise(headsUpPostflop({ cards: 'Qh Jh', board: 'Kd 7c 2s' })))
      .toMatchObject({ action: 'check', reason: 'pot-control' });
  });

  it('보드가 만든 족보(777의 AK, 보드 스트레이트)는 강하다고 보지 않는다', () => {
    expect(advise(headsUpPostflop({ cards: 'As Kh', board: '7d 7c 7s' })))
      .toMatchObject({ action: 'check', reason: 'pot-control' });
    expect(advise(headsUpPostflop({ street: 'river', cards: 'As Kd', board: '5c 6d 7h 8s 9c' })))
      .toMatchObject({ action: 'check', reason: 'pot-control' });
  });

  describe('벳을 맞은 드로우 (플러시 드로우, 다음 한 장 9/47 ≈ 19%)', () => {
    const draw = { cards: '6s 5s', board: 'Ks 8s 2d' };

    it('작은 벳이면 가격이 맞아 콜', () => {
      const advice = advise(headsUpPostflop({ ...draw, villainBet: 40 }));
      expect(advice).toMatchObject({ action: 'call', reason: 'call-price' });
      expect(advice.facts).toMatchObject({ requiredPct: 14, drawPct: 19, outs: 9 });
    });

    it('팟 절반 벳은 조금 모자라지만 스택이 깊어 임플라이드 오즈로 콜', () => {
      const advice = advise(headsUpPostflop({ ...draw, villainBet: 100 }));
      expect(advice).toMatchObject({ action: 'call', reason: 'call-implied' });
      expect(advice.facts).toMatchObject({ requiredPct: 25, drawPct: 19 });
    });

    it('팟 사이즈 벳이면 가격이 안 맞아 폴드', () => {
      const advice = advise(headsUpPostflop({ ...draw, villainBet: 200 }));
      expect(advice).toMatchObject({ action: 'fold', reason: 'fold-price' });
      expect(advice.facts.requiredPct).toBe(33);
    });

    it('턴에서는 46장 중 9장으로 다시 계산한다', () => {
      const advice = advise(headsUpPostflop({ ...draw, street: 'turn', board: 'Ks 8s 2d Jc', villainBet: 30 }));
      expect(advice).toMatchObject({ action: 'call', reason: 'call-price' });
      expect(advice.facts.drawPct).toBe(20);
    });
  });

  it('약한 페어도 아주 작은 벳에는 한 번 콜', () => {
    expect(advise(headsUpPostflop({ cards: '7h 6h', board: 'Kd 7c 2s', villainBet: 30 })))
      .toMatchObject({ action: 'call', reason: 'call-price' });
  });

  it('스트레이트로 벳을 맞으면 3배 레이즈', () => {
    const advice = advise(headsUpPostflop({ cards: '9s 8s', board: '7d 6c 5h', villainBet: 100 }));
    expect(advice).toMatchObject({ action: 'raise', amount: 300, reason: 'raise-value' });
    expect(advice.facts.sizeBb).toBe(15);
  });

  it('상대가 올인이라 레이즈가 막히면 콜로 내려가고 이유도 바뀐다', () => {
    const advice = advise(headsUpPostflop({ cards: '9s 8s', board: '7d 6c 5h', villainBet: 300, villainStatus: 'all-in' }));
    expect(advice).toMatchObject({ action: 'call', reason: 'call-strong' });
    expect(advice.amount).toBeUndefined();
  });

  it('밸류 벳이 스택 대부분이면 그냥 올인', () => {
    const advice = advise(headsUpPostflop({ cards: '7s 7h', board: '7d Kc 2s', heroChips: 150 }));
    expect(advice).toMatchObject({ action: 'all-in', reason: 'value-bet' });
    expect(advice.amount).toBeUndefined();
  });
});

describe('adviseHero — 훈수를 내지 않는 경우', () => {
  it('내 차례가 아니면 null', () => {
    expect(adviseHero(table({ heroAt: 0, cards: 'As Ah', activeAt: 3 }), HERO)).toBeNull();
  });

  it('폴드했거나 핸드가 끝났거나 올인 런아웃이면 null', () => {
    expect(adviseHero(table({ heroAt: 3, cards: 'As Ah', seats: { 3: { status: 'folded' } } }), HERO)).toBeNull();
    expect(adviseHero({ ...table({ heroAt: 3, cards: 'As Ah' }), isHandInProgress: false }, HERO)).toBeNull();
    expect(adviseHero({ ...table({ heroAt: 3, cards: 'As Ah' }), allInRunout: true }, HERO)).toBeNull();
  });

  it('좌석에 없는 플레이어면 null', () => {
    expect(adviseHero(table({ heroAt: 3, cards: 'As Ah' }), 'stranger')).toBeNull();
  });
});

describe('followsAdvice', () => {
  const raise: CoachAdvice = { action: 'raise', amount: 50, reason: 'open-raise', facts: {} };
  const allIn: CoachAdvice = { action: 'all-in', reason: 'short-push', facts: {} };
  const check: CoachAdvice = { action: 'check', reason: 'pot-control', facts: {} };

  it('레이즈 총액은 ±35% 안이면 따른 것', () => {
    expect(followsAdvice(raise, 'raise', 60)).toBe(true);
    expect(followsAdvice(raise, 'raise', 33)).toBe(true);
    expect(followsAdvice(raise, 'raise', 80)).toBe(false);
    expect(followsAdvice(raise, 'call')).toBe(false);
    expect(followsAdvice(raise, 'all-in', 2_000)).toBe(false);
  });

  it('올인 훈수는 올인 또는 최대 총액 레이즈면 따른 것', () => {
    expect(followsAdvice(allIn, 'all-in', 200)).toBe(true);
    expect(followsAdvice(allIn, 'raise', 200, 200)).toBe(true);
    expect(followsAdvice(allIn, 'raise', 150, 200)).toBe(false);
    expect(followsAdvice(allIn, 'raise', 200)).toBe(false);
  });

  it('그 외 액션은 종류가 같아야 한다', () => {
    expect(followsAdvice(check, 'check')).toBe(true);
    expect(followsAdvice(check, 'fold')).toBe(false);
  });
});
