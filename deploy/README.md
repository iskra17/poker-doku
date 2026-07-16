# Poker Doku Fly.io 운영 가이드

Poker Doku는 Socket.IO와 서버 권위 게임 상태를 함께 가진 커스텀 Node 서버다. Fly.io `nrt`
리전의 **단일 머신**만 사용한다. `auto_stop_machines = "off"`와 1대 구성을 유지하고 수직 확장만
한다. SQLite 원본과 백업은 `poker_doku_data` 볼륨의 `/data`에 둔다.

## 최초 배포

```powershell
iwr https://fly.io/install.ps1 -useb | iex
fly auth login
fly launch --copy-config --no-deploy
fly volumes create poker_doku_data --region nrt --size 1
```

운영에서는 `BACKUP_ENCRYPTION_KEY`가 없거나 잘못되면 서버가 트래픽을 받기 전에 종료 코드 1로
실패한다. 다음 PowerShell 명령은 32바이트 키를 메모리에서 만들고 표준 입력으로 전달하므로 키
값을 콘솔이나 명령 기록에 직접 남기지 않는다.

```powershell
$secretLine = "BACKUP_ENCRYPTION_KEY=$([Convert]::ToBase64String([Security.Cryptography.RandomNumberGenerator]::GetBytes(32)))"
$secretLine | fly secrets import
$secretLine = $null
Remove-Variable secretLine -ErrorAction SilentlyContinue
```

Gemini 대사를 쓰는 경우에만 별도로 `fly secrets set GEMINI_API_KEY=...`를 실행한다. 배포 시 HA를
만들지 않는다.

```powershell
fly deploy --ha=false
fly scale count 1
fly status
curl.exe -fsS https://poker-doku.fly.dev/healthz
```

`fly status`에서 리전 `nrt`, 머신 1대, 상태 `started`를 확인한다. 다음 명령으로 볼륨과 백업 파일도
확인한다. 키나 파일 본문은 출력하지 않는다.

```powershell
fly ssh console -C "mount | grep ' /data '; ls -lah /data /data/backups"
```

## 백업 정책

- DB를 열고 마이그레이션한 뒤 미완료 cash/Sit & Go escrow를 복구한다.
- 복구 직후 첫 백업이 완료되어야 HTTP/Socket 서버가 listen한다.
- 매일 **KST 04:00**에 다음 시각을 다시 계산해 백업한다. 고정 24시간 interval이 아니다.
- 정상 종료 시 게임/소켓/HTTP writer를 닫은 뒤 DB를 닫기 전에 한 번 더 백업한다.
- 같은 KST 날짜에는 첫 번째로 완성된 백업을 보존한다. 이후 백업이 실패해도 그 파일을 교체하거나
  지우지 않는다.
- 운영 백업은 `poker-doku-YYYY-MM-DD.sqlite.enc`이며 AES-256-GCM으로 인증 암호화한다.
- 완료된 백업만 대상으로 14 KST calendar day를 보존한다. 15일 지난 파일부터 삭제한다.
- live DB/WAL을 파일 복사해 백업하지 않는다. 서버는 Node 공식 `node:sqlite backup()` API로 일관된
  스냅샷을 만든 뒤 무결성을 검사한다.

## 백업 복호화와 무결성 확인

복호화 구현과 동일한 코드로 후보 파일을 만든다. 기존 출력 파일이 있으면 명령은 덮어쓰지 않는다.
운영 머신에서는 `/app`에 소스와 `tsx` 런타임이 포함되어 있다.

```bash
cd /app
node_modules/.bin/tsx -e "import {decryptBackupFile,resolveBackupEncryptionKey} from './src/server/persistence/backup.ts'; (async()=>decryptBackupFile('/data/backups/poker-doku-2026-07-16.sqlite.enc','/data/restore-candidate.sqlite',resolveBackupEncryptionKey(process.env.BACKUP_ENCRYPTION_KEY,true)))().catch(e=>{console.error(e.message);process.exit(1)})"
node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('/data/restore-candidate.sqlite',{readOnly:true});const r=d.prepare('PRAGMA integrity_check').get();d.close();if(r.integrity_check!=='ok')process.exit(1);console.log('integrity_check: ok')"
```

변조된 파일, 잘못된 키, 잘못된 형식은 인증에 실패하며 `restore-candidate.sqlite`를 남기지 않는다.

## 안전한 복원과 롤백

먼저 복원 후보를 위 절차로 만들고 무결성을 확인한다. 그 다음 머신을 maintenance command로
재시작해 애플리케이션 writer를 완전히 멈춘다. `<machine-id>`는 `fly status`에서 확인한다.

```powershell
fly machine update <machine-id> --command "sleep inf" --skip-health-checks
fly ssh console
```

maintenance 셸에서 현재 DB를 절대 덮어쓰지 말고 먼저 같은 볼륨에 사본을 남긴다. 애플리케이션이
중지된 상태에서만 stale WAL/SHM을 제거하고, 후보를 같은 파일시스템에서 atomic rename한다.

```bash
set -euo pipefail
test -f /data/restore-candidate.sqlite
stamp=$(date -u +%Y%m%dT%H%M%SZ)
cp -p /data/poker-doku.sqlite "/data/poker-doku.before-restore.$stamp.sqlite"
rm -f /data/poker-doku.sqlite-wal /data/poker-doku.sqlite-shm
mv /data/restore-candidate.sqlite /data/poker-doku.sqlite
```

원래 실행 명령으로 복구하고 health를 확인한다.

```powershell
fly machine update <machine-id> --command "node_modules/.bin/tsx src/server/index.ts"
fly status
curl.exe -fsS https://poker-doku.fly.dev/healthz
fly logs
```

문제가 있으면 같은 maintenance 절차로 들어가 현재 실패 DB도 별도 사본으로 남긴 뒤
`/data/poker-doku.before-restore.<timestamp>.sqlite`를 `/data/poker-doku.sqlite`로 atomic rename한다.
백업 없이 기존 DB를 덮어쓰는 복원은 금지한다.

## 갱신과 관찰

```powershell
fly deploy
fly status
fly logs
fly ssh console -C "ls -lah /data/backups"
```

메모리나 CPU가 부족하면 `fly scale memory 2048` 또는 `fly scale vm shared-cpu-2x`처럼 수직
확장한다. `fly scale count 2`는 인메모리 방 상태와 단일 SQLite writer 전제를 깨므로 사용하지 않는다.

## 공개 홍보 전 확인 게이트

공개 마케팅이나 이용자 유입을 시작하기 전에 다음 사항을 관할 기관 또는 전문 자문으로 **공식
확인**하고 증빙을 보관한다. 현재 구현이나 이 문서는 법적 승인 완료를 뜻하지 않는다.

- 대한민국 `청소년이용불가` 등급분류의 완료 여부, 표시 문구와 노출 위치
- 웹 보드게임에 적용되는 성인 본인확인/본인인증 의무의 구체적 적용 여부
- 무료 칩, 레이크 소각, 시즌 경쟁과 보상이 사행성·경품 규정에 미치는 영향
- 개인정보를 최소 수집하는 익명 프로필 구조와 법정 의무의 양립 여부

공식 확인 전에는 공개 획득 캠페인, 현금·현물·상품 보상, 결제 기능을 시작하지 않는다.

## Vultr 대안

Vultr를 사용할 경우에도 단일 인스턴스와 영속 볼륨, 동일한 `POKER_DB_PATH`,
`POKER_BACKUP_DIR`, `BACKUP_ENCRYPTION_KEY`를 설정해야 한다. 기존 보조 스크립트는
`deploy/setup-server.sh`, `deploy/deploy.sh`, `deploy/poker-doku.service`에 있다. SQLite 백업·복원
원칙과 공개 전 법적 확인 게이트는 Fly.io와 동일하다.
