import type { ProfileStoreState } from './profile-store';
import type { StoryStore } from './story-store';

/** Story chips are committed before the ended view; always read the wallet from the server. */
export function subscribeStoryWalletRefresh(
  story: Pick<StoryStore, 'getState' | 'subscribe'>,
  profile: { getState(): Pick<ProfileStoreState, 'phase' | 'profile' | 'refresh'> },
): () => void {
  let profileId = story.getState().profileId;
  const refreshedRuns = new Set<string>();
  return story.subscribe(state => {
    if (state.profileId !== profileId) {
      profileId = state.profileId;
      refreshedRuns.clear();
    }
    const run = state.run;
    const result = run?.result;
    if (!profileId || !run || run.phase !== 'ended' || !result?.passed
        || (result.rewards.chips ?? 0) <= 0 || refreshedRuns.has(run.runId)) return;
    const current = profile.getState();
    if (current.phase !== 'ready' || current.profile?.id !== profileId) return;
    refreshedRuns.add(run.runId);
    void current.refresh({ afterCurrent: true });
  });
}
