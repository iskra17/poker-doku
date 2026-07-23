import { getCharacterById } from '../lib/characters';
import { BOT_PERSONALITIES } from '../lib/bot/personalities';
import { cfg } from './game-config/live';

/**
 * AI 상황 대사 생성기 — 캐릭터 페르소나 기반으로 게임 상황에 맞는 한 마디를 생성한다.
 * 호출 패턴은 fight club korea(src/lib/bot-activity.ts)와 동일: Gemini 2.5 Flash-Lite를
 * SDK 없이 raw fetch(v1beta generateContent + x-goog-api-key)로 호출한다.
 * 나중에 유저↔캐릭터 상호작용(대화)으로 확장할 때도 이 모듈의 generateLine을 재사용한다.
 *
 * 비용 설계 (사용 제한이 1차 방어선, 실패 시 항상 기존 스크립트 대사로 폴백):
 * - 키 없으면 완전 비활성 (GEMINI_API_KEY)
 * - 저가 모델 기본 (gemini-2.5-flash-lite: $0.10/$0.40 per MTok, 무료 티어 있음)
 *   — 호출당 입력 ~400tok + 출력 ~50tok, 일일 상한 200회 기준 월 최대 ~$0.4
 * - 일일 호출 상한 (AI_DIALOGUE_DAILY_MAX, 기본 200회)
 * - 방별 쿨다운 (AI_DIALOGUE_COOLDOWN_MS, 기본 20초) — 핸드마다 떠들지 않게
 * - 확률 게이팅 (AI_DIALOGUE_CHANCE, 기본 0.6) — 나머지는 스크립트 대사
 * - maxOutputTokens 80 + 6초 타임아웃 + 재시도 없음 (대사는 실시간성이 중요)
 * - 무료 티어 일일 쿼터 소진(429 PerDay) 감지 시 오늘은 호출 중단
 */

const MODEL = process.env.AI_DIALOGUE_MODEL || 'gemini-2.5-flash-lite';
// 일일 상한/쿨다운/확률은 핫 컨피그 — env(AI_DIALOGUE_*)는 game-config 부팅 기본값으로 흡수되고
// (registry.resolveEnvConfigDefaults), DB 오버라이드가 있으면 그것이 이긴다. 매 게이팅마다 읽는다.
const dailyMax = () => cfg('ops.aiDialogueDailyMax');
const cooldownMs = () => cfg('ops.aiDialogueCooldownMs');
const chance = () => cfg('ops.aiDialogueChanceBps') / 10_000;
const REQUEST_TIMEOUT_MS = 6_000;
const MAX_RECENT_LINES = 5; // 캐릭터별 반복 방지 버퍼

type GeminiResponse = { candidates?: { content?: { parts?: { text?: string }[] } }[] };

export class AIDialogue {
  private apiKey: string | null = null;
  private dailyCount = 0;
  private dailyDate = '';
  private lastCallByRoom = new Map<string, number>();
  private recentLines = new Map<string, string[]>();

  constructor() {
    this.apiKey = process.env.GEMINI_API_KEY || null;
    if (this.apiKey) {
      console.log(`[ai-dialogue] enabled — model=${MODEL} dailyMax=${dailyMax()} cooldown=${cooldownMs()}ms chance=${chance()}`);
    } else {
      console.log('[ai-dialogue] disabled — GEMINI_API_KEY 미설정, 스크립트 대사만 사용');
    }
  }

  get enabled(): boolean {
    return this.apiKey !== null;
  }

  get scopeCount(): number {
    return this.lastCallByRoom.size;
  }

  disposeScope(roomId: string): void {
    this.lastCallByRoom.delete(roomId);
  }

  shutdown(): void {
    this.lastCallByRoom.clear();
    this.recentLines.clear();
  }

  /** 외부(캐시 재사용 등)에서 소비한 대사를 반복 방지 버퍼에 반영 */
  noteLine(characterId: string, line: string): void {
    const recent = this.recentLines.get(characterId) ?? [];
    this.recentLines.set(characterId, [...recent, line].slice(-MAX_RECENT_LINES));
  }

  /** 게이팅 (키/일일 상한/쿨다운/확률) 통과 여부 — 통과 시 쿨다운/카운터를 선점한다 */
  private tryAcquire(roomId: string): boolean {
    if (!this.apiKey) return false;

    const today = new Date().toISOString().slice(0, 10);
    if (today !== this.dailyDate) {
      this.dailyDate = today;
      this.dailyCount = 0;
    }
    const max = dailyMax();
    if (this.dailyCount >= max) {
      if (this.dailyCount === max) {
        this.dailyCount++; // 로그 1회만
        console.log(`[ai-dialogue] 일일 상한(${max}회) 도달 — 오늘은 스크립트 대사로 폴백`);
      }
      return false;
    }

    const last = this.lastCallByRoom.get(roomId) ?? 0;
    if (Date.now() - last < cooldownMs()) return false;

    if (Math.random() > chance()) return false;

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
    if (!character || !this.apiKey) return null;

    const recent = this.recentLines.get(characterId) ?? [];
    const styleHints = [character.winQuote, character.bluffQuote, character.chatMessages[0]]
      .filter(Boolean).join(' / ');

    const prompt =
      `너는 온라인 홀덤 게임의 NPC 캐릭터 "${character.name}"다.\n` +
      `성격: ${character.personality}${personality ? ` (플레이 스타일: ${personality.style})` : ''}\n` +
      `말투 예시: ${styleHints}\n` +
      `규칙: 지금 상황에 대한 대사 한 줄만 출력한다. 반드시 한국어, 1문장, 45자 이내. ` +
      `말투 예시의 어미/톤을 그대로 유지한다. 따옴표나 지문 없이 대사만. 이모지는 최대 1개.\n\n` +
      `상황: ${situation}` +
      (recent.length > 0 ? `\n최근에 이미 한 말 (똑같이 반복 금지): ${recent.join(' | ')}` : '');

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: {
              temperature: 0.9,
              maxOutputTokens: 80,
              // 사고 토큰이 출력 예산(80)을 잠식하지 않게 명시적으로 비활성 —
              // flash-lite는 기본 off지만, env로 flash 계열로 바꿔도 안전하도록 고정
              thinkingConfig: { thinkingBudget: 0 },
            },
          }),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        },
      );

      if (!res.ok) {
        const errBody = await res.text();
        // 무료 티어 일일 쿼터 소진 — 재시도 무의미, 오늘은 호출을 멈춘다 (fight club korea 패턴)
        if (res.status === 429 && /PerDay/i.test(errBody)) {
          this.dailyCount = Math.max(this.dailyCount, dailyMax());
          console.warn('[ai-dialogue] Gemini 일일 쿼터 소진 — 오늘은 스크립트 대사로 폴백');
          return null;
        }
        throw new Error(`Gemini API ${res.status}: ${errBody.slice(0, 200)}`);
      }

      const data = (await res.json()) as GeminiResponse;
      const text = (data.candidates?.[0]?.content?.parts ?? [])
        .map(p => p.text)
        .filter(Boolean)
        .join('');
      const line = text.trim().replace(/^["'「]|["'」]$/g, '');
      if (!line || line.length > 80) return null;

      this.noteLine(characterId, line);
      return line;
    } catch (e) {
      console.warn(`[ai-dialogue] 생성 실패 (스크립트 폴백): ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }
}
