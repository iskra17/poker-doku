'use client';

import { useState } from 'react';
import { BOT_CHARACTERS } from '@/lib/characters';
import { getCharacterUnlockLevel } from '@/lib/characters/unlocks';
import { useProfileStore } from '@/lib/store/profile-store';
import CharacterImage from '@/components/characters/CharacterImage';
import RecoveryWordsCard from '@/components/profile/RecoveryWordsCard';
import Button from '@/components/ui/Button';
import { canEnterExistingProfileRecovery } from './onboarding-rules';
import { reduceRecoveryInput } from './recovery-input';
import { recoveryWordsIssuanceKey } from '@/components/profile/recovery-words';

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
  const [lockedNotice, setLockedNotice] = useState<string | null>(null);
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
          key={recoveryWordsIssuanceKey(recoveryWords)}
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
          <div className="rounded-xl border border-cyber/30 bg-cyber/10 p-4">
            <p className="text-sm font-bold text-cyber">🔒 개인정보를 수집하지 않아요</p>
            <p className="mt-1.5 text-xs leading-relaxed text-ink">
              가입·이메일·전화번호가 없습니다. 서버가 자동으로 만든 익명 별명과 게임 기록만 저장되고,
              접속 정보는 이 브라우저에만 남아요. 브라우저 데이터를 지우면 복구 단어로만 되찾을 수 있어요.
            </p>
          </div>
          <label className="flex cursor-pointer items-start gap-2 text-sm leading-relaxed text-ink">
            <input
              type="checkbox"
              checked={adultConfirmed}
              onChange={event => {
                const checked = event.target.checked;
                setAdultConfirmed(checked);
                if (!checked) {
                  setRecoveryInput(current => reduceRecoveryInput(current, {
                    type: 'clear', reason: 'legal-unchecked',
                  }));
                }
              }}
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
            disabled={!canEnterExistingProfileRecovery(adultConfirmed)}
            onClick={() => {
              if (canEnterExistingProfileRecovery(adultConfirmed)) {
                setRecoveryInput(current => reduceRecoveryInput(current, {
                  type: 'clear', reason: 'back',
                }));
                setStep('recover');
              }
            }}
            className="w-full text-xs text-mystic hover:text-ink disabled:cursor-not-allowed disabled:opacity-40"
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
            <p className="mt-1 text-xs text-mystic">🔒 잠긴 캐릭터는 플레이로 도장 레벨을 올리면 해금돼요.</p>
            {lockedNotice && (
              <p aria-live="polite" className="mt-1 text-xs text-blossom">{lockedNotice}</p>
            )}
          </div>
          <div className="grid grid-cols-3 gap-3">
            {BOT_CHARACTERS.map(character => {
              const unlockLevel = getCharacterUnlockLevel(character.id);
              const locked = unlockLevel != null; // 온보딩 시점 도장 레벨 1 — 해금 캐릭터는 전부 잠금
              return (
                <button
                  type="button"
                  key={character.id}
                  aria-disabled={locked}
                  onClick={() => {
                    // 잠금 캐릭터도 탭 피드백은 준다 — 무반응이면 버그로 오인 (2026-07-22 QA)
                    if (locked) {
                      setLockedNotice(`🔒 ${character.name} — 도장 Lv.${unlockLevel}에 해금돼요. 지금은 밝게 표시된 캐릭터 중에서 골라 주세요.`);
                      return;
                    }
                    setLockedNotice(null);
                    setAvatarId(character.id);
                  }}
                  className={`rounded-xl border p-2 transition-colors ${
                    locked
                      ? 'cursor-not-allowed border-white/10 bg-elevated/30'
                      : avatarId === character.id
                        ? 'border-blossom bg-blossom/10'
                        : 'border-mystic/20 bg-elevated/50 hover:bg-elevated'
                  }`}
                >
                  <span className={`mx-auto block h-16 w-16 overflow-hidden rounded-full ${locked ? 'opacity-40 grayscale' : ''}`}>
                    <CharacterImage characterId={character.id} round className="h-full w-full text-3xl" />
                  </span>
                  <span className={`mt-1 block text-xs ${locked ? 'text-ink-dim/70' : avatarId === character.id ? 'font-bold text-blossom' : 'text-ink-dim'}`}>
                    {character.name}
                  </span>
                  {locked && (
                    <span className="block text-[10px] text-ink-dim/70">🔒 도장 Lv.{unlockLevel}</span>
                  )}
                </button>
              );
            })}
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
            onChange={event => setRecoveryInput(current => reduceRecoveryInput(current, {
              type: 'change', value: event.target.value,
            }))}
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
            onClick={() => {
              const submitted = recoveryInput;
              setRecoveryInput(current => reduceRecoveryInput(current, {
                type: 'clear', reason: 'submit',
              }));
              void recover(submitted);
            }}
          >
            {busy ? '복구하는 중…' : '프로필 복구'}
          </Button>
          <button
            type="button"
            onClick={() => {
              setRecoveryInput(current => reduceRecoveryInput(current, {
                type: 'clear', reason: 'back',
              }));
              setStep('adult');
            }}
            className="w-full text-xs text-ink-dim"
          >
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
