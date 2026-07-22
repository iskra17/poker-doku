import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // 로컬 QA 에이전트 산출물 (git 미추적)
    "qa-tmp/**",
    // 세션 워크트리 (자체 체크아웃 — 각자 안에서 린트, 메인에서 훑으면 .next 산출물까지 걸린다)
    ".claude/worktrees/**",
  ]),
]);

export default eslintConfig;
