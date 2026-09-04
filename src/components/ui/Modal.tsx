'use client';

import { useEffect, useId, useRef, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { containModalFocus, focusModalStart, focusTrapTarget, isModalDismissKey, modalFocusableElements } from './modal-a11y';

/**
 * 화면 레이어 계약 (z-index):
 *   0~40   테이블 내부 absolute 레이어 + 인룸 fixed 크롬(TopBar/ActionBar/채팅 시트)
 *   90     PWA 설치 배너 (InstallPrompt)
 *   100+   모달 (이 컴포넌트) — document.body portal이라 어느 스태킹 컨텍스트에서 열어도 최상위
 * 모달은 반드시 이 컴포넌트를 거칠 것: TopBar(z-30) 같은 스태킹 컨텍스트 안에서 fixed로 띄우면
 * DOM상 뒤에 오는 채팅 시트(z-40)·좌석 말풍선(z-30)이 모달을 덮는다 (2026-07-21 QA).
 */

const emptySubscribe = () => () => {};
/** SSR 안전 클라이언트 감지 — document.body portal은 클라이언트에서만 렌더 */
function useIsClient() {
  return useSyncExternalStore(emptySubscribe, () => true, () => false);
}

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  /** 패널 최대 폭 클래스 (기본 max-w-md) — 넓은 콘텐츠(핸드 히스토리 컬럼 뷰 등)용 */
  maxWidthClass?: string;
  dismissible?: boolean;
  /** Reset focus and internal scroll when the displayed question/content changes. */
  contentKey?: string;
}

export default function Modal({ isOpen, onClose, title, children, maxWidthClass = 'max-w-md', dismissible = true, contentKey }: ModalProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const isClient = useIsClient();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen || !isClient) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        if (isModalDismissKey(event.key, dismissible)) onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const dialog = dialogRef.current;
      if (!dialog) return;
      const focusable = modalFocusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const targetIndex = focusTrapTarget(
        focusable.indexOf(document.activeElement as HTMLElement),
        focusable.length,
        event.shiftKey,
      );
      if (targetIndex === null) return;
      event.preventDefault();
      focusable[targetIndex]?.focus();
    };
    const repairFocus = () => {
      if (dialogRef.current) containModalFocus(dialogRef.current, document.activeElement);
    };
    // Non-dismissible quiz controls can all become disabled while a reply is pending.
    const observer = !dismissible ? new MutationObserver(repairFocus) : null;
    if (observer && dialogRef.current) {
      observer.observe(dialogRef.current, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'hidden', 'tabindex'] });
      document.addEventListener('focusin', repairFocus);
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      observer?.disconnect();
      document.removeEventListener('focusin', repairFocus);
      document.removeEventListener('keydown', handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [isOpen, isClient, dismissible]);

  useEffect(() => {
    if (!isOpen || !isClient) return;
    const focusFrame = window.requestAnimationFrame(() => {
      if (dialogRef.current) focusModalStart(dialogRef.current, contentRef.current);
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, [isOpen, isClient, contentKey]);

  if (!isClient) return null;

  return createPortal(
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100]"
            onClick={dismissible ? onClose : undefined}
            aria-hidden="true"
          />
          {/* flex 센터링 래퍼 — 패널에 transform 클래스를 쓰지 않아 framer 애니메이션과 충돌 없음 */}
          <div className="fixed inset-0 z-[110] flex items-center justify-center p-4 pointer-events-none">
            <motion.div
              ref={dialogRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby={titleId}
              tabIndex={-1}
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.9, y: 20 }}
              className={`w-full ${maxWidthClass} max-h-full pointer-events-auto`}
            >
              {/* 패널 — 화면보다 길어지면 본문만 내부 스크롤 */}
              <div className="bg-panel border border-mystic/30 rounded-2xl shadow-2xl shadow-mystic/10 p-6 flex flex-col max-h-[calc(100dvh-2rem)]">
                <div className="flex items-center justify-between mb-4 flex-none">
                  <h2
                    id={titleId}
                    className="text-xl font-bold text-mystic"
                  >
                    {title}
                  </h2>
                  {dismissible && <button
                    type="button"
                    onClick={onClose}
                    aria-label={`${title} 닫기`}
                    className="text-ink-dim hover:text-ink text-2xl leading-none"
                  >
                    &times;
                  </button>}
                </div>
                <div ref={contentRef} className="flex-1 min-h-0 overflow-y-auto overscroll-contain scrollbar-thin -mr-2 pr-2">
                  {children}
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
