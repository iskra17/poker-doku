export type RecoveryInputEvent =
  | { type: 'change'; value: string }
  | {
      type: 'clear';
      reason: 'submit' | 'failure' | 'success' | 'back' | 'legal-unchecked';
    };

export function reduceRecoveryInput(
  current: string,
  event: RecoveryInputEvent,
): string {
  if (event.type === 'change') return event.value;
  return '';
}
