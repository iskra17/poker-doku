'use client';

import { useState } from 'react';
import { BOT_CHARACTERS } from '@/lib/characters';
import { useProfileStore } from '@/lib/store/profile-store';
import CharacterImage from '@/components/characters/CharacterImage';
import RecoveryWordsCard from '@/components/profile/RecoveryWordsCard';
import Button from '@/components/ui/Button';

type OnboardingStep = 'adult' | 'avatar' | 'recover';

export default function ProfileOnboarding() {
  const phase = useProfileStore(state => state.phase);
  const profile = useProfileStore(state => state.profile);
  const recoveryWords = useProfileStore(state => state.recoveryWords);
  const error = useProfileStore(state => state.error);
  const create = useProfileStore(state => state.create);
  const recover = useProfileStore(state => state.recover);
  const acknowledgeRecovery = useProfileStore(state => state.acknowledgeRecovery);
  const skipRecovery = useProfileStore(state => state.skipRecovery);
  const [step, setStep] = useState<OnboardingStep>('adult');
  const [adultConfirmed, setAdultConfirmed] = useState(false);
  const [avatarId, setAvatarId] = useState(BOT_CHARACTERS[0]?.id ?? 'sakura');
  const [recoveryInput, setRecoveryInput] = useState('');
  const busy = phase === 'creating' || phase === 'recovering';

  if (phase === 'loading') {
    return <OnboardingShell><p className="py-10 text-center text-sm text-ink-dim">프로필 확인 중…</p></OnboardingShell>;
  }

  if (phase === 'recovery-required' && profile && recoveryWords) {
    return (
      <OnboardingShell>
        <div className="mb-4 text-center">
          <p className="text-xs text-ink-dim">서버가 만든 익명 별명</p>
          <p className="mt-1 text-lg font-bold text-mystic">{profile.alias}</p>
        </div>
        <RecoveryWordsCard
          words={recoveryWords}
          onAcknowledge={acknowledgeRecovery}
          onSkip={skipRecovery}
        />
      </OnboardingShell>
    );
  }

  return (
    <OnboardingShell>
      {step === 'adult' && (
        <div className="space-y-4">
          <div>
            <p className="text-xs font-bold text-blossom">1 / 3 이용 안내</p>
            <h2 className="mt-1 text-xl font-bold text-ink">청소년이용불가</h2>
          </div>
          <ul className="space-y-2 rounded-xl border border-mystic/20 bg-elevated/50 p-4 text-sm text-ink">
            <li>해당 등급 기준 연령 미만 이용 불가</li>
            <li>현금·현물 보상 없음</li>
            <li>칩 환전·양도 불가</li>
          </ul>
          <label className="flex cursor-pointer items-start gap-2 text-sm leading-relaxed text-ink">
            <input
              type="checkbox"
              checked={adultConfirmed}
              onChange={event => setAdultConfirmed(event.target.checked)}
              className="mt-1 accent-blossom"
            />
            위 안내를 확인했으며 이용 가능한 연령입니다.
          </label>
          {error && <p className="text-center text-xs text-blossom">{error}</p>}
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={!adultConfirmed}
            onClick={() => setStep('avatar')}
          >
            캐릭터 선택
          </Button>
          <button
            type="button"
            onClick={() => setStep('recover')}
            className="w-full text-xs text-mystic hover:text-ink"
          >
            기존 익명 프로필 복구하기
          </button>
        </div>
      )}

      {step === 'avatar' && (
        <div className="space-y-4">
          <div>
            <p className="text-xs font-bold text-blossom">2 / 3 캐릭터 선택</p>
            <h2 className="mt-1 text-xl font-bold text-ink">함께할 캐릭터를 골라 주세요</h2>
            <p className="mt-1 text-xs text-ink-dim">별명은 개인정보 없이 서버가 자동으로 만들어요.</p>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {BOT_CHARACTERS.map(character => (
              <button
                type="button"
                key={character.id}
                onClick={() => setAvatarId(character.id)}
                className={`rounded-xl border p-2 transition-colors ${
                  avatarId === character.id
                    ? 'border-blossom bg-blossom/10'
                    : 'border-mystic/20 bg-elevated/50 hover:bg-elevated'
                }`}
              >
                <span className="mx-auto block h-16 w-16 overflow-hidden rounded-full">
                  <CharacterImage characterId={character.id} round className="h-full w-full text-3xl" />
                </span>
                <span className={`mt-1 block text-xs ${avatarId === character.id ? 'font-bold text-blossom' : 'text-ink-dim'}`}>
                  {character.name}
                </span>
              </button>
            ))}
          </div>
          {error && <p className="text-center text-xs text-blossom">{error}</p>}
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={busy}
            onClick={() => void create(avatarId)}
          >
            {busy ? '익명 프로필 만드는 중…' : '익명 프로필 만들기'}
          </Button>
          <button type="button" onClick={() => setStep('adult')} className="w-full text-xs text-ink-dim">
            이전으로
          </button>
        </div>
      )}

      {step === 'recover' && (
        <div className="space-y-4">
          <div>
            <p className="text-xs font-bold text-blossom">기존 프로필 복구</p>
            <h2 className="mt-1 text-xl font-bold text-ink">복구 코드 12단어</h2>
            <p className="mt-1 text-xs text-ink-dim">공백이나 줄바꿈으로 구분해 입력해 주세요.</p>
          </div>
          <textarea
            value={recoveryInput}
            onChange={event => setRecoveryInput(event.target.value)}
            rows={5}
            autoComplete="off"
            spellCheck={false}
            className="w-full resize-none rounded-xl border border-mystic/20 bg-elevated/70 p-3 text-sm text-ink outline-none focus:border-blossom/50"
            placeholder="복구 단어 12개"
          />
          {error && <p className="text-center text-xs text-blossom">{error}</p>}
          <Button
            variant="primary"
            size="lg"
            className="w-full"
            disabled={busy || recoveryInput.trim().split(/\s+/u).length !== 12}
            onClick={() => void recover(recoveryInput)}
          >
            {busy ? '복구하는 중…' : '프로필 복구'}
          </Button>
          <button type="button" onClick={() => setStep('adult')} className="w-full text-xs text-ink-dim">
            새 프로필 만들기로 돌아가기
          </button>
        </div>
      )}
    </OnboardingShell>
  );
}

function OnboardingShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-lg px-4 pb-8">
      <div className="rounded-2xl border border-mystic/20 bg-panel/90 p-5 shadow-2xl backdrop-blur-sm sm:p-7">
        {children}
      </div>
    </main>
  );
}
