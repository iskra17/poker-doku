/**
 * 실력 배치(`story-placement`, 2026-10-20) — 서버 권위 채점.
 *
 * - 'questions': `PLACEMENT_TEMPLATE_IDS` 템플릿마다 **서버가 고른** 새 seed로 문항을 만들고 (templateId, seed)만
 *   프로필별 인메모리 Map에 보관한다(TTL, 재발급이면 교체, 크기 상한). 클라에는 `toPublicDrillInstance`만 나간다.
 * - 'submit': 'new' 자기 평가는 문항 없이 바로 beginner. 그 밖에는 유효한 발급 세트가 있어야 하고, 보관한 seed로
 *   다시 생성해 `gradeDrill`로 채점한다(답 없음·null = 오답). 채점하면 발급 세트를 지운다(발급 1회 = 제출 1회).
 * - 'set': 사용자가 등급을 직접 바꾼다(다시 측정·직접 변경 계약).
 * - 결과는 story flag `placement:tier`에만 저장한다 — 마이그레이션 없이 `StoryProgressView.flags`로 보인다.
 *
 * 서버 재시작이면 발급 세트가 사라진다 → 'submit'은 'stale-state'(문제 다시 받기 안내)로 거절되고 클라가 다시 받는다.
 */
import { randomInt } from 'node:crypto';
import type { RealtimeErrorCode } from '../lib/realtime/protocol';
import { DrillGenerationError, generateDrill, gradeDrill } from '../lib/story/drills/generator';
import { toPublicDrillInstance } from '../lib/story/drills/public';
import type { DrillAnswer, DrillInstance, DrillInstancePublic } from '../lib/story/drills/types';
import {
  decidePlacementTier,
  PLACEMENT_TEMPLATE_IDS,
  PLACEMENT_TIER_FLAG,
  type PlacementSelfReport,
  type SkillTier,
} from '../lib/story/placement';
import type { StoryTeacherId } from '../lib/story/types';

/** 배치 문항 해설 화자 — 발급·채점이 같은 컨텍스트로 생성하도록 고정한다 */
const PLACEMENT_TEACHER: StoryTeacherId = 'miyako';
export const PLACEMENT_ISSUE_TTL_MS = 30 * 60_000;
export const PLACEMENT_ISSUE_MAX_ENTRIES = 5_000;
/** 생성 실패(DrillGenerationError) 시 다른 seed로 다시 뽑는 횟수 */
const SEED_ATTEMPTS = 8;

export interface StoryPlacementRepositoryPort {
  setFlags(profileId: string, flags: Record<string, string>, now: number): void;
}

export interface StoryPlacementServiceDeps {
  repository: StoryPlacementRepositoryPort;
  now?: () => number;
  /** 문항 seed 소스 (기본 CSPRNG) — 클라가 고를 수 없으면 충분하다(보안 경계는 정답 비노출) */
  seed?: () => number;
  ttlMs?: number;
  maxEntries?: number;
}

export type PlacementResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: RealtimeErrorCode; message: string };

interface IssuedSet {
  items: Array<{ templateId: string; seed: number }>;
  expiresAt: number;
}

export class StoryPlacementService {
  private readonly issued = new Map<string, IssuedSet>();
  private readonly now: () => number;
  private readonly seed: () => number;
  private readonly ttlMs: number;
  private readonly maxEntries: number;

  constructor(private readonly deps: StoryPlacementServiceDeps) {
    this.now = deps.now ?? (() => Date.now());
    this.seed = deps.seed ?? (() => randomInt(0, 0x1_0000_0000));
    this.ttlMs = deps.ttlMs ?? PLACEMENT_ISSUE_TTL_MS;
    this.maxEntries = Math.max(1, deps.maxEntries ?? PLACEMENT_ISSUE_MAX_ENTRIES);
  }

  /** 새 문항 세트 발급 — 이전 발급은 교체된다 */
  issue(profileId: string): PlacementResult<{ questions: DrillInstancePublic[] }> {
    const now = this.now();
    this.sweep(now);
    const items: IssuedSet['items'] = [];
    const questions: DrillInstancePublic[] = [];
    try {
      for (const templateId of PLACEMENT_TEMPLATE_IDS) {
        const { seed, instance } = this.generateFresh(templateId);
        items.push({ templateId, seed });
        questions.push(toPublicDrillInstance(instance));
      }
    } catch {
      return { ok: false, code: 'server-error', message: '배치 문제를 준비하지 못했어요. 잠시 후 다시 시도해 주세요.' };
    }
    // 재발급은 교체 — 삭제 후 재삽입으로 Map 순서(오래된 순)를 유지해 상한 초과 때 가장 오래된 것부터 버린다
    this.issued.delete(profileId);
    while (this.issued.size >= this.maxEntries) {
      const oldest = this.issued.keys().next().value;
      if (oldest === undefined) break;
      this.issued.delete(oldest);
    }
    this.issued.set(profileId, { items, expiresAt: now + this.ttlMs });
    return { ok: true, value: { questions } };
  }

  /** 채점 + 등급 저장 — 'new'는 문항 없이 beginner */
  submit(
    profileId: string,
    selfReport: PlacementSelfReport,
    answers: readonly (DrillAnswer | null)[],
  ): PlacementResult<{ tier: SkillTier; correct: number; total: number }> {
    const now = this.now();
    this.sweep(now);
    if (selfReport === 'new') {
      // 'new'는 문제를 풀지 않는다 — 혹시 받아 둔 발급 세트도 버린다
      this.issued.delete(profileId);
      const tier = decidePlacementTier('new', 0, 0);
      const saved = this.persist(profileId, tier, now);
      return saved.ok ? { ok: true, value: { tier, correct: 0, total: 0 } } : saved;
    }
    const issued = this.issued.get(profileId);
    if (!issued) {
      return { ok: false, code: 'stale-state', message: '배치 문제가 만료됐어요. 문제를 다시 받아 주세요.' };
    }
    if (answers.length > issued.items.length) {
      return { ok: false, code: 'invalid-payload', message: '요청 형식이 올바르지 않아요.' };
    }
    let correct = 0;
    try {
      issued.items.forEach((item, index) => {
        const answer = answers[index] ?? null;
        if (!answer) return;
        const instance = generateDrill(item.templateId, item.seed, { teacher: PLACEMENT_TEACHER });
        if (gradeDrill(instance, answer)) correct += 1;
      });
    } catch {
      return { ok: false, code: 'server-error', message: '채점하지 못했어요. 잠시 후 다시 시도해 주세요.' };
    }
    const total = issued.items.length;
    const tier = decidePlacementTier(selfReport, correct, total);
    const saved = this.persist(profileId, tier, now);
    if (!saved.ok) return saved; // 저장 실패면 발급 세트를 남겨 같은 답으로 재시도할 수 있게 한다
    this.issued.delete(profileId);
    return { ok: true, value: { tier, correct, total } };
  }

  /** 등급 직접 변경 */
  set(profileId: string, tier: SkillTier): PlacementResult<{ tier: SkillTier }> {
    const saved = this.persist(profileId, tier, this.now());
    return saved.ok ? { ok: true, value: { tier } } : saved;
  }

  /** 프로필 폐기·로그아웃 — 발급 세트를 버린다 */
  clearProfile(profileId: string): void {
    this.issued.delete(profileId);
  }

  stats(): { issued: number } {
    return { issued: this.issued.size };
  }

  private persist(profileId: string, tier: SkillTier, now: number): PlacementResult<undefined> {
    try {
      this.deps.repository.setFlags(profileId, { [PLACEMENT_TIER_FLAG]: tier }, now);
      return { ok: true, value: undefined };
    } catch {
      return { ok: false, code: 'server-error', message: '배치 결과를 저장하지 못했어요. 잠시 후 다시 시도해 주세요.' };
    }
  }

  private generateFresh(templateId: string): { seed: number; instance: DrillInstance } {
    let lastError: unknown = null;
    for (let attempt = 0; attempt < SEED_ATTEMPTS; attempt++) {
      const seed = this.seed() >>> 0;
      try {
        return { seed, instance: generateDrill(templateId, seed, { teacher: PLACEMENT_TEACHER }) };
      } catch (error) {
        if (!(error instanceof DrillGenerationError)) throw error;
        lastError = error;
      }
    }
    throw lastError ?? new Error(`placement drill generation failed: ${templateId}`);
  }

  private sweep(now: number): void {
    for (const [profileId, entry] of this.issued) {
      if (entry.expiresAt <= now) this.issued.delete(profileId);
    }
  }
}
