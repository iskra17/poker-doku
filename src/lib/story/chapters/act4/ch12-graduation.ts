import { STORY_CURRICULUM } from '../../curriculum';
import { PUSH_FOLD_MAX_BB, SHORT_STACK_MAX_BB, STACK_ZONE_LABEL } from '../../sng-thresholds';
import { REVIEW_SLOT_TEMPLATE_ID, type Chapter, type Scene, type SceneSayLine } from '../../types';
import { CH11_REVIEW_POOL } from './ch11-all-round';

/**
 * Ch12 「졸업 시험」 — 4막 3번, 진행은 딜러 미야코.
 *
 * 이 챕터의 대결만 **실제 6인 Sit & Go**(연습경제 1,000칩·2분 구조)로 돈다. 통과 조건은 행동 목표가
 * 아니라 **엔진이 확정한 순위**이고, 3위 이내면 검은띠 자격·1위면 사범대리 칭호가 붙는다.
 * 따라서 이 파일에는 스파링 objectives가 없고(검증기가 tournament 정책에서만 허용), 대신
 * `graduation: true` + `examDisabled: true`로 "드릴만 풀어 통과"하는 우회로를 막는다.
 *
 * 에필로그는 아홉 장면 중 **두 장면만** 재생된다: 순위 결과(out/itm/champion) 하나와 파트너 하나.
 * 서버가 `requiresFlags`를 평가해 나머지를 건너뛰므로, 대사에 **아직 받지 않은 띠를 수여하는 문장**을
 * 두지 말 것 — 승급 안내는 결산의 `beltAwarded`가 담당한다.
 */

const miyako = (id: string, lines: string[]): Scene => ({
  id,
  lines: lines.map(text => ({ kind: 'say', speaker: 'miyako', expression: 'happy', text }) as SceneSayLine),
});

/** 순위 결과 에필로그 — 파트너 3~4줄 + 미야코 마무리 1줄 (파트너 라인은 중립 존댓말) */
const outcomeScene = (id: string, outcome: 'out' | 'itm' | 'champion', partnerLines: string[], miyakoLine: string): Scene => ({
  id,
  requiresFlags: { 'graduation:outcome': outcome },
  lines: [
    ...partnerLines.map(text => ({ kind: 'say', speaker: 'partner', expression: 'neutral', text }) as SceneSayLine),
    { kind: 'say', speaker: 'miyako', expression: 'happy', text: miyakoLine },
  ],
});

/** 파트너별 마무리 — 각 2줄, 해당 히로인 문체 */
const partnerScene = (characterId: string, lines: string[], expression: SceneSayLine['expression'] = 'happy'): Scene => ({
  id: `ch12-ep-${characterId}`,
  requiresFlags: { partner: characterId },
  lines: lines.map(text => ({ kind: 'say', speaker: characterId, expression, text }) as SceneSayLine),
});

export const CH12: Chapter = {
  id: 'act4-ch12',
  act: 4,
  order: 3,
  title: '졸업 시험',
  subtitle: '실제 6인 Sit & Go',
  teacher: 'miyako',
  belt: 'black',
  requires: [...STORY_CURRICULUM[3]],
  examDisabled: true,
  graduation: true,
  estimatedMinutes: 35,
  steps: [
    { kind: 'scene', id: 'ch12-intro', scene: miyako('ch12-intro', [
      '오늘은 수업이 아니에요. 시험이랍니다♪',
      '여섯 명이 앉고, 한 명이 남을 때까지 돌아요. 블라인드는 2분마다 올라가고 리바이는 없답니다.',
      '통과 조건은 딱 하나 — 끝까지 앉아 있다가 순위를 받는 거예요. 몇 위든 그건 당신의 기록이 된답니다.',
      '자리를 비워도 블라인드는 계속 나가요. 돌아오실 때까지 테이블이 기다려 주지는 않는답니다.',
      '준비되셨나요? 그럼… 마지막 수업을 시작할게요♪',
    ]) },
    { kind: 'lesson', id: 'ch12-lesson', title: '토너먼트의 산술', blocks: [
      { kind: 'text', speaker: 'miyako', text: '캐시 게임에서는 칩이 모자라면 다시 사면 됐죠. 여기선 아니에요. 남은 칩이 곧 남은 시간이랍니다.' },
      { kind: 'concept-card', title: '스택은 BB로 센다', body: '칩 숫자가 아니라 "빅블라인드 몇 개"로 봐요. 1,000칩이 10/20에서는 50BB지만 100/200이 되면 5BB예요. 같은 칩인데 완전히 다른 상황이랍니다.', formula: '스택(BB) = 내 칩 ÷ 빅블라인드' },
      { kind: 'concept-card', title: 'M — 몇 바퀴 버티는가', body: '한 바퀴(오르빗)에 나가는 블라인드 총액으로 내 스택을 나눈 값이에요. M이 작을수록 "기다릴 여유"가 없어요.', formula: 'M = 내 칩 ÷ (SB + BB)' },
      { kind: 'concept-card', title: '세 구간', body: `${STACK_ZONE_LABEL['push-fold']} · ${STACK_ZONE_LABEL.short} · ${STACK_ZONE_LABEL.comfortable}. ${PUSH_FOLD_MAX_BB}BB 이하에서는 레이즈하고 폴드할 여지가 사실상 없어요 — 올인이 아니면 폴드랍니다. ${SHORT_STACK_MAX_BB}BB를 넘기면 다시 평범한 포커로 돌아와요.` },
      { kind: 'concept-card', title: '다음 레벨을 미리 보기', body: '지금 20BB라도 다음 레벨에서 13BB가 된다면, 지금이 마지막 "제대로 된 레이즈" 기회일 수 있어요. 시계를 보고 결정하는 것도 실력이랍니다.' },
      { kind: 'concept-card', title: 'ITM까지 몇 명', body: '입상은 3위까지예요. 남은 인원이 4명이면 한 명만 더 떨어지면 되죠. 이때는 큰 스택끼리의 충돌을 지켜보는 것도 하나의 선택이랍니다.' },
      { kind: 'concept-card', title: '푸시/폴드의 가정', body: '올인 EV는 칩 기준이에요(상금 가치는 계산에 넣지 않아요). 뒤에 앉은 사람들의 콜 레인지를 명시적으로 가정하고, 첫 콜러 뒤 추가 콜은 없다고 봐요. 가정이 바뀌면 답도 바뀐답니다.', formula: 'EV = 전원폴드확률 × 데드머니 + Σ (콜 확률 × (에퀴티 × 쇼다운 팟 − 내 스택))' },
      { kind: 'text', speaker: 'miyako', text: '마지막으로 졸업 규칙이에요. 순위가 확정되면 그 자리에서 끝나고, 3위 안에 들면 검은띠 자격이 붙어요. 1위는… 사범대리랍니다♪' },
      { kind: 'text', speaker: 'miyako', text: '연결이 끊겨도 자리는 지켜 드려요. 다시 들어오면 같은 방, 같은 스택이랍니다. 다만 그동안의 블라인드는 돌려드릴 수 없어요.' },
    ] },
    { kind: 'drill-set', id: 'ch12-drills', title: '졸업 문제 아홉', teacher: 'miyako', hintPenalty: 0.5,
      drills: [
        { templateId: 'sng-stack-bb', seedPolicy: 'per-run' },
        { templateId: 'sng-m-ratio', seedPolicy: 'per-run' },
        { templateId: 'sng-next-level-bb', seedPolicy: 'per-run' },
        { templateId: 'sng-stack-zone', seedPolicy: 'per-run' },
        { templateId: 'sng-itm-distance', seedPolicy: 'per-run' },
        { templateId: 'act-ch12-push-btn-8bb', seedPolicy: 'fixed', fixedSeed: 0 },
        { templateId: 'act-ch12-fold-utg-8bb', seedPolicy: 'fixed', fixedSeed: 0 },
        { templateId: REVIEW_SLOT_TEMPLATE_ID, seedPolicy: 'per-run' },
        { templateId: REVIEW_SLOT_TEMPLATE_ID, seedPolicy: 'per-run' },
      ],
      reviewPool: CH11_REVIEW_POOL },
    { kind: 'practice-table', id: 'ch12-practice', tag: '연습',
      perHandPrompt: '8BB · 버튼. 레이즈하고 폴드할 여지는 없어요 — 올인이 아니면 폴드예요.',
      table: {
        blinds: { small: 100, big: 200 },
        heroSeat: 0,
        heroStackBB: 8,
        lineup: [{ seatIndex: 1, characterId: 'paeng', stackBB: 15, role: 'neighbor' }],
        difficulty: 'normal',
        turnTimeSec: 45,
        botThinkScale: 0.6,
        hints: 2,
      },
      scripts: [
        { hero: 'As 7d', villains: { 1: 'Kh Qc' } },
        { hero: 'As 7d', villains: { 1: 'Th 9c' } },
      ] },
    { kind: 'sparring', id: 'ch12-graduation', tag: '대결',
      table: {
        tournament: { id: 'graduation-sng-v1', sngStructureId: 'graduation' },
        // 실제 블라인드·스택은 구조 레지스트리(1,000칩 · 10/20 시작 · 2분)가 정한다 — 아래 값은 표시용 기본
        blinds: { small: 10, big: 20 },
        heroSeat: 0,
        heroStackBB: 50,
        lineup: [
          { seatIndex: 1, characterId: 'paeng', stackBB: 50 },
          { seatIndex: 2, characterId: 'luna', stackBB: 50 },
          { seatIndex: 3, characterId: 'vivian', stackBB: 50 },
          { seatIndex: 4, characterId: 'elena', stackBB: 50 },
          { seatIndex: 5, characterId: 'ingrid', stackBB: 50 },
        ],
        difficulty: 'normal',
        turnTimeSec: 30,
        botThinkScale: 0.5,
        hints: 0,
      },
      maxHands: 400,
      objectives: { primary: [], bonus: [] },
      interrupts: [] },

    // ── 에필로그: 순위 결과 1장 + 파트너 1장만 재생된다 (서버가 requiresFlags로 고른다)
    { kind: 'scene', id: 'ch12-ep-out', graduation: 'epilogue', scene: outcomeScene('ch12-ep-out', 'out', [
      '수고했어요. 앉아 있는 동안 한 번도 도망치지 않았죠.',
      '토너먼트는 결과가 실력을 다 말해 주지 않아요. 같은 결정을 백 번 하면 순위는 달라지거든요.',
      '오늘 어긋난 자리를 기억해 뒀다가 다음 자리에서 써요. 그거면 충분해요.',
    ], '기록은 남았답니다♪ 졸업 대결은 언제든 다시 도전하실 수 있어요.') },
    { kind: 'scene', id: 'ch12-ep-itm', graduation: 'epilogue', scene: outcomeScene('ch12-ep-itm', 'itm', [
      '입상이에요. 마지막까지 남은 세 자리 중 하나를 잡았어요.',
      '블라인드가 올라가는 걸 보면서 물러설 자리와 밀어 넣을 자리를 골랐죠. 그게 오늘의 차이였어요.',
      '이제 배울 게 없다는 뜻은 아니에요. 다만 혼자서도 판단할 수 있게 됐다는 뜻이에요.',
    ], '3위 안이라니… 정말 축하드려요♪ 자세한 건 결산에서 알려드릴게요.') },
    { kind: 'scene', id: 'ch12-ep-champion', graduation: 'epilogue', scene: outcomeScene('ch12-ep-champion', 'champion', [
      '…마지막 한 명이 됐네요.',
      '칩을 다 모으는 건 잘 치는 것만으로는 안 돼요. 물러설 때를 알아야 마지막까지 남거든요.',
      '오늘 마지막 핸드, 손이 떨리지 않았죠? 그게 제일 놀라웠어요.',
      '이제 이 테이블에서 당신에게 가르칠 게 남아 있는지 모르겠어요.',
    ], '우승이에요! 도장이 오랜만에 시끄러워지겠는데요♪') },
    { kind: 'scene', id: 'ch12-ep-sakura', graduation: 'epilogue', scene: partnerScene('sakura', [
      '저, 저기… 끝까지 봤어요. 한 핸드도 안 놓치고요.',
      '다음엔… 제가 그 자리에 앉아 볼게요. 그, 그러니까 기다려 주세요.',
    ], 'happy') },
    { kind: 'scene', id: 'ch12-ep-ara', graduation: 'epilogue', scene: partnerScene('ara', [
      '흥, 뭐야. 생각보다 잘하잖아. …인정.',
      '근데 착각하지 마. 다음엔 내가 그 자리에 앉을 거니까.',
    ], 'happy') },
    { kind: 'scene', id: 'ch12-ep-hana', graduation: 'epilogue', scene: partnerScene('hana', [
      '당신의 기록을 전부 정리했어요. 오늘 결정 중 대부분이 가격표와 맞았습니다.',
      '남은 건 표본을 늘리는 일뿐이에요. …그건 제가 옆에서 세어 드릴게요.',
    ], 'neutral') },
    { kind: 'scene', id: 'ch12-ep-chloe', graduation: 'epilogue', scene: partnerScene('chloe', [
      '와 진짜 미쳤다! 방금 그거 클립으로 잘라야 해, 진짜로!',
      '다음 방송 제목 정했어 — "내 수련생이 졸업했다". 나오는 거지? 나오는 거 맞지?',
    ], 'happy') },
    { kind: 'scene', id: 'ch12-ep-vivian', graduation: 'epilogue', scene: partnerScene('vivian', [
      '자기, 마지막 막이 내려가는 순간을 봤어요. 관객석에서 보면 참 근사하답니다.',
      '무대는 끝나도 배우는 남아요. 다음 무대에서도 자기 자리는 비워 둘게요.',
    ], 'happy') },
    { kind: 'scene', id: 'ch12-ep-elena', graduation: 'epilogue', scene: partnerScene('elena', [
      '…끝났네. 오늘은 네 판단이 계속 들렸어.',
      '다음엔 같은 테이블에서 만나자. 봐주지는 않을 거야.',
    ], 'neutral') },
    { kind: 'result', id: 'ch12-result' },
  ],
  rewards: {
    first: {
      dojoXpMilli: 500_000,
      affinity: [{ target: 'all', milli: 30_000 }],
      badgeId: 'story-title-graduate',
    },
    replay: { dojoXpMilli: 50_000 },
    gradeBonusMilli: { A: 50_000, S: 120_000 },
  },
};
