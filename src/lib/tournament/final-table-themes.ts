import type { CSSProperties } from 'react';

export const FINAL_TABLE_THEMES = {
  'sakura-championship': {
    label: '벚꽃 챔피언십',
    felt: '#23544b',
    feltGlow: '#4b8b78',
    accent: '#f6b9c9',
    highlight: '#ffe4a3',
    railTop: '#613b50',
    railBottom: '#241a2a',
    stage: '#140c1c',
    particle: '#ffd9e4',
    particleRadius: '70% 15% 70% 20%',
  },
  'gold-spotlight': {
    label: '골드 스포트라이트',
    felt: '#172c29',
    feltGlow: '#355047',
    accent: '#d8aa4d',
    highlight: '#fff0b5',
    railTop: '#594820',
    railBottom: '#18150f',
    stage: '#0d0b08',
    particle: '#f2d17c',
    particleRadius: '50%',
  },
  'neon-arena': {
    label: '네온 아레나',
    felt: '#102a35',
    feltGlow: '#164e63',
    accent: '#2dd4bf',
    highlight: '#f472b6',
    railTop: '#123b4c',
    railBottom: '#100d28',
    stage: '#060b18',
    particle: '#67e8f9',
    particleRadius: '2px',
  },
} as const;

export type FinalTableTheme = keyof typeof FINAL_TABLE_THEMES;
export type FinalTableThemePreset = (typeof FINAL_TABLE_THEMES)[FinalTableTheme];

const DEFAULT_FINAL_TABLE_THEME: FinalTableTheme = 'sakura-championship';

export function resolveFinalTableTheme(theme: string | null | undefined): FinalTableThemePreset {
  if (theme && Object.hasOwn(FINAL_TABLE_THEMES, theme)) {
    return FINAL_TABLE_THEMES[theme as FinalTableTheme];
  }
  return FINAL_TABLE_THEMES[DEFAULT_FINAL_TABLE_THEME];
}

export function finalTableThemeStyle(theme: FinalTableThemePreset): CSSProperties {
  return {
    '--final-felt': theme.felt,
    '--final-felt-glow': theme.feltGlow,
    '--final-accent': theme.accent,
    '--final-highlight': theme.highlight,
    '--final-rail-top': theme.railTop,
    '--final-rail-bottom': theme.railBottom,
    '--final-stage': theme.stage,
    '--final-particle': theme.particle,
    '--final-particle-radius': theme.particleRadius,
  } as CSSProperties;
}
