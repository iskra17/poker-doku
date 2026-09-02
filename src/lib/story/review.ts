/**
 * 핸드 후 결정 리뷰 v1 — 순수 모듈(서버가 만들고 `StoryLiveView.lastReview`로 내려보낸다).
 *
 * 원칙(기획 A7 ③):
 * - **결과 무관(P4 "결과 ≠ 결정")**: 배드빗으로 진 핸드도 👍, 럭키 아웃으로 이긴 핸드도 ⚠가 될 수 있다.
 *   판정은 오직 "그 시점에 알 수 있던 정보"(내 카드·보드·공개 액션·가격)만 본다.
 * - 확실한 규칙이 있는 자리만 말한다 — 체크나 근거 없는 벳은 **판정을 만들어 내지 않고 생략**한다.
 * - 마크가 많으면 ⚠ > 🤔 > 👍 순으로 남기고 나머지는 잘라낸다(핸드당 결정적인 것부터).
 * - 이유 문장은 중립 시스템체 한국어. 히로인 말투 랩핑은 대사 계층(dialogue-manager)의 몫이다.
 *
 * 상대 스타일 규칙(Ch7+ 클로이·초코 등)과 라이브 리딩 퀴즈는 v1 범위 밖 — 여기선
 * 프리플랍 참여/폴드와 벳 대면 가격 결정(콜·폴드)만 다룬다.
 */
import type { CompletedHandRecord } from '@/lib/poker/hand-history';
import {
  PREMIUM_PERCENTILE,
  deriveHeroHandFacts,
  type HeroHandFacts,
  type PricedDecisionFact,
} from './objectives';
import type { DecisionMark, DecisionReview, DecisionVerdict } from './views';

/** 기본 최대 판정 수 — 결산 카드가 한 화면에 담을 수 있는 분량. */
export const DEFAULT_MAX_VERDICTS = 4;

/** 잘라낼 때의 우선순위 — 고칠 게 있는 것부터 남긴다. */
const MARK_PRIORITY: Readonly<Record<DecisionMark, number>> = { warn: 0, hmm: 1, good: 2 };

function pct(value: number): number {
  return Math.round(value * 100);
}

function pricedReason(fact: PricedDecisionFact, kind: 'call' | 'fold'): string {
  const price = `콜 값 ${pct(fact.potOdds)}%, 추정 승률 ${pct(fact.equity)}%`;
  const outs = fact.outs !== null && fact.outs > 0 ? ` (아우츠 ${fact.outs}장)` : '';
  if (kind === 'call') {
    if (fact.mark === 'good') return `${price}${outs}. 가격이 맞는 콜이에요.`;
    if (fact.mark === 'hmm') return `${price}${outs}. 가격이 아슬아슬한 콜이에요.`;
    return `${price}${outs}. 오즈가 맞지 않는 콜이에요.`;
  }
  if (fact.mark === 'good') return `${price}${outs}. 가격이 맞지 않으니 폴드가 정답이에요.`;
  if (fact.mark === 'hmm') return `${price}${outs}. 가격이 살짝 맞는 자리라 콜도 가능했어요.`;
  return `${price}${outs}. 오즈가 충분한 자리에서 폴드했어요.`;
}

interface Entry {
  order: number;
  verdict: DecisionVerdict;
}

function preflopEntry(facts: HeroHandFacts): Entry | null {
  const decision = facts.preflopDecision;
  const percentile = facts.heroHandPercentile;
  if (!decision || percentile === null) return null;

  const premium = percentile <= PREMIUM_PERCENTILE;
  const base = { street: 'preflop' as const, action: decision.action, facts: {} };

  if (decision.action === 'fold') {
    if (facts.junk) {
      return {
        order: decision.actionIndex,
        verdict: { ...base, amount: 0, mark: 'good', reason: '하위 레인지 핸드는 폴드가 정답이에요. 다음 기회를 기다려요.' },
      };
    }
    if (premium) {
      return {
        order: decision.actionIndex,
        verdict: {
          ...base,
          amount: 0,
          mark: 'warn',
          reason: `상위 ${pct(PREMIUM_PERCENTILE)}%에 드는 핸드였어요. 압박이 없다면 폴드하기엔 아까운 자리예요.`,
        },
      };
    }
    // 중간 구간 폴드는 포지션·상황에 따라 모두 정당해서 판정을 만들지 않는다.
    return null;
  }

  if (facts.junk) {
    return {
      order: decision.actionIndex,
      verdict: {
        ...base,
        amount: decision.amount,
        mark: 'warn',
        reason: '하위 레인지로 들어가면 플랍 이후가 계속 어려워져요.',
      },
    };
  }
  if (premium) {
    return {
      order: decision.actionIndex,
      verdict: {
        ...base,
        amount: decision.amount,
        mark: 'good',
        reason: `상위 ${pct(PREMIUM_PERCENTILE)}% 핸드로 주도권을 잡았어요.`,
      },
    };
  }
  return {
    order: decision.actionIndex,
    verdict: {
      ...base,
      amount: decision.amount,
      mark: 'hmm',
      reason: '경계 구간 핸드예요. 포지션이 나쁘면 폴드해도 좋아요.',
    },
  };
}

/**
 * 핸드 하나의 결정 리뷰.
 * 히어로가 딜인되지 않았거나 자발적 액션이 하나도 없었으면(블라인드만 내고 끝난 핸드) null.
 * 판정할 자리가 없으면 `verdicts: []`인 리뷰를 돌려준다 — "리뷰할 게 없었다"와 "그 핸드에 없었다"는 다르다.
 */
export function reviewHand(
  record: CompletedHandRecord,
  heroId: string,
  opts?: { maxVerdicts?: number },
): DecisionReview | null {
  const facts = deriveHeroHandFacts(record, heroId);
  if (!facts.dealtIn || facts.voluntaryActions === 0) return null;

  const entries: Entry[] = [];
  const preflop = preflopEntry(facts);
  if (preflop) entries.push(preflop);

  for (const fact of facts.potOddsCalls) {
    entries.push({
      order: fact.actionIndex,
      verdict: {
        street: fact.street,
        action: 'call',
        amount: fact.toCall,
        mark: fact.mark,
        reason: pricedReason(fact, 'call'),
        facts: { potOdds: fact.potOdds, equity: fact.equity, ...(fact.outs !== null ? { outs: fact.outs } : {}) },
      },
    });
  }
  for (const fact of facts.potOddsFolds) {
    entries.push({
      order: fact.actionIndex,
      verdict: {
        street: fact.street,
        action: 'fold',
        amount: 0,
        mark: fact.mark,
        reason: pricedReason(fact, 'fold'),
        facts: { potOdds: fact.potOdds, equity: fact.equity, ...(fact.outs !== null ? { outs: fact.outs } : {}) },
      },
    });
  }

  const max = Math.max(0, opts?.maxVerdicts ?? DEFAULT_MAX_VERDICTS);
  let kept = entries;
  if (entries.length > max) {
    kept = [...entries]
      .sort((a, b) => {
        const priority = MARK_PRIORITY[a.verdict.mark] - MARK_PRIORITY[b.verdict.mark];
        return priority !== 0 ? priority : a.order - b.order;
      })
      .slice(0, max);
  }
  kept.sort((a, b) => a.order - b.order);

  return { handNumber: facts.handNumber, verdicts: kept.map(entry => entry.verdict) };
}
