export interface SocketOriginOptions {
  production: boolean;
  allowedOrigins: ReadonlySet<string>;
}

export function parseSocketAllowedOrigins(raw: string | undefined): Set<string> {
  const origins = new Set<string>();
  for (const candidate of raw?.split(',') ?? []) {
    try {
      const url = new URL(candidate.trim());
      if (url.protocol === 'http:' || url.protocol === 'https:') origins.add(url.origin);
    } catch {
      // 잘못된 운영 설정 항목 하나가 서버 전체를 막지 않게 무시한다.
    }
  }
  return origins;
}

export function isSocketOriginAllowed(
  origin: string | undefined,
  host: string | undefined,
  options: SocketOriginOptions,
): boolean {
  if (!options.production || !origin) return true;
  try {
    const parsed = new URL(origin);
    return parsed.host === host || options.allowedOrigins.has(parsed.origin);
  } catch {
    return false;
  }
}
