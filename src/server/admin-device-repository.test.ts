import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ADMIN_DEVICE_LIMIT,
  AdminDeviceLimitError,
  AdminDeviceRepository,
} from './admin-device-repository';
import { openPokerDatabase, type PokerDatabase } from './persistence/database';

const NOW = Date.parse('2026-09-08T12:00:00+09:00');
const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1_000;
const SCOPE = 'scope-of-the-current-source-token';
const OTHER_SCOPE = 'scope-of-a-rotated-source-token';

describe('AdminDeviceRepository', () => {
  let database: PokerDatabase | undefined;
  const directories: string[] = [];

  afterEach(() => {
    database?.close();
    database = undefined;
    for (const directory of directories.splice(0)) {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  function open(): PokerDatabase {
    const directory = mkdtempSync(join(tmpdir(), 'admin-devices-'));
    directories.push(directory);
    database = openPokerDatabase(join(directory, 'poker.db'));
    return database;
  }

  function register(
    repository: AdminDeviceRepository,
    overrides: Partial<Parameters<AdminDeviceRepository['register']>[0]> = {},
  ) {
    return repository.register({
      id: 'device-1',
      lookupKey: 'lookup-1',
      sourceScope: SCOPE,
      csrfToken: 'csrf-1',
      principalId: 'admin_public_1',
      name: '등록된 브라우저',
      createdAt: NOW,
      expiresAt: NOW + NINETY_DAYS_MS,
      ...overrides,
    });
  }

  it('finds an active credential only inside its own source scope', () => {
    const repository = new AdminDeviceRepository(open());
    register(repository);

    expect(repository.findActive('lookup-1', SCOPE, NOW)).toMatchObject({
      id: 'device-1',
      principalId: 'admin_public_1',
      csrfToken: 'csrf-1',
      name: '등록된 브라우저',
      expiresAt: NOW + NINETY_DAYS_MS,
    });
    expect(repository.findActive('lookup-1', OTHER_SCOPE, NOW)).toBeNull();
    expect(repository.findActive('lookup-unknown', SCOPE, NOW)).toBeNull();
  });

  it('treats the ninety day boundary as expired and prunes stale rows', () => {
    const repository = new AdminDeviceRepository(open());
    register(repository);

    expect(repository.findActive('lookup-1', SCOPE, NOW + NINETY_DAYS_MS - 1))
      .not.toBeNull();
    expect(repository.findActive('lookup-1', SCOPE, NOW + NINETY_DAYS_MS))
      .toBeNull();
    expect(repository.list(SCOPE, NOW + NINETY_DAYS_MS)).toEqual([]);
    expect(repository.pruneExpired(NOW + NINETY_DAYS_MS)).toBe(1);
    expect(repository.pruneExpired(NOW + NINETY_DAYS_MS)).toBe(0);
  });

  it('renews only a live row and never resurrects a revoked one', () => {
    const repository = new AdminDeviceRepository(open());
    register(repository);

    const renewed = repository.renew(
      'lookup-1',
      SCOPE,
      NOW + 89 * 24 * 3_600_000,
      NOW + 89 * 24 * 3_600_000 + NINETY_DAYS_MS,
    );
    expect(renewed).toMatchObject({
      id: 'device-1',
      lastUsedAt: NOW + 89 * 24 * 3_600_000,
      expiresAt: NOW + 89 * 24 * 3_600_000 + NINETY_DAYS_MS,
    });

    expect(repository.revokeByLookupKey('lookup-1', SCOPE)).toBe(true);
    expect(repository.renew('lookup-1', SCOPE, NOW, NOW + NINETY_DAYS_MS))
      .toBeNull();
    expect(repository.list(SCOPE, NOW)).toEqual([]);
    expect(repository.revokeByLookupKey('lookup-1', SCOPE)).toBe(false);
  });

  it('replaces the previous credential of the same browser in one transaction', () => {
    const repository = new AdminDeviceRepository(open());
    register(repository);

    const replacement = register(repository, {
      id: 'device-2',
      lookupKey: 'lookup-2',
      csrfToken: 'csrf-2',
      principalId: 'admin_public_2',
      name: '두 번째',
      replacesLookupKey: 'lookup-1',
    });

    expect(replacement.id).toBe('device-2');
    expect(repository.findActive('lookup-1', SCOPE, NOW)).toBeNull();
    expect(repository.list(SCOPE, NOW)).toHaveLength(1);
  });

  it('caps registrations per source scope and rolls back the replacement on refusal', () => {
    const repository = new AdminDeviceRepository(open());
    for (let index = 0; index < ADMIN_DEVICE_LIMIT; index += 1) {
      register(repository, {
        id: `device-${index}`,
        lookupKey: `lookup-${index}`,
        csrfToken: `csrf-${index}`,
      });
    }
    expect(ADMIN_DEVICE_LIMIT).toBe(20);
    expect(repository.countActive(SCOPE, NOW)).toBe(20);

    expect(() => register(repository, {
      id: 'device-overflow',
      lookupKey: 'lookup-overflow',
      csrfToken: 'csrf-overflow',
    })).toThrowError(AdminDeviceLimitError);

    // 거절된 등록은 기존 자격을 폐기하지 않는다.
    expect(repository.findActive('lookup-0', SCOPE, NOW)).not.toBeNull();
    expect(repository.findActive('lookup-overflow', SCOPE, NOW)).toBeNull();
    expect(repository.countActive(SCOPE, NOW)).toBe(20);

    // 같은 브라우저의 교체 등록은 총량을 늘리지 않으므로 상한에서도 허용된다.
    expect(register(repository, {
      id: 'device-replacement',
      lookupKey: 'lookup-replacement',
      csrfToken: 'csrf-replacement',
      replacesLookupKey: 'lookup-0',
    }).id).toBe('device-replacement');
    expect(repository.findActive('lookup-0', SCOPE, NOW)).toBeNull();
    expect(repository.countActive(SCOPE, NOW)).toBe(20);

    // 다른 원본 토큰 스코프는 독립적으로 등록할 수 있다.
    expect(register(repository, {
      id: 'device-other-scope',
      lookupKey: 'lookup-other-scope',
      csrfToken: 'csrf-other-scope',
      sourceScope: OTHER_SCOPE,
    }).id).toBe('device-other-scope');

    // 만료된 자리는 상한에서 제외된다.
    expect(repository.renew('lookup-1', SCOPE, NOW, NOW + 1_000)).not.toBeNull();
    expect(repository.countActive(SCOPE, NOW + 1_000)).toBe(19);
    expect(register(repository, {
      id: 'device-after-expiry',
      lookupKey: 'lookup-after-expiry',
      csrfToken: 'csrf-after-expiry',
      createdAt: NOW + 1_000,
      expiresAt: NOW + 1_000 + NINETY_DAYS_MS,
    }).id).toBe('device-after-expiry');
  });

  it('revokes one device by public id inside the scope only', () => {
    const repository = new AdminDeviceRepository(open());
    register(repository);
    register(repository, {
      id: 'device-2',
      lookupKey: 'lookup-2',
      csrfToken: 'csrf-2',
    });

    expect(repository.revokeById('device-1', OTHER_SCOPE)).toBe(false);
    expect(repository.findActive('lookup-1', SCOPE, NOW)).not.toBeNull();
    expect(repository.revokeById('device-1', SCOPE)).toBe(true);
    expect(repository.findActive('lookup-1', SCOPE, NOW)).toBeNull();
    expect(repository.findActive('lookup-2', SCOPE, NOW)).not.toBeNull();
  });

  it('lists scoped devices newest first without exposing any secret material', () => {
    const repository = new AdminDeviceRepository(open());
    register(repository);
    register(repository, {
      id: 'device-2',
      lookupKey: 'lookup-2',
      csrfToken: 'csrf-2',
      name: '사무실 노트북',
      createdAt: NOW + 5_000,
      expiresAt: NOW + 5_000 + NINETY_DAYS_MS,
    });
    register(repository, {
      id: 'device-3',
      lookupKey: 'lookup-3',
      csrfToken: 'csrf-3',
      sourceScope: OTHER_SCOPE,
    });

    const listed = repository.list(SCOPE, NOW + 5_000);
    expect(listed.map(device => device.id)).toEqual(['device-2', 'device-1']);
    expect(listed[0]).toEqual({
      id: 'device-2',
      name: '사무실 노트북',
      createdAt: NOW + 5_000,
      lastUsedAt: NOW + 5_000,
      expiresAt: NOW + 5_000 + NINETY_DAYS_MS,
    });
    expect(JSON.stringify(listed)).not.toContain('csrf-2');
    expect(JSON.stringify(listed)).not.toContain('lookup-2');
  });

  it('persists no raw cookie credential column beyond the supplied lookup key', () => {
    const persisted = open();
    const repository = new AdminDeviceRepository(persisted);
    register(repository);

    const rows = persisted.db
      .prepare('SELECT * FROM admin_trusted_devices')
      .all();
    expect(JSON.stringify(rows)).toContain('lookup-1');
    expect(Object.keys(rows[0] as Record<string, unknown>).sort()).toEqual([
      'created_at',
      'csrf_token',
      'expires_at',
      'id',
      'last_used_at',
      'lookup_key',
      'name',
      'principal_id',
      'source_scope',
    ]);
  });

  it('survives closing and reopening the same file database', () => {
    const directory = mkdtempSync(join(tmpdir(), 'admin-devices-restart-'));
    directories.push(directory);
    const path = join(directory, 'poker.db');
    const first = openPokerDatabase(path);
    register(new AdminDeviceRepository(first));
    first.close();

    database = openPokerDatabase(path);
    const restarted = new AdminDeviceRepository(database);
    expect(restarted.findActive('lookup-1', SCOPE, NOW + 3_600_000))
      .toMatchObject({ id: 'device-1', principalId: 'admin_public_1' });
  });
});
