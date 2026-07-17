import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ARENA_COMPONENTS = [
  'ArenaLobby.tsx',
  'ArenaQueuePanel.tsx',
  'ArenaLeaderboard.tsx',
  'ArenaSeasonRewards.tsx',
  'ArenaResultSummary.tsx',
  'ArenaTrainingOffer.tsx',
] as const;

describe('arena Korean lobby UI contract', () => {
  it('ships the six direct components without hidden rating or new image assets', () => {
    const source = ARENA_COMPONENTS.map(readArenaComponent).join('\n');
    expect(source).not.toMatch(/\bmmr\b/iu);
    expect(source).not.toMatch(/<img\b/iu);
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/iu);
    expect(source).toContain('aria-live');
    expect(source).toContain('aria-label');
  });

  it('explains queue and free training without exposing search ranges', () => {
    const queue = readArenaComponent('ArenaQueuePanel.tsx');
    const training = readArenaComponent('ArenaTrainingOffer.tsx');

    expect(queue).toContain('실력이 비슷한 상대를 찾는 중');
    expect(queue).not.toMatch(/범위|레이팅|점수대/);
    expect(training).toContain('수련 매치');
    expect(training).toContain('경기권/점수 사용 없음');
    expect(training).toContain('수락');
    expect(training).toContain('돌아가기');
  });

  it('shows self rank, promotion rules, Master label, rewards, and preseason notice', () => {
    const leaderboard = readArenaComponent('ArenaLeaderboard.tsx');
    const rewards = readArenaComponent('ArenaSeasonRewards.tsx');

    expect(leaderboard).toContain('글로벌 마스터 리그');
    expect(leaderboard).toContain('3경기');
    expect(leaderboard).toContain('소규모 그룹');
    expect(leaderboard).toContain('내 순위');
    expect(leaderboard).toContain('이전 페이지');
    expect(leaderboard).toContain('다음 페이지');
    expect(rewards).toContain('프리시즌');
    expect(rewards).toContain('희소 보상');
  });

  it('summarizes official and training results without casual prizes', () => {
    const result = readArenaComponent('ArenaResultSummary.tsx');
    expect(result).toContain('주간 순위');
    expect(result).toContain('배치 진행');
    expect(result).toContain('시즌 점수에 반영되지 않습니다');
    expect(result).not.toMatch(/상금|칩/);
  });

  it('integrates three lobby choices, ticket status, and Arena tournament result', () => {
    const page = read('src/app/page.tsx');
    const economy = read('src/components/lobby/EconomyBar.tsx');
    const overlay = read('src/components/table/TournamentResultOverlay.tsx');

    expect(page).toContain('일반 게임');
    expect(page).toContain('포커 아레나');
    expect(page).toContain('수련 과제');
    expect(page).toContain('<ArenaLobby');
    expect(economy).toContain('아레나 경기권');
    expect(overlay).toContain('ArenaResultSummary');
    expect(overlay).toContain('결과 없이 로비로 돌아가기');
    expect(overlay).toContain(
      'aria-label="결과 확인을 건너뛰고 로비로 돌아가기"',
    );
  });
});

function readArenaComponent(filename: typeof ARENA_COMPONENTS[number]): string {
  return read(`src/components/arena/${filename}`);
}

function read(relativePath: string): string {
  return readFileSync(resolve(process.cwd(), relativePath), 'utf8');
}
