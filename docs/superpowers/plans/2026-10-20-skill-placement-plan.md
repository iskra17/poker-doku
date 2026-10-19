# 실력 배치 + 숙련자 빠른 진행 (2단계) — 2026-10-20

사용자 결정(2026-10-20): "포커를 아는 사람에게 초반이 지루하다" → 2단계(배치 문제 + 빠른 진행 모드)로 진행.

## 원칙

- 지루함의 원인은 봇 강도가 아니라 기초 레슨과 쉬운 드릴이다. 그래서 **시작 지점·진행 속도**를 나누고, 봇 강도는 보조로만 올린다.
- 자기 평가만으로 올리지 않는다. 서버가 채점한 실제 문제 정답 수로 판정한다.
- 스토리 씬은 건너뛰지 않는다(본편은 미연시). 완료 기록을 거저 주지 않는다 — 빠른 진행도 드릴 + 스파링 목표를 통과해야 완료다.
- 판정은 언제든 다시 측정하거나 직접 바꿀 수 있다.

## 공용 계약 (이 커밋, 구현자 수정 금지)

- `src/lib/story/placement.ts`: `SkillTier`(beginner/novice/advanced), `PlacementSelfReport`(new/rules/regular),
  flag `placement:tier`, 배치 템플릿 4종, `decidePlacementTier`, `placementTierFromFlags`, `defaultRunModeForTier`,
  `tierShowsBeginnerGuide`, `fastModeDrillSlots`, `fastModeTableDifficulty`, `FAST_MODE_SKIPPED_STEP_KINDS`.
- `views.ts`: `StoryRunMode`에 `'fast'`, `StoryPlacementRequest`/`StoryPlacementAck`.
- `protocol.ts`: `'story-placement'` 이벤트.

## 단계별 동작

| 등급 | 판정 | 진행 |
|---|---|---|
| beginner | 자기 평가 '처음' 또는 0문 정답 | 지금 흐름 그대로 + Ch1 초보 안내 |
| novice | 1~2문 정답 | 지금 흐름, 초보 안내만 끔 |
| advanced | 3문 이상 정답 | 챕터 시작 기본값이 빠른 진행(`mode 'fast'`) |

빠른 진행: 씬·드릴 세트·스파링·결산은 유지, 레슨과 프리셋 '연습' 테이블은 건너뜀(인덱스 유지 — exam과 같은 방식),
드릴은 난이도 1 슬롯을 덜어 냄(최소 3문), 스파링 봇은 한 단계 강하게(easy→normal, normal→hard). 통과·보상은 full과 같음.
졸업 챕터(Ch12)는 빠른 진행 불가(서버 거절, 클라는 full로 시작).

## 작업 배정

- **작업자 1 — Claude Opus (서버)**: `story-placement` 소켓 이벤트(파서·레이트리밋 `story`·발급 seed 인메모리 보관·채점·flag 저장·진행 요약 재전송),
  코디네이터 `'fast'` 모드(시작 허용 규칙·`enterStep` 스킵·드릴 슬롯 축소·스파링 난이도 override·exam 전환 허용·결산 mode),
  `LiveEnterInput.difficulty` override(재개 시에도 유지), 테스트.
- **작업자 2 — GPT 6.1 sol (클라)**: 배치 시트(자기 평가 → 4문 → 결과·등급 설명 → 시작), PartnerCard 첫 수련 CTA·허브 진입점,
  허브 등급 표시·변경·다시 측정, 챕터 시작 기본 모드(`defaultRunModeForTier`), 초보 안내 게이트(`tierShowsBeginnerGuide`),
  빠른 진행 표시(스테이지·결산 배지), story-store 액션, 테스트.

## 검증

- 작업자: 관련 단일 파일 vitest + `tsc` + 해당 파일 eslint.
- 통합: 전체 vitest `--maxWorkers=2` 1회, main에서 build, 헤드리스 브라우저(새 사용자: 처음→beginner 흐름 / 숙련 응답→Ch1 빠른 진행에서 레슨·연습 스킵·스파링 봇 강화 확인).
