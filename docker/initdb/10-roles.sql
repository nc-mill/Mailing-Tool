-- Zakládá databázové role podle tabulky v části 1, kapitole 3.12, rozšířené
-- o dvě role, které vyžaduje model oprávnění plánu P03.
-- U externího Postgresu je to v dokumentaci jako ruční krok.
--
-- Skript musí být idempotentní: docker-entrypoint-initdb.d sice běží jen při
-- prvním startu prázdného datového adresáře, ale operátor ho může spustit ručně
-- proti existující databázi a druhý běh nesmí spadnout.
--
-- Sloupcové granty, granty na tabulky a politiky RLS sem NEPATŘÍ. Vlastní je
-- plán P03 a zapisuje je do migrací, protože v okamžiku tohoto skriptu žádná
-- tabulka neexistuje.

DO $$
BEGIN
  -- mlain_app: běžný provoz. Nevlastní tabulky, takže na ni platí RLS.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'mlain_app') THEN
    CREATE ROLE mlain_app LOGIN PASSWORD 'mlain';
  END IF;

  -- mlain_sender: oddělená role, aby chyba v senderu nemohla sáhnout na kontakty.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'mlain_sender') THEN
    CREATE ROLE mlain_sender LOGIN PASSWORD 'mlain';
  END IF;

  -- mlain_backup: jen pro pg_dump, nikdy nezapisuje.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'mlain_backup') THEN
    CREATE ROLE mlain_backup LOGIN PASSWORD 'mlain';
  END IF;

  -- mlain_gdpr: výmaz podle článku 17. Tabulka consents je append only a
  -- aplikační role na ni právo DELETE nemá ani mít nesmí, jinak by šlo souhlas
  -- přepsat běžnou operací. Bez téhle role není výmaz proveditelný vůbec.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'mlain_gdpr') THEN
    CREATE ROLE mlain_gdpr LOGIN PASSWORD 'mlain';
  END IF;

  -- mlain_maintenance: úlohy, které běží NAPŘÍČ projekty a workspace kontext
  -- nemají odkud vzít. Retenční mazání web_events, úklid projektů po uplynutí
  -- lhůty na obnovu a systémové skeny plánovače, hlídače a rekontroly domén.
  -- Od aplikační role je oddělená proto, že mlain_app na tyhle věci právo mít
  -- nesmí: cross-workspace čtení je výjimka z izolace projektů a patří na
  -- jmenovaný seznam tabulek, ne na běžný provoz. Které to jsou, určují
  -- politiky maintenance_* v migracích 0004 a 0009.
  --
  -- Aplikaci se předává proměnnou DATABASE_URL_MAINTENANCE. Je VOLITELNÁ:
  -- instalace bez ní naběhne, jen tyhle úlohy odmítnou běžet a řeknou proč.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'mlain_maintenance') THEN
    CREATE ROLE mlain_maintenance LOGIN PASSWORD 'mlain';
  END IF;
END
$$;

-- mlain_migrator zakládá POSTGRES_USER v compose souboru a je vlastníkem
-- schématu public. Tady se jen pojistíme, že vlastnictví sedí.
ALTER SCHEMA public OWNER TO mlain_migrator;

-- ---------------------------------------------------------------------------
-- PRÁVA NA SAMOTNOU DATABÁZI
-- ---------------------------------------------------------------------------
-- Název databáze se NEPÍŠE natvrdo. U přibaleného Postgresu ho určuje
-- POSTGRES_DB (tedy `mlain`), ale tenhle skript je zároveň RUČNÍ KROK pro
-- externí Postgres a tam se databáze běžně jmenuje jinak (`defaultdb`,
-- `neondb`, jméno podle projektu u poskytovatele). S natvrdo napsaným `mlain`
-- skript na takové instalaci spadl hned na prvním příkazu.
--
-- `GRANT` ani `ALTER DATABASE` neberou výraz, jen literál, takže se jméno
-- doplňuje přes `format(%I)` a `EXECUTE`. Skript se spouští připojený k té
-- databázi, kterou nastavuje, takže `current_database()` je právě ona.
DO $$
DECLARE
  db text := current_database();
BEGIN
  -- Časová zóna databáze. ALTER DATABASE smí jen vlastník databáze nebo
  -- superuživatel, takže z migrace pod rolí mlain_migrator to udělat nejde.
  -- Připojení si navíc nastavují `options: '-c timezone=UTC'`, tohle je druhá
  -- pojistka pro klienty, kteří to neudělají (psql, pg_dump, externí nástroje).
  EXECUTE format('ALTER DATABASE %I SET timezone = %L', db, 'UTC');

  -- Připojení k databázi.
  EXECUTE format(
    'GRANT CONNECT ON DATABASE %I TO mlain_app, mlain_sender, mlain_backup, mlain_gdpr, mlain_maintenance',
    db);

  -- ZAKLÁDÁNÍ ROZŠÍŘENÍ. Bez tohohle grantu se na cizím Postgresu vůbec
  -- nezaloží schéma: úplně první migrace `0000_extensions.sql` volá
  -- CREATE EXTENSION na citext, pg_trgm a btree_gin a od PostgreSQL 13 smí
  -- důvěryhodné rozšíření založit role, která má CREATE na aktuální databázi.
  --
  -- U přibaleného Postgresu to nikdo nepoznal, protože tam mlain_migrator
  -- databázi VLASTNÍ (zakládá ji POSTGRES_USER) a právo má implicitně.
  -- Na spravované databázi vlastní databázi účet poskytovatele a migrátor je
  -- běžná role, takže první migrace skončila na
  --
  --   ERROR:  permission denied to create extension "citext"
  --   HINT:   Must have CREATE privilege on current database to create this extension.
  --
  -- Ověřeno spuštěním obojím směrem proti běžícímu Postgresu 18, ne odvozeno:
  -- bez grantu ta chyba padne, s grantem projdou všechna tři rozšíření.
  -- Testovací pomocníci (`packages/db/test/global-setup.ts` a další tři místa)
  -- si tenhle grant odjakživa dělali sami, takže testy vadu nemohly odhalit.
  --
  -- CREATE na databázi znamená „smí zakládat schémata a důvěryhodná rozšíření",
  -- ne přístup k datům. Aplikační role ho nedostane, pravidlo, že schéma public
  -- vlastní výhradně migrátor, tím zůstává v platnosti.
  EXECUTE format('GRANT CREATE ON DATABASE %I TO mlain_migrator', db);
END
$$;

-- Čtení schématu. Práva na jednotlivé tabulky uděluje P03 v migracích.
-- mlain_backup tady není schválně, má pg_read_all_data.
GRANT USAGE ON SCHEMA public
  TO mlain_app, mlain_sender, mlain_gdpr, mlain_maintenance;

-- SCHÉMA `pgboss` SE TADY NEZAKLÁDÁ. Vlastní ho migrace 0007_pgboss_schema,
-- která ho zakládá s vlastníkem `mlain_migrator` a aplikační roli v něm dává
-- USAGE a CREATE, protože pg-boss si své tabulky staví sám při boss.start().
--
-- Dřív ho zakládal tenhle skript příkazem
-- `CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION mlain_app`, tedy s JINÝM
-- vlastníkem, než chce migrace. Na přibaleném Postgresu to nikdo nepoznal:
-- tam je `mlain_migrator` superuživatel (zakládá ho POSTGRES_USER), takže
-- směl grantovat i na cizí schéma. Na externím Postgresu je běžnou rolí
-- a instalace spadla na sedmé migraci:
--
--   migrace 0007_pgboss_schema selhala: permission denied for schema pgboss
--
-- Ověřeno spuštěním proti PostgreSQL 18 v obou variantách, ne odvozeno.
-- Kdo pouštěl starší znění tohohle skriptu, musí vlastníka opravit ručně:
-- `ALTER SCHEMA pgboss OWNER TO mlain_migrator;` (viz
-- docs/operations/install-external-postgres.md).

-- Zálohovací role čte všechno a nikdy nezapisuje.
GRANT pg_read_all_data TO mlain_backup;

-- Bez tohohle by mlain_app mohla zakládat objekty v public a obešla by tím
-- pravidlo, že schéma vlastní výhradně migrátor.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
