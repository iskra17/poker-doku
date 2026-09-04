# 실패 씬·스파링 재도전 실행 계획
승인 설계: ../specs/2026-09-05-story-failure-retry-design.md
1. coordinator 회귀: 실패 씬→고정 0보상 결산, 성공 에필로그 차단, phase 보호.
2. checkpoint·terminal 분리와 TTL, 재도전 복사·새 진입·중복 ACK·거절/정리 회귀.
3. strict payload와 소켓 storyStart/소유권/busy/resync 계약 및 실제 소켓 회귀.
4. store ACK·결산 CTA·실패 ScenePlayer 연결. 실패 시 화면 보존.
5. 관련 Vitest 파일, tsc --noEmit, lint 실행. 전체 suite/build는 통합 담당.
6. 변경/검증 리뷰 후 이 브랜치만 커밋. main merge/push/deploy 금지.

## 구현·검증 기록
- 실패 스파링에서 결과를 고정하고 failure-scene을 재생한다. 실패 요약은 결산에 포함하고 checkpoint는 앞서 성공한 live 결과만 보존한다.
- terminal 맵은 활성 런에서 분리한다. 10분 만료 스윕·허브 닫기·새 런·프로필 폐기·종료 정리를 연결했다.
- 새 소켓 요청은 failedRunId만 받으며 서버 checkpoint로 새 run/방/스택을 만든다. 동일 활성 retry 재전송은 같은 runId를 반환한다.
- 실패 ScenePlayer 완료 콜백은 1회이므로 오프라인 복구용 [결산 보기]를 함께 제공한다. 결산의 재도전/처음부터/허브로는 ACK 대기 중 잠긴다.
- TDD: 실패 분기/재도전/TTL 3건, payload/store 2건, 만료 terminal 닫기, 실패씬 choice 검증에서 RED를 확인한 뒤 GREEN.
- 관련 Vitest: coordinator 32, adapter 25, payload 15, store 9, socket story 11 = 92건. 실제 소켓에서 파산→실패→terminal→resync→새 방 재도전→중복 요청을 확인했다.
- npm run lint: 오류 0. 중간 신규 미사용 import 경고는 제거하고 변경 파일 eslint 재검사 통과. 기존 engine.ts:1316 경고는 본 범위 밖.
- npx tsc --noEmit --incremental false 및 git diff --check 통과.
- npm ci 완료. 환경 Node 22.14.0은 package 요구 >=22.16.0 <23보다 낮아 EBADENGINE 경고가 있었으나 설치/검증 완료.
- 전체 suite/build·실기기 브라우저·Fable 사후 검토는 총괄 통합 단계에 남긴다. GPU/배포/다른 작업트리 변경 없음.
