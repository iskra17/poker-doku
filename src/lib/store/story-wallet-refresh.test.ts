import { describe, expect, it, vi } from 'vitest';
import type { StoryRunView } from '@/lib/story/views';
import { createStoryStore } from './story-store';
import { subscribeStoryWalletRefresh } from './story-wallet-refresh';

function settled(runId = 'chapter-run', chips = 800): StoryRunView {
  return {
    runId,chapterId:'act2-ch06',mode:'full',stepIndex:6,stepCount:7,stepKind:'scene',phase:'ended',
    context:{partnerId:'ara',teacherId:'ara'},drill:null,live:null,startedAt:1,updatedAt:2,
    result:{
      chapterId:'act2-ch06',mode:'full',passed:true,grade:'S',
      drill:{answered:3,correct:3,bestStreak:3,hintsUsed:0,score:1,slots:3,finalCorrect:3,perfect:true,retrySkipped:false},
      live:null,rewards:{firstClear:true,dojoXpMilli:0,affinity:[],badgeId:null,chips},
      reviewNotesAdded:0,nextChapterId:null,beltAwarded:null,
    },
  };
}

function setup() {
  const story = createStoryStore({fetch:vi.fn().mockResolvedValue(new Response('{}',{status:401}))});
  story.getState().setProfileIdentity('p1');
  const refresh = vi.fn().mockResolvedValue(undefined);
  let identity = 'p1';
  const profile = {getState:() => ({
    phase:'ready' as const,
    profile:{id:identity,alias:'hero',avatarId:'ara',wallet:{balance:10000,activeEscrow:0}},
    refresh,
  })};
  const unsubscribe = subscribeStoryWalletRefresh(story,profile);
  return {story,refresh,unsubscribe,setIdentity:(id:string) => { identity=id; }};
}

describe('story wallet settlement subscription', () => {
  it('refreshes chapter and daily chip settlements once even across resync and dismissal', () => {
    const {story,refresh,unsubscribe} = setup();
    const result = settled();
    story.getState().receiveRun(result);
    expect(refresh).toHaveBeenCalledExactlyOnceWith({afterCurrent:true});
    story.getState().receiveRun({...result,updatedAt:3});
    story.getState().dismissRun();
    story.getState().receiveRun(result);
    expect(refresh).toHaveBeenCalledTimes(1);
    const daily = settled('daily-run',100);
    daily.chapterId = 'daily';
    daily.result!.chapterId = 'daily';
    story.getState().receiveRun(daily);
    expect(refresh).toHaveBeenCalledTimes(2);
    unsubscribe();
    story.getState().receiveRun(settled('after-unsubscribe'));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('ignores live views, zero chips, failed results and explicit abandonment', () => {
    const {story,refresh,unsubscribe} = setup();
    story.getState().receiveRun({...settled(),phase:'scene'});
    story.getState().receiveRun(settled('zero',0));
    const failed = settled('failed');
    failed.result!.passed = false;
    story.getState().receiveRun(failed);
    story.getState().receiveRun({...settled('abandoned'),result:null});
    expect(refresh).not.toHaveBeenCalled();
    unsubscribe();
  });

  it('requires matching profile identity and resets deduplication on account changes', () => {
    const {story,refresh,unsubscribe,setIdentity} = setup();
    setIdentity('p2');
    story.getState().receiveRun(settled());
    expect(refresh).not.toHaveBeenCalled();
    story.getState().setProfileIdentity('p2');
    story.getState().receiveRun(settled());
    expect(refresh).toHaveBeenCalledTimes(1);
    setIdentity('p3');
    story.getState().setProfileIdentity('p3');
    story.getState().receiveRun(settled());
    expect(refresh).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
