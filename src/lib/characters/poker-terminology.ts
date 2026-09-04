/** 수기 대사는 문맥별로 교정하고, AI/캐시는 어색한 번역을 버려 스크립트로 폴백한다. */
export const POKER_TERMINOLOGY_RULE =
  '포커 용어는 한국어 음역 그대로 쓴다: hand=핸드(카드), fold=폴드, bet=벳/베팅, ' +
  'call=콜, raise=레이즈, open raise=오픈 레이즈, pot=팟, showdown=쇼다운. ' +
  '핸드를 손/판, 폴드를 접다, 베팅을 던지다, 오픈 레이즈를 열다로 번역하지 않는다. ' +
  '신체의 손이나 실제 아이템 투척은 원래 뜻대로 표현한다.';

const AWKWARD_POKER_TERMS = [
  /(?<![가-힣])접(?:다|는|고|지|기|어|었|으|을|겠|자|히|혀|힌)/u,
  /(?:좋은|나쁜|강한|약한|최고의|프리미엄|상위\s*%로 보는)\s*손(?=$|[\s.,!?…'"은을이가도으])/u,
];

// 실제 아이템을 목적어로 하는 투척은 포커 액션이 아니다. 같은 문장에 '올인'이 있어도 보존한다.
const ITEM_THROW = /(?:꽃다발|장미|꽃잎|물풍선|달걀|계란|토마토|폭죽|눈덩이|아이템)(?:을|를)?\s*(?:(?:크게|작게|세게|멀리)\s*)?던(?:지|진|져|졌)[가-힣]*/gu;
const BETTING_THROW = /(?:팟|벳|베팅|레이즈|올인|칩)[^.!?…]{0,24}던(?:지|진|져|졌)/u;

export function hasAwkwardPokerTerminology(line: string): boolean {
  return AWKWARD_POKER_TERMS.some(pattern => pattern.test(line))
    || BETTING_THROW.test(line.replace(ITEM_THROW, ''));
}
