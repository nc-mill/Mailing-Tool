import { sql } from 'drizzle-orm';
import { withTrackingTx, type Tx } from './tx';
import { OPEN_CLASS_BIT, type ClickClass, type OpenClass } from '../types';

/**
 * Zápis agregací zapojení: `message_engagement`, `campaign_stats`,
 * `campaign_link_stats` a `campaign_stats_buckets`.
 *
 * Do všech čtyř tabulek smí zapisovat JEDINĚ tahle doména, hlídá to test
 * `reports/ownership.test.ts`. Balíček `reports` z nich jen čte.
 *
 * Celý modul stojí na jedné myšlence: přírůstky do souhrnu se počítají
 * z PŘECHODŮ STAVU jedné zprávy (`first_open_at` přešlo z NULL na hodnotu),
 * nikdy z délky vstupní dávky. Jen díky tomu je dvojí spuštění téhož jobu
 * bez následku. Kdyby se počítalo z délky pole, druhý běh po pádu workeru
 * by čísla nafoukl a nikdo by si toho nevšiml.
 */

export type MessageEventRow = {
  id: string;
  ts: Date;
  workspaceId: string;
  messageId: string;
  messageCreatedAt: Date;
  campaignId: string;
  contactId: string | null;
  type: 'open' | 'click';
  subtype: string;
  linkId: string | null;
  metadata: Record<string, unknown>;
};

export type MessageEventLookup = {
  /** Projekt z nákladu úlohy. Bez něj RLS nevrátí ani řádek, viz `withCrossWorkspaceTx`. */
  workspaceId: string;
  ids: readonly string[];
};

/**
 * Události dávky podle jejich ID.
 *
 * Čte se V KONTEXTU PROJEKTU, ne napříč projekty. `withCrossWorkspaceTx` by
 * tady byl tichá past: politika `ws_isolation` porovnává `workspace_id`
 * s `current_setting('mlain.workspace_id')`, které bez kontextu není nastavené,
 * takže by dotaz vrátil NULA řádků a job by skončil úspěchem bez práce.
 * Proto je `workspace_id` součástí nákladu fronty (registr P01 to tak má).
 *
 * Podmínka na `received_at` prořezává oddíly. Události se zpracovávají během
 * sekund od zápisu, dva dny jsou bohatá rezerva i pro opakování po výpadku.
 */
export async function selectMessageEventsByIds(
  lookup: MessageEventLookup,
): Promise<MessageEventRow[]> {
  if (lookup.ids.length === 0) return [];
  const rows = await withTrackingTx(
    { workspaceId: lookup.workspaceId, job: 'tracking.process_engagement' },
    async (tx) =>
      (
        await tx.execute<
          Omit<MessageEventRow, 'ts' | 'messageCreatedAt'> & {
            ts: Date | string;
            messageCreatedAt: Date | string;
          }
        >(sql`
          SELECT id, ts, workspace_id AS "workspaceId",
                 message_id AS "messageId", message_created_at AS "messageCreatedAt",
                 campaign_id AS "campaignId", contact_id AS "contactId",
                 type, subtype, link_id AS "linkId", metadata
            FROM message_events
           WHERE workspace_id = ${lookup.workspaceId}::uuid
             AND id = ANY(${sql.param([...lookup.ids])}::uuid[])
             AND type IN ('open', 'click')
             AND received_at >= now() - interval '2 days'
        `)
      ).rows,
  );

  // Časové sloupce se převádějí TADY, na jednom místě. `tx.execute` vrací
  // syrový výsledek ovladače a ten podle nastavení parseru vydá timestamptz
  // jednou jako `Date` a jindy jako řetězec. Volající by si o tom musel vědět
  // a chyba by se projevila až za běhu jako `getTime is not a function`.
  return rows.map((row) => ({
    ...row,
    ts: new Date(row.ts),
    messageCreatedAt: new Date(row.messageCreatedAt),
  }));
}

export type EngagementTransition = {
  firstOpen: boolean;
  firstHumanOpen: boolean;
  firstClick: boolean;
  firstHumanClick: boolean;
  openClassMaskBefore: number;
  openClassMaskAfter: number;
  openCountDelta: number;
  clickCountDelta: number;
  /** Odkazy, na které se v téhle zprávě kliklo POPRVÉ. Zdroj `clicks_unique` odkazu. */
  newLinkIds: string[];
  /** Otevření se nezaznamenalo, ale proklik ho dokazuje. Viz `impliedOpen` níž. */
  impliedOpenFromClick: boolean;
};

export type EngagementDelta = {
  messageId: string;
  createdAt: Date;
  workspaceId: string;
  campaignId: string;
  contactId: string | null;
  opens: { at: Date; cls: OpenClass }[];
  clicks: { at: Date; cls: ClickClass; linkId: string }[];
};

/** Otevření, která se počítají jako ověřená (člověk). Apple proxy mezi ně nepatří. */
function isHumanOpenClass(cls: OpenClass): boolean {
  return cls === 'human' || cls === 'proxy_image';
}

/**
 * Sloupec typu timestamptz na `Date`.
 *
 * `tx.execute` vrací syrový výsledek ovladače a ten podle nastavení parseru
 * vydá timestamptz jednou jako `Date` a jindy jako řetězec. Bez převodu se to
 * projeví až za běhu jako `getTime is not a function`, a to uvnitř jobu, kde
 * si toho nikdo hned nevšimne.
 */
function asDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  return value instanceof Date ? value : new Date(value);
}

function minDate(dates: readonly Date[]): Date | null {
  return dates.length === 0 ? null : new Date(Math.min(...dates.map((d) => d.getTime())));
}

function maxDate(dates: readonly Date[]): Date | null {
  return dates.length === 0 ? null : new Date(Math.max(...dates.map((d) => d.getTime())));
}

/**
 * Upsert řádku zapojení jedné zprávy. Vrací PŘECHODY, ne konečný stav.
 *
 * **Proklik implikuje otevření.** Kdo klikl na odkaz v e-mailu, ten e-mail
 * prokazatelně otevřel; opačně to neplatí. Otevření se přitom měří obrázkem
 * o velikosti jednoho pixelu a ten blokuje Gmail, Outlook i většina firemních
 * bran, takže „0 otevření a 5 prokliků" je stav, který v reálném provozu
 * nastane běžně a pro uživatele vypadá jako rozbitý produkt. Když tedy dorazí
 * proklik ke zprávě, která zatím žádné otevření nemá, doplní se otevření
 * z času prokliku.
 *
 * Dopočet se zapisuje POUZE do `message_engagement`, ne do `message_events`.
 * Je to schválně: `message_events` je surový záznam toho, co se skutečně stalo,
 * a dopsat do něj otevření, které nikdo nezaznamenal, by ho změnilo z důkazu
 * na dohad. `reports/campaign-stats/recompute.ts` počítá otevření z
 * `message_engagement`, takže kontrola driftu i po dopočtu sedí.
 *
 * Třída dopočteného otevření se řídí třídou prokliku: lidský proklik dá lidské
 * otevření, proklik skeneru dá otevření třídy `unknown`, aby se skener
 * nepočítal mezi ověřená otevření.
 */
export async function upsertMessageEngagement(
  delta: EngagementDelta,
  openDedupSeconds: number,
): Promise<EngagementTransition> {
  return withTrackingTx(
    { workspaceId: delta.workspaceId, job: 'tracking.process_engagement' },
    async (tx) => {
      const { rows: before } = await tx.execute<{
        firstOpenAt: Date | string | null;
        lastOpenAt: Date | string | null;
        firstHumanOpenAt: Date | string | null;
        firstClickAt: Date | string | null;
        firstHumanClickAt: Date | string | null;
        openClassMask: number;
        clickedLinks: number;
      }>(sql`
        SELECT first_open_at AS "firstOpenAt", last_open_at AS "lastOpenAt",
               first_human_open_at AS "firstHumanOpenAt", first_click_at AS "firstClickAt",
               first_human_click_at AS "firstHumanClickAt",
               open_class_mask AS "openClassMask", clicked_links AS "clickedLinks"
          FROM message_engagement
         WHERE message_id = ${delta.messageId}::uuid AND created_at = ${delta.createdAt}
           FOR UPDATE
      `);
      const raw = before[0];
      const prev = {
        firstOpenAt: asDate(raw?.firstOpenAt ?? null),
        lastOpenAt: asDate(raw?.lastOpenAt ?? null),
        firstHumanOpenAt: asDate(raw?.firstHumanOpenAt ?? null),
        firstClickAt: asDate(raw?.firstClickAt ?? null),
        firstHumanClickAt: asDate(raw?.firstHumanClickAt ?? null),
        openClassMask: Number(raw?.openClassMask ?? 0),
      };

      const opens = [...delta.opens];
      const humanClicks = delta.clicks.filter((c) => c.cls === 'human');

      // Dopočet otevření z prokliku. Uplatní se jen tehdy, když zpráva zatím
      // žádné otevření nemá ANI v databázi, ani v téhle dávce.
      const impliedOpenFromClick =
        prev.firstOpenAt === null && opens.length === 0 && delta.clicks.length > 0;
      if (impliedOpenFromClick) {
        const source = humanClicks[0] ?? delta.clicks[0]!;
        opens.push({ at: source.at, cls: source.cls === 'human' ? 'human' : 'unknown' });
      }

      // Deduplikace opakovaných stažení pixelu: obě události v tabulce zůstanou,
      // ale `open_count` se zvýší jen jednou. Gmail stáhne tentýž pixel
      // několikrát za jedno čtení.
      let lastOpenAt = prev.lastOpenAt;
      let openCountDelta = 0;
      for (const open of [...opens].sort((a, b) => a.at.getTime() - b.at.getTime())) {
        if (
          lastOpenAt === null ||
          open.at.getTime() - lastOpenAt.getTime() > openDedupSeconds * 1000
        ) {
          openCountDelta += 1;
        }
        lastOpenAt = open.at;
      }

      const humanOpens = opens.filter((o) => isHumanOpenClass(o.cls));

      let mask = prev.openClassMask;
      for (const open of opens) mask |= OPEN_CLASS_BIT[open.cls];

      const firstOpenAt = prev.firstOpenAt ?? minDate(opens.map((o) => o.at));
      const firstHumanOpenAt = prev.firstHumanOpenAt ?? minDate(humanOpens.map((o) => o.at));
      const firstClickAt = prev.firstClickAt ?? minDate(delta.clicks.map((c) => c.at));
      const firstHumanClickAt = prev.firstHumanClickAt ?? minDate(humanClicks.map((c) => c.at));

      const linkIds = [...new Set(delta.clicks.map((c) => c.linkId))];

      await tx.execute(sql`
        INSERT INTO message_engagement (
          message_id, created_at, workspace_id, campaign_id, contact_id,
          first_open_at, last_open_at, open_count, first_human_open_at, human_open_count,
          open_class_mask, first_click_at, last_click_at, click_count,
          first_human_click_at, human_click_count, clicked_links)
        VALUES (
          ${delta.messageId}::uuid, ${delta.createdAt}, ${delta.workspaceId}::uuid,
          ${delta.campaignId}::uuid, ${delta.contactId}::uuid,
          ${firstOpenAt}, ${lastOpenAt}, ${openCountDelta},
          ${firstHumanOpenAt}, ${humanOpens.length}, ${mask},
          ${firstClickAt}, ${maxDate(delta.clicks.map((c) => c.at))}, ${delta.clicks.length},
          ${firstHumanClickAt}, ${humanClicks.length}, ${linkIds.length})
        ON CONFLICT (message_id, created_at) DO UPDATE SET
          first_open_at        = COALESCE(message_engagement.first_open_at, excluded.first_open_at),
          last_open_at         = GREATEST(message_engagement.last_open_at, excluded.last_open_at),
          open_count           = message_engagement.open_count + excluded.open_count,
          first_human_open_at  = COALESCE(message_engagement.first_human_open_at, excluded.first_human_open_at),
          human_open_count     = message_engagement.human_open_count + excluded.human_open_count,
          open_class_mask      = message_engagement.open_class_mask | excluded.open_class_mask,
          first_click_at       = COALESCE(message_engagement.first_click_at, excluded.first_click_at),
          last_click_at        = GREATEST(message_engagement.last_click_at, excluded.last_click_at),
          click_count          = message_engagement.click_count + excluded.click_count,
          first_human_click_at = COALESCE(message_engagement.first_human_click_at, excluded.first_human_click_at),
          human_click_count    = message_engagement.human_click_count + excluded.human_click_count,
          clicked_links        = GREATEST(message_engagement.clicked_links, excluded.clicked_links)
      `);

      return {
        firstOpen: prev.firstOpenAt === null && firstOpenAt !== null,
        firstHumanOpen: prev.firstHumanOpenAt === null && firstHumanOpenAt !== null,
        firstClick: prev.firstClickAt === null && firstClickAt !== null,
        firstHumanClick: prev.firstHumanClickAt === null && firstHumanClickAt !== null,
        openClassMaskBefore: prev.openClassMask,
        openClassMaskAfter: mask,
        openCountDelta,
        clickCountDelta: delta.clicks.length,
        // Nový odkaz je ten, na který se dosud nekliklo. `clicked_links` je jen
        // POČET, ne seznam, takže se bere podle toho, jestli řádek zapojení
        // zatím žádný proklik neměl. Přesnější evidence by znamenala další
        // tabulku a `campaign_link_stats.clicks_unique` je stejně jen odhad.
        newLinkIds: prev.firstClickAt === null ? linkIds : [],
        impliedOpenFromClick,
      };
    },
  );
}

export type CampaignStatsDelta = {
  opensTotal: number;
  opensUnique: number;
  opensUniqueHuman: number;
  opensUniqueApple: number;
  clicksTotal: number;
  clicksUnique: number;
  clicksUniqueHuman: number;
  clicksScanner: number;
  firstEventAt: Date | null;
  lastEventAt: Date | null;
};

/**
 * Přičtení přírůstku k souhrnu kampaně.
 *
 * Sloupce doručenosti (`delivered`, `bounced_*`, `complained`, `unsubscribed`)
 * ani průběhu (`materialized`, `sent`, `failed`, `skipped`) se tady NEDOTÝKÁME.
 * Ty přepisuje `refresh-campaign-progress.ts` celou hodnotou. Rozdělení podle
 * sloupců je záměrné: dva zapisovatelé téhož řádku si nevadí, dokud se jejich
 * množiny sloupců nepřekrývají, a jeden přírůstkový a jeden přepisující
 * zapisovatel nad TÝMŽ sloupcem by se rozešli při prvním souběhu.
 *
 * `GREATEST` a `LEAST` s NULL vracejí druhý operand, takže první událost kampaně
 * nastaví obě časové značky správně i proti prázdnému řádku.
 */
/**
 * Kampaň a její projekt jako JEDNA pojmenovaná hodnota.
 *
 * Není to kosmetika. `identity/scope.test.ts` zakazuje exportované funkci
 * mimo `packages/core/src/tx` holý parametr `workspaceId: string`, protože
 * takový řetězec může přijít odkudkoliv a funkce se podle něj sama dotáže
 * databáze. Pojmenovaný typ nutí u každého volání napsat, co ta hodnota je,
 * a odkud pochází: tady vždycky z ověřeného tokenu nebo z nákladu úlohy.
 */
export type CampaignScope = { workspaceId: string; campaignId: string };

export async function applyCampaignStatsDelta(
  scope: CampaignScope,
  delta: CampaignStatsDelta,
): Promise<void> {
  const { workspaceId, campaignId } = scope;
  await withTrackingTx({ workspaceId, job: 'tracking.process_engagement' }, async (tx) => {
    await tx.execute(sql`
        INSERT INTO campaign_stats (
          workspace_id, campaign_id, opens_total, opens_unique, opens_unique_human,
          opens_unique_apple, clicks_total, clicks_unique, clicks_unique_human,
          clicks_scanner, first_event_at, last_event_at, updated_at, version)
        VALUES (
          ${workspaceId}::uuid, ${campaignId}::uuid, ${delta.opensTotal}, ${delta.opensUnique},
          ${delta.opensUniqueHuman}, ${delta.opensUniqueApple}, ${delta.clicksTotal},
          ${delta.clicksUnique}, ${delta.clicksUniqueHuman}, ${delta.clicksScanner},
          ${delta.firstEventAt}, ${delta.lastEventAt}, now(), 1)
        ON CONFLICT (campaign_id) DO UPDATE SET
          opens_total         = campaign_stats.opens_total + excluded.opens_total,
          opens_unique        = campaign_stats.opens_unique + excluded.opens_unique,
          opens_unique_human  = campaign_stats.opens_unique_human + excluded.opens_unique_human,
          -- Nikdy pod nulu: přeřazení zprávy z „jen Apple" na lidské otevření
          -- posílá záporný přírůstek a rozbitá dávka by jinak vyrobila
          -- záporný počet, který se v rozhraní nedá vysvětlit.
          opens_unique_apple  = GREATEST(campaign_stats.opens_unique_apple + excluded.opens_unique_apple, 0),
          clicks_total        = campaign_stats.clicks_total + excluded.clicks_total,
          clicks_unique       = campaign_stats.clicks_unique + excluded.clicks_unique,
          clicks_unique_human = campaign_stats.clicks_unique_human + excluded.clicks_unique_human,
          clicks_scanner      = campaign_stats.clicks_scanner + excluded.clicks_scanner,
          first_event_at      = LEAST(campaign_stats.first_event_at, excluded.first_event_at),
          last_event_at       = GREATEST(campaign_stats.last_event_at, excluded.last_event_at),
          updated_at          = now(),
          version             = campaign_stats.version + 1
      `);
  });
}

export type LinkStatsDeltaRow = {
  linkId: string;
  total: number;
  uniqueClicks: number;
  human: number;
};

export async function applyLinkStatsDelta(
  scope: CampaignScope,
  rows: readonly LinkStatsDeltaRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const { workspaceId, campaignId } = scope;
  await withTrackingTx({ workspaceId, job: 'tracking.process_engagement' }, async (tx) => {
    await tx.execute(sql`
      INSERT INTO campaign_link_stats (workspace_id, campaign_id, link_id, clicks_total, clicks_unique, clicks_human)
      SELECT * FROM unnest(
        ${sql.param(rows.map(() => workspaceId))}::uuid[],
        ${sql.param(rows.map(() => campaignId))}::uuid[],
        ${sql.param(rows.map((r) => r.linkId))}::uuid[],
        ${sql.param(rows.map((r) => r.total))}::bigint[],
        ${sql.param(rows.map((r) => r.uniqueClicks))}::bigint[],
        ${sql.param(rows.map((r) => r.human))}::bigint[])
      ON CONFLICT (workspace_id, campaign_id, link_id) DO UPDATE SET
        clicks_total  = campaign_link_stats.clicks_total + excluded.clicks_total,
        clicks_unique = campaign_link_stats.clicks_unique + excluded.clicks_unique,
        clicks_human  = campaign_link_stats.clicks_human + excluded.clicks_human
    `);
  });
}

export type BucketDeltaRow = { bucketAt: Date; opensUnique: number; clicksUnique: number };

/**
 * Přírůstek do pětiminutových bloků grafu.
 *
 * Konfliktní cíl je CELÝ primární klíč `(workspace_id, campaign_id, bucket_at)`.
 * Dvojice `(campaign_id, bucket_at)` žádný unikátní index nemá, takže by
 * PostgreSQL zápis odmítl chybou 42P10 a graf by zůstal prázdný.
 */
export async function applyBucketDelta(
  scope: CampaignScope,
  rows: readonly BucketDeltaRow[],
): Promise<void> {
  if (rows.length === 0) return;
  const { workspaceId, campaignId } = scope;
  await withTrackingTx({ workspaceId, job: 'tracking.process_engagement' }, async (tx) => {
    await tx.execute(sql`
      INSERT INTO campaign_stats_buckets (campaign_id, workspace_id, bucket_at, opens_unique, clicks_unique)
      SELECT * FROM unnest(
        ${sql.param(rows.map(() => campaignId))}::uuid[],
        ${sql.param(rows.map(() => workspaceId))}::uuid[],
        ${sql.param(rows.map((r) => r.bucketAt))}::timestamptz[],
        ${sql.param(rows.map((r) => r.opensUnique))}::int[],
        ${sql.param(rows.map((r) => r.clicksUnique))}::int[])
      ON CONFLICT (workspace_id, campaign_id, bucket_at) DO UPDATE SET
        opens_unique  = campaign_stats_buckets.opens_unique + excluded.opens_unique,
        clicks_unique = campaign_stats_buckets.clicks_unique + excluded.clicks_unique
    `);
  });
}

/**
 * Rollup zapojení na kontakt.
 *
 * Přírůstkový protějšek `recomputeContactEngagement`. Zvyšuje jen ověřené
 * počty, tedy tytéž, které počítá přepočet: kampaň otevřená výhradně Apple
 * proxy `opens_total` kontaktu nezvýší (kritérium 75 části 5). Řádek se
 * zakládá LÍNĚ, až při první události kontaktu.
 */
export async function applyContactEngagementDelta(
  tx: Tx,
  input: {
    workspaceId: string;
    contactId: string;
    openedAt: Date | null;
    clickedAt: Date | null;
  },
): Promise<void> {
  if (input.openedAt === null && input.clickedAt === null) return;
  const opens = input.openedAt === null ? 0 : 1;
  const clicks = input.clickedAt === null ? 0 : 1;

  await tx.execute(sql`
    INSERT INTO contact_engagement (
      workspace_id, contact_id, last_open_at, last_click_at,
      opens_total, clicks_total, consecutive_no_open, consecutive_no_click, updated_at)
    VALUES (
      ${input.workspaceId}::uuid, ${input.contactId}::uuid,
      ${input.openedAt}, ${input.clickedAt}, ${opens}, ${clicks}, 0, 0, now())
    ON CONFLICT (workspace_id, contact_id) DO UPDATE SET
      last_open_at  = GREATEST(contact_engagement.last_open_at, excluded.last_open_at),
      last_click_at = GREATEST(contact_engagement.last_click_at, excluded.last_click_at),
      opens_total   = contact_engagement.opens_total + excluded.opens_total,
      clicks_total  = contact_engagement.clicks_total + excluded.clicks_total,
      -- Otevření nuluje čítač neotevřených, proklik čítač neprokliknutých.
      -- Zpětně se nikdy nezvyšují: to dělá zpracování událostí od providera.
      consecutive_no_open  = CASE WHEN excluded.opens_total > 0 THEN 0
                                  ELSE contact_engagement.consecutive_no_open END,
      consecutive_no_click = CASE WHEN excluded.clicks_total > 0 THEN 0
                                  ELSE contact_engagement.consecutive_no_click END,
      updated_at    = now()
  `);
}
