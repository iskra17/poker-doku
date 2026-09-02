'use client';

interface PracticePromptBannerProps {
  text: string;
  onDismiss: () => void;
}

/**
 * '연습' 프리셋 스텝의 안내 배너 — 스텝당 한 번, 닫으면 그 스텝에서는 다시 뜨지 않는다.
 * 스타일은 GameRoomView의 '착석 대기' 배너와 같은 문법(상단 얇은 띠)으로 맞춘다.
 */
export default function PracticePromptBanner({ text, onDismiss }: PracticePromptBannerProps) {
  return (
    <div className="pointer-events-auto absolute inset-x-0 top-0 z-30 flex items-center justify-center gap-2 border-b border-cyber/30 bg-elevated/95 px-3 py-1.5 text-center text-xs text-cyber">
      <span className="min-w-0">🀄 {text}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="연습 안내 닫기"
        className="shrink-0 rounded-md border border-cyber/40 px-2 py-0.5 font-bold transition-colors hover:bg-cyber/15"
      >
        닫기
      </button>
    </div>
  );
}
