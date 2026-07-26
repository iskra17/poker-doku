import { describe, it, expect } from 'vitest';
import {
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  formatInviteCode,
  generateInviteCode,
  normalizeInviteCode,
} from './invite-code';

describe('invite code', () => {
  it('generates six characters from the unambiguous alphabet', () => {
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const code = generateInviteCode();
      expect(code).toHaveLength(INVITE_CODE_LENGTH);
      for (const char of code) {
        expect(INVITE_CODE_ALPHABET).toContain(char);
      }
    }
  });

  it('never emits characters people misread aloud', () => {
    // 0/O, 1/I/L은 전화나 음성으로 불러줄 때 가장 많이 틀린다
    for (const confusable of ['0', 'O', '1', 'I', 'L']) {
      expect(INVITE_CODE_ALPHABET).not.toContain(confusable);
    }
  });

  it('spreads across the alphabet rather than favouring a prefix', () => {
    const seen = new Set<string>();
    for (let attempt = 0; attempt < 4_000; attempt += 1) {
      for (const char of generateInviteCode()) seen.add(char);
    }
    expect(seen.size).toBe(INVITE_CODE_ALPHABET.length);
  });

  it('accepts what a person actually types', () => {
    const code = generateInviteCode();
    expect(normalizeInviteCode(code.toLowerCase())).toBe(code);
    expect(normalizeInviteCode(` ${code} `)).toBe(code);
    expect(normalizeInviteCode(
      `${code.slice(0, 3)}-${code.slice(3)}`,
    )).toBe(code);
  });

  it('rejects anything that is not a whole code', () => {
    for (const bad of ['', 'ABC', 'ABCDEFG', 'ABC!@#', '한글코드']) {
      expect(normalizeInviteCode(bad)).toBeNull();
    }
  });

  it('rejects a well-formed code containing an excluded character', () => {
    // 사람이 O를 0으로 잘못 옮겨 적은 경우 — 조용히 다른 방으로 보내지 않는다
    expect(normalizeInviteCode('ABCDE0')).toBeNull();
    expect(normalizeInviteCode('ABCDEI')).toBeNull();
  });

  it('formats a code in halves for reading aloud', () => {
    expect(formatInviteCode('ABCDEF')).toBe('ABC-DEF');
    expect(formatInviteCode('bad')).toBe('bad');
  });
});
