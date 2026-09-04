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
import { mergeGuidedSituation } from './helpers';
import type { Card } from '@/lib/poker/types';
import {
  isSceneEffect,
  isStoryHeroineId,
  isStoryTeacherRef,
  OBJECTIVE_KINDS,
  STORY_BELTS,
  type Chapter,
  type ChapterId,
  type DealScript,
  type Scene,
  type SceneSayLine,
  type Step,
} from '../types';

/** 등록된 챕터 — 막·순서 정렬을 유지할 것 (chapters.test.ts가 검증). */
export const STORY_CHAPTERS: readonly Chapter[] = Object.freeze([CH01, CH02, CH03, CH04, CH05, CH06]);

const CHAPTER_BY_ID: ReadonlyMap<ChapterId, Chapter> = new Map(STORY_CHAPTERS.map(chapter => [chapter.id, chapter]));

export function getChapter(id: ChapterId): Chapter | undefined {
  return CHAPTER_BY_ID.get(id);
}

export interface ValidateChaptersOptions {
  /** 존재하는 드릴 템플릿 id 집합 — 없으면 templateId 존재 검사를 건너뛴다 */
  templateIds?: ReadonlySet<string>;
}

const CHAPTER_ID_PATTERN = /^act[1-4]-ch\d{2}$/;
const OBJECTIVE_KIND_SET: ReadonlySet<string> = new Set(OBJECTIVE_KINDS);
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
        for (const slot of step.drills) {
          if (options.templateIds && !options.templateIds.has(slot.templateId)) {
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
          if (!OBJECTIVE_KIND_SET.has(objective.kind)) errors.push(`${stepAt}: unknown objective kind ${String(objective.kind)}`);
          if (objective.minRatio !== undefined && !(objective.minRatio > 0 && objective.minRatio <= 1)) {
            errors.push(`${stepAt}: objective ${objective.id} minRatio must be within (0, 1]`);
          }
          if (objectiveIds.has(objective.id)) errors.push(`${stepAt}: duplicate objective id ${objective.id} (chapter-wide unique)`);
          objectiveIds.add(objective.id);
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

function validateTable(step: Extract<Step, { kind: 'practice-table' | 'sparring' }>, at: string, errors: string[]): void {
  const { table } = step;
  if (!(table.blinds.small > 0 && table.blinds.big > table.blinds.small)) errors.push(`${at}: invalid blinds`);
  if (!Number.isInteger(table.heroSeat) || table.heroSeat < 0 || table.heroSeat >= MAX_SEATS) errors.push(`${at}: heroSeat out of range`);
  if (!(table.heroStackBB > 0)) errors.push(`${at}: heroStackBB must be > 0`);
  if (table.lineup.length === 0 || table.lineup.length >= MAX_SEATS) errors.push(`${at}: lineup must have 1..${MAX_SEATS - 1} seats`);
  const seats = new Set<number>([table.heroSeat]);
  const characters = new Set<string>();
  for (const seat of table.lineup) {
    if (seats.has(seat.seatIndex)) errors.push(`${at}: duplicate seat ${seat.seatIndex}`);
    seats.add(seat.seatIndex);
    if (seat.seatIndex < 0 || seat.seatIndex >= MAX_SEATS) errors.push(`${at}: seat ${seat.seatIndex} out of range`);
    if (characters.has(seat.characterId)) errors.push(`${at}: duplicate character ${seat.characterId}`);
    characters.add(seat.characterId);
    // 라인업은 전원 착석이 전제(어댑터가 한 좌석이라도 못 앉히면 방을 열지 않는다) — BOT_CHARACTERS 로스터만 허용(딜러·가면 등 비로스터 캐릭터 불가)
    if (seat.characterId !== 'partner' && !BOT_CHARACTERS.some(c => c.id === seat.characterId)) {
      errors.push(`${at}: seat ${seat.seatIndex} character ${seat.characterId} is not a playable bot`);
    }
    if (!(seat.stackBB > 0)) errors.push(`${at}: seat ${seat.seatIndex} stackBB must be > 0`);
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
