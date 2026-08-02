import { suppressedExistsSql } from '../contacts/suppression/predicate';
import type { WorkspaceContext } from '../identity/types';
import { compileAudienceToSql, type Audience } from './repo';
import { toSql } from './compile/params';
import { runReadOnly } from './sql-runner';

export type GateKey =
  | 'suppressed'
  | 'unsubscribed'
  | 'unconfirmed'
  | 'snoozed'
  | 'processing_restricted'
  | 'duplicate'
  | 'sample';

export type AudienceBreakdown = {
  input: number;
  gates: { key: GateKey; count: number }[];
  willSend: number;
};

/**
 * Pořadí bran odpovídá pořadí vyhodnocení, ne abecedě. Je to jediné pořadí,
 * ve kterém dává součet smysl, protože jeden kontakt může padnout na víc bran
 * a započítá se u té první.
 */
const GATE_SQL: Record<GateKey, string> = {
  // Predikát se tu neopisuje, skládá ho jediné místo, kde existuje.
  suppressed: suppressedExistsSql('b'),
  // 'bounced' patří sem taky. Kontakt s tvrdým odrazem má stav 'bounced' a bez
  // něj by prošel touhle bránou a spadl až na 'suppressed', což je správně JEN
  // tehdy, když suppression řádek opravdu existuje. Spoléhat na to znamená
  // spoléhat na cizí zápis v místě, kde se rozhoduje, komu odejde pošta.
  unsubscribed: `b.status IN ('unsubscribed', 'complained', 'bounced')`,
  unconfirmed: `NOT EXISTS (SELECT 1 FROM list_subscriptions ls
                  WHERE ls.workspace_id = b.workspace_id AND ls.contact_id = b.id AND ls.status = 'confirmed')`,
  snoozed: `EXISTS (SELECT 1 FROM list_subscriptions ls
              WHERE ls.workspace_id = b.workspace_id AND ls.contact_id = b.id
                AND ls.snooze_until > $2::timestamptz)`,
  processing_restricted: `b.processing_restricted = true`,
  // Obě brány jsou natvrdo false a je to VĚDOMÉ, ne nedodělek.
  //
  // `duplicate`: unikátní index uq_contacts__workspace_email duplicitu na úrovni
  // kontaktu vylučuje, takže brána nemá co odebrat.
  //
  // `sample`: sloupec contacts.is_sample ve schématu NENÍ a založit ho tenhle
  // plán nesmí. Kdyby tu zůstalo `b.is_sample = true`, nespadla by jen tahle
  // jedna brána: GATE_SQL se skládá do JEDNOHO dotazu se sedmi count(*) FILTER,
  // takže by celý rozpad publika skončil na 42703 a obrazovka by nezobrazila nic.
  // Řádek zůstává v pořadí i v UI, aby rozpad odpovídal seznamu ze specifikace
  // a aby se sem dala hodnota doplnit jedním řádkem, až sloupec vznikne.
  duplicate: `false`,
  sample: `false`,
};

/** Brány, které dnes nemají čím měřit. Test je drží na nule, aby se na ně nezapomnělo. */
export const INERT_GATES: readonly GateKey[] = ['duplicate', 'sample'];

const GATE_ORDER: GateKey[] = [
  'suppressed',
  'unsubscribed',
  'unconfirmed',
  'snoozed',
  'processing_restricted',
  'duplicate',
  'sample',
];

export async function audienceBreakdown(
  ctx: WorkspaceContext,
  audience: Audience,
  opts: { asOf: Date; timezone: string },
): Promise<AudienceBreakdown> {
  // Vstupní množina je segment BEZ dvou podmínek obálky, aby šlo ukázat, kolik
  // jich brána odebrala. Odstraňují se JEN `processing_restricted` a suppression,
  // protože právě ty mají v rozpadu vlastní řádek. Podmínky `deleted_at`,
  // `anonymized_at` a `status <> 'deleted'` zůstávají: smazaný ani vymazaný
  // člověk není „odebraný bránou", ten do publika nepatří vůbec.
  const compiled = await compileAudienceToSql(ctx, audience, {
    alias: 'a',
    paramOffset: 0,
    asOf: opts.asOf,
    timezone: opts.timezone,
  });
  const raw = compiled.sql
    .replace(/\n\s*AND a\.processing_restricted = false/, '')
    .replace(/\n\s*AND NOT EXISTS \([\s\S]*?email_fingerprints\)\)\)/, '');

  const buckets = GATE_ORDER.map((key, index) => {
    const earlier = GATE_ORDER.slice(0, index).map((k) => `NOT (${GATE_SQL[k]})`);
    const predicate = [...earlier, GATE_SQL[key]].join(' AND ');
    return `count(*) FILTER (WHERE ${predicate})::int AS ${key}`;
  });
  const passes = GATE_ORDER.map((k) => `NOT (${GATE_SQL[k]})`).join(' AND ');

  const text =
    `SELECT count(*)::int AS input, ${buckets.join(', ')}, count(*) FILTER (WHERE ${passes})::int AS will_send\n` +
    `  FROM contacts b\n WHERE b.id IN (${raw})`;

  const { rows } = await runReadOnly(
    ctx,
    (tx) => tx.execute<Record<string, number>>(toSql(text, compiled.params)),
    { timeoutMs: 10_000 },
  );
  const row = rows[0] ?? {};
  return {
    input: Number(row['input'] ?? 0),
    gates: GATE_ORDER.map((key) => ({ key, count: Number(row[key] ?? 0) })),
    willSend: Number(row['will_send'] ?? 0),
  };
}
