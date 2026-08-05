import { sql } from 'drizzle-orm';
import { withCrossWorkspaceTx } from '../repo/tx';
import { trackingLogger } from '../logging';

export const CLEANUP_TOKEN_USES_QUEUE = 'tracking.cleanup_token_uses';

/**
 * Úklid použitých nonců identitních tokenů (3.10.3 části 5).
 *
 * Tabulka `identity_token_uses` je jediná v celém schématu BEZ `workspace_id`
 * a bez RLS: nonce je osm bajtů z CSPRNG a projekt se z něj poznat nedá ani
 * nemá. Čte se proto přes `withCrossWorkspaceTx`, a je to jedno z těch pár
 * míst, kde je to správně, ne obcházení izolace.
 *
 * Bez tohohle úklidu tabulka roste o řádek za každý proklik na vlastní doménu
 * zákazníka a nikdy se nezmenší.
 */
export async function handleCleanupTokenUses(): Promise<void> {
  const removed = await withCrossWorkspaceTx(CLEANUP_TOKEN_USES_QUEUE, async (tx) => {
    const { rowCount } = await tx.execute(sql`
      DELETE FROM identity_token_uses WHERE expires_at < now()
    `);
    return rowCount ?? 0;
  });

  if (removed > 0) {
    trackingLogger().debug(
      { job: CLEANUP_TOKEN_USES_QUEUE, removed },
      'vypršelé nonce identitních tokenů smazány',
    );
  }
}
