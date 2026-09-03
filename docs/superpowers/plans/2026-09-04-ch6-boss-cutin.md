# CH6 Boss Cut-In Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** CH6 보스전이 `maxHands`에서 통과하면 기회가 없었던 primary 목표가 있어도 결산 전에 `BOSS DEFEATED` 컷인을 한 번 표시한다.

**Architecture:** 미션형 조기 종료의 엄격한 `primaryObjectivesAllAchieved` 계약은 유지한다. 클라이언트의 순수 컷인 판정 함수만 확장해, 보스전이 `maxHands`에 도달한 경우 결산과 동일한 `primaryObjectivesMet` 규칙으로 최종 통과를 인정한다.

**Tech Stack:** TypeScript, Vitest, Next.js 클라이언트 순수 유틸리티

---

### Task 1: 보스전 최종 통과 컷인

**Files:**
- Modify: `src/lib/story/story-cut-ins.test.ts`
- Modify: `src/lib/story/story-cut-ins.ts`

- [ ] **Step 1: 최종 보스 통과와 조기 컷인을 구분하는 회귀 테스트 작성**

`src/lib/story/story-cut-ins.test.ts`의 `describe('liveMissionCutIn', ...)` 안에 다음 테스트를 추가한다.

```ts
it('보스전은 maxHands 최종 통과에서 null 목표를 제외하지만 조기 컷인은 전부 달성해야 한다', () => {
  const step = sparringOf(CH03);
  const mixedObjectives = [
    objective('made', true, true),
    objective('no-opportunity', true, null),
  ];

  const beforeLimit = liveMissionCutIn({
    ...base,
    step,
    live: live({
      minHands: 8,
      maxHands: 12,
      handsPlayed: 11,
      objectives: mixedObjectives,
    }),
  });
  expect(beforeLimit).toBeNull();

  const atLimit = liveMissionCutIn({
    ...base,
    step,
    live: live({
      minHands: 8,
      maxHands: 12,
      handsPlayed: 12,
      objectives: mixedObjectives,
    }),
  });
  expect(atLimit?.kicker).toMatch(/^BOSS DEFEATED · /);

  const failedAtLimit = liveMissionCutIn({
    ...base,
    step,
    live: live({
      minHands: 8,
      maxHands: 12,
      handsPlayed: 12,
      objectives: [
        objective('failed', true, false),
        objective('no-opportunity', true, null),
      ],
    }),
  });
  expect(failedAtLimit).toBeNull();
});
```

- [ ] **Step 2: 회귀 테스트가 현재 구현에서 실패하는지 확인**

Run:

```powershell
npx vitest run src/lib/story/story-cut-ins.test.ts
```

Expected: 새 테스트의 `atLimit?.kicker` assertion이 실패한다. 현재 구현은 `achieved: null`이 포함된 모든 상태에서 `null`을 반환한다.

- [ ] **Step 3: 보스전 최종 통과 판정을 결산 계약과 일치시키기**

`src/lib/story/story-cut-ins.ts`에 결산에서 사용하는 순수 판정 함수를 import한다.

```ts
import { primaryObjectivesMet } from './objectives';
```

`liveMissionCutIn`의 primary 판정과 보스 탐색 부분을 다음 코드로 교체한다.

```ts
const primaries = live.objectives.filter(objective => objective.primary);
const boss = step.table.lineup.find(seat => seat.role === 'boss');
const allPrimariesAchieved = primaries.length > 0
  && primaries.every(objective => objective.achieved === true);
const finalBossPass = !!boss
  && live.handsPlayed >= live.maxHands
  && primaryObjectivesMet(primaries) === true;
if (!allPrimariesAchieved && !finalBossPass) return null;
const who = resolveTeacher(teacher, partnerId);
```

기존의 아래 중복 보스 탐색 줄은 삭제한다.

```ts
const boss = step.table.lineup.find(seat => seat.role === 'boss');
```

함수 JSDoc을 실제 계약에 맞게 다음처럼 갱신한다.

```ts
/**
 * 스파링 미션 클리어 — `minHands` 이후 primary를 전부 달성하면 즉시 컷인한다.
 * 보스전은 `maxHands` 최종 통과에서도 결산과 같은 규칙으로 판정 불가 목표를 제외하고 BOSS DEFEATED를 표시한다.
 * 일반 스파링의 미달·판정 불가, 보스전의 판정 가능한 실패, 전부 판정 불가 → null.
 */
```

- [ ] **Step 4: 관련 단일 테스트 파일만 재실행**

Run:

```powershell
npx vitest run src/lib/story/story-cut-ins.test.ts
```

Expected: `1` test file과 `5` tests가 모두 통과한다.

전체 Vitest, 전체 빌드, 브라우저 자동화는 실행하지 않는다. 이번 변경은 순수 함수 한 곳과 해당 단위 테스트만 수정하며 타입·서버 I/O·UI 구조·에셋 계약을 바꾸지 않는다.

- [ ] **Step 5: 구현 배치 커밋**

```powershell
git add src/lib/story/story-cut-ins.ts src/lib/story/story-cut-ins.test.ts
git commit -m "fix: 보스전 최종 통과 컷인 보장"
```

Expected: 커밋이 생성되고 `git status --short`가 비어 있다. push와 deploy는 실행하지 않는다.
