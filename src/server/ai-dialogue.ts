import Anthropic from '@anthropic-ai/sdk';
import { getCharacterById } from '../lib/characters';
import { BOT_PERSONALITIES } from '../lib/bot/personalities';

/**
 * AI 상황 대사 생성기 — 캐릭터 페르소나 기반으로 게임 상황에 맞는 한 마디를 생성한다.
 *
 * 비용 설계 (사용 제한이 1차 방어선, 실패 시 항상 기존 스크립트 대사로 폴백):
 * - 키 없으면 완전 비활성 (ANTHROPIC_API_KEY)
 * - 저가 모델 기본 (claude-haiku-4-5: $1/$5 per MTok) — 호출당 입력 ~400tok + 출력 ~50tok ≈ $0.0007
 * - 일일 호출 상한 (AI_DIALOGUE_DAILY_MAX, 기본 200회 ≈ 하루 최대 $0.15)
 * - 방별 쿨다운 (AI_DIALOGUE_COOLDOWN_MS, 기본 20초) — 핸드마다 떠들지 않게
 * - 확률 게이팅 (AI_DIALOGUE_CHANCE, 기본 0.6) — 나머지는 스크립트 대사
 * - max_tokens 80 + 6초 타임아웃 + 재시도 없음
 */

const MODEL = process.env.AI_DIALOGUE_MODEL || 'claude-haiku-4-5';
const DAILY_MAX = Number(process.env.AI_DIALOGUE_DAILY_MAX) || 200;
const COOLDOWN_MS = Number(process.env.AI_DIALOGUE_COOLDOWN_MS) || 20_000;
const CHANCE = process.env.AI_DIALOGUE_CHANCE !== undefined
  ? Math.min(1, Math.max(0, Number(process.env.AI_DIALOGUE_CHANCE)))
  : 0.6;
const REQUEST_TIMEOUT_MS = 6_000;
const MAX_RECENT_LINES = 5; // 캐릭터별 반복 방지 버퍼

export class AIDialogue {
  private client: Anthropic | null = null;
  private dailyCount = 0;
  private dailyDate = '';
  private lastCallByRoom = new Map<string, number>();
  private recentLines = new Map<string, string[]>();

  constructor() {
    if (process.env.ANTHROPIC_API_KEY) {
      this.client = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
        maxRetries: 0, // 대사는 실시간성이 중요 — 실패하면 즉시 스크립트 폴백
      });
      console.log(`[ai-dialogue] enabled — model=${MODEL} dailyMax=${DAILY_MAX} cooldown=${COOLDOWN_MS}ms chance=${CHANCE}`);
    } else {
      console.log('[ai-dialogue] disabled — ANTHROPIC_API_KEY 미설정, 스크립트 대사만 사용');
    }
  }

  get enabled(): boolean {
    return this.client !== null;
  }

  /** 게이팅 (키/일일 상한/쿨다운/확률) 통과 여부 — 통과 시 쿨다운/카운터를 선점한다 */
  private tryAcquire(roomId: string): boolean {
    if (!this.client) return false;

    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.dailyDate) {
      this.dailyDate = today;
      this.dailyCount = 0;
    }
    if (this.dailyCount >= DAILY_MAX) {
      if (this.dailyCount === DAILY_MAX) {
        this.dailyCount++; // 로그 1회만
        console.log(`[ai-dialogue] 일일 상한(${DAILY_MAX}회) 도달 — 오늘은 스크립트 대사로 폴백`);
      }
      return false;
    }

    const last = this.lastCallByRoom.get(roomId) ?? 0;
    if (Date.now() - last < COOLDOWN_MS) return false;

    if (Math.random() > CHANCE) return false;

    this.lastCallByRoom.set(roomId, Date.now());
    this.dailyCount++;
    return true;
  }

  /**
   * 상황 대사 생성. 게이팅 미통과/실패 시 null — 호출자는 스크립트 대사로 폴백할 것.
   * @param situation 게임 상황 요약 (한국어, 한두 문장)
   */
  async generateLine(roomId: string, characterId: string, situation: string): Promise<string | null> {
    if (!this.tryAcquire(roomId)) return null;

    const character = getCharacterById(characterId);
    const personality = BOT_PERSONALITIES[characterId];
    if (!character || !this.client) return null;

    const recent = this.recentLines.get(characterId) ?? [];
    const styleHints = [character.winQuote, character.bluffQuote, character.chatMessages[0]]
      .filter(Boolean).join(' / ');

    try {
      const response = await this.client.messages.create(
        {
          model: MODEL,
          max_tokens: 80,
          system:
            `너는 온라인 홀덤 게임의 NPC 캐릭터 "${character.name}"다.\n` +
            `성격: ${character.personality}${personality ? ` (플레이 스타일: ${personality.style})` : ''}\n` +
            `말투 예시: ${styleHints}\n` +
            `규칙: 지금 상황에 대한 대사 한 줄만 출력한다. 반드시 한국어, 1문장, 45자 이내. ` +
            `말투 예시의 어미/톤을 그대로 유지한다. 따옴표나 지문 없이 대사만. 이모지는 최대 1개.`,
          messages: [
            {
              role: 'user',
              content:
                `상황: ${situation}` +
                (recent.length > 0 ? `\n최근에 이미 한 말 (똑같이 반복 금지): ${recent.join(' | ')}` : ''),
            },
          ],
        },
        { timeout: REQUEST_TIMEOUT_MS },
      );

      const block = response.content.find(b => b.type === 'text');
      const line = block && block.type === 'text' ? block.text.trim().replace(/^["'「]|["'」]$/g, '') : '';
      if (!line || line.length > 80) return null;

      this.recentLines.set(characterId, [...recent, line].slice(-MAX_RECENT_LINES));
      return line;
    } catch (e) {
      console.warn(`[ai-dialogue] 생성 실패 (스크립트 폴백): ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }
}
