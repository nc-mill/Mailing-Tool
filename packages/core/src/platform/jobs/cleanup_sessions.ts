import { sql } from 'drizzle-orm';
import { withoutContext } from '../../tx';

/**
 * 3.2: expirovaná ani revokovaná session se nemaže hned, protože výpis
 * "aktivní relace" má ukázat i to, kdy relace skončila. Maže je tenhle job
 * denně, starší než 30 dní od skončení.
 */
export async function handler(): Promise<number> {
  return withoutContext(async (tx) => {
    const { rows } = await tx.execute(sql`
      DELETE FROM sessions
       WHERE (revoked_at IS NOT NULL AND revoked_at < now() - interval '30 days')
          OR (absolute_expires_at < now() - interval '30 days')
       RETURNING id
    `);
    return rows.length;
  });
}
