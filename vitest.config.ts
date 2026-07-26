import { configDefaults, defineConfig } from 'vitest/config';
import path from 'path';

/**
 * 저장소 루트 안에 체크아웃 사본이 여럿 산다 — 세션 워크트리(`.claude/worktrees`,
 * `.worktrees`)와 로컬 QA 샌드박스(`qa-tmp`). 각 사본이 스위트를 통째로 들고 있어서
 * 제외하지 않으면 같은 테스트를 여러 벌 동시에 돌리고, 사본들이 같은 임시 SQLite
 * 파일을 두고 경합해 **재현되지 않는 유령 실패**가 난다 (2026-07-25 실측: 585파일
 * 실행 시 migration 테스트가 실패했다가 단독 실행에선 통과). 사본은 각자 안에서
 * 돌린다.
 */
const NESTED_CHECKOUTS = [
  '**/qa-tmp/**',
  '**/.claude/worktrees/**',
  '**/.worktrees/**',
];

export default defineConfig({
  test: {
    environment: 'node',
    exclude: [...configDefaults.exclude, ...NESTED_CHECKOUTS],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
});
