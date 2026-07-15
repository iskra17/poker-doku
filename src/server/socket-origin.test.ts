import { describe, expect, it } from 'vitest';
import { isSocketOriginAllowed, parseSocketAllowedOrigins } from './socket-origin';

describe('Socket.IO origin 정책', () => {
  it('개발 환경은 모든 origin을 허용한다', () => {
    expect(isSocketOriginAllowed('https://evil.example', 'game.example', {
      production: false,
      allowedOrigins: new Set(),
    })).toBe(true);
  });

  it('운영은 origin 없는 도구·동일 호스트·명시 allow-list만 허용한다', () => {
    const options = {
      production: true,
      allowedOrigins: new Set(['https://friends.example']),
    };
    expect(isSocketOriginAllowed(undefined, 'game.example', options)).toBe(true);
    expect(isSocketOriginAllowed('https://game.example', 'game.example', options)).toBe(true);
    expect(isSocketOriginAllowed('https://friends.example', 'game.example', options)).toBe(true);
    expect(isSocketOriginAllowed('https://evil.example', 'game.example', options)).toBe(false);
    expect(isSocketOriginAllowed('not a url', 'game.example', options)).toBe(false);
  });

  it('쉼표 allow-list를 유효한 exact origin으로 정규화한다', () => {
    expect(parseSocketAllowedOrigins(
      'https://a.example/, https://b.example:8443/path, invalid',
    )).toEqual(new Set([
      'https://a.example',
      'https://b.example:8443',
    ]));
  });
});
