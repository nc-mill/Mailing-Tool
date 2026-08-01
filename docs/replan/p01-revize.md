# Revize plánu P01: kostra monorepa, provoz, konfigurace a CI

Recenzovaný soubor: `docs/superpowers/plans/2026-07-31-p01-kostra-provoz-ci.md` (9720 řádků, 22 úkolů)
Datum: 2026-08-01
Metoda: čtení plánu plus ověření spuštěním proti PostgreSQL 18.4 v Dockeru a v Node

## Verdikt

**NALEZENY PROBLÉMY.**

Plán je řemeslně nadprůměrný. Registry jsou předdeklarované úplně dopředu, CI má všech sedmnáct jobů od prvního commitu, u každé závislosti je licence a rozhodnutí jsou odůvodněná konkrétní poruchou, ne vkusem. Vlastnictví souborů je vymezené třemi kapitolami a plán si sám vede tabulku požadavků na ostatní plány.

Problém není v kvalitě, ale v **rozhraní na P03**. P01 je ve vlně 0 první a P03 běží hned po něm, jenže mezi nimi je pět neuzavřených předání. Tři z nich se projeví tiše, tedy zeleným testem nad rozbitou produkcí. Nejzávažnější je, že **výmaz podle GDPR by v každé produkční instalaci nešel provést**, a migrace by přesto skončila úspěchem.

Jeden nález je vada uvnitř samotného P01: test, který nemůže proti vlastnímu artefaktu projít.

---

## Kritické nálezy

### K1. P01 zakládá čtyři databázové role, P03 jich potřebuje šest. Výmaz podle GDPR by nešel provést a nic by neselhalo

**Kde:** P01 úkol 19, krok 5, `docker/initdb/10-roles.sql` (řádky 7981 až 8033). Protistrana: P03 rozhodnutí R11 (řádek 55), kapitola 7 požadavek A na P01 (řádek 7169), migrace `0005_roles_grants.sql` (řádky 5253 až 5277).

P01 zakládá `mlain_app`, `mlain_sender` a `mlain_backup`, čtvrtou roli `mlain_migrator` dodává `POSTGRES_USER` v compose. P03 ale rozhodnutím R11 zavádí **šest** rolí: navíc `mlain_gdpr` s právem `DELETE ON consents` a `mlain_maintenance` s právem `DELETE ON web_events`. Obě jsou v P03 nutné, protože `consents` je append only a aplikační role na jejich smazání právo nemá.

Selhání je tiché ze tří důvodů naráz:

1. Migrace 0005 obaluje granty do `DO $$ ... EXCEPTION WHEN undefined_object THEN RAISE NOTICE`. Chybějící role tedy neshodí migraci, jen vypíše poznámku.
2. Testovací harness P03 si role **zakládá sám** jako superuživatel (P03 řádek 604, `for (const role of ROLES) su.query('CREATE ROLE ...')`), takže všech šest v testech existuje a testy jsou zelené.
3. Test v P01 (řádek 7799) kontroluje doslova „zakládá všechny **čtyři** role", takže počet čtyři cementuje a rozšíření nezachytí.

**Ověřeno spuštěním** proti PostgreSQL 18.4. Aplikoval jsem `10-roles.sql` z P01 doslova, pak bloky migrace 0005 pro `mlain_gdpr` a `mlain_maintenance`:

```
psql:/tmp/m0005.sql:8:  NOTICE:  role mlain_gdpr neexistuje, granty se přeskakují
psql:/tmp/m0005.sql:16: NOTICE:  role mlain_maintenance neexistuje, granty se přeskakují
DO
DO
### EXIT KÓD psql: 0
```

Granty na `consents` a `web_events` po migraci nemá nikdo kromě vlastníka. Job `gdpr.erase` se pod rolí `mlain_gdpr` navíc ani nepřipojí, protože role neexistuje.

**Dopad:** výmaz podle článku 17 GDPR je v produkci fyzicky neproveditelný, retenční mazání `web_events` také. Migrace přitom hlásí úspěch a celá testovací sada P03 je zelená.

**Kde opravit: v P01.** Soubor `docker/initdb/10-roles.sql` vlastní výhradně P01 (kapitola 1.1) a P03 do něj podle svého pravidla sáhnout nesmí. Doplnit `mlain_gdpr` a `mlain_maintenance` do bloku `DO $$` stejným tvarem jako ostatní tři, doplnit je do `GRANT CONNECT` a `GRANT USAGE ON SCHEMA public`, a v testu na řádku 7799 změnit výčet na všech šest rolí včetně názvu testu.

**Doplňkově v P03:** ta výjimka `WHEN undefined_object` je druhá polovina problému. Zapíná tichý režim i tam, kde má být hlasitý. Doporučuji ji zúžit tak, aby chybějící role byla `RAISE EXCEPTION` u produkčního běhu a `NOTICE` jen tehdy, když si běh výslovně vyžádá toleranci. To je ale rozhodnutí P03, ne P01.

---

### K2. Test P01 na idempotenci `10-roles.sql` nemůže proti vlastnímu souboru projít

**Kde:** P01 úkol 19, krok 1, test `docker/initdb/10-roles.sql` (řádky 7806 až 7811).

```js
it('je idempotentní, každý CREATE má ochranu proti opakování', () => {
  const text = sql();
  const creates = text.match(/CREATE ROLE/g) ?? [];
  expect(creates.length).toBe(0);
  expect(text).toContain('pg_catalog.pg_roles');
});
```

Soubor, který tentýž úkol o pár kroků dál zapisuje, obsahuje `CREATE ROLE` třikrát, uvnitř ochranných bloků `IF NOT EXISTS`. Assertion `toBe(0)` je tedy nesplnitelná.

**Ověřeno spuštěním.** Vytáhl jsem soubor z plánu (řádky 7981 až 8033) a pustil na něj logiku testu v Node:

```
Počet výskytů /CREATE ROLE/g v souboru: 3
Test P01 tvrdí: expect(creates.length).toBe(0)
VÝSLEDEK TESTU: SPADNE (3 != 0)
```

Plán u kroku 2 očekává, že test nejdřív spadne kvůli chybějícímu souboru, a po kroku 5 zezelená. Nezezelená nikdy. Blokuje to uzavření úkolu 19 a job `test-unit`.

**Kde opravit: v P01.** Záměr je zjevně „žádný `CREATE ROLE` není nechráněný". Napsat to tak, aby to ten záměr měřilo, například spočítat výskyty `CREATE ROLE`, které nemají v předchozích řádcích odpovídající `IF NOT EXISTS ... pg_catalog.pg_roles`, a na tenhle počet dát `toBe(0)`. Prostá kontrola `expect(text).toContain('pg_catalog.pg_roles')` je slabá, protože projde i tehdy, když je chráněná jen jedna role ze tří.

---

### K3. Bránu `migrations-check` nemá kdo odemknout, po merge P03 zablokuje všechny další merge

**Kde:** P01 úkol 20, `tools/ci/migrations-check.mjs` (řádky 8759 až 8787), workflow job 14 (řádky 9332 až 9361), tabulka požadavků P01-4 (řádek 9715). Protistrana: P03 úkol 29 (řádek 6820), kapitola 7 požadavek C (řádek 7171).

Skript je napsaný se záměrně obrácenou polaritou: chybějící `packages/db` je `SKIP`, ale **existující `packages/db` bez dodaných scénářů je `fail()`**. Odůvodnění v plánu je správné, bez toho by job zeleně nekontroloval nic.

Předání ale nesedí ani na jedné straně:

- P01 v požadavku P01-4 žádá P03, aby tři scénáře doplnil **do `tools/ci/migrations-check.mjs`**. Ten soubor je v kapitole 1.1 ve výhradním vlastnictví P01 a `tools/ci/**` je celý P01.
- P03 svoje pravidlo drží a do cizího souboru nesahá. Scénáře píše do `packages/db/test/migrations-check.test.ts` a spouští je skriptem `test:migrations` (P03 úkol 29).
- P03 v požadavku C naopak žádá, aby CI job `migrations-check` volal `pnpm --filter @mlain/db test:migrations`. Job v P01 ale volá `node tools/ci/migrations-check.mjs`.

Obě strany se tedy chovají podle svých pravidel a **výsledkem je blokující job, který po merge P03 selhává navždy**. Job je blokující (jeden ze šestnácti), takže od té chvíle neprojde žádný pull request.

**Kde opravit: v P01.** P03 má pravdu v tom, že do `tools/ci/` sahat nesmí, a jeho umístění scénářů je správné (potřebují Drizzle, migrace a testcontainers, což do samostatného `.mjs` skriptu nepatří). Upravit `tools/ci/migrations-check.mjs` tak, aby při existujícím `packages/db` delegoval na `pnpm --filter @mlain/db test:migrations` a selhal jen tehdy, když ten skript v `packages/db/package.json` chybí nebo selže. Zároveň zrušit požadavek P01-4, protože po téhle úpravě nemá co požadovat.

---

### K4. P03 zakládá barrel `packages/db/src/index.ts`, který test P01 zakazuje

**Kde:** P01 úkol 5, test integrity workspace, „žádný balíček nemá top level barrel" (řádky 1228 až 1238). Protistrana: P03 úkol 30 (řádek 6996, commit na řádku 7068, soupis vlastnictví na řádku 7123).

Test P01 prochází všech devět balíčků včetně `db` a pro každý ověřuje, že neexistuje `index.ts`, `index.tsx`, `src/index.ts` ani `src/index.tsx`. Hláška odkazuje na uzávěr S11 řídicího dokumentu, tedy „barrely se nezakládají, importuje se podcesta".

P03 v úkolu 30 zakládá `packages/db/src/index.ts` a commituje ho.

Je to stejná třída selhání jako K3: každá strana jedná podle svého plánu a kolize vznikne až po merge. Job `test-unit` je blokující.

**Kde opravit: rozhodnutím, pak v P03.** Uzávěr S11 je pravidlo řídicího dokumentu a P01 ho jen vynucuje, takže výchozí řešení je, že **barrel v P03 odpadne** a `packages/db` se importuje podcestami (`@mlain/db/schema`, `@mlain/db/client`), jak to ostatně P03 sám v kapitole 8 předpokládá („doménové plány schéma jen importují, `import { contacts } from '@mlain/db/schema'`"). Pokud se rozhodne, že `packages/db` má být výjimka, musí se výjimka zapsat do testu v P01, ne jen do prózy P03.

---

### K5. Požadavek P01-3 nikdo nepřijal: image by neobsahovala migrace a kontrola verze schématu by porovnávala s nulou

**Kde:** P01 tabulka požadavků P01-3 (řádek 9714), poznámka k Dockerfile (řádek 7652), `EXPECTED_SCHEMA_VERSION = 0` (řádky 4996, 5121, 5208), soupis předávaných míst (řádek 9695). Protistrana: P03, kde se nenachází nic.

P01 vědomě nezakládá `packages/db/migrations`, protože `COPY` na neexistující cestu by build image zabil, a explicitně píše, že řádek `COPY --from=node-builder /app/packages/db/migrations ./packages/db/migrations` **doplní P03**, a že je to jediná změna, kterou smí jiný plán v `docker/Dockerfile` udělat. Stejně tak P03 má nahradit `EXPECTED_SCHEMA_VERSION = 0` skutečným číslem.

Ověřil jsem obojí v P03: slova `Dockerfile`, `runtime.ts` ani `EXPECTED_SCHEMA_VERSION` se v celém plánu P03 **nevyskytují ani jednou**. P03 navíc ve svém kroku „Ověř, že plán nesáhl mimo své vlastnictví" výslovně říká, že objevení `docker/` v `git status` je chyba plánu a změna se má vrátit. P03 tedy požadavek nejen nepřijal, ale má napsané pravidlo, které jeho splnění zakazuje.

**Dopad, dvě samostatné vady:**

1. Produkční image neobsahuje migrace. `MIGRATE_ON_START=true` je výchozí a entrypoint spustí `mlain migrate`, který nemá co aplikovat. První instalace skončí s prázdným schématem.
2. `EXPECTED_SCHEMA_VERSION` zůstane 0, takže readiness endpoint porovnává verzi schématu s nulou. Kontrola `schema_version_ahead` (akceptační kritérium 13) je tím vyřazená.

**Kde opravit: na obou stranách, ale iniciativa je na P01.** Výjimku pro `docker/Dockerfile` P01 udělil jen ve své vlastní próze, kde ji P03 nikdy neuvidí. Buď P01 řádek `COPY` zapíše rovnou sám s podmíněným wildcardem (stejný trik, jaký už používá u `packages/contracts/fixtures` na řádcích 7564 až 7566, takže je ověřený a nezabije build na prázdné množině), nebo se požadavek musí zapsat do P03 jako úkol, ne do P01 jako přání. První varianta je lepší, protože nechává `docker/` u jediného vlastníka. Totéž platí pro `EXPECTED_SCHEMA_VERSION`: buď se čte za běhu z `_journal.json`, nebo to musí být úkol v P03.

---

## Důležité nálezy

### D1. `packages/db/package.json` a `tsconfig.json` zakládají dva plány

**Kde:** P01 kapitola 1.3 a úkol 5 (obsah manifestu na řádcích 1289 až 1302). Protistrana: P03 úkol 1 (řádky 225 a 226), oba uvedené jako `Create`.

P01 oba soubory zakládá jako součást devíti balíčků a jeho test integrity na nich kontroluje jméno, `license: MIT` a `private: true`. P03 je uvádí jako nově zakládané, tedy je přepíše celé.

Samo o sobě to není katastrofa, P02 dělá totéž u `packages/contracts` a **správně to přiznává** v kapitole 9.1 formulací „přebírá se prázdný manifest od P01 a přepisuje celý". Rozdíl je v tom, že P03 to nikde nepřiznává, takže při přepsání může vypadnout `license` nebo `private`, a spadne test v P01, u kterého nebude zřejmé proč.

**Kde opravit: v P03**, formulačně. Změnit `Create` na `Modify` a přidat větu, že manifest přebírá po P01 a musí v něm zachovat `name`, `license: MIT` a `private: true`. Případně to samé v kapitole 1.2 P01, kde `packages/db` v tabulce předávaných souborů chybí, přestože fakticky předávaný je.

### D2. Požadavek P03 na nastavení časové zóny v `docker/initdb` není splněn

**Kde:** P03 kapitola 7, požadavek B (řádek 7170). Protistrana: P01, kde chybí.

P03 žádá, aby `docker/initdb` nastavil `ALTER DATABASE ... SET timezone = 'UTC'`, protože `ALTER DATABASE` smí jen vlastník databáze nebo superuživatel, a `mlain_migrator` je ani jeden. Prohledal jsem P01 a takový příkaz v něm není nikde.

Dopad je menší než u K1, protože P03 si drží druhou pojistku: každé spojení nastavuje `options: '-c timezone=UTC'` a sám tu cestu označuje za jedinou spolehlivou u externí databáze. Testovací harness P03 si `ALTER DATABASE` zase provede sám (řádek 604), takže test na `SHOW timezone` (řádek 1129) je zelený i tak.

**Kde opravit: v P01.** Doplnit řádek do `docker/initdb`. Je to jeden příkaz a zavírá rozdíl mezi tím, co testy testují, a tím, co produkce dostane.

### D3. Kódy `schema_version_ahead` a `migration_lock_timeout` nejsou v registru chybových kódů

**Kde:** P01 úkol 6, registr (řádky 1555 až 2260). Protistrana: P03 `src/migrate.ts` (řádky 952 a 990), P16 (řádky 3029, 3090).

Zadání recenze uvádělo tři kódy. Ověřil jsem všechny:

| Kód | V registru P01 | Kdo ho používá |
|---|---|---|
| `contract_mismatch` | **ANO**, řádek 2115 | P09 (V2 až V5), P13 |
| `schema_version_ahead` | NE, jen jako řetězec v hláškách a testech | P03, P16 (jako `finding.id`) |
| `migration_lock_timeout` | NE, nikde v P01 | P03 (řádek 952) |

Pravidlo P01 v kapitole 1.4 je jednoznačné: „Chybový kód, fronta ani konfigurační proměnná se nezakládá za běhu doménového plánu. Tenhle plán je předdeklaruje všechny." P03 tedy dva kódy zavádí v rozporu s uzávěrem S7.

Zmírňující okolnost: obojí jsou kódy `MigrationError` s exit kódy CLI 5 a 75, což je šestý jmenný prostor, který registr P01 nemá (má `problem`, `validation`, `finding`, `message`, `import_row`). Není to tedy nedopatření v seznamu, ale mezera v členění.

**Kde opravit: v P01.** Buď zavést šestý druh (například `migration`) a oba kódy do něj předdeklarovat, nebo výslovně napsat, že kódy migračního runneru registru nepodléhají, protože nikdy neopustí CLI. Druhá varianta je levnější, ale musí být napsaná, jinak si každý další plán založí kód, kdy se mu zachce.

**Poznámka k evidenci:** nález N3 v `NALEZY-NAPRIC-PLANY.md` tvrdí, že `contract_mismatch` v registru chybí. **Už tam je** (řádek 2115). N3 lze uzavřít.

### D4. Čtrnáct kódů nálezů `mlain doctor` z P16 není ve `FINDING_CODES`

**Kde:** P01 úkol 6, `FINDING_CODES` (řádky 1953 až 1972, osmnáct položek). Protistrana: P16, kontroly doktoru.

`FINDING_CODES` obsahuje osmnáct kódů, všechny z preflightu kampaně a kontroly obsahu (`campaign_*`, `content_*`, `domain_*`, `provider_*`, `deliverability_degraded`). P16 ale používá vlastní sadu identifikátorů nálezů se `severity`, tedy přesně tvar, pro který je jmenný prostor `finding` určený:

`missing_key_generations`, `backup_stale`, `demo_data_present`, `secret_key_previous_empty`, `secret_key_fingerprint_mismatch`, `key_id_ceiling_near`, `data_volume_empty`, `no_backup_yet`, `backup_binary_missing`, `backup_binary_version_mismatch`, `schema_version_ahead`, `connection_pool_over_budget`, `trial_mode_enabled`, `check_failed`.

Ani jeden z nich v registru není. Existující revize P16 (`docs/replan/p16-revize.md`) tenhle rozpor nezachytila, takže je nový.

**Kde opravit: v P01.** Rozhodnout, jestli jsou nálezy doktoru tentýž jmenný prostor jako nálezy preflightu. Pokud ano, předdeklarovat všech čtrnáct. Pokud ne, zavést sedmý druh `doctor_finding` a napsat to do tabulky druhů v úkolu 6, aby P16 věděl, kam patří.

---

## Poznámky

- **Kapitola 1.2 je neúplná.** Uvádí jen soubory předávané P09. Fakticky P01 předává i `packages/*/package.json` a `tsconfig.json` u všech osmi neplatformních balíčků, což P02 v kapitole 9.1 správně popisuje a P03 ne. Doplnit řádek do tabulky 1.2 by ten rozdíl zavřelo systémově.

- **Kontrola `migrations-check` má ještě jednu polaritu navíc.** Skript vrací `fail()` i tehdy, když chybí `DATABASE_URL_MIGRATOR`, s odůvodněním „chybějící databáze se nikdy nepřeskakuje". To je správně, ale job tu proměnnou nastavuje v `env:` napevno, takže ta větev je v CI nedosažitelná. Není to vada, jen mrtvá pojistka pro lokální běh. Ponechat.

---

## Co jsem ověřil jako v pořádku

**Ověřeno spuštěním:**

- `docker/initdb/10-roles.sql` z úkolu 19 se proti PostgreSQL 18.4 aplikuje bez chyby, včetně `CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION mlain_app`, `GRANT pg_read_all_data TO mlain_backup` a `REVOKE CREATE ON SCHEMA public FROM PUBLIC`. Idempotentní bloky `IF NOT EXISTS` fungují, druhý běh projde.
- Chování migrace 0005 proti databázi se čtyřmi rolemi, viz K1. Ověřeno, že selhání je tiché a exit kód je 0.
- Logika testu na idempotenci proti skutečnému obsahu souboru, viz K2.

**Ověřeno přepočtem:**

- **Počet CI jobů sedí.** Rozhodnutí D7 (řádek 88) tvrdí šestnáct blokujících plus jeden neblokující. Workflow definuje přesně sedmnáct jobů: `lint`, `typecheck`, `test-unit`, `test-db`, `test-go`, `test-go-integration`, `contracts-golden`, `contracts-fixtures-schema`, `contracts-schema`, `openapi-drift`, `i18n-check`, `licenses-node`, `licenses-go`, `migrations-check`, `build-image`, `e2e`, `security-audit`. Rozpor mezi řídicím dokumentem (patnáct) a plánem (šestnáct) plán vysvětluje a opravuje správně, tabulka 3.15 má skutečně šestnáct řádků.
- **Devět balíčků sedí.** Test integrity vyjmenovává `config`, `contracts`, `core`, `db`, `emails`, `i18n`, `sdk-node`, `sdk-web`, `ui` a kontroluje i délku seznamu, takže desátý balíček shodí test.
- Registr chybových kódů má 289 položek napříč pěti druhy s testem na unikátnost v rámci druhu.

- **Žádné zástupné texty.** Prohledal jsem plán na `TODO`, `FIXME`, `doplnit ošetření`, `obdobně`, `analogicky`, `a tak dále`, `zbytek stejně` a osamocené výpustky. **Nula nálezů.** Jediné shody byly `./...` v Go příkazech, což je platná syntaxe, ne výpustka. Kroky, které mění kód, ten kód skutečně obsahují celý. Zmínky typu „doplní plán P03" jsou vědomá předání zapsaná v tabulce požadavků, ne díry v kódu, i když u tří z nich předání nedosedlo (K3 a K5).

**Ověřeno čtením:**

- **Licence.** Kapitoly 4.1 až 4.4 uvádějí licenci u každé závislosti. Runtime i build závislosti jsou MIT, Apache-2.0 nebo BSD-3-Clause, tedy v přípustné množině. Go závislosti (`caarlos0/env/v11` MIT, `jackc/pgx/v5` MIT, `prometheus/client_golang` Apache-2.0) i GitHub Actions jsou v pořádku. Plán navíc vede seznam „vědomě nepoužité" s důvodem, včetně odmítnutí `postgres` (postgres.js) kvůli licenci `Unlicense` mimo whitelist. To je přesně ta disciplína, kterou zadání chce.
- **Rozdělení health portů** (`WORKER_HEALTH_PORT` 3001, `SENDER_HEALTH_PORT` 3002, rozhodnutí D6) je správné a odůvodněné konkrétní poruchou: při `MODE=all` sdílejí potomci prostředí a jedna proměnná znamená `EADDRINUSE` hned u první instalace.
- **Podmíněné kopírování `packages/contracts/fixtures`** v Dockerfile přes wildcard, který se na prázdné množině chová jako no-op. Řeší přesně ten problém, který u `packages/db/migrations` zůstal otevřený (K5), takže vzor v plánu už existuje.
- **Vysvětlení `turbo prune --docker`** proti naivnímu `COPY packages/*/package.json` je věcně správné a je to netriviální past, kterou plán pojmenoval sám.
- Mazání proměnných AI providerů v entrypointu **vzorem `*_API_KEY`, ne výčtem**, s testem, že žádná proměnná Mlain Maileru na `_API_KEY` nekončí. Výčet by zastaral tiše.
- Oddělení `DATABASE_URL` (role `mlain_app`) od `DATABASE_URL_MIGRATOR` (role `mlain_migrator`) včetně startovní kontroly s hláškou, která operátorovi řekne, co má udělat.
