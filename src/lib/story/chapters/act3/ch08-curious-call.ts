import type { Chapter, LiveTableSpec, Scene } from '../../types';
import { STORY_CURRICULUM } from '../../curriculum';
const scene = (id: string, lines: string[]): Scene => ({ id, lines: lines.map(text => ({kind:'say',speaker:'chloe',expression:'happy',text})) });
const table = (characters: string[]): LiveTableSpec => ({blinds:{small:10,big:20},heroSeat:0,heroStackBB:100,lineup:characters.map((characterId,index)=>({seatIndex:index+1,characterId,stackBB:100})),difficulty:'normal',turnTimeSec:60,botThinkScale:0.6,hints:3});
export const CH08: Chapter = {
 id:'act3-ch08',act:3,order:2,title:'궁금하면 콜',subtitle:'블러프 캐치 · 콤보 · 콜 가격',teacher:'chloe',belt:'blue',requires:[...STORY_CURRICULUM[2]],estimatedMinutes:18,
 steps:[
  {kind:'scene',id:'ch08-intro',scene:scene('ch08-intro',[
   '하이, 루키! 오늘 카메라는 껐어. 채팅창이 없으니까 좀 조용하지?',
   '나, 궁금해서 콜한 적 많아. 상대 패가 뭐였을까, 혹시 블러프였을까. 근데 호기심은 칩으로 계산하면 비싸더라구.',
   '오늘은 콜을 참는 수업이 아니라, 콜할 이유를 찾는 수업이야. 구미랑 초코가 같은 금액을 걸어도 생각은 달라져야 해.',
   '끝나면 네가 폴드한 패도 같이 볼까? 이긴 화면만 남기는 방송 말고, 진짜 내 생각을 남겨 보고 싶어.',
  ])},
  {kind:'lesson',id:'ch08-lesson',title:'궁금함 대신 가격표',blocks:[
   {kind:'concept-card',title:'콜의 가격',body:'상대 벳까지 포함된 팟이 300, 콜이 100이면 마지막 팟은 400이야. 필요한 승률은 25%. 이미 넣은 칩은 지금 콜 가격에 다시 더하지 않아.',formula:'필요 승률 = 콜 / (현재 팟 + 콜)'},
   {kind:'concept-card',title:'이름보다 조합',body:'AA는 기본 6콤보지만 내가 A를 들고 있으면 3콤보로 줄어. 보드 카드도 빼야 해. 같은 레인지 토큰을 두 번 적어도 패가 늘어나지는 않아.'},
   {kind:'concept-card',title:'리버 블러프 캐치',body:'더 나쁜 밸류에는 못 이기고 블러프에는 이기는 패로 콜하는 거야. 모든 블러퍼에게 무조건 콜하는 건 아니고, 남아 있는 블러프 비중과 가격을 비교해.'},
   {kind:'concept-card',title:'실전 리딩 질문',body:'실제 리버 턴 직전에 최대 두 번 멈출게. 내 카드와 보드, 화면에 적힌 상대 레인지 가정의 모든 콤보로 계산해. 상대의 진짜 패를 맞히는 문제는 아니야. 답을 잠근 뒤 풀이를 보고 직접 포커 액션을 골라.'},
   {kind:'concept-card',title:'오늘의 관찰 기준',body:'구미의 ⅓~¾팟 리버 벳에는 톱페어 이상으로 콜할 기회를 봐. 초코는 QQ+, AQs+, AKo, KQs를 같은 빈도로 벳한다고 가정하고, 그 레인지보다 가격이 나쁜 원페어 대응을 봐. 강한 메이드의 밸류 레이즈나 멀티웨이·올인은 따로 판단하니까 점수에서 빼.'},
   {kind:'concept-card',title:'카드가 주지 않은 기회',body:'구미 콜 두 번이면 일찍 마칠 수 있지만, 끝까지 실제 기회가 한 번뿐이면 그 한 번으로 평가해. 기회가 없으면 미측정. 리딩도 실제로 유효한 질문의 답만 평가해.'},
  ]},
  {kind:'drill-set',id:'ch08-drills',title:'콜할 이유를 세어 봐',teacher:'chloe',hintPenalty:0.5,drills:[
   ...['odds-required-equity','odds-ratio-choice','combo-count','combo-blockers','call-river-range','call-river-range','call-river-range'].map(templateId=>({templateId,seedPolicy:'per-run' as const})),
  ]},
  {kind:'practice-table',id:'ch08-gumi-practice',tag:'연습',table:table(['gumi']),scripts:[{hero:'Kh Qs',villains:{1:'Jh Td'},board:'Kc 9d 7s 4h 2c'}],perHandPrompt:'구미와 첫 연습이야. 리버에 톱페어가 남고 ⅓~¾팟 벳을 맞으면 블러프 캐치 콜을 고려해. 실제 액션이 다르면 현재 가격부터 확인해.'},
  {kind:'practice-table',id:'ch08-choco-practice',tag:'연습',table:table(['choco']),scripts:[{hero:'9h 8s',villains:{1:'Kh Ks'},board:'Kc 9d 7s 4h 2c'}],perHandPrompt:'초코와 둘째 연습. 원페어로 큰 리버 공격을 만나면 궁금해서 콜하지 말고 상대 레인지와 가격을 보자. 강한 패가 생기면 원페어 폴드 규칙을 적용하지 않아.'},
  {kind:'sparring',id:'ch08-sparring',tag:'대결',table:{...table(['gumi','choco','vivian']),reading:{id:'river-reading-v1',maxQuestions:2},readingReview:{id:'act3-response-v1'}},minHands:4,maxHands:12,objectives:{primary:[
   {id:'ch08-call',kind:'gumi-river-call',label:'구미의 합리적 리버 벳에 톱페어+ 콜 2회 · 최종 실제 기회 한정',target:2,finalOpportunityCap:true},
   {id:'ch08-fold',kind:'honest-river-fold',label:'초코의 불리한 원페어 가격에 잘못 대응 1회 이하',maxCount:1},
   {id:'ch08-quiz',kind:'quiz-accuracy',label:'유효 리딩 질문 정답 50% 이상 · 기회 없으면 미측정',minRatio:0.5},
  ],bonus:[{id:'ch08-survive',kind:'survive',label:'파산 없이 마무리'}]},interrupts:[]},
  {kind:'scene',id:'ch08-epilogue',scene:scene('ch08-epilogue',[
   '어때? 같은 콜 버튼인데 이유를 말할 수 있으니까 조금 덜 무섭지?',
   '나도 오늘은 폴드한 패를 기억할래. 아무도 박수 안 쳐 줘도, 칩을 지킨 건 내 선택이니까.',
   '루키, 다음엔 내가 콜 누르기 전에 물어봐 줘. 궁금해서야, 아니면 가격이 맞아서야? …그 질문, 네가 해 주면 들을 것 같아.',
  ])},
  {kind:'result',id:'ch08-result'},
 ],
 failScene:scene('ch08-failure',['으엥, 손이 생각보다 빨랐네. 나도 알아, 콜 버튼이 제일 궁금해 보인다구.','틀린 질문은 공개한 레인지와 가격으로 다시 계산하자. 이겼는지보다 그때 어떤 이유가 있었는지가 먼저야.','스파링만 다시 하면 새 패와 새 리딩 기회로 시작해. 이번에는 눌러 보기 전에 같이 한 번 세자.']),
 rewards:{first:{dojoXpMilli:250_000,affinity:[{target:'chloe',milli:100_000}],badgeId:'story-title-bluff-catcher'},replay:{dojoXpMilli:50_000},gradeBonusMilli:{A:50_000,S:120_000}},
};
