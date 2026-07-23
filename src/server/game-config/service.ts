import {
  GAME_CONFIG_CROSS_CHECKS,
  GAME_CONFIG_DEFAULTS,
  GAME_CONFIG_REGISTRY,
  isGameConfigKey,
  type GameConfigEntry,
  type GameConfigKey,
} from './registry';
import type { GameConfigChange, GameConfigRepository } from './repository';

export interface GameConfigValueView extends GameConfigEntry {
  /** 유효 기본값 (env 오버라이드 반영) — UI가 "기본값 N" 표시에 사용 */
  effectiveDefault: number;
  /** 현재 적용값 */
  value: number;
  /** DB 오버라이드 행 존재 여부 */
  overridden: boolean;
  updatedAt: number | null;
}

export interface GameConfigDiffEntry {
  key: GameConfigKey;
  from: number;
  to: number;
}

export class GameConfigValidationError extends Error {
  constructor(
    readonly errors: ReadonlyArray<{ key: string; message: string }>,
  ) {
    super('GAME_CONFIG_INVALID');
    this.name = 'GameConfigValidationError';
  }
}

interface OverrideState {
  value: number;
  updatedAt: number;
}

/**
 * 런타임 게임 설정 서비스 — 부팅 시 DB 오버라이드를 하이드레이션하고,
 * 어드민 쓰기 경로(set)와 게임 읽기 경로(get — live.ts의 cfg())가 같은 인스턴스를 공유한다.
 * 우선순위: DB 오버라이드 > env 기본값 > 코드 기본값.
 */
export class GameConfigService {
  private readonly overrides = new Map<GameConfigKey, OverrideState>();
  private readonly effectiveDefaults: Record<GameConfigKey, number>;

  constructor(
    private readonly repository: GameConfigRepository,
    options: {
      envDefaults?: Partial<Record<GameConfigKey, number>>;
      clock?: () => number;
      logger?: Pick<Console, 'warn'>;
    } = {},
  ) {
    this.clock = options.clock ?? Date.now;
    const logger = options.logger ?? console;
    this.effectiveDefaults = {
      ...GAME_CONFIG_DEFAULTS,
      ...options.envDefaults,
    };
    // 하이드레이션 — 미지 키(레지스트리에서 제거됨)와 범위 밖 값은 무시하고 경고만.
    // 행은 지우지 않는다 (레지스트리 롤백 시 데이터 보존).
    for (const row of this.repository.loadAll()) {
      if (!isGameConfigKey(row.key)) {
        logger.warn(`[game-config] 미지 키 무시: ${row.key}`);
        continue;
      }
      const parsed = Number(row.value);
      const entry = ENTRY_BY_KEY[row.key];
      if (
        !Number.isSafeInteger(parsed)
        || parsed < entry.min
        || parsed > entry.max
      ) {
        logger.warn(
          `[game-config] 범위 밖 값 무시: ${row.key}=${row.value} (${entry.min}~${entry.max})`,
        );
        continue;
      }
      this.overrides.set(row.key, { value: parsed, updatedAt: row.updatedAt });
    }
  }

  private readonly clock: () => number;

  get(key: GameConfigKey): number {
    return this.overrides.get(key)?.value ?? this.effectiveDefaults[key];
  }

  /** 어드민 GET 응답 — 레지스트리 순서 보존 */
  snapshot(): GameConfigValueView[] {
    return GAME_CONFIG_REGISTRY.map(entry => {
      const override = this.overrides.get(entry.key);
      return {
        ...entry,
        effectiveDefault: this.effectiveDefaults[entry.key],
        value: override?.value ?? this.effectiveDefaults[entry.key],
        overridden: override !== undefined,
        updatedAt: override?.updatedAt ?? null,
      };
    });
  }

  /**
   * 부분 업데이트 — 전체 검증(개별 범위 + 교차 검증) 통과 시에만 트랜잭션 반영.
   * value null = 오버라이드 삭제(기본값 복원). 실제 값이 변한 항목만 diff로 반환.
   */
  set(updates: Record<string, number | null>): GameConfigDiffEntry[] {
    const errors: Array<{ key: string; message: string }> = [];
    const normalized = new Map<GameConfigKey, number | null>();

    for (const [key, value] of Object.entries(updates)) {
      if (!isGameConfigKey(key)) {
        errors.push({ key, message: '알 수 없는 설정 키입니다' });
        continue;
      }
      if (value === null) {
        normalized.set(key, null);
        continue;
      }
      const entry = ENTRY_BY_KEY[key];
      if (!Number.isSafeInteger(value)) {
        errors.push({ key, message: '정수만 입력할 수 있습니다' });
        continue;
      }
      if (value < entry.min || value > entry.max) {
        errors.push({
          key,
          message: `허용 범위는 ${entry.min}~${entry.max}입니다`,
        });
        continue;
      }
      normalized.set(key, value);
    }

    if (errors.length === 0) {
      // 교차 검증은 "업데이트 적용 후" 가상 상태로 판정
      const projected = (key: GameConfigKey): number => {
        if (normalized.has(key)) {
          const next = normalized.get(key);
          return next === null || next === undefined
            ? this.effectiveDefaults[key]
            : next;
        }
        return this.get(key);
      };
      for (const check of GAME_CONFIG_CROSS_CHECKS) {
        if (!check.validate(projected)) {
          for (const key of check.keys) {
            if (normalized.has(key)) errors.push({ key, message: check.message });
          }
          if (!check.keys.some(key => normalized.has(key))) {
            errors.push({ key: check.keys[0], message: check.message });
          }
        }
      }
    }

    if (errors.length > 0) throw new GameConfigValidationError(errors);

    const at = this.clock();
    const changes: GameConfigChange[] = [];
    const diff: GameConfigDiffEntry[] = [];
    for (const [key, value] of normalized) {
      const from = this.get(key);
      const to = value ?? this.effectiveDefaults[key];
      const hasOverride = this.overrides.has(key);
      // 무의미한 쓰기 스킵: 값 동일 + (리셋인데 오버라이드 없음 / 오버라이드 값 동일)
      if (value === null && !hasOverride) continue;
      if (value !== null && hasOverride && from === value) continue;
      changes.push({ key, value });
      if (from !== to) diff.push({ key, from, to });
    }
    if (changes.length === 0) return [];

    this.repository.saveChanges(changes, at);
    for (const change of changes) {
      const key = change.key as GameConfigKey;
      if (change.value === null) {
        this.overrides.delete(key);
      } else {
        this.overrides.set(key, { value: change.value, updatedAt: at });
      }
    }
    return diff;
  }
}

const ENTRY_BY_KEY: Record<GameConfigKey, GameConfigEntry> = Object.fromEntries(
  GAME_CONFIG_REGISTRY.map(entry => [entry.key, entry]),
) as Record<GameConfigKey, GameConfigEntry>;
