import { describe, expect, it } from 'vitest';
import { operatorAccessFromSet, resolveOperatorAccess } from './operator-access';

describe('resolveOperatorAccess', () => {
  it('production: 목록이 비면 아무도 운영자가 아니다', () => {
    const access = resolveOperatorAccess({ NODE_ENV: 'production' });
    expect(access.mode).toBe('none');
    expect(access.has('anyone')).toBe(false);
  });

  it('development: 목록이 비면 모든 프로필이 운영자다(로컬 QA)', () => {
    const access = resolveOperatorAccess({ NODE_ENV: 'development' });
    expect(access.mode).toBe('all');
    expect(access.has('anyone')).toBe(true);
  });

  it('OPERATOR_PROFILE_IDS ∪ TOURNAMENT_OPERATOR_PROFILE_IDS — 공백·빈 항목 무시, 목록 밖은 거절', () => {
    const access = resolveOperatorAccess({
      NODE_ENV: 'production',
      OPERATOR_PROFILE_IDS: ' p1 , ,p2',
      TOURNAMENT_OPERATOR_PROFILE_IDS: 't1',
    });
    expect(access.mode).toBe('list');
    expect(access.has('p1')).toBe(true);
    expect(access.has('p2')).toBe(true);
    expect(access.has('t1')).toBe(true);
    expect(access.has('p3')).toBe(false);
  });

  it('development라도 목록이 있으면 목록만 허용한다', () => {
    const access = resolveOperatorAccess({ NODE_ENV: 'development', OPERATOR_PROFILE_IDS: 'p1' });
    expect(access.has('p1')).toBe(true);
    expect(access.has('p2')).toBe(false);
  });

  it('operatorAccessFromSet — 명시 집합(테스트 하네스)', () => {
    const ids = new Set<string>();
    const access = operatorAccessFromSet(ids);
    expect(access.has('p1')).toBe(false);
    ids.add('p1');
    expect(access.has('p1')).toBe(true);
  });
});
