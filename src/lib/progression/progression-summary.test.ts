import { describe, expect, it } from 'vitest';
import { isImportantProgressionItem } from './progression-summary';

describe('progression summary importance', () => {
  it('keeps stackable streak fragments compact', () => {
    expect(isImportantProgressionItem('streak-fragment')).toBe(false);
  });

  it('uses a cut-in for permanent visual milestones', () => {
    expect(isImportantProgressionItem('dojo-frame-cherry-blossom')).toBe(true);
    expect(isImportantProgressionItem('affinity-sakura-skin')).toBe(true);
  });
});
