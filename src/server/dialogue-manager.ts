import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';

/**
 * 캐릭터 대화 관리자 — 3층 전략으로 API 비용과 대사 품질의 균형을 잡는다.
 *
 *   1층 (스크립트): 폴드/레이즈 같은 기본 상황은 캐릭터 모듈의 사전 작성 대사만 사용
 *       — 이 모듈을 거치지 않는다 (호출부인 RoomManager가 직접 처리).
 *   2층 (캐시 풀): 특별 순간(올인/빅팟/탈락/우승)은 과거 AI가 생성한 대사 풀에서
 *       확률적으로 재사용 — API 비용 0, 쿨다운 소비 없음.
 *   3층 (실시간 생성): 풀이 부족하거나 재사용 주사위가 빗나가면 AI 생성
 *       (AIDialogue의 게이팅: 일일 상한/쿨다운/확률). 성공한 대사는 풀에 적립되므로
 *       운영이 길어질수록 API 호출은 자연히 줄고 대사 다양성은 늘어난다.
 *
 * 재사용 가능성을 위해 생성 프롬프트에 '구체 숫자 금지' 규칙을 덧붙인다 —
 * "3,400칩 먹었다!" 같은 대사는 다른 판에서 재사용할 수 없기 때문.
 *
 * 확장 (스토리/스터디 모드): situationKey는 자유 문자열 — 'story:ch1:intro',
 * 'study:preflop-odds' 같은 키를 추가하면 같은 캐시·생성 파이프라인을 그대로 탄다.
 * 사전 작성 대사는 지금처럼 호출부의 fallback으로 공급하면 된다.
 * scopeId는 쿨다운 단위 — 게임은 roomId, 스토리/스터디는 유저별 id를 쓰면 된다.
 */

/** AIDialogue와 동일 시그니처 — 테스트에서 스텁 주입용 */
export interface LineGenerator {
  generateLine(scopeId: string, characterId: string, situation: string): Promise<string | null>;
  noteLine?(characterId: string, line: string): void;
  disposeScope?(scopeId: string): void;
  shutdown?(): void;
}

interface CachedLine {
  line: string;
  uses: number;
  createdAt: number;
}

interface DialogueManagerOptions {
  /** 풀에 이 개수 이상 쌓이면 재사용 후보가 된다 */
  minPool?: number;
  /** (캐릭터×상황)당 보관 상한 — 넘치면 가장 많이 쓴 오래된 대사부터 교체 */
  maxPool?: number;
  /** 풀이 충분할 때 API 대신 캐시를 쓸 확률 (풀이 클수록 상향) */
  reuseChance?: number;
  /** 캐시 스냅샷 파일 경로 — null이면 영속화 안 함 (테스트용) */
  persistPath?: string | null;
}

const DEFAULTS = {
  minPool: 3,
  maxPool: 12,
  reuseChance: Number(process.env.DIALOGUE_REUSE_CHANCE) || 0.55,
  persistPath: 'data/dialogue-cache.json',
};

const PERSIST_DEBOUNCE_MS = 30_000;
const NO_NUMBERS_RULE = ' (대사에 구체적인 칩 수량·금액·등수 숫자는 넣지 말 것 — 상황의 감정만 표현)';

export class DialogueManager {
  private pools = new Map<string, CachedLine[]>(); // `${characterId}:${situationKey}` → 대사 풀
  private lastServed = new Map<string, string>(); // 풀 키별 직전 반환 대사 (연속 반복 방지)
  private opts: Required<Omit<DialogueManagerOptions, 'persistPath'>> & { persistPath: string | null };
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private generator: LineGenerator, options: DialogueManagerOptions = {}) {
    this.opts = {
      minPool: options.minPool ?? DEFAULTS.minPool,
      maxPool: options.maxPool ?? DEFAULTS.maxPool,
      reuseChance: options.reuseChance ?? DEFAULTS.reuseChance,
      persistPath: options.persistPath === undefined ? DEFAULTS.persistPath : options.persistPath,
    };
    this.load();
  }

  /**
   * 상황 대사 요청. null이면 호출부가 스크립트 대사로 폴백할 것.
   * @param scopeId 쿨다운 스코프 (게임: roomId)
   * @param situationKey 재사용 풀 키 — 같은 키의 대사는 서로 교환 가능해야 한다
   * @param situationText AI 생성용 상황 설명 (동적 디테일 포함 가능)
   */
  async getLine(
    scopeId: string,
    characterId: string,
    situationKey: string,
    situationText: string,
  ): Promise<string | null> {
    const poolKey = `${characterId}:${situationKey}`;
    const pool = this.pools.get(poolKey) ?? [];

    // 2층: 풀이 충분하면 확률적으로 재사용 (풀이 가득할수록 재사용률 상향 — 하향은 없음:
    // reuseChance가 0.9 이상일 때 음수 보정으로 재사용률이 떨어지던 버그 방지)
    const fullness = Math.min(1, pool.length / this.opts.maxPool);
    const reuseP = this.opts.reuseChance + fullness * Math.max(0, 0.9 - this.opts.reuseChance);
    if (pool.length >= this.opts.minPool && Math.random() < reuseP) {
      const line = this.pickFromPool(poolKey, pool);
      if (line) return line;
    }

    // 3층: 실시간 생성 (게이팅은 generator 내부) — 성공 시 풀에 적립
    const generated = await this.generator.generateLine(
      scopeId,
      characterId,
      situationText + NO_NUMBERS_RULE,
    );
    if (generated) {
      this.addToPool(poolKey, generated);
      this.lastServed.set(poolKey, generated);
      return generated;
    }

    // 생성이 게이팅/실패로 막혔어도 풀에 뭐라도 있으면 재사용 — 스크립트보다 다양함
    if (pool.length > 0) {
      return this.pickFromPool(poolKey, pool);
    }
    return null;
  }

  /** 통계 (관리/디버깅용) */
  get stats(): { pools: number; lines: number } {
    let lines = 0;
    this.pools.forEach(p => { lines += p.length; });
    return { pools: this.pools.size, lines };
  }

  disposeScope(scopeId: string): void {
    this.generator.disposeScope?.(scopeId);
  }

  shutdown(): void {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.generator.shutdown?.();
  }

  private pickFromPool(poolKey: string, pool: CachedLine[]): string | null {
    if (pool.length === 0) return null;
    const last = this.lastServed.get(poolKey);
    const candidates = pool.length > 1 ? pool.filter(c => c.line !== last) : pool;
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    if (!chosen) return null;
    chosen.uses++;
    this.lastServed.set(poolKey, chosen.line);
    // 반복 방지 버퍼에도 반영 — 직후 AI 생성이 같은 대사를 또 만들지 않게
    this.generator.noteLine?.(poolKey.split(':')[0], chosen.line);
    return chosen.line;
  }

  private addToPool(poolKey: string, line: string): void {
    const pool = this.pools.get(poolKey) ?? [];
    const normalized = line.trim();
    if (pool.some(c => c.line === normalized)) return; // 중복 저장 방지
    pool.push({ line: normalized, uses: 0, createdAt: Date.now() });
    if (pool.length > this.opts.maxPool) {
      // 가장 많이 소비된(식상해진) 대사부터 교체 — 동률이면 오래된 것
      pool.sort((a, b) => a.uses - b.uses || b.createdAt - a.createdAt);
      pool.length = this.opts.maxPool;
    }
    this.pools.set(poolKey, pool);
    this.schedulePersist();
  }

  // ── 영속화 (베스트 에포트 — 재시작 간 풀 보존, 실패해도 기능엔 지장 없음) ──

  private load(): void {
    if (!this.opts.persistPath) return;
    try {
      if (!existsSync(this.opts.persistPath)) return;
      const raw = JSON.parse(readFileSync(this.opts.persistPath, 'utf-8')) as Record<string, CachedLine[]>;
      for (const [key, lines] of Object.entries(raw)) {
        if (Array.isArray(lines)) {
          this.pools.set(key, lines.filter(l => typeof l?.line === 'string').slice(0, this.opts.maxPool));
        }
      }
      console.log(`[dialogue] 캐시 로드 — 풀 ${this.pools.size}개, 대사 ${this.stats.lines}줄`);
    } catch (e) {
      console.warn(`[dialogue] 캐시 로드 실패 (빈 상태로 시작): ${e instanceof Error ? e.message : e}`);
    }
  }

  private schedulePersist(): void {
    if (!this.opts.persistPath || this.persistTimer) return;
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      try {
        const obj: Record<string, CachedLine[]> = {};
        this.pools.forEach((v, k) => { obj[k] = v; });
        mkdirSync(dirname(this.opts.persistPath!), { recursive: true });
        writeFileSync(this.opts.persistPath!, JSON.stringify(obj), 'utf-8');
      } catch (e) {
        console.warn(`[dialogue] 캐시 저장 실패: ${e instanceof Error ? e.message : e}`);
      }
    }, PERSIST_DEBOUNCE_MS);
    this.persistTimer.unref?.();
  }
}
