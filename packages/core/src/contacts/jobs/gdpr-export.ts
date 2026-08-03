import { sql } from 'drizzle-orm';
import { loadConfig } from '../../config/index';
import { createSystemContext } from '../../identity/context';
import { withWorkspace, type Tx } from '../../tx';
import type { WorkspaceContext } from '../../identity/types';
import { auditImport } from '../import/audit';
import { createFileExportStorage, exportStorageKey, type ExportStorage } from '../export/storage';
import { buildReadme, toCsv } from '../gdpr/export';
import { createZip } from '../gdpr/zip';

export type GdprExportPayload = { workspaceId: string; requestId: string };

/**
 * Volitelní dodavatelé dat z cizích domén.
 *
 * Když dodavatel chybí, soubor se do archivu vloží s hlavičkou a BEZ ŘÁDKŮ, ne že export
 * spadne. Neúplný export, o kterém subjekt ví, je lepší než žádný export a promeškaná
 * lhůta jednoho měsíce.
 */
export type SubjectDataProviders = {
  campaignData?: (contactId: string) => Promise<{ messages: unknown[]; events: unknown[] }>;
  trackingData?: (contactId: string) => Promise<{ webEvents: unknown[] }>;
};

export type SubjectExportResult = {
  requestId: string;
  exportId: string;
  files: number;
  bytes: number;
  storageKey: string;
};

/**
 * Sestaví ZIP s daty subjektu a ULOŽÍ HO.
 *
 * Uložení není volitelné a `storage` v `deps` je jen vstup pro testy. Dřív se archiv
 * bez úložiště tiše zahodil, žádost se uzavřela a subjekt dostal potvrzení bez souboru.
 * Výchozí hodnota je proto skutečné úložiště, ne `undefined`.
 *
 * Archiv se váže na řádek v `exports`, tedy na tutéž tabulku a tutéž cestu ke stažení
 * jako export kontaktů: jednorázový token (uložený jen jako SHA-256), `expires_at`
 * a retence, která po vypršení smaže soubor i řádek. Vlastní cesta pro tenhle jeden
 * druh souboru by znamenala druhé místo, na které musí myslet zálohy a výmaz.
 *
 * Idempotence: výsledek se váže na `gdpr_requests.export_id`, takže druhý běh existující
 * export PŘEPÍŠE místo aby založil druhý. Fronta má `retryLimit` 3, takže druhý běh
 * je běžný stav, ne výjimka.
 */
export async function exportSubjectData(
  payload: GdprExportPayload,
  deps: SubjectDataProviders & { storage?: ExportStorage } = {},
): Promise<SubjectExportResult> {
  const ctx = createSystemContext(payload.workspaceId, 'gdpr.export_subject');
  const archive = await buildSubjectArchive(ctx, payload.requestId, deps);
  const zip = createZip(archive);
  const storage = deps.storage ?? createFileExportStorage();

  const exportId = await openSubjectExport(ctx, payload.requestId);
  const storageKey = exportStorageKey(ctx.workspaceId, exportId, 'zip');
  const { byteSize } = await storage.put(storageKey, zip);
  await finishSubjectExport(ctx, { exportId, storageKey, byteSize });

  return {
    requestId: payload.requestId,
    exportId,
    files: archive.size,
    bytes: byteSize,
    storageKey,
  };
}

/**
 * Založí (nebo znovu otevře) řádek v `exports` a naváže ho na žádost.
 *
 * Řádek vzniká PŘED zápisem souboru, protože jméno souboru je odvozené od jeho `id`.
 * Stav je do dokončení `running`, takže `verifyDownloadToken` takový export nevydá:
 * kdyby worker mezi založením řádku a zápisem souboru spadl, nesmí být ke stažení
 * odkaz na soubor, který neexistuje.
 *
 * `format` zůstává `csv`, protože `ck_exports__format` jinou hodnotu než `csv` nebo
 * `ndjson` nepustí a rozšíření toho výčtu je migrace, tedy změna schématu, které vlastní
 * P03. Že je obsahem ZIP, pozná čtecí strana podle `kind = 'gdpr_subject'`; archiv sám
 * je stejně směs CSV a JSON.
 */
async function openSubjectExport(ctx: WorkspaceContext, requestId: string): Promise<string> {
  const ttlDays = loadConfig().GDPR_EXPORT_TTL_DAYS;

  return withWorkspace(ctx, async (tx) => {
    const { rows: existing } = await tx.execute<{ export_id: string | null }>(sql`
      SELECT e.id AS export_id
        FROM gdpr_requests r JOIN exports e ON e.id = r.export_id
       WHERE r.id = ${requestId}::uuid AND r.workspace_id = ${ctx.workspaceId}::uuid
         AND e.workspace_id = ${ctx.workspaceId}::uuid
    `);
    const reused = existing[0]?.export_id;
    if (reused !== undefined && reused !== null) {
      await tx.execute(sql`
        UPDATE exports
           SET status = 'running', finished_at = NULL, failure_code = NULL,
               expires_at = now() + make_interval(days => ${ttlDays})
         WHERE id = ${reused}::uuid AND workspace_id = ${ctx.workspaceId}::uuid`);
      return reused;
    }

    const { rows } = await tx.execute<{ id: string }>(sql`
      INSERT INTO exports (id, workspace_id, kind, filter, columns, format, status, expires_at)
      VALUES (uuidv7(), ${ctx.workspaceId}::uuid, 'gdpr_subject', '{}'::jsonb, '[]'::jsonb,
              'csv', 'running', now() + make_interval(days => ${ttlDays}))
      RETURNING id`);
    const row = rows[0];
    if (row === undefined) throw new Error('INSERT do exports nevrátil řádek.');

    await tx.execute(sql`
      UPDATE gdpr_requests SET export_id = ${row.id}::uuid
       WHERE id = ${requestId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid`);
    await auditImport(tx, ctx, 'export.created', row.id, {
      kind: 'gdpr_subject',
      requestId,
    });
    return row.id;
  });
}

/**
 * Teprve tenhle zápis dělá export stažitelným: `verifyDownloadToken` chce `completed`.
 *
 * `row_count` zůstává NULL schválně. Archiv nemá řádky, má soubory, a zapsat sem jejich
 * počet by znamenalo, že obrazovka exportů ukáže u žádosti subjektu „10 řádků".
 */
async function finishSubjectExport(
  ctx: WorkspaceContext,
  input: { exportId: string; storageKey: string; byteSize: number },
): Promise<void> {
  await withWorkspace(ctx, (tx) =>
    tx.execute(sql`
      UPDATE exports
         SET status = 'completed', storage_key = ${input.storageKey},
             byte_size = ${input.byteSize}, finished_at = now()
       WHERE id = ${input.exportId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid`),
  );
}

/**
 * Obsah archivu podle tabulky ve 4.14.2. Vrací se jako mapa jméno na obsah, aby se dal
 * zkontrolovat po souborech, ne jen podle velikosti výsledného ZIPu.
 */
export async function buildSubjectArchive(
  ctx: WorkspaceContext,
  requestId: string,
  deps: SubjectDataProviders = {},
): Promise<Map<string, string>> {
  const archive = new Map<string, string>();

  const { contactId, contact, consents, subscriptions, tags, submissions, imports } =
    await withWorkspace(ctx, async (tx) => loadOwnData(tx, ctx, requestId));

  archive.set('contact.json', JSON.stringify(contact, null, 2));
  archive.set(
    'consents.csv',
    toCsv(consents, [
      'occurred_at',
      'purpose',
      'status',
      'legal_basis',
      'source',
      'scope_list_id',
      'consent_text',
    ]),
  );
  archive.set(
    'subscriptions.csv',
    toCsv(subscriptions, [
      'list_name',
      'status',
      'subscribed_at',
      'confirmed_at',
      'unsubscribed_at',
      'source',
    ]),
  );
  archive.set('tags.csv', toCsv(tags, ['name', 'added_at']));
  archive.set(
    'form_submissions.csv',
    toCsv(submissions, ['created_at', 'form_name', 'status', 'page_url']),
  );
  archive.set('imports.csv', toCsv(imports, ['created_at', 'filename', 'status']));

  const campaign = contactId === null ? undefined : await deps.campaignData?.(contactId);
  archive.set(
    'messages.csv',
    toCsv((campaign?.messages ?? []) as Record<string, unknown>[], [
      'sent_at',
      'campaign_name',
      'subject',
      'status',
    ]),
  );
  archive.set(
    'message_events.csv',
    toCsv((campaign?.events ?? []) as Record<string, unknown>[], [
      'occurred_at',
      'type',
      'campaign_name',
      'url',
    ]),
  );

  const tracking = contactId === null ? undefined : await deps.trackingData?.(contactId);
  archive.set(
    'web_events.ndjson',
    ((tracking?.webEvents ?? []) as unknown[]).map((event) => JSON.stringify(event)).join('\n'),
  );

  archive.set('README.txt', buildReadme());
  return archive;
}

type OwnData = {
  contactId: string | null;
  contact: Record<string, unknown> | null;
  consents: Record<string, unknown>[];
  subscriptions: Record<string, unknown>[];
  tags: Record<string, unknown>[];
  submissions: Record<string, unknown>[];
  imports: Record<string, unknown>[];
};

async function loadOwnData(tx: Tx, ctx: WorkspaceContext, requestId: string): Promise<OwnData> {
  const { rows: requests } = await tx.execute<{ contact_id: string | null }>(sql`
    SELECT contact_id FROM gdpr_requests
     WHERE id = ${requestId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
  `);
  const contactId = requests[0]?.contact_id ?? null;
  const empty: OwnData = {
    contactId: null,
    contact: null,
    consents: [],
    subscriptions: [],
    tags: [],
    submissions: [],
    imports: [],
  };
  if (contactId === null) return empty;

  const { rows: contacts } = await tx.execute<Record<string, unknown>>(sql`
    SELECT * FROM contacts
     WHERE id = ${contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
  `);

  const { rows: consents } = await tx.execute<Record<string, unknown>>(sql`
    SELECT occurred_at, purpose, status, legal_basis, source, scope_list_id, consent_text
      FROM consents
     WHERE contact_id = ${contactId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
     ORDER BY occurred_at
  `);

  const { rows: subscriptions } = await tx.execute<Record<string, unknown>>(sql`
    SELECT l.name AS list_name, s.status, s.subscribed_at, s.confirmed_at,
           s.unsubscribed_at, s.source
      FROM list_subscriptions s JOIN lists l ON l.id = s.list_id
     WHERE s.contact_id = ${contactId}::uuid AND s.workspace_id = ${ctx.workspaceId}::uuid
     ORDER BY s.subscribed_at
  `);

  const { rows: tags } = await tx.execute<Record<string, unknown>>(sql`
    SELECT t.name, ct.created_at AS added_at
      FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id
     WHERE ct.contact_id = ${contactId}::uuid AND ct.workspace_id = ${ctx.workspaceId}::uuid
     ORDER BY ct.created_at
  `);

  const { rows: submissions } = await tx.execute<Record<string, unknown>>(sql`
    SELECT fs.created_at, f.name AS form_name, fs.status, fs.page_url
      FROM form_submissions fs JOIN forms f ON f.id = fs.form_id
     WHERE fs.contact_id = ${contactId}::uuid AND fs.workspace_id = ${ctx.workspaceId}::uuid
     ORDER BY fs.created_at
  `);

  // Vazba kontaktu na import je v contacts.source_ref, když je source 'import'.
  const { rows: imports } = await tx.execute<Record<string, unknown>>(sql`
    SELECT i.created_at, i.filename, i.status
      FROM imports i
     WHERE i.workspace_id = ${ctx.workspaceId}::uuid
       AND i.id::text IN (
         SELECT c.source_ref FROM contacts c
          WHERE c.id = ${contactId}::uuid AND c.source = 'import' AND c.source_ref IS NOT NULL
       )
     ORDER BY i.created_at
  `);

  return {
    contactId,
    contact: contacts[0] ?? null,
    consents,
    subscriptions,
    tags,
    submissions,
    imports,
  };
}
