import { sql } from 'drizzle-orm';
import { SYSTEM_CLICK_SUBTYPE } from '../../tracking/types';
import type { Tx, WorkspaceContext } from '../../tx';
import {
  HIDDEN_OPEN_SUBTYPES,
  NON_HUMAN_CLICK_SUBTYPES,
  TIMELINE_EVENT_TYPES,
} from '../event-types';
import type { TimeWindow } from './months';
import type { TimelineRow } from './types';

export type BranchInput = {
  contactId: string;
  window: TimeWindow;
  limit: number;
  /** Kurzor: vrací se jen položky starší než tahle dvojice. */
  before?: { occurredAt: Date; id: string };
};

/**
 * Zprávy. Položka "dostal kampaň X" musí existovat i pro kampaň, ke které
 * nikdy nedorazila žádná událost (kritérium 84), proto se čte z messages.
 *
 * Řadí se podle sent_at, ale index je nad created_at. U jednoho kontaktu jde
 * o jednotky až stovky řádků za měsíc, takže se okno načte celé a doseřadí
 * se v aplikaci. Rozdíl mezi created_at a sent_at je u naplánované kampaně
 * i několik hodin a uživateli se musí ukázat čas odeslání, ne materializace.
 */
export async function messageBranch(
  tx: Tx,
  ctx: WorkspaceContext,
  input: BranchInput,
): Promise<TimelineRow[]> {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT m.id,
           coalesce(m.sent_at, m.created_at) AS occurred_at,
           m.status,
           m.error_code,
           c.id   AS campaign_id,
           c.name AS campaign_name
      FROM messages m
      JOIN campaigns c ON c.id = m.campaign_id AND c.workspace_id = m.workspace_id
     WHERE m.workspace_id = ${ctx.workspaceId}
       AND m.contact_id   = ${input.contactId}
       AND m.created_at  >= ${input.window.from}
       AND m.created_at   < ${input.window.to}
       AND m.kind = 'campaign'
     ORDER BY m.created_at DESC
     LIMIT 500
  `);

  return sortAndCut(
    rows.map((row) => ({
      id: String(row['id']),
      occurredAt: new Date(row['occurred_at'] as string | Date),
      source: 'email',
      type: row['status'] === 'failed' ? 'message_failed' : 'message_sent',
      campaign: { id: String(row['campaign_id']), name: String(row['campaign_name']) },
      ...(row['error_code'] === null || row['error_code'] === undefined
        ? {}
        : { detail: { error_code: String(row['error_code']) } }),
      slots: { campaign: String(row['campaign_name']) },
    })),
    input,
  );
}

/**
 * Překlad typu ze schématu na typ položky osy. Klíče jsou jména
 * z `ck_message_events__type` (R19), ne z odmítnutého návrhu části 5.
 * Obě tvrdosti odrazu mají v ose jednu položku: uživatele zajímá, že se
 * zpráva nedoručila, tvrdost je detail.
 */
const EVENT_TYPE_MAP: Record<string, string> = {
  delivered: 'message_delivered',
  bounced_hard: 'message_bounced',
  bounced_soft: 'message_bounced',
  complained: 'message_complained',
  open: 'message_opened',
  click: 'message_clicked',
  unsubscribe: 'message_unsubscribed',
};

/**
 * Proklik na systémový odkaz v patičce má VLASTNÍ typ položky, ne obecné
 * „kliknutí v kampani".
 *
 * VZNIKLO Z POHLEDU NA OSU. Systémový proklik nemá řádek v `campaign_links`,
 * takže slot `{link}` zůstal prázdný a věta zněla „Klikl na  v kampani Test
 * kampaň", tedy s dírou uprostřed. Přitom je z `metadata.system_link` přesně
 * známo, KAM klikl, a „Otevřel centrum předvoleb" je pro odesílatele mnohem
 * cennější informace než kliknutí na nic.
 *
 * Druhy jsou vyjmenované v `SYSTEM_LINK_KINDS` a odsud se jen mapují na klíče
 * vět. Neznámý druh spadne na obecné `message_clicked`, tedy na dřívější
 * chování, ne na chybu.
 */
const SYSTEM_LINK_TYPE_MAP: Record<string, string> = {
  unsubscribe_page: 'message_clicked_unsubscribe_page',
  preferences: 'message_clicked_preferences',
  webview: 'message_clicked_webview',
};

/**
 * Události ke zprávě. Podmínka na received_at je povinná: řadí se podle ts,
 * ale partition prořezává jen partiční klíč.
 *
 * Třídy bot, scanner a prefetch se do osy nedostanou vůbec (3.12.1).
 * Automatické stažení (proxy_apple) ano, ale označené jako 'machine'.
 */
export async function messageEventBranch(
  tx: Tx,
  ctx: WorkspaceContext,
  input: BranchInput,
): Promise<TimelineRow[]> {
  const before = input.before ?? null;
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT e.id,
           e.ts AS occurred_at,
           e.type,
           e.subtype,
           -- Který systémový odkaz to byl. Zapisuje ho recordSystemLinkClick
           -- a bez něj by proklik z patičky zůstal větou s prázdnou dírou.
           -- Zpětné apostrofy tu být nesmějí, ukončily by šablonu sql.
           e.metadata ->> 'system_link' AS system_link,
           e.campaign_id,
           c.name AS campaign_name,
           l.url  AS link_url,
           l.label AS link_label
      FROM message_events e
      JOIN campaigns c ON c.id = e.campaign_id AND c.workspace_id = e.workspace_id
      LEFT JOIN campaign_links l ON l.id = e.link_id AND l.workspace_id = e.workspace_id
     WHERE e.workspace_id = ${ctx.workspaceId}
       AND e.contact_id   = ${input.contactId}
       AND e.ts          >= ${input.window.from}
       AND e.ts           < ${input.window.to}
       AND e.received_at >= ${input.window.from}
       AND e.received_at  < ${input.window.messageReceivedTo}
       AND e.type = ANY(${sql.param([...TIMELINE_EVENT_TYPES])}::text[])
       AND (e.type <> 'open'  OR e.subtype IS NULL
            OR e.subtype <> ALL(${sql.param([...HIDDEN_OPEN_SUBTYPES])}::text[]))
       AND (e.type <> 'click' OR e.subtype IS NULL
            OR e.subtype <> ALL(${sql.param([...NON_HUMAN_CLICK_SUBTYPES])}::text[]))
       -- Porovnává se jako TEXT, ne jako uuid. Sloučený kurzor osy může nést
       -- klíč z větve kontaktu ve tvaru '<uuid>:sub' a přetypování takové
       -- hodnoty na uuid by skončilo chybou 22P02. U kanonického zápisu uuid
       -- se textové a bajtové uspořádání kryjí, takže se řazení nemění.
       -- Zpětné apostrofy v tomhle komentáři být nesmějí: ukončily by šablonu
       -- sql a soubor by se nepřeložil. Ověřeno spuštěním.
       AND (${before === null}::boolean
            OR (e.ts, e.id::text) < (${before?.occurredAt ?? null}::timestamptz, ${before?.id ?? null}::text))
     ORDER BY e.ts DESC, e.id DESC
     LIMIT ${input.limit}
  `);

  return rows.map((row) => {
    const subtype =
      row['subtype'] === null || row['subtype'] === undefined ? null : String(row['subtype']);
    const systemLink =
      row['system_link'] === null || row['system_link'] === undefined
        ? null
        : String(row['system_link']);
    const baseType = EVENT_TYPE_MAP[String(row['type'])] ?? String(row['type']);
    const type =
      baseType === 'message_clicked' && subtype === SYSTEM_CLICK_SUBTYPE && systemLink !== null
        ? (SYSTEM_LINK_TYPE_MAP[systemLink] ?? baseType)
        : baseType;
    /*
     * Spolehlivost se počítá z `baseType`, ne z `type`. Proklik na systémový
     * odkaz je pořád proklik, tedy potvrzená lidská akce: stránku odhlášení
     * ani předvoleb si poštovní klient sám neotevře. Kdyby se to vázalo na
     * `type`, systémový proklik by po přejmenování tiše přišel o označení
     * „potvrzeno" a v ose by vypadal míň jistě než obyčejné kliknutí.
     */
    const reliability =
      baseType === 'message_opened'
        ? subtype === 'proxy_apple'
          ? ('machine' as const)
          : ('confirmed' as const)
        : baseType === 'message_clicked'
          ? ('confirmed' as const)
          : null;
    const detail =
      subtype === null && row['link_url'] === null && systemLink === null
        ? null
        : {
            ...(subtype === null ? {} : { subtype }),
            ...(row['link_url'] ? { link_url: String(row['link_url']) } : {}),
            ...(systemLink === null ? {} : { system_link: systemLink }),
          };
    return {
      id: String(row['id']),
      occurredAt: new Date(row['occurred_at'] as string | Date),
      source: 'email',
      type,
      campaign: { id: String(row['campaign_id']), name: String(row['campaign_name']) },
      ...(reliability === null ? {} : { reliability }),
      ...(detail === null ? {} : { detail }),
      slots: {
        campaign: String(row['campaign_name']),
        link: row['link_label']
          ? String(row['link_label'])
          : row['link_url']
            ? String(row['link_url'])
            : '',
      },
    };
  });
}

/**
 * Webové události. Dvojice podmínek na occurred_at a received_at je povinná.
 *
 * UDÁLOSTI ZE ZDROJE `email` SE PŘESKAKUJÍ a je to oprava dvojité položky.
 * `process-engagement` zapisuje otevření a proklik e-mailu i do `web_events`
 * pod jmény `email_opened` a `email_clicked`, aby existovala jedna společná
 * osa. Jenže osu kontaktu skládají OBĚ větve, takže tentýž fakt v ní stál
 * dvakrát: jednou jako „Otevřel kampaň Test kampaň" z `message_events`
 * a hned pod tím jako „Událost email_opened", protože jméno webové události
 * je otevřený slovník a věta pro něj v katalogu není a být nemá.
 *
 * Druhá položka navíc LHALA O ZDROJI: větev webu razítkuje `source: 'web'`,
 * takže otevřený e-mail se choval jako návštěva webu a vyskočil pod filtrem
 * „Web". Naměřeno v prohlížeči na kontaktu, který na web nikdy nepřišel.
 *
 * Surový důkaz zůstává v `message_events` a čte ho `messageEventBranch`
 * s pořádnou větou, jménem kampaně i rodem. Zápis do `web_events` se nemění:
 * je to zdroj pro jiné čtenáře, ne pro tuhle osu.
 */
export async function webEventBranch(
  tx: Tx,
  ctx: WorkspaceContext,
  input: BranchInput,
): Promise<TimelineRow[]> {
  const before = input.before ?? null;
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT e.id, e.occurred_at, e.name, e.session_id, e.page, e.properties
      FROM web_events e
     WHERE e.workspace_id = ${ctx.workspaceId}
       AND e.contact_id   = ${input.contactId}
       AND e.source      <> 'email'
       AND e.occurred_at >= ${input.window.from}
       AND e.occurred_at  < ${input.window.to}
       AND e.received_at >= ${input.window.webReceivedFrom}
       AND e.received_at  < ${input.window.webReceivedTo}
       -- Text ze stejného důvodu jako u větve událostí zprávy.
       AND (${before === null}::boolean
            OR (e.occurred_at, e.id::text) < (${before?.occurredAt ?? null}::timestamptz, ${before?.id ?? null}::text))
     ORDER BY e.occurred_at DESC, e.id DESC
     LIMIT ${input.limit}
  `);

  return rows.map((row) => {
    const page = (row['page'] ?? {}) as { url?: string; title?: string };
    const properties = row['properties'] as Record<string, unknown> | null | undefined;
    return {
      id: String(row['id']),
      occurredAt: new Date(row['occurred_at'] as string | Date),
      source: 'web',
      type: String(row['name']),
      ...(row['session_id'] ? { sessionId: String(row['session_id']) } : {}),
      detail: {
        ...(page.url ? { page } : {}),
        ...(properties && Object.keys(properties).length > 0 ? { properties } : {}),
      },
      slots: { page: page.url ?? '', title: page.title ?? '', name: String(row['name']) },
    };
  });
}

/** Změny kontaktu: vznik, přihlášení a odhlášení ze seznamů, souhlasy. */
export async function contactBranch(
  tx: Tx,
  ctx: WorkspaceContext,
  input: BranchInput,
): Promise<TimelineRow[]> {
  const before = input.before ?? null;
  // `id` je TEXT, ne uuid. `list_subscriptions` žádné vlastní `id` nemá, jeho
  // klíč je (contact_id, list_id), takže přihlášení i odhlášení téhož seznamu
  // by dostaly stejnou identitu a kurzor `(occurred_at, id)` by na nich přeskočil
  // jednu z položek. Přípona je proto součástí klíče řádku.
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT * FROM (
      SELECT ct.id::text AS id, ct.created_at AS occurred_at, 'contact_created' AS type,
             ''::text AS list_name, ''::text AS purpose
        FROM contacts ct
       WHERE ct.workspace_id = ${ctx.workspaceId} AND ct.id = ${input.contactId}
      UNION ALL
      SELECT ls.list_id::text || ':sub', ls.subscribed_at, 'list_subscribed', l.name, ''
        FROM list_subscriptions ls
        JOIN lists l ON l.id = ls.list_id AND l.workspace_id = ls.workspace_id
       WHERE ls.workspace_id = ${ctx.workspaceId} AND ls.contact_id = ${input.contactId}
         AND ls.subscribed_at IS NOT NULL
      UNION ALL
      SELECT ls.list_id::text || ':unsub', ls.unsubscribed_at, 'list_unsubscribed', l.name, ''
        FROM list_subscriptions ls
        JOIN lists l ON l.id = ls.list_id AND l.workspace_id = ls.workspace_id
       WHERE ls.workspace_id = ${ctx.workspaceId} AND ls.contact_id = ${input.contactId}
         AND ls.unsubscribed_at IS NOT NULL
      UNION ALL
      SELECT co.id::text, co.occurred_at,
             CASE WHEN co.status = 'granted' THEN 'consent_granted' ELSE 'consent_withdrawn' END,
             '', co.purpose
        FROM consents co
       WHERE co.workspace_id = ${ctx.workspaceId} AND co.contact_id = ${input.contactId}
    ) t
     WHERE t.occurred_at >= ${input.window.from}
       AND t.occurred_at  < ${input.window.to}
       AND (${before === null}::boolean
            OR (t.occurred_at, t.id) < (${before?.occurredAt ?? null}::timestamptz, ${before?.id ?? null}::text))
     ORDER BY t.occurred_at DESC, t.id DESC
     LIMIT ${input.limit}
  `);

  return rows.map((row) => ({
    id: String(row['id']),
    occurredAt: new Date(row['occurred_at'] as string | Date),
    source: String(row['type']).startsWith('consent_') ? 'consent' : 'contact',
    type: String(row['type']),
    ...(row['purpose'] ? { detail: { purpose: String(row['purpose']) } } : {}),
    slots: { list: String(row['list_name'] ?? ''), purpose: String(row['purpose'] ?? '') },
  }));
}

function sortAndCut(rows: TimelineRow[], input: BranchInput): TimelineRow[] {
  const before = input.before;
  return rows
    .filter((row) => {
      if (!before) return true;
      if (row.occurredAt.getTime() !== before.occurredAt.getTime()) {
        return row.occurredAt < before.occurredAt;
      }
      return row.id < before.id;
    })
    .sort((a, b) =>
      a.occurredAt.getTime() === b.occurredAt.getTime()
        ? b.id.localeCompare(a.id)
        : b.occurredAt.getTime() - a.occurredAt.getTime(),
    )
    .slice(0, input.limit);
}
