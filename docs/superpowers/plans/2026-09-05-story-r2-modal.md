# Ch7 모바일 모달 보정

총괄 승인 범위: 브라우저 QA에서 재현한 테이블 영역 잘림과 모달 초점 탈출 두 건을 수정한다. 서버 퀴즈·보상 계약은 변경하지 않는다.

1. 공용 `Modal`에 기본 true인 `dismissible`과 내용 전환용 `contentKey`를 추가한다. false일 때 닫기 버튼·Escape·배경 클릭을 막는다. 기존 body portal과 화면 높이 제한을 재사용한다.
2. 최초/질문 전환 시 첫 유효 컨트롤 또는 dialog에 초점을 두고 내부 스크롤을 0으로 복원한다. Tab/Shift+Tab 순환, 초점 외부 이동 및 비활성 버튼으로 인한 탈출을 보정한다. 종료 시 원래 초점으로 복원한다.
3. `MasqueradePanel`의 퀴즈/피드백만 공용 Modal을 사용한다. 관찰 노트 details는 유지하고 표시 타이머만 0~30초로 제한한다.
4. 초점·닫힘 유틸의 회귀를 먼저 실패시킨 뒤 구현한다. 관련 Vitest(maxWorkers 2), tsc, 변경 ESLint, diff check 후 커밋한다. 전체 검사와 320/390/1280 브라우저·미션 모달 검증은 총괄이 수행한다.

## 구현 및 검증 결과

- `Modal.tsx`: 기본 닫힘 유지, 비해제 모달의 focusin/disabled 변경 감시, 질문 키 기반 최초 초점·내부 스크롤 복원. 화면 높이 제한·body portal 재사용. `StoryOverlay` 수정 없이 테이블 clipping을 벗어난다.
- `modal-a11y.ts`: 숨김/disabled 컨트롤 제외, 초점 시작/복구와 비해제 Escape 규칙. pending/offline에 유효 버튼이 없어지면 dialog에 초점을 둔다. 유효 초점은 유지하며 복구 때문에 내부 스크롤을 초기화하지 않는다.
- `MasqueradePanel.tsx`: 퀴즈와 피드백만 비해제 Modal. 질문 ID/피드백 전환 키로 갱신하며 250ms 타이머 표시는 0~30초. 원래 서버 deadline·응답·계속 요청을 유지한다.
- TDD: 최초 4개 실패(Escape/초점 API), 추가 2개 실패(스크롤 260→0, disabled tabindex 제외)를 확인한 뒤 모두 통과.
- `npx vitest run src/components/ui/modal-a11y.test.ts src/server/story-masquerade.test.ts src/server/socket-handler.story-quiz.test.ts src/lib/store/story-store.test.ts --maxWorkers=2`: 4파일 21개 통과.
- `npx tsc --noEmit`: 통과.
- `npx eslint src/components/ui/Modal.tsx src/components/ui/modal-a11y.ts src/components/ui/modal-a11y.test.ts src/components/story/live/MasqueradePanel.tsx`: 통과.
- `git diff --check`: 통과. 전체 suite/build, 브라우저, 서버 기동은 수행하지 않았다. 유틸 테스트는 DOM 경계를 대역으로 검증하며 실제 레이아웃·키보드·기존 미션 모달은 총괄 브라우저 확인이 남는다.
