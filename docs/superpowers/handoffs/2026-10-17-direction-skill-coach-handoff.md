# 2026-10-17 방향 재정비 · 필살기 · 파트너 훈수 · 캐릭터 키트 핸드오프

이 문서는 2026-10-17 세션 결과와 다음 세션의 시작점을 정리한다. 기준: 로컬 main `80a6b67` 다음의 핸드오프 커밋.
**push와 배포는 하지 않았다.** 원격 main 대비 로컬 커밋 12개가 앞서 있고, 운영은 이전 배포(Fly v92) 그대로다.

## 1. 확정된 방향 (사용자 결정)

- **싱글 미연시 수련이 본편이고, 사람과 겨루는 멀티는 엔드콘텐츠다.**
- 필살기 연출은 **빠르고 감각적으로**, **내 화면에만** 보인다. 다른 플레이어의 게임을 멈추거나 방해하지 않는다.
- 가챠는 넣지 않는다(조건 해금 유지).
- 근거: 2026-09-08 리텐션 분석(9/6 신규 34명 다음 날 복귀 0, 핸드의 88%가 봇 상대 혼자).
  분석 원문 `docs/retention-analysis-2026-09-08.md`는 이 세션 전부터 **커밋되지 않은 상태**로 남아 있다. 사용자 확인 없이 커밋하지 않았다.

## 2. 이번 세션에서 만든 것

### 2.1 파트너 필살기 (사쿠라 프로토타입)

- 연출: `src/components/effects/SkillBurstLayer.tsx`(상태·이벤트) + `SkillBurstScenes.tsx`(장면).
- 판정: `src/lib/skills/skill-trigger.ts`(순수, 테스트 11개). `winners` 이벤트에 `communityCards`·`bigBlind`를 추가했다.
- 기술 데이터: `src/lib/skills/catalog.ts` — 기술별 이름·모티프·표정 연기·전용 포즈.
  | 기술 | 단계 | 모티프 | 전용 포즈 |
  |---|---|---|---|
  | 스틸 리프 | 소 | swipe | steal |
  | 파워 코드 | 소 | soundwave | powerchord |
  | 벚꽃 파워 코드 | 중 | band | bigpot |
  | 리버 앙코르 | 대 | wave | encore-tearful → encore (교차 페이드) |
  | 스테이지 다이브 | 대 | dive | dive |
  | 벚꽃 폭풍 솔로 | 대 | storm | storm |
- 포즈가 하나인 기술은 처음부터 끝까지 그 포즈만 쓴다. 기본 버스트에서 전용 포즈로 컷 전환하면 어색하다는 사용자 피드백으로 고쳤다(`80a6b67`).
- 설정 `skillBurst` full/lite/off(persist v6). 라이트는 어두운 패널 + 흰 글씨 배너.
- 검토 화면: `/preview/skill-burst`(개발 서버 전용, 운영 빌드 404). 기술별 버튼 6개, 풀/라이트, **슬로 ×4**, 자동 반복.
- 포즈 아트: `public/assets/characters/sakura/skill/*.webp` 7장, 매니페스트 `character-art.ts SKILL_POSES` / `getSkillPoseArt`.
- 실제 핸드에서 올인 승리 → 「스테이지 다이브!」 발동을 서버 로그와 대조해 확인했다.

### 2.2 파트너 실시간 훈수 1단계 (클라이언트 전용)

- UI `src/components/table/PartnerCoach.tsx`, 판단 `src/lib/coach/coach-brain.ts`, 대사 `coach-lines.ts`,
  노출 조건 `coach-eligibility.ts`, 세션 카운터 `src/lib/store/partner-coach-store.ts`. 계약은 AGENTS.md 「파트너 실시간 훈수」 항목.
- 노출: 로비 목록 `tableType 'bots'` + 다른 휴먼 없음 + 스토리·주간 도장·토너먼트·아레나 아님. 판정 불가면 끈다.
- 톤 계약: 안 따라도 꾸짖지 않고, 따랐는데 쇼다운에서 지면 "결정은 맞았다"로 위로(테스트 고정).
- 설정 `partnerCoach`(persist v7, 기본 켬). 사쿠라 전용 말투 + 다른 캐릭터는 중립 폴백.
- 브라우저 확인: Practice Dojo에서 훈수 → [사쿠라 말대로 · 폴드] → 「오늘 사쿠라 말대로 2번」 반응.

### 2.3 캐릭터 키트 (의상·포즈 제작 준비)

- `scripts/art/character-kit/`: `run.mjs`(Codex 러너), `characters.json`(디자인 스펙), `README.md`(게임 반영 절차), `jobs/`.
- 원화 보관(리포 밖): `C:\code\claude\poker-doku-art\characters\sakura\`
  - `turnaround/{front,three-quarter,side,three-quarter-back,back}.png` — 1024×1536 전신, #00ff00 배경
  - `bust-reference.png`, `jobs/outfit-stage-pilot/`(라이브 무대 의상 파일럿: 전신 2 + 표정 3, **게임 미반영**)
- 필살기 포즈 원화: `C:\code\claude\poker-doku-art\skill-expressions\out\skill\*.png`.

## 3. 다음 세션 할 일 (우선순위)

1. **훈수 2단계 — 인연 XP (사용자 결정 대기).** 서버가 같은 `coach-brain`으로 "따랐는지" 재판정하고 핸드 완료 때
   인연 보너스를 준다. 보상 시스템이라 AGENTS.md 오케스트레이션 규칙대로 독립 리뷰를 붙인다.
   - 위치 후보: RoomManager의 휴먼 액션 처리 직전에 `adviseHero(getPublicState(heroId), heroId)` 계산 → 핸드별 따름 수 →
     `progression.completeHand` 입력에 전달 → `ProgressionService.recordCompletedHand`의 `affinityReward`에 상한 있는 보너스.
   - 주의: `ProgressionBalance`는 버전 레지스트리(불변)다. 새 수치를 기존 v1에 섞을지, 별도 상수로 둘지 먼저 정한다.
     혼자 연습 방(`tableType 'bots'`)만, 하루 상한, 연습 감액(`practiceReducedRatePermille`)과의 관계를 테스트로 고정한다.
2. **다른 히로인 확장 (사용자 결정 대기).** 아라·하나·클로이·비비안·엘레나: 훈수 말투, 필살기 기술·포즈, 턴어라운드.
   절차는 `scripts/art/character-kit/README.md`의 「새 캐릭터 준비」.
3. **라이브 무대 의상 게임 반영 (사용자 결정 대기).** README 「게임에 넣기」 1~4단계(변환 → OUTFITS 등록 → 보상 카탈로그 + 마이그레이션).
4. 남은 다듬기
   - 훈수 말풍선이 데스크톱에서는 화면 왼쪽 끝에 붙는다. 테이블 컨테이너 기준 배치를 검토한다.
     320×568 같은 낮은 화면에서는 좌하단 좌석과 겹칠 수 있다(실기기 미확인).
   - 턴어라운드 측면 뷰의 헤어핀 위치가 다른 뷰와 조금 어긋난다.
   - riverordie 조사의 다른 후보: 오토폴드·내 차례까지 빨리감기, 세션 끝 "습관 3줄", 올인 승률 화면, 봇 도감, 약속형 데일리 이벤트.
5. push·배포는 사용자 지시 때만. 배포 전 `npm run build`와 관련 테스트를 다시 확인한다.

## 4. 운영 메모

- Codex 이미지 생성: `-m gpt-5.5`는 이제 400이다. `gpt-5.6-sol`(기본)·`gpt-5.6-luna`·`gpt-6-astra`가 동작한다.
  격리 `CODEX_HOME`(auth.json만 복사) + `--sandbox workspace-write`가 필요하고, 저장이 막히면 로그 매핑으로 회수한다(러너가 자동 처리).
- junction worktree에서는 Turbopack dev 서버가 뜨지 않는다. 브라우저 확인은 main 통합 뒤 main에서 했다.
- 브라우저 QA는 `127.0.0.88:3007` 호스트로 신규 프로필을 격리했다(개발 DB는 세션 scratchpad의 `skill-qa.sqlite`).

## 5. 검증 기록

- 마지막 통합 시점: `npx tsc --noEmit` 통과, 관련 Vitest(coach·store·events·skills) 19파일 172개 통과, `npm run build` 통과.
- 이후 `80a6b67`(표정 연속성 수정)은 tsc·eslint 통과, 브라우저에서 기술별 표시 이미지를 기록해 확인했다.

## 6. 후속 세션 (같은 날) — 히로인 5명 확장 완료

3장 2번(다른 히로인 확장)을 진행했다. 커밋 `9b35399`, main에 ff 병합. **push·배포는 하지 않았다.**

- **필살기**: 아라·하나·클로이·비비안·엘레나 각 6기술 + 전용 포즈 7장(리버 역전만 시작·끝 2장).
  `SkillDef`에 캐릭터 상징 입자 `particle`(ember/spark/star/rose/snow, 사쿠라 petal)과 soundwave 글자 `glyphs`를 추가했다.
  | 캐릭터 | 소(스틸/쇼다운) | 중 | 대(역전/올인/몬스터) |
  |---|---|---|---|
  | 아라 | 헤드샷! / 클러치! | 서울의 불꽃! | 역전 리스폰! / 풀스로틀 러시! / 홍련 난무! |
  | 하나 | 폴드 에퀴티! / 계산 완료. | 기대값 최대화! | 확률의 역습! / 올인 EV 플러스! / 솔버 각성! |
  | 클로이 | 럭키 스틸~☆ / 히어로 콜! | 구독 폭발! | 리버의 기적~! / 올인 하이라이트! / 전설의 클립! |
  | 비비안 | 가면무도회! / 커튼콜! | 제2막 개막! | 극적인 반전! / 그랑 피날레! / 브라비시모! |
  | 엘레나 | 침묵의 압박. / 예상 범위. | 빙결 밸류! | 설원의 역습. / 눈사태! / 설원의 여왕. |
- **훈수 말투**: 5명 전용 `CoachVoice`(21이유 × 2문장 + 반응). 톤 계약(질책 금지·진 경우 "결정은 맞았다") 테스트를 6명 + 중립 폴백 전부로 넓혔다.
- **미리보기**: `/preview/skill-burst`에 캐릭터 선택. `SkillPreviewRequest.characterId`.
- **턴어라운드**: 5명 × 5뷰, 리포 밖 `ART_ROOT/characters/<id>/turnaround/`. job은 `scripts/art/character-kit/jobs/<id>-*.json`.
- **러너 수정**: fullbody 프레이밍에 "단일 인물" 명시(하나·비비안 후면이 다중 뷰 시트로 나왔음), 로그가 절대 Windows 경로로
  매핑을 찍어도 회수하도록 정규식 수정.
- **재생성한 샷**: 비비안 act2(커튼콜과 구도가 겹침), 엘레나 queen(chipflip과 겹침), 하나 후면, 비비안 측면·후면·3⁄4 후면.
- **검증**: tsc·eslint 통과, 관련 Vitest 25파일 198개 통과(`catalog.test.ts` 신규 — 6명 기술·포즈 파일 존재 고정),
  main에서 `npm run build` 통과. 브라우저 미리보기에서 6명 × 6기술 36개가 각자 포즈를 불러오고 콘솔 오류가 없음을 확인했다.
- **미확인**: 실제 테이블에서 사쿠라 외 파트너로 훈수·필살기를 띄우는 주행은 하지 않았다(미리보기·단위 테스트로 대체).
- 남은 결정은 그대로: 훈수 2단계(인연 XP), 라이브 무대 의상 게임 반영.
