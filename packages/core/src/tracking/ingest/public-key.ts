import { sql } from 'drizzle-orm';
import { TtlLru } from '../click/lru';
import { withCrossWorkspaceTx } from '../repo/tx';

/**
 * Ověření veřejného klíče `ml_pub_`, viz plán P10 Task 25.
 *
 * Větev P z 3.5 části 1: veřejný klíč se ukládá v OTEVŘENÉ podobě, takže se
 * neporovnávají žádné hashe a nedělá se dummy porovnání. Projekt se bere
 * z řádku klíče, nikdy z URL ani z těla požadavku. Vadný tvar se odmítne bez
 * jediného dotazu do databáze.
 *
 * Dotaz běží NAPŘÍČ PROJEKTY, protože v okamžiku ověření ještě nevíme, komu
 * klíč patří. Politika `api_key_lookup` na `api_keys` i `ws_api_key_lookup`
 * na `workspaces` tenhle přesný případ povolují: bez `mlain.workspace_id`
 * a bez `mlain.user_id` je vidět jen neodvolaný klíč a projekt, který nějaký
 * takový klíč má.
 */

const PUBLIC_KEY_PREFIX = 'ml_pub_';
const PUBLIC_KEY_BODY_RE = /^[a-z2-7]{16}$/;

export type PublicKeyOwner = { workspaceId: string; apiKeyId: string };

/**
 * Cache záporných i kladných odpovědí na minutu. Záporné se kešují schválně:
 * bez toho by stačilo bušit náhodným klíčem a každý požadavek by znamenal
 * dotaz do databáze. `TtlLru.get` vrací `undefined` při minutí, takže
 * nakešované `null` se od minutí pozná.
 */
let cache = new TtlLru<string, PublicKeyOwner | null>({ capacity: 5_000, ttlMs: 60_000 });

/**
 * Jen pro testy a pro obrazovku nastavení: po vytvoření prvního veřejného
 * klíče by jinak minutu platila nakešovaná záporná odpověď a uživatel by po
 * nasazení úryvku viděl „zatím nic nedorazilo", i když všechno funguje.
 */
export function resetPublicKeyCache(): void {
  cache = new TtlLru<string, PublicKeyOwner | null>({ capacity: 5_000, ttlMs: 60_000 });
}

export async function resolvePublicKey(key: string): Promise<PublicKeyOwner | null> {
  if (!key.startsWith(PUBLIC_KEY_PREFIX)) return null;
  const prefix = key.slice(PUBLIC_KEY_PREFIX.length);
  if (!PUBLIC_KEY_BODY_RE.test(prefix)) return null;

  return cache.getOrLoad(prefix, async () =>
    withCrossWorkspaceTx('tracking.public_key', async (tx) => {
      const { rows } = await tx.execute<PublicKeyOwner>(sql`
        SELECT k.workspace_id AS "workspaceId", k.id AS "apiKeyId"
          FROM api_keys k
          JOIN workspaces w ON w.id = k.workspace_id
         WHERE k.prefix = ${prefix}
           AND k.kind = 'public'
           AND k.revoked_at IS NULL
           AND (k.expires_at IS NULL OR k.expires_at > now())
           AND w.deleted_at IS NULL
      `);
      return rows[0] ?? null;
    }),
  );
}
