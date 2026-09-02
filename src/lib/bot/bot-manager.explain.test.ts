import { describe, it, expect } from 'vitest';
import { processBotTurn } from './bot-manager';
import { BOT_EXPLANATION_TEXTS, type BotExplanationCode } from './bot-explain';
import { setupTable } from '../poker/test-helpers';
import { PokerEngine } from '../poker/engine';

/**
 * processBotTurn의 `{ explain }` 옵션 계약 (Phase 1b.4).
 * 옵션 없이 호출하던 기존 경로는 explanation 키 자체가 없어야 한다 (동작 불변).
 */

/** 전원 봇 테이블 — 첫 액션 차례가 항상 봇 */
function botTable(): PokerEngine {
  const { engine } = setupTable([2000, 2000, 2000]);
  for (const p of engine.state.players) {
    p.type = 'bot';
    p.personalityId = 'hana';
  }
  engine.startHand();
  return engine;
}

describe('processBotTurn explain 옵션', () => {
  it('explain:true면 실제 결정과 짝이 맞는 속마음을 함께 준다', async () => {
    const engine = botTable();
    const actorId = engine.state.players[engine.state.activePlayerIndex].id;

    const result = await processBotTurn(engine, undefined, undefined, 0, { explain: true });

    expect(result.acted).toBe(true);
    expect(result.action).toBeDefined();
    expect(engine.state.lastAction?.playerId).toBe(actorId);
    expect(result.explanation).toBeDefined();
    const code = result.explanation!.code as BotExplanationCode;
    expect(BOT_EXPLANATION_TEXTS[code]).toBeDefined();
    expect(BOT_EXPLANATION_TEXTS[code]).toContain(result.explanation!.text);
  });

  it('옵션 없이 호출하면 explanation 키 자체가 없다 (기존 호출부 동작 불변)', async () => {
    const engine = botTable();
    const result = await processBotTurn(engine, undefined, undefined, 0);

    expect(result.acted).toBe(true);
    expect(result.action).toBeDefined();
    expect('explanation' in result).toBe(false);
  });

  it('결정이 거부돼 강제 체크/폴드로 진행되면 forced로 대체된다', async () => {
    const engine = botTable();
    const real = engine.processAction.bind(engine);
    let rejectedOnce = false;
    engine.processAction = (action) => {
      if (!rejectedOnce) {
        rejectedOnce = true;
        return { valid: false, handComplete: false };
      }
      return real(action);
    };

    const result = await processBotTurn(engine, undefined, undefined, 0, { explain: true });

    expect(rejectedOnce).toBe(true);
    expect(result.acted).toBe(true);
    expect(result.explanation?.code).toBe('forced');
    expect(BOT_EXPLANATION_TEXTS.forced).toContain(result.explanation!.text);
  });

  it('차례가 봇이 아니면 액션도 속마음도 없다', async () => {
    const engine = botTable();
    engine.state.players[engine.state.activePlayerIndex].type = 'human';

    const result = await processBotTurn(engine, undefined, undefined, 0, { explain: true });

    expect(result.acted).toBe(false);
    expect(result.explanation).toBeUndefined();
  });

  it('사고 지연 중 취소되면 속마음도 남기지 않는다', async () => {
    const engine = botTable();
    const result = await processBotTurn(engine, () => true, undefined, 0, { explain: true });

    expect(result.acted).toBe(false);
    expect('explanation' in result).toBe(false);
  });
});
