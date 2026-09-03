#!/bin/bash
# H3 원본 mp4(107프레임, 첫=끝 프레임) → 웹 루프용 webm/mp4(106프레임, 무음). 절차: scripts/art/story-video.md §3
# 사용: bash scripts/art/story-video-encode.sh <tag> <cgId> [...]   (리포 루트에서)
set -e
TAG="$1"; shift
OUT_DIR="D:/AI-Image-Video/output/poker-doku"
DEST="public/assets/story/video"
mkdir -p "$DEST"
for id in "$@"; do
  src=$(ls -t "$OUT_DIR/$id-$TAG"_*.mp4 2>/dev/null | head -1)
  if [ -z "$src" ]; then echo "!! no source for $id"; continue; fi
  ffmpeg -y -loglevel error -i "$src" -frames:v 106 -an -c:v libvpx-vp9 -crf 32 -b:v 0 -row-mt 1 -deadline good -cpu-used 2 -pix_fmt yuv420p "$DEST/$id.webm"
  ffmpeg -y -loglevel error -i "$src" -frames:v 106 -an -c:v libx264 -crf 26 -preset slow -pix_fmt yuv420p -movflags +faststart "$DEST/$id.mp4"
  printf '%s  webm=%s  mp4=%s\n' "$id" "$(stat -c %s "$DEST/$id.webm")" "$(stat -c %s "$DEST/$id.mp4")"
done
