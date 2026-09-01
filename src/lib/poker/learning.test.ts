import { describe, expect, it, vi } from 'vitest';
import { formatCard, formatCards } from './card-notation';
import {
  allCards,
  computePotOdds,
  countOutsToRank,
  countOutsVsHand,
  estimateEquity,
  exactDrawPct,
  findNuts,
  handRankOrder,
  rankHands,
  ruleOfTwoAndFour,
  unseenCards,
} from './learning';
import { parseRange } from './range';
import { mulberry32 } from './seeded-rng';
import { cards } from './test-helpers';

const outCodes = (outs: { outs: ReturnType<typeof cards> }) => outs.outs.map(formatCard).sort();

describe('computePotOdds', () => {
  it('골든: 팟 150(상대 벳 50 포함) + 콜 50 → 25%, 비율 3', () => {
    // A4 D-ODDS의 팟 정의 — potTotal은 상대 벳까지 **포함한** 중앙 총액이다.
    // 50 / (150 + 50) = 25%. "팟 150 + 벳 50 = 200 → 20%"로 계산하면 안 된다.
    const odds = computePotOdds(50, 150);
    expect(odds.pct).toBe(25);
    expect(odds.requiredEquity).toBe(0.25);
    expect(odds.ratio).toBe(3);
  });

  it('골든: 팟 100 + 콜 100 → 50%, 비율 1', () => {
    const odds = computePotOdds(100, 100);
    expect(odds.pct).toBe(50);
    expect(odds.requiredEquity).toBe(0.5);
    expect(odds.ratio).toBe(1);
  });

  it('⅓팟 벳(팟 40 + 벳 20 = 60, 콜 20) → 25%', () => {
    // 상대가 팟 60에 20을 벳하면 중앙은 80, 콜 20 → 20/100 = 20%
    expect(computePotOdds(20, 80).pct).toBe(20);
  });

  it('오버벳(팟 100 + 벳 150 = 250, 콜 150) → 37.5%', () => {
    const odds = computePotOdds(150, 250);
    expect(odds.pct).toBe(37.5);
    expect(odds.ratio).toBeCloseTo(250 / 150, 10);
  });

  it('pct = requiredEquity × 100 불변식', () => {
    for (const [call, pot] of [[10, 30], [33, 77], [1, 999]]) {
      const odds = computePotOdds(call, pot);
      expect(odds.pct).toBeCloseTo(odds.requiredEquity * 100, 10);
    }
  });

  it('0/음수/비유한 입력은 throw', () => {
    expect(() => computePotOdds(0, 100)).toThrow();
    expect(() => computePotOdds(-1, 100)).toThrow();
    expect(() => computePotOdds(50, 0)).toThrow();
    expect(() => computePotOdds(50, -100)).toThrow();
    expect(() => computePotOdds(Number.NaN, 100)).toThrow();
    expect(() => computePotOdds(50, Number.POSITIVE_INFINITY)).toThrow();
  });
});

describe('ruleOfTwoAndFour / exactDrawPct', () => {
  it('1장 남았을 때는 ×2', () => {
    expect(ruleOfTwoAndFour(9, 1)).toBe(18);
    expect(ruleOfTwoAndFour(4, 1)).toBe(8);
    expect(ruleOfTwoAndFour(8, 1)).toBe(16);
  });

  it('2장 남았고 아우츠 ≤ 8이면 ×4', () => {
    expect(ruleOfTwoAndFour(4, 2)).toBe(16);
    expect(ruleOfTwoAndFour(8, 2)).toBe(32);
  });

  it('2장 남았고 아우츠 ≥ 9면 보정 outs*4 - (outs-8)', () => {
    // 이 프로젝트가 채택한 보정 규칙 — 9아우츠 → 36-1 = 35 (정확값 34.97),
    // 15아우츠 → 60-7 = 53 (정확값 54.12). 값을 바꾸면 드릴 정답 허용오차가 흔들린다.
    expect(ruleOfTwoAndFour(9, 2)).toBe(35);
    expect(ruleOfTwoAndFour(12, 2)).toBe(44);
    expect(ruleOfTwoAndFour(15, 2)).toBe(53);
  });

  it('근사식은 정확값에 충분히 가깝다 (1장 ±3%p · 2장 ±2%p)', () => {
    // ×2는 실제 배수 100/46 ≈ 2.17보다 작아 항상 살짝 과소평가된다 (15아우츠에서 -2.6%p가 최대).
    for (const outs of [4, 8, 9, 12, 15]) {
      expect(Math.abs(ruleOfTwoAndFour(outs, 1) - exactDrawPct(outs, 46, 1))).toBeLessThan(3);
      expect(Math.abs(ruleOfTwoAndFour(outs, 2) - exactDrawPct(outs, 47, 2))).toBeLessThan(2);
    }
  });

  it('골든: 턴에서 9아우츠(unseen 46) 정확값 ≈ 19.57%', () => {
    // 9/46 = 0.195652…
    expect(exactDrawPct(9, 46, 1)).toBeCloseTo(19.5652, 3);
  });

  it('골든: 플랍에서 9아우츠(unseen 47) 2장 정확값 ≈ 34.97%', () => {
    // 1 - C(38,2)/C(47,2) = 1 - 703/1081 = 378/1081 = 0.349676…
    expect(exactDrawPct(9, 47, 2)).toBeCloseTo(34.9676, 3);
    expect(exactDrawPct(9, 47, 2)).toBeCloseTo((378 / 1081) * 100, 10);
  });

  it('아우츠 0/전부면 0%/100%', () => {
    expect(exactDrawPct(0, 47, 2)).toBe(0);
    expect(exactDrawPct(47, 47, 2)).toBe(100);
    expect(exactDrawPct(0, 46, 1)).toBe(0);
  });

  it('잘못된 입력은 throw', () => {
    expect(() => ruleOfTwoAndFour(-1, 1)).toThrow();
    expect(() => ruleOfTwoAndFour(1.5, 1)).toThrow();
    expect(() => ruleOfTwoAndFour(9, 3 as 1 | 2)).toThrow();
    expect(() => exactDrawPct(10, 5, 1)).toThrow();
    expect(() => exactDrawPct(1, 0, 1)).toThrow();
  });
});

describe('allCards / unseenCards', () => {
  it('52장이고 중복이 없다', () => {
    const deck = allCards();
    expect(deck).toHaveLength(52);
    expect(new Set(deck.map(formatCard)).size).toBe(52);
  });

  it('호출마다 같은 순서 (셔플하지 않는다)', () => {
    expect(allCards().map(formatCard)).toEqual(allCards().map(formatCard));
  });

  it('known을 뺀 나머지를 돌려준다', () => {
    const rest = unseenCards(cards('Ah Kh Qh 7h 2c'));
    expect(rest).toHaveLength(47);
    expect(rest.map(formatCard)).not.toContain('Ah');
    expect(rest.map(formatCard)).not.toContain('2c');
  });
});

describe('handRankOrder', () => {
  it('high-card=0 … royal-flush=9', () => {
    expect(handRankOrder('high-card')).toBe(0);
    expect(handRankOrder('royal-flush')).toBe(9);
    const ordered = [
      'high-card', 'one-pair', 'two-pair', 'three-of-a-kind', 'straight',
      'flush', 'full-house', 'four-of-a-kind', 'straight-flush', 'royal-flush',
    ] as const;
    expect(ordered.map(handRankOrder)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe('countOutsToRank', () => {
  it('골든: 플러시 드로우 = 9아우츠 / unseen 47', () => {
    // A♥K♥ on Q♥7♥2♣ — 하트는 13장 중 A♥K♥Q♥7♥ 4장이 보이므로 남은 하트 9장.
    const result = countOutsToRank(cards('Ah Kh'), cards('Qh 7h 2c'), 'flush');
    expect(result.outs).toHaveLength(9);
    expect(result.unseen).toBe(47); // 52 - 홀 2 - 보드 3
    expect(outCodes(result)).toEqual(['2h', '3h', '4h', '5h', '6h', '8h', '9h', 'Jh', 'Th']);
    expect(exactDrawPct(result.outs.length, result.unseen, 2)).toBeCloseTo(34.9676, 3);
  });

  it('골든: 오픈엔드 스트레이트 드로우 = 8아우츠', () => {
    // 9♥8♠ on 7♦6♣2♥ — T 4장 + 5 4장
    const result = countOutsToRank(cards('9h 8s'), cards('7d 6c 2h'), 'straight');
    expect(result.outs).toHaveLength(8);
    expect(outCodes(result)).toEqual(['5c', '5d', '5h', '5s', 'Tc', 'Td', 'Th', 'Ts']);
  });

  it('골든: 것샷 = 4아우츠', () => {
    // 9♥8♠ on 7♦5♣2♥ — 6만 스트레이트를 만든다
    const result = countOutsToRank(cards('9h 8s'), cards('7d 5c 2h'), 'straight');
    expect(result.outs).toHaveLength(4);
    expect(outCodes(result)).toEqual(['6c', '6d', '6h', '6s']);
  });

  it('골든: 플러시 드로우 + OESD = 15아우츠', () => {
    // 9♥8♥ on 7♥6♣2♥ — 남은 하트 9장(13-4) + 하트가 아닌 T·5 6장 = 15
    const result = countOutsToRank(cards('9h 8h'), cards('7h 6c 2h'), 'straight');
    expect(result.outs).toHaveLength(15);
    expect(outCodes(result)).toEqual(
      ['3h', '4h', '5c', '5d', '5h', '5s', '6h', 'Ah', 'Jh', 'Kh', 'Qh', 'Tc', 'Td', 'Th', 'Ts'].sort(),
    );
  });

  it('이미 목표 랭크 이상이면 아우츠 0 (드로우가 아니라 메이드)', () => {
    const madeFlush = countOutsToRank(cards('Ah Kh'), cards('Qh 7h 2h'), 'flush');
    expect(madeFlush.outs).toEqual([]);
    expect(madeFlush.unseen).toBe(47);
  });

  it('턴(보드 4장)에서는 unseen 46', () => {
    const result = countOutsToRank(cards('Ah Kh'), cards('Qh 7h 2c 3d'), 'flush');
    expect(result.outs).toHaveLength(9);
    expect(result.unseen).toBe(46);
    expect(exactDrawPct(9, 46, 1)).toBeCloseTo(19.5652, 3);
  });

  it('데드카드는 아우츠와 분모에서 함께 빠진다', () => {
    const result = countOutsToRank(cards('Ah Kh'), cards('Qh 7h 2c'), 'flush', cards('Jh Th'));
    expect(result.outs).toHaveLength(7);
    expect(result.unseen).toBe(45);
  });

  it('보드가 3~4장이 아니거나 카드가 겹치면 throw', () => {
    expect(() => countOutsToRank(cards('Ah Kh'), cards('Qh 7h'), 'flush')).toThrow();
    expect(() => countOutsToRank(cards('Ah Kh'), cards('Qh 7h 2c 3d 4s'), 'flush')).toThrow();
    expect(() => countOutsToRank(cards('Ah Kh'), cards('Ah 7h 2c'), 'flush')).toThrow();
    expect(() => countOutsToRank(cards('Ah'), cards('Qh 7h 2c'), 'flush')).toThrow();
  });
});

describe('countOutsVsHand', () => {
  it('골든: A♥K♥ vs A♣A♦ on Q♥7♥2♣ → 하트 9장 / unseen 45', () => {
    // 손 검산: 남은 하트 = 13 − (A♥ K♥ 보유) − (Q♥ 7♥ 보드) = 9장. 하트가 오면 넛 플러시라
    // A원페어를 이긴다. 하트가 아닌 카드는 하나도 이기지 못한다 —
    // K가 오면 히어로 KK vs 빌런 AA(짐), Q가 오면 보드 QQ + 히어로 A키커 vs 빌런 AAQQ(짐).
    // unseen = 52 − 홀 2 − 보드 3 − 빌런 2 = 45.
    const result = countOutsVsHand(cards('Ah Kh'), cards('Qh 7h 2c'), cards('Ac Ad'));
    expect(result.outs).toHaveLength(9);
    expect(result.unseen).toBe(45);
    expect(outCodes(result)).toEqual(['2h', '3h', '4h', '5h', '6h', '8h', '9h', 'Jh', 'Th']);
  });

  it('타이는 아우츠로 세지 않는다', () => {
    // 히어로 A♠K♦ / 빌런 A♥K♣ on Q♦J♠2♣ — 어떤 카드가 와도 무승부다.
    const result = countOutsVsHand(cards('As Kd'), cards('Qd Js 2c'), cards('Ah Kc'));
    expect(result.outs).toEqual([]);
    expect(result.unseen).toBe(45);
  });

  it('빌런이 아우츠를 블로킹하면 그만큼 줄어든다', () => {
    // 빌런이 J♥T♥을 들고 있으면 히어로의 하트 아우츠 2장이 사라진다.
    const result = countOutsVsHand(cards('Ah Kh'), cards('Qh 7h 2c'), cards('Jh Th'));
    expect(outCodes(result)).not.toContain('Jh');
    expect(outCodes(result)).not.toContain('Th');
    expect(result.unseen).toBe(45);
  });

  it('턴에서는 unseen 44', () => {
    const result = countOutsVsHand(cards('Ah Kh'), cards('Qh 7h 2c 3d'), cards('Ac Ad'));
    expect(result.unseen).toBe(44);
    expect(result.outs).toHaveLength(9);
  });

  it('잘못된 입력은 throw', () => {
    expect(() => countOutsVsHand(cards('Ah Kh'), cards('Qh 7h 2c'), cards('Ac'))).toThrow();
    expect(() => countOutsVsHand(cards('Ah Kh'), cards('Qh 7h 2c'), cards('Ah Ad'))).toThrow();
  });
});

describe('estimateEquity — 고정 핸드 완전 열거', () => {
  it('골든: 플랍 A♥K♥ vs Q♠Q♦ on Q♥7♥2♣ → 990런아웃 중 253승', () => {
    // 손 검산 (남은 45장, 히어로는 넛 플러시 드로우 + 러너러너 브로드웨이):
    //  · 빌런 개선 카드 7장 = 7♣7♦7♠ · 2♥2♦2♠ · Q♣(포카드) → 팟이 풀하우스로 넘어간다
    //  · 안전한 하트 8장 = J T 9 8 6 5 4 3 (2♥는 보드를 페어시키므로 제외)
    //  · 개선 카드 없는 38장 중 "하트 1장 이상" = C(38,2) − C(30,2) = 703 − 435 = 268
    //  · 그중 런아웃 자체가 페어인 24가지(안전 하트 8랭크 × 같은 랭크 3장)는 빌런 풀하우스 → 268 − 24 = 244
    //  · 여기에 러너러너 브로드웨이(J와 T, 4×4 = 16가지) 중 위에서 안 세어진 9가지를 더한다 → 253
    const result = estimateEquity(cards('Ah Kh'), cards('Qh 7h 2c'), cards('Qs Qd'));
    expect(result.method).toBe('enumerate');
    expect(result.trials).toBe(990); // C(45,2)
    expect(Math.round(result.win * result.trials)).toBe(253);
    expect(result.tie).toBe(0);
    expect(result.equity).toBeCloseTo(253 / 990, 10);
    expect(result.equity).toBeCloseTo(0.2556, 3);
    expect(result.win + result.tie + result.lose).toBeCloseTo(1, 10);
  });

  it('턴은 44런아웃, 리버는 1런아웃', () => {
    const turn = estimateEquity(cards('Ah Kh'), cards('Qh 7h 2c 3d'), cards('Qs Qd'));
    expect(turn.method).toBe('enumerate');
    expect(turn.trials).toBe(44);
    expect(Math.round(turn.win * 44)).toBe(7); // 남은 하트 7장(2♥는 빌런 풀하우스)
    expect(turn.equity).toBeCloseTo(7 / 44, 10);

    const river = estimateEquity(cards('Ah Kh'), cards('Qh 7h 2c 3d Jh'), cards('Qs Qd'));
    expect(river.method).toBe('enumerate');
    expect(river.trials).toBe(1);
    expect(river.equity).toBe(1); // 넛 플러시 완성
  });

  it('리버 무승부는 equity 0.5', () => {
    // 보드가 그대로 플레이되는 스팟 — 두 사람 다 보드의 스트레이트를 쓴다.
    const result = estimateEquity(cards('2c 3d'), cards('Ah Kh Qh Js Tc'), cards('2h 3s'));
    expect(result.trials).toBe(1);
    expect(result.tie).toBe(1);
    expect(result.equity).toBe(0.5);
  });

  it('열거 경로는 rng를 전혀 쓰지 않는다 (같은 결과)', () => {
    const a = estimateEquity(cards('Ah Kh'), cards('Qh 7h 2c'), cards('Qs Qd'), { rng: mulberry32(1) });
    const b = estimateEquity(cards('Ah Kh'), cards('Qh 7h 2c'), cards('Qs Qd'), { rng: mulberry32(777) });
    expect(a).toEqual(b);
  });

  it('데드카드는 런아웃 후보에서 빠진다', () => {
    const result = estimateEquity(cards('Ah Kh'), cards('Qh 7h 2c'), cards('Qs Qd'), { dead: cards('Jh Th') });
    expect(result.trials).toBe(903); // C(43,2)
  });
});

describe('estimateEquity — 프리플랍 몬테카를로', () => {
  it('골든: AA vs KK ≈ 82% (기본 20,000 샘플)', () => {
    // 60,000 샘플 × 3시드 실측 0.8112~0.8127 → 참값 ≈ 0.812.
    const result = estimateEquity(cards('As Ad'), [], cards('Kh Kc'));
    expect(result.method).toBe('monte-carlo');
    expect(result.trials).toBe(20_000);
    expect(result.equity).toBeGreaterThan(0.79);
    expect(result.equity).toBeLessThan(0.83);
    expect(result.win + result.tie + result.lose).toBeCloseTo(1, 10);
    expect(result.tie).toBeGreaterThan(0); // 보드 플레이 무승부가 드물게 난다
  });

  it('같은 시드면 완전히 재현된다', () => {
    const a = estimateEquity(cards('As Ad'), [], cards('Kh Kc'), { samples: 3000 });
    const b = estimateEquity(cards('As Ad'), [], cards('Kh Kc'), { samples: 3000 });
    expect(a).toEqual(b);
    expect(a).toEqual(estimateEquity(cards('As Ad'), [], cards('Kh Kc'), { rng: mulberry32(1), samples: 3000 }));
  });

  it('다른 시드면 값이 조금 달라진다 (같은 참값 주변)', () => {
    const a = estimateEquity(cards('As Ad'), [], cards('Kh Kc'), { rng: mulberry32(1), samples: 3000 });
    const b = estimateEquity(cards('As Ad'), [], cards('Kh Kc'), { rng: mulberry32(99), samples: 3000 });
    expect(a.equity).not.toBe(b.equity);
    expect(Math.abs(a.equity - b.equity)).toBeLessThan(0.03);
  });

  it('AKs vs QQ는 코인플립에 가깝다 (46±3%)', () => {
    const result = estimateEquity(cards('Ah Kh'), [], cards('Qs Qd'), { samples: 8000 });
    expect(result.equity).toBeGreaterThan(0.43);
    expect(result.equity).toBeLessThan(0.49);
  });

  it('samples가 잘못되면 throw', () => {
    expect(() => estimateEquity(cards('As Ad'), [], cards('Kh Kc'), { samples: 0 })).toThrow();
    expect(() => estimateEquity(cards('As Ad'), [], cards('Kh Kc'), { samples: 1.5 })).toThrow();
  });

  it('겹치는 카드는 throw', () => {
    expect(() => estimateEquity(cards('As Ad'), [], cards('As Kc'))).toThrow();
    expect(() => estimateEquity(cards('As Ad'), cards('As 7h 2c'), cards('Kh Kc'))).toThrow();
    expect(() => estimateEquity(cards('As'), [], cards('Kh Kc'))).toThrow();
  });
});

describe('estimateEquity — 레인지 상대', () => {
  const range = parseRange('QQ+, AK');

  it('리버·턴은 콤보×런아웃이 작아 완전 열거로 떨어진다', () => {
    // 데드(A♥K♥ + 보드) 제외 후 18콤보 — QQ 3 · KK 3 · AA 3 · AKs 3 · AKo 6
    const river = estimateEquity(cards('Ah Kh'), cards('Qh 7h 2c 3d Jh'), range);
    expect(river.method).toBe('enumerate');
    expect(river.trials).toBe(18);
    expect(river.equity).toBe(1); // 넛 플러시는 이 레인지 전부를 이긴다

    const turn = estimateEquity(cards('Ah Kh'), cards('Qh 7h 2c 3d'), range);
    expect(turn.method).toBe('enumerate');
    expect(turn.trials).toBe(18 * 44);
    expect(turn.equity).toBeCloseTo(0.4072, 3);
  });

  it('플랍은 열거 예산(5,000)을 넘겨 시드 MC로 떨어진다', () => {
    // 완전 열거 참값은 18 × 990 = 17,820 런아웃 기준 0.52264 (별도 실측).
    const result = estimateEquity(cards('Ah Kh'), cards('Qh 7h 2c'), range);
    expect(result.method).toBe('monte-carlo');
    expect(result.trials).toBe(2_000);
    expect(result.equity).toBeGreaterThan(0.49);
    expect(result.equity).toBeLessThan(0.56);
  });

  it('레인지 MC도 같은 시드면 재현된다', () => {
    const a = estimateEquity(cards('Ah Kh'), cards('Qh 7h 2c'), range, { samples: 500 });
    const b = estimateEquity(cards('Ah Kh'), cards('Qh 7h 2c'), range, { samples: 500 });
    expect(a).toEqual(b);
    expect(a.equity).not.toBe(
      estimateEquity(cards('Ah Kh'), cards('Qh 7h 2c'), range, { rng: mulberry32(31), samples: 500 }).equity,
    );
  });

  it('블로커로 콤보가 0이 되면 throw', () => {
    // AA만 있는 레인지에서 히어로가 A 2장, 데드로 나머지 2장을 들면 남는 콤보가 없다.
    expect(() =>
      estimateEquity(cards('As Ad'), cards('Qh 7h 2c'), parseRange('AA'), { dead: cards('Ah Ac') }),
    ).toThrow(/no live combos/);
  });

  it('프리플랍 레인지도 동작한다', () => {
    const result = estimateEquity(cards('As Ad'), [], parseRange('QQ+, AK'), { samples: 1500 });
    expect(result.method).toBe('monte-carlo');
    expect(result.equity).toBeGreaterThan(0.7); // AA는 이 좁은 레인지에도 크게 앞선다
    expect(result.win + result.tie + result.lose).toBeCloseTo(1, 10);
  });
});

describe('findNuts', () => {
  it('골든: 리버 A♥K♥Q♥J♥2♣ → 로열 플러시, T♥를 포함한 46조합', () => {
    // 남은 47장의 2장 조합 C(47,2)=1,081 중 T♥를 포함한 46개가 전부 로열 플러시를 만든다.
    const result = findNuts(cards('Ah Kh Qh Jh 2c'));
    expect(result.hand.rank).toBe('royal-flush');
    expect(result.holeCards).toHaveLength(46);
    for (const hole of result.holeCards) {
      expect(hole.map(formatCard)).toContain('Th');
    }
  });

  it('골든: 7♣7♦K♣K♠2♥ → 넛츠는 K♥K♦ 포카드 단 1조합', () => {
    // 남은 K는 K♥·K♦ 둘뿐 → 포카드 K가 유일한 최강 조합. 7♥7♠(포카드 7)는 한 단계 아래다.
    const result = findNuts(cards('7c 7d Kc Ks 2h'));
    expect(result.hand.rank).toBe('four-of-a-kind');
    expect(result.hand.description).toContain('Ks');
    expect(result.holeCards).toHaveLength(1);
    expect(formatCards(result.holeCards[0])).toBe('Kh Kd');
  });

  it('플랍 Q♥7♥2♣ → 넛츠는 트리플 퀸(QQ 3조합) — 5장뿐이라 플러시가 불가능하다', () => {
    const result = findNuts(cards('Qh 7h 2c'));
    expect(result.hand.rank).toBe('three-of-a-kind');
    expect(result.holeCards.map(formatCards).sort()).toEqual(['Qd Qc', 'Qs Qc', 'Qs Qd']);
  });

  it('데드카드를 주면 그 카드로 만드는 넛츠는 후보에서 빠진다', () => {
    // T♥가 죽으면 스트레이트 플러시가 사라져 넛츠는 A♥K♥Q♥J♥9♥ 플러시가 된다.
    const result = findNuts(cards('Ah Kh Qh Jh 2c'), cards('Th'));
    expect(result.hand.rank).toBe('flush');
    for (const hole of result.holeCards) {
      expect(hole.map(formatCard)).toContain('9h');
    }
  });

  it('보드 장수가 3~5가 아니면 throw', () => {
    expect(() => findNuts(cards('Ah Kh'))).toThrow();
    expect(() => findNuts(cards('Ah Kh Qh Jh Th 9h'))).toThrow();
  });

  it('벤치: 리버 넛츠 계산이 200ms 미만 (로컬 실측 ≈ 28ms)', () => {
    const started = Date.now();
    findNuts(cards('Ah Kh Qh Jh 2c'));
    expect(Date.now() - started).toBeLessThan(400);
  });
});

describe('rankHands', () => {
  it('강한 순으로 정렬하고 1부터 순위를 매긴다', () => {
    const board = cards('Qh 7h 2c');
    const ranked = rankHands(board, [cards('Ah Kh'), cards('Qs Qd'), cards('7c 7d'), cards('As Ks')]);
    expect(ranked.map(r => formatCards(r.holeCards))).toEqual(['Qs Qd', '7c 7d', 'Ah Kh', 'As Ks']);
    expect(ranked.map(r => r.rank)).toEqual([1, 2, 3, 3]);
    expect(ranked[0].hand.rank).toBe('three-of-a-kind');
  });

  it('동점은 같은 순위를 공유하고 다음 순위를 건너뛴다 (1,1,3)', () => {
    const board = cards('Qh 7h 2c 3d 4s');
    const ranked = rankHands(board, [cards('Ah Kd'), cards('As Kh'), cards('Qs Qd')]);
    expect(ranked.map(r => r.rank)).toEqual([1, 2, 2]);
    expect(ranked[0].hand.rank).toBe('three-of-a-kind');
  });

  it('빈 후보는 빈 결과', () => {
    expect(rankHands(cards('Qh 7h 2c'), [])).toEqual([]);
  });
});

describe('CSPRNG 경계', () => {
  it('Math.random을 쓰지 않는다 — 무작위는 주입된 시드 RNG만', () => {
    const spy = vi.spyOn(Math, 'random');
    try {
      computePotOdds(50, 150);
      ruleOfTwoAndFour(9, 2);
      exactDrawPct(9, 46, 1);
      unseenCards(cards('Ah Kh'));
      countOutsToRank(cards('Ah Kh'), cards('Qh 7h 2c'), 'flush');
      countOutsVsHand(cards('Ah Kh'), cards('Qh 7h 2c'), cards('Ac Ad'));
      estimateEquity(cards('Ah Kh'), cards('Qh 7h 2c'), cards('Qs Qd'));
      estimateEquity(cards('As Ad'), [], cards('Kh Kc'), { samples: 200 });
      estimateEquity(cards('Ah Kh'), cards('Qh 7h 2c'), parseRange('QQ+'), { samples: 200 });
      findNuts(cards('Qh 7h 2c'));
      rankHands(cards('Qh 7h 2c'), [cards('Ah Kh')]);
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it('벤치: 플랍 고정 핸드 에퀴티 완전 열거가 200ms 미만 (로컬 실측 ≈ 50ms)', () => {
    const started = Date.now();
    estimateEquity(cards('Ah Kh'), cards('Qh 7h 2c'), cards('Qs Qd'));
    expect(Date.now() - started).toBeLessThan(400);
  });
});
