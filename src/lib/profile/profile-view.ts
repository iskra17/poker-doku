import type { ProfilePhase } from '@/lib/store/profile-store';

export function shouldRenderAuthenticatedTable(
  phase: ProfilePhase,
  currentRoomId: string | null,
): boolean {
  return phase === 'ready' && currentRoomId !== null;
}
