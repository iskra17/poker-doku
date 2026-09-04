# A2 로컬 아트 제작 큐 계약

승인된 일반 수련·일상 CG 제작을 RTX 5090으로 계속 진행하기 위한 A2 설계. A1의 실제 생성 속도·실패 장면을 기준으로 하며 기존 캐릭터 이미지와 CG는 교체하지 않는다. 성적 흥분을 목적으로 한 이미지나 로컬 LLM 우회 위임은 포함하지 않는다.

## 제작 흐름

1. 검수된 A1 레시피를 고정하고 새 장면 목록을 import한다. 각 작업은 캐릭터 정본·장면 의도·구도·시선·표정·의상·seed·모델/워크플로 해시를 가진다.
2. 단일 워커가 pending 작업을 순서대로 생성한다. 실패 작업은 격리하고 다음 작업을 진행하되 제출 성공 여부가 불확실한 작업은 먼저 조정한다.
3. 결과를 contact sheet와 HTML 검수 목록으로 확인한다. 각 후보를 approved/rejected로 기록하고 reject 사유를 보존한다.
4. approved 후보만 새 파일명으로 WebP export한다. 기존 파일 덮어쓰기는 기본 거절하며 게임 매니페스트 연결은 별도 코드 변경으로 검증한다.
5. 영상은 승인된 정지 CG를 입력으로 기존 H3 워크플로를 사용한다. GPU 큐를 공유하므로 이미지와 영상 생성은 순차 실행한다. 원본 CG 해시와 영상 레시피를 함께 기록한다.

## 저장 위치와 CLI

- Python 표준 라이브러리 SQLite 기반. 기존 게임 SQLite와 완전히 분리한다.
- 기본 로컬 작업 루트: `D:/AI-Image-Video/output/poker-doku-library`; DB `library.sqlite3`, 입력/출력/리뷰/export 하위 폴더.
- 저장소에는 코드·스키마·검수된 레시피·장면 목록·운영 문서만 커밋한다. 모델, 대용량 원본, DB, Python 캐시는 커밋하지 않는다.
- `init`, `import`, `status`, `run`, `pause`, `resume`, `reconcile`, `review`, `sheet`, `export` 명령을 제공한다. 지속 실행은 `run --watch`, 한 작업/정해진 개수 실행도 지원한다.
- pause는 진행 중 작업을 완료한 뒤 다음 제출을 멈춘다. 재개는 같은 DB의 남은 작업을 계속한다. 다른 ComfyUI 작업을 취소하거나 전역 interrupt를 보내지 않는다.
- 최초에는 명시적으로 승인된 장면 목록만 처리한다. 무한히 새 장면·프롬프트를 임의 생성하는 루프는 만들지 않는다. 큐가 비면 watch 상태로 기다린다.

## DB 및 상태 전이

- jobs: 불변 job ID, recipe hash, 종류(image/video), 캐릭터/scene, seed, 상태, attempt, prompt ID, 결과 파일/해시/크기, 오류, 생성 시각.
- attempts: 제출 intent ID, job ID, recipe hash, started/submitted/finished 시각, prompt ID, 결과·오류. retry는 새 attempt를 만들며 과거 이력은 수정하지 않는다.
- reviews: job ID, 결과 해시, 결정, 사유, 검수 시각. 파일이 바뀌면 이전 승인을 사용할 수 없다.
- exports: 결과 해시, export 설정 해시, 대상 상대 경로, export 파일 해시. 같은 export 재실행은 멱등이다.
- settings: pause 상태와 schema version. 워커 프로세스 ID만으로 소유권을 판단하지 않는다.
- `pending → submitting → submitted → generated → approved/rejected → exported`. 확정 오류는 failed, 제출 응답 유실은 unknown이다. 생성 실패와 검수 탈락은 구분한다.
- DB 전이는 짧은 트랜잭션으로 처리한다. 네트워크/생성 완료 대기 중에 SQLite 쓰기 잠금을 잡지 않는다.

## 중복 제출과 복구

- 로컬 OS 파일 잠금(Windows `msvcrt`, 필요 시 POSIX `flock`)으로 GPU 워커를 하나만 실행한다. 공유 잠금은 작업 DB 루트 바깥의 고정 `D:/AI-Image-Video/.poker-doku-gpu.lock`을 사용해 서로 다른 작업 루트나 localhost/127.0.0.1 별칭으로 우회되지 않게 한다. PID 파일은 표시용이며 프로세스가 죽으면 OS 잠금은 해제된다.
- ComfyUI에 제출하기 전에 intent와 작업 키를 DB에 커밋한다. 요청의 `extra_data`에 고유 intent ID/attempt/recipe hash를 넣고 같은 값을 `extra_data.extra_pnginfo`에도 넣어 PNG 텍스트 청크로 보존한다. `filename_prefix`에도 intent/attempt를 포함한다. 워커 시작 시 메타데이터 비활성 옵션을 검사하고 실제 파일에서 메타데이터를 검증한다. 실제 ComfyUI 소스/응답의 queue/history 튜플 경로를 테스트한다.
- 응답 유실/워커 재시작 시 저장된 prompt ID 또는 intent 키로 queue/history를 조회한다. 실행 중이면 기다리고 완료됐으면 같은 결과를 등록한다. 이미 완료된 작업을 새로 제출하지 않는다.
- ComfyUI 자체 재시작으로 history가 없으면 결정적인 출력 prefix와 PNG 메타데이터의 intent/recipe를 대조한다. 디코딩·규격·해시가 맞는 완성 결과만 회수한다. 부분 파일은 generated로 인정하지 않는다.
- 원본이 없고 실행 유무를 증명할 수 없으면 unknown을 유지한다. 자동 재제출하지 않고 status에 조정이 필요한 이유를 노출한다. 관리자가 `reconcile --mark-failed <attempt>`처럼 정확한 대상을 확인한 뒤에만 명시적 retry가 가능하다.
- unknown은 해당 job만 차단한다. Comfy queue에 해당 intent/미식별 외부 항목이 없고 현재 GPU가 비어 있음을 확인하면 다른 pending 작업은 계속한다. history가 없다는 이유만으로 unknown 작업을 재제출하지 않는다.
- 다른 애플리케이션의 ComfyUI queue가 있으면 새 제출을 보류한다. 현재 자신의 작업은 정상 완료를 기다리며 외부 작업은 수정하지 않는다. 단일 워커 잠금은 타 프로그램의 제출까지 막는다고 주장하지 않는다.
- 생성 오류에는 제한된 명시적 retry만 제공한다. 무한 자동 재시도는 하지 않는다. 디스크 부족·깨진 입력·없는 모델은 제출 전에 멈추고 원인을 보존한다.

## 출력과 검수

- 출력 경로는 승인된 로컬 루트 내부로 정규화한다. 상대 경로 탈출, 다른 파일 덮어쓰기, 임의 명령 실행을 허용하지 않는다. ComfyUI 응답의 파일 경로도 같은 방식으로 검증한다.
- 생성 성공은 파일 존재만으로 판단하지 않는다. 이미지 디코딩·크기·해시 또는 ffprobe 영상 길이·해상도·프레임 여부를 확인한다.
- contact sheet는 검수 보조물이다. 새 후보는 확대본에서 얼굴 정체성, 구도/시선/표정 의도, 손과 물체 접촉, 배경, 중복을 검사한다.
- A1 gate는 각 캐릭터 6장면 중 4장면 이상 유효 후보 1장이다. gate 미달 레시피의 단순 대량 복제는 하지 않는다. 실패 원인을 고친 소량 실험으로 레시피를 다시 선택한다.
- 첫 공급은 서로 다른 구도/장면의 승인 CG 8장 이상을 목표로 한다. 채택 수를 맞추려고 장면 의도를 바꾸거나 불량 손/얼굴을 묵인하지 않는다.
- 승인 CG 8장 공급은 A2 인프라 완료와 분리된 후속 공급 항목이다. 인프라 자체는 fake Comfy 복구/검수/export 계약과 실제 GPU 소량 실행 검증으로 완료할 수 있다. 검수 승인/게임 반영에는 실제 품질 gate가 필요하다.
- export는 승인된 일반 CG만 처리한다. 기존 `convert.mjs` 규격과 앱의 `story-cgs.ts`/갤러리 계약을 사용하고, 영상 미생성/재생 실패는 정지 CG로 폴백한다.
- 워크플로 노드 ID는 runner에 하드코딩하지 않고 recipe hash에 포함한 바인딩 맵(프롬프트/seed/입력/출력 노드)으로 지정한다. 게임 export는 대상 저장소 루트를 명시 인자로 받고 import 때 고정한 승인 target root와 일치해야 한다. 다른 worktree/기존 파일로 잘못 쓰지 않는다.

## 필수 검증

1. fake Comfy 서버로 제출 직전/직후/응답 유실/결과 기록 직전 프로세스 종료를 재현한다. 동일 intent가 두 번 생성되지 않고 결과가 회수되는지 확인한다.
2. 두 워커 동시 시작 시 하나만 소유한다. 외부 queue 점유·pause/resume·unknown 작업·실패 작업이 다음 제출에 미치는 동작을 검증한다.
3. 모델/참조/워크플로 해시 변경, 깨진 PNG, 부분 영상, 디스크 부족, 상대 경로 탈출을 검사한다.
4. 검수 전 export 거절, 승인 뒤 원본 변조 거절, 멱등 export, 기존 파일 충돌 거절을 검사한다.
5. 실제 5090에서 일반 후보 소량을 만들고 워커 재시작 후 이어서 처리한다. DB/Comfy history/실제 파일을 대조한다.
6. 게임에 연결한 CG는 모바일/데스크톱에서 장면·갤러리 해금·영상 실패 폴백을 확인한다.

## 구현 책임

아트 담당 Astra Medium이 `scripts/art/library/` 모듈과 CLI/테스트/문서를 소유한다. 게임 연결은 총괄이 새 이미지의 실제 검수 결과를 판정한 뒤 별도 배치에 배정한다. Fable은 제출/복구·검수/export 계약을 리뷰한다. 총괄은 실제 GPU 결과와 UI 노출까지 확인한다.

진입점 이름은 `scripts/art/library-worker.py`, 내부 모듈은 `scripts/art/library/`로 통일한다. 기존 A1/A1c 단발 러너는 이력으로 보존한다.

## Fable 검토와 총괄 결정

실제 `claude-fable-5-1`, xhigh의 읽기 전용 기획 검토를 완료했다(테스트 실행 없음). PNG 메타데이터 경로·unknown 작업 격리·코드 수용과 승인 장수 분리·바인딩 맵·export 루트 고정 제안을 수용했다. 원본은 로컬 `qa-tmp/expansion-reviews/r2-a2-design.ndjson`. A1c 모델은 검토 작성 당시 다운로드 중이었으며 현재 진행 상태는 실행 기록에서 확인한다.
