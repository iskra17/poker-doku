'use client';

import { useState } from 'react';
import { useGameStore } from '@/lib/store/game-store';
import { normalizeInviteCode } from '@/lib/invite/invite-code';

/**
 * 초대 코드 입장 — 링크를 못 받은 사람(음성으로 불러줬거나 링크가 깨진 경우)의 경로.
 * 링크가 여전히 주 경로이므로 눈에 띄되 공간은 적게 쓴다.
 *
 * 정규화는 클라에서도 하지만 판정은 서버가 다시 한다 — 여기 통과는 편의일 뿐이다.
 */
export default function InviteCodeEntry({
  onRoom,
  onTournament,
}: {
  onRoom: (roomId: string) => void;
  onTournament: (tournamentId: string) => void;
}) {
  const resolveInvite = useGameStore(state => state.resolveInvite);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const normalized = normalizeInviteCode(value);

  const submit = async () => {
    if (!normalized || busy) return;
    setBusy(true);
    setError(null);
    try {
      const target = await resolveInvite(normalized);
      if (!target) {
        setError('그런 초대 코드는 없어요. 다시 확인해 주세요.');
        return;
      }
      if (target.kind === 'room') onRoom(target.id);
      else onTournament(target.id);
      setValue('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-2">
      <div className="flex gap-2">
        <input
          value={value}
          onChange={event => setValue(event.target.value.slice(0, 8))}
          onKeyDown={event => {
            if (event.key === 'Enter') void submit();
          }}
          placeholder="초대 코드 (예: ABC-DEF)"
          aria-label="초대 코드"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          className="form-input flex-1 uppercase tracking-widest"
        />
        <button
          type="button"
          disabled={!normalized || busy}
          onClick={() => void submit()}
          className="shrink-0 rounded-lg bg-cyber/20 px-3 text-xs font-bold text-cyber disabled:opacity-40"
        >
          {busy ? '확인 중…' : '입장'}
        </button>
      </div>
      {error && <p className="mt-1 text-[11px] text-blossom">{error}</p>}
    </div>
  );
}
