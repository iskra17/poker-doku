import { Card, Rank } from '../poker/types';
import { rankValue } from '../poker/deck';

/**
 * 프리플랍 핸드 백분위 모델.
 * HUD 스탯(vpip/pfr/3bet 등)을 "상위 X% 레인지"로 해석하기 위한 단일 소스 —
 * 169개 스타팅 핸드를 Chen formula로 점수화해 콤보 수(페어 6, 수딧 4, 오프수트 12)로
 * 가중한 누적 백분위(0=최강 ~ 1=최약)를 제공한다.
 * 예: vpip 24 → handPercentile(홀카드) <= 0.24 인 핸드로 팟에 참여.
 */

interface RankedHand {
  key: string;       // 'AKs' / 'QQ' / '72o'
  chen: number;
  combos: number;
  /** 이 핸드보다 강한 콤보 비율 + 자기 콤보의 절반 (0~1) */
  percentile: number;
}

const RANKS: Rank[] = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5', '4', '3', '2'];

function rankChar(r: Rank): string {
  return r === '10' ? 'T' : r;
}

/** Chen formula — 하이카드 점수 */
function chenHighCard(v: number): number {
  if (v === 14) return 10; // A
  if (v === 13) return 8;  // K
  if (v === 12) return 7;  // Q
  if (v === 11) return 6;  // J
  return v / 2;            // T=5, 9=4.5 ... 2=1
}

function chenScore(highV: number, lowV: number, suited: boolean): number {
  if (highV === lowV) return Math.max(5, chenHighCard(highV) * 2);
  let score = chenHighCard(highV);
  if (suited) score += 2;
  const gap = highV - lowV - 1;
  if (gap === 1) score -= 1;
  else if (gap === 2) score -= 2;
  else if (gap === 3) score -= 4;
  else if (gap >= 4) score -= 5;
  // 스트레이트 메이킹 보너스: 0~1갭 + 둘 다 Q 미만
  if (gap <= 1 && highV < 12) score += 1;
  return score;
}

/** 169핸드를 Chen 점수 내림차순으로 정렬해 콤보 가중 백분위 테이블 생성 */
function buildTable(): Map<string, RankedHand> {
  const hands: Omit<RankedHand, 'percentile'>[] = [];
  for (let i = 0; i < RANKS.length; i++) {
    for (let j = i; j < RANKS.length; j++) {
      const high = RANKS[i];
      const low = RANKS[j];
      const hv = rankValue(high);
      const lv = rankValue(low);
      if (i === j) {
        hands.push({ key: `${rankChar(high)}${rankChar(low)}`, chen: chenScore(hv, lv, false), combos: 6 });
      } else {
        hands.push({ key: `${rankChar(high)}${rankChar(low)}s`, chen: chenScore(hv, lv, true), combos: 4 });
        hands.push({ key: `${rankChar(high)}${rankChar(low)}o`, chen: chenScore(hv, lv, false), combos: 12 });
      }
    }
  }
  // 점수 내림차순, 동점은 하이카드→로우카드→수딧 우선 (결정론적 순서)
  hands.sort((a, b) => {
    if (b.chen !== a.chen) return b.chen - a.chen;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });

  const total = 1326;
  const table = new Map<string, RankedHand>();
  let cumulative = 0;
  for (const h of hands) {
    table.set(h.key, { ...h, percentile: (cumulative + h.combos / 2) / total });
    cumulative += h.combos;
  }
  return table;
}

const TABLE = buildTable();

export function handKey(cards: Card[]): string {
  if (cards.length !== 2) return '';
  const [c1, c2] = cards;
  const v1 = rankValue(c1.rank);
  const v2 = rankValue(c2.rank);
  const high = v1 >= v2 ? c1 : c2;
  const low = v1 >= v2 ? c2 : c1;
  if (high.rank === low.rank) return `${rankChar(high.rank)}${rankChar(low.rank)}`;
  const suited = c1.suit === c2.suit ? 's' : 'o';
  return `${rankChar(high.rank)}${rankChar(low.rank)}${suited}`;
}

/** 홀카드의 프리플랍 백분위 (0=최강 ~ 1=최약). 미지 입력은 1(최약) 취급. */
export function handPercentile(cards: Card[]): number {
  return TABLE.get(handKey(cards))?.percentile ?? 1;
}
