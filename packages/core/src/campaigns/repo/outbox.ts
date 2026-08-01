import {
  prepareRenderData,
  type PreparedDataSchema,
} from '@mlain/contracts/liquid/prepare-render-data';
import { withWorkspace, type WorkspaceContext } from '../../tx';
import { buildRenderData } from '../audience/render-data';
// ODCHYLKA OD PLÁNU: plán importoval `CANCEL_CLEANUP_BATCH_SIZE` z `@mlain/core/campaigns`,
// tedy z vlastního barrelu balíčku. To je cyklus přes `index.ts`, který tenhle soubor
// sám reexportuje. Konstanta se bere přímo z modulu, kde je definovaná.
import { CANCEL_CLEANUP_BATCH_SIZE } from '../constants';
import { SAMPLE_SOURCE_REF_PATTERN } from '../audience/sample-guard';
import { rawSql } from './raw-sql';

/**
 * Vsechno, co je potreba k slozeni render_data. Bere se z `campaigns.compile_meta`,
 * tedy z vystupu kompilace, NIKDY se nedopocitava podruhe.
 */
export type RenderPlan = {
  /** `CompileMeta.usedPaths`: ktere cesty sablona doopravdy pouziva. */
  usedPaths: readonly string[];
  /** Zuzene `CompileMeta.renderSchema` pres `toPreparedSchema`. Plni mapu `_present`. */
  preparedSchema: PreparedDataSchema;
};

export type MaterializeBatchInput = {
  campaignId: string;
  /** Invariant I1: jedina hodnota created_at pro cely materializacni beh. */
  audienceBuiltAt: string;
  cursor: string;
  batchSize: number;
  /** Vyraz do WHERE, ktery slozil buildAudienceSql z kompilatoru casti 2. */
  where: { sql: string; params: unknown[] };
  renderPlan: RenderPlan;
  /**
   * Identifikatory ukazkovych kontaktu z manifestu P16. Nacita je smycka jednou pred
   * behem, ne kazda davka. Prazdne pole je bezny stav (projekt bez ukazkovych dat).
   */
  sampleContactIds: readonly string[];
  /** Undo okno. Kdyz je null, zpravy jsou k odeslani okamzite. */
  releaseAt: string | null;
  statementTimeoutMs?: number;
};

export type MaterializeBatchResult = {
  scanned: number;
  inserted: number;
  /** Radky, ktere prekrocily strop render_data a vznikly rovnou jako skipped. */
  skippedOversize: number;
  nextCursor: string | null;
};

type ContactRow = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  first_name_vocative: string | null;
  greeting: string | null;
  attributes: Record<string, unknown> | null;
};

/**
 * Krok 2 materializace. Bezi po davkach kurzorem pres contacts.id a nikdy v jedne
 * transakci pres cele publikum: transakce nad milionem radku drzi zamky, blokuje
 * VACUUM a pri padu se cela vraci zpet.
 *
 * Davka ma DVE faze a je to zamerne. Puvodni podoba skladala render_data primo v SQL
 * pres `jsonb_build_object`, aby se radky nemusely vozit do Node. Bylo to rychlejsi
 * a bylo to SPATNE: kontraktni `prepareRenderData` plni koren `_present`, ze ktereho
 * se vyhodnocuji vsechny podminene bloky, a SQL ho nenaplnilo. Dusledek overeny
 * spustenim: kazda podminka se vyhodnoti jako nepravda a podmineny blok se v odeslanem
 * mailu TISE SKRYJE. Nespadne pritom nic, kompilace projde, odeslani projde a testy
 * obou stran projdou. Je to pozadavek R11 planu P08.
 *
 * Druhotne se tim opravilo, ze se v SQL vubec nekontroloval strop render_data, ze se
 * cisla nad 2^53 neprevadela na retezec a ze se pole neorezavala na strop iteraci.
 *
 * Cena je jeden roundtrip navic NA DAVKU, ne na radek.
 *
 * Pozor na ctyri veci, ktere vypadaji jako detail a nejsou:
 *  - created_at se zapisuje EXPLICITNE hodnotou audience_built_at, nikdy DEFAULT now().
 *  - ON CONFLICT musi uvest VSECHNY TRI sloupce indexu. Uvedeni jen dvou neni ticha
 *    chyba, ale tvrdy ERROR a materializace by neprobehla vubec.
 *  - id se v seznamu sloupcu nevyskytuje schvalne, doplni ho DEFAULT uuidv7().
 *  - obe faze bezi v JEDNE transakci, takze kandidat vybrany fazi 1 nemuze mezitim zmizet.
 */
export async function materializeBatch(
  ctx: WorkspaceContext,
  input: MaterializeBatchInput,
): Promise<MaterializeBatchResult> {
  // $1..$5 jsou pevne, poddotaz publika zacina od $6.
  //
  // Ukazkove kontakty vypadavaji DVEMA nezavislymi podminkami a obe jsou nutne:
  // manifest ($4) je autoritativni pro rozsah sady a prezije to, ze uzivatel kontakt
  // upravi, znacka ($3) chyti kontakty mimo manifest (starsi pokoleni, obnova ze zalohy).
  const SELECT_SQL = `
    SELECT c.id, c.email, c.first_name, c.last_name, c.first_name_vocative,
           c.greeting, c.attributes
      FROM contacts c
     WHERE c.workspace_id = $1
       AND c.id > $2
       AND c.status = 'active'
       AND c.deleted_at IS NULL
       AND c.email IS NOT NULL AND c.email::text <> ''
       AND coalesce(c.source_ref, '') NOT LIKE $3
       AND NOT (c.id = ANY($4::uuid[]))
       AND (${input.where.sql})
     ORDER BY c.id
     LIMIT $5`;

  const INSERT_SQL = `
    INSERT INTO messages (
      workspace_id, campaign_id, contact_id, kind, email,
      render_data, status, next_attempt_at, created_at
    )
    SELECT $1, $2, x.contact_id, 'campaign', x.email,
           x.render_data, x.status,
           COALESCE($4::timestamptz, $3::timestamptz),
           $3::timestamptz
      FROM unnest($5::uuid[], $6::text[], $7::jsonb[], $8::text[])
        AS x(contact_id, email, render_data, status)
    ON CONFLICT (campaign_id, contact_id, created_at) DO NOTHING
    RETURNING contact_id`;

  return withWorkspace(ctx, async (tx) => {
    if (input.statementTimeoutMs) {
      await tx.execute(
        rawSql(`SET LOCAL statement_timeout = ${Number(input.statementTimeoutMs)}`, []),
      );
    }

    // Faze 1: kandidati.
    const candidates = await tx.execute<ContactRow>(
      rawSql(SELECT_SQL, [
        ctx.workspaceId, // $1
        input.cursor, // $2
        SAMPLE_SOURCE_REF_PATTERN, // $3
        [...input.sampleContactIds], // $4, jedno POLE, ne rozlozene hodnoty
        input.batchSize, // $5
        ...input.where.params, // $6 a dal
      ]),
    );
    const rows = candidates.rows;
    if (rows.length === 0) {
      return { scanned: 0, inserted: 0, skippedOversize: 0, nextCursor: null };
    }

    // Faze 2: priprava dat pro render. TOHLE je misto, kde vznika koren `_present`.
    const contactIds: string[] = [];
    const emails: string[] = [];
    const renderData: string[] = [];
    const statuses: string[] = [];
    let skippedOversize = 0;

    for (const row of rows) {
      // Krok 1: snapshot hodnot kontaktu podle `usedPaths` a strop 8 kB.
      const snapshot = buildRenderData(row, input.renderPlan.usedPaths);
      if (snapshot.tooLarge) {
        // Prilis velka data se NEUKLADAJI: radek vznika rovnou jako skipped s prazdnymi
        // daty, aby jedna patologicka hodnota atributu nenafoukla cely outbox.
        skippedOversize += 1;
        contactIds.push(row.id);
        emails.push(row.email.toLowerCase());
        renderData.push('{}');
        statuses.push('skipped');
        continue;
      }

      // Krok 2: kontraktni priprava. Doplni `_context` a hlavne mapu `_present`,
      // normalizuje cisla nad 2^53 na retezec a oreze pole na strop iteraci.
      // Bez tohohle volani se KAZDY podmineny blok v odeslanem mailu tise skryje.
      const prepared = prepareRenderData(snapshot.data, input.renderPlan.preparedSchema);

      contactIds.push(row.id);
      emails.push(row.email.toLowerCase());
      renderData.push(JSON.stringify(prepared));
      statuses.push('pending');
    }

    const inserted = await tx.execute<{ contact_id: string }>(
      rawSql(INSERT_SQL, [
        ctx.workspaceId, // $1
        input.campaignId, // $2
        input.audienceBuiltAt, // $3
        input.releaseAt, // $4
        contactIds, // $5
        emails, // $6
        renderData, // $7
        statuses, // $8
      ]),
    );

    return {
      scanned: rows.length,
      inserted: inserted.rows.length,
      skippedOversize,
      nextCursor: rows[rows.length - 1]!.id,
    };
  });
}

export type RevokeReason =
  | 'unsubscribed'
  | 'suppressed'
  | 'contact_deleted'
  | 'contact_anonymized'
  | 'processing_restricted'
  | 'contact_status_changed';

/**
 * Podminka status = 'pending' je zasadni: zprava ve stavu claimed se NERUSI, protoze
 * ji sender muze mit prave v ruce a mohla by odejit. Ruseni claimnute zpravy by
 * vytvorilo stav, kdy je v databazi skipped, ale u prijemce ve schrance.
 *
 * ZADNE casove omezeni na created_at. Puvodne tu bylo okno sedmi dnu kvuli partition
 * pruningu a byla to chyba: kampan muze byt pozastavena mesice a jeji pending zpravy
 * lezi ve stare partition. Diky castecnemu indexu idx_messages__ws_email_pending je
 * to levne, protoze v uzavrenych kampanich zadne pending nezbyva.
 */
export async function revokePending(
  ctx: WorkspaceContext,
  input: {
    contactIds?: string[] | undefined;
    emails?: string[] | undefined;
    listId: string | null;
    reason: RevokeReason;
  },
): Promise<{ revoked: number }> {
  const byEmail = !input.contactIds?.length && !!input.emails?.length;
  const match = byEmail ? `lower(m.email) = ANY($3::text[])` : `m.contact_id = ANY($3::uuid[])`;
  const key = byEmail ? (input.emails ?? []).map((e) => e.toLowerCase()) : (input.contactIds ?? []);

  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute(
      rawSql(
        `UPDATE messages m
            SET status = 'skipped',
                error_code = $2,
                error_detail = 'revoked by application',
                updated_at = now()
          WHERE m.workspace_id = $1
            AND m.status = 'pending'
            AND ${match}
            AND ($4::uuid IS NULL OR EXISTS (
                  SELECT 1 FROM campaigns c
                   WHERE c.id = m.campaign_id AND c.unsubscribe_list_id = $4))`,
        [ctx.workspaceId, input.reason, key, input.listId],
      ),
    );
    return { revoked: r.rowCount ?? 0 };
  });
}

/**
 * Zachytna cesta pro pripady, kdy okamzita cesta selhala: pad workeru, primy zapis
 * do DB, import, ktery pridal adresu na suppression.
 *
 * Tvar je DVA NEZAVISLE EXISTS, ne jeden join, a to ze dvou duvodu. Drivejsi zneni
 * melo `UPDATE messages m ... FROM suppressions s LEFT JOIN contacts c ON c.id = m.contact_id`,
 * tedy odkaz na cilovou tabulku UPDATE uvnitr ON ve FROM. PostgreSQL to odmita chybou
 * "invalid reference to FROM-clause entry for table m", protoze cilova tabulka je do
 * dotazu pridana mimo strom spojeni. Druhy duvod je planovac: obe vetve se takhle
 * daji naplanovat kazda pres svuj index, coz u jedne disjunkce s LEFT JOIN neslo.
 */
export async function reconcileSuppressed(ctx: WorkspaceContext): Promise<{ revoked: number }> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute(
      rawSql(
        `UPDATE messages m
            SET status = 'skipped',
                error_code = 'suppressed',
                updated_at = now()
          WHERE m.workspace_id = $1
            AND m.status = 'pending'
            AND (
              EXISTS (
                SELECT 1 FROM suppressions s
                 WHERE s.workspace_id = m.workspace_id
                   AND s.removed_at IS NULL
                   AND lower(s.email::text) = lower(m.email)
              )
              OR EXISTS (
                SELECT 1
                  FROM contacts c
                  JOIN suppressions s
                    ON s.workspace_id = c.workspace_id
                   AND s.fingerprint = ANY(c.email_fingerprints)
                 WHERE c.id = m.contact_id
                   AND s.removed_at IS NULL
              )
            )`,
        [ctx.workspaceId],
      ),
    );
    return { revoked: r.rowCount ?? 0 };
  });
}

/**
 * Pri vymazu kontaktu podle GDPR se adresa ANONYMIZUJE, radky zustavaji, aby nezmizely
 * statistiky kampani. Tvar placeholderu je sjednoceny s casti 2. Domena .invalid je
 * rezervovana RFC 2606, takze na ni nikdy nic neodejde.
 *
 * POZOR: je to navrhove reseni podlehajici pravnimu posouzeni (otevrena otazka O11),
 * ne uzavrene pravidlo. Kdyby posouzeni dopadlo opacne, meni se nazev i chovani teto
 * funkce na deleteMessages a nic jineho na tom nestoji.
 */
export async function anonymizeMessages(ctx: WorkspaceContext, contactId: string): Promise<void> {
  const placeholder = `erased+${contactId}@erased.invalid`;
  await withWorkspace(ctx, async (tx) => {
    await tx.execute(
      rawSql(
        `UPDATE messages
            SET email = $3, render_data = '{}'::jsonb, updated_at = now()
          WHERE workspace_id = $1 AND contact_id = $2`,
        [ctx.workspaceId, contactId, placeholder],
      ),
    );
    await tx.execute(
      rawSql(
        `UPDATE message_events
            SET recipient = $3
          WHERE workspace_id = $1 AND contact_id = $2`,
        [ctx.workspaceId, contactId, placeholder],
      ),
    );
  });
}

/**
 * Jedna davka uklidu. Bezi po 10 000 radcich, aby transakce nebyla dlouha, a volajici
 * ji opakuje, dokud vraci nenulovy pocet. Podminka created_at = audience_built_at
 * je tam kvuli partition pruningu: cela kampan lezi v jedne partition.
 */
export async function cancelPendingBatch(
  ctx: WorkspaceContext,
  input: { campaignId: string; audienceBuiltAt: string },
): Promise<number> {
  return withWorkspace(ctx, async (tx) => {
    // Filtr `kind = 'campaign'` je nutny, ne kosmeticky. Testovaci zpravy sdileji
    // s publikem `campaign_id` i `created_at`, takze bez nej by zruseni kampane
    // zrusilo i cekajici testovaci maily, ktere si uzivatel prave poslal.
    // `finishMaterialization` ten filtr uz spravne ma, slo tedy o nekonzistenci
    // uvnitr plánu.
    const r = await tx.execute(
      rawSql(
        `UPDATE messages
          SET status = 'skipped',
              error_code = 'campaign_cancelled',
              updated_at = now()
        WHERE campaign_id = $1
          AND created_at = $2::timestamptz
          AND status = 'pending'
          AND kind = 'campaign'
          AND id IN (
            SELECT id FROM messages
             WHERE campaign_id = $1 AND created_at = $2::timestamptz
               AND status = 'pending' AND kind = 'campaign'
             LIMIT ${CANCEL_CLEANUP_BATCH_SIZE}
          )`,
        [input.campaignId, input.audienceBuiltAt],
      ),
    );
    return r.rowCount ?? 0;
  });
}

/**
 * Nenulovy vysledek znamena, ze selhala obe casti ochrany proti zavodu zruseni
 * s materializaci. Je to PORUCHA, ne provozni stav: takove radky nikdo neclaimne,
 * nikdo je neuklidi a navecky brani odpojeni oddilu. Hlasi se jako error.
 */
export async function findOrphanedPending(
  ctx: WorkspaceContext,
): Promise<Array<{ campaign_id: string; orphaned_pending: number }>> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<{ campaign_id: string; orphaned_pending: number }>(
      rawSql(
        `SELECT m.campaign_id, count(*)::int AS orphaned_pending
         FROM messages m
         JOIN campaigns c ON c.id = m.campaign_id
        WHERE m.workspace_id = $1
          AND m.status = 'pending'
          AND c.status IN ('cancelled','sent','partially_sent','failed')
        GROUP BY m.campaign_id`,
        [ctx.workspaceId],
      ),
    );
    return r.rows;
  });
}
