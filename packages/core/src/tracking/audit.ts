import { defineAuditActions } from '../audit/action';
import { writeAuditLog } from '../audit/write';
import { actorInfo } from '../identity/types';
import type { Tx, WorkspaceContext } from '../tx';

/**
 * Auditní akce vlastněné měřením webu.
 *
 * Každá doména si své názvy vlastní ve vlastním `audit.ts`, jednotnost napříč
 * doménami hlídá `audit/audit-actions.test.ts`. Sdílený union by byl soubor,
 * do kterého píše každý plán, tedy konflikt v každém merge (uzávěr S11).
 */
export const TrackingAuditActions = defineAuditActions(['tracking_key.created']);

export type RecordPublicKeyCreatedInput = {
  ctx: WorkspaceContext;
  /** Zmrazený text, ne odkaz: po smazání uživatele musí audit dál dávat smysl. */
  actorLabel: string;
  apiKeyId: string;
  name: string;
  scopes: readonly string[];
};

/**
 * Vznik veřejného měřicího klíče `ml_pub_` do auditu.
 *
 * PROČ VŮBEC. Veřejný klíč je údaj, kterým se do projektu ZAPISUJÍ DATA:
 * kdo ho má, posílá do měření události. Jeho vznik proto patří do auditu
 * úplně stejně jako vznik klíče k API (`api_key.created`), který tam byl
 * od začátku. Klíč navíc vzniká sám při prvním otevření obrazovky
 * Nastavení → Měření webu, tedy bez jediného kliknutí, takže bez záznamu
 * po něm nezůstane vůbec žádná stopa.
 *
 * CO SE ZAPISUJE A CO NE. Samotný klíč v metadatech NENÍ. `ml_pub_` a prefix
 * je celá jeho hodnota, takže zapsat prefix znamená zapsat klíč. K dohledání
 * stačí `target_id`, které je rovnou identifikátorem řádku v `api_keys`.
 *
 * POZOR NA JMÉNA POLÍ. Redakce v `audit/redact.ts` zakrývá každý klíč, jehož
 * jméno OBSAHUJE některý z citlivých řetězců, mezi nimi `api_key`. Pole se
 * proto jmenuje `key_id`, ne `api_key_id`: to druhé by v auditu skončilo jako
 * `[redacted]` a záznam by ztratil právě to, kvůli čemu vzniká.
 */
export async function recordPublicKeyCreated(
  tx: Tx,
  input: RecordPublicKeyCreatedInput,
): Promise<void> {
  await writeAuditLog(tx, {
    action: TrackingAuditActions['tracking_key.created'],
    workspaceId: input.ctx.workspaceId,
    actor: actorInfo(input.ctx.actor, input.actorLabel),
    targetType: 'api_key',
    targetId: input.apiKeyId,
    metadata: {
      key_id: input.apiKeyId,
      name: input.name,
      kind: 'public',
      scopes: [...input.scopes],
    },
  });
}
