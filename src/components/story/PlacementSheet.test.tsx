import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import PlacementSheet from './PlacementSheet';

const input = vi.hoisted(() => ({ connected: true, questions: vi.fn(), submit: vi.fn() }));
vi.mock('@/components/ui/Modal', () => ({ default: ({ children, title }: { children: ReactNode; title: string }) => <div role="dialog" aria-label={title}>{children}</div> }));
vi.mock('@/lib/store/story-store', () => ({
  useStoryStore: (select: (state: unknown) => unknown) => select({
    pending: false, fetchPlacementQuestions: input.questions, submitPlacement: input.submit, startChapter: vi.fn(),
  }),
}));
vi.mock('@/lib/store/game-store', () => ({ useGameStore: (select: (state: unknown) => unknown) => select({ connected: input.connected }) }));

beforeEach(() => { input.connected = true; input.questions.mockClear(); input.submit.mockClear(); });

describe('PlacementSheet initial screen', () => {
  it('서버 요청 없이 자기 평가 세 가지와 저장하지 않는 닫기 진입점을 보여 준다', () => {
    const markup = renderToStaticMarkup(<PlacementSheet onClose={() => {}} />);
    for (const copy of ['포커를 얼마나 해 보셨어요?', '처음이에요', '규칙은 알아요', '자주 쳐요', '나중에 할게요']) expect(markup).toContain(copy);
    expect(markup).not.toContain('disabled=""');
    expect(input.questions).not.toHaveBeenCalled();
    expect(input.submit).not.toHaveBeenCalled();
  });

  it('오프라인에서는 자기 평가 입력을 잠그고 나중에 할게요는 유지한다', () => {
    input.connected = false;
    const markup = renderToStaticMarkup(<PlacementSheet onClose={() => {}} />);
    expect(markup.match(/disabled=""/g)).toHaveLength(3);
    expect(markup).toContain('서버와 다시 연결되면 계속할 수 있어요.');
    expect(markup).toContain('나중에 할게요');
  });
});
