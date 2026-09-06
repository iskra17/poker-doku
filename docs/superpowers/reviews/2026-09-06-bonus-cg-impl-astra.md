수정 필요 **2건**입니다. P1 문제는 발견하지 못했습니다.

1. **P2 — 스냅샷 장애를 프로필 부재로 처리합니다.**  
   [story-reward-service.ts:124](C:/code/claude/poker-doku/.worktrees/bonus-cg-integration/src/server/story-reward-service.ts:124)의 무조건 `catch`는 계약 6.1과 다릅니다.  
   **재현:** 스냅샷 조회가 `PROGRESSION_PERSISTENCE_INVALID`를 던지고 `badge:perfect-set='1'`이면, 오류 대신 `story-title-perfect` 지급 성공을 반환합니다. 보너스는 누락되고, 스토리 결산의 기존 실패·재시도 경로도 건너뜁니다. 메모리 실행으로 확인했습니다.  
   **최소 수정:** `ProgressionPersistenceError.code === 'PROGRESSION_PROFILE_NOT_FOUND'`만 레벨 0으로 처리하고 나머지는 다시 던지세요.

2. **P3 — 커밋 후 reconcile 실패 로그가 없습니다.**  
   [progression-runtime.ts:109](C:/code/claude/poker-doku/.worktrees/bonus-cg-integration/src/server/progression-runtime.ts:109)는 예외를 완전히 버립니다. 계약 6.2의 “실패 격리, 로그만” 중 로그가 빠졌습니다.  
   **재현:** cash 정산 성공 후 `reconcile()`이 `Error('reward store down')`을 던지면 게임은 계속되지만 지급 실패 기록이 전혀 남지 않습니다.  
   **최소 수정:** 예외를 잡아 프로필·정산 맥락과 함께 로깅하고, 현재처럼 진행은 유지하세요.

변경 없이 유지해도 되는 부분은 다음과 같습니다.

- **자격·지급:** 50종 각각 경계 −1/정확/+1 총 150개 검증 통과. 프로필·의존성 부재 시 미지급, 동일 트랜잭션 조회, 영수증·인벤토리 중복 방지 정상입니다. `story-affinity:<character>:<level>`, `story-dojo:<level>` 형식도 유효합니다.
- **기존 보상:** 기존 카탈로그 63항목 정의가 동일하며, 기존 자격 판정 8,064개 비교도 일치했습니다. 기록실 기존 이벤트 CG는 35개로 유지됩니다.
- **정산 연결:** 실제 서비스와 메모리 DB로 cash/practice/SnG 모두 **커밋 → reconcile → 새 인벤토리가 포함된 스냅샷 전달**을 확인했습니다. 스토리 결산·daily·getProgress 호출처는 그대로입니다.
- **DB·자산:** v39는 INSERT만 사용합니다. 전체 113행 패리티, 비히로인 20행 `character_id=NULL`, 기존 가드와 인벤토리 sync 호환, 보너스 영수증 50개 지급이 통과했습니다. 50개 ID의 WebP·MP4·WebM 총 150파일도 존재합니다.
- **클라이언트:** 표시 필터와 실제 `baselineIds` 분리, 운영자 해금 표시, bonus 뷰어, ready 상태 재오픈 조회, 인연 탭 필터, persist v5, 컷신 캐릭터 타입이 맞습니다. 숨김 설정에서는 컷신 단계 자체가 제거되고 아이템 카드는 유지됩니다. 대상 6파일 ESLint도 통과했습니다.

**테스트 공백:** 계획 5의 토글→목록·집계·NEW·기준선 통합 테스트와 재오픈·뷰어 재생 검증이 빠져 있습니다. [런타임 테스트:382](C:/code/claude/poker-doku/.worktrees/bonus-cg-integration/src/server/progression-runtime.test.ts:382)도 `granted: []`만 사용하므로 실제 신규 지급 후 전달 스냅샷을 고정하는 회귀 테스트가 필요합니다.

Vitest는 임시 폴더 생성 권한 오류로 실행되지 않았습니다. 위 실행 검증은 파일을 수정하지 않는 메모리 검사이며, 브라우저 영상 재생은 미검증입니다.