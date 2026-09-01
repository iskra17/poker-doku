/**
 * VN 씬 커서 — 순수 상태 머신. ScenePlayer는 이 커서를 렌더만 한다.
 * - say 라인은 [다음]으로 전진, choice 라인은 옵션 선택으로만 전진(옵션 reply 라인을 먼저 재생).
 * - 스킵은 남은 라인을 전부 건너뛰되, 아직 답하지 않은 선택지가 남아 있으면 그 선택지에서 멈춘다
 *   (플래그가 되는 선택은 건너뛸 수 없다 — 대신 어느 옵션이든 정답이 없으므로 부담 없음).
 */
import type { Scene, SceneChoice, SceneSayLine } from './types';

export interface SceneCursor {
  lineIndex: number;
  /** 선택 후 재생 중인 reply 라인 인덱스 (null이면 본문) */
  replyIndex: number | null;
  chosen: Record<string, string>;
  done: boolean;
}

export type CursorView =
  | { kind: 'say'; line: SceneSayLine; isReply: boolean }
  | { kind: 'choice'; choice: SceneChoice }
  | { kind: 'done' };

export function createSceneCursor(scene: Scene): SceneCursor {
  return { lineIndex: 0, replyIndex: null, chosen: {}, done: scene.lines.length === 0 };
}

export function cursorView(scene: Scene, cursor: SceneCursor): CursorView {
  if (cursor.done) return { kind: 'done' };
  const line = scene.lines[cursor.lineIndex];
  if (!line) return { kind: 'done' };
  if (line.kind === 'say') return { kind: 'say', line, isReply: false };
  const chosenId = cursor.chosen[line.choice.id];
  if (chosenId === undefined) return { kind: 'choice', choice: line.choice };
  const option = line.choice.options.find(candidate => candidate.id === chosenId);
  const reply = option?.reply ?? [];
  if (cursor.replyIndex !== null && cursor.replyIndex < reply.length) {
    return { kind: 'say', line: reply[cursor.replyIndex], isReply: true };
  }
  return { kind: 'done' };
}

/** 다음 라인으로 — 선택지 미응답이면 그대로 (선택이 필요) */
export function advanceScene(scene: Scene, cursor: SceneCursor): SceneCursor {
  const view = cursorView(scene, cursor);
  if (view.kind === 'done' || view.kind === 'choice') return cursor;
  const line = scene.lines[cursor.lineIndex];
  if (line.kind === 'choice' && cursor.replyIndex !== null) {
    const option = line.choice.options.find(candidate => candidate.id === cursor.chosen[line.choice.id]);
    const reply = option?.reply ?? [];
    if (cursor.replyIndex + 1 < reply.length) return { ...cursor, replyIndex: cursor.replyIndex + 1 };
  }
  return moveToLine(scene, cursor, cursor.lineIndex + 1);
}

export function chooseSceneOption(scene: Scene, cursor: SceneCursor, optionId: string): SceneCursor {
  const view = cursorView(scene, cursor);
  if (view.kind !== 'choice') return cursor;
  const option = view.choice.options.find(candidate => candidate.id === optionId);
  if (!option) return cursor;
  const chosen = { ...cursor.chosen, [view.choice.id]: optionId };
  if (option.reply && option.reply.length > 0) return { ...cursor, chosen, replyIndex: 0 };
  return moveToLine(scene, { ...cursor, chosen }, cursor.lineIndex + 1);
}

/** 남은 대사를 건너뛴다 — 미응답 선택지가 있으면 거기서 멈춘다 */
export function skipScene(scene: Scene, cursor: SceneCursor): SceneCursor {
  let current = cursor;
  for (let guard = 0; guard < scene.lines.length + 64; guard++) {
    const view = cursorView(scene, current);
    if (view.kind === 'done' || view.kind === 'choice') return current;
    current = advanceScene(scene, current);
  }
  return { ...current, done: true };
}

/** 선택지에서 고른 플래그를 모아 준다 (setFlags 합집합) */
export function collectSceneFlags(scene: Scene, cursor: SceneCursor): Record<string, string> {
  const flags: Record<string, string> = {};
  for (const line of scene.lines) {
    if (line.kind !== 'choice') continue;
    const chosenId = cursor.chosen[line.choice.id];
    const option = line.choice.options.find(candidate => candidate.id === chosenId);
    Object.assign(flags, option?.setFlags ?? {});
  }
  return flags;
}

/** 지금까지 본 대사 로그 (say 라인 순서대로, reply 포함) */
export function sceneLog(scene: Scene, cursor: SceneCursor): SceneSayLine[] {
  const log: SceneSayLine[] = [];
  for (let index = 0; index <= Math.min(cursor.lineIndex, scene.lines.length - 1); index++) {
    const line = scene.lines[index];
    if (!line) break;
    if (line.kind === 'say') {
      if (index < cursor.lineIndex || cursor.done) log.push(line);
      else log.push(line); // 현재 라인도 로그에 포함
      continue;
    }
    const chosenId = cursor.chosen[line.choice.id];
    if (chosenId === undefined) break;
    const option = line.choice.options.find(candidate => candidate.id === chosenId);
    const reply = option?.reply ?? [];
    const upto = index < cursor.lineIndex || cursor.done ? reply.length : (cursor.replyIndex ?? -1) + 1;
    log.push(...reply.slice(0, Math.max(0, upto)));
  }
  return log;
}

function moveToLine(scene: Scene, cursor: SceneCursor, lineIndex: number): SceneCursor {
  if (lineIndex >= scene.lines.length) return { ...cursor, lineIndex: scene.lines.length, replyIndex: null, done: true };
  return { ...cursor, lineIndex, replyIndex: null };
}

/** 씬의 requiresFlags가 현재 플래그와 전부 일치하는지 */
export function sceneMatchesFlags(scene: Scene, flags: Readonly<Record<string, string>>): boolean {
  return Object.entries(scene.requiresFlags ?? {}).every(([key, value]) => flags[key] === value);
}
