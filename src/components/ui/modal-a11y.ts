export function isModalDismissKey(key: string, dismissible = true): boolean {
  return dismissible && key === 'Escape';
}

export function modalFocusableElements(dialog: HTMLElement): HTMLElement[] {
  return Array.from(dialog.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  )).filter(element => !element.matches(':disabled')
    && !element.closest('[hidden], [inert], [aria-hidden="true"]')
    && element.getClientRects().length > 0);
}

export function focusModalStart(dialog: HTMLElement, content?: Pick<HTMLElement, 'scrollTop'> | null): void {
  (modalFocusableElements(dialog)[0] ?? dialog).focus({ preventScroll: true });
  if (content) content.scrollTop = 0;
}

/** Disabled controls can keep activeElement until the next Tab or browser blur. */
export function containModalFocus(dialog: HTMLElement, active: Element | null): void {
  if (active === dialog || modalFocusableElements(dialog).includes(active as HTMLElement)) return;
  focusModalStart(dialog);
}

export function focusTrapTarget(
  currentIndex: number,
  focusableCount: number,
  backwards: boolean,
): number | null {
  if (focusableCount <= 0) return null;
  if (currentIndex < 0) return backwards ? focusableCount - 1 : 0;
  if (backwards && currentIndex === 0) return focusableCount - 1;
  if (!backwards && currentIndex === focusableCount - 1) return 0;
  return null;
}
