import { sql } from 'drizzle-orm';
import { createSystemContext } from '../../identity/context';
import { withWorkspace, type Tx } from '../../tx';
import type { WorkspaceContext } from '../../identity/types';
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

/**
 * Úložiště souborů dodává P11 (`@mlain/core/storage`). Dokud ho nemá, job archiv sestaví
 * a vrátí ho volajícímu; uložení a jednorázový odkaz doplní P11 jedním adaptérem.
 */
export type ExportStorage = {
  put(key: string, content: Buffer): Promise<void>;
};

/**
 * Sestaví ZIP s daty subjektu.
 *
 * Idempotence: výsledek se váže na gdpr_requests.export_id, takže druhý běh existující
 * export přepíše místo aby založil druhý.
 */
export async function exportSubjectData(
  payload: GdprExportPayload,
  deps: SubjectDataProviders & { storage?: ExportStorage } = {},
): Promise<{ requestId: string; files: number; bytes: number; stored: boolean }> {
  const ctx = createSystemContext(payload.workspaceId, 'gdpr.export_subject');
  const archive = await buildSubjectArchive(ctx, payload.requestId, deps);
  const zip = createZip(archive);

  let stored = false;
  if (deps.storage !== undefined) {
    await deps.storage.put(`gdpr/${payload.workspaceId}/${payload.requestId}.zip`, zip);
    stored = true;
  }

  return { requestId: payload.requestId, files: archive.size, bytes: zip.length, stored };
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
