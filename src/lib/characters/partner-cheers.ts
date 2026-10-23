/**
 * 내 승리 컷인의 파트너 축하 대사 — 히로인 6명 수기 스크립트 (회귀: `partner-cheers.test.ts`).
 *
 * `WinnerCutIn`이 승자가 나이고 선택 파트너가 히로인일 때 미야코 대신 파트너를 띄우며 쓴다(2026-10-24 파트너 중심 초반).
 * 내 화면에만 보이는 연출이라 방 브로드캐스트와 무관하다. 문장 선택은 결정론(seed = handNumber) — 렌더 중 난수 없음.
 * 말투 정본: bond-scenes · coach-lines · drills/explain (비비안은 스토리 정본대로 존댓말 「자기」).
 * 포커 용어는 원어 표기(팟·핸드) — 손/판 금지.
 */
const CHEERS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  sakura: [
    '해, 해냈어요…! 방금 팟, 당신 거예요!',
    '우, 우와… 정말 멋있었어요…!',
    '봤어요, 저 다 봤어요…! 당신이 이겼어요!',
  ],
  ara: [
    '봤어? 방금 팟, 네 거야! …흥, 제법인데.',
    '그래, 그거야! …큼, 칭찬은 한 번만이야.',
    '좋았어! 이 기세로 가자고!',
  ],
  hana: [
    '당신 승리예요. 판단과 결과가 일치했네요.',
    '기록해 둘게요 — 당신의 팟이에요.',
    '좋은 라인이었어요. 당신, 성장 속도가 예상보다 빨라요.',
  ],
  chloe: [
    '와아~ 이겼다! 이거 완전 하이라이트 각☆',
    'OMG 네 팟이야! 클립 따 둘게~!',
    '최고~! 오늘 MVP는 너야!',
  ],
  vivian: [
    '브라보, 자기! 이 장면은 자기가 주연이에요.',
    '박수갈채예요, 자기. 막이 근사하게 내렸네요.',
    '훌륭해요 — 오늘 밤 무대는 자기 거예요.',
  ],
  elena: [
    '…좋은 핸드였어. 네 팟이야.',
    '…잘했어. 그 판단, 맞았어.',
    '…나쁘지 않네. 아니, 훌륭했어.',
  ],
});

/** 히로인이 아니면 null — 호출부가 기존 미야코 축하로 폴백한다 */
export function partnerWinCheer(characterId: string | null | undefined, seed: number): string | null {
  const lines = characterId ? CHEERS[characterId] : undefined;
  if (!lines || lines.length === 0) return null;
  const index = ((Math.trunc(seed) % lines.length) + lines.length) % lines.length;
  return lines[index];
}

export function hasPartnerWinCheer(characterId: string | null | undefined): boolean {
  return !!characterId && !!CHEERS[characterId];
}
