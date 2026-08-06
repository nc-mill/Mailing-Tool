# P02: Kontrakty a golden fixtures, implementační plán

<!-- puvod-dokumentu -->
> **Historický záznam, ne platné zadání.** Implementační plán P02 (kontrakty a golden fixtures) z 31. 7. 2026, sepsaný před
> začátkem stavby. Zachycuje, co se tehdy plánovalo, ne dnešní podobu kódu.
> **Postaveno:** `packages/contracts` i golden fixtures existují; brána `contracts-golden` má podle `STAV-IMPLEMENTACE.md` vlastní vadu.
> **Zaškrtávátka nikdo neodškrtával**, prázdné políčko tady tedy neznamená nedodělek.
> **Dnešní stav:** `docs/superpowers/STAV-UKOLU.md` (živý dokument), design `docs/superpowers/DESIGN-INTEGRACE.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dodat balíček `packages/contracts` a jeho Go protějšek `apps/sender/internal/contracts` tak, aby pět zmrazených kontraktů (outbox protokol, Liquid subset, formát trackovacích tokenů, šifrování credentials, značky pro tracking) mělo **jednu** TypeScript implementaci, jazykově neutrální golden fixtures, **spustitelné runnery těch fixtures na obou stranách** a test, který rozchod TypeScriptu a Go zachytí v CI dřív, než se dostane do produktu.

**Architecture:** `packages/contracts` je kořen grafu závislostí a neimportuje z monorepa nic. Jazykově neutrální pravda leží v `fixtures/**` jako JSON; TypeScript ji čte přes Vitest, Go přes symlink `apps/sender/testdata`. **Go implementaci kontraktů tenhle plán nepíše, vlastní ji P09** (rozhodnutí D8); P02 dodává na Go straně jen pomocníky pro čtení fixtures, zápis reportu a **runnery**, které produkční kód P09 dostanou jako parametr. Každé tvrzení kontraktu, které jde ověřit spuštěním, se spouští: SQL proti reálnému PostgreSQL pod rolí `mlain_sender`, tokeny a šifrové obálky proti závazným vektorům bajt na bajt, Liquid proti oběma knihovnám s porovnáním výstupu bez normalizace. Scénář `OB-00` je první úkol po založení balíčku, ne poslední, protože kontrakt bez spustitelného testu není kontrakt.

**Tech Stack:** TypeScript 7.0.2 (Apache-2.0), Node.js 24.18.1 (MIT), Vitest 4.1.10 (MIT), LiquidJS 10.27.2 (MIT), Ajv 8 (MIT), pg 8.22.0 (MIT), testcontainers 12.0.4 (MIT), tsx (MIT), Go 1.26 (BSD-3-Clause) se standardní knihovnou a `github.com/jackc/pgx/v5` v5.10.0 (MIT, už v `go.mod` od P01), PostgreSQL 18 (PostgreSQL License). **Tenhle plán nepřidává do `apps/sender/go.mod` ani jeden modul**, protože Go implementace kontraktů je v P09. Úplná tabulka s licencemi je v kapitole 5.

---

## 1. Kontext a hranice

Řídicí dokument je `docs/superpowers/plans/2026-07-31-rozdeleni-implementacnich-planu.md`, zadání tohoto plánu je jeho kapitola 5, blok **P02**. Platí jeho jediné řídicí pravidlo: každý soubor má právě jeden plán, který ho smí vytvořit a měnit.

Zdroje, ze kterých plán čerpá, a jejich závaznost:

| Zdroj | Kapitola | Závaznost |
|---|---|---|
| `docs/superpowers/specs/parts/01-platforma.md` | 4.10 celá (4.10.1 až 4.10.5) | **ZMRAZENÝ KONTRAKT.** Plán ho realizuje přesně, nevylepšuje ho. |
| `docs/superpowers/specs/parts/01-platforma.md` | 3.10 (odvození klíčů, keyring) | KONTRAKT, sdílený s 4.10.3 a 4.10.4 |
| `docs/superpowers/specs/parts/01-platforma.md` | 2.1, 3.11, 3.15, 4.9, 8 | konvence, CI joby, konfigurace, akceptační kritéria |
| `docs/superpowers/specs/parts/03-obsah.md` | 4.1 (kontrakt 5), 3.7 (validátor), 3.3.5a (sloty) | KONTRAKT 5 vlastní část 3, validátor žije v `packages/contracts/src/liquid/` |
| `docs/superpowers/specs/parts/04b-sender.md` | 3.6, 3.7.1, 13 | Go strana, nenormativní implementační poznámky |

**Zmrazenost znamená tohle:** když implementace narazí na místo, které podle kontraktu nejde napsat, nezmění se kontrakt v rámci tohoto plánu. Zapíše se do kapitoly 10 tohoto dokumentu jako nález a pokračuje se podle nejmenšího možného rozhodnutí, které je v plánu výslovně označené. Změna očekávané hodnoty ve fixture vyžaduje commit message začínající `contract:` a review vlastníků obou stran, což hlídá `CODEOWNERS` (úkol 20).

---

## 2. Předpoklady

Vlna 0 je sekvenční. Tenhle plán začíná až tehdy, když je **P01 smergovaný do `main`**, protože z něj přebírá:

| Co | Odkud | Jak se ověří |
|---|---|---|
| kořenový workspace, `pnpm-workspace.yaml`, `turbo.json` | P01 | `pnpm -w list --depth -1` vypíše `@mlain/contracts` |
| `packages/config` presety tsconfig a vitest | P01 | soubor `packages/config/tsconfig/base.json` existuje |
| `packages/contracts/package.json` a `tsconfig.json` jako prázdný manifest | P01, úkol 5 krok 3 | soubory existují a `package.json` má `"name": "@mlain/contracts"` |
| `apps/sender/go.mod` a `go.sum` s modulem `github.com/nc-mill/mlain/apps/sender` | P01 úkol 15, přebírá P09 | `cd apps/sender && go build ./...` projde |
| `tools/ci/contracts-golden.mjs`, `contracts-fixtures-schema.mjs`, `contracts-schema.mjs` | P01 | soubory existují, dnes hlásí SKIP |
| `.github/workflows/ci.yml` s joby `contracts-golden`, `contracts-fixtures-schema`, `contracts-schema`, `test-go`, `test-go-integration` | P01 | job je v souboru |
| `packages/core/src/config/config.manifest.json` | P01, rozhodnutí D5 | soubor existuje |

**Když kterýkoliv předpoklad neplatí, plán se nezačíná a nedoplňuje se ručně.** Chybějící preset se nekopíruje, chybějící job se nedopisuje. Je to nález proti P01 a řeší se domergováním P01, ne obcházením. Důvod je v řídicím dokumentu, uzávěr S10: CI job doplněný později znamená, že se do té doby mergovalo bez brány.

**Tenhle plán nezapisuje do žádného souboru mimo své vlastnictví**, `apps/sender/go.mod` a `go.sum` nevyjímaje. Dřívější znění je měnilo příkazem `go get`, protože si samo psalo Go implementaci kontraktů; ta je nově v P09 (rozhodnutí D8), takže P02 na Go straně vystačí se standardní knihovnou a s `pgx`, který v `go.mod` od P01 už je.

### 2.1 Požadavky na jiné plány

Tyhle body **P02 opravit nesmí**, protože leží v cizích souborech. Bez nich zůstane část bran nespuštěná, proto je plán vede jmenovitě a úkol 21 je ověřuje spuštěním.

| # | Komu | Co | Proč to P02 nemůže udělat sám |
|---|---|---|---|
| P02→P01.1 | P01 | Do registru chybových kódů doplnit `liquid_literal_not_supported` (rozhodnutí D5, nález N2). Ověřeno grepem: v P01 dnes není. | registr vlastní P01 |
| P02→P01.2 | P01 | `mlain_migrator` potřebuje **právo zakládat rozšíření**, tedy `GRANT CREATE ON DATABASE <db> TO mlain_migrator` v `docker/initdb/10-roles.sql` a v dokumentaci externího Postgresu. Bez toho se bootstrap `OB-00` nezaloží. **Ověřeno spuštěním na PG 18.4:** `ERROR: permission denied to create extension "citext"`. | `docker/initdb/**` vlastní P01 |
| P02→P01.3 | P01 | Job `test-go-integration` musí nastavit `DATABASE_URL_MIGRATOR` (stejnou hodnotu, jakou už má `test-db` a `contracts-schema`). Bez ní se `TestOB00` nemá odkud bootstrapovat a skončí `t.Fatal`. | `.github/workflows/ci.yml` vlastní P01 |
| P02→P01.4 | P01 | `tools/ci/contracts-golden.mjs` hledá Go fixtures v `apps/sender/testdata/fixtures`, jenže symlink `testdata` míří **přímo** na `packages/contracts/fixtures`. Správná cesta je `apps/sender/testdata`. I po opravě by ale porovnával adresář sám se sebou přes symlink, takže kontrola „fixture je jen na jedné straně" nic neměří; nahradit ji spuštěním `pnpm --filter @mlain/contracts test:golden`, `test:fixtures-schema` a (od vlny 1) `test:parity`. | `tools/ci/**` vlastní P01 |
| P02→P09.1 | P09 | Dodat Go implementaci pěti kontraktů a **tenké testovací soubory, které volají runnery z `internal/contracts`** (přesné volání je v úkolu 16 a 11). Bez nich `reports/go-golden-*.json` nevzniknou a `test:parity` zůstane červený. | produkční balíčky vlastní P09 |
| P02→P08.1 | P08 | Dodat data fixtur `CT-001` až `CT-018` do `packages/contracts/fixtures/compiled/` (rozhodnutí D4, R3 rozhodnutí o vlastnictví). P02 dodává schéma, registr a runner. | blokový model a renderer vlastní P08 |
| P02→P09.2 | P09 | Doplnit do `internal/outbox` funkci `CanTransition(from, to, actor, errorCode string) bool` a spustit nad ní runner `RunOutboxTransitions`. Balíček dnes má jen SQL příkazy, takže uzavřený výčet stavů a jediná pojmenovaná výjimka `failed -> sent` existují pouze v TypeScriptu, přestože přechody provádí i sender. | produkční balíček vlastní P09 |
| P02→P08.2 | P08 | Sjednotit jména: P08 importuje `validateCompiledLiquid` a `createPreviewLiquid`, které tenhle balíček nevystavuje. Vystavuje `validateLiquid(source, ctx)` s `ctx.level` = `authored` nebo `compiled` a `createHtmlEngine()` / `createTextEngine()`. Rozdíl je jen v pojmenování, ale import by se nepřeložil. Soubor vlastní P02, takže platí jména odsud. | volání jsou v souborech P08 |
| P02→P08.3 | P08 | `RAW_SLOT_PREFIX` a tvar `ML_RAW_<nonce>_nnnn` má nově jeden zdroj v `packages/contracts/src/markers.ts`. P08 ať si předponu bere odtud, ne z vlastní konstanty, aby se nemohly rozejít. Nonce zůstává celý v režii P08. | konstanta je v souboru P08 |
| P02→P07.1 | P07 | Bohatý katalog polí `FieldCatalog` i převody cest `toMergePath` a `toCatalogPath` vlastní P07 (rozhodnutí R2), protože stojí na modelu kontaktu a vlastních polích. P07 z něj dodá i zúžení na `LiquidRoots`, které bere validátor. Tenhle plán je **nedodává** a P08 si je má brát z P07, ne z kontraktů. | model kontaktu vlastní P07 |
| P02→P16.1 | P16 | `secretKeyFingerprint()` bere **MASTER**, ne odvozený klíč. P16 dnes volá `secretKeyFingerprint(deriveKey(master, 'mailer/v1/secret-key-fingerprint'))`, což odvodí klíč dvakrát a dá jiný otisk. Správně je `secretKeyFingerprint(master)`. | volání je v souboru P16 |

---

## 3. Rozhodnutí, která tenhle plán udělal sám

Specifikace tyhle body neuzavírá, nebo je uzavírá dvěma různými způsoby. Jsou rozhodnuté tady, s odůvodněním, aby je šlo přehlasovat vědomě, ne omylem.

**D1. `OB-00` běží proti bootstrap schématu z `fixtures/outbox/schema.sql`, ne proti migracím.** `OB-00` musí být spustitelný ve vlně 0, jenže migrace vznikají až v P03, tedy o plán později. Kontrakt zároveň v 4.10.1 obsahuje úplné DDL kontraktní podmnožiny, takže není co vymýšlet: opíše se, doplní se minimální torza cizích tabulek podle tabulky "Kontraktní podmnožiny cizích tabulek" a soubor se výslovně označí jako **testovací fixture, ne schéma produktu**. Riziko rozchodu s produkčním schématem zavírá strojově job `contracts-schema` (úkol 19), který tentýž manifest sloupců pouští proti databázi zmigrované z `packages/db`. Konvence 2.2 části 1 ("jediný vlastník schématu je `packages/db`") tím není porušená: bootstrap nikdy neběží v provozu, negeneruje migraci a nikdo ho neimportuje.

**D2. `OB-00` používá `PREPARE` s explicitními typy parametrů a `EXPLAIN (COSTS OFF) EXECUTE`.** Samotné `PREPARE` projde jen parserem a analyzátorem, plánovač se spustí až při `EXECUTE`. Kontrakt přitom v 4.10.1 chce "že dotaz projde parserem a plánovačem". `EXPLAIN` bez `ANALYZE` plán sestaví a nic nevykoná, takže je bezpečný i u `UPDATE`. Typy parametrů se berou z tabulky parametrů v kontraktu; bez nich PostgreSQL u výrazu `WHEN $1 = 'retry'` skončí chybou `could not determine data type of parameter $1`, protože obě strany porovnání jsou neznámého typu.

**D3. Jediný scénář, který tenhle plán nespouští, je `OB-10`.** Dřívější znění tady vyjmenovávalo `OB-01`, `OB-02`, `OB-10` a `OB-11`, jenže registr `fixtures/outbox/scenarios.json` u prvních dvou i u posledního uvádí `runner: "contracts"` a tenhle plán je skutečně spouští (`OB-01` a `OB-02` v úkolech 5 a 6, `OB-11` v úkolu 9). Rozhodnutí a registr se rozcházely a **platí registr**. Chování procesu, které bez běžícího senderu napsat nejde, má jediný scénář: `OB-10`, tedy graceful shutdown uprostřed dávky. `OB-15` (pozdní bounce) patří doméně kampaní. `fixtures/outbox/scenarios.json` je proto registr **všech dvaceti tří** scénářů s příznakem `runner`, který nabývá hodnot `contracts` (spouští tenhle plán, 21 scénářů), `sender` (P09, jen `OB-10`) a `campaigns` (P14, jen `OB-15`). Fixture bez vykonavatele by byla mrtvá, fixture spuštěná ve špatném plánu by byla falešně zelená. Úkol 6 to hlídá testem, který registr porovnává s obsahem testovacích souborů.

**D4. Data fixtur kompilované šablony píše P08, tenhle plán dodává schéma, registr a runner.** Fixtures `CT-001` až `CT-018` z části 3, kapitoly 4.1.7 potřebují vyrenderovaný dokument, tedy blokový model a React renderer, které vlastní P08; P02 je vyrobit neumí. Dřívější znění tady psalo, že je „doplní P08", zatímco P08 psal, že je vlastní P02, a obě strany to měly jako závazné pravidlo, takže by je nenapsal nikdo. **Rozhodnutí R3 dokumentu o vlastnictví: data píše P08.** Tenhle plán dodává `schema/compiled.schema.json`, adresář `fixtures/compiled/` (cesta je `compiled`, ne `compile`), runner `assertCompiledFixture`, který P08 zavolá se svým vyrenderovaným výstupem, a test toho runneru. K tomu dodává vlastní sadu `fixtures/markers/MK-0xx.json`, která je jazykově neutrální a testuje přesně tu půlku kontraktu, kterou vlastní obě strany: přesný tvar značky, jednoprůchodovou náhradu, počty a bajtový diff mimo nahrazené úseky.

**D5. Kód pro odmítnutí literálů `blank` a `empty` validátorem je `liquid_literal_not_supported`.** Část 3 v 3.7.2a předepisuje, že je validátor odmítá s hláškou "zatím nepodporováno", ale kód pro to nemá v katalogu 3.7.4 a kontrakt je v gramatice povoluje. Zároveň platí nález K4 části 4b: `osteele/liquid` ty literály nezná, takže render fixture s nimi by se mezi knihovnami rozešla a golden fixture na ně nejde napsat jinak než jako odmítnutí. Plán tedy zavádí pracovní kód a **vyžaduje jeho potvrzení vlastníkem části 3** dřív, než se plán prohlásí za hotový. Viz nález N3 v kapitole 10.

**D6. `base32_lower` v `Message-ID` je RFC 4648 standardní abeceda, bez paddingu, převedená na malá písmena.** Kontrakt v 4.10.1 tvar `Message-ID` předepisuje a `OB-11` porovnává řetězec, ale abecedu ani padding neurčuje; nález K13 části 4b to popisuje a navrhuje přesně tuhle volbu, do části 1 ale zanesená není. Bez rozhodnutí nejde `OB-11` napsat vůbec. Plán volbu přebírá, zapisuje ji do fixture jako závazný vektor a hlásí ji jako nález N4.

**D7. Fixture s vocative filtrem má id `LQ-510`, ne `LQ-051`.** Kontrakt v 4.10.2 ukazuje příklad s id `LQ-051` a zároveň řadí odmítnutí validátorem do skupiny `LQ-5xx` s deseti položkami. Trojmístné id začínající nulou do skupiny `LQ-5xx` nepatří a skupina `LQ-0xx` má osm položek obsazených výstupem a cestami. Číslování je proto po stovkách: `LQ-001` až `LQ-008`, `LQ-101` až `LQ-110`, a tak dál. Příklad v kontraktu je ilustrace formátu, ne přidělené číslo.

**D8. Na Go straně dodává tenhle plán jen runnery, ne implementaci. Implementaci kontraktů vlastní P09.** Je to rozhodnutí R1 dokumentu o vlastnictví a má tři důvody. Za prvé, oba plány zakládaly v `apps/sender/internal/contracts/` soubory se **stejnými symboly** (`TestGoldenCrypto`, `TestGoldenLiquid`, `tokenVectors`, `loadTokenVectors`, `writeGoldenReport`), takže by se balíček nepřeložil. Za druhé, a to je horší, vznikly by **dvě Go implementace každého kontraktu**, obě zelené nad týmiž fixtures, ale binárka by používala jen tu z P09; ověřeno grepem, že P09 `internal/contracts` nikde neimportuje. Ta druhá by se mohla rozejít a nikdo by to nepoznal. Za třetí, tím padá i důvod sahat do `apps/sender/go.mod`: bez vlastní implementace nepotřebuje P02 ani `osteele/liquid`, ani `google/uuid`.

**Jak se to dělí prakticky.** `apps/sender/internal/contracts` je **balíček testovací podpory**, který binárka neimportuje. Obsahuje čtení fixtures, typy fixtur, výpočet otisku fixtures, zápis reportu a runnery. Runner **nikdy neimportuje produkční balíček**; produkční funkce dostane jako hodnotu parametru:

```go
contracts.RunLiquidGolden(t, contracts.LiquidRunner{Render: ..., PrepareRenderData: ...})
```

Díky tomu se `internal/contracts` přeloží už ve vlně 0, kdy P09 ještě neexistuje, a zároveň neexistuje způsob, jak runner spustit nad jinou implementací než tou produkční. Tenká testovací volání v balíčcích P09 zakládá P09 (požadavek P02→P09.1), plán je má v úkolech 11 a 16 vypsaná doslova, aby si je nevymýšlel.

**Důsledek, který se nesmí zamlčet:** dokud P09 nepřistane, `reports/go-golden-*.json` nevzniknou a `pnpm test:parity` **skončí červeně** hláškou o chybějícím reportu. To je správně: parita nad jednou stranou není parita. Jednotkový test `check-parity` je zelený už ve vlně 0, protože si obě strany reportu podstrkuje sám, a součástí toho testu je tvrzení, že chybějící Go report je chyba, ne důvod k přeskočení. Zapojení `test:parity` do CI je proto požadavek P02→P01.4 s termínem vlna 1.

**D9. Soubory CI jobů vlastní P01, tenhle plán vlastní jejich obsah.** `.github/workflows/ci.yml` ani `tools/ci/contracts-*.mjs` P02 needituje. Dodává příkazy, které ty skripty volají (`pnpm --filter @mlain/contracts test:golden`, `test:parity`, `test:fixtures-schema`, `test:schema` a `go test ./internal/contracts/...`), a v úkolu 21 ověří spuštěním, že joby po tomhle plánu končí zeleně a **nehlásí SKIP**. Trvající SKIP je nález proti P01, ne důvod sáhnout do jeho souboru.

**D10. Barrel `src/index.ts` v balíčku nevzniká.** Uzávěr S11 řídicího dokumentu zakazuje barrely jako sdílené soubory s jedním řádkem na doménu. Balíček má místo toho subpath exporty (`@mlain/contracts/token`, `/crypto`, `/outbox`, `/liquid`, `/markers`), které odpovídají stromu v kontraktu 4.10.

**D11. `config.json` se do balíčku zrcadlí kopií souboru, ne importem.** P01 v rozhodnutí D5 manifest konfigurace generuje do `packages/core/src/config/config.manifest.json` a zrcadlení do kontraktů předává sem. Skript čte cizí soubor z disku a zapisuje `packages/contracts/config.json`. Čtení souboru není import: nevzniká build závislost, ESLint pravidlo `import/no-restricted-paths` se neuplatní a graf `contracts → nic` platí dál. Kdyby se místo toho udělal import, byl by z kořene grafu list.

**D12. Jména JSON schémat určuje skript z P01, ne estetika tohohle plánu.** `tools/ci/contracts-fixtures-schema.mjs` skládá jméno jako `<první segment cesty fixture>.schema.json` (ověřeno čtením P01, řádek 8616). Dřívější znění pojmenovalo schémata `liquid-fixture.schema.json`, `marker-fixture.schema.json` a tak dál, takže se **neshodovalo ani jedno** a job by hlásil chybu u každé skupiny. Schémata se proto jmenují podle adresáře: `liquid`, `markers`, `compiled`, `token`, `crypto`, `outbox`, `message-id`. Přejmenovat schémata je levnější než měnit cizí skript, a navíc je to jméno, které si čtenář odvodí z cesty. Mimo tenhle klíč zůstávají dvě schémata, která nepopisují žádnou skupinu fixtures: `config.schema.json` pro `config.json` v kořeni balíčku a `columns.schema.json` pro `schema/columns.json`.

**D13. Manifest kontraktních sloupců se jmenuje `packages/contracts/schema/columns.json` a má tvar `{ tabulka: { sloupec: typ } }`.** Přesně ten soubor a ten tvar čte `tools/ci/contracts-schema.mjs` z P01 (ověřeno, řádky 8651 a 8669 až 8681). Dřívější znění generovalo `fixtures/outbox/contract-columns.json` v jiném tvaru, takže soubor, který skript hledá, **nikdy nevznikl a job tiše přeskočil**; kontraktní sloupce po migracích nehlídalo nic. Duplicitní soubor se ruší, generuje se rovnou ten, který má vlastníka i čtenáře. `columns.json` nese `messages` a ty tři cizí tabulky, jejichž DDL kontrakt v 4.10.1 uvádí a bootstrap zakládá (`campaigns`, `workspaces`, `suppressions`); typy jsou hodnoty `information_schema.columns.data_type` a byly odečtené z běžící PG 18.4, ne odhadnuté. Tabulky `sending_providers`, `campaign_links` a `message_events` v `columns.json` **schválně nejsou**: jejich typy vlastní jiné části a hádat je by znamenalo červený build z důvodu, který si P02 vymyslel. Jejich kontraktní sloupce hlídá test v úkolu 20 na existenci jména, což je všechno, co P02 doložitelně ví.

**D14. Report golden běhu je po sekcích a nese otisk fixtures.** Runner každého kontraktu zapíše `reports/<jazyk>-golden-<sekce>.json` s poli `language`, `section`, `total`, `executed`, `skipped`, `groups` a `fixturesDigest`. Sekce jsou po souborech, protože Go strana běží v několika testovacích binárkách (každý produkční balíček P09 má vlastní) a jeden společný soubor by si přepisovaly. `fixturesDigest` je SHA-256 nad seřazeným seznamem `jméno\0sha256(obsah)` všech fixtur sekce a existuje kvůli tomu, že adresář `reports/` se nikde nemaže: bez otisku by šlo lokálně dostat zelenou paritu nad reportem ze starého běhu. `check-parity` otisk **přepočítá z disku** a vyžaduje shodu s oběma reporty.

**D15. `skipped` se počítá, nepíše.** Dřívější znění mělo `skipped: 0` jako literál na obou stranách, takže přeskočená fixture byla neviditelná; Go strana byla horší, protože počítadla plnila **mimo** tělo testu, kde `t.Skip()` vůbec nevidí. Obě strany proto zvyšují `executed` **jako poslední řádek těla testu** a `skipped` počítají jako `total - executed`. `check-parity` vyžaduje `executed === total` a `skipped === 0` na obou stranách. Je to přesně ten směr, před kterým plán třikrát varuje, takže se tady měří, ne deklaruje.

**D16. Vyhrazené řetězce se porovnávají bez ohledu na velikost písmen.** Kontrakt 5 zakazuje v uživatelském textu `mlain.invalid`, `ML_OPEN_PIXEL` a `ML_ARG_`; P08 k nim žádá `ML_RAW_`, ale **sám generuje slot malými písmeny**. Porovnání citlivé na velikost by tedy `ml_raw_0001` propustilo. Porovnává se proto po převodu obou stran na malá písmena. Rozšíření je bezpečné: jsou to vyhrazené řetězce, takže i `MLAIN.INVALID` v uživatelském textu má být odmítnuté.

---

## 4. Struktura souborů

Adresáře odpovídají stromu z kontraktu 4.10, doplněné o to, co strom nevyjmenovává.

```
packages/contracts/
├── package.json                       PŘEPISUJE se manifest od P01
├── tsconfig.json                      PŘEPISUJE se od P01
├── vitest.config.ts
├── README.md                          co je zmrazené a jak se to mění
├── config.json                        GENEROVANÝ, zrcadlo manifestu konfigurace z P01
├── openapi.json                       GENEROVANÝ, zapisuje P04, tenhle plán ho jen nesmaže
├── src/
│   ├── outbox.ts                      stavy, přechody, kontraktní sloupce, názvy dotazů
│   ├── outbox-errors.ts               registr messages.error_code
│   ├── pause-reason.ts                tvar objektu pause_reason a registr kódů
│   ├── keyring.ts                     SECRET_KEY, SECRET_KEY_PREVIOUS, HKDF, purposes
│   ├── token.ts                       kontrakt 3
│   ├── message-id.ts                  base32_lower a tvar Message-ID
│   ├── crypto.ts                      kontrakt 4
│   ├── markers.ts                     kontrakt 5, značky a náhrada
│   └── liquid/
│       ├── grammar.ts                 povolené tagy, filtry, literály, limity, kořeny
│       ├── validator.ts               rekurzivně sestupný parser
│       ├── filters.ts                 pět vlastních filtrů
│       ├── engine.ts                  instance LiquidJS pro HTML a text
│       └── prepare-render-data.ts     sdílená příprava dat pro náhled i odeslání
├── fixtures/
│   ├── liquid/LQ-*.json               55 souborů (rozpis v úkolu 15)
│   ├── token/vectors.json
│   ├── crypto/vectors.json
│   ├── message-id/vectors.json        závazné vektory base32_lower a Message-ID
│   ├── markers/MK-*.json              10 souborů
│   ├── compiled/                      prázdný, data píše P08 (rozhodnutí D4)
│   └── outbox/
│       ├── scenarios.json             registr OB-00 až OB-22
│       ├── schema.sql                 bootstrap kontraktní podmnožiny (rozhodnutí D1)
│       └── sql/*.sql                  jedenáct normativních dotazů, každý zvlášť
├── schema/                            jména podle rozhodnutí D12
│   ├── liquid.schema.json
│   ├── token.schema.json
│   ├── crypto.schema.json
│   ├── message-id.schema.json
│   ├── markers.schema.json
│   ├── outbox.schema.json
│   ├── compiled.schema.json
│   ├── config.schema.json
│   ├── columns.schema.json
│   └── columns.json                   GENEROVANÝ manifest sloupců, čte ho P01 (D13)
├── scripts/
│   ├── generate-fixtures.ts           vyrobí token, crypto a message-id vektory
│   ├── validate-fixtures.ts           job contracts-fixtures-schema
│   ├── check-parity.ts                job contracts-golden, čtvrtý krok
│   └── sync-config-manifest.ts        zrcadlení config.json
├── test/
│   ├── golden-report.ts               sdílený zápis reports/ts-golden-<sekce>.json
│   ├── outbox.test.ts
│   ├── outbox-errors.test.ts
│   ├── keyring.test.ts
│   ├── token.golden.test.ts
│   ├── message-id.golden.test.ts
│   ├── crypto.golden.test.ts
│   ├── markers.golden.test.ts
│   ├── compiled.golden.test.ts        runner fixtur CT-xxx, data píše P08
│   ├── liquid.validator.test.ts
│   ├── liquid.filters.test.ts
│   ├── liquid.golden.test.ts
│   ├── prepare-render-data.test.ts
│   ├── fixtures-schema.test.ts
│   ├── parity.test.ts
│   ├── package-boundary.test.ts
│   └── db/
│       ├── helpers.ts                 připojení, role, bootstrap
│       ├── 00-ob00.test.ts            OB-00, běží první
│       ├── 10-ob-claim.test.ts        scénáře claimu a oprávnění
│       ├── 11-ob-dispatch.test.ts     stráž, reaper, zakázané přechody
│       └── 20-contract-columns.test.ts
└── reports/                           GENEROVANÝ, v .gitignore
    ├── ts-golden-<sekce>.json
    └── go-golden-<sekce>.json

apps/sender/
├── testdata -> ../../packages/contracts/fixtures      SYMLINK, ne kopie
└── internal/contracts/                BALÍČEK TESTOVACÍ PODPORY, binárka ho neimportuje
    ├── fixtures.go                    kořen fixtures, čtení, seznam, otisk
    ├── report.go                      typ Report a zápis reports/go-golden-<sekce>.json
    ├── golden.go                      typy fixtur a runnery RunLiquidGolden a spol.
    ├── outbox.go                      JEN registr scénářů z JSON, žádná logika přechodů
    ├── sqlheader.go                   parser hlaviček normativních dotazů
    ├── fixtures_test.go               symlink, otisk, počty fixtur
    ├── golden_test.go                 test runnerů proti referenčním funkcím
    └── outbox_ob00_test.go            OB-00 v Go, build tag integration
```

Soubory jsou dělené podle kontraktu, ne podle jazykové vrstvy. Na Go straně **nejsou žádné implementační soubory**: `token.go`, `crypto.go`, `keyring.go`, `markers.go`, `liquid.go`, `messageid.go` a `renderdata.go` z dřívějšího znění patří podle rozhodnutí D8 do produkčních balíčků P09 (`internal/token`, `internal/credentials`, `internal/keyring`, `internal/markers`, `internal/liquidx`).

---

## 5. Závislosti a jejich licence

Projekt je **MIT**. `GPL-*`, `LGPL-*`, `AGPL-*`, `SSPL-*`, `BUSL-*`, `Elastic-2.0`, `Sustainable Use License` a `CC-BY-NC-*` jsou zakázané a hlídají to joby `licenses-node` a `licenses-go` z P01.

### 5.1 Node, runtime závislosti balíčku

| Balíček | Verze | Licence | K čemu |
|---|---|---|---|
| `liquidjs` | 10.27.2 | MIT | render Liquidu na TypeScript straně, verze je závazná z kontraktu 4.10.2 |

### 5.2 Node, vývojové závislosti balíčku

| Balíček | Verze | Licence | K čemu |
|---|---|---|---|
| `vitest` | 4.1.10 | MIT | testy, verze závazná z 3.15 |
| `ajv` | ^8.17.1 | MIT | validace fixtures proti JSON schématům |
| `ajv-formats` | ^3.0.1 | MIT | formáty `uuid` a `date-time` ve schématech |
| `pg` | 8.22.0 | MIT | `OB-00` a scénáře proti PostgreSQL, verze shodná s P01 |
| `testcontainers` | 12.0.4 | MIT | lokální běh testů s databází, verze závazná z 3.15 |
| `tsx` | ^4.20.0 | MIT | spouštění skriptů v `scripts/` |
| `@types/pg` | ^8.15.0 | MIT | typy |

### 5.3 Go

**Tenhle plán nepřidává do `apps/sender/go.mod` ani jeden modul.** Po rozhodnutí D8 nemá Go strana P02 co implementovat, takže vystačí se standardní knihovnou a s jedním modulem, který v `go.mod` od P01 už je.

| Modul | Verze | Licence | K čemu |
|---|---|---|---|
| `github.com/jackc/pgx/v5` | v5.10.0 | MIT | `OB-00`, modul už je v `go.mod` od P01, **nepřidává se** |
| `crypto/sha256`, `encoding/hex` | stdlib | BSD-3-Clause | otisk fixtures pro report |
| `encoding/json`, `os`, `path/filepath`, `testing` | stdlib | BSD-3-Clause | čtení fixtures, runnery, zápis reportu |

`github.com/osteele/liquid` a `github.com/google/uuid` v tabulce **schválně nejsou**: potřebuje je Go implementace kontraktů, kterou vlastní P09, a přidává si je P09. Dřívější znění je do `go.mod` dopisovalo příkazem `go get`, což bylo jediné místo, kde plán sahal mimo své vlastnictví; s D8 ten důvod zmizel.

Vědomě nepoužité: jakýkoliv Go balíček na validaci JSON schémat (schémata validuje jen TypeScript strana v jobu `contracts-fixtures-schema`), jakýkoliv testovací framework nad `testing` (runnery dostávají `*testing.T` a nic víc).

**Před přidáním každé závislosti se licence ověří příkazem, ne pamětí:** `npm view <balíček>@<verze> license version` u Node a `go-licenses report <modul>` nebo pohled do `LICENSE` v repozitáři modulu u Go. Hodnota mimo whitelist znamená, že se závislost nepřidá a hledá se náhrada.

---

## 6. Co bylo ověřeno spuštěním při psaní tohohle plánu

Tohle není teorie a implementátor to nemusí ověřovat znovu, jen to nesmí rozbít. Řádky bez poznámky byly spuštěné 2026-07-31, řádky označené **(18.4)** byly přepočítané 2026-08-01 proti **PostgreSQL 18.4** v Dockeru, tedy proti verzi, na kterou produkt cílí.

| Co | Výsledek |
|---|---|
| `MASTER` z testovacího `SECRET_KEY` | 32 B, `000102...1e1f` |
| `K_tracking-token`, `K_credential-encryption`, `K_secret-key-fingerprint` | všechny tři **sedí** s hodnotami v 3.10 |
| otisk klíče `VXGoNjoPSBY` | **sedí** |
| tokeny `open`, `click`, `identity`, `unsubscribe`, `unsubscribe` s nulovým `list_id` | všech pět **sedí bajt na bajt**, délky 74, 96, 106, 117 |
| plná HMAC-SHA256 před zkrácením u všech čtyř typů | **sedí** |
| krypto obálka: `header hex`, `aad hex`, `ciphertext hex`, `tag hex`, `stored`, 131 bajtů | **sedí** |
| negativní vektor `CR-N2` v novém tvaru (hlavička přepsaná na jiný **platný** kontext `webhook_secret`) | krok 5 projde, GCM ověření **selže**, tedy `crypto_auth_failed` |
| **(18.4)** bootstrap `fixtures/outbox/schema.sql` včetně `citext`, obou partition, čtyř indexů, sloupcových grantů, RLS a politik | zakládá se bez chyby |
| **(18.4)** jedenáct normativních SQL dotazů kontraktu 1 přes `PREPARE` a `EXPLAIN (COSTS OFF) EXECUTE` | **všech jedenáct projde** parserem i plánovačem, s hlavičkou opravenou podle nálezů níž |
| **(18.4)** `PREPARE jméno () AS ...` a `EXECUTE jméno()` u dotazu bez parametrů | **syntaktická chyba** `syntax error at or near ")"`; bez závorek projde. Runner proto závorky vynechává, když je seznam prázdný. |
| **(18.4)** chybná varianta claimu s `FROM claimable cl JOIN campaigns c ON c.id = m.campaign_id` | **selže**, ale hlavní hláška je `invalid reference to FROM-clause entry for table "m"`; věta `There is an entry for table "m", but it cannot be referenced from this part of the query` je v poli **`DETAIL`**, ne v `message` |
| **(18.4)** `CREATE EXTENSION citext` pod rolí `mlain_migrator` s grantem jen na schéma | `ERROR: permission denied to create extension "citext"`, `HINT: Must have CREATE privilege on current database`. Po `GRANT CREATE ON DATABASE mlain TO mlain_migrator` projde. |
| **(18.4)** plán claim dotazu | jde přes částečný index `(campaign_id, next_attempt_at, id) WHERE status = 'pending'` a pak přes primární klíč partition |
| **(18.4)** `DELETE FROM messages` pod rolí `mlain_sender` | `permission denied for table messages` |
| **(18.4)** `UPDATE messages SET created_at = ...` pod rolí `mlain_sender` | `permission denied for table messages`, sloupcový grant drží |
| **(18.4)** `UPDATE campaigns SET audience_built_at = ...` pod rolí `mlain_sender` | `permission denied for table campaigns` |
| `base32_lower` nad `0192f3a0-1c2d-7e41-8b2c-3d4e5f607182` | `agjphia4fv7edczmhvhf6ydrqi`, 26 znaků. Ověřeno dvěma nezávislými výpočty. Dřívější znění plánu uvádělo `agjpholrfv7ednfmhu2f6yddqi`, což je **chybný opis**; kód v plánu byl přitom správný, takže by testy na obou stranách neprošly. |
| `github.com/osteele/liquid` v1.8.1 nad šablonami, které odmítá náš validátor | **bez chyby projdou** `LQ-308`, `LQ-501`, `LQ-502`, `LQ-503`, `LQ-504`, `LQ-505`, `LQ-506`, `LQ-507`, `LQ-509`, `LQ-700`, `LQ-701`; chybou skončí `LQ-508`, `LQ-510` a `LQ-702`. Seznam `templateIsInertInGo` proto musí obsahovat i `LQ-501`, `LQ-502` a `LQ-507`, které v dřívějším znění chyběly. |

Řádky bez značky **(18.4)** jsou čistě výpočetní (Node, žádná databáze), takže na verzi Postgresu nezávisí. Dřívější znění tady mělo poznámku, že se běh proti databázi odehrál na PostgreSQL 14 s náhradou `uuidv7()`; ta poznámka padá, protože všechny databázové řádky jsou přepočítané na 18.4 s nativním `uuidv7()` a bez jakékoliv náhrady.

---

## 7. Úkoly

### Úkol 1: Balíček `@mlain/contracts` a symlink do Go

Kostra musí vzniknout dřív než cokoliv jiného, protože bez ní nejde spustit jediný test. Je to jediný úkol, který nezačíná padajícím testem, a končí testem, který dokazuje, že balíček neimportuje z monorepa nic a že Go stranu fixtures vidí.

**Files:**
- Modify: `packages/contracts/package.json`
- Modify: `packages/contracts/tsconfig.json`
- Create: `packages/contracts/tsconfig.build.json`
- Create: `packages/contracts/vitest.config.ts`
- Create: `packages/contracts/.gitignore`
- Create: `apps/sender/testdata` (symlink)
- Create: `apps/sender/internal/contracts/fixtures.go`
- Test: `packages/contracts/test/package-boundary.test.ts`
- Test: `apps/sender/internal/contracts/fixtures_test.go`

- [ ] **Krok 1: Napiš padající test hranice balíčku**

`packages/contracts/test/package-boundary.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('hranice balíčku contracts', () => {
  it('nemá závislost na žádném balíčku z monorepa', async () => {
    const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
    const all = {
      ...(manifest.dependencies ?? {}),
      ...(manifest.devDependencies ?? {}),
      ...(manifest.peerDependencies ?? {}),
    };
    const fromMonorepo = Object.keys(all).filter((name) => name.startsWith('@mlain/'));
    expect(fromMonorepo).toEqual([]);
  });

  it('má subpath exporty a nemá barrel index', async () => {
    const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
    expect(Object.keys(manifest.exports)).toContain('./token');
    expect(Object.keys(manifest.exports)).toContain('./crypto');
    expect(Object.keys(manifest.exports)).toContain('./outbox');
    expect(Object.keys(manifest.exports)).toContain('./liquid');
    expect(Object.keys(manifest.exports)).not.toContain('.');
  });

  it('vystavuje fixtures i vlastní package.json', async () => {
    const manifest = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
    // Bez ./fixtures/* si P08 fixtures nenačte a bez ./package.json si nedopočítá
    // jejich absolutní cestu přes import.meta.resolve. Obojí je doložený požadavek.
    expect(Object.keys(manifest.exports)).toContain('./fixtures/*');
    expect(Object.keys(manifest.exports)).toContain('./schema/*');
    expect(manifest.exports['./package.json']).toBe('./package.json');
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/contracts exec vitest run test/package-boundary.test.ts`
Expected: FAIL, `manifest.exports is undefined` u druhého testu.

- [ ] **Krok 3: Přepiš manifest balíčku**

`packages/contracts/package.json`:

```json
{
  "name": "@mlain/contracts",
  "version": "0.0.0",
  "private": true,
  "license": "MIT",
  "type": "module",
  "exports": {
    "./outbox": { "types": "./dist/outbox.d.ts", "import": "./dist/outbox.js" },
    "./outbox-errors": { "types": "./dist/outbox-errors.d.ts", "import": "./dist/outbox-errors.js" },
    "./pause-reason": { "types": "./dist/pause-reason.d.ts", "import": "./dist/pause-reason.js" },
    "./keyring": { "types": "./dist/keyring.d.ts", "import": "./dist/keyring.js" },
    "./token": { "types": "./dist/token.d.ts", "import": "./dist/token.js" },
    "./message-id": { "types": "./dist/message-id.d.ts", "import": "./dist/message-id.js" },
    "./crypto": { "types": "./dist/crypto.d.ts", "import": "./dist/crypto.js" },
    "./markers": { "types": "./dist/markers.d.ts", "import": "./dist/markers.js" },
    "./liquid": { "types": "./dist/liquid/validator.d.ts", "import": "./dist/liquid/validator.js" },
    "./liquid/engine": { "types": "./dist/liquid/engine.d.ts", "import": "./dist/liquid/engine.js" },
    "./liquid/filters": { "types": "./dist/liquid/filters.d.ts", "import": "./dist/liquid/filters.js" },
    "./liquid/grammar": { "types": "./dist/liquid/grammar.d.ts", "import": "./dist/liquid/grammar.js" },
    "./liquid/prepare-render-data": {
      "types": "./dist/liquid/prepare-render-data.d.ts",
      "import": "./dist/liquid/prepare-render-data.js"
    },
    "./compiled": { "types": "./dist/compiled.d.ts", "import": "./dist/compiled.js" },
    "./fixtures/*": "./fixtures/*",
    "./schema/*": "./schema/*",
    "./package.json": "./package.json"
  },
  "files": ["dist", "fixtures", "schema", "config.json", "openapi.json"],
  "scripts": {
    "build": "tsc -p tsconfig.build.json",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test:unit": "vitest run --project unit",
    "test:golden": "vitest run --project golden",
    "test:schema": "vitest run --project db-ob00 && vitest run --project db-rest",
    "test:fixtures-schema": "tsx scripts/validate-fixtures.ts",
    "test:parity": "tsx scripts/check-parity.ts",
    "contracts:generate": "tsx scripts/generate-fixtures.ts && tsx scripts/sync-config-manifest.ts"
  },
  "dependencies": {
    "liquidjs": "10.27.2"
  },
  "devDependencies": {
    "@types/pg": "^8.15.0",
    "ajv": "^8.17.1",
    "ajv-formats": "^3.0.1",
    "pg": "8.22.0",
    "testcontainers": "12.0.4",
    "tsx": "^4.20.0",
    "vitest": "4.1.10"
  }
}
```

Tři exporty stojí za vysvětlení, protože bez nich se o ně jiné plány zbytečně poperou. `./fixtures/*` a `./schema/*` vystavují data, ne kód, aby si P08 mohl fixtures a schémata načíst bez relativní cesty do cizího balíčku. `./package.json` je v mapě proto, že bez něj Node kvůli `exports` odmítne i `import.meta.resolve('@mlain/contracts/package.json')`, a P08 si tím dopočítává kořen balíčku. Je to jeden řádek, který ušetří kopii cesty v každém konzumentovi.

Před instalací ověř licence příkazem a výstup si přečti:

```bash
npm view liquidjs@10.27.2 license version
npm view ajv license version
npm view ajv-formats license version
npm view pg@8.22.0 license version
npm view testcontainers@12.0.4 license version
npm view tsx license version
```

Expected: každý řádek `MIT`. Cokoliv jiného znamená, že se závislost nepřidá.

- [ ] **Krok 4: Napiš tsconfigy a vitest konfiguraci**

`packages/contracts/tsconfig.json`:

```json
{
  "extends": "@mlain/config/tsconfig/base.json",
  "compilerOptions": {
    "noEmit": true,
    "rootDir": ".",
    "types": ["node"]
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "scripts/**/*.ts", "vitest.config.ts"]
}
```

`packages/contracts/tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "declaration": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/**/*.ts"]
}
```

`packages/contracts/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/*.test.ts'],
          exclude: ['test/*.golden.test.ts'],
        },
      },
      {
        test: {
          name: 'golden',
          include: ['test/*.golden.test.ts'],
        },
      },
      {
        test: {
          name: 'db-ob00',
          include: ['test/db/00-ob00.test.ts'],
          testTimeout: 120_000,
          hookTimeout: 180_000,
          fileParallelism: false,
        },
      },
      {
        test: {
          name: 'db-rest',
          include: ['test/db/1*.test.ts', 'test/db/2*.test.ts'],
          testTimeout: 300_000,
          hookTimeout: 180_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
```

Dva oddělené projekty pro databázi nejsou estetika. Skript `test:schema` je spojuje operátorem `&&`, takže když `OB-00` spadne, zbytek se **nespustí** a jeho selhání nezamaskuje delší výpis. Přesně to kontrakt v 4.10.1 u `OB-00` požaduje.

`packages/contracts/.gitignore`:

```
dist/
reports/
node_modules/
```

- [ ] **Krok 5: Spusť test a ověř, že prochází**

Run: `pnpm install && pnpm --filter @mlain/contracts exec vitest run --project unit`
Expected: PASS, 2 testy.

- [ ] **Krok 6: Vytvoř symlink a Go přístup k fixtures**

```bash
cd apps/sender && ln -s ../../packages/contracts/fixtures testdata && ls -l testdata
```

Expected: `testdata -> ../../packages/contracts/fixtures`

Symlink, ne kopie, protože kopie se rozejde. Adresář `testdata` je pro Go toolchain neviditelný, takže se do buildu nedostane.

`apps/sender/internal/contracts/fixtures.go`:

```go
// Package contracts drží Go stranu pěti zmrazených kontraktů TS <-> Go.
// Fixtures jsou jazykově neutrální JSON v packages/contracts/fixtures a Go je
// čte přes symlink apps/sender/testdata.
package contracts

import (
	"os"
	"path/filepath"
	"runtime"
)

// FixturesDir vrací absolutní cestu k adresáři fixtures přes symlink testdata.
//
// Cesta se odvozuje od umístění tohoto zdrojového souboru, ne od pracovního
// adresáře: `go test ./internal/contracts` má pracovní adresář v balíčku,
// zatímco symlink podle kontraktu 4.10.5 leží v kořeni apps/sender.
func FixturesDir() string {
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		panic("contracts: nelze zjistit cestu ke zdrojovému souboru")
	}
	// internal/contracts/fixtures.go -> internal/contracts -> internal -> apps/sender
	senderRoot := filepath.Dir(filepath.Dir(filepath.Dir(thisFile)))
	return filepath.Join(senderRoot, "testdata")
}

// ReportsDir vrací adresář, do kterého Go strana zapisuje počítadla pro test:parity.
func ReportsDir() string {
	return filepath.Join(filepath.Dir(FixturesDir()), "..", "..", "packages", "contracts", "reports")
}

// ReadFixture načte jeden soubor z fixtures.
func ReadFixture(relPath string) ([]byte, error) {
	return os.ReadFile(filepath.Join(FixturesDir(), relPath))
}
```

- [ ] **Krok 7: Napiš padající Go test symlinku**

`apps/sender/internal/contracts/fixtures_test.go`:

```go
package contracts

import (
	"os"
	"path/filepath"
	"testing"
)

func TestFixturesDirJeSymlinkNaContracts(t *testing.T) {
	dir := FixturesDir()

	info, err := os.Lstat(dir)
	if err != nil {
		t.Fatalf("testdata neexistuje: %v", err)
	}
	if info.Mode()&os.ModeSymlink == 0 {
		t.Fatalf("testdata musí být symlink, ne kopie; je to %s", info.Mode())
	}

	target, err := os.Readlink(dir)
	if err != nil {
		t.Fatalf("readlink selhal: %v", err)
	}
	if target != filepath.Join("..", "..", "packages", "contracts", "fixtures") {
		t.Fatalf("symlink míří jinam: %s", target)
	}

	if _, err := os.Stat(filepath.Join(dir, "outbox")); err != nil {
		t.Fatalf("přes symlink nejde číst adresář outbox: %v", err)
	}
}
```

- [ ] **Krok 8: Spusť Go test a ověř, že padá**

Run: `cd apps/sender && go test ./internal/contracts/ -run TestFixturesDir -v`
Expected: FAIL, `přes symlink nejde číst adresář outbox` (adresář `fixtures/outbox` ještě neexistuje).

- [ ] **Krok 9: Založ prázdné adresáře fixtures a spusť znovu**

```bash
cd packages/contracts && mkdir -p fixtures/liquid fixtures/token fixtures/crypto fixtures/message-id fixtures/markers fixtures/compiled fixtures/outbox/sql schema scripts src/liquid test/db reports
touch fixtures/compiled/.gitkeep
```

Run: `cd apps/sender && go test ./internal/contracts/ -run TestFixturesDir -v`
Expected: PASS.

- [ ] **Krok 10: Commit**

```bash
git add packages/contracts apps/sender/testdata apps/sender/internal/contracts
git commit -m "feat(contracts): založ balíček @mlain/contracts a symlink testdata do Go"
```

---

### Úkol 2: `OB-00`, normativní SQL kontraktu se skutečně spustí

Tohle je nejdůležitější úkol celého plánu a je záměrně druhý, ne poslední. `OB-00` netestuje chování: vezme každý normativní SQL dotaz z kontraktu 4.10.1, spustí ho proti čerstvě založené databázi a ověří jedinou věc, totiž že neskončí chybou. Prázdný výsledek je úspěch. Kdyby existoval dřív, odhalil by obě chyby, které kontrakt v jednom vydání obsahoval, protože obě prošly dvěma koly revize prováděné **čtením**, a čtení neumí zjistit, jestli je SQL platné.

**Files:**
- Create: `packages/contracts/fixtures/outbox/schema.sql`
- Create: `packages/contracts/fixtures/outbox/sql/01-claim-running-campaigns.sql` až `11-campaign-pause.sql`
- Create: `packages/contracts/test/db/helpers.ts`
- Test: `packages/contracts/test/db/00-ob00.test.ts`

- [ ] **Krok 1: Napiš padající test `OB-00`**

`packages/contracts/test/db/00-ob00.test.ts`:

```ts
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { contractSqlDir, type ContractDb, startContractDb, stopContractDb } from './helpers.js';

let db: ContractDb;

beforeAll(async () => {
  db = await startContractDb();
}, 180_000);

afterAll(async () => {
  await stopContractDb(db);
});

describe('OB-00: každý normativní dotaz kontraktu projde parserem a plánovačem', () => {
  it('najde všech jedenáct normativních dotazů', async () => {
    const files = (await readdir(contractSqlDir)).filter((f) => f.endsWith('.sql')).sort();
    expect(files).toHaveLength(11);
  });

  it('spustí každý dotaz pod rolí, které podle kontraktu patří', async () => {
    const files = (await readdir(contractSqlDir)).filter((f) => f.endsWith('.sql')).sort();
    const failures: string[] = [];

    for (const file of files) {
      const raw = await readFile(path.join(contractSqlDir, file), 'utf8');
      const stmt = parseContractStatement(file, raw);
      const client = stmt.role === 'sender' ? db.sender : db.app;
      const name = `ob00_${file.replace(/\W/g, '_')}`;

      try {
        await client.query(`PREPARE ${name}${paramList(stmt.paramTypes)} AS ${stmt.sql}`);
        await client.query(`EXPLAIN (COSTS OFF) EXECUTE ${name}${argList(stmt.args)}`);
      } catch (error) {
        failures.push(`${file}: ${(error as Error).message}`);
      } finally {
        await client.query(`DEALLOCATE ALL`);
      }
    }

    expect(failures).toEqual([]);
  });

  it('odmítne tvar claimu, který kontrakt výslovně zakazuje', async () => {
    // Pojistka proti tomu, aby se do kontraktu vrátil odkaz na cíl UPDATE
    // uvnitř klauzule ON. Kdyby PostgreSQL tenhle tvar někdy přijal, přestal
    // by být důvod pro zápis s čárkami a plán by o tu informaci přišel.
    //
    // POZOR na to, KDE ta věta je. PostgreSQL vrací hlavní hlášku
    //   invalid reference to FROM-clause entry for table "m"
    // a teprve v poli DETAIL
    //   There is an entry for table "m", but it cannot be referenced from this part of the query.
    // Ovladač pg mapuje hlavní hlášku na `message` a DETAIL na `detail`, takže
    // toThrow() nad `message` by tuhle větu NIKDY nenašel a test by spadl.
    // Ověřeno spuštěním na PostgreSQL 18.4.
    const error = await db.sender
      .query(`
        PREPARE ob00_forbidden (text, int, uuid) AS
        WITH claimable AS (
          SELECT m.id, m.created_at FROM messages m
          WHERE m.campaign_id = $3 AND m.status = 'pending'
          LIMIT $2 FOR UPDATE OF m SKIP LOCKED
        )
        UPDATE messages m SET status = 'claimed', claimed_by = $1
        FROM claimable cl JOIN campaigns c ON c.id = m.campaign_id
        WHERE m.id = cl.id AND m.created_at = cl.created_at
      `)
      .then(
        () => undefined,
        (reason: unknown) => reason as Error & { code?: string; detail?: string },
      );

    expect(error, 'zakázaný tvar claimu musel selhat').toBeDefined();
    expect(error!.code).toBe('42P01');
    expect(error!.message).toMatch(/invalid reference to FROM-clause entry for table "m"/);
    expect(error!.detail).toMatch(/cannot be referenced from this part of the query/);
  });
});

type ContractStatement = { sql: string; role: 'sender' | 'app'; paramTypes: string[]; args: string[] };

/**
 * Prázdný seznam se píše BEZ ZÁVOREK. `PREPARE jméno () AS ...` i `EXECUTE jméno()`
 * jsou v PostgreSQL syntaktická chyba `syntax error at or near ")"`, a dva
 * z jedenácti normativních dotazů parametry nemají. Ověřeno na PostgreSQL 18.4.
 */
const paramList = (types: readonly string[]): string => (types.length === 0 ? '' : ` (${types.join(', ')})`);
const argList = (args: readonly string[]): string => (args.length === 0 ? '' : `(${args.join(', ')})`);

function parseContractStatement(file: string, raw: string): ContractStatement {
  const directive = (name: string): string => {
    // [^\S\n] je "bílý znak kromě konce řádku". Se \s by se výraz protáhl přes
    // konec řádku a u direktivy s prázdnou hodnotou by jako hodnotu sebral
    // NÁSLEDUJÍCÍ řádek: `-- params:` by vrátilo "-- args:" a vzniklo by
    // neplatné SQL. Týká se to dvou souborů z jedenácti.
    const match = raw.match(new RegExp(`^--[^\\S\\n]*${name}:[^\\S\\n]*(.*)$`, 'm'));
    if (!match) throw new Error(`${file}: chybí direktiva -- ${name}:`);
    return match[1].trim();
  };
  const role = directive('role');
  if (role !== 'sender' && role !== 'app') throw new Error(`${file}: role musí být sender nebo app`);
  const paramsRaw = directive('params');
  const argsRaw = directive('args');
  const paramTypes = paramsRaw === '' ? [] : paramsRaw.split(',').map((s) => s.trim());
  const args = argsRaw === '' ? [] : splitArgs(argsRaw);
  if (paramTypes.length !== args.length) {
    throw new Error(`${file}: params má ${paramTypes.length} položek, args ${args.length}`);
  }
  return {
    sql: raw.replace(/^--.*$/gm, '').trim().replace(/;\s*$/, ''),
    role,
    paramTypes,
    args,
  };
}

function splitArgs(input: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = '';
  for (const ch of input) {
    if (ch === "'") quoted = !quoted;
    if (!quoted && (ch === '(' || ch === '[')) depth += 1;
    if (!quoted && (ch === ')' || ch === ']')) depth -= 1;
    if (ch === ',' && depth === 0 && !quoted) {
      out.push(current.trim());
      current = '';
      continue;
    }
    current += ch;
  }
  if (current.trim() !== '') out.push(current.trim());
  return out;
}
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/contracts exec vitest run --project db-ob00`
Expected: FAIL, `Cannot find module './helpers.js'`.

- [ ] **Krok 3: Napiš pomocníka pro databázi**

`packages/contracts/test/db/helpers.ts`:

```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { GenericContainer, Wait, type StartedTestContainer } from 'testcontainers';

const here = path.dirname(fileURLToPath(import.meta.url));
export const packageRoot = path.resolve(here, '..', '..');
export const fixturesDir = path.join(packageRoot, 'fixtures');
export const contractSqlDir = path.join(fixturesDir, 'outbox', 'sql');

export type ContractDb = {
  container?: StartedTestContainer;
  /** spojení pod rolí mlain_migrator, tedy vlastníkem schématu */
  migrator: Client;
  /** spojení pod rolí mlain_app */
  app: Client;
  /** spojení pod rolí mlain_sender, pod kterou běží scénáře OB-xx */
  sender: Client;
};

const POSTGRES_IMAGE = 'postgres:18-alpine';

/**
 * Nastartuje databázi, založí tři role, aplikuje kontraktní bootstrap schéma
 * a vrátí tři otevřená spojení.
 *
 * Když je v prostředí CONTRACTS_DATABASE_URL (job contracts-schema používá
 * services: postgres), kontejner se nestartuje.
 */
export async function startContractDb(): Promise<ContractDb> {
  let container: StartedTestContainer | undefined;
  let superuserUrl = process.env.CONTRACTS_DATABASE_URL;

  if (!superuserUrl) {
    container = await new GenericContainer(POSTGRES_IMAGE)
      .withEnvironment({ POSTGRES_PASSWORD: 'postgres', POSTGRES_DB: 'mlain' })
      .withExposedPorts(5432)
      .withWaitStrategy(Wait.forLogMessage(/database system is ready to accept connections/, 2))
      .start();
    superuserUrl = `postgres://postgres:postgres@${container.getHost()}:${container.getMappedPort(5432)}/mlain`;
  }

  const superuser = new Client({ connectionString: superuserUrl });
  await superuser.connect();
  await superuser.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mlain_migrator') THEN
        CREATE ROLE mlain_migrator LOGIN PASSWORD 'mlain';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mlain_app') THEN
        CREATE ROLE mlain_app LOGIN PASSWORD 'mlain';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mlain_sender') THEN
        CREATE ROLE mlain_sender LOGIN PASSWORD 'mlain';
      END IF;
    END
    $$;
  `);
  await superuser.query('GRANT CREATE, USAGE ON SCHEMA public TO mlain_migrator');
  const dbName = new URL(superuserUrl).pathname.replace(/^\//, '');
  // Grant na schéma NESTAČÍ. `CREATE EXTENSION citext` z bootstrapu chce právo
  // na DATABÁZI a bez něj skončí `permission denied to create extension "citext"`
  // s nápovědou `Must have CREATE privilege on current database`.
  // Ověřeno spuštěním na PostgreSQL 18.4. Tentýž grant potřebuje i migrátor
  // v dockerovém a CI Postgresu, což je požadavek P02→P01.2.
  await superuser.query(`GRANT CREATE ON DATABASE ${dbName} TO mlain_migrator`);
  await superuser.query(`ALTER DATABASE ${dbName} SET timezone = 'UTC'`);
  await superuser.end();

  const asRole = (role: string): Client =>
    new Client({
      connectionString: superuserUrl!.replace(/\/\/[^@]+@/, `//${role}:mlain@`),
    });

  const migrator = asRole('mlain_migrator');
  await migrator.connect();
  // Když se běží proti CONTRACTS_DATABASE_URL, databáze není čerstvá a druhý běh
  // by spadl na existujících tabulkách. Bootstrap je fixture, ne migrace, takže
  // se smí zahodit a založit znovu.
  await migrator.query('DROP TABLE IF EXISTS messages, campaigns, workspaces, suppressions CASCADE');
  const bootstrap = await readFile(path.join(fixturesDir, 'outbox', 'schema.sql'), 'utf8');
  await migrator.query(bootstrap);

  const app = asRole('mlain_app');
  await app.connect();
  const sender = asRole('mlain_sender');
  await sender.connect();

  return { container, migrator, app, sender };
}

export async function stopContractDb(db: ContractDb | undefined): Promise<void> {
  if (!db) return;
  await Promise.all([db.migrator.end(), db.app.end(), db.sender.end()]);
  await db.container?.stop();
}

/** Vyprázdní data mezi scénáři, schéma zůstává. */
export async function truncateAll(db: ContractDb): Promise<void> {
  await db.migrator.query('TRUNCATE messages, campaigns, workspaces, suppressions CASCADE');
}
```

- [ ] **Krok 4: Napiš bootstrap schéma kontraktní podmnožiny**

`packages/contracts/fixtures/outbox/schema.sql`. Blok tabulky `messages`, indexů a úložných parametrů je **doslovný opis** kontraktu 4.10.1. Torza cizích tabulek nesou právě ty sloupce, které kontrakt vyjmenovává v tabulce "Kontraktní podmnožiny cizích tabulek", nic víc.

```sql
-- TOHLE NENÍ SCHÉMA PRODUKTU.
-- Je to kontraktní podmnožina podle části 1, kapitoly 4.10.1, sloužící výhradně
-- k tomu, aby scénář OB-00 a scénáře OB-xx s runnerem "contracts" měly proti
-- čemu běžet už ve vlně 0, tedy dřív, než v P03 vzniknou migrace.
-- Produkční schéma vlastní packages/db (P03). Shodu obou hlídá job
-- contracts-schema podle schema/columns.json.

CREATE EXTENSION IF NOT EXISTS citext;

-- ---------------------------------------------------------------------------
-- Torza cizích tabulek: jen kontraktní sloupce, které sender čte nebo zapisuje.
-- ---------------------------------------------------------------------------
CREATE TABLE workspaces (
  id         uuid PRIMARY KEY DEFAULT uuidv7(),
  name       text NOT NULL DEFAULT '',
  deleted_at timestamptz
);

CREATE TABLE campaigns (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id      uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  status            text NOT NULL DEFAULT 'draft',
  pause_reason      jsonb,
  scheduled_at      timestamptz,
  audience_built_at timestamptz,
  provider_id       uuid,
  compiled_html     text,
  compiled_text     text,
  subject           text,
  preheader         text,
  from_name         text,
  from_email        text,
  reply_to          text,
  track_opens       boolean NOT NULL DEFAULT true,
  track_clicks      boolean NOT NULL DEFAULT true,
  deleted_at        timestamptz
);

CREATE TABLE suppressions (
  workspace_id       uuid NOT NULL,
  email              citext,
  fingerprint        bytea,
  fingerprint_key_id smallint,
  removed_at         timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- KONTRAKTNÍ PODMNOŽINA tabulky messages. Část 4 vlastní zbytek.
-- ---------------------------------------------------------------------------
CREATE TABLE messages (
  id                  uuid        NOT NULL DEFAULT uuidv7(),
  workspace_id        uuid        NOT NULL,
  campaign_id         uuid,
  content_variant_id  uuid,
  kind                text        NOT NULL DEFAULT 'campaign',
  contact_id          uuid        NOT NULL,
  email               text        NOT NULL,
  render_data         jsonb       NOT NULL DEFAULT '{}'::jsonb,
  status              text        NOT NULL DEFAULT 'pending',
  claimed_by          text,
  claimed_at          timestamptz,
  claim_expires_at    timestamptz,
  attempts            smallint    NOT NULL DEFAULT 0,
  ambiguous_count     smallint    NOT NULL DEFAULT 0,
  dispatch_started_at timestamptz,
  next_attempt_at     timestamptz NOT NULL DEFAULT now(),
  provider_message_id text,
  sent_at             timestamptz,
  error_code          text,
  error_detail        text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at),
  CONSTRAINT ck_messages__status
    CHECK (status IN ('pending','claimed','sent','failed','skipped')),
  CONSTRAINT ck_messages__kind
    CHECK (kind IN ('campaign','test'))
) PARTITION BY RANGE (created_at);

CREATE INDEX idx_messages__claimable
  ON messages (campaign_id, next_attempt_at, id)
  WHERE status = 'pending';

CREATE INDEX idx_messages__stuck
  ON messages (claim_expires_at)
  WHERE status = 'claimed';

CREATE INDEX idx_messages__campaign_status
  ON messages (campaign_id, status);

CREATE UNIQUE INDEX uq_messages__campaign_contact
  ON messages (campaign_id, contact_id, created_at);

-- Partition na dva měsíce dopředu. Výchozí partition se NEZAKLÁDÁ, zápis mimo
-- rozsah má selhat hlasitě (konvence 2.1).
CREATE TABLE messages_y2026m08 PARTITION OF messages
  FOR VALUES FROM ('2026-08-01 00:00:00+00') TO ('2026-09-01 00:00:00+00');
CREATE TABLE messages_y2026m09 PARTITION OF messages
  FOR VALUES FROM ('2026-09-01 00:00:00+00') TO ('2026-10-01 00:00:00+00');

-- Úložné parametry nejdou nastavit na partitionované tabulce jako celku,
-- nastavují se na každé partition zvlášť.
ALTER TABLE messages_y2026m08 SET (
  fillfactor = 70,
  autovacuum_vacuum_scale_factor  = 0.02,
  autovacuum_vacuum_threshold     = 1000,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_vacuum_cost_delay    = 0
);
ALTER TABLE messages_y2026m09 SET (
  fillfactor = 70,
  autovacuum_vacuum_scale_factor  = 0.02,
  autovacuum_vacuum_threshold     = 1000,
  autovacuum_analyze_scale_factor = 0.02,
  autovacuum_vacuum_cost_delay    = 0
);

-- ---------------------------------------------------------------------------
-- Granty senderu, doslovně podle 4.10.1.
-- ---------------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO mlain_sender;
GRANT USAGE ON SCHEMA public TO mlain_app;

GRANT SELECT ON messages TO mlain_sender;
GRANT UPDATE (status, claimed_by, claimed_at, claim_expires_at,
              dispatch_started_at, attempts, next_attempt_at,
              provider_message_id, sent_at, error_code, error_detail,
              ambiguous_count, updated_at)
  ON messages TO mlain_sender;
-- created_at ve výčtu SCHVÁLNĚ NENÍ, viz invariant I1.

GRANT SELECT ON campaigns TO mlain_sender;
GRANT UPDATE (status, pause_reason) ON campaigns TO mlain_sender;
GRANT SELECT ON workspaces   TO mlain_sender;
GRANT SELECT ON suppressions TO mlain_sender;

GRANT SELECT, INSERT, UPDATE ON messages, campaigns, workspaces, suppressions TO mlain_app;

-- ---------------------------------------------------------------------------
-- RLS a permisivní politika senderu. Bez ní vrací claim nula řádků VŽDY.
-- ---------------------------------------------------------------------------
ALTER TABLE messages     ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaigns    ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces   ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppressions ENABLE ROW LEVEL SECURITY;

CREATE POLICY sender_bypass ON messages     TO mlain_sender USING (true) WITH CHECK (true);
CREATE POLICY sender_bypass ON campaigns    TO mlain_sender USING (true);
CREATE POLICY sender_bypass ON workspaces   TO mlain_sender USING (true);
CREATE POLICY sender_bypass ON suppressions TO mlain_sender USING (true);

-- Aplikační role tady nemá izolační politiku ws_isolation, protože tu vlastní
-- P03 a kontrakt na ni nesahá. Bootstrap jí dává permisivní politiku, aby šly
-- připravit vstupní data scénářů.
CREATE POLICY app_all ON messages     TO mlain_app USING (true) WITH CHECK (true);
CREATE POLICY app_all ON campaigns    TO mlain_app USING (true) WITH CHECK (true);
CREATE POLICY app_all ON workspaces   TO mlain_app USING (true) WITH CHECK (true);
CREATE POLICY app_all ON suppressions TO mlain_app USING (true) WITH CHECK (true);
```

- [ ] **Krok 5: Zapiš jedenáct normativních dotazů, každý do vlastního souboru**

Každý soubor má tři direktivy v hlavičce, aby runner věděl, pod jakou rolí dotaz spustit a jaké typy mají parametry. Bez explicitních typů skončí `PREPARE` u výrazu `WHEN $1 = 'retry'` chybou `could not determine data type of parameter $1`, protože obě strany porovnání jsou neznámého typu.

`fixtures/outbox/sql/01-claim-running-campaigns.sql`:

```sql
-- role: sender
-- params:
-- args:
SELECT c.id
FROM campaigns c
JOIN workspaces w ON w.id = c.workspace_id
WHERE c.status IN ('queueing','sending')
  AND c.deleted_at IS NULL
  AND w.deleted_at IS NULL
ORDER BY c.scheduled_at NULLS FIRST, c.id;
```

`fixtures/outbox/sql/02-claim-batch.sql`:

```sql
-- role: sender
-- params: text, int, int, uuid
-- args: 'mlain-ws-7f3a', 100, 300, '0192f3a0-1c2d-7e44-9e5f-60718293a4b5'
WITH claimable AS (
  SELECT m.id, m.created_at
  FROM messages m
  WHERE m.campaign_id = $4
    AND m.status = 'pending'
    AND m.next_attempt_at <= now()
  ORDER BY m.next_attempt_at, m.id
  LIMIT $2
  FOR UPDATE OF m SKIP LOCKED
)
UPDATE messages m
SET status           = 'claimed',
    claimed_by       = $1,
    claimed_at       = now(),
    claim_expires_at = now() + make_interval(secs => $3),
    updated_at       = now()
FROM claimable cl, campaigns c, workspaces w
WHERE m.id         = cl.id
  AND m.created_at = cl.created_at
  AND m.campaign_id IS NOT NULL
  AND c.id         = m.campaign_id
  AND w.id         = m.workspace_id
  AND c.status IN ('queueing','sending')
  AND c.deleted_at IS NULL
  AND w.deleted_at IS NULL
RETURNING m.id, m.created_at, m.workspace_id, m.campaign_id, m.contact_id,
          m.email, m.render_data, m.attempts;
```

`fixtures/outbox/sql/03-heartbeat.sql`:

```sql
-- role: sender
-- params: text, int, uuid[], timestamptz[]
-- args: 'mlain-ws-7f3a', 300, ARRAY['0192f3a0-1c2d-7e41-8b2c-3d4e5f607182']::uuid[], ARRAY['2026-08-01T00:00:00Z']::timestamptz[]
UPDATE messages m
SET claim_expires_at = now() + make_interval(secs => $2), updated_at = now()
FROM unnest($3::uuid[], $4::timestamptz[]) AS k(id, created_at)
WHERE m.id = k.id AND m.created_at = k.created_at
  AND m.status = 'claimed' AND m.claimed_by = $1;
```

`fixtures/outbox/sql/04-reaper-stuck.sql`:

```sql
-- role: sender
-- params:
-- args:
UPDATE messages
SET status = 'pending', claimed_by = NULL, claimed_at = NULL,
    claim_expires_at = NULL, next_attempt_at = now(), updated_at = now()
WHERE status = 'claimed' AND claim_expires_at < now()
  AND dispatch_started_at IS NULL
RETURNING id;
```

`fixtures/outbox/sql/05-reaper-ambiguous.sql`:

```sql
-- role: sender
-- params: text, int
-- args: 'retry', 300
UPDATE messages
SET ambiguous_count = ambiguous_count + 1,
    status = CASE
               WHEN $1 = 'retry' AND ambiguous_count = 0 THEN 'pending'
               ELSE 'failed'
             END,
    error_code          = 'ambiguous_dispatch',
    claimed_by          = NULL, claimed_at = NULL, claim_expires_at = NULL,
    dispatch_started_at = NULL,
    next_attempt_at     = now(),
    updated_at          = now()
WHERE status = 'claimed'
  AND claim_expires_at < now() - make_interval(secs => $2)
  AND dispatch_started_at IS NOT NULL
  AND provider_message_id IS NULL
RETURNING id, created_at, ambiguous_count;
```

`fixtures/outbox/sql/06-shutdown-release.sql`:

```sql
-- role: sender
-- params: text
-- args: 'mlain-ws-7f3a'
UPDATE messages
SET status = 'pending', claimed_by = NULL, claimed_at = NULL,
    claim_expires_at = NULL, updated_at = now()
WHERE status = 'claimed' AND claimed_by = $1 AND dispatch_started_at IS NULL;
```

`fixtures/outbox/sql/07-dispatch-begin.sql`:

```sql
-- role: sender
-- params: uuid, timestamptz, text
-- args: '0192f3a0-1c2d-7e41-8b2c-3d4e5f607182', '2026-08-01T00:00:00Z', 'mlain-ws-7f3a'
UPDATE messages
SET attempts = attempts + 1, dispatch_started_at = now(), updated_at = now()
WHERE id = $1 AND created_at = $2
  AND status = 'claimed' AND claimed_by = $3;
```

`fixtures/outbox/sql/08-dispatch-result.sql`:

```sql
-- role: sender
-- params: uuid, timestamptz, text, text
-- args: '0192f3a0-1c2d-7e41-8b2c-3d4e5f607182', '2026-08-01T00:00:00Z', 'mlain-ws-7f3a', '0100018f-provider'
UPDATE messages
SET status = 'sent', provider_message_id = $4, sent_at = now(),
    dispatch_started_at = NULL, updated_at = now()
WHERE id = $1 AND created_at = $2
  AND status = 'claimed' AND claimed_by = $3;
```

`fixtures/outbox/sql/09-materialize-insert.sql`:

```sql
-- role: app
-- params: uuid, uuid, uuid, uuid, text, jsonb, timestamptz
-- args: '0192f3a0-1c2d-7e41-8b2c-3d4e5f607182', '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071', '0192f3a0-1c2d-7e44-9e5f-60718293a4b5', '0192f3a0-1c2d-7e43-8d4e-5f60718293a4', 'jana@example.cz', '{}'::jsonb, '2026-08-01T10:00:00Z'
INSERT INTO messages (id, workspace_id, campaign_id, contact_id, email, render_data, created_at)
VALUES ($1, $2, $3, $4, $5, $6, $7)
ON CONFLICT (campaign_id, contact_id, created_at) DO NOTHING;
```

`fixtures/outbox/sql/10-suppression-check.sql`:

```sql
-- role: sender
-- params: uuid, text, bytea[]
-- args: '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071', 'jana@example.cz', ARRAY['\x0011'::bytea]
SELECT 1 FROM suppressions
WHERE workspace_id = $1
  AND removed_at IS NULL
  AND (email = $2 OR fingerprint = ANY($3))
LIMIT 1;
```

`fixtures/outbox/sql/11-campaign-pause.sql`:

```sql
-- role: sender
-- params: uuid, jsonb
-- args: '0192f3a0-1c2d-7e44-9e5f-60718293a4b5', '{"code":"provider_quota_exhausted","source":"sender","at":"2026-07-31T14:22:31Z"}'::jsonb
UPDATE campaigns
SET status = 'paused', pause_reason = $2
WHERE id = $1 AND status IN ('queueing', 'sending');
```

- [ ] **Krok 6: Spusť `OB-00` a ověř, že prochází**

Run: `pnpm --filter @mlain/contracts exec vitest run --project db-ob00`
Expected: PASS, 3 testy. První běh stáhne image `postgres:18-alpine`, takže může trvat minutu.

Kdyby kterýkoliv dotaz spadl, **neopravuje se dotaz**, protože je opsaný ze zmrazeného kontraktu. Opravuje se bootstrap schéma nebo hlavička s typy parametrů. Když je chyba prokazatelně v kontraktu, zapíše se do kapitoly 10 a eskaluje na vlastníka části 1.

- [ ] **Krok 7: Commit**

```bash
git add packages/contracts/fixtures/outbox packages/contracts/test/db
git commit -m "test(contracts): OB-00 spouští jedenáct normativních dotazů kontraktu proti PostgreSQL"
```

---

### Úkol 3: `OB-00` na Go straně

Kontrakt v 4.10.1 říká, že se scénáře spouštějí "proti reálnému Postgresu **na obou stranách**". Go strana má vlastní běh, protože používá jiný ovladač (pgx, ne pg) a jiný způsob předávání parametrů, a právě tam se rozdíly projeví.

**Test si databázi připraví sám.** Dřívější znění čekalo, že mu někdo předem nastaví `DATABASE_URL_SENDER` i `DATABASE_URL_APP` a předem aplikuje bootstrap. Ani jedno v CI neplatí: job `test-go-integration` z P01 nastavuje **jen** `DATABASE_URL_SENDER`, a to na uživatele `mlain_migrator`, žádný bootstrap nespouští, a `DATABASE_URL_APP` v celém P01 není. Test by tedy skončil na `t.Fatal` hned na prvním řádku. Nově si test z jednoho administrátorského spojení založí role, doplní grant a aplikuje `fixtures/outbox/schema.sql`, tedy dělá totéž co `helpers.ts` na TypeScript straně. Jediné, co po CI chce, je proměnná `DATABASE_URL_MIGRATOR` (požadavek P02→P01.3), kterou tři jiné joby už nastavují.

**Files:**
- Create: `apps/sender/internal/contracts/sqlheader.go`
- Test: `apps/sender/internal/contracts/outbox_ob00_test.go`

`apps/sender/go.mod` se **nemění**. Jediná potřebná závislost `github.com/jackc/pgx/v5` je v něm od P01.

- [ ] **Krok 1: Napiš padající Go test**

`apps/sender/internal/contracts/outbox_ob00_test.go`:

```go
//go:build integration

package contracts

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/jackc/pgx/v5"
)

// adminURL vrací administrátorské spojení, ze kterého si test databázi připraví.
// Pořadí je dané: DATABASE_URL_MIGRATOR je to, co nastavuje CI, CONTRACTS_DATABASE_URL
// je lokální zkratka. Když není ani jedno, test SELŽE. Nikdy se nepřeskakuje:
// přeskočený OB-00 vypadá zeleně a přitom neověří nic.
func adminURL(t *testing.T) string {
	t.Helper()
	for _, name := range []string{"DATABASE_URL_MIGRATOR", "CONTRACTS_DATABASE_URL"} {
		if value := os.Getenv(name); value != "" {
			return value
		}
	}
	t.Fatal("DATABASE_URL_MIGRATOR nebo CONTRACTS_DATABASE_URL musí být nastavené; OB-00 se nesmí přeskočit")
	return ""
}

// withUser přepíše uživatele a heslo v připojovacím řetězci. Role zakládá bootstrap
// níž se stejným heslem, takže se nemusí předávat další proměnná.
func withUser(raw, user string) (string, error) {
	parsed, err := url.Parse(raw)
	if err != nil {
		return "", err
	}
	parsed.User = url.UserPassword(user, "mlain")
	return parsed.String(), nil
}

// bootstrap založí role, doplní grant na databázi a aplikuje kontraktní schéma.
// Je to tentýž soubor, který používá TypeScript strana, takže se schéma neopisuje.
func bootstrap(ctx context.Context, t *testing.T, admin *pgx.Conn) {
	t.Helper()
	for _, role := range []string{"mlain_migrator", "mlain_app", "mlain_sender"} {
		if _, err := admin.Exec(ctx, fmt.Sprintf(`
			DO $$
			BEGIN
			  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '%s') THEN
			    CREATE ROLE %s LOGIN PASSWORD 'mlain';
			  END IF;
			END
			$$;`, role, role)); err != nil {
			t.Fatalf("role %s: %v", role, err)
		}
	}
	var dbName string
	if err := admin.QueryRow(ctx, "SELECT current_database()").Scan(&dbName); err != nil {
		t.Fatalf("current_database: %v", err)
	}
	// Bez tohohle grantu skončí CREATE EXTENSION citext hláškou
	// `permission denied to create extension`. Ověřeno na PostgreSQL 18.4.
	for _, stmt := range []string{
		fmt.Sprintf("GRANT CREATE ON DATABASE %s TO mlain_migrator", pgx.Identifier{dbName}.Sanitize()),
		"GRANT CREATE, USAGE ON SCHEMA public TO mlain_migrator",
		"DROP TABLE IF EXISTS messages, campaigns, workspaces, suppressions CASCADE",
	} {
		if _, err := admin.Exec(ctx, stmt); err != nil {
			t.Fatalf("%s: %v", stmt, err)
		}
	}
	schema, err := ReadFixture(filepath.Join("outbox", "schema.sql"))
	if err != nil {
		t.Fatalf("bootstrap schéma nejde přečíst: %v", err)
	}
	if _, err := admin.Exec(ctx, string(schema)); err != nil {
		t.Fatalf("bootstrap schéma se nezaložilo: %v", err)
	}
}

// TestOB00 spouští každý normativní dotaz kontraktu 4.10.1 proti reálné
// databázi. Netvrdí nic o výsledku, jen že dotaz projde parserem a plánovačem.
func TestOB00(t *testing.T) {
	ctx := context.Background()

	admin, err := pgx.Connect(ctx, adminURL(t))
	if err != nil {
		t.Fatalf("administrátorské spojení selhalo: %v", err)
	}
	defer admin.Close(ctx)
	bootstrap(ctx, t, admin)

	senderURL, err := withUser(adminURL(t), "mlain_sender")
	if err != nil {
		t.Fatalf("sender URL: %v", err)
	}
	appURL, err := withUser(adminURL(t), "mlain_app")
	if err != nil {
		t.Fatalf("app URL: %v", err)
	}

	sender, err := pgx.Connect(ctx, senderURL)
	if err != nil {
		t.Fatalf("spojení pod rolí mlain_sender selhalo: %v", err)
	}
	defer sender.Close(ctx)

	app, err := pgx.Connect(ctx, appURL)
	if err != nil {
		t.Fatalf("spojení pod rolí mlain_app selhalo: %v", err)
	}
	defer app.Close(ctx)

	// Pojistka proti nálezu z revize: kdyby scénáře běžely pod migrátorem,
	// prošly by a zamaskovaly chybějící politiku sender_bypass.
	var currentUser string
	if err := sender.QueryRow(ctx, "SELECT current_user").Scan(&currentUser); err != nil {
		t.Fatalf("current_user selhal: %v", err)
	}
	if currentUser != "mlain_sender" {
		t.Fatalf("scénáře musí běžet pod rolí mlain_sender, běží pod %s", currentUser)
	}

	dir := filepath.Join(FixturesDir(), "outbox", "sql")
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("nelze číst %s: %v", dir, err)
	}
	names := make([]string, 0, len(entries))
	for _, e := range entries {
		if strings.HasSuffix(e.Name(), ".sql") {
			names = append(names, e.Name())
		}
	}
	sort.Strings(names)
	if len(names) != 11 {
		t.Fatalf("čekám jedenáct normativních dotazů, je jich %d", len(names))
	}

	for _, name := range names {
		t.Run(name, func(t *testing.T) {
			raw, err := os.ReadFile(filepath.Join(dir, name))
			if err != nil {
				t.Fatalf("čtení selhalo: %v", err)
			}
			stmt, err := parseContractStatement(name, string(raw))
			if err != nil {
				t.Fatalf("%v", err)
			}
			conn := sender
			if stmt.Role == "app" {
				conn = app
			}
			prepared := "ob00_" + strings.NewReplacer(".", "_", "-", "_").Replace(name)
			// Prázdný seznam BEZ ZÁVOREK. `PREPARE jméno ()` i `EXECUTE jméno()`
			// jsou syntaktická chyba a dva z jedenácti dotazů parametry nemají.
			if _, err := conn.Exec(ctx,
				"PREPARE "+prepared+ParamList(stmt.ParamTypes)+" AS "+stmt.SQL); err != nil {
				t.Fatalf("PREPARE selhal: %v", err)
			}
			if _, err := conn.Exec(ctx,
				"EXPLAIN (COSTS OFF) EXECUTE "+prepared+ArgList(stmt.Args)); err != nil {
				t.Fatalf("EXPLAIN EXECUTE selhal: %v", err)
			}
			if _, err := conn.Exec(ctx, "DEALLOCATE ALL"); err != nil {
				t.Fatalf("DEALLOCATE selhal: %v", err)
			}
		})
	}
}
```

- [ ] **Krok 2: Spusť a ověř, že padá**

Run: `cd apps/sender && go test -tags=integration ./internal/contracts/ -run TestOB00`
Expected: FAIL, `undefined: parseContractStatement`.

- [ ] **Krok 3: Doplň parser hlaviček**

Žádný `go get` se nespouští. Po rozhodnutí D8 nemá Go strana P02 co implementovat, takže si vystačí se standardní knihovnou a s `pgx`, který v `go.mod` od P01 je. Ověř to, ať se to nezmění nepozorovaně:

```bash
cd apps/sender && git diff --stat go.mod go.sum
```

Expected: prázdný výstup. Jakákoliv změna `go.mod` v tomhle plánu je chyba.

`apps/sender/internal/contracts/sqlheader.go`:

```go
// Package contracts drží Go stranu golden fixtures pěti zmrazených kontraktů.
// Je to balíček TESTOVACÍ PODPORY: čte fixtures, počítá jejich otisk, zapisuje
// report parity a nabízí runnery. IMPLEMENTACI KONTRAKTŮ NEOBSAHUJE, tu vlastní
// P09 v produkčních balíčcích a runnery ji dostávají jako parametr (rozhodnutí D8).
package contracts

import (
	"fmt"
	"regexp"
	"strings"
)

// ParamList a ArgList píšou prázdný seznam BEZ ZÁVOREK. `PREPARE jméno ()` i
// `EXECUTE jméno()` jsou v PostgreSQL syntaktická chyba `syntax error at or near ")"`.
// Ověřeno na PostgreSQL 18.4.
func ParamList(types []string) string {
	if len(types) == 0 {
		return ""
	}
	return " (" + strings.Join(types, ", ") + ")"
}

func ArgList(args []string) string {
	if len(args) == 0 {
		return ""
	}
	return "(" + strings.Join(args, ", ") + ")"
}

// ContractStatement je jeden normativní dotaz kontraktu 4.10.1 i s hlavičkou,
// která říká, pod jakou rolí se spouští a jaké typy mají jeho parametry.
type ContractStatement struct {
	SQL        string
	Role       string
	ParamTypes []string
	Args       []string
}

var commentLine = regexp.MustCompile(`(?m)^--.*$`)

func directive(file, raw, name string) (string, error) {
	// [^\S\n] je "bílý znak kromě konce řádku". Se \s by se výraz protáhl přes
	// konec řádku a u direktivy s prázdnou hodnotou by sebral NÁSLEDUJÍCÍ řádek:
	// `-- params:` by vrátilo "-- args:" a vzniklo by neplatné SQL.
	re := regexp.MustCompile(`(?m)^--[^\S\n]*` + name + `:[^\S\n]*(.*)$`)
	m := re.FindStringSubmatch(raw)
	if m == nil {
		return "", fmt.Errorf("%s: chybí direktiva -- %s:", file, name)
	}
	return strings.TrimSpace(m[1]), nil
}

func parseContractStatement(file, raw string) (ContractStatement, error) {
	role, err := directive(file, raw, "role")
	if err != nil {
		return ContractStatement{}, err
	}
	if role != "sender" && role != "app" {
		return ContractStatement{}, fmt.Errorf("%s: role musí být sender nebo app, je %q", file, role)
	}
	params, err := directive(file, raw, "params")
	if err != nil {
		return ContractStatement{}, err
	}
	args, err := directive(file, raw, "args")
	if err != nil {
		return ContractStatement{}, err
	}
	paramTypes := splitTopLevel(params)
	argValues := splitTopLevel(args)
	if len(paramTypes) != len(argValues) {
		return ContractStatement{}, fmt.Errorf(
			"%s: params má %d položek, args %d", file, len(paramTypes), len(argValues))
	}
	sql := strings.TrimRight(strings.TrimSpace(commentLine.ReplaceAllString(raw, "")), ";")
	return ContractStatement{
		SQL:        strings.TrimSpace(sql),
		Role:       role,
		ParamTypes: paramTypes,
		Args:       argValues,
	}, nil
}

// splitTopLevel dělí seznam čárkami mimo závorky, hranaté závorky a apostrofy.
func splitTopLevel(input string) []string {
	if strings.TrimSpace(input) == "" {
		return nil
	}
	out := []string{}
	depth := 0
	quoted := false
	current := strings.Builder{}
	for _, ch := range input {
		switch {
		case ch == '\'':
			quoted = !quoted
		case !quoted && (ch == '(' || ch == '['):
			depth++
		case !quoted && (ch == ')' || ch == ']'):
			depth--
		case ch == ',' && depth == 0 && !quoted:
			out = append(out, strings.TrimSpace(current.String()))
			current.Reset()
			continue
		}
		current.WriteRune(ch)
	}
	if strings.TrimSpace(current.String()) != "" {
		out = append(out, strings.TrimSpace(current.String()))
	}
	return out
}
```

- [ ] **Krok 4: Spusť Go `OB-00` proti databázi a ověř, že prochází**

Test si role i schéma založí sám, takže stačí prázdný Postgres a jedna proměnná:

```bash
docker run -d --name mlain-ob00 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=mlain -p 55432:5432 postgres:18-alpine
until docker exec mlain-ob00 pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
cd apps/sender && DATABASE_URL_MIGRATOR=postgres://postgres:postgres@localhost:55432/mlain \
  go test -tags=integration ./internal/contracts/ -run TestOB00 -v
```

Expected: PASS, jedenáct podtestů. Po doběhnutí `docker rm -f mlain-ob00`.

Administrátorské spojení musí umět `CREATE ROLE`. V dockerovém i v CI Postgresu je `POSTGRES_USER` superuser, takže to platí; kdyby ne, test spadne hlasitě na založení role, ne tiše na chybějícím schématu.

- [ ] **Krok 5: Ověř, že se `go.mod` nezměnil**

```bash
cd apps/sender && git diff --exit-code go.mod go.sum && echo "go.mod beze změny"
```

Expected: `go.mod beze změny`. Tenhle plán do manifestu modulu nezapisuje.

- [ ] **Krok 6: Commit**

```bash
git add apps/sender/internal/contracts
git commit -m "test(contracts): OB-00 běží i na Go straně pod rolí mlain_sender"
```

---

### Úkol 4: Outbox protokol v kódu, stavy, přechody a registry

Kontrakt 1 není jen SQL. Vlastní i uzavřený výčet stavů, tabulku povolených přechodů s jedinou pojmenovanou výjimkou, registr `messages.error_code` a tvar objektu `campaigns.pause_reason`. Všechno to musí být kód, na který jde napsat test, ne odstavec.

**Tabulka přechodů je fixture, ne dva ručně opsané seznamy.** Dřívější znění ji mělo dvakrát, v TypeScriptu a v Go, přepsanou rukou. To je přesně ta duplicita, kterou zavírá rozhodnutí D8: Go implementaci vlastní P09, takže tabulka musí být jazykově neutrální data, která obě strany čtou z jednoho souboru. Ukládá se do `fixtures/outbox/scenarios.json` pod klíč `transitions`, aby nevznikal další soubor a další schéma.

**Files:**
- Create: `packages/contracts/src/outbox.ts`
- Create: `packages/contracts/src/outbox-errors.ts`
- Create: `packages/contracts/src/pause-reason.ts`
- Test: `packages/contracts/test/outbox.test.ts`
- Test: `packages/contracts/test/outbox-errors.test.ts`

Go protějšek tady **nevzniká**. Tabulku přechodů implementuje P09 v `internal/outbox` a spouští nad ní runner `RunOutboxTransitions` z úkolu 16 (požadavek P02→P09.2).

- [ ] **Krok 1: Napiš padající test přechodů**

`packages/contracts/test/outbox.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assertTransition, canTransition, MESSAGE_STATUSES, TERMINAL_STATUSES,
  type TransitionActor, type MessageStatus,
} from '../src/outbox.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

type TransitionCase = {
  id: string;
  from: MessageStatus;
  to: MessageStatus;
  actor: TransitionActor;
  error_code?: string | null;
  allowed: boolean;
};

const registry = JSON.parse(
  await readFile(path.join(packageRoot, 'fixtures', 'outbox', 'scenarios.json'), 'utf8'),
) as { transitions: TransitionCase[] };

describe('stavy a přechody messages', () => {
  it('má právě pět stavů ve tvaru z CHECK constraintu', () => {
    expect(MESSAGE_STATUSES).toEqual(['pending', 'claimed', 'sent', 'failed', 'skipped']);
  });

  it('má tři koncové stavy', () => {
    expect(TERMINAL_STATUSES).toEqual(['sent', 'failed', 'skipped']);
  });

  it('má čtrnáct případů přechodu a žádné id se neopakuje', () => {
    expect(registry.transitions).toHaveLength(14);
    expect(new Set(registry.transitions.map((c) => c.id)).size).toBe(14);
  });

  // Tytéž případy pouští Go strana přes RunOutboxTransitions nad TÍMTÉŽ souborem.
  // Kdyby si je jedna strana opsala, testovala by opis, ne kontrakt.
  it.each(registry.transitions)('$id: $from -> $to ($actor) je allowed=$allowed', (testCase) => {
    expect(
      canTransition({
        from: testCase.from,
        to: testCase.to,
        actor: testCase.actor,
        errorCode: testCase.error_code ?? undefined,
      }),
    ).toBe(testCase.allowed);
  });

  it('OB-07: pending -> sent bez claimu odmítne aplikační kontrola, ne databáze', () => {
    expect(canTransition({ from: 'pending', to: 'sent', actor: 'sender' })).toBe(false);
  });

  it('assertTransition hodí chybu s popisem, ne jen false', () => {
    expect(() => assertTransition({ from: 'sent', to: 'failed', actor: 'app' })).toThrow(
      /sent -> failed/,
    );
  });
});
```

Poznámka k `OB-07`: jeho id je v názvu testu schválně, protože kontrolu pokrytí registru v úkolu 6 dělá vyhledání identifikátoru v textu testů. Dřív měl `OB-07` v té kontrole ručně zapsanou výjimku, což je přesně ten druh výjimky, která přežije i poté, co přestane platit.

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/contracts exec vitest run --project unit test/outbox.test.ts`
Expected: FAIL, `Cannot find module '../src/outbox.js'`.

- [ ] **Krok 3: Napiš `src/outbox.ts`**

```ts
/**
 * Kontrakt 1: outbox protokol.
 * Zdroj: část 1, kapitola 4.10.1. ZMRAZENO. Změna znamená verzi v2, ne úpravu v1.
 */

export const MESSAGE_STATUSES = ['pending', 'claimed', 'sent', 'failed', 'skipped'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const MESSAGE_KINDS = ['campaign', 'test'] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

export const TERMINAL_STATUSES = ['sent', 'failed', 'skipped'] as const;

/** Kdo přechod provádí. `reaper` běží uvnitř senderu, ale nekontroluje `claimed_by`. */
export type TransitionActor = 'app' | 'sender' | 'reaper';

export type TransitionInput = {
  from: MessageStatus;
  to: MessageStatus;
  actor: TransitionActor;
  /** hodnota `messages.error_code` na řádku PŘED přechodem */
  errorCode?: string | null;
};

type Rule = { from: MessageStatus; to: MessageStatus; actors: readonly TransitionActor[] };

const RULES: readonly Rule[] = [
  { from: 'pending', to: 'claimed', actors: ['sender'] },
  { from: 'pending', to: 'skipped', actors: ['app'] },
  { from: 'claimed', to: 'sent', actors: ['sender'] },
  { from: 'claimed', to: 'failed', actors: ['sender'] },
  { from: 'claimed', to: 'pending', actors: ['sender', 'reaper'] },
  { from: 'claimed', to: 'skipped', actors: ['sender'] },
];

/**
 * Jediná výjimka ze zákazu `failed -> sent`.
 *
 * Přechod je povolený výhradně tehdy, když má zpráva `error_code = 'ambiguous_dispatch'`
 * a provádí ho APLIKACE při zpracování události od providera. Sender výjimku nemá.
 * Vázanost na jednu hodnotu v jednom sloupci dělá výjimku auditovatelnou.
 */
export const AMBIGUOUS_DISPATCH_ERROR_CODE = 'ambiguous_dispatch';

export function canTransition(input: TransitionInput): boolean {
  if (
    input.from === 'failed' &&
    input.to === 'sent' &&
    input.actor === 'app' &&
    input.errorCode === AMBIGUOUS_DISPATCH_ERROR_CODE
  ) {
    return true;
  }
  return RULES.some(
    (rule) => rule.from === input.from && rule.to === input.to && rule.actors.includes(input.actor),
  );
}

export class OutboxTransitionError extends Error {
  constructor(readonly input: TransitionInput) {
    super(
      `zakázaný přechod messages.status: ${input.from} -> ${input.to} (aktér ${input.actor}` +
        `, error_code ${input.errorCode === undefined ? 'neuvedeno' : String(input.errorCode)})`,
    );
    this.name = 'OutboxTransitionError';
  }
}

export function assertTransition(input: TransitionInput): void {
  if (!canTransition(input)) throw new OutboxTransitionError(input);
}

/**
 * Kontraktní sloupce tabulky messages. Část 4 smí přidávat sloupce a indexy,
 * nesmí měnit název, typ ani sémantiku těchto.
 *
 * Typy jsou hodnoty `information_schema.columns.data_type`, protože proti tomu
 * porovnává job contracts-schema.
 */
export const MESSAGES_CONTRACT_COLUMNS: Readonly<Record<string, string>> = Object.freeze({
  id: 'uuid',
  workspace_id: 'uuid',
  campaign_id: 'uuid',
  content_variant_id: 'uuid',
  kind: 'text',
  contact_id: 'uuid',
  email: 'text',
  render_data: 'jsonb',
  status: 'text',
  claimed_by: 'text',
  claimed_at: 'timestamp with time zone',
  claim_expires_at: 'timestamp with time zone',
  attempts: 'smallint',
  ambiguous_count: 'smallint',
  dispatch_started_at: 'timestamp with time zone',
  next_attempt_at: 'timestamp with time zone',
  provider_message_id: 'text',
  sent_at: 'timestamp with time zone',
  error_code: 'text',
  error_detail: 'text',
  created_at: 'timestamp with time zone',
  updated_at: 'timestamp with time zone',
});

/** Sloupce, na které má sender `UPDATE` grant. `created_at` mezi nimi SCHVÁLNĚ není. */
export const MESSAGES_SENDER_UPDATABLE_COLUMNS = [
  'status',
  'claimed_by',
  'claimed_at',
  'claim_expires_at',
  'dispatch_started_at',
  'attempts',
  'next_attempt_at',
  'provider_message_id',
  'sent_at',
  'error_code',
  'error_detail',
  'ambiguous_count',
  'updated_at',
] as const;

/** Kontraktní sloupce cizích tabulek, které sender čte nebo zapisuje (4.10.1). */
export const FOREIGN_CONTRACT_COLUMNS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  campaigns: [
    'id', 'workspace_id', 'status', 'pause_reason', 'scheduled_at', 'audience_built_at',
    'provider_id', 'compiled_html', 'compiled_text', 'subject', 'preheader', 'from_name',
    'from_email', 'reply_to', 'track_opens', 'track_clicks', 'deleted_at',
  ],
  sending_providers: ['id', 'workspace_id', 'type', 'config_encrypted', 'quota_max_send_rate', 'verified_at'],
  campaign_links: ['id', 'campaign_id', 'url', 'position'],
  workspaces: ['id', 'deleted_at'],
  suppressions: ['workspace_id', 'email', 'fingerprint', 'fingerprint_key_id', 'removed_at', 'created_at'],
  message_events: [
    'id', 'message_id', 'message_created_at', 'workspace_id', 'type', 'ts', 'received_at', 'source', 'metadata',
  ],
});

/** Výchozí hodnoty parametrů claimu podle 4.9. Sender je čte z prostředí. */
export const CLAIM_DEFAULTS = Object.freeze({
  batchSize: 100,
  claimTtlSeconds: 300,
  pollIntervalMs: 1000,
});
```

- [ ] **Krok 4: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/contracts exec vitest run --project unit test/outbox.test.ts`
Expected: PASS, **19 testů** (tři strukturní, čtrnáct případů přechodu, `OB-07` a `assertTransition`). Číslo je přepočítané; dřívější znění tady uvádělo 20 a neodpovídalo obsahu souboru.

- [ ] **Krok 5: Napiš padající test registru chybových kódů a `pause_reason`**

`packages/contracts/test/outbox-errors.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  CONTRACT_OUTBOX_ERROR_CODES,
  isKnownOutboxErrorCode,
  mergeOutboxErrorCodes,
} from '../src/outbox-errors.js';
import { assertSenderPauseReason, PAUSE_REASON_CODES, SENDER_PAUSE_REASON_CODES } from '../src/pause-reason.js';

describe('registr messages.error_code', () => {
  it('nese patnáct kontraktních kódů z tabulky v 4.10.1', () => {
    expect(CONTRACT_OUTBOX_ERROR_CODES).toHaveLength(15);
    expect(CONTRACT_OUTBOX_ERROR_CODES).toContain('ambiguous_dispatch');
    expect(CONTRACT_OUTBOX_ERROR_CODES).toContain('render_data_too_large');
  });

  it('sloučený registr přijme kód vlastníka jiné části', () => {
    const merged = mergeOutboxErrorCodes(CONTRACT_OUTBOX_ERROR_CODES, ['smtp_recipient_rejected']);
    expect(isKnownOutboxErrorCode('smtp_recipient_rejected', merged)).toBe(true);
    expect(isKnownOutboxErrorCode('vymyslel_jsem_si_to', merged)).toBe(false);
  });

  it('kontrola proti samotné kontraktní tabulce by kód senderu odmítla', () => {
    // Přesně proto se v CI pouští proti SLOUČENÉMU registru, ne proti tabulce.
    expect(isKnownOutboxErrorCode('smtp_recipient_rejected', CONTRACT_OUTBOX_ERROR_CODES)).toBe(false);
  });
});

describe('campaigns.pause_reason', () => {
  it('sender smí zapsat právě čtyři kódy', () => {
    expect(SENDER_PAUSE_REASON_CODES).toEqual([
      'render_failure_rate',
      'credentials_undecryptable',
      'provider_quota_exhausted',
      'provider_unavailable',
    ]);
    expect(PAUSE_REASON_CODES).toHaveLength(9);
  });

  it('přijme platný objekt od senderu', () => {
    expect(() =>
      assertSenderPauseReason({
        code: 'provider_quota_exhausted',
        source: 'sender',
        detail: 'SES daily quota reached',
        sender_id: 'mlain-ws-7f3a',
        at: '2026-07-31T14:22:31Z',
      }),
    ).not.toThrow();
  });

  it('odmítne kód, který sender zapsat nesmí', () => {
    expect(() =>
      assertSenderPauseReason({ code: 'bounce_guard', source: 'sender', at: '2026-07-31T14:22:31Z' }),
    ).toThrow(/bounce_guard/);
  });

  it('odmítne chybějící povinná pole', () => {
    expect(() => assertSenderPauseReason({ code: 'provider_unavailable', source: 'sender' })).toThrow(/at/);
    expect(() => assertSenderPauseReason({ code: 'provider_unavailable', at: '2026-07-31T14:22:31Z' })).toThrow(
      /source/,
    );
  });
});
```

- [ ] **Krok 6: Spusť a ověř, že padá**

Run: `pnpm --filter @mlain/contracts exec vitest run --project unit test/outbox-errors.test.ts`
Expected: FAIL, `Cannot find module '../src/outbox-errors.js'`.

- [ ] **Krok 7: Napiš `src/outbox-errors.ts` a `src/pause-reason.ts`**

`packages/contracts/src/outbox-errors.ts`:

```ts
/**
 * Jmenný prostor messages.error_code (KONTRAKT, část 1, 4.10.1).
 *
 * Je to ODDĚLENÝ uzavřený výčet a nemá nic společného s katalogem HTTP chybových
 * kódů ze 4.2. Tahle tabulka NENÍ úplný registr: je to podmnožina, kterou musí
 * znát obě strany, protože na ni navazuje chování nebo report. Úplný registr
 * vzniká sloučením tří zdrojů (tahle tabulka, katalog senderu z části 4b, důvody
 * vyřazení z částí 2 a 4a) a CI ho vynucuje jako CELEK. Kontrola proti téhle
 * tabulce samotné by spadla na první zprávě, kterou sender označí kódem providera.
 */
export const CONTRACT_OUTBOX_ERROR_CODES = [
  'ambiguous_dispatch',
  'render_failed',
  'render_timeout',
  'provider_rejected',
  'provider_unavailable',
  'credentials_undecryptable',
  'invalid_recipient',
  'suppressed',
  'unsubscribed',
  'campaign_cancelled',
  'contact_deleted',
  'contact_anonymized',
  'processing_restricted',
  'contact_status_changed',
  'render_data_too_large',
] as const;

export type ContractOutboxErrorCode = (typeof CONTRACT_OUTBOX_ERROR_CODES)[number];

/** Sloučí kontraktní tabulku s registry ostatních vlastníků. Duplicity nevadí. */
export function mergeOutboxErrorCodes(...sources: readonly (readonly string[])[]): readonly string[] {
  return Object.freeze([...new Set(sources.flat())]);
}

export function isKnownOutboxErrorCode(code: string, registry: readonly string[]): boolean {
  return registry.includes(code);
}
```

`packages/contracts/src/pause-reason.ts`:

```ts
/**
 * Tvar objektu campaigns.pause_reason (KONTRAKT, část 1, 4.10.1).
 * Existuje JEDEN tvar, ne dva. Sloupec má typ jsonb a vlastní ho část 4a,
 * ale musí existovat a mít tenhle typ, jinak sender pozastavení neprovede.
 */

export const SENDER_PAUSE_REASON_CODES = [
  'render_failure_rate',
  'credentials_undecryptable',
  'provider_quota_exhausted',
  'provider_unavailable',
] as const;

export const APP_ONLY_PAUSE_REASON_CODES = [
  'user',
  'bounce_guard',
  'complaint_guard',
  'provider_blocked',
  'materialize_timeout',
] as const;

export const PAUSE_REASON_CODES = [...SENDER_PAUSE_REASON_CODES, ...APP_ONLY_PAUSE_REASON_CODES] as const;

export type PauseReasonCode = (typeof PAUSE_REASON_CODES)[number];
export type PauseReasonSource = 'sender' | 'app' | 'user';

export type PauseReason = {
  code: PauseReasonCode;
  source: PauseReasonSource;
  /** technický text pro log, konkrétní příčina patří sem, ne do code */
  detail?: string;
  /** jen když source = "sender" */
  sender_id?: string;
  /** ISO 8601 v UTC */
  at: string;
};

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * Ověří objekt, který zapisuje SENDER.
 *
 * Omezení míří na sender, ne na kód: aplikace smí zapsat kteroukoliv hodnotu
 * včetně těch čtyř. Kdo zápis provedl, se pozná z pole `source`.
 */
export function assertSenderPauseReason(value: unknown): asserts value is PauseReason {
  if (typeof value !== 'object' || value === null) {
    throw new Error('pause_reason musí být neprázdný objekt');
  }
  const v = value as Record<string, unknown>;
  if (typeof v.code !== 'string') throw new Error('pause_reason.code chybí');
  if (!(SENDER_PAUSE_REASON_CODES as readonly string[]).includes(v.code)) {
    throw new Error(`sender nesmí zapsat pause_reason.code ${v.code}`);
  }
  if (v.source !== 'sender' && v.source !== 'app' && v.source !== 'user') {
    throw new Error('pause_reason.source musí být sender, app nebo user');
  }
  if (typeof v.at !== 'string' || !ISO_UTC.test(v.at)) {
    throw new Error('pause_reason.at musí být ISO 8601 v UTC');
  }
  if (v.detail !== undefined && typeof v.detail !== 'string') {
    throw new Error('pause_reason.detail musí být text');
  }
  if (v.sender_id !== undefined && v.source !== 'sender') {
    throw new Error('pause_reason.sender_id smí být jen při source = sender');
  }
}
```

- [ ] **Krok 8: Spusť a ověř, že prochází**

Run: `pnpm --filter @mlain/contracts exec vitest run --project unit`
Expected: PASS, všechny testy zelené.

- [ ] **Krok 9: Zapiš tabulku přechodů jako fixture**

Založ `packages/contracts/fixtures/outbox/scenarios.json` s klíči `contractVersion` a `transitions`. Registr scénářů `OB-xx` do téhož souboru doplní úkol 5 a úplný výpis obou klíčů je tam:

```json
{
  "contractVersion": 1,
  "transitions": [
    { "id": "TR-001", "from": "pending", "to": "claimed", "actor": "sender", "error_code": null, "allowed": true },
    { "id": "TR-002", "from": "pending", "to": "skipped", "actor": "app",    "error_code": null, "allowed": true },
    { "id": "TR-003", "from": "claimed", "to": "sent",    "actor": "sender", "error_code": null, "allowed": true },
    { "id": "TR-004", "from": "claimed", "to": "failed",  "actor": "sender", "error_code": null, "allowed": true },
    { "id": "TR-005", "from": "claimed", "to": "pending", "actor": "sender", "error_code": null, "allowed": true },
    { "id": "TR-006", "from": "claimed", "to": "pending", "actor": "reaper", "error_code": null, "allowed": true },
    { "id": "TR-007", "from": "claimed", "to": "skipped", "actor": "sender", "error_code": null, "allowed": true },
    { "id": "TR-008", "from": "failed",  "to": "sent",    "actor": "app",    "error_code": "ambiguous_dispatch", "allowed": true },
    { "id": "TR-009", "from": "failed",  "to": "sent",    "actor": "sender", "error_code": "ambiguous_dispatch", "allowed": false },
    { "id": "TR-010", "from": "failed",  "to": "sent",    "actor": "app",    "error_code": "render_failed", "allowed": false },
    { "id": "TR-011", "from": "failed",  "to": "sent",    "actor": "app",    "error_code": null, "allowed": false },
    { "id": "TR-012", "from": "sent",    "to": "pending", "actor": "app",    "error_code": null, "allowed": false },
    { "id": "TR-013", "from": "sent",    "to": "failed",  "actor": "app",    "error_code": null, "allowed": false },
    { "id": "TR-014", "from": "skipped", "to": "pending", "actor": "app",    "error_code": null, "allowed": false }
  ]
}
```

Čtrnáct případů pokrývá všech sedm povolených přechodů, jedinou pojmenovanou výjimku `failed -> sent` ve všech čtyřech kombinacích aktéra a `error_code`, a tři koncové stavy, ze kterých nevede cesta zpět. `TR-009` až `TR-011` jsou ty důležité: bez nich by výjimka platila pro kohokoliv s jakýmkoliv kódem.

- [ ] **Krok 10: Spusť a ověř, že prochází**

Run: `pnpm --filter @mlain/contracts exec vitest run --project unit`
Expected: PASS. Go strana tabulku přechodů **nedostane opsanou**; implementuje ji P09 v `internal/outbox` a ověří runnerem `RunOutboxTransitions` nad tímhle souborem (požadavek P02→P09.2).

- [ ] **Krok 11: Commit**

```bash
git add packages/contracts/src packages/contracts/test packages/contracts/fixtures/outbox
git commit -m "feat(contracts): stavy, přechody jako fixture, registr error_code a tvar pause_reason"
```

---

### Úkol 5: Registr scénářů a scénáře claimu a oprávnění

Scénáře `OB-xx` jsou jazykově neutrální data, ne kód v testu. Registr říká, kdo který scénář vykonává, protože fixture bez vykonavatele je mrtvá a fixture spuštěná ve špatném plánu je falešně zelená.

**Files:**
- Create: `packages/contracts/fixtures/outbox/scenarios.json`
- Modify: `packages/contracts/test/db/helpers.ts`
- Test: `packages/contracts/test/db/10-ob-claim.test.ts`

- [ ] **Krok 1: Doplň do `scenarios.json` registr všech dvaceti tří scénářů**

Soubor už existuje z úkolu 4 s klíči `contractVersion` a `transitions`; tenhle krok mezi ně vkládá `note` a `scenarios`. Výsledný tvar:

`packages/contracts/fixtures/outbox/scenarios.json`:

```json
{
  "contractVersion": 1,
  "note": "Registr scénářů kontraktu 1 podle části 1, kapitoly 4.10.1. Pole runner říká, který plán scénář vykonává: contracts = P02, sender = P09, campaigns = P14. Všechny scénáře běží pod rolí mlain_sender, kromě těch, které kontrakt výslovně přiřazuje aplikaci. Klíč transitions drží tabulku povolených přechodů z úkolu 4 a čtou ho obě jazykové strany.",
  "scenarios": [
    { "id": "OB-00", "runner": "contracts", "title": "Každý normativní dotaz kontraktu projde parserem a plánovačem", "expected": "žádná chyba, prázdný výsledek je v pořádku", "order": 0 },
    { "id": "OB-01", "runner": "contracts", "title": "Dva sendery, 1000 zpráv, dávka 100", "expected": "každá zpráva claimnutá právě jednou, žádné čekání" },
    { "id": "OB-02", "runner": "contracts", "title": "Claim, pak SIGKILL, pak reaper po TTL", "expected": "zprávy zpět na pending, attempts nezměněné" },
    { "id": "OB-03", "runner": "contracts", "title": "Nejednoznačné odeslání, první výskyt, politika retry", "expected": "pending, error_code ambiguous_dispatch, attempts 1" },
    { "id": "OB-04", "runner": "contracts", "title": "Nejednoznačné odeslání, druhý výskyt", "expected": "failed bez ohledu na politiku" },
    { "id": "OB-05", "runner": "contracts", "title": "Kampaň přepnutá na paused uprostřed", "expected": "claim dotaz vrací 0 řádků do obnovení" },
    { "id": "OB-06", "runner": "contracts", "title": "Workspace měkce smazaný", "expected": "claim dotaz vrací 0 řádků" },
    { "id": "OB-07", "runner": "contracts", "title": "Pokus o UPDATE status sent z pending", "expected": "odmítnuto aplikační kontrolou" },
    { "id": "OB-08", "runner": "contracts", "title": "Sender se pokusí DELETE FROM messages", "expected": "chyba oprávnění z Postgresu" },
    { "id": "OB-09", "runner": "contracts", "title": "Sender se pokusí SELECT z contacts", "expected": "chyba oprávnění z Postgresu" },
    { "id": "OB-10", "runner": "sender", "title": "Graceful shutdown uprostřed dávky 100", "expected": "rozpracované dokončené, zbytek pending, žádná ztráta" },
    { "id": "OB-11", "runner": "contracts", "title": "Message-ID u dvou pokusů téže zprávy", "expected": "identický řetězec" },
    { "id": "OB-12", "runner": "contracts", "title": "Pozastavená kampaň s 200000 řádky vedle běžící s 1000", "expected": "claim vrátí dávku rychle a přes částečný index" },
    { "id": "OB-13", "runner": "contracts", "title": "Materializace 1000 zpráv ve dvou dávkách po 500", "expected": "identické created_at rovné audience_built_at s nulovou sub-sekundovou složkou" },
    { "id": "OB-14", "runner": "contracts", "title": "Zrušení kampaně s 500 pending a 50 claimed", "expected": "500 na skipped, žádný na failed, 50 claimed doběhne" },
    { "id": "OB-15", "runner": "campaigns", "title": "Pozdní bounce k už sent zprávě", "expected": "status zůstane sent, vznikne message_events, report ji nepočítá jako doručenou" },
    { "id": "OB-16", "runner": "contracts", "title": "Sender pozastaví kampaň", "expected": "uspěje; na paused nebo cancelled ovlivní 0 řádků a není to chyba" },
    { "id": "OB-17", "runner": "contracts", "title": "Sender se pokusí o paused na sending nebo o změnu jiného sloupce", "expected": "chyba oprávnění nebo 0 řádků" },
    { "id": "OB-18", "runner": "contracts", "title": "Claim nad kampaní s deleted_at IS NOT NULL", "expected": "0 řádků v kroku 1 i v kroku 2" },
    { "id": "OB-19", "runner": "contracts", "title": "Reaper uvolní claim, vezme ho sender B, teprve pak A zkusí D1", "expected": "D1 ovlivní 0 řádků, A neodešle nic" },
    { "id": "OB-20", "runner": "contracts", "title": "Totéž, ale A se dostane až k D3", "expected": "D3 ovlivní 0 řádků, nikdy dvojí zápis sent s různým provider_message_id" },
    { "id": "OB-21", "runner": "contracts", "title": "failed s ambiguous_dispatch přepnuté aplikací na sent", "expected": "přechod uspěje, doplní se provider_message_id a sent_at" },
    { "id": "OB-22", "runner": "contracts", "title": "Tentýž přechod u zprávy s jiným error_code i s NULL", "expected": "musí selhat ve všech případech, test běží pro každou hodnotu zvlášť" }
  ],
  "transitions": [ "... čtrnáct případů TR-001 až TR-014 z úkolu 4, krok 9 ..." ]
}
```

**Jediný scénář s runnerem `sender` je `OB-10`.** `OB-01`, `OB-02` a `OB-11` tenhle plán skutečně spouští (úkoly 5, 6 a 9), takže je registr přiřazuje `contracts`; dřívější znění rozhodnutí D3 tvrdilo opak a rozcházelo se s tímhle souborem. `OB-15` patří doméně kampaní, tedy P14.

- [ ] **Krok 2: Doplň do helperů seed a spouštěč claimu**

Přidej na konec `packages/contracts/test/db/helpers.ts`:

```ts
export const WS_ID = '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071';
export const CAMPAIGN_ID = '0192f3a0-1c2d-7e44-9e5f-60718293a4b5';
export const OTHER_CAMPAIGN_ID = '0192f3a0-1c2d-7e46-9a1b-2c3d4e5f6072';
/** Zaokrouhlené na celé sekundy, viz invariant I1 a pole message_created_at v tokenu. */
export const AUDIENCE_BUILT_AT = '2026-08-01T10:00:00Z';

export async function seedWorkspaceAndCampaign(
  db: ContractDb,
  opts: { campaignId?: string; status?: string; deletedAt?: string | null; workspaceDeletedAt?: string | null } = {},
): Promise<void> {
  const campaignId = opts.campaignId ?? CAMPAIGN_ID;
  await db.app.query(
    `INSERT INTO workspaces (id, name, deleted_at) VALUES ($1, 'Test', $2)
     ON CONFLICT (id) DO UPDATE SET deleted_at = EXCLUDED.deleted_at`,
    [WS_ID, opts.workspaceDeletedAt ?? null],
  );
  await db.app.query(
    `INSERT INTO campaigns (id, workspace_id, status, audience_built_at, deleted_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, deleted_at = EXCLUDED.deleted_at`,
    [campaignId, WS_ID, opts.status ?? 'sending', AUDIENCE_BUILT_AT, opts.deletedAt ?? null],
  );
}

export async function seedMessages(
  db: ContractDb,
  count: number,
  opts: { campaignId?: string; status?: string } = {},
): Promise<void> {
  await db.app.query(
    `INSERT INTO messages (workspace_id, campaign_id, contact_id, email, created_at, status)
     SELECT $1, $2, gen_random_uuid(), 'p' || g || '@example.cz', $3::timestamptz, $4
     FROM generate_series(1, $5) AS g`,
    [WS_ID, opts.campaignId ?? CAMPAIGN_ID, AUDIENCE_BUILT_AT, opts.status ?? 'pending', count],
  );
}

/** Spustí krok 2 claimu tak, jak je v kontraktu, a vrátí claimnuté řádky. */
export async function runClaim(
  client: Client,
  args: { claimedBy: string; batchSize: number; ttlSeconds: number; campaignId: string },
): Promise<Array<{ id: string; created_at: Date }>> {
  const sql = await readFile(path.join(contractSqlDir, '02-claim-batch.sql'), 'utf8');
  const body = sql.replace(/^--.*$/gm, '').trim().replace(/;\s*$/, '');
  const result = await client.query(body, [args.claimedBy, args.batchSize, args.ttlSeconds, args.campaignId]);
  return result.rows;
}

/** Spustí krok 1 claimu a vrátí id běžících kampaní. */
export async function runRunningCampaigns(client: Client): Promise<string[]> {
  const sql = await readFile(path.join(contractSqlDir, '01-claim-running-campaigns.sql'), 'utf8');
  const body = sql.replace(/^--.*$/gm, '').trim().replace(/;\s*$/, '');
  const result = await client.query(body);
  return result.rows.map((row) => row.id as string);
}
```

Testy pouští **tentýž soubor SQL**, který ověřuje `OB-00`. Kdyby si test SQL opsal, testoval by opis, ne kontrakt.

- [ ] **Krok 3: Napiš padající testy scénářů claimu a oprávnění**

`packages/contracts/test/db/10-ob-claim.test.ts`:

```ts
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  AUDIENCE_BUILT_AT, CAMPAIGN_ID, type ContractDb, OTHER_CAMPAIGN_ID, runClaim, runRunningCampaigns,
  seedMessages, seedWorkspaceAndCampaign, startContractDb, stopContractDb, truncateAll, WS_ID,
} from './helpers.js';

let db: ContractDb;

beforeAll(async () => {
  db = await startContractDb();
}, 180_000);
afterAll(async () => stopContractDb(db));
beforeEach(async () => truncateAll(db));

describe('OB-01: dva sendery, 1000 zpráv, dávka 100', () => {
  it('claimne každou zprávu právě jednou', async () => {
    await seedWorkspaceAndCampaign(db);
    await seedMessages(db, 1000);

    const claimedIds: string[] = [];
    for (let round = 0; round < 10; round += 1) {
      const [a, b] = await Promise.all([
        runClaim(db.sender, { claimedBy: 'sender-a', batchSize: 100, ttlSeconds: 300, campaignId: CAMPAIGN_ID }),
        runClaim(db.app, { claimedBy: 'sender-b', batchSize: 100, ttlSeconds: 300, campaignId: CAMPAIGN_ID }),
      ]);
      claimedIds.push(...a.map((r) => r.id), ...b.map((r) => r.id));
    }

    expect(new Set(claimedIds).size).toBe(claimedIds.length);
    const { rows } = await db.app.query(`SELECT count(*)::int AS n FROM messages WHERE status = 'claimed'`);
    expect(rows[0].n).toBe(claimedIds.length);
  });
});

describe('OB-05 a OB-18: pauza a měkké smazání kampaně', () => {
  it('OB-05: pozastavená kampaň nevydá ani řádek', async () => {
    await seedWorkspaceAndCampaign(db, { status: 'paused' });
    await seedMessages(db, 10);
    expect(await runRunningCampaigns(db.sender)).toEqual([]);
    const claimed = await runClaim(db.sender, {
      claimedBy: 's', batchSize: 100, ttlSeconds: 300, campaignId: CAMPAIGN_ID,
    });
    expect(claimed).toEqual([]);
  });

  it('OB-18: kampaň se stavem sending a deleted_at nevydá ani řádek', async () => {
    await seedWorkspaceAndCampaign(db, { status: 'sending', deletedAt: '2026-08-01T09:00:00Z' });
    await seedMessages(db, 10);
    expect(await runRunningCampaigns(db.sender)).toEqual([]);
    expect(
      await runClaim(db.sender, { claimedBy: 's', batchSize: 100, ttlSeconds: 300, campaignId: CAMPAIGN_ID }),
    ).toEqual([]);
  });
});

describe('OB-06: měkce smazaný workspace', () => {
  it('nevydá ani řádek v kroku 1 ani v kroku 2', async () => {
    await seedWorkspaceAndCampaign(db, { workspaceDeletedAt: '2026-08-01T09:00:00Z' });
    await seedMessages(db, 10);
    expect(await runRunningCampaigns(db.sender)).toEqual([]);
    expect(
      await runClaim(db.sender, { claimedBy: 's', batchSize: 100, ttlSeconds: 300, campaignId: CAMPAIGN_ID }),
    ).toEqual([]);
  });
});

describe('OB-08, OB-09 a OB-17: oprávnění role mlain_sender', () => {
  it('OB-08: DELETE FROM messages skončí chybou oprávnění', async () => {
    await expect(db.sender.query('DELETE FROM messages WHERE false')).rejects.toThrow(/permission denied/);
  });

  it('OB-09: čtení cizí tabulky skončí chybou', async () => {
    // contacts v kontraktní podmnožině vůbec neexistuje, sender na ně nemá grant
    // ani je nemá jak vidět. Obojí je správný výsledek scénáře.
    await expect(db.sender.query('SELECT * FROM contacts LIMIT 1')).rejects.toThrow(
      /permission denied|does not exist/,
    );
  });

  it('OB-17: sender nesmí přepsat created_at ani jiný sloupec kampaně', async () => {
    await expect(db.sender.query('UPDATE messages SET created_at = now() WHERE false')).rejects.toThrow(
      /permission denied/,
    );
    await expect(db.sender.query('UPDATE campaigns SET subject = $1 WHERE false', ['x'])).rejects.toThrow(
      /permission denied/,
    );
  });

  it('OB-17 druhá půlka: povolený sloupec projde, ale podmínka ve WHERE zabere', async () => {
    await seedWorkspaceAndCampaign(db, { status: 'paused' });
    const result = await db.sender.query(
      `UPDATE campaigns SET status = 'paused', pause_reason = $2
       WHERE id = $1 AND status IN ('queueing','sending')`,
      [CAMPAIGN_ID, { code: 'provider_unavailable', source: 'sender', at: '2026-08-01T10:00:00Z' }],
    );
    expect(result.rowCount).toBe(0);
  });
});

describe('OB-16: sender smí kampaň pozastavit', () => {
  it.each(['queueing', 'sending'])('uspěje ze stavu %s', async (status) => {
    await seedWorkspaceAndCampaign(db, { status });
    const result = await db.sender.query(
      `UPDATE campaigns SET status = 'paused', pause_reason = $2
       WHERE id = $1 AND status IN ('queueing','sending')`,
      [CAMPAIGN_ID, { code: 'provider_quota_exhausted', source: 'sender', at: '2026-08-01T10:00:00Z' }],
    );
    expect(result.rowCount).toBe(1);
  });
});

describe('OB-13: invariant I1', () => {
  it('dvě dávky materializace mají identické created_at bez sub-sekundové složky', async () => {
    await seedWorkspaceAndCampaign(db);
    await seedMessages(db, 500);
    await seedMessages(db, 500);
    const { rows } = await db.app.query(`
      SELECT DISTINCT created_at, date_part('microseconds', created_at) AS micros FROM messages
    `);
    expect(rows).toHaveLength(1);
    expect(Number(rows[0].micros)).toBe(0);
    const campaign = await db.app.query('SELECT audience_built_at FROM campaigns WHERE id = $1', [CAMPAIGN_ID]);
    expect(new Date(rows[0].created_at).toISOString()).toBe(
      new Date(campaign.rows[0].audience_built_at).toISOString(),
    );
    expect(new Date(rows[0].created_at).toISOString()).toBe(new Date(AUDIENCE_BUILT_AT).toISOString());
  });

  it('ON CONFLICT nad dvěma sloupci místo tří je tvrdá chyba, ne tichý průchod', async () => {
    await seedWorkspaceAndCampaign(db);
    await expect(
      db.app.query(
        `INSERT INTO messages (workspace_id, campaign_id, contact_id, email, created_at)
         VALUES ($1, $2, gen_random_uuid(), 'x@y.cz', $3)
         ON CONFLICT (campaign_id, contact_id) DO NOTHING`,
        [WS_ID, CAMPAIGN_ID, AUDIENCE_BUILT_AT],
      ),
    ).rejects.toThrow(/no unique or exclusion constraint matching the ON CONFLICT/);
  });
});

describe('OB-12: pozastavená obří kampaň nesmí zdržet běžící malou', () => {
  it('claim jde přes částečný index a vrátí dávku rychle', async () => {
    await seedWorkspaceAndCampaign(db, { campaignId: OTHER_CAMPAIGN_ID, status: 'paused' });
    await seedWorkspaceAndCampaign(db, { campaignId: CAMPAIGN_ID, status: 'sending' });
    await seedMessages(db, 200_000, { campaignId: OTHER_CAMPAIGN_ID });
    await seedMessages(db, 1_000, { campaignId: CAMPAIGN_ID });
    await db.migrator.query('ANALYZE messages');

    const plan = await db.sender.query(`
      EXPLAIN (COSTS OFF)
      WITH claimable AS (
        SELECT m.id, m.created_at FROM messages m
        WHERE m.campaign_id = $1 AND m.status = 'pending' AND m.next_attempt_at <= now()
        ORDER BY m.next_attempt_at, m.id LIMIT 100 FOR UPDATE OF m SKIP LOCKED
      ) SELECT * FROM claimable
    `, [CAMPAIGN_ID]);
    const planText = plan.rows.map((r) => Object.values(r)[0]).join('\n');
    // Jméno indexu na partition si generuje PostgreSQL, hledá se proto tvar sloupců.
    expect(planText).toMatch(/Index Scan/);
    expect(planText).not.toMatch(/Seq Scan/);

    const started = performance.now();
    const claimed = await runClaim(db.sender, {
      claimedBy: 'sender-a', batchSize: 100, ttlSeconds: 300, campaignId: CAMPAIGN_ID,
    });
    const elapsed = performance.now() - started;

    expect(claimed).toHaveLength(100);
    // Kontrakt uvádí 10 ms. Práh v CI je desetinásobný, aby neblikal na sdíleném
    // runneru; skutečnou ochranou proti návratu patologie je kontrola plánu výš,
    // protože bez dvoukrokového claimu a bez campaign_id v indexu je tam Seq Scan.
    expect(elapsed).toBeLessThan(100);
  }, 300_000);
});
```

- [ ] **Krok 4: Spusť a ověř, že padá**

Run: `pnpm --filter @mlain/contracts exec vitest run --project db-rest`
Expected: FAIL, `seedWorkspaceAndCampaign is not a function` nebo podobně, dokud nejsou helpery doplněné.

- [ ] **Krok 5: Doplň helpery a spusť, dokud není zeleno**

Run: `pnpm --filter @mlain/contracts run test:schema`
Expected: PASS. `OB-00` běží první, teprve po něm scénáře.

- [ ] **Krok 6: Commit**

```bash
git add packages/contracts/fixtures/outbox/scenarios.json packages/contracts/test/db
git commit -m "test(contracts): registr scénářů OB a scénáře claimu, pauzy a oprávnění"
```

---

### Úkol 6: Scénáře dispatch stráže, reaperu a zakázaných přechodů

Tohle je nejtěžší místo celého kontraktu: stráž `claimed_by` v krocích D1 a D3 a mechanismus nejednoznačného odeslání. Bez těchhle testů je ochrana jen predikát ve `WHERE`, který může implementátor ignorovat tím, že nezkontroluje počet ovlivněných řádků.

**Files:**
- Test: `packages/contracts/test/db/11-ob-dispatch.test.ts`

- [ ] **Krok 1: Napiš padající testy stráže a reaperu**

`packages/contracts/test/db/11-ob-dispatch.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  CAMPAIGN_ID, contractSqlDir, type ContractDb, runClaim, seedMessages, seedWorkspaceAndCampaign,
  startContractDb, stopContractDb, truncateAll,
} from './helpers.js';

let db: ContractDb;

async function contractSql(file: string): Promise<string> {
  const raw = await readFile(path.join(contractSqlDir, file), 'utf8');
  return raw.replace(/^--.*$/gm, '').trim().replace(/;\s*$/, '');
}

beforeAll(async () => {
  db = await startContractDb();
}, 180_000);
afterAll(async () => stopContractDb(db));
beforeEach(async () => truncateAll(db));

describe('OB-19 a OB-20: stráž claimed_by v D1 a D3', () => {
  it('OB-19: D1 senderu A ovlivní 0 řádků, když claim mezitím přebral B', async () => {
    await seedWorkspaceAndCampaign(db);
    await seedMessages(db, 1);
    const [claimed] = await runClaim(db.sender, {
      claimedBy: 'sender-a', batchSize: 1, ttlSeconds: 300, campaignId: CAMPAIGN_ID,
    });

    // reaper uvolní claim (simulace vypršení) a claimne ho sender B
    await db.app.query(`UPDATE messages SET claim_expires_at = now() - interval '1 second'`);
    await db.sender.query(await contractSql('04-reaper-stuck.sql'));
    await runClaim(db.app, { claimedBy: 'sender-b', batchSize: 1, ttlSeconds: 300, campaignId: CAMPAIGN_ID });

    const d1 = await db.sender.query(await contractSql('07-dispatch-begin.sql'), [
      claimed.id, claimed.created_at, 'sender-a',
    ]);
    expect(d1.rowCount).toBe(0);

    const { rows } = await db.app.query('SELECT claimed_by, attempts FROM messages');
    expect(rows[0].claimed_by).toBe('sender-b');
    expect(rows[0].attempts).toBe(0);
  });

  it('OB-20: D3 senderu A ovlivní 0 řádků a nepřepíše výsledek nového vlastníka', async () => {
    await seedWorkspaceAndCampaign(db);
    await seedMessages(db, 1);
    const [claimed] = await runClaim(db.sender, {
      claimedBy: 'sender-a', batchSize: 1, ttlSeconds: 300, campaignId: CAMPAIGN_ID,
    });
    await db.app.query(`UPDATE messages SET claim_expires_at = now() - interval '1 second'`);
    await db.sender.query(await contractSql('04-reaper-stuck.sql'));
    await runClaim(db.app, { claimedBy: 'sender-b', batchSize: 1, ttlSeconds: 300, campaignId: CAMPAIGN_ID });

    const okB = await db.app.query(await contractSql('08-dispatch-result.sql'), [
      claimed.id, claimed.created_at, 'sender-b', 'provider-id-B',
    ]);
    expect(okB.rowCount).toBe(1);

    const lateA = await db.sender.query(await contractSql('08-dispatch-result.sql'), [
      claimed.id, claimed.created_at, 'sender-a', 'provider-id-A',
    ]);
    expect(lateA.rowCount).toBe(0);

    const { rows } = await db.app.query('SELECT status, provider_message_id FROM messages');
    expect(rows[0].status).toBe('sent');
    expect(rows[0].provider_message_id).toBe('provider-id-B');
  });
});

describe('OB-02, OB-03 a OB-04: reaper', () => {
  it('OB-02: expirovaný claim bez rozpracovaného odeslání jde zpět na pending a attempts se nemění', async () => {
    await seedWorkspaceAndCampaign(db);
    await seedMessages(db, 5);
    await runClaim(db.sender, { claimedBy: 'sender-a', batchSize: 5, ttlSeconds: 300, campaignId: CAMPAIGN_ID });
    await db.app.query(`UPDATE messages SET claim_expires_at = now() - interval '1 second'`);

    const reaped = await db.sender.query(await contractSql('04-reaper-stuck.sql'));
    expect(reaped.rowCount).toBe(5);

    const { rows } = await db.app.query(
      `SELECT status, attempts, claimed_by, claim_expires_at FROM messages`,
    );
    for (const row of rows) {
      expect(row.status).toBe('pending');
      expect(row.attempts).toBe(0);
      expect(row.claimed_by).toBeNull();
      expect(row.claim_expires_at).toBeNull();
    }
  });

  it('OB-03: první nejednoznačné odeslání s politikou retry končí na pending', async () => {
    await seedWorkspaceAndCampaign(db);
    await seedMessages(db, 1);
    const [claimed] = await runClaim(db.sender, {
      claimedBy: 'sender-a', batchSize: 1, ttlSeconds: 300, campaignId: CAMPAIGN_ID,
    });
    await db.sender.query(await contractSql('07-dispatch-begin.sql'), [
      claimed.id, claimed.created_at, 'sender-a',
    ]);
    // claim vypršel víc než o jeden TTL, tedy o rezervu reaperu B
    await db.app.query(`UPDATE messages SET claim_expires_at = now() - interval '400 seconds'`);

    const result = await db.sender.query(await contractSql('05-reaper-ambiguous.sql'), ['retry', 300]);
    expect(result.rowCount).toBe(1);

    const { rows } = await db.app.query('SELECT status, error_code, attempts, ambiguous_count FROM messages');
    expect(rows[0].status).toBe('pending');
    expect(rows[0].error_code).toBe('ambiguous_dispatch');
    expect(rows[0].attempts).toBe(1);
    expect(rows[0].ambiguous_count).toBe(1);
  });

  it('OB-04: druhý výskyt končí na failed bez ohledu na politiku', async () => {
    await seedWorkspaceAndCampaign(db);
    await seedMessages(db, 1);
    const [claimed] = await runClaim(db.sender, {
      claimedBy: 'sender-a', batchSize: 1, ttlSeconds: 300, campaignId: CAMPAIGN_ID,
    });
    await db.sender.query(await contractSql('07-dispatch-begin.sql'), [claimed.id, claimed.created_at, 'sender-a']);
    await db.app.query(`UPDATE messages SET claim_expires_at = now() - interval '400 seconds', ambiguous_count = 1`);

    await db.sender.query(await contractSql('05-reaper-ambiguous.sql'), ['retry', 300]);

    const { rows } = await db.app.query('SELECT status, ambiguous_count FROM messages');
    expect(rows[0].status).toBe('failed');
    expect(rows[0].ambiguous_count).toBe(2);
  });

  it('znaménko u rezervy reaperu B je mínus: právě odesílaná zpráva se nezasáhne', async () => {
    await seedWorkspaceAndCampaign(db);
    await seedMessages(db, 1);
    const [claimed] = await runClaim(db.sender, {
      claimedBy: 'sender-a', batchSize: 1, ttlSeconds: 300, campaignId: CAMPAIGN_ID,
    });
    await db.sender.query(await contractSql('07-dispatch-begin.sql'), [claimed.id, claimed.created_at, 'sender-a']);

    // claim vydaný před vteřinou, tedy platný. S plusem místo mínusu by ho
    // reaper zasáhl a mechanismus proti duplicitám by duplicity sám vyráběl.
    const result = await db.sender.query(await contractSql('05-reaper-ambiguous.sql'), ['retry', 300]);
    expect(result.rowCount).toBe(0);
  });
});

describe('OB-14: zrušení kampaně', () => {
  it('pending jde na skipped, žádný na failed, claimed zůstává', async () => {
    await seedWorkspaceAndCampaign(db);
    await seedMessages(db, 550);
    await runClaim(db.sender, { claimedBy: 'sender-a', batchSize: 50, ttlSeconds: 300, campaignId: CAMPAIGN_ID });

    await db.app.query(
      `UPDATE messages SET status = 'skipped', error_code = 'campaign_cancelled', updated_at = now()
       WHERE campaign_id = $1 AND status = 'pending'`,
      [CAMPAIGN_ID],
    );

    const { rows } = await db.app.query(
      `SELECT status, count(*)::int AS n FROM messages GROUP BY status ORDER BY status`,
    );
    expect(rows).toEqual([
      { status: 'claimed', n: 50 },
      { status: 'skipped', n: 500 },
    ]);
  });
});

describe('OB-21 a OB-22: výjimka failed -> sent', () => {
  it('OB-21: přechod uspěje u ambiguous_dispatch a doplní provider_message_id a sent_at', async () => {
    await seedWorkspaceAndCampaign(db);
    await seedMessages(db, 1, {});
    await db.app.query(`UPDATE messages SET status = 'failed', error_code = 'ambiguous_dispatch'`);

    const result = await db.app.query(
      `UPDATE messages SET status = 'sent', provider_message_id = $1, sent_at = now(), updated_at = now()
       WHERE status = 'failed' AND error_code = 'ambiguous_dispatch'`,
      ['late-provider-id'],
    );
    expect(result.rowCount).toBe(1);

    const { rows } = await db.app.query('SELECT status, provider_message_id, sent_at FROM messages');
    expect(rows[0].status).toBe('sent');
    expect(rows[0].provider_message_id).toBe('late-provider-id');
    expect(rows[0].sent_at).not.toBeNull();
  });

  it.each(['render_failed', 'provider_rejected', null])(
    'OB-22: tentýž přechod s error_code %s neovlivní ani řádek',
    async (code) => {
      await seedWorkspaceAndCampaign(db);
      await seedMessages(db, 1, {});
      await db.app.query(`UPDATE messages SET status = 'failed', error_code = $1`, [code]);

      const result = await db.app.query(
        `UPDATE messages SET status = 'sent', provider_message_id = $1, sent_at = now()
         WHERE status = 'failed' AND error_code = 'ambiguous_dispatch'`,
        ['x'],
      );
      expect(result.rowCount).toBe(0);

      const { rows } = await db.app.query('SELECT status FROM messages');
      expect(rows[0].status).toBe('failed');
    },
  );
});
```

`OB-07` je pokrytý testem `assertTransition` z úkolu 4 (`pending -> sent` bez claimu). Kontrakt u něj říká "odmítnuto aplikační kontrolou", takže je to test kódu, ne databáze.

- [ ] **Krok 2: Spusť a ověř, že padá**

Run: `pnpm --filter @mlain/contracts exec vitest run --project db-rest test/db/11-ob-dispatch.test.ts`
Expected: FAIL na prvním scénáři, protože soubor testu je nový a helpery zatím nemají všechny exporty.

- [ ] **Krok 3: Dopiš chybějící exporty a spusť, dokud není zeleno**

Run: `pnpm --filter @mlain/contracts run test:schema`
Expected: PASS.

- [ ] **Krok 4: Ověř pokrytí registru scénářů testem**

Přidej na konec `packages/contracts/test/db/11-ob-dispatch.test.ts`:

```ts
describe('registr scénářů', () => {
  it('každý scénář s runnerem contracts má test v tomhle balíčku', async () => {
    const testRoot = path.join(contractSqlDir, '..', '..', '..', 'test');
    const registry = JSON.parse(
      await readFile(path.join(contractSqlDir, '..', 'scenarios.json'), 'utf8'),
    ) as { scenarios: Array<{ id: string; runner: string }> };

    // Prochází se CELÝ strom test/, ne ručně vypsaný seznam souborů. Dřívější
    // znění četlo čtyři soubory a OB-11 leželo v pátém (test/message-id.*),
    // takže kontrola sama padala; a OB-07 mělo ručně zapsanou výjimku, která by
    // přežila i to, že jeho test zmizí. Obojí je pryč: skenuje se všechno
    // a výjimka není žádná.
    const walk = async (dir: string): Promise<string[]> => {
      const entries = await readdir(dir, { withFileTypes: true });
      const out = await Promise.all(
        entries.map(async (entry) => {
          const full = path.join(dir, entry.name);
          if (entry.isDirectory()) return walk(full);
          return entry.name.endsWith('.test.ts') ? [full] : [];
        }),
      );
      return out.flat();
    };

    const files = await walk(testRoot);
    const joined = (await Promise.all(files.map((f) => readFile(f, 'utf8')))).join('\n');

    const ours = registry.scenarios.filter((s) => s.runner === 'contracts').map((s) => s.id);
    const missing = ours.filter((id) => !joined.includes(id));
    expect(missing, `scénáře bez testu: ${missing.join(', ')}`).toEqual([]);
    expect(ours).toHaveLength(21);
    expect(registry.scenarios).toHaveLength(23);
    expect(registry.scenarios.filter((s) => s.runner === 'sender').map((s) => s.id)).toEqual(['OB-10']);
    expect(registry.scenarios.filter((s) => s.runner === 'campaigns').map((s) => s.id)).toEqual(['OB-15']);
  });
});
```

Doplň k tomu do hlavičky souboru import `readdir`:

```ts
import { readdir, readFile } from 'node:fs/promises';
```

Run: `pnpm --filter @mlain/contracts run test:schema`
Expected: PASS. Dvacet jedna scénářů s runnerem `contracts` má test, `OB-10` čeká na P09 a `OB-15` na P14.

- [ ] **Krok 5: Commit**

```bash
git add packages/contracts/test/db
git commit -m "test(contracts): scénáře stráže claimed_by, reaperu a výjimky failed na sent"
```

---

### Úkol 7: Keyring a odvození klíčů

Kontrakty 3 a 4 stojí na jednom odvození klíčů z 3.10. Musí být hotové dřív než obojí, protože obojí ho volá.

**Files:**
- Create: `packages/contracts/src/keyring.ts`
- Test: `packages/contracts/test/keyring.test.ts`

- [ ] **Krok 1: Napiš padající test odvození**

`packages/contracts/test/keyring.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { deriveKey, KEY_PURPOSES, parseKeyring, parseSecretKey, secretKeyFingerprint } from '../src/keyring.js';

const TEST_SECRET_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';

describe('odvození klíčů podle 3.10', () => {
  it('dekóduje SECRET_KEY na přesně 32 bajtů', () => {
    const parsed = parseSecretKey(TEST_SECRET_KEY);
    expect(parsed.keyId).toBe(1);
    expect(Buffer.from(parsed.master).toString('hex')).toBe(
      '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
    );
  });

  it('přijme explicitní key_id', () => {
    expect(parseSecretKey(`7:${TEST_SECRET_KEY}`).keyId).toBe(7);
  });

  it('odmítne klíč jiné délky než 32 bajtů', () => {
    expect(() => parseSecretKey('AAEC')).toThrow(/32/);
  });

  it.each([
    ['mailer/v1/tracking-token', 'b9d815e1212e663c64cce1209229e7cf6af10197254677b7eabb575ea2ac3124'],
    ['mailer/v1/credential-encryption', '83cdc2ac660d3400913cf6c99a981a465f20f0e56610dd413fa7667e30fb8040'],
    ['mailer/v1/secret-key-fingerprint', '58c150fe5d466b4fa3e4d69d855c79763d1f0ccf0875c05594ff93cf8d6aead2'],
  ])('odvodí %s na závazný vektor', (purpose, expected) => {
    const { master } = parseSecretKey(TEST_SECRET_KEY);
    expect(Buffer.from(deriveKey(master, purpose)).toString('hex')).toBe(expected);
  });

  it('má sedm zmrazených purposes a jméno produktu v nich není', () => {
    expect(Object.values(KEY_PURPOSES)).toHaveLength(7);
    for (const purpose of Object.values(KEY_PURPOSES)) {
      expect(purpose.startsWith('mailer/v1/')).toBe(true);
      expect(purpose.toLowerCase()).not.toContain('mlain');
    }
  });

  it('spočítá otisk klíče z MASTER, ne z odvozeného klíče', () => {
    expect(secretKeyFingerprint(parseSecretKey(TEST_SECRET_KEY).master)).toBe('VXGoNjoPSBY');
  });

  it('nemá horní strop na počet pokolení', () => {
    const previous = Array.from({ length: 40 }, (_, i) => `${i + 2}:${TEST_SECRET_KEY}`).join(',');
    const keyring = parseKeyring({ secretKey: TEST_SECRET_KEY, secretKeyPrevious: previous });
    expect(keyring.size).toBe(41);
    expect(keyring.has(41)).toBe(true);
  });

  it('odmítne key_id mimo rozsah jednoho bajtu', () => {
    expect(() => parseKeyring({ secretKey: `256:${TEST_SECRET_KEY}` })).toThrow(/1 až 255/);
    expect(() => parseKeyring({ secretKey: `0:${TEST_SECRET_KEY}` })).toThrow(/1 až 255/);
  });
});
```

- [ ] **Krok 2: Spusť a ověř, že padá**

Run: `pnpm --filter @mlain/contracts exec vitest run --project unit test/keyring.test.ts`
Expected: FAIL, `Cannot find module '../src/keyring.js'`.

- [ ] **Krok 3: Napiš `src/keyring.ts`**

```ts
import { createHmac, hkdfSync } from 'node:crypto';

/**
 * Odvození klíčů (KONTRAKT, část 1, kapitola 3.10, sdílené s 4.10.3 a 4.10.4).
 *
 *   SECRET_KEY  = base64url bez paddingu, dekóduje se na přesně 32 bajtů
 *   MASTER      = base64url_decode(SECRET_KEY)
 *   K_<purpose> = HKDF(SHA-256, ikm = MASTER, salt = "mailer/v1", info = <purpose>, L = 32)
 *
 * Salt ani purposes se PŘI PŘEJMENOVÁNÍ PRODUKTU NEMĚNÍ a jméno produktu v nich
 * schválně není. Otisky v suppression listu nejdou přepočítat, protože plaintext
 * je po výmazu podle GDPR pryč; změna řetězce by tiše vzkřísila smazané lidi.
 */
export const HKDF_SALT = 'mailer/v1';

export const KEY_PURPOSES = Object.freeze({
  trackingToken: 'mailer/v1/tracking-token',
  credentialEncryption: 'mailer/v1/credential-encryption',
  secretKeyFingerprint: 'mailer/v1/secret-key-fingerprint',
  formToken: 'mailer/v1/form-token',
  confirmToken: 'mailer/v1/confirm-token',
  assetUrl: 'mailer/v1/asset-url',
  suppressionFingerprint: 'mailer/v1/suppression-fingerprint',
});

export type ParsedSecretKey = { keyId: number; master: Uint8Array };
export type Keyring = Map<number, Uint8Array>;

function decodeBase64Url(value: string): Uint8Array {
  if (/[^A-Za-z0-9\-_]/.test(value)) {
    throw new Error('SECRET_KEY musí být base64url bez paddingu (abeceda A-Za-z0-9-_)');
  }
  return new Uint8Array(Buffer.from(value, 'base64url'));
}

/** Přijímá `<base64url>` i `<key_id>:<base64url>`. Bez key_id platí implicitní 1. */
export function parseSecretKey(value: string): ParsedSecretKey {
  const trimmed = value.trim();
  const separator = trimmed.indexOf(':');
  const keyId = separator === -1 ? 1 : Number(trimmed.slice(0, separator));
  const encoded = separator === -1 ? trimmed : trimmed.slice(separator + 1);
  if (!Number.isInteger(keyId) || keyId < 1 || keyId > 255) {
    throw new Error(`key_id musí být celé číslo 1 až 255, je ${trimmed.slice(0, separator)}`);
  }
  const master = decodeBase64Url(encoded);
  if (master.length !== 32) {
    throw new Error(`SECRET_KEY se musí dekódovat na přesně 32 bajtů, má ${master.length}`);
  }
  return { keyId, master };
}

/**
 * Poskládá keyring z aktuálního klíče a všech předchozích pokolení.
 *
 * STROP NA POČET POKOLENÍ NEEXISTUJE a nesmí se zavést ani jako validace.
 * Otisk starého záznamu nejde nikdy přepočítat, takže po překročení stropu by
 * se smazaný člověk vrátil prvním dalším importem, aniž by cokoliv selhalo.
 */
export function parseKeyring(input: { secretKey: string; secretKeyPrevious?: string }): Keyring {
  const keyring: Keyring = new Map();
  const current = parseSecretKey(input.secretKey);
  keyring.set(current.keyId, current.master);
  for (const entry of (input.secretKeyPrevious ?? '').split(',')) {
    if (entry.trim() === '') continue;
    const parsed = parseSecretKey(entry);
    if (!keyring.has(parsed.keyId)) keyring.set(parsed.keyId, parsed.master);
  }
  return keyring;
}

export function keyringFromEnv(env: NodeJS.ProcessEnv = process.env): Keyring {
  if (!env.SECRET_KEY) throw new Error('SECRET_KEY je povinná proměnná');
  return parseKeyring({ secretKey: env.SECRET_KEY, secretKeyPrevious: env.SECRET_KEY_PREVIOUS });
}

/** Aktuální klíč je ten s nejvyšším key_id; jím se podepisuje a šifruje. */
export function currentKeyId(keyring: Keyring): number {
  return Math.max(...keyring.keys());
}

export function deriveKey(master: Uint8Array, purpose: string): Uint8Array {
  return new Uint8Array(hkdfSync('sha256', master, Buffer.from(HKDF_SALT, 'ascii'), Buffer.from(purpose, 'ascii'), 32));
}

/**
 * base64url(HMAC-SHA256(K_secret-key-fingerprint, "fingerprint")[0..8])
 *
 * Vstupem je MASTER, ne odvozený klíč: odvození si funkce dělá sama. Jméno je
 * `secretKeyFingerprint`, protože pod ním ho volají ostatní plány (rozhodnutí R6);
 * dřívější `keyFingerprint` se nepoužívá. Volání s už odvozeným klíčem odvodí
 * klíč podruhé a dá tiše jiný otisk, což je požadavek P02→P16.1.
 */
export function secretKeyFingerprint(master: Uint8Array): string {
  const key = deriveKey(master, KEY_PURPOSES.secretKeyFingerprint);
  const mac = createHmac('sha256', key).update('fingerprint').digest();
  return mac.subarray(0, 8).toString('base64url');
}
```

- [ ] **Krok 4: Spusť a ověř, že prochází**

Run: `pnpm --filter @mlain/contracts exec vitest run --project unit test/keyring.test.ts`
Expected: PASS, **10 testů** (číslo je přepočítané, dřívější znění uvádělo 11). Kdyby kterýkoliv odvozený klíč nesouhlasil, je chyba v pořadí argumentů HKDF, ne ve vektoru; vektory byly ověřené spuštěním, viz kapitola 6.

- [ ] **Krok 5: Commit**

```bash
git add packages/contracts/src/keyring.ts packages/contracts/test/keyring.test.ts
git commit -m "feat(contracts): odvození klíčů HKDF a keyring bez stropu na počet pokolení"
```

---

### Úkol 8: Kontrakt 3, formát trackovacích tokenů

Sender tokeny vyrábí, aplikace je ověřuje, a musí sedět bajt na bajt. Krok ověření číslo 4, tedy shoda typu tokenu s endpointem, je snadné vynechat a je to zranitelnost: bez něj jde token pro otevření podstrčit jako token pro odhlášení.

**Files:**
- Create: `packages/contracts/src/token.ts`
- Create: `packages/contracts/test/golden-report.ts`
- Test: `packages/contracts/test/token.golden.test.ts`

- [ ] **Krok 0: Napiš sdílený zápis reportu**

Report čte `check-parity` a je to jediné místo, kde se pozná, že jedna strana fixture tiše přeskočila. Píše ho každý golden runner na obou stranách ve **stejném tvaru** (rozhodnutí D14).

`packages/contracts/test/golden-report.ts`:

```ts
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export type GoldenReport = {
  language: 'ts' | 'go';
  section: string;
  total: number;
  executed: number;
  skipped: number;
  /** seřazené id fixtur, které runner SKUTEČNĚ zpracoval */
  ids: string[];
  groups: Record<string, number>;
  /** SHA-256 nad seřazeným "jméno\0sha256(obsah)" všech souborů sekce */
  fixturesDigest: string;
};

/**
 * Otisk vstupních souborů sekce. Existuje proto, že adresář reports/ se nikde
 * nemaže: bez otisku by šlo lokálně dostat zelenou paritu nad reportem ze
 * starého běhu. check-parity otisk přepočítá z disku a vyžaduje shodu.
 */
export async function fixturesDigest(files: readonly string[]): Promise<string> {
  const outer = createHash('sha256');
  for (const file of [...files].sort()) {
    const body = await readFile(file);
    outer.update(path.basename(file));
    outer.update('\0');
    outer.update(createHash('sha256').update(body).digest('hex'));
    outer.update('\n');
  }
  return outer.digest('hex');
}

/**
 * `skipped` se POČÍTÁ, nepíše. Volající předá seznam id, která opravdu proběhla,
 * a celkový počet použitelných; rozdíl je počet přeskočených. Literál nula na
 * tomhle místě byl důvod, proč dřívější kontrola „nepřeskočené fixtures" neměřila nic.
 */
export async function writeGoldenReport(input: {
  section: string;
  total: number;
  ids: readonly string[];
  groups?: Record<string, number>;
  files: readonly string[];
}): Promise<void> {
  const ids = [...input.ids].sort();
  const report: GoldenReport = {
    language: 'ts',
    section: input.section,
    total: input.total,
    executed: ids.length,
    skipped: input.total - ids.length,
    ids,
    groups: input.groups ?? {},
    fixturesDigest: await fixturesDigest(input.files),
  };
  await mkdir(path.join(packageRoot, 'reports'), { recursive: true });
  await writeFile(
    path.join(packageRoot, 'reports', `ts-golden-${input.section}.json`),
    JSON.stringify(report, null, 2) + '\n',
    'utf8',
  );
}
```

- [ ] **Krok 1: Napiš padající golden test tokenů**

`packages/contracts/test/token.golden.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { parseKeyring } from '../src/keyring.js';
import { buildToken, TokenError, verifyToken, type TokenFields, type TokenType } from '../src/token.js';
import { writeGoldenReport } from './golden-report.js';

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const vectorsFile = path.join(fixturesDir, 'token', 'vectors.json');
const keyring = parseKeyring({ secretKey: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8' });

/**
 * `sides` říká, které jazykové strany vektor zpracují, a je to DATA, ne rozhodnutí
 * runneru za běhu. Sender tokeny jen VYRÁBÍ a nikdy je neověřuje, protože ověření
 * dělá aplikace; negativní vektory a identity token proto Go strana nemá čím
 * zpracovat. Kdyby to runner řešil `t.Skip()`, nikdo by nepoznal rozdíl mezi
 * "nepoužitelné z principu" a "někdo si to odpustil". Takhle to leží ve zmrazené
 * fixture pod CODEOWNERS a check-parity to bere jako závaznou očekávanou množinu.
 */
type Side = 'ts' | 'go';

type Vectors = {
  positive: Array<{ id: string; type: TokenType; key_id: number; fields: TokenFields; expected_token: string; expected_mac_full: string; sides: Side[] }>;
  negative: Array<{ id: string; token: string; endpoint_type: TokenType; expected_error: string; now?: number; nonce_used?: boolean; sides: Side[] }>;
};

const vectors = JSON.parse(await readFile(vectorsFile, 'utf8')) as Vectors;
const executed: string[] = [];

afterAll(async () => {
  await writeGoldenReport({
    section: 'token',
    total: vectors.positive.length + vectors.negative.length,
    ids: executed,
    files: [vectorsFile],
  });
});

describe('kontrakt 3: trackovací tokeny', () => {
  it('má pět pozitivních a devět negativních vektorů', () => {
    expect(vectors.positive).toHaveLength(5);
    expect(vectors.negative).toHaveLength(9);
  });

  it('každý vektor má neprázdné sides a TypeScript strana zpracuje všechny', () => {
    for (const vector of [...vectors.positive, ...vectors.negative]) {
      expect(vector.sides.length, `${vector.id} nemá sides`).toBeGreaterThan(0);
      expect(vector.sides, `${vector.id} musí být na TS straně`).toContain('ts');
    }
  });

  it.each(vectors.positive)('$id vyrobí závazný řetězec bajt na bajt', (vector) => {
    const built = buildToken({ type: vector.type, keyId: vector.key_id, fields: vector.fields, keyring });
    expect(built.token).toBe(vector.expected_token);
    expect(Buffer.from(built.macFull).toString('hex')).toBe(vector.expected_mac_full);
    executed.push(vector.id); // POSLEDNÍ řádek těla, viz rozhodnutí D15
  });

  it.each(vectors.positive)('$id se ověří a vrátí tatáž pole', (vector) => {
    const verified = verifyToken({
      token: vector.expected_token,
      endpointType: vector.type,
      keyring,
      now: 1_784_995_200,
      isNonceUsed: () => false,
    });
    expect(verified.type).toBe(vector.type);
    expect(verified.keyId).toBe(vector.key_id);
    expect(verified.fields).toEqual(vector.fields);
  });

  it.each(vectors.negative)('$id je odmítnutý s $expected_error', (vector) => {
    try {
      verifyToken({
        token: vector.token,
        endpointType: vector.endpoint_type,
        keyring,
        now: vector.now ?? 1_784_995_200,
        isNonceUsed: () => vector.nonce_used === true,
      });
      throw new Error(`${vector.id}: token měl být odmítnutý`);
    } catch (error) {
      expect(error).toBeInstanceOf(TokenError);
      expect((error as TokenError).code).toBe(vector.expected_error);
    }
    executed.push(vector.id);
  });

  it('délky tokenů odpovídají tabulce kontraktu', () => {
    const byType = Object.fromEntries(vectors.positive.map((v) => [v.type, v.expected_token.length]));
    expect(byType.o).toBe(74);
    expect(byType.c).toBe(96);
    expect(byType.i).toBe(106);
    expect(byType.u).toBe(117);
  });

  it('message_created_at se proti expiraci nekontroluje nikdy', () => {
    const open = vectors.positive.find((v) => v.type === 'o')!;
    const verified = verifyToken({
      token: open.expected_token,
      endpointType: 'o',
      keyring,
      now: 4_000_000_000,
      isNonceUsed: () => false,
    });
    expect(verified.fields.message_created_at).toBe(1_784_995_200);
  });
});
```

- [ ] **Krok 2: Spusť a ověř, že padá**

Run: `pnpm --filter @mlain/contracts exec vitest run --project golden test/token.golden.test.ts`
Expected: FAIL, `ENOENT: fixtures/token/vectors.json`.

- [ ] **Krok 3: Napiš `src/token.ts`**

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import { deriveKey, KEY_PURPOSES, type Keyring } from './keyring.js';

/**
 * Kontrakt 3: formát trackovacích tokenů (část 1, 4.10.3). ZMRAZENO.
 *
 *   token     = "t1" || base64url_nopad( type || key_id || payload || mac )
 *   mac       = prvních 16 bajtů z HMAC-SHA256
 *   mac_input = "mailer/token/v1" || type || key_id || payload
 *   mac_key   = HKDF(SHA-256, MASTER, "mailer/v1", "mailer/v1/tracking-token", 32)
 */
export const TOKEN_PREFIX = 't1';
export const TOKEN_MAC_INPUT_PREFIX = 'mailer/token/v1';
export const TOKEN_MAC_BYTES = 16;

export type TokenType = 'o' | 'c' | 'i' | 'u';

export type TokenErrorCode =
  | 'token_malformed'
  | 'token_signature_invalid'
  | 'token_type_mismatch'
  | 'token_unknown_key'
  | 'token_expired'
  | 'token_already_used';

export class TokenError extends Error {
  constructor(readonly code: TokenErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'TokenError';
  }
}

type FieldSpec = { name: string; kind: 'uuid' | 'u32' | 'bytes8' };

/** Pořadí polí je ZÁVAZNÉ a je součástí MAC vstupu. */
const LAYOUTS: Readonly<Record<TokenType, readonly FieldSpec[]>> = Object.freeze({
  o: [
    { name: 'workspace_id', kind: 'uuid' },
    { name: 'message_id', kind: 'uuid' },
    { name: 'message_created_at', kind: 'u32' },
  ],
  c: [
    { name: 'workspace_id', kind: 'uuid' },
    { name: 'message_id', kind: 'uuid' },
    { name: 'link_id', kind: 'uuid' },
    { name: 'message_created_at', kind: 'u32' },
  ],
  i: [
    { name: 'workspace_id', kind: 'uuid' },
    { name: 'contact_id', kind: 'uuid' },
    { name: 'campaign_id', kind: 'uuid' },
    { name: 'nonce', kind: 'bytes8' },
    { name: 'expires_at', kind: 'u32' },
  ],
  u: [
    { name: 'workspace_id', kind: 'uuid' },
    { name: 'message_id', kind: 'uuid' },
    { name: 'contact_id', kind: 'uuid' },
    { name: 'list_id', kind: 'uuid' },
    { name: 'message_created_at', kind: 'u32' },
  ],
});

export const PAYLOAD_BYTES: Readonly<Record<TokenType, number>> = Object.freeze({ o: 36, c: 52, i: 60, u: 68 });

/** `list_id` samých nul znamená globální odhlášení, ne odhlášení ze seznamu. */
export const GLOBAL_LIST_ID = '00000000-0000-0000-0000-000000000000';

export type TokenFields = Record<string, string | number>;

function uuidToBytes(value: string): Uint8Array {
  const hex = value.replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new TokenError('token_malformed', `neplatné UUID ${value}`);
  return new Uint8Array(Buffer.from(hex, 'hex'));
}

function bytesToUuid(bytes: Uint8Array): string {
  const hex = Buffer.from(bytes).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function encodePayload(type: TokenType, fields: TokenFields): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const spec of LAYOUTS[type]) {
    const value = fields[spec.name];
    if (value === undefined) throw new TokenError('token_malformed', `chybí pole ${spec.name}`);
    if (spec.kind === 'uuid') parts.push(uuidToBytes(String(value)));
    else if (spec.kind === 'bytes8') {
      const bytes = new Uint8Array(Buffer.from(String(value), 'hex'));
      if (bytes.length !== 8) throw new TokenError('token_malformed', 'nonce musí mít 8 bajtů');
      parts.push(bytes);
    } else {
      const buffer = Buffer.alloc(4);
      buffer.writeUInt32BE(Number(value));
      parts.push(new Uint8Array(buffer));
    }
  }
  return new Uint8Array(Buffer.concat(parts.map((p) => Buffer.from(p))));
}

function decodePayload(type: TokenType, payload: Uint8Array): TokenFields {
  const fields: TokenFields = {};
  let offset = 0;
  for (const spec of LAYOUTS[type]) {
    if (spec.kind === 'uuid') {
      fields[spec.name] = bytesToUuid(payload.subarray(offset, offset + 16));
      offset += 16;
    } else if (spec.kind === 'bytes8') {
      fields[spec.name] = Buffer.from(payload.subarray(offset, offset + 8)).toString('hex');
      offset += 8;
    } else {
      fields[spec.name] = Buffer.from(payload.subarray(offset, offset + 4)).readUInt32BE();
      offset += 4;
    }
  }
  return fields;
}

function macFor(keyring: Keyring, keyId: number, type: TokenType, payload: Uint8Array): Buffer {
  const master = keyring.get(keyId);
  if (!master) throw new TokenError('token_unknown_key', `key_id ${keyId} není v konfiguraci`);
  const key = deriveKey(master, KEY_PURPOSES.trackingToken);
  return createHmac('sha256', key)
    .update(Buffer.from(TOKEN_MAC_INPUT_PREFIX, 'ascii'))
    .update(Buffer.from(type, 'ascii'))
    .update(Buffer.from([keyId]))
    .update(Buffer.from(payload))
    .digest();
}

export function buildToken(input: {
  type: TokenType;
  keyId: number;
  fields: TokenFields;
  keyring: Keyring;
}): { token: string; macFull: Uint8Array } {
  const payload = encodePayload(input.type, input.fields);
  if (payload.length !== PAYLOAD_BYTES[input.type]) {
    throw new TokenError('token_malformed', `payload typu ${input.type} má mít ${PAYLOAD_BYTES[input.type]} B`);
  }
  const macFull = macFor(input.keyring, input.keyId, input.type, payload);
  const raw = Buffer.concat([
    Buffer.from(input.type, 'ascii'),
    Buffer.from([input.keyId]),
    Buffer.from(payload),
    macFull.subarray(0, TOKEN_MAC_BYTES),
  ]);
  return { token: TOKEN_PREFIX + raw.toString('base64url'), macFull: new Uint8Array(macFull) };
}

/**
 * Ověření v NORMATIVNÍM pořadí kroků. Krok 4 (shoda typu s endpointem) se
 * nesmí vynechat: bez něj jde token pro otevření podstrčit jako token pro odhlášení.
 */
export function verifyToken(input: {
  token: string;
  endpointType: TokenType;
  keyring: Keyring;
  now: number;
  isNonceUsed: (nonceHex: string) => boolean;
}): { type: TokenType; keyId: number; fields: TokenFields } {
  // 1
  if (!input.token.startsWith(TOKEN_PREFIX)) throw new TokenError('token_malformed', 'chybí prefix t1');
  const body = input.token.slice(TOKEN_PREFIX.length);
  // 2, base64url bez paddingu; standardní abeceda i padding jsou chyba
  if (!/^[A-Za-z0-9\-_]+$/.test(body)) throw new TokenError('token_malformed', 'není base64url bez paddingu');
  const raw = new Uint8Array(Buffer.from(body, 'base64url'));
  if (Buffer.from(raw).toString('base64url') !== body) {
    throw new TokenError('token_malformed', 'zbytkové bity base64url nesedí');
  }
  if (raw.length < 2 + TOKEN_MAC_BYTES) throw new TokenError('token_malformed', 'token je příliš krátký');

  const type = String.fromCharCode(raw[0]) as TokenType;
  const keyId = raw[1];
  if (!(type in LAYOUTS)) throw new TokenError('token_malformed', `neznámý typ ${type}`);
  // 3
  const expectedLength = 2 + PAYLOAD_BYTES[type] + TOKEN_MAC_BYTES;
  if (raw.length !== expectedLength) throw new TokenError('token_malformed', 'délka neodpovídá typu');
  // 4
  if (type !== input.endpointType) {
    throw new TokenError('token_type_mismatch', `typ ${type} na endpointu ${input.endpointType}`);
  }
  // 5
  if (!input.keyring.has(keyId)) throw new TokenError('token_unknown_key', `key_id ${keyId}`);

  const payload = raw.subarray(2, 2 + PAYLOAD_BYTES[type]);
  const mac = Buffer.from(raw.subarray(2 + PAYLOAD_BYTES[type]));
  // 6, porovnání v konstantním čase
  const expected = macFor(input.keyring, keyId, type, payload).subarray(0, TOKEN_MAC_BYTES);
  if (mac.length !== expected.length || !timingSafeEqual(mac, expected)) {
    throw new TokenError('token_signature_invalid');
  }
  // 7, teprve teď se hodnoty z payloadu použijí
  const fields = decodePayload(type, payload);
  // 8
  if (type === 'i') {
    if (Number(fields.expires_at) <= input.now) throw new TokenError('token_expired');
    if (input.isNonceUsed(String(fields.nonce))) throw new TokenError('token_already_used');
  }
  return { type, keyId, fields };
}
```

- [ ] **Krok 4: Vygeneruj fixture vektorů a spusť test**

Vektory se nepíšou ručně. Vyrobí je generátor z úkolu 19, ale ten ještě neexistuje, takže v tomhle kroku napiš jen jeho tokenovou část do `packages/contracts/scripts/generate-fixtures.ts`:

```ts
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseKeyring } from '../src/keyring.js';
import { buildToken, type TokenType } from '../src/token.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_SECRET_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const keyring = parseKeyring({ secretKey: TEST_SECRET_KEY, secretKeyPrevious: `9:${TEST_SECRET_KEY}` });

const IDS = {
  workspace_id: '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071',
  message_id: '0192f3a0-1c2d-7e41-8b2c-3d4e5f607182',
  link_id: '0192f3a0-1c2d-7e42-9c3d-4e5f60718293',
  contact_id: '0192f3a0-1c2d-7e43-8d4e-5f60718293a4',
  campaign_id: '0192f3a0-1c2d-7e44-9e5f-60718293a4b5',
  list_id: '0192f3a0-1c2d-7e45-8f60-718293a4b5c6',
  message_created_at: 1_784_995_200,
  expires_at: 1_785_000_600,
  nonce: '0011223344556677',
};

/** Závazné hodnoty z kontraktu 4.10.3. Generátor se s nimi MUSÍ shodnout. */
const EXPECTED = {
  'TK-P1': 't1bwEBkvOgHC1-QJobLD1OX2BxAZLzoBwtfkGLLD1OX2Bxgmpk3YDUjmcTwPYu1Q9cpqmSPs4g',
  'TK-P2': 't1YwEBkvOgHC1-QJobLD1OX2BxAZLzoBwtfkGLLD1OX2BxggGS86AcLX5CnD1OX2BxgpNqZN2Aa8TprBxqhsgbR6l5AMMNpw',
  'TK-P3': 't1aQEBkvOgHC1-QJobLD1OX2BxAZLzoBwtfkONTl9gcYKTpAGS86AcLX5Enl9gcYKTpLUAESIzRFVmd2pk8pg7wFifQiBnNoxotJQLmO2S',
  'TK-P4': 't1dQEBkvOgHC1-QJobLD1OX2BxAZLzoBwtfkGLLD1OX2BxggGS86AcLX5DjU5fYHGCk6QBkvOgHC1-RY9gcYKTpLXGamTdgE4PEWHmqWZZuZDCD6L2SMw',
  'TK-P5': 't1dQEBkvOgHC1-QJobLD1OX2BxAZLzoBwtfkGLLD1OX2BxggGS86AcLX5DjU5fYHGCk6QAAAAAAAAAAAAAAAAAAAAAamTdgLfjJDF8FrY9mr1K2TawYXw',
};
const EXPECTED_MAC = {
  'TK-P1': 'd48e6713c0f62ed50f5ca6a9923ece20c1aa4f25d47e9ab6938c8d86d6eac5b5',
  'TK-P2': '6bc4e9ac1c6a86c81b47a97900c30da707294b163b6b84cdb238b9f88551ea2f',
  'TK-P3': '3bc0589f422067368c68b4940b98ed927cd9e33ec10058360f4af12a5d8d02f2',
  'TK-P4': '4e0f1161e6a96659b990c20fa2f648cc75bc9dd3bfaefc4f1a0ab35031e5dc9a',
};

/**
 * `sides` je součást fixture, ne úvaha runneru. Sender tokeny jen VYRÁBÍ, a to
 * jen tři typy: open, click a unsubscribe. Identity token (`i`) vydává aplikace
 * při přihlašování do preferencí, ověření tokenů dělá také aplikace. Go strana
 * proto zpracuje čtyři pozitivní vektory a žádný negativní. Zapsané je to tady,
 * aby check-parity věděl, kolik má na Go straně čekat, a aby přeskočení navíc
 * bylo vidět.
 */
function positive(
  id: string,
  type: TokenType,
  fields: Record<string, string | number>,
  sides: Array<'ts' | 'go'>,
) {
  const built = buildToken({ type, keyId: 1, fields, keyring });
  const expected = EXPECTED[id as keyof typeof EXPECTED];
  if (built.token !== expected) {
    throw new Error(`${id}: token se rozešel s kontraktem\n  vyrobeno: ${built.token}\n  kontrakt: ${expected}`);
  }
  return {
    id, type, key_id: 1, fields, sides,
    expected_token: built.token,
    expected_mac_full: Buffer.from(built.macFull).toString('hex'),
  };
}

export async function generateTokenVectors(): Promise<void> {
  const BOTH: Array<'ts' | 'go'> = ['ts', 'go'];
  const TS_ONLY: Array<'ts' | 'go'> = ['ts'];

  const p1 = positive('TK-P1', 'o', {
    workspace_id: IDS.workspace_id, message_id: IDS.message_id, message_created_at: IDS.message_created_at,
  }, BOTH);
  const p2 = positive('TK-P2', 'c', {
    workspace_id: IDS.workspace_id, message_id: IDS.message_id, link_id: IDS.link_id,
    message_created_at: IDS.message_created_at,
  }, BOTH);
  // Identity token vydává aplikace, sender ho nikdy nestaví.
  const p3 = positive('TK-P3', 'i', {
    workspace_id: IDS.workspace_id, contact_id: IDS.contact_id, campaign_id: IDS.campaign_id,
    nonce: IDS.nonce, expires_at: IDS.expires_at,
  }, TS_ONLY);
  const p4 = positive('TK-P4', 'u', {
    workspace_id: IDS.workspace_id, message_id: IDS.message_id, contact_id: IDS.contact_id,
    list_id: IDS.list_id, message_created_at: IDS.message_created_at,
  }, BOTH);
  const p5 = positive('TK-P5', 'u', {
    workspace_id: IDS.workspace_id, message_id: IDS.message_id, contact_id: IDS.contact_id,
    list_id: '00000000-0000-0000-0000-000000000000', message_created_at: IDS.message_created_at,
  }, BOTH);
  for (const [id, mac] of Object.entries(EXPECTED_MAC)) {
    const found = [p1, p2, p3, p4].find((v) => v.id === id)!;
    if (found.expected_mac_full !== mac) throw new Error(`${id}: plná HMAC se rozešla s kontraktem`);
  }

  const open = p1.expected_token;
  const unknownKey = buildToken({
    type: 'o', keyId: 9, keyring,
    fields: { workspace_id: IDS.workspace_id, message_id: IDS.message_id, message_created_at: IDS.message_created_at },
  }).token;
  const expiredIdentity = buildToken({
    type: 'i', keyId: 1, keyring,
    fields: {
      workspace_id: IDS.workspace_id, contact_id: IDS.contact_id, campaign_id: IDS.campaign_id,
      nonce: IDS.nonce, expires_at: 1_700_000_000,
    },
  }).token;
  const truncated = 't1' + Buffer.from(
    Buffer.from(open.slice(2), 'base64url').subarray(0, -1),
  ).toString('base64url');

  const vectors = {
    contractVersion: 1,
    secret_key: TEST_SECRET_KEY,
    note: 'Vygenerováno scripts/generate-fixtures.ts. Pozitivní vektory se ověřují proti hodnotám z části 1, kapitoly 4.10.3.',
    positive: [p1, p2, p3, p4, p5],
    // Všechny negativní vektory jsou o OVĚŘENÍ tokenu, které dělá aplikace.
    // Sender ověřování nemá, proto sides: ['ts'].
    negative: [
      { id: 'TK-N1', token: open.slice(2), endpoint_type: 'o', expected_error: 'token_malformed', sides: TS_ONLY },
      {
        id: 'TK-N2',
        token: open.slice(0, -1) + (open.endsWith('A') ? 'B' : 'A'),
        endpoint_type: 'o',
        expected_error: 'token_signature_invalid',
        sides: TS_ONLY,
      },
      { id: 'TK-N3', token: open, endpoint_type: 'c', expected_error: 'token_type_mismatch', sides: TS_ONLY },
      { id: 'TK-N4', token: unknownKey, endpoint_type: 'o', expected_error: 'token_unknown_key', sides: TS_ONLY },
      { id: 'TK-N5', token: truncated, endpoint_type: 'o', expected_error: 'token_malformed', sides: TS_ONLY },
      {
        id: 'TK-N6', token: expiredIdentity, endpoint_type: 'i',
        expected_error: 'token_expired', now: 1_784_995_200, sides: TS_ONLY,
      },
      {
        id: 'TK-N7', token: p3.expected_token, endpoint_type: 'i',
        expected_error: 'token_already_used', now: 1_784_995_200, nonce_used: true, sides: TS_ONLY,
      },
      {
        id: 'TK-N8',
        token: 't1' + open.slice(2).replace(/-/g, '+').replace(/_/g, '/'),
        endpoint_type: 'o',
        expected_error: 'token_malformed',
        sides: TS_ONLY,
      },
      { id: 'TK-N9', token: open + '=', endpoint_type: 'o', expected_error: 'token_malformed', sides: TS_ONLY },
    ],
  };

  await mkdir(path.join(packageRoot, 'fixtures', 'token'), { recursive: true });
  await writeFile(
    path.join(packageRoot, 'fixtures', 'token', 'vectors.json'),
    JSON.stringify(vectors, null, 2) + '\n',
    'utf8',
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await generateTokenVectors();
}
```

Generátor je zároveň kontraktní test: když se vyrobený token rozejde s hodnotou z kapitoly 4.10.3, skončí chybou a fixture nevznikne.

Run: `pnpm --filter @mlain/contracts exec tsx scripts/generate-fixtures.ts && pnpm --filter @mlain/contracts exec vitest run --project golden test/token.golden.test.ts`
Expected: PASS. `TK-N4` vyžaduje, aby v keyringu bylo `key_id` 9 při generování a **nebylo** při ověřování, proto má test vlastní keyring bez `SECRET_KEY_PREVIOUS`.

- [ ] **Krok 5: Commit**

```bash
git add packages/contracts/src/token.ts packages/contracts/scripts/generate-fixtures.ts packages/contracts/fixtures/token packages/contracts/test/token.golden.test.ts
git commit -m "feat(contracts): kontrakt 3, tokeny proti závazným vektorům a devíti negativním případům"
```

---

### Úkol 9: `Message-ID` a `base32_lower`

Scénář `OB-11` porovnává řetězec `Message-ID` u dvou pokusů téže zprávy. Kontrakt tvar předepisuje, ale kódování neurčuje, takže bez rozhodnutí D6 nejde scénář napsat vůbec.

**Závazná hodnota leží ve fixture, ne v testu.** Dřívější znění ji mělo opsanou na pěti místech ve dvou jazycích, a shodou okolností **na všech pěti špatně**: uvádělo `agjpholrfv7ednfmhu2f6yddqi`, zatímco správně je `agjphia4fv7edczmhvhf6ydrqi`. Implementační kód přitom správný byl, takže by neprošly testy na obou stranách a implementátor by opravoval funkční kód podle chybného očekávání. Přesně proto se závazné hodnoty do testů neopisují.

**Files:**
- Create: `packages/contracts/src/message-id.ts`
- Create: `packages/contracts/fixtures/message-id/vectors.json` (generovaný)
- Modify: `packages/contracts/scripts/generate-fixtures.ts`
- Test: `packages/contracts/test/message-id.golden.test.ts`

- [ ] **Krok 1: Napiš padající golden test**

`packages/contracts/test/message-id.golden.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { base32Lower, buildMessageId } from '../src/message-id.js';
import { writeGoldenReport } from './golden-report.js';

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const vectorsFile = path.join(fixturesDir, 'message-id', 'vectors.json');

type Vectors = {
  cases: Array<{
    id: string;
    message_id: string;
    sending_domain: string;
    expected_base32: string;
    expected_header: string;
    sides: Array<'ts' | 'go'>;
  }>;
};

const vectors = JSON.parse(await readFile(vectorsFile, 'utf8')) as Vectors;
const executed: string[] = [];

afterAll(async () => {
  await writeGoldenReport({
    section: 'message-id',
    total: vectors.cases.length,
    ids: executed,
    files: [vectorsFile],
  });
});

describe('Message-ID', () => {
  it('má čtyři vektory a všechny zpracují obě strany', () => {
    expect(vectors.cases).toHaveLength(4);
    for (const testCase of vectors.cases) {
      expect(testCase.sides).toEqual(['ts', 'go']);
    }
  });

  it.each(vectors.cases)('$id kóduje 16 bajtů UUID na 26 znaků a skládá hlavičku', (testCase) => {
    const encoded = base32Lower(Buffer.from(testCase.message_id.replace(/-/g, ''), 'hex'));
    expect(encoded).toHaveLength(26);
    expect(encoded).toMatch(/^[a-z2-7]+$/);
    expect(encoded).toBe(testCase.expected_base32);
    expect(buildMessageId({ messageId: testCase.message_id, sendingDomain: testCase.sending_domain })).toBe(
      testCase.expected_header,
    );
    executed.push(testCase.id);
  });

  it('OB-11: dva pokusy téže zprávy dají identický řetězec', () => {
    const [first] = vectors.cases;
    const a = buildMessageId({ messageId: first.message_id, sendingDomain: first.sending_domain });
    const b = buildMessageId({ messageId: first.message_id, sendingDomain: first.sending_domain });
    expect(a).toBe(b);
  });

  it('nikdy nezahrnuje číslo pokusu ani čas', () => {
    const [first] = vectors.cases;
    const value = buildMessageId({ messageId: first.message_id, sendingDomain: first.sending_domain });
    expect(value).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(value.split('@')[0]).toBe(`<ml.${first.expected_base32}`);
  });
});
```

- [ ] **Krok 2: Spusť a ověř, že padá**

Run: `pnpm --filter @mlain/contracts exec vitest run --project golden test/message-id.golden.test.ts`
Expected: FAIL, `ENOENT: fixtures/message-id/vectors.json`.

- [ ] **Krok 3: Napiš `src/message-id.ts`**

```ts
/**
 * Deterministický Message-ID (KONTRAKT, část 1, 4.10.1):
 *
 *   Message-ID: <ml.{base32_lower(uuid_bytes(messages.id))}@{sending_domain}>
 *
 * Nikdy nezahrnuje číslo pokusu ani čas, takže opakované odeslání téže zprávy
 * má identický Message-ID a většina přijímajících MTA ho deduplikuje.
 *
 * POZOR: na Amazon SES tahle pojistka NEEXISTUJE, protože SES si Message-ID
 * generuje sám a dodanou hlavičku přepíše. Je to zmírnění platné jen pro SMTP
 * a proto má SES výchozí politiku `fail` u nejednoznačného odeslání.
 *
 * ROZHODNUTÍ D6 tohoto plánu: `base32_lower` je RFC 4648 standardní abeceda,
 * bez paddingu, převedená na malá písmena. Kontrakt kódování neurčuje (nález
 * K13 části 4b), bez volby nejde OB-11 napsat.
 */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Lower(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out.toLowerCase();
}

export function buildMessageId(input: { messageId: string; sendingDomain: string }): string {
  const hex = input.messageId.replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new Error(`neplatné UUID zprávy: ${input.messageId}`);
  return `<ml.${base32Lower(new Uint8Array(Buffer.from(hex, 'hex')))}@${input.sendingDomain}>`;
}
```

- [ ] **Krok 4: Doplň generátor vektorů**

Přidej do `packages/contracts/scripts/generate-fixtures.ts`:

```ts
import { base32Lower, buildMessageId } from '../src/message-id.js';

/**
 * Závazné hodnoty ověřené DVĚMA nezávislými výpočty (kapitola 6). Generátor je
 * zároveň kontraktní test: když se `base32Lower` rozejde s referenční tabulkou,
 * skončí chybou a fixture nevznikne.
 */
const MESSAGE_ID_EXPECTED: Record<string, string> = {
  'MI-001': 'agjphia4fv7edczmhvhf6ydrqi',
  'MI-002': 'aaaaaaaaaaaaaaaaaaaaaaaaaa',
  'MI-003': '77777777777777777777777774',
  'MI-004': 'agjphia4fv7eaou2xds7byhdra',
};

export async function generateMessageIdVectors(): Promise<void> {
  const cases = [
    { id: 'MI-001', message_id: IDS.message_id, sending_domain: 'mail.example.cz' },
    { id: 'MI-002', message_id: '00000000-0000-0000-0000-000000000000', sending_domain: 'mail.example.cz' },
    { id: 'MI-003', message_id: 'ffffffff-ffff-ffff-ffff-ffffffffffff', sending_domain: 'mail.example.cz' },
    { id: 'MI-004', message_id: '0192f3a0-1c2d-7e40-3a9a-b8e5f0e0e388', sending_domain: 'zasilky.firma.cz' },
  ].map((item) => {
    const encoded = base32Lower(new Uint8Array(Buffer.from(item.message_id.replace(/-/g, ''), 'hex')));
    const expected = MESSAGE_ID_EXPECTED[item.id];
    if (encoded !== expected) {
      throw new Error(
        `${item.id}: base32_lower se rozešel s referenční hodnotou\n  vyrobeno: ${encoded}\n  čeká se: ${expected}`,
      );
    }
    return {
      ...item,
      sides: ['ts', 'go'],
      expected_base32: encoded,
      expected_header: buildMessageId({ messageId: item.message_id, sendingDomain: item.sending_domain }),
    };
  });

  await mkdir(path.join(packageRoot, 'fixtures', 'message-id'), { recursive: true });
  await writeFile(
    path.join(packageRoot, 'fixtures', 'message-id', 'vectors.json'),
    JSON.stringify({ contractVersion: 1, cases }, null, 2) + '\n',
    'utf8',
  );
}
```

A do spouštěcí větve souboru přidej `await generateMessageIdVectors();`.

Referenční hodnoty v `MESSAGE_ID_EXPECTED` **si před zápisem přepočítej**, ať se do plánu nevrátí tentýž druh chyby, který tenhle úkol opravuje:

```bash
node -e "for (const hex of ['0192f3a01c2d7e418b2c3d4e5f607182','00000000000000000000000000000000','ffffffffffffffffffffffffffffffff','0192f3a01c2d7e403a9ab8e5f0e0e388']) { const b=Buffer.from(hex,'hex'); const A='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits=0,v=0,out=''; for(const x of b){v=(v<<8)|x;bits+=8;while(bits>=5){out+=A[(v>>>(bits-5))&31];bits-=5;}} if(bits>0)out+=A[(v<<(5-bits))&31]; console.log(hex, out.toLowerCase()); }"
```

Expected, ověřeno spuštěním:

```
0192f3a01c2d7e418b2c3d4e5f607182 agjphia4fv7edczmhvhf6ydrqi 26
00000000000000000000000000000000 aaaaaaaaaaaaaaaaaaaaaaaaaa 26
ffffffffffffffffffffffffffffffff 77777777777777777777777774 26
0192f3a01c2d7e403a9ab8e5f0e0e388 agjphia4fv7eaou2xds7byhdra 26
```

**Když se výstup liší od hodnoty v `MESSAGE_ID_EXPECTED`, platí výstup příkazu.** Poslední znak u `MI-003` stojí za pozornost: 128 bitů se nedělí pěti beze zbytku, takže poslední pětice nese jen tři bity a ze samých jedniček vyjde `4`, ne `7`. Právě na tomhle si opsaná hodnota podruhé rozbila nos, tentokrát při psaní téhle opravy.

- [ ] **Krok 5: Vygeneruj a spusť**

Run: `pnpm --filter @mlain/contracts exec tsx scripts/generate-fixtures.ts && pnpm --filter @mlain/contracts exec vitest run --project golden test/message-id.golden.test.ts`
Expected: PASS, 6 testů, a `reports/ts-golden-message-id.json` s `executed: 4` a `skipped: 0`.

- [ ] **Krok 6: Commit**

```bash
git add packages/contracts/src/message-id.ts packages/contracts/fixtures/message-id packages/contracts/scripts packages/contracts/test/message-id.golden.test.ts
git commit -m "feat(contracts): deterministický Message-ID se závaznými vektory ve fixture"
```

---

### Úkol 10: Kontrakt 4, šifrování credentials

AAD váže obálku na dvě věci naráz: na kontext, aby nešlo zašifrovanou hodnotu přesunout z jednoho sloupce do druhého, a na `workspace_id`, aby nešlo zkopírovat SES přístupy projektu A do řádku provideru projektu B. Podpis funkcí musí odpovídat tomu, co po balíčku volá P04.

**Files:**
- Create: `packages/contracts/src/crypto.ts`
- Modify: `packages/contracts/scripts/generate-fixtures.ts`
- Test: `packages/contracts/test/crypto.golden.test.ts`

- [ ] **Krok 1: Napiš padající golden test**

`packages/contracts/test/crypto.golden.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { parseKeyring } from '../src/keyring.js';
import {
  CREDENTIAL_CONTEXTS, CryptoError, decryptEnvelope, encryptEnvelope, envelopeKeyId,
  type CredentialContext,
} from '../src/crypto.js';
import { writeGoldenReport } from './golden-report.js';

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const vectorsFile = path.join(fixturesDir, 'crypto', 'vectors.json');
const keyring = parseKeyring({ secretKey: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8' });

type Side = 'ts' | 'go';

type Vectors = {
  positive: Array<{
    id: string; key_id: number; context: CredentialContext; workspace_id: string; nonce_hex: string;
    plaintext: string; expected_header_hex: string; expected_aad_hex: string; expected_ciphertext_hex: string;
    expected_tag_hex: string; expected_stored: string; expected_envelope_bytes: number; sides: Side[];
  }>;
  negative: Array<{ id: string; stored: string; context: CredentialContext; workspace_id: string; expected_error: string; sides: Side[] }>;
};

const vectors = JSON.parse(await readFile(vectorsFile, 'utf8')) as Vectors;
const executed: string[] = [];

afterAll(async () => {
  await writeGoldenReport({
    section: 'crypto',
    total: vectors.positive.length + vectors.negative.length,
    ids: executed,
    files: [vectorsFile],
  });
});

describe('kontrakt 4: šifrování credentials', () => {
  it('má jeden pozitivní a osm negativních vektorů', () => {
    expect(vectors.positive).toHaveLength(1);
    expect(vectors.negative).toHaveLength(8);
  });

  it('každý vektor nese platný kontext z uzavřeného výčtu', () => {
    // Schéma dřív `context` jako výčet nevynucovalo, takže se do negativního
    // vektoru dostal řetězec, který v CREDENTIAL_CONTEXTS vůbec není. Fixture
    // pak testovala tvar, který v produktu nemůže nastat.
    for (const vector of [...vectors.positive, ...vectors.negative]) {
      expect(CREDENTIAL_CONTEXTS, `${vector.id} má kontext mimo výčet`).toContain(vector.context);
      expect(vector.sides).toContain('ts');
    }
  });

  it('envelopeKeyId přečte key_id z obálky bez klíče a bez dešifrování', () => {
    expect(envelopeKeyId(vectors.positive[0].expected_stored)).toBe(vectors.positive[0].key_id);
  });

  it.each(vectors.positive)('$id vyrobí obálku bajt na bajt', (vector) => {
    const result = encryptEnvelope({
      plaintext: vector.plaintext,
      context: vector.context,
      workspaceId: vector.workspace_id,
      keyring,
      keyId: vector.key_id,
      nonce: new Uint8Array(Buffer.from(vector.nonce_hex, 'hex')),
    });
    expect(result.stored).toBe(vector.expected_stored);
    expect(Buffer.from(result.header).toString('hex')).toBe(vector.expected_header_hex);
    expect(Buffer.from(result.aad).toString('hex')).toBe(vector.expected_aad_hex);
    expect(Buffer.from(result.ciphertext).toString('hex')).toBe(vector.expected_ciphertext_hex);
    expect(Buffer.from(result.tag).toString('hex')).toBe(vector.expected_tag_hex);
    expect(result.envelopeBytes).toBe(vector.expected_envelope_bytes);
    expect(result.envelopeKeyId).toBe(vector.key_id);
    executed.push(vector.id);
  });

  it.each(vectors.positive)('$id se dešifruje zpět na původní text', (vector) => {
    expect(
      decryptEnvelope({
        stored: vector.expected_stored,
        context: vector.context,
        workspaceId: vector.workspace_id,
        keyring,
      }),
    ).toBe(vector.plaintext);
  });

  it.each(vectors.negative)('$id skončí s $expected_error', (vector) => {
    try {
      decryptEnvelope({
        stored: vector.stored, context: vector.context, workspaceId: vector.workspace_id, keyring,
      });
      throw new Error(`${vector.id}: dešifrování mělo selhat`);
    } catch (error) {
      expect(error).toBeInstanceOf(CryptoError);
      expect((error as CryptoError).code).toBe(vector.expected_error);
    }
    executed.push(vector.id);
  });

  it('náhodný nonce se pro tentýž klíč neopakuje', () => {
    const a = encryptEnvelope({ plaintext: '{"a":1}', context: 'sending_provider', workspaceId: vectors.positive[0].workspace_id, keyring });
    const b = encryptEnvelope({ plaintext: '{"a":1}', context: 'sending_provider', workspaceId: vectors.positive[0].workspace_id, keyring });
    expect(a.stored).not.toBe(b.stored);
  });

  it('podpis odpovídá tomu, co volá P04', () => {
    const stored = encryptEnvelope({
      plaintext: '{"secret":"x"}', context: 'webhook_secret', workspaceId: vectors.positive[0].workspace_id, keyring,
    }).stored;
    expect(
      decryptEnvelope({ stored, context: 'webhook_secret', workspaceId: vectors.positive[0].workspace_id, keyring }),
    ).toBe('{"secret":"x"}');
  });
});
```

- [ ] **Krok 2: Spusť a ověř, že padá**

Run: `pnpm --filter @mlain/contracts exec vitest run --project golden test/crypto.golden.test.ts`
Expected: FAIL, `ENOENT: fixtures/crypto/vectors.json`.

- [ ] **Krok 3: Napiš `src/crypto.ts`**

```ts
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { currentKeyId, deriveKey, KEY_PURPOSES, keyringFromEnv, type Keyring } from './keyring.js';

/**
 * Kontrakt 4: šifrování credentials (část 1, 4.10.4). ZMRAZENO.
 *
 *   header   = version(1) || key_id(1) || context_len(1) || context(context_len)
 *   envelope = header || nonce(12) || ciphertext(N) || tag(16)
 *   stored   = "enc:v1:" || base64_standard_with_padding(envelope)
 *   aad      = "mailer/cred/v1" || header || workspace_id(16)
 *   key      = HKDF(SHA-256, MASTER, "mailer/v1", "mailer/v1/credential-encryption", 32)
 *
 * Base64 je zde STANDARDNÍ s paddingem, na rozdíl od tokenů, kde je base64url
 * bez paddingu. Rozdíl je záměrný: token jde do URL, tohle ne.
 */
export const ENVELOPE_PREFIX = 'enc:v1:';
export const ENVELOPE_VERSION = 0x01;
export const AAD_PREFIX = 'mailer/cred/v1';
export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;

export const CREDENTIAL_CONTEXTS = ['sending_provider', 'ai_provider', 'webhook_secret', 'oauth_token'] as const;
export type CredentialContext = (typeof CREDENTIAL_CONTEXTS)[number];

export type CryptoErrorCode =
  | 'crypto_envelope_malformed'
  | 'crypto_unsupported_version'
  | 'crypto_context_mismatch'
  | 'crypto_unknown_key'
  | 'crypto_auth_failed';

export class CryptoError extends Error {
  constructor(readonly code: CryptoErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'CryptoError';
  }
}

function workspaceIdBytes(workspaceId: string): Buffer {
  const hex = workspaceId.replace(/-/g, '');
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) {
    throw new CryptoError('crypto_envelope_malformed', `neplatné workspace_id ${workspaceId}`);
  }
  return Buffer.from(hex, 'hex');
}

function buildHeader(keyId: number, context: CredentialContext): Buffer {
  const contextBytes = Buffer.from(context, 'ascii');
  if (contextBytes.length < 1 || contextBytes.length > 64) {
    throw new CryptoError('crypto_envelope_malformed', 'context musí mít 1 až 64 bajtů');
  }
  return Buffer.concat([Buffer.from([ENVELOPE_VERSION, keyId, contextBytes.length]), contextBytes]);
}

function buildAad(header: Buffer, workspaceId: string): Buffer {
  return Buffer.concat([Buffer.from(AAD_PREFIX, 'ascii'), header, workspaceIdBytes(workspaceId)]);
}

export type EncryptInput = {
  plaintext: string;
  context: CredentialContext;
  workspaceId: string;
  /** když chybí, načte se z prostředí, aby volání odpovídalo tomu, co používá P04 */
  keyring?: Keyring;
  keyId?: number;
  /** jen pro golden fixtures; v provozu se generuje z CSPRNG a NIKDY se neopakuje */
  nonce?: Uint8Array;
};

export function encryptEnvelope(input: EncryptInput): {
  stored: string;
  header: Uint8Array;
  aad: Uint8Array;
  ciphertext: Uint8Array;
  tag: Uint8Array;
  envelopeBytes: number;
  /** key_id, kterým se obálka opravdu zašifrovala; potřebuje ho report rotace v P16 */
  envelopeKeyId: number;
} {
  const keyring = input.keyring ?? keyringFromEnv();
  const keyId = input.keyId ?? currentKeyId(keyring);
  const master = keyring.get(keyId);
  if (!master) throw new CryptoError('crypto_unknown_key', `key_id ${keyId}`);

  const header = buildHeader(keyId, input.context);
  const aad = buildAad(header, input.workspaceId);
  const nonce = Buffer.from(input.nonce ?? randomBytes(NONCE_BYTES));
  if (nonce.length !== NONCE_BYTES) throw new CryptoError('crypto_envelope_malformed', 'nonce musí mít 12 bajtů');

  const cipher = createCipheriv('aes-256-gcm', Buffer.from(deriveKey(master, KEY_PURPOSES.credentialEncryption)), nonce);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(Buffer.from(input.plaintext, 'utf8')), cipher.final()]);
  const tag = cipher.getAuthTag();
  const envelope = Buffer.concat([header, nonce, ciphertext, tag]);

  return {
    stored: ENVELOPE_PREFIX + envelope.toString('base64'),
    header: new Uint8Array(header),
    aad: new Uint8Array(aad),
    ciphertext: new Uint8Array(ciphertext),
    tag: new Uint8Array(tag),
    envelopeBytes: envelope.length,
    envelopeKeyId: keyId,
  };
}

/**
 * Přečte `key_id` z hlavičky obálky, aniž by ji dešifroval a aniž by potřeboval
 * klíč. Slouží reportu rotace: dá se jím projít sloupec se zašifrovanými
 * hodnotami a zjistit, kolik jich ještě visí na starém pokolení klíče.
 * Jméno a signatura jsou dané tím, jak funkci volá P16 (rozhodnutí R6).
 */
export function envelopeKeyId(stored: string): number {
  if (!stored.startsWith(ENVELOPE_PREFIX)) {
    throw new CryptoError('crypto_envelope_malformed', 'chybí prefix enc:v1:');
  }
  const envelope = Buffer.from(stored.slice(ENVELOPE_PREFIX.length), 'base64');
  if (envelope.length < 3) throw new CryptoError('crypto_envelope_malformed', 'obálka je příliš krátká');
  if (envelope[0] !== ENVELOPE_VERSION) {
    throw new CryptoError('crypto_unsupported_version', `version ${envelope[0]}`);
  }
  return envelope[1];
}

export type DecryptInput = {
  stored: string;
  context: CredentialContext;
  workspaceId: string;
  keyring?: Keyring;
};

/** Dešifrování v NORMATIVNÍM pořadí kroků z 4.10.4. */
export function decryptEnvelope(input: DecryptInput): string {
  const keyring = input.keyring ?? keyringFromEnv();
  // 1
  if (!input.stored.startsWith(ENVELOPE_PREFIX)) {
    throw new CryptoError('crypto_envelope_malformed', 'chybí prefix enc:v1:');
  }
  const encoded = input.stored.slice(ENVELOPE_PREFIX.length);
  // 2
  let envelope: Buffer;
  try {
    envelope = Buffer.from(encoded, 'base64');
    if (envelope.toString('base64') !== encoded) throw new Error('nekanonické base64');
  } catch {
    throw new CryptoError('crypto_envelope_malformed', 'base64 dekódování selhalo');
  }
  if (envelope.length < 3) throw new CryptoError('crypto_envelope_malformed', 'obálka je příliš krátká');
  // 3
  if (envelope[0] !== ENVELOPE_VERSION) {
    throw new CryptoError('crypto_unsupported_version', `version ${envelope[0]}`);
  }
  // 4
  const keyId = envelope[1];
  const contextLen = envelope[2];
  if (contextLen < 1 || contextLen > 64) throw new CryptoError('crypto_envelope_malformed', 'context_len mimo 1..64');
  const headerLength = 3 + contextLen;
  if (envelope.length < headerLength + NONCE_BYTES + TAG_BYTES) {
    throw new CryptoError('crypto_envelope_malformed', 'obálka je kratší než hlavička, nonce a tag');
  }
  const header = envelope.subarray(0, headerLength);
  const context = header.subarray(3).toString('ascii');
  // 5
  if (context !== input.context) {
    throw new CryptoError('crypto_context_mismatch', `obálka nese ${context}, čekal se ${input.context}`);
  }
  // 6
  const master = keyring.get(keyId);
  if (!master) throw new CryptoError('crypto_unknown_key', `key_id ${keyId}`);
  // 7
  const nonce = envelope.subarray(headerLength, headerLength + NONCE_BYTES);
  const tag = envelope.subarray(envelope.length - TAG_BYTES);
  const ciphertext = envelope.subarray(headerLength + NONCE_BYTES, envelope.length - TAG_BYTES);
  const decipher = createDecipheriv(
    'aes-256-gcm',
    Buffer.from(deriveKey(master, KEY_PURPOSES.credentialEncryption)),
    nonce,
  );
  decipher.setAAD(buildAad(Buffer.from(header), input.workspaceId));
  decipher.setAuthTag(tag);
  let plaintext: Buffer;
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    // Chybu NIKDY nerozlišuj podle příčiny směrem ven; ven jde vždy jeden kód.
    throw new CryptoError('crypto_auth_failed');
  }
  // 8, parsování JSON dělá volající
  return plaintext.toString('utf8');
}
```

- [ ] **Krok 4: Doplň krypto část generátoru**

Přidej do `packages/contracts/scripts/generate-fixtures.ts`:

```ts
import { encryptEnvelope, type CredentialContext } from '../src/crypto.js';

const CRYPTO_EXPECTED = {
  header_hex: '01011073656e64696e675f70726f7669646572',
  aad_hex:
    '6d61696c65722f637265642f763101011073656e64696e675f70726f76696465720192f3a01c2d7e409a1b2c3d4e5f6071',
  ciphertext_hex:
    'fae5c57114c84c4ec01591b018af427e916c8c3c557225764cf65a3051382d8128c6de1ac3e38c79c5e2d42b5dc41388e' +
    '567310ccf2aefcb6251a2dfe3f944983da3c3481b0bfd18beb9a930aa089a1231c84ed1',
  tag_hex: '1ef74b99f8ae68049656d9240d8b8807',
  envelope_bytes: 131,
  stored:
    'enc:v1:AQEQc2VuZGluZ19wcm92aWRlcgABAgMEBQYHCAkKC/rlxXEUyExOwBWRsBivQn6RbIw8VXIldkz2WjBROC2BKMbeGs' +
    'PjjHnF4tQrXcQTiOVnMQzPKu/LYlGi3+P5RJg9o8NIGwv9GL65qTCqCJoSMchO0R73S5n4rmgEllbZJA2LiAc=',
};

export async function generateCryptoVectors(): Promise<void> {
  const BOTH: Array<'ts' | 'go'> = ['ts', 'go'];
  const workspaceId = IDS.workspace_id;
  const otherWorkspaceId = '0192f3a0-1c2d-7e47-9a1b-2c3d4e5f6099';
  const nonceHex = '000102030405060708090a0b';
  const plaintext =
    '{"access_key_id":"AKIAEXAMPLE","secret_access_key":"s3cr3t","region":"eu-central-1"}';

  const result = encryptEnvelope({
    plaintext, context: 'sending_provider', workspaceId, keyring, keyId: 1,
    nonce: new Uint8Array(Buffer.from(nonceHex, 'hex')),
  });

  const checks: Array<[string, string, string]> = [
    ['header', Buffer.from(result.header).toString('hex'), CRYPTO_EXPECTED.header_hex],
    ['aad', Buffer.from(result.aad).toString('hex'), CRYPTO_EXPECTED.aad_hex],
    ['ciphertext', Buffer.from(result.ciphertext).toString('hex'), CRYPTO_EXPECTED.ciphertext_hex],
    ['tag', Buffer.from(result.tag).toString('hex'), CRYPTO_EXPECTED.tag_hex],
    ['stored', result.stored, CRYPTO_EXPECTED.stored],
  ];
  for (const [name, got, want] of checks) {
    if (got !== want) {
      throw new Error(
        `krypto vektor ${name} se rozešel s kontraktem\n  vyrobeno: ${got}\n  kontrakt: ${want}\n` +
          'Pozor: AAD neovlivňuje ciphertext, jen tag. Když sedí ciphertext a nesedí tag, ' +
          'chyba je v AAD, ne v klíči ani v nonce.',
      );
    }
  }

  const envelope = Buffer.from(result.stored.slice('enc:v1:'.length), 'base64');
  const header = Buffer.from(result.header);
  const body = envelope.subarray(header.length); // nonce || ciphertext || tag

  const flipped = Buffer.from(envelope);
  flipped[40] ^= 0x01;

  // CR-N2 testuje, že AAD sváže HLAVIČKU: obálka se přepíše tak, aby nesla JINÝ,
  // ale PLATNÝ kontext, a dešifruje se s očekáváním právě toho jiného kontextu.
  // Krok 5 (shoda kontextu) tedy projde a selhat musí až ověření tagu.
  //
  // Dřívější znění sem psalo vymyšlený řetězec `ai_provider_____` jen proto, aby
  // měl stejnou délku jako `sending_provider`. Ten kontext v uzavřeném výčtu
  // CREDENTIAL_CONTEXTS není a schéma to nevynucovalo, takže fixture testovala
  // tvar, který v produktu nemůže vzniknout. Délka se lišit smí: `context_len`
  // je součástí hlavičky a obálka zůstane dobře utvořená.
  const rewrittenContext: CredentialContext = 'webhook_secret';
  const rewrittenHeader = Buffer.concat([
    Buffer.from([0x01, 1, Buffer.byteLength(rewrittenContext, 'ascii')]),
    Buffer.from(rewrittenContext, 'ascii'),
  ]);
  const wrongContext = Buffer.concat([rewrittenHeader, body]);

  const wrongVersion = Buffer.from(envelope);
  wrongVersion[0] = 0x02;
  const unknownKey = Buffer.from(envelope);
  unknownKey[1] = 7;
  const withoutTag = envelope.subarray(0, envelope.length - 16);

  const vectors = {
    contractVersion: 1,
    secret_key: TEST_SECRET_KEY,
    // Pozitivní vektor zpracují obě strany, ale každá jinou půlkou: TypeScript
    // obálku VYROBÍ a porovná bajt na bajt, Go ji jen DEŠIFRUJE a porovná
    // plaintext. Sender totiž šifrovat neumí a umět nemá, credentials šifruje
    // aplikace. Že Go přečte, co TypeScript zapsal, je přesně to tvrzení,
    // které kritérium 45 vyžaduje.
    positive: [{
      id: 'CR-P1', key_id: 1, context: 'sending_provider', workspace_id: workspaceId, nonce_hex: nonceHex,
      plaintext, sides: BOTH,
      expected_header_hex: CRYPTO_EXPECTED.header_hex,
      expected_aad_hex: CRYPTO_EXPECTED.aad_hex,
      expected_ciphertext_hex: CRYPTO_EXPECTED.ciphertext_hex,
      expected_tag_hex: CRYPTO_EXPECTED.tag_hex,
      expected_stored: CRYPTO_EXPECTED.stored,
      expected_envelope_bytes: CRYPTO_EXPECTED.envelope_bytes,
    }],
    negative: [
      { id: 'CR-N1', stored: 'enc:v1:' + flipped.toString('base64'), context: 'sending_provider', workspace_id: workspaceId, expected_error: 'crypto_auth_failed', sides: BOTH },
      { id: 'CR-N2', stored: 'enc:v1:' + wrongContext.toString('base64'), context: rewrittenContext, workspace_id: workspaceId, expected_error: 'crypto_auth_failed', sides: BOTH },
      { id: 'CR-N3', stored: CRYPTO_EXPECTED.stored, context: 'webhook_secret', workspace_id: workspaceId, expected_error: 'crypto_context_mismatch', sides: BOTH },
      { id: 'CR-N4', stored: 'enc:v1:' + wrongVersion.toString('base64'), context: 'sending_provider', workspace_id: workspaceId, expected_error: 'crypto_unsupported_version', sides: BOTH },
      { id: 'CR-N5', stored: 'enc:v1:' + unknownKey.toString('base64'), context: 'sending_provider', workspace_id: workspaceId, expected_error: 'crypto_unknown_key', sides: BOTH },
      { id: 'CR-N6', stored: envelope.toString('base64'), context: 'sending_provider', workspace_id: workspaceId, expected_error: 'crypto_envelope_malformed', sides: BOTH },
      { id: 'CR-N7', stored: 'enc:v1:' + withoutTag.toString('base64'), context: 'sending_provider', workspace_id: workspaceId, expected_error: 'crypto_auth_failed', sides: BOTH },
      { id: 'CR-N8', stored: CRYPTO_EXPECTED.stored, context: 'sending_provider', workspace_id: otherWorkspaceId, expected_error: 'crypto_auth_failed', sides: BOTH },
    ],
  };

  await mkdir(path.join(packageRoot, 'fixtures', 'crypto'), { recursive: true });
  await writeFile(
    path.join(packageRoot, 'fixtures', 'crypto', 'vectors.json'),
    JSON.stringify(vectors, null, 2) + '\n',
    'utf8',
  );
}
```

A do spouštěcí větve souboru přidej `await generateCryptoVectors();` hned za `await generateTokenVectors();`.

`CR-N2` přepíše hlavičku na **jiný platný kontext** a dešifruje se s očekáváním právě toho kontextu, takže krok 5 projde a selže až ověření tagu; tím se dokazuje, že AAD sváže hlavičku. Ověřeno spuštěním, viz kapitola 6. `CR-N7` zkracuje obálku o tag, takže poslední bajty ciphertextu se interpretují jako tag a GCM ověření selže; kontrakt u něj uvádí `crypto_envelope_malformed`, ale ta hodnota je dosažitelná jen tehdy, když je obálka kratší než hlavička a nonce dohromady. Zapsáno jako nález N5 v kapitole 10; fixture nese hodnotu, kterou implementace skutečně vrací, a kód dešifrování se kvůli tomu neohýbá.

- [ ] **Krok 5: Vygeneruj a spusť**

Run: `pnpm --filter @mlain/contracts exec tsx scripts/generate-fixtures.ts && pnpm --filter @mlain/contracts run test:golden`
Expected: PASS.

- [ ] **Krok 6: Commit**

```bash
git add packages/contracts/src/crypto.ts packages/contracts/scripts packages/contracts/fixtures/crypto packages/contracts/test/crypto.golden.test.ts
git commit -m "feat(contracts): kontrakt 4, obálka AES-256-GCM s workspace_id v AAD"
```

---

### Úkol 11: Go runnery kontraktů 3, 4 a Message-ID

Dřívější znění tady psalo **druhou Go implementaci** tokenů, keyringu, šifrování a Message-ID. To se ruší (rozhodnutí D8): implementaci vlastní P09 v produkčních balíčcích a tenhle úkol dodává jen to, co P09 nemá a mít nemá, tedy **čtení fixtures, zápis reportu a runnery**. Runner produkční funkce dostane jako hodnoty ve struktuře, takže se `internal/contracts` přeloží i ve vlně 0, kdy P09 ještě neexistuje, a zároveň neexistuje způsob, jak runner spustit nad něčím jiným než produkčním kódem.

**Files:**
- Modify: `apps/sender/internal/contracts/fixtures.go`
- Create: `apps/sender/internal/contracts/report.go`
- Create: `apps/sender/internal/contracts/golden.go`
- Test: `apps/sender/internal/contracts/golden_test.go`

- [ ] **Krok 1: Doplň do `fixtures.go` seznam a otisk**

Přidej na konec `apps/sender/internal/contracts/fixtures.go`:

```go
import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// ListFixtures vrací seřazená jména .json souborů v podadresáři fixtures.
func ListFixtures(sub string) ([]string, error) {
	entries, err := os.ReadDir(filepath.Join(FixturesDir(), sub))
	if err != nil {
		return nil, err
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		if strings.HasSuffix(entry.Name(), ".json") {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	return names, nil
}

// FixturesDigest počítá otisk vstupních souborů sekce STEJNĚ jako TypeScript
// strana: sha256 nad seřazeným "jméno\0sha256(obsah)\n". check-parity ho
// přepočítá z disku a vyžaduje shodu s oběma reporty, takže zelená parita nad
// reportem ze starého běhu není možná.
func FixturesDigest(sub string, names []string) (string, error) {
	sorted := append([]string(nil), names...)
	sort.Strings(sorted)
	outer := sha256.New()
	for _, name := range sorted {
		body, err := os.ReadFile(filepath.Join(FixturesDir(), sub, name))
		if err != nil {
			return "", err
		}
		inner := sha256.Sum256(body)
		outer.Write([]byte(name))
		outer.Write([]byte{0})
		outer.Write([]byte(hex.EncodeToString(inner[:])))
		outer.Write([]byte{'\n'})
	}
	return hex.EncodeToString(outer.Sum(nil)), nil
}
```

- [ ] **Krok 2: Napiš `report.go`**

```go
package contracts

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"testing"
)

// Report má PŘESNĚ ta pole, která čte scripts/check-parity.ts. Jeden tvar pro
// obě strany, jinak by se porovnávaly dvě různé věci (rozhodnutí D14).
type Report struct {
	Language       string         `json:"language"`
	Section        string         `json:"section"`
	Total          int            `json:"total"`
	Executed       int            `json:"executed"`
	Skipped        int            `json:"skipped"`
	IDs            []string       `json:"ids"`
	Groups         map[string]int `json:"groups"`
	FixturesDigest string         `json:"fixturesDigest"`
}

// WriteGoldenReport zapíše report sekce. `Skipped` se POČÍTÁ jako rozdíl mezi
// použitelnými a skutečně provedenými, nikdy se nepíše jako literál: literál
// nula byl důvod, proč dřívější kontrola "nepřeskočené fixtures" neměřila nic.
//
// Report se zapisuje VŽDY, i když je běh neúplný. Tiché nezapsání by z chybějící
// parity udělalo zelenou, protože check-parity by neměl co porovnat.
func WriteGoldenReport(t *testing.T, section string, total int, ids []string, groups map[string]int, digest string) {
	t.Helper()
	sorted := append([]string(nil), ids...)
	sort.Strings(sorted)
	if groups == nil {
		groups = map[string]int{}
	}
	report := Report{
		Language:       "go",
		Section:        section,
		Total:          total,
		Executed:       len(sorted),
		Skipped:        total - len(sorted),
		IDs:            sorted,
		Groups:         groups,
		FixturesDigest: digest,
	}
	dir := ReportsDir()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("reports: %v", err)
	}
	body, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		t.Fatalf("report: %v", err)
	}
	path := filepath.Join(dir, "go-golden-"+section+".json")
	if err := os.WriteFile(path, append(body, '\n'), 0o644); err != nil {
		t.Fatalf("zápis reportu %s: %v", path, err)
	}
}
```

`ReportsDir()` z úkolu 1 ukazuje na `packages/contracts/reports`. Cesta se odvozuje od zdrojového souboru, ne od pracovního adresáře, takže funguje i když testy P09 běží z jiného balíčku.

- [ ] **Krok 3: Napiš runnery kontraktů 3 a 4 a Message-ID**

Každý runner má dvě vrstvy. **Čistá funkce `check*`** projde fixtures, zavolá produkční kód a vrátí seznam neshod plus seznam skutečně provedených id. **Obálka `Run*Golden`** ji zavolá, zapíše report a neshody přeloží na selhání testu. Rozdělení není estetika: bez něj nejde runner otestovat, protože z `*testing.T` se nedá zjistit, že selhal správně.

`apps/sender/internal/contracts/golden.go`:

```go
package contracts

import (
	"encoding/hex"
	"encoding/json"
	"fmt"
	"testing"
)

// Mismatch je jedna neshoda mezi produkčním kódem a fixture.
type Mismatch struct {
	ID     string
	Detail string
}

// Outcome je výsledek jednoho běhu runneru: co se dalo zpracovat, co se
// zpracovalo, a v čem se to rozešlo.
type Outcome struct {
	Total      int
	IDs        []string
	Mismatches []Mismatch
	Groups     map[string]int
}

// hasSide říká, jestli fixture patří téhle jazykové straně. Je to DATA ze
// zmrazené fixture, ne rozhodnutí runneru za běhu. Rozdíl je zásadní:
// t.Skip() uvnitř běhu nikdo nespočítá, kdežto chybějící "go" v poli sides
// je vidět v code review a check-parity z něj počítá očekávanou množinu.
func hasSide(sides []string, side string) bool {
	for _, item := range sides {
		if item == side {
			return true
		}
	}
	return false
}

// finish je společný závěr všech runnerů: zapiš report, pak nahlas neshody.
// V TOMHLE POŘADÍ. Kdyby se hlásilo dřív, t.Fatalf by běh ukončil a report by
// nevznikl, takže by check-parity neměl co porovnat a chybějící parita by
// vypadala stejně jako parita v pořádku.
func finish(t *testing.T, section string, outcome Outcome, files []string) {
	t.Helper()
	digest, err := FixturesDigest(section, files)
	if err != nil {
		t.Fatalf("otisk fixtures sekce %s: %v", section, err)
	}
	WriteGoldenReport(t, section, outcome.Total, outcome.IDs, outcome.Groups, digest)
	for _, mismatch := range outcome.Mismatches {
		t.Errorf("%s: %s", mismatch.ID, mismatch.Detail)
	}
}

// ---------------------------------------------------------------- kontrakt 3 --

type tokenVectors struct {
	SecretKey string `json:"secret_key"`
	Positive  []struct {
		ID            string         `json:"id"`
		Type          string         `json:"type"`
		KeyID         int            `json:"key_id"`
		Fields        map[string]any `json:"fields"`
		ExpectedToken string         `json:"expected_token"`
		ExpectedMAC   string         `json:"expected_mac_full"`
		Sides         []string       `json:"sides"`
	} `json:"positive"`
	Negative []struct {
		ID    string   `json:"id"`
		Sides []string `json:"sides"`
	} `json:"negative"`
}

// TokenRunner drží produkční funkce P09. Runner je nezná jménem ani balíčkem,
// takže se internal/contracts přeloží i bez nich.
type TokenRunner struct {
	// Init dostane obsah pole secret_key z fixture a připraví keyring i stavitele.
	Init func(secretKey string) error
	// Build vyrobí token daného typu. Typ je ASCII znak z kontraktu ("o", "c", "u").
	// Fields jsou syrová pole fixture; převod na UUID a čas dělá adaptér, protože
	// balíček contracts na uuid závislost nemá a mít nemá. Vrací i plnou HMAC
	// před zkrácením, protože kontrakt ji uvádí jako závaznou hodnotu.
	Build func(typ string, keyID uint8, fields map[string]any) (token string, macFull []byte, err error)
}

// CheckTokenGolden je čistá část runneru. Nesahá na testing, takže jde otestovat.
func CheckTokenGolden(raw []byte, runner TokenRunner) (Outcome, error) {
	var v tokenVectors
	if err := json.Unmarshal(raw, &v); err != nil {
		return Outcome{}, fmt.Errorf("fixtures nejdou naparsovat: %w", err)
	}
	if err := runner.Init(v.SecretKey); err != nil {
		return Outcome{}, fmt.Errorf("keyring z fixture: %w", err)
	}

	outcome := Outcome{}
	for _, vec := range v.Positive {
		if !hasSide(vec.Sides, "go") {
			continue
		}
		outcome.Total++
		token, macFull, err := runner.Build(vec.Type, uint8(vec.KeyID), vec.Fields)
		if err != nil {
			outcome.Mismatches = append(outcome.Mismatches, Mismatch{vec.ID, "build selhal: " + err.Error()})
			continue
		}
		if token != vec.ExpectedToken {
			outcome.Mismatches = append(outcome.Mismatches, Mismatch{vec.ID,
				fmt.Sprintf("token se rozešel\n  Go:       %s\n  kontrakt: %s", token, vec.ExpectedToken)})
			continue
		}
		if got := hex.EncodeToString(macFull); got != vec.ExpectedMAC {
			outcome.Mismatches = append(outcome.Mismatches, Mismatch{vec.ID,
				fmt.Sprintf("plná HMAC se rozešla\n  Go:       %s\n  kontrakt: %s", got, vec.ExpectedMAC)})
			continue
		}
		outcome.IDs = append(outcome.IDs, vec.ID)
	}
	// Negativní vektory jsou o OVĚŘENÍ tokenu, které dělá aplikace, ne sender.
	// Kdyby si je někdo nárokoval pro Go, je to chyba fixture, ne důvod k přeskočení.
	for _, vec := range v.Negative {
		if hasSide(vec.Sides, "go") {
			outcome.Mismatches = append(outcome.Mismatches, Mismatch{vec.ID,
				"má sides go, ale sender tokeny neověřuje; oprav fixture nebo runner"})
		}
	}
	return outcome, nil
}

func RunTokenGolden(t *testing.T, runner TokenRunner) {
	t.Helper()
	raw, err := ReadFixture("token/vectors.json")
	if err != nil {
		t.Fatalf("fixtures nejdou přečíst: %v", err)
	}
	outcome, err := CheckTokenGolden(raw, runner)
	if err != nil {
		t.Fatalf("%v", err)
	}
	finish(t, "token", outcome, []string{"vectors.json"})
}

// ---------------------------------------------------------------- kontrakt 4 --

type cryptoVectors struct {
	SecretKey string `json:"secret_key"`
	Positive  []struct {
		ID             string   `json:"id"`
		Context        string   `json:"context"`
		WorkspaceID    string   `json:"workspace_id"`
		Plaintext      string   `json:"plaintext"`
		ExpectedStored string   `json:"expected_stored"`
		Sides          []string `json:"sides"`
	} `json:"positive"`
	Negative []struct {
		ID            string   `json:"id"`
		Stored        string   `json:"stored"`
		Context       string   `json:"context"`
		WorkspaceID   string   `json:"workspace_id"`
		ExpectedError string   `json:"expected_error"`
		Sides         []string `json:"sides"`
	} `json:"negative"`
}

type CryptoRunner struct {
	Init func(secretKey string) error
	// Decrypt je jediná operace, kterou sender má. Šifruje aplikace.
	Decrypt func(stored, expectedContext, workspaceID string) ([]byte, error)
	// ErrorCode přeloží chybu produkčního balíčku na kontraktní kód. Runner
	// nezná taxonomii chyb P09, takže překlad dodává adaptér.
	ErrorCode func(err error) string
}

// CheckCryptoGolden u pozitivního vektoru ověřuje, že Go přečte obálku, kterou
// zapsal TypeScript. Bajtová shoda při šifrování se v Go netestuje, protože
// sender šifrovat neumí; tu drží TypeScript strana proti závaznému vektoru.
func CheckCryptoGolden(raw []byte, runner CryptoRunner) (Outcome, error) {
	var v cryptoVectors
	if err := json.Unmarshal(raw, &v); err != nil {
		return Outcome{}, fmt.Errorf("fixtures nejdou naparsovat: %w", err)
	}
	if err := runner.Init(v.SecretKey); err != nil {
		return Outcome{}, fmt.Errorf("keyring z fixture: %w", err)
	}

	outcome := Outcome{}
	for _, vec := range v.Positive {
		if !hasSide(vec.Sides, "go") {
			continue
		}
		outcome.Total++
		plain, err := runner.Decrypt(vec.ExpectedStored, vec.Context, vec.WorkspaceID)
		if err != nil {
			outcome.Mismatches = append(outcome.Mismatches, Mismatch{vec.ID,
				"dešifrování obálky z TypeScriptu selhalo: " + err.Error()})
			continue
		}
		if string(plain) != vec.Plaintext {
			outcome.Mismatches = append(outcome.Mismatches, Mismatch{vec.ID,
				fmt.Sprintf("plaintext se rozešel\n  Go: %q\n  TS: %q", string(plain), vec.Plaintext)})
			continue
		}
		outcome.IDs = append(outcome.IDs, vec.ID)
	}
	for _, vec := range v.Negative {
		if !hasSide(vec.Sides, "go") {
			continue
		}
		outcome.Total++
		if _, err := runner.Decrypt(vec.Stored, vec.Context, vec.WorkspaceID); err == nil {
			outcome.Mismatches = append(outcome.Mismatches, Mismatch{vec.ID, "dešifrování mělo selhat"})
			continue
		} else if code := runner.ErrorCode(err); code != vec.ExpectedError {
			outcome.Mismatches = append(outcome.Mismatches, Mismatch{vec.ID,
				fmt.Sprintf("kód se rozešel: %s, čekal se %s", code, vec.ExpectedError)})
			continue
		}
		outcome.IDs = append(outcome.IDs, vec.ID)
	}
	return outcome, nil
}

func RunCryptoGolden(t *testing.T, runner CryptoRunner) {
	t.Helper()
	raw, err := ReadFixture("crypto/vectors.json")
	if err != nil {
		t.Fatalf("fixtures nejdou přečíst: %v", err)
	}
	outcome, err := CheckCryptoGolden(raw, runner)
	if err != nil {
		t.Fatalf("%v", err)
	}
	finish(t, "crypto", outcome, []string{"vectors.json"})
}

// ----------------------------------------------------------------- Message-ID --

type messageIDVectors struct {
	Cases []struct {
		ID             string   `json:"id"`
		MessageID      string   `json:"message_id"`
		SendingDomain  string   `json:"sending_domain"`
		ExpectedHeader string   `json:"expected_header"`
		Sides          []string `json:"sides"`
	} `json:"cases"`
}

type MessageIDRunner struct {
	Build func(messageID, sendingDomain string) (string, error)
}

func CheckMessageIDGolden(raw []byte, runner MessageIDRunner) (Outcome, error) {
	var v messageIDVectors
	if err := json.Unmarshal(raw, &v); err != nil {
		return Outcome{}, fmt.Errorf("fixtures nejdou naparsovat: %w", err)
	}
	outcome := Outcome{}
	for _, vec := range v.Cases {
		if !hasSide(vec.Sides, "go") {
			continue
		}
		outcome.Total++
		first, err := runner.Build(vec.MessageID, vec.SendingDomain)
		if err != nil {
			outcome.Mismatches = append(outcome.Mismatches, Mismatch{vec.ID, "build selhal: " + err.Error()})
			continue
		}
		if first != vec.ExpectedHeader {
			outcome.Mismatches = append(outcome.Mismatches, Mismatch{vec.ID,
				fmt.Sprintf("Message-ID se rozešel s TypeScript stranou\n  Go: %s\n  TS: %s",
					first, vec.ExpectedHeader)})
			continue
		}
		// OB-11: dva pokusy téže zprávy dají identický řetězec.
		second, err := runner.Build(vec.MessageID, vec.SendingDomain)
		if err != nil || first != second {
			outcome.Mismatches = append(outcome.Mismatches, Mismatch{vec.ID,
				"OB-11: dva pokusy dají různý Message-ID"})
			continue
		}
		outcome.IDs = append(outcome.IDs, vec.ID)
	}
	return outcome, nil
}

func RunMessageIDGolden(t *testing.T, runner MessageIDRunner) {
	t.Helper()
	raw, err := ReadFixture("message-id/vectors.json")
	if err != nil {
		t.Fatalf("fixtures nejdou přečíst: %v", err)
	}
	outcome, err := CheckMessageIDGolden(raw, runner)
	if err != nil {
		t.Fatalf("%v", err)
	}
	finish(t, "message-id", outcome, []string{"vectors.json"})
}
```

- [ ] **Krok 4: Napiš test runnerů, který nečeká na P09**

Runner sám je kód a může mít chybu. Testuje se proto jeho čistá část, a to proti **záměrně chybné** implementaci: runner, který takovou implementaci propustí, je horší než žádný.

`apps/sender/internal/contracts/golden_test.go`:

```go
package contracts

import (
	"errors"
	"testing"
)

func TestFixturesDigestNezavisiNaPoradiAReagujeNaZmenu(t *testing.T) {
	names, err := ListFixtures("liquid")
	if err != nil {
		t.Fatalf("seznam fixtures: %v", err)
	}
	if len(names) == 0 {
		t.Fatal("adresář liquid je prázdný, otisk by nic neznamenal")
	}
	first, err := FixturesDigest("liquid", names)
	if err != nil {
		t.Fatalf("otisk: %v", err)
	}
	reversed := make([]string, len(names))
	for i, name := range names {
		reversed[len(names)-1-i] = name
	}
	second, err := FixturesDigest("liquid", reversed)
	if err != nil {
		t.Fatalf("otisk podruhé: %v", err)
	}
	if first != second {
		t.Fatal("otisk závisí na pořadí, což by dělalo paritu náhodnou")
	}
	partial, err := FixturesDigest("liquid", names[:len(names)-1])
	if err != nil {
		t.Fatalf("otisk podmnožiny: %v", err)
	}
	if partial == first {
		t.Fatal("otisk se nezměnil po vynechání souboru, takže nic nehlídá")
	}
}

func TestCheckTokenGoldenOdhaliRozchod(t *testing.T) {
	raw, err := ReadFixture("token/vectors.json")
	if err != nil {
		t.Fatalf("fixtures: %v", err)
	}
	outcome, err := CheckTokenGolden(raw, TokenRunner{
		Init: func(string) error { return nil },
		Build: func(string, uint8, map[string]any) (string, []byte, error) {
			return "t1TOHLE_JE_SPATNE", []byte{0xde, 0xad}, nil
		},
	})
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if len(outcome.Mismatches) == 0 {
		t.Fatal("runner přijal implementaci, která vrací jiný token")
	}
	if len(outcome.IDs) != 0 {
		t.Fatalf("runner započítal %d fixtur, které se rozešly", len(outcome.IDs))
	}
	if outcome.Total == 0 {
		t.Fatal("žádný vektor nemá sides go, parita by byla prázdná")
	}
}

func TestCheckCryptoGoldenOdhaliTichyUspech(t *testing.T) {
	raw, err := ReadFixture("crypto/vectors.json")
	if err != nil {
		t.Fatalf("fixtures: %v", err)
	}
	// Implementace, která NIKDY neselže. Negativní vektory ji musí odhalit.
	outcome, err := CheckCryptoGolden(raw, CryptoRunner{
		Init:      func(string) error { return nil },
		Decrypt:   func(string, string, string) ([]byte, error) { return []byte("cokoliv"), nil },
		ErrorCode: func(err error) string { return err.Error() },
	})
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if len(outcome.Mismatches) < 8 {
		t.Fatalf("runner propustil implementaci bez chyb, neshod je jen %d", len(outcome.Mismatches))
	}
	if code := (CryptoRunner{ErrorCode: func(err error) string { return err.Error() }}).
		ErrorCode(errors.New("crypto_unknown_key")); code != "crypto_unknown_key" {
		t.Fatal("překlad chyby na kontraktní kód nefunguje")
	}
}
```

Run: `cd apps/sender && go vet ./internal/contracts/ && go test ./internal/contracts/ -v`
Expected: PASS, tři testy. Je to celý Go rozsah vlny 0: runnery jsou hotové a otestované, produkční kód pod nimi dodá P09.

- [ ] **Krok 5: Zapiš do plánu volání, které dodá P09**

Tyhle soubory zakládá **P09**, ne tenhle plán (požadavek P02→P09.1). Jsou tady vypsané doslova, aby si je P09 nevymýšlel a aby bylo vidět, že runnery na produkční kód opravdu sedí. Importní cesta je `github.com/nc-mill/mlain/apps/sender/...`, tedy modul založený v P01; P09 svůj `go mod init` s jinou cestou vypustí.

`apps/sender/internal/token/golden_test.go` (vlastní P09):

```go
package token_test

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/nc-mill/mlain/apps/sender/internal/contracts"
	"github.com/nc-mill/mlain/apps/sender/internal/keyring"
	"github.com/nc-mill/mlain/apps/sender/internal/token"
)

func TestGoldenTokens(t *testing.T) {
	var builder *token.Builder
	contracts.RunTokenGolden(t, contracts.TokenRunner{
		Init: func(secretKey string) error {
			kr, err := keyring.Parse(secretKey, "")
			if err != nil {
				return err
			}
			builder, err = token.NewBuilder(kr)
			return err
		},
		Build: func(typ string, keyID uint8, fields map[string]any) (string, []byte, error) {
			id := func(name string) uuid.UUID { return uuid.MustParse(fields[name].(string)) }
			at := time.Unix(int64(fields["message_created_at"].(float64)), 0).UTC()
			switch typ {
			case "o":
				return builder.OpenWithMAC(id("workspace_id"), id("message_id"), at)
			case "c":
				return builder.ClickWithMAC(id("workspace_id"), id("message_id"), id("link_id"), at)
			case "u":
				return builder.UnsubscribeWithMAC(
					id("workspace_id"), id("message_id"), id("contact_id"), id("list_id"), at)
			default:
				t.Fatalf("typ %q nemá na Go straně stavitele; fixture ho nesmí mít v sides", typ)
				return "", nil, nil
			}
		},
	})
}
```

Runner potřebuje kromě řetězce i **plnou HMAC před zkrácením**, protože kontrakt ji v tabulce vektorů uvádí jako závaznou. Dnešní `Builder` ji zahazuje uvnitř `assemble`. P09 proto vystaví varianty `OpenWithMAC`, `ClickWithMAC` a `UnsubscribeWithMAC`, které vrací `(string, []byte, error)`; stávající tři metody zůstávají a volají je. Je to požadavek P02→P09.1 a je to levnější než vypustit z fixture hodnotu, kterou kontrakt označuje za závaznou.

`apps/sender/internal/credentials/golden_test.go` (vlastní P09):

```go
package credentials_test

import (
	"errors"
	"testing"

	"github.com/google/uuid"
	"github.com/nc-mill/mlain/apps/sender/internal/contracts"
	"github.com/nc-mill/mlain/apps/sender/internal/credentials"
	"github.com/nc-mill/mlain/apps/sender/internal/keyring"
)

func TestGoldenCrypto(t *testing.T) {
	var kr *keyring.Keyring
	contracts.RunCryptoGolden(t, contracts.CryptoRunner{
		Init: func(secretKey string) error {
			var err error
			kr, err = keyring.Parse(secretKey, "")
			return err
		},
		Decrypt: func(stored, expectedContext, workspaceID string) ([]byte, error) {
			ws, err := uuid.Parse(workspaceID)
			if err != nil {
				return nil, err
			}
			return credentials.Decrypt(kr, stored, expectedContext, ws)
		},
		// Sentinely balíčku nesou kontraktní kód jako text, takže překlad je
		// jen mapa. Kdyby se text změnil, spadne tenhle překlad, ne fixture.
		ErrorCode: func(err error) string {
			for code, sentinel := range map[string]error{
				"crypto_envelope_malformed":  credentials.ErrMalformed,
				"crypto_unsupported_version": credentials.ErrUnsupportedVersion,
				"crypto_context_mismatch":    credentials.ErrContextMismatch,
				"crypto_unknown_key":         credentials.ErrUnknownKey,
				"crypto_auth_failed":         credentials.ErrAuthFailed,
			} {
				if errors.Is(err, sentinel) {
					return code
				}
			}
			return "neznámá chyba: " + err.Error()
		},
	})
}
```

Sentinel se dnes v P09 jmenuje `ErrUnsupportedVersio`, tedy s vypadlým „n". Je to překlep, ne záměr, a je součástí požadavku P02→P09.1.

`apps/sender/internal/mimebuild/golden_test.go` (vlastní P09):

```go
package mimebuild_test

import (
	"testing"

	"github.com/google/uuid"
	"github.com/nc-mill/mlain/apps/sender/internal/contracts"
	"github.com/nc-mill/mlain/apps/sender/internal/mimebuild"
)

func TestGoldenMessageID(t *testing.T) {
	contracts.RunMessageIDGolden(t, contracts.MessageIDRunner{
		Build: func(messageID, sendingDomain string) (string, error) {
			parsed, err := uuid.Parse(messageID)
			if err != nil {
				return "", err
			}
			return mimebuild.MessageID(parsed, sendingDomain), nil
		},
	})
}
```

- [ ] **Krok 6: Commit**

```bash
git add apps/sender/internal/contracts
git commit -m "feat(contracts): Go runnery kontraktů 3, 4 a Message-ID nad společnými fixtures"
```

---

### Úkol 12: Kontrakt 2, gramatika a validátor

Validátor je vlastní rekurzivně sestupný parser, ne jedna z knihoven. Kdybychom validovali LiquidJS, propustili bychom všechno, co umí LiquidJS a neumí Go. Kdybychom validovali `osteele/liquid`, měli bychom validátor ve špatném jazyce a ve špatném procesu, protože v editoru musí odpovědět do 20 ms na každý úhoz. Podle části 3, kapitoly 3.7.1 žije v `packages/contracts/src/liquid/` a je **jediným místem, které rozhoduje, co je platná šablona**.

**Files:**
- Create: `packages/contracts/src/liquid/grammar.ts`
- Create: `packages/contracts/src/liquid/validator.ts`
- Test: `packages/contracts/test/liquid.validator.test.ts`

- [ ] **Krok 1: Napiš padající test gramatiky a limitů**

`packages/contracts/test/liquid.validator.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { LIQUID_LIMITS, ALLOWED_FILTERS, ALLOWED_ROOTS, DATE_FORMAT_WHITELIST } from '../src/liquid/grammar.js';
import { validateLiquid } from '../src/liquid/validator.js';

const ctx = {
  level: 'authored' as const,
  template_kind: 'campaign' as const,
  fields: { contactFirstClass: ['first_name', 'greeting', 'city', 'is_vip', 'age', 'tags'], contactAttrKeys: ['city'] },
};

const codes = (source: string, level: 'authored' | 'compiled' = 'authored'): string[] =>
  validateLiquid(source, { ...ctx, level }).issues.map((issue) => issue.code);

describe('gramatika kontraktu 4.10.2', () => {
  it('má pět filtrů a pět formátů data', () => {
    expect(ALLOWED_FILTERS).toEqual(['default', 'upcase', 'downcase', 'date', 'escape']);
    expect(DATE_FORMAT_WHITELIST).toEqual(['%d.%m.%Y', '%-d.%-m.%Y', '%Y-%m-%d', '%d.%m.%Y %H:%M', '%H:%M']);
    expect(LIQUID_LIMITS).toEqual({
      nestingDepth: 3, loops: 5, iterations: 200, pathSegments: 3,
      templateBytes: 512 * 1024, outputs: 500, renderMs: 50,
    });
    expect(ALLOWED_ROOTS).toContain('contact');
    expect(ALLOWED_ROOTS).toContain('workspace');
    expect(ALLOWED_ROOTS).not.toContain('_context');
  });
});

describe('validátor přijímá to, co má', () => {
  it.each([
    'Dobrý den, {{ contact.first_name }}!',
    '{{ contact.attr.city }}',
    '{% if contact.is_vip %}VIP{% endif %}',
    '{% unless contact.is_vip %}běžný{% endunless %}',
    '{% if contact.is_vip %}A{% elsif contact.city %}B{% else %}C{% endif %}',
    '{% for tag in contact.tags %}{{ tag }}{% endfor %}',
    '{{ contact.first_name | default }}',
    '{{ contact.first_name | upcase }}',
  ])('přijme %s', (source) => {
    expect(validateLiquid(source, ctx).ok).toBe(true);
  });

  it('přijme argument filtru v KOMPILOVANÉ šabloně', () => {
    expect(validateLiquid('{{ contact.first_name | default: "kolego" }}', { ...ctx, level: 'compiled' }).ok).toBe(true);
    expect(validateLiquid('{{ contact.city | date: "%d.%m.%Y" }}', { ...ctx, level: 'compiled' }).ok).toBe(true);
  });

  it('přijme _present jen v kompilované šabloně', () => {
    expect(validateLiquid('{% if _present.contact__city %}x{% endif %}', { ...ctx, level: 'compiled' }).ok).toBe(true);
    expect(codes('{% if _present.contact__city %}x{% endif %}')).toContain('liquid_unknown_root');
  });
});

describe('validátor odmítá to, co má', () => {
  it.each([
    ['{% assign x = 1 %}', 'liquid_tag_not_allowed'],
    ['{% capture x %}y{% endcapture %}', 'liquid_tag_not_allowed'],
    ['{% case x %}{% endcase %}', 'liquid_tag_not_allowed'],
    ['{% raw %}x{% endraw %}', 'liquid_tag_not_allowed'],
    ['{% comment %}x{% endcomment %}', 'liquid_tag_not_allowed'],
    ['{{- contact.first_name -}}', 'liquid_whitespace_control_not_allowed'],
    ['{{ contact.first_name | reverse }}', 'liquid_filter_not_allowed'],
    ['{{ contact.first_name | vocative }}', 'liquid_vocative_filter'],
    ['{% if contact.tags contains 1 %}x{% endif %}', 'liquid_contains_not_allowed'],
    ['{% if (contact.is_vip) %}x{% endif %}', 'liquid_parentheses_not_allowed'],
    ['{% for a in contact.tags %}{% for b in contact.tags %}{% endfor %}{% endfor %}', 'liquid_nested_for'],
    ['{% for a in contact.tags limit: 2 %}{% endfor %}', 'liquid_for_parameter_not_allowed'],
    ['{{ contact.tags[0] }}', 'liquid_index_not_allowed'],
    ['{{ contact.first_name | default: "kolego" }}', 'liquid_string_literal_not_allowed'],
    ["{% if contact.city == 'CZ' %}x{% endif %}", 'liquid_string_literal_not_allowed'],
    ['{% if contact.age > 5 %}x{% endif %}', 'liquid_comparison_operator_not_supported'],
    ['{{ contact.a.b.c.d }}', 'liquid_path_too_deep'],
    ['{% if contact.city == blank %}x{% endif %}', 'liquid_literal_not_supported'],
    ['{% if contact.tags == empty %}x{% endif %}', 'liquid_literal_not_supported'],
    ['{{ neznamy.koren }}', 'liquid_unknown_root'],
    ['{{ contact.neexistuje }}', 'liquid_unknown_field'],
    ['{{ contact.First_Name }}', 'liquid_identifier_case'],
    ['{% if contact.is_vip %}x', 'liquid_unbalanced_block'],
    ['{{ _context.timezone }}', 'liquid_unknown_root'],
  ])('odmítne %s kódem %s', (source, code) => {
    const result = validateLiquid(source, ctx);
    expect(result.ok).toBe(false);
    expect(result.issues.map((i) => i.code)).toContain(code);
  });

  it('odmítne HTML entitu uvnitř konstrukce v kompilované šabloně', () => {
    expect(codes('{{ contact.first_name | default: &quot;kolego&quot; }}', 'compiled')).toContain(
      'liquid_escaped_entity_in_construct',
    );
  });

  it('odmítne formát data mimo whitelist', () => {
    expect(codes('{{ contact.city | date: "%B %Y" }}', 'compiled')).toContain('liquid_date_format_not_allowed');
  });

  it.each([
    ['{% if contact.is_vip %}'.repeat(4) + 'x' + '{% endif %}'.repeat(4), 'liquid_nesting_too_deep'],
    ['{% for t in contact.tags %}{% endfor %}'.repeat(6), 'liquid_too_many_loops'],
  ])('vynutí limit %#', (source, code) => {
    expect(codes(source)).toContain(code);
  });

  it('vynutí limit 500 výstupů a 512 kB', () => {
    expect(codes('{{ contact.first_name }}'.repeat(501))).toContain('liquid_too_many_outputs');
    expect(codes('x'.repeat(512 * 1024 + 1))).toContain('liquid_template_too_large');
  });
});

describe('varování a informace', () => {
  it('escape dá informační hlášku, ne chybu', () => {
    const result = validateLiquid('{{ contact.first_name | escape }}', ctx);
    expect(result.ok).toBe(true);
    expect(result.issues[0].code).toBe('liquid_escape_not_needed');
    expect(result.issues[0].severity).toBe('info');
  });

  it('past prázdného řetězce nabídne akci v panelu vlastností, ne náhradní text', () => {
    const result = validateLiquid('{% if contact.city %}x{% endif %}', ctx);
    expect(result.ok).toBe(true);
    const warning = result.issues.find((i) => i.code === 'liquid_truthy_string_warning');
    expect(warning?.severity).toBe('warning');
    expect(warning?.suggestion).toMatchObject({ kind: 'set_visibility', field: 'contact.city', op: 'present' });
  });

  it('hlásí pozici na řádek a sloupec', () => {
    const result = validateLiquid('první řádek\n{% assign x = 1 %}', ctx);
    expect(result.issues[0].span.line).toBe(2);
    expect(result.issues[0].span.col).toBe(1);
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/contracts exec vitest run --project unit test/liquid.validator.test.ts`
Expected: FAIL, `Cannot find module '../src/liquid/grammar.js'`.

- [ ] **Krok 3: Napiš `src/liquid/grammar.ts`**

```ts
/**
 * Kontrakt 2: Liquid subset (část 1, 4.10.2). ZMRAZENO.
 *
 * Knihovny nám dávají tokenizer, parser a řízení toku, nic víc. Ani jeden
 * vestavěný filtr se nepoužívá: obě strany registrují vlastních pět se stejnou
 * definicí, takže se plocha rozporu smrskne na věci, které jsou v Shopify
 * Liquidu dobře definované a obě knihovny je implementují shodně.
 */

export const ALLOWED_FILTERS = ['default', 'upcase', 'downcase', 'date', 'escape'] as const;
export type AllowedFilter = (typeof ALLOWED_FILTERS)[number];

/** Tři tagy, ne čtyři: `if` včetně `elsif` a `else`, `unless`, `for`. */
export const ALLOWED_TAGS = ['if', 'elsif', 'else', 'endif', 'unless', 'endunless', 'for', 'endfor'] as const;

export const DATE_FORMAT_WHITELIST = ['%d.%m.%Y', '%-d.%-m.%Y', '%Y-%m-%d', '%d.%m.%Y %H:%M', '%H:%M'] as const;
export type AllowedDateFormat = (typeof DATE_FORMAT_WHITELIST)[number];

export const LIQUID_LIMITS = Object.freeze({
  nestingDepth: 3,
  loops: 5,
  iterations: 200,
  pathSegments: 3,
  templateBytes: 512 * 1024,
  outputs: 500,
  renderMs: 50,
});

/** Kořenové proměnné, které sender zaručeně najde v render_data. */
export const ALLOWED_ROOTS = [
  'contact', 'campaign', 'workspace',
  'unsubscribe_url', 'one_click_unsubscribe_url', 'preferences_url', 'webview_url',
] as const;

/**
 * `_present.<slug>` je kořen pro podmíněné zobrazení bloku. Autor ho nikdy
 * nepíše a validátor autorské šablony ho odmítá stejně jako `_context`.
 * Vzniká výhradně kompilací z vlastnosti bloku `visibleWhen`.
 */
export const COMPILED_ONLY_ROOTS = ['_present'] as const;

/** Interní kořeny, které validátor zakazuje v šabloně vždy. */
export const INTERNAL_ROOTS = ['_context'] as const;

export const COMPARISON_OPERATORS = ['==', '!=', '>', '<', '>=', '<='] as const;
/** Escapováním nedotčené operátory. Zbytek je do rozhodnutí blokující chyba. */
export const SUPPORTED_COMPARISON_OPERATORS = ['==', '!='] as const;

export const ALLOWED_LITERALS = ['true', 'false', 'nil'] as const;
/**
 * `blank` a `empty` gramatika kontraktu povoluje, ale `osteele/liquid` je nezná
 * (nález K4 části 4b), takže by se render mezi knihovnami rozešel. Validátor je
 * proto odmítá; podmínku "pole není prázdné" řeší vlastnost bloku `visibleWhen`
 * nad mapou `_present`, ne text v šabloně.
 */
export const UNSUPPORTED_LITERALS = ['blank', 'empty'] as const;

/** HTML entity, které v kompilované šabloně uvnitř konstrukce znamenají chybu. */
export const HTML_ENTITIES_IN_CONSTRUCT = ['&quot;', '&#39;', '&lt;', '&gt;', '&amp;'] as const;

/** Pevné escapování v HTML kontextu. Nic jiného se nemění. */
export const HTML_ESCAPE_MAP: Readonly<Record<string, string>> = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
});

export const DEFAULT_VALUE_FORBIDDEN_CHARS = ['"', "'", '{', '}', '<', '>'] as const;
```

- [ ] **Krok 4: Napiš `src/liquid/validator.ts`**

Tokenizér skenuje zdroj indexy, ne regulárním výrazem se stavem. Je to čitelnější a hlavně to nedovolí, aby se pozice ztratila mezi dvěma průchody.

```ts
import {
  ALLOWED_FILTERS, ALLOWED_ROOTS, COMPILED_ONLY_ROOTS, DATE_FORMAT_WHITELIST,
  DEFAULT_VALUE_FORBIDDEN_CHARS, HTML_ENTITIES_IN_CONSTRUCT, INTERNAL_ROOTS,
  LIQUID_LIMITS, SUPPORTED_COMPARISON_OPERATORS, UNSUPPORTED_LITERALS,
} from './grammar.js';

export type SourceSpan = { start: number; end: number; line: number; col: number };

export type LiquidIssue = {
  code: string;
  severity: 'error' | 'warning' | 'info';
  span: SourceSpan;
  pointer?: string;
  params?: Record<string, string | number>;
  suggestion?:
    | { kind: 'replace'; replace_with: string; label: string }
    | { kind: 'set_visibility'; block_id: string; field: string; op: 'present' | 'blank'; label: string };
};

export type LiquidAstNode =
  | { type: 'text'; value: string }
  | { type: 'output'; expr: string }
  | { type: 'tag'; name: string; body: string };

export type LiquidAst = { nodes: LiquidAstNode[] };

/**
 * Úzký seznam povolených cest kontaktu, který validátor potřebuje k rozhodnutí
 * "tohle pole existuje". NENÍ to katalog polí: ten je bohatý, má cesty, typy
 * a popisky, vlastní ho P07 a jmenuje se `FieldCatalog`. Dřív se tenhle typ
 * jmenoval taky `FieldCatalog`, takže dvě neslučitelné věci nesly jedno jméno
 * a P08, P07 i P12 jím myslely tu druhou (rozhodnutí R2). Přejmenováno na
 * `LiquidRoots`; P07 svůj katalog na tenhle tvar zúží jednou funkcí.
 */
export type LiquidRoots = { contactFirstClass: readonly string[]; contactAttrKeys: readonly string[] };

export type LiquidLevel = 'authored' | 'compiled';

export type LiquidContext = {
  level: LiquidLevel;
  template_kind?: 'campaign' | 'transactional' | 'system';
  fields?: LiquidRoots;
  roots?: readonly string[];
  /** JSON pointer na uzel dokumentu, doplňuje ho volající */
  pointer?: string;
  /** id bloku pro akci "nastavit podmínku v panelu vlastností" */
  block_id?: string;
};

export type LiquidValidationResult =
  | { ok: true; issues: LiquidIssue[]; ast: LiquidAst }
  | { ok: false; issues: LiquidIssue[] };

const BLOCK_TAGS = new Set(['if', 'unless', 'for']);
const CLOSING_TAGS: Record<string, string> = { endif: 'if', endunless: 'unless', endfor: 'for' };
const BRANCH_TAGS = new Set(['elsif', 'else']);
const IDENT = /^[a-z_][a-z0-9_]*$/;

export function validateLiquid(source: string, ctx: LiquidContext): LiquidValidationResult {
  const issues: LiquidIssue[] = [];
  const nodes: LiquidAstNode[] = [];
  const roots = new Set<string>([
    ...(ctx.roots ?? ALLOWED_ROOTS),
    ...(ctx.level === 'compiled' ? COMPILED_ONLY_ROOTS : []),
  ]);

  const spanAt = (start: number, end: number): SourceSpan => {
    const before = source.slice(0, start);
    const line = before.split('\n').length;
    const col = start - (before.lastIndexOf('\n') + 1) + 1;
    return { start, end, line, col };
  };
  const push = (
    code: string,
    start: number,
    end: number,
    severity: LiquidIssue['severity'] = 'error',
    extra: Partial<LiquidIssue> = {},
  ): void => {
    issues.push({ code, severity, span: spanAt(start, end), pointer: ctx.pointer, ...extra });
  };

  if (Buffer.byteLength(source, 'utf8') > LIQUID_LIMITS.templateBytes) {
    push('liquid_template_too_large', 0, source.length);
    return { ok: false, issues };
  }

  const stack: Array<{ name: string; start: number; loopVar?: string }> = [];
  let outputs = 0;
  let loops = 0;
  let maxConditionDepth = 0;
  let conditionDepth = 0;
  let forDepth = 0;
  let cursor = 0;

  while (cursor < source.length) {
    const outputStart = source.indexOf('{{', cursor);
    const tagStart = source.indexOf('{%', cursor);
    if (outputStart === -1 && tagStart === -1) break;

    const isOutput = tagStart === -1 || (outputStart !== -1 && outputStart < tagStart);
    const start = isOutput ? outputStart : tagStart;
    const closeMark = isOutput ? '}}' : '%}';
    const closeIndex = source.indexOf(closeMark, start + 2);
    if (closeIndex === -1) {
      push('liquid_unbalanced_block', start, source.length, 'error', {
        params: { tag: source.slice(start, start + 2) },
      });
      return { ok: false, issues };
    }
    const end = closeIndex + 2;

    if (source[start + 2] === '-') push('liquid_whitespace_control_not_allowed', start, start + 3);
    if (source[closeIndex - 1] === '-') push('liquid_whitespace_control_not_allowed', closeIndex - 1, end);

    const inner = source
      .slice(start + 2, closeIndex)
      .replace(/^-/, '')
      .replace(/-$/, '');

    nodes.push({ type: 'text', value: source.slice(cursor, start) });
    cursor = end;

    if (ctx.level === 'compiled') {
      for (const entity of HTML_ENTITIES_IN_CONSTRUCT) {
        if (inner.includes(entity)) {
          push('liquid_escaped_entity_in_construct', start, end, 'error', { params: { entity } });
        }
      }
    }

    if (isOutput) {
      outputs += 1;
      nodes.push({ type: 'output', expr: inner.trim() });
      validateOutput(inner, start, end);
    } else {
      nodes.push({ type: 'tag', name: inner.trim().split(/\s+/)[0] ?? '', body: inner.trim() });
      validateTag(inner, start, end);
    }
  }
  nodes.push({ type: 'text', value: source.slice(cursor) });

  if (outputs > LIQUID_LIMITS.outputs) push('liquid_too_many_outputs', 0, source.length, 'error', { params: { outputs } });
  if (loops > LIQUID_LIMITS.loops) push('liquid_too_many_loops', 0, source.length, 'error', { params: { loops } });
  if (maxConditionDepth > LIQUID_LIMITS.nestingDepth) {
    push('liquid_nesting_too_deep', 0, source.length, 'error', { params: { depth: maxConditionDepth } });
  }
  for (const open of stack) {
    push('liquid_unbalanced_block', open.start, source.length, 'error', {
      params: { tag: open.name, expected: `end${open.name}` },
    });
  }

  const hasError = issues.some((issue) => issue.severity === 'error');
  return hasError ? { ok: false, issues } : { ok: true, issues, ast: { nodes } };

  function validateOutput(inner: string, start: number, end: number): void {
    const parts = splitFilters(inner);
    validatePath(parts.expr.trim(), start, end);
    for (const filter of parts.filters) {
      const colon = filter.indexOf(':');
      const name = (colon === -1 ? filter : filter.slice(0, colon)).trim();
      const argument = colon === -1 ? undefined : filter.slice(colon + 1).trim();

      if (name === 'vocative') {
        push('liquid_vocative_filter', start, end, 'error', {
          params: { filter: name },
          suggestion: { kind: 'replace', replace_with: '{{ contact.first_name_vocative }}', label: '5. pád' },
        });
        continue;
      }
      if (!(ALLOWED_FILTERS as readonly string[]).includes(name)) {
        push('liquid_filter_not_allowed', start, end, 'error', { params: { filter: name } });
        continue;
      }
      if (name === 'escape') push('liquid_escape_not_needed', start, end, 'info');
      if (argument === undefined) continue;

      if (ctx.level === 'authored') {
        push('liquid_string_literal_not_allowed', start, end, 'error', { params: { filter: name } });
        push('liquid_filter_argument_not_allowed', start, end, 'error', { params: { filter: name } });
        continue;
      }
      if (name !== 'default' && name !== 'date') {
        push('liquid_filter_argument_not_allowed', start, end, 'error', { params: { filter: name } });
        continue;
      }
      const literal = argument.match(/^"([^"]*)"$/);
      if (!literal) {
        push('liquid_filter_argument_not_allowed', start, end, 'error', { params: { filter: name } });
        continue;
      }
      if (name === 'date' && !(DATE_FORMAT_WHITELIST as readonly string[]).includes(literal[1])) {
        push('liquid_date_format_not_allowed', start, end, 'error', { params: { format: literal[1] } });
      }
      if (name === 'default' && DEFAULT_VALUE_FORBIDDEN_CHARS.some((ch) => literal[1].includes(ch))) {
        push('liquid_default_value_invalid', start, end, 'error', { params: { value: literal[1] } });
      }
    }
  }

  function validateTag(inner: string, start: number, end: number): void {
    const trimmed = inner.trim();
    const name = trimmed.split(/\s+/)[0] ?? '';
    const rest = trimmed.slice(name.length).trim();

    if (CLOSING_TAGS[name]) {
      const opened = stack.pop();
      if (!opened || opened.name !== CLOSING_TAGS[name]) {
        push('liquid_unbalanced_block', start, end, 'error', { params: { tag: name } });
        return;
      }
      if (opened.name === 'for') {
        forDepth -= 1;
        // Iterační proměnná platí jen uvnitř svého cyklu. Bez tohohle řádku by
        // `{{ tag }}` prošlo i za `{% endfor %}`.
        if (opened.loopVar !== undefined) roots.delete(opened.loopVar);
      } else {
        conditionDepth -= 1;
      }
      return;
    }
    if (BRANCH_TAGS.has(name)) {
      if (name === 'elsif') validateCondition(rest, start, end);
      return;
    }
    if (!BLOCK_TAGS.has(name)) {
      push('liquid_tag_not_allowed', start, end, 'error', { params: { tag: name } });
      return;
    }

    const frame: { name: string; start: number; loopVar?: string } = { name, start };
    stack.push(frame);
    if (name === 'for') {
      loops += 1;
      forDepth += 1;
      if (forDepth > 1) push('liquid_nested_for', start, end);
      const forMatch = rest.match(/^([a-z_][a-z0-9_]*)\s+in\s+(\S+)\s*(.*)$/);
      if (!forMatch) {
        push('liquid_unbalanced_block', start, end, 'error', { params: { tag: 'for' } });
        return;
      }
      // Iterační proměnná je kořen jen po dobu těla cyklu. Jméno se ukládá do
      // položky zásobníku, aby ho endfor uměl odebrat i u vnořených konstrukcí.
      frame.loopVar = forMatch[1];
      roots.add(forMatch[1]);
      if (forMatch[3].trim() !== '') {
        push('liquid_for_parameter_not_allowed', start, end, 'error', {
          params: { param: forMatch[3].trim().split(/[:\s]/)[0] },
        });
      }
      validatePath(forMatch[2], start, end);
      return;
    }
    conditionDepth += 1;
    maxConditionDepth = Math.max(maxConditionDepth, conditionDepth);
    validateCondition(rest, start, end);
  }

  function validateCondition(condition: string, start: number, end: number): void {
    if (/[()]/.test(condition)) {
      push('liquid_parentheses_not_allowed', start, end);
      return;
    }
    if (/\bcontains\b/.test(condition)) {
      push('liquid_contains_not_allowed', start, end);
      return;
    }
    if (/["']/.test(condition)) {
      push('liquid_string_literal_not_allowed', start, end);
      return;
    }
    for (const literal of UNSUPPORTED_LITERALS) {
      if (new RegExp(`\\b${literal}\\b`).test(condition)) {
        push('liquid_literal_not_supported', start, end, 'error', { params: { literal } });
      }
    }
    const operators = condition.match(/(>=|<=|==|!=|>|<)/g) ?? [];
    for (const operator of operators) {
      if (!(SUPPORTED_COMPARISON_OPERATORS as readonly string[]).includes(operator)) {
        push('liquid_comparison_operator_not_supported', start, end, 'error', { params: { op: operator } });
      }
    }
    for (const operand of condition.split(/\s+(?:and|or)\s+|\s*(?:>=|<=|==|!=|>|<)\s*/)) {
      const token = operand.trim();
      if (token === '' || /^-?\d+(\.\d+)?$/.test(token) || ['true', 'false', 'nil'].includes(token)) continue;
      if ((UNSUPPORTED_LITERALS as readonly string[]).includes(token)) continue;
      validatePath(token, start, end);
      if (operators.length === 0 && token.startsWith('contact.')) {
        push('liquid_truthy_string_warning', start, end, 'warning', {
          params: { path: token },
          suggestion: {
            kind: 'set_visibility',
            block_id: ctx.block_id ?? '',
            field: token,
            op: 'present',
            label: 'Nastavit podmínku v panelu vlastností',
          },
        });
      }
    }
  }

  function validatePath(path: string, start: number, end: number): void {
    if (path === '') return;
    if (/[[\]]/.test(path)) {
      push('liquid_index_not_allowed', start, end);
      return;
    }
    const segments = path.split('.');
    if (segments.length > LIQUID_LIMITS.pathSegments) {
      push('liquid_path_too_deep', start, end, 'error', { params: { path } });
      return;
    }
    for (const segment of segments) {
      if (!IDENT.test(segment)) {
        push('liquid_identifier_case', start, end, 'error', {
          params: { path, suggestion: path.toLowerCase() },
        });
        return;
      }
    }
    const root = segments[0];
    if ((INTERNAL_ROOTS as readonly string[]).includes(root) || !roots.has(root)) {
      push('liquid_unknown_root', start, end, 'error', { params: { root } });
      return;
    }
    if (root !== 'contact' || !ctx.fields) return;
    if (segments.length === 1) return;
    if (segments[1] === 'attr') {
      if (segments.length === 3 && !ctx.fields.contactAttrKeys.includes(segments[2])) {
        push('liquid_unknown_field', start, end, 'error', { params: { path } });
      }
      return;
    }
    if (segments.length === 2 && !ctx.fields.contactFirstClass.includes(segments[1])) {
      push('liquid_unknown_field', start, end, 'error', { params: { path } });
    }
  }
}

function splitFilters(inner: string): { expr: string; filters: string[] } {
  const parts: string[] = [];
  let quoted = false;
  let current = '';
  for (const ch of inner) {
    if (ch === '"') quoted = !quoted;
    if (ch === '|' && !quoted) {
      parts.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return { expr: parts[0], filters: parts.slice(1).map((f) => f.trim()).filter((f) => f !== '') };
}
```

Iterační proměnná cyklu (`{% for tag in contact.tags %}{{ tag }}{% endfor %}`) není kořen z výčtu, a přesto musí projít. Validátor proto jméno proměnné přidá do množiny `roots` na dobu těla cyklu a na `endfor` ho zase odebere. Kód výše to už obsahuje: položka zásobníku má pole `loopVar`, větev `for` po úspěšném `forMatch` volá `roots.add(forMatch[1])` a větev `endfor` volá `roots.delete(opened.loopVar)`. Bez toho by spadly čtyři fixtures skupiny `LQ-4xx` na `liquid_unknown_root`.

- [ ] **Krok 5: Spusť a ověř, že prochází**

Run: `pnpm --filter @mlain/contracts exec vitest run --project unit test/liquid.validator.test.ts`
Expected: PASS. Kód `liquid_literal_not_supported` je rozhodnutí D5 a **musí ho potvrdit vlastník části 3**, viz nález N3.

- [ ] **Krok 6: Commit**

```bash
git add packages/contracts/src/liquid packages/contracts/test/liquid.validator.test.ts
git commit -m "feat(contracts): gramatika Liquid subsetu a vlastní validátor"
```

---

### Úkol 13: Pět vlastních filtrů a instance obou enginů

Žádný vestavěný filtr se nepoužívá. Závazný je **behaviorální test**: render s libovolným názvem filtru mimo naši pětici musí selhat. Test introspekcí registru se nepíše, protože ho přes veřejné API nejde napsat a implementátor by buď sahal do vnitřností knihovny, nebo by ho tiše vynechal.

**Files:**
- Create: `packages/contracts/src/liquid/filters.ts`
- Create: `packages/contracts/src/liquid/engine.ts`
- Test: `packages/contracts/test/liquid.filters.test.ts`

- [ ] **Krok 1: Napiš padající test filtrů a enginů**

`packages/contracts/test/liquid.filters.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { createHtmlEngine, createTextEngine, listBuiltinFilterNames } from '../src/liquid/engine.js';
import { dateFilter, defaultFilter, simpleDowncase, simpleUpcase } from '../src/liquid/filters.js';

describe('pět vlastních filtrů', () => {
  it('default vrací argument pro nil, false, prázdný řetězec a prázdné pole, ale ne pro 0', () => {
    expect(defaultFilter(null, 'kolego')).toBe('kolego');
    expect(defaultFilter(undefined, 'kolego')).toBe('kolego');
    expect(defaultFilter(false, 'kolego')).toBe('kolego');
    expect(defaultFilter('', 'kolego')).toBe('kolego');
    expect(defaultFilter([], 'kolego')).toBe('kolego');
    expect(defaultFilter(0, 'kolego')).toBe(0);
    expect(defaultFilter('Jana', 'kolego')).toBe('Jana');
  });

  it('upcase je simple mapping, ne full mapping', () => {
    expect(simpleUpcase('ěščřžýáíéůúňťď')).toBe('ĚŠČŘŽÝÁÍÉŮÚŇŤĎ');
    expect(simpleUpcase('chalupa')).toBe('CHALUPA');
    // ß, ﬁ, ŉ, ǰ a ΐ mají jen FULL uppercase mapping, tedy se nemění.
    // Naivní toUpperCase() by z ß udělal SS a rozešel by se s Go.
    expect(simpleUpcase('ß ﬁ ŉ ǰ ΐ')).toBe('ß ﬁ ŉ ǰ ΐ');
    expect(simpleDowncase('ĚŠČ')).toBe('ěšč');
  });

  it('date umí všech pět formátů a nikdy nevrací chybu', () => {
    const iso = '2026-08-01T12:40:00Z';
    expect(dateFilter(iso, '%d.%m.%Y', 'Europe/Prague')).toBe('01.08.2026');
    expect(dateFilter(iso, '%-d.%-m.%Y', 'Europe/Prague')).toBe('1.8.2026');
    expect(dateFilter(1_784_995_200, '%Y-%m-%d', 'Europe/Prague')).toBe('2026-07-25');
    expect(dateFilter(iso, '%d.%m.%Y %H:%M', 'Europe/Prague')).toBe('01.08.2026 14:40');
    expect(dateFilter(iso, '%H:%M', 'Europe/Prague')).toBe('14:40');
    expect(dateFilter('včera', '%d.%m.%Y', 'Europe/Prague')).toBe('');
    expect(dateFilter(null, '%d.%m.%Y', 'Europe/Prague')).toBe('');
    expect(dateFilter({}, '%d.%m.%Y', 'Europe/Prague')).toBe('');
    expect(dateFilter(iso, '%d.%m.%Y', undefined)).toBe('01.08.2026');
  });
});

describe('instance enginů', () => {
  it('HTML engine escapuje pět znaků přesně podle kontraktu', async () => {
    const html = await createHtmlEngine().parseAndRender('{{ x }}', { x: `a&b<c>d"e'f` });
    expect(html).toBe('a&amp;b&lt;c&gt;d&quot;e&#39;f');
  });

  it('textový engine neescapuje nic', async () => {
    const text = await createTextEngine().parseAndRender('{{ x }}', { x: `a&b<c>d"e'f` });
    expect(text).toBe(`a&b<c>d"e'f`);
  });

  it('escape je no-op, hodnota se neescapuje dvakrát', async () => {
    expect(await createHtmlEngine().parseAndRender('{{ x | escape }}', { x: 'a&b' })).toBe('a&amp;b');
  });

  it('každý vestavěný filtr mimo naši pětici při renderu selže', async () => {
    const builtins = listBuiltinFilterNames();
    expect(builtins.length).toBeGreaterThan(30);
    const engine = createHtmlEngine();
    for (const name of builtins) {
      if (['default', 'upcase', 'downcase', 'date', 'escape'].includes(name)) continue;
      await expect(engine.parseAndRender(`{{ x | ${name} }}`, { x: 'a' })).rejects.toThrow();
    }
  });

  it('chybějící proměnná je prázdný řetězec, ne chyba', async () => {
    expect(await createHtmlEngine().parseAndRender('[{{ contact.a.b }}]', {})).toBe('[]');
  });

  it('pravdivost: falešné jsou jen false a nil', async () => {
    const engine = createTextEngine();
    expect(await engine.parseAndRender('{% if x %}A{% else %}B{% endif %}', { x: '' })).toBe('A');
    expect(await engine.parseAndRender('{% if x %}A{% else %}B{% endif %}', { x: 0 })).toBe('A');
    expect(await engine.parseAndRender('{% if x %}A{% else %}B{% endif %}', { x: false })).toBe('B');
    expect(await engine.parseAndRender('{% if x %}A{% else %}B{% endif %}', {})).toBe('B');
  });
});
```

- [ ] **Krok 2: Spusť a ověř, že padá**

Run: `pnpm --filter @mlain/contracts exec vitest run --project unit test/liquid.filters.test.ts`
Expected: FAIL, `Cannot find module '../src/liquid/filters.js'`.

- [ ] **Krok 3: Napiš `src/liquid/filters.ts`**

```ts
import { DATE_FORMAT_WHITELIST } from './grammar.js';

/**
 * Pět filtrů, normativní definice z kontraktu 4.10.2.
 * Obě strany registrují vlastní implementaci, ani jeden vestavěný filtr se nepoužívá.
 */

/** Vrátí argument, když je hodnota nil, false, "" nebo prázdné pole. Nula NENÍ prázdná. */
export function defaultFilter(value: unknown, fallback: string): unknown {
  if (value === null || value === undefined || value === false) return fallback;
  if (value === '') return fallback;
  if (Array.isArray(value) && value.length === 0) return fallback;
  return value;
}

/**
 * Simple uppercase mapping. Kód point, jehož velká varianta má víc než jeden
 * kód point (tedy full mapping), zůstává beze změny.
 *
 * Bez tohohle pravidla by JavaScript udělal z `ß` řetězec `SS`, zatímco Go
 * `strings.ToUpper` vrací `ß`, a golden fixtures se porovnávají bajt po bajtu.
 */
export function simpleUpcase(value: string): string {
  let out = '';
  for (const char of value) {
    const upper = char.toUpperCase();
    out += [...upper].length === 1 ? upper : char;
  }
  return out;
}

export function simpleDowncase(value: string): string {
  let out = '';
  for (const char of value) {
    const lower = char.toLowerCase();
    out += [...lower].length === 1 ? lower : char;
  }
  return out;
}

/** V HTML i v textovém kontextu no-op. Escapování je automatické a nevypnutelné. */
export function escapeFilter(value: unknown): unknown {
  return value;
}

type DateParts = { day: number; month: number; year: number; hour: number; minute: number };

function partsIn(date: Date, timezone: string): DateParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((p) => [p.type, p.value]));
  return {
    day: Number(parts.day), month: Number(parts.month), year: Number(parts.year),
    hour: Number(parts.hour) % 24, minute: Number(parts.minute),
  };
}

const pad = (n: number): string => String(n).padStart(2, '0');

/**
 * Vstup: řetězec RFC 3339 s explicitní zónou, celé číslo (unix sekundy), nebo "now".
 * Cokoliv jiného dá prázdný řetězec. ŽÁDNÁ varianta nesmí vrátit chybu: chyba
 * filtru by shodila celý render a zpráva by skončila jako render_failed,
 * přestože kontrakt pro neplatný vstup předepisuje prázdný řetězec.
 */
export function dateFilter(value: unknown, format: string, timezone: string | undefined): string {
  if (!(DATE_FORMAT_WHITELIST as readonly string[]).includes(format)) return '';
  const zone = timezone ?? 'UTC';

  let date: Date | undefined;
  if (typeof value === 'number' && Number.isFinite(value)) date = new Date(value * 1000);
  else if (typeof value === 'string') {
    if (value === 'now') date = new Date();
    else if (/^-?\d+$/.test(value)) date = new Date(Number(value) * 1000);
    else {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) date = new Date(parsed);
    }
  }
  if (!date || Number.isNaN(date.getTime())) return '';

  let parts: DateParts;
  try {
    parts = partsIn(date, zone);
  } catch {
    parts = partsIn(date, 'UTC');
  }

  switch (format) {
    case '%d.%m.%Y':
      return `${pad(parts.day)}.${pad(parts.month)}.${parts.year}`;
    case '%-d.%-m.%Y':
      return `${parts.day}.${parts.month}.${parts.year}`;
    case '%Y-%m-%d':
      return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
    case '%d.%m.%Y %H:%M':
      return `${pad(parts.day)}.${pad(parts.month)}.${parts.year} ${pad(parts.hour)}:${pad(parts.minute)}`;
    case '%H:%M':
      return `${pad(parts.hour)}:${pad(parts.minute)}`;
    default:
      return '';
  }
}
```

- [ ] **Krok 4: Napiš `src/liquid/engine.ts`**

```ts
import { Liquid } from 'liquidjs';
import { HTML_ESCAPE_MAP } from './grammar.js';
import { dateFilter, defaultFilter, escapeFilter, simpleDowncase, simpleUpcase } from './filters.js';

/**
 * Povinná konfigurace knihovny (bez ní kontrakt neplatí):
 *  - jsTruthy: false, se zapnutým by se pravdivost rozešla s Go
 *  - strictFilters: true, neznámý filtr má být chyba
 *  - strictVariables: false, neznámá proměnná má být prázdný řetězec
 *
 * Vestavěné filtry konstruktor registruje vždy a odregistrovat je neumí, takže
 * se přepisují funkcí, která vyhodí chybu. Závazný je behaviorální test, ne
 * introspekce registru.
 */
export function listBuiltinFilterNames(): string[] {
  const probe = new Liquid() as unknown as { filters: { impls: Record<string, unknown> } };
  const names = Object.keys(probe.filters.impls);
  if (names.length < 30) {
    throw new Error(
      `LiquidJS vrátila jen ${names.length} vestavěných filtrů; vnitřní API se změnilo a přepsání ` +
        'vestavěných filtrů se musí udělat jinak, jinak vznikne tichá díra v kontraktu',
    );
  }
  return names;
}

function htmlEscape(value: unknown): string {
  return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPE_MAP[char]);
}

function build(escapeOutput: boolean): Liquid {
  const engine = new Liquid({
    jsTruthy: false,
    strictFilters: true,
    strictVariables: false,
    ...(escapeOutput ? { outputEscape: (value: unknown) => htmlEscape(value) } : {}),
  });

  for (const name of listBuiltinFilterNames()) {
    engine.registerFilter(name, () => {
      throw new Error(`filtr ${name} není v kontraktu 4.10.2`);
    });
  }

  engine.registerFilter('default', (value: unknown, fallback = '') => defaultFilter(value, String(fallback)));
  engine.registerFilter('upcase', (value: unknown) => simpleUpcase(String(value ?? '')));
  engine.registerFilter('downcase', (value: unknown) => simpleDowncase(String(value ?? '')));
  engine.registerFilter('escape', (value: unknown) => escapeFilter(value));
  engine.registerFilter(
    'date',
    function (
      this: { context?: { getSync?: (path: string[]) => unknown } },
      value: unknown,
      format = '%d.%m.%Y',
    ) {
      const timezone = this?.context?.getSync?.(['_context', 'timezone']);
      return dateFilter(value, String(format), typeof timezone === 'string' ? timezone : undefined);
    },
  );

  return engine;
}

/** Dvě instance, ne jedna přepínaná za běhu. */
export const createHtmlEngine = (): Liquid => build(true);
export const createTextEngine = (): Liquid => build(false);
```

- [ ] **Krok 5: Spusť a ověř, že prochází**

Run: `pnpm --filter @mlain/contracts exec vitest run --project unit test/liquid.filters.test.ts`
Expected: PASS. Kdyby `listBuiltinFilterNames` spadlo na počtu, změnilo se vnitřní API LiquidJS a přepsání vestavěných filtrů se musí udělat jinak. Tichá díra v escapování by vznikla přesně tady.

- [ ] **Krok 6: Commit**

```bash
git add packages/contracts/src/liquid packages/contracts/test/liquid.filters.test.ts
git commit -m "feat(contracts): pět vlastních filtrů a dva enginy LiquidJS podle kontraktu"
```

---

### Úkol 14: `prepareRenderData`, jedna příprava dat pro náhled i odeslání

Shoda náhledu a odeslání nestojí jen na stejném rendereru a stejných filtrech, ale i na tom, že do obou jde stejně připravená vstupní data. Volá to materializace publika (P13), sender (P09) i náhled (P08 a P12).

**Files:**
- Create: `packages/contracts/src/liquid/prepare-render-data.ts`
- Test: `packages/contracts/test/prepare-render-data.test.ts`

Go protějšek tady **nevzniká**. Přípravu dat vlastní P09 v `internal/liquidx` (`DecodeRenderData` a `WithBlankBindings`) a shodu obou stran ověřuje runner z úkolu 16 nad týmiž fixtures, ne druhá ručně psaná kopie (rozhodnutí D8).

- [ ] **Krok 1: Napiš padající test**

`packages/contracts/test/prepare-render-data.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { prepareRenderData } from '../src/liquid/prepare-render-data.js';

describe('prepareRenderData', () => {
  it('zkrátí pole na prvních 200 prvků', () => {
    const raw = { contact: { tags: Array.from({ length: 250 }, (_, i) => `t${i}`) } };
    const prepared = prepareRenderData(raw, { fields: [], presence: [] });
    expect((prepared.contact as { tags: string[] }).tags).toHaveLength(200);
    expect((prepared.contact as { tags: string[] }).tags[199]).toBe('t199');
  });

  it('serializuje čísla nad 2^53 jako řetězec', () => {
    const prepared = prepareRenderData({ contact: { vs: 9_007_199_254_740_993n } }, { fields: [], presence: [] });
    expect((prepared.contact as { vs: unknown }).vs).toBe('9007199254740993');
  });

  it('doplní _context.timezone a _context.locale vždy', () => {
    const prepared = prepareRenderData({}, { fields: [], presence: [] });
    expect(prepared._context).toEqual({ timezone: 'UTC', locale: 'cs' });
  });

  it('nepřepíše _context, který už dorazil', () => {
    const prepared = prepareRenderData(
      { _context: { timezone: 'Europe/Prague', locale: 'en' } },
      { fields: [], presence: [] },
    );
    expect(prepared._context).toEqual({ timezone: 'Europe/Prague', locale: 'en' });
  });

  it('naplní _present pro každou cestu z renderSchema.presence', () => {
    const prepared = prepareRenderData(
      { contact: { city: '   ', first_name: 'Jana' } },
      { fields: [], presence: ['contact.city', 'contact.first_name', 'contact.zip'] },
    );
    expect(prepared._present).toEqual({
      contact__city: false,
      contact__first_name: true,
      contact__zip: false,
    });
  });

  it('past prázdného řetězce: řetězec ze samých mezer není present', () => {
    const prepared = prepareRenderData({ contact: { city: '  \t ' } }, { fields: [], presence: ['contact.city'] });
    expect((prepared._present as Record<string, boolean>).contact__city).toBe(false);
  });
});
```

- [ ] **Krok 2: Spusť a ověř, že padá**

Run: `pnpm --filter @mlain/contracts exec vitest run --project unit test/prepare-render-data.test.ts`
Expected: FAIL, `Cannot find module '../src/liquid/prepare-render-data.js'`.

- [ ] **Krok 3: Napiš implementaci na obou stranách**

`packages/contracts/src/liquid/prepare-render-data.ts`:

```ts
import { LIQUID_LIMITS } from './grammar.js';

export type RenderData = Record<string, unknown>;
/**
 * Úzký popis toho, co má `prepareRenderData` připravit. NENÍ to `RenderSchema`
 * z kontraktu 5, což je bohatý tvar s typy polí a systémovými značkami a vlastní
 * ho P08. Dvě neslučitelné věci pod jedním jménem jsou tentýž problém, jaký
 * u katalogu polí vyřešilo rozhodnutí R2, proto se tenhle typ jmenuje
 * `PreparedDataSchema` (požadavek R13 plánu P08).
 */
export type PreparedDataSchema = { fields: readonly string[]; presence: readonly string[] };

const MAX_SAFE = 9_007_199_254_740_991n;

/**
 * Jediná sdílená příprava dat pro náhled i odeslání (část 3, 3.7.2b).
 *
 * Kdyby to dělal jen sender, náhled by podmíněné bloky vyhodnotil jinak než
 * odeslání, což je přesně ten rozchod, kterému tahle funkce brání.
 */
export function prepareRenderData(raw: RenderData, schema: PreparedDataSchema): RenderData {
  const prepared = truncate(normalizeNumbers(raw)) as RenderData;

  const context = (prepared._context as Record<string, unknown> | undefined) ?? {};
  prepared._context = {
    timezone: typeof context.timezone === 'string' ? context.timezone : 'UTC',
    locale: typeof context.locale === 'string' ? context.locale : 'cs',
  };

  const present: Record<string, boolean> = {};
  for (const path of schema.presence) {
    present[path.replace(/\./g, '__')] = isPresent(readPath(prepared, path));
  }
  prepared._present = present;

  return prepared;
}

/** Chybějící klíč je nil, tedy nepravda, takže by podmíněný blok zmizel všem. */
function isPresent(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

function readPath(data: RenderData, path: string): unknown {
  let current: unknown = data;
  for (const segment of path.split('.')) {
    if (typeof current !== 'object' || current === null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

/**
 * Go `encoding/json` mapuje čísla na float64, takže by variabilní symbol nebo
 * číslo faktury ztratily přesnost jinak než v prohlížeči. Nad 2^53 se proto
 * serializuje řetězec.
 */
function normalizeNumbers(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeNumbers);
  if (typeof value === 'bigint') {
    return value > MAX_SAFE || value < -MAX_SAFE ? value.toString() : Number(value);
  }
  if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) {
    return String(BigInt(value));
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalizeNumbers(v)]));
  }
  return value;
}

/**
 * Pole delší než 200 prvků se ořezává na vstupu, protože ani jedna knihovna
 * neumí přerušit `for` uprostřed. Kdyby to náhled nedělal, kontakt s 250
 * položkami by se v editoru zobrazil celý a odeslal zkrácený.
 */
function truncate(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, LIQUID_LIMITS.iterations).map(truncate);
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, truncate(v)]));
  }
  return value;
}
```

**Pozor na jednu věc, kterou musí P09 zopakovat bajt na bajt.** Zkrácení pole na prvních 200 prvků a serializace celých čísel nad 2^53 jako řetězec jsou součást kontraktu 4.10.2, ne detail TypeScript strany. Go `encoding/json` mapuje čísla na `float64`, takže bez `UseNumber()` by variabilní symbol ztratil přesnost jinak než v prohlížeči. V P09 to řeší `liquidx.PrepareRenderData`, které dekóduje s `UseNumber()`, ořezává na `liquidx.MaxLoopItems = 200` a zároveň plní kořen `_present`. Že se obě strany chovají shodně, dokazuje fixture `LQ-403` s 205 prvky, kterou pouští runner z úkolu 16 na obou stranách. Druhá ručně psaná kopie v `internal/contracts` by přesně tuhle jistotu neposkytla, protože by ji nikdo v provozu nevolal.

- [ ] **Krok 4: Spusť obojí a ověř, že prochází**

Run: `pnpm --filter @mlain/contracts exec vitest run --project unit test/prepare-render-data.test.ts`
Expected: PASS, 6 testů.

- [ ] **Krok 5: Commit**

```bash
git add packages/contracts/src/liquid/prepare-render-data.ts packages/contracts/test/prepare-render-data.test.ts
git commit -m "feat(contracts): sdílená příprava render_data pro náhled i odeslání"
```

---

### Úkol 15: Padesát čtyři golden fixtures a runner na TypeScript straně

Čtyřicet čtyři, padesát čtyři, nejméně čtyřicet: dřívější znění uvádělo tři různá čísla pro jednu věc. Platí součet tabulky skupin, **plus jedna fixture, kterou tabulka skupin zapomněla**: je jich **55**. Rozpis je 8 + 10 + 6 + 8 + 4 + 11 + 4 + 4.

**Proč 55 a ne 54.** Vlastní pravidlo plánu zní, že každý kód z tabulky zakázaných konstrukcí má aspoň jednu fixture. Kód `liquid_date_format_not_allowed` fixture neměl ani jednu, přestože ho kontrakt v tabulce má a část 3 na něj má akceptační kritérium 8.4/28. Naopak `liquid_string_literal_not_allowed` má fixtures dvě (`LQ-700` a `LQ-701`), obě opsané z kontraktu doslova, takže se nedají přečíslovat. Doplňuje se proto `LQ-511` a skupina `LQ-5xx` má jedenáct položek místo deseti. Kritérium 41 i job `contracts-golden` z P01 mluví o „**nejméně** 54", takže se s nimi 55 nebije; rozchází se jen počet ve skupinové tabulce a je to zapsané jako nález N9.

**Files:**
- Create: `packages/contracts/fixtures/liquid/LQ-*.json` (55 souborů)
- Modify: `packages/contracts/scripts/generate-fixtures.ts`
- Test: `packages/contracts/test/liquid.golden.test.ts`

- [ ] **Krok 1: Napiš padající runner**

`packages/contracts/test/liquid.golden.test.ts`:

```ts
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { createHtmlEngine, createTextEngine } from '../src/liquid/engine.js';
import { prepareRenderData } from '../src/liquid/prepare-render-data.js';
import { validateLiquid, type LiquidRoots } from '../src/liquid/validator.js';
import { writeGoldenReport } from './golden-report.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const liquidDir = path.join(packageRoot, 'fixtures', 'liquid');

type Fixture = {
  id: string;
  description: string;
  context?: 'html' | 'text';
  level?: 'authored' | 'compiled';
  template: string;
  data?: Record<string, unknown>;
  presence?: string[];
  expected?: string;
  expect_validation_error?: { code: string; hint_contains?: string };
};

/** Jeden katalog pro všechny fixtures. Fixture, která by potřebovala jiný, by rozešla obě strany. */
const FIELDS: LiquidRoots = {
  contactFirstClass: [
    'first_name', 'first_name_vocative', 'greeting', 'city', 'country', 'zip', 'is_vip', 'active',
    'age', 'score', 'note', 'tags', 'signup_at', 'created_at', 'email',
  ],
  contactAttrKeys: ['city', 'vs'],
};

const files = (await readdir(liquidDir)).filter((f) => f.endsWith('.json')).sort();
const fixtures: Fixture[] = await Promise.all(
  files.map(async (file) => JSON.parse(await readFile(path.join(liquidDir, file), 'utf8')) as Fixture),
);

const groups: Record<string, number> = {};
/**
 * Id fixtur, které SKUTEČNĚ doběhly. `skipped` se z nich dopočítá jako rozdíl
 * proti celkovému počtu, nikdy se nepíše jako literál. Dřívější znění mělo
 * `skipped: 0` napevno, takže přeskočená fixture byla neviditelná a kontrola
 * „nepřeskočené fixtures" neměřila vůbec nic.
 */
const executed: string[] = [];

afterAll(async () => {
  await writeGoldenReport({
    section: 'liquid',
    total: fixtures.length,
    ids: executed,
    groups,
    files: files.map((file) => path.join(liquidDir, file)),
  });
});

describe('Liquid golden fixtures', () => {
  it('je jich přesně 55 a skupiny sedí se součtem tabulky', () => {
    const group = (id: string): string => `LQ-${id.slice(3, 4)}xx`;
    const byGroup: Record<string, number> = {};
    for (const fixture of fixtures) byGroup[group(fixture.id)] = (byGroup[group(fixture.id)] ?? 0) + 1;
    expect(fixtures).toHaveLength(55);
    expect(byGroup).toEqual({
      'LQ-0xx': 8, 'LQ-1xx': 10, 'LQ-2xx': 6, 'LQ-3xx': 8,
      'LQ-4xx': 4, 'LQ-5xx': 11, 'LQ-6xx': 4, 'LQ-7xx': 4,
    });
  });

  it('žádné id se neopakuje a soubor se jmenuje podle id', () => {
    expect(new Set(fixtures.map((f) => f.id)).size).toBe(fixtures.length);
    expect(files).toEqual(fixtures.map((f) => `${f.id}.json`));
  });

  it.each(fixtures)('$id $description', async (fixture) => {
    const level = fixture.level ?? 'compiled';
    const validation = validateLiquid(fixture.template, { level, fields: FIELDS, template_kind: 'campaign' });

    if (fixture.expect_validation_error) {
      expect(validation.ok).toBe(false);
      const issue = validation.issues.find((i) => i.code === fixture.expect_validation_error!.code);
      expect(issue, `čekal se kód ${fixture.expect_validation_error.code}`).toBeDefined();
      if (fixture.expect_validation_error.hint_contains) {
        expect(JSON.stringify(issue)).toContain(fixture.expect_validation_error.hint_contains);
      }
    } else {
      expect(validation.ok, `fixture musí projít validací: ${JSON.stringify(validation.issues)}`).toBe(true);
      const engine = (fixture.context ?? 'html') === 'html' ? createHtmlEngine() : createTextEngine();
      const data = prepareRenderData(fixture.data ?? {}, { fields: [], presence: fixture.presence ?? [] });
      const rendered = await engine.parseAndRender(fixture.template, data);
      // Bajt po bajtu, žádná normalizace mezer.
      expect(rendered).toBe(fixture.expected);
    }

    // AŽ TADY, jako poslední řádky těla. Kdyby se počítalo nahoře nebo mimo tělo,
    // započítala by se i fixture, která spadla nebo se vůbec nespustila.
    const group = `LQ-${fixture.id.slice(3, 4)}xx`;
    groups[group] = (groups[group] ?? 0) + 1;
    executed.push(fixture.id);
  });
});
```

- [ ] **Krok 2: Spusť a ověř, že padá**

Run: `pnpm --filter @mlain/contracts exec vitest run --project golden test/liquid.golden.test.ts`
Expected: FAIL, `expected [] to have a length of 55`.

- [ ] **Krok 3: Zapiš skupinu `LQ-0xx`, výstup a cesty, osm fixtur**

Každý soubor je `fixtures/liquid/<id>.json`.

```json
{ "id": "LQ-001", "description": "prostá proměnná v HTML", "context": "html", "level": "authored", "template": "Dobrý den, {{ contact.first_name }}!", "data": { "contact": { "first_name": "Jana" } }, "expected": "Dobrý den, Jana!" }
```
```json
{ "id": "LQ-002", "description": "vnořená cesta o třech segmentech", "context": "html", "level": "authored", "template": "[{{ contact.attr.city }}]", "data": { "contact": { "attr": { "city": "Brno" } } }, "expected": "[Brno]" }
```
```json
{ "id": "LQ-003", "description": "chybějící mezičlen cesty je prázdný řetězec, ne chyba", "context": "html", "level": "authored", "template": "[{{ contact.attr.city }}]", "data": { "contact": {} }, "expected": "[]" }
```
```json
{ "id": "LQ-004", "description": "chybějící kořen v datech je prázdný řetězec", "context": "html", "level": "authored", "template": "[{{ campaign.name }}]", "data": { "contact": { "first_name": "Jana" } }, "expected": "[]" }
```
```json
{ "id": "LQ-005", "description": "escapování všech pěti znaků v HTML části", "context": "html", "level": "authored", "template": "{{ contact.note }}", "data": { "contact": { "note": "a&b<c>d\"e'f" } }, "expected": "a&amp;b&lt;c&gt;d&quot;e&#39;f" }
```
```json
{ "id": "LQ-006", "description": "v textové části se neescapuje nic", "context": "text", "level": "authored", "template": "{{ contact.note }}", "data": { "contact": { "note": "a&b<c>d\"e'f" } }, "expected": "a&b<c>d\"e'f" }
```
```json
{ "id": "LQ-007", "description": "jméno kontaktu se skriptem se v HTML zobrazí jako text", "context": "html", "level": "authored", "template": "{{ contact.first_name }}", "data": { "contact": { "first_name": "<script>alert(1)</script>" } }, "expected": "&lt;script&gt;alert(1)&lt;/script&gt;" }
```
```json
{ "id": "LQ-008", "description": "hotové oslovení s ampersandem, nejpoužívanější tag produktu", "context": "html", "level": "authored", "template": "{{ contact.greeting }},", "data": { "contact": { "greeting": "Dobrý den, Jano & spol." } }, "expected": "Dobrý den, Jano &amp; spol.," }
```

- [ ] **Krok 4: Zapiš skupinu `LQ-1xx`, filtry, deset fixtur**

```json
{ "id": "LQ-101", "description": "default na nil", "context": "html", "level": "compiled", "template": "Dobrý den, {{ contact.first_name | default: \"kolego\" }}!", "data": { "contact": {} }, "expected": "Dobrý den, kolego!" }
```
```json
{ "id": "LQ-102", "description": "default na false", "context": "html", "level": "compiled", "template": "{{ contact.first_name | default: \"kolego\" }}", "data": { "contact": { "first_name": false } }, "expected": "kolego" }
```
```json
{ "id": "LQ-103", "description": "default na prázdném řetězci", "context": "html", "level": "compiled", "template": "{{ contact.first_name | default: \"kolego\" }}", "data": { "contact": { "first_name": "" } }, "expected": "kolego" }
```
```json
{ "id": "LQ-104", "description": "default na prázdném poli", "context": "html", "level": "compiled", "template": "{{ contact.tags | default: \"kolego\" }}", "data": { "contact": { "tags": [] } }, "expected": "kolego" }
```
```json
{ "id": "LQ-105", "description": "nula NENÍ prázdná, default se neuplatní", "context": "html", "level": "compiled", "template": "{{ contact.score | default: \"kolego\" }}", "data": { "contact": { "score": 0 } }, "expected": "0" }
```
```json
{ "id": "LQ-106", "description": "default na vyplněné hodnotě vrací hodnotu", "context": "html", "level": "compiled", "template": "{{ contact.first_name | default: \"kolego\" }}", "data": { "contact": { "first_name": "Jana" } }, "expected": "Jana" }
```
```json
{ "id": "LQ-107", "description": "upcase", "context": "html", "level": "authored", "template": "{{ contact.first_name | upcase }}", "data": { "contact": { "first_name": "jana" } }, "expected": "JANA" }
```
```json
{ "id": "LQ-108", "description": "downcase", "context": "html", "level": "authored", "template": "{{ contact.first_name | downcase }}", "data": { "contact": { "first_name": "JANA" } }, "expected": "jana" }
```
```json
{ "id": "LQ-109", "description": "escape je no-op, hodnota se neescapuje dvakrát", "context": "html", "level": "authored", "template": "{{ contact.note | escape }}", "data": { "contact": { "note": "a&b" } }, "expected": "a&amp;b" }
```
```json
{ "id": "LQ-110", "description": "řetězení filtrů", "context": "html", "level": "compiled", "template": "{{ contact.first_name | default: \"kolego\" | upcase }}", "data": { "contact": {} }, "expected": "KOLEGO" }
```

- [ ] **Krok 5: Zapiš skupinu `LQ-2xx`, filtr date, šest fixtur**

```json
{ "id": "LQ-201", "description": "formát %d.%m.%Y v zóně Europe/Prague", "context": "html", "level": "compiled", "template": "{{ contact.signup_at | date: \"%d.%m.%Y\" }}", "data": { "contact": { "signup_at": "2026-08-01T12:40:00Z" }, "_context": { "timezone": "Europe/Prague" } }, "expected": "01.08.2026" }
```
```json
{ "id": "LQ-202", "description": "formát bez paddingu s jednociferným dnem i měsícem", "context": "html", "level": "compiled", "template": "{{ contact.signup_at | date: \"%-d.%-m.%Y\" }}", "data": { "contact": { "signup_at": "2026-08-01T12:40:00Z" }, "_context": { "timezone": "Europe/Prague" } }, "expected": "1.8.2026" }
```
```json
{ "id": "LQ-203", "description": "vstupem je unix čas jako číslo, ne řetězec", "context": "html", "level": "compiled", "template": "{{ contact.signup_at | date: \"%Y-%m-%d\" }}", "data": { "contact": { "signup_at": 1784995200 }, "_context": { "timezone": "Europe/Prague" } }, "expected": "2026-07-25" }
```
```json
{ "id": "LQ-204", "description": "datum s časem", "context": "html", "level": "compiled", "template": "{{ contact.signup_at | date: \"%d.%m.%Y %H:%M\" }}", "data": { "contact": { "signup_at": "2026-08-01T12:40:00Z" }, "_context": { "timezone": "Europe/Prague" } }, "expected": "01.08.2026 14:40" }
```
```json
{ "id": "LQ-205", "description": "jen čas, zóna se bere z _context.timezone", "context": "html", "level": "compiled", "template": "{{ contact.signup_at | date: \"%H:%M\" }}", "data": { "contact": { "signup_at": "2026-08-01T12:40:00Z" }, "_context": { "timezone": "Europe/Prague" } }, "expected": "14:40" }
```
```json
{ "id": "LQ-206", "description": "neplatný vstup dá prázdný řetězec, nikdy chybu", "context": "html", "level": "compiled", "template": "[{{ contact.signup_at | date: \"%d.%m.%Y\" }}]", "data": { "contact": { "signup_at": "včera" }, "_context": { "timezone": "Europe/Prague" } }, "expected": "[]" }
```

- [ ] **Krok 6: Zapiš skupinu `LQ-3xx`, podmínky, osm fixtur**

```json
{ "id": "LQ-301", "description": "prázdný řetězec je pravdivý", "context": "html", "level": "authored", "template": "{% if contact.note %}A{% else %}B{% endif %}", "data": { "contact": { "note": "" } }, "expected": "A" }
```
```json
{ "id": "LQ-302", "description": "nula je pravdivá", "context": "html", "level": "authored", "template": "{% if contact.score %}A{% else %}B{% endif %}", "data": { "contact": { "score": 0 } }, "expected": "A" }
```
```json
{ "id": "LQ-303", "description": "false je nepravdivé", "context": "html", "level": "authored", "template": "{% if contact.is_vip %}A{% else %}B{% endif %}", "data": { "contact": { "is_vip": false } }, "expected": "B" }
```
```json
{ "id": "LQ-304", "description": "chybějící hodnota je nil, tedy nepravdivá", "context": "html", "level": "authored", "template": "{% if contact.is_vip %}A{% else %}B{% endif %}", "data": { "contact": {} }, "expected": "B" }
```
```json
{ "id": "LQ-305", "description": "porovnání různých typů je false, nikdy chyba", "context": "html", "level": "authored", "template": "{% if contact.age == 10 %}A{% else %}B{% endif %}", "data": { "contact": { "age": "10" } }, "expected": "B" }
```
```json
{ "id": "LQ-306", "description": "and, or a elsif v jedné šabloně", "context": "html", "level": "authored", "template": "{% if contact.is_vip and contact.active %}A{% elsif contact.is_vip or contact.active %}B{% else %}C{% endif %}", "data": { "contact": { "is_vip": true, "active": false } }, "expected": "B" }
```
```json
{ "id": "LQ-307", "description": "podmínka nad _present pro obě větve, konstrukce emitovaná každým podmíněným blokem", "context": "html", "level": "compiled", "template": "{% if _present.contact__city %}A{% endif %}{% if _present.contact__zip %}B{% endif %}", "data": { "contact": { "city": "Brno", "zip": "   " } }, "presence": ["contact.city", "contact.zip"], "expected": "A" }
```
```json
{ "id": "LQ-308", "description": "literály blank a empty validátor odmítá, protože je osteele/liquid nezná", "level": "authored", "template": "{% if contact.city == blank or contact.tags == empty %}x{% endif %}", "expect_validation_error": { "code": "liquid_literal_not_supported" } }
```

- [ ] **Krok 7: Zapiš skupinu `LQ-4xx`, cykly, čtyři fixtury**

`LQ-403` má 205 prvků a nepíše se ručně, vyrábí ho generátor (krok 11).

```json
{ "id": "LQ-401", "description": "cyklus přes prázdné pole neproběhne", "context": "html", "level": "authored", "template": "[{% for item in contact.tags %}{{ item }}{% endfor %}]", "data": { "contact": { "tags": [] } }, "expected": "[]" }
```
```json
{ "id": "LQ-402", "description": "cyklus přes jeden prvek", "context": "html", "level": "authored", "template": "{% for item in contact.tags %}[{{ item }}]{% endfor %}", "data": { "contact": { "tags": ["vip"] } }, "expected": "[vip]" }
```
```json
{ "id": "LQ-404", "description": "cyklus přes ne-pole se neprovede", "context": "html", "level": "authored", "template": "[{% for item in contact.tags %}{{ item }}{% endfor %}]", "data": { "contact": { "tags": null } }, "expected": "[]" }
```

- [ ] **Krok 8: Zapiš skupinu `LQ-5xx`, odmítnutí validátorem, jedenáct fixtur**

Jedenáct kódů, jedenáct fixtur. Tag `assign`, `capture`, `include`, `case`, `raw` i `comment` spadají pod jediný kód `liquid_tag_not_allowed`, proto na ně stačí jedna fixture.

```json
{ "id": "LQ-501", "description": "zakázaný tag", "level": "authored", "template": "{% assign x = 1 %}", "expect_validation_error": { "code": "liquid_tag_not_allowed", "hint_contains": "assign" } }
```
```json
{ "id": "LQ-502", "description": "whitespace control", "level": "authored", "template": "{{- contact.first_name -}}", "expect_validation_error": { "code": "liquid_whitespace_control_not_allowed" } }
```
```json
{ "id": "LQ-503", "description": "operátor contains", "level": "authored", "template": "{% if contact.tags contains 1 %}x{% endif %}", "expect_validation_error": { "code": "liquid_contains_not_allowed" } }
```
```json
{ "id": "LQ-504", "description": "závorky v podmínce", "level": "authored", "template": "{% if (contact.is_vip) %}x{% endif %}", "expect_validation_error": { "code": "liquid_parentheses_not_allowed" } }
```
```json
{ "id": "LQ-505", "description": "vnořený cyklus", "level": "authored", "template": "{% for a in contact.tags %}{% for b in contact.tags %}x{% endfor %}{% endfor %}", "expect_validation_error": { "code": "liquid_nested_for" } }
```
```json
{ "id": "LQ-506", "description": "parametr cyklu", "level": "authored", "template": "{% for a in contact.tags limit: 2 %}x{% endfor %}", "expect_validation_error": { "code": "liquid_for_parameter_not_allowed", "hint_contains": "limit" } }
```
```json
{ "id": "LQ-507", "description": "indexování pole", "level": "authored", "template": "{{ contact.tags[0] }}", "expect_validation_error": { "code": "liquid_index_not_allowed" } }
```
```json
{ "id": "LQ-508", "description": "vestavěný filtr LiquidJS mimo naši pětici", "level": "authored", "template": "{{ contact.first_name | reverse }}", "expect_validation_error": { "code": "liquid_filter_not_allowed", "hint_contains": "reverse" } }
```
```json
{ "id": "LQ-509", "description": "operátor porovnání, který renderer escapuje", "level": "authored", "template": "{% if contact.score > 5 %}x{% endif %}", "expect_validation_error": { "code": "liquid_comparison_operator_not_supported", "hint_contains": ">" } }
```
```json
{ "id": "LQ-510", "description": "filtr vocative má vlastní hlášku s nápovědou na správný tag", "level": "authored", "template": "{{ contact.first_name | vocative }}", "expect_validation_error": { "code": "liquid_vocative_filter", "hint_contains": "first_name_vocative" } }
```
```json
{ "id": "LQ-511", "description": "formát data mimo whitelist v kompilované šabloně", "level": "compiled", "template": "{{ contact.signup_at | date: \"%B %Y\" }}", "expect_validation_error": { "code": "liquid_date_format_not_allowed", "hint_contains": "%B %Y" } }
```

`LQ-511` je jedenáctá fixture skupiny a doplňuje jediný kód z tabulky zakázaných konstrukcí, který fixture neměl. Musí být `compiled`, protože v autorské šabloně by dřív spadl `liquid_string_literal_not_allowed` na uvozovkách a kód formátu by se k slovu nedostal. Tohle rozdvojení je přesně to, co popisuje akceptační kritérium 8.4/28 části 3.

- [ ] **Krok 9: Zapiš skupinu `LQ-6xx`, diakritika a Unicode, čtyři fixtury**

```json
{ "id": "LQ-601", "description": "upcase nad českou diakritikou a nad ch, které je jedno písmeno", "context": "html", "level": "authored", "template": "{{ contact.note | upcase }}", "data": { "contact": { "note": "ěščřžýáíéůúňťď chalupa" } }, "expected": "ĚŠČŘŽÝÁÍÉŮÚŇŤĎ CHALUPA" }
```
```json
{ "id": "LQ-602", "description": "simple mapping: znaky s pouze full uppercase mapping se nemění, jinak by se JS rozešel s Go", "context": "html", "level": "authored", "template": "{{ contact.note | upcase }}", "data": { "contact": { "note": "ß ﬁ ŉ ǰ ΐ" } }, "expected": "ß ﬁ ŉ ǰ ΐ" }
```
```json
{ "id": "LQ-603", "description": "emoji se ZWJ a vlajka projdou beze změny", "context": "html", "level": "authored", "template": "{{ contact.note | upcase }}", "data": { "contact": { "note": "👩‍👩‍👧‍👦 🇨🇿" } }, "expected": "👩‍👩‍👧‍👦 🇨🇿" }
```
```json
{ "id": "LQ-604", "description": "kombinující znaky a delší UTF-8 text přes downcase", "context": "html", "level": "authored", "template": "{{ contact.note | downcase }}", "data": { "contact": { "note": "PŘÍLIŠ ŽLUŤOUČKÝ KŮŇ ÚPĚL ĎÁBELSKÉ ÓDY, Ě̌" } }, "expected": "příliš žluťoučký kůň úpěl ďábelské ódy, ě̌" }
```

Hodnotu u `LQ-604` si při zápisu ověř spuštěním, ne úvahou: kombinující znak U+030C za velkým `Ě` musí zůstat beze změny a písmeno se má zmenšit.

- [ ] **Krok 10: Zapiš skupinu `LQ-7xx`, řetězcové literály a escapování rendererem, čtyři fixtury**

Tyhle čtyři jsou v kontraktu vypsané doslova a přepisují se beze změny.

```json
{ "id": "LQ-700", "description": "uvozovka v autorské šabloně musí být odmítnuta validátorem", "level": "authored", "template": "Dobrý den, {{ contact.first_name | default: \"kolego\" }}!", "expect_validation_error": { "code": "liquid_string_literal_not_allowed", "hint_contains": "default" } }
```
```json
{ "id": "LQ-701", "description": "apostrof v podmínce musí být odmítnut stejně jako uvozovka", "level": "authored", "template": "{% if contact.country == 'CZ' %}ahoj{% endif %}", "expect_validation_error": { "code": "liquid_string_literal_not_allowed" } }
```
```json
{ "id": "LQ-702", "description": "escapovaná uvozovka v kompilované šabloně je chyba, ne tichý průchod", "level": "compiled", "template": "{{ contact.first_name | default: &quot;kolego&quot; }}", "expect_validation_error": { "code": "liquid_escaped_entity_in_construct" } }
```
```json
{ "id": "LQ-703", "description": "prosté konstrukce projdou renderem beze změny", "level": "authored", "context": "html", "template": "{% if contact.is_vip %}{{ contact.first_name | upcase }}{% endif %}", "data": { "contact": { "is_vip": true, "first_name": "žofie" } }, "expected": "ŽOFIE" }
```

Fixture `LQ-700` má v kontraktu `hint_contains` na panel vlastností. Hláška je vlastnictví části 3 a validátor vrací jen `params.filter`, proto je `hint_contains` nastavené na `default`, tedy na hodnotu, kterou validátor skutečně nese. Text hlášky doplní katalog v P08 a P05.

- [ ] **Krok 11: Doplň do generátoru fixture s dvěma sty prvky**

Přidej do `packages/contracts/scripts/generate-fixtures.ts`:

```ts
export async function generateLoopLimitFixture(): Promise<void> {
  const items = Array.from({ length: 205 }, (_, i) => `i${i + 1}`);
  const expected = items.slice(0, 200).map((item) => `[${item}]`).join('');
  const fixture = {
    id: 'LQ-403',
    description: 'pole delší než 200 prvků se ořezává na vstupu, obě strany identicky',
    context: 'html',
    level: 'authored',
    template: '{% for item in contact.tags %}[{{ item }}]{% endfor %}',
    data: { contact: { tags: items } },
    expected,
  };
  await writeFile(
    path.join(packageRoot, 'fixtures', 'liquid', 'LQ-403.json'),
    JSON.stringify(fixture, null, 2) + '\n',
    'utf8',
  );
}
```

A do spouštěcí větve přidej `await generateLoopLimitFixture();`.

- [ ] **Krok 12: Vygeneruj, spusť a ověř, že prochází**

Run: `pnpm --filter @mlain/contracts exec tsx scripts/generate-fixtures.ts && pnpm --filter @mlain/contracts run test:golden`
Expected: PASS, 55 fixtur plus dva strukturní testy. V `reports/ts-golden-liquid.json` je `total: 55`, `executed: 55` a `skipped: 0`.

- [ ] **Krok 13: Commit**

```bash
git add packages/contracts/fixtures/liquid packages/contracts/scripts packages/contracts/test/liquid.golden.test.ts
git commit -m "test(contracts): 55 Liquid golden fixtures a runner na TypeScript straně"
```

---

### Úkol 16: Go runner Liquidu a tabulky přechodů

Bod, který skutečně zabraňuje rozchodu dialektů, není jazyková implementace, ale to, že **obě strany zpracují stejnou množinu souborů**. Dřívější znění tady psalo celou Go implementaci Liquidu, včetně vlastního enginu, pěti filtrů a seznamu vestavěných filtrů knihovny. To se ruší (rozhodnutí D8): engine i filtry vlastní P09 v `internal/liquidx` a tenhle úkol dodává runner.

**Files:**
- Modify: `apps/sender/internal/contracts/golden.go`
- Modify: `apps/sender/internal/contracts/golden_test.go`

- [ ] **Krok 1: Doplň runner Liquidu**

Přidej do `apps/sender/internal/contracts/golden.go`:

```go
// ---------------------------------------------------------------- kontrakt 2 --

type liquidFixture struct {
	ID          string         `json:"id"`
	Description string         `json:"description"`
	Context     string         `json:"context"`
	Level       string         `json:"level"`
	Template    string         `json:"template"`
	Data        map[string]any `json:"data"`
	Presence    []string       `json:"presence"`
	Expected    string         `json:"expected"`
	ExpectError *struct {
		Code         string `json:"code"`
		HintContains string `json:"hint_contains"`
	} `json:"expect_validation_error"`
}

// LiquidRunner drží produkční render P09. Jedna funkce schválně: pořadí kroků
// (Prepare, DecodeRenderData, WithBlankBindings, Render) je věc balíčku liquidx
// a runner do něj nemá mluvit. Kdyby si ho runner poskládal sám, testoval by
// jiné pořadí, než jakým se opravdu odesílá.
type LiquidRunner struct {
	// Render dostane šablonu, syrová data jako JSON a příznak textové varianty.
	Render func(template string, rawData []byte, presence []string, plainText bool) (string, error)
}

// templateIsInertInGo vyjmenovává fixtury, které jsou pro Go knihovnu
// syntakticky platné, ale zakazuje je NÁŠ validátor, ne knihovna. Seznam je
// explicitní, aby nešlo tiše přehlédnout, že Go přijalo něco, co přijmout nemělo.
//
// Seznam je OVĚŘENÝ SPUŠTĚNÍM proti github.com/osteele/liquid v1.8.1, ne odhad.
// Dřívější znění tady mělo devět položek a chyběly v něm LQ-501 ({% assign %}),
// LQ-502 (whitespace control) a LQ-507 (indexování pole), které knihovna
// zpracuje bez chyby. Test na nich padal.
func templateIsInertInGo(id string) bool {
	switch id {
	case "LQ-308", "LQ-501", "LQ-502", "LQ-503", "LQ-504", "LQ-505",
		"LQ-506", "LQ-507", "LQ-509", "LQ-511", "LQ-700", "LQ-701", "LQ-702":
		return true
	default:
		return false
	}
}

func CheckLiquidGolden(dir string, names []string, read func(string) ([]byte, error), runner LiquidRunner) (Outcome, error) {
	outcome := Outcome{Groups: map[string]int{}}
	for _, name := range names {
		raw, err := read(name)
		if err != nil {
			return Outcome{}, fmt.Errorf("%s: %w", name, err)
		}
		var fixture liquidFixture
		if err := json.Unmarshal(raw, &fixture); err != nil {
			return Outcome{}, fmt.Errorf("%s: %w", name, err)
		}
		outcome.Total++

		rawData, err := json.Marshal(fixture.Data)
		if err != nil {
			return Outcome{}, fmt.Errorf("%s: data nejdou serializovat: %w", fixture.ID, err)
		}
		out, renderErr := runner.Render(fixture.Template, rawData, fixture.Presence, fixture.Context == "text")

		if fixture.ExpectError != nil {
			// Validátor je vlastnictví TypeScript strany a v Go neexistuje.
			// Go tu ověřuje slabší, ale netriviální tvrzení: šablona se buď
			// nezparsuje, nebo je uvedená v seznamu inertních.
			if renderErr == nil && !templateIsInertInGo(fixture.ID) {
				outcome.Mismatches = append(outcome.Mismatches, Mismatch{fixture.ID,
					"šablona odmítnutá validátorem prošla v Go bez chyby a není v templateIsInertInGo"})
				continue
			}
		} else {
			if renderErr != nil {
				outcome.Mismatches = append(outcome.Mismatches, Mismatch{fixture.ID,
					"render selhal: " + renderErr.Error()})
				continue
			}
			if out != fixture.Expected {
				outcome.Mismatches = append(outcome.Mismatches, Mismatch{fixture.ID,
					fmt.Sprintf("výstup se rozešel bajt po bajtu\n  Go: %q\n  TS: %q", out, fixture.Expected)})
				continue
			}
		}

		// AŽ TADY. Dřívější znění plnilo groups i rendered MIMO tělo podtestu,
		// takže přeskočení uvnitř běhu nebylo v počtech vidět vůbec.
		outcome.Groups["LQ-"+fixture.ID[3:4]+"xx"]++
		outcome.IDs = append(outcome.IDs, fixture.ID)
	}
	return outcome, nil
}

func RunLiquidGolden(t *testing.T, runner LiquidRunner) {
	t.Helper()
	names, err := ListFixtures("liquid")
	if err != nil {
		t.Fatalf("nelze číst fixtures: %v", err)
	}
	if len(names) < 54 {
		t.Fatalf("čekám nejméně 54 fixtur podle kritéria 41, je jich %d", len(names))
	}
	outcome, err := CheckLiquidGolden("liquid", names, func(name string) ([]byte, error) {
		return ReadFixture("liquid/" + name)
	}, runner)
	if err != nil {
		t.Fatalf("%v", err)
	}
	finish(t, "liquid", outcome, names)
}

// ---------------------------------------------------------------- kontrakt 1 --

type outboxRegistry struct {
	Transitions []struct {
		ID        string  `json:"id"`
		From      string  `json:"from"`
		To        string  `json:"to"`
		Actor     string  `json:"actor"`
		ErrorCode *string `json:"error_code"`
		Allowed   bool    `json:"allowed"`
	} `json:"transitions"`
}

// OutboxRunner drží produkční tabulku přechodů P09. ErrorCode je prázdný řetězec
// pro NULL, protože tak ho nese sloupec messages.error_code.
type OutboxRunner struct {
	CanTransition func(from, to, actor, errorCode string) bool
}

func CheckOutboxTransitions(raw []byte, runner OutboxRunner) (Outcome, error) {
	var registry outboxRegistry
	if err := json.Unmarshal(raw, &registry); err != nil {
		return Outcome{}, fmt.Errorf("registr nejde naparsovat: %w", err)
	}
	outcome := Outcome{}
	for _, testCase := range registry.Transitions {
		outcome.Total++
		code := ""
		if testCase.ErrorCode != nil {
			code = *testCase.ErrorCode
		}
		got := runner.CanTransition(testCase.From, testCase.To, testCase.Actor, code)
		if got != testCase.Allowed {
			outcome.Mismatches = append(outcome.Mismatches, Mismatch{testCase.ID,
				fmt.Sprintf("%s -> %s (%s, error_code %q): Go vrací %v, kontrakt %v",
					testCase.From, testCase.To, testCase.Actor, code, got, testCase.Allowed)})
			continue
		}
		outcome.IDs = append(outcome.IDs, testCase.ID)
	}
	return outcome, nil
}

func RunOutboxTransitions(t *testing.T, runner OutboxRunner) {
	t.Helper()
	raw, err := ReadFixture("outbox/scenarios.json")
	if err != nil {
		t.Fatalf("registr nejde přečíst: %v", err)
	}
	outcome, err := CheckOutboxTransitions(raw, runner)
	if err != nil {
		t.Fatalf("%v", err)
	}
	// Sekce `outbox` se do parity nepočítá jako soubory fixtures, ale jako
	// případy uvnitř jednoho souboru; otisk je proto nad tím jedním souborem.
	finish(t, "outbox", outcome, []string{"scenarios.json"})
}
```

`finish` počítá otisk přes `FixturesDigest(section, files)`, tedy z adresáře pojmenovaného po sekci. U sekce `outbox` to sedí, protože `scenarios.json` leží v `fixtures/outbox/`. U sekce `message-id` také. U sekce `liquid` jsou to všechny soubory adresáře.

- [ ] **Krok 2: Doplň testy runneru**

Přidej do `apps/sender/internal/contracts/golden_test.go`:

```go
func TestCheckLiquidGoldenOdhaliRozchodIPropustek(t *testing.T) {
	names, err := ListFixtures("liquid")
	if err != nil {
		t.Fatalf("fixtures: %v", err)
	}
	read := func(name string) ([]byte, error) { return ReadFixture("liquid/" + name) }

	// Implementace, která vrací pořád totéž. Musí spadnout na render fixtures.
	outcome, err := CheckLiquidGolden("liquid", names, read, LiquidRunner{
		Render: func(string, []byte, []string, bool) (string, error) { return "SPATNE", nil },
	})
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if len(outcome.Mismatches) == 0 {
		t.Fatal("runner propustil implementaci, která vrací konstantu")
	}
	if outcome.Total != len(names) {
		t.Fatalf("runner nezpracoval všechny fixtury: %d z %d", outcome.Total, len(names))
	}

	// Implementace, která nikdy neselže, nesmí projít u fixtur odmítnutých
	// validátorem, které NEJSOU v seznamu inertních.
	found := false
	for _, name := range names {
		raw, _ := read(name)
		var fixture liquidFixture
		if err := json.Unmarshal(raw, &fixture); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if fixture.ExpectError != nil && !templateIsInertInGo(fixture.ID) {
			found = true
		}
	}
	if !found {
		t.Fatal("každá odmítnutá fixture je v templateIsInertInGo; seznam pak nic nehlídá")
	}
}

func TestCheckOutboxTransitionsOdhaliObracenouTabulku(t *testing.T) {
	raw, err := ReadFixture("outbox/scenarios.json")
	if err != nil {
		t.Fatalf("registr: %v", err)
	}
	outcome, err := CheckOutboxTransitions(raw, OutboxRunner{
		CanTransition: func(string, string, string, string) bool { return true },
	})
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if outcome.Total != 14 {
		t.Fatalf("čekám 14 případů přechodu, je jich %d", outcome.Total)
	}
	// Implementace "všechno je povolené" musí spadnout na šesti zakázaných.
	if len(outcome.Mismatches) != 6 {
		t.Fatalf("čekám 6 neshod, je jich %d", len(outcome.Mismatches))
	}
}
```

Doplň k tomu do hlavičky testu import `encoding/json`.

Run: `cd apps/sender && go vet ./internal/contracts/ && go test ./internal/contracts/ -v`
Expected: PASS.

- [ ] **Krok 3: Zapiš volání, které dodá P09**

`apps/sender/internal/liquidx/golden_test.go` (vlastní P09):

```go
package liquidx_test

import (
	"testing"

	"github.com/nc-mill/mlain/apps/sender/internal/contracts"
	"github.com/nc-mill/mlain/apps/sender/internal/liquidx"
)

func TestGoldenLiquid(t *testing.T) {
	contracts.RunLiquidGolden(t, contracts.LiquidRunner{
		Render: func(template string, rawData []byte, presence []string, plainText bool) (string, error) {
			ctx := liquidx.ContextHTML
			if plainText {
				ctx = liquidx.ContextText
			}
			prepared, err := liquidx.Prepare(template, ctx)
			if err != nil {
				return "", err
			}
			// PrepareRenderData, ne DecodeRenderData. Je to Go protějšek sdílené
			// funkce prepareRenderData: doplní _context, ořeže pole na 200 prvků,
			// udrží velká celá čísla přesně a hlavně naplní kořen _present podle
			// parametru `presence`. Bez něj by se u fixtur jako LQ-307 obě
			// podmínky vyhodnotily jako nepravda a v provozu by z mailu tiše
			// zmizely podmíněné bloky.
			data, _, err := liquidx.PrepareRenderData(rawData, liquidx.RenderSchema{Presence: presence})
			if err != nil {
				return "", err
			}
			// Vazba _blank řeší nález K4 a s _present nemá nic společného:
			// literály blank a empty gramatika povoluje, ale lexer knihovny je
			// nezná a vyhodnotí je na nil.
			bindings := liquidx.WithBlankBindings(data, prepared.BlankPaths)
			// Zóna se bere z _context.timezone. S prázdnými Options by filtr date
			// u fixtur s jinou zónou vracel jiný čas, tedy LQ-201 až LQ-205.
			engine, err := liquidx.New(liquidx.Options{Timezone: liquidx.TimezoneOf(data)})
			if err != nil {
				return "", err
			}
			return engine.Render(prepared.Source, bindings)
		},
	})
}
```

`apps/sender/internal/outbox/golden_test.go` (vlastní P09):

```go
package outbox_test

import (
	"testing"

	"github.com/nc-mill/mlain/apps/sender/internal/contracts"
	"github.com/nc-mill/mlain/apps/sender/internal/outbox"
)

func TestGoldenOutboxTransitions(t *testing.T) {
	contracts.RunOutboxTransitions(t, contracts.OutboxRunner{
		CanTransition: outbox.CanTransition,
	})
}
```

Balíček `internal/outbox` dnes tabulku přechodů nemá vůbec, má jen SQL příkazy. Doplnit `func CanTransition(from, to, actor, errorCode string) bool` je požadavek P02→P09.2. Bez ní by uzavřený výčet stavů a jediná pojmenovaná výjimka `failed -> sent` existovaly jen v TypeScriptu, přestože přechody provádí i sender.

- [ ] **Krok 4: Commit**

```bash
git add apps/sender/internal/contracts
git commit -m "feat(contracts): Go runnery Liquidu a tabulky přechodů nad společnými fixtures"
```

---

### Úkol 17: Kontrakt 5, značky pro tracking

Dvě značky, obě nahrazované **prostou záměnou řetězce**. Sender nikdy neparsuje HTML, protože každý parser mu může přeuspořádat atributy nebo znormalizovat markup laděný pro Outlook.

**Files:**
- Create: `packages/contracts/src/markers.ts`
- Modify: `apps/sender/internal/contracts/golden.go` (runner, ne implementace)
- Create: `packages/contracts/fixtures/markers/MK-0*.json` (10 souborů)
- Test: `packages/contracts/test/markers.golden.test.ts`

- [ ] **Krok 1: Napiš padající test značek**

`packages/contracts/test/markers.golden.test.ts`:

```ts
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { writeGoldenReport } from './golden-report.js';
import {
  CLICK_MARKER_PREFIX, countClickMarkers, deriveLinkId, FILTER_SLOT_PATTERN, findLeftoverMarker,
  OPEN_PIXEL_MARKER, openPixelHtml, RAW_SLOT_PATTERN, RAW_SLOT_PREFIX, RESERVED_MARKERS,
  replaceClickMarkers, replaceOpenPixel,
} from '../src/markers.js';

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'markers');

type MarkerFixture = {
  id: string;
  description: string;
  source: string;
  tracking_domain: string;
  link_tokens: Record<string, string>;
  open_token?: string | null;
  expected: string;
  expected_replacements: number;
};

const files = (await readdir(fixturesDir)).filter((f) => f.endsWith('.json')).sort();
const fixtures: MarkerFixture[] = await Promise.all(
  files.map(async (f) => JSON.parse(await readFile(path.join(fixturesDir, f), 'utf8')) as MarkerFixture),
);
const executed: string[] = [];

afterAll(async () => {
  await writeGoldenReport({
    section: 'markers',
    total: fixtures.length,
    ids: executed,
    files: files.map((file) => path.join(fixturesDir, file)),
  });
});

describe('kontrakt 5: značky', () => {
  it('má přesné tvary značek a čtyři vyhrazené řetězce', () => {
    expect(CLICK_MARKER_PREFIX).toBe('https://track.mlain.invalid/c/');
    expect(OPEN_PIXEL_MARKER).toBe('<!--ML_OPEN_PIXEL-->');
    expect(RESERVED_MARKERS).toEqual(['mlain.invalid', 'ML_OPEN_PIXEL', 'ML_ARG_', 'ML_RAW_']);
  });

  it('vyhrazený řetězec se pozná i malými písmeny', () => {
    // P08 generuje slot syrového bloku malými písmeny, kdežto kontrakt ho píše
    // velkými. Porovnání citlivé na velikost by `ml_raw_0001` propustilo
    // a zbytek značky by odešel příjemci. Rozhodnutí D16.
    expect(findLeftoverMarker('<p>ml_raw_0001</p>')).toBe('ML_RAW_');
    expect(findLeftoverMarker('<p>ML_RAW_0001</p>')).toBe('ML_RAW_');
    expect(findLeftoverMarker('<p>MLAIN.INVALID</p>')).toBe('mlain.invalid');
    expect(findLeftoverMarker('<p>nic zvláštního</p>')).toBeUndefined();
  });

  it('pixel má přesný tvar náhrady', () => {
    expect(openPixelHtml('https://t.example.cz/t/o/t1abc')).toBe(
      '<img src="https://t.example.cz/t/o/t1abc" width="1" height="1" alt="" ' +
        'style="display:none;max-height:0;overflow:hidden" />',
    );
  });

  it('deriveLinkId je deterministické a nulová kampaň dá stabilní hodnotu', () => {
    const a = deriveLinkId('0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071', 1);
    const b = deriveLinkId('0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071', 1);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(deriveLinkId('0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071', 2)).not.toBe(a);
  });

  it('je deset fixtur značek', () => {
    expect(fixtures).toHaveLength(10);
  });

  it.each(fixtures)('$id $description', (fixture) => {
    const clicks = replaceClickMarkers(fixture.source, (linkId) => {
      const token = fixture.link_tokens[linkId];
      if (!token) throw new Error(`neznámé link_id ${linkId}`);
      return `${fixture.tracking_domain}/t/c/${token}`;
    });
    const withPixel = fixture.open_token
      ? replaceOpenPixel(clicks.output, openPixelHtml(`${fixture.tracking_domain}/t/o/${fixture.open_token}`))
      : replaceOpenPixel(clicks.output, '');

    expect(withPixel.output).toBe(fixture.expected);
    expect(clicks.count).toBe(fixture.expected_replacements);
    expect(findLeftoverMarker(withPixel.output)).toBeUndefined();
    executed.push(fixture.id);
  });

  it('zbylá značka po náhradě je chyba marker_not_replaced', () => {
    expect(findLeftoverMarker('<a href="https://track.mlain.invalid/c/x">a</a>')).toBe('mlain.invalid');
  });

  it.each([
    // ŽETONY OPSANÉ Z P08, ne vymyšlené. Test, který si vstup vyrobí podle
    // vlastní představy, tuhle chybu nezachytí, a přesně proto přežila:
    // vzor /ML_RAW_(\d{4})/ nenašel ani jeden z těchhle čtyř řetězců.
    ['ML_RAW_ab12cd34ef_0001', 'ab12cd34ef', '0001'], // rawPrefix z testů P08
    ['ml_raw_ab12cd34ef_0001', 'ab12cd34ef', '0001'], // P08 generuje malými písmeny
    ['ML_RAW_goldennonce_0001', 'goldennonce', '0001'], // pevný nonce golden fixtures
    ['ML_RAW_contractnonce_0012', 'contractnonce', '0012'], // pevný nonce fixtur kontraktu
  ])('slot syrového bloku %s se najde i s nonce', (token, nonce, index) => {
    RAW_SLOT_PATTERN.lastIndex = 0;
    const match = RAW_SLOT_PATTERN.exec(token);
    expect(match, `${token} se nenašel`).not.toBeNull();
    expect(match![1].toLowerCase()).toBe(nonce);
    expect(match![2]).toBe(index);
  });

  it('slot syrového bloku se nepoplete se slotem argumentu filtru', () => {
    RAW_SLOT_PATTERN.lastIndex = 0;
    expect(RAW_SLOT_PATTERN.test('ML_ARG_0007')).toBe(false);
    FILTER_SLOT_PATTERN.lastIndex = 0;
    expect(FILTER_SLOT_PATTERN.test('ML_RAW_ab12cd34ef_0001')).toBe(false);
  });

  it('slot argumentu filtru se hledá bez ohledu na velikost písmen', () => {
    // ML_ARG_ má číslo hned za předponou, tenhle vzor tedy sedí a nemění se.
    expect('ml_arg_0007'.match(FILTER_SLOT_PATTERN)).toEqual(['ml_arg_0007']);
    expect('ML_ARG_1234'.match(FILTER_SLOT_PATTERN)).toEqual(['ML_ARG_1234']);
  });

  it('neparsovatelné UUID za prefixem je chyba, ne tichý přeskok', () => {
    expect(() => replaceClickMarkers(`<a href="${CLICK_MARKER_PREFIX}nic">x</a>`, () => 'u')).toThrow(
      /neplatné link_id/,
    );
  });

  it('počet ve zdroji se porovnává rovností, ve vyrenderovaném výstupu jen shora', () => {
    const source = `${CLICK_MARKER_PREFIX}0192f3a0-1c2d-7e42-9c3d-4e5f60718293`;
    expect(countClickMarkers(source + source)).toBe(2);
    expect(countClickMarkers('')).toBe(0);
  });
});
```

- [ ] **Krok 2: Spusť a ověř, že padá**

Run: `pnpm --filter @mlain/contracts exec vitest run --project golden test/markers.golden.test.ts`
Expected: FAIL, `Cannot find module '../src/markers.js'`.

- [ ] **Krok 3: Napiš `src/markers.ts`**

```ts
import { createHash } from 'node:crypto';

/**
 * Kontrakt 5: předání zkompilované šablony senderu.
 * Vlastní ho část 3 (kapitola 4.1), tenhle balíček drží jeho jazykově neutrální
 * půlku: přesné tvary značek, jednoprůchodovou náhradu a kontroly počtů.
 *
 * Značka odkazu je absolutní URL na doméně .invalid schválně: doména je
 * rezervovaná RFC 2606 a nikdy se nerozpustí, takže NEPROBĚHLÁ ZÁMĚNA DÁ
 * INERTNÍ ODKAZ, ne funkční odkaz na cizí server.
 */
export const CLICK_MARKER_PREFIX = 'https://track.mlain.invalid/c/';
export const OPEN_PIXEL_MARKER = '<!--ML_OPEN_PIXEL-->';
export const LINK_ID_LENGTH = 36;

/**
 * Vyhrazené řetězce, které validátor odmítne v jakémkoliv uživatelském textu
 * a které po náhradě nesmí zůstat ve výstupu.
 *
 * `ML_RAW_` je slot syrového bloku a žádá si ho P08. Kontrakt ho píše velkými
 * písmeny, ale P08 ho generuje malými, takže se porovnává BEZ OHLEDU NA VELIKOST
 * (rozhodnutí D16). Rozšíření je bezpečné: jsou to vyhrazené řetězce, takže
 * i `MLAIN.INVALID` v uživatelském textu má být odmítnuté.
 */
export const RESERVED_MARKERS = ['mlain.invalid', 'ML_OPEN_PIXEL', 'ML_ARG_', 'ML_RAW_'] as const;

/** Slot argumentu filtru: `ML_ARG_` plus čtyři číslice, viz část 3, 3.3.5a. */
export const FILTER_SLOT_PREFIX = 'ML_ARG_';
export const FILTER_SLOT_PATTERN = /ML_ARG_(\d{4})/gi;

/**
 * Slot syrového bloku: `ML_RAW_<nonce>_nnnn`.
 *
 * Mezi předponou a číslem je NONCE, ne rovnou číslice. P08 ho generuje na každý
 * render znovu (`randomBytes(8).toString('hex').slice(0, 10)`), aby uživatelský
 * text nemohl cizí slot odklonit ani při chybě validátoru, a v golden fixtures
 * ho přebíjí pevnou hodnotou, aby byl výstup deterministický.
 *
 * Délka nonce se proto NEVYNUCUJE. V produkci má deset znaků, ale fixtures P08
 * používají `goldennonce` (11) a `contractnonce` (13); vzor s `{10}` by na nich
 * spadl. Dřívější znění mělo `/ML_RAW_(\d{4})/gi`, což nenajde **ani jeden**
 * skutečný žeton, a byl to mrtvý kód, na který by někdo spoléhal.
 */
export const RAW_SLOT_PREFIX = 'ML_RAW_';
export const RAW_SLOT_PATTERN = /ML_RAW_([a-z0-9]+)_(\d{4})/gi;

/** Jmenný prostor pro UUIDv5, ze kterého se odvozuje link_id. */
export const LINK_ID_NAMESPACE = '6f9619ff-8b86-d011-b42d-00c04fc964ff';
export const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function openPixelHtml(url: string): string {
  return `<img src="${url}" width="1" height="1" alt="" style="display:none;max-height:0;overflow:hidden" />`;
}

/**
 * Deterministické odvození link_id. Kompilace může proběhnout víckrát
 * (předodesílací kontrola, odeslání, oprava pozastavené kampaně) a náhodné UUID
 * by změnilo compiled_html mezi běhy, rozpadlo golden fixtures a klik zaznamenaný
 * proti staré verzi by ukazoval na řádek, který už neexistuje.
 */
export function deriveLinkId(campaignId: string, position: number): string {
  const namespace = Buffer.from(LINK_ID_NAMESPACE.replace(/-/g, ''), 'hex');
  const name = Buffer.from(`${campaignId}:${position}`, 'utf8');
  const hash = createHash('sha1').update(namespace).update(name).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * Jeden průchod přes pevný prefix, ne ReplaceAll v cyklu přes odkazy.
 * Při dvaceti odkazech a stokilobajtovém dokumentu by cyklus znamenal dvacet
 * průchodů, tedy 2 MB skenování na zprávu. Počet náhrad padá jako vedlejší produkt.
 */
export function replaceClickMarkers(
  source: string,
  resolve: (linkId: string) => string,
): { output: string; count: number } {
  let out = '';
  let cursor = 0;
  let count = 0;
  for (;;) {
    const index = source.indexOf(CLICK_MARKER_PREFIX, cursor);
    if (index === -1) break;
    const linkId = source.slice(index + CLICK_MARKER_PREFIX.length, index + CLICK_MARKER_PREFIX.length + LINK_ID_LENGTH);
    if (!UUID_PATTERN.test(linkId)) {
      throw new Error(`neplatné link_id za značkou na pozici ${index}: ${JSON.stringify(linkId)}`);
    }
    out += source.slice(cursor, index) + resolve(linkId);
    cursor = index + CLICK_MARKER_PREFIX.length + LINK_ID_LENGTH;
    count += 1;
  }
  return { output: out + source.slice(cursor), count };
}

/** Pixel se nahrazuje jednou, ne všude. Kontrakt garantuje právě jeden výskyt. */
export function replaceOpenPixel(source: string, replacement: string): { output: string; count: number } {
  const index = source.indexOf(OPEN_PIXEL_MARKER);
  if (index === -1) return { output: source, count: 0 };
  return {
    output: source.slice(0, index) + replacement + source.slice(index + OPEN_PIXEL_MARKER.length),
    count: 1,
  };
}

export function countClickMarkers(source: string): number {
  let count = 0;
  let cursor = 0;
  for (;;) {
    const index = source.indexOf(CLICK_MARKER_PREFIX, cursor);
    if (index === -1) return count;
    count += 1;
    cursor = index + CLICK_MARKER_PREFIX.length;
  }
}

/**
 * Po náhradě nesmí ve výstupu zůstat žádný vyhrazený řetězec. Porovnává se po
 * převodu obou stran na malá písmena, viz rozhodnutí D16. Vrací se řetězec
 * v kontraktním tvaru, ne ten nalezený, aby hláška byla vždy stejná.
 */
export function findLeftoverMarker(output: string): string | undefined {
  const haystack = output.toLowerCase();
  return RESERVED_MARKERS.find((marker) => haystack.includes(marker.toLowerCase()));
}

/**
 * Tři kontroly počtu, které se NESMÍ slít do jedné. Liší se místem, četností
 * i porovnáním; kdyby se slily, buď se kampaň s podmíněným odkazem zastaví hned
 * na startu, nebo injektáž projde.
 */
export const MARKER_COUNT_CHECKS = Object.freeze({
  /** zdroj šablony, jednou při načtení kampaně do cache, rovnost */
  source: 'equals',
  /** výstup po náhradě, per zpráva, hledá zbytek */
  afterReplace: 'no-leftover',
  /** vyrenderovaný výstup, jen u náhradní cesty A, POUZE shora */
  rendered: 'not-greater',
});
```

Porovnání u vyrenderovaného výstupu je `>`, nikdy `!=`. Značka může ležet uvnitř `{% if %}`, který se pro daného příjemce vyhodnotí jako nepravda, takže **nižší počet je zcela legitimní**. S `!=` by kampaň s podmíněným odkazem selhala u každého příjemce, který do podmínky nespadá.

- [ ] **Krok 4: Zapiš deset fixtur značek**

Soubory `packages/contracts/fixtures/markers/MK-0NN.json`. Token je v nich zkrácená, ale realisticky vypadající hodnota; kontrakt na jeho obsahu v téhle vrstvě nestojí.

```json
{ "id": "MK-001", "description": "jeden odkaz v HTML a pixel před koncem body", "source": "<html><body><a href=\"https://track.mlain.invalid/c/2f1a9c40-0000-4000-8000-000000000001\">Akce</a><!--ML_OPEN_PIXEL--></body></html>", "tracking_domain": "https://t.example.cz", "link_tokens": { "2f1a9c40-0000-4000-8000-000000000001": "t1CLICK1" }, "open_token": "t1OPEN1", "expected": "<html><body><a href=\"https://t.example.cz/t/c/t1CLICK1\">Akce</a><img src=\"https://t.example.cz/t/o/t1OPEN1\" width=\"1\" height=\"1\" alt=\"\" style=\"display:none;max-height:0;overflow:hidden\" /></body></html>", "expected_replacements": 1 }
```
```json
{ "id": "MK-002", "description": "trackClicks vypnuté, žádná značka, cílová URL zůstává i s escapovaným ampersandem", "source": "<a href=\"https://shop.cz/akce?a=1&amp;b=2\">Akce</a>", "tracking_domain": "https://t.example.cz", "link_tokens": {}, "open_token": null, "expected": "<a href=\"https://shop.cz/akce?a=1&amp;b=2\">Akce</a>", "expected_replacements": 0 }
```
```json
{ "id": "MK-003", "description": "trackOpens vypnuté, komentář v šabloně není a nic se nedoplňuje", "source": "<html><body><p>ahoj</p></body></html>", "tracking_domain": "https://t.example.cz", "link_tokens": {}, "open_token": null, "expected": "<html><body><p>ahoj</p></body></html>", "expected_replacements": 0 }
```
```json
{ "id": "MK-004", "description": "dva různé odkazy dostanou různé tokeny", "source": "<a href=\"https://track.mlain.invalid/c/2f1a9c40-0000-4000-8000-000000000001\">A</a><a href=\"https://track.mlain.invalid/c/2f1a9c40-0000-4000-8000-000000000002\">B</a>", "tracking_domain": "https://t.example.cz", "link_tokens": { "2f1a9c40-0000-4000-8000-000000000001": "t1CLICK1", "2f1a9c40-0000-4000-8000-000000000002": "t1CLICK2" }, "open_token": null, "expected": "<a href=\"https://t.example.cz/t/c/t1CLICK1\">A</a><a href=\"https://t.example.cz/t/c/t1CLICK2\">B</a>", "expected_replacements": 2 }
```
```json
{ "id": "MK-005", "description": "tentýž cíl podruhé má stejné link_id a dostane tentýž token", "source": "<a href=\"https://track.mlain.invalid/c/2f1a9c40-0000-4000-8000-000000000001\">A</a><a href=\"https://track.mlain.invalid/c/2f1a9c40-0000-4000-8000-000000000001\">A znovu</a>", "tracking_domain": "https://t.example.cz", "link_tokens": { "2f1a9c40-0000-4000-8000-000000000001": "t1CLICK1" }, "open_token": null, "expected": "<a href=\"https://t.example.cz/t/c/t1CLICK1\">A</a><a href=\"https://t.example.cz/t/c/t1CLICK1\">A znovu</a>", "expected_replacements": 2 }
```
```json
{ "id": "MK-006", "description": "mailto a tel se nemění", "source": "<a href=\"mailto:info@example.cz\">mail</a><a href=\"tel:+420800123456\">tel</a>", "tracking_domain": "https://t.example.cz", "link_tokens": {}, "open_token": null, "expected": "<a href=\"mailto:info@example.cz\">mail</a><a href=\"tel:+420800123456\">tel</a>", "expected_replacements": 0 }
```
```json
{ "id": "MK-007", "description": "tlačítko s VML dvojčetem: jedna záměna opraví obě místa shodně", "source": "<!--[if mso]><v:roundrect href=\"https://track.mlain.invalid/c/2f1a9c40-0000-4000-8000-000000000003\"><![endif]--><a href=\"https://track.mlain.invalid/c/2f1a9c40-0000-4000-8000-000000000003\">Koupit</a>", "tracking_domain": "https://t.example.cz", "link_tokens": { "2f1a9c40-0000-4000-8000-000000000003": "t1CLICK3" }, "open_token": null, "expected": "<!--[if mso]><v:roundrect href=\"https://t.example.cz/t/c/t1CLICK3\"><![endif]--><a href=\"https://t.example.cz/t/c/t1CLICK3\">Koupit</a>", "expected_replacements": 2 }
```
```json
{ "id": "MK-008", "description": "systémový tag jako celý href zůstává Liquid výrazem", "source": "<a href=\"{{ unsubscribe_url }}\">Odhlásit</a>", "tracking_domain": "https://t.example.cz", "link_tokens": {}, "open_token": null, "expected": "<a href=\"{{ unsubscribe_url }}\">Odhlásit</a>", "expected_replacements": 0 }
```
```json
{ "id": "MK-009", "description": "prostý text: značka stojí sama na nezalomeném řádku a náhrada nezmění okolí", "source": "Podívejte se na akci:\nhttps://track.mlain.invalid/c/2f1a9c40-0000-4000-8000-000000000001\n\nS pozdravem", "tracking_domain": "https://t.example.cz", "link_tokens": { "2f1a9c40-0000-4000-8000-000000000001": "t1CLICK1" }, "open_token": null, "expected": "Podívejte se na akci:\nhttps://t.example.cz/t/c/t1CLICK1\n\nS pozdravem", "expected_replacements": 1 }
```
```json
{ "id": "MK-010", "description": "markup laděný pro Outlook zůstane bajtově beze změny mimo nahrazený úsek", "source": "<!--[if mso | IE]><table role=\"presentation\" border=\"0\" cellpadding=\"0\" cellspacing=\"0\"><tr><td style=\"line-height:0px;font-size:0px;mso-line-height-rule:exactly;\"><![endif]--><a href=\"https://track.mlain.invalid/c/2f1a9c40-0000-4000-8000-000000000004\">X</a><!--[if mso | IE]></td></tr></table><![endif]-->", "tracking_domain": "https://t.example.cz", "link_tokens": { "2f1a9c40-0000-4000-8000-000000000004": "t1CLICK4" }, "open_token": null, "expected": "<!--[if mso | IE]><table role=\"presentation\" border=\"0\" cellpadding=\"0\" cellspacing=\"0\"><tr><td style=\"line-height:0px;font-size:0px;mso-line-height-rule:exactly;\"><![endif]--><a href=\"https://t.example.cz/t/c/t1CLICK4\">X</a><!--[if mso | IE]></td></tr></table><![endif]-->", "expected_replacements": 1 }
```

- [ ] **Krok 5: Napiš Go runner značek**

Go implementaci značek vlastní P09 v `internal/markers` (rozhodnutí D8), tenhle plán dodává runner. Přidej do `apps/sender/internal/contracts/golden.go`:

```go
// ---------------------------------------------------------------- kontrakt 5 --

type markerFixture struct {
	ID                   string            `json:"id"`
	Description          string            `json:"description"`
	Source               string            `json:"source"`
	TrackingDomain       string            `json:"tracking_domain"`
	LinkTokens           map[string]string `json:"link_tokens"`
	OpenToken            *string           `json:"open_token"`
	Expected             string            `json:"expected"`
	ExpectedReplacements int               `json:"expected_replacements"`
}

// MarkersRunner drží produkční funkce P09. Jména se v P09 liší (ReplaceLinks,
// ReplacePixel, HasResidual), proto je runner bere jako hodnoty a překlad jmen
// je v tenkém adaptéru, ne tady.
type MarkersRunner struct {
	ReplaceLinks func(src string, tokenFor func(linkID string) (string, error)) (string, int, error)
	ReplacePixel func(src, replacement string) (string, int)
	HasResidual  func(s string) bool
	PixelHTML    func(url string) string
}

func CheckMarkersGolden(names []string, read func(string) ([]byte, error), runner MarkersRunner) (Outcome, error) {
	outcome := Outcome{}
	for _, name := range names {
		raw, err := read(name)
		if err != nil {
			return Outcome{}, fmt.Errorf("%s: %w", name, err)
		}
		var fixture markerFixture
		if err := json.Unmarshal(raw, &fixture); err != nil {
			return Outcome{}, fmt.Errorf("%s: %w", name, err)
		}
		outcome.Total++

		out, count, err := runner.ReplaceLinks(fixture.Source, func(linkID string) (string, error) {
			token, ok := fixture.LinkTokens[linkID]
			if !ok {
				return "", fmt.Errorf("neznámé link_id %s", linkID)
			}
			return fixture.TrackingDomain + "/t/c/" + token, nil
		})
		if err != nil {
			outcome.Mismatches = append(outcome.Mismatches, Mismatch{fixture.ID, "náhrada selhala: " + err.Error()})
			continue
		}
		if count != fixture.ExpectedReplacements {
			outcome.Mismatches = append(outcome.Mismatches, Mismatch{fixture.ID,
				fmt.Sprintf("počet náhrad %d, čekal se %d", count, fixture.ExpectedReplacements)})
			continue
		}
		pixel := ""
		if fixture.OpenToken != nil {
			pixel = runner.PixelHTML(fixture.TrackingDomain + "/t/o/" + *fixture.OpenToken)
		}
		out, _ = runner.ReplacePixel(out, pixel)
		if out != fixture.Expected {
			outcome.Mismatches = append(outcome.Mismatches, Mismatch{fixture.ID,
				fmt.Sprintf("výstup se rozešel s TypeScript stranou\n  Go: %q\n  TS: %q", out, fixture.Expected)})
			continue
		}
		if runner.HasResidual(out) {
			outcome.Mismatches = append(outcome.Mismatches, Mismatch{fixture.ID,
				"ve výstupu zůstal vyhrazený řetězec"})
			continue
		}
		outcome.IDs = append(outcome.IDs, fixture.ID)
	}
	return outcome, nil
}

func RunMarkersGolden(t *testing.T, runner MarkersRunner) {
	t.Helper()
	names, err := ListFixtures("markers")
	if err != nil {
		t.Fatalf("fixtures: %v", err)
	}
	if len(names) != 10 {
		t.Fatalf("čekám 10 fixtur značek, je jich %d", len(names))
	}
	outcome, err := CheckMarkersGolden(names, func(name string) ([]byte, error) {
		return ReadFixture("markers/" + name)
	}, runner)
	if err != nil {
		t.Fatalf("%v", err)
	}
	finish(t, "markers", outcome, names)
}
```

Test runneru přidej do `apps/sender/internal/contracts/golden_test.go`:

```go
func TestCheckMarkersGoldenOdhaliNecinnouNahradu(t *testing.T) {
	names, err := ListFixtures("markers")
	if err != nil {
		t.Fatalf("fixtures: %v", err)
	}
	outcome, err := CheckMarkersGolden(names, func(name string) ([]byte, error) {
		return ReadFixture("markers/" + name)
	}, MarkersRunner{
		// Nahrazuje nic a tvrdí, že nahradila všechno.
		ReplaceLinks: func(src string, _ func(string) (string, error)) (string, int, error) {
			return src, 99, nil
		},
		ReplacePixel: func(src, _ string) (string, int) { return src, 0 },
		HasResidual:  func(string) bool { return false },
		PixelHTML:    func(string) string { return "" },
	})
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if len(outcome.Mismatches) != outcome.Total {
		t.Fatalf("runner propustil nečinnou náhradu u %d z %d fixtur",
			outcome.Total-len(outcome.Mismatches), outcome.Total)
	}
}
```

`apps/sender/internal/markers/golden_test.go` (vlastní P09):

```go
package markers_test

import (
	"testing"

	"github.com/google/uuid"
	"github.com/nc-mill/mlain/apps/sender/internal/contracts"
	"github.com/nc-mill/mlain/apps/sender/internal/markers"
)

func TestGoldenMarkers(t *testing.T) {
	contracts.RunMarkersGolden(t, contracts.MarkersRunner{
		ReplaceLinks: func(src string, tokenFor func(string) (string, error)) (string, int, error) {
			return markers.ReplaceLinks(src, func(linkID uuid.UUID) (string, error) {
				return tokenFor(linkID.String())
			})
		},
		ReplacePixel: func(src, replacement string) (string, int) {
			out, replaced := markers.ReplacePixel(src, replacement)
			if replaced {
				return out, 1
			}
			return out, 0
		},
		HasResidual: markers.HasResidual,
		PixelHTML:   markers.PixelHTML,
	})
}
```

Tři věci si P09 musí doplnit a jsou součástí požadavku P02→P09.1. `markers.PixelHTML(url string) string` dnes neexistuje a HTML pixelu si skládá worker inline, takže tvar značky není nikde jedním zdrojem. `markers.HasResidual` hledá jen `mlain.invalid`, kdežto kontrakt má čtyři vyhrazené řetězce a porovnání má být bez ohledu na velikost písmen (rozhodnutí D16). A `DeriveLinkID` v Go není vůbec: sender `link_id` jen čte ze značky, odvozuje ho kompilace v P08, takže Go protějšek `deriveLinkId` **není potřeba** a runner ho nevyžaduje.

- [ ] **Krok 6: Spusť obě strany a ověř shodu**

Run: `pnpm --filter @mlain/contracts run test:golden && cd apps/sender && go vet ./internal/contracts/ && go test ./internal/contracts/ -v`
Expected: PASS na obou stranách. Go strana ve vlně 0 testuje runner, ne produkční kód; ten pod něj zapojí P09.

- [ ] **Krok 7: Napiš runner fixtur kompilované šablony**

Fixtures `CT-001` až `CT-018` potřebují blokový model a React renderer, které vlastní P08, takže **data píše P08** (rozhodnutí D4 a R3). Aby si je P08 nemusel ověřovat vlastním kódem a aby se obě strany nerozešly v tom, co znamená „sedí", dodává tenhle plán **sdílené tvrzení**, které P08 zavolá se svým vyrenderovaným výstupem.

`packages/contracts/src/compiled.ts`:

```ts
import { countClickMarkers, findLeftoverMarker, OPEN_PIXEL_MARKER } from './markers.js';

/**
 * Fixture kontraktu 5. `document` a `context` jsou VSTUP renderu (vlastní P08),
 * `compiled` je jeho VÝSTUP a `expect` jsou tvrzení, která nad výstupem platí.
 *
 * Pole `compiled` tady je proto, že tutéž fixture čte i Go strana, která blokový
 * model nezná a renderer nemá: sender dostává hotové compiled_html a compiled_text
 * a jen v nich nahrazuje značky.
 */
export type CompiledFixture = {
  id: string;
  description: string;
  document: Record<string, unknown>;
  context: { campaignId?: string; trackOpens: boolean; trackClicks: boolean; language: string; purpose?: string };
  compiled?: { html: string; text: string };
  expect: {
    htmlContains?: string[];
    textContains?: string[];
    clickMarkerCount?: number;
    hasOpenPixelSlot?: boolean;
    error?: string;
  };
};

export type CompiledMismatch = { id: string; detail: string };

/**
 * Ověří vyrenderovaný výstup proti tvrzením fixture. Vrací seznam neshod místo
 * házení výjimky, aby volající viděl všechny naráz; jedna neshoda na jedno
 * tvrzení se hledá líp než první, o kterou se test zarazil.
 */
export function assertCompiledFixture(
  fixture: CompiledFixture,
  rendered: { html: string; text: string },
): CompiledMismatch[] {
  const out: CompiledMismatch[] = [];
  const add = (detail: string): void => void out.push({ id: fixture.id, detail });

  for (const needle of fixture.expect.htmlContains ?? []) {
    if (!rendered.html.includes(needle)) add(`HTML neobsahuje ${JSON.stringify(needle)}`);
  }
  for (const needle of fixture.expect.textContains ?? []) {
    if (!rendered.text.includes(needle)) add(`text neobsahuje ${JSON.stringify(needle)}`);
  }

  if (fixture.expect.clickMarkerCount !== undefined) {
    const total = countClickMarkers(rendered.html) + countClickMarkers(rendered.text);
    if (total !== fixture.expect.clickMarkerCount) {
      add(`značek odkazu je ${total}, čeká se ${fixture.expect.clickMarkerCount}`);
    }
  }

  if (fixture.expect.hasOpenPixelSlot !== undefined) {
    const present = rendered.html.includes(OPEN_PIXEL_MARKER);
    if (present !== fixture.expect.hasOpenPixelSlot) {
      add(`slot pixelu je ${present ? 'přítomný' : 'chybějící'}, čeká se opak`);
    }
    // Kontrakt garantuje PRÁVĚ JEDEN výskyt. Druhý by po náhradě zůstal
    // v dokumentu a odešel příjemci, protože pixel se nahrazuje jednou.
    const occurrences = rendered.html.split(OPEN_PIXEL_MARKER).length - 1;
    if (present && occurrences !== 1) add(`slot pixelu je v HTML ${occurrences}krát, smí být jednou`);
  }

  // Značka odkazu smí zůstat, tu nahrazuje až sender. Cokoliv jiného ne.
  const withoutLinks = rendered.text.replaceAll('mlain.invalid', '');
  const leftover = findLeftoverMarker(withoutLinks);
  if (leftover !== undefined) add(`v textové části zůstal vyhrazený řetězec ${leftover}`);

  return out;
}
```

`packages/contracts/test/compiled.golden.test.ts`:

```ts
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assertCompiledFixture, type CompiledFixture } from '../src/compiled.js';

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'compiled');
const files = (await readdir(fixturesDir)).filter((f) => f.endsWith('.json')).sort();

describe('kontrakt 5: fixtures kompilované šablony', () => {
  it('adresář je buď prázdný, nebo úplný; nikdy rozdělaný', () => {
    // Data píše P08. Do té doby je adresář prázdný a to je v pořádku.
    // Osmnáct je počet z části 3, tedy od vlastníka kontraktu (nález N6).
    expect(files.length === 0 || files.length === 18).toBe(true);
    if (files.length === 18) {
      expect(files).toEqual(
        Array.from({ length: 18 }, (_, i) => `CT-${String(i + 1).padStart(3, '0')}.json`),
      );
    }
  });

  it.each(files)('%s má vyrenderovaný výstup a jeho tvrzení sedí', async (file) => {
    const fixture = JSON.parse(await readFile(path.join(fixturesDir, file), 'utf8')) as CompiledFixture;
    expect(fixture.compiled, `${fixture.id}: chybí compiled.html a compiled.text`).toBeDefined();
    expect(assertCompiledFixture(fixture, fixture.compiled!)).toEqual([]);
  });

  it('tvrzení odhalí chybějící slot pixelu a přebývající značku', () => {
    const fixture: CompiledFixture = {
      id: 'CT-000',
      description: 'umělá fixture pro test samotného tvrzení',
      document: {},
      context: { trackOpens: true, trackClicks: true, language: 'cs' },
      expect: { clickMarkerCount: 1, hasOpenPixelSlot: true, textContains: ['Odhlásit'] },
    };
    const mismatches = assertCompiledFixture(fixture, { html: '<p>nic</p>', text: 'ML_RAW_0001' });
    const details = mismatches.map((m) => m.detail).join('\n');
    expect(details).toMatch(/značek odkazu je 0/);
    expect(details).toMatch(/slot pixelu/);
    expect(details).toMatch(/neobsahuje "Odhlásit"/);
    expect(details).toMatch(/ML_RAW_/);
  });
});
```

Poslední test je ten důležitý: bez něj by runner nad prázdným adresářem prošel zeleně, aniž by kdokoliv ověřil, že vůbec něco odmítá. Až P08 fixtures doplní, `it.each` se rozjede nad osmnácti soubory beze změny kódu.

- [ ] **Krok 8: Commit**

```bash
git add packages/contracts/src/markers.ts packages/contracts/src/compiled.ts packages/contracts/fixtures/markers packages/contracts/test/markers.golden.test.ts packages/contracts/test/compiled.golden.test.ts apps/sender/internal/contracts
git commit -m "feat(contracts): kontrakt 5, značky odkazu a pixelu s jednoprůchodovou náhradou"
```

---

### Úkol 18: JSON schémata fixtures a job `contracts-fixtures-schema`

Struktura každého souboru je popsaná JSON schématem, takže se nemůže stát, že jedna strana čte pole, které druhá neposílá.

**Files:**
- Create: `packages/contracts/schema/*.schema.json` (devět souborů, jména podle rozhodnutí D12)
- Create: `packages/contracts/scripts/validate-fixtures.ts`
- Test: `packages/contracts/test/fixtures-schema.test.ts`

- [ ] **Krok 1: Napiš padající test**

`packages/contracts/test/fixtures-schema.test.ts`:

```ts
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { validateAllFixtures } from '../scripts/validate-fixtures.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

describe('schémata fixtures', () => {
  it('každý adresář fixtures má schéma pojmenované tak, jak ho hledá P01', async () => {
    // tools/ci/contracts-fixtures-schema.mjs skládá jméno jako
    // `<první segment cesty fixture>.schema.json`. Kontrola se proto POČÍTÁ
    // z adresářů, ne ze zapsaného seznamu: ten by po přidání skupiny zůstal
    // zelený a job v CI by spadl.
    const dirs = (await readdir(path.join(packageRoot, 'fixtures'), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(dirs).toEqual(['compiled', 'crypto', 'liquid', 'markers', 'message-id', 'outbox', 'token']);

    const schemas = new Set(await readdir(path.join(packageRoot, 'schema')));
    const missing = dirs.filter((dir) => !schemas.has(`${dir}.schema.json`));
    expect(missing, `skupiny bez schématu: ${missing.join(', ')}`).toEqual([]);
  });

  it('má i dvě schémata mimo skupiny fixtures a generovaný manifest sloupců', async () => {
    const schemas = await readdir(path.join(packageRoot, 'schema'));
    expect(schemas).toContain('config.schema.json'); // popisuje config.json v kořeni balíčku
    expect(schemas).toContain('columns.schema.json'); // popisuje schema/columns.json
    expect(schemas).toContain('columns.json'); // GENEROVANÝ, čte ho tools/ci/contracts-schema.mjs
  });

  it('všechny fixtures projdou validací proti schématu', async () => {
    const result = await validateAllFixtures(packageRoot);
    expect(result.errors).toEqual([]);
    // 55 Liquid + 10 značek + token + crypto + message-id + scenarios + columns.json = 70.
    // Číslo je součet, ne odhad, a mění se s každou přidanou fixture.
    expect(result.validated).toBe(70);
  });

  it('fixture s neznámým polem neprojde', async () => {
    const result = await validateAllFixtures(packageRoot, {
      extra: [{ file: 'umely.json', schema: 'liquid', data: { id: 'LQ-999', template: 'x', vymysl: 1 } }],
    });
    expect(result.errors.join('\n')).toContain('umely.json');
  });
});
```

- [ ] **Krok 2: Spusť a ověř, že padá**

Run: `pnpm --filter @mlain/contracts exec vitest run --project unit test/fixtures-schema.test.ts`
Expected: FAIL, `Cannot find module '../scripts/validate-fixtures.js'`.

- [ ] **Krok 3: Napiš schémata**

`packages/contracts/schema/liquid.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://mlain.local/schema/liquid.schema.json",
  "title": "Golden fixture Liquid subsetu",
  "type": "object",
  "additionalProperties": false,
  "required": ["id", "description", "template"],
  "properties": {
    "id": { "type": "string", "pattern": "^LQ-[0-9]{3}$" },
    "description": { "type": "string", "minLength": 1 },
    "context": { "enum": ["html", "text"] },
    "level": { "enum": ["authored", "compiled"] },
    "template": { "type": "string" },
    "data": { "type": "object" },
    "presence": { "type": "array", "items": { "type": "string" } },
    "expected": { "type": "string" },
    "expect_validation_error": {
      "type": "object",
      "additionalProperties": false,
      "required": ["code"],
      "properties": {
        "code": { "type": "string", "pattern": "^liquid_[a-z_]+$" },
        "hint_contains": { "type": "string" }
      }
    }
  },
  "oneOf": [{ "required": ["expected"] }, { "required": ["expect_validation_error"] }]
}
```

`packages/contracts/schema/token.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://mlain.local/schema/token.schema.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["contractVersion", "secret_key", "positive", "negative"],
  "properties": {
    "contractVersion": { "const": 1 },
    "note": { "type": "string" },
    "secret_key": { "type": "string" },
    "positive": {
      "type": "array",
      "minItems": 5,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "type", "key_id", "fields", "expected_token", "expected_mac_full"],
        "properties": {
          "id": { "type": "string", "pattern": "^TK-P[0-9]+$" },
          "type": { "enum": ["o", "c", "i", "u"] },
          "key_id": { "type": "integer", "minimum": 1, "maximum": 255 },
          "fields": { "type": "object" },
          "expected_token": { "type": "string", "pattern": "^t1[A-Za-z0-9_-]+$" },
          "expected_mac_full": { "type": "string", "pattern": "^[0-9a-f]{64}$" },
          "sides": { "$ref": "#/$defs/sides" }
        }
      }
    },
    "negative": {
      "type": "array",
      "minItems": 9,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "token", "endpoint_type", "expected_error"],
        "properties": {
          "id": { "type": "string", "pattern": "^TK-N[0-9]+$" },
          "token": { "type": "string" },
          "endpoint_type": { "enum": ["o", "c", "i", "u"] },
          "expected_error": {
            "enum": ["token_malformed", "token_signature_invalid", "token_type_mismatch",
                     "token_unknown_key", "token_expired", "token_already_used"]
          },
          "now": { "type": "integer" },
          "nonce_used": { "type": "boolean" },
          "sides": { "$ref": "#/$defs/sides" }
        }
      }
    }
  },
  "$defs": {
    "sides": {
      "type": "array",
      "minItems": 1,
      "uniqueItems": true,
      "items": { "enum": ["ts", "go"] },
      "description": "Které jazykové strany vektor zpracují. Musí obsahovat aspoň ts."
    }
  }
}
```

Klíč `sides` je povinný, protože z něj `check-parity` počítá očekávanou množinu pro každou stranu. Bez něj by se nedalo odlišit „Go to zpracovat nemůže" od „Go to tiše přeskočilo".

`packages/contracts/schema/crypto.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://mlain.local/schema/crypto.schema.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["contractVersion", "secret_key", "positive", "negative"],
  "properties": {
    "contractVersion": { "const": 1 },
    "secret_key": { "type": "string" },
    "positive": {
      "type": "array",
      "minItems": 1,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "key_id", "context", "workspace_id", "nonce_hex", "plaintext",
                     "expected_header_hex", "expected_aad_hex", "expected_ciphertext_hex",
                     "expected_tag_hex", "expected_stored", "expected_envelope_bytes"],
        "properties": {
          "id": { "type": "string", "pattern": "^CR-P[0-9]+$" },
          "key_id": { "type": "integer", "minimum": 1, "maximum": 255 },
          "context": { "$ref": "#/$defs/context" },
          "sides": { "$ref": "#/$defs/sides" },
          "workspace_id": { "type": "string", "format": "uuid" },
          "nonce_hex": { "type": "string", "pattern": "^[0-9a-f]{24}$" },
          "plaintext": { "type": "string" },
          "expected_header_hex": { "type": "string", "pattern": "^[0-9a-f]+$" },
          "expected_aad_hex": { "type": "string", "pattern": "^[0-9a-f]+$" },
          "expected_ciphertext_hex": { "type": "string", "pattern": "^[0-9a-f]+$" },
          "expected_tag_hex": { "type": "string", "pattern": "^[0-9a-f]{32}$" },
          "expected_stored": { "type": "string", "pattern": "^enc:v1:" },
          "expected_envelope_bytes": { "type": "integer", "minimum": 1 }
        }
      }
    },
    "negative": {
      "type": "array",
      "minItems": 8,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "stored", "context", "workspace_id", "expected_error"],
        "properties": {
          "id": { "type": "string", "pattern": "^CR-N[0-9]+$" },
          "stored": { "type": "string" },
          "context": { "$ref": "#/$defs/context" },
          "sides": { "$ref": "#/$defs/sides" },
          "workspace_id": { "type": "string", "format": "uuid" },
          "expected_error": {
            "enum": ["crypto_envelope_malformed", "crypto_unsupported_version",
                     "crypto_context_mismatch", "crypto_unknown_key", "crypto_auth_failed"]
          }
        }
      }
    }
  },
  "$defs": {
    "context": {
      "enum": ["sending_provider", "ai_provider", "webhook_secret", "oauth_token"],
      "description": "Uzavřený výčet ze 4.10.4. Schéma ho VYNUCUJE, jinak se do fixture dostane kontext, který v produktu nemůže vzniknout."
    },
    "sides": {
      "type": "array",
      "minItems": 1,
      "uniqueItems": true,
      "items": { "enum": ["ts", "go"] }
    }
  }
}
```

Výčet kontextu je tu proto, že bez něj se do negativního vektoru `CR-N2` dostal vymyšlený řetězec `ai_provider_____`, který v `CREDENTIAL_CONTEXTS` není. Fixture pak testovala tvar, jaký produkt nikdy nevyrobí.

`packages/contracts/schema/markers.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://mlain.local/schema/markers.schema.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["id", "description", "source", "tracking_domain", "link_tokens", "expected", "expected_replacements"],
  "properties": {
    "id": { "type": "string", "pattern": "^MK-[0-9]{3}$" },
    "description": { "type": "string", "minLength": 1 },
    "source": { "type": "string" },
    "tracking_domain": { "type": "string" },
    "link_tokens": { "type": "object", "additionalProperties": { "type": "string" } },
    "open_token": { "type": ["string", "null"] },
    "expected": { "type": "string" },
    "expected_replacements": { "type": "integer", "minimum": 0 }
  }
}
```

`packages/contracts/schema/outbox.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://mlain.local/schema/outbox.schema.json",
  "type": "object",
  "additionalProperties": false,
  "required": ["contractVersion", "scenarios", "transitions"],
  "properties": {
    "contractVersion": { "const": 1 },
    "note": { "type": "string" },
    "transitions": {
      "type": "array",
      "minItems": 14,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "from", "to", "actor", "allowed"],
        "properties": {
          "id": { "type": "string", "pattern": "^TR-[0-9]{3}$" },
          "from": { "$ref": "#/$defs/status" },
          "to": { "$ref": "#/$defs/status" },
          "actor": { "enum": ["app", "sender", "reaper"] },
          "error_code": { "type": ["string", "null"] },
          "allowed": { "type": "boolean" }
        }
      }
    },
    "scenarios": {
      "type": "array",
      "minItems": 23,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "runner", "title", "expected"],
        "properties": {
          "id": { "type": "string", "pattern": "^OB-[0-9]{2}$" },
          "runner": { "enum": ["contracts", "sender", "campaigns"] },
          "title": { "type": "string", "minLength": 1 },
          "expected": { "type": "string", "minLength": 1 },
          "order": { "type": "integer" }
        }
      }
    }
  },
  "$defs": {
    "status": { "enum": ["pending", "claimed", "sent", "failed", "skipped"] }
  }
}
```

`packages/contracts/schema/compiled.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://mlain.local/schema/compiled.schema.json",
  "title": "Fixture kontraktu 5. Data píše P08, schéma a runner vlastní P02 (rozhodnutí R3).",
  "type": "object",
  "additionalProperties": false,
  "required": ["id", "description", "document", "context", "compiled", "expect"],
  "properties": {
    "id": { "type": "string", "pattern": "^CT-[0-9]{3}$" },
    "description": { "type": "string", "minLength": 1 },
    "document": { "type": "object" },
    "compiled": {
      "type": "object",
      "additionalProperties": false,
      "required": ["html", "text"],
      "properties": {
        "html": { "type": "string" },
        "text": { "type": "string" }
      },
      "description": "Výstup renderu P08. Čte ho i Go strana, která blokový model nezná a dostává hotové compiled_html a compiled_text."
    },
    "context": {
      "type": "object",
      "required": ["trackOpens", "trackClicks", "language"],
      "properties": {
        "campaignId": { "type": "string", "format": "uuid" },
        "trackOpens": { "type": "boolean" },
        "trackClicks": { "type": "boolean" },
        "language": { "type": "string" },
        "purpose": { "enum": ["send", "preview", "test"] }
      }
    },
    "expect": {
      "type": "object",
      "properties": {
        "htmlContains": { "type": "array", "items": { "type": "string" } },
        "textContains": { "type": "array", "items": { "type": "string" } },
        "clickMarkerCount": { "type": "integer", "minimum": 0 },
        "hasOpenPixelSlot": { "type": "boolean" },
        "links": { "type": "array", "items": { "type": "object" } },
        "error": { "type": "string" }
      }
    }
  }
}
```

`packages/contracts/schema/message-id.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://mlain.local/schema/message-id.schema.json",
  "title": "Závazné vektory base32_lower a hlavičky Message-ID",
  "type": "object",
  "additionalProperties": false,
  "required": ["contractVersion", "cases"],
  "properties": {
    "contractVersion": { "const": 1 },
    "cases": {
      "type": "array",
      "minItems": 4,
      "items": {
        "type": "object",
        "additionalProperties": false,
        "required": ["id", "message_id", "sending_domain", "expected_base32", "expected_header", "sides"],
        "properties": {
          "id": { "type": "string", "pattern": "^MI-[0-9]{3}$" },
          "message_id": { "type": "string", "format": "uuid" },
          "sending_domain": { "type": "string", "minLength": 1 },
          "expected_base32": { "type": "string", "pattern": "^[a-z2-7]{26}$" },
          "expected_header": { "type": "string", "pattern": "^<ml\\.[a-z2-7]{26}@.+>$" },
          "sides": {
            "type": "array", "minItems": 1, "uniqueItems": true,
            "items": { "enum": ["ts", "go"] }
          }
        }
      }
    }
  }
}
```

Vzor `^[a-z2-7]{26}$` je tu schválně: base32 nad šestnácti bajty má vždy 26 znaků bez paddingu a abeceda nemá `0`, `1` ani `8`. Kdyby se do fixture vrátila ručně opsaná hodnota s překlepem v délce, spadne to už tady, ne až v testu.

`packages/contracts/schema/columns.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://mlain.local/schema/columns.schema.json",
  "title": "Manifest kontraktních sloupců. Čte ho tools/ci/contracts-schema.mjs z P01.",
  "type": "object",
  "minProperties": 1,
  "additionalProperties": {
    "type": "object",
    "minProperties": 1,
    "additionalProperties": {
      "type": "string",
      "description": "Hodnota information_schema.columns.data_type, tedy PostgreSQL názvosloví: 'uuid', 'text', 'timestamp with time zone'."
    },
    "propertyNames": { "pattern": "^[a-z_][a-z0-9_]*$" }
  },
  "propertyNames": { "pattern": "^[a-z_][a-z0-9_]*$" }
}
```

Tvar je dvouúrovňový objekt `{ tabulka: { sloupec: typ } }` a **není v něm nic navíc**, protože skript z P01 iteruje `Object.entries` na obou úrovních. Jakýkoliv další klíč, třeba `contractVersion`, by se vzal jako jméno tabulky a job by hlásil, že tabulka `contractVersion` po migracích neexistuje.

`packages/contracts/schema/config.schema.json`:

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://mlain.local/schema/config.schema.json",
  "title": "Zrcadlo manifestu konfigurace z packages/core pro paritu s Go",
  "type": "object",
  "additionalProperties": false,
  "required": ["generatedFrom", "variables"],
  "properties": {
    "generatedFrom": { "type": "string" },
    "variables": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["name", "type", "required", "consumers"],
        "properties": {
          "name": { "type": "string", "pattern": "^[A-Z][A-Z0-9_]*$" },
          "type": { "type": "string" },
          "required": { "type": "boolean" },
          "default": {},
          "consumers": { "type": "array", "items": { "enum": ["web", "worker", "sender"] } }
        }
      }
    }
  }
}
```

- [ ] **Krok 4: Napiš validátor fixtures**

`packages/contracts/scripts/validate-fixtures.ts`:

```ts
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

type ExtraFixture = { file: string; schema: string; data: unknown };

/**
 * Mapa adresář -> schéma. Jména schémat jsou totožná se jmény adresářů, protože
 * přesně tak je skládá tools/ci/contracts-fixtures-schema.mjs z P01 a job by
 * jinak hlásil chybu u každé skupiny (rozhodnutí D12). Mapa se proto nepíše
 * ručně, ale odvozuje z adresářů, a `only` jen zužuje, které soubory ve skupině
 * se validují.
 */
const GROUPS: Array<{ dir: string; only?: string[] }> = [
  { dir: 'liquid' },
  { dir: 'markers' },
  { dir: 'compiled' },
  { dir: 'token', only: ['vectors.json'] },
  { dir: 'crypto', only: ['vectors.json'] },
  { dir: 'message-id', only: ['vectors.json'] },
  { dir: 'outbox', only: ['scenarios.json'] },
];

export async function validateAllFixtures(
  packageRoot: string,
  options: { extra?: ExtraFixture[] } = {},
): Promise<{ validated: number; errors: string[] }> {
  const ajv = new Ajv({ allErrors: true, strict: false });
  addFormats(ajv);

  const compiled = new Map<string, ReturnType<typeof ajv.compile>>();
  for (const name of [...GROUPS.map((group) => group.dir), 'config', 'columns']) {
    const schema = JSON.parse(await readFile(path.join(packageRoot, 'schema', `${name}.schema.json`), 'utf8'));
    compiled.set(name, ajv.compile(schema));
  }

  const errors: string[] = [];
  let validated = 0;

  for (const group of GROUPS) {
    const dir = path.join(packageRoot, 'fixtures', group.dir);
    let files: string[];
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
    } catch {
      // Adresář, který ve struktuře je a na disku chybí, je chyba, ne důvod
      // k tichému přeskočení. Prázdný adresář (compiled do doby, než ho naplní
      // P08) je v pořádku, protože readdir vrátí prázdné pole.
      errors.push(`fixtures/${group.dir} neexistuje`);
      continue;
    }
    for (const file of files) {
      if (group.only && !group.only.includes(file)) {
        errors.push(`fixtures/${group.dir}/${file} není ve výčtu souborů skupiny`);
        continue;
      }
      const data = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
      const validate = compiled.get(group.dir)!;
      validated += 1;
      if (!validate(data)) {
        errors.push(`${group.dir}/${file}: ${ajv.errorsText(validate.errors, { separator: '; ' })}`);
      }
    }
  }

  // Manifest kontraktních sloupců neleží ve fixtures, ale v schema/, protože
  // přesně odtud ho čte tools/ci/contracts-schema.mjs z P01 (rozhodnutí D13).
  const columnsFile = path.join(packageRoot, 'schema', 'columns.json');
  const columnsValidate = compiled.get('columns')!;
  validated += 1;
  const columns = JSON.parse(await readFile(columnsFile, 'utf8'));
  if (!columnsValidate(columns)) {
    errors.push(`schema/columns.json: ${ajv.errorsText(columnsValidate.errors, { separator: '; ' })}`);
  }

  for (const extra of options.extra ?? []) {
    const validate = compiled.get(extra.schema)!;
    validated += 1;
    if (!validate(extra.data)) {
      errors.push(`${extra.file}: ${ajv.errorsText(validate.errors, { separator: '; ' })}`);
    }
  }

  return { validated, errors };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = await validateAllFixtures(packageRoot);
  if (result.errors.length > 0) {
    console.error(`contracts-fixtures-schema: ${result.errors.length} chyb`);
    for (const error of result.errors) console.error('  ' + error);
    process.exit(1);
  }
  console.log(`contracts-fixtures-schema: ${result.validated} souborů v pořádku`);
}
```

- [ ] **Krok 5: Spusť a ověř, že prochází**

Run: `pnpm --filter @mlain/contracts run test:fixtures-schema && pnpm --filter @mlain/contracts exec vitest run --project unit test/fixtures-schema.test.ts`
Expected: PASS, výpis `70 souborů v pořádku`: 55 Liquid, 10 značek, `token/vectors.json`, `crypto/vectors.json`, `message-id/vectors.json`, `outbox/scenarios.json` a `schema/columns.json`. Dřívější znění tady uvádělo 66, což neodpovídalo ani tehdejšímu obsahu; správný součet tehdejší struktury byl 67.

- [ ] **Krok 6: Commit**

```bash
git add packages/contracts/schema packages/contracts/scripts/validate-fixtures.ts packages/contracts/test/fixtures-schema.test.ts
git commit -m "feat(contracts): JSON schémata fixtures a job contracts-fixtures-schema"
```

---

### Úkol 19: `test:parity`, počty, pokrytí a nepřeskočené fixtures

Bod, který skutečně zabraňuje rozchodu dialektů, je kontrola, že **obě strany zpracovaly stejný počet souborů**. Bez něj by se jedna strana mohla tiše vyhnout nepohodlné fixture.

**Files:**
- Create: `packages/contracts/scripts/check-parity.ts`
- Test: `packages/contracts/test/parity.test.ts`

- [ ] **Krok 1: Napiš padající test parity**

`packages/contracts/test/parity.test.ts`:

```ts
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { checkParity, expectedIds } from '../scripts/check-parity.js';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Vyrobí dvojici reportů, která je v pořádku, a nechá test jednu z nich pokazit. */
async function reports(): Promise<Record<string, unknown>> {
  const expected = await expectedIds(packageRoot);
  const out: Record<string, unknown> = {};
  for (const [section, sides] of Object.entries(expected)) {
    for (const language of ['ts', 'go'] as const) {
      out[`${language}-golden-${section}.json`] = {
        language,
        section,
        total: sides[language].ids.length,
        executed: sides[language].ids.length,
        skipped: 0,
        ids: sides[language].ids,
        groups: sides[language].groups,
        fixturesDigest: sides.digest,
      };
    }
  }
  return out;
}

describe('test:parity', () => {
  it('projde, když se počty, id i otisky shodují', async () => {
    const result = await checkParity(packageRoot, { override: await reports() });
    expect(result.errors).toEqual([]);
  });

  it('spadne, když report jedné strany chybí', async () => {
    const override = await reports();
    delete override['go-golden-liquid.json'];
    const result = await checkParity(packageRoot, { override });
    // Chybějící report NIKDY neznamená přeskočení. Parita nad jednou stranou
    // není parita a tenhle test je jediný důkaz, že to tak opravdu je.
    expect(result.errors.join('\n')).toMatch(/chybí report go-golden-liquid/);
  });

  it('spadne, když jedna strana zpracovala jinou množinu fixtur', async () => {
    const override = await reports();
    const go = override['go-golden-liquid.json'] as { ids: string[]; executed: number };
    go.ids = go.ids.slice(0, -1);
    go.executed = go.ids.length;
    const result = await checkParity(packageRoot, { override });
    expect(result.errors.join('\n')).toMatch(/LQ-/);
  });

  it('spadne, když je fixture označená jako přeskočená', async () => {
    const override = await reports();
    (override['go-golden-liquid.json'] as { skipped: number }).skipped = 1;
    const result = await checkParity(packageRoot, { override });
    expect(result.errors.join('\n')).toMatch(/přeskočen/);
  });

  it('spadne nad reportem ze staršího běhu, i když čísla sedí', async () => {
    const override = await reports();
    (override['go-golden-liquid.json'] as { fixturesDigest: string }).fixturesDigest = 'a'.repeat(64);
    const result = await checkParity(packageRoot, { override });
    // Adresář reports/ se nikde nemaže, takže bez otisku by šlo dostat zelenou
    // paritu nad výsledkem běhu, který proběhl nad jinými fixtures.
    expect(result.errors.join('\n')).toMatch(/otisk/);
  });

  it('spadne, když zakázaná konstrukce nebo negativní vektor nemá fixture', async () => {
    const result = await checkParity(packageRoot, {
      override: await reports(),
      requireExtraCode: 'liquid_neexistujici_kod',
    });
    expect(result.errors.join('\n')).toContain('liquid_neexistujici_kod');
  });
});
```

- [ ] **Krok 2: Spusť a ověř, že padá**

Run: `pnpm --filter @mlain/contracts exec vitest run --project unit test/parity.test.ts`
Expected: FAIL, `Cannot find module '../scripts/check-parity.js'`.

- [ ] **Krok 3: Napiš `scripts/check-parity.ts`**

```ts
import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Report = {
  language: 'ts' | 'go';
  section: string;
  total: number;
  executed: number;
  skipped: number;
  ids: string[];
  groups: Record<string, number>;
  fixturesDigest: string;
};

type SideExpectation = { ids: string[]; groups: Record<string, number> };
type SectionExpectation = { ts: SideExpectation; go: SideExpectation; digest: string };

/**
 * Kódy, které MUSÍ mít alespoň jednu fixture. Je to sloučení tabulky zakázaných
 * konstrukcí z kontraktu 4.10.2 a negativních vektorů ze 4.10.3 a 4.10.4.
 * Nová zakázaná konstrukce bez fixture spadne tady.
 */
const REQUIRED_LIQUID_CODES = [
  'liquid_tag_not_allowed',
  'liquid_whitespace_control_not_allowed',
  'liquid_filter_not_allowed',
  'liquid_vocative_filter',
  'liquid_contains_not_allowed',
  'liquid_parentheses_not_allowed',
  'liquid_nested_for',
  'liquid_for_parameter_not_allowed',
  'liquid_index_not_allowed',
  'liquid_comparison_operator_not_supported',
  'liquid_string_literal_not_allowed',
  'liquid_escaped_entity_in_construct',
  'liquid_literal_not_supported',
  // Doplněno: kontrakt ho v tabulce zakázaných konstrukcí má a část 3 na něj
  // má kritérium 8.4/28, ale fixture neměl žádnou. Doplnila ho LQ-511.
  'liquid_date_format_not_allowed',
];

const REQUIRED_TOKEN_ERRORS = [
  'token_malformed', 'token_signature_invalid', 'token_type_mismatch',
  'token_unknown_key', 'token_expired', 'token_already_used',
];

const REQUIRED_CRYPTO_ERRORS = [
  'crypto_envelope_malformed', 'crypto_unsupported_version',
  'crypto_context_mismatch', 'crypto_unknown_key', 'crypto_auth_failed',
];

const BOTH: Array<'ts' | 'go'> = ['ts', 'go'];

async function digestOf(files: string[]): Promise<string> {
  const outer = createHash('sha256');
  for (const file of [...files].sort()) {
    const body = await readFile(file);
    outer.update(path.basename(file));
    outer.update('\0');
    outer.update(createHash('sha256').update(body).digest('hex'));
    outer.update('\n');
  }
  return outer.digest('hex');
}

/**
 * Očekávaná množina id pro každou sekci a stranu, spočítaná Z FIXTUR NA DISKU.
 * Tohle je jádro celé kontroly: parita se neporovnává report proti reportu, ale
 * OBA reporty proti datům. Kdyby si obě strany odpustily tutéž fixture, srovnání
 * report proti reportu by prošlo.
 */
export async function expectedIds(packageRoot: string): Promise<Record<string, SectionExpectation>> {
  const fixtures = (...parts: string[]): string => path.join(packageRoot, 'fixtures', ...parts);
  const out: Record<string, SectionExpectation> = {};

  const perFile = async (dir: string, section: string, group?: (id: string) => string): Promise<void> => {
    const names = (await readdir(fixtures(dir))).filter((f) => f.endsWith('.json')).sort();
    const sides: Record<'ts' | 'go', SideExpectation> = {
      ts: { ids: [], groups: {} },
      go: { ids: [], groups: {} },
    };
    for (const name of names) {
      const fixture = JSON.parse(await readFile(fixtures(dir, name), 'utf8')) as {
        id: string;
        sides?: Array<'ts' | 'go'>;
      };
      for (const side of fixture.sides ?? BOTH) {
        sides[side].ids.push(fixture.id);
        if (group) {
          const key = group(fixture.id);
          sides[side].groups[key] = (sides[side].groups[key] ?? 0) + 1;
        }
      }
    }
    sides.ts.ids.sort();
    sides.go.ids.sort();
    out[section] = { ...sides, digest: await digestOf(names.map((name) => fixtures(dir, name))) };
  };

  const perVectorFile = async (
    dir: string,
    file: string,
    section: string,
    pick: (data: any) => Array<{ id: string; sides?: Array<'ts' | 'go'> }>,
  ): Promise<void> => {
    const data = JSON.parse(await readFile(fixtures(dir, file), 'utf8'));
    const sides: Record<'ts' | 'go', SideExpectation> = {
      ts: { ids: [], groups: {} },
      go: { ids: [], groups: {} },
    };
    for (const item of pick(data)) {
      for (const side of item.sides ?? BOTH) sides[side].ids.push(item.id);
    }
    sides.ts.ids.sort();
    sides.go.ids.sort();
    out[section] = { ...sides, digest: await digestOf([fixtures(dir, file)]) };
  };

  await perFile('liquid', 'liquid', (id) => `LQ-${id.slice(3, 4)}xx`);
  await perFile('markers', 'markers');
  await perVectorFile('token', 'vectors.json', 'token', (d) => [...d.positive, ...d.negative]);
  await perVectorFile('crypto', 'vectors.json', 'crypto', (d) => [...d.positive, ...d.negative]);
  await perVectorFile('message-id', 'vectors.json', 'message-id', (d) => d.cases);
  await perVectorFile('outbox', 'scenarios.json', 'outbox', (d) => d.transitions);
  return out;
}

export async function checkParity(
  packageRoot: string,
  options: { override?: Record<string, unknown>; requireExtraCode?: string } = {},
): Promise<{ errors: string[] }> {
  const errors: string[] = [];
  const expected = await expectedIds(packageRoot);

  const readReport = async (file: string): Promise<Report | undefined> => {
    if (options.override) return options.override[file] as Report | undefined;
    try {
      return JSON.parse(await readFile(path.join(packageRoot, 'reports', file), 'utf8')) as Report;
    } catch {
      return undefined;
    }
  };

  for (const [section, expectation] of Object.entries(expected)) {
    for (const language of BOTH) {
      const file = `${language}-golden-${section}.json`;
      const report = await readReport(file);
      if (!report) {
        errors.push(
          `chybí report ${file}; parita nad jednou stranou není parita, ` +
            'spusť golden testy obou jazyků',
        );
        continue;
      }
      const want = expectation[language];

      if (report.skipped !== 0) {
        errors.push(`${file}: ${report.skipped} přeskočených fixtur, přeskočení není povolené`);
      }
      if (report.executed !== report.total) {
        errors.push(`${file}: provedeno ${report.executed} z ${report.total}, musí být všechno`);
      }
      if (report.executed !== report.ids.length) {
        errors.push(`${file}: executed ${report.executed}, ale id je ${report.ids.length}`);
      }
      if (report.fixturesDigest !== expectation.digest) {
        errors.push(
          `${file}: otisk fixtures nesedí s obsahem disku, report je z jiného běhu ` +
            `(${report.fixturesDigest.slice(0, 12)} vs ${expectation.digest.slice(0, 12)})`,
        );
      }

      const got = new Set(report.ids);
      const missing = want.ids.filter((id) => !got.has(id));
      const extra = report.ids.filter((id) => !want.ids.includes(id));
      if (missing.length > 0) errors.push(`${file}: nezpracované fixtures ${missing.join(', ')}`);
      if (extra.length > 0) errors.push(`${file}: neznámé fixtures ${extra.join(', ')}`);

      for (const group of new Set([...Object.keys(want.groups), ...Object.keys(report.groups)])) {
        if ((want.groups[group] ?? 0) !== (report.groups[group] ?? 0)) {
          errors.push(
            `${file}: skupina ${group} má ${report.groups[group] ?? 0}, čeká se ${want.groups[group] ?? 0}`,
          );
        }
      }
    }
  }

  // Každý kód z tabulek zakázaných konstrukcí a negativních vektorů má fixture.
  const liquidDir = path.join(packageRoot, 'fixtures', 'liquid');
  const liquidFiles = (await readdir(liquidDir)).filter((f) => f.endsWith('.json'));
  const seenLiquid = new Set<string>();
  for (const file of liquidFiles) {
    const fixture = JSON.parse(await readFile(path.join(liquidDir, file), 'utf8')) as {
      expect_validation_error?: { code: string };
    };
    if (fixture.expect_validation_error) seenLiquid.add(fixture.expect_validation_error.code);
  }
  const required = [...REQUIRED_LIQUID_CODES, ...(options.requireExtraCode ? [options.requireExtraCode] : [])];
  for (const code of required) {
    if (!seenLiquid.has(code)) errors.push(`kód ${code} nemá ani jednu fixture`);
  }

  const tokens = JSON.parse(
    await readFile(path.join(packageRoot, 'fixtures', 'token', 'vectors.json'), 'utf8'),
  ) as { negative: Array<{ expected_error: string }> };
  const seenToken = new Set(tokens.negative.map((n) => n.expected_error));
  for (const code of REQUIRED_TOKEN_ERRORS) {
    if (!seenToken.has(code)) errors.push(`negativní vektor ${code} chybí`);
  }

  const crypto = JSON.parse(
    await readFile(path.join(packageRoot, 'fixtures', 'crypto', 'vectors.json'), 'utf8'),
  ) as { negative: Array<{ expected_error: string }> };
  const seenCrypto = new Set(crypto.negative.map((n) => n.expected_error));
  for (const code of REQUIRED_CRYPTO_ERRORS) {
    if (!seenCrypto.has(code)) errors.push(`negativní vektor ${code} chybí`);
  }

  return { errors };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const result = await checkParity(packageRoot);
  if (result.errors.length > 0) {
    console.error('test:parity selhal:');
    for (const error of result.errors) console.error('  ' + error);
    process.exit(1);
  }
  console.log('test:parity: počty, množiny id, otisky i pokrytí kódů v pořádku');
}
```

Čtvrtý bod z kapitoly 4.10.5, tedy kontrola kontraktních sloupců proti databázi, tady **schválně není**: `contracts-golden` žádnou databázi nemá a mít nemá. Běží v jobu `contracts-schema`, viz úkol 20.

- [ ] **Krok 4: Spusť celý řetěz a ověř, že parita ve vlně 0 správně SELŽE**

```bash
pnpm --filter @mlain/contracts run test:golden
cd apps/sender && go test ./internal/contracts/ && cd ../..
pnpm --filter @mlain/contracts run test:parity ; echo "test:parity skončil kódem $?"
```

Expected ve vlně 0: kód **1** a šest řádků `chybí report go-golden-<sekce>.json`. Je to správný stav, ne nedodělek: Go implementaci kontraktů dodává P09 (rozhodnutí D8) a do té doby žádný Go golden běh neexistuje. Kdyby `test:parity` v tomhle stavu skončil nulou, znamenalo by to, že brána projde i nad jednou stranou, a přesně to je vada, kterou má hlídat.

Zelený běh je proto akceptační kritérium **P09**, ne tohohle plánu, a je zapsané jako požadavek P02→P09.1. Jednotkový test `test/parity.test.ts` je zelený už teď, protože si obě strany reportu podstrčí sám a mezi jeho tvrzeními je i to, že chybějící report je chyba.

- [ ] **Krok 5: Ověř akceptační kritérium 42 ručním pokusem**

```bash
cp packages/contracts/fixtures/liquid/LQ-001.json /tmp/LQ-001.json
rm packages/contracts/fixtures/liquid/LQ-001.json
pnpm --filter @mlain/contracts run test:golden ; echo "TS skončil kódem $?"
```

Expected: TypeScript strana spadne na počtu 54 (čeká 55). Vrať soubor zpět:

```bash
cp /tmp/LQ-001.json packages/contracts/fixtures/liquid/LQ-001.json
pnpm --filter @mlain/contracts run test:golden
```

Expected: PASS.

- [ ] **Krok 6: Ověř, že otisk fixtures skutečně chytí starý report**

```bash
pnpm --filter @mlain/contracts run test:golden
printf '\n' >> packages/contracts/fixtures/liquid/LQ-001.json
pnpm --filter @mlain/contracts exec tsx -e "
  const { checkParity } = await import('./scripts/check-parity.ts');
  const result = await checkParity(process.cwd());
  console.log(result.errors.filter((e) => e.includes('otisk')).join('\n') || 'ŽÁDNÁ CHYBA OTISKU');
"
git checkout packages/contracts/fixtures/liquid/LQ-001.json
```

Expected: aspoň jeden řádek `otisk fixtures nesedí s obsahem disku`. Tenhle krok a krok 5 jsou jediné důkazy, že brána opravdu brání: bez nich by šlo mít zelenou paritu nad prázdnou množinou nebo nad výsledkem staršího běhu, protože adresář `reports/` se nikde nemaže.

- [ ] **Krok 6: Commit**

```bash
git add packages/contracts/scripts/check-parity.ts packages/contracts/test/parity.test.ts
git commit -m "feat(contracts): test:parity hlídá počty, pokrytí kódů a nepřeskočené fixtures"
```

---

### Úkol 20: `contracts-schema`, kontraktní sloupce, `config.json` a CODEOWNERS

Kontrola "kontraktní sloupce existují po migracích a mají očekávaný typ" neběží v `contracts-golden`, ale v `contracts-schema`, který Postgres ze `services:` má. Bez tohohle rozdělení by kontrola buď spadla na chybějící připojení, nebo, hůř, byla potichu přeskočena jako "nedostupná databáze" a kontraktní sloupce by nehlídalo nic.

**Files:**
- Create: `packages/contracts/schema/columns.json` (generovaný, cestu i tvar určuje P01)
- Create: `packages/contracts/scripts/sync-config-manifest.ts`
- Create: `packages/contracts/.github-codeowners-fragment.md` (dokumentace) a `.github/CODEOWNERS`
- Create: `packages/contracts/README.md`
- Test: `packages/contracts/test/db/20-contract-columns.test.ts`

- [ ] **Krok 1: Napiš padající test kontraktních sloupců**

`packages/contracts/test/db/20-contract-columns.test.ts`:

```ts
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FOREIGN_CONTRACT_COLUMNS, MESSAGES_CONTRACT_COLUMNS } from '../../src/outbox.js';
import { type ContractDb, packageRoot, startContractDb, stopContractDb } from './helpers.js';

let db: ContractDb;

beforeAll(async () => {
  db = await startContractDb();
}, 180_000);
afterAll(async () => stopContractDb(db));

describe('contracts-schema: kontraktní sloupce', () => {
  it('manifest leží tam, kde ho hledá P01, a má tvar, který P01 čte', async () => {
    // tools/ci/contracts-schema.mjs čte packages/contracts/schema/columns.json
    // a iteruje Object.entries na dvou úrovních: { tabulka: { sloupec: typ } }.
    // Dřívější znění generovalo fixtures/outbox/contract-columns.json v jiném
    // tvaru, takže soubor, který skript hledá, nikdy nevznikl a job tiše
    // přeskočil; kontraktní sloupce po migracích tedy nehlídalo nic.
    const manifest = JSON.parse(
      await readFile(path.join(packageRoot, 'schema', 'columns.json'), 'utf8'),
    ) as Record<string, Record<string, string>>;

    expect(manifest.messages).toEqual(MESSAGES_CONTRACT_COLUMNS);
    expect(Object.keys(manifest).sort()).toEqual(['campaigns', 'messages', 'suppressions', 'workspaces']);
    for (const columns of Object.values(manifest)) {
      for (const type of Object.values(columns)) {
        expect(typeof type).toBe('string');
      }
    }
  });

  it('sloupce cizích tabulek v manifestu jsou podmnožinou kontraktního výčtu', async () => {
    const manifest = JSON.parse(
      await readFile(path.join(packageRoot, 'schema', 'columns.json'), 'utf8'),
    ) as Record<string, Record<string, string>>;
    for (const table of ['campaigns', 'workspaces', 'suppressions'] as const) {
      expect(Object.keys(manifest[table]).sort()).toEqual([...FOREIGN_CONTRACT_COLUMNS[table]].sort());
    }
  });

  it('každý kontraktní sloupec messages existuje a má očekávaný typ', async () => {
    const { rows } = await db.migrator.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'messages'`,
    );
    const actual = Object.fromEntries(rows.map((r) => [r.column_name, r.data_type]));
    const mismatches: string[] = [];
    for (const [column, type] of Object.entries(MESSAGES_CONTRACT_COLUMNS)) {
      if (!(column in actual)) mismatches.push(`chybí sloupec ${column}`);
      else if (actual[column] !== type) mismatches.push(`${column} má typ ${actual[column]}, čeká se ${type}`);
    }
    expect(mismatches).toEqual([]);
  });

  it('kontraktní sloupce cizích tabulek existují všude, kde tabulka existuje', async () => {
    const mismatches: string[] = [];
    for (const [table, columns] of Object.entries(FOREIGN_CONTRACT_COLUMNS)) {
      const { rows } = await db.migrator.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = $1`,
        [table],
      );
      if (rows.length === 0) continue; // tabulku vlastní jiná část a v bootstrapu být nemusí
      const present = new Set(rows.map((r) => r.column_name));
      for (const column of columns) {
        if (!present.has(column)) mismatches.push(`${table}.${column} chybí`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('sender nemá UPDATE grant na created_at a má ho na ambiguous_count', async () => {
    const { rows } = await db.migrator.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.column_privileges
        WHERE grantee = 'mlain_sender' AND table_name = 'messages' AND privilege_type = 'UPDATE'`,
    );
    const granted = rows.map((r) => r.column_name);
    expect(granted).not.toContain('created_at');
    expect(granted).toContain('ambiguous_count');
    expect(granted.sort()).toEqual(
      [...new Set(['status', 'claimed_by', 'claimed_at', 'claim_expires_at', 'dispatch_started_at',
        'attempts', 'next_attempt_at', 'provider_message_id', 'sent_at', 'error_code',
        'error_detail', 'ambiguous_count', 'updated_at'])].sort(),
    );
  });

  it('politika sender_bypass existuje na každé tabulce, kterou sender čte', async () => {
    const { rows } = await db.migrator.query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies WHERE policyname = 'sender_bypass'`,
    );
    const tables = rows.map((r) => r.tablename).sort();
    expect(tables).toEqual(['campaigns', 'messages', 'suppressions', 'workspaces']);
  });
});
```

- [ ] **Krok 2: Spusť a ověř, že padá**

Run: `pnpm --filter @mlain/contracts exec vitest run --project db-rest test/db/20-contract-columns.test.ts`
Expected: FAIL, `ENOENT: schema/columns.json`.

- [ ] **Krok 3: Doplň generátor manifestu sloupců**

Přidej do `packages/contracts/scripts/generate-fixtures.ts`:

```ts
import { MESSAGES_CONTRACT_COLUMNS } from '../src/outbox.js';

/**
 * Typy kontraktních sloupců cizích tabulek. Hodnoty jsou `information_schema.columns.data_type`
 * a jsou ODEČTENÉ Z BĚŽÍCÍ PostgreSQL 18.4 nad bootstrapem, ne odhadnuté.
 *
 * Tabulky `sending_providers`, `campaign_links` a `message_events` tu SCHVÁLNĚ NEJSOU.
 * Kontrakt u nich vyjmenovává sloupce, ale ne typy, a bootstrap je nezakládá,
 * takže P02 jejich typy nezná. Hádat je by znamenalo červený build z důvodu,
 * který si P02 vymyslel. Jejich kontraktní sloupce hlídá test výš na existenci
 * jména, což je všechno, co je doložitelné. Doplnění typů je požadavek na
 * vlastníky těch tabulek, ne na tenhle plán.
 */
const FOREIGN_COLUMN_TYPES: Record<string, Record<string, string>> = {
  campaigns: {
    id: 'uuid',
    workspace_id: 'uuid',
    status: 'text',
    pause_reason: 'jsonb',
    scheduled_at: 'timestamp with time zone',
    audience_built_at: 'timestamp with time zone',
    provider_id: 'uuid',
    compiled_html: 'text',
    compiled_text: 'text',
    subject: 'text',
    preheader: 'text',
    from_name: 'text',
    from_email: 'text',
    reply_to: 'text',
    track_opens: 'boolean',
    track_clicks: 'boolean',
    deleted_at: 'timestamp with time zone',
  },
  workspaces: {
    id: 'uuid',
    deleted_at: 'timestamp with time zone',
  },
  suppressions: {
    workspace_id: 'uuid',
    email: 'USER-DEFINED',
    fingerprint: 'bytea',
    fingerprint_key_id: 'smallint',
    removed_at: 'timestamp with time zone',
    created_at: 'timestamp with time zone',
  },
};

export async function generateContractColumns(): Promise<void> {
  // Tvar je PŘESNĚ { tabulka: { sloupec: typ } } a nic víc. Jakýkoliv další klíč,
  // třeba contractVersion, by skript z P01 vzal jako jméno tabulky a hlásil by,
  // že tabulka "contractVersion" po migracích neexistuje.
  const manifest: Record<string, Record<string, string>> = {
    messages: { ...MESSAGES_CONTRACT_COLUMNS },
    ...FOREIGN_COLUMN_TYPES,
  };
  await writeFile(
    path.join(packageRoot, 'schema', 'columns.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    'utf8',
  );
}
```

A do spouštěcí větve `await generateContractColumns();`.

Typ `email` v `suppressions` je `USER-DEFINED`, protože sloupec je `citext`, a `information_schema.columns.data_type` u doménových a rozšířených typů vrací právě tuhle hodnotu. Ověřeno spuštěním; kdyby se tam napsalo `citext`, job by hlásil rozchod u sloupce, který je v pořádku.

- [ ] **Krok 4: Spusť a ověř, že prochází**

Run: `pnpm --filter @mlain/contracts exec tsx scripts/generate-fixtures.ts && pnpm --filter @mlain/contracts run test:schema`
Expected: PASS. `OB-00` běží první, pak scénáře, pak kontraktní sloupce.

**Až bude P03 smergovaný**, tentýž test poběží proti databázi zmigrované z `packages/db`, protože job `contracts-schema` migrace aplikuje. Rozdíl mezi kontraktní podmnožinou a produkčním schématem se tím projeví jako červený build, ne jako tichý rozchod.

- [ ] **Krok 5: Zrcadli manifest konfigurace do `config.json`**

`packages/contracts/scripts/sync-config-manifest.ts`:

```ts
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Zrcadlí packages/core/src/config/config.manifest.json do packages/contracts/config.json.
 *
 * Je to KOPIE SOUBORU, ne import: graf závislostí říká `contracts -> nic` a
 * import by z kořene grafu udělal list. Čtení souboru žádnou build závislost
 * nezakládá a ESLint pravidlo import/no-restricted-paths se ho netýká.
 */
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.resolve(packageRoot, '..', 'core', 'src', 'config', 'config.manifest.json');
const TARGET = path.join(packageRoot, 'config.json');

export async function syncConfigManifest(check = false): Promise<boolean> {
  let source: string;
  try {
    source = await readFile(SOURCE, 'utf8');
  } catch {
    console.warn(`sync-config-manifest: ${SOURCE} zatím neexistuje, přeskakuji`);
    return true;
  }
  const parsed = JSON.parse(source) as { variables?: unknown[] };
  const mirrored = JSON.stringify(
    { generatedFrom: 'packages/core/src/config/config.manifest.json', variables: parsed.variables ?? [] },
    null,
    2,
  ) + '\n';

  if (check) {
    const current = await readFile(TARGET, 'utf8').catch(() => '');
    if (current !== mirrored) {
      console.error('config.json není aktuální, spusť pnpm --filter @mlain/contracts run contracts:generate');
      return false;
    }
    return true;
  }
  await writeFile(TARGET, mirrored, 'utf8');
  return true;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const ok = await syncConfigManifest(process.argv.includes('--check'));
  if (!ok) process.exit(1);
}
```

Run: `pnpm --filter @mlain/contracts exec tsx scripts/sync-config-manifest.ts && cat packages/contracts/config.json | head -5`
Expected: soubor vznikne, nebo se vypíše, že zdroj zatím neexistuje. Obojí je v pořádku, protože pořadí merge P01 a P02 je dané, ale soubor může být prázdný.

- [ ] **Krok 6: Napiš CODEOWNERS a README**

`.github/CODEOWNERS`:

```
# Fixtures zmrazených kontraktů. Změna očekávané hodnoty vyžaduje review
# vlastníků OBOU stran a commit message začínající "contract:".
/packages/contracts/fixtures/   @mlain/contract-owners
/packages/contracts/schema/     @mlain/contract-owners
/apps/sender/internal/contracts/ @mlain/contract-owners
```

`packages/contracts/README.md`:

```markdown
# @mlain/contracts

Pět zmrazených kontraktů mezi TypeScriptem a Go. Zdrojem pravdy je
`docs/superpowers/specs/parts/01-platforma.md`, kapitola 4.10, a pro kontrakt 5
`docs/superpowers/specs/parts/03-obsah.md`, kapitola 4.1.

| # | Kontrakt | Kód | Fixtures |
|---|---|---|---|
| 1 | Outbox protokol | `src/outbox.ts`, `src/outbox-errors.ts`, `src/pause-reason.ts` | `fixtures/outbox/` |
| 2 | Liquid subset | `src/liquid/` | `fixtures/liquid/` (55) |
| 3 | Trackovací tokeny | `src/token.ts`, `src/message-id.ts` | `fixtures/token/vectors.json`, `fixtures/message-id/vectors.json` |
| 4 | Šifrování credentials | `src/crypto.ts`, `src/keyring.ts` | `fixtures/crypto/vectors.json` |
| 5 | Značky pro tracking | `src/markers.ts`, `src/compiled.ts` | `fixtures/markers/`, `fixtures/compiled/` |

Go stranu **implementace** vlastní P09 v produkčních balíčcích. Tenhle balíček dodává na Go straně jen `apps/sender/internal/contracts`, což je testovací podpora: čtení fixtures, otisk, zápis reportu a runnery, kterým se produkční funkce předávají jako parametr.

## Pravidla

Balíček **neimportuje z monorepa nic.** Je to kořen grafu závislostí a zároveň
jediné místo, které čte i Go, přes symlink `apps/sender/testdata`.

Fixture se nikdy neopravuje tak, aby prošla. Opravuje se implementace. Změna
očekávané hodnoty vyžaduje commit message začínající `contract:` a review
vlastníků obou stran, což hlídá `CODEOWNERS`.

## Příkazy, které pouští CI

| Job | Příkaz |
|---|---|
| `contracts-golden` | `pnpm --filter @mlain/contracts test:golden`, `go test ./... -run TestGolden`, `pnpm --filter @mlain/contracts test:parity` |
| `contracts-fixtures-schema` | `pnpm --filter @mlain/contracts test:fixtures-schema` |
| `contracts-schema` | `node tools/ci/contracts-schema.mjs` nad `schema/columns.json` a `pnpm --filter @mlain/contracts test:schema` proti Postgresu ze `services:` |
| `test-go-integration` | `go test -tags=integration ./...` s `DATABASE_URL_MIGRATOR` |

`test:parity` je zelený až od vlny 1, kdy P09 dodá Go implementaci a runnery se mají o co opřít. Do té doby hlásí chybějící Go reporty, což je správně: parita nad jednou stranou není parita.

`contracts-golden` běží **bez databáze**. Kontrola kontraktních sloupců proti
migracím patří do `contracts-schema`, který databázi má.

## Generované soubory

`fixtures/token/vectors.json`, `fixtures/crypto/vectors.json`,
`fixtures/message-id/vectors.json`, `fixtures/liquid/LQ-403.json`,
`schema/columns.json` a `config.json` vyrábí
`pnpm --filter @mlain/contracts contracts:generate`.
Needitují se ručně. `openapi.json` generuje P04 a tenhle balíček ho jen hostí.
```

- [ ] **Krok 7: Commit**

```bash
git add packages/contracts .github/CODEOWNERS
git commit -m "feat(contracts): kontrola kontraktních sloupců, zrcadlo konfigurace, CODEOWNERS a README"
```

---

### Úkol 21: Kompletní série a ověření CI jobů

Poslední úkol nic nového nepřidává, jen dokazuje, že celek drží. Bez něj by plán skončil tvrzením místo důkazu.

**Files:**
- Modify: `packages/contracts/test/keyring.test.ts`

- [ ] **Krok 1: Doplň test rotace klíče, akceptační kritérium 54**

Přidej do `packages/contracts/test/keyring.test.ts`:

```ts
import { buildToken, verifyToken } from '../src/token.js';

describe('rotace SECRET_KEY', () => {
  const OLD = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
  const NEW = 'HyAhIiMkJSYnKCkqKywtLi8wMTIzNDU2Nzg5Ojs8PT4_';

  it('starý token se po rotaci pořád ověří a nový se podepíše novým klíčem', () => {
    const before = parseKeyring({ secretKey: `1:${OLD}` });
    const fields = {
      workspace_id: '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071',
      message_id: '0192f3a0-1c2d-7e41-8b2c-3d4e5f607182',
      message_created_at: 1_784_995_200,
    };
    const oldToken = buildToken({ type: 'o', keyId: 1, fields, keyring: before }).token;

    const after = parseKeyring({ secretKey: `2:${NEW}`, secretKeyPrevious: `1:${OLD}` });
    const verified = verifyToken({
      token: oldToken, endpointType: 'o', keyring: after, now: 1_800_000_000, isNonceUsed: () => false,
    });
    expect(verified.keyId).toBe(1);

    const newToken = buildToken({ type: 'o', keyId: currentKeyId(after), fields, keyring: after }).token;
    expect(newToken).not.toBe(oldToken);
    expect(
      verifyToken({ token: newToken, endpointType: 'o', keyring: after, now: 1_800_000_000, isNonceUsed: () => false })
        .keyId,
    ).toBe(2);

    // Bez SECRET_KEY_PREVIOUS se starý token ověřit nedá.
    const withoutPrevious = parseKeyring({ secretKey: `2:${NEW}` });
    expect(() =>
      verifyToken({ token: oldToken, endpointType: 'o', keyring: withoutPrevious, now: 1_800_000_000, isNonceUsed: () => false }),
    ).toThrow(/token_unknown_key/);
  });
});
```

Doplň k tomu import `currentKeyId` do hlavičky souboru.

Run: `pnpm --filter @mlain/contracts exec vitest run --project unit test/keyring.test.ts`
Expected: PASS.

- [ ] **Krok 2: Spusť kompletní sérii TypeScript strany**

```bash
pnpm --filter @mlain/contracts run typecheck
pnpm --filter @mlain/contracts run build
pnpm --filter @mlain/contracts run test:unit
pnpm --filter @mlain/contracts run test:golden
pnpm --filter @mlain/contracts run test:fixtures-schema
pnpm --filter @mlain/contracts run test:schema
```

Expected: šest zelených běhů. Cokoliv červeného se dohledá a opraví, nepřeskakuje se.

- [ ] **Krok 3: Spusť kompletní sérii Go strany**

```bash
cd apps/sender
git diff --exit-code go.mod go.sum
go vet ./internal/contracts/
go test ./internal/contracts/ -v
DATABASE_URL_MIGRATOR=postgres://postgres:postgres@localhost:55432/mlain \
  go test -tags=integration ./internal/contracts/ -run TestOB00 -v
go run github.com/google/go-licenses@latest check ./internal/contracts/ --disallowed_types=forbidden,restricted,reciprocal
```

Expected: prázdný diff manifestu modulu, čistý `vet`, zelené testy, licenční brána bez nálezu. Go strana testuje **runnery**, ne implementaci kontraktů; tu dodá P09.

- [ ] **Krok 4: Spusť brány a zapiš, které z nich ještě nejsou zapojené**

```bash
pnpm --filter @mlain/contracts run test:fixtures-schema
node tools/ci/contracts-fixtures-schema.mjs
node tools/ci/contracts-schema.mjs
node tools/ci/contracts-golden.mjs
pnpm --filter @mlain/contracts run test:parity ; echo "test:parity kód $?"
```

Expected, a je to smíšený výsledek, který se **nesmí zaokrouhlit na zelenou**:

| Příkaz | Očekávaný stav po tomhle plánu |
|---|---|
| `test:fixtures-schema` | kód 0, výpis `70 souborů v pořádku` |
| `contracts-fixtures-schema.mjs` | kód 0, **žádný SKIP**; každá skupina fixtures má schéma pojmenované podle rozhodnutí D12 |
| `contracts-schema.mjs` | SKIP jen kvůli chybějícím `packages/db/migrations`, tedy kvůli P03. `schema/columns.json` už existuje, takže na něm SKIP nezůstává. |
| `contracts-golden.mjs` | kód 0, ale **nic neměří**: porovnává adresář se sebou samým přes symlink, viz požadavek P02→P01.4 |
| `test:parity` | kód **1**, `chybí report go-golden-<sekce>.json` u šesti sekcí, dokud nepřistane P09 |

Trvající `SKIP` z jiného důvodu než chybějící migrace znamená, že skript z P01 něco nenašel; je to nález proti P01 a **neopravuje se editací jeho souboru**, ale hlášením a změnou P01. Seznam takových hlášení je v kapitole 2.1 a musí být uzavřený dřív, než se plán prohlásí za hotový.

- [ ] **Krok 5: Ověř, že balíček pořád neimportuje z monorepa nic**

```bash
grep -rn "@mlain/" packages/contracts/src packages/contracts/scripts packages/contracts/test || echo "žádný import z monorepa"
grep -rn "packages/" apps/sender/internal/contracts/*.go || echo "Go strana nemá cestu do packages"
grep -rn "internal/\(token\|credentials\|keyring\|markers\|liquidx\|mimebuild\|outbox\)" apps/sender/internal/contracts/ \
  && echo "CHYBA: runner importuje produkční balíček" || echo "runnery neimportují produkční kód"
```

Expected: `žádný import z monorepa`, `Go strana nemá cestu do packages` a `runnery neimportují produkční kód`. Poslední kontrola je podstatná: runner dostává produkční funkce jako hodnoty parametru, ne importem. Kdyby si je naimportoval, balíček by se ve vlně 0 nepřeložil a `go test ./...` z jobu `test-go` by shodil celé CI.

Jediné povolené odkazy mimo balíček jsou čtení souboru v `sync-config-manifest.ts` a symlink `testdata`.

- [ ] **Krok 6: Ověř, že plán nesáhl mimo své vlastnictví**

```bash
git diff --name-only main...HEAD | sort
```

Expected: jen cesty ze seznamu v kapitole 9. Cokoliv navíc je chybný plán a musí se vrátit.

- [ ] **Krok 7: Commit**

```bash
git add -A
git commit -m "test(contracts): kompletní série obou stran a ověření CI bran"
```

---

## 8. Akceptační kritéria, která plán pokrývá

Číslování je z části 1, kapitoly 8, pokud není uvedeno jinak.

| # | Kritérium | Kde je pokryté |
|---|---|---|
| 41 | Všech nejméně 54 Liquid fixtures projde v TypeScriptu i v Go se shodným výstupem bajt po bajtu | úkol 15 a 16, dodáno **55** |
| 42 | Fixture přidaná jen do jedné strany způsobí selhání `test:parity` | úkol 19, kroky 3, 5 a 6. Brána porovnává **množiny id** proti fixtures na disku a navíc otisk, takže neprojde ani nad reportem ze staršího běhu. |
| 43 | Každý ze čtyř typů tokenů z Go je shodný s TypeScriptem a odpovídá vektoru ze 4.10.3 | úkol 8 (TS) a 11 (runner). **Tři ze čtyř**: identity token vydává aplikace, sender ho nestaví, viz `sides` u `TK-P3`. |
| 44 | Open token poslaný na `/t/c/` je odmítnutý s `token_type_mismatch` | úkol 8, vektor `TK-N3` |
| 45 | Obálka zašifrovaná v TypeScriptu je dešifrovatelná v Go a naopak; změna bajtu dá `crypto_auth_failed` | úkol 10 a 11, vektor `CR-N1`. Směr **Go šifruje** pokrytý není: sender šifrovat neumí a podle 4.10.4 nemá, credentials šifruje aplikace. |
| 46 | Obálka s kontextem `sending_provider` dešifrovaná s očekáváním `webhook_secret` selže | úkol 10, vektor `CR-N3` |
| 47 | Dva sendery claimující z outboxu s 1 000 zprávami zpracují každou právě jednou | úkol 5, scénář `OB-01` |
| 48 | Sender zabitý uprostřed dávky nezpůsobí ztrátu zprávy | **částečně**: SQL půlku pokrývá úkol 6 (`OB-02`, `OB-03`, `OB-04`), procesní půlku dokončí P09 (`OB-10`) |
| 49 | Sender s rolí `mlain_sender` dostane chybu oprávnění na `SELECT * FROM contacts` i na `DELETE FROM messages` | úkol 5, scénáře `OB-08` a `OB-09` |
| 50 | `Message-ID` vygenerovaný pro tutéž `messages.id` je při dvou pokusech identický | úkol 9 (TS) a 11 (runner), scénář `OB-11`, vektory `MI-001` až `MI-004` |
| 54 | Po rotaci `SECRET_KEY` s ponechaným `SECRET_KEY_PREVIOUS` se starý token stále ověří a nový se podepíše novým klíčem | úkol 21, krok 1 |
| část 3, 8.4/24 | `{% assign %}` vrátí `liquid_tag_not_allowed` s pozicí řádku a sloupce | úkol 12, fixture `LQ-501` |
| část 3, 8.4/25 | `{{ … \| vocative }}` vrátí `liquid_vocative_filter` s návrhem | úkol 12, fixture `LQ-510` |
| část 3, 8.4/26 | `{{- … -}}` vrátí `liquid_whitespace_control_not_allowed` | fixture `LQ-502` |
| část 3, 8.4/27 | Vnořený `for` vrátí `liquid_nested_for` | fixture `LQ-505` |
| část 3, 8.4/28 | Formát `%B %Y` vrátí `liquid_date_format_not_allowed`, tentýž zápis v textu `liquid_string_literal_not_allowed` | fixtures `LQ-511` a `LQ-700` |
| část 3, 8.4/28b, 28c, 28d | Uvozovka, apostrof a HTML entita v konstrukci | fixtures `LQ-700`, `LQ-701`, `LQ-702` |
| část 3, 8.4/30 | Každá fixture `LQ-*` dá v obou knihovnách bajtově shodný výstup | úkol 15 a 16 |
| část 3, 8.4/30b | Pro každý vestavěný filtr LiquidJS render selže, kromě naší pětice | úkol 13 |
| část 3, 8.4/31 | Kontakt se `<script>` se v HTML objeví escapovaný a v textu ne | fixtures `LQ-007` a `LQ-006` |
| část 3, 8.5/33c | Kontakt s prázdným `city` nedostane obsah bloku s `visibleWhen` | úkol 14 a fixture `LQ-307` |
| část 4b, kapitola 8 | Scénáře `OB-xx` | úkoly 2, 5 a 6 pro runner `contracts`; zbytek vykoná P09 nad tímtéž registrem |

Kritéria **nepokrytá tímto plánem, protože patří jinam:** 34 a 35 (OpenAPI, P04), 51 až 53 (i18n, P05), 1 až 13 (provoz, P01), 14 až 33 (identita a API framework, P04), 20 a 21 (RLS, P03).

---

## 9. Soubory, které tenhle plán vlastní

### 9.1 Výhradní vlastnictví

| Cesta | Poznámka |
|---|---|
| `packages/contracts/package.json` | přebírá se prázdný manifest od P01 a přepisuje celý |
| `packages/contracts/tsconfig.json` | totéž |
| `packages/contracts/tsconfig.build.json` | |
| `packages/contracts/vitest.config.ts` | |
| `packages/contracts/.gitignore` | |
| `packages/contracts/README.md` | |
| `packages/contracts/src/**` | všech devět modulů včetně `src/liquid/**` |
| `packages/contracts/test/**` | včetně `test/db/**` |
| `packages/contracts/scripts/**` | generátory a skripty jobů |
| `packages/contracts/schema/**` | devět JSON schémat plus generovaný `columns.json` |
| `packages/contracts/fixtures/liquid/**` | 55 souborů |
| `packages/contracts/fixtures/token/**` | |
| `packages/contracts/fixtures/crypto/**` | |
| `packages/contracts/fixtures/markers/**` | 10 souborů |
| `packages/contracts/fixtures/message-id/**` | závazné vektory base32 a hlavičky |
| `packages/contracts/fixtures/outbox/**` | registr scénářů a přechodů, bootstrap schéma, jedenáct SQL souborů |
| `packages/contracts/config.json` | generovaný, zrcadlo manifestu z P01 |
| `apps/sender/testdata` | symlink |
| `apps/sender/internal/contracts/**` | celá Go strana kontraktů |
| `.github/CODEOWNERS` | P01 vlastní `.github/workflows/**`, tenhle soubor v tom seznamu není |

### 9.2 Soubory, které plán mění, ale nevlastní

**Žádné.** Dřívější znění tady mělo `apps/sender/go.mod` a `go.sum`, do kterých zapisovalo příkazem `go get`, protože si samo psalo Go implementaci kontraktů. Po rozhodnutí D8 implementaci vlastní P09 a P02 vystačí se standardní knihovnou a s `pgx`, který v manifestu od P01 je. Tabulka je proto prázdná a úkol 3 to ověřuje příkazem `git diff --exit-code go.mod go.sum`.

### 9.3 Soubory, které plán zakládá a hned předává

| Cesta | Stav po tomhle plánu | Přebírá |
|---|---|---|
| `packages/contracts/fixtures/compiled/` | prázdný adresář se schématem, registrem a runnerem `assertCompiledFixture` | **P08 napíše data** `CT-001` až `CT-018` (rozhodnutí R3) |
| `packages/contracts/openapi.json` | **nevzniká vůbec** | P04 ho vygeneruje |
| `apps/sender/internal/token/golden_test.go` a čtyři obdobné | **nevznikají tady**, plán je vypisuje doslova v úkolech 11, 16 a 17 | P09 je zakládá a jimi runnery zapojuje |

### 9.4 Věta o hranicích

**Tenhle plán nesahá na žádný soubor mimo seznamy 9.1 a 9.3.** Konkrétně nepíše do `.github/workflows/**` ani do `tools/ci/**` (obojí vlastní P01), nemění `apps/sender/go.mod` ani `go.sum`, nezakládá `packages/db` ani žádnou migraci (P03), nepíše endpointy ani `packages/core` (P04), nesahá na `packages/ui`, `packages/i18n` ani `packages/emails`, a v `apps/sender` se drží výhradně adresářů `internal/contracts` a `testdata`.

Tři věci si plán **výslovně nenárokuje**, přestože by se to nabízelo:

- **Go implementaci kterékoliv z pěti smluv.** Vlastní ji P09 v produkčních balíčcích (rozhodnutí D8). Dvě implementace testované nad týmiž fixtures, z nichž binárka používá jen jednu, jsou horší než jedna netestovaná.
- **Bohatý katalog polí `FieldCatalog`.** Vlastní ho P07, protože jako jediný má model kontaktu a vlastní pole. Tenhle plán má jen úzký seznam povolených cest a jmenuje ho `LiquidRoots` (rozhodnutí R2).
- **Vzorky událostí od providera.** Jedenáct souborů s payloady od Amazonu vlastní P13 (rozhodnutí R4). Nejsou to kontrakty mezi TypeScriptem a Go, jsou to vzorky cizích formátů, tedy běžná testovací data domény, a do `packages/contracts` nepatří.

Když plán zjistí, že mu něco mimo tyhle hranice chybí, je to nález proti vlastníkovi, ne důvod sáhnout do cizího souboru. Seznam takových nálezů je v kapitole 2.1.

---

## 10. Nálezy proti zmrazenému kontraktu

Kontrakt se v rámci tohohle plánu nemění. Tohle je seznam míst, kde se při psaní ukázalo, že ho nejde realizovat doslova, a co s tím plán udělal. Každý nález potřebuje rozhodnutí vlastníka příslušné části dřív, než se plán prohlásí za hotový.

| # | Nález | Dopad | Co plán udělal |
|---|---|---|---|
| N1 | **`base32_lower` v `Message-ID` není určený.** Kontrakt 4.10.1 předepisuje tvar hlavičky a `OB-11` porovnává řetězec, ale abecedu ani padding neurčuje. Popsáno jako nález K13 v části 4b, do části 1 zanesené není. | `OB-11` nejde napsat vůbec | rozhodnutí D6: RFC 4648 standardní abeceda, bez paddingu, malými písmeny. Vyžaduje potvrzení vlastníka části 1. |
| N2 | **Literály `blank` a `empty` nemají chybový kód.** Gramatika kontraktu je povoluje, `osteele/liquid` je nezná (K4), část 3 říká, že je validátor odmítá, ale kód pro to v katalogu 3.7.4 nemá. Skupina `LQ-3xx` je přitom má pokrýt. | fixture na ně nejde napsat ani jako render, ani jako odmítnutí | rozhodnutí D5: pracovní kód `liquid_literal_not_supported`, fixture `LQ-308`. Vyžaduje potvrzení vlastníka části 3. |
| N3 | **Číslo fixtury `LQ-051` nezapadá do skupin.** Kontrakt ukazuje příklad s id `LQ-051` a zároveň řadí odmítnutí validátorem do skupiny `LQ-5xx` o deseti položkách. | rozpor v číslování | rozhodnutí D7: číslování po stovkách, vocative fixture má id `LQ-510`. Kontrakt sám mezitím opravil `code` v tom příkladu na `liquid_vocative_filter`, takže požadavek R20 části 3 je už splněný. |
| N4 | **Část 4b, kapitola 13.1 uvádí jiné hodnoty tokenů než část 1.** Zapisuje open token `t1bwEB…CerDYAWCif7x3s` a plnou HMAC `cc1d94f6…`, zatímco 4.10.3 má `t1bwEB…9cpqmSPs4g` a `d48e6713…`. | dvě různé pravdy o závazném vektoru | **ověřeno spuštěním**: platí hodnoty z části 1, viz kapitola 6. Záznam v části 4b je z verze před nahrazením `issued_at` polem `message_created_at`. Doporučeno opravit v části 4b, plán se řídí částí 1. |
| N5 | **Negativní vektor `CR-N7` má nedosažitelný kód.** Kontrakt čeká `crypto_envelope_malformed` u obálky zkrácené o tag, jenže po zkrácení se poslední bajty ciphertextu vezmou jako tag a GCM ověření selže dřív, tedy kódem `crypto_auth_failed`. Kód `crypto_envelope_malformed` je dosažitelný jen u obálky kratší než hlavička a nonce dohromady. | fixture by vynutila ohnutí normativního pořadí kroků | plán fixture zapisuje s hodnotou, kterou implementace skutečně vrací, a nález hlásí. Kód dešifrování se neohýbá. |
| N6 | **Počet fixtur kontraktu 5 se liší.** Část 3 (vlastník) uvádí 18 (`CT-001` až `CT-018`), část 4b uvádí 16. | nejasné, kolik jich má být | platí vlastník, tedy 18. **Data píše P08** (rozhodnutí R3), tenhle plán dodává schéma, registr a runner `assertCompiledFixture`. |
| N7 | **Scénář `OB-09` čte tabulku, která v kontraktní podmnožině není.** `contacts` vlastní část 2 a v bootstrapu pro `OB-00` neexistuje, takže `SELECT * FROM contacts` skončí `does not exist`, ne `permission denied`. | test by mohl projít ze špatného důvodu | test přijímá obě hlášky a v komentáři říká proč. Po merge P03 poběží tentýž test proti plnému schématu, kde je správnou odpovědí `permission denied`. |
| N8 | **`hint_contains` u fixtury `LQ-700` odkazuje na text hlášky, ne na data validátoru.** Kontrakt čeká `panel vlastností`, což je český text z katalogu části 3; validátor vrací jen `params.filter`. | fixture by testovala lokalizaci, ne kontrakt | `hint_contains` je nastavené na `default`, tedy na hodnotu, kterou validátor nese. Text hlášky ověří P08 a P05 ve svých katalozích. |
| N9 | **Tabulka skupin v 4.10.2 dává 54 fixtur a skupině `LQ-5xx` přiděluje deset, ale tabulka zakázaných konstrukcí vyžaduje fixture i pro `liquid_date_format_not_allowed`, který mezi těmi deseti není.** Naopak `liquid_string_literal_not_allowed` má fixtures dvě (`LQ-700` a `LQ-701`), obě v kontraktu vypsané doslova, takže je nelze přečíslovat. | vlastní pravidlo plánu „každý zakázaný kód má fixture" nešlo splnit | doplněna `LQ-511`, skupina má jedenáct položek a celek 55. Kritérium 41 i job `contracts-golden` mluví o „**nejméně** 54", takže rozpor zůstává jen ve skupinové tabulce. **Vyžaduje potvrzení vlastníka části 1.** |
| N10 | **Kód `liquid_literal_not_supported` z rozhodnutí D5 není v registru chybových kódů P01.** Ověřeno grepem: `VALIDATION_CODES` má 27 kódů s prefixem `liquid_` a tenhle mezi nimi není. | fixture `LQ-308` by očekávala kód, který registr nezná | kód zůstává (bez něj nejde napsat ani render, ani odmítnutí), doplnění do registru je požadavek P02→P01.1. |
| N11 | **Sender čtyři kontraktní operace vůbec nemá.** Neověřuje tokeny (dělá to aplikace), nevydává identity token, nešifruje credentials a nemá validátor Liquidu. | šest negativních tokenových vektorů, jeden pozitivní a validační fixtures nejde na Go straně spustit | zavedeno pole `sides` ve fixtures: co která strana zpracuje, je **data pod CODEOWNERS**, ne rozhodnutí runneru za běhu. `check-parity` z něj počítá očekávanou množinu, takže „nepoužitelné z principu" je vidět jinak než „někdo si to odpustil". Rozšíření kontraktu to není, je to jeho zápis. |
| N13 | **Vzor `RAW_SLOT_PATTERN` nenašel ani jeden skutečný žeton.** Dřívější znění mělo `/ML_RAW_(\d{4})/gi`, jenže P08 emituje `ML_RAW_<nonce>_nnnn` s desetiznakovým nonce mezi předponou a číslem. **Ověřeno spuštěním proti čtyřem žetonům opsaným z P08: nula shod.** Sesterský `FILTER_SLOT_PATTERN` sedí přesně, protože `ML_ARG_` má číslo hned za předponou. | mrtvý kód, na který by někdo spoléhal; díru zavíralo jen `findLeftoverMarker` nad `RESERVED_MARKERS`, které funguje | vzor opraven na `/ML_RAW_([a-z0-9]+)_(\d{4})/gi`, přidána konstanta `RAW_SLOT_PREFIX` a test nad **skutečnými žetony P08**, ne nad vymyšleným tvarem. Délka nonce se nevynucuje: v produkci má deset znaků, ale fixtures P08 používají `goldennonce` (11) a `contractnonce` (13). |
| N14 | **`RenderSchema` je pod jedním jménem dva neslučitelné typy.** Úzký `{ fields, presence }` v `prepare-render-data.ts` a bohatý tvar kontraktu 5 s typy polí a systémovými značkami, který vlastní P08. Je to tentýž problém, jaký u katalogu polí vyřešilo rozhodnutí R2. | první, kdo si jméno splete, dostane buď chybu typu, nebo přetypování, které kontrolu ztratí | úzký typ přejmenován na `PreparedDataSchema` (požadavek R13 plánu P08). Bohaté jméno zůstává P08. |
| N12 | **Negativní vektor `CR-N2` používal kontext mimo uzavřený výčet.** Řetězec `ai_provider_____` v `CREDENTIAL_CONTEXTS` není a schéma výčet nevynucovalo. | fixture testovala tvar, který v produktu nemůže vzniknout | vektor přepsán na jiný **platný** kontext (`webhook_secret`) a schéma výčet nově vynucuje. Ověřeno spuštěním, viz kapitola 6. |

**Co se naopak ověřilo jako přesné a implementovatelné:** odvození klíčů a všechny tři odvozené klíče, otisk klíče, všech pět tokenových vektorů včetně délek a plných HMAC, celá krypto obálka včetně AAD a `stored`, a jedenáct normativních SQL dotazů včetně toho, že zakázaný tvar s `JOIN … ON` selže přesně předpovězenou hláškou. Kapitola 6 to dokládá spuštěním.

---

## 11. Jak se plán provádí

Dvě možnosti, obě předepsané dovedností `superpowers:writing-plans`:

1. **Subagent-driven (doporučeno).** Na každý úkol čerstvý subagent, mezi úkoly revize. Rychlá iterace, hlavní vlákno se neplní výpisy. Vyžaduje `superpowers:subagent-driven-development`.
2. **Inline.** Úkoly se provádějí v jedné session s kontrolními body. Vyžaduje `superpowers:executing-plans`.

Před spuštěním musí být hotová druhá fáze podle řídicího dokumentu, kapitoly 7: na plán se pustí `/replan:replan` a nálezy se do něj zapracují. Plán, který prošel jen fází 1, se nepovažuje za hotový.
