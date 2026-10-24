/**
 * 실력 배치(`story-placement`, 2026-10-20) — 서버 권위 채점.
 *
 * - 'questions': `PLACEMENT_TEMPLATE_IDS` 템플릿마다 **서버가 고른** 새 seed로 문항을 만들고 (templateId, seed)만
 *   프로필별 인메모리 Map에 보관한다(TTL, 재발급이면 교체, 크기 상한). 클라에는 `toPublicDrillInstance`만 나간다.
 * - 'submit': 'new' 자기 평가는 문항 없이 바로 beginner. 그 밖에는 유효한 발급 세트가 있어야 하고, 보관한 seed로
 *   다시 생성해 `gradeDrill`로 채점한다(답 없음·null = 오답). 채점하면 발급 세트를 지운다(발급 1회 = 제출 1회).
 * - 'set': 사용자가 등급을 직접 바꾼다(다시 측정·직접 변경 계약).
 * - 'self-report'(첫 수련, 2026-10-24): 문제 없이 자기 평가만으로 등급을 정한다 — `tierFromSelfReport`라 advanced는 없다.
 *   `placement:check`='pending'을 함께 남겨 Ch1 뒤 4문 체크 초대가 열린다.
 * - 'check': Ch1 뒤 초대의 4문 — 'submit'과 같은 발급/채점 경로. 숙련 기준을 넘을 때만 advanced로 올리고 그 밖에는
 *   등급을 건드리지 않는다. 'decline'은 초대만 접는다. 채점된 'submit'·'check'는 `placement:check`='taken'.
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
  PLACEMENT_CHECK_FLAG,
  PLACEMENT_TEMPLATE_IDS,
  PLACEMENT_TIER_FLAG,
  placementCheckPromotion,
  tierFromSelfReport,
  type PlacementCheckState,
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
      const saved = this.persist(profileId, { [PLACEMENT_TIER_FLAG]: tier }, now);
      return saved.ok ? { ok: true, value: { tier, correct: 0, total: 0 } } : saved;
    }
    const graded = this.grade(profileId, answers);
    if (!graded.ok) return graded;
    const { correct, total } = graded.value;
    const tier = decidePlacementTier(selfReport, correct, total);
    const saved = this.persist(profileId, { [PLACEMENT_TIER_FLAG]: tier, [PLACEMENT_CHECK_FLAG]: ('taken' satisfies PlacementCheckState) }, now);
    if (!saved.ok) return saved; // 저장 실패면 발급 세트를 남겨 같은 답으로 재시도할 수 있게 한다
    this.issued.delete(profileId);
    return { ok: true, value: { tier, correct, total } };
  }

  /** 첫 수련 — 자기 평가만으로 등급 저장(advanced 없음) + Ch1 뒤 체크 초대 대기 */
  selfReport(profileId: string, selfReport: PlacementSelfReport): PlacementResult<{ tier: SkillTier }> {
    const now = this.now();
    this.sweep(now);
    this.issued.delete(profileId);
    const tier = tierFromSelfReport(selfReport);
    const saved = this.persist(profileId, { [PLACEMENT_TIER_FLAG]: tier, [PLACEMENT_CHECK_FLAG]: ('pending' satisfies PlacementCheckState) }, now);
    return saved.ok ? { ok: true, value: { tier } } : saved;
  }

  /** Ch1 뒤 4문 체크 — 숙련 기준이면 advanced로 올리고, 아니면 등급을 그대로 둔다 */
  check(
    profileId: string,
    answers: readonly (DrillAnswer | null)[],
  ): PlacementResult<{ tier?: 'advanced'; promoted: boolean; correct: number; total: number }> {
    const now = this.now();
    this.sweep(now);
    const graded = this.grade(profileId, answers);
    if (!graded.ok) return graded;
    const { correct, total } = graded.value;
    const promoted = placementCheckPromotion(correct, total);
    const flags: Record<string, string> = { [PLACEMENT_CHECK_FLAG]: ('taken' satisfies PlacementCheckState) };
    if (promoted) flags[PLACEMENT_TIER_FLAG] = promoted;
    const saved = this.persist(profileId, flags, now);
    if (!saved.ok) return saved;
    this.issued.delete(profileId);
    return { ok: true, value: promoted ? { tier: promoted, promoted: true, correct, total } : { promoted: false, correct, total } };
  }

  /** Ch1 뒤 체크 초대 거절 — 등급은 그대로 */
  decline(profileId: string): PlacementResult<{ declined: true }> {
    this.issued.delete(profileId);
    const saved = this.persist(profileId, { [PLACEMENT_CHECK_FLAG]: ('declined' satisfies PlacementCheckState) }, this.now());
    return saved.ok ? { ok: true, value: { declined: true } } : saved;
  }

  /** 등급 직접 변경 */
  set(profileId: string, tier: SkillTier): PlacementResult<{ tier: SkillTier }> {
    const saved = this.persist(profileId, { [PLACEMENT_TIER_FLAG]: tier }, this.now());
    return saved.ok ? { ok: true, value: { tier } } : saved;
  }

  /** 프로필 폐기·로그아웃 — 발급 세트를 버린다 */
  clearProfile(profileId: string): void {
    this.issued.delete(profileId);
  }

  stats(): { issued: number } {
    return { issued: this.issued.size };
  }

  /** 발급 세트를 서버 seed로 재생성해 채점한다(답 없음·null = 오답). 발급 세트는 호출자가 저장 성공 뒤 지운다 */
  private grade(profileId: string, answers: readonly (DrillAnswer | null)[]): PlacementResult<{ correct: number; total: number }> {
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
    return { ok: true, value: { correct, total: issued.items.length } };
  }

  private persist(profileId: string, flags: Record<string, string>, now: number): PlacementResult<undefined> {
    try {
      this.deps.repository.setFlags(profileId, flags, now);
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
