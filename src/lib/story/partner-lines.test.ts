import { describe, expect, it } from 'vitest';
import { validateChapters } from './chapters';
import { CH01 } from './chapters/act1/ch01-dojo-gate';
import { partnerVariants, resolveSayLine, resolveSceneForPartner } from './partner-lines';
import type { Chapter, Scene, SceneSayLine } from './types';

const LINE: SceneSayLine = {
  kind: 'say',
  speaker: 'partner',
  text: '기본 대사',
  expression: 'neutral',
  bg: 'dojo-table',
  byPartner: { ara: { text: '아라 대사', expression: 'confident' }, sakura: { text: '사쿠라 대사', speaker: 'narrator' } },
};

describe('resolveSayLine', () => {
  it('파트너 변주가 있으면 text·expression·speaker를 바꾸고 나머지(bg 등)는 유지한다', () => {
    expect(resolveSayLine(LINE, 'ara')).toEqual({ kind: 'say', speaker: 'partner', text: '아라 대사', expression: 'confident', bg: 'dojo-table' });
    expect(resolveSayLine(LINE, 'sakura')).toEqual({ kind: 'say', speaker: 'narrator', text: '사쿠라 대사', expression: 'neutral', bg: 'dojo-table' });
  });

  it('파트너가 없거나 그 파트너 변주가 없으면 기본 대사로 폴백한다', () => {
    const fallback = { kind: 'say', speaker: 'partner', text: '기본 대사', expression: 'neutral', bg: 'dojo-table' };
    expect(resolveSayLine(LINE, null)).toEqual(fallback);
    expect(resolveSayLine(LINE, 'hana')).toEqual(fallback);
  });
});

describe('resolveSceneForPartner', () => {
  const scene: Scene = {
    id: 's',
    lines: [
      LINE,
      {
        kind: 'choice',
        choice: {
          id: 'c',
          options: [
            { id: 'a', text: 'A', setFlags: { 'choice:s:c': 'a' }, reply: [{ ...LINE, text: '반응', byPartner: { ara: { text: '아라 반응' } } }] },
            { id: 'b', text: 'B' },
          ],
        },
      },
    ],
  };

  it('본문과 선택지 반응을 모두 해석하고 라인 수·선택지 id·플래그는 그대로 둔다', () => {
    const resolved = resolveSceneForPartner(scene, 'ara');
    expect(resolved.lines).toHaveLength(scene.lines.length);
    expect(resolved.lines[0]).toMatchObject({ text: '아라 대사' });
    const choice = resolved.lines[1];
    if (choice.kind !== 'choice') throw new Error('fixture');
    expect(choice.choice.options.map(option => option.id)).toEqual(['a', 'b']);
    expect(choice.choice.options[0].setFlags).toEqual({ 'choice:s:c': 'a' });
    expect(choice.choice.options[0].reply?.[0]).toMatchObject({ text: '아라 반응' });
    expect(choice.choice.options[0].reply?.[0]).not.toHaveProperty('byPartner');
  });

  it('변주가 없는 씬은 같은 객체를 돌려준다', () => {
    const plain: Scene = { id: 'p', lines: [{ kind: 'say', speaker: 'miyako', text: '안녕하세요♪' }] };
    expect(resolveSceneForPartner(plain, 'ara')).toBe(plain);
  });
});

describe('partnerVariants', () => {
  it('문자열은 text로, 객체는 그대로 쓴다', () => {
    const variants = partnerVariants({
      sakura: '사', ara: { text: '아', expression: 'happy' }, hana: '하', chloe: '클', vivian: '비', elena: '엘',
    });
    expect(variants.sakura).toEqual({ text: '사' });
    expect(variants.ara).toEqual({ text: '아', expression: 'happy' });
  });
});

describe('validateChapters — byPartner', () => {
  const withLine = (line: SceneSayLine): Chapter => ({
    ...CH01,
    steps: CH01.steps.map(step => (step.kind === 'scene' && step.id === 'act1-ch01:prologue'
      ? { ...step, scene: { ...step.scene, lines: [line] } }
      : step)),
  });

  it('히로인이 아닌 키·빈 변주 대사를 잡는다', () => {
    const errors = validateChapters([withLine({
      kind: 'say', speaker: 'partner', text: '기본',
      byPartner: { miyako: { text: '미야코' }, ara: { text: '  ' } } as SceneSayLine['byPartner'],
    })]);
    expect(errors.some(error => error.includes('non-heroine key miyako'))).toBe(true);
    expect(errors.some(error => error.includes('byPartner.ara has an empty line'))).toBe(true);
  });
});
