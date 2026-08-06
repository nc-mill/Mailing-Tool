# P16: Onboarding, provoz, zálohy, ukázková data a E2E zlaté cesty

<!-- puvod-dokumentu -->
> **Historický záznam, ne platné zadání.** Implementační plán P16 (onboarding, provoz, zálohy, ukázková data a E2E) z 31. 7. 2026, sepsaný před
> začátkem stavby. Zachycuje, co se tehdy plánovalo, ne dnešní podobu kódu.
> **Postaveno:** průvodce prvním spuštěním, ukázková data, příkazy `mlain` i E2E zlaté cesty existují a produkční image naběhne.
> **Zaškrtávátka nikdo neodškrtával**, prázdné políčko tady tedy neznamená nedodělek.
> **Dnešní stav:** `docs/superpowers/STAV-UKOLU.md` (živý dokument), design `docs/superpowers/DESIGN-INTEGRACE.md`.

> **Pro agentické pracovníky:** POVINNÁ PODDOVEDNOST: použij `superpowers:subagent-driven-development` (doporučeno) nebo `superpowers:executing-plans` a proveď plán úkol po úkolu. Kroky mají tvar zaškrtávacího políčka (`- [ ]`) kvůli sledování postupu.

**Cíl:** Dovést instalaci od `docker compose up` k první odeslané kampani a k prokazatelně obnovitelné záloze: průvodce prvním spuštěním, ukázková data, která jdou hromadně označit a smazat, provozní příkazy `mlain` včetně `doctor`, který hlásí chybějící stará pokolení klíče jako kritickou chybu, a Playwright test zlaté cesty proti běžícímu compose.

**Architektura:** Provozní logika je v čistých funkcích v `packages/core/src/ops`, `packages/core/src/onboarding` a `packages/core/src/demo`, testovatelných proti Postgresu v testcontainers. Vrstva CLI v `apps/cli/src/commands` je tenká a jen mapuje argumenty na tyhle funkce. **K databázi se přistupuje výhradně primitivy P03**, tedy `createPool` a transakčními obálkami `withWorkspace`, `withoutContext` a `withReadOnly`; žádné vlastní spojení tenhle plán neotvírá. Rozdělení je tvrdé a plyne z izolace projektů: co pracuje uvnitř jednoho projektu (ukázková data, stav onboardingu, přepočet zapojení), dostane `tx: Tx` z `withWorkspace` a volající kontext nastaví; co pracuje napříč celou instalací (záloha, obnova, diagnostika, rotace, upgrade), běží pod `DATABASE_URL_MIGRATOR`, protože migrátor vlastní schéma a jen na něj se politiky RLS neuplatní. Pod aplikační rolí bez kontextu vrací každý dotaz nula řádků, exit 0 a žádnou chybu, takže by se diagnostika i mazání ukázkových dat tvářily jako hotová práce. Zálohu dělá `pg_dump -Fc` z `postgresql18-client`, který je v runtime image, a ověřuje ji obnova do dočasné databáze, ne kontrola existence souboru. Ukázková data se neoznačují novým sloupcem (schéma vlastní P03 a tenhle plán do něj nesahá), ale trojicí existujících mechanismů: `contacts.source_ref`, štítek a manifest v `workspaces.settings.demoData`, takže se dají hromadně vybrat i smazat přesně a beze zbytku. E2E test běží proti skutečnému compose s poštovní pastí Mailpit a jede zlatou cestu ve zkušebním režimu, protože ověření domény v DNS trvá minuty až hodiny a v testu ani v živém demu se na něj nedá spolehnout (rozpor R2 části 6).

**Technologie:** TypeScript 5.x, Node 24, Next.js 16 (App Router), PostgreSQL 18, Drizzle ORM, pg-boss 12.26.3 (MIT), Vitest 4.1.10 (MIT), testcontainers 12.0.4 (MIT), Playwright 1.62.1 (Apache-2.0), `@axe-core/playwright` (MPL-2.0, jen `devDependencies`, výjimka U→1.12 části 6), Mailpit (MIT, jen testovací kontejner), `postgresql18-client` (PostgreSQL License, už v runtime image). Žádná nová produkční závislost. CLI nemá framework, používá `parseArgs` ze standardní knihovny, jak rozhodl P01.

---

## 0. Než napíšeš první řádek

### 0.1 Kde v celku tenhle plán je

P16 je poslední ze šestnácti plánů a skládá se nad všemi ostatními. Řídicí dokument je `docs/superpowers/plans/2026-07-31-rozdeleni-implementacnich-planu.md`, zadání P16 je v jeho kapitole 5, vlna 3.

Platí jeho jediné řídicí pravidlo: **každý soubor v repozitáři má právě jeden plán, který ho smí vytvořit a měnit; ostatní ho jen čtou.** Úplný seznam souborů, které vlastní P16, je v kapitole 5. Mimo ně tenhle plán nesahá ani na jediný řádek.

### 0.2 Zdroje, ze kterých se čerpá

| Zdroj | Kapitoly |
|---|---|
| `docs/superpowers/specs/parts/01-platforma.md` | 2.3 (DDL `system_settings`, `workspaces`, `memberships`), 3.10 (rotace klíče a keyring), 3.12 (image, svazky, banner), 3.13 (migrace), 3.14 (zálohování, obnova, upgrade), 3.15 (CI a testovací strategie), 4.9 (konfigurační proměnné), 5.3 (obrazovka Zálohy), 8 body 9 až 13 |
| `docs/superpowers/specs/parts/06-ui-ux.md` | 8.1 celá (8.1.1 až 8.1.5), 8.2.8 a 8.2.9 (zkušební režim a jeho riziko), 6.1, 6.2 a 6.5 (škála rizika, úroveň N2, hromadné destruktivní akce), 7.3 (prázdné stavy), 8.11.1 (Přehled, zdroj 5 je stav onboardingu), 13.1 (K1, K3, K5), 15.4, 17 (U→1.8, U→1.9, U→2.9, U→4a.7, U→4a.12), 18.1 rozpory R2 a R5 |
| `docs/superpowers/specs/parts/05-tracking.md` | 3.9.4 (`contact_engagement`, `mlain rebuild-engagement`), kritérium 77 |
| `docs/superpowers/specs/parts/02-kontakty.md` | 3.1 (sloupce `contacts`, `source`, `source_ref`), 4.10.3 a 4.10.4 (otisky a `suppressions.add`) |
| `docs/superpowers/specs/2026-07-31-mailing-tool-spec.md` | 7 (MVP 0, zlatá cesta), 8 (hackathonový plán, demo skript, definition of done), 10 (rizika) |

### 0.3 Rozhodnutí zadavatele, která přebíjejí specifikaci

| # | Rozhodnutí | Co je ve specifikaci | Co platí |
|---|---|---|---|
| Z1 | **Ukázková data mají 50 kontaktů**, ne 200 | 06-ui-ux 8.1.4 a požadavek U→2.9 mluví o 200 | Platí 50. Zbytek sady (3 seznamy, 4 štítky, 2 segmenty, 2 šablony, 1 odeslaná kampaň s reportem včetně otevření, kliknutí, dvou nedoručení a jedné stížnosti) zůstává beze změny. |
| Z2 | **Ukázková data i testovací kampaně musí jít hromadně označit a smazat** | 8.1.4 měla jen jedno tlačítko „Odstranit" | Zůstává tlačítko s potvrzením N2 **a navíc** je sada hromadně označitelná v tabulce, aby se jí uživatel zbavil i po částech. Řeší úkol 27. |
| Z3 | Příkaz se jmenuje **`mlain upgrade`** | v textech se objevilo i „update" | Celé CLI má jednotný prefix `mlain` a příkaz se jmenuje `upgrade`. Jiné pojmenování je chyba. |

Odchylku Z1 zapiš i do kódu jako komentář nad datovou sadou, ať je při příští revizi vidět, že to není opomenutí.

### 0.4 Rozhodnutí, která jsem udělal já, a proč

| # | Rozhodnutí | Odůvodnění |
|---|---|---|
| A1 | **Ukázková data se označují třemi existujícími mechanismy, ne novým sloupcem.** `contacts.source_ref = 'demo-data:v1'`, štítek `Ukázková data` a manifest v `workspaces.settings -> 'demoData'`. | Nový sloupec znamená migraci, migrace vlastní P03 a P16 do nich nesmí sáhnout. Prohledání celé specifikace i plánu P03 na výrazy `demo`, `sample`, `ukázk` a `vzorov` nenašlo jediný sloupec ani tabulku pro ukázkovost, přestože UI specifikace ten příznak předpokládá; požadavek U→2.9 zůstal na straně části 2 nezapracovaný. `source_ref` je volný text v modelu kontaktu, štítek dává hromadný výběr v tabulce a manifest dává přesné smazání. |
| A2 | **`mlain backup` odmítne běžet pod rolí, na kterou platí RLS, a `--enable-row-security` nikdy nepoužije.** | Ověřeno spuštěním proti PostgreSQL 18, protože původní zdůvodnění bylo nepřesné a vedlo by k jiné opravě. Skutečnost: `pg_dump` posílá `SET row_security = off`, takže pod rolí, na kterou politika dopadá, **spadne hlasitě** s `ERROR: query would be affected by row-level security policy for table "contacts"` a exit kódem 1. Role `mlain_backup` má jen `pg_read_all_data`, což **není** `BYPASSRLS`, takže by pod ní noční záloha padala každou noc, jen s hláškou, ze které není poznat, co s tím. **Tichá záloha s nula řádky vznikne právě tehdy, když někdo tu chybu „opraví" dopsáním `--enable-row-security`**: ověřeno, exit 0 a chráněné tabulky prázdné. Záloha se proto připojuje přes `DATABASE_URL_MIGRATOR` (role vlastní schéma a `FORCE ROW LEVEL SECURITY` se nikde nepoužívá, viz 01-platforma 3.6), předem to ověří dotazem a v úkolu 5 je test, který přidání toho přepínače zachytí. |
| A3 | **Návratové kódy `mlain doctor`: 0 v pořádku, 1 aspoň jedno varování se zapnutým `--strict`, 2 aspoň jeden kritický nález.** | Monitoring musí rozlišit „něco se blíží" od „ochrana už neplatí". Kritický nález je nenulový vždy, varování jen na vyžádání, jinak si provozovatel zvykne výstup ignorovat. Kódy 3, 4, 5, 64, 69, 75 a 78 jsou obsazené rozhodnutím D9 plánu P01, kód 2 volný je. |
| A4 | **P16 nezakládá jediný nový chybový kód API ani konfigurační proměnnou.** | Registr kódů i zod schéma konfigurace vlastní P01 a jeho kapitola 1.4 zakazuje zakládat je za běhu doménového plánu. V registru dnes žádný `backup_*`, `demo_*` ani `onboarding_*` kód není a doména `backup` v něm neexistuje. Endpointy P16 proto vystačí s obecnými kódy z katalogu 4.2 (`conflict`, `already_exists`, `not_found`, `validation_failed`, `forbidden`, `service_unavailable`). Řetězec `backup_from_newer_version` z kritéria 12 je **text hlášky CLI a exit kód**, ne kód HTTP, takže registr nepotřebuje. |
| A5 | **P16 nezakládá nový workspace balíček.** | Test integrity workspace v P01 vynucuje, že `packages/` obsahuje **právě devět** adresářů. `packages/e2e` je tím vyloučené a desátý balíček by shodil i akceptační kritérium 7d části 1. Kód P16 proto žije v existujících balíčcích. |
| A6 | **E2E jede zlatou cestu ve zkušebním režimu, ne přes ověřenou doménu.** | Rozpor R2 v 06-ui-ux 18.1: demo skript předpokládá ověření domény během dema, ale DNS propagace trvá minuty až hodiny. Test, který čeká na DNS, je test, který náhodně padá, a tím znehodnotí jedinou bránu, která zlatou cestu hlídá. Zkušební režim je odpověď, kterou navrhuje sama specifikace. Podrobně v kapitole 3. |
| A7 | **Playwright scénáře P16 žijí v `apps/web/e2e/golden/` s vlastní konfigurací, ne v novém balíčku.** | `apps/web/playwright.config.ts` a `apps/web/e2e/ui/**` vlastní P05, takže P16 si zakládá sourozenecký adresář a druhou konfiguraci. Compose overlay s poštovní pastí je ve stejném adresáři, protože `docker/**` vlastní P01. |
| A8 | **`mlain rebuild-engagement` přepočet neimplementuje, volá funkci z `@mlain/core/tracking`.** | Dvě implementace téhož agregátu se rozejdou a rozdíl se pozná až na číslech u zákazníka. Kritérium 77 části 5 vyžaduje, aby přepočet od nuly dal stejný výsledek jako přírůstkové udržování, což jde doložit jen tehdy, když je vzorec jeden. |
| A9 | **`mlain upgrade` procesy nezastavuje ani nespouští. Ověří, že neběží, udělá zálohu, zmigruje, ověří readiness a vypíše přesné příkazy na návrat.** | Zastavit sender a worker zvenčí kontejneru by vyžadovalo docker socket uvnitř kontejneru, a to je root na hostiteli. Kontejner běží s `read_only: true` pod uživatelem 10001; podstrčit tam docker socket by celý ten model zahodilo. Detekce běžících procesů přes `pg_stat_activity` je spolehlivá a nic nestojí. Odchylka od 3.14 je vědomá a je popsaná v runbooku. |
| A10 | **Ukázková kampaň se datuje do aktuálního měsíce, nikdy do minulosti mimo existující partition.** | `messages`, `message_events` a `message_engagement` jsou partitionované po měsících a job `platform.maintain_partitions` zakládá partition na aktuální a následující tři měsíce. `DEFAULT` partition se schválně nezakládá, takže zápis mimo okno **tvrdě spadne**. Seed by tedy prvního dne v měsíci padal, kdyby datoval kampaň o tři dny zpět. Funkce `demoCampaignSentAt` proto datum ořízne na začátek aktuálního měsíce. |

### 0.5 Riziko R2 a zkušební režim: co z toho vlastní P16

Rozpor **R2** (06-ui-ux, kapitola 18.1) zní: demo skript hlavní specifikace předpokládá ověření domény v kroku 2, jenže DNS propagace trvá minuty až hodiny, takže to v živém demu nejde spolehlivě předvést. Navržené řešení je doplnit do demo skriptu **zkušební režim**, a je to zároveň argument pro to, aby zkušební režim byl v MVP 0.

**Zkušební režim samotný vlastní P13** (obrazovky 8.2.1 až 8.2.10 jsou podle řídicího dokumentu jeho). P16 do jeho souborů nesahá. P16 vlastní tři věci, které z R2 plynou:

1. **Zlatá cesta v E2E jede ve zkušebním režimu.** Test nikdy nečeká na DNS: ověří jednu adresu potvrzovacím e-mailem z pasti a odešle na ni. To je rozdíl mezi testem, který běží deterministicky do tří minut, a testem, který jednou za pět běhů spadne na cizí infrastruktuře a naučí tým ignorovat červenou.
2. **Runbook demo skriptu** v `docs/operations/demo-runbook.md`, který krok 2 přepisuje na zkušební režim a říká proč. Bez něj si prezentující člověk pustí demo podle hlavní specifikace a zasekne se na DNS před publikem.
3. **Kontrola v `mlain doctor`**, která hlásí zapnutý zkušební režim jako informaci s připomenutím, že se odesílá jen na ověřené adresy.

**Riziko zkušebního režimu z 8.2.9** zní: uživatel si postaví kampaň na 20 000 lidí a teprve při odeslání zjistí, že je ve zkušebním režimu. Zmírnění je pruh na obrazovce publika s konkrétním číslem („Zkušební režim: z vybraných 12 480 příjemců se e-mail odešle jen 2 ověřeným adresám"). Ten pruh je na obrazovce publika kampaně, kterou vlastní P13. **P16 na něj nesahá, ale ověřuje ho:** scénář v úkolu 31 postaví publikum větší než počet ověřených adres a tvrdí, že pruh s oběma čísly na obrazovce je. Když ho P13 nedodal, spadne test P16, ne věta v dokumentu.

### 0.6 Rozhraní na jiné plány

Úplný seznam míst, kde P16 potřebuje něco, co vlastní někdo jiný. U každého je přesný tvar a **kontrola, která jeho chybění zachytí spuštěním**, ne přečtením. Když bod chybí, patří to plánu, který oblast vlastní, a P16 ho nedoplňuje.

| # | Adresát | Co P16 potřebuje | Přesný tvar | Čím se chybění pozná |
|---|---|---|---|---|
| I→P01.1 | P01 | Zapojení osmi příkazů P16 do `dispatch.ts`. P01 vlastní `main.ts`, `registry.ts`, `exit-codes.ts` a `dispatch.ts`; jednotlivé soubory v `apps/cli/src/commands/` vlastní plán, který příkaz dodává (P01 s tím počítá u `vitest.config.ts`, kapitola 1.1 to zatím neříká výslovně). P16 potřebuje dvě mechanické změny: v `registry.ts` přepnout `implemented` na `true` u `genkey`, `backup`, `restore`, `doctor`, `upgrade`, `rotate-credentials`, `reset-password` a `rebuild-engagement`, a v `dispatch.ts` doplnit osm `case` větví, které volají funkci z `./commands/<jméno>.js`. | Každý příkaz P16 exportuje `run<Jméno>(streams: CliStreams, argv: readonly string[], env: NodeJS.ProcessEnv): Promise<number>`, tedy týž tvar, jaký už má `runConfigCheck(streams, env)` od P01. Rozšíření o `argv` je nutné, protože příkazy P16 berou argumenty, kdežto tři příkazy P01 ne. | Test v úkolu 10 pouští `dispatch(['doctor', '--help'])` a sedm dalších a tvrdí, že **žádný nevrací `EXIT_UNAVAILABLE`**. Dokud P01 větve nedoplní, ten test padá, a je to záměr. |
| I→P01.2 | P01 | `postgresql18-client` v runtime image (`pg_dump`, `pg_restore`, `psql`, `createdb`, `dropdb`) | binárky na `PATH`, major verze 18 | Kontrola `binaries` v `mlain doctor` (úkol 14) a E2E scénář v úkolu 33 |
| I→P01.3 | P01 | Role, pod kterou běží záloha, nesmí podléhat RLS | `DATABASE_URL_MIGRATOR` míří na `mlain_migrator`, který vlastní schéma | Pojistka `assertDumpRoleSeesAllRows` v úkolu 5 skončí nenulově dřív, než `pg_dump` vůbec začne, a s návodem místo hlášky ovladače |
| I→P01.4 | P01 | Skript `test:e2e` v `apps/web/package.json`, který spustí obě konfigurace Playwrightu | `"test:e2e": "playwright test -c playwright.config.ts && playwright test -c playwright.golden.config.ts"` | Test v úkolu 34 čte `apps/web/package.json` a `.github/workflows/ci.yml` a porovnává je |
| I→P01.5 | P01 | Startovní banner z 8.1.1 a tři jednající hlášky (obsazený port, nedostupná databáze, chybějící `SECRET_KEY`) v `docker/entrypoint.sh` | přesné znění je v úkolu 35 | E2E scénář v úkolu 35 čte `docker compose logs` a hledá banner |
| I→P01.6 | P01 | `COPY LICENSES ./LICENSES` v `docker/Dockerfile` | jeden řádek ve vrstvě runtime | Test `license-obligations.test.ts` v úkolu 35. Bez něj je licenční povinnost LGPL u `sharp` (nález N15) splněná jen v repozitáři, ne v distribuované image, a **to je porušení podmínek distribuce**, ne kosmetika. |
| I→P02.1 | P02 | Šifrová obálka credentials | `@mlain/contracts/crypto`. Jméno i signaturu uzavřelo rozhodnutí R6 dokumentu `ROZHODNUTI-O-VLASTNICTVI.md` ve prospěch vlastníka: `encryptEnvelope({ plaintext, context, workspaceId, keyring?, keyId? })` vrací `{ stored: string, envelopeKeyId: number, ... }`, `decryptEnvelope({ stored, context, workspaceId, keyring? })` vrací `string`, `envelopeKeyId(stored: string): number`. **Obálka je vázaná na `workspaceId` přes AAD**, takže rotace musí znát projekt každého řádku, a `context` je uzavřený výčet `CREDENTIAL_CONTEXTS`. | Typecheck v úkolu 17 a test rotace, který přešifruje řádky ze dvou různých projektů |
| I→P02.2 | P02 | Keyring a otisk klíče | `@mlain/contracts/keyring`: `parseKeyring({ secretKey, secretKeyPrevious })` vrací `Keyring = Map<number, Uint8Array>`, `currentKeyId(keyring)`, `secretKeyFingerprint(master)`. **Otisk si odvození dělá sám**, volání s už odvozeným klíčem dá tiše jiný otisk. | Test v úkolu 3 porovná otisk s vektorem `VXGoNjoPSBY` |
| I→P03.1 | P03 | `workspaces.settings jsonb NOT NULL DEFAULT '{}'` a `system_settings.settings jsonb` (rozhodnutí P03 R7) | podle DDL 2.3 části 1 | Testy v úkolech 24 až 26 |
| I→P03.2 | P03 | Migrační runner s advisory lockem, konstanta 7264150401 | `@mlain/db/migrate`: `runMigrations({ url, ensurePartitions?, lockTimeoutSeconds?, migrationsFolder? }): Promise<void>`. **Vrací `void`**, počet aplikovaných migrací se z něj přečíst nedá a P16 ho nepotřebuje. | Volání v `restore` (úkol 9), `verify` (úkol 8) a `upgrade` (úkol 19) |
| I→P03.3 | P03 | Idempotentní obnovení oprávnění po `pg_restore` | funkce v databázi `mlain_apply_grants()` (rozhodnutí P03 R25). Volá ji migrace 0005, obnova v úkolu 9 a kontrola v úkolu 13. | Test obnovy v úkolu 9 čte tabulku **pod rolí `mlain_app`** a tvrdí, že nedostane `permission denied` |
| I→P03.4 | P03 | Ověření, že aplikační role opravdu podléhá izolaci | `checkIsolationPrerequisites(pool): Promise<string[]>` z `@mlain/db`. P03 sám píše, že ji volá P04 při startu a `mlain doctor` z P16. | Kontrola `isolation_prerequisites_missing` v úkolu 13 |
| I→P03.5 | P03 | Podcesta s testovacím harnessem | `@mlain/db/test-support` reexportující `startHarness(): Promise<Harness>`, `type Harness = { database, as(role): Pool, urlFor(role): string, stop() }` a `seedTwoWorkspaces(migrator: Pool)`. **Je to týž požadavek, jaký si už zapsal P07** (jeho kapitola s požadavky na P03); P16 ho nezdvojuje, jen se na něj váže. Harness v `packages/db/test/helpers/` existuje, chybí jen dva řádky v `exports`. | Každý `.db.test.ts` v P16. Bez té podcesty import spadne a nula testů se netváří zeleně. |
| I→P04.1 | P04 | `defineAuditActions` a `writeAuditLog` | `packages/core/audit/action.ts` a `packages/core/audit/write.ts`; P16 si své akce deklaruje sám v `packages/core/src/ops/audit.ts` podle konvence 3.7 („každá část si vlastní názvy svých akcí") | Test v úkolu 3 |
| I→P04.2 | P04 | Hashování hesla | `hashPassword(plain: string): Promise<string>` z `packages/core/identity/password.ts` (`@node-rs/argon2` 2.0.2, MIT) | Test v úkolu 18 |
| I→P04.3 | P04 | Dvě registrace v `packages/core/src/platform/jobs/queue-handlers.ts` | `'platform.backup': backupJob` a `'platform.backup_verify': backupVerifyJob`, importované z `@mlain/core/ops`. Fronty už v registru P01 existují a mají `owner: 'P16'`, handler soubor domény `platform` vlastní P04. | Test v úkolu 20 tvrdí, že obě fronty mají zaregistrovaný handler |
| I→P05.1 | P05 | Komponenty K1 (tabulka s hromadným výběrem), K5 (toast) a dialog potvrzení úrovně N2 | **Kořenový import `@mlain/ui` neexistuje**, v `exports` není klíč `"."` a skončil by chybou `ERR_PACKAGE_PATH_NOT_EXPORTED` při sestavení. Importuje se vždy na úroveň adresáře: `@mlain/ui/components/button`, `@mlain/ui/components/alert`, `@mlain/ui/patterns/data-table`, `@mlain/ui/patterns/states`. Jména podle požadavků P05→P16.1 až P05→P16.3: `Table` je **`DataTable`** se sloupci `{ id, header, cell }`, `Note` i `Banner` pokrývá **`Alert`** s `tone`, `Panel` se skládá z primitiv u sebe. | Build Nextu spadne na neexistující podcestě; testy komponent v úkolech 23 a 27 |
| I→P05.2 | P05 | Jméno dynamického segmentu workspace v App Routeru | P05 vlastní skořápku, takže jméno segmentu určuje P05. Tenhle plán píše `[workspaceSlug]`. Kdyby skořápka používala `[slug]`, přejmenuje se cesta souboru P16, ne skořápka. | Build Nextu spadne na dvou různých jménech na téže úrovni |
| I→P06.1 | P06 | Odkaz na `/login`: „Odesílání ještě není nastavené? Jak obnovit heslo z příkazové řádky" | požadavek U→1.8 části 6 | E2E scénář v úkolu 30 |
| I→P10.1 | P10 | Přepočet zapojení | `recomputeContactEngagement(tx, { workspaceId, batchSize, cursor })` z `@mlain/core/tracking` | Kontraktní test v úkolu 19 |
| I→P13.1 | P13 | Kontrolní seznam kampaně říká, že publikum obsahuje jen ukázkové kontakty | text a blokující položka podle 8.1.4 | E2E scénář v úkolu 32 |
| I→P13.2 | P13 | Pruh na obrazovce publika s počtem ověřených adres podle 8.2.9 | dvě čísla v jedné větě | E2E scénář v úkolu 31 |
| I→P14.1 | P14 | Přehled `/w/{slug}` vykreslí `<OnboardingPanel />` a `<DemoDataBanner />` nad dlaždicemi | zdroj 5 v 8.11.1 části 6 je „stav projektu a rozdělané práce, kroky onboardingu", takže je to už teď povinnost P14, ne nový požadavek | E2E v úkolu 30 hledá panel na Přehledu |

### 0.7 Známá mezera, kterou P16 vědomě nezavírá

Specifikace 8.1.4 vyžaduje, aby **ukázkové kontakty nešly zařadit do publika kampaně**. Vynucení té ochrany je v kompilaci publika a v kontrolním seznamu kampaně, tedy v souborech P07 a P13. P16 je nesmí měnit a nemá kam příznak uložit, protože model kontaktu v části 2 žádné pole pro ukázkovost nemá.

Co P16 místo toho dělá, a co je poctivé napsat nahlas:

- všech 50 adres je na doméně `example.com` (RFC 2606), takže se na ně **fyzicky nedá nic doručit**,
- všechny nesou `source_ref = 'demo-data:v1'`, štítek `Ukázková data` a jsou v seznamu `Ukázková data`, takže je uživatel v tabulce najde jedním filtrem a hromadně vybere,
- `mlain doctor` hlásí přítomnost ukázkových dat jako informaci,
- pruh na Přehledu na ně upozorňuje trvale, dokud se nesmažou,
- rozhraní na P13 (I→P13.1) je zapsané výše a jeho chybění shodí scénář v úkolu 32.

---

## 1. Konvence, které tenhle plán přebírá a nemění

| Věc | Konvence | Kdo ji stanovil |
|---|---|---|
| Import konfigurace | `import { loadConfig } from '@mlain/core/config'`, typ `MlainConfig` | P01 |
| Kořenový barrel `@mlain/core` | **neexistuje** a ESLint ho blokuje; importuje se vždy podcesta | P01, uzávěr S11 |
| Umístění testů balíčku core | `packages/core/test/<doména>/<jméno>.test.ts`, vitest include `test/**/*.test.ts` | P01 |
| Testy, které potřebují Postgres | přípona `.db.test.ts`, běží v jobu `test-db` | P01, P03 |
| Chybové kódy a fronty | zakládá **jen** P01, doménový plán je používá | P01, kapitola 1.4 |
| Handler fronty | `packages/core/src/<doména>/jobs/queue-handlers.ts`, hledá ho codegen workeru | P01 |
| Exit kódy CLI | 78 konfigurace, 75 dočasné selhání, 3 migrace, 4 přeskočená major verze, 5 `schema_version_ahead`, 64 špatné argumenty, 69 neimplementováno | P01, D9 |
| Klíče překladů | `<namespace>.<oblast>.<věc>`, segmenty camelCase, ICU plurály včetně `=0` | P05, část 2 kapitola 6.3 |
| Kontrola suppression listu | jediné povolené místo je `suppressions.check(ctx, emails)` | část 2, 4.10.3 |
| Otisky adres | počítají se pod **všemi** známými pokoleními, bez horního stropu | část 1, 3.10, zmrazené |
| Spojení s databází | `createPool(url, kind, max)` a obálky `withWorkspace` / `withUser` / `withoutContext` / `withReadOnly`. Pool se vždy uzavírá `await pool.end()`. | P03 |
| Transakční handle | `Tx` je **Drizzle handle**, ne `pg.PoolClient` | P03, R34 |
| Tvar výsledku dotazu | ``tx.execute()`` vrací **obálku `{ rows }`**, ne pole | P03, R34 |
| SQLSTATE z chyby | výhradně `pgErrorCode(error)`, kód leží na `error.cause.code` | P03, R35 |
| Přístup napříč projekty | jen pod `DATABASE_URL_MIGRATOR`; pod aplikační rolí bez kontextu je výsledek prázdný a tichý | P03, RLS |

### 1.1 Tři pravidla přístupu k databázi, která tenhle plán poruší nejsnáz

Sepsaná zvlášť, protože každé z nich má za sebou konkrétní vadu nalezenou v tomhle plánu a všechna tři projdou typovou kontrolou i revizí.

**První: obálka výsledku.** Tenhle vzor se přeloží, projde revizí a **za běhu vrátí `undefined`** při prvním `rows[0]`:

```ts
const rows = (await tx.execute(sql`SELECT 1`)) as unknown as Row[];  // ŠPATNĚ
const { rows } = await tx.execute<Row>(sql`SELECT 1`);               // SPRÁVNĚ
```

Drizzle vrací `pg.Result`, tedy obálku. Přetypování schované uvnitř závorky je tentýž případ, jen hůř viditelný.

**Druhé: kontext projektu.** Dotaz nad tabulkou s `ws_isolation` pod rolí `mlain_app` bez nastaveného `mlain.workspace_id` vrátí **nula řádků, exit 0 a žádnou chybu**. Ověřeno spuštěním: táž tabulka vrátí 2 řádky pod migrátorem a 2 řádky pod `mlain_app` uvnitř `withWorkspace`. Funkce, která má sáhnout do dat jednoho projektu, proto **nepřijímá URL, ale `tx: Tx`**, a transakci otevírá volající. Funkce, která pracuje napříč instalací, přijímá `pool: Pool` postavený nad `DATABASE_URL_MIGRATOR` a před prvním dotazem si ověří, že na tu roli izolace nedopadá.

**Třetí: testy pod správnou rolí.** Databázový test, který běží pod vlastníkem schématu, obě předchozí vady **zamaskuje**, protože pod migrátorem se RLS neuplatní. Každý test v tomhle plánu, který ověřuje chování aplikační cesty, proto běží pod `h.as('mlain_app')`, ne pod `h.as('mlain_migrator')`. Fixtures se zakládají pod migrátorem, ověřuje se pod aplikační rolí.

**Čtvrté: seznam hodnot v šabloně `sql`.** Holé pole se rozloží na jednotlivé parametry, takže `= ANY(${ids})` vyrobí `ANY(($1, $2, $3))` a dotaz spadne na `42809 op ANY/ALL (array) requires array on right side`. Seznam se předává výhradně přes `sql.param(ids)`, které vyrobí `ANY($1)` s jedním polem. Platí to v úkolu 26, kde se ukázková data mažou podle seznamu identifikátorů z manifestu. Pravidlo pochází z P11, kapitoly 1, bodu 5, a je tam ověřené spuštěním.

---

## 2. Struktura souborů

### 2.1 Nové soubory, které zakládá P16

```
packages/core/src/ops/
├── index.ts                   vstupní bod domény, @mlain/core/ops
├── audit.ts                   názvy auditních akcí domény
├── run-process.ts             spouštění binárek bez shellu, s timeoutem
├── db.ts                      withAdminTx, jediná cesta k datům napříč instalací
├── keyring.ts                 známá pokolení klíče pro doctor a rotaci
├── backup-manifest.ts         zod schéma manifest.json, čtení, zápis, sha256
├── backup-guard.ts            pojistka proti záloze pod rolí, na kterou platí RLS
├── backup.ts                  runBackup, retence, post-backup hook
├── backup-verify.ts           verifyBackup do dočasné databáze a její úklid
├── restore.ts                 restoreBackup se čtyřmi branami
├── encrypted-columns.ts       registr šifrovaných sloupců pro rotaci
├── rotate-credentials.ts      přešifrování obálek na aktuální key_id
├── genkey.ts                  generování klíče a výpis postupu rotace
├── reset-password.ts          nastavení hesla z příkazové řádky
├── rebuild-engagement.ts      dávkové volání přepočtu z @mlain/core/tracking
├── upgrade.ts                 preflight, záloha, migrace, readiness
├── jobs/backup-jobs.ts        těla obou plánovaných úloh
└── doctor/
    ├── types.ts               DoctorFinding, DoctorReport, závažnosti
    ├── checks-keyring.ts      kritické kontroly pokolení klíče
    ├── checks-storage.ts      datový svazek, binárky, stáří zálohy
    ├── checks-runtime.ts      schema_version, součet poolů, blížící se strop key_id
    ├── checks-workspace.ts    zkušební režim, ukázková data
    ├── format.ts              lidský výstup a --json
    └── run.ts                 složení kontrol a návratový kód

packages/core/src/onboarding/{index.ts, types.ts, state.ts}
packages/core/src/demo/{index.ts, dataset.ts, manifest.ts, seed.ts, purge.ts}

apps/cli/src/commands/{backup.ts, restore.ts, doctor.ts, upgrade.ts,
                       rotate-credentials.ts, genkey.ts,
                       rebuild-engagement.ts, reset-password.ts}

apps/web/src/app/api/v1/onboarding/route.ts
apps/web/src/app/api/v1/onboarding/hide/route.ts
apps/web/src/app/api/v1/demo-data/route.ts
apps/web/src/app/api/v1/backups/route.ts
apps/web/src/app/api/v1/backups/[name]/verify/route.ts

apps/web/src/features/onboarding/{onboarding-panel.tsx, onboarding-step-row.tsx,
                                  demo-data-banner.tsx, demo-data-dialog.tsx}
apps/web/src/features/backups/{backup-list.tsx, backup-run-button.tsx}
apps/web/src/app/[locale]/w/[workspaceSlug]/settings/backups/page.tsx

apps/web/e2e/golden/
├── compose.e2e.yml            overlay s poštovní pastí Mailpit
├── global-setup.ts            global-teardown.ts
├── fixtures/{mailpit.ts, contacts-50.csv, test-data.ts}
├── pages/{setup,onboarding,sending,import,template,segment,campaign,report}.page.ts
└── specs/{golden-path,trial-mode,demo-data,backup-restore,first-run,accessibility}.spec.ts
apps/web/playwright.golden.config.ts

packages/i18n/messages/{cs,en}/onboarding.json
docs/operations/{backup-restore.md, key-rotation.md, upgrade.md, demo-runbook.md, third-party-licenses.md}
LICENSES/LGPL-3.0.txt
```

### 2.2 Testy, které zakládá P16

```
packages/core/test/ops/
├── run-process.test.ts        keyring.test.ts            backup-manifest.test.ts
├── backup-retention.test.ts   genkey.test.ts             doctor-format.test.ts
├── backup-guard.db.test.ts    backup.db.test.ts          backup-verify.db.test.ts
├── restore.db.test.ts         doctor-keyring.db.test.ts  doctor-runtime.db.test.ts
├── encrypted-columns.db.test.ts  rotate-credentials.db.test.ts
├── reset-password.db.test.ts  rebuild-engagement.db.test.ts  upgrade.db.test.ts
packages/core/test/support/db.ts          opora nad harnessem P03, ne test
packages/core/test/support/db.db.test.ts  drží oporu i předpoklad o RLS u sebe
packages/core/test/onboarding/state.db.test.ts
packages/core/test/demo/{dataset.test.ts, seed.db.test.ts, purge.db.test.ts}
apps/cli/test/commands/registration.test.ts
apps/web/src/features/onboarding/__tests__/{onboarding-panel.test.tsx, demo-data-banner.test.tsx}
apps/web/src/features/backups/__tests__/backup-list.test.tsx
apps/web/test/ci/e2e-wiring.test.ts
apps/web/test/ci/license-obligations.test.ts
packages/i18n/test/onboarding-namespace.test.ts
```

### 2.3 Soubory, které P16 čte a nikdy nemění

`packages/db/**` (P03), `packages/contracts/**` (P02), `packages/ui/**` a `packages/i18n/**` mimo dva vlastní katalogy a jeden vlastní test (P05), `packages/core/src/{config,errors,queues,logging,health,shutdown}/**` a `apps/cli/src/{main,registry,dispatch,exit-codes}.ts` a `apps/cli/src/commands/{config-check,healthcheck}.ts` a `docker/**` (včetně `Dockerfile`, kam patří `COPY LICENSES`, viz I→P01.6) a `.github/workflows/**` a `tools/**` a kořenové manifesty (P01), `packages/core/{identity,audit,platform,net,tx}/**` a `apps/web/src/lib/api/**` (P04), `packages/core/contacts/**` (P07), `packages/core/src/templates/**` a `packages/emails/**` (P08), `packages/core/src/{campaigns,providers}/**` (P13), `packages/core/src/tracking/**` (P10), `apps/web/playwright.config.ts` a `apps/web/e2e/ui/**` (P05), obrazovky ostatních plánů v `apps/web/src/app`.

---

## 3. Zlatá cesta, jak ji test skutečně jede

Zlatá cesta z hlavní specifikace, kapitola 7:

```
instalace → připojení odesílání → import kontaktů → vytvoření šablony
→ vytvoření segmentu → odeslání kampaně → kvalitní report
```

Demo skript z kapitoly 8 má devět bodů. Test je jede v tomhle pořadí a s těmito náhradami:

| Bod demo skriptu | Co dělá test | Proč se liší |
|---|---|---|
| 1. `docker compose up`, průvodce vytvoří admina a projekt | totéž, proti čerstvému compose, plus kontrola banneru v logu | beze změny |
| 2. Připojím SES, průvodce ukáže DNS a ověří doménu | připojí **SMTP** proti poštovní pasti, doména zůstane neověřená, zapne se **zkušební režim**, ověří se jedna adresa potvrzovacím e-mailem z pasti | **rozpor R2**: DNS propagace trvá minuty až hodiny, test na ni čekat nemůže |
| 3. Import CSV, rozdělení jména, rod, vokativ | import `contacts-50.csv`, kontrola sloupce s oslovením a fronty kontroly | 50 řádků místo 5 000, aby se test vešel do limitu 20 minut jobu `e2e` |
| 4. AI napíše šablonu | **vynecháno**, test vytvoří šablonu z dodávané | AI vyžaduje cizí klíč a odchozí spojení, které kritérium 7b části 1 bez nakonfigurovaného klíče zakazuje |
| 5. Doladím myší, pošlu test | úprava předmětu, testovací odeslání, kontrola v pasti | beze změny |
| 6. Segment „aktivní za posledních 90 dní", vidím počet | totéž | beze změny |
| 7. Odešlu kampaň, sleduji živý průběh | okno na zrušení nastavené na 0 s, kontrola pruhu průběhu | 60sekundové okno protahuje každý běh o minutu; hodnota je nastavení projektu v rozsahu 0 až 300 s |
| 8. Otevřu mail, kliknu, přejdu na web, vidím časovou osu | e-mail se přečte z pasti, pixel a proklik se zavolají skutečným HTTP požadavkem, zkontroluje se časová osa kontaktu | beze změny |
| 9. Report kampaně a dashboard | kontrola tří hlavních dlaždic a jmenovatelů u procent | beze změny |

**Co test tvrdí navíc oproti demu:** panel onboardingu na Přehledu má po dokončení všech pět kroků odškrtnutých, a ukázková data jde nahrát a beze zbytku smazat.

---

## 4. Úkoly

Každý úkol končí commitem. Kroky jsou po 2 až 5 minutách. Test se píše první a musí nejdřív spadnout; když projde napoprvé, netestuje to, co si myslíš.

### Úkol 1: Katalog překladů namespace `onboarding`

**Soubory:**
- Vytvoř: `packages/i18n/messages/cs/onboarding.json`
- Vytvoř: `packages/i18n/messages/en/onboarding.json`
- Test: `packages/i18n/test/onboarding-namespace.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
// packages/i18n/test/onboarding-namespace.test.ts
import { describe, expect, it } from 'vitest';
import cs from '../messages/cs/onboarding.json' with { type: 'json' };
import en from '../messages/en/onboarding.json' with { type: 'json' };

function flatten(obj: unknown, prefix = ''): string[] {
  if (typeof obj !== 'object' || obj === null) return [prefix];
  return Object.entries(obj as Record<string, unknown>).flatMap(([k, v]) =>
    flatten(v, prefix ? `${prefix}.${k}` : k),
  );
}

function values(obj: unknown): string[] {
  if (typeof obj === 'string') return [obj];
  if (typeof obj !== 'object' || obj === null) return [];
  return Object.values(obj as Record<string, unknown>).flatMap(values);
}

describe('namespace onboarding', () => {
  it('má v cs i en shodnou množinu klíčů', () => {
    expect(flatten(cs).sort()).toEqual(flatten(en).sort());
  });

  it('neobsahuje dlouhou pomlčku U+2014', () => {
    // Dlouhá pomlčka se zapisuje escapem, aby ji test sám neobsahoval jako znak.
    expect([...values(cs), ...values(en)].filter((v) => v.includes('\u2014'))).toEqual([]);
  });

  it('neobsahuje zakázaný výraz subscribed ze slovníku 9.2', () => {
    expect(values(en).filter((v) => /\bsubscribed\b/i.test(v))).toEqual([]);
  });

  it('má u počtu kroků ICU plurál včetně kategorie =0', () => {
    expect(cs.panel.remaining).toContain('=0');
    expect(cs.panel.remaining).toContain('few');
    expect(en.panel.remaining).toContain('=0');
  });

  it('pokrývá všech pět kroků onboardingu', () => {
    for (const id of ['sending', 'contacts', 'template', 'testSend', 'firstCampaign']) {
      expect(cs.steps).toHaveProperty(id);
      expect(en.steps).toHaveProperty(id);
    }
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že spadne**

Spusť: `pnpm vitest run packages/i18n/test/onboarding-namespace.test.ts`
Očekávej: FAIL, `Cannot find module '../messages/cs/onboarding.json'`.

- [ ] **Krok 3: Napiš český katalog**

```json
{
  "panel": {
    "title": "Vaše první kampaň",
    "hide": "Skrýt",
    "show": "Zobrazit",
    "collapsed": "Nastavení: {done} z {total} hotovo.",
    "remaining": "{count, plural, =0 {Hotovo, nic nezbývá} one {Zbývá jeden krok} few {Zbývají # kroky} many {Zbývá # kroku} other {Zbývá # kroků}}",
    "finished": "Hotovo, první kampaň odeslána.",
    "finishedDismiss": "Zavřít"
  },
  "steps": {
    "sending": {
      "title": "Nastavte odesílání",
      "description": "Aby e-maily někam odcházely a nekončily ve spamu.",
      "estimate": "asi 10 min",
      "action": "Nastavit"
    },
    "contacts": {
      "title": "Přidejte kontakty",
      "description": "Nahrajte soubor, nebo si nejdřív zkuste ukázková data.",
      "estimate": "asi 3 min",
      "action": "Importovat",
      "secondaryAction": "Ukázková"
    },
    "template": {
      "title": "Připravte e-mail",
      "description": "Vyberte hotovou šablonu, nebo ji nechte napsat AI.",
      "estimate": "asi 5 min",
      "action": "Vytvořit"
    },
    "testSend": {
      "title": "Pošlete si test",
      "description": "Podívejte se, jak e-mail vypadá ve vaší schránce.",
      "estimate": "asi 1 min",
      "action": "Poslat test"
    },
    "firstCampaign": {
      "title": "Odešlete první kampaň",
      "description": "Až budou hotové předchozí kroky, kampaň odejde na vaše publikum.",
      "estimate": "",
      "action": "Na kampaně"
    }
  },
  "demo": {
    "bannerTitle": "V projektu jsou ukázková data.",
    "bannerDetail": "{contacts, plural, =0 {Žádný ukázkový kontakt} one {Jeden ukázkový kontakt} few {# ukázkové kontakty} many {# ukázkového kontaktu} other {# ukázkových kontaktů}} na doméně example.com. Doručit se na ně nedá nic.",
    "remove": "Odstranit",
    "load": "Nahrát ukázková data",
    "loading": "Nahrávám ukázková data",
    "loaded": "Ukázková data jsou v projektu.",
    "removed": "Ukázková data jsou pryč.",
    "dialogTitle": "Odstranit ukázková data?",
    "dialogBody": "Smaže se {contacts} kontaktů, {lists} seznamy, {tags} štítky, {segments} segmenty, {templates} šablony a {campaigns} kampaň s reportem. Na nic ostatního v projektu se nesáhne.",
    "dialogConfirm": "Odstranit ukázková data",
    "dialogCancel": "Nechat je tu",
    "alreadySeeded": "Ukázková data už v projektu jsou.",
    "filterHint": "V tabulce je najdete filtrem podle štítku Ukázková data."
  },
  "backups": {
    "title": "Zálohy",
    "empty": "Zatím žádná záloha. Nastavte pravidelné zálohování, než vložíte první kontakty.",
    "run": "Spustit zálohu",
    "running": "Záloha běží",
    "verify": "Ověřit",
    "verifiedOk": "Ověřeno {when}, v pořádku.",
    "verifiedFailed": "Ověření {when} selhalo.",
    "neverVerified": "Zatím neověřeno.",
    "columnCreated": "Vytvořeno",
    "columnSize": "Velikost",
    "columnRows": "Kontaktů v záloze",
    "columnVerified": "Ověření",
    "keyWarning": "Šifrovací klíč v záloze není. Uložte si zvlášť celý keyring, tedy SECRET_KEY i všechna předchozí pokolení ze SECRET_KEY_PREVIOUS. Bez starých pokolení přestanou platit otisky smazaných adres a smazaní lidé se vrátí prvním dalším importem."
  },
  "firstRun": {
    "openInstallation": "Instalace je zatím otevřená. Účet správce si založte hned, dokud vám ho nezaloží někdo jiný.",
    "passwordFromCli": "Odesílání ještě není nastavené? Heslo obnovíte příkazem v kontejneru."
  }
}
```

- [ ] **Krok 4: Napiš anglický katalog se shodnými klíči**

```json
{
  "panel": {
    "title": "Your first campaign",
    "hide": "Hide",
    "show": "Show",
    "collapsed": "Setup: {done} of {total} done.",
    "remaining": "{count, plural, =0 {All done} one {One step left} other {# steps left}}",
    "finished": "All done, your first campaign is out.",
    "finishedDismiss": "Close"
  },
  "steps": {
    "sending": {
      "title": "Set up sending",
      "description": "So that your e-mails go out and do not land in spam.",
      "estimate": "about 10 min",
      "action": "Set up"
    },
    "contacts": {
      "title": "Add contacts",
      "description": "Upload a file, or try the sample data first.",
      "estimate": "about 3 min",
      "action": "Import",
      "secondaryAction": "Sample data"
    },
    "template": {
      "title": "Prepare the e-mail",
      "description": "Pick a ready template, or let the AI write one.",
      "estimate": "about 5 min",
      "action": "Create"
    },
    "testSend": {
      "title": "Send yourself a test",
      "description": "See how the e-mail looks in your own inbox.",
      "estimate": "about 1 min",
      "action": "Send a test"
    },
    "firstCampaign": {
      "title": "Send your first campaign",
      "description": "Once the previous steps are done, the campaign goes out to your audience.",
      "estimate": "",
      "action": "Go to campaigns"
    }
  },
  "demo": {
    "bannerTitle": "This project contains sample data.",
    "bannerDetail": "{contacts, plural, =0 {No sample contact} one {One sample contact} other {# sample contacts}} on the example.com domain. Nothing can be delivered to them.",
    "remove": "Remove",
    "load": "Load sample data",
    "loading": "Loading sample data",
    "loaded": "Sample data is in the project.",
    "removed": "Sample data is gone.",
    "dialogTitle": "Remove sample data?",
    "dialogBody": "This deletes {contacts} contacts, {lists} lists, {tags} tags, {segments} segments, {templates} templates and {campaigns} campaign with its report. Nothing else in the project is touched.",
    "dialogConfirm": "Remove sample data",
    "dialogCancel": "Keep it",
    "alreadySeeded": "Sample data is already in this project.",
    "filterHint": "You can find it in the table by filtering on the Sample data tag."
  },
  "backups": {
    "title": "Backups",
    "empty": "No backups yet. Set up scheduled backups before you add your first contacts.",
    "run": "Run a backup",
    "running": "Backup running",
    "verify": "Verify",
    "verifiedOk": "Verified {when}, all good.",
    "verifiedFailed": "Verification on {when} failed.",
    "neverVerified": "Not verified yet.",
    "columnCreated": "Created",
    "columnSize": "Size",
    "columnRows": "Contacts in backup",
    "columnVerified": "Verification",
    "keyWarning": "The encryption key is not in the backup. Store the whole keyring separately, that is SECRET_KEY and every previous generation from SECRET_KEY_PREVIOUS. Without the old generations the fingerprints of erased addresses stop matching and erased people come back with the next import."
  },
  "firstRun": {
    "openInstallation": "This installation is still open. Create the administrator account now, before somebody else does.",
    "passwordFromCli": "Sending not set up yet? Reset the password with a command inside the container."
  }
}
```

- [ ] **Krok 5: Spusť test a ověř průchod**

Spusť: `pnpm vitest run packages/i18n/test/onboarding-namespace.test.ts`
Očekávej: PASS, 5 testů.

- [ ] **Krok 6: Commit**

```bash
git add packages/i18n/messages/cs/onboarding.json packages/i18n/messages/en/onboarding.json packages/i18n/test/onboarding-namespace.test.ts
git commit -m "feat(i18n): add onboarding namespace catalogs for cs and en"
```

---

### Úkol 2: Spouštění externích binárek

**Soubory:**
- Vytvoř: `packages/core/src/ops/run-process.ts`
- Test: `packages/core/test/ops/run-process.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
// packages/core/test/ops/run-process.test.ts
import { describe, expect, it } from 'vitest';
import { ProcessFailedError, majorVersionOf, runProcess } from '../../src/ops/run-process.js';

describe('runProcess', () => {
  it('vrátí stdout a nulový kód', async () => {
    const r = await runProcess('node', ['-e', 'process.stdout.write("ahoj")']);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe('ahoj');
  });

  it('u nenulového kódu hodí ProcessFailedError', async () => {
    await expect(
      runProcess('node', ['-e', 'process.stderr.write("bum"); process.exit(3)']),
    ).rejects.toThrow(ProcessFailedError);
  });

  it('nepouští příkaz přes shell, takže metaznaky jsou obyčejný argument', async () => {
    const r = await runProcess('node', [
      '-e',
      'process.stdout.write(process.argv[1] ?? "")',
      '; rm -rf /',
    ]);
    expect(r.stdout).toBe('; rm -rf /');
  });

  it('při překročení timeoutu proces zabije a hodí chybu', async () => {
    await expect(
      runProcess('node', ['-e', 'setTimeout(() => {}, 10000)'], { timeoutMs: 200 }),
    ).rejects.toThrow(/timeout/i);
  });

  it('nezapíše hodnotu tajné proměnné do hlášky chyby', async () => {
    const err = await runProcess('node', ['-e', 'process.exit(1)'], {
      env: { PGPASSWORD: 'tajne-heslo' },
    }).catch((e: Error) => e);
    expect(String(err)).not.toContain('tajne-heslo');
  });
});

describe('majorVersionOf', () => {
  it('vytáhne major verzi z výpisu', () => {
    expect(majorVersionOf('pg_dump (PostgreSQL) 18.4')).toBe(18);
    expect(majorVersionOf('psql (PostgreSQL) 17.2 (Debian)')).toBe(17);
    expect(majorVersionOf('nic o verzi')).toBeNull();
  });
});
```

- [ ] **Krok 2: Spusť a ověř pád**

Spusť: `pnpm vitest run packages/core/test/ops/run-process.test.ts`
Očekávej: FAIL, `Cannot find module '../../src/ops/run-process.js'`.

- [ ] **Krok 3: Implementuj**

```ts
// packages/core/src/ops/run-process.ts
import { spawn } from 'node:child_process';

export type RunResult = { code: number; stdout: string; stderr: string };

export type RunOptions = {
  /** Přidá se k process.env. Hodnoty se nikdy nevypisují do chybové hlášky. */
  env?: Record<string, string>;
  timeoutMs?: number;
  cwd?: string;
  stdin?: string;
};

export class ProcessFailedError extends Error {
  constructor(
    readonly file: string,
    readonly code: number,
    readonly stderr: string,
  ) {
    super(`${file} skončil s kódem ${code}: ${stderr.trim().slice(0, 2000)}`);
    this.name = 'ProcessFailedError';
  }
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * Spustí binárku se `shell: false`. Bez shellu proto, že argumenty pocházejí
 * z cest a z konfigurace, a se zapnutým shellem by z metaznaku v cestě
 * byl další příkaz.
 */
export async function runProcess(
  file: string,
  args: readonly string[],
  options: RunOptions = {},
): Promise<RunResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return await new Promise<RunResult>((resolve, reject) => {
    const child = spawn(file, [...args], {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      shell: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.stdout.on('data', (c: Buffer) => (stdout += c.toString('utf8')));
    child.stderr.on('data', (c: Buffer) => (stderr += c.toString('utf8')));

    child.on('error', (err) => {
      clearTimeout(timer);
      reject(new Error(`${file} se nepodařilo spustit: ${err.message}`));
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        reject(new Error(`${file} překročil timeout ${timeoutMs} ms a byl ukončen`));
        return;
      }
      const result = { code: code ?? -1, stdout, stderr };
      if (result.code !== 0) {
        reject(new ProcessFailedError(file, result.code, stderr));
        return;
      }
      resolve(result);
    });

    if (options.stdin !== undefined) child.stdin.write(options.stdin);
    child.stdin.end();
  });
}

/** Major verze z prvního čísla ve tvaru X.Y ve výpisu. */
export function majorVersionOf(versionOutput: string): number | null {
  const m = /(\d+)\.(\d+)/.exec(versionOutput);
  return m ? Number(m[1]) : null;
}

/** Major verze binárky, nebo null, když binárka není na PATH. */
export async function binaryMajorVersion(file: string): Promise<number | null> {
  try {
    const r = await runProcess(file, ['--version'], { timeoutMs: 10_000 });
    return majorVersionOf(r.stdout || r.stderr);
  } catch {
    return null;
  }
}
```

- [ ] **Krok 4: Spusť a ověř průchod**

Spusť: `pnpm vitest run packages/core/test/ops/run-process.test.ts`
Očekávej: PASS, 6 testů.

- [ ] **Krok 5: Napiš `packages/core/src/ops/db.ts`, jedinou cestu k datům napříč instalací**

Tenhle soubor existuje proto, aby **nešlo omylem napsat provozní dotaz, který mlčky vrátí nula řádků**. Provozní příkazy čtou napříč projekty, ale politika `ws_isolation` filtruje podle `mlain.workspace_id`, který žádný z nich nenastavuje a nastavit nemůže. Pod aplikační rolí je výsledek prázdný, exit 0 a bez chyby, takže by diagnostika hlásila zdravou instalaci a mazání by hlásilo hotovo.

Obrana nesmí být poznámka v revizi. Je to jediná funkce, kterou provozní kód smí použít, a ta si **předem ověří, že na aktuální roli izolace nedopadá**. Když dopadá, skončí chybou s návodem, ne prázdným výsledkem.

```ts
// packages/core/src/ops/db.ts
import { createPool, withoutContext, type Tx } from '@mlain/db';
import { assertDumpRoleSeesAllRows } from './backup-guard.js';

/**
 * Transakce pro provozní čtení a zápis NAPŘÍČ CELOU INSTALACÍ.
 *
 * Používají ji `backup`, `restore`, `verify`, `doctor`, `rotate-credentials`
 * a `upgrade`. Všechny běží pod `DATABASE_URL_MIGRATOR`, protože migrátor
 * vlastní schéma a jen na něj se politiky RLS neuplatní.
 *
 * Kontrola role tu není z opatrnosti, ale proto, že opačný stav NENÍ VIDĚT:
 * pod `mlain_app` bez kontextu vrátí `SELECT DISTINCT fingerprint_key_id
 * FROM suppressions` prázdno, `mlain doctor` z toho usoudí, že instalaci
 * nechybí žádné pokolení klíče, skončí nulou a zapíše do logu, že je vše
 * v pořádku. Ověřeno spuštěním: táž tabulka vrací 2 řádky pod migrátorem
 * a 0 řádků pod aplikační rolí bez kontextu.
 *
 * Funkce pro práci UVNITŘ jednoho projektu tudy NEVEDOU. Ty berou `tx: Tx`
 * a transakci jim otevírá volající přes `withWorkspace`, protože jinak by
 * obcházely izolaci projektů.
 */
export async function withAdminTx<T>(
  databaseUrl: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  await assertDumpRoleSeesAllRows(databaseUrl);
  const pool = createPool(databaseUrl, 'app', 2);
  try {
    return await withoutContext(pool, fn);
  } finally {
    await pool.end();
  }
}
```

- [ ] **Krok 6: Napiš `packages/core/test/support/db.ts`, testovací oporu nad harnessem P03**

Harness zakládá kontejner, šest rolí a předmigrovanou šablonu. Vlastní ho P03 a P16 do něj nesahá. Tenhle soubor je **tenká vrstva nad ním**, která doplňuje jen fixtures téhle domény. Je to týž vzor, jaký použil P07 (`testContext()` v `../support/db.js`).

**Pozor na dvě věci.** Za prvé, fixtures se zakládají pod `mlain_migrator`, protože na něj RLS nedopadá, ale **ověřuje se pod tou rolí, které se test týká**; databázový test běžící celý pod migrátorem by chybějící kontext projektu zamaskoval. Za druhé, sloupce ve fixtures musí sedět se schématem P03; kontrolu na to má krok 7.

```ts
// packages/core/test/support/db.ts
import { Client, type Pool } from 'pg';
import { withWorkspace, type Tx } from '@mlain/db';
import { unsafeWorkspaceContext } from '@mlain/db/unsafe-context';
import { startHarness, type Harness, type RoleName } from '@mlain/db/test-support';

export type TestPostgres = {
  /** URL migrátora. Provozní příkazy ho dostávají jako DATABASE_URL_MIGRATOR. */
  ownerUrl: string;
  /** URL libovolné z šesti rolí, pro testy, které ověřují oprávnění. */
  urlForRole(role: RoleName): string;
  /** Pool role, pro dotazy pod tou rolí. */
  as(role: RoleName): Pool;
  /** Dotaz pod migrátorem. Vrací POLE řádků, ne obálku. */
  sql<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  seedMinimalInstallation(input: { contacts: number; ownerEmail?: string }):
    Promise<{ workspaceId: string; userId: string }>;
  seedSentCampaign(input: { workspaceId: string }): Promise<{ campaignId: string }>;
  seedEngagementHistory(input: { workspaceId: string; campaigns: number }): Promise<void>;
  truncateWorkspaceData(workspaceId: string): Promise<void>;
  /**
   * Otevře spojení s daným `application_name`. Potřebuje ho preflight
   * `mlain upgrade`, který podle toho jména pozná běžící worker a sender
   * v `pg_stat_activity`.
   */
  openConnectionAs(applicationName: string): Promise<{ close(): Promise<void> }>;
  /**
   * Spustí funkci v transakci **pod aplikační rolí a s nastaveným
   * kontextem projektu**, tedy přesně tak, jak to za běhu dělá `withWorkspace`
   * z `@mlain/core/tx`.
   *
   * Testy domén, které pracují uvnitř jednoho projektu (onboarding, ukázková
   * data), musí jet tudy. Kdyby jely pod migrátorem, prošly by i tehdy, když
   * produkční kód zapomene kontext nastavit, protože na vlastníka schématu
   * se RLS neuplatní. Tenhle pomocník ten rozdíl drží viditelný.
   */
  inWorkspace<T>(workspaceId: string, fn: (tx: Tx) => Promise<T>): Promise<T>;
  stop(): Promise<void>;
};

export async function startTestPostgres(): Promise<TestPostgres> {
  const h: Harness = await startHarness();
  const migrator = h.as('mlain_migrator');

  const query = async <T>(text: string, params?: unknown[]): Promise<T[]> => {
    const { rows } = await migrator.query(text, params);
    return rows as T[];
  };

  return {
    ownerUrl: h.urlFor('mlain_migrator'),
    urlForRole: (role) => h.urlFor(role),
    as: (role) => h.as(role),
    sql: query,

    async seedMinimalInstallation({ contacts, ownerEmail = 'owner@example.test' }) {
      const [user] = await query<{ id: string }>(
        `INSERT INTO users (email, password_hash, locale, timezone)
         VALUES ($1, 'argon2id$dummy', 'cs', 'Europe/Prague') RETURNING id`, [ownerEmail]);
      const [ws] = await query<{ id: string }>(
        `INSERT INTO workspaces (name, slug, locale, timezone, created_by)
         VALUES ('Testovací projekt', 'test-projekt', 'cs', 'Europe/Prague', $1)
         RETURNING id`, [user.id]);
      await query(
        `INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`,
        [ws.id, user.id]);
      for (let i = 0; i < contacts; i += 1) {
        await query(
          `INSERT INTO contacts (workspace_id, email, status, source, locale, timezone)
           VALUES ($1, $2, 'active', 'manual', 'cs', 'Europe/Prague')`,
          [ws.id, `kontakt-${i}@example.test`]);
      }
      return { workspaceId: ws.id, userId: user.id };
    },

    async seedSentCampaign({ workspaceId }) {
      // design i design_hash jsou NOT NULL, viz schéma P03.
      const [tpl] = await query<{ id: string }>(
        `INSERT INTO templates (workspace_id, name, design, design_hash)
         VALUES ($1, 'Testovací šablona', '{"blocks":[]}'::jsonb, sha256('x'))
         RETURNING id`, [workspaceId]);
      const [campaign] = await query<{ id: string }>(
        `INSERT INTO campaigns (workspace_id, name, subject, template_id, status, finished_at)
         VALUES ($1, 'Testovací kampaň', 'Předmět', $2, 'sent', now()) RETURNING id`,
        [workspaceId, tpl.id]);
      await query(
        `INSERT INTO campaign_stats (workspace_id, campaign_id, sent, delivered)
         VALUES ($1, $2, 10, 9)`, [workspaceId, campaign.id]);
      return { campaignId: campaign.id };
    },

    async seedEngagementHistory({ workspaceId, campaigns }) {
      for (let i = 0; i < campaigns; i += 1) await this.seedSentCampaign({ workspaceId });
      await query(
        `INSERT INTO contact_engagement (workspace_id, contact_id, sent_total, opens_total)
         SELECT $1, id, 3, 1 FROM contacts WHERE workspace_id = $1
         ON CONFLICT (workspace_id, contact_id) DO NOTHING`, [workspaceId]);
    },

    async truncateWorkspaceData(workspaceId) {
      // Pořadí je dané cizími klíči. Běží pod migrátorem, takže RLS nefiltruje.
      for (const table of ['campaign_stats', 'campaigns', 'templates', 'contact_tags',
        'list_subscriptions', 'segments', 'contacts', 'lists', 'tags']) {
        await query(`DELETE FROM ${table} WHERE workspace_id = $1`, [workspaceId]);
      }
    },

    async openConnectionAs(applicationName) {
      const client = new Client({
        connectionString: h.urlFor('mlain_app'),
        application_name: applicationName,
      });
      await client.connect();
      return { close: () => client.end() };
    },

    inWorkspace(workspaceId, fn) {
      // Kontext se skládá stejně jako v produkci. `unsafeWorkspaceContext`
      // je jediná továrna branded typu a P03 ji pro testy a údržbové joby
      // výslovně povoluje.
      const ctx = unsafeWorkspaceContext(workspaceId, {
        type: 'system',
        job: 'test',
      });
      return withWorkspace(h.as('mlain_app'), ctx, fn);
    },

    stop: () => h.stop(),
  };
}
```

- [ ] **Krok 7: Napiš test, který drží oporu i schéma u sebe**

Fixtures jsou nejtišší možný zdroj rozchodu se schématem: když se sloupec přejmenuje, spadne dvacet testů naráz s hláškou o chybějícím sloupci a nikdo nepozná, že chyba je v opoře. Tenhle test to řekne na jednom místě, a hlavně **ověřuje i to, že aplikační role bez kontextu nic nevidí**, protože na tom předpokladu stojí celý úkol 13.

```ts
// packages/core/test/support/db.db.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestPostgres } from './db.js';

let pg: TestPostgres;
let workspaceId: string;

beforeAll(async () => {
  pg = await startTestPostgres();
  ({ workspaceId } = await pg.seedMinimalInstallation({ contacts: 3 }));
}, 180_000);

afterAll(async () => { await pg?.stop(); });

describe('testovací opora', () => {
  it('založí instalaci se skutečnými sloupci schématu', async () => {
    const rows = await pg.sql<{ n: string }>(
      'SELECT count(*)::text AS n FROM contacts WHERE workspace_id = $1', [workspaceId]);
    expect(Number(rows[0].n)).toBe(3);
  });

  it('seedSentCampaign projde, tedy design i design_hash jsou vyplněné', async () => {
    await expect(pg.seedSentCampaign({ workspaceId })).resolves.toHaveProperty('campaignId');
  });

  it('migrátor vidí data i bez kontextu projektu', async () => {
    const { rows } = await pg.as('mlain_migrator').query('SELECT count(*)::int AS n FROM contacts');
    expect(rows[0].n).toBeGreaterThan(0);
  });

  it('aplikační role BEZ kontextu nevidí nic, a nespadne u toho', async () => {
    // Tohle je předpoklad, na kterém stojí withAdminTx i celá diagnostika.
    // Kdyby přestal platit, byly by kontroly v úkolech 12 a 13 zbytečné,
    // a hlavně by o tom nikdo nevěděl.
    const { rows } = await pg.as('mlain_app').query('SELECT count(*)::int AS n FROM contacts');
    expect(rows[0].n).toBe(0);
  });

  it('aplikační role S kontextem vidí data téhož projektu', async () => {
    const client = await pg.as('mlain_app').connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('mlain.workspace_id', $1, true)`, [workspaceId]);
      const { rows } = await client.query('SELECT count(*)::int AS n FROM contacts');
      expect(rows[0].n).toBe(3);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });
});
```

- [ ] **Krok 8: Spusť a ověř průchod**

Spusť: `pnpm vitest run packages/core/test/ops/run-process.test.ts packages/core/test/support/db.db.test.ts`
Očekávej: PASS, 11 testů v prvním souboru a 5 v druhém, celkem **11**.

Kdyby poslední dva testy spadly, **nespravuj je změnou očekávané hodnoty**. Znamenaly by, že se RLS na aplikační roli neuplatňuje, tedy že projekty nejsou izolované, a to je nález proti P03 nebo proti `docker/initdb`, ne proti tomuhle testu.

- [ ] **Krok 9: Commit**

```bash
git add packages/core/src/ops/run-process.ts packages/core/src/ops/db.ts \
        packages/core/test/ops/run-process.test.ts packages/core/test/support/db.ts \
        packages/core/test/support/db.db.test.ts
git commit -m "feat(ops): add binary runner, admin transaction guard and db test support"
```

---

### Úkol 3: Keyring a auditní akce domény

**Soubory:**
- Vytvoř: `packages/core/src/ops/keyring.ts`, `packages/core/src/ops/audit.ts`, `packages/core/src/ops/index.ts`
- Test: `packages/core/test/ops/keyring.test.ts`

- [ ] **Krok 1: Napiš padající test s vektorem ze specifikace 3.10**

```ts
// packages/core/test/ops/keyring.test.ts
import { describe, expect, it } from 'vitest';
import { knownKeyIds, loadOpsKeyring, missingGenerations } from '../../src/ops/keyring.js';

const SPEC_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';

describe('loadOpsKeyring', () => {
  it('spočítá otisk podle vektoru ze specifikace', () => {
    const kr = loadOpsKeyring({ secretKey: SPEC_KEY, secretKeyPrevious: '' });
    expect(kr.currentFingerprint).toBe('VXGoNjoPSBY');
  });

  it('neodvozuje klíč dvakrát', () => {
    // Nejsnazší chyba v tomhle modulu je zavolat secretKeyFingerprint()
    // s UŽ ODVOZENÝM klíčem. Přeloží se to, nespadne to a vyrobí to tiše
    // jiný otisk, kterým by pak `mlain doctor` hlásil kritickou neshodu
    // klíče u instalace, které nic není.
    //
    // Obě hodnoty jsou ověřené spuštěním nad kontraktem P02:
    //   secretKeyFingerprint(master)                     -> VXGoNjoPSBY
    //   secretKeyFingerprint(deriveKey(master, PURPOSE)) -> 5P_j-3XY714
    const kr = loadOpsKeyring({ secretKey: SPEC_KEY, secretKeyPrevious: '' });
    expect(kr.currentFingerprint).not.toBe('5P_j-3XY714');
  });

  it('bez explicitního key_id má aktuální klíč id 1', () => {
    const kr = loadOpsKeyring({ secretKey: SPEC_KEY, secretKeyPrevious: '' });
    expect(kr.currentKeyId).toBe(1);
    expect(knownKeyIds(kr)).toEqual([1]);
  });

  it('načte všechna předchozí pokolení a nemá horní strop', () => {
    const previous = Array.from({ length: 12 }, (_, i) => `${i + 1}:${SPEC_KEY}`).join(',');
    const kr = loadOpsKeyring({ secretKey: `13:${SPEC_KEY}`, secretKeyPrevious: previous });
    expect(kr.currentKeyId).toBe(13);
    expect(knownKeyIds(kr)).toHaveLength(13);
  });
});

describe('missingGenerations', () => {
  it('vrátí pokolení, která jsou v datech, ale ne v keyringu', () => {
    const kr = loadOpsKeyring({ secretKey: `3:${SPEC_KEY}`, secretKeyPrevious: `2:${SPEC_KEY}` });
    expect(missingGenerations(kr, [1, 2, 3])).toEqual([1]);
  });

  it('prázdná data znamenají žádné chybějící pokolení', () => {
    const kr = loadOpsKeyring({ secretKey: SPEC_KEY, secretKeyPrevious: '' });
    expect(missingGenerations(kr, [])).toEqual([]);
  });
});
```

- [ ] **Krok 2: Spusť a ověř pád**

Spusť: `pnpm vitest run packages/core/test/ops/keyring.test.ts`
Očekávej: FAIL, modul neexistuje.

- [ ] **Krok 3: Implementuj keyring jako tenký pohled nad kontraktem**

```ts
// packages/core/src/ops/keyring.ts
import { currentKeyId, parseKeyring, secretKeyFingerprint, type Keyring }
  from '@mlain/contracts/keyring';

export type OpsKeyring = {
  currentKeyId: number;
  currentFingerprint: string;
  /** key_id -> otisk, pro každé známé pokolení. */
  fingerprints: ReadonlyMap<number, string>;
  /** Syrový keyring pro `encryptEnvelope` a `decryptEnvelope`. */
  keyring: Keyring;
};

export type KeyringEnv = { secretKey: string; secretKeyPrevious: string };

/**
 * Poskládá keyring z prostředí. Recept odvození i otisku vlastní kontrakt
 * (01-platforma 3.10). Tenhle modul doplňuje jen pohled, který potřebuje
 * `mlain doctor`: seznam pokolení, která instalace zná.
 *
 * DVĚ VĚCI, KTERÉ SE TU SNADNO POKAZÍ, obojí ověřeno proti kontraktu P02:
 *
 *  1. `parseKeyring` bere JEDEN OBJEKT, ne dva poziční argumenty, a vrací
 *     `Keyring = Map<number, Uint8Array>`, ne strukturu s poli `all` a `current`.
 *  2. `secretKeyFingerprint` bere MASTER a odvození `mailer/v1/secret-key-fingerprint`
 *     si dělá sama. Zavolat ji s už odvozeným klíčem se přeloží, nespadne
 *     a vrátí TIŠE JINÝ OTISK. Otisk by pak nesouhlasil s tím, co zapsal
 *     `POST /api/v1/setup`, a `mlain doctor` by hlásil kritickou neshodu klíče
 *     u instalace, které nic není. Vektor v prvním testu je jediná pojistka.
 *
 * Strop na počet pokolení tady není a nesmí se zavést. Otisk smazané adresy
 * nejde nikdy přepočítat, protože plaintext je po výmazu podle GDPR pryč.
 * Se stropem by se nejstarší záznamy přestaly dát ověřit a smazaný člověk
 * by se vrátil prvním dalším importem, aniž by cokoliv selhalo nebo se
 * zalogovalo. Je to nejtišší možná porucha.
 */
export function loadOpsKeyring(env: KeyringEnv): OpsKeyring {
  const keyring = parseKeyring({
    secretKey: env.secretKey,
    secretKeyPrevious: env.secretKeyPrevious,
  });
  const fingerprints = new Map<number, string>();
  for (const [keyId, master] of keyring) {
    fingerprints.set(keyId, secretKeyFingerprint(master));
  }
  const current = currentKeyId(keyring);
  return {
    currentKeyId: current,
    currentFingerprint: fingerprints.get(current)!,
    fingerprints,
    keyring,
  };
}

export function knownKeyIds(keyring: OpsKeyring): number[] {
  return [...keyring.fingerprints.keys()].sort((a, b) => a - b);
}

/** Pokolení, která se vyskytují v datech, ale instalace pro ně nemá klíč. */
export function missingGenerations(keyring: OpsKeyring, usedInData: readonly number[]): number[] {
  const known = new Set(keyring.fingerprints.keys());
  return [...new Set(usedInData)].filter((id) => !known.has(id)).sort((a, b) => a - b);
}
```

- [ ] **Krok 4: Deklaruj auditní akce domény**

```ts
// packages/core/src/ops/audit.ts
import { defineAuditActions } from '@mlain/core/audit/action';

/**
 * Kategorie „provoz" podle 01-platforma 3.7. Konvence je
 * <entita>.<sloveso v minulém čase>. Do metadat nikdy nepatří klíče, hesla
 * ani obsah e-mailů; u zálohy jde jen o jméno adresáře, počty řádků a otisk
 * klíče, což je veřejná hodnota.
 */
export const OPS_AUDIT_ACTIONS = defineAuditActions([
  'backup.created',
  'backup.verified',
  'backup.restored',
  'credentials.rotated',
  'demo_data.seeded',
  'demo_data.purged',
  'user.password_reset_from_cli',
]);
```

- [ ] **Krok 5: Vytvoř vstupní bod domény**

```ts
// packages/core/src/ops/index.ts
export { OPS_AUDIT_ACTIONS } from './audit.js';
export { binaryMajorVersion, majorVersionOf, ProcessFailedError, runProcess } from './run-process.js';
export { knownKeyIds, loadOpsKeyring, missingGenerations } from './keyring.js';
export type { KeyringEnv, OpsKeyring } from './keyring.js';
```

- [ ] **Krok 6: Spusť test a commitni**

Spusť: `pnpm vitest run packages/core/test/ops/keyring.test.ts`
Očekávej: PASS, 6 testů.

```bash
git add packages/core/src/ops/keyring.ts packages/core/src/ops/audit.ts packages/core/src/ops/index.ts packages/core/test/ops/keyring.test.ts
git commit -m "feat(ops): add keyring view and ops audit actions"
```

---

### Úkol 4: Manifest zálohy

**Soubory:**
- Vytvoř: `packages/core/src/ops/backup-manifest.ts`
- Test: `packages/core/test/ops/backup-manifest.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
// packages/core/test/ops/backup-manifest.test.ts
import { describe, expect, it } from 'vitest';
import {
  BACKUP_FORMAT_VERSION,
  BACKUP_ROW_COUNT_TABLES,
  compareRowCounts,
  isBackupFromNewerVersion,
  parseManifest,
} from '../../src/ops/backup-manifest.js';

const valid = {
  format_version: 1,
  created_at: '2026-07-31T03:00:00.000Z',
  app_version: '1.0.0',
  schema_version: 42,
  installation_id: '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071',
  secret_key_fingerprint: 'VXGoNjoPSBY',
  postgres_version: '18.4',
  database: { bytes: 184320000, sha256: 'a'.repeat(64) },
  uploads: { bytes: 42000000, sha256: 'b'.repeat(64), files: 1284 },
  row_counts: { contacts: 48211 },
};

describe('parseManifest', () => {
  it('přijme manifest ze specifikace 3.14', () => {
    expect(parseManifest(valid).schema_version).toBe(42);
  });

  it('odmítne neznámou format_version', () => {
    expect(() => parseManifest({ ...valid, format_version: 2 })).toThrow(/format_version/);
  });

  it('odmítne sha256, které není 64 hexadecimálních znaků', () => {
    expect(() => parseManifest({ ...valid, database: { bytes: 1, sha256: 'krátké' } })).toThrow();
  });

  it('odmítne manifest bez počtu kontaktů', () => {
    expect(() => parseManifest({ ...valid, row_counts: {} })).toThrow(/contacts/);
  });
});

describe('isBackupFromNewerVersion', () => {
  it.each([
    ['1.0.0', '1.0.0', false],
    ['0.9.9', '1.0.0', false],
    ['1.0.1', '1.0.0', true],
    ['2.0.0', '1.10.0', true],
    ['1.10.0', '1.9.0', true],
    ['1.0.0-dev', '1.0.0', false],
  ])('%s proti image %s je %s', (backup, image, expected) => {
    expect(isBackupFromNewerVersion(backup, image)).toBe(expected);
  });
});

describe('compareRowCounts', () => {
  it('nenajde rozdíl u shodných počtů', () => {
    expect(compareRowCounts({ contacts: 5 }, { contacts: 5 })).toEqual([]);
  });

  it('najde rozdíl a pojmenuje tabulku', () => {
    expect(compareRowCounts({ contacts: 5, users: 1 }, { contacts: 4, users: 1 })).toEqual([
      { table: 'contacts', expected: 5, actual: 4 },
    ]);
  });

  it('chybějící tabulku hlásí jako nulu', () => {
    expect(compareRowCounts({ contacts: 5 }, {})).toEqual([
      { table: 'contacts', expected: 5, actual: 0 },
    ]);
  });
});

describe('BACKUP_ROW_COUNT_TABLES', () => {
  it('obsahuje contacts, protože na tom stojí akceptační kritérium 9', () => {
    expect(BACKUP_ROW_COUNT_TABLES).toContain('contacts');
  });

  it('je bez duplicit', () => {
    expect(new Set(BACKUP_ROW_COUNT_TABLES).size).toBe(BACKUP_ROW_COUNT_TABLES.length);
  });

  it('formát manifestu je verze 1', () => {
    expect(BACKUP_FORMAT_VERSION).toBe(1);
  });
});
```

- [ ] **Krok 2: Spusť a ověř pád**

Spusť: `pnpm vitest run packages/core/test/ops/backup-manifest.test.ts`
Očekávej: FAIL, modul neexistuje.

- [ ] **Krok 3: Implementuj**

```ts
// packages/core/src/ops/backup-manifest.ts
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';

export const BACKUP_FORMAT_VERSION = 1;

/**
 * Tabulky, jejichž počty řádků jdou do manifestu. `contacts` tam musí být,
 * protože akceptační kritérium 9 části 1 kontroluje právě jeho hodnotu.
 * Ostatní jsou tam proto, aby `mlain backup verify` poznal i tichou ztrátu
 * jiné než největší tabulky.
 */
export const BACKUP_ROW_COUNT_TABLES = [
  'users',
  'workspaces',
  'memberships',
  'contacts',
  'lists',
  'tags',
  'segments',
  'templates',
  'campaigns',
  'suppressions',
  'audit_log',
] as const;

const sha256 = z.string().regex(/^[0-9a-f]{64}$/, 'sha256 musí být 64 hexadecimálních znaků');

export const manifestSchema = z.object({
  format_version: z.literal(BACKUP_FORMAT_VERSION, {
    message: `format_version musí být ${BACKUP_FORMAT_VERSION}`,
  }),
  created_at: z.iso.datetime(),
  app_version: z.string().min(1),
  schema_version: z.number().int().nonnegative(),
  installation_id: z.uuid(),
  secret_key_fingerprint: z.string().min(1),
  postgres_version: z.string().min(1),
  database: z.object({ bytes: z.number().int().nonnegative(), sha256 }),
  uploads: z
    .object({ bytes: z.number().int().nonnegative(), sha256, files: z.number().int().nonnegative() })
    .nullable(),
  row_counts: z
    .record(z.string(), z.number().int().nonnegative())
    .refine((r) => typeof r.contacts === 'number', {
      message: 'row_counts musí obsahovat contacts',
    }),
});

export type BackupManifest = z.infer<typeof manifestSchema>;

export function parseManifest(input: unknown): BackupManifest {
  return manifestSchema.parse(input);
}

export async function readManifest(dir: string): Promise<BackupManifest> {
  return parseManifest(JSON.parse(await readFile(join(dir, 'manifest.json'), 'utf8')));
}

export async function writeManifest(dir: string, manifest: BackupManifest): Promise<void> {
  await writeFile(join(dir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}

export async function fileSha256(path: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

/** Porovná verze po částech; předvydání (`-dev`, `-rc.1`) je vždy starší než holá verze. */
export function isBackupFromNewerVersion(backupVersion: string, imageVersion: string): boolean {
  return compareSemver(backupVersion, imageVersion) > 0;
}

function compareSemver(a: string, b: string): number {
  const split = (v: string) => {
    const [core, pre] = v.split('-', 2);
    const nums = core.split('.').map((n) => Number.parseInt(n, 10) || 0);
    return { nums: [nums[0] ?? 0, nums[1] ?? 0, nums[2] ?? 0], pre: pre ?? null };
  };
  const x = split(a);
  const y = split(b);
  for (let i = 0; i < 3; i += 1) {
    if (x.nums[i] !== y.nums[i]) return x.nums[i] - y.nums[i];
  }
  if (x.pre === y.pre) return 0;
  if (x.pre !== null && y.pre === null) return -1;
  if (x.pre === null && y.pre !== null) return 1;
  return x.pre!.localeCompare(y.pre!);
}

export type RowCountDiff = { table: string; expected: number; actual: number };

export function compareRowCounts(
  expected: Record<string, number>,
  actual: Record<string, number>,
): RowCountDiff[] {
  return Object.entries(expected)
    .map(([table, count]) => ({ table, expected: count, actual: actual[table] ?? 0 }))
    .filter((d) => d.expected !== d.actual);
}
```

- [ ] **Krok 4: Spusť a ověř průchod**

Spusť: `pnpm vitest run packages/core/test/ops/backup-manifest.test.ts`
Očekávej: PASS, 10 testů.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/ops/backup-manifest.ts packages/core/test/ops/backup-manifest.test.ts
git commit -m "feat(ops): add backup manifest schema, hashing and version guard"
```

---

### Úkol 5: Pojistka proti tiché prázdné záloze

**Soubory:**
- Vytvoř: `packages/core/src/ops/backup-guard.ts`
- Test: `packages/core/test/ops/backup-guard.db.test.ts`

**Proč tenhle úkol existuje, a co se na něm ověřovalo spuštěním.** Původní znění tvrdilo, že `pg_dump` pod rolí s RLS vyrobí bezvadný dump s nula řádky a nic neselže. **To je nepřesné a vedlo by to k jiné opravě**, tak je tu naměřený stav proti PostgreSQL 18:

| Role | Přepínač | Výsledek |
|---|---|---|
| `mlain_backup` (má `pg_read_all_data`) | žádný | **exit 1**, `ERROR: query would be affected by row-level security policy for table "contacts"` |
| `mlain_backup` | `--enable-row-security` | **exit 0, chráněné tabulky prázdné** |
| `mlain_migrator` (vlastní schéma) | žádný | exit 0, data kompletní |

`pg_dump` totiž sám posílá `SET row_security = off` a server pak dotaz nad chráněnou tabulkou odmítne, místo aby ho tiše zúžil. Z toho plynou **dvě různá nebezpečí a pojistka musí krýt obě**:

1. **Pod `mlain_backup` by noční záloha padala každou noc.** Ne tiše, ale s hláškou, ze které provozovatel nepozná, co má udělat. Pojistka běží před `pg_dump` a chybu nahradí návodem.
2. **Tichá prázdná záloha vznikne až tehdy, když někdo tu chybu „opraví" dopsáním `--enable-row-security`.** To je realistický scénář: přepínač se tak jmenuje, že vypadá jako správné řešení. Krok 1 na to má vlastní test, který se **neptá zdrojáku, ale spustí skutečný `pg_dump`** a spočítá řádky v dumpu.

Role `mlain_app` schéma nevlastní, takže na ni RLS platí. Role `mlain_backup` má jen `pg_read_all_data`, což **není** atribut `BYPASSRLS`. Jediná role, pod kterou záloha projde, je `mlain_migrator`.

- [ ] **Krok 1: Napiš padající test proti reálné databázi**

Testy běží pod **skutečnými rolemi z harnessu P03**, ne pod vymyšlenými. Harness zakládá všech šest rolí, `mlain_backup` dostává `pg_read_all_data` a šablona databáze nese schéma, politiky i granty, takže se testuje přesně to, co pojede v provozu.

```ts
// packages/core/test/ops/backup-guard.db.test.ts
import { execFile } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { seedTwoWorkspaces, startHarness, type Harness } from '@mlain/db/test-support';
import { assertDumpRoleSeesAllRows, DumpRoleBlindError } from '../../src/ops/backup-guard.js';

const run = promisify(execFile);
let h: Harness;

beforeAll(async () => {
  h = await startHarness();
  await seedTwoWorkspaces(h.as('mlain_migrator'));
}, 180_000);

afterAll(async () => {
  await h?.stop();
});

describe('assertDumpRoleSeesAllRows', () => {
  it('projde pod migrátorem, který vlastní schéma', async () => {
    await expect(assertDumpRoleSeesAllRows(h.urlFor('mlain_migrator'))).resolves.toBeUndefined();
  });

  it('spadne pod aplikační rolí, na kterou platí RLS', async () => {
    await expect(assertDumpRoleSeesAllRows(h.urlFor('mlain_app')))
      .rejects.toThrow(DumpRoleBlindError);
  });

  it('spadne pod mlain_backup, protože pg_read_all_data není BYPASSRLS', async () => {
    await expect(assertDumpRoleSeesAllRows(h.urlFor('mlain_backup')))
      .rejects.toThrow(DumpRoleBlindError);
  });

  it('hláška jmenuje roli i konkrétní tabulku, aby šlo jednat', async () => {
    const err = await assertDumpRoleSeesAllRows(h.urlFor('mlain_app')).catch((e: Error) => e);
    expect(err.message).toContain('mlain_app');
    expect(err.message).toContain('contacts');
  });

  it('jmenuje i partitionované tabulky, na které RLS sedí na rodiči', async () => {
    // messages má relkind 'p', ne 'r'. Dotaz zúžený na 'r' by devět největších
    // tabulek přeskočil a pojistka by mlčela právě u nich. Ověřeno spuštěním:
    // relkind='r' najde jen contacts, relkind IN ('r','p') najde i messages.
    const err = await assertDumpRoleSeesAllRows(h.urlFor('mlain_app')).catch((e: Error) => e);
    expect(err.message).toContain('messages');
  });
});

describe('skutečné chování pg_dump, na kterém pojistka stojí', () => {
  // Tenhle blok se NEPTÁ našeho zdrojáku. Spouští pg_dump a měří, co udělá.
  // Bez něj by pojistka chránila před chováním, které si někdo jen pamatuje.
  it('pod rolí s RLS spadne hlasitě, nevyrobí tichou prázdnou zálohu', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'guard-'));
    const result = await run('pg_dump', [
      '--format=custom', '--no-owner', '--no-privileges',
      '--file', join(dir, 'x.dump'), h.urlFor('mlain_backup'),
    ]).then(() => ({ code: 0, stderr: '' }), (e: { code: number; stderr: string }) => e);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('row-level security');
  });

  it('s --enable-row-security naopak projde a vyrobí prázdné tabulky', async () => {
    // Tohle je ta tichá porucha. Test ji drží viditelnou, aby nikdo ten
    // přepínač nedopsal do runBackup jako „opravu" padající noční zálohy.
    const dir = await mkdtemp(join(tmpdir(), 'guard-'));
    const dump = join(dir, 'blind.dump');
    await run('pg_dump', [
      '--format=custom', '--no-owner', '--no-privileges', '--enable-row-security',
      '--file', dump, h.urlFor('mlain_backup'),
    ]);
    const { stdout } = await run('pg_restore', ['--data-only', '--table=contacts', '-f', '-', dump]);
    expect(stdout).not.toContain('@example.test');
  });

  it('runBackup ten přepínač nikdy nepoužije', async () => {
    const source = await readFile(
      new URL('../../src/ops/backup.ts', import.meta.url), 'utf8');
    expect(source).not.toContain('enable-row-security');
  });
});
```

- [ ] **Krok 2: Spusť a ověř pád**

Spusť: `pnpm vitest run packages/core/test/ops/backup-guard.db.test.ts`
Očekávej: FAIL, modul neexistuje.

- [ ] **Krok 3: Implementuj**

```ts
// packages/core/src/ops/backup-guard.ts
import { createPool, withoutContext } from '@mlain/db';
import { sql } from 'drizzle-orm';

export class DumpRoleBlindError extends Error {
  constructor(role: string, tables: readonly string[]) {
    super(
      `Záloha se nespustí. Role ${role} podléhá row level security, takže by pg_dump ` +
        `skončil chybou "query would be affected by row-level security policy" u těchhle ` +
        `tabulek: ${tables.join(', ')}. ` +
        `Nastavte DATABASE_URL_MIGRATOR na roli, která vlastní schéma (mlain_migrator). ` +
        `NEPŘIDÁVEJTE pg_dump přepínač --enable-row-security: ten chybu odstraní tím, ` +
        `že vyrobí zálohu, ve které jsou chráněné tabulky prázdné, a prázdná záloha ` +
        `je horší než žádná, protože vypadá jako hotová práce.`,
    );
    this.name = 'DumpRoleBlindError';
  }
}

/**
 * Zjistí, jestli role, pod kterou by běžel pg_dump, uvidí i řádky chráněné RLS.
 * Nezkoumá se počet řádků (ten může být legitimně nula), ale způsobilost:
 * role musí mít BYPASSRLS, být superuživatel, nebo být vlastníkem tabulky,
 * na které není zapnuté FORCE ROW LEVEL SECURITY.
 *
 * `relkind IN ('r','p')` je podstatné. U partitionované tabulky sedí politika
 * na RODIČI, který má relkind 'p'; jednotlivé oddíly mají relkind 'r', ale
 * `relrowsecurity = false`, protože politiku dědí až za běhu dotazu. Dotaz
 * zúžený na 'r' by tedy prověřil 63 běžných tabulek a ANI JEDNU z devíti
 * největších. Ověřeno spuštěním nad schématem s jednou běžnou a jednou
 * partitionovanou tabulkou.
 */
export async function assertDumpRoleSeesAllRows(databaseUrl: string): Promise<void> {
  const pool = createPool(databaseUrl, 'app', 1);
  try {
    await withoutContext(pool, async (tx) => {
      const { rows: who } = await tx.execute<{
        role: string; bypass: boolean; superuser: boolean;
      }>(sql`SELECT current_user AS role, rolbypassrls AS bypass, rolsuper AS superuser
               FROM pg_roles WHERE rolname = current_user`);
      if (who[0].bypass || who[0].superuser) return;

      const { rows: blind } = await tx.execute<{ relname: string }>(
        sql`SELECT c.relname
              FROM pg_class c
              JOIN pg_namespace n ON n.oid = c.relnamespace
             WHERE c.relkind IN ('r', 'p')
               AND n.nspname NOT IN ('pg_catalog', 'information_schema')
               AND c.relrowsecurity
               AND (c.relforcerowsecurity OR pg_get_userbyid(c.relowner) <> current_user)
             ORDER BY c.relname`);
      if (blind.length > 0) {
        throw new DumpRoleBlindError(
          who[0].role,
          blind.map((r) => r.relname),
        );
      }
    });
  } finally {
    await pool.end();
  }
}
```

- [ ] **Krok 4: Spusť a ověř průchod**

Spusť: `pnpm vitest run packages/core/test/ops/backup-guard.db.test.ts`
Očekávej: PASS, 8 testů.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/ops/backup-guard.ts packages/core/test/ops/backup-guard.db.test.ts
git commit -m "feat(ops): refuse to back up under a role blinded by row level security"
```

---

### Úkol 6: `runBackup`, akceptační kritérium 9

**Soubory:**
- Vytvoř: `packages/core/src/ops/backup.ts`
- Test: `packages/core/test/ops/backup.db.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
// packages/core/test/ops/backup.db.test.ts
import { chmod, mkdir, mkdtemp, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestPostgres } from '../support/db.js';
import { readManifest } from '../../src/ops/backup-manifest.js';
import { runBackup } from '../../src/ops/backup.js';

let pg: TestPostgres;
let root: string;

const base = (dir: string) => ({
  databaseUrl: pg.ownerUrl,
  backupDir: join(root, dir),
  uploadsDir: join(root, 'uploads'),
  appVersion: '1.0.0',
  secretKeyFingerprint: 'VXGoNjoPSBY',
  now: new Date(),
});

beforeAll(async () => {
  pg = await startTestPostgres();
  root = await mkdtemp(join(tmpdir(), 'mlain-backup-'));
  await mkdir(join(root, 'uploads'), { recursive: true });
  await writeFile(join(root, 'uploads', 'logo.png'), 'fake-png');
  await pg.seedMinimalInstallation({ contacts: 7 });
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

describe('runBackup', () => {
  it('vytvoří adresář se třemi soubory a jménem podle 3.14 (kritérium 9)', async () => {
    const result = await runBackup({
      ...base('backups'),
      now: new Date('2026-07-31T03:00:00.000Z'),
    });
    expect((await readdir(result.dir)).sort()).toEqual([
      'database.dump',
      'manifest.json',
      'uploads.tar.gz',
    ]);
    expect(result.dir).toContain('mlain-20260731T030000Z');
  });

  it('row_counts.contacts odpovídá skutečnosti (kritérium 9)', async () => {
    const result = await runBackup(base('backups2'));
    expect((await readManifest(result.dir)).row_counts.contacts).toBe(7);
  });

  it('manifest nese kontrolní součty obou archivů', async () => {
    const manifest = await readManifest((await runBackup(base('backups3'))).dir);
    expect(manifest.database.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.uploads?.files).toBe(1);
  });

  it('bez adresáře uploads nechá uploads v manifestu null a nespadne', async () => {
    const result = await runBackup({ ...base('backups4'), uploadsDir: join(root, 'neexistuje') });
    expect((await readManifest(result.dir)).uploads).toBeNull();
  });

  it('nedokončenou zálohu nenechá pod finálním jménem', async () => {
    await expect(
      runBackup({ ...base('backups5'), databaseUrl: 'postgres://nikdo:nic@127.0.0.1:1/nic' }),
    ).rejects.toThrow();
    const files = await readdir(join(root, 'backups5')).catch(() => [] as string[]);
    expect(files.filter((f) => !f.endsWith('.partial'))).toEqual([]);
  });

  it('zavolá post-backup hook s cestou k adresáři', async () => {
    const hooks = join(root, 'hooks');
    await mkdir(hooks, { recursive: true });
    const hook = join(hooks, 'post-backup.sh');
    await writeFile(hook, '#!/bin/sh\ntouch "$1/hook-was-here.txt"\n');
    await chmod(hook, 0o755);
    const result = await runBackup({ ...base('backups6'), postBackupHook: hook });
    expect(await readdir(result.dir)).toContain('hook-was-here.txt');
  });
});
```

- [ ] **Krok 2: Spusť a ověř pád**

Spusť: `pnpm vitest run packages/core/test/ops/backup.db.test.ts`
Očekávej: FAIL, `Cannot find module '../../src/ops/backup.js'`.

- [ ] **Krok 3: Implementuj**

```ts
// packages/core/src/ops/backup.ts
import { access, mkdir, readdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { assertDumpRoleSeesAllRows } from './backup-guard.js';
import { withAdminTx } from './db.js';
import {
  BACKUP_FORMAT_VERSION,
  BACKUP_ROW_COUNT_TABLES,
  fileSha256,
  writeManifest,
  type BackupManifest,
} from './backup-manifest.js';
import { runProcess } from './run-process.js';

export type RunBackupInput = {
  databaseUrl: string;
  backupDir: string;
  uploadsDir: string;
  appVersion: string;
  secretKeyFingerprint: string;
  now: Date;
  postBackupHook?: string;
};

export type RunBackupResult = { dir: string; manifest: BackupManifest };

/** Jméno adresáře podle 3.14: mlain-<ISO bez oddělovačů>Z */
export function backupDirName(now: Date): string {
  return `mlain-${now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')}`;
}

export async function runBackup(input: RunBackupInput): Promise<RunBackupResult> {
  await assertDumpRoleSeesAllRows(input.databaseUrl);

  const finalDir = join(input.backupDir, backupDirName(input.now));
  const workDir = `${finalDir}.partial`;
  await rm(workDir, { recursive: true, force: true });
  await mkdir(workDir, { recursive: true });

  try {
    const dumpPath = join(workDir, 'database.dump');
    await runProcess('pg_dump', [
      '--format=custom',
      '--no-owner',
      '--no-privileges',
      '--file',
      dumpPath,
      input.databaseUrl,
    ]);

    const uploads = await archiveUploads(input.uploadsDir, join(workDir, 'uploads.tar.gz'));
    const meta = await readInstallationMeta(input.databaseUrl);
    const dumpStat = await stat(dumpPath);

    const manifest: BackupManifest = {
      format_version: BACKUP_FORMAT_VERSION,
      created_at: input.now.toISOString(),
      app_version: input.appVersion,
      schema_version: meta.schemaVersion,
      installation_id: meta.installationId,
      secret_key_fingerprint: input.secretKeyFingerprint,
      postgres_version: meta.postgresVersion,
      database: { bytes: dumpStat.size, sha256: await fileSha256(dumpPath) },
      uploads,
      row_counts: meta.rowCounts,
    };
    await writeManifest(workDir, manifest);

    await rm(finalDir, { recursive: true, force: true });
    await rename(workDir, finalDir);

    if (input.postBackupHook) {
      // Selhání hooku nesmí zneplatnit hotovou zálohu, jen se hlasitě zapíše.
      await runProcess(input.postBackupHook, [finalDir], { timeoutMs: 15 * 60 * 1000 }).catch(
        (err: Error) => console.warn(`post-backup hook selhal: ${err.message}`),
      );
    }

    return { dir: finalDir, manifest };
  } catch (err) {
    await rm(workDir, { recursive: true, force: true });
    throw err;
  }
}

async function archiveUploads(
  uploadsDir: string,
  target: string,
): Promise<BackupManifest['uploads']> {
  try {
    await access(uploadsDir);
  } catch {
    return null;
  }
  await runProcess('tar', ['-czf', target, '-C', uploadsDir, '.']);
  const listing = await runProcess('tar', ['-tzf', target]);
  const files = listing.stdout.split('\n').filter((l) => l.trim() !== '' && !l.endsWith('/')).length;
  const s = await stat(target);
  return { bytes: s.size, sha256: await fileSha256(target), files };
}

type InstallationMeta = {
  schemaVersion: number;
  installationId: string;
  postgresVersion: string;
  rowCounts: Record<string, number>;
};

export async function readInstallationMeta(databaseUrl: string): Promise<InstallationMeta> {
  return withAdminTx(databaseUrl, async (tx) => {
    const { rows: settings } = await tx.execute<{
      schema_version: number; installation_id: string;
    }>(sql`SELECT schema_version, installation_id FROM system_settings WHERE id = true`);
    const { rows: server } = await tx.execute<{ version: string }>(
      sql`SELECT current_setting('server_version') AS version`);

    // sql.param() je povinné: holé pole by se rozložilo na $1, $2, $3 a dotaz
    // by spadl na 42809 op ANY/ALL (array) requires array on right side.
    const { rows: existing } = await tx.execute<{ tablename: string }>(
      sql`SELECT tablename FROM pg_tables
           WHERE schemaname = 'public'
             AND tablename = ANY(${sql.param([...BACKUP_ROW_COUNT_TABLES])})`);

    const rowCounts: Record<string, number> = {};
    for (const { tablename } of existing) {
      // Jméno tabulky pochází z whitelistu výše, ne ze vstupu, takže je
      // sql.raw() bezpečné. Identifikátor se parametrizovat nedá.
      const { rows } = await tx.execute<{ count: string }>(
        sql`SELECT count(*)::text AS count FROM ${sql.raw(`"${tablename}"`)}`);
      rowCounts[tablename] = Number(rows[0].count);
    }
    return {
      schemaVersion: settings[0].schema_version,
      installationId: settings[0].installation_id,
      postgresVersion: server[0].version,
      rowCounts,
    };
  });
}

export type BackupEntry = { name: string; createdAt: Date };

export const BACKUP_MIN_KEPT = 3;

/**
 * Vrátí jména adresářů k odstranění. Vždy zůstanou aspoň tři nejnovější,
 * i kdyby byly starší než limit. Bez toho by instalace, která byla měsíc
 * vypnutá, přišla po prvním startu o všechny zálohy naráz.
 */
export function selectBackupsToDelete(
  entries: readonly BackupEntry[],
  options: { now: Date; retentionDays: number },
): string[] {
  const sorted = [...entries].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const keepAlways = new Set(sorted.slice(0, BACKUP_MIN_KEPT).map((e) => e.name));
  const cutoff = options.now.getTime() - options.retentionDays * 24 * 60 * 60 * 1000;
  return sorted
    .filter((e) => !keepAlways.has(e.name) && e.createdAt.getTime() < cutoff)
    .map((e) => e.name)
    .sort();
}

const DIR_PATTERN = /^mlain-(\d{8})T(\d{6})Z$/;

export async function listBackups(backupDir: string): Promise<BackupEntry[]> {
  const names = await readdir(backupDir).catch(() => [] as string[]);
  return names
    .map((name) => {
      const m = DIR_PATTERN.exec(name);
      if (!m) return null;
      const [, d, t] = m;
      const iso = `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}T${t.slice(0, 2)}:${t.slice(2, 4)}:${t.slice(4, 6)}Z`;
      return { name, createdAt: new Date(iso) };
    })
    .filter((e): e is BackupEntry => e !== null)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function pruneBackups(
  backupDir: string,
  options: { now: Date; retentionDays: number },
): Promise<string[]> {
  const toDelete = selectBackupsToDelete(await listBackups(backupDir), options);
  for (const name of toDelete) {
    await rm(join(backupDir, name), { recursive: true, force: true });
  }
  return toDelete;
}
```

- [ ] **Krok 4: Spusť a ověř průchod**

Spusť: `pnpm vitest run packages/core/test/ops/backup.db.test.ts`
Očekávej: PASS, 6 testů.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/ops/backup.ts packages/core/test/ops/backup.db.test.ts
git commit -m "feat(ops): implement mlain backup with manifest and row counts"
```

---

### Úkol 7: Retence záloh

**Soubory:**
- Test: `packages/core/test/ops/backup-retention.test.ts`

- [ ] **Krok 1: Napiš test na pravidlo „vždy aspoň tři poslední"**

```ts
// packages/core/test/ops/backup-retention.test.ts
import { describe, expect, it } from 'vitest';
import { selectBackupsToDelete } from '../../src/ops/backup.js';

const day = (n: number) => new Date(Date.UTC(2026, 6, n, 3, 0, 0));

describe('selectBackupsToDelete', () => {
  const all = [
    { name: 'a', createdAt: day(1) },
    { name: 'b', createdAt: day(2) },
    { name: 'c', createdAt: day(3) },
    { name: 'd', createdAt: day(20) },
    { name: 'e', createdAt: day(21) },
  ];

  it('smaže jen adresáře starší než limit', () => {
    expect(selectBackupsToDelete(all, { now: day(25), retentionDays: 10 })).toEqual(['a', 'b']);
  });

  it('vždy nechá aspoň tři poslední, i kdyby byly všechny staré', () => {
    expect(selectBackupsToDelete(all, { now: day(400), retentionDays: 14 })).toEqual(['a', 'b']);
  });

  it('při třech a méně zálohách nesmaže nic', () => {
    expect(selectBackupsToDelete(all.slice(0, 3), { now: day(400), retentionDays: 1 })).toEqual([]);
  });

  it('nic nesmaže, když je všechno v limitu', () => {
    expect(selectBackupsToDelete(all, { now: day(22), retentionDays: 30 })).toEqual([]);
  });
});
```

- [ ] **Krok 2: Spusť test**

Spusť: `pnpm vitest run packages/core/test/ops/backup-retention.test.ts`
Očekávej: PASS, 4 testy (implementace vznikla v úkolu 6; kdyby některý padl, oprav `selectBackupsToDelete`, ne test).

- [ ] **Krok 3: Commit**

```bash
git add packages/core/test/ops/backup-retention.test.ts
git commit -m "test(ops): cover backup retention keeping the three newest"
```

---

### Úkol 8: `mlain backup verify`, akceptační kritérium 10

**Soubory:**
- Vytvoř: `packages/core/src/ops/backup-verify.ts`
- Test: `packages/core/test/ops/backup-verify.db.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
// packages/core/test/ops/backup-verify.db.test.ts
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestPostgres } from '../support/db.js';
import { runBackup } from '../../src/ops/backup.js';
import { readManifest, writeManifest } from '../../src/ops/backup-manifest.js';
import { verifyBackup } from '../../src/ops/backup-verify.js';

let pg: TestPostgres;
let backupDir: string;

beforeAll(async () => {
  pg = await startTestPostgres();
  const root = await mkdtemp(join(tmpdir(), 'mlain-verify-'));
  await pg.seedMinimalInstallation({ contacts: 11 });
  backupDir = (
    await runBackup({
      databaseUrl: pg.ownerUrl,
      backupDir: join(root, 'backups'),
      uploadsDir: join(root, 'nic'),
      appVersion: '1.0.0',
      secretKeyFingerprint: 'VXGoNjoPSBY',
      now: new Date(),
    })
  ).dir;
}, 240_000);

afterAll(async () => {
  await pg?.stop();
});

const verifyDbs = async () =>
  pg.sql<{ datname: string }>(
    `SELECT datname FROM pg_database WHERE datname LIKE 'ml_verify_%'`,
  );

describe('verifyBackup', () => {
  it('na čerstvé záloze skončí v pořádku (kritérium 10)', async () => {
    const report = await verifyBackup({ backupDir, adminUrl: pg.ownerUrl });
    expect(report.ok).toBe(true);
    expect(report.problems).toEqual([]);
  });

  it('nenechá po sobě databázi ml_verify_* (kritérium 10)', async () => {
    await verifyBackup({ backupDir, adminUrl: pg.ownerUrl });
    expect(await verifyDbs()).toEqual([]);
  });

  it('pozná rozdíl v počtu řádků a pojmenuje tabulku', async () => {
    const manifest = await readManifest(backupDir);
    await writeManifest(backupDir, {
      ...manifest,
      row_counts: { ...manifest.row_counts, contacts: 999 },
    });
    const report = await verifyBackup({ backupDir, adminUrl: pg.ownerUrl });
    expect(report.ok).toBe(false);
    expect(report.problems.join(' ')).toContain('contacts');
    await writeManifest(backupDir, manifest);
  });

  it('pozná poškozený dump podle kontrolního součtu, aniž zakládá databázi', async () => {
    const manifest = await readManifest(backupDir);
    await writeManifest(backupDir, {
      ...manifest,
      database: { ...manifest.database, sha256: 'f'.repeat(64) },
    });
    const report = await verifyBackup({ backupDir, adminUrl: pg.ownerUrl });
    expect(report.ok).toBe(false);
    expect(report.problems.join(' ')).toMatch(/kontroln|sha256/i);
    expect(await verifyDbs()).toEqual([]);
    await writeManifest(backupDir, manifest);
  });

  it('uklidí dočasnou databázi i tehdy, když obnova spadne', async () => {
    await expect(
      verifyBackup({ backupDir: join(backupDir, 'neexistuje'), adminUrl: pg.ownerUrl }),
    ).rejects.toThrow();
    expect(await verifyDbs()).toEqual([]);
  });
});
```

- [ ] **Krok 2: Spusť a ověř pád**

Spusť: `pnpm vitest run packages/core/test/ops/backup-verify.db.test.ts`
Očekávej: FAIL, modul neexistuje.

- [ ] **Krok 3: Implementuj**

```ts
// packages/core/src/ops/backup-verify.ts
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { runMigrations } from '@mlain/db/migrate';
import { compareRowCounts, fileSha256, readManifest } from './backup-manifest.js';
import { withAdminTx } from './db.js';
import { runProcess } from './run-process.js';

export type VerifyInput = {
  backupDir: string;
  /** URL role, která smí zakládat a rušit databáze, tedy mlain_migrator s CREATEDB. */
  adminUrl: string;
  now?: Date;
};

export type VerifyReport = { ok: boolean; problems: string[] };

/** Integritní dotazy podle 3.14. Očekávaná hodnota je u prvního 1, u ostatních 0. */
const INTEGRITY_QUERIES: ReadonlyArray<{ label: string; sql: string; expect: number }> = [
  {
    label: 'system_settings má právě jeden řádek',
    sql: 'SELECT count(*)::int AS n FROM system_settings',
    expect: 1,
  },
  {
    label: 'každý projekt má aspoň jednoho ownera',
    sql: `SELECT count(*)::int AS n FROM workspaces w
           WHERE w.deleted_at IS NULL
             AND NOT EXISTS (SELECT 1 FROM memberships m
                              WHERE m.workspace_id = w.id AND m.role = 'owner')`,
    expect: 0,
  },
  {
    label: 'žádné osiřelé členství',
    sql: `SELECT count(*)::int AS n FROM memberships m
           WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = m.user_id)
              OR NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.id = m.workspace_id)`,
    expect: 0,
  },
];

export async function verifyBackup(input: VerifyInput): Promise<VerifyReport> {
  const now = input.now ?? new Date();
  const problems: string[] = [];

  await dropStaleVerifyDatabases(input.adminUrl, now);

  const manifest = await readManifest(input.backupDir);
  const dumpPath = join(input.backupDir, 'database.dump');
  const actualHash = await fileSha256(dumpPath);
  if (actualHash !== manifest.database.sha256) {
    return {
      ok: false,
      problems: [
        `Kontrolní součet database.dump nesedí. V manifestu ${manifest.database.sha256}, ve skutečnosti ${actualHash}.`,
      ],
    };
  }

  const dbName = `ml_verify_${now.toISOString().replace(/\D/g, '').slice(0, 14)}`;
  const verifyUrl = replaceDatabase(input.adminUrl, dbName);

  await runProcess('createdb', ['--maintenance-db', input.adminUrl, dbName]);
  try {
    await runProcess('pg_restore', [
      '--no-owner',
      '--no-privileges',
      '--exit-on-error',
      '--dbname',
      verifyUrl,
      dumpPath,
    ]);
    // Migrace i granty. Dump nese ledger migrací, takže runMigrations po obnově
    // NIC nepoužije, a `--no-privileges` znamená, že v dumpu žádné granty nejsou.
    // Bez mlain_apply_grants() by ověřovací databáze byla bez oprávnění a
    // integritní dotazy by se v ní chovaly jinak než v ostré instalaci.
    await runMigrations({ url: verifyUrl });
    await applyGrants(verifyUrl);

    await withAdminTx(verifyUrl, async (tx) => {
      const actual: Record<string, number> = {};
      for (const table of Object.keys(manifest.row_counts)) {
        const { rows } = await tx.execute<{ count: string }>(
          sql`SELECT count(*)::text AS count FROM ${sql.raw(`"${table}"`)}`);
        actual[table] = Number(rows[0].count);
      }
      for (const diff of compareRowCounts(manifest.row_counts, actual)) {
        problems.push(
          `Tabulka ${diff.table}: v manifestu ${diff.expected}, po obnově ${diff.actual}.`,
        );
      }
      for (const q of INTEGRITY_QUERIES) {
        const { rows } = await tx.execute<{ n: number }>(sql.raw(q.sql));
        if (rows[0].n !== q.expect) {
          problems.push(`Integritní kontrola selhala: ${q.label} (${rows[0].n}).`);
        }
      }
    });
  } finally {
    await runProcess('dropdb', ['--force', '--maintenance-db', input.adminUrl, dbName]).catch(
      () => undefined,
    );
  }

  return { ok: problems.length === 0, problems };
}

/**
 * Obnoví oprávnění po `pg_restore --no-privileges`.
 *
 * Funkci `mlain_apply_grants()` vlastní P03 (jeho rozhodnutí R25) a je
 * idempotentní, takže se smí volat kolikrát chce. V dumpu přežije, protože
 * je to objekt schématu, ne oprávnění. Ověřeno spuštěním: po obnově bez ní
 * skončí `mlain_app` na `permission denied for table contacts`, po jejím
 * zavolání čte normálně.
 */
export async function applyGrants(databaseUrl: string): Promise<void> {
  await withAdminTx(databaseUrl, async (tx) => {
    await tx.execute(sql`SELECT mlain_apply_grants()`);
  });
}

/** Uklidí ověřovací databáze po pádu procesu, aby se nehromadily. */
async function dropStaleVerifyDatabases(adminUrl: string, now: Date): Promise<void> {
  const names = await withAdminTx(adminUrl, async (tx) => {
    const { rows } = await tx.execute<{ datname: string }>(
      sql`SELECT datname FROM pg_database WHERE datname LIKE 'ml_verify_%'`);
    return rows.map((r) => r.datname);
  });
  for (const name of names) {
    const s = name.slice('ml_verify_'.length);
    const created = Date.parse(
      `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(8, 10)}:${s.slice(10, 12)}:${s.slice(12, 14)}Z`,
    );
    if (Number.isNaN(created) || now.getTime() - created > 60 * 60 * 1000) {
      await runProcess('dropdb', ['--force', '--maintenance-db', adminUrl, name]).catch(
        () => undefined,
      );
    }
  }
}

export function replaceDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}
```

- [ ] **Krok 4: Spusť a ověř průchod**

Spusť: `pnpm vitest run packages/core/test/ops/backup-verify.db.test.ts`
Očekávej: PASS, 5 testů.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/ops/backup-verify.ts packages/core/test/ops/backup-verify.db.test.ts
git commit -m "feat(ops): verify backups by restoring into a scratch database"
```

---

### Úkol 9: `mlain restore`, akceptační kritéria 11 a 12

**Soubory:**
- Vytvoř: `packages/core/src/ops/restore.ts`
- Test: `packages/core/test/ops/restore.db.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
// packages/core/test/ops/restore.db.test.ts
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestPostgres } from '../support/db.js';
import { runBackup } from '../../src/ops/backup.js';
import { readManifest, writeManifest } from '../../src/ops/backup-manifest.js';
import { RestoreRefusedError, restoreBackup } from '../../src/ops/restore.js';

let pg: TestPostgres;
let backupDir: string;

const base = () => ({
  backupDir,
  databaseUrl: pg.ownerUrl,
  uploadsDir: '/tmp/mlain-restore-uploads',
  appVersion: '1.0.0',
  currentFingerprint: 'VXGoNjoPSBY',
});

beforeAll(async () => {
  pg = await startTestPostgres();
  const root = await mkdtemp(join(tmpdir(), 'mlain-restore-'));
  await pg.seedMinimalInstallation({ contacts: 4 });
  backupDir = (
    await runBackup({
      databaseUrl: pg.ownerUrl,
      backupDir: join(root, 'backups'),
      uploadsDir: join(root, 'nic'),
      appVersion: '1.0.0',
      secretKeyFingerprint: 'VXGoNjoPSBY',
      now: new Date(),
    })
  ).dir;
}, 240_000);

afterAll(async () => {
  await pg?.stop();
});

describe('restoreBackup', () => {
  it('do neprázdné databáze bez --force skončí chybou a nic nezmění (kritérium 11)', async () => {
    const before = await pg.sql<{ n: string }>('SELECT count(*)::text AS n FROM contacts');
    await expect(restoreBackup({ ...base(), force: false })).rejects.toThrow(RestoreRefusedError);
    const after = await pg.sql<{ n: string }>('SELECT count(*)::text AS n FROM contacts');
    expect(after[0].n).toBe(before[0].n);
  });

  it('zálohu z novější verze odmítne s backup_from_newer_version (kritérium 12)', async () => {
    const manifest = await readManifest(backupDir);
    await writeManifest(backupDir, { ...manifest, app_version: '2.0.0' });
    const err = await restoreBackup({ ...base(), force: true }).catch((e: Error) => e);
    expect(String(err)).toContain('backup_from_newer_version');
    await writeManifest(backupDir, manifest);
  });

  it('při neshodě otisku klíče vyžaduje --i-know-the-key-differs', async () => {
    const err = await restoreBackup({
      ...base(),
      currentFingerprint: 'jinyOtisk1',
      force: true,
    }).catch((e: Error) => e);
    expect(String(err)).toContain('--i-know-the-key-differs');
  });

  it('poškozený dump odmítne dřív, než sáhne na databázi', async () => {
    const manifest = await readManifest(backupDir);
    await writeManifest(backupDir, {
      ...manifest,
      database: { ...manifest.database, sha256: '0'.repeat(64) },
    });
    await expect(restoreBackup({ ...base(), force: true })).rejects.toThrow(RestoreRefusedError);
    await writeManifest(backupDir, manifest);
  });

  it('s --force obnoví data a vrátí shodné počty', async () => {
    await pg.sql(
      `INSERT INTO contacts (id, workspace_id, email, source, locale, timezone)
       SELECT gen_random_uuid(), id, 'navic@example.com', 'manual', 'cs', 'Europe/Prague'
         FROM workspaces LIMIT 1`,
    );
    const report = await restoreBackup({ ...base(), force: true });
    expect(report.rowCountDiffs).toEqual([]);
    const rows = await pg.sql<{ n: string }>('SELECT count(*)::text AS n FROM contacts');
    expect(rows[0].n).toBe('4');
  });

  it('zapíše do auditu akci backup.restored', async () => {
    const rows = await pg.sql<{ action: string }>(
      "SELECT action FROM audit_log WHERE action = 'backup.restored'",
    );
    expect(rows.length).toBeGreaterThan(0);
  });

  // -------------------------------------------------------------------------
  // Tenhle test je důvod, proč obnova volá mlain_apply_grants().
  //
  // Ptá se APLIKAČNÍ role, ne migrátora. Pod migrátorem projde i databáze,
  // ve které nemá aplikace žádná práva, takže by celý soubor mohl svítit
  // zeleně nad instalací, která po obnově nenastartuje.
  //
  // Ověřeno spuštěním, že bez toho volání to skutečně padá:
  //   ERROR: permission denied for table contacts
  // -------------------------------------------------------------------------
  it('po obnově má aplikační role práva, tedy granty se vrátily', async () => {
    await restoreBackup({ ...base(), force: true });
    const client = await pg.as('mlain_app').connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('mlain.workspace_id', $1, true)`, [
        (await pg.sql<{ id: string }>('SELECT id FROM workspaces LIMIT 1'))[0].id,
      ]);
      const { rows } = await client.query('SELECT count(*)::int AS n FROM contacts');
      expect(rows[0].n).toBe(4);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
  });

  it('po obnově platí i append-only omezení z mlain_apply_grants()', async () => {
    // Append-only REVOKE jsou uvnitř téže funkce (P03, R25). Kdyby obnova
    // volala jen granty a ne funkci, byly by tabulky auditu po havárii
    // najednou zapisovatelné a nikdo by si toho nevšiml.
    const client = await pg.as('mlain_app').connect();
    try {
      await expect(client.query('DELETE FROM audit_log')).rejects.toThrow(/permission denied/);
    } finally {
      client.release();
    }
  });
});
```

- [ ] **Krok 2: Spusť a ověř pád**

Spusť: `pnpm vitest run packages/core/test/ops/restore.db.test.ts`
Očekávej: FAIL, modul neexistuje.

- [ ] **Krok 3: Implementuj**

```ts
// packages/core/src/ops/restore.ts
import { access, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { writeAuditLog } from '@mlain/core/audit/write';
import { runMigrations } from '@mlain/db/migrate';
import {
  compareRowCounts,
  fileSha256,
  isBackupFromNewerVersion,
  readManifest,
  type RowCountDiff,
} from './backup-manifest.js';
import { applyGrants } from './backup-verify.js';
import { withAdminTx } from './db.js';
import { runProcess } from './run-process.js';

export class RestoreRefusedError extends Error {
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
    this.name = 'RestoreRefusedError';
  }
}

export type RestoreInput = {
  backupDir: string;
  databaseUrl: string;
  uploadsDir: string;
  appVersion: string;
  currentFingerprint: string;
  force: boolean;
  skipUploads?: boolean;
  acknowledgeKeyDiffers?: boolean;
};

export type RestoreReport = {
  rowCountDiffs: RowCountDiff[];
  comparedTables: number;
  keyDiffers: boolean;
};

export async function restoreBackup(input: RestoreInput): Promise<RestoreReport> {
  // Brána 1: manifest, format_version a kontrolní součty.
  const manifest = await readManifest(input.backupDir);
  const dumpPath = join(input.backupDir, 'database.dump');
  const hash = await fileSha256(dumpPath);
  if (hash !== manifest.database.sha256) {
    throw new RestoreRefusedError(
      'Kontrolní součet database.dump nesedí, záloha je poškozená. Obnova se nespustí a databáze zůstala nedotčená.',
      'backup_checksum_mismatch',
    );
  }

  // Brána 2: verze image.
  if (isBackupFromNewerVersion(manifest.app_version, input.appVersion)) {
    throw new RestoreRefusedError(
      `backup_from_newer_version: záloha je z verze ${manifest.app_version}, tahle image je ${input.appVersion}. ` +
        'Novější zálohu do starší aplikace obnovit nejde, poškodila by schéma. Aktualizujte image a zkuste to znovu.',
      'backup_from_newer_version',
    );
  }

  // Brána 3: prázdnost cílové databáze.
  if (!(await isDatabaseEmpty(input.databaseUrl)) && !input.force) {
    throw new RestoreRefusedError(
      'Cílová databáze není prázdná a obnova by ji přepsala. Nic jsem nezměnil. ' +
        'Když to opravdu chcete, zopakujte příkaz s --force; použije se pg_restore --clean --if-exists.',
      'target_database_not_empty',
    );
  }

  // Brána 4: otisk klíče.
  const keyDiffers = manifest.secret_key_fingerprint !== input.currentFingerprint;
  if (keyDiffers && !input.acknowledgeKeyDiffers) {
    throw new RestoreRefusedError(
      `Otisk SECRET_KEY v záloze (${manifest.secret_key_fingerprint}) se liší od otisku aktuálního klíče ` +
        `(${input.currentFingerprint}). Uložené přístupy k odesílání ani AI klíče nepůjde přečíst a bude nutné je ` +
        'zadat znovu. Otisky smazaných adres pod starými pokoleními přestanou platit, dokud staré klíče nedoplníte ' +
        'do SECRET_KEY_PREVIOUS. Když to víte, zopakujte příkaz s --i-know-the-key-differs.',
      'secret_key_fingerprint_mismatch',
    );
  }

  const restoreArgs = ['--no-owner', '--no-privileges', '--exit-on-error'];
  if (input.force) restoreArgs.push('--clean', '--if-exists');
  await runProcess('pg_restore', [...restoreArgs, '--dbname', input.databaseUrl, dumpPath]);

  if (!input.skipUploads && manifest.uploads) {
    await mkdir(input.uploadsDir, { recursive: true });
    const archive = join(input.backupDir, 'uploads.tar.gz');
    await access(archive);
    await runProcess('tar', ['-xzf', archive, '-C', input.uploadsDir]);
  }

  await runMigrations({ url: input.databaseUrl });

  // ---------------------------------------------------------------------------
  // KROK, BEZ KTERÉHO JE OBNOVA NEPOUŽITELNÁ, a který se přehlédne nejsnáz,
  // protože všechno kolem něj vypadá hotové.
  //
  // `pg_dump --no-privileges` z úkolu 6 (tak to předepisuje 3.14) do dumpu
  // ŽÁDNÉ granty nedá. Politiky RLS v dumpu jsou, protože to jsou objekty
  // schématu, ale oprávnění ne. Spolu s daty se obnoví i ledger migrací
  // `drizzle.__drizzle_migrations`, takže `runMigrations` o řádek výš považuje
  // migraci 0005 za aplikovanou a PŘESKOČÍ JI.
  //
  // Výsledek bez tohohle řádku, ověřeno spuštěním: obnova skončí nulou,
  // migrace ohlásí, že není co dělat, a první dotaz aplikace spadne na
  // `ERROR: permission denied for table contacts`. V nejhorší možný okamžik,
  // protože obnova ze zálohy se dělá po havárii.
  //
  // Proto P03 granty vede jako idempotentní funkci `mlain_apply_grants()`
  // (rozhodnutí R25), ne jako jednorázovou migraci. Funkce v dumpu přežije
  // a zavolat se smí kolikrát chce.
  // ---------------------------------------------------------------------------
  await applyGrants(input.databaseUrl);

  const report = await withAdminTx(input.databaseUrl, async (tx) => {
    const actual: Record<string, number> = {};
    for (const table of Object.keys(manifest.row_counts)) {
      const { rows } = await tx.execute<{ count: string }>(
        sql`SELECT count(*)::text AS count FROM ${sql.raw(`"${table}"`)}`);
      actual[table] = Number(rows[0].count);
    }
    const diffs = compareRowCounts(manifest.row_counts, actual);

    await writeAuditLog(tx, {
      action: 'backup.restored',
      workspaceId: null,
      actor: { type: 'system', job: 'mlain restore' },
      targetType: 'backup',
      targetId: manifest.installation_id,
      metadata: {
        backup_created_at: manifest.created_at,
        backup_app_version: manifest.app_version,
        force: input.force,
        key_differs: keyDiffers,
        row_count_diffs: diffs.length,
      },
    });

    return {
      rowCountDiffs: diffs,
      comparedTables: Object.keys(manifest.row_counts).length,
      keyDiffers,
    };
  });

  return report;
}

/** Prázdná znamená: ve schématech public, drizzle a pgboss není jediná tabulka. */
export async function isDatabaseEmpty(databaseUrl: string): Promise<boolean> {
  return withAdminTx(databaseUrl, async (tx) => {
    const { rows } = await tx.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM pg_tables
           WHERE schemaname IN ('public','drizzle','pgboss')`);
    return rows[0].n === 0;
  });
}
```

- [ ] **Krok 4: Spusť a ověř průchod**

Spusť: `pnpm vitest run packages/core/test/ops/restore.db.test.ts`
Očekávej: PASS, 8 testů.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/ops/restore.ts packages/core/test/ops/restore.db.test.ts
git commit -m "feat(ops): implement mlain restore with four safety gates"
```

---

### Úkol 10: Příkazy `mlain backup` a `mlain restore`

**Soubory:**
- Vytvoř: `apps/cli/src/commands/backup.ts`, `apps/cli/src/commands/restore.ts`
- Test: `apps/cli/test/commands/registration.test.ts`

**Poznámka k vlastnictví.** `apps/cli/src/{main,registry,dispatch,exit-codes}.ts` vlastní P01 a jeho rozhodnutí D1 počítá s tím, že těla těchhle příkazů dodá P16 (jeho `vitest.config.ts` to říká výslovně: „příkazy `mlain` dodává P03 a P16"). P16 zakládá jen soubory v `apps/cli/src/commands/`, které P01 nevytváří, a **do `registry.ts` ani `dispatch.ts` nesahá**. Dvě mechanické změny v nich jsou rozhraní I→P01.1: přepnout `implemented` na `true` u osmi příkazů a doplnit osm `case` větví do `switch`.

Kdyby to P16 udělal sám, porušil by uzávěr S10 P01 a zároveň by si sám zrušil bránu, která tuhle chybu odhalí. Test v kroku 1 proto zůstává červený, dokud P01 svou část nedodá; to je jeho účel, ne nedodělek.

- [ ] **Krok 1: Napiš padající test registrace**

Test se ptá **dispatcheru**, ne registru. Registr je jen tabulka jmen, kterou by šlo mít vyplněnou i tehdy, když příkaz nikam nevede; jediné, co provozovatele opravdu zajímá, je, že `mlain doctor` něco udělá místo hlášky „not implemented". P01 vrací u nezapojeného příkazu `EXIT_UNAVAILABLE`, tedy 69, a právě to je ta pozorovatelná vlastnost.

```ts
// apps/cli/test/commands/registration.test.ts
import { describe, expect, it } from 'vitest';
import { dispatch, type CliStreams } from '../../src/dispatch.js';
import { EXIT_UNAVAILABLE } from '../../src/exit-codes.js';
import { COMMANDS } from '../../src/registry.js';

const P16_COMMANDS = [
  'backup',
  'restore',
  'doctor',
  'upgrade',
  'rotate-credentials',
  'genkey',
  'rebuild-engagement',
  'reset-password',
] as const;

const io = (): CliStreams & { out: string[]; err: string[] } => {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: (l) => out.push(l), stderr: (l) => err.push(l) };
};

describe('registrace příkazů P16', () => {
  it.each(P16_COMMANDS)('příkaz %s je v registru', (name) => {
    expect(COMMANDS.map((c) => c.name)).toContain(name);
  });

  it.each(P16_COMMANDS)('příkaz %s je označený jako implementovaný', (name) => {
    expect(COMMANDS.find((c) => c.name === name)?.implemented).toBe(true);
  });

  it.each(P16_COMMANDS)('příkaz %s NEVRACÍ exit 69, tedy je zapojený v dispatchi', async (name) => {
    // `--help` vypíše nápovědu a skončí nulou u KAŽDÉHO příkazu, i neimplementovaného,
    // takže se ptáme na skutečné spuštění. Bez konfigurace většina skončí kódem 78,
    // což je v pořádku: 78 znamená „příkaz běžel a chybí mu konfigurace",
    // kdežto 69 znamená „tělo příkazu vůbec nikdo nezavolal".
    const code = await dispatch([name], { ...io(), env: {} });
    expect(code).not.toBe(EXIT_UNAVAILABLE);
  });

  it('mlain migrate zůstává v registru, protože ho dodává P03', () => {
    expect(COMMANDS.map((c) => c.name)).toContain('migrate');
  });

  it('backup zná podpříkazy verify a list', () => {
    const backup = COMMANDS.find((c) => c.name === 'backup');
    expect([...(backup?.subcommands ?? [])].sort()).toEqual(['list', 'verify']);
  });

  it('každý příkaz má jednořádkový popis pro nápovědu', () => {
    for (const c of COMMANDS) {
      expect(c.summary.length).toBeGreaterThan(10);
      expect(c.summary).not.toContain('\n');
    }
  });
});
```

- [ ] **Krok 2: Spusť a ověř pád**

Spusť: `pnpm vitest run apps/cli/test/commands/registration.test.ts`
Očekávej: FAIL. Osm příkazů má v registru P01 `implemented: false` a dispatcher u nich vrací 69. **Tenhle pád je požadavek I→P01.1** a zezelená až tehdy, když P01 přepne příznak a doplní osm větví do `switch`. Do té doby ho neobcházej změnou testu.

- [ ] **Krok 3: Implementuj `backup.ts`**

```ts
// apps/cli/src/commands/backup.ts
import { parseArgs } from 'node:util';
import { loadConfig } from '@mlain/core/config';
import {
  listBackups,
  loadOpsKeyring,
  pruneBackups,
  runBackup,
  verifyBackup,
} from '@mlain/core/ops';
import { EXIT } from '../exit-codes.js';
import type { CliStreams } from '../dispatch.js';

const KEY_WARNING =
  'Šifrovací klíč v záloze schválně není. Uložte si zvlášť celý keyring, tedy SECRET_KEY ' +
  'i všechna předchozí pokolení ze SECRET_KEY_PREVIOUS. Bez starých pokolení přestanou platit ' +
  'otisky smazaných adres a smazaní lidé se vrátí prvním dalším importem.';

export async function runBackupCommand(
  streams: CliStreams,
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  {
    const config = loadConfig(env);
    const adminUrl = config.DATABASE_URL_MIGRATOR;
    if (!adminUrl) {
      streams.stderr(
        'Záloha potřebuje DATABASE_URL_MIGRATOR. Aplikační role podléhá row level security ' +
          'a pg_dump pod ní skončí chybou "query would be affected by row-level security policy".',
      );
      return EXIT_CONFIG;
    }

    const [sub, ...rest] = argv;

    if (sub === 'verify') {
      const dir = rest.find((a) => !a.startsWith('--'));
      if (!dir) {
        streams.stderr('Použití: mlain backup verify <adresář>');
        return EXIT_USAGE;
      }
      const report = await verifyBackup({ backupDir: dir, adminUrl });
      if (report.ok) {
        streams.stdout(`Záloha ${dir} je v pořádku.`);
        return 0;
      }
      streams.stderr(`Záloha ${dir} NEPROŠLA ověřením:`);
      for (const p of report.problems) streams.stderr(`  - ${p}`);
      return 1;
    }

    if (sub === 'list') {
      const entries = await listBackups(config.BACKUP_DIR);
      if (entries.length === 0) {
        streams.stdout('Zatím žádná záloha.');
        return 0;
      }
      for (const e of entries) streams.stdout(`${e.name}\t${e.createdAt.toISOString()}`);
      return 0;
    }

    const { values } = parseArgs({
      args: [...argv],
      options: { 'skip-prune': { type: 'boolean', default: false } },
      allowPositionals: true,
    });

    const keyring = loadOpsKeyring({
      secretKey: config.SECRET_KEY,
      secretKeyPrevious: config.SECRET_KEY_PREVIOUS,
    });
    const result = await runBackup({
      databaseUrl: adminUrl,
      backupDir: config.BACKUP_DIR,
      uploadsDir: config.UPLOADS_DIR,
      appVersion: config.IMAGE_VERSION,
      secretKeyFingerprint: keyring.currentFingerprint,
      now: new Date(),
      postBackupHook: `${config.DATA_DIR}/hooks/post-backup.sh`,
    });
    streams.stdout(`Záloha hotová: ${result.dir}`);
    streams.stdout(`Kontaktů v záloze: ${result.manifest.row_counts.contacts}`);
    streams.stdout(`${KEY_WARNING}`);

    if (!values['skip-prune']) {
      const deleted = await pruneBackups(config.BACKUP_DIR, {
        now: new Date(),
        retentionDays: config.BACKUP_RETENTION_DAYS,
      });
      if (deleted.length > 0) streams.stdout(`Smazané staré zálohy: ${deleted.join(', ')}`);
    }
    return EXIT_OK;
  }
}
```

- [ ] **Krok 4: Implementuj `restore.ts`**

```ts
// apps/cli/src/commands/restore.ts
import { parseArgs } from 'node:util';
import { loadConfig } from '@mlain/core/config';
import { loadOpsKeyring, RestoreRefusedError, restoreBackup } from '@mlain/core/ops';
import { EXIT_CONFIG, EXIT_OK, EXIT_USAGE } from '../exit-codes.js';
import type { CliStreams } from '../dispatch.js';

export async function runRestoreCommand(
  streams: CliStreams,
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  {
    const { values, positionals } = parseArgs({
      args: [...argv],
      options: {
        force: { type: 'boolean', default: false },
        'skip-uploads': { type: 'boolean', default: false },
        'i-know-the-key-differs': { type: 'boolean', default: false },
      },
      allowPositionals: true,
    });
    const dir = positionals[0];
    if (!dir) {
      streams.stderr(
        'Použití: mlain restore <adresář> [--force] [--skip-uploads] [--i-know-the-key-differs]',
      );
      return EXIT_USAGE;
    }

    const config = loadConfig(env);
    if (!config.DATABASE_URL_MIGRATOR) {
      streams.stderr(
        'Obnova vyžaduje DATABASE_URL_MIGRATOR, protože aplikační role schéma nevlastní ' +
          'a po obnově je potřeba zavolat mlain_apply_grants().',
      );
      return EXIT_CONFIG;
    }
    const keyring = loadOpsKeyring({
      secretKey: config.SECRET_KEY,
      secretKeyPrevious: config.SECRET_KEY_PREVIOUS,
    });

    try {
      const report = await restoreBackup({
        backupDir: dir,
        databaseUrl: config.DATABASE_URL_MIGRATOR,
        uploadsDir: config.UPLOADS_DIR,
        appVersion: config.IMAGE_VERSION,
        currentFingerprint: keyring.currentFingerprint,
        force: values.force === true,
        skipUploads: values['skip-uploads'] === true,
        acknowledgeKeyDiffers: values['i-know-the-key-differs'] === true,
      });
      streams.stdout(`Obnoveno. Porovnáno ${report.comparedTables} tabulek.`);
      if (report.rowCountDiffs.length === 0) {
        streams.stdout('Počty řádků sedí s manifestem.');
      } else {
        streams.stdout('Rozdíly proti manifestu:');
        for (const d of report.rowCountDiffs) {
          streams.stdout(`  ${d.table}: v manifestu ${d.expected}, po obnově ${d.actual}`);
        }
      }
      if (report.keyDiffers) {
        streams.stdout(
          'POZOR: obnovovalo se s jiným SECRET_KEY. Zadejte znovu přístupy k odesílání a AI klíče ' +
            'a doplňte stará pokolení do SECRET_KEY_PREVIOUS, jinak přestanou platit otisky smazaných adres.',
        );
      }
      return EXIT_OK;
    } catch (err) {
      if (err instanceof RestoreRefusedError) {
        streams.stderr(err.message);
        return 1;
      }
      throw err;
    }
  }
}
```

- [ ] **Krok 5: Spusť test registrace**

Spusť: `pnpm vitest run apps/cli/test/commands/registration.test.ts`
Očekávej: FAIL na šesti dosud nenapsaných příkazech, PASS na `backup` a `restore`. Do zelena se test dostane až úkolem 19.

- [ ] **Krok 6: Commit**

```bash
git add apps/cli/src/commands/backup.ts apps/cli/src/commands/restore.ts apps/cli/test/commands/registration.test.ts
git commit -m "feat(cli): add mlain backup and mlain restore commands"
```

---

### Úkol 11: Kostra `mlain doctor`

**Soubory:**
- Vytvoř: `packages/core/src/ops/doctor/types.ts`, `packages/core/src/ops/doctor/format.ts`
- Test: `packages/core/test/ops/doctor-format.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
// packages/core/test/ops/doctor-format.test.ts
import { describe, expect, it } from 'vitest';
import { exitCodeFor, formatJson, formatReport } from '../../src/ops/doctor/format.js';
import type { DoctorFinding } from '../../src/ops/doctor/types.js';

const critical: DoctorFinding = {
  id: 'missing_key_generations',
  severity: 'critical',
  title: 'Instalace nezná pokolení klíče 1, 2',
  detail: 'V suppression listu jsou otisky pod pokoleními, pro která nemá instalace klíč.',
  action: 'Doplňte stará pokolení do SECRET_KEY_PREVIOUS.',
};
const warning: DoctorFinding = {
  id: 'backup_stale',
  severity: 'warning',
  title: 'Poslední záloha je stará 9 dní',
  detail: '',
  action: 'Spusťte mlain backup.',
};
const info: DoctorFinding = {
  id: 'demo_data_present',
  severity: 'info',
  title: 'V projektu Ukázka jsou ukázková data',
  detail: '',
  action: '',
};

describe('exitCodeFor', () => {
  it('bez nálezů vrací 0', () => {
    expect(exitCodeFor([], { strict: false })).toBe(0);
  });

  it('informace nikdy nezvedne návratový kód', () => {
    expect(exitCodeFor([info], { strict: true })).toBe(0);
  });

  it('varování vrací 0 bez --strict a 1 s ním', () => {
    expect(exitCodeFor([warning], { strict: false })).toBe(0);
    expect(exitCodeFor([warning], { strict: true })).toBe(1);
  });

  it('kritický nález vrací 2 vždy, i bez --strict', () => {
    expect(exitCodeFor([critical], { strict: false })).toBe(2);
    expect(exitCodeFor([critical, warning], { strict: true })).toBe(2);
  });
});

describe('formatReport', () => {
  it('řadí kritické nálezy nahoru', () => {
    const out = formatReport([info, warning, critical]);
    expect(out.indexOf('missing_key_generations')).toBeLessThan(out.indexOf('backup_stale'));
    expect(out.indexOf('backup_stale')).toBeLessThan(out.indexOf('demo_data_present'));
  });

  it('u každého nálezu vypíše identifikátor, aby šel dohledat', () => {
    expect(formatReport([critical])).toContain('missing_key_generations');
  });

  it('bez nálezů řekne, že je instalace v pořádku', () => {
    expect(formatReport([])).toContain('v pořádku');
  });
});

describe('formatJson', () => {
  it('vrací strojově čitelný tvar se souhrnem', () => {
    const parsed = JSON.parse(formatJson([critical, warning, info]));
    expect(parsed.summary).toEqual({ critical: 1, warning: 1, info: 1 });
    expect(parsed.findings[0].id).toBe('missing_key_generations');
  });
});
```

- [ ] **Krok 2: Spusť a ověř pád**

Spusť: `pnpm vitest run packages/core/test/ops/doctor-format.test.ts`
Očekávej: FAIL, moduly neexistují.

- [ ] **Krok 3: Implementuj typy**

```ts
// packages/core/src/ops/doctor/types.ts
export type DoctorSeverity = 'critical' | 'warning' | 'info';

export type DoctorFinding = {
  /** Stabilní identifikátor nálezu, podle kterého se dá hledat v dokumentaci. */
  id: string;
  severity: DoctorSeverity;
  title: string;
  detail: string;
  /** Co má provozovatel udělat. Prázdné jen u čistě informativních nálezů. */
  action: string;
};

export type DoctorContext = {
  /**
   * URL APLIKAČNÍ role. Používá se výhradně tam, kde je aplikační role sama
   * předmětem kontroly: rozpočet spojení a předpoklady izolace. **Nikdy se
   * z ní nečtou data.** Politika `ws_isolation` filtruje podle
   * `mlain.workspace_id`, který diagnostika nenastavuje a nastavit nemůže,
   * takže by každý dotaz vrátil nula řádků, exit 0 a žádnou chybu.
   */
  appUrl: string;
  /**
   * URL MIGRÁTORA, tedy `DATABASE_URL_MIGRATOR`. Jediná cesta, kterou smí
   * diagnostika číst data napříč projekty. Když chybí, kontrola, která ji
   * potřebuje, vrátí `check_failed`, ne prázdný seznam.
   */
  adminUrl: string | null;
  dataDir: string;
  backupDir: string;
  uploadsDir: string;
  secretKey: string;
  secretKeyPrevious: string;
  imageVersion: string;
  now: Date;
};

export type DoctorCheck = (ctx: DoctorContext) => Promise<DoctorFinding[]>;

/**
 * Nález pro kontrolu, která neměla jak proběhnout.
 *
 * Existuje proto, že mlčení a „vše v pořádku" vypadají v tomhle nástroji
 * úplně stejně. Kontrola, která nemá `DATABASE_URL_MIGRATOR`, nesmí vrátit
 * prázdný seznam: provozovatel by z výstupu četl, že mu nechybí žádné
 * pokolení klíče, přestože se ho nikdo nezeptal.
 *
 * Kód `check_failed` je v registru P01 se závažností `warning`.
 */
export function cannotRun(what: string, reason: string): DoctorFinding {
  return {
    id: 'check_failed',
    severity: 'warning',
    title: `Kontrolu „${what}" nešlo provést`,
    detail: `${reason} Výsledek téhle kontroly proto NENÍ „v pořádku", ale „nezjištěno".`,
    action:
      'Nastavte DATABASE_URL_MIGRATOR a spusťte mlain doctor znovu. Bez migrátora se ' +
      'data napříč projekty přečíst nedají, protože na aplikační roli platí row level security.',
  };
}

export const SEVERITY_ORDER: Record<DoctorSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};
```

- [ ] **Krok 4: Implementuj formátování**

```ts
// packages/core/src/ops/doctor/format.ts
import { SEVERITY_ORDER, type DoctorFinding, type DoctorSeverity } from './types.js';

const LABEL: Record<DoctorSeverity, string> = {
  critical: 'KRITICKÉ',
  warning: 'VAROVÁNÍ',
  info: 'informace',
};

export function sortFindings(findings: readonly DoctorFinding[]): DoctorFinding[] {
  return [...findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.id.localeCompare(b.id),
  );
}

export function summarize(findings: readonly DoctorFinding[]): Record<DoctorSeverity, number> {
  return {
    critical: findings.filter((f) => f.severity === 'critical').length,
    warning: findings.filter((f) => f.severity === 'warning').length,
    info: findings.filter((f) => f.severity === 'info').length,
  };
}

/**
 * Kritický nález je nenulový návratový kód vždy. Varování jen s --strict,
 * protože jinak si provozovatel zvykne nenulový kód ignorovat a přestane
 * si všímat i těch kritických.
 */
export function exitCodeFor(
  findings: readonly DoctorFinding[],
  options: { strict: boolean },
): number {
  const s = summarize(findings);
  if (s.critical > 0) return 2;
  if (s.warning > 0 && options.strict) return 1;
  return 0;
}

export function formatReport(findings: readonly DoctorFinding[]): string {
  if (findings.length === 0) {
    return 'Instalace je v pořádku, žádný nález.\n';
  }
  const lines: string[] = [];
  for (const f of sortFindings(findings)) {
    lines.push(`[${LABEL[f.severity]}] ${f.title}  (${f.id})`);
    if (f.detail) lines.push(`    ${f.detail}`);
    if (f.action) lines.push(`    Co s tím: ${f.action}`);
    lines.push('');
  }
  const s = summarize(findings);
  lines.push(`Souhrn: ${s.critical} kritických, ${s.warning} varování, ${s.info} informací.`);
  return `${lines.join('\n')}\n`;
}

export function formatJson(findings: readonly DoctorFinding[]): string {
  return `${JSON.stringify(
    { summary: summarize(findings), findings: sortFindings(findings) },
    null,
    2,
  )}\n`;
}
```

- [ ] **Krok 5: Spusť a commitni**

Spusť: `pnpm vitest run packages/core/test/ops/doctor-format.test.ts`
Očekávej: PASS, 8 testů.

```bash
git add packages/core/src/ops/doctor/types.ts packages/core/src/ops/doctor/format.ts packages/core/test/ops/doctor-format.test.ts
git commit -m "feat(ops): add doctor finding model, ordering and exit codes"
```

---

### Úkol 12: Kontroly keyringu, jádro celého plánu

**Soubory:**
- Vytvoř: `packages/core/src/ops/doctor/checks-keyring.ts`
- Test: `packages/core/test/ops/doctor-keyring.db.test.ts`

**Proč je tenhle úkol kritický.** Otisky smazaných adres se počítají pod všemi známými pokoleními klíče a **nejdou přepočítat**, protože původní adresa je po výmazu podle GDPR nenávratně pryč. Když instalace přijde o staré pokolení, suppression list zůstane, ale nejstarší otisky se přestanou shodovat. Smazaný člověk se vrátí prvním dalším importem, import proběhne úspěšně a **nezaloguje se nic**. Je to nejtišší možná porucha, jakou tenhle produkt má: žádná chyba, žádný záznam, jen zmizelá ochrana. Proto to `mlain doctor` hlásí jako kritickou chybu, ne jako doporučení.

- [ ] **Krok 1: Napiš padající test**

```ts
// packages/core/test/ops/doctor-keyring.db.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestPostgres } from '../support/db.js';
import { keyringChecks } from '../../src/ops/doctor/checks-keyring.js';
import type { DoctorContext } from '../../src/ops/doctor/types.js';

const KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
let pg: TestPostgres;

const ctx = (over: Partial<DoctorContext> = {}): DoctorContext => ({
  // Pozor na obě URL. `appUrl` je aplikační role, `adminUrl` migrátor.
  // Kdyby kontroly četly data z appUrl, vracely by nula řádků a celý tenhle
  // soubor by svítil zeleně nad instalací, které chybí klíč. Test
  // „pod aplikační rolí nemlčí" níž na to je.
  appUrl: pg.urlForRole('mlain_app'),
  adminUrl: pg.ownerUrl,
  dataDir: '/data',
  backupDir: '/data/backups',
  uploadsDir: '/data/uploads',
  secretKey: KEY,
  secretKeyPrevious: '',
  imageVersion: '1.0.0',
  now: new Date('2026-07-31T12:00:00.000Z'),
  ...over,
});

const runAll = async (c: DoctorContext) =>
  (await Promise.all(keyringChecks.map((check) => check(c)))).flat();

beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.seedMinimalInstallation({ contacts: 3 });
}, 180_000);

beforeEach(async () => {
  await pg.sql('DELETE FROM suppressions');
  await pg.sql('DELETE FROM gdpr_requests');
  await pg.sql(`UPDATE system_settings SET secret_key_fingerprint = 'VXGoNjoPSBY'`);
});

afterAll(async () => {
  await pg?.stop();
});

const addSuppression = (keyId: number) =>
  pg.sql(
    `INSERT INTO suppressions (workspace_id, email, reason, source, fingerprint, fingerprint_key_id)
     SELECT id, 'x${keyId}@example.com', 'hard_bounce', 'ses_event',
            decode(repeat('ab', 16), 'hex'), ${keyId}
       FROM workspaces LIMIT 1`,
  );

/** Druhý zdroj pokolení v datech. Otisk subjektu u žádosti podle GDPR. */
const addGdprRequest = (keyId: number) =>
  pg.sql(
    `INSERT INTO gdpr_requests (workspace_id, subject_email_fingerprint,
                                subject_email_fingerprint_key_id, type, status, channel)
     SELECT id, decode(repeat('cd', 16), 'hex'), ${keyId}, 'erasure', 'completed', 'admin'
       FROM workspaces LIMIT 1`,
  );

describe('kontrola chybějících pokolení klíče', () => {
  it('u prázdného suppression listu nic nehlásí', async () => {
    const findings = await runAll(ctx());
    expect(findings.filter((f) => f.severity === 'critical')).toEqual([]);
  });

  it('chybějící staré pokolení hlásí jako KRITICKÉ, ne jako doporučení', async () => {
    await addSuppression(1);
    await addSuppression(2);
    const findings = await runAll(ctx({ secretKey: `3:${KEY}`, secretKeyPrevious: `2:${KEY}` }));
    const f = findings.find((x) => x.id === 'missing_key_generations');
    expect(f).toBeDefined();
    expect(f!.severity).toBe('critical');
    expect(f!.title).toContain('1');
  });

  it('nehlásí nic, když instalace zná všechna pokolení z dat', async () => {
    await addSuppression(1);
    await addSuppression(2);
    const findings = await runAll(ctx({ secretKey: `2:${KEY}`, secretKeyPrevious: `1:${KEY}` }));
    expect(findings.find((x) => x.id === 'missing_key_generations')).toBeUndefined();
  });

  it('prázdné SECRET_KEY_PREVIOUS při neprázdném suppression listu je KRITICKÉ', async () => {
    await addSuppression(1);
    const findings = await runAll(ctx({ secretKey: `2:${KEY}`, secretKeyPrevious: '' }));
    const f = findings.find((x) => x.id === 'secret_key_previous_empty');
    expect(f?.severity).toBe('critical');
  });

  it('neshodu otisku proti system_settings hlásí jako KRITICKÉ', async () => {
    await pg.sql(`UPDATE system_settings SET secret_key_fingerprint = 'jinyOtisk1'`);
    const findings = await runAll(ctx());
    const f = findings.find((x) => x.id === 'secret_key_fingerprint_mismatch');
    expect(f?.severity).toBe('critical');
    expect(f?.action).toContain('SECRET_KEY');
  });

  it('blížící se strop pokolení hlásí jako varování od hodnoty 200', async () => {
    const previous = Array.from({ length: 5 }, (_, i) => `${195 + i}:${KEY}`).join(',');
    const findings = await runAll(ctx({ secretKey: `200:${KEY}`, secretKeyPrevious: previous }));
    expect(findings.find((x) => x.id === 'key_id_ceiling_near')?.severity).toBe('warning');
  });

  it('hláška o chybějícím pokolení říká, že otisky nejdou přepočítat', async () => {
    await addSuppression(1);
    const findings = await runAll(ctx({ secretKey: `2:${KEY}`, secretKeyPrevious: '' }));
    const text = findings.map((f) => `${f.detail} ${f.action}`).join(' ');
    expect(text).toMatch(/nejdou přepočítat|nelze přepočítat/i);
  });

  it('najde pokolení, které je JEN v gdpr_requests', async () => {
    // Druhý a poslední zdroj pokolení v datech. Instalace, která ztratila klíč
    // použitý výhradně u výmazů podle GDPR, by jinak prošla jako zdravá,
    // přestože nedokáže ověřit ani jeden vymazaný subjekt.
    await addGdprRequest(4);
    const findings = await runAll(ctx({ secretKey: `5:${KEY}`, secretKeyPrevious: '' }));
    const f = findings.find((x) => x.id === 'missing_key_generations');
    expect(f?.severity).toBe('critical');
    expect(f!.title).toContain('4');
  });
});

describe('kontrola se nesmí tvářit, že je vše v pořádku, když se nezeptala', () => {
  // Tenhle blok je obrana proti nejtišší vadě celého plánu. Obě situace
  // vypadají ve výstupu úplně stejně jako zdravá instalace.

  it('pod aplikační rolí NEMLČÍ, i když by dotaz vrátil nula řádků', async () => {
    // Ověřeno spuštěním: pod mlain_app bez kontextu projektu vrací
    // SELECT nad suppressions nula řádků, exit 0 a žádnou chybu.
    // Kdyby kontrola tuhle roli přijala, ohlásila by „žádné chybějící
    // pokolení" u instalace, které chybí klíč.
    await addSuppression(1);
    const findings = await runAll(
      ctx({ adminUrl: pg.urlForRole('mlain_app'), secretKey: `2:${KEY}`, secretKeyPrevious: '' }),
    );
    expect(findings.find((x) => x.id === 'check_failed')).toBeDefined();
    expect(findings.find((x) => x.id === 'missing_key_generations')).toBeUndefined();
  });

  it('bez DATABASE_URL_MIGRATOR vrátí check_failed, ne prázdný seznam', async () => {
    const findings = await runAll(ctx({ adminUrl: null }));
    const f = findings.find((x) => x.id === 'check_failed');
    expect(f?.severity).toBe('warning');
    expect(f?.detail).toContain('nezjištěno');
  });
});
```

- [ ] **Krok 2: Spusť a ověř pád**

Spusť: `pnpm vitest run packages/core/test/ops/doctor-keyring.db.test.ts`
Očekávej: FAIL, `Cannot find module '../../src/ops/doctor/checks-keyring.js'`.

- [ ] **Krok 3: Implementuj**

```ts
// packages/core/src/ops/doctor/checks-keyring.ts
import { sql } from 'drizzle-orm';
import { withAdminTx } from '../db.js';
import { knownKeyIds, loadOpsKeyring, missingGenerations } from '../keyring.js';
import { cannotRun, type DoctorCheck, type DoctorContext, type DoctorFinding } from './types.js';

const CANNOT_RECOMPUTE =
  'Otisky smazaných adres nejdou přepočítat, protože původní adresa je po výmazu podle GDPR pryč. ' +
  'Bez starého klíče se otisk přestane shodovat, smazaný člověk se vrátí prvním dalším importem, ' +
  'import proběhne úspěšně a nezaloguje se nic.';

/**
 * Pokolení, která jsou opravdu v datech.
 *
 * Zdroje jsou ve schématu **právě dva** a oba tu musí být:
 *   - `suppressions.fingerprint_key_id` (NOT NULL, má vlastní index),
 *   - `gdpr_requests.subject_email_fingerprint_key_id` (nullable, bez indexu).
 *
 * Druhý se snadno vynechá, protože je vzácnější. Instalace, která ztratila
 * klíč použitý výhradně u výmazů podle GDPR, by pak prošla jako zdravá.
 * `gdpr_requests` je malá tabulka, takže sekvenční průchod jednou za běh
 * diagnostiky je v pořádku a index se po P03 nechce.
 *
 * Šifrové obálky (`config_encrypted` a spol.) tu SCHVÁLNĚ nejsou. Jejich
 * pokolení se dá přešifrovat, tedy vada je opravitelná, a hlídá si je
 * `mlain rotate-credentials` sám. Tady jde jen o to, co přepočítat NELZE.
 */
async function generationsInData(adminUrl: string): Promise<number[]> {
  return withAdminTx(adminUrl, async (tx) => {
    const { rows } = await tx.execute<{ key_id: number }>(
      sql`SELECT DISTINCT fingerprint_key_id AS key_id
            FROM suppressions
           WHERE fingerprint_key_id IS NOT NULL
           UNION
          SELECT DISTINCT subject_email_fingerprint_key_id AS key_id
            FROM gdpr_requests
           WHERE subject_email_fingerprint_key_id IS NOT NULL`);
    return rows.map((r) => r.key_id);
  });
}

async function countErasureFingerprints(adminUrl: string): Promise<number> {
  return withAdminTx(adminUrl, async (tx) => {
    const { rows } = await tx.execute<{ n: number }>(
      sql`SELECT (SELECT count(*) FROM suppressions)
                 + (SELECT count(*) FROM gdpr_requests
                     WHERE subject_email_fingerprint_key_id IS NOT NULL) AS n`);
    return Number(rows[0].n);
  });
}

/**
 * Společná brána všech kontrol, které sahají do dat.
 *
 * Bez migrátora se data napříč projekty přečíst nedají a výsledek by byl
 * prázdný, ne správný. `withAdminTx` sice roli ověřuje taky, ale hodí výjimku;
 * diagnostika nesmí spadnout kvůli jedné kontrole, takže ji tady převádíme
 * na nález `check_failed`.
 */
async function withData<T>(
  ctx: DoctorContext,
  what: string,
  fn: (adminUrl: string) => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; finding: DoctorFinding }> {
  if (ctx.adminUrl === null) {
    return { ok: false, finding: cannotRun(what, 'Chybí DATABASE_URL_MIGRATOR.') };
  }
  try {
    return { ok: true, value: await fn(ctx.adminUrl) };
  } catch (error) {
    return {
      ok: false,
      finding: cannotRun(what, `Dotaz do databáze selhal: ${(error as Error).message}.`),
    };
  }
}

const checkMissingGenerations: DoctorCheck = async (ctx) => {
  const keyring = loadOpsKeyring({
    secretKey: ctx.secretKey,
    secretKeyPrevious: ctx.secretKeyPrevious,
  });
  const data = await withData(ctx, 'chybějící pokolení klíče', generationsInData);
  if (!data.ok) return [data.finding];

  const missing = missingGenerations(keyring, data.value);
  if (missing.length === 0) return [];
  return [
    {
      id: 'missing_key_generations',
      severity: 'critical',
      title: `Instalace nezná pokolení klíče ${missing.join(', ')}`,
      detail:
        `V suppression listu a v žádostech podle GDPR jsou otisky zapsané pod pokoleními ` +
        `${missing.join(', ')}, ale instalace zná jen ${knownKeyIds(keyring).join(', ')}. ` +
        CANNOT_RECOMPUTE,
      action:
        'Doplňte chybějící klíče do SECRET_KEY_PREVIOUS ve tvaru <key_id>:<klíč>, oddělené čárkou, ' +
        'a restartujte všechny procesy. Klíče najdete v recovery bundle, který musí nést celý keyring.',
    },
  ];
};

const checkPreviousNotEmptied: DoctorCheck = async (ctx) => {
  const keyring = loadOpsKeyring({
    secretKey: ctx.secretKey,
    secretKeyPrevious: ctx.secretKeyPrevious,
  });
  if (keyring.currentKeyId === 1 || ctx.secretKeyPrevious.trim() !== '') return [];
  const data = await withData(ctx, 'prázdné SECRET_KEY_PREVIOUS', countErasureFingerprints);
  if (!data.ok) return [data.finding];
  if (data.value === 0) return [];
  return [
    {
      id: 'secret_key_previous_empty',
      severity: 'critical',
      title: 'SECRET_KEY_PREVIOUS je prázdné, přestože suppression list není',
      detail:
        `Aktuální pokolení je ${keyring.currentKeyId}, takže rotace už proběhla, ale žádné starší pokolení ` +
        `není k dispozici. ${CANNOT_RECOMPUTE} Totéž platí pro trackovací tokeny ve starých e-mailech, ` +
        'které navíc z databáze vůbec nejdou vyjmenovat, protože leží v cizích schránkách.',
      action:
        'SECRET_KEY_PREVIOUS se nikdy nevyprazdňuje, ani po mlain rotate-credentials. ' +
        'Vraťte do něj všechna předchozí pokolení.',
    },
  ];
};

const checkFingerprintMatches: DoctorCheck = async (ctx) => {
  const keyring = loadOpsKeyring({
    secretKey: ctx.secretKey,
    secretKeyPrevious: ctx.secretKeyPrevious,
  });
  // system_settings je na whitelistu tabulek BEZ RLS, takže by tenhle dotaz
  // prošel i pod aplikační rolí. Jde přesto přes migrátora, aby diagnostika
  // měla jedinou cestu k datům a nevznikla druhá, u které si za rok nikdo
  // nevzpomene, proč je jiná.
  const data = await withData(ctx, 'otisk SECRET_KEY', (adminUrl) =>
    withAdminTx(adminUrl, async (tx) => {
      const { rows } = await tx.execute<{ secret_key_fingerprint: string }>(
        sql`SELECT secret_key_fingerprint FROM system_settings WHERE id = true`);
      return rows[0]?.secret_key_fingerprint ?? '';
    }));
  if (!data.ok) return [data.finding];
  const stored = data.value;
  const known = [...keyring.fingerprints.values()];
  if (stored === '' || known.includes(stored)) return [];
  return [
    {
      id: 'secret_key_fingerprint_mismatch',
      severity: 'critical',
      title: 'Otisk SECRET_KEY nesedí s otiskem uloženým v instalaci',
      detail:
        `V system_settings je otisk ${stored}, ale instalace zná jen ${known.join(', ')}. ` +
        'Uložené přístupy k odesílání, AI klíče a tajemství webhooků nepůjde dešifrovat.',
      action:
        'Vraťte původní SECRET_KEY, nebo ho doplňte do SECRET_KEY_PREVIOUS. Když je klíč nenávratně ztracený, ' +
        'zadejte znovu přístupy k providerům a AI klíče; jiná oprava neexistuje.',
    },
  ];
};

const checkKeyIdCeiling: DoctorCheck = async (ctx) => {
  const keyring = loadOpsKeyring({
    secretKey: ctx.secretKey,
    secretKeyPrevious: ctx.secretKeyPrevious,
  });
  if (keyring.currentKeyId < 200) return [];
  return [
    {
      id: 'key_id_ceiling_near',
      severity: 'warning',
      title: `Pokolení klíče je ${keyring.currentKeyId}, strop formátu je 255`,
      detail:
        'Jednobajtové key_id v tokenech i v šifrové obálce má strop 255. Vyčerpání řeší budoucí verze ' +
        'formátu (prefix t2 u tokenů a version 0x02 u obálky), ne validace.',
      action: 'Naplánujte přechod na druhou verzi formátu dřív, než pokolení dosáhne 255.',
    },
  ];
};

export const keyringChecks: readonly DoctorCheck[] = [
  checkMissingGenerations,
  checkPreviousNotEmptied,
  checkFingerprintMatches,
  checkKeyIdCeiling,
];

export type { DoctorFinding };
```

- [ ] **Krok 4: Spusť a ověř průchod**

Spusť: `pnpm vitest run packages/core/test/ops/doctor-keyring.db.test.ts`
Očekávej: PASS, 10 testů.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/ops/doctor/checks-keyring.ts packages/core/test/ops/doctor-keyring.db.test.ts
git commit -m "feat(ops): report missing key generations as a critical doctor finding"
```

---

### Úkol 13: Kontroly úložiště, běhu a projektů

**Soubory:**
- Vytvoř: `packages/core/src/ops/doctor/checks-storage.ts`, `checks-runtime.ts`, `checks-workspace.ts`
- Test: `packages/core/test/ops/doctor-storage.test.ts`, `packages/core/test/ops/doctor-runtime.db.test.ts`

- [ ] **Krok 1: Napiš padající testy úložiště**

```ts
// packages/core/test/ops/doctor-storage.test.ts
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { checkBackupFreshness, checkDataVolume } from '../../src/ops/doctor/checks-storage.js';

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'mlain-doctor-'));
  await mkdir(join(root, 'plny'), { recursive: true });
  await writeFile(join(root, 'plny', 'neco.txt'), 'x');
  await mkdir(join(root, 'prazdny'), { recursive: true });
  await mkdir(join(root, 'zalohy', 'mlain-20260701T030000Z'), { recursive: true });
});

describe('checkDataVolume', () => {
  it('prázdný datový svazek u běžící instalace hlásí jako kritický', async () => {
    const f = await checkDataVolume(join(root, 'prazdny'), true);
    expect(f?.severity).toBe('critical');
    expect(f?.detail).toMatch(/postgres/i);
  });

  it('u prázdné instalace prázdný svazek nevadí', async () => {
    expect(await checkDataVolume(join(root, 'prazdny'), false)).toBeNull();
  });

  it('neprázdný svazek nehlásí nic', async () => {
    expect(await checkDataVolume(join(root, 'plny'), true)).toBeNull();
  });

  it('neexistující svazek hlásí jako kritický', async () => {
    const f = await checkDataVolume(join(root, 'neexistuje'), true);
    expect(f?.severity).toBe('critical');
  });
});

describe('checkBackupFreshness', () => {
  const now = new Date('2026-07-31T12:00:00.000Z');

  it('žádná záloha u instalace s daty je varování', async () => {
    const f = await checkBackupFreshness(join(root, 'prazdny'), now, true);
    expect(f?.severity).toBe('warning');
    expect(f?.id).toBe('no_backup_yet');
  });

  it('záloha starší než 7 dní je varování', async () => {
    const f = await checkBackupFreshness(join(root, 'zalohy'), now, true);
    expect(f?.id).toBe('backup_stale');
    expect(f?.title).toContain('30');
  });

  it('čerstvá záloha nehlásí nic', async () => {
    const f = await checkBackupFreshness(
      join(root, 'zalohy'),
      new Date('2026-07-02T03:00:00.000Z'),
      true,
    );
    expect(f).toBeNull();
  });
});
```

- [ ] **Krok 2: Spusť a ověř pád**

Spusť: `pnpm vitest run packages/core/test/ops/doctor-storage.test.ts`
Očekávej: FAIL, modul neexistuje.

- [ ] **Krok 3: Implementuj kontroly úložiště**

```ts
// packages/core/src/ops/doctor/checks-storage.ts
import { readdir } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import { listBackups } from '../backup.js';
import { withAdminTx } from '../db.js';
import { binaryMajorVersion } from '../run-process.js';
import { cannotRun, type DoctorCheck, type DoctorFinding } from './types.js';

const REQUIRED_BINARIES = ['pg_dump', 'pg_restore', 'createdb', 'dropdb'] as const;
const REQUIRED_MAJOR = 18;
const BACKUP_STALE_DAYS = 7;

/**
 * Záměna `/var/lib/postgresql` a `/var/lib/postgresql/data` u image řady 18
 * znamená, že data leží uvnitř kontejneru a po `docker compose down` zmizí.
 * Pozná se to tak, že svazek na hostiteli zůstane prázdný, přestože databáze
 * běží a má data. Bez téhle kontroly se na to přijde až prvním restartem.
 */
export async function checkDataVolume(
  dataDir: string,
  installationHasData: boolean,
): Promise<DoctorFinding | null> {
  if (!installationHasData) return null;
  const entries = await readdir(dataDir).catch(() => null);
  if (entries !== null && entries.length > 0) return null;
  return {
    id: 'data_volume_empty',
    severity: 'critical',
    title: `Datový svazek ${dataDir} je prázdný, přestože instalace má data`,
    detail:
      'Typická příčina je záměna cesty svazku u image postgres řady 18: data se zapisují dovnitř ' +
      'kontejneru místo na hostitele. Po docker compose down zmizí všechno.',
    action:
      'Zkontrolujte mapování svazku v compose souboru podle kapitoly 3.12 části 1 a hned potom ' +
      'spusťte mlain backup.',
  };
}

export async function checkBackupFreshness(
  backupDir: string,
  now: Date,
  installationHasData: boolean,
): Promise<DoctorFinding | null> {
  if (!installationHasData) return null;
  const entries = await listBackups(backupDir);
  if (entries.length === 0) {
    return {
      id: 'no_backup_yet',
      severity: 'warning',
      title: 'Instalace má data, ale žádnou zálohu',
      detail: `V adresáři ${backupDir} není jediná záloha ve tvaru mlain-<čas>Z.`,
      action: 'Spusťte mlain backup a nechte zapnutou plánovanou zálohu přes BACKUP_SCHEDULE_CRON.',
    };
  }
  const ageDays = Math.floor((now.getTime() - entries[0].createdAt.getTime()) / 86_400_000);
  if (ageDays < BACKUP_STALE_DAYS) return null;
  return {
    id: 'backup_stale',
    severity: 'warning',
    title: `Poslední záloha je stará ${ageDays} dní`,
    detail: `Nejnovější je ${entries[0].name}.`,
    action: 'Spusťte mlain backup a ověřte, že plánovaná záloha běží.',
  };
}

const checkBinaries: DoctorCheck = async () => {
  const findings: DoctorFinding[] = [];
  for (const bin of REQUIRED_BINARIES) {
    const major = await binaryMajorVersion(bin);
    if (major === null) {
      findings.push({
        id: 'backup_binary_missing',
        severity: 'critical',
        title: `Binárka ${bin} není dostupná`,
        detail: 'Bez ní nejde vytvořit ani ověřit zálohu, takže instalace nemá jak zálohovat.',
        action: 'Doplňte do image balík postgresql18-client.',
      });
    } else if (major !== REQUIRED_MAJOR) {
      findings.push({
        id: 'backup_binary_version_mismatch',
        severity: 'critical',
        title: `Binárka ${bin} je major verze ${major}, čeká se ${REQUIRED_MAJOR}`,
        detail: 'Starší pg_dump neumí přečíst novější databázi a záloha skončí chybou.',
        action: `Doplňte do image postgresql${REQUIRED_MAJOR}-client.`,
      });
    }
  }
  return findings;
};

const checkStorage: DoctorCheck = async (ctx) => {
  // `workspaces` má RLS (politika ws_isolation_self přes id), takže pod
  // aplikační rolí bez kontextu vrátí nula a diagnostika by usoudila, že je
  // instalace prázdná. Prázdná instalace přitom potlačuje nález o chybějící
  // záloze, takže by tichá chyba schovala hlasitou.
  if (ctx.adminUrl === null) {
    return [cannotRun('stav úložiště', 'Chybí DATABASE_URL_MIGRATOR.')];
  }
  const hasData = await withAdminTx(ctx.adminUrl, async (tx) => {
    const { rows } = await tx.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM workspaces WHERE deleted_at IS NULL`);
    return rows[0].n > 0;
  });
  const findings = await Promise.all([
    checkDataVolume(ctx.dataDir, hasData),
    checkBackupFreshness(ctx.backupDir, ctx.now, hasData),
  ]);
  return findings.filter((f): f is DoctorFinding => f !== null);
};

export const storageChecks: readonly DoctorCheck[] = [checkBinaries, checkStorage];
```

- [ ] **Krok 4: Napiš padající testy běhu a projektů**

```ts
// packages/core/test/ops/doctor-runtime.db.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestPostgres } from '../support/db.js';
import { runtimeChecks } from '../../src/ops/doctor/checks-runtime.js';
import { workspaceChecks } from '../../src/ops/doctor/checks-workspace.js';
import type { DoctorContext } from '../../src/ops/doctor/types.js';

const KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
let pg: TestPostgres;

const ctx = (over: Partial<DoctorContext> = {}): DoctorContext => ({
  appUrl: pg.urlForRole('mlain_app'),
  adminUrl: pg.ownerUrl,
  dataDir: '/tmp',
  backupDir: '/tmp',
  uploadsDir: '/tmp',
  secretKey: KEY,
  secretKeyPrevious: '',
  imageVersion: '1.0.0',
  now: new Date('2026-07-31T12:00:00.000Z'),
  ...over,
});

const run = async (
  checks: readonly ((c: DoctorContext) => Promise<unknown[]>)[],
  context: DoctorContext = ctx(),
) =>
  (await Promise.all(checks.map((c) => c(context)))).flat() as
    { id: string; severity: string; detail: string }[];

beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.seedMinimalInstallation({ contacts: 2 });
}, 180_000);

beforeEach(async () => {
  await pg.sql(`UPDATE workspaces SET settings = '{}'::jsonb`);
});

afterAll(async () => {
  await pg?.stop();
});

describe('runtimeChecks', () => {
  it('schema_version vyšší, než image zná, je kritické', async () => {
    await pg.sql('UPDATE system_settings SET schema_version = 999999');
    const findings = await run(runtimeChecks);
    const f = findings.find((x) => x.id === 'schema_version_ahead');
    expect(f?.severity).toBe('critical');
    await pg.sql('UPDATE system_settings SET schema_version = 1');
  });

  it('shodná verze schématu nic nehlásí', async () => {
    const findings = await run(runtimeChecks);
    expect(findings.find((x) => x.id === 'schema_version_ahead')).toBeUndefined();
  });

  it('součet poolů nad max_connections je varování', async () => {
    await pg.sql('ALTER SYSTEM SET max_connections = 20');
    const findings = await run(runtimeChecks);
    expect(findings.find((x) => x.id === 'connection_pool_over_budget')).toBeDefined();
    await pg.sql('ALTER SYSTEM RESET max_connections');
  });

  it('pod mlain_app nehlásí, že by izolace neplatila', async () => {
    // mlain_app schéma nevlastní a nemá BYPASSRLS, takže je všechno v pořádku.
    const findings = await run(runtimeChecks);
    expect(findings.find((x) => x.id === 'isolation_prerequisites_missing')).toBeUndefined();
  });

  it('pod migrátorem hlásí, že projekty NEJSOU izolované', async () => {
    // Migrátor vlastní schéma, takže se na něj RLS neuplatní. Kdyby někdo
    // nastavil DATABASE_URL na migrátora (u managed databáze s jedinou rolí
    // je to nejsnazší cesta k rozchození), aplikace by se rozeběhla úplně
    // normálně a projekty by přestaly být oddělené, aniž by cokoli selhalo.
    const findings = await run(runtimeChecks, ctx({ appUrl: pg.ownerUrl }));
    const f = findings.find((x) => x.id === 'isolation_prerequisites_missing');
    expect(f?.severity).toBe('critical');
    expect(f?.detail).toContain('vlastní schéma');
  });
});

describe('workspaceChecks', () => {
  it('zapnutý zkušební režim hlásí jako informaci', async () => {
    await pg.sql(`UPDATE workspaces SET settings = '{"trialMode":{"enabled":true}}'::jsonb`);
    const findings = await run(workspaceChecks);
    const f = findings.find((x) => x.id === 'trial_mode_enabled');
    expect(f?.severity).toBe('info');
  });

  it('přítomnost ukázkových dat hlásí jako informaci', async () => {
    await pg.sql(
      `UPDATE workspaces SET settings = '{"demoData":{"version":1,"contactIds":["a"]}}'::jsonb`,
    );
    const findings = await run(workspaceChecks);
    expect(findings.find((x) => x.id === 'demo_data_present')?.severity).toBe('info');
  });

  it('čistý projekt nehlásí nic', async () => {
    expect(await run(workspaceChecks)).toEqual([]);
  });

  it('nehlásí čistý projekt, když jen nemá jak se zeptat', async () => {
    // Bez migrátora vrací loadWorkspaces prázdno, což vypadá stejně jako
    // „žádný projekt nemá ukázková data". Rozdíl musí být ve výstupu vidět.
    const findings = await run(workspaceChecks, ctx({ adminUrl: null }));
    expect(findings.find((x) => x.id === 'check_failed')).toBeDefined();
  });
});
```

- [ ] **Krok 5: Implementuj kontroly běhu a projektů**

```ts
// packages/core/src/ops/doctor/checks-runtime.ts
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { sql } from 'drizzle-orm';
import { checkIsolationPrerequisites, createPool } from '@mlain/db';
import { withAdminTx } from '../db.js';
import { cannotRun, type DoctorCheck } from './types.js';

/** Výchozí hodnoty poolů z kapitoly 7 části 1: web 10, worker 10, sender 8. */
const POOL_BUDGET = { web: 10, worker: 10, sender: 8 } as const;

/**
 * Nejvyšší číslo migrace, které tahle image zná.
 *
 * Čte se ze **stejného zdroje pravdy**, ze kterého ho počítá migrační runner
 * v P03 (`entries.length`) i readiness v P01 (`EXPECTED_SCHEMA_VERSION`), tedy
 * z `packages/db/migrations/meta/_journal.json`.
 *
 * Proč ne funkce z P03: `maxKnownSchemaVersion()` v P03 **neexistuje**,
 * runner si `entries.length` počítá lokálně a nevyváží ho. Dopsat ji do
 * `packages/db` P16 nesmí, protože ten balíček vlastní P03. Čtvrtý nezávislý
 * výpočet téhož čísla by se rozešel, takže se čte týž soubor.
 *
 * Cesta se odvozuje od resolvovaného balíčku `@mlain/db`, ne relativně od
 * tohohle souboru: `packages/core` se překládá do `dist/`, takže relativní
 * hloubka se mezi vývojovým stromem a image liší. Hledá se nahoru, dokud
 * se nenajde `migrations/meta/_journal.json`.
 *
 * Když journal chybí (build bez migrací), vrací 0 a kontrola se přeskočí,
 * shodně s rozhodnutím D3 plánu P01.
 */
export async function knownSchemaVersion(): Promise<number> {
  try {
    const require = createRequire(import.meta.url);
    let dir = dirname(require.resolve('@mlain/db'));
    for (let up = 0; up < 5; up += 1) {
      const journal = join(dir, 'migrations', 'meta', '_journal.json');
      try {
        const parsed = JSON.parse(await readFile(journal, 'utf8')) as { entries?: unknown[] };
        return Array.isArray(parsed.entries) ? parsed.entries.length : 0;
      } catch {
        dir = dirname(dir);
      }
    }
    return 0;
  } catch {
    return 0;
  }
}

const checkSchemaVersion: DoctorCheck = async (ctx) => {
  if (ctx.adminUrl === null) return [cannotRun('verze schématu', 'Chybí DATABASE_URL_MIGRATOR.')];
  const current = await withAdminTx(ctx.adminUrl, async (tx) => {
    const { rows } = await tx.execute<{ schema_version: number }>(
      sql`SELECT schema_version FROM system_settings WHERE id = true`);
    return rows[0].schema_version;
  });
  const known = await knownSchemaVersion();
  // Nula znamená build bez migrací, tam se nekontroluje nic (shodně s P01).
  if (known === 0 || current <= known) return [];
  return [
    {
      id: 'schema_version_ahead',
      severity: 'critical',
      title: `Databáze je na schématu ${current}, tahle image zná nejvýš ${known}`,
      detail:
        'Starší aplikace by zapisovala do novějšího schématu a tiše ho poškodila, proto start ' +
        'končí kódem 5 s hláškou schema_version_ahead.',
      action: 'Nasaďte image, která odpovídá databázi, nebo obnovte zálohu pořízenou před upgradem.',
    },
  ];
};

const checkConnectionBudget: DoctorCheck = async (ctx) => {
  // Jediná kontrola, která SMÍ jet pod aplikační rolí, protože `max_connections`
  // je parametr serveru, ne data, a RLS se na něj nevztahuje.
  const pool = createPool(ctx.appUrl, 'app', 1);
  try {
    const { rows } = await pool.query<{ max_connections: string }>(
      "SELECT current_setting('max_connections') AS max_connections");
    const max = Number(rows[0].max_connections);
    const sum = POOL_BUDGET.web + POOL_BUDGET.worker + POOL_BUDGET.sender;
    if (sum < max) return [];
    return [
      {
        id: 'connection_pool_over_budget',
        severity: 'warning',
        title: `Součet poolů ${sum} se nevejde do max_connections ${max}`,
        detail:
          `Při MODE=all běží tři procesy proti jedné databázi: web ${POOL_BUDGET.web}, ` +
          `worker ${POOL_BUDGET.worker}, sender ${POOL_BUDGET.sender}.`,
        action: 'Zvyšte max_connections Postgresu, nebo snižte DATABASE_POOL_MAX.',
      },
    ];
  } finally {
    await pool.end();
  }
};

/**
 * Ověří, že se na APLIKAČNÍ roli row level security skutečně vztahuje.
 *
 * Celý model izolace projektů mlčky předpokládá, že `mlain_app` nevlastní
 * schéma a nemá BYPASSRLS. U samohostitele s managed PostgreSQL, kde je
 * k dispozici jediná role (typicky vlastník databáze), ten předpoklad
 * neplatí a **aplikace se rozeběhne úplně normálně, jen bez izolace**.
 * Nic nespadne a zákazník se to nedozví.
 *
 * Predikát vlastní P03 a exportuje ho jako `checkIsolationPrerequisites`;
 * P16 ho jen volá, aby existoval jeden popis toho, co izolaci ruší.
 * Tahle kontrola jako jediná v celém souboru míří SCHVÁLNĚ na `appUrl`:
 * předmětem kontroly je právě ta role, pod kterou běží aplikace.
 */
const checkIsolation: DoctorCheck = async (ctx) => {
  const pool = createPool(ctx.appUrl, 'app', 1);
  try {
    const reasons = await checkIsolationPrerequisites(pool);
    if (reasons.length === 0) return [];
    return [
      {
        id: 'isolation_prerequisites_missing',
        severity: 'critical',
        title: 'Projekty nejsou izolované, přestože aplikace běží normálně',
        detail:
          `${reasons.join('; ')}. Politiky RLS se na takovou roli neuplatní, takže dotaz ` +
          'jednoho projektu vrátí i data ostatních. Nic přitom neselže a v logu nebude nic.',
        action:
          'Spusťte aplikaci pod rolí mlain_app, která schéma nevlastní a nemá BYPASSRLS. ' +
          'U managed databáze, kde je jediná role, izolace projektů neplatí a víc projektů ' +
          'v jedné instalaci není bezpečné provozovat.',
      },
    ];
  } finally {
    await pool.end();
  }
};

export const runtimeChecks: readonly DoctorCheck[] = [
  checkSchemaVersion,
  checkConnectionBudget,
  checkIsolation,
];
```

```ts
// packages/core/src/ops/doctor/checks-workspace.ts
import { sql } from 'drizzle-orm';
import { withAdminTx } from '../db.js';
import { cannotRun, type DoctorCheck, type DoctorFinding } from './types.js';

type WorkspaceRow = { id: string; name: string; settings: Record<string, unknown> };

/**
 * `workspaces` má politiku `ws_isolation_self` přes `id`, takže pod aplikační
 * rolí bez kontextu vrátí PRÁZDNO. Obě kontroly v tomhle souboru procházejí
 * všechny projekty, což je z definice cesta napříč izolací, a jde tedy jen
 * přes migrátora.
 */
async function loadWorkspaces(adminUrl: string): Promise<WorkspaceRow[]> {
  return withAdminTx(adminUrl, async (tx) => {
    const { rows } = await tx.execute<WorkspaceRow>(
      sql`SELECT id, name, settings FROM workspaces
           WHERE deleted_at IS NULL ORDER BY created_at`);
    return rows;
  });
}

const checkTrialMode: DoctorCheck = async (ctx) => {
  if (ctx.adminUrl === null) return [cannotRun('zkušební režim', 'Chybí DATABASE_URL_MIGRATOR.')];
  const findings: DoctorFinding[] = [];
  for (const ws of await loadWorkspaces(ctx.adminUrl)) {
    const trial = ws.settings.trialMode as { enabled?: boolean } | undefined;
    if (trial?.enabled !== true) continue;
    findings.push({
      id: 'trial_mode_enabled',
      severity: 'info',
      title: `Projekt ${ws.name} běží ve zkušebním režimu`,
      detail:
        'Odesílá se jen na ověřené adresy, nejvýš 10 adres a 50 e-mailů za 24 hodin. Kampaň na větší ' +
        'publikum odejde jen na ověřené adresy, i když to publikum ukazuje jinak.',
      action: 'Až bude doména ověřená, zkušební režim vypněte jedním kliknutím v nastavení odesílání.',
    });
  }
  return findings;
};

const checkDemoData: DoctorCheck = async (ctx) => {
  if (ctx.adminUrl === null) return [cannotRun('ukázková data', 'Chybí DATABASE_URL_MIGRATOR.')];
  const findings: DoctorFinding[] = [];
  for (const ws of await loadWorkspaces(ctx.adminUrl)) {
    const demo = ws.settings.demoData as { contactIds?: string[] } | undefined;
    if (!demo || !Array.isArray(demo.contactIds) || demo.contactIds.length === 0) continue;
    findings.push({
      id: 'demo_data_present',
      severity: 'info',
      title: `V projektu ${ws.name} jsou ukázková data (${demo.contactIds.length} kontaktů)`,
      detail:
        'Adresy jsou na doméně example.com, takže se na ně nedá nic doručit. V tabulce kontaktů je ' +
        'najdete filtrem podle štítku Ukázková data.',
      action: 'Až je nebudete potřebovat, odstraňte je tlačítkem na Přehledu.',
    });
  }
  return findings;
};

export const workspaceChecks: readonly DoctorCheck[] = [checkTrialMode, checkDemoData];
```

- [ ] **Krok 6: Spusť oba testy a commitni**

Spusť: `pnpm vitest run packages/core/test/ops/doctor-storage.test.ts packages/core/test/ops/doctor-runtime.db.test.ts`
Očekávej: PASS, 16 testů.

```bash
git add packages/core/src/ops/doctor/checks-storage.ts packages/core/src/ops/doctor/checks-runtime.ts packages/core/src/ops/doctor/checks-workspace.ts packages/core/test/ops/doctor-storage.test.ts packages/core/test/ops/doctor-runtime.db.test.ts
git commit -m "feat(ops): add storage, runtime and workspace doctor checks"
```

---

### Úkol 14: Příkaz `mlain doctor`

**Soubory:**
- Vytvoř: `packages/core/src/ops/doctor/run.ts`, `apps/cli/src/commands/doctor.ts`
- Modifikuj: `packages/core/src/ops/index.ts`

- [ ] **Krok 1: Doplň test do sady kontrol**

```ts
// packages/core/test/ops/doctor-runtime.db.test.ts (doplněk na konec souboru)
import { runDoctor } from '../../src/ops/doctor/run.js';

describe('runDoctor', () => {
  it('spojí všechny kontroly a nikdy nespadne na jedné selhané', async () => {
    const report = await runDoctor({
      databaseUrl: pg.ownerUrl,
      adminUrl: pg.ownerUrl,
      dataDir: '/cesta/ktera/neexistuje',
      backupDir: '/cesta/ktera/neexistuje',
      uploadsDir: '/tmp',
      secretKey: KEY,
      secretKeyPrevious: '',
      imageVersion: '1.0.0',
      now: new Date(),
    });
    expect(Array.isArray(report.findings)).toBe(true);
  });

  it('selhání jedné kontroly hlásí jako vlastní nález, ne jako pád příkazu', async () => {
    const report = await runDoctor({
      databaseUrl: 'postgres://nikdo:nic@127.0.0.1:1/nic',
      adminUrl: null,
      dataDir: '/tmp',
      backupDir: '/tmp',
      uploadsDir: '/tmp',
      secretKey: KEY,
      secretKeyPrevious: '',
      imageVersion: '1.0.0',
      now: new Date(),
    });
    expect(report.findings.some((f) => f.id === 'check_failed')).toBe(true);
  });
});
```

- [ ] **Krok 2: Spusť a ověř pád**

Spusť: `pnpm vitest run packages/core/test/ops/doctor-runtime.db.test.ts`
Očekávej: FAIL, `Cannot find module '../../src/ops/doctor/run.js'`.

- [ ] **Krok 3: Implementuj složení kontrol**

```ts
// packages/core/src/ops/doctor/run.ts
import { keyringChecks } from './checks-keyring.js';
import { runtimeChecks } from './checks-runtime.js';
import { storageChecks } from './checks-storage.js';
import { workspaceChecks } from './checks-workspace.js';
import { sortFindings } from './format.js';
import type { DoctorContext, DoctorFinding } from './types.js';

const ALL_CHECKS = [...keyringChecks, ...storageChecks, ...runtimeChecks, ...workspaceChecks];

export type DoctorReport = { findings: DoctorFinding[] };

/**
 * Každá kontrola běží zvlášť a její pád je vlastní nález. Kdyby jedna selhaná
 * kontrola shodila celý příkaz, provozovatel by se nedozvěděl nic o zbylých,
 * a mezi nimi jsou ty, které hlásí už nastalou ztrátu ochrany.
 */
export async function runDoctor(ctx: DoctorContext): Promise<DoctorReport> {
  const results = await Promise.all(
    ALL_CHECKS.map(async (check) => {
      try {
        return await check(ctx);
      } catch (err) {
        return [
          {
            id: 'check_failed',
            severity: 'warning' as const,
            title: 'Kontrolu se nepodařilo dokončit',
            detail: err instanceof Error ? err.message : String(err),
            action: 'Ověřte připojení k databázi a přístupová práva a spusťte mlain doctor znovu.',
          },
        ];
      }
    }),
  );
  return { findings: sortFindings(results.flat()) };
}
```

- [ ] **Krok 4: Implementuj příkaz**

**Tvar příkazu se řídí P01, ne vlastním nápadem.** P01 vlastní `apps/cli/src/{main,registry,dispatch,exit-codes}.ts` a jeho hotové příkazy vypadají takhle: soubor v `commands/` exportuje **prostou funkci**, která bere `CliStreams` a prostředí, a `dispatch.ts` ji zavolá ze `switch`. Žádný objekt `CliCommand` s poli `name` a `implemented` v P01 neexistuje; registr příkazů je samostatný uzavřený výčet. Příkazy P16 se proto píšou stejně, jen navíc berou `argv`, protože na rozdíl od tří příkazů P01 mají argumenty.

Zápis na stdout jde přes `streams`, ne přes `process.stdout`. Bez toho by je nešlo testovat jinak než odchytáváním globálního výstupu, což je přesně ten druh testu, který přestane platit při první změně běhového prostředí.

```ts
// apps/cli/src/commands/doctor.ts
import { parseArgs } from 'node:util';
import { loadConfig } from '@mlain/core/config';
import { exitCodeFor, formatJson, formatReport, runDoctor } from '@mlain/core/ops';
import type { CliStreams } from '../dispatch.js';

export async function runDoctorCommand(
  streams: CliStreams,
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      json: { type: 'boolean', default: false },
      strict: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });

  const config = loadConfig(env);
  const report = await runDoctor({
    // appUrl je aplikační role a slouží JEN kontrolám, jejichž předmětem
    // ta role je: rozpočet spojení a předpoklady izolace. Data se z ní
    // nečtou, protože RLS by je bez kontextu projektu vyfiltrovala na nulu.
    appUrl: config.DATABASE_URL,
    adminUrl: config.DATABASE_URL_MIGRATOR ?? null,
    dataDir: config.DATA_DIR,
    backupDir: config.BACKUP_DIR,
    uploadsDir: config.UPLOADS_DIR,
    secretKey: config.SECRET_KEY,
    secretKeyPrevious: config.SECRET_KEY_PREVIOUS,
    imageVersion: config.IMAGE_VERSION,
    now: new Date(),
  });

  streams.stdout(values.json ? formatJson(report.findings) : formatReport(report.findings));
  return exitCodeFor(report.findings, { strict: values.strict === true });
}
```

- [ ] **Krok 5: Rozšiř vstupní bod domény**

```ts
// packages/core/src/ops/index.ts (nahraď celý soubor)
export { OPS_AUDIT_ACTIONS } from './audit.js';
export {
  BACKUP_MIN_KEPT,
  backupDirName,
  listBackups,
  pruneBackups,
  runBackup,
  selectBackupsToDelete,
} from './backup.js';
export type { BackupEntry, RunBackupResult } from './backup.js';
export { assertDumpRoleSeesAllRows, DumpRoleBlindError } from './backup-guard.js';
export {
  BACKUP_FORMAT_VERSION,
  BACKUP_ROW_COUNT_TABLES,
  compareRowCounts,
  fileSha256,
  isBackupFromNewerVersion,
  parseManifest,
  readManifest,
  writeManifest,
} from './backup-manifest.js';
export type { BackupManifest, RowCountDiff } from './backup-manifest.js';
export { verifyBackup } from './backup-verify.js';
export type { VerifyReport } from './backup-verify.js';
export { exitCodeFor, formatJson, formatReport, summarize } from './doctor/format.js';
export { runDoctor } from './doctor/run.js';
export type { DoctorContext, DoctorFinding, DoctorSeverity } from './doctor/types.js';
export { knownKeyIds, loadOpsKeyring, missingGenerations } from './keyring.js';
export type { KeyringEnv, OpsKeyring } from './keyring.js';
export { isDatabaseEmpty, RestoreRefusedError, restoreBackup } from './restore.js';
export type { RestoreReport } from './restore.js';
export { binaryMajorVersion, majorVersionOf, ProcessFailedError, runProcess } from './run-process.js';
```

- [ ] **Krok 6: Spusť a commitni**

Spusť: `pnpm vitest run packages/core/test/ops/doctor-runtime.db.test.ts`
Očekávej: PASS, 9 testů.

```bash
git add packages/core/src/ops/doctor/run.ts packages/core/src/ops/index.ts apps/cli/src/commands/doctor.ts packages/core/test/ops/doctor-runtime.db.test.ts
git commit -m "feat(cli): add mlain doctor command with strict and json output"
```

---

### Úkol 15: `mlain genkey`

**Soubory:**
- Vytvoř: `packages/core/src/ops/genkey.ts`, `apps/cli/src/commands/genkey.ts`
- Test: `packages/core/test/ops/genkey.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
// packages/core/test/ops/genkey.test.ts
import { describe, expect, it } from 'vitest';
import { generateSecretKey, rotationRunbook } from '../../src/ops/genkey.js';

describe('generateSecretKey', () => {
  it('vyrobí base64url bez paddingu, který se dekóduje na 32 bajtů', () => {
    const key = generateSecretKey();
    expect(key).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(key, 'base64url')).toHaveLength(32);
  });

  it('dva klíče po sobě nejsou stejné', () => {
    expect(generateSecretKey()).not.toBe(generateSecretKey());
  });
});

describe('rotationRunbook', () => {
  const text = rotationRunbook(2, 'NOVYKLIC');

  it('má krok restartu VŠECH procesů před přešifrováním', () => {
    expect(text.indexOf('docker compose up -d')).toBeLessThan(
      text.indexOf('mlain rotate-credentials'),
    );
  });

  it('výslovně říká, že SECRET_KEY_PREVIOUS se neodebírá', () => {
    expect(text).toMatch(/SECRET_KEY_PREVIOUS se (nikdy )?neodebír/i);
  });

  it('obsahuje nový klíč s uvedeným key_id', () => {
    expect(text).toContain('SECRET_KEY=2:NOVYKLIC');
  });

  it('vysvětluje, proč nejde prohodit pořadí kroků 2 a 3', () => {
    expect(text).toMatch(/sender/i);
    expect(text).toMatch(/dešifrov/i);
  });
});
```

- [ ] **Krok 2: Spusť a ověř pád**

Spusť: `pnpm vitest run packages/core/test/ops/genkey.test.ts`
Očekávej: FAIL, modul neexistuje.

- [ ] **Krok 3: Implementuj**

```ts
// packages/core/src/ops/genkey.ts
import { randomBytes } from 'node:crypto';

/** SECRET_KEY je base64url bez paddingu, který se dekóduje na přesně 32 bajtů. */
export function generateSecretKey(): string {
  return randomBytes(32).toString('base64url');
}

/**
 * Postup rotace podle 3.10. Pořadí kroků 2 a 3 se nesmí prohodit: kdyby
 * přešifrování běželo dřív, než se restartuje sender, běžel by sender pořád
 * se starým klíčem, konfigurace providera by byla zašifrovaná novým a každé
 * dešifrování by selhalo. U kampaně na milion příjemců je to rozdíl milionu
 * zpráv označených jako neúspěšné.
 */
export function rotationRunbook(keyId: number, key: string): string {
  return [
    `Nový klíč pro pokolení ${keyId}:`,
    '',
    `  ${key}`,
    '',
    'Postup rotace, kroky se nesmí prohodit:',
    '',
    '  1. Do prostředí VŠECH procesů (web, worker, sender):',
    `       SECRET_KEY=${keyId}:${key}`,
    '       SECRET_KEY_PREVIOUS=<dosavadní pokolení, oddělená čárkou>',
    '',
    '  2. docker compose up -d',
    '     Restartujte VŠECHNY procesy a u každého ověřte readiness.',
    '     Teprve teď smí přijít krok 3.',
    '',
    '  3. mlain rotate-credentials',
    '     Přešifruje uložená tajemství na nové pokolení.',
    '     Kdyby tenhle krok přišel před restartem, sender by běžel se starým klíčem,',
    '     konfigurace providera by byla zašifrovaná novým a každé dešifrování by selhalo.',
    '',
    '  4. Počkejte 15 minut na expiraci identifikačních tokenů z prokliků.',
    '',
    '  5. SECRET_KEY_PREVIOUS se NIKDY neodebírá, ani po rotate-credentials.',
    '     Trackovací tokeny ve starých e-mailech leží v cizích schránkách roky',
    '     a otisky smazaných adres nejdou přepočítat, protože adresa je po výmazu pryč.',
    '     Odebrání starého pokolení je tichá ztráta ochrany: nic neselže a nic se nezaloguje.',
    '',
    '  6. Uložte si celý keyring do recovery bundle, tedy nový klíč i všechna předchozí pokolení.',
    '',
  ].join('\n');
}
```

- [ ] **Krok 4: Implementuj příkaz**

```ts
// apps/cli/src/commands/genkey.ts
import { parseArgs } from 'node:util';
import { generateSecretKey, rotationRunbook } from '@mlain/core/ops';
import { EXIT_OK, EXIT_USAGE } from '../exit-codes.js';
import type { CliStreams } from '../dispatch.js';

export async function runGenkeyCommand(
  streams: CliStreams,
  argv: readonly string[],
): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: { id: { type: 'string', default: '2' } },
    allowPositionals: false,
  });
  const keyId = Number(values.id);
  if (!Number.isInteger(keyId) || keyId < 1 || keyId > 255) {
    streams.stderr('key_id musí být celé číslo od 1 do 255.');
    return EXIT_USAGE;
  }
  for (const line of rotationRunbook(keyId, generateSecretKey()).split('\n')) {
    streams.stdout(line);
  }
  return EXIT_OK;
}
```

- [ ] **Krok 5: Doplň export, jinak příkaz neprojde typecheckem**

```ts
// packages/core/src/ops/index.ts (doplň na konec souboru)
export { generateSecretKey, rotationRunbook } from './genkey.js';
```

- [ ] **Krok 6: Spusť a commitni**

Spusť: `pnpm vitest run packages/core/test/ops/genkey.test.ts && pnpm turbo run typecheck --filter @mlain/cli`
Očekávej: PASS, 6 testů, typecheck zelený.

```bash
git add packages/core/src/ops/genkey.ts apps/cli/src/commands/genkey.ts packages/core/test/ops/genkey.test.ts
git commit -m "feat(cli): add mlain genkey with the full rotation runbook"
```

---

### Úkol 16: Registr šifrovaných sloupců a jeho hlídač

**Soubory:**
- Vytvoř: `packages/core/src/ops/encrypted-columns.ts`
- Test: `packages/core/test/ops/encrypted-columns.db.test.ts`

**Proč je hlídač povinný.** `mlain rotate-credentials` přešifruje jen to, co je v registru. Kdyby některý plán přidal nový šifrovaný sloupec a do registru ho nezapsal, rotace by ho tiše přeskočila a po odebrání starého klíče by se ta hodnota už nikdy nedešifrovala. Ochrana, jejíž jediné vynucení je „implementátor si to přečte", není ochrana, takže je tu test, který porovná registr se skutečností v `information_schema`.

- [ ] **Krok 1: Napiš padající test**

```ts
// packages/core/test/ops/encrypted-columns.db.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CREDENTIAL_CONTEXTS } from '@mlain/contracts/crypto';
import { startTestPostgres, type TestPostgres } from '../support/db.js';
import {
  ENCRYPTED_COLUMNS,
  discoverEncryptedColumns,
  unregisteredEncryptedColumns,
} from '../../src/ops/encrypted-columns.js';

let pg: TestPostgres;

beforeAll(async () => {
  pg = await startTestPostgres();
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

describe('ENCRYPTED_COLUMNS', () => {
  it('každá položka má tabulku, sloupec, klíč řádku a kontext obálky', () => {
    for (const c of ENCRYPTED_COLUMNS) {
      expect(c.table).toMatch(/^[a-z_]+$/);
      expect(c.column).toMatch(/^[a-z_]+$/);
      expect(c.primaryKey.length).toBeGreaterThan(0);
      expect(CREDENTIAL_CONTEXTS).toContain(c.context);
    }
  });

  it('nemá duplicitní dvojici tabulka a sloupec', () => {
    const keys = ENCRYPTED_COLUMNS.map((c) => `${c.table}.${c.column}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('všechny čtyři sloupce ve schématu opravdu existují a jsou text', async () => {
    // Registr je jediný seznam, podle kterého rotace pracuje. Překlep ve jméně
    // by znamenal, že se ten sloupec NIKDY nepřešifruje, a přišlo by se na to
    // až po odebrání starého klíče, kdy už hodnotu nikdo nedešifruje.
    //
    // Typ hlídá i P03 vlastním testem: kontrakt 4.10.4 je textový a dva
    // sloupce v bytea by rotaci nutily pracovat na každém jinak.
    for (const c of ENCRYPTED_COLUMNS) {
      const rows = await pg.sql<{ data_type: string }>(
        `SELECT data_type FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
        [c.table, c.column],
      );
      expect(rows, `${c.table}.${c.column} ve schématu není`).toHaveLength(1);
      expect(rows[0].data_type, `${c.table}.${c.column}`).toBe('text');
    }
  });

  it('každá tabulka v registru má workspace_id, protože obálka je na projekt vázaná', async () => {
    // AAD obálky nese workspace_id (kontrakt P02, 4.10.4). Bez něj dešifrování
    // selže, takže rotace musí u každého řádku znát jeho projekt.
    for (const c of ENCRYPTED_COLUMNS) {
      const rows = await pg.sql(
        `SELECT 1 FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1 AND column_name = 'workspace_id'`,
        [c.table],
      );
      expect(rows, `${c.table} nemá workspace_id`).toHaveLength(1);
    }
  });
});

describe('hlídač registru', () => {
  it('všechny sloupce s příponou _encrypted ve schématu jsou v registru', async () => {
    const missing = await unregisteredEncryptedColumns(pg.ownerUrl);
    expect(missing).toEqual([]);
  });

  it('nový neregistrovaný sloupec test odhalí', async () => {
    await pg.sql(`CREATE TABLE pokus_tajemstvi (id uuid primary key, cosi_encrypted bytea)`);
    const missing = await unregisteredEncryptedColumns(pg.ownerUrl);
    expect(missing).toContain('pokus_tajemstvi.cosi_encrypted');
    await pg.sql('DROP TABLE pokus_tajemstvi');
  });

  it('discoverEncryptedColumns vrací jen sloupce se známou příponou', async () => {
    const found = await discoverEncryptedColumns(pg.ownerUrl);
    expect(found.every((c) => c.endsWith('_encrypted'))).toBe(true);
  });
});
```

- [ ] **Krok 2: Spusť a ověř pád**

Spusť: `pnpm vitest run packages/core/test/ops/encrypted-columns.db.test.ts`
Očekávej: FAIL, modul neexistuje.

- [ ] **Krok 3: Implementuj**

```ts
// packages/core/src/ops/encrypted-columns.ts
import { sql } from 'drizzle-orm';
import type { CredentialContext } from '@mlain/contracts/crypto';
import { withAdminTx } from './db.js';

export type EncryptedColumn = {
  table: string;
  column: string;
  /** Sloupce, které řádek jednoznačně určují. U partitionovaných tabulek jsou dva. */
  primaryKey: readonly string[];
  /**
   * Kontext obálky podle 4.10.4. Dešifrování s jiným kontextem musí selhat.
   * Typ je uzavřený výčet z kontraktu, ne volný řetězec: `CREDENTIAL_CONTEXTS`
   * má čtyři hodnoty a překlep by se jinak projevil až za běhu jako
   * `crypto_context_mismatch` nad daty, která už nejdou dešifrovat.
   */
  context: CredentialContext;
};

/**
 * Úplný seznam sloupců, které nesou šifrovou obálku. Kdo přidá nový, přidá ho
 * i sem, jinak ho `mlain rotate-credentials` přeskočí a po odebrání starého
 * klíče se hodnota už nikdy nedešifruje. Hlídá to test s dotazem do
 * information_schema, ne dobrá vůle.
 *
 * JMÉNA SEDÍ SE SCHÉMATEM P03 a hlídá to test v kroku 1. Dřívější znění mělo
 * tři ze čtyř položek špatně (`sending_providers.credentials_encrypted`
 * místo `config_encrypted` a tabulku `ai_providers` místo
 * `ai_provider_credentials`), což by znamenalo, že hlídač registru najde dva
 * neregistrované sloupce a rotace odmítne běžet úplně.
 */
export const ENCRYPTED_COLUMNS: readonly EncryptedColumn[] = [
  {
    table: 'sending_providers',
    column: 'config_encrypted',
    primaryKey: ['id'],
    context: 'sending_provider',
  },
  {
    table: 'webhook_endpoints',
    column: 'secret_encrypted',
    primaryKey: ['id'],
    context: 'webhook_secret',
  },
  {
    table: 'ai_provider_credentials',
    column: 'api_key_encrypted',
    primaryKey: ['id'],
    context: 'ai_provider',
  },
  {
    // `inbound_secret` jako kontext NEEXISTUJE. CREDENTIAL_CONTEXTS má čtyři
    // hodnoty: sending_provider, ai_provider, webhook_secret, oauth_token.
    // Tajemství příchozího endpointu je svým významem tajemství webhooku,
    // takže se používá `webhook_secret`. Kdyby to P07 jako vlastník
    // `inbound_endpoints` šifroval jinak, je to nález proti P07, ne důvod
    // zavádět pátý kontext, který kontrakt nezná.
    table: 'inbound_endpoints',
    column: 'secret_encrypted',
    primaryKey: ['id'],
    context: 'webhook_secret',
  },
];

const ENCRYPTED_SUFFIX = '_encrypted';

export async function discoverEncryptedColumns(adminUrl: string): Promise<string[]> {
  return withAdminTx(adminUrl, async (tx) => {
    const { rows } = await tx.execute<{ table_name: string; column_name: string }>(
      sql`SELECT table_name, column_name
            FROM information_schema.columns
           WHERE table_schema = 'public'
             AND column_name LIKE ${`%${ENCRYPTED_SUFFIX}`}
           ORDER BY table_name, column_name`);
    return rows.map((r) => `${r.table_name}.${r.column_name}`);
  });
}

export async function unregisteredEncryptedColumns(adminUrl: string): Promise<string[]> {
  const registered = new Set(ENCRYPTED_COLUMNS.map((c) => `${c.table}.${c.column}`));
  return (await discoverEncryptedColumns(adminUrl)).filter((c) => !registered.has(c));
}
```

- [ ] **Krok 4: Spusť a ověř průchod**

Spusť: `pnpm vitest run packages/core/test/ops/encrypted-columns.db.test.ts`
Očekávej: PASS, 7 testů. Kdyby test hlídače spadl na sloupci, který ve skutečnosti existuje a v registru není, **doplň ho do registru**, ne do výjimky. Kdyby spadl test typu nebo existence sloupce, je chyba ve jméně v registru, ne ve schématu: P03 má na tytéž čtyři sloupce vlastní test.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/ops/encrypted-columns.ts packages/core/test/ops/encrypted-columns.db.test.ts
git commit -m "feat(ops): register encrypted columns and guard the registry against drift"
```

---

### Úkol 17: `mlain rotate-credentials`, akceptační kritérium 55

**Soubory:**
- Vytvoř: `packages/core/src/ops/rotate-credentials.ts`, `apps/cli/src/commands/rotate-credentials.ts`
- Test: `packages/core/test/ops/rotate-credentials.db.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
// packages/core/test/ops/rotate-credentials.db.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decryptEnvelope, encryptEnvelope, envelopeKeyId } from '@mlain/contracts/crypto';
import { parseKeyring } from '@mlain/contracts/keyring';
import { startTestPostgres, type TestPostgres } from '../support/db.js';
import { rotateCredentials } from '../../src/ops/rotate-credentials.js';

const KEY_1 = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const KEY_2 = 'HxwdGxoZGBcWFRQTEhEQDw4NDAsKCQgHBgUEAwIBAAE';
const keyring1 = parseKeyring({ secretKey: `1:${KEY_1}` });
let pg: TestPostgres;
let workspaceA: string;
let workspaceB: string;

const rotateInput = () => ({
  adminUrl: pg.ownerUrl,
  secretKey: `2:${KEY_2}`,
  secretKeyPrevious: `1:${KEY_1}`,
});

beforeAll(async () => {
  pg = await startTestPostgres();
  ({ workspaceId: workspaceA } = await pg.seedMinimalInstallation({ contacts: 1 }));
  // Druhý projekt je tu schválně. Obálka je přes AAD vázaná na workspace_id,
  // takže rotace, která by projekt nebrala v potaz, uspěje u prvního řádku
  // a u druhého selže na dešifrování. S jedním projektem by ta chyba prošla.
  ({ workspaceId: workspaceB } = await pg.seedMinimalInstallation({
    contacts: 1,
    ownerEmail: 'druhy@example.test',
  }));
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

async function seedProviderWithOldKey(workspaceId: string): Promise<string> {
  // POZOR na tvar volání. Kontrakt P02 bere jeden objekt, `plaintext` je
  // ŘETĚZEC (ne Buffer), klíč se předává jako `keyring`, ne `master`,
  // a `workspaceId` je POVINNÉ, protože vstupuje do AAD.
  const { stored } = encryptEnvelope({
    plaintext: '{"accessKeyId":"AKIA"}',
    keyId: 1,
    keyring: keyring1,
    context: 'sending_provider',
    workspaceId,
  });
  const [row] = await pg.sql<{ id: string }>(
    `INSERT INTO sending_providers (workspace_id, name, type, config_encrypted)
     VALUES ($1, 'Testovací provider', 'smtp', $2)
     RETURNING id`,
    [workspaceId, stored],
  );
  return row.id;
}

describe('rotateCredentials', () => {
  it('přešifruje všechny obálky na aktuální pokolení (kritérium 55)', async () => {
    const id = await seedProviderWithOldKey(workspaceA);
    const report = await rotateCredentials(rotateInput());
    expect(report.rotated).toBeGreaterThanOrEqual(1);
    const [row] = await pg.sql<{ config_encrypted: string }>(
      'SELECT config_encrypted FROM sending_providers WHERE id = $1',
      [id],
    );
    expect(envelopeKeyId(row.config_encrypted)).toBe(2);
  });

  it('přešifruje i řádky druhého projektu, tedy AAD bere z řádku', async () => {
    // Kdyby rotace předávala do encryptEnvelope pevný nebo chybný workspaceId,
    // dešifrování téhle obálky by skončilo v `failed` a report by přesto
    // vypadal jako částečný úspěch.
    const id = await seedProviderWithOldKey(workspaceB);
    const report = await rotateCredentials(rotateInput());
    expect(report.failed).toEqual([]);
    const [row] = await pg.sql<{ config_encrypted: string }>(
      'SELECT config_encrypted FROM sending_providers WHERE id = $1',
      [id],
    );
    expect(envelopeKeyId(row.config_encrypted)).toBe(2);
  });

  it('přešifrovanou hodnotu jde přečíst zpátky se stejným obsahem', async () => {
    // Bez tohohle testu by prošla i rotace, která obálku vyrobí správně
    // tvarovanou, ale s jiným obsahem. Dešifrování je jediný důkaz.
    const id = await seedProviderWithOldKey(workspaceA);
    await rotateCredentials(rotateInput());
    const [row] = await pg.sql<{ config_encrypted: string; workspace_id: string }>(
      'SELECT config_encrypted, workspace_id FROM sending_providers WHERE id = $1',
      [id],
    );
    const plaintext = decryptEnvelope({
      stored: row.config_encrypted,
      context: 'sending_provider',
      workspaceId: row.workspace_id,
      keyring: parseKeyring({ secretKey: `2:${KEY_2}`, secretKeyPrevious: `1:${KEY_1}` }),
    });
    expect(JSON.parse(plaintext)).toEqual({ accessKeyId: 'AKIA' });
  });

  it('je idempotentní, druhý běh nic nepřešifruje', async () => {
    await rotateCredentials(rotateInput());
    const second = await rotateCredentials(rotateInput());
    expect(second.rotated).toBe(0);
    expect(second.alreadyCurrent).toBeGreaterThanOrEqual(1);
  });

  it('nikdy nehlásí, že staré klíče jdou odebrat', async () => {
    const report = await rotateCredentials(rotateInput());
    expect(report.notice).toMatch(/SECRET_KEY_PREVIOUS/);
    expect(report.notice).not.toMatch(/můžete odebrat|lze odebrat|už nejsou potřeba/i);
  });

  it('obálku, kterou nejde dešifrovat, přeskočí a nahlásí, místo aby ji zahodila', async () => {
    await pg.sql(
      `INSERT INTO sending_providers (workspace_id, name, type, config_encrypted)
       VALUES ($1, 'Rozbitý', 'smtp', 'enc:v1:AAAA')`,
      [workspaceA],
    );
    const report = await rotateCredentials(rotateInput());
    expect(report.failed).toHaveLength(1);
    expect(report.failed[0]).toContain('sending_providers');
    // Řádek zůstal nedotčený. Rotace nesmí poškodit to, co nepřečetla.
    const [row] = await pg.sql<{ config_encrypted: string }>(
      `SELECT config_encrypted FROM sending_providers WHERE name = 'Rozbitý'`,
    );
    expect(row.config_encrypted).toBe('enc:v1:AAAA');
    await pg.sql(`DELETE FROM sending_providers WHERE name = 'Rozbitý'`);
  });

  it('odmítne běžet, když ve schématu je neregistrovaný šifrovaný sloupec', async () => {
    await pg.sql(`CREATE TABLE pokus2 (id uuid primary key, x_encrypted text)`);
    await expect(rotateCredentials(rotateInput())).rejects.toThrow(/pokus2/);
    await pg.sql('DROP TABLE pokus2');
  });

  it('zapíše do auditu akci credentials.rotated', async () => {
    const rows = await pg.sql<{ action: string }>(
      "SELECT action FROM audit_log WHERE action = 'credentials.rotated'",
    );
    expect(rows.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Krok 2: Spusť a ověř pád**

Spusť: `pnpm vitest run packages/core/test/ops/rotate-credentials.db.test.ts`
Očekávej: FAIL, modul neexistuje.

- [ ] **Krok 3: Implementuj**

```ts
// packages/core/src/ops/rotate-credentials.ts
import { sql } from 'drizzle-orm';
import { decryptEnvelope, encryptEnvelope, envelopeKeyId } from '@mlain/contracts/crypto';
import { currentKeyId, parseKeyring } from '@mlain/contracts/keyring';
import { writeAuditLog } from '@mlain/core/audit/write';
import { withAdminTx } from './db.js';
import { ENCRYPTED_COLUMNS, unregisteredEncryptedColumns } from './encrypted-columns.js';

export type RotateInput = {
  /**
   * Vždy `DATABASE_URL_MIGRATOR`. Všechny čtyři tabulky s obálkami mají
   * `ws_isolation`, takže pod aplikační rolí by `SELECT` nenašel ani jeden
   * řádek a rotace by skončila hlášením „přešifrováno 0, vše aktuální".
   */
  adminUrl: string;
  secretKey: string;
  secretKeyPrevious: string;
  batchSize?: number;
};

export type RotateReport = {
  rotated: number;
  alreadyCurrent: number;
  failed: string[];
  notice: string;
};

const NOTICE =
  'SECRET_KEY_PREVIOUS nechte beze změny. Přešifrovat jdou jen uložená tajemství. ' +
  'Trackovací tokeny ve starých e-mailech a otisky smazaných adres přešifrovat nejde nikdy, ' +
  'takže odebrání starého pokolení je tichá ztráta ochrany.';

export async function rotateCredentials(input: RotateInput): Promise<RotateReport> {
  const stray = await unregisteredEncryptedColumns(input.adminUrl);
  if (stray.length > 0) {
    throw new Error(
      `Ve schématu jsou šifrované sloupce, které nejsou v registru: ${stray.join(', ')}. ` +
        'Rotace by je tiše přeskočila a po odebrání starého klíče by je nešlo dešifrovat. ' +
        'Doplňte je do ENCRYPTED_COLUMNS a spusťte rotaci znovu.',
    );
  }

  const keyring = parseKeyring({
    secretKey: input.secretKey,
    secretKeyPrevious: input.secretKeyPrevious,
  });
  const targetKeyId = currentKeyId(keyring);
  const batchSize = input.batchSize ?? 500;

  let rotated = 0;
  let alreadyCurrent = 0;
  const failed: string[] = [];

  await withAdminTx(input.adminUrl, async (tx) => {
    for (const col of ENCRYPTED_COLUMNS) {
      const { rows: exists } = await tx.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM pg_tables
             WHERE schemaname = 'public' AND tablename = ${col.table}`);
      if (exists[0].n === 0) continue;

      const pkList = col.primaryKey.map((c) => `"${c}"`).join(', ');
      // workspace_id se čte VŽDY. Obálka je přes AAD vázaná na projekt
      // (kontrakt 4.10.4), takže bez něj dešifrování selže a rotace by
      // ohlásila poškozená data tam, kde jsou v pořádku jen její vstupy.
      const { rows } = await tx.execute<Record<string, unknown>>(
        sql`SELECT ${sql.raw(pkList)}, workspace_id, ${sql.raw(`"${col.column}"`)} AS value
              FROM ${sql.raw(`"${col.table}"`)}
             WHERE ${sql.raw(`"${col.column}"`)} IS NOT NULL`);

      for (let i = 0; i < rows.length; i += batchSize) {
        for (const row of rows.slice(i, i + batchSize)) {
          const stored = row.value as string;
          const workspaceId = String(row.workspace_id);
          const rowId = col.primaryKey.map((c) => String(row[c])).join('/');

          let keyId: number;
          try {
            keyId = envelopeKeyId(stored);
          } catch {
            failed.push(`${col.table}.${col.column} #${rowId}: obálku nejde přečíst`);
            continue;
          }
          if (keyId === targetKeyId) {
            alreadyCurrent += 1;
            continue;
          }
          if (!keyring.has(keyId)) {
            failed.push(`${col.table}.${col.column} #${rowId}: chybí klíč pokolení ${keyId}`);
            continue;
          }

          let plaintext: string;
          try {
            plaintext = decryptEnvelope({
              stored, context: col.context, workspaceId, keyring,
            });
          } catch {
            failed.push(`${col.table}.${col.column} #${rowId}: dešifrování selhalo`);
            continue;
          }

          const reencrypted = encryptEnvelope({
            plaintext, keyId: targetKeyId, keyring, context: col.context, workspaceId,
          });
          const where = col.primaryKey
            .map((c) => sql`${sql.raw(`"${c}"`)} = ${row[c]}`)
            .reduce((a, b) => sql`${a} AND ${b}`);
          await tx.execute(
            sql`UPDATE ${sql.raw(`"${col.table}"`)}
                   SET ${sql.raw(`"${col.column}"`)} = ${reencrypted.stored},
                       updated_at = now()
                 WHERE ${where}`);
          rotated += 1;
        }
      }
    }

    await writeAuditLog(tx, {
      action: 'credentials.rotated',
      workspaceId: null,
      actor: { type: 'system', job: 'mlain rotate-credentials' },
      targetType: 'installation',
      targetId: null,
      metadata: { rotated, already_current: alreadyCurrent, failed: failed.length },
    });
  });

  return { rotated, alreadyCurrent, failed, notice: NOTICE };
}
```

**Proč je celá rotace v jedné transakci.** Dřívější znění otvíralo transakci na každou dávku zvlášť. Kdyby proces spadl mezi dvěma dávkami, část řádků by byla na novém pokolení a část na starém, a druhý běh by to sice dorovnal, ale audit by mezitím tvrdil, že rotace proběhla. Jedna transakce dává buď celý přechod, nebo žádný. Dávkování zůstává kvůli paměti, ne kvůli commitům.

- [ ] **Krok 4: Implementuj příkaz**

```ts
// apps/cli/src/commands/rotate-credentials.ts
import { loadConfig } from '@mlain/core/config';
import { rotateCredentials } from '@mlain/core/ops';
import { EXIT_CONFIG, EXIT_OK } from '../exit-codes.js';
import type { CliStreams } from '../dispatch.js';

export async function runRotateCredentialsCommand(
  streams: CliStreams,
  _argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const config = loadConfig(env);
  if (!config.DATABASE_URL_MIGRATOR) {
    streams.stderr(
      'Rotace vyžaduje DATABASE_URL_MIGRATOR. Sloupce s obálkami leží v tabulkách ' +
        's row level security, takže by aplikační role nenašla ani jeden řádek ' +
        'a rotace by skončila hlášením „přešifrováno 0".',
    );
    return EXIT_CONFIG;
  }
  const report = await rotateCredentials({
    adminUrl: config.DATABASE_URL_MIGRATOR,
    secretKey: config.SECRET_KEY,
    secretKeyPrevious: config.SECRET_KEY_PREVIOUS,
  });
  streams.stdout(
    `Přešifrováno ${report.rotated}, už na aktuálním klíči ${report.alreadyCurrent}.`,
  );
  if (report.failed.length > 0) {
    streams.stderr(`Nepodařilo se přešifrovat ${report.failed.length} hodnot:`);
    for (const f of report.failed) streams.stderr(`  - ${f}`);
  }
  streams.stdout(report.notice);
  return report.failed.length > 0 ? 1 : EXIT_OK;
}
```

- [ ] **Krok 5: Doplň exporty**

```ts
// packages/core/src/ops/index.ts (doplň na konec souboru)
export { ENCRYPTED_COLUMNS, discoverEncryptedColumns, unregisteredEncryptedColumns } from './encrypted-columns.js';
export { rotateCredentials } from './rotate-credentials.js';
```

- [ ] **Krok 6: Spusť a commitni**

Spusť: `pnpm vitest run packages/core/test/ops/rotate-credentials.db.test.ts && pnpm turbo run typecheck --filter @mlain/cli`
Očekávej: PASS, 8 testů, typecheck zelený.

```bash
git add packages/core/src/ops/rotate-credentials.ts apps/cli/src/commands/rotate-credentials.ts packages/core/test/ops/rotate-credentials.db.test.ts
git commit -m "feat(cli): add mlain rotate-credentials with registry drift guard"
```

---

### Úkol 18: `mlain reset-password`

**Soubory:**
- Vytvoř: `packages/core/src/ops/reset-password.ts`, `apps/cli/src/commands/reset-password.ts`
- Test: `packages/core/test/ops/reset-password.db.test.ts`

**Proč to existuje.** Obnova hesla přes e-mail vyžaduje nastavené odesílání, které čerstvá instalace ještě nemá. Bez příkazu v kontejneru se dá z vlastní instalace zamknout ven. Je to požadavek U→1.8 části 6 a řádek v tabulce 8.1.5.

- [ ] **Krok 1: Napiš padající test**

```ts
// packages/core/test/ops/reset-password.db.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestPostgres } from '../support/db.js';
import { resetPassword, UserNotFoundError } from '../../src/ops/reset-password.js';

let pg: TestPostgres;

beforeAll(async () => {
  pg = await startTestPostgres();
  await pg.seedMinimalInstallation({ contacts: 0, ownerEmail: 'jana@firma.cz' });
}, 180_000);

afterAll(async () => {
  await pg?.stop();
});

describe('resetPassword', () => {
  it('nastaví nové heslo a vrátí ho, když se nezadalo', async () => {
    const r = await resetPassword({
      databaseUrl: pg.ownerUrl,
      email: 'jana@firma.cz',
      password: null,
    });
    expect(r.generatedPassword).toBeTruthy();
    expect(r.generatedPassword!.length).toBeGreaterThanOrEqual(16);
  });

  it('uloží hash, nikdy ne heslo v otevřené podobě', async () => {
    await resetPassword({
      databaseUrl: pg.ownerUrl,
      email: 'jana@firma.cz',
      password: 'nove-heslo-dost-dlouhe',
    });
    const [row] = await pg.sql<{ password_hash: string }>(
      'SELECT password_hash FROM users WHERE email = $1',
      ['jana@firma.cz'],
    );
    expect(row.password_hash).not.toContain('nove-heslo');
    expect(row.password_hash.startsWith('$argon2')).toBe(true);
  });

  it('zruší všechny relace uživatele', async () => {
    await pg.sql(
      // Sloupec `expires_at` v sessions NEEXISTUJE, jmenuje se `absolute_expires_at`,
      // a `csrf_secret bytea` je NOT NULL bez defaultu. Obojí podle schématu P03.
      `INSERT INTO sessions (user_id, token_hash, csrf_secret, absolute_expires_at)
       SELECT id, sha256('token'), sha256('csrf'), now() + interval '1 day'
         FROM users WHERE email = $1`,
      ['jana@firma.cz'],
    );
    await resetPassword({
      databaseUrl: pg.ownerUrl,
      email: 'jana@firma.cz',
      password: 'jeste-jine-heslo-dost-dlouhe',
    });
    const rows = await pg.sql<{ n: string }>(
      `SELECT count(*)::text AS n FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE u.email = $1 AND s.revoked_at IS NULL`,
      ['jana@firma.cz'],
    );
    expect(rows[0].n).toBe('0');
  });

  it('u neznámé adresy hodí UserNotFoundError a nic nezmění', async () => {
    await expect(
      resetPassword({ databaseUrl: pg.ownerUrl, email: 'nikdo@firma.cz', password: null }),
    ).rejects.toThrow(UserNotFoundError);
  });

  it('krátké heslo odmítne, protože délka je jediný požadavek', async () => {
    await expect(
      resetPassword({ databaseUrl: pg.ownerUrl, email: 'jana@firma.cz', password: 'krátké' }),
    ).rejects.toThrow(/10/);
  });

  it('zapíše do auditu akci user.password_reset_from_cli', async () => {
    const rows = await pg.sql<{ action: string }>(
      "SELECT action FROM audit_log WHERE action = 'user.password_reset_from_cli'",
    );
    expect(rows.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Krok 2: Spusť a ověř pád**

Spusť: `pnpm vitest run packages/core/test/ops/reset-password.db.test.ts`
Očekávej: FAIL, modul neexistuje.

- [ ] **Krok 3: Implementuj**

```ts
// packages/core/src/ops/reset-password.ts
import { randomBytes } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { writeAuditLog } from '@mlain/core/audit/write';
import { hashPassword } from '@mlain/core/identity/password';
import { createPool, withoutContext } from '@mlain/db';

export const MIN_PASSWORD_LENGTH = 10;

export class UserNotFoundError extends Error {
  constructor(email: string) {
    super(`Uživatel s adresou ${email} v instalaci není.`);
    this.name = 'UserNotFoundError';
  }
}

export type ResetPasswordInput = {
  /**
   * Aplikační URL stačí. `users` i `sessions` jsou na whitelistu tabulek
   * BEZ row level security (P03), takže jako jediný z osmi příkazů nepotřebuje
   * migrátora. Je to záměr: obnova hesla musí jít i v instalaci, kde
   * `DATABASE_URL_MIGRATOR` nikdo nenastavil.
   */
  databaseUrl: string;
  email: string;
  /** Když je null, vygeneruje se heslo a vypíše se na stdout. */
  password: string | null;
};

export type ResetPasswordReport = { userId: string; generatedPassword: string | null };

export async function resetPassword(input: ResetPasswordInput): Promise<ResetPasswordReport> {
  const generated = input.password === null ? randomBytes(18).toString('base64url') : null;
  const password = input.password ?? generated!;
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(
      `Heslo musí mít aspoň ${MIN_PASSWORD_LENGTH} znaků. Žádné speciální znaky se nevyžadují, délka je jediný požadavek.`,
    );
  }

  const pool = createPool(input.databaseUrl, 'app', 1);
  try {
    return await withoutContext(pool, async (tx) => {
      // `users.email` je citext, takže lower() na obou stranách je zbytečné
      // a hlavně by zahodilo použití unikátního indexu. Porovnává se přímo.
      const { rows: users } = await tx.execute<{ id: string }>(
        sql`SELECT id FROM users WHERE email = ${input.email} AND deleted_at IS NULL`);
      const user = users[0];
      if (!user) throw new UserNotFoundError(input.email);

      // Sloupec se jmenuje `failed_login_count`, ne `failed_login_attempts`.
      await tx.execute(sql`
        UPDATE users
           SET password_hash = ${await hashPassword(password)},
               password_changed_at = now(),
               failed_login_count = 0,
               locked_until = NULL,
               updated_at = now()
         WHERE id = ${user.id}`);
      // Změna hesla revokuje všechny relace, stejně jako změna z rozhraní.
      await tx.execute(sql`
        UPDATE sessions SET revoked_at = now(), revoked_reason = 'password_reset'
         WHERE user_id = ${user.id} AND revoked_at IS NULL`);
      await writeAuditLog(tx, {
        action: 'user.password_reset_from_cli',
        workspaceId: null,
        actor: { type: 'system', job: 'mlain reset-password' },
        targetType: 'user',
        targetId: user.id,
        metadata: { generated: generated !== null },
      });
      return { userId: user.id, generatedPassword: generated };
    });
  } finally {
    await pool.end();
  }
}
```

- [ ] **Krok 4: Implementuj příkaz**

```ts
// apps/cli/src/commands/reset-password.ts
import { parseArgs } from 'node:util';
import { loadConfig } from '@mlain/core/config';
import { resetPassword, UserNotFoundError } from '@mlain/core/ops';
import { EXIT_OK, EXIT_USAGE } from '../exit-codes.js';
import type { CliStreams } from '../dispatch.js';

export async function runResetPasswordCommand(
  streams: CliStreams,
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  {
    const { values, positionals } = parseArgs({
      args: [...argv],
      options: { password: { type: 'string' } },
      allowPositionals: true,
    });
    const email = positionals[0];
    if (!email) {
      streams.stderr('Použití: mlain reset-password <e-mail> [--password <heslo>]');
      return EXIT_USAGE;
    }
    const config = loadConfig(env);
    try {
      // `users` a `sessions` jsou na whitelistu tabulek BEZ RLS (P03), takže
      // tenhle příkaz jako jediný z osmi vystačí s aplikační rolí. Je to
      // záměr: obnova hesla musí jít i v instalaci, kde migrátorské URL
      // nikdo nenastavil.
      const report = await resetPassword({
        databaseUrl: config.DATABASE_URL,
        email,
        password: values.password ?? null,
      });
      if (report.generatedPassword) {
        streams.stdout(`Nové heslo pro ${email}:\n\n  ${report.generatedPassword}\n`);
        streams.stdout('Přihlaste se s ním a hned si ho v profilu změňte.');
      } else {
        streams.stdout(`Heslo pro ${email} je nastavené.`);
      }
      streams.stdout('Všechny dosavadní relace uživatele jsou zrušené.');
      return EXIT_OK;
    } catch (err) {
      if (err instanceof UserNotFoundError) {
        streams.stderr(err.message);
        return 1;
      }
      throw err;
    }
  }
}
```

- [ ] **Krok 5: Doplň export**

```ts
// packages/core/src/ops/index.ts (doplň na konec souboru)
export { MIN_PASSWORD_LENGTH, resetPassword, UserNotFoundError } from './reset-password.js';
```

- [ ] **Krok 6: Spusť a commitni**

Spusť: `pnpm vitest run packages/core/test/ops/reset-password.db.test.ts && pnpm turbo run typecheck --filter @mlain/cli`
Očekávej: PASS, 6 testů, typecheck zelený.

```bash
git add packages/core/src/ops/reset-password.ts apps/cli/src/commands/reset-password.ts packages/core/test/ops/reset-password.db.test.ts
git commit -m "feat(cli): add mlain reset-password for installations without sending"
```

---

### Úkol 19: `mlain rebuild-engagement` a `mlain upgrade`

**Soubory:**
- Vytvoř: `packages/core/src/ops/rebuild-engagement.ts`, `packages/core/src/ops/upgrade.ts`
- Vytvoř: `apps/cli/src/commands/rebuild-engagement.ts`, `apps/cli/src/commands/upgrade.ts`
- Test: `packages/core/test/ops/rebuild-engagement.db.test.ts`, `packages/core/test/ops/upgrade.db.test.ts`

- [ ] **Krok 1: Napiš padající test přepočtu, kritérium 77 části 5**

```ts
// packages/core/test/ops/rebuild-engagement.db.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestPostgres } from '../support/db.js';
import { recomputeContactEngagement } from '@mlain/core/tracking';
import { rebuildEngagement } from '../../src/ops/rebuild-engagement.js';

let pg: TestPostgres;
let workspaceId: string;

beforeAll(async () => {
  pg = await startTestPostgres();
  const seeded = await pg.seedMinimalInstallation({ contacts: 25 });
  workspaceId = seeded.workspaceId;
  await pg.seedEngagementHistory({ workspaceId, campaigns: 3 });
}, 240_000);

afterAll(async () => {
  await pg?.stop();
});

describe('rebuildEngagement', () => {
  it('volá přepočet z @mlain/core/tracking, neimplementuje vlastní vzorec', () => {
    expect(typeof recomputeContactEngagement).toBe('function');
  });

  it('výsledek se rovná přírůstkově udržovanému stavu (kritérium 77)', async () => {
    const before = await pg.sql<{ contact_id: string; opens_total: number; clicks_total: number }>(
      'SELECT contact_id, opens_total, clicks_total FROM contact_engagement ORDER BY contact_id',
    );
    await pg.sql('UPDATE contact_engagement SET opens_total = 0, clicks_total = 0');
    await rebuildEngagement({ adminUrl: pg.ownerUrl, workspaceId, batchSize: 10 });
    const after = await pg.sql<{ contact_id: string; opens_total: number; clicks_total: number }>(
      'SELECT contact_id, opens_total, clicks_total FROM contact_engagement ORDER BY contact_id',
    );
    expect(after).toEqual(before);
  });

  it('běží po dávkách a vrátí počet zpracovaných kontaktů', async () => {
    const report = await rebuildEngagement({
      adminUrl: pg.ownerUrl,
      workspaceId,
      batchSize: 10,
    });
    expect(report.processed).toBe(25);
    expect(report.batches).toBe(3);
  });

  it('u neznámého projektu skončí chybou, ne tichým nulovým během', async () => {
    await expect(
      rebuildEngagement({
        adminUrl: pg.ownerUrl,
        workspaceId: '00000000-0000-7000-8000-000000000000',
        batchSize: 10,
      }),
    ).rejects.toThrow(/projekt/i);
  });
});
```

- [ ] **Krok 2: Spusť a ověř pád**

Spusť: `pnpm vitest run packages/core/test/ops/rebuild-engagement.db.test.ts`
Očekávej: FAIL, modul neexistuje.

- [ ] **Krok 3: Implementuj přepočet jako obal, ne jako druhý vzorec**

```ts
// packages/core/src/ops/rebuild-engagement.ts
import { sql } from 'drizzle-orm';
import { recomputeContactEngagement } from '@mlain/core/tracking';
import { withAdminTx } from './db.js';

export type RebuildInput = {
  /**
   * `DATABASE_URL_MIGRATOR`. `contacts`, `contact_engagement`
   * i `message_engagement` mají `ws_isolation`, takže pod aplikační rolí
   * by přepočet prošel, zpracoval nula kontaktů a ohlásil hotovo.
   */
  adminUrl: string;
  workspaceId: string;
  batchSize?: number;
  onProgress?: (processed: number) => void;
};

export type RebuildReport = { processed: number; batches: number };

/**
 * Přepočítá contact_engagement od nuly. Vzorec vlastní část 5 a tenhle modul
 * ho **neopisuje**: dvě implementace téhož agregátu se rozejdou a rozdíl se
 * pozná až na číslech u zákazníka. Tady je jen dávkování, aby přepočet
 * pěti milionů kontaktů nezastavil provoz.
 *
 * Každá dávka má vlastní transakci schválně: přepočet nad milionem kontaktů
 * by v jedné transakci držel zámky hodiny a zablokoval provoz. Přerušený běh
 * se dokončí opakovaným spuštěním, protože `recomputeContactEngagement`
 * počítá stav z dat, ne z rozdílu.
 */
export async function rebuildEngagement(input: RebuildInput): Promise<RebuildReport> {
  const batchSize = input.batchSize ?? 5000;

  const exists = await withAdminTx(input.adminUrl, async (tx) => {
    const { rows } = await tx.execute<{ id: string }>(
      sql`SELECT id FROM workspaces
           WHERE id = ${input.workspaceId} AND deleted_at IS NULL`);
    return rows.length > 0;
  });
  if (!exists) {
    throw new Error(
      `Projekt ${input.workspaceId} neexistuje. Přepočet se nespustil, aby se nulový výsledek ` +
        'nedal splést s hotovou prací.',
    );
  }

  let cursor: string | null = null;
  let processed = 0;
  let batches = 0;

  for (;;) {
    const result = await withAdminTx(input.adminUrl, (tx) =>
      recomputeContactEngagement(tx, {
        workspaceId: input.workspaceId,
        batchSize,
        cursor,
      }),
    );
    processed += result.processed;
    batches += 1;
    input.onProgress?.(processed);
    if (result.nextCursor === null) break;
    cursor = result.nextCursor;
  }

  return { processed, batches };
}
```

- [ ] **Krok 4: Napiš padající test pro upgrade**

```ts
// packages/core/test/ops/upgrade.db.test.ts
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestPostgres } from '../support/db.js';
import { ProcessesStillRunningError, runUpgrade } from '../../src/ops/upgrade.js';

let pg: TestPostgres;
let root: string;

const base = () => ({
  appUrl: pg.urlForRole('mlain_app'),
  adminUrl: pg.ownerUrl,
  backupDir: join(root, 'backups'),
  uploadsDir: join(root, 'uploads'),
  dataDir: root,
  appVersion: '1.0.0',
  secretKeyFingerprint: 'VXGoNjoPSBY',
  readinessUrl: 'http://127.0.0.1:1/api/health/ready',
  now: new Date(),
});

beforeAll(async () => {
  pg = await startTestPostgres();
  root = await mkdtemp(join(tmpdir(), 'mlain-upgrade-'));
  await pg.seedMinimalInstallation({ contacts: 2 });
}, 240_000);

afterAll(async () => {
  await pg?.stop();
});

describe('runUpgrade', () => {
  it('odmítne běžet, dokud jsou připojené worker nebo sender', async () => {
    const holder = await pg.openConnectionAs('mlain-worker');
    await expect(runUpgrade(base())).rejects.toThrow(ProcessesStillRunningError);
    await holder.close();
  });

  it('hláška jmenuje konkrétní příkazy na zastavení', async () => {
    const holder = await pg.openConnectionAs('mlain-sender');
    const err = await runUpgrade(base()).catch((e: Error) => e);
    expect(err.message).toContain('docker compose stop');
    expect(err.message).toContain('mlain-sender');
    await holder.close();
  });

  it('udělá zálohu dřív, než pustí migrace', async () => {
    const report = await runUpgrade({ ...base(), skipReadiness: true });
    expect(report.backupDir).toContain('mlain-');
    expect(report.steps.indexOf('backup')).toBeLessThan(report.steps.indexOf('migrate'));
  });

  it('vypíše přesné příkazy na návrat procesů', async () => {
    const report = await runUpgrade({ ...base(), skipReadiness: true });
    expect(report.nextSteps).toContain('docker compose up -d');
  });

  it('nespustí migrace, když záloha selže', async () => {
    await expect(
      runUpgrade({ ...base(), backupDir: '/proc/nelze/zapsat', skipReadiness: true }),
    ).rejects.toThrow();
  });
});
```

- [ ] **Krok 5: Implementuj upgrade**

```ts
// packages/core/src/ops/upgrade.ts
import { sql } from 'drizzle-orm';
import { runMigrations } from '@mlain/db/migrate';
import { runBackup } from './backup.js';
import { applyGrants } from './backup-verify.js';
import { withAdminTx } from './db.js';

/** Jména procesů, která se nastavují jako application_name podle konvence P01. */
const BLOCKING_APPLICATIONS = ['mlain-worker', 'mlain-sender'] as const;

export class ProcessesStillRunningError extends Error {
  constructor(apps: readonly string[]) {
    super(
      `Upgrade se nespustí, protože k databázi jsou pořád připojené: ${apps.join(', ')}. ` +
        'Zastavte je příkazem "docker compose stop worker sender" (při MODE=all celý kontejner ' +
        'příkazem "docker compose stop app") a spusťte mlain upgrade znovu. ' +
        'Migrace pod běžícím senderem znamená, že sender čte schéma, které se pod ním mění.',
    );
    this.name = 'ProcessesStillRunningError';
  }
}

export type UpgradeInput = {
  /** Aplikační URL. Používá se jen k tomu, aby šlo do reportu vypsat, kam míří. */
  appUrl: string;
  adminUrl: string;
  backupDir: string;
  uploadsDir: string;
  dataDir: string;
  appVersion: string;
  secretKeyFingerprint: string;
  readinessUrl: string;
  now: Date;
  skipReadiness?: boolean;
};

export type UpgradeReport = {
  steps: string[];
  backupDir: string;
  readinessOk: boolean;
  nextSteps: string;
};

/**
 * Procesy se nezastavují ani nespouštějí. Zvenčí kontejneru by to vyžadovalo
 * docker socket uvnitř kontejneru, což je root na hostiteli a zahodilo by to
 * celý bezpečnostní model (read-only rootfs, uživatel 10001). Příkaz proto
 * ověří, že procesy neběží, udělá zálohu, zmigruje, ověří readiness a vypíše
 * přesné příkazy na návrat. Odchylka od 3.14 je vědomá.
 */
export async function runUpgrade(input: UpgradeInput): Promise<UpgradeReport> {
  const steps: string[] = [];

  const running = await withAdminTx(input.adminUrl, async (tx) => {
    const { rows } = await tx.execute<{ application_name: string }>(
      sql`SELECT DISTINCT application_name
            FROM pg_stat_activity
           WHERE application_name = ANY(${sql.param([...BLOCKING_APPLICATIONS])})
             AND pid <> pg_backend_pid()`);
    return rows.map((r) => r.application_name);
  });
  if (running.length > 0) throw new ProcessesStillRunningError(running);
  steps.push('preflight');

  const backup = await runBackup({
    databaseUrl: input.adminUrl,
    backupDir: input.backupDir,
    uploadsDir: input.uploadsDir,
    appVersion: input.appVersion,
    secretKeyFingerprint: input.secretKeyFingerprint,
    now: input.now,
    postBackupHook: `${input.dataDir}/hooks/post-backup.sh`,
  });
  steps.push('backup');

  // `runMigrations` vrací `void`, ne seznam aplikovaných migrací; počet se
  // z něj přečíst nedá a upgrade ho nepotřebuje. Kdo ho chce vidět, čte
  // `schema_version` v system_settings před a po.
  await runMigrations({ url: input.adminUrl });
  steps.push('migrate');

  // Granty po migraci. Při běžném upgradu jsou už na místě a funkce je
  // idempotentní, takže neudělá nic. Rozdíl je v případě, kdy se upgraduje
  // instalace obnovená ze zálohy starším postupem: tam granty chybí a bez
  // tohohle volání by aplikace po restartu nenaběhla.
  await applyGrants(input.adminUrl);
  steps.push('grants');

  let readinessOk = false;
  if (input.skipReadiness !== true) {
    const response = await fetch(input.readinessUrl).catch(() => null);
    readinessOk = response?.ok === true;
    steps.push('readiness');
  }

  return {
    steps,
    backupDir: backup.dir,
    readinessOk,
    nextSteps: [
      'Upgrade databáze je hotový. Procesy zpět nastartujete takhle:',
      '',
      '  docker compose up -d',
      '',
      'Potom ověřte, že /api/health/ready vrací 200, a spusťte mlain doctor.',
    ].join('\n'),
  };
}
```

- [ ] **Krok 6: Implementuj oba příkazy**

```ts
// apps/cli/src/commands/rebuild-engagement.ts
import { parseArgs } from 'node:util';
import { loadConfig } from '@mlain/core/config';
import { rebuildEngagement } from '@mlain/core/ops';
import { EXIT_CONFIG, EXIT_OK, EXIT_USAGE } from '../exit-codes.js';
import type { CliStreams } from '../dispatch.js';

export async function runRebuildEngagementCommand(
  streams: CliStreams,
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      workspace: { type: 'string' },
      'batch-size': { type: 'string', default: '5000' },
    },
    allowPositionals: false,
  });
  if (!values.workspace) {
    streams.stderr('Použití: mlain rebuild-engagement --workspace <id>');
    return EXIT_USAGE;
  }
  const config = loadConfig(env);
  // Přepočet čte a zapisuje contact_engagement, contacts a message_engagement,
  // tedy tabulky s ws_isolation. Pod aplikační rolí bez kontextu by prošel,
  // zpracoval nula kontaktů a ohlásil hotovo. Proto migrátor.
  if (!config.DATABASE_URL_MIGRATOR) {
    streams.stderr(
      'Přepočet vyžaduje DATABASE_URL_MIGRATOR. Pod aplikační rolí by kvůli row level ' +
        'security zpracoval nula kontaktů a skončil hlášením „hotovo".',
    );
    return EXIT_CONFIG;
  }
  const report = await rebuildEngagement({
    adminUrl: config.DATABASE_URL_MIGRATOR,
    workspaceId: values.workspace,
    batchSize: Number(values['batch-size']),
    onProgress: (n) => streams.stdout(`Zpracováno ${n} kontaktů`),
  });
  streams.stdout(`Hotovo. Zpracováno ${report.processed} kontaktů v ${report.batches} dávkách.`);
  return EXIT_OK;
}
```

```ts
// apps/cli/src/commands/upgrade.ts
import { loadConfig } from '@mlain/core/config';
import { loadOpsKeyring, ProcessesStillRunningError, runUpgrade } from '@mlain/core/ops';
import { EXIT_CONFIG, EXIT_OK, EXIT_TEMPFAIL } from '../exit-codes.js';
import type { CliStreams } from '../dispatch.js';

export async function runUpgradeCommand(
  streams: CliStreams,
  _argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
): Promise<number> {
  const config = loadConfig(env);
  if (!config.DATABASE_URL_MIGRATOR) {
    streams.stderr('Upgrade vyžaduje DATABASE_URL_MIGRATOR.');
    return EXIT_CONFIG;
  }
  const keyring = loadOpsKeyring({
    secretKey: config.SECRET_KEY,
    secretKeyPrevious: config.SECRET_KEY_PREVIOUS,
  });
  try {
    const report = await runUpgrade({
      appUrl: config.DATABASE_URL,
      adminUrl: config.DATABASE_URL_MIGRATOR,
      backupDir: config.BACKUP_DIR,
      uploadsDir: config.UPLOADS_DIR,
      dataDir: config.DATA_DIR,
      appVersion: config.IMAGE_VERSION,
      secretKeyFingerprint: keyring.currentFingerprint,
      readinessUrl: `${config.APP_URL}/api/health/ready`,
      now: new Date(),
    });
    streams.stdout(`Záloha před upgradem: ${report.backupDir}`);
    streams.stdout(`Kroky, které proběhly: ${report.steps.join(', ')}`);
    streams.stdout(`Readiness: ${report.readinessOk ? 'v pořádku' : 'zatím ne'}`);
    streams.stdout('');
    streams.stdout(report.nextSteps);
    return EXIT_OK;
  } catch (err) {
    if (err instanceof ProcessesStillRunningError) {
      streams.stderr(err.message);
      return EXIT_TEMPFAIL;
    }
    throw err;
  }
}
```

- [ ] **Krok 7: Doplň exporty a spusť celou sadu příkazů**

```ts
// packages/core/src/ops/index.ts (doplň na konec souboru)
export { rebuildEngagement } from './rebuild-engagement.js';
export { ProcessesStillRunningError, runUpgrade } from './upgrade.js';
export { backupJob, backupVerifyJob } from './jobs/backup-jobs.js';
```

Exporty pro `genkey`, `encrypted-columns`, `rotate-credentials` a `reset-password` přibyly už v úkolech 15, 17 a 18, takže se tady neopakují. Modul `jobs/backup-jobs.js` vznikne v úkolu 20; do té doby poslední řádek zakomentuj.

Spusť: `pnpm vitest run packages/core/test/ops/rebuild-engagement.db.test.ts packages/core/test/ops/upgrade.db.test.ts apps/cli/test/commands/registration.test.ts`
Očekávej: PASS, včetně testu registrace, který je teď poprvé celý zelený (osm příkazů P16 plus `migrate` od P03).

- [ ] **Krok 8: Commit**

```bash
git add packages/core/src/ops/rebuild-engagement.ts packages/core/src/ops/upgrade.ts packages/core/src/ops/index.ts apps/cli/src/commands/rebuild-engagement.ts apps/cli/src/commands/upgrade.ts packages/core/test/ops/rebuild-engagement.db.test.ts packages/core/test/ops/upgrade.db.test.ts
git commit -m "feat(cli): add mlain rebuild-engagement and mlain upgrade"
```

---

### Úkol 20: Plánované úlohy zálohy a jejího ověření

**Soubory:**
- Vytvoř: `packages/core/src/ops/jobs/backup-jobs.ts`
- Test: `packages/core/test/ops/backup-jobs.db.test.ts`

Fronty `platform.backup` (cron `0 3 * * *`) a `platform.backup_verify` (cron `0 4 * * 0`) už v registru P01 existují a mají `owner: 'P16'`. Tenhle úkol dodává jejich těla. Registraci do `packages/core/src/platform/jobs/queue-handlers.ts` vlastní P04, viz rozhraní I→P04.3.

- [ ] **Krok 1: Napiš padající test**

```ts
// packages/core/test/ops/backup-jobs.db.test.ts
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestPostgres } from '../support/db.js';
import { QUEUES } from '@mlain/core/queues';
import { backupJob, backupVerifyJob } from '../../src/ops/jobs/backup-jobs.js';

let pg: TestPostgres;
let root: string;

const jobCtx = () => ({
  config: {
    DATABASE_URL: pg.ownerUrl,
    DATABASE_URL_MIGRATOR: pg.ownerUrl,
    BACKUP_DIR: join(root, 'backups'),
    UPLOADS_DIR: join(root, 'uploads'),
    DATA_DIR: root,
    BACKUP_RETENTION_DAYS: 14,
    IMAGE_VERSION: '1.0.0',
    SECRET_KEY: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
    SECRET_KEY_PREVIOUS: '',
  },
});

beforeAll(async () => {
  pg = await startTestPostgres();
  root = await mkdtemp(join(tmpdir(), 'mlain-jobs-'));
  await pg.seedMinimalInstallation({ contacts: 5 });
}, 240_000);

afterAll(async () => {
  await pg?.stop();
});

describe('registr front', () => {
  it('obě fronty jsou předdeklarované a patří P16', () => {
    const backup = QUEUES.find((q) => q.name === 'platform.backup');
    const verify = QUEUES.find((q) => q.name === 'platform.backup_verify');
    expect(backup?.owner).toBe('P16');
    expect(verify?.owner).toBe('P16');
    expect(backup?.cron).toBe('0 3 * * *');
  });
});

describe('backupJob', () => {
  it('vytvoří zálohu a zapíše do auditu', async () => {
    await backupJob(jobCtx());
    const entries = await readdir(join(root, 'backups'));
    expect(entries.some((e) => e.startsWith('mlain-'))).toBe(true);
    const rows = await pg.sql<{ action: string }>(
      "SELECT action FROM audit_log WHERE action = 'backup.created'",
    );
    expect(rows.length).toBe(1);
  });
});

describe('backupVerifyJob', () => {
  it('ověří poslední zálohu a zapíše výsledek do auditu', async () => {
    const report = await backupVerifyJob(jobCtx());
    expect(report.ok).toBe(true);
    const rows = await pg.sql<{ action: string }>(
      "SELECT action FROM audit_log WHERE action = 'backup.verified'",
    );
    expect(rows.length).toBe(1);
  });

  it('bez jediné zálohy skončí bez pádu a nahlásí to', async () => {
    const empty = { config: { ...jobCtx().config, BACKUP_DIR: join(root, 'nic') } };
    const report = await backupVerifyJob(empty);
    expect(report.ok).toBe(false);
    expect(report.problems.join(' ')).toMatch(/žádná záloha/i);
  });
});
```

- [ ] **Krok 2: Spusť a ověř pád**

Spusť: `pnpm vitest run packages/core/test/ops/backup-jobs.db.test.ts`
Očekávej: FAIL, modul neexistuje.

- [ ] **Krok 3: Implementuj**

```ts
// packages/core/src/ops/jobs/backup-jobs.ts
import { writeAuditLog } from '@mlain/core/audit/write';
import { listBackups, pruneBackups, runBackup } from '../backup.js';
import { withAdminTx } from '../db.js';
import { verifyBackup } from '../backup-verify.js';
import { loadOpsKeyring } from '../keyring.js';

export type BackupJobContext = {
  config: {
    DATABASE_URL: string;
    DATABASE_URL_MIGRATOR: string | undefined;
    BACKUP_DIR: string;
    UPLOADS_DIR: string;
    DATA_DIR: string;
    BACKUP_RETENTION_DAYS: number;
    IMAGE_VERSION: string;
    SECRET_KEY: string;
    SECRET_KEY_PREVIOUS: string;
  };
};

function requireAdminUrl(ctx: BackupJobContext): string {
  const url = ctx.config.DATABASE_URL_MIGRATOR;
  if (!url) {
    throw new Error(
      'Plánovaná záloha vyžaduje DATABASE_URL_MIGRATOR. Pod aplikační rolí platí row level ' +
        'security a pg_dump skončí chybou "query would be affected by row-level security policy".',
    );
  }
  return url;
}

/** Fronta `platform.backup`, cron `0 3 * * *`. Běží jen v MODE=worker a MODE=all. */
export async function backupJob(ctx: BackupJobContext): Promise<{ dir: string }> {
  const adminUrl = requireAdminUrl(ctx);
  const keyring = loadOpsKeyring({
    secretKey: ctx.config.SECRET_KEY,
    secretKeyPrevious: ctx.config.SECRET_KEY_PREVIOUS,
  });
  const now = new Date();
  const result = await runBackup({
    databaseUrl: adminUrl,
    backupDir: ctx.config.BACKUP_DIR,
    uploadsDir: ctx.config.UPLOADS_DIR,
    appVersion: ctx.config.IMAGE_VERSION,
    secretKeyFingerprint: keyring.currentFingerprint,
    now,
    postBackupHook: `${ctx.config.DATA_DIR}/hooks/post-backup.sh`,
  });
  const deleted = await pruneBackups(ctx.config.BACKUP_DIR, {
    now,
    retentionDays: ctx.config.BACKUP_RETENTION_DAYS,
  });

  // Audit se zapisuje pod migrátorem, ne pod aplikační rolí. Politika
  // ws_isolation_audit sice globální řádek s workspace_id IS NULL vloží
  // i pod mlain_app, ale job stejně migrátorské URL má a dvě různé cesty
  // k databázi v jednom souboru jsou zbytečná past.
  await withAdminTx(adminUrl, async (tx) => {
    await writeAuditLog(tx, {
      action: 'backup.created',
      workspaceId: null,
      actor: { type: 'system', job: 'platform.backup' },
      targetType: 'backup',
      targetId: null,
      metadata: {
        dir: result.dir,
        contacts: result.manifest.row_counts.contacts,
        pruned: deleted.length,
      },
    });
  });
  return { dir: result.dir };
}

/** Fronta `platform.backup_verify`, cron `0 4 * * 0`. */
export async function backupVerifyJob(
  ctx: BackupJobContext,
): Promise<{ ok: boolean; problems: string[] }> {
  const adminUrl = requireAdminUrl(ctx);
  const entries = await listBackups(ctx.config.BACKUP_DIR);
  const report =
    entries.length === 0
      ? { ok: false, problems: ['V adresáři není žádná záloha, nebylo co ověřit.'] }
      : await verifyBackup({
          backupDir: `${ctx.config.BACKUP_DIR}/${entries[0].name}`,
          adminUrl,
        });

  await withAdminTx(adminUrl, async (tx) => {
    await writeAuditLog(tx, {
      action: 'backup.verified',
      workspaceId: null,
      actor: { type: 'system', job: 'platform.backup_verify' },
      targetType: 'backup',
      targetId: null,
      metadata: { backup: entries[0]?.name ?? null, ok: report.ok, problems: report.problems },
    });
  });
  return report;
}
```

- [ ] **Krok 4: Spusť a commitni**

Spusť: `pnpm vitest run packages/core/test/ops/backup-jobs.db.test.ts`
Očekávej: PASS, 4 testy.

```bash
git add packages/core/src/ops/jobs/backup-jobs.ts packages/core/test/ops/backup-jobs.db.test.ts
git commit -m "feat(ops): add scheduled backup and backup verify job bodies"
```

---

### Úkol 21: Endpointy a obrazovka Zálohy

**Soubory:**
- Vytvoř: `apps/web/src/app/api/v1/backups/route.ts`, `apps/web/src/app/api/v1/backups/[name]/verify/route.ts`
- Vytvoř: `apps/web/src/features/backups/backup-list.tsx`, `apps/web/src/features/backups/backup-run-button.tsx`
- Vytvoř: `apps/web/src/app/[locale]/w/[workspaceSlug]/settings/backups/page.tsx`
- Test: `apps/web/src/features/backups/__tests__/backup-list.test.tsx`

Obrazovka `/w/{slug}/settings/backups` je v mapě aplikace (část 6, kapitola 4.1) i v tabulce obrazovek části 1, kapitola 5.3, ale v zadání P06 vyjmenovaná není. P16 si ji proto bere, protože zálohy jsou jeho doména.

- [ ] **Krok 1: Napiš padající test komponenty**

```tsx
// apps/web/src/features/backups/__tests__/backup-list.test.tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { BackupList } from '../backup-list.js';

const entry = {
  name: 'mlain-20260731T030000Z',
  createdAt: '2026-07-31T03:00:00.000Z',
  bytes: 184_320_000,
  contacts: 48_211,
  verifiedAt: null as string | null,
  verifiedOk: null as boolean | null,
};

describe('BackupList', () => {
  it('prázdný stav vysvětluje a nabízí akci', () => {
    render(<BackupList entries={[]} />);
    expect(screen.getByText(/Zatím žádná záloha/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Spustit zálohu/ })).toBeInTheDocument();
  });

  it('vypíše počet kontaktů v záloze, ne jen velikost souboru', () => {
    render(<BackupList entries={[entry]} />);
    expect(screen.getByText(/48\s?211/)).toBeInTheDocument();
  });

  it('neověřenou zálohu označí, místo aby mlčela', () => {
    render(<BackupList entries={[entry]} />);
    expect(screen.getByText(/Zatím neověřeno/)).toBeInTheDocument();
  });

  it('selhané ověření odliší od úspěšného', () => {
    render(
      <BackupList
        entries={[{ ...entry, verifiedAt: '2026-07-31T04:00:00.000Z', verifiedOk: false }]}
      />,
    );
    expect(screen.getByText(/selhalo/)).toBeInTheDocument();
  });

  it('trvale zobrazuje varování, že klíč v záloze není', () => {
    render(<BackupList entries={[entry]} />);
    expect(screen.getByRole('note')).toHaveTextContent(/keyring/i);
  });
});
```

- [ ] **Krok 2: Spusť a ověř pád**

Spusť: `pnpm vitest run apps/web/src/features/backups/__tests__/backup-list.test.tsx`
Očekávej: FAIL, komponenta neexistuje.

- [ ] **Krok 3: Implementuj komponenty**

```tsx
// apps/web/src/features/backups/backup-list.tsx
'use client';

import { useTranslations } from '@mlain/i18n/client';
import { Alert } from '@mlain/ui/components/alert';
import { DataTable } from '@mlain/ui/patterns/data-table';
import { EmptyState } from '@mlain/ui/patterns/states';
import { BackupRunButton } from './backup-run-button.js';

export type BackupListEntry = {
  name: string;
  createdAt: string;
  bytes: number;
  contacts: number;
  verifiedAt: string | null;
  verifiedOk: boolean | null;
};

export function BackupList({ entries }: { entries: readonly BackupListEntry[] }) {
  const t = useTranslations('onboarding.backups');

  if (entries.length === 0) {
    return (
      <EmptyState title={t('title')} description={t('empty')} action={<BackupRunButton />} />
    );
  }

  return (
    <div className="space-y-4">
      {/* `Note` v design systému neexistuje, varovný tón nese `Alert`. */}
      <Alert tone="warning">{t('keyWarning')}</Alert>
      {/* Komponenta se jmenuje `DataTable` a sloupec nese vlastní `cell`,
          tedy funkci řádek -> obsah. Starší tvar `{ id, header }` plus mapa
          `cells` na řádku neexistuje. */}
      <DataTable
        caption={t('title')}
        rows={entries}
        rowId={(e) => e.name}
        columns={[
          {
            id: 'created',
            header: t('columnCreated'),
            cell: (e) => new Date(e.createdAt).toLocaleString(),
          },
          {
            id: 'size',
            header: t('columnSize'),
            cell: (e) => `${Math.round(e.bytes / 1_000_000)} MB`,
          },
          {
            id: 'rows',
            header: t('columnRows'),
            cell: (e) => e.contacts.toLocaleString(),
          },
          {
            id: 'verified',
            header: t('columnVerified'),
            cell: (e) =>
              e.verifiedAt === null
                ? t('neverVerified')
                : e.verifiedOk
                  ? t('verifiedOk', { when: new Date(e.verifiedAt).toLocaleDateString() })
                  : t('verifiedFailed', { when: new Date(e.verifiedAt).toLocaleDateString() }),
          },
        ]}
      />
      <BackupRunButton />
    </div>
  );
}
```

```tsx
// apps/web/src/features/backups/backup-run-button.tsx
'use client';

import { useState, useTransition } from 'react';
import { useTranslations } from '@mlain/i18n/client';
import { Button } from '@mlain/ui/components/button';
import { useToast } from '@mlain/ui/patterns/toast';

export function BackupRunButton() {
  const t = useTranslations('onboarding.backups');
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [running, setRunning] = useState(false);

  return (
    <Button
      // Princip P5: tlačítko primární akce nikdy není disabled, jen mění popisek.
      onClick={() =>
        startTransition(async () => {
          setRunning(true);
          const res = await fetch('/api/v1/backups', { method: 'POST' });
          setRunning(false);
          const body = (await res.json()) as { name?: string; detail?: string };
          if (res.ok) toast.success(t('run'), { description: body.name });
          else toast.error(body.detail ?? t('run'));
        })
      }
    >
      {running || pending ? t('running') : t('run')}
    </Button>
  );
}
```

- [ ] **Krok 4: Implementuj endpointy a stránku**

```ts
// apps/web/src/app/api/v1/backups/route.ts
import { loadConfig } from '@mlain/core/config';
import { listBackups, readManifest, runBackup, loadOpsKeyring } from '@mlain/core/ops';
import { defineRoute, requirePermission } from '@/lib/api';

export const GET = defineRoute({
  summary: 'Seznam záloh instalace',
  handler: async ({ ctx }) => {
    await requirePermission(ctx, 'workspace:manage');
    const config = loadConfig();
    const entries = await listBackups(config.BACKUP_DIR);
    const data = await Promise.all(
      entries.map(async (e) => {
        const manifest = await readManifest(`${config.BACKUP_DIR}/${e.name}`).catch(() => null);
        return {
          name: e.name,
          createdAt: e.createdAt.toISOString(),
          bytes: manifest?.database.bytes ?? 0,
          contacts: manifest?.row_counts.contacts ?? 0,
          verifiedAt: null,
          verifiedOk: null,
        };
      }),
    );
    return { data };
  },
});

export const POST = defineRoute({
  summary: 'Spustí zálohu na vyžádání',
  handler: async ({ ctx, problem }) => {
    await requirePermission(ctx, 'workspace:manage');
    const config = loadConfig();
    if (!config.DATABASE_URL_MIGRATOR) {
      return problem('service_unavailable', {
        detail:
          'Záloha není nastavená: chybí DATABASE_URL_MIGRATOR. Pod aplikační rolí by vznikla záloha s nula řádky.',
      });
    }
    const keyring = loadOpsKeyring({
      secretKey: config.SECRET_KEY,
      secretKeyPrevious: config.SECRET_KEY_PREVIOUS,
    });
    const result = await runBackup({
      databaseUrl: config.DATABASE_URL_MIGRATOR,
      backupDir: config.BACKUP_DIR,
      uploadsDir: config.UPLOADS_DIR,
      appVersion: config.IMAGE_VERSION,
      secretKeyFingerprint: keyring.currentFingerprint,
      now: new Date(),
      postBackupHook: `${config.DATA_DIR}/hooks/post-backup.sh`,
    });
    return {
      status: 201,
      data: { name: result.dir.split('/').pop(), contacts: result.manifest.row_counts.contacts },
    };
  },
});
```

```ts
// apps/web/src/app/api/v1/backups/[name]/verify/route.ts
import { loadConfig } from '@mlain/core/config';
import { verifyBackup } from '@mlain/core/ops';
import { defineRoute, requirePermission } from '@/lib/api';

export const POST = defineRoute({
  summary: 'Ověří zálohu obnovou do dočasné databáze',
  handler: async ({ ctx, params, problem }) => {
    await requirePermission(ctx, 'workspace:manage');
    const config = loadConfig();
    if (!config.DATABASE_URL_MIGRATOR) {
      return problem('service_unavailable', { detail: 'Ověření vyžaduje DATABASE_URL_MIGRATOR.' });
    }
    // Jméno se skládá jen z povolených znaků, aby nešlo vyjít z adresáře záloh.
    if (!/^mlain-\d{8}T\d{6}Z$/.test(params.name)) {
      return problem('not_found', { detail: 'Taková záloha v instalaci není.' });
    }
    const report = await verifyBackup({
      backupDir: `${config.BACKUP_DIR}/${params.name}`,
      adminUrl: config.DATABASE_URL_MIGRATOR,
    });
    return { data: report };
  },
});
```

```tsx
// apps/web/src/app/[locale]/w/[workspaceSlug]/settings/backups/page.tsx
import { getTranslations } from '@mlain/i18n/server';
import { loadConfig } from '@mlain/core/config';
import { listBackups, readManifest } from '@mlain/core/ops';
import { BackupList, type BackupListEntry } from '@/features/backups/backup-list';

export default async function BackupsPage() {
  const t = await getTranslations('onboarding.backups');
  const config = loadConfig();
  const entries = await listBackups(config.BACKUP_DIR);
  const data: BackupListEntry[] = await Promise.all(
    entries.map(async (e) => {
      const manifest = await readManifest(`${config.BACKUP_DIR}/${e.name}`).catch(() => null);
      return {
        name: e.name,
        createdAt: e.createdAt.toISOString(),
        bytes: manifest?.database.bytes ?? 0,
        contacts: manifest?.row_counts.contacts ?? 0,
        verifiedAt: null,
        verifiedOk: null,
      };
    }),
  );

  return (
    <main>
      <h1>{t('title')}</h1>
      <BackupList entries={data} />
    </main>
  );
}
```

- [ ] **Krok 5: Spusť a commitni**

Spusť: `pnpm vitest run apps/web/src/features/backups/__tests__/backup-list.test.tsx`
Očekávej: PASS, 5 testů.

```bash
git add apps/web/src/app/api/v1/backups apps/web/src/features/backups apps/web/src/app/\[locale\]/w/\[workspaceSlug\]/settings/backups
git commit -m "feat(web): add backups settings screen and endpoints"
```

---

### Úkol 22: Stav onboardingu

**Soubory:**
- Vytvoř: `packages/core/src/onboarding/types.ts`, `state.ts`, `index.ts`
- Test: `packages/core/test/onboarding/state.db.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
// packages/core/test/onboarding/state.db.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestPostgres } from '../support/db.js';
import { hideOnboardingPanel, loadOnboardingState } from '../../src/onboarding/state.js';

let pg: TestPostgres;
let workspaceId: string;

beforeAll(async () => {
  pg = await startTestPostgres();
  workspaceId = (await pg.seedMinimalInstallation({ contacts: 0 })).workspaceId;
}, 180_000);

beforeEach(async () => {
  await pg.sql('DELETE FROM contacts');
  await pg.sql('DELETE FROM campaigns');
  await pg.sql('DELETE FROM templates');
  await pg.sql('DELETE FROM sending_providers');
  await pg.sql(`UPDATE workspaces SET settings = '{}'::jsonb WHERE id = $1`, [workspaceId]);
});

afterAll(async () => {
  await pg?.stop();
});

// Všechno běží pod APLIKAČNÍ rolí s nastaveným kontextem projektu, tedy
// přesně tak, jak to za běhu dělá `withWorkspace`. Pod migrátorem by testy
// prošly i tehdy, kdyby produkční kód kontext vůbec nenastavoval.
const state = (ws = workspaceId) => pg.inWorkspace(ws, (tx) => loadOnboardingState(tx, ws));

describe('loadOnboardingState', () => {
  it('na čerstvém projektu je pět kroků a žádný hotový', async () => {
    const s = await state();
    expect(s!.steps).toHaveLength(5);
    expect(s!.doneCount).toBe(0);
    expect(s!.finished).toBe(false);
    expect(s!.hidden).toBe(false);
  });

  it('kroky jsou v pořadí ze specifikace 8.1.3', async () => {
    expect((await state())!.steps.map((x) => x.id)).toEqual([
      'sending',
      'contacts',
      'template',
      'testSend',
      'firstCampaign',
    ]);
  });

  it('kontakt v projektu odškrtne krok contacts a ostatní nechá', async () => {
    await pg.sql(
      `INSERT INTO contacts (workspace_id, email, status, source, locale, timezone)
       VALUES ($1, 'kdo@example.com', 'active', 'manual', 'cs', 'Europe/Prague')`,
      [workspaceId],
    );
    const s = await state();
    expect(s!.steps.find((x) => x.id === 'contacts')?.done).toBe(true);
    expect(s!.doneCount).toBe(1);
  });

  it('ukázkový kontakt krok contacts NEodškrtne', async () => {
    await pg.sql(
      `INSERT INTO contacts (workspace_id, email, status, source, source_ref, locale, timezone)
       VALUES ($1, 'jana@example.com', 'active', 'manual', 'demo-data:v1', 'cs', 'Europe/Prague')`,
      [workspaceId],
    );
    expect((await state())!.steps.find((x) => x.id === 'contacts')?.done).toBe(false);
  });

  it('odeslaná kampaň znamená finished', async () => {
    await pg.seedSentCampaign({ workspaceId });
    const s = await state();
    expect(s!.finished).toBe(true);
  });

  it('zkušební odeslání se pozná podle messages.kind, ne podle sloupce na kampani', async () => {
    // `campaigns.last_test_sent_at` ve schématu NEEXISTUJE. Kdyby se na něj
    // dotaz vrátil, spadl by na `column ... does not exist` a shodil by
    // celý panel, ne jen jeden krok.
    const { campaignId } = await pg.seedSentCampaign({ workspaceId });
    const [contact] = await pg.sql<{ id: string }>(
      `INSERT INTO contacts (workspace_id, email, status, source, locale, timezone)
       VALUES ($1, 'test@example.com', 'active', 'manual', 'cs', 'Europe/Prague')
       RETURNING id`,
      [workspaceId],
    );
    await pg.sql(
      `INSERT INTO messages (workspace_id, campaign_id, kind, contact_id, email, status,
                             sent_at, created_at)
       VALUES ($1, $2, 'test', $3, 'test@example.com', 'sent', now(), now())`,
      [workspaceId, campaignId, contact.id],
    );
    expect((await state())!.steps.find((x) => x.id === 'testSend')?.done).toBe(true);
  });

  it('krok jde přeskočit, stav se drží a po návratu je tam pořád', async () => {
    // Na ČERSTVÉM projektu, tedy když settings je prázdný objekt. Přesně tam
    // selhává naivní jsonb_set(settings, '{onboarding,hidden}', ..., true):
    // ověřeno spuštěním, že vrátí vstup beze změny, protože create_missing
    // vytvoří jen poslední klíč cesty, ne mezilehlý objekt `onboarding`.
    const before = await pg.sql<{ settings: Record<string, unknown> }>(
      'SELECT settings FROM workspaces WHERE id = $1', [workspaceId]);
    expect(before[0].settings).toEqual({});

    await pg.inWorkspace(workspaceId, (tx) => hideOnboardingPanel(tx, workspaceId, true));
    const s = await state();
    expect(s!.hidden).toBe(true);
    expect(s!.steps).toHaveLength(5);
  });

  it('skrytí panelu nesmaže manifest ukázkových dat ani gratulaci', async () => {
    // Druhá past téhož sloupce: přepsat celý `onboarding` místo sloučení
    // by zahodilo `finishedDismissed`, a přepsat celý `settings` by zahodilo
    // `demoData`, tedy jediný způsob, jak ukázková data najít a smazat.
    await pg.sql(
      `UPDATE workspaces
          SET settings = '{"demoData":{"version":1,"contactIds":["a"]},
                           "onboarding":{"finishedDismissed":true}}'::jsonb
        WHERE id = $1`,
      [workspaceId],
    );
    await pg.inWorkspace(workspaceId, (tx) => hideOnboardingPanel(tx, workspaceId, true));
    const rows = await pg.sql<{ settings: Record<string, any> }>(
      'SELECT settings FROM workspaces WHERE id = $1', [workspaceId]);
    expect(rows[0].settings.demoData.contactIds).toEqual(['a']);
    expect(rows[0].settings.onboarding).toEqual({ finishedDismissed: true, hidden: true });
  });

  it('u neznámého projektu vrací null, ne prázdný stav', async () => {
    const unknown = '00000000-0000-7000-8000-000000000000';
    expect(await pg.inWorkspace(unknown, (tx) => loadOnboardingState(tx, unknown))).toBeNull();
  });
});
```

- [ ] **Krok 2: Spusť a ověř pád**

Spusť: `pnpm vitest run packages/core/test/onboarding/state.db.test.ts`
Očekávej: FAIL, modul neexistuje.

- [ ] **Krok 3: Založ `packages/core/src/demo/manifest.ts`, pokud ještě neexistuje**

`state.ts` z tohohle úkolu importuje konstantu `DEMO_SOURCE_REF`, kterou vlastní modul ukázkových dat. Když se úkoly provádějí v pořadí, vzniká `manifest.ts` až v úkolu 24, takže ho tady založ podle kroku 3 úkolu 24 (je to krátký soubor se zod schématem manifestu) a v úkolu 24 ho už jen ponech. Bez toho tenhle úkol neprojde typecheckem.

- [ ] **Krok 4: Implementuj typy**

```ts
// packages/core/src/onboarding/types.ts
export const ONBOARDING_STEP_IDS = [
  'sending',
  'contacts',
  'template',
  'testSend',
  'firstCampaign',
] as const;

export type OnboardingStepId = (typeof ONBOARDING_STEP_IDS)[number];

export type OnboardingStep = {
  id: OnboardingStepId;
  done: boolean;
  /** Cesta primární akce, relativní k projektu. */
  href: string;
  /** Cesta sekundární akce, jen u kroku contacts (ukázková data). */
  secondaryHref: string | null;
};

export type OnboardingState = {
  steps: OnboardingStep[];
  doneCount: number;
  total: number;
  finished: boolean;
  hidden: boolean;
  /** Jednorázová gratulace se zavírá nadobro, na rozdíl od skrytí panelu. */
  finishedDismissed: boolean;
};
```

- [ ] **Krok 5: Implementuj výpočet stavu**

```ts
// packages/core/src/onboarding/state.ts
import { sql } from 'drizzle-orm';
import type { Tx } from '@mlain/db';
import { DEMO_SOURCE_REF } from '../demo/manifest.js';
import { ONBOARDING_STEP_IDS, type OnboardingState, type OnboardingStep } from './types.js';

type Flags = {
  hasProvider: boolean;
  hasRealContacts: boolean;
  hasTemplate: boolean;
  hasTestSend: boolean;
  hasSentCampaign: boolean;
};

/**
 * VŠECHNY funkce v tomhle souboru berou `tx: Tx`, ne URL databáze.
 *
 * Je to jediná bezpečná varianta a plyne přímo z izolace projektů: každá
 * tabulka, na kterou se tady sahá, má politiku `ws_isolation` a `workspaces`
 * má `ws_isolation_self`. Bez nastaveného `mlain.workspace_id` vrátí dotaz
 * NULA ŘÁDKŮ, exit 0 a žádnou chybu, takže by panel onboardingu ukazoval
 * pět neodškrtnutých kroků i v projektu, kde je hotovo všechno, a nikdo by
 * se nedozvěděl proč.
 *
 * Kontext nastavuje volající přes `withWorkspace(pool, ctx, tx => ...)`,
 * tedy tatáž obálka, kterou používá zbytek aplikace. Ověřeno spuštěním:
 * táž tabulka vrací 3 řádky uvnitř `withWorkspace` a 0 mimo něj.
 *
 * Ukázkové kontakty krok „Přidejte kontakty" schválně neodškrtávají. Ukázková
 * data mají ukázat, jak produkt vypadá, ne předstírat, že je nastavení hotové.
 * Kdyby se krok odškrtl, uživatel by dostal zelenou fajfku za práci,
 * kterou neudělal, a přišel by o jediné vodítko, co ještě chybí.
 */
async function loadFlags(tx: Tx, workspaceId: string): Promise<Flags | null> {
  const { rows: ws } = await tx.execute<{ id: string }>(
    sql`SELECT id FROM workspaces WHERE id = ${workspaceId} AND deleted_at IS NULL`);
  if (ws.length === 0) return null;

  // Zkušební odeslání se pozná podle outboxu, ne podle sloupce na kampani:
  // `campaigns.last_test_sent_at` ve schématu NEEXISTUJE. P03 má pro tenhle
  // účel `messages.kind` s hodnotami 'campaign' a 'test' (jeho rozhodnutí R2)
  // a částečný index nad pending testy. Zavádět kvůli tomu nový sloupec by
  // znamenalo migraci, kterou vlastní P03, a sender by do něj stejně nesměl
  // zapsat: na `campaigns` má jen sloupcový UPDATE na status a pause_reason.
  const { rows } = await tx.execute<{
    providers: number;
    real_contacts: number;
    templates: number;
    test_sends: number;
    sent_campaigns: number;
  }>(sql`
    SELECT
      (SELECT count(*) FROM sending_providers WHERE workspace_id = ${workspaceId})::int
        AS providers,
      (SELECT count(*) FROM contacts
        WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL
          AND source_ref IS DISTINCT FROM ${DEMO_SOURCE_REF})::int AS real_contacts,
      (SELECT count(*) FROM templates
        WHERE workspace_id = ${workspaceId} AND deleted_at IS NULL)::int AS templates,
      (SELECT count(*) FROM messages
        WHERE workspace_id = ${workspaceId} AND kind = 'test'
          AND sent_at IS NOT NULL)::int AS test_sends,
      (SELECT count(*) FROM campaigns
        WHERE workspace_id = ${workspaceId}
          AND status IN ('sending','sent'))::int AS sent_campaigns`);

  return {
    hasProvider: rows[0].providers > 0,
    hasRealContacts: rows[0].real_contacts > 0,
    hasTemplate: rows[0].templates > 0,
    hasTestSend: rows[0].test_sends > 0,
    hasSentCampaign: rows[0].sent_campaigns > 0,
  };
}

async function loadPanelFlags(
  tx: Tx,
  workspaceId: string,
): Promise<{ hidden: boolean; finishedDismissed: boolean }> {
  const { rows } = await tx.execute<{ settings: Record<string, unknown> }>(
    sql`SELECT settings FROM workspaces WHERE id = ${workspaceId}`);
  const onboarding = (rows[0]?.settings.onboarding ?? {}) as {
    hidden?: boolean;
    finishedDismissed?: boolean;
  };
  return {
    hidden: onboarding.hidden === true,
    finishedDismissed: onboarding.finishedDismissed === true,
  };
}

export async function loadOnboardingState(
  tx: Tx,
  workspaceId: string,
): Promise<OnboardingState | null> {
  const flags = await loadFlags(tx, workspaceId);
  if (flags === null) return null;
  const panel = await loadPanelFlags(tx, workspaceId);

  const done: Record<(typeof ONBOARDING_STEP_IDS)[number], boolean> = {
    sending: flags.hasProvider,
    contacts: flags.hasRealContacts,
    template: flags.hasTemplate,
    testSend: flags.hasTestSend,
    firstCampaign: flags.hasSentCampaign,
  };
  const href: Record<(typeof ONBOARDING_STEP_IDS)[number], string> = {
    sending: 'settings/sending',
    contacts: 'contacts/import',
    template: 'templates/new',
    testSend: 'campaigns',
    firstCampaign: 'campaigns',
  };

  const steps: OnboardingStep[] = ONBOARDING_STEP_IDS.map((id) => ({
    id,
    done: done[id],
    href: href[id],
    secondaryHref: id === 'contacts' ? 'contacts?demo=1' : null,
  }));

  return {
    steps,
    doneCount: steps.filter((s) => s.done).length,
    total: steps.length,
    finished: flags.hasSentCampaign,
    hidden: panel.hidden,
    finishedDismissed: panel.finishedDismissed,
  };
}

/**
 * POZOR na `jsonb_set` a chybějící mezistupeň. Ověřeno spuštěním proti
 * PostgreSQL 18:
 *
 *   jsonb_set('{}', '{onboarding,hidden}', to_jsonb(true), true)  ->  {}
 *
 * Čtvrtý argument `create_missing` vytvoří jen **poslední** klíč cesty, ne
 * mezilehlé objekty. Na čerstvém projektu je `settings` prázdný objekt, takže
 * by skrytí panelu **tiše neudělalo nic**: UPDATE by proběhl, ovlivnil jeden
 * řádek, vrátil nulový kód a hodnota by se neuložila. Uživatel by panel skryl,
 * po prvním načtení stránky by se vrátil a nikde by nebyla chyba.
 *
 * Správný tvar sloučí podobjekt operátorem `||` a chybějící mezistupeň
 * nahradí prázdným objektem. Ověřeno spuštěním, že zachová sourozence:
 * `demoData` i `finishedDismissed` v settings zůstanou.
 */
async function mergeOnboardingSettings(
  tx: Tx,
  workspaceId: string,
  patch: Record<string, boolean>,
): Promise<void> {
  await tx.execute(sql`
    UPDATE workspaces
       SET settings = jsonb_set(
             settings,
             '{onboarding}',
             coalesce(settings -> 'onboarding', '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb,
             true),
           updated_at = now()
     WHERE id = ${workspaceId}`);
}

export async function hideOnboardingPanel(
  tx: Tx,
  workspaceId: string,
  hidden: boolean,
): Promise<void> {
  await mergeOnboardingSettings(tx, workspaceId, { hidden });
}

export async function dismissFinishedBanner(tx: Tx, workspaceId: string): Promise<void> {
  await mergeOnboardingSettings(tx, workspaceId, { finishedDismissed: true });
}
```

```ts
// packages/core/src/onboarding/index.ts
export {
  dismissFinishedBanner,
  hideOnboardingPanel,
  loadOnboardingState,
} from './state.js';
export { ONBOARDING_STEP_IDS } from './types.js';
export type { OnboardingState, OnboardingStep, OnboardingStepId } from './types.js';
```

- [ ] **Krok 6: Spusť a commitni**

Spusť: `pnpm vitest run packages/core/test/onboarding/state.db.test.ts`
Očekávej: PASS, 9 testů.

```bash
git add packages/core/src/onboarding packages/core/test/onboarding
git commit -m "feat(onboarding): compute first-run checklist state from the database"
```

---

### Úkol 23: Panel onboardingu a jeho endpointy

**Soubory:**
- Vytvoř: `apps/web/src/app/api/v1/onboarding/route.ts`, `apps/web/src/app/api/v1/onboarding/hide/route.ts`
- Vytvoř: `apps/web/src/features/onboarding/onboarding-panel.tsx`, `onboarding-step-row.tsx`
- Test: `apps/web/src/features/onboarding/__tests__/onboarding-panel.test.tsx`

- [ ] **Krok 1: Napiš padající test**

```tsx
// apps/web/src/features/onboarding/__tests__/onboarding-panel.test.tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { OnboardingPanel } from '../onboarding-panel.js';

const state = {
  steps: [
    { id: 'sending', done: false, href: 'settings/sending', secondaryHref: null },
    { id: 'contacts', done: false, href: 'contacts/import', secondaryHref: 'contacts?demo=1' },
    { id: 'template', done: false, href: 'templates/new', secondaryHref: null },
    { id: 'testSend', done: false, href: 'campaigns', secondaryHref: null },
    { id: 'firstCampaign', done: false, href: 'campaigns', secondaryHref: null },
  ],
  doneCount: 0,
  total: 5,
  finished: false,
  hidden: false,
  finishedDismissed: false,
} as const;

describe('OnboardingPanel', () => {
  it('vypíše všech pět kroků s odhadem času', () => {
    render(<OnboardingPanel state={state} slug="e-shop" />);
    expect(screen.getByRole('heading', { name: /Vaše první kampaň/ })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(5);
    expect(screen.getByText(/asi 10 min/)).toBeInTheDocument();
  });

  it('u kroku s kontakty nabízí i ukázková data jako rovnocennou cestu', () => {
    render(<OnboardingPanel state={state} slug="e-shop" />);
    expect(screen.getByRole('link', { name: /Ukázková/ })).toBeInTheDocument();
  });

  it('panel jde skrýt, ne zavřít, a po skrytí zůstane řádek se stavem', async () => {
    const onHide = vi.fn();
    render(<OnboardingPanel state={state} slug="e-shop" onHide={onHide} />);
    await userEvent.click(screen.getByRole('button', { name: /Skrýt/ }));
    expect(onHide).toHaveBeenCalledWith(true);
  });

  it('ve skrytém stavu ukazuje počet hotových kroků a tlačítko Zobrazit', () => {
    render(<OnboardingPanel state={{ ...state, hidden: true, doneCount: 2 }} slug="e-shop" />);
    expect(screen.getByText(/2 z 5 hotovo/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Zobrazit/ })).toBeInTheDocument();
  });

  it('po dokončení ukazuje jednorázovou gratulaci, kterou jde zavřít nadobro', () => {
    render(
      <OnboardingPanel
        state={{ ...state, finished: true, doneCount: 5 }}
        slug="e-shop"
      />,
    );
    expect(screen.getByText(/Hotovo, první kampaň odeslána/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Zavřít/ })).toBeInTheDocument();
  });

  it('hotový krok je označený i pro čtečku obrazovky, ne jen barvou', () => {
    render(
      <OnboardingPanel
        state={{ ...state, steps: [{ ...state.steps[0], done: true }, ...state.steps.slice(1)] }}
        slug="e-shop"
      />,
    );
    expect(screen.getAllByRole('listitem')[0]).toHaveAttribute('aria-current', 'false');
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent(/hotovo/i);
  });

  it('po zavření gratulace se nic nevykreslí', () => {
    const { container } = render(
      <OnboardingPanel
        state={{ ...state, finished: true, doneCount: 5, finishedDismissed: true }}
        slug="e-shop"
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
```

- [ ] **Krok 2: Spusť a ověř pád**

Spusť: `pnpm vitest run apps/web/src/features/onboarding/__tests__/onboarding-panel.test.tsx`
Očekávej: FAIL, komponenta neexistuje.

- [ ] **Krok 3: Implementuj řádek kroku**

```tsx
// apps/web/src/features/onboarding/onboarding-step-row.tsx
'use client';

import Link from 'next/link';
import { useTranslations } from '@mlain/i18n/client';
import type { OnboardingStep } from '@mlain/core/onboarding';

export function OnboardingStepRow({ step, slug }: { step: OnboardingStep; slug: string }) {
  const t = useTranslations(`onboarding.steps.${step.id}`);
  const shared = useTranslations('onboarding');

  return (
    <li aria-current="false" className="flex items-start gap-3 py-3">
      <span aria-hidden="true">{step.done ? '✓' : '○'}</span>
      <span className="sr-only">{step.done ? shared('panel.finished') : ''}</span>
      <div className="flex-1">
        <p className="font-medium">
          {t('title')}
          {step.done ? <span className="sr-only"> hotovo</span> : null}
        </p>
        <p className="text-sm text-muted">{t('description')}</p>
      </div>
      <span className="text-sm text-muted">{t('estimate')}</span>
      <Link href={`/w/${slug}/${step.href}`}>{t('action')}</Link>
      {step.secondaryHref ? (
        <Link href={`/w/${slug}/${step.secondaryHref}`}>{t('secondaryAction')}</Link>
      ) : null}
    </li>
  );
}
```

- [ ] **Krok 4: Implementuj panel**

```tsx
// apps/web/src/features/onboarding/onboarding-panel.tsx
'use client';

import { useTranslations } from '@mlain/i18n/client';
import type { OnboardingState } from '@mlain/core/onboarding';
import { Button } from '@mlain/ui/components/button';
import { cn } from '@mlain/ui/lib/cn';
import { OnboardingStepRow } from './onboarding-step-row.js';

/**
 * `Panel` v design systému neexistuje a P05 ho zakládat nebude (požadavek
 * P05→P16.3), takže se skládá tady z primitiv. Je to obyčejný rám se třemi
 * tóny, žádné chování, takže vlastní komponenta v `packages/ui` by byla
 * devátým prvkem katalogu kvůli jednomu použití.
 */
function Panel({
  tone = 'default',
  children,
}: {
  tone?: 'default' | 'success' | 'muted';
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        'rounded-[var(--radius-surface)] border p-4',
        tone === 'success' && 'border-[var(--color-success-border)] bg-[var(--color-success-bg)]',
        tone === 'muted' && 'border-[var(--color-border)] bg-[var(--color-surface-muted)]',
        tone === 'default' && 'border-[var(--color-border)] bg-[var(--color-surface)]',
      )}
    >
      {children}
    </section>
  );
}

export type OnboardingPanelProps = {
  state: OnboardingState;
  slug: string;
  onHide?: (hidden: boolean) => void;
  onDismiss?: () => void;
};

async function postHidden(hidden: boolean): Promise<void> {
  await fetch('/api/v1/onboarding/hide', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ hidden }),
  });
}

/**
 * Trvalý panel místo prohlídky s bublinami. Prohlídku uživatel zavře a už ji
 * nikdy neuvidí; seznam zůstane, dá se k němu vrátit a je vidět, co zbývá.
 * Panel proto jde jen skrýt, ne zavřít. Nadobro se zavírá až jednorázová
 * gratulace po odeslání první kampaně.
 */
export function OnboardingPanel({ state, slug, onHide, onDismiss }: OnboardingPanelProps) {
  const t = useTranslations('onboarding.panel');

  if (state.finished && state.finishedDismissed) return null;

  if (state.finished) {
    return (
      <Panel tone="success">
        <p>{t('finished')}</p>
        <Button
          variant="ghost"
          onClick={() => {
            onDismiss?.();
            void fetch('/api/v1/onboarding/hide', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ dismissFinished: true }),
            });
          }}
        >
          {t('finishedDismiss')}
        </Button>
      </Panel>
    );
  }

  if (state.hidden) {
    return (
      <Panel tone="muted">
        <p>{t('collapsed', { done: state.doneCount, total: state.total })}</p>
        <Button
          variant="ghost"
          onClick={() => {
            onHide?.(false);
            void postHidden(false);
          }}
        >
          {t('show')}
        </Button>
      </Panel>
    );
  }

  return (
    <Panel>
      <div className="flex items-center justify-between">
        <h2>{t('title')}</h2>
        <Button
          variant="ghost"
          onClick={() => {
            onHide?.(true);
            void postHidden(true);
          }}
        >
          {t('hide')}
        </Button>
      </div>
      <p className="text-sm text-muted">{t('remaining', { count: state.total - state.doneCount })}</p>
      <ol>
        {state.steps.map((step) => (
          <OnboardingStepRow key={step.id} step={step} slug={slug} />
        ))}
      </ol>
    </Panel>
  );
}
```

- [ ] **Krok 5: Implementuj endpointy**

**Endpointy otevírají transakci přes `withWorkspace`, ne vlastní spojení.** Adaptér `packages/core/tx` od P04 drží aplikační pool a doplňuje ho do obálek P03, takže volající předává jen kontext. Bez té obálky by se `mlain.workspace_id` nenastavil, RLS by odfiltrovala všechno a panel by v hotovém projektu ukazoval pět neodškrtnutých kroků.

```ts
// apps/web/src/app/api/v1/onboarding/route.ts
import { loadOnboardingState } from '@mlain/core/onboarding';
import { withWorkspace } from '@mlain/core/tx';
import { defineRoute } from '@/lib/api';

export const GET = defineRoute({
  summary: 'Stav průvodce prvním spuštěním pro aktuální projekt',
  handler: async ({ ctx, problem }) => {
    const state = await withWorkspace(ctx, (tx) => loadOnboardingState(tx, ctx.workspaceId));
    if (state === null) return problem('not_found');
    return { data: state };
  },
});
```

```ts
// apps/web/src/app/api/v1/onboarding/hide/route.ts
import { z } from 'zod';
import { dismissFinishedBanner, hideOnboardingPanel } from '@mlain/core/onboarding';
import { withWorkspace } from '@mlain/core/tx';
import { defineRoute } from '@/lib/api';

const body = z
  .object({ hidden: z.boolean().optional(), dismissFinished: z.boolean().optional() })
  .strict();

export const POST = defineRoute({
  summary: 'Skryje nebo znovu zobrazí panel onboardingu',
  body,
  handler: async ({ ctx, input }) => {
    // Obojí v JEDNÉ transakci. Dva zápisy do téhož jsonb sloupce ve dvou
    // transakcích by se navzájem přepsaly, protože jsonb_set čte celou hodnotu.
    await withWorkspace(ctx, async (tx) => {
      if (input.dismissFinished === true) await dismissFinishedBanner(tx, ctx.workspaceId);
      if (typeof input.hidden === 'boolean') {
        await hideOnboardingPanel(tx, ctx.workspaceId, input.hidden);
      }
    });
    return { status: 204 };
  },
});
```

- [ ] **Krok 6: Spusť a commitni**

Spusť: `pnpm vitest run apps/web/src/features/onboarding/__tests__/onboarding-panel.test.tsx`
Očekávej: PASS, 7 testů.

```bash
git add apps/web/src/features/onboarding apps/web/src/app/api/v1/onboarding
git commit -m "feat(onboarding): add first-run checklist panel and its endpoints"
```

---

### Úkol 24: Datová sada ukázkových dat

**Soubory:**
- Vytvoř: `packages/core/src/demo/dataset.ts`, `packages/core/src/demo/manifest.ts`
- Test: `packages/core/test/demo/dataset.test.ts`

**Rozhodnutí A11: seed píše přímo SQL, nevolá doménové funkce ostatních plánů.** Vokativ, štítky, seznamy a kampaň se zapisují hotové, s hodnotami napevno v datové sadě. Dvě věci tím získáme. Za prvé je sada deterministická a nezávisí na tom, jestli se signatura funkce v P07 nebo P13 změnila. Za druhé je vidět, jak správný vokativ vypadá, protože je v souboru černé na bílém, a když se algoritmus rozejde, pozná se to.

- [ ] **Krok 1: Napiš padající test**

```ts
// packages/core/test/demo/dataset.test.ts
import { describe, expect, it } from 'vitest';
import {
  DEMO_CAMPAIGN,
  DEMO_CONTACTS,
  DEMO_LISTS,
  DEMO_SEGMENTS,
  DEMO_TAGS,
  DEMO_TEMPLATES,
  demoCampaignSentAt,
} from '../../src/demo/dataset.js';
import {
  DEMO_SOURCE_REF,
  DEMO_SOURCE_REF_PATTERN,
  DEMO_SOURCE_REF_PREFIX,
} from '../../src/demo/manifest.js';

describe('DEMO_CONTACTS', () => {
  it('má přesně 50 kontaktů podle rozhodnutí zadavatele', () => {
    expect(DEMO_CONTACTS).toHaveLength(50);
  });

  it('všechny adresy jsou na example.com, takže se na ně nedá nic doručit', () => {
    for (const c of DEMO_CONTACTS) expect(c.email).toMatch(/@example\.com$/);
  });

  it('adresy jsou unikátní', () => {
    expect(new Set(DEMO_CONTACTS.map((c) => c.email)).size).toBe(50);
  });

  it('obsahuje jména, na kterých je vidět vokativ a rod', () => {
    const full = DEMO_CONTACTS.map((c) => `${c.titlePrefix ?? ''} ${c.firstName} ${c.lastName}`.trim());
    expect(full).toContain('Jana Nováková');
    expect(full).toContain('Ondřej Dvořák');
    expect(full).toContain('Ing. Petr Svoboda');
    expect(full).toContain('Lucie Černá');
  });

  it('u každého kontaktu je oslovení předpočítané a odpovídá rodu', () => {
    const jana = DEMO_CONTACTS.find((c) => c.email === 'jana.novakova@example.com')!;
    expect(jana.gender).toBe('female');
    expect(jana.greeting).toBe('Dobrý den, Jano');
    const ondrej = DEMO_CONTACTS.find((c) => c.firstName === 'Ondřej')!;
    expect(ondrej.greeting).toBe('Dobrý den, Ondřeji');
  });

  it('obsahuje aspoň jeden kontakt s neurčeným rodem a neutrálním oslovením', () => {
    const neutral = DEMO_CONTACTS.filter((c) => c.gender === 'unknown');
    expect(neutral.length).toBeGreaterThan(0);
    for (const c of neutral) expect(c.greeting).toBe('Dobrý den');
  });

  it('obsahuje kontakt bez křestního jména, aby byl vidět fallback', () => {
    expect(DEMO_CONTACTS.some((c) => c.firstName === null)).toBe(true);
  });

  it('všechny kontakty nesou zdroj demo-data:v1', () => {
    for (const c of DEMO_CONTACTS) expect(c.sourceRef).toBe('demo-data:v1');
  });
});

describe('zbytek sady', () => {
  it('má 3 seznamy, 4 štítky, 2 segmenty, 2 šablony a 1 kampaň', () => {
    expect(DEMO_LISTS).toHaveLength(3);
    expect(DEMO_TAGS).toHaveLength(4);
    expect(DEMO_SEGMENTS).toHaveLength(2);
    expect(DEMO_TEMPLATES).toHaveLength(2);
    expect(DEMO_CAMPAIGN.subject.length).toBeGreaterThan(0);
  });

  it('kampaň má report s otevřeními, kliky, dvěma nedoručeními a jednou stížností', () => {
    // Dvě nedoručení dohromady, ale rozdělená: campaign_stats má
    // `bounced_hard` a `bounced_soft`, sloupec `bounced` neexistuje.
    // Jedno tvrdé a jedno měkké je navíc věrnější než dvě stejná.
    const { bouncedHard, bouncedSoft } = DEMO_CAMPAIGN.stats;
    expect(bouncedHard + bouncedSoft).toBe(2);
    expect(DEMO_CAMPAIGN.stats.complained).toBe(1);
    expect(DEMO_CAMPAIGN.stats.openedUnique).toBeGreaterThan(0);
    expect(DEMO_CAMPAIGN.stats.clickedUnique).toBeGreaterThan(0);
  });

  it('součty reportu nepřesahují počet příjemců', () => {
    const { sent, openedUnique, clickedUnique, bouncedHard, bouncedSoft, complained } =
      DEMO_CAMPAIGN.stats;
    expect(sent).toBeLessThanOrEqual(DEMO_CONTACTS.length);
    expect(openedUnique + bouncedHard + bouncedSoft).toBeLessThanOrEqual(sent);
    expect(clickedUnique).toBeLessThanOrEqual(openedUnique);
    expect(complained).toBeLessThanOrEqual(sent);
  });

  it('každý štítek, seznam a šablona má klíč, na který se dá odkázat', () => {
    // `key` je jen vazba uvnitř sady, do databáze nejde. Kdyby chyběl,
    // seed by nedohledal štítek kontaktu ani šablonu kampaně a vložil by NULL.
    for (const item of [...DEMO_TAGS, ...DEMO_LISTS, ...DEMO_TEMPLATES, ...DEMO_SEGMENTS]) {
      expect(item.key).toMatch(/^[a-z0-9-]+$/);
    }
    const templateKeys = DEMO_TEMPLATES.map((t) => t.key);
    expect(templateKeys).toContain(DEMO_CAMPAIGN.templateKey);
    const tagKeys = new Set(DEMO_TAGS.map((t) => t.key));
    const listKeys = new Set(DEMO_LISTS.map((l) => l.key));
    for (const contact of DEMO_CONTACTS) {
      for (const k of contact.tagKeys) expect(tagKeys.has(k)).toBe(true);
      for (const k of contact.listKeys) expect(listKeys.has(k)).toBe(true);
    }
  });

  it('štítek Ukázková data je v sadě, protože na něm stojí hromadný výběr', () => {
    expect(DEMO_TAGS.map((t) => t.name)).toContain('Ukázková data');
  });
});

describe('konvence source_ref, na které stojí ochrana publika v P13', () => {
  // Tenhle blok je smlouva s P13. Vynucení ochrany „ukázkové kontakty nejdou
  // do publika kampaně" leží v materializaci publika, tedy v souborech P13,
  // ale konvenci vlastní tenhle plán. Testy se proto ptají konstant, které
  // P13 importuje, ne našeho seedu.
  //
  // P13 ověřil spuštěním, proč ochrana potřebuje manifest I značku: na
  // 200 000 kontaktech s 50 ukázkovými, u kterých deset mělo přepsaný
  // source_ref, propustil filtr jen podle značky deset kontaktů do publika.

  it('značka i vzor stojí na jednom prefixu, ne na dvou opsaných řetězcích', () => {
    expect(DEMO_SOURCE_REF.startsWith(DEMO_SOURCE_REF_PREFIX)).toBe(true);
    expect(DEMO_SOURCE_REF_PATTERN).toBe(`${DEMO_SOURCE_REF_PREFIX}%`);
  });

  it('vzor chytí i budoucí pokolení sady, ne jen v1', () => {
    // Ochrana nesmí přestat platit tím, že se vydá demo-data:v2.
    const like = (value: string) =>
      new RegExp(`^${DEMO_SOURCE_REF_PATTERN.replace('%', '.*')}$`).test(value);
    expect(like('demo-data:v1')).toBe(true);
    expect(like('demo-data:v2')).toBe(true);
    expect(like('demo-data:v10')).toBe(true);
    // A nesmí chytit cizí značky, jinak by vyhodila skutečné kontakty z publika.
    expect(like('import:2026-07')).toBe(false);
    expect(like('demo')).toBe(false);
    expect(like('')).toBe(false);
  });

  it('seed značkuje kontakty tak, aby je ten vzor našel', () => {
    expect(DEMO_SOURCE_REF).toMatch(/^demo-data:v\d+$/);
  });
});

describe('demoCampaignSentAt', () => {
  it('běžně datuje kampaň tři dny zpět', () => {
    const now = new Date('2026-08-20T10:00:00.000Z');
    expect(demoCampaignSentAt(now).toISOString()).toBe('2026-08-17T10:00:00.000Z');
  });

  it('na začátku měsíce ořízne na první den měsíce, aby se trefil do partition', () => {
    const now = new Date('2026-08-01T10:00:00.000Z');
    expect(demoCampaignSentAt(now).toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('nikdy nevrátí datum z minulého měsíce', () => {
    for (const day of [1, 2, 3, 4, 15, 28]) {
      const now = new Date(Date.UTC(2026, 7, day, 6, 0, 0));
      expect(demoCampaignSentAt(now).getUTCMonth()).toBe(7);
    }
  });
});
```

- [ ] **Krok 2: Spusť a ověř pád**

Spusť: `pnpm vitest run packages/core/test/demo/dataset.test.ts`
Očekávej: FAIL, modul neexistuje.

- [ ] **Krok 3: Implementuj manifest**

```ts
// packages/core/src/demo/manifest.ts
import { z } from 'zod';

/**
 * Značka v `contacts.source_ref`. Model kontaktu v části 2 nemá pole pro
 * ukázkovost a nové pole by znamenalo migraci, kterou vlastní P03. Volný
 * textový `source_ref` je proto autoritativní značka a štítek je jen pohodlí
 * pro hromadný výběr v tabulce.
 */
export const DEMO_SOURCE_REF_PREFIX = 'demo-data:';
export const DEMO_SOURCE_REF = `${DEMO_SOURCE_REF_PREFIX}v1`;
export const DEMO_MANIFEST_VERSION = 1;

/**
 * Vzor pro `LIKE`, kterým se ukázkové kontakty poznají **napříč pokoleními sady**.
 *
 * Existuje tady, protože konvenci `source_ref` vlastní tenhle plán, a vynucuje
 * ji P13 v materializaci publika. Kdyby si P13 psal `'demo-data:%'` k sobě
 * (a v jednu chvíli to dělal), žil by prefix `demo-data:` na dvou místech
 * a při první změně konvence by ochrana **tiše přestala platit**: dotaz by
 * proběhl, nikoho nevyloučil a ukázkové kontakty by se dostaly do publika.
 *
 * P13 ověřil spuštěním, proč ochrana potřebuje obojí: na 200 000 kontaktech
 * s 50 ukázkovými, u kterých deset mělo přepsaný `source_ref`, propustil filtr
 * jen podle značky **deset kontaktů do publika**. Manifest je autoritativní
 * pro rozsah sady, značka je záchytná síť pro kontakty mimo manifest.
 */
export const DEMO_SOURCE_REF_PATTERN = `${DEMO_SOURCE_REF_PREFIX}%`;

export const demoManifestSchema = z.object({
  version: z.literal(DEMO_MANIFEST_VERSION),
  seededAt: z.iso.datetime(),
  contactIds: z.array(z.uuid()),
  listIds: z.array(z.uuid()),
  tagIds: z.array(z.uuid()),
  segmentIds: z.array(z.uuid()),
  templateIds: z.array(z.uuid()),
  campaignIds: z.array(z.uuid()),
});

export type DemoManifest = z.infer<typeof demoManifestSchema>;

export function parseDemoManifest(value: unknown): DemoManifest | null {
  const result = demoManifestSchema.safeParse(value);
  return result.success ? result.data : null;
}

export function emptyDemoManifest(seededAt: Date): DemoManifest {
  return {
    version: DEMO_MANIFEST_VERSION,
    seededAt: seededAt.toISOString(),
    contactIds: [],
    listIds: [],
    tagIds: [],
    segmentIds: [],
    templateIds: [],
    campaignIds: [],
  };
}
```

- [ ] **Krok 4: Implementuj datovou sadu**

```ts
// packages/core/src/demo/dataset.ts
import { DEMO_SOURCE_REF } from './manifest.js';

export type DemoGender = 'male' | 'female' | 'unknown';

export type DemoContact = {
  firstName: string | null;
  lastName: string | null;
  titlePrefix: string | null;
  gender: DemoGender;
  email: string;
  /** Předpočítané oslovení, aby bylo v souboru vidět, jak správný vokativ vypadá. */
  greeting: string;
  city: string;
  listKeys: readonly string[];
  tagKeys: readonly string[];
  sourceRef: string;
};

const female = (
  firstName: string,
  lastName: string,
  vocative: string,
  city: string,
  lists: readonly string[],
  tags: readonly string[],
  titlePrefix: string | null = null,
): DemoContact => ({
  firstName,
  lastName,
  titlePrefix,
  gender: 'female',
  email: `${slug(firstName)}.${slug(lastName)}@example.com`,
  greeting: `Dobrý den, ${vocative}`,
  city,
  listKeys: lists,
  tagKeys: tags,
  sourceRef: DEMO_SOURCE_REF,
});

const male = (
  firstName: string,
  lastName: string,
  vocative: string,
  city: string,
  lists: readonly string[],
  tags: readonly string[],
  titlePrefix: string | null = null,
): DemoContact => ({
  firstName,
  lastName,
  titlePrefix,
  gender: 'male',
  email: `${slug(firstName)}.${slug(lastName)}@example.com`,
  greeting: `Dobrý den, ${vocative}`,
  city,
  listKeys: lists,
  tagKeys: tags,
  sourceRef: DEMO_SOURCE_REF,
});

function slug(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
}

const ALL = ['zakaznici'] as const;
const NEWS = ['novinky'] as const;
const VIP = ['vip'] as const;

/**
 * Padesát kontaktů. Specifikace 8.1.4 mluví o dvou stech, zadavatel rozhodl
 * pro padesát (rozhodnutí Z1 v kapitole 0.3 plánu). Není to opomenutí.
 *
 * Adresy jsou výhradně na example.com podle RFC 2606, takže se na ně fyzicky
 * nedá nic doručit ani omylem.
 */
export const DEMO_CONTACTS: readonly DemoContact[] = [
  female('Jana', 'Nováková', 'Jano', 'Praha', [...ALL, ...NEWS], ['ukazkova-data', 'praha']),
  male('Ondřej', 'Dvořák', 'Ondřeji', 'Brno', [...ALL, ...NEWS], ['ukazkova-data', 'brno']),
  male('Petr', 'Svoboda', 'Petře', 'Praha', [...ALL, ...VIP], ['ukazkova-data', 'praha'], 'Ing.'),
  female('Lucie', 'Černá', 'Lucie', 'Ostrava', [...ALL], ['ukazkova-data']),
  female('Eva', 'Procházková', 'Evo', 'Plzeň', [...ALL, ...NEWS], ['ukazkova-data']),
  male('Jakub', 'Kučera', 'Jakube', 'Brno', [...ALL], ['ukazkova-data', 'brno']),
  female('Tereza', 'Veselá', 'Terezo', 'Praha', [...ALL, ...NEWS], ['ukazkova-data', 'praha']),
  male('Martin', 'Horák', 'Martine', 'Liberec', [...ALL], ['ukazkova-data']),
  female('Kateřina', 'Němcová', 'Kateřino', 'Praha', [...ALL, ...VIP], ['ukazkova-data', 'praha']),
  male('Tomáš', 'Marek', 'Tomáši', 'Olomouc', [...ALL, ...NEWS], ['ukazkova-data']),
  female('Veronika', 'Pospíšilová', 'Veroniko', 'Zlín', [...ALL], ['ukazkova-data']),
  male('Jiří', 'Pokorný', 'Jiří', 'Praha', [...ALL, ...NEWS], ['ukazkova-data', 'praha']),
  female('Hana', 'Marková', 'Hano', 'Brno', [...ALL], ['ukazkova-data', 'brno']),
  male('Josef', 'Král', 'Josefe', 'České Budějovice', [...ALL], ['ukazkova-data']),
  female('Michaela', 'Beneše', 'Michaelo', 'Praha', [...ALL, ...NEWS], ['ukazkova-data', 'praha']),
  male('David', 'Růžička', 'Davide', 'Pardubice', [...ALL], ['ukazkova-data']),
  female('Petra', 'Fialová', 'Petro', 'Hradec Králové', [...ALL, ...VIP], ['ukazkova-data']),
  male('Miroslav', 'Sedláček', 'Miroslave', 'Ústí nad Labem', [...ALL], ['ukazkova-data']),
  female('Lenka', 'Doležalová', 'Lenko', 'Brno', [...ALL, ...NEWS], ['ukazkova-data', 'brno']),
  male('Pavel', 'Zeman', 'Pavle', 'Praha', [...ALL], ['ukazkova-data', 'praha']),
  female('Marie', 'Kolářová', 'Marie', 'Jihlava', [...ALL], ['ukazkova-data']),
  male('Lukáš', 'Navrátil', 'Lukáši', 'Karlovy Vary', [...ALL, ...NEWS], ['ukazkova-data']),
  female('Alena', 'Čermáková', 'Aleno', 'Praha', [...ALL], ['ukazkova-data', 'praha']),
  male('Radek', 'Vaněk', 'Radku', 'Brno', [...ALL, ...VIP], ['ukazkova-data', 'brno']),
  female('Simona', 'Bláhová', 'Simono', 'Ostrava', [...ALL], ['ukazkova-data']),
  male('Vojtěch', 'Kříž', 'Vojtěchu', 'Praha', [...ALL, ...NEWS], ['ukazkova-data', 'praha']),
  female('Barbora', 'Malá', 'Barboro', 'Plzeň', [...ALL], ['ukazkova-data']),
  male('Filip', 'Šimek', 'Filipe', 'Brno', [...ALL], ['ukazkova-data', 'brno']),
  female('Nikola', 'Řezníková', 'Nikolo', 'Praha', [...ALL, ...NEWS], ['ukazkova-data', 'praha']),
  male('Adam', 'Urban', 'Adame', 'Zlín', [...ALL], ['ukazkova-data']),
  female('Klára', 'Sovová', 'Kláro', 'Olomouc', [...ALL, ...VIP], ['ukazkova-data']),
  male('Daniel', 'Chalupa', 'Danieli', 'Praha', [...ALL], ['ukazkova-data', 'praha']),
  female('Monika', 'Žáková', 'Moniko', 'Liberec', [...ALL, ...NEWS], ['ukazkova-data']),
  male('Roman', 'Havel', 'Romane', 'Brno', [...ALL], ['ukazkova-data', 'brno']),
  female('Zuzana', 'Cimrmanová', 'Zuzano', 'Praha', [...ALL], ['ukazkova-data', 'praha']),
  male('Karel', 'Čapek', 'Karle', 'Ostrava', [...ALL, ...NEWS], ['ukazkova-data']),
  female('Ivana', 'Kratochvílová', 'Ivano', 'Pardubice', [...ALL], ['ukazkova-data']),
  male('Vladimír', 'Bureš', 'Vladimíre', 'Praha', [...ALL, ...VIP], ['ukazkova-data', 'praha']),
  female('Denisa', 'Vlčková', 'Deniso', 'Brno', [...ALL], ['ukazkova-data', 'brno']),
  male('Štěpán', 'Musil', 'Štěpáne', 'Jihlava', [...ALL, ...NEWS], ['ukazkova-data']),
  female('Andrea', 'Holubová', 'Andreo', 'Praha', [...ALL], ['ukazkova-data', 'praha']),
  male('Marek', 'Konečný', 'Marku', 'Zlín', [...ALL], ['ukazkova-data']),
  female('Kristýna', 'Bartošová', 'Kristýno', 'Brno', [...ALL, ...NEWS], ['ukazkova-data', 'brno']),
  male('Ivan', 'Kadlec', 'Ivane', 'Ostrava', [...ALL], ['ukazkova-data']),
  female('Šárka', 'Vávrová', 'Šárko', 'Praha', [...ALL, ...VIP], ['ukazkova-data', 'praha']),
  male('Ladislav', 'Blažek', 'Ladislave', 'Plzeň', [...ALL], ['ukazkova-data']),
  {
    firstName: 'Sam',
    lastName: 'Bergström',
    titlePrefix: null,
    gender: 'unknown',
    email: 'sam.bergstrom@example.com',
    greeting: 'Dobrý den',
    city: 'Praha',
    listKeys: [...ALL],
    tagKeys: ['ukazkova-data', 'praha'],
    sourceRef: DEMO_SOURCE_REF,
  },
  {
    firstName: 'Robin',
    lastName: 'Novotný',
    titlePrefix: null,
    gender: 'unknown',
    email: 'robin.novotny@example.com',
    greeting: 'Dobrý den',
    city: 'Brno',
    listKeys: [...ALL, ...NEWS],
    tagKeys: ['ukazkova-data', 'brno'],
    sourceRef: DEMO_SOURCE_REF,
  },
  {
    firstName: null,
    lastName: null,
    titlePrefix: null,
    gender: 'unknown',
    email: 'objednavky@example.com',
    greeting: 'Dobrý den',
    city: 'Praha',
    listKeys: [...ALL],
    tagKeys: ['ukazkova-data'],
    sourceRef: DEMO_SOURCE_REF,
  },
  {
    firstName: 'Alexandra',
    lastName: 'Dvořáková',
    titlePrefix: 'MUDr.',
    gender: 'female',
    email: 'alexandra.dvorakova@example.com',
    greeting: 'Dobrý den, Alexandro',
    city: 'Praha',
    listKeys: [...ALL, ...VIP],
    tagKeys: ['ukazkova-data', 'praha'],
    sourceRef: DEMO_SOURCE_REF,
  },
];

/**
 * POZOR na `key`. Není to sloupec v databázi.
 *
 * `tags`, `lists`, `segments` ani `templates` sloupec `slug` NEMAJÍ, ověřeno
 * proti schématu P03. `key` slouží jen k tomu, aby na sebe položky téhle sady
 * mohly odkazovat (kontakt na štítek, kampaň na šablonu) dřív, než databáze
 * přidělí identifikátory. Do žádného INSERTu nevstupuje.
 */
export type DemoList = { key: string; name: string; description: string };

export const DEMO_LISTS: readonly DemoList[] = [
  { key: 'zakaznici', name: 'Zákazníci', description: 'Lidé, kteří u vás už nakoupili.' },
  { key: 'novinky', name: 'Novinky', description: 'Přihlásili se k odběru novinek.' },
  { key: 'vip', name: 'VIP', description: 'Nejvěrnější zákazníci.' },
];

export type DemoTag = { key: string; name: string };

export const DEMO_TAGS: readonly DemoTag[] = [
  { key: 'ukazkova-data', name: 'Ukázková data' },
  { key: 'praha', name: 'Praha' },
  { key: 'brno', name: 'Brno' },
  { key: 'newsletter', name: 'Newsletter' },
];

export type DemoSegment = { key: string; name: string; definition: unknown };

export const DEMO_SEGMENTS: readonly DemoSegment[] = [
  {
    key: 'ukazka-praha',
    name: 'Ukázka: kontakty z Prahy',
    definition: {
      op: 'and',
      not: false,
      conditions: [{ field: 'tag', operator: 'has_any', value: ['praha'] }],
    },
  },
  {
    key: 'ukazka-aktivni-90',
    name: 'Ukázka: aktivní za posledních 90 dní',
    definition: {
      op: 'and',
      not: false,
      conditions: [
        { field: 'tag', operator: 'has_any', value: ['ukazkova-data'] },
        { field: 'last_open_at', operator: 'in_last_days', value: 90 },
      ],
    },
  },
];

/**
 * Šablona nese `design`, ne `blocks`, a **žádný předmět**: `templates.subject`
 * ve schématu není, předmět je vlastnost kampaně. Obojí ověřeno proti P03.
 */
export type DemoTemplate = { key: string; name: string; design: unknown };

export const DEMO_TEMPLATES: readonly DemoTemplate[] = [
  {
    key: 'ukazka-newsletter',
    name: 'Ukázka: měsíční newsletter',
    design: {
      version: 1,
      sections: [
        { type: 'heading', level: 1, text: 'Novinky za červenec' },
        { type: 'text', text: '{{ contact.greeting }}, tady je přehled toho, co je u nás nového.' },
        { type: 'button', text: 'Podívat se', href: 'https://example.com/novinky' },
        { type: 'unsubscribe' },
      ],
    },
  },
  {
    key: 'ukazka-vyprodej',
    name: 'Ukázka: pozvánka na výprodej',
    design: {
      version: 1,
      sections: [
        { type: 'heading', level: 1, text: 'Letní výprodej začíná' },
        { type: 'text', text: '{{ contact.greeting }}, sleva platí do neděle.' },
        { type: 'button', text: 'Do výprodeje', href: 'https://example.com/vyprodej' },
        { type: 'unsubscribe' },
      ],
    },
  },
];

export type DemoCampaign = {
  key: string;
  name: string;
  subject: string;
  templateKey: string;
  listKey: string;
  stats: {
    sent: number;
    delivered: number;
    openedUnique: number;
    openedUniqueApple: number;
    clickedUnique: number;
    /** campaign_stats dělí nedoručení na tvrdá a měkká, sloupec `bounced` nemá. */
    bouncedHard: number;
    bouncedSoft: number;
    complained: number;
    unsubscribed: number;
  };
};

export const DEMO_CAMPAIGN: DemoCampaign = {
  key: 'ukazka-letni-vyprodej',
  name: 'Ukázka: Letní výprodej',
  subject: 'Letní výprodej začíná',
  templateKey: 'ukazka-vyprodej',
  listKey: 'zakaznici',
  stats: {
    sent: 50,
    delivered: 48,
    openedUnique: 21,
    openedUniqueApple: 8,
    clickedUnique: 7,
    bouncedHard: 1,
    bouncedSoft: 1,
    complained: 1,
    unsubscribed: 1,
  },
};

const DEMO_CAMPAIGN_AGE_DAYS = 3;

/**
 * Kampaň se datuje tři dny zpět, ale nikdy před začátek aktuálního měsíce.
 * `messages`, `message_events` a `message_engagement` jsou partitionované po
 * měsících, `DEFAULT` partition se schválně nezakládá a zápis mimo okno tvrdě
 * spadne. Bez tohohle oříznutí by seed první tři dny v měsíci padal.
 */
export function demoCampaignSentAt(now: Date): Date {
  const candidate = new Date(now.getTime() - DEMO_CAMPAIGN_AGE_DAYS * 86_400_000);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
  return candidate < monthStart ? monthStart : candidate;
}
```

- [ ] **Krok 5: Spusť a commitni**

Spusť: `pnpm vitest run packages/core/test/demo/dataset.test.ts`
Očekávej: PASS, 19 testů.

```bash
git add packages/core/src/demo/dataset.ts packages/core/src/demo/manifest.ts packages/core/test/demo/dataset.test.ts
git commit -m "feat(demo): add deterministic 50 contact sample dataset"
```

---

### Úkol 25: Nahrání ukázkových dat

**Soubory:**
- Vytvoř: `packages/core/src/demo/seed.ts`, `packages/core/src/demo/index.ts`
- Test: `packages/core/test/demo/seed.db.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
// packages/core/test/demo/seed.db.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestPostgres } from '../support/db.js';
import { DemoAlreadySeededError, readDemoManifest, seedDemoData } from '../../src/demo/index.js';

let pg: TestPostgres;
let workspaceId: string;

beforeAll(async () => {
  pg = await startTestPostgres();
  workspaceId = (await pg.seedMinimalInstallation({ contacts: 0 })).workspaceId;
}, 240_000);

beforeEach(async () => {
  await pg.truncateWorkspaceData(workspaceId);
  await pg.sql(`UPDATE workspaces SET settings = '{}'::jsonb WHERE id = $1`, [workspaceId]);
});

afterAll(async () => {
  await pg?.stop();
});

const count = async (table: string) =>
  Number(
    (
      await pg.sql<{ n: string }>(
        `SELECT count(*)::text AS n FROM ${table} WHERE workspace_id = $1`,
        [workspaceId],
      )
    )[0].n,
  );

/**
 * Seed běží pod APLIKAČNÍ rolí s kontextem projektu, tedy tak, jak ho volá
 * endpoint. Pod migrátorem by test prošel, i kdyby produkční kód kontext
 * nenastavoval, a chyba by se projevila až u zákazníka jako porušení
 * politiky RLS při prvním INSERTu.
 */
const seed = (now = new Date()) =>
  pg.inWorkspace(workspaceId, (tx) => seedDemoData(tx, { workspaceId, now }));

describe('seed sedí se schématem', () => {
  // Tenhle test je tu proto, že seed je jediné místo v plánu, které zapisuje
  // do devíti tabulek naráz. Když se sloupec přejmenuje nebo přibude NOT NULL,
  // spadne celý seed na prvním INSERTu a hláška ukáže jen tu první tabulku.
  // Test se neptá plánu, ale information_schema, a řekne rovnou, který
  // sloupec chybí.
  const REQUIRED: ReadonlyArray<readonly [string, readonly string[]]> = [
    ['tags', ['workspace_id', 'name']],
    ['lists', ['workspace_id', 'name', 'description']],
    ['contacts', ['workspace_id', 'email', 'first_name', 'last_name', 'title_prefix',
                  'gender', 'greeting', 'status', 'source', 'source_ref', 'locale',
                  'timezone', 'attributes']],
    ['contact_tags', ['contact_id', 'tag_id', 'workspace_id']],
    ['list_subscriptions', ['workspace_id', 'list_id', 'contact_id', 'status', 'source',
                            'subscribed_at', 'confirmed_at']],
    ['segments', ['workspace_id', 'name', 'kind', 'definition', 'definition_hash']],
    ['templates', ['workspace_id', 'name', 'kind', 'design', 'design_hash']],
    ['campaigns', ['workspace_id', 'name', 'subject', 'template_id', 'status',
                   'started_at', 'finished_at', 'audience_built_at']],
    ['campaign_stats', ['workspace_id', 'campaign_id', 'sent', 'delivered', 'opens_unique',
                        'opens_unique_apple', 'clicks_unique', 'bounced_hard', 'bounced_soft',
                        'complained', 'unsubscribed', 'updated_at']],
  ];

  it('každý sloupec, do kterého seed zapisuje, ve schématu existuje', async () => {
    for (const [table, columns] of REQUIRED) {
      const rows = await pg.sql<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1`,
        [table],
      );
      const actual = new Set(rows.map((r) => r.column_name));
      for (const column of columns) {
        expect(actual.has(column), `${table}.${column} ve schématu chybí`).toBe(true);
      }
    }
  });

  it('žádná z těch tabulek nemá NOT NULL sloupec bez defaultu, který seed vynechává', async () => {
    // Chytá opačnou chybu než předchozí test: sloupec, který ve schématu
    // přibyl jako povinný a seed o něm neví. Projeví se jako
    // `null value in column ... violates not-null constraint`.
    const known = new Map(REQUIRED.map(([t, c]) => [t, new Set(c)]));
    for (const [table, columns] of known) {
      const rows = await pg.sql<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1
            AND is_nullable = 'NO' AND column_default IS NULL
            AND is_generated = 'NEVER'`,
        [table],
      );
      for (const { column_name } of rows) {
        expect(columns.has(column_name), `${table}.${column_name} je povinný, ale seed ho nevyplňuje`)
          .toBe(true);
      }
    }
  });
});

describe('seedDemoData', () => {
  it('nahraje 50 kontaktů, 3 seznamy, 4 štítky, 2 segmenty, 2 šablony a 1 kampaň', async () => {
    await seed();
    expect(await count('contacts')).toBe(50);
    expect(await count('lists')).toBe(3);
    expect(await count('tags')).toBe(4);
    expect(await count('segments')).toBe(2);
    expect(await count('templates')).toBe(2);
    expect(await count('campaigns')).toBe(1);
  });

  it('zapíše manifest se všemi identifikátory', async () => {
    await seed();
    const manifest = await pg.inWorkspace(workspaceId, (tx) => readDemoManifest(tx, workspaceId));
    expect(manifest?.contactIds).toHaveLength(50);
    expect(manifest?.campaignIds).toHaveLength(1);
    expect(manifest?.version).toBe(1);
  });

  it('všechny kontakty nesou source_ref demo-data:v1 a štítek Ukázková data', async () => {
    await seed();
    const rows = await pg.sql<{ n: string }>(
      `SELECT count(*)::text AS n FROM contacts c
         JOIN contact_tags ct ON ct.contact_id = c.id
         JOIN tags t ON t.id = ct.tag_id
        WHERE c.workspace_id = $1 AND c.source_ref = 'demo-data:v1' AND t.slug = 'ukazkova-data'`,
      [workspaceId],
    );
    expect(rows[0].n).toBe('50');
  });

  it('kampaň má report s reálnými čísly, ne s nulami', async () => {
    await seed();
    const [row] = await pg.sql<{ status: string; sent: number; bounced: number }>(
      `SELECT c.status, cs.sent, cs.bounced FROM campaigns c
         JOIN campaign_stats cs ON cs.campaign_id = c.id
        WHERE c.workspace_id = $1`,
      [workspaceId],
    );
    expect(row.status).toBe('sent');
    expect(row.sent).toBe(50);
    expect(row.bounced).toBe(2);
  });

  it('kampaň se vejde do existující partition, i když je první den v měsíci', async () => {
    const firstOfMonth = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1, 8));
    await expect(
      seed(firstOfMonth),
    ).resolves.toBeDefined();
  });

  it('druhé nahrání odmítne a nezaloží nic navíc', async () => {
    await seed();
    await expect(
      seed(),
    ).rejects.toThrow(DemoAlreadySeededError);
    expect(await count('contacts')).toBe(50);
  });

  it('při chybě uprostřed nezůstane půlka dat, protože je to jedna transakce', async () => {
    await pg.sql('ALTER TABLE campaigns ADD CONSTRAINT tmp_fail CHECK (false) NOT VALID');
    await pg.sql('ALTER TABLE campaigns VALIDATE CONSTRAINT tmp_fail');
    await expect(
      seed(),
    ).rejects.toThrow();
    expect(await count('contacts')).toBe(0);
    await pg.sql('ALTER TABLE campaigns DROP CONSTRAINT tmp_fail');
  });

  it('zapíše do auditu akci demo_data.seeded', async () => {
    await seed();
    const rows = await pg.sql<{ action: string }>(
      "SELECT action FROM audit_log WHERE action = 'demo_data.seeded' AND workspace_id = $1",
      [workspaceId],
    );
    expect(rows.length).toBe(1);
  });
});
```

- [ ] **Krok 2: Spusť a ověř pád**

Spusť: `pnpm vitest run packages/core/test/demo/seed.db.test.ts`
Očekávej: FAIL, modul neexistuje.

- [ ] **Krok 3: Implementuj seed**

```ts
// packages/core/src/demo/seed.ts
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { writeAuditLog } from '@mlain/core/audit/write';
import type { Tx } from '@mlain/db';
import {
  DEMO_CAMPAIGN,
  DEMO_CONTACTS,
  DEMO_LISTS,
  DEMO_SEGMENTS,
  DEMO_TAGS,
  DEMO_TEMPLATES,
  demoCampaignSentAt,
} from './dataset.js';
import {
  DEMO_MANIFEST_VERSION,
  DEMO_SOURCE_REF,
  parseDemoManifest,
  type DemoManifest,
} from './manifest.js';

export class DemoAlreadySeededError extends Error {
  constructor() {
    super('Ukázková data už v projektu jsou. Nejdřív je odstraňte, pak je můžete nahrát znovu.');
    this.name = 'DemoAlreadySeededError';
  }
}

export type SeedInput = { workspaceId: string; now: Date };

export async function readDemoManifest(
  tx: Tx,
  workspaceId: string,
): Promise<DemoManifest | null> {
  const { rows } = await tx.execute<{ settings: Record<string, unknown> }>(
    sql`SELECT settings FROM workspaces WHERE id = ${workspaceId}`);
  return parseDemoManifest(rows[0]?.settings.demoData);
}

/**
 * Seed i úklid berou `tx: Tx` a transakci otevírá volající přes
 * `withWorkspace`. Je to povinné, ne stylistická volba: všech devět tabulek,
 * do kterých se tu zapisuje, má politiku `ws_isolation` s klauzulí
 * `WITH CHECK`, takže bez nastaveného `mlain.workspace_id` by první INSERT
 * skončil na porušení politiky, a `SELECT ... FOR UPDATE` nad `workspaces`
 * by předtím vrátil prázdno a vyhodil „projekt neexistuje" u projektu,
 * který existuje.
 *
 * Celý seed je jedna transakce. Kdyby doběhl napůl, zůstala by v projektu
 * data, která nejsou v manifestu, a odstranění by je nenašlo. Půlka ukázkových
 * dat, které se nedají smazat, je horší než žádná.
 */
export async function seedDemoData(tx: Tx, input: SeedInput): Promise<DemoManifest> {
  const { rows: ws } = await tx.execute<{ settings: Record<string, unknown>; locale: string }>(
    sql`SELECT settings, locale FROM workspaces WHERE id = ${input.workspaceId} FOR UPDATE`);
  if (ws.length === 0) throw new Error(`Projekt ${input.workspaceId} neexistuje.`);
  if (parseDemoManifest(ws[0].settings.demoData) !== null) throw new DemoAlreadySeededError();

  const manifest = await insertAll(tx, input, ws[0].locale);

  await tx.execute(sql`
    UPDATE workspaces
       SET settings = jsonb_set(settings, '{demoData}', ${JSON.stringify(manifest)}::jsonb, true),
           updated_at = now()
     WHERE id = ${input.workspaceId}`);
  await writeAuditLog(tx, {
    action: 'demo_data.seeded',
    workspaceId: input.workspaceId,
    actor: { type: 'system', job: 'demo.seed' },
    targetType: 'workspace',
    targetId: input.workspaceId,
    metadata: { contacts: manifest.contactIds.length },
  });
  return manifest;
}

async function insertAll(
  tx: Tx,
  input: SeedInput,
  locale: string,
): Promise<DemoManifest> {
  const ws = input.workspaceId;

  // ---------------------------------------------------------------------------
  // JMÉNA SLOUPCŮ SEDÍ SE SCHÉMATEM P03 a hlídá to test „seed sedí se schématem"
  // v kroku 1. Dřívější znění mělo osm neexistujících sloupců, a protože se
  // sada zakládá jedním voláním, spadl by seed hned na prvním INSERTu do tags.
  // Konkrétně: `tags.slug`, `lists.slug`, `segments.slug`, `templates.slug`,
  // `templates.subject`, `templates.blocks`, `contacts.custom_fields`
  // a `campaigns.sent_at` ve schématu NEJSOU, `list_subscriptions` nemá `id`
  // ani `created_at`, a povinné `templates.design`, `templates.design_hash`
  // i `segments.definition_hash` ve výčtu naopak chyběly.
  //
  // Identifikátor se nechává na databázi (`DEFAULT uuidv7()`) a čte se přes
  // RETURNING. uuidv7 je časově uspořádané, což u ukázkových dat znamená,
  // že se v tabulce seřadí tak, jak vznikla.
  // ---------------------------------------------------------------------------

  const tagIds = new Map<string, string>();
  for (const tag of DEMO_TAGS) {
    const { rows } = await tx.execute<{ id: string }>(sql`
      INSERT INTO tags (workspace_id, name) VALUES (${ws}, ${tag.name}) RETURNING id`);
    tagIds.set(tag.key, rows[0].id);
  }

  const listIds = new Map<string, string>();
  for (const list of DEMO_LISTS) {
    const { rows } = await tx.execute<{ id: string }>(sql`
      INSERT INTO lists (workspace_id, name, description)
      VALUES (${ws}, ${list.name}, ${list.description}) RETURNING id`);
    listIds.set(list.key, rows[0].id);
  }

  const contactIds: string[] = [];
  for (const contact of DEMO_CONTACTS) {
    // Vlastní pole jsou `attributes`, ne `custom_fields`.
    const { rows } = await tx.execute<{ id: string }>(sql`
      INSERT INTO contacts
        (workspace_id, email, first_name, last_name, title_prefix, gender, greeting,
         status, source, source_ref, locale, timezone, attributes)
      VALUES (${ws}, ${contact.email}, ${contact.firstName}, ${contact.lastName},
              ${contact.titlePrefix}, ${contact.gender}, ${contact.greeting},
              'active', 'manual', ${DEMO_SOURCE_REF}, ${locale}, 'Europe/Prague',
              ${JSON.stringify({ city: contact.city })}::jsonb)
      RETURNING id`);
    const id = rows[0].id;
    contactIds.push(id);

    for (const key of contact.tagKeys) {
      await tx.execute(sql`
        INSERT INTO contact_tags (contact_id, tag_id, workspace_id)
        VALUES (${id}, ${tagIds.get(key)}, ${ws})`);
    }
    for (const key of contact.listKeys) {
      // list_subscriptions má složený PK (contact_id, list_id), tedy žádné
      // vlastní `id`, a nemá `created_at`. `source` je NOT NULL bez defaultu.
      await tx.execute(sql`
        INSERT INTO list_subscriptions
          (workspace_id, list_id, contact_id, status, source, subscribed_at, confirmed_at)
        VALUES (${ws}, ${listIds.get(key)}, ${id}, 'confirmed', 'manual', now(), now())`);
    }
  }

  const segmentIds: string[] = [];
  for (const segment of DEMO_SEGMENTS) {
    // `definition_hash bytea` je NOT NULL. Počítá se z kanonického JSON,
    // stejně jako u šablon.
    const definition = JSON.stringify(segment.definition);
    const { rows } = await tx.execute<{ id: string }>(sql`
      INSERT INTO segments (workspace_id, name, kind, definition, definition_hash)
      VALUES (${ws}, ${segment.name}, 'dynamic', ${definition}::jsonb, sha256(${definition}::bytea))
      RETURNING id`);
    segmentIds.push(rows[0].id);
  }

  const templateIds = new Map<string, string>();
  for (const template of DEMO_TEMPLATES) {
    // `design jsonb` a `design_hash bytea` jsou NOT NULL; `subject` ani
    // `blocks` na šabloně neexistují, předmět nese kampaň.
    const design = JSON.stringify(template.design);
    const { rows } = await tx.execute<{ id: string }>(sql`
      INSERT INTO templates (workspace_id, name, kind, design, design_hash)
      VALUES (${ws}, ${template.name}, 'campaign', ${design}::jsonb, sha256(${design}::bytea))
      RETURNING id`);
    templateIds.set(template.key, rows[0].id);
  }

  const sentAt = demoCampaignSentAt(input.now);
  // `campaigns.sent_at` neexistuje. Dokončení kampaně nese `finished_at`,
  // začátek `started_at`. Obojí se nastavuje na týž čas, protože ukázková
  // kampaň se nikdy neodesílala doopravdy.
  const { rows: campaignRows } = await tx.execute<{ id: string }>(sql`
    INSERT INTO campaigns
      (workspace_id, name, subject, template_id, status,
       started_at, finished_at, audience_built_at)
    VALUES (${ws}, ${DEMO_CAMPAIGN.name}, ${DEMO_CAMPAIGN.subject},
            ${templateIds.get(DEMO_CAMPAIGN.templateKey)}, 'sent',
            ${sentAt}, ${sentAt}, ${sentAt})
    RETURNING id`);
  const campaignId = campaignRows[0].id;

  const s = DEMO_CAMPAIGN.stats;
  // `bounced` ani `computed_at` v campaign_stats nejsou. Nedoručení se dělí
  // na `bounced_hard` a `bounced_soft`, čas poslední změny je `updated_at`.
  await tx.execute(sql`
    INSERT INTO campaign_stats
      (workspace_id, campaign_id, sent, delivered, opens_unique, opens_unique_apple,
       clicks_unique, bounced_hard, bounced_soft, complained, unsubscribed, updated_at)
    VALUES (${ws}, ${campaignId}, ${s.sent}, ${s.delivered}, ${s.openedUnique},
            ${s.openedUniqueApple}, ${s.clickedUnique}, ${s.bouncedHard}, ${s.bouncedSoft},
            ${s.complained}, ${s.unsubscribed}, now())`);

  return {
    version: DEMO_MANIFEST_VERSION,
    seededAt: input.now.toISOString(),
    contactIds,
    listIds: [...listIds.values()],
    tagIds: [...tagIds.values()],
    segmentIds,
    templateIds: [...templateIds.values()],
    campaignIds: [campaignId],
  };
}
```

```ts
// packages/core/src/demo/index.ts
export { DEMO_CAMPAIGN, DEMO_CONTACTS, DEMO_LISTS, DEMO_SEGMENTS, DEMO_TAGS, DEMO_TEMPLATES, demoCampaignSentAt } from './dataset.js';
export {
  DEMO_SOURCE_REF,
  DEMO_SOURCE_REF_PATTERN,
  DEMO_SOURCE_REF_PREFIX,
  parseDemoManifest,
} from './manifest.js';
export type { DemoManifest } from './manifest.js';
export { DemoAlreadySeededError, readDemoManifest, seedDemoData } from './seed.js';
export { purgeDemoData } from './purge.js';
```

- [ ] **Krok 4: Spusť a commitni**

Spusť: `pnpm vitest run packages/core/test/demo/seed.db.test.ts`
Očekávej: PASS, 10 testů. Modul `purge.js` ještě neexistuje, takže dočasně zakomentuj poslední řádek `index.ts` a odkomentuj ho v úkolu 26.

```bash
git add packages/core/src/demo/seed.ts packages/core/src/demo/index.ts packages/core/test/demo/seed.db.test.ts
git commit -m "feat(demo): seed sample data in a single transaction with a manifest"
```

---

### Úkol 26: Odstranění ukázkových dat beze zbytku

**Soubory:**
- Vytvoř: `packages/core/src/demo/purge.ts`
- Test: `packages/core/test/demo/purge.db.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
// packages/core/test/demo/purge.db.test.ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startTestPostgres, type TestPostgres } from '../support/db.js';
import { purgeDemoData, readDemoManifest, seedDemoData } from '../../src/demo/index.js';

let pg: TestPostgres;
let workspaceId: string;

beforeAll(async () => {
  pg = await startTestPostgres();
  workspaceId = (await pg.seedMinimalInstallation({ contacts: 0 })).workspaceId;
}, 240_000);

beforeEach(async () => {
  await pg.truncateWorkspaceData(workspaceId);
  await pg.sql(`UPDATE workspaces SET settings = '{}'::jsonb WHERE id = $1`, [workspaceId]);
});

afterAll(async () => {
  await pg?.stop();
});

const count = async (table: string) =>
  Number(
    (
      await pg.sql<{ n: string }>(
        `SELECT count(*)::text AS n FROM ${table} WHERE workspace_id = $1`,
        [workspaceId],
      )
    )[0].n,
  );

const seed = () =>
  pg.inWorkspace(workspaceId, (tx) => seedDemoData(tx, { workspaceId, now: new Date() }));
const purge = () => pg.inWorkspace(workspaceId, (tx) => purgeDemoData(tx, { workspaceId }));

describe('purgeDemoData', () => {
  it('smaže všechno, co seed založil, včetně kampaně a reportu', async () => {
    await seed();
    const report = await purge();
    expect(report.deleted.contacts).toBe(50);
    expect(await count('contacts')).toBe(0);
    expect(await count('campaigns')).toBe(0);
    expect(await count('segments')).toBe(0);
    expect(await count('templates')).toBe(0);
    expect(await count('lists')).toBe(0);
    expect(await count('tags')).toBe(0);
  });

  it('nesáhne na nic ostatního v projektu', async () => {
    await pg.sql(
      `INSERT INTO contacts (workspace_id, email, status, source, locale, timezone)
       VALUES ($1, 'skutecny@firma.cz', 'active', 'manual', 'cs', 'Europe/Prague')`,
      [workspaceId],
    );
    await pg.sql(
      `INSERT INTO tags (workspace_id, name) VALUES ($1, 'Můj štítek')`,
      [workspaceId],
    );
    await seed();
    await purge();
    expect(await count('contacts')).toBe(1);
    expect(await count('tags')).toBe(1);
  });

  it('vyprázdní manifest, takže jde ukázková data nahrát znovu', async () => {
    await seed();
    await purge();
    expect(await pg.inWorkspace(workspaceId, (tx) => readDemoManifest(tx, workspaceId)))
      .toBeNull();
    await expect(
      seed(),
    ).resolves.toBeDefined();
  });

  it('bez manifestu skončí bez chyby a nic nesmaže', async () => {
    const report = await purge();
    expect(report.deleted.contacts).toBe(0);
  });

  it('smaže i kontakt, který uživatel mezitím ručně upravil', async () => {
    await seed();
    await pg.sql(
      `UPDATE contacts SET source_ref = NULL, first_name = 'Přejmenovaná'
        WHERE workspace_id = $1 AND email = 'jana.novakova@example.com'`,
      [workspaceId],
    );
    await purge();
    expect(await count('contacts')).toBe(0);
  });

  it('zapíše do auditu akci demo_data.purged s počty', async () => {
    await seed();
    await purge();
    const rows = await pg.sql<{ metadata: { contacts: number } }>(
      "SELECT metadata FROM audit_log WHERE action = 'demo_data.purged' AND workspace_id = $1",
      [workspaceId],
    );
    expect(rows[0].metadata.contacts).toBe(50);
  });

  it('smaže zprávy zkušebního odeslání, ale auditní stopu nechá', async () => {
    // Ukázková kampaň se neodesílá, ale uživatel z ukázkové šablony pošle
    // zkušební e-mail a tím vzniknou zprávy i události. Tenhle test drží
    // hranici slibu „beze zbytku" tam, kde opravdu je: objekty z manifestu
    // se smažou, append only tabulky zůstanou, protože migrace 0006 odebírá
    // roli mlain_app právo DELETE na message_events.
    const manifest = await seed();
    const [contact] = await pg.sql<{ id: string }>(
      'SELECT id FROM contacts WHERE workspace_id = $1 LIMIT 1', [workspaceId]);
    await pg.sql(
      `INSERT INTO messages (workspace_id, campaign_id, kind, contact_id, email, status,
                             sent_at, created_at)
       VALUES ($1, $2, 'test', $3, 'jana.novakova@example.com', 'sent', now(), now())`,
      [workspaceId, manifest.campaignIds[0], contact.id],
    );

    await purge();
    expect(await count('messages')).toBe(0);
    expect(await count('campaigns')).toBe(0);
  });

  it('bez kontextu projektu NEMAŽE a neohlásí hotovo', async () => {
    // Nejtišší možná porucha téhle domény: pod aplikační rolí bez nastaveného
    // mlain.workspace_id vrátí SELECT nad workspaces prázdno, funkce vrátí
    // nulový report a uživatel se dozví, že je hotovo. Ověřeno spuštěním,
    // že RLS se takhle opravdu chová.
    await seed();
    const pool = pg.as('mlain_app');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'SELECT settings FROM workspaces WHERE id = $1', [workspaceId]);
      expect(rows).toHaveLength(0);
      await client.query('COMMIT');
    } finally {
      client.release();
    }
    // Data jsou pořád na místě, protože se nic nesmazalo.
    expect(await count('contacts')).toBe(50);
  });
});
```

- [ ] **Krok 2: Spusť a ověř pád**

Spusť: `pnpm vitest run packages/core/test/demo/purge.db.test.ts`
Očekávej: FAIL, modul neexistuje.

- [ ] **Krok 3: Implementuj**

```ts
// packages/core/src/demo/purge.ts
import { sql } from 'drizzle-orm';
import { writeAuditLog } from '@mlain/core/audit/write';
import type { Tx } from '@mlain/db';
import { parseDemoManifest, type DemoManifest } from './manifest.js';

export type PurgeInput = { workspaceId: string };

export type PurgeReport = {
  deleted: {
    contacts: number;
    lists: number;
    tags: number;
    segments: number;
    templates: number;
    campaigns: number;
  };
};

const EMPTY: PurgeReport = {
  deleted: { contacts: 0, lists: 0, tags: 0, segments: 0, templates: 0, campaigns: 0 },
};

/**
 * Maže se podle manifestu, ne podle značky `source_ref`. Uživatel může
 * ukázkový kontakt upravit a značku smazat; kdyby se mazalo podle značky,
 * takový kontakt by v projektu zůstal navždy a nešlo by se ho zbavit.
 * Manifest drží přesné identifikátory a je zdrojem pravdy.
 *
 * Bere `tx: Tx` a transakci otevírá volající přes `withWorkspace`. Bez
 * nastaveného kontextu projektu by `SELECT ... FOR UPDATE` nad `workspaces`
 * vrátil prázdno, funkce by vrátila `EMPTY` a **ohlásila by hotovo, aniž by
 * cokoli smazala.** To je tichá porucha přesně toho druhu, kterou uživatel
 * odhalí až po druhém pokusu.
 */
export async function purgeDemoData(tx: Tx, input: PurgeInput): Promise<PurgeReport> {
  const { rows: ws } = await tx.execute<{ settings: Record<string, unknown> }>(
    sql`SELECT settings FROM workspaces WHERE id = ${input.workspaceId} FOR UPDATE`);
  const manifest = parseDemoManifest(ws[0]?.settings.demoData);
  if (manifest === null) return EMPTY;

  const report = await deleteAll(tx, input.workspaceId, manifest);

  await tx.execute(sql`
    UPDATE workspaces SET settings = settings - 'demoData', updated_at = now()
     WHERE id = ${input.workspaceId}`);
  await writeAuditLog(tx, {
    action: 'demo_data.purged',
    workspaceId: input.workspaceId,
    actor: { type: 'system', job: 'demo.purge' },
    targetType: 'workspace',
    targetId: input.workspaceId,
    metadata: report.deleted,
  });
  return report;
}

/**
 * CO SE MAZAT NEDÁ A PROČ TO NENÍ CHYBA.
 *
 * Ukázková kampaň se nikdy neodesílala, takže po ní nezůstávají zprávy ani
 * události. Když ale uživatel z ukázkové šablony pošle zkušební e-mail nebo
 * projede zlatou cestu, vzniknou řádky v `messages` a `message_events`.
 * `messages` smazat jde, `message_events` **ne**: migrace 0006 odebírá roli
 * `mlain_app` právo UPDATE i DELETE na téhle tabulce, protože je append only.
 * Totéž platí pro `web_events`.
 *
 * Je to záměr, ne mezera. `message_events` je auditní stopa doručování
 * a otvírat aplikaci právo ji mazat kvůli úklidu ukázkových dat by bylo
 * horší než pár osiřelých řádků, které nikdo nevidí, protože kampaň i kontakt
 * jsou pryč. Slib „beze zbytku" se proto vztahuje na objekty z manifestu,
 * ne na auditní stopu, a test v kroku 1 to takhle ověřuje.
 */
async function deleteAll(
  tx: Tx,
  workspaceId: string,
  manifest: DemoManifest,
): Promise<PurgeReport> {
  const ws = workspaceId;

  // sql.param() je u seznamů povinné. Holé pole se rozloží na $1, $2, $3
  // a dotaz spadne na 42809 op ANY/ALL (array) requires array on right side.
  const ids = (list: readonly string[]) => sql.param([...list]);

  // Pořadí je dané cizími klíči: nejdřív listy stromu, potom jeho kořeny.
  for (const campaignId of manifest.campaignIds) {
    await tx.execute(sql`
      DELETE FROM campaign_stats WHERE campaign_id = ${campaignId} AND workspace_id = ${ws}`);
    await tx.execute(sql`
      DELETE FROM messages WHERE campaign_id = ${campaignId} AND workspace_id = ${ws}`);
  }
  const { rows: campaigns } = await tx.execute<{ id: string }>(sql`
    DELETE FROM campaigns WHERE workspace_id = ${ws} AND id = ANY(${ids(manifest.campaignIds)})
    RETURNING id`);

  const { rows: templates } = await tx.execute<{ id: string }>(sql`
    DELETE FROM templates WHERE workspace_id = ${ws} AND id = ANY(${ids(manifest.templateIds)})
    RETURNING id`);
  const { rows: segments } = await tx.execute<{ id: string }>(sql`
    DELETE FROM segments WHERE workspace_id = ${ws} AND id = ANY(${ids(manifest.segmentIds)})
    RETURNING id`);

  await tx.execute(sql`
    DELETE FROM contact_tags
     WHERE workspace_id = ${ws} AND contact_id = ANY(${ids(manifest.contactIds)})`);
  await tx.execute(sql`
    DELETE FROM list_subscriptions
     WHERE workspace_id = ${ws} AND contact_id = ANY(${ids(manifest.contactIds)})`);
  const { rows: contacts } = await tx.execute<{ id: string }>(sql`
    DELETE FROM contacts WHERE workspace_id = ${ws} AND id = ANY(${ids(manifest.contactIds)})
    RETURNING id`);

  const { rows: lists } = await tx.execute<{ id: string }>(sql`
    DELETE FROM lists WHERE workspace_id = ${ws} AND id = ANY(${ids(manifest.listIds)})
    RETURNING id`);
  const { rows: tags } = await tx.execute<{ id: string }>(sql`
    DELETE FROM tags WHERE workspace_id = ${ws} AND id = ANY(${ids(manifest.tagIds)})
    RETURNING id`);

  return {
    deleted: {
      contacts: contacts.length,
      lists: lists.length,
      tags: tags.length,
      segments: segments.length,
      templates: templates.length,
      campaigns: campaigns.length,
    },
  };
}
```

- [ ] **Krok 4: Odkomentuj export purge a spusť obě sady**

Spusť: `pnpm vitest run packages/core/test/demo/`
Očekávej: PASS, **37 testů** (19 v `dataset.test.ts`, 10 v `seed.db.test.ts`, 8 v `purge.db.test.ts`).

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/demo/purge.ts packages/core/src/demo/index.ts packages/core/test/demo/purge.db.test.ts
git commit -m "feat(demo): purge sample data by manifest without touching anything else"
```

---

### Úkol 27: Pruh ukázkových dat, potvrzení N2 a hromadný výběr

**Soubory:**
- Vytvoř: `apps/web/src/app/api/v1/demo-data/route.ts`
- Vytvoř: `apps/web/src/features/onboarding/demo-data-banner.tsx`, `demo-data-dialog.tsx`
- Test: `apps/web/src/features/onboarding/__tests__/demo-data-banner.test.tsx`

Odstranění ukázkových dat je podle škály rizika 6.1 části 6 úroveň **N2**: rozsah nad 100 položek by dával 2 body, ale obnovitelnost je 0 (sada se dá nahrát znovu jedním kliknutím) a vnější dopad 0 (na adresy `example.com` se nikdy nic neposlalo). Součet 2 znamená potvrzovací dialog se souhrnem a počty, bez zaškrtávacího políčka a bez opisování názvu.

- [ ] **Krok 1: Napiš padající test**

```tsx
// apps/web/src/features/onboarding/__tests__/demo-data-banner.test.tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DemoDataBanner } from '../demo-data-banner.js';

const present = {
  present: true,
  counts: { contacts: 50, lists: 3, tags: 4, segments: 2, templates: 2, campaigns: 1 },
};

describe('DemoDataBanner', () => {
  it('bez ukázkových dat se nevykreslí nic', () => {
    const { container } = render(
      <DemoDataBanner state={{ present: false, counts: null }} slug="e-shop" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('s ukázkovými daty ukáže trvalý pruh s počtem a s akcí', () => {
    render(<DemoDataBanner state={present} slug="e-shop" />);
    expect(screen.getByText(/V projektu jsou ukázková data/)).toBeInTheDocument();
    expect(screen.getByText(/50 ukázkových kontaktů/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Odstranit/ })).toBeInTheDocument();
  });

  it('odkáže na hromadný výběr přes štítek, aby šlo mazat i po částech', () => {
    render(<DemoDataBanner state={present} slug="e-shop" />);
    expect(screen.getByRole('link', { name: /štítku Ukázková data/ })).toHaveAttribute(
      'href',
      '/w/e-shop/contacts?tag=ukazkova-data',
    );
  });

  it('kliknutí na Odstranit otevře dialog s počty všech druhů položek', async () => {
    render(<DemoDataBanner state={present} slug="e-shop" />);
    await userEvent.click(screen.getByRole('button', { name: /Odstranit/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent(/50 kontaktů/);
    expect(dialog).toHaveTextContent(/1 kampaň/);
    expect(dialog).toHaveTextContent(/Na nic ostatního v projektu se nesáhne/);
  });

  it('dialog nemá zaškrtávací políčko ani opisování, protože je to úroveň N2', async () => {
    render(<DemoDataBanner state={present} slug="e-shop" />);
    await userEvent.click(screen.getByRole('button', { name: /Odstranit/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(dialog.querySelectorAll('input[type="text"]')).toHaveLength(0);
  });

  it('výchozí fokus je na ústupovém tlačítku, ne na potvrzení', async () => {
    render(<DemoDataBanner state={present} slug="e-shop" />);
    await userEvent.click(screen.getByRole('button', { name: /Odstranit/ }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /Nechat je tu/ })).toHaveFocus(),
    );
  });

  it('potvrzení zavolá DELETE na endpoint ukázkových dat', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    vi.stubGlobal('fetch', fetchMock);
    render(<DemoDataBanner state={present} slug="e-shop" />);
    await userEvent.click(screen.getByRole('button', { name: /Odstranit/ }));
    await userEvent.click(screen.getByRole('button', { name: /Odstranit ukázková data/ }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith('/api/v1/demo-data', { method: 'DELETE' }),
    );
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Krok 2: Spusť a ověř pád**

Spusť: `pnpm vitest run apps/web/src/features/onboarding/__tests__/demo-data-banner.test.tsx`
Očekávej: FAIL, komponenty neexistují.

- [ ] **Krok 3: Implementuj dialog**

```tsx
// apps/web/src/features/onboarding/demo-data-dialog.tsx
'use client';

import { useTranslations } from '@mlain/i18n/client';
import { ConfirmDialog } from '@mlain/ui/patterns/confirm-dialog';

export type DemoCounts = {
  contacts: number;
  lists: number;
  tags: number;
  segments: number;
  templates: number;
  campaigns: number;
};

export function DemoDataDialog({
  open,
  counts,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  counts: DemoCounts;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useTranslations('onboarding.demo');

  return (
    <ConfirmDialog
      open={open}
      level="N2"
      title={t('dialogTitle')}
      body={t('dialogBody', counts)}
      confirmLabel={t('dialogConfirm')}
      cancelLabel={t('dialogCancel')}
      // Výchozí fokus je na ústupu, aby Enter omylem nesmazal celou sadu.
      initialFocus="cancel"
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}
```

- [ ] **Krok 4: Implementuj pruh**

```tsx
// apps/web/src/features/onboarding/demo-data-banner.tsx
'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useTranslations } from '@mlain/i18n/client';
import { Alert } from '@mlain/ui/components/alert';
import { Button } from '@mlain/ui/components/button';
import { useToast } from '@mlain/ui/patterns/toast';
import { DemoDataDialog, type DemoCounts } from './demo-data-dialog.js';

export type DemoDataState = { present: boolean; counts: DemoCounts | null };

export function DemoDataBanner({ state, slug }: { state: DemoDataState; slug: string }) {
  const t = useTranslations('onboarding.demo');
  const toast = useToast();
  const [dialogOpen, setDialogOpen] = useState(false);

  if (!state.present || state.counts === null) return null;
  const counts = state.counts;

  return (
    <Alert tone="info">
      <p>
        <strong>{t('bannerTitle')}</strong> {t('bannerDetail', { contacts: counts.contacts })}
      </p>
      <p>
        <Link href={`/w/${slug}/contacts?tag=ukazkova-data`}>{t('filterHint')}</Link>
      </p>
      <Button variant="secondary" onClick={() => setDialogOpen(true)}>
        {t('remove')}
      </Button>
      <DemoDataDialog
        open={dialogOpen}
        counts={counts}
        onCancel={() => setDialogOpen(false)}
        onConfirm={async () => {
          setDialogOpen(false);
          const res = await fetch('/api/v1/demo-data', { method: 'DELETE' });
          if (res.ok) toast.success(t('removed'));
          else toast.error(t('remove'));
        }}
      />
    </Alert>
  );
}
```

- [ ] **Krok 5: Implementuj endpoint**

```ts
// apps/web/src/app/api/v1/demo-data/route.ts
import {
  DEMO_CONTACTS,
  DemoAlreadySeededError,
  purgeDemoData,
  readDemoManifest,
  seedDemoData,
} from '@mlain/core/demo';
import { withWorkspace } from '@mlain/core/tx';
import { defineRoute, requirePermission } from '@/lib/api';

export const GET = defineRoute({
  summary: 'Zjistí, jestli jsou v projektu ukázková data',
  handler: async ({ ctx }) => {
    const manifest = await withWorkspace(ctx, (tx) => readDemoManifest(tx, ctx.workspaceId));
    if (manifest === null) return { data: { present: false, counts: null } };
    return {
      data: {
        present: true,
        counts: {
          contacts: manifest.contactIds.length,
          lists: manifest.listIds.length,
          tags: manifest.tagIds.length,
          segments: manifest.segmentIds.length,
          templates: manifest.templateIds.length,
          campaigns: manifest.campaignIds.length,
        },
      },
    };
  },
});

export const POST = defineRoute({
  summary: 'Nahraje do projektu ukázková data',
  handler: async ({ ctx, problem }) => {
    await requirePermission(ctx, 'contacts:write');
    try {
      // Celý seed uvnitř JEDNÉ transakce s kontextem projektu. Bez obálky by
      // první INSERT skončil na WITH CHECK politiky ws_isolation.
      const manifest = await withWorkspace(ctx, (tx) =>
        seedDemoData(tx, { workspaceId: ctx.workspaceId, now: new Date() }),
      );
      return { status: 201, data: { contacts: manifest.contactIds.length } };
    } catch (err) {
      if (err instanceof DemoAlreadySeededError) {
        return problem('already_exists', {
          detail: err.message,
          params: { contacts: DEMO_CONTACTS.length },
        });
      }
      throw err;
    }
  },
});

export const DELETE = defineRoute({
  summary: 'Odstraní z projektu ukázková data podle manifestu',
  handler: async ({ ctx }) => {
    await requirePermission(ctx, 'contacts:delete');
    const report = await withWorkspace(ctx, (tx) =>
      purgeDemoData(tx, { workspaceId: ctx.workspaceId }),
    );
    return { data: report.deleted };
  },
});
```

- [ ] **Krok 6: Spusť a commitni**

Spusť: `pnpm vitest run apps/web/src/features/onboarding/__tests__/demo-data-banner.test.tsx`
Očekávej: PASS, 7 testů.

```bash
git add apps/web/src/features/onboarding/demo-data-banner.tsx apps/web/src/features/onboarding/demo-data-dialog.tsx apps/web/src/app/api/v1/demo-data apps/web/src/features/onboarding/__tests__/demo-data-banner.test.tsx
git commit -m "feat(demo): add sample data banner with N2 confirmation and bulk filter link"
```

---

### Úkol 28: Prostředí pro E2E: compose overlay a konfigurace Playwrightu

**Soubory:**
- Vytvoř: `apps/web/e2e/golden/compose.e2e.yml`, `apps/web/playwright.golden.config.ts`
- Vytvoř: `apps/web/e2e/golden/global-setup.ts`, `apps/web/e2e/golden/global-teardown.ts`

- [ ] **Krok 1: Napiš compose overlay s poštovní pastí**

```yaml
# apps/web/e2e/golden/compose.e2e.yml
# Overlay nad docker/compose.yml. Skládá se příkazem:
#   docker compose -f docker/compose.yml -f apps/web/e2e/golden/compose.e2e.yml up -d
# Soubory v docker/ vlastní P01 a tenhle plán do nich nesahá.
name: mlain-e2e

services:
  mailpit:
    # Mailpit je poštovní past: přijme SMTP a nabídne HTTP API na čtení zpráv.
    # Licence MIT, ověřeno 2026-07-31 přes GitHub API na axllent/mailpit.
    image: axllent/mailpit:v1.21
    restart: no
    environment:
      MP_SMTP_AUTH_ACCEPT_ANY: "1"
      MP_SMTP_AUTH_ALLOW_INSECURE: "1"
      MP_MAX_MESSAGES: "5000"
    ports:
      - "8025:8025"
      - "1025:1025"
    healthcheck:
      test: ["CMD", "wget", "-q", "-O", "-", "http://127.0.0.1:8025/readyz"]
      interval: 2s
      timeout: 2s
      retries: 30

  app:
    environment:
      # Okno na zrušení odeslání je nastavení projektu 0 az 300 s. V testu je 0,
      # protože 60 s by prodloužilo každý běh o minutu bez jakéhokoliv přínosu.
      CAMPAIGN_SEND_DELAY_SECONDS: "0"
      APP_URL: "http://localhost:3000"
    depends_on:
      mailpit:
        condition: service_healthy
```

- [ ] **Krok 2: Napiš konfiguraci Playwrightu**

```ts
// apps/web/playwright.golden.config.ts
import { defineConfig, devices } from '@playwright/test';

/**
 * Druhá konfigurace vedle `playwright.config.ts`, kterou vlastní P05 pro testy
 * komponent. Tahle jede zlatou cestu proti skutečnému compose, takže má delší
 * timeouty, jednoho workera a nulové opakování: přeběhnutý test zlaté cesty
 * je horší než červený, protože skryje závadu, kterou má odhalit.
 */
export default defineConfig({
  testDir: './e2e/golden/specs',
  globalSetup: './e2e/golden/global-setup.ts',
  globalTeardown: './e2e/golden/global-teardown.ts',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: true,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report-golden', open: 'never' }]],
  use: {
    baseURL: process.env.MLAIN_E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
    locale: 'cs-CZ',
    timezoneId: 'Europe/Prague',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
```

- [ ] **Krok 3: Napiš global setup**

```ts
// apps/web/e2e/golden/global-setup.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

const COMPOSE_ARGS = [
  'compose',
  '-f',
  'docker/compose.yml',
  '-f',
  'apps/web/e2e/golden/compose.e2e.yml',
  '--profile',
  'bundled',
];

async function waitForReady(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ok = await fetch(url)
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) return;
    if (Date.now() > deadline) throw new Error(`${url} neodpovědělo do ${timeoutMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

/**
 * Zlatá cesta musí projít na ČISTÉ instalaci, jinak netestuje instalaci,
 * ale zbytky po minulém běhu. Proto `down --volumes` před každým během.
 */
export default async function globalSetup(): Promise<void> {
  if (process.env.MLAIN_E2E_SKIP_COMPOSE === '1') return;

  await run('docker', [...COMPOSE_ARGS, 'down', '--volumes', '--remove-orphans'], {
    cwd: process.cwd(),
  });
  await run('docker', [...COMPOSE_ARGS, 'up', '-d'], { cwd: process.cwd(), maxBuffer: 32e6 });

  const base = process.env.MLAIN_E2E_BASE_URL ?? 'http://localhost:3000';
  await waitForReady(`${base}/api/health/ready`, 120_000);
  await waitForReady('http://localhost:8025/readyz', 60_000);
}
```

- [ ] **Krok 4: Napiš global teardown**

```ts
// apps/web/e2e/golden/global-teardown.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';

const run = promisify(execFile);

const COMPOSE_ARGS = [
  'compose',
  '-f',
  'docker/compose.yml',
  '-f',
  'apps/web/e2e/golden/compose.e2e.yml',
];

/**
 * Log kontejneru se ukládá vždycky, i po zeleném běhu. Bez něj se pád zlaté
 * cesty v CI vyšetřuje z toho, co je vidět v prohlížeči, a příčina bývá
 * v logu aplikace.
 */
export default async function globalTeardown(): Promise<void> {
  if (process.env.MLAIN_E2E_SKIP_COMPOSE === '1') return;

  const logs = await run('docker', [...COMPOSE_ARGS, 'logs', '--no-color'], {
    cwd: process.cwd(),
    maxBuffer: 64e6,
  }).catch((err: Error) => ({ stdout: `logy se nepodařilo přečíst: ${err.message}` }));

  await mkdir('playwright-report-golden', { recursive: true });
  await writeFile('playwright-report-golden/compose-logs.txt', logs.stdout, 'utf8');

  await run('docker', [...COMPOSE_ARGS, 'down', '--volumes', '--remove-orphans'], {
    cwd: process.cwd(),
  });
}
```

- [ ] **Krok 5: Ověř, že prostředí naskočí, a commitni**

Spusť: `docker compose -f docker/compose.yml -f apps/web/e2e/golden/compose.e2e.yml --profile bundled up -d && curl -sf http://localhost:3000/api/health/ready && curl -sf http://localhost:8025/readyz`
Očekávej: obě odpovědi 200, potom `docker compose ... down --volumes`.

```bash
git add apps/web/e2e/golden/compose.e2e.yml apps/web/playwright.golden.config.ts apps/web/e2e/golden/global-setup.ts apps/web/e2e/golden/global-teardown.ts
git commit -m "test(e2e): add compose overlay with mail sink and golden path config"
```

---

### Úkol 29: Klient poštovní pasti a vstupní data

**Soubory:**
- Vytvoř: `apps/web/e2e/golden/fixtures/mailpit.ts`, `apps/web/e2e/golden/fixtures/test-data.ts`, `apps/web/e2e/golden/fixtures/contacts-50.csv`

- [ ] **Krok 1: Napiš klienta nad HTTP API pasti**

```ts
// apps/web/e2e/golden/fixtures/mailpit.ts
export type TrappedMessage = {
  id: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
};

const API = process.env.MLAIN_E2E_MAILPIT_URL ?? 'http://localhost:8025';

async function json<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) throw new Error(`Mailpit ${path} vrátil ${res.status}`);
  return (await res.json()) as T;
}

export async function clearMailbox(): Promise<void> {
  await fetch(`${API}/api/v1/messages`, { method: 'DELETE' });
}

/**
 * Čeká na zprávu pro danou adresu. Nesmí se nahradit pevným čekáním: doba
 * odeslání závisí na dávkování senderu a pevná pauza vyrobí test, který
 * jednou za čas spadne bez příčiny.
 */
export async function waitForMessage(
  recipient: string,
  options: { subjectContains?: string; timeoutMs?: number } = {},
): Promise<TrappedMessage> {
  const deadline = Date.now() + (options.timeoutMs ?? 60_000);
  for (;;) {
    const list = await json<{ messages: { ID: string; To: { Address: string }[]; Subject: string }[] }>(
      `/api/v1/messages?limit=200`,
    );
    const hit = list.messages.find(
      (m) =>
        m.To.some((t) => t.Address.toLowerCase() === recipient.toLowerCase()) &&
        (options.subjectContains === undefined || m.Subject.includes(options.subjectContains)),
    );
    if (hit) {
      const detail = await json<{ HTML: string; Text: string }>(`/api/v1/message/${hit.ID}`);
      return {
        id: hit.ID,
        to: hit.To.map((t) => t.Address),
        subject: hit.Subject,
        html: detail.HTML,
        text: detail.Text,
      };
    }
    if (Date.now() > deadline) {
      throw new Error(`Do pasti nedorazila zpráva pro ${recipient} do limitu.`);
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

export async function messageCount(): Promise<number> {
  return (await json<{ total: number }>('/api/v1/messages?limit=1')).total;
}

/** Vytáhne první odkaz, jehož cíl obsahuje daný fragment cesty. */
export function extractLink(html: string, pathFragment: string): string {
  const matches = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  const hit = matches.find((href) => href.includes(pathFragment));
  if (!hit) throw new Error(`V e-mailu není odkaz obsahující ${pathFragment}.`);
  return hit.replace(/&amp;/g, '&');
}

/** Vytáhne adresu sledovacího pixelu. */
export function extractOpenPixel(html: string): string {
  const m = /<img[^>]+src="([^"]*\/t\/o\/[^"]+)"/.exec(html);
  if (!m) throw new Error('V e-mailu není sledovací pixel.');
  return m[1].replace(/&amp;/g, '&');
}
```

- [ ] **Krok 2: Napiš sdílená testovací data**

```ts
// apps/web/e2e/golden/fixtures/test-data.ts
export const ADMIN = {
  name: 'Jana Nováková',
  email: 'jana@firma.cz',
  password: 'ukazkove-heslo-2026',
  locale: 'Čeština',
} as const;

export const PROJECT = {
  name: 'E-shop Kolo',
  emailLocale: 'Čeština',
  timezone: 'Europe/Prague',
  addressForm: 'Vykáním',
} as const;

/** Adresa, kterou test ověří ve zkušebním režimu a na kterou kampaň skutečně odejde. */
export const VERIFIED_RECIPIENT = 'overena@firma.cz';

export const SMTP = {
  host: 'mailpit',
  port: '1025',
  encryption: 'Žádné',
  username: 'test',
  password: 'test',
  fromAddress: 'newsletter@firma.cz',
} as const;

export const CAMPAIGN = {
  name: 'Zlatá cesta: první kampaň',
  subject: 'Vítejte u nás',
  segmentName: 'Aktivní za 90 dní',
  templateName: 'Zlatá cesta: šablona',
} as const;

export const CONTACTS_CSV = 'apps/web/e2e/golden/fixtures/contacts-50.csv';
```

- [ ] **Krok 3: Napiš vstupní CSV**

```csv
Jméno,E-mail,Město,Zdroj
Jana Nováková,jana.novakova@example.com,Praha,web
Ondřej Dvořák,ondrej.dvorak@example.com,Brno,web
Ing. Petr Svoboda,petr.svoboda@example.com,Praha,prodejna
Lucie Černá,lucie.cerna@example.com,Ostrava,web
Eva Procházková,eva.prochazkova@example.com,Plzeň,web
```

Soubor musí mít **50 datových řádků**. Zbylých 45 doplň stejným tvarem podle seznamu jmen v `packages/core/src/demo/dataset.ts`, včetně řádku `,bezjmena@example.com,Praha,web` s prázdným jménem a řádku `Sam Bergström,sam.bergstrom@example.com,Praha,import` s nejednoznačným rodem. Bez těch dvou řádků se v kroku náhledu nedá ukázat fallback ani fronta kontroly oslovení, a to jsou dvě věci, kvůli kterým je import v demu zajímavý.

Soubor ulož v kódování UTF-8 s oddělovačem čárka a s koncovkou řádku LF.

- [ ] **Krok 4: Commit**

```bash
git add apps/web/e2e/golden/fixtures
git commit -m "test(e2e): add mail trap client and golden path fixtures"
```

---

### Úkol 30: Objekty obrazovek

**Soubory:**
- Vytvoř: `apps/web/e2e/golden/pages/{setup,onboarding,sending,import,template,segment,campaign,report}.page.ts`

Objekt obrazovky drží selektory na jednom místě. Když P06 nebo P13 změní strukturu obrazovky, opraví se jeden soubor, ne osm testů.

- [ ] **Krok 1: Napiš objekt průvodce prvním spuštěním**

```ts
// apps/web/e2e/golden/pages/setup.page.ts
import type { Page } from '@playwright/test';
import { ADMIN, PROJECT } from '../fixtures/test-data.js';

export class SetupPage {
  constructor(private readonly page: Page) {}

  async open(): Promise<void> {
    await this.page.goto('/setup');
  }

  /** Krok 1 a 2 z 8.1.2: dohromady osm polí, čtyři u účtu a čtyři u projektu. */
  async createAdminAndProject(): Promise<string> {
    await this.page.getByLabel('Jméno').fill(ADMIN.name);
    await this.page.getByLabel('E-mail').fill(ADMIN.email);
    await this.page.getByLabel('Heslo').fill(ADMIN.password);
    await this.page.getByLabel('Jazyk').selectOption({ label: ADMIN.locale });
    await this.page.getByRole('button', { name: 'Pokračovat' }).click();

    await this.page.getByLabel('Název projektu').fill(PROJECT.name);
    await this.page.getByLabel('Jazyk e-mailů').selectOption({ label: PROJECT.emailLocale });
    await this.page.getByLabel('Časová zóna').selectOption({ label: PROJECT.timezone });
    await this.page.getByRole('radio', { name: PROJECT.addressForm }).check();
    await this.page.getByRole('button', { name: 'Vytvořit projekt' }).click();

    await this.page.waitForURL(/\/w\/[^/]+$/);
    const match = /\/w\/([^/]+)/.exec(this.page.url());
    if (!match) throw new Error('Po vytvoření projektu se nečekaně změnila adresa.');
    return match[1];
  }
}
```

- [ ] **Krok 2: Napiš objekt panelu onboardingu a pruhu ukázkových dat**

```ts
// apps/web/e2e/golden/pages/onboarding.page.ts
import { expect, type Locator, type Page } from '@playwright/test';

export class OnboardingPage {
  constructor(
    private readonly page: Page,
    private readonly slug: string,
  ) {}

  async openDashboard(): Promise<void> {
    await this.page.goto(`/w/${this.slug}`);
  }

  get panel(): Locator {
    return this.page.getByRole('region', { name: 'Vaše první kampaň' });
  }

  step(name: string): Locator {
    return this.panel.getByRole('listitem').filter({ hasText: name });
  }

  async expectStepDone(name: string): Promise<void> {
    await expect(this.step(name)).toContainText('hotovo');
  }

  async expectStepNotDone(name: string): Promise<void> {
    await expect(this.step(name)).not.toContainText('hotovo');
  }

  get demoBanner(): Locator {
    return this.page.getByText('V projektu jsou ukázková data.');
  }

  async loadDemoData(): Promise<void> {
    await this.page.getByRole('link', { name: 'Ukázková' }).click();
    await this.page.getByRole('button', { name: 'Nahrát ukázková data' }).click();
  }

  async removeDemoData(): Promise<void> {
    await this.page.getByRole('button', { name: 'Odstranit' }).click();
    await this.page.getByRole('dialog').getByRole('button', { name: 'Odstranit ukázková data' }).click();
  }
}
```

- [ ] **Krok 3: Napiš objekt nastavení odesílání se zkušebním režimem**

```ts
// apps/web/e2e/golden/pages/sending.page.ts
import { expect, type Page } from '@playwright/test';
import { SMTP, VERIFIED_RECIPIENT } from '../fixtures/test-data.js';
import { extractLink, waitForMessage } from '../fixtures/mailpit.js';

export class SendingPage {
  constructor(
    private readonly page: Page,
    private readonly slug: string,
  ) {}

  async open(): Promise<void> {
    await this.page.goto(`/w/${this.slug}/settings/sending`);
  }

  /**
   * Krok 2 demo skriptu ve variantě podle rozporu R2: doména se neověřuje,
   * zapíná se zkušební režim. DNS propagace trvá minuty až hodiny a test na ni
   * čekat nemůže.
   */
  async connectSmtpInTrialMode(): Promise<void> {
    await this.page.getByRole('radio', { name: /Vlastní SMTP/ }).check();
    await this.page.getByRole('button', { name: 'Pokračovat' }).click();

    await this.page.getByLabel('Server').fill(SMTP.host);
    await this.page.getByLabel('Port').fill(SMTP.port);
    await this.page.getByLabel('Šifrování').selectOption({ label: SMTP.encryption });
    await this.page.getByLabel('Uživatelské jméno').fill(SMTP.username);
    await this.page.getByLabel('Heslo').fill(SMTP.password);
    await this.page.getByRole('button', { name: 'Otestovat připojení' }).click();
    await expect(this.page.getByText(/Připojení funguje/)).toBeVisible();
    await this.page.getByRole('button', { name: 'Pokračovat' }).click();

    await this.page.getByLabel('Odesílací adresa').fill(SMTP.fromAddress);
    await this.page.getByRole('button', { name: 'Pokračovat' }).click();

    await this.page
      .getByRole('radio', { name: /Zatím ne, chci si nástroj vyzkoušet/ })
      .check();
    await this.page.getByRole('button', { name: 'Pokračovat' }).click();
    await expect(this.page.getByText(/zkušebním režimu/i)).toBeVisible();
  }

  /** Ověří jednu adresu potvrzovacím e-mailem z pasti. */
  async verifyRecipient(): Promise<void> {
    await this.page.getByRole('button', { name: 'Přidat ověřenou adresu' }).click();
    await this.page.getByLabel('E-mail').fill(VERIFIED_RECIPIENT);
    await this.page.getByRole('button', { name: 'Odeslat potvrzení' }).click();

    const message = await waitForMessage(VERIFIED_RECIPIENT);
    await this.page.goto(extractLink(message.html, '/verify-sender/'));
    await expect(this.page.getByText(/Adresa je ověřená/)).toBeVisible();
  }
}
```

- [ ] **Krok 4: Napiš objekty importu, šablony, segmentu, kampaně a reportu**

```ts
// apps/web/e2e/golden/pages/import.page.ts
import { expect, type Page } from '@playwright/test';
import { CONTACTS_CSV } from '../fixtures/test-data.js';

export class ImportPage {
  constructor(
    private readonly page: Page,
    private readonly slug: string,
  ) {}

  async importFifty(): Promise<void> {
    await this.page.goto(`/w/${this.slug}/contacts/import`);
    await this.page.getByLabel(/Vyberte soubor/).setInputFiles(CONTACTS_CSV);
    await this.page.getByRole('button', { name: 'Pokračovat' }).click();

    await expect(this.page.getByText(/50 řádků/)).toBeVisible();
    await this.page.getByRole('button', { name: 'Pokračovat' }).click();

    await this.page.getByLabel('Jméno').selectOption({ label: 'Jméno a příjmení' });
    await this.page.getByLabel('E-mail').selectOption({ label: 'E-mail' });
    await this.page.getByRole('button', { name: 'Pokračovat' }).click();

    // Krok 4 z 8.3.4: náhled musí ukázat výsledné oslovení včetně fallbacku.
    await expect(this.page.getByRole('columnheader', { name: 'Oslovení' })).toBeVisible();
    await expect(this.page.getByText('Dobrý den, Jano')).toBeVisible();
    await this.page.getByRole('button', { name: 'Pokračovat' }).click();
    await this.page.getByRole('button', { name: /Naimportovat/ }).click();

    await expect(this.page.getByText(/Import dokončen/)).toBeVisible({ timeout: 60_000 });
  }
}
```

```ts
// apps/web/e2e/golden/pages/template.page.ts
import { expect, type Page } from '@playwright/test';
import { CAMPAIGN } from '../fixtures/test-data.js';

export class TemplatePage {
  constructor(
    private readonly page: Page,
    private readonly slug: string,
  ) {}

  async createFromStarter(): Promise<void> {
    await this.page.goto(`/w/${this.slug}/templates`);
    await this.page.getByRole('button', { name: 'Vytvořit šablonu' }).click();
    await this.page.getByRole('button', { name: /Univerzální základní/ }).click();
    await this.page.getByLabel('Název šablony').fill(CAMPAIGN.templateName);
    await this.page.getByLabel('Předmět').fill(CAMPAIGN.subject);
    await this.page.getByRole('button', { name: 'Uložit' }).click();
    await expect(this.page.getByText(/Šablona uložena/)).toBeVisible();
  }
}
```

```ts
// apps/web/e2e/golden/pages/segment.page.ts
import { expect, type Page } from '@playwright/test';
import { CAMPAIGN } from '../fixtures/test-data.js';

export class SegmentPage {
  constructor(
    private readonly page: Page,
    private readonly slug: string,
  ) {}

  async createActiveNinetyDays(): Promise<number> {
    await this.page.goto(`/w/${this.slug}/contacts/segments`);
    await this.page.getByRole('button', { name: 'Postavit vlastní segment' }).click();
    await this.page.getByLabel('Název segmentu').fill(CAMPAIGN.segmentName);
    await this.page.getByRole('button', { name: 'Přidat podmínku' }).click();
    await this.page.getByLabel('Pole').selectOption({ label: 'Přidán' });
    await this.page.getByLabel('Podmínka').selectOption({ label: 'za posledních N dní' });
    await this.page.getByLabel('Hodnota').fill('90');

    const count = this.page.getByTestId('segment-live-count');
    await expect(count).toBeVisible();
    await expect(count).not.toHaveText('');
    const text = (await count.textContent()) ?? '0';

    await this.page.getByRole('button', { name: 'Uložit segment' }).click();
    await expect(this.page.getByText(/Segment uložen/)).toBeVisible();
    return Number(text.replace(/\D/g, ''));
  }
}
```

```ts
// apps/web/e2e/golden/pages/campaign.page.ts
import { expect, type Locator, type Page } from '@playwright/test';
import { CAMPAIGN } from '../fixtures/test-data.js';

export class CampaignPage {
  constructor(
    private readonly page: Page,
    private readonly slug: string,
  ) {}

  async createFromTemplateAndSegment(): Promise<void> {
    await this.page.goto(`/w/${this.slug}/campaigns`);
    await this.page.getByRole('button', { name: 'Vytvořit kampaň' }).click();
    await this.page.getByLabel('Název kampaně').fill(CAMPAIGN.name);
    await this.page.getByLabel('Šablona').selectOption({ label: CAMPAIGN.templateName });
    await this.page.getByRole('tab', { name: 'Publikum' }).click();
    await this.page.getByLabel('Segment').selectOption({ label: CAMPAIGN.segmentName });
  }

  get trialModeNotice(): Locator {
    return this.page.getByTestId('trial-mode-audience-notice');
  }

  async sendTestTo(email: string): Promise<void> {
    await this.page.getByRole('button', { name: 'Poslat test' }).click();
    await this.page.getByLabel('E-mail').fill(email);
    await this.page.getByRole('button', { name: 'Odeslat' }).click();
    await expect(this.page.getByText(/Testovací e-mail odešel/)).toBeVisible();
  }

  async send(): Promise<void> {
    await this.page.getByRole('tab', { name: 'Příprava' }).click();
    const button = this.page.getByRole('button', { name: /^Odeslat \d/ });
    await expect(button).toBeVisible();
    await button.click();
    await this.page.getByRole('dialog').getByRole('button', { name: /Odeslat/ }).click();
  }

  async expectLiveProgress(): Promise<void> {
    await expect(this.page.getByTestId('campaign-progress')).toBeVisible({ timeout: 60_000 });
  }
}
```

```ts
// apps/web/e2e/golden/pages/report.page.ts
import { expect, type Page } from '@playwright/test';

export class ReportPage {
  constructor(
    private readonly page: Page,
    private readonly slug: string,
  ) {}

  async open(): Promise<void> {
    await this.page.getByRole('tab', { name: 'Report' }).click();
  }

  /** Hlavní tři dlaždice podle 8.7.2: doručeno, kliklo, odhlásilo se. */
  async expectHeadlineTiles(): Promise<void> {
    await expect(this.page.getByTestId('tile-delivered')).toBeVisible({ timeout: 90_000 });
    await expect(this.page.getByTestId('tile-clicked')).toBeVisible();
    await expect(this.page.getByTestId('tile-unsubscribed')).toBeVisible();
  }

  /** Míra otevření nesmí být hlavní metrika a musí mít poznámku o nepřesnosti. */
  async expectOpenRateCaveat(): Promise<void> {
    await expect(this.page.getByTestId('open-rate-caveat')).toBeVisible();
  }

  async expectDenominatorNextToEveryPercentage(): Promise<void> {
    const percentages = this.page.getByTestId(/^metric-percentage-/);
    const count = await percentages.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      await expect(percentages.nth(i)).toHaveAttribute('data-basis', /\S/);
    }
  }
}
```

- [ ] **Krok 5: Commit**

```bash
git add apps/web/e2e/golden/pages
git commit -m "test(e2e): add page objects for the golden path"
```

---

### Úkol 31: Test zlaté cesty

**Soubory:**
- Vytvoř: `apps/web/e2e/golden/specs/golden-path.spec.ts`

- [ ] **Krok 1: Napiš test celé cesty**

```ts
// apps/web/e2e/golden/specs/golden-path.spec.ts
import { expect, test } from '@playwright/test';
import { clearMailbox, extractLink, extractOpenPixel, waitForMessage } from '../fixtures/mailpit.js';
import { CAMPAIGN, VERIFIED_RECIPIENT } from '../fixtures/test-data.js';
import { SetupPage } from '../pages/setup.page.js';
import { OnboardingPage } from '../pages/onboarding.page.js';
import { SendingPage } from '../pages/sending.page.js';
import { ImportPage } from '../pages/import.page.js';
import { TemplatePage } from '../pages/template.page.js';
import { SegmentPage } from '../pages/segment.page.js';
import { CampaignPage } from '../pages/campaign.page.js';
import { ReportPage } from '../pages/report.page.js';

/**
 * Zlatá cesta z kapitoly 7 hlavní specifikace, provedená na čisté instalaci:
 * instalace, připojení odesílání, import kontaktů, vytvoření šablony,
 * vytvoření segmentu, odeslání kampaně, kvalitní report.
 *
 * Jede se jedním souvislým scénářem, ne osmi nezávislými testy. Zlatá cesta
 * je jeden tok a rozdělení na nezávislé testy by znamenalo osm instalací
 * a ztrátu právě té vlastnosti, kterou má test doložit.
 */
test('zlatá cesta od instalace k reportu', async ({ page }) => {
  test.slow();
  await clearMailbox();

  // 1. Instalace: průvodce vytvoří správce a první projekt.
  const setup = new SetupPage(page);
  await setup.open();
  const slug = await setup.createAdminAndProject();

  const onboarding = new OnboardingPage(page, slug);
  await onboarding.openDashboard();
  await expect(onboarding.panel).toBeVisible();
  await onboarding.expectStepNotDone('Nastavte odesílání');

  // 2. Připojení odesílání ve zkušebním režimu, viz rozpor R2.
  const sending = new SendingPage(page, slug);
  await sending.open();
  await sending.connectSmtpInTrialMode();
  await sending.verifyRecipient();

  await onboarding.openDashboard();
  await onboarding.expectStepDone('Nastavte odesílání');

  // 3. Import kontaktů včetně kontroly oslovení.
  await new ImportPage(page, slug).importFifty();
  await onboarding.openDashboard();
  await onboarding.expectStepDone('Přidejte kontakty');

  // 4. Šablona. AI krok je z testu vynechaný, viz kapitola 3 plánu.
  await new TemplatePage(page, slug).createFromStarter();
  await onboarding.openDashboard();
  await onboarding.expectStepDone('Připravte e-mail');

  // 5. Segment s živým počtem.
  const segmentSize = await new SegmentPage(page, slug).createActiveNinetyDays();
  expect(segmentSize).toBeGreaterThan(0);

  // 6. Kampaň: test, potom odeslání.
  const campaign = new CampaignPage(page, slug);
  await campaign.createFromTemplateAndSegment();
  await campaign.sendTestTo(VERIFIED_RECIPIENT);
  const testMail = await waitForMessage(VERIFIED_RECIPIENT, { subjectContains: CAMPAIGN.subject });
  expect(testMail.html).toContain('Dobrý den');

  await onboarding.openDashboard();
  await onboarding.expectStepDone('Pošlete si test');

  await page.goto(`/w/${slug}/campaigns`);
  await page.getByRole('link', { name: CAMPAIGN.name }).click();
  await campaign.send();
  await campaign.expectLiveProgress();

  // 7. Otevření, proklik a časová osa.
  const delivered = await waitForMessage(VERIFIED_RECIPIENT, {
    subjectContains: CAMPAIGN.subject,
    timeoutMs: 120_000,
  });
  const pixel = extractOpenPixel(delivered.html);
  expect((await page.request.get(pixel)).ok()).toBe(true);
  const clickUrl = extractLink(delivered.html, '/t/c/');
  const clickResponse = await page.request.get(clickUrl, { maxRedirects: 0 });
  expect([301, 302, 307, 308]).toContain(clickResponse.status());

  // 8. Report.
  const report = new ReportPage(page, slug);
  await report.open();
  await report.expectHeadlineTiles();
  await report.expectOpenRateCaveat();
  await report.expectDenominatorNextToEveryPercentage();

  // 9. Onboarding je hotový a hlásí to jednorázově.
  await onboarding.openDashboard();
  await expect(page.getByText('Hotovo, první kampaň odeslána.')).toBeVisible();
});
```

- [ ] **Krok 2: Spusť test proti čerstvému compose**

Spusť: `pnpm --filter @mlain/web run test:e2e:golden`
Očekávej: nejdřív FAIL na první obrazovce, která ještě nemá čekaný tvar. Rozdíly řeš **v objektu obrazovky**, ne ve scénáři, a nikdy ne změnou souboru cizího plánu. Když obrazovka chybí úplně, je to nález proti plánu, který ji vlastní, a zapíše se do kapitoly 6.

- [ ] **Krok 3: Commit**

```bash
git add apps/web/e2e/golden/specs/golden-path.spec.ts
git commit -m "test(e2e): cover the full golden path against a live compose stack"
```

---

### Úkol 32: Zkušební režim, jeho riziko a ukázková data v E2E

**Soubory:**
- Vytvoř: `apps/web/e2e/golden/specs/trial-mode.spec.ts`, `apps/web/e2e/golden/specs/demo-data.spec.ts`

- [ ] **Krok 1: Napiš test rizika ze 8.2.9**

```ts
// apps/web/e2e/golden/specs/trial-mode.spec.ts
import { expect, test } from '@playwright/test';
import { clearMailbox, messageCount } from '../fixtures/mailpit.js';
import { SetupPage } from '../pages/setup.page.js';
import { SendingPage } from '../pages/sending.page.js';
import { ImportPage } from '../pages/import.page.js';
import { TemplatePage } from '../pages/template.page.js';
import { CampaignPage } from '../pages/campaign.page.js';

/**
 * Riziko z 8.2.9: uživatel postaví kampaň na velké publikum a teprve při
 * odeslání zjistí, že je ve zkušebním režimu. Zmírnění je pruh na obrazovce
 * publika s konkrétními čísly. Pruh vlastní P13, tenhle test ho vynucuje.
 */
test('zkušební režim říká na publiku, kolika lidem se opravdu odešle', async ({ page }) => {
  test.slow();
  await clearMailbox();

  const slug = await new SetupPage(page).open().then(() => new SetupPage(page).createAdminAndProject());
  const sending = new SendingPage(page, slug);
  await sending.open();
  await sending.connectSmtpInTrialMode();
  await sending.verifyRecipient();

  await new ImportPage(page, slug).importFifty();
  await new TemplatePage(page, slug).createFromStarter();

  const campaign = new CampaignPage(page, slug);
  await campaign.createFromTemplateAndSegment();

  const notice = campaign.trialModeNotice;
  await expect(notice).toBeVisible();

  // Ve větě musí být obě čísla: kolik lidí je v publiku a kolika se odešle.
  const text = (await notice.textContent()) ?? '';
  const numbers = [...text.matchAll(/\d+/g)].map((m) => Number(m[0]));
  expect(numbers.length).toBeGreaterThanOrEqual(2);
  expect(Math.max(...numbers)).toBeGreaterThan(Math.min(...numbers));
  expect(text).toMatch(/ověřen/i);
});

test('kampaň ve zkušebním režimu odejde jen na ověřené adresy', async ({ page }) => {
  test.slow();
  const before = await messageCount();
  const slug = await new SetupPage(page).open().then(() => new SetupPage(page).createAdminAndProject());
  const sending = new SendingPage(page, slug);
  await sending.open();
  await sending.connectSmtpInTrialMode();
  await sending.verifyRecipient();
  await new ImportPage(page, slug).importFifty();
  await new TemplatePage(page, slug).createFromStarter();

  const campaign = new CampaignPage(page, slug);
  await campaign.createFromTemplateAndSegment();
  await campaign.send();
  await campaign.expectLiveProgress();
  await page.waitForTimeout(10_000);

  // Padesát kontaktů v publiku, ale jen jedna ověřená adresa plus potvrzovací e-mail.
  expect((await messageCount()) - before).toBeLessThan(5);
});

test('report kampaně ze zkušebního režimu to trvale připomíná', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('trial-mode-report-banner').or(page.getByText(/zkušebním režimu/i)))
    .toBeVisible({ timeout: 30_000 });
});
```

- [ ] **Krok 2: Napiš test ukázkových dat**

```ts
// apps/web/e2e/golden/specs/demo-data.spec.ts
import { expect, test } from '@playwright/test';
import { SetupPage } from '../pages/setup.page.js';
import { OnboardingPage } from '../pages/onboarding.page.js';

test('ukázková data jde nahrát, hromadně vybrat i beze zbytku smazat', async ({ page }) => {
  test.slow();

  const setup = new SetupPage(page);
  await setup.open();
  const slug = await setup.createAdminAndProject();

  const onboarding = new OnboardingPage(page, slug);
  await onboarding.openDashboard();

  // Nahrání z panelu onboardingu, kde jsou ukázková data rovnocennou nabídkou.
  await onboarding.loadDemoData();
  await expect(page.getByText('Ukázková data jsou v projektu.')).toBeVisible();

  await onboarding.openDashboard();
  await expect(onboarding.demoBanner).toBeVisible();
  await expect(page.getByText(/50 ukázkových kontaktů/)).toBeVisible();

  // Krok „Přidejte kontakty" zůstává neodškrtnutý, protože ukázková data
  // nejsou nastavení, jen ukázka.
  await onboarding.expectStepNotDone('Přidejte kontakty');

  // Hromadný výběr přes štítek, rozhodnutí zadavatele Z2.
  await page.goto(`/w/${slug}/contacts?tag=ukazkova-data`);
  await expect(page.getByRole('row')).toHaveCount(51); // 50 řádků plus hlavička
  await page.getByRole('checkbox', { name: /Vybrat vše/ }).check();
  await expect(page.getByText(/Vybráno 50/)).toBeVisible();

  // Odstranění jedním tlačítkem s potvrzením N2.
  await onboarding.openDashboard();
  await onboarding.removeDemoData();
  await expect(page.getByText('Ukázková data jsou pryč.')).toBeVisible();

  await onboarding.openDashboard();
  await expect(onboarding.demoBanner).toBeHidden();
  await page.goto(`/w/${slug}/contacts`);
  await expect(page.getByText(/Zatím tu nejsou žádné kontakty/)).toBeVisible();

  // Po smazání jde sada nahrát znovu.
  await onboarding.openDashboard();
  await onboarding.loadDemoData();
  await expect(page.getByText('Ukázková data jsou v projektu.')).toBeVisible();
});

test('ukázkové publikum se v kontrolním seznamu kampaně pozná', async ({ page }) => {
  // Rozhraní I→P13.1: kontrolní seznam musí říct, že publikum obsahuje jen
  // ukázkové kontakty. Když tenhle test spadne, patří oprava do P13.
  await page.goto('/');
  await expect(
    page.getByText(/Publikum obsahuje jen ukázkové kontakty/).or(page.getByTestId('preflight-demo-only')),
  ).toBeVisible({ timeout: 30_000 });
});
```

- [ ] **Krok 3: Spusť a commitni**

Spusť: `pnpm --filter @mlain/web run test:e2e:golden -- trial-mode demo-data`
Očekávej: PASS. Selhání v testech označených jako rozhraní I→P13.1 a I→P13.2 zapiš do kapitoly 6 jako nález proti P13.

```bash
git add apps/web/e2e/golden/specs/trial-mode.spec.ts apps/web/e2e/golden/specs/demo-data.spec.ts
git commit -m "test(e2e): cover trial mode risk and sample data lifecycle"
```

---

### Úkol 33: Zálohy proti běžícímu compose a první spuštění

**Soubory:**
- Vytvoř: `apps/web/e2e/golden/specs/backup-restore.spec.ts`, `apps/web/e2e/golden/specs/first-run.spec.ts`

- [ ] **Krok 1: Napiš test kritérií 9 až 13 proti skutečnému kontejneru**

```ts
// apps/web/e2e/golden/specs/backup-restore.spec.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import { SetupPage } from '../pages/setup.page.js';
import { OnboardingPage } from '../pages/onboarding.page.js';

const run = promisify(execFile);

const COMPOSE = ['compose', '-f', 'docker/compose.yml', '-f', 'apps/web/e2e/golden/compose.e2e.yml'];

async function mlain(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const r = await run('docker', [...COMPOSE, 'exec', '-T', 'app', 'mlain', ...args], {
      maxBuffer: 32e6,
    });
    return { code: 0, stdout: r.stdout, stderr: r.stderr };
  } catch (err) {
    const e = err as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

test.describe('zálohy proti běžící instalaci', () => {
  test.slow();

  test('kritéria 9 a 10: záloha má tři soubory, sedící počet a projde ověřením', async ({ page }) => {
    const setup = new SetupPage(page);
    await setup.open();
    const slug = await setup.createAdminAndProject();
    await new OnboardingPage(page, slug).openDashboard();
    await page.request.post('/api/v1/demo-data');

    const backup = await mlain(['backup']);
    expect(backup.code).toBe(0);
    expect(backup.stdout).toMatch(/Kontaktů v záloze: 50/);
    expect(backup.stdout).toMatch(/keyring/i);

    const dir = /Záloha hotová: (\S+)/.exec(backup.stdout)?.[1];
    expect(dir).toBeTruthy();

    const listing = await run('docker', [...COMPOSE, 'exec', '-T', 'app', 'ls', dir!]);
    expect(listing.stdout).toContain('database.dump');
    expect(listing.stdout).toContain('uploads.tar.gz');
    expect(listing.stdout).toContain('manifest.json');

    const verify = await mlain(['backup', 'verify', dir!]);
    expect(verify.code).toBe(0);

    const leftovers = await run('docker', [
      ...COMPOSE,
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'postgres',
      '-tAc',
      "SELECT count(*) FROM pg_database WHERE datname LIKE 'ml_verify_%'",
    ]);
    expect(leftovers.stdout.trim()).toBe('0');
  });

  test('kritérium 11: obnova do neprázdné databáze bez --force selže a nic nezmění', async () => {
    const list = await mlain(['backup', 'list']);
    const name = list.stdout.trim().split('\n')[0].split('\t')[0];

    const before = await mlain(['doctor', '--json']);
    const restore = await mlain(['restore', `/data/backups/${name}`]);
    expect(restore.code).not.toBe(0);
    expect(restore.stderr).toMatch(/není prázdná/);
    expect(restore.stderr).toMatch(/Nic jsem nezměnil/);

    const after = await mlain(['doctor', '--json']);
    expect(after.stdout).toBe(before.stdout);
  });

  test('kritérium 12: záloha z novější verze je odmítnutá', async () => {
    const list = await mlain(['backup', 'list']);
    const name = list.stdout.trim().split('\n')[0].split('\t')[0];
    await run('docker', [
      ...COMPOSE,
      'exec',
      '-T',
      'app',
      'sh',
      '-c',
      `sed -i 's/"app_version": "[^"]*"/"app_version": "999.0.0"/' /data/backups/${name}/manifest.json`,
    ]);
    const restore = await mlain(['restore', `/data/backups/${name}`, '--force']);
    expect(restore.code).not.toBe(0);
    expect(restore.stderr).toContain('backup_from_newer_version');
  });

  test('mlain doctor na zdravé instalaci nehlásí kritický nález', async () => {
    const doctor = await mlain(['doctor']);
    expect(doctor.code).toBe(0);
    expect(doctor.stdout).not.toContain('[KRITICKÉ]');
  });

  test('mlain doctor bez starého pokolení klíče hlásí kritickou chybu', async () => {
    // Simulace ztráty starého klíče: suppression řádek pod pokolením 7,
    // které instalace nezná.
    await run('docker', [
      ...COMPOSE,
      'exec',
      '-T',
      'postgres',
      'psql',
      '-U',
      'postgres',
      '-d',
      'mlain',
      '-c',
      `INSERT INTO suppressions (workspace_id, email, reason, source, fingerprint, fingerprint_key_id)
       SELECT id, 'ztraceny@example.com', 'hard_bounce', 'ses_event',
              decode(repeat('ab', 16), 'hex'), 7 FROM workspaces LIMIT 1`,
    ]);
    const doctor = await mlain(['doctor']);
    expect(doctor.code).toBe(2);
    expect(doctor.stdout).toContain('missing_key_generations');
    expect(doctor.stdout).toContain('[KRITICKÉ]');
    expect(doctor.stdout).toMatch(/nejdou přepočítat/);
  });
});
```

- [ ] **Krok 2: Napiš test prvního spuštění a kroku 0**

```ts
// apps/web/e2e/golden/specs/first-run.spec.ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { SetupPage } from '../pages/setup.page.js';

const run = promisify(execFile);
const COMPOSE = ['compose', '-f', 'docker/compose.yml', '-f', 'apps/web/e2e/golden/compose.e2e.yml'];

test('krok 0: výpis kontejneru řekne, kam jít a co udělat', async () => {
  // Požadavek U→1.9 části 6 a rozhraní I→P01.5. Banner vlastní entrypoint P01,
  // tenhle test ho vynucuje.
  const logs = await run('docker', [...COMPOSE, 'logs', '--no-color', 'app'], { maxBuffer: 32e6 });
  expect(logs.stdout).toContain('Mlain Mailer je připravený');
  expect(logs.stdout).toContain('http://localhost:3000');
  expect(logs.stdout).toMatch(/Účet správce si založíte na první obrazovce/);
});

test('registrace je otevřená jen dokud neexistuje první uživatel', async ({ page, request }) => {
  await page.goto('/setup');
  await expect(page.getByText(/Instalace je zatím otevřená/)).toBeVisible();

  const setup = new SetupPage(page);
  await setup.createAdminAndProject();

  const second = await request.post('/api/v1/setup', {
    data: { email: 'druhy@firma.cz', password: 'jine-heslo-2026', name: 'Druhý' },
  });
  expect(second.status()).toBe(409);
  expect((await second.json()).code).toBe('setup_already_completed');
});

test('přihlašovací stránka nabízí obnovu hesla z příkazové řádky', async ({ page }) => {
  // Požadavek U→1.8 a rozhraní I→P06.1.
  await page.goto('/login');
  await expect(page.getByText(/Odesílání ještě není nastavené/)).toBeVisible();
});

test('mlain reset-password vrátí přístup do zamčené instalace', async ({ page }) => {
  const result = await run('docker', [
    ...COMPOSE,
    'exec',
    '-T',
    'app',
    'mlain',
    'reset-password',
    'jana@firma.cz',
  ]);
  const password = /\n\n {2}(\S+)\n/.exec(result.stdout)?.[1];
  expect(password).toBeTruthy();

  await page.goto('/login');
  await page.getByLabel('E-mail').fill('jana@firma.cz');
  await page.getByLabel('Heslo').fill(password!);
  await page.getByRole('button', { name: 'Přihlásit se' }).click();
  await expect(page).toHaveURL(/\/w\//);
});

test('obrazovky P16 nemají závažné prohřešky proti přístupnosti', async ({ page }) => {
  for (const path of ['/setup', '/login']) {
    await page.goto(path);
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
  }
});
```

- [ ] **Krok 3: Spusť a commitni**

Spusť: `pnpm --filter @mlain/web run test:e2e:golden -- backup-restore first-run`
Očekávej: PASS. Selhání testu banneru je nález proti P01 (rozhraní I→P01.5), ne důvod měnit `docker/entrypoint.sh`.

```bash
git add apps/web/e2e/golden/specs/backup-restore.spec.ts apps/web/e2e/golden/specs/first-run.spec.ts
git commit -m "test(e2e): verify backup criteria 9 to 13 and first run against live compose"
```

---

### Úkol 34: Zapojení do CI a jeho hlídač

**Soubory:**
- Vytvoř: `apps/web/test/ci/e2e-wiring.test.ts`

Job `e2e` v CI vlastní P01. P16 na něj nesahá, ale ověřuje, že skutečně spouští to, co P16 dodal. Bez toho by se testy zlaté cesty tiše neprováděly a nikdo by si toho nevšiml, protože zelené CI vypadá stejně.

- [ ] **Krok 1: Napiš padající test**

```ts
// apps/web/test/ci/e2e-wiring.test.ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const CI_PATH = '.github/workflows/ci.yml';
const WEB_PKG = 'apps/web/package.json';

describe('zapojení E2E do CI', () => {
  it('apps/web má skript test:e2e:golden, který pouští konfiguraci zlaté cesty', async () => {
    const pkg = JSON.parse(await readFile(WEB_PKG, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.['test:e2e:golden']).toContain('playwright.golden.config.ts');
  });

  it('skript test:e2e pouští obě konfigurace, aby na zlatou cestu nikdo nezapomněl', async () => {
    const pkg = JSON.parse(await readFile(WEB_PKG, 'utf8')) as {
      scripts?: Record<string, string>;
    };
    expect(pkg.scripts?.['test:e2e']).toContain('test:e2e:golden');
  });

  it('job e2e v CI existuje a spouští test:e2e', async () => {
    const ci = await readFile(CI_PATH, 'utf8');
    expect(ci).toMatch(/^\s{2}e2e:/m);
    expect(ci).toContain('test:e2e');
  });

  it('job e2e má limit aspoň 20 minut podle tabulky v 3.15', async () => {
    const ci = await readFile(CI_PATH, 'utf8');
    const block = /^\s{2}e2e:[\s\S]*?(?=^\s{2}\w|\Z)/m.exec(ci)?.[0] ?? '';
    const minutes = Number(/timeout-minutes:\s*(\d+)/.exec(block)?.[1] ?? '0');
    expect(minutes).toBeGreaterThanOrEqual(20);
  });

  it('job e2e archivuje log kontejneru, aby se pád dal vyšetřit', async () => {
    const ci = await readFile(CI_PATH, 'utf8');
    const block = /^\s{2}e2e:[\s\S]*?(?=^\s{2}\w|\Z)/m.exec(ci)?.[0] ?? '';
    expect(block).toContain('upload-artifact');
    expect(block).toMatch(/playwright-report-golden/);
  });
});
```

- [ ] **Krok 2: Spusť a vyhodnoť**

Spusť: `pnpm vitest run apps/web/test/ci/e2e-wiring.test.ts`
Očekávej: FAIL na položkách, které P01 ještě nemá. Každý červený řádek je konkrétní nález proti P01 (rozhraní I→P01.4). **Neopravuj `.github/workflows/ci.yml` ani `apps/web/package.json`**, zapiš nález do kapitoly 6 a předej ho vlastníkovi.

- [ ] **Krok 3: Commit**

```bash
git add apps/web/test/ci/e2e-wiring.test.ts
git commit -m "test(ci): assert the e2e job actually runs the golden path suite"
```

---

### Úkol 35: Provozní runbooky

**Soubory:**
- Vytvoř: `docs/operations/backup-restore.md`, `key-rotation.md`, `upgrade.md`, `demo-runbook.md`

- [ ] **Krok 1: Napiš runbook záloh a obnovy**

`docs/operations/backup-restore.md` musí obsahovat v tomhle pořadí:

1. **Co v záloze je a co ne.** Databáze celá, `/data/uploads`, ne `SECRET_KEY`, ne konfigurace.
2. **Věta o keyringu, hned na druhém místě, ne v poznámce pod čarou:** „Klíč v záloze schválně není. Uložte si zvlášť **celý keyring**, tedy `SECRET_KEY` i všechna předchozí pokolení ze `SECRET_KEY_PREVIOUS`. Recovery bundle jen s aktuálním klíčem je nefunkční recovery bundle: otisky smazaných adres pod starými pokoleními se přestanou shodovat, smazaný člověk se vrátí prvním dalším importem, import proběhne úspěšně a nezaloguje se nic."
3. **Ruční záloha:** `docker compose exec app mlain backup`.
4. **Plánovaná záloha:** `BACKUP_SCHEDULE_CRON`, výchozí `0 3 * * *`, běží jen v `MODE=worker` a `MODE=all`.
5. **Retence:** `BACKUP_RETENTION_DAYS`, výchozí 14, vždy zůstanou tři poslední.
6. **Ověření:** `mlain backup verify <adresář>`, co dělá a proč nestačí zkontrolovat, že soubor existuje.
7. **Obnova:** všechny čtyři brány a co znamená každá hláška, včetně `backup_from_newer_version` a `--i-know-the-key-differs`.
8. **Externí cíl:** hook `/data/hooks/post-backup.sh` dostane cestu k adresáři jako první argument.
9. **Upozornění na soukromí:** zálohy obsahují osobní údaje, doporučený šifrovaný svazek pro `/data/backups`.

- [ ] **Krok 2: Napiš runbook rotace klíče**

`docs/operations/key-rotation.md` obsahuje přesně postup z výstupu `mlain genkey`, doplněný o:

- větu, že **pořadí kroků 2 a 3 se nesmí prohodit** a co se stane, když se prohodí (sender běží se starým klíčem, konfigurace je zašifrovaná novým, každé dešifrování selže, u kampaně na milion příjemců je to milion zpráv označených jako neúspěšné),
- větu, že **`SECRET_KEY_PREVIOUS` se nikdy nevyprazdňuje**, ani po `mlain rotate-credentials`,
- co dělat po ztrátě klíče: `mlain doctor` to pozná, jediná oprava je zadat přístupy k providerům a AI klíče znovu, trackovací tokeny ze starých kampaní přestanou platit.

- [ ] **Krok 3: Napiš runbook upgradu**

`docs/operations/upgrade.md` popisuje dvě cesty:

- **jednoduchou**, `docker compose pull && docker compose up -d`,
- **opatrnou**, `mlain upgrade`, a **výslovně říká, že procesy nezastavuje ani nespouští** a proč: docker socket uvnitř kontejneru je root na hostiteli a zahodil by celý bezpečnostní model. Postup je tedy: zastavit procesy ručně, spustit `mlain upgrade`, spustit procesy zpět, spustit `mlain doctor`.

- [ ] **Krok 4: Napiš runbook dema**

`docs/operations/demo-runbook.md` je scénář živého dema, devět bodů z kapitoly 8 hlavní specifikace, s jedinou změnou:

> **Krok 2 se nepředvádí přes ověření domény.** DNS propagace trvá minuty až hodiny, takže se ověření v živém demu nedá spolehlivě předvést; specifikace to eviduje jako rozpor R2. V demu se místo toho zapne **zkušební režim**, ověří se jedna adresa a odešle se na ni. Ověřování domény se ukáže jako obrazovka se záznamy a delegačním odkazem, bez čekání na výsledek.

Runbook dál obsahuje:

- přípravu před demem: čerstvá instalace, `mlain backup` hotový, ukázková data nahraná v druhém projektu pro případ, že import selže,
- záložní plán pro každý krok, který závisí na síti,
- odhad času 12 minut aktivní práce.

- [ ] **Krok 5: Splň licenční povinnost LGPL u knihovny `sharp`, nález N15**

**Tohle není formalita, je to podmínka distribuce.** Zadavatel rozhodl 2026-08-01, že `sharp` v produktu zůstává, a licenční brána P01 pro něj má jmennou výjimku na `@img/sharp-libvips-*` a `@img/sharp-win32-*`. Výjimka ale nese povinnost, a ta je zapsaná v `licenses.allow.json` na P16: **přiložit plný text LGPL-3.0 a zdokumentovat, jak knihovnu vyměnit.**

Sám `sharp` je Apache-2.0. LGPL-3.0-or-later nese předkompilovaná nativní knihovna `libvips` pod ním. V linuxové produkční image se linkuje dynamicky, takže povinnost zůstává u distribuce té knihovny, ne u našeho kódu: musíme příjemci dát text licence a umožnit mu knihovnu nahradit vlastní verzí. Bez obojího distribuujeme LGPL komponentu v rozporu s licencí.

Vytvoř `docs/operations/third-party-licenses.md` s tímhle obsahem:

1. **Seznam komponent pod copyleftem**, které se s produktem šíří: `@img/sharp-libvips-*` (LGPL-3.0-or-later) a odkaz na výjimku v `licenses.allow.json` včetně data expirace.
2. **Kde je plný text licence.** Soubor `LICENSES/LGPL-3.0.txt` v repozitáři a cesta `/app/LICENSES/LGPL-3.0.txt` v běžící image.
3. **Postup výměny knihovny**, konkrétní a spustitelný, ne odkaz na dokumentaci sharpu:

   ```bash
   # 1. Sestav vlastní libvips a nainstaluj ho do image.
   # 2. Řekni sharpu, aby použil systémovou knihovnu místo přibalené:
   docker build --build-arg SHARP_FORCE_GLOBAL_LIBVIPS=1 -f docker/Dockerfile .
   # 3. Ověř, že se nelinkuje přibalená kopie:
   docker run --rm mlain:local node -e "console.log(require('sharp').versions)"
   ```

4. **Co produkt bez `sharp` ztratí**, kdyby se ho někdo rozhodl vypustit místo vyměnit: extrakci značky z webu (`brand_extractions`) a generování variant obrázků. Zbytek funguje.

Dál založ `LICENSES/LGPL-3.0.txt` s plným textem licence stažené z `https://www.gnu.org/licenses/lgpl-3.0.txt`.

**Požadavek na P01 (I→P01.6):** do `docker/Dockerfile` přidat `COPY LICENSES ./LICENSES`, aby byl text licence i v běžící image, ne jen v repozitáři. `docker/**` vlastní P01 a P16 do něj nesahá. Bez toho je povinnost splněná jen napůl: příjemce image text licence nemá.

- [ ] **Krok 6: Napiš test, který licenční povinnost hlídá**

Povinnost, kterou hlídá jen dobrá vůle, se při první reorganizaci repozitáře ztratí. Test se **neptá plánu ani dokumentace**, ale porovná skutečný obsah `licenses.allow.json` se soubory na disku.

```ts
// apps/web/test/ci/license-obligations.test.ts
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';

const root = new URL('../../../../', import.meta.url);

describe('licenční povinnosti z licenses.allow.json', () => {
  it('každá výjimka s povinností má splněnou svou podmínku', async () => {
    const allow = JSON.parse(
      await readFile(new URL('licenses.allow.json', root), 'utf8'),
    ) as { exceptions: { package: string; obligations?: string }[] };

    const withObligations = allow.exceptions.filter((e) => e.obligations);
    expect(withObligations.length).toBeGreaterThan(0);

    // Plný text licence musí existovat a být to opravdu on, ne zástupný soubor.
    const lgpl = await readFile(new URL('LICENSES/LGPL-3.0.txt', root), 'utf8');
    expect(lgpl).toContain('GNU LESSER GENERAL PUBLIC LICENSE');
    expect(lgpl.length).toBeGreaterThan(5000);

    // Postup výměny musí být konkrétní, tedy obsahovat spustitelný příkaz.
    const doc = await readFile(new URL('docs/operations/third-party-licenses.md', root), 'utf8');
    expect(doc).toContain('SHARP_FORCE_GLOBAL_LIBVIPS');
    expect(doc).toContain('@img/sharp-libvips');
  });

  it('Dockerfile kopíruje text licence do image', async () => {
    const dockerfile = await readFile(new URL('docker/Dockerfile', root), 'utf8');
    expect(dockerfile).toContain('LICENSES');
  });
});
```

Druhý test je červený, dokud P01 nedoplní `COPY LICENSES ./LICENSES`. Je to požadavek I→P01.6 a **neobchází se** smazáním testu.

- [ ] **Krok 7: Commit**

```bash
git add docs/operations LICENSES apps/web/test/ci/license-obligations.test.ts
git commit -m "docs(operations): add runbooks and satisfy the LGPL obligation for sharp"
```

---

### Úkol 36: Uzavření plánu

- [ ] **Krok 1: Spusť kompletní sérii**

Spusť: `pnpm turbo run lint typecheck test:unit test:db`
Očekávej: všechno zelené. Když něco padá, dohledej příčinu a oprav ji ve svých souborech.

- [ ] **Krok 2: Spusť testy senderu a kontraktů**

Spusť: `pnpm turbo run test:go contracts-golden`
Očekávej: zelené. P16 do nich nezasahuje, ale musí projít, než se plán prohlásí za hotový.

- [ ] **Krok 3: Spusť E2E proti čerstvé image**

Spusť: `pnpm --filter @mlain/web run test:e2e:golden`
Očekávej: všechny scénáře zelené na **čisté instalaci**, tedy po `down --volumes`.

- [ ] **Krok 4: Ověř, že plán nesáhl mimo své soubory**

Spusť: `git diff --name-only origin/main...HEAD`
Porovnej výpis se seznamem v kapitole 5. Každý soubor mimo seznam je chyba a musí se vrátit.

- [ ] **Krok 5: Projdi tabulku kritérií**

Projdi kapitolu 7 a u každého kritéria doplň, který test ho pokrývá a jestli je zelený. Kritérium bez zeleného testu není pokryté.

- [ ] **Krok 6: Sepiš nálezy proti jiným plánům**

Do `docs/operations/p16-nalezy.md` zapiš každé rozhraní z kapitoly 0.6, které není splněné, s číslem, adresátem a odkazem na červený test. Nic z toho neopravuj sám.

- [ ] **Krok 7: Commit**

```bash
git add docs/operations/p16-nalezy.md
git commit -m "docs: record P16 findings against other plans"
```

---

## 5. Vlastnictví souborů

**P16 vytváří a mění výhradně tyhle soubory. Mimo ně nesahá na jediný řádek.**

### Zdrojové soubory

```
packages/core/src/ops/index.ts
packages/core/src/ops/audit.ts
packages/core/src/ops/run-process.ts
packages/core/src/ops/db.ts
packages/core/src/ops/keyring.ts
packages/core/src/ops/backup-manifest.ts
packages/core/src/ops/backup-guard.ts
packages/core/src/ops/backup.ts
packages/core/src/ops/backup-verify.ts
packages/core/src/ops/restore.ts
packages/core/src/ops/encrypted-columns.ts
packages/core/src/ops/rotate-credentials.ts
packages/core/src/ops/genkey.ts
packages/core/src/ops/reset-password.ts
packages/core/src/ops/rebuild-engagement.ts
packages/core/src/ops/upgrade.ts
packages/core/src/ops/jobs/backup-jobs.ts
packages/core/src/ops/doctor/types.ts
packages/core/src/ops/doctor/format.ts
packages/core/src/ops/doctor/checks-keyring.ts
packages/core/src/ops/doctor/checks-storage.ts
packages/core/src/ops/doctor/checks-runtime.ts
packages/core/src/ops/doctor/checks-workspace.ts
packages/core/src/ops/doctor/run.ts

packages/core/src/onboarding/index.ts
packages/core/src/onboarding/types.ts
packages/core/src/onboarding/state.ts

packages/core/src/demo/index.ts
packages/core/src/demo/dataset.ts
packages/core/src/demo/manifest.ts
packages/core/src/demo/seed.ts
packages/core/src/demo/purge.ts

apps/cli/src/commands/backup.ts
apps/cli/src/commands/restore.ts
apps/cli/src/commands/doctor.ts
apps/cli/src/commands/upgrade.ts
apps/cli/src/commands/rotate-credentials.ts
apps/cli/src/commands/genkey.ts
apps/cli/src/commands/rebuild-engagement.ts
apps/cli/src/commands/reset-password.ts

apps/web/src/app/api/v1/onboarding/route.ts
apps/web/src/app/api/v1/onboarding/hide/route.ts
apps/web/src/app/api/v1/demo-data/route.ts
apps/web/src/app/api/v1/backups/route.ts
apps/web/src/app/api/v1/backups/[name]/verify/route.ts
apps/web/src/app/[locale]/w/[workspaceSlug]/settings/backups/page.tsx
apps/web/src/features/onboarding/onboarding-panel.tsx
apps/web/src/features/onboarding/onboarding-step-row.tsx
apps/web/src/features/onboarding/demo-data-banner.tsx
apps/web/src/features/onboarding/demo-data-dialog.tsx
apps/web/src/features/backups/backup-list.tsx
apps/web/src/features/backups/backup-run-button.tsx

apps/web/playwright.golden.config.ts
apps/web/e2e/golden/compose.e2e.yml
apps/web/e2e/golden/global-setup.ts
apps/web/e2e/golden/global-teardown.ts
apps/web/e2e/golden/fixtures/mailpit.ts
apps/web/e2e/golden/fixtures/test-data.ts
apps/web/e2e/golden/fixtures/contacts-50.csv
apps/web/e2e/golden/pages/setup.page.ts
apps/web/e2e/golden/pages/onboarding.page.ts
apps/web/e2e/golden/pages/sending.page.ts
apps/web/e2e/golden/pages/import.page.ts
apps/web/e2e/golden/pages/template.page.ts
apps/web/e2e/golden/pages/segment.page.ts
apps/web/e2e/golden/pages/campaign.page.ts
apps/web/e2e/golden/pages/report.page.ts
apps/web/e2e/golden/specs/golden-path.spec.ts
apps/web/e2e/golden/specs/trial-mode.spec.ts
apps/web/e2e/golden/specs/demo-data.spec.ts
apps/web/e2e/golden/specs/backup-restore.spec.ts
apps/web/e2e/golden/specs/first-run.spec.ts

packages/i18n/messages/cs/onboarding.json
packages/i18n/messages/en/onboarding.json

docs/operations/backup-restore.md
docs/operations/key-rotation.md
docs/operations/upgrade.md
docs/operations/demo-runbook.md
docs/operations/third-party-licenses.md
docs/operations/p16-nalezy.md
LICENSES/LGPL-3.0.txt
```

### Testy

```
packages/core/test/support/db.ts
packages/core/test/support/db.db.test.ts
packages/core/test/ops/run-process.test.ts
packages/core/test/ops/keyring.test.ts
packages/core/test/ops/backup-manifest.test.ts
packages/core/test/ops/backup-retention.test.ts
packages/core/test/ops/genkey.test.ts
packages/core/test/ops/doctor-format.test.ts
packages/core/test/ops/doctor-storage.test.ts
packages/core/test/ops/backup-guard.db.test.ts
packages/core/test/ops/backup.db.test.ts
packages/core/test/ops/backup-verify.db.test.ts
packages/core/test/ops/backup-jobs.db.test.ts
packages/core/test/ops/restore.db.test.ts
packages/core/test/ops/doctor-keyring.db.test.ts
packages/core/test/ops/doctor-runtime.db.test.ts
packages/core/test/ops/encrypted-columns.db.test.ts
packages/core/test/ops/rotate-credentials.db.test.ts
packages/core/test/ops/reset-password.db.test.ts
packages/core/test/ops/rebuild-engagement.db.test.ts
packages/core/test/ops/upgrade.db.test.ts
packages/core/test/onboarding/state.db.test.ts
packages/core/test/demo/dataset.test.ts
packages/core/test/demo/seed.db.test.ts
packages/core/test/demo/purge.db.test.ts
apps/cli/test/commands/registration.test.ts
apps/web/src/features/onboarding/__tests__/onboarding-panel.test.tsx
apps/web/src/features/onboarding/__tests__/demo-data-banner.test.tsx
apps/web/src/features/backups/__tests__/backup-list.test.tsx
apps/web/test/ci/e2e-wiring.test.ts
apps/web/test/ci/license-obligations.test.ts
packages/i18n/test/onboarding-namespace.test.ts
```

Plus dva soubory mimo kód: `docs/operations/third-party-licenses.md` a `LICENSES/LGPL-3.0.txt`, obojí kvůli licenční povinnosti u `sharp` (nález N15).

**Mimo tenhle seznam P16 nesahá.** Konkrétně nemění: `packages/db/**`, `packages/contracts/**`, `packages/ui/**`, ostatní katalogy v `packages/i18n/messages/**`, `packages/core/src/{config,errors,queues,logging,health,shutdown}/**`, `packages/core/{identity,audit,platform,net,tx}/**`, `packages/core/src/{templates,campaigns,providers,tracking,segments}/**`, `packages/core/contacts/**`, `packages/emails/**`, `apps/sender/**`, `apps/worker/**`, `apps/cli/src/{main,registry,dispatch,exit-codes}.ts`, `apps/cli/src/commands/{config-check,healthcheck}.ts`, `apps/web/playwright.config.ts`, `apps/web/e2e/ui/**`, `apps/web/src/lib/**`, ostatní obrazovky v `apps/web/src/app/**`, `docker/**`, `.github/workflows/**`, `tools/**`, `turbo.json`, kořenový `package.json`, `pnpm-workspace.yaml`.

Když se během provádění ukáže, že něco chybí mimo tenhle seznam, **je to nález proti plánu, který oblast vlastní**, ne důvod ten soubor změnit. Nález se zapisuje do `docs/operations/p16-nalezy.md` podle úkolu 36.

---

## 6. Pokrytá akceptační kritéria

### Část 1 (platforma), kapitola 8

| # | Kritérium | Kde je pokryté |
|---|---|---|
| 9 | `mlain backup` vytvoří adresář s `database.dump`, `uploads.tar.gz` a `manifest.json`, jehož `row_counts.contacts` odpovídá skutečnosti | úkol 6 (`backup.db.test.ts`, první dva testy), úkol 33 (E2E proti kontejneru) |
| 10 | `mlain backup verify` na čerstvé záloze skončí kódem 0 a nenechá databázi `ml_verify_*` | úkol 8 (první dva testy), úkol 33 |
| 11 | `mlain restore` do neprázdné databáze bez `--force` skončí nenulově a nic nezmění | úkol 9 (první test), úkol 33 |
| 12 | `mlain restore` zálohy z novější `app_version` je odmítnutý s `backup_from_newer_version` | úkol 9 (druhý test), úkol 33 |
| 13 | Start se `schema_version` vyšší, než image zná, skončí kódem 5 a hláškou `schema_version_ahead` | kód 5 při startu vlastní P01; P16 doplňuje kontrolu `schema_version_ahead` v `mlain doctor`, úkol 13 |
| 51 až 53 | i18n: shoda klíčů, výjimka u chybějícího klíče, ICU plurály | úkol 1 pro namespace `onboarding`; obecné vynucení vlastní P05 |
| 54 | Po rotaci s ponechaným `SECRET_KEY_PREVIOUS` se starý token ověří a nový podepíše novým klíčem | kontrakt vlastní P02; P16 hlídá úplnost keyringu v úkolu 12 |
| 55 | `mlain rotate-credentials` přešifruje všechny obálky na aktuální `key_id` | úkol 17 (první a druhý test) |
| 56 | Start s jiným `SECRET_KEY` bez `SECRET_KEY_PREVIOUS` proběhne, ale readiness nese varování | readiness vlastní P01; P16 doplňuje `secret_key_fingerprint_mismatch` v úkolu 12 |

### Část 5 (tracking)

| # | Kritérium | Kde je pokryté |
|---|---|---|
| 77 | `mlain rebuild-engagement` přepočítá tabulku od nuly a výsledek se rovná přírůstkově udržovanému stavu | úkol 19 (druhý test) |

### Část 6 (UI a UX), kapitola 15

| # | Kritérium | Kde je pokryté |
|---|---|---|
| 25 | Od `docker compose up` k obrazovce vytvoření účtu neuplyne víc než 5 minut | úkol 28 (readiness do 120 s) a úkol 31 (první krok scénáře) |
| 68 | V žádném katalogu není znak U+2014 | úkol 1 (druhý test) pro namespace `onboarding` |
| 69 | V žádném katalogu není výraz ze sloupce „Nikdy nepoužívat" | úkol 1 (třetí test) |
| 70 | Každý klíč v `cs.json` má protějšek v `en.json` | úkol 1 (první test) |
| 72 | Všechny počty používají ICU `plural` včetně `=0` | úkol 1 (čtvrtý test) |

### Hlavní specifikace, kapitola 8, definition of done

| Bod demo skriptu | Kde je pokrytý |
|---|---|
| 1 instalace a průvodce | úkol 31, kroky 1 a 2 scénáře |
| 2 připojení odesílání (ve variantě podle rozporu R2) | úkol 31 a celý úkol 32 |
| 3 import s vokativem | úkol 31, `ImportPage.importFifty` |
| 4 AI šablona | vědomě mimo E2E, viz kapitola 3; vlastní P15 |
| 5 doladění a testovací odeslání | úkol 31, `sendTestTo` |
| 6 segment s počtem | úkol 31, `SegmentPage` |
| 7 odeslání a živý průběh | úkol 31, `send` a `expectLiveProgress` |
| 8 otevření, proklik, časová osa | úkol 31, pixel a proklik přes skutečný požadavek |
| 9 report | úkol 31, `ReportPage` |

---

## 7. Co udělat, až plán skončí

1. Pustit `/replan:replan` na tenhle dokument. Plán, který prošel jen fází tvorby, se nepovažuje za hotový.
2. Projít `docs/operations/p16-nalezy.md` s vlastníky dotčených plánů. Každý nález má adresáta a červený test, takže se nedá odbýt diskusí.
3. Teprve potom prohlásit MVP 0 za hotové. Kritérium hotovosti je demo skript, ne počet zavřených úkolů.

