import { describe, expect, it } from 'vitest';
import {
  getSeatVisualClasses,
  resolveSeatVisualState,
} from './player-seat-visual';

describe('resolveSeatVisualState', () => {
  it('keeps a timeout auto-check seat visually normal during the current hand', () => {
    expect(resolveSeatVisualState({
      status: 'active',
      chips: 1_200,
      sitOutNext: true,
      sitOutAuto: true,
    })).toBe('normal');
  });

  it('treats an actual fold as folded even when timeout sit-out flags are present', () => {
    expect(resolveSeatVisualState({
      status: 'folded',
      chips: 1_200,
      sitOutNext: true,
      sitOutAuto: true,
    })).toBe('folded');
  });

  it.each([
    {
      status: 'sitting-out' as const,
      chips: 1_200,
      sitOutNext: false,
      sitOutAuto: false,
    },
    {
      status: 'active' as const,
      chips: 1_200,
      sitOutNext: true,
      sitOutAuto: false,
    },
  ])('treats explicit away state as away: %o', (player) => {
    expect(resolveSeatVisualState(player)).toBe('away');
  });

  it('treats a zero-chip non-all-in seat as busted', () => {
    expect(resolveSeatVisualState({
      status: 'active',
      chips: 0,
      sitOutNext: false,
      sitOutAuto: false,
    })).toBe('busted');
  });

  it('does not treat a live zero-chip all-in seat as busted', () => {
    expect(resolveSeatVisualState({
      status: 'all-in',
      chips: 0,
      sitOutNext: false,
      sitOutAuto: false,
    })).toBe('normal');
  });
});

describe('getSeatVisualClasses', () => {
  it('strongly grays the folded portrait while preserving card color with heavy fading', () => {
    const classes = getSeatVisualClasses('folded');

    expect(classes.portrait).toContain('grayscale');
    expect(classes.portrait).toContain('opacity-35');
    expect(classes.cards).toContain('opacity-25');
    expect(classes.cards).not.toContain('grayscale');
    expect(classes.plate).toContain('opacity-65');
  });

  it.each(['away', 'busted'] as const)('keeps %s seats and cards dimmed in grayscale', (state) => {
    const classes = getSeatVisualClasses(state);

    expect(classes.portrait).toContain('grayscale');
    expect(classes.cards).toContain('grayscale');
  });

  it('does not dim a normal seat', () => {
    expect(getSeatVisualClasses('normal')).toEqual({
      portrait: '',
      cards: '',
      plate: '',
    });
  });
});
