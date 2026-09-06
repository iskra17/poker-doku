# 보너스 CG 게임 연결 계획 — Fable 총괄 확정 (R4c 병합 뒤 Opus 배치)

> 2026-09-06. 총괄 Claude Fable 5.1. 구현 Claude Opus(`claude-opus-5`), 워크트리 `.worktrees/bonus-cg-integration`(브랜치 `feat/bonus-cg-integration`,
> 기준: R4c 병합 뒤 main + `feat/bonus-cg-assets`의 export 커밋). 근거: [보너스 CG 파이프라인 계획 §4](2026-09-06-bonus-cg-pipeline.md),
> [아트 라이브러리 제작 기획 §7](../specs/2026-09-05-art-library-production-design.md). 자산은 원장 export로 `public/assets/story/cg/bonus-<id>-<scene>.webp` +
> `public/assets/story/video/bonus-<id>-<scene>.{mp4,webm}` 50쌍이 먼저 커밋돼 있어야 한다(사용자 최종 확인 뒤).

**목표:** 보너스 CG 50장을 기존 **스토리 보상 카탈로그 + reconcile 영수증 + 기록실** 인프라로 연결한다. 새 테이블·새 지급 경로를 만들지 않는다.
**제외:** 등급/인증 절차, 서버 권한 게이트 자산 서빙(비노골적 라인이라 공개 경로 — 등급 상향 시 별도), 캐릭터 신규 대사 씬(캡션 한 줄만).

## 1. 카탈로그 (단일 소스 `src/lib/story/rewards/catalog.ts` + 마이그레이션 v39 INSERT)

- 항목 50개, `kind: 'cg'`, 새 필드 `line: 'bonus'`(기존 항목은 `line` 없음 = 'story'), id `story-bonus-cg-<character>-<scene>`(v32 `item_id` CHECK 패턴 확인 후
  필요하면 접두 조정). `art: '/assets/story/cg/bonus-<id>-<scene>.webp'`, `cutscene: { kind: 'event-cg', characterId, title, caption }`.
- **새 트리거 2종**(`StoryRewardTrigger` 확장, `isStoryRewardEntitled`·`storyRewardRequirement`·`storyRewardSourceKey`·`nextStoryRewards` 분기):
  `{ kind: 'affinity-level', characterId: StoryHeroineId, level }`·`{ kind: 'dojo-level', level }`. 자격 판정 입력 `StoryRewardState`에 `dojoLevel: number`,
  `affinityLevels: ReadonlyMap<characterId, level>` 추가 — 서버 `StoryRewardService.#loadState`는 progression 스냅샷(새 dep `progression.getSnapshot(profileId)` —
  없으면 레벨 0으로 취급, 미지급)에서 읽는다. 기존 트리거·항목 판정 불변.
- **해금 임계**(balance: 인연 최대 20, 도장 최대 50): 히로인 6명은 인연 레벨, 미야코·유즈키·린·잉그리드는 도장 레벨. 장면 순서 casual → sing → yoga → gym → beach:
  인연 4/8/12/16/20, 도장 10/20/30/40/50. 수치는 `src/lib/story/rewards/bonus-cg.ts`(순수: 50항목 생성기 + 임계표 + 캡션)에 두고 catalog가 spread한다.
- DB `character_id`는 CHECK 목록(히로인 6명)만 허용하므로 비히로인 4명은 NULL로 넣고 TS 항목의 `subjectId`(캐릭터 id)가 그룹핑 소스. `database.test.ts` 패리티는
  TS `characterId`(히로인만)와 DB 값을 비교하도록 유지. 버전 상수 38→39.
- 캡션·제목: `bonus-cg.ts`에 50개 한국어 제목(계획 JSON `title_ko` + 캐릭터별 변주)과 캐릭터 문체 한 줄(사쿠라 말더듬·아라 반말 츤데레·하나 '당신'·클로이 스트리머체·
  비비안 「자기」 무대 은유·엘레나 「…」·미야코 「~답니다♪」·유즈키 신탁 어조·린 차분한 존댓말·잉그리드 록 반말). 포커 용어 규칙 준수(`poker-terminology.test`).

## 2. 영상 등록

`story-video.ts VIDEO_AVAILABLE`에 `story-bonus-cg-*` 50개 id 추가(파일 쌍 실재 확인 테스트 — `public/assets/story/video/bonus-<id>-<scene>.{mp4,webm}` stem은
`VERSIONED_VIDEO_STEMS` 방식으로 카탈로그 id → 파일 stem 매핑). `getStoryVideo(itemId)`가 CgStage 뷰어·RewardReveal 컷신에서 그대로 재생.

## 3. 기록실·표시 설정 (클라)

- `GallerySection` += `'bonus'`(라벨 '보너스'), `buildGallery`는 `line === 'bonus'` 항목을 'bonus' 섹션에, 나머지 cg는 기존 'cg'에. 잠김 힌트는 `storyRewardRequirement`
  ("사쿠라 인연 Lv.12" / "도장 Lv.30"). 운영자 `unlockAll` 규칙 동일. NEW 기준선(`gallery/seen.ts`) 동일.
- 설정 `settings-store` `showBonusCg: boolean`(기본 true, persist v5 마이그레이션) — false면 기록실 '보너스' 탭·타일·NEW 카운트·결산 컷신에서 보너스 항목을 숨긴다
  (지급·해금 상태는 그대로 — 노출 선호 기능이며 연령 인증이 아님). 설정 모달 「기록실」 또는 「표시」 그룹에 토글 + 설명 한 줄.
- 결산: 스토리 챕터 결산의 `reconcile`이 보너스 항목을 새로 지급하면 `RewardReveal` 컷신 우선순위에서 `line: 'bonus'`는 **보스/띠/에필로그 뒤**(마지막)로 두고,
  `items` 카드에는 표시. 데일리·getProgress 호출 경로는 기존과 같다.

## 4. 지급 트리거 시점

reconcile 호출처는 기존(결산·데일리·`getProgress`)을 유지하고, **인연/도장 레벨업 직후**에도 자격이 생기므로 `get-story-progress`(허브·기록실 열기)에서 자기 치유된다.
추가로 소켓 `progression-update`를 만드는 레벨업 경로(캐시/SnG 정산·스토리 XP)에서 `reconcile`을 한 번 호출해 즉시 반영(실패는 삼킴). 새 지급은
`progression-update` 재전송으로 인벤토리 반영(기존 규약).

## 5. 검증

- `catalog.test`/`story-reward-service.test`: 레벨 트리거 자격(경계 레벨 −1/정확/+1), 히로인·비히로인 분기, 스냅샷 없음 → 미지급, 멱등 reconcile, 영수증 1회.
- `database.test`: v39 패리티 50행, 비히로인 character_id NULL.
- `story-video.test`: 50 id 파일 쌍 실재.
- `gallery/catalog.test`: 'bonus' 섹션 분리, 토글 숨김, unlockAll, NEW.
- `settings-store` persist v5 마이그레이션 테스트.
- 브라우저(총괄): 기록실 보너스 탭·뷰어 루프 재생·토글·레벨업 뒤 해금 반영.

## 6. Astra 검토 반영 (2026-09-06, 총괄 확정 — 본문과 다르면 이 절이 우선)

근거: [reviews/2026-09-06-bonus-cg-plan-astra.md](../reviews/2026-09-06-bonus-cg-plan-astra.md). 7건 전부 수용.

1. **레벨 스냅샷 의존성(P1)**: `StoryRewardService`에 `ProgressionService.getSnapshot`을 주입하지 않는다(중첩 트랜잭션 → 기존 지급까지 실패).
   같은 DB의 `Pick<ProgressionRepository, 'getSnapshotInTransaction'>`를 주입하고(`server/index.ts`에 인스턴스 있음) `#loadState`가 같은 트랜잭션 안에서
   `profile.dojoLevel`·`affinities[].level`을 읽는다. 프로필 부재만 레벨 0(미지급). 스냅샷 호출 실패는 기존 reconcile 예외 경로와 같게 처리.
2. **reconcile 호출처(P2)**: 스토리 결산·데일리·`getProgress`는 **그대로**(스토리 XP 알림 콜백에 동기 reconcile을 넣으면 결산 지급 목록을 가로챈다).
   즉시 반영은 cash/practice `completeHand`와 SnG `completeSng`(`progression-runtime.ts`)의 **커밋 이후**에만 추가하고, 실패는 격리(로그만)하며,
   지급이 있었으면 전송 스냅샷을 다시 읽어 `progression-update`에 싣는다.
3. **컷신 캐릭터 타입(P2)**: `views.ts`의 컷신 `characterId` 타입(현재 `StoryHeroineId | 'miyako'`)에 `'yuzuki' | 'lin' | 'ingrid'`를 추가한다.
   보상 정의의 `characterId`(DB 패리티 대상)는 히로인 한정 유지 — 비히로인은 `subjectId`로 그룹핑.
4. **기록실 뷰어(P2)**: `GalleryModal`의 컷신 뷰어 분기가 `section === 'cg'`만 받으므로 `'bonus'`도 연다(같은 CgStage 뷰어·`layer='modal'`).
5. **표시 설정 범위(P2)**: `showBonusCg=false`는 기록실(`use-gallery.ts` 공유 필터 — 목록·집계·NEW)뿐 아니라 `AffinityTab`의 도장 기록 CG 행과
   히로인별 이벤트 CG 목록에도 적용한다. NEW 기준선(`gallery/seen.ts`)의 실제 획득 집합은 필터와 무관하게 유지.
6. **결산 컷신(P2)**: 표시 설정을 `reward-view.ts` **플랜 생성 전** 입력으로 넣어 보너스 컷신과 그 단계를 함께 제외한다(렌더만 숨기면 진행이 멈춘다).
   DTO에는 `line`이 없으므로 클라이언트는 아이템 id로 공유 카탈로그(`rewards/catalog.ts`)를 조회해 `line`을 판정한다(순수 함수, 테스트).
7. **자기 치유 재조회(P2)**: `GalleryModal`을 열 때 진행도가 이미 `ready`여도 `GET /api/story`를 다시 불러온다(레이트리밋 30/분 안). 레벨업 직후 열어도 최신 자격이 보이게.

확인된 불변: v39 50행 INSERT·비히로인 `character_id NULL`·`kind='cg'`는 v32 CHECK/트리거 통과, 영수증 PK 멱등, `story-bonus-cg-<character>-<scene>` →
`bonus-<character>-<scene>` stem 매핑은 `VIDEO_AVAILABLE`+stem 맵 동시 등록, 설정 persist v4→v5, `nextStoryRewards`는 레벨 트리거 제외.
