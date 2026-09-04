# A1c Qwen-Image-Edit 2511 검증 계획

**목표:** 기존 SDXL 레시피를 반복하지 않고 원본의 얼굴·화풍·기본 의상을 유지하면서 새 구도를 만드는 편집 모델을 검증한다.
**구조:** 설치된 공식 ComfyUI int8 Qwen-Image-Edit 2511 template을 API graph로 변환한다. GPU worker 1개, 원본 1장 + 영어 편집 지시, 공식 4step LoRA, 신규 출력 폴더를 사용한다.
**기술:** ComfyUI native `TextEncodeQwenImageEditPlus`, Qwen-Image-Edit-2511 int8 convrot, Qwen2.5VL fp8 encoder, Qwen VAE, RTX5090.
**범위:** 성인 사쿠라22/엘레나27의 비성적 완전한 옷차림 일반 수련·일상. 기존 원본/public 교체·A2·게임 export·추가 에이전트 없음.

- [ ] 진행 중인 downloader 하나만 관측하고, official revision/전체 SHA-256 확인. 실패 시 원인을 좁힌 뒤 재개하며 큰 파일 중복 제출 금지.
- [x] 공식 문서/설치 template/node-info를 읽고 설정·hash를 기록한다. 모델 추가 설치·ComfyUI 업그레이드는 하지 않는다.
- [x] 신규 단발 `scripts/art/poker-doku-library-qwen.py`, `workflows/poker-doku-qwen-edit-2511.json`, 전용 manifest와 boundedguard 테스트를 추가한다. 제출 전 의도·후 prompt ID를 기록하고 불확실한 작업은 자동 재시도하지 않는다.
- [x] 원본 neutral/showcase 중 실제 정본을 육안 확인, 투명 부분만 배경 처리한 입력을 별도 저장한다. 얼굴만 재생성하지 않고 원본 캐릭터 그림 자체를 편집한다.
- [ ] `D:/AI-Image-Video/output/poker-doku-library/a1c-20260905/`에 아래 4장만 순차 생성한다: 사쿠라 garden-tea / table-review, 엘레나 snow-window / analysis.
- [ ] 각 출력 전체 확대본·4장 시트, 얼굴 원본 비교, 생성 초·GPU 메모리 표본·파일 규격/hash를 기록하고 총괄에게 즉시 전달한다.
- [ ] 4장 검수 전에는 5번째 제출하지 않는다. 검수 승인 시 총합16장 상한 내 추가만 가능하고 별도 manifest/명시 allowance로 잠근다.
- [ ] 코드/기록 검증·커밋 후 모델 unload, 생성 queue empty 확인. 부모의 A2 설계와 독립적으로 끝낸다.

실행은 기존 전용 worktree에서 직접 수행한다. 총괄이 추가 에이전트를 금지했으므로 계획 실행을 위임하지 않는다.
