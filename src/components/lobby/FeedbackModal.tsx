'use client';

import { useState } from 'react';
import Modal from '../ui/Modal';
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_MESSAGE_MAX,
  FEEDBACK_MESSAGE_MIN,
  normalizeFeedbackMessage,
  type FeedbackCategory,
} from '@/lib/feedback/rules';

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const DEFAULT_ERROR = '의견을 보내지 못했어요. 잠시 후 다시 시도해주세요.';

export default function FeedbackModal({ isOpen, onClose }: FeedbackModalProps) {
  const [category, setCategory] = useState<FeedbackCategory>('idea');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = normalizeFeedbackMessage(message);

  const submit = async () => {
    if (submitting || normalized === null) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ category, message: normalized }),
      });
      if (!response.ok) {
        let text = DEFAULT_ERROR;
        try {
          const payload = await response.json() as {
            error?: { message?: unknown };
          };
          if (typeof payload.error?.message === 'string') {
            text = payload.error.message;
          }
        } catch {
          // 응답 본문이 없으면 기본 안내를 유지한다.
        }
        setError(text);
        return;
      }
      setSent(true);
      setMessage('');
    } catch {
      setError(DEFAULT_ERROR);
    } finally {
      setSubmitting(false);
    }
  };

  const closeAndReset = () => {
    setSent(false);
    setError(null);
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onClose={closeAndReset} title="문의 · 건의">
      {sent ? (
        <div className="space-y-4 text-center">
          <p className="text-2xl" aria-hidden>💌</p>
          <p className="text-sm text-ink">
            소중한 의견 감사합니다! 운영자가 꼼꼼히 읽어볼게요.
          </p>
          <div className="flex justify-center gap-2">
            <button
              type="button"
              onClick={() => setSent(false)}
              className="rounded-xl border border-mystic/30 bg-panel/80 px-4 py-2 text-xs text-ink-dim transition-colors hover:text-ink"
            >
              하나 더 보내기
            </button>
            <button
              type="button"
              onClick={closeAndReset}
              className="rounded-xl border border-blossom/40 bg-blossom/20 px-4 py-2 text-xs font-bold text-ink"
            >
              닫기
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <div role="radiogroup" aria-label="의견 분류" className="grid grid-cols-3 gap-2">
            {FEEDBACK_CATEGORIES.map(option => (
              <button
                key={option.id}
                type="button"
                role="radio"
                aria-checked={category === option.id}
                onClick={() => setCategory(option.id)}
                className={`rounded-xl border px-2 py-2 text-xs font-bold transition-colors ${
                  category === option.id
                    ? 'border-blossom/50 bg-blossom/15 text-ink'
                    : 'border-mystic/25 bg-panel/85 text-ink-dim hover:text-ink'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <textarea
            value={message}
            onChange={event => setMessage(event.target.value)}
            maxLength={FEEDBACK_MESSAGE_MAX}
            rows={5}
            placeholder={`게임에 대한 문의나 바라는 점을 자유롭게 적어주세요 (${FEEDBACK_MESSAGE_MIN}자 이상)`}
            aria-label="의견 내용"
            className="w-full resize-none rounded-xl border border-mystic/25 bg-panel/85 p-3 text-sm text-ink placeholder:text-ink-dim/60 focus:border-blossom/50 focus:outline-none"
          />
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-ink-dim">
              {message.trim().length}/{FEEDBACK_MESSAGE_MAX}자 · 닉네임과 함께 운영자에게만 전달돼요
            </span>
            <button
              type="button"
              onClick={submit}
              disabled={submitting || normalized === null}
              className="rounded-xl border border-blossom/40 bg-blossom/20 px-4 py-2 text-xs font-bold text-ink transition-opacity disabled:opacity-40"
            >
              {submitting ? '보내는 중…' : '보내기'}
            </button>
          </div>
          {error && <p className="text-xs text-blossom">{error}</p>}
        </div>
      )}
    </Modal>
  );
}
