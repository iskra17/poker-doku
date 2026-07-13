# 배포 가이드 — Fly.io 도쿄 (기본)

구성: Fly.io `nrt`(도쿄) 리전, shared-cpu-1x / 1GB 단일 머신 (~$6/월 + 트래픽 $0.04/GB,
동접 100 기준 총 ~$12~15/월). 설정은 리포 루트의 `fly.toml` + `Dockerfile`.
빌드는 Fly 원격 빌더가 수행하므로 로컬 Docker 불필요.

## 1. 최초 배포 (1회)

```powershell
# flyctl 설치 (PowerShell)
iwr https://fly.io/install.ps1 -useb | iex

# 가입/로그인 (브라우저 열림 — 카드 등록 필요)
fly auth signup   # 또는 fly auth login

# 앱 생성 (리포 루트에서 — fly.toml의 설정을 그대로 사용)
# ⚠️ 앱 이름은 전역 고유 — 'poker-doku'가 선점됐으면 다른 이름 입력 (fly.toml에 자동 반영)
fly launch --copy-config --no-deploy

# Gemini 키 주입 (선택 — 없으면 AI 대사만 비활성)
fly secrets set GEMINI_API_KEY=<키>

# 배포
fly deploy
```

끝나면 `https://<앱이름>.fly.dev` 로 접속 확인.

## 2. 이후 갱신 배포

```powershell
fly deploy
```

재시작 시 진행 중이던 방이 초기화되므로(인메모리) 한가한 시간대 권장.

## 3. 운영 참고

| 항목 | 명령 |
|---|---|
| 실시간 로그 | `fly logs` |
| 상태/머신 확인 | `fly status` |
| 사양 변경 (동접 증가 시) | `fly scale memory 2048` / `fly scale vm shared-cpu-2x` |
| 비용 확인 | 대시보드 fly.io/dashboard → Billing |
| AI 대사 활성 확인 | `fly logs` 에서 `[ai-dialogue] enabled` |

핵심 설정 주의사항 (fly.toml):
- `auto_stop_machines = "off"` — **절대 켜지 말 것.** 게임 상태가 전부 인메모리라
  머신이 잠들면 방/좌석/칩이 전멸하고 콜드스타트가 생긴다.
- 머신은 항상 1대 — 인메모리 단일 인스턴스 구조라 `fly scale count 2` 금지 (수직 확장만).
- Gemini 비용은 코드의 일일 상한(`AI_DIALOGUE_DAILY_MAX`)이 하드캡 — 1500회/일 기준 월 ~$3.

---

# 대안: Vultr 서울 자가 호스팅 (월 $6 고정)

관리형 대신 VPS 직접 운영을 원할 때. 이 디렉토리의 스크립트 사용:

1. Vultr 가입 → Cloud Compute / **Seoul** / **Ubuntu 24.04 LTS** / 1vCPU·1GB (~$6)
2. `ssh root@<서버IP>` 후:
   ```bash
   curl -fsSL https://raw.githubusercontent.com/iskra17/poker-doku/main/deploy/setup-server.sh | bash
   ```
3. Gemini 키: `nano /etc/poker-doku.env` → `systemctl restart poker-doku`
4. 갱신 배포: 로컬 `git push` 후 서버에서 `bash /opt/poker-doku/deploy/deploy.sh`
5. 도메인/HTTPS: `/etc/caddy/Caddyfile` 주석 참고

운영: `systemctl status poker-doku` / `journalctl -u poker-doku -f`
