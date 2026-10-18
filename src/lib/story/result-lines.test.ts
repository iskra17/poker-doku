import { describe, expect, it } from 'vitest';
import { partnerResultLine, type ResultLineKind } from './result-lines';

const HEROINES = ['sakura', 'ara', 'hana', 'chloe', 'vivian', 'elena'];
const KINDS: ResultLineKind[] = ['pass', 'sGrade', 'fail'];

describe('partnerResultLine', () => {
  it('히로인마다 결과별 대사가 있고 구체 숫자·자리표시자는 없다', () => {
    const lines = HEROINES.flatMap(id => KINDS.map(kind => partnerResultLine(id, kind)));
    expect(new Set(lines).size).toBe(18);
    for (const line of lines) {
      expect(line).not.toMatch(/[0-9{}]/);
      expect(line.length).toBeGreaterThan(5);
    }
  });

  it('말투와 호칭을 유지한다', () => {
    for (const kind of KINDS) {
      expect(partnerResultLine('sakura', kind)).toMatch(/^[가-힣],/);
      expect(partnerResultLine('hana', kind)).toContain('당신');
      expect(partnerResultLine('vivian', kind)).toContain('자기');
      expect(partnerResultLine('elena', kind)).toMatch(/^…/);
      expect(partnerResultLine('elena', kind).length).toBeLessThan(25);
      expect(partnerResultLine('ara', kind)).not.toMatch(/요[.!…]?$/);
    }
    expect(partnerResultLine('chloe', 'sGrade')).toContain('하이라이트');
  });

  it('실패는 탓하지 않고 함께 재도전하도록 격려한다', () => {
    for (const id of [...HEROINES, 'miyako', null]) {
      const line = partnerResultLine(id, 'fail');
      expect(line).toMatch(/같이|함께|곁|응원/);
      expect(line).not.toMatch(/네 탓|당신 탓|왜 그랬|실망|못하|바보|했어야|말했잖/);
    }
  });

  it('미지원 캐릭터와 null은 같은 중립 대사를 쓴다', () => {
    for (const kind of KINDS) {
      expect(partnerResultLine('miyako', kind)).toBe(partnerResultLine(null, kind));
      expect(partnerResultLine('unknown', kind)).toBe(partnerResultLine(null, kind));
    }
  });
});
