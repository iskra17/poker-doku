import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { focusTrapTarget, isModalDismissKey } from './modal-a11y';

describe('modal keyboard accessibility', () => {
  it('dismisses only for Escape', () => {
    expect(isModalDismissKey('Escape')).toBe(true);
    expect(isModalDismissKey('Enter')).toBe(false);
  });

  it('wraps Tab focus at both ends of the dialog', () => {
    expect(focusTrapTarget(2, 3, false)).toBe(0);
    expect(focusTrapTarget(0, 3, true)).toBe(2);
    expect(focusTrapTarget(1, 3, false)).toBeNull();
    expect(focusTrapTarget(-1, 3, false)).toBe(0);
  });

  it('wires dialog semantics, labelling, and focus restoration in Modal', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/components/ui/Modal.tsx'), 'utf8');
    expect(source).toContain('role="dialog"');
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain('aria-labelledby={titleId}');
    expect(source).toContain('previouslyFocused?.focus()');
    expect(source).toContain("document.removeEventListener('keydown', handleKeyDown)");
  });
});
