import { sql } from 'drizzle-orm';
import { MEASUREMENT_PURPOSE } from '../../contacts/repo/consents';
import type { Tx } from './tx';

/**
 * Kontakty z předané množiny, které měření ODMÍTLY.
 *
 * Vrací se odmítnutí, ne povolení, a schválně: chybějící řádek znamená
 * „nevyjádřil se" a to podle `allowsMeasurement` měřit nebrání. Kdyby funkce
 * vracela povolené, musela by výchozí stav dopočítat sama a byla by z toho
 * druhá kopie pravidla, tedy přesně to, co se u souhlasů nesmí stát.
 *
 * Jeden dotaz na celou dávku, ne dotaz na řádek: `tracking.process_engagement`
 * zpracovává otevření a prokliky po stovkách a jeden `SELECT` na každý z nich
 * by z jobu udělal N+1.
 */
export async function selectMeasurementWithdrawn(
  tx: Tx,
  workspaceId: string,
  contactIds: readonly string[],
): Promise<Set<string>> {
  const unique = [...new Set(contactIds)];
  if (unique.length === 0) return new Set();
  const { rows } = await tx.execute<{ contactId: string }>(sql`
    SELECT contact_id AS "contactId"
      FROM contact_consent_state
     WHERE workspace_id = ${workspaceId}
       AND purpose = ${MEASUREMENT_PURPOSE}
       AND status = 'withdrawn'
       AND contact_id = ANY(${sql.param(unique)}::uuid[])
  `);
  return new Set(rows.map((row) => row.contactId));
}

/**
 * Zápis do jednotné časové osy `web_events`.
 *
 * Otevření a proklik e-mailu se do ní zapisují jako `email_opened`
 * a `email_clicked`, protože časová osa kontaktu je jedna a nemá se ptát na dvě
 * různá místa. Surový důkaz zůstává v `message_events`; tohle je jeho podoba
 * pro čtení člověkem.
 *
 * `ck_web_events__lag` drží `occurred_at` v pásmu od `received_at - 7 dní`
 * do `received_at + 1 minuta`. U události staršího data by zápis spadl, proto
 * se čas ořezává na dolní hranici okna.
 */
export type WebEventInsert = {
  id: string;
  occurredAt: Date;
  workspaceId: string;
  name: string;
  contactId: string | null;
  source: 'email';
  properties: Record<string, unknown>;
};

const LAG_WINDOW_DAYS = 7;

export async function insertWebEvents(
  tx: Tx,
  workspaceId: string,
  rows: readonly WebEventInsert[],
): Promise<void> {
  // Řádek bez subjektu porušuje `ck_web_events__subject`. Anonymní ID u události
  // z e-mailu neexistuje, takže bez kontaktu není co zapsat: zpráva vymazaného
  // kontaktu (článek 17) má `contact_id` NULL a do časové osy nepatří.
  const usable = rows.filter((row) => row.contactId !== null);
  if (usable.length === 0) return;

  const floor = Date.now() - LAG_WINDOW_DAYS * 24 * 3600 * 1000 + 60_000;
  const occurred = usable.map((row) =>
    row.occurredAt.getTime() < floor ? new Date(floor) : row.occurredAt,
  );

  await tx.execute(sql`
    INSERT INTO web_events (id, occurred_at, workspace_id, name, contact_id, source, properties)
    SELECT * FROM unnest(
      ${sql.param(usable.map((r) => r.id))}::uuid[],
      ${sql.param(occurred)}::timestamptz[],
      ${sql.param(usable.map(() => workspaceId))}::uuid[],
      ${sql.param(usable.map((r) => r.name))}::text[],
      ${sql.param(usable.map((r) => r.contactId))}::uuid[],
      ${sql.param(usable.map((r) => r.source))}::text[],
      ${sql.param(usable.map((r) => JSON.stringify(r.properties)))}::jsonb[])
    ON CONFLICT DO NOTHING
  `);

  /**
   * MAPA MĚSÍCŮ SE MUSÍ DOPLNIT SPOLU S UDÁLOSTÍ.
   *
   * `web_event_months` je řídká mapa „v kterých měsících má subjekt vůbec
   * nějaká data" a je to POVINNÝ předvýběr: časová osa i podmínka segmentu
   * podle chování se přes ni ptají dřív, než sáhnou na oddíly `web_events`.
   * Bez řádku v mapě se událost nezobrazí a segment nikoho nenajde, přestože
   * je řádek v tabulce správně zapsaný. Nic přitom nespadne.
   *
   * Do téhle chvíle tabulku plnilo JEDINÉ místo, sloučení identity
   * (`tracking/identity/merge.ts`), tedy cesta, kterou otevření ani proklik
   * e-mailu neprochází. Otevřením a prokliky se mapa nedoplnila nikdy a v ostré
   * instalaci byla prázdná; ověřeno dotazem proti běžící databázi.
   *
   * Měsíc se bere z `received_at`, ne z `occurred_at`: musí odpovídat oddílu,
   * do kterého řádek spadl, jinak by předvýběr ukázal na jiný měsíc, než kde
   * data leží. Čte se ze zapsaných řádků, aby hodnota vznikla ze skutečného
   * `received_at`, a ne z času aplikace.
   */
  await tx.execute(sql`
    INSERT INTO web_event_months (workspace_id, subject_kind, subject_id, month)
    SELECT DISTINCT workspace_id, 'contact', contact_id,
           date_trunc('month', received_at)::date
      FROM web_events
     WHERE workspace_id = ${workspaceId}
       AND id = ANY(${sql.param(usable.map((r) => r.id))}::uuid[])
       AND contact_id IS NOT NULL
    ON CONFLICT DO NOTHING
  `);
}
