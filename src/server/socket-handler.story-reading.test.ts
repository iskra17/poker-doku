import { afterEach, describe, expect, it, vi } from 'vitest';
import { setImmediate } from 'node:timers';
import type { RealtimeAck } from '../lib/realtime/protocol';
import { generateDrill, gradeDrill } from '../lib/story/drills/generator';
import type { DrillAnswer, DrillAnswerSpec } from '../lib/story/drills/types';
import type { StoryTeacherId } from '../lib/story/types';
import type { StoryRunView } from '../lib/story/views';
import { CH08 } from '../lib/story/chapters/act3/ch08-curious-call';
import { CH09 } from '../lib/story/chapters/act3/ch09-shadows-and-traps';
import { createSocketTestHarness } from './socket-test-harness';
import type { ConnectedTestClient, SocketTestHarness } from './socket-test-harness';
function withAck<T>(
  send: (done: (ack: RealtimeAck<T>) => void) => void,
): Promise<RealtimeAck<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('ack timeout')), 1_000);
    send(ack => {
      clearTimeout(timer);
      resolve(ack);
    });
  });
}

function collect<T>(client: ConnectedTestClient, event: 'story-update' | 'room-lost' | 'progression-update'): T[] {
  const items: T[] = [];
  (client.socket as unknown as { on: (name: string, cb: (payload: T) => void) => void }).on(event, payload => {
    items.push(payload);
  });
  return items;
}



/** 서버가 재생성할 인스턴스와 같은 seed로 정답을 만든다 (story-run-coordinator.test.ts와 같은 규약) */
function answerFor(templateId: string, seed: number, teacher: StoryTeacherId): DrillAnswer {
  const instance = generateDrill(templateId, seed, { teacher });
  const spec: DrillAnswerSpec = instance.answerSpec;
  let answer: DrillAnswer;
  switch (spec.kind) {
    case 'multiple-choice':
      answer = { kind: 'multiple-choice', index: spec.correctIndex };
      break;
    case 'numeric':
      answer = { kind: 'numeric', value: spec.correct };
      break;
    case 'action-pick':
      answer = { kind: 'action-pick', action: spec.correct[0], sizingBB: spec.sizingBB?.min };
      break;
    case 'card-pick':
      answer = { kind: 'card-pick', cards: spec.correct };
      break;
    case 'multi-select':
      answer = { kind: 'multi-select', indices: spec.correctIndices };
      break;
  }
  expect(gradeDrill(instance, answer)).toBe(true);
  return answer;
}



describe('Ch8/9 실제 소켓 경로', () => {
 let harness:SocketTestHarness|null=null;
 afterEach(async()=>{vi.useRealTimers();await harness?.close();harness=null;});
 it.each(['answer','timeout','disconnect','roomloss'] as const)('실제 리버 딜·액션의 턴 보류 수명주기: %s',async mode=>{
  const practice=CH08.steps.find(s=>s.kind==='practice-table')!;
  if(practice.kind!=='practice-table')throw new Error('practice');
  harness=await createSocketTestHarness({storyChapters:[{...CH08,requires:[],steps:[{...practice,table:{...practice.table,reading:{id:'river-reading-v1',maxQuestions:2}},scripts:Array.from({length:3},()=>({hero:'Ah Ad',board:'As Kd 7c 4h 2s',villains:{1:'Kh Qd'}}))},{kind:'result',id:'end'}]}]});
  const h=harness;const profile=await h.createProfile();let client=await h.connect('reading-owner',{profileCookie:profile.cookie});
  const stranger=await h.connect('reading-stranger');const updates=collect<StoryRunView>(client,'story-update');
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout','setInterval','clearInterval','Date']});
  const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));
  const tick=async(ms=50)=>{for(const c of [client,stranger])if(c.socket.connected)(c.socket.io.engine as unknown as {_resetPingTimeout:()=>void})._resetPingTimeout();await vi.advanceTimersByTimeAsync(ms);await flush();await flush();};
  expect(await withAck(done=>client.socket.emit('start-story-chapter',{chapterId:CH08.id},done))).toMatchObject({ok:true});await tick();
  const drive=async()=>{for(let i=0;i<350&&!updates.at(-1)?.live?.pendingQuiz;i++){
   const live=updates.at(-1)!.live!;const room=live?.roomId?h.runtime.roomManager.getRoom(live.roomId):null;const s=room?.engine.state;const actor=s?.players[s.activePlayerIndex];
   if(actor&&s?.isHandInProgress&&!live.hold){
    const action=s.street==='river'&&actor.type==='bot'&&s.currentBet===0?'raise':s.currentBet>actor.currentBet?'call':'check';
    expect(h.runtime.roomManager.processPlayerAction(live.roomId!,actor.id,action,action==='raise'?20:0)).toBe(true);
   }
   await tick();
  }expect(updates.at(-1)?.live?.pendingQuiz).toBeTruthy();};
  await drive();const initial=updates.at(-1)!;const roomId=initial.live!.roomId!;const q=initial.live!.pendingQuiz!;
  const s=h.runtime.roomManager.getRoom(roomId)!.engine.state;const seq=s.actionSeq;
  const action={roomId,action:'call',expectedHandNumber:s.handNumber,expectedActionSeq:seq};
  expect(await withAck(done=>client.socket.emit('player-action',action,done))).toMatchObject({ok:false});
  expect(await withAck(done=>client.socket.emit('use-time-bank',done))).toMatchObject({ok:false});
  expect(await withAck(done=>stranger.socket.emit('story-quiz',{runId:initial.runId,quizId:q.quizId,optionIndex:0},done))).toMatchObject({ok:false});
  const publicState=h.runtime.roomManager.getRoom(roomId)!.engine.getPublicState(client.playerId);
  expect(publicState.players.filter(p=>p.type==='bot').every(p=>!p.revealed && p.holeCards.every(c=>c.rank==='2'&&c.suit==='spades'))).toBe(true);
  expect(JSON.stringify(q)).not.toMatch(/correct|explanation/);
  expect(await withAck(done=>client.socket.emit('resync',done))).toEqual({ok:true});await tick();
  expect(updates.at(-1)!.live!.pendingQuiz).toMatchObject({quizId:q.quizId,expiresAt:q.expiresAt});
  if(mode==='answer'){
   const previous=client;client=await h.connect('reading-owner',{profileCookie:profile.cookie});client.socket.on('story-update',v=>updates.push(v));
   await withAck(done=>client.socket.emit('resync',done));await tick();expect(previous.socket.connected).toBe(false);
   expect(updates.at(-1)!.live!.pendingQuiz).toMatchObject({quizId:q.quizId,expiresAt:q.expiresAt});
   const receipt=await withAck(done=>client.socket.emit('story-quiz',{runId:initial.runId,quizId:q.quizId,optionIndex:0},done));
   expect(receipt).toEqual({ok:true,data:{quizId:q.quizId,accepted:true}});
   expect(await withAck(done=>client.socket.emit('story-quiz',{runId:initial.runId,quizId:q.quizId,optionIndex:1},done))).toEqual(receipt);await tick();
   expect(updates.at(-1)!.live!.reading).toMatchObject({phase:'feedback',answered:1,correct:1});expect(s.actionSeq).toBe(seq);
   expect(await withAck(done=>client.socket.emit('story-advance',{runId:initial.runId,expectedStepIndex:initial.stepIndex,target:'resume'},done))).toEqual({ok:true});await tick();
   expect(s.actionSeq).toBe(seq);expect(await withAck(done=>client.socket.emit('player-action',action,done))).toMatchObject({ok:true});
   await drive();const second=updates.at(-1)!.live!.pendingQuiz!;expect(second.number).toBe(2);expect(second.quizId).not.toBe(q.quizId);expect(updates.at(-1)!.live!.reading).toMatchObject({answered:1,correct:1});
   expect(await withAck(done=>client.socket.emit('story-quiz',{runId:initial.runId,quizId:second.quizId,optionIndex:0},done))).toEqual({ok:true,data:{quizId:second.quizId,accepted:true}});
  }else if(mode==='timeout'){
   await tick(30_000);expect(updates.at(-1)!.live!.reading).toMatchObject({phase:'feedback',answered:1,correct:0});expect(s.actionSeq).toBe(seq);
   await tick(10_000);expect(updates.at(-1)!.live!.hold).toBe(false);expect(s.actionSeq).toBe(seq);
  }else if(mode==='disconnect'){
   client.socket.disconnect();await flush();await flush();await tick();
   expect(s.actionSeq).toBeGreaterThan(seq);
   client=await h.connect('reading-owner',{profileCookie:profile.cookie});client.socket.on('story-update',v=>updates.push(v));await withAck(done=>client.socket.emit('resync',done));await tick();
   expect(updates.at(-1)!.live!.pendingQuiz).toBeNull();expect(updates.at(-1)!.live!.reading).toBeUndefined();
   expect(await withAck(done=>client.socket.emit('story-quiz',{runId:initial.runId,quizId:q.quizId,optionIndex:0},done))).toMatchObject({ok:false});
  }else{
   h.runtime.roomManager.disposeRoom(roomId,'idle');await tick();
   expect(updates.at(-1)!.live!.roomId).toBeNull();expect(updates.at(-1)!.live!.pendingQuiz).toBeNull();
   expect(await withAck(done=>client.socket.emit('story-advance',{runId:initial.runId,expectedStepIndex:initial.stepIndex,target:'resume'},done))).toEqual({ok:true});await tick();
   expect(updates.at(-1)!.live!.roomId).not.toBe(roomId);expect(updates.at(-1)!.live!.pendingQuiz).toBeNull();
  }
 },20_000);
 it.each([[CH08,'full'],[CH08,'exam'],[CH09,'full'],[CH09,'exam'],[CH08,'failure'],[CH09,'failure']] as const)('%s %s 전체 드릴·스텝·결산',async(chapter,mode)=>{
  harness=await createSocketTestHarness({storyChapters:[{...chapter,requires:[]}]});const h=harness;const profile=await h.createProfile();const client=await h.connect('chapter-owner',{profileCookie:profile.cookie});const updates=collect<StoryRunView>(client,'story-update');
  vi.useFakeTimers({toFake:['setTimeout','clearTimeout','setInterval','clearInterval','Date']});
  const flush=()=>new Promise<void>(resolve=>setImmediate(resolve));const tick=async(ms=500)=>{(client.socket.io.engine as unknown as {_resetPingTimeout:()=>void})._resetPingTimeout();await vi.advanceTimersByTimeAsync(ms);await flush();await flush();};
  expect(await withAck(done=>client.socket.emit('start-story-chapter',{chapterId:chapter.id,mode:mode==='failure'?'full':mode},done))).toMatchObject({ok:true});await tick();
  let failureRoom: string|null=null;let failedStep=-1;let answers=0;const visited=new Set<number>();let lastHands=0;
  for(let n=0;n<500&&updates.at(-1)?.phase!=='ended';n++){
   const v=updates.at(-1)!;visited.add(v.stepIndex);
   if(v.drill&&!v.drill.lastResult){const d=v.drill;expect(await withAck(done=>client.socket.emit('story-drill',{runId:v.runId,setId:d.setId,index:d.index,action:'answer',answer:answerFor(d.instance.templateId,d.instance.seed,v.context.teacherId),elapsedMs:900},done))).toMatchObject({ok:true});answers++;}
   else if(v.live){
    if(mode==='failure'&&v.live.tag==='대결'&&!failureRoom){
      // Fault injection at a real chapter's sparring boundary; not a normal gameplay pass.
      failureRoom=v.live.roomId!;failedStep=v.stepIndex;h.runtime.roomManager.getRoom(failureRoom)!.engine.state.players.find(p=>p.id===client.playerId)!.chips=0;
    }
    lastHands=Math.max(lastHands,v.live.handsPlayed);if(v.live.hold){expect(await withAck(done=>client.socket.emit('story-advance',{runId:v.runId,expectedStepIndex:v.stepIndex,target:'resume'},done))).toMatchObject({ok:true});}
    else {const room=v.live.roomId?h.runtime.roomManager.getRoom(v.live.roomId):null;const s=room?.engine.state;const actor=s?.players[s.activePlayerIndex];if(actor)h.runtime.roomManager.processPlayerAction(v.live.roomId!,actor.id,'fold');}}
   else expect(await withAck(done=>client.socket.emit('story-advance',{runId:v.runId,expectedStepIndex:v.stepIndex},done))).toMatchObject({ok:true});
   await tick();
  }
  expect(answers).toBe(chapter===CH08?7:8);expect(updates.at(-1)?.phase).toBe('ended');expect(updates.at(-1)!.result).toMatchObject({passed:mode!=='failure',mode:mode==='failure'?'full':mode});
  if(mode==='failure'){
    const terminal=updates.at(-1)!;expect(terminal.result!.rewards.dojoXpMilli).toBe(0);
    const retry=await withAck(done=>client.socket.emit('retry-story-sparring',{failedRunId:terminal.runId},done));expect(retry.ok).toBe(true);await tick();
    const fresh=updates.at(-1)!;expect(fresh.runId).not.toBe(terminal.runId);expect(fresh.stepIndex).toBe(failedStep);expect(fresh.live!.roomId).not.toBe(failureRoom);expect(fresh.live!.handsPlayed).toBe(0);expect(fresh.live!.pendingQuiz).toBeNull();
    expect(await withAck(done=>client.socket.emit('retry-story-sparring',{failedRunId:terminal.runId},done))).toEqual(retry);
   }else expect(updates.at(-1)!.result!.rewards.dojoXpMilli).toBeGreaterThanOrEqual(chapter===CH08?250_000:300_000);
  if(mode==='full'){expect(visited.size).toBe(chapter.steps.length);expect(lastHands).toBeGreaterThanOrEqual(chapter===CH08?11:14);}
 },30_000);
});
