import { HAND_RANK_KO } from '../poker/evaluator';
import type { CoachAdvice, CoachReason } from './coach-brain';

/**
 * 파트너 훈수 대사 — 캐릭터 말투 × 이유(`CoachReason`). 순수 모듈 (회귀: `coach-lines.test.ts`).
 *
 * 톤 계약 (경쟁작에서 "쿨러를 내 탓으로 돌리는 코치"가 가장 미움받았다):
 * - 훈수는 부드러운 제안이다. 명령·질책 금지.
 * - 안 따랐을 때는 궁금해하거나 지켜보는 반응만 한다 (꾸짖지 않는다).
 * - 따랐는데 쇼다운에서 졌으면 "결정은 맞았고 운이 나빴다"로 위로한다.
 * 포커 용어는 원어 표기(핸드·폴드·콜·체크·레이즈·3벳·팟·쇼다운) — 손/판/접다/열다 금지.
 *
 * 자리표시자: {pos} 포지션 · {top} 핸드 상위 % · {req} 필요 승률 % · {draw} 드로우 % · {outs} 아우츠 ·
 * {size} 벳 크기 BB · {stack} 스택 BB · {made} 메이드 핸드 이름. 값이 없는 자리표시자를 가진 문장은
 * 고르지 않으므로, 이유마다 자리표시자 없는 문장을 하나 이상 둔다.
 * 문장 선택은 결정론(`seed` — handNumber·actionSeq)이라 렌더 중 Math.random이 없다.
 */

export type CoachReaction = 'followed' | 'ignored' | 'followed-won' | 'followed-lost';

interface CoachVoice {
  advice: Record<CoachReason, readonly string[]>;
  reaction: Record<CoachReaction, readonly string[]>;
}

const SAKURA: CoachVoice = {
  advice: {
    'open-raise': [
      '{pos}에서 상위 {top}%… 오, 오픈 레이즈 {size}BB 가요!',
      '이, 이 핸드면 {pos}에선 레이즈예요… {size}BB!',
      '그, 그건… 들어가도 돼요! 레이즈해요.',
    ],
    'iso-raise': [
      '리, 림프가 들어왔어요… {size}BB로 크게 레이즈해요!',
      '그, 그건… 크게 레이즈해서 혼자 상대해요!',
    ],
    'fold-unopened': [
      '{pos}에서 상위 {top}%는 조, 조금 약해요… 폴드해요.',
      '이, 이번엔 쉬어요… 폴드도 실력이에요.',
    ],
    'free-check': [
      '고, 공짜로 볼 수 있어요… 체크해요!',
      '그, 그냥 체크하고 다음 카드 봐요.',
    ],
    'three-bet': [
      '상위 {top}%… 프, 프리미엄이에요! 3벳 {size}BB!',
      '이, 이건 강해요… 3벳으로 맞서요!',
    ],
    'call-open': [
      '상위 {top}%면… 코, 콜로 따라가요.',
      '그, 그건 괜찮은 핸드예요… 콜해요.',
    ],
    'fold-vs-open': [
      '오픈 상대로 상위 {top}%는… 폴, 폴드해요.',
      '사, 상대가 강해 보여요… 폴드해요.',
    ],
    'four-bet': [
      '3벳 상대로도 이건… 4, 4벳 {size}BB 가요!',
      '이, 이 핸드는 물러서지 않아요… 4벳!',
    ],
    'call-three-bet': [
      '3벳이지만 상위 {top}%… 코, 콜은 괜찮아요.',
      '그, 그건 버틸 만해요… 콜해요.',
    ],
    'fold-vs-three-bet': [
      '3벳엔 상위 {top}%는 무, 무리예요… 폴드.',
      '이, 이번엔 양보해요… 폴드해요.',
    ],
    'short-push': [
      '남은 칩이 {stack}BB… 사, 상위 {top}%면 올인이에요!',
      '지, 지금은 올인이 제일 좋아요…!',
    ],
    'short-fold': [
      '{stack}BB면… 더, 더 좋은 핸드를 기다려요. 폴드.',
      '조, 조금만 참아요… 폴드해요.',
    ],
    'value-bet': [
      '{made}예요…! 크, 크게 {size}BB 벳해요!',
      '강한 패예요… 밸, 밸류 벳 가요!',
    ],
    'thin-value': [
      '탑페어예요… 자, 작게 {size}BB 벳해요.',
      '그, 그건 앞서 있을 거예요… 작게 벳!',
    ],
    'semi-bluff': [
      '아우츠 {outs}장, 리버까지 {draw}%… 벳으로 밀어요!',
      '드, 드로우지만… 벳으로 압박해요!',
    ],
    'pot-control': [
      '애, 애매한 패예요… 체크로 팟을 작게 해요.',
      '여, 여기선 체크가 편해요…',
    ],
    'raise-value': [
      '{made}…! 이, 이건 레이즈예요! {size}BB!',
      '정말 강해요… 레이즈로 팟을 키워요!',
    ],
    'call-strong': [
      '강한 핸드니까… 코, 콜로 따라가요.',
      '그, 그건 버텨도 돼요… 콜!',
    ],
    'call-price': [
      '필요 승률 {req}%… 가, 가격이 맞아요. 콜!',
      '이, 이 정도 가격이면 콜해요.',
    ],
    'call-implied': [
      '{draw}%면 조금 모자라도… 와, 완성되면 커요. 콜!',
      '드, 드로우가 좋아요… 콜해요.',
    ],
    'fold-price': [
      '필요 승률 {req}%는… 너, 너무 비싸요. 폴드해요.',
      '이, 이번엔 폴드해요… 다음이 있어요.',
    ],
  },
  reaction: {
    followed: [
      '헤헤… 제 말 들어 줘서 고마워요♥',
      '가, 같이 고른 거예요…! 좋아요♥',
      '당신이랑 맞춰서… 두근거려요♥',
    ],
    ignored: [
      '아, 그렇게 하는군요…! 어떻게 될까요?',
      '오… 당신 생각도 궁금해요.',
      '그, 그런 방법도 있죠…! 지켜볼게요.',
    ],
    'followed-won': [
      '해, 해냈어요! 우리 둘이 이긴 거예요♥',
      '와아…! 같이 이겨서 너무 기뻐요!',
    ],
    'followed-lost': [
      '괘, 괜찮아요… 결정은 맞았어요. 운이 나빴어요.',
      '좋은 선택이었어요… 카, 카드가 심술부린 거예요.',
    ],
  },
};

/** 그 밖의 캐릭터 — 차분한 존댓말 중립 말투 (캐릭터별 말투는 다음 단계에서 확장) */
const NEUTRAL: CoachVoice = {
  advice: {
    'open-raise': ['{pos}에서 상위 {top}%예요. {size}BB 오픈 레이즈해요.', '이 핸드면 오픈 레이즈해요.'],
    'iso-raise': ['림프가 들어왔어요. {size}BB로 크게 레이즈해요.', '크게 레이즈해서 한 명만 상대해요.'],
    'fold-unopened': ['{pos}에서 상위 {top}%는 약해요. 폴드해요.', '이번엔 쉬어 가요. 폴드해요.'],
    'free-check': ['공짜로 볼 수 있어요. 체크해요.', '체크하고 다음 카드를 봐요.'],
    'three-bet': ['상위 {top}% 프리미엄이에요. 3벳 {size}BB.', '강한 핸드예요. 3벳해요.'],
    'call-open': ['상위 {top}%면 콜로 따라가요.', '괜찮은 핸드예요. 콜해요.'],
    'fold-vs-open': ['오픈 상대로 상위 {top}%는 약해요. 폴드해요.', '상대가 강해 보여요. 폴드해요.'],
    'four-bet': ['3벳 상대로도 강해요. 4벳 {size}BB.', '물러설 핸드가 아니에요. 4벳해요.'],
    'call-three-bet': ['3벳이지만 상위 {top}%면 콜해요.', '버틸 만한 핸드예요. 콜해요.'],
    'fold-vs-three-bet': ['3벳엔 상위 {top}%로는 무리예요. 폴드해요.', '이번엔 양보해요. 폴드해요.'],
    'short-push': ['남은 칩 {stack}BB, 상위 {top}%면 올인이에요.', '지금은 올인이 가장 좋아요.'],
    'short-fold': ['{stack}BB면 더 좋은 핸드를 기다려요. 폴드.', '조금만 참아요. 폴드해요.'],
    'value-bet': ['{made}예요. {size}BB 크게 벳해요.', '강한 패예요. 밸류 벳해요.'],
    'thin-value': ['탑페어예요. {size}BB 작게 벳해요.', '앞서 있을 거예요. 작게 벳해요.'],
    'semi-bluff': ['아우츠 {outs}장, 리버까지 {draw}%. 벳으로 밀어요.', '드로우예요. 벳으로 압박해요.'],
    'pot-control': ['애매한 패예요. 체크로 팟을 작게 해요.', '여기선 체크가 좋아요.'],
    'raise-value': ['{made}예요. {size}BB로 레이즈해요.', '아주 강해요. 레이즈로 팟을 키워요.'],
    'call-strong': ['강한 핸드예요. 콜로 따라가요.', '버텨도 되는 패예요. 콜해요.'],
    'call-price': ['필요 승률 {req}%, 가격이 맞아요. 콜해요.', '이 가격이면 콜해요.'],
    'call-implied': ['{draw}%로 조금 모자라도 완성되면 커요. 콜.', '좋은 드로우예요. 콜해요.'],
    'fold-price': ['필요 승률 {req}%는 비싸요. 폴드해요.', '이번엔 폴드해요. 다음이 있어요.'],
  },
  reaction: {
    followed: ['같이 골랐네요. 좋아요♥', '말대로 해 줘서 고마워요♥'],
    ignored: ['그렇게 가는군요. 어떻게 될지 봐요.', '그 선택도 궁금하네요. 지켜볼게요.'],
    'followed-won': ['같이 이겼어요! 기뻐요♥', '좋은 결정이 팟으로 돌아왔어요!'],
    'followed-lost': ['결정은 맞았어요. 이번엔 운이 없었을 뿐이에요.', '좋은 선택이었어요. 카드가 안 따라 줬어요.'],
  },
};

const VOICES: Readonly<Record<string, CoachVoice>> = { sakura: SAKURA };

export function coachVoiceFor(characterId: string | null | undefined): CoachVoice {
  return (characterId && VOICES[characterId]) || NEUTRAL;
}

/** 대사에 끼울 값 — 숫자는 읽기 쉽게 다듬는다 */
function placeholderValues(facts: CoachAdvice['facts']): Record<string, string | undefined> {
  const pct = (value: number | undefined) => (value === undefined ? undefined : String(Math.max(1, Math.round(value))));
  return {
    pos: facts.position,
    top: pct(facts.handTopPct),
    req: pct(facts.requiredPct),
    draw: pct(facts.drawPct),
    outs: facts.outs === undefined ? undefined : String(facts.outs),
    size: facts.sizeBb === undefined ? undefined : String(facts.sizeBb),
    stack: facts.stackBb === undefined ? undefined : String(facts.stackBb),
    made: facts.made ? HAND_RANK_KO[facts.made] : undefined,
  };
}

const PLACEHOLDER = /\{(\w+)\}/g;

function fill(template: string, values: Record<string, string | undefined>): string | null {
  let missing = false;
  const text = template.replace(PLACEHOLDER, (_, key: string) => {
    const value = values[key];
    if (value === undefined) missing = true;
    return value ?? '';
  });
  return missing ? null : text;
}

function pick(lines: readonly string[], seed: number, values: Record<string, string | undefined> = {}): string {
  const filled = lines.map(line => fill(line, values)).filter((line): line is string => line !== null);
  if (filled.length === 0) return '';
  const index = Math.abs(Math.trunc(seed)) % filled.length;
  return filled[index];
}

/** 훈수 한 줄 — 같은 seed(같은 결정 시점)면 같은 문장 */
export function coachAdviceLine(characterId: string | null | undefined, advice: CoachAdvice, seed: number): string {
  return pick(coachVoiceFor(characterId).advice[advice.reason], seed, placeholderValues(advice.facts));
}

export function coachReactionLine(characterId: string | null | undefined, reaction: CoachReaction, seed: number): string {
  return pick(coachVoiceFor(characterId).reaction[reaction], seed);
}

/**
 * 버튼 라벨의 액션 부분 — `[사쿠라 말대로 · 레이즈 2.5BB]`.
 * 크기는 앱 공용 BB 표기(소수 첫째 자리, "2.5BB")와 같게 맞춘다.
 */
export function coachActionLabel(
  advice: CoachAdvice,
  opts: { bigBlind: number; isBet: boolean; callIsAllIn?: boolean },
): string {
  switch (advice.action) {
    case 'fold': return '폴드';
    case 'check': return '체크';
    case 'call': return opts.callIsAllIn ? '콜 (올인)' : '콜';
    case 'all-in': return '올인';
    case 'raise': {
      const verb = opts.isBet ? '벳' : '레이즈';
      if (advice.amount === undefined || opts.bigBlind <= 0) return verb;
      const bb = Math.round((advice.amount / opts.bigBlind) * 10) / 10;
      return `${verb} ${bb.toLocaleString()}BB`;
    }
  }
}
