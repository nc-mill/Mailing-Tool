import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { checkBackupFreshness, checkDataVolume } from '../../src/ops/doctor/checks-storage';

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'mlain-doctor-'));
  await mkdir(join(root, 'plny'), { recursive: true });
  await writeFile(join(root, 'plny', 'neco.txt'), 'x');
  await mkdir(join(root, 'prazdny'), { recursive: true });
  await mkdir(join(root, 'zalohy', 'mlain-20260701T030000Z'), { recursive: true });
});

describe('checkDataVolume', () => {
  it('prázdný datový svazek u běžící instalace hlásí jako kritický', async () => {
    const f = await checkDataVolume(join(root, 'prazdny'), true);
    expect(f?.severity).toBe('critical');
    expect(f?.detail).toMatch(/postgres/i);
  });

  it('u prázdné instalace prázdný svazek nevadí', async () => {
    expect(await checkDataVolume(join(root, 'prazdny'), false)).toBeNull();
  });

  it('neprázdný svazek nehlásí nic', async () => {
    expect(await checkDataVolume(join(root, 'plny'), true)).toBeNull();
  });

  it('neexistující svazek hlásí jako kritický', async () => {
    const f = await checkDataVolume(join(root, 'neexistuje'), true);
    expect(f?.severity).toBe('critical');
  });
});

describe('checkBackupFreshness', () => {
  const now = new Date('2026-07-31T12:00:00.000Z');

  it('žádná záloha u instalace s daty je varování', async () => {
    const f = await checkBackupFreshness(join(root, 'prazdny'), now, true);
    expect(f?.severity).toBe('warning');
    expect(f?.id).toBe('no_backup_yet');
  });

  it('záloha starší než 7 dní je varování', async () => {
    const f = await checkBackupFreshness(join(root, 'zalohy'), now, true);
    expect(f?.id).toBe('backup_stale');
    expect(f?.title).toContain('30');
  });

  it('čerstvá záloha nehlásí nic', async () => {
    const f = await checkBackupFreshness(
      join(root, 'zalohy'),
      new Date('2026-07-02T03:00:00.000Z'),
      true,
    );
    expect(f).toBeNull();
  });
});
