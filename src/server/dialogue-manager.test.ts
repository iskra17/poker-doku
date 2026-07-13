import { describe, it, expect } from 'vitest';
import { DialogueManager, LineGenerator } from './dialogue-manager';

/**
 * 3층 대화 관리 전략 테스트.
 * persistPath: null — 파일 영속화 없이 순수 로직만 검증.
 */

function stubGenerator(lines: Array<string | null>): LineGenerator & { calls: number } {
  const gen = {
    calls: 0,
    async generateLine(): Promise<string | null> {
      const line = lines[Math.min(gen.calls, lines.length - 1)];
      gen.calls++;
      return line;
    },
  };
  return gen;
}

const mk = (gen: LineGenerator, opts = {}) =>
  new DialogueManager(gen, { persistPath: null, ...opts });

describe('DialogueManager 3층 전략', () => {
  it('풀이 비어 있으면 AI를 호출하고 결과를 풀에 적립한다', async () => {
    const gen = stubGenerator(['첫 대사!']);
    const dm = mk(gen);
    const line = await dm.getLine('room', 'ryuka', 'all-in', '올인했다');
    expect(line).toBe('첫 대사!');
    expect(gen.calls).toBe(1);
    expect(dm.stats.lines).toBe(1);
  });

  it('풀이 minPool 이상이고 reuseChance=1이면 API를 호출하지 않는다', async () => {
    const gen = stubGenerator(['a', 'b', 'c']);
    const dm = mk(gen, { minPool: 3, reuseChance: 0 }); // 먼저 0으로 3개 적립
    await dm.getLine('r', 'hana', 'bigpot-win', '이겼다');
    await dm.getLine('r', 'hana', 'bigpot-win', '이겼다');
    await dm.getLine('r', 'hana', 'bigpot-win', '이겼다');
    expect(gen.calls).toBe(3);

    const dm2 = mk(gen, { minPool: 1, reuseChance: 1 });
    // dm2는 빈 풀 — 1개 적립 후부터는 재사용만
    await dm2.getLine('r', 'hana', 'bigpot-win', '이겼다');
    const before = gen.calls;
    for (let i = 0; i < 10; i++) {
      const line = await dm2.getLine('r', 'hana', 'bigpot-win', '이겼다');
      expect(line).not.toBeNull();
    }
    expect(gen.calls).toBe(before); // 재사용만 — 추가 호출 없음
  });

  it('AI가 게이팅으로 null을 줘도 풀에 대사가 있으면 재사용한다', async () => {
    const gen = stubGenerator(['유일한 대사', null]);
    const dm = mk(gen, { minPool: 99, reuseChance: 0 }); // 재사용 주사위는 항상 실패
    await dm.getLine('r', 'yuki', 'sng-champ', '우승');
    const line = await dm.getLine('r', 'yuki', 'sng-champ', '우승');
    expect(line).toBe('유일한 대사'); // 생성 실패 → 풀 폴백
  });

  it('풀도 비고 AI도 null이면 null (호출부 스크립트 폴백)', async () => {
    const gen = stubGenerator([null]);
    const dm = mk(gen);
    expect(await dm.getLine('r', 'sakura', 'all-in', '올인')).toBeNull();
  });

  it('같은 대사는 중복 적립하지 않고, maxPool 초과 시 교체한다', async () => {
    const gen = stubGenerator(['x', 'x', 'y', 'z', 'w']);
    const dm = mk(gen, { minPool: 99, reuseChance: 0, maxPool: 3 });
    for (let i = 0; i < 5; i++) await dm.getLine('r', 'akira', 'all-in', '올인');
    expect(dm.stats.lines).toBe(3); // x(중복 1회 무시), y, z, w 중 3개 유지
  });

  it('풀에 2개 이상이면 같은 대사를 연속으로 반환하지 않는다', async () => {
    const gen = stubGenerator(['a', 'b']);
    const dm = mk(gen, { minPool: 1, reuseChance: 0 });
    await dm.getLine('r', 'hana', 'all-in', '올인');
    await dm.getLine('r', 'hana', 'all-in', '올인');

    const dm2 = mk(stubGenerator([null]), { minPool: 1, reuseChance: 1 });
    // dm2에 수동 적립이 없으니 dm으로 검증: reuse 전용 매니저 재구성
    const gen3 = stubGenerator(['a', 'b', null]);
    const dm3 = mk(gen3, { minPool: 99, reuseChance: 0 });
    await dm3.getLine('r', 'hana', 'all-in', '올인');
    await dm3.getLine('r', 'hana', 'all-in', '올인');
    let prev: string | null = null;
    for (let i = 0; i < 12; i++) {
      const line = await dm3.getLine('r', 'hana', 'all-in', '올인'); // 생성 null → 풀 재사용
      expect(line).not.toBe(prev);
      prev = line;
    }
    void dm2;
  });

  it('상황 키가 다르면 풀이 분리된다', async () => {
    const gen = stubGenerator(['승리 대사', '탈락 대사']);
    const dm = mk(gen, { minPool: 99, reuseChance: 0 });
    await dm.getLine('r', 'ryuka', 'bigpot-win', '이겼다');
    await dm.getLine('r', 'ryuka', 'sng-bust-noprize', '탈락했다');
    expect(dm.stats.pools).toBe(2);
  });

  it('생성 프롬프트에 구체 숫자 금지 규칙을 덧붙인다', async () => {
    let captured = '';
    const gen: LineGenerator = {
      async generateLine(_s, _c, situation) {
        captured = situation;
        return '대사';
      },
    };
    const dm = mk(gen);
    await dm.getLine('r', 'hana', 'bigpot-win', '팟 3,400 칩을 이겼다');
    expect(captured).toContain('팟 3,400 칩을 이겼다');
    expect(captured).toContain('숫자는 넣지 말 것');
  });
});
