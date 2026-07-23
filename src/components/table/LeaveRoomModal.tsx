'use client';

import Modal from '@/components/ui/Modal';
import { SITOUT_MISSED_BB_LIMIT } from '@/server/sitout';

interface LeaveRoomModalProps {
  isOpen: boolean;
  /** Sit & Go 방 여부 — 자리비움/기권 문구가 달라지고 나가기 예약이 숨는다 */
  isSng: boolean;
  /**
   * MTT 방 여부 — 즉시 기권이 없다 (TDA 30: 자리에 없어도 딜인 + 블라인드 차감 →
   * 칩 소진 시 자연 탈락). 자리비움 선택지만 노출된다.
   */
  isMtt?: boolean;
  /** 연습 경제 여부 — 완전히 나가기 문구가 달라진다 (지갑 정산 없음) */
  isPractice: boolean;
  /** 나가기 예약 노출 여부 — 캐시 전용 (SnG/아레나 제외) */
  canReserve: boolean;
  onClose: () => void;
  /** 좌석/칩 유지한 채 자리비움으로 나가기 */
  onSitOut: () => void;
  /** 나가기 예약 — 'hand': 이번 핸드 후 / 'bb': 다음 빅블라인드 전 */
  onReserve: (kind: 'hand' | 'bb') => void;
  /** 완전히 나가기 (캐시: 좌석 정리 / SnG: 기권) */
  onExit: () => void;
}

/** 나가기 확인 다이얼로그 — 게임을 끝낼지, 자리만 비울지, 나가기를 예약할지 선택 */
export default function LeaveRoomModal({
  isOpen, isSng, isMtt = false, isPractice, canReserve, onClose, onSitOut, onReserve, onExit,
}: LeaveRoomModalProps) {
  return (
    <Modal isOpen={isOpen} onClose={onClose} title="테이블을 떠날까요?">
      <div className="space-y-3">
        <ChoiceButton
          title="자리비움 하고 나가기"
          description={
            isMtt
              ? '토너먼트 좌석과 칩은 유지돼요. 자리를 비운 동안에도 블라인드·앤티가 계속 나가고, 칩이 다 떨어지면 그때 탈락해요 — 로비 🏆 토너먼트의 [게임 복귀]로 언제든 돌아올 수 있어요.'
              : isSng
                ? '좌석과 칩을 유지해요. 블라인드는 계속 차감되고 돌아올 때까지 자동 폴드돼요 — 로비의 [게임 복귀] 버튼으로 언제든 한 번에 돌아올 수 있어요.'
                : `좌석과 칩을 유지해요. 로비의 [게임 복귀] 버튼으로 바이인 없이 바로 돌아올 수 있어요 — 단, 빅블라인드를 ${SITOUT_MISSED_BB_LIMIT}번 거르면 자동으로 자리에서 일어나요.`
          }
          accent="mystic"
          onClick={onSitOut}
        />
        {canReserve && (
          <>
            <ChoiceButton
              title="이번 핸드까지 하고 나가기"
              description="진행 중인 핸드를 마치면 자동으로 자리를 정리하고 로비로 돌아가요. 예약 후에도 [취소]로 되돌릴 수 있어요."
              accent="gilded"
              onClick={() => onReserve('hand')}
            />
            <ChoiceButton
              title="다음 빅블라인드 전에 나가기"
              description="블라인드를 새로 내기 직전까지만 플레이하고 자동으로 나가요 — 포커룸 표준 매너 퇴장이에요."
              accent="gilded"
              onClick={() => onReserve('bb')}
            />
          </>
        )}
        {!isMtt && (
          <ChoiceButton
            title={isSng ? '기권하고 나가기' : '완전히 나가기'}
            description={
              isSng
                ? '토너먼트에서 기권해요 — 현재 순위로 탈락 처리되고 되돌릴 수 없어요.'
                : isPractice
                  ? '좌석을 정리하고 떠나요 — 연습 게임이라 지갑 칩에는 영향이 없어요.'
                  : '좌석을 정리하고 떠나요 — 남은 칩은 지갑으로 정산돼요.'
            }
            accent="danger"
            onClick={onExit}
          />
        )}
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
  accent: 'mystic' | 'gilded' | 'danger';
  onClick: () => void;
}) {
  const styles = accent === 'mystic'
    ? 'border-mystic/40 hover:border-mystic bg-mystic/10 hover:bg-mystic/20'
    : accent === 'gilded'
      ? 'border-gilded/40 hover:border-gilded bg-gilded/10 hover:bg-gilded/20'
      : 'border-red-400/40 hover:border-red-400 bg-red-500/10 hover:bg-red-500/20';
  const titleColor = accent === 'mystic' ? 'text-mystic' : accent === 'gilded' ? 'text-gilded' : 'text-red-300';
  return (
    <button onClick={onClick} className={`w-full text-left rounded-xl border p-4 transition-colors ${styles}`}>
      <div className={`text-sm font-bold mb-1 ${titleColor}`}>{title}</div>
      <div className="text-xs text-ink-dim leading-relaxed">{description}</div>
    </button>
  );
}
