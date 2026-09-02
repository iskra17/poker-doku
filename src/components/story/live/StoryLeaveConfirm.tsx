'use client';

import Modal from '@/components/ui/Modal';

interface StoryLeaveConfirmProps {
  isOpen: boolean;
  pending: boolean;
  onClose: () => void;
  onAbandon: () => void;
}

/**
 * 스토리 라이브 방의 나가기 확인 — 자리비움/나가기 예약은 서버가 거절하므로(이탈 경로는
 * `abandon-story` 하나뿐) LeaveRoomModal 대신 이 카드를 띄운다.
 */
export default function StoryLeaveConfirm({ isOpen, pending, onClose, onAbandon }: StoryLeaveConfirmProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="수련을 그만둘까요?">
      <div className="space-y-3">
        <p className="text-sm leading-relaxed text-ink-dim">
          진행 중인 챕터가 처음부터 다시 시작돼요. 지금까지 푼 수련 문제 기록은 남지만, 이 챕터는
          다음에 다시 처음부터 진행하게 돼요.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 rounded-xl bg-gradient-to-r from-mystic to-blossom px-3 py-2.5 text-sm font-bold text-white"
          >
            계속 수련
          </button>
          <button
            type="button"
            onClick={onAbandon}
            disabled={pending}
            className="flex-1 rounded-xl border border-white/15 bg-elevated px-3 py-2.5 text-sm font-bold text-ink-dim transition-colors hover:text-ink disabled:opacity-50"
          >
            그만두기
          </button>
        </div>
      </div>
    </Modal>
  );
}
