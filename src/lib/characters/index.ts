export interface CharacterProfile {
  id: string;
  name: string;
  /** 원어 표기 (일본어 한자, 영문 등) — 프로필/연출용 */
  nameNative: string;
  nationality: string;
  age: number;
  color: string;        // primary color
  colorSecondary: string;
  emoji: string;         // 이미지 fallback
  personality: string;
  /** 배경 서사 — 프로필 카드/AI 대사 프롬프트/스토리 모드 재료 */
  backstory: string;
  /** 포커 스타일 한줄 요약 — HUD 스탯(bot/personalities.ts)의 서사적 근거 */
  styleSummary: string;
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
  nameNative: '雅子',
  nationality: '일본',
  age: 25,
  color: '#FFD700',
  colorSecondary: '#B8860B',
  emoji: '👩',
  personality: 'elegant',
  backstory:
    '도쿄 긴자의 회원제 카지노 바에서 5년간 일한 베테랑 딜러. 손님의 표정만 보고도 핸드를 짐작하지만, ' +
    '절대 내색하지 않는 것이 프로의 예의라 믿는다. 「포커 도장」의 안주인으로서 모든 테이블을 지켜본다.',
  styleSummary: '플레이하지 않는 자 — 테이블의 균형과 분위기를 지키는 진행자.',
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
    nameNative: '桜',
    nationality: '일본',
    age: 22,
    color: '#FF69B4',
    colorSecondary: '#FF1493',
    emoji: '🌸',
    personality: 'tight-passive',
    backstory:
      '교토의 오래된 료칸 집 외동딸. 가업을 잇기 전 마지막 자유 시간에 우연히 배운 포커에 빠졌다. ' +
      '소심하지만 인내심만큼은 비정상적으로 강해서, 몇 시간이고 프리미엄 핸드를 기다릴 수 있다. ' +
      '온라인 마이크로 스테이크에서는 「이길 때만 나타나는 유령」이라 불렸다.',
    styleSummary: '수도승급 인내심의 록 — 참여율은 낮지만, 그녀가 팟에 들어왔다면 이유가 있다.',
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
    id: 'ara',
    name: '아라',
    nameNative: 'Ara',
    nationality: '한국',
    age: 21,
    color: '#FF4500',
    colorSecondary: '#DC143C',
    emoji: '🔥',
    personality: 'loose-aggressive',
    backstory:
      '서울 출신의 前 FPS 프로게이머. 팀 해체 후 방황하다가 「반응속도와 승부욕을 쓸 수 있는 게임」이라며 ' +
      '포커로 전향했다. 상대를 압박해서 무너뜨리는 순간을 세상에서 제일 좋아하고, 지는 건 죽어도 싫어한다. ' +
      '방송에서 유명해진 별명은 「서울의 불꽃」.',
    styleSummary: '풀스로틀 LAG — 넓은 레인지로 참전해 3벳과 배럴로 상대를 계속 몰아붙인다.',
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
    nameNative: 'Hana',
    nationality: '한국',
    age: 24,
    color: '#9370DB',
    colorSecondary: '#6A0DAD',
    emoji: '🌺',
    personality: 'tight-aggressive',
    backstory:
      '대전 카이스트 수학과 대학원생. GTO 솔버 논문을 쓰다가 「이론이 실전에서 통하는지 검증해야 한다」며 ' +
      '테이블에 앉기 시작했다. 모든 상대의 성향을 머릿속 스프레드시트에 기록하고 있으며, ' +
      '감정적인 플레이를 세상에서 가장 비효율적인 것으로 여긴다.',
    styleSummary: '교과서 그 자체의 TAG — 정확한 레인지, 정확한 사이징, 흔들리지 않는 정석.',
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
    id: 'chloe',
    name: '클로이',
    nameNative: 'Chloe',
    nationality: '미국',
    age: 23,
    color: '#87CEEB',
    colorSecondary: '#4169E1',
    emoji: '✨',
    personality: 'loose-passive',
    backstory:
      'LA 출신의 인기 스트리머. 「포커는 리액션 콘텐츠」라는 지론으로 방송을 시작했다가 진짜로 포커에 빠져버렸다. ' +
      '모든 플랍이 궁금해서 폴드 버튼이 어디 있는지 모른다는 소문이 있다. 칩을 잃어도 웃는 긍정왕이지만, ' +
      '그 밑도 끝도 없는 콜 때문에 블러퍼들의 천적이 되곤 한다.',
    styleSummary: '천하무적 콜링 스테이션 — 일단 보고, 끝까지 보고, 어쨌든 본다.',
    greeting: '하이~! 오늘도 재밌게 놀아보자구! Let\'s go~!',
    winQuote: '오마이갓! 이겼어! 완전 럭키~☆',
    loseQuote: '앗, 아쉽다~! 근데 방금 완전 재밌지 않았어?',
    bluffQuote: '헤헤~ 이번엔 좀 크게 가볼게? Watch this~!',
    foldQuote: '으엥… 이건 진짜 아닌 것 같아. 패스~!',
    thinkingQuote: '음~ 어떡할까나~? 궁금한데…?',
    chatMessages: [
      '이 판 완전 꿀잼이야~!',
      '방금 그 카드 뭐야?! 대박!',
      '포커 너무 재밌어! Best game ever~!',
      '궁금하니까 그냥 콜! 헤헤.',
      '다들 오늘 컨디션 어때~?',
    ],
  },
  {
    id: 'vivian',
    name: '비비안',
    nameNative: 'Vivienne',
    nationality: '프랑스',
    age: 26,
    color: '#00CED1',
    colorSecondary: '#008B8B',
    emoji: '🎭',
    personality: 'maniac',
    backstory:
      '파리의 극단에서 촉망받던 연극 배우. 「무대 위 어떤 배역보다 포커 테이블의 블러퍼가 더 완벽한 연기를 요구한다」며 ' +
      '돌연 은퇴하고 카드를 잡았다. 그녀에게 칩은 소품이고 팟은 무대다. 매 핸드를 한 편의 연극으로 만들어야 직성이 풀리며, ' +
      '관객(상대)이 지루해하는 것을 가장 큰 모욕으로 여긴다.',
    styleSummary: '무대 위의 매니악 — 압도적인 공격 빈도와 블러프로 테이블 전체를 연출한다.',
    greeting: '무대는 준비됐어… 자, 연극을 시작하지.',
    winQuote: '또 하나의 막이 완벽하게 내려갔군. 브라보.',
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
  {
    id: 'elena',
    name: '엘레나',
    nameNative: 'Елена',
    nationality: '러시아',
    age: 27,
    color: '#B9C2D9',
    colorSecondary: '#6E7BA8',
    emoji: '🌙',
    personality: 'balanced-pro',
    backstory:
      '모스크바 출신. 하이스테이크 온라인에서 「설원의 여왕」이라는 아이디로 전설이 된 프로. ' +
      '지금은 마카오 VIP룸을 오가며 산다. 말수가 적은 건 냉담해서가 아니라, 카드가 이미 충분히 말하고 있다고 ' +
      '믿기 때문. 어떤 배드빗에도 눈썹 하나 움직이지 않는 것으로 유명하다.',
    styleSummary: '얼음처럼 균형 잡힌 프로 — 모든 지표가 교과서 한가운데, 가끔 몬스터로 함정을 판다.',
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
