import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

export const BACKUP_FORMAT_VERSION = 1;

/**
 * Tabulky, jejichž počty řádků jdou do manifestu. `contacts` tam musí být,
 * protože akceptační kritérium 9 části 1 kontroluje právě jeho hodnotu.
 * Ostatní jsou tam proto, aby `mlain backup verify` poznal i tichou ztrátu
 * jiné než největší tabulky.
 */
export const BACKUP_ROW_COUNT_TABLES = [
  'users',
  'workspaces',
  'memberships',
  'contacts',
  'lists',
  'tags',
  'segments',
  'templates',
  'campaigns',
  'suppressions',
  'audit_log',
] as const;

const sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'sha256 musí být 64 hexadecimálních znaků');

export const manifestSchema = z.object({
  format_version: z.literal(BACKUP_FORMAT_VERSION, {
    message: `format_version musí být ${BACKUP_FORMAT_VERSION}`,
  }),
  created_at: z.iso.datetime(),
  app_version: z.string().min(1),
  schema_version: z.number().int().nonnegative(),
  installation_id: z.uuid(),
  secret_key_fingerprint: z.string().min(1),
  postgres_version: z.string().min(1),
  database: z.object({ bytes: z.number().int().nonnegative(), sha256 }),
  uploads: z
    .object({
      bytes: z.number().int().nonnegative(),
      sha256,
      files: z.number().int().nonnegative(),
    })
    .nullable(),
  row_counts: z
    .record(z.string(), z.number().int().nonnegative())
    .refine((r) => typeof r['contacts'] === 'number', {
      message: 'row_counts musí obsahovat contacts',
    }),
});

export type BackupManifest = z.infer<typeof manifestSchema>;

export function parseManifest(input: unknown): BackupManifest {
  return manifestSchema.parse(input);
}

export async function readManifest(dir: string): Promise<BackupManifest> {
  return parseManifest(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')));
}

export async function writeManifest(dir: string, manifest: BackupManifest): Promise<void> {
  await writeFile(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

export async function fileSha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** Porovná verze po částech; předvydání (`-dev`, `-rc.1`) je vždy starší než holá verze. */
export function isBackupFromNewerVersion(backupVersion: string, imageVersion: string): boolean {
  return compareSemver(backupVersion, imageVersion) > 0;
}

function compareSemver(a: string, b: string): number {
  const split = (v: string): { nums: [number, number, number]; pre: string | null } => {
    const [core, pre] = v.split('-', 2);
    const nums = (core ?? '').split('.').map((n) => Number.parseInt(n, 10) || 0);
    return { nums: [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0], pre: pre ?? null };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < 3; i += 1) {
    if (x.nums[i] !== y.nums[i]) return x.nums[i]! - y.nums[i]!;
  }
  if (x.pre === y.pre) return 0;
  if (x.pre !== null && y.pre === null) return -1;
  if (x.pre === null && y.pre !== null) return 1;
  return x.pre!.localeCompare(y.pre!);
}

export type RowCountDiff = { table: string; expected: number; actual: number };

export function compareRowCounts(
  expected: Record<string, number>,
  actual: Record<string, number>,
): RowCountDiff[] {
  return Object.entries(expected)
    .map(([table, count]) => ({ table, expected: count, actual: actual[table] ?? 0 }))
    .filter((d) => d.expected !== d.actual);
}
