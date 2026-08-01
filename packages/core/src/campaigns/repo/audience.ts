import { pgErrorCode, withReadOnly, type WorkspaceContext } from '../../tx';
import { AUDIENCE_ESTIMATE_TIMEOUT_MS, AUDIENCE_PREVIEW_TIMEOUT_MS } from '../constants';
import { rawSql } from './raw-sql';

/**
 * Presny pocet publika se stropem doby behu, s odhadem jako zachrannou siti.
 *
 * Tri veci tady jsou opravou tri samostatnych vad predchozi podoby a kazda z nich je
 * overena spustenim.
 *
 * 1. **`withReadOnly`, ne `withWorkspace`.** `where.sql` je text, ktery vyrobil
 *    kompilator segmentu, tedy cizi kod. P04 navrhl `withReadOnly` (`BEGIN READ ONLY`
 *    plus `statement_timeout`) presne pro tenhle pripad, aby chyba v kompilatoru nemela
 *    jak zapsat. Predchozi podoba to nahradila zapisovatelnou transakci a rucnim
 *    `SET LOCAL`, tedy slabsi variantou obojiho.
 * 2. **SQLSTATE pres `pgErrorCode`.** Podminka `(err as {code}).code !== '57014'` je
 *    pres Drizzle VZDY pravdiva, protoze `err.code` je `undefined`. Odhad se tedy
 *    nikdy nespocital a uzivatel misto priblizneho cisla dostal chybu.
 * 3. **`EXPLAIN` v NOVE transakci.** Po `query_canceled` je puvodni transakce ve stavu
 *    aborted a jakykoliv dalsi prikaz v ni skonci chybou 25P02.
 *
 * ODCHYLKA OD PLÁNU: plán volal `withReadOnly(ctx, timeoutMs, fn)`. Adaptér v repozitáři
 * bere druhým parametrem OBJEKT `ReadOnlyOptions` (`{ statementTimeoutMs, workMem? }`),
 * protože náhled segmentu v P11 potřebuje předat i `work_mem`. Číslo by se do něj
 * nedostalo a strop by se nenastavil vůbec.
 */
export async function countWithTimeout(
  ctx: WorkspaceContext,
  where: { sql: string; params: unknown[] },
  timeoutMs: number,
): Promise<{ count: number; exact: boolean }> {
  const text = `SELECT count(*)::int AS n FROM contacts c WHERE c.workspace_id = $1 AND (${where.sql})`;
  const params = [ctx.workspaceId, ...where.params];

  try {
    return await withReadOnly(ctx, { statementTimeoutMs: timeoutMs }, async (tx) => {
      const r = await tx.execute<{ n: number }>(rawSql(text, params));
      return { count: r.rows[0]?.n ?? 0, exact: true };
    });
  } catch (err) {
    if (pgErrorCode(err) !== '57014') throw err; // query_canceled
  }

  // Samostatna transakce: ta predchozi je po timeoutu aborted. A VLASTNI strop:
  // s prevzatym stropem presneho poctu vyprsi i EXPLAIN a uzivatel misto slibeneho
  // odhadu dostane chybu. Overeno spustenim, viz AUDIENCE_ESTIMATE_TIMEOUT_MS.
  const estimateTimeoutMs = Math.max(timeoutMs, AUDIENCE_ESTIMATE_TIMEOUT_MS);
  return withReadOnly(ctx, { statementTimeoutMs: estimateTimeoutMs }, async (tx) => {
    const plan = await tx.execute<{ 'QUERY PLAN': unknown }>(
      rawSql(`EXPLAIN (FORMAT JSON) ${text}`, params),
    );
    return { count: estimateFromPlan(plan.rows[0]?.['QUERY PLAN']), exact: false };
  });
}

function estimateFromPlan(plan: unknown): number {
  const node = (plan as Array<{ Plan?: { 'Plan Rows'?: number } }> | undefined)?.[0]?.Plan;
  return Math.max(0, Math.round(node?.['Plan Rows'] ?? 0));
}

/** Take dynamicky slozene SQL, tedy take jen pro cteni a se stropem doby behu. */
export async function sampleAudience(
  ctx: WorkspaceContext,
  where: { sql: string; params: unknown[] },
  limit: number,
  timeoutMs: number = AUDIENCE_PREVIEW_TIMEOUT_MS,
): Promise<Array<{ contact_id: string; email: string; first_name: string | null }>> {
  return withReadOnly(ctx, { statementTimeoutMs: timeoutMs }, async (tx) => {
    const r = await tx.execute<{ contact_id: string; email: string; first_name: string | null }>(
      rawSql(
        `SELECT c.id AS contact_id, c.email, c.first_name
           FROM contacts c
          WHERE c.workspace_id = $1 AND (${where.sql})
          ORDER BY c.id
          LIMIT ${Number(limit)}`,
        [ctx.workspaceId, ...where.params],
      ),
    );
    return r.rows;
  });
}
