import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { progressionProfileIdentity } from './ProgressionLifecycle';

describe('ProgressionLifecycle', () => {
  it('only exposes a progression identity for a ready profile', () => {
    expect(progressionProfileIdentity('ready', 'profile-1')).toBe('profile-1');
    expect(progressionProfileIdentity('loading', 'profile-1')).toBeNull();
    expect(progressionProfileIdentity('ready', null)).toBeNull();
  });

  it('is mounted by the root layout so direct table routes share the lifecycle', () => {
    const layout = readFileSync(resolve(process.cwd(), 'src/app/layout.tsx'), 'utf8');
    const directTable = readFileSync(resolve(process.cwd(), 'src/app/table/[id]/page.tsx'), 'utf8');

    expect(layout).toContain("import ProgressionLifecycle from '@/components/progression/ProgressionLifecycle'");
    expect(layout).toContain('<ProgressionLifecycle />');
    expect(directTable).not.toContain('bindSocket');
    expect(directTable).not.toContain('useProgressionStore');
  });
});
