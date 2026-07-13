# Vultr 서울 배포 가이드

목표 구성: Vultr 서울 리전 VM 1대 (월 ~$6) + Caddy 리버스 프록시.
동접 100명 기준으로 충분하며, 초과 성장 시 Vultr 대시보드에서 상위 플랜으로
리사이즈하면 된다 (인메모리 단일 인스턴스 구조 — 수평 확장 불가, 수직 확장만).

## 1. VM 생성 (Vultr 대시보드)

1. [vultr.com](https://www.vultr.com) 가입 → **Deploy New Server**
2. 종류: **Cloud Compute — Shared CPU**
3. 위치: **Seoul**
4. 이미지: **Ubuntu 24.04 LTS x64**
5. 플랜: **1 vCPU / 1GB RAM** (~$6/월) — 빌드용 스왑은 셋업 스크립트가 잡아준다
6. 나머지 기본값으로 Deploy → IP 주소 확인

## 2. 서버 셋업 (1회)

로컬 PowerShell에서 SSH 접속 후 셋업 스크립트 실행:

```powershell
ssh root@<서버IP>
```

```bash
curl -fsSL https://raw.githubusercontent.com/iskra17/poker-doku/main/deploy/setup-server.sh | bash
```

약 5~10분 (1GB VM에서 next build가 느린 게 정상). 끝나면 `http://<서버IP>` 접속 확인.

## 3. Gemini AI 대사 활성화 (선택)

poker-doku 전용 Google 프로젝트에서 API 키 발급 후 (fight club과 쿼터 분리):

```bash
nano /etc/poker-doku.env    # GEMINI_API_KEY=<키> 입력
systemctl restart poker-doku
journalctl -u poker-doku | grep ai-dialogue   # "enabled" 확인
```

## 4. 이후 코드 갱신 배포

로컬에서 `git push` 후 서버에서:

```bash
bash /opt/poker-doku/deploy/deploy.sh
```

재시작하면 진행 중이던 방이 초기화되므로 한가한 시간대에 배포할 것.

## 5. 도메인 + HTTPS (선택)

도메인 A 레코드를 서버 IP로 지정 → `/etc/caddy/Caddyfile`에서 `:80` 블록을
도메인 블록으로 교체 (파일 내 주석 참고) → `systemctl reload caddy`.
인증서는 Caddy가 자동 발급/갱신한다.

## 운영 참고

| 항목 | 명령 |
|---|---|
| 서버 상태 | `systemctl status poker-doku` |
| 실시간 로그 | `journalctl -u poker-doku -f` |
| 재시작 | `systemctl restart poker-doku` |
| 메모리 확인 | `free -h` |

- 방화벽: 22/80/443만 개방 (앱 포트 3000은 Caddy 뒤로 숨김)
- 서비스에 `MemoryMax=768M` — 초과 시 자동 재시작 (게임 상태 인메모리 초기화)
- Gemini 비용은 코드의 일일 상한(`AI_DIALOGUE_DAILY_MAX`)이 하드캡 —
  1500회/일 기준 월 ~$3, 폭주 불가
