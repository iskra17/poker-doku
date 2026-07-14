export interface CharacterProfile {
  id: string;
  name: string;
  nameJp: string;
  color: string;        // primary color
  colorSecondary: string;
  emoji: string;         // 이미지 fallback
  personality: string;
  greeting: string;
  winQuote: string;
  loseQuote: string;
  bluffQuote: string;
  foldQuote: string;
  thinkingQuote: string;
  chatMessages: string[];
}

export const DEALER_CHARACTER: CharacterProfile = {
  id: 'dealer',
  // 게임 전반에서 '딜러' 역할을 강조 — 채팅 발신자/좌석 라벨은 '딜러'로 노출.
  // 개인 이름(미야코)은 인트로/코너 라벨에서 '딜러 (미야코)' 형태로만 부드럽게 병기.
  name: '딜러',
  nameJp: '',
  color: '#FFD700',
  colorSecondary: '#B8860B',
  emoji: '👩',
  personality: 'elegant',
  greeting: '어서 오세요, 손님♪ 오늘도 멋진 승부 기대할게요.',
  winQuote: '후후, 정말 아름다운 핸드였어요.',
  loseQuote: '',
  bluffQuote: '',
  foldQuote: '',
  thinkingQuote: '',
  chatMessages: [
    '새로운 핸드를 시작할게요~ 모두 행운을 빌어요♪',
    '플랍 오픈이에요… 두근두근하네요.',
    '턴 카드 나갑니다~',
    '리버예요… 운명의 순간이네요.',
    '쇼다운! 카드를 보여주세요♪',
  ],
};

export const BOT_CHARACTERS: CharacterProfile[] = [
  {
    id: 'sakura',
    name: '사쿠라',
    nameJp: '桜',
    color: '#FF69B4',
    colorSecondary: '#FF1493',
    emoji: '🌸',
    personality: 'tight-passive',
    greeting: '아, 안녕하세요… 오, 오늘도 잘 부탁드려요…!',
    winQuote: '어…? 제, 제가 이겼어요…? 다, 다행이다…!',
    loseQuote: '역시… 좀 더 조심할 걸 그랬어요…',
    bluffQuote: '오, 올인이에요…! 제발 콜하지 마세요…!',
    foldQuote: '무, 무서워서… 저는 폴드할게요…',
    thinkingQuote: '어, 어떡하지… 조금만 생각할게요…',
    chatMessages: [
      '이번 핸드… 너무 떨려요…',
      '모, 모두 화이팅이에요…!',
      '좋은 카드가 왔으면 좋겠는데…',
      '와… 방금 플레이 멋있었어요…!',
      '콜… 해야 할까요…? 너무 어려워요…',
    ],
  },
  {
    id: 'ryuka',
    name: '류카',
    nameJp: '龍花',
    color: '#FF4500',
    colorSecondary: '#DC143C',
    emoji: '🐉',
    personality: 'loose-aggressive',
    greeting: '흥, 네가 내 상대야? 칩 잃을 준비나 해!',
    winQuote: '하핫! 봤지? 이게 실력이라는 거야!',
    loseQuote: '치잇… 이, 이번 건 그냥 운이 좋았던 것뿐이야!',
    bluffQuote: '올인. …뭐야, 쫄았어?',
    foldQuote: '흥, 이런 패에 시간 쓸 가치도 없어.',
    thinkingQuote: '흐음…',
    chatMessages: [
      '지루하네. 판 좀 키워볼까?',
      '나를 이길 수 있다고 생각해? 웃기지 마!',
      '…쫄린 거 다 보이거든?',
      '자, 덤벼봐. 상대해줄 테니까!',
      '그래, 그 정도는 돼야 재밌지!',
    ],
  },
  {
    id: 'hana',
    name: '하나',
    nameJp: '花',
    color: '#9370DB',
    colorSecondary: '#6A0DAD',
    emoji: '🌺',
    personality: 'tight-aggressive',
    greeting: '좋은 승부가 되길 바라요. 데이터는… 이미 충분하니까요.',
    winQuote: '계산대로예요. 전부 예상 범위 안이었죠.',
    loseQuote: '흥미로운 플레이네요. 기억해두겠어요.',
    bluffQuote: '수학적으로는 여기서 레이즈가 정답이에요.',
    foldQuote: '오즈가 맞지 않네요. 기다리겠어요.',
    thinkingQuote: '상황을 분석 중이에요…',
    chatMessages: [
      '이 팟 오즈… 꽤 흥미롭네요.',
      '좋은 플레이였어요.',
      '이 보드 텍스처, 분석할 가치가 있네요.',
      '어떻게 전개될지 지켜보죠.',
      '통계적으로 말하자면요…',
    ],
  },
  {
    id: 'yuki',
    name: '유키',
    nameJp: '雪',
    color: '#87CEEB',
    colorSecondary: '#4169E1',
    emoji: '❄️',
    personality: 'loose-passive',
    greeting: '야호~! 포커 시간이다! 완전 신난다~!',
    winQuote: '우와아! 이겼다! 럭키~☆',
    loseQuote: '에헤헤, 아쉽다~! 다음 판엔 꼭 이길 거야!',
    bluffQuote: '헤헤~ 이번엔 크게 간다~!',
    foldQuote: '음~ 이건 패스~!',
    thinkingQuote: '으음~ 어떻게 할까나~?',
    chatMessages: [
      '완전 재밌어~!',
      '오옷, 방금 카드 뭐야?!',
      '포커 진짜 너무 좋아~♪',
      '헤헤, 무슨 일이 일어날까~?',
      '다들 즐기고 있지? 난 완전 즐거워!',
    ],
  },
  {
    id: 'reika',
    name: '레이카',
    nameJp: '麗華',
    color: '#B9C2D9',
    colorSecondary: '#6E7BA8',
    emoji: '🌙',
    personality: 'balanced-pro',
    greeting: '…왔구나. 앉아. 카드로 이야기하자.',
    winQuote: '…예상 범위야. 놀랄 건 없어.',
    loseQuote: '…그래. 이번 판은 네 거야.',
    bluffQuote: '이 베팅의 의미… 읽을 수 있어?',
    foldQuote: '…패스. 서두를 이유가 없거든.',
    thinkingQuote: '…조금만, 조용히.',
    chatMessages: [
      '…나쁘지 않은 전개네.',
      '패는 거짓말을 안 해. 사람이 하지.',
      '…재밌는 라인이야.',
      '침착하게. 판은 길어.',
      '…다음 카드, 궁금하네.',
    ],
  },
  {
    id: 'akira',
    name: '아키라',
    nameJp: '暁',
    color: '#00CED1',
    colorSecondary: '#008B8B',
    emoji: '🎭',
    personality: 'maniac',
    greeting: '무대는 준비됐어… 자, 연극을 시작하지.',
    winQuote: '또 하나의 막이 완벽하게 내려갔군.',
    loseQuote: '최고의 배우도 가끔은 대사를 놓치는 법이지.',
    bluffQuote: '진실과 거짓… 너는 구별할 수 있을까?',
    foldQuote: '이 장면에서는 우아하게 퇴장하겠어.',
    thinkingQuote: '이야기가 점점 깊어지는군…',
    chatMessages: [
      '모든 핸드는 하나의 이야기야.',
      '내 포커페이스… 읽을 수 있겠어?',
      '드라마는 지금부터야.',
      '이 무슨 반전인가…!',
      '인생은 무대, 포커는 그중 최고의 연극이지.',
    ],
  },
];

export function getCharacterById(id: string): CharacterProfile | undefined {
  if (id === 'dealer') return DEALER_CHARACTER;
  return BOT_CHARACTERS.find(c => c.id === id);
}

export function getRandomBotCharacter(excludeIds: string[] = []): CharacterProfile {
  const available = BOT_CHARACTERS.filter(c => !excludeIds.includes(c.id));
  // 캐릭터 6명 > 좌석 6개라 정상 경로에선 소진되지 않음 — 소진 시에도 특정 캐릭터 편중 없이 랜덤
  if (available.length === 0) {
    return BOT_CHARACTERS[Math.floor(Math.random() * BOT_CHARACTERS.length)];
  }
  return available[Math.floor(Math.random() * available.length)];
}
