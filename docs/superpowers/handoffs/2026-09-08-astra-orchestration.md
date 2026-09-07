# 2026-09-08 개발 인수 — Astra 총괄 / Fable 검토 / Opus·Luna 구현

이번 사용자 지시는 진행 상황 확인과 개발 지휘 체제 변경이다. 새 기능 구현·push·운영 배포는 이번 범위에 없다.
아래 Git 상태는 인수 문서 변경 전 기준이며, 기능 계약은 실제 코드와 루트 AGENTS.md가 정본이다.

## 역할과 실행 규칙

| 역할 | 모델 / 추론 노력 | 책임·호출 경로 |
| --- | --- | --- |
| 총괄 | GPT-6 Astra | 우선순위, 작업 분해, 의존성·파일 소유권, 리뷰 판정, 통합 검증과 완료 보고 |
| 보조 검토 | Claude Fable 5.1 | 기획·구현의 필요한 경계 검토. 로컬 Claude Code CLI에서 `claude-fable-5-1` 지정 |
| 구현 | Claude Opus | 복잡한 서버 계약·상태 전환·보상 등. 로컬 Claude Code CLI 사용, 실제 응답 모델 식별자 확인 |
| 구현 | GPT Luna Max | 범위가 명확한 독립 구현·UI·관련 테스트. `gpt-5.6-luna`, 추론 노력 `max`, Codex 서브에이전트 |

Astra 계획 → 필요한 경계만 Fable 검토 → Astra 확정 → Opus/Luna 구현·관련 테스트 → 필요한 변경만 Fable 리뷰 → Astra 판단·통합.
구현자와 검토자를 가능한 한 분리하고, 리뷰 의견은 근거·심각도·재현 조건을 보고 Astra가 채택한다.
마이그레이션·지갑/원장·소켓 계약·권한/정답 누출·보상 reconcile·MTT 수명주기 변경은 Fable 독립 검토 대상이다.
Astra가 직접 구현한 경우에도 동일하며, Luna의 기능 접근을 일률적으로 금지하는 대신 Astra가 범위와 검토 강도를 정한다.
지정 모델을 호출할 수 없으면 해당 제약을 알리고 그 모델이 필요한 배정만 보류한다. 다른 모델을 같은 이름으로 표시하지 않는다.

- 총괄 외 동시 작업자는 **최대 2명**이며 CLI 검토자도 포함한다. 세 구현/검토 역할을 모두 동시에 실행하는 뜻이 아니다.
- 구현은 별도 worktree·파일 소유권으로 분리한다. 공유 DTO·스키마·마이그레이션은 담당자 한 명이 먼저 확정한다.
- 작업자는 관련 테스트만 `--maxWorkers=2`; Astra는 의미 있는 통합 배치마다 전체 Vitest `--maxWorkers=4` 1회와 build/lint/tsc를 수행한다.
  전체 검사와 작업자 테스트는 겹치지 않는다. junction worktree 제약으로 build는 main 통합 후 수행하고 실패 시 완료 보고를 보류한다.
  변경·실패·미해결 위험이 없다면 검증을 반복하지 않는다. GPU 생성 워커는 1개이며 배치 인계에 소유자를 기록한다.
- 검증 후 커밋·main ff 통합. **push/deploy는 사용자 지시 때만** 한다. 이미 완료된 기능을 새 개발 범위로 다시 잡지 않는다.
- 문서 변경이 현재 앱의 모델을 전환하지는 않는다. 확인 당시 로컬 Codex 기본 설정은 `gpt-6-astra` / `high`였다.
  Luna `max`는 해당 서브에이전트에 별도로 지정한다. Opus는 이전 R4/R5 기록의 `claude-opus-5`를 참고하되 다음 호출 결과로 확정한다.
  작업 인계에는 담당 모델·추론 노력·결과 커밋·검사 결과를 함께 기록한다.

이번 Luna 호출은 `collaboration.spawn_agent`에 `model: "gpt-5.6-luna"`, `reasoning_effort: "max"`, `fork_turns: "none"`을
명시하고 필요한 파일·완료 조건만 전달했다. Fable은 `claude -p --model claude-fable-5-1 --effort high --output-format json`
경로로 읽기 전용 검토했으며 결과의 `modelUsage` 키와 `canonicalModel` 모두 `claude-fable-5-1`, `is_error: false`를 확인했다.

## Git와 운영 배포 대조

| 구분 | 확인 결과 |
| --- | --- |
| 로컬 main | `bf357b0987467fe2d4e783a26cdbc9479f33abc7`, 인수 시작 시 미커밋 변경 없음 |
| GitHub main | `d8a2cd87ea0308da45202af25438f7b79c316d2d` — `git ls-remote origin refs/heads/main`으로 직접 확인 |
| 원격보다 앞선 커밋 | `57eb133` 아트 제작 가이드, `bf357b0` 대화 씬 스프라이트 액자·상단 클리핑 제거 |
| 마지막 배포 소스 | 기존 배포 기록상 `57ba40f`; `d8a2cd8`은 그 배포를 기록한 문서 커밋 |
| 실제 Fly 릴리스 | **v87**, complete, 2026-09-06 15:26:06 KST 생성 |
| 실제 머신 | `48ed666a50d2e8`, nrt, started, health check passing, 1대 |
| 이미지 | `registry.fly.io/poker-doku:deployment-01M1TP6Y3T3RGJMAZ16N6KWK8M` |
| 공개 응답 | `https://poker-doku.fly.dev/` HEAD 200, `/healthz` GET 200·`{"ok":true}` |

Fly 릴리스의 이미지 태그에는 Git SHA가 없다. 배포 소스 SHA는 기존 인계 기록에서 확인했고, 현재 Fly 이미지/버전은 CLI로 확인했다.
스프라이트 수정은 v87 이후 로컬 커밋이므로 현재 운영에는 포함되지 않는다.

## 완료된 개발

- **기본 게임·운영**: 6-max 캐시, Sit & Go, 재접속·자리비움·칩 정산, 프로필·경제 SQLite 영속, 핸드 기록, 관리자 UI.
- **수련 R1~R4**: 4막·Ch1~12 연결. 실패 재도전, Ch7 가면 퀴즈, Ch8 리버 리딩, Ch9~11 고급 수련과 MDF/SnG 드릴,
  Ch12 실제 6인 졸업 SnG, 순위 영수증·졸업 대결만 재도전·검은띠 자격까지 구현됐다.
- **R5 보너스 CG**: 사용자 승인 50/50, WebP 50 + MP4/WebM 100, 보상 카탈로그·레벨/인연 해금·기록실·인연 탭·결산·표시 설정 연결.
  DB 마이그레이션 v39. R4와 R5는 v87 배포 범위다.
- **MTT**: 운영자 개설·디렉터·wallet·영속 예약·레이트 레지·복구/정산 구현은 존재한다.
  공개 로비 노출은 `PUBLIC_MTT_ENABLED` 기본 false로 보류 중이며, 구현 완료와 공개 출시를 구분한다. 아레나도 Fly 설정상 비활성이다.
- **로컬 추가 수정**: `CharacterImage.frameless`와 ScenePlayer 적용으로 대화 캐릭터 뒤 액자·머리 클리핑 제거.

## 검증 근거와 남은 확인

- **과거 통합 검증**: R5 인계 §5의 전체 Vitest 224파일·2,794테스트, build/lint/tsc 통과 기록.
  이번 인수에서는 전체 검사를 재실행하지 않았으며, 이를 현재 HEAD 전체 통과라고 주장하지 않는다.
- **이번 실행**: `npx vitest run src/components/characters/CharacterImage.test.tsx --maxWorkers=2` — 1파일·5테스트 통과.
  원격 SHA·Fly status/releases·홈페이지/healthz를 직접 확인했다.
  Luna Max 읽기 전용 대조에서 `chapters/index.ts`의 Ch1~12, `rewards/bonus-cg.ts`의 10명×5장,
  `src/server/persistence/migrations.ts` v39의 50행, 보너스 WebP/MP4/WebM 각 50파일 및 영상 매니페스트를 확인했다.
  Fable 검토에서는 배포 SHA/로컬 HEAD 구분, 독립 검토 경계, 전체 테스트 직렬화, main 빌드 위치, 모델 추적을 채택했다.
  Luna 기능 범위를 영구 제한하거나 모든 과거 검사를 다시 실행하자는 확대 해석은 채택하지 않았다.
- **우선 QA**: 보너스 CG 전면 탭 루프 재생과 인연 탭 실제 표시. 기존 자동화는 백그라운드 탭에서 canplay 폴백이 발생해 정지 CG만 확인했다.
  미배포 frameless 수정은 다음 배포 후보에 포함하되, 실제 대화 씬의 PC/모바일 시각 확인을 먼저 한다.
- **잔여 플레이 검증**: 리딩/체크레이즈 기회 빈도와 체감 길이의 실제 평균 측정. Ch8 S 전용 CG는 과거 잔여 후보이므로
  현 보상 매핑과 자산 공급 여부부터 확인하고 자동으로 신규 아트 제작을 시작하지 않는다.
- **후순위 후보**: 하드 모드, 파트너별 Ch1 변주, 2막 질문권, 추가 의상, 비참가자 관전, 한 세션 멀티테이블, 추가 계정 연동.
  MTT 공개 재개는 별도 완주·복구/정산 검증과 사용자 판단이 필요하다.

## 별도 worktree 보존

main이 깨끗하다고 모든 worktree가 깨끗한 것은 아니다. 추적 파일 검사에서 다음 미커밋 수정이 확인됐다.

- `.worktrees/art-library-pilot/scripts/art/poker-doku-library-qwen-manifest.json`
- `.worktrees/tournament-recurrence-policy/vitest.config.ts`

일부 옛 worktree에는 main에 직접 포함되지 않은 커밋도 있다. 재작성·선택 적용 여부까지 대조하지 않았으므로
이를 미완성 기능이나 미병합 필수 작업으로 단정하지 않는다. 기존 worktree를 삭제·정리·자동 병합하지 않는다.

## 다음 세션 시작

이 문서와 현재 Git 상태부터 읽는다. R4/R5 재구현 대신 남은 QA와 미배포 UI 수정의 검증 범위를 정하고,
사용자의 다음 기능 지시가 있으면 Astra가 Opus/Luna의 독립 구현 범위와 Fable 검토 시점을 배정한다.
과거 `2026-09-06-fable-orchestration.md`의 R4 미착수와 `r4-complete-handoff.md` §4의 R5 구현 예정은 현재 상태가 아니다.
