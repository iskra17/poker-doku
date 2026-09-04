/**
 * 스토리 컷인 데이터(순수) — 드릴 퍼펙트 / 스파링 미션 클리어 / 보스 격파.
 * 렌더는 `components/story/StoryCutIn.tsx`. 승자 컷인(좌측·하단)과 겹치지 않게 우측·상단에서 들어온다.
 */
import type { Expression } from '@/lib/assets/character-art';
import { getCharacterById } from '@/lib/characters';
import { drillMomentLine } from './drill-moments';
import { primaryObjectivesMet } from './objectives';
import { teacherArtId, teacherDisplayName } from './story-hub-rules';
import type { Step, StoryHeroineId, StoryTeacherRef } from './types';
import type { StoryLiveView } from './views';

export type StoryCutInKicker = 'PERFECT' | 'MISSION CLEAR' | 'BOSS DEFEATED';

export interface StoryCutInData {
  /** AnimatePresence 키 */
  id: string;
  artId: string;
  expression: Expression;
  name: string;
  color: string;
  kicker: string;
  quote: string;
}

interface ResolvedTeacher { id: string; artId: string; name: string; color: string }

function resolveTeacher(teacher: StoryTeacherRef, partnerId: StoryHeroineId | null): ResolvedTeacher {
  const id = teacher === 'partner' ? (partnerId ?? 'miyako') : teacher;
  const artId = teacherArtId(id);
  const profile = getCharacterById(artId);
  return { id, artId, name: teacherDisplayName(id, lookup => getCharacterById(lookup)?.name), color: profile?.color ?? '#ffd76a' };
}

const MISSION_CLEAR_LINE: Readonly<Record<string, string>> = Object.freeze({
  miyako: '목표를 다 채우셨어요♪ 오늘 수련은 여기까지랍니다.',
  sakura: '다, 다 했어요…! 저, 저도 기뻐요.',
  hana: '목표 달성. 결과가 아니라 과정이 맞았어요.',
  ara: '오, 제법인데? …칭찬 아니거든.',
  chloe: '미션 클리어! 채팅창 난리 났어요!',
  vivian: '브라보. 오늘 무대는 여기까지예요.',
  elena: '기준을 채웠네요. 좋아요.',
});

const BOSS_DEFEATED_LINE: Readonly<Record<string, string>> = Object.freeze({
  hana: '값이 맞을 때만 받았죠. 통계는 거짓말을 안 해요.',
  miyako: '보스의 습관을 계산으로 뚫으셨어요♪',
  sakura: '이, 이겼어요…! 기다린 보람이 있었어요.',
});

/** 드릴 세트 퍼펙트(첫 시도 무오답·힌트 0) — 교사 한마디는 drill-moments의 퍼펙트 대사 */
export function drillPerfectCutIn(teacher: StoryTeacherRef, partnerId: StoryHeroineId | null, seed = 0): StoryCutInData {
  const who = resolveTeacher(teacher, partnerId);
  return {
    id: `perfect:${seed}`,
    artId: who.artId,
    expression: 'surprised',
    name: who.name,
    color: who.color,
    kicker: 'PERFECT',
    quote: drillMomentLine(who.id as Parameters<typeof drillMomentLine>[0], 'drill-perfect', seed),
  };
}

export interface LiveMissionInput {
  step: Step | null | undefined;
  live: StoryLiveView | null | undefined;
  teacher: StoryTeacherRef;
  partnerId: StoryHeroineId | null;
  stepKey: string;
}

/**
 * 스파링 미션 클리어 — `minHands` 이후 primary 전부 달성(판정 불가 없음)이면 컷인. 라인업에 boss가 있으면 BOSS DEFEATED.
 * 서버는 마지막 핸드 뒤 6초 방을 유지하고 tally를 밀어주므로 클라가 조기 종료 직전 상태를 볼 수 있다.
 * '연습' 스텝·목표 미달·판정 불가 → null.
 * 단 **보스 스텝이 `maxHands`까지 다 돌았으면 결산과 같은 최종 계약**(`primaryObjectivesMet` — 판정 불가는 제외)을 쓴다.
 * 조기 종료 계약(판정 불가도 미달 취급)을 최종에도 적용하면 통과한 보스전에서 격파 컷인이 조용히 사라진다.
 */
export function liveMissionCutIn({ step, live, teacher, partnerId, stepKey }: LiveMissionInput): StoryCutInData | null {
  if (!step || step.kind !== 'sparring' || !live) return null;
  const threshold = live.minHands ?? live.maxHands;
  if (live.handsPlayed < threshold) return null;
  const primaries = live.objectives.filter(objective => objective.primary);
  if (primaries.length === 0) return null;
  const boss = step.table.lineup.find(seat => seat.role === 'boss');
  const settled = boss !== undefined && live.handsPlayed >= live.maxHands;
  const passed = settled
    ? primaryObjectivesMet(primaries) === true
    : primaries.every(objective => objective.achieved === true);
  if (!passed) return null;
  const who = resolveTeacher(teacher, partnerId);
  if (boss) {
    const bossName = getCharacterById(boss.characterId)?.name ?? boss.characterId;
    return {
      id: `boss:${stepKey}`,
      artId: who.artId,
      expression: 'confident',
      name: who.name,
      color: who.color,
      kicker: `BOSS DEFEATED · ${bossName}`,
      quote: BOSS_DEFEATED_LINE[who.id] ?? `${bossName}의 습관을 계산으로 뚫었어요.`,
    };
  }
  return {
    id: `mission:${stepKey}`,
    artId: who.artId,
    expression: 'happy',
    name: who.name,
    color: who.color,
    kicker: 'MISSION CLEAR',
    quote: MISSION_CLEAR_LINE[who.id] ?? MISSION_CLEAR_LINE.miyako,
  };
}
