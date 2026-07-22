import { getCharacterById } from './index';

/**
 * 파트너(인연 캐릭터) 상황 대사 — 수기 스크립트 수직 슬라이스.
 *
 * 설계 (2026-07-22 리텐션 기획 + 레드팀 절충):
 * - AI 생성 미사용 — 핵심 관계 대사는 전부 수기 승인 스크립트 (캐릭터 붕괴 리스크 0)
 * - 클라이언트 전용 — 파트너가 "나에게" 하는 말이라 방 브로드캐스트에 싣지 않는다
 *   (멀티 휴먼 테이블에서 타인의 티어 대사가 새는 문제 원천 차단)
 * - 티어 2단계: t1(인연 Lv1~4, 면식) / t2(Lv5+, 단짝) — 수직 슬라이스는 사쿠라/아라/엘레나,
 *   나머지 캐릭터는 프로필 기본 대사로 폴백 (티어 무관)
 * - 티어 대사를 확장할 땐 캐릭터별 성장 축을 지켜라: 사쿠라=말더듬 감쇠, 아라=츤데레 해동,
 *   엘레나=침묵 해빙(문장 수 증가). '전원 애인화 금지' — 관계 종착지는 캐릭터마다 다르다.
 */

export type PartnerMoment =
  | 'lobby-dawn'      // 새벽(0~5시) 로비 인사
  | 'lobby-day'       // 주간 로비 인사
  | 'lobby-night'     // 밤(21시~) 로비 인사
  | 'lobby-reunion'   // 3일+ 공백 후 재회
  | 'lobby-talk'      // 말 걸기 (탭)
  | 'table-greeting'  // 같은 테이블에서 핸드 시작
  | 'user-bigwin'     // 유저 빅팟 승리
  | 'user-bust'       // 유저 파산/큰 패배 위로
  | 'farewell';       // 세션 종료 작별

export type PartnerTier = 1 | 2;

/** 인연 레벨 → 티어 (t2 = Lv5+, '대사 꾸러미' 보상 레벨과 일치) */
export function getPartnerTier(affinityLevel: number): PartnerTier {
  return affinityLevel >= 5 ? 2 : 1;
}

type MomentLines = Record<PartnerMoment, { t1: string[]; t2: string[] }>;

const SCRIPTS: Record<string, MomentLines> = {
  sakura: {
    'lobby-dawn': {
      t1: ['이, 이 시간까지 안 주무셨어요…? 저, 저도지만…'],
      t2: ['새벽의 도장, 조용해서 좋죠. …당신이 와서 더 좋아요.'],
    },
    'lobby-day': {
      t1: ['아, 안녕하세요…! 오늘도 와 주셨네요.', '어, 어서 오세요… 기다리고 있었어요…!'],
      t2: ['어서 오세요. 오늘은 왠지 좋은 카드가 올 것 같아요.', '왔네요! …후후, 이제 안 떨고 인사할 수 있어요.'],
    },
    'lobby-night': {
      t1: ['바, 밤 포커는 처음이라… 가, 같이 있어 주실 거죠?'],
      t2: ['밤엔 다들 대담해져요. …우리는 침착하게 가요.'],
    },
    'lobby-reunion': {
      t1: ['오, 오랜만이에요…! 무슨 일 있으셨나 걱정했어요…'],
      t2: ['…돌아오셨네요. 사흘 동안 매일 테이블 쪽을 봤어요. 진짜예요.'],
    },
    'lobby-talk': {
      t1: ['저, 저요? 프리미엄 핸드를 기다리는 중이에요… 몇 시간이든요.', '이, 인내심만은 자신 있어요…!', '포커는… 기다림의 게임이니까요…'],
      t2: ['료칸 일을 잇기 전에… 이 시간이 제일 소중해요.', '당신이 콜할 때, 사실 저도 같이 두근거려요.', '오늘은… 제가 먼저 말 걸어보고 싶었는데. 선수를 뺏겼네요.'],
    },
    'table-greeting': {
      t1: ['가, 같은 테이블이네요…! 사, 살살 부탁드려요…'],
      t2: ['같은 테이블이라니, 오늘은 운이 좋네요. …당신 상대로는 진심으로 할 거예요?'],
    },
    'user-bigwin': {
      t1: ['우, 우와… 방금 팟, 정말 컸어요…! 머, 멋있었어요…!'],
      t2: ['봤어요, 방금 그 플레이! …제 일처럼 기뻐요. 아니, 제 일보다 더요.'],
    },
    'user-bust': {
      t1: ['괘, 괜찮아요…? 우, 운이 나빴을 뿐이에요… 정말요.'],
      t2: ['…괜찮아요. 당신 플레이는 틀리지 않았어요. 제가 봤으니까, 확실해요.'],
    },
    farewell: {
      t1: ['오, 오늘도 수고하셨어요…! 또… 또 와 주실 거죠?'],
      t2: ['오늘도 즐거웠어요. 내일도… 기다릴게요. 아, 안 떨고 말했다…!'],
    },
  },
  ara: {
    'lobby-dawn': {
      t1: ['이 시간에 포커? …뭐, 나야 상관없지만.'],
      t2: ['새벽 감성으로 콜 남발하기만 해봐. …커피나 마시고 시작해.'],
    },
    'lobby-day': {
      t1: ['왔어? 흥, 오늘은 칩 좀 지켜보시지.', '어, 너구나. 판 깔아줄 테니까 준비나 해.'],
      t2: ['어, 또 왔네. …뭐, 네가 있어야 판이 재밌긴 하지.', '기다렸… 아니, 방금 온 거야. 진짜야. 빨리 앉기나 해.'],
    },
    'lobby-night': {
      t1: ['밤 포커는 실수 나오기 딱 좋은 시간이야. 조심해.'],
      t2: ['밤엔 내 반응속도가 더 좋아지거든? …너도 지지 말라고.'],
    },
    'lobby-reunion': {
      t1: ['…오랜만이네. 어디서 뭐 하다 왔어?'],
      t2: ['야, 사흘 만이잖아. …벼, 별로 안 기다렸거든? 그냥 그렇다고.'],
    },
    'lobby-talk': {
      t1: ['왜. 할 말 있어?', 'FPS 시절 얘기? …다음에. 지금은 포커 모드야.', '내 별명이 서울의 불꽃인 건 알고 있지?'],
      t2: ['…뭐야, 그냥 말 걸고 싶었던 거야? …나쁘지 않네.', '너랑 치는 판이 제일 재밌어. …방금 건 못 들은 걸로 해.', '언젠가 너랑 헤즈업 결승 서보고 싶다. 진심으로.'],
    },
    'table-greeting': {
      t1: ['같은 테이블이네. 봐주는 건 없어.'],
      t2: ['오, 너랑 같은 판이야? 좋아 — 오늘은 전력으로 간다.'],
    },
    'user-bigwin': {
      t1: ['방금 그 팟… 흥, 제법이잖아?'],
      t2: ['봤어 봤어! 그게 바로 내가 아는 네 플레이지! …큼, 아무튼 잘했어.'],
    },
    'user-bust': {
      t1: ['…방금 건 네 잘못 아니야. 그러니까 표정 풀어.'],
      t2: ['야. 그런 배드빗은 프로도 못 피해. 칩은 다시 따면 돼 — 내가 보증할게.'],
    },
    farewell: {
      t1: ['가게? …내일도 와. 연습 상대가 필요하니까.'],
      t2: ['오늘 몇 판은 진짜 좋았어. …내일도 보자. 약속이야.'],
    },
  },
  elena: {
    'lobby-dawn': {
      t1: ['…이 시간엔, 카드가 더 솔직해져.'],
      t2: ['…새벽이네. 모스크바가 생각나는 시간이야. …앉아.'],
    },
    'lobby-day': {
      t1: ['…왔구나. 앉아.', '…준비됐으면, 시작하지.'],
      t2: ['…왔구나. 오늘은 네 페이스대로 해. 나는 지켜볼 테니.'],
    },
    'lobby-night': {
      t1: ['…밤. 좋은 시간이야.'],
      t2: ['…밤의 판은 길어. 네가 있으면, 지루하지 않겠네.'],
    },
    'lobby-reunion': {
      t1: ['…오랜만이야.'],
      t2: ['…사흘. …세고 있었던 건 아니야. 그냥, 알고 있었을 뿐.'],
    },
    'lobby-talk': {
      t1: ['…카드로 이야기하자.', '…질문은 테이블에서.'],
      t2: ['…설원의 여왕이라는 아이디의 유래? …다음에. 길어지니까.', '…이상하네. 네가 앉으면, 판이 길어도 지루하지 않아.'],
    },
    'table-greeting': {
      t1: ['…같은 테이블이군.'],
      t2: ['…너와 같은 판이라. …나쁘지 않은 하루가 되겠어.'],
    },
    'user-bigwin': {
      t1: ['…좋은 핸드였어.'],
      t2: ['…방금 라인, 완벽했어. …기록해 둘 만해.'],
    },
    'user-bust': {
      t1: ['…분산이야. 네 판단은 맞았어.'],
      t2: ['…배드빗에 눈썹 하나 안 움직이는 법, 알려줄까. …오늘은, 그냥 쉬어도 돼.'],
    },
    farewell: {
      t1: ['…수고했어.'],
      t2: ['…오늘 판, 나쁘지 않았어. …내일도, 기다리지.'],
    },
  },
};

/** 시간대 → 로비 인사 moment */
export function lobbyGreetingMoment(hour: number): PartnerMoment {
  if (hour >= 0 && hour < 6) return 'lobby-dawn';
  if (hour >= 21) return 'lobby-night';
  return 'lobby-day';
}

/**
 * 파트너 대사 조회 — 스크립트 캐릭터(사쿠라/아라/엘레나)는 티어별, 나머지는 프로필 폴백.
 * pick은 0~1 난수(기본 Math.random) — 테스트 결정론화용 주입.
 */
export function getPartnerLine(
  characterId: string,
  moment: PartnerMoment,
  tier: PartnerTier,
  pick: () => number = Math.random,
): string | null {
  const script = SCRIPTS[characterId];
  if (script) {
    const lines = tier === 2 && script[moment].t2.length > 0
      ? script[moment].t2
      : script[moment].t1;
    if (lines.length > 0) return lines[Math.floor(pick() * lines.length) % lines.length];
  }
  // 폴백 — 미스크립트 캐릭터는 프로필 기본 대사로 (티어 무관, 관계 성장 연출은 없음)
  const character = getCharacterById(characterId);
  if (!character) return null;
  switch (moment) {
    case 'lobby-dawn':
    case 'lobby-day':
    case 'lobby-night':
    case 'lobby-reunion':
    case 'table-greeting':
      return character.greeting;
    case 'lobby-talk': {
      const pool = character.chatMessages;
      return pool.length > 0 ? pool[Math.floor(pick() * pool.length) % pool.length] : character.greeting;
    }
    case 'user-bigwin':
      return character.winQuote || character.greeting;
    case 'user-bust':
      return character.loseQuote || character.greeting;
    case 'farewell':
      return character.greeting;
  }
}

/** 수직 슬라이스(티어 대사 보유) 캐릭터인가 — UI가 '관계 성장' 배지를 달지 판단 */
export function hasTieredPartnerScript(characterId: string): boolean {
  return characterId in SCRIPTS;
}
