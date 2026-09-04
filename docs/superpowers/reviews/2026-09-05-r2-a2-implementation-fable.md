# R2 / A2 implementation review — actual Fable 5.1, xhigh

Actual model: claude-fable-5-1. Review completed 2026-09-05. This is the final result, without internal reasoning. Root follow-up decisions are tracked separately.

## 결론

Ch7 가면무도회와 A2 아트 큐 모두 병합을 막는 결함은 찾지 못했습니다. 정답·정체 누출, 미응답 우회, 필수 4문·3정답 면제, 중복 제출, unknown 자동 재제출, 승인 바이트 불일치 export는 모두 코드와 테스트로 막혀 있음을 확인했습니다. 아래 발견은 전부 낮은 심각도이며 후속 수정 후보입니다.

리뷰 기준은 43b6462였고, 리뷰 중 HEAD가 86ac82a로 이동했습니다. 추가 커밋은 문서, 아트 자산, 공용 Modal 초점 보정, MasqueradePanel의 Modal 래핑뿐이며 서버 Ch7 코드와 `scripts/art/library` 파이썬 모듈은 바뀌지 않았습니다.

## 발견 사항 (우선순위순)

1. **퀴즈 선택지 비활성화가 클라이언트 시계에 의존** (낮음~중간, UX 견고성)
   - 위치: `src/components/story/live/MasqueradePanel.tsx:32` 의 `disabled={... now >= quiz.expiresAt}`. `now`는 브라우저 `Date.now()`, `expiresAt`은 서버 epoch입니다.
   - 영향: 단말 시계가 서버보다 30초 이상 빠르면 네 문항 모두 즉시 비활성화되어 전부 무응답으로 실패합니다. 시계가 느리면 서버 마감 뒤에도 클릭이 되고 영수증은 accepted인데 기록은 무응답이라 혼란이 생깁니다. 서버가 권위라 보안 문제는 아닙니다.
   - 수정 제안: 서버가 `remainingMs`를 함께 내려 주거나, 클라이언트는 story-update 수신 시각 기준으로 남은 시간을 계산하고 만료 비활성화는 서버 판정에 맡깁니다.

2. **보드 스트레이트·플러시 위 넛 카드가 약한 핸드로 분류** (낮음, 평가 정확도)
   - 위치: `src/lib/story/opponent-response.ts:34` 부근. 같은 족보 등급의 개선을 키커 개선으로 간주해 제외합니다.
   - 재현: 보드 5 6 7 8 9에 히어로 T2, 또는 보드 A K 7 4 2 하트에 히어로 Qh. `opponentResponseStrength`가 topPairOrBetter=false를 반환하고, 정직파 상대 50% 벳에 콜하면 "약한 핸드 폴드" 규칙이 나쁜 결정으로 채점합니다. 프로브 테스트로 확인했습니다.
   - 영향: 5장 보드 스트레이트·플러시는 드물어 실전 빈도는 낮지만, 올바른 플레이가 감점됩니다.
   - 수정 제안: 같은 등급이면서 스트레이트 이상으로 개선된 경우는 미측정(null)으로 두거나 강한 핸드로 취급합니다.

3. **히어로 본인의 리버 올인 액션은 평가 제외** (낮음, 비대칭)
   - 위치: `src/server/story-opponent-review.ts:16`. `hasAllIn`을 히어로 자신의 액션 판정 전에 세팅합니다.
   - 재현: 콜링 스테이션 헤즈업 리버, 히어로 톱페어로 체크하면 warn, 레이즈하면 good, 올인 버튼으로 밸류벳하면 판정 없음. 프로브로 확인했습니다.
   - 영향: 옳은 결정이 점수를 못 받는 비대칭. 통과 조건상 불리하게만 작용하지는 않습니다.
   - 수정 제안: 상대의 선행 올인만 제외하고 히어로 본인 올인은 `raise`와 같은 경로로 평가합니다.

4. **질문이 살아 있는 상태의 room-lost 후 이어하기 ack가 거절** (낮음, 도달 어려움)
   - 위치: `src/server/story-live-adapter.ts:257-265`. `openRoom`이 성공해 방이 다시 열려도 pending 질문이 있으면 `resumeQuiz`가 action-rejected를 돌려줍니다.
   - 재현: 프로브에서 질문 발급 직후 `disposeRoom` 후 `resume` 호출. 방은 열리고 hold quiz 상태에 질문도 보존되지만 ack는 실패입니다. 실제로는 grace 60초가 30초 마감보다 길어 도달하기 어렵습니다.
   - 수정 제안: 방을 새로 연 직후 pending 질문이 있으면 ok를 반환합니다.

5. **A2 export 크래시 복구 경로가 임시 .pending 파일을 남김** (낮음, 위생)
   - 위치: `scripts/art/library/review.py:58-63`. `target.exists()` 복구 분기가 조기 반환하며 `.<이름>.art-<id>.pending`을 지우지 않습니다.
   - 재현: 기존 테스트와 같은 os.link 직후 크래시 후 재실행. 프로브에서 게임 자산 폴더에 임시 파일 1개가 그대로 남는 것을 확인했습니다. DB 영수증은 complete로 정상 복구됩니다.
   - 수정 제안: 복구 분기에서도 동일 임시 파일을 unlink합니다.

## 참고 사항 (결함 아님)

- 운영자 스킵을 퀴즈 완료 전에 실행하면 Ch7 라이브 스텝은 실패 경로로 갑니다. 테스트가 이를 명시적으로 고정했고 스펙과 일치합니다. 4문 답변 후 스킵은 통과합니다. QA 절차에 반영이 필요합니다.
- A2 모델 재해시 비용은 인계 문서 기준 전체 270초 중 217초로, 성능 항목입니다. 정확성 문제는 아닙니다.
- A2 매니페스트의 target_root는 현재 worktree 절대 경로에 고정되어 있습니다. worktree가 사라지면 해당 원장의 export는 거부됩니다. 설계상 의도이지만 운영 시 주의가 필요합니다.
- 영상 경로는 ffmpeg lavfi 합성 클립과 comment 태그로만 검증되었습니다. 리뷰 중 추가된 H3 레시피도 "real video metadata verification pending"으로 스스로 표기하고 있어 과장 주장은 없습니다.
- `os.link` 기반 export는 동일 NTFS 볼륨을 전제하며 그 외 환경에서는 안전하게 실패합니다.
- 시험 모드 Ch7 통과는 라이브 퀴즈 없이 첫 완주 보상과 칭호를 지급합니다. 스펙이 허용한 경로입니다.

## 검증된 긍정 계약

- 정체 격리: getPublicState가 personalityId를 제거하고, 봇 id는 randomUUID, 아바타는 story-mask입니다. 가면 세션은 botThoughts를 비우고, botQuip은 가면 봇을 AI 대사 전에 차단합니다. hand-start·hand-end 로그와 hand_history·table_hand 타입에 성향 필드가 없습니다. 공개 전 뷰 JSON에 네 성향 id가 없음을 테스트가 단언합니다.
- 퀴즈: opaque UUID quizId, 최초 답 불변과 동일 영수증 반환, 마감 후 답은 무응답, 다른 runId·모르는 quizId·타 프로필 거절, 파서는 키 집합 고정과 0..3 경계.
- 마감·오프라인: 30초 절대 타이머가 room-lost에도 유지되고, 오프라인이면 새 문항을 발급하지 않으며 resume도 거절됩니다. 온라인 복귀 후 명시 resume만 다음 문항을 냅니다. 프로브로 12핸드 종료 시점 오프라인 케이스까지 확인했습니다.
- 공개 시점: `afterQuizAnswer`와 `resumeQuiz` 모두 answered가 4일 때만 정체를 바꾸고 피드백을 노출합니다. 목표 진행도도 4답 전에는 정답 수를 0으로 감춥니다.
- 필수 목표: extras 누락·부분 발급·부분 응답은 achieved=false이며 null이 되지 않습니다. 운영자 강제 요약도 가면 세션에서는 목표를 채우지 않습니다.
- 랜덤 덱 보존: 스파링은 ScenarioDeck을 만들지 않습니다.
- 기회 판정: 리버 헤즈업만, 보드 전용 강도 제외, 강한 made의 밸류 레이즈는 블러프캐치 채점 제외, 다중 상대·과대 사이즈·선행 올인 제외. 기회 0은 미측정으로 통과 판정에서 빠지되 조기 종료는 막습니다.
- 커리큘럼·보상: 3막 부분 완료는 파란띠 유지, Ch7 해금은 2막 3챕터 완료 필요, 카탈로그 4항목과 v35 DB 패리티 테스트 통과, 첫 완주 XP 250,000과 비비안 100,000 일치, 미등록 의상은 기본 아트로 폴백.
- A2: 전역 msvcrt 잠금이 다른 루트와 localhost 별칭을 함께 막습니다. intent와 submitting은 POST 전에 커밋됩니다. 설치된 ComfyUI 소스에서 queue 튜플 index 3이 extra_data이고 history.prompt가 같은 튜플이며 post_prompt가 사용자 extra_data 키를 보존하고 SaveImage가 extra_pnginfo를 PNG 텍스트로 쓰는 것을 확인했습니다. history 경로 탈출, 잘못된 PNG 메타, 중복 history는 각각 failed 또는 unknown으로 고정되고 unknown은 해당 job만 막습니다. pause·외부 큐·3회 상한·정확한 바이트 승인·무덮어쓰기·멱등 export·영수증 복구가 테스트로 성립합니다.

## 실행한 테스트

| 구분 | 명령 | 결과 |
|---|---|---|
| Python 전체 | `python.exe -B -m unittest discover -s scripts/art/library/tests -v` | 62개 실행, 원본 전부 통과, 실패 1개는 내 프로브의 잘못된 가정 |
| Python 프로브 재실행 | `python.exe -B scripts/art/library/tests/test_fable_probe.py -v` | 31개 통과 |
| Vitest 경량 배치 12파일 | `npx vitest run --maxWorkers=2 ...` | 136개 통과 |
| Vitest 중량 배치 6파일 | 어댑터·실소켓 퀴즈·스토리 소켓·room-manager story·DB 패리티·프로브 | 259개 통과 |
| ESLint 6파일 | MasqueradePanel, story-masquerade, story-opponent-review, opponent-response, story-live-adapter, ch07 | 경고 없음 |
| `git diff --check` | 95328ed..HEAD 소스 범위 | 이상 없음 |

프로브 파일 두 개는 생성 후 삭제했으며 트리는 86ac82a 기준으로 깨끗합니다. 삭제한 파일은 `src/server/fable-probe-ch7-review.test.ts`와 `scripts/art/library/tests/test_fable_probe.py`입니다.

## 검증하지 않은 표면

- 브라우저·모바일 실제 흐름과 86ac82a의 Modal 초점 변경. 해당 커밋의 계획 문서는 자체 테스트 통과를 기록하고 있으나 제가 재실행하지는 않았습니다.
- 전체 tsc, 전체 Vitest, build. 커리큘럼 인자 누락 호출은 grep으로 전 호출처를 확인했습니다.
- 실제 GPU·Comfy 큐, 실제 H3 영상 메타데이터, 시험 모드 Ch7 경로, hold 10분 스윕이 퀴즈 중 겹치는 경우, 서버 재시작 중 퀴즈 상태.

## 병합 판단

병합 가능합니다. 후속으로 1번 클라이언트 만료 게이트와 5번 임시 파일 정리를 권합니다. 2·3·4번은 선택적 정밀화입니다. 최종 결정은 총괄이 합니다.
