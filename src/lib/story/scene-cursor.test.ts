import { describe, expect, it } from 'vitest';
import {
  advanceScene,
  chooseSceneOption,
  collectSceneFlags,
  createSceneCursor,
  cursorView,
  effectiveBackground,
  sceneLog,
  sceneMatchesFlags,
  skipScene,
} from './scene-cursor';
import type { Scene } from './types';

const scene: Scene = {
  id: 'prologue',
  lines: [
    { kind: 'say', speaker: 'miyako', text: '어서 오세요, 수련생님♪' },
    { kind: 'say', speaker: 'partner', text: '…잘 부탁해요.' },
    {
      kind: 'choice',
      choice: {
        id: 'greet',
        options: [
          { id: 'warm', text: '잘 부탁해요!', setFlags: { 'choice:act1-ch01:greet': 'warm' }, reply: [{ kind: 'say', speaker: 'partner', text: '네, 네!' }, { kind: 'say', speaker: 'miyako', text: '후후♪' }] },
          { id: 'cool', text: '…네.', setFlags: { 'choice:act1-ch01:greet': 'cool' } },
        ],
      },
    },
    { kind: 'say', speaker: 'miyako', text: '그럼 시작할까요?' },
  ],
};

describe('scene cursor', () => {
  it('walks say lines and stops at a choice until an option is chosen', () => {
    let cursor = createSceneCursor(scene);
    expect(cursorView(scene, cursor)).toMatchObject({ kind: 'say', line: { text: '어서 오세요, 수련생님♪' } });
    cursor = advanceScene(scene, cursor);
    expect(cursorView(scene, cursor)).toMatchObject({ kind: 'say', line: { speaker: 'partner' } });
    cursor = advanceScene(scene, cursor);
    expect(cursorView(scene, cursor)).toMatchObject({ kind: 'choice', choice: { id: 'greet' } });
    // 선택 전엔 전진 불가
    expect(advanceScene(scene, cursor)).toBe(cursor);
    expect(chooseSceneOption(scene, cursor, 'nope')).toBe(cursor);

    cursor = chooseSceneOption(scene, cursor, 'warm');
    expect(cursorView(scene, cursor)).toMatchObject({ kind: 'say', isReply: true, line: { text: '네, 네!' } });
    cursor = advanceScene(scene, cursor);
    expect(cursorView(scene, cursor)).toMatchObject({ kind: 'say', isReply: true, line: { text: '후후♪' } });
    cursor = advanceScene(scene, cursor);
    expect(cursorView(scene, cursor)).toMatchObject({ kind: 'say', isReply: false, line: { text: '그럼 시작할까요?' } });
    cursor = advanceScene(scene, cursor);
    expect(cursorView(scene, cursor)).toEqual({ kind: 'done' });
    expect(cursor.done).toBe(true);
    expect(collectSceneFlags(scene, cursor)).toEqual({ 'choice:act1-ch01:greet': 'warm' });
  });

  it('options without replies move straight to the next line', () => {
    let cursor = createSceneCursor(scene);
    cursor = advanceScene(scene, advanceScene(scene, cursor));
    cursor = chooseSceneOption(scene, cursor, 'cool');
    expect(cursorView(scene, cursor)).toMatchObject({ kind: 'say', line: { text: '그럼 시작할까요?' } });
    expect(collectSceneFlags(scene, cursor)).toEqual({ 'choice:act1-ch01:greet': 'cool' });
  });

  it('skip jumps to the pending choice, then to the end', () => {
    let cursor = skipScene(scene, createSceneCursor(scene));
    expect(cursorView(scene, cursor)).toMatchObject({ kind: 'choice' });
    cursor = chooseSceneOption(scene, cursor, 'warm');
    cursor = skipScene(scene, cursor);
    expect(cursorView(scene, cursor)).toEqual({ kind: 'done' });
    expect(collectSceneFlags(scene, cursor)).toEqual({ 'choice:act1-ch01:greet': 'warm' });
  });

  it('log lists what has been shown, replies included', () => {
    let cursor = createSceneCursor(scene);
    expect(sceneLog(scene, cursor).map(l => l.text)).toEqual(['어서 오세요, 수련생님♪']);
    cursor = advanceScene(scene, advanceScene(scene, cursor));
    cursor = chooseSceneOption(scene, cursor, 'warm');
    expect(sceneLog(scene, cursor).map(l => l.text)).toEqual(['어서 오세요, 수련생님♪', '…잘 부탁해요.', '네, 네!']);
    cursor = skipScene(scene, cursor);
    expect(sceneLog(scene, cursor).map(l => l.text)).toEqual(['어서 오세요, 수련생님♪', '…잘 부탁해요.', '네, 네!', '후후♪', '그럼 시작할까요?']);
  });

  it('effectiveBackground keeps the last bg across lines without one (replies included)', () => {
    const scene: Scene = {
      id: 'bg',
      lines: [
        { kind: 'say', speaker: 'miyako', text: 'a', bg: 'dojo-gate' },
        { kind: 'say', speaker: 'miyako', text: 'b' },
        { kind: 'choice', choice: { id: 'q', options: [{ id: 'x', text: 'x', reply: [{ kind: 'say', speaker: 'miyako', text: 'r', bg: 'dojo-study' }] }, { id: 'y', text: 'y' }] } },
        { kind: 'say', speaker: 'miyako', text: 'c' },
      ],
    };
    let cursor = createSceneCursor(scene);
    expect(effectiveBackground(scene, cursor)).toBe('dojo-gate');
    cursor = advanceScene(scene, cursor);
    expect(effectiveBackground(scene, cursor)).toBe('dojo-gate');
    cursor = advanceScene(scene, cursor);
    cursor = chooseSceneOption(scene, cursor, 'x');
    expect(effectiveBackground(scene, cursor)).toBe('dojo-study');
    cursor = advanceScene(scene, cursor);
    expect(effectiveBackground(scene, cursor)).toBe('dojo-study');
    expect(effectiveBackground({ id: 'none', lines: [{ kind: 'say', speaker: 'miyako', text: 'a' }] }, createSceneCursor(scene))).toBeNull();
  });

  it('empty scenes are done immediately and requiresFlags gate variants', () => {
    const empty: Scene = { id: 'e', lines: [] };
    expect(createSceneCursor(empty).done).toBe(true);
    expect(cursorView(empty, createSceneCursor(empty))).toEqual({ kind: 'done' });
    const variant: Scene = { id: 'v', lines: [], requiresFlags: { 'choice:act1-ch01:greet': 'warm' } };
    expect(sceneMatchesFlags(variant, { 'choice:act1-ch01:greet': 'warm' })).toBe(true);
    expect(sceneMatchesFlags(variant, { 'choice:act1-ch01:greet': 'cool' })).toBe(false);
    expect(sceneMatchesFlags(scene, {})).toBe(true);
  });
});
