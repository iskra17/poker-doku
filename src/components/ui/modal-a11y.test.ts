import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { containModalFocus, focusModalStart, focusTrapTarget, isModalDismissKey } from './modal-a11y';

describe('modal keyboard accessibility', () => {
  it('dismisses only for Escape', () => {
    expect(isModalDismissKey('Escape')).toBe(true);
    expect(isModalDismissKey('Enter')).toBe(false);
    expect(isModalDismissKey('Escape', false)).toBe(false);
  });

  function fixture() {
    const first = { focus: vi.fn(), matches: () => false, closest: () => null, getClientRects: () => [1] } as unknown as HTMLElement;
    const last = { focus: vi.fn(), matches: () => false, closest: () => null, getClientRects: () => [1] } as unknown as HTMLElement;
    let controls = [first, last];
    const dialog = {
      focus: vi.fn(),
      querySelectorAll: vi.fn(() => controls),
      contains: (node: unknown) => node === first || node === last || node === dialog,
    } as unknown as HTMLElement;
    return { first, last, dialog, disableAll: () => { controls = []; } };
  }

  it('starts each question at its first enabled control without scrolling the document', () => {
    const { first, dialog } = fixture();
    const content = { scrollTop: 260 };
    focusModalStart(dialog, content);
    expect(first.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(content.scrollTop).toBe(0);
  });

  it('skips disabled tabindex controls and controls hidden by layout or an ancestor', () => {
    const { first, last, dialog } = fixture();
    first.matches = () => true;
    focusModalStart(dialog);
    expect(last.focus).toHaveBeenCalledOnce();
    first.matches = () => false;
    first.closest = () => ({}) as Element;
    last.getClientRects = () => [] as unknown as DOMRectList;
    focusModalStart(dialog);
    expect(dialog.focus).toHaveBeenCalledOnce();
  });

  it('keeps a valid internal focus but repairs outside focus', () => {
    const { first, last, dialog } = fixture();
    containModalFocus(dialog, last);
    expect(first.focus).not.toHaveBeenCalled();
    containModalFocus(dialog, null);
    expect(first.focus).toHaveBeenCalledOnce();
  });

  it('focuses the dialog when pending/offline disables every control, including the focused one', () => {
    const { first, dialog, disableAll } = fixture();
    disableAll();
    containModalFocus(dialog, first);
    expect(dialog.focus).toHaveBeenCalledWith({ preventScroll: true });
    focusModalStart(dialog);
    expect(dialog.focus).toHaveBeenCalledTimes(2);
    containModalFocus(dialog, dialog);
    expect(dialog.focus).toHaveBeenCalledTimes(2);
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
