'use client';

import { useState } from 'react';
import { BOT_CHARACTERS } from '@/lib/characters';
import { getCharacterUnlockLevel, isStarterCharacter } from '@/lib/characters/unlocks';
import { useProfileStore } from '@/lib/store/profile-store';
import CharacterImage from '@/components/characters/CharacterImage';
import RecoveryWordsCard from '@/components/profile/RecoveryWordsCard';
import Button from '@/components/ui/Button';
import { canEnterExistingProfileRecovery } from './onboarding-rules';
import { reduceRecoveryInput } from './recovery-input';
import { recoveryWordsIssuanceKey } from '@/components/profile/recovery-words';

type OnboardingStep = 'adult' | 'avatar' | 'recover';

/**
 * 파트너 카드의 성격 한 줄 + 대표 대사 — 수기(말투 정본: bond-scenes · coach-lines · 스토리 챕터).
 * 대표 대사는 "같이 수련하자"는 첫인상으로 쓴다(승부 대사가 아니라 파트너 대사).
 */
const HEROINE_INTRO: Readonly<Record<string, { tagline: string; signature: string }>> = {
  sakura: { tagline: '소심하지만 끈질긴 인내', signature: '저, 저랑 같이… 기다려 주실래요?' },
  ara: { tagline: '공격형 츤데레 승부사', signature: '내 짝? …흥, 너라면 봐줄게.' },
  hana: { tagline: '숫자로 말하는 분석가', signature: '당신의 성장, 제가 기록할게요.' },
  chloe: { tagline: '콜 좋아 스트리머', signature: '같이 하이라이트 찍자~☆' },
  vivian: { tagline: '무대 위의 전직 배우', signature: '상대역, 맡아 줄래요, 자기?' },
  elena: { tagline: '말수 적은 냉정한 프로', signature: '…앉아. 같이 치자.' },
};

const HEROINE_CHARACTERS = BOT_CHARACTERS.filter(character => isStarterCharacter(character.id));
const LOCKED_CHARACTERS = BOT_CHARACTERS.filter(character => !isStarterCharacter(character.id));

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
  const [avatarId, setAvatarId] = useState(HEROINE_CHARACTERS[0]?.id ?? 'sakura');
  const heroines = HEROINE_CHARACTERS;
  const lockedCharacters = LOCKED_CHARACTERS;
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
            파트너 선택
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
        // 히로인 6명을 큰 카드로, 잠긴 아바타는 접힌 한 줄로 분리한다(2026-10-24 파트너 중심 초반).
        // 430×900에서 [익명 프로필 만들기]가 스크롤 없이 보이도록 안내 문구는 두 줄로 줄였다.
        <div className="space-y-3">
          <div>
            <p className="text-xs font-bold text-blossom">2 / 3 파트너 선택</p>
            <h2 className="mt-0.5 text-lg font-bold text-ink">함께 수련할 파트너를 골라 주세요</h2>
            <p className="mt-0.5 text-[11px] leading-snug text-ink-dim">
              고른 파트너와 인연을 쌓고, 프로필 아바타로도 쓰여요. 나중에 바꿀 수 있고, 별명은 서버가 익명으로 만들어요.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="파트너">
            {heroines.map(character => {
              const selected = avatarId === character.id;
              const intro = HEROINE_INTRO[character.id];
              return (
                <button
                  type="button"
                  key={character.id}
                  role="radio"
                  aria-checked={selected}
                  onClick={() => {
                    setLockedNotice(null);
                    setAvatarId(character.id);
                  }}
                  className={`flex flex-col overflow-hidden rounded-xl border text-left transition-colors ${
                    selected ? 'border-blossom bg-blossom/10 ring-1 ring-blossom/60' : 'border-mystic/20 bg-elevated/50 hover:bg-elevated'
                  }`}
                >
                  <span className="relative block h-24 w-full overflow-hidden bg-gradient-to-b from-mystic/20 to-transparent">
                    <CharacterImage
                      characterId={character.id}
                      expression={selected ? 'happy' : 'neutral'}
                      round={false}
                      frameless
                      objectPosition="center top"
                      className="h-full w-full text-4xl"
                    />
                  </span>
                  <span className="block px-1.5 pb-1.5 pt-1">
                    <span className="block text-xs font-bold" style={{ color: character.color }}>{character.name}</span>
                    {intro && (
                      <>
                        <span className="block text-[10px] leading-tight text-ink-dim">{intro.tagline}</span>
                        <span className="mt-0.5 line-clamp-2 block text-[10px] italic leading-tight text-ink">「{intro.signature}」</span>
                      </>
                    )}
                  </span>
                </button>
              );
            })}
          </div>
          <details className="rounded-lg border border-white/10 bg-elevated/30 px-2.5 py-1.5 text-[11px] text-ink-dim">
            <summary className="cursor-pointer select-none">🔒 그 밖의 아바타 {lockedCharacters.length}명 — 도장 레벨을 올리면 열려요</summary>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {lockedCharacters.map(character => (
                <button
                  type="button"
                  key={character.id}
                  aria-disabled
                  aria-label={`${character.name} — 잠김`}
                  onClick={() => {
                    // 잠금 캐릭터도 탭 피드백은 준다 — 무반응이면 버그로 오인 (2026-07-22 QA)
                    setLockedNotice(`🔒 ${character.name} — 도장 Lv.${getCharacterUnlockLevel(character.id)}에 아바타로 해금돼요.`);
                  }}
                  className="block h-8 w-8 cursor-not-allowed overflow-hidden rounded-full opacity-40 grayscale"
                >
                  <CharacterImage characterId={character.id} round className="h-full w-full text-sm" />
                </button>
              ))}
            </div>
            {lockedNotice && (
              <p aria-live="polite" className="mt-1 text-blossom">{lockedNotice}</p>
            )}
          </details>
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
