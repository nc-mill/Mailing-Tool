import type { EngagementMetric, Operator } from '../ast';
import type { ParamBag } from './params';
import { assertAlias } from './columns';

export type SegmentWarning = 'segment_slow_engagement' | 'segment_unindexed_field';

export type CompiledPredicate = { sql: string; warnings: SegmentWarning[] };

export type EngagementField = {
  metric: EngagementMetric;
  scope: {
    campaign_id?: string | undefined;
    since_days?: number | undefined;
    last_n_campaigns?: number | undefined;
  };
};

/** Rollup contact_engagement vlastní část 5. Předpočítaná okna jsou jen tahle tři. */
const ROLLUP_WINDOWS = [7, 30, 90] as const;

/**
 * Jména sloupců jsou z P03, ne z návrhu. Pozor na dvě odchylky, na které se dá
 * naletět: čítače končí na `_total`, ne `_count`, a u otevření a prokliků je to
 * podstatné jméno v množném čísle (`opens_total`, `clicks_total`), ne příčestí
 * (`opened_count`). Časová razítka naopak příčestí mají (`last_open_at`).
 */
const ROLLUP_LAST_AT: Record<EngagementMetric, string> = {
  sent: 'last_sent_at',
  delivered: 'last_delivered_at',
  opened: 'last_open_at',
  clicked: 'last_click_at',
  bounced: 'last_bounce_at',
};

const ROLLUP_COUNT: Record<EngagementMetric, string> = {
  sent: 'sent_total',
  delivered: 'delivered_total',
  opened: 'opens_total',
  clicked: 'clicks_total',
  bounced: 'bounces_total',
};

/**
 * Okna existují jen pro tři metriky: P03 má sent7d/30d/90d, opens*, clicks*.
 * Pro delivered a bounced okenní sloupce NEJSOU, takže tam okno znamená pomalou větev.
 */
const ROLLUP_WINDOW_COUNT: Partial<Record<EngagementMetric, (days: number) => string>> = {
  sent: (d) => `sent${d}d`,
  opened: (d) => `opens${d}d`,
  clicked: (d) => `clicks${d}d`,
};

/**
 * Jedna metrika může odpovídat víc typům události. Měkký odraz je pořád odraz:
 * kdyby tu byl jen `bounced_hard`, dal by segment jiné číslo než rollup
 * `bounces_total`, který počítá obojí, a tentýž dotaz by přes náhled a přes
 * rollup vyšel jinak.
 */
const EVENT_TYPES: Record<Exclude<EngagementMetric, 'sent'>, readonly string[]> = {
  delivered: ['delivered'],
  opened: ['open'],
  clicked: ['click'],
  bounced: ['bounced_hard', 'bounced_soft'],
};

function typePredicate(metric: Exclude<EngagementMetric, 'sent'>, bag: ParamBag): string {
  const types = EVENT_TYPES[metric];
  return types.length === 1
    ? `me.type = ${bag.add(types[0])}`
    : `me.type = ANY(${bag.add([...types], 'text[]')})`;
}

function usesRollup(field: EngagementField): boolean {
  const { campaign_id, since_days, last_n_campaigns } = field.scope;
  if (campaign_id !== undefined || last_n_campaigns !== undefined) return false;
  if (since_days === undefined) return true;
  return (ROLLUP_WINDOWS as readonly number[]).includes(since_days);
}

function rollupExists(alias: string, field: EngagementField, bag: ParamBag): string {
  const asOf = bag.ref(2, 'timestamptz');
  const days = field.scope.since_days;
  const col = ROLLUP_LAST_AT[field.metric];
  const window =
    days === undefined ? '' : ` AND ce.${col} >= ${asOf} - make_interval(days => ${bag.add(days)})`;
  // workspace_id je v poddotazu explicitně, i když ho RLS doplní: PK je
  // (workspace_id, contact_id) v tomhle pořadí, takže bez něj se index nevyužije,
  // a hlavně je to jediné místo kompilátoru, kde by se na RLS spoléhalo místo
  // vlastní podmínky. Ostatní poddotazy workspace_id uvádějí taky.
  return (
    `EXISTS (SELECT 1 FROM contact_engagement ce` +
    ` WHERE ce.workspace_id = ${alias}.workspace_id AND ce.contact_id = ${alias}.id` +
    ` AND ce.${col} IS NOT NULL${window})`
  );
}

/**
 * Pomalá větev jde na partitionované tabulky, takže KAŽDÁ musí nést podmínku na
 * svůj partiční klíč, jinak plánovač neprořeže nic a projde všechny měsíční oddíly.
 * Partiční klíče jsou: `messages` podle `created_at`, `message_events` podle
 * `received_at`, `web_events` podle `received_at`.
 *
 * U `message_events` je to zrádné: `me.ts` je čas události od providera, kdežto
 * partitionuje se podle `me.received_at`, tedy podle času přijetí. Podmínka na `ts`
 * sama o sobě neprořeže nic. Obě podmínky tam proto jsou: `ts` drží význam
 * („kdy se to stalo"), `received_at` drží výkon. Spodní mez u `received_at` je
 * o den volnější, aby zpožděně přijatá událost nevypadla z výsledku.
 */
const LATE_ARRIVAL_DAYS = 1;

function slowExists(alias: string, field: EngagementField, bag: ParamBag): string {
  const asOf = bag.ref(2, 'timestamptz');
  const parts: string[] = [];
  if (field.metric === 'sent') {
    parts.push(
      `SELECT 1 FROM messages m WHERE m.contact_id = ${alias}.id AND m.workspace_id = ${alias}.workspace_id`,
    );
    if (field.scope.campaign_id !== undefined) {
      parts.push(`AND m.campaign_id = ${bag.add(field.scope.campaign_id, 'uuid')}`);
    }
    if (field.scope.since_days !== undefined) {
      parts.push(
        `AND m.created_at >= ${asOf} - make_interval(days => ${bag.add(field.scope.since_days)})`,
        `AND m.created_at <= ${asOf}`,
      );
    }
    if (field.scope.last_n_campaigns !== undefined) {
      parts.push(
        `AND m.campaign_id IN (SELECT id FROM campaigns WHERE workspace_id = ${alias}.workspace_id`,
        `AND status = ANY(${bag.add(['sent', 'partially_sent'], 'text[]')})`,
        `AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT ${bag.add(field.scope.last_n_campaigns)})`,
      );
    }
  } else {
    parts.push(
      `SELECT 1 FROM message_events me WHERE me.contact_id = ${alias}.id AND me.workspace_id = ${alias}.workspace_id`,
      `AND ${typePredicate(field.metric, bag)}`,
    );
    if (field.scope.campaign_id !== undefined) {
      parts.push(`AND me.campaign_id = ${bag.add(field.scope.campaign_id, 'uuid')}`);
    }
    if (field.scope.since_days !== undefined) {
      const days = bag.add(field.scope.since_days);
      parts.push(
        `AND me.ts >= ${asOf} - make_interval(days => ${days})`,
        `AND me.received_at >= ${asOf} - make_interval(days => ${days}) - make_interval(days => ${bag.add(LATE_ARRIVAL_DAYS)})`,
        `AND me.received_at <= ${asOf}`,
      );
    }
    if (field.scope.last_n_campaigns !== undefined) {
      // campaigns.sent_at NEEXISTUJE. Odeslanost se pozná ze stavu a času dokončení,
      // a slovník ck_campaigns__status mezi 'sent' a 'partially_sent' rozlišuje.
      parts.push(
        `AND me.campaign_id IN (SELECT id FROM campaigns WHERE workspace_id = ${alias}.workspace_id`,
        `AND status = ANY(${bag.add(['sent', 'partially_sent'], 'text[]')})`,
        `AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT ${bag.add(field.scope.last_n_campaigns)})`,
      );
    }
  }
  return `EXISTS (${parts.join(' ')})`;
}

function countExpr(
  alias: string,
  field: EngagementField,
  bag: ParamBag,
): { sql: string; slow: boolean } {
  const days = field.scope.since_days;
  const scoped =
    field.scope.campaign_id === undefined && field.scope.last_n_campaigns === undefined;

  if (scoped && days === undefined) {
    return {
      sql:
        `(SELECT coalesce(ce.${ROLLUP_COUNT[field.metric]}, 0) FROM contact_engagement ce` +
        ` WHERE ce.workspace_id = ${alias}.workspace_id AND ce.contact_id = ${alias}.id)`,
      slow: false,
    };
  }
  // Předpočítané okno je právě to, kvůli čemu si tenhle plán rollup vyžádal.
  // Bez téhle větve by okenní sloupce v P03 nikdo nečetl a každý
  // "otevřel aspoň třikrát za 30 dní" by šel přes desítky milionů řádků.
  if (scoped && days !== undefined && (ROLLUP_WINDOWS as readonly number[]).includes(days)) {
    const column = ROLLUP_WINDOW_COUNT[field.metric]?.(days);
    if (column !== undefined) {
      return {
        sql:
          `(SELECT coalesce(ce.${column}, 0) FROM contact_engagement ce` +
          ` WHERE ce.workspace_id = ${alias}.workspace_id AND ce.contact_id = ${alias}.id)`,
        slow: false,
      };
    }
  }
  if (field.metric === 'sent') {
    const scopeSql = [
      field.scope.campaign_id === undefined
        ? ''
        : ` AND m.campaign_id = ${bag.add(field.scope.campaign_id, 'uuid')}`,
      days === undefined
        ? ''
        : ` AND m.created_at >= ${bag.ref(2, 'timestamptz')} - make_interval(days => ${bag.add(days)})` +
          ` AND m.created_at <= ${bag.ref(2, 'timestamptz')}`,
      field.scope.last_n_campaigns === undefined
        ? ''
        : ` AND m.campaign_id IN (SELECT id FROM campaigns WHERE workspace_id = ${alias}.workspace_id` +
          ` AND status = ANY(${bag.add(['sent', 'partially_sent'], 'text[]')})` +
          ` AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT ${bag.add(field.scope.last_n_campaigns)})`,
    ].join('');
    return {
      sql:
        `(SELECT count(*) FROM messages m WHERE m.contact_id = ${alias}.id` +
        ` AND m.workspace_id = ${alias}.workspace_id${scopeSql})`,
      slow: true,
    };
  }
  const scopeSql = [
    field.scope.campaign_id === undefined
      ? ''
      : ` AND me.campaign_id = ${bag.add(field.scope.campaign_id, 'uuid')}`,
    days === undefined
      ? ''
      : ` AND me.received_at >= ${bag.ref(2, 'timestamptz')} - make_interval(days => ${bag.add(days)})` +
        ` - make_interval(days => ${bag.add(LATE_ARRIVAL_DAYS)}) AND me.received_at <= ${bag.ref(2, 'timestamptz')}`,
    field.scope.last_n_campaigns === undefined
      ? ''
      : ` AND me.campaign_id IN (SELECT id FROM campaigns WHERE workspace_id = ${alias}.workspace_id` +
        ` AND status = ANY(${bag.add(['sent', 'partially_sent'], 'text[]')})` +
        ` AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT ${bag.add(field.scope.last_n_campaigns)})`,
  ].join('');
  return {
    sql:
      `(SELECT count(*) FROM message_events me WHERE me.contact_id = ${alias}.id` +
      ` AND me.workspace_id = ${alias}.workspace_id AND ${typePredicate(field.metric, bag)}${scopeSql})`,
    slow: true,
  };
}

export function compileEngagementCondition(
  alias: string,
  field: EngagementField,
  operator: Operator,
  node: { value?: unknown },
  bag: ParamBag,
): CompiledPredicate {
  assertAlias(alias);
  if (operator === 'count_gte' || operator === 'count_lte') {
    const { sql, slow } = countExpr(alias, field, bag);
    const cmp = operator === 'count_gte' ? '>=' : '<=';
    return {
      sql: `(${sql} ${cmp} ${bag.add(node.value)})`,
      warnings: slow ? ['segment_slow_engagement'] : [],
    };
  }
  const rollup = usesRollup(field);
  const exists = rollup ? rollupExists(alias, field, bag) : slowExists(alias, field, bag);
  const warnings: SegmentWarning[] = rollup ? [] : ['segment_slow_engagement'];
  if (operator === 'did') return { sql: `(${exists})`, warnings };
  // `did_not` je DOSLOVNÁ negace `did`, ne jinak napsaný poddotaz. Dvě různě
  // napsané větve téhož predikátu se rozejdou při první úpravě a rozdíl se
  // projeví jako kontakt, který není ani v segmentu, ani v jeho doplňku.
  if (operator === 'did_not') return { sql: `(NOT (${exists}))`, warnings };
  throw new Error(`operator ${operator} is not valid for engagement`);
}

/**
 * `web_events` je partitionovaná podle `received_at` a měsíčních oddílů jsou
 * desítky. Dotaz bez podmínky na `received_at` projde všechny, což je u
 * `SEGMENT_PREVIEW_TIMEOUT_MS` jistý `57014` a náhled spadne do odhadu
 * z `EXPLAIN`. Uživatel by pak u dotazu „udělal událost purchase" dostal
 * „přibližně", ačkoli při prořezání je odpověď přesná.
 *
 * Obojí je proto povinné a ani jedno nejde vynechat:
 *
 *  1. Horní i dolní mez na `received_at`. Bez `since_days` platí výchozí okno,
 *     protože „někdy za celou historii" je u chování na webu otázka, kterou
 *     nikdo doopravdy neklade, a cena za ni je sken všech oddílů.
 *  2. Předvýběr přes `web_event_months`. Je to řídká mapa „v kterých měsících
 *     má tenhle subjekt vůbec nějaká data", kterou P03 zavedl přesně pro tenhle
 *     tvar dotazu. Kontakt, který na webu nikdy nebyl, se tím vyřídí jedním
 *     přístupem do indexu místo dotazu do každého oddílu.
 */
const EVENT_DEFAULT_WINDOW_DAYS = 365;

function webEventScope(alias: string, sinceDays: number | undefined, bag: ParamBag): string {
  const asOf = bag.ref(2, 'timestamptz');
  const days = bag.add(sinceDays ?? EVENT_DEFAULT_WINDOW_DAYS);
  return (
    ` AND we.received_at >= ${asOf} - make_interval(days => ${days})` +
    ` AND we.received_at <= ${asOf}` +
    ` AND EXISTS (SELECT 1 FROM web_event_months wm` +
    ` WHERE wm.workspace_id = ${alias}.workspace_id AND wm.subject_kind = 'contact'` +
    ` AND wm.subject_id = ${alias}.id` +
    ` AND wm.month >= date_trunc('month', ${asOf} - make_interval(days => ${days}))::date` +
    ` AND wm.month <= date_trunc('month', ${asOf})::date)`
  );
}

export function compileEventCondition(
  alias: string,
  field: { name: string; property?: string | undefined; since_days?: number | undefined },
  operator: Operator,
  node: { value?: unknown },
  bag: ParamBag,
): CompiledPredicate {
  assertAlias(alias);
  const name = bag.add(field.name);
  const base =
    `SELECT 1 FROM web_events we WHERE we.contact_id = ${alias}.id` +
    ` AND we.workspace_id = ${alias}.workspace_id AND we.name = ${name}` +
    webEventScope(alias, field.since_days, bag);
  switch (operator) {
    case 'did':
      return { sql: `(EXISTS (${base}))`, warnings: ['segment_slow_engagement'] };
    case 'did_not':
      return { sql: `(NOT EXISTS (${base}))`, warnings: ['segment_slow_engagement'] };
    case 'count_gte':
    case 'count_lte': {
      const cmp = operator === 'count_gte' ? '>=' : '<=';
      const count =
        `(SELECT count(*) FROM web_events we WHERE we.contact_id = ${alias}.id` +
        ` AND we.workspace_id = ${alias}.workspace_id AND we.name = ${name}` +
        webEventScope(alias, field.since_days, bag) +
        `)`;
      return {
        sql: `(${count} ${cmp} ${bag.add(node.value)})`,
        warnings: ['segment_slow_engagement'],
      };
    }
    default:
      throw new Error(`operator ${operator} is not valid for events`);
  }
}
