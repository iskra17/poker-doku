import { describe, expect, it } from 'vitest';
import { hasAwkwardPokerTerminology } from '../characters/poker-terminology';
import type { CoachAdvice, CoachReason } from './coach-brain';
import {
  coachActionLabel,
  coachAdviceLine,
  coachReactionLine,
  coachVoiceFor,
  type CoachReaction,
} from './coach-lines';

const REASONS: CoachReason[] = [
  'open-raise', 'iso-raise', 'fold-unopened', 'free-check', 'three-bet', 'call-open', 'fold-vs-open',
  'four-bet', 'call-three-bet', 'fold-vs-three-bet', 'short-push', 'short-fold', 'value-bet',
  'thin-value', 'semi-bluff', 'pot-control', 'raise-value', 'call-strong', 'call-price',
  'call-implied', 'fold-price',
];
const REACTIONS: CoachReaction[] = ['followed', 'ignored', 'followed-won', 'followed-lost'];
/** 히로인 6명 + 전용 말투가 없는 캐릭터(중립 폴백) */
const HEROINES = ['sakura', 'ara', 'hana', 'chloe', 'vivian', 'elena'];
const VOICE_IDS = [...HEROINES, 'mochi'];

const FULL_FACTS: CoachAdvice['facts'] = {
  position: 'BTN', handTopPct: 16.4, requiredPct: 25, drawPct: 19, outs: 9,
  made: 'three-of-a-kind', sizeBb: 2.5, stackBb: 10,
};

/** 핸드를 '손/판', 폴드를 '접다', 오픈 레이즈를 '열다'로 옮긴 표현 */
const TRANSLATED_TERMS = [
  /(?:^|[\s,…])손(?=$|[\s.,!?…은을이가도])/u,
  /(?:^|[\s,…])판(?=$|[\s.,!?…은을이가도])/u,
  /(?:한|이번|다음|이)\s*판/u,
  /열(?:어|자|고|다|기)/u,
];

function advice(reason: CoachReason, facts: CoachAdvice['facts'] = FULL_FACTS): CoachAdvice {
  return { action: 'check', reason, facts };
}

describe('coach-lines', () => {
  it('모든 이유에 히로인 대사와 중립 대사가 있고, 자리표시자 없는 문장이 하나 이상 있다', () => {
    for (const id of VOICE_IDS) {
      const voice = coachVoiceFor(id);
      for (const reason of REASONS) {
        expect(voice.advice[reason]?.length, `${id}/${reason}`).toBeGreaterThan(0);
        expect(voice.advice[reason].some(line => !line.includes('{')), `${id}/${reason} 폴백 문장`).toBe(true);
      }
      for (const reaction of REACTIONS) {
        expect(voice.reaction[reaction]?.length, `${id}/${reaction}`).toBeGreaterThan(0);
      }
    }
    const neutral = coachVoiceFor('mochi');
    expect(new Set(HEROINES.map(id => coachVoiceFor(id))).size).toBe(HEROINES.length);
    for (const id of HEROINES) expect(coachVoiceFor(id), id).not.toBe(neutral);
    expect(coachVoiceFor(null)).toBe(neutral);
  });

  it('숫자가 다 있으면 모든 문장이 채워지고, 없으면 자리표시자 없는 문장으로 내려간다', () => {
    for (const id of VOICE_IDS) {
      for (const reason of REASONS) {
        for (let seed = 0; seed < 6; seed += 1) {
          const full = coachAdviceLine(id, advice(reason), seed);
          const bare = coachAdviceLine(id, advice(reason, {}), seed);
          for (const line of [full, bare]) {
            expect(line.length, `${id}/${reason}`).toBeGreaterThan(0);
            expect(line).not.toMatch(/[{}]/);
            expect(line).not.toContain('undefined');
            expect([...line].length, `${id}/${reason}: ${line}`).toBeLessThanOrEqual(44);
          }
        }
      }
    }
  });

  it('핵심 숫자를 대사에 넣는다', () => {
    const open = coachAdviceLine('sakura', advice('open-raise', { position: 'BTN', handTopPct: 16.4, sizeBb: 2.5 }), 0);
    expect(open).toContain('BTN');
    expect(open).toContain('16%');
    expect(open).toContain('2.5BB');
    expect(coachAdviceLine('sakura', advice('call-price', { requiredPct: 14 }), 0)).toContain('14%');
    expect(coachAdviceLine('sakura', advice('value-bet', { made: 'three-of-a-kind', sizeBb: 6.6 }), 0)).toContain('트리플');
  });

  it('같은 seed는 같은 문장 (렌더 중 무작위 없음)', () => {
    const a = coachAdviceLine('sakura', advice('open-raise'), 12);
    expect(coachAdviceLine('sakura', advice('open-raise'), 12)).toBe(a);
    expect(coachReactionLine('sakura', 'followed', 3)).toBe(coachReactionLine('sakura', 'followed', 3));
  });

  it('포커 용어를 번역하지 않는다 (손/판/접다/열다)', () => {
    for (const id of VOICE_IDS) {
      const voice = coachVoiceFor(id);
      const all = [...Object.values(voice.advice).flat(), ...Object.values(voice.reaction).flat()];
      for (const line of all) {
        expect(hasAwkwardPokerTerminology(line), line).toBe(false);
        for (const pattern of TRANSLATED_TERMS) expect(line, line).not.toMatch(pattern);
      }
    }
  });

  it('반응 대사는 탓하지 않는다 — 안 따른 경우·진 경우에 질책 표현이 없다', () => {
    const blame = /(왜|틀렸|잘못|실수|그러니까|말했잖|탓)/u;
    for (const id of VOICE_IDS) {
      const voice = coachVoiceFor(id);
      for (const line of [...voice.reaction.ignored, ...voice.reaction['followed-lost']]) {
        expect(line, line).not.toMatch(blame);
      }
      expect(voice.reaction['followed-lost'].every(line => /맞았|좋은 선택/u.test(line))).toBe(true);
    }
  });

  it('버튼 라벨 — 레이즈/벳은 BB 크기, 콜은 올인 여부 표기', () => {
    const raise: CoachAdvice = { action: 'raise', amount: 50, reason: 'open-raise', facts: {} };
    expect(coachActionLabel(raise, { bigBlind: 20, isBet: false })).toBe('레이즈 2.5BB');
    expect(coachActionLabel({ ...raise, amount: 132 }, { bigBlind: 20, isBet: true })).toBe('벳 6.6BB');
    expect(coachActionLabel({ action: 'call', reason: 'call-price', facts: {} }, { bigBlind: 20, isBet: false, callIsAllIn: true }))
      .toBe('콜 (올인)');
    expect(coachActionLabel({ action: 'all-in', reason: 'short-push', facts: {} }, { bigBlind: 20, isBet: false })).toBe('올인');
    expect(coachActionLabel({ action: 'fold', reason: 'fold-price', facts: {} }, { bigBlind: 20, isBet: false })).toBe('폴드');
  });
});
