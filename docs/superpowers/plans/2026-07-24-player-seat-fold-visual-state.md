# Player Seat Fold Visual State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 타임아웃 자동 체크는 정상 좌석처럼 유지하고, 실제 폴드한 캐릭터는 강한 흑백으로, 접은 내 홀카드는 색상을 유지한 채 크게 흐리게 표시한다.

**Architecture:** 서버의 액션 및 자리비움 계약은 변경하지 않는다. 클라이언트에 순수한 좌석 시각 상태 판정기를 추가해 `sitOutAuto`와 명시적 자리비움을 구분하고, `PlayerSeat`에서 캐릭터·홀카드·정보판의 시각 클래스를 각각 적용한다.

**Tech Stack:** React 19, Next.js, TypeScript, Tailwind CSS, Vitest

---

### Task 1: 좌석 시각 상태 판정기를 테스트 우선으로 추가

**Files:**
- Create: `src/components/table/player-seat-visual.ts`
- Create: `src/components/table/player-seat-visual.test.ts`

- [ ] **Step 1: 실패하는 상태 판정 테스트 작성**

다음 사례를 테스트한다.

- `status='active'`, `sitOutNext=true`, `sitOutAuto=true`인 타임아웃 자동 체크 좌석은 `normal`
- `status='folded'`인 좌석은 `folded`
- `status='sitting-out'` 또는 수동 `sitOutNext=true`, `sitOutAuto=false`는 `away`
- 칩이 0이고 올인이 아닌 좌석은 `busted`
- 실제 폴드가 다른 상태보다 우선

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/components/table/player-seat-visual.test.ts`

Expected: 모듈이 아직 없으므로 FAIL.

- [ ] **Step 3: 최소 상태 판정기 구현**

`Player`의 필요한 필드만 받는 `resolveSeatVisualState()`를 구현한다. 판정 우선순위는 `folded → busted → away → normal`이며, 자동 타임아웃 마킹인 `sitOutAuto=true`는 같은 핸드에서 `away`로 처리하지 않는다.

- [ ] **Step 4: 시각 클래스 계약 테스트와 구현**

`getSeatVisualClasses()`가 다음 계약을 반환하는지 테스트하고 최소 구현한다.

- `folded`: 캐릭터는 강한 `grayscale`과 낮은 opacity, 홀카드는 `grayscale` 없이 `opacity-25`, 정보판은 더 약한 흐림
- `away`/`busted`: 기존처럼 캐릭터와 카드가 흑백·흐림
- `normal`: 흐림 클래스 없음

- [ ] **Step 5: 단위 테스트 통과 확인**

Run: `npx vitest run src/components/table/player-seat-visual.test.ts`

Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add src/components/table/player-seat-visual.ts src/components/table/player-seat-visual.test.ts
git commit -m "test: define player seat visual states"
```

### Task 2: PlayerSeat에서 캐릭터와 홀카드 효과 분리

**Files:**
- Modify: `src/components/table/PlayerSeat.tsx`
- Test: `src/components/table/player-seat-visual.test.ts`

- [ ] **Step 1: 공통 시각 상태 판정기를 연결**

기존의 `isDimmed`와 단일 `dimClass`를 제거하고 `resolveSeatVisualState(player)` 및 `getSeatVisualClasses()`를 사용한다.

- [ ] **Step 2: DOM 효과 적용 영역 분리**

캐릭터 아바타 전용 래퍼에 portrait 클래스를 적용하고, 홀카드 래퍼에는 card 클래스를 별도로 적용한다. 폴드한 본인 홀카드는 기존처럼 보이되 색상은 유지하고 `opacity-25`로 크게 흐리게 한다. 이름·칩 정보판은 판독 가능하도록 plate 클래스만 적용한다.

- [ ] **Step 3: 관련 회귀 테스트 재실행**

Run: `npx vitest run src/components/table/player-seat-visual.test.ts`

Expected: PASS.

- [ ] **Step 4: 타입과 린트 확인**

Run: `npx tsc --noEmit`

Expected: PASS.

Run: `npm run lint`

Expected: PASS.

- [ ] **Step 5: 커밋**

```bash
git add src/components/table/PlayerSeat.tsx
git commit -m "fix: distinguish timeout checks from folded seats"
```

### Task 3: 전체 검증과 배포

**Files:**
- Verify only

- [ ] **Step 1: 전체 테스트 실행**

Run: `npm test`

Expected: PASS.

- [ ] **Step 2: 프로덕션 빌드 실행**

Run: `npm run build`

Expected: PASS.

- [ ] **Step 3: 작업 브랜치를 main에 병합**

격리 작업공간의 커밋을 검토한 뒤 `main`에 fast-forward 병합한다. 사용자 소유의 미추적 `.superpowers/`는 건드리지 않는다.

- [ ] **Step 4: 원격 저장소에 푸시**

Run: `git push origin main`

Expected: 원격 `main`이 새 커밋으로 갱신됨.

- [ ] **Step 5: Fly.io 배포와 상태 확인**

Run: `fly deploy`

Expected: 도쿄 단일 머신 배포 성공.

Run: `fly status`

Expected: 앱 머신이 정상 실행 상태.
