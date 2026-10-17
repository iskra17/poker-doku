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

/** 아라 — 반말 츤데레. 훈수는 자신만만하게, 안 따르면 승부욕으로 지켜본다 */
const ARA: CoachVoice = {
  advice: {
    'open-raise': [
      '{pos}에서 상위 {top}%? 당연히 {size}BB 레이즈지!',
      '이 핸드면 레이즈야. 망설이지 마!',
    ],
    'iso-raise': [
      '림프? 만만하네. {size}BB로 크게 레이즈해!',
      '림프한 녀석, 레이즈로 혼자 상대해 줘!',
    ],
    'fold-unopened': [
      '{pos}에서 상위 {top}%는 약해. 폴드.',
      '흥, 이런 핸드에 칩 쓸 거 없어. 폴드!',
    ],
    'free-check': [
      '공짜로 보는 건데 굳이? 체크해.',
      '체크하고 다음 카드 봐. 서두를 거 없어.',
    ],
    'three-bet': [
      '상위 {top}%! 3벳 {size}BB로 밀어붙여!',
      '이건 강해. 3벳으로 박살 내 줘!',
    ],
    'call-open': [
      '상위 {top}%면 콜 정도는 해야지.',
      '나쁘지 않네. 콜로 따라가!',
    ],
    'fold-vs-open': [
      '오픈 상대로 상위 {top}%? 폴드야.',
      '이건 아니야. 폴드하고 다음에 갚아 줘.',
    ],
    'four-bet': [
      '3벳? 웃기지 마. 4벳 {size}BB!',
      '물러설 핸드 아니야. 4벳 가!',
    ],
    'call-three-bet': [
      '3벳이라도 상위 {top}%면 콜이야.',
      '쫄 거 없어. 콜로 버텨!',
    ],
    'fold-vs-three-bet': [
      '3벳에 상위 {top}%는 무리야. 폴드.',
      '이번엔 양보해. 폴드!',
    ],
    'short-push': [
      '{stack}BB 남았어? 상위 {top}%면 올인이지!',
      '지금이야. 올인으로 승부해!',
    ],
    'short-fold': [
      '{stack}BB면 더 좋은 핸드 기다려. 폴드.',
      '참는 것도 실력이야. 폴드!',
    ],
    'value-bet': [
      '{made}잖아! {size}BB 크게 벳해!',
      '강한 패야. 밸류 벳으로 뜯어내!',
    ],
    'thin-value': [
      '탑페어야. {size}BB 작게 벳해 둬.',
      '앞서 있을 거야. 작게 벳!',
    ],
    'semi-bluff': [
      '아우츠 {outs}장, {draw}%! 벳으로 밀어!',
      '드로우라도 벳으로 압박하는 거야!',
    ],
    'pot-control': [
      '애매하네. 체크로 팟 작게 가.',
      '여기선 무리하지 마. 체크.',
    ],
    'raise-value': [
      '{made}! {size}BB 레이즈로 터뜨려!',
      '엄청 강해. 레이즈로 팟 키워!',
    ],
    'call-strong': [
      '강한 핸드잖아. 콜로 버텨!',
      '여기서 물러설 거야? 콜!',
    ],
    'call-price': [
      '필요 승률 {req}%. 가격 맞아, 콜!',
      '이 가격이면 콜이지.',
    ],
    'call-implied': [
      '{draw}%라도 완성되면 크게 먹어. 콜!',
      '드로우 좋잖아. 콜해!',
    ],
    'fold-price': [
      '필요 승률 {req}%? 너무 비싸. 폴드.',
      '이건 비싸. 폴드하고 다음에 가!',
    ],
  },
  reaction: {
    followed: [
      '흥, 잘 들었네. …나쁘지 않아.',
      '그래, 그거야! 역시 내 파트너지.',
      '…따라 줘서 고, 고맙다는 건 아니거든!',
    ],
    ignored: [
      '흥, 네 방식대로 해 봐. 지켜볼 테니까.',
      '오, 배짱 있네? 어디 한번 보자.',
    ],
    'followed-won': [
      '봤지? 우리가 이긴 거야!',
      '하핫! 역시 우리 콤비가 최강이야!',
    ],
    'followed-lost': [
      '치잇… 그래도 결정은 맞았어. 카드가 운이 없었던 거야.',
      '좋은 선택이었어. 다음엔 우리가 이겨.',
    ],
  },
};

/** 하나 — '당신' 존댓말 분석가. 숫자로 근거를 대고, 다른 선택은 데이터로 존중한다 */
const HANA: CoachVoice = {
  advice: {
    'open-raise': [
      '{pos} 상위 {top}%. {size}BB 오픈 레이즈가 정석이에요.',
      '기대값상 오픈 레이즈예요.',
    ],
    'iso-raise': [
      '림프 상대엔 {size}BB 레이즈로 고립시켜요.',
      '레이즈로 한 명만 상대하는 게 효율적이에요.',
    ],
    'fold-unopened': [
      '{pos}에서 상위 {top}%는 레인지 밖이에요. 폴드.',
      '이 핸드는 수익이 안 나요. 폴드해요.',
    ],
    'free-check': [
      '무료로 카드를 볼 수 있어요. 체크.',
      '체크가 가장 합리적이에요.',
    ],
    'three-bet': [
      '상위 {top}%, 3벳 {size}BB가 최적이에요.',
      '밸류 3벳 구간이에요. 3벳해요.',
    ],
    'call-open': [
      '상위 {top}%는 콜 레인지예요.',
      '콜이 기대값이 가장 높아요.',
    ],
    'fold-vs-open': [
      '오픈 상대로 상위 {top}%는 부족해요. 폴드.',
      '상대 레인지가 더 강해요. 폴드해요.',
    ],
    'four-bet': [
      '3벳 상대로도 상위권이에요. 4벳 {size}BB.',
      '4벳이 정답이에요. 계산상 확실해요.',
    ],
    'call-three-bet': [
      '3벳 상대로 상위 {top}%면 콜이 맞아요.',
      '콜로 플랍을 보는 게 효율적이에요.',
    ],
    'fold-vs-three-bet': [
      '3벳 상대로 상위 {top}%는 손실이에요. 폴드.',
      '이번엔 폴드가 기대값이 높아요.',
    ],
    'short-push': [
      '{stack}BB, 상위 {top}%면 올인이 최적이에요.',
      '스택 깊이상 올인이 정답이에요.',
    ],
    'short-fold': [
      '{stack}BB면 더 나은 스팟을 기다려요. 폴드.',
      '지금은 기다리는 게 기대값이 높아요.',
    ],
    'value-bet': [
      '{made}예요. {size}BB 밸류 벳이 최적이에요.',
      '앞선 패예요. 밸류 벳해요.',
    ],
    'thin-value': [
      '탑페어예요. {size}BB 얇은 밸류 벳.',
      '얇게 밸류를 받아요. 작게 벳.',
    ],
    'semi-bluff': [
      '아우츠 {outs}장, {draw}%. 세미 블러프 벳.',
      '폴드 에퀴티가 있어요. 벳으로 압박해요.',
    ],
    'pot-control': [
      '애매한 강도예요. 체크로 팟을 관리해요.',
      '팟 컨트롤이 합리적이에요. 체크.',
    ],
    'raise-value': [
      '{made}예요. {size}BB 레이즈로 팟을 키워요.',
      '압도적으로 앞서요. 레이즈해요.',
    ],
    'call-strong': [
      '충분히 강해요. 콜로 따라가요.',
      '레이즈보다 콜이 효율적이에요.',
    ],
    'call-price': [
      '필요 승률 {req}%. 팟 오즈가 맞아요, 콜.',
      '팟 오즈가 충분해요. 콜해요.',
    ],
    'call-implied': [
      '{draw}%라도 임플라이드 오즈가 있어요. 콜.',
      '완성되면 크게 받아요. 콜해요.',
    ],
    'fold-price': [
      '필요 승률 {req}%는 비싸요. 폴드.',
      '오즈가 맞지 않아요. 폴드해요.',
    ],
  },
  reaction: {
    followed: [
      '같은 결론이네요. 당신과는 계산이 맞아요.',
      '정확한 선택이에요. 기록해 둘게요.',
    ],
    ignored: [
      '흥미로운 선택이에요. 데이터로 확인해 봐요.',
      '당신만의 근거가 있겠죠. 지켜볼게요.',
    ],
    'followed-won': [
      '계산대로예요. 함께라서 더 정확했어요.',
      '기대값이 실제 칩이 됐어요. 좋네요.',
    ],
    'followed-lost': [
      '결정은 맞았어요. 분산일 뿐이에요.',
      '좋은 선택이었어요. 장기적으로는 이겨요.',
    ],
  },
};

/** 클로이 — 스트리머 반말. 신나서 응원하고, 다른 선택도 콘텐츠로 즐긴다 */
const CHLOE: CoachVoice = {
  advice: {
    'open-raise': [
      '{pos}에서 상위 {top}%! {size}BB 레이즈 가자~!',
      '이 핸드 좋아! 레이즈 고고~☆',
    ],
    'iso-raise': [
      '림프 들어왔다~ {size}BB로 크게 레이즈!',
      '레이즈로 1:1 맞짱 뜨자~!',
    ],
    'fold-unopened': [
      '{pos}에서 상위 {top}%는 좀 약해~ 폴드!',
      '이번엔 패스~ 폴드하고 다음 거 보자!',
    ],
    'free-check': [
      '공짜로 볼 수 있어! 체크~',
      '체크하고 다음 카드 구경하자~!',
    ],
    'three-bet': [
      '상위 {top}% 와우! 3벳 {size}BB 가자!',
      '완전 좋은 핸드! 3벳 고~!',
    ],
    'call-open': [
      '상위 {top}%면 콜! 플랍 궁금하잖아~',
      '콜하고 같이 보자~!',
    ],
    'fold-vs-open': [
      '오픈 상대로 상위 {top}%는… 폴드할까~',
      '음~ 이건 패스! 폴드~',
    ],
    'four-bet': [
      '3벳 들어와도 OK! 4벳 {size}BB!',
      '이건 못 참지~ 4벳 가자!',
    ],
    'call-three-bet': [
      '3벳이어도 상위 {top}%면 콜~!',
      '버틸 수 있어! 콜~',
    ],
    'fold-vs-three-bet': [
      '3벳엔 상위 {top}%는 무리~ 폴드!',
      '이번엔 양보~ 폴드하자!',
    ],
    'short-push': [
      '{stack}BB 남았다! 상위 {top}%면 올인 고~!',
      '지금이 찬스! 올인 가자~!',
    ],
    'short-fold': [
      '{stack}BB면 좀 더 기다려~ 폴드!',
      '조금만 참자~ 폴드!',
    ],
    'value-bet': [
      '{made} 떴다! {size}BB 크게 벳~!',
      '완전 강해! 밸류 벳 가자~',
    ],
    'thin-value': [
      '탑페어! {size}BB 살짝 벳~',
      '앞서 있을 거야~ 작게 벳!',
    ],
    'semi-bluff': [
      '아우츠 {outs}장, {draw}%! 벳으로 밀자~',
      '드로우지만 벳 가보자~!',
    ],
    'pot-control': [
      '애매해~ 체크로 팟 작게 가자.',
      '여긴 체크가 좋아 보여~',
    ],
    'raise-value': [
      '{made}! {size}BB 레이즈 가자~!',
      '대박 강해! 레이즈로 팟 키우자!',
    ],
    'call-strong': [
      '강하니까 콜~! 끝까지 보자!',
      '버텨도 돼! 콜~',
    ],
    'call-price': [
      '필요 승률 {req}%! 가격 괜찮아, 콜~',
      '이 가격이면 콜이지~!',
    ],
    'call-implied': [
      '{draw}%라도 완성되면 대박! 콜~',
      '드로우 좋다~ 콜하자!',
    ],
    'fold-price': [
      '필요 승률 {req}%는 너무 비싸~ 폴드!',
      '이번엔 폴드~ 다음 기회 있어!',
    ],
  },
  reaction: {
    followed: [
      '같이 골랐다~! 우리 팀워크 최고☆',
      '헤헤, 내 말 들어 줘서 땡큐~♥',
    ],
    ignored: [
      '오~ 그렇게 간다고? 완전 궁금해!',
      '새로운 각인데? 같이 보자~!',
    ],
    'followed-won': [
      '이겼다~! 우리 하이라이트 각이야☆',
      'OMG 같이 이겼어! 최고야~!',
    ],
    'followed-lost': [
      '괜찮아~ 결정은 맞았어! 카드가 심술부린 거야.',
      '좋은 선택이었어! 다음엔 우리가 이길 거야~',
    ],
  },
};

/** 비비안 — 무대 위 연출가. 훈수를 연출 지시처럼 주고, 다른 선택은 관객으로 즐긴다 */
const VIVIAN: CoachVoice = {
  advice: {
    'open-raise': [
      '{pos}, 상위 {top}%… 이 장면은 {size}BB 레이즈지.',
      '막을 올려. 레이즈야.',
    ],
    'iso-raise': [
      '림프라니, 지루하군. {size}BB 레이즈로 주연을 뺏어.',
      '레이즈로 단둘의 무대를 만들어.',
    ],
    'fold-unopened': [
      '{pos}에서 상위 {top}%는 단역이야. 폴드.',
      '이번 장면은 퇴장이야. 폴드해.',
    ],
    'free-check': [
      '공짜 관람석이야. 체크해.',
      '체크로 다음 장면을 기다려.',
    ],
    'three-bet': [
      '상위 {top}%… 3벳 {size}BB로 반전을 줘.',
      '주연급 핸드야. 3벳해.',
    ],
    'call-open': [
      '상위 {top}%면 콜로 무대에 남아.',
      '콜로 이야기를 이어 가.',
    ],
    'fold-vs-open': [
      '오픈 상대로 상위 {top}%는 부족해. 폴드.',
      '우아하게 퇴장할 때야. 폴드.',
    ],
    'four-bet': [
      '3벳에 4벳 {size}BB로 응수해. 클라이맥스야.',
      '물러서지 마. 4벳이야.',
    ],
    'call-three-bet': [
      '3벳이어도 상위 {top}%면 콜이야.',
      '콜로 막을 이어 가.',
    ],
    'fold-vs-three-bet': [
      '3벳엔 상위 {top}%로는 부족해. 폴드.',
      '이번 막은 양보해. 폴드.',
    ],
    'short-push': [
      '{stack}BB, 상위 {top}%… 올인으로 피날레야.',
      '지금이 클라이맥스야. 올인.',
    ],
    'short-fold': [
      '{stack}BB면 더 좋은 장면을 기다려. 폴드.',
      '인내도 연기야. 폴드.',
    ],
    'value-bet': [
      '{made}… {size}BB 벳으로 박수를 받아.',
      '강한 패야. 밸류 벳해.',
    ],
    'thin-value': [
      '탑페어야. {size}BB로 은은하게 벳.',
      '작게 벳해서 관객을 붙잡아.',
    ],
    'semi-bluff': [
      '아우츠 {outs}장, {draw}%… 벳으로 연기해.',
      '드로우지만 벳으로 압박해.',
    ],
    'pot-control': [
      '애매한 대본이야. 체크로 팟을 작게.',
      '여기선 숨을 고를 때야. 체크.',
    ],
    'raise-value': [
      '{made}! {size}BB 레이즈로 무대를 키워.',
      '압도적이야. 레이즈해.',
    ],
    'call-strong': [
      '강한 핸드야. 콜로 끝까지 가.',
      '버텨. 콜이야.',
    ],
    'call-price': [
      '필요 승률 {req}%. 입장료가 싸군, 콜.',
      '이 가격이면 콜이야.',
    ],
    'call-implied': [
      '{draw}%라도 완성되면 대반전이야. 콜.',
      '드로우가 좋아. 콜해.',
    ],
    'fold-price': [
      '필요 승률 {req}%는 비싸. 폴드.',
      '이번 막은 내려. 폴드.',
    ],
  },
  reaction: {
    followed: [
      '훌륭해. 내 연출대로 움직였군.',
      '좋은 합이야. 우리 둘의 무대지.',
    ],
    ignored: [
      '즉흥 연기인가? 기대되는군.',
      '네 대본도 흥미로워. 지켜볼게.',
    ],
    'followed-won': [
      '브라보! 우리의 막이 완벽하게 내렸어.',
      '박수갈채야. 함께라서 빛났어.',
    ],
    'followed-lost': [
      '결정은 맞았어. 비극도 명작의 일부야.',
      '좋은 선택이었어. 운명이 대사를 놓쳤을 뿐.',
    ],
  },
};

/** 엘레나 — 짧은 반말. 말수는 적지만 근거는 정확하고, 다른 선택에도 동요하지 않는다 */
const ELENA: CoachVoice = {
  advice: {
    'open-raise': [
      '…{pos}, 상위 {top}%. {size}BB 레이즈.',
      '…레이즈. 망설일 이유 없어.',
    ],
    'iso-raise': [
      '…림프야. {size}BB로 레이즈해서 고립시켜.',
      '…레이즈. 한 명만 상대해.',
    ],
    'fold-unopened': [
      '…{pos}에서 상위 {top}%는 약해. 폴드.',
      '…폴드. 기다리는 것도 플레이야.',
    ],
    'free-check': [
      '…공짜야. 체크.',
      '…체크하고 다음 카드를 봐.',
    ],
    'three-bet': [
      '…상위 {top}%. 3벳 {size}BB.',
      '…강해. 3벳.',
    ],
    'call-open': [
      '…상위 {top}%면 콜.',
      '…콜로 충분해.',
    ],
    'fold-vs-open': [
      '…오픈 상대로 상위 {top}%는 부족해. 폴드.',
      '…폴드. 서두를 이유 없어.',
    ],
    'four-bet': [
      '…3벳 상대로도 강해. 4벳 {size}BB.',
      '…4벳. 물러설 핸드가 아니야.',
    ],
    'call-three-bet': [
      '…3벳이라도 상위 {top}%면 콜.',
      '…버틸 수 있어. 콜.',
    ],
    'fold-vs-three-bet': [
      '…3벳엔 상위 {top}%로는 무리. 폴드.',
      '…이번엔 폴드.',
    ],
    'short-push': [
      '…{stack}BB, 상위 {top}%. 올인.',
      '…지금이야. 올인.',
    ],
    'short-fold': [
      '…{stack}BB면 기다려. 폴드.',
      '…참아. 폴드.',
    ],
    'value-bet': [
      '…{made}. {size}BB 벳.',
      '…앞서 있어. 밸류 벳.',
    ],
    'thin-value': [
      '…탑페어. {size}BB 작게 벳.',
      '…작게 벳해.',
    ],
    'semi-bluff': [
      '…아우츠 {outs}장, {draw}%. 벳.',
      '…드로우야. 벳으로 압박해.',
    ],
    'pot-control': [
      '…애매해. 체크로 팟을 작게.',
      '…체크.',
    ],
    'raise-value': [
      '…{made}. {size}BB 레이즈.',
      '…압도적이야. 레이즈.',
    ],
    'call-strong': [
      '…강해. 콜.',
      '…콜로 따라가.',
    ],
    'call-price': [
      '…필요 승률 {req}%. 가격이 맞아. 콜.',
      '…이 가격이면 콜.',
    ],
    'call-implied': [
      '…{draw}%라도 완성되면 커. 콜.',
      '…드로우가 좋아. 콜.',
    ],
    'fold-price': [
      '…필요 승률 {req}%는 비싸. 폴드.',
      '…폴드. 다음이 있어.',
    ],
  },
  reaction: {
    followed: [
      '…좋아. 같은 생각이야.',
      '…고마워. 네 옆이라 편해.',
    ],
    ignored: [
      '…그래. 네 라인도 보고 싶어.',
      '…흥미로운 선택이야. 지켜볼게.',
    ],
    'followed-won': [
      '…우리 팟이야. 나쁘지 않네.',
      '…예상대로야. 함께여서.',
    ],
    'followed-lost': [
      '…결정은 맞았어. 카드가 따라 주지 않았을 뿐.',
      '…좋은 선택이었어. 다음 핸드로 가.',
    ],
  },
};

/** 그 밖의 캐릭터 — 차분한 존댓말 중립 말투 */
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

const VOICES: Readonly<Record<string, CoachVoice>> = {
  sakura: SAKURA,
  ara: ARA,
  hana: HANA,
  chloe: CHLOE,
  vivian: VIVIAN,
  elena: ELENA,
};

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
