import { describe, it, expect } from 'vitest';
import { decideBotAction, loosenPreflopRange } from './bot-ai';
import { BOT_PERSONALITIES } from './personalities';
import { handPercentile } from './hand-rankings';
import { makePlayer, cards } from '../poker/test-helpers';
import { GameState, ActionType } from '../poker/types';

/**
 * HUD 스탯 기반 의사결정 검증.
 * - 레인지 스탯(vpip/pfr/threeBet/coldCall)은 핸드 백분위와 비교되고,
 * - 빈도 스탯(cbet/foldToCbet 등)은 rng 독립시행으로 실행된다 —
 * 같은 상황·같은 핸드에서 스탯이 다르면 행동이 달라지는 것(수치 = 스타일)을 고정한다.
 */

function state(partial: Partial<GameState> = {}): GameState {
  return {
    id: 'test',
    players: [],
    communityCards: [],
    pots: [{ amount: 30, eligiblePlayerIds: [] }],
    currentBet: 20,
    minRaise: 20,
    street: 'preflop',
    dealerIndex: 0,
    activePlayerIndex: 0,
    smallBlind: 10,
    bigBlind: 20,
    isHandInProgress: true,
    winners: null,
    handRake: 0,
    lastAction: null,
    turnTimer: 30,
    handNumber: 1,
    actionSeq: 0,
    ...partial,
  };
}

const NO_CHECK: ActionType[] = ['fold', 'call', 'raise', 'all-in'];
const rngAt = (v: number) => () => v;

describe('핸드 백분위 테이블 (hand-rankings)', () => {
  it('프리미엄이 최상위, 트래시가 최하위다', () => {
    expect(handPercentile(cards('As Ad'))).toBeLessThan(0.01);
    expect(handPercentile(cards('7d 2c'))).toBeGreaterThan(0.7);
  });

  it('페어 서열이 단조롭다 — AA < KK < QQ < JJ', () => {
    const aa = handPercentile(cards('As Ad'));
    const kk = handPercentile(cards('Ks Kd'));
    const qq = handPercentile(cards('Qs Qd'));
    const jj = handPercentile(cards('Js Jd'));
    expect(aa).toBeLessThan(kk);
    expect(kk).toBeLessThan(qq);
    expect(qq).toBeLessThan(jj);
  });

  it('수딧이 같은 랭크 오프수트보다 강하다', () => {
    expect(handPercentile(cards('Ah Kh'))).toBeLessThan(handPercentile(cards('Ah Kd')));
  });
});

describe('레인지 스탯 — vpip가 참여 여부를 가른다', () => {
  it('같은 마지널 핸드: 루즈(chloe)는 림프, 타이트(sakura)는 폴드', () => {
    // 폴드 완화 계층(loosenPreflopRange) 적용 후의 두 봇 vpip 레인지 사이에 있어야 유효한 테스트
    const hole = cards('Qh 4d'); // Q4o ≈ 72%
    const pct = handPercentile(hole);
    expect(pct).toBeGreaterThan(loosenPreflopRange(BOT_PERSONALITIES['sakura'].vpip / 100));
    expect(pct).toBeLessThanOrEqual(loosenPreflopRange(BOT_PERSONALITIES['chloe'].vpip / 100));

    const st = state(); // 언오픈 팟, 림프 비용 = 1BB
    const loose = makePlayer('bot', 2000, 0, { type: 'bot', personalityId: 'chloe', holeCards: hole });
    const tight = makePlayer('bot', 2000, 0, { type: 'bot', personalityId: 'sakura', holeCards: hole });

    expect(decideBotAction(loose, st, NO_CHECK, rngAt(0.001)).action).toBe('call'); // 림프
    expect(decideBotAction(tight, st, NO_CHECK, rngAt(0.001)).action).toBe('fold');
  });

  it('vpip 수치만 바꾸면 같은 봇의 행동이 바뀐다 (수치 = 스타일)', () => {
    const hole = cards('Qh 4d'); // Q4o ≈ 72% — 완화된 tight(55%)와 loose(85%) 레인지 사이
    const base = BOT_PERSONALITIES['hana'];
    BOT_PERSONALITIES['test-tight'] = { ...base, id: 'test-tight', vpip: 10, pfr: 5 };
    BOT_PERSONALITIES['test-loose'] = { ...base, id: 'test-loose', vpip: 70, pfr: 5, limp: 100 };
    try {
      const st = state();
      const tight = makePlayer('bot', 2000, 0, { type: 'bot', personalityId: 'test-tight', holeCards: hole });
      const loose = makePlayer('bot', 2000, 0, { type: 'bot', personalityId: 'test-loose', holeCards: hole });
      expect(decideBotAction(tight, st, NO_CHECK, rngAt(0.5)).action).toBe('fold');
      expect(decideBotAction(loose, st, NO_CHECK, rngAt(0.5)).action).toBe('call');
    } finally {
      delete BOT_PERSONALITIES['test-tight'];
      delete BOT_PERSONALITIES['test-loose'];
    }
  });

  it('3벳 레인지: TT는 hana(8%)에겐 3벳, sakura(3%)에겐 콜드콜', () => {
    const hole = cards('Ts Td');
    const pct = handPercentile(hole);
    expect(pct).toBeLessThanOrEqual(BOT_PERSONALITIES['hana'].threeBet / 100);
    expect(pct).toBeGreaterThan(BOT_PERSONALITIES['sakura'].threeBet / 100);

    const st = state({ currentBet: 50, pots: [{ amount: 80, eligiblePlayerIds: [] }] }); // 2.5BB 오픈 직면
    const hana = makePlayer('bot', 2000, 0, { type: 'bot', personalityId: 'hana', holeCards: hole });
    const sakura = makePlayer('bot', 2000, 0, { type: 'bot', personalityId: 'sakura', holeCards: hole });

    expect(decideBotAction(hana, st, NO_CHECK, rngAt(0.5)).action).toBe('raise');
    expect(decideBotAction(sakura, st, NO_CHECK, rngAt(0.5)).action).toBe('call');
  });
});

describe('빈도 스탯 — 독립시행(rng) 모델', () => {
  function airCbetSpot(personalityId: string) {
    // K94 레인보우 보드에 3♦2♣ — 메이드도 드로우도 없는 순수 에어
    const player = makePlayer('bot', 2000, 0, {
      type: 'bot', personalityId, holeCards: cards('3d 2c'), id: 'bot-1',
    });
    const st = state({
      street: 'flop',
      communityCards: cards('Ks 9c 4s'),
      currentBet: 0,
      pots: [{ amount: 100, eligiblePlayerIds: [] }],
      lastAggressorId: 'bot-1', // 내가 프리플랍 어그레서 — c벳 스팟
    });
    return { player, st };
  }

  it('cbetFlop 시행: 롤이 스탯보다 낮으면 벳, 높으면 체크', () => {
    const { player, st } = airCbetSpot('vivian'); // cbetFlop 85
    expect(decideBotAction(player, st, ['fold', 'check', 'raise'], rngAt(0.5)).action).toBe('raise');
    expect(decideBotAction(player, st, ['fold', 'check', 'raise'], rngAt(0.9)).action).toBe('check');
  });

  it('같은 롤에서 스탯이 다르면 행동이 갈린다 — vivian(85)은 벳, sakura(52)는 체크', () => {
    const vivian = airCbetSpot('vivian');
    const sakura = airCbetSpot('sakura');
    const roll = rngAt(0.6); // 60 — sakura 52 초과, vivian 85 미만
    expect(decideBotAction(vivian.player, vivian.st, ['fold', 'check', 'raise'], roll).action).toBe('raise');
    expect(decideBotAction(sakura.player, sakura.st, ['fold', 'check', 'raise'], roll).action).toBe('check');
  });

  it('foldToCbet 시행: 압박에 sakura(58)는 접고 chloe(15)는 버틴다', () => {
    // A♠Q♦ on 9-5-2 — 오버카드 2장 (strength ~0.28, 에어 분기)
    const mk = (personalityId: string) => makePlayer('bot', 2000, 0, {
      type: 'bot', personalityId, holeCards: cards('As Qd'),
    });
    const st = state({
      street: 'flop',
      communityCards: cards('9h 5c 2s'),
      currentBet: 50, // 팟 300 대비 스몰벳 — potOdds 0.143
      pots: [{ amount: 300, eligiblePlayerIds: [] }],
    });
    const roll = rngAt(0.3); // 30 — sakura 58 미만(폴드 시행 성공), chloe 15 초과(버팀)
    expect(decideBotAction(mk('sakura'), st, NO_CHECK, roll).action).toBe('fold');
    expect(decideBotAction(mk('chloe'), st, NO_CHECK, roll).action).toBe('call'); // wtsd 44 > 30 — 플로트 콜
  });
});
