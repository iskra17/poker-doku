'use client';

import Modal from '@/components/ui/Modal';
import { SITOUT_MISSED_BB_LIMIT } from '@/server/sitout';

interface LeaveRoomModalProps {
  isOpen: boolean;
  /** Sit & Go 방 여부 — 자리비움/기권 문구가 달라진다 */
  isSng: boolean;
  onClose: () => void;
  /** 좌석/칩 유지한 채 자리비움으로 나가기 */
  onSitOut: () => void;
  /** 완전히 나가기 (캐시: 좌석 정리 / SnG: 기권) */
  onExit: () => void;
}

/** 나가기 확인 다이얼로그 — 게임을 끝낼지, 자리만 비울지 선택 */
export default function LeaveRoomModal({ isOpen, isSng, onClose, onSitOut, onExit }: LeaveRoomModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="테이블을 떠날까요?">
      <div className="space-y-3">
        <ChoiceButton
          title="자리비움 하고 나가기"
          description={
            isSng
              ? '좌석과 칩을 유지해요. 블라인드는 계속 차감되고 돌아올 때까지 자동 폴드돼요 — 같은 방에 다시 들어오면 복귀!'
              : `좌석과 칩을 유지해요. 빅블라인드를 ${SITOUT_MISSED_BB_LIMIT}번 거르면 자동으로 자리에서 일어나요 — 그 전에 다시 들어오면 복귀!`
          }
          accent="mystic"
          onClick={onSitOut}
        />
        <ChoiceButton
          title={isSng ? '기권하고 나가기' : '완전히 나가기'}
          description={
            isSng
              ? '토너먼트에서 기권해요 — 현재 순위로 탈락 처리되고 되돌릴 수 없어요.'
              : '좌석을 정리하고 떠나요 — 남은 칩은 사라져요.'
          }
          accent="danger"
          onClick={onExit}
        />
        <button
          onClick={onClose}
          className="w-full py-2.5 rounded-xl text-sm text-ink-dim hover:text-ink border border-white/10 hover:border-white/25 transition-colors"
        >
          취소
        </button>
      </div>
    </Modal>
  );
}

function ChoiceButton({
  title, description, accent, onClick,
}: {
  title: string;
  description: string;
  accent: 'mystic' | 'danger';
  onClick: () => void;
}) {
  const styles = accent === 'mystic'
    ? 'border-mystic/40 hover:border-mystic bg-mystic/10 hover:bg-mystic/20'
    : 'border-red-400/40 hover:border-red-400 bg-red-500/10 hover:bg-red-500/20';
  const titleColor = accent === 'mystic' ? 'text-mystic' : 'text-red-300';
  return (
    <button onClick={onClick} className={`w-full text-left rounded-xl border p-4 transition-colors ${styles}`}>
      <div className={`text-sm font-bold mb-1 ${titleColor}`}>{title}</div>
      <div className="text-xs text-ink-dim leading-relaxed">{description}</div>
    </button>
  );
}
