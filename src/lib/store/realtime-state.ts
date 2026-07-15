import type { RealtimeErrorCode } from '../realtime/protocol';

export function shouldApplyGameUpdate(
  currentRoomId: string | null,
  updateRoomId: string,
): boolean {
  return currentRoomId !== null && currentRoomId === updateRoomId;
}

export function canSendAction(connected: boolean, hasPendingAction: boolean): boolean {
  return connected && !hasPendingAction;
}

export function actionFailureMessage(code: RealtimeErrorCode): string {
  if (code === 'stale-state') return '상태가 바뀌어 액션을 다시 선택해 주세요.';
  if (code === 'join-timeout') return '액션 전송을 확인하지 못해 현재 상태를 다시 불러왔어요.';
  return '액션을 처리하지 못했어요. 다시 선택해 주세요.';
}
