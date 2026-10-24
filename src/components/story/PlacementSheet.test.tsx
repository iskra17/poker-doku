import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import PlacementSheet from './PlacementSheet';

const input = vi.hoisted(() => ({ connected: true, questions: vi.fn(), submit: vi.fn(), selfReport: vi.fn(), check: vi.fn(), decline: vi.fn() }));
vi.mock('@/components/ui/Modal', () => ({ default: ({ children, title }: { children: ReactNode; title: string }) => <div role="dialog" aria-label={title}>{children}</div> }));
vi.mock('@/lib/store/story-store', () => ({
  useStoryStore: (select: (state: unknown) => unknown) => select({
    pending: false, fetchPlacementQuestions: input.questions, submitPlacement: input.submit, startChapter: vi.fn(),
    submitPlacementSelfReport: input.selfReport, submitPlacementCheck: input.check, declinePlacementCheck: input.decline,
  }),
}));
vi.mock('@/lib/store/game-store', () => ({ useGameStore: (select: (state: unknown) => unknown) => select({ connected: input.connected }) }));

beforeEach(() => {
  input.connected = true;
  for (const fn of [input.questions, input.submit, input.selfReport, input.check, input.decline]) fn.mockClear();
});

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

describe('PlacementSheet modes', () => {
  it('첫 수련은 자기 평가만 묻고 문제 없이 바로 수업을 연다고 알린다', () => {
    const markup = renderToStaticMarkup(<PlacementSheet mode="first-run" onClose={() => {}} />);
    for (const copy of ['첫 수련 준비', '포커를 얼마나 해 보셨어요?', '처음이에요', '규칙은 알아요', '자주 쳐요', '고르면 바로 첫 수업을 시작해요']) expect(markup).toContain(copy);
    expect(input.questions).not.toHaveBeenCalled();
    expect(input.selfReport).not.toHaveBeenCalled();
  });

  it('Ch1 뒤 체크는 자기 평가 없이 4문 초대와 거절·나중에 진입점을 보여 준다', () => {
    const markup = renderToStaticMarkup(<PlacementSheet mode="check" onClose={() => {}} />);
    for (const copy of ['다음 수업부터 빠르게 가기', '규칙을 이미 아신다면 4문만 풀고 다음 수업부터 빠르게 가요.', '4문 풀기', '괜찮아요, 지금처럼 갈게요', '나중에 할게요']) expect(markup).toContain(copy);
    expect(markup).not.toContain('포커를 얼마나 해 보셨어요?');
    expect(input.questions).not.toHaveBeenCalled();
    expect(input.decline).not.toHaveBeenCalled();
  });

  it('기본(허브 측정)은 기존 자기 평가 화면에 첫 수련 안내 문구를 싣지 않는다', () => {
    const markup = renderToStaticMarkup(<PlacementSheet onClose={() => {}} />);
    expect(markup).toContain('내 실력에 맞는 수련');
    expect(markup).not.toContain('고르면 바로 첫 수업을 시작해요');
  });
});
