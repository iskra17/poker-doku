import type { Chapter, LiveTableSpec, Scene } from '../../types';
import { STORY_CURRICULUM } from '../../curriculum';
const scene=(id:string,lines:string[],cg?:string):Scene=>({id,lines:lines.map((text,index)=>({kind:'say',speaker:'elena',expression:'neutral',text,...(index===0&&cg?{cg}: {})}))});
const table=(characters:string[]):LiveTableSpec=>({blinds:{small:10,big:20},heroSeat:0,heroStackBB:100,lineup:characters.map((characterId,index)=>({seatIndex:index+1,characterId,stackBB:100,...(characterId==='luna'?{role:'boss' as const}: {})})),difficulty:'normal',turnTimeSec:60,botThinkScale:0.6,hints:3});
export const CH09:Chapter={
 id:'act3-ch09',act:3,order:3,title:'그림자와 함정',subtitle:'레인지 좁히기 · 블로커 · 넛츠',teacher:'elena',belt:'blue',requires:[...STORY_CURRICULUM[2]],estimatedMinutes:20,
 steps:[
  {kind:'scene',id:'ch09-intro',scene:scene('ch09-intro',[
   '…앉아. 창가보다 카드가 잘 보이는 자리야. 오늘은 얼굴을 읽지 않아.',
   '체크 한 번, 레이즈 한 번. 말이 없다고 정보가 없는 건 아니야. 다만 우리가 붙인 의미가 가정이라는 걸 잊지 마.',
   '루나는 기다려. 네가 먼저 넣은 칩을 보고 움직이지. 모든 체크가 함정은 아니고, 모든 함정에 들어갈 필요도 없어.',
   '…천천히 해. 네가 생각하는 동안에는 나도 여기 있을게.',
  ],'act3-ch09-lesson')},
  {kind:'lesson',id:'ch09-lesson',title:'가능한 패를 하나씩 지우기',blocks:[
   {kind:'concept-card',title:'행동은 가정을 좁히는 단서',body:'상대가 어떤 패로 그 행동을 한다고 가정했는지 먼저 적어. 그 가정 안에서 남는 밸류와 블러프를 세어. 실제 패를 하나로 단정하지 않아.'},
   {kind:'concept-card',title:'블로커 두 장과 페어 보드',body:'보드와 내 카드가 막는 조합을 모두 빼. 포켓 페어, 수딧, 오프수트의 기본 조합 수도 달라. 이미 지운 카드를 한 번 더 지우지는 않아.'},
   {kind:'concept-card',title:'현재 넛츠',body:'지금 공개된 보드와 알려진 내 카드를 기준으로 가능한 상대의 최고 다섯 장을 비교해. 페어 보드에는 풀하우스와 포카드도 있어. 후보가 같은 최고값이면 유일한 정답 문제가 아니야.'},
   {kind:'concept-card',title:'진짜 체크레이즈의 순서',body:'같은 스트리트에서 루나가 체크 → 내가 벳 → 루나가 레이즈해야 체크레이즈야. 이전 스트리트의 체크를 끌어와 판단하지 않아.'},
   {kind:'concept-card',title:'약한 원페어만 평가',body:'이번 실전의 폴드 기회는 톱페어 미만 원페어야. 루나의 체크레이즈에 폴드 70% 이상, 잘못 대응 2회 이하. 톱페어·오버페어와 세트 이상의 강한 메이드는 무조건 폴드시키지 않고 별도 판단해.'},
   {kind:'concept-card',title:'기회가 없었던 수련',body:'실제로 해당 상황이 없으면 미측정으로 남겨. 드릴과 두 연습을 마친 사실, 실전에서 관찰한 기회는 따로 보여 줘. 카드가 주지 않은 기회를 실패로 세지 않아.'},
  ]},
  {kind:'drill-set',id:'ch09-drills',title:'그림자에 남은 조합',teacher:'elena',hintPenalty:0.5,drills:[
   ...['read-value-combos','read-bluff-combos','read-removed-combos','combo-blockers','combo-paired-board','nuts-unique-combo','nuts-blocked-combo','act-ch09-checkraise-fold'].map(templateId=>({templateId,seedPolicy:'per-run' as const})),
  ]},
  {kind:'scene',id:'ch09-analysis',scene:scene('ch09-analysis',[
   '문제지는 여기까지. 이제 테이블로 옮겨. 칩을 놓고 네가 어떤 순서로 생각하는지 볼게.',
   '첫 연습은 루나, 다음은 사쿠라. 프리셋은 카드만 정해져 있어. 공격이 예상과 다르면 실제 액션과 가격을 다시 읽어.',
   '…정답을 기다리는 표정보다, 네 이유를 말하는 얼굴이 좋아.',
  ],'act3-ch09-analysis')},
  {kind:'practice-table',id:'ch09-luna-practice',tag:'연습',table:table(['luna']),scripts:[{hero:'9h 8s',villains:{1:'Kh Ks'},board:'Kc 9d 7s 4h 2c'}],perHandPrompt:'루나의 체크 뒤 벳했다가 같은 스트리트 레이즈를 맞으면 약한 원페어로 버티지 말자. 체크가 없었다면 체크레이즈라고 부르지 않아. 강한 패는 별도로 판단해.'},
  {kind:'practice-table',id:'ch09-sakura-practice',tag:'연습',table:table(['sakura']),scripts:[{hero:'Ad Tc',villains:{1:'Ks Kc'},board:'Kh 9d 7s 4h 2c'}],perHandPrompt:'사쿠라가 리레이즈하면 내 오픈 이유와 콜할 이유를 나눠 봐. ATo로 큰 팟을 고집하지 말고, 실제 공개 액션과 가격을 확인한 뒤 폴드해.'},
  {kind:'sparring',id:'ch09-boss',tag:'대결',table:{...table(['luna','elena']),readingReview:{id:'act3-response-v1'}},maxHands:15,objectives:{primary:[
   {id:'ch09-fold',kind:'luna-checkraise-fold',label:'루나 체크레이즈에 약한 원페어 폴드 70% 이상',minRatio:0.7},
   {id:'ch09-overcall',kind:'luna-checkraise-fold',label:'같은 기회에서 잘못 대응 2회 이하',maxCount:2},
  ],bonus:[{id:'ch09-survive',kind:'survive',label:'파산 없이 마무리'}]},interrupts:[]},
  {kind:'scene',id:'ch09-river-walk',scene:scene('ch09-river-walk',[
   '테이블을 정리하고 잠깐 걸을까. 도장 밖 강변은 이 시간에 조용해.',
   '네가 폴드할 때마다 겁이 난 건지, 생각이 끝난 건지 봤어. 오늘은 이유가 들렸어.',
   '나도 예전엔 침묵이 답이라고 생각했어. 그런데 기다리는 사람에게는 한마디가 필요하더라.',
   '…오늘 와 줘서 좋았어. 이 말은 가정이 아니야.',
  ],'act3-ch09-river-walk')},
  {kind:'scene',id:'ch09-epilogue',scene:scene('ch09-epilogue',[
   '…눈이 오네. 그날 강변에서 걷던 계절도 벌써 지나갔어. 이 창가에서 다시 만나니, 시간이 조금 다르게 보여.',
   '그날 강변에서 못 한 말이 있어. 너와는 다음 패가 없어도 조금 더 앉아 있고 싶었어.',
   '…카드는 뒤집지 않아도 돼. 오늘은 차가 식기 전에 마시자.',
  ],'act3-ch09-snow-window')},
  {kind:'result',id:'ch09-result'},
 ],
 failScene:scene('ch09-failure',['…멈춰도 돼. 한 번의 레이즈가 네 실력을 전부 말해 주지는 않아.','그 스트리트에서 누가 먼저 체크했고, 언제 벳이 나왔는지 다시 놓아 보자. 결과를 지우면 결정이 더 잘 보여.','다시 할 때도 새 패야. 지난 답을 외우지 말고, 이번에 남은 가능성을 세어. 기다릴게.']),
 rewards:{first:{dojoXpMilli:300_000,affinity:[{target:'elena',milli:100_000}],badgeId:'story-title-shadow-reader'},replay:{dojoXpMilli:50_000},gradeBonusMilli:{A:60_000,S:150_000}},
};
