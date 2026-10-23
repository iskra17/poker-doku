import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { HAND_RANK_KO } from '@/lib/poker/evaluator';
import { generateDrill } from '@/lib/story/drills/generator';
import { toPublicDrillInstance } from '@/lib/story/drills/public';
import DrillTable from './DrillTable';

const CTX = { teacher: 'miyako' } as const;

/** 채점 전 렌더 — 정답을 계산하거나 그리지 않는다 (판단 재생은 result가 있을 때만) */
describe('DrillTable before grading', () => {
  it('draws the pos-name table with hidden labels, the dealer button and seat numbers only', () => {
    for (const seed of [1, 2, 3]) {
      const instance = toPublicDrillInstance(generateDrill('pos-name', seed, CTX));
      const markup = renderToStaticMarkup(
        <DrillTable situation={instance.situation} replayKey={`k${seed}`} category={instance.category} templateId={instance.templateId} />,
      );
      expect(markup).toContain('딜러 버튼');
      expect(markup).toContain('번</span>');
      for (const label of ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO']) expect(markup).not.toMatch(new RegExp(`>${label}<`));
      expect(markup).not.toContain('정답');
    }
  });

  it('does not show hand names or a winner for rank-who-wins', () => {
    const instance = toPublicDrillInstance(generateDrill('rank-who-wins', 3, CTX));
    const markup = renderToStaticMarkup(
      <DrillTable situation={instance.situation} replayKey="who" category={instance.category} templateId={instance.templateId} />,
    );
    for (const name of Object.values(HAND_RANK_KO)) expect(markup).not.toContain(`>${name}`);
    expect(markup).not.toContain('승리');
    expect(markup).not.toContain('정답');
  });
});
