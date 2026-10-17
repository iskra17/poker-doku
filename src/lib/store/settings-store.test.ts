import { describe, expect, it } from 'vitest';
import { SETTINGS_PERSIST_VERSION, migrateSettings, useSettingsStore } from './settings-store';

/**
 * persist 마이그레이션 회귀 — 저장된 설정은 사용자 브라우저에 남아 있으므로 버전을 올릴 때마다
 * "없던 키"의 기본값이 실제로 채워지는지 고정한다.
 */
describe('settings-store persist', () => {
  it('버전은 7 — 파트너 실시간 훈수가 추가된 시점', () => {
    expect(SETTINGS_PERSIST_VERSION).toBe(7);
  });

  it('v6 이하 저장본에는 partnerCoach를 켬(true)으로 채우고, 끈 선택은 유지한다', () => {
    expect(migrateSettings({ muted: true }).partnerCoach).toBe(true);
    expect(migrateSettings({ partnerCoach: 'yes' as never }).partnerCoach).toBe(true);
    expect(migrateSettings({ partnerCoach: false }).partnerCoach).toBe(false);
  });

  it('기본 상태의 파트너 훈수는 켜져 있고 토글로 뒤집힌다', () => {
    expect(useSettingsStore.getState().partnerCoach).toBe(true);
    useSettingsStore.getState().togglePartnerCoach();
    expect(useSettingsStore.getState().partnerCoach).toBe(false);
    useSettingsStore.getState().togglePartnerCoach();
    expect(useSettingsStore.getState().partnerCoach).toBe(true);
  });

  it('v5 이하 저장본에는 skillBurst를 full로 채우고, 고른 값은 유지한다', () => {
    expect(migrateSettings({ muted: true }).skillBurst).toBe('full');
    expect(migrateSettings({ skillBurst: 'loud' as never }).skillBurst).toBe('full');
    expect(migrateSettings({ skillBurst: 'off' }).skillBurst).toBe('off');
  });

  it('v4 이하 저장본에는 showBonusCg를 기본 노출(true)로 채운다', () => {
    expect(migrateSettings({ muted: true })).toMatchObject({ muted: true, showBonusCg: true });
    // 잘못된 값도 기본값으로 교정한다
    expect(migrateSettings({ showBonusCg: 'nope' }).showBonusCg).toBe(true);
  });

  it('이미 꺼 둔 사용자의 선택은 유지한다', () => {
    expect(migrateSettings({ showBonusCg: false }).showBonusCg).toBe(false);
  });

  it('기존 v2~v4 규칙도 그대로 — 캐릭터 id 이관·삭제된 카드 스타일·BGM 기본값', () => {
    expect(migrateSettings({ profileCharacter: 'ryuka', deckStyle: 'classic' }))
      .toMatchObject({ profileCharacter: 'ara', deckStyle: 'solid', musicTrackPrefs: {} });
  });

  it('기본 상태의 보너스 CG는 켜져 있고 토글로 뒤집힌다', () => {
    expect(useSettingsStore.getState().showBonusCg).toBe(true);
    useSettingsStore.getState().toggleBonusCg();
    expect(useSettingsStore.getState().showBonusCg).toBe(false);
    useSettingsStore.getState().toggleBonusCg();
    expect(useSettingsStore.getState().showBonusCg).toBe(true);
  });
});
