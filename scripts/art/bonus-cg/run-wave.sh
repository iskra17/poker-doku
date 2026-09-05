#!/bin/bash
# 보너스 CG 원화 생성 웨이브 — 캐릭터별 codex exec(gpt-image-2)를 병렬 백그라운드로 띄운다.
# 사용: bash scripts/art/bonus-cg/run-wave.sh <staging-dir> <wave-tag> <characterId ...>
#   사전: node scripts/art/bonus-cg/build-prompts.mjs <staging-dir> [ids] 로 prompts/·ref/ 준비.
#   CODEX_HOME 우회(훅/스킬/collab 없음, auth.json만)와 --sandbox workspace-write 필수(저장 차단 방지).
#   로그: <staging>/logs/<id>-<wave>.log, 완료 마커: <staging>/logs/<wave>.done (id exit=N 한 줄씩)
set -u
STAGING="$1"; WAVE="$2"; shift 2
: "${CODEX_HOME:=/c/code/claude/poker-doku-art/story-rewards/codex-home}"
export CODEX_HOME
MODEL="${CODEX_MODEL:-gpt-5.5}"
cd "$STAGING" || exit 1
mkdir -p logs
for id in "$@"; do
  (
    codex exec --skip-git-repo-check --sandbox workspace-write -m "$MODEL" "$(cat "prompts/$id.txt")" </dev/null > "logs/$id-$WAVE.log" 2>&1
    echo "$id exit=$?" >> "logs/$WAVE.done"
  ) &
done
wait
echo "wave $WAVE finished: $(cat "logs/$WAVE.done" | tr '\n' ' ')"
