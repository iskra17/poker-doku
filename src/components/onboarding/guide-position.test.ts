import { describe, expect, it } from 'vitest';
import { positionGuide } from './guide-position';

describe('guide positioning', () => {
  const viewport = { left: 0, top: 0, width: 320, height: 640 };
  it('keeps a callout above bottom action controls without covering them', () => {
    const layout = positionGuide({ left: 8, top: 580, width: 304, height: 48 }, viewport, 100)!;
    expect(layout.tip.top + layout.tip.height).toBeLessThan(580);
    expect(layout.tip.left).toBeGreaterThanOrEqual(12);
    expect(layout.tip.left + layout.tip.width).toBeLessThanOrEqual(308);
  });
  it('fits below top targets and accounts for an on-screen keyboard viewport', () => {
    const layout = positionGuide({ left: 210, top: 120, width: 90, height: 44 }, { ...viewport, top: 100, height: 280 }, 96)!;
    expect(layout.tip.top).toBeGreaterThan(164);
    expect(layout.tip.top + layout.tip.height).toBeLessThanOrEqual(368);
  });
  it('does not point at a missing, offscreen, or zero-sized target', () => {
    expect(positionGuide({ left: 0, top: 660, width: 90, height: 44 }, viewport, 100)).toBeNull();
    expect(positionGuide({ left: 0, top: 30, width: 0, height: 0 }, viewport, 100)).toBeNull();
    expect(positionGuide({ left: 0, top: 0, width: 320, height: 640 }, viewport, 100)).toBeNull();
  });
});
