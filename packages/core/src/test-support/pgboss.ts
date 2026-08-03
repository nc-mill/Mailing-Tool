import { createRequire } from 'node:module';
import { Client } from 'pg';
import { PgBoss } from 'pg-boss';
import { QUEUE_REGISTRY, dlqName } from '../queues';

/**
 * Verze knihovny se čte z jejího `package.json`, ne z konstanty v tomhle
 * souboru: konstanta by po povýšení závislosti zůstala stará a šablona by se
 * nepřestavěla, což je přesně ta tichá vada, které má otisk zabránit.
 */
const PGBOSS_VERSION = (
  createRequire(import.meta.url)('pg-boss/package.json') as { version: string }
).version;

/**
 * Schéma a fronty pg-bossu pro databázové testy. Dělá TOTÉŽ co `mlain migrate`.
 *
 * PROČ TO VŮBEC EXISTUJE. Migrace `0007_pgboss_schema.sql` zakládá jen SCHÉMA
 * a granty; TABULKY staví až `bootstrapQueueSchema` v `apps/cli/src/commands/
 * migrate.ts`, protože jejich tvar patří knihovně a mění se s její verzí.
 * Testovací šablona ale pouštěla jen SQL migrace, takže v ní `pgboss.job`
 * NEEXISTOVALA.
 *
 * Projevilo se to až na doménovém kódu, který zařazuje úlohy TRANSAKČNĚ, tedy
 * zápisem do `pgboss.job` uvnitř téže transakce jako doménová změna: uložení
 * nastavení projektu (změna vykání a tykání zařazuje přepočet oslovení) skončilo
 * v testu chybou 500 na „relation pgboss.job does not exist", zatímco ve vývojové
 * databázi, kde tabulka je, fungovalo. Testovací prostředí se tím lišilo od
 * produkčního přesně v tom místě, které rozhoduje, jestli se uložená změna
 * doopravdy celá provede.
 *
 * Řešení drží pravidlo z `migrate.ts`, že schéma vlastní jedině migrátor:
 * pg-boss si své tabulky postaví pod rolí migrátora a aplikační role na ně
 * dostane práva. `start()` je idempotentní, existující instalaci si pozná
 * a jen dopočítá, co chybí.
 *
 * VŠECHNY FRONTY Z REGISTRU, ne jen ty, na které si vzpomene jeden test.
 * Sloupec `job.name` má cizí klíč na `queue.name`, takže zařazení do nezaložené
 * fronty skončí chybou. Produkce zakládá při startu workeru celý registr
 * (`registerQueues`), takže je to i věcně totéž prostředí. Drahé to není:
 * `create_queue` je jeden INSERT s `ON CONFLICT DO NOTHING` a bez volby
 * `partition` sdílejí všechny fronty tabulku `job_common`.
 */
/**
 * Otisk toho, CO tenhle modul do šablony nainstaluje.
 *
 * Vstupuje do jména šablony (`templateDatabase()`), protože kontejner přežívá
 * mezi běhy a šablona se staví jen jednou. Bez otisku by šablona postavená
 * dřívější verzí tohohle souboru zůstala ležet i poté, co sem přibyla fronta,
 * a testy by běžely nad neúplným schématem, aniž by cokoli spadlo. Verze je
 * v otisku proto, že tabulky staví knihovna a jejich tvar se s ní mění.
 */
export const PGBOSS_RECIPE = `pgboss@${PGBOSS_VERSION};${QUEUE_REGISTRY.map((e) => e.name)
  .sort()
  .join(',')}`;

export async function installPgBoss(migratorUrl: string): Promise<void> {
  const boss = new PgBoss({
    connectionString: migratorUrl,
    schema: 'pgboss',
    supervise: false,
    schedule: false,
    max: 2,
  });
  await boss.start();
  try {
    // POŘADÍ JE PODSTATNÉ, stejně jako v `registerQueues`: napřed fronta pro
    // nedoručitelné, teprve pak ta, která na ni odkazuje. pg-boss trvá na tom,
    // aby cílová fronta v tu chvíli existovala.
    for (const entry of QUEUE_REGISTRY) {
      if (entry.deadLetter) await boss.createQueue(dlqName(entry.name));
      await boss.createQueue(
        entry.name,
        entry.deadLetter ? { deadLetter: dlqName(entry.name) } : {},
      );
    }
  } finally {
    await boss.stop({ graceful: false }).catch(() => undefined);
  }

  // Práva pro aplikační roli. Tabulky vlastní migrátor, takže se přidělují až
  // tady, ne v migraci: v době jejího běhu ještě neexistují. Bez nich by test
  // běžel pod jinou rolí, než pod jakou běží produkce.
  const client = new Client({ connectionString: migratorUrl });
  await client.connect();
  try {
    await client.query(`GRANT USAGE ON SCHEMA pgboss TO mlain_app`);
    await client.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pgboss TO mlain_app`,
    );
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgboss TO mlain_app`);
    // Pro tabulky, které pg-boss založí později (partition per fronta).
    await client.query(
      `ALTER DEFAULT PRIVILEGES IN SCHEMA pgboss ` +
        `GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO mlain_app`,
    );
  } finally {
    await client.end().catch(() => undefined);
  }
}
