수정이 필요한 경계는 7곳입니다. 파일은 변경하지 않았으며, DB 검증은 메모리에서만 실행했습니다.

1. **P1 — 계획의 스냅샷 의존성은 중첩 트랜잭션을 만듭니다.**  
   [story-reward-service.ts:60](/C:/code/claude/poker-doku/src/server/story-reward-service.ts:60) 안에서 [ProgressionService.getSnapshot:209](/C:/code/claude/poker-doku/src/server/progression-service.ts:209)을 호출하면, 필수 `selectedCharacterId`가 빠지고 이를 보충해도 `Nested transactions are not supported`가 발생합니다([database.ts:79](/C:/code/claude/poker-doku/src/server/persistence/database.ts:79)). **기존 보상 지급까지 실패**합니다.  
   **최소 수정:** 동일 DB의 `Pick<ProgressionRepository, 'getSnapshotInTransaction'>`를 주입하세요. [index.ts:215](/C:/code/claude/poker-doku/src/server/index.ts:215)에 인스턴스가 이미 있습니다. [조회 결과:503](/C:/code/claude/poker-doku/src/server/progression-repository.ts:503)의 `profile.dojoLevel`, `affinities[].level`을 사용하고, 프로필 부재만 레벨 0으로 처리하세요.

2. **P2 — 스토리 XP 알림에 추가한 reconcile이 결산 보상을 먼저 가져갈 수 있습니다.**  
   예: 챕터 첫 완주와 인연 Lv.4 달성이 겹칠 때, 공통 보상 콜백에서 동기 reconcile을 실행하면 [커밋 후 알림:567](/C:/code/claude/poker-doku/src/server/socket-handler.ts:567)이 [결산 reconcile:1693](/C:/code/claude/poker-doku/src/server/story-run-coordinator.ts:1693)보다 먼저 지급합니다. 뒤 호출의 신규 지급 목록은 비어서 기존 칩·카드·컷신도 결산에서 빠집니다.  
   **최소 수정:** 스토리·데일리는 기존 호출처를 유지하세요. 즉시 지급을 추가한다면 cash/practice [completeHand:174](/C:/code/claude/poker-doku/src/server/progression-runtime.ts:174), SnG [completeSng:215](/C:/code/claude/poker-doku/src/server/progression-runtime.ts:215)의 **커밋 이후**로 한정하고, 추가 지급 실패만 격리하세요. 전송할 스냅샷도 지급 후 다시 읽어야 합니다.

3. **P2 — 비히로인 15개 컷신은 현재 DTO 타입에 들어가지 않습니다.**  
   `cutscene.characterId: 'yuzuki' | 'lin' | 'ingrid'`는 [views.ts:188](/C:/code/claude/poker-doku/src/lib/story/views.ts:188)의 `StoryHeroineId | 'miyako'`에 대입할 수 없습니다. DB `character_id=NULL`이나 별도 `subjectId`로 해결되지 않습니다.  
   **최소 수정:** 컷신 전용 캐릭터 타입에 세 ID를 추가하세요. 보상 정의의 `characterId`는 히로인 한정을 유지해야 DB 패리티가 보존됩니다.

4. **P2 — 새 `bonus` 섹션의 타일은 눌러도 열리지 않습니다.**  
   해금된 `story-bonus-cg-sakura-casual`을 클릭하면 [GalleryModal.tsx:54](/C:/code/claude/poker-doku/src/components/gallery/GalleryModal.tsx:54)에서 열람 처리는 되지만, 뷰어는 `section === 'cg'`만 받으므로 NEW만 사라집니다.  
   **최소 수정:** [컷신 분기:57](/C:/code/claude/poker-doku/src/components/gallery/GalleryModal.tsx:57)에 `bonus`를 포함하거나 컷신 payload로 분기하세요. 영상 등록만으로는 해결되지 않습니다.

5. **P2 — 숨김 설정이 인연 탭을 빠뜨립니다.**  
   `showBonusCg=false`여도 [AffinityTab.tsx:63](/C:/code/claude/poker-doku/src/components/profile/AffinityTab.tsx:63)은 비히로인 20장을 ‘도장 기록’에, [115행](/C:/code/claude/poker-doku/src/components/profile/AffinityTab.tsx:115)은 히로인별 5장을 그대로 표시합니다.  
   **최소 수정:** 두 CG 목록에도 표시 설정을 적용하세요. 기록실의 목록·집계·NEW는 [use-gallery.ts:31](/C:/code/claude/poker-doku/src/components/gallery/use-gallery.ts:31)에서 같은 필터를 공유하고, 실제 획득 기준선은 별도로 유지하세요.

6. **P2 — 결산 컷신을 렌더링에서만 숨기면 진행이 멈춥니다.**  
   입력이 `showBonusCg=false`이고 선택된 컷신이 보너스일 때, [reward-view.ts:84](/C:/code/claude/poker-doku/src/lib/story/reward-view.ts:84)는 여전히 `cutscene` 단계를 생성합니다. 이 단계에는 자동 진행이 없고 [RewardReveal.tsx:99](/C:/code/claude/poker-doku/src/components/story/RewardReveal.tsx:99)는 일반 탭도 무시합니다.  
   **최소 수정:** 표시 설정을 **연출 계획 생성 전** 적용해 컷신과 해당 단계를 함께 제외하세요. `line`은 현재 [DTO 변환:219](/C:/code/claude/poker-doku/src/lib/story/rewards/catalog.ts:219)에 없으므로 클라이언트에서는 ID로 카탈로그를 조회하거나 DTO 전달을 명시해야 합니다.

7. **P2 — ‘기록실을 열면 자기 치유’는 현재 재조회 조건과 다릅니다.**  
   진행도가 이미 `ready`인 상태에서 cash 레벨업의 추가 reconcile이 실패하면, 기록실을 다시 열어도 [GalleryModal.tsx:40](/C:/code/claude/poker-doku/src/components/gallery/GalleryModal.tsx:40)은 조회하지 않습니다. 실제 로더도 소켓 요청이 아니라 [story-store.ts:154](/C:/code/claude/poker-doku/src/lib/store/story-store.ts:154)의 `GET /api/story`입니다.  
   **최소 수정:** 기록실 열기 시 재조회하거나 레벨 변경 시 진행도 무효화를 명시하세요. 기존 호출처만 유지한다면 이 재조회가 특히 필요합니다.

변경 없이 유지해도 되는 부분은 다음과 같습니다.

- **DB 형식·트리거:** v1~v38 적용 후 예정된 50행 INSERT와 영수증 지급이 모두 통과했고 인벤토리 50개가 생성됐습니다. 비히로인 `NULL`, `kind='cg'`, `equip_slot/chip_amount=NULL`은 [v32 CHECK:6534](/C:/code/claude/poker-doku/src/server/persistence/migrations.ts:6534)에 맞습니다. 기존 [패리티 비교:483](/C:/code/claude/poker-doku/src/server/persistence/database.test.ts:483)도 그대로 사용 가능합니다. `line`·`subjectId`는 TS 메타데이터로 두면 됩니다.
- **멱등성:** `(profile_id,item_id)` PK이며 `source_key`는 감사용입니다([migrations.ts:6598](/C:/code/claude/poker-doku/src/server/persistence/migrations.ts:6598)). source_key를 바꾼 재시도도 추가 지급 0건이었습니다. 단, DB는 레벨 자격을 검증하지 않으므로 조기 지급 방지는 서비스가 책임집니다.
- **영상 매핑:** 50개 WebP와 MP4/WebM 100개가 모두 존재합니다. `story-bonus-cg-<character>-<scene> → bonus-<character>-<scene>`을 available 집합과 stem 맵에 함께 추가하면 [해석기:60](/C:/code/claude/poker-doku/src/lib/assets/story-video.ts:60) 및 기존 RewardCutscene 경로를 사용할 수 있습니다.
- **기존 판정·설정:** 기존 entitlement switch 분기를 유지하면 레벨 트리거 추가와 독립적입니다. `nextStoryRewards`는 현재 챕터·막 보상만 반환하므로 새 레벨 트리거를 제외해도 됩니다. 설정은 실제 [persist v4:137](/C:/code/claude/poker-doku/src/lib/store/settings-store.ts:137)이므로 v5 전환이 맞고, 별도 bonus 섹션이면 기존 CG 35개 집계도 유지됩니다.