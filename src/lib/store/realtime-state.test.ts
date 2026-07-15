import { describe, expect, it } from 'vitest';
import { actionFailureMessage, canSendAction, shouldApplyGameUpdate } from './realtime-state';

describe('실시간 클라이언트 상태 결정', () => {
  it('현재 방 업데이트만 적용한다', () => {
    expect(shouldApplyGameUpdate('room-a', 'room-a')).toBe(true);
    expect(shouldApplyGameUpdate('room-a', 'room-b')).toBe(false);
    expect(shouldApplyGameUpdate(null, 'room-a')).toBe(false);
  });

  it('연결 중이고 pending 액션이 없을 때만 보낼 수 있다', () => {
    expect(canSendAction(true, false)).toBe(true);
    expect(canSendAction(false, false)).toBe(false);
    expect(canSendAction(true, true)).toBe(false);
  });

  it('stale와 timeout을 사용자가 이해할 한국어로 바꾼다', () => {
    expect(actionFailureMessage('stale-state')).toBe('상태가 바뀌어 액션을 다시 선택해 주세요.');
    expect(actionFailureMessage('join-timeout')).toBe('액션 전송을 확인하지 못해 현재 상태를 다시 불러왔어요.');
  });
});
