import { sql } from 'drizzle-orm';
import { loadConfig } from '../../config/index';
import type { Tx } from '../../tx';
import { CONTACTS_QUEUES, type ContactsQueue } from '../queues';

/**
 * Zařazení jobu VE STEJNÉ TRANSAKCI jako doménová změna.
 *
 * ODCHYLKA OD PLÁNU, VYNUCENÁ REPOZITÁŘEM. Plán volal `enqueue(tx, name, payload)` jako
 * hotový symbol z cizího plánu. Žádný takový v produktu není: P01 vlastní registr front
 * (`packages/core/src/queues/registry.ts`) a `apps/worker` drží instanci pg-boss, ale
 * transakční zařazení nikdo nevystavuje. Volat `boss.send()` mimo transakci není náhrada:
 * job by přežil rollback doménové změny a odstranil by klíč z attributes u pole, jehož
 * smazání se nakonec nepovedlo.
 *
 * Zapisuje se proto přímo do tabulky `job` ve schématu pg-boss, což je jeho zveřejněný
 * způsob transakčního vkládání. Konfigurace fronty (retry, expirace) se bere z registru
 * téhle domény, aby se nespoléhalo na výchozí hodnoty tabulky.
 *
 * `dead_letter` se ZÁMĚRNĚ nevyplňuje: sloupec má cizí klíč na `queue.name`, takže
 * hodnota `<fronta>.dlq` by zápis shodila všude, kde dead letter frontu nikdo nezaložil.
 * Přiřazení dead letter fronty patří k založení fronty, tedy do workeru.
 */
export type EnqueueOptions = {
  /** Jeden běh nad jedním klíčem. U front per projekt se předává workspaceId. */
  singletonKey?: string;
  /** Odložený start. Používá se u úklidových jobů. */
  startAfterSeconds?: number;
};

let cachedSchema: string | null = null;

function pgbossSchema(): string {
  // Konfigurace se čte líně a jednou. Import modulu nesmí vyžadovat kompletní prostředí,
  // jinak by se doména nedala naimportovat v jednotkovém testu.
  cachedSchema ??= loadConfig().PGBOSS_SCHEMA;
  return cachedSchema;
}

/** Jen pro testy: zapomene načtenou konfiguraci, aby šlo přepnout prostředí. */
export function resetEnqueueConfig(): void {
  cachedSchema = null;
}

export async function enqueue(
  tx: Tx,
  name: ContactsQueue | string,
  payload: Record<string, unknown>,
  options: EnqueueOptions = {},
): Promise<void> {
  const known = (
    CONTACTS_QUEUES as Record<
      string,
      { retryLimit: number; retryBackoff: boolean; expireInSeconds: number }
    >
  )[name];
  const retryLimit = known?.retryLimit ?? 3;
  const retryBackoff = known?.retryBackoff ?? true;
  const expireInSeconds = known?.expireInSeconds ?? 900;
  const startAfter = options.startAfterSeconds ?? 0;

  await tx.execute(sql`
    INSERT INTO ${sql.identifier(pgbossSchema())}.job
      (name, data, singleton_key, retry_limit, retry_backoff, expire_seconds, start_after)
    VALUES (
      ${name},
      ${JSON.stringify(payload)}::jsonb,
      ${options.singletonKey ?? null},
      ${retryLimit},
      ${retryBackoff},
      ${expireInSeconds},
      now() + make_interval(secs => ${startAfter})
    )
  `);
}
