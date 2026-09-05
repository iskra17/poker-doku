# 첫 일반 아트 공급 검증

## 공급 결과

- 새 CG8장: 사쿠라4장/엘레나4장, 기존 원본은 유지. `first-supply-20260905.json`의 source/output SHA와 게임 파일이 일치한다. Ch2 기존 에필로그에 서재·정원·비를 피하는 장면을 연결했고 Ch9 장면 연결은 R3b가 담당한다.
- 새 영상2개: 사쿠라 작은 승리와 엘레나 강변의 생각. 원본 H3는107프레임/24fps/768×1152, 전체 디코드·내장 intent metadata·SHA 검증 후12시점과 추가 원해상도 프레임을 시각 검수했다. 사쿠라 빗소리 v1/v2는 입 모양 변형으로 반려하여 공급하지 않는다.
- 웹용은106프레임/24fps, MP4 H264 + WebM VP9. 4파일 모두 독립 영속 pair receipt가 complete이며 파일 SHA를 다시 확인한 뒤 `VIDEO_AVAILABLE`에 두 ID만 등록했다. 기존49클립은 변경하지 않았다.

| 장면 | MP4 | WebM |
|---|---:|---:|
| 사쿠라 작은 승리 | 439,628B | 619,985B |
| 엘레나 강변의 생각 | 293,282B | 371,563B |

총1,724,458B, 각2.5MB 상한 이내. 정확한 pair/source/settings/출력 해시는 `scripts/art/library/recipes/first-video-supply-20260905.json`에 기록했다.

## 브라우저 검증

격리 localhost:3011/Chrome에서 실제 `ScenePlayer`(원본 Ch2 에필로그 데이터)와 기록실 공용 `CgStage`를 임시 라우트로 렌더했다. 이는 UI/영상 검증이며 수련 전체를 직접 완주한 기록이 아니다. 임시 라우트는 확인 후 삭제했다.

- 두 영상 모두 자동 재생·muted, 5.5초 관찰에서 실제 재생 시간이 진행하고 루프 경계에서 되돌아오는 것을 확인했다.
- 390×844/1280×900 가로 넘침 없음. 사쿠라 모바일/엘레나 데스크톱 캡처를 직접 검수했다.
- reduced-motion이면 video를 마운트하지 않고 완전히 로딩된 정지 CG가 보인다.
- WebM 요청만 차단하면 MP4를 재생한다. 모든 영상 요청을 차단하면 정지 CG로 폴백한다.
- 로컬 증거: `qa-tmp/expansion-live/a3-components-results.json`, `a3-mp4-fallback.json`, `a3-{sakura,elena}-{390,1280}.png`.

## 제작 기반·검사

A2.1/A3 구현자 Python46실행:45통과/1skip(Windows에서 테스트 symlink 생성 불가), TS44개·tsc·변경eslint 통과. root는 실제 두 pair export 성공과 source/출력 해시를 확인했고, availability 등록 후 관련4파일34테스트 통과. 기존 생성 큐의 실제12장 재시작 감사와 Fable 리뷰는 앞선 A2 기록에 있다. 추가 A3 Fable 검토는 사용자의 토큰 비용 요청으로 중단했으며 완료 리뷰로 간주하지 않는다. 최종 통합 build/lint/tsc는 R3b와 함께 한 번 수행한다.

모델 검증 캐시는 실제 파일을 같은 프로세스에서 두 번 검증해 측정했다. Qwen4모델 첫완전해시16.228초→동일stat 재사용0.000937초, H3 4모델30.200초→0.001613초. 이는 모델 검증 구간만의 측정이며 전체 GPU 생성 속도의 실측 개선으로 표현하지 않는다. 원본/워크플로 해시는 여전히 작업마다 검사한다. 증거는 `qa-tmp/expansion-reviews/a3-model-cache-benchmark.json`.
