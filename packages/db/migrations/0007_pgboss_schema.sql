-- Schéma pro frontu úloh (pg-boss).
--
-- Zakládá ho MIGRACE, ne worker, a je to oprava vady, kvůli které instalace
-- vůbec nenaběhla. `apps/worker/src/main.ts` se připojuje pod `DATABASE_URL`,
-- tedy jako `mlain_app`, a pg-boss si při startu zakládá vlastní schéma
-- a tabulky. Aplikační role ale nemá `CREATE` na databázi, takže worker padal:
--
--   error: permission denied for database mlain   (SQLSTATE 42501)
--     at Contractor.create ... PgBoss.start ... main
--
-- Migrace 0005 rozdává práva ve schématu `public`, což `CREATE` na úrovni
-- DATABÁZE není. Zvenčí to vypadalo jako chyba oprávnění v aplikaci, přitom
-- šlo o objekt, který nikdy nikdo nezaložil.
--
-- Nabízely se dvě cesty. Pustit workera pod rolí migrátora by bylo rychlejší,
-- ale dalo by mu vlastníka celého schématu, tedy právo měnit i tabulky, do
-- kterých nemá co zasahovat. Tahle cesta drží pravidlo, že schéma vlastní
-- jedině migrátor: schéma vzniká tady, a aplikační role v NĚM smí zakládat
-- objekty, protože pg-boss si své tabulky spravuje sám a jejich tvar patří
-- knihovně, ne našim migracím.
--
-- Jméno je natvrdo `pgboss`, zatímco `PGBOSS_SCHEMA` je konfigurovatelné
-- (výchozí `pgboss`). Migrace konfiguraci nezná a znát nemá. Kdo si schéma
-- přejmenuje, musí ho založit sám a dát na něj tatáž práva; `mlain doctor`
-- na ten rozpor upozorní.
CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION mlain_migrator;
--> statement-breakpoint

-- USAGE i CREATE, obojí je potřeba: bez USAGE se do schématu nedostane,
-- bez CREATE si v něm nezaloží tabulky, indexy a typy, které při startu staví.
GRANT USAGE, CREATE ON SCHEMA pgboss TO mlain_app;
--> statement-breakpoint

-- Sender tu SCHVÁLNĚ nemá nic. Do pg-boss nesahá vůbec, má vlastní outbox
-- v `public`, ověřeno hledáním v `apps/sender`. Právo, které nikdo nepotřebuje,
-- je jen další cesta k datům.
--
-- Původně tu byly dva příkazy `ALTER DEFAULT PRIVILEGES FOR ROLE mlain_app`,
-- které měly senderu zpřístupnit tabulky zakládané aplikační rolí. Migrace na
-- nich spadla, a bylo to správně:
--
--   migrace 0007_pgboss_schema selhala: permission denied to change default privileges
--
-- Měnit výchozí oprávnění CIZÍ role smí jen její člen nebo superuživatel,
-- a migrátor ani jedno není. Ta chyba tedy odhalila, že jsem rozdával práva,
-- která nikdo nechtěl.

-- Zálohovací role musí frontu vidět, jinak by dump instalace neobsahoval
-- rozpracované úlohy a obnova by tiše zahodila naplánované odeslání.
-- Na čtení dat jí stačí `pg_read_all_data`, kterou přiděluje `docker/initdb`;
-- tady jde jen o to, aby se do schématu vůbec dostala.
GRANT USAGE ON SCHEMA pgboss TO mlain_backup;
