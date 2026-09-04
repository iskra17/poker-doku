# Fable 5.1 xhigh — R3/R4 기획 검토

실제 모델: claude-fable-5-1. 읽기 전용, 테스트 미실행. 아래는 독립 리뷰이며 최종 구현 계약은 총괄의 spec 수정본을 따른다.

## 검토 범위와 총평

읽은 파일은 AGENTS.md, 설계안, 원본 명세 전문, Ch7 계약, `story-live-adapter.ts`, `story-run-coordinator.ts`, `room-manager.ts`의 방 생성·해체·핸드 시작·플레이어 루프·턴 타이머·핸드 종료·이탈·grace·자리비움·블라인드 레벨·토너먼트 정산 경로, `socket-handler.ts`의 스토리·액션·이탈·grace 핸들러, `engine.ts` 토너먼트 로직, `blind-schedule.ts`, `objectives.ts`, `grading.ts`, `unlocks.ts`, `curriculum.ts`, `views.ts`, `types.ts`, `story-masquerade.ts`, `story-opponent-review.ts`, `opponent-response.ts`, 보상 서비스·리포지토리, `progression-service.ts`의 스토리·SnG 보상, `rewards/catalog.ts`, 챕터 검증기, `learning.ts`, `range.ts`, `story-payload.ts`, 마이그레이션 v35다. 테스트·셸·모델 호출은 실행하지 않았고 코드 읽기만으로 판단했다.

총평은 다음과 같다. 설계 방향은 맞고 R1·Ch7 계약을 훼손하지 않는다. 그러나 설계안이 이미 있는 것처럼 전제한 계약 여섯 가지가 코드에 없거나 반대로 동작한다. 특히 Ch12를 현재 어댑터에 그대로 얹으면 히어로가 첫 타임아웃 뒤 매 핸드 1초 자동 폴드에 갇히고, 우승할 때만 SnG 순위 XP가 따로 지급된다. 아래 결함을 계약에 반영하면 착수 가능하다.

## 결함과 최소 수정

**1. Ch8 리딩 퀴즈의 pre-turn hold 수명주기** 설계안의 훅은 위치는 맞지만 재개·거절·끊김 경로가 코드와 어긋난다.

- **훅 위치와 멱등.** `startPlayerLoop`는 봇 루프, 히어로 액션, 자동 액션, 핸드 시작, 타임뱅크에서 재진입된다. 위치는 `src/server/room-manager.ts:2814`. 훅 `beforeHeroTurn`은 활성 플레이어가 휴먼이고 `autoAct`가 아닐 때만 부르고, 어댑터는 `(handNumber, actionSeq)` 키가 같으면 기존 질문을 돌려준다. 이렇게 해야 resync나 중복 루프가 새 deadline을 만들지 않는다.
- **서버 거절.** `processPlayerAction`은 엔진으로 바로 간다. 위치는 `src/server/room-manager.ts:3082`. 스토리 방이면서 훅이 turn hold라고 답하면 false를 돌려주고, `useTimeBank`도 같은 가드를 둔다. 소켓 계층 가드만으로는 부족하다.
- **재개 API 부재.** `resumeRoom`은 `tryStartGame`이라 핸드 진행 중엔 아무 일도 하지 않는다. 위치는 `src/server/room-manager.ts:832`와 `:1830`. 스토리 방 전용 `resumeHeroTurn(roomId)`를 추가하고 내부는 `startPlayerLoop` 뒤 `onUpdate`다. 어댑터 `resume()`은 masquerade 분기와 별개의 readingQuiz 분기를 가져야 한다.
- **끊김 계약 충돌.** `handleDisconnect`는 히어로 턴이면 즉시 자동 액션한다. 위치는 `src/server/room-manager.ts:2768`. 설계안의 "발급된 deadline만 유지"는 이 코드와 양립하지 않는다. 최종 추천은 기존 즉시 자동 액션을 유지하고, 어댑터가 키 불일치를 보고 그 질문을 invalidated로 기록하는 것이다. 오프라인 만료 처리 자체가 필요 없어져 더 단순하다.
- **hold 필드 분리.** `session.hold`를 재사용하면 `isHeld()`가 true가 되어 핸드 경계 hold와 섞이고, `sweepHolds`가 핸드 도중 방을 닫아 진행 중 핸드의 기여 칩이 사라진다. 별도 `turnHold`를 두고, 만료 뒤 [계속하기]를 일정 시간 안 누르면 타임아웃 처리 후 `resumeHeroTurn`으로 자동 재개한다. `onHandComplete`에서는 잔존 turnHold를 무조건 정리한다.
- **어댑터 배선.** `objectiveViews`는 masquerade일 때만 extras를 넘기고, `answerQuiz`는 `session.masquerade?.quiz`를 요구한다. 위치는 `src/server/story-live-adapter.ts:968`과 `:358`. readingQuiz 디스패치가 필요하다. `HandReadQuizView.required`는 리터럴 4라 number로 풀고 상황 필드를 더한다. 위치는 `src/lib/story/views.ts:91`.
- **교육 정합성.** 정답 입력은 히어로 홀카드, 보드, `totalContributed` 합계, `currentBet` 차액, 상대 personalityId, 공개 액션 라인뿐이어야 한다. 상대 레인지는 personality와 벳 크기 표에서 만들고 `rangeCombos(range, [hero, board])` 전수 평가로 에퀴티를 구한 뒤 `computePotOdds`와 비교한다. 다음 경우는 미출제로 둔다.

```
|equity - requiredEquity| < 0.05
멀티웨이 / 올인·사이드팟 (reviewOpponentResponses의 hasAllIn 규칙 재사용)
블로커 제거 후 남은 콤보 < 10
```

  회귀 테스트로 상대 홀카드를 바꿔도 질문 payload가 동일함을 고정한다.

**2. 목표 수학과 부분 기회 공정성** 설계안의 "기회보다 높은 횟수 목표는 실제 기회 수까지 한정"은 코드에 없다.

- **트리거.** `ratioView`는 `target`이 있으면 `executed >= target`만 본다. 위치는 `src/lib/story/objectives.ts:562`. Ch8에서 기회 1회 중 옳게 1회 콜해도 maxHands에서 실패한다.
- **수정.** `ObjectiveExtras.final`을 추가하고 final일 때만 `effectiveTarget = min(target, opportunities)`를 쓴다. 기회 0은 그대로 null이다. 조기 종료 판정 `primaryObjectivesAllAchieved`는 final=false로 불러 target 원값을 유지하고, 어댑터 `finish()`의 summary만 final=true다. Ch4·Ch5의 target 2도 함께 완화되는데 이는 A13 규약과 일치한다.
- **폴드-전부 구멍.** Ch9 primary가 '체크레이즈 대면 폴드 70%'와 '과도콜 상한 2'뿐이면 15핸드를 전부 프리플랍 폴드해도 통과한다. 상한형은 기회 0에서도 판정 가능하기 때문이다. `act1.test.ts:225`의 "실행형 target primary 1개 이상" 불변식을 전 막 공용 테스트로 올리고, Ch9는 루나 체크레이즈 폴드에 `target: 1`을 두거나 실행형 목표 하나를 더한다.

**3. Ch11 3-of-5 정책** `primaryObjectivesMet`는 all 규칙 고정이고, 5개 중 '하위 참여 0·림프 0·오즈 위반 2 이하'는 상한형이라 폴드만 해도 3개가 채워진다.

- 스텝에 `objectives.passRule?: { kind: 'any-k'; k: 3; minExecuted: 1 }`을 추가하고 순수 함수 `checklistMet(views, rule, final)`을 둔다. null은 제외하고, achieved 개수가 `min(k, 판정 가능 수)` 이상이며, 기회형 항목 중 achieved가 minExecuted 이상이어야 한다. 기회형이 전부 null이면 minExecuted를 0으로 낮춘다. 30핸드 6-max에서 c벳과 밸류 기회가 모두 0일 확률은 사실상 없어 폴드-전부가 막힌다.
- Ch11은 minHands 없이 maxHands 30 고정을 추천한다. minHands를 두면 상한형 3개로 조기 종료가 즉시 발동한다. `validateChapters`에 passRule 검사를 추가한다.

**4. Ch12 실제 SnG와 기존 어댑터·룸매니저 충돌** 이 항목이 가장 크다.

- **블라인드 구조가 모듈 상수.** `startNewHand`, `applyBlindLevel`, 시작 채팅이 `SNG_BLIND_SCHEDULE`·`SNG_LEVEL_DURATION_MS`를 직접 읽는다. 위치는 `src/server/room-manager.ts:1985`, `:2977`, `src/lib/poker/blind-schedule.ts:37`. `RoomConfig.sngStructureId?: 'standard' | 'story-graduation'`을 서버 전용 필드로 두고 기존 스토리 필드 가드에 편입해 외부 payload를 막는다. `resolveSngStructure(config)`가 levels와 levelMs를 돌려주고 `levelIndexAt`은 구조를 인자로 받는다. 기본값이 현재 상수라 일반 SnG는 불변이다.
- **스텝 표현.** 새 Step kind 대신 masquerade 선례처럼 `LiveTableSpec.tournament?: { id: 'graduation-v1'; structureId }` 정책을 sparring에 얹는다. maxHands는 폭주 가드로만 두고 도달 시 결과 없는 실패로 로그한다. 어댑터는 이 정책이면 config에 `gameMode: 'sng'`와 `startingStack`을 넣는다.
- **타임아웃 루프.** `beforeHand`는 `isDisconnected`나 `sitOutNext`면 hold한다. 위치는 `src/server/story-live-adapter.ts:504`. SnG에서 hold를 빼기만 하면 첫 타임아웃 뒤 `sitOutNext`가 남고 `startNewHand`가 `sitOutAuto`를 지워 매 핸드 1초 자동 폴드에 갇힌다. 위치는 `src/server/room-manager.ts:2836`. ActionBar [게임 복귀]는 `toggleSitOut`이 스토리 방을 거절해 탈출이 없다. 위치는 `:2343`. 최소 수정은 이 가드를 "스토리 방이면서 토너먼트 방의 복귀 요청은 허용"으로 좁히는 것이다. 그러면 일반 SnG의 away 계약이 그대로 쓰인다. `hero.chips <= 0`을 failed로 보내는 분기도 SnG 정책에서는 `finishPlace` 확정으로 done 처리한다.
- **핸드 종료 판정.** `onHandComplete`는 SnG 정책이면 `hero.finishPlace` 또는 `tournament.finished`를 보고 `finish('done', 'sng-place')`로 끝내고 summary에 place와 entrants를 싣는다. 위치는 `src/server/story-live-adapter.ts:557`.
- **SnG 순위 XP 이중 지급.** `handleCompletedHand`는 스토리 분기보다 먼저 `finalizeFinishedTournament`를 부르고, 이는 `completeProgressionTournament`를 거쳐 `completeSng`로 이어진다. 위치는 `src/server/room-manager.ts:3382`와 `:3274`. 히어로 우승이면 `dojoXpPerSngPlace`·인연·SnG 미션·스트릭이 지급되고, 조기 탈락으로 방을 먼저 닫으면 지급되지 않는 비대칭이 생기며 졸업 반복으로 우승 XP를 농사할 수 있다. `completeProgressionTournament`에 스토리 방 가드를 넣고 어댑터 `skipHandProgression`도 이 정책이면 true를 돌려 캡처 자체를 생략한다. 설계안의 "일일 핸드 XP 적용" 문장은 SnG 핸드가 원래 `completeHand`를 타지 않으므로 삭제해야 한다.
- **room-lost 재개 금지.** `resume()`은 roomId가 없으면 `openRoom`으로 새 방을 연다. 위치는 `src/server/story-live-adapter.ts:249`. 이 정책은 `handsPlayed === 0`일 때만 허용하고 그 외엔 결과 없는 종료로 마감한다. `heroSeatChips` 이어받기도 적용 제외다.
- **`fillWithBots` 누락 가드.** hostId가 없고 wallet이 아니라 스토리 방에서 통과된다. 위치는 `src/server/room-manager.ts:907`. 스토리 방 거절을 추가한다.
- **시간 예산.** 총 6,000칩에 2분 레벨이면 레벨 9의 300/600에서 평균 스택이 3.3BB라 20분 전후 종료가 산술적으로 보인다. 지배 변수는 `turnTimeSec 60`이다. Ch12는 30초와 `botThinkScale 0.5`를 추천하고 설계안대로 단축 타이머 시뮬레이션으로 실측한다.

**5. 졸업 확정·receipt·검은띠**

- **확정 시점.** receipt와 플래그는 어댑터 `onStepFinished` 뒤 코디네이터 `completeLiveStep`에서 `enterStep(next)` 전에 한 트랜잭션으로 쓴다. 이유는 둘이다. 에필로그 VN이 `Scene.requiresFlags`로 순위 분기하려면 플래그가 에필로그 전에 있어야 하고, 런은 인메모리라 결산 전에 죽으면 순위가 사라진다. 플래그 판정 위치는 `src/lib/story/scene-cursor.ts:127`. 실패하면 run에 `pendingGraduation`을 남기고 다음 advance나 resend에서 재시도하며, 성공 전엔 에필로그로 넘기지 않는다. 챕터 완료와 XP는 기존대로 result 스텝에서 처리한다.
- **receipt 스키마.** `story_graduations(profile_id, run_id, place, entrants, mode, fingerprint, created_at)`에 `UNIQUE(profile_id, run_id)`. 같은 run 재전달은 fingerprint 비교로 멱등, 다른 fingerprint는 `STORY_VALUE_INVALID`. `recordCompletionInTransaction`과 `setFlagsInTransaction`이 이미 있어 확장이 작다. R4 v37에 넣는다.
- **검은띠 카탈로그 트리거.** `catalog.ts`의 `flag` 트리거는 단독 조건이라 검은띠 칭호를 `belt:black`으로 두면 Ch10·11 미완료여도 지급된다. `isStoryRewardEntitled`에 `{ kind: 'graduation' }` 트리거를 추가하고 `isActCompleted(4)`와 플래그의 교집합으로 판정한다. `deriveBelt`와 같은 기준이다. 위치는 `src/lib/story/unlocks.ts:67`.
- **beltAwarded 오판.** `computeResult`가 `beltBefore`를 결산 시점에 읽는다. 위치는 `src/server/story-run-coordinator.ts:1272`. 플래그를 SnG 종료 시 먼저 쓰면 graduation 모드에서 before가 이미 black이라 승급 연출이 뜨지 않는다. `start()`에서 `run.beltAtStart`를 스냅샷해 쓴다.
- **graduation 모드.** `StoryRunMode`와 파서에 'graduation'을 추가한다. 위치는 `src/lib/story/views.ts:15`, `src/server/story-payload.ts:62`. `start()`는 Ch12 완료자만 허용하고 `enterStep`은 tournament 정책 sparring, 에필로그 scene, result만 진입한다. `ChapterResultView.drill`을 nullable로 바꿔 null을 보낸다. `recordCompletion`은 부르지 않아 완료 수와 best_grade를 오염시키지 않는다. `completeChapter`는 run 키 replay XP만 지급되고 첫 XP·인연·첫완주 칩은 first 키와 영수증이 이미 막는다. `retrySparring`은 full 전용이라 무관하다.
- **exam 거절.** `start()`는 드릴 세트 존재만 본다. 위치는 `src/server/story-run-coordinator.ts:527`. `Chapter.examDisabled?: true`를 Ch12에 두고 서버와 허브가 공용한다.

**6. 이미 성립하는 것과 보강** Ch10 두 번째 라이브만 재도전은 `completeLiveStep`이 실패 스텝 인덱스로 checkpoint를 만들고 done 결과만 남기므로 추가 계약 없이 성립한다. 위치는 `src/server/story-run-coordinator.ts:949`. Ch8·Ch9 상대 판정은 `reviewOpponentResponses`가 좌석에서 personality를 식별하므로 확장 지점이 맞지만, 루나 체크레이즈는 "히어로 벳 뒤 같은 스트리트 레이즈" 사실이 없어 `deriveHeroHandFacts`에 추가해야 한다. 현재는 `ownBet === 0`만 판정한다. 드릴 수학은 `rangeCombos`가 Set 키와 dead 제거를 이미 갖췄고, `findNuts.holeCards.length > 1`이면 단일 선택 리롤 규칙이 맞다. 어댑터의 `clearQuizTimer`·`shutdown`·`dropSession`·`forceFinish` 정리 목록에 readingQuiz와 turnHold 타이머를 포함해야 한다.

선택적 개선은 결함이 아니다. Ch8에서 `first-my-turn` 클라 인터럽트와 퀴즈 카드의 동시 표시 회피, Ch12 탈락 시 EliminationNotice 뒤 6초 해체 대신 순위 확정 컷인, 관찰 노트의 포스트플랍 항목 확장이다.

## 판정과 필수 설계 수정

판정은 조건부 착수 가능이다. 항목 1부터 5까지를 계약 문서에 반영하기 전에는 구현을 시작하면 안 된다. 특히 4의 `toggleSitOut` 복귀 허용·SnG XP 가드·블라인드 구조 파라미터와 5의 확정 시점·검은띠 트리거·beltAtStart는 구현 중간에 발견하면 어댑터와 코디네이터를 다시 짜야 한다.

필수 설계 수정은 다음 다섯 가지다.

1. `beforeHeroTurn` 훅, `processPlayerAction`·`useTimeBank` 서버 거절, `resumeHeroTurn` 신설, 끊김은 기존 즉시 자동 액션 유지와 invalidated 기록, `turnHold` 분리.
2. `ObjectiveExtras.final` 기회 캡과 실행형 primary 불변식의 전 막 테스트 승격.
3. Ch11 `passRule any-k`에 minExecuted 1, minHands 없음.
4. `sngStructureId`, `tournament` 정책, `toggleSitOut` 복귀 허용, `completeProgressionTournament` 스토리 가드, `resume` 재개 금지, `fillWithBots` 가드.
5. SnG 종료 시 receipt와 플래그 단일 트랜잭션, `graduation` 카탈로그 트리거, `beltAtStart`, graduation 모드 DTO의 drill null, `examDisabled`.
