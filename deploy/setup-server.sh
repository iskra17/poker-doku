#!/usr/bin/env bash
# Poker Doku — Vultr 서울(Ubuntu 24.04 LTS) 최초 서버 세팅 (root로 1회 실행)
#
# 사용법:
#   curl -fsSL https://raw.githubusercontent.com/iskra17/poker-doku/main/deploy/setup-server.sh | bash
# 또는 저장소 클론 후: bash deploy/setup-server.sh
#
# 하는 일: 스왑 2GB → Node 22 → Caddy → 방화벽 → 앱 유저/빌드 → systemd 등록
set -euo pipefail

REPO_URL="https://github.com/iskra17/poker-doku.git"
APP_DIR=/opt/poker-doku
APP_USER=poker

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y git curl ufw

echo "=== [1/7] 스왑 2GB (1GB RAM에서 next build OOM 방지) ==="
if ! swapon --show | grep -q /swapfile; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "=== [2/7] Node.js 22 LTS ==="
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "=== [3/7] Caddy (리버스 프록시 · 도메인 연결 시 자동 HTTPS) ==="
if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update && apt-get install -y caddy
fi

echo "=== [4/7] 방화벽 (SSH/80/443만 개방 — 앱 포트 3000은 외부 차단) ==="
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

echo "=== [5/7] 앱 유저 · 코드 · 빌드 ==="
id -u $APP_USER >/dev/null 2>&1 || useradd -r -m -s /usr/sbin/nologin $APP_USER
if [ ! -d $APP_DIR/.git ]; then
  git clone "$REPO_URL" $APP_DIR
fi
chown -R $APP_USER:$APP_USER $APP_DIR
sudo -u $APP_USER bash -c "cd $APP_DIR && npm ci && npm run build"

echo "=== [6/7] 환경변수 · systemd 서비스 ==="
if [ ! -f /etc/poker-doku.env ]; then
  cat > /etc/poker-doku.env <<'ENVEOF'
# Gemini AI 상황 대사 — 비워두면 비활성 (스크립트 대사만 사용)
GEMINI_API_KEY=
# 일일 호출 상한 — 동접 100 규모 권장값 (기본 200, 월 ~$3 이내)
AI_DIALOGUE_DAILY_MAX=1500
ENVEOF
  chmod 600 /etc/poker-doku.env
fi
cp $APP_DIR/deploy/poker-doku.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now poker-doku

echo "=== [7/7] Caddy 설정 ==="
cp $APP_DIR/deploy/Caddyfile /etc/caddy/Caddyfile
systemctl reload caddy

IP=$(curl -s --max-time 5 ifconfig.me || echo "<서버IP>")
echo ""
echo "──────────────────────────────────────────────"
echo "완료! http://$IP 로 접속해 확인하세요."
echo ""
echo "다음 단계:"
echo "  1) AI 대사 켜기:  nano /etc/poker-doku.env  (GEMINI_API_KEY 입력)"
echo "                    systemctl restart poker-doku"
echo "  2) 도메인 연결:   /etc/caddy/Caddyfile 주석 참고 (자동 HTTPS)"
echo "  3) 코드 갱신 배포: bash $APP_DIR/deploy/deploy.sh"
echo "──────────────────────────────────────────────"
