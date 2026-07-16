import type { ProgressionSnapshot } from '@/lib/progression/types';

export interface PublicCosmetics {
  titleId: string | null;
  frameId: string | null;
}

export function buildPublicCosmetics(
  snapshot: Pick<ProgressionSnapshot, 'equipment'>,
): PublicCosmetics {
  return {
    titleId: snapshot.equipment.title,
    frameId: snapshot.equipment.frame,
  };
}
