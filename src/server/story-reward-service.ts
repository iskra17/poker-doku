import { STORY_CURRICULUM, type StoryCurriculum } from '@/lib/story/curriculum';
import { STORY_CHAPTERS } from '@/lib/story/chapters';
import {
  listStoryRewardPreview,
  listStoryRewardsDue,
  toStoryRewardItemView,
  type StoryRewardDefinition,
  type StoryRewardState,
} from '@/lib/story/rewards/catalog';
import type { Chapter, ChapterGrade, ChapterId } from '@/lib/story/types';
import type { StoryRewardItemView, StoryRewardPreview, StoryRewardTrigger } from '@/lib/story/views';
import type { EconomyRepository } from './economy-repository';
import type { EconomyService } from './economy-service';
import type { PokerDatabase } from './persistence/database';
import type { StoryRepository } from './story-repository';
import type { StoryRewardRepository } from './story-reward-repository';

/**
 * 수련 스토리 보상 지급 = **reconcile**.
 *
 * 자격은 durable 상태(`story_progress` completions/best_grade · `story_flags` badge:* · 막 완주)에서만 파생되므로
 * 런·등급 계산 결과를 넘겨받지 않는다. `reconcile`이 자격 집합 − 영수증 집합 = 누락분을 계산해 같은
 * 트랜잭션으로 `story_rewards`(+칩은 `chip_ledger` reason 'STORY_REWARD')에 넣는다. 호출처는 결산·데일리
 * 종료·진행도 조회 — 결산 도중 크래시가 나도 다음 조회에서 자기 치유되고, progression XP/인연 트랜잭션과는
 * 분리돼 각자 멱등이다(카탈로그 영구 아이템을 막는 v13 뷰를 v32 sync 트리거로 우회).
 */

export const STORY_REWARD_CHIP_REASON = 'STORY_REWARD';

export interface StoryRewardReconcileResult {
  /** 이번 호출로 새로 지급된 아이템(칩 제외) — 결산 카드 플립·컷신의 입력 */
  granted: StoryRewardItemView[];
  /** 이번 호출로 새로 지급된 칩 합계 */
  chips: number;
}

export interface StoryRewardServiceDeps {
  curriculum?: StoryCurriculum;
  database: PokerDatabase;
  storyRepository: Pick<StoryRepository, 'listProgress' | 'getFlags'>;
  rewardRepository: Pick<StoryRewardRepository, 'listGrantedIds' | 'grantInTransaction'>;
  economyRepository: Pick<EconomyRepository, 'applyWalletDeltaInTransaction'>;
  economyService: Pick<EconomyService, 'grantStoryDailyChips'>;
  /** 챕터 레지스트리 오버라이드 (테스트 픽스처용 — 기본 STORY_CHAPTERS) */
  chapters?: readonly Chapter[];
}

export class StoryRewardService {
  readonly #deps: StoryRewardServiceDeps;
  readonly #chapters: readonly Chapter[];

  constructor(deps: StoryRewardServiceDeps) {
    this.#deps = deps;
    this.#chapters = deps.chapters ?? STORY_CHAPTERS;
  }

  reconcile(profileId: string, now: number): StoryRewardReconcileResult {
    const runInTransaction = this.#deps.database.transaction.bind(this.#deps.database) as
      (work: () => StoryRewardReconcileResult) => StoryRewardReconcileResult;
    return runInTransaction(() => {
      const state = this.#loadState(profileId);
      const granted = this.#deps.rewardRepository.listGrantedIds(profileId);
      const items: StoryRewardItemView[] = [];
      let chips = 0;
      for (const item of listStoryRewardsDue(state, granted)) {
        const outcome = this.#deps.rewardRepository.grantInTransaction(
          profileId,
          item.id,
          storyRewardSourceKey(item.trigger),
          now,
        );
        if (outcome !== 'granted') continue;
        if (item.kind === 'chips') {
          chips += this.#grantChips(profileId, item, now);
        } else {
          items.push(toStoryRewardItemView(item));
        }
      }
      return { granted: items, chips };
    });
  }

  /** 카탈로그 전체 미리보기 — 획득 여부는 영수증이 소스 (허브 카드 칩·갤러리 잠금) */
  preview(profileId: string): StoryRewardPreview[] {
    return listStoryRewardPreview(this.#chapters, this.grantedIds(profileId));
  }

  grantedIds(profileId: string): Set<string> {
    return this.#deps.rewardRepository.listGrantedIds(profileId);
  }

  /** 오늘의 수련 완료 칩 — 날짜당 1회, 이미 지급이면 0 */
  grantDailyChips(profileId: string, kstDate: string, now: number): number {
    return this.#deps.economyService.grantStoryDailyChips(profileId, kstDate, now);
  }

  #grantChips(profileId: string, item: StoryRewardDefinition, now: number): number {
    const amount = item.chipAmount ?? 0;
    if (amount <= 0) return 0;
    this.#deps.economyRepository.applyWalletDeltaInTransaction(
      profileId,
      amount,
      STORY_REWARD_CHIP_REASON,
      `story-reward:${lengthPrefixed(profileId)}:${lengthPrefixed(item.id)}`,
      item.id,
      now,
    );
    return amount;
  }

  #loadState(profileId: string): StoryRewardState {
    const rows = this.#deps.storyRepository.listProgress(profileId);
    const completed = new Set<ChapterId>();
    const bestGrade = new Map<ChapterId, ChapterGrade>();
    for (const row of rows) {
      if (row.completions > 0) completed.add(row.chapterId);
      if (row.bestGrade) bestGrade.set(row.chapterId, row.bestGrade);
    }
    return {
      curriculum: this.#deps.curriculum ?? STORY_CURRICULUM,
      completed,
      bestGrade,
      flags: this.#deps.storyRepository.getFlags(profileId),
      chapters: this.#chapters,
    };
  }
}

/** 영수증 source_key — 자격 트리거를 감사 가능한 문자열로 */
export function storyRewardSourceKey(trigger: StoryRewardTrigger): string {
  switch (trigger.kind) {
    case 'chapter-first-clear':
      return `story-chapter:${trigger.chapterId}:first`;
    case 'chapter-grade':
      return `story-chapter:${trigger.chapterId}:grade-${trigger.grade}`;
    case 'act-complete':
      return `story-act:${trigger.act}`;
    case 'flag':
      return `story-flag:${trigger.key}`;
  }
}

function lengthPrefixed(value: string): string {
  return `${value.length}:${value}`;
}
