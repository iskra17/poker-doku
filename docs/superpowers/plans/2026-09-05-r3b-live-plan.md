# R3b Ch8·9 라이브 리딩 구현 계획

실행: Astra Medium, 승인된 마지막 총괄 계약 우선. TDD/계획 실행/완료 검증을 적용하며 추가 에이전트·승인 대기는 하지 않는다.

- [x] 공개 입력만 받는 `reading-policy.ts`를 작성한다. river rangeCombos 전수 equity/콜 필요승률/10콤보·5%p·올인·멀티웨이 경계를 독립 계산으로 검증한다.
- [x] 서버 `story-reading-quiz.ts`를 작성한다. room/hand/actionSeq 키, 최대2문, 영수증 멱등, 30초 질문→10초 해설, invalidated 분모 제외를 검증한다.
- [x] RoomManager의 optional story beforeHeroTurn/onTurnStateChanged/isTurnHeld/resumeHeroTurn과 액션/타임뱅크 가드를 추가한다. 자동 액션과 일반 게임은 기존 경로다. adapter의 turnHold는 핸드 경계 hold/sweep과 분리한다.
- [x] adapter/coordinator/DTO/store/UI에 reading 디스패치를 연결한다. Ch7 deadline/sample과 공용 monotonic clock을 유지하며 공용 portal Modal의 초점 보호를 사용한다. 모든 drop/finish/roomloss/key 변경 타이머를 정리한다.
- [x] 새 목표 opt-in finalOpportunityCap과 공개 리플레이 기반 구미 콜/초코 과도콜/루나 체크레이즈 대응을 구현한다. 기회0=null, 강한 made 강제폴드 금지, 기존 Ch1~7 판정 유지.
- [x] Ch8·9 전체 씬/레슨/7·8드릴/각2프리셋/12·15핸드/실패씬/에필로그/결산을 작성한다. Ch9 CG4개는 아트 담당의 타입 등록을 기다리며 자기 등록하지 않는다.
- [x] v36 보상과 catalog parity·3막 전체 갈색띠·exam/정상/실패retry·실제 Socket.io 회귀를 검증한다.
- [x] 관련 Vitest --maxWorkers=2, tsc, 변경 ESLint, diff-check 후 commit/clean 인계. 전체 suite/build/브라우저는 총괄 담당.


## 인계 · 2026-09-05

- 기반59b532f. 아트88b4610을 의존 커밋11b7820으로 가져왔다. 총괄 통합 때 의존 커밋은 제외하고 이 계획과 구현의 마지막 커밋만 cherry-pick한다.
- Ch8/9를 등록했다. Ch8는ODDS2/COMBO2/공개레인지리버CALL3, Ch9는READ3/COMBO2/NUTS2/명시체크레이즈ACT1. 각각 2개 프리셋 연습과 원본12/15핸드 랜덤 스파링, 실패/에필로그/결산을 포함한다. Ch9의4개 씬 CG는 아트 제공 ID 그대로 사용하며 강변→계절 변화→첫눈을 대사로 구별한다.
- Ch8 리딩은 공개 hero/board/현재 기여금 가격/가정 레인지만 사용한다. 10콤보 미만·5%p 경계·올인·사이드팟·멀티웨이는 제외한다. RoomManager가 리버 턴을 별도 보류하고 액션/타임칩을 막는다. 30초 답→최대10초 해설→동일 턴 재개. 기존 coordinator/protocol/parser/store의 일반 quiz receipt와 monotonic clock 계약을 그대로 재사용했다.
- 끊김은 원래 즉시 체크/폴드를 유지한다. 방/턴 키가 바뀐 미응답은 invalidated, 이전 답 점수는 보존한다. 실제 소켓에서 takeover/resync/타프로필/중복/시간초과/방 소멸을 확인했다. Ch7 퀴즈4개·일괄 공개·오프라인 절대 deadline 회귀도 유지된다.
- 루나의 약한 원페어는 보수적으로 톱페어 미만으로 명시했다. 같은 스트리트의 루나 체크→히어로 벳→루나 레이즈만 집계한다. 강한 메이드 강제 폴드/숨은 상대 카드/승패 근거는 없다. 최종 기회 cap은 새 opt-in 목표의 final summary에만 적용한다. 0기회는 null이며 기존 목표는 완화하지 않았다.
- v36/catalog10아이템 추가. Ch8 첫칭호/500칩, S300칩. 실제 S아트가 없어서 새 CG/중복 의상은 만들지 않는 총괄 판정을 반영했다. Ch9 첫칭호/500칩/기존분석CG, S첫눈CG/300칩, 3막 완주 갈색 펠트/1000칩. 보상 CG 경로는 scene- 접두가 있는 실제 아트 매핑과 테스트로 대조한다.

## 검증 결과

- `npm ci --no-audit --no-fund`: 독립 설치. Node22.14가 선언 최소22.16보다 낮다는 기존 warning 외 도구/lockfile 변경 없음.
- 관련 Vitest23파일380개에서378통과, 기존7챕터/40보상 고정 기대값2개 실패를9챕터/동적 카탈로그 수로 수정. 수정 후 해당 범위를 포함한6파일42개 전부 통과. 새 경계1개/CG경로1개를 포함해 총382개 관련 테스트를 확인했다(같은 테스트의 중복 실행 수는 더하지 않음).
- `socket-handler.story-reading.test.ts --maxWorkers=2`:10개 전부 통과. 실제 딜/합법액션으로 리버 두 질문을 연속 출제하고 답 ACK 비공개·중복 잠금·시간초과·소유권·끊김·방 소멸을 검증. Ch8/9 full+exam 전체 드릴/스텝/핸드 수4경로, 실패/retry2경로를 포함한다.
- full 경로의 일반 완료는 0기회 미측정 계약을 검증한다. 행동 정답/오류는 공개 replay 단위 회귀로 별도 검증했다. 실패 경로는 원본 챕터의 스파링 시작 경계에서0칩을 주입한 수명주기 테스트이며, 정상 포커 플레이로 보스를 이겼다는 근거가 아니다. 운영자 스킵은 사용하지 않았다.
- 마지막 정리 변경 후 어댑터/quiz2파일31개 통과, CG경로 확인 후 catalog/reward2파일13개 통과. database 전체 마이그레이션/카탈로그 parity, 보상 영수증/인벤토리/장착뷰/첫·S중복 방지 포함.
- `npx tsc --noEmit`, 변경TS/TSX `npx eslint`, `git diff --check` 통과. 전체suite/build/브라우저는 총괄이 실행한다.

## 총괄의 통합 후 QA

1.390px/desktop에서Ch8 리딩 portal의 카드/가정레인지/옵션/시간 표시, 키보드 초점 잠금, 액션바 가림과 해설→원래 포커턴 재개를 확인한다.
2.Ch9 네CG의 실제 파일/영상 경로, 분석→강변→첫눈 시간 이동과 failScene/재도전 버튼을 확인한다. 이 작업트리에는 ignored 실제 아트 파일을 복사하지 않았다. control의 실제 scene-act3-ch09-* 파일을 사용한다.
3.갈색 펠트 preview/착용한 수련 테이블과 일반cash/SnG/MTT 기본 테마가 구분되는지 확인한다.
4.랜덤 플레이의 실제 리딩/약한 원페어 체크레이즈 기회 빈도와 체감 수련 시간은 자동 상태 경로 검사와 별도로 플레이 QA한다. Ch8 S전용 새아트는 승인된 후속 공급 과제로 남긴다.
5.Ch10~12는 이번 커밋 범위 밖이다. 다음 세션에서 기존 확정 설계의 R4 계획만 이어 간다.
