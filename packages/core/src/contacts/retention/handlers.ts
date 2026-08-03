import { sql, type SQL } from 'drizzle-orm';
import { withWorkspace, type Tx } from '../../tx';
import type { WorkspaceContext } from '../../identity/types';
import { BULK_BATCH_SIZE } from '../constants';
import { createFileExportStorage } from '../export/storage';
import { anonymizeContact } from '../gdpr/erase';
import { registerHandler, type RetentionHandler } from './registry';

/**
 * Tabulky, ze kterých retence NIKDY nemaže. Jsou to důkazy o zákonnosti zpracování
 * a o zákazu odesílání, takže je nesmí smazat ani politika nastavená vlastníkem.
 * Kryje to kritérium 71.
 */
export const NEVER_DELETED_TABLES = ['consents', 'contact_consent_state', 'suppressions'] as const;

/** Mazání po dávkách s pauzou, aby retence nekonkurovala odesílání. */
const BATCH_PAUSE_MS = 100;

async function runInBatches(
  ctx: WorkspaceContext,
  statement: (limit: number) => SQL,
): Promise<{ scanned: number; affected: number }> {
  let affected = 0;
  for (;;) {
    const count = await withWorkspace(ctx, async (tx: Tx) => {
      const result = await tx.execute(statement(BULK_BATCH_SIZE));
      return result.rows.length;
    });
    if (count === 0) break;
    affected += count;
    await new Promise((resolve) => setTimeout(resolve, BATCH_PAUSE_MS));
  }
  return { scanned: affected, affected };
}

/**
 * Interval se skládá funkcí `make_interval`, ne řetězcovým `(${days} || ' days')`.
 * Vázaný parametr má v tom výrazu neznámý typ a PostgreSQL ho odmítne, takže by
 * retence spadla na prvním cíli, každou noc.
 */
function olderThan(column: string, days: number): SQL {
  return sql`${sql.raw(column)} < now() - make_interval(days => ${days})`;
}

const importErrors: RetentionHandler = async ({ ctx, policy }) =>
  // Obsahuje syrové řádky ze souboru, tedy osobní údaje.
  runInBatches(
    ctx,
    (limit) => sql`
      DELETE FROM import_errors
       WHERE id IN (
         SELECT id FROM import_errors
          WHERE workspace_id = ${ctx.workspaceId}::uuid
            AND ${olderThan('created_at', policy.days)}
          LIMIT ${limit}
       )
      RETURNING id
    `,
  );

const formSubmissions: RetentionHandler = async ({ ctx, policy }) =>
  // Anonymizace, ne mazání: řádek zůstává kvůli statistice formuláře, ale osobní
  // údaje z něj zmizí.
  runInBatches(
    ctx,
    (limit) => sql`
      UPDATE form_submissions
         SET payload = '{}'::jsonb, ip = NULL, user_agent = NULL, page_url = NULL
       WHERE id IN (
         SELECT id FROM form_submissions
          WHERE workspace_id = ${ctx.workspaceId}::uuid
            AND ${olderThan('created_at', policy.days)}
            AND payload <> '{}'::jsonb
          LIMIT ${limit}
       )
      RETURNING id
    `,
  );

const inboundDeliveries: RetentionHandler = async ({ ctx, policy }) => {
  // MAŽE SE PO ŘÁDCÍCH, ne odpojováním oddílů.
  //
  // Oddíl je společný pro VŠECHNY projekty, zatímco retenční politika je per projekt.
  // Zahozením měsíčního oddílu by se smazala i doručení projektů, které mají delší
  // lhůtu. Navíc `ALTER TABLE ... DETACH PARTITION` vyžaduje vlastnictví tabulky, takže
  // by pod aplikační rolí skončilo na 42501. Odpojení starých oddílů napříč projekty je
  // provozní úloha, ne doménová.
  const deliveries = await runInBatches(
    ctx,
    (limit) => sql`
      DELETE FROM inbound_deliveries
       WHERE (id, received_at) IN (
         SELECT id, received_at FROM inbound_deliveries
          WHERE workspace_id = ${ctx.workspaceId}::uuid
            AND ${olderThan('received_at', policy.days)}
          LIMIT ${limit}
       )
      RETURNING id
    `,
  );

  await withWorkspace(ctx, async (tx) => {
    await tx.execute(sql`
      DELETE FROM inbound_dedup
       WHERE workspace_id = ${ctx.workspaceId}::uuid
         AND ${olderThan('created_at', policy.days)}
    `);
  });

  return deliveries;
};

const unconfirmedSubscriptions: RetentionHandler = async ({ ctx, policy }) =>
  runInBatches(
    ctx,
    (limit) => sql`
      DELETE FROM list_subscriptions
       WHERE (contact_id, list_id) IN (
         SELECT contact_id, list_id FROM list_subscriptions
          WHERE workspace_id = ${ctx.workspaceId}::uuid AND status = 'pending'
            AND ${olderThan('subscribed_at', policy.days)}
          LIMIT ${limit}
       )
      RETURNING contact_id
    `,
  );

const inactiveContacts: RetentionHandler = async ({ ctx, policy }) => {
  const candidates = await withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{ id: string }>(sql`
      SELECT id FROM contacts
       WHERE workspace_id = ${ctx.workspaceId}::uuid AND deleted_at IS NULL
         AND anonymized_at IS NULL
         AND ${olderThan('coalesce(last_activity_at, created_at)', policy.days)}
       LIMIT ${BULK_BATCH_SIZE}
    `);
    return rows;
  });

  // Anonymizace jde přes doménovou funkci, ne přes vlastní UPDATE: jinak by retence
  // obešla založení suppression řádku a vymazaný člověk by se vrátil prvním importem.
  for (const row of candidates) {
    await anonymizeContact(ctx, row.id);
  }
  return { scanned: candidates.length, affected: candidates.length };
};

/**
 * Hotové exporty: podle tabulky ve 4.15 se maže SOUBOR I ŘÁDEK.
 *
 * Jde o jedinou kopii osobních údajů, která leží mimo databázi, a u archivu subjektu
 * údajů je to rovnou celý jeho profil v jednom souboru. Dokud tenhle handler chyběl,
 * cíl `exports` se v každém běhu jen přeskočil se zápisem do `error_detail`, takže
 * archivy zůstávaly na disku navždy, přestože odkaz na ně dávno vypršel.
 *
 * Pořadí je schválně soubor a teprve pak řádek. Opačně by pád mezi oběma kroky nechal
 * na disku soubor, o kterém už nikde není záznam, tedy osiřelá osobní data, která nikdo
 * příště nenajde. Takhle se v nejhorším případě zopakuje mazání souboru, který už není,
 * a to je u `rm --force` prázdná operace.
 *
 * Podmínka má obě větve: `expires_at` je platnost odkazu (24 hodin u kontaktů, 7 dní
 * u archivu subjektu), politika je horní strop pro řádky, které expiraci z jakéhokoli
 * důvodu nemají v minulosti.
 */
const expiredExports: RetentionHandler = async ({ ctx, policy }) => {
  const storage = createFileExportStorage();
  let affected = 0;

  for (;;) {
    const rows = await withWorkspace(ctx, async (tx: Tx) => {
      const result = await tx.execute<{ id: string; storage_key: string | null }>(sql`
        SELECT id, storage_key FROM exports
         WHERE workspace_id = ${ctx.workspaceId}::uuid
           AND (expires_at < now() OR ${olderThan('created_at', policy.days)})
         LIMIT ${BULK_BATCH_SIZE}
      `);
      return result.rows;
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      if (row.storage_key !== null) await storage.remove(row.storage_key);
    }

    // Seznam se skládá přes `sql.join`, ne jako pole do `= ANY($2)`. Ovladač pošle
    // JS pole jako čárkami oddělený text a PostgreSQL ho odmítne s 22P02 „malformed
    // array literal", takže by retence spadla na první dávce.
    const ids = sql.join(
      rows.map((row) => sql`${row.id}::uuid`),
      sql`, `,
    );
    await withWorkspace(ctx, async (tx: Tx) => {
      await tx.execute(sql`
        DELETE FROM exports
         WHERE workspace_id = ${ctx.workspaceId}::uuid AND id IN (${ids})`);
    });

    affected += rows.length;
    await new Promise((resolve) => setTimeout(resolve, BATCH_PAUSE_MS));
  }

  return { scanned: affected, affected };
};

registerHandler('import_errors', importErrors);
registerHandler('form_submissions', formSubmissions);
registerHandler('inbound_deliveries', inboundDeliveries);
registerHandler('unconfirmed_subscriptions', unconfirmedSubscriptions);
registerHandler('inactive_contacts', inactiveContacts);
registerHandler('exports', expiredExports);
