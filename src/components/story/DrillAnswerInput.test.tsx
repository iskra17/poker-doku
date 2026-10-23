import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import DrillAnswerInput from './DrillAnswerInput';

const spec = { kind: 'multiple-choice', options: ['UTG', 'BTN', 'SB', 'BB'] } as const;

function buttons(markup: string): string[] {
  return markup.split('<button').slice(1);
}

describe('DrillAnswerInput reveal tags', () => {
  it('marks only the correct tile and the chosen wrong tile', () => {
    const markup = renderToStaticMarkup(
      <DrillAnswerInput spec={{ ...spec, options: [...spec.options] }} value={{ kind: 'multiple-choice', index: 1 }} onChange={() => {}} disabled reveal={{ correctIndices: [0], chosenIndex: 1 }} />,
    );
    const [a, b, c, d] = buttons(markup);
    expect(a).toContain('>정답<');
    expect(b).toContain('>오답<');
    for (const other of [c, d]) {
      expect(other).not.toContain('>정답<');
      expect(other).not.toContain('>오답<');
    }
  });

  it('shows only the correct tag when the chosen answer is correct', () => {
    const markup = renderToStaticMarkup(
      <DrillAnswerInput spec={{ ...spec, options: [...spec.options] }} value={{ kind: 'multiple-choice', index: 0 }} onChange={() => {}} disabled reveal={{ correctIndices: [0], chosenIndex: 0 }} />,
    );
    expect(markup.match(/>정답</g)).toHaveLength(1);
    expect(markup).not.toContain('>오답<');
  });

  it('draws no tags before grading', () => {
    const markup = renderToStaticMarkup(
      <DrillAnswerInput spec={{ ...spec, options: [...spec.options] }} value={null} onChange={() => {}} />,
    );
    expect(markup).not.toContain('>정답<');
    expect(markup).not.toContain('>오답<');
  });
});
