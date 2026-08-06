# Nálezy P16 proti jiným plánům

> **ČTĚTE TOHLE DŘÍV NEŽ ZBYTEK. Tenhle dokument je snímek k 2026-08-02, ne
> popis dnešního stavu.**
>
> Slova „otevřené" a „blokuje" níž platila **tehdy**. Velká část z nich je dnes
> opravená a některé nálezy popisují stav produktu, který už neexistuje
> (nejkřiklavější: A5 tvrdí, že `mlain migrate` není implementovaný, přitom
> `apps/cli/src/commands/migrate.ts` existuje a v registru má
> `implemented: true`).
>
> **Nepoužívejte tenhle dokument jako seznam práce.** K tomu slouží
> `docs/superpowers/plans/NALEZY-NAPRIC-PLANY.md`
> a `docs/superpowers/plans/STAV-IMPLEMENTACE.md`. Tady je hodnota jinde:
> v popisu, JAK se ty vady projevily a proč je testy nechytily.
>
> Revize hlavičky: 2026-08-06. Text nálezů se schválně nemění, je to záznam.

## Co z toho k 2026-08-06 už neplatí

Ověřeno čtením zdrojů, ne odhadem. Sloupec „důkaz" říká, kde se to dá zkontrolovat.

| Nález | Tvrdí | Dnes | Důkaz |
|---|---|---|---|
| A3 | CLI bundluje nativní `.node` | opraveno | `apps/cli/build.mjs`, `external: ['@node-rs/argon2']` |
| A5 | `mlain migrate` není implementovaný | opraveno | `apps/cli/src/commands/migrate.ts`, registr má `implemented: true` |
| A6 | readiness vrací 200 bez schématu | opraveno | `apps/web/src/app/api/health/ready/route.ts` volá `schemaCheck()` |
| A8 | `.env.local` se dostává do image | opraveno | `.dockerignore` má `**/.env` a `**/.env.*` |
| A9 | `next build` vyžaduje běhovou konfiguraci | opraveno | `apps/web/src/app/t/[[...path]]/route.ts`: `export const dynamic = 'force-dynamic'` |
| A10 | `@node-rs/argon2` chybí v runtime image | opraveno | `docker/collect-runtime-deps.mjs` a ověřovací `RUN` v Dockerfilu |
| A11 | brána velikosti skončí nulou | planý poplach | `tools/ci/image-size.mjs` má `process.exit(1)` při překročení |
| B1 | chybí skript `test:e2e:golden` | opraveno | `apps/web/package.json`, a `ci.yml` ukládá `playwright-report-golden` |
| B2 | konfigurace P05 sbírá i zlatou cestu | opraveno | `apps/web/playwright.config.ts`: `testIgnore: '**/golden/**'` |
| B3 | Dockerfile nekopíruje LICENSES | opraveno | `docker/Dockerfile`: `COPY … LICENSES /app/LICENSES` |
| B4 | zkušební režim nemá API ani obrazovku | opraveno | trasa `…/settings/sending` v `apps/web/src/app` |
| B5 | systémovou poštu nikdo nezapojil | opraveno | `packages/core/src/platform/system-mail-runtime.ts` volá `setSystemMailer()` |
| B7 | chybí obrazovky kampaní a odesílání | opraveno | adresáře `campaigns`, `settings/sending` v `apps/web/src/app` |

Nálezy **B6** (průvodce importem četl vlastní výchozí hodnoty místo stavu ze
serveru) a části A-bis se tímhle způsobem ověřit nedaly; jestli platí, se pozná
jedině spuštěním, ne čtením.

---

Stav k 2026-08-02, po úkolech 28 až 36 (E2E zlatá cesta).

Každý nález má číslo rozhraní z kapitoly 0.6 plánu P16, adresáta a **červený test,
který ho doloží spuštěním**. P16 nic z toho neopravuje sám: soubory patří jiným
plánům a oprava mimo vlastnictví by jen přesunula vadu jinam.

Plán: `docs/superpowers/plans/2026-07-31-p16-onboarding-provoz-zalohy-e2e.md`

---

## A. Blokátory, které brání postavit produkční image

Bez produkční image nejde spustit `docker compose`, tedy ani zlatá cesta, ani
job `build-image` a `e2e` v CI. Tohle jsou nálezy s nejvyšší prioritou.

Řetěz se odkrýval po vrstvách: každá oprava odhalila další vadu, která byla do té
doby schovaná za tou předchozí. Stav níže je po opravách, které proběhly během
práce na úkolech 28 až 36.

| # | Vada | Stav |
|---|---|---|
| A1 | lockfile vs. `packages/emails/package.json` | **opraveno** |
| A2 | doména `<x>/jobs` nejde vyřešit kvůli vzorům v `exports` | **opraveno**, vzor zrušený a hlídá ho codegen |
| A3 | `apps/cli` bundluje nativní `.node` | **opraveno** |
| A4 | chybějící `export const handlers` ve třech doménách | **opraveno** |
| A5 | `mlain migrate` není implementovaný | **opraveno** |
| A6 | readiness vrátí 200 na instalaci bez schématu | **opraveno**, chybějící schéma je teď `fail` |
| A7 | `apps/cli` nedeklaruje `@mlain/db` | **opraveno** |
| A8 | vývojářský `.env.local` v build kontextu | **opraveno**, `.dockerignore` |
| A9 | `next build` vyžaduje běhovou konfiguraci | **opraveno**, `rateLimitRules()` je líná |
| A10 | `@node-rs/argon2` chybí v runtime image | **opraveno**, kontrola je i v runtime vrstvě |
| A11 | brána velikosti image | **planý poplach**, viz níž |
| A12 | image nad limitem 250 MB | **opraveno**, 244 MB |

### A11 nebyla vada, byl to artefakt měření

`tools/ci/image-size.mjs` návratový kód vrací správně. Nula vyjde jedině tehdy,
když se výstup prožene rourou:

```
node tools/ci/image-size.mjs <image>              EXIT=1
node tools/ci/image-size.mjs <image> | tail -1    EXIT=0   <- kód `tail`, ne skriptu
```

V `ci.yml` se skript volá přímo, takže job spadne. Zapsáno proto, že to stálo
tři zprávy a příště se to nemá opakovat: exit kód se měří bez roury, nebo se
zapne `set -o pipefail`.

### A12 velikost image: 9 MB map zdrojů

Naměřeno v hotové image:

```
/app/apps/cli/dist/main.js.map      5,1 MB
/app/apps/worker/dist/main.js.map   4,0 MB
```

Pět největších vrstev pro srovnání: základ `node:24.18.1-alpine` 148 MB,
`.next/standalone` 54,7 MB, binárka senderu 21 MB, kořen Alpine 8,66 MB,
`apps/cli/dist` 8,27 MB. Základ Node je 157 MB a ten se zmenšit nedá.

Dvě stopy, které se NEPOTVRDILY a nemá cenu je zkoušet znovu:
`postgresql18-client` má 3,8 MB, mapy ve `.next/standalone` jen 244 kB.

Mapy se ořezávají ve fázi **builderu**, ne v runtime vrstvě. Vrstvy jsou
přírůstkové, takže smazání souboru v pozdější vrstvě ho z image neodstraní,
jen ho skryje, a velikost by zůstala stejná.

**Image se po opravách A1 až A5 a A7 poprvé postavila celá** (`BUILD_EXIT=0`,
265 MB), takže A8 až A11 jsou vady, které se do té doby nemohly ukázat.

### A1. Lockfile se rozešel s `packages/emails/package.json` (opraveno)

| | |
|---|---|
| Adresát | vlastník `pnpm-lock.yaml` (hlavní agent) |
| Doloží | `docker build -f docker/Dockerfile .` |
| Stav | **opraveno**, fáze `node-deps` projde |

```
ERR_PNPM_OUTDATED_LOCKFILE  Cannot install with "frozen-lockfile" because
pnpm-lock.yaml is not up to date with <ROOT>/packages/emails/package.json
specifiers in the lockfile don't match specifiers in package.json:
* 1 dependencies were added: zod@4.4.3
```

Oprava: `pnpm install --lockfile-only`.

### A2. `@mlain/core/platform/jobs` nejde vyřešit (opraveno během práce)

| | |
|---|---|
| Adresát | vlastník `packages/core/package.json` |
| Doloží | build workeru |
| Stav | **opraveno** jiným agentem během běhu; zapsané kvůli vzoru, který se vrátí |

`exports` obsahovaly `"./*/jobs"` i `"./platform/*"`. Node i esbuild vybírají
vzor s nejdelší částí před hvězdičkou, takže pro `./platform/jobs` vyhrál
`./platform/*` a rozvinul se na `./src/platform/jobs.ts`, což je adresář.

```
src/handlers.generated.ts:5:31: ERROR: Could not resolve "@mlain/core/platform/jobs"
  The module "./src/platform/jobs.ts" was not found on the file system
```

**Vzor tiká dál a už jednou vystřelil.** Necelou hodinu po opravě platformy
přibyl do `exports` vzor `"./ai/*": "./src/ai/*.ts"` a build spadl znovu, jen
o doménu vedle:

```
@mlain/worker:build: ✘ [ERROR] Could not resolve "@mlain/core/ai/jobs"
src/handlers.generated.ts:5:31: ERROR: Could not resolve "@mlain/core/ai/jobs"
```

Kontrola všech domén s frontami proti vzorům v `exports` (základ `./ai/` má
čtyři znaky, `./` dva, takže obecný `./*/jobs` prohrává):

| Doména | Konkurenční vzor | Stav |
|---|---|---|
| `platform` | `"./platform/*"` | podchycená explicitním klíčem |
| `ai` | `"./ai/*"` | **padá** |
| `segments`, `contacts/import`, `contacts/export` | žádný | v pořádku |

**Pořadí klíčů v `exports` nepomůže**, Node ani esbuild ho neberou v potaz.
Trvalé řešení je explicitní klíč na každou doménu s frontami, nebo zrušit obecný
vzor `"./*/jobs"` úplně, aby chybějící zápis padal hlasitě hned, ne tiše až
u další domény.

### A3. `apps/cli` bundluje nativní `.node` (otevřené, blokuje image)

| | |
|---|---|
| Adresát | P01, `apps/cli/build.mjs` |
| Doloží | `docker build -f docker/Dockerfile .` |
| Stav | **otevřené**; worker opravený, CLI ne |

```
@mlain/cli:build: ✘ [ERROR] No loader is configured for ".node" files:
  .../@node-rs/argon2-linux-arm64-musl/argon2.linux-arm64-musl.node
```

Ve `apps/worker/build.mjs` už `external: ['@node-rs/argon2']` doplněný je,
v CLI chybí. **Navazující nález:** runtime vrstva image `@node-rs/argon2`
v `node_modules` nemá, ověřeno `docker run --rm --entrypoint sh <image> -c
"ls /app/node_modules/@node-rs"` → `No such file or directory`. Externalizace
tedy sama o sobě nestačí, Dockerfile musí balíček do image dostat.

### A4. `handlers` se ze `segments/jobs/queue-handlers.ts` neexportuje (opraveno)

| | |
|---|---|
| Adresát | vlastníci `packages/core/src/{segments,contacts/import,contacts/export}/jobs/queue-handlers.ts` |
| Doloží | build workeru |
| Stav | **opraveno** ve všech třech doménách |

Vada byla tichá: soubor se zkompiluje, typová kontrola i testy projdou a spadne
až esbuild. Jméno `handlers` je kontrakt s codegenem workeru, ne stylová volba.

```
src/handlers.generated.ts:6:9: ERROR: No matching export in
  "../../packages/core/src/segments/jobs/queue-handlers.ts" for import "handlers"
```

Codegen workeru očekává pojmenovaný export `handlers`, modul ho nemá.

### A5. `mlain migrate` není implementovaný (otevřené, blokuje instalaci)

| | |
|---|---|
| Adresát | P03, `apps/cli/src/commands/migrate.ts` a `dispatch.ts` |
| Doloží | `docker compose logs app` na čerstvé instalaci |

`apps/cli/src/registry.ts` má u příkazu `migrate` (`owner: 'P03'`)
`implemented: false`, v `dispatch.ts` pro něj není větev a soubor příkazu
neexistuje. Ostatních osm příkazů P16 hotových je.

`docker/entrypoint.sh` spouští při startu `mlain migrate` a **exit 69 schválně
toleruje**, takže kontejner nastartuje s prázdným schématem:

```
mlain migrate: not implemented in this build.
entrypoint: mlain migrate v tomhle buildu není implementovaný (exit 69, dodá plán P03).
            Pokračuji bez migrací.
```

Vzápětí padá worker, protože pg-boss nemá kde založit své schéma
(`error: permission denied for database mlain`, SQLSTATE 42501), a
`restart: unless-stopped` ho drží v restartové smyčce; naměřeno
`RestartCount 8`. Prohlížeč pak na `/setup` dostane `ERR_CONNECTION_REFUSED`.

**Bez tohohle příkazu nemůže zlatá cesta ani začít**, protože průvodce prvním
spuštěním nemá do čeho zapsat správce a projekt.

### A6. Readiness vrátí 200 na instalaci bez schématu (otevřené)

| | |
|---|---|
| Adresát | vlastník kontroly `schema` v `/api/health/ready` |
| Doloží | `curl /api/health/ready` na instalaci bez migrací |

```json
{"status":"ok","checks":[
  {"name":"database","status":"ok"},
  {"name":"schema","status":"skip","detail":"system_settings zatím neexistuje"}]}
```

Instalace, která nemá schéma, není připravená. Kontrola se místo selhání
**přeskočí**, takže readiness maskuje A5: global setup zlaté cesty na `200`
počká, prohlásí instalaci za nastartovanou a teprve prohlížeč zjistí, že nic
nefunguje. Je to táž třída vady jako zelený job, který nic nespustil, jen
o vrstvu níž.

### A8. Vývojářský `.env.local` se dostává do produkční image (otevřené)

| | |
|---|---|
| Adresát | P01, `.dockerignore` |
| Doloží | `docker build -f docker/Dockerfile .` na stroji, který `.env.local` má |

`.dockerignore` vylučuje `node_modules`, `.turbo`, `.next`, `dist`, `coverage`,
`.git`, `.github`, `data`, `docs`, `*.md` a `apps/sender/ml-sender`. **`.env*`
v něm není**, takže Next si při sestavení načte vývojářský soubor:

```
@mlain/web:build: - Environments: .env.local
@mlain/web:build: Error [ConfigError]: Konfigurace není platná, 1 problémů.
  issues: [{ variable: 'DATA_DIR',
             message: 'adresář /Users/…/.dev-data musí existovat a být zapisovatelný' }]
  exitCode: 78
```

Dva důsledky, druhý horší:

1. **CI o tom neví.** Čerstvý checkout `.env.local` nemá, takže `build-image`
   je zelený a lokální build padá pořád. Rozdíl mezi CI a stolem se hledá špatně.
2. **Cokoliv v `.env.local` se zapeče do vrstev image.** Dneska cesta, zítra
   klíč k providerovi nebo `SECRET_KEY`. Vrstvy jdou rozbalit i po smazání
   souboru. To je únik přístupů, ne kosmetika.

Oprava: `**/.env` a `**/.env.*` do `.dockerignore`.

### A9. `next build` vyžaduje běhovou konfiguraci (otevřené)

| | |
|---|---|
| Adresát | vlastník `/t/[[...path]]` a `loadConfig()` |
| Doloží | `docker build` bez `.env.local` |

Po odstranění `.env.local` se ukázalo, co pod ním bylo:

```
Collecting page data using 9 workers ...
Error [ConfigError]: Konfigurace není platná, 3 problémů.
  issues: [
    { variable: 'APP_URL',      message: 'je povinná (required) a chybí' },
    { variable: 'SECRET_KEY',   message: 'je povinná (required) a chybí' },
    { variable: 'DATABASE_URL', message: 'je povinná (required) a chybí' } ]
Error: Failed to collect page data for /t/[[...path]]
```

`next build` vyhodnocuje `loadConfig()` na úrovni modulu, takže **produkční
image nejde postavit bez `SECRET_KEY` a `DATABASE_URL`**. Job `build-image`
v CI předává jedině `IMAGE_VERSION`, takže musí padat taky, a job `e2e` na něm
visí přes `needs`.

Řešením **není** ta tajemství do buildu dodat: zapekla by se do vrstev image
a distribuovat by se nedala. Řešení je odložit načtení konfigurace do handleru,
nebo dát té trase `export const dynamic = 'force-dynamic'`.

Poznámka k případné „opravě přes CI": `turbo.json` běží v přísném režimu a
předává úkolům jen proměnné z `globalEnv` (`NODE_ENV`, `IMAGE_VERSION`, `CI`).
I kdyby se do `docker build` dodaly, turbo je odfiltruje.

### A10. `@node-rs/argon2` chybí v runtime image (otevřené)

| | |
|---|---|
| Adresát | P01, `docker/Dockerfile` nebo `apps/{worker,cli}/build.mjs` |
| Doloží | `docker compose up` a `docker compose logs app` |

Přímý následek oprav A3 a A6. `external` řekne esbuildu, ať balíček nebalí,
ale nikdo ho do image nedoručí:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@node-rs/argon2'
  imported from /app/apps/cli/dist/main.js
```

Táž hláška i pro `apps/worker/dist/main.js`. Kontejner skončí v restartové
smyčce (`Restarting (78)`). Ověřeno v image:
`ls /app/node_modules/@node-rs` → `No such file or directory`.

Dvě cesty: doručit balíček do runtime vrstvy (pozor na rozvržení pnpm, samotné
`node_modules/@node-rs` je symlink do `.pnpm`), nebo místo `external` použít
v `build.mjs` `loader: { '.node': 'copy' }`, aby zůstal dist samostatný.

### A11. Brána velikosti image hlásí překročení a skončí nulou (otevřené)

| | |
|---|---|
| Adresát | P01, `tools/ci/image-size.mjs` |
| Doloží | `node tools/ci/image-size.mjs <image>` |

```
Velikost ghcr.io/nc-mill/mlain:1.0.0: 252.4 MB, limit 250.0 MB.
Image překročila limit o 2.4 MB.
SIZE_EXIT=0
```

Skript překročení **správně spočítá a vypíše**, ale skončí nulou, takže krok
v jobu `build-image` projde. Je to táž třída vady jako zelený job, který nic
nespustil: brána existuje, měří správně a nic nezastaví.

---

## A-bis. Řetěz vad, které odhalil až běh proti produkční image

Po zprovoznění stavby se dal poprvé spustit kontejner a s ním zlatá cesta.
Odhalila devět dalších vad, které **žádný jednotkový test chytit nemohl**,
protože každá z nich žije až ve složení celku. Všechny jsou opravené.

| # | Vada | Proč to jinak nešlo najít |
|---|---|---|
| 1 | `mlain migrate` neimplementovaný, entrypoint toleroval exit 69 | kontejner nastartoval s prázdným schématem a tvářil se zdravě |
| 2 | readiness vracela 200 nad prázdným schématem (`schema: skip`) | maskovala vadu 1 |
| 3 | `TRACKING_DOMAIN` chybí v compose a TypeScript s Go si odporují v jejím tvaru | `load.ts` odvozuje holý host, `load.go:190` vyžaduje absolutní URL; sender nenastartuje tak jako tak |
| 4 | pg-boss neměl `CREATE` na databázi | `CREATE SCHEMA IF NOT EXISTS` kontroluje práva DŘÍV než existenci, ověřeno `SET ROLE mlain_app` |
| 5 | fronty nikdo nezakládal, když si je pg-boss přestal migrovat sám | v `pgboss.queue` byla 1 fronta proti 63 v registru |
| 6 | CSP blokovala inline skripty Nextu, React se nenamountoval | **produkt byl v produkci úplně neinteraktivní**; v dev režimu se to neprojevilo |
| 7 | `/setup` a `/forgot-password` byly SSG, takže do nich nonce nešel doručit | per-request nonce a předrenderované HTML se vylučují z principu |
| 8 | Next se v kontejneru vázal na `HOSTNAME`, které Docker nastavuje na ID kontejneru | loopback `ECONNREFUSED`, zvenčí přitom všechno fungovalo |
| 9 | `POST /api/v1/setup` nevydávalo relaci | uživatel po instalaci musel ručně zadat heslo, které právě zvolil |

K vadě 6 a 8 stojí za zapamatování jedno: **obě se projeví VÝHRADNĚ v produkční
image.** Dev server je neukáže ani jednu. Jediné místo, kde se dají chytit, je
běh proti `docker compose`, tedy přesně to, co zlatá cesta dělá.

---

## B. Rozhraní z kapitoly 0.6, která nejsou splněná

### B1. I→P01.4: zapojení zlaté cesty do CI

| | |
|---|---|
| Adresát | P01, `apps/web/package.json` a `.github/workflows/ci.yml` |
| Doloží | `apps/web/test/ci/e2e-wiring.test.ts`, tři červené položky |

1. `apps/web/package.json` nemá skript `test:e2e:golden`. Očekávaný tvar:
   `"test:e2e:golden": "playwright test -c playwright.golden.config.ts"`.
2. `test:e2e` je jen `playwright test`, takže konfiguraci zlaté cesty nikdo
   nespustí. Očekávaný tvar: `"test:e2e": "playwright test && pnpm run test:e2e:golden"`.
3. Job `e2e` neukládá `playwright-report-golden` jako artefakt, takže se pád
   zlaté cesty v CI vyšetřuje bez logu kontejneru, přestože ho global teardown
   vyrábí.

Job `e2e` naopak **má** limit 20 minut a spouští `test:e2e`, ty dvě kontroly jsou zelené.

### B2. I→P05.2 a rozsah konfigurace: P05 sbírá i zlatou cestu

| | |
|---|---|
| Adresát | P05, `apps/web/playwright.config.ts` |
| Doloží | `apps/web/test/ci/e2e-wiring.test.ts`, položka „konfigurace P05 zlatou cestu nesbírá" |

`playwright.config.ts` má `testDir: './e2e'`, takže si vezme i
`e2e/golden/specs/**`. Ověřeno: `playwright test --list` pod konfigurací P05
vypíše **55 testů v 11 souborech** včetně všech šestnácti scénářů zlaté cesty.
Ty ale potřebují běžící compose a poštovní past; pod konfigurací P05 se pustí
proti dev serveru a spadnou. Červená se pak přičte zlaté cestě, přestože vada je
v rozsahu konfigurace.

Oprava patří do P05: `testIgnore: 'golden/**'`.

### B3. I→P01.6: Dockerfile nekopíruje text licence do image

| | |
|---|---|
| Adresát | P01, `docker/Dockerfile` |
| Doloží | `apps/web/test/ci/license-obligations.test.ts`, druhý test |

Chybí `COPY LICENSES ./LICENSES` ve vrstvě runtime. Bez toho je licenční
povinnost LGPL u `sharp` (nález N15) splněná jen v repozitáři, ne v distribuované
image, a **to je porušení podmínek distribuce**, ne kosmetika. Plný text licence
v repozitáři už je: `LICENSES/LGPL-3.0.txt`, 7 652 bajtů, staženo z
`https://www.gnu.org/licenses/lgpl-3.0.txt`.

### B4. Zkušební režim nemá API ani obrazovku

| | |
|---|---|
| Adresát | P13 |
| Doloží | `golden-path.spec.ts` a `trial-mode.spec.ts` |

Doménová logika HOTOVÁ JE. `packages/core/src/providers/trial-mode.ts` má
`canSendInTrial()`, `trialAudienceNotice()` i `addTrialAddress()`, tedy přesně
to, co potřebuje jak zapnutí režimu, tak pruh na publiku podle 8.2.9.

Chybí nad tím všechno ostatní:

```
grep -rln "trial" apps/web/src --include='*.tsx'      -> ani jeden soubor
grep -rn  "trial" packages/core/src/providers/api/*.ts -> žádná trasa
```

Na obrazovce odesílání není nic o zkušebním režimu ani o ověřených adresách,
jsou tam jen účty, domény a brzdy doručitelnosti.

**Blokuje to celý zbytek zlaté cesty**, protože zkušební režim je podle
kapitoly 0.5 plánu odpověď na rozpor R2: doména se v testu ani v živém demu
neověřuje, protože DNS propagace trvá minuty až hodiny. Bez něj nejde ověřit
adresu, poslat testovací e-mail ani odeslat kampaň, a nedá se ověřit rozhraní
I→P13.2.

Je to potřetí za jeden den táž třída vady: **logika napsaná a otestovaná,
nikdo ji nezapojil.** Jednotkové testy `trial-mode.ts` jsou zelené a o tom, že
se k té funkci nikdo nedostane, nevědí nic.

### B5. Systémová pošta se nikdy nezapojila, e-maily se tiše zahazují

| | |
|---|---|
| Adresát | P13, start procesu |
| Doloží | `golden-path.spec.ts`, krok ověření adresy |

**Dopad je mimo zlatou cestu:** z instalace neodejde ŽÁDNÝ transakční e-mail.
Ověření adresy, obnova hesla, pozvánka do týmu, potvrzení odběru. Uživatel
vidí „potvrzení odesláno" a čeká na zprávu, která nikdy nepřijde.

Doslovně z logu běžící produkční image:

```
{"level":40,"template":"trial_address_verification","to":"overena@firma.cz",
 "locale":"cs","msg":"system_mail_not_configured"}
```

V pasti `total: 0`, ve frontě pg-boss žádná úloha; nic se ani nepokusilo doručit.

Výchozí implementace v `packages/core/src/platform/system-mail.ts` je
`LoggingSystemMailer`, která zprávu **jen zaloguje a zahodí**. Hned pod ní stojí

```ts
/** Skutečnou implementaci zapojí P13 při startu procesu. */
export function setSystemMailer(next: SystemMailer): void {
```

a tu funkci **nikdo nevolá**:

```
grep -rn "setSystemMailer" --include='*.ts' apps packages | grep -v system-mail.ts
packages/core/src/platform/system-mail.test.ts:31   <- jediné volání, a to v testu
```

V produkci se navíc neloguje ani odkaz, takže se to nedá obejít ani ručně.

**Ověření po opravě nesmí být „hláška zmizela".** Důkaz je, že
`curl http://localhost:8125/api/v1/messages` po žádosti o ověření vrátí
`total: 1` a ve zprávě je odkaz na potvrzení.

### B6. Průvodce importem: obrazovka odporuje serveru

| | |
|---|---|
| Adresát | P07, `apps/web/src/features/import/**` |
| Doloží | `golden-path.spec.ts`, krok 3 |

Krok 2 průvodce („Kontrola souboru") u `contacts-50.csv` ukazuje:

```
paragraph: Žádný řádek, z toho 1 hlavička, tedy žádný kontakt
combobox "Oddělovač": option "Středník" [selected]
```

Server má přitom uloženo něco jiného, doslovně z tabulky `imports`:

```
filename:   contacts-50.csv     byte_size: 2779        <- celý soubor
delimiter:  ,                   <- ČÁRKA, detekovaná správně
encoding:   utf-8               has_header: t
mapping:    {"0":{"target":"first_name"},"1":{"target":"email"}, …}
status:     previewing          total_rows: (prázdné)
```

Dvě vady, každá zvlášť blokující:

1. **Obrazovka nečte stav importu ze serveru.** Ukazuje výchozí „Středník"
   a nulový počet, přestože v databázi je `,`. Uživatel podle toho sáhne na
   nastavení, které je správně, a rozbije si ho.
2. **Import uvízne ve stavu `previewing`** a `total_rows` zůstane prázdné.
   Ruční přepnutí oddělovače na „Čárka" s tím nepohne, ověřeno.

Je to táž rodina jako panel onboardingu, jen horší: data na serveru jsou
v pořádku a obrazovka místo prázdna ukazuje **nesprávná čísla**.

**Příčina, dohledaná v `apps/web/src/features/import/import-wizard.tsx`,
funkce `loadPreview`:**

```ts
const res = await fetch(`/api/v1/contacts/imports/${importId}/preview`, …);
if (!res.ok) return;          // <- tichý přeskok
setPreview(await res.json());
```

Když `/preview` selže, `preview` zůstane `null` a obrazovka ukáže výchozí
hodnoty, tedy středník a nulu. Nikde se to neukáže ani nezaloguje.

**Ověření po opravě:** krok 2 musí u `contacts-50.csv` ukázat 50 kontaktů
a mít vybranou „Čárku", tedy to, co má server.

Cestou se ukázalo, že průvodce má **šest kroků**, ne čtyři jako v plánu:
Nahrání, Kontrola souboru, Mapování, Náhled, Volby, Spuštění. V kroku Volby
je navíc povinné zaškrtnutí právního důvodu, se kterým plán nepočítal.

### B7. Obrazovky, které zlatá cesta potřebuje a které v aplikaci nejsou

| | |
|---|---|
| Adresát | P13 (odesílání, kampaně), P14 (report) |
| Doloží | `golden-path.spec.ts`, `trial-mode.spec.ts` |

V `apps/web/src/app` neexistuje ani jedna z těchto cest:

| Cesta | Kdo ji vlastní | Který krok zlaté cesty na ní stojí |
|---|---|---|
| `/w/{slug}/settings/sending` | P13 | krok 2, připojení odesílání a zkušební režim |
| `/w/{slug}/campaigns` | P13 | kroky 6 a 7, kampaň a živý průběh |
| report kampaně | P14 | krok 9 |

Rozhraní **I→P13.1** (kontrolní seznam pozná ukázkové publikum) a **I→P13.2**
(pruh s počtem ověřených adres, zmírnění rizika 8.2.9) proto zatím nejdou ověřit
jinak než tím, že jejich testy jsou červené.

---

## C. Vady, které našel běh a které si P16 opravil sám

Zapsané proto, že jsou to odchylky od doslovného znění plánu. Všechny jsou
v souborech, které P16 vlastní.

| # | Co plán říká | Co běh ukázal | Jak je to teď |
|---|---|---|---|
| C1 | `cwd: process.cwd()` u volání `docker compose` | Playwright běží v `apps/web`, takže `docker/compose.yml` neexistuje: `open /…/apps/web/docker/compose.yml: no such file or directory` | `cwd: REPO_ROOT`, kořen se hledá podle `pnpm-workspace.yaml` |
| C2 | volání compose bez proměnných prostředí | `docker/compose.yml` má `APP_URL: ${APP_URL:?}` a `SECRET_KEY: ${SECRET_KEY:?}`; interpolace běží u KAŽDÉHO podpříkazu, takže i `logs` skončí na `required variable APP_URL is missing a value` | `env: COMPOSE_ENV` u všech volání |
| C3 | global teardown bez `--profile bundled` | `down` nezastaví `postgres`, protože je za profilem; po běhu zůstal běžet kontejner a další běh by nejel na čisté instalaci | profil doplněn i do teardownu |
| C4 | bind mount `./data` a `./data/postgres` | `down --volumes` bind mount nemaže, takže slib „zlatá cesta jede na čisté instalaci" neplatil | overlay přepíná obojí na pojmenované svazky |
| C5 | `psql -U postgres` | role `postgres` v instalaci neexistuje, compose má `POSTGRES_USER: mlain_migrator`: `FATAL: role "postgres" does not exist` | `-U mlain_migrator` |
| C6 | `new URL('../../../../', import.meta.url)` v testech CI | `apps/web` má vitest v jsdom, kde `import.meta.url` není `file:`: `TypeError: The URL must be of scheme file` | kořen se hledá vystoupáním od `process.cwd()` |
| C7 | `(?=^\s{2}\w\|\Z)` v regulárním výrazu nad CI | `\Z` není v JavaScriptu kotva konce vstupu, ale písmeno Z; ESLint to hlásí jako `no-useless-escape` | blok jobu se řeže po řádcích |
| C8 | `restart: no` v YAML | nekvotované `no` je v YAML boolean `false`, ne řetězec | `restart: "no"` |
| C9 | teardown spoléhá na `docker compose down` | `down --volumes` nechal běžet všechny tři kontejnery projektu, protože aplikace byla v restartové smyčce; na sdíleném stroji se z toho nasbírají desítky kontejnerů | po `down` následuje pojistka, která zbytky dohledá podle štítku projektu a odstraní tvrdě |
| C10 | `http://localhost:3000` natvrdo v testu banneru | port je parametrizovaný, takže na jiném portu by test hlásil pád banneru, přestože banner je v pořádku | adresa se bere z `APP_URL` |

---

## D. Co je ověřené spuštěním

| Věc | Jak ověřená |
|---|---|
| Poštovní past skutečně zachytí odeslaný e-mail | Mailpit v1.21, surový SMTP dialog, zpráva přijata (`250 2.0.0 Ok: queued as WGfDGpZZzYjntNF8ojqDBD`), klient ji našel podle adresáta i předmětu, přečetl HTML včetně diakritiky a vytáhl z něj proklik i sledovací pixel |
| Klient pasti nevrací zprávu, která tam není | negativní kontrola na neexistujícího adresáta skončila výjimkou, ne úspěchem |
| Sada zlaté cesty není prázdná | `playwright test -c playwright.golden.config.ts --list` → **16 testů v 5 souborech** |
| Prostředí naskočí a uklidí se | compose overlay nastartoval Mailpit i Postgres jako zdravé, `/api/health/ready` vrátilo 200, teardown uložil `playwright-report-golden/compose-logs.txt` a smazal všechny kontejnery i svazky |
| Hlídač CI pozná tichý přeskok | šest kontrol, z toho jedna se ptá přímo Playwrightu, kolik testů konfigurace nachází |
