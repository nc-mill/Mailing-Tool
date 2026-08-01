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
    for (const statement of statements) await su.query(statement);
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
