import { sql } from 'drizzle-orm';
import type { Tx } from '../../tx';

/**
 * Přepočet `contact_engagement` ze zdroje pravdy, tedy z `message_engagement`.
 *
 * Rozhraní I→P10.1. Volá ho dávkovač `ops/rebuild-engagement.ts`, tedy provozní
 * příkaz `mlain rebuild-engagement`, a používá se po havárii, po obnově zálohy
 * nebo když se čísla rozejdou (kritérium 77 části 5).
 *
 * JEDEN VZOREC, ne druhá kopie. Per-kontaktní agregát existuje v repozitáři jen
 * tady. `reports/campaign-stats/recompute.ts` počítá jiné zrno (jeden řádek na
 * KAMPAŇ, ne na kontakt) a sdílet s ním jde leda tabulka, ze které oba čtou.
 * Kdyby někdy přibyl přírůstkový zapisovatel `contact_engagement`, musí stát
 * na tomtéž zdroji, jinak se výsledky rozejdou a rozdíl se pozná až na číslech
 * u zákazníka.
 *
 * CO SE POČÍTÁ a proč zrovna tohle:
 *
 * - `sent_total` je počet řádků `message_engagement`. Řádek vzniká na zprávu,
 *   takže je to počet odeslaných zpráv kontaktu.
 * - `opens_total` a `clicks_total` počítají jen OVĚŘENÁ otevření a prokliky,
 *   tedy `first_human_open_at` / `first_human_click_at`. Kritérium 75 části 5:
 *   kampaň otevřená výhradně Apple proxy `opens_total` nezvýší. Proto se
 *   nepoužívá `open_count`, který počítá i proxy a boty.
 * - `last_*_at` je maximum přes zprávy, ne poslední zapsaná hodnota. Přepočet
 *   běží nad daty, ne nad rozdílem, takže pořadí zpracování na výsledek nemá vliv
 *   a přerušený běh se dokončí opakovaným spuštěním.
 *
 * CO SE SCHVÁLNĚ NEPOČÍTÁ:
 *
 * - `delivered_total`, `bounces_total`, `last_delivered_at`, `last_bounce_at`
 *   a oba čítače `consecutive_no_*`. Z `message_engagement` se dopočítat NEDAJÍ:
 *   ta tabulka nese otevření a prokliky, ne doručení a odrazy. Kdyby je přepočet
 *   nastavil na nulu, ztratila by se informace, kterou nemá odkud vzít, a údaj
 *   „naposledy se odrazil" by po každém přepočtu zmizel. Zůstávají proto
 *   nedotčené. Je to totéž rozhodnutí, jaké má plán P10.
 * - Klouzavá okna `sent7d`…`clicks90d`. Ta vlastní samostatný přepočet oken,
 *   který běží denně a má vlastní frontu.
 *
 * Dávkuje se přes kurzor nad `contact_id`. `contact_id` je uuid a Postgres ho
 * porovnává po bajtech, takže stránkování `> kurzor` s `ORDER BY` prochází
 * každý kontakt právě jednou i tehdy, když mezi dávkami přibudou nové řádky.
 */
export type RecomputeEngagementInput = {
  workspaceId: string;
  batchSize: number;
  /** `contact_id` poslední zpracované dávky, `null` pro první dávku. */
  cursor: string | null;
};

export type RecomputeEngagementBatch = {
  processed: number;
  /** `null` znamená, že další dávka není, ne že se nic nezpracovalo. */
  nextCursor: string | null;
};

/** Nejnižší možné uuid. Používá se místo `IS NULL` větve v podmínce kurzoru. */
const FIRST_CURSOR = '00000000-0000-0000-0000-000000000000';

export async function recomputeContactEngagement(
  tx: Tx,
  input: RecomputeEngagementInput,
): Promise<RecomputeEngagementBatch> {
  if (!Number.isInteger(input.batchSize) || input.batchSize <= 0) {
    throw new Error(
      `Neplatná velikost dávky: ${String(input.batchSize)}. Nula ani záporné číslo by ` +
        'znamenalo nekonečnou smyčku bez jediného zpracovaného kontaktu.',
    );
  }

  const cursor = input.cursor ?? FIRST_CURSOR;

  const { rows } = await tx.execute<{ contact_id: string }>(sql`
    WITH source AS (
      SELECT me.workspace_id,
             me.contact_id,
             max(me.created_at)                                          AS last_sent_at,
             max(me.first_human_open_at)                                 AS last_open_at,
             max(me.first_human_click_at)                                AS last_click_at,
             count(*)                                                    AS sent_total,
             count(*) FILTER (WHERE me.first_human_open_at IS NOT NULL)   AS opens_total,
             count(*) FILTER (WHERE me.first_human_click_at IS NOT NULL)  AS clicks_total
        FROM message_engagement me
       WHERE me.workspace_id = ${input.workspaceId}::uuid
         -- Vymazaný kontakt (článek 17) má contact_id NULL a řádek zůstává kvůli
         -- statistikám kampaně. Do agregátu podle kontaktu ale nepatří.
         AND me.contact_id IS NOT NULL
         AND me.contact_id > ${cursor}::uuid
       GROUP BY me.workspace_id, me.contact_id
       ORDER BY me.contact_id
       LIMIT ${input.batchSize}
    )
    INSERT INTO contact_engagement (
      workspace_id, contact_id,
      last_sent_at, last_open_at, last_click_at,
      sent_total, opens_total, clicks_total,
      updated_at)
    SELECT workspace_id, contact_id,
           last_sent_at, last_open_at, last_click_at,
           sent_total, opens_total, clicks_total,
           now()
      FROM source
    ON CONFLICT (workspace_id, contact_id) DO UPDATE SET
      last_sent_at  = excluded.last_sent_at,
      last_open_at  = excluded.last_open_at,
      last_click_at = excluded.last_click_at,
      sent_total    = excluded.sent_total,
      opens_total   = excluded.opens_total,
      clicks_total  = excluded.clicks_total,
      updated_at    = now()
    RETURNING contact_id
  `);

  // Pořadí řádků z RETURNING zaručené není, kurzor se proto bere jako maximum.
  // Kanonický zápis uuid je malými písmeny a s pomlčkami na pevných místech,
  // takže se porovnáním řetězců seřadí stejně jako po bajtech v databázi.
  let maxContactId: string | null = null;
  for (const row of rows) {
    if (maxContactId === null || row.contact_id > maxContactId) maxContactId = row.contact_id;
  }

  return {
    processed: rows.length,
    // Kratší dávka znamená, že zdroj došel. Bez téhle podmínky by dávkovač
    // udělal ještě jedno prázdné kolo navíc, což je zbytečný dotaz, ale hlavně
    // by se `nextCursor` musel řešit i pro prázdnou dávku.
    nextCursor: rows.length < input.batchSize ? null : maxContactId,
  };
}
