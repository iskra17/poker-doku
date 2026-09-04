# Ch7 실행 계획
계약: ../specs/2026-09-05-ch7-live-quiz-design.md
1. 필수 퀴즈 4답/3정답, 정답 비공개 영수증, 상대 대응 순수 평가 및 고정 4막 커리큘럼 회귀.
2. 단일 가면 스파링 세션 관찰→퀴즈 hold→일괄 공개→대응 대결. online/deadline/room-lost/타이머 소유권.
3. coordinator·strict socket·store·퀴즈/관찰 UI 배선과 중복/타프로필/재접속 실제 소켓 회귀.
4. Ch7 수기 콘텐츠와 v35 보상 카탈로그, 부분 막 승급 금지, DB parity.
5. targeted Vitest --maxWorkers=2, tsc, 변경파일 eslint, diff 검사. 전체suite/build/Fable 사후검토는 총괄.
6. 전용 브랜치 commit/clean 보고. main/push/deploy/아트/GPU 변경 금지.

## 구현·검증 완료
- 서버 소유 CSPRNG 4가면 배정과 opaque 질문 ID/30초 deadline, 정답 없는 ACK 영수증, 4답 잠금 후 일괄 정체 공개.
- 12핸드 관찰/명시 퀴즈 hold/공개 후 최대 10핸드, 필수 퀴즈 4응답·3정답, 실제 대응 기회만 평가. 기회 0은 대응 목표 미측정이며 퀴즈를 면제하지 않는다.
- 재접속/최신 소켓 소유권 교체는 질문과 deadline을 보존한다. 오프라인은 기존 질문만 만료하며, 방 재생성 후 명시 계속하기로 다음 질문을 발급한다.
- Ch7 전용 강도 판정은 board-only 투페어와 키커만의 개선을 제외한다. 강한 made의 레이즈는 좁은 블러프캐치 채점에서 제외한다. 기존 일반 목표 판정은 바꾸지 않았다.
- 고정 4막 커리큘럼 인자를 모든 소비자에 전달하고, Ch7만 출시된 상태에서 갈색띠/3막 보상이 열리지 않게 했다. v35 Ch7 보상 4개를 카탈로그와 DB에 함께 등록했다.
- 실제 Socket.io 회귀는 7드릴을 모두 풀고 실제 엔진 12+10핸드를 진행한다. 타이머만 가속하며 스텝/핸드 수/통과 조건 단축이나 운영자 스킵을 사용하지 않는다. 테스트 운전자는 정상 액션 경로로 폴드해 대응 기회 0 경계를 재현한다. 별도 어댑터 회귀는 실제 봇 AI를 구동한다.
- 관련 17파일 검사: 379개 중 DB 최신 버전 기대값 2개를 v35로 수정한 뒤 DB 188개 전부 통과. 다른 16파일 191개 통과. 마지막 어댑터/실제 소켓 재검증 29개 통과. 모든 Vitest 실행은 `--maxWorkers=2`.
- `npx tsc --noEmit`, 변경 TS/TSX 전체 ESLint, `git diff --check` 통과.
- 독립 `npm ci --no-audit --no-fund` 완료. 로컬 Node 22.14는 package engines >=22.16 <23 대비 경고가 있지만 위 검사는 통과했다.
- 전체 suite/build/390px·데스크톱 브라우저 최종 QA/통합은 총괄 담당. 미존재 아트는 AVAILABLE로 등록하지 않았다. main/push/deploy/GPU 작업은 하지 않았다.
