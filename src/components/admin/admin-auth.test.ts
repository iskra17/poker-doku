import { describe, expect, it } from 'vitest';
import {
  buildAdminSessionBody,
  getAdminRequestErrorMessage,
} from './admin-auth';

describe('admin trusted device UI helpers', () => {
  it('only includes a trimmed device name for an opted-in login', () => {
    expect(buildAdminSessionBody('  secret  ', false, '  작업실  ')).toEqual({
      token: '  secret  ',
      rememberDevice: false,
    });
    expect(buildAdminSessionBody('secret', true, '  작업실  ')).toEqual({
      token: 'secret',
      rememberDevice: true,
      deviceName: '작업실',
    });
  });

  it('caps the optional device name at the UI contract limit', () => {
    const name = 'a'.repeat(100);
    expect(buildAdminSessionBody('secret', true, name).deviceName).toHaveLength(80);
  });

  it('keeps authentication errors distinct from connectivity and server failures', () => {
    expect(getAdminRequestErrorMessage(401, 'login')).toContain('토큰');
    expect(getAdminRequestErrorMessage(403, 'devices')).toContain('보안');
    expect(getAdminRequestErrorMessage(409, 'login')).toContain('한도');
    expect(getAdminRequestErrorMessage(503, 'devices')).toContain('저장');
    expect(getAdminRequestErrorMessage(503, 'logout')).toContain('로그아웃');
    expect(getAdminRequestErrorMessage(null, 'logout')).toContain('연결');
  });
});
