/**
 * 프리플랍 레인지 표기 파서 + 콤보 열거 — 드릴(D-RANGE·D-COMBO)·코치 패널·에퀴티 추정 공용.
 *
 * 핸드 키 표기는 `src/lib/bot/hand-rankings.ts`의 `handKey()`와 **완전히 같은 형식**이다:
 * 페어 `'AA'` · 수딧 `'AKs'` · 오프수트 `'AKo'` (10은 `'T'`). 두 표기를 갈라 놓으면
 * 봇 HUD 레인지와 학습 레인지가 조용히 어긋나므로 `handKey`를 그대로 재사용한다.
 *
 * 순수 계산 모듈 — 셔플/딜링 경로가 아니므로 `deck.ts`의 CSPRNG 규칙 대상이 아니다.
 */
import { handKey } from '../bot/hand-rankings';
import { formatCard } from './card-notation';
import type { Card, Rank, Suit } from './types';

/** 강한 랭크부터 — 인덱스가 작을수록 강하다 ('+' 확장의 기준축). */
const RANK_CHARS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2'] as const;

const RANK_BY_CHAR: Readonly<Record<string, Rank>> = Object.freeze({
  A: 'A', K: 'K', Q: 'Q', J: 'J', T: '10',
  '9': '9', '8': '8', '7': '7', '6': '6', '5': '5', '4': '4', '3': '3', '2': '2',
});

/** 콤보 생성 순서를 고정하기 위한 수트 순서 (결정론 — 스냅샷 테스트가 의존한다). */
const SUITS: readonly Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];

const RANK_INDEX = new Map<string, number>(RANK_CHARS.map((c, i) => [c, i]));

export class RangeParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RangeParseError';
  }
}

/** 169개 스타팅 핸드 키 전체 — 강한 랭크 조합부터의 결정론 순서. */
export const RANGE_ALL_KEYS: readonly string[] = buildAllKeys();

function buildAllKeys(): string[] {
  const keys: string[] = [];
  for (let hi = 0; hi < RANK_CHARS.length; hi++) {
    for (let lo = hi; lo < RANK_CHARS.length; lo++) {
      if (hi === lo) keys.push(`${RANK_CHARS[hi]}${RANK_CHARS[lo]}`);
      else {
        keys.push(`${RANK_CHARS[hi]}${RANK_CHARS[lo]}s`);
        keys.push(`${RANK_CHARS[hi]}${RANK_CHARS[lo]}o`);
      }
    }
  }
  return Object.freeze(keys) as string[];
}

const ALL_KEY_SET = new Set(RANGE_ALL_KEYS);

/** 파싱 중간 표현: 강한 랭크 인덱스 + 약한 랭크 인덱스 + 수딧 여부(페어는 null). */
interface HandToken {
  high: number;
  low: number;
  /** 's' | 'o' | null(페어) | 'both'(수트 미지정 non-pair — `AK` = AKs + AKo) */
  suited: 's' | 'o' | null | 'both';
}

function keyOf(high: number, low: number, suited: 's' | 'o' | null): string {
  const text = `${RANK_CHARS[high]}${RANK_CHARS[low]}`;
  return suited ? `${text}${suited}` : text;
}

function tokenKeys(token: HandToken): string[] {
  if (token.suited === null) return [keyOf(token.high, token.low, null)];
  if (token.suited === 'both') {
    return [keyOf(token.high, token.low, 's'), keyOf(token.high, token.low, 'o')];
  }
  return [keyOf(token.high, token.low, token.suited)];
}

/** 'AKs' / 'QQ' / 'ak' → HandToken. 형식이 아니면 null. */
function parseHandToken(raw: string): HandToken | null {
  if (raw.length !== 2 && raw.length !== 3) return null;
  const a = raw[0].toUpperCase();
  const b = raw[1].toUpperCase();
  const ai = RANK_INDEX.get(a);
  const bi = RANK_INDEX.get(b);
  if (ai === undefined || bi === undefined) return null;

  const high = Math.min(ai, bi);
  const low = Math.max(ai, bi);
  const suffix = raw.length === 3 ? raw[2].toLowerCase() : '';

  if (high === low) {
    // 페어에는 s/o 접미가 붙을 수 없다 ('AAs'는 존재하지 않는 조합).
    if (suffix !== '') return null;
    return { high, low, suited: null };
  }
  if (suffix === '') return { high, low, suited: 'both' };
  if (suffix === 's' || suffix === 'o') return { high, low, suited: suffix };
  return null;
}

/** `QQ+` / `ATs+` / `KTo+` 확장 — 낮은 랭크를 높은 랭크 바로 아래까지 끌어올린다. */
function expandPlus(token: HandToken): string[] {
  const keys: string[] = [];
  if (token.suited === null) {
    // 페어: 자기 자신부터 AA까지
    for (let i = token.high; i >= 0; i--) keys.push(keyOf(i, i, null));
    return keys;
  }
  // non-pair: high 고정, low를 high 바로 아래까지 강하게
  for (let lo = token.low; lo > token.high; lo--) {
    keys.push(...tokenKeys({ high: token.high, low: lo, suited: token.suited }));
  }
  return keys;
}

/** `22-55` / `A5s-A2s` 확장. 두 끝점의 구조(높은 랭크·수딧)가 같아야 한다. */
function expandDash(left: HandToken, right: HandToken, raw: string): string[] {
  if (left.suited !== right.suited) {
    throw new RangeParseError(`Range endpoints differ in suitedness: ${JSON.stringify(raw)}`);
  }
  const keys: string[] = [];
  if (left.suited === null) {
    const from = Math.min(left.high, right.high);
    const to = Math.max(left.high, right.high);
    for (let i = from; i <= to; i++) keys.push(keyOf(i, i, null));
    return keys;
  }
  if (left.high !== right.high) {
    throw new RangeParseError(`Range endpoints must share the top rank: ${JSON.stringify(raw)}`);
  }
  const from = Math.min(left.low, right.low);
  const to = Math.max(left.low, right.low);
  for (let lo = from; lo <= to; lo++) {
    keys.push(...tokenKeys({ high: left.high, low: lo, suited: left.suited }));
  }
  return keys;
}

function parseToken(raw: string): string[] {
  const dash = raw.indexOf('-');
  if (dash > 0) {
    const left = parseHandToken(raw.slice(0, dash));
    const right = parseHandToken(raw.slice(dash + 1));
    if (!left || !right) throw new RangeParseError(`Invalid range token: ${JSON.stringify(raw)}`);
    return expandDash(left, right, raw);
  }
  if (raw.endsWith('+')) {
    const token = parseHandToken(raw.slice(0, -1));
    if (!token) throw new RangeParseError(`Invalid range token: ${JSON.stringify(raw)}`);
    return expandPlus(token);
  }
  const token = parseHandToken(raw);
  if (!token) throw new RangeParseError(`Invalid range token: ${JSON.stringify(raw)}`);
  return tokenKeys(token);
}

/**
 * `'QQ+, AK, T9s, A5s-A2s'` → 핸드 키 Set.
 *
 * 지원 표기 — `QQ` · `QQ+`(QQ~AA) · `22-55` · `T9s` · `KQo` · `AK`(=AKs+AKo) ·
 * `ATs+`(ATs~AKs) · `KTo+` · `A5s-A2s`. 구분자는 쉼표/공백 어느 쪽이든 된다.
 * 잘못된 토큰은 `RangeParseError`.
 */
export function parseRange(text: string): Set<string> {
  if (typeof text !== 'string') throw new RangeParseError('Range must be a string');
  const tokens = text.split(/[\s,]+/).filter(t => t.length > 0);
  const out = new Set<string>();
  for (const token of tokens) {
    for (const key of parseToken(token)) {
      if (!ALL_KEY_SET.has(key)) {
        throw new RangeParseError(`Unknown hand key ${JSON.stringify(key)} from ${JSON.stringify(token)}`);
      }
      out.add(key);
    }
  }
  return out;
}

/** parseRange의 non-throwing 변형 — 유저 입력 검증처럼 실패가 정상 경로인 곳에서 사용. */
export function tryParseRange(text: unknown): Set<string> | null {
  if (typeof text !== 'string') return null;
  try {
    return parseRange(text);
  } catch {
    return null;
  }
}

function cardOf(rankChar: string, suit: Suit): Card {
  return { rank: RANK_BY_CHAR[rankChar], suit };
}

/** 핸드 키 하나의 구체 콤보 (페어 6 · 수딧 4 · 오프수트 12). 순서는 결정론. */
function keyCombos(key: string): Card[][] {
  const a = key[0];
  const b = key[1];
  const suffix = key.length === 3 ? key[2] : '';
  const combos: Card[][] = [];
  if (suffix === '') {
    for (let i = 0; i < SUITS.length; i++) {
      for (let j = i + 1; j < SUITS.length; j++) {
        combos.push([cardOf(a, SUITS[i]), cardOf(b, SUITS[j])]);
      }
    }
    return combos;
  }
  if (suffix === 's') {
    for (const suit of SUITS) combos.push([cardOf(a, suit), cardOf(b, suit)]);
    return combos;
  }
  for (const s1 of SUITS) {
    for (const s2 of SUITS) {
      if (s1 !== s2) combos.push([cardOf(a, s1), cardOf(b, s2)]);
    }
  }
  return combos;
}

/**
 * 레인지의 구체 2장 콤보 전체. `dead`에 든 카드(내 홀카드·보드·블로커)를 포함하는
 * 콤보는 제외한다 — 콤보 카운팅에서 블로커를 빼먹는 게 가장 흔한 계산 오류다.
 * 순서는 `RANGE_ALL_KEYS` 순 → 키 내부 수트 순으로 결정론.
 */
export function rangeCombos(range: ReadonlySet<string>, dead: readonly Card[] = []): Card[][] {
  const blocked = new Set(dead.map(formatCard));
  const out: Card[][] = [];
  for (const key of RANGE_ALL_KEYS) {
    if (!range.has(key)) continue;
    for (const combo of keyCombos(key)) {
      if (blocked.has(formatCard(combo[0])) || blocked.has(formatCard(combo[1]))) continue;
      out.push(combo);
    }
  }
  return out;
}

/** 레인지의 콤보 수 (블로커 제외). */
export function countCombos(range: ReadonlySet<string>, dead: readonly Card[] = []): number {
  return rangeCombos(range, dead).length;
}

/** 구체 홀카드 2장이 레인지에 속하는지. */
export function handKeyInRange(cards: Card[], range: ReadonlySet<string>): boolean {
  const key = handKey(cards);
  return key !== '' && range.has(key);
}
