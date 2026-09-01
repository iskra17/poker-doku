import { describe, expect, it } from 'vitest';
import { buildExplanation, fillFacts } from './explain';
import { generateDrill } from './generator';
import type { DrillFacts } from './templates/kit';

const ODDS_FACTS: DrillFacts = {
  potChips: 150,
  toCallChips: 50,
  villainBet: 50,
  potAfterCall: 200,
  requiredEquity: 25,
  exactPct: 25,
  ratio: '3:1',
  villainName: '카피',
  street: '턴',
  board: 'As Kd 7c 2h',
};

const OUTS_FACTS: DrillFacts = {
  outs: 9,
  unseen: 47,
  pct: 19.1,
  drawName: '플러시 드로우',
  villainHand: '탑페어',
  villainName: '루나',
  street: '플랍',
  board: 'As 7s 2d',
};

describe('buildExplanation — teacher voices', () => {
  it('미야코: 진행자 존댓말 + ♪', () => {
    const explanation = buildExplanation('odds-required-equity', ODDS_FACTS, 'miyako');
    expect(explanation.speaker).toBe('miyako');
    expect(explanation.text).toContain('♪');
    expect(explanation.text).toContain('답니다');
  });

  it('사쿠라: 말더듬 + 당신 호칭 + 존댓말', () => {
    const explanation = buildExplanation('outs-count', OUTS_FACTS, 'sakura');
    expect(explanation.speaker).toBe('sakura');
    expect(explanation.text).toMatch(/조, 조금만/);
    expect(explanation.text).toContain('당신');
    expect(explanation.text).toContain('요');
  });

  it('하나: 정리하는 말투 + 당신 호칭', () => {
    const explanation = buildExplanation('odds-required-equity', ODDS_FACTS, 'hana');
    expect(explanation.speaker).toBe('hana');
    expect(explanation.text).toContain('정리해');
    expect(explanation.text).toContain('당신');
  });

  it('나머지 히로인은 중립 존댓말 폴백 (Phase 2 확장 대상)', () => {
    for (const teacher of ['ara', 'chloe', 'vivian', 'elena'] as const) {
      const explanation = buildExplanation('outs-count', OUTS_FACTS, teacher);
      expect(explanation.speaker).toBe(teacher);
      expect(explanation.text).toContain('풀이예요');
      // 폴백도 반말로 새면 안 된다.
      expect(explanation.text.endsWith('예요.')).toBe(true);
      expect(explanation.text).not.toContain('♪');
    }
  });
});

describe('buildExplanation — facts', () => {
  it('팟오즈 해설에 팟·콜·필요 승률이 그대로 들어간다', () => {
    const text = buildExplanation('odds-required-equity', ODDS_FACTS, 'hana').text;
    // 팟 150은 상대 벳 50을 이미 포함한 총액 — 콜 50을 더한 200이 분모다.
    expect(text).toContain('150');
    expect(text).toContain('50');
    expect(text).toContain('200');
    expect(text).toContain('25%');
    expect(text).toContain('3:1');
  });

  it('아우츠 해설에 아우츠·미확인 카드·확률이 들어간다', () => {
    const text = buildExplanation('outs-count', OUTS_FACTS, 'miyako').text;
    expect(text).toContain('9');
    expect(text).toContain('47');
    expect(text).toContain('19.1');
    expect(text).toContain('플러시 드로우');
  });

  it('facts를 복사해 보관한다 (호출자가 바꿔도 해설이 흔들리지 않게)', () => {
    const facts: DrillFacts = { ...OUTS_FACTS };
    const explanation = buildExplanation('outs-count', facts, 'miyako');
    facts.outs = 999;
    expect(explanation.facts.outs).toBe(9);
  });

  it('모르는 템플릿·빠진 facts는 일반 문장으로 물러선다', () => {
    const unknown = buildExplanation('no-such-template', { outs: 4 }, 'miyako');
    expect(unknown.text).toContain('4');
    expect(unknown.text).toContain('♪');
    expect(unknown.text).not.toContain('?');

    const missing = buildExplanation('outs-count', { outs: 4 }, 'hana');
    expect(missing.text).not.toContain('?');
  });
});

describe('생성된 문항의 해설', () => {
  it('모든 템플릿이 교사 말투가 붙은 풀이 본문을 갖는다', () => {
    const ids = [
      'rank-who-wins', 'rank-best-hand', 'rank-nuts', 'pos-name', 'pos-first-to-act',
      'range-open-decision', 'range-percentile', 'outs-count', 'odds-required-equity',
      'odds-ratio-choice', 'equity-estimate', 'call-decision',
    ];
    for (const id of ids) {
      const instance = generateDrill(id, 3, { teacher: 'miyako' });
      expect(instance.explanation.text, id).toContain('♪');
      // 치환되지 않은 자리표시자나 빠진 값이 남으면 안 된다.
      expect(instance.explanation.text, id).not.toContain('?');
      expect(instance.explanation.text, id).not.toMatch(/\{\w+\}/);
      expect(instance.hint, id).not.toMatch(/\{\w+\}/);
    }
  });
});

describe('fillFacts', () => {
  it('facts 값으로 자리표시자를 치환한다', () => {
    expect(fillFacts('아우츠 {outs}장, 남은 카드 {unseen}장', OUTS_FACTS)).toBe('아우츠 9장, 남은 카드 47장');
  });

  it('없는 키는 그대로 둔다', () => {
    expect(fillFacts('{nope}는 그대로', OUTS_FACTS)).toBe('{nope}는 그대로');
  });
});
