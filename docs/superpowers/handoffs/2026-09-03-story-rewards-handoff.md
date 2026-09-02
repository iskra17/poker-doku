# 수련 스토리 — 드릴 재출제 완화 + 보상 체계 세션 인계 (2026-09-03, 3차 세션)

브랜치 `feat/story-rewards` (worktree `.worktrees/story-mode`), 커밋 체인 b2a3f9c → … → bf7af0a (12커밋),
태그 `story-rewards`. main에 ff 병합됨(이 문서 커밋 직전 기준 — 아래 「병합·배포」 참조). **origin 미푸시·Fly 미배포**.
계획 원문: `C:\Users\JEONG JAE HYEON\.claude\plans\velvet-coalescing-crane.md`, 기획 반영: `docs/spec-story-mode-2026-09.md` Part T.

## 사용자 질문·결정 (이 세션의 출발점)

- "드릴을 계속 틀리면 20문쯤까지 간다 — 기획인가?" → 기획대로였음(세트 끝 재출제 최대 2회 = 슬롯×3). **재출제 1회 + 선택**으로 개정.
- "제대로 했을 때 확실한 보상(라이브2D/컷신·의상·아이템)" → 애니메이션 컷인 + 이벤트 CG, 의상은 히로인 6명·로비/스토리 화면만,
  보상 종류 = 코스메틱(의상·CG·카드백·펠트·칭호) + 칩 + 관계 콘텐츠. 영상은 RTX 5090 로컬 생성 **조건부 GO(파일럿 3클립, P5 미착수)**.

## 완료 (전부 커밋·검증됨)

| 단계 | 내용 | 커밋 |
|---|---|---|
| P0 드릴 | 2패스 모델(`queue`/`retryQueue`/`stage`), 오퍼 [다시 풀기 N문]/[복습 노트에 넣고 넘어가기], `maxRetries` 1, 데일리 첫 시도 집계(v31 `drill_attempts.attempt`), `passRule` 삭제, 퍼펙트/빈 노트 플래그 | b2a3f9c |
| P1 클라 | 보상 DTO·카탈로그(`rewards/catalog.ts` 20항목), 로비 보상 레이어(`StoryRewardLayer`+`presentation-store` 게이트, 본드씬 큐 스토어화), `RewardReveal`(스탬프→카드 플립→CG 컷신→띠→다음 보상), 드릴 순간 보상(`drill-moments.ts`+`DrillMomentLayer`), SFX 4종, 배경 매니페스트·BGM 'story' 배선, 허브 보상 힌트 | 58f3635~4310850 |
| P4 의상 | `character-art` 의상 축(`OUTFITS`, `resolveCharacterArt` 폴백 체인), `CharacterImage outfitId` 명시 prop만, `useOutfitId`, 카드백 SVG·노란띠 펠트(수련 테이블 한정) | 5a5b657, 3f63f6e |
| P3 아트 | `scripts/art/convert.mjs` + **18장 배치**: 배경 4(`public/assets/story/bg`), CG 4(`public/assets/story/cg`), 사쿠라 도복·하나 가운 6(`characters/<id>/outfits/<outfit>/`), 미야코 thinking/confident/surprised 3. 매니페스트 등록 완료 | 2305054, 350aa6a |
| P2 백엔드 | v32(`story_reward_catalog` 시드·`story_rewards` 영수증·inventory sync 트리거·v18 validate 재생성·`profile_cosmetics`·`profile_character_outfits`), `StoryRewardService.reconcile`(자격−영수증), 칩 `STORY_REWARD`/`STORY_DAILY`, `setCosmetic`/`setCharacterOutfit`/칭호 폴백, 결산 DTO(items/chips/cutscene/unlockedScenes/next), 허브 미리보기, 새 지급 뒤 `progression-update` 재전송 | 4ac7b22 |
| P4 UI | 인연 탭 옷장·갤러리(도장 기록 CG·히로인별 인연 씬/이벤트 CG/옷장 칩), 보관함 스토리 아이템 장착, `progression-store.setCosmetic` | bf7af0a |

검증: `npx tsc --noEmit` ✓ · `npm run lint` ✓ · 전체 vitest `--maxWorkers=4` **2,370 통과**(실패 0 — `arena-legacy-season-upgrade.test`의
버전 리터럴 30→32 수정 포함) · `npm run build` ✓.

## 미완료 / 다음 세션 순서

1. **브라우저 실주행(포그라운드 창 필수)** — 계획 §8 ①~⑨: 드릴 오답 → 오퍼 2버튼·`n/total` 불변·재출제 헤더 → 결산 스탬프→카드 플립→
   CG 컷신→띠→버튼 → 그 뒤 본드씬·레벨업 필(로비) → 옷장 장착이 파트너 카드·허브·VN에 반영되고 좌석은 기본 → 갤러리 잠김/열림 →
   콤보·퍼펙트 연출·SFX → 배경 크로스페이드 → `chip_ledger`에 `STORY_REWARD` 1회. 자동화 탭이 사용자 Chrome의 백그라운드 탭이면
   5분 뒤 throttling으로 React가 멈추므로(2026-09-03 1차 세션 기록) 사용자가 창을 앞으로 둔 상태에서 진행할 것.
2. **`public/assets/music/story.mp3`** (Suno, [[reference_suno-music-gen]] 워크플로) — 없으면 `music-manager`가 404 → 로비 트랙 폴백(무한 재시도 없음).
3. `dojo-office` 배경 1장(그라디언트 폴백 중), 파트너별 Ch1 대사 변주.
4. **P5 영상 파일럿**(선택): `src/lib/assets/story-video.ts` + `VideoCutscene.tsx` 계약 → Wan 2.2 TI2V-5B로 노란띠 승급·드라코 격파·사쿠라 Lv5 3클립
   (720×1280 3~4초 webm+mp4, `<video muted playsInline autoPlay loop preload="none" poster>`, reduced-motion 미마운트).
5. 스토리 XP로 넘긴 도장 레벨의 **카탈로그 영구 아이템**은 여전히 미지급(v13 뷰 소스 제한 — v32는 스토리 보상 카탈로그만 우회).
6. 2막 데이터(미션형 목표 + 보상 템플릿: 첫 완주 {칭호|의상|카드백}+500, S {CG|의상}+300, 보스 CG, 막 완료 펠트+1,000).

## 병합·배포

- main ff 병합은 이 세션에서 실행(아래 커밋 로그에 `story-rewards` 태그). **푸시·`fly deploy --ha=false`는 사용자 지시 시에만.**
- 배포 전 체크: v32 마이그레이션은 서버 기동 시 자동 적용(카탈로그 20행 시드). `economy.storyDailyChips`(기본 100)는 `/admin` 게임 설정에서 조정 가능.

## 함정·교훈

- **codex 아트 배치에 `--sandbox workspace-write` 필수** — 이번엔 빠져서 read-only 샌드박스가 `out/` 저장을 막고 exit 0으로 끝났다.
  `codex-home/generated_images/<세션>/call_*.png` + 로그 끝 매핑으로 회수했다([[reference_codex-image-gen]] 갱신).
- 마이그레이션 버전을 올리면 `database.test.ts` 외에 `arena-legacy-season-upgrade.test.ts`의 `{ version: N }` 리터럴도 함께 올릴 것
  (v31 때 놓쳐 전체 스위트에서만 드러났다 — 단일 파일 실행 정책의 사각).
- `useProgressionStore` 같은 훅을 컴포넌트의 early return 뒤에 두면 rules-of-hooks 린트 오류(`PokerTable` 펠트 훅에서 발생, 수정).
- 스토리 칭호 장착은 기존 `title` 슬롯을 쓰되 서비스가 컬렉션 → 스토리 카탈로그 폴백, DB `validate_catalog_equipment_*`에 story 분기(v32).
