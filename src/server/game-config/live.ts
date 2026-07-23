import { GAME_CONFIG_DEFAULTS, type GameConfigKey } from './registry';
import type { GameConfigService } from './service';

/**
 * 런타임 게임 설정의 모듈 싱글턴 접근자.
 *
 * 소비처 상당수가 free function(sitout.ts 등)이거나 깊은 생성자 체인 안에 있어
 * DI 대신 싱글턴을 쓴다 (단일 인스턴스 서버 전제). `index.ts`가 부팅 시
 * `initGameConfig()`로 하이드레이션하고, 그 전(또는 테스트)에는 레지스트리
 * 코드 기본값을 반환한다 — 기존 테스트가 무수정으로 통과하는 이유이므로
 * 이 폴백을 제거하지 말 것.
 */
let service: GameConfigService | null = null;

export function initGameConfig(instance: GameConfigService): void {
  service = instance;
}

export function resetGameConfigForTest(): void {
  service = null;
}

/** 현재 유효 설정값 — 매 호출 시 읽기 (핫 컨피그의 핵심 계약) */
export function cfg(key: GameConfigKey): number {
  return service ? service.get(key) : GAME_CONFIG_DEFAULTS[key];
}
