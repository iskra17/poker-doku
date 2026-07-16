'use client';

import { useState } from 'react';
import { useProfileStore } from '@/lib/store/profile-store';
import CharacterImage from '@/components/characters/CharacterImage';
import Button from '@/components/ui/Button';
import RecoveryWordsCard from './RecoveryWordsCard';
import { getProfileDeletionAvailability } from './recovery-rules';
import { recoveryWordsIssuanceKey } from './recovery-words';

export default function RecoveryPanel() {
  const phase = useProfileStore(state => state.phase);
  const action = useProfileStore(state => state.action);
  const profile = useProfileStore(state => state.profile);
  const economy = useProfileStore(state => state.economy);
  const recoveryWords = useProfileStore(state => state.recoveryWords);
  const recoveryWarning = useProfileStore(state => state.recoveryWarning);
  const error = useProfileStore(state => state.error);
  const rotateRecovery = useProfileStore(state => state.rotateRecovery);
  const deleteProfile = useProfileStore(state => state.deleteProfile);
  const acknowledgeRecovery = useProfileStore(state => state.acknowledgeRecovery);
  const skipRecovery = useProfileStore(state => state.skipRecovery);
  const [rotationConfirmed, setRotationConfirmed] = useState(false);
  const [deleteText, setDeleteText] = useState('');

  if (!profile) return null;
  if (phase === 'recovery-required' && recoveryWords) {
    return (
      <section>
        <SectionTitle>새 복구 코드</SectionTitle>
        <RecoveryWordsCard
          key={recoveryWordsIssuanceKey(recoveryWords)}
          words={recoveryWords}
          onAcknowledge={acknowledgeRecovery}
          onSkip={skipRecovery}
        />
      </section>
    );
  }

  const deletion = getProfileDeletionAvailability(economy?.hasActiveSeat ?? true);
  return (
    <div className="space-y-5">
      <section>
        <SectionTitle>익명 프로필</SectionTitle>
        <div className="flex items-center gap-3 rounded-xl border border-mystic/20 bg-elevated/50 p-3">
          <span className="block h-12 w-12 overflow-hidden rounded-full border border-mystic/30">
            <CharacterImage characterId={profile.avatarId} round className="h-full w-full text-2xl" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-bold text-mystic">{profile.alias}</p>
            <p className="text-[11px] text-ink-dim">이메일·전화번호·실명 없이 저장됨</p>
          </div>
        </div>
        {recoveryWarning && (
          <p className="mt-2 rounded-lg border border-blossom/30 bg-blossom/10 px-3 py-2 text-xs text-blossom">
            복구 코드를 저장하지 않았어요. 재발급 후 안전하게 보관해 주세요.
          </p>
        )}
      </section>

      <section>
        <SectionTitle>복구 코드 재발급</SectionTitle>
        <label className="flex items-start gap-2 text-xs leading-relaxed text-ink">
          <input
            type="checkbox"
            checked={rotationConfirmed}
            onChange={event => setRotationConfirmed(event.target.checked)}
            className="mt-0.5 accent-blossom"
          />
          새 코드를 발급하면 이전 복구 코드는 즉시 무효가 됩니다.
        </label>
        <Button
          variant="secondary"
          className="mt-3 w-full"
          disabled={!rotationConfirmed || action !== null}
          onClick={() => void rotateRecovery()}
        >
          {action === 'rotating' ? '재발급 중…' : '새 복구 코드 발급'}
        </Button>
      </section>

      <section className="border-t border-mystic/20 pt-4">
        <SectionTitle>프로필 삭제</SectionTitle>
        {!deletion.allowed ? (
          <p className="rounded-lg border border-gilded/30 bg-gilded/10 px-3 py-2 text-xs text-gilded">
            {deletion.guidance}
          </p>
        ) : (
          <p className="text-xs leading-relaxed text-ink-dim">
            지갑과 진행 정보가 모두 사라집니다. 계속하려면 아래에 <strong className="text-ink">삭제</strong>를 입력하세요.
          </p>
        )}
        <input
          type="text"
          value={deleteText}
          onChange={event => setDeleteText(event.target.value)}
          disabled={!deletion.allowed}
          placeholder="삭제"
          className="mt-2 w-full rounded-lg border border-mystic/20 bg-elevated/70 px-3 py-2 text-sm text-ink outline-none focus:border-blossom/50 disabled:opacity-40"
        />
        <Button
          variant="danger"
          className="mt-2 w-full"
          disabled={!deletion.allowed || deleteText !== '삭제' || action !== null}
          onClick={() => void deleteProfile(deleteText)}
        >
          {action === 'deleting' ? '삭제 중…' : '프로필 영구 삭제'}
        </Button>
        {error && <p className="mt-2 text-xs text-blossom">{error}</p>}
      </section>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 text-xs font-bold text-blossom">{children}</h3>;
}
