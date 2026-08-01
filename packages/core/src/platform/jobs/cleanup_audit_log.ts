import { sql } from 'drizzle-orm';
import { loadConfig } from '../../config';
import { withoutContext } from '../../tx';

/**
 * ODCHYLKA OD PLÁNU: tenhle modul plán nevyjmenoval, ale registr front ho žádá.
 * `platform.cleanup_audit_log` má v `packages/core/src/queues/registry.ts`
 * vlastníka P04 a test konvenčních cest z úkolu 43 padá na každé frontě
 * platformy bez modulu. Fronta bez handleru je fronta, do které se zapisuje
 * a nikdo z ní nečte, takže mlčky vynechat ji je horší varianta.
 *
 * 3.7 a 4.9: retence se řídí `AUDIT_RETENTION_MONTHS`, výchozí hodnota 24.
 * Maže se BEZ kontextu, protože audit má i globální řádky (workspace_id NULL)
 * a ty by pod projektovým kontextem RLS schovala.
 */
export async function handler(): Promise<number> {
  const months = loadConfig().AUDIT_RETENTION_MONTHS;
  return withoutContext(async (tx) => {
    const { rows } = await tx.execute(sql`
      DELETE FROM audit_log
       WHERE created_at < now() - interval '${sql.raw(String(months))} months'
       RETURNING id
    `);
    return rows.length;
  });
}
