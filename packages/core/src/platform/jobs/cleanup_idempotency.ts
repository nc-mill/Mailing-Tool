import { sql } from 'drizzle-orm';
import { withoutContext } from '../../tx';

/** 4.4: retence 24 hodin. Tabulka jinak roste s počtem zápisových requestů. */
export async function handler(): Promise<number> {
  return withoutContext(async (tx) => {
    const { rows } = await tx.execute(sql`
      DELETE FROM idempotency_keys WHERE expires_at < now() RETURNING key
    `);
    return rows.length;
  });
}
