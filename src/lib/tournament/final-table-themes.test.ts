import { describe, expect, it } from 'vitest';
import {
  FINAL_TABLE_THEMES,
  resolveFinalTableTheme,
} from './final-table-themes';

describe('final table themes', () => {
  it('ships all server-selectable final table presets', () => {
    expect(Object.keys(FINAL_TABLE_THEMES)).toEqual([
      'sakura-championship',
      'gold-spotlight',
      'neon-arena',
    ]);
  });

  it('falls back to Sakura for an absent or unknown server theme key', () => {
    expect(resolveFinalTableTheme(undefined)).toBe(FINAL_TABLE_THEMES['sakura-championship']);
    expect(resolveFinalTableTheme('future-theme')).toBe(FINAL_TABLE_THEMES['sakura-championship']);
  });
});
