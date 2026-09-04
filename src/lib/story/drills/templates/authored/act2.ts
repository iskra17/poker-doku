/**
 * 2막 수기 문항 (D-ACT) — 스틸·c벳·밸류벳·3벳 대면의 "최선의 액션 + 이유".
 *
 * 계약은 1막(`act1.ts`)과 같다: `source.kind: 'authored'`, 시드 무시, 해설·힌트 전부 수기(AI 금지).
 * 출제자 말투 — Ch4·Ch6 = 아라(LAG 츤데레 반말, 「너」), Ch5 = 클로이(밝은 스트리머체, 영어 섞기, 「너」).
 * 백분위(facts.pct)는 `handPercentile` 실측값: K♥T♣ 21.7 · 9♠8♠ 10.6 · A♠K♦ 3.2 · A♥Q♦ 5.3 · A♠A♥ 0.2 · A♦T♣ 19.3 · T♠T♦ 4.1.
 * 임계는 `open-thresholds.ts`(BTN 35 · SB 25 · 3벳 6/콜 12 · 4벳 3.5/콜 8)와 같은 값이다.
 */
import { parseCards } from '@/lib/poker/card-notation';
import type { DrillTemplate, DrillVillain } from '../../types';

const BIG_BLIND = 20;
const STACK = 2000;

function villains(entries: Array<[number, string, string, string?]>): DrillVillain[] {
  return entries.map(([seatIndex, characterId, position, rangeTag]) => ({
    seatIndex,
    characterId,
    position,
    stackChips: STACK,
    ...(rangeTag ? { rangeTag } : {}),
  }));
}

export const ACT2_AUTHORED_DRILLS: readonly DrillTemplate[] = Object.freeze<DrillTemplate[]>([
  // ── Ch4 먼저 치는 사람 (아라)
  {
    id: 'act-ch04-steal-btn',
    category: 'action-judgment',
    title: 'BTN의 K♥T♣',
    difficulty: 2,
    hints: ['앞이 다 폴드했고 뒤엔 블라인드 둘뿐이야. 둘 다 폴드하면 1.5BB가 공짜로 들어와.'],
    source: {
      kind: 'authored',
      instance: {
        category: 'action-judgment',
        situation: {
          hero: parseCards('Kh Tc'),
          board: [],
          potChips: 30,
          toCallChips: BIG_BLIND,
          bigBlind: BIG_BLIND,
          heroStackChips: STACK,
          heroPosition: 'BTN',
          street: 'preflop',
          villains: villains([
            [1, 'mochi', 'SB'],
            [2, 'kapi', 'BB'],
            [3, 'choco', 'UTG'],
            [4, 'luna', 'HJ'],
            [5, 'gumi', 'CO'],
          ]),
          note: '앞자리 셋은 전부 폴드 — 버튼까지 언오픈으로 넘어왔어요.',
        },
        question: '앞이 모두 폴드하고 버튼(BTN)입니다. 최선의 액션은?',
        answerSpec: { kind: 'action-pick', options: ['fold', 'call', 'raise'], correct: ['raise'], sizingBB: { min: 2, max: 3 } },
        hint: '앞이 다 폴드했고 뒤엔 블라인드 둘뿐이야. 둘 다 폴드하면 1.5BB가 공짜로 들어와.',
        explanation: {
          text:
            'K♥T♣는 상위 22% 정도 — BTN 임계 35% 안이야. 뒤에 남은 건 블라인드 둘뿐이고. '
            + '2.5BB 오픈이면 1.5BB를 얻으려고 2.5BB를 거는 거라, 둘이 63%만 폴드해도 본전이야. '
            + '실제론 그보다 훨씬 자주 폴드해. 그러니까 이건 스틸 — 레이즈. 콜(림프)은 없어.',
          speaker: 'ara',
          facts: { pct: 21.7, threshold: 35, breakeven: 63 },
        },
      },
    },
  },
  {
    id: 'act-ch04-cbet-dry',
    category: 'action-judgment',
    title: '드라이 보드의 c벳',
    difficulty: 2,
    hints: ['K♣7♦2♠ — 레인보우에 연결도 없어. 이런 보드는 상대가 맞춘 게 별로 없다는 뜻이야.'],
    source: {
      kind: 'authored',
      instance: {
        category: 'action-judgment',
        situation: {
          hero: parseCards('As Kd'),
          board: parseCards('Kc 7d 2s'),
          potChips: 140,
          toCallChips: 0,
          bigBlind: BIG_BLIND,
          heroStackChips: STACK - 60,
          heroPosition: 'CO',
          street: 'flop',
          villains: villains([[1, 'kapi', 'BB', '스테이션']]),
          note: '내가 CO에서 3BB 오픈, 카피(BB)만 콜. 플랍에서 카피가 체크했어요.',
        },
        question: '어그레서로 플랍을 봤고 카피가 체크했습니다. 최선의 액션은?',
        answerSpec: { kind: 'action-pick', options: ['check', 'raise'], correct: ['raise'], sizingBB: { min: 2, max: 3 } },
        hint: 'K♣7♦2♠ — 레인보우에 연결도 없어. 이런 보드는 상대가 맞춘 게 별로 없다는 뜻이야.',
        explanation: {
          text:
            '탑페어 탑키커에 드라이 보드. 여기서 체크하면 카피한테 공짜 카드를 주는 거야. '
            + '드라이 보드에선 작은 c벳(팟의 ⅓, 2~3BB)이면 충분해 — 맞춘 게 없는 상대는 그 정도에도 폴드하고, '
            + '카피처럼 안 폴드하는 상대한텐 싸게 밸류를 쌓기 시작하는 거지. 벳해.',
          speaker: 'ara',
          facts: { potChips: 140, sizePct: 33 },
        },
      },
    },
  },
  {
    id: 'act-ch04-iso-sb',
    category: 'action-judgment',
    title: 'SB의 9♠8♠, 앞에 림퍼',
    difficulty: 2,
    hints: ['림프한 사람은 약하다고 말하고 있는 거야. 그 사람 뒤에서 같이 림프하면 주도권은 아무한테도 없어.'],
    source: {
      kind: 'authored',
      instance: {
        category: 'action-judgment',
        situation: {
          hero: parseCards('9s 8s'),
          board: [],
          potChips: 50,
          toCallChips: 10,
          bigBlind: BIG_BLIND,
          heroStackChips: STACK - 10,
          heroPosition: 'SB',
          street: 'preflop',
          villains: villains([
            [1, 'chloe', 'BB', '스테이션'],
            [2, 'kapi', 'UTG', '림퍼'],
            [3, 'choco', 'HJ'],
            [4, 'mochi', 'CO'],
            [5, 'luna', 'BTN'],
          ]),
          note: '카피(UTG)가 림프, 나머지는 폴드. SB인 나까지 왔어요.',
        },
        question: '카피가 림프했고 SB입니다. 최선의 액션은?',
        answerSpec: { kind: 'action-pick', options: ['fold', 'call', 'raise'], correct: ['raise'], sizingBB: { min: 3, max: 5 } },
        hint: '림프한 사람은 약하다고 말하고 있는 거야. 그 사람 뒤에서 같이 림프하면 주도권은 아무한테도 없어.',
        explanation: {
          text:
            '9♠8♠는 상위 11%, SB 임계 25% 안이야. 앞에 림퍼가 있으면 "같이 림프"가 제일 나쁜 선택이고 — '
            + '레이즈해서 팟을 내 것으로 만들어. 림퍼가 있으니 기본 3BB에 1BB 더, 4BB 정도. '
            + '카피가 따라와도 내가 어그레서로 플랍을 보는 거고, 폴드하면 그냥 팟 먹는 거지.',
          speaker: 'ara',
          facts: { pct: 10.6, threshold: 25 },
        },
      },
    },
  },

  // ── Ch5 받을 건 받아야죠 (클로이)
  {
    id: 'act-ch05-river-value',
    category: 'action-judgment',
    title: '리버, 스테이션 상대 탑페어',
    difficulty: 2,
    hints: ['상대는 나(클로이)야~ 나는 궁금하면 그냥 콜한다구! 그럼 어떻게 받아야 할까?'],
    source: {
      kind: 'authored',
      instance: {
        category: 'action-judgment',
        situation: {
          hero: parseCards('Ah Qd'),
          board: parseCards('Qs 9c 4d 7h 2s'),
          potChips: 240,
          toCallChips: 0,
          bigBlind: BIG_BLIND,
          heroStackChips: STACK - 120,
          heroPosition: 'BTN',
          street: 'river',
          villains: villains([[1, 'chloe', 'BB', '스테이션']]),
          note: '플랍·턴 모두 내가 벳, 클로이가 콜. 리버에서 클로이가 체크했어요.',
        },
        question: '리버, 클로이가 체크했습니다. 최선의 액션은?',
        answerSpec: { kind: 'action-pick', options: ['check', 'raise'], correct: ['raise'], sizingBB: { min: 8, max: 12 } },
        hint: '상대는 나(클로이)야~ 나는 궁금하면 그냥 콜한다구! 그럼 어떻게 받아야 할까?',
        explanation: {
          text:
            '보드는 Q-9-4-7-2, 드로우는 다 빗나갔고 넌 탑페어 탑키커야. 나 같은 스테이션은 Q 하나, 9 하나, 심지어 A하이로도 콜하거든~ '
            + '그러니까 체크는 돈을 두고 나오는 거야. 팟 240에 ¾인 180(9BB) 정도로 크게! '
            + '작게 벳하면 나는 똑같이 콜하는데 너만 덜 받는 거잖아? Big value, let\'s go~!',
          speaker: 'chloe',
          facts: { potChips: 240, sizePct: 75 },
        },
      },
    },
  },
  {
    id: 'act-ch05-river-air-check',
    category: 'action-judgment',
    title: '리버, 스테이션 상대 미스 드로우',
    difficulty: 2,
    hints: ['블러프는 상대가 폴드해야 성공하는 거야. 근데 나는… 안 폴드한다구?'],
    source: {
      kind: 'authored',
      instance: {
        category: 'action-judgment',
        situation: {
          hero: parseCards('Jh Th'),
          board: parseCards('Qh 8h 3c 5d 2s'),
          potChips: 200,
          toCallChips: 0,
          bigBlind: BIG_BLIND,
          heroStackChips: STACK - 100,
          heroPosition: 'CO',
          street: 'river',
          villains: villains([[1, 'chloe', 'BB', '스테이션']]),
          note: '플랍에서 내가 벳, 클로이 콜. 턴·리버는 서로 체크, 리버에서 클로이가 또 체크했어요.',
        },
        question: '플러시 드로우가 빗나갔고 클로이가 체크했습니다. 최선의 액션은?',
        answerSpec: { kind: 'action-pick', options: ['check', 'raise'], correct: ['check'] },
        hint: '블러프는 상대가 폴드해야 성공하는 거야. 근데 나는… 안 폴드한다구?',
        explanation: {
          text:
            'J♥T♥는 아무것도 없어 — J하이야. 여기서 벳하는 건 블러프인데, 블러프는 상대가 폴드해야 이기는 거잖아? '
            + '나는 페어 하나만 있어도 끝까지 보는 사람이라서, 이 정도 벳엔 폴드하지 않아. 체크하고 쇼다운을 보든가, 지면 그냥 지는 거야. '
            + '스테이션한테 블러프 안 하기 — 이게 오늘의 룰이야~',
          speaker: 'chloe',
          facts: { potChips: 200 },
        },
      },
    },
  },

  // ── Ch6 3벳의 온도 (아라)
  {
    id: 'act-ch06-3bet-aa',
    category: 'action-judgment',
    title: 'BTN의 A♠A♥, 앞에 오픈',
    difficulty: 2,
    hints: ['최강 핸드로 그냥 콜하면 팟이 작아. 팟을 키우는 건 레이즈뿐이야.'],
    source: {
      kind: 'authored',
      instance: {
        category: 'action-judgment',
        situation: {
          hero: parseCards('As Ah'),
          board: [],
          potChips: 90,
          toCallChips: 60,
          bigBlind: BIG_BLIND,
          heroStackChips: STACK,
          heroPosition: 'BTN',
          street: 'preflop',
          villains: villains([
            [1, 'luna', 'SB'],
            [2, 'gumi', 'BB'],
            [3, 'mochi', 'UTG', '니트'],
            [4, 'choco', 'HJ'],
            [5, 'kapi', 'CO'],
          ]),
          note: '모찌(UTG)가 3BB로 오픈, HJ·CO는 폴드. BTN인 나까지 왔어요.',
        },
        question: '모찌의 오픈을 맞았고 BTN입니다. 최선의 액션은?',
        answerSpec: { kind: 'action-pick', options: ['fold', 'call', 'raise'], correct: ['raise'], sizingBB: { min: 8, max: 10 } },
        hint: '최강 핸드로 그냥 콜하면 팟이 작아. 팟을 키우는 건 레이즈뿐이야.',
        explanation: {
          text:
            'AA는 상위 0.2% — 3벳 구간(상위 6%)의 한가운데야. 콜로 숨기는 건 "슬로플레이"라고 부르지만, 실제론 팟만 작아지고 '
            + '뒤의 블라인드가 싸게 들어오게 하는 거야. 오픈 3BB의 3배, 9BB로 3벳. 모찌가 폴드하면 그것도 이득이고.',
          speaker: 'ara',
          facts: { pct: 0.2, threeBet: 6 },
        },
      },
    },
  },
  {
    id: 'act-ch06-fold-vs-3bet',
    category: 'action-judgment',
    title: '내 오픈이 3벳을 맞았다',
    difficulty: 2,
    hints: ['오픈 레인지와 3벳을 받는 레인지는 달라. A♦T♣는 오픈은 되지만…'],
    source: {
      kind: 'authored',
      instance: {
        category: 'action-judgment',
        situation: {
          hero: parseCards('Ad Tc'),
          board: [],
          potChips: 270,
          toCallChips: 120,
          bigBlind: BIG_BLIND,
          heroStackChips: STACK - 60,
          heroPosition: 'CO',
          street: 'preflop',
          villains: villains([
            [1, 'paeng', 'BTN', '3벳 폭격기'],
            [2, 'luna', 'SB'],
            [3, 'gumi', 'BB'],
            [4, 'mochi', 'UTG'],
            [5, 'choco', 'HJ'],
          ]),
          note: '내가 CO에서 3BB 오픈, 팽팽(BTN)이 9BB로 3벳. 블라인드는 폴드.',
        },
        question: '팽팽의 3벳을 맞았습니다. 최선의 액션은?',
        answerSpec: { kind: 'action-pick', options: ['fold', 'call', 'raise'], correct: ['fold'] },
        hint: '오픈 레인지와 3벳을 받는 레인지는 달라. A♦T♣는 오픈은 되지만…',
        explanation: {
          text:
            'A♦T♣는 상위 19% — CO 오픈(25%)엔 들지만, 3벳을 받는 구간은 콜 8%까지야. 한참 밖이지. '
            + '팽팽은 미지근한 콜이 없는 녀석이라 3벳 레인지도 좁고. 여기서 콜하면 포지션 없이 약한 A로 큰 팟을 하는 거야. '
            + '4벳은 더 말도 안 되고. 폴드해. 3BB 잃은 걸로 끝내는 게 이기는 거야.',
          speaker: 'ara',
          facts: { pct: 19.3, callLine: 8 },
        },
      },
    },
  },
  {
    id: 'act-ch06-call-3bet-tt',
    category: 'action-judgment',
    title: 'T♠T♦로 3벳을 맞았다',
    difficulty: 3,
    hints: ['TT는 4벳 구간(3.5%)은 아니지만 폴드하기엔 너무 좋아. 그 사이 구간이 있어.'],
    source: {
      kind: 'authored',
      instance: {
        category: 'action-judgment',
        situation: {
          hero: parseCards('Ts Td'),
          board: [],
          potChips: 270,
          toCallChips: 120,
          bigBlind: BIG_BLIND,
          heroStackChips: STACK - 60,
          heroPosition: 'HJ',
          street: 'preflop',
          villains: villains([
            [1, 'paeng', 'BTN', '3벳 폭격기'],
            [2, 'luna', 'SB'],
            [3, 'gumi', 'BB'],
            [4, 'mochi', 'UTG'],
            [5, 'choco', 'CO'],
          ]),
          note: '내가 HJ에서 3BB 오픈, 팽팽(BTN)이 9BB로 3벳. 블라인드는 폴드.',
        },
        question: '팽팽의 3벳을 맞았습니다. 최선의 액션은?',
        answerSpec: { kind: 'action-pick', options: ['fold', 'call', 'raise'], correct: ['call'] },
        hint: 'TT는 4벳 구간(3.5%)은 아니지만 폴드하기엔 너무 좋아. 그 사이 구간이 있어.',
        explanation: {
          text:
            'T♠T♦는 상위 4%. 4벳 구간(상위 3.5%)엔 살짝 못 미치고, 콜 구간(8%까지)엔 넉넉히 들어. '
            + '4벳하면 팽팽의 QQ+·AK한테만 액션을 받고, 폴드하면 3BB를 그냥 버리는 거야. '
            + '콜하고 플랍을 봐 — 오버카드가 없는 플랍이면 계속 가고, A·K·Q가 뜨면 조심하면 돼. 3구간, 기억해.',
          speaker: 'ara',
          facts: { pct: 4.1, fourBet: 3.5, callLine: 8 },
        },
      },
    },
  },
]);
