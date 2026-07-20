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
  // ─── 2026-07 로스터 확장: 마스코트(동물) 7 + 인간 3 ───────────────────────
  {
    id: 'mochi',
    name: '모찌',
    nameNative: 'Mochi',
    nationality: '볼주머니 왕국',
    age: 2,
    color: '#F5C97B',
    colorSecondary: '#D9A24B',
    emoji: '🐹',
    personality: 'nit',
    backstory:
      '해바라기씨 창고에서 태어난 수집광 햄스터. 어느 날 창고에 굴러들어온 포커칩 한 개를 씨앗인 줄 알고 ' +
      '볼주머니에 넣은 뒤로 칩 모으는 재미에 눈을 떴다. 문제는 한 번 모은 칩을 절대로, 결단코 내놓지 ' +
      '않으려 한다는 것. 테이블에서 가장 오래 버티고 가장 적게 베팅하는 것으로 유명하다.',
    styleSummary: '초울트라 니트 — 프리미엄이 아니면 볼주머니(스택)를 절대 열지 않는다.',
    greeting: '안녕하세요… 제 칩은 못 드려요. 미리 말해두는 거예요.',
    winQuote: '냠… 이 칩들, 전부 볼주머니에 넣을 거예요!',
    loseQuote: '내 칩… 내 소중한 칩이…! 흑흑…',
    bluffQuote: '이, 이번엔 진짜예요! 볼주머니를 걸었다구요!',
    foldQuote: '이런 패에 칩을 쓸 순 없어요. 아까워요.',
    thinkingQuote: '음… 칩을 낼 가치가 있을까…?',
    chatMessages: [
      '칩은 모으라고 있는 거예요.',
      '오늘 저녁은 해바라기씨… 아, 집중해야죠.',
      '베팅은 신중하게… 칩은 소중하니까요.',
      '그거 아세요? 칩 100개를 모으면 기분이 좋아요.',
      '제 스택 쳐다보지 마세요. 안 줄 거예요.',
    ],
  },
  {
    id: 'choco',
    name: '초코',
    nameNative: 'Choco',
    nationality: '일본',
    age: 3,
    color: '#D2691E',
    colorSecondary: '#8B4513',
    emoji: '🐶',
    personality: 'abc-honest',
    backstory:
      '카드 배달을 하다가 포커에 입문한 시바견. 주인이 가르쳐준 「좋은 패면 베팅, 나쁜 패면 폴드」를 ' +
      '삶의 신조로 삼고 한 번도 어긴 적이 없다. 거짓말(블러프)을 하면 꼬리가 저절로 흔들려서 들키기 때문에 ' +
      '아예 안 하기로 했다. 테이블에서 가장 정직한 플레이어.',
    styleSummary: '정직 그 자체의 ABC 플레이어 — 블러프 없음, 있으면 베팅, 없으면 폴드.',
    greeting: '멍! 오늘도 정정당당하게 부탁한다멍!',
    winQuote: '멍멍! 좋은 패였으니까 이긴 거다멍! 당연하다멍!',
    loseQuote: '끄응… 상대 패가 더 좋았다멍. 인정한다멍.',
    bluffQuote: '이, 이건 블러프가 아니다멍! …진짜다멍!',
    foldQuote: '나쁜 패는 폴드! 배운 대로 한다멍.',
    thinkingQuote: '좋은 패인가, 나쁜 패인가… 킁킁…',
    chatMessages: [
      '정정당당이 최고다멍!',
      '거짓말은 꼬리 때문에 못 한다멍…',
      '좋은 패가 오면 짖어버릴 것 같다멍. 참아야 한다멍.',
      '산책 갔다가 왔다멍. 이제 집중이다멍!',
      '다들 좋은 승부였다멍!',
    ],
  },
  {
    id: 'luna',
    name: '루나',
    nameNative: 'Luna',
    nationality: '달의 뒷면',
    age: 4,
    color: '#6B5B95',
    colorSecondary: '#2E2A4F',
    emoji: '🐱',
    personality: 'trapper',
    backstory:
      '밤마다 지붕 위를 걷다가 카지노 창문으로 포커를 훔쳐 배운 검은 고양이. 쥐를 잡을 때처럼 ' +
      '숨죽여 기다렸다가 덮치는 사냥 본능을 그대로 테이블에 가져왔다. 몬스터 핸드를 쥐고도 태연하게 ' +
      '체크하는 모습에 수많은 상대가 방심했다가 체크레이즈에 물렸다.',
    styleSummary: '그림자 속 트래퍼 — 몬스터를 숨기고 기다렸다가 체크레이즈로 덮친다.',
    greeting: '…어서 와. 오늘 밤은 달이 좋네냐.',
    winQuote: '후훗… 걸려들었네냐. 사냥 완료.',
    loseQuote: '냐… 오늘은 달이 흐렸을 뿐이야.',
    bluffQuote: '이 어둠 속에서… 내 패가 보이겠어냐?',
    foldQuote: '지금은 발톱을 숨길 때야. 패스.',
    thinkingQuote: '……(꼬리를 천천히 흔드는 중)',
    chatMessages: [
      '서두르는 사냥꾼은 쥐를 놓치는 법이냐.',
      '…지금 체크한 거, 의미가 있을까냐? 후훗.',
      '밤은 길어. 천천히 하자냐.',
      '함정이라고 생각했을 때는 이미 늦었냐.',
      '골골골… 아, 방심한 거 아니냐. 진짜야.',
    ],
  },
  {
    id: 'gumi',
    name: '구미',
    nameNative: '九尾',
    nationality: '한국',
    age: 999,
    color: '#FFB088',
    colorSecondary: '#E8623D',
    emoji: '🦊',
    personality: 'bluff-artist',
    backstory:
      '천 년을 살면 인간이 될 수 있다는 전설의 구미호. 정확히는 인간을 홀리는 데 도가 튼 999살 여우다. ' +
      '「간을 빼먹는 건 옛날 방식이고, 요즘은 칩을 빼먹는다」며 포커 테이블에 나타났다. ' +
      '아홉 개의 꼬리만큼이나 다양한 블러프 레퍼토리로 상대의 마음을 흔든다.',
    styleSummary: '천 년 묵은 블러프 아티스트 — 미드 레인지에 리버 블러프 빈도는 테이블 최고.',
    greeting: '어머, 맛있어 보이는… 아니, 반가운 손님이네?',
    winQuote: '호호, 또 홀렸구나? 칩은 잘 받을게♪',
    loseQuote: '어라…? 내 홀림이 안 통했다고? 천 년 만에 처음이야.',
    bluffQuote: '내 눈을 봐. 이 패가… 진짜 같아, 가짜 같아?',
    foldQuote: '이번엔 얌전히 물러날게. 여우는 도망도 빠르거든.',
    thinkingQuote: '어떻게 홀려볼까나…',
    chatMessages: [
      '구미호가 왜 아홉 꼬리게? 블러프도 아홉 종류거든♪',
      '지금 그 표정… 다 읽히는 거 알지?',
      '간 대신 칩만 가져갈게. 요즘은 그게 트렌드야.',
      '홀린다, 홀린다~ 너는 콜하고 싶어진다~',
      '천 년을 기다렸어. 이 팟을 위해서. …농담이야.',
    ],
  },
  {
    id: 'paeng',
    name: '팽팽',
    nameNative: 'Paeng',
    nationality: '남극',
    age: 5,
    color: '#7EC8E3',
    colorSecondary: '#33658A',
    emoji: '🐧',
    personality: 'three-bet-bomber',
    backstory:
      '남극 최남단 빙판 포커 리그 챔피언. 영하 60도의 눈보라 속에서 단련된 멘탈은 어떤 배드빗에도 ' +
      '녹지 않는다. 신조는 「미지근한 콜은 얼음보다 못하다」 — 콜드콜이라는 단어를 세상에서 제일 싫어해서, ' +
      '참전할 거면 레이즈, 아니면 폴드뿐이다.',
    styleSummary: '얼음의 3벳 폭격기 — 콜드콜 없음, 레이즈 아니면 폴드.',
    greeting: '…왔군. 남극식으로 하지. 미지근한 건 없다.',
    winQuote: '…당연한 결과다. 빙판에선 늘 이랬다.',
    loseQuote: '…흠. 빙산의 일각이다. 본체는 무사하다.',
    bluffQuote: '리레이즈다. …얼어붙었나?',
    foldQuote: '폴드. 콜이라는 미지근한 선택지는 없다.',
    thinkingQuote: '…(부리에서 냉기가 새어 나온다)',
    chatMessages: [
      '콜드콜? 차가운 건 내 쪽이다.',
      '남극에선 망설이면 얼어 죽는다.',
      '레이즈, 혹은 폴드. 그 사이는 없다.',
      '…이 정도 눈보라(베팅)는 산들바람이다.',
      '빙판 위에서 미끄러지는 건 언제나 상대 쪽이다.',
    ],
  },
  {
    id: 'draco',
    name: '드라코',
    nameNative: 'Draco',
    nationality: '드래곤 밸리',
    age: 1,
    color: '#3EB489',
    colorSecondary: '#1F7A5C',
    emoji: '🐲',
    personality: 'draw-gambler',
    backstory:
      '알에서 깨어나 처음 본 것이 금화가 아니라 포커칩 더미였던 아기 드래곤. 용족의 본능인 ' +
      '「보물 수집욕」이 팟을 향해 폭주한다. 아직 어려서 참을성은 없지만, 드로우가 뜨는 순간 ' +
      '눈이 반짝이며 불을 뿜는 버릇 때문에 모두가 알아챈다. 그래도 맞으면 정말 무섭다.',
    styleSummary: '드로우 겜블러 — 아웃츠만 보이면 세미블러프 올인, 오버벳은 기본.',
    greeting: '보물이다! 이 테이블, 반짝이는 게 잔뜩 있어!!',
    winQuote: '우와아! 보물 획득!! 내 둥지에 쌓을 거야!!',
    loseQuote: '내 보물… 가져가지 마아… 끄으응…',
    bluffQuote: '전부 건다!! 용은 물러서지 않아!!',
    foldQuote: '치… 이건 보물 냄새가 안 나. 패스!',
    thinkingQuote: '드로우… 드로우 어디 갔지…?',
    chatMessages: [
      '플러시 드로우는 용의 심장을 뛰게 해!!',
      '팟이 커진다 = 보물이 커진다!!',
      '언젠가 이 테이블의 칩 전부를 둥지로 만들 거야.',
      '불 뿜는 거 아니야! 하품한 거야!',
      '리버야, 부탁해…! 딱 한 장이면 돼!',
    ],
  },
  {
    id: 'kapi',
    name: '카피',
    nameNative: 'Kapi',
    nationality: '브라질',
    age: 6,
    color: '#B5885C',
    colorSecondary: '#7A5A38',
    emoji: '🦦',
    personality: 'pacifist-limper',
    backstory:
      '브라질 강가에서 온천 좋은 곳을 찾아 흘러흘러 「포커 도장」까지 온 카피바라. 싸우는 걸 싫어해서 ' +
      '레이즈 버튼이 어디 있는지도 모른다. 일단 다 같이 플랍을 보는 게 평화라고 믿는 림프의 화신. ' +
      '하지만 큰 베팅이 날아오면 미련 없이 접고 온천 생각을 한다. 머리 위 유자는 친구다.',
    styleSummary: '평화주의 림퍼 — 뭐든 보러 가지만, 싸움(압박)이 나면 조용히 접는다.',
    greeting: '아… 안녕… 다들 사이좋게 하자…',
    winQuote: '어… 이겼네…? 고마워… 온천 갈 때 쓸게…',
    loseQuote: '괜찮아… 칩보다 마음의 평화가 중요하니까…',
    bluffQuote: '이번엔… 조금 세게 가볼게… 미안…',
    foldQuote: '싸움은 좀… 나는 빠질게…',
    thinkingQuote: '음… (유자가 굴러떨어질 것 같다)',
    chatMessages: [
      '다 같이 플랍 보면… 그게 평화야…',
      '온천 들어가고 싶다…',
      '레이즈는… 너무 사나워…',
      '싸우지 말고… 사이좋게 하자…',
      '유자 떨어질 것 같아서… 체크할게…',
    ],
  },
  {
    id: 'yuzuki',
    name: '유즈키',
    nameNative: '柚月',
    nationality: '일본',
    age: 19,
    color: '#E63946',
    colorSecondary: '#A4161A',
    emoji: '⛩️',
    personality: 'intuition',
    backstory:
      '유서 깊은 신사의 무녀. 참배객이 두고 간 트럼프 카드로 점을 치다가 「카드가 미래를 속삭인다」는 ' +
      '사실을 깨달았다. 확률도 포지션도 모르지만, 신탁이 내리면 팟 오즈 따위는 가볍게 무시하고 ' +
      '돈크벳을 날린다. 무서운 건 그 직감이 얄미울 정도로 자주 맞는다는 것.',
    styleSummary: '신탁 직감파 — 이론 무시, 느낌이 오면 포지션 불문 돈크벳.',
    greeting: '어서 오세요. 오늘의 운세는… 후후, 비밀이에요.',
    winQuote: '신탁대로예요. 카드님이 미리 알려주셨거든요.',
    loseQuote: '어머… 오늘은 신님이 낮잠을 주무시나 봐요.',
    bluffQuote: '이 베팅은 신의 뜻이에요. 거스르시겠어요?',
    foldQuote: '불길한 기운이 느껴져요… 물러날게요.',
    thinkingQuote: '(눈을 감고 신탁을 기다리는 중…)',
    chatMessages: [
      '오늘 아침 흰 새가 세 번 울었어요. 길조예요.',
      '리버에 하트가 올 것 같은… 그런 예감이 들어요.',
      '팟 오즈요? 신탁 앞에서는 무의미해요.',
      '방금 바람이 바뀌었어요. 느끼셨나요?',
      '카드님은 거짓말을 하지 않아요. 사람은 하지만요.',
    ],
  },
  {
    id: 'lin',
    name: '린',
    nameNative: '琳',
    nationality: '대만',
    age: 24,
    color: '#8FBC5A',
    colorSecondary: '#5E8C3A',
    emoji: '🍵',
    personality: 'small-ball',
    backstory:
      '타이베이의 백년 찻집 후계자. 「좋은 차는 작은 잔에 여러 번 우려내는 것」이라는 다도 철학을 ' +
      '포커에 그대로 옮겼다. 큰 베팅 한 방 대신 작은 벳을 꾸준히 우려내 팟을 천천히 데우고, ' +
      '물이 끓어 넘치기 전(3벳)에는 조용히 잔을 내려놓는다. 향에 취한 상대는 어느새 스택이 줄어 있다.',
    styleSummary: '스몰볼 아티스트 — 미니 레이즈와 작은 c벳을 꾸준히, 팟이 끓으면 후퇴.',
    greeting: '잘 오셨어요. 차 한잔하며 천천히 즐겨보죠.',
    winQuote: '좋은 찻잎은 우릴수록 향이 나요. 이 팟처럼요.',
    loseQuote: '이번 잔은 조금 떫었네요. 다음 잔을 우리죠.',
    bluffQuote: '이 향… 진짜인지 아닌지, 드셔보시겠어요?',
    foldQuote: '물이 너무 끓네요. 잔을 내려놓을게요.',
    thinkingQuote: '(찻잔을 천천히 돌리는 중…)',
    chatMessages: [
      '급하게 마시면 혀를 데는 법이에요.',
      '작은 베팅에도 향은 충분히 우러나요.',
      '이 테이블, 오늘따라 물이 잘 끓네요.',
      '한 모금씩, 한 스트리트씩이에요.',
      '차가 식기 전에… 콜하시겠어요?',
    ],
  },
  {
    id: 'ingrid',
    name: '잉그리드',
    nameNative: 'Ingrid',
    nationality: '노르웨이',
    age: 22,
    color: '#708090',
    colorSecondary: '#36454F',
    emoji: '🤘',
    personality: 'tight-maniac',
    backstory:
      '오슬로의 바이킹 메탈 밴드 「RAGNAROK」의 드러머. 공연이 없는 날 심심풀이로 시작한 포커에서 ' +
      '드럼 솔로와 똑같은 철학을 발견했다 — 「기다렸다가, 터뜨린다」. 평소엔 조용히 폴드를 반복하다가 ' +
      '일단 팟에 들어가면 브레이크 없는 더블 베이스 연타처럼 배럴을 멈추지 않는다.',
    styleSummary: '타이트 매니악 — 좁은 레인지로 참전, 들어가면 후퇴 없는 풀 배럴.',
    greeting: '요! 오늘 세트리스트는… 전부 헤비하게 간다!',
    winQuote: '이게 내 드럼 솔로다!! 라그나로크!!',
    loseQuote: '칫… 오늘은 스틱이 부러졌네. 다음 곡 가자.',
    bluffQuote: '풀 볼륨으로 간다!! 버틸 수 있겠어?!',
    foldQuote: '이 곡은 스킵. 인트로부터 별로야.',
    thinkingQuote: '(스틱으로 테이블을 두드리는 중…)',
    chatMessages: [
      '조용한 벌스 다음엔 반드시 폭발하는 코러스가 온다.',
      '내 베팅은 더블 베이스야. 멈추지 않아.',
      '지금 이 테이블, BPM이 너무 느린데?',
      '폴드는 쉼표일 뿐이야. 클라이맥스를 위한.',
      '헤드뱅잉 준비됐어? 큰 팟이 온다!',
    ],
  },
];

export function getCharacterById(id: string): CharacterProfile | undefined {
  if (id === 'dealer') return DEALER_CHARACTER;
  return BOT_CHARACTERS.find(c => c.id === id);
}

export function getRandomBotCharacter(excludeIds: string[] = []): CharacterProfile {
  const available = BOT_CHARACTERS.filter(c => !excludeIds.includes(c.id));
  // 캐릭터 16명 > 좌석 6개라 정상 경로에선 소진되지 않음 — 소진 시에도 특정 캐릭터 편중 없이 랜덤
  if (available.length === 0) {
    return BOT_CHARACTERS[Math.floor(Math.random() * BOT_CHARACTERS.length)];
  }
  return available[Math.floor(Math.random() * available.length)];
}
