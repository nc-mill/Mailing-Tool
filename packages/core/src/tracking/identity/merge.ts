import { sql } from 'drizzle-orm';
import { ApiError } from '../../errors/api-error';
import { trackingLogger } from '../logging';
import { trackingMetrics } from '../metrics';
import {
  insertMerge,
  lockBinding,
  selectContactGuard,
  selectMergeByBinding,
} from '../repo/identities.repo';
import { withTrackingTx } from '../repo/tx';

/**
 * Slučování anonymní historie a jeho vrácení, viz plán P10 Task 30.
 *
 * Slučování doplní `contact_id` do už uložených anonymních událostí. Bez něj by
 * v časové ose chybělo přesně to, kvůli čemu se produkt staví: co člověk dělal
 * na webu PŘEDTÍM, než jsme věděli, kdo je.
 *
 * Čtyři podmínky, které v dotazu nesmí chybět, každá z jiného důvodu:
 *
 * - `contact_id IS NULL` dělá job idempotentním. Opakované spuštění po restartu
 *   už zpracované řádky vyloučí, takže dvojí běh nezpůsobí duplicity. Je to
 *   zároveň jediná pojistka proti přepsání události, kterou už vlastní jiný
 *   kontakt: cizí atribuci tenhle kód nikdy nepřepíše.
 * - `erased_at IS NULL` brání vzkříšení vymazaných dat. Kdyby se týž prohlížeč
 *   později navázal na jiný kontakt, slučování by mu vymazané události připsalo.
 * - Podmínka na `occurred_at` drží okno, ve kterém se historie doplňuje.
 * - Podmínka na `received_at` prořezává oddíly. Bez ní se prohledají všechny
 *   a rozpočet padne. Řadí se podle `occurred_at`, ale prořezává se podle
 *   `received_at`, a ty dvě hodnoty se rozcházejí až o sedm dní.
 */

export type MergeStatus =
  'completed' | 'truncated' | 'skipped_restricted' | 'skipped_conflict' | 'skipped_reverted';

export type RunMergeInput = {
  workspaceId: string;
  anonymousId: string;
  contactId: string;
  bindingId: string;
  /** Jak hluboko do minulosti se historie doplňuje. Z `TRACKING_MERGE_WINDOW_DAYS`. */
  windowDays: number;
  /** Strop na jeden běh. Nad ním končí stav `truncated`. Z `TRACKING_MERGE_MAX_EVENTS`. */
  maxEvents: number;
  batchSize: number;
  now: Date;
};

export type RunMergeResult = {
  /** `null` u stavů, u kterých se žádný běh nezaložil. */
  mergeId: string | null;
  status: MergeStatus;
  eventsTotal: number;
};

/**
 * Okno hledání podle `received_at`.
 *
 * `ck_web_events__lag` drží živé zdroje v pásmu
 * `occurred_at > received_at - 7 dní AND occurred_at <= received_at + 60 s`,
 * takže k události s `occurred_at` v okně patří `received_at` nejdřív
 * o minutu dřív a nejpozději o sedm dní později. Dávkový import je z pravidla
 * vyňatý, u něj se `received_at` odvozuje z `occurred_at`, tedy leží v okně taky.
 *
 * ODCHYLKA OD PLÁNU, drobná a vědomá: plán psal `received_at >= windowFrom`.
 * Událost, která vznikla těsně po začátku okna a dorazila o pár desítek sekund
 * dřív (hodiny klienta jdou napřed), by z takového okna vypadla.
 */
const RECEIVED_LEAD_SECONDS = 60;
const RECEIVED_LAG_DAYS = 7;

type PreparedMerge =
  | { kind: 'run'; mergeId: string; windowFrom: Date; windowTo: Date }
  | { kind: 'done'; result: RunMergeResult };

/**
 * Krok 0 až 2 v jedné transakci: kontrola omezení, kontrola cizí vazby
 * a založení nebo převzetí běhu.
 *
 * ODCHYLKA OD PLÁNU, a je to zpřísnění. Plán zakládal NOVÝ řádek
 * `identity_merges` při každém spuštění. Úloha se ale smí vyzvednout dvakrát
 * (retry po vypršení viditelnosti, restart workeru), takže by v auditní tabulce
 * vznikly dva až pět řádků na jednu vazbu, z toho všechny kromě prvního
 * s `events_total = 0`. Vrácení sloučení by pak neexistovalo jako jeden úkon.
 * Klíčem idempotence je proto `binding_id`, tedy přesně to, co fronta drží
 * v `singletonKey`.
 */
async function prepareMerge(input: RunMergeInput): Promise<PreparedMerge> {
  return withTrackingTx(
    { workspaceId: input.workspaceId, job: 'identity.merge' },
    async (tx): Promise<PreparedMerge> => {
      await lockBinding(tx, input.bindingId);

      // 0. Omezení zpracování se kontroluje ZNOVU, mohlo být uplatněno mezi
      //    vazbou a během jobu. Měkce smazaný kontakt se chová stejně.
      const guard = await selectContactGuard(tx, input.workspaceId, input.contactId);
      if (guard === null || guard.processingRestricted || guard.deletedAt !== null) {
        return {
          kind: 'done',
          result: { mergeId: null, status: 'skipped_restricted', eventsTotal: 0 },
        };
      }

      // 1. Anonymní stopa už patří JINÉMU kontaktu. Sdílený počítač, přeposlaný
      //    e-mail nebo záměrné zneužití: ve všech třech případech je špatně
      //    přiřadit historii nové osobě. Job proto nedělá nic a nic nezapisuje.
      const { rows: identity } = await tx.execute<{ contactId: string | null }>(sql`
        SELECT contact_id AS "contactId"
          FROM identities
         WHERE workspace_id = ${input.workspaceId} AND anonymous_id = ${input.anonymousId}
      `);
      const boundTo = identity[0]?.contactId ?? null;
      if (boundTo !== null && boundTo !== input.contactId) {
        trackingLogger().warn(
          { anonymousId: input.anonymousId, boundTo, requested: input.contactId },
          'tracking_identity_merge_conflict',
        );
        return {
          kind: 'done',
          result: { mergeId: null, status: 'skipped_conflict', eventsTotal: 0 },
        };
      }

      const existing = await selectMergeByBinding(tx, input.workspaceId, input.bindingId);
      if (existing !== null) {
        // Hotový běh se nepouští znovu, jen se ohlásí jeho výsledek.
        if (existing.status === 'completed' || existing.status === 'truncated') {
          return {
            kind: 'done',
            result: {
              mergeId: existing.id,
              status: existing.status,
              eventsTotal: existing.eventsTotal,
            },
          };
        }
        // Vrácené sloučení se nikdy nekřísí. Retry po revertu by uživateli
        // vrátil do časové osy přesně to, co si nechal odebrat.
        if (existing.status === 'reverted') {
          return {
            kind: 'done',
            result: { mergeId: existing.id, status: 'skipped_reverted', eventsTotal: 0 },
          };
        }
        // `running`, `pending` nebo `failed`: pokračuje se v NĚM, a to s jeho
        // původním oknem. Nové okno spočítané z aktuálního času by při retry
        // po hodině posunulo obě hranice a vyrobilo jiný výsledek.
        return {
          kind: 'run',
          mergeId: existing.id,
          windowFrom: existing.windowFrom,
          windowTo: existing.windowTo,
        };
      }

      const windowFrom = new Date(input.now.getTime() - input.windowDays * 24 * 60 * 60 * 1000);
      const windowTo = input.now;
      const mergeId = await insertMerge(tx, {
        workspaceId: input.workspaceId,
        anonymousId: input.anonymousId,
        contactId: input.contactId,
        bindingId: input.bindingId,
        windowFrom,
        windowTo,
      });
      return { kind: 'run', mergeId, windowFrom, windowTo };
    },
  );
}

export async function runIdentityMerge(input: RunMergeInput): Promise<RunMergeResult> {
  const prepared = await prepareMerge(input);
  if (prepared.kind === 'done') return prepared.result;

  const { mergeId, windowFrom, windowTo } = prepared;
  const scope = { workspaceId: input.workspaceId, job: 'identity.merge' } as const;
  const receivedFrom = new Date(windowFrom.getTime() - RECEIVED_LEAD_SECONDS * 1000);
  const receivedTo = new Date(windowTo.getTime() + RECEIVED_LAG_DAYS * 24 * 60 * 60 * 1000);

  let moved = 0;
  for (;;) {
    const remaining = input.maxEvents - moved;
    if (remaining <= 0) break;
    const limit = Math.min(input.batchSize, remaining);

    const updated = await withTrackingTx(
      scope,
      async (tx) =>
        (
          await tx.execute<{ id: string }>(sql`
            UPDATE web_events
               SET contact_id = ${input.contactId}, identity_merge_id = ${mergeId}
             WHERE (id, received_at) IN (
                     SELECT id, received_at FROM web_events
                      WHERE workspace_id = ${input.workspaceId}
                        AND anonymous_id = ${input.anonymousId}
                        AND contact_id IS NULL
                        AND erased_at IS NULL
                        AND occurred_at >= ${windowFrom}
                        AND occurred_at <  ${windowTo}
                        AND received_at >= ${receivedFrom}
                        AND received_at <  ${receivedTo}
                      ORDER BY occurred_at DESC
                      LIMIT ${limit})
            RETURNING id
          `)
        ).rows,
    );

    if (updated.length === 0) break;
    moved += updated.length;
    if (updated.length < limit) break;
  }

  return withTrackingTx(scope, async (tx) => {
    // Zbývá ještě něco v okně? Pak jsme narazili na strop, ne na konec dat.
    const { rows: rest } = await tx.execute<{ id: string }>(sql`
      SELECT id FROM web_events
       WHERE workspace_id = ${input.workspaceId}
         AND anonymous_id = ${input.anonymousId}
         AND contact_id IS NULL
         AND erased_at IS NULL
         AND occurred_at >= ${windowFrom}
         AND occurred_at <  ${windowTo}
         AND received_at >= ${receivedFrom}
         AND received_at <  ${receivedTo}
       LIMIT 1
    `);
    const truncated = rest.length > 0;

    // Celkový počet se čte z tabulky, ne z počítadla v paměti. Po retry doplní
    // druhý běh jen zbytek, ale `events_total` musí nést součet OBOU běhů,
    // jinak by vrácení hlásilo jiné číslo, než kolik řádků skutečně vrátí.
    const { rows: counted } = await tx.execute<{ count: number }>(sql`
      SELECT count(*)::int AS count FROM web_events WHERE identity_merge_id = ${mergeId}
    `);
    const eventsTotal = counted[0]?.count ?? 0;

    // Časová osa čte web_events přes měsíce v `web_event_months`. Bez tohohle
    // zápisu by se doplněné události v ose vůbec neobjevily, i když v tabulce
    // s vyplněným contact_id sedí. Měsíc se bere z `received_at`, tedy podle
    // oddílu, ne podle `occurred_at`.
    await tx.execute(sql`
      INSERT INTO web_event_months (workspace_id, subject_kind, subject_id, month)
      SELECT DISTINCT ${input.workspaceId}::uuid, 'contact', ${input.contactId}::uuid,
             date_trunc('month', received_at)::date
        FROM web_events
       WHERE identity_merge_id = ${mergeId}
      ON CONFLICT DO NOTHING
    `);

    await tx.execute(sql`
      UPDATE contacts
         SET last_activity_at = GREATEST(
               COALESCE(last_activity_at, 'epoch'::timestamptz),
               COALESCE((SELECT max(occurred_at) FROM web_events
                          WHERE identity_merge_id = ${mergeId}), 'epoch'::timestamptz))
       WHERE id = ${input.contactId} AND workspace_id = ${input.workspaceId}
    `);

    const status: MergeStatus = truncated ? 'truncated' : 'completed';
    await tx.execute(sql`
      UPDATE identity_merges
         SET status = ${status}, events_total = ${eventsTotal}
       WHERE id = ${mergeId} AND workspace_id = ${input.workspaceId}
    `);

    trackingMetrics.identityMergeEvents.inc(undefined, moved);
    trackingLogger().info(
      { mergeId, contactId: input.contactId, moved, eventsTotal, status },
      'tracking_identity_merge_done',
    );
    return { mergeId, status, eventsTotal };
  });
}

export type RevertInput = {
  workspaceId: string;
  mergeId: string;
  /** UUID uživatele, který vrácení vyvolal. Sloupec `reverted_by` je uuid. */
  revertedBy: string;
  now: Date;
};

/**
 * Vrácení je úplné, protože `identity_merge_id` přesně označuje řádky, které
 * merge změnil. Události, které přišly už s vyplněným `contact_id`, se
 * nevracejí: ty k tomu kontaktu skutečně patří, protože vznikly až po vazbě.
 *
 * `web_event_months` se schválně neuklízí: řádek měsíce navíc znamená jeden
 * prázdný dotaz v časové ose, kdežto smazání by odstranilo měsíc, ve kterém
 * kontakt má i vlastní, nesloučené události.
 */
export async function revertIdentityMerge(input: RevertInput): Promise<number> {
  const scope = { workspaceId: input.workspaceId, job: 'tracking.merge_revert' } as const;

  const status = await withTrackingTx(scope, async (tx) => {
    const { rows } = await tx.execute<{ status: string }>(sql`
      SELECT status FROM identity_merges
       WHERE id = ${input.mergeId} AND workspace_id = ${input.workspaceId}
    `);
    return rows[0]?.status ?? 'missing';
  });
  if (status !== 'completed' && status !== 'truncated') {
    throw new ApiError('tracking_merge_not_revertible', { params: { status } });
  }

  let total = 0;
  for (;;) {
    const updated = await withTrackingTx(
      scope,
      async (tx) =>
        (
          await tx.execute<{ id: string }>(sql`
            UPDATE web_events
               SET contact_id = NULL, identity_merge_id = NULL
             WHERE (id, received_at) IN (
                     SELECT id, received_at FROM web_events
                      WHERE identity_merge_id = ${input.mergeId}
                      LIMIT 1000)
            RETURNING id
          `)
        ).rows,
    );
    if (updated.length === 0) break;
    total += updated.length;
  }

  await withTrackingTx(scope, async (tx) => {
    await tx.execute(sql`
      UPDATE identity_merges
         SET status = 'reverted', reverted_at = ${input.now}, reverted_by = ${input.revertedBy}
       WHERE id = ${input.mergeId} AND workspace_id = ${input.workspaceId}
    `);
  });

  trackingLogger().info({ mergeId: input.mergeId, total }, 'tracking_identity_merge_reverted');
  return total;
}
