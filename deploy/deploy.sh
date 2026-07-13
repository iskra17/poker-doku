#!/usr/bin/env bash
# 갱신 배포 — 서버에서 root로 실행: bash /opt/poker-doku/deploy/deploy.sh
# git pull → 의존성 → 빌드 → 재시작 (재시작 시 인메모리 방 초기화 — 한가한 시간대 권장)
set -euo pipefail

APP_DIR=/opt/poker-doku
APP_USER=poker

cd $APP_DIR
sudo -u $APP_USER git pull
sudo -u $APP_USER npm ci
sudo -u $APP_USER npm run build

# systemd 유닛/Caddyfile이 바뀌었을 수 있으니 함께 갱신
cp $APP_DIR/deploy/poker-doku.service /etc/systemd/system/
cp $APP_DIR/deploy/Caddyfile /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl restart poker-doku
systemctl reload caddy

sleep 2
systemctl --no-pager --lines=0 status poker-doku | head -4
echo "배포 완료."
