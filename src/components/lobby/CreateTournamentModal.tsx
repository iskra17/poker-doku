'use client';

import { useState } from 'react';
import { useGameStore } from '@/lib/store/game-store';
import type { CreateTournamentRequest } from '@/lib/realtime/protocol';
import TournamentCreateForm, {
  type TournamentCreateDraft,
} from '@/components/tournament/TournamentCreateForm';
import { ModalShell } from './TournamentDetailModal';

export default function CreateTournamentModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (tournamentId: string) => void;
}) {
  const createTournament = useGameStore(state => state.createTournament);
  const serverClockOffsetMs = useGameStore(state => state.serverClockOffsetMs);
  const [serverNow] = useState(() => Date.now() + serverClockOffsetMs);

  const submit = async (draft: TournamentCreateDraft): Promise<boolean> => {
    const speed = draft.structure.sourcePresetId ?? 'standard';
    const config: CreateTournamentRequest = {
      name: draft.name,
      payoutPreset: draft.payout.presetId,
      speed,
      maxEntrants: draft.maxEntrants,
      startAt: draft.schedule.startsAt,
      botFill:
        draft.economyMode === 'freeroll' && draft.botFillToMinimum,
      turnTime: draft.turnTimeSeconds,
      // The legacy socket accepts practice for one release and normalizes it
      // to the canonical freeroll policy before persistence.
      economyMode:
        draft.economyMode === 'freeroll' ? 'practice' : 'wallet',
    };
    const tournamentId = await createTournament(config);
    if (!tournamentId) return false;
    onCreated(tournamentId);
    return true;
  };

  return (
    <ModalShell title="토너먼트 개설" onClose={onClose} wide>
      <TournamentCreateForm
        serverNow={serverNow}
        onCancel={onClose}
        onSubmit={submit}
        allowRecurrence={false}
      />
    </ModalShell>
  );
}
