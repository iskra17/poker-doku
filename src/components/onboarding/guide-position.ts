export interface GuideRect { left: number; top: number; width: number; height: number }
export interface GuideLayout { target: GuideRect; tip: GuideRect }

/** Never cover the control being taught or draw a callout outside the visible (keyboard-aware) viewport. */
export function positionGuide(target: GuideRect, viewport: GuideRect, tipHeight: number): GuideLayout | null {
  const margin = 12, gap = 12;
  const right = viewport.left + viewport.width, bottom = viewport.top + viewport.height;
  if (target.width <= 0 || target.height <= 0 || viewport.width < 120
    || target.left + target.width <= viewport.left || target.left >= right
    || target.top + target.height <= viewport.top || target.top >= bottom) return null;
  const width = Math.min(288, viewport.width - margin * 2);
  const height = Math.max(72, tipHeight);
  const below = target.top + target.height + gap;
  const above = target.top - gap - height;
  const top = below + height <= bottom - margin ? below : above >= viewport.top + margin ? above : null;
  if (top === null) return null;
  return {
    target: {
      left: Math.max(viewport.left + 4, target.left - 4),
      top: Math.max(viewport.top + 4, target.top - 4),
      width: Math.min(right - 4, target.left + target.width + 4) - Math.max(viewport.left + 4, target.left - 4),
      height: Math.min(bottom - 4, target.top + target.height + 4) - Math.max(viewport.top + 4, target.top - 4),
    },
    tip: { left: Math.max(viewport.left + margin, Math.min(right - margin - width, target.left + target.width / 2 - width / 2)), top, width, height },
  };
}
