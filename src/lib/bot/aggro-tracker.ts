/**
 * 상대 공격성 추적 — 봇의 "상습 쇼버/레이저 대응" 특별 케이스용 (방 단위, 인메모리).
 *
 * 목적: GTO 기본값은 노리드 올인에 폴드가 맞지만, 그 결과 "올인만 하면 봇이 다 접는"
 * 착취 루트가 생긴다 (2026-07-21 유저 피드백). 정교한 익스플로잇 엔진이 아니라,
 * 최근 윈도우에서 쇼브/레이즈가 임계값을 넘으면 봇이 맞서기 시작하는 단순 트리거다.
 * 해석 계약은 bot-ai.ts의 OpponentAggro 소비부 참조.
 *
 * 휴먼의 raise/all-in 액션을 RoomManager가 기록하고, 봇 턴에 현재 어그레서
 * (state.lastAggressorId)의 최근 수치를 조회해 decideBotAction에 넘긴다.
 */

export interface OpponentAggro {
  /** 최근 윈도우 내 올인(쇼브) 횟수 */
  shoves: number;
  /** 최근 윈도우 내 레이즈 횟수 (스트리트별 액션 단위) */
  raises: number;
}

/** 집계 윈도우 — 이 핸드 수보다 오래된 이벤트는 잊는다 (한때 몰아친 사람을 영구 낙인하지 않게) */
export const AGGRO_WINDOW_HANDS = 12;

interface AggroEvent {
  handNumber: number;
  kind: 'shove' | 'raise';
}

export class AggroTracker {
  private events = new Map<string, AggroEvent[]>();

  record(playerId: string, kind: 'shove' | 'raise', handNumber: number): void {
    const list = this.events.get(playerId) ?? [];
    list.push({ handNumber, kind });
    // 윈도우 밖 이벤트는 기록 시점에 정리 — 리스트가 무한히 자라지 않게
    while (list.length > 0 && list[0].handNumber < handNumber - AGGRO_WINDOW_HANDS) {
      list.shift();
    }
    this.events.set(playerId, list);
  }

  stats(playerId: string, currentHandNumber: number): OpponentAggro {
    const list = this.events.get(playerId) ?? [];
    let shoves = 0;
    let raises = 0;
    for (const event of list) {
      if (event.handNumber < currentHandNumber - AGGRO_WINDOW_HANDS) continue;
      if (event.kind === 'shove') shoves += 1;
      else raises += 1;
    }
    return { shoves, raises };
  }

  remove(playerId: string): void {
    this.events.delete(playerId);
  }
}
