import { describe, expect, it } from 'vitest';
import { clientAddressFromHeaders } from './client-address';

describe('clientAddressFromHeaders', () => {
  it('프록시 헤더가 없으면 소켓 주소, 그것도 없으면 unknown', () => {
    expect(clientAddressFromHeaders({}, '10.0.0.1')).toBe('10.0.0.1');
    expect(clientAddressFromHeaders({}, undefined)).toBe('unknown');
    expect(clientAddressFromHeaders({}, null)).toBe('unknown');
  });

  it('XFF 마지막 홉을 사용한다 (신뢰 프록시가 append한 실제 접속 IP)', () => {
    expect(
      clientAddressFromHeaders({ 'x-forwarded-for': '203.0.113.9' }, '172.16.0.1'),
    ).toBe('203.0.113.9');
    expect(
      clientAddressFromHeaders({ 'x-forwarded-for': '198.51.100.7, 203.0.113.9' }, '172.16.0.1'),
    ).toBe('203.0.113.9');
  });

  it('클라이언트가 위조해 끼워 넣은 앞쪽 항목은 레이트리밋 키에 닿지 않는다', () => {
    expect(
      clientAddressFromHeaders(
        { 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 203.0.113.9' },
        'proxy',
      ),
    ).toBe('203.0.113.9');
  });

  it('반복된 XFF 헤더는 마지막 헤더의 마지막 홉을 쓴다', () => {
    expect(
      clientAddressFromHeaders(
        { 'x-forwarded-for': ['198.51.100.7', '198.51.100.8, 203.0.113.9'] },
        'proxy',
      ),
    ).toBe('203.0.113.9');
  });

  it('XFF가 없으면 Fly-Client-IP로 폴백한다', () => {
    expect(
      clientAddressFromHeaders({ 'fly-client-ip': '203.0.113.9' }, 'proxy'),
    ).toBe('203.0.113.9');
  });

  it('빈 값·비정상 길이 값은 다음 폴백으로 넘어간다', () => {
    expect(clientAddressFromHeaders({ 'x-forwarded-for': '   ' }, 'sock')).toBe('sock');
    expect(
      clientAddressFromHeaders({ 'x-forwarded-for': 'a'.repeat(100) }, 'sock'),
    ).toBe('sock');
    expect(clientAddressFromHeaders({ 'fly-client-ip': '' }, 'sock')).toBe('sock');
  });
});
