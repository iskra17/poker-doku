import { CH08 } from './act3/ch08-curious-call';
import { CH09 } from './act3/ch09-shadows-and-traps';
import { CH07 } from './act3/ch07-masquerade';
/**
 * 챕터 레지스트리 + 데이터 검증.
 *
 * 챕터는 파일당 1개(`chapters/act1/ch01-*.ts`·`act2/ch04-*.ts`)의 수기 TS 데이터다. 여기서 모아 `STORY_CHAPTERS`로
 * 노출하고, `validateChapters`가 스키마·requires 그래프·교사·스텝 id·드릴 템플릿 존재·프리셋 카드
 * 표기를 검사한다 — chapters.test.ts가 레지스트리 전체에 대해 실행한다.
 */
import { isSceneCgId } from '@/lib/assets/story-cgs';
import { BOT_CHARACTERS, getCharacterById } from '@/lib/characters';
import { findDuplicateCard, tryParseCards } from '@/lib/poker/card-notation';
import { CH01 } from './act1/ch01-dojo-gate';
import { CH02 } from './act1/ch02-art-of-waiting';
import { CH03 } from './act1/ch03-numbers-dont-lie';
import { CH04 } from './act2/ch04-first-strike';
import { CH05 } from './act2/ch05-take-what-is-yours';
import { CH06 } from './act2/ch06-three-bet-temperature';
import { CH10 } from './act4/ch10-storm-call';
import { CH11 } from './act4/ch11-all-round';
import { CH12 } from './act4/ch12-graduation';
import { mergeGuidedSituation } from './helpers';
import type { Card } from '@/lib/poker/types';
import {
  HEROINE_FILL_SEAT,
  isSceneEffect,
  isStoryHeroineId,
  isStoryTeacherRef,
  OBJECTIVE_KINDS,
  REVIEW_SLOT_TEMPLATE_ID,
  STORY_BELTS,
  STORY_HEROINE_IDS,
  type Chapter,
  type ChapterId,
  type DealScript,
  type Objective,
  type Scene,
  type SceneSayLine,
  type Step,
} from '../types';

/** 등록된 챕터 — 막·순서 정렬을 유지할 것 (chapters.test.ts가 검증). */
export const STORY_CHAPTERS: readonly Chapter[] = Object.freeze([CH01, CH02, CH03, CH04, CH05, CH06, CH07, CH08, CH09, CH10, CH11, CH12]);

const CHAPTER_BY_ID: ReadonlyMap<ChapterId, Chapter> = new Map(STORY_CHAPTERS.map(chapter => [chapter.id, chapter]));

export function getChapter(id: ChapterId): Chapter | undefined {
  return CHAPTER_BY_ID.get(id);
}

export interface ValidateChaptersOptions {
  /** 존재하는 드릴 템플릿 id 집합 — 없으면 templateId 존재 검사를 건너뛴다 */
  templateIds?: ReadonlySet<string>;
  /**
   * **생성** 드릴 템플릿 id 집합 — 주면 `reviewPool` 항목이 생성 템플릿인지까지 검사한다.
   * 수기 문항은 seed를 바꿔도 같은 문제라 복습 후보가 될 수 없고, 런타임 필터가 전부 걸러
   * 드릴 세트가 통째로 건너뛰어진다(조용한 콘텐츠 누락).
   */
  generatedTemplateIds?: ReadonlySet<string>;
}

const CHAPTER_ID_PATTERN = /^act[1-4]-ch\d{2}$/;
const OBJECTIVE_KIND_SET: ReadonlySet<string> = new Set(OBJECTIVE_KINDS);
/** 최종 기회로 target을 한정할 수 있는 kind — 새 기회형 횟수 목표만 opt-in한다. */
const FINAL_CAP_KINDS: readonly string[] = ['gumi-river-call', 'honest-river-fold', 'luna-checkraise-fold', 'topair-calldown'];
/**
 * 체크리스트 항목으로 허용하는 kind — 비율형/상한형만. 부모(any-k-of)와 합산형(executed-any) 중첩은 금지한다
 * (부모를 자식으로 넣으면 "몇 개 달성"의 분모가 재귀로 흐려진다).
 */
const CHECKLIST_ITEM_KINDS: ReadonlySet<string> = new Set([
  'fold-preflop-junk', 'no-junk-entry', 'cbet-when-aggressor', 'correct-pot-odds-call', 'value-bet-river',
  'open-raise', 'no-limp', 'steal-open', 'no-air-river-bet', 'value-bet-sizing', 'premium-3bet',
  'fold-vs-3bet-junk', 'no-junk-4bet', 'topair-calldown', 'no-air-reraise', 'overbet-decision',
]);
const BELT_SET: ReadonlySet<string> = new Set(STORY_BELTS);
const MAX_SEATS = 6;

/** 오류 메시지 목록 — 비어 있으면 유효. 첫 오류에서 멈추지 않고 전부 모은다. */
export function validateChapters(chapters: readonly Chapter[], options: ValidateChaptersOptions = {}): string[] {
  const errors: string[] = [];
  const ids = new Set<ChapterId>();

  for (const chapter of chapters) {
    const at = `chapter ${chapter.id}`;
    if (!CHAPTER_ID_PATTERN.test(chapter.id)) errors.push(`${at}: id must match act{1-4}-ch{NN}`);
    if (ids.has(chapter.id)) errors.push(`${at}: duplicate chapter id`);
    ids.add(chapter.id);
    const expectedId = `act${chapter.act}-ch`;
    if (!chapter.id.startsWith(expectedId)) errors.push(`${at}: act ${chapter.act} does not match id`);
    if (!Number.isInteger(chapter.order) || chapter.order < 1) errors.push(`${at}: order must be a positive integer`);
    if (!isStoryTeacherRef(chapter.teacher)) errors.push(`${at}: unknown teacher ${String(chapter.teacher)}`);
    if (!BELT_SET.has(chapter.belt)) errors.push(`${at}: unknown belt ${String(chapter.belt)}`);
    if (!chapter.title.trim() || !chapter.subtitle.trim()) errors.push(`${at}: title/subtitle required`);
    if (!(chapter.estimatedMinutes > 0)) errors.push(`${at}: estimatedMinutes must be > 0`);
    if (chapter.requires.includes(chapter.id)) errors.push(`${at}: requires itself`);
    if (chapter.graduation) {
      // 졸업 챕터는 순위로 통과하므로 드릴만 푸는 실력 확인 우회를 막고, 토너먼트 스파링이 정확히 하나여야 한다
      if (!chapter.examDisabled) errors.push(`${at}: graduation chapter must set examDisabled`);
      const tournaments = chapter.steps.filter(step => step.kind === 'sparring' && step.table.tournament).length;
      if (tournaments !== 1) errors.push(`${at}: graduation chapter needs exactly one tournament sparring (found ${tournaments})`);
    }
    validateRewards(chapter, errors);
    validateSteps(chapter, options, errors);
    if (chapter.failScene) validateScene(chapter.failScene, `${at} failScene`, errors);
  }

  // requires 참조·순환
  for (const chapter of chapters) {
    for (const required of chapter.requires) {
      if (!ids.has(required)) errors.push(`chapter ${chapter.id}: requires unknown chapter ${required}`);
    }
  }
  const cycle = findRequiresCycle(chapters);
  if (cycle) errors.push(`requires cycle: ${cycle.join(' -> ')}`);

  // 막 안 순서 유일
  const orderKeys = new Set<string>();
  for (const chapter of chapters) {
    const key = `${chapter.act}:${chapter.order}`;
    if (orderKeys.has(key)) errors.push(`chapter ${chapter.id}: duplicate order ${chapter.order} in act ${chapter.act}`);
    orderKeys.add(key);
  }

  return errors;
}

function validateRewards(chapter: Chapter, errors: string[]): void {
  const at = `chapter ${chapter.id} rewards`;
  const { first, replay, gradeBonusMilli } = chapter.rewards;
  if (!(first.dojoXpMilli >= 0) || !(replay.dojoXpMilli >= 0)) errors.push(`${at}: dojoXpMilli must be >= 0`);
  for (const grant of first.affinity) {
    if (!(grant.milli > 0)) errors.push(`${at}: affinity grant for ${grant.target} must be > 0`);
    if (grant.target !== 'partner' && grant.target !== 'all' && !isStoryHeroineId(grant.target)) {
      errors.push(`${at}: unknown affinity target ${String(grant.target)} (miyako is not an affinity target)`);
    }
  }
  for (const [grade, milli] of Object.entries(gradeBonusMilli)) {
    if (!(milli >= 0)) errors.push(`${at}: gradeBonus ${grade} must be >= 0`);
  }
}

function validateSteps(chapter: Chapter, options: ValidateChaptersOptions, errors: string[]): void {
  const at = `chapter ${chapter.id}`;
  const stepIds = new Set<string>();
  // 목표·인터럽트 id는 챕터 전역 유일 — 결산 뷰가 스파링 스텝 여러 개의 목표를 flat하게 합치고 id를 키로 쓴다
  const objectiveIds = new Set<string>();
  const interruptIds = new Set<string>();
  if (chapter.steps.length === 0) errors.push(`${at}: no steps`);
  let resultCount = 0;

  for (const step of chapter.steps) {
    const stepAt = `${at} step ${step.id}`;
    if (stepIds.has(step.id)) errors.push(`${stepAt}: duplicate step id`);
    stepIds.add(step.id);

    switch (step.kind) {
      case 'scene':
        validateScene(step.scene, stepAt, errors);
        break;
      case 'lesson':
        if (step.blocks.length === 0) errors.push(`${stepAt}: lesson has no blocks`);
        for (const block of step.blocks) {
          if (block.kind === 'guided') {
            if (!isStoryTeacherRef(block.teacher)) errors.push(`${stepAt}: unknown guided teacher ${String(block.teacher)}`);
            if (block.stages.length === 0) errors.push(`${stepAt}: guided block has no stages`);
            // 상황은 필수 — 단계마다 병합 결과가 유효해야 한다(카드 중복 없음, 팟 ≥ 콜 ≥ 0)
            if (!block.situation) {
              errors.push(`${stepAt}: guided block has no situation`);
            } else {
              block.stages.forEach((stage, stageIndex) => {
                const merged = mergeGuidedSituation(block.situation, stage.situation);
                const at = `${stepAt} guided stage ${stageIndex}`;
                const duplicate = findDuplicateCard([
                  ...merged.hero,
                  ...merged.board,
                  ...merged.villains.flatMap(villain => villain.holeCards ?? []),
                ]);
                if (duplicate) errors.push(`${at}: duplicate card ${duplicate}`);
                if (![0, 3, 4, 5].includes(merged.board.length)) errors.push(`${at}: board must have 0/3/4/5 cards`);
                if (merged.hero.length !== 0 && merged.hero.length !== 2) errors.push(`${at}: hero must have 0 or 2 cards`);
                if (!(merged.potChips >= merged.toCallChips && merged.toCallChips >= 0)) errors.push(`${at}: potChips >= toCallChips >= 0 required`);
                for (const villain of merged.villains) {
                  if (!getCharacterById(villain.characterId)) errors.push(`${at}: unknown villain ${villain.characterId}`);
                }
              });
            }
          }
        }
        break;
      case 'drill-set':
        if (!isStoryTeacherRef(step.teacher)) errors.push(`${stepAt}: unknown teacher ${String(step.teacher)}`);
        if (step.drills.length === 0) errors.push(`${stepAt}: drill set is empty`);
        if (!(step.hintPenalty >= 0 && step.hintPenalty <= 1)) errors.push(`${stepAt}: hintPenalty must be within 0..1`);
        {
          // 동적 복습 슬롯: sentinel이 있어야 reviewPool을 둘 수 있고, sentinel만 있고 풀이 비면 낼 문제가 없다
          const sentinels = step.drills.filter(slot => slot.templateId === REVIEW_SLOT_TEMPLATE_ID).length;
          if (sentinels > 0) {
            if (!step.reviewPool || step.reviewPool.length === 0) {
              errors.push(`${stepAt}: review slots require a non-empty reviewPool`);
            }
            for (const templateId of step.reviewPool ?? []) {
              if (options.templateIds && !options.templateIds.has(templateId)) {
                errors.push(`${stepAt}: unknown reviewPool template ${templateId}`);
              } else if (options.generatedTemplateIds && !options.generatedTemplateIds.has(templateId)) {
                errors.push(`${stepAt}: reviewPool template ${templateId} is not a generated template`);
              }
            }
          } else if (step.reviewPool !== undefined) {
            errors.push(`${stepAt}: reviewPool requires at least one '${REVIEW_SLOT_TEMPLATE_ID}' slot`);
          }
        }
        for (const slot of step.drills) {
          // sentinel은 런타임(코디네이터)이 실제 템플릿으로 해석하므로 레지스트리 검사 대상이 아니다
          if (slot.templateId !== REVIEW_SLOT_TEMPLATE_ID && options.templateIds && !options.templateIds.has(slot.templateId)) {
            errors.push(`${stepAt}: unknown drill template ${slot.templateId}`);
          }
          if (slot.seedPolicy === 'fixed' && !Number.isInteger(slot.fixedSeed)) {
            errors.push(`${stepAt}: fixed seed policy requires fixedSeed`);
          }
        }
        break;
      case 'practice-table':
        if (step.tag !== '연습') errors.push(`${stepAt}: practice-table must carry the '연습' tag`);
        validateTable(step, stepAt, errors);
        if (step.scripts.length === 0) errors.push(`${stepAt}: no deal scripts`);
        step.scripts.forEach((script, index) => validateDealScript(script, step.table.lineup.map(seat => seat.seatIndex), step.table.heroSeat, `${stepAt} script #${index + 1}`, errors));
        break;
      case 'sparring':
        if (step.tag !== '대결') errors.push(`${stepAt}: sparring must carry the '대결' tag`);
        validateTable(step, stepAt, errors);
        if (!Number.isInteger(step.maxHands) || step.maxHands < 1) errors.push(`${stepAt}: maxHands must be >= 1`);
        if (step.minHands !== undefined && (!Number.isInteger(step.minHands) || step.minHands < 1 || step.minHands > step.maxHands)) {
          errors.push(`${stepAt}: minHands must be an integer within 1..maxHands`);
        }
        for (const objective of [...step.objectives.primary, ...step.objectives.bonus]) {
          validateObjective(objective, at, stepAt, objectiveIds, errors);
        }
        if (step.checklist) {
          const checklist = step.checklist;
          if (!Number.isInteger(checklist.k) || checklist.k < 1) errors.push(`${stepAt}: checklist k must be a positive integer`);
          if (checklist.items.length === 0) errors.push(`${stepAt}: checklist has no items`);
          if (!checklist.label.trim()) errors.push(`${stepAt}: checklist label required`);
          // 부모 id도 챕터 전역 유일 — 결산이 목표 id를 키로 합치기 때문
          if (objectiveIds.has(checklist.id)) errors.push(`${stepAt}: duplicate objective id ${checklist.id} (chapter-wide unique)`);
          objectiveIds.add(checklist.id);
          for (const item of checklist.items) {
            if (!CHECKLIST_ITEM_KINDS.has(item.kind)) errors.push(`${stepAt}: checklist item ${item.id} kind ${String(item.kind)} is not allowed`);
            validateObjective(item, at, stepAt, objectiveIds, errors);
          }
        }
        for (const interrupt of step.interrupts) {
          if (interruptIds.has(interrupt.id)) errors.push(`${stepAt}: duplicate interrupt id ${interrupt.id} (chapter-wide unique)`);
          interruptIds.add(interrupt.id);
          validateScene(interrupt.scene, `${stepAt} interrupt ${interrupt.id}`, errors);
        }
        break;
      case 'result':
        resultCount += 1;
        break;
    }
  }
  if (resultCount !== 1) errors.push(`${at}: exactly one result step required (found ${resultCount})`);
  if (chapter.steps[chapter.steps.length - 1]?.kind !== 'result') errors.push(`${at}: result step must be last`);
}

/** 목표 하나의 스키마 — primary/bonus와 체크리스트 항목이 같은 규칙을 쓴다. */
function validateObjective(objective: Objective, at: string, stepAt: string, objectiveIds: Set<string>, errors: string[]): void {
  if (!OBJECTIVE_KIND_SET.has(objective.kind)) errors.push(`${stepAt}: unknown objective kind ${String(objective.kind)}`);
  if (objective.finalOpportunityCap && (!FINAL_CAP_KINDS.includes(objective.kind)
    || objective.target === undefined || objective.target < 1 || !Number.isInteger(objective.target))) errors.push(`${at}: invalid final opportunity cap`);
  if (objective.target !== undefined && objective.minRatio !== undefined) errors.push(`${at}: target and minRatio cannot be combined`);
  if (objective.minRatio !== undefined && !(objective.minRatio > 0 && objective.minRatio <= 1)) {
    errors.push(`${stepAt}: objective ${objective.id} minRatio must be within (0, 1]`);
  }
  if (objectiveIds.has(objective.id)) errors.push(`${stepAt}: duplicate objective id ${objective.id} (chapter-wide unique)`);
  objectiveIds.add(objective.id);
}

function validateTable(step: Extract<Step, { kind: 'practice-table' | 'sparring' }>, at: string, errors: string[]): void {
  const { table } = step;
  if (!(table.blinds.small > 0 && table.blinds.big > table.blinds.small)) errors.push(`${at}: invalid blinds`);
  if (!Number.isInteger(table.heroSeat) || table.heroSeat < 0 || table.heroSeat >= MAX_SEATS) errors.push(`${at}: heroSeat out of range`);
  if (!(table.heroStackBB > 0)) errors.push(`${at}: heroStackBB must be > 0`);
  if (table.reading && (table.reading.id !== 'river-reading-v1' || table.reading.maxQuestions !== 2 || table.masquerade)) errors.push(`${at}: invalid reading policy`);
  if (table.readingReview && table.readingReview.id !== 'act3-response-v1') errors.push(`${at}: invalid reading review policy`);
  if (table.masquerade) {
    const policy = table.masquerade;
    if (step.kind !== 'sparring' || policy.id !== 'masquerade-v1' || policy.seats.length !== 4 || new Set(policy.seats).size !== 4
      || policy.seats.some(seat => seat === table.heroSeat || !table.lineup.some(bot => bot.seatIndex === seat && bot.characterId === 'story-mask'))
      || table.lineup.length !== 4 || policy.observeHands !== 12 || policy.revealedMinHands !== 2 || policy.revealedMaxHands !== 10
      || step.maxHands !== 22 || step.minHands !== 14
      || !step.objectives.primary.some(objective => objective.kind === 'quiz-accuracy' && objective.params?.required === 4 && objective.minRatio === 0.75)
      || !step.objectives.primary.some(objective => objective.kind === 'opponent-response' && objective.minRatio === 0.5)) errors.push(`${at}: invalid masquerade policy`);
  }
  if (table.reviewPolicy !== undefined && table.reviewPolicy !== 'act4-overbet-v1') errors.push(`${at}: invalid review policy`);
  if (table.tournament) {
    const policy = table.tournament;
    // 졸업 대결: 실제 6인 SnG — 통과는 엔진 순위가 정한다(행동 목표 없음). 라인업은 히로인 토큰 없이 비히로인 봇 5석 고정.
    if (
      step.kind !== 'sparring'
      || policy.id !== 'graduation-sng-v1'
      || policy.sngStructureId !== 'graduation'
      || table.masquerade || table.reading || table.readingReview
      || table.lineup.length !== 5
      || table.lineup.some(seat => seat.characterId === 'partner' || seat.characterId === HEROINE_FILL_SEAT
        || !BOT_CHARACTERS.some(character => character.id === seat.characterId))
      || step.objectives.primary.length !== 0
      || step.objectives.bonus.length !== 0
      || step.checklist !== undefined
      || step.maxHands < 200
      || table.turnTimeSec !== 30
      || table.botThinkScale !== 0.5
    ) errors.push(`${at}: invalid tournament policy`);
  }
  if (table.lineup.length === 0 || table.lineup.length >= MAX_SEATS) errors.push(`${at}: lineup must have 1..${MAX_SEATS - 1} seats`);
  const seats = new Set<number>([table.heroSeat]);
  const characters = new Set<string>();
  for (const seat of table.lineup) {
    if (seats.has(seat.seatIndex)) errors.push(`${at}: duplicate seat ${seat.seatIndex}`);
    seats.add(seat.seatIndex);
    if (seat.seatIndex < 0 || seat.seatIndex >= MAX_SEATS) errors.push(`${at}: seat ${seat.seatIndex} out of range`);
    // 'heroine-fill'은 좌석마다 다른 히로인으로 풀리므로 중복 캐릭터 검사에서 예외다
    const fill = seat.characterId === HEROINE_FILL_SEAT;
    if (!fill && characters.has(seat.characterId) && !(table.masquerade && seat.characterId === 'story-mask')) errors.push(`${at}: duplicate character ${seat.characterId}`);
    characters.add(seat.characterId);
    if (fill && step.kind !== 'sparring') errors.push(`${at}: '${HEROINE_FILL_SEAT}' seats are allowed in sparring only`);
    // 라인업은 전원 착석이 전제(어댑터가 한 좌석이라도 못 앉히면 방을 열지 않는다) — BOT_CHARACTERS 로스터만 허용(딜러·가면 등 비로스터 캐릭터 불가)
    if (!fill && seat.characterId !== 'partner' && !(table.masquerade && seat.characterId === 'story-mask') && !BOT_CHARACTERS.some(c => c.id === seat.characterId)) {
      errors.push(`${at}: seat ${seat.seatIndex} character ${seat.characterId} is not a playable bot`);
    }
    if (!(seat.stackBB > 0)) errors.push(`${at}: seat ${seat.seatIndex} stackBB must be > 0`);
  }
  // 파트너 + fill + 명시 히로인이 로스터보다 많으면 채울 히로인이 모자란다(어댑터가 방을 열지 못한다)
  const heroineSeats = table.lineup.filter(seat => seat.characterId === 'partner'
    || seat.characterId === HEROINE_FILL_SEAT || isStoryHeroineId(seat.characterId)).length;
  if (heroineSeats > STORY_HEROINE_IDS.length) {
    errors.push(`${at}: heroine seats exceed the roster (${heroineSeats} > ${STORY_HEROINE_IDS.length})`);
  }
  if (!(table.turnTimeSec >= 5)) errors.push(`${at}: turnTimeSec must be >= 5`);
  if (!(table.botThinkScale > 0)) errors.push(`${at}: botThinkScale must be > 0`);
}

function validateDealScript(script: DealScript, lineupSeats: number[], heroSeat: number, at: string, errors: string[]): void {
  const all: Card[] = [];
  const hero = tryParseCards(script.hero);
  if (!hero || hero.length !== 2) errors.push(`${at}: hero must be exactly 2 cards`);
  else all.push(...hero);
  if (script.board !== undefined) {
    const board = tryParseCards(script.board);
    if (!board || board.length < 3 || board.length > 5) errors.push(`${at}: board must be 3..5 cards`);
    else all.push(...board);
  }
  for (const [seatText, codes] of Object.entries(script.villains ?? {})) {
    const seat = Number(seatText);
    if (!lineupSeats.includes(seat) || seat === heroSeat) errors.push(`${at}: villain seat ${seatText} is not in the lineup`);
    const cards = tryParseCards(codes);
    if (!cards || cards.length !== 2) errors.push(`${at}: villain seat ${seatText} must have exactly 2 cards`);
    else all.push(...cards);
  }
  const duplicate = findDuplicateCard(all);
  if (duplicate) errors.push(`${at}: duplicate card ${duplicate} across script`);
}

function validateSayLine(line: SceneSayLine, sceneId: string, at: string, errors: string[]): void {
  if (!line.text.trim()) errors.push(`${at}: scene ${sceneId} has an empty line`);
  if (line.cg !== undefined && !isSceneCgId(line.cg)) errors.push(`${at}: scene ${sceneId} unknown cg ${String(line.cg)}`);
  if (line.effect !== undefined && !isSceneEffect(line.effect)) errors.push(`${at}: scene ${sceneId} unknown effect ${String(line.effect)}`);
}

function validateScene(scene: Scene, at: string, errors: string[]): void {
  if (scene.lines.length === 0) errors.push(`${at}: scene ${scene.id} has no lines`);
  for (const line of scene.lines) {
    if (line.kind === 'say') {
      validateSayLine(line, scene.id, at, errors);
    } else {
      if (line.choice.options.length < 2) errors.push(`${at}: choice ${line.choice.id} needs >= 2 options`);
      const optionIds = new Set<string>();
      for (const option of line.choice.options) {
        if (optionIds.has(option.id)) errors.push(`${at}: choice ${line.choice.id} duplicate option ${option.id}`);
        optionIds.add(option.id);
        for (const reply of option.reply ?? []) validateSayLine(reply, scene.id, at, errors);
      }
    }
  }
}

/** requires 그래프 순환 탐지 — 순환 경로를 돌려주고 없으면 null */
export function findRequiresCycle(chapters: readonly Chapter[]): ChapterId[] | null {
  const byId = new Map(chapters.map(chapter => [chapter.id, chapter]));
  const state = new Map<ChapterId, 'visiting' | 'done'>();
  const stack: ChapterId[] = [];

  const visit = (id: ChapterId): ChapterId[] | null => {
    const current = state.get(id);
    if (current === 'done') return null;
    if (current === 'visiting') {
      const start = stack.indexOf(id);
      return [...stack.slice(start), id];
    }
    state.set(id, 'visiting');
    stack.push(id);
    for (const required of byId.get(id)?.requires ?? []) {
      if (!byId.has(required)) continue;
      const found = visit(required);
      if (found) return found;
    }
    stack.pop();
    state.set(id, 'done');
    return null;
  };

  for (const chapter of chapters) {
    const found = visit(chapter.id);
    if (found) return found;
  }
  return null;
}
