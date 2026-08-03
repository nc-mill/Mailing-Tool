import { sql } from 'drizzle-orm';
import { loadConfig } from '../../config/index';
import { queue } from '../../queues';
import type { Tx } from '../../tx';

/**
 * Zařazení jobu VE STEJNÉ TRANSAKCI jako doménová změna.
 *
 * Doména značky potřebuje zařadit jedinou úlohu, `platform.webhook_fanout`,
 * a to hned vedle zápisu do `webhook_events`. Kdyby se zařadilo mimo transakci,
 * přežil by fan-out rollback zápisu a rozeslal by událost, která v tabulce
 * není. Kdyby se nezařadilo vůbec, událost by v tabulce ležela a nikdo by ji
 * nerozeslal: `fanoutEvent` volá výhradně ten job a ten se sám nezařadí.
 *
 * Zapisuje se přímo do tabulky `job` ve schématu pg-boss, což je jeho
 * zveřejněný způsob transakčního vkládání. Je to tentýž postup jako
 * `contacts/jobs/enqueue.ts`, jen se politika fronty bere ze SPOLEČNÉHO
 * registru P01, ne z výčtu jedné domény, takže se nemůže rozejít.
 *
 * `dead_letter` se ZÁMĚRNĚ nevyplňuje: sloupec má cizí klíč na `queue.name`,
 * takže hodnota `<fronta>.dlq` by zápis shodila všude, kde dead letter frontu
 * nikdo nezaložil. Přiřazení dead letter fronty patří k založení fronty.
 */
export async function enqueueBrandJob(
  tx: Tx,
  name: string,
  payload: Record<string, unknown>,
  options: { singletonKey?: string } = {},
): Promise<void> {
  const entry = queue(name);
  // Konfigurace se čte uvnitř funkce. Na úrovni modulu by `loadConfig()`
  // shodila každý jednotkový test, který se souboru jen dotkne.
  const schemaName = loadConfig().PGBOSS_SCHEMA;

  await tx.execute(sql`
    INSERT INTO ${sql.identifier(schemaName)}.job
      (name, data, singleton_key, retry_limit, retry_backoff, expire_seconds)
    VALUES (
      ${name},
      ${JSON.stringify(payload)}::jsonb,
      ${options.singletonKey ?? null},
      ${entry.retryLimit},
      ${entry.retryBackoff},
      ${entry.expireInSeconds}
    )
  `);
}
