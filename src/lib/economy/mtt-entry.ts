/**
 * wallet MTT 참가 상품 가격 — 캐주얼 SnG(1500+150)와 동일 가격대의 v1 단일 상품.
 * 서버 검증(economy-service)과 클라 표시(CreateTournamentModal 등)가 공유하는 단일 소스.
 */
export const MTT_WALLET_BUY_IN = 1_500;
export const MTT_WALLET_ENTRY_FEE = 150;
export const MTT_WALLET_ENTRY_COST = MTT_WALLET_BUY_IN + MTT_WALLET_ENTRY_FEE;
