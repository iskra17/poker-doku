import { createServer } from 'http';
import type { AddressInfo } from 'net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createHttpRequestHandler,
  type HttpHandlerOptions,
  type NextRequestHandler,
} from './http-handler';
import type { ProfileHttpManager } from './profile-http';

describe('커스텀 서버 HTTP 경계', () => {
  const servers: ReturnType<typeof createServer>[] = [];

  afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => {
      server.close(() => resolve());
    })));
  });

  async function start(nextHandler = vi.fn((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('next');
  })) {
    const server = createServer(createHttpRequestHandler(nextHandler, { debugToken: 'debug-secret' }));
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    return { nextHandler, baseUrl: `http://127.0.0.1:${port}` };
  }

  it('/healthz는 Next 핸들러 없이 200 JSON을 반환한다', async () => {
    const { nextHandler, baseUrl } = await start();

    const response = await fetch(`${baseUrl}/healthz`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(nextHandler).not.toHaveBeenCalled();
  });

  it('debug 로그는 토큰이 없으면 403이고 일반 경로만 Next로 넘긴다', async () => {
    const { nextHandler, baseUrl } = await start();

    const forbidden = await fetch(`${baseUrl}/api/debug/log`);
    const page = await fetch(`${baseUrl}/some-page`);

    expect(forbidden.status).toBe(403);
    expect(page.status).toBe(200);
    expect(await page.text()).toBe('next');
    expect(nextHandler).toHaveBeenCalledTimes(1);
  });

  it('profile manager without an owned limiter fails before creating a timer', () => {
    const nextHandler = vi.fn<NextRequestHandler>();
    const profileManager = {} as ProfileHttpManager;
    const intervalSpy = vi.spyOn(globalThis, 'setInterval');
    const unsafeOptions = { profileManager } as HttpHandlerOptions;

    expect(() => createHttpRequestHandler(nextHandler, unsafeOptions)).toThrowError(
      'PROFILE_RATE_LIMITER_REQUIRED',
    );
    expect(intervalSpy).not.toHaveBeenCalled();
  });

  it('requires caller-owned rate limiter at the TypeScript boundary', () => {
    const nextHandler = vi.fn<NextRequestHandler>();
    const profileManager = {} as ProfileHttpManager;

    const createWithoutLimiter = (): unknown => createHttpRequestHandler(
      nextHandler,
      // @ts-expect-error profileManager requires profileRateLimiter ownership.
      { profileManager },
    );

    expect(createWithoutLimiter).toBeTypeOf('function');
  });
});
