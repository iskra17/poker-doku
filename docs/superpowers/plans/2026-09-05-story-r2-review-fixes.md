# Ch7 Fable 후속 1~4 수정

기준 db9ef5c. 총괄 승인 범위만 처리하고 Python/아트·R3a는 수정하지 않는다.

1. 서버 `HandReadQuizView`에 조회 시점의 `sampledAt`, `remainingMs`를 추가한다. 발급된 질문의 절대 expiresAt·답변 불변성·30초 타이머는 유지한다. 클라이언트 store는 수신 시 `performance.now()` 표본을 별도 보관하고 단조 경과시간으로 표시한다. 동일/오래된 표본은 카운트다운을 재시작하지 않고 새 표본도 같은 질문의 남은 시간을 늘리지 않는다. 새로고침은 서버의 최신 남은 시간에서 시작한다. 선택 버튼은 pending/offline만 잠그며 만료 판정은 서버에 맡긴다.
2. evaluator의 value 비교로 실제 개선된 같은 rank straight/flush/full-house/straight-flush를 strong made로 인정한다. board-only·two-pair 키커·quads 키커 개선 제외는 유지한다.
3. 리버 현재 히어로 올인 액션을 먼저 평가하고 이후 선행 올인 플래그를 기록한다. 기존 선행 올인·사이드팟 제외와 올인콜 정규화는 유지한다.
4. room-lost에서 openRoom 성공 후 기존 pending 질문을 복원했으면 성공 ack로 끝낸다. 기존 질문 ID·deadline·답변 유지와 중복 발급 방지를 검사한다.

TDD: 각 재현을 먼저 실패시킨다. 단말 시계 ±5분, 표본 중복/재전송/재접속/새 store, evaluator 실제 족보, 현재 올인·선행 올인, 살아 있는 질문의 방 복원 테스트를 추가한다. 관련 Vitest(maxWorkers 2), tsc, 변경 ESLint, diff check를 수행한 뒤 커밋한다. 전체 suite/build·브라우저·서버 기동은 총괄 범위다.

## 완료 증거

- 최초 실패: 같은 rank 실제 개선 4개, 현재 히어로 올인콜/밸류올인 2개, 남은시간 표본 부재 1개. 표본 구현 후 room-lost 복원 성공 ack가 `action-rejected: 먼저 질문에 답해 주세요`로 실패하는 것을 별도로 확인했다. store 표본 수신 부재도 20,000ms 대신 0으로 실패했다.
- 추가 경계: 보드 88882 + AA가 쿼드 키커만 개선하는데 overpair 경로로 인정되던 사례를 재현하고 같은 보드 쿼드는 명시 제외했다. 기존 보드 전용/투페어 키커 가드는 유지한다.
- 실제 소켓: 일반 in-room resync는 game만 재전송하므로 기존 story 표본은 그대로 유지한다. 클라이언트 monotonic 경과는 계속 감소한다. disconnect/connect 전에 리스너를 등록해 초기 story 재전송을 실제 수집했고, 7초 이상 경과한 남은 시간·동일 질문 ID/절대 마감·이후 31초 오프라인 무응답을 확인했다.
- room-lost: 1번 질문뿐 아니라 이미 첫 답이 저장된 2번 질문에서도 새 방 복원 성공·기존 deadline·답변 개수·중복 답변 시 다음 질문 불변을 확인했다.
- 클라이언트: Date.now ±5분 및 실행 중 시계 역전이 표시에 영향을 주지 않는다. 동일/과거 sample은 앵커를 교체하지 않고 새 sample도 같은 문항의 시간을 늘리지 않는다. 새 store는 서버가 준 10초 잔여에서 시작하며 identity/reset/질문 해제 시 앵커를 비운다.

검사:

```text
npx vitest run src/lib/story/quiz-countdown.test.ts src/lib/store/story-store.test.ts src/lib/store/story-wallet-refresh.test.ts src/lib/story/opponent-response.test.ts src/server/story-opponent-review.test.ts src/server/story-live-adapter.test.ts src/server/story-masquerade.test.ts src/server/socket-handler.story-quiz.test.ts src/server/story-run-coordinator.test.ts --maxWorkers=2 --silent
9 files / 100 tests passed
npx tsc --noEmit: passed
npx eslint <변경 TS/TSX 14파일>: passed
git diff --check: passed
```

독립 `npm ci` 설치. 전체 suite/build·별도 서버 프로세스·브라우저·GPU는 실행하지 않았다. 수신 기준 표시는 네트워크 전달 지연만큼 서버 마감과 차이가 있을 수 있으나 클릭을 막거나 서버 deadline을 연장하지 않는다. 최종 브라우저 확인은 총괄 범위다.
