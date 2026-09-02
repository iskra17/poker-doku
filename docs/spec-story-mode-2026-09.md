# Poker Doku 「수련 스토리 모드」 — 기획서 + MVP 구현 계획

> 작성 2026-09-01. 탐색(코드 2기) → 설계(게임 기획 1기·아키텍처 1기) → 사용자 결정 3건 반영 → 취합.
> **개정 2026-09-02** — Fable 5.1 전체 검토(main 8fa4ea8 코드 대조) 반영 19건. 변경 요지는 문서 끝 **Part R**. **개정 2026-09-03** — v72 플레이 피드백 3건(용어·비선형·미션형/시각 차별화) 반영, 요지는 **Part S**(본문과 어긋나면 Part S 우선). 기획이 인용한 라인 번호는 HEAD 8fa4ea8 기준(이후 커밋 없음 확인).
> 한 줄: **"계산을 손에 익히면, 그녀가 웃는다."** 신입 수련생이 미야코 도장에서 백띠→검은띠 12챕터를 밟는다.
> 챕터의 척추는 **히로인이 출제·해설하는 수련 문제(드릴)** 이고, '연습' 태그 프리셋 핸드로 손에 익힌 뒤, 짧은 랜덤 스파링/보스전으로 검증한다.

## Context

- 캐시/SnG/MTT 멀티플레이는 안정화되었지만 **원래 취지 "싱글 미연시(갸루게) 감성으로 포커를 배운다"가 게임 안에서 보이지 않는다** (사용자 진단).
  현재 싱글 경험 = Practice Dojo(봇 방)에 [첫 수련] 원탭 입장 → 코치마크 3장 → 그냥 캐시 핸드. 서사·학습 곡선·관계 진행 전부 부재.
- 자산은 풍부: 미야코+봇 16명 전원 backstory, 스타터 6명 표정 6종+인연 CG 4장, HUD 스탯 봇 AI(캐릭터=뚜렷한 상대 유형), 인연/도장 Lv·미션·스트릭, VN 연출 부품(BondSceneModal 타자기·쇼케이스 스프라이트·BGM 4트랙).
  빠진 것은 **이들을 "배우면서 가까워지는" 루프로 엮는 스토리 도메인**(챕터·씬·선택지·플래그·드릴·저장 — 전부 0. `'story:'` 훅은 dialogue-manager 주석뿐).
- **사용자 확정 결정(2026-09-01~02)**: ① 프리셋 덱 허용 — UI '연습' 태그 스텝 한정, 스파링·실전은 CSPRNG ② **"꼭 대결이 아니라" 오즈·에퀴티·콤보 계산 등 기본기를 자연스럽게 배우고 퀴즈로 맞혀 나가는 방식** → 드릴을 1급 메커닉으로 ③ 스타터 6명 = 히로인 루트(교사), 나머지 10명 = 스파링 상대/조연(마이그레이션 불필요) ④ 산출물 = 기획서 + MVP(1막 3챕터) 구현 계획, 승인 시 worktree에서 구현 착수 ⑤ **git 커밋은 단계별로 잘게** — 언제든 갈아엎을(revert/reset) 수 있는 커밋 단위 유지 ⑥ **이미지 에셋은 gpt-image-2(codex)로 제작**, 대량 수요 시 **RTX 5090 로컬 캐릭터별 LoRA 학습**으로 생산.
- 유지할 기존 원칙: 카드 조작 금지(실전), 에너지 제한·칩 리더보드·가챠·관계 리셋 금지, 익명 닉 직접 호명 금지(캐릭터별 호칭), 전원 애인화 금지, 스킵 불가 연출 금지, 성장 보상은 게임 수치 불변, 일일 미션은 실전 행동 강제 금지(**스토리 샌드박스 안의 학습 목표는 예외 — 경계를 UI·코드에 명시**), 실전 모드를 스토리로 하드 게이트 금지, 핵심 관계 대사·드릴 정답/해설은 수기(AI는 조연 잡담 애드립만).

---

# Part A. 게임 기획서

## A1. 디자인 필러

| # | 필러 | 뜻 | 금지 예 |
|---|---|---|---|
| P1 | **배움이 곧 인연** | 모든 개념은 그 개념을 체화한 히로인이 출제·해설. 정답이면 기뻐하고 오답이면 자기 말투로 풀어준다. 풀이 시간 = 함께 있는 시간 | 얼굴 없는 정답 팝업 |
| P2 | **계산은 손으로** | 보기 찍기가 아니라 숫자 입력(아우츠·%·콤보 수), 2·4의 법칙 추정 → 정확값 확인. 생성기가 무한 출제하니 암기 불가, 원리만 남는다 | 같은 문항 반복 |
| P3 | **문제 → 연습 → 실전, 3단 검증** | 정지 문제로 개념 → '연습' 태그 프리셋 핸드로 손 → 랜덤 스파링/보스전으로 진짜. 프리셋은 반드시 '연습' 표식 | 태그 없는 프리셋, 스파링 카드 조작 |
| P4 | **틀려도 그녀는 곁에 있다** | 인연 XP는 참여·완료에 고정. 성적(S/A/B)·콤보·퍼펙트는 도장 XP·뱃지에만. 스킵 가능·재도전 무제한·실전 하드 게이트 없음 | 오답 시 호감 감소, 스토리 미완 시 캐시 잠금 |

## A2. 세계관 · 로스터 · 띠

| 위치 | 인물 | 역할 · 호칭(→플레이어) |
|---|---|---|
| 안주인·진행자 | 미야코(딜러) | 룰·핸드 랭킹(Ch1)·SnG 구조(Ch12) 출제, 띠 수여식, 결정 리뷰의 중립 목소리. 인연 대상 아님. 「수련생님」→(검은띠)「유단자님」 |
| **히로인 루트 6인**(사범대리, 각자 전공) | 사쿠라·아라·하나·클로이·비비안·엘레나 | 챕터 담당 교사 = 드릴 출제·해설자. 스파링에 자기 스타일로 착석(살아 있는 교재). 유일한 인연 파트너(DB CHECK 그대로). 호칭: 사쿠라=당신 / 아라=너·야 / 하나=당신(존댓말) / 클로이="루키"→Lv5+"파트너" / 비비안=너·관객 / 엘레나=너 |
| **조연 10인**(도장 이웃·스파링 상대) | 모찌·초코·루나·구미·팽팽·드라코·카피·유즈키·린·잉그리드 | 리크가 교재. 드릴 D-TYPE 문항에 실제 HUD 스탯으로 등장. 인연 없음(아바타 해금 축 기존 유지). 연출 배치: 모찌=창고지기·초코=카드 배달·카피=뒷산 온천·루나=지붕·구미=신사 옆 여우굴·유즈키=그 신사 무녀·린=찻집·잉그리드=지하 라이브하우스·팽팽/드라코=제빙실/보물창고 |
| 플레이어 | 신입 수련생(익명 별명) | 백띠 |

**띠(전부 코스메틱, 도장 Lv와 별개 축)**: 백(온보딩) → 노란(1막) → 파란(2막) → 갈색(3막) → 검은(4막 졸업 SnG ITM) → 검은띠 N단(하드 3챕터당 1단).

## A3. 개념 분배 — 6명이 나눠 가르치는 기본기

| 히로인 | 전공(드릴 유형) | 왜 그녀인가 |
|---|---|---|
| 사쿠라 | 핸드 선택·포지션·레인지 컬러·"접는 용기" (D-RANGE·D-POS·D-ACT 폴드) | 록. 기다림이 정체성 |
| 아라 | 어그레션의 수학: 오픈 사이징·스틸 손익(필요 폴드율)·c벳·3벳·폴드 투 3벳 (D-SIZE·D-BE·D-RANGE 3벳·D-ACT 공격) | LAG. 압박이 취미 |
| 하나 | 아우츠·2/4의 법칙·팟오즈·에퀴티 정확값·콤보 기초 (D-OUTS·D-ODDS·D-EQ·D-CALL·D-COMBO) | 분석가. 화이트보드 |
| 클로이 | 상대 유형 4분면·밸류벳·사이징·씬 밸류·블러프 캐치 (D-TYPE·D-SIZE 밸류·D-CALL 리버) | 스테이션 본인 — "나 같은 애를 어떻게 이기는지" 카메라 밖에서 솔직히 |
| 비비안 | 블러프 손익분기 α·MDF·폴라라이즈·오버벳 오즈·매니악 대응·틸트 (D-BE·D-MDF·D-CALL 오버벳) | 매니악·배우. 블러프의 경제학 |
| 엘레나 | 핸드 리딩·레인지 좁히기·블로커·콤보 심화·넛츠·트랩 감지 (D-READ·D-COMBO 심화·D-RANK 넛츠) | 리딩의 달인 |
| 미야코 | 룰·핸드 랭킹·SnG 산술·푸시/폴드 (D-RANK·D-SNG) | 진행자 |

## A4. 드릴 유형 카탈로그

표기: **생성** = 시드 랜덤 상황 → 정답 자동 계산(무한) / **반생성** = 봇 HUD 스탯으로 상황 생성·해설 수기 / **수기** = 사람이 쓴 문항.

| 코드 | 유형 | 질문 예 | 입력 | 출제·정답 |
|---|---|---|---|---|
| D-RANK | 핸드 랭킹·보드 리딩 | "누가 이기나요?" / "이 보드의 넛츠는?" | 3~4지 | 생성 — `evaluateHand`, 넛츠는 남은 2장 조합(1,081) 전수 |
| D-POS | 포지션 | "이 자리 이름은?" / "플랍에서 누가 먼저?" | 3지 | 생성 — `positionLabels` |
| D-RANGE | 프리플랍 참여 판단 | "CO에서 K♠9♠, 언오픈. 참여?" / "상위 몇 %?" | 2~3지·슬라이더 | 생성 — Chen 백분위(`handPercentile`) vs 포지션 임계, 경계 ±3%p 문항 자동 제외 |
| D-OUTS | 아우츠 수 | "상대 A♣A♦. 턴에 내가 이기는 카드는 몇 장?" | 숫자 0~21 | 생성 — 남은 카드 전수 열거 |
| D-ODDS | 팟오즈 | "팟 150(상대 벳 50 포함), 콜 50. 콜 필요 승률(%)은?" → 25% | 숫자(±2p)·비율 4지 | 생성 — 콜/(팟+콜). **팟 정의 고정**: 팟 = 상대 벳까지 포함해 지금 중앙에 있는 총액(상황 카드에 단일 숫자 + '상대 벳 n 포함' 부제). "팟 150 + 벳 50 = 200 → 20%"로 읽히는 표기 금지 — 골든 테스트 1번 케이스 |
| D-EQ | 에퀴티 | "2·4법칙으로 추정 → 정확값은?" | 슬라이더(±5p) | 생성 — 플랍/턴 완전 열거(≤990), 프리플랍 사전계산 표 |
| D-CALL | 콜/폴드 결정 | "오즈 25% vs 뜰 확률 35%. 콜?" + 이유 | 2지+이유 2지 | 생성 — D-ODDS×D-EQ |
| D-COMBO | 콤보 카운팅 | "상대 QQ+·AK, 내 손 A♠, 보드 K♥. 콤보 수?" | 숫자 | 생성 — 6/4/12 − 블로커 |
| D-BE | 블러프·스틸 손익분기 | "팟 100에 50 벳, 상대 몇 % 접어야 본전?" | 숫자(±2p)·4지 | 생성 — B/(B+P) |
| D-MDF | 최소 방어 빈도 | "팟 100에 50 벳 맞음. 최소 몇 % 방어?" | 숫자·4지 | 생성 — P/(P+B) |
| D-TYPE | 상대 유형·착취 | HUD 카드 → "유형은?" → "밸류/블러프/폴드?" | 3지×2 | 반생성 — 16명 실제 스탯 |
| D-SIZE | 사이징 | "탑페어 리버 vs 스테이션. 벳 크기?" | 3지 | 수기(밸류)+생성(스틸) |
| D-ACT | 최선의 액션 +이유 | 상황 카드 → 폴드/콜/레이즈 → 이유 | 3~4지+이유 | **수기** |
| D-READ | 핸드 리딩·레인지 좁히기 | 액션 시퀀스 → "가능한 핸드군은?(복수)" | 다중 선택 | **수기** |
| D-SNG | SnG 산술 | "스택 1,200·블라인드 100/200. 몇 BB? 푸시?" | 숫자·2지 | 생성(BB)+수기(푸시표·버블) |
| 라이브 | 리딩 퀴즈(쇼다운 직전)·가면 유형 퀴즈(Ch7) | 실제 스파링 중 3지 | — | 런타임 — 공개 카드/정체로 채점 |

## A5. 커리큘럼 12챕터 (4막)

### A5-1. 개념 · 담당 · 드릴 · 상대

| Ch | 제목 | 핵심 개념 | 담당 | **드릴 세트** | '연습' 프리셋 | 스파링/보스(랜덤) |
|---|---|---|---|---|---|---|
| **1막 입문 → 노란띠** |
| 1 | 도장의 문 | 룰·액션·스트리트·핸드 랭킹·포지션 이름 | 미야코+파트너 동행 | 6문: D-RANK 5·D-POS 1(전부 생성) | 2핸드: A♠K♠ on A-K-x 투페어 밸류 / 7-2o 첫 폴드 | 10핸드 4인(나·파트너·카피·초코) — 룰 체험 |
| 2 | 기다림의 미학 | 4구간 레인지·포지션별 임계·림프 대신 레이즈/폴드 | 사쿠라 | 7문: D-RANGE 4·D-POS 2·D-ACT 1(생성 6·수기 1) | 2핸드: UTG J♣7♦ 폴드 / BTN A♦J♦ 오픈 | 10핸드 5인(클로이·모찌·카피) 하위 레인지 참여 0 |
| 3 | 숫자는 거짓말을 안 해요 | 아우츠·2/4법칙·팟오즈·콜 결정 | 하나 | 8문: D-OUTS 3·D-ODDS 2·D-EQ 1·D-CALL 2(전부 생성) | 2핸드: 플러시 드로우 vs 드라코 팟 오버벳(폴드) / OESD vs 초코 ⅓팟(콜) | **보스 드라코 3인 12핸드** — 오즈 위반 ⚠ ≤ 1 |
| **2막 공격의 기본 → 파란띠** |
| 4 | 먼저 치는 사람 | 오픈 사이징·스틸 필요 폴드율·c벳·폴드 에퀴티 | 아라 | 7문: D-BE 2·D-SIZE 2·D-ACT 3 | 2핸드: BTN 스틸 vs 모찌 / c벳 vs 카피 | 12핸드(카피·모찌·사쿠라) 림프 0·스틸 기회 실행 ≥ ⅔ |
| 5 | 받을 건 받아야죠 | 상대 유형 입문·밸류벳·사이징·씬 밸류 | 클로이 | 7문: D-TYPE 3·D-SIZE 2·D-ACT 2 | 2핸드: 탑페어 리버 vs 클로이 큰 밸류 / 에어 리버 체크 | 12핸드(클로이·카피·유즈키) 밸류벳 기회 실행 ≥ ⅔ |
| 6 | 3벳의 온도 | 3벳 레인지·3벳 대면 3구간·4벳=프리미엄 | 아라 | 7문: D-RANGE(3벳) 3·D-BE 1·D-ACT 3 | 2핸드: AA 3벳 / 하위 핸드 3벳 맞고 폴드 | **보스 팽팽 HU 15핸드 50BB** |
| **3막 읽기 → 갈색띠** |
| 7 | 가면무도회 | HUD 읽기·유형 분류·유형별 착취 | 비비안 | 7문: D-TYPE 5·D-ACT 2 + 라이브 가면 퀴즈 4 | — | 가면 4인(모찌·구미·초코·클로이, 표시명 A~D) 관찰 12핸드 → 퀴즈 → 공개 후 10핸드 — 가면 봇은 **표시 identity(이름 A~D·characterId 'mask')와 HUD identity(personality) 분리** 필요(B3(d) 가면 항목) |
| 8 | 궁금하면 콜 | 콜 필요 승률 vs 블러프 빈도·쇼다운 밸류 | 클로이 | 7문: D-ODDS 2·D-COMBO 2·D-CALL 3 | 2핸드: 구미 리버 벳 콜 / 초코 리버 벳 폴드 | 12핸드(구미·초코·비비안) |
| 9 | 그림자와 함정 | 레인지 좁히기·블로커·넛츠·체크레이즈 의미 | 엘레나 | 8문: D-READ 3·D-COMBO 2·D-RANK(넛츠) 2·D-ACT 1 | 2핸드: 루나 체크레이즈 폴드 / 사쿠라 리레이즈 폴드 | **보스 루나 3인 15핸드** |
| **4막 종합 → 검은띠** |
| 10 | 무대 위의 광기 | α=B/(B+P)·MDF·폴라라이즈·오버벳 오즈·틸트 | 비비안 | 8문: D-BE 2·D-MDF 2·D-CALL 2·D-ACT 2 | 2핸드: 트리플 배럴 콜다운 / 오버벳 폴드 | 잉그리드·드라코 12핸드 → **보스 비비안 HU 20핸드** |
| 11 | 여섯 개의 자리 | 종합 복습 | 파트너(+하나 리뷰) | 8문 혼합: 복습 노트 우선 | — | 6인 링게임 30핸드(히로인 5) |
| 12 | 졸업 시험 | BB 계산·M·푸시/폴드·버블·ITM | 미야코+전원 | 8문: D-SNG 6·종합 2 | 1핸드: 8BB 숏스택 푸시 | **졸업 SnG** — 스토리 전용 터보 구조(레벨 2분·시작 1,000, `blind-schedule` 변형. 기본 3분/1,500은 6인 완주 30~50분이라 25분 예산 초과). 3위 이내 = 검은띠, 우승 = 「사범대리」 |

드릴 슬롯 합계 88문(생성 58·반생성 8·수기 22) + 라이브 4. 파트너석: 담당 ≠ 파트너면 파트너가 남는 좌석에 "응원석"(기존 PartnerReactions 계약 유지). 6인 챕터는 담당/구성 우선.

### A5-2. 스파링 목표 · 결과 보너스 · 보상

**통과 규약(2026-09-02 개정)**: 챕터 **통과 = 드릴 세트 완료(재출제 포함) + 행동 목표(primary)**. 아래 '결과 보너스' 열(스택 ≥ 시작·보스 파산 등)은 **통과 조건이 아니라** S등급 후보·보스 뱃지에만 쓴다 — 결과 의존 통과는 P4("결과 ≠ 결정")와 모순이고, 12핸드 분산으로 정당한 플레이가 실패한다. **목표 규약**: 비율형 목표는 항상 "기회 중 실행"(조건부 카운트)으로 쓰고, 카드 분포에 좌우되는 절대 비율(VPIP 등)은 통과 조건 금지. 기회 0인 목표는 판정에서 제외(A13). 미통과 시 결산에서 **[스파링만 재도전]**(프롤로그·드릴 재주행 없이 라이브 스텝부터).

| Ch | 행동 목표(primary, 측정 가능) | 결과 보너스(등급·뱃지 전용) | 난이도·힌트 | 보상 |
|---|---|---|---|---|
| 1 | 10핸드 완주·쇼다운 1·폴드 1 | 완주 | easy·L1·파산 자동 리필 | 도장 100·파트너 인연 +30·「백띠 수련생」·스토리 탭+오늘의 수련 문제 개방 |
| 2 | UTG/HJ 하위 60% 핸드 참여 0·상위 10% 자발 폴드 0·프리플랍 리뷰 ⚠ ≤ 1 | 파산 없음 | easy·L1+레인지 컬러 | 도장 150·사쿠라 +100·「인내의 새싹」·레인지 컬러 연습방 해금 |
| 3 | 보스: 오즈 위반 ⚠ ≤ 1·드로우 결정 👍 ≥ 60% | 스택 ≥ 시작 or 드라코 파산 | easy·L2→L3 | 도장 150·하나 +100·**노란띠**·팟오즈/아우츠 연습방 해금·추천 Practice Dojo |
| 4 | 림프 0·BTN/CO 스틸 기회 중 오픈 ≥ ⅔·HU 어그레서 플랍 c벳 기회 중 실행 ≥ ⅔ | 스택 ≥ 시작 | normal·L3+질문권 3 | 도장 200·아라 +100·「첫 스틸」 |
| 5 | 클로이 상대 리버 밸류벳 기회 중 실행 ≥ ⅔·에어 리버 벳 ≤ 1·밸류 사이징 ≥ 50%팟 | 쇼다운 승 ≥ 3 or 스택 ≥ 시작 | normal·L3 | 도장 200·클로이 +100·「밸류 장인」 |
| 6 | 3벳 대면 하위 폴드 ≥ 70%·하위 4벳 0·프리미엄 3벳 ≥ 1 | 보스 후 스택 ≥ 시작 or 팽팽 파산 | normal·L2 | 도장 250·아라 +100·**파란띠**·추천 초급 캐시 |
| 7 | 가면 퀴즈 3/4·공개 후 유형 맞춤 👍 ≥ 50% | 파산 없음 | normal·L3·속마음/리딩 퀴즈 ON | 도장 250·비비안 +100·「가면 벗기기」 |
| 8 | 구미 리버 벳 탑페어+ 콜 ≥ 2·초코 리버 벳 원페어 콜 ≤ 1·리딩 퀴즈 ≥ 50% | 쇼다운 승 ≥ 3 or 스택 ≥ 시작 | normal·L3 | 도장 250·클로이 +100·「블러프 캐처」 |
| 9 | 루나 체크레이즈 대면 원페어 폴드 ≥ 70%·과도 콜 ⚠ ≤ 2 | 보스 후 스택 ≥ 시작 or 체크레이즈 손실 ≤ 20BB | normal·L3 | 도장 300·엘레나 +100·**갈색띠**·추천 SnG |
| 10 | 배럴 대면 탑페어+ 콜다운 ≥ 2·에어 리레이즈 0·오버벳 결정 👍 ≥ 50% | 보스 후 스택 ≥ 시작 or 비비안 파산 | normal·L0 기본 | 도장 300·비비안 +100·「커튼콜」 |
| 11 | 체크리스트 5(하위 레인지 참여 0·림프 0·c벳 기회 실행 ≥ ⅔·밸류 기회 실행 ≥ ⅔·오즈 위반 ≤ 2) 중 3 | 스택 ≥ 시작 | normal·L0 | 도장 350·파트너 +100·하나 +20·「여섯 자리」 |
| 12 | 졸업 SnG 완주(탈락 포함) | **3위 이내 = 검은띠 수여**(미달 시 통과·인연은 유지, 띠만 재도전) | normal·L0 | 도장 500·**전원 +30**·**검은띠**(ITM 시)·졸업 VN(파트너별 6종)·추천 아레나·하드 개방 |

**샌드박스 경계(명시)**: 위 목표·드릴 지시는 스토리 방(연습 경제·휴먼 1명)에서만. 일일 미션은 참여형 유지(신설 '오늘의 수련 문제 풀기'도 정답 무관). 목표는 스타일만 요구, 결과(특정 핸드로 승리) 요구 없음. 성적표 하단·기획·코드 주석 3곳에 표기.

## A6. 챕터 내부 구조(템플릿)

```
프롤로그 VN → 개념 카드 → 함께 풀기 → 드릴 세트 → [연습] 프리셋 1~2핸드 → 스파링/보스(랜덤) → 에필로그 VN → 결산
 2~3장면      ≤4장·≤2문장   1~2문 단계식  5~8문·콤보    실제 테이블·'연습' 배지     10~12핸드 or 보스      3~4장면·선택지  성적표·복습 노트
```

| 파트 | 내용 · 정책 | 시간 |
|---|---|---|
| 프롤로그 VN | 히로인 등장·오늘의 문제("드라코가 또 팟 두 배를 던졌어요…")·상대 소개. [건너뛰기]·[자동]·[로그] 상시 | 1.5~2분 |
| 개념 카드 | ≤4장, 각 ≤2문장+도해, 공식은 1개만. 스킵 가능 | 1분 |
| **함께 풀기** | 히로인이 1단계 말하고 → 플레이어가 다음 단계 입력 → 확인(하나 「먼저 아우츠. 하트가 몇 장 남았죠?」→[9]→「턴 한 장이면 ×2…」→[18]). 오답은 그 자리에서 정정, 점수 없음 | 1~1.5분 |
| **드릴 세트** | 5~8문. 🔥콤보 카운터+히로인 표정. 문항당 힌트 1회(½점). 오답 → 즉시 풀이(말투) → 세트 끝 재출제(생성형은 새 수치, 최대 2회) → 통과 처리+복습 노트. 세트 점수 S ≥0.9&힌트 ≤1 / A ≥0.75 / B 완료 | 3~5분 |
| **[연습] 프리셋** | 스토리 방 hold 중 시작. 홀카드·보드·(선택)상대 카드/액션 지정, 나머지 랜덤. 상단 **「연습 · 정해진 상황」** 배지+테두리 색+미야코 고지. 핸드 후 즉시 결정 리뷰+히로인 한마디. XP·기록 미집계(히스토리는 `story-practice` 표기) | 1~2분 |
| 스파링/보스 | 랜덤 딜. 인터럽트 ≤3(첫 핸드 목표 리마인드·기회 코칭·반환점), 탭 1회 or 8초 자동 진행. 턴 1막 90초·2막+ 60초(하드 20초 — B3(d)와 동일 값), 봇 사고 빠름. 1막 파산 자동 리필, 2막+ 파산 → [스파링만 재도전](패널티 없음) | 4~8분(보스 +5) |
| 에필로그 VN | 통과/미통과 2갈래+드릴 S 한 줄 → 관계 장면 → 선택지 → 반응. 미통과도 단축판 재생(P4) | 1~1.5분 |
| 결산 | 드릴 점수·콤보 최고·목표 ✓/✗·👍/🤔/⚠ 분포·등급·보상·복습 노트 추가 n·다음 예고·[다음 챕터]/[로비]/[하드]. 인연 Lv 상승 시 기존 씬 모달이 뒤따름 | 30초 |

**챕터 성적** = 드릴 50% + 실습·스파링 50%. **통과** = 드릴 세트 완료(재출제 포함) + 행동 목표(primary) — 결과 보너스는 등급·뱃지에만(A5-2 통과 규약). 인연 XP는 통과 시 고정.
**소요** Ch1 10~12분 / Ch2~11 13~17분(보스 +5) / Ch12 25분(터보 구조 전제), 전체 ≈3.5시간. **재도전** 무제한(인연 재지급 없음, [스파링만 재도전] 가능, 스파링 핸드는 연습 핸드로 정상 집계 — 연습 경제의 KST 일일 30핸드 초과분 25% 감쇠도 그대로 적용).
**하드 모드** 챕터 클리어 후 개방: 드릴 8문 고정·힌트 금지·오차 절반·상대 hard·오버레이 L0·핸드 −20%·턴 20초. 보상 뱃지·단만(첫 클리어 인연 +20).

## A7. 학습 메커닉 상세

### ⓪ 드릴 엔진(1급)
- **문항** = 상황 카드(좌석 미니맵·포지션·내 카드·보드·팟·상대 벳·상대 유형 배지·스택) + 질문 + 입력(선택지/숫자 키패드/슬라이더/카드 선택/다중 선택) + 힌트 1 + 해설(정답·오답별) + 출제 히로인.
- **생성기 규약**: 시드 = `hash(runId, setId, index)`(재도전 시 새 시드) / 데일리 `hash(profileId, kstDate, slot)`. 챕터별 난이도 파라미터(Ch3 아우츠 ≤9·깔끔한 팟 / Ch8 블로커 1 / Ch9 블로커 2+페어 보드). **정답 유일성 검증**(경계·동점 제외) 실패 시 seed+1 리롤(상한 32). 허용오차 % ±2p, 에퀴티 추정 ±5p.
- **Duolingo식 진행**: 3연속 → happy+한마디, 5연속 → confident, 무오답 「퍼펙트」 뱃지. 오답 즉시 풀이 → 세트 끝 재출제.
- **복습 노트**(Leitner 3박스): 틀린 문항(수기=ID, 생성=유형+seed 그대로 → "그 문제") 박스1 → 1일, 박스2 → 3일, 박스3 → 7일 후 정답 시 졸업. 다음 챕터 첫 1~2문·오늘의 수련에 최우선 출제. 허브 「복습 노트 (n)」.
- **오늘의 수련 문제 3개**: KST 갱신, 복습 우선(0~3)+해금 유형 생성, 출제자 = 유형 담당 히로인 로테이션(「오늘은 하나의 문제」). 완료 → 출제 히로인 인연 +5(일 1회, 멱등). 위치: 「수련 과제」 탭 상단 카드 + 허브. Ch1 완료 후 개방.
- **해설 예시(말투 기준)**: 하나 정답 「정확해요. 콜 50에 팟이 200이 되니 25%. …당신, 계산이 빨라졌네요.」/ 오답 「아깝네요. 콜 금액을 팟에 더하는 걸 잊었어요. 50 ÷ (150+50) = 25%. 다시 볼까요?」· 사쿠라 오답 「아, 아니에요… 그 자리는 뒤에 다섯 명이 남아서… 조, 조금만 더 기다리는 게…」· 아라 정답 「그렇지! 2.5BB로 1.5BB 먹으려면 62.5%만 접으면 돼. 모찌는 80% 접어. 그냥 훔쳐.」· 클로이 오답 「으엥, 블러프? 나한테? 루키, 나 안 접어~ 그냥 밸류로 가!」· 비비안 정답 「브라보. 팟 100에 50을 던지면 관객의 3분의 1만 퇴장해도 충분하지.」· 엘레나 정답 「…맞아. 턴 체크레이즈면 세트 아니면 투페어. 그 이하는 없어.」· 미야코 「정답이에요♪ 보드에 페어가 있으면 풀하우스가 가능하답니다.」

### ① '연습' 태그 프리셋 실습
챕터당 1~2핸드. 정의 = 히어로 홀카드 + 보드 + (선택)상대 홀카드/액션 스크립트. 서버는 **스토리 방의 `practice-table` 스텝에서만** 프리셋 허용(실전·스파링 요청 거부, 테스트로 고정). 3중 표기(배지·테두리·미야코 「이건 연습이에요 — 정해진 상황에서 배운 걸 써 보세요♪」).

### ② 코치 오버레이 힌트 레벨
L1 핸드 강도(기존 HandStrengthBadge)+포지션 라벨+툴팁(Ch1) → L1+ 레인지 컬러(홀카드 테두리 초록 상위 15%/노랑 ~35%/빨강, 포지션별 임계 이동)(Ch2) → L2 팟오즈 막대(콜 버튼 위, Ch3 후반부터 숫자)(Ch3) → L3 아우츠 카운터("플러시 드로우 9장·≈18%", 팟오즈 대비 ✓/✗)(Ch3 중반) → L4 질문권 3회(히로인 프리플랍 권고 1줄, 포스트플랍은 질문 되받기)(Ch4~6) → Ch10~12 L0 기본(토글). **실전 노출**: 연습방(bots)은 해금 레벨까지 토글, 캐시/SnG/MTT는 L1만(기본값 — E 참조).

### ③ 핸드 후 결정 리뷰(👍/🤔/⚠ + 한 줄 이유)
원칙: 결과 무관(배드빗 👍·럭키 아웃 ⚠, 카드에 "결과 ≠ 결정" 칩) · 입력은 내 카드·보드·공개 액션·공개된 상대 카드만 · 챕터 인식(배운 뒤 더 엄격) · 핸드당 가장 결정적인 1개만 하이라이트 · 상대 스타일 규칙은 Ch7+.

| 구간 | 👍 | 🤔 | ⚠ |
|---|---|---|---|
| 프리플랍 폴드 | 포지션 임계 밖 폴드(UTG 15%·HJ 18%·CO 25%·BTN 35%·SB 25%·BB 방어 40%) / 3벳 대면 하위 폴드 | 경계 ±5%p | 상위 5%를 압박 없이 폴드 |
| 프리플랍 참여 | 임계 내 오픈 / 프리미엄(6%) 3벳 / 콜드콜 상위 12% | 경계 오픈 / 림프(Ch1~3만) | 임계 +15%p 밖 오픈 / 오픈 림프(Ch4+) / 하위 4벳·콜드콜 |
| 포스트 벳·레이즈 | 어그레서·HU·드라이 c벳(Ch4+) / 탑페어+ 리버 밸류 vs 스테이션(Ch5+) / 8+아우츠 세미블러프 | 멀티웨이 미들페어 벳 / 팟 30% 미만 밸류 | 3인+ 에어 벳(Ch≤6) / 스테이션 상대 리버 에어(Ch5+) / 매니악 상대 에어 리레이즈(Ch10) |
| 포스트 콜 | 팟오즈 ≤ 아우츠 확률 드로우 콜(Ch3+) / 고빈도 블러퍼 리버에 탑페어+ 콜(Ch8+) | 경계 ±5%p / 리버 원페어 콜 vs 미지 | 오즈 불리 드로우 콜 / 페어·드로우 없이 ≥⅔팟 콜 / 초코·모찌 리버에 원페어 콜(Ch7+) / 루나 체크레이즈에 원페어 콜(Ch9+) |
| 포스트 폴드·체크 | 루나 체크레이즈에 원페어 폴드(Ch9+) / 오즈 불리 드로우 폴드 / 몬스터 트랩 체크(Ch9+) | 오즈 좋은 드로우 폴드 / 어그레서 HU 플랍 체크 | 3:1 이상에서 8+아우츠 폴드 / 넛급 폴드 / 리버 탑페어+ vs 스테이션 체크(Ch5+) |

이유 문장은 시스템체 40여 개 템플릿(「콜 값 20%, 뜰 확률 약 35%. 좋은 콜.」/「클로이는 거의 안 접어요. 없는 패로 벳하면 칩을 주는 거예요.」). 리뷰 카드 하단 **「이 상황을 문제로 풀기」** → 해당 핸드를 D-CALL/D-ACT 문항으로 즉석 변환 — "실전이 곧 문제집".

### ④ 라이브 드릴(Ch7+) · ⑤ 봇 속마음(Ch7+) · ⑥ 용어 툴팁(전역)
- 리딩 퀴즈: 리버 벳 대면/쇼다운 직전 3지 스트립 「구미의 패는? [강한 메이드][원페어][미스/에어]」. 공개 카드로 채점, 미공개면 스토리에서만 속마음 카테고리로.
- 속마음: 봇 결정 이유 코드 → 캐릭터 대사 1줄, **카테고리만**(카드 미공개, 스토리 방 유일 휴먼에게만 전송). Ch1~6은 담당 히로인 해설로 대체. 예: 구미 `river-bluff` 「그거, 내 아홉 꼬리 중 세 번째 꼬리였어♪」/ 루나 `check-raise-trap` 「체크는 함정이었냐. 발톱을 숨기고 있었다고… 후훗.」/ 초코 `value-bet` 「좋은 패였으니까 벳한 거다멍!」/ 카피 `fold-to-pressure` 「큰 벳은… 무서워서… 온천 생각했어…」.
- 툴팁: 용어집은 HelpModal GLOSSARY 38개가 이미 있음(대량 확장 불필요) — 팝오버 하단 「이 용어로 문제 풀기」 연결 + 드릴 신규 용어(MDF·α·블로커 등) 소수 추가.

### 활성 챕터 요약

| | Ch1 | Ch2 | Ch3 | Ch4~6 | Ch7 | Ch8~9 | Ch10~12 |
|---|---|---|---|---|---|---|---|
| 드릴 유형 해금 | RANK·POS | +RANGE·ACT | +OUTS·ODDS·EQ·CALL | +BE·SIZE·TYPE | +TYPE 착취 | +COMBO·READ | +MDF·SNG |
| 프리셋 실습 | 2 | 2 | 2 | 2 | — | 2 | 2/2/—/1 |
| 힌트 | L1 | L1+ | L2→L3 | L3+질문권 | L3 | L3 | L0 |
| 결정 리뷰 | 폴드/참여만·관대 | +프리플랍 | +오즈 콜 | +벳/c벳/밸류/3벳 | +상대 스타일 | +블러프캐치/트랩 | 전체·엄격 |
| 리딩 퀴즈·속마음 | 해설 | 해설 | 해설 | 해설 | ON | ON | ON |

## A8. 관계(미연시) 메커닉

**인연 XP(기존 곡선: Lv5 누적 250·Lv10 900·Lv15 1,925·Lv20 3,325, 핸드당 2)**

| 지급 | 대상 | XP |
|---|---|---|
| 프롤로그 완주 / 드릴 세트 완료 / 에필로그 선택지(어느 것이든) / 챕터 통과(성적 무관) | 담당 | +10 / +10 / +20 / +60 = **챕터당 +100** |
| Ch1 동행 / Ch11 코칭 | 파트너 | +30 / +100 |
| Ch12 졸업 | 전원 | +30 |
| 하드 첫 클리어 | 담당 | +20 |
| 오늘의 수련 문제 3개 완료 | 출제 히로인 | +5/일 |
| 주간 특별 수업(v1.5) | 그 주 히로인 | +30 |

시뮬레이션: 1챕터 담당(사쿠라·하나·엘레나) 130~150 → Lv3 / 2챕터 담당(아라·클로이·비비안) 230 → Lv4 / 파트너=사쿠라 260(챕터 보상만으로 Lv5 임계 250 충족)+스파링 핸드 XP → **스토리 중 Lv5 「벚꽃 아래서」 자연 도달**, 졸업 무렵 Lv7~8. 스파링 핸드 XP는 연습 경제 규칙(KST 일일 30핸드 초과분 25% — `practiceFullRewardHandsPerKstDay`)을 그대로 따르므로 기대치는 보수적으로 잡는다. Lv10~20 씬은 실전 동반+데일리 드릴로 — "스토리가 문을 열고, 실전과 매일의 문제가 관계를 깊게 한다". **필요 변경**: 비선택 캐릭터(담당 히로인) 대상 인연 지급 경로(멱등 이벤트) — 스키마 변경 없음(B3(f)).

**선택지 원칙**: ①정답 없음(XP 동일, 리뷰 무관 — "그녀를 어떻게 대하는가"의 태도) ②성장축 반영(사쿠라=말더듬 감쇠, 아라=츤데레 해동, 엘레나=문장 수 증가, 클로이=카메라 밖 얼굴, 비비안=가면 벗기, 하나=데이터 밖 변수) ③가벼운 분기·플래그 히로인당 ≤3, 추가만(리셋 금지), 후속 챕터·로비 「말 걸기」 1~2줄 변주에만 사용 ④호칭 규칙 준수.

**관계 종착지(전원 애인화 금지)**: 사쿠라=연애(정통, Lv20「만개」) / 아라=라이벌→약속된 승부 상대(「옥상에서」) / 하나=멘토→대등한 연구 파트너(「별 아래에서」) / 클로이=절친·방송 듀오(「콘페티」) / 비비안=뮤즈와 관객(「커튼콜」) / 엘레나=조용한 성인 로맨스(「첫눈」— 기본값, E 참조).

**히로인 반응 moment 확장**(`partner-dialogue.ts` PartnerMoment): `user-goodfold`·`user-badbeat`(런아웃 공개 에퀴티 ≥80% 패배)·`user-bluff-success`·`user-value-town`·`lesson-pass`/`lesson-fail`·`spar-interrupt`·`drill-combo-3`·`drill-combo-5`·`drill-perfect`·`drill-hint-used`·`drill-wrong-again`(사쿠라 「괘, 괜찮아요… 저도 이 문제, 세 번 틀렸어요…」).

**미야코**: 진행자·심판·"어른". 히로인들과 플레이어 사이 거리 조절자(「후후, 사쿠라 씨가 저렇게 말이 많은 건 처음 봐요♪」).

## A9. 재미 루프

| 요소 | 설계 | 왜 재밌나 |
|---|---|---|
| 드릴 콤보·퍼펙트 | 🔥연속 정답 → 표정·대사 변화, 「퍼펙트」 뱃지, 기록실 유형별 정답률 | 즉각 피드백 + 그녀의 반응 |
| 복습 노트 비우기 | 0개 달성 시 담당 축하·「빈 노트」 뱃지 | 약점이 사라지는 감각 |
| 오늘의 수련 문제 | 3문·2분·히로인 로테이션 | 테이블 앉을 시간 없는 날도 2분 접점 |
| 보스전 | Ch3 드라코(오즈로 겜블러 잡기)·Ch6 팽팽·Ch9 루나·Ch10 비비안·Ch12 졸업 SnG, `tension`→`victory` BGM+컷인 | 배운 계산 하나로 "얼굴 있는 적"을 꺾는 카타르시스 |
| 성적 S/A/B | 챕터 맵 별 표시, 도장 XP **가산** 보너스(B +0 / A +20% / S +50% 상당의 챕터별 고정액 — B2 `gradeBonus`가 단일 소스, 배수 아님) | 완벽주의자에게 재도전 이유 |
| 하드 모드·단 | 힌트 금지·오차 절반·hard 봇 | "힌트 없이 되나?" 자기 검증 |
| 기록실 | 유형별 정답률·리딩 정확도·👍 비율 추이 | 칩이 아닌 판단력이 숫자로 오른다 |
| 스토리→실전 | 1막→Practice Dojo(L3) / 2막→초급 캐시 / 3막→SnG / 졸업→아레나. 파트너 추천 문구 「이제 사람 있는 판도 괜찮아요. 제가 옆에 앉을게요.」 | 항상 열려 있지만 "이제 갈 만하다"는 신호 |
| 주간 특별 수업(v1.5) | 히로인×이웃×테마 드릴 5문+10핸드 | 졸업 후에도 수업이 계속 |

## A10. 첫 세션 플로우 · 로비/허브

| 시각 | 단계 |
|---|---|
| 0:00~0:50 | 이용 안내 → 파트너 선택(부제 「파트너는 첫 수련에 옆자리에 앉아요」) → 복구 코드(스킵 가능) — 기존 |
| 0:50 | 프롤로그 VN(미야코 3장면+파트너 1장면+선택지 1) ~90초 |
| 2:20 | Ch1 개념 카드 3장 → 3:10 함께 풀기 1문 → 3:40 **드릴 6문** ~2.5분(첫 콤보) |
| 6:10 | **[연습] 프리셋 2핸드** ~2분(첫 폴드·첫 쇼다운 보장) → 8:10 스파링 10핸드 4인 ~4분(인터럽트: 첫 내 턴·첫 쇼다운) |
| 12:10 | 에필로그(파트너 3줄+선택지) → 13:00 결산: 「백띠 수련생」·인연 +30·오늘의 수련 개방·[Ch2]/[로비] |

기존 코치마크 3단계는 Ch1 인터럽트로 흡수(스토리 스킵 유저에게만 기존 코치마크 유지).
**PartnerCard CTA**: 「스토리 계속하기 · Ch N」(기본) + 보조 「자유 연습」; 졸업 후 「수련 시작」+추천 테이블.
**로비 탭** 4열(모바일 2×2): 일반 게임 / **수련 스토리** / 포커 아레나 / 수련 과제(상단 오늘의 수련 카드).
**스토리 허브**: 띠 헤더(다음 승급·단) → 담당 히로인 카드(현재 챕터·드릴 유형·상대·소요·[시작][하드🔒]) → 챕터 맵 4×3(★등급·잠금) → 하단 [복습 노트 (n)] [기록실] [인연 갤러리] [특별 수업].

## A11. 콘텐츠 예산

| 전체(12챕터) | 합계 |
|---|---|
| 드릴: 생성기 11종 + 해설 템플릿 88줄 / 반생성 D-TYPE 32줄 / **수기 문항 50문·450줄** / 함께 풀기 18문·108줄 / 라이브 12 / 리액션 30 / 프리셋 21정의·42줄 / UI 25 | ≈790줄 + 생성기 11 + 프리셋 21 |
| VN: 프롤로그 12×25 / 개념 카드 12×10 / 인터럽트 12×6 / 에필로그 12×28 / Ch1 파트너 변주 48 / Ch12 졸업 72 / 수여식 24 / 이웃 인트로 30 | ≈980줄 |
| 봇 속마음 16×8×1.5 / 반응 moment 6×11×2티어 / 리뷰 문장 40 / 용어 +27 | ≈390줄 |
| **총계** | **≈2,180줄 · 선택지 25 · 수기 문항 50 · 생성기 11 · 프리셋 21** |

**아트(사용자 결정 반영 — 제작 정식 포함, 단 코드가 아트를 기다리지 않게 전 구간 폴백 유지)**
- **1차 파이프라인: gpt-image-2(codex exec)** — 기존 워크플로(크로마키 투명 PNG, `</dev/null` 비인터랙티브) 재사용. 제작 목록:
  ① 스토리 배경 3장(수련장 테이블 클로즈/도장 정원 밤/사범실, 1536×1024 → webp) ② 미야코 표정 +2(thinking·surprised — 현 3종) ③ Ch7 가면 아바타 1장 ④ (여유 시) 확장 10인 표정 +3종(thinking/confident/surprised — 현재 폴백 강등 중).
  기존 일러스트와 톤 매칭: 캐릭터별 기존 neutral.png를 레퍼런스로 첨부해 화풍 유지.
- **2차 파이프라인(대량 수요 시): RTX 5090 로컬 LoRA** — 캐릭터별 기존 일러스트(표정 3~6종+showcase+본드씬)로 SDXL/Flux 기반 캐릭터 LoRA 학습 → 표정 확장·챕터 삽화·이벤트 CG를 로컬 무제한 생산. 2막 이후 삽화/CG 수요(챕터별 이벤트 CG, 특별 수업 일러스트)가 확정되면 가동. 산출물은 기존 매니페스트 규약(`character-art.ts`·`bond-scenes.ts`)에 등록만 하면 됨.
- 좌석 미니맵·띠 아이콘·챕터 맵은 SVG/CSS(기존 컨벤션 — 카드/칩/버튼은 SVG).

**MVP(1막 3챕터+엔진)**: 드릴 21슬롯(생성 20·수기 1×2변형) · 생성기 7종(RANK·POS·RANGE·OUTS·ODDS·EQ·CALL) · 해설 템플릿 56줄 · 함께 풀기 5문 30줄 · 프리셋 6정의 · VN ≈200줄 · 기타(파트너 변주·카드·인터럽트·해설·리뷰 문장·moment·수여식) ≈174줄 · 리액션/UI 40줄 → **≈510줄 · 선택지 7 · 신규 아트 0**.
**수기 vs AI**: VN·선택지·해설 템플릿·수기 문항·속마음·리뷰 문장 = 수기 승인. AI 애드립 = 스파링 중 조연 잡담(`story:chN:spar`)·미야코 진행 멘트 변주만. **드릴 정답·해설에 AI 금지.**

## A12. KPI

| 지표 | 정의 | 목표 |
|---|---|---|
| Ch1 시작율 / 완료율 | 온보딩→프롤로그 / 시작→결산 | ≥85% / ≥70% |
| 1막 / 스토리 완주율 | Ch1 시작자 기준 | ≥40% / ≥15% |
| 드릴 정답률 추이 | 첫 세트 vs 복습 재출제 | 재출제 +25%p |
| 데일리 드릴 참여율 / 복습 소화율(14일) / 힌트 사용률 | DAU 중 3문 완료 / 박스3 통과 / 문항당 | ≥35% / ≥50% / <30% |
| 결정 리뷰 👍 비율(Ch1~2→Ch6→Ch12) / 리딩 퀴즈(Ch7→Ch12) | 동일 유저 | +20%p / +15%p |
| 파트별 이탈·VN 스킵률 | 프롤로그/드릴/프리셋/스파링 | 드릴 이탈 >10%면 문항 감축, 스킵 >50%면 대사 감량 |
| 스토리→실전 전환 / D1·D7 리텐션 / 인연 Lv5 도달률(30일) | 막 클리어 후 7일 / Ch1 완료자 vs 미참여 / 도입 전 대비 | 2막 후 캐시 ≥50% / +10%p / ×2 |

## A13. 리스크 · 대응(기획)

| 리스크 | 대응 |
|---|---|
| 생성 문항 정답 모호 | 유일성 검증+경계 제외+허용오차 명시+골든 테스트 100케이스/유형 + 팟오즈 '팟' 정의(상대 벳 포함) 골든 케이스 고정 |
| 모바일 숫자 입력 UX | 커스텀 키패드(0~100 정수)·슬라이더 병행·선택지 폴백(설정) |
| 드릴 피로("학습지 느낌") | 세트 ≤8문, 표정·콤보 연출, 문항 사이 한마디 30%, 챕터당 드릴 ≤5분 KPI |
| 에퀴티 성능 | 플랍/턴 전수 열거(≤990·≤46)는 클라 OK, 프리플랍 169×169 사전계산 표 |
| 프리셋 덱 원칙 충돌 | 3중 표기·서버 가드(스토리 방 practice-table 스텝 외 거부, 테스트 고정)·XP 미집계 |
| 설명 과잉 / 팟오즈 조기 노출 / 힌트 의존 | 카드 ≤4·≤2문장·공식 1개, "함께 풀기"가 설명 대체 / Ch3 전 숨김·막대→숫자 / 힌트 ½점·질문권 3회·하드 금지 |
| 랜덤 스파링에서 상황 미발생 | 드릴+프리셋이 개념 보장 → 스파링 목표는 "내 행동"만, 트리거 미발동 목표는 통과 조건 제외 |
| 히로인 편중 | 담당 +100/챕터, 데일리 로테이션 +5, 결산 「Lv5까지 N핸드」 유도. 담당 챕터 수 불균형(사쿠라·하나·엘레나 1 vs 아라·클로이·비비안 2)은 Ch1 파트너 +30·Ch11 파트너 +100이 보정하고, 데일리 출제자 로테이션은 1챕터 담당 유형을 가중 |

---

# Part B. 기술 설계

## B1. 개요

```
┌──────────────── 서버 ────────────────────────────────────────────────────────┐
│ socket-handler.ts: start-story-chapter · story-advance · story-choice ·          │
│   story-drill · story-quiz · story-daily · abandon-story → ack;                   │
│   story-update (개인 emit — progression-update 경로 L462–479와 동형)              │
│        ▼                                                                         │
│ StoryRunCoordinator (src/server/story-run-coordinator.ts)  ◀── 챕터 TS 데이터    │
│   runs: Map<profileId, StoryRun> — 방 무관, 프로필당 1런                          │
│   스텝 머신: scene → lesson(+guided) → drill-set → [live step] → scene → result   │
│   드릴 판정: generator.regenerate(templateId, seed) + grade() (순수)              │
│   결산: recordStoryChapterComplete(멱등) + story_progress/flags/drill_attempts    │
│        ▼ live step 진입/종료                                                     │
│ LiveTableAdapter (src/server/story-live-adapter.ts) implements StoryRoomHooks    │
│   createRoom(cfg, false, undefined, scenarioDeck?) · 라인업 착석 · hold/resume    │
│   beforeHand / onHandComplete(목표·리뷰·퀴즈) / onBotActed / onPlayerLeave        │
│        ▼                                                                         │
│ RoomManager: hold 게이트 3곳 + refreshCashBots 스킵 + 훅 + 즉시 dispose (스토리 방 한정)│
│ PokerEngine: 불변 (생성자 deck 인자만 사용)                                       │
│ 영속 v30: story_progress · story_flags · drill_attempts · drill_review_notes      │
│          + progression_events 재사용(보상 멱등)                                   │
└──────────────────────────────────────────────────────────────────────────────────┘
        ▲ story-update(개인)                       ▲ game-update(기존, 라이브 스텝만)
┌──────────────── 클라이언트 ──────────────────────────────────────────────────────┐
│ story-store.ts — progress(GET /api/story) · run(story-update)                    │
│ 로비 탭 'story' → StoryHub → ChapterCard / DailyDrillsCard / ReviewNotePanel      │
│ StoryStage(로비 위 풀스크린, 방 불필요): ScenePlayer · LessonPage · DrillCard      │
│   (미니 테이블+질문+입력+즉시 피드백+히로인 해설) · ChapterResult                   │
│ 인룸(라이브 스텝): GameRoomView 슬롯 StoryOverlay(ObjectiveHud·인터럽트·DecisionReview│
│   ·HandReadQuiz·BotThought) + ActionBar CoachPanel                                │
│ 공용 계산: src/lib/poker/learning.ts (드릴·코치 패널·서버 판정 동일 함수)          │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**핵심 전환: MVP(Phase 1)는 포커 방 코드 0줄.** 씬·레슨·드릴·결산은 방 없이 코디네이터가 돌고, 프리셋 실습·스파링만 어댑터가 방을 붙인다(Phase 1b, 병렬). **Phase 0~1은 `room-manager.ts`·`engine.ts`·`deck.ts`를 수정하지 않는다** — RoomManager 훅 삽입은 1b.0으로 이동(2026-09-02 개정), `story-p1` 태그 시점의 실전 코드 diff는 0.

| 판정 | 위치 | 근거 |
|---|---|---|
| 드릴 정답·시도 기록·콤보·힌트 카운트 | **서버**(같은 seed 재생성 후 비교) | 성적·보상·복습 노트 직결. 클라 DTO에 정답 미포함, 즉시 피드백은 ack |
| 챕터 성적·보상·해금·플래그 / hold·재개·목표·결정 리뷰·퀴즈 채점 | 서버 | 영속·보상 / `CompletedHandRecord`(서버 원본)가 입력 |
| 봇 속마음 | 서버 생성 → 스토리 방 유일 휴먼에게만 `story-update` | 봇 핸드 강도가 새는 정보 — `game-update`에 절대 금지 |
| 드릴 렌더·입력 UX·히로인 연출 / 코치 패널 수치 / VN 커서·오토·스킵 | 클라 | 내 카드+보드+팟만 사용(`HandStrengthBadge` 선례) |

## B2. 데이터 모델

### 드릴 — `src/lib/story/drills/types.ts`
```ts
type DrillCategory = 'pot-odds'|'outs'|'equity'|'combos'|'hand-ranking'|'position'|'range'|'call-decision'
  |'breakeven'|'mdf'|'opponent-type'|'sizing'|'action-judgment'|'hand-reading'|'sng-math';
type DrillAnswerSpec =
  | { kind:'multiple-choice'; options:string[]; correctIndex:number }
  | { kind:'numeric'; correct:number; tolerance:number; unit:'%'|'x'|'combos'|'outs'|'chips'|'bb' }
  | { kind:'card-pick'; correct:Card[]; pickCount:number }
  | { kind:'action-pick'; correct:ActionType[]; sizingBB?:{min:number;max:number} }
  | { kind:'multi-select'; options:string[]; correctIndices:number[] };
interface DrillSituation { hero:Card[]; board:Card[]; potChips:number; toCallChips:number; bigBlind:number;
  heroPosition:string; street:Street; villains:Array<{seatIndex;characterId;position;rangeTag?;range?;stackChips}> }
interface DrillTemplate { id; category; title; difficulty:1|2|3; hints:string[];
  source: {kind:'generated'; params:Record<string,number|string>} | {kind:'authored'; instance:...} }
interface DrillInstance { templateId; seed:number; situation; question; answerSpec; explanation:{text; speaker:StoryHeroineId; facts} }
type DrillInstancePublic = Omit<DrillInstance,'answerSpec'|'explanation'> & { answerSpec: StripCorrect<...> };
interface DrillResult { correct; correctAnswer; explanation; hintsUsed; streak; elapsedMs }
```
카드 문자열 파서(`'As Kd'`)는 test-helpers에만 있으므로 `src/lib/poker/card-notation.ts`(`parseCards`/`formatCard`) 신설 — 챕터 데이터·프리셋 스크립트·드릴 픽스처 공용.

### 챕터 — `src/lib/story/types.ts`
```ts
type StoryHeroineId = typeof PLAYABLE_CHARACTER_IDS[number];   // 6명, DB CHECK와 동일 (progression-repository.ts L25)
type Step =
  | { kind:'scene'; id; scene:Scene }                               // 프롤로그/에필로그/인터럽트
  | { kind:'lesson'; id; title; blocks:LessonBlock[] }              // text | concept-card | quiz | guided(함께 풀기: stages[{prompt, answerSpec}], 무점수)
  | { kind:'drill-set'; id; title; teacher:StoryHeroineId;
      drills:Array<{templateId; seedPolicy:'fixed'|'per-run'|'daily'; fixedSeed?}>; passRule:{minCorrect}; hintPenalty }
  | { kind:'practice-table'; id; tag:'연습'; ...LiveTableCommon; scripts:DealScript[]; perHandPrompt? }   // 프리셋 덱
  | { kind:'sparring'; id; tag:'대결'; ...LiveTableCommon; maxHands; objectives:{primary;bonus}; interrupts:Interrupt[] }
  | { kind:'result'; id };
interface LiveTableCommon { blinds; heroSeat; heroStackBB; lineup:LineupSeat[]; difficulty:RoomDifficulty; turnTimeSec; botThinkScale; hints:HintLevel }
interface DealScript { hero:string; villains?:Record<number,string>; board?:string }   // 'As Kd' 표기, 미지정은 CSPRNG
interface Scene { id; lines:SceneLine[]; requiresFlags? }  // SceneLine: speaker|expression|sprite|bg|music|choice?
interface SceneChoice { id; options:Array<{id; text; affinityMilli?; setFlags?; jumpTo?}> }
type Objective = hands-played | win-hands | net-chips | fold-preflop-junk | no-junk-entry | cbet-when-aggressor
  | correct-pot-odds-call | value-bet-river | survive | quiz-accuracy;
  // 비율형은 전부 {opportunities, executed, minRatio} 조건부 카운트 — vpip-range 같은 절대 비율 목표는 두지 않는다(A5-2 목표 규약). primary = 통과, bonus = 등급/뱃지
interface Chapter { id:'act1-ch01'; act; order; title; subtitle; heroine; belt; requires:string[]; steps:Step[]; failScene?;
  rewards:{ first:{dojoXpMilli; affinityMilli; itemIds?}; replay:{...}; gradeBonus:Partial<Record<'S'|'A'|'B',{dojoXpMilli}>> } }
```
배치: `src/lib/story/chapters/index.ts`(레지스트리 `STORY_CHAPTERS`·`getChapter`·`validateChapters` — 테스트가 스키마·requires 순환·heroine∈6·templateId 존재 검증), 챕터당 1파일 `chapters/act1/ch01-first-steps.ts`(수기 스크립트, AI 미사용). 라이브 스텝은 코디네이터에 `liveAdapter` 미주입이면 **스킵**(Phase 1 출시 가능, feature flag `story.liveSteps`).

### 영속 — 마이그레이션 v30 `story_mode` (`migrations.ts` v29 L6401 다음·배열 끝, `database.test.ts` **L322**(`migration.version`)·**L456**(`result.count`) `29→30`)
```sql
CREATE TABLE story_progress (profile_id REFERENCES profiles ON DELETE CASCADE, chapter_id TEXT CHECK(len 1..64),
  attempts INT ≥0, completions INT ≥0, best_grade TEXT CHECK IN('S','A','B') NULL, first_completed_at INT NULL,
  last_played_at INT, updated_at INT, PRIMARY KEY(profile_id, chapter_id)) STRICT;
CREATE TABLE story_flags (profile_id, flag_key TEXT CHECK(len 1..128), flag_value TEXT CHECK(len ≤128), updated_at, PK(profile_id, flag_key)) STRICT;
CREATE TABLE drill_attempts (id INTEGER PK AUTOINCREMENT, profile_id, template_id, seed INT 0..2^32-1, category TEXT CHECK(length 1..32) /* 고정 IN 목록 금지 — 유형 추가마다 마이그레이션이 필요해진다(progression_events.event_type 선례) */,
  context TEXT CHECK IN('chapter','review','daily','hand-review'), chapter_id NULL, run_id NULL, correct INT 0/1, hints_used INT 0..9,
  elapsed_ms INT ≥0, answered_at INT) STRICT;  + idx(profile_id, answered_at DESC), idx(profile_id, correct, template_id)
CREATE TABLE drill_review_notes (profile_id, template_id, seed, box INT CHECK 1..3, due_at INT, created_at INT, PK(profile_id, template_id, seed)) STRICT;
ALTER TABLE hand_history ADD COLUMN story_tag TEXT NULL CHECK(story_tag IN ('practice','sparring'));
  -- game_mode는 'cash' 유지: 기존 CHECK IN('cash','sng')라 'story-practice' 값은 INSERT 실패(삼켜져 기록만 사라짐). 목록 라벨 '연습'은 story_tag로 판정
```
- 해금 상태는 저장하지 않음 — `completions>0` 집합 + `requires` 그래프에서 파생(`src/lib/story/unlocks.ts` 순수 함수, 서버 검증과 클라 허브가 **같은 함수**).
- 선택지 = 플래그(`choice:<chapterId>:<choiceId>` → optionId).
- 보상 멱등은 `progression_events` 재사용: `event_type='story-chapter'`, 키 `story-chapter:<len:chapterId>:first:<len:profileId>` / `…:run:<len:runId>:…`; 데일리 `story-daily-drills:<kstDate>:<profileId>`.
- 오늘의 수련 상태는 `drill_attempts(context='daily', answered_at∈KST일)`에서 파생. 복습 노트는 Leitner 상태가 필요해 별도 테이블.

### 클라 DTO (`protocol.ts`)
`StoryRunView { runId; chapterId; stepIndex; stepKind; phase:'scene'|'lesson'|'drill'|'live-hold'|'live-play'|'result'|'ended'; roomId:string|null; drill:{setId;index;total;instance:DrillInstancePublic;streak;hintsUsed;wrongQueue}|null; live:{hold;holdReason:'scene'|'timeout'|'room-lost'|null;objectives;handsPlayed;maxHands;lastReview;botThoughts;pendingQuiz}|null; result:ChapterResultView|null }`
`StoryProgressView { chapters:[{chapterId;attempts;completions;bestGrade;unlocked}]; flags; belt; drillStats:{total;correct;byCategory}; reviewQueue:number; daily:{date;done;total:3} }`
`DecisionReview { handNumber; verdicts:[{street;action;amount;mark:'good'|'hmm'|'warn';reason;facts:{potOdds?;equity?;outs?}}] }` · `BotThought { handNumber; playerId; street; action; reason }`

## B3. 서버

### (a) 학습 계산 — `src/lib/poker/learning.ts` + `range.ts` + `seeded-rng.ts` (순수, 서버·클라 공용)
| 함수 | 방식 |
|---|---|
| `computePotOdds(toCall, potTotal)` → `{ratio, pct, requiredEquity}` — `potTotal` = 상대 벳 포함 중앙 총액(A4 D-ODDS 팟 정의), requiredEquity = toCall/(potTotal+toCall) | 산술 |
| `countOuts(hero, board, target?)` → `{outs:Card[], byRank}` | 남은 카드 전수(플랍 47·턴 46) × `evaluateHand`(`evaluator.ts` L159, 5~7장 best-5) |
| `estimateEquity(hero, board, villain:Card[]|RangeSpec, opts)` | 리버 1회 / 턴 44장 완전 열거 / 플랍 고정 핸드 990 완전 열거, 레인지는 시드 MC 2,000 / 프리플랍 사전계산 표 또는 MC |
| `parseRange('QQ+, AK, T9s, A5s-A2s')` → `Set<handKey>` · `countCombos(range, deadCards)` | `hand-rankings.ts` L84 `handKey` 표기 호환, 6/4/12 − 블로커 |
| `findNuts(board)` / `rankHands(board, candidates)` | 남은 2장 조합 1,081 × `evaluateHand` |
| `suggestAction(facts)` → `{action, text}` | 필요 에퀴티 vs 추정, 강도 임계 — 리뷰 규칙과 상수 공유 |
RNG `mulberry32(seed)` — 드릴 생성·MC 전용. 파일 상단에 "딜링 경로 아님 — `deck.ts` CSPRNG 규칙 대상 외" 명시.

### (b) 드릴 생성기 — `src/lib/story/drills/generator.ts` + `templates/*.ts` + `explain.ts`
- `generateDrill(templateId, seed): DrillInstance` — params로 시드 RNG에서 상황을 뽑고 learning.ts로 정답 산출; 모호(오차 내 두 답·아우츠 0·경계 백분위)면 seed+1 리롤(상한 32) — 서버·클라 동일 절차.
- `gradeDrill(instance, answer): boolean` — numeric `|v−c| ≤ tol`, card-pick 집합 동치, action-pick 포함+사이징 범위.
- 해설: 템플릿별 한국어 문장에 `facts` 치환 + 히로인 말투 접미(`partner-dialogue.ts` 성장축 규칙). AI 미사용.
- 수기 문항 `templates/authored/*.ts`(`source.kind:'authored'`).

### (c) StoryRunCoordinator — `src/server/story-run-coordinator.ts` (방 무관)
- `runs: Map<profileId, StoryRun>`; `StoryRun{ runId, chapterId, stepIndex, phase, drill:{setId, order, cursor, wrongQueue, streak, hintsUsed, results[]}|null, live|null, choices, flagsDelta, affinityDeltaMilli, startedAt }`.
- `start(profileId, chapterId)`: `unlocks.ts` 해금 검증 + 진행 중 run 없음 → `story_progress.attempts++` 즉시 영속 → 첫 스텝 view.
- `advance(profileId, runId, expectedStepIndex, target)`: stale 검사(`player-action`의 `expectedHandNumber` 계약과 동형 → `stale-state`) → 스텝 진입 훅(drill-set → 첫 인스턴스 생성; practice-table/sparring → `liveAdapter?.enter()` 없으면 스킵; result → 결산).
- `answerDrill(...)`: 커서 일치 검증 → `gradeDrill(regenerate(...))` → `drill_attempts` INSERT → streak/hints/wrongQueue 갱신 → 복습 노트 upsert(오답: box1·due +1일 / 정답: box+1 또는 졸업) → ack `{result}` + `story-update`. 세트 끝 `passRule` 미달이면 wrongQueue 재출제(같은 seed).
- `choose`, `abandon`(라이브 방 있으면 어댑터에 dispose 위임), `resend(profileId)`(재접속), `startDaily(profileId, kstDate)`(챕터 없는 경량 run 3문 → `story-daily-drills` 이벤트 +5).
- `finish(run)`: `gradeChapter(...)`(`src/lib/story/grading.ts`, 클라 미리보기와 동일 함수) → `recordStoryChapterComplete` → `story_progress`/`story_flags` upsert 같은 트랜잭션 → `story-update(result)`.

### (d) LiveTableAdapter — `src/server/story-live-adapter.ts` + RoomManager 삽입점(라인 검증 완료)
```ts
export interface StoryRoomHooks {        // room-manager.ts L205 MttRoomHooks 아래, 동일 패턴 병렬 도입(일반화 X — MTT 경로 15+ 참조 회귀 리스크)
  isHeld(roomId): boolean;
  beforeHand(roomId, engine): 'deal'|'hold';           // ScenarioDeck.arm, 봇 스택 리필(practice, 핸드 사이만), 히어로 sitOutNext 해제 — 히어로가 딜인 불가(타임아웃 마킹·끊김)면 'hold'
  skipHandProgression(roomId): boolean;                // practice-table 스텝 = true → completeHand(핸드 XP·일일 미션) 미호출, 히스토리는 story_tag='practice'
  onHandComplete(roomId): 'continue'|'hold'|'gone';    // 목표 평가·리뷰·퀴즈 채점 후 진행 지시 (히어로 미딜인 핸드는 handsPlayed 미집계)
  onBotActed(roomId, playerId, decision, explanation?): void;
  onPlayerLeave(roomId, playerId): void;
}
```
| # | 위치 | 변경(모두 `isStoryRoom(room) = !!room.config.storyChapterId` 가드 → 비스토리 방 실행 경로 불변) |
|---|---|---|
| 1 | L302/L325/L330 | `storyHooks?`, `setStoryHooks()`, `isStoryRoom()` |
| 2 | **L1702** `tryStartGame` | `if (this.isMttRoom(room) && this.mttHooks?.isHeld(roomId))` → `if (this.orchestratorHeld(roomId, room))` (MTT ∨ Story) |
| 3 | **L1751** `startNewHand` 재확인 | 동일 헬퍼 |
| 4 | **L1754** `refreshCashBots` 직후 | `if (isStory && storyHooks.beforeHand(roomId, engine) === 'hold') return;` (MTT `applyLevel` 선례) — 히어로 sitOutNext 해제·라인업 chips>0 보정·덱 arm을 `engine.startHand()` **앞**에서 |
| 5 | **L1613** `refreshCashBots` | `if (state.tournament \|\| isStory) return;` — 라인업 고정 |
| 6 | **L3229** `progression.completeHand` 호출 조건 + **L3308** 핸드 히스토리 + **L3268** MTT 분기 옆 | ⓐ `settlementOk && !state.tournament && !(isStory && storyHooks.skipHandProgression(roomId))` — 이 호출은 MTT 분기(L3268)보다 **앞**이라 뒤쪽 삽입만으로는 '연습' 프리셋 핸드의 핸드 XP·일일 미션이 이미 적립된다(2026-09-02 검증) ⓑ 히스토리 기록은 `story_tag` 실어 저장 ⓒ MTT 분기 옆 `if (isStory) { v = storyHooks.onHandComplete(roomId) ?? 'continue'; if (v==='continue' && rooms.has) scheduleNextHand; return; }` — `processLeaveReservations`·`scheduleBustReclaims` 앞에서 return하므로 히어로 파산은 30초 회수(room-lost)가 아닌 실패 분기 |
| 7 | **L1431** `cleanupEmptyRoom` | `gameMode==='sng' \|\| isStory` → 즉시 `disposeRoom` (10분 보존·리셋 회피) |
| 8 | **L2741** `startBotLoop` | `processBotTurn`의 기존 5번째 인자 `thinkDelayScale`(bot-manager.ts L115)에 `config.botThinkScale ?? 1` 전달(신규 인자 불필요), `{explain: isStory}` 옵션, `onBotActed` |
| 9 | **L992** `leaveRoom` | `onPlayerLeave` |
| 10 | **L664** `getRoomList` | `if (config.storyChapterId) return;` |
| 11 | **L350–354/L388–393** `createRoom` | 4번째 인자 `deck?: Deck`; 가드 `if (deck && !(storyChapterId && economyMode==='practice')) throw` |
| 12 | `RoomDisposeReason`(L172) | `'story-end'` 추가, `socket-handler.ts` L657–673 무음 분기 |
| 13 | **L2036** 미납 BB 정리(`shouldRemoveForMissedBlinds`)·방치 5분 회수 | `if (isStory) skip` — 히어로 좌석은 타이머로 회수하지 않는다(회수 → 빈 방 → #7 dispose → 런 사망) |
| 14 | **L2162** `toggleSitOut`·**L2302** 나가기 예약·`leave-room` | `isTournamentRoom(room) \|\| isStory → 'rejected'` — 스토리 방 이탈은 `abandon-story` 단일 경로 |
`RoomConfig`(`types.ts` L240–275) 확장: `storyChapterId?; storyRunId?; botThinkScale?` — 서버 전용(`getPublicState`는 config 미노출).
- **히어로 이탈·타임아웃 계약(2026-09-02 신설)**: 캐시 엔진의 턴 타임아웃은 `sitOutAuto` 마킹(L2091) → 다음 핸드 딜아웃(L1905) → 봇끼리 핸드 진행 → 미납 BB 정리(L2036) 회수 → 빈 방 → #7 즉시 dispose로 이어져 런이 조용히 죽는다. 스토리 방 규칙: ①자동 체크/폴드는 유지하되 `beforeHand`가 히어로 `sitOutNext`를 해제하고 `'hold'` 반환 → `story-update(live.holdReason='timeout')` → 클라 [계속하기] = `story-advance(target:'resume')` → `resumeRoom` ②히어로가 딜인되지 않은 핸드는 `handsPlayed`·목표에 미집계(방어 가드) ③`toggleSitOut`·나가기 예약·`leave-room`은 rejected(#14), 이탈은 `abandon-story`만 ④미납 BB·방치 5분·파산 30초 회수 전부 제외(#13·#6) ⑤끊김은 grace 60s → 만료 시 좌석 회수 → 빈 방 → #7 dispose → 코디네이터가 run을 `live-hold(holdReason:'room-lost')`로 보존하고 허브 「중단된 챕터 이어하기」가 라이브 스텝부터 새 방으로 재개 ⑥hold 최대 10분 타임아웃 유지. `sweepIdleRooms`(L630)는 휴먼 0명 방만 대상이라 별도 제외 불필요.
- **방 생성·착석**: `socket-handler.ts` L1094–1118 arena `onMatchFound` 패턴(`commitRoomMembership` L1306 → `socket.join` → `room-joined` → `story-update`). **hold를 좌석 채우기 전에** 세팅(`joinRoom` L748이 `tryStartGame`을 부름). 라인업은 `createBotWithCharacter`(`bot-manager.ts` L47)+`joinRoom`. `ensurePartnerBot`은 미사용(라인업이 명시적). 직접 `join-room` 진입은 L2111 위에서 거절(본인 재입장 제외).
- **프리셋 덱**: `deck.ts` L26 `private cards` → `protected`, `src/lib/story/scenario-deck.ts` `ScenarioDeck extends Deck { arm(script, dealtSeatOrder); reset() }` — `super.reset()`(CSPRNG) 후 스크립트 카드를 앞에 배치. **배치 순서는 `startHand`의 `getActivePlayers()` 배열순**(이번 핸드 status active인 좌석만, seatIndex 오름차순 — L439–442에서 좌석당 `deal(2)`) → 플랍 `deal(3)`·턴·리버 `deal(1)`(L909/913/917, **번 카드 없음**). 딜아웃(0칩·자리비움) 좌석이 있으면 카드가 한 칸 밀리므로 `beforeHand`가 라인업 전원 chips>0·sitOutNext=false를 보정한 뒤 arm하고, `scenario-deck.test.ts`에 '딜아웃 좌석 포함 라인업' 케이스 고정. 스크립트 카드는 CSPRNG 잔여에서 제거(중복 금지). `practice-table` 스텝에서만 `createRoom(cfg,false,undefined,deck)`. 선례 `test-helpers.ts` RiggedDeck L28–49.
- **턴 타이머**: `config.turnTime = step.turnTimeSec`(1막 90·2막+ 60·하드 20 — A6와 동일 값, L2070 그대로). 무제한 미채택(방치 누수). 안전장치: 만료 자동 액션 후 hold(위 계약 ①)·grace 60s→회수→#7·hold 10분 타임아웃(코디네이터 30s 스윕).
- **봇 속마음**: `bot-ai.ts` L163 `analyzeHand` export만 추가, 신규 `src/lib/bot/bot-explain.ts` `explainBotDecision(...)→{code,text}`; `bot-manager.ts` `processBotTurn(..., options?:{explain})` L127 결정 직후·L129 지연 전 계산. `bot-hud.test.ts`는 `decision.action`만 비교 → 무영향.
- **목표/리뷰/성적**: `src/lib/story/objectives.ts`·`review.ts`·`grading.ts`(순수) — 입력 `CompletedHandRecord`(`engine.ts` L1136) + `hand-history-replay.ts`로 스트리트별 팟 재구성 + learning.ts.
- **가면 봇(Ch7, Phase 2)**: `player.characterId`·이름은 `getPublicState`로 공개되고 클라가 characterId로 아트·컷인·말풍선을 그린다. 가면은 **표시 identity**(name 'A'~'D', characterId 'mask')와 **HUD identity**(personality = 모찌 등)의 분리가 필요 — `createBotWithCharacter`에 `display` 오버라이드 + 봇 AI는 personality 키로 조회. 공개 전엔 채팅·컷인·속마음·핸드 히스토리도 마스킹, 공개 시점에 스토리 방 한정으로 실제 identity 교체 브로드캐스트.

### (e) 보상 — `ProgressionService.recordStoryChapterComplete`
`recordSngFinishInternal`(`progression-service.ts` L421–507) 골격 복제: `getDuplicate`(L725) → `getOrCreateInTransaction` → **`repository.ensureAffinityInTransaction(profileId, heroineId)`**(신설 — `progression-repository.ts` L442–447 `INSERT … ON CONFLICT DO NOTHING` SQL 재사용, `character_affinity` PK가 (profile_id, character_id)라 비파트너 행 추가 가능) + **`getAffinityInTransaction(profileId, characterId)`**(신설 — 기존 `getSelectedAffinity`(service L1106)는 선택 파트너 전용이라 히로인 ≠ 파트너면 쓸 수 없음) → 보상액은 서버가 `getChapter(id).rewards`에서(클라 미신뢰, 선택지 인연은 챕터 상한 클램프) → `applyReward`(L821, `characterId`=히로인). `progressDailyMissions` 호출 안 함(핸드 단위 practice 적립은 L3227 경로가 이미). `progression-runtime.ts` L11–14 Pick 확장. emit은 L462–479 emitter 공유 → `ProgressionSummary`·`BondSceneUnlockWatcher` 자연 트리거.

### (f) 소켓/HTTP
```ts
'story-update': (view: StoryRunView) => void;                                        // ServerToClient L502
'start-story-chapter' | 'story-advance' | 'story-choice' | 'story-drill' | 'story-quiz' | 'story-daily' | 'abandon-story'   // ClientToServer L534, ack 규약
// RealtimeErrorCode L34: 'story-locked' | 'story-busy'
```
파서 `socket-payload.ts`(`hasOnlyKeys`·`cleanText`, DrillAnswer 유니온·카드 화이트리스트), 레이트리밋 `socket-rate-limit.ts` L6–14 `story:{10/5s}`, `storyStart:{2/10s}`, 핸들러 골격 `throw-item`(L2838–2908). HTTP `GET /api/story`(`src/server/story-http.ts`, `progression-http.ts` L54–122 패턴, `http-handler.ts` L244 옆). 재접속: `restoreOrEvict`(L1345) 끝 `coordinator.resend`; **방 없는 run은 `resync`의 `session.roomId` 없음 분기(L1759) 앞에서 resend 후 return**(드릴 중 새로고침이 로비 튕김이 되지 않게).

## B4. 클라이언트
- **`story-store.ts`**: `progression-store.ts` L510–523 `bindSocket` 패턴. `progress/run/sceneCursor/drillDraft/lastDrillResult`; 액션 `load/startChapter/startDaily/advance/choose/answerDrill/useHint/answerQuiz/abandon`. `story-update` 수신 시 `emitGameEvent({type:'story-*'})`(`game-events.ts` L16–43 유니온 확장, `throwable-thrown` 주입 선례 L346–360).
- **StoryHub**(`page.tsx` L45 `'story'`, L156–177 `grid-cols-4`, L178 main): 막별 ChapterCard(히로인 `CharacterImage`·띠·성적·잠금·[시작]), 상단 DailyDrillsCard(0/3)·ReviewNotePanel(n). `MissionPanel` 레이아웃·`PartnerCard` L72–83 CTA 규칙 재사용.
- **StoryStage**(로비 위 풀스크린 z-[95], `ui/Modal` 포털): `run && roomId===null`일 때. **ScenePlayer**(`BondSceneModal` 포털·패럴랙스·`useTypewriter` + `CharacterShowcaseModal` 스프라이트 모션 재조립: 배경/스프라이트/대사창/선택지/오토/스킵/로그, 타이머 콜백에서만 setState) · **LessonPage**(concept-card는 `HelpModal` 용어 카드 톤, guided는 단계식 입력) · **DrillCard**(`DrillTableView`: `Card.tsx` size xs/sm + `CommunityCards` + `PotDisplay` + 상대 미니 좌석 `CharacterImage`+포지션+`ChipStack`; 입력 4종: 선택지 그리드·숫자 키패드+슬라이더·카드 그리드(데드카드 비활성)·미니 ActionBar; 즉시 피드백 스탬프(framer `style={{x,y}}`)+`facts` 표; **CoachBubble** = `CharacterImage`(정답 happy/오답 thinking)+`useTypewriter` 독립 컴포넌트; 힌트 버튼; 진행 바+콤보 카운터+`playEffect`) · **ChapterResult**(등급 스탬프·드릴 정확도/최고 콤보/힌트·목표·보상·해금·복습 노트 n·[허브로]).
- **인룸(라이브)**: `GameRoomView.tsx` L176 옆 `<StoryOverlay/>`(ObjectiveHud·인터럽트 ScenePlayer — `hand-end`+5.5s 후 오픈·DecisionReview 하단 시트 4~6s·HandReadQuiz 3택 칩·BotThoughtBubble 좌석 위 3s·'연습' 배지), `ActionBar` 대기 슬롯 `CoachPanel`(`ACTION_DOCK_HEIGHT` 176 유지, learning.ts 계산은 `requestIdleCallback`).
- **기타**: `HelpModal` '수련 스토리' 섹션(구현과 어긋나면 안 됨), `AGENTS.md` 스토리 섹션, `partner-dialogue.ts` moment 확장, `music-manager.ts` `story` 트랙(mp3 전엔 lobby 폴백).

---

# Part C. MVP 구현 계획 (1막 3챕터 수직 슬라이스)

작업 방침(사용자 지시 반영):
- **별도 worktree + feature 브랜치**, 마지막에 main 병합(병합 전 충돌 확인).
- **단계별 커밋 — 언제든 갈아엎을 수 있게**: 태스크(아래 표의 행)당 최소 1커밋, 검증(`npm test`·`tsc`·`lint`) 통과 시 즉시 커밋. 서로 다른 관심사(엔진 훅/순수 유틸/UI/콘텐츠)는 한 커밋에 섞지 않는다. **Phase 경계마다 git tag**(`story-p0`, `story-p1`, `story-p1b`)를 찍어 Phase 단위 revert/reset 지점 확보. 실험적 시도는 별도 커밋으로 격리해 되돌리기 쉽게.
- `[P]` = 병렬 가능. **Phase 1까지만으로도 "오늘의 수련 문제 + 1막 드릴/VN" 독립 출시 가치.**
- **아트 트랙(병렬)**: Phase 1과 병렬로 gpt-image-2(codex) 에셋 4종(A11 참조 — 배경 3·미야코 표정 2·가면 1) 생성, 실패/지연 시 기존 폴백(로비 배경·표정 강등)으로 코드 진행에 영향 없음. LoRA(5090) 파이프라인은 2막 콘텐츠 확정 후 별도 태스크로 기동.
- **서브에이전트(사용자 지시)**: 구현 중 위임이 필요하면 **Opus**(Agent `model:'opus'` — 병렬 구현·테스트 작성 등) 또는 **GPT 5.6 Sol**(codex:codex-rescue — 교차 검수·막힌 버그 2차 진단·레드팀 리뷰)을 활용. 대량 콘텐츠(수기 문항·VN 문안) 초안과 병렬 태스크 구현은 Opus에, 검수·진단은 Sol에 배분.

### Phase 0 — 계산 코어·스켈레톤 (room-manager/engine/deck 무수정)
| # | 태스크 | 생성/수정 | 테스트 · 완료 기준 |
|---|---|---|---|
| 0.0 | 이 기획서를 repo에 저장(첫 커밋) | `docs/spec-story-mode-2026-09.md` (이 플랜 파일 전문) | — |
| 0.1 | 공유 타입·챕터 레지스트리·해금 그래프·카드 표기 파서 | `src/lib/story/types.ts`, `chapters/index.ts`, `unlocks.ts`, `drills/types.ts`, `src/lib/poker/card-notation.ts` | `unlocks.test.ts`, `chapters.test.ts`, `card-notation.test.ts` |
| 0.2 `[P]` | 시드 RNG + learning.ts + range.ts | `src/lib/poker/seeded-rng.ts`, `learning.ts`, `range.ts` (재사용 `evaluateHand`/`compareHands`, `handKey`) | 골든: 플러시 드로우 9아우츠·턴 19.6%·AA vs KK ≈82%·'QQ+'=18콤보·블로커 제외·넛츠 판별; 벤치 `findNuts`<30ms·플랍 고정 에퀴티<40ms |
| 0.3 `[P]` | 마이그레이션 v30(story 4테이블 + `hand_history.story_tag`) + StoryRepository | `migrations.ts`(v29 L6401 다음), `src/server/story-repository.ts`, `database.test.ts` 2곳(L322·L456) | `story-repository.test.ts`(progress·flags·attempts·review notes Leitner·데일리 파생 쿼리), 핸드 히스토리 story_tag 저장/조회 |
| 0.4 `[P]` | 프로토콜·파서·레이트리밋(라이브 스텝 DTO 필드는 optional로 선정의) | `protocol.ts`, `socket-payload.ts`, `socket-rate-limit.ts` | `socket-payload.test.ts` 추가 |
| 0.5 | 빈 코디네이터 + 소켓 배선 + `/api/story` (어댑터·RoomManager 훅은 1b.0~1b.1로 이동 — Phase 0~1은 room-manager/engine/deck 무수정) | `story-run-coordinator.ts`, `story-http.ts`, `socket-handler.ts`(L552 배선·L646·L1345·L1759·핸들러 7개), `http-handler.ts` L244, `server/index.ts` | `socket-handler.story.test.ts`(harness: 거절·레이트리밋·잘못된 payload), `story-http.test.ts` |

### Phase 1 — MVP: VN + 드릴 엔진/생성기 + 허브 + 영속 + 보상 (방 코드 0줄)
| # | 태스크 | 생성/수정 · 재사용 | 테스트 · 완료 기준 |
|---|---|---|---|
| 1.1 | 드릴 템플릿 7종(RANK·POS·RANGE·OUTS·ODDS·EQ·CALL) + 생성기 + 채점 + 해설 템플릿(미야코·사쿠라·하나 목소리) | `drills/generator.ts`, `drills/templates/*.ts`, `drills/explain.ts` | `generator.test.ts`(seed 스냅샷 100/유형·리롤 수렴·오차 판정), `explain.test.ts` |
| 1.2 `[P]` | 수기 문항(Ch2 D-ACT ×2변형) | `drills/templates/authored/act1.ts` | `chapters.test.ts` 커버 |
| 1.3 | 코디네이터 상태 머신(scene/lesson+guided/drill-set/result), answerDrill·useHint·wrongQueue·passRule·복습 노트·데일리, 결산·보상 호출, resend, 라이브 스텝 스킵 플래그 | `story-run-coordinator.ts`, `grading.ts` | `story-run-coordinator.test.ts`(전 스텝 주행·오답 재출제·커서 불일치 거절·중복 제출 차단·새로고침 resend 동일 뷰·방 생성 0회 spy) |
| 1.4 | 보상 `recordStoryChapterComplete` + `ensureAffinityInTransaction` + 데일리 이벤트 | `progression-service.ts`, `progression-repository.ts`, `progression-runtime.ts` | `progression-service.test.ts` 추가(첫 완주/재도전/중복/비파트너 히로인/롤백) |
| 1.5 `[P]` | 1막 3챕터 데이터(A5 커리큘럼: Ch1 미야코 룰·랭킹 / Ch2 사쿠라 핸드 선택 / Ch3 하나 오즈) — VN·카드·함께 풀기·드릴 세트·프리셋 6정의·라이브 스텝 정의(1b에서 활성) | `chapters/act1/ch01~03.ts` (톤 기준 `bond-scenes.ts`·`partner-dialogue.ts`) | `validateChapters` 통과, 말투 체크리스트(사쿠라 더듬·하나 존댓말·미야코 ♪) |
| 1.6 `[P]` | story-store + GameEvent 유니온 확장 | `story-store.ts`, `game-events.ts` | `story-store.test.ts` |
| 1.7 `[P]` | StoryHub + 로비 탭 4열 + DailyDrillsCard + ReviewNotePanel + PartnerCard CTA 변경 | `StoryHub.tsx`, `ChapterCard.tsx`, `DailyDrillsCard.tsx`, `ReviewNotePanel.tsx`, `page.tsx`, `PartnerCard.tsx` | `story-hub-rules.test.ts`(해금/정렬/CTA), 모바일 폭 |
| 1.8 | ScenePlayer + LessonPage(+guided) + scene-cursor | `ScenePlayer.tsx`, `LessonPage.tsx`, `scene-cursor.ts` | `scene-cursor.test.ts`(분기·플래그·스킵), lint 훅 규칙 |
| 1.9 | DrillCard(+DrillTableView·입력 4종·CoachBubble·피드백·콤보) | `DrillCard.tsx`, `DrillTableView.tsx`, `drill-inputs/*.tsx`, `CoachBubble.tsx` | `drill-input.test.ts`(정규화) |
| 1.10 | StoryStage 컨테이너 + ChapterResult + 음악 씬 + 결산 후 기존 인연 씬 연쇄 확인 | `StoryStage.tsx`, `ChapterResult.tsx`, `music-manager.ts` | 브라우저 주행(D) |
| 1.11 | HelpModal 섹션·AGENTS.md 섹션·이벤트 로그(`story-step`·`drill-answer`·`daily-drill`)·배치 커밋 | `HelpModal.tsx`, `AGENTS.md`, `event-log.ts` | |

### Phase 1b — 라이브 방 스텝 (Phase 0 후 Phase 1과 병렬)
| # | 태스크 | 생성/수정 · 재사용 | 테스트 |
|---|---|---|---|
| 1b.0 | RoomManager 훅·게이트 삽입 #1~#14 + RoomConfig 확장(스토리 방에서만 동작) — 실전 불변 증명 | `room-manager.ts`, `types.ts` | **`room-manager.story.test.ts`**: 비스토리 방 hooks 미호출(spy 0)·hold→resume 예약·refreshCashBots 스킵·빈 방 즉시 dispose·목록 숨김·wallet 방 덱 주입 throw·**타임아웃 후 딜아웃 없음(hold)·미납 BB 회수 미발생·practice 스텝 completeHand 미호출(spy 0)**; **기존 스위트 전체 무수정 통과** |
| 1b.1 | LiveTableAdapter: enter(방 생성·hold 선세팅·라인업·room-joined)·exit(dispose 'story-end')·hooks 구현·hold 타임아웃·히어로 파산 fail 분기·타임아웃 hold/[계속하기]·room-lost 후 「이어하기」 | `story-live-adapter.ts`, `socket-handler.ts` (arena `onMatchFound` L1094–1118, `createBotWithCharacter`, `resumeRoom` L708, `disposeRoom`) | `story-live-adapter.test.ts`(RoomManager 실물+fake timers: hold→ack→resume·라인업 고정·파산 fail·타임아웃·방/타이머 0) |
| 1b.2 `[P]` | ScenarioDeck + `deck.ts` protected + createRoom 4번째 인자 + `practice-table` 스텝 + '연습' 배지 payload | `scenario-deck.ts`, `deck.ts` L26, `room-manager.ts` L350/L388 (RiggedDeck 선례) | `scenario-deck.test.ts`(좌석순 배치 정확·나머지 CSPRNG·`Math.random` spy 0), `room-manager.story.test.ts` 가드, `deck.test.ts` 유지, create-room 경로 3인자 호출 spy |
| 1b.3 `[P]` | objectives(hands-played·survive·fold-preflop-junk·no-junk-entry·correct-pot-odds-call)·review v1(프리플랍 폴드/참여·오즈 콜)·grading 라이브 항목 | `objectives.ts`, `review.ts` (`hand-history-replay.ts`, learning.ts) | 합성 `CompletedHandRecord` 픽스처 테스트(결과 무관 케이스 포함) |
| 1b.4 `[P]` | bot-explain + processBotTurn 옵션(Ch7 전엔 히로인 해설이라 MVP는 수집만) | `bot-explain.ts`, `bot-manager.ts`, `bot-ai.ts` export | `bot-explain.test.ts`, 기존 bot 테스트 무수정 |
| 1b.5 | StoryOverlay(ObjectiveHud·인터럽트·DecisionReview·'연습' 배지)·CoachPanel L1~L3(레인지 컬러·팟오즈 막대·아우츠) | `StoryOverlay.tsx` 등, `GameRoomView.tsx` L176, `ActionBar.tsx` (`HandStrengthBadge`) | 시각 검증, 독 높이 176 유지 |
| 1b.6 | ch01~03 라이브 스텝 활성(프리셋 2핸드 + 스파링/보스) + 코치마크 흡수 | 챕터 데이터, `Coachmarks.tsx` | `chapters.test.ts`, 브라우저 주행 |

### Phase 2 — 심화·2막 (후속)
리딩 퀴즈(라이브)·에퀴티 vs 레인지 MC 드릴·D-BE/SIZE/TYPE 생성기·선택지→플래그→에필로그 분기·인터럽트 5종·일일 미션 `drillsDaily` 메트릭 연동(참여형, 미션 엔진 회귀 범위 확인 후)·「이 상황을 문제로 풀기」·2막 데이터·`story` BGM·용어 팝오버→드릴 연결(용어집 38개는 기존)·**Ch7 가면 봇 identity 분리**(B3(d)).

### Phase 3 — 3~4막·하드모드·기록실 (후속)
하드 변형(`variants`)·카탈로그 `story-chapter` 아이템 보상 소스·기록실(씬 다시보기·드릴 통계·스토리 방 핸드 히스토리 필터)·띠 승급 연출·`/api/admin/overview` 런 수·`ops_event` 화이트리스트·**Ch12 졸업 SnG 스토리 전용 터보 구조**(레벨 2분·시작 1,000 — 25분 예산)·주간 특별 수업.

### 리스크·대응(기술)
| 리스크 | 대응 |
|---|---|
| 드릴 정답 조작 | DTO에서 `correct*` 제거, 서버 재생성 판정, 커서 검증으로 중복 제출 차단 |
| 생성기 서버/클라 불일치 | 단일 모듈 공유 + seed 스냅샷 테스트, 정수 %/콤보 수 비교 |
| 방 없는 run이 `resync`에서 `room-lost`로 튕김 | L1759 앞 코디네이터 분기 |
| 엔진 불변식 | 엔진 무수정(덱 인자만); `beforeHand` 봇 리필은 핸드 사이만, `totalTableChips` 전후 검증 |
| hold 누수 | 휴먼 0 즉시 dispose(#7)·10분 타임아웃·grace 회수·`getRuntimeStats` 테스트·shutdown 시 run clear |
| 히어로 타임아웃·자리비움으로 런 사망 | 스토리 방 hold 계약(B3(d)) + #13/#14 가드 + 미딜인 핸드 미집계 + `beforeHand` 'hold' 반환 |
| '연습' 프리셋 핸드가 XP·미션에 적립 | `completeHand` 호출 조건 가드(#6ⓐ) + spy 0 테스트 — MTT 분기 뒤 삽입만으로는 막지 못한다 |
| 서버 재시작 | 인메모리 run 소실 허용; `attempts`·`drill_attempts`·복습 노트는 즉시 영속 → 허브 "중단된 챕터 다시 도전" |
| 봇 속마음 유출 | 개인 emit + `tableType:'bots'` 이중 가드; 타 클라 미수신 통합 테스트 |
| 결산 중복 보상 | `progression_events` PK + `getDuplicate`; `phase==='result'`면 재호출 안 함 |
| 승리 연출과 인터럽트 겹침 / 6.5초 예약 경합 | `hand-end`+5.5s 후 씬 오픈 / hold면 `scheduleNextHand` 자체 미호출, 재개는 `resumeRoom`→2s |

---

# Part D. 검증

- **단위**: `learning/range/seeded-rng/card-notation/generator/explain/grading/unlocks/chapters/scene-cursor/drill-input/objectives/review/scenario-deck/bot-explain`.
- **통합(서버)**: `story-run-coordinator.test.ts`, `story-live-adapter.test.ts`, `room-manager.story.test.ts`, `story-repository.test.ts`, `progression-service.test.ts` 추가, `socket-handler.story.test.ts`(시작→`story-update`·드릴 제출→ack·재제출 거절·새로고침 resync→뷰 복원(방 없음)·라이브 진입→`room-joined`·타 클라 미수신·abandon→정리).
- **실전 불변 회귀**: Phase 0~1 커밋 구간에서 `git diff story-p0..story-p1 -- src/server/room-manager.ts src/lib/poker/engine.ts src/lib/poker/deck.ts`가 빈 출력. 기존 147 테스트 파일 **무수정 통과**(`deck.test.ts`·`bot-hud.test.ts`·`room-manager.*`·`tournament-manager.*`·`socket-handler.integration.test.ts` 중점) + `npx tsc --noEmit` + `npm run lint` + `npm run build`.
- **브라우저(claude-in-chrome, `verify` 스킬 레시피)**: ① 허브→Ch1→프롤로그 VN(스킵/선택지)→카드→함께 풀기→드릴 6문(정답/오답/힌트·해설 버블·콤보)→결산 S/A/B→`reward-summary`→허브 성적 반영 ② 드릴 중 새로고침 → 같은 문제 복원 ③ 오늘의 수련 3문·복습 노트 재출제(같은 seed) ④ (1b) 프리셋 2핸드: 딜 카드=스크립트, '연습' 배지, hold→인터럽트→재개, 턴 타임아웃 → [계속하기] → 재개(히어로 딜아웃 핸드 0), 탭 닫고 90초 후 방 소멸(`/api/admin/overview`) 후 허브 「이어하기」 ⑤ 실전 회귀: Practice Dojo·Sakura Lounge 정상, 방 목록에 스토리 방 미노출, `join-room`으로 스토리 방 접근 거절 ⑥ 첫 세션 13분 타임라인 실측.

---

# Part E. 열린 결정 — 아래 기본값으로 진행 (이견 시 알려주세요)

| 항목 | 기본값 | 대안 |
|---|---|---|
| 팟오즈/아우츠 오버레이의 실전 노출 | 연습방(bots)까지만 토글, 캐시/SnG/MTT는 L1(핸드 강도)만 | 캐시 토글 허용(형평 논란) |
| 오늘의 수련 3문의 스트릭/일일 미션 연동 | MVP는 독립 보상(+5 인연)만, 미션 메트릭 연동은 Phase 2 | MVP에서 `DRILLS_DAILY_3` 참여형 미션 추가 |
| 드릴 숫자 입력 | 키패드+슬라이더 기본, 설정에서 선택지 폴백 | 선택지 기본 |
| 엘레나 관계 종착지 | 조용한 성인 로맨스(Lv20 「첫눈」 정합, 사쿠라와 톤 차별) | 사제→동료 프로 |
| 프리셋 핸드 히스토리 | 저장하되 `game_mode='cash'` 유지 + v30 `hand_history.story_tag='practice'`(스파링은 'sparring') — 목록 라벨 '연습', 리플레이 가능, XP 미집계. `story-practice`를 game_mode에 넣으면 CHECK 위반 | 미저장 |
| Ch12 졸업 조건 | **검은띠 = 3위 이내(ITM)**, 챕터 통과·인연은 SnG 완주 시(띠만 재도전) | 우승만 |
| 파트너 응원석 | 담당≠파트너면 좌석 여유 시 착석(6인 챕터는 담당/구성 우선) | 항상 착석 |
| 미야코 표정 +2·배경 3장·가면 아바타 | **gpt-image-2로 Phase 1 병렬 제작 확정**(폴백 유지, 코드 비의존) · 대량 확장은 5090 LoRA | — |
| 주간 특별 수업 | v1.5 | Phase 2 포함 |

---

# Part R. 2026-09-02 검토 반영 이력 (Fable 5.1, main 8fa4ea8 코드 대조)

코드 전제는 전부 일치했다(v29→v30, 히로인 6명 CHECK, 인연 곡선 250/900/1,925/3,325·핸드당 2, 삽입점 라인 ±20, 딜 순서, RiggedDeck, 소켓·프로토콜·레이트리밋 참조, 인연 씬 제목 24개, PartnerMoment 9종, MusicScene 4종, 테스트 파일 147). 아래 19건만 수정했다.

**기획**
1. 통과 조건에서 결과 조건(스택 ≥ 시작·보스 파산)을 제거 — 통과 = 드릴 + 행동 목표, 결과는 등급·뱃지 전용. [스파링만 재도전] 신설 (A5-2·A6·E).
2. 소표본 비율 목표(VPIP ≤ 35% 등)를 "기회 중 실행" 조건부 카운트로 치환, 목표 규약 명문화 (A5-1·A5-2·B2 Objective).
3. 팟오즈 문항의 '팟' 정의를 "상대 벳 포함 중앙 총액"으로 고정, 골든 케이스 1번 (A4·A13·B3(a)).
4. 턴 시간 통일: 1막 90 / 2막+ 60 / 하드 20 (A6·B3(d)).
5. 등급 보너스 = 가산 고정액(`gradeBonus`), 배수 표기 삭제 (A9).
6. "3핸드" → "3인" (Ch3·Ch9).
7. Ch12 졸업 SnG는 스토리 전용 터보 구조 전제 (A5-1·Phase 3).
8. Ch7 가면 봇은 표시 identity/HUD identity 분리 필요 (A5-1·B3(d)·Phase 2).
9. 용어집은 이미 38개 — 확장 항목을 팝오버→드릴 연결로 교체 (A7·Phase 2).
10. 연습 경제 일일 30핸드 감쇠 반영, 시뮬레이션은 챕터 보상만으로 Lv5 충족 (A6·A8).
11. 히로인 담당 수 불균형 보정 장치 명시 (A13).

**기술**
12. `progression.completeHand`(L3229)가 MTT 분기보다 앞 — '연습' 프리셋 핸드 XP 미집계는 호출 조건 가드로 (`skipHandProgression` 훅, #6ⓐ).
13. 히어로 타임아웃 → sitOutAuto → 딜아웃 → 미납 BB 회수 → 빈 방 dispose 시나리오 계약 신설 — `beforeHand` 'hold', #13/#14 가드, 미딜인 핸드 미집계, room-lost 후 이어하기 (B3(d)).
14. `story-practice` game_mode는 CHECK 위반 — v30 `hand_history.story_tag` 컬럼 (B2·E).
15. 덱 배치 = `getActivePlayers()` 배열순(딜인 좌석만), 번 카드 없음, 딜아웃 좌석 테스트 (B3(d)).
16. `drill_attempts.category` 고정 IN 목록 → 길이 제약 (B2).
17. RoomManager 훅 삽입(구 0.5)을 1b.0으로 이동 — Phase 0~1은 room-manager/engine/deck 무수정 (B1·Part C·D).
18. `database.test.ts` 수정 위치 L322·L456 (B2·0.3).
19. 히로인 인연 조회 `getAffinityInTransaction` 신설 명시 (B3(e)).

# Part S. 2026-09-03 플레이 피드백 반영 이력 (Fly v72 실주행 → 개정)

사용자가 배포본(v72)을 플레이하고 준 피드백 3건을 반영했다. 위 본문(A5-2·A6·A10 등)과 어긋나는 곳은 **이 Part가 우선**한다.

## S1. 용어 — 원어 표기
- 핸드를 '손'·'판', 폴드를 '접다', 오픈 레이즈를 '열다'로 옮긴 번역투를 전부 원어로 교체했다: 핸드·폴드·콜·체크·레이즈·
  오픈 레이즈·림프·3벳·팟·쇼다운·포지션. 대상은 챕터 1~3 대사·개념 카드·함께 풀기, 드릴 해설(explain·수기 문항·
  call-decision·range), 결정 리뷰 문구, 코치 패널, 도움말. AGENTS.md 컨벤션에 규칙 고정.
- 이 문서 본문의 '접는다' 같은 표기는 기획 원문으로 두되, **신규 콘텐츠는 S1 규칙을 따른다**.

## S2. 비선형 수련 목록 + 실력 확인 (A5·A10 개정)
- **requires 해제**: 1막 3챕터는 어느 순서로든 시작 가능(`requires: []`). 후속 막에서 선수 과목이 꼭 필요한 경우(졸업 시험 등)만
  requires를 남긴다. 해금·검증 함수(`unlocks.ts`)는 그대로.
- **허브 = 수련 목록**: 카드마다 드릴 유형 칩(챕터 드릴 세트 템플릿에서 파생) + 내 정확도(기록실 통계). ≥3문·<70%는 약점 강조.
  추천 카드는 `recommendChapter`: 진행 중 런 > 측정된 약점 최저 > 첫 방문(Ch1) > 미완료 첫 순서. 강제 아님.
- **실력 확인(exam)**: 미완료 챕터에서 [실력 확인] → 드릴 세트만(씬·레슨·'연습'·스파링 스킵, 힌트 금지) →
  `EXAM_PASS_SCORE` 0.85(6문 기준 첫 시도 5+재출제 1 통과, 4+2 미통과) 이상이면 **완료로 기록 + 첫 완주 보상(등급 가산 포함)**.
  미통과는 attempts만 남고 결산에 [수업 듣기](full). 이미 완료한 챕터는 [다시](full)만.
- **띠 승급은 결산이 알린다**(`ChapterResultView.beltAwarded`) — 순서가 자유라 에필로그는 "1막을 마쳤으니 노란띠" 같은
  문장을 쓰지 않는다(Ch3 개정). 오늘의 수련 문제는 "챕터 1개 완료"로 개방.
- 미루기: 하드 모드·기록실·수집형 뱃지 확장은 Phase 2 이후로 그대로(피드백 "이미 아는 내용을 수집 목적으로 반복시키지 말 것").

## S3. 연습 테이블 차별화 + 미션형 스파링 (A6·A7 개정)
- **시각**: 스토리 방은 청록 「도장 테이블」(펠트·레일·글로우 토큰 `story-felt-hi/lo`·`story-abyss`, 「수련 테이블」 워터마크) +
  상시 리본("🥋 수련 테이블 · 챕터 · 연습/스파링 · 연습 칩(지갑 무관) · ← 는 수련 그만두기") + TopBar 수련 배지(초대·탑업 숨김).
- **미션형 스파링**: `Step.sparring.minHands` — primary 목표를 전부 달성하면(판정 불가 없음) minHands부터 조기 종료,
  `maxHands`는 상한. 'N핸드 완주' primary 금지. 목표 kind 추가 `reach-showdown`·`fold-hands`·`open-raise`(언오픈 팟 +
  포지션 임계 안 핸드 = 기회, 레이즈 = 실행, 림프 = 놓친 기회, 임계는 `open-thresholds.ts`).
  비율 kind 규약: `maxCount` = 위반(기회−실행) 상한 / `target` = 실행 횟수(기회 0이면 판정 불가 → 상한에서 제외).
- **1막 목표(A5-2 표 대체)**:

| Ch | primary(미션) | min/max | bonus |
|---|---|---|---|
| 1 | 쇼다운까지 가 보기 1 · 폴드해 보기 1 | 4 / 12 | 팟 1개 · 파산 없음 |
| 2 | 약한 핸드 폴드 3 · 약한 핸드 진입 0 · 임계 안 핸드 오픈 레이즈(기회 중) 1 | 6 / 15 | 파산 없음 |
| 3 | 값에 맞는 콜/폴드 2 · 오즈 위반 ⚠ ≤ 1 | 6 / 15 | 스택 ≥ 시작 · 파산 없음 |

- halfway 인터럽트는 `ceil(minHands/2)`에서 든다. HUD는 미션형이면 'N핸드' + 「목표를 다 채우면 끝나요 (최대 M핸드)」.
- 종전 Ch3 「오즈 위반 ⚠ 1회 이하」는 구현이 maxCount를 무시하고 100% 정확을 요구하던 불일치가 있었다 — 위 규약으로 수정.

---

# Part T. 2026-09-03 보상 체계 + 재출제 완화 (v73 플레이 피드백 → P0·P2)

v73 피드백 "드릴을 계속 틀리면 20문쯤 간다"·"제대로 했을 때 확실한 보상"에 대한 개정. A7(학습 메커닉)·A8(관계)·B2(데이터 모델)와
어긋나는 곳은 **이 Part가 우선**한다. 클라 연출(결산 카드 플립·컷신·순간 보상)은 P1, 아트·의상·갤러리는 P3~P4에서 따른다.

## T1. 재출제 개정 요약 (P0 — 구현 완료)
- **2패스 모델**: 첫 패스 큐(슬롯 수 고정, `total` 불변) + 재출제 큐. 오답은 큐에 밀어 넣지 않고 슬롯 결과에만 기록, 첫 패스 끝에
  오답이 있으면 `retryOffer` → [다시 풀기 N문] / [복습 노트에 넣고 넘어가기]. 재출제는 **1회**(`maxRetries` 기본 1, 워스트 7→14문).
  첫 오답 즉시 풀이는 유지, 재출제 정답은 `RETRY_CREDIT` 0.5점, 재출제 힌트는 S 판정(`hintsUsed`)에 불가산.
- `passRule.minCorrect` 삭제 — 통과 규약은 "드릴 세트 완료 + primary 행동 목표" 그대로. "제대로 했을 때"는 등급 티어(S 전용 보상·칩
  가산) + 「퍼펙트」 칭호 + 실력 확인 0.85로 표현한다.
- 데일리는 **첫 시도만** 센다(`drill_attempts.attempt`, v31) — 재출제 행이 하루를 소모하던 버그 수정.
- 플래그: 「퍼펙트」(세트 첫 패스 무오답·힌트 0) `badge:perfect-set`, 「빈 노트」(복습 노트 졸업으로 0개) `badge:empty-note`.

## T2. 보상 원칙
- 가챠·랜덤 없음, 실전 수치 영향 없음(`gameplayModifiers: never[]`). 트리거는 **durable 상태에서만** 파생(챕터 완료·최고 등급·막
  완주·플래그) → 언제든 재조정(reconcile) 가능. 지급은 서버 `StoryRewardService.reconcile`(결산·데일리 종료·진행도 조회) — 결산 도중
  크래시가 나도 다음 조회에서 자기 치유, progression XP/인연과 분리·각자 멱등.
- 카탈로그 단일 소스 `src/lib/story/rewards/catalog.ts`, DB `story_reward_catalog`(v32)는 시드 사본(패리티 테스트). 영수증
  `story_rewards(profile,item)`이 1회 캡. 칩 외 보상은 인벤토리 마커(`inventory_items`)로 동기화, 칩은 `chip_ledger`
  `STORY_REWARD`(아이템별 키) / 데일리 `STORY_DAILY`(날짜별 키, `economy.storyDailyChips` 기본 100).
- 장착: 카드백·펠트 `profile_cosmetics`, 히로인 의상 `profile_character_outfits`(파트너와 무관, 로비·스토리 화면 전용 — 테이블
  좌석은 기본 유지), 칭호는 기존 `profile_equipment.title`. 모두 `POST /api/progression/equipment` slot
  `'title' | 'card-back' | 'felt' | 'outfit:<heroine>'`.
- 결산 DTO: `items`(새 아이템, 칩 제외) · `chips` · `cutscene`(새 CG 중 보스 > 띠 > 에필로그 1개) · `unlockedScenes`(이 결산의 인연
  전이로 열린 인연 씬) · `next`(이 챕터·막의 미획득 보상 미리보기, 최대 3) · `affinity[].levelBefore/levelAfter`. 허브
  `StoryProgressView.rewards`는 카탈로그 전체 + `granted`(갤러리 잠금 판정의 소스).

## T3. 1막 보상 스케줄 (= `catalog.ts`, 후속 막은 같은 템플릿)

| 트리거 | 보상 | 칩 |
|---|---|---|
| Ch1 도장의 문 첫 완주 | 칭호「백띠 수련생」 · CG「백띠 수여」(미야코, 띠 컷신) | 500 |
| Ch1 S | 카드백「도장 문장」 | 300 |
| Ch2 기다림의 미학 첫 완주 | **사쿠라 의상「도복」** · 투척「꽃다발」 | 500 |
| Ch2 S | CG「기다림의 뜰」(사쿠라 에필로그) | 300 |
| Ch3 숫자는 거짓말을 안 해요 첫 완주 | CG「오즈로 겜블러를 잡다」(드라코 보스, 컷신 우선) · 카드백「노란띠」 | 500 |
| Ch3 S | **하나 의상「연구실 가운」** | 300 |
| 1막 완주 | 펠트「노란띠 도장」 · CG「노란띠 승급」(미야코, 띠 컷신) | 1,000 |
| `badge:perfect-set` / `badge:empty-note` | 칭호「퍼펙트」 / 「빈 노트」 | — |
| 오늘의 수련 3문(첫 시도 기준) | (기존 인연 +5) | 100/일 |

1막 합 3,400 + 데일리 — 일일 무료 1,000 대비 보수적. 후속 막 템플릿: 첫 완주 = {칭호|담당 의상|카드백} + 500, S = {CG|의상} + 300,
보스 챕터 첫 완주에 보스 CG, 막 완주 = 띠 색 펠트 + 1,000. 실력 확인 통과는 첫 완주와 같은 트리거(등급 가산 포함).

## T4. 미루기
- 결산 연출·순간 보상·배경/BGM(P1), CG·의상·미야코 표정 아트 17장(P3 — 매니페스트 미등록이면 폴백), 옷장·갤러리 UI(P4), 영상
  파일럿(P5). 스토리 XP로 넘긴 도장 레벨의 **컬렉션** 아이템은 여전히 미지급(v13 뷰 확장 별도).

---

# Part U — v74 플레이 피드백 4건 반영 + BGM 다양화 (2026-09-03 3차 세션)

Part T의 보상 체계 배포(Fly v74) 뒤 플레이 피드백 4건과 "BGM이 한 곡뿐이라 질린다"에 대한 개정. 본문·Part S·Part T와 어긋나면 **Part U 우선**.

## U1. 함께 풀기 상황 패널 (피드백 ①)

- 레슨 `guided` 블록은 `situation: DrillSituation`(보드·내 카드·팟·콜·상대) **필수**, 단계는 `situation` 오버라이드(예: 2단계 홀카드 공개, 상대 벳 뒤 팟/콜 갱신)를 병합한다. `GuidedBlock`은 `DrillTableView`를 말풍선 위에 **상시** 그리고, intro는 정적 한 줄, 말풍선은 단계 프롬프트/피드백만 담는다.
- 원인: 보드가 intro 문장에만 있어 2단계 프롬프트·오답 피드백 때 사라졌다(Ch1 "K♦3♣" 문제, Ch2·Ch3 다섯 블록 전부, Ch3 두 번째 블록은 보드 자체가 없었다). 데이터 검증이 situation 누락·카드 중복·팟<콜·상대 캐릭터를 잡는다.
- 집필 규약: 카드 표기는 authored 드릴과 같은 'Ks Kh 7d 4c 2s'(`guidedSituation`), 내 카드가 없는 문제(보드 읽기)는 hero를 비워 "내 카드" 행을 숨긴다.

## U2. 기록실 (피드백 ②)

- 전용 갤러리 모달 — 섹션 인연 씬(6×4) · 이벤트 CG(보상 4 + 씬 CG 6) · 의상 · 칭호(도장 4 + 스토리 3 + 보유 아레나) · 배경(챕터가 쓰는 bg, 그 챕터 완주로 해금). 잠긴 항목은 숨기지 않고 조건 문구를 단다.
- 진입 3곳: 로비 헤더 🖼(NEW 점) · 수련 허브 「기록실」 카드(섹션별 n/m + NEW 수) · 결산 [기록실 보기](런을 닫고 연다). 결산 리빌과 해금 직후 뷰어에 "기록실에서 다시 볼 수 있어요" 안내.
- NEW는 프로필별 로컬 기준선(첫 진행 스냅샷 시점에 현재 해금분을 "본 것"으로 1회 기록) — 서버 상태 없음, 열람·[모두 확인]으로 해제.
- 뷰어 레이어: `Modal`(z-100/110) 안에서 여는 `CgStage`는 `layer='modal'`(z-120) — 인연 탭에서 뷰어가 모달 뒤에 깔리던 버그의 수정.

## U3. 칭호 플레이트 (피드백 ③)

- 등급 4단(일반/희귀/영웅/전설 — `--color-rarity-*` 토큰) + 띠 색 변형(백/노랑/파랑/갈/검) + 문양 8종(sprout·laurel·crest·flame·belt·star·note·crown)의 SVG 노치 리본. 크기 xs(좌석)·sm(프로필 헤더·보관함·리더보드)·lg(보상 카드·기록실). 이름은 HTML span(한글 말줄임).
- 해석은 `resolveTitle`(컬렉션 → 스토리 카탈로그 폴백) 단일 경로 — 장착한 스토리 칭호가 좌석에서 사라지던 버그 해결. 프로필 허브 상단 「내 칭호」 바 + [칭호 바꾸기].
- 등급 배정: 도장 Lv2 일반 / Lv15 희귀 / Lv30 영웅 / Lv45 전설, 백띠 수련생 일반(띠) / 퍼펙트 영웅 / 빈 노트 희귀, 아레나 TOP100 영웅·1~3위 전설·4~10위 영웅. 이후 띠 칭호는 `story-title-<belt>-belt`.

## U4. 씬 연출 · 컷인 · 영상 계약 (피드백 ④)

- 씬 라인 `cg`(그 라인에서만 풀스크린 CG, 다음 라인에서 스프라이트 복귀)와 `effect`(shake/flash/zoom/`sfx:<name>`; reduced-motion은 sfx만). 1막 배치: 프롤로그·에필로그 CG 각 1장(6장 배치 완료), 첫 쇼다운 flash+flip, 백띠 level-up, 드라코 shake, 노란띠 unlock.
- 스토리 컷인(우측/상단 — 승자 컷인과 비충돌): 드릴 퍼펙트(교사 퍼펙트 대사), 스파링 미션 클리어(`minHands` 이후 primary 전부 달성), 보스 라인업이면 BOSS DEFEATED(교사 대사, 하나: "값이 맞을 때만 받았죠. 통계는 거짓말을 안 해요."). 스텝당 1회.
- 영상: `VideoCutscene`(muted·playsInline·autoPlay·loop, poster=CG, 실패/1.5초 미도달/reduced-motion → 정지 CG) + `VIDEO_AVAILABLE` 매니페스트. 파일럿 3클립(노란띠 승급·드라코 격파·사쿠라 Lv5)은 RTX 5090 로컬 Wan 2.2 I2V로 후속 — 파일 2개(webm/mp4 ≤2.5MB) + id 등록만으로 붙는다.

## U5. BGM 라이브러리 (피드백 "한 곡만 있어 질린다")

- 장면(mood) 9종 × 트랙 여러 개: 로비 3 · 테이블 3 · 긴장 2 · 승리 1 · 수련 calm/warm/tense/triumph/sad 각 1(Suno 제작 10곡 배치). 설정 사운드 탭에서 mood별 [자동 순환]/트랙 선택 + ▶ 미리듣기, 로비 헤더 🎵에서 [다음 곡]/음소거.
- 자동 순환은 직전 곡 제외 무작위, 로비·테이블·긴장은 곡이 끝나면 다음 곡, 수련 mood는 루프. 404는 트랙 단위 불가 → 같은 mood 다른 곡 → 폴백 체인(story-* → calm → lobby, triumph → victory).
- 스토리 배선: 프롤로그 calm·에필로그 warm·Ch3 보스 인트로 tense(씬 라인 `music`), 레슨·드릴 calm, 결산 통과 triumph / 미통과 sad, 보스 스파링 중 tense.
- 징글 4종(결산 스탬프·띠 승급·퍼펙트·레벨업, 3~7초 Suno 숏트랙) — 재생 중 BGM 덕킹, 파일 없으면 합성 폴백. 단발 UI 효과음은 합성 유지.
- 제작 규약: 새 이벤트 씬/보스전/결산처럼 감정선이 다른 장면을 추가할 땐 코드 폴백만 두지 말고 Suno로 곡을 만들어 파일 + 매니페스트 한 줄로 배치한다.

## U6. 남은 것

- ~~영상 파일럿 3클립~~ (Part V-1에서 완료) · 비비안/엘레나 의상(3막 보상과 함께) · ~~2막 데이터~~ (Part V-2) · BGM 루프 구간(`loopStart/loopEnd`) 청취 조정.

---

# Part V — 5차 세션 (2026-09-03): 영상 파일럿 + 2막 데이터

## V1. 컷신 영상 파일럿 (P5) — Wan 2.2 대신 MiniMax H3

- **발견**: `C:\code\1. codex\AI-Image-Video`에 Codex가 8/26~31에 구축한 ComfyUI 포터블(v0.34, RTX 5090)이 이미 있고, Wan Animate 2(구동 영상 모션
  전이 — CG 애니메이션엔 부적합)와 **MiniMax H3 fl2va**(첫/끝 프레임 컨디셔닝 + 네이티브 오디오, 8-step turbo LoRA)가 설치돼 있었다. 인계 문서의
  "Wan 2.2 I2V 28GB 다운로드"는 불필요.
- **방식**: `MiniMaxH3ImageToVideo(first_frame = last_frame = CG)` → 768×1152(CG 원본 해상도 = H3 네이티브 캔버스) · 107프레임(17k+5 그리드) · 24fps →
  클립당 약 100초. 첫 프레임 = 끝 프레임이라 `<video loop>`에서 이음새가 없고 RIFE 보간이 필요 없다. 오디오는 버린다(VideoCutscene은 muted).
- **산출**: `story-cg-act1-belt-yellow` · `story-cg-act1-draco-boss` · `sakura-scene-lv5` — webm(VP9 crf32)+mp4(H.264 crf26) 0.5~1.4MB, 마지막 프레임
  1장(=첫 프레임 복제) 제거. 절차·프롬프트 규칙·러너: `scripts/art/story-video.md` + `scripts/art/story-video-h3.py`.
- **실주행**: Ch3 실력 확인 결산에서 드라코 보스 CG 스테이지에 `<video>`가 로드(readyState 4)됐고, 1막 완주 결산에서 노란띠 승급 영상도 같은 경로로 뜬다.
  자동화 창(문서 hidden)에선 Chrome이 무음 배경 영상을 정지시켜 재생 자체는 사용자 실기기 확인 대상.

## V2. 2막 「공격의 기본」 데이터 (Ch4~6)

| Ch | 담당 | 드릴 7문 | '연습' 2핸드 | 스파링(미션형) primary | 보상 |
|---|---|---|---|---|---|
| 4 먼저 치는 사람 | 아라 | D-BE 2(`breakeven-fold-pct`·`breakeven-choice`) · D-SIZE 2(`size-cbet-texture`) · D-ACT 3(steal-btn·cbet-dry·iso-sb) | K♥T♣ 스틸 / A♠K♦+K♣7♦2♠ c벳 vs 카피 | `steal-open` 2회 · `cbet-when-aggressor` ⅔ · `no-limp` 0 | 200·아라+100·「첫 스틸」·S=아라 저지 |
| 5 받을 건 받아야죠 | 클로이 | D-TYPE 3(`type-from-hud`×2·`type-exploit`) · D-SIZE 2(`size-river-value`) · D-ACT 2(river-value·river-air-check) | A♥Q♦ 리버 밸류 vs 클로이 / J♥T♥ 미스 체크 | `value-bet-river` 2회 · `no-air-river-bet` ≤1 · `value-bet-sizing` ≥50% | 200·클로이+100·「밸류 장인」·S=클로이 후디 |
| 6 3벳의 온도 | 아라 + 보스 팽팽 | D-RANGE 3(`range-3bet-decision`×2·`range-vs-3bet`) · D-BE 1 · D-ACT 3(3bet-aa·fold-vs-3bet·call-3bet-tt) | A♠A♥ 3벳 / A♦T♣ 3벳 맞고 폴드 | **보스 팽팽 HU 50BB 15핸드**: `premium-3bet` 1회 · `fold-vs-3bet-junk` 70% · `no-junk-4bet` 0 | 250·아라+100·파란띠·보스 CG·파란띠 카드백·S=아라 CG |

- **해금**: 2막 3챕터 모두 `requires = 1막 3챕터`(노란띠 뒤 개방), 2막 안에서는 비선형. 2막 완주 → 파란띠 펠트 + 파란띠 승급 CG + 1,000칩(v33).
- **새 규칙 단일 소스**: 3벳 3구간(`open-thresholds.ts` — 3벳 ≤6% / 콜 ≤12% · 4벳 ≤3.5% / 콜 ≤8%), 손익분기 = 벳 ÷ (벳+팟)(팟은 **벳 전** 금액),
  c벳 크기 = 드라이 ⅓ / 웻 ¾, 상대 유형 = VPIP 40↑ 루스·22↓ 니트 + PFR ≥ VPIP×60% 어그레시브(`opponent-type.ts`, `personalities.ts` 실제 HUD).
- **목표 kind 7종** 추가(`objectives.ts` 히어로 사실: limped·stealOpportunity·riverAirBet·riverValueBetPct·facedOpen/facedThreeBet·junkVsThreeBet·junkFourBet).
- **말투**: 아라(반말 츤데레 「너」·「흥」)·클로이(스트리머체·영어 한 스푼)·팽팽(「…」·미지근한 콜). 공용 풀이 core는 존댓말이라 `explain.ts toCasual()`이
  아라/클로이 해설의 어미를 반말로 바꾼다.
- **아트**: gpt-image-2(codex) — 씬 CG 6 + 보상 CG 3(팽팽 보스·아라 승리·파란띠 승급) + 의상 2×3표정(아라 jersey·클로이 stream). 샌드박스가 또 read-only라
  `generated_images` 회수 절차 재사용.
- **실주행(자동화 창)**: 허브 2막 섹션(잠김→1막 완주 후 개방), Ch4 프롤로그 씬 CG·개념 카드·함께 풀기 2블록(상황 패널 유지)·드릴 7문 전부 서버 채점
  정답(퍼펙트)·연습 테이블 첫 핸드 K♥T♣ 딜 확인. 스파링/보스전 라이브 스텝과 Ch5·Ch6 전체 실주행은 다음 세션.
