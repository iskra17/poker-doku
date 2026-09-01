/**
 * 시드 기반 결정론 RNG — 스토리 모드 드릴 생성·몬테카를로 에퀴티 추정 전용.
 *
 * **딜링 경로 아님 — 드릴 생성·몬테카를로 전용. 실제 덱 셔플은 `deck.ts`의
 * CSPRNG(`secureRandomInt`)만 사용한다(AGENTS.md 서버 권위 모델 규칙).**
 *
 * 이 모듈을 `deck.ts`/`engine.ts`에서 import하는 일이 있어서는 안 된다. 시드를
 * 알면 다음 값이 전부 예측되므로 카드를 나눠 주는 어떤 경로에도 닿으면 안 된다.
 * 반대로 드릴은 "같은 시드 → 같은 문제"가 서버·클라 공통 계약이라 결정론이 필수다.
 */

const UINT32 = 0x1_0000_0000;

/**
 * mulberry32 — 32비트 상태 PRNG. [0, 1) 실수를 돌려준다.
 * 같은 seed면 항상 같은 수열이 나온다 (드릴 재생성·MC 재현의 근거).
 */
export function mulberry32(seed: number): () => number {
  let state = seed | 0;
  return function next(): number {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / UINT32;
  };
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/**
 * 문자열/숫자 조합 → uint32 시드 (FNV-1a). 드릴 시드 규약:
 * `hashSeed(runId, setId, index)` — 같은 입력이면 서버·클라가 같은 문제를 만든다.
 * 파트 구분자로 NUL을 끼워 `('ab','c')`와 `('a','bc')`가 충돌하지 않게 한다.
 */
export function hashSeed(...parts: Array<string | number>): number {
  let hash = FNV_OFFSET;
  for (let p = 0; p < parts.length; p++) {
    if (p > 0) {
      hash ^= 0;
      hash = Math.imul(hash, FNV_PRIME);
    }
    const text = typeof parts[p] === 'number' ? numberToSeedText(parts[p] as number) : String(parts[p]);
    for (let i = 0; i < text.length; i++) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, FNV_PRIME);
    }
  }
  return hash >>> 0;
}

/** -0과 0, 1과 1.0을 같은 문자열로 정규화 (NaN/Infinity도 안정적인 표기). */
function numberToSeedText(value: number): string {
  if (Number.isNaN(value)) return 'NaN';
  if (value === 0) return '0';
  return String(value);
}

/** [0, maxExclusive) 정수. maxExclusive는 1 이상의 정수여야 한다. */
export function randomInt(rng: () => number, maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new Error(`randomInt: invalid bound ${maxExclusive}`);
  }
  const value = Math.floor(rng() * maxExclusive);
  // rng()가 계약을 어기고 정확히 1을 돌려줘도 범위를 벗어나지 않게 클램프한다.
  return value < 0 ? 0 : value >= maxExclusive ? maxExclusive - 1 : value;
}

/** 목록에서 하나를 균등 추출. 빈 목록은 throw. */
export function pickOne<T>(rng: () => number, items: readonly T[]): T {
  if (items.length === 0) throw new Error('pickOne: empty list');
  return items[randomInt(rng, items.length)];
}

/** Fisher-Yates 셔플 — 원본은 건드리지 않고 **복사본**을 돌려준다. */
export function shuffleWith<T>(rng: () => number, items: readonly T[]): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(rng, i + 1);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}
