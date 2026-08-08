# Konfigurace a první instalace

Datum: 2026-08-08. Stav: NÁVRH k rozhodnutí, žádný kód se zatím neměnil.

Podnět: worker naběhl bez `DATABASE_URL_MAINTENANCE`, ohlásil 59 front, health port
vrátil `ok`, a přesto do pár minut spadlo 110 úloh. Proměnná v žádném souboru nebyla,
existovala jen jako `export` v jednom terminálu.

Dokument má tři druhy odstavců a jsou označené:

- **VADA** je tvrzení o současném stavu, podložené souborem a řádkem.
- **NÁVRH** je rozhodnutí, které navrhuji přijmout, i s důvodem.
- **OTÁZKA** je rozhodnutí pro majitele produktu, které za něj udělat nemůžu.

---

## 1. Shrnutí na jednu obrazovku

Konfigurace má **183 proměnných** (`packages/core/test/config/manifest.test.ts:19`),
z nichž zod vyžaduje **tři**: `APP_URL`, `DATABASE_URL`, `SECRET_KEY`. Všechno ostatní
má výchozí hodnotu nebo je volitelné. Instalace tedy nastartuje skoro vždycky.

Problém není, že by chyběly kontroly. Problém je, že **kontrola konfigurace neví, jaký
proces ji spouští**. `MODE` má čtyři hodnoty (`web`, `worker`, `sender`, `all`,
`packages/core/src/config/schema-platform.ts:77`), ale v celém schématu a ve všech
křížových kontrolách se `MODE` používá jen na tři věci: kolize portů při `MODE=all`
a zákaz migrací mimo web (`packages/core/src/config/cross-checks.ts:14,21,140`).
Žádná proměnná není povinná „pro worker" nebo „pro sender". Worker proto projde
stejnou validací jako web, přestože potřebuje jiná připojení.

Druhý problém je vývojové prostředí: **jediný soubor s konfigurací je
`apps/web/.env.local`, a ten čte jedině `next dev`.** Worker se podle README spouští
jako `node apps/worker/dist/main.js` (`README.md:112`) bez jakéhokoli načtení env
souboru, `@mlain/worker` nemá `dotenv` v závislostech
(`apps/worker/package.json:15-19`). Sender se spouští s proměnnými vypsanými na
příkazové řádce (`README.md:115-122`). Odtud pochází přesně ten incident: web měl
maintenance připojení, worker ne, a nic to nespojovalo.

Třetí problém je, že **žádná kontrola instalace se neptá na víc než jedno připojení
z pěti**. Readiness webu i workeru i `mlain doctor` sahají na `DATABASE_URL`,
případně na `DATABASE_URL_MIGRATOR`, a tím to končí. Podrobně v kapitole 4.

Čtyři věci k rozhodnutí jsou v kapitole 5.

### Posloupnost první instalace, jak vypadá dnes

Přibalený Postgres přes compose (`docker/compose.yml`):

1. `cp .env.example .env`, vyplnit `APP_URL`, `SECRET_KEY`, `POSTGRES_PASSWORD`.
2. `docker compose --profile bundled up -d`. Postgres si při prvním startu pustí
   `docker/initdb/10-roles.sql`, který založí pět rolí plus `mlain_backup`, všechny
   s heslem `mlain` (řádky 17, 22, 27, 34, 48), a udělí granty.
3. `docker/entrypoint.sh` odvodí `TRACKING_DOMAIN` z `APP_URL` (řádky 38-41), ověří
   konfiguraci přes `mlain config check` (45-47), vymaže klíče AI providerů (60-71),
   při `MIGRATE_ON_START=true` pustí `mlain migrate` (85-100) a spustí tři procesy
   (106-188).
4. V prohlížeči průvodce prvním spuštěním založí prvního správce, první projekt
   a rovnou i relaci (`packages/core/src/identity/setup.ts`, `SetupResult.token`
   na řádcích 41-55).

**Tahle cesta je úplná.** Compose má výchozí hodnoty pro všech pět připojení
a instalace z ní vyjde funkční.

Externí Postgres nebo vývoj: kroky 2 a 3 dělá člověk ručně, `10-roles.sql` se pouští
pod superuživatelem (`.env.example:102`), připojovací řetězce se píší rukou a **návod,
podle kterého je píše, zná jen tři z pěti** (`README.md:66-72`). Tady instalace tiše
vypadne.

**VADA: `POSTGRES_PASSWORD` mění heslo jen jedné roli z šesti.** `.env.example:18`
vypadá jako heslo k databázi a jeho výchozí hodnota je doslova `zmente-me`. Compose ho
ale dosadí jedině do `DATABASE_URL_MIGRATOR` (`docker/compose.yml:27`). Řetězce pro
app, sender, maintenance a gdpr mají heslo natvrdo `mlain`
(`compose.yml:24,28,40,50`), protože tak role zakládá `docker/initdb/10-roles.sql`
(řádky 17, 22, 27, 34, 48), a změnit ho neumí žádný příkaz. Kdo poslechne výzvu
a heslo změní, zůstane s pěti rolemi na `mlain` a bude si myslet, že si databázi
zabezpečil. Nikde to není napsané.

**VADA: po `docker compose up` není odkud se dozvědět, že se má jít na `/setup`.**
Kořenová stránka posílá nepřihlášeného na `/login`
(`apps/web/src/app/[locale]/page.tsx:29`) a přihlašovací obrazovka na průvodce
neodkazuje. Jediné dvě zmínky `/setup` mimo samotnou stránku jsou seznam anonymních
cest v `apps/web/src/proxy.ts:102` a komentář na `proxy.ts:170`. Entrypoint vypíše
`Konfigurace je v pořádku. MODE=all, verze …` a nic víc. **Adresu prvního spuštění
musí člověk uhodnout.** Pro produkt, který má být „na první dobrou funkční", je tohle
nejlevnější oprava s největším dopadem v celém dokumentu.

**VADA: entrypoint toleruje neúspěšnou migraci.** `docker/entrypoint.sh:92-93`
propouští exit 69 z `mlain migrate` a jen vypíše hlášku. Zdůvodnění na řádcích 78-84
říká, že `mlain migrate` dodá až plán P03 a do té doby vrací 69. Ten příkaz je dnes
implementovaný, takže výjimka přežila svůj důvod: kontejner může naběhnout nad
nezmigrovanou databází a tvářit se, že startuje v pořádku.

Kde přesně to tiše selže:

| Krok                                | Tiché selhání                                                                                       |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `cp .env.example apps/web/.env.local` | `DATABASE_URL` je v příkladu zakomentovaná, viz VADA 3a                                                |
| psaní připojovacích řetězců          | chybí maintenance a gdpr, README o nich mlčí, viz VADA 3b                                              |
| překlep v názvu proměnné            | zod neznámý klíč zahodí bez hlásky, viz 2.5                                                            |
| start workeru                        | varování je jeden `warn` v JSON logu, readiness ho neodráží, viz 2.3                                   |
| `mlain doctor`                       | o třech z pěti připojení nic neví a bez `--strict` vrací 0 i když nic nezkontroloval, viz kapitola 4    |
| první přihlášení                     | nic neodkazuje na `/setup`, adresa se musí uhodnout                                                    |
| změna `POSTGRES_PASSWORD`            | přenastaví heslo jedné roli z šesti                                                                     |

### Web mimo kontejner neohlásí vadnou konfiguraci srozumitelně

**VADA.** `apps/web/src/instrumentation.ts:5-10` volá `getConfig()` bez `try/catch`.
`ConfigError` s vlastním exit kódem 78 a seznamem problémů se tedy odchytí jedině
v kontejneru, kde ho dřív zachytí `mlain config check` v entrypointu
(`docker/entrypoint.sh:45-47`). Kdo spustí web mimo kontejner, tedy každý vývojář,
dostane místo seznamu chybějících proměnných nezachycenou výjimku z instrumentace.
Worker to dělá správně (`apps/worker/src/main.ts:21-26`), CLI také
(`load-cli-config.ts:25-30`). Web je jediná výjimka.

### Dvě proměnné obcházejí schéma úplně

**VADA.** `DEFAULT_TIMEZONE` se ve vykreslování čte přímo z prostředí:
`process.env.DEFAULT_TIMEZONE ?? 'Europe/Prague'`
(`packages/i18n/src/request.ts:24`). Míjí to zod, takže nesmyslná hodnota neprojde
validací při startu, ale projeví se až chybou při renderu.

`packages/db/drizzle.config.ts:20` má u `DATABASE_URL_MIGRATOR` tichý fallback na
`postgres://mlain_migrator:mlain@localhost:5432/mlain`. Generátor migrací tedy při
chybějící proměnné nespadne, jen se připojí jinam, než si člověk myslí.

---

## 2. Úplný obraz konfigurace

### 2.1 Kolik toho je

| Veličina                                        | Počet   | Důkaz                                                     |
| ----------------------------------------------- | ------- | --------------------------------------------------------- |
| Proměnných celkem                               | **183** | `packages/core/src/config/config.manifest.json`            |
| Povinných podle zod (bez výchozí hodnoty)       | **3**   | `APP_URL`, `DATABASE_URL`, `SECRET_KEY`                    |
| Zmíněných v `.env.example` (i zakomentovaných)  | **19**  | `.env.example`                                             |
| Z toho aktivních, nezakomentovaných             | **7**   | `APP_URL`, `SECRET_KEY`, `POSTGRES_PASSWORD`, `APP_PORT`, `DEFAULT_LOCALE`, `LOG_LEVEL`, `SECRET_KEY_PREVIOUS` |
| V manifestu a v příkladu vůbec nezmíněných      | **166** |                                                             |
| Které nečte žádný běhový kód                    | **26**  | viz 2.4                                                     |

Manifest se generuje z těch samých zod schémat, která se používají za běhu
(`packages/core/src/config/manifest.ts:17`), a test ověřuje, že commitnutý soubor
odpovídá vygenerovanému (`packages/core/test/config/manifest.test.ts:7-11`). Čísla
výš jsou tedy ze zdroje pravdy, ne z dokumentace.

### 2.2 Tři kategorie povinnosti

Kategorie 1 a 2 jsou v pořádku. Celý problém je kategorie 3.

**Kategorie 1: spadne při startu, hlasitě a se seznamem.**
`loadConfig()` sesbírá VŠECHNY problémy naráz a vyhodí `ConfigError` s exit kódem 78
(`packages/core/src/config/load.ts:53-119`). Entrypoint kontejneru ho volá jako první
krok přes `mlain config check` (`docker/entrypoint.sh:45-47`), worker hned v `main()`
(`apps/worker/src/main.ts:19-27`). Sem patří ty tři povinné proměnné a všechny křížové
kontroly z `cross-checks.ts`, například `MIGRATE_ON_START=true` bez
`DATABASE_URL_MIGRATOR` (`cross-checks.ts:30-36`) nebo `LOGIN_THROTTLING_DISABLED=true`
v produkci (`cross-checks.ts:122-131`). Tahle část je napsaná dobře.

**Kategorie 2: má výchozí hodnotu a ta je použitelná.** Drtivá většina ze 183.
Nikoho netrápí.

**Kategorie 3: instalace naběhne, health hlásí `ok`, a věc přesto nefunguje.**
Tohle je ta nebezpečná kategorie a patří do ní tohle:

| Proměnná                   | Co bez ní tiše nefunguje                                                                                                             | Kdy se to pozná                                       |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| `DATABASE_URL_MAINTENANCE` | plánovač kampaní, hlídač běžících, obnova po kvótě, rekonciliace outboxu, rekontrola domén, úklid smazaných projektů, opakování webhooků | při prvním tiku cronu, tedy minuty po startu          |
| `DATABASE_URL_GDPR`        | výmaz podle článku 17 v režimu `anonymize`, retenční cíl `inactive_contacts`                                                          | při první žádosti subjektu, tedy klidně za měsíce      |
| `DATABASE_URL_SENDER`      | nic, dopočítá se výměnou uživatele v URL (`load.ts:93,121-126`)                                                                        | u externího Postgresu heslem, které neplatí            |
| `TRACKING_DOMAIN`          | pro Go sender povinná, mimo compose se nedopočítá                                                                                     | sender vůbec nenastartuje, exit 78                     |
| `METRICS_TOKEN`            | `/metrics` vrací 401                                                                                                                   | při prvním scrapu                                      |
| `DISPOSABLE_DOMAINS_FILE`  | seznam jednorázových domén se nepoužije                                                                                                | nikdy, tiše                                            |
| `TRACKING_GEOIP_DB_PATH`   | kontrola existuje jen při `TRACKING_STORE_COUNTRY=true` (`cross-checks.ts:108-113`)                                                     | pokryto                                                |

Seznam úloh u `DATABASE_URL_MAINTENANCE` není odhad, je vypsaný v kódu:
`apps/worker/src/main.ts:124-132`.

### 2.3 Co už je udělané dobře a nemá se to rozbíjet

Worker při startu **hlasitě varuje**, když maintenance nebo gdpr připojení chybí, a to
včetně jmenného seznamu dotčených úloh (`apps/worker/src/main.ts:120-155`). Text
varování je věcný a říká následek („naplánovaná kampaň se neodešle"). Obálky
`maintenancePool()` a `gdprPool()` vyhazují výjimku s celým vysvětlením, ne holé
`undefined` (`packages/core/src/tx/index.ts:92-105`, `137-150`).

**VADA (drobná):** to varování je `logger.warn` a `LOG_FORMAT` je ve výchozím stavu
`json` (`schema-platform.ts:83`). V jednom řádku JSONu mezi zprávami o zaregistrovaných
frontách zanikne. Hlavně ale nemá žádný vliv na readiness: health server dostává jen
kontroly `workerReady`, `aiKeyLeakCheck` a `isolationCheck`
(`apps/worker/src/main.ts:232`), takže `/readyz` vrátí `ok` i workeru, kterému chybí
polovina připojení. To je přesně stav z podnětu.

### 2.4 Dvacet šest proměnných, které nikdo nečte

**VADA.** Grep přes `apps/*/src`, `apps/sender/internal` a `packages/*/src` (mimo
testy a mimo `src/config`) nenajde jediné čtení těchto proměnných:

```
BACKUP_TARGET, BRAND_FETCH_ENABLED, BRAND_FETCH_MAX_TOTAL_BYTES,
BRAND_FETCH_TOTAL_TIMEOUT_MS, CAMPAIGN_QUOTA_PAUSE_REMAINING,
CAMPAIGN_TEST_SEND_PER_HOUR, CONTACT_SEARCH_INDEX_ENABLED,
DATABASE_STATEMENT_TIMEOUT_MS, DELIVERABILITY_CONTENT_BOUNCE_LIMIT,
DNS_CHECK_CONCURRENCY, IMPORT_WORKER_CONCURRENCY, INBOUND_MAX_BODY_BYTES,
MIGRATE_LOCK_TIMEOUT_SECONDS, RATE_LIMIT_TRACK_ANON, RATE_LIMIT_TRACK_PIXEL_IP,
RETENTION_MIN_DAYS, S3_BUCKET, S3_ENDPOINT, S3_REGION, SEGMENT_MAX_CONDITIONS,
SEGMENT_RECOUNT_CONCURRENCY, SNS_CERT_CACHE_SECONDS, SNS_STORE_RAW_EVENTS,
SOFT_BOUNCE_THRESHOLD, SOFT_BOUNCE_WINDOW_DAYS, TEMPLATE_VERSION_MAX_UNPINNED
```

Několik jich je vážných samo o sobě. `DATABASE_STATEMENT_TIMEOUT_MS` slibuje strop
na dotaz a žádný pool ho nenastavuje. `MIGRATE_LOCK_TIMEOUT_SECONDS` slibuje timeout
zámku migrace. `SOFT_BOUNCE_THRESHOLD` a `SOFT_BOUNCE_WINDOW_DAYS` slibují pravidlo
pro měkké odrazy. `S3_*` se validují v `cross-checks.ts:54-68`, ale žádný ovladač
úložiště je nečte, takže `STORAGE_DRIVER=s3` je nastavení, které nic nedělá.

Zvlášť stojí za pozornost, jak to přežilo testy. Test se jmenuje
`konfiguracni promenna %s je v zod schematu P01` a tvrdí přesně tohle:

```ts
it.each(REQUIRED_CONFIG_KEYS)('konfiguracni promenna %s je v zod schematu P01', (key) => {
  expect(ConfigSchema.shape).toHaveProperty(key);
});
```

`packages/core/src/campaigns/__tests__/assumptions.test.ts:141-143`. Seznam
`REQUIRED_CONFIG_KEYS` obsahuje mimo jiné `SOFT_BOUNCE_THRESHOLD` i
`SNS_STORE_RAW_EVENTS` (řádky 107, 118). Test je zelený a dokazuje jedině to, že
proměnná existuje ve schématu, nikoli že ji někdo čte. Je to učebnicový případ
z CLAUDE.md: „porovnej JMÉNO testu s tím, co skutečně tvrdí".

### 2.5 Překlep v názvu proměnné projde bez hlásky

**VADA.** `ConfigSchema` je `z.object(configShape)` bez `.strict()`
(`packages/core/src/config/schema.ts:13`; grep na `.strict()` v adresáři `config`
nevrací nic). Zod 4 neznámé klíče **zahazuje**, ověřeno spuštěním:

```
zod 4.4.3, safeParse({A:'x', PREKLEP:'y'}) -> success: true, klíče: ['A']
```

Kdo napíše `DATABASE_URL_MAINTENANACE`, dostane přesně to samé chování jako kdyby
nenapsal nic, a nikdo mu neřekne ani slovo. U 183 proměnných s dlouhými názvy je to
reálná past, ne teoretická.

Přímý důkaz, že se to už stalo: `apps/web/.env.local` obsahuje `DATABASE_URL_BACKUP`,
a ta proměnná v celém repozitáři neexistuje (grep přes `*.ts`, `*.mjs`, `*.md`, `*.yml`,
`*.sh`, `*.go` nevrací nic). Vývojové prostředí tedy nese proměnnou, kterou nic nečte,
a nikdo si toho nevšiml, protože se to nikde nedozví.

**Vedlejší nález k prošetření, mimo rozsah tohohle plánu.** Ta neexistující proměnná
ukazuje na skutečnou roli. `docker/initdb/10-roles.sql` zakládá **šestou** roli
`mlain_backup` (řádky 26-28) a dává jí `pg_read_all_data` (řádek 133), tedy čtení
všeho napříč projekty s obejitím RLS. Zálohy se přitom dělají pod migrátorem
(`apps/cli/src/commands/backup.ts:28-35`) a jméno `mlain_backup` se v běhovém kódu
nevyskytuje vůbec; jediný výskyt mimo SQL a dokumentaci je testovací harness
(`packages/core/src/test-support/pg-harness.ts:73`). Každá instalace tedy má aktivní
přihlašovací účet, který vidí všechna data, nikdo ho nepoužívá, a u přibaleného
Postgresu má heslo `mlain`. Buď se má zapojit, nebo zrušit.

### 2.6 Go sender má tři proměnné, o kterých TypeScript neví

**VADA.** `apps/sender/internal/config/load.go` čte 38 proměnných. Tři z nich
v manifestu ani ve schématu neexistují:

```
SENDER_NON_CAMPAIGN_CONCURRENCY        load.go:177
SENDER_NON_CAMPAIGN_BATCH_SIZE         load.go:178
SENDER_NON_CAMPAIGN_POLL_INTERVAL_MS   load.go:179
```

Nejsou v `.env.example`, nejsou v dokumentaci a `mlain config check` je v entrypointu
mlčky zahodí jako neznámé klíče (viz 2.5). Nastavit je lze, ale nikdo se to nedozví
odjinud než ze zdrojáku v Go.

Příčinou je, že **paritu konfigurace mezi TypeScriptem a Go nehlídá nic**. CLAUDE.md
i CI hlídají paritu kontraktů (`tools/ci/contracts-golden.mjs`), drift OpenAPI
(`tools/ci/openapi-drift.mjs`) a i18n, ale grep na `config.manifest.json` napříč
`apps/`, `tools/` a `.github/` vrací jen samotný generátor a jeho test. Manifest
existuje výslovně proto, aby sloužil „jako podklad pro paritu s Go strukturou senderu"
(`packages/core/src/config/manifest.ts:11-12`), a ta parita se nikdy nezapojila. Je to
další případ vzoru „napsané, otestované, nezapojené".

### 2.7 Go strana dělá to, co tenhle dokument navrhuje pro TypeScript

Stojí za zaznamenání, že sender validuje konfiguraci **procesně**, ne globálně:
`s.required("SECRET_KEY")` (`load.go:148`), odmítnutí spustit se bez
`DATABASE_URL_SENDER` s vysvětlením, že tichý pád zpět na aplikační roli by zrušil
bezpečnostní hranici (`load.go:163-165`), a povinné `TRACKING_DOMAIN` i s důvodem
(`load.go:192-194`). Sbírá přitom všechny chyby naráz do `Errors`, stejně jako
`loadConfig()`. Rozhodnutí 1 níž tedy není nový nápad, jen srovnává TypeScript
s tím, co Go strana dělá už dnes.

---

## 3. Rozpor mezi `.env.example` a skutečností

**VADA 3a: `.env.example` je soubor pro compose, ale README ho posílá do vývoje.**

README říká doslova:

```sh
cp .env.example apps/web/.env.local
```

`README.md:59`. Jenže `.env.example` je psaný pro `docker/compose.yml`, což stojí na
jeho prvním řádku. Obsahuje `POSTGRES_PASSWORD` a `APP_PORT`, tedy dvě proměnné, které
v konfiguračním schématu vůbec nejsou (jsou jen pro compose), a `DATABASE_URL` v něm je
**zakomentovaná** (`.env.example:100`). Kdo README poslechne doslova, dostane
`.env.local`, se kterým `next dev` skončí chybou konfigurace, protože chybí
`DATABASE_URL`. První krok návodu tedy nefunguje.

**VADA 3b: README zná tři role databáze, produkt jich má pět.**

README má tabulku „patří tam **tři** připojení, ne jedno" a vyjmenovává `DATABASE_URL`,
`DATABASE_URL_MIGRATOR`, `DATABASE_URL_SENDER` (`README.md:66-72`). Slova
`MAINTENANCE` ani `GDPR` se v celém README **nevyskytují ani jednou** (grep: 0 výskytů).
Role samotné přitom existují a `docker/initdb/10-roles.sql` je zakládá
(`mlain_maintenance` na řádku 47, `mlain_gdpr` na řádku 33).

README je podle CLAUDE.md „nejúplnější zdroj o rozjezdu". Kdo podle něj postaví vývojové
prostředí, postaví přesně to, co spadlo: web se třemi připojeními a worker, kterému dvě
chybí.

**VADA 3c: `DATABASE_URL_MAINTENANCE` je popsaná jen tam, kam se nikdo nedívá.**

Grep na `DATABASE_URL_MAINTENANCE` v dokumentaci najde `.env.example` (zakomentované),
`docs/operations/install-external-postgres.md`, a pak už jen `STAV-UKOLU.md`,
`HOTOVO.md` a `NALEZY-NAPRIC-PLANY.md`, tedy pracovní dokumenty. Kdo instaluje
s přibaleným Postgresem, install-external-postgres.md z definice nečte.

**Co je naopak v pořádku:** `docker/compose.yml` má výchozí hodnoty pro obě sporné
proměnné (`DATABASE_URL_MAINTENANCE` na řádku 40, `DATABASE_URL_GDPR` na řádku 50)
a `docker/compose.scale.yml` také (řádky 40 a 44). **Instalace přes compose je tedy
úplná.** Nekompletní je vývoj a instalace na externí Postgres, kde se hodnoty berou
z `.env`, a tam jsou obě zakomentované.

---

## 4. Co pozná a nepozná `mlain doctor`

Doctor má **14 kontrol** v pěti souborech (`packages/core/src/ops/doctor/`, po řadě
4 keyring, 2 storage, 3 runtime, 3 workspace, 2 maintenance), které vydávají 21 druhů
nálezů. Vyjmenované id: `backup_binary_missing`, `backup_binary_version_mismatch`,
`backup_stale`, `backup_verify_failed`, `backup_verify_stale`, `check_failed`,
`connection_pool_over_budget`, `data_volume_empty`, `demo_data_present`,
`isolation_prerequisites_missing`, `key_id_ceiling_near`, `missing_key_generations`,
`no_backup_verify_yet`, `no_backup_yet`, `no_partition_maintenance_yet`,
`partition_maintenance_stale`, `schema_version_ahead`,
`secret_key_fingerprint_mismatch`, `secret_key_previous_empty`,
`system_mail_unavailable`, `trial_mode_enabled`. Každá kontrola běží izolovaně a její
pád je vlastní nález, ne pád příkazu (`packages/core/src/ops/doctor/run.ts:25-40`).
To je dobrý návrh.

**VADA: doctor dostane jen dvě připojení z pěti.** Volání v CLI předává
`appUrl: config.DATABASE_URL` a `adminUrl: config.DATABASE_URL_MIGRATOR ?? null`
(`apps/cli/src/commands/doctor.ts:34-35`). `DATABASE_URL_MAINTENANCE`,
`DATABASE_URL_GDPR` ani `DATABASE_URL_SENDER` se do kontextu nedostanou vůbec, takže
doctor se k nim nemůže připojit ani kdyby chtěl. Grep na `MAINTENANCE` a `GDPR` v celém
`packages/core/src/ops` nevrací jediný výskyt, který by se týkal konfigurace.

Praktický důsledek: **`mlain doctor` na instalaci z podnětu doběhne bez jediného
nálezu.** Stav „worker naběhne, ale je z půlky nenakonfigurovaný" nepozná.

Exit kód je 2 při aspoň jednom kritickém nálezu, 1 při varování jen s `--strict`,
jinak 0 (`packages/core/src/ops/doctor/format.ts:28-36`).

**VADA: „kontrolu se nepodařilo dokončit" je jen varování.** Když kontrola spadne,
vydá se nález `check_failed` se závažností `warning` (`run.ts:32-33`). Instalace bez
`DATABASE_URL_MIGRATOR`, kde přes `withAdminTx` nedoběhne většina kontrol, tedy bez
`--strict` skončí **kódem 0**. Nástroj, jehož smyslem je říct „je to v pořádku",
tak řekne „je to v pořádku" i tehdy, když si nemohl ověřit skoro nic.

**VADA: dva vstupy doctoru nikdo nečte.** `uploadsDir` a `imageVersion` se do
`runDoctor` předávají (`apps/cli/src/commands/doctor.ts:38,41`) a žádná kontrola je
nepoužije. Zapisovatelnost `UPLOADS_DIR` se tedy netestuje nikde, přestože je to
adresář, do kterého aplikace ukládá nahrané soubory.

**VADA: kontrola otisku klíče v readiness je napsaná a nezapojená.**
`secretKeyFingerprintCheck` existuje v `packages/core/src/health/checks.ts:31-43`
a grep přes `apps` i `packages` nenajde jediné volání. Další případ vzoru
„napsané, otestované, nezapojené".

### 4.1 Co znamená `ok` na health portech

**VADA.** Readiness webu kontroluje spojení, verzi schématu, datový adresář, únik
klíčů AI a izolaci projektů, a **všechny databázové kontroly jdou přes
`config.DATABASE_URL`**, tedy přes jedinou roli z pěti
(`apps/web/src/app/api/health/ready/route.ts:37-48`). Readiness workeru je na tom
stejně: kontroly jsou `workerReady` (dotaz do schématu pg-boss přes pool aplikační
role), `aiKeyLeakCheck` a `isolationCheck` (`apps/worker/src/main.ts:215-233`).

Tím se uzavírá kruh z podnětu. Health port vrátil `ok` proto, že **kontroluje jediné
připojení**, a to připojení bylo v pořádku. Neexistuje kontrola, která by řekla
„proces má naběhnout s pěti připojeními a má jen tři".

Stojí za zaznamenání, že na tomhle stojí i CI. Job, který spouští compose, čeká na
`200` z `/api/health/ready` a bere to jako důkaz, že instalace běží
(`.github/workflows/ci.yml:516-527`). Kdyby se compose někdy rozešel s realitou tak,
jak se rozešel README, CI by to nepoznalo.

### 4.2 Kde je maintenance role skutečně potřeba, a proč je varování workeru zavádějící

Dobrá zpráva: `withMaintenance` se volá na jediném místě,
`packages/core/src/platform/maintenance-scan.ts` (řádky 44, 69, 112, 138, 223, 282,
355, 384). Pro doplnění kontroly při startu to znamená jedno spojení, ne osm cest.

Špatná zpráva: **z toho souboru čerpá šestnáct modulů napříč skoro všemi doménami**,
ne sedm úloh, jak tvrdí varování workeru. Grep na import z `maintenance-scan`:
`contacts/jobs/refingerprint.ts:5`, `contacts/jobs/retention-dispatch.ts:2`,
`contacts/jobs/cleanup-pending.ts:4`, `contacts/import/jobs/recover-stale.ts:1`,
`contacts/import/jobs/queue-handlers.ts:3`, `platform/jobs/webhook_retry.ts:6`,
`platform/jobs/purge_workspaces.ts:2`, `ai/jobs/system-deps.ts:3`,
`tracking/jobs/recompute-engagement-windows.ts:2`,
`tracking/jobs/refresh-campaign-progress.ts:2`, `campaigns/jobs/system-deps.ts:8`,
`assets/jobs/verify-refcounts.ts:2`, `assets/jobs/cleanup-assets.ts:2`,
`transactional/jobs/purge_render_data.ts:3`, `segments/jobs/recount.ts:4`
a `apps/worker/src/job-watch.ts:5`.

**VADA: seznam ve varování workeru je neúplný a ve dvou bodech zastaralý.**
`apps/worker/src/main.ts:124-132` vyjmenovává sedm úloh. Chybí v něm zotavení
zaseknutých importů, přepočet segmentů, retence, refingerprint, úklid assetů,
přepočet trackingu a čištění `render_data`. Naopak `outbox.reconcile` maintenance už
nepotřebuje a `domain.recheck` **není vůbec zapojená**: fronta je v registru, ale
obsluha v mapě chybí, výslovně přiznáno v
`packages/core/src/campaigns/jobs/queue-handlers.ts:69-72`.

Provozovatel, který si varování přečte a řekne si „naplánované kampaně stejně
nepoužívám", tedy dostal špatný podklad k rozhodnutí. Bez té proměnné mu neběží
i úklid dat a retence.

---

## 5. Návrh

### Rozhodnutí 1: kontrola konfigurace musí vědět, jaký proces ji volá

**NÁVRH: přidat do manifestu proměnné údaj „vyžaduje ji MODE X" a validovat
konfiguraci proti `MODE`, ne globálně.**

Proč to tak dnes není: schéma vzniklo jako jeden plochý `z.object` nad všemi 183
proměnnými (`packages/core/src/config/schema.ts:5-13`) a povinnost se vyjadřuje
absencí `.default()`. Takový zápis neumí říct „povinná pro worker, nesmyslná pro
sender". `MODE` je přitom v `MlainConfig` k dispozici a `cross-checks.ts` už ho na dvě
věci používá, takže infrastruktura existuje.

Co by to obnášelo:

1. Do `packages/core/src/config/` přidat tabulku `requiredBy: Record<VariableName, Mode[]>`
   pro tu hrstku proměnných, kde na tom záleží. Neznamená to anotovat všech 183.
2. Rozšířit `crossChecks()` o průchod tou tabulkou. Chyba se zařadí do stejného
   seznamu jako ostatní, takže platí dosavadní pravidlo „všechny problémy naráz"
   (`load.ts:115-117`).
3. Do `buildConfigManifest()` doplnit pole `requiredBy`, aby to bylo strojově čitelné
   pro dokumentaci a pro Go stranu (`manifest.ts:17-29`).

Které proměnné do té tabulky patří jako **povinné**, ne volitelné:

| Proměnná                   | MODE                  | Proč povinná                                                                    |
| -------------------------- | --------------------- | -------------------------------------------------------------------------------- |
| `DATABASE_URL_MAINTENANCE` | `worker`, `all`       | bez ní se naplánovaná kampaň neodešle, což je hlavní funkce produktu             |
| `DATABASE_URL_GDPR`        | `worker`, `all`       | bez ní nedoběhne výmaz podle článku 17, což je zákonná povinnost se lhůtou       |
| `TRACKING_DOMAIN`          | `sender`, `all`       | Go strana ji už dnes vyžaduje, jen o tom TypeScript neví                          |
| `DATABASE_URL_MIGRATOR`    | `web`, `all` při `MIGRATE_ON_START` | už platí (`cross-checks.ts:30-36`), jen se to zapíše do téže tabulky |

**Tohle je změna, která rozbije existující instalace bez těch proměnných.** Je to
záměr a je to ta část, kvůli které tenhle dokument vzniká: instalace, která neodešle
naplánovanou kampaň a neprovede výmaz osobních údajů, je rozbitá už teď, jen o tom
neví. Hlasitý start je horší zážitek než tichý, ale je to zážitek jednou při instalaci
místo mlčení navždy.

**NÁVRH doplňkový: readiness musí odpovídat tomu, co proces umí.** Do kontrol health
serveru workeru (`apps/worker/src/main.ts:232`) přidat kontrolu, která **skutečně otevře
spojení** pod maintenance a gdpr rolí. Dnes se pool zakládá líně až při první úloze
(`packages/core/src/tx/index.ts:103`), takže **i správně vyplněná proměnná se špatným
heslem se pozná až za běhu**. Pouhá kontrola na `!== undefined`
(`tx/index.ts:84`) to nechytí. Vyžaduje to jedno spojení navíc při startu a stojí
to za to.

### Rozhodnutí 2: role se NEODVOZUJÍ, vyžadují se výslovně, ale zakládá je nástroj

**NÁVRH: zůstat u výslovných proměnných a odvozování `DATABASE_URL_SENDER`
z `DATABASE_URL` zrušit. Zjednodušení první instalace vyřešit příkazem, který role
i řetězce vyrobí, ne dopočítáváním za běhu.**

Dnešní stav je nekonzistentní: `DATABASE_URL_SENDER` se dopočítá výměnou uživatele
v URL (`load.ts:93`, `deriveSenderUrl` na `load.ts:121-126`), kdežto maintenance a gdpr
se schválně nedopočítávají, a komentář v `schema-platform.ts:37-54` říká proč: odvozený
řetězec by nesl **heslo aplikační role**, které pro jinou roli neplatí, takže by
instalace padala na autentizaci, tedy na jiné příčině, než jaká to doopravdy je.

Ten argument platí i pro sender. `deriveSenderUrl` funguje jen v jediném případě,
totiž když mají všechny role stejné heslo, což je pravda výhradně u přibaleného
Postgresu, kde `docker/initdb/10-roles.sql` zakládá všech pět rolí s heslem `mlain`
(řádky 17, 22, 27, 34, 48). Na spravované databázi je odvození past: vyrobí platně
vypadající řetězec, který se neověří.

Argument pro odvozování by byl „jedno `DATABASE_URL` a hotovo". Nekupuju ho, protože
oddělené role jsou nosný prvek bezpečnosti tohohle produktu, ne administrativa. Role
`mlain_app` schválně nevidí napříč projekty a schválně nesmí mazat souhlasy. Odvozování
by tenhle rozdíl zamlžilo přesně v tom okamžiku, kdy si ho má instalující člověk
uvědomit.

Náhradou za pohodlí má být **`mlain provision-roles`**, nový příkaz, který pod
superuživatelským připojením založí všech pět rolí, vygeneruje jim náhodná hesla,
udělí granty podle `docker/initdb/10-roles.sql` a **vypíše hotový blok pěti
`DATABASE_URL_*` řádků k vložení do `.env`**. Tím se z „napiš si pět řetězců ručně
a nezapomeň na dva" stane „spusť příkaz a zkopíruj výstup". Dnes se `10-roles.sql`
na externím Postgresu pouští ručně pod superuživatelem, jak stojí v `.env.example:102`.

### Rozhodnutí 3: jeden příkaz pro rozjezd vývoje a jeden env soubor pro všechny procesy

**NÁVRH: přesunout vývojovou konfiguraci z `apps/web/.env.local` do kořenového `.env`
a dát všem třem procesům společný způsob, jak ho načíst.**

Kořen problému z podnětu je tenhle: `apps/web/.env.local` čte jedině Next.js. Worker
se spouští `node apps/worker/dist/main.js` (`README.md:112`) a nemá `dotenv`
(`apps/worker/package.json:15-19`). Sender dostává proměnné vypsané na příkazové řádce
(`README.md:115-122`). Tři procesy tedy mají tři nezávislé zdroje konfigurace a nic
je nedrží pohromadě. Jakmile se to jednou rozejde, projeví se to až chybou úlohy.

Konkrétně:

1. Zdrojem pravdy pro vývoj je **kořenový `.env`**. Vzniká z `.env.example.dev`,
   samostatného souboru pro vývoj, protože dnešní `.env.example` je psaný pro compose
   a do `.env.local` ho zkopírovat nejde (viz VADA 3a).
2. Worker se spouští `node --env-file=.env apps/worker/dist/main.js`. Node 24 tenhle
   přepínač má, takže to nechce žádnou závislost navíc.
3. Sender se spouští z `.env` také, buď přes `--env-file` obálku, nebo tak, že se mu
   `.env` načte skriptem. Go binárka env soubory sama nečte.
4. Web čte týž `.env`. Next.js hledá env soubory ve svém vlastním kořeni, tedy
   v `apps/web`, ne v kořeni monorepa, takže tenhle bod se musí **ověřit spuštěním**
   a nejspíš vyřešit symlinkem `apps/web/.env.local -> ../../.env`, případně
   předáním přes `--env-file` ve startovacím skriptu. Podstatné je, že všechny tři
   procesy čtou JEDEN soubor; jakou technikou, je detail.
5. **`tools/dev/start.sh`** (nebo `pnpm dev:all`): zkontroluje, že běží `mlain-dev-pg`
   na portu 55432, spustí `mlain config check`, sestaví worker a sender, pokud jsou
   artefakty starší než zdroje, a rozjede všechny tři procesy proti jednomu `.env`.

Bod 5 řeší i past z CLAUDE.md o stáří sestavených artefaktů: skript umí porovnat časy
sám, člověk si to pamatovat nemusí.

### Rozhodnutí 4: co patří do `.env.example` a co do dokumentace

**NÁVRH: `.env.example` obsahuje výhradně to, co člověk musí nebo obvykle chce vyplnit,
a u každé položky jednu větu o následku. Zbylých zhruba 160 proměnných patří do
generované referenční tabulky, ne do příkladu.**

Dnešní `.env.example` má 161 řádků, z toho zhruba 120 řádků komentářů k sedmi aktivním
proměnným. Komentáře jsou věcně dobré, ale poměr je obrácený: vysvětlují se okrajové
věci (`SIGNUP_MODE`, `LOGIN_THROTTLING_DISABLED`) a `DATABASE_URL_MAINTENANCE`
je až na řádku 111, zakomentovaná.

Dělení:

- **`.env.example` (compose):** `APP_URL`, `SECRET_KEY`, `POSTGRES_PASSWORD`, `APP_PORT`.
  Nic víc. Compose má výchozí hodnoty pro všechna připojení, takže je do příkladu
  není nutné psát.
- **`.env.example.ext` (externí Postgres):** všech pět `DATABASE_URL_*`
  **nezakomentovaných** a s prázdnou hodnotou, aby chybějící hodnota shodila
  `mlain config check` místo aby prošla jako „nenastaveno".
- **`.env.example.dev` (vývoj):** totéž plus `MODE`, `NODE_ENV=development`,
  `LOG_FORMAT=pretty`, `DATA_DIR`, `PORT`, `TRACKING_DOMAIN`.
- **`docs/operations/konfigurace.md`:** generovaná tabulka všech 183 proměnných
  z manifestu, sloupce název, typ, rozsah, výchozí hodnota, povinná pro který `MODE`,
  co se stane bez ní. Generuje ji skript, aby nezastarala, a CI hlídá drift stejně,
  jako to dělá `tools/ci/openapi-drift.mjs` pro API.

**NÁVRH doplňkový: hlásit neznámé proměnné.** `loadConfig()` už dnes zná úplný seznam
názvů (`configVariableNames()`, `schema.ts:24-26`) a používá ho na podporu `_FILE`
(`file-secrets.ts:24`). Stačí projít neznámé klíče, vyfiltrovat systémové
(`PATH`, `HOME`, `NODE_*`, proměnné Dockeru) a u zbylých, které vypadají jako
konfigurace Mlainu, vypsat varování s návrhem nejbližšího známého názvu. To by
`DATABASE_URL_BACKUP` odhalilo první minutu.

---

## 6. Otevřené otázky pro majitele produktu

1. **Má nová verze odmítnout nastartovat instalaci, která dosud běžela bez
   `DATABASE_URL_MAINTENANCE` a `DATABASE_URL_GDPR`?** Návrh říká ano a je to jediné
   místo, kde beru vědomé rozbití zpětné kompatibility. Měkčí varianta je jedno vydání
   varovat a teprve další odmítnout. Rozhodnutí je obchodní, ne technické.

2. **Má instalační průvodce v prohlížeči ukazovat stav konfigurace?** Dnešní průvodce
   zakládá jen prvního správce a první projekt (`packages/core/src/identity/setup.ts`),
   ke konfiguraci se nevyjadřuje. Nabízí se jako první obrazovka po instalaci ukázat
   výsledek `mlain doctor` v podobě, kterou člověk přečte. Je to práce navíc a je to
   rozhodnutí o rozsahu.

3. **Co s těmi 26 nečtenými proměnnými?** Tři cesty: dopsat čtení, odstranit ze
   schématu, nebo je označit jako rezervované. Rozhodovat se má u každé zvlášť,
   ale `DATABASE_STATEMENT_TIMEOUT_MS`, `MIGRATE_LOCK_TIMEOUT_SECONDS` a `S3_*` jsou
   podle mě samostatné úkoly, ne položky tohohle plánu.

4. **Co s rolí `mlain_backup`?** Existuje v každé instalaci, vidí všechna data napříč
   projekty, nikdo se pod ní nepřipojuje a u přibaleného Postgresu má heslo `mlain`
   (viz 2.5). Zapojit, nebo zrušit. Je to bezpečnostní rozhodnutí, ne úklid.

5. **Dokumentace si u retence protiřečí a je potřeba rozhodnout, která verze platí.**
   Tohle není otázka na rozsah, je to nález. `docs/operations/partitions-retention.md:17-19`
   (revize 8. 8. 2026) říká: „Úklid dělá instalace sama: noční úloha workeru
   `platform.maintain_partitions` (cron `5 2 * * *`). Nemusíte nic nastavovat."
   Fronta v registru skutečně je (`packages/core/src/queues/registry.ts:137`).
   Jenže `README.md:218-220` pořád tvrdí opak, a to i s vysvětlením, proč to prý
   frontou být nemůže: „`mlain partitions` je jediné místo, kde se uklízí odeslaná
   pošta, a **musíte ho sami zapsat do plánovače** … Není to úloha ve frontě schválně."
   Totéž `.env.example:140` a `install-external-postgres.md:299-301`. Jedna z těch
   dvou vět je nepravdivá a stojí za nimi osobní údaje příjemců v
   `messages.render_data`. Ověřit na běžícím systému, ne čtením, a špatnou verzi
   smazat. Poznámka: totéž nepravdivé tvrzení nese i `CLAUDE.md`.

---

## 7. Pořadí prací

Řazeno podle poměru užitku k rozsahu, ne podle velikosti.

0. Odkázat na `/setup`. Buď z přihlašovací obrazovky, dokud instalace není dokončená,
   nebo přesměrováním z kořene, plus řádek do logu entrypointu. Nejmenší změna
   v celém dokumentu a jediná, která rozhoduje o tom, jestli se člověk do čerstvé
   instalace vůbec dostane.
1. Doplnit README o `DATABASE_URL_MAINTENANCE` a `DATABASE_URL_GDPR`, opravit
   `cp .env.example apps/web/.env.local` a rozhodnout rozpor u retence (otázka 5).
   Změna dokumentace, žádný kód, a odstraní přímou příčinu incidentu.
2. Kořenový `.env` a `tools/dev/start.sh`, tedy rozhodnutí 3. Odstraní celou třídu
   „proměnná existovala jen v jednom terminálu".
3. Varování na neznámé proměnné v `loadConfig()`.
4. Povinnost podle `MODE`, tedy rozhodnutí 1, včetně skutečného ověření spojení
   v readiness workeru.
5. `mlain doctor` dostane všech pět připojení a ke každému nález.
6. `mlain provision-roles`.
7. Generovaná referenční tabulka konfigurace a rozdělení `.env.example`.
8. Brána parity konfigurace TS proti Go v CI, tedy zapojení manifestu, kvůli kterému
   vznikl (viz 2.6).

Mimo pořadí, protože to nejsou úkoly konfigurace, ale nálezy, které je škoda ztratit:
`POSTGRES_PASSWORD` mění heslo jedné roli z šesti, entrypoint toleruje neúspěšnou
migraci, `try/catch` chybí v `instrumentation.ts`, seznam úloh ve varování workeru je
neúplný a zastaralý, `domain.recheck` je nezapojená fronta, a role `mlain_backup`
existuje s `pg_read_all_data` a bez uživatele.
