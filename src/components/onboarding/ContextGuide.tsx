'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { positionGuide, type GuideLayout } from './guide-position';

interface ContextGuideProps {
  target: string;
  children: string;
  onDismiss: () => void;
}

/** A pointer-through highlight: the original control and its server action remain the only way forward. */
export default function ContextGuide({ target, children, onDismiss }: ContextGuideProps) {
  const id = useId();
  const bubble = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ selector: string; layout: GuideLayout } | null>(null);
  useEffect(() => {
    let frame = 0;
    let current: Element | null = null;
    let oldDescription: string | null = null;
    const restore = () => {
      if (current?.getAttribute('aria-describedby') === [oldDescription, id].filter(Boolean).join(' ')) {
        if (oldDescription === null) current.removeAttribute('aria-describedby');
        else current.setAttribute('aria-describedby', oldDescription);
      }
      current = null;
    };
    const measure = () => {
      frame = 0;
      const element = document.querySelector<HTMLElement>(target);
      const rect = element?.getBoundingClientRect();
      const view = window.visualViewport;
      const dialogs = Array.from(document.querySelectorAll<HTMLElement>('[aria-modal="true"]'));
      const blocked = dialogs.some(dialog => dialog.getBoundingClientRect().width > 0 && !dialog.contains(element));
      const layout = element && !blocked && !element.matches(':disabled') && rect ? positionGuide(rect, {
        left: view?.offsetLeft ?? 0, top: view?.offsetTop ?? 0,
        width: view?.width ?? window.innerWidth, height: view?.height ?? window.innerHeight,
      }, bubble.current?.getBoundingClientRect().height ?? 112) : null;
      if (element !== current || !layout) {
        restore();
        if (element && layout) {
          current = element;
          oldDescription = element.getAttribute('aria-describedby');
          element.setAttribute('aria-describedby', [oldDescription, id].filter(Boolean).join(' '));
        }
      }
      setPosition(previous => {
        const next = layout ? { selector: target, layout } : null;
        return JSON.stringify(previous) === JSON.stringify(next) ? previous : next;
      });
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled', 'hidden'] });
    const resizer = new ResizeObserver(schedule);
    resizer.observe(document.documentElement);
    window.addEventListener('resize', schedule);
    document.addEventListener('scroll', schedule, true);
    window.visualViewport?.addEventListener('resize', schedule);
    window.visualViewport?.addEventListener('scroll', schedule);
    const interval = window.setInterval(schedule, 250); // tracks animated targets and a late-loading image
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      clearInterval(interval);
      observer.disconnect();
      resizer.disconnect();
      window.removeEventListener('resize', schedule);
      document.removeEventListener('scroll', schedule, true);
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
      restore();
    };
  }, [target, id]);

  if (!position || position.selector !== target) return null;
  const { layout } = position;
  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-[140]" data-context-guide>
      <div aria-hidden className="fixed rounded-xl border-2 border-blossom" style={layout.target} />
      <div ref={bubble} className="pointer-events-auto fixed rounded-xl border border-ink/20 bg-panel px-4 pt-3 text-ink shadow-md"
        style={{ left: layout.tip.left, top: layout.tip.top, width: layout.tip.width }}>
        <p id={id} role="status" className="text-sm leading-relaxed">{children}</p>
        <button type="button" onClick={onDismiss} className="-ml-2 min-h-11 px-2 text-xs text-ink-dim underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-blossom">
          안내 닫기
        </button>
      </div>
    </div>, document.body,
  );
}
