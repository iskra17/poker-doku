'use client';

import { useState } from 'react';
import Button from '@/components/ui/Button';
import { copyRecoveryWords, type RecoveryCopyStatus } from './recovery-words';

interface RecoveryWordsCardProps {
  words: readonly string[];
  onAcknowledge: () => void;
  onSkip: () => void;
}

export default function RecoveryWordsCard({
  words,
  onAcknowledge,
  onSkip,
}: RecoveryWordsCardProps) {
  const [saved, setSaved] = useState(false);
  const [copyStatus, setCopyStatus] = useState<RecoveryCopyStatus | 'idle'>('idle');

  const copy = () => {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    void copyRecoveryWords(words, clipboard).then(setCopyStatus);
  };

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-gilded/30 bg-gilded/10 p-3">
        <p className="text-sm font-bold text-gilded">복구 코드 12단어</p>
        <p className="mt-1 text-xs leading-relaxed text-ink-dim">
          이 화면을 닫으면 다시 볼 수 없어요. 오프라인에 안전하게 적어 두세요.
        </p>
      </div>
      <ol className="grid grid-cols-2 gap-2 rounded-xl border border-mystic/20 bg-panel/70 p-3 sm:grid-cols-3">
        {words.map((word, index) => (
          <li key={`${index}-${word}`} className="rounded-lg bg-elevated/70 px-2 py-2 text-sm text-ink">
            <span className="mr-1.5 text-[10px] text-ink-dim">{index + 1}</span>
            {word}
          </li>
        ))}
      </ol>
      <Button variant="secondary" className="w-full" onClick={copy}>
        {copyStatus === 'success' ? '복사했어요 ✓' : '12단어 복사'}
      </Button>
      {copyStatus === 'error' && (
        <p className="text-center text-xs text-blossom">
          복사하지 못했어요. 위 단어를 직접 선택해 안전하게 저장해 주세요.
        </p>
      )}
      <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-mystic/20 p-3 text-xs leading-relaxed text-ink">
        <input
          type="checkbox"
          checked={saved}
          onChange={event => setSaved(event.target.checked)}
          className="mt-0.5 accent-blossom"
        />
        복구 코드를 안전한 곳에 저장했습니다.
      </label>
      <Button
        variant="primary"
        className="w-full"
        disabled={!saved}
        onClick={onAcknowledge}
      >
        저장 완료하고 로비 입장
      </Button>
      <button
        type="button"
        onClick={onSkip}
        className="w-full rounded-lg px-3 py-2 text-xs text-ink-dim transition-colors hover:bg-elevated/50 hover:text-ink"
      >
        나중에 저장할게요
      </button>
      <p className="text-center text-[11px] leading-relaxed text-blossom">
        건너뛰면 로비와 설정에 복구 코드 미저장 경고가 계속 표시됩니다.
      </p>
    </div>
  );
}
