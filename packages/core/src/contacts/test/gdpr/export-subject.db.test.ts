import { mkdtempSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * DATA_DIR se přepisuje JEŠTĚ PŘED startem harnessu, který ho nastavuje jen přes `??=`.
 * Job si cestu bere z `loadConfig()`, tedy z prostředí, a bez tohohle by testovací
 * archivy padaly do `/tmp` vedle všeho ostatního.
 */
const DATA_DIR = mkdtempSync(join(tmpdir(), 'mlain-gdpr-export-'));
process.env['DATA_DIR'] = DATA_DIR;

import { describe, expect, it } from 'vitest';
import { createFileExportStorage } from '../../export/storage';
import { issueExportDownloadToken, verifyDownloadToken } from '../../export/service';
import { exportSubjectData } from '../../jobs/gdpr-export';
import { createGdprRequest } from '../../repo/gdpr';
import { getHandler } from '../../retention/registry';
// Import kvůli vedlejšímu efektu: registruje handlery retence včetně cíle `exports`.
import '../../retention/handlers';
import {
  asMigrator,
  createActiveContact,
  createList,
  createSubscription,
  testContext,
} from '../support/db';
import { one } from '../support/phase-c';

/**
 * Databázový důkaz, že archiv subjektu údajů SKUTEČNĚ VZNIKNE NA DISKU.
 *
 * Tenhle soubor je tu proto, že předchozí stav vypadal zvenčí úplně stejně jako
 * hotová funkce: job doběhl, vrátil počet souborů a bajtů, žádost se dala uzavřít
 * jako vyřízená, a subjekt nedostal nic. Zelený test nad `buildSubjectArchive` to
 * neodhalil, protože archiv opravdu vznikl, jen skončil v paměti.
 *
 * Proto se tady netvrdí nic o návratové hodnotě, dokud se totéž nepotvrdí ze
 * souborového systému a z databáze.
 */

/** Čte archiv přes lokální hlavičky. `createZip` ukládá bez komprese, takže data leží tak, jak jsou. */
function readZip(buffer: Buffer): Map<string, string> {
  const files = new Map<string, string>();
  let offset = 0;
  while (offset + 4 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const size = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString('utf8');
    const start = offset + 30 + nameLength + extraLength;
    files.set(name, buffer.subarray(start, start + size).toString('utf8'));
    offset = start + size;
  }
  return files;
}

async function subjectWithData(): Promise<{
  ctx: Awaited<ReturnType<typeof testContext>>;
  requestId: string;
  email: string;
}> {
  const ctx = await testContext();
  const email = `subjekt-${Date.now()}@example.cz`;
  const contact = await createActiveContact(ctx, email);
  const list = await createList(ctx, { name: 'Newsletter' });
  await createSubscription(ctx, { contactId: contact.id, listId: list.id, status: 'confirmed' });
  const request = await createGdprRequest(ctx, {
    email,
    type: 'portability',
    channel: 'preference_center',
  });
  return { ctx, requestId: request.id, email };
}

describe('archiv subjektu údajů se uloží', () => {
  it('KRITÉRIUM: po doběhnutí úlohy soubor na disku EXISTUJE a obsahuje data subjektu', async () => {
    const { ctx, requestId, email } = await subjectWithData();

    const result = await exportSubjectData({ workspaceId: ctx.workspaceId, requestId });

    // 1. Soubor leží pod DATA_DIR, v podadresáři projektu, pod jménem exportu.
    expect(result.storageKey).toBe(`exports/${ctx.workspaceId}/${result.exportId}.zip`);
    const path = join(DATA_DIR, result.storageKey);
    const info = await stat(path);
    expect(info.isFile()).toBe(true);
    expect(info.size).toBe(result.bytes);
    expect(info.size).toBeGreaterThan(0);

    // 2. Obsah je archiv s deseti soubory podle tabulky ve 4.14.2, ne prázdný ZIP.
    const archive = readZip(await readFile(path));
    expect([...archive.keys()]).toEqual([
      'contact.json',
      'consents.csv',
      'subscriptions.csv',
      'tags.csv',
      'form_submissions.csv',
      'imports.csv',
      'messages.csv',
      'message_events.csv',
      'web_events.ndjson',
      'README.txt',
    ]);
    expect(archive.size).toBe(result.files);

    // 3. V archivu jsou data TOHOHLE subjektu, ne prázdné hlavičky.
    expect(JSON.parse(archive.get('contact.json') ?? 'null')).toMatchObject({ email });
    expect(archive.get('subscriptions.csv')).toContain('Newsletter');
    expect(archive.get('README.txt')?.length ?? 0).toBeGreaterThan(0);
  });

  it('řádek v exports odpovídá souboru na disku a žádost na něj ukazuje', async () => {
    const { ctx, requestId } = await subjectWithData();

    const result = await exportSubjectData({ workspaceId: ctx.workspaceId, requestId });

    const row = await one<{
      kind: string;
      status: string;
      storage_key: string;
      byte_size: string;
      expires_at: Date;
      download_token_hash: Buffer | null;
    }>(
      `SELECT kind, status, storage_key, byte_size, expires_at, download_token_hash
          FROM exports WHERE id = $1`,
      [result.exportId],
    );

    expect(row.kind).toBe('gdpr_subject');
    expect(row.status).toBe('completed');
    expect(row.storage_key).toBe(result.storageKey);
    expect(Number(row.byte_size)).toBe((await stat(join(DATA_DIR, result.storageKey))).size);
    // Platnost odkazu je sedm dní (GDPR_EXPORT_TTL_DAYS), ne 24 hodin jako u exportu kontaktů.
    const days = (row.expires_at.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThan(7.1);
    // Token se nevydává sám od sebe: dokud si o odkaz nikdo neřekne, žádný neexistuje.
    expect(row.download_token_hash).toBeNull();

    const request = await one<{ export_id: string }>(
      `SELECT export_id FROM gdpr_requests WHERE id = $1`,
      [requestId],
    );
    expect(request.export_id).toBe(result.exportId);

    const audit = await one<{ target_id: string }>(
      `SELECT target_id FROM audit_log
        WHERE workspace_id = $1 AND action = 'export.created'`,
      [ctx.workspaceId],
    );
    expect(audit.target_id).toBe(result.exportId);
  });

  it('odkaz ke stažení nejde uhodnout a platí jen jednou', async () => {
    const { ctx, requestId } = await subjectWithData();
    const result = await exportSubjectData({ workspaceId: ctx.workspaceId, requestId });

    const token = await issueExportDownloadToken(ctx, result.exportId);
    // 32 náhodných bajtů v base64url, tedy 43 znaků. Kratší token by šel zkoušet hrubou silou.
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    expect(await verifyDownloadToken(ctx, result.exportId, token)).toBe(true);
    expect(await verifyDownloadToken(ctx, result.exportId, token)).toBe(false);
    expect(await verifyDownloadToken(ctx, result.exportId, 'nahodny-nesmysl')).toBe(false);
  });

  it('druhý běh téže žádosti přepíše existující export, nezaloží druhý', async () => {
    const { ctx, requestId } = await subjectWithData();

    const first = await exportSubjectData({ workspaceId: ctx.workspaceId, requestId });
    const second = await exportSubjectData({ workspaceId: ctx.workspaceId, requestId });

    expect(second.exportId).toBe(first.exportId);
    const count = await one<{ count: string }>(
      `SELECT count(*) AS count FROM exports WHERE workspace_id = $1`,
      [ctx.workspaceId],
    );
    expect(Number(count.count)).toBe(1);
    await expect(stat(join(DATA_DIR, second.storageKey))).resolves.toBeDefined();
  });

  it('retence smaže po vypršení SOUBOR I ŘÁDEK, archiv nezůstane na disku navždy', async () => {
    const { ctx, requestId } = await subjectWithData();
    const result = await exportSubjectData({ workspaceId: ctx.workspaceId, requestId });
    const path = join(DATA_DIR, result.storageKey);
    await expect(stat(path)).resolves.toBeDefined();

    await asMigrator().query(
      `UPDATE exports SET expires_at = now() - interval '1 day' WHERE id = $1`,
      [result.exportId],
    );

    const handler = getHandler('exports');
    expect(
      handler,
      'cíl exports nemá registrovaný handler, soubory by zůstaly na disku',
    ).toBeDefined();
    const run = await handler!({ ctx, policy: { days: 7, action: 'delete', enabled: true } });

    expect(run.affected).toBe(1);
    await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' });
    const count = await one<{ count: string }>(
      `SELECT count(*) AS count FROM exports WHERE workspace_id = $1`,
      [ctx.workspaceId],
    );
    expect(Number(count.count)).toBe(0);
  });

  it('archiv leží mimo webroot, pod DATA_DIR', async () => {
    const { ctx, requestId } = await subjectWithData();
    const result = await exportSubjectData({ workspaceId: ctx.workspaceId, requestId });

    expect(createFileExportStorage().resolve(result.storageKey)).toBe(
      join(DATA_DIR, result.storageKey),
    );
  });
});
