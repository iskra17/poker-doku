#!/bin/bash
# 보너스 CG H3 루프 검수용 6프레임 시트 — 원장 results/*.mp4(107프레임) 각각을 6장 타일 JPG로 만든다.
# 사용: bash scripts/art/bonus-cg/video-sheets.sh <ledger-root> <out-dir>   (ffmpeg 필요)
#   출력: <out-dir>/<jobId>.jpg (프레임 0,21,42,63,84,105 — 첫/끝 프레임이 같은지, 얼굴·의상 유지, 카메라 고정 여부를 본다)
#   이미 만든 시트는 건너뛴다. 승인은 실제 루프 재생까지 본 뒤 ledger_bonus.py approve-videos로 기록한다.
set -u
ROOT="$1"; OUT="$2"
mkdir -p "$OUT"
made=0; skipped=0
for f in "$ROOT"/results/*.mp4; do
  [ -e "$f" ] || continue
  job="${f##*/}"; job="${job%%--*}"
  dest="$OUT/$job.jpg"
  if [ -e "$dest" ]; then skipped=$((skipped+1)); continue; fi
  ffprobe -v error -show_entries format=duration -of csv=p=0 "$f" >/dev/null 2>&1 || { echo "in progress: $job"; continue; }
  ffmpeg -y -loglevel error -i "$f" -vf "select='not(mod(n,21))',scale=256:-1,tile=6x1" -frames:v 1 -q:v 4 "$dest" && made=$((made+1)) && echo "sheet $job"
done
echo "video sheets: made=$made skipped=$skipped"
