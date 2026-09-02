import { describe, expect, it } from 'vitest';
import { CH01 } from './chapters/act1/ch01-dojo-gate';
import { CH03 } from './chapters/act1/ch03-numbers-dont-lie';
import { drillPerfectCutIn, liveMissionCutIn } from './story-cut-ins';
import type { Step } from './types';
import type { ObjectiveProgressView, StoryLiveView } from './views';

function sparringOf(chapter: typeof CH01): Extract<Step, { kind: 'sparring' }> {
  const step = chapter.steps.find(entry => entry.kind === 'sparring');
  if (!step || step.kind !== 'sparring') throw new Error('no sparring step');
  return step;
}

function objective(id: string, primary: boolean, achieved: boolean | null): ObjectiveProgressView {
  return { id, kind: 'win-hands', label: id, primary, progress: 0, target: 1, achieved };
}

function live(overrides: Partial<StoryLiveView>): StoryLiveView {
  return {
    roomId: 'room', tag: '대결', hold: false, holdReason: null, interruptId: null,
    objectives: [], handsPlayed: 0, maxHands: 12, minHands: 6, lastReview: null, botThoughts: [], pendingQuiz: null,
    ...overrides,
  };
}

describe('drillPerfectCutIn', () => {
  it('교사(파트너 참조 포함)의 퍼펙트 대사와 아트 id를 만든다 — 원어 용어 규칙', () => {
    const cut = drillPerfectCutIn('miyako', null, 3);
    expect(cut.kicker).toBe('PERFECT');
    expect(cut.artId).toBe('dealer');
    expect(cut.name).toBe('미야코');
    expect(cut.quote.length).toBeGreaterThan(0);
    const viaPartner = drillPerfectCutIn('partner', 'hana', 0);
    expect(viaPartner.artId).toBe('hana');
    const noPartner = drillPerfectCutIn('partner', null, 0);
    expect(noPartner.artId).toBe('dealer');
    for (const text of [cut.quote, viaPartner.quote]) {
      expect(text).not.toMatch(/접[어었]|판을|손을/);
    }
  });
});

describe('liveMissionCutIn', () => {
  const base = { teacher: 'hana' as const, partnerId: null, stepKey: 'run:5' };

  it('minHands 이후 primary 전부 달성이면 MISSION CLEAR, 보스 라인업이면 BOSS DEFEATED', () => {
    const ch01 = sparringOf(CH01);
    const clear = liveMissionCutIn({ ...base, teacher: 'miyako', step: ch01, live: live({ handsPlayed: 6, objectives: [objective('a', true, true), objective('b', true, true), objective('bonus', false, null)] }) });
    expect(clear?.kicker).toBe('MISSION CLEAR');
    expect(clear?.artId).toBe('dealer');
    expect(clear?.id).toBe('mission:run:5');

    const ch03 = sparringOf(CH03);
    expect(ch03.table.lineup.some(seat => seat.role === 'boss')).toBe(true);
    const boss = liveMissionCutIn({ ...base, step: ch03, live: live({ handsPlayed: 8, minHands: 8, objectives: [objective('a', true, true)] }) });
    expect(boss?.kicker).toMatch(/^BOSS DEFEATED · /);
    expect(boss?.quote).toContain('통계는 거짓말을 안 해요');
  });

  it('primary 미달·판정 불가·핸드 부족·연습 스텝·live 없음이면 null', () => {
    const step = sparringOf(CH01);
    expect(liveMissionCutIn({ ...base, step, live: live({ handsPlayed: 6, objectives: [objective('a', true, true), objective('b', true, false)] }) })).toBeNull();
    expect(liveMissionCutIn({ ...base, step, live: live({ handsPlayed: 6, objectives: [objective('a', true, null)] }) })).toBeNull();
    expect(liveMissionCutIn({ ...base, step, live: live({ handsPlayed: 3, objectives: [objective('a', true, true)] }) })).toBeNull();
    expect(liveMissionCutIn({ ...base, step, live: live({ handsPlayed: 6, objectives: [] }) })).toBeNull();
    const practice = CH01.steps.find(entry => entry.kind === 'practice-table');
    expect(liveMissionCutIn({ ...base, step: practice, live: live({ handsPlayed: 6, objectives: [objective('a', true, true)] }) })).toBeNull();
    expect(liveMissionCutIn({ ...base, step, live: null })).toBeNull();
  });

  it('minHands가 없으면 maxHands가 기준', () => {
    const step = sparringOf(CH01);
    expect(liveMissionCutIn({ ...base, step, live: live({ minHands: null, maxHands: 10, handsPlayed: 9, objectives: [objective('a', true, true)] }) })).toBeNull();
    expect(liveMissionCutIn({ ...base, step, live: live({ minHands: null, maxHands: 10, handsPlayed: 10, objectives: [objective('a', true, true)] }) })).not.toBeNull();
  });
});
