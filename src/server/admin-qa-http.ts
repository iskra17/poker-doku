import type { IncomingMessage, ServerResponse } from 'node:http';
import { drainRequest } from './http-body';
import { PROFILE_COOKIE_NAME, readProfileCredentialCookie } from './profile-http';

const BACKUP_COOKIE = 'poker_doku_qa_original';
const MAX_AGE = 365 * 24 * 60 * 60;
const CREDENTIAL = /^[A-Za-z0-9_-]{43}$/u;

function cookie(name: string, value: string, path: string, production: boolean, clear = false): string {
  return `${name}=${value}; Path=${path}; HttpOnly; SameSite=${name === BACKUP_COOKIE ? 'Strict' : 'Lax'}; Max-Age=${clear ? 0 : MAX_AGE}${production ? '; Secure' : ''}`;
}

/** Called only AFTER the shared admin session / Origin / CSRF gate. */
export function handleAdminQa(req: IncomingMessage, res: ServerResponse, production: boolean): void {
  drainRequest(req);
  const values = (req.headers.cookie ?? '').split(';')
    .map(part => part.trim()).filter(part => part.split('=', 1)[0].trim() === BACKUP_COOKIE)
    .map(part => part.slice(BACKUP_COOKIE.length + 1));
  const original = values[0];
  const active = original !== undefined;
  const send = (status: number, body: unknown, cookies: string[] = []) => {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
      ...(cookies.length ? { 'set-cookie': cookies } : {}),
    });
    res.end(JSON.stringify(body));
  };
  // Never replace an ambiguous backup: it may be the only way back to the original account.
  if (values.length > 1 || (active && original !== '-' && !CREDENTIAL.test(original))) {
    send(409, { error: 'invalid-qa-backup' });
    return;
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    send(200, { active });
    return;
  }
  if (req.method === 'POST') {
    const current = readProfileCredentialCookie(req.headers.cookie);
    if (!active && current !== null && !CREDENTIAL.test(current)) {
      send(409, { error: 'invalid-profile-cookie' });
      return;
    }
    send(200, { active: true }, [
      // A restart preserves the FIRST account, never the last QA account.
      ...(!active ? [cookie(BACKUP_COOKIE, current ?? '-', '/api/admin', production)] : []),
      cookie(PROFILE_COOKIE_NAME, '', '/', production, true),
    ]);
    return;
  }
  if (req.method === 'DELETE') {
    send(200, { active: false }, active ? [
      cookie(PROFILE_COOKIE_NAME, original === '-' ? '' : original, '/', production, original === '-'),
      cookie(BACKUP_COOKIE, '', '/api/admin', production, true),
    ] : []);
    return;
  }
  res.setHeader('allow', 'GET, HEAD, POST, DELETE');
  send(405, { error: 'method-not-allowed' });
}
