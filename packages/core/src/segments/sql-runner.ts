import { loadConfig } from '../config/index';
import { ApiError } from '../errors/api-error';
import type { WorkspaceContext } from '../identity/types';
import { pgErrorCode, withReadOnly, type Tx } from '../tx';
import { toSql } from './compile/params';

export type RunOptions = { timeoutMs?: number; workMem?: string };

let previewTimeoutMs: number | null = null;

/** Konfigurace se čte líně a jednou, aby import modulu nevyžadoval prostředí. */
function defaultTimeoutMs(): number {
  previewTimeoutMs ??= loadConfig().SEGMENT_PREVIEW_TIMEOUT_MS;
  return previewTimeoutMs;
}

/** Jen pro testy: zapomene načtenou konfiguraci, aby šlo přepnout prostředí. */
export function resetSegmentRunnerConfig(): void {
  previewTimeoutMs = null;
}

/**
 * Náhled segmentu spouští dynamicky sestavené SQL, takže chyba v kompilátoru
 * nesmí mít možnost zapsat. Tahle funkce si to ale NEZAŘIZUJE SAMA: deleguje
 * na `withReadOnly` z adaptéru transakcí, který sedí nad primitivem P03.
 *
 * Proč ne vlastní implementace, ačkoli by byla o pět řádků delší:
 *
 *  - P03 už tu ochranu má, a má ji ve DVOU vrstvách: pool typu `readOnly`
 *    je založený s `-c default_transaction_read_only=on` a transakce se otevírá
 *    jako `BEGIN READ ONLY`. Zápis skončí `25006 read_only_sql_transaction`
 *    i kdyby jedna z vrstev selhala.
 *  - Objektový tvar `{ statementTimeoutMs, workMem }` přidalo P03 kvůli tomuhle
 *    plánu, takže `work_mem` je pokrytý.
 *  - Dvě verze téhož bezpečnostního primitiva se rozejdou při první úpravě.
 *
 * `SET LOCAL` se tady neposílá vůbec: dělá ho obálka a dělá ho ve správném
 * pořadí, tedy nejdřív timeout a work_mem, pak kontext projektu.
 */
export async function runReadOnly<T>(
  ctx: WorkspaceContext,
  fn: (tx: Tx) => Promise<T>,
  opts: RunOptions = {},
): Promise<T> {
  return withReadOnly(
    ctx,
    {
      statementTimeoutMs: opts.timeoutMs ?? defaultTimeoutMs(),
      workMem: opts.workMem ?? '32MB',
    },
    fn,
  );
}

export type CountResult = { count: number; exact: boolean; durationMs: number };

/**
 * Když count doběhne, vrátí přesné číslo. Když ho zabije statement_timeout
 * chybou 57014, přečte se odhad z plánu. Uživatel dostane „přibližně 12 000"
 * a tlačítko na přesný výpočet, nikdy chybu.
 *
 * Dvě věci, na kterých to celé stojí:
 *
 *  1. `tx.execute()` vrací OBÁLKU s `rows`, ne pole. Čtení `result[0]` je
 *     vždy `undefined`, takže by `count` vyšel jako 0 a každý segment by se
 *     tvářil jako prázdný.
 *  2. Kód chyby je na `error.cause.code`. Podmínka `error.code !== '57014'`
 *     je vždy pravdivá, takže by se odhad z EXPLAIN NIKDY nepoužil a náhled
 *     by u velkého projektu místo „přibližně 12 000" vracel chybu.
 */
export async function runCountWithEstimate(
  ctx: WorkspaceContext,
  text: string,
  params: unknown[],
  timeoutMs: number,
): Promise<CountResult> {
  const started = Date.now();
  try {
    const { rows } = await runReadOnly(
      ctx,
      (tx) => tx.execute<{ count: string | number }>(toSql(text, params)),
      { timeoutMs },
    );
    return { count: Number(rows[0]?.count ?? 0), exact: true, durationMs: Date.now() - started };
  } catch (error) {
    if (pgErrorCode(error) !== '57014') throw error;
  }
  const planText = `EXPLAIN (FORMAT JSON) ${text.replace(/^SELECT count\(\*\)(::int)? AS count/i, 'SELECT 1')}`;
  try {
    const { rows } = await runReadOnly(
      ctx,
      (tx) => tx.execute<{ 'QUERY PLAN': unknown }>(toSql(planText, params)),
      { timeoutMs: 2000 },
    );
    const plan = rows[0]?.['QUERY PLAN'];
    const parsed = typeof plan === 'string' ? (JSON.parse(plan) as unknown) : plan;
    const rowsEstimate = Number(
      (parsed as { Plan?: { 'Plan Rows'?: number } }[] | undefined)?.[0]?.Plan?.['Plan Rows'] ?? 0,
    );
    return { count: rowsEstimate, exact: false, durationMs: Date.now() - started };
  } catch {
    throw new ApiError('dependency_timeout', {
      params: { code: 'segment_preview_timeout', timeoutMs },
    });
  }
}
