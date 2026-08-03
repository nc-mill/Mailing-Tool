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

-- Časová zóna databáze. ALTER DATABASE smí jen vlastník databáze nebo
-- superuživatel, takže z migrace pod rolí mlain_migrator to udělat nejde.
-- Připojení si navíc nastavují `options: '-c timezone=UTC'`, tohle je druhá
-- pojistka pro klienty, kteří to neudělají (psql, pg_dump, externí nástroje).
ALTER DATABASE mlain SET timezone = 'UTC';

-- Připojení k databázi.
GRANT CONNECT ON DATABASE mlain
  TO mlain_app, mlain_sender, mlain_backup, mlain_gdpr, mlain_maintenance;

-- Čtení schématu. Práva na jednotlivé tabulky uděluje P03 v migracích.
-- mlain_backup tady není schválně, má pg_read_all_data.
GRANT USAGE ON SCHEMA public
  TO mlain_app, mlain_sender, mlain_gdpr, mlain_maintenance;

-- pg_boss si své schéma migruje sám při boss.start(), tedy mimo náš migrační
-- runner. Aplikační role proto potřebuje vlastní schéma, do kterého smí
-- zakládat objekty. Bez tohohle řádku spadne worker při prvním startu na
-- "permission denied for database mlain".
CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION mlain_app;

-- Zálohovací role čte všechno a nikdy nezapisuje.
GRANT pg_read_all_data TO mlain_backup;

-- Bez tohohle by mlain_app mohla zakládat objekty v public a obešla by tím
-- pravidlo, že schéma vlastní výhradně migrátor.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
