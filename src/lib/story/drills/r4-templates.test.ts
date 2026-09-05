/**
 * R4a 회귀 — 4막(Ch10 MDF · Ch12 SnG)이 지목할 드릴 10종
 * (`sng-orbit-cost`는 정답이 상황 카드의 팟과 같은 값이라 2026-09-06에 삭제했다 — 등록만 남겨 두지 않는다).
 *
 * 모델은 `r3-templates.test.ts`와 같다: 등록·결정론·공개 DTO·채점·수학 대조를 한 파일에서 본다.
 * 다른 점 두 가지 —
 * ① 오답 검사는 `correct + tolerance + 1`(허용 오차 **밖**). tolerance 1·2인 문항이 있어 `correct + 1`은 정답이다.
 * ② `변형 수 > 3`은 생성형 9종만 본다. 수기 2종은 seed가 달라도 같은 인스턴스가 나오는 게 계약이다.
 */
import { expect, describe, it, vi } from 'vitest';
import { formatCard } from '@/lib/poker/card-notation';
import { evaluateHand } from '@/lib/poker/evaluator';
import { parseCards } from '@/lib/poker/card-notation';
import { SNG_BLIND_SCHEDULE } from '@/lib/poker/blind-schedule';
import { computeMdf, computePotOdds, estimateEquity } from '@/lib/poker/learning';
import { parseRange, rangeCombos } from '@/lib/poker/range';
import { mulberry32 } from '@/lib/poker/seeded-rng';
import {
  PUSH_FOLD_MAX_BB,
  SHORT_STACK_MAX_BB,
  STACK_ZONE_LABEL,
  STACK_ZONE_ORDER,
  pushFoldEv,
  stackZone,
} from '../sng-thresholds';
import { chapterSkillCategories, DRILL_CATEGORY_LABEL } from '../story-hub-rules';
import { makeChapter } from '../test-fixtures';
import { DRILL_TEMPLATE_IDS, generateDrill, getDrillTemplate, gradeDrill } from './generator';
import { toPublicDrillInstance } from './public';
import { SUPPORT_CHARACTER_IDS } from './templates/kit';
import {
  ACT4_EQUITY_SAMPLES,
  ACT4_EQUITY_SEED,
  ACT4_PUSH_FOLD_INPUTS,
  pushFoldFacts,
} from './templates/authored/act4';
import type { DrillInstance } from './types';

const MDF_IDS = ['mdf-defend-pct', 'mdf-choice', 'mdf-vs-call-equity'];
const SNG_IDS = ['sng-stack-bb', 'sng-m-ratio', 'sng-next-level-bb', 'sng-itm-distance', 'sng-stack-zone'];
const GENERATED_IDS = [...MDF_IDS, ...SNG_IDS];
const AUTHORED_IDS = ['act-ch12-push-btn-8bb', 'act-ch12-fold-utg-8bb'];
const ALL_IDS = [...GENERATED_IDS, ...AUTHORED_IDS];

const SUPPORT_POOL = new Set(SUPPORT_CHARACTER_IDS);
/** 히어로 두 장을 뺀 상대 홀카드 조합 수 — act4의 콜 확률 분모와 같아야 한다. */
const LIVE_COMBOS = (50 * 49) / 2;

// ---------------------------------------------------------------------------
// ① 등록

it('registers the 10 Act 4 MDF / SnG drill templates', () => {
  for (const id of ALL_IDS) {
    expect(DRILL_TEMPLATE_IDS.has(id), id).toBe(true);
    expect(generateDrill(id, 7, { teacher: 'vivian' }).templateId).toBe(id);
  }
  for (const id of MDF_IDS) expect(getDrillTemplate(id)?.category, id).toBe('mdf');
  for (const id of [...SNG_IDS, ...AUTHORED_IDS]) expect(getDrillTemplate(id)?.category, id).toBe('sng-math');
});

// ---------------------------------------------------------------------------
// ② 공개 DTO · 채점 · 상대 풀

/** 정답·해설·힌트가 새지 않고, 상황 카드가 스스로 모순되지 않는지. */
function verifyShape(instance: DrillInstance): void {
  const { hero, board, villains, potChips, toCallChips } = instance.situation;
  const known = [...hero, ...board];
  expect(new Set(known.map(formatCard)).size).toBe(known.length);
  expect(potChips).toBeGreaterThanOrEqual(toCallChips);

  const ids = villains.map(villain => villain.characterId);
  expect(new Set(ids).size).toBe(ids.length);
  for (const characterId of ids) expect(SUPPORT_POOL.has(characterId), characterId).toBe(true);
  expect(villains.every(villain => villain.holeCards === undefined)).toBe(true);

  const publicJson = JSON.stringify(toPublicDrillInstance(instance));
  expect(publicJson).not.toMatch(/correct|explanation|"facts"|"hint"/i);
  expect(instance.hint).not.toMatch(/\{\w+\}/);
  expect(instance.question).not.toMatch(/\{\w+\}/);
  expect(instance.explanation.text).not.toMatch(/\{\w+\}/);
  expect(instance.explanation.text).not.toContain('?');

  const spec = instance.answerSpec;
  if (spec.kind === 'numeric') {
    expect(gradeDrill(instance, { kind: 'numeric', value: spec.correct })).toBe(true);
    // 허용 오차 **밖** 값이어야 오답이다 (tolerance 1·2인 문항이 있어 correct + 1은 정답).
    expect(gradeDrill(instance, { kind: 'numeric', value: spec.correct + spec.tolerance + 1 })).toBe(false);
  }
  else if (spec.kind === 'multiple-choice') {
    expect(new Set(spec.options).size).toBe(spec.options.length);
    expect(gradeDrill(instance, { kind: 'multiple-choice', index: spec.correctIndex })).toBe(true);
    expect(gradeDrill(instance, {
      kind: 'multiple-choice',
      index: (spec.correctIndex + 1) % spec.options.length,
    })).toBe(false);
  }
  else if (spec.kind === 'action-pick') {
    expect(gradeDrill(instance, { kind: 'action-pick', action: spec.correct[0] })).toBe(true);
    const wrong = spec.options.find(option => !spec.correct.includes(option));
    expect(wrong).toBeDefined();
    expect(gradeDrill(instance, { kind: 'action-pick', action: wrong! })).toBe(false);
  }
  else throw new Error(`unexpected answer kind: ${spec.kind}`);
}

// ---------------------------------------------------------------------------
// ③ 수학 대조

/** MDF 세 값은 `computeMdf`와 독립 공식(팟오즈) 양쪽으로 재계산해 맞춘다. */
function verifyMdf(instance: DrillInstance): void {
  const f = instance.explanation.facts;
  const potBeforeBet = Number(f.potBeforeBet);
  const betChips = Number(f.betChips);

  // 상황 카드 금액 정의: potChips = P + B, toCall = B (D-ODDS 정의와 같은 방향).
  expect(f.potChips).toBe(potBeforeBet + betChips);
  expect(instance.situation.potChips).toBe(potBeforeBet + betChips);
  expect(instance.situation.toCallChips).toBe(betChips);
  expect(instance.situation.street).toBe('river');
  expect(instance.situation.board).toHaveLength(5);
  // 블러프 캐처만 출제한다 — 강한 핸드에는 "레인지 방어" 이야기가 성립하지 않는다.
  expect(['high-card', 'one-pair']).toContain(evaluateHand(instance.situation.hero, instance.situation.board).rank);

  const expected = computeMdf(potBeforeBet, betChips);
  expect(f.mdf).toBe(Math.round(expected.mdf));
  expect(f.callEquity).toBe(Math.round(expected.callEquity));
  expect(f.villainBreakeven).toBe(Math.round(expected.villainBreakeven));

  // 독립 공식: MDF = P/(P+B), 콜 필요 승률 = 팟오즈(pct — requiredEquity는 0~1이라 ×100), 상대 손익분기 = B/(P+B).
  const potTotal = potBeforeBet + betChips;
  expect(Number(f.mdfExact)).toBeCloseTo(Math.round((potBeforeBet / potTotal) * 1000) / 10, 5);
  expect(Number(f.callEquityExact)).toBeCloseTo(Math.round(computePotOdds(betChips, potTotal).pct * 10) / 10, 5);
  expect(Number(f.villainBreakevenExact)).toBeCloseTo(Math.round((betChips / potTotal) * 1000) / 10, 5);
  expect(Number(f.mdf) + Number(f.villainBreakeven)).toBe(100);

  const spec = instance.answerSpec;
  if (spec.kind === 'numeric') {
    expect(spec.correct).toBe(f.mdf);
    expect(spec.unit).toBe('%');
  }
  else if (spec.kind === 'multiple-choice') {
    if (instance.templateId === 'mdf-choice') {
      expect(spec.options[spec.correctIndex]).toBe(`${f.mdf}%`);
      const values = spec.options.map(option => Number(option.replace('%', '')));
      for (let i = 0; i < values.length; i++) {
        for (let j = i + 1; j < values.length; j++) {
          expect(Math.abs(values[i] - values[j]), spec.options.join('/')).toBeGreaterThanOrEqual(4);
        }
      }
    }
    else {
      expect(spec.options[spec.correctIndex]).toBe(`MDF ${f.mdf}% · 필요 승률 ${f.callEquity}%`);
      expect(spec.options).toContain(`MDF ${f.callEquity}% · 필요 승률 ${f.mdf}%`);
      expect(spec.options).toContain(`MDF ${f.villainBreakeven}% · 필요 승률 ${f.callEquity}%`);
      expect(spec.options).toContain(`MDF ${f.mdf}% · 필요 승률 ${f.villainBreakeven}%`);
    }
  }
}

/** SnG 문항은 실제 블라인드 스케줄·`stackZone`·note의 인원으로 되짚는다. */
function verifySng(instance: DrillInstance): void {
  const f = instance.explanation.facts;
  const note = instance.situation.note ?? '';
  const levelMatch = note.match(/레벨 (\d+) \((\d+)\/(\d+)\)/);
  const playersMatch = note.match(/남은 인원 (\d)\/6/);
  expect(levelMatch, note).not.toBeNull();
  expect(playersMatch, note).not.toBeNull();

  const level = Number(levelMatch![1]);
  const smallBlind = Number(levelMatch![2]);
  const bigBlind = Number(levelMatch![3]);
  const players = Number(playersMatch![1]);
  const schedule = SNG_BLIND_SCHEDULE[level - 1];
  expect(schedule).toEqual({ smallBlind, bigBlind });
  expect(level).toBeLessThanOrEqual(9);
  expect(players).toBeGreaterThanOrEqual(3);
  expect(players).toBeLessThanOrEqual(6);

  // 상황 카드가 그 레벨을 그대로 반영한다.
  expect(instance.situation.bigBlind).toBe(bigBlind);
  expect(instance.situation.street).toBe('preflop');
  expect(instance.situation.board).toHaveLength(0);
  expect(instance.situation.hero).toHaveLength(2);
  expect(instance.situation.villains).toHaveLength(players - 1);

  const ante = Number(f.ante);
  expect(instance.situation.potChips).toBe(smallBlind + bigBlind + ante * players);
  // 콜 금액: BB 좌석이면 0(체크 가능), 아니면 BB.
  const heroPosition = instance.situation.heroPosition;
  const expectedCall = heroPosition === 'BB' ? 0 : heroPosition === 'SB' ? bigBlind - smallBlind : bigBlind;
  expect(instance.situation.toCallChips).toBe(expectedCall);
  if (ante > 0) expect(note).toContain('개인 앤티');

  const heroStack = Number(f.heroStack);
  expect(instance.situation.heroStackChips).toBe(heroStack);
  const spec = instance.answerSpec;

  switch (instance.templateId) {
    case 'sng-stack-bb': {
      expect(spec.kind).toBe('numeric');
      if (spec.kind !== 'numeric') return;
      expect(heroStack % bigBlind).toBe(0);
      expect(spec.correct).toBe(heroStack / bigBlind);
      expect(spec.correct).toBeGreaterThanOrEqual(4);
      expect(spec.correct).toBeLessThanOrEqual(40);
      expect(spec.unit).toBe('bb');
      return;
    }
    case 'sng-m-ratio': {
      expect(spec.kind).toBe('numeric');
      if (spec.kind !== 'numeric') return;
      const orbitCost = smallBlind + bigBlind + ante * players;
      expect(f.orbitCost).toBe(orbitCost);
      expect(spec.correct).toBeCloseTo(heroStack / orbitCost, 6);
      // 소수 첫째 자리로 떨어져야 한다 (반올림 논쟁 없이 채점).
      expect(Math.abs(spec.correct * 10 - Math.round(spec.correct * 10))).toBeLessThan(1e-9);
      expect(f.mExact).toBe(spec.correct);
      expect(spec.unit).toBe('x');
      return;
    }
    case 'sng-next-level-bb': {
      expect(spec.kind).toBe('numeric');
      if (spec.kind !== 'numeric') return;
      const next = SNG_BLIND_SCHEDULE[level];
      expect(next).toBeDefined();
      expect(f.nextBigBlind).toBe(next.bigBlind);
      expect(f.nextLevel).toBe(level + 1);
      expect(spec.correct).toBe(Math.round(heroStack / next.bigBlind));
      expect(Math.abs(heroStack / next.bigBlind - spec.correct)).toBeLessThanOrEqual(0.49);
      expect(f.nextBbExact).toBe(Math.round((heroStack / next.bigBlind) * 10) / 10);
      expect(Number(f.dropBb)).toBeGreaterThan(0);
      expect(spec.unit).toBe('bb');
      return;
    }
    case 'sng-itm-distance': {
      expect(spec.kind).toBe('multiple-choice');
      if (spec.kind !== 'multiple-choice') return;
      expect(spec.options).toEqual(['1명', '2명', '3명', '이미 상금권']);
      const paid = Number(f.paidPlaces);
      expect(paid).toBe(3);
      const expected = players - paid <= 0 ? '이미 상금권' : `${players - paid}명`;
      expect(spec.options[spec.correctIndex]).toBe(expected);
      expect(f.answer).toBe(expected);
      return;
    }
    case 'sng-stack-zone': {
      expect(spec.kind).toBe('multiple-choice');
      if (spec.kind !== 'multiple-choice') return;
      expect(spec.options).toEqual(STACK_ZONE_ORDER.map(zone => STACK_ZONE_LABEL[zone]));
      const bb = heroStack / bigBlind;
      expect(f.stackBb).toBe(Math.round(bb * 10) / 10);
      expect(spec.options[spec.correctIndex]).toBe(STACK_ZONE_LABEL[stackZone(bb)]);
      expect(f.zone).toBe(STACK_ZONE_LABEL[stackZone(bb)]);
      // 경계 ±1BB는 출제하지 않는다 (구간 정의가 아니라 경계 읽기 문제가 된다).
      expect(Math.abs(bb - PUSH_FOLD_MAX_BB)).toBeGreaterThan(1);
      expect(Math.abs(bb - SHORT_STACK_MAX_BB)).toBeGreaterThan(1);
      return;
    }
    default:
      throw new Error(`unexpected SnG template: ${instance.templateId}`);
  }
}

describe.each(GENERATED_IDS)('%s', id => {
  it('keeps the answer, public projection and math consistent across 100 seeds', () => {
    const variations = new Set<string>();
    for (let seed = 0; seed < 100; seed++) {
      const instance = generateDrill(id, seed, { teacher: 'vivian' });
      verifyShape(instance);
      if (MDF_IDS.includes(id)) verifyMdf(instance);
      else verifySng(instance);
      variations.add(JSON.stringify([instance.question, instance.situation.note, instance.answerSpec]));
    }
    // 생성형만 변형을 요구한다 (수기 문항은 seed와 무관하게 같은 인스턴스가 나오는 게 계약).
    expect(variations.size).toBeGreaterThan(3);
  }, 60_000);
});

it('covers every ITM branch and both ante variants over 100 seeds', () => {
  const itmAnswers = new Set<string>();
  const zones = new Set<string>();
  let withAnte = 0;
  for (let seed = 0; seed < 100; seed++) {
    const facts = generateDrill('sng-itm-distance', seed, { teacher: 'elena' }).explanation.facts;
    itmAnswers.add(String(facts.answer));
    zones.add(String(generateDrill('sng-stack-zone', seed, { teacher: 'elena' }).explanation.facts.zone));
    if (Number(generateDrill('sng-m-ratio', seed, { teacher: 'elena' }).explanation.facts.ante) > 0) withAnte++;
  }
  expect([...itmAnswers].sort()).toEqual(['1명', '2명', '3명', '이미 상금권'].sort());
  expect(zones.size).toBeGreaterThanOrEqual(2);
  // 앤티 있는 변형이 절반 이상.
  expect(withAnte).toBeGreaterThanOrEqual(50);
}, 60_000);

// ---------------------------------------------------------------------------
// ④ 결정론 · Math.random 금지 · 허브 라벨

it('recreates instances deterministically without Math.random and keeps hub labels', () => {
  const spy = vi.spyOn(Math, 'random');
  try {
    for (const id of ALL_IDS) {
      for (const seed of [0, 31, 99]) {
        const instance = generateDrill(id, seed, { teacher: 'elena', bigBlind: 40 });
        expect(instance, `${id}#${seed}`).toEqual(generateDrill(id, seed, { teacher: 'elena', bigBlind: 40 }));
        expect(DRILL_CATEGORY_LABEL[instance.category], id).toBeTruthy();
      }
    }
    expect(spy).not.toHaveBeenCalled();
  }
  finally {
    spy.mockRestore();
  }
});

it('renders the Act 4 teacher voices without leaking polite endings', () => {
  for (const teacher of ['vivian', 'elena'] as const) {
    for (const id of GENERATED_IDS) {
      for (const seed of [1, 42]) {
        const text = generateDrill(id, seed, { teacher }).explanation.text;
        // 반말 화자의 본문에 존댓말 어미(문장 끝 '…요')가 남으면 안 된다.
        expect(text, `${teacher}/${id}#${seed}`).not.toMatch(/[가-힣]요[.?!,]|[가-힣]요$/);
      }
    }
  }
  expect(generateDrill('mdf-defend-pct', 3, { teacher: 'vivian' }).explanation.text).toContain('브라보');
  expect(generateDrill('mdf-defend-pct', 3, { teacher: 'elena' }).explanation.text).toContain('패는 거짓말을 안 해');
});

it('exposes both new categories to the hub', () => {
  expect(DRILL_CATEGORY_LABEL.mdf).toBe('MDF');
  expect(DRILL_CATEGORY_LABEL['sng-math']).toBe('SnG 산술');
  const chapter = makeChapter();
  chapter.steps = [
    {
      kind: 'drill-set',
      id: 'r4-review',
      title: '복습',
      teacher: 'vivian',
      hintPenalty: 0.5,
      drills: ALL_IDS.map(templateId => ({ templateId, seedPolicy: 'per-run' as const })),
    },
    { kind: 'result', id: 'result' },
  ];
  expect(chapterSkillCategories(chapter)).toEqual(['mdf', 'sng-math']);
});

// ---------------------------------------------------------------------------
// ⑤ 수기 푸시/폴드 — 에퀴티·EV 재계산

describe('act 4 authored push/fold drills', () => {
  it('matches a fresh equity measurement and the shared pushFoldEv result', () => {
    for (const input of ACT4_PUSH_FOLD_INPUTS) {
      const hero = parseCards(input.hero);
      const range = parseRange(input.range);

      // 콜 확률은 히어로 카드를 뺀 라이브 콤보 비율이다 ("상위 X%" 표기와 다른 값).
      const callProb = rangeCombos(range, hero).length / LIVE_COMBOS;
      const measured = estimateEquity(hero, [], range, {
        samples: ACT4_EQUITY_SAMPLES,
        rng: mulberry32(ACT4_EQUITY_SEED),
      });
      // 파일 헤더에 기록된 실측 에퀴티가 같은 방법으로 재현된다 (±2%p).
      expect(Math.abs(measured.equity - input.equity) * 100, input.templateId).toBeLessThanOrEqual(2);

      const recomputed = pushFoldEv({
        heroStack: 1600,
        blindsTotal: 300,
        callers: input.pots.map(potIfCalls => ({ callProb, potIfCalls })),
        equity: measured.equity,
      });
      const facts = pushFoldFacts(input);
      expect(Math.sign(recomputed.evPush), input.templateId).toBe(Math.sign(facts.evPush));
      expect(Math.abs(recomputed.pFoldAll * 100 - facts.pFoldAll), input.templateId).toBeLessThanOrEqual(2);

      const instance = generateDrill(input.templateId, 0, { teacher: 'miyako' });
      const spec = instance.answerSpec;
      expect(spec.kind).toBe('action-pick');
      if (spec.kind !== 'action-pick') return;
      expect(spec.options).toEqual(['fold', 'all-in']);
      // 정답 방향은 EV 부호로만 정해진다.
      expect(spec.correct).toEqual([facts.evPush > 0 ? 'all-in' : 'fold']);

      // 해설 문장의 숫자는 전부 facts에서 온 값과 같아야 한다 (계산이 바뀌면 문구도 같이 바뀌어야 한다).
      const text = instance.explanation.text;
      for (const value of [facts.callProbability, facts.pFoldAll, facts.equityIfCalled, Math.abs(facts.evPush)]) {
        expect(text, `${input.templateId}: ${value}`).toContain(String(value));
      }
      expect(instance.explanation.facts).toEqual({ ...facts });
    }
  }, 120_000);

  it('states the chip-EV assumptions and keeps every villain covering the hero', () => {
    for (const input of ACT4_PUSH_FOLD_INPUTS) {
      const instance = generateDrill(input.templateId, 5, { teacher: 'elena' });
      verifyShape(instance);
      const { situation } = instance;
      expect(situation.potChips).toBe(300);
      expect(situation.toCallChips).toBe(200);
      expect(situation.heroStackChips).toBe(1600);
      expect(situation.bigBlind).toBe(200);
      expect(situation.board).toHaveLength(0);
      for (const villain of situation.villains) expect(villain.stackChips).toBeGreaterThanOrEqual(1700);

      const note = situation.note ?? '';
      expect(note).toContain('칩 EV');
      expect(note).toContain('ICM 무시');
      expect(note).toContain('추가 콜 없음');
      expect(note).toContain('카드 정보는 무시');
      expect(instance.question).toContain('칩 EV');
      // "상위 X%" 표기는 캐시 임계와 혼동되므로 쓰지 않는다.
      expect(note).not.toContain('상위');
      expect(instance.explanation.text).not.toContain('상위');
      // 명시된 콜 레인지가 실제 파싱 가능한 표기로 상황 카드에 실려 있다.
      const ranged = situation.villains.filter(villain => villain.range !== undefined);
      expect(ranged.length).toBe(input.pots.length);
      for (const villain of ranged) {
        expect(villain.range).toBe(input.range);
        expect(parseRange(villain.range!).size).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the authored instance stable across seeds and teachers', () => {
    for (const id of AUTHORED_IDS) {
      const base = generateDrill(id, 0, { teacher: 'miyako' });
      const other = generateDrill(id, 77, { teacher: 'miyako' });
      expect({ ...other, seed: 0 }).toEqual(base);
      // 화자만 실행 시점 교사로 바뀌고 본문은 그대로다 (authored 계약).
      const swapped = generateDrill(id, 0, { teacher: 'vivian' });
      expect(swapped.explanation.speaker).toBe('vivian');
      expect(swapped.explanation.text).toBe(base.explanation.text);
    }
  });
});
