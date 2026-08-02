import { Client } from 'pg';

/**
 * Dorovnává sdílený testovací harness na to, co má instalace z `docker/initdb`.
 *
 * Harness zakládá šest rolí holým `CREATE ROLE ... LOGIN PASSWORD`, kdežto
 * v provozu má `mlain_backup` atribut `pg_read_all_data` a `mlain_migrator`
 * zakládá `POSTGRES_USER` v compose souboru, tedy jako superuživatele clusteru.
 * Bez těch dvou rozdílů by provozní testy měřily něco jiného, než co pojede
 * u zákazníka: pg_dump by pod `mlain_backup` spadl na chybějícím USAGE dřív,
 * než by se vůbec dostal k row level security, a `mlain backup verify` by
 * neměl kam obnovit ověřovací databázi.
 *
 * Harness vlastní P03 a P01, takže se tyhle dva příkazy dělají tady, v testovací
 * opoře P16, ne v něm.
 */
async function asSuperuser(ownerUrl: string, statements: readonly string[]): Promise<void> {
  const u = new URL(ownerUrl);
  u.username = 'postgres';
  u.password = 'postgres';
  const su = new Client({ connectionString: u.toString() });
  await su.connect();
  try {
    for (const statement of statements) {
      // Souběh je tu normální stav: víc testovacích souborů běží proti JEDNOMU
      // sdílenému serveru a dva zápisy do téhož řádku v pg_authid skončí na
      // „tuple concurrently updated". Výsledek je přitom u obou stejný, takže
      // se opakuje, místo aby padl celý soubor.
      for (let attempt = 1; ; attempt += 1) {
        try {
          await su.query(statement);
          break;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (attempt >= 5 || !message.includes('tuple concurrently updated')) throw error;
          await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
        }
      }
    }
  } finally {
    await su.end();
  }
}

/** `GRANT pg_read_all_data TO mlain_backup` z `docker/initdb/10-roles.sql`. */
export async function grantReadAllData(ownerUrl: string): Promise<void> {
  await asSuperuser(ownerUrl, ['GRANT pg_read_all_data TO mlain_backup']);
}

/**
 * Právo zakládat a rušit databáze pro migrátora. `mlain backup verify` obnovuje
 * zálohu do dočasné databáze `ml_verify_*` a bez toho práva by neměl kam.
 */
export async function allowCreateDatabases(ownerUrl: string): Promise<void> {
  await asSuperuser(ownerUrl, ['ALTER ROLE mlain_migrator CREATEDB']);
}
