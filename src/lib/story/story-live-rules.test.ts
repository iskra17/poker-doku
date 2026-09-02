import { describe, expect, it } from 'vitest';
import {
  asLiveStep,
  firstMyTurnInterrupt,
  holdCopy,
  isStoryLiveRoom,
  liveHintLevel,
  needsResumeFromLobby,
  objectiveHudLines,
  pendingInterrupt,
  practicePrompt,
  reviewMarkGlyph,
} from './story-live-rules';
import type { Interrupt, Step } from './types';
import type { ObjectiveProgressView, StoryLiveView, StoryRunView } from './views';

function liveFixture(overrides: Partial<StoryLiveView> = {}): StoryLiveView {
  return {
    roomId: 'story-room-1',
    tag: '대결',
    hold: false,
    holdReason: null,
    interruptId: null,
    objectives: [],
    handsPlayed: 0,
    maxHands: 10,
    minHands: null,
    lastReview: null,
    botThoughts: [],
    pendingQuiz: null,
    ...overrides,
  };
}

function runFixture(overrides: Partial<StoryRunView> = {}): StoryRunView {
  return {
    runId: 'run-1',
    chapterId: 'act1-ch01',
    mode: 'full',
    stepIndex: 4,
    stepCount: 7,
    stepKind: 'sparring',
    phase: 'live-play',
    context: { partnerId: 'sakura', teacherId: 'miyako' },
    drill: null,
    live: liveFixture(),
    result: null,
    startedAt: 0,
    updatedAt: 0,
    ...overrides,
  };
}

function objective(overrides: Partial<ObjectiveProgressView> = {}): ObjectiveProgressView {
  return {
    id: 'obj',
    kind: 'hands-played',
    label: '10핸드 완주하기',
    primary: true,
    progress: 3,
    target: 10,
    achieved: false,
    ...overrides,
  };
}

const INTERRUPT_TURN: Interrupt = {
  id: 'int-turn',
  trigger: { kind: 'first-my-turn' },
  scene: { id: 'int-turn', lines: [{ kind: 'say', speaker: 'miyako', text: '차례예요♪' }] },
};

const INTERRUPT_SHOWDOWN: Interrupt = {
  id: 'int-showdown',
  trigger: { kind: 'first-showdown' },
  scene: { id: 'int-showdown', lines: [{ kind: 'say', speaker: 'miyako', text: '쇼다운이에요♪' }] },
};

const SPARRING_STEP: Step = {
  kind: 'sparring',
  id: 'act1-ch01:sparring',
  tag: '대결',
  table: {
    blinds: { small: 10, big: 20 },
    heroSeat: 0,
    heroStackBB: 100,
    lineup: [{ seatIndex: 1, characterId: 'partner', stackBB: 100 }],
    difficulty: 'easy',
    turnTimeSec: 90,
    botThinkScale: 0.6,
    hints: 2,
  },
  maxHands: 10,
  objectives: { primary: [], bonus: [] },
  interrupts: [INTERRUPT_TURN, INTERRUPT_SHOWDOWN],
};

const PRACTICE_STEP: Step = {
  kind: 'practice-table',
  id: 'act1-ch01:practice',
  tag: '연습',
  table: {
    blinds: { small: 10, big: 20 },
    heroSeat: 0,
    heroStackBB: 100,
    lineup: [{ seatIndex: 1, characterId: 'partner', stackBB: 100 }],
    difficulty: 'easy',
    turnTimeSec: 90,
    botThinkScale: 0.6,
    hints: 1,
  },
  scripts: [{ hero: 'As Ks' }],
  perHandPrompt: '이건 연습이에요♪',
};

const DRILL_STEP: Step = {
  kind: 'drill-set',
  id: 'act1-ch01:drills',
  title: '수련 문제',
  teacher: 'miyako',
  drills: [{ templateId: 'pot-odds', seedPolicy: 'per-run' }],
  hintPenalty: 0.5,
};

describe('isStoryLiveRoom', () => {
  it('런의 라이브 방과 지금 앉은 방이 같을 때만 인룸이다', () => {
    const run = runFixture();
    expect(isStoryLiveRoom(run, 'story-room-1')).toBe(true);
    expect(isStoryLiveRoom(run, 'cash-room-9')).toBe(false);
    expect(isStoryLiveRoom(run, null)).toBe(false);
  });

  it('런이 없거나 라이브가 아니면(방 없는 씬·드릴 단계) false', () => {
    expect(isStoryLiveRoom(null, 'story-room-1')).toBe(false);
    expect(isStoryLiveRoom(runFixture({ live: null }), 'story-room-1')).toBe(false);
    expect(isStoryLiveRoom(runFixture({ live: liveFixture({ roomId: null }) }), 'story-room-1')).toBe(false);
  });
});

describe('스텝 좁히기', () => {
  it('라이브 스텝만 통과시킨다', () => {
    expect(asLiveStep(SPARRING_STEP)?.kind).toBe('sparring');
    expect(asLiveStep(PRACTICE_STEP)?.kind).toBe('practice-table');
    expect(asLiveStep(DRILL_STEP)).toBeNull();
    expect(asLiveStep(undefined)).toBeNull();
  });

  it('힌트 레벨과 연습 안내 문구를 스텝에서 읽는다', () => {
    expect(liveHintLevel(SPARRING_STEP)).toBe(2);
    expect(liveHintLevel(PRACTICE_STEP)).toBe(1);
    expect(liveHintLevel(DRILL_STEP)).toBe(0);
    expect(liveHintLevel(null)).toBe(0);

    expect(practicePrompt(PRACTICE_STEP)).toBe('이건 연습이에요♪');
    expect(practicePrompt(SPARRING_STEP)).toBeNull();
    expect(practicePrompt(null)).toBeNull();
  });
});

describe('인터럽트 조회', () => {
  it('서버가 지목한 id로만 hold 인터럽트를 찾는다', () => {
    const live = liveFixture({ hold: true, holdReason: 'scene', interruptId: 'int-showdown' });
    expect(pendingInterrupt(SPARRING_STEP, live)?.id).toBe('int-showdown');
    expect(pendingInterrupt(SPARRING_STEP, liveFixture())).toBeNull();
    expect(pendingInterrupt(SPARRING_STEP, liveFixture({ interruptId: 'unknown' }))).toBeNull();
    expect(pendingInterrupt(PRACTICE_STEP, live)).toBeNull();
    expect(pendingInterrupt(null, live)).toBeNull();
  });

  it('first-my-turn 인터럽트는 트리거 종류로 찾는다 (서버 hold 없음)', () => {
    expect(firstMyTurnInterrupt(SPARRING_STEP)?.id).toBe('int-turn');
    expect(firstMyTurnInterrupt(PRACTICE_STEP)).toBeNull();
    expect(firstMyTurnInterrupt(undefined)).toBeNull();
  });
});

describe('objectiveHudLines', () => {
  it('primary 목표를 먼저 놓고 각 그룹 안에서는 서버 순서를 유지한다', () => {
    const live = liveFixture({
      objectives: [
        objective({ id: 'bonus-a', primary: false, label: '팟 하나 가져오기' }),
        objective({ id: 'primary-a', primary: true }),
        objective({ id: 'bonus-b', primary: false, label: '파산 없이 끝내기', target: null, achieved: null }),
        objective({ id: 'primary-b', primary: true, label: '정크 핸드 폴드' }),
      ],
    });
    expect(objectiveHudLines(live).map(line => line.id)).toEqual([
      'primary-a', 'primary-b', 'bonus-a', 'bonus-b',
    ]);
  });

  it('진행/목표/달성 필드를 그대로 옮기고, 라이브가 없으면 빈 목록', () => {
    const live = liveFixture({ objectives: [objective({ progress: 7, target: 10, achieved: null })] });
    expect(objectiveHudLines(live)[0]).toEqual({
      id: 'obj', label: '10핸드 완주하기', progress: 7, target: 10, achieved: null, primary: true,
    });
    expect(objectiveHudLines(null)).toEqual([]);
  });
});

describe('표시 문구', () => {
  it('결정 리뷰 아이콘은 판정 3종에 1:1 대응한다', () => {
    expect(reviewMarkGlyph('good')).toBe('👍');
    expect(reviewMarkGlyph('hmm')).toBe('🤔');
    expect(reviewMarkGlyph('warn')).toBe('⚠');
  });

  it('hold 사유별 안내 문구를 준다', () => {
    expect(holdCopy('timeout').title).toContain('시간이 지나');
    expect(holdCopy('timeout').cta).toBe('계속하기');
    expect(holdCopy('room-lost').title).toContain('연결이 끊겨');
    expect(holdCopy('room-lost').body).toContain('같은 자리에서 다시 시작');
    expect(holdCopy('room-lost').cta).toBe('이어하기');
    expect(holdCopy('scene').cta).toBe('계속하기');
    expect(holdCopy(null).title).toBe('테이블 준비 중');
  });
});

describe('needsResumeFromLobby', () => {
  it('방이 사라진 hold는 [이어하기]가 필요하다', () => {
    const run = runFixture({
      phase: 'live-hold',
      live: liveFixture({ roomId: null, hold: true, holdReason: 'room-lost' }),
    });
    expect(needsResumeFromLobby(run)).toBe(true);
  });

  it('착석 대기(live-play·roomId 없음)는 버튼 없이 안내만', () => {
    const run = runFixture({ phase: 'live-play', live: liveFixture({ roomId: null }) });
    expect(needsResumeFromLobby(run)).toBe(false);
  });

  it('이미 방에 앉았거나 런이 없으면 false', () => {
    expect(needsResumeFromLobby(runFixture({ phase: 'live-hold' }))).toBe(false);
    expect(needsResumeFromLobby(null)).toBe(false);
  });
});
