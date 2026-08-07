# Instalace na externí Postgres

Runbook pro instalaci, která **nepoužívá přibalený Postgres** z `docker/compose.yml`,
ale spravovanou nebo vlastní databázi: RDS, Cloud SQL, DigitalOcean, Neon, Supabase,
nebo prostě Postgres na jiném stroji.

Přibalená varianta tenhle návod nepotřebuje. Tam se všechno níž udělá samo, protože
`docker/initdb/10-roles.sql` spustí kontejner při prvním startu a role `mlain_migrator`
je v něm superuživatel. **Na cizí databázi neplatí ani jedno**, a přesně z toho plynou
všechny kroky, které tu jsou.

Postup je ověřený spuštěním proti PostgreSQL 18.4, ne opsaný z kódu. Hlášky chyb
v oddílu [Když to spadne](#když-to-spadne) jsou doslovné výpisy z toho běhu.

---

## Co potřebujete, než začnete

| Věc | Proč |
| --- | --- |
| PostgreSQL 18 | Testy i produkční obraz jedou na 18. Klient `psql` musí být taky 18, viz README. |
| Účet, který smí zakládat role | Založí šest rolí aplikace. U spravované databáze je to účet od poskytovatele (`postgres`, `doadmin`, master user). |
| Rozšíření `citext`, `pg_trgm`, `btree_gin` | Zakládá je první migrace. Všechna tři jsou v `contrib`, tedy v základní nabídce každého poskytovatele. |
| Databázi, do které se to nainstaluje | Může se jmenovat jakkoli. Skript si jméno bere z `current_database()`. |

Instalace **nemusí** být superuživatel. Celý postup projde i pod běžným účtem
s právy `CREATEROLE` a `CREATEDB`, s jedinou výjimkou u role pro zálohy, která je
popsaná v kroku 4.

---

## Krok 1: role migrátora

Skript `docker/initdb/10-roles.sql` zakládá pět rolí, ale **`mlain_migrator` mezi
nimi není**: v přibalené variantě ji zakládá `POSTGRES_USER` v compose souboru.
Na cizí databázi si ji proto založte sami, a to jako první.

```sql
CREATE ROLE mlain_migrator LOGIN PASSWORD 'zvolte-silne-heslo';
```

## Krok 2: právo přepnout se na migrátora

Skript v dalším kroku převádí vlastnictví schématu `public` na `mlain_migrator`.
PostgreSQL na to vyžaduje, aby se ten, kdo příkaz spouští, uměl na cílovou roli
**přepnout** (`SET ROLE`). Superuživatel to smí vždy; běžný účet s `CREATEROLE`
dostane při zakládání role jen právo ji spravovat, ne se na ni přepnout.

Když nejste superuživatel, doplňte si to:

```sql
GRANT mlain_migrator TO CURRENT_USER WITH SET TRUE;
```

Bez toho skript spadne na `ERROR: must be able to SET ROLE "mlain_migrator"`.

> `WITH ADMIN TRUE` sem nepište. Když roli založil váš účet, právo ji spravovat
> už má, a Postgres pokus odmítne hláškou
> `ADMIN option cannot be granted back to your own grantor`.

## Krok 3: skript s rolemi

Spusťte `docker/initdb/10-roles.sql` **připojení k cílové databázi**, ne k `postgres`.
Skript pracuje s `current_database()`, takže připojení určuje, které databáze se
granty týkají.

```sh
psql "$SPRAVCOVSKE_URL" -v ON_ERROR_STOP=1 -f docker/initdb/10-roles.sql
```

Skript je idempotentní, takže ho můžete pustit znovu kdykoli později, i nad hotovým
schématem. Co udělá:

- založí role `mlain_app`, `mlain_sender`, `mlain_backup`, `mlain_gdpr`
  a `mlain_maintenance` (existující nechá být, včetně jejich hesel),
- převede vlastnictví schématu `public` na `mlain_migrator`,
- nastaví databázi časovou zónu UTC,
- dá rolím právo připojit se a číst schéma `public`,
- dá `mlain_migrator` právo `CREATE` na databázi, bez kterého se nezaloží rozšíření,
- dá `mlain_backup` roli `pg_read_all_data`,
- odebere `PUBLIC` právo zakládat objekty v `public`.

Schéma `pgboss` **nezakládá**. Vlastní ho migrace `0007_pgboss_schema`, viz
[Když to spadne](#migrace-0007-permission-denied-for-schema-pgboss).

## Krok 4: role pro zálohy

Řádek `GRANT pg_read_all_data TO mlain_backup;` je jediné místo, kde běžný
`CREATEROLE` účet nestačí. Přidělit vestavěnou roli smí jen ten, kdo na ni má
právo `ADMIN`.

- **Superuživatel** ho má. Nemusíte dělat nic.
- **Spravovaná databáze**: účet od poskytovatele ho zpravidla má taky
  (`rds_superuser`, `neon_superuser` a jejich obdoby). Zkuste to a uvidíte.
- **Nemáte ho?** Ať vám ho poskytovatel udělí:

  ```sql
  GRANT pg_read_all_data TO <vas_ucet> WITH ADMIN OPTION;
  ```

  Dokud to nemáte, **`mlain backup` nefunguje**. Ne že by dělal neúplné zálohy,
  neuvidí data vůbec.

## Krok 5: hesla rolí

Skript zakládá role s heslem `mlain`. Je to výchozí hodnota pro přibalený
Postgres, který nikoho zvenčí nepouští, a **na cizí databázi se musí změnit**:

```sql
ALTER ROLE mlain_app         PASSWORD '...';
ALTER ROLE mlain_sender      PASSWORD '...';
ALTER ROLE mlain_backup      PASSWORD '...';
ALTER ROLE mlain_gdpr        PASSWORD '...';
ALTER ROLE mlain_maintenance PASSWORD '...';
```

Opakované spuštění skriptu z kroku 3 hesla **nepřepíše**: role zakládá jen tehdy,
když ještě neexistují. Ověřeno změnou hesla a druhým během skriptu.

## Krok 6: migrace

Nastavte `DATABASE_URL_MIGRATOR` a spusťte migrace. Aplikace to udělá sama při
startu, když je `MIGRATE_ON_START=true` (výchozí stav), nebo je pustíte ručně:

```sh
docker run --rm -e DATABASE_URL_MIGRATOR='...' ghcr.io/nc-mill/mlain:1.0.0 mlain migrate
```

Migruje se **pod rolí migrátora**, ne pod `DATABASE_URL`. Role `mlain_app` schéma
nevlastní a měnit ho nesmí; `mlain migrate` bez `DATABASE_URL_MIGRATOR` rovnou
skončí a řekne proč, místo aby padl na „permission denied".

Runner drží zámek, takže při víc replikách migruje jen jedna a ostatní počkají.
Opakované spuštění nic nedělá.

## Krok 7: připojovací řetězce

Do `.env` vyplňte proměnné podle `.env.example`. Profil `bundled`
(`docker compose --profile bundled up`) **nepouštějte**.

```sh
DATABASE_URL=postgres://mlain_app:...@db.example.cz:5432/mlain?sslmode=verify-full
DATABASE_URL_MIGRATOR=postgres://mlain_migrator:...@db.example.cz:5432/mlain?sslmode=verify-full
DATABASE_URL_SENDER=postgres://mlain_sender:...@db.example.cz:5432/mlain?sslmode=verify-full
DATABASE_URL_MAINTENANCE=postgres://mlain_maintenance:...@db.example.cz:5432/mlain?sslmode=verify-full
DATABASE_URL_GDPR=postgres://mlain_gdpr:...@db.example.cz:5432/mlain?sslmode=verify-full
```

Poslední dvě jsou technicky volitelné, ale **vyplňte je obě**. Bez
`DATABASE_URL_MAINTENANCE` se neodešle naplánovaná kampaň, bez `DATABASE_URL_GDPR`
nedoběhne výmaz podle článku 17. Důvody jsou u obou v `.env.example`.

### Pište `sslmode=verify-full`, ne `require`

Tohle překvapí a je to naměřené, ne odvozené. Aplikace má dvě strany a **každá
čte tentýž řetězec jinak**:

| `sslmode` | TypeScript (node-postgres 8.22) | Go (pgx v5.10) |
| --- | --- | --- |
| `require` | ověřuje certifikát jako `verify-full` | šifruje, certifikát **neověřuje** |
| chybí | | zkusí TLS, případně **spadne zpátky na nešifrované** |
| `verify-full` | ověřuje | ověřuje |

Připojovací řetězec zkopírovaný od poskytovatele končívá na `?sslmode=require`.
Na takové instalaci se web chová jinak než odesílací služba: web certifikát ověří,
sender ne. `verify-full` je jediná hodnota, u které obě strany dělají totéž.

Node-postgres na ten rozpor sám upozorňuje ve varování při startu:

```
SECURITY WARNING: The SSL modes 'prefer', 'require', and 'verify-ca'
are treated as aliases for 'verify-full'.
```

Když certifikát poskytovatele nejde ověřit proti systémovým certifikačním
autoritám, řešením je doplnit jeho CA do důvěryhodných, ne slevit na `require`.

---

## Ověření, že instalace sedí

Tyhle dotazy si pusťte po instalaci. Všechny jsou jen pro čtení a všechny mají
očekávaný výstup uvedený.

**Schémata vlastní migrátor.**

```sql
SELECT nspname, pg_get_userbyid(nspowner) AS owner
  FROM pg_namespace WHERE nspname IN ('public','pgboss','drizzle');
```

U všech tří musí být `mlain_migrator`. Kdyby u `pgboss` bylo něco jiného,
přečtěte si [tenhle oddíl](#migrace-0007-permission-denied-for-schema-pgboss).

**Rozšíření jsou založená.**

```sql
SELECT extname FROM pg_extension ORDER BY 1;
```

Musí obsahovat `btree_gin`, `citext` a `pg_trgm`.

**Verze schématu odpovídá migracím.**

```sql
SELECT schema_version FROM system_settings WHERE id = true;
```

**Aplikační role nesmí do `public` zakládat.** Následující příkaz musí
**selhat** hláškou `permission denied for schema public`:

```sql
-- pod rolí mlain_app
CREATE TABLE public.zkouska(id int);
```

**Aplikační role smí zakládat v `pgboss`.** Tohle naopak musí projít, jinak
worker při startu nenaběhne:

```sql
-- pod rolí mlain_app
CREATE TABLE pgboss.zkouska(id int); DROP TABLE pgboss.zkouska;
```

**Sender vidí poštu, ne kontakty.** První dotaz projde, druhý musí selhat
hláškou `permission denied for table contacts`:

```sql
-- pod rolí mlain_sender
SELECT count(*) FROM messages;
SELECT count(*) FROM contacts;
```

**Souhlasy maže jen role pro GDPR.** Musí vyjít `t` a `f`:

```sql
SELECT has_table_privilege('mlain_gdpr','consents','DELETE'),
       has_table_privilege('mlain_app','consents','DELETE');
```

**Časová zóna databáze je UTC.**

```sql
SHOW timezone;
```

Nad rámec těchhle dotazů umí instalaci prohlédnout `mlain doctor`.

---

## Když to spadne

### `must be able to SET ROLE "mlain_migrator"`

Skript `10-roles.sql` skončil na `ALTER SCHEMA public OWNER TO mlain_migrator`.
Chybí krok 2. Doplňte `GRANT mlain_migrator TO CURRENT_USER WITH SET TRUE;`
a spusťte skript znovu.

### `permission denied to grant role "pg_read_all_data"`

Váš účet nemá právo `ADMIN` na tuhle vestavěnou roli. Viz krok 4.

### `permission denied to create extension "citext"`

První migrace se pokusila založit rozšíření a role `mlain_migrator` nemá `CREATE`
na databázi. Uděluje ho `10-roles.sql`, takže buď neproběhl, nebo běžel připojený
k jiné databázi, než do které instalujete. Skript je idempotentní, pusťte ho znovu
proti té správné.

### migrace 0007: `permission denied for schema pgboss`

Schéma `pgboss` existuje a **vlastní ho někdo jiný než `mlain_migrator`**, takže
mu migrace nemůže udělit práva. Stane se to instalacím, které pouštěly starší
znění `docker/initdb/10-roles.sql`: to schéma zakládalo samo, a to s vlastníkem
`mlain_app`. Na přibaleném Postgresu to nikdo nepoznal, protože tam je migrátor
superuživatel a smí grantovat i na cizí schéma.

Oprava je jeden příkaz pod účtem, který schéma vlastní, nebo pod superuživatelem:

```sql
ALTER SCHEMA pgboss OWNER TO mlain_migrator;
```

Pak migrace pusťte znovu.

### `password authentication failed`

Role má pořád výchozí heslo `mlain` ze skriptu, nebo naopak už změněné a připojovací
řetězec o tom neví. Viz krok 5.

---

## Co dělat dál

- **Zálohy nejsou zapnuté samy.** Postup je v
  [backup-restore.md](backup-restore.md). Zálohy jedou pod rolí migrátora;
  pod aplikační rolí by row-level security vyrobila tiše prázdné tabulky,
  a `mlain backup` to proto rovnou odmítne.
- **Retence a oddíly taky ne.** `mlain partitions` si musíte zapsat do plánovače,
  jinak se stará pošta nikdy neuklidí a instalace po čtyřech měsících přestane
  přijímat zápisy. Postup v [partitions-retention.md](partitions-retention.md).
- **Upgrady** popisuje [upgrade.md](upgrade.md).
- **Rotaci šifrovacího klíče** popisuje [key-rotation.md](key-rotation.md).
