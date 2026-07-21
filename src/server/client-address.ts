import type { IncomingMessage } from 'node:http';

/**
 * 레이트리밋 키로 쓸 실제 클라이언트 주소.
 *
 * 프로덕션(Fly.io)은 fly-proxy 뒤라 socket.remoteAddress가 전부 프록시 주소로 보인다.
 * 그대로 키로 쓰면 전체 방문자가 버킷 하나를 공유해, 트래픽이 몰리면 모두가 429를 받는다
 * (2026-07-21 디시 유입 때 실제 발생 — profileAuth 30회/분이 전 방문자 합산으로 소진).
 *
 * 우선순위:
 * 1. X-Forwarded-For의 **마지막 홉** — 신뢰 프록시(fly-proxy/nginx)가 실제 접속 IP를
 *    끝에 append하므로 위조 불가. 첫 항목을 쓰면 클라이언트가 헤더를 조작해 버킷을
 *    무한 분산(레이트리밋 우회)할 수 있으니 절대 첫 항목으로 바꾸지 말 것.
 * 2. Fly-Client-IP — fly-proxy가 세팅하는 보조 헤더.
 * 3. 소켓 주소 — 프록시 없는 dev/직접 노출 환경 폴백.
 *
 * 전제: 프로덕션은 항상 신뢰 프록시 뒤에서 구동한다 (fly.toml/deploy README의 배포 형태).
 * 프록시 없이 직접 노출하면 XFF를 위조할 수 있으므로 이 헬퍼를 소켓 주소로 되돌려야 한다.
 */
export function clientAddressFromHeaders(
  headers: Record<string, string | string[] | undefined>,
  socketAddress: string | null | undefined,
): string {
  const xff = headers['x-forwarded-for'];
  const rawXff = Array.isArray(xff) ? xff[xff.length - 1] : xff;
  if (typeof rawXff === 'string' && rawXff.length > 0) {
    const hops = rawXff.split(',');
    const lastHop = hops[hops.length - 1]?.trim();
    if (lastHop && lastHop.length <= 64) return lastHop;
  }
  const fly = headers['fly-client-ip'];
  if (typeof fly === 'string' && fly.length > 0 && fly.length <= 64) return fly;
  return socketAddress ?? 'unknown';
}

export function clientAddress(request: IncomingMessage): string {
  return clientAddressFromHeaders(request.headers, request.socket?.remoteAddress);
}
