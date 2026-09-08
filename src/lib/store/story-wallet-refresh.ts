import type { ProfileStoreState } from './profile-store';
import type { StoryStore } from './story-store';

/** Story chips are committed before the ended view; always read the wallet from the server. */
export function subscribeStoryWalletRefresh(
  story: Pick<StoryStore, 'getState' | 'subscribe'>,
  profile: { getState(): Pick<ProfileStoreState, 'phase' | 'profile' | 'refresh'> },
): () => void {
  let profileId = story.getState().profileId;
  const refreshedRuns = new Set<string>();
  const refreshedChipReceipts = new Set<string>();
  return story.subscribe(state => {
    if (state.profileId !== profileId) {
      profileId = state.profileId;
      refreshedRuns.clear();
      refreshedChipReceipts.clear();
    }
    const current = profile.getState();
    if (!profileId || current.phase !== 'ready' || current.profile?.id !== profileId) return;
    // Progress loading reconciles retroactive rewards before returning its receipts.
    // Read the wallet after that transaction, including returning players with no active run.
    const newReceipts = state.progressStatus === 'ready'
      ? (state.progress?.rewards ?? []).filter(reward =>
        reward.kind === 'chips' && reward.granted && !refreshedChipReceipts.has(reward.id))
      : [];
    if (newReceipts.length > 0) {
      for (const reward of newReceipts) refreshedChipReceipts.add(reward.id);
      void current.refresh({ afterCurrent: true });
    }
    const run = state.run;
    const result = run?.result;
    if (!profileId || !run || run.phase !== 'ended' || !result?.passed
        || (result.rewards.chips ?? 0) <= 0 || refreshedRuns.has(run.runId)) return;
    refreshedRuns.add(run.runId);
    void current.refresh({ afterCurrent: true });
  });
}
