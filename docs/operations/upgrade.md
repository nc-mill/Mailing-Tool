# Upgrade instalace

**K čemu to je:** postup, jak přejít na novější image, aniž by se cestou ztratila
data nebo rozešlo schéma s aplikací.

Revize: 2026-08-06. Příkazy `mlain` ověřené proti `apps/cli/src/registry.ts`,
jména služeb proti `docker/compose.yml` a `docker/compose.scale.yml`
(`docker compose config --services`).

## Nejdřív si ujasněte, v jakém režimu běžíte

Od toho se liší úplně všechno, co je níž.

| Režim | Čím se pozná | Co v něm běží |
|---|---|---|
| **Jeden kontejner** (výchozí) | spouštíte `docker compose up -d` nad samotným `docker/compose.yml` | jediná služba `app` s `MODE=all`: web, worker i sender jsou procesy uvnitř ní |
| **Rozdělený** | spouštíte `docker compose -f compose.yml -f compose.scale.yml up -d` | služby `app` (`MODE=web`), `worker` a `sender`, každá ve vlastním kontejneru |

Databáze je ve výchozí instalaci služba `postgres` za profilem `bundled`, takže
u příkazů, které se jí týkají, patří `--profile bundled`.

> **Pozor, dřív tady stálo `docker compose stop worker sender` bez rozlišení
> režimu. Ve výchozí instalaci to NEFUNGUJE:**
>
> ```
> $ docker compose stop worker
> no such service: worker
> ```
>
> Služby `worker` a `sender` zavádí až `compose.scale.yml`. Ověřeno spuštěním
> 2026-08-06.

## Jednoduchá cesta

Pro malé instalace a pro vývoj.

```bash
docker compose pull
docker compose up -d
```

Migrace se aplikují při startu (`MIGRATE_ON_START`, výchozí `true`), runner drží
advisory lock, takže i při víc instancích migruje právě jedna. Když migrace
spadne, kontejner nenaběhne a `/api/health/ready` nevrátí 200.

## Opatrná cesta

Pro produkci. `mlain upgrade` udělá zálohu **před** migrací, takže je kam se
vrátit.

Příkaz odmítne běžet, dokud jsou k databázi připojené procesy s
`application_name` `mlain-worker` nebo `mlain-sender`. Musíte je tedy zastavit
sami, a jak, to závisí na režimu.

### Rozdělený režim

```bash
# 1. Zastav worker a sender.
docker compose -f compose.yml -f compose.scale.yml stop worker sender

# 2. Spusť upgrade ve stále běžícím webovém kontejneru.
docker compose exec app mlain upgrade

# 3. Spusť procesy zpět.
docker compose -f compose.yml -f compose.scale.yml start worker sender

# 4. Ověř.
docker compose exec app mlain doctor
```

### Jeden kontejner (`MODE=all`)

Tady worker a sender samostatně zastavit nejdou, jsou to procesy uvnitř téhož
kontejneru jako web. Zastavuje se celý `app`, a protože pak není v čem spustit
`exec`, pouští se CLI v jednorázovém kontejneru:

```bash
# 1. Zastav celou aplikaci.
docker compose stop app

# 2. Spusť upgrade v jednorázovém kontejneru.
#    --entrypoint je nutný: ENTRYPOINT image spouští docker/entrypoint.sh,
#    který argumenty ignoruje a rozjel by procesy podle MODE.
docker compose run --rm --entrypoint /usr/local/bin/mlain app upgrade

# 3. Nastartuj zpět.
docker compose up -d

# 4. Ověř.
docker compose exec app mlain doctor
```

> Krok 2 je **odvozený z `docker/Dockerfile`**
> (`ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]`), ne ověřený
> spuštěním proti hotové image. Když vám `run` nesedne, zbývá jednoduchá cesta
> výš: `docker compose up -d` s novou image zmigruje při startu sám, jen bez
> zálohy předem. **Zálohu si v tom případě udělejte ručně** příkazem
> `docker compose exec app mlain backup`, dokud stará verze ještě běží.

### `mlain upgrade` procesy nezastavuje ani nespouští

Je to vědomá odchylka od kapitoly 3.14 specifikace a stojí za ní bezpečnost, ne
lenost.

Aby příkaz uvnitř kontejneru zastavil jiný kontejner, potřeboval by **docker
socket namontovaný dovnitř**. Docker socket uvnitř kontejneru je fakticky root
na hostiteli: kdokoliv, kdo se do kontejneru dostane, umí spustit privilegovaný
kontejner s namontovaným kořenovým svazkem. Aplikační kontejner přitom běží
`read_only: true`, pod uživatelem 10001 a s `no-new-privileges`. Socket dovnitř
by celý ten model zahodil kvůli jediné pohodlné funkci.

Co `mlain upgrade` místo toho dělá:

1. **preflight**: přes `pg_stat_activity` ověří, že k databázi není připojený
   `mlain-worker` ani `mlain-sender`, a když je, skončí kódem 75 a řekne který,
2. **záloha**: spustí totéž co `mlain backup`,
3. **migrace**: pustí migrační runner,
4. **granty**: zavolá `mlain_apply_grants()`,
5. **readiness**: sáhne na `${APP_URL}/api/health/ready`,
6. **výpis**: vypíše přesné příkazy na návrat procesů.

Zastavení a spuštění procesů je tedy na tobě a runbook to říká nahlas, aby to
nebylo překvapení uprostřed odstávky.

> **Nález k 2026-08-06, ODVOZENÝ ZE ZDROJOVÉHO KÓDU, ne ověřený spuštěním.**
> Krok 3 podle všeho v produkční image selže: `packages/core/src/ops/upgrade.ts`
> volá `runMigrations({ url })` **bez cesty k migracím**, takže se použije
> výchozí odvození `../migrations` vůči modulu. Zabundlované CLI leží
> v `/app/apps/cli/dist/main.js`, migrace v `/app/packages/db/migrations`, takže
> cesta vyjde na `/app/apps/cli/migrations` a runner skončí na
> `ENOENT ... meta/_journal.json`. Táž vada je popsaná
> v `apps/cli/src/migrations-folder.ts` jako už jednou opravená u
> `mlain backup verify`; `upgrade` a `restore` z té opravy vypadly.
>
> **Co to znamená prakticky:** záloha (krok 2) proběhne, migrace ne, a příkaz
> skončí chybou. Databáze zůstane na staré verzi schématu, tedy nerozbitá.
> Náhradní postup je jednoduchá cesta výš (`docker compose up -d`), kde migruje
> `docker/entrypoint.sh` a cesta k migracím se řeší správně přes
> `apps/cli/src/migrations-folder.ts`.

## Když upgrade spadne

| Kde | Co udělat |
|---|---|
| preflight hlásí běžící proces | zastav ho podle svého režimu a zopakuj; sender uprostřed dávky by po migraci psal do starého schématu |
| migrace | obnov ze zálohy, kterou upgrade právě udělal, a nahlas chybu; migrace jsou v transakci, ale schéma po částečném běhu neověřuj odhadem |
| readiness | image a schéma se rozešly, zkontroluj, že běží ta verze image, kterou jsi chtěl |

### Návratové kódy, a čí jsou

Rozlišení není hnidopišství: podle kódu se pozná, jestli má smysl příkaz
zopakovat.

| Kód | Kdo ho vrací | Význam |
|---|---|---|
| 0 | oba | hotovo |
| 3 | `mlain migrate` | migrace spadla, runner vypíše kterou |
| 4 | `mlain migrate` | **přeskočená major verze**, mezi tvojí a cílovou verzí je vydání, přes které se musí projít |
| 5 | `mlain migrate` | `schema_version_ahead`, schéma je z novější aplikace, než je spuštěná image |
| 75 | `mlain migrate` | přetečené čekání na advisory lock migrací |
| 75 | `mlain upgrade` | preflight: worker nebo sender je pořád připojený |
| 78 | oba | konfigurace není platná, typicky chybí `DATABASE_URL_MIGRATOR` |

Kódy 3, 4 a 5 **`mlain upgrade` nevrací**, ověřeno v kódu: rozlišuje je jen
`runMigrateCommand`. Když migrace selže uvnitř `mlain upgrade`, výjimka projde
ven neodchycená a proces skončí kódem 1 se stackem. Přesnou příčinu proto hledej
ve výpisu, ne v návratovém kódu.
