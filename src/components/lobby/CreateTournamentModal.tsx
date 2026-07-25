'use client';

import { useState } from 'react';
import { useGameStore } from '@/lib/store/game-store';
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
    const tournamentId = await createTournament(draft);
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
