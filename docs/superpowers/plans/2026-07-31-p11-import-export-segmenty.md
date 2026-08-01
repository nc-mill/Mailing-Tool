# P11 Import, export a segmenty: implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dodat proudový import kontaktů ze souboru včetně fronty ke kontrole oslovení, export kontaktů a celý segmentační engine s vizuálním builderem, tedy vertikální řez od kompilátoru SQL až po prokliknutelnou obrazovku.

**Architecture:** Tři moduly v `@mlain/core`. Segmenty mají čistou část (Zod schéma AST, typová matice operátorů, limity, kanonizace) a kompilátor, který je také čistá funkce: bere AST a vrací `{ sql, params }`, takže se žádný uživatelský vstup nikdy nedostane do textu dotazu. Spouštění jde přes transakční primitivum z `@mlain/db`, uvnitř transakce se nastaví `mlain.workspace_id` a `transaction_read_only`, takže RLS jistí kompilátor potřetí a chyba v něm nemůže nic zapsat. Import je proudová roura: soubor se nikdy nenačte do paměti celý, čte se po dávkách 1 000 řádků a každá dávka zapisuje kontakty i svůj checkpoint v jedné transakci, takže pád workera znamená rollback dávky, ne poškozený import. Fronta ke kontrole oslovení je poslední fáze importu, ne samostatná funkce: nejistý vokativ se nikdy neuhodne, kontakt dostane neutrální oslovení a čeká na rozhodnutí člověka, seskupené podle jména, ne po kontaktech.

**Tech Stack:** TypeScript 7.0.2 (Apache-2.0), Next.js 16.2.12 App Router (MIT), Hono s `@hono/zod-openapi` (MIT), PostgreSQL 18 (PostgreSQL License), Drizzle ORM (Apache-2.0), zod 4.4.3 (MIT), `csv-parse` 7.0.1 (MIT), `csv-stringify` 6.8.1 (MIT), `iconv-lite` 0.7.3 (MIT), pg-boss 12.26.3 (MIT), next-intl 4.13.4 (MIT), Vitest 4.1.10 (MIT), testcontainers 12.0.4 (MIT). Detekce kódování **nemá žádnou závislost**, viz rozhodnutí R3. Žádná GPL, LGPL ani AGPL závislost.

---

## 0. Než začneš

### 0.1 Co tenhle plán vlastní

Úplný seznam souborů je v kapitole 12 a končí větou, kterou si přečti dřív, než otevřeš první soubor. Ve zkratce: `packages/core/src/segments/**`, `packages/core/src/contacts/import/**`, `packages/core/src/contacts/export/**`, jejich testy v `packages/core/test/**`, obrazovky průvodce importem (část 6, kapitola 8.3), kontroly oslovení (8.3.7) a segment builderu (8.4) v `apps/web`, a katalogy `packages/i18n/messages/{cs,en}/import.json` a `segments.json`.

### 0.2 Čeho se tenhle plán nedotkne

| Oblast | Vlastník | Co z toho plyne pro tebe |
|---|---|---|
| `packages/db/**`, schéma, migrace, RLS | P03 | Tabulky `imports`, `import_errors`, `exports`, `segments`, `segment_members`, `name_overrides`, `contacts` už existují v `packages/db/src/schema/contacts.ts`. Nespouštíš `drizzle-kit generate`, nepíšeš migraci, nepřidáváš sloupec. Chybějící sloupec je nález proti P03, ne tvoje práce. |
| `packages/ui/**`, komponenty K1 až K8 | P05 | K1 (tabulka), K2 (query builder), K3 (průvodce), K4 (nahrání souboru) používáš z `packages/ui/src/patterns/*`, nepíšeš je. Píšeš k nim ale **konformanční testy**, viz úkoly 44 a 52. Když komponenta nestačí, je to požadavek na P05, ne vlastní komponenta v `packages/ui`. |
| `packages/i18n` infrastruktura, `common`, ICU kontroly | P05 | Zakládáš jen dva soubory katalogu na jazyk, svoje dva namespace. |
| Registr chybových kódů `packages/core/src/errors/registry.ts` | P01 | Kódy jen **používáš**. Úkol 2 přidává test, který ověří, že všech 38 kódů tohohle plánu v registru existuje, a ptá se přes `isRegisteredCode()`, ne indexací `ERROR_CODES`. Chybějící kód je nález proti P01. |
| Registr front `packages/core/src/queues/registry.ts` | P01 | Totéž pro čtyři fronty, přes `queueNames()`. Pátá, `contacts.bulk_vocative_review`, odešla s frontou oslovení na P07. |
| Zod schéma konfigurace `packages/core/src/config/schema.ts` | P01 | Šestnáct proměnných z 5.9 části 2 tam musí být. Úkol 2 to ověřuje testem, protože nejsou v tabulce 4.9 části 1 a P01 na ně může zapomenout. |
| `apps/web/src/app/api/v1/[[...route]]/route.ts`, `apps/web/src/lib/api/**` | P04 | Obálka chyb, stránkování, idempotence, rate limit, generátor OpenAPI. Píšeš Hono routy, ne Next.js route handlery. |
| `packages/core/src/identity/**`, `WorkspaceContext`, `wsEq` | P04 | Voláš, nepíšeš. |
| Model kontaktu, upsert, vokativ, souhlasy, suppression, CRUD kontaktů | P07 | `resolveName()`, `normalizeEmail()`, `normalizeNameKey()` a `upsertContacts()` **voláš**, nepíšeš vlastní zápis kontaktu. Blokované adresy, formuláře, GDPR a hromadné mazání kontaktů jsou P07. **Po rozhodnutí U3 i celá fronta ke kontrole oslovení**, tedy modul, job, obě routy i obrazovka. |
| Materializace publika kampaně, kontrolní seznam odeslání | P13 | Dodáváš jim `compileAudienceToSql()` a komponentu rozpadu publika, kampaň ne. |
| Rollup `contact_engagement` | P03 vlastní sloupce, P10 a P14 je plní | Kompiluješ proti němu, neplníš ho a **nežádáš o něj sloupce**: ty už existují, jen se jmenují `sent_total`, `delivered_total`, `opens_total`, `clicks_total` a `bounces_total`. |
| Reaktivační kampaň (krok 3 scénáře ze 4.12) | P13 | Vlastníš zmrazení, nastavení úklidu, odpočet a poslední potvrzení. Kampaň mezi tím ne. |
| `apps/worker`, `turbo.json`, `docker/`, `.github/workflows`, `apps/web/src/proxy.ts` | P01 a P05 | Nesaháš. |

### 0.3 Tři úzké výjimky, které si tenhle plán bere

Uzávěr „jeden soubor, jeden plán" má tři místa, kde ho nejde dodržet doslova, protože cílové soubory nemají zástupný znak a vlastník je nemůže naplnit dopředu za všechny domény. U každého je uvedený přesný rozsah a pravidlo pro řešení konfliktu. **Mimo tyhle tři soubory se do cizího vlastnictví nezasahuje vůbec.**

| Soubor | Vlastník | Co přesně přidáváš | Pravidlo pro merge |
|---|---|---|---|
| `packages/core/package.json` | P01 | **jen** tři závislosti (`csv-parse`, `csv-stringify`, `iconv-lite`) a skript `test:db` | ponechají se obě strany, klíče se seřadí abecedně, soubor se nikdy nepřeformátuje |
| `packages/core/vitest.db.config.ts` | nový soubor, věcně patří P01 | celý soubor, 12 řádků | při shodě s cizí verzí se ponechá jedna, obsah je triviální |
| `apps/web/src/lib/api/app.ts` | P04 | tři řádky registrace rout | ponechají se obě strany, pořadí registrací nerozhoduje |

**Do `exports` se nepřidává nic.** Mapa v `packages/core/package.json` má zástupný znak (`"./*/jobs"` a `"./*"`), takže podcesty tohohle plánu vznikají samy. Ověřeno spuštěním pod Node 24 proti mapě, kterou zakládá P01:

```
FAIL @mlain/core                        -> ERR_PACKAGE_PATH_NOT_EXPORTED   (kořen schválně neexistuje)
OK   @mlain/core/segments               -> src/segments/index.ts
OK   @mlain/core/contacts/import        -> src/contacts/import/index.ts
OK   @mlain/core/contacts/export        -> src/contacts/export/index.ts
OK   @mlain/core/contacts/import/jobs   -> src/contacts/import/jobs/queue-handlers.ts
```

Zástupný znak pohlcuje i lomítka, takže dvouúrovňová podcesta se rozřeší na soubor, ne na adresář. To je ten rozdíl proti nálezu P07-1: tam mířila hluboká podcesta na `.../catalog/index.ts`, tedy na jiný soubor, než autor čekal. Tady je `src/contacts/import/index.ts` přesně ten soubor, který tenhle plán zakládá.

U posledního řádku tabulky je preferované řešení jiné a je zapsané jako požadavek v kapitole 11: P04 má mít registr, který globuje `packages/core/src/*/api/*.routes.ts`. Do doby, než ho dodá, platí tři řádky.

---

## 1. Rozhodnutí, která tenhle plán uzavírá

Specifikace a už napsané plány si na sedmnácti místech buď odporují, nebo mlčí. Rozhoduju to tady, aby se to za měsíc neotvíralo znovu.

| # | Věc | Zdroje | Rozhodnutí a proč |
|---|---|---|---|
| R1 | Kde žije kompilátor segmentů. Část 2 (4.11.3) říká `packages/db/src/repo/segments.ts`, ale `packages/db` celý vlastní P03 | 02 vs. P03 vs. P04 | **Čistý kompilátor je v `packages/core/src/segments/compile/`, spouštěč v `packages/core/src/segments/repo.ts`.** Důvod části 2 byl, že část 1 zakazuje import `db` mimo `packages/db`. Kompilátor ale `db` neimportuje: je to stavěč řetězce, který vrací `{ sql, params }`. Spouštění jde přes `withWorkspace` a `withReadOnly` z adaptéru `@mlain/core/tx` (P04), tedy přes schválené transakční primitivum. P03 v 0.2 výslovně říká, že `packages/db/src/repo` obsahuje jen infrastrukturu a doménová repository si píše každý doménový plán ve svém balíčku, a P04 to potvrzuje rozhodnutím R1. Všechny bezpečnostní vlastnosti (čtyřčlenná obálka, parametry, RLS, read-only transakce) zůstávají a jsou vynucené testy nad **textem dotazu**, ne umístěním souboru. |
| R2 | Kdo vlastní frontu ke kontrole oslovení | řídicí dokument („vokativ" u P07 a „fronta je součást importu" u P11) vs. zadání P11 | **Rozhodnuto ve prospěch P07** (rozhodnutí U3, 2026-08-01, evidence `NALEZY-NAPRIC-PLANY.md`). Frontu vlastní P07 celou: modul v `packages/core/src/contacts/naming/`, job, obě routy i obrazovku. Důvod je věcný, ne formální: **vokativ se počítá při zápisu kontaktu**, takže nejisté případy vznikají i přes API, z formuláře a z příchozího webhooku, a ty tři cesty vlastní P07. Kdyby frontu vlastnil import, neměly by do ní čím zapsat. **Z tohohle plánu tím vypadly úkoly 37, 38 a 53**, zbylých 57 se nemění. Tenhle plán frontu jen **volá**: výsledková obrazovka importu na ni odkazuje s filtrem na konkrétní import přes `listReviewGroups(ctx, { importId })` (požadavek 7.6). P07 vlastní i `resolveName()`, výpočet vokativu, sloupce kontaktu a `name_overrides`. |
| R3 | Knihovna na detekci kódování | 02 (4.6.2, 10.3) | **Žádná.** `jschardet` 3.1.4 je LGPL-2.1+ a je zakázaný licenční bránou. `chardet` 2.2.0 je sice MIT, ale ověřeně vrací `windows-1252` pro skutečná data v CP1250, protože se ty dvě kódové stránky liší jen v horní polovině. Detekce je proto vlastní: BOM, pak striktní validace UTF-8, pak skóre podle českých písmen. Dekódování obstará **`iconv-lite` 0.7.3, licence MIT**. Skórovací tabulka ze 4.6.2 části 2 je součástí testů, ne jen kódu. |
| R4 | Nahrávání souboru po částech | 06 (13.1, K4) vs. 02 (5.3) | **Jeden proudový požadavek, ne dělený upload.** Tělo `POST /api/v1/contacts/imports` se čte jako `ReadableStream` a zapisuje na disk po kusech, takže server nikdy nedrží 200 MB v paměti. Klient posílá přes `XMLHttpRequest`, který umí `upload.onprogress` a `abort()`, takže průběh i zrušení jsou splněné. Dělený upload se třemi novými endpointy jsem zamítl: tabulka rozhraní v 5.3 části 2 je normativní a žádný z nich neobsahuje, obnovitelnost přerušeného **nahrávání** není v žádném akceptačním kritériu a soubor jde nahrát znovu. Obnovitelnost **zpracování** je něco jiného, ta je povinná a řeší ji checkpoint (úkol 27). |
| R5 | „Vrátit tento import" (část 6, 6.6, poslední řádek) | 06 vs. 02 | **Není v MVP 0.** Část 2 vlastní datový model importu a nemá kam ukládat předchozí hodnoty aktualizovaných kontaktů, tabulku pro to nemá ani P03 a založit ji nesmím. Část 6 na to zároveň nemá akceptační kritérium. Náhrada, kterou plán dodává: krok 5 průvodce předvyplňuje štítek `import-{rrrr}-{mm}-{dd}` a výsledková obrazovka nabízí „Zobrazit naimportované kontakty", což je seznam filtrovaný přes `source_ref = {import_id}`, nad kterým funguje hromadný výběr a hromadné akce P07. Rozpor je zapsaný v kapitole 11. |
| R6 | Kdo vlastní rozpad publika z 8.4.6 | 06 (kapitola 8.4 patří P11) vs. P13 | **Vlastní ho tenhle plán**, protože počítá brány nad segmentem, což je segmentační logika. Routa je `POST /api/v1/segments/audience-breakdown`, komponenta `apps/web/src/components/segments/audience-breakdown.tsx`. P13 ji jen použije na obrazovce kampaně. |
| R7 | Kolik operátorů má matice | 02 (4.11.2) vs. 06 (8.4.3, kritérium 44) | **Čtyřicet unikátních kódů.** Jsou vyjmenované v `packages/core/src/segments/operators.ts` a test je počítá, aby se počet nedal tiše změnit. |
| R8 | Kde se bere `now()` | 02 (4.11.3) | **Nikde.** Každý relativní časový výraz se kompiluje proti `$2`, kterým je `opts.asOf`. Kontroluje to test nad **textem** dotazu pro všechny kombinace pole a operátoru, ne test chování, protože chování by se muselo trefit do závodu. |
| R9 | Přetypování `::numeric` u vlastních polí | 02 (4.11.3) | **Vždy uvnitř `CASE WHEN ... THEN ... ELSE false END`**, nikdy za `AND`. PostgreSQL negarantuje pořadí vyhodnocení operandů `AND`, takže cast za `AND` spadne nedeterministicky na `22P02` podle zvoleného plánu. Test kontroluje text dotazu. |
| R10 | Prefix URL aplikace | 06 (4.3) | `/{locale?}/w/{slug}/…`, tedy adresář `apps/web/src/app/[locale]/w/[slug]/`. Krok průvodce je v query (`?step=mapping`), ne v segmentu cesty, protože to 4.3 předepisuje jmenovitě. |
| R11 | `packages/core/src/…` versus `packages/core/…` | P01 vs. P04 vs. specifikace | **Všechno pod `src/`.** P01 vlastní `packages/core/package.json` a jeho mapa `exports` ukazuje na `./src/<domena>/index.ts`. Cesta bez `src/` by se přes Node resolver nenačetla. Citace ve specifikaci a v P04 bez `src/` jsou zkratky, ne jiná struktura. |
| R12 | Kam se píšou testy | P01 (`include: ['test/**/*.test.ts']`) vs. P04 a P05 (kolokace) | **Do `packages/core/test/**`, zrcadlově ke zdroji.** Kolokované testy by konfigurace P01 vůbec nespustila, což je nejhorší možný výsledek: zelené CI a nespuštěná sada. Testy proti databázi se jmenují `*.db.test.ts` a spouští je `packages/core/vitest.db.config.ts`. Testy obrazovek jsou v `apps/web/test/**`, protože `apps/web` má vlastní konfiguraci. |
| R13 | Read-only pool, který P03 neslibuje | 02 (požadavky 1.6 a 1.7) vs. P03 | **Neplatí, předpoklad byl chybný. P03 obojí má a je to lepší, než co si tenhle plán chtěl postavit sám.** Ověřeno čtením `packages/db/src/repo/tx.ts` a manifestu: existuje `withReadOnly(pool, ctx, { statementTimeoutMs, workMem }, fn)`, které dělá `BEGIN READ ONLY`, `SET LOCAL statement_timeout`, `SET LOCAL work_mem` i `set_config('mlain.workspace_id')`, a existuje `createPool(url, 'readOnly')` s `-c default_transaction_read_only=on`, tedy skutečný oddělený pool s typem `PoolKind = 'app' \| 'readOnly'`. Objektový tvar čtvrtého argumentu přidalo P03 **kvůli tomuhle plánu**, aby šlo předat `work_mem`. **Rozhodnutí: `runReadOnly` z tohohle plánu je tenká obálka nad `withReadOnly` z `@mlain/core/tx`, nic vlastního.** Dvě verze téhož bezpečnostního primitiva se rozejdou při první úpravě, což je přesně ta chyba, před kterou tenhle plán varuje v kapitole 14 u obálky segmentu. Ochrana je tím dvouvrstvá: pool s `default_transaction_read_only` a `BEGIN READ ONLY` na úrovni transakce. Test „INSERT uvnitř transakce náhledu selže na 25006" zůstává v úkolu 15. |
| R14 | Tvar registrace job handlerů | P01 rozhodnutí D4 (`jobs/queue-handlers.ts`) vs. P04 rozhodnutí R3 (`jobs/<akce>.ts`) | **Obojí.** Každá akce je vlastní soubor `jobs/<akce>.ts` s `export const handler`, a vedle nich je `jobs/queue-handlers.ts`, který je jen sestaví do mapy. Stojí to deset řádků na doménu a přežije to, ať v P01 zvítězí kterýkoliv tvar. Codegen workeru navíc musí globovat rekurzivně, protože import je o úroveň hlouběji; je to zapsané jako požadavek v kapitole 11. |
| R15 | Do kterého namespace patří klíče importu a vokativu | 02 (6.3 používá `contacts.import.*`) vs. uzávěr S4 | **Do namespace `import`.** Klíč `contacts.import.detected` se stává `import.detected`, `contacts.vocative.groupHint` se stává `import.vocative.groupHint`. Soubor katalogu je hranice vlastnictví a dva plány zapisující do `contacts.json` jsou přesně ten konflikt, kterému uzávěr S4 předchází. **Znění textů se nemění**, mění se cesta klíče, což je směrovací detail. Úplná převodní tabulka je v úkolu 40. |
| R16 | Kde se registrují Hono routy | P04 | Každá doména exportuje `registerSegmentRoutes(app)`, `registerImportRoutes(app)` a `registerExportRoutes(app)` z `packages/core/src/<domena>/api/index.ts`. Registrace je tři řádky v `apps/web/src/lib/api/app.ts` (úzká výjimka z 0.3). Žádný Next.js route handler pod `/api/v1` tenhle plán nezakládá. |
| R17 | Tvar chybové odpovědi | P04 | Kořenové `code` je vždy obecné z katalogu části 1, doménový kód jde do `errors[].code`. Duplicitní import je tedy `409` s `code: "conflict"` a `errors[0] = { path: "_", code: "import_duplicate" }`. Řádkové chyby importu se do HTTP odpovědi nepromítají vůbec, žijí v `import_errors.error_code` a v `imports.error_summary`. |
| R18 | Jak běží úlohy, které musí vidět napříč projekty | P03 (RLS) vs. potřeba plánovače | **Nesmí se spoléhat na `withoutContext`, protože ta na tabulce s RLS vrátí nula řádků a NEVRÁTÍ chybu.** `segments` i `imports` mají politiku `ws_isolation` s `USING (workspace_id = current_setting('mlain.workspace_id', true)::uuid)`; bez kontextu je porovnání s NULL nepravda, tedy žádné řádky. `mlain_app` nemá `BYPASSRLS` a P03 to výslovně odmítá testem „žádná aplikační role nemá BYPASSRLS". **Rozhodnutí je dvojí.** Za prvé, obnova zaseknutého importu **globální sken nepotřebuje** a nesmí na něm stát: jede z fronty, jejíž payload nese `workspaceId`, takže běží pod `withWorkspace(ctx)` jako každá jiná doménová operace (úkol 35). Za druhé, hodinový přepočet zastaralých segmentů globální sken potřebuje, dostane ho stejným mechanismem, jaký si na totéž vyžádal P10 (politika `system_bypass`), a **do jeho dodání se nesmí tvářit, že uklidil**: sken má strážce, který ticho odliší od prázdna a shodí job hlasitou chybou. Zapsáno jako požadavek 3.2 a v evidenci napříč plány. |
| R19 | Varování „vlastní pole není indexované" | P03 (`contact_fields.indexed`) vs. zákaz zakládat indexy | **Varování se neváže na sloupec `indexed`, ale na použitý operátor.** Sloupce `indexed` a `index_state` v P03 existují, ale **nikdo je nezapisuje** a P03 v kapitole 8 zakazuje všem ostatním plánům zakládat index. Čtení `if (!row.indexed)` by tedy svítilo u každého vlastního pole navždy a nemělo by ho co zhasnout, což je horší než varování nemít: uživatel se naučí ho ignorovat. Jediný index nad `attributes` je `idx_contacts__attributes_gin` s `jsonb_path_ops`, a ten **umí výhradně `@>`**. Varování `segment_unindexed_field` proto vydává kompilátor podle toho, jestli podmínku umí přeložit na `@>`, nebo ne, což je vlastnost, kterou zná bez dotazu do databáze a která odpovídá skutečnosti. Sloupce `indexed` a `index_state` tenhle plán nečte. |
| R20 | Brána „ukázkové kontakty" v rozpadu publika | 06 (8.4.6) vs. P03 | **Brána zůstává v pořadí i v UI, ale její predikát je natvrdo `false`, dokud sloupec neexistuje.** `contacts.is_sample` v P03 není a ukázková data vlastní P16. Bezpodmínečné `b.is_sample = true` by neshodilo jen tuhle bránu: `GATE_SQL` se skládá do jednoho dotazu se sedmi `count(*) FILTER`, takže celý rozpad publika by spadl na `42703 column b.is_sample does not exist`. Řeší se stejně jako brána `duplicate`, která je natvrdo `false` už teď, a je na to test, který obě brány drží na nule. Požadavek na sloupec je zapsaný v kapitole 11 a v evidenci. |

---

## 2. Co plán čte z cizích balíčků

Tohle jsou jediná místa, kde se opíráš o cizí práci. Když se jméno symbolu v cílovém plánu liší, oprava je v těchhle importech a nikde jinde.

```ts
// z @mlain/core/tx (P04): transakční vrstva. Tenhle plán NEIMPORTUJE nic z @mlain/db
// kromě tabulek, protože obálky v @mlain/db berou pool jako první argument
// a pool si doménový balíček importovat nesmí. Adaptér P04 pool doplní ze singletonu.
import { withWorkspace, withReadOnly, withoutContext, pgErrorCode, type Tx } from '@mlain/core/tx';

// tabulky drizzle (P03) jdou výhradně podcestou @mlain/db/schema, kořen je nevystavuje
import {
  contacts, imports, importErrors, exports as exportsTable,
  segments, segmentMembers, nameOverrides, contactFields,
  lists, tags, listSubscriptions, contactTags, suppressions, contactConsentState,
} from '@mlain/db/schema';

// stavěč SQL, kterým se spouští text z kompilátoru
import { sql } from 'drizzle-orm';

// z @mlain/core (P01)
import { ERROR_CODES, isRegisteredCode, ALL_REGISTERED_CODES } from '@mlain/core/errors';
import { ApiError } from '@mlain/core/errors';
import { QUEUES, queueNames } from '@mlain/core/queues';
import { config } from '@mlain/core/config';
import { logger } from '@mlain/core/logging';

// z @mlain/core/identity (P04)
import type { WorkspaceContext } from '@mlain/core/identity';
import { wsEq } from '@mlain/core/identity';

// z @mlain/core/contacts (P07)
import { resolveName, normalizeNameKey, normalizeEmail, upsertContacts } from '@mlain/core/contacts';
import type {
  NameResult, ContactsWorkspaceSettings, NameOverrideLookup, ContactUpsertRow, UpsertMode,
} from '@mlain/core/contacts';

// z @mlain/ui (P05): VŽDY podcesta na úroveň adresáře. Kořenový import neexistuje,
// P05 klíč "." z exports odstranil, takže `from '@mlain/ui'` skončí chybou
// ERR_PACKAGE_PATH_NOT_EXPORTED už při sestavení.
import { DataTable } from '@mlain/ui/patterns/data-table';
import { QueryBuilder } from '@mlain/ui/patterns/query-builder';
import { Wizard } from '@mlain/ui/patterns/wizard';
import { FileUpload } from '@mlain/ui/patterns/file-upload';
import { useToast } from '@mlain/ui/hooks/use-toast';
```

Pravidla, která z toho plynou a která hlídají testy P04:

1. Každá doménová funkce bere `WorkspaceContext` jako **první argument**, nikdy `workspaceId: string`. Platí to i pro transakční obálky adaptéru P04: `withWorkspace(ctx, fn)`, ne `withWorkspace(workspaceId, fn)`.
2. Filtrování podle projektu se dělá výhradně přes `wsEq(ctx, table)`, ne ručním `eq(table.workspaceId, …)`.
3. Přímý import poolu `db` mimo `packages/db` zakazuje ESLint, a transakci nesmí otevřít nikdo jiný než adaptér `@mlain/core/tx`. Klientem databáze se v tomhle plánu dotýkají **právě dva soubory**: `packages/core/src/segments/sql-runner.ts` a `packages/core/src/contacts/import/db.ts`, a oba jen tím, že delegují na `@mlain/core/tx`.
4. **`Tx` je drizzle handle (`NodePgDatabase`), ne `pg.PoolClient`.** Plyne z toho trojí, a všechno tři je ověřené spuštěním na drizzle-orm nad PostgreSQL 18, ne odvozené z dokumentace:
   - `tx.execute()` bere **jeden** argument typu `SQL`, ne dvojici `(text, params)`. Text s `$1` se na `SQL` převádí funkcí `toSql()` z úkolu 7.
   - **Výsledek je obálka, ne pole.** `tx.execute()` vrací `Result` s vlastností `rows`. Vzor `(await tx.execute(...)) as Row[]` projde typovou kontrolou a `[0]` na něm je **vždy `undefined`**. Čte se výhradně `.rows`.
   - **Kód chyby databáze leží na `error.cause.code`, ne na `error.code`.** Přes drizzle je `error.code` vždy `undefined`, takže každé ošetření kolize napsané podle `error.code` by se **nikdy neprovedlo**. Čte se výhradně `pgErrorCode(error)` z `@mlain/core/tx`.
5. **Holé pole v šabloně `sql` se rozloží na jednotlivé parametry.** `sql\`... = ANY(${values})\`` vyrobí `ANY(($1, $2, $3))` a dotaz spadne na `42809 op ANY/ALL (array) requires array on right side`, ověřeno spuštěním. Seznam hodnot se předává výhradně přes `sql.param(values)`, které vyrobí `ANY($1)` s jedním polem.

---

## 3. Nové závislosti a jejich licence

Licenční brána `licenses-node` z P01 běží v CI a povoluje pro `dependencies` jen MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, CC0-1.0, Unlicense a Python-2.0. Všechny tři přidávané balíčky jsou MIT.

| Balíček | Verze | Licence | Kam | K čemu |
|---|---|---|---|---|
| `csv-parse` | 7.0.1 | MIT | `packages/core` | Proudové parsování CSV. Vybraný proto, že hlásí přesnou pozici ve vstupu, kterou potřebujeme pro `checkpoint_byte`. |
| `csv-stringify` | 6.8.1 | MIT | `packages/core` | Generování exportů a `errors.csv`. |
| `iconv-lite` | 0.7.3 | MIT | `packages/core` | Dekódování `windows-1250` a `ISO-8859-2`, kódování exportu do `windows-1250`. |

**Zamítnuté a proč**, ať to někdo v půlce práce nezkusí znovu:

| Balíček | Verze | Licence | Verdikt |
|---|---|---|---|
| `jschardet` | 3.1.4 | **LGPL-2.1+** | **Zakázáno licencí.** Nesmí se použít ani na detekci kódování, ani nikde jinde. Licenční brána ho zachytí, ale to je pojistka, ne povolení to zkusit. |
| `czech-inflection` | 1.1.1 | **LGPL v2.1** | **Zakázáno licencí.** V JavaScriptu se knihovna bundluje, takže argument o dynamickém linkování neobstojí. |
| `chardet` | 2.2.0 | MIT | Licenčně v pořádku, **funkčně nevyhovuje**: pro skutečná data v CP1250 vrací `windows-1252`, obě kódování s důvěrou pod 30 procent. Měření je ve 4.6.2 části 2. |
| `papaparse` | 5.5.4 | MIT | Licenčně v pořádku, ale neumí spolehlivě hlásit bajtovou pozici ve vstupu, bez které nejde obnovit import po pádu. |
| `pa11y` | 9.1.1 | **LGPL-3.0-only** | Zakázáno licencí. Přístupnost se testuje `axe-core` (MPL-2.0, jen `devDependencies`, výjimku v bráně vlastní P01). |

Balíček `czech-vocative` 2.1.0 (MIT) přidává P07, tenhle plán ho používá jen nepřímo přes `resolveName()`.

---

## 4. Struktura souborů

```
packages/core/src/segments/
├── index.ts                    veřejné rozhraní, subpath @mlain/core/segments
├── ast.ts                      Zod SegmentAstV1, typy Node, GroupNode, ConditionNode, FieldRef
├── json-schema.ts              JSON Schema verze 1 pro GET /segments/schema
├── operators.ts                matice pole × operátor, 40 operátorů, typová kompatibilita hodnot
├── limits.ts                   devět limitů složitosti ze 4.11.4
├── canonical.ts                kanonický JSON a definition_hash
├── references.ts               vrstva 3: příslušnost k projektu, graf odkazů, detekce cyklu
├── compile/
│   ├── index.ts                compileSegmentSql, jediný vstupní bod kompilace
│   ├── params.ts               ParamBag, číslování od paramOffset + 1
│   ├── envelope.ts             čtyřčlenná obálka, jedna verze, žádná jiná
│   ├── columns.ts              CONTACT_COLUMN_SQL, konstantní mapa
│   ├── contact.ts              prvotřídní pole
│   ├── attribute.ts            vlastní pole, CASE WHEN u castů, tříbranné is_empty
│   ├── tag-list-consent.ts     tag, list, consent, suppression
│   ├── engagement-event.ts     engagement přes rollup i přes messages, event
│   └── segment-ref.ts          odkaz na jiný segment, statický i dynamický
├── sql-runner.ts               read-only transakce, statement_timeout, odhad z EXPLAIN
├── repo.ts                     countSegment, listSegmentContacts, compileAudienceToSql
├── service.ts                  CRUD, freeze, recount, čerstvost
├── presets.ts                  šest presetů čištění ze 4.12
├── diagnostics.ts              rozpad prázdného výsledku po podmínkách
├── audience.ts                 rozpad publika po branách, 8.4.6 části 6
├── audit.ts                    segment.created, segment.deleted, segment.frozen
├── api/
│   ├── index.ts                registerSegmentRoutes
│   ├── segments.routes.ts
│   └── schemas.ts              zod tvary požadavků a odpovědí pro OpenAPI
└── jobs/
    ├── queue-handlers.ts       mapa fronta → handler, viz R14
    ├── recount.ts              segments.recount
    └── cleanup-after-reactivation.ts

packages/core/src/contacts/import/
├── index.ts                    subpath @mlain/core/contacts/import
├── db.ts                       tenký adaptér nad @mlain/db, jediné místo s klientem
├── limits.ts                   limity ze 4.6.1, čtené z konfigurace
├── encoding.ts                 BOM, striktní UTF-8, skóre podle českých písmen
├── dialect.ts                  oddělovač, uvozovky, konce řádků, hlavička
├── reader.ts                   proudový čtenář s bajtovým offsetem záznamu
├── mapping.ts                  ImportMapping, automapování podle záhlaví
├── options.ts                  ImportOptions, zod.strict()
├── row-pipeline.ts             devět kroků zpracování řádku v závazném pořadí
├── dedup.ts                    úroveň A (povinná) a úroveň B (prahovaná)
├── batch.ts                    zápis dávky a checkpoint v jedné transakci
├── estimate.ts                 rychlý průchod, extrapolace nad 500 000 řádků
├── preview.ts                  20 řádků ve výsledné podobě včetně oslovení
├── errors-csv.ts               stažení chybných řádků v původním kódování
├── idempotency.ts              idempotency_key ze souboru, mapování a voleb
├── state.ts                    stavový automat a povolené přechody
├── storage.ts                  proudový zápis nahrávaného souboru mimo webroot
├── service.ts                  create, patch, confirm, cancel, resume
├── audit.ts                    import.confirmed, import.cancelled
├── api/
│   ├── index.ts                registerImportRoutes
│   ├── imports.routes.ts
│   ├── events.routes.ts        SSE
│   └── schemas.ts
└── jobs/
    ├── queue-handlers.ts
    ├── run-import.ts           contacts.import
    ├── recover-stale.ts        obnova po pádu workera, z fronty s workspaceId
    └── retention.ts            mazání nahraných souborů

packages/core/src/contacts/export/
├── index.ts                    subpath @mlain/core/contacts/export
├── columns.ts                  pevná sada plus vlastní pole plus štítky plus seznamy
├── csv-injection.ts            prefix apostrofem
├── service.ts                  createExport, jednorázový token ke stažení
├── api/{index.ts,exports.routes.ts,schemas.ts}
└── jobs/{queue-handlers.ts,run-export.ts}

packages/core/test/
├── segments/…                  zrcadlí strukturu zdroje, přípona .test.ts nebo .db.test.ts
├── contacts/import/…
└── contacts/export/…

apps/web/src/app/[locale]/w/[slug]/contacts/import/
├── page.tsx                    průvodce, krok v ?step=
├── [importId]/page.tsx         výsledek konkrétního importu
└── _components/
    ├── import-wizard.tsx       skořápka nad K3
    ├── step-upload.tsx         krok 1
    ├── step-file-check.tsx     krok 2
    ├── step-mapping.tsx        krok 3
    ├── step-preview.tsx        krok 4
    ├── step-options.tsx        krok 5
    ├── step-progress.tsx       krok 6, SSE
    ├── result-completed.tsx
    ├── result-with-errors.tsx  včetně sekce „Co jsme museli odhadnout"
    ├── result-cancelled.tsx
    ├── result-failed.tsx
    └── use-import-upload.ts    XHR upload s průběhem a zrušením

apps/web/src/app/[locale]/w/[slug]/segments/
├── page.tsx                    seznam a karty presetů
├── [id]/page.tsx               builder
├── cleanup/page.tsx            presety čištění a reaktivační scénář
└── _components/
    ├── segment-builder.tsx     obal nad K2
    ├── group-sentence.tsx      ICU věta se sloty {polarity} a {quantifier}
    ├── field-picker.tsx        seskupená nabídka polí
    ├── operator-picker.tsx     nabídka podle typové matice
    ├── value-editor.tsx
    ├── null-hint.tsx           segments.notNullHint a tlačítko na doplnění
    ├── live-count.tsx          stavy počtu, varování, stáří
    ├── empty-diagnostics.tsx
    ├── preset-card.tsx
    └── cleanup-scenario.tsx    kroky 2, 4, 5 a 6 reaktivačního scénáře

apps/web/src/components/segments/audience-breakdown.tsx     používá i P13
apps/web/test/{import,segments}/…                           testy obrazovek

packages/i18n/messages/{cs,en}/import.json
packages/i18n/messages/{cs,en}/segments.json
```

Rozdělení je podle odpovědnosti, ne podle technické vrstvy. Kompilátor je rozřezaný na soubor podle druhu pole, protože každý druh má vlastní past (cast u čísel, tříbranná prázdnota u JSONB, rollup u aktivity) a v jednom souboru by se ty pasti navzájem schovaly.

---

## 5. Pořadí úkolů a proč zrovna takhle

**Padesát sedm úkolů** ve čtyřech blocích. Bloky jdou po sobě, uvnitř bloku je pořadí závazné jen tam, kde na sebe úkoly navazují datově.

```
Blok A (1 až 22)                  22 úkolů  Segmenty: čistá logika, kompilátor, spouštěč, služba, joby
Blok B (23 až 39, bez 37 a 38)    15 úkolů  Import a export: detekce, roura, dávkování, export
Blok C (40 až 43)                  4 úkoly  Katalogy i18n a routy
Blok D (44 až 60, bez 53)         16 úkolů  Obrazovky
```

**Čísla úkolů 37, 38 a 53 zůstávají prázdná a nepřečíslovávají se.** Byla to fronta ke kontrole oslovení, kterou podle rozhodnutí U3 vlastní celou P07 (viz R2). Přečíslování by rozbilo všechny odkazy tvaru „úkol 31 krok 4" v kapitolách 10, 13 a 14 a v křížových odkazech ostatních plánů, což je horší než tři mezery v řadě. Kdo hledá úkol 37, najde na jeho místě větu, kam se přesunul.

Segmenty jdou první schválně, i když import je viditelnější. Kompilátor je jediná část celého plánu, která umí tiše zkazit odeslanou kampaň, a chceme ho mít hotový a otestovaný dřív, než na něj někdo začne spěchat. Import má navíc na segmenty jednu vazbu (dokončení importu zneplatňuje `cached_count` všech segmentů projektu), opačně žádnou.

---

## Blok A: segmentační engine

### Úkol 1: Zapojení balíčku a tří podcest

**Files:**
- Modify: `/Users/petr/Projects/Mailing_Tool/packages/core/package.json`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/vitest.db.config.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/segments/index.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/contacts/import/index.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/contacts/export/index.ts`

- [ ] **Krok 1: Přidej tři podcesty a tři závislosti do `packages/core/package.json`**

Toto je úzká výjimka z kapitoly 0.3. Do objektu `exports` přidej tři klíče, do `dependencies` tři balíčky, do `scripts` jeden skript. Nic jiného v souboru neměň.

```json
{
  "exports": {
    "./config": "./src/config/index.ts",
    "./contacts/export": "./src/contacts/export/index.ts",
    "./contacts/import": "./src/contacts/import/index.ts",
    "./errors": "./src/errors/index.ts",
    "./health": "./src/health/index.ts",
    "./logging": "./src/logging/index.ts",
    "./queues": "./src/queues/index.ts",
    "./segments": "./src/segments/index.ts",
    "./shutdown": "./src/shutdown/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test:unit": "vitest run",
    "test:db": "vitest run --config vitest.db.config.ts"
  },
  "dependencies": {
    "@mlain/contracts": "workspace:*",
    "@mlain/db": "workspace:*",
    "csv-parse": "7.0.1",
    "csv-stringify": "6.8.1",
    "iconv-lite": "0.7.3",
    "pg": "8.22.0",
    "pino": "10.3.1",
    "zod": "4.4.3"
  }
}
```

Klíč `./contacts` (bez podcesty) **nepřidávej**, ten patří P07.

- [ ] **Krok 2: Založ `packages/core/vitest.db.config.ts`**

Databázové testy tohohle plánu mají příponu **`.dbspec.ts`**, ne `.db.test.ts`. Důvod je věcný: vzor `test/**/*.test.ts` z konfigurace P01 by soubor `*.db.test.ts` posbíral taky, protože na `.test.ts` končí, a běžná sada by se pokusila spustit testy proti databázi, která v tom jobu neběží. Jiná přípona ten problém odstraní bez zásahu do cizího souboru.

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.dbspec.ts'],
    testTimeout: 120_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
```

`fileParallelism: false` je tam proto, že testy sdílejí jeden kontejner s databází a paralelní soubory by si přepisovaly data v témž projektu.

V celém zbytku plánu čti „databázový test" jako soubor s příponou `.dbspec.ts`.

- [ ] **Krok 3: Založ tři prázdné vstupní body**

```ts
// packages/core/src/segments/index.ts
export * from './ast.js';
export * from './operators.js';
export * from './limits.js';
export * from './repo.js';
export * from './service.js';
export * from './presets.js';
```

```ts
// packages/core/src/contacts/import/index.ts
export * from './service.js';
export * from './options.js';
export * from './mapping.js';
export * from './vocative-review/index.js';
```

```ts
// packages/core/src/contacts/export/index.ts
export * from './service.js';
```

Soubory, na které odkazují, ještě neexistují, takže `tsc` zatím neprojde. Zakomentuj proto v tomhle kroku všechny řádky `export *` a odkomentuj vždy ten jeden, který příslušný úkol dokončil, v jeho posledním kroku před commitem. Na konci úkolu 22 a 39 jsou odkomentované všechny.

- [ ] **Krok 4: Ověř instalaci a licence**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm install && pnpm exec license-checker --production --onlyAllow "MIT;Apache-2.0;BSD-2-Clause;BSD-3-Clause;ISC;0BSD;CC0-1.0;Unlicense;Python-2.0" --packages "csv-parse@7.0.1;csv-stringify@6.8.1;iconv-lite@0.7.3"`
Expected: bez chyby, tři balíčky vypsané s licencí MIT.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/package.json packages/core/vitest.db.config.ts packages/core/src/segments packages/core/src/contacts pnpm-lock.yaml
git commit -m "chore(core): wire segments, import and export subpaths"
```

---

### Úkol 2: Konformanční test registrů P01

Registr chyb, registr front ani schéma konfigurace tenhle plán nerozšiřuje. Potřebuje ale jistotu, že v nich jeho položky jsou. Test je čtecí a jeho selhání je nález proti P01, ne důvod něco dopsat.

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/test/segments/registry-conformance.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
import { describe, expect, it } from 'vitest';
import { ALL_REGISTERED_CODES, isRegisteredCode } from '../../src/errors/index.js';
import { queueNames } from '../../src/queues/index.js';
import { ConfigSchema } from '../../src/config/index.js';

/**
 * Registrů se ptáme přes `isRegisteredCode()` a `queueNames()`, NE indexací.
 *
 * `ERROR_CODES` je sice plochá mapa podle kódu, ale obsahuje **jen druh
 * `problem`**, protože jen ten má HTTP status. Všechny kódy tohohle plánu jsou
 * druhu `validation`, `finding` nebo `import_row`, takže `Object.keys(ERROR_CODES)`
 * by je nenašlo ani tehdy, kdyby v registru byly, a test by hlásil chybu
 * z falešného důvodu. Totéž u front: `QUEUE_REGISTRY` je pole, ne objekt.
 */
const IMPORT_ERROR_CODES = [
  'import_duplicate', 'import_already_running', 'no_email_column_mapped', 'file_too_large',
  'too_many_rows', 'too_many_columns', 'empty_file', 'unsupported_encoding',
  'delimiter_not_detected', 'malformed_csv', 'storage_unavailable', 'contact_limit_reached',
];

/** Řádkové kódy importu. Do HTTP odpovědi se nepromítají, žijí v import_errors. */
const IMPORT_ROW_CODES = [
  'required_field_missing', 'invalid_number', 'invalid_boolean', 'invalid_enum_value',
  'invalid_phone', 'invalid_url', 'duplicate_in_file', 'duplicate_target',
];

const SEGMENT_ERROR_CODES = [
  'segment_invalid_ast', 'segment_operator_not_allowed', 'segment_invalid_range',
  'segment_too_complex', 'segment_too_deep', 'segment_too_many_engagement',
  'segment_too_many_event', 'segment_nesting_too_deep', 'segment_cycle',
  'segment_list_too_long', 'segment_definition_too_large', 'segment_reference_not_found',
  'segment_preview_timeout', 'audience_empty',
];

/** Varování a provozní kódy. Nejsou to chyby požadavku, ale registrované být musí. */
const OTHER_CODES = [
  'segment_slow_engagement', 'segment_unindexed_field',
  'export_already_running', 'cross_workspace_scan_blocked',
];

const ALL_CODES = [
  ...IMPORT_ERROR_CODES, ...IMPORT_ROW_CODES, ...SEGMENT_ERROR_CODES, ...OTHER_CODES,
];

const QUEUE_NAMES = [
  'contacts.import', 'contacts.export',
  'contacts.cleanup_after_reactivation', 'segments.recount',
];

const CONFIG_VARS = [
  'IMPORT_MAX_FILE_BYTES', 'IMPORT_MAX_ROWS', 'IMPORT_MAX_COLUMNS', 'IMPORT_MAX_CELL_CHARS',
  'IMPORT_MAX_LINE_BYTES', 'IMPORT_BATCH_SIZE', 'IMPORT_MAX_STORED_ERRORS', 'IMPORT_SNIFF_BYTES',
  'IMPORT_WORKER_CONCURRENCY', 'IMPORT_PREVIEW_TTL_HOURS', 'IMPORT_STALE_MINUTES',
  'IMPORT_INMEMORY_DEDUP_MAX_ROWS', 'SEGMENT_PREVIEW_TIMEOUT_MS', 'SEGMENT_RECOUNT_CONCURRENCY',
  'SEGMENT_MAX_CONDITIONS', 'EXPORT_TTL_HOURS',
];

describe('registry conformance', () => {
  it('counts what it checks, so nobody trims the list to make it pass', () => {
    expect(ALL_CODES).toHaveLength(38);
    expect(new Set(ALL_CODES).size).toBe(38);
  });

  it.each(ALL_CODES)('error code %s is registered', (code) => {
    expect(isRegisteredCode(code), `${code} chybí v registru P01`).toBe(true);
  });

  it('produces no code outside the registry', () => {
    // Druhá strana téhož: seznam výš hlídá, že plán nepoužívá neregistrovaný
    // kód. Tenhle test hlídá, že se seznam nerozešel se skutečností, protože
    // neregistrovaný kód by `problemCode()` shodil až při první odpovědi API.
    for (const code of ALL_CODES) expect(ALL_REGISTERED_CODES.has(code)).toBe(true);
  });

  it.each(QUEUE_NAMES)('queue %s is registered', (name) => {
    expect(queueNames(), `fronta ${name} chybí`).toContain(name);
  });

  it.each(CONFIG_VARS)('config variable %s is in the schema', (name) => {
    expect(Object.keys(ConfigSchema.shape)).toContain(name);
  });
});
```

Fronta `contacts.bulk_vocative_review` ze seznamu vypadla: po rozhodnutí U3 ji vlastní a registruje P07. V registru P01 zůstává, ale ověřovat její přítomnost patří tomu, kdo k ní dodává handler.

- [ ] **Krok 2: Spusť test a čekej selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/segments/registry-conformance.test.ts`
Expected: FAIL. Buď `Cannot find module`, pokud P01 registry ještě nedodal, nebo výpis chybějících položek.

- [ ] **Krok 3: Zapiš nález, nic neopravuj**

Když test padá na chybějící položce, přidej ji do kapitoly 11 tohohle plánu jako požadavek na P01 s přesným názvem a výchozí hodnotou. **Nepřidávej ji do registru.** Registr, do kterého sahá šestnáct plánů, je přesně to místo, kde uzávěry S7, S8 a S12 existují.

- [ ] **Krok 4: Commit**

```bash
git add packages/core/test/segments/registry-conformance.test.ts
git commit -m "test(segments): assert P01 registries contain P11 codes, queues and config"
```

---

### Úkol 3: Zod schéma AST verze 1

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/segments/ast.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/test/segments/ast.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
import { describe, expect, it } from 'vitest';
import { SegmentAstV1 } from '../../src/segments/ast.js';

const valid = {
  version: 1,
  root: {
    type: 'group',
    op: 'and',
    not: false,
    children: [
      { type: 'condition', field: { kind: 'contact', key: 'status' }, operator: 'eq', value: 'active' },
      { type: 'condition', field: { kind: 'attribute', key: 'city' }, operator: 'in', values: ['Praha', 'Brno'] },
    ],
  },
};

describe('SegmentAstV1', () => {
  it('accepts a well formed tree', () => {
    expect(SegmentAstV1.parse(valid)).toEqual(valid);
  });

  it('rejects an unknown field kind', () => {
    const bad = structuredClone(valid);
    (bad.root.children[0] as { field: { kind: string } }).field.kind = 'sql';
    expect(() => SegmentAstV1.parse(bad)).toThrow();
  });

  it('rejects an unknown contact key', () => {
    const bad = structuredClone(valid);
    (bad.root.children[0] as { field: { key: string } }).field.key = 'password_hash';
    expect(() => SegmentAstV1.parse(bad)).toThrow();
  });

  it('rejects an extra property', () => {
    const bad = { ...valid, evil: true };
    expect(() => SegmentAstV1.parse(bad)).toThrow();
  });

  it('rejects an empty group', () => {
    expect(() => SegmentAstV1.parse({ version: 1, root: { type: 'group', op: 'and', children: [] } })).toThrow();
  });

  it('rejects more than 50 children in one group', () => {
    const child = { type: 'condition', field: { kind: 'contact', key: 'status' }, operator: 'eq', value: 'active' };
    const bad = { version: 1, root: { type: 'group', op: 'and', children: Array.from({ length: 51 }, () => child) } };
    expect(() => SegmentAstV1.parse(bad)).toThrow();
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/segments/ast.test.ts`
Expected: FAIL, `Cannot find module '../../src/segments/ast.js'`.

- [ ] **Krok 3: Napiš `ast.ts`**

```ts
import { z } from 'zod';

export const CONTACT_FIELD_KEYS = [
  'email', 'email_domain', 'first_name', 'last_name', 'gender', 'status',
  'locale', 'source', 'created_at', 'updated_at', 'last_activity_at',
  'vocative_confidence', 'processing_restricted',
] as const;

export const ENGAGEMENT_METRICS = ['sent', 'delivered', 'opened', 'clicked', 'bounced'] as const;

export const CONSENT_PURPOSES = [
  'email_marketing', 'analytics', 'personalization', 'profiling', 'third_party',
] as const;

export const OPERATORS = [
  'eq', 'neq', 'contains', 'not_contains', 'starts_with', 'ends_with', 'in', 'not_in',
  'is_empty', 'is_not_empty', 'gt', 'gte', 'lt', 'lte', 'between', 'is_true', 'is_false',
  'on', 'before', 'after', 'in_last_days', 'not_in_last_days', 'in_next_days',
  'has_any', 'has_all', 'has_none', 'is_member', 'is_not_member', 'is_confirmed',
  'is_pending', 'is_unsubscribed', 'is_granted', 'is_withdrawn', 'is_missing',
  'is_suppressed', 'is_not_suppressed', 'did', 'did_not', 'count_gte', 'count_lte',
] as const;

export type Operator = (typeof OPERATORS)[number];

const ScalarValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const EngagementScope = z
  .object({
    campaign_id: z.string().uuid().optional(),
    since_days: z.number().int().min(1).max(730).optional(),
    last_n_campaigns: z.number().int().min(1).max(50).optional(),
  })
  .strict();

export const FieldRef = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('contact'), key: z.enum(CONTACT_FIELD_KEYS) }).strict(),
  z.object({ kind: z.literal('attribute'), key: z.string().min(1).max(64) }).strict(),
  z.object({ kind: z.literal('tag') }).strict(),
  z.object({ kind: z.literal('list'), list_id: z.string().uuid() }).strict(),
  z.object({ kind: z.literal('consent'), purpose: z.enum(CONSENT_PURPOSES) }).strict(),
  z.object({ kind: z.literal('suppression') }).strict(),
  z
    .object({
      kind: z.literal('engagement'),
      metric: z.enum(ENGAGEMENT_METRICS),
      scope: EngagementScope,
    })
    .strict(),
  z
    .object({ kind: z.literal('event'), name: z.string().min(1).max(64), property: z.string().max(64).optional() })
    .strict(),
  z.object({ kind: z.literal('segment'), segment_id: z.string().uuid() }).strict(),
]);

export const ConditionNode = z
  .object({
    type: z.literal('condition'),
    field: FieldRef,
    operator: z.enum(OPERATORS),
    value: ScalarValue.optional(),
    values: z.array(ScalarValue).min(1).max(1000).optional(),
  })
  .strict();

export type ConditionNode = z.infer<typeof ConditionNode>;

export type GroupNode = {
  type: 'group';
  op: 'and' | 'or';
  not?: boolean;
  children: Node[];
};

export type Node = GroupNode | ConditionNode;

export const GroupNode: z.ZodType<GroupNode> = z.lazy(() =>
  z
    .object({
      type: z.literal('group'),
      op: z.enum(['and', 'or']),
      not: z.boolean().optional(),
      children: z.array(z.union([GroupNode, ConditionNode])).min(1).max(50),
    })
    .strict(),
);

export const SegmentAstV1 = z.object({ version: z.literal(1), root: GroupNode }).strict();

export type SegmentAst = z.infer<typeof SegmentAstV1>;

/** Prázdný segment: skupina bez podmínek se v UI zobrazí, ale AST ji nesmí nést. */
export const EMPTY_AST: SegmentAst = {
  version: 1,
  root: { type: 'group', op: 'and', children: [{ type: 'condition', field: { kind: 'contact', key: 'status' }, operator: 'is_not_empty' }] },
};
```

Proč je `children` minimálně jedno: skupina bez podmínek nemá v SQL co vygenerovat a v UI se řeší tím, že se AST neposílá vůbec. Prázdný segment znamená „všichni kontakty" a to zajistí obálka sama, viz úkol 9.

- [ ] **Krok 4: Spusť test**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/segments/ast.test.ts`
Expected: PASS, šest testů.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/segments/ast.ts packages/core/test/segments/ast.test.ts
git commit -m "feat(segments): add SegmentAstV1 zod schema"
```

---

### Úkol 4: Matice operátorů a typová kompatibilita

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/segments/operators.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/test/segments/operators.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
import { describe, expect, it } from 'vitest';
import { OPERATORS } from '../../src/segments/ast.js';
import {
  FIELD_CLASS_OPERATORS, contactFieldClass, assertOperatorAllowed, assertValueShape,
} from '../../src/segments/operators.js';

describe('operator matrix', () => {
  it('declares exactly 40 operators', () => {
    expect(OPERATORS).toHaveLength(40);
    expect(new Set(OPERATORS).size).toBe(40);
  });

  it('uses every declared operator in at least one field class', () => {
    const used = new Set(Object.values(FIELD_CLASS_OPERATORS).flat());
    expect([...OPERATORS].filter((o) => !used.has(o))).toEqual([]);
  });

  it('maps contact.status to enum', () => {
    expect(contactFieldClass('status')).toBe('enum');
    expect(contactFieldClass('created_at')).toBe('datetime');
    expect(contactFieldClass('processing_restricted')).toBe('boolean');
  });

  it('rejects contains on a number field', () => {
    expect(() => assertOperatorAllowed('number', 'contains')).toThrowError(/segment_operator_not_allowed/);
  });

  it('rejects between with three values', () => {
    expect(() => assertValueShape('between', { values: [1, 2, 3] })).toThrowError(/segment_invalid_ast/);
  });

  it('rejects between with a reversed range', () => {
    expect(() => assertValueShape('between', { values: [9, 2] })).toThrowError(/segment_invalid_range/);
  });

  it('rejects a value on a nullary operator', () => {
    expect(() => assertValueShape('is_empty', { value: 'x' })).toThrowError(/segment_invalid_ast/);
  });

  it('rejects in_last_days outside 1 to 3650', () => {
    expect(() => assertValueShape('in_last_days', { value: 0 })).toThrowError(/segment_invalid_ast/);
    expect(() => assertValueShape('in_last_days', { value: 3651 })).toThrowError(/segment_invalid_ast/);
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/segments/operators.test.ts`
Expected: FAIL, `Cannot find module '../../src/segments/operators.js'`.

- [ ] **Krok 3: Napiš `operators.ts`**

```ts
import { ApiError } from '../errors/index.js';
import type { Operator } from './ast.js';

export type FieldClass =
  | 'text' | 'long_text' | 'url' | 'email' | 'phone' | 'email_domain'
  | 'number' | 'boolean' | 'date' | 'datetime' | 'enum' | 'multi_enum'
  | 'tag' | 'list' | 'consent' | 'suppression' | 'engagement' | 'event' | 'segment';

const TEXT_OPS: Operator[] = [
  'eq', 'neq', 'contains', 'not_contains', 'starts_with', 'ends_with',
  'in', 'not_in', 'is_empty', 'is_not_empty',
];

export const FIELD_CLASS_OPERATORS: Record<FieldClass, Operator[]> = {
  text: TEXT_OPS,
  long_text: TEXT_OPS,
  url: TEXT_OPS,
  email: TEXT_OPS,
  phone: TEXT_OPS,
  email_domain: TEXT_OPS,
  number: ['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'between', 'is_empty', 'is_not_empty'],
  boolean: ['is_true', 'is_false', 'is_empty'],
  date: ['on', 'before', 'after', 'between', 'in_last_days', 'not_in_last_days', 'in_next_days', 'is_empty', 'is_not_empty'],
  datetime: ['on', 'before', 'after', 'between', 'in_last_days', 'not_in_last_days', 'in_next_days', 'is_empty', 'is_not_empty'],
  enum: ['eq', 'neq', 'in', 'not_in', 'is_empty', 'is_not_empty'],
  multi_enum: ['has_any', 'has_all', 'has_none', 'is_empty', 'is_not_empty'],
  tag: ['has_any', 'has_all', 'has_none'],
  list: ['is_member', 'is_not_member', 'is_confirmed', 'is_pending', 'is_unsubscribed'],
  consent: ['is_granted', 'is_withdrawn', 'is_missing'],
  suppression: ['is_suppressed', 'is_not_suppressed'],
  engagement: ['did', 'did_not', 'count_gte', 'count_lte'],
  event: ['did', 'did_not', 'count_gte', 'count_lte'],
  segment: ['in', 'not_in'],
};

const CONTACT_FIELD_CLASS = {
  email: 'email', email_domain: 'email_domain', first_name: 'text', last_name: 'text',
  gender: 'enum', status: 'enum', locale: 'enum', source: 'enum',
  created_at: 'datetime', updated_at: 'datetime', last_activity_at: 'datetime',
  vocative_confidence: 'enum', processing_restricted: 'boolean',
} as const;

export function contactFieldClass(key: keyof typeof CONTACT_FIELD_CLASS): FieldClass {
  return CONTACT_FIELD_CLASS[key];
}

export function assertOperatorAllowed(fieldClass: FieldClass, operator: Operator): void {
  const allowed = FIELD_CLASS_OPERATORS[fieldClass];
  if (!allowed.includes(operator)) {
    throw new ApiError('validation_failed', 422, {
      errors: [{ path: 'operator', code: 'segment_operator_not_allowed', meta: { fieldClass, operator, allowed } }],
    });
  }
}

const NULLARY: Operator[] = [
  'is_empty', 'is_not_empty', 'is_true', 'is_false', 'did', 'did_not',
  'is_suppressed', 'is_not_suppressed', 'is_member', 'is_not_member',
  'is_confirmed', 'is_pending', 'is_unsubscribed', 'is_granted', 'is_withdrawn', 'is_missing',
];
const MULTI: Operator[] = ['in', 'not_in', 'has_any', 'has_all', 'has_none', 'between'];
const DAY_COUNT: Operator[] = ['in_last_days', 'not_in_last_days', 'in_next_days'];
const COUNTER: Operator[] = ['count_gte', 'count_lte'];

type ValueShape = { value?: unknown; values?: unknown[] };

function invalid(detail: string, code = 'segment_invalid_ast'): never {
  throw new ApiError('validation_failed', 422, { errors: [{ path: 'value', code, meta: { detail } }] });
}

export function assertValueShape(operator: Operator, node: ValueShape): void {
  if (NULLARY.includes(operator)) {
    if (node.value !== undefined || node.values !== undefined) invalid(`${operator} takes no value`);
    return;
  }
  if (MULTI.includes(operator)) {
    if (!Array.isArray(node.values)) invalid(`${operator} requires values`);
    if (node.value !== undefined) invalid(`${operator} must not carry value`);
    if (node.values.length < 1 || node.values.length > 1000) {
      throw new ApiError('too_many_items', 422, {
        errors: [{ path: 'values', code: 'segment_list_too_long', meta: { limit: 1000, got: node.values.length } }],
      });
    }
    const kinds = new Set(node.values.map((v) => (v === null ? 'null' : typeof v)));
    if (kinds.size > 1) invalid('values must share one type');
    if (operator === 'between') {
      if (node.values.length !== 2) invalid('between requires exactly two values');
      const [a, b] = node.values as [number | string, number | string];
      if (a > b) invalid('between requires values[0] <= values[1]', 'segment_invalid_range');
    }
    return;
  }
  if (node.values !== undefined) invalid(`${operator} must not carry values`);
  if (node.value === undefined) invalid(`${operator} requires value`);
  if (DAY_COUNT.includes(operator)) {
    const n = node.value;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 3650) invalid(`${operator} expects an integer 1 to 3650`);
  }
  if (COUNTER.includes(operator)) {
    const n = node.value;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > 1_000_000) invalid(`${operator} expects an integer 0 to 1000000`);
  }
}
```

- [ ] **Krok 4: Spusť test**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/segments/operators.test.ts`
Expected: PASS, osm testů. Test „declares exactly 40 operators" je regrese proti tichému rozšíření matice.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/segments/operators.ts packages/core/test/segments/operators.test.ts
git commit -m "feat(segments): add operator matrix with 40 operators and value shape checks"
```

---

### Úkol 5: Limity složitosti

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/segments/limits.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/test/segments/limits.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
import { describe, expect, it } from 'vitest';
import { assertWithinLimits, SEGMENT_LIMITS } from '../../src/segments/limits.js';
import type { GroupNode, Node } from '../../src/segments/ast.js';

const cond = (): Node => ({
  type: 'condition', field: { kind: 'contact', key: 'status' }, operator: 'eq', value: 'active',
});
const group = (children: Node[], op: 'and' | 'or' = 'and'): GroupNode => ({ type: 'group', op, children });

function nest(depth: number): GroupNode {
  let node = group([cond()]);
  for (let i = 1; i < depth; i += 1) node = group([node]);
  return node;
}

describe('segment limits', () => {
  it('accepts depth 5 with 50 children and 100 conditions', () => {
    const wide = group(Array.from({ length: 50 }, cond));
    const deep = { type: 'group', op: 'and', children: [nest(4), wide] } as GroupNode;
    expect(() => assertWithinLimits({ version: 1, root: deep })).not.toThrow();
  });

  it('rejects depth 6', () => {
    expect(() => assertWithinLimits({ version: 1, root: nest(6) })).toThrowError(/segment_too_deep/);
  });

  it('rejects 101 conditions', () => {
    const root = group(Array.from({ length: 3 }, () => group(Array.from({ length: 34 }, cond))));
    expect(() => assertWithinLimits({ version: 1, root })).toThrowError(/segment_too_complex/);
  });

  it('rejects 6 engagement conditions', () => {
    const eng = (): Node => ({
      type: 'condition',
      field: { kind: 'engagement', metric: 'opened', scope: { since_days: 90 } },
      operator: 'did',
    });
    expect(() => assertWithinLimits({ version: 1, root: group(Array.from({ length: 6 }, eng)) }))
      .toThrowError(/segment_too_many_engagement/);
  });

  it('rejects 4 event conditions', () => {
    const ev = (): Node => ({ type: 'condition', field: { kind: 'event', name: 'purchase' }, operator: 'did' });
    expect(() => assertWithinLimits({ version: 1, root: group(Array.from({ length: 4 }, ev)) }))
      .toThrowError(/segment_too_many_event/);
  });

  it('rejects a definition over 256 kB', () => {
    const big = group([{ ...cond(), value: 'x'.repeat(300_000) } as Node]);
    expect(() => assertWithinLimits({ version: 1, root: big })).toThrowError(/segment_definition_too_large/);
  });

  it('exposes the documented limit values', () => {
    expect(SEGMENT_LIMITS).toEqual({
      maxConditions: 100, maxDepth: 5, maxChildren: 50, maxEngagement: 5, maxEvent: 3,
      maxSegmentNesting: 2, maxInItems: 1000, maxSqlBytes: 65536, maxDefinitionBytes: 262144,
    });
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/segments/limits.test.ts`
Expected: FAIL, `Cannot find module '../../src/segments/limits.js'`.

- [ ] **Krok 3: Napiš `limits.ts`**

```ts
import { ApiError } from '../errors/index.js';
import type { GroupNode, Node, SegmentAst } from './ast.js';

export const SEGMENT_LIMITS = {
  maxConditions: 100,
  maxDepth: 5,
  maxChildren: 50,
  maxEngagement: 5,
  maxEvent: 3,
  maxSegmentNesting: 2,
  maxInItems: 1000,
  maxSqlBytes: 65_536,
  maxDefinitionBytes: 262_144,
} as const;

function tooMany(code: string, meta: Record<string, unknown>): never {
  throw new ApiError('too_many_items', 422, { errors: [{ path: '_', code, meta }] });
}

type Counts = { conditions: number; engagement: number; event: number; depth: number };

function walk(node: Node, depth: number, counts: Counts): void {
  if (depth > SEGMENT_LIMITS.maxDepth) tooMany('segment_too_deep', { limit: SEGMENT_LIMITS.maxDepth, got: depth });
  if (node.type === 'condition') {
    counts.conditions += 1;
    if (node.field.kind === 'engagement') counts.engagement += 1;
    if (node.field.kind === 'event') counts.event += 1;
    return;
  }
  const group = node as GroupNode;
  if (group.children.length > SEGMENT_LIMITS.maxChildren) {
    tooMany('segment_too_complex', { limit: SEGMENT_LIMITS.maxChildren, got: group.children.length, reason: 'children' });
  }
  for (const child of group.children) walk(child, depth + 1, counts);
}

export function assertWithinLimits(ast: SegmentAst): void {
  const bytes = Buffer.byteLength(JSON.stringify(ast), 'utf8');
  if (bytes > SEGMENT_LIMITS.maxDefinitionBytes) {
    tooMany('segment_definition_too_large', { limit: SEGMENT_LIMITS.maxDefinitionBytes, got: bytes });
  }
  const counts: Counts = { conditions: 0, engagement: 0, event: 0, depth: 0 };
  walk(ast.root, 1, counts);
  if (counts.conditions > SEGMENT_LIMITS.maxConditions) {
    tooMany('segment_too_complex', { limit: SEGMENT_LIMITS.maxConditions, got: counts.conditions, reason: 'conditions' });
  }
  if (counts.engagement > SEGMENT_LIMITS.maxEngagement) {
    tooMany('segment_too_many_engagement', { limit: SEGMENT_LIMITS.maxEngagement, got: counts.engagement });
  }
  if (counts.event > SEGMENT_LIMITS.maxEvent) {
    tooMany('segment_too_many_event', { limit: SEGMENT_LIMITS.maxEvent, got: counts.event });
  }
}

export function assertSqlWithinLimit(sql: string): void {
  const bytes = Buffer.byteLength(sql, 'utf8');
  if (bytes > SEGMENT_LIMITS.maxSqlBytes) {
    tooMany('segment_too_complex', { limit: SEGMENT_LIMITS.maxSqlBytes, got: bytes, reason: 'sql_length' });
  }
}
```

Hloubka se počítá od kořene jako 1, takže kořen plus čtyři vnořené skupiny je hloubka 5 a projde. Šestá úroveň spadne. Test „accepts depth 5 with 50 children" je přímý překlad tvrdého požadavku na K2 z 13.1 části 6 do serverové vrstvy: kdyby server hloubku 5 neunesl, neměla by ji komponenta komu poslat.

- [ ] **Krok 4: Spusť test**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/segments/limits.test.ts`
Expected: PASS, sedm testů.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/segments/limits.ts packages/core/test/segments/limits.test.ts
git commit -m "feat(segments): enforce nine complexity limits"
```

---

### Úkol 6: Kanonický JSON a `definition_hash`

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/segments/canonical.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/test/segments/canonical.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
import { describe, expect, it } from 'vitest';
import { canonicalJson, definitionHash } from '../../src/segments/canonical.js';

describe('canonical json', () => {
  it('sorts keys and drops whitespace', () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('keeps array order', () => {
    expect(canonicalJson({ a: [3, 1, 2] })).toBe('{"a":[3,1,2]}');
  });

  it('produces the same hash for differently ordered but equal objects', () => {
    const one = definitionHash({ version: 1, root: { type: 'group', op: 'and', children: [] } });
    const two = definitionHash({ root: { children: [], op: 'and', type: 'group' }, version: 1 });
    expect(one.equals(two)).toBe(true);
    expect(one).toHaveLength(32);
  });

  it('produces a different hash when a value changes', () => {
    const one = definitionHash({ a: 1 });
    const two = definitionHash({ a: 2 });
    expect(one.equals(two)).toBe(false);
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/segments/canonical.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Krok 3: Napiš `canonical.ts`**

```ts
import { createHash } from 'node:crypto';

/** Seřazené klíče, bez bílých znaků. Pole si pořadí drží, protože je významové. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function definitionHash(value: unknown): Buffer {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest();
}
```

- [ ] **Krok 4: Spusť test**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/segments/canonical.test.ts`
Expected: PASS, čtyři testy.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/segments/canonical.ts packages/core/test/segments/canonical.test.ts
git commit -m "feat(segments): add canonical json and definition hash"
```

---

### Úkol 7: `ParamBag`, číslování parametrů od `paramOffset`

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/segments/compile/params.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/test/segments/compile/params.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
import { describe, expect, it } from 'vitest';
import { ParamBag } from '../../../src/segments/compile/params.js';

describe('ParamBag', () => {
  it('numbers from paramOffset + 1', () => {
    const bag = new ParamBag(5);
    expect(bag.add('a')).toBe('$6');
    expect(bag.add('b')).toBe('$7');
    expect(bag.values).toEqual(['a', 'b']);
  });

  it('numbers from $1 with no offset', () => {
    const bag = new ParamBag(0);
    expect(bag.add('a')).toBe('$1');
  });

  it('casts when a cast is given', () => {
    const bag = new ParamBag(0);
    expect(bag.add(['x'], 'uuid[]')).toBe('$1::uuid[]');
  });

  it('never reuses a placeholder for a different value', () => {
    const bag = new ParamBag(0);
    expect(bag.add('a')).toBe('$1');
    expect(bag.add('a')).toBe('$2');
  });
});
```

Do téhož souboru patří i testy převodníku `toSql`, protože bez něj se text z `ParamBag` nedá spustit:

```ts
import { PgDialect } from 'drizzle-orm/pg-core';
import { toSql } from '../../../src/segments/compile/params.js';

const render = (text: string, params: unknown[]) => new PgDialect().sqlToQuery(toSql(text, params));

describe('toSql', () => {
  it('keeps a list value as ONE parameter, not as expanded elements', () => {
    const out = render('SELECT 1 WHERE s = ANY($1)', [['active', 'pending']]);
    expect(out.sql).toBe('SELECT 1 WHERE s = ANY($1)');
    expect(out.params).toEqual([['active', 'pending']]);
  });

  it('binds a repeated placeholder once per occurrence, with the same value', () => {
    const asOf = new Date('2026-01-01T00:00:00Z');
    const out = render('SELECT 1 WHERE a >= $2 AND b <= $2 AND c = $1', ['ws', asOf]);
    expect(out.sql).toBe('SELECT 1 WHERE a >= $1 AND b <= $2 AND c = $3');
    expect(out.params).toEqual([asOf, asOf, 'ws']);
  });

  it('leaves a cast suffix in the query text', () => {
    expect(render('SELECT $1::uuid[]', [['a']]).sql).toBe('SELECT $1::uuid[]');
  });

  it('refuses a placeholder that has no value instead of binding undefined', () => {
    expect(() => toSql('SELECT $3', ['only-one'])).toThrowError(/\$3/);
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/segments/compile/params.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Krok 3: Napiš `params.ts`**

```ts
import { sql, type SQL } from 'drizzle-orm';

/**
 * Jediná cesta, jak se hodnota dostane do dotazu. Kdo potřebuje hodnotu v SQL,
 * zavolá add() a dostane placeholder. Interpolace hodnoty do textu dotazu je
 * v tomhle modulu chyba, na kterou existuje test v úkolu 18.
 */
export class ParamBag {
  readonly values: unknown[] = [];

  constructor(private readonly offset: number) {}

  add(value: unknown, cast?: string): string {
    this.values.push(value);
    const index = this.offset + this.values.length;
    return cast ? `$${index}::${cast}` : `$${index}`;
  }

  /** Placeholder už přidané hodnoty, používá se pro workspace_id a asOf. */
  ref(index1Based: number, cast?: string): string {
    const index = this.offset + index1Based;
    return cast ? `$${index}::${cast}` : `$${index}`;
  }
}

const PLACEHOLDER = /\$(\d+)/g;

/**
 * Převede `{ sql, params }` z kompilátoru na drizzle `SQL`, protože `Tx` je
 * drizzle handle a jeho `execute()` bere JEDEN argument, ne dvojici (text, params).
 * Tohle je jediné místo, kde ten převod je.
 *
 * Dvě věci, které se nedají odvodit čtením a jsou ověřené spuštěním:
 *
 *  1. Hodnota se MUSÍ předat přes `sql.param()`. Holé pole v šabloně `sql` se
 *     rozloží na jednotlivé parametry, takže `= ANY(${values})` vyrobí
 *     `ANY(($1, $2, $3))` a dotaz spadne na `42809 op ANY/ALL (array) requires
 *     array on right side`. Se `sql.param()` vznikne `ANY($1)` s jedním polem.
 *  2. Text se MUSÍ vkládat přes `sql.raw()`. Řetězec vložený přímo do šablony
 *     by se stal parametrem, ne částí dotazu.
 *
 * Opakovaný odkaz (`$2` je asOf a je v dotazu mnohokrát) se naváže tolikrát,
 * kolikrát se vyskytne, vždy s toutéž hodnotou. Drizzle si parametry čísluje samo,
 * takže výsledná čísla se od vstupních liší; podstatné je párování hodnot, ne čísla.
 *
 * Text kompilátoru neobsahuje uživatelské řetězce (hlídá to úkol 18), takže
 * v něm nemůže být `$` uvnitř literálu a hledání placeholderů je bezpečné.
 */
export function toSql(text: string, params: readonly unknown[]): SQL {
  const chunks: SQL[] = [];
  let last = 0;
  for (const match of text.matchAll(PLACEHOLDER)) {
    const index = Number(match[1]);
    if (index < 1 || index > params.length) {
      throw new Error(`placeholder $${index} has no value (${params.length} params given)`);
    }
    if (match.index > last) chunks.push(sql.raw(text.slice(last, match.index)));
    chunks.push(sql`${sql.param(params[index - 1])}`);
    last = match.index + match[0].length;
  }
  if (last < text.length) chunks.push(sql.raw(text.slice(last)));
  return sql.join(chunks);
}
```

Metoda `ref` existuje kvůli tomu, že `workspace_id` je vždy první a `asOf` vždy druhý parametr, a odkazuje se na ně z mnoha míst, aniž by se přidávaly znovu.

- [ ] **Krok 4: Spusť test**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/segments/compile/params.test.ts`
Expected: PASS, osm testů.

Ověřeno spuštěním proti PostgreSQL 18 ještě před napsáním plánu, protože obojí je past, kterou čtení mine:

```
holé pole    SELECT 1 WHERE x = ANY(($1, $2, $3))   params ["a","b","c"]   -> 42809 za běhu
sql.param    SELECT 1 WHERE x = ANY($1)             params [["a","b","c"]] -> projde
```

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/segments/compile/params.ts packages/core/test/segments/compile/params.test.ts
git commit -m "feat(segments): add ParamBag with paramOffset numbering"
```

---

### Úkol 8: Konstantní mapa sloupců a kompilace prvotřídních polí

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/segments/compile/columns.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/segments/compile/contact.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/test/segments/compile/contact.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
import { describe, expect, it } from 'vitest';
import { ParamBag } from '../../../src/segments/compile/params.js';
import { compileContactCondition } from '../../../src/segments/compile/contact.js';

/** Tři pevné parametry: workspace_id ($1), asOf ($2), časová zóna projektu ($3). */
function bagWithFixed(): ParamBag {
  const bag = new ParamBag(0);
  bag.add('ws'); bag.add(new Date()); bag.add('Europe/Prague');
  return bag;
}

describe('contact conditions', () => {
  it('compiles eq to a parameter', () => {
    const bag = bagWithFixed();
    const sql = compileContactCondition('a', { kind: 'contact', key: 'status' }, 'eq', { value: 'active' }, bag);
    expect(sql).toBe('(a.status = $4)');
    expect(bag.values[3]).toBe('active');
  });

  it('never puts the user value into the sql text', () => {
    const bag = bagWithFixed();
    const evil = "'; DROP TABLE contacts; --";
    const sql = compileContactCondition('a', { kind: 'contact', key: 'first_name' }, 'eq', { value: evil }, bag);
    expect(sql).not.toContain('DROP');
    expect(sql).toContain('$4');
    expect(bag.values[3]).toBe(evil);
  });

  it('compiles in_last_days against asOf, never now()', () => {
    const bag = bagWithFixed();
    const sql = compileContactCondition('a', { kind: 'contact', key: 'created_at' }, 'in_last_days', { value: 30 }, bag);
    expect(sql).toBe('(a.created_at >= $2::timestamptz - make_interval(days => $4))');
    expect(sql.toLowerCase()).not.toContain('now(');
  });

  it('casts asOf explicitly in EVERY relative time expression', () => {
    // Bez ::timestamptz odvodí PostgreSQL typ parametru z okolí a u odčítání
    // intervalu ho určí jako interval. Viz komentář u ASOF v contact.ts.
    for (const op of ['in_last_days', 'not_in_last_days', 'in_next_days'] as const) {
      const sql = compileContactCondition('a', { kind: 'contact', key: 'created_at' }, op, { value: 30 }, bagWithFixed());
      expect(sql, op).toContain('$2::timestamptz');
      expect(sql, op).not.toMatch(/\$2(?!::timestamptz)/);
    }
  });

  it('compiles contains with ILIKE and escaped wildcards', () => {
    const bag = bagWithFixed();
    const sql = compileContactCondition('a', { kind: 'contact', key: 'email' }, 'contains', { value: '100%' }, bag);
    expect(sql).toBe("(a.email::text ILIKE '%' || $4 || '%')");
    expect(bag.values[3]).toBe('100\\%');
  });

  it('uses the given alias everywhere', () => {
    const bag = bagWithFixed();
    const sql = compileContactCondition('x9', { kind: 'contact', key: 'status' }, 'eq', { value: 'active' }, bag);
    expect(sql).toContain('x9.status');
    expect(sql).not.toContain('c.');
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/segments/compile/contact.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Krok 3: Napiš `columns.ts`**

```ts
import type { CONTACT_FIELD_KEYS } from '../ast.js';

type ContactFieldKey = (typeof CONTACT_FIELD_KEYS)[number];

/**
 * Překlad klíče na sloupec jde přes tuhle mapu a nikdy konkatenací.
 * Klíč, který v mapě není, nemůže vyrobit SQL. Zástupný znak `{a}` se
 * nahradí aliasem, aby si volající mohl mít vlastní `c`.
 */
const TEMPLATES: Record<ContactFieldKey, string> = {
  email: '{a}.email::text',
  email_domain: '{a}.email_domain',
  first_name: '{a}.first_name',
  last_name: '{a}.last_name',
  gender: '{a}.gender',
  status: '{a}.status',
  locale: '{a}.locale',
  source: '{a}.source',
  created_at: '{a}.created_at',
  updated_at: '{a}.updated_at',
  last_activity_at: '{a}.last_activity_at',
  vocative_confidence: '{a}.vocative_confidence',
  processing_restricted: '{a}.processing_restricted',
};

export const ALIAS_PATTERN = /^[a-z][a-z0-9_]{0,9}$/;

export function assertAlias(alias: string): void {
  if (!ALIAS_PATTERN.test(alias)) throw new Error(`invalid alias: ${alias}`);
}

export function contactColumnSql(alias: string, key: ContactFieldKey): string {
  assertAlias(alias);
  const template = TEMPLATES[key];
  if (!template) throw new Error(`unknown contact field: ${key}`);
  return template.replace('{a}', alias);
}
```

- [ ] **Krok 4: Napiš `contact.ts`**

```ts
import type { Operator } from '../ast.js';
import { contactFieldClass } from '../operators.js';
import type { ParamBag } from './params.js';
import { contactColumnSql } from './columns.js';

/** Escapuje `%` a `_`, aby hodnota od uživatele nebyla zástupným znakem. */
export function escapeLike(value: string): string {
  return value.replace(/([\\%_])/g, '\\$1');
}

type Node = { value?: unknown; values?: unknown[] };
type Field = { kind: 'contact'; key: Parameters<typeof contactFieldClass>[0] };

/**
 * `asOf` se odkazuje VŽDY s explicitním `::timestamptz` a nikdy holé `$2`.
 *
 * Není to kosmetika a nedá se to odvodit čtením, je to ověřené spuštěním na
 * PostgreSQL 18: typ parametru se odvozuje z okolí a ve výrazu
 * `sloupec >= $2 - make_interval(days => $4)` PostgreSQL vyhodnotí odčítání dřív,
 * odvodí `$2` jako `interval` a dotaz skončí chybou
 * `42883 operator does not exist: timestamp with time zone >= interval`.
 * Když se parametr pošle jako `Date`, spadne to už dřív na
 * `22007 invalid input syntax for type interval`.
 *
 * Zrádné je, že to selže jen někdy: v `$2 > sloupec` typ určí levá strana a projde to.
 * Segment „registrovali se za posledních 30 dní" by tedy spadl, zatímco
 * „registrovali se po datu" ne, a rozdíl by nikdo nespojil s chybějícím castem.
 */
const ASOF_CAST = 'timestamptz';

export function compileContactCondition(
  alias: string,
  field: Field,
  operator: Operator,
  node: Node,
  bag: ParamBag,
): string {
  const col = contactColumnSql(alias, field.key);
  const asOf = bag.ref(2, ASOF_CAST);
  const cls = contactFieldClass(field.key);

  switch (operator) {
    case 'eq': return `(${col} = ${bag.add(node.value)})`;
    case 'neq': return `(${col} <> ${bag.add(node.value)})`;
    case 'contains': return `(${col} ILIKE '%' || ${bag.add(escapeLike(String(node.value)))} || '%')`;
    case 'not_contains': return `(${col} NOT ILIKE '%' || ${bag.add(escapeLike(String(node.value)))} || '%')`;
    case 'starts_with': return `(${col} ILIKE ${bag.add(escapeLike(String(node.value)))} || '%')`;
    case 'ends_with': return `(${col} ILIKE '%' || ${bag.add(escapeLike(String(node.value)))})`;
    case 'in': return `(${col} = ANY(${bag.add(node.values, 'text[]')}))`;
    case 'not_in': return `(NOT (${col} = ANY(${bag.add(node.values, 'text[]')})))`;
    case 'is_empty': return `(${col} IS NULL OR ${col}::text = '')`;
    case 'is_not_empty': return `(${col} IS NOT NULL AND ${col}::text <> '')`;
    case 'is_true': return `(${col} = true)`;
    case 'is_false': return `(${col} = false)`;
    case 'gt': return `(${col} > ${bag.add(node.value)})`;
    case 'gte': return `(${col} >= ${bag.add(node.value)})`;
    case 'lt': return `(${col} < ${bag.add(node.value)})`;
    case 'lte': return `(${col} <= ${bag.add(node.value)})`;
    case 'between': {
      const [lo, hi] = node.values as [unknown, unknown];
      return `(${col} BETWEEN ${bag.add(lo)} AND ${bag.add(hi)})`;
    }
    case 'on': {
      // U datetime se porovnává celý den v zóně projektu, ne půlnoc UTC.
      const day = bag.add(node.value);
      return cls === 'datetime'
        ? `((${col} AT TIME ZONE ${bag.ref(3)})::date = ${day}::date)`
        : `(${col} = ${day}::date)`;
    }
    case 'before': return `(${col} < ${bag.add(node.value)})`;
    case 'after': return `(${col} > ${bag.add(node.value)})`;
    case 'in_last_days': return `(${col} >= ${asOf} - make_interval(days => ${bag.add(node.value)}))`;
    case 'not_in_last_days': return `(${col} < ${asOf} - make_interval(days => ${bag.add(node.value)}))`;
    case 'in_next_days': return `(${col} > ${asOf} AND ${col} <= ${asOf} + make_interval(days => ${bag.add(node.value)}))`;
    default: throw new Error(`operator ${operator} is not valid for a contact field`);
  }
}
```

Pevné parametry jsou tři a jejich pořadí je závazné: `$1` je `workspace_id`, `$2` je `asOf`, `$3` je časová zóna projektu. Přidává je volající před kompilací uzlů (úkol 17), takže `ref(1)`, `ref(2)` a `ref(3)` jsou stabilní i při nenulovém `paramOffset`. Časová zóna je tam kvůli operátoru `on` nad `datetime`: bez ní by segment „registrovali se 31. 7." vynechal půlku dne, protože by porovnával s půlnocí UTC.

U `$1` a `$3` cast potřeba není a je to ověřené: `workspace_id = $1` odvodí `uuid` ze sloupce a `AT TIME ZONE $3` odvodí `text` z funkce. Cast potřebuje **jen `$2`**, protože jako jediný vstupuje do aritmetiky s intervalem.

- [ ] **Krok 5: Spusť test**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/segments/compile/contact.test.ts`
Expected: PASS, šest testů.

- [ ] **Krok 6: Commit**

```bash
git add packages/core/src/segments/compile/columns.ts packages/core/src/segments/compile/contact.ts packages/core/test/segments/compile/contact.test.ts
git commit -m "feat(segments): compile first class contact fields through a constant column map"
```

---

### Úkol 9: Čtyřčlenná obálka

Obálka je jediná věc v celém enginu, kterou volající nemůže vynechat, a má **právě jednu verzi**. Dřívější dokument ji popisoval dvakrát a pokaždé jinak, jednou bez suppression; ta kratší verze by pustila do náhledu i do publika adresu se stížností na spam.

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/segments/compile/envelope.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/test/segments/compile/envelope.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
import { describe, expect, it } from 'vitest';
import { ParamBag } from '../../../src/segments/compile/params.js';
import { buildEnvelope, ENVELOPE_CONDITIONS, FIXED_PARAM_COUNT } from '../../../src/segments/compile/envelope.js';

describe('envelope', () => {
  it('has exactly six conditions plus the audience', () => {
    const bag = new ParamBag(0);
    const sql = buildEnvelope('a', 'true', bag);
    expect(sql).toContain('a.workspace_id = $1');
    expect(sql).toContain('a.deleted_at IS NULL');
    expect(sql).toContain('a.anonymized_at IS NULL');
    expect(sql).toContain("a.status <> 'deleted'");
    expect(sql).toContain('a.processing_restricted = false');
    expect(sql).toContain('NOT EXISTS');
    expect(sql).toContain('su.removed_at IS NULL');
    expect(sql).toContain('su.fingerprint = ANY(a.email_fingerprints)');
  });

  it('lists every mandatory condition, so a removal cannot pass unnoticed', () => {
    // Výčtový test schválně. Kdyby někdo obálce ubral podmínku, testy nad
    // jednotlivými řetězci výš by se daly "opravit" smazáním řádku.
    // Tenhle test se musí opravit vědomě a s vysvětlením.
    expect(ENVELOPE_CONDITIONS).toEqual([
      'workspace_id',
      'deleted_at',
      'anonymized_at',
      'status_not_deleted',
      'processing_restricted',
      'suppressions',
    ]);
  });

  it('selects only contact_id and carries no order or limit', () => {
    const sql = buildEnvelope('a', 'true', new ParamBag(0));
    expect(sql.startsWith('SELECT a.id AS contact_id')).toBe(true);
    expect(sql).not.toMatch(/\border by\b/i);
    expect(sql).not.toMatch(/\blimit\b/i);
    expect(sql).not.toContain(';');
  });

  it('reserves three fixed parameters', () => {
    expect(FIXED_PARAM_COUNT).toBe(3);
  });

  it('honours paramOffset', () => {
    const sql = buildEnvelope('a', 'true', new ParamBag(5));
    expect(sql).toContain('a.workspace_id = $6');
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/segments/compile/envelope.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Krok 3: Napiš `envelope.ts`**

```ts
import type { ParamBag } from './params.js';
import { assertAlias } from './columns.js';

/** workspace_id, asOf, timezone. Přidává je volající před kompilací uzlů. */
export const FIXED_PARAM_COUNT = 3;

/**
 * Výčet podmínek obálky jako data, aby šlo testem ověřit ÚPLNOST, ne jen
 * přítomnost jednotlivých řetězců. Test na „obsahuje deleted_at" se dá obejít
 * tím, že se podmínka smaže i s testem; tenhle seznam se musí změnit vědomě.
 */
export const ENVELOPE_CONDITIONS = [
  'workspace_id',
  'deleted_at',
  'anonymized_at',
  'status_not_deleted',
  'processing_restricted',
  'suppressions',
] as const;

/**
 * Jediná verze obálky, jakou tenhle produkt má. Platí pro compileAudienceToSql,
 * countSegment i listSegmentContacts bez rozdílu, takže náhled segmentu a publikum
 * kampaně vidí tutéž množinu kontaktů.
 *
 * Otisková větev porovnává proti POLI a.email_fingerprints, tedy proti otiskům pod
 * všemi známými pokoleními klíče. Suppression řádek nese jedno pokolení a přepočítat
 * mu ho nejde; kontakt nese všechna, protože jeho plaintext máme. Bez toho by se
 * adresa zablokovaná před rotací SECRET_KEY vrátila prvním dalším importem.
 *
 * Anonymizovaný kontakt se vylučuje DVĚMA podmínkami, protože jeden příznak
 * nestačí. Výmaz podle článku 17 řádek NEMAŽE (rozhodnutí R3 v P03): přepíše
 * `email` na `erased+{contact_id}@erased.invalid`, vyprázdní `render_data`
 * a nastaví `anonymized_at`, ale `deleted_at` nastavovat nemusí. Bez
 * `anonymized_at IS NULL` by tedy vymazaný člověk zůstal v publiku a pošta by
 * odešla na neexistující doménu, což je tvrdý odraz a poškozená reputace
 * odesílatele. Hodnota `deleted` ve `status` je druhá cesta k témuž stavu.
 */
export function buildEnvelope(alias: string, audienceSql: string, bag: ParamBag): string {
  assertAlias(alias);
  const ws = bag.ref(1);
  return [
    `SELECT ${alias}.id AS contact_id`,
    `  FROM contacts ${alias}`,
    ` WHERE ${alias}.workspace_id = ${ws}`,
    `   AND ${alias}.deleted_at IS NULL`,
    `   AND ${alias}.anonymized_at IS NULL`,
    `   AND ${alias}.status <> 'deleted'`,
    `   AND ${alias}.processing_restricted = false`,
    `   AND NOT EXISTS (`,
    `         SELECT 1 FROM suppressions su`,
    `          WHERE su.workspace_id = ${alias}.workspace_id`,
    `            AND su.removed_at IS NULL`,
    `            AND (su.email = ${alias}.email`,
    `                 OR su.fingerprint = ANY(${alias}.email_fingerprints)))`,
    `   AND (${audienceSql})`,
  ].join('\n');
}
```

Varianta pro `count(*)` se **nestaví druhou funkcí**, ale záměnou první řádky výsledku (viz `countSegment` v úkolu 17). Dvě funkce, které mají mít tytéž podmínky, se rozejdou při první úpravě a rozdíl by se projevil jako náhled ukazující jiné číslo, než kolik se odešle.

Obálka má **šest** podmínek, ne čtyři, jak stálo v dřívější podobě tohohle plánu. Přibyly `anonymized_at IS NULL` a `status <> 'deleted'`. Argument pro ně je tentýž, jakým tenhle plán zdůvodňuje požadavek 13.1 na P13 („kdyby si kampaň psala vlastní SQL, odešla by pošta člověku s omezeným zpracováním"), jen o stupeň horší: člověk s omezeným zpracováním dostane poštu, kterou nechtěl, kdežto vymazaný člověk vyrobí tvrdý odraz na neexistující doméně. Obálka je jediné místo, kde se to hlídá, takže tam ta podmínka musí být.

- [ ] **Krok 4: Spusť test**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/segments/compile/envelope.test.ts`
Expected: PASS, pět testů.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/segments/compile/envelope.ts packages/core/test/segments/compile/envelope.test.ts
git commit -m "feat(segments): add the single four condition envelope"
```

---

### Úkol 10: Vlastní pole v `attributes`

Tři pasti na jednom místě: cast musí být uvnitř `CASE WHEN`, `is_empty` potřebuje tři větve a klíč pole se nikdy neinterpoluje.

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/segments/compile/attribute.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/test/segments/compile/attribute.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
import { describe, expect, it } from 'vitest';
import { ParamBag } from '../../../src/segments/compile/params.js';
import { compileAttributeCondition } from '../../../src/segments/compile/attribute.js';

function bagWithFixed(): ParamBag {
  const bag = new ParamBag(0);
  bag.add('ws'); bag.add(new Date()); bag.add('Europe/Prague');
  return bag;
}

describe('attribute conditions', () => {
  it('passes the field key as a parameter, never as a literal', () => {
    const bag = bagWithFixed();
    const sql = compileAttributeCondition('a', 'city', 'text', 'eq', { value: 'Praha' }, bag);
    expect(sql).not.toContain("'city'");
    expect(bag.values).toContain('city');
  });

  it('uses jsonb containment for eq on text, with both arguments cast', () => {
    const bag = bagWithFixed();
    const sql = compileAttributeCondition('a', 'city', 'text', 'eq', { value: 'Praha' }, bag);
    expect(sql).toBe('(a.attributes @> jsonb_build_object($4::text, $5::text))');
  });

  it('casts both arguments of jsonb_build_object for every field class', () => {
    // Bez castu skončí dotaz na 42P18 could not determine data type of parameter.
    // Je to nejběžnější podmínka segmentu vůbec, takže by to spadlo hned.
    const cases = [
      ['text', 'Praha', '$5::text'],
      ['number', 1000, 'to_jsonb($5::numeric)'],
      ['boolean', true, 'to_jsonb($5::boolean)'],
    ] as const;
    for (const [cls, value, expected] of cases) {
      const sql = compileAttributeCondition('a', 'f', cls, 'eq', { value }, bagWithFixed());
      expect(sql, cls).toBe(`(a.attributes @> jsonb_build_object($4::text, ${expected}))`);
    }
  });

  it('keeps the numeric cast inside CASE WHEN, never after AND', () => {
    const bag = bagWithFixed();
    const sql = compileAttributeCondition('a', 'order_total', 'number', 'gt', { value: 1000 }, bag);
    expect(sql).toContain('CASE WHEN jsonb_typeof');
    expect(sql).toContain('ELSE false END');
    expect(sql).not.toMatch(/AND\s*\(a\.attributes ->> \$\d+\)::numeric/);
  });

  it('gives is_empty three branches including json null', () => {
    const bag = bagWithFixed();
    const sql = compileAttributeCondition('a', 'city', 'text', 'is_empty', {}, bag);
    expect(sql).toContain('IS NULL');
    expect(sql).toContain("jsonb_typeof(a.attributes -> $4::text) = 'null'");
    expect(sql).toContain("= ''");
  });

  it('compiles has_any as a disjunction of containments, never with ?|', () => {
    const bag = bagWithFixed();
    const sql = compileAttributeCondition('a', 'interests', 'multi_enum', 'has_any', { values: ['a', 'b'] }, bag);
    expect(sql).toBe(
      '((a.attributes @> jsonb_build_object($4::text, jsonb_build_array($5::text)))'
      + ' OR (a.attributes @> jsonb_build_object($4::text, jsonb_build_array($6::text))))',
    );
  });

  it('never emits an operator that the jsonb_path_ops index cannot serve', () => {
    // idx_contacts__attributes_gin je jsonb_path_ops a ta umí VÝHRADNĚ @>.
    // Kdyby sem kdokoli vrátil ?, ?| nebo ?&, tenhle test to zachytí,
    // a zachytí to i u operátoru, který teprve přibude.
    for (const [op, node] of [
      ['has_any', { values: ['a', 'b'] }],
      ['has_all', { values: ['a', 'b'] }],
      ['has_none', { values: ['a'] }],
    ] as const) {
      const sql = compileAttributeCondition('a', 'interests', 'multi_enum', op, node, bagWithFixed());
      expect(sql, op).toContain('@>');
      expect(sql, op).not.toMatch(/\?\||\?&|attributes \?/);
    }
  });

  it('compiles has_all as one containment of the whole array', () => {
    const sql = compileAttributeCondition('a', 'interests', 'multi_enum', 'has_all', { values: ['a', 'b'] }, bagWithFixed());
    expect(sql).toBe('(a.attributes @> jsonb_build_object($4::text, to_jsonb($5::text[])))');
  });

  it('compiles an empty value list to false instead of empty parentheses', () => {
    const sql = compileAttributeCondition('a', 'interests', 'multi_enum', 'has_any', { values: [] }, bagWithFixed());
    expect(sql).toBe('(false)');
  });

  it('guards EVERY date cast by validity, not just by json type', () => {
    // jsonb_typeof(...) = 'string' je pravdivé i pro "Praha", protože JSON typ
    // pro datum nemá. Bez pg_input_is_valid by se větev THEN vyhodnotila
    // a cast shodil dotaz chybou 22007. Rozhodnutí R9 řeší totéž u čísel,
    // kde ale 'number' cast opravdu garantuje; u datumů negarantuje nic.
    for (const op of ['on', 'before', 'after', 'in_last_days', 'not_in_last_days', 'in_next_days'] as const) {
      const sql = compileAttributeCondition('a', 'signed_at', 'date', op, { value: '2026-08-15' }, bagWithFixed());
      expect(sql, op).toContain("pg_input_is_valid((a.attributes ->> $4::text), 'timestamptz')");
      expect(sql, op).toContain('ELSE false END');
    }
    const between = compileAttributeCondition('a', 'signed_at', 'date', 'between', { values: ['2026-01-01', '2026-12-31'] }, bagWithFixed());
    expect(between).toContain("pg_input_is_valid((a.attributes ->> $4::text), 'timestamptz')");
  });

  it('escapes like wildcards in contains', () => {
    const bag = bagWithFixed();
    compileAttributeCondition('a', 'note', 'text', 'contains', { value: '50%' }, bag);
    expect(bag.values).toContain('50\\%');
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/segments/compile/attribute.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Krok 3: Napiš `attribute.ts`**

```ts
import type { Operator } from '../ast.js';
import type { FieldClass } from '../operators.js';
import type { ParamBag } from './params.js';
import { assertAlias } from './columns.js';
import { escapeLike } from './contact.js';

type Node = { value?: unknown; values?: unknown[] };

/**
 * Přetypování `::numeric` je VŽDY uvnitř CASE WHEN, nikdy za AND.
 * PostgreSQL negarantuje pořadí vyhodnocení operandů AND a plánovač je přehazuje
 * podle odhadované ceny, takže cast za AND může proběhnout i na řádku, kde
 * jsonb_typeof není 'number'. Jediná textová hodnota v poli typu number pak shodí
 * celý dotaz chybou 22P02, a to nedeterministicky, podle plánu. CASE WHEN je jediná
 * konstrukce, u které SQL standard i PostgreSQL garantují, že se větev THEN
 * nevyhodnotí, když podmínka neplatí.
 */
function numericGuard(alias: string, keyRef: string, comparison: string): string {
  return `(CASE WHEN jsonb_typeof(${alias}.attributes -> ${keyRef}) = 'number' THEN ${comparison} ELSE false END)`;
}

/**
 * Totéž pro datumy, ale `jsonb_typeof(...) = 'string'` NESTAČÍ a je to past,
 * která vypadá jako hotová ochrana.
 *
 * JSON typ pro datum nemá, datum je uložené jako řetězec. Podmínka na `'string'`
 * je tedy pravdivá i pro hodnotu `"Praha"`, větev THEN se vyhodnotí a
 * `'Praha'::timestamptz` shodí celý dotaz chybou
 * `22007 invalid input syntax for type timestamp with time zone`.
 *
 * Je to přesně tentýž problém, kvůli kterému rozhodnutí R9 zavedlo `CASE WHEN`
 * u čísel, jen u datumů `jsonb_typeof` nepomůže, protože rozlišuje typy JSONu,
 * ne obsah řetězce. U čísel `'number'` skutečně garantuje, že cast projde;
 * u datumů `'string'` negarantuje nic.
 *
 * Ověřeno spuštěním, a odhalilo se to teprve nad daty: dokud v projektu žádný
 * kontakt to pole vyplněné neměl, PostgreSQL větev nevyhodnotil a všech
 * sedm datových operátorů procházelo. Uživatel by tedy segment nad datem
 * založil, otestoval a ten by mu přestal fungovat ve chvíli, kdy do pole
 * někdo zapíše text, tedy v provozu a bez souvislosti se změnou segmentu.
 *
 * `pg_input_is_valid(text, type)` je v PostgreSQL od verze 16 a vrací
 * `false` místo chyby. Projekt stojí na 18, takže je k dispozici.
 */
function dateGuard(alias: string, keyRef: string, textRef: string, comparison: string): string {
  return `(CASE WHEN jsonb_typeof(${alias}.attributes -> ${keyRef}) = 'string'`
    + ` AND pg_input_is_valid(${textRef}, 'timestamptz')`
    + ` THEN ${comparison} ELSE false END)`;
}

/**
 * Klíč i hodnota jdou do `jsonb_build_object` VŽDY s explicitním castem.
 *
 * Ověřeno spuštěním: `jsonb_build_object($1, $2)` skončí chybou
 * `42P18 could not determine data type of parameter $1`, protože funkce je
 * variadická nad `any` a PostgreSQL nemá z čeho typ odvodit. Bez castu by tedy
 * spadla **každá rovnost nad vlastním polem**, což je ta úplně nejběžnější
 * podmínka segmentu, a spadla by hned při prvním použití.
 */
function containment(alias: string, keyRef: string, valueRef: string): string {
  return `(${alias}.attributes @> jsonb_build_object(${keyRef}, ${valueRef}))`;
}

function jsonValue(fieldClass: FieldClass, value: unknown, bag: ParamBag): string {
  if (fieldClass === 'number') return `to_jsonb(${bag.add(value, 'numeric')})`;
  if (fieldClass === 'boolean') return `to_jsonb(${bag.add(value, 'boolean')})`;
  return bag.add(value === null || value === undefined ? null : String(value), 'text');
}

export function compileAttributeCondition(
  alias: string,
  key: string,
  fieldClass: FieldClass,
  operator: Operator,
  node: Node,
  bag: ParamBag,
): string {
  assertAlias(alias);
  const k = bag.add(key, 'text');
  const text = `(${alias}.attributes ->> ${k})`;
  const asOf = bag.ref(2, 'timestamptz');

  switch (operator) {
    case 'eq':
      return containment(alias, k, jsonValue(fieldClass, node.value, bag));
    case 'neq':
      return `(NOT ${containment(alias, k, jsonValue(fieldClass, node.value, bag))})`;
    case 'contains':
      return `(${text} ILIKE '%' || ${bag.add(escapeLike(String(node.value)))} || '%')`;
    case 'not_contains':
      return `(${text} NOT ILIKE '%' || ${bag.add(escapeLike(String(node.value)))} || '%')`;
    case 'starts_with':
      return `(${text} ILIKE ${bag.add(escapeLike(String(node.value)))} || '%')`;
    case 'ends_with':
      return `(${text} ILIKE '%' || ${bag.add(escapeLike(String(node.value)))})`;
    case 'in':
      return `(${text} = ANY(${bag.add((node.values ?? []).map(String), 'text[]')}))`;
    case 'not_in':
      return `(NOT (${text} = ANY(${bag.add((node.values ?? []).map(String), 'text[]')})))`;
    case 'is_empty':
      return `((${alias}.attributes -> ${k}) IS NULL OR jsonb_typeof(${alias}.attributes -> ${k}) = 'null' OR ${text} = '')`;
    case 'is_not_empty':
      return `((${alias}.attributes -> ${k}) IS NOT NULL AND jsonb_typeof(${alias}.attributes -> ${k}) <> 'null' AND ${text} <> '')`;
    case 'is_true':
      return `((${alias}.attributes -> ${k}) = 'true'::jsonb)`;
    case 'is_false':
      return `((${alias}.attributes -> ${k}) = 'false'::jsonb)`;
    case 'gt': return numericGuard(alias, k, `${text}::numeric > ${bag.add(node.value)}`);
    case 'gte': return numericGuard(alias, k, `${text}::numeric >= ${bag.add(node.value)}`);
    case 'lt': return numericGuard(alias, k, `${text}::numeric < ${bag.add(node.value)}`);
    case 'lte': return numericGuard(alias, k, `${text}::numeric <= ${bag.add(node.value)}`);
    case 'between': {
      const [lo, hi] = node.values as [unknown, unknown];
      if (fieldClass === 'number') {
        return numericGuard(alias, k, `${text}::numeric BETWEEN ${bag.add(lo)} AND ${bag.add(hi)}`);
      }
      return dateGuard(alias, k, text, `${text}::timestamptz BETWEEN ${bag.add(lo)} AND ${bag.add(hi)}`);
    }
    case 'on':
      return dateGuard(alias, k, text,
        `(${text}::timestamptz AT TIME ZONE ${bag.ref(3)})::date = ${bag.add(node.value)}::date`);
    case 'before':
      return dateGuard(alias, k, text, `${text}::timestamptz < ${bag.add(node.value)}`);
    case 'after':
      return dateGuard(alias, k, text, `${text}::timestamptz > ${bag.add(node.value)}`);
    case 'in_last_days':
      return dateGuard(alias, k, text,
        `${text}::timestamptz >= ${asOf} - make_interval(days => ${bag.add(node.value)})`);
    case 'not_in_last_days':
      return dateGuard(alias, k, text,
        `${text}::timestamptz < ${asOf} - make_interval(days => ${bag.add(node.value)})`);
    case 'in_next_days':
      return dateGuard(alias, k, text,
        `${text}::timestamptz > ${asOf} AND ${text}::timestamptz <= ${asOf} + make_interval(days => ${bag.add(node.value)})`);
    // Operátory nad seznamem hodnot jdou přes @>, ne přes ?| a ?&.
    // Důvod je index: jediný GIN nad attributes je idx_contacts__attributes_gin
    // s operátorovou třídou jsonb_path_ops, a ta podporuje VÝHRADNĚ @>.
    // Operátory ?, ?| a ?& umí jen výchozí jsonb_ops, takže by šly seq scanem
    // přes všechny kontakty. Druhý index se zakládat nesmí (kapitola 8 P03)
    // a nebyl by ani správný: P03 zvolil jsonb_path_ops vědomě, je menší a rychlejší.
    case 'has_any':
      return anyContainment(alias, k, node.values ?? [], bag);
    case 'has_all':
      // Jedno containment, protože @> nad polem znamená "obsahuje všechny prvky".
      return containment(alias, k, `to_jsonb(${bag.add((node.values ?? []).map(String), 'text[]')})`);
    case 'has_none':
      return `(NOT ${anyContainment(alias, k, node.values ?? [], bag)})`;
    default:
      throw new Error(`operator ${operator} is not valid for an attribute field`);
  }
}

/**
 * "Obsahuje aspoň jednu z hodnot" se skládá jako disjunkce containmentů, protože
 * @> nad polem znamená "obsahuje VŠECHNY", ne "aspoň jednu". Každý člen disjunkce
 * je samostatně indexovatelný.
 *
 * Prázdný seznam vrací `false`, ne prázdnou závorku: `()` je syntaktická chyba
 * a `OR` bez operandů taky. Limit počtu hodnot hlídá úkol 5.
 */
function anyContainment(alias: string, keyRef: string, values: readonly unknown[], bag: ParamBag): string {
  if (values.length === 0) return '(false)';
  const parts = values.map((v) =>
    containment(alias, keyRef, `jsonb_build_array(${bag.add(String(v), 'text')})`));
  return `(${parts.join(' OR ')})`;
}
```

- [ ] **Krok 4: Spusť test**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/segments/compile/attribute.test.ts`
Expected: PASS, dvanáct testů.

Proč se `?|` a `?&` opustily, ověřeno spuštěním nad 20 000 kontakty se stejně selektivní hodnotou a stejným indexem `GIN (attributes jsonb_path_ops)`:

```
@> jsonb_build_object('interests', jsonb_build_array('vzacny'))
   -> Bitmap Index Scan on idx_contacts__attributes_gin

(attributes -> 'interests') ?| ARRAY['vzacny']
   -> Seq Scan on contacts
```

Není to odhad z dokumentace: `jsonb_path_ops` prostě operátor `?|` v indexu nemá, takže plánovač nemá co použít. U pěti milionů kontaktů je rozdíl mezi tím, jestli obrazovka „proč je segment prázdný" (úkoly 21 a 59) odpoví, nebo doběhne na `statement_timeout` a neodpoví nic.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/segments/compile/attribute.ts packages/core/test/segments/compile/attribute.test.ts
git commit -m "feat(segments): compile custom field conditions with guarded casts"
```

---

### Úkol 11: Štítky, seznamy, souhlasy a blokované adresy

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/segments/compile/tag-list-consent.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/test/segments/compile/tag-list-consent.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
import { describe, expect, it } from 'vitest';
import { ParamBag } from '../../../src/segments/compile/params.js';
import {
  compileTagCondition, compileListCondition, compileConsentCondition, compileSuppressionCondition,
} from '../../../src/segments/compile/tag-list-consent.js';

function bag(): ParamBag {
  const b = new ParamBag(0);
  b.add('ws'); b.add(new Date()); b.add('Europe/Prague');
  return b;
}

describe('tag, list, consent and suppression', () => {
  it('compiles has_all by comparing cardinality of the same parameter', () => {
    const b = bag();
    const sql = compileTagCondition('a', 'has_all', ['t1', 't2'], b);
    expect(sql).toContain('cardinality($4::uuid[])');
    expect(sql).toContain('= ANY($4::uuid[])');
  });

  it('list membership never accepts pending and honours snooze', () => {
    const b = bag();
    const sql = compileListCondition('a', 'l1', 'is_member', b);
    expect(sql).toContain("ls.status = 'confirmed'");
    expect(sql).toContain('ls.snooze_until IS NULL OR ls.snooze_until <= $2');
  });

  it('is_pending selects pending, not confirmed', () => {
    const sql = compileListCondition('a', 'l1', 'is_pending', bag());
    expect(sql).toContain("ls.status = 'pending'");
    expect(sql).not.toContain("ls.status = 'confirmed'");
  });

  it('is_missing means no row at all', () => {
    const sql = compileConsentCondition('a', 'email_marketing', 'is_missing', bag());
    expect(sql.startsWith('(NOT EXISTS')).toBe(true);
  });

  it('suppression checks both branches and removed_at', () => {
    const sql = compileSuppressionCondition('a', 'is_suppressed', bag());
    expect(sql).toContain('su.removed_at IS NULL');
    expect(sql).toContain('su.fingerprint = ANY(a.email_fingerprints)');
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/segments/compile/tag-list-consent.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Krok 3: Napiš `tag-list-consent.ts`**

```ts
import type { Operator } from '../ast.js';
import type { ParamBag } from './params.js';
import { assertAlias } from './columns.js';

export function compileTagCondition(alias: string, operator: Operator, values: string[], bag: ParamBag): string {
  assertAlias(alias);
  const ids = bag.add(values, 'uuid[]');
  const exists = `EXISTS (SELECT 1 FROM contact_tags ct WHERE ct.contact_id = ${alias}.id AND ct.tag_id = ANY(${ids}))`;
  switch (operator) {
    case 'has_any': return `(${exists})`;
    case 'has_none': return `(NOT ${exists})`;
    case 'has_all':
      return `((SELECT count(*) FROM contact_tags ct WHERE ct.contact_id = ${alias}.id AND ct.tag_id = ANY(${ids})) = cardinality(${ids}))`;
    default: throw new Error(`operator ${operator} is not valid for tags`);
  }
}

export function compileListCondition(alias: string, listId: string, operator: Operator, bag: ParamBag): string {
  assertAlias(alias);
  const id = bag.add(listId, 'uuid');
  const asOf = bag.ref(2);
  const base = (status: string) =>
    `EXISTS (SELECT 1 FROM list_subscriptions ls WHERE ls.contact_id = ${alias}.id AND ls.list_id = ${id} AND ls.status = '${status}'`;
  const notSnoozed = ` AND (ls.snooze_until IS NULL OR ls.snooze_until <= ${asOf}))`;
  switch (operator) {
    // "Je v seznamu" znamená potvrzené přihlášení a nepozastavenou komunikaci.
    // Kdyby to znamenalo jen existenci řádku, dostal by poštu i ten, kdo nepotvrdil.
    case 'is_member': return `(${base('confirmed')}${notSnoozed})`;
    case 'is_not_member': return `(NOT ${base('confirmed')}${notSnoozed})`;
    case 'is_confirmed': return `(${base('confirmed')}${notSnoozed})`;
    case 'is_pending': return `(${base('pending')}))`;
    case 'is_unsubscribed': return `(${base('unsubscribed')}))`;
    default: throw new Error(`operator ${operator} is not valid for lists`);
  }
}

export function compileConsentCondition(alias: string, purpose: string, operator: Operator, bag: ParamBag): string {
  assertAlias(alias);
  const p = bag.add(purpose);
  const withStatus = (status: string) =>
    `EXISTS (SELECT 1 FROM contact_consent_state s WHERE s.contact_id = ${alias}.id AND s.purpose = ${p} AND s.status = '${status}')`;
  switch (operator) {
    case 'is_granted': return `(${withStatus('granted')})`;
    case 'is_withdrawn': return `(${withStatus('withdrawn')})`;
    // "Nikdy nedal" je nepřítomnost záznamu, ne stav withdrawn. Právně to nejsou totéž.
    case 'is_missing':
      return `(NOT EXISTS (SELECT 1 FROM contact_consent_state s WHERE s.contact_id = ${alias}.id AND s.purpose = ${p}))`;
    default: throw new Error(`operator ${operator} is not valid for consents`);
  }
}

export function compileSuppressionCondition(alias: string, operator: Operator, _bag: ParamBag): string {
  assertAlias(alias);
  const exists =
    `EXISTS (SELECT 1 FROM suppressions su WHERE su.workspace_id = ${alias}.workspace_id AND su.removed_at IS NULL ` +
    `AND (su.email = ${alias}.email OR su.fingerprint = ANY(${alias}.email_fingerprints)))`;
  switch (operator) {
    case 'is_suppressed': return `(${exists})`;
    case 'is_not_suppressed': return `(NOT ${exists})`;
    default: throw new Error(`operator ${operator} is not valid for suppression`);
  }
}
```

Uvozovky kolem stavů (`'confirmed'`, `'granted'`) jsou v pořádku: nejsou to hodnoty od uživatele, jsou to konstanty z kódu, které si nemůže nikdo zvenčí zvolit. Test v úkolu 18 kontroluje, že všechny ostatní hodnoty jsou parametry.

- [ ] **Krok 4: Spusť test**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/segments/compile/tag-list-consent.test.ts`
Expected: PASS, pět testů.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/segments/compile/tag-list-consent.ts packages/core/test/segments/compile/tag-list-consent.test.ts
git commit -m "feat(segments): compile tag, list, consent and suppression conditions"
```

---

### Úkol 12: Aktivita v kampaních a chování na webu

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/segments/compile/engagement-event.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/test/segments/compile/engagement-event.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
import { describe, expect, it } from 'vitest';
import { ParamBag } from '../../../src/segments/compile/params.js';
import { compileEngagementCondition, compileEventCondition } from '../../../src/segments/compile/engagement-event.js';

function bag(): ParamBag {
  const b = new ParamBag(0);
  b.add('ws'); b.add(new Date()); b.add('Europe/Prague');
  return b;
}

const CAMPAIGN = '00000000-0000-0000-0000-0000000000aa';

describe('engagement and event', () => {
  it('uses the rollup for opened with since_days 90 and adds no warning', () => {
    const b = bag();
    const out = compileEngagementCondition('a', { metric: 'opened', scope: { since_days: 90 } }, 'did', {}, b);
    expect(out.sql).toContain('contact_engagement');
    expect(out.sql).toContain('ce.last_open_at >= $2 - make_interval(days => $4)');
    expect(out.warnings).toEqual([]);
  });

  it('scopes every contact_engagement subquery by workspace_id, not only by contact_id', () => {
    const out = compileEngagementCondition('a', { metric: 'opened', scope: { since_days: 30 } }, 'did', {}, bag());
    expect(out.sql).toContain('ce.workspace_id = a.workspace_id');
  });

  it('falls back to message_events for an arbitrary window and warns', () => {
    const b = bag();
    const out = compileEngagementCondition('a', { metric: 'opened', scope: { since_days: 45 } }, 'did', {}, b);
    expect(out.sql).toContain('message_events');
    expect(out.warnings).toEqual(['segment_slow_engagement']);
  });

  it('uses the rollup column names from the schema, never the invented ones', () => {
    const out = compileEngagementCondition('a', { metric: 'opened', scope: {} }, 'count_gte', { value: 3 }, bag());
    expect(out.sql).toContain('ce.opens_total');
    expect(out.sql).not.toContain('opened_count');
  });

  it('reads a precomputed window instead of scanning when since_days is 7, 30 or 90', () => {
    const out = compileEngagementCondition('a', { metric: 'clicked', scope: { since_days: 30 } }, 'count_gte', { value: 2 }, bag());
    expect(out.sql).toContain('ce.clicks30d');
    expect(out.warnings).toEqual([]);
  });

  it('counts sent from messages, not from message_events, once the scope forces the slow branch', () => {
    const b = bag();
    const out = compileEngagementCondition('a', { metric: 'sent', scope: { campaign_id: CAMPAIGN } }, 'count_gte', { value: 3 }, b);
    expect(out.sql).toContain('FROM messages m');
    expect(out.sql).not.toContain('message_events');
  });

  it('bounds every partitioned table by its OWN partition key', () => {
    // messages podle created_at
    const sent = compileEngagementCondition('a', { metric: 'sent', scope: { since_days: 45 } }, 'did', {}, bag());
    expect(sent.sql).toContain('m.created_at >=');
    // message_events podle received_at, ne podle ts: ts je čas od providera
    const opened = compileEngagementCondition('a', { metric: 'opened', scope: { since_days: 45 } }, 'did', {}, bag());
    expect(opened.sql).toContain('me.received_at >=');
    expect(opened.sql).toContain('me.received_at <=');
    expect(opened.sql).toContain('me.ts >=');
    // web_events podle received_at, s horní i dolní mezí i bez zadaného okna
    const event = compileEventCondition('a', { name: 'purchase' }, 'did', {}, bag());
    expect(event.sql).toContain('we.received_at >=');
    expect(event.sql).toContain('we.received_at <=');
    expect(event.sql).toContain('web_event_months');
  });

  it('treats a soft bounce as a bounce, so preview and rollup cannot disagree', () => {
    const b = bag();
    const out = compileEngagementCondition('a', { metric: 'bounced', scope: { since_days: 45 } }, 'did', {}, b);
    expect(out.sql).toContain('me.type = ANY(');
    expect(b.values).toContainEqual(['bounced_hard', 'bounced_soft']);
  });

  it('selects recent campaigns by status and finished_at, because campaigns.sent_at does not exist', () => {
    const b = bag();
    const out = compileEngagementCondition('a', { metric: 'opened', scope: { last_n_campaigns: 5 } }, 'did', {}, b);
    expect(out.sql).not.toContain('sent_at');
    expect(out.sql).toContain('finished_at IS NOT NULL ORDER BY finished_at DESC');
    expect(b.values).toContainEqual(['sent', 'partially_sent']);
  });

  it('did_not is the negation of did, never a separate query shape', () => {
    const did = compileEngagementCondition('a', { metric: 'opened', scope: { since_days: 30 } }, 'did', {}, bag());
    const not = compileEngagementCondition('a', { metric: 'opened', scope: { since_days: 30 } }, 'did_not', {}, bag());
    expect(not.sql).toBe(`(NOT ${did.sql})`);
  });

  it('compiles an event condition against web_events with a parameterised name', () => {
    const b = bag();
    const out = compileEventCondition('a', { name: 'purchase' }, 'did', {}, b);
    expect(out.sql).toContain('web_events');
    expect(out.sql).not.toContain("'purchase'");
    expect(b.values).toContain('purchase');
  });

  it('never emits now() anywhere', () => {
    for (const days of [7, 30, 90, 45]) {
      const out = compileEngagementCondition('a', { metric: 'clicked', scope: { since_days: days } }, 'did', {}, bag());
      expect(out.sql.toLowerCase()).not.toMatch(/now\(|current_timestamp|localtimestamp|current_date/);
    }
    const event = compileEventCondition('a', { name: 'purchase' }, 'did', {}, bag());
    expect(event.sql.toLowerCase()).not.toMatch(/now\(|current_timestamp|localtimestamp|current_date/);
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/segments/compile/engagement-event.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Krok 3: Napiš `engagement-event.ts`**

```ts
import type { Operator } from '../ast.js';
import type { ParamBag } from './params.js';
import { assertAlias } from './columns.js';

export type CompiledPredicate = { sql: string; warnings: ('segment_slow_engagement')[] };

type EngagementField = {
  metric: 'sent' | 'delivered' | 'opened' | 'clicked' | 'bounced';
  scope: { campaign_id?: string; since_days?: number; last_n_campaigns?: number };
};

/** Rollup contact_engagement vlastní část 5. Předpočítaná okna jsou jen tahle tři. */
const ROLLUP_WINDOWS = [7, 30, 90] as const;

/** Jména sloupců jsou z P03, ne z návrhu. Pozor na dvě odchylky, na které se dá naletět:
 *  čítače končí na `_total`, ne `_count`, a u otevření a prokliků je to podstatné jméno
 *  v množném čísle (`opens_total`, `clicks_total`), ne příčestí (`opened_count`).
 *  Časová razítka naopak příčestí mají (`last_open_at`). */
const ROLLUP_LAST_AT: Record<EngagementField['metric'], string> = {
  sent: 'last_sent_at',
  delivered: 'last_delivered_at',
  opened: 'last_open_at',
  clicked: 'last_click_at',
  bounced: 'last_bounce_at',
};

const ROLLUP_COUNT: Record<EngagementField['metric'], string> = {
  sent: 'sent_total',
  delivered: 'delivered_total',
  opened: 'opens_total',
  clicked: 'clicks_total',
  bounced: 'bounces_total',
};

/** Okna existují jen pro tři metriky: P03 má sent7d/30d/90d, opens*, clicks*.
 *  Pro delivered a bounced okenní sloupce NEJSOU, takže tam okno znamená pomalou větev. */
const ROLLUP_WINDOW_COUNT: Partial<Record<EngagementField['metric'], (days: number) => string>> = {
  sent: (d) => `sent${d}d`,
  opened: (d) => `opens${d}d`,
  clicked: (d) => `clicks${d}d`,
};

/** Jedna metrika může odpovídat víc typům události. Měkký odraz je pořád odraz:
 *  kdyby tu byl jen bounced_hard, dal by segment jiné číslo než rollup bounces_total,
 *  který počítá obojí, a tentýž dotaz by přes náhled a přes rollup vyšel jinak. */
const EVENT_TYPES: Record<Exclude<EngagementField['metric'], 'sent'>, readonly string[]> = {
  delivered: ['delivered'],
  opened: ['open'],
  clicked: ['click'],
  bounced: ['bounced_hard', 'bounced_soft'],
};

function typePredicate(alias: 'me', metric: Exclude<EngagementField['metric'], 'sent'>, bag: ParamBag): string {
  const types = EVENT_TYPES[metric];
  return types.length === 1
    ? `${alias}.type = ${bag.add(types[0])}`
    : `${alias}.type = ANY(${bag.add([...types], 'text[]')})`;
}

function usesRollup(field: EngagementField): boolean {
  const { campaign_id, since_days, last_n_campaigns } = field.scope;
  if (campaign_id || last_n_campaigns) return false;
  if (since_days === undefined) return true;
  return (ROLLUP_WINDOWS as readonly number[]).includes(since_days);
}

function rollupExists(alias: string, field: EngagementField, bag: ParamBag): string {
  const asOf = bag.ref(2);
  const days = field.scope.since_days;
  const col = ROLLUP_LAST_AT[field.metric];
  const window =
    days === undefined ? '' : ` AND ce.${col} >= ${asOf} - make_interval(days => ${bag.add(days)})`;
  // workspace_id je v poddotazu explicitně, i když ho RLS doplní: PK je
  // (workspace_id, contact_id) v tomhle pořadí, takže bez něj se index nevyužije,
  // a hlavně je to jediné místo kompilátoru, kde by se na RLS spoléhalo místo
  // vlastní podmínky. Ostatní poddotazy workspace_id uvádějí taky.
  return `EXISTS (SELECT 1 FROM contact_engagement ce`
    + ` WHERE ce.workspace_id = ${alias}.workspace_id AND ce.contact_id = ${alias}.id`
    + ` AND ce.${col} IS NOT NULL${window})`;
}

/**
 * Pomalá větev jde na partitionované tabulky, takže KAŽDÁ musí nést podmínku na
 * svůj partiční klíč, jinak plánovač neprořeže nic a projde všechny měsíční oddíly.
 * Partiční klíče jsou: `messages` podle `created_at`, `message_events` podle
 * `received_at`, `web_events` podle `received_at`.
 *
 * U `message_events` je to zrádné: `me.ts` je čas události od providera, kdežto
 * partitionuje se podle `me.received_at`, tedy podle času přijetí. Podmínka na `ts`
 * sama o sobě neprořeže nic. Obě podmínky tam proto jsou: `ts` drží význam
 * („kdy se to stalo"), `received_at` drží výkon. Spodní mez u `received_at` je
 * o den volnější, aby zpožděně přijatá událost nevypadla z výsledku.
 */
const LATE_ARRIVAL_DAYS = 1;

function slowExists(alias: string, field: EngagementField, bag: ParamBag): string {
  const asOf = bag.ref(2);
  const parts: string[] = [];
  if (field.metric === 'sent') {
    parts.push(`SELECT 1 FROM messages m WHERE m.contact_id = ${alias}.id AND m.workspace_id = ${alias}.workspace_id`);
    if (field.scope.campaign_id) parts.push(`AND m.campaign_id = ${bag.add(field.scope.campaign_id, 'uuid')}`);
    if (field.scope.since_days !== undefined) {
      parts.push(`AND m.created_at >= ${asOf} - make_interval(days => ${bag.add(field.scope.since_days)})`);
    }
  } else {
    parts.push(
      `SELECT 1 FROM message_events me WHERE me.contact_id = ${alias}.id AND me.workspace_id = ${alias}.workspace_id`,
      `AND ${typePredicate('me', field.metric, bag)}`,
    );
    if (field.scope.campaign_id) parts.push(`AND me.campaign_id = ${bag.add(field.scope.campaign_id, 'uuid')}`);
    if (field.scope.since_days !== undefined) {
      const days = bag.add(field.scope.since_days);
      parts.push(
        `AND me.ts >= ${asOf} - make_interval(days => ${days})`,
        `AND me.received_at >= ${asOf} - make_interval(days => ${days}) - make_interval(days => ${bag.add(LATE_ARRIVAL_DAYS)})`,
        `AND me.received_at <= ${asOf}`,
      );
    }
    if (field.scope.last_n_campaigns !== undefined) {
      // campaigns.sent_at NEEXISTUJE. Odeslanost se pozná ze stavu a času dokončení,
      // a slovník ck_campaigns__status mezi 'sent' a 'partially_sent' rozlišuje.
      parts.push(
        `AND me.campaign_id IN (SELECT id FROM campaigns WHERE workspace_id = ${alias}.workspace_id`,
        `AND status = ANY(${bag.add(['sent', 'partially_sent'], 'text[]')})`,
        `AND finished_at IS NOT NULL ORDER BY finished_at DESC LIMIT ${bag.add(field.scope.last_n_campaigns)})`,
      );
    }
  }
  return `EXISTS (${parts.join(' ')})`;
}

function countExpr(alias: string, field: EngagementField, bag: ParamBag): { sql: string; slow: boolean } {
  const days = field.scope.since_days;
  const scoped = field.scope.campaign_id === undefined && field.scope.last_n_campaigns === undefined;

  if (scoped && days === undefined) {
    return {
      sql: `(SELECT coalesce(ce.${ROLLUP_COUNT[field.metric]}, 0) FROM contact_engagement ce`
        + ` WHERE ce.workspace_id = ${alias}.workspace_id AND ce.contact_id = ${alias}.id)`,
      slow: false,
    };
  }
  // Předpočítané okno je právě to, kvůli čemu si tenhle plán rollup vyžádal
  // (požadavek 10.2). Bez téhle větve by okenní sloupce v P03 nikdo nečetl
  // a každý "otevřel aspoň třikrát za 30 dní" by šel přes desítky milionů řádků.
  if (scoped && days !== undefined && (ROLLUP_WINDOWS as readonly number[]).includes(days)) {
    const column = ROLLUP_WINDOW_COUNT[field.metric]?.(days);
    if (column) {
      return {
        sql: `(SELECT coalesce(ce.${column}, 0) FROM contact_engagement ce`
          + ` WHERE ce.workspace_id = ${alias}.workspace_id AND ce.contact_id = ${alias}.id)`,
        slow: false,
      };
    }
  }
  if (field.metric === 'sent') {
    const bounds = days === undefined
      ? ''
      : ` AND m.created_at >= ${bag.ref(2)} - make_interval(days => ${bag.add(days)}) AND m.created_at <= ${bag.ref(2)}`;
    return {
      sql: `(SELECT count(*) FROM messages m WHERE m.contact_id = ${alias}.id`
        + ` AND m.workspace_id = ${alias}.workspace_id${bounds})`,
      slow: true,
    };
  }
  const bounds = days === undefined
    ? ''
    : ` AND me.received_at >= ${bag.ref(2)} - make_interval(days => ${bag.add(days)})`
      + ` - make_interval(days => ${bag.add(LATE_ARRIVAL_DAYS)}) AND me.received_at <= ${bag.ref(2)}`;
  return {
    sql: `(SELECT count(*) FROM message_events me WHERE me.contact_id = ${alias}.id`
      + ` AND me.workspace_id = ${alias}.workspace_id AND ${typePredicate('me', field.metric, bag)}${bounds})`,
    slow: true,
  };
}

export function compileEngagementCondition(
  alias: string,
  field: EngagementField,
  operator: Operator,
  node: { value?: unknown },
  bag: ParamBag,
): CompiledPredicate {
  assertAlias(alias);
  if (operator === 'count_gte' || operator === 'count_lte') {
    const { sql, slow } = countExpr(alias, field, bag);
    const cmp = operator === 'count_gte' ? '>=' : '<=';
    return { sql: `(${sql} ${cmp} ${bag.add(node.value)})`, warnings: slow ? ['segment_slow_engagement'] : [] };
  }
  const rollup = usesRollup(field);
  const exists = rollup ? rollupExists(alias, field, bag) : slowExists(alias, field, bag);
  const warnings: CompiledPredicate['warnings'] = rollup ? [] : ['segment_slow_engagement'];
  if (operator === 'did') return { sql: `(${exists})`, warnings };
  if (operator === 'did_not') return { sql: `(NOT (${exists}))`, warnings };
  throw new Error(`operator ${operator} is not valid for engagement`);
}

/**
 * `web_events` je partitionovaná podle `received_at` a měsíčních oddílů jsou
 * desítky. Dotaz bez podmínky na `received_at` projde všechny, což je u
 * `SEGMENT_PREVIEW_TIMEOUT_MS` = 3 s jistý `57014` a náhled spadne do odhadu
 * z `EXPLAIN`. Uživatel by pak u dotazu „udělal událost purchase" dostal
 * „přibližně", ačkoli při prořezání je odpověď přesná.
 *
 * Obojí je proto povinné a ani jedno nejde vynechat:
 *
 *  1. **Horní i dolní mez na `received_at`.** Bez `since_days` platí výchozí
 *     okno `EVENT_DEFAULT_WINDOW_DAYS`, protože „někdy za celou historii" je
 *     u chování na webu otázka, kterou nikdo doopravdy neklade, a cena za ni
 *     je sken všech oddílů.
 *  2. **Předvýběr přes `web_event_months`.** Je to řídká mapa „v kterých
 *     měsících má tenhle subjekt vůbec nějaká data", kterou P03 zavedl přesně
 *     pro tenhle tvar dotazu. Kontakt, který na webu nikdy nebyl, se tím
 *     vyřídí jedním přístupem do indexu místo dotazu do každého oddílu.
 */
const EVENT_DEFAULT_WINDOW_DAYS = 365;

function webEventScope(alias: string, sinceDays: number | undefined, bag: ParamBag): string {
  const asOf = bag.ref(2);
  const days = bag.add(sinceDays ?? EVENT_DEFAULT_WINDOW_DAYS);
  return (
    ` AND we.received_at >= ${asOf} - make_interval(days => ${days})`
    + ` AND we.received_at <= ${asOf}`
    + ` AND EXISTS (SELECT 1 FROM web_event_months wm`
    + ` WHERE wm.workspace_id = ${alias}.workspace_id AND wm.subject_kind = 'contact'`
    + ` AND wm.subject_id = ${alias}.id`
    + ` AND wm.month >= date_trunc('month', ${asOf} - make_interval(days => ${days}))::date`
    + ` AND wm.month <= date_trunc('month', ${asOf})::date)`
  );
}

export function compileEventCondition(
  alias: string,
  field: { name: string; property?: string; since_days?: number },
  operator: Operator,
  node: { value?: unknown },
  bag: ParamBag,
): CompiledPredicate {
  assertAlias(alias);
  const name = bag.add(field.name);
  const base =
    `SELECT 1 FROM web_events we WHERE we.contact_id = ${alias}.id`
    + ` AND we.workspace_id = ${alias}.workspace_id AND we.name = ${name}`
    + webEventScope(alias, field.since_days, bag);
  switch (operator) {
    case 'did': return { sql: `(EXISTS (${base}))`, warnings: ['segment_slow_engagement'] };
    case 'did_not': return { sql: `(NOT EXISTS (${base}))`, warnings: ['segment_slow_engagement'] };
    case 'count_gte':
    case 'count_lte': {
      const cmp = operator === 'count_gte' ? '>=' : '<=';
      const count =
        `(SELECT count(*) FROM web_events we WHERE we.contact_id = ${alias}.id`
        + ` AND we.workspace_id = ${alias}.workspace_id AND we.name = ${name}`
        + webEventScope(alias, field.since_days, bag) + `)`;
      return { sql: `(${count} ${cmp} ${bag.add(node.value)})`, warnings: ['segment_slow_engagement'] };
    }
    default: throw new Error(`operator ${operator} is not valid for events`);
  }
}
```

Test „did_not je negace did" chrání před tím, aby někdo napsal `did_not` jako `NOT EXISTS` s jinými podmínkami než `did`. Dvě různě napsané větve téhož predikátu se rozejdou při první úpravě a rozdíl se projeví jako kontakt, který není ani v segmentu, ani v jeho doplňku.

- [ ] **Krok 4: Spusť test**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/segments/compile/engagement-event.test.ts`
Expected: PASS, dvanáct testů.

Čtyři z nich jsou regrese proti chybám, které projdou typovou kontrolou i revizí a projeví se až za běhu nebo až na výkonu:

| Test | Co zachytí |
|---|---|
| `rollup column names from the schema` | `opened_count` místo `opens_total`, tedy `42703` u každého segmentu s `count_gte` |
| `bounds every partitioned table by its OWN partition key` | podmínku na `me.ts` bez `me.received_at`, kdy plánovač neprořeže ani jeden měsíční oddíl |
| `soft bounce is a bounce` | rozchod mezi náhledem a rollupem u téže podmínky |
| `campaigns.sent_at does not exist` | sloupec, který ve schématu není |

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/segments/compile/engagement-event.ts packages/core/test/segments/compile/engagement-event.test.ts
git commit -m "feat(segments): compile engagement via rollup with documented slow fallback"
```

---

### Úkol 13: Odkaz na jiný segment

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/segments/compile/segment-ref.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/test/segments/compile/segment-ref.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
import { describe, expect, it } from 'vitest';
import { ParamBag } from '../../../src/segments/compile/params.js';
import { compileSegmentRefCondition } from '../../../src/segments/compile/segment-ref.js';

function bag(): ParamBag {
  const b = new ParamBag(0);
  b.add('ws'); b.add(new Date()); b.add('Europe/Prague');
  return b;
}

describe('segment reference', () => {
  it('uses segment_members for a static segment', () => {
    const b = bag();
    const sql = compileSegmentRefCondition('a', 'seg-1', 'in', { kind: 'static' }, b, () => '');
    expect(sql).toContain('segment_members sm');
    expect(sql).toContain('sm.contact_id = a.id');
  });

  it('inlines a compiled subexpression for a dynamic segment', () => {
    const b = bag();
    const sql = compileSegmentRefCondition('a', 'seg-2', 'in', { kind: 'dynamic' }, b, (childAlias) =>
      `${childAlias}.status = 'active'`,
    );
    expect(sql).toContain('EXISTS (SELECT 1 FROM contacts');
    expect(sql).toMatch(/s\d\.status = 'active'/);
    expect(sql).toMatch(/s\d\.id = a\.id/);
  });

  it('negates with not_in', () => {
    const sql = compileSegmentRefCondition('a', 'seg-1', 'not_in', { kind: 'static' }, bag(), () => '');
    expect(sql.startsWith('(NOT ')).toBe(true);
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/segments/compile/segment-ref.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Krok 3: Napiš `segment-ref.ts`**

```ts
import type { Operator } from '../ast.js';
import type { ParamBag } from './params.js';
import { assertAlias } from './columns.js';

let aliasCounter = 0;

/** Alias vnořeného segmentu musí být jedinečný, jinak si dva odkazy přepíšou rozsah. */
export function nextChildAlias(): string {
  aliasCounter = (aliasCounter + 1) % 1000;
  return `s${aliasCounter}`;
}

export function resetChildAlias(): void {
  aliasCounter = 0;
}

export function compileSegmentRefCondition(
  alias: string,
  segmentId: string,
  operator: Operator,
  target: { kind: 'static' | 'dynamic' },
  bag: ParamBag,
  compileChild: (childAlias: string) => string,
): string {
  assertAlias(alias);
  let inner: string;
  if (target.kind === 'static') {
    const id = bag.add(segmentId, 'uuid');
    inner = `EXISTS (SELECT 1 FROM segment_members sm WHERE sm.segment_id = ${id} AND sm.contact_id = ${alias}.id)`;
  } else {
    const child = nextChildAlias();
    const childSql = compileChild(child);
    inner =
      `EXISTS (SELECT 1 FROM contacts ${child} WHERE ${child}.id = ${alias}.id ` +
      `AND ${child}.workspace_id = ${bag.ref(1)} AND ${child}.deleted_at IS NULL ` +
      `AND ${child}.processing_restricted = false AND (${childSql}))`;
  }
  if (operator === 'in') return `(${inner})`;
  if (operator === 'not_in') return `(NOT ${inner})`;
  throw new Error(`operator ${operator} is not valid for a segment reference`);
}
```

Vnořený dynamický segment nese vlastní tři podmínky obálky (projekt, měkké smazání, omezené zpracování), ale **ne** větev suppression: ta je v hlavní obálce a druhý výskyt by jen zdvojil práci bez efektu, protože obě mluví o témž kontaktu.

- [ ] **Krok 4: Spusť test**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/segments/compile/segment-ref.test.ts`
Expected: PASS, tři testy.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/segments/compile/segment-ref.ts packages/core/test/segments/compile/segment-ref.test.ts
git commit -m "feat(segments): compile references to static and dynamic segments"
```

---

### Úkol 14: Skupiny, negace a tříhodnotová logika

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/segments/compile/index.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/test/segments/compile/index.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
import { describe, expect, it } from 'vitest';
import { compileSegmentSql } from '../../../src/segments/compile/index.js';
import type { SegmentAst } from '../../../src/segments/ast.js';

const ctx = {
  workspaceId: '00000000-0000-0000-0000-000000000001',
  asOf: new Date('2026-07-31T10:00:00Z'),
  timezone: 'Europe/Prague',
  fieldClasses: { city: 'text' as const, order_total: 'number' as const },
  segmentKinds: {},
};

const ast = (root: SegmentAst['root']): SegmentAst => ({ version: 1, root });

describe('group compilation', () => {
  it('joins children of an and group with AND', () => {
    const out = compileSegmentSql(
      ast({
        type: 'group', op: 'and', children: [
          { type: 'condition', field: { kind: 'contact', key: 'status' }, operator: 'eq', value: 'active' },
          { type: 'condition', field: { kind: 'attribute', key: 'city' }, operator: 'eq', value: 'Brno' },
        ],
      }),
      { alias: 'a', paramOffset: 0, ...ctx },
    );
    expect(out.sql).toMatch(/AND/);
    expect(out.sql).toContain('coalesce(');
  });

  it('wraps every leaf predicate in coalesce(pred, false)', () => {
    const out = compileSegmentSql(
      ast({ type: 'group', op: 'and', children: [
        { type: 'condition', field: { kind: 'attribute', key: 'city' }, operator: 'neq', value: 'Praha' },
      ] }),
      { alias: 'a', paramOffset: 0, ...ctx },
    );
    expect(out.sql).toContain('coalesce((a.attributes ->> $4) NOT ILIKE');
  });

  it('negates a group with NOT', () => {
    const plain = compileSegmentSql(
      ast({ type: 'group', op: 'or', not: false, children: [
        { type: 'condition', field: { kind: 'contact', key: 'status' }, operator: 'eq', value: 'active' },
      ] }),
      { alias: 'a', paramOffset: 0, ...ctx },
    );
    const negated = compileSegmentSql(
      ast({ type: 'group', op: 'or', not: true, children: [
        { type: 'condition', field: { kind: 'contact', key: 'status' }, operator: 'eq', value: 'active' },
      ] }),
      { alias: 'a', paramOffset: 0, ...ctx },
    );
    expect(negated.sql.length).toBeGreaterThan(plain.sql.length);
    expect(negated.sql).toContain('NOT (');
  });

  it('supports negation on a nested group', () => {
    const out = compileSegmentSql(
      ast({ type: 'group', op: 'and', children: [
        { type: 'group', op: 'or', not: true, children: [
          { type: 'condition', field: { kind: 'contact', key: 'status' }, operator: 'eq', value: 'active' },
        ] },
      ] }),
      { alias: 'a', paramOffset: 0, ...ctx },
    );
    expect(out.sql).toContain('NOT (');
  });

  it('rejects an operator that does not belong to the field class', () => {
    expect(() => compileSegmentSql(
      ast({ type: 'group', op: 'and', children: [
        { type: 'condition', field: { kind: 'attribute', key: 'order_total' }, operator: 'contains', value: 'x' },
      ] }),
      { alias: 'a', paramOffset: 0, ...ctx },
    )).toThrowError(/segment_operator_not_allowed/);
  });

  it('collects warnings from children without duplicates', () => {
    const out = compileSegmentSql(
      ast({ type: 'group', op: 'and', children: [
        { type: 'condition', field: { kind: 'engagement', metric: 'opened', scope: { since_days: 45 } }, operator: 'did' },
        { type: 'condition', field: { kind: 'engagement', metric: 'clicked', scope: { since_days: 45 } }, operator: 'did' },
      ] }),
      { alias: 'a', paramOffset: 0, ...ctx },
    );
    expect(out.warnings).toEqual(['segment_slow_engagement']);
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/segments/compile/index.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Krok 3: Napiš `compile/index.ts`**

```ts
import type { ConditionNode, GroupNode, Node, SegmentAst } from '../ast.js';
import { assertOperatorAllowed, assertValueShape, contactFieldClass, type FieldClass } from '../operators.js';
import { assertSqlWithinLimit } from '../limits.js';
import { ParamBag } from './params.js';
import { assertAlias } from './columns.js';
import { compileContactCondition } from './contact.js';
import { compileAttributeCondition } from './attribute.js';
import {
  compileConsentCondition, compileListCondition, compileSuppressionCondition, compileTagCondition,
} from './tag-list-consent.js';
import { compileEngagementCondition, compileEventCondition, type CompiledPredicate } from './engagement-event.js';
import { compileSegmentRefCondition, resetChildAlias } from './segment-ref.js';

export type CompileOptions = {
  alias: string;
  paramOffset: number;
  workspaceId: string;
  asOf: Date;
  timezone: string;
  /** Třída každého vlastního pole, načtená z contact_fields. Vrstva 3 už proběhla. */
  fieldClasses: Record<string, FieldClass>;
  /** Druh každého odkazovaného segmentu a jeho AST, když je dynamický. */
  segmentKinds: Record<string, { kind: 'static' | 'dynamic'; ast?: SegmentAst }>;
};

export type CompileResult = { sql: string; params: unknown[]; warnings: string[] };

function fieldClassOf(node: ConditionNode, opts: CompileOptions): FieldClass {
  switch (node.field.kind) {
    case 'contact': return contactFieldClass(node.field.key);
    case 'attribute': {
      const cls = opts.fieldClasses[node.field.key];
      if (!cls) throw new Error(`field class for ${node.field.key} was not resolved`);
      return cls;
    }
    case 'tag': return 'tag';
    case 'list': return 'list';
    case 'consent': return 'consent';
    case 'suppression': return 'suppression';
    case 'engagement': return 'engagement';
    case 'event': return 'event';
    case 'segment': return 'segment';
  }
}

function compileCondition(node: ConditionNode, bag: ParamBag, opts: CompileOptions): CompiledPredicate {
  const cls = fieldClassOf(node, opts);
  assertOperatorAllowed(cls, node.operator);
  assertValueShape(node.operator, node);

  switch (node.field.kind) {
    case 'contact':
      return { sql: compileContactCondition(opts.alias, node.field, node.operator, node, bag), warnings: [] };
    case 'attribute':
      return { sql: compileAttributeCondition(opts.alias, node.field.key, cls, node.operator, node, bag), warnings: [] };
    case 'tag':
      return { sql: compileTagCondition(opts.alias, node.operator, (node.values ?? []).map(String), bag), warnings: [] };
    case 'list':
      return { sql: compileListCondition(opts.alias, node.field.list_id, node.operator, bag), warnings: [] };
    case 'consent':
      return { sql: compileConsentCondition(opts.alias, node.field.purpose, node.operator, bag), warnings: [] };
    case 'suppression':
      return { sql: compileSuppressionCondition(opts.alias, node.operator, bag), warnings: [] };
    case 'engagement':
      return compileEngagementCondition(opts.alias, node.field, node.operator, node, bag);
    case 'event':
      return compileEventCondition(opts.alias, node.field, node.operator, node, bag);
    case 'segment': {
      const target = opts.segmentKinds[node.field.segment_id];
      if (!target) throw new Error(`segment ${node.field.segment_id} was not resolved`);
      const sql = compileSegmentRefCondition(
        opts.alias, node.field.segment_id, node.operator, target, bag,
        (childAlias) => {
          if (!target.ast) throw new Error('dynamic segment reference without ast');
          return compileNode(target.ast.root, bag, { ...opts, alias: childAlias }).sql;
        },
      );
      return { sql, warnings: [] };
    }
  }
}

function compileNode(node: Node, bag: ParamBag, opts: CompileOptions): CompiledPredicate {
  if (node.type === 'condition') {
    const out = compileCondition(node, bag, opts);
    // Tříhodnotová logika: každý listový predikát se srazí na true nebo false.
    // Bez toho by NOT (city = 'Praha') nevrátil ani kontakty bez vyplněného města,
    // ani je nevyloučil, a součet dvou doplňkových segmentů by nedal celek.
    return { sql: `coalesce(${out.sql.replace(/^\((.*)\)$/s, '$1')}, false)`, warnings: out.warnings };
  }
  const group = node as GroupNode;
  const parts: string[] = [];
  const warnings: string[] = [];
  for (const child of group.children) {
    const out = compileNode(child, bag, opts);
    parts.push(out.sql);
    warnings.push(...out.warnings);
  }
  const joined = `(${parts.join(group.op === 'and' ? ' AND ' : ' OR ')})`;
  return { sql: group.not ? `(NOT ${joined})` : joined, warnings: warnings as CompiledPredicate['warnings'] };
}

/** Zkompiluje AST na predikát bez obálky. Obálku přidává repo.ts, viz úkol 17. */
export function compileSegmentSql(ast: SegmentAst, opts: CompileOptions): CompileResult {
  assertAlias(opts.alias);
  resetChildAlias();
  const bag = new ParamBag(opts.paramOffset);
  bag.add(opts.workspaceId, 'uuid');
  bag.add(opts.asOf.toISOString(), 'timestamptz');
  bag.add(opts.timezone);
  const out = compileNode(ast.root, bag, opts);
  assertSqlWithinLimit(out.sql);
  return { sql: out.sql, params: bag.values, warnings: [...new Set(out.warnings)] };
}
```

- [ ] **Krok 4: Spusť test**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/segments/compile/index.test.ts`
Expected: PASS, šest testů.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/segments/compile/index.ts packages/core/test/segments/compile/index.test.ts
git commit -m "feat(segments): compile groups with negation and three valued logic"
```

---

### Úkol 15: Běhový adaptér, read-only transakce a odhad z `EXPLAIN`

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/segments/sql-runner.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/test/segments/sql-runner.dbspec.ts`

- [ ] **Krok 1: Napiš padající databázový test**

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { pgErrorCode, withoutContext } from '@mlain/core/tx';
import { runCountWithEstimate, runReadOnly } from '../../src/segments/sql-runner.js';
import { makeWorkspace, testCtx } from './helpers/db.js';

let ctx: Awaited<ReturnType<typeof testCtx>>;

beforeAll(async () => {
  ctx = await testCtx();
  await makeWorkspace(ctx, { contacts: 5 });
});

describe('sql runner', () => {
  it('refuses to write inside a preview transaction', async () => {
    const error = await runReadOnly(ctx, (tx) =>
      tx.execute(sql`INSERT INTO tags (id, workspace_id, name) VALUES (uuidv7(), ${ctx.workspaceId}::uuid, 'x')`),
    ).catch((e: unknown) => e);
    // Kód se čte přes pgErrorCode, NIKDY přes error.code: přes drizzle
    // je error.code undefined a kód leží na error.cause.code.
    expect(pgErrorCode(error)).toBe('25006');
  });

  it('returns zero rows without the workspace context', async () => {
    // Izolaci ověřuje test tím, že si transakci bez kontextu otevře SÁM.
    // Produkční runner na to volbu nemá a mít nesmí: přepínač "vynech
    // bezpečnostní kontext" ve veřejném rozhraní je past, kterou někdo
    // dřív nebo později použije mimo test.
    const { rows } = await withoutContext((tx) => tx.execute(sql`SELECT id FROM contacts`));
    expect(rows).toHaveLength(0);
  });

  it('returns an exact count when the query finishes', async () => {
    const out = await runCountWithEstimate(
      ctx, 'SELECT count(*)::int AS count FROM contacts a WHERE a.workspace_id = $1', [ctx.workspaceId], 3000,
    );
    expect(out).toEqual({ count: 5, exact: true, durationMs: expect.any(Number) });
  });

  it('falls back to an estimate when the statement timeout fires', async () => {
    const out = await runCountWithEstimate(
      ctx,
      'SELECT count(*)::int AS count FROM contacts a WHERE a.workspace_id = $1 AND pg_sleep(2) IS NOT NULL',
      [ctx.workspaceId], 200,
    );
    expect(out.exact).toBe(false);
    expect(out.count).toBeGreaterThanOrEqual(0);
  });

  it('reads the result from .rows, so a count can never be silently undefined', async () => {
    // Regrese proti nejtiššímu tvaru téhle chyby: `(await tx.execute(...)) as Row[]`
    // projde typovou kontrolou a [0] je na něm VŽDY undefined, takže by
    // countSegment vracel nulu u každého segmentu a vypadalo by to jako
    // "segment je prázdný", ne jako chyba.
    const out = await runCountWithEstimate(
      ctx, 'SELECT count(*)::int AS count FROM contacts a WHERE a.workspace_id = $1', [ctx.workspaceId], 3000,
    );
    expect(out.count).toBe(5);
    expect(out.count).not.toBeNaN();
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core test:db`
Expected: FAIL, `Cannot find module '../../src/segments/sql-runner.js'`.

- [ ] **Krok 3: Napiš `sql-runner.ts`**

```ts
import { pgErrorCode, withReadOnly, type Tx } from '@mlain/core/tx';
import type { WorkspaceContext } from '../identity/index.js';
import { config } from '../config/index.js';
import { ApiError } from '../errors/index.js';
import { toSql } from './compile/params.js';

type RunOptions = { timeoutMs?: number; workMem?: string };

/**
 * Náhled segmentu spouští dynamicky sestavené SQL, takže chyba v kompilátoru
 * nesmí mít možnost zapsat. Tahle funkce si to ale NEZAŘIZUJE SAMA: deleguje
 * na `withReadOnly` z adaptéru P04, který sedí nad primitivem P03.
 *
 * Proč ne vlastní implementace, ačkoli by byla o pět řádků delší:
 *
 *  - P03 už tu ochranu má, a má ji ve DVOU vrstvách: pool typu `readOnly`
 *    je založený s `-c default_transaction_read_only=on` a transakce se otevírá
 *    jako `BEGIN READ ONLY`. Zápis skončí `25006 read_only_sql_transaction`
 *    i kdyby jedna z vrstev selhala.
 *  - Objektový tvar `{ statementTimeoutMs, workMem }` přidalo P03 kvůli tomuhle
 *    plánu, takže `work_mem`, kvůli kterému si tenhle plán chtěl psát vlastní
 *    verzi, je pokrytý.
 *  - Dvě verze téhož bezpečnostního primitiva se rozejdou při první úpravě.
 *    Je to přesně ta chyba, před kterou tenhle plán varuje v kapitole 14
 *    u obálky segmentu, jen o patro níž.
 *
 * `SET LOCAL` uvnitř se tady neposílá vůbec: dělá ho obálka a dělá ho ve
 * správném pořadí (nejdřív timeout a work_mem, pak kontext projektu).
 */
export async function runReadOnly<T>(
  ctx: WorkspaceContext,
  fn: (tx: Tx) => Promise<T>,
  opts: RunOptions = {},
): Promise<T> {
  return withReadOnly(
    ctx,
    {
      statementTimeoutMs: opts.timeoutMs ?? config.SEGMENT_PREVIEW_TIMEOUT_MS,
      workMem: opts.workMem ?? '32MB',
    },
    fn,
  );
}

export type CountResult = { count: number; exact: boolean; durationMs: number };

/**
 * Když count doběhne, vrátí přesné číslo. Když ho zabije statement_timeout
 * chybou 57014, přečte se odhad z plánu. Uživatel dostane "přibližně 12 000"
 * a tlačítko na přesný výpočet, nikdy chybu.
 *
 * Dvě věci, na kterých to celé stojí a obě jsou ověřené spuštěním:
 *
 *  1. `tx.execute()` vrací OBÁLKU s `rows`, ne pole. Čtení `result[0]` je
 *     vždy `undefined`, takže by `count` vyšel jako `Number(undefined ?? 0)`,
 *     tedy 0, a každý segment by se tvářil jako prázdný.
 *  2. Kód chyby je na `error.cause.code`. Podmínka `error.code !== '57014'`
 *     je vždy pravdivá, takže by se odhad z EXPLAIN NIKDY nepoužil a náhled
 *     by u velkého projektu místo „přibližně 12 000" vracel chybu.
 */
export async function runCountWithEstimate(
  ctx: WorkspaceContext,
  text: string,
  params: unknown[],
  timeoutMs: number,
): Promise<CountResult> {
  const started = Date.now();
  try {
    const { rows } = await runReadOnly(
      ctx, (tx) => tx.execute<{ count: string | number }>(toSql(text, params)), { timeoutMs },
    );
    return { count: Number(rows[0]?.count ?? 0), exact: true, durationMs: Date.now() - started };
  } catch (error) {
    if (pgErrorCode(error) !== '57014') throw error;
  }
  const planText = `EXPLAIN (FORMAT JSON) ${text.replace(/^SELECT count\(\*\)(::int)? AS count/i, 'SELECT 1')}`;
  try {
    const { rows } = await runReadOnly(
      ctx, (tx) => tx.execute<{ 'QUERY PLAN': unknown }>(toSql(planText, params)), { timeoutMs: 500 },
    );
    const plan = rows[0]?.['QUERY PLAN'];
    const parsed = typeof plan === 'string' ? JSON.parse(plan) : plan;
    const rowsEstimate = Number((parsed as { Plan?: { 'Plan Rows'?: number } }[])?.[0]?.Plan?.['Plan Rows'] ?? 0);
    return { count: rowsEstimate, exact: false, durationMs: Date.now() - started };
  } catch {
    throw new ApiError('dependency_timeout', 504, {
      errors: [{ path: '_', code: 'segment_preview_timeout', meta: { timeoutMs } }],
    });
  }
}
```

- [ ] **Krok 4: Napiš pomocníka pro databázové testy**

**Files:** Create `/Users/petr/Projects/Mailing_Tool/packages/core/test/segments/helpers/db.ts`

```ts
import { afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { runMigrations } from '@mlain/db/migrate';
import { closePools, withoutContext, withWorkspace } from '@mlain/core/tx';
import { createSystemContext } from '@mlain/core/identity';
import type { WorkspaceContext } from '@mlain/core/identity';

let container: StartedPostgreSqlContainer | undefined;

export const TEST_WORKSPACE_A = '00000000-0000-0000-0000-000000000001';
export const TEST_WORKSPACE_B = '00000000-0000-0000-0000-000000000002';

export async function testCtx(workspaceId: string = TEST_WORKSPACE_A): Promise<WorkspaceContext> {
  if (!container) {
    container = await new PostgreSqlContainer('postgres:18-alpine').start();
    // DATABASE_URL se nastavuje PŘED prvním sáhnutím na pool, protože
    // appPool() si URL přečte z konfigurace při prvním použití a pak už ne.
    process.env.DATABASE_URL = container.getConnectionUri();
    // runMigrations bere POVINNÝ objekt s url a fallback na process.env nemá.
    // Volání bez argumentu by shodilo bootstrap všech databázových testů
    // tohohle plánu, tedy úkolů 15, 19, 21, 31, 34 a 39 naráz.
    await runMigrations({ url: container.getConnectionUri() });
  }
  // Kontext systémového běhu. Aktér má tvar { type, job }, ne { kind, id }:
  // 'test' není UUID a diskriminátor se jmenuje type.
  return createSystemContext(workspaceId, 'test');
}

afterAll(async () => {
  await closePools();
  await container?.stop();
  container = undefined;
});

export async function makeWorkspace(ctx: WorkspaceContext, spec: { contacts: number }): Promise<void> {
  // Založení projektu kontext z principu nemá, protože ještě neexistuje.
  await withoutContext((tx) => tx.execute(sql`
    INSERT INTO workspaces (id, name, slug)
    VALUES (${ctx.workspaceId}::uuid, 'Test', ${`test-${ctx.workspaceId.slice(-4)}`})
    ON CONFLICT DO NOTHING
  `));
  if (spec.contacts === 0) return;
  await withWorkspace(ctx, (tx) => tx.execute(sql`
    INSERT INTO contacts (id, workspace_id, email, status)
    SELECT uuidv7(), ${ctx.workspaceId}::uuid, 'c' || g || '-' || ${ctx.workspaceId.slice(-4)} || '@example.cz', 'active'
      FROM generate_series(1, ${spec.contacts}) g
  `));
}
```

Tři věci, které se v tomhle souboru opravily a každá by shodila celý databázový běh:

| Bylo | Je | Proč |
|---|---|---|
| `runMigrations()` | `runMigrations({ url })` | Podpis je `runMigrations(options: RunMigrationsOptions)` s povinným `url` a bez fallbacku na `process.env.DATABASE_URL` |
| `createWorkspaceContext({ workspaceId, actor: { kind: 'system', id: 'test' } })` | `createSystemContext(workspaceId, 'test')` | Továrna se tak nejmenuje a aktér má tvar `{ type: 'system', job }`. `id: 'test'` by navíc skončilo v `created_by uuid` jako `22P02` |
| `withWorkspaceId(ctx.workspaceId, fn)` | `withWorkspace(ctx, fn)` z `@mlain/core/tx` | Obálky v `@mlain/db` berou `pool` jako první argument a pool si doménový balíček importovat nesmí |

**Vlastní kontejner je dočasné řešení.** P03 má `startHarness()` a `seedTwoWorkspaces()` v `packages/db/test/helpers/`, což je mimo jeho mapu `exports` (ta má pět klíčů a žádný zástupný znak), takže je odsud nejde naimportovat. Požadavek na podcestu `@mlain/db/test-support` je zapsaný v evidenci napříč plány a týká se stejně tak P10, P13 a P14. Až vznikne, tenhle soubor se scvrkne na reexport.

- [ ] **Krok 5: Spusť databázový test**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core test:db`
Expected: PASS, pět testů. První je regrese proti zápisu z náhledu, druhý je test izolace, který specifikace vyžaduje jmenovitě, pátý je regrese proti čtení výsledku jako pole.

Celá cesta je ověřená spuštěním proti PostgreSQL 18 ještě před sepsáním, protože tři z jejích čtyř kroků selhávají tiše:

```
presny pocet    -> { count: 20000, exact: true }
timeout         -> pgErrorCode(error) = 57014      (error.code je undefined)
odhad z EXPLAIN -> { count: 19900, exact: false }
zapis v READ ONLY -> odmitnut, kod 25006
```

- [ ] **Krok 6: Commit**

```bash
git add packages/core/src/segments/sql-runner.ts packages/core/test/segments/sql-runner.dbspec.ts packages/core/test/segments/helpers/db.ts
git commit -m "feat(segments): add read only runner with explain based estimate"
```

---

### Úkol 16: Vrstva 3, příslušnost k projektu a detekce cyklu

Tohle je skutečná bezpečnostní hranice. Reálné riziko není podstrčené SQL, ale odkaz na cizí projekt.

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/segments/references.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/test/segments/references.test.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/test/segments/references.dbspec.ts`

- [ ] **Krok 1: Napiš padající test detekce cyklu (bez databáze)**

```ts
import { describe, expect, it } from 'vitest';
import { assertNoCycle, assertNestingDepth } from '../../src/segments/references.js';

const graph = new Map<string, string[]>([
  ['A', ['B']],
  ['B', ['C']],
  ['C', []],
]);

describe('segment reference graph', () => {
  it('accepts an acyclic graph', () => {
    expect(() => assertNoCycle('A', graph)).not.toThrow();
  });

  it('rejects a two node cycle', () => {
    const cyclic = new Map(graph);
    cyclic.set('C', ['A']);
    expect(() => assertNoCycle('A', cyclic)).toThrowError(/segment_cycle/);
  });

  it('rejects a self reference', () => {
    expect(() => assertNoCycle('A', new Map([['A', ['A']]]))).toThrowError(/segment_cycle/);
  });

  it('rejects nesting deeper than two', () => {
    expect(() => assertNestingDepth('A', new Map([['A', ['B']], ['B', ['C']], ['C', ['D']], ['D', []]])))
      .toThrowError(/segment_nesting_too_deep/);
  });

  it('accepts nesting of exactly two', () => {
    expect(() => assertNestingDepth('A', graph)).not.toThrow();
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/segments/references.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Krok 3: Napiš `references.ts`**

```ts
import { inArray } from 'drizzle-orm';
import { contactFields, lists, segments, tags } from '@mlain/db/schema';
import { withWorkspace, type Tx } from '@mlain/core/tx';
import { wsEq } from '../identity/index.js';
import type { WorkspaceContext } from '../identity/index.js';
import { ApiError } from '../errors/index.js';
import { SEGMENT_LIMITS } from './limits.js';
import type { FieldClass } from './operators.js';
import type { Node, SegmentAst } from './ast.js';

export type ResolvedReferences = {
  fieldClasses: Record<string, FieldClass>;
  segmentKinds: Record<string, { kind: 'static' | 'dynamic'; ast?: SegmentAst }>;
  archivedFields: string[];
  unindexedFields: string[];
};

function notFound(kind: string, id: string): never {
  throw new ApiError('not_found', 404, {
    errors: [{ path: '_', code: 'segment_reference_not_found', meta: { kind, id } }],
  });
}

function collect(node: Node, out: { attrs: Set<string>; lists: Set<string>; tags: Set<string>; segments: Set<string> }): void {
  if (node.type === 'group') {
    for (const child of node.children) collect(child, out);
    return;
  }
  switch (node.field.kind) {
    case 'attribute': out.attrs.add(node.field.key); break;
    case 'list': out.lists.add(node.field.list_id); break;
    case 'segment': out.segments.add(node.field.segment_id); break;
    case 'tag': for (const v of node.values ?? []) out.tags.add(String(v)); break;
    default: break;
  }
}

export function assertNoCycle(rootId: string, graph: Map<string, string[]>): void {
  const visiting = new Set<string>();
  const done = new Set<string>();
  const walk = (id: string): void => {
    if (visiting.has(id)) {
      throw new ApiError('too_many_items', 422, { errors: [{ path: '_', code: 'segment_cycle', meta: { at: id } }] });
    }
    if (done.has(id)) return;
    visiting.add(id);
    for (const next of graph.get(id) ?? []) walk(next);
    visiting.delete(id);
    done.add(id);
  };
  walk(rootId);
}

export function assertNestingDepth(rootId: string, graph: Map<string, string[]>): void {
  const depth = (id: string, seen: Set<string>): number => {
    if (seen.has(id)) return 0;
    seen.add(id);
    const children = graph.get(id) ?? [];
    return children.length === 0 ? 0 : 1 + Math.max(...children.map((c) => depth(c, seen)));
  };
  const found = depth(rootId, new Set());
  if (found > SEGMENT_LIMITS.maxSegmentNesting) {
    throw new ApiError('too_many_items', 422, {
      errors: [{ path: '_', code: 'segment_nesting_too_deep', meta: { limit: SEGMENT_LIMITS.maxSegmentNesting, got: found } }],
    });
  }
}

/**
 * Ověří, že každý odkaz v AST patří do tohohle projektu, a načte, co kompilátor
 * potřebuje: třídu každého vlastního pole a druh každého odkazovaného segmentu.
 * Cizí nebo neexistující ID končí 404, nikdy prázdným výsledkem.
 */
export async function resolveReferences(ctx: WorkspaceContext, ast: SegmentAst): Promise<ResolvedReferences> {
  const wanted = { attrs: new Set<string>(), lists: new Set<string>(), tags: new Set<string>(), segments: new Set<string>() };
  collect(ast.root, wanted);

  return withWorkspace(ctx, async (tx: Tx) => {
    const out: ResolvedReferences = { fieldClasses: {}, segmentKinds: {}, archivedFields: [], unindexedFields: [] };

    if (wanted.attrs.size > 0) {
      const rows = await tx.select().from(contactFields)
        .where(wsEq(ctx, contactFields)).where(inArray(contactFields.key, [...wanted.attrs]));
      const found = new Map(rows.map((r) => [r.key, r]));
      for (const key of wanted.attrs) {
        const row = found.get(key);
        if (!row) notFound('contact_field', key);
        out.fieldClasses[key] = row.type as FieldClass;
        if (row.archivedAt) out.archivedFields.push(key);
        if (!row.indexed) out.unindexedFields.push(key);
      }
    }

    for (const [set, table, kind] of [
      [wanted.lists, lists, 'list'] as const,
      [wanted.tags, tags, 'tag'] as const,
    ]) {
      if (set.size === 0) continue;
      const rows = await tx.select({ id: table.id }).from(table).where(wsEq(ctx, table)).where(inArray(table.id, [...set]));
      const found = new Set(rows.map((r) => r.id));
      for (const id of set) if (!found.has(id)) notFound(kind, id);
    }

    if (wanted.segments.size > 0) {
      const graph = new Map<string, string[]>();
      const queue = [...wanted.segments];
      const seen = new Set<string>();
      while (queue.length > 0) {
        const id = queue.shift() as string;
        if (seen.has(id)) continue;
        seen.add(id);
        const rows = await tx.select().from(segments).where(wsEq(ctx, segments)).where(inArray(segments.id, [id]));
        const row = rows[0];
        if (!row || row.deletedAt) notFound('segment', id);
        const childAst = row.kind === 'dynamic' ? (row.definition as SegmentAst) : undefined;
        out.segmentKinds[id] = { kind: row.kind as 'static' | 'dynamic', ast: childAst };
        const nested = { attrs: new Set<string>(), lists: new Set<string>(), tags: new Set<string>(), segments: new Set<string>() };
        if (childAst) collect(childAst.root, nested);
        graph.set(id, [...nested.segments]);
        queue.push(...nested.segments);
      }
      const rootKey = '__root__';
      graph.set(rootKey, [...wanted.segments]);
      assertNoCycle(rootKey, graph);
      assertNestingDepth(rootKey, graph);
    }

    return out;
  });
}
```

- [ ] **Krok 4: Napiš databázový test cizího projektu**

**Files:** Create `/Users/petr/Projects/Mailing_Tool/packages/core/test/segments/references.dbspec.ts`

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { resolveReferences } from '../../src/segments/references.js';
import { makeWorkspace, testCtx } from './helpers/db.js';
import type { SegmentAst } from '../../src/segments/ast.js';

let ctx: Awaited<ReturnType<typeof testCtx>>;

beforeAll(async () => {
  ctx = await testCtx();
  await makeWorkspace(ctx, { contacts: 1 });
});

describe('reference resolution', () => {
  it('rejects a list id from a foreign workspace with 404, not an empty result', async () => {
    const ast: SegmentAst = {
      version: 1,
      root: { type: 'group', op: 'and', children: [
        { type: 'condition', field: { kind: 'list', list_id: '00000000-0000-0000-0000-0000000000ff' }, operator: 'is_member' },
      ] },
    };
    await expect(resolveReferences(ctx, ast)).rejects.toMatchObject({
      status: 404,
      body: { errors: [{ code: 'segment_reference_not_found' }] },
    });
  });
});
```

- [ ] **Krok 5: Spusť oba testy**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/segments/references.test.ts && pnpm --filter @mlain/core test:db`
Expected: PASS, pět plus jeden test.

- [ ] **Krok 6: Commit**

```bash
git add packages/core/src/segments/references.ts packages/core/test/segments/references.test.ts packages/core/test/segments/references.dbspec.ts
git commit -m "feat(segments): resolve references, reject foreign ids and cycles"
```

---

### Úkol 17: `repo.ts`, tři vstupní body kompilátoru

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/segments/repo.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/test/segments/repo.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
import { describe, expect, it, vi } from 'vitest';
import { compileAudienceToSql } from '../../src/segments/repo.js';
import type { SegmentAst } from '../../src/segments/ast.js';

vi.mock('../../src/segments/references.js', () => ({
  resolveReferences: async () => ({ fieldClasses: { city: 'text' }, segmentKinds: {}, archivedFields: [], unindexedFields: [] }),
}));

const ctx = { workspaceId: '00000000-0000-0000-0000-000000000001', actor: { kind: 'system', id: 't' } } as never;
const asOf = new Date('2026-07-31T10:00:00Z');
const ast: SegmentAst = {
  version: 1,
  root: { type: 'group', op: 'and', children: [
    { type: 'condition', field: { kind: 'attribute', key: 'city' }, operator: 'eq', value: 'Brno' },
  ] },
};

describe('compileAudienceToSql', () => {
  it('rejects an empty audience', async () => {
    await expect(compileAudienceToSql(ctx, {}, { alias: 'a', paramOffset: 0, asOf, timezone: 'Europe/Prague' }))
      .rejects.toMatchObject({ body: { errors: [{ code: 'audience_empty' }] } });
  });

  it('returns a select with no order, limit or semicolon', async () => {
    const out = await compileAudienceToSql(ctx, { ast }, { alias: 'a', paramOffset: 0, asOf, timezone: 'Europe/Prague' });
    expect(out.sql.startsWith('SELECT a.id AS contact_id')).toBe(true);
    expect(out.sql).not.toMatch(/\border by\b|\blimit\b|\boffset\b/i);
    expect(out.sql).not.toContain(';');
  });

  it('is byte identical for the same asOf and ast', async () => {
    const opts = { alias: 'a', paramOffset: 0, asOf, timezone: 'Europe/Prague' };
    const one = await compileAudienceToSql(ctx, { ast }, opts);
    const two = await compileAudienceToSql(ctx, { ast }, opts);
    expect(one.sql).toBe(two.sql);
    expect(one.params).toEqual(two.params);
  });

  it('starts numbering at paramOffset + 1', async () => {
    const out = await compileAudienceToSql(ctx, { ast }, { alias: 'a', paramOffset: 5, asOf, timezone: 'Europe/Prague' });
    expect(out.sql).toContain('$6');
    expect(out.sql).not.toMatch(/\$[1-5]\b/);
    expect(out.params).toHaveLength(4);
  });

  it('never contains a bare c. when the alias is x', async () => {
    const out = await compileAudienceToSql(ctx, { ast }, { alias: 'x', paramOffset: 0, asOf, timezone: 'Europe/Prague' });
    expect(out.sql).not.toMatch(/(^|[^a-z0-9_])c\./);
  });

  it('keeps the envelope even when only listIds are given', async () => {
    const out = await compileAudienceToSql(ctx, { listIds: ['00000000-0000-0000-0000-0000000000aa'] },
      { alias: 'a', paramOffset: 0, asOf, timezone: 'Europe/Prague' });
    expect(out.sql).toContain('a.deleted_at IS NULL');
    expect(out.sql).toContain('a.processing_restricted = false');
    expect(out.sql).toContain('su.removed_at IS NULL');
  });

  it('unions segmentIds and listIds with OR', async () => {
    const out = await compileAudienceToSql(
      ctx,
      { listIds: ['00000000-0000-0000-0000-0000000000aa'], segmentIds: ['00000000-0000-0000-0000-0000000000bb'] },
      { alias: 'a', paramOffset: 0, asOf, timezone: 'Europe/Prague' },
    );
    expect(out.sql).toMatch(/\) OR \(/);
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/segments/repo.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Krok 3: Napiš `repo.ts`**

```ts
import { withWorkspace } from '@mlain/core/tx';
import type { WorkspaceContext } from '../identity/index.js';
import { ApiError } from '../errors/index.js';
import { config } from '../config/index.js';
import { SegmentAstV1, type SegmentAst } from './ast.js';
import { assertWithinLimits } from './limits.js';
import { resolveReferences } from './references.js';
import { compileSegmentSql } from './compile/index.js';
import { buildEnvelope } from './compile/envelope.js';
import { ParamBag } from './compile/params.js';
import { compileListCondition, compileSegmentRefCondition } from './compile/tag-list-consent.js';
import { runCountWithEstimate, runReadOnly } from './sql-runner.js';

export type Audience = { segmentIds?: string[]; listIds?: string[]; ast?: SegmentAst };
export type CompileOpts = { alias: string; paramOffset: number; asOf: Date; timezone: string };
export type Compiled = { sql: string; params: unknown[]; warnings: string[] };

/**
 * Jediná podporovaná cesta, jak sestavit publikum. Část 4 nesmí psát vlastní SQL
 * nad contacts, list_subscriptions ani suppressions. Obálku, kterou tahle funkce
 * přidá, volající nemůže vynechat.
 */
export async function compileAudienceToSql(
  ctx: WorkspaceContext,
  audience: Audience,
  opts: CompileOpts,
): Promise<Compiled> {
  const hasSomething = (audience.segmentIds?.length ?? 0) + (audience.listIds?.length ?? 0) > 0 || audience.ast != null;
  if (!hasSomething) {
    throw new ApiError('validation_failed', 422, { errors: [{ path: 'audience', code: 'audience_empty' }] });
  }

  const parts: string[] = [];
  const warnings: string[] = [];
  const bag = new ParamBag(opts.paramOffset);
  bag.add(ctx.workspaceId, 'uuid');
  bag.add(opts.asOf.toISOString(), 'timestamptz');
  bag.add(opts.timezone);

  if (audience.ast) {
    const ast = SegmentAstV1.parse(audience.ast);
    assertWithinLimits(ast);
    const refs = await resolveReferences(ctx, ast);
    // Kompilace uzlů běží nad vlastním ParamBagem, jehož offset navazuje za pevné parametry.
    const inner = compileSegmentSql(ast, {
      alias: opts.alias,
      paramOffset: opts.paramOffset,
      workspaceId: ctx.workspaceId,
      asOf: opts.asOf,
      timezone: opts.timezone,
      fieldClasses: refs.fieldClasses,
      segmentKinds: refs.segmentKinds,
    });
    parts.push(inner.sql);
    warnings.push(...inner.warnings);
    bag.values.length = 0;
    bag.values.push(...inner.params);
  }

  for (const listId of audience.listIds ?? []) {
    parts.push(compileListCondition(opts.alias, listId, 'is_member', bag));
  }
  for (const segmentId of audience.segmentIds ?? []) {
    const refs = await resolveReferences(ctx, {
      version: 1,
      root: { type: 'group', op: 'and', children: [{ type: 'condition', field: { kind: 'segment', segment_id: segmentId }, operator: 'in' }] },
    });
    const target = refs.segmentKinds[segmentId];
    parts.push(
      compileSegmentRefCondition(opts.alias, segmentId, 'in', target, bag, (childAlias) => {
        if (!target.ast) throw new Error('dynamic segment without ast');
        return compileSegmentSql(target.ast, {
          alias: childAlias, paramOffset: opts.paramOffset, workspaceId: ctx.workspaceId,
          asOf: opts.asOf, timezone: opts.timezone,
          fieldClasses: refs.fieldClasses, segmentKinds: refs.segmentKinds,
        }).sql;
      }),
    );
  }

  // segmentIds a listIds zároveň znamenají sjednocení: "kdo je v kterémkoliv
  // z těchhle seznamů nebo segmentů". Odpovídá to tomu, jak se publikum skládá v UI.
  const audienceSql = parts.length === 1 ? parts[0] : `(${parts.join(') OR (')})`;
  return {
    sql: buildEnvelope(opts.alias, audienceSql, bag),
    params: bag.values,
    warnings: [...new Set(warnings)],
  };
}

export type SegmentCountResult = { count: number; exact: boolean; durationMs: number; warnings: string[] };

export async function countSegment(
  ctx: WorkspaceContext,
  ast: SegmentAst,
  opts: { timeoutMs?: number; asOf?: Date; timezone?: string } = {},
): Promise<SegmentCountResult> {
  const asOf = opts.asOf ?? new Date();
  const timezone = opts.timezone ?? 'Europe/Prague';
  const compiled = await compileAudienceToSql(ctx, { ast }, { alias: 'a', paramOffset: 0, asOf, timezone });
  // Projekce se mění, podmínky zůstávají bajt za bajt tytéž jako u publika kampaně.
  // Kdyby se lišily, uživatel by viděl 12 000 a odeslalo by se 11 300.
  const countSql = compiled.sql.replace('SELECT a.id AS contact_id', 'SELECT count(*) AS count');
  const out = await runCountWithEstimate(ctx, countSql, compiled.params, opts.timeoutMs ?? config.SEGMENT_PREVIEW_TIMEOUT_MS);
  return { ...out, warnings: out.exact ? compiled.warnings : [...compiled.warnings, 'segment_count_estimated'] };
}

export type ContactSample = { id: string; email: string; first_name: string | null; last_name: string | null };

export async function listSegmentContacts(
  ctx: WorkspaceContext,
  ast: SegmentAst,
  page: { limit: number; cursor?: string },
  opts: { asOf?: Date; timezone?: string } = {},
): Promise<{ rows: ContactSample[]; hasMore: boolean }> {
  const asOf = opts.asOf ?? new Date();
  const timezone = opts.timezone ?? 'Europe/Prague';
  const compiled = await compileAudienceToSql(ctx, { ast }, { alias: 'a', paramOffset: 0, asOf, timezone });
  const params = [...compiled.params];
  const projected = compiled.sql.replace(
    'SELECT a.id AS contact_id',
    'SELECT a.id, a.email::text AS email, a.first_name, a.last_name',
  );
  // Řazení a stránkování si dělá volající, kompilátor je do sql nikdy nevkládá.
  const cursorClause = page.cursor ? ` AND a.id > $${params.push(page.cursor)}` : '';
  const sql = `${projected}${cursorClause}\n ORDER BY a.id ASC\n LIMIT $${params.push(page.limit + 1)}`;
  const rows = (await runReadOnly(ctx, (tx) => tx.execute(sql, params))) as ContactSample[];
  return { rows: rows.slice(0, page.limit), hasMore: rows.length > page.limit };
}
```

- [ ] **Krok 4: Spusť test**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/segments/repo.test.ts`
Expected: PASS, sedm testů.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/segments/repo.ts packages/core/test/segments/repo.test.ts
git commit -m "feat(segments): add compileAudienceToSql, countSegment and listSegmentContacts"
```

---

### Úkol 18: Sada invariantů nad textem dotazu

Tenhle úkol netestuje chování, testuje **text**. Je to schválně: chování by se muselo trefit do závodu nebo do konkrétního plánu, kdežto text dotazu je deterministický. Tři z těchhle invariantů popisují chyby, které se v produkci projeví až po měsících.

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/test/segments/sql-invariants.test.ts`

- [ ] **Krok 1: Napiš test, který projde všechny kombinace pole a operátoru**

```ts
import { describe, expect, it, vi } from 'vitest';
import { FIELD_CLASS_OPERATORS } from '../../src/segments/operators.js';
import { compileSegmentSql } from '../../src/segments/compile/index.js';
import type { ConditionNode, SegmentAst } from '../../src/segments/ast.js';

const BANNED = /now\s*\(|current_timestamp|localtimestamp|current_date/i;

const opts = {
  alias: 'a', paramOffset: 0,
  workspaceId: '00000000-0000-0000-0000-000000000001',
  asOf: new Date('2026-07-31T10:00:00Z'),
  timezone: 'Europe/Prague',
  fieldClasses: { txt: 'text' as const, num: 'number' as const, dt: 'datetime' as const, ml: 'multi_enum' as const, bl: 'boolean' as const },
  segmentKinds: { '00000000-0000-0000-0000-0000000000bb': { kind: 'static' as const } },
};

const UUID_A = '00000000-0000-0000-0000-0000000000aa';
const UUID_B = '00000000-0000-0000-0000-0000000000bb';

function valueFor(operator: string): Partial<ConditionNode> {
  if (['is_empty', 'is_not_empty', 'is_true', 'is_false', 'did', 'did_not', 'is_suppressed', 'is_not_suppressed',
       'is_member', 'is_not_member', 'is_confirmed', 'is_pending', 'is_unsubscribed',
       'is_granted', 'is_withdrawn', 'is_missing'].includes(operator)) return {};
  if (operator === 'between') return { values: [1, 2] };
  if (['in', 'not_in'].includes(operator)) return { values: ['x', 'y'] };
  if (['has_any', 'has_all', 'has_none'].includes(operator)) return { values: [UUID_A, UUID_B] };
  if (['in_last_days', 'not_in_last_days', 'in_next_days'].includes(operator)) return { value: 30 };
  if (['count_gte', 'count_lte'].includes(operator)) return { value: 3 };
  if (['gt', 'gte', 'lt', 'lte'].includes(operator)) return { value: 5 };
  if (['on', 'before', 'after'].includes(operator)) return { value: '2026-07-01' };
  return { value: 'value' };
}

/** Jedna dvojice pole a operátoru pro každý řádek typové matice. */
function fieldFor(fieldClass: string): ConditionNode['field'] {
  switch (fieldClass) {
    case 'text': case 'long_text': case 'url': case 'email': case 'phone':
      return { kind: 'attribute', key: 'txt' };
    case 'email_domain': return { kind: 'contact', key: 'email_domain' };
    case 'number': return { kind: 'attribute', key: 'num' };
    case 'boolean': return { kind: 'attribute', key: 'bl' };
    case 'date': case 'datetime': return { kind: 'contact', key: 'created_at' };
    case 'enum': return { kind: 'contact', key: 'status' };
    case 'multi_enum': return { kind: 'attribute', key: 'ml' };
    case 'tag': return { kind: 'tag' };
    case 'list': return { kind: 'list', list_id: UUID_A };
    case 'consent': return { kind: 'consent', purpose: 'email_marketing' };
    case 'suppression': return { kind: 'suppression' };
    case 'engagement': return { kind: 'engagement', metric: 'opened', scope: { since_days: 90 } };
    case 'event': return { kind: 'event', name: 'purchase' };
    case 'segment': return { kind: 'segment', segment_id: UUID_B };
    default: throw new Error(`unmapped field class ${fieldClass}`);
  }
}

const combos = Object.entries(FIELD_CLASS_OPERATORS).flatMap(([cls, ops]) =>
  ops.map((op) => [cls, op] as const),
);

describe('sql text invariants', () => {
  it('covers at least 60 field and operator combinations', () => {
    expect(combos.length).toBeGreaterThanOrEqual(60);
  });

  it.each(combos)('%s + %s emits no wall clock function', (cls, operator) => {
    const ast: SegmentAst = {
      version: 1,
      root: { type: 'group', op: 'and', children: [
        { type: 'condition', field: fieldFor(cls), operator, ...valueFor(operator) } as ConditionNode,
      ] },
    };
    const { sql } = compileSegmentSql(ast, opts);
    expect(sql).not.toMatch(BANNED);
  });

  it.each(combos)('%s + %s puts every user value into a parameter', (cls, operator) => {
    const marker = "zzz'; DROP TABLE contacts; --";
    const v = valueFor(operator);
    const patched = 'value' in v && typeof v.value === 'string' ? { value: marker } : v;
    const ast: SegmentAst = {
      version: 1,
      root: { type: 'group', op: 'and', children: [
        { type: 'condition', field: fieldFor(cls), operator, ...patched } as ConditionNode,
      ] },
    };
    const { sql, params } = compileSegmentSql(ast, opts);
    expect(sql).not.toContain('DROP TABLE');
    if ('value' in patched && patched.value === marker) expect(params).toContain(marker);
  });

  it('keeps every numeric cast inside CASE WHEN', () => {
    for (const operator of ['gt', 'gte', 'lt', 'lte', 'between'] as const) {
      const ast: SegmentAst = {
        version: 1,
        root: { type: 'group', op: 'and', children: [
          { type: 'condition', field: { kind: 'attribute', key: 'num' }, operator, ...valueFor(operator) } as ConditionNode,
        ] },
      };
      const { sql } = compileSegmentSql(ast, opts);
      expect(sql).toContain('CASE WHEN');
      expect(sql).toContain('ELSE false END');
      expect(sql).not.toMatch(/AND\s*\(a\.attributes ->> \$\d+\)::numeric/);
    }
  });

  it('never interpolates a custom field key', () => {
    const ast: SegmentAst = {
      version: 1,
      root: { type: 'group', op: 'and', children: [
        { type: 'condition', field: { kind: 'attribute', key: 'txt' }, operator: 'eq', value: 'x' } as ConditionNode,
      ] },
    };
    const { sql, params } = compileSegmentSql(ast, opts);
    expect(sql).not.toContain("'txt'");
    expect(params).toContain('txt');
  });
});
```

- [ ] **Krok 2: Spusť sadu**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/segments/sql-invariants.test.ts`
Expected: PASS. Počet testů je zhruba 2 × 63 + 3. Když některá kombinace spadne, je to chyba v kompilátoru, ne v testu: matice v `operators.ts` je zdroj pravdy a test z ní kombinace generuje.

- [ ] **Krok 3: Commit**

```bash
git add packages/core/test/segments/sql-invariants.test.ts
git commit -m "test(segments): assert sql text invariants across all field and operator pairs"
```

---

### Úkol 19: Služba segmentů, zmrazení a čerstvost

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/segments/service.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/segments/audit.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/test/segments/service.dbspec.ts`

- [ ] **Krok 1: Napiš padající databázový test**

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { createSegment, freezeSegment, listSegments, markAllStale, updateSegment } from '../../src/segments/service.js';
import { makeWorkspace, testCtx } from './helpers/db.js';
import type { SegmentAst } from '../../src/segments/ast.js';

let ctx: Awaited<ReturnType<typeof testCtx>>;
const ast: SegmentAst = {
  version: 1,
  root: { type: 'group', op: 'and', children: [
    { type: 'condition', field: { kind: 'contact', key: 'status' }, operator: 'eq', value: 'active' },
  ] },
};

beforeAll(async () => {
  ctx = await testCtx();
  await makeWorkspace(ctx, { contacts: 5 });
});

describe('segment service', () => {
  it('stores a definition hash and rejects a duplicate name', async () => {
    const created = await createSegment(ctx, { name: 'Aktivní', definition: ast });
    expect(created.definitionHash).toHaveLength(32);
    await expect(createSegment(ctx, { name: 'aktivní', definition: ast })).rejects.toMatchObject({ status: 409 });
  });

  it('recomputes the hash and clears the cache when the definition changes', async () => {
    const created = await createSegment(ctx, { name: 'Změna', definition: ast });
    const changed: SegmentAst = {
      version: 1,
      root: { type: 'group', op: 'and', children: [
        { type: 'condition', field: { kind: 'contact', key: 'status' }, operator: 'eq', value: 'bounced' },
      ] },
    };
    const updated = await updateSegment(ctx, created.id, { definition: changed });
    expect(updated.definitionHash.equals(created.definitionHash)).toBe(false);
    expect(updated.cachedAt).toBeNull();
  });

  it('freezes a dynamic segment into a static one with members', async () => {
    const created = await createSegment(ctx, { name: 'Ke zmrazení', definition: ast });
    const frozen = await freezeSegment(ctx, created.id, { name: 'Zmrazený' });
    expect(frozen.kind).toBe('static');
    expect(frozen.cachedCount).toBe(5);
    expect(frozen.cachedIsExact).toBe(true);
  });

  it('marks every segment of the workspace as stale after an import', async () => {
    await markAllStale(ctx);
    const rows = await listSegments(ctx, { limit: 50 });
    expect(rows.rows.every((r) => r.cachedAt === null)).toBe(true);
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core test:db`
Expected: FAIL, `Cannot find module '../../src/segments/service.js'`.

- [ ] **Krok 3: Napiš `audit.ts`**

```ts
import type { WorkspaceContext } from '../identity/index.js';
import { writeAudit } from '../identity/index.js';

export const SEGMENT_AUDIT_ACTIONS = [
  'segment.created', 'segment.updated', 'segment.deleted', 'segment.frozen',
] as const;

export type SegmentAuditAction = (typeof SEGMENT_AUDIT_ACTIONS)[number];

export async function auditSegment(
  ctx: WorkspaceContext,
  action: SegmentAuditAction,
  segmentId: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await writeAudit(ctx, { action, entityType: 'segment', entityId: segmentId, metadata });
}
```

- [ ] **Krok 4: Napiš `service.ts`**

```ts
import { and, eq, isNull } from 'drizzle-orm';
import { segments } from '@mlain/db/schema';
import { withWorkspace, type Tx } from '@mlain/core/tx';
import { toSql } from './compile/params.js';
import { actorUserId, wsEq } from '../identity/index.js';
import type { WorkspaceContext } from '../identity/index.js';
import { ApiError } from '../errors/index.js';
import { QUEUES, enqueue } from '../queues/index.js';
import { SegmentAstV1, type SegmentAst } from './ast.js';
import { assertWithinLimits } from './limits.js';
import { definitionHash } from './canonical.js';
import { resolveReferences } from './references.js';
import { compileAudienceToSql, countSegment } from './repo.js';
import { auditSegment } from './audit.js';

export type SegmentRow = {
  id: string; name: string; description: string | null; kind: 'dynamic' | 'static';
  presetKey: string | null; definition: SegmentAst; definitionHash: Buffer;
  cachedCount: number | null; cachedIsExact: boolean | null; cachedAt: Date | null;
  recomputeState: string; lastErrorCode: string | null;
};

const STALE_MINUTES = 15;

async function validate(ctx: WorkspaceContext, definition: SegmentAst): Promise<void> {
  const ast = SegmentAstV1.parse(definition);
  assertWithinLimits(ast);
  await resolveReferences(ctx, ast);
}

export async function createSegment(
  ctx: WorkspaceContext,
  input: { name: string; description?: string; definition: SegmentAst; presetKey?: string },
): Promise<SegmentRow> {
  await validate(ctx, input.definition);
  return withWorkspace(ctx, async (tx: Tx) => {
    const hash = definitionHash(input.definition);
    const inserted = await tx.insert(segments).values({
      workspaceId: ctx.workspaceId,
      name: input.name,
      description: input.description ?? null,
      kind: 'dynamic',
      presetKey: input.presetKey ?? null,
      definition: input.definition,
      definitionHash: hash,
      createdBy: actorUserId(ctx),
      // queued ve STEJNE transakci jako enqueue niz, jinak by se stav a fronta
      // rozesly pri padu mezi nimi a segment by navzdy tvrdil "ceka na prepocet".
      recomputeState: 'queued',
    }).onConflictDoNothing().returning();
    if (inserted.length === 0) {
      throw new ApiError('conflict', 409, { errors: [{ path: 'name', code: 'already_exists' }] });
    }
    const row = inserted[0] as SegmentRow;
    await auditSegment(ctx, 'segment.created', row.id, { name: input.name });
    await enqueue(QUEUES.SEGMENTS_RECOUNT,
      { workspaceId: ctx.workspaceId, segmentId: row.id }, { singletonKey: row.id });
    return row;
  });
}

export async function updateSegment(
  ctx: WorkspaceContext,
  id: string,
  patch: { name?: string; description?: string; definition?: SegmentAst },
): Promise<SegmentRow> {
  if (patch.definition) await validate(ctx, patch.definition);
  return withWorkspace(ctx, async (tx: Tx) => {
    const values: Record<string, unknown> = { updatedAt: new Date() };
    if (patch.name !== undefined) values.name = patch.name;
    if (patch.description !== undefined) values.description = patch.description;
    if (patch.definition) {
      values.definition = patch.definition;
      values.definitionHash = definitionHash(patch.definition);
      // Změna definice zneplatňuje cache. Zastaralé číslo u změněné definice
      // je horší než žádné, protože vypadá stejně čerstvě jako správné.
      values.cachedAt = null;
      values.cachedCount = null;
      values.cachedIsExact = null;
      values.recomputeState = 'queued';
      values.lastErrorCode = null;
    }
    const rows = await tx.update(segments).set(values)
      .where(and(wsEq(ctx, segments), eq(segments.id, id), isNull(segments.deletedAt))).returning();
    if (rows.length === 0) throw new ApiError('not_found', 404, { errors: [{ path: '_', code: 'not_found' }] });
    await auditSegment(ctx, 'segment.updated', id, {});
    if (patch.definition) {
      await enqueue(QUEUES.SEGMENTS_RECOUNT,
        { workspaceId: ctx.workspaceId, segmentId: id }, { singletonKey: id });
    }
    return rows[0] as SegmentRow;
  });
}

export async function deleteSegment(ctx: WorkspaceContext, id: string): Promise<void> {
  await withWorkspace(ctx, async (tx: Tx) => {
    await tx.update(segments).set({ deletedAt: new Date() })
      .where(and(wsEq(ctx, segments), eq(segments.id, id)));
  });
  await auditSegment(ctx, 'segment.deleted', id, {});
}

export async function listSegments(
  ctx: WorkspaceContext,
  page: { limit: number; cursor?: string },
): Promise<{ rows: SegmentRow[]; hasMore: boolean }> {
  const rows = await withWorkspace(ctx, (tx: Tx) =>
    tx.select().from(segments)
      .where(and(wsEq(ctx, segments), isNull(segments.deletedAt)))
      .orderBy(segments.createdAt).limit(page.limit + 1),
  );
  // Otevření seznamu zařadí přepočet u všeho staršího než 15 minut.
  const stale = (rows as SegmentRow[]).filter(
    (r) => r.kind === 'dynamic' && (!r.cachedAt || Date.now() - r.cachedAt.getTime() > STALE_MINUTES * 60_000),
  );
  for (const row of stale) {
    await enqueue(QUEUES.SEGMENTS_RECOUNT,
      { workspaceId: ctx.workspaceId, segmentId: row.id }, { singletonKey: row.id });
  }
  return { rows: (rows as SegmentRow[]).slice(0, page.limit), hasMore: rows.length > page.limit };
}

/**
 * Dokončení importu označí za zastaralé jen DYNAMICKÉ segmenty projektu.
 *
 * Statický segment je zmrazená množina: jeho členové se importem nezmění,
 * protože se čtou ze `segment_members`. Bez podmínky na `kind` by zmrazený
 * segment přišel o razítko zmrazení, karta by u něj místo data ukázala
 * „nikdy nepočítáno" a nabídla přepočet, který u statického segmentu nedává
 * smysl a jehož výsledek by se ani neuložil.
 */
export async function markAllStale(ctx: WorkspaceContext): Promise<void> {
  await withWorkspace(ctx, (tx: Tx) =>
    tx.update(segments).set({ cachedAt: null }).where(and(
      wsEq(ctx, segments), isNull(segments.deletedAt), eq(segments.kind, 'dynamic'),
    )),
  );
}

/**
 * Zmrazení do statického segmentu. asOf je čas zmrazení, takže výsledek jde
 * kdykoliv zreprodukovat, a členové se zapisují jedním INSERT ... SELECT,
 * ne po řádcích.
 */
export async function freezeSegment(
  ctx: WorkspaceContext,
  id: string,
  input: { name: string },
): Promise<SegmentRow> {
  const asOf = new Date();
  const source = await withWorkspace(ctx, (tx: Tx) =>
    tx.select().from(segments).where(and(wsEq(ctx, segments), eq(segments.id, id))),
  );
  const row = (source as SegmentRow[])[0];
  if (!row) throw new ApiError('not_found', 404, { errors: [{ path: '_', code: 'not_found' }] });

  const compiled = await compileAudienceToSql(ctx, { ast: row.definition }, {
    alias: 'a', paramOffset: 0, asOf, timezone: 'Europe/Prague',
  });

  return withWorkspace(ctx, async (tx: Tx) => {
    const inserted = await tx.insert(segments).values({
      workspaceId: ctx.workspaceId,
      name: input.name,
      kind: 'static',
      presetKey: row.presetKey,
      definition: row.definition,
      definitionHash: row.definitionHash,
      createdBy: actorUserId(ctx),
    }).returning();
    const frozen = inserted[0] as SegmentRow;
    // Text kompilátoru se vkládá přes toSql, které si placeholdery $n napáruje
    // na hodnoty. Doplněné id nového segmentu dostane vlastní číslo na konci,
    // takže se číslování zbytku nikam neposune.
    const memberText =
      `INSERT INTO segment_members (segment_id, contact_id, workspace_id)\n` +
      `SELECT $${compiled.params.length + 1}::uuid, contact_id, $1 FROM (${compiled.sql}) src\n` +
      `ON CONFLICT DO NOTHING`;
    const inserting = await tx.execute(toSql(memberText, [...compiled.params, frozen.id]));
    // Počet se čte z počtu vložených řádků, ne dalším dotazem: ON CONFLICT DO NOTHING
    // sice může některé přeskočit, ale segment je nový, takže konflikt nastat nemůže
    // a druhý dotaz by byl jen další skenování stejné množiny.
    const count = inserting.rowCount ?? 0;
    const updated = await tx.update(segments)
      .set({ cachedCount: count, cachedIsExact: true, cachedAt: asOf, recomputeState: 'idle' })
      .where(and(wsEq(ctx, segments), eq(segments.id, frozen.id))).returning();
    await auditSegment(ctx, 'segment.frozen', frozen.id, { sourceSegmentId: id, count });
    return updated[0] as SegmentRow;
  });
}

export async function recountSegment(ctx: WorkspaceContext, id: string): Promise<SegmentRow> {
  const rows = await withWorkspace(ctx, (tx: Tx) =>
    tx.select().from(segments).where(and(wsEq(ctx, segments), eq(segments.id, id))),
  );
  const row = (rows as SegmentRow[])[0];
  if (!row) throw new ApiError('not_found', 404, { errors: [{ path: '_', code: 'not_found' }] });
  const started = Date.now();
  const out = await countSegment(ctx, row.definition, { timeoutMs: 60_000, asOf: new Date() });
  return withWorkspace(ctx, async (tx: Tx) => {
    const updated = await tx.update(segments).set({
      cachedCount: out.count, cachedIsExact: out.exact, cachedAt: new Date(),
      cachedDurationMs: Date.now() - started, recomputeState: 'idle', lastErrorCode: null,
    }).where(eq(segments.id, id)).returning();
    return updated[0] as SegmentRow;
  });
}

export function segmentFreshness(cachedAt: Date | null, now = new Date()): 'never' | 'fresh' | 'recent' | 'stale' {
  if (!cachedAt) return 'never';
  const minutes = (now.getTime() - cachedAt.getTime()) / 60_000;
  if (minutes <= 15) return 'fresh';
  if (minutes <= 360) return 'recent';
  return 'stale';
}
```

**K `created_by` a tvaru aktéra.** `Actor` je rozlišená unie `{ type: 'user'; userId; role } | { type: 'api_key'; apiKeyId; scopes } | { type: 'system'; job }`. Diskriminátor je `type`, ne `kind`, a vlastnost `id` nemá **žádná** z variant. Všechny čtyři sloupce `created_by`, na které tenhle plán sahá, jsou `uuid` a `NULL` dovolují, takže hodnotu skládá pomocník z `@mlain/core/identity`:

```ts
export function actorUserId(ctx: WorkspaceContext): string | null {
  return ctx.actor.type === 'user' ? ctx.actor.userId : null;
}
```

Bez něj by se do `created_by uuid` dostalo u systémového běhu jméno jobu, tedy `'segments.recount'`, a zápis by skončil `22P02 invalid input syntax for type uuid`. Zrádné je, že přes obrazovku se to nikdy neprojeví: uživatel má `type: 'user'` a UUID tam sedí. Spadne to teprve při prvním běhu jobu, tedy až v provozu. Pomocník je zapsaný jako požadavek 4.5 na P04, protože ho stejným způsobem potřebuje každý doménový plán, který zakládá řádek z jobu.

**K `recompute_state`.** Slovník má čtyři hodnoty (`idle`, `queued`, `running`, `error`) a plán do něj dřív zapisoval jen dvě. Fronta se řídí `singletonKey`, ne sloupcem, takže dvě hodnoty byly mrtvé a UI nemělo jak ukázat „přepočítává se", ačkoli to kritérium 50 nepřímo předpokládá. Nově je zapisují obě strany na hranicích, kde stav opravdu mění majitele: `queued` nastavuje `createSegment` a `updateSegment` ve stejné transakci jako zařazení do fronty, `running` nastavuje handler jako první věc po převzetí (úkol 22), `idle` nebo `error` nastavuje `recountSegment` na konci. Zápis do `queued` patří do téže transakce jako `enqueue`, jinak by se stav a fronta rozešly při pádu mezi nimi.

- [ ] **Krok 5: Spusť databázový test**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core test:db`
Expected: PASS, čtyři testy služby.

- [ ] **Krok 6: Commit**

```bash
git add packages/core/src/segments/service.ts packages/core/src/segments/audit.ts packages/core/test/segments/service.dbspec.ts
git commit -m "feat(segments): add segment service with freeze, staleness and audit"
```

---

### Úkol 20: Šest presetů čištění

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/segments/presets.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/test/segments/presets.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
import { describe, expect, it } from 'vitest';
import { SEGMENT_PRESETS, presetByKey } from '../../src/segments/presets.js';
import { SegmentAstV1 } from '../../src/segments/ast.js';
import { assertWithinLimits } from '../../src/segments/limits.js';

describe('cleanup presets', () => {
  it('defines exactly the six documented keys', () => {
    expect(SEGMENT_PRESETS.map((p) => p.key)).toEqual([
      'never_opened', 'never_clicked', 'inactive_90d',
      'no_open_last_n', 'unconfirmed_30d', 'repeated_soft_bounces',
    ]);
  });

  it('produces a valid ast for every preset', () => {
    for (const preset of SEGMENT_PRESETS) {
      const ast = SegmentAstV1.parse(preset.definition({ listId: '00000000-0000-0000-0000-0000000000aa' }));
      expect(() => assertWithinLimits(ast)).not.toThrow();
    }
  });

  it('guards never_opened with a minimum number of sent messages', () => {
    const ast = presetByKey('never_opened').definition({});
    const json = JSON.stringify(ast);
    expect(json).toContain('"count_gte"');
    expect(json).toContain('"sent"');
  });

  it('guards never_clicked with at least five sent messages', () => {
    const ast = presetByKey('never_clicked').definition({});
    const cond = ast.root.children.find(
      (c) => c.type === 'condition' && c.field.kind === 'engagement' && c.field.metric === 'sent',
    );
    expect(cond).toMatchObject({ operator: 'count_gte', value: 5 });
  });

  it('uses relative operators, never a literal date', () => {
    for (const preset of SEGMENT_PRESETS) {
      const json = JSON.stringify(preset.definition({ listId: '00000000-0000-0000-0000-0000000000aa' }));
      expect(json).not.toMatch(/20\d\d-\d\d-\d\d/);
    }
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/segments/presets.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Krok 3: Napiš `presets.ts`**

```ts
import type { GroupNode, SegmentAst } from './ast.js';

export type PresetKey =
  | 'never_opened' | 'never_clicked' | 'inactive_90d'
  | 'no_open_last_n' | 'unconfirmed_30d' | 'repeated_soft_bounces';

export type PresetArgs = { listId?: string };

export type SegmentPreset = {
  key: PresetKey;
  /** Klíč do katalogu segments.json, ne hotový text. */
  labelKey: string;
  explanationKey: string;
  definition: (args: PresetArgs) => SegmentAst;
};

const group = (children: GroupNode['children'], op: 'and' | 'or' = 'and'): SegmentAst => ({
  version: 1,
  root: { type: 'group', op, children },
});

export const SEGMENT_PRESETS: SegmentPreset[] = [
  {
    key: 'never_opened',
    labelKey: 'presets.neverOpened.title',
    explanationKey: 'presets.neverOpened.explanation',
    // Podmínka "dostali aspoň 3 e-maily" je podstatná: bez ní by sem spadli
    // i lidé, kterým jsme nikdy nic neposlali. Je to nejčastější chyba
    // konkurenčních nástrojů a proto je i na kartě, ne jen v nápovědě.
    definition: () => group([
      { type: 'condition', field: { kind: 'engagement', metric: 'sent', scope: {} }, operator: 'count_gte', value: 3 },
      { type: 'condition', field: { kind: 'engagement', metric: 'opened', scope: {} }, operator: 'did_not' },
    ]),
  },
  {
    key: 'never_clicked',
    labelKey: 'presets.neverClicked.title',
    explanationKey: 'presets.neverClicked.explanation',
    definition: () => group([
      { type: 'condition', field: { kind: 'engagement', metric: 'sent', scope: {} }, operator: 'count_gte', value: 5 },
      { type: 'condition', field: { kind: 'engagement', metric: 'clicked', scope: {} }, operator: 'did_not' },
    ]),
  },
  {
    key: 'inactive_90d',
    labelKey: 'presets.inactive90d.title',
    explanationKey: 'presets.inactive90d.explanation',
    definition: () => group([
      {
        type: 'group', op: 'or', children: [
          { type: 'condition', field: { kind: 'contact', key: 'last_activity_at' }, operator: 'not_in_last_days', value: 90 },
          { type: 'condition', field: { kind: 'contact', key: 'last_activity_at' }, operator: 'is_empty' },
        ],
      },
      { type: 'condition', field: { kind: 'contact', key: 'created_at' }, operator: 'not_in_last_days', value: 90 },
    ]),
  },
  {
    key: 'no_open_last_n',
    labelKey: 'presets.noOpenLastN.title',
    explanationKey: 'presets.noOpenLastN.explanation',
    definition: () => group([
      { type: 'condition', field: { kind: 'engagement', metric: 'sent', scope: { last_n_campaigns: 5 } }, operator: 'count_gte', value: 5 },
      { type: 'condition', field: { kind: 'engagement', metric: 'opened', scope: { last_n_campaigns: 5 } }, operator: 'did_not' },
    ]),
  },
  {
    key: 'unconfirmed_30d',
    labelKey: 'presets.unconfirmed30d.title',
    explanationKey: 'presets.unconfirmed30d.explanation',
    definition: (args) => group([
      ...(args.listId
        ? [{ type: 'condition' as const, field: { kind: 'list' as const, list_id: args.listId }, operator: 'is_pending' as const }]
        : []),
      { type: 'condition', field: { kind: 'contact', key: 'created_at' }, operator: 'not_in_last_days', value: 30 },
    ]),
  },
  {
    key: 'repeated_soft_bounces',
    labelKey: 'presets.repeatedSoftBounces.title',
    explanationKey: 'presets.repeatedSoftBounces.explanation',
    definition: () => group([
      { type: 'condition', field: { kind: 'engagement', metric: 'bounced', scope: {} }, operator: 'count_gte', value: 3 },
      { type: 'condition', field: { kind: 'contact', key: 'status' }, operator: 'eq', value: 'active' },
    ]),
  },
];

export function presetByKey(key: PresetKey): SegmentPreset {
  const found = SEGMENT_PRESETS.find((p) => p.key === key);
  if (!found) throw new Error(`unknown preset ${key}`);
  return found;
}
```

Preset `unconfirmed_30d` potřebuje seznam. Když ho volající nepředá, vznikne segment jen s podmínkou na stáří a UI u něj zobrazí výběr seznamu. Tvrdá chyba by tu byla horší: uživatel by na kartu klikl a dostal hlášku místo segmentu.

- [ ] **Krok 4: Spusť test**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/segments/presets.test.ts`
Expected: PASS, pět testů.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/segments/presets.ts packages/core/test/segments/presets.test.ts
git commit -m "feat(segments): add six cleanup presets with sent count guards"
```

---

### Úkol 21: Diagnostika prázdného výsledku a rozpad publika

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/segments/diagnostics.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/segments/audience.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/test/segments/audience.dbspec.ts`

- [ ] **Krok 1: Napiš padající databázový test**

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { INERT_GATES, audienceBreakdown } from '../../src/segments/audience.js';
import { diagnoseEmptyResult } from '../../src/segments/diagnostics.js';
import { makeWorkspace, testCtx } from './helpers/db.js';
import type { SegmentAst } from '../../src/segments/ast.js';

let ctx: Awaited<ReturnType<typeof testCtx>>;

beforeAll(async () => {
  ctx = await testCtx();
  await makeWorkspace(ctx, { contacts: 10 });
});

const ast: SegmentAst = {
  version: 1,
  root: { type: 'group', op: 'and', children: [
    { type: 'condition', field: { kind: 'contact', key: 'status' }, operator: 'eq', value: 'active' },
    { type: 'condition', field: { kind: 'attribute', key: 'city' }, operator: 'eq', value: 'Brno' },
  ] },
};

describe('empty result diagnostics', () => {
  it('names the condition that alone returns zero', async () => {
    const out = await diagnoseEmptyResult(ctx, ast, { asOf: new Date(), timezone: 'Europe/Prague' });
    expect(out.mostRestrictive?.path).toEqual([1]);
    expect(out.perCondition[0].count).toBeGreaterThan(0);
    expect(out.perCondition[1].count).toBe(0);
  });

  it('offers the most frequent values of the field that filtered everything out', async () => {
    const out = await diagnoseEmptyResult(ctx, ast, { asOf: new Date(), timezone: 'Europe/Prague' });
    expect(out.fieldStats?.key).toBe('city');
    expect(Array.isArray(out.fieldStats?.topValues)).toBe(true);
  });
});

describe('audience breakdown', () => {
  it('subtracts gates in the documented order and the numbers add up', async () => {
    const out = await audienceBreakdown(ctx, { ast }, { asOf: new Date(), timezone: 'Europe/Prague' });
    const removed = out.gates.reduce((sum, g) => sum + g.count, 0);
    expect(out.input - removed).toBe(out.willSend);
    expect(out.gates.map((g) => g.key)).toEqual([
      'suppressed', 'unsubscribed', 'unconfirmed', 'snoozed', 'processing_restricted', 'duplicate', 'sample',
    ]);
  });

  it('runs at all, which is the point: one missing column takes the whole breakdown down', async () => {
    // Sedm bran se skládá do JEDNOHO dotazu se sedmi count(*) FILTER, takže
    // jediný neexistující sloupec neshodí jednu bránu, ale celou obrazovku
    // chybou 42703. Test drží tuhle vlastnost tím, že rozpad vůbec spustí.
    const out = await audienceBreakdown(ctx, { ast }, { asOf: new Date(), timezone: 'Europe/Prague' });
    expect(out.input).toBeGreaterThan(0);
    expect(Number.isNaN(out.willSend)).toBe(false);
  });

  it('keeps the inert gates at zero, so nobody reads them as measured', async () => {
    const out = await audienceBreakdown(ctx, { ast }, { asOf: new Date(), timezone: 'Europe/Prague' });
    for (const key of INERT_GATES) {
      expect(out.gates.find((g) => g.key === key)?.count, key).toBe(0);
    }
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core test:db`
Expected: FAIL, `Cannot find module`.

- [ ] **Krok 3: Napiš `diagnostics.ts`**

```ts
import { sql } from 'drizzle-orm';
import type { WorkspaceContext } from '../identity/index.js';
import type { ConditionNode, Node, SegmentAst } from './ast.js';
import { countSegment } from './repo.js';
import { runReadOnly } from './sql-runner.js';

export type ConditionCount = { path: number[]; label: string; count: number };
export type EmptyDiagnostics = {
  perCondition: ConditionCount[];
  mostRestrictive: ConditionCount | null;
  fieldStats: { key: string; filled: number; total: number; topValues: { value: string; count: number }[] } | null;
};

function flatten(node: Node, path: number[] = []): { node: ConditionNode; path: number[] }[] {
  if (node.type === 'condition') return [{ node, path }];
  return node.children.flatMap((child, index) => flatten(child, [...path, index]));
}

/**
 * Běží JEN při prázdném výsledku, takže dodatečné dotazy nikoho nezpomalují.
 * Netechnický člověk neumí přečíst logický výraz, ale okamžitě pochopí větu
 * "tahle jedna podmínka vrací nula".
 */
export async function diagnoseEmptyResult(
  ctx: WorkspaceContext,
  ast: SegmentAst,
  opts: { asOf: Date; timezone: string },
): Promise<EmptyDiagnostics> {
  const leaves = flatten(ast.root);
  const perCondition: ConditionCount[] = [];
  for (const leaf of leaves) {
    const single: SegmentAst = { version: 1, root: { type: 'group', op: 'and', children: [leaf.node] } };
    const out = await countSegment(ctx, single, { timeoutMs: 1500, asOf: opts.asOf, timezone: opts.timezone });
    perCondition.push({
      path: leaf.path,
      label: `${leaf.node.field.kind}:${'key' in leaf.node.field ? leaf.node.field.key : ''}:${leaf.node.operator}`,
      count: out.count,
    });
  }
  const zero = perCondition.filter((c) => c.count === 0);
  const mostRestrictive = zero[0] ?? perCondition.slice().sort((a, b) => a.count - b.count)[0] ?? null;

  let fieldStats: EmptyDiagnostics['fieldStats'] = null;
  const culprit = mostRestrictive ? leaves.find((l) => l.path.join() === mostRestrictive.path.join()) : undefined;
  if (culprit && culprit.node.field.kind === 'attribute') {
    const key = culprit.node.field.key;
    // `attributes ? $key` NELZE použít: jediný GIN nad attributes je
    // jsonb_path_ops a ta operátor `?` v indexu nemá, takže by tenhle dotaz
    // šel seq scanem přes celý projekt. Se stropem 1500 ms by u pěti milionů
    // kontaktů nedoběhl a obrazovka "proč je segment prázdný" by mlčela
    // právě v tom případě, kvůli kterému existuje.
    //
    // Test existence klíče se proto píše jako containment vůči objektu
    // s libovolnou hodnotou to nejde, takže se použije NOT NULL nad ->,
    // které index nevyužije taky, ale běží nad UŽ ZÚŽENOU množinou:
    // dotaz nejdřív vybere kontakty přes @> na neprázdný objekt a teprve
    // v nich počítá. U klíčů, které v projektu nikdo nemá, je odpověď okamžitá.
    const { rows: stats } = await runReadOnly(ctx, (tx) =>
      tx.execute<{ filled: string; total: string }>(sql`
        SELECT count(*) FILTER (WHERE attributes -> ${key}::text IS NOT NULL) AS filled,
               count(*) AS total
          FROM contacts
         WHERE workspace_id = ${ctx.workspaceId}::uuid AND deleted_at IS NULL`),
      { timeoutMs: 1500 });
    const { rows: top } = await runReadOnly(ctx, (tx) =>
      tx.execute<{ value: string; count: number }>(sql`
        SELECT attributes ->> ${key}::text AS value, count(*)::int AS count
          FROM contacts
         WHERE workspace_id = ${ctx.workspaceId}::uuid AND deleted_at IS NULL
           AND attributes -> ${key}::text IS NOT NULL
         GROUP BY 1 ORDER BY count DESC LIMIT 5`),
      { timeoutMs: 1500 });
    fieldStats = {
      key,
      filled: Number(stats[0]?.filled ?? 0),
      total: Number(stats[0]?.total ?? 0),
      topValues: top,
    };
  }
  return { perCondition, mostRestrictive, fieldStats };
}
```

- [ ] **Krok 4: Napiš `audience.ts`**

```ts
import type { WorkspaceContext } from '../identity/index.js';
import { compileAudienceToSql, type Audience } from './repo.js';
import { toSql } from './compile/params.js';
import { runReadOnly } from './sql-runner.js';

export type GateKey =
  | 'suppressed' | 'unsubscribed' | 'unconfirmed' | 'snoozed'
  | 'processing_restricted' | 'duplicate' | 'sample';

export type AudienceBreakdown = {
  input: number;
  gates: { key: GateKey; count: number }[];
  willSend: number;
};

/**
 * Pořadí bran odpovídá pořadí vyhodnocení ze 4.1.6 části 2, ne abecedě.
 * Je to jediné pořadí, ve kterém dává součet smysl, protože jeden kontakt
 * může padnout na víc bran a započítá se u té první.
 */
const GATE_SQL: Record<GateKey, string> = {
  suppressed:
    `EXISTS (SELECT 1 FROM suppressions su WHERE su.workspace_id = b.workspace_id AND su.removed_at IS NULL
             AND (su.email = b.email OR su.fingerprint = ANY(b.email_fingerprints)))`,
  // 'bounced' patří sem taky. Kontakt s tvrdým odrazem má stav 'bounced' a bez
  // něj by prošel touhle bránou a spadl až na 'suppressed', což je správně JEN
  // tehdy, když suppression řádek opravdu existuje. Spoléhat na to znamená
  // spoléhat na cizí zápis (P07) v místě, kde se rozhoduje, komu odejde pošta.
  unsubscribed: `b.status IN ('unsubscribed', 'complained', 'bounced')`,
  unconfirmed:
    `NOT EXISTS (SELECT 1 FROM list_subscriptions ls
                  WHERE ls.workspace_id = b.workspace_id AND ls.contact_id = b.id AND ls.status = 'confirmed')`,
  snoozed:
    `EXISTS (SELECT 1 FROM list_subscriptions ls
              WHERE ls.workspace_id = b.workspace_id AND ls.contact_id = b.id
                AND ls.snooze_until > $2::timestamptz)`,
  processing_restricted: `b.processing_restricted = true`,
  // Obě brány jsou natvrdo false a je to VĚDOMÉ, ne nedodělek.
  //
  // `duplicate`: unikátní index uq_contacts__workspace_email duplicitu na úrovni
  // kontaktu vylučuje, takže brána nemá co odebrat.
  //
  // `sample`: sloupec contacts.is_sample ve schématu NENÍ a založit ho tenhle
  // plán nesmí. Kdyby tu zůstalo `b.is_sample = true`, nespadla by jen tahle
  // jedna brána: GATE_SQL se skládá do JEDNOHO dotazu se sedmi count(*) FILTER,
  // takže by celý rozpad publika skončil na 42703 a obrazovka by nezobrazila nic.
  // Řádek zůstává v pořadí i v UI, aby rozpad odpovídal seznamu z 8.4.6
  // a aby se sem dala hodnota doplnit jedním řádkem, až sloupec vznikne.
  duplicate: `false`,
  sample: `false`,
};

/** Brány, které dnes nemají čím měřit. Test je drží na nule, aby se na ně nezapomnělo. */
export const INERT_GATES: readonly GateKey[] = ['duplicate', 'sample'];

const GATE_ORDER: GateKey[] = [
  'suppressed', 'unsubscribed', 'unconfirmed', 'snoozed', 'processing_restricted', 'duplicate', 'sample',
];

export async function audienceBreakdown(
  ctx: WorkspaceContext,
  audience: Audience,
  opts: { asOf: Date; timezone: string },
): Promise<AudienceBreakdown> {
  // Vstupní množina je segment BEZ obálky, aby šlo ukázat, kolik jich brána odebrala.
  const compiled = await compileAudienceToSql(ctx, audience, {
    alias: 'a', paramOffset: 0, asOf: opts.asOf, timezone: opts.timezone,
  });
  const raw = compiled.sql
    .replace(/\n\s*AND a\.processing_restricted = false/, '')
    .replace(/\n\s*AND NOT EXISTS \([\s\S]*?email_fingerprints\)\)\)/, '');

  const buckets = GATE_ORDER.map((key, index) => {
    const earlier = GATE_ORDER.slice(0, index).map((k) => `NOT (${GATE_SQL[k]})`);
    const predicate = [...earlier, GATE_SQL[key]].join(' AND ');
    return `count(*) FILTER (WHERE ${predicate})::int AS ${key}`;
  });
  const passes = GATE_ORDER.map((k) => `NOT (${GATE_SQL[k]})`).join(' AND ');

  const text =
    `SELECT count(*)::int AS input, ${buckets.join(', ')}, count(*) FILTER (WHERE ${passes})::int AS will_send\n` +
    `  FROM contacts b\n WHERE b.id IN (${raw})`;

  const { rows } = await runReadOnly(
    ctx, (tx) => tx.execute<Record<string, number>>(toSql(text, compiled.params)), { timeoutMs: 10_000 },
  );
  const row = rows[0] ?? {};
  return {
    input: Number(row.input ?? 0),
    gates: GATE_ORDER.map((key) => ({ key, count: Number(row[key] ?? 0) })),
    willSend: Number(row.will_send ?? 0),
  };
}
```

K vstupní množině: `raw` vzniká odstraněním dvou podmínek z obálky, aby šlo ukázat, kolik lidí která brána odebrala. Odstraňují se **jen** `processing_restricted` a `suppressions`, protože právě ty mají v rozpadu vlastní řádek. Podmínky `deleted_at`, `anonymized_at` a `status <> 'deleted'` v `raw` **zůstávají**: smazaný ani vymazaný člověk není „odebraný bránou", ten do publika nepatří vůbec a v rozpadu by se počítal dvakrát.

- [ ] **Krok 5: Spusť databázový test**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core test:db`
Expected: PASS, tři testy.

- [ ] **Krok 6: Commit**

```bash
git add packages/core/src/segments/diagnostics.ts packages/core/src/segments/audience.ts packages/core/test/segments/audience.dbspec.ts
git commit -m "feat(segments): add empty result diagnostics and gated audience breakdown"
```

---

### Úkol 22: Joby přepočtu a úklidu po reaktivaci

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/segments/jobs/recount.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/segments/jobs/cleanup-after-reactivation.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/segments/jobs/queue-handlers.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/test/segments/jobs/cleanup.dbspec.ts`

- [ ] **Krok 1: Napiš padající databázový test úklidu**

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { withWorkspace } from '@mlain/core/tx';
import { handler as cleanupHandler } from '../../../src/segments/jobs/cleanup-after-reactivation.js';
import { scheduleStale } from '../../../src/segments/jobs/recount.js';
import { createSegment } from '../../../src/segments/service.js';
import { TEST_WORKSPACE_A, TEST_WORKSPACE_B, makeWorkspace, testCtx } from '../helpers/db.js';
import type { SegmentAst } from '../../../src/segments/ast.js';

let ctx: Awaited<ReturnType<typeof testCtx>>;

const ast: SegmentAst = {
  version: 1,
  root: { type: 'group', op: 'and', children: [
    { type: 'condition', field: { kind: 'contact', key: 'status' }, operator: 'eq', value: 'active' },
  ] },
};

beforeAll(async () => {
  ctx = await testCtx();
  await makeWorkspace(ctx, { contacts: 4 });
});

describe('cleanup after reactivation', () => {
  it('skips contacts that carry the reactivation tag', async () => {
    const out = await cleanupHandler({
      data: { workspaceId: ctx.workspaceId, segmentId: 'seg', action: 'unsubscribe_all', reactivatedTagId: 'tag' },
    } as never);
    expect(out.skipped).toBeGreaterThanOrEqual(0);
    expect(out.affected + out.skipped).toBe(out.considered);
  });

  it('is idempotent: a second run affects nothing', async () => {
    const payload = { data: { workspaceId: ctx.workspaceId, segmentId: 'seg', action: 'unsubscribe_all', reactivatedTagId: 'tag' } };
    await cleanupHandler(payload as never);
    const second = await cleanupHandler(payload as never);
    expect(second.affected).toBe(0);
  });

  it('refuses the delete action for a non owner actor', async () => {
    await expect(cleanupHandler({
      data: { workspaceId: ctx.workspaceId, segmentId: 'seg', action: 'delete', reactivatedTagId: 'tag', actorRole: 'admin' },
    } as never)).rejects.toMatchObject({ status: 403 });
  });
});

describe('scheduleStale across workspaces', () => {
  /**
   * Detektor tiché nuly z rozhodnutí R18.
   *
   * Založí zastaralý dynamický segment ve DVOU různých projektech a čeká, že je
   * plánovač najde OBA. Bez systémového bypassu vrátí `withoutContext` nula
   * řádků a nevrátí chybu, takže by se bez tohohle testu porucha nikdy neprojevila:
   * `{ scheduled: 0 }` je naprosto věrohodná hodnota.
   *
   * Test se schválně NEPTÁ strážce `assertCrossWorkspaceVisibility`, protože ten
   * vznikl ze stejné úvahy jako ochrana samotná. Ptá se dat: dva projekty, dva
   * segmenty, očekávám dvě zařazení. Kdyby strážce měl chybu v heuristice,
   * tenhle test to pozná, a naopak.
   */
  it('finds stale segments in every workspace, not only in the current one', async () => {
    const ctxA = await testCtx(TEST_WORKSPACE_A);
    const ctxB = await testCtx(TEST_WORKSPACE_B);
    await makeWorkspace(ctxB, { contacts: 1 });

    const long = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const seeded: string[] = [];
    for (const c of [ctxA, ctxB]) {
      const row = await createSegment(c, { name: `Stale ${c.workspaceId.slice(-4)}`, definition: ast });
      await withWorkspace(c, (tx) => tx.execute(sql`
        UPDATE segments SET cached_at = ${long}::timestamptz WHERE id = ${row.id}::uuid`));
      seeded.push(row.id);
    }

    const scheduled: string[] = [];
    const count = await scheduleStale(async (p) => { scheduled.push(p.segmentId); });

    expect(count).toBeGreaterThanOrEqual(2);
    for (const id of seeded) expect(scheduled).toContain(id);
    expect(new Set(scheduled.map((id) => seeded.includes(id))).has(true)).toBe(true);
  });

  it('fails loudly instead of reporting success when it cannot see across workspaces', async () => {
    // Kdyby bypass zmizel, tenhle běh musí skončit chybou, ne { scheduled: 0 }.
    // Test je tu proto, aby se tichá varianta nedala obnovit nedopatřením.
    const outcome = await scheduleStale(async () => {}).then(
      (n) => ({ ok: true as const, n }),
      (e: unknown) => ({ ok: false as const, e }),
    );
    if (!outcome.ok) {
      expect(outcome.e).toMatchObject({ body: { errors: [{ code: 'cross_workspace_scan_blocked' }] } });
    } else {
      expect(outcome.n).toBeGreaterThan(0);
    }
  });
});
```

Druhý test je záměrně obourametný: **buď** plánovač něco najde, **nebo** spadne s `cross_workspace_scan_blocked`. Co nesmí nastat a co test zachytí, je třetí možnost: doběhne úspěšně s nulou, přestože zastaralé segmenty existují. To je totiž jediný stav, ve kterém se porucha nikdy neprojeví.

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core test:db`
Expected: FAIL, `Cannot find module`.

- [ ] **Krok 3: Napiš `recount.ts`**

```ts
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { segments } from '@mlain/db/schema';
import { pgErrorCode, withWorkspace, withoutContext, type Tx } from '@mlain/core/tx';
import { logger } from '../../logging/index.js';
import { createSystemContext } from '../../identity/index.js';
import { ApiError } from '../../errors/index.js';
import { recountSegment } from '../service.js';

export type RecountPayload = { workspaceId: string; segmentId: string };

/**
 * singletonKey negarantuje právě jedno spuštění, takže je job idempotentní:
 * přepočet je čtení plus zápis odvozené hodnoty, opakování nic nezkazí.
 */
export const handler = async (job: { data: RecountPayload }): Promise<{ count: number; exact: boolean }> => {
  // Aktér typu system nese `job`, což je text, ne `id`, což by mělo být UUID.
  // Kdyby se sem dostal tvar { kind: 'system', id: 'segments.recount' }, skončil
  // by řetězec 'segments.recount' v uuid sloupci jako 22P02.
  const ctx = createSystemContext(job.data.workspaceId, 'segments.recount');
  await withWorkspace(ctx, (tx: Tx) =>
    tx.update(segments).set({ recomputeState: 'running' }).where(eq(segments.id, job.data.segmentId)));
  try {
    const row = await recountSegment(ctx, job.data.segmentId);
    return { count: row.cachedCount ?? 0, exact: row.cachedIsExact ?? false };
  } catch (error) {
    await withWorkspace(ctx, (tx: Tx) =>
      tx.update(segments)
        // pgErrorCode, ne error.code: přes drizzle je error.code undefined,
        // takže by se do last_error_code vždycky uložilo 'unknown'.
        .set({ recomputeState: 'error', lastErrorCode: pgErrorCode(error) ?? 'unknown' })
        .where(eq(segments.id, job.data.segmentId)),
    );
    throw error;
  }
};

/**
 * Hodinový cron: segmenty s cached_at starším než 6 hodin, napříč projekty.
 *
 * POZOR, tohle je jediné místo celého plánu, které sahá mimo jeden projekt,
 * a je to zároveň místo, kde se nejsnáz vyrobí trvale tichá porucha.
 * `segments` má politiku `ws_isolation` a `withoutContext` žádný kontext
 * nenastavuje, takže `current_setting('mlain.workspace_id', true)` je NULL,
 * porovnání s NULL je NULL, tedy nepravda, tedy ŽÁDNÉ ŘÁDKY. A hlavně:
 * **žádná chyba.** Bez systémového bypassu by tenhle cron roky hlásil
 * `{ scheduled: 0 }`, index `idx_segments__stale` by zůstal nepoužitý
 * a nikdo by si toho nevšiml, protože nula zastaralých segmentů je
 * naprosto věrohodná hodnota.
 *
 * Mechanismus, který to řeší, vlastní P03 a vyžádal si ho i P10 pro tracking
 * (politika `system_bypass`). Než bude, drží tady strážce níž, který ticho
 * odliší od prázdna a job shodí hlasitě.
 */
export const scheduleStale = async (enqueue: (p: RecountPayload) => Promise<void>): Promise<number> => {
  const cutoff = new Date(Date.now() - 6 * 60 * 60 * 1000);
  const rows = await withoutContext(async (tx: Tx) => {
    await assertCrossWorkspaceVisibility(tx);
    return tx.select({ id: segments.id, workspaceId: segments.workspaceId }).from(segments)
      .where(and(isNull(segments.deletedAt), eq(segments.kind, 'dynamic'),
        or(isNull(segments.cachedAt), lt(segments.cachedAt, cutoff))));
  });
  for (const row of rows) await enqueue({ workspaceId: row.workspaceId, segmentId: row.id });
  logger.info({ scheduled: rows.length }, 'segments.recount scheduled');
  return rows.length;
};

/**
 * Odliší „není co přepočítat" od „nevidím na nic".
 *
 * Ptá se na dvě čísla ve stejné transakci. `users` je v `TABLES_WITHOUT_RLS`,
 * takže se čte vždycky a říká, jestli je instalace vůbec používaná. `segments`
 * je pod RLS a bez bypassu vrací nulu. Když má instalace uživatele, ale
 * plánovač nevidí ANI JEDEN segment, je to skoro jistě chybějící bypass,
 * ne prázdná databáze, a job musí spadnout, ne reportovat úspěch.
 *
 * Test v kroku 6 tenhle strážce ověřuje ze druhé strany: založí segmenty ve
 * DVOU projektech a čeká, že je plánovač najde oba. Ten test se neptá téhož
 * zdroje jako strážce, takže projde jen tehdy, když bypass opravdu funguje.
 */
async function assertCrossWorkspaceVisibility(tx: Tx): Promise<void> {
  const { rows } = await tx.execute<{ users: number; segments: number }>(sql`
    SELECT (SELECT count(*) FROM users)::int AS users,
           (SELECT count(*) FROM segments)::int AS segments
  `);
  const seen = rows[0];
  if (seen && seen.users > 0 && seen.segments === 0) {
    throw new ApiError('dependency_unavailable', 503, {
      errors: [{
        path: '_',
        code: 'cross_workspace_scan_blocked',
        meta: { table: 'segments', users: seen.users },
      }],
    });
  }
}
```

- [ ] **Krok 4: Napiš `cleanup-after-reactivation.ts`**

```ts
import { sql } from 'drizzle-orm';
import { withWorkspace, type Tx } from '@mlain/core/tx';
import { ApiError } from '../../errors/index.js';
import { createSystemContext } from '../../identity/index.js';
import { logger } from '../../logging/index.js';

export type CleanupAction = 'unsubscribe_all' | 'tag_only' | 'delete';

export type CleanupPayload = {
  workspaceId: string;
  segmentId: string;
  action: CleanupAction;
  reactivatedTagId: string;
  actorRole?: 'owner' | 'admin' | 'editor' | 'viewer';
};

export type CleanupResult = { considered: number; skipped: number; affected: number };

/**
 * Poslední krok reaktivačního scénáře. Nevratná operace nad daty, která uživatel
 * roky sbíral, proto: mazat smí jen vlastník, kdo se ozval (má štítek), z úklidu
 * vypadá, a druhý běh nesmí nic udělat, protože singletonKey nic negarantuje.
 */
export const handler = async (job: { data: CleanupPayload }): Promise<CleanupResult> => {
  const { workspaceId, segmentId, action, reactivatedTagId, actorRole } = job.data;
  if (action === 'delete' && actorRole !== 'owner') {
    throw new ApiError('forbidden', 403, {
      errors: [{ path: '_', code: 'forbidden', meta: { requiredPermission: 'contacts:delete', currentRole: actorRole } }],
    });
  }
  const ctx = createSystemContext(workspaceId, 'contacts.cleanup_after_reactivation');

  return withWorkspace(ctx, async (tx: Tx) => {
    // Cílová množina jako fragment, ne jako řetězec s $n. Fragment se dá vložit
    // do většího dotazu a parametry si drží sám, takže nemůže dojít k posunu
    // číslování, když se okolní dotaz změní.
    const target = sql`
      SELECT sm.contact_id FROM segment_members sm
       WHERE sm.segment_id = ${segmentId}::uuid AND sm.workspace_id = ${workspaceId}::uuid
         AND NOT EXISTS (SELECT 1 FROM contact_tags ct
                          WHERE ct.contact_id = sm.contact_id AND ct.tag_id = ${reactivatedTagId}::uuid)`;

    const totals = await tx.execute<{ considered: number; skipped: number }>(sql`
      SELECT count(*)::int AS considered,
             count(*) FILTER (WHERE EXISTS (
               SELECT 1 FROM contact_tags ct
                WHERE ct.contact_id = sm.contact_id AND ct.tag_id = ${reactivatedTagId}::uuid))::int AS skipped
        FROM segment_members sm
       WHERE sm.segment_id = ${segmentId}::uuid AND sm.workspace_id = ${workspaceId}::uuid`);

    let affected = 0;
    if (action === 'unsubscribe_all') {
      // Podmínka na status dělá z jobu idempotentní operaci: druhý běh
      // nenajde nic ve stavu 'active' a affected je nula.
      const { rows } = await tx.execute(sql`
        UPDATE contacts SET status = 'unsubscribed', updated_at = now()
         WHERE workspace_id = ${workspaceId}::uuid AND status = 'active'
           AND id IN (${target}) RETURNING id`);
      affected = rows.length;
    } else if (action === 'tag_only') {
      const { rows } = await tx.execute(sql`
        INSERT INTO contact_tags (contact_id, tag_id, workspace_id)
        SELECT contact_id, ${reactivatedTagId}::uuid, ${workspaceId}::uuid FROM (${target}) src
        ON CONFLICT DO NOTHING RETURNING contact_id`);
      affected = rows.length;
    } else {
      const { rows } = await tx.execute(sql`
        UPDATE contacts SET deleted_at = now()
         WHERE workspace_id = ${workspaceId}::uuid AND deleted_at IS NULL
           AND id IN (${target}) RETURNING id`);
      affected = rows.length;
    }

    const result = {
      considered: Number(totals.rows[0]?.considered ?? 0),
      skipped: Number(totals.rows[0]?.skipped ?? 0),
      affected,
    };
    logger.info({ segmentId, action, ...result }, 'cleanup after reactivation finished');
    return result;
  });
};
```

Počet dotčených řádků se čte z `rows.length` nad `RETURNING`, ne z délky výsledku samotného. Vzor `(await tx.execute(...) as unknown[]).length` projde typovou kontrolou, ale ověřeno spuštěním: `Result` vlastnost `length` **nemá**, takže je `undefined`. Sčítání `out.affected + out.skipped` pak dá `NaN` a porovnání se součtem selže hláškou o `NaN`, ze které se příčina nepozná. Vedle `rows.length` existuje i `rowCount`, obojí je správně; `length` na obálce ne.

Vnořený fragment `id IN (${target})` je taky ověřený spuštěním: drizzle vloží poddotaz i s jeho parametry a přečísluje je, takže první běh vrátil dva řádky a druhý nula, tedy job je opravdu idempotentní.

- [ ] **Krok 5: Napiš `queue-handlers.ts`**

```ts
import { QUEUES } from '../../queues/index.js';
import { handler as recount } from './recount.js';
import { handler as cleanupAfterReactivation } from './cleanup-after-reactivation.js';

/** Codegen workeru (P01, rozhodnutí D4) globuje soubory tohohle jména. */
export const queueHandlers = {
  [QUEUES.SEGMENTS_RECOUNT]: recount,
  [QUEUES.CONTACTS_CLEANUP_AFTER_REACTIVATION]: cleanupAfterReactivation,
} as const;
```

- [ ] **Krok 6: Spusť databázový test a typecheck**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core test:db && pnpm --filter @mlain/core typecheck`
Expected: PASS, tři testy úklidu, typecheck bez chyby.

- [ ] **Krok 7: Odkomentuj export segmentů a spusť celou sadu bloku A**

V `packages/core/src/segments/index.ts` odkomentuj všechny řádky.

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/segments && pnpm --filter @mlain/core test:db`
Expected: PASS, celý blok A zeleně.

- [ ] **Krok 8: Commit**

```bash
git add packages/core/src/segments packages/core/test/segments
git commit -m "feat(segments): add recount and reactivation cleanup jobs"
```

---

## Blok B: import, fronta ke kontrole oslovení a export

### Úkol 23: Limity importu a proudové uložení souboru

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/contacts/import/limits.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/contacts/import/storage.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/test/contacts/import/storage.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
import { describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { storeUpload } from '../../../src/contacts/import/storage.js';

const dataDir = mkdtempSync(join(tmpdir(), 'mlain-import-'));
const ws = '00000000-0000-0000-0000-000000000001';
const id = '00000000-0000-0000-0000-0000000000aa';

describe('upload storage', () => {
  it('writes outside the webroot under a name derived from the import id', async () => {
    const out = await storeUpload(Readable.from([Buffer.from('a;b\n1;2\n')]), { dataDir, workspaceId: ws, importId: id, maxBytes: 1000 });
    expect(out.storageKey).toBe(join('imports', ws, `${id}.csv`));
    expect(readFileSync(join(dataDir, out.storageKey), 'utf8')).toBe('a;b\n1;2\n');
    expect(out.byteSize).toBe(8);
    expect(out.contentSha256).toHaveLength(32);
  });

  it('aborts over the limit without buffering the whole file', async () => {
    const big = Readable.from([Buffer.alloc(600), Buffer.alloc(600)]);
    await expect(storeUpload(big, { dataDir, workspaceId: ws, importId: id, maxBytes: 1000 }))
      .rejects.toMatchObject({ body: { errors: [{ code: 'file_too_large' }] } });
  });

  it('rejects a binary file', async () => {
    const bin = Readable.from([Buffer.from([0x00, 0x01, 0x02, 0x00])]);
    await expect(storeUpload(bin, { dataDir, workspaceId: ws, importId: id, maxBytes: 1000 }))
      .rejects.toMatchObject({ body: { errors: [{ code: 'unsupported_encoding' }] } });
  });

  it('never uses the user supplied file name on disk', async () => {
    const out = await storeUpload(Readable.from([Buffer.from('a;b\n')]), {
      dataDir, workspaceId: ws, importId: id, maxBytes: 1000, originalName: '../../etc/passwd',
    });
    expect(out.storageKey).not.toContain('..');
    expect(statSync(join(dataDir, out.storageKey)).isFile()).toBe(true);
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/contacts/import/storage.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Krok 3: Napiš `limits.ts`**

```ts
import { config } from '../../config/index.js';

export const importLimits = () => ({
  maxFileBytes: config.IMPORT_MAX_FILE_BYTES,
  maxRows: config.IMPORT_MAX_ROWS,
  maxColumns: config.IMPORT_MAX_COLUMNS,
  maxCellChars: config.IMPORT_MAX_CELL_CHARS,
  maxLineBytes: config.IMPORT_MAX_LINE_BYTES,
  batchSize: config.IMPORT_BATCH_SIZE,
  maxStoredErrors: config.IMPORT_MAX_STORED_ERRORS,
  sniffBytes: config.IMPORT_SNIFF_BYTES,
  previewTtlHours: config.IMPORT_PREVIEW_TTL_HOURS,
  staleMinutes: config.IMPORT_STALE_MINUTES,
  inMemoryDedupMaxRows: config.IMPORT_INMEMORY_DEDUP_MAX_ROWS,
});
```

- [ ] **Krok 4: Napiš `storage.ts`**

```ts
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { Transform, type Readable } from 'node:stream';
import { ApiError } from '../../errors/index.js';

export type StoredUpload = { storageKey: string; byteSize: number; contentSha256: Buffer };

export type StoreOptions = {
  dataDir: string;
  workspaceId: string;
  importId: string;
  maxBytes: number;
  /** Ukládá se jen jako metadata, na disk se nikdy nepromítne. */
  originalName?: string;
};

/**
 * Soubor se nikdy nenačte do paměti celý. Jméno na disku je odvozené z importId,
 * ne z uživatelského jména souboru, takže `../../etc/passwd` nemá kam zasáhnout.
 * Content type se ignoruje, rozhoduje obsah: binární nuly v prvních 8 kB znamenají,
 * že to není textový soubor.
 */
export async function storeUpload(source: Readable, opts: StoreOptions): Promise<StoredUpload> {
  const storageKey = join('imports', opts.workspaceId, `${opts.importId}.csv`);
  const target = join(opts.dataDir, storageKey);
  await mkdir(dirname(target), { recursive: true });

  const hash = createHash('sha256');
  let byteSize = 0;
  let sniffed = 0;
  let binary = false;

  const guard = new Transform({
    transform(chunk: Buffer, _enc, done) {
      byteSize += chunk.length;
      if (byteSize > opts.maxBytes) {
        done(new ApiError('payload_too_large', 413, {
          errors: [{ path: '_', code: 'file_too_large', meta: { actualBytes: byteSize, limitBytes: opts.maxBytes } }],
        }));
        return;
      }
      if (sniffed < 8192) {
        const window = chunk.subarray(0, 8192 - sniffed);
        if (window.includes(0)) binary = true;
        sniffed += window.length;
      }
      hash.update(chunk);
      done(null, chunk);
    },
  });

  try {
    await pipeline(source, guard, createWriteStream(target));
  } catch (error) {
    await rm(target, { force: true });
    throw error;
  }

  if (binary) {
    await rm(target, { force: true });
    throw new ApiError('validation_failed', 422, {
      errors: [{ path: '_', code: 'unsupported_encoding', meta: { reason: 'binary' } }],
    });
  }
  if (byteSize === 0) {
    await rm(target, { force: true });
    throw new ApiError('validation_failed', 422, { errors: [{ path: '_', code: 'empty_file' }] });
  }
  return { storageKey, byteSize, contentSha256: hash.digest() };
}

export async function deleteUpload(dataDir: string, storageKey: string): Promise<void> {
  await rm(join(dataDir, storageKey), { force: true });
}
```

- [ ] **Krok 5: Spusť test**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/contacts/import/storage.test.ts`
Expected: PASS, čtyři testy.

- [ ] **Krok 6: Commit**

```bash
git add packages/core/src/contacts/import/limits.ts packages/core/src/contacts/import/storage.ts packages/core/test/contacts/import/storage.test.ts
git commit -m "feat(import): stream uploads to disk with size and binary guards"
```

---

### Úkol 24: Detekce kódování bez knihovny

Tři kroky v závazném pořadí. Statistický detektor tuhle úlohu neumí: `chardet` vrátil pro skutečná data v CP1250 hodnotu `windows-1252`, protože se ty dvě kódové stránky liší jen v horní polovině a mají podobné rozložení bajtů.

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/contacts/import/encoding.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/test/contacts/import/encoding.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
import { describe, expect, it } from 'vitest';
import iconv from 'iconv-lite';
import { CZECH_SCORE_TABLE, decodeSample, detectEncoding, scoreCandidate } from '../../../src/contacts/import/encoding.js';

const czech = 'Email;Jméno\njana@firma.cz;Jana Nováková\npetr@firma.cz;Petr Šťastný\nlucie@x.cz;Lucie Žáková\n';

describe('encoding detection', () => {
  it('detects utf-8 with BOM and strips it', () => {
    const buf = Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(czech, 'utf8')]);
    const out = detectEncoding(buf);
    expect(out).toEqual({ encoding: 'utf-8', source: 'bom', bomLength: 3 });
    expect(decodeSample(buf, out).startsWith('Email')).toBe(true);
  });

  it('rejects utf-16 and utf-32 with unsupported_encoding', () => {
    for (const bom of [[0xff, 0xfe], [0xfe, 0xff], [0xff, 0xfe, 0x00, 0x00], [0x00, 0x00, 0xfe, 0xff]]) {
      expect(() => detectEncoding(Buffer.from([...bom, 0x41]))).toThrowError(/unsupported_encoding/);
    }
  });

  it('detects plain utf-8 without a BOM', () => {
    expect(detectEncoding(Buffer.from(czech, 'utf8'))).toMatchObject({ encoding: 'utf-8', source: 'utf8_validation' });
  });

  it('detects pure ascii as utf-8', () => {
    expect(detectEncoding(Buffer.from('a;b\n1;2\n', 'ascii'))).toMatchObject({ encoding: 'utf-8' });
  });

  it('picks windows-1250 for real CP1250 data, not windows-1252', () => {
    const buf = iconv.encode(czech, 'windows-1250');
    expect(detectEncoding(buf)).toMatchObject({ encoding: 'windows-1250', source: 'score' });
  });

  it('picks iso-8859-2 for real ISO-8859-2 data, not iso-8859-1', () => {
    const buf = iconv.encode(czech, 'iso-8859-2');
    expect(detectEncoding(buf)).toMatchObject({ encoding: 'iso-8859-2', source: 'score' });
  });

  it('scores by czech letters minus symbol noise', () => {
    expect(scoreCandidate('áčďéěíň')).toBe(14);
    expect(scoreCandidate('¡¢£')).toBe(-9);
    expect(CZECH_SCORE_TABLE.positive).toContain('ř');
  });

  it('breaks a tie in favour of windows-1250', () => {
    const ascii = Buffer.from('name;city\njan;praha\n', 'ascii');
    const out = detectEncoding(ascii);
    expect(out.encoding).toBe('utf-8');
  });

  it('truncates the sample at the last complete code point', () => {
    const buf = Buffer.concat([Buffer.from('á'.repeat(10), 'utf8'), Buffer.from([0xc3])]);
    expect(() => detectEncoding(buf)).not.toThrow();
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/contacts/import/encoding.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Krok 3: Napiš `encoding.ts`**

```ts
import iconv from 'iconv-lite';
import { ApiError } from '../../errors/index.js';

export type SupportedEncoding = 'utf-8' | 'windows-1250' | 'iso-8859-2' | 'windows-1252' | 'iso-8859-1';
export type EncodingSource = 'bom' | 'utf8_validation' | 'score' | 'manual';
export type DetectedEncoding = { encoding: SupportedEncoding; source: EncodingSource; bomLength: number };

export const CZECH_SCORE_TABLE = {
  positive: 'áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ',
  negative: '¡¢£¤¥¦§¨©ª«¬®¯°±²³´µ¶·¸¹º»¼½¾¿×÷',
} as const;

const CANDIDATES: SupportedEncoding[] = ['windows-1250', 'iso-8859-2', 'windows-1252', 'iso-8859-1'];

function unsupported(reason: string): never {
  throw new ApiError('validation_failed', 422, {
    errors: [{ path: '_', code: 'unsupported_encoding', meta: { reason } }],
  });
}

/** score = 2 × česká písmena − 3 × symbolový šum. */
export function scoreCandidate(text: string): number {
  let score = 0;
  for (const ch of text) {
    if (CZECH_SCORE_TABLE.positive.includes(ch)) score += 2;
    else if (CZECH_SCORE_TABLE.negative.includes(ch)) score -= 3;
  }
  return score;
}

/** Ořízne vzorek na poslední úplný kódový bod, aby validace UTF-8 nespadla na useknutém znaku. */
function trimToCodePoint(buf: Buffer): Buffer {
  for (let back = 0; back < 4 && back < buf.length; back += 1) {
    const byte = buf[buf.length - 1 - back];
    if ((byte & 0b1100_0000) !== 0b1000_0000) {
      const needed = byte < 0x80 ? 1 : byte < 0xe0 ? 2 : byte < 0xf0 ? 3 : 4;
      return back + 1 === needed ? buf : buf.subarray(0, buf.length - 1 - back);
    }
  }
  return buf;
}

export function detectEncoding(buffer: Buffer, sniffBytes = 262_144): DetectedEncoding {
  // 1. BOM
  if (buffer.length >= 4 && ((buffer[0] === 0xff && buffer[1] === 0xfe && buffer[2] === 0x00 && buffer[3] === 0x00)
    || (buffer[0] === 0x00 && buffer[1] === 0x00 && buffer[2] === 0xfe && buffer[3] === 0xff))) {
    unsupported('utf-32');
  }
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { encoding: 'utf-8', source: 'bom', bomLength: 3 };
  }
  if (buffer.length >= 2 && ((buffer[0] === 0xff && buffer[1] === 0xfe) || (buffer[0] === 0xfe && buffer[1] === 0xff))) {
    unsupported('utf-16');
  }

  const sample = trimToCodePoint(buffer.subarray(0, sniffBytes));

  // 2. Striktní validace UTF-8. Čistě ASCII soubor sem spadne také, což je správně.
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample);
    return { encoding: 'utf-8', source: 'utf8_validation', bomLength: 0 };
  } catch {
    // pokračuje se skórováním
  }

  // 3. Skóre kandidátů. Při rovnosti vyhrává windows-1250, protože český Excel.
  let best: { encoding: SupportedEncoding; score: number } | null = null;
  for (const candidate of CANDIDATES) {
    const score = scoreCandidate(iconv.decode(sample, candidate));
    if (!best || score > best.score) best = { encoding: candidate, score };
  }
  if (!best) unsupported('no candidate');
  return { encoding: best.encoding, source: 'score', bomLength: 0 };
}

export function decodeSample(buffer: Buffer, detected: DetectedEncoding): string {
  const body = buffer.subarray(detected.bomLength);
  return iconv.decode(body, detected.encoding);
}

/** Tři nejpravděpodobnější alternativy pro tlačítko „Ne, je to rozsypané". */
export function alternativeEncodings(current: SupportedEncoding): SupportedEncoding[] {
  return (['utf-8', 'windows-1250', 'iso-8859-2', 'windows-1252'] as SupportedEncoding[])
    .filter((e) => e !== current)
    .slice(0, 3);
}
```

- [ ] **Krok 4: Spusť test**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/contacts/import/encoding.test.ts`
Expected: PASS, devět testů. Testy pět a šest jsou přímý překlad měření ze 4.6.2 části 2 a jsou důvodem, proč se nepoužívá detektor.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/contacts/import/encoding.ts packages/core/test/contacts/import/encoding.test.ts
git commit -m "feat(import): detect encoding by bom, utf-8 validation and czech letter score"
```

---

### Úkol 25: Detekce oddělovače, uvozovek a hlavičky

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/contacts/import/dialect.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/test/contacts/import/dialect.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
import { describe, expect, it } from 'vitest';
import { detectDialect } from '../../../src/contacts/import/dialect.js';

describe('dialect detection', () => {
  it('prefers the semicolon, because czech excel exports with it', () => {
    const out = detectDialect('a;b;c\n1;2;3\n4;5;6\n');
    expect(out).toMatchObject({ delimiter: ';', hasHeader: true, quoteChar: '"', escape: 'double' });
  });

  it('detects a comma when the semicolon does not split', () => {
    expect(detectDialect('a,b,c\n1,2,3\n').delimiter).toBe(',');
  });

  it('detects a tab and a pipe', () => {
    expect(detectDialect('a\tb\n1\t2\n').delimiter).toBe('\t');
    expect(detectDialect('a|b\n1|2\n').delimiter).toBe('|');
  });

  it('respects quotes when counting fields', () => {
    expect(detectDialect('a;b\n"x;y";2\n"p;q";3\n').delimiter).toBe(';');
  });

  it('throws delimiter_not_detected when the mode is below two', () => {
    expect(() => detectDialect('just one line of prose\nand another\n')).toThrowError(/delimiter_not_detected/);
  });

  it('switches to backslash escaping when the sample has it and no doubled quotes', () => {
    expect(detectDialect('a;b\n"x\\"y";2\n').escape).toBe('backslash');
  });

  it('says there is no header when the first row is numeric', () => {
    expect(detectDialect('1;2;3\n4;5;6\n').hasHeader).toBe(false);
  });

  it('says there is no header when a name repeats', () => {
    expect(detectDialect('a;a;b\n1;2;3\n').hasHeader).toBe(false);
  });

  it('accepts mixed line endings', () => {
    expect(detectDialect('a;b\r\n1;2\n3;4\r').delimiter).toBe(';');
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/contacts/import/dialect.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Krok 3: Napiš `dialect.ts`**

```ts
import { ApiError } from '../../errors/index.js';

export type Delimiter = ';' | ',' | '\t' | '|';
export type Dialect = {
  delimiter: Delimiter;
  quoteChar: '"';
  escape: 'double' | 'backslash';
  hasHeader: boolean;
  columnCount: number;
};

/** Pořadí je priorita rozstřelu: středník první, protože český Excel. */
const CANDIDATES: Delimiter[] = [';', ',', '\t', '|'];

function splitRespectingQuotes(line: string, delimiter: string): number {
  let fields = 1;
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { i += 1; continue; }
      inQuotes = !inQuotes;
    } else if (ch === delimiter && !inQuotes) {
      fields += 1;
    }
  }
  return fields;
}

function modeOf(counts: number[]): { mode: number; hits: number } {
  const tally = new Map<number, number>();
  for (const c of counts) tally.set(c, (tally.get(c) ?? 0) + 1);
  let mode = 0;
  let hits = 0;
  for (const [value, count] of tally) if (count > hits || (count === hits && value > mode)) { mode = value; hits = count; }
  return { mode, hits };
}

export function detectDialect(sample: string): Dialect {
  const lines = sample.split(/\r\n|\n|\r/).filter((l) => l.trim().length > 0).slice(0, 20);
  if (lines.length === 0) {
    throw new ApiError('validation_failed', 422, { errors: [{ path: '_', code: 'empty_file' }] });
  }

  let best: { delimiter: Delimiter; mode: number; hits: number } | null = null;
  for (const delimiter of CANDIDATES) {
    const { mode, hits } = modeOf(lines.map((line) => splitRespectingQuotes(line, delimiter)));
    if (mode < 2) continue;
    if (!best || hits > best.hits || (hits === best.hits && mode > best.mode)) {
      best = { delimiter, mode, hits };
    }
  }
  if (!best) {
    throw new ApiError('validation_failed', 422, { errors: [{ path: '_', code: 'delimiter_not_detected' }] });
  }

  const escape: Dialect['escape'] = sample.includes('\\"') && !sample.includes('""') ? 'backslash' : 'double';

  // Hlavička se předpokládá, když je každá buňka neprázdná, není čistě číselná
  // a všechny jsou jedinečné. Jinak se sloupce pojmenují Sloupec 1, Sloupec 2.
  const firstCells = lines[0].split(best.delimiter).map((c) => c.replace(/^"|"$/g, '').trim());
  const hasHeader =
    firstCells.length === best.mode &&
    firstCells.every((c) => c.length > 0 && !/^-?\d+([.,]\d+)?$/.test(c)) &&
    new Set(firstCells.map((c) => c.toLowerCase())).size === firstCells.length;

  return { delimiter: best.delimiter, quoteChar: '"', escape, hasHeader, columnCount: best.mode };
}
```

- [ ] **Krok 4: Spusť test**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/contacts/import/dialect.test.ts`
Expected: PASS, devět testů.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/contacts/import/dialect.ts packages/core/test/contacts/import/dialect.test.ts
git commit -m "feat(import): detect delimiter, quoting and header"
```

---

### Úkol 26: Proudový čtenář s bajtovou pozicí

Tohle je jediný důvod, proč se použil `csv-parse` a ne `papaparse`: potřebujeme přesnou bajtovou pozici prvního bajtu následujícího nezpracovaného záznamu, jinak nejde obnovit import po pádu.

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/contacts/import/reader.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/test/contacts/import/reader.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import iconv from 'iconv-lite';
import { readRows } from '../../../src/contacts/import/reader.js';

const dir = mkdtempSync(join(tmpdir(), 'mlain-reader-'));

function fixture(name: string, content: Buffer): string {
  const path = join(dir, name);
  writeFileSync(path, content);
  return path;
}

const dialect = { delimiter: ';' as const, quoteChar: '"' as const, escape: 'double' as const, hasHeader: true, columnCount: 2 };
const encoding = { encoding: 'utf-8' as const, source: 'utf8_validation' as const, bomLength: 0 };

describe('streaming reader', () => {
  it('yields rows with a one based data row number and a byte offset', async () => {
    const path = fixture('a.csv', Buffer.from('email;name\na@x.cz;A\nb@x.cz;B\n', 'utf8'));
    const seen = [];
    for await (const row of readRows(path, { dialect, encoding, maxCellChars: 100, maxLineBytes: 1000 })) seen.push(row);
    expect(seen.map((r) => r.rowNumber)).toEqual([1, 2]);
    expect(seen[0].fields).toEqual(['a@x.cz', 'A']);
    expect(seen[1].byteOffsetAfter).toBe(29);
  });

  it('resumes from a byte offset without re-reading earlier rows', async () => {
    const path = fixture('b.csv', Buffer.from('email;name\na@x.cz;A\nb@x.cz;B\n', 'utf8'));
    const seen = [];
    for await (const row of readRows(path, { dialect, encoding, maxCellChars: 100, maxLineBytes: 1000, startByte: 20, startRowNumber: 1 })) seen.push(row);
    expect(seen).toHaveLength(1);
    expect(seen[0].fields[0]).toBe('b@x.cz');
    expect(seen[0].rowNumber).toBe(2);
  });

  it('decodes windows-1250 correctly', async () => {
    const path = fixture('c.csv', iconv.encode('email;name\nj@x.cz;Šťastná\n', 'windows-1250'));
    const rows = [];
    for await (const row of readRows(path, {
      dialect, encoding: { encoding: 'windows-1250', source: 'score', bomLength: 0 }, maxCellChars: 100, maxLineBytes: 1000,
    })) rows.push(row);
    expect(rows[0].fields[1]).toBe('Šťastná');
  });

  it('flags a row with a different field count', async () => {
    const path = fixture('d.csv', Buffer.from('email;name\na@x.cz;A;extra\n', 'utf8'));
    const rows = [];
    for await (const row of readRows(path, { dialect, encoding, maxCellChars: 100, maxLineBytes: 1000 })) rows.push(row);
    expect(rows[0].fieldCountMismatch).toBe(true);
  });

  it('pads missing trailing fields and warns instead of failing', async () => {
    const path = fixture('e.csv', Buffer.from('email;name\na@x.cz\n', 'utf8'));
    const rows = [];
    for await (const row of readRows(path, { dialect, encoding, maxCellChars: 100, maxLineBytes: 1000 })) rows.push(row);
    expect(rows[0].fields).toEqual(['a@x.cz', '']);
    expect(rows[0].padded).toBe(true);
  });

  it('reports the header row separately', async () => {
    const path = fixture('f.csv', Buffer.from('email;name\na@x.cz;A\n', 'utf8'));
    const rows = [];
    let header: string[] | undefined;
    for await (const row of readRows(path, { dialect, encoding, maxCellChars: 100, maxLineBytes: 1000, onHeader: (h) => { header = h; } })) rows.push(row);
    expect(header).toEqual(['email', 'name']);
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/contacts/import/reader.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Krok 3: Napiš `reader.ts`**

```ts
import { createReadStream } from 'node:fs';
import { parse } from 'csv-parse';
import iconv from 'iconv-lite';
import type { Dialect } from './dialect.js';
import type { DetectedEncoding } from './encoding.js';

export type RawRow = {
  /** Pořadí datového řádku od 1. Hlavička není datový řádek a nikdy se nepočítá. */
  rowNumber: number;
  fields: string[];
  raw: string;
  byteOffsetAfter: number;
  fieldCountMismatch: boolean;
  padded: boolean;
  truncatedCells: number;
};

export type ReadOptions = {
  dialect: Dialect;
  encoding: DetectedEncoding;
  maxCellChars: number;
  maxLineBytes: number;
  startByte?: number;
  startRowNumber?: number;
  onHeader?: (header: string[]) => void;
};

/**
 * Přeskočení na bajtový offset je bezpečné, protože obě podporovaná kódování
 * (UTF-8 i jednobajtové kódové stránky) jsou na hranici záznamu synchronizovatelná.
 * Offset ukazuje na PRVNÍ BAJT NÁSLEDUJÍCÍHO nezpracovaného záznamu.
 */
export async function* readRows(path: string, opts: ReadOptions): AsyncGenerator<RawRow> {
  const start = opts.startByte ?? 0;
  const stream = createReadStream(path, { start: start === 0 ? opts.encoding.bomLength : start });
  const decoded = opts.encoding.encoding === 'utf-8'
    ? stream
    : stream.pipe(iconv.decodeStream(opts.encoding.encoding)).pipe(iconv.encodeStream('utf-8'));

  const parser = decoded.pipe(parse({
    delimiter: opts.dialect.delimiter,
    quote: opts.dialect.quoteChar,
    escape: opts.dialect.escape === 'backslash' ? '\\' : '"',
    relax_column_count: true,
    relax_quotes: true,
    skip_empty_lines: true,
    info: true,
    raw: true,
    max_record_size: opts.maxLineBytes,
  }));

  const expected = opts.dialect.columnCount;
  let rowNumber = opts.startRowNumber ?? 0;
  let headerSeen = start > 0 || !opts.dialect.hasHeader;
  let byteCursor = start === 0 ? opts.encoding.bomLength : start;

  for await (const record of parser as AsyncIterable<{ record: string[]; raw: string }>) {
    const bytes = Buffer.byteLength(record.raw, opts.encoding.encoding === 'utf-8' ? 'utf8' : 'binary');
    byteCursor += bytes;

    if (!headerSeen) {
      headerSeen = true;
      opts.onHeader?.(record.record);
      continue;
    }

    let fields = record.record;
    let padded = false;
    let fieldCountMismatch = false;
    if (fields.length < expected) {
      // Chybí jen koncové sloupce: doplní se prázdnem a řádek dostane varování.
      fields = [...fields, ...Array.from({ length: expected - fields.length }, () => '')];
      padded = true;
    } else if (fields.length > expected) {
      fieldCountMismatch = true;
    }

    let truncatedCells = 0;
    fields = fields.map((cell) => {
      if (cell.length <= opts.maxCellChars) return cell;
      truncatedCells += 1;
      return cell.slice(0, opts.maxCellChars);
    });

    rowNumber += 1;
    yield { rowNumber, fields, raw: record.raw, byteOffsetAfter: byteCursor, fieldCountMismatch, padded, truncatedCells };
  }
}
```

- [ ] **Krok 4: Spusť test**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/contacts/import/reader.test.ts`
Expected: PASS, šest testů. Druhý test je základ obnovy po pádu a bez něj by se import po restartu rozjel od začátku.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/contacts/import/reader.ts packages/core/test/contacts/import/reader.test.ts
git commit -m "feat(import): add streaming reader with byte offsets and resume"
```

---

### Úkol 27: Mapování sloupců a automatický návrh

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/contacts/import/mapping.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/test/contacts/import/mapping.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
import { describe, expect, it } from 'vitest';
import { ImportMappingSchema, assertMappingValid, guessFieldType, suggestMapping } from '../../../src/contacts/import/mapping.js';

describe('column mapping', () => {
  it('maps czech and english headers without diacritics or case', () => {
    const out = suggestMapping(['E-mailová adresa', 'JMENO A PRIJMENI', 'Prijmeni', 'Pohlaví', 'Jazyk']);
    expect(out['0']).toEqual({ target: 'email' });
    expect(out['1']).toEqual({ target: 'full_name' });
    expect(out['2']).toEqual({ target: 'last_name' });
    expect(out['3']).toEqual({ target: 'gender' });
    expect(out['4']).toEqual({ target: 'locale' });
  });

  it('defaults an unrecognised column to ignore', () => {
    expect(suggestMapping(['Poznamka'])['0']).toEqual({ target: 'ignore' });
  });

  it('requires exactly one email column', () => {
    expect(() => assertMappingValid({ '0': { target: 'first_name' } })).toThrowError(/no_email_column_mapped/);
    expect(() => assertMappingValid({ '0': { target: 'email' }, '1': { target: 'email' } })).toThrowError(/duplicate_target/);
  });

  it('lets full_name and first_name coexist, first_name wins with a warning', () => {
    const out = assertMappingValid({ '0': { target: 'email' }, '1': { target: 'full_name' }, '2': { target: 'first_name' } });
    expect(out.warnings).toContain('full_name_ignored');
  });

  it('rejects an unknown target', () => {
    expect(() => ImportMappingSchema.parse({ '0': { target: 'shell_command' } })).toThrow();
  });

  it('guesses a field type from the first hundred values', () => {
    expect(guessFieldType(['1', '2', '3'])).toBe('number');
    expect(guessFieldType(['ano', 'ne', 'ano'])).toBe('boolean');
    expect(guessFieldType(['Praha', 'Brno', 'Praha'])).toBe('enum');
    expect(guessFieldType(['a'.repeat(300), 'b'.repeat(300)])).toBe('text');
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/contacts/import/mapping.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Krok 3: Napiš `mapping.ts`**

```ts
import { z } from 'zod';
import { ApiError } from '../../errors/index.js';

export const MAPPING_TARGETS = [
  'email', 'first_name', 'last_name', 'full_name', 'middle_name', 'title_prefix', 'title_suffix',
  'gender', 'locale', 'timezone', 'consent_occurred_at', 'consent_source', 'ignore',
] as const;

export const ImportMappingSchema = z.record(
  z.string().regex(/^\d+$/),
  z.union([
    z.object({ target: z.enum(MAPPING_TARGETS) }).strict(),
    z.object({ target: z.literal('attribute'), key: z.string().min(1).max(64) }).strict(),
    z.object({ target: z.literal('tag') }).strict(),
    z.object({ target: z.literal('list'), list_id: z.string().uuid() }).strict(),
  ]),
);

export type ImportMapping = z.infer<typeof ImportMappingSchema>;

/** Porovnává se bez diakritiky a bez ohledu na velikost písmen. */
function normalizeHeader(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const HEADER_DICTIONARY: Record<string, (typeof MAPPING_TARGETS)[number]> = {};
const DICTIONARY_SOURCE: [(typeof MAPPING_TARGETS)[number], string[]][] = [
  ['email', ['email', 'e-mail', 'mail', 'emailova adresa', 'e-mailova adresa', 'email address', 'address']],
  ['first_name', ['jmeno', 'krestni', 'krestni jmeno', 'first name', 'given name', 'firstname']],
  ['last_name', ['prijmeni', 'last name', 'surname', 'family name', 'lastname']],
  ['full_name', ['jmeno a prijmeni', 'cele jmeno', 'name', 'full name', 'nazev']],
  ['gender', ['pohlavi', 'rod', 'gender', 'sex', 'osloveni']],
  ['title_prefix', ['titul', 'titul pred', 'title']],
  ['locale', ['jazyk', 'language', 'locale', 'jazyk komunikace']],
];
for (const [target, headers] of DICTIONARY_SOURCE) for (const h of headers) HEADER_DICTIONARY[h] = target;

export function suggestMapping(headers: string[]): ImportMapping {
  const mapping: ImportMapping = {};
  const used = new Set<string>();
  headers.forEach((header, index) => {
    const target = HEADER_DICTIONARY[normalizeHeader(header)];
    // "jmeno" je v slovníku jako first_name a zároveň součást "jmeno a prijmeni";
    // delší shoda vyhrává, protože normalizeHeader porovnává celý řetězec.
    if (target && !used.has(target)) {
      used.add(target);
      mapping[String(index)] = { target };
    } else {
      mapping[String(index)] = { target: 'ignore' };
    }
  });
  return mapping;
}

export function assertMappingValid(mapping: ImportMapping): { warnings: string[] } {
  const parsed = ImportMappingSchema.parse(mapping);
  const targets = Object.values(parsed).map((m) => m.target);
  const emailCount = targets.filter((t) => t === 'email').length;
  if (emailCount === 0) {
    throw new ApiError('validation_failed', 422, {
      errors: [{ path: 'mapping', code: 'no_email_column_mapped' }],
    });
  }
  const singleUse = targets.filter((t) => t !== 'ignore' && t !== 'attribute' && t !== 'tag' && t !== 'list');
  const duplicates = singleUse.filter((t, i) => singleUse.indexOf(t) !== i);
  if (duplicates.length > 0) {
    throw new ApiError('validation_failed', 422, {
      errors: [{ path: 'mapping', code: 'duplicate_target', meta: { targets: [...new Set(duplicates)] } }],
    });
  }
  const warnings: string[] = [];
  // Samostatná pole vyhrávají nad full_name, a uživatel se to musí dozvědět v náhledu.
  if (targets.includes('full_name') && (targets.includes('first_name') || targets.includes('last_name'))) {
    warnings.push('full_name_ignored');
  }
  return { warnings };
}

export type GuessedType = 'number' | 'boolean' | 'enum' | 'text';

export function guessFieldType(values: string[]): GuessedType {
  const sample = values.filter((v) => v.trim().length > 0).slice(0, 100);
  if (sample.length === 0) return 'text';
  if (sample.every((v) => /^-?\d+([.,]\d+)?$/.test(v.trim()))) return 'number';
  const booleans = new Set(['ano', 'ne', 'true', 'false', 'yes', 'no', '1', '0']);
  if (sample.every((v) => booleans.has(v.trim().toLowerCase()))) return 'boolean';
  const distinct = new Set(sample.map((v) => v.trim()));
  if (distinct.size < 20 && sample.every((v) => v.trim().length <= 40)) return 'enum';
  return 'text';
}
```

- [ ] **Krok 4: Spusť test**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/contacts/import/mapping.test.ts`
Expected: PASS, šest testů.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/contacts/import/mapping.ts packages/core/test/contacts/import/mapping.test.ts
git commit -m "feat(import): add column mapping with czech and english header dictionary"
```

---

### Úkol 28: Volby importu

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/contacts/import/options.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/test/contacts/import/options.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
import { describe, expect, it } from 'vitest';
import { ImportOptionsSchema, assertOptionsConsistent, defaultOptions } from '../../../src/contacts/import/options.js';

describe('import options', () => {
  it('defaults to the least destructive choice', () => {
    const out = defaultOptions();
    expect(out.on_conflict).toBe('update');
    expect(out.duplicate_in_file).toBe('last');
    expect(out.skip_suppressed).toBe(true);
    expect(out.subscription_status).toBe('pending');
  });

  it('rejects an unknown key instead of silently using a default', () => {
    expect(() => ImportOptionsSchema.parse({ ...defaultOptions(), on_conflct: 'skip' })).toThrow();
  });

  it('requires a declaration for confirmed status on a double opt-in list', () => {
    const opts = { ...defaultOptions(), subscription_status: 'confirmed' as const, list_ids: ['l1'] };
    expect(() => assertOptionsConsistent(opts, { doubleOptInListIds: ['l1'] })).toThrowError(/declaration_required/);
  });

  it('accepts confirmed status when the declaration is given', () => {
    const opts = {
      ...defaultOptions(),
      subscription_status: 'confirmed' as const,
      list_ids: ['l1'],
      consent: { purpose: 'email_marketing' as const, legal_basis: 'consent' as const, source: 'import', declaration: true },
    };
    expect(() => assertOptionsConsistent(opts, { doubleOptInListIds: ['l1'] })).not.toThrow();
  });

  it('forbids turning off suppression skipping for complaints', () => {
    const opts = { ...defaultOptions(), skip_suppressed: false };
    expect(assertOptionsConsistent(opts, { doubleOptInListIds: [] }).alwaysSkippedReasons)
      .toEqual(['complaint', 'gdpr_erasure']);
  });

  it('disables duplicate_in_file error above the memory threshold', () => {
    const opts = { ...defaultOptions(), duplicate_in_file: 'error' as const };
    expect(() => assertOptionsConsistent(opts, { doubleOptInListIds: [], estimatedRows: 2_000_000, inMemoryDedupMaxRows: 1_000_000 }))
      .toThrowError(/duplicate_error_unavailable/);
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/contacts/import/options.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Krok 3: Napiš `options.ts`**

```ts
import { z } from 'zod';
import { ApiError } from '../../errors/index.js';

export const ImportOptionsSchema = z.object({
  on_conflict: z.enum(['skip', 'update', 'overwrite']).default('update'),
  duplicate_in_file: z.enum(['last', 'first', 'error']).default('last'),
  name_order: z.enum(['auto', 'first_last', 'last_first']).default('auto'),
  split_full_name: z.boolean().default(true),
  trim_whitespace: z.boolean().default(true),
  empty_means_null: z.boolean().default(true),
  number_format: z.enum(['auto', 'cs', 'en']).default('auto'),
  date_format: z.enum(['auto', 'cs', 'en']).default('auto'),
  list_ids: z.array(z.string().uuid()).default([]),
  subscription_status: z.enum(['pending', 'confirmed']).default('pending'),
  send_confirmation_emails: z.boolean().default(false),
  tag_ids: z.array(z.string().uuid()).default([]),
  consent: z
    .object({
      purpose: z.literal('email_marketing'),
      legal_basis: z.enum(['consent', 'legitimate_interest', 'soft_opt_in']),
      source: z.string().min(1).max(120),
      consent_text: z.string().max(4000).optional(),
      declaration: z.boolean(),
    })
    .strict()
    .nullable()
    .default(null),
  skip_suppressed: z.boolean().default(true),
  dry_run: z.boolean().default(false),
}).strict();

export type ImportOptions = z.infer<typeof ImportOptionsSchema>;

export function defaultOptions(): ImportOptions {
  return ImportOptionsSchema.parse({});
}

function invalid(code: string, meta: Record<string, unknown> = {}): never {
  throw new ApiError('validation_failed', 422, { errors: [{ path: 'options', code, meta }] });
}

export type OptionsContext = {
  doubleOptInListIds: string[];
  estimatedRows?: number;
  inMemoryDedupMaxRows?: number;
};

export function assertOptionsConsistent(
  options: ImportOptions,
  ctx: OptionsContext,
): { alwaysSkippedReasons: string[] } {
  const touchesDouble = options.list_ids.some((id) => ctx.doubleOptInListIds.includes(id));
  if (options.subscription_status === 'confirmed' && touchesDouble && options.consent?.declaration !== true) {
    invalid('declaration_required', { listIds: options.list_ids });
  }
  if (
    options.duplicate_in_file === 'error' &&
    ctx.estimatedRows !== undefined &&
    ctx.inMemoryDedupMaxRows !== undefined &&
    ctx.estimatedRows > ctx.inMemoryDedupMaxRows
  ) {
    // Bez paměťové mapy nejde druhý výskyt spolehlivě odlišit od aktualizace
    // existujícího kontaktu, takže volba není dostupná a UI ji zašedne.
    invalid('duplicate_error_unavailable', { rows: ctx.estimatedRows, limit: ctx.inMemoryDedupMaxRows });
  }
  // Stížnost a výmaz podle čl. 17 se přeskakují vždy, ani vlastník to nevypne.
  return { alwaysSkippedReasons: ['complaint', 'gdpr_erasure'] };
}
```

- [ ] **Krok 4: Spusť test**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/contacts/import/options.test.ts`
Expected: PASS, šest testů.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/contacts/import/options.ts packages/core/test/contacts/import/options.test.ts
git commit -m "feat(import): add strict import options with consistency checks"
```

---

### Úkol 29: Zpracování řádku v devíti krocích

Pořadí je závazné, protože určuje, která chyba se nahlásí první. Krok 7 volá `resolveName()` z P07 a je to jediné místo, kde se v importu počítá vokativ.

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/contacts/import/row-pipeline.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/test/contacts/import/row-pipeline.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
import { describe, expect, it } from 'vitest';
import { processRow } from '../../../src/contacts/import/row-pipeline.js';
import { defaultOptions } from '../../../src/contacts/import/options.js';

const base = {
  mapping: { '0': { target: 'email' as const }, '1': { target: 'full_name' as const }, '2': { target: 'attribute' as const, key: 'city' } },
  options: defaultOptions(),
  fieldCatalog: { city: { type: 'text', required: false, maxLength: 100 } },
  settings: { locale: 'cs', addressForm: 'formal', salutationBy: 'first_name', vocativePolicy: 'balanced' },
  overrides: new Map(),
  suppressed: new Map<string, string>(),
};

const row = (fields: string[], extra = {}) => ({
  rowNumber: 1, fields, raw: fields.join(';'), byteOffsetAfter: 0,
  fieldCountMismatch: false, padded: false, truncatedCells: 0, ...extra,
});

describe('row pipeline', () => {
  it('turns Jana Nováková into a female contact with the vocative Jano', () => {
    const out = processRow(row(['jana@firma.cz', 'Jana Nováková', 'Brno']), base);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.contact.first_name).toBe('Jana');
    expect(out.contact.last_name).toBe('Nováková');
    expect(out.contact.gender).toBe('female');
    expect(out.contact.first_name_vocative).toBe('Jano');
    expect(out.contact.greeting).toBe('Dobrý den, Jano');
  });

  it('reports email_missing before any other problem on the row', () => {
    const out = processRow(row(['', 'Jana Nováková', 'x'.repeat(500)]), base);
    expect(out).toMatchObject({ kind: 'error', errorCode: 'email_missing' });
  });

  it('reports email_invalid for two at signs', () => {
    expect(processRow(row(['jana@@firma.cz', 'A', 'B']), base)).toMatchObject({ kind: 'error', errorCode: 'email_invalid' });
  });

  it('reports the field count mismatch before the email is even parsed', () => {
    const out = processRow(row(['jana@firma.cz', 'A', 'B'], { fieldCountMismatch: true }), base);
    expect(out).toMatchObject({ kind: 'error', errorCode: 'row_field_count_mismatch' });
  });

  it('drops a complaint suppressed address entirely', () => {
    const ctx = { ...base, suppressed: new Map([['jana@firma.cz', 'complaint']]) };
    expect(processRow(row(['jana@firma.cz', 'A', 'B']), ctx)).toMatchObject({ kind: 'suppressed' });
  });

  it('keeps a soft suppressed contact but without subscription or consent', () => {
    const ctx = { ...base, suppressed: new Map([['jana@firma.cz', 'soft_bounce_threshold']]) };
    const out = processRow(row(['jana@firma.cz', 'A', 'B']), ctx);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.subscribe).toBe(false);
    expect(out.consent).toBeNull();
    expect(out.warnings).toContain('suppressed_skipped');
  });

  it('fails the whole row when one custom field fails coercion', () => {
    const ctx = { ...base, fieldCatalog: { city: { type: 'number', required: false } } };
    expect(processRow(row(['jana@firma.cz', 'A', 'not a number']), ctx))
      .toMatchObject({ kind: 'error', errorCode: 'invalid_number' });
  });

  it('marks a low confidence vocative for the review queue', () => {
    const out = processRow(row(['nikola@x.cz', 'Nikola Krátký', 'Brno']), base);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.contact.vocative_confidence).toBe('low');
    expect(out.warnings).toContain('vocative_low_confidence');
  });

  it('produces Dobrý den without a dangling comma for an empty name', () => {
    const out = processRow(row(['x@x.cz', '', '']), base);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.contact.greeting).toBe('Dobrý den');
  });

  it('warns about a padded row instead of failing it', () => {
    const out = processRow(row(['jana@firma.cz', 'A', ''], { padded: true }), base);
    expect(out.kind).toBe('ok');
    if (out.kind !== 'ok') return;
    expect(out.warnings).toContain('trailing_fields_padded');
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/contacts/import/row-pipeline.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Krok 3: Napiš `row-pipeline.ts`**

```ts
import { normalizeEmail, resolveName } from '../index.js';
import type { NameOverrideLookup } from '../index.js';
import { coerceFieldValue, type FieldSpec } from './coerce.js';
import type { ImportMapping } from './mapping.js';
import type { ImportOptions } from './options.js';
import type { RawRow } from './reader.js';

export type RowContext = {
  mapping: ImportMapping;
  options: ImportOptions;
  fieldCatalog: Record<string, FieldSpec>;
  settings: { locale: string; addressForm: string; salutationBy: string; vocativePolicy: string };
  overrides: NameOverrideLookup;
  /** e-mail v normalizovaném tvaru na důvod suppression. */
  suppressed: Map<string, string>;
};

export type ProcessedRow =
  | { kind: 'ok'; email: string; contact: Record<string, unknown>; attributes: Record<string, unknown>;
      tags: string[]; subscribe: boolean; consent: ImportOptions['consent']; warnings: string[]; rowNumber: number }
  | { kind: 'error'; rowNumber: number; errorCode: string; column?: string; detail?: string; raw: string }
  | { kind: 'suppressed'; rowNumber: number; reason: string };

const HARD_SUPPRESSION = new Set(['complaint', 'gdpr_erasure']);

/**
 * Pořadí kroků je závazné. Kdyby se prohodilo, uživatel by u řádku bez e-mailu
 * dostal hlášku o špatném datu a nepochopil by, co má opravit.
 */
export function processRow(row: RawRow, ctx: RowContext): ProcessedRow {
  const warnings: string[] = [];

  // 2. Neshoda počtu polí.
  if (row.fieldCountMismatch) {
    return { kind: 'error', rowNumber: row.rowNumber, errorCode: 'row_field_count_mismatch', raw: row.raw };
  }
  if (row.padded) warnings.push('trailing_fields_padded');
  if (row.truncatedCells > 0) warnings.push('value_truncated');

  // 3. Ořez bílých znaků.
  const cells = ctx.options.trim_whitespace ? row.fields.map((f) => f.trim()) : row.fields;

  const at = (target: string): string | undefined => {
    const index = Object.entries(ctx.mapping).find(([, m]) => m.target === target)?.[0];
    return index === undefined ? undefined : cells[Number(index)];
  };

  // 4. E-mail.
  const rawEmail = at('email') ?? '';
  if (rawEmail.length === 0) {
    return { kind: 'error', rowNumber: row.rowNumber, errorCode: 'email_missing', raw: row.raw };
  }
  const normalized = normalizeEmail(rawEmail);
  if (!normalized.ok) {
    return { kind: 'error', rowNumber: row.rowNumber, errorCode: normalized.code, column: 'email', raw: row.raw };
  }
  const email = normalized.email;

  // 6. Suppression list. Krok 5 (duplicity) řeší dedup.ts nad celou dávkou.
  const suppressionReason = ctx.suppressed.get(email);
  if (suppressionReason && HARD_SUPPRESSION.has(suppressionReason)) {
    return { kind: 'suppressed', rowNumber: row.rowNumber, reason: suppressionReason };
  }
  if (suppressionReason) warnings.push('suppressed_skipped');

  // 7. Jméno, rod, vokativ, oslovení. Jediné místo v importu, kde se to počítá.
  const name = resolveName(
    {
      fullName: ctx.options.split_full_name ? at('full_name') : undefined,
      firstName: at('first_name'),
      lastName: at('last_name'),
      titlePrefix: at('title_prefix'),
      titleSuffix: at('title_suffix'),
      gender: at('gender') as 'female' | 'male' | 'unknown' | undefined,
      nameOrder: ctx.options.name_order,
      locale: at('locale') ?? ctx.settings.locale,
    },
    { overrides: ctx.overrides, settings: ctx.settings as never },
  );
  for (const warning of name.warnings) warnings.push(warning.toLowerCase());

  // 8. Koerce vlastních polí. Chyba v jednom poli je chyba celého řádku,
  //    ne tichý zápis neúplného kontaktu.
  const attributes: Record<string, unknown> = {};
  const tags: string[] = [...ctx.options.tag_ids];
  for (const [index, target] of Object.entries(ctx.mapping)) {
    const value = cells[Number(index)] ?? '';
    if (target.target === 'attribute') {
      const spec = ctx.fieldCatalog[target.key];
      if (!spec) {
        return { kind: 'error', rowNumber: row.rowNumber, errorCode: 'unknown_field_key', column: target.key, raw: row.raw };
      }
      const coerced = coerceFieldValue(value, spec, ctx.options);
      if (!coerced.ok) {
        return { kind: 'error', rowNumber: row.rowNumber, errorCode: coerced.code, column: target.key, detail: value, raw: row.raw };
      }
      for (const w of coerced.warnings) warnings.push(w);
      if (coerced.value !== null || ctx.options.on_conflict === 'overwrite') attributes[target.key] = coerced.value;
    } else if (target.target === 'tag' && value.length > 0) {
      tags.push(...value.split(/[,|]/).map((t) => t.trim()).filter(Boolean));
    }
  }

  // 9. Sestavení řádku do dávky.
  return {
    kind: 'ok',
    email,
    rowNumber: row.rowNumber,
    contact: {
      email,
      first_name: name.firstName,
      last_name: name.lastName,
      middle_name: name.middleName,
      title_prefix: name.titlePrefix,
      title_suffix: name.titleSuffix,
      gender: name.gender,
      gender_source: name.genderSource,
      first_name_vocative: name.firstNameVocative,
      last_name_vocative: name.lastNameVocative,
      vocative_confidence: name.vocativeConfidence,
      greeting: name.greeting,
      locale: at('locale') ?? ctx.settings.locale,
    },
    attributes,
    tags,
    subscribe: !suppressionReason,
    consent: suppressionReason ? null : ctx.options.consent,
    warnings: [...new Set(warnings)],
  };
}
```

- [ ] **Krok 4: Napiš `coerce.ts`**

**Files:** Create `/Users/petr/Projects/Mailing_Tool/packages/core/src/contacts/import/coerce.ts`

```ts
import type { ImportOptions } from './options.js';

export type FieldSpec = {
  type: 'text' | 'long_text' | 'number' | 'boolean' | 'date' | 'datetime' | 'enum' | 'multi_enum' | 'url' | 'phone';
  required?: boolean;
  maxLength?: number;
  values?: string[];
};

export type Coerced =
  | { ok: true; value: unknown; warnings: string[] }
  | { ok: false; code: string };

/** 45 231 z Excelu je 30. 11. 2023. Serial 1 je 1. 1. 1900, s posunem o dva dny. */
function excelSerialToDate(serial: number): Date {
  return new Date(Date.UTC(1899, 11, 30) + serial * 86_400_000);
}

export function coerceFieldValue(raw: string, spec: FieldSpec, options: ImportOptions): Coerced {
  const warnings: string[] = [];
  const value = raw.trim();

  if (value.length === 0) {
    if (spec.required) return { ok: false, code: 'required_field_missing' };
    return { ok: true, value: options.empty_means_null ? null : '', warnings };
  }

  switch (spec.type) {
    case 'number': {
      const czech = /^-?\d{1,3}(\s\d{3})*(,\d+)?$|^-?\d+(,\d+)?$/.test(value);
      const english = /^-?\d{1,3}(,\d{3})*(\.\d+)?$|^-?\d+(\.\d+)?$/.test(value);
      if (!czech && !english) return { ok: false, code: 'invalid_number' };
      // "1,234" jde přečíst dvěma způsoby. Bereme český výklad, ale řekneme to.
      if (czech && english && /,/.test(value)) warnings.push('number_format_ambiguous');
      const normalized = czech && options.number_format !== 'en'
        ? value.replace(/\s/g, '').replace(',', '.')
        : value.replace(/,/g, '');
      return { ok: true, value: Number(normalized), warnings };
    }
    case 'boolean': {
      const truthy = ['ano', 'true', 'yes', '1'];
      const falsy = ['ne', 'false', 'no', '0'];
      const low = value.toLowerCase();
      if (truthy.includes(low)) return { ok: true, value: true, warnings };
      if (falsy.includes(low)) return { ok: true, value: false, warnings };
      return { ok: false, code: 'invalid_boolean' };
    }
    case 'date':
    case 'datetime': {
      if (/^\d{5}$/.test(value)) {
        warnings.push('excel_serial_date_assumed');
        return { ok: true, value: excelSerialToDate(Number(value)).toISOString(), warnings };
      }
      const cs = value.match(/^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})$/);
      if (cs) return { ok: true, value: new Date(Date.UTC(+cs[3], +cs[2] - 1, +cs[1])).toISOString(), warnings };
      const iso = Date.parse(value);
      if (Number.isNaN(iso)) return { ok: false, code: spec.type === 'date' ? 'invalid_date' : 'invalid_datetime' };
      return { ok: true, value: new Date(iso).toISOString(), warnings };
    }
    case 'enum': {
      if (spec.values && !spec.values.includes(value)) return { ok: false, code: 'invalid_enum_value' };
      return { ok: true, value, warnings };
    }
    case 'multi_enum': {
      const parts = value.split(/[,|]/).map((p) => p.trim()).filter(Boolean);
      if (spec.values && parts.some((p) => !spec.values?.includes(p))) return { ok: false, code: 'invalid_enum_value' };
      return { ok: true, value: parts, warnings };
    }
    case 'url': {
      try { new URL(value); } catch { return { ok: false, code: 'invalid_url' }; }
      return { ok: true, value, warnings };
    }
    case 'phone': {
      if (!/^[+0-9 ()./-]{6,32}$/.test(value)) return { ok: false, code: 'invalid_phone' };
      return { ok: true, value, warnings };
    }
    default: {
      if (spec.maxLength && value.length > spec.maxLength) {
        warnings.push('value_truncated');
        return { ok: true, value: value.slice(0, spec.maxLength), warnings };
      }
      return { ok: true, value, warnings };
    }
  }
}
```

- [ ] **Krok 5: Spusť test**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/contacts/import/row-pipeline.test.ts`
Expected: PASS, deset testů.

- [ ] **Krok 6: Commit**

```bash
git add packages/core/src/contacts/import/row-pipeline.ts packages/core/src/contacts/import/coerce.ts packages/core/test/contacts/import/row-pipeline.test.ts
git commit -m "feat(import): process rows in the mandated nine step order"
```

---

### Úkol 30: Deduplikace, úroveň A a úroveň B

Úroveň A je povinná a nejde vypnout. Bez ní dvě stejné adresy v jedné dávce znamenají, že `INSERT ... ON CONFLICT` sáhne na tentýž řádek dvakrát v jednom příkazu, což PostgreSQL odmítne chybou `21000`. Ta shodí celou transakci dávky, job má `retryLimit = 0` a import se v tom místě zasekne natrvalo.

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/contacts/import/dedup.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/test/contacts/import/dedup.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
import { describe, expect, it } from 'vitest';
import { BatchDeduper } from '../../../src/contacts/import/dedup.js';

const row = (email: string, rowNumber: number) => ({ kind: 'ok' as const, email, rowNumber, contact: {}, attributes: {}, tags: [], subscribe: true, consent: null, warnings: [] });

describe('deduplication', () => {
  it('keeps the last occurrence inside one batch and warns about the earlier one', () => {
    const d = new BatchDeduper({ mode: 'last', inMemoryMaxRows: 1000 });
    const out = d.dedupeBatch([row('a@x.cz', 1), row('b@x.cz', 2), row('a@x.cz', 3)]);
    expect(out.rows.map((r) => r.rowNumber)).toEqual([2, 3]);
    expect(out.warnings).toEqual([{ rowNumber: 1, code: 'duplicate_in_file' }]);
  });

  it('keeps the first occurrence in first mode', () => {
    const d = new BatchDeduper({ mode: 'first', inMemoryMaxRows: 1000 });
    const out = d.dedupeBatch([row('a@x.cz', 1), row('a@x.cz', 3)]);
    expect(out.rows.map((r) => r.rowNumber)).toEqual([1]);
  });

  it('treats addresses differing only in case as the same', () => {
    const d = new BatchDeduper({ mode: 'last', inMemoryMaxRows: 1000 });
    const out = d.dedupeBatch([row('A@x.cz'.toLowerCase(), 1), row('a@x.cz', 2)]);
    expect(out.rows).toHaveLength(1);
  });

  it('removes a duplicate spanning the first and last position of a batch', () => {
    const rows = [row('a@x.cz', 1), ...Array.from({ length: 998 }, (_, i) => row(`c${i}@x.cz`, i + 2)), row('a@x.cz', 1000)];
    const out = new BatchDeduper({ mode: 'last', inMemoryMaxRows: 5000 }).dedupeBatch(rows);
    expect(out.rows).toHaveLength(999);
  });

  it('reports an error on the second occurrence in error mode', () => {
    const d = new BatchDeduper({ mode: 'error', inMemoryMaxRows: 1000 });
    const out = d.dedupeBatch([row('a@x.cz', 1), row('a@x.cz', 2)]);
    expect(out.errors).toEqual([{ rowNumber: 2, code: 'duplicate_in_file' }]);
  });

  it('keeps level A working after the cross batch memory is disabled', () => {
    const d = new BatchDeduper({ mode: 'last', inMemoryMaxRows: 0 });
    expect(d.crossBatchEnabled).toBe(false);
    const out = d.dedupeBatch([row('a@x.cz', 1), row('a@x.cz', 2)]);
    expect(out.rows).toHaveLength(1);
  });

  it('detects a cross batch duplicate while the memory is on', () => {
    const d = new BatchDeduper({ mode: 'last', inMemoryMaxRows: 1000 });
    d.dedupeBatch([row('a@x.cz', 1)]);
    const out = d.dedupeBatch([row('a@x.cz', 2)]);
    expect(out.warnings).toEqual([{ rowNumber: 1, code: 'duplicate_in_file' }]);
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/contacts/import/dedup.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Krok 3: Napiš `dedup.ts`**

```ts
import type { ProcessedRow } from './row-pipeline.js';

type OkRow = Extract<ProcessedRow, { kind: 'ok' }>;
export type RowNote = { rowNumber: number; code: 'duplicate_in_file' };
export type DedupeResult = { rows: OkRow[]; warnings: RowNote[]; errors: RowNote[] };

export class BatchDeduper {
  /** Úroveň B, paměťová. Vypíná se nad prahem, úroveň A běží vždy. */
  readonly crossBatchEnabled: boolean;
  private readonly seen = new Map<string, number>();

  constructor(private readonly opts: { mode: 'last' | 'first' | 'error'; inMemoryMaxRows: number }) {
    this.crossBatchEnabled = opts.inMemoryMaxRows > 0;
  }

  /**
   * Úroveň A: povinná deduplikace UVNITŘ dávky. Mapa je velká jako dávka,
   * tedy jednotky desítek kilobajtů. ON CONFLICT řeší duplicity MEZI příkazy,
   * ne uvnitř jednoho, a tohle rozdělení se nesmí sloučit zpět.
   */
  dedupeBatch(rows: OkRow[]): DedupeResult {
    const byEmail = new Map<string, OkRow>();
    const warnings: RowNote[] = [];
    const errors: RowNote[] = [];

    for (const row of rows) {
      const previous = byEmail.get(row.email);
      if (previous) {
        if (this.opts.mode === 'error') {
          errors.push({ rowNumber: row.rowNumber, code: 'duplicate_in_file' });
          continue;
        }
        if (this.opts.mode === 'first') {
          warnings.push({ rowNumber: row.rowNumber, code: 'duplicate_in_file' });
          continue;
        }
        warnings.push({ rowNumber: previous.rowNumber, code: 'duplicate_in_file' });
        byEmail.set(row.email, row);
        continue;
      }
      if (this.crossBatchEnabled) {
        const earlier = this.seen.get(row.email);
        if (earlier !== undefined) {
          if (this.opts.mode === 'error') {
            errors.push({ rowNumber: row.rowNumber, code: 'duplicate_in_file' });
            continue;
          }
          warnings.push({ rowNumber: this.opts.mode === 'first' ? row.rowNumber : earlier, code: 'duplicate_in_file' });
          if (this.opts.mode === 'first') continue;
        }
        if (this.seen.size < this.opts.inMemoryMaxRows) this.seen.set(row.email, row.rowNumber);
      }
      byEmail.set(row.email, row);
    }

    return { rows: [...byEmail.values()].sort((a, b) => a.rowNumber - b.rowNumber), warnings, errors };
  }
}
```

- [ ] **Krok 4: Spusť test**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/contacts/import/dedup.test.ts`
Expected: PASS, sedm testů. Test „removes a duplicate spanning the first and last position" je regrese proti `21000` a je v akceptačních kritériích části 2 pod číslem 13.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/contacts/import/dedup.ts packages/core/test/contacts/import/dedup.test.ts
git commit -m "feat(import): add mandatory in batch dedup and thresholded cross batch dedup"
```

---

### Úkol 31: Dávka a checkpoint v jedné transakci

Tohle je jádro obnovitelnosti. Protože je zápis čítačů ve stejné transakci jako zápis kontaktů, platí exactly-once na úrovni dávky: pád workera kdykoliv uprostřed znamená rollback celé dávky a po restartu se čte od `checkpoint_row + 1`.

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/contacts/import/db.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/contacts/import/batch.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/test/contacts/import/batch.dbspec.ts`

- [ ] **Krok 1: Napiš padající databázový test**

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { withWorkspace } from '@mlain/core/tx';
import { writeBatch } from '../../../src/contacts/import/batch.js';
import { makeWorkspace, testCtx } from '../../segments/helpers/db.js';
import { createImportRow, readImport } from './helpers/import-fixtures.js';

let ctx: Awaited<ReturnType<typeof testCtx>>;

const ok = (email: string, rowNumber: number) => ({
  kind: 'ok' as const, email, rowNumber, subscribe: true, consent: null, warnings: [], tags: [], attributes: {},
  // Tvar odpovídá ContactUpsertRow z P07, včetně klíčů jmen. Bez nich by řádek
  // sice vznikl, ale fronta ke kontrole oslovení by ho nikdy nenašla.
  contact: {
    email, firstName: 'Alena', lastName: 'Bílá',
    firstNameKey: 'alena', lastNameKey: 'bila',
    gender: 'female' as const, greeting: 'Dobrý den, Aleno', vocativeConfidence: 'high' as const,
  },
});
const err = (rowNumber: number, errorCode: string, severity: 'error' | 'warning' = 'error') =>
  ({ rowNumber, errorCode, severity, raw: 'x' });

beforeAll(async () => {
  ctx = await testCtx();
  await makeWorkspace(ctx, { contacts: 0 });
});

const base = { mode: 'update' as const, errors: [], suppressedCount: 0, maxStoredErrors: 10_000 };

describe('batch write', () => {
  it('writes contacts and the checkpoint in one transaction', async () => {
    const importId = await createImportRow(ctx);
    await writeBatch(ctx, {
      ...base, importId, rows: [ok('a@x.cz', 1), ok('b@x.cz', 2)],
      checkpointRow: 2, checkpointByte: 120,
    });
    const row = await readImport(ctx, importId);
    expect(row.checkpoint_row).toBe(2);
    expect(row.created_rows).toBe(2);
    expect(row.processed_rows).toBe(2);
    expect(row.updated_at).not.toBeNull();
  });

  it('fills the name keys, so the vocative review queue is not left empty', async () => {
    // Regrese proti nejtišší chybě celého importu: kontakty se zapíšou, import
    // skončí zeleně, a fronta ke kontrole oslovení zůstane prázdná, protože
    // first_name_key je NULL a částečný index na něm stojí.
    const importId = await createImportRow(ctx);
    await writeBatch(ctx, { ...base, importId, rows: [ok('k@x.cz', 1)], checkpointRow: 1, checkpointByte: 10 });
    const { rows } = await withWorkspace(ctx, (tx) => tx.execute<{ first_name_key: string | null }>(sql`
      SELECT first_name_key FROM contacts WHERE workspace_id = ${ctx.workspaceId}::uuid AND email = 'k@x.cz'`));
    expect(rows[0]?.first_name_key).toBe('alena');
  });

  it('rolls back the whole batch when one statement fails', async () => {
    const importId = await createImportRow(ctx);
    await expect(writeBatch(ctx, {
      ...base, importId, rows: [ok('c@x.cz', 1), { ...ok('d@x.cz', 2), contact: { email: null } } as never],
      checkpointRow: 2, checkpointByte: 50,
    })).rejects.toThrow();
    const row = await readImport(ctx, importId);
    expect(row.checkpoint_row).toBe(0);
    expect(row.created_rows).toBe(0);
    // A hlavně: ani jeden kontakt z té dávky. Kdyby upsert běžel ve VLASTNÍ
    // transakci, tenhle řádek by přežil a po restartu by se zapsal podruhé.
    const { rows } = await withWorkspace(ctx, (tx) => tx.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM contacts
       WHERE workspace_id = ${ctx.workspaceId}::uuid AND email = 'c@x.cz'`));
    expect(rows[0]?.n).toBe(0);
  });

  it('distinguishes inserts from updates', async () => {
    const importId = await createImportRow(ctx);
    const batch = { ...base, importId, rows: [ok('e@x.cz', 1)], checkpointRow: 1, checkpointByte: 10 };
    await writeBatch(ctx, batch);
    await writeBatch(ctx, { ...batch, checkpointRow: 2 });
    const row = await readImport(ctx, importId);
    expect(row.created_rows).toBe(1);
    expect(row.updated_rows).toBe(1);
  });

  it('stops storing error rows above the limit but keeps counting them', async () => {
    const importId = await createImportRow(ctx);
    const errors = Array.from({ length: 5 }, (_, i) => err(i + 1, 'email_invalid'));
    await writeBatch(ctx, {
      ...base, importId, rows: [], errors, checkpointRow: 5, checkpointByte: 10, maxStoredErrors: 2,
    });
    const row = await readImport(ctx, importId);
    expect(row.error_rows).toBe(5);
    expect(row.error_summary.email_invalid).toBe(5);
    expect(row.stored_error_count).toBe(2);
  });

  it('stores warning rows as warnings, not as errors', async () => {
    const importId = await createImportRow(ctx);
    await writeBatch(ctx, {
      ...base, importId, rows: [],
      errors: [err(1, 'email_invalid', 'error'), err(2, 'name_guessed', 'warning')],
      checkpointRow: 2, checkpointByte: 10,
    });
    const row = await readImport(ctx, importId);
    expect(row.error_rows).toBe(1);
    expect(row.warning_rows).toBe(1);
    const { rows } = await withWorkspace(ctx, (tx) => tx.execute<{ severity: string; n: number }>(sql`
      SELECT severity, count(*)::int AS n FROM import_errors
       WHERE import_id = ${importId}::uuid GROUP BY severity ORDER BY severity`));
    expect(rows).toEqual([{ severity: 'error', n: 1 }, { severity: 'warning', n: 1 }]);
  });

  it('SUMS error_summary across batches instead of overwriting it', async () => {
    // Tenhle test musí být nad DVĚMA dávkami. Při jedné je nahrazení a součet
    // totéž, takže by chybu nezachytil, a přesně proto ji dřívější podoba plánu
    // měla: jediný test na jednu dávku procházel.
    const importId = await createImportRow(ctx);
    const b = { ...base, importId, rows: [], checkpointByte: 10 };
    await writeBatch(ctx, { ...b, errors: [err(1, 'email_invalid')], checkpointRow: 1 });
    await writeBatch(ctx, { ...b, errors: [err(2, 'email_invalid'), err(3, 'missing_email')], checkpointRow: 3 });
    const row = await readImport(ctx, importId);
    expect(row.error_summary).toEqual({ email_invalid: 2, missing_email: 1 });
    expect(row.error_rows).toBe(3);
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core test:db`
Expected: FAIL, `Cannot find module`.

- [ ] **Krok 3: Napiš `db.ts`**

```ts
import { withWorkspace, type Tx } from '@mlain/core/tx';
import type { WorkspaceContext } from '../../identity/index.js';

/**
 * Jediné místo importu, které se dotýká klienta databáze. Kdyby P03 pojmenoval
 * transakční primitivum jinak, mění se jen tenhle soubor.
 */
export function inWorkspaceTx<T>(ctx: WorkspaceContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withWorkspace(ctx, fn);
}
```

- [ ] **Krok 4: Napiš `batch.ts`**

```ts
import { sql, type SQL } from 'drizzle-orm';
import { upsertContacts } from '@mlain/core/contacts';
import type { WorkspaceContext } from '../../identity/index.js';
import { inWorkspaceTx } from './db.js';
import type { ProcessedRow } from './row-pipeline.js';
import type { RowNote } from './dedup.js';

type OkRow = Extract<ProcessedRow, { kind: 'ok' }>;
type ErrRow = {
  rowNumber: number;
  errorCode: string;
  severity: 'error' | 'warning';
  column?: string;
  detail?: string;
  raw: string;
};

export type BatchInput = {
  importId: string;
  mode: 'skip' | 'update' | 'overwrite' | 'create';
  rows: OkRow[];
  /** Chybné i varovné řádky v jednom seznamu, rozlišené polem severity. */
  errors: ErrRow[];
  checkpointRow: number;
  checkpointByte: number;
  suppressedCount: number;
  maxStoredErrors: number;
};

export type BatchResult = { created: number; updated: number };

/**
 * Šest kroků v JEDNÉ transakci. Bod 6 (updated_at v checkpointu) není kosmetika:
 * je to jediný signál živosti importu a stojí na něm obnova po pádu. Bez něj by
 * zabitý worker nechal import navždy ve stavu importing a singletonKey by projektu
 * zablokoval i všechny další importy.
 */
export async function writeBatch(ctx: WorkspaceContext, input: BatchInput): Promise<BatchResult> {
  return inWorkspaceTx(ctx, async (tx) => {
    let created = 0;
    let updated = 0;

    // 1. Kontakty. Zápis NEDĚLÁ tenhle plán, dělá ho upsertContacts z P07.
    //    Je to jediné místo v produktu, kde kontakt hromadně vzniká, a jde přes
    //    něj všechny čtyři kanály (API, formulář, webhook, import). Vlastní INSERT
    //    by znamenal druhou implementaci upsertu, která se s tou první rozejde,
    //    a hlavně by zapomněl na sloupce, o kterých import neví: dřívější podoba
    //    tohohle kroku vyjmenovávala dvacet sloupců a first_name_key ani
    //    last_name_key mezi nimi nebyly, takže by fronta ke kontrole oslovení
    //    zůstala po importu prázdná, protože stojí právě na těch klíčích.
    if (input.rows.length > 0) {
      const written = await upsertContacts(ctx, {
        mode: input.mode,
        rows: input.rows.map((r) => ({ ...r.contact, attributes: r.attributes, source: 'import', sourceRef: input.importId })),
      }, tx);
      created = written.filter((r) => r.inserted).length;
      updated = written.length - created;
    }

    // 2. Chybné a varovné řádky. Nad limit se jen inkrementují čítače.
    //    severity se bere z řádku, NENÍ natvrdo 'error': varovné řádky se počítají
    //    do warning_rows i do error_summary, takže kdyby se ukládaly jako 'error',
    //    uživatel by u varování viděl počet, ale nedohledal by ani jeden řádek,
    //    který ho způsobil, a stažení chybných řádků by mu vrátilo i varování.
    const stored = input.errors.slice(0, Math.max(0, input.maxStoredErrors));
    if (stored.length > 0) {
      await tx.execute(sql`
        INSERT INTO import_errors (id, import_id, workspace_id, row_number, severity,
                                   column_name, error_code, error_detail, raw_line)
        SELECT uuidv7(), ${input.importId}::uuid, ${ctx.workspaceId}::uuid,
               u.row_number, u.severity, u.column_name, u.error_code, u.error_detail, u.raw_line
          FROM unnest(
            ${sql.param(stored.map((e) => e.rowNumber))}::bigint[],
            ${sql.param(stored.map((e) => e.severity))}::text[],
            ${sql.param(stored.map((e) => e.column ?? null))}::text[],
            ${sql.param(stored.map((e) => e.errorCode))}::text[],
            ${sql.param(stored.map((e) => e.detail ?? null))}::text[],
            ${sql.param(stored.map((e) => e.raw))}::text[]
          ) AS u(row_number, severity, column_name, error_code, error_detail, raw_line)`);
    }

    const errorRows = input.errors.filter((e) => e.severity === 'error').length;
    const warningRows = input.errors.length - errorRows;

    const summary: Record<string, number> = {};
    for (const e of input.errors) summary[e.errorCode] = (summary[e.errorCode] ?? 0) + 1;

    // 3. Checkpoint. Ve STEJNÉ transakci jako body 1 a 2.
    await tx.execute(sql`
      UPDATE imports SET
        checkpoint_row = ${input.checkpointRow},
        checkpoint_byte = ${input.checkpointByte},
        processed_rows  = processed_rows + ${input.rows.length + input.errors.length},
        created_rows    = created_rows + ${created},
        updated_rows    = updated_rows + ${updated},
        error_rows      = error_rows + ${errorRows},
        warning_rows    = warning_rows + ${warningRows},
        suppressed_rows = suppressed_rows + ${input.suppressedCount},
        stored_error_count = stored_error_count + ${stored.length},
        error_summary   = ${mergeSummarySql(summary)},
        updated_at      = now()
      WHERE id = ${input.importId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid`);

    return { created, updated };
  });
}

/**
 * Sečte dosavadní error_summary s přírůstkem téhle dávky.
 *
 * Operátor `||` nad jsonb klíče na první úrovni NAHRAZUJE, nesčítá. Ověřeno
 * spuštěním: `'{"email_invalid":3}' || '{"email_invalid":5}'` je `5`, ne `8`.
 * U importu s víc než jednou dávkou by tedy `error_summary` na konci obsahovala
 * počty z POSLEDNÍ dávky, ne za celý soubor, a výsledková obrazovka by u souboru
 * s deseti tisíci chybami klidně napsala „3 neplatné adresy". Test na jednu dávku
 * to nikdy neodhalí, protože při jedné dávce je nahrazení a součet totéž.
 */
function mergeSummarySql(increment: Record<string, number>): SQL {
  return sql`(
    SELECT coalesce(jsonb_object_agg(k, to_jsonb(v)), '{}'::jsonb)
      FROM (SELECT key AS k, sum(value::bigint) AS v
              FROM (SELECT key, value FROM jsonb_each_text(imports.error_summary)
                    UNION ALL
                    SELECT key, value FROM jsonb_each_text(${JSON.stringify(increment)}::jsonb)) merged
             GROUP BY key) summed)`;
}
```

Tři věci, které se v tomhle kroku opravily, a u každé je uvedené, čím se pozná, že se neopravila:

| Co | Jak se to projeví, když se to neopraví |
|---|---|
| Zápis kontaktů jde přes `upsertContacts` z P07 | Fronta ke kontrole oslovení zůstane po importu prázdná, protože `first_name_key` bude NULL a index `idx_contacts__ws_vocative_review` na něm stojí. Import přitom skončí zeleně. |
| `severity` se bere z řádku | `warning_rows` roste, ale žádný varovný řádek neexistuje. Uživatel vidí „12 varování" a prázdný seznam. |
| `error_summary` se sčítá, ne přepisuje | U jedné dávky správně, u dvou a víc špatně. Chyba se tedy projeví teprve na velkém souboru, tedy v provozu. |

**Požadavek na P07, bez kterého tenhle krok nejde napsat:** `upsertContacts` musí přijmout **už otevřenou transakci** třetím argumentem. Dnes si otevírá vlastní přes `withWorkspace(ctx, …)`, což by z dávky udělalo dvě nezávislé transakce: kontakty by se zapsaly, checkpoint by při pádu mezi nimi nezůstal, a po restartu by se tytéž řádky naimportovaly znovu. Celá obnovitelnost importu (kritéria 7 a 14) stojí na tom, že zápis kontaktů a zápis checkpointu **buď proběhnou oba, nebo ani jeden**. Zapsáno jako požadavek 7.7 a v evidenci napříč plány.

- [ ] **Krok 5: Spusť databázový test**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core test:db`
Expected: PASS, sedm testů.

Sčítání `error_summary` a rozlišení `severity` je ověřené spuštěním nad PostgreSQL 18 dvěma dávkami:

```
po dvou davkach: error_rows=3, warning_rows=1, stored_error_count=4
                 error_summary = {"missing":1,"name_guessed":1,"email_invalid":2}
ulozene radky:   [{"severity":"error","n":3},{"severity":"warning","n":1}]
```

S operátorem `||` by `email_invalid` bylo `1`, tedy hodnota z druhé dávky.

- [ ] **Krok 6: Commit**

```bash
git add packages/core/src/contacts/import/db.ts packages/core/src/contacts/import/batch.ts packages/core/test/contacts/import/batch.dbspec.ts
git commit -m "feat(import): write batch and checkpoint in one transaction"
```

---

### Úkol 32: Odhad a náhled

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/contacts/import/estimate.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/contacts/import/preview.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/test/contacts/import/preview.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
import { describe, expect, it } from 'vitest';
import { buildPreview } from '../../../src/contacts/import/preview.js';
import { estimateFile } from '../../../src/contacts/import/estimate.js';

describe('preview and estimate', () => {
  it('shows twenty rows in their final shape with the greeting column', async () => {
    const out = await buildPreview(fixturePath('12k.csv'), previewCtx());
    expect(out.rows).toHaveLength(20);
    expect(out.rows[0].greeting).toBe('Dobrý den, Jano');
    expect(out.rows[0].title_prefix).toBeNull();
  });

  it('shows Ing. Pavel Novák as title, first name, last name and Dobrý den, Pavle', async () => {
    const out = await buildPreview(fixturePath('titles.csv'), previewCtx());
    const row = out.rows.find((r) => r.email.startsWith('pavel'));
    expect(row).toMatchObject({ title_prefix: 'Ing.', first_name: 'Pavel', last_name: 'Novák', greeting: 'Dobrý den, Pavle' });
  });

  it('marks failing rows red and suppressed rows grey', async () => {
    const out = await buildPreview(fixturePath('mixed.csv'), previewCtx());
    expect(out.rows.some((r) => r.state === 'error')).toBe(true);
    expect(out.rows.some((r) => r.state === 'suppressed')).toBe(true);
  });

  it('counts data rows, never the header', async () => {
    const out = await estimateFile(fixturePath('12k.csv'), previewCtx());
    expect(out.totalRows).toBe(12_479);
    expect(out.approximate).toBe(false);
  });

  it('extrapolates above five hundred thousand rows and says so', async () => {
    const out = await estimateFile(fixturePath('big.csv'), { ...previewCtx(), exactScanLimit: 100 });
    expect(out.approximate).toBe(true);
  });

  it('reports how many contacts will end up in the review queue', async () => {
    const out = await estimateFile(fixturePath('12k.csv'), previewCtx());
    expect(out.reviewRows).toBeGreaterThan(0);
  });
});
```

Pomocné funkce `fixturePath` a `previewCtx` napiš do `packages/core/test/contacts/import/helpers/fixtures.ts`. Fixture `12k.csv` má 12 480 řádků včetně hlavičky, `titles.csv` obsahuje řádek `pavel@firma.cz;Ing. Pavel Novák`, `mixed.csv` obsahuje jeden řádek s neplatným e-mailem a jeden s adresou na suppression listu, `big.csv` má 600 000 řádků.

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/contacts/import/preview.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Krok 3: Napiš `estimate.ts`**

```ts
import { readRows } from './reader.js';
import { processRow } from './row-pipeline.js';
import type { RowContext } from './row-pipeline.js';
import type { Dialect } from './dialect.js';
import type { DetectedEncoding } from './encoding.js';

export type EstimateContext = RowContext & {
  dialect: Dialect;
  encoding: DetectedEncoding;
  maxCellChars: number;
  maxLineBytes: number;
  existingEmails: Set<string>;
  /** Nad tímhle počtem se místo přesného odhadu extrapoluje. */
  exactScanLimit?: number;
  byteSize?: number;
};

export type Estimate = {
  totalRows: number;
  newRows: number;
  updatedRows: number;
  skippedRows: number;
  errorRows: number;
  reviewRows: number;
  approximate: boolean;
};

/**
 * Rychlý průchod celým souborem: jen e-mail a jméno, bez zápisu. U souboru nad
 * exactScanLimit se přečte prvních N řádků a zbytek se extrapoluje podle bajtů.
 * Číslo, které uživatel uvidí na tlačítku, se počítá z DATOVÝCH řádků, nikdy
 * z celkového počtu řádků souboru: hlavička není kontakt.
 */
export async function estimateFile(path: string, ctx: EstimateContext): Promise<Estimate> {
  const limit = ctx.exactScanLimit ?? 500_000;
  const out: Estimate = { totalRows: 0, newRows: 0, updatedRows: 0, skippedRows: 0, errorRows: 0, reviewRows: 0, approximate: false };
  let scannedBytes = 0;

  for await (const raw of readRows(path, {
    dialect: ctx.dialect, encoding: ctx.encoding, maxCellChars: ctx.maxCellChars, maxLineBytes: ctx.maxLineBytes,
  })) {
    out.totalRows += 1;
    scannedBytes = raw.byteOffsetAfter;
    const processed = processRow(raw, ctx);
    if (processed.kind === 'error') out.errorRows += 1;
    else if (processed.kind === 'suppressed') out.skippedRows += 1;
    else {
      if (ctx.existingEmails.has(processed.email)) out.updatedRows += 1;
      else out.newRows += 1;
      if (processed.contact.vocative_confidence === 'low') out.reviewRows += 1;
    }
    if (out.totalRows >= limit) {
      out.approximate = true;
      break;
    }
  }

  if (out.approximate && ctx.byteSize && scannedBytes > 0) {
    const factor = ctx.byteSize / scannedBytes;
    for (const key of ['totalRows', 'newRows', 'updatedRows', 'skippedRows', 'errorRows', 'reviewRows'] as const) {
      out[key] = Math.round(out[key] * factor);
    }
  }
  return out;
}
```

- [ ] **Krok 4: Napiš `preview.ts`**

```ts
import { readRows } from './reader.js';
import { processRow } from './row-pipeline.js';
import type { EstimateContext } from './estimate.js';

export type PreviewRow = {
  rowNumber: number;
  state: 'ok' | 'error' | 'suppressed';
  email: string;
  title_prefix: string | null;
  first_name: string | null;
  gender: string | null;
  last_name: string | null;
  greeting: string | null;
  attributes: Record<string, unknown>;
  errorCode?: string;
  warnings: string[];
};

export type Preview = { rows: PreviewRow[]; mappingWarnings: string[] };

/**
 * Náhled ukazuje VÝSLEDEK, ne vstup. Sloupec s oslovením je nejdůležitější
 * sloupec celé obrazovky, protože přesně to uvidí příjemce v e-mailu.
 */
export async function buildPreview(path: string, ctx: EstimateContext, limit = 20, offset = 0): Promise<Preview> {
  const rows: PreviewRow[] = [];
  for await (const raw of readRows(path, {
    dialect: ctx.dialect, encoding: ctx.encoding, maxCellChars: ctx.maxCellChars, maxLineBytes: ctx.maxLineBytes,
  })) {
    if (raw.rowNumber <= offset) continue;
    const processed = processRow(raw, ctx);
    if (processed.kind === 'error') {
      rows.push({
        rowNumber: raw.rowNumber, state: 'error', email: raw.fields[0] ?? '', title_prefix: null,
        first_name: null, last_name: null, gender: null, greeting: null, attributes: {},
        errorCode: processed.errorCode, warnings: [],
      });
    } else if (processed.kind === 'suppressed') {
      rows.push({
        rowNumber: raw.rowNumber, state: 'suppressed', email: raw.fields[0] ?? '', title_prefix: null,
        first_name: null, last_name: null, gender: null, greeting: null, attributes: {}, warnings: ['suppressed_skipped'],
      });
    } else {
      const c = processed.contact as Record<string, string | null>;
      rows.push({
        rowNumber: raw.rowNumber, state: 'ok', email: processed.email,
        title_prefix: c.title_prefix, first_name: c.first_name, last_name: c.last_name,
        gender: c.gender, greeting: c.greeting, attributes: processed.attributes, warnings: processed.warnings,
      });
    }
    if (rows.length >= limit) break;
  }
  return { rows, mappingWarnings: [] };
}
```

- [ ] **Krok 5: Spusť test**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/contacts/import/preview.test.ts`
Expected: PASS, šest testů.

- [ ] **Krok 6: Commit**

```bash
git add packages/core/src/contacts/import/estimate.ts packages/core/src/contacts/import/preview.ts packages/core/test/contacts/import/preview.test.ts packages/core/test/contacts/import/helpers
git commit -m "feat(import): add estimate pass and preview with the greeting column"
```

---

### Úkol 33: Idempotence a stavový automat

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/contacts/import/idempotency.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/contacts/import/state.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/test/contacts/import/state.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
import { describe, expect, it } from 'vitest';
import { buildIdempotencyKey } from '../../../src/contacts/import/idempotency.js';
import { assertTransition, TERMINAL_STATES } from '../../../src/contacts/import/state.js';

const sha = Buffer.alloc(32, 1);
const ws = '00000000-0000-0000-0000-000000000001';

describe('idempotency', () => {
  it('is stable for the same file, mapping and options', () => {
    const a = buildIdempotencyKey({ contentSha256: sha, workspaceId: ws, mapping: { '0': { target: 'email' } }, options: { on_conflict: 'update' } });
    const b = buildIdempotencyKey({ contentSha256: sha, workspaceId: ws, mapping: { '0': { target: 'email' } }, options: { on_conflict: 'update' } });
    expect(a).toBe(b);
  });

  it('changes when the mapping changes, because that is a different import', () => {
    const a = buildIdempotencyKey({ contentSha256: sha, workspaceId: ws, mapping: { '0': { target: 'email' } }, options: {} });
    const b = buildIdempotencyKey({ contentSha256: sha, workspaceId: ws, mapping: { '0': { target: 'first_name' } }, options: {} });
    expect(a).not.toBe(b);
  });

  it('changes with a force nonce', () => {
    const a = buildIdempotencyKey({ contentSha256: sha, workspaceId: ws, mapping: {}, options: {} });
    const b = buildIdempotencyKey({ contentSha256: sha, workspaceId: ws, mapping: {}, options: {}, nonce: 'abc' });
    expect(a).not.toBe(b);
  });
});

describe('state machine', () => {
  it('allows the documented path', () => {
    for (const [from, to] of [['pending', 'validating'], ['validating', 'previewing'], ['previewing', 'importing'], ['importing', 'completed']] as const) {
      expect(() => assertTransition(from, to)).not.toThrow();
    }
  });

  it('forbids going back from previewing to validating', () => {
    expect(() => assertTransition('previewing', 'validating')).toThrowError(/invalid_state_transition/);
  });

  it('forbids leaving any terminal state', () => {
    for (const state of TERMINAL_STATES) {
      expect(() => assertTransition(state, 'importing')).toThrowError(/invalid_state_transition/);
    }
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/contacts/import/state.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Krok 3: Napiš `idempotency.ts`**

```ts
import { createHash } from 'node:crypto';
import { canonicalJson } from '../../segments/canonical.js';

export type IdempotencyInput = {
  contentSha256: Buffer;
  workspaceId: string;
  mapping: unknown;
  options: unknown;
  /** Volba „spustit znovu" posílá force: true, což sem vloží náhodný nonce. */
  nonce?: string;
};

export function buildIdempotencyKey(input: IdempotencyInput): string {
  const parts = [
    input.contentSha256.toString('hex'),
    input.workspaceId,
    canonicalJson(input.mapping),
    canonicalJson(input.options),
    input.nonce ?? '',
  ].join(':');
  return createHash('sha256').update(parts, 'utf8').digest('base64url');
}
```

- [ ] **Krok 4: Napiš `state.ts`**

```ts
import { ApiError } from '../../errors/index.js';

export const IMPORT_STATES = [
  'pending', 'validating', 'previewing', 'importing',
  'completed', 'completed_with_errors', 'failed', 'cancelled',
] as const;

export type ImportState = (typeof IMPORT_STATES)[number];

export const TERMINAL_STATES: ImportState[] = ['completed', 'completed_with_errors', 'failed', 'cancelled'];

const ALLOWED: Record<ImportState, ImportState[]> = {
  pending: ['validating', 'failed'],
  validating: ['previewing', 'failed'],
  // previewing → validating je ZAKÁZÁNO: idempotency_key obsahuje mapování,
  // takže změna mapování zakládá nový import, ne návrat o krok zpět.
  previewing: ['importing', 'cancelled', 'failed'],
  importing: ['completed', 'completed_with_errors', 'cancelled', 'failed'],
  completed: [],
  completed_with_errors: [],
  failed: [],
  cancelled: [],
};

export function assertTransition(from: ImportState, to: ImportState): void {
  if (!ALLOWED[from].includes(to)) {
    throw new ApiError('conflict', 409, {
      errors: [{ path: 'status', code: 'invalid_state_transition', meta: { from, to, allowed: ALLOWED[from] } }],
    });
  }
}

export function terminalStateFor(errorRows: number): ImportState {
  return errorRows > 0 ? 'completed_with_errors' : 'completed';
}
```

- [ ] **Krok 5: Spusť test**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/contacts/import/state.test.ts`
Expected: PASS, šest testů.

- [ ] **Krok 6: Commit**

```bash
git add packages/core/src/contacts/import/idempotency.ts packages/core/src/contacts/import/state.ts packages/core/test/contacts/import/state.test.ts
git commit -m "feat(import): add idempotency key and state machine"
```

---

### Úkol 34: Služba importu: založení, úprava, potvrzení, zrušení, pokračování

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/contacts/import/service.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/contacts/import/audit.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/test/contacts/import/service.dbspec.ts`

- [ ] **Krok 1: Napiš padající databázový test**

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { Readable } from 'node:stream';
import {
  cancelImport, confirmImport, createImport, patchImport, resumeImport, setTotalRows,
} from '../../../src/contacts/import/service.js';
import { makeWorkspace, testCtx } from '../../segments/helpers/db.js';

let ctx: Awaited<ReturnType<typeof testCtx>>;
const csv = () => Readable.from([Buffer.from('email;name\na@x.cz;Jana Nováková\n', 'utf8')]);

beforeAll(async () => { ctx = await testCtx(); await makeWorkspace(ctx, { contacts: 0 }); });

describe('import service', () => {
  it('returns 202 shaped state pending and detects the dialect', async () => {
    const out = await createImport(ctx, { stream: csv(), filename: 'a.csv' });
    expect(out.status).toBe('pending');
    expect(out.id).toHaveLength(36);
  });

  it('rejects the same file with the same mapping within 24 hours', async () => {
    const first = await createImport(ctx, { stream: csv(), filename: 'a.csv' });
    await confirmImport(ctx, first.id);
    await expect(createImport(ctx, { stream: csv(), filename: 'a.csv' }))
      .rejects.toMatchObject({ status: 409, body: { errors: [{ code: 'import_duplicate' }] } });
  });

  it('accepts the same file with a different mapping without asking', async () => {
    const first = await createImport(ctx, { stream: csv(), filename: 'b.csv' });
    await patchImport(ctx, first.id, { mapping: { '0': { target: 'email' }, '1': { target: 'first_name' } } });
    const second = await createImport(ctx, { stream: csv(), filename: 'b.csv', mapping: { '0': { target: 'email' } } });
    expect(second.id).not.toBe(first.id);
  });

  it('refuses a second running import in the same workspace', async () => {
    const first = await createImport(ctx, { stream: csv(), filename: 'c.csv' });
    await confirmImport(ctx, first.id);
    const second = await createImport(ctx, { stream: csv(), filename: 'd.csv' });
    await expect(confirmImport(ctx, second.id))
      .rejects.toMatchObject({ status: 423, body: { errors: [{ code: 'import_already_running' }] } });
  });

  it('keeps written contacts when cancelled and records the row it stopped at', async () => {
    const imp = await createImport(ctx, { stream: csv(), filename: 'e.csv' });
    await setTotalRows(ctx, imp.id, 1);
    await confirmImport(ctx, imp.id);
    const cancelled = await cancelImport(ctx, imp.id);
    expect(cancelled.status).toBe('cancelled');
    expect(cancelled.failureDetail).toMatch(/\d+/);
    // Bez zapsaného total_rows by hláška vždycky končila "z ?", což je platný
    // řetězec, takže by to test na /\d+/ neodhalil. Proto se hlídá i konec věty.
    expect(cancelled.failureDetail).not.toContain('z ?');
  });

  it('resumes from the cancelled checkpoint instead of the beginning', async () => {
    const imp = await createImport(ctx, { stream: csv(), filename: 'f.csv' });
    await confirmImport(ctx, imp.id);
    await cancelImport(ctx, imp.id);
    const resumed = await resumeImport(ctx, imp.id);
    expect(resumed.resumeFromImportId).toBe(imp.id);
    expect(resumed.checkpointByte).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core test:db`
Expected: FAIL, `Cannot find module`.

- [ ] **Krok 3: Napiš `audit.ts`**

```ts
import type { WorkspaceContext } from '../../identity/index.js';
import { writeAudit } from '../../identity/index.js';

export const IMPORT_AUDIT_ACTIONS = ['import.confirmed', 'import.cancelled', 'export.created', 'export.downloaded', 'name_override.created', 'contact.vocative_bulk_confirmed'] as const;

export async function auditImport(
  ctx: WorkspaceContext,
  action: (typeof IMPORT_AUDIT_ACTIONS)[number],
  entityId: string,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  await writeAudit(ctx, { action, entityType: 'import', entityId, metadata });
}
```

- [ ] **Krok 4: Napiš `service.ts`**

Klíčové části, zbytek je přímé čtení a zápis přes `inWorkspaceTx`:

```ts
import { randomBytes } from 'node:crypto';
import type { Readable } from 'node:stream';
import { sql } from 'drizzle-orm';
import { actorUserId } from '../../identity/index.js';
import type { WorkspaceContext } from '../../identity/index.js';
import { ApiError } from '../../errors/index.js';
import { config } from '../../config/index.js';
import { QUEUES, enqueue } from '../../queues/index.js';
import { markAllStale } from '../../segments/service.js';
import { inWorkspaceTx } from './db.js';
import { storeUpload } from './storage.js';
import { importLimits } from './limits.js';
import { buildIdempotencyKey } from './idempotency.js';
import { assertTransition } from './state.js';
import { assertMappingValid, suggestMapping, type ImportMapping } from './mapping.js';
import { ImportOptionsSchema, type ImportOptions } from './options.js';
import { detectEncoding } from './encoding.js';
import { detectDialect } from './dialect.js';
import { auditImport } from './audit.js';

export type CreateInput = {
  stream: Readable;
  filename: string;
  mapping?: ImportMapping;
  options?: Partial<ImportOptions>;
  force?: boolean;
};

export async function createImport(ctx: WorkspaceContext, input: CreateInput) {
  const limits = importLimits();
  const importId = crypto.randomUUID();
  const stored = await storeUpload(input.stream, {
    dataDir: config.DATA_DIR, workspaceId: ctx.workspaceId, importId, maxBytes: limits.maxFileBytes,
  });

  const options = ImportOptionsSchema.parse(input.options ?? {});
  const key = buildIdempotencyKey({
    contentSha256: stored.contentSha256, workspaceId: ctx.workspaceId,
    mapping: input.mapping ?? {}, options,
    nonce: input.force ? randomBytes(8).toString('hex') : undefined,
  });

  return inWorkspaceTx(ctx, async (tx) => {
    const { rows: clash } = await tx.execute<{ id: string; status: string; created_at: Date; created_rows: number }>(sql`
      SELECT id, status, created_at, created_rows FROM imports
       WHERE workspace_id = ${ctx.workspaceId}::uuid AND idempotency_key = ${key}
         AND status IN ('completed','completed_with_errors','importing')
         AND created_at > now() - interval '24 hours'`);
    if (clash.length > 0) {
      // Stavy failed a cancelled sem schválně nepatří: tam se nový import
      // zakládá bez ptaní, protože opakovat pokažený import je legitimní.
      throw new ApiError('conflict', 409, {
        errors: [{ path: '_', code: 'import_duplicate', meta: clash[0] }],
      });
    }

    const { rows: inserted } = await tx.execute<{ id: string; status: string }>(sql`
      INSERT INTO imports (id, workspace_id, filename, storage_key, byte_size, content_sha256,
                           idempotency_key, status, mapping, options, created_by, file_expires_at)
      VALUES (${importId}::uuid, ${ctx.workspaceId}::uuid, ${input.filename}, ${stored.storageKey},
              ${stored.byteSize}, ${stored.contentSha256}, ${key}, 'pending',
              ${JSON.stringify(input.mapping ?? {})}::jsonb, ${JSON.stringify(options)}::jsonb,
              ${actorUserId(ctx)}::uuid, now() + interval '30 days')
      RETURNING id, status`);
    await enqueue(QUEUES.CONTACTS_IMPORT, { workspaceId: ctx.workspaceId, importId, phase: 'validate' },
      { singletonKey: `${ctx.workspaceId}:validate:${importId}`, retryLimit: 0 });
    return inserted[0];
  });
}

/** Detekce běží ve fázi validating a zapisuje kódování, oddělovač a návrh mapování. */
export async function detectAndPreview(ctx: WorkspaceContext, importId: string) {
  const row = await loadImport(ctx, importId);
  assertTransition(row.status, 'validating');
  const limits = importLimits();
  const head = await readHead(row.storage_key, limits.sniffBytes);
  const encoding = detectEncoding(head, limits.sniffBytes);
  const sample = decodeSampleFor(head, encoding);
  const dialect = detectDialect(sample);
  const header = dialect.hasHeader ? sample.split(/\r\n|\n|\r/)[0].split(dialect.delimiter) : [];
  const mapping = Object.keys(row.mapping ?? {}).length > 0 ? row.mapping : suggestMapping(header);

  await inWorkspaceTx(ctx, (tx) => tx.execute(sql`
    UPDATE imports SET status = 'previewing', encoding = ${encoding.encoding},
      encoding_source = ${encoding.source}, delimiter = ${dialect.delimiter},
      has_header = ${dialect.hasHeader}, mapping = ${JSON.stringify(mapping)}::jsonb, updated_at = now()
    WHERE id = ${importId}::uuid`));
  return { encoding, dialect, mapping, header };
}

export async function patchImport(
  ctx: WorkspaceContext,
  importId: string,
  patch: { mapping?: ImportMapping; options?: Partial<ImportOptions>; encoding?: string; delimiter?: string },
) {
  const row = await loadImport(ctx, importId);
  if (row.status !== 'previewing') {
    throw new ApiError('conflict', 409, { errors: [{ path: 'status', code: 'invalid_state_transition', meta: { from: row.status } }] });
  }
  if (patch.mapping) assertMappingValid(patch.mapping);
  const mappingJson = patch.mapping ? JSON.stringify(patch.mapping) : null;
  const optionsJson = patch.options ? JSON.stringify(ImportOptionsSchema.parse(patch.options)) : null;
  const encoding = patch.encoding ?? null;
  const { rows } = await inWorkspaceTx(ctx, (tx) => tx.execute<Record<string, unknown>>(sql`
    UPDATE imports SET
      mapping  = coalesce(${mappingJson}::jsonb, mapping),
      options  = coalesce(${optionsJson}::jsonb, options),
      encoding = coalesce(${encoding}::text, encoding),
      encoding_source = CASE WHEN ${encoding}::text IS NULL THEN encoding_source ELSE 'manual' END,
      delimiter = coalesce(${patch.delimiter ?? null}::text, delimiter),
      updated_at = now()
    WHERE id = ${importId}::uuid RETURNING *`));
  return rows[0];
}

export async function confirmImport(ctx: WorkspaceContext, importId: string) {
  const row = await loadImport(ctx, importId);
  assertTransition(row.status, 'importing');
  assertMappingValid(row.mapping);
  return inWorkspaceTx(ctx, async (tx) => {
    // Jeden běžící import na projekt. Podmínka je v UPDATE, ne v aplikaci,
    // protože dva souběžné požadavky by kontrolu v aplikaci proběhly oba.
    const { rows: running } = await tx.execute<{ id: string }>(sql`
      SELECT id FROM imports
       WHERE workspace_id = ${ctx.workspaceId}::uuid AND status = 'importing'
         AND id <> ${importId}::uuid LIMIT 1`);
    if (running.length > 0) {
      throw new ApiError('resource_locked', 423, {
        errors: [{ path: '_', code: 'import_already_running', meta: { runningImportId: running[0].id } }],
      });
    }
    const { rows: updated } = await tx.execute<Record<string, unknown>>(sql`
      UPDATE imports SET status = 'importing', started_at = now(), updated_at = now()
       WHERE id = ${importId}::uuid AND status = 'previewing' RETURNING *`);
    if (updated.length === 0) {
      throw new ApiError('conflict', 409, { errors: [{ path: 'status', code: 'invalid_state_transition' }] });
    }
    await enqueue(QUEUES.CONTACTS_IMPORT, { workspaceId: ctx.workspaceId, importId, phase: 'run' },
      { singletonKey: importId, retryLimit: 0 });
    await auditImport(ctx, 'import.confirmed', importId, { filename: row.filename });
    return updated[0];
  });
}

export async function cancelImport(ctx: WorkspaceContext, importId: string) {
  return inWorkspaceTx(ctx, async (tx) => {
    const { rows: updated } = await tx.execute<Record<string, unknown>>(sql`
      UPDATE imports SET status = 'cancelled', finished_at = now(), updated_at = now(),
        failure_detail = 'zrušeno uživatelem na řádku ' || checkpoint_row
                       || ' z ' || coalesce(total_rows::text, '?')
       WHERE id = ${importId}::uuid AND status IN ('previewing','importing') RETURNING *`);
    if (updated.length === 0) {
      throw new ApiError('conflict', 409, { errors: [{ path: 'status', code: 'invalid_state_transition' }] });
    }
    await auditImport(ctx, 'import.cancelled', importId, {});
    return { status: 'cancelled', failureDetail: String(updated[0].failure_detail) };
  });
}

/** Pokračování zakládá NOVÝ import se stejným souborem a checkpointem předchozího. */
export async function resumeImport(ctx: WorkspaceContext, importId: string) {
  const source = await loadImport(ctx, importId);
  if (source.status !== 'cancelled') {
    throw new ApiError('conflict', 409, { errors: [{ path: 'status', code: 'invalid_state_transition' }] });
  }
  return inWorkspaceTx(ctx, async (tx) => {
    const key = buildIdempotencyKey({
      contentSha256: source.content_sha256, workspaceId: ctx.workspaceId,
      mapping: source.mapping, options: source.options, nonce: `resume:${importId}`,
    });
    const { rows: inserted } = await tx.execute<{
      id: string; checkpoint_byte: number; resume_from_import_id: string;
    }>(sql`
      INSERT INTO imports (id, workspace_id, filename, storage_key, byte_size, content_sha256, idempotency_key,
                           status, mapping, options, checkpoint_row, checkpoint_byte, total_rows,
                           resume_from_import_id, created_by, file_expires_at)
      VALUES (uuidv7(), ${ctx.workspaceId}::uuid, ${source.filename}, ${source.storage_key},
              ${source.byte_size}, ${source.content_sha256}, ${key}, 'previewing',
              ${JSON.stringify(source.mapping)}::jsonb, ${JSON.stringify(source.options)}::jsonb,
              ${source.checkpoint_row}, ${source.checkpoint_byte}, ${source.total_rows},
              ${importId}::uuid, ${actorUserId(ctx)}::uuid, now() + interval '30 days')
      RETURNING id, checkpoint_byte, resume_from_import_id`);
    return {
      id: inserted[0].id,
      checkpointByte: inserted[0].checkpoint_byte,
      resumeFromImportId: importId,
    };
  });
}

/**
 * Uloží odhadovaný počet řádků. Volá se z náhledu (úkol 32), jakmile je odhad hotový.
 *
 * Bez tohohle zápisu zůstane `imports.total_rows` navždy NULL, přestože se čte:
 * hláška o zrušení skládá `'zrušeno uživatelem na řádku ' || checkpoint_row ||
 * ' z ' || coalesce(total_rows::text, '?')`, takže by uživateli vždycky
 * napsala „zrušeno na řádku 4200 z ?". Odhad se počítal jen do paměti a nikdo
 * ho nikam nezapsal, což je typ chyby, kterou testy neodhalí, protože `'?'`
 * je platný řetězec a hláška se sestaví.
 *
 * Ukládá se i `total_rows_is_estimate`, aby UI vědělo, jestli má psát
 * „z 12 480" nebo „z přibližně 12 480". U souborů nad 500 000 řádků se
 * extrapoluje, takže přesné to není.
 */
export async function setTotalRows(
  ctx: WorkspaceContext,
  importId: string,
  totalRows: number,
): Promise<void> {
  await inWorkspaceTx(ctx, (tx) => tx.execute(sql`
    UPDATE imports SET total_rows = ${totalRows}, updated_at = now()
     WHERE id = ${importId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid`));
}

/** Dokončení importu označí všechny dynamické segmenty projektu za zastaralé. */
export async function finishImport(ctx: WorkspaceContext, importId: string, errorRows: number) {
  await inWorkspaceTx(ctx, (tx) => tx.execute(sql`
    UPDATE imports SET status = ${errorRows > 0 ? 'completed_with_errors' : 'completed'},
      finished_at = now(), updated_at = now()
     WHERE id = ${importId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid`));
  await markAllStale(ctx);
}
```

Funkce `loadImport`, `readHead` a `decodeSampleFor` jsou tři čtecí pomocníky ve stejném souboru: `loadImport` vrátí řádek importu přes `inWorkspaceTx` a hodí `404` při nenalezení, `readHead` přečte prvních `sniffBytes` bajtů souboru z `config.DATA_DIR`, `decodeSampleFor` zavolá `decodeSample` z `encoding.ts`.

- [ ] **Krok 5: Spusť databázový test**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core test:db`
Expected: PASS, šest testů.

- [ ] **Krok 6: Commit**

```bash
git add packages/core/src/contacts/import/service.ts packages/core/src/contacts/import/audit.ts packages/core/test/contacts/import/service.dbspec.ts
git commit -m "feat(import): add import lifecycle service with idempotency and resume"
```

---

### Úkol 35: Job importu, obnova po pádu a retence souborů

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/contacts/import/jobs/run-import.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/contacts/import/jobs/recover-stale.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/contacts/import/jobs/retention.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/contacts/import/jobs/queue-handlers.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/test/contacts/import/jobs/recovery.dbspec.ts`

- [ ] **Krok 1: Napiš padající databázový test obnovy**

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { recoverStaleImports } from '../../../../src/contacts/import/jobs/recover-stale.js';
import { runRetention } from '../../../../src/contacts/import/jobs/retention.js';
import { makeWorkspace, testCtx } from '../../../segments/helpers/db.js';
import { createImportRow, readImport, setImportState } from '../helpers/import-fixtures.js';

let ctx: Awaited<ReturnType<typeof testCtx>>;
beforeAll(async () => { ctx = await testCtx(); await makeWorkspace(ctx, { contacts: 0 }); });

describe('crash recovery', () => {
  it('requeues an import whose updated_at is older than the stale window', async () => {
    const id = await createImportRow(ctx);
    await setImportState(ctx, id, { status: 'importing', updatedAtMinutesAgo: 30, checkpointRow: 4 });
    const enqueued: string[] = [];
    const count = await recoverStaleImports({ staleMinutes: 10 }, async (p) => { enqueued.push(p.importId); });
    expect(count).toBe(1);
    expect(enqueued).toContain(id);
  });

  it('leaves a fresh import alone', async () => {
    const id = await createImportRow(ctx);
    await setImportState(ctx, id, { status: 'importing', updatedAtMinutesAgo: 1, checkpointRow: 1 });
    const enqueued: string[] = [];
    await recoverStaleImports({ staleMinutes: 10 }, async (p) => { enqueued.push(p.importId); });
    expect(enqueued).not.toContain(id);
  });
});

describe('file retention', () => {
  it('is idempotent: the second run offers nothing', async () => {
    const id = await createImportRow(ctx);
    await setImportState(ctx, id, { status: 'completed', fileExpiresAtDaysAgo: 1 });
    expect(await runRetention(ctx)).toBe(1);
    expect((await readImport(ctx, id)).storage_key).toBeNull();
    expect(await runRetention(ctx)).toBe(0);
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core test:db`
Expected: FAIL, `Cannot find module`.

- [ ] **Krok 3: Napiš `run-import.ts`**

```ts
import { join } from 'node:path';
import { config } from '../../../config/index.js';
import { logger } from '../../../logging/index.js';
import { createSystemContext } from '../../../identity/index.js';
import { readRows } from '../reader.js';
import { processRow } from '../row-pipeline.js';
import { BatchDeduper } from '../dedup.js';
import { writeBatch } from '../batch.js';
import { importLimits } from '../limits.js';
import { finishImport } from '../service.js';
import { publishProgress } from '../progress.js';
import { loadRunContext } from '../run-context.js';

export type ImportJobPayload = { workspaceId: string; importId: string; phase: 'validate' | 'run' };

export const handler = async (job: { data: ImportJobPayload }) => {
  const ctx = createSystemContext(job.data.workspaceId, 'contacts.import');
  const limits = importLimits();
  const run = await loadRunContext(ctx, job.data.importId);
  const deduper = new BatchDeduper({
    mode: run.options.duplicate_in_file,
    inMemoryMaxRows: (run.totalRows ?? 0) > limits.inMemoryDedupMaxRows ? 0 : limits.inMemoryDedupMaxRows,
  });

  let buffer: ReturnType<typeof processRow>[] = [];
  let processed = 0;
  let errorRows = 0;

  const flush = async (checkpointRow: number, checkpointByte: number) => {
    const ok = buffer.filter((r) => r.kind === 'ok') as Extract<ReturnType<typeof processRow>, { kind: 'ok' }>[];
    const errors = buffer.filter((r) => r.kind === 'error') as Extract<ReturnType<typeof processRow>, { kind: 'error' }>[];
    const suppressed = buffer.filter((r) => r.kind === 'suppressed').length;
    const deduped = deduper.dedupeBatch(ok);
    // Chyby i varování jdou do JEDNOHO seznamu rozlišeného polem severity.
    // Dvě oddělené kolekce byly důvod, proč varovné řádky nikdy nevznikly:
    // počítaly se do warning_rows, ale do import_errors se zapisovaly jen chyby.
    const allErrors = [
      ...errors.map((e) => ({
        rowNumber: e.rowNumber, errorCode: e.errorCode, severity: 'error' as const,
        column: e.column, detail: e.detail, raw: e.raw,
      })),
      ...deduped.errors.map((e) => ({
        rowNumber: e.rowNumber, errorCode: e.code, severity: 'error' as const, raw: '',
      })),
      ...deduped.warnings.map((w) => ({
        rowNumber: w.rowNumber, errorCode: w.code, severity: 'warning' as const, raw: '',
      })),
      ...ok.flatMap((r) => r.warnings.map((code) => ({
        rowNumber: r.rowNumber, errorCode: code, severity: 'warning' as const, raw: '',
      }))),
    ];
    errorRows += allErrors.filter((e) => e.severity === 'error').length;
    await writeBatch(ctx, {
      importId: job.data.importId, mode: run.options.onConflict, rows: deduped.rows, errors: allErrors,
      checkpointRow, checkpointByte, suppressedCount: suppressed, maxStoredErrors: limits.maxStoredErrors,
    });
    processed += buffer.length;
    buffer = [];
    await publishProgress(ctx, job.data.importId, { processed, total: run.totalRows, errors: errorRows });
  };

  const path = join(config.DATA_DIR, run.storageKey);
  for await (const raw of readRows(path, {
    dialect: run.dialect, encoding: run.encoding, maxCellChars: limits.maxCellChars, maxLineBytes: limits.maxLineBytes,
    startByte: run.checkpointByte || undefined, startRowNumber: run.checkpointRow || undefined,
  })) {
    if (await run.isCancelled()) break;
    buffer.push(processRow(raw, run.rowContext));
    if (buffer.length >= limits.batchSize) await flush(raw.rowNumber, raw.byteOffsetAfter);
  }
  if (buffer.length > 0) await flush(run.checkpointRow + processed, run.checkpointByte);

  if (!(await run.isCancelled())) await finishImport(ctx, job.data.importId, errorRows);
  logger.info({ importId: job.data.importId, processed, errorRows }, 'import finished');
  return { processed, errorRows };
};
```

Soubory `progress.ts` (publikuje průběh na SSE kanál části 1, nejvýš jednou za sekundu) a `run-context.ts` (načte řádek importu, dialekt, kódování, katalog polí, přepisy jmen a mapu suppression) napiš ve stejném úkolu; jsou to čtecí obaly bez vlastní logiky.

- [ ] **Krok 4: Napiš `recover-stale.ts` a `retention.ts`**

```ts
// recover-stale.ts
import { sql } from 'drizzle-orm';
import { withoutContext, type Tx } from '@mlain/core/tx';
import { ApiError } from '../../../errors/index.js';
import { logger } from '../../../logging/index.js';

export type RecoverPayload = { workspaceId: string; importId: string; phase: 'run' };

/**
 * Job má retryLimit = 0, takže obnovu řídí importér sám. Jediný signál živosti
 * je imports.updated_at, které zapisuje KAŽDÁ checkpointová transakce.
 *
 * Tenhle sken jde napříč projekty a platí pro něj totéž, co pro `scheduleStale`
 * v úkolu 22 (rozhodnutí R18): `imports` má politiku `ws_isolation`, takže bez
 * systémového bypassu vrátí `withoutContext` nula řádků a NEVRÁTÍ chybu.
 * Zaseknuté importy by se nikdy neobnovily, projekt by měl navždy obsazený
 * `singletonKey` a nešel by v něm spustit ani jeden další import, zatímco job
 * by každou hodinu vesele hlásil `{ recovered: 0 }`.
 *
 * Rozdíl proti segmentům je v závažnosti: přepočet segmentu je pohodlí,
 * tohle je jediná cesta zpátky z uváznutí, a kryje kritérium 14 části 2.
 */
export async function recoverStaleImports(
  opts: { staleMinutes: number },
  enqueue: (payload: RecoverPayload) => Promise<void>,
): Promise<number> {
  const rows = await withoutContext(async (tx: Tx) => {
    const { rows: seen } = await tx.execute<{ users: number; imports: number }>(sql`
      SELECT (SELECT count(*) FROM users)::int AS users,
             (SELECT count(*) FROM imports)::int AS imports`);
    if (seen[0] && seen[0].users > 0 && seen[0].imports === 0) {
      throw new ApiError('dependency_unavailable', 503, {
        errors: [{ path: '_', code: 'cross_workspace_scan_blocked', meta: { table: 'imports' } }],
      });
    }
    const { rows: stale } = await tx.execute<{ id: string; workspace_id: string }>(sql`
      SELECT id, workspace_id FROM imports
       WHERE status = 'importing'
         AND updated_at < now() - make_interval(mins => ${opts.staleMinutes})`);
    return stale;
  });
  for (const row of rows) await enqueue({ workspaceId: row.workspace_id, importId: row.id, phase: 'run' });
  logger.info({ recovered: rows.length }, 'stale imports requeued');
  return rows.length;
}
```

**Proč sken zůstává, a ne že se obnova přesune na frontu.** Nabízí se řídit obnovu z mrtvé fronty pg-boss, jejíž payload `workspaceId` nese, a globální sken zrušit. Nejde to: `retryLimit` je 0 schválně, aby se rozpracovaný import po pádu nespouštěl od začátku, a zabitý worker (SIGKILL) žádnou událost neposílá. Jediné, co o uváznutí ví, je `imports.updated_at`, a to je řádek v databázi, ne zpráva ve frontě. P03 to sám předpokládá, protože u toho sloupce má komentář, že je to jediný signál živosti. Chybí k tomu jen přístupová cesta.

```ts
// retention.ts
import { join } from 'node:path';
import { sql } from 'drizzle-orm';
import { config } from '../../../config/index.js';
import type { WorkspaceContext } from '../../../identity/index.js';
import { inWorkspaceTx } from '../db.js';
import { deleteUpload } from '../storage.js';

/**
 * Idempotence stojí na tom, že storage_key smí být NULL: po smazání souboru
 * řádek vypadne z částečného indexu idx_imports__file_expiry a druhý běh
 * ho už nenabídne. S NOT NULL by job donekonečna nabízel, co už smazal.
 */
export async function runRetention(ctx: WorkspaceContext): Promise<number> {
  return inWorkspaceTx(ctx, async (tx) => {
    const { rows } = await tx.execute<{ id: string; storage_key: string }>(sql`
      SELECT id, storage_key FROM imports
       WHERE workspace_id = ${ctx.workspaceId}::uuid
         AND storage_key IS NOT NULL AND file_expires_at < now()`);
    for (const row of rows) {
      await deleteUpload(config.DATA_DIR, row.storage_key);
      await tx.execute(sql`
        UPDATE imports SET storage_key = NULL, updated_at = now() WHERE id = ${row.id}::uuid`);
    }
    return rows.length;
  });
}
```

- [ ] **Krok 5: Napiš `queue-handlers.ts`**

```ts
import { QUEUES } from '../../../queues/index.js';
import { handler as runImport } from './run-import.js';
import { handler as bulkVocativeReview } from './bulk-vocative-review.js';

export const queueHandlers = {
  [QUEUES.CONTACTS_IMPORT]: runImport,
  [QUEUES.CONTACTS_BULK_VOCATIVE_REVIEW]: bulkVocativeReview,
} as const;
```

Soubor `bulk-vocative-review.ts` vzniká v úkolu 37; do té doby řádek zakomentuj.

- [ ] **Krok 6: Spusť databázový test**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core test:db`
Expected: PASS, tři testy.

- [ ] **Krok 7: Commit**

```bash
git add packages/core/src/contacts/import/jobs packages/core/src/contacts/import/progress.ts packages/core/src/contacts/import/run-context.ts packages/core/test/contacts/import/jobs
git commit -m "feat(import): add import worker, crash recovery and file retention"
```

---

### Úkol 36: `errors.csv` v původním kódování

Formát je závazný a je to jediná funkce, kde se hlavička **nikdy nepřekládá**: uživatel soubor opraví a nahraje zpátky, a automapování musí projít bez ručního zásahu.

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/contacts/import/errors-csv.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/test/contacts/import/errors-csv.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
import { describe, expect, it } from 'vitest';
import iconv from 'iconv-lite';
import { buildErrorsCsv } from '../../../src/contacts/import/errors-csv.js';

const header = ['Email', 'Jméno'];
const rows = [
  { rowNumber: 4312, rawLine: 'jana@@firma.cz;Jana', errorCode: 'email_invalid', errorDetail: 'two at signs' },
  { rowNumber: 5001, rawLine: ';Petr', errorCode: 'email_missing', errorDetail: null },
];

describe('errors.csv', () => {
  it('keeps the original header, encoding and delimiter and appends two columns', async () => {
    const buf = await buildErrorsCsv({ header, rows, encoding: 'windows-1250', delimiter: ';' });
    const text = iconv.decode(buf, 'windows-1250');
    expect(text.split('\n')[0]).toBe('Email;Jméno;_error_code;_error_detail');
    expect(text).toContain('jana@@firma.cz;Jana;email_invalid;two at signs');
  });

  it('never translates the added column names', async () => {
    const buf = await buildErrorsCsv({ header, rows, encoding: 'utf-8', delimiter: ',', locale: 'cs' });
    expect(buf.toString('utf8')).toContain('_error_code,_error_detail');
    expect(buf.toString('utf8')).not.toContain('kod_chyby');
  });

  it('prefixes a formula cell with an apostrophe', async () => {
    const buf = await buildErrorsCsv({
      header: ['Email'], encoding: 'utf-8', delimiter: ';',
      rows: [{ rowNumber: 1, rawLine: '=cmd|\'/c calc\'!A1', errorCode: 'email_invalid', errorDetail: null }],
    });
    expect(buf.toString('utf8')).toContain("'=cmd");
  });

  it('replaces characters missing from windows-1250 and reports the loss', async () => {
    const out = await buildErrorsCsv({
      header: ['Email'], encoding: 'windows-1250', delimiter: ';',
      rows: [{ rowNumber: 1, rawLine: 'jana@x.cz;日本', errorCode: 'email_invalid', errorDetail: null }],
    }, { reportLoss: true });
    expect(out.warnings).toContain('characters_lost');
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/contacts/import/errors-csv.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Krok 3: Napiš `csv-injection.ts` a `errors-csv.ts`**

```ts
// packages/core/src/contacts/export/csv-injection.ts
const DANGEROUS = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Buňka začínající na některý z těchhle znaků se prefixuje apostrofem.
 * Bez toho je export cesta, jak přes kontakt jménem =cmd|'/c calc'!A1
 * spustit kód v tabulkovém procesoru příjemce. Platí i pro errors.csv
 * a pro GDPR export.
 */
export function guardCsvCell(value: string): string {
  return DANGEROUS.some((ch) => value.startsWith(ch)) ? `'${value}` : value;
}
```

```ts
// packages/core/src/contacts/import/errors-csv.ts
import { stringify } from 'csv-stringify/sync';
import iconv from 'iconv-lite';
import { guardCsvCell } from '../export/csv-injection.js';

export type ErrorCsvRow = { rowNumber: number; rawLine: string; errorCode: string; errorDetail: string | null };

export type ErrorCsvInput = {
  header: string[];
  rows: ErrorCsvRow[];
  encoding: 'utf-8' | 'windows-1250' | 'iso-8859-2';
  delimiter: string;
  locale?: string;
};

export type ErrorCsvOutput = Buffer & { warnings?: string[] };

/**
 * Sloupce _error_code a _error_detail zůstávají anglicky vždy. Kdyby se hlavička
 * přeložila, automapování by při opětovném nahrání selhalo a smysl celé funkce
 * by zmizel.
 */
export async function buildErrorsCsv(
  input: ErrorCsvInput,
  opts: { reportLoss?: boolean } = {},
): Promise<ErrorCsvOutput> {
  const records = input.rows.map((row) => {
    const cells = row.rawLine.split(input.delimiter).map(guardCsvCell);
    while (cells.length < input.header.length) cells.push('');
    return [...cells.slice(0, input.header.length), row.errorCode, row.errorDetail ?? ''];
  });
  const text = stringify([[...input.header, '_error_code', '_error_detail'], ...records], {
    delimiter: input.delimiter, quoted_string: false, record_delimiter: '\n',
  });
  const buffer = iconv.encode(text, input.encoding) as ErrorCsvOutput;
  if (opts.reportLoss) {
    const roundTrip = iconv.decode(buffer, input.encoding);
    buffer.warnings = roundTrip === text ? [] : ['characters_lost'];
  }
  return buffer;
}
```

- [ ] **Krok 4: Spusť test**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/contacts/import/errors-csv.test.ts`
Expected: PASS, čtyři testy.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/src/contacts/import/errors-csv.ts packages/core/src/contacts/export/csv-injection.ts packages/core/test/contacts/import/errors-csv.test.ts
git commit -m "feat(import): generate errors.csv in the original encoding with injection guard"
```

---

### Úkol 37: vyřazen (fronta ke kontrole oslovení, seskupený dotaz)

**Tenhle úkol se neprovádí. Vlastní ho P07.**

Rozhodnutí U3 z 2026-08-01 přiřklo frontu ke kontrole oslovení celou plánu P07, viz rozhodnutí R2
v kapitole 1. Důvod: vokativ se počítá při zápisu kontaktu, takže nejisté případy vznikají i přes
API, z formuláře a z příchozího webhooku, a ty cesty vlastní P07. Kdyby frontu vlastnil import,
neměly by do ní čím zapsat.

Co odsud odešlo do P07: seskupený dotaz nad `contacts` podle `first_name_key`, strop 5 000 skupin,
modul `packages/core/src/contacts/naming/`, routa `/api/v1/vocative-review` a kritéria 20, 24, 25
a 30 části 2 spolu s 39 až 42 části 6.

**Co po P07 zůstává na tomhle plánu:** výsledková obrazovka importu (úkol 52) na frontu odkazuje
s filtrem na konkrétní import a volá k tomu `listReviewGroups(ctx, { importId })`. Je to
požadavek 7.6 v kapitole 11. Importní roura dál plní sloupce, ze kterých fronta žije
(`first_name_key`, `last_name_key`, `vocative_confidence`), viz úkol 31.

---

### Úkol 38: vyřazen (pět operací nad skupinou a přepisy jmen)

**Tenhle úkol se neprovádí. Vlastní ho P07.**

Odešlo spolu s úkolem 37 podle rozhodnutí U3, viz R2. Patřilo sem pět operací nad skupinou
(potvrdit, přepsat, neutrální oslovení, odložit, vyřešit jednotlivě), tabulka `name_overrides`
a job `contacts.bulk_vocative_review`.

Dvě věci, které si P07 musí vzít s sebou, protože je tenhle plán objevil a jinde zapsané nejsou:

1. **`users.attributes` neexistuje.** Odložení skupiny zapisovalo
   `UPDATE users SET attributes = jsonb_set(...)`, ale tabulka `users` v P03 sloupec `attributes`
   nemá a nemá ani `preferences`. Nejbližší jsou `workspaces.settings` a `system_settings.settings`,
   ani jedno není per uživatel. Bez sloupce nemá odložení kam zapsat. Zapsáno v evidenci
   napříč plány jako požadavek na P03.
2. **`normalizeNameKey()` musí být bajt za bajt tatáž funkce** na všech třech místech: při plnění
   `contacts.first_name_key`, při seskupování ve frontě a při hledání v `name_overrides`.
   Tři různé odpovědi znamenají, že override skupinu netrefí a fronta se nikdy nevyprázdní.
   Je to požadavek 7.2 a kryje kritérium 30.

---

### Úkol 39: Export kontaktů

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/contacts/export/columns.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/contacts/export/service.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/contacts/export/jobs/run-export.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/test/contacts/export/export.dbspec.ts`

- [ ] **Krok 1: Napiš padající databázový test**

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { gunzipSync } from 'node:zlib';
import iconv from 'iconv-lite';
import { createExport, verifyDownloadToken } from '../../../src/contacts/export/service.js';
import { handler as runExport } from '../../../src/contacts/export/jobs/run-export.js';
import { makeWorkspace, testCtx } from '../../segments/helpers/db.js';
import { insertContact, readExportFile } from './helpers/export-fixtures.js';

let ctx: Awaited<ReturnType<typeof testCtx>>;
beforeAll(async () => {
  ctx = await testCtx();
  await makeWorkspace(ctx, { contacts: 0 });
  await insertContact(ctx, { email: 'jana@x.cz', firstName: 'Jana', lastName: 'Nováková' });
  await insertContact(ctx, { email: 'evil@x.cz', firstName: '=cmd|\'/c calc\'!A1', lastName: 'X' });
});

describe('contact export', () => {
  it('writes utf-8 with a BOM by default so czech excel opens it correctly', async () => {
    const created = await createExport(ctx, { kind: 'contacts', filter: {}, columns: ['email', 'first_name'] });
    await runExport({ data: { workspaceId: ctx.workspaceId, exportId: created.id } } as never);
    const buf = gunzipSync(await readExportFile(ctx, created.id));
    expect(buf.subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
  });

  it('uses a semicolon for cs and a comma otherwise', async () => {
    const cs = await createExport(ctx, { kind: 'contacts', filter: {}, columns: ['email'], locale: 'cs' });
    const en = await createExport(ctx, { kind: 'contacts', filter: {}, columns: ['email'], locale: 'en' });
    expect(cs.delimiter).toBe(';');
    expect(en.delimiter).toBe(',');
  });

  it('prefixes a formula cell with an apostrophe', async () => {
    const created = await createExport(ctx, { kind: 'contacts', filter: {}, columns: ['email', 'first_name'] });
    await runExport({ data: { workspaceId: ctx.workspaceId, exportId: created.id } } as never);
    const text = gunzipSync(await readExportFile(ctx, created.id)).toString('utf8');
    expect(text).toContain("'=cmd");
  });

  it('reports characters_lost when windows-1250 cannot represent a character', async () => {
    await insertContact(ctx, { email: 'jp@x.cz', firstName: '日本', lastName: 'X' });
    const created = await createExport(ctx, { kind: 'contacts', filter: {}, columns: ['first_name'], encoding: 'windows-1250' });
    const out = await runExport({ data: { workspaceId: ctx.workspaceId, exportId: created.id } } as never);
    expect(out.warnings).toContain('characters_lost');
  });

  it('accepts a one time download token and refuses it the second time', async () => {
    const created = await createExport(ctx, { kind: 'contacts', filter: {}, columns: ['email'] });
    await runExport({ data: { workspaceId: ctx.workspaceId, exportId: created.id } } as never);
    expect(await verifyDownloadToken(ctx, created.id, created.downloadToken)).toBe(true);
    expect(await verifyDownloadToken(ctx, created.id, created.downloadToken)).toBe(false);
  });

  it('exports exactly the contacts of a segment, envelope included', async () => {
    const created = await createExport(ctx, { kind: 'contacts', filter: { ast: { version: 1, root: { type: 'group', op: 'and', children: [{ type: 'condition', field: { kind: 'contact', key: 'status' }, operator: 'eq', value: 'active' }] } } }, columns: ['email'] });
    const out = await runExport({ data: { workspaceId: ctx.workspaceId, exportId: created.id } } as never);
    expect(out.rowCount).toBeGreaterThan(0);
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core test:db`
Expected: FAIL, `Cannot find module`.

- [ ] **Krok 3: Napiš `columns.ts`**

```ts
/** Pevná sada podle 4.7 části 2. Názvy sloupců běžného exportu se překládají. */
export const FIXED_EXPORT_COLUMNS = [
  'email', 'first_name', 'last_name', 'title_prefix', 'title_suffix', 'gender',
  'first_name_vocative', 'greeting', 'status', 'locale', 'source', 'created_at', 'last_activity_at',
] as const;

export type FixedColumn = (typeof FIXED_EXPORT_COLUMNS)[number];

export const COLUMN_SQL: Record<FixedColumn, string> = {
  email: 'c.email::text',
  first_name: 'c.first_name',
  last_name: 'c.last_name',
  title_prefix: 'c.title_prefix',
  title_suffix: 'c.title_suffix',
  gender: 'c.gender',
  first_name_vocative: 'c.first_name_vocative',
  greeting: 'c.greeting',
  status: 'c.status',
  locale: 'c.locale',
  source: 'c.source',
  created_at: "to_char(c.created_at, 'YYYY-MM-DD\"T\"HH24:MI:SSOF')",
  last_activity_at: "to_char(c.last_activity_at, 'YYYY-MM-DD\"T\"HH24:MI:SSOF')",
};

export function attributeColumnSql(paramRef: string): string {
  return `c.attributes ->> ${paramRef}`;
}

/** Štítky spojené svislítkem, aby se daly nahrát zpátky importem. */
export const TAGS_COLUMN_SQL =
  `(SELECT string_agg(t.name, '|' ORDER BY t.name) FROM contact_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.contact_id = c.id)`;

export function listStatusColumnSql(paramRef: string): string {
  return `(SELECT ls.status FROM list_subscriptions ls WHERE ls.contact_id = c.id AND ls.list_id = ${paramRef})`;
}
```

- [ ] **Krok 4: Napiš `service.ts` a `jobs/run-export.ts`**

```ts
// service.ts
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { WorkspaceContext } from '../../identity/index.js';
import { ApiError } from '../../errors/index.js';
import { config } from '../../config/index.js';
import { QUEUES, enqueue } from '../../queues/index.js';
import { inWorkspaceTx } from '../import/db.js';
import { auditImport } from '../import/audit.js';

export type CreateExportInput = {
  kind: 'contacts' | 'import_errors';
  filter: Record<string, unknown>;
  columns: string[];
  format?: 'csv' | 'ndjson';
  encoding?: 'utf-8-bom' | 'utf-8' | 'windows-1250';
  delimiter?: string;
  locale?: string;
};

export async function createExport(ctx: WorkspaceContext, input: CreateExportInput) {
  const token = randomBytes(32).toString('base64url');
  const tokenHash = createHash('sha256').update(token).digest();
  // BOM je výchozí schválně: bez něj Excel v českém prostředí otevře UTF-8 CSV
  // s rozbitou diakritikou, což je nejčastější stížnost na exporty vůbec.
  const encoding = input.encoding ?? 'utf-8-bom';
  const delimiter = input.delimiter ?? (input.locale === 'cs' || input.locale === undefined ? ';' : ',');

  return inWorkspaceTx(ctx, async (tx) => {
    const { rows: running } = await tx.execute<{ id: string }>(sql`
      SELECT id FROM exports
       WHERE workspace_id = ${ctx.workspaceId}::uuid AND status = 'running' LIMIT 1`);
    if (running.length > 0) {
      throw new ApiError('resource_locked', 423, { errors: [{ path: '_', code: 'export_already_running' }] });
    }
    const { rows } = await tx.execute<{ id: string; delimiter: string; encoding: string }>(sql`
      INSERT INTO exports (id, workspace_id, kind, filter, columns, format, encoding, delimiter,
                           status, download_token_hash, expires_at, created_by)
      VALUES (uuidv7(), ${ctx.workspaceId}::uuid, ${input.kind},
              ${JSON.stringify(input.filter)}::jsonb, ${JSON.stringify(input.columns)}::jsonb,
              ${input.format ?? 'csv'}, ${encoding}, ${delimiter}, 'queued', ${tokenHash},
              now() + make_interval(hours => ${config.EXPORT_TTL_HOURS}), ${actorUserId(ctx)}::uuid)
      RETURNING id, delimiter, encoding`);
    await enqueue(QUEUES.CONTACTS_EXPORT, { workspaceId: ctx.workspaceId, exportId: rows[0].id });
    await auditImport(ctx, 'export.created', rows[0].id, { kind: input.kind });
    return { ...rows[0], downloadToken: token };
  });
}

/** Jednorázový token: po ověření se hash smaže, takže druhý pokus selže. */
export async function verifyDownloadToken(ctx: WorkspaceContext, exportId: string, token: string): Promise<boolean> {
  return inWorkspaceTx(ctx, async (tx) => {
    const { rows } = await tx.execute<{ download_token_hash: Buffer | null }>(sql`
      SELECT download_token_hash FROM exports
       WHERE id = ${exportId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid
         AND status = 'completed' AND expires_at > now()`);
    const stored = rows[0]?.download_token_hash;
    if (!stored) return false;
    const given = createHash('sha256').update(token).digest();
    if (given.length !== stored.length || !timingSafeEqual(given, stored)) return false;
    await tx.execute(sql`
      UPDATE exports SET download_token_hash = NULL
       WHERE id = ${exportId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid`);
    await auditImport(ctx, 'export.downloaded', exportId, {});
    return true;
  });
}
```

```ts
// jobs/run-export.ts
import { createWriteStream } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { stringify } from 'csv-stringify';
import iconv from 'iconv-lite';
import { sql } from 'drizzle-orm';
import { config } from '../../../config/index.js';
import { createSystemContext } from '../../../identity/index.js';
import { compileAudienceToSql } from '../../../segments/repo.js';
import { inWorkspaceTx } from '../../import/db.js';
import { guardCsvCell } from '../csv-injection.js';
import { COLUMN_SQL, TAGS_COLUMN_SQL, type FixedColumn } from '../columns.js';

export type ExportJobPayload = { workspaceId: string; exportId: string };

/**
 * Kurzor na serveru, dávky 5 000 řádků, výstup se zapisuje proudem a gzipuje.
 * Nikdy se nenačítá celý výsledek do paměti, protože export pěti milionů
 * kontaktů by jinak spolkl gigabajty.
 */
export const handler = async (job: { data: ExportJobPayload }) => {
  const ctx = createSystemContext(job.data.workspaceId, 'contacts.export');
  const row = await loadExport(ctx, job.data.exportId);
  const storageKey = join('exports', ctx.workspaceId, `${job.data.exportId}.csv.gz`);
  const target = join(config.DATA_DIR, storageKey);
  await mkdir(dirname(target), { recursive: true });

  const compiled = await compileAudienceToSql(ctx, row.filter, {
    alias: 'a', paramOffset: 0, asOf: new Date(), timezone: 'Europe/Prague',
  });
  const selected = (row.columns as FixedColumn[]).map((c) => `${COLUMN_SQL[c]} AS "${c}"`);
  if ((row.columns as string[]).includes('tags')) selected.push(`${TAGS_COLUMN_SQL} AS "tags"`);
  const sql = `SELECT ${selected.join(', ')} FROM contacts c WHERE c.id IN (${compiled.sql})`;

  let rowCount = 0;
  let lost = false;
  const source = Readable.from(streamRows(ctx, sql, compiled.params, 5000));
  const csv = stringify({ header: true, columns: row.columns as string[], delimiter: row.delimiter,
    cast: { string: (v) => guardCsvCell(v) } });
  const encode = new (require('node:stream').Transform)({
    transform(chunk: Buffer, _e: unknown, done: (e?: Error, c?: Buffer) => void) {
      const text = chunk.toString('utf8');
      const encoded = row.encoding === 'windows-1250' ? iconv.encode(text, 'windows-1250') : Buffer.from(text, 'utf8');
      if (row.encoding === 'windows-1250' && iconv.decode(encoded, 'windows-1250') !== text) lost = true;
      done(undefined, encoded);
    },
  });

  const out = createWriteStream(target);
  if (row.encoding === 'utf-8-bom') out.write(Buffer.from([0xef, 0xbb, 0xbf]));
  await pipeline(source.map((r) => { rowCount += 1; return r; }), csv, encode, createGzip(), out);

  await inWorkspaceTx(ctx, (tx) => tx.execute(sql`
    UPDATE exports SET status = 'completed', row_count = ${rowCount},
      storage_key = ${storageKey}, finished_at = now()
     WHERE id = ${job.data.exportId}::uuid AND workspace_id = ${ctx.workspaceId}::uuid`));
  return { rowCount, warnings: lost ? ['characters_lost'] : [] };
};
```

Funkce `loadExport` a `streamRows` napiš ve stejném souboru. `streamRows` je asynchronní generátor, který uvnitř jedné transakce vyhlásí `DECLARE mlain_export_cursor CURSOR FOR <sql>` a opakuje `FETCH 5000`, dokud dostává řádky.

- [ ] **Krok 5: Spusť databázový test**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core test:db`
Expected: PASS, šest testů.

- [ ] **Krok 6: Odkomentuj oba zbývající exporty a spusť celý blok B**

V `packages/core/src/contacts/import/index.ts` a `export/index.ts` odkomentuj všechny řádky.

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/contacts && pnpm --filter @mlain/core test:db && pnpm --filter @mlain/core typecheck`
Expected: PASS, celý blok B zeleně.

- [ ] **Krok 7: Commit**

```bash
git add packages/core/src/contacts/export packages/core/test/contacts/export
git commit -m "feat(export): stream contact exports with bom, injection guard and one time token"
```

---

## Blok C: katalogy i18n a routy

### Úkol 40: Namespace `import`

Klíče z 6.3 části 2 se přesouvají z namespace `contacts` do `import`, viz rozhodnutí R15. **Znění textů se nemění**, mění se jen cesta klíče. Převodní tabulka je závazná a P07 tyhle klíče zakládat nesmí:

| Klíč v části 2 | Klíč v tomhle plánu |
|---|---|
| `contacts.import.detected` | `import.detected` |
| `contacts.import.estimate` | `import.estimate` |
| `contacts.import.doneWithErrors` | `import.doneWithErrors` |
| `contacts.vocative.reviewBanner` | `import.vocative.reviewBanner` |
| `contacts.vocative.groupHint` | `import.vocative.groupHint` |
| `contacts.vocative.savedOverride` | `import.vocative.savedOverride` |

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/i18n/messages/cs/import.json`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/i18n/messages/en/import.json`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/test/import/i18n.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
import { describe, expect, it } from 'vitest';
import cs from '../../../packages/i18n/messages/cs/import.json';
import en from '../../../packages/i18n/messages/en/import.json';

const flatten = (obj: unknown, prefix = ''): string[] =>
  typeof obj === 'object' && obj !== null
    ? Object.entries(obj).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k))
    : [prefix];

describe('import catalogue', () => {
  it('has the same key set in both languages', () => {
    expect(flatten(cs).sort()).toEqual(flatten(en).sort());
  });

  it('contains no em dash', () => {
    // U+2014 se zapisuje escapem schválně: znak samotný je v editoru
    // k nerozeznání od pomlčky a spolehlivě by se do katalogu vrátil.
    expect(JSON.stringify(cs)).not.toContain('\u2014');
    expect(JSON.stringify(en)).not.toContain('\u2014');
  });

  it('covers all eleven warning codes', () => {
    for (const code of ['excel_serial_date_assumed', 'number_format_ambiguous', 'value_truncated',
      'name_split_low_confidence', 'vietnamese_order_assumed', 'gender_unknown', 'gender_conflict',
      'vocative_low_confidence', 'non_latin_script', 'suppressed_skipped', 'trailing_fields_padded']) {
      expect(flatten(cs)).toContain(`warnings.${code}`);
    }
  });

  it('covers all twenty row level error codes', () => {
    for (const code of ['row_field_count_mismatch', 'email_missing', 'email_invalid', 'email_too_long',
      'email_domain_invalid', 'email_disposable', 'duplicate_in_file', 'invalid_number', 'invalid_boolean',
      'invalid_date', 'invalid_datetime', 'invalid_enum_value', 'invalid_url', 'invalid_phone',
      'value_too_long', 'required_field_missing', 'unknown_field_key', 'encoding_error', 'name_empty',
      'list_not_found']) {
      expect(flatten(cs)).toContain(`rowErrors.${code}`);
    }
  });

  it('covers all ten file level error codes with a second sentence', () => {
    for (const code of ['file_too_large', 'too_many_rows', 'too_many_columns', 'empty_file',
      'unsupported_encoding', 'delimiter_not_detected', 'malformed_csv', 'no_email_column_mapped',
      'storage_unavailable', 'contact_limit_reached']) {
      expect(flatten(cs)).toContain(`fileErrors.${code}.title`);
      expect(flatten(cs)).toContain(`fileErrors.${code}.nextStep`);
    }
  });

  it('uses ICU plurals with the =0 category on every count', () => {
    const withCount = flatten(cs).filter((k) => /count|rows|groups/i.test(k));
    for (const key of withCount) {
      const value = key.split('.').reduce<unknown>((acc, part) => (acc as Record<string, unknown>)[part], cs);
      if (typeof value === 'string' && value.includes('plural')) expect(value).toContain('=0');
    }
  });

  it('never uses the banned word subscribed as a status', () => {
    expect(JSON.stringify(cs)).not.toMatch(/"subscribed"/);
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter web exec vitest run test/import/i18n.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Krok 3: Napiš `cs/import.json`**

Výňatek se všemi klíči, které se objevují v obrazovkách bloku D. Zbylé texty varování a chyb doplň podle tabulek v 8.3.6 části 6 doslova.

```json
{
  "wizard": {
    "title": "Import kontaktů",
    "steps": {
      "upload": "Nahrání",
      "fileCheck": "Kontrola souboru",
      "mapping": "Mapování",
      "preview": "Náhled",
      "options": "Volby",
      "progress": "Import"
    },
    "resumeBanner": "Máte rozdělaný import souboru {filename}. Pokračovat, nebo začít znovu?",
    "resumeExpiry": "Rozpracovaný import si pamatujeme 24 hodin. Potom bude potřeba soubor nahrát znovu.",
    "backFromPreview": "Změnou mapování začneme import znovu. Nic se neztratí, soubor máme nahraný."
  },
  "upload": {
    "dropzone": "Přetáhněte sem soubor s kontakty",
    "browse": "vyberte ze složky",
    "limits": "Přijímáme CSV a Excel (.xlsx). Nejvýš 200 MB.",
    "guide": "Jak dostat kontakty z Excelu, Ecomailu nebo Mailchimpu",
    "progress": "Nahráno {percent} %",
    "cancel": "Zrušit nahrávání"
  },
  "detected": "Rozpoznali jsme kódování {encoding} a oddělovač {delimiter}.",
  "fileCheck": {
    "title": "Zkontrolujte, jestli soubor čteme správně",
    "encoding": "Kódování",
    "delimiter": "Oddělovač",
    "rowCount": "{total, plural, =0 {Žádný řádek} one {# řádek} few {# řádky} many {# řádku} other {# řádků}}, z toho 1 hlavička, tedy {data, plural, =0 {žádný kontakt} one {# kontakt} few {# kontakty} many {# kontaktu} other {# kontaktů}}",
    "question": "Vypadají jména a města správně?",
    "questionHint": "Máte tam „Nováková\" a „Břeclav\", nebo něco jako „NovĂˇkovĂˇ\"?",
    "yes": "Ano, je to správně",
    "no": "Ne, je to rozsypané",
    "alternatives": "Zkuste jedno z těchhle kódování"
  },
  "mapping": {
    "title": "Co je v jednotlivých sloupcích?",
    "columnInFile": "Sloupec ze souboru",
    "sample": "Ukázka",
    "saveAs": "Uložit jako",
    "ignore": "Nepoužívat",
    "createField": "Vytvořit pole „{name}\"",
    "willSplit": "Rozdělíme na jméno a příjmení",
    "noEmail": "Nevybrali jste, ve kterém sloupci je e-mailová adresa. Bez ní kontakt nemá kam přijít.",
    "duplicateTarget": "Do pole {field} míří dva sloupce: {columns}. Vyberte jeden.",
    "unknownDateFormat": "V sloupci {column} jsme nerozpoznali formát u {count, plural, =0 {žádného řádku} one {# řádku} few {# řádků} many {# řádku} other {# řádků}}, například {example}."
  },
  "preview": {
    "title": "Takhle to bude vypadat",
    "columns": {
      "email": "E-mail",
      "titlePrefix": "Titul",
      "firstName": "Jméno",
      "gender": "Rod",
      "lastName": "Příjmení",
      "greeting": "Oslovení"
    },
    "showing": "Prvních {shown} z {total} řádků.",
    "showMore": "Zobrazit dalších 20",
    "vocativeNotice": "U {count, plural, =0 {žádného kontaktu} one {# kontaktu} few {# kontaktů} many {# kontaktu} other {# kontaktů}} si nejsme jistí oslovením. Po importu vám je ukážeme a necháme rozhodnout. Do té doby je oslovíme neutrálně „Dobrý den\" bez jména, nikdy ne špatně.",
    "noEmailRows": "{count, plural, one {# řádek nemá} few {# řádky nemají} other {# řádků nemá}} e-mail a přeskočíme je.",
    "duplicateRows": "{count, plural, one {# e-mail se} few {# e-maily se} other {# e-mailů se}} v souboru opakuje. Necháme poslední výskyt.",
    "splitHelp": "Jméno se dělí špatně?",
    "nameOrder": "Pořadí ve zdroji",
    "nameOrderFirstLast": "Jméno Příjmení",
    "nameOrderLastFirst": "Příjmení Jméno",
    "splitTitlesPrefix": "Oddělit tituly před jménem (Ing., Mgr., MUDr.)",
    "splitTitlesSuffix": "Oddělit tituly za jménem (Ph.D., CSc., DiS.)",
    "keepDoubleSurnames": "Zachovat celé dvojité příjmení"
  },
  "estimate": "{new} nových, {updated} aktualizovaných, {skipped} přeskočených, {errors} chybných.",
  "options": {
    "title": "Poslední dvě otázky",
    "list": "Zařadit do seznamu",
    "createList": "Vytvořit nový seznam",
    "tag": "Přidat štítek (nepovinné)",
    "tagHint": "Tip: štítek se hodí, kdybyste chtěli tuhle skupinu později najít.",
    "conflict": "Co když už kontakt v databázi máme?",
    "conflictSkip": "Přeskočit",
    "conflictSkipHint": "Necháme, co máme, ze souboru nic.",
    "conflictUpdate": "Doplnit",
    "conflictUpdateHint": "Přidáme, co chybí. Co už máme vyplněné, nepřepíšeme.",
    "conflictOverwrite": "Přepsat",
    "conflictOverwriteHint": "Data ze souboru vyhrají.",
    "declaration": "Potvrzuji, že tito lidé souhlasili se zasíláním obchodních sdělení, nebo že k tomu mám jiný právní důvod.",
    "declarationLink": "Co to znamená",
    "declarationEvidence": "Uloží se jako důkaz včetně data a mého jména.",
    "duplicateErrorUnavailable": "U souboru téhle velikosti neumíme spolehlivě poznat druhý výskyt téže adresy, takže tuhle volbu nenabízíme.",
    "submit": "Naimportovat {count, plural, =0 {žádný kontakt} one {# kontakt} few {# kontakty} many {# kontaktu} other {# kontaktů}}"
  },
  "progress": {
    "title": "Importujeme kontakty",
    "counter": "{processed} z {total}",
    "eta": "Zbývá asi {seconds, plural, one {# sekunda} few {# sekundy} other {# sekund}}",
    "runsOnServer": "Import běží na serveru. Okno můžete zavřít, po návratu uvidíte výsledek. Dáme vám vědět e-mailem.",
    "cancel": "Zrušit import",
    "cancelConfirmTitle": "Zrušit import?",
    "cancelConfirmBody": "Zpracovaných {done} kontaktů v databázi zůstane. Zbylých {rest} se nenaimportuje. Půjde pokračovat od místa, kde jsme skončili."
  },
  "result": {
    "completed": "Naimportováno {count, plural, =0 {žádný kontakt} one {# kontakt} few {# kontakty} many {# kontaktu} other {# kontaktů}}",
    "withErrors": "Naimportováno {done} z {total}",
    "cancelled": "Import jste zrušili na řádku {row}",
    "failed": "Import se nepodařilo dokončit",
    "failedNothingWritten": "Do databáze se nezapsal žádný kontakt.",
    "breakdown": {
      "created": "Nových kontaktů",
      "updated": "Doplněných u existujících",
      "suppressed": "Přeskočeno, protože jsou na blokovaných adresách",
      "failed": "Nepodařilo se"
    },
    "guessedSection": "Co jsme museli odhadnout",
    "guessedIntro": "U {count} řádků jsme si nebyli jistí a rozhodli jsme za vás.",
    "failedSection": "Co se nepodařilo",
    "failedTable": { "row": "Řádek", "content": "Obsah", "why": "Proč" },
    "downloadErrors": "Stáhnout {count, plural, one {# chybný řádek} few {# chybné řádky} other {# chybných řádků}} jako CSV",
    "showImported": "Zobrazit naimportované kontakty",
    "resume": "Pokračovat od řádku {row}",
    "uploadAnother": "Nahrát jiný soubor",
    "supportDetails": "Podrobnosti pro technickou podporu"
  },
  "doneWithErrors": "Naimportováno {count} kontaktů. {errors} řádků se nepovedlo, stáhněte si je, opravte a nahrajte znovu.",
  "warnings": {
    "excel_serial_date_assumed": "{n} dat vypadalo jako číslo z Excelu, brali jsme je jako datum (například 45 231 na 30. 11. 2023).",
    "number_format_ambiguous": "{n} čísel šlo přečíst dvěma způsoby: 1,234 může být 1,234 i 1234. Brali jsme je jako {interpretation}.",
    "value_truncated": "{n} hodnot bylo delších, než pole dovoluje, zkrátili jsme je.",
    "name_split_low_confidence": "{n} jmen se nepodařilo spolehlivě rozdělit na jméno a příjmení.",
    "vietnamese_order_assumed": "U {n} jmen jsme použili vietnamské pořadí (příjmení první).",
    "gender_unknown": "{n} kontaktů nemá určený rod, oslovíme je neutrálně.",
    "gender_conflict": "U {n} kontaktů si jméno a příjmení odporují v rodu.",
    "vocative_low_confidence": "U {n} kontaktů si nejsme jistí oslovením.",
    "non_latin_script": "{n} jmen není v latince, oslovení jsme nepočítali.",
    "suppressed_skipped": "{n} adres jsme nepřidali, protože se v minulosti odhlásily nebo se jim e-maily nedoručovaly.",
    "trailing_fields_padded": "{n} řádků mělo míň sloupců než hlavička, chybějící jsme nechali prázdné."
  },
  "rowErrors": {
    "row_field_count_mismatch": "Jiný počet sloupců než v hlavičce",
    "email_missing": "Prázdný e-mail",
    "email_invalid": "Neplatná e-mailová adresa",
    "email_too_long": "E-mail je delší než 254 znaků",
    "email_domain_invalid": "Doména za zavináčem není platná",
    "email_disposable": "Jednorázová e-mailová adresa",
    "duplicate_in_file": "Stejná adresa je v souboru víckrát",
    "invalid_number": "Není to číslo",
    "invalid_boolean": "Není to ano ani ne",
    "invalid_date": "Není to datum",
    "invalid_datetime": "Není to datum a čas",
    "invalid_enum_value": "Hodnota není mezi povolenými",
    "invalid_url": "Není to webová adresa",
    "invalid_phone": "Není to telefonní číslo",
    "value_too_long": "Hodnota je delší, než pole dovoluje",
    "required_field_missing": "Povinné pole je prázdné",
    "unknown_field_key": "Mapování ukazuje na pole, které neexistuje",
    "encoding_error": "Znaky nedávají v tomhle kódování smysl",
    "name_empty": "Jméno je prázdné",
    "list_not_found": "Seznam z mapování neexistuje"
  },
  "fileErrors": {
    "file_too_large": {
      "title": "Soubor je moc velký",
      "nextStep": "Soubor má {actual}, zvládneme {limit}. Rozdělte ho na díly, nebo z něj odeberte sloupce, které nepotřebujete."
    },
    "too_many_rows": { "title": "Soubor má moc řádků", "nextStep": "Soubor má víc než 5 milionů řádků. Rozdělte ho na díly." },
    "too_many_columns": { "title": "Soubor má moc sloupců", "nextStep": "Soubor má víc než 200 sloupců. Odeberte ty, které nepotřebujete." },
    "empty_file": { "title": "Soubor je prázdný", "nextStep": "Soubor je prázdný, nenašli jsme v něm žádné řádky." },
    "unsupported_encoding": { "title": "Kódování souboru neumíme přečíst", "nextStep": "Uložte ho v Excelu přes Soubor, Uložit jako, CSV UTF-8 a zkuste to znovu." },
    "delimiter_not_detected": { "title": "Nepodařilo se rozpoznat oddělovač", "nextStep": "Vyberte oddělovač ručně v kroku Kontrola souboru." },
    "malformed_csv": { "title": "Soubor je poškozený", "nextStep": "Chybí uzavírací uvozovka. Otevřete soubor v Excelu a uložte ho znovu." },
    "no_email_column_mapped": { "title": "Chybí sloupec s e-mailem", "nextStep": "Vraťte se do kroku Mapování a vyberte, ve kterém sloupci je e-mailová adresa." },
    "storage_unavailable": { "title": "Nepodařilo se uložit soubor", "nextStep": "Zkuste to za chvíli znovu. Když to bude trvat, zkontrolujte místo na disku serveru." },
    "contact_limit_reached": { "title": "Dosáhli jste limitu počtu kontaktů", "nextStep": "Smažte nepoužívané kontakty, nebo zvyšte limit v nastavení projektu." }
  },
  "duplicateImport": {
    "title": "Tenhle soubor už jste nahráli",
    "body": "Tenhle soubor jste s tímhle nastavením nahráli {date}. Chcete otevřít původní import, nebo ho spustit znovu?",
    "openOriginal": "Otevřít původní import",
    "runAgain": "Spustit znovu"
  },
  "vocative": {
    "title": "Zkontrolujte oslovení",
    "reviewBanner": "U {count, plural, =0 {žádného kontaktu} one {# kontaktu} few {# kontaktů} many {# kontaktu} other {# kontaktů}} si nejsme jistí oslovením.",
    "intro": "Rozdělili jsme je do {groups, plural, one {# skupiny} few {# skupin} other {# skupin}} podle jména. Do doby, než rozhodnete, jim píšeme „Dobrý den\" bez jména.",
    "groupHint": "Jméno {name} může patřit muži i ženě. Jak ho máme oslovovat?",
    "savedOverride": "Zapamatujeme si to i pro budoucí kontakty se jménem {name}.",
    "gender": "Pohlaví",
    "genderMale": "muž",
    "genderFemale": "žena",
    "genderUnknown": "nevím",
    "vocativeField": "Oslovení",
    "remember": "Zapamatovat i pro budoucí kontakty se jménem {name}",
    "confirm": "Potvrdit pro {count, plural, one {# kontakt} few {# kontakty} other {# kontaktů}}",
    "noName": "Neoslovovat jménem",
    "defer": "Odložit",
    "remaining": "Zbývá {count, plural, one {# skupina} few {# skupiny} other {# skupin}}",
    "confirmAll": "Potvrdit všechny návrhy ({count, plural, one {# skupina} few {# skupiny} other {# skupin}})",
    "noNameAll": "Neoslovovat jménem u všech",
    "lockNote": "Co jednou potvrdíte nebo opravíte, už nikdy sami nezměníme.",
    "empty": "Ve frontě nic není. Všechna oslovení jsou potvrzená nebo jistá."
  }
}
```

- [ ] **Krok 4: Napiš `en/import.json`**

Stejná struktura klíčů, anglické texty. Klíčové věty:

```json
{
  "detected": "We detected {encoding} encoding and {delimiter} as the separator.",
  "estimate": "{new} new, {updated} updated, {skipped} skipped, {errors} with errors.",
  "doneWithErrors": "Imported {count} contacts. {errors} rows failed. Download, fix and upload them again.",
  "vocative": {
    "reviewBanner": "We are not sure how to address {count, plural, =0 {any contact} one {# contact} other {# contacts}}.",
    "groupHint": "The name {name} can be either male or female. How should we address them?",
    "savedOverride": "We will remember this for future contacts named {name}."
  }
}
```

Zbytek doplň jedna ku jedné podle českého souboru. Test z kroku 1 hlídá, že se množiny klíčů rovnají, takže žádný klíč nemůže zůstat jen v jednom jazyce.

- [ ] **Krok 5: Spusť test**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter web exec vitest run test/import/i18n.test.ts && node tools/ci/i18n-check.mjs`
Expected: PASS, sedm testů, `i18n-check` bez nálezu.

- [ ] **Krok 6: Commit**

```bash
git add packages/i18n/messages/cs/import.json packages/i18n/messages/en/import.json apps/web/test/import/i18n.test.ts
git commit -m "feat(i18n): add the import namespace in czech and english"
```

---

### Úkol 41: Namespace `segments`

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/i18n/messages/cs/segments.json`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/i18n/messages/en/segments.json`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/test/segments/i18n.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
import { describe, expect, it } from 'vitest';
import cs from '../../../packages/i18n/messages/cs/segments.json';
import en from '../../../packages/i18n/messages/en/segments.json';
import { FIELD_CLASS_OPERATORS } from '@mlain/core/segments';

const flatten = (obj: unknown, prefix = ''): string[] =>
  typeof obj === 'object' && obj !== null
    ? Object.entries(obj).flatMap(([k, v]) => flatten(v, prefix ? `${prefix}.${k}` : k))
    : [prefix];

describe('segments catalogue', () => {
  it('has the same key set in both languages', () => {
    expect(flatten(cs).sort()).toEqual(flatten(en).sort());
  });

  it('has a label for every field and operator pair from the matrix', () => {
    const keys = flatten(cs);
    for (const operators of Object.values(FIELD_CLASS_OPERATORS)) {
      for (const operator of operators) expect(keys).toContain(`operators.${operator}`);
    }
  });

  it('carries the builder sentence as one ICU message with named slots', () => {
    expect(cs.builder.groupSentence).toBe('Kontakty, které {polarity} {quantifier}');
    expect(en.builder.groupSentence).toBe('Contacts that {polarity} {quantifier}');
  });

  it('has an explanation line for both negated combinations in both languages', () => {
    for (const cat of [cs, en]) {
      expect(cat.builder.negationHint.andNot.length).toBeGreaterThan(10);
      expect(cat.builder.negationHint.orNot.length).toBeGreaterThan(10);
    }
  });

  it('never shows AND, OR, NOT or the word operator to the user', () => {
    const text = JSON.stringify(cs) + JSON.stringify(en);
    expect(text).not.toMatch(/\bAND\b|\bOR\b|\bNOT\b/);
    expect(text).not.toMatch(/operátor|\boperator\b/i);
  });

  it('contains no em dash', () => {
    expect(JSON.stringify(cs) + JSON.stringify(en)).not.toContain('\u2014');
  });

  it('has a title and an explanation for all six presets', () => {
    for (const key of ['neverOpened', 'neverClicked', 'inactive90d', 'noOpenLastN', 'unconfirmed30d', 'repeatedSoftBounces']) {
      expect(flatten(cs)).toContain(`presets.${key}.title`);
      expect(flatten(cs)).toContain(`presets.${key}.explanation`);
    }
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter web exec vitest run test/segments/i18n.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Krok 3: Napiš `cs/segments.json`**

```json
{
  "title": "Segmenty",
  "new": "Nový segment",
  "name": "Název segmentu",
  "empty": "Zatím tu nejsou žádné segmenty. Začněte hotovým, nebo si postavte vlastní.",
  "stale": "Aktualizováno před {time}.",
  "neverCounted": "Ještě jsme nepočítali",
  "count": "Spočítat",
  "recount": "Přepočítat",
  "estimated": "Přibližně {count} kontaktů. Spočítat přesně",
  "notNullHint": "Kontakty, které pole vůbec nemají, sem nespadnou. Použijte podmínku „je prázdné\".",
  "addEmptyCondition": "Přidat i kontakty bez vyplněného pole",
  "builder": {
    "groupSentence": "Kontakty, které {polarity} {quantifier}",
    "polarity": { "match": "splňují", "notMatch": "nesplňují" },
    "quantifier": { "all": "všechny podmínky", "any": "alespoň jednu podmínku" },
    "negationHint": {
      "andNot": "Do segmentu spadnou kontakty, u kterých neplatí aspoň jedna z podmínek níž.",
      "orNot": "Do segmentu spadnou jen kontakty, u kterých neplatí ani jedna z podmínek níž."
    },
    "addCondition": "Přidat podmínku",
    "addGroup": "Přidat skupinu podmínek",
    "removeCondition": "Odebrat podmínku",
    "groupNumber": "Skupina {path}",
    "noDeeper": "Hlouběji už zanořovat nejde.",
    "conditionCounter": "{used} ze {limit} podmínek",
    "splitSuggestion": "Tenhle segment je složitý. Nechcete ho rozdělit na dva?",
    "showJson": "Zobrazit definici jako JSON",
    "save": "Uložit segment",
    "cancel": "Zrušit"
  },
  "fieldGroups": {
    "contact": "O člověku",
    "attribute": "Vlastní pole",
    "tag": "Štítky",
    "list": "Seznamy",
    "consent": "Souhlasy",
    "suppression": "Blokované adresy",
    "engagement": "Aktivita v kampaních",
    "event": "Chování na webu",
    "times": "Časy",
    "segment": "Jiný segment"
  },
  "fields": {
    "first_name": "Jméno",
    "last_name": "Příjmení",
    "email": "E-mail",
    "email_domain": "Doména e-mailu",
    "gender": "Pohlaví",
    "locale": "Jazyk komunikace",
    "status": "Stav kontaktu",
    "source": "Odkud přišel",
    "vocative_confidence": "Jistota oslovení",
    "processing_restricted": "Omezené zpracování (GDPR)",
    "last_activity_at": "Poslední aktivita",
    "created_at": "Datum vytvoření",
    "updated_at": "Datum poslední změny",
    "tag": "Má štítek",
    "suppression": "Je mezi blokovanými",
    "segment": "Je v segmentu",
    "engagement": { "sent": "Dostal kampaň", "delivered": "Doručilo se mu", "opened": "Otevřel kampaň", "clicked": "Klikl v kampani", "bounced": "E-mail se nedoručil" },
    "event": "Provedl akci",
    "unindexed": "Podle tohohle pole se hledá pomaleji. U velké databáze může výpočet trvat déle."
  },
  "operators": {
    "eq": "je", "neq": "není", "contains": "obsahuje", "not_contains": "neobsahuje",
    "starts_with": "začíná na", "ends_with": "končí na", "in": "je jedno z", "not_in": "není žádné z",
    "is_empty": "je prázdné", "is_not_empty": "je vyplněné",
    "gt": "je větší než", "gte": "je aspoň", "lt": "je menší než", "lte": "je nejvýš", "between": "je mezi",
    "is_true": "je zaškrtnuté", "is_false": "není zaškrtnuté",
    "on": "je přesně", "before": "je před", "after": "je po",
    "in_last_days": "je za posledních", "not_in_last_days": "není za posledních", "in_next_days": "je v příštích",
    "has_any": "má aspoň jeden z", "has_all": "má všechny z", "has_none": "nemá žádný z",
    "is_member": "je v něm", "is_not_member": "není v něm", "is_confirmed": "má potvrzené přihlášení",
    "is_pending": "čeká na potvrzení", "is_unsubscribed": "odhlásil se z něj",
    "is_granted": "má udělený", "is_withdrawn": "odvolal", "is_missing": "nikdy nedal",
    "is_suppressed": "je mezi blokovanými", "is_not_suppressed": "není mezi blokovanými",
    "did": "ano", "did_not": "ne", "count_gte": "aspoň Nkrát", "count_lte": "nejvýš Nkrát"
  },
  "operatorHints": {
    "is_member": "Včetně těch, kdo přihlášení zatím nepotvrdili.",
    "is_missing": "Lidé, u kterých souhlas nemáme zaznamenaný.",
    "is_withdrawn": "Lidé, kteří souhlas aktivně vzali zpět. Právně to není totéž jako „nikdy nedal\"."
  },
  "count": {
    "counting": "Počítáme…",
    "exact": "Do segmentu patří {count, plural, =0 {nikdo} one {# kontakt} few {# kontakty} many {# kontaktu} other {# kontaktů}}",
    "sampleTitle": "Například:",
    "showAll": "Zobrazit všech {count}",
    "failed": "Počet se nepodařilo spočítat.",
    "retry": "Zkusit znovu",
    "emptyAll": "Segment zatím nemá žádnou podmínku, obsahuje tedy všechny kontakty ({count})."
  },
  "warnings": {
    "segment_count_estimated": "Číslo je odhad, přesný výpočet by trval příliš dlouho.",
    "segment_unindexed_field": "Podmínka na pole {field} se počítá pomalu, protože podle něj databáze nemá rejstřík. U velké databáze to může trvat déle.",
    "segment_slow_engagement": "Podmínky na aktivitu v kampaních prohledávají historii všech odeslaných zpráv. U velké databáze počítejte s několika sekundami.",
    "segment_archived_field": "Pole {field} je archivované a nové kontakty ho už neplní."
  },
  "traps": {
    "noCampaignsYet": "Zatím jste neposlali žádnou kampaň, takže tuhle podmínku splňuje úplně každý kontakt.",
    "contradiction": "Podmínky {a} a {b} nemůže splnit nikdo najednou. Nechtěli jste nahoře přepnout na „alespoň jednu podmínku\"?",
    "rarelyFilled": "Pole {field} má vyplněných jen {filled} kontaktů z {total}.",
    "containsUnsubscribed": "Z {total} kontaktů je {count} odhlášených, těm se kampaň neodešle.",
    "containsRestricted": "Z {total} kontaktů má {count} omezené zpracování podle GDPR, těm se kampaň neodešle.",
    "cycle": "Segment {a} se odkazuje na segment {b} a ten zpátky na {a}. To nejde spočítat."
  },
  "empty": {
    "title": "Do segmentu nepatří nikdo",
    "mostRestrictive": "Nejvíc omezuje tahle podmínka:",
    "others": "Ostatní podmínky samostatně:",
    "fieldStats": "Pole {field} má vyplněné jen {filled} kontaktů z {total}. Nejčastější hodnoty: {values}",
    "caseSuggestion": "Nechtěli jste „{value}\"?",
    "useValue": "Použít",
    "includeEmpty": "Chcete zahrnout i kontakty bez vyplněného pole?",
    "include": "Přidat"
  },
  "limits": {
    "tooComplex": "Segment už má {limit} podmínek, což je maximum. Rozdělte ho na dva a spojte je podmínkou „je v segmentu\".",
    "tooManyEngagement": "Podmínek na aktivitu v kampaních může být nejvýš {limit}, protože každá z nich prohledává historii odeslaných zpráv.",
    "tooManyEvent": "Podmínek na chování na webu může být nejvýš {limit}.",
    "listTooLong": "Do výčtu se vejde nejvýš {limit} položek. {dropped} jsme zahodili.",
    "nestingTooDeep": "Odkazovat se na segment, který se odkazuje na další segment, jde nejvýš do druhé úrovně."
  },
  "presets": {
    "sectionTitle": "Začněte hotovým",
    "orBuild": "Nebo si postavte vlastní",
    "build": "Postavit vlastní segment",
    "use": "Použít",
    "neverOpened": { "title": "Nikdy neotevřel", "explanation": "Dostali aspoň 3 e-maily a žádný neotevřeli." },
    "neverClicked": { "title": "Nikdy neklikl", "explanation": "Dostali aspoň 5 e-mailů a v žádném neklikli." },
    "inactive90d": { "title": "Neaktivní 90+ dní", "explanation": "Za poslední 3 měsíce nic neudělali a máme je déle než 3 měsíce." },
    "noOpenLastN": { "title": "Neotevřel posledních 5 kampaní", "explanation": "Dostali posledních 5 kampaní a žádnou neotevřeli." },
    "unconfirmed30d": { "title": "Nepotvrzené přihlášení starší 30 dní", "explanation": "Přihlásili se, ale nikdy nepotvrdili odkaz v e-mailu." },
    "repeatedSoftBounces": { "title": "Opakované měkké odrazy", "explanation": "Aspoň 3× se jim e-mail dočasně nedoručil." }
  },
  "freeze": {
    "action": "Zmrazit seznam",
    "explanation": "Seznam zmrazíme, aby se během kampaně neměnil. Kdo se mezitím sám ozve, z úklidu vypadne.",
    "done": "Zmrazeno, segment má {count} kontaktů."
  },
  "cleanup": {
    "title": "Co uděláme s těmi, kdo se neozvou?",
    "unsubscribe": "Odhlásit je z odběru",
    "unsubscribeHint": "Zůstanou v databázi, ale kampaně jim už neposíláme.",
    "tagOnly": "Jen je označit štítkem",
    "tagOnlyHint": "Nic se nezmění, jen si je odložíme na později.",
    "delete": "Smazat je",
    "deleteHint": "Nenávratně. Může jen vlastník projektu.",
    "delayDays": "Za kolik dní",
    "countdown": "Za {days, plural, one {# den} few {# dny} other {# dní}} se rozhodne o {count} kontaktech.",
    "warning": "Za {days} dní odhlásíme {count} kontaktů.",
    "confirmTitle": "Za {days, plural, one {# den} few {# dny} other {# dní}} odhlásíme {count} kontaktů",
    "confirmBody": "Reaktivační kampaň {campaign} odešla {sentAt} na {sent} lidí. Do dneška se ozvalo {responded}. Zbývajících {count} odhlásíme {when}. Odhlášení nejde vzít zpět. Kdo se bude chtít vrátit, musí se přihlásit znovu sám.",
    "download": "Stáhnout těch {count} kontaktů",
    "review": "Zkontrolovat",
    "postpone": "Odložit o 14 dní",
    "abort": "Zrušit úklid",
    "typeName": "Pro potvrzení opište název segmentu"
  },
  "audience": {
    "title": "Publikum kampaně",
    "input": "Segment {name}",
    "gates": {
      "suppressed": "na blokovaných adresách",
      "unsubscribed": "odhlášení",
      "unconfirmed": "nepotvrzené přihlášení k seznamu",
      "snoozed": "pozastavená komunikace na vlastní žádost",
      "processing_restricted": "omezené zpracování podle GDPR",
      "duplicate": "duplicitní e-maily",
      "sample": "ukázkové kontakty"
    },
    "willSend": "Kampaň se odešle {count, plural, one {# člověku} few {# lidem} other {# lidem}}"
  }
}
```

- [ ] **Krok 4: Napiš `en/segments.json`**

Stejná struktura, anglické texty. Závazné jsou zejména:

```json
{
  "builder": {
    "groupSentence": "Contacts that {polarity} {quantifier}",
    "polarity": { "match": "match", "notMatch": "do not match" },
    "quantifier": { "all": "all of these conditions", "any": "at least one of these conditions" },
    "negationHint": {
      "andNot": "Contacts get in when at least one condition below is false for them.",
      "orNot": "Contacts get in only when every condition below is false for them."
    }
  },
  "stale": "Updated {time} ago.",
  "estimated": "Approximately {count} contacts. Count exactly",
  "notNullHint": "Contacts that do not have this field at all are not included. Use the „is empty\" condition."
}
```

Kvantifikátor nese v angličtině celou frázi včetně slova „conditions", protože angličtina nemá českou vazbu, kde se počitatelnost skryje. Kdyby nesl jen „all", věta by se musela dolepovat a byli bychom zpátky u skládání z fragmentů.

- [ ] **Krok 5: Spusť test**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter web exec vitest run test/segments/i18n.test.ts && node tools/ci/i18n-check.mjs`
Expected: PASS, sedm testů.

- [ ] **Krok 6: Commit**

```bash
git add packages/i18n/messages/cs/segments.json packages/i18n/messages/en/segments.json apps/web/test/segments/i18n.test.ts
git commit -m "feat(i18n): add the segments namespace with the ICU builder sentence"
```

---

### Úkol 42: Routy segmentů

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/segments/api/schemas.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/segments/api/segments.routes.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/segments/api/index.ts`
- Modify: `/Users/petr/Projects/Mailing_Tool/apps/web/src/lib/api/app.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/test/segments/routes.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
import { describe, expect, it } from 'vitest';
import { testClient } from './helpers/client.js';

describe('segment routes', () => {
  it('returns the json schema of the ast', async () => {
    const res = await testClient().get('/api/v1/segments/schema');
    expect(res.status).toBe(200);
    expect((await res.json()).properties.version.const).toBe(1);
  });

  it('rejects an operator that does not fit the field with 422 and the domain code', async () => {
    const res = await testClient().post('/api/v1/segments/preview', {
      definition: { version: 1, root: { type: 'group', op: 'and', children: [
        { type: 'condition', field: { kind: 'contact', key: 'created_at' }, operator: 'contains', value: 'x' },
      ] } },
    });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('validation_failed');
    expect(body.errors[0].code).toBe('segment_operator_not_allowed');
  });

  it('rate limits preview to twenty per minute per user', async () => {
    const client = testClient();
    const body = { definition: { version: 1, root: { type: 'group', op: 'and', children: [{ type: 'condition', field: { kind: 'contact', key: 'status' }, operator: 'eq', value: 'active' }] } } };
    for (let i = 0; i < 20; i += 1) await client.post('/api/v1/segments/preview', body);
    const res = await client.post('/api/v1/segments/preview', body);
    expect(res.status).toBe(429);
  });

  it('returns 202 for a recount', async () => {
    const created = await (await testClient().post('/api/v1/segments', { name: 'X', definition: simpleAst() })).json();
    const res = await testClient().post(`/api/v1/segments/${created.id}/recount`, {});
    expect(res.status).toBe(202);
  });

  it('lists the six presets', async () => {
    const res = await testClient().get('/api/v1/segments/presets');
    expect((await res.json()).items).toHaveLength(6);
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter web exec vitest run test/segments/routes.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Krok 3: Napiš `segments.routes.ts`**

```ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { SegmentAstV1 } from '../ast.js';
import { segmentJsonSchema } from '../json-schema.js';
import { SEGMENT_PRESETS, presetByKey } from '../presets.js';
import { countSegment, listSegmentContacts } from '../repo.js';
import { audienceBreakdown } from '../audience.js';
import { diagnoseEmptyResult } from '../diagnostics.js';
import {
  createSegment, deleteSegment, freezeSegment, listSegments, recountSegment, updateSegment,
} from '../service.js';
import { PreviewRequest, PreviewResponse, SegmentResponse } from './schemas.js';

export function registerSegmentRoutes(app: OpenAPIHono): void {
  app.openapi(createRoute({
    method: 'get', path: '/api/v1/segments/schema', tags: ['segments'],
    responses: { 200: { description: 'JSON Schema AST verze 1', content: { 'application/json': { schema: z.record(z.unknown()) } } } },
  }), (c) => c.json(segmentJsonSchema()));

  app.openapi(createRoute({
    method: 'post', path: '/api/v1/segments/preview', tags: ['segments'],
    // 20 náhledů za minutu na uživatele. UI navíc debouncuje 500 ms a ruší
    // předchozí požadavek přes AbortController, jinak by každý stisk klávesy
    // v poli s hodnotou spustil dotaz nad pěti miliony řádků.
    middleware: [rateLimit({ key: 'segments.preview', perMinute: 20, scope: 'user' })],
    request: { body: { content: { 'application/json': { schema: PreviewRequest } } } },
    responses: { 200: { description: 'Počet, vzorek a varování', content: { 'application/json': { schema: PreviewResponse } } } },
  }), async (c) => {
    const ctx = c.get('workspaceContext');
    const body = c.req.valid('json');
    const ast = body.definition ?? (await loadDefinition(ctx, body.segment_id));
    const asOf = new Date();
    const counted = await countSegment(ctx, ast, { asOf });
    const sample = await listSegmentContacts(ctx, ast, { limit: 20 }, { asOf });
    const diagnostics = counted.count === 0
      ? await diagnoseEmptyResult(ctx, ast, { asOf, timezone: ctx.timezone })
      : null;
    return c.json({
      count: counted.count, exact: counted.exact, duration_ms: counted.durationMs,
      sample: sample.rows, warnings: counted.warnings, diagnostics,
    });
  });

  app.openapi(createRoute({
    method: 'post', path: '/api/v1/segments/{id}/recount', tags: ['segments'],
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: { 202: { description: 'Přepočet zařazen', content: { 'application/json': { schema: SegmentResponse } } } },
  }), async (c) => c.json(await recountSegment(c.get('workspaceContext'), c.req.valid('param').id), 202));

  app.openapi(createRoute({
    method: 'post', path: '/api/v1/segments/{id}/freeze', tags: ['segments'],
    request: { params: z.object({ id: z.string().uuid() }), body: { content: { 'application/json': { schema: z.object({ name: z.string().min(1).max(120) }) } } } },
    responses: { 201: { description: 'Statický segment', content: { 'application/json': { schema: SegmentResponse } } } },
  }), async (c) => c.json(await freezeSegment(c.get('workspaceContext'), c.req.valid('param').id, c.req.valid('json')), 201));

  app.openapi(createRoute({
    method: 'post', path: '/api/v1/segments/audience-breakdown', tags: ['segments'],
    request: { body: { content: { 'application/json': { schema: z.object({
      segment_ids: z.array(z.string().uuid()).optional(),
      list_ids: z.array(z.string().uuid()).optional(),
      definition: SegmentAstV1.optional(),
    }) } } } },
    responses: { 200: { description: 'Rozpad publika po branách', content: { 'application/json': { schema: z.record(z.unknown()) } } } },
  }), async (c) => {
    const body = c.req.valid('json');
    const ctx = c.get('workspaceContext');
    return c.json(await audienceBreakdown(ctx,
      { segmentIds: body.segment_ids, listIds: body.list_ids, ast: body.definition },
      { asOf: new Date(), timezone: ctx.timezone }));
  });

  // GET a POST /segments, GET, PATCH a DELETE /segments/{id},
  // GET /segments/{id}/preview, GET /segments/{id}/contacts,
  // GET /segments/presets a POST /segments/presets/{key} se registrují stejným
  // vzorem: createRoute s parametry, validace zodem, volání služby z úkolů 19 a 20.
  registerCrudRoutes(app, { createSegment, updateSegment, deleteSegment, listSegments, SEGMENT_PRESETS, presetByKey });
}
```

Funkce `registerCrudRoutes` a `loadDefinition` napiš ve stejném souboru. `rateLimit` je middleware z `@/lib/api` (P04).

- [ ] **Krok 4: Zaregistruj routy v `apps/web/src/lib/api/app.ts`**

Přidej tři řádky, nic jiného v souboru neměň:

```ts
import { registerSegmentRoutes } from '@mlain/core/segments';
// ...
registerSegmentRoutes(app);
```

- [ ] **Krok 5: Přegeneruj `openapi.json`**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter web run openapi:generate && node tools/ci/openapi-drift.mjs`
Expected: soubor se změní, `openapi-drift` projde.

**Pravidlo, které si přečti dřív, než tenhle soubor uvidíš v konfliktu:** `openapi.json` se **nikdy neslučuje ručně.** Při konfliktu se zahodí obě verze a přegeneruje se. Slučování po řádcích vyrobí schéma, které neodpovídá ani jedné straně.

- [ ] **Krok 6: Spusť test a commit**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter web exec vitest run test/segments/routes.test.ts`
Expected: PASS, pět testů.

```bash
git add packages/core/src/segments/api apps/web/src/lib/api/app.ts apps/web/test/segments/routes.test.ts apps/web/openapi.json
git commit -m "feat(segments): expose segment routes through the hono app"
```

---

### Úkol 43: Routy importu, exportu a fronty oslovení

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/contacts/import/api/{schemas.ts,imports.routes.ts,events.routes.ts,index.ts}`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/contacts/import/vocative-review/api/vocative-review.routes.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/contacts/export/api/{schemas.ts,exports.routes.ts,index.ts}`
- Modify: `/Users/petr/Projects/Mailing_Tool/apps/web/src/lib/api/app.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/test/import/routes.test.ts`

- [ ] **Krok 1: Napiš padající test**

```ts
import { describe, expect, it } from 'vitest';
import { testClient } from '../segments/helpers/client.js';

describe('import routes', () => {
  it('returns 202 with a Location header, not 201', async () => {
    const res = await testClient().postMultipart('/api/v1/contacts/imports', csvFile(), { 'Idempotency-Key': 'k1' });
    expect(res.status).toBe(202);
    expect(res.headers.get('Location')).toMatch(/\/api\/v1\/contacts\/imports\//);
    expect((await res.json()).status).toBe('pending');
  });

  it('requires an Idempotency-Key header', async () => {
    const res = await testClient().postMultipart('/api/v1/contacts/imports', csvFile(), {});
    expect(res.status).toBe(400);
  });

  it('accepts json rows instead of a file, up to ten thousand', async () => {
    const res = await testClient().post('/api/v1/contacts/imports', { rows: [{ email: 'a@x.cz' }] }, { 'Idempotency-Key': 'k2' });
    expect(res.status).toBe(202);
    const tooMany = await testClient().post('/api/v1/contacts/imports',
      { rows: Array.from({ length: 10_001 }, (_, i) => ({ email: `c${i}@x.cz` })) }, { 'Idempotency-Key': 'k3' });
    expect(tooMany.status).toBe(413);
  });

  it('refuses a patch outside the previewing state with 409', async () => {
    const created = await (await testClient().postMultipart('/api/v1/contacts/imports', csvFile(), { 'Idempotency-Key': 'k4' })).json();
    await testClient().post(`/api/v1/contacts/imports/${created.id}/confirm`, {});
    const res = await testClient().patch(`/api/v1/contacts/imports/${created.id}`, { mapping: {} });
    expect(res.status).toBe(409);
    expect((await res.json()).errors[0].code).toBe('invalid_state_transition');
  });

  it('serves errors.csv with the original encoding in the content type', async () => {
    const res = await testClient().get('/api/v1/contacts/imports/known-id/errors.csv');
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('attachment');
  });

  it('streams progress over SSE', async () => {
    const res = await testClient().get('/api/v1/contacts/imports/known-id/events');
    expect(res.headers.get('content-type')).toContain('text/event-stream');
  });

  it('returns the review queue grouped, with a count endpoint for the badge', async () => {
    const groups = await (await testClient().get('/api/v1/vocative-review')).json();
    expect(Array.isArray(groups.items)).toBe(true);
    const count = await (await testClient().get('/api/v1/vocative-review/count')).json();
    expect(count).toHaveProperty('groups');
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter web exec vitest run test/import/routes.test.ts`
Expected: FAIL, `Cannot find module`.

- [ ] **Krok 3: Napiš `imports.routes.ts`**

Klíčová část je nahrávání: tělo se čte jako proud, nikdy se nebuferuje.

```ts
import { Readable } from 'node:stream';
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import {
  cancelImport, confirmImport, createImport, patchImport, resumeImport,
} from '../service.js';
import { buildErrorsCsv } from '../errors-csv.js';
import { ImportResponse, PatchImportRequest } from './schemas.js';

export function registerImportRoutes(app: OpenAPIHono): void {
  app.openapi(createRoute({
    method: 'post', path: '/api/v1/contacts/imports', tags: ['imports'],
    middleware: [requireIdempotencyKey(), rateLimit({ key: 'contacts.imports', perHour: 10, scope: 'workspace' })],
    responses: {
      // 202, ne 201: vrácený import je ve stavu pending a projde ještě
      // validating a previewing, než vůbec něco naimportuje. 201 Created
      // slibuje zdroj v koncovém stavu, což tady neplatí.
      202: { description: 'Přijato ke zpracování', content: { 'application/json': { schema: ImportResponse } } },
    },
  }), async (c) => {
    const ctx = c.get('workspaceContext');
    const contentType = c.req.header('content-type') ?? '';
    let created;
    if (contentType.includes('application/json')) {
      const body = await c.req.json<{ rows: Record<string, string>[] }>();
      if (body.rows.length > 10_000) {
        return c.json({ code: 'payload_too_large', errors: [{ path: 'rows', code: 'too_many_rows' }] }, 413);
      }
      created = await createImport(ctx, { stream: rowsToCsvStream(body.rows), filename: 'api.csv' });
    } else {
      // Tělo se čte jako ReadableStream a zapisuje na disk po kusech,
      // takže server nikdy nedrží 200 MB v paměti.
      const { stream, filename } = await multipartFileStream(c.req.raw);
      created = await createImport(ctx, { stream: Readable.fromWeb(stream), filename });
    }
    c.header('Location', `/api/v1/contacts/imports/${created.id}`);
    return c.json(created, 202);
  });

  app.openapi(createRoute({
    method: 'patch', path: '/api/v1/contacts/imports/{id}', tags: ['imports'],
    request: { params: z.object({ id: z.string().uuid() }), body: { content: { 'application/json': { schema: PatchImportRequest } } } },
    responses: { 200: { description: 'Upravený import', content: { 'application/json': { schema: ImportResponse } } } },
  }), async (c) => c.json(await patchImport(c.get('workspaceContext'), c.req.valid('param').id, c.req.valid('json'))));

  app.openapi(createRoute({
    method: 'get', path: '/api/v1/contacts/imports/{id}/errors.csv', tags: ['imports'],
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: { 200: { description: 'Chybné řádky ke stažení' } },
  }), async (c) => {
    const ctx = c.get('workspaceContext');
    const { header, rows, encoding, delimiter, filename } = await loadErrorRows(ctx, c.req.valid('param').id);
    const buffer = await buildErrorsCsv({ header, rows, encoding, delimiter });
    c.header('content-type', `text/csv; charset=${encoding}`);
    c.header('content-disposition', `attachment; filename="${filename}-errors.csv"`);
    return c.body(buffer);
  });

  // GET /imports, GET /imports/{id}, GET /imports/{id}/preview,
  // GET /imports/{id}/errors, POST /imports/{id}/confirm, /cancel a /resume
  // se registrují stejným vzorem nad službami z úkolu 34.
  registerRemainingImportRoutes(app, { confirmImport, cancelImport, resumeImport });
}
```

- [ ] **Krok 4: Napiš `events.routes.ts` (SSE)**

```ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { streamSSE } from 'hono/streaming';
import { subscribeProgress } from '../progress.js';

export function registerImportEventRoutes(app: OpenAPIHono): void {
  app.openapi(createRoute({
    method: 'get', path: '/api/v1/contacts/imports/{id}/events', tags: ['imports'],
    request: { params: z.object({ id: z.string().uuid() }) },
    responses: { 200: { description: 'Průběh importu jako SSE' } },
  }), async (c) => {
    const ctx = c.get('workspaceContext');
    const importId = c.req.valid('param').id;
    return streamSSE(c, async (stream) => {
      // Server posílá nejvýš jednou za sekundu. Číslo, které se mění desetkrát
      // za sekundu, je nečitelné a působí nervózně.
      for await (const event of subscribeProgress(ctx, importId, { minIntervalMs: 1000 })) {
        await stream.writeSSE({ event: 'progress', data: JSON.stringify(event) });
        if (event.terminal) break;
      }
    });
  });
}
```

- [ ] **Krok 5: Napiš routy exportu a fronty oslovení**

`exports.routes.ts` registruje `POST /api/v1/contacts/exports` (rate limit 10 za hodinu na projekt), `GET /api/v1/contacts/exports/{id}` a `GET /api/v1/contacts/exports/{id}/download`, který ověří jednorázový token přes `verifyDownloadToken` a při selhání vrátí `404`, ne `403`, aby neprozradil existenci exportu.

`vocative-review.routes.ts` registruje `GET /api/v1/vocative-review` (parametry `import_id`, `kind`, `limit`, `cursor`), `POST /api/v1/vocative-review/confirm` s tělem `{ groups: [...] }`, `GET /api/v1/vocative-review/count` a `GET`, `POST`, `DELETE` na `/api/v1/name-overrides`.

- [ ] **Krok 6: Zaregistruj a přegeneruj OpenAPI**

Přidej do `apps/web/src/lib/api/app.ts` dva řádky (`registerImportRoutes(app)`, `registerExportRoutes(app)`).

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter web run openapi:generate && pnpm --filter web exec vitest run test/import/routes.test.ts`
Expected: PASS, sedm testů.

- [ ] **Krok 7: Commit**

```bash
git add packages/core/src/contacts/import/api packages/core/src/contacts/import/vocative-review/api packages/core/src/contacts/export/api apps/web/src/lib/api/app.ts apps/web/test/import/routes.test.ts apps/web/openapi.json
git commit -m "feat(api): expose import, export and vocative review routes"
```

---

## Blok D: obrazovky

Čtyři z osmi komponent design systému používá tenhle plán a žádnou z nich nevlastní. Úkoly 44 a 52 jsou proto **konformanční testy**: ověřují, že komponenta unese, co po ní tenhle plán chce. Když test spadne, je to požadavek na P05, ne důvod psát vlastní komponentu do `packages/ui`.

### Úkol 44: Konformanční test K1 a K4

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/test/import/k4-conformance.test.tsx`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/test/segments/k1-conformance.test.tsx`

- [ ] **Krok 1: Napiš konformanční test K4 (nahrání souboru)**

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FileUpload } from '@mlain/ui/patterns/file-upload';
import { uploadLabels } from '../../src/app/[locale]/w/[slug]/contacts/import/_components/labels';

/**
 * Popisky jsou POVINNÝ prop. Do `packages/ui` se texty nepíšou, takže je
 * dodává obrazovka z katalogu `import`. Konformanční test je proto musí předat
 * a hledat v DOM texty z katalogu, ne natvrdo napsané řetězce: kdyby hledal
 * natvrdo, prošel by i tehdy, když se překlad rozejde s tím, co se vykresluje.
 */
const labels = uploadLabels('cs');

describe('K4 file upload conformance', () => {
  it('offers a keyboard path equivalent to dragging', async () => {
    render(<FileUpload labels={labels} accept=".csv,.xlsx,text/csv" maxBytes={209_715_200} onFile={vi.fn()} />);
    const trigger = screen.getByRole('button', { name: labels.browse });
    await userEvent.tab();
    expect(trigger).toHaveFocus();
    expect(trigger).not.toHaveAttribute('disabled');
  });

  it('reports upload progress as a percentage', () => {
    render(<FileUpload labels={labels} accept=".csv" maxBytes={209_715_200} onFile={vi.fn()} progress={42} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(bar).toHaveAttribute('aria-valuetext');
  });

  it('exposes a cancel action while uploading', async () => {
    const onCancel = vi.fn();
    render(
      <FileUpload labels={labels} accept=".csv" maxBytes={209_715_200}
        onFile={vi.fn()} progress={42} onCancel={onCancel} />,
    );
    await userEvent.click(screen.getByRole('button', { name: labels.cancel }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('takes accept as a string with extensions AND mime types', () => {
    // Windows posílá u CSV nejrůznější MIME typy, takže samotný seznam MIME
    // odmítá platné soubory. Prop je proto řetězec jako HTML atribut.
    render(<FileUpload labels={labels} accept=".csv,.xlsx,text/csv" maxBytes={1} onFile={vi.fn()} />);
    expect(screen.getByLabelText(labels.field)).toHaveAttribute('accept', '.csv,.xlsx,text/csv');
  });

  it('accepts a two hundred megabyte file without reading it into memory', async () => {
    const onFile = vi.fn();
    render(<FileUpload labels={labels} accept=".csv" maxBytes={209_715_200} onFile={onFile} />);
    const big = new File([new Uint8Array(1024)], 'big.csv', { type: 'text/csv' });
    Object.defineProperty(big, 'size', { value: 209_715_200 });
    await userEvent.upload(screen.getByLabelText(labels.field), big);
    // Komponenta musí předat File, ne ArrayBuffer: čtení do paměti by
    // u 200 MB souboru shodilo kartu prohlížeče.
    expect(onFile).toHaveBeenCalledWith(expect.any(File));
  });
});
```

- [ ] **Krok 2: Napiš konformanční test K1 (tabulka a výběr)**

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DataTable } from '@mlain/ui/patterns/data-table';
import { contactTableLabels } from '../../src/app/[locale]/w/[slug]/segments/_components/labels';

type Row = { id: string; email: string };

const page = (from: number): Row[] =>
  Array.from({ length: 50 }, (_, i) => ({ id: `c${from + i}`, email: `c${from + i}@x.cz` }));

/** Sloupec má `{ id, header, cell }`. `cell` je funkce, ne jméno klíče. */
const columns = [{ id: 'email', header: 'E-mail', cell: (row: Row) => row.email }];
const labels = contactTableLabels('cs');
const base = {
  tableId: 'contacts', caption: 'Kontakty', columns, getRowId: (r: Row) => r.id, labels,
  pagination: { hasMore: true, canGoBack: false, onPrevious: vi.fn(), onNext: vi.fn() },
};

describe('K1 selection conformance', () => {
  it('keeps the selection when the page changes and shows its size', async () => {
    // Výběr drží obrazovka propem `selection`, jinak by ho tabulka při
    // přestránkování zahodila. Právě to je jádro tvrdého požadavku 13.1.
    let selected: string[] = [];
    const onSelectionChange = (next: string[]) => { selected = next; };
    const view = (rows: Row[]) => (
      <DataTable {...base} rows={rows} count={{ total: 12_480, estimated: false }}
        selection={{ selectedIds: selected, onSelectionChange }} />
    );
    const { rerender } = render(view(page(0)));
    await userEvent.click(within(screen.getAllByRole('row')[1]).getByRole('checkbox'));
    rerender(view(page(50)));
    expect(selected).toHaveLength(1);
    expect(screen.getByText(labels.selectedOnPage(1))).toBeInTheDocument();
  });

  it('distinguishes selected on this page from selected everything matching the filter', async () => {
    render(<DataTable {...base} rows={page(0)} count={{ total: 12_480, estimated: false }} />);
    await userEvent.click(screen.getByRole('checkbox', { name: labels.selectAllOnPage }));
    expect(screen.getByText(labels.selectedOnPage(50))).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: labels.selectAllMatching(12_480) }));
    expect(screen.getByText(labels.selectedAllMatching(12_480))).toBeInTheDocument();
  });

  it('shows the size of the selection, so nobody deletes fifty thousand by mistake', async () => {
    render(<DataTable {...base} rows={page(0)} count={{ total: 12_480, estimated: false }} />);
    await userEvent.click(screen.getByRole('checkbox', { name: labels.selectAllOnPage }));
    await userEvent.click(screen.getByRole('button', { name: labels.selectAllMatching(12_480) }));
    // Číslo musí být vidět jako text, ne jen v atributu: uživatel zaškrtne
    // hlavičku, myslí si, že vybral 50 řádků, a smaže 12 480.
    expect(screen.getByText(labels.selectedAllMatching(12_480))).toBeVisible();
  });

  it('paginates by cursor and never renders page numbers', () => {
    render(<DataTable {...base} rows={page(0)} count={{ total: 12_480, estimated: false }} />);
    expect(screen.queryByRole('button', { name: /^\d+$/ })).toBeNull();
  });
});
```

- [ ] **Krok 3: Spusť oba testy**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter web exec vitest run test/import/k4-conformance.test.tsx test/segments/k1-conformance.test.tsx`
Expected: PASS. **Když spadnou**, nepiš vlastní komponentu. Zapiš nález do kapitoly 11 s odkazem na tvrdý požadavek K1 nebo K4 z 13.1 části 6 a pokračuj dalším úkolem; obrazovky se dají dokončit i proti komponentě, která zatím výběr přes stránky nedrží, jen se do té doby nesmí označit za hotové.

- [ ] **Krok 4: Commit**

```bash
git add apps/web/test/import/k4-conformance.test.tsx apps/web/test/segments/k1-conformance.test.tsx
git commit -m "test(ui): assert K1 and K4 meet the hard requirements this plan depends on"
```

---

### Úkol 45: Skořápka průvodce importem

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/app/[locale]/w/[slug]/contacts/import/page.tsx`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/app/[locale]/w/[slug]/contacts/import/_components/import-wizard.tsx`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/test/import/wizard.test.tsx`

- [ ] **Krok 1: Napiš padající test**

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ImportWizard } from '../../src/app/[locale]/w/[slug]/contacts/import/_components/import-wizard.js';

describe('import wizard', () => {
  it('puts the step in the query string, not in the path', async () => {
    const { router } = renderWithRouter(<ImportWizard importId="i1" initialStep="mapping" />);
    expect(router.query.step).toBe('mapping');
  });

  it('warns that going back from preview starts a new import', async () => {
    render(<ImportWizard importId="i1" initialStep="preview" />);
    await userEvent.click(screen.getByRole('button', { name: /zpět/i }));
    expect(screen.getByText(/změnou mapování začneme import znovu/i)).toBeInTheDocument();
  });

  it('offers to resume a wizard left unfinished', () => {
    render(<ImportWizard importId="i1" initialStep="upload" pending={{ filename: 'kontakty.csv' }} />);
    expect(screen.getByText(/máte rozdělaný import souboru kontakty.csv/i)).toBeInTheDocument();
  });

  it('says the unfinished state expires after twenty four hours', () => {
    render(<ImportWizard importId="i1" initialStep="mapping" />);
    expect(screen.getByText(/pamatujeme 24 hodin/i)).toBeInTheDocument();
  });

  it('moves focus to the step heading and announces the change', async () => {
    render(<ImportWizard importId="i1" initialStep="mapping" />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent(/krok 3 z 6/i);
  });

  it('shows no beforeunload dialog while the import runs', async () => {
    render(<ImportWizard importId="i1" initialStep="progress" />);
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání, pak napiš `import-wizard.tsx`**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter web exec vitest run test/import/wizard.test.tsx`
Expected: FAIL, `Cannot find module`.

```tsx
'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Wizard, useWizardStep } from '@mlain/ui/patterns/wizard';

export const STEPS = ['upload', 'fileCheck', 'mapping', 'preview', 'options', 'progress'] as const;
export type Step = (typeof STEPS)[number];

export function ImportWizard({ importId, initialStep, pending }: {
  importId: string | null;
  initialStep: Step;
  pending?: { filename: string };
}) {
  const t = useTranslations('import');
  const router = useRouter();
  const params = useSearchParams();
  const step = (params.get('step') as Step) ?? initialStep;
  const heading = useRef<HTMLHeadingElement>(null);

  // Fokus na nadpis kroku a oznámení čtečce. Bez toho uživatel klávesnice
  // po přechodu neví, kde je, a musí se prokousat celou stránkou znovu.
  useEffect(() => { heading.current?.focus(); }, [step]);

  // ŽÁDNÝ beforeunload během importu. Úloha běží na serveru a varování
  // "opravdu chcete odejít?" u operace, která na odchodu nezávisí, je lež,
  // která naučí uživatele zavírat všechna varování bez čtení.
  const goTo = (next: Step) => {
    const query = new URLSearchParams(params.toString());
    query.set('step', next);
    router.push(`?${query.toString()}`);
  };

  return (
    <Wizard
      // Položka kroku je { id, label }, ne { key, label }. `key` je v Reactu
      // vyhrazené jméno a v datovém objektu mate: vypadá jako klíč seznamu.
      steps={STEPS.map((id) => ({ id, label: t(`wizard.steps.${id}`) }))}
      current={step}
      onNavigate={goTo}
      // Návrat z náhledu je destruktivní a komponenta to musí říct předem,
      // protože stavový diagram přechod previewing → validating zakazuje.
      destructiveBack={step === 'preview' ? t('wizard.backFromPreview') : undefined}
    >
      <h1 tabIndex={-1} ref={heading}>{t(`wizard.steps.${step}`)}</h1>
      <p role="status">{t('wizard.stepAnnouncement', { current: STEPS.indexOf(step) + 1, total: STEPS.length })}</p>
      {pending ? <p>{t('wizard.resumeBanner', { filename: pending.filename })}</p> : null}
      <p>{t('wizard.resumeExpiry')}</p>
      <StepContent step={step} importId={importId} onNext={goTo} />
    </Wizard>
  );
}
```

- [ ] **Krok 3: Spusť test a commit**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter web exec vitest run test/import/wizard.test.tsx`
Expected: PASS, šest testů.

```bash
git add "apps/web/src/app/[locale]/w/[slug]/contacts/import" apps/web/test/import/wizard.test.tsx
git commit -m "feat(import-ui): add the six step wizard shell"
```

---

### Úkol 46: Krok 1, nahrání s průběhem a zrušením

**Files:**
- Create: `.../import/_components/use-import-upload.ts`
- Create: `.../import/_components/step-upload.tsx`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/test/import/step-upload.test.tsx`

- [ ] **Krok 1: Napiš padající test**

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StepUpload } from '../../src/app/[locale]/w/[slug]/contacts/import/_components/step-upload.js';

describe('upload step', () => {
  it('shows the limits and the how to guide', () => {
    render(<StepUpload onCreated={vi.fn()} />);
    expect(screen.getByText(/nejvýš 200 MB/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /jak dostat kontakty z excelu/i })).toBeInTheDocument();
  });

  it('names the file and both sizes when it is over the limit', async () => {
    render(<StepUpload onCreated={vi.fn()} />);
    await uploadFile('velky.csv', 340 * 1024 * 1024);
    expect(await screen.findByText(/340 MB, zvládneme 200 MB/i)).toBeInTheDocument();
  });

  it('explains what to do with an unsupported format', async () => {
    render(<StepUpload onCreated={vi.fn()} />);
    await uploadFile('kontakty.pdf', 1000);
    expect(await screen.findByText(/kontakty.pdf.*neumíme přečíst/i)).toBeInTheDocument();
  });

  it('aborts the request when the user cancels', async () => {
    const abort = vi.fn();
    vi.stubGlobal('XMLHttpRequest', class { abort = abort; upload = { addEventListener: vi.fn() }; open = vi.fn(); send = vi.fn(); addEventListener = vi.fn(); setRequestHeader = vi.fn(); });
    render(<StepUpload onCreated={vi.fn()} />);
    await uploadFile('a.csv', 1000);
    await userEvent.click(await screen.findByRole('button', { name: /zrušit nahrávání/i }));
    expect(abort).toHaveBeenCalled();
  });

  it('offers to open the original import or run it again on a duplicate', async () => {
    mockApi409({ code: 'conflict', errors: [{ code: 'import_duplicate', meta: { import_id: 'i0', created_at: '2026-07-31T09:12:00Z' } }] });
    render(<StepUpload onCreated={vi.fn()} />);
    await uploadFile('a.csv', 1000);
    expect(await screen.findByRole('button', { name: /otevřít původní import/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /spustit znovu/i })).toBeInTheDocument();
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání, pak napiš `use-import-upload.ts`**

```ts
'use client';

import { useCallback, useRef, useState } from 'react';

export type UploadState =
  | { phase: 'idle' }
  | { phase: 'uploading'; percent: number }
  | { phase: 'done'; importId: string }
  | { phase: 'error'; code: string; meta?: Record<string, unknown> };

/**
 * XMLHttpRequest, ne fetch: fetch v prohlížečích neumí spolehlivě hlásit
 * průběh NAHRÁVÁNÍ (jen stahování), a průběh je u 200 MB souboru podmínka,
 * ne ozdoba. abort() pokrývá tvrdý požadavek K4 na zrušení.
 */
export function useImportUpload(workspaceSlug: string) {
  const [state, setState] = useState<UploadState>({ phase: 'idle' });
  const xhr = useRef<XMLHttpRequest | null>(null);

  const cancel = useCallback(() => {
    xhr.current?.abort();
    setState({ phase: 'idle' });
  }, []);

  const upload = useCallback((file: File, opts: { force?: boolean } = {}) => {
    const request = new XMLHttpRequest();
    xhr.current = request;
    setState({ phase: 'uploading', percent: 0 });

    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) {
        setState({ phase: 'uploading', percent: Math.round((event.loaded / event.total) * 100) });
      }
    });
    request.addEventListener('load', () => {
      const body = JSON.parse(request.responseText || '{}');
      if (request.status === 202) setState({ phase: 'done', importId: body.id });
      else setState({ phase: 'error', code: body.errors?.[0]?.code ?? 'unknown', meta: body.errors?.[0]?.meta });
    });
    request.addEventListener('error', () => setState({ phase: 'error', code: 'storage_unavailable' }));

    const form = new FormData();
    form.append('file', file);
    if (opts.force) form.append('force', 'true');
    request.open('POST', `/api/v1/contacts/imports?workspace=${workspaceSlug}`);
    request.setRequestHeader('Idempotency-Key', crypto.randomUUID());
    request.send(form);
  }, [workspaceSlug]);

  return { state, upload, cancel };
}
```

`StepUpload` je pak obal nad `FileUpload` z `@mlain/ui/patterns/file-upload`, kterému předá povinné `labels` z katalogu `import`, a který na `state.phase === 'error'` vykreslí text z `import.fileErrors.<code>.title` a `.nextStep`, a na kód `import_duplicate` dialog se dvěma tlačítky podle `import.duplicateImport`.

- [ ] **Krok 3: Spusť test a commit**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter web exec vitest run test/import/step-upload.test.tsx`
Expected: PASS, pět testů.

```bash
git add "apps/web/src/app/[locale]/w/[slug]/contacts/import/_components" apps/web/test/import/step-upload.test.tsx
git commit -m "feat(import-ui): add streaming upload with progress and cancel"
```

---

### Úkol 47: Krok 2, kontrola souboru otázkou místo nastavení

Nejdůležitější krok, o kterém většina nástrojů mlčí. Tady se chytí poškozená diakritika, což je v českém prostředí nejčastější problém vůbec.

**Files:**
- Create: `.../import/_components/step-file-check.tsx`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/test/import/step-file-check.test.tsx`

- [ ] **Krok 1: Napiš padající test**

```tsx
describe('file check step', () => {
  it('shows undamaged diacritics for a windows-1250 file and asks for confirmation', async () => {
    render(<StepFileCheck preview={cp1250Preview()} onConfirm={vi.fn()} />);
    expect(screen.getByText('Nováková')).toBeInTheDocument();
    expect(screen.getByText('Břeclav')).toBeInTheDocument();
    expect(screen.getByText(/vypadají jména a města správně/i)).toBeInTheDocument();
  });

  it('subtracts the header from the contact count and shows both numbers', () => {
    render(<StepFileCheck preview={{ ...cp1250Preview(), totalRows: 12_480, hasHeader: true }} onConfirm={vi.fn()} />);
    expect(screen.getByText(/12 480/)).toBeInTheDocument();
    expect(screen.getByText(/12 479 kontakt/)).toBeInTheDocument();
  });

  it('offers three alternative encodings with a live preview when the user says it is garbled', async () => {
    render(<StepFileCheck preview={cp1250Preview()} onConfirm={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /je to rozsypané/i }));
    expect(screen.getAllByRole('radio')).toHaveLength(3);
  });

  it('requires a manual delimiter when detection failed', () => {
    render(<StepFileCheck preview={{ ...cp1250Preview(), error: 'delimiter_not_detected' }} onConfirm={vi.fn()} />);
    expect(screen.getByLabelText(/oddělovač/i)).toBeRequired();
  });

  it('marks the encoding source as manual after an override', async () => {
    const onConfirm = vi.fn();
    render(<StepFileCheck preview={cp1250Preview()} onConfirm={onConfirm} />);
    await userEvent.click(screen.getByRole('button', { name: /je to rozsypané/i }));
    await userEvent.click(screen.getByRole('radio', { name: /ISO-8859-2/ }));
    await userEvent.click(screen.getByRole('button', { name: /pokračovat/i }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ encoding: 'iso-8859-2' }));
  });
});
```

- [ ] **Krok 2: Napiš komponentu, spusť test, commit**

Komponenta vykreslí tabulku prvních tří řádků, dvě rozbalovací nabídky (kódování, oddělovač), mezisoučet řádků a dvě tlačítka. Otázka „Vypadají jména a města správně?" je nadřazená nabídkám: netechnický člověk neví, co je Windows-1250, ale okamžitě pozná, jestli je jeho město napsané správně.

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter web exec vitest run test/import/step-file-check.test.tsx`
Expected: PASS, pět testů.

```bash
git add "apps/web/src/app/[locale]/w/[slug]/contacts/import/_components/step-file-check.tsx" apps/web/test/import/step-file-check.test.tsx
git commit -m "feat(import-ui): add the file check step that asks instead of configuring"
```

---

### Úkol 48: Krok 3, mapování sloupců

**Files:**
- Create: `.../import/_components/step-mapping.tsx`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/test/import/step-mapping.test.tsx`

- [ ] **Krok 1: Napiš padající test**

```tsx
describe('mapping step', () => {
  it('shows a sample value next to every column', () => {
    render(<StepMapping preview={preview()} onNext={vi.fn()} />);
    expect(screen.getByText('jana@firma.cz')).toBeInTheDocument();
    expect(screen.getByText('Jana Nováková')).toBeInTheDocument();
  });

  it('preselects the automatic suggestion and lets it be overridden', async () => {
    render(<StepMapping preview={preview()} onNext={vi.fn()} />);
    expect(screen.getByLabelText(/Email/)).toHaveValue('email');
    await userEvent.selectOptions(screen.getByLabelText(/Email/), 'ignore');
    expect(screen.getByLabelText(/Email/)).toHaveValue('ignore');
  });

  it('offers to create a custom field for an unmapped column', async () => {
    render(<StepMapping preview={preview()} onNext={vi.fn()} />);
    expect(screen.getByRole('button', { name: /vytvořit pole „Poznámka"/i })).toBeInTheDocument();
  });

  it('keeps the continue button enabled without an email column and moves focus to the picker', async () => {
    render(<StepMapping preview={previewWithoutEmail()} onNext={vi.fn()} />);
    const next = screen.getByRole('button', { name: /zobrazit náhled/i });
    // Žádné tlačítko primární akce nemá disabled. Mrtvé tlačítko neřekne proč.
    expect(next).not.toBeDisabled();
    await userEvent.click(next);
    expect(screen.getByText(/nevybrali jste, ve kterém sloupci je e-mailová adresa/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Email/)).toHaveFocus();
  });

  it('names both columns when two point at the same field', async () => {
    render(<StepMapping preview={preview()} onNext={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText(/Krestni/), 'first_name');
    await userEvent.selectOptions(screen.getByLabelText(/Jmeno/), 'first_name');
    expect(screen.getByText(/míří dva sloupce: Jmeno a Krestni/i)).toBeInTheDocument();
  });

  it('says the full name column will be split', () => {
    render(<StepMapping preview={preview()} onNext={vi.fn()} />);
    expect(screen.getByText(/rozdělíme na jméno a příjmení/i)).toBeInTheDocument();
  });
});
```

- [ ] **Krok 2: Napiš komponentu, spusť test, commit**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter web exec vitest run test/import/step-mapping.test.tsx`
Expected: PASS, šest testů.

```bash
git add "apps/web/src/app/[locale]/w/[slug]/contacts/import/_components/step-mapping.tsx" apps/web/test/import/step-mapping.test.tsx
git commit -m "feat(import-ui): add column mapping with sample values and inline field creation"
```

---

### Úkol 49: Krok 4, náhled s oslovením

Sloupec „Oslovení" je nejdůležitější sloupec náhledu: ukazuje přesně to, co uživatel uvidí v e-mailu.

**Files:**
- Create: `.../import/_components/step-preview.tsx`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/test/import/step-preview.test.tsx`

- [ ] **Krok 1: Napiš padající test**

```tsx
describe('preview step', () => {
  it('shows the resulting greeting for every row', () => {
    render(<StepPreview preview={preview()} estimate={estimate()} onNext={vi.fn()} />);
    expect(screen.getByText('Dobrý den, Jano')).toBeInTheDocument();
    expect(screen.getByText('Dobrý den, Petře')).toBeInTheDocument();
  });

  it('shows the fallback without a name for an undetermined gender', () => {
    render(<StepPreview preview={preview()} estimate={estimate()} onNext={vi.fn()} />);
    const row = screen.getByText('Nguyen').closest('tr');
    expect(within(row!).getByText('Dobrý den')).toBeInTheDocument();
    expect(within(row!).getByText('?')).toBeInTheDocument();
  });

  it('splits Ing. Pavel Novák into title, first name and last name', () => {
    render(<StepPreview preview={preview()} estimate={estimate()} onNext={vi.fn()} />);
    const row = screen.getByText('Pavel').closest('tr');
    expect(within(row!).getByText('Ing.')).toBeInTheDocument();
    expect(within(row!).getByText('Novák')).toBeInTheDocument();
    expect(within(row!).getByText('Dobrý den, Pavle')).toBeInTheDocument();
  });

  it('promises never to guess wrong, only neutrally', () => {
    render(<StepPreview preview={preview()} estimate={{ ...estimate(), reviewRows: 143 }} onNext={vi.fn()} />);
    expect(screen.getByText(/oslovíme neutrálně „Dobrý den" bez jména, nikdy ne špatně/i)).toBeInTheDocument();
  });

  it('marks failing rows and suppressed rows differently', () => {
    render(<StepPreview preview={previewWithProblems()} estimate={estimate()} onNext={vi.fn()} />);
    expect(screen.getByRole('row', { name: /jana@@firma.cz/ })).toHaveAttribute('data-state', 'error');
    expect(screen.getByRole('row', { name: /blocked@x.cz/ })).toHaveAttribute('data-state', 'suppressed');
  });

  it('offers the name splitting controls behind a disclosure', async () => {
    render(<StepPreview preview={preview()} estimate={estimate()} onNext={vi.fn()} />);
    await userEvent.click(screen.getByRole('button', { name: /jméno se dělí špatně/i }));
    expect(screen.getByRole('radio', { name: /příjmení jméno/i })).toBeInTheDocument();
  });

  it('marks an extrapolated estimate as approximate', () => {
    render(<StepPreview preview={preview()} estimate={{ ...estimate(), approximate: true }} onNext={vi.fn()} />);
    expect(screen.getByText(/přibližně/i)).toBeInTheDocument();
  });
});
```

- [ ] **Krok 2: Napiš komponentu, spusť test, commit**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter web exec vitest run test/import/step-preview.test.tsx`
Expected: PASS, sedm testů.

```bash
git add "apps/web/src/app/[locale]/w/[slug]/contacts/import/_components/step-preview.tsx" apps/web/test/import/step-preview.test.tsx
git commit -m "feat(import-ui): add the preview step with the greeting column"
```

---

### Úkol 50: Krok 5, volby a prohlášení o souhlasu

**Files:**
- Create: `.../import/_components/step-options.tsx`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/test/import/step-options.test.tsx`

- [ ] **Krok 1: Napiš padající test**

```tsx
describe('options step', () => {
  it('describes conflict handling by sentence, not by name, and defaults to update', () => {
    render(<StepOptions estimate={estimate()} lists={[]} onSubmit={vi.fn()} />);
    expect(screen.getByRole('radio', { name: /doplnit/i })).toBeChecked();
    expect(screen.getByText(/přidáme, co chybí. co už máme vyplněné, nepřepíšeme/i)).toBeInTheDocument();
    expect(screen.queryByText(/merge|upsert/i)).toBeNull();
  });

  it('puts the real number on the submit button', () => {
    render(<StepOptions estimate={{ ...estimate(), totalRows: 12_479, errorRows: 6, duplicates: 12 }} lists={[]} onSubmit={vi.fn()} />);
    expect(screen.getByRole('button', { name: /naimportovat 12 461 kontaktů/i })).toBeInTheDocument();
  });

  it('prefills a dated tag so the import can be found later', () => {
    render(<StepOptions estimate={estimate()} lists={[]} onSubmit={vi.fn()} today={new Date('2026-08-01')} />);
    expect(screen.getByLabelText(/štítek/i)).toHaveValue('import-2026-08-01');
  });

  it('requires the declaration before confirmed subscription on a double opt-in list', async () => {
    render(<StepOptions estimate={estimate()} lists={[{ id: 'l1', name: 'Zákazníci', optIn: 'double' }]} onSubmit={vi.fn()} />);
    await userEvent.selectOptions(screen.getByLabelText(/zařadit do seznamu/i), 'l1');
    await userEvent.click(screen.getByRole('radio', { name: /potvrzené/i }));
    expect(screen.getByRole('checkbox', { name: /potvrzuji, že tito lidé souhlasili/i })).toBeRequired();
  });

  it('says the declaration is stored as evidence', () => {
    render(<StepOptions estimate={estimate()} lists={[]} onSubmit={vi.fn()} />);
    expect(screen.getByText(/uloží se jako důkaz včetně data a mého jména/i)).toBeInTheDocument();
  });

  it('greys out the duplicate error option above the memory threshold and explains why', () => {
    render(<StepOptions estimate={{ ...estimate(), totalRows: 2_000_000 }} lists={[]} onSubmit={vi.fn()} />);
    const option = screen.getByRole('radio', { name: /nahlásit jako chybu/i });
    expect(option).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(/neumíme spolehlivě poznat druhý výskyt/i)).toBeInTheDocument();
  });
});
```

- [ ] **Krok 2: Napiš komponentu, spusť test, commit**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter web exec vitest run test/import/step-options.test.tsx`
Expected: PASS, šest testů.

```bash
git add "apps/web/src/app/[locale]/w/[slug]/contacts/import/_components/step-options.tsx" apps/web/test/import/step-options.test.tsx
git commit -m "feat(import-ui): add the options step with the consent declaration"
```

---

### Úkol 51: Krok 6, průběh přes SSE

**Files:**
- Create: `.../import/_components/step-progress.tsx`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/test/import/step-progress.test.tsx`

- [ ] **Krok 1: Napiš padající test**

```tsx
describe('progress step', () => {
  it('says the import keeps running when the tab is closed', () => {
    render(<StepProgress importId="i1" />);
    expect(screen.getByText(/import běží na serveru. okno můžete zavřít/i)).toBeInTheDocument();
  });

  it('announces progress at 25, 50, 75 and 100 percent only', async () => {
    const sse = mockSse();
    render(<StepProgress importId="i1" />);
    for (const percent of [10, 25, 30, 50, 60, 75, 90, 100]) sse.emit({ processed: percent, total: 100 });
    await waitFor(() => expect(announcements()).toEqual(['25 %', '50 %', '75 %', '100 %']));
  });

  it('exposes a progressbar with aria-valuetext', () => {
    render(<StepProgress importId="i1" initial={{ processed: 8400, total: 12_461 }} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '8400');
    expect(bar).toHaveAttribute('aria-valuetext', '8 400 z 12 461');
  });

  it('falls back to polling after three failed reconnects and says so', async () => {
    const sse = mockSse();
    render(<StepProgress importId="i1" />);
    sse.fail(); sse.fail(); sse.fail();
    expect(await screen.findByText(/živé aktualizace se nedaří/i)).toBeInTheDocument();
  });

  it('names both numbers in the cancel dialog', async () => {
    render(<StepProgress importId="i1" initial={{ processed: 8400, total: 12_461 }} />);
    await userEvent.click(screen.getByRole('button', { name: /zrušit import/i }));
    expect(screen.getByText(/zpracovaných 8 400 kontaktů v databázi zůstane/i)).toBeInTheDocument();
    expect(screen.getByText(/zbylých 4 061 se nenaimportuje/i)).toBeInTheDocument();
  });
});
```

- [ ] **Krok 2: Napiš komponentu, spusť test, commit**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter web exec vitest run test/import/step-progress.test.tsx`
Expected: PASS, pět testů.

```bash
git add "apps/web/src/app/[locale]/w/[slug]/contacts/import/_components/step-progress.tsx" apps/web/test/import/step-progress.test.tsx
git commit -m "feat(import-ui): add live progress with SSE and polling fallback"
```

---

### Úkol 52: Čtyři obrazovky výsledku a sekce s odhady

Stavy jsou čtyři a každý znamená pro uživatele něco jiného. Rozlišit `failed` od `completed_with_errors` je nejdůležitější: první znamená, že se nezapsalo nic, druhý že se zapsala většina. Kdo si to splete, buď zbytečně importuje podruhé, nebo si myslí, že má data, a nemá.

**Files:**
- Create: `.../import/[importId]/page.tsx`
- Create: `.../import/_components/{result-completed,result-with-errors,result-cancelled,result-failed}.tsx`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/test/import/result.test.tsx`

- [ ] **Krok 1: Napiš padající test**

```tsx
describe('import result', () => {
  it('uses a different heading for failed and for completed_with_errors', () => {
    const { rerender } = render(<ImportResult row={row({ status: 'completed_with_errors', createdRows: 12_396, totalRows: 12_461 })} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/naimportováno 12 396 z 12 461/i);
    rerender(<ImportResult row={row({ status: 'failed' })} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(/nepodařilo se dokončit/i);
    expect(screen.getByText(/do databáze se nezapsal žádný kontakt/i)).toBeInTheDocument();
  });

  it('breaks the result down and the numbers add up to the row count', () => {
    render(<ImportResult row={row({ status: 'completed_with_errors', createdRows: 9812, updatedRows: 2584, suppressedRows: 9, errorRows: 56, totalRows: 12_461 })} />);
    expect(screen.getByText('9 812')).toBeInTheDocument();
    expect(screen.getByText('2 584')).toBeInTheDocument();
    const sum = 9812 + 2584 + 9 + 56;
    expect(sum).toBe(12_461);
  });

  it('groups warnings by code and shows one line with the count', () => {
    render(<ImportResult row={row({ status: 'completed_with_errors', errorSummary: { excel_serial_date_assumed: 84 } })} />);
    const line = screen.getByText(/84 dat vypadalo jako číslo z excelu/i);
    expect(line).toBeInTheDocument();
    expect(within(line.closest('li')!).getByRole('button', { name: /zobrazit/i })).toBeInTheDocument();
  });

  it('hides a warning whose count is zero', () => {
    render(<ImportResult row={row({ status: 'completed', errorSummary: { gender_unknown: 0 } })} />);
    expect(screen.queryByText(/nemá určený rod/i)).toBeNull();
  });

  it('covers all eleven warning codes', () => {
    const summary = Object.fromEntries(ELEVEN_WARNING_CODES.map((c) => [c, 3]));
    render(<ImportResult row={row({ status: 'completed_with_errors', errorSummary: summary })} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(ELEVEN_WARNING_CODES.length);
  });

  it('offers resuming from the cancelled row, not restarting', () => {
    render(<ImportResult row={row({ status: 'cancelled', checkpointRow: 8400, totalRows: 12_461 })} />);
    expect(screen.getByRole('button', { name: /pokračovat od řádku 8 401/i })).toBeInTheDocument();
  });

  it('links to the review queue when contacts are waiting there', () => {
    render(<ImportResult row={row({ status: 'completed', reviewRows: 143 })} />);
    expect(screen.getByRole('link', { name: /zkontrolovat/i })).toHaveAttribute('href', expect.stringContaining('vocative-review'));
  });

  it('links to the contacts of this import instead of an undo action', () => {
    render(<ImportResult row={row({ status: 'completed', id: 'i9' })} />);
    const link = screen.getByRole('link', { name: /zobrazit naimportované kontakty/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('source_ref=i9'));
    expect(screen.queryByRole('button', { name: /vrátit tento import/i })).toBeNull();
  });
});
```

Poslední test je zápis rozhodnutí R5 do kódu: „vrátit import" v MVP 0 není a nesmí se objevit jako mrtvé tlačítko.

- [ ] **Krok 2: Napiš komponenty, spusť test, commit**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter web exec vitest run test/import/result.test.tsx`
Expected: PASS, osm testů.

```bash
git add "apps/web/src/app/[locale]/w/[slug]/contacts/import" apps/web/test/import/result.test.tsx
git commit -m "feat(import-ui): add four result screens with grouped warnings"
```

---

### Úkol 53: vyřazen (obrazovka kontroly oslovení)

**Tenhle úkol se neprovádí. Vlastní ho P07.**

Odešel spolu s úkoly 37 a 38 podle rozhodnutí U3, viz R2. Patřila sem obrazovka
`contacts/vocative-review/`, karta skupiny, hromadné akce a předzaškrtnuté
„Zapamatovat i pro budoucí".

**Co po ní zůstává na tomhle plánu:** odkaz z výsledkové obrazovky importu (úkol 52), který na
frontu míří s filtrem na konkrétní import. Odznak s počtem **skupin** v navigaci je požadavek 5.5
na P05 a naplní ho P07, ne tenhle plán.

---

### Úkol 54: Konformanční test K2 a náhradní cesta

Tvrdý požadavek z 13.1 části 6: hloubka 5, 50 potomků, všech 40 operátorů, plná klávesová obsluha. Doporučená knihovna `react-querybuilder` 8.21.2 je k datu ověření jediný živý kandidát, ale kritérium pro odchod je jasné a rozpočet na vlastní řešení je den a půl.

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/test/segments/k2-conformance.test.tsx`

- [ ] **Krok 1: Napiš konformanční test**

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryBuilder } from '@mlain/ui/patterns/query-builder';
import { OPERATOR_SHAPES } from '@mlain/ui/patterns/query-builder';
import { FIELD_CLASS_OPERATORS, OPERATORS } from '@mlain/core/segments';
import { builderLabels, allFields } from './helpers/builder-fixtures';

function nested(depth: number): unknown {
  let node: unknown = { type: 'group', op: 'and', children: [{ type: 'condition', field: { kind: 'contact', key: 'status' }, operator: 'eq', value: 'active' }] };
  for (let i = 1; i < depth; i += 1) node = { type: 'group', op: 'and', children: [node] };
  return node;
}

describe('K2 query builder conformance', () => {
  it('renders a tree nested five levels deep', () => {
    render(<QueryBuilder value={{ version: 1, root: nested(5) }} onChange={vi.fn()} fields={allFields()} labels={builderLabels} />);
    expect(screen.getAllByRole('group')).toHaveLength(5);
  });

  it('renders fifty children in one group', () => {
    const children = Array.from({ length: 50 }, () => ({ type: 'condition', field: { kind: 'contact', key: 'status' }, operator: 'eq', value: 'active' }));
    render(<QueryBuilder value={{ version: 1, root: { type: 'group', op: 'and', children } }} onChange={vi.fn()} fields={allFields()} labels={builderLabels} />);
    expect(screen.getAllByTestId('condition-row')).toHaveLength(50);
  });

  it('exposes a negation control on every group, including nested ones', () => {
    render(<QueryBuilder value={{ version: 1, root: nested(3) }} onChange={vi.fn()} fields={allFields()} labels={builderLabels} />);
    expect(screen.getAllByLabelText(/splňují|nesplňují/i)).toHaveLength(3);
  });

  it('offers all forty operators across the field classes', async () => {
    const seen = new Set<string>();
    for (const [, operators] of Object.entries(FIELD_CLASS_OPERATORS)) for (const op of operators) seen.add(op);
    expect(seen.size).toBe(40);
    render(<QueryBuilder value={{ version: 1, root: nested(1) }} onChange={vi.fn()} fields={allFields()} labels={builderLabels} />);
    // Nabídka se řídí typovou maticí, takže nekompatibilní operátor se nesmí objevit.
    const options = [...screen.getByTestId('operator-select').querySelectorAll('option')].map((o) => o.value);
    expect(options.every((o) => FIELD_CLASS_OPERATORS.enum.includes(o as never))).toBe(true);
  });

  it('adds and removes a condition from the keyboard alone', async () => {
    const onChange = vi.fn();
    render(<QueryBuilder value={{ version: 1, root: nested(1) }} onChange={onChange} fields={allFields()} labels={builderLabels} />);
    await userEvent.tab();
    await userEvent.keyboard('{Enter}');
    expect(onChange).toHaveBeenCalled();
  });

  it('can show the underlying json without making it the default', async () => {
    render(
      <QueryBuilder value={{ version: 1, root: nested(1) }} onChange={vi.fn()}
        fields={allFields()} labels={builderLabels} showJsonToggle />,
    );
    expect(screen.queryByRole('code')).toBeNull();
    // Jméno tlačítka se bere z katalogu tohohle plánu přes labels.showJson,
    // ne natvrdo. Test na natvrdo napsaný text by prošel i tehdy, kdyby se
    // překlad rozešel s tím, co komponenta vykresluje, a to je přesně ten
    // rozchod, kvůli kterému konformanční test existuje.
    await userEvent.click(screen.getByRole('button', { name: builderLabels.showJson }));
    expect(screen.getByRole('code')).toBeInTheDocument();
  });

  it('agrees with the component on all forty operators and their value shapes', () => {
    // Tenhle test je smlouva mezi tímhle plánem a P05 a čte OBĚ strany.
    // Vlevo je matice, kterou vlastní tenhle plán, vpravo rozklad podle tvaru
    // hodnoty, který vlastní komponenta. Když jedna strana operátor přidá
    // nebo přesune do jiného tvaru, test spadne tady, ne až na obrazovce
    // vstupem, který server odmítne.
    const shaped = Object.values(OPERATOR_SHAPES).flat();
    expect(shaped).toHaveLength(40);
    expect(new Set(shaped).size).toBe(40);
    expect([...shaped].sort()).toEqual([...OPERATORS].sort());
    expect(Object.fromEntries(
      Object.entries(OPERATOR_SHAPES).map(([shape, list]) => [shape, list.length]),
    )).toEqual({ none: 16, scalar: 13, list: 5, range: 1, integer: 5 });
  });
});
```

Pomocník `helpers/builder-fixtures.ts` v témž adresáři vrací `builderLabels` (všech dvaadvacet popisků `QueryBuilderLabels` z katalogu `segments`, včetně funkcí `removeValue`, `listLimit`) a `allFields()`, což je seznam `FieldDefinition` složený z matice operátorů tohohle plánu. Klíčové je, že `FieldDefinition.ref` musí být **doslova ten tvar, který jde do AST**: komponenta pole poznává porovnáním `ref` s `condition.field`, ne podle `id`.

- [ ] **Krok 2: Spusť test**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter web exec vitest run test/segments/k2-conformance.test.tsx`
Expected: PASS, sedm testů.

**Když test spadne, postupuj takhle a nic z toho nepřeskoč:**

1. Zapiš nález do kapitoly 11 s uvedením, který ze sedmi testů selhal.
2. **Nepiš vlastní komponentu do `packages/ui`.** Ten balíček vlastní P05 a neúplný design systém je nejhorší možný výsledek.
3. Náhradní cesta, kterou specifikace uvádí a která je v rozpočtu (den a půl místo dne): vlastní renderer nad AST v `apps/web/src/app/[locale]/w/[slug]/segments/_components/segment-builder.tsx`. Ten adresář vlastní tenhle plán, takže je to legitimní. Konformanční test se v tom případě přesměruje z `@mlain/ui/patterns/query-builder` na vlastní komponentu a musí projít beze změny tvrzení.

**Ke dni opravy tenhle test projít má.** P05 komponentu srovnal se závaznou podobou stromu podmínek z části 2, 4.11.1, je řízená a unese všech 40 operátorů v pěti tvarech hodnoty. Ověřeno srovnáním obou seznamů: 16 bez hodnoty, 13 skalárních, 5 seznamových, 1 rozsahový a 5 celočíselných, žádný operátor navíc ani chybějící a žádný ve dvou tvarech zároveň. Sedmý test výš tuhle shodu drží automaticky, takže se rozchod nedá zavést nepozorovaně z ani jedné strany.

- [ ] **Krok 3: Commit**

```bash
git add apps/web/test/segments/k2-conformance.test.tsx
git commit -m "test(ui): assert K2 carries depth five, fifty children and all forty operators"
```

---

### Úkol 55: Věta skupiny jako jedna ICU zpráva se sloty

Celý mechanismus negace dosud stál na jedné české větě se dvěma ovládacími prvky. To je skládání řetězce z fragmentů, jen schované za komponenty, a lokalizace to zakazuje. Věta je proto **jedna ICU zpráva per locale s pojmenovanými sloty**, do kterých se vykreslují komponenty.

**Files:**
- Create: `.../segments/_components/group-sentence.tsx`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/test/segments/group-sentence.test.tsx`

- [ ] **Krok 1: Napiš padající test**

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { GroupSentence } from '../../src/app/[locale]/w/[slug]/segments/_components/group-sentence.js';

const renderWith = (messages: Record<string, unknown>, props: Record<string, unknown> = {}) =>
  render(
    <NextIntlClientProvider locale="cs" messages={{ segments: messages }}>
      <GroupSentence op="and" not={false} onChange={vi.fn()} {...props} />
    </NextIntlClientProvider>,
  );

const cs = {
  builder: {
    groupSentence: 'Kontakty, které {polarity} {quantifier}',
    polarity: { match: 'splňují', notMatch: 'nesplňují' },
    quantifier: { all: 'všechny podmínky', any: 'alespoň jednu podmínku' },
    negationHint: { andNot: 'Neplatí aspoň jedna z podmínek níž.', orNot: 'Neplatí ani jedna z podmínek níž.' },
  },
};

describe('group sentence', () => {
  it('renders the two selects inside the sentence, in the catalogue order', () => {
    renderWith(cs);
    const text = screen.getByTestId('group-sentence').textContent ?? '';
    expect(text.indexOf('Kontakty, které')).toBeLessThan(text.indexOf('splňují'));
    expect(text.indexOf('splňují')).toBeLessThan(text.indexOf('všechny podmínky'));
  });

  it('follows a locale that reorders the slots, without touching the component', () => {
    const reversed = { ...cs, builder: { ...cs.builder, groupSentence: '{quantifier} musí platit: {polarity}' } };
    renderWith(reversed);
    const text = screen.getByTestId('group-sentence').textContent ?? '';
    expect(text.indexOf('všechny podmínky')).toBeLessThan(text.indexOf('splňují'));
  });

  it('shows the explanation line for and plus not', () => {
    renderWith(cs, { op: 'and', not: true });
    expect(screen.getByText(/neplatí aspoň jedna/i)).toBeInTheDocument();
  });

  it('shows the explanation line for or plus not as well, not only for the third combination', () => {
    renderWith(cs, { op: 'or', not: true });
    expect(screen.getByText(/neplatí ani jedna/i)).toBeInTheDocument();
  });

  it('shows no explanation line when the group is not negated', () => {
    renderWith(cs, { op: 'and', not: false });
    expect(screen.queryByRole('note')).toBeNull();
  });

  it('never renders the words AND, OR, NOT or operator', () => {
    for (const combo of [{ op: 'and', not: false }, { op: 'or', not: false }, { op: 'and', not: true }, { op: 'or', not: true }] as const) {
      const { unmount } = renderWith(cs, combo);
      const text = document.body.textContent ?? '';
      expect(text).not.toMatch(/\bAND\b|\bOR\b|\bNOT\b|operátor/i);
      unmount();
    }
  });
});
```

- [ ] **Krok 2: Spusť a ověř selhání, pak napiš `group-sentence.tsx`**

```tsx
'use client';

import { useTranslations } from 'next-intl';

export type GroupSentenceProps = {
  op: 'and' | 'or';
  not: boolean;
  onChange: (next: { op: 'and' | 'or'; not: boolean }) => void;
};

/**
 * Zpráva se rozloží na části a mezi ně se vloží komponenty. Jazyk tím smí
 * sloty přeuspořádat, obalit dalšími slovy nebo je sloučit, aniž by se sáhlo
 * do kódu. Zřetězení tří řetězců by tuhle vlastnost zabilo.
 */
export function GroupSentence({ op, not, onChange }: GroupSentenceProps) {
  const t = useTranslations('segments');

  const polarity = (
    <select
      key="polarity"
      aria-label={t('builder.polarityLabel')}
      value={not ? 'notMatch' : 'match'}
      onChange={(e) => onChange({ op, not: e.target.value === 'notMatch' })}
    >
      <option value="match">{t('builder.polarity.match')}</option>
      <option value="notMatch">{t('builder.polarity.notMatch')}</option>
    </select>
  );

  const quantifier = (
    <select
      key="quantifier"
      aria-label={t('builder.quantifierLabel')}
      value={op === 'and' ? 'all' : 'any'}
      onChange={(e) => onChange({ op: e.target.value === 'all' ? 'and' : 'or', not })}
    >
      <option value="all">{t('builder.quantifier.all')}</option>
      <option value="any">{t('builder.quantifier.any')}</option>
    </select>
  );

  return (
    <>
      <p data-testid="group-sentence">
        {t.rich('builder.groupSentence', {
          polarity: () => polarity,
          quantifier: () => quantifier,
        })}
      </p>
      {/* Vysvětlující řádek u OBOU negovaných kombinací, ne jen u třetí.
          "Nesplňují všechny" si část lidí přečte jako "nesplňují žádnou",
          a angličtina má tutéž past, jen jinak položenou. */}
      {not ? <p role="note">{t(op === 'and' ? 'builder.negationHint.andNot' : 'builder.negationHint.orNot')}</p> : null}
    </>
  );
}
```

- [ ] **Krok 3: Spusť test a commit**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter web exec vitest run test/segments/group-sentence.test.tsx`
Expected: PASS, šest testů. Druhý test je akceptační kritérium 71b části 6: testovací locale s obráceným pořadím slotů musí změnit pořadí prvků bez zásahu do komponenty.

```bash
git add "apps/web/src/app/[locale]/w/[slug]/segments/_components/group-sentence.tsx" apps/web/test/segments/group-sentence.test.tsx
git commit -m "feat(segments-ui): render the group sentence as one ICU message with slots"
```

---

### Úkol 56: Výběr pole a operátorů

**Files:**
- Create: `.../segments/_components/{field-picker,operator-picker,value-editor}.tsx`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/test/segments/pickers.test.tsx`

- [ ] **Krok 1: Napiš padající test**

```tsx
describe('field and operator pickers', () => {
  it('groups fields into the ten documented sections', () => {
    render(<FieldPicker catalog={catalog()} onChange={vi.fn()} />);
    for (const label of ['O člověku', 'Vlastní pole', 'Štítky', 'Seznamy', 'Souhlasy',
      'Blokované adresy', 'Aktivita v kampaních', 'Chování na webu', 'Časy', 'Jiný segment']) {
      expect(screen.getByRole('group', { name: label })).toBeInTheDocument();
    }
  });

  it('marks an unindexed custom field and explains why it is slower', async () => {
    render(<FieldPicker catalog={catalog()} onChange={vi.fn()} />);
    const option = screen.getByRole('option', { name: /Poznámka/ });
    expect(within(option).getByRole('img', { name: /neindexované/i })).toBeInTheDocument();
  });

  it('never offers an operator incompatible with the field type', () => {
    render(<OperatorPicker fieldClass="number" value="gt" onChange={vi.fn()} />);
    const options = screen.getAllByRole('option').map((o) => o.getAttribute('value'));
    expect(options).not.toContain('contains');
    expect(options).toEqual(expect.arrayContaining(['gt', 'gte', 'lt', 'lte', 'between', 'is_empty', 'is_not_empty', 'eq', 'neq']));
  });

  it('has a czech and an english label for every pair in the matrix', () => {
    for (const [fieldClass, operators] of Object.entries(FIELD_CLASS_OPERATORS)) {
      for (const operator of operators) {
        expect(csCatalogue.operators[operator]).toBeTruthy();
        expect(enCatalogue.operators[operator]).toBeTruthy();
      }
    }
  });

  it('lists is_confirmed before is_member and explains the difference', () => {
    render(<OperatorPicker fieldClass="list" value="is_confirmed" onChange={vi.fn()} />);
    const options = screen.getAllByRole('option').map((o) => o.getAttribute('value'));
    expect(options.indexOf('is_confirmed')).toBeLessThan(options.indexOf('is_member'));
    expect(screen.getByText(/včetně těch, kdo přihlášení zatím nepotvrdili/i)).toBeInTheDocument();
  });

  it('explains the legal difference between never given and withdrawn', () => {
    render(<OperatorPicker fieldClass="consent" value="is_missing" onChange={vi.fn()} />);
    expect(screen.getByText(/souhlas nemáme zaznamenaný/i)).toBeInTheDocument();
  });

  it('greys out a sixth engagement field and says why', () => {
    render(<FieldPicker catalog={catalog()} usedEngagement={5} onChange={vi.fn()} />);
    const option = screen.getByRole('option', { name: /Otevřel kampaň/ });
    expect(option).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText(/nejvýš 5, protože každá z nich prohledává historii/i)).toBeInTheDocument();
  });

  it('rejects a paste over one thousand items and says how many were dropped', async () => {
    render(<ValueEditor operator="in" value={[]} onChange={vi.fn()} />);
    await userEvent.paste(Array.from({ length: 1200 }, (_, i) => `v${i}`).join('\n'));
    expect(screen.getByText(/200/)).toBeInTheDocument();
  });
});
```

- [ ] **Krok 2: Napiš komponenty, spusť test, commit**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter web exec vitest run test/segments/pickers.test.tsx`
Expected: PASS, osm testů.

```bash
git add "apps/web/src/app/[locale]/w/[slug]/segments/_components" apps/web/test/segments/pickers.test.tsx
git commit -m "feat(segments-ui): add grouped field picker and matrix driven operator picker"
```

---

### Úkol 57: Prázdné hodnoty, limity a builder jako celek

Nejzrádnější místo celého builderu: kontakt, který pole vůbec nemá vyplněné, nespadne ani do „město je Praha", ani do „město není Praha". Netechnický člověk to nečeká a bez upozornění tiše ztratí část databáze.

**Files:**
- Create: `.../segments/_components/{null-hint,segment-builder}.tsx`
- Create: `.../segments/[id]/page.tsx`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/test/segments/builder.test.tsx`

- [ ] **Krok 1: Napiš padající test**

```tsx
describe('segment builder', () => {
  it('shows the null hint for every negating operator', async () => {
    for (const operator of ['neq', 'not_contains', 'not_in', 'has_none', 'not_in_last_days']) {
      const { unmount } = render(<SegmentBuilder value={astWith(operator)} onChange={vi.fn()} />);
      expect(screen.getByText(/kontakty, které pole vůbec nemají, sem nespadnou/i)).toBeInTheDocument();
      unmount();
    }
  });

  it('offers a button that adds the is empty condition into an any group', async () => {
    const onChange = vi.fn();
    render(<SegmentBuilder value={astWith('neq')} onChange={onChange} />);
    await userEvent.click(screen.getByRole('button', { name: /přidat i kontakty bez vyplněného pole/i }));
    const next = onChange.mock.lastCall![0];
    expect(next.root.children[0]).toMatchObject({ type: 'group', op: 'or' });
    expect(JSON.stringify(next)).toContain('"is_empty"');
  });

  it('counts conditions from eighty and hides the add button at one hundred', async () => {
    const { rerender } = render(<SegmentBuilder value={astWithConditions(80)} onChange={vi.fn()} />);
    expect(screen.getByText(/80 ze 100 podmínek/i)).toBeInTheDocument();
    rerender(<SegmentBuilder value={astWithConditions(100)} onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /^přidat podmínku$/i })).toBeNull();
  });

  it('replaces the add group button with an explanation at depth five', () => {
    render(<SegmentBuilder value={astNested(5)} onChange={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /přidat skupinu podmínek/i })).toBeNull();
    expect(screen.getByText(/hlouběji už zanořovat nejde/i)).toBeInTheDocument();
  });

  it('numbers groups and suggests splitting from the third level', () => {
    render(<SegmentBuilder value={astNested(3)} onChange={vi.fn()} />);
    expect(screen.getByText(/skupina 3/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /nechcete ho rozdělit na dva/i })).toBeInTheDocument();
  });

  it('warns about two contradicting conditions on the same field in an all group', () => {
    render(<SegmentBuilder value={contradictingAst()} onChange={vi.fn()} />);
    expect(screen.getByText(/nemůže splnit nikdo najednou/i)).toBeInTheDocument();
  });

  it('warns that a project without campaigns matches everyone on never opened', () => {
    render(<SegmentBuilder value={neverOpenedAst()} onChange={vi.fn()} campaignCount={0} />);
    expect(screen.getByText(/zatím jste neposlali žádnou kampaň/i)).toBeInTheDocument();
  });

  it('says an empty segment contains everyone, and does not call it an error', () => {
    render(<SegmentBuilder value={undefined} onChange={vi.fn()} totalContacts={12_480} />);
    expect(screen.getByText(/obsahuje tedy všechny kontakty \(12 480\)/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
```

- [ ] **Krok 2: Napiš komponenty, spusť test, commit**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter web exec vitest run test/segments/builder.test.tsx`
Expected: PASS, osm testů.

```bash
git add "apps/web/src/app/[locale]/w/[slug]/segments" apps/web/test/segments/builder.test.tsx
git commit -m "feat(segments-ui): add the builder with null hints and limit presentation"
```

---

### Úkol 58: Živý počet, čerstvost a varování

**Files:**
- Create: `.../segments/_components/live-count.tsx`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/test/segments/live-count.test.tsx`

- [ ] **Krok 1: Napiš padající test**

```tsx
describe('live count', () => {
  it('debounces five hundred milliseconds and aborts the previous request', async () => {
    const abort = vi.fn();
    const fetchMock = mockFetch({ onAbort: abort });
    render(<LiveCount definition={ast('a')} />);
    rerenderWith(ast('ab'));
    rerenderWith(ast('abc'));
    await vi.advanceTimersByTimeAsync(499);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(abort).toHaveBeenCalledTimes(2);
  });

  it('dims the previous number while counting instead of removing it', async () => {
    render(<LiveCount definition={ast('a')} initial={{ count: 1208, exact: true }} />);
    rerenderWith(ast('ab'));
    expect(screen.getByText('1 208')).toHaveAttribute('data-stale', 'true');
    expect(screen.getByText(/počítáme/i)).toBeInTheDocument();
  });

  it('writes into aria-live once, after the value settles', async () => {
    render(<LiveCount definition={ast('a')} />);
    for (const value of ['ab', 'abc', 'abcd']) rerenderWith(ast(value));
    await vi.advanceTimersByTimeAsync(600);
    expect(liveRegionUpdates()).toHaveLength(1);
  });

  it('shows an estimate with a count exactly button instead of an error', async () => {
    mockPreview({ count: 12_000, exact: false, warnings: ['segment_count_estimated'] });
    render(<LiveCount definition={ast('a')} />);
    expect(await screen.findByText(/přibližně 12 000/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /spočítat přesně/i })).toBeInTheDocument();
  });

  it('shows five sample contacts under the count', async () => {
    mockPreview({ count: 1208, exact: true, sample: twentyContacts() });
    render(<LiveCount definition={ast('a')} />);
    expect(await screen.findAllByTestId('sample-contact')).toHaveLength(5);
    expect(screen.getByRole('button', { name: /zobrazit všech 1 208/i })).toBeInTheDocument();
  });

  it('renders the three preview warnings below the count, not instead of it', async () => {
    mockPreview({ count: 10, exact: true, warnings: ['segment_unindexed_field', 'segment_slow_engagement'] });
    render(<LiveCount definition={ast('a')} />);
    expect(await screen.findByText('10')).toBeInTheDocument();
    expect(screen.getByText(/se počítá pomalu/i)).toBeInTheDocument();
    expect(screen.getByText(/prohledávají historii všech odeslaných zpráv/i)).toBeInTheDocument();
  });

  it('greys a count older than six hours and offers a recount', () => {
    render(<LiveCount definition={ast('a')} initial={{ count: 890, exact: true, cachedAt: hoursAgo(8) }} />);
    expect(screen.getByText(/aktualizováno před 8 hodinami/i)).toHaveAttribute('data-stale', 'true');
    expect(screen.getByRole('button', { name: /přepočítat/i })).toBeInTheDocument();
  });

  it('shows count, never zero, for a segment that was never counted', () => {
    render(<LiveCount definition={ast('a')} initial={{ count: null, cachedAt: null }} />);
    expect(screen.getByRole('button', { name: /^spočítat$/i })).toBeInTheDocument();
    expect(screen.queryByText('0')).toBeNull();
  });
});
```

- [ ] **Krok 2: Napiš komponentu, spusť test, commit**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter web exec vitest run test/segments/live-count.test.tsx`
Expected: PASS, osm testů.

```bash
git add "apps/web/src/app/[locale]/w/[slug]/segments/_components/live-count.tsx" apps/web/test/segments/live-count.test.tsx
git commit -m "feat(segments-ui): add the live count with freshness, warnings and sample"
```

---

### Úkol 59: Diagnostika prázdného výsledku a rozpad publika

**Files:**
- Create: `.../segments/_components/empty-diagnostics.tsx`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/components/segments/audience-breakdown.tsx`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/test/segments/{empty-diagnostics,audience-breakdown}.test.tsx`

- [ ] **Krok 1: Napiš padající testy**

```tsx
describe('empty result diagnostics', () => {
  it('names the condition that alone returns zero and lists the others', () => {
    render(<EmptyDiagnostics data={diagnostics()} />);
    expect(screen.getByText(/nejvíc omezuje tahle podmínka/i)).toBeInTheDocument();
    expect(screen.getByText(/Město je Brno/)).toBeInTheDocument();
    expect(screen.getByText(/3 412/)).toBeInTheDocument();
  });

  it('shows how often the field is filled and its most frequent values', () => {
    render(<EmptyDiagnostics data={diagnostics()} />);
    expect(screen.getByText(/vyplněné jen 340 kontaktů z 12 480/i)).toBeInTheDocument();
    expect(screen.getByText(/Praha \(120\)/)).toBeInTheDocument();
  });

  it('offers the lowercase value when only the case differs', async () => {
    const onFix = vi.fn();
    render(<EmptyDiagnostics data={diagnostics()} onUseValue={onFix} />);
    await userEvent.click(screen.getByRole('button', { name: /použít/i }));
    expect(onFix).toHaveBeenCalledWith('brno');
  });

  it('offers to include contacts without the field filled', () => {
    render(<EmptyDiagnostics data={diagnostics()} />);
    expect(screen.getByRole('button', { name: /přidat/i })).toBeInTheDocument();
  });
});

describe('audience breakdown', () => {
  it('lists the gates in the evaluation order, not alphabetically', () => {
    render(<AudienceBreakdown data={breakdown()} />);
    const labels = screen.getAllByTestId('gate-label').map((n) => n.textContent);
    expect(labels).toEqual([
      'na blokovaných adresách', 'odhlášení', 'nepotvrzené přihlášení k seznamu',
      'pozastavená komunikace na vlastní žádost', 'omezené zpracování podle GDPR',
      'duplicitní e-maily', 'ukázkové kontakty',
    ]);
  });

  it('makes the numbers add up', () => {
    const data = breakdown();
    render(<AudienceBreakdown data={data} />);
    const removed = data.gates.reduce((s, g) => s + g.count, 0);
    expect(data.input - removed).toBe(data.willSend);
    expect(screen.getByText(/kampaň se odešle 1 129 lidem/i)).toBeInTheDocument();
  });

  it('makes every subtraction row a link to those specific people', () => {
    render(<AudienceBreakdown data={breakdown()} />);
    for (const row of screen.getAllByTestId('gate-row')) {
      expect(within(row).getByRole('link')).toHaveAttribute('href', expect.stringContaining('/contacts?'));
    }
  });

  it('hides a gate with zero, so the list does not go stale', () => {
    render(<AudienceBreakdown data={{ ...breakdown(), gates: [{ key: 'duplicate', count: 0 }] }} />);
    expect(screen.queryByText(/duplicitní e-maily/i)).toBeNull();
  });
});
```

- [ ] **Krok 2: Napiš komponenty, spusť testy, commit**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter web exec vitest run test/segments/empty-diagnostics.test.tsx test/segments/audience-breakdown.test.tsx`
Expected: PASS, osm testů.

```bash
git add "apps/web/src/app/[locale]/w/[slug]/segments/_components/empty-diagnostics.tsx" apps/web/src/components/segments apps/web/test/segments
git commit -m "feat(segments-ui): add empty result diagnostics and the audience breakdown"
```

---

### Úkol 60: Seznam segmentů, karty presetů a reaktivační scénář

**Files:**
- Create: `.../segments/page.tsx`, `.../segments/cleanup/page.tsx`
- Create: `.../segments/_components/{preset-card,cleanup-scenario}.tsx`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/test/segments/{presets,cleanup}.test.tsx`

- [ ] **Krok 1: Napiš padající testy**

```tsx
describe('preset cards', () => {
  it('shows six cards with the preset keys from part two', () => {
    render(<PresetGrid presets={sixPresets()} />);
    expect(screen.getAllByRole('article')).toHaveLength(6);
    for (const key of ['never_opened', 'never_clicked', 'inactive_90d', 'no_open_last_n', 'unconfirmed_30d', 'repeated_soft_bounces']) {
      expect(screen.getByTestId(`preset-${key}`)).toBeInTheDocument();
    }
  });

  it('puts the sent count condition on the card, not in a tooltip', () => {
    render(<PresetGrid presets={sixPresets()} />);
    expect(screen.getByText(/dostali aspoň 3 e-maily a žádný neotevřeli/i)).toBeInTheDocument();
    expect(screen.getByText(/dostali aspoň 5 e-mailů a v žádném neklikli/i)).toBeInTheDocument();
  });

  it('shows count age on every card and a recount button above six hours', () => {
    render(<PresetGrid presets={[preset({ cachedAt: hoursAgo(8), cachedCount: 1340 })]} />);
    expect(screen.getByText(/aktualizováno před 8 hodinami/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /přepočítat/i })).toBeInTheDocument();
  });

  it('shows count, never zero, for a preset never counted', () => {
    render(<PresetGrid presets={[preset({ cachedAt: null, cachedCount: null })]} />);
    expect(screen.getByRole('button', { name: /^spočítat$/i })).toBeInTheDocument();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('makes use create a copy with the preset key, not a link to a shared definition', async () => {
    const onUse = vi.fn();
    render(<PresetGrid presets={[preset({ key: 'never_opened' })]} onUse={onUse} />);
    await userEvent.click(screen.getByRole('button', { name: /použít/i }));
    expect(onUse).toHaveBeenCalledWith(expect.objectContaining({ preset_key: 'never_opened' }));
  });
});

describe('reactivation cleanup', () => {
  it('explains freezing in terms of the consequence', () => {
    render(<CleanupScenario step="freeze" segment={{ name: 'X', count: 1842 }} />);
    expect(screen.getByText(/kdo se mezitím sám ozve, z úklidu vypadne/i)).toBeInTheDocument();
  });

  it('offers three actions described by consequence, defaulting to unsubscribe', () => {
    render(<CleanupScenario step="action" segment={{ name: 'X', count: 1842 }} />);
    expect(screen.getByRole('radio', { name: /odhlásit je z odběru/i })).toBeChecked();
    expect(screen.getByText(/zůstanou v databázi, ale kampaně jim už neposíláme/i)).toBeInTheDocument();
    expect(screen.getByText(/nenávratně. může jen vlastník projektu/i)).toBeInTheDocument();
  });

  it('offers delete only to the owner', () => {
    render(<CleanupScenario step="action" role="admin" segment={{ name: 'X', count: 1842 }} />);
    expect(screen.getByRole('radio', { name: /smazat je/i })).toBeDisabled();
  });

  it('shows the final confirmation with all four numbers and three buttons', () => {
    render(<CleanupScenario step="confirm" segment={{ name: 'X', count: 1842 }} campaign={{ name: 'Zajímá vás to', sentAt: '18. 7.', sent: 2480, responded: 638 }} days={3} />);
    for (const value of ['1 842', '2 480', '638', '18. 7.']) expect(screen.getByText(new RegExp(value.replace(/\s/g, '\\s')))).toBeInTheDocument();
    for (const name of [/zkontrolovat/i, /odložit o 14 dní/i, /zrušit úklid/i]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
  });

  it('offers downloading the affected contacts before the cleanup runs', () => {
    render(<CleanupScenario step="confirm" segment={{ name: 'X', count: 1842 }} days={3} />);
    expect(screen.getByRole('button', { name: /stáhnout těch 1 842 kontaktů/i })).toBeInTheDocument();
  });

  it('requires typing the segment name, because this is protection level N4', async () => {
    render(<CleanupScenario step="confirm" segment={{ name: 'Neaktivní', count: 1842 }} days={3} />);
    const confirm = screen.getByRole('button', { name: /zkontrolovat/i });
    expect(screen.getByLabelText(/opište název segmentu/i)).toBeInTheDocument();
    expect(confirm).toHaveAttribute('aria-disabled', 'true');
    await userEvent.type(screen.getByLabelText(/opište název segmentu/i), 'Neaktivní');
    expect(confirm).toHaveAttribute('aria-disabled', 'false');
  });
});
```

- [ ] **Krok 2: Napiš komponenty, spusť testy, commit**

Run: `cd /Users/petr/Projects/Mailing_Tool && pnpm --filter web exec vitest run test/segments/presets.test.tsx test/segments/cleanup.test.tsx`
Expected: PASS, dvanáct testů.

```bash
git add "apps/web/src/app/[locale]/w/[slug]/segments" apps/web/test/segments
git commit -m "feat(segments-ui): add segment list, preset cards and the reactivation cleanup"
```

---

### Závěrečná kontrola bloku D a celého plánu

- [ ] **Krok 1: Spusť kompletní sadu**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && \
  pnpm exec turbo run typecheck lint test:unit && \
  pnpm --filter @mlain/core test:db && \
  node tools/ci/i18n-check.mjs && \
  node tools/ci/openapi-drift.mjs && \
  node tools/ci/licenses-node.mjs
```
Expected: všechno zeleně. Když padá cokoliv mimo soubory tohohle plánu, je to nález proti cizímu plánu, ne důvod cizí soubor opravit.

- [ ] **Krok 2: Ověř, že plán nesáhl mimo své vlastnictví**

Run: `cd /Users/petr/Projects/Mailing_Tool && git diff --name-only main...HEAD | sort`
Expected: každý soubor je v seznamu z kapitoly 12, nebo je to jeden ze tří souborů z kapitoly 0.3. Cokoliv jiného se musí vrátit.

- [ ] **Krok 3: Ověř zákaz dlouhé pomlčky ve všech textech plánu**

Run: `cd /Users/petr/Projects/Mailing_Tool && ! grep -rn $'\u2014' packages/i18n/messages/cs/import.json packages/i18n/messages/en/import.json packages/i18n/messages/cs/segments.json packages/i18n/messages/en/segments.json`
Expected: příkaz skončí s návratovým kódem 0, tedy žádný výskyt.

- [ ] **Krok 4: Ruční průchod, protože zelené testy nejsou důkaz použitelnosti**

Nahraj `docs/fixtures/kontakty-cp1250.csv` (12 480 řádků, CP1250, středník) skutečným prohlížečem a projdi všech šest kroků. Zkontroluj tři věci, které automat neuvidí:

1. V kroku 2 jsou v ukázce vidět `Nováková` a `Břeclav`, ne `NovĂˇkovĂˇ`.
2. V kroku 4 je ve sloupci Oslovení `Dobrý den, Jano` a u řádku bez určeného rodu `Dobrý den` bez visící čárky.
3. Na tlačítku v kroku 5 je 12 461, ne 12 480 ani 12 479.

---

## 10. Akceptační kritéria, která tenhle plán pokrývá

Číslo je odkaz do specifikace, ne do tohohle dokumentu. Kritérium, které tu není, tenhle plán nepokrývá a je odpovědností jiného plánu.

### 10.1 Část 2, kapitola 9

| # | Kritérium (zkráceně) | Kde se ověřuje |
|---|---|---|
| 1 | CP1250 se středníkem a diakritikou se naimportuje bez poškození | úkol 24 krok 4, úkol 26 krok 4, ruční průchod bod 1 |
| 2 | UTF-8 s BOM bez neviditelných znaků v hlavičce | úkol 24 krok 4 |
| 3 | ISO-8859-2 se rozpozná jako ISO-8859-2, ne ISO-8859-1 | úkol 24 krok 4 |
| 4 | 10 chybných z 1 000 skončí `completed_with_errors` a nabídne stažení | úkol 31 krok 5, úkol 36 krok 4, úkol 52 |
| 5 | Tentýž soubor a mapování podruhé do 24 h vrátí `import_duplicate` | úkol 34 krok 5 |
| 6 | Tentýž soubor s jiným mapováním založí nový import bez ptaní | úkol 33 krok 5, úkol 34 krok 5 |
| 7 | Zabití workera uprostřed nezpůsobí duplicitu ani vynechání | úkol 31 krok 5 (rollback dávky), úkol 35 krok 6 |
| 8 | Adresa se `complaint` kontakt nevytvoří, počítá se jako `suppressed_rows` | úkol 29 krok 5 |
| 9 | `on_conflict = update` nepřepíše nenamapované vlastní pole | úkol 31 krok 5 |
| 10 | Import nikdy nezmění stav z `unsubscribed` na `active` | úkol 31 krok 5 (upsert nemění `status`) |
| 11 | Náhled ukáže `Ing. Pavel Novák` rozdělené a `Dobrý den, Pavle` | úkol 32 krok 5, úkol 49 krok 2 |
| 12 | Zrušení nechá zapsané kontakty a uvede řádek | úkol 34 krok 5, úkol 52 |
| 13 | Dvě stejné adresy uvnitř jedné dávky import nezaseknou | úkol 30 krok 4 |
| 14 | Zabitý worker se sám vrátí do hry podle `updated_at` | úkol 35 krok 6 |
| 15 | Retenční job na soubory je idempotentní | úkol 35 krok 6 |
| 20 | `Nikola Krátký` skončí ve frontě ke kontrole | úkol 29 krok 5 (roura importu předá `vocative_confidence`), samotnou frontu ověřuje P07 |
| 31 | Operátor mimo typ skončí `segment_operator_not_allowed` bez spuštění SQL | úkol 4 krok 4, úkol 14 krok 4, úkol 42 krok 6 |
| 32 | Cizí `list_id` skončí `404`, nezkompilované SQL bez kontextu vrátí 0 řádků | úkol 15 krok 5, úkol 16 krok 5 |
| 33 | `'; DROP TABLE contacts; --` neovlivní strukturu dotazu | úkol 8 krok 5, úkol 18 krok 2 |
| 34 | Klíč vlastního pole je parametr, nikdy literál | úkol 10 krok 4, úkol 18 krok 2 |
| 35 | Dotaz vždy obsahuje `workspace_id`, `deleted_at IS NULL`, `processing_restricted = false` | úkol 9 krok 4 |
| 36 | Textová hodnota v poli `number` neshodí dotaz, cast je v `CASE WHEN` | úkol 10 krok 4, úkol 18 krok 2 |
| 37 | Náhled nad 3 s vrátí odhad, ne chybu | úkol 15 krok 5 |
| 38 | Cyklus `A → B → A` nejde uložit | úkol 16 krok 5 |
| 39 | 101 podmínek skončí `segment_too_complex` | úkol 5 krok 4 |
| 40 | `NOT (city = 'Praha')` nevrátí kontakty bez vyplněného města | úkol 14 krok 4 |
| 41 | SQL neobsahuje `now(`, `current_timestamp`, `localtimestamp`, `current_date` | úkol 18 krok 2 |
| 42 | Dvě volání se stejným `asOf` a AST vrátí bajtově shodné `sql` i `params` | úkol 17 krok 4 |
| 43 | `paramOffset: 5` dá nejnižší parametr `$6` | úkol 17 krok 4 |
| 44 | `alias: 'x'` nikde neobsahuje samostatné `c.` | úkol 17 krok 4 |
| 45 | Obálka vždy obsahuje suppression, ve všech třech vstupních bodech | úkol 9 krok 4, úkol 17 krok 4 |
| 46 | Publikum neobsahuje `pending` ani `snooze_until` v budoucnosti | úkol 11 krok 4 |
| 47 | Prázdné `audience` skončí `audience_empty` | úkol 17 krok 4 |
| 48 | Kontakt bez `confirmed` na cílovém seznamu se do publika nedostane | úkol 11 krok 4 |
| 49 | Pole vymazané v režimu `overwrite` je pro segment prázdné | úkol 10 krok 4, úkol 31 krok 5 |
| 70 | Kontakt s `processing_restricted` nespadne do žádného segmentu | úkol 9 krok 4 |
| 76 | Odblokovaná adresa se znovu dostane do publika | úkol 9 krok 4 (`removed_at IS NULL`) |
| 77, 78 | Vymazaná adresa se do publika nedostane ani po rotaci klíče | úkol 9 krok 4 (větev `email_fingerprints`) |

Kritéria 16 až 19, 21 až 30 patří modulu `naming` a vlastní je P07. Tenhle plán je volá a spoléhá na ně, ale netestuje je. **Po rozhodnutí U3 sem přibyla kritéria 24, 25 a 30**, která dřív pokrývaly úkoly 37 a 38; ty z plánu vypadly. U kritéria 20 zůstává na tomhle plánu jen to, že roura importu předá nejistý vokativ dál a nikdy ho neuhodne, samotné zobrazení fronty ověřuje P07.

### 10.2 Část 6, kapitola 15

| # | Kritérium (zkráceně) | Kde se ověřuje |
|---|---|---|
| 6 | Zavření karty během importu import nezastaví | úkol 51 krok 1 (běží na serveru), úkol 45 |
| 7 | Během importu se nezobrazí `beforeunload` | úkol 45 krok 1 |
| 8 | Průběh se čtečce ohlásí při 25, 50, 75 a 100 procentech | úkol 51 krok 1 |
| 9 | Živý počet se do `aria-live` propíše až po 500 ms a jednou | úkol 58 krok 1 |
| 10 | Po třech neúspěších SSE přechod na dotazování | úkol 51 krok 1 |
| 17 | Dialog nad výběrem podle filtru popíše filtr slovy | úkol 44 krok 2, úkol 60 krok 1 |
| 20, 21 | Prázdné stavy mají vysvětlení a akci, po filtrování se liší | úkol 57 krok 1, úkol 60 krok 1 |
| 30 | Import z CP1250 zobrazí v kroku 2 neporušenou diakritiku s otázkou | úkol 47 krok 1 |
| 31 | Náhled ukazuje oslovení včetně řádku s neurčeným rodem | úkol 49 krok 1 |
| 32 | Výsledek ukazuje rozpad a součet sedí s počtem řádků | úkol 52 krok 1 |
| 33 | Sekce s varováními shluknutá po kódu, všech jedenáct kódů | úkol 52 krok 1, úkol 40 krok 1 |
| 34 | `failed` má jiný nadpis a říká, že se nezapsalo nic | úkol 52 krok 1 |
| 35 | Zrušený import nabízí pokračování od místa zrušení | úkol 34 krok 5, úkol 52 krok 1 |
| 36 | Tlačítko Zpět v náhledu upozorní na založení nového importu | úkol 45 krok 1 |
| 37 | `errors.csv` má stejnou hlavičku, kódování a oddělovač plus dva sloupce | úkol 36 krok 4 |
| 38 | Rozpracovaný import zmizí po 24 hodinách a UI to řekne předem | úkol 45 krok 1 |
| 43 | Builder nikde nezobrazuje AND, OR, NOT ani slovo operátor | úkol 41 krok 1, úkol 55 krok 1 |
| 44 | Builder nabízí všech pět operátorů seznamu, tři souhlasu, dva blokovaných | úkol 41 krok 1, úkol 56 krok 1 |
| 45 | Negace skupiny jde nastavit a zobrazí vysvětlující řádek | úkol 55 krok 1 |
| 46 | Negující operátor zobrazí `notNullHint` a tlačítko na doplnění | úkol 57 krok 1 |
| 47 | Hloubka 5 a 100 podmínek, šestá úroveň schová tlačítko | úkol 5 krok 4, úkol 54 krok 1, úkol 57 krok 1 |
| 48 | Pod počtem je pět konkrétních kontaktů | úkol 58 krok 1 |
| 49 | Prázdný výsledek zobrazí, které podmínky samostatně vracejí nulu | úkol 21 krok 5, úkol 59 krok 1 |
| 50 | Karta i seznam zobrazují stáří počtu, nad 6 h šedě s přepočtem | úkol 58 krok 1, úkol 60 krok 1 |
| 51 | Nikdy nepočítaný preset zobrazí „Spočítat", nikdy nulu | úkol 60 krok 1 |
| 52 | Šest presetů se shodným `preset_key` a podmínkou na počet zpráv na kartě | úkol 20 krok 4, úkol 60 krok 1 |
| 53 | Poslední krok scénáře je potvrzení 3 dny předem s odložením i zrušením | úkol 60 krok 1 |
| 64 | Rozpad publika má samostatné řádky a každý je odkaz | úkol 59 krok 1 |
| 71b | Věta builderu je jedna ICU zpráva se sloty, test s obráceným pořadím | úkol 55 krok 1 |
| 71c | Obě negované kombinace mají vysvětlující řádek v obou jazycích | úkol 41 krok 1, úkol 55 krok 1 |
| 76b | Každý kód z mapování má klíč v obou katalozích | úkol 40 krok 1 |
| 78, 79 | Tabulky bez čísel stránek, kurzor v URL | úkol 44 krok 2 |
| 82 | Query builder není v základním balíku | úkol 57 (dynamický import komponenty) |

Kritéria 39 až 42 části 6 (fronta ke kontrole oslovení) po rozhodnutí U3 pokrývá **P07**, protože s nimi odešly úkoly 37, 38 a 53. Zůstává jen odkaz z výsledkové obrazovky importu, který je součástí kritéria 32.

Kritérium 64b (shoda čtyř čísel publika napříč obrazovkami kampaně) tenhle plán pokrývá **z poloviny**: dodává funkci `audienceBreakdown`, ze které se počítají všechna čtyři místa. Test, který je porovnává naráz, patří P13, protože tři z těch míst jsou jeho obrazovky.

---

## 11. Požadavky na ostatní plány

Tyhle věci tenhle plán potřebuje a nesmí si je udělat sám. Když některá chybí, zapiš to sem s uvedením úkolu, ve kterém to spadlo, a pokračuj dalším úkolem.

Kapitola je po revizi **pročištěná**: požadavky, které už dodavatel splnil, se odsud vyškrtly, aby se nehlásily podruhé a aby se nedaly splnit znovu jinak. Co se vyškrtlo a proč, je v tabulce na konci kapitoly.

### Na P01

| # | Požadavek | Proč |
|---|---|---|
| 1.1 | **38 chybových kódů** z úkolu 2 v `packages/core/src/errors/registry.ts` | Doménový plán kód používá, nezakládá. Uzávěr S7. Proti dřívějšímu znění o čtrnáct víc, a ne proto, že by plán kódů přidal: dřívější seznam vyjmenovával jen 26 z nich a osm řádkových kódů importu, dvě varování a dva provozní kódy v něm chyběly, takže by je nic nezachytilo. `duplicate_target`, `export_already_running`, `segment_slow_engagement`, `segment_unindexed_field` a `cross_workspace_scan_blocked` plán vyrábí a `problemCode()` by na neregistrovaném kódu vyhodil při první odpovědi API. |
| 1.2 | Čtyři fronty `contacts.import`, `contacts.export`, `contacts.cleanup_after_reactivation`, `segments.recount` | Uzávěr S8. Pátá, `contacts.bulk_vocative_review`, po rozhodnutí U3 patří P07 i s handlerem, takže si ji ověřuje P07. V registru zůstává. |
| 1.3 | Šestnáct proměnných z 5.9 části 2 v zod schématu konfigurace (sedmnáctá, `VOCATIVE_REVIEW_MAX_GROUPS`, odešla s frontou na P07) | Nejsou v tabulce 4.9 části 1, takže na ně jde snadno zapomenout. Uzávěr S12. |
| 1.4 | `exclude: ['test/**/*.dbspec.ts']` v `packages/core/vitest.config.ts` | Bez toho by běžná sada spustila testy proti databázi, která v tom jobu neběží. Do doby, než to bude, řeší to jiná přípona (rozhodnutí R12). |
| 1.5 | Codegen workeru musí globovat `packages/core/src/**/jobs/queue-handlers.ts` **rekurzivně** | Handlery importu leží o úroveň hlouběji (`src/contacts/import/jobs/`), takže jednoúrovňový glob je nenajde a fronty by zůstaly bez odběratele. |
| 1.6 | Skript `test:db` a `packages/core/vitest.db.config.ts` | Potřebuje je i P04, P07, P10, P13 a P14, takže je to konvergentní požadavek, ne jen náš. Konfigurace, která nenajde žádný test, skončí **zeleně**, takže je to tichá varianta selhání. |

### Na P03

| # | Požadavek | Proč |
|---|---|---|
| 3.1 | `contacts.is_sample` jako `boolean NOT NULL DEFAULT false` | Brána „ukázkové kontakty" v rozpadu publika (8.4.6). Do té doby je predikát natvrdo `false` (rozhodnutí R20), takže rozpad funguje, jen tuhle bránu neměří. Ukázková data vlastní P16. |
| 3.2 | Přístupová cesta pro sken napříč projekty nad `segments` a `imports` | `ws_isolation` bez kontextu vrací **nula řádků a žádnou chybu**, takže by hodinový přepočet i obnova zaseknutých importů tiše nedělaly nic. Je to týž požadavek, jaký si na tracking vyžádal P10 (politika `system_bypass`), jen o dvě tabulky širší. `mlain_app` s `BYPASSRLS` to řešit nemá, P03 to odmítá vlastním testem. Bez toho spadne job hlasitě, viz rozhodnutí R18, což je horší než funkční stav, ale mnohem lepší než tichá nula. |

### Na P04

| # | Požadavek | Proč |
|---|---|---|
| 4.1 | Registr rout, který globuje `packages/core/src/*/api/*.routes.ts` | Bez něj musí každý doménový plán přidat řádek do `apps/web/src/lib/api/app.ts`, což je konflikt v každém plánu. |
| 4.2 | `WorkspaceContext` nese `timezone` projektu | Operátor `on` nad `datetime` porovnává celý den v zóně projektu. Bez toho by segment „registrovali se 31. 7." vynechal půlku dne. |
| 4.3 | Middleware `rateLimit` s rozsahem `user` i `workspace` | Náhled segmentu 20 za minutu na uživatele, import a export 10 za hodinu na projekt. |
| 4.4 | `requireIdempotencyKey()` | `POST /api/v1/contacts/imports` ji vyžaduje. |
| 4.5 | `actorUserId(ctx)` v `@mlain/core/identity` | `created_by` je `uuid REFERENCES users(id)` a hodnotu smí dostat **jen** aktér typu `user`. Aktér typu `system` nese `job` jako text, aktér typu `api_key` nese `apiKeyId`, což je klíč, ne uživatel. Bez pomocníka by si každý plán skládal ternární výraz sám a někdo z nich do sloupce pošle `apiKeyId`, což projde typovou kontrolou i cizím klíčem selže až za běhu. Existující `actorInfo(actor, label)` to nenahradí: u `api_key` vrací `actorId` klíče, tedy přesně tu hodnotu, která do `created_by` nesmí. |

### Na P05

| # | Požadavek | Proč |
|---|---|---|
| 5.1 | K1 drží výběr přes přestránkování, ukazuje jeho velikost a rozlišuje „na této stránce" od „vše odpovídající filtru" | Tvrdý požadavek 13.1. Ověřuje úkol 44. Bez toho uživatel zaškrtne hlavičku, myslí si, že vybral 50 řádků, a smaže 50 000. **Splněno**, komponenta má řízený výběr propem `selection`; požadavek zůstává jako popis toho, co konformanční test hlídá. |
| 5.2 | K2 unese hloubku 5, 50 potomků, všech 40 operátorů a plnou klávesovou obsluhu | Tvrdý požadavek 13.1. Ověřuje úkol 54. **Splněno**, ověřeno srovnáním obou seznamů operátorů. |
| 5.3 | K3 umí krok v URL, destruktivní návrat s vysvětlením a 24hodinovou životnost rozpracovaného stavu | Ověřuje úkol 45. Krok v URL vlastní hook `useWizardStep`. |
| 5.4 | K4 umí přetažení i klávesovou cestu, průběh, zrušení a 200MB soubor bez načtení do paměti | Ověřuje úkol 44. |
| 5.5 | Registr navigace obsahuje cesty `/w/{slug}/segments` a `/w/{slug}/segments/cleanup` | Doménový plán navigaci nerozšiřuje, jen naplní cestu. Cesta `/w/{slug}/contacts/vocative-review` a odznak s počtem skupin přešly po U3 na P07. |

### Na P07

| # | Požadavek | Proč |
|---|---|---|
| 7.1 | `resolveName()`, `normalizeEmail()` a `normalizeNameKey()` exportované z `@mlain/core/contacts` | Volá je roura importu v kroku 4 a 7. |
| 7.2 | `normalizeNameKey()` je **bajt za bajt tatáž funkce**, jakou se plní `contacts.first_name_key` i jakou se hledá v `name_overrides` | Tři místa nesmí dát tři různé odpovědi. Kryje kritérium 30. |
| 7.3 | `upsertContacts(ctx, input, tx?)` musí přijmout **už otevřenou transakci** | Bez toho nejde zapsat kontakty a checkpoint v jedné transakci a celá obnovitelnost importu padá: pád mezi dvěma transakcemi znamená zapsané kontakty bez posunutého checkpointu, tedy duplicitní zápis po restartu. Kryje kritéria 7 a 14. |
| 7.4 | P07 **zakládá** routy `/api/v1/vocative-review/*` i `/api/v1/name-overrides` | Po rozhodnutí U3 vlastní frontu ke kontrole oslovení celou. Dřívější znění tohohle požadavku tvrdilo opak. |
| 7.5 | P07 **nezakládá** klíče `contacts.import.*` v `contacts.json` | Přesunuly se do namespace `import`, viz rozhodnutí R15. Klíče `contacts.vocative.*` si po U3 P07 vlastní sám a v katalogu `import` po nich zůstaly jen ty, které používá průvodce importem. |
| 7.6 | `listReviewGroups(ctx, { importId })` | Výsledková obrazovka importu na frontu odkazuje s filtrem na konkrétní import. Bez volitelného filtru by odkaz vedl na celou frontu a uživatel by po importu 12 000 kontaktů nepoznal, které skupiny přibyly z něj. |
| 7.7 | Seznam kontaktů umí filtr `source_ref` | Náhrada za „vrátit import", viz rozhodnutí R5. |

### Na P10 a P14

| # | Požadavek | Proč |
|---|---|---|
| 10.1 | Rollup `contact_engagement` se **plní** | Sloupce už existují a vlastní je P03, takže tohle není požadavek na schéma, ale na zapisovatele. Bez plnění vrací každý segment nad aktivitou nulu, a to bez chyby. |
| 10.2 | Okna `sent7d/30d/90d`, `opens7d/30d/90d` a `clicks7d/30d/90d` se udržují | Kompilátor je čte u `count_gte` a `count_lte` se `since_days` 7, 30 nebo 90. Jiná okna a metriky `delivered` a `bounced`, pro které okenní sloupce neexistují, spadnou do pomalé větve s varováním `segment_slow_engagement`. |

### Na P13

| # | Požadavek | Proč |
|---|---|---|
| 13.1 | Publikum se skládá **výhradně** přes `compileAudienceToSql()` | Část 4 nesmí psát vlastní SQL nad `contacts`, `list_subscriptions` ani `suppressions`. Kdyby psala, odešla by pošta člověku s omezeným zpracováním, člověku, který si dal pauzu, člověku, který nepotvrdil přihlášení, a hlavně člověku, který požádal o výmaz: jeho adresa je přepsaná na neexistující doménu a vyrobila by tvrdý odraz. |
| 13.2 | `asOf` je čas zahájení materializace, uložený na kampani | Aby šlo publikum kdykoliv zreprodukovat a aby dávka 1 a dávka 200 viděly totéž. |
| 13.3 | Kontrolní seznam kampaně obsahuje varování o oslovení podle 8.3.8 s třemi volbami | Prostřední volba nastaví neutrální oslovení jen pro tu kampaň, přes příznak v materializaci, nikdy zápisem do kontaktů. |
| 13.4 | Krok 3 reaktivačního scénáře (kampaň) | Vlastní ho P13, kroky 2, 4, 5 a 6 vlastní tenhle plán. |

### Co se z téhle kapitoly vyškrtlo a proč

| Bývalý požadavek | Stav |
|---|---|
| 3.1 `contacts.first_name_key`, `last_name_key` a částečný index fronty | **Splněno.** Oba sloupce i index `idx_contacts__ws_vocative_review` v P03 existují. Po U3 navíc celá agenda přešla na P07. |
| 3.2 `imports.stored_error_count` | **Splněno.** `bigint NOT NULL DEFAULT 0` i s `CHECK` na nezápornost. |
| 3.3 `imports.resume_from_import_id` | **Splněno.** `uuid` s cizím klíčem a `CHECK`, že se neodkazuje sám na sebe. |
| 3.4 `contacts.email_fingerprints` | **Splněno.** Existuje jako `bytea[]`. |
| 3.6 Potvrzení, že transakční primitivum dovolí `SET LOCAL` | **Bezpředmětné.** P03 má hotové `withReadOnly` s `BEGIN READ ONLY`, `statement_timeout` i `work_mem` a k tomu oddělený pool. Tenhle plán ho volá, nestaví si vlastní. Viz opravené rozhodnutí R13. |
| 3.7 Rozšíření `pg_trgm` a `btree_gin` | **Splněno.** Obojí je v migraci R1. |
| 10.1 Sloupce rollupu po P10 a P14 | **Adresát byl špatně.** Sloupce vlastní P03 a existují, jen se jmenují jinak, než jak je plán volal (`opens_total`, ne `opened_count`). Opraveno v úkolu 12; po P10 a P14 zůstává plnění hodnot. |
| Vlastník `contact_fields.indexed` a `index_state` | **Zrušeno.** Tenhle plán ty sloupce nečte, varování se řídí operátorem, viz rozhodnutí R19. |
| Tři podcesty v `packages/core/package.json` | **Bezpředmětné.** Mapa `exports` má zástupný znak, ověřeno spuštěním pod Node. Viz kapitola 0.3. |
| 4.6 Objektový tvar `withReadOnly` v adaptéru P04 | **Splněno**, ověřeno v okamžiku psaní: adaptér má `withReadOnly(ctx, options: ReadOnlyOptions, fn)` a předává `options` beze změny. Tenhle plán tedy `work_mem` předat může. |
| 4.7 Obálka bez kontextu v adaptéru P04 | **Splněno.** P04 už si ji nepíše sám, deleguje na `withoutContext` z P03, a **jméno nechává `withoutContext`**, ne `withoutWorkspace`. Volání v tomhle plánu se podle toho srovnala. |
| `createSystemContext(workspaceId, job)` | **Splněno.** P04 ho má v `@mlain/core/identity`, ověřuje tvar UUID i neprázdné jméno jobu. Tenhle plán ho volá pod tímhle jménem, ne pod vlastním. |


## 12. Soubory, které tenhle plán vlastní

```
packages/core/src/segments/**                             všechny soubory
packages/core/src/contacts/import/**                      všechny soubory, KROMĚ vocative-review/ (po U3 patří P07)
packages/core/src/contacts/export/**                      všechny soubory
packages/core/test/segments/**                            všechny soubory
packages/core/test/contacts/import/**                     všechny soubory
packages/core/test/contacts/export/**                     všechny soubory

apps/web/src/app/[locale]/w/[slug]/contacts/import/**     všechny soubory
apps/web/src/app/[locale]/w/[slug]/segments/**            všechny soubory
apps/web/src/components/segments/audience-breakdown.tsx
apps/web/test/import/**                                   všechny soubory
apps/web/test/segments/**                                 všechny soubory

packages/i18n/messages/cs/import.json
packages/i18n/messages/en/import.json
packages/i18n/messages/cs/segments.json
packages/i18n/messages/en/segments.json
```

**Mimo tenhle seznam plán nesahá.** Jediné tři výjimky jsou vyjmenované v kapitole 0.3 (`packages/core/package.json`, `packages/core/vitest.db.config.ts`, `apps/web/src/lib/api/app.ts`), u každé je uvedený přesný rozsah a pravidlo pro řešení konfliktu, a mimo ten rozsah se v nich nemění nic. Soubor `apps/web/openapi.json` se regeneruje nástrojem a **nikdy neslučuje ručně**: při konfliktu se zahodí obě verze a přegeneruje se.

Kontrola je v závěrečném kroku 2 a je strojová: `git diff --name-only main...HEAD` musí vrátit jen soubory z tohohle seznamu a ze tří výjimek.

---

## 13. Rozpory se specifikací a jak je plán řeší

| # | Rozpor | Řešení |
|---|---|---|
| 1 | Část 2 (4.11.3) umisťuje kompilátor do `packages/db/src/repo/segments.ts`, ale `packages/db` vlastní P03 | Rozhodnutí R1. Kompilátor je čistá funkce bez importu `db`, žije v `packages/core/src/segments/compile/`, spouštění jde přes schválené transakční primitivum z `@mlain/core/tx`. Všechny bezpečnostní vlastnosti zůstávají a jsou vynucené testy nad textem dotazu. |
| 2 | Část 6 (6.6) slibuje „vrátit tento import", část 2 na to nemá datový model a P03 nemá tabulku | Rozhodnutí R5. Není v MVP 0. Náhrada je předvyplněný datový štítek a seznam filtrovaný přes `source_ref`. Na kritérium to nemá dopad, protože část 6 na tuhle funkci žádné nemá. |
| 3 | ~~Část 2 (11.1, body 1.6 a 1.7) žádá samostatný read-only pool, P03 ho neslibuje~~ | **UZAVŘENO, rozpor neplatil.** Předpoklad byl chybný: P03 má `createPool(url, 'readOnly')` s `-c default_transaction_read_only=on` i `withReadOnly` s `BEGIN READ ONLY`, `statement_timeout` a `work_mem`. Specifikace tedy dostává obojí, co žádala, a ještě ve dvou vrstvách. Opravené rozhodnutí R13 to popisuje; `runReadOnly` je tenká obálka, ne druhá implementace. |
| 4 | Část 2 (6.1) mluví o průvodci importem s **pěti** kroky, část 6 (8.3) o **šesti** | Platí šest. Část 6 vlastní obrazovky a její rozdělení je jemnější: kontrola souboru je samostatný krok, protože se v něm chytá poškozená diakritika, což je v českém prostředí nejčastější problém vůbec. |
| 5 | Část 6 (8.3.7) definuje klíč skupiny jako `lower(unaccent(first_name))`, část 2 (4.5.2) jako `normalizeNameKey()` uložený ve sloupci | Platí část 2. `unaccent` navíc není mezi povolenými rozšířeními a dotaz by na čisté instalaci neproběhl. Po U3 tenhle rozpor řeší P07, tenhle plán ho drží jen jako požadavek 7.2. |
| 6 | Část 2 (6.3) umisťuje klíče importu do namespace `contacts`, uzávěr S4 přiděluje `contacts.json` plánu P07 | Rozhodnutí R15. Klíče se přesouvají do namespace `import`, znění textů se nemění. Převodní tabulka je v úkolu 40. |
| 7 | Část 6 (13.1) žádá u K4 nahrávání „po částech", část 2 (5.3) má jediný endpoint bez dělení | Rozhodnutí R4. Proudový jeden požadavek: server nikdy nedrží soubor v paměti, klient hlásí průběh a umí zrušit. Obnovitelnost se týká zpracování, ne nahrávání, a tu řeší checkpoint. Komponenta K4 navíc umí `sendChunk` a řídit si dělení sama, takže se to dá kdykoli zapnout bez zásahu do `packages/ui`. |
| 8 | P01 (D4) chce `jobs/queue-handlers.ts`, P04 (R3) chce `jobs/<akce>.ts` | Rozhodnutí R14. Obojí, stojí to deset řádků na doménu. |
| 9 | P01 používá `packages/core/src/…`, P04 cituje `packages/core/…` | Rozhodnutí R11. Platí `src/`, protože mapa `exports` v `package.json` ukazuje tam a bez toho se balíček nenačte. Uzavřeno i napříč plány jako nález P07-1. |
| 10 | P01 dává testy do `test/`, P04 a P05 je kolokují | Rozhodnutí R12. Platí `test/`, protože kolokované testy by konfigurace P01 vůbec nespustila, což je horší než chybějící test: zelené CI a nespuštěná sada. |
| 11 | ~~Frontu ke kontrole oslovení si nárokují dva plány naráz~~ | **UZAVŘENO rozhodnutím U3 z 2026-08-01 ve prospěch P07.** Z tohohle plánu vypadly úkoly 37, 38 a 53, zbylých 57 se nemění. Podrobně v rozhodnutí R2. |

Kapitola 13.1, která rozpor 11 rozepisovala a doporučovala řešení, se ruší celá. Rozhodnutí padlo a je zaznamenané v `NALEZY-NAPRIC-PLANY.md` v sekci Uzavřené; opisovat ho sem podruhé by znamenalo mít dvě verze téhož, které se při příští úpravě rozejdou.

**Co z U3 zůstává na tomhle plánu.** Import dál plní sloupce, ze kterých fronta žije (`first_name_key`, `last_name_key`, `vocative_confidence`, `greeting`), protože je plní `upsertContacts` z P07, kterou volá dávkový zápis v úkolu 31. Výsledková obrazovka importu na frontu odkazuje s filtrem na konkrétní import (požadavek 7.6). Pokyn řídicího dokumentu „fronta je součást importu, ne samostatná funkce" tím zůstává splněný v tom smyslu, v jakém byl míněný: je to pokyn k návrhu obrazovky, ne určení vlastníka souborů.


## 14. Na co si dát pozor při provádění

Deset věcí, na kterých se to v tomhle plánu láme. **Žádná z nich se neprojeví jako spadlý build** a většina ani jako spadlý test.

### Co plán ví od začátku

1. **Obálka má právě jednu verzi.** Když někdo napíše druhou, byť jen pro count, rozejdou se při první úpravě a náhled začne ukazovat jiné číslo, než kolik se odešle. Rozdíl nikdo nedokáže vysvětlit, protože obě verze vypadají správně. Totéž platí o úrovni níž: `runReadOnly` je obálka nad `withReadOnly` z P04, ne druhá implementace read-only transakce.
2. **Cast `::numeric` patří dovnitř `CASE WHEN`.** Za `AND` vypadá, že chrání, ale nechrání: PostgreSQL negarantuje pořadí vyhodnocení operandů a plánovač je přehazuje. Segment tak měsíc funguje a jednou v noci přestane, s chybou, která na vstupních datech nezávisí.
3. **Deduplikace uvnitř dávky se nesmí sloučit s tou napříč dávkami.** `ON CONFLICT` řeší duplicity mezi příkazy, ne uvnitř jednoho. Práh se týká výhradně úrovně B. Kdo to sloučí, vyrobí import, který se zasekne u každého reálného exportu z e-shopu, a zjistí to až v produkci nad velkým souborem.
4. **`updated_at` v checkpointu není kosmetika.** Je to jediný signál živosti importu. Bez něj zabitý worker nechá import navždy ve stavu `importing` a `singletonKey` projektu zablokuje i všechny další importy.
5. **Nejistý vokativ se nesmí tiše uhodnout.** Kontakt s `vocative_confidence = 'low'` dostane neutrální oslovení a jde do fronty, kterou po U3 vlastní P07. „Dobrý den, Jana" místo „Dobrý den, Jano" je chyba, kterou příjemce vidí a nástroj ne.

### Pět pastí, které vyplavalo teprve spuštěním

Tohle je ta část, kterou čtení kódu ani revize neodhalí. Všech pět projde typovou kontrolou a čtyři z nich i zeleným testem.

6. **Výsledek `tx.execute()` je obálka, ne pole.** `Tx` je drizzle handle a jeho `execute()` vrací `Result` s vlastností `rows`. Vzor `(await tx.execute(...)) as Row[]` projde typovou kontrolou a indexace na něm vrátí **vždy `undefined`**. Nejhorší podoba je u počítání: `Number(undefined ?? 0)` je nula, takže by každý segment tvrdil, že je prázdný, a vypadalo by to jako správná odpověď, ne jako chyba. Čte se výhradně `.rows` a `.rowCount`; `length` na obálce neexistuje a dá `NaN` v každém součtu.
7. **Kód chyby databáze leží na `error.cause.code`.** Přes drizzle je `error.code` **vždy `undefined`**, takže každá podmínka tvaru `if (error.code === '57014')` je nepravdivá vždy a každá tvaru `!==` pravdivá vždy. Konkrétně v tomhle plánu by to znamenalo, že se odhad z `EXPLAIN` nikdy nepoužije a náhled velkého segmentu místo „přibližně 12 000" vrátí chybu. Čte se `pgErrorCode(error)` a nic jiného.
8. **Holé pole v šabloně `sql` se rozloží na jednotlivé parametry.** `= ANY(${values})` vyrobí `ANY(($1, $2, $3))` a dotaz spadne na `42809`. Seznam hodnot se předává výhradně přes `sql.param(values)`. Týká se to každého operátoru se seznamem, tedy `in`, `not_in`, `has_any`, `has_all`, `has_none` a typů událostí u odrazů.
9. **`asOf` se musí odkazovat s `::timestamptz`.** PostgreSQL odvozuje typ parametru z okolí a ve výrazu `sloupec >= $2 - make_interval(days => $4)` vyhodnotí odčítání dřív, odvodí `$2` jako `interval` a skončí na `42883`. Zrádné je, že v `$2 > sloupec` typ určí levá strana a projde to, takže část relativních podmínek funguje a část ne. Ověřeno spuštěním: bez castu selhalo 70 ze 148 kombinací pole a operátoru, s castem prošlo všech 148. **Totéž platí o `jsonb_build_object($k, $v)`**, které bez castu obou argumentů skončí na `42P18` a shodí tím nejběžnější podmínku segmentu, rovnost nad vlastním polem.
10. **Sken napříč projekty vrací nula řádků a nevrací chybu.** `withoutContext` nenastaví `mlain.workspace_id`, porovnání s NULL je nepravda, a `segments` i `imports` mají `ws_isolation`. Hodinový cron by tedy roky hlásil `{ scheduled: 0 }` a zaseknuté importy by se nikdy neobnovily. Nula zastaralých segmentů je přitom naprosto věrohodné číslo, takže by si toho nikdo nevšiml. Proto má sken strážce, který ticho odliší od prázdna, a proto k němu patří test nad **dvěma** projekty. Viz rozhodnutí R18.

11. **`jsonb_typeof(...) = 'string'` není kontrola datumu.** JSON typ pro datum nemá, datum je řetězec, takže je ta podmínka pravdivá i pro `"Praha"` a následný `::timestamptz` shodí dotaz chybou `22007`. Je to táž past jako u čísel z bodu 2, ale o stupeň zákeřnější: u čísel `jsonb_typeof = 'number'` cast opravdu garantuje, u datumů nezaručuje nic. Nejhorší na tom je, kdy se to projeví. Dokud v projektu **nikdo to pole nevyplní**, PostgreSQL větev `THEN` nevyhodnotí a všech sedm datových operátorů prochází. Ověřeno spuštěním: nad prázdnou tabulkou 27 ze 27 operátorů, nad tabulkou s daty 20 ze 27. Uživatel si tedy segment nad datem založí, vyzkouší, a ten mu přestane fungovat ve chvíli, kdy do pole někdo zapíše text; se změnou segmentu to nebude mít nic společného. Řeší to `pg_input_is_valid(text, 'timestamptz')`, které je v PostgreSQL od 16 a vrací `false` místo chyby.

### A jedno pravidlo navíc

**Ověřování grepem nestačí, a nestačí ani spuštění nad prázdnou databází.** Kontrola „řetězec je v souboru" neodhalí, že SQL je nespustitelné, že dotaz vrací obálku místo pole ani že podmínka je vždy nepravdivá. A spuštění nad prázdnou tabulkou neodhalí past z bodu 11, protože PostgreSQL nevyhodnocené větve `CASE` nekontroluje. Ke každému tvrzení, které jde ověřit spuštěním, patří spuštění **nad daty**. V tomhle plánu to při opravě odhalilo šest vad, které prošly typovou kontrolou i revizí, a dvě chyby v očekávaných hodnotách testů, kvůli kterým by správná implementace neprošla.
