import { expect, it } from 'vitest';
import type { ProgressionSnapshot } from '@/lib/progression/types';
import { buildPublicCosmetics } from './public-cosmetics';

it('publishes only equipped title and frame identifiers', () => {
  const snapshot = {
    equipment: {
      title: 'dojo-title-sprout-challenger',
      frame: 'dojo-frame-cherry-blossom',
      skin: 'affinity-sakura-skin',
      cutin: 'affinity-sakura-cutin',
    },
    affinities: [{ characterId: 'sakura', level: 20 }],
    inventory: [{ itemId: 'secret-item' }],
  } as unknown as ProgressionSnapshot;

  expect(buildPublicCosmetics(snapshot)).toEqual({
    titleId: 'dojo-title-sprout-challenger',
    frameId: 'dojo-frame-cherry-blossom',
  });
  expect(JSON.stringify(buildPublicCosmetics(snapshot))).not.toMatch(
    /skin|cutin|affinit|inventory|secret/u,
  );
});
