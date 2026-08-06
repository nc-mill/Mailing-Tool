# P08 Šablony: blokový model, renderer a kompilace do Liquidu

<!-- puvod-dokumentu -->
> **Historický záznam, ne platné zadání.** Implementační plán P08 (šablony, blokový model a renderer) z 31. 7. 2026, sepsaný před
> začátkem stavby. Zachycuje, co se tehdy plánovalo, ne dnešní podobu kódu.
> **Postaveno:** `packages/emails` a `packages/core/src/templates` existují, kampaň se odešle.
> **Zaškrtávátka nikdo neodškrtával**, prázdné políčko tady tedy neznamená nedodělek.
> **Dnešní stav:** `docs/superpowers/STAV-UKOLU.md` (živý dokument), design `docs/superpowers/DESIGN-INTEGRACE.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Postavit `packages/emails` (blokový JSON model, katalog bloků, emitter do HTML přes react-email, emitter prostého textu, univerzální základní šablonu) a `packages/core/templates` (validátor dokumentu, kompilace do Liquidu, `CompileMeta`, verzování, předodesílací kontrola) plus endpointy `/api/v1/templates/*`, tedy celou fázi 1 renderu bez jediného kusu editoru.

**Architecture:** Render je dvoufázový. Fáze 1 běží **jednou na kampaň** v TypeScriptu: `Document → normalizace → React strom z @react-email/components → @react-email/render → dosazení slotů → kontrola invariantů → { html, text, meta }`. Liquid výrazy zůstávají ve výstupu netknuté, protože prosté konstrukce React escapování přežijí. Fáze 2 běží **pro každého příjemce** v Go senderu (plán P09) a tenhle plán pro ni dodává jen zmrazený kontrakt: dvě značky nahrazované prostou záměnou řetězce a `renderSchema`. Textová varianta se emituje **z dokumentu**, ne z HTML, protože z HTML už není vidět, co byl nadpis. CSS inliner se nepoužívá, emitter zná strukturu a inline styly píše rovnou.

**Tech Stack:** TypeScript 7, Node 24, React 19, `@react-email/components` 1.0.12 (MIT), `@react-email/render` 2.1.0 (MIT), `ajv` 8.20.0 (MIT), `ajv-formats` 3.0.1 (MIT), `sanitize-html` 2.17.6 (MIT), `html-to-text` 10.0.0 (MIT), `linkedom` 0.18.13 (ISC), `culori` 4.0.2 (MIT), `nanoid` 6.0.0 (MIT), `vitest` (MIT), Hono (MIT) pro endpointy, Drizzle (MIT) pro čtení schématu z P03.

---

## 0. Než začneš

### 0.1 Co tenhle plán staví a co ne

| Staví | Nestaví |
|---|---|
| Blokové JSON schéma `Mlain Mailer Document v1` a jeho sémantický validátor | Editor šablon (P12) |
| Emitter dokumentu do HTML nad `@react-email/components` | AI asistenta a extrakci značky (P15) |
| Emitter prostého textu z dokumentu | Parser a validátor Liquid subsetu (P02, `packages/contracts/src/liquid`) |
| Kompilaci do Liquidu, značky pro tracking, `CompileMeta`, `renderSchema` | Interpolaci při odeslání (P09, Go) |
| **Data osmnácti fixtur `CT-001` až `CT-018`** (rozhodnutí R3) | Jejich schéma a runner (P02) |
| Univerzální základní šablonu a pět dodávaných šablon | Nahrávání a zpracování assetů (mimo rozsah, viz D1) |
| Verzování šablon, import, export, předodesílací kontrolu | Materializaci publika a `campaign_links` (P13) |
| Endpointy `/api/v1/templates/*` | Obrazovky, i18n namespace UI, design systém (P05, P12) |

### 0.2 Čtyři pasti, na které tenhle plán existuje

Tohle nejsou teoretické obavy, jsou to nálezy, které stály několik průchodů specifikací. Kdo je nezná, zopakuje je.

1. **V autorské šabloně nejsou povolené řetězcové literály.** Každý React renderer escapuje uvozovky v textových uzlech, takže `{{ x | default: "y" }}` se ve výstupu změní na `{{ x | default: &quot;y&quot; }}` a přestane být platným Liquidem. Náhradní hodnota filtru `default` a formát filtru `date` se proto berou z **atributů uzlu `var`** (`var.fallback`, `var.dateFormat`) a kompilace je doplní **až po renderu**, přes očíslované sloty `ML_ARG_nnnn` (část 1, 4.10.2; část 3, 3.3.5 a 3.3.5a).
2. **Operátory `>`, `<`, `>=`, `<=` v podmínkách jsou v MVP 0 zakázané.** Mají tentýž problém jako uvozovky, escapují se na `&gt;` a `&lt;`. **Rozhodl zadavatel 1. 8. 2026** (rozhodnutí R7 v `ROZHODNUTI-O-VLASTNICTVI.md`): nepovolují se, kdo potřebuje porovnávat, použije segment. Zařazeno do MVP 1. Validátor je odmítá jako **blokující chybu** kódem `liquid_comparison_operator_not_supported`, golden fixture to zmrazuje a kód je v povinném seznamu kontroly parity. **Není to nedodělek a nečeká se na nic.**
3. **Nález K4: literály `blank` a `empty` v `osteele/liquid` v1.8.1 neexistují.** Lexer je nezná, prolezou jako proměnná a vyhodnotí se na `nil`, takže `{% if x == blank %}` vybere v náhledu jinou větev než při odeslání. Dřív schválené náhradní řešení `!= ""` je od rozhodnutí o řetězcových literálech **zakázané**, protože je to řetězcový literál. Nález nezaniká, jen se nedá obejít takhle. Řešení podle 3.7.2a a 3.1.10 je jinde: podmínka je **vlastnost bloku** `visibleWhen`, pravdivost se počítá **mimo Liquid** do pomocné mapy `_present` a emitovaná konstrukce je `{% if _present.contact__city %}`, ve které není uvozovka, není `blank`, není `empty` a není operátor porovnání.
4. **Textová varianta se emituje z dokumentu, ne z HTML.** Funkce `toPlainText` z react-email převádí nadpisy na velká písmena. **Ověřeno spuštěním** na `@react-email/render` 2.1.0: merge tag uvnitř `<Heading>` se změní z `{{ contact.first_name }}` na `{{ CONTACT.FIRST_NAME }}`, kdežto tentýž tag uvnitř `<Text>` zůstane netknutý. Personalizace v textové části se tedy rozbije **jen u nadpisů**, což je nejhorší možná podoba: většina testů projde a chyba se ukáže až u zákazníka. Totéž dělá `render(tree, { plainText: true })`, takže ani ta cesta není náhrada. Kritérium 19b a 19c na to má povinný test.

### 0.3 Co plán vlastní

Úplný seznam je v kapitole 40 na konci dokumentu. Platí pravidlo řídicího dokumentu: **každý soubor v repozitáři má právě jeden plán, který ho smí vytvořit a měnit.** Tenhle plán mimo svůj seznam nesahá, ani „jen na jeden řádek".

Konkrétně **nevlastní**:

- `packages/db` a všechny migrace: vlastní **P03**. Tabulky `templates`, `template_versions`, `assets`, `asset_variants` a `asset_references` už existují, tenhle plán je jen čte a zapisuje do nich přes repository. Tabulku `content_snippets` **nečte ani nezapisuje**, sdílené bloky patří editoru (nález N44).
- `packages/contracts/src` včetně Liquid parseru, značek a schématu fixtur: vlastní **P02**. **Výjimka: data fixtur `CT-001` až `CT-018` v `packages/contracts/fixtures/compiled/` píše tenhle plán** (rozhodnutí R3), protože jako jediný má blokový model a renderer. Fixtures `LQ-*` vlastní P02 celé.
- `packages/core/errors/registry.ts`, registr front, konfigurační zod schéma, CI joby: vlastní **P01**.
- `apps/web/src/lib/api` (obálka chyb, stránkování, idempotence, autorizace) a kořenový Hono router: vlastní **P04**. Stejně tak `packages/core/tx` (transakční adaptér a `pgErrorCode`) a `packages/core/identity`.
- `packages/ui`, `packages/i18n` infrastruktura: vlastní **P05**.

### 0.4 Předpoklady, které musí být splněné před spuštěním plánu

Vlna 1 se otevírá až po smergování vlny 0. Tenhle plán očekává, že v `main` už je tohle. Když něco chybí, **není to úkol pro tenhle plán**, hlásí se to hlavnímu agentovi.

| # | Co | Kdo dodává | Proč to potřebuju |
|---|---|---|---|
| P-1 | ESLint pravidlo `import/no-restricted-paths` povoluje hrany `packages/emails → packages/contracts` a `packages/core → packages/emails` | P01 (`packages/config`) | `packages/emails` čte značky a Liquid validátor z kontraktů; `packages/core/templates` volá emitter. Graf závislostí v části 1, 3.11 hranu z `emails` vůbec neuvádí, je to mezera, ne zákaz. |
| P-2 | `packages/contracts` vystavuje **na podcestě `/liquid`** `validateLiquid(source, ctx)`, `LiquidContext` (s povinným `level: "authored" \| "compiled"`), `LiquidIssue`, `SourceSpan` a `LiquidRoots` | P02 | Validátor subsetu je vlastní kód v kontraktech (3.7.1). **Samostatná funkce `validateCompiledLiquid` neexistuje a nebude**: druhá úroveň gramatiky z části 1, 4.10.2 se dělá týmž `validateLiquid` s `level: "compiled"`, a přesně to volá invariant I1. Typy `Issue`, `FieldCatalog`, `toCatalogPath` a `toMergePath` v kontraktech **nejsou**: `Issue` si vlastní tenhle plán (Task 9), katalog polí vlastní P07 (rozhodnutí R2). |
| P-3 | `packages/contracts/markers` vystavuje `CLICK_MARKER_PREFIX`, `OPEN_PIXEL_MARKER`, `RESERVED_MARKERS`, `LINK_ID_NAMESPACE`, `ZERO_UUID`, `LINK_ID_LENGTH` a funkce `deriveLinkId`, `replaceClickMarkers`, `replaceOpenPixel`, `countClickMarkers`, `openPixelHtml` | P02 | Značky jsou pátý kontrakt. Kdyby si je každá strana psala vlastní, tracking nefunguje vůbec. `RESERVED_MARKERS` obsahuje i `ML_RAW_` a porovnává se **bez ohledu na velikost písmen**, protože tenhle plán generuje nonce malými písmeny. |
| P-4 | `packages/contracts/compiled` vystavuje **schéma a runner** fixtur `CT-*`, tedy `assertCompiledFixture`, a adresář `packages/contracts/fixtures/compiled/` existuje | P02 | **Data osmnácti fixtur `CT-001` až `CT-018` píše tenhle plán** (rozhodnutí R3), protože jako jediný má blokový model a renderer. P02 dodává tvar a spouštěč, ne obsah. |
| P-5 | Kořenový router `/api/v1` importuje doménové routery z `apps/web/src/server/routes/<domena>.router.ts` podle předdeklarovaného seznamu všech domén. `apps/web/src/lib/api` vystavuje `problem()`, `sendJson()`, `requireScope()` a typ `AppEnv` s `db`, `workspaceId`, `userId`, `language`, `appUrl`, `assetBaseUrl` a `previewEngine` | P04 | Jinak by každý doménový plán musel editovat sdílený soubor, což je porušení uzávěru o sdílených místech, a každý by si psal vlastní obálku chyb. |
| P-8 | `packages/contracts/liquid/engine` vystavuje **dvě** instance LiquidJS podle 3.11.1: `createHtmlEngine()` a `createTextEngine()` | P02 | Náhled a odeslání se nesmí rozejít kvůli jinému nastavení knihovny. Jedna instance to být nemůže: HTML varianta escapuje, textová ne, a sloučením by se do textu dostaly entity. Instance vlastní kontrakt, ne tenhle plán. |
| P-9 | `packages/contracts/liquid/prepare-render-data` vystavuje `prepareRenderData(raw, schema)`, která plní kořen `_present` | P02 | Jediná sdílená příprava dat pro náhled i odeslání, viz kapitola 0.6. Její úzký typ `RenderSchema` je **něco jiného** než `RenderSchema` z kontraktu 5 tohohle plánu; převod dělá `toPreparedSchema` z `packages/emails/src/paths.ts`. |
| P-6 | `@mlain/core/contacts/fields/catalog` exportuje `getFieldCatalog(ctx: WorkspaceContext): Promise<FieldCatalog>` plus typy `FieldCatalog`, `FieldCatalogEntry`, `FieldCatalogType` a `LocalizedText` | P07 | Validace merge tagů (požadavek R9). Katalog vlastní P07, protože jako jediný vlastní model kontaktu (rozhodnutí R2). Bere **`WorkspaceContext`**, ne `{ db, workspaceId }`. |
| P-10 | `@mlain/core/tx` vystavuje `withWorkspace(ctx, fn)`, `withReadOnly(ctx, ms, fn)`, `withoutWorkspace(fn)`, typ `Tx` (Drizzle handle vázaný na transakčního klienta s nastaveným RLS kontextem) a `pgErrorCode(error)` | P04 | Bez toho se nedá napsat ani jeden dotaz fáze G, viz kapitola 0.7. |
| P-7 | Chybové kódy z 3.1.8, 3.7.4, 3.11.4, 4.1.8 a 4.2 jsou v registru P01 | P01 | Doménový plán kód používá, nezakládá. |

Pokud P-1 chybí, **neopravuj `packages/config` sám.** Napiš to hlavnímu agentovi a pokračuj dalším úkolem; testy uvnitř `packages/emails` na ESLintu nezávisí.

### 0.5 Vlastní rozhodnutí tohohle plánu

Specifikace na těchhle šesti místech mlčí nebo si odporuje. Rozhodnutí jsou tady zapsaná nahlas, aby je nikdo nemusel dohadovat z kódu.

| # | Otázka | Rozhodnutí | Proč |
|---|---|---|---|
| D1 | `CompileContext` v 4.1.1 nemá pole na data assetů, přestože 3.4.1 říká „data assetů si vyzvedne volající a předá je v `CompileContext`" a kritérium 62 vyžaduje volbu varianty podle šířky bloku | Doplňuju `assets: Record<string, AssetRef>` do `CompileContext` | Bez toho nejde emitovat `width` a `height` na `<img>`, které Outlook vyžaduje, a renderer by musel dělat IO, což mu 3.4.1 zakazuje. Je to aditivní doplnění typu, stejného druhu jako doplnění `campaignId` z 2026-07-31. |
| D2 | `campaign.preheader` a `current_year` se podle 3.8.1 „vyhodnotí při kompilaci", ale `CompileContext` pro ně nemá vstup | Doplňuju `preheader?: string` a `currentYear: number` | `currentYear` jako vstup, ne `new Date()` uvnitř, protože renderer musí být deterministický (vlastnost 1 v 4.1.6) a snapshot testy by jinak přetekly 1. ledna. |
| D3 | React neumí z JSX vypustit HTML komentář ani syrový markup a obálka kolem `<!--[if mso]><table>` rozbije strukturu tabulky | Zavádím **raw sloty**: emitter vypustí do stromu textový žeton `ML_RAW_<nonce>_nnnn` a kompilace ho po renderu nahradí syrovým řetězcem | Je to tentýž mechanismus, jaký si už vynutily argumenty filtrů (3.3.5a), takže nepřibývá nová třída chyby. `<nonce>` je 10 náhodných znaků na jeden render, takže uživatelský text nemůže cizí slot odklonit ani při chybě validátoru. Na determinismus výstupu to nemá vliv, protože žeton se do výstupu nikdy nedostane a hlídá to invariant. |
| D4 | `@react-email/render` emituje doctype `XHTML 1.0 Transitional`, kontrakt v 4.1.6 slibuje senderu `<!DOCTYPE html>` | Kompilace doctype po renderu nahradí za `<!DOCTYPE html>` | Kontrakt je zmrazený a slibuje kompletní dokument v tomhle tvaru. Náhrada je jeden deterministický `replace` a ušetří **106 bajtů** proti limitu 102 kB (ověřeno spuštěním `@react-email/render` 2.1.0: XHTML doctype má 121 bajtů, `<!DOCTYPE html>` 15). |
| D5 | React DOM server vkládá mezi dva sousední textové uzly oddělovač `<!-- -->` | Kompilace ho po renderu odstraní přesnou záměnou řetězce `<!-- -->` | Náš vlastní podmíněný komentář nikdy nemá tvar `<!-- -->` (vždy je v něm `[if`), takže záměna je bezpečná. Bez ní by ve výstupu byly komentáře uprostřed textu a golden snapshoty by byly nečitelné. |
| D6 | Kdo počítá UUIDv5 pro `link_id` | **Nikdo tady.** Volám `deriveLinkId(campaignId, position)` z `@mlain/contracts/markers` | Dřívější znění si UUIDv5 implementovalo samo na 25 řádků. Jenže kontrakt tu funkci **už má** a Go sender ji musí počítat shodně, takže vlastní kopie by znamenala dvě implementace jednoho kontraktu, obě zelené, a rozejít by se mohly beze stopy. Je to tatáž vada, kterou pro Go stranu řeší rozhodnutí R1. Zamykám to testem s **nezávisle spočítanými vektory** (Task 25), aby změna na straně kontraktu spadla tady, ne až v reportu kliků. |
| D7 | Doslovné čtení 3.4.3 („mimo Outlook jedna tabulka se dvěma `<td class="ml-col">`, uvnitř `<!--[if mso]>` tabulka s pevnými šířkami") by znamenalo vypsat obsah sloupců dvakrát | Emituju průmyslový vzor ghost tables: obsah **jednou**, Outlook dostane rám tabulky v podmíněných komentářích, ostatní vidí `<div class="ml-col">` s `display:inline-block` | Dvojí výpis obsahu by zdvojnásobil velikost HTML proti limitu 102 kB a hlavně **zdvojnásobil počet značek odkazů**, takže by `clickMarkerCount` nesouhlasil a invariant I3 by shodil každou kompilaci sloupce s odkazem. Výsledný vzhled je stejný, cena je nižší. |
| D8 | Odkaz s proměnnou v `href`: 3.1.5 z něj dělá chybu vždy, kapitola 3.4.2 části 5 ho pouští s varováním | Chyba `liquid_in_trackable_href` jen když je odkaz **trackovatelný**; při `trackable: false` projde s varováním `link_variable_not_tracked` | Je to přesně to, co kóduje název chybového kódu. Fixture `CT-012` zůstává v platnosti, protože testuje výchozí stav `trackable: true`. Uživatel, který tracking vědomě vypne, nemá důvod dostat blokující chybu. |

### 0.6 Mapa přítomnosti `_present`: normativní znění

Tahle kapitola existuje proto, že se `_present` plete s **jiným, podobně vypadajícím**
mechanismem senderu. Nejsou to varianty téhož, jsou to dvě různé věci na dva různé problémy
a **ani jedna nenahrazuje druhou**:

| | `_present` | `_blank` |
|---|---|---|
| Čí je | kontrakt, vyrábí ho **TypeScript** funkcí `prepareRenderData` | **vnitřní věc senderu** (P09), tenhle plán ho nikdy neemituje ani nečte |
| Na co je | podmíněné zobrazení bloku `visibleWhen` | literály `blank` a `empty` gramatika povoluje, ale Go lexer je nezná, takže by porovnání vyšlo opačně než v prohlížeči |
| Kudy putuje | uvnitř `render_data` k senderu, sender ho **jen čte** | nikdy neopustí sender |

Emitovat `{% if _present.contact__city %}` je tedy **správně** a nesjednocuje se to s ničím.

Platí tohle a nic jiného. Vlastníkem kontraktu je **P02**, ostatní strany se řídí jím.

| Co | Závazná hodnota |
|---|---|
| Jméno kořene | **`_present`**. Kořen `_blank` neexistuje a nikdy neexistoval. |
| Kde je kořen deklarovaný | `COMPILED_ONLY_ROOTS = ['_present']` v `packages/contracts` (P02) |
| Kdo mapu plní | **`prepareRenderData(raw, renderSchema)` z `packages/contracts`** (P02), tedy jedna funkce sdílená náhledem i odesláním. Nepočítá ji ani renderer, ani sender. |
| Z čeho se plní | z `renderSchema.presence`, které vydává `buildRenderSchema` (Task 26) |
| Převod cesty na klíč | tečky na **dvě podtržítka**: `contact.city` → `contact__city`, `contact.attr.city` → `contact__attr__city`. P02 to dělá `path.replace(/\./g, '__')`, tenhle plán `field.split(".").join("__")`. **Ověřeno spuštěním, obojí dává bajtově shodný výsledek na všech tvarech cest.** |
| Sémantika | `_present.<klíč> === true` znamená, že **hodnota je vyplněná**. Prázdný řetězec, řetězec ze samých bílých znaků, `null`, `undefined`, `false` a prázdné pole jsou `false`. |
| Emitovaná konstrukce pro `op: "present"` | `{% if _present.<klíč> %}` … `{% endif %}` |
| Emitovaná konstrukce pro `op: "blank"` | `{% unless _present.<klíč> %}` … `{% endunless %}` |

**Pozor na směr.** Jméno `_present` je kladné, operátor `blank` je záporný. Nikdo nesmí u převodu
otočit význam podmínky: `blank` se **nikdy** neemituje jako `{% if %}` nad opačně pojmenovanou
mapou, vždy jako `{% unless %}` nad `_present`.

**Nejnebezpečnější místo celého mechanismu je, že mapu nikdo nezavolá.** Kontrakt
`prepareRenderData` jen definuje, volá ji až aplikace při materializaci publika, tedy **P13**.
Kdyby ji P13 vynechal, `_present` v datech vůbec nebude, každá podmínka se vyhodnotí jako
nepravda a **podmíněné bloky se v odeslaném mailu tiše skryjí**. Nespadne přitom nic: kompilace
projde, odeslání projde, testy obou stran projdou. Je to zapsané jako požadavek **R11** v kapitole 39.

Golden fixture `16-presence-chain.json` a test „presence map survives the whole chain" (Task 32)
pokrývají **celý řetěz**: blok s podmínkou, kompilace, `prepareRenderData` a interpolovaný výstup
pro obě větve. Neověřují shodu dvou jmen, ověřují, že podmíněný blok **opravdu dojde** od modelu
až po hotový výstup a že vyplněná hodnota ho ukáže a prázdná skryje.

Test se **neptá téhož zdroje, ze kterého ochrana vznikla**: jméno kořene nečte z konstanty
tohohle balíčku, ale bere ho z `COMPILED_ONLY_ROOTS` v kontraktech, mapu plní kontraktní
`prepareRenderData` a interpoluje instancemi `createHtmlEngine()` a `createTextEngine()`
z kontraktů, tedy týmiž, jaké používá náhled i sender. Kdyby si tenhle balíček jméno kořene
změnil, test spadne, i kdyby byl uvnitř sám se sebou dokonale konzistentní.

### 0.7 Jak se v tomhle plánu sahá na databázi

Tohle je jediný povolený tvar. Dřívější znění fáze G psalo dotazy nad Drizzle instancí
postavenou nad **poolem** a předávalo ji jako `db: Database`. To by neprošlo ze tří důvodů
naráz, a dva z nich by se projevily až za běhu:

1. **`import { schema } from "@mlain/db"` neexistuje.** Kořenový index `packages/db`
   pojmenovaný export `schema` nemá, balíček ho vystavuje podcestou. Typecheck by spadl
   na první řádce každého ze tří souborů.
2. **Drizzle nad poolem nemá RLS kontext.** Obálky P03 nastavují `mlain.workspace_id`
   přes `set_config` uvnitř transakce, na konkrétním spojení. Dotaz poslaný na náhodné
   spojení z poolu ten GUC nemá, `current_setting('mlain.workspace_id', true)` vrátí NULL,
   porovnání v politice `ws_isolation` vyjde NULL, tedy nepravda. **`SELECT` by vracel nula
   řádků a `INSERT` by spadl na `WITH CHECK`** včetně testu, který má izolaci dokazovat.
3. **`tx.transaction()` nad transakčním klientem tiše potvrdí vnější transakci.**
   Drizzle nad `PoolClient` vydá druhý `begin` na tomtéž spojení. **Ověřeno spuštěním
   proti PostgreSQL 18.4 s drizzle-orm 0.44.7:** nevyhodí to výjimku, nevypíše to chybu,
   vnitřní `COMMIT` ale potvrdí **vnější** transakci a **řádek přežije i následný
   `ROLLBACK`**. Je to nejhorší možná podoba vady: zápis, který se měl zahodit, zůstane
   v databázi a nic o tom neřekne. Proto se `tx.transaction()` v tomhle plánu nevolá
   nikde a zámek řádku se bere přímo na předaném `tx`.

Platí proto tohle:

```ts
import * as schema from "@mlain/db/schema";       // schéma podcestou, nikdy z kořene
import type { Tx } from "@mlain/core/tx";          // Drizzle vázaný na transakčního klienta
```

- **Transakci otevírá volající**, tedy služba nebo router, jediným způsobem:
  `withWorkspace(ctx, async (tx) => { ... })` z `@mlain/core/tx`. Obálka nastaví
  `mlain.workspace_id` a u aktéra typu `user` i `mlain.user_id`, takže **`set_config`
  se v tomhle plánu nepíše nikde**.
- **Repository a doménové funkce transakci neotvírají.** Berou hotové `tx: Tx` prvním
  argumentem. Uvnitř se `tx.transaction()` **nevolá nikdy**, viz důvod 3.
- `workspaceId: string` se dál předává jako druhý argument, protože sloupec je potřeba
  do `WHERE` i do `values()`. Není to obcházení izolace, je to druhá vrstva nad RLS:
  pravidlo „žádná funkce nebere `workspaceId` jako string" platí na **hranici transakce**,
  a tam ho drží branded `WorkspaceContext`. Stejný tvar používá `withIdempotency` z P04.
- **Kód chyby z databáze se čte funkcí `pgErrorCode(error)` z `@mlain/core/tx`**, nikdy
  jako `error.code`. Drizzle balí chyby ovladače do `DrizzleQueryError`, takže `error.code`
  je `undefined` a skutečný SQLSTATE leží na `error.cause.code`. Ošetření kolize napsané
  podle `error.code` by se **nikdy neprovedlo** a uživatel by místo 409 dostal 500.
- **Vzor `as unknown as Row[]` se nepoužívá.** Ovladač vrací obálku výsledku, ne pole,
  takže takové přetypování projde typovou kontrolou i revizí a za běhu dá `undefined`.
  V tomhle plánu se čte přes Drizzle, který pole vrací sám.

---

## 1. Struktura souborů

Než začneš psát úkoly, tady je mapa. Každý soubor má jednu odpovědnost a vejde se do hlavy naráz.

### 1.1 `packages/emails` (čistá logika, žádné IO, žádná databáze)

```
packages/emails/
├── package.json                       exports mapa podcest, závislosti
├── tsconfig.json
├── vitest.config.ts
├── schema/
│   └── document.v1.schema.json        JSON Schema 2020-12, zdroj pravdy pro API i AI
├── src/
│   ├── document/
│   │   ├── types.ts                   Document, Theme, RichText, všechny bloky
│   │   ├── defaults.ts                výchozí hodnoty motivu a props bloků, font stacky
│   │   ├── ids.ts                     newBlockId(), isBlockId()
│   │   ├── canonical.ts               canonicalJson(), designHash()
│   │   ├── schema.ts                  ajv, validateDocumentSchema()
│   │   ├── walk.ts                    walkBlocks(), walkRichText(), pointerOf()
│   │   ├── migrate.ts                 MIGRATIONS, loadDocument()
│   │   ├── semantic-structure.ts      pravidla S1, S2, S3, S5, S10, S14, S15, S16
│   │   ├── semantic-fields.ts         pravidla S4, S6, S7, S8, S9, S11, S12, S13
│   │   └── semantic.ts                checkSemantics(), spojení obou vrstev
│   ├── theme/
│   │   ├── palette.ts                 DEFAULT_LIGHT, DEFAULT_DARK, contrastRatio()
│   │   └── resolve.ts                 resolveTheme(), resolveColor()
│   ├── normalize/
│   │   ├── columns.ts                 šířky sloupců z layoutu a gap
│   │   ├── slots.ts                   assignFilterSlots(), RawSlotSink
│   │   └── index.ts                   normalizeDocument()
│   ├── emitter/
│   │   ├── ctx.tsx                    EmitterContext (React context s motivem a sloty)
│   │   ├── style.ts                   px(), paddingStyle(), fontStack()
│   │   ├── head-css.ts                buildResetCss(), buildMediaCss(), buildDarkCss()
│   │   ├── assets.ts                  assetUrl(), pickVariant()
│   │   ├── inline-html.ts             sanitizace obsahu bloku html
│   │   ├── shell.tsx                  EmailShell
│   │   ├── raw.tsx                    <Raw html="..."/>
│   │   ├── visibility.tsx             <Visible when={...}>
│   │   ├── rich-text.tsx              <RichTextView>
│   │   ├── blocks/
│   │   │   ├── frame.tsx              společný rám bloku (padding, pozadí, podmínka)
│   │   │   ├── dispatch.tsx           rozcestník typu bloku na komponentu
│   │   │   ├── section.tsx
│   │   │   ├── columns.tsx
│   │   │   ├── heading.tsx
│   │   │   ├── text.tsx
│   │   │   ├── image.tsx
│   │   │   ├── button.tsx
│   │   │   ├── divider.tsx
│   │   │   ├── spacer.tsx
│   │   │   ├── html-block.tsx
│   │   │   ├── social.tsx
│   │   │   └── footer.tsx
│   │   └── render.ts                  renderDocumentHtml()
│   ├── text/
│   │   ├── wrap.ts                    wrapPlain()
│   │   └── emit.ts                    renderDocumentText()
│   ├── compile/
│   │   ├── links.ts                   collectLinks(), linkIdFor()
│   │   ├── apply-slots.ts             applyFilterSlots(), applyRawSlots()
│   │   ├── render-schema.ts           buildRenderSchema()
│   │   ├── invariants.ts              checkInvariants()
│   │   └── compile.ts                 compileDocument()
│   ├── base/
│   │   ├── brand.ts                   brandToTheme()
│   │   ├── rich.ts                    plainToRichText()
│   │   ├── build.ts                   buildBaseTemplate()
│   │   ├── starters.ts                STARTER_KEYS, buildStarterTemplates()
│   │   └── i18n/{cs.json,en.json}     texty patičky a oddělovačů
│   ├── preview-data.ts                SAMPLE_RENDER_DATA
│   └── compat/
│       ├── caniemail.json             vendorovaná datová sada, MIT
│       └── check.ts                   checkCompatibility()
├── assets/social/<network>-<style>@2x.png
└── test/
    ├── document/…                     zrcadlo src
    ├── emitter/…
    ├── compile/…
    ├── golden/render.golden.test.ts   16 dokumentů, bajtový snapshot
    ├── golden/ct-cases.ts             vstupy a tvrzení osmnácti fixtur CT-*
    ├── golden/contract.ct.test.ts     běh fixtur CT-001 až CT-018
    └── __fixtures__/
        ├── documents/*.json
        └── expected/*.html, *.txt
```

### 1.2 `packages/core/templates` (doménová logika s IO, bez HTTP)

```
packages/core/templates/
├── index.ts             jediný vstupní bod domény, @mlain/core/templates
├── repository.ts        Drizzle dotazy nad templates a template_versions
├── assets.ts            loadAssetRefs(): načte AssetRef mapu pro CompileContext
├── validate.ts          validateTemplateDocument(): schéma + sémantika + Liquid + pole
├── compile.ts           compileTemplate(): obalí compileDocument kontextem
├── service.ts           create, update, delete, duplicate, autosave
├── versions.ts          createVersion, restoreVersion, retenční pravidla
├── field-usage.ts       findTemplatesUsingField()
├── precheck.ts          preSendCheck()
├── transfer.ts          exportTemplate(), importTemplate()
└── jobs/revalidate.ts   handler fronty content.revalidate_templates
```

### 1.3 `apps/web` (jen HTTP vrstva)

```
apps/web/src/server/routes/templates.router.ts   Hono router, mount /api/v1/templates
```

---

## 2. Konvence pro všechny úkoly

- **TDD bez výjimky.** Nejdřív test, spusť ho, ověř že spadne z očekávaného důvodu, pak minimální implementace, pak zelený běh, pak commit.
- **Commit po každém úkolu.** Zpráva `feat(emails): ...` nebo `feat(templates): ...`, commit messages anglicky.
- **Spouštění testů:** `pnpm vitest run <cesta>` z kořene repa. Typecheck `pnpm turbo run typecheck --filter=@mlain/emails`.
- **Žádný soubor mimo seznam v kapitole 40.**
- **Kód, identifikátory a názvy souborů anglicky**, komentáře v kódu česky jen tam, kde vysvětlují nesamozřejmé rozhodnutí.
- **Vnitřní importy se píšou s příponou `.js`**, i když soubor je `.ts` nebo `.tsx` (`import { useEmitter } from "./ctx.js"`). Je to konvence ESM v TypeScriptu: `tsc` příponu nepřepisuje a Vite i Vitest ji při resolvování mapují zpět na `.ts` a `.tsx`. Kdyby v `@mlain/config` byl `moduleResolution: "bundler"`, fungovalo by i psaní bez přípony, ale míchat obojí v jednom balíčku se nesmí.
- **Nikdy `git stash`, nikdy přepnutí větve.** Git obsluhuje hlavní agent.

---

## Fáze A: základ balíčku a datový model

### Task 1: Kostra `packages/emails` a identita bloku

**Files:**
- Create: `packages/emails/package.json`
- Create: `packages/emails/tsconfig.json`
- Create: `packages/emails/vitest.config.ts`
- Create: `packages/emails/src/document/ids.ts`
- Test: `packages/emails/test/document/ids.test.ts`

- [ ] **Step 1: Napiš padající test**

`packages/emails/test/document/ids.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { BLOCK_ID_PATTERN, isBlockId, newBlockId } from "../../src/document/ids.js";

describe("block id", () => {
  it("generates ids matching the normative pattern", () => {
    for (let i = 0; i < 200; i += 1) {
      const id = newBlockId();
      expect(id).toMatch(BLOCK_ID_PATTERN);
      expect(isBlockId(id)).toBe(true);
    }
  });

  it("generates distinct ids", () => {
    const ids = new Set(Array.from({ length: 1000 }, () => newBlockId()));
    expect(ids.size).toBe(1000);
  });

  it("rejects ids that are not b_ plus 12 lowercase alphanumerics", () => {
    expect(isBlockId("b_ABCDEFGHIJKL")).toBe(false);
    expect(isBlockId("b_abcdefghijk")).toBe(false);
    expect(isBlockId("c_abcdefghijkl")).toBe(false);
    expect(isBlockId("b_abcdefghijklm")).toBe(false);
    expect(isBlockId("")).toBe(false);
  });
});
```

- [ ] **Step 2: Vytvoř `packages/emails/package.json`**

Verze pocházejí z tabulky závislostí části 3, kapitola 9.1, ověřené 2026-07-31. `vitest`, `typescript` a `eslint` se dědí z kořene repozitáře, který vlastní P01, a tenhle balíček je nedeklaruje.

```json
{
  "name": "@mlain/emails",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "license": "MIT",
  "exports": {
    "./*": "./src/*.ts",
    "./*.tsx": "./src/*.tsx",
    "./schema/document.v1.schema.json": "./schema/document.v1.schema.json",
    "./package.json": "./package.json"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test:unit": "vitest run"
  },
  "dependencies": {
    "@mlain/contracts": "workspace:*",
    "@react-email/components": "1.0.12",
    "@react-email/render": "2.1.0",
    "ajv": "8.20.0",
    "ajv-formats": "3.0.1",
    "culori": "4.0.2",
    "html-to-text": "10.0.0",
    "linkedom": "0.18.13",
    "nanoid": "6.0.0",
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "sanitize-html": "2.17.6"
  },
  "devDependencies": {
    "@types/react": "^19.0.0",
    "@types/react-dom": "^19.0.0",
    "@types/sanitize-html": "^2.16.0"
  }
}
```

Licence pro licenční bránu v CI: `@react-email/components` MIT, `@react-email/render` MIT, `ajv` MIT, `ajv-formats` MIT, `culori` MIT, `html-to-text` MIT, `linkedom` ISC, `nanoid` MIT, `react` a `react-dom` MIT, `sanitize-html` MIT. Žádná GPL, LGPL ani AGPL. Balíček **nesmí** přibrat `juice` (nepoužívá se, 3.4.5), `mjml` (náhradní cesta, ne závislost) ani `@usewaypoint/email-builder` (zamítnuto 2026-07-31).

- [ ] **Step 3: Vytvoř `packages/emails/tsconfig.json` a `vitest.config.ts`**

`packages/emails/tsconfig.json`:

```json
{
  "extends": "@mlain/config/tsconfig/base.json",
  "compilerOptions": {
    "jsx": "react-jsx",
    "lib": ["ES2023", "DOM"],
    "types": ["node"],
    "noEmit": true
  },
  "include": ["src", "test", "vitest.config.ts"]
}
```

`packages/emails/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts", "test/**/*.test.tsx"],
    globals: false,
  },
  esbuild: { jsx: "automatic" },
});
```

- [ ] **Step 4: Spusť test a ověř, že spadne**

Run: `pnpm install && pnpm vitest run packages/emails/test/document/ids.test.ts`
Expected: FAIL, `Failed to resolve import "../../src/document/ids.js"`.

- [ ] **Step 5: Napiš implementaci**

`packages/emails/src/document/ids.ts`:

```ts
import { customAlphabet } from "nanoid";

/**
 * Identita bloku podle 3.1.3. Jednoznačná v rámci dokumentu, ne globálně.
 * Poznámka k rozsahu: 36^12 je zhruba 2^62, ne 2^72, jak uvádí text specifikace.
 * Formát je normativní (regulární výraz níž je i v JSON Schema), takže ho neměníme;
 * 62 bitů na jednoznačnost uvnitř dokumentu o nejvýše 300 blocích bohatě stačí.
 */
export const BLOCK_ID_PATTERN = /^b_[0-9a-z]{12}$/;

const nano = customAlphabet("0123456789abcdefghijklmnopqrstuvwxyz", 12);

export function newBlockId(): string {
  return `b_${nano()}`;
}

export function isBlockId(value: unknown): value is string {
  return typeof value === "string" && BLOCK_ID_PATTERN.test(value);
}
```

- [ ] **Step 6: Spusť test a ověř, že projde**

Run: `pnpm vitest run packages/emails/test/document/ids.test.ts`
Expected: PASS, 3 testy.

- [ ] **Step 7: Commit**

```bash
git add packages/emails
git commit -m "feat(emails): scaffold package and block id generator"
```

---

### Task 2: Typy dokumentu

**Files:**
- Create: `packages/emails/src/document/types.ts`
- Test: `packages/emails/test/document/types.test.ts`

Tenhle úkol je jediný v plánu, který má víc typů než kódu. Je to schválně: každý další úkol se o tyhle názvy opírá a přejmenování v půlce by znamenalo přepsat všechno.

- [ ] **Step 1: Napiš padající test**

Test je typový, běží přes `expectTypeOf`, protože typy bez runtime chování se jinak otestovat nedají.

`packages/emails/test/document/types.test.ts`:

```ts
import { describe, expectTypeOf, it } from "vitest";
import type {
  ButtonBlock,
  ColumnsLayout,
  ContentBlock,
  DateFormat,
  Document,
  InlineNode,
  SectionBlock,
  ThemeColorRole,
  VisibilityCondition,
} from "../../src/document/types.js";

describe("document types", () => {
  it("accepts a minimal valid document", () => {
    const doc: Document = {
      schemaVersion: 1,
      meta: { name: "Test", previewText: "", language: "cs" },
      theme: {
        contentWidth: 600,
        canvasBackground: "surface.canvas",
        contentBackground: "surface.content",
        colors: {},
        fonts: { heading: "system", body: "system" },
        typography: { baseFontSize: 16, baseLineHeight: 1.5, headingScale: 1.25 },
        radius: 6,
        darkMode: { strategy: "auto", colors: {} },
      },
      blocks: [],
    };
    expectTypeOf(doc.blocks).toEqualTypeOf<SectionBlock[]>();
  });

  it("models a var node with fallback and dateFormat as node attributes", () => {
    const node: InlineNode = {
      t: "var",
      expr: "contact.first_name",
      fallback: "kolego",
    };
    expectTypeOf(node).toMatchTypeOf<InlineNode>();
    expectTypeOf<DateFormat>().toEqualTypeOf<
      "%d.%m.%Y" | "%-d.%-m.%Y" | "%Y-%m-%d" | "%d.%m.%Y %H:%M" | "%H:%M"
    >();
  });

  it("keeps visibility operators closed", () => {
    expectTypeOf<VisibilityCondition["op"]>().toEqualTypeOf<
      "present" | "blank" | "true" | "false"
    >();
  });

  it("has exactly ten theme color roles and six column layouts", () => {
    expectTypeOf<ThemeColorRole>().toEqualTypeOf<
      | "brand.primary" | "brand.secondary" | "brand.accent"
      | "text.default" | "text.muted" | "text.inverted"
      | "surface.canvas" | "surface.content" | "surface.subtle"
      | "link.default"
    >();
    expectTypeOf<ColumnsLayout>().toEqualTypeOf<
      "1-1" | "1-2" | "2-1" | "1-1-1" | "2-1-1" | "1-1-2"
    >();
  });

  it("puts button and footer in the content block union", () => {
    expectTypeOf<ButtonBlock>().toMatchTypeOf<ContentBlock>();
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm vitest run packages/emails/test/document/types.test.ts`
Expected: FAIL, modul `types.js` neexistuje.

- [ ] **Step 3: Napiš `packages/emails/src/document/types.ts`**

```ts
// Mlain Mailer Document v1. Zdroj pravdy je 3.1 části 3 specifikace,
// strojové schéma je v schema/document.v1.schema.json.

export type HexColor = `#${string}`;

export type ThemeColorRole =
  | "brand.primary"
  | "brand.secondary"
  | "brand.accent"
  | "text.default"
  | "text.muted"
  | "text.inverted"
  | "surface.canvas"
  | "surface.content"
  | "surface.subtle"
  | "link.default";

export type ColorRef = HexColor | ThemeColorRole;

export type FontStackId =
  | "system" | "arial" | "helvetica" | "verdana" | "tahoma"
  | "trebuchet" | "georgia" | "times" | "courier";

export type Padding = { top: number; right: number; bottom: number; left: number };

export type HeadingScale = 1.125 | 1.2 | 1.25 | 1.333;
export type Radius = 0 | 4 | 6 | 8 | 12;

export type Theme = {
  contentWidth: 600 | 640;
  canvasBackground: ColorRef;
  contentBackground: ColorRef;
  /** Částečná mapa. Neuvedená role bere výchozí hodnotu z theme/palette.ts (3.1.4). */
  colors: Partial<Record<ThemeColorRole, HexColor>>;
  fonts: { heading: FontStackId; body: FontStackId };
  typography: { baseFontSize: number; baseLineHeight: number; headingScale: HeadingScale };
  radius: Radius;
  darkMode: { strategy: "auto" | "off"; colors: Partial<Record<ThemeColorRole, HexColor>> };
};

export type DateFormat =
  | "%d.%m.%Y" | "%-d.%-m.%Y" | "%Y-%m-%d" | "%d.%m.%Y %H:%M" | "%H:%M";

export type TextInline = { t: "s"; v: string; b?: true; i?: true; u?: true; strike?: true };
export type LinkInline = { t: "a"; href: string; children: InlineNode[]; trackable?: boolean };
export type BreakInline = { t: "br" };

/**
 * Liquid výraz je vlastní uzel, ne text se závorkami (3.1.5).
 * `expr` je BEZ argumentů filtrů a BEZ uvozovek; hodnoty argumentů nesou
 * `fallback` a `dateFormat` a doplňuje je až kompilace po renderu (3.3.5).
 * `slots` je interní pole přidělené normalizací, v uloženém JSON nikdy není
 * (JSON Schema má na uzlu `var` additionalProperties: false). Uzel může nést
 * argumenty obou filtrů naráz (`{{ x | date | default }}`), proto dvě čísla, ne jedno.
 */
export type VarInline = {
  t: "var";
  expr: string;
  fallback?: string;
  dateFormat?: DateFormat;
  slots?: { default?: number; date?: number };
};

export type InlineNode = TextInline | LinkInline | BreakInline | VarInline;

export type RichNode =
  | { t: "p"; children: InlineNode[]; align?: "left" | "center" | "right" }
  | { t: "ul"; items: InlineNode[][] }
  | { t: "ol"; items: InlineNode[][] };

export type RichText = RichNode[];

export type VisibilityCondition = {
  /** Plná cesta pole VČETNĚ prefixu contact., například "contact.attr.mesto". */
  field: string;
  op: "present" | "blank" | "true" | "false";
};

export type CommonBlockProps = {
  padding: Padding;
  backgroundColor: ColorRef | null;
  hideOnMobile: boolean;
};

export type SectionProps = {
  backgroundColor: ColorRef | null;
  outerBackgroundColor: ColorRef | null;
  backgroundImageAssetId: string | null;
  backgroundPosition: "top" | "center" | "bottom";
  padding: Padding;
  fullWidth: boolean;
  roundedTop: boolean;
  roundedBottom: boolean;
};

export type ColumnsLayout = "1-1" | "1-2" | "2-1" | "1-1-1" | "2-1-1" | "1-1-2";

export type ColumnsProps = {
  layout: ColumnsLayout;
  gap: number;
  stackOnMobile: boolean;
  stackOrder: "normal" | "reverse";
  verticalAlign: "top" | "middle" | "bottom";
};

export type ColumnProps = {
  padding: Padding;
  backgroundColor: ColorRef | null;
  borderRadius: number;
};

export type HeadingProps = CommonBlockProps & {
  level: 1 | 2 | 3;
  content: RichText;
  color: ColorRef;
  align: "left" | "center" | "right";
  fontFamily: FontStackId | null;
  fontSize: number | null;
  fontWeight: 400 | 600 | 700;
  lineHeight: number | null;
  letterSpacing: number;
};

export type TextProps = CommonBlockProps & {
  content: RichText;
  color: ColorRef;
  linkColor: ColorRef;
  align: "left" | "center" | "right" | "justify";
  fontFamily: FontStackId | null;
  fontSize: number | null;
  lineHeight: number | null;
};

export type ImageProps = CommonBlockProps & {
  assetId: string;
  alt: string;
  decorative: boolean;
  width: "full" | number;
  align: "left" | "center" | "right";
  href: string | null;
  trackable: boolean;
  borderRadius: number | null;
  darkVariantAssetId: string | null;
};

export type ButtonProps = CommonBlockProps & {
  label: RichText;
  href: string;
  trackable: boolean;
  style: "solid" | "outline";
  backgroundColor: ColorRef;
  textColor: ColorRef;
  borderColor: ColorRef | null;
  borderWidth: 0 | 1 | 2;
  borderRadius: number | null;
  fullWidth: boolean;
  align: "left" | "center" | "right";
  paddingX: number;
  paddingY: number;
  fontSize: number;
};

export type DividerProps = CommonBlockProps & {
  color: ColorRef;
  thickness: 1 | 2 | 3 | 4;
  style: "solid" | "dashed" | "dotted";
  width: number;
  align: "left" | "center" | "right";
};

export type SpacerProps = CommonBlockProps & { height: number; heightMobile: number | null };

export type HtmlProps = CommonBlockProps & { code: string };

export type SocialNetwork =
  | "facebook" | "instagram" | "x" | "linkedin" | "youtube" | "tiktok"
  | "threads" | "pinterest" | "bluesky" | "mastodon" | "web" | "email";

export type SocialItem = { network: SocialNetwork; href: string; label?: string };

export type SocialProps = CommonBlockProps & {
  items: SocialItem[];
  iconStyle: "color" | "mono_dark" | "mono_light";
  iconSize: number;
  gap: number;
  align: "left" | "center" | "right";
};

export type FooterProps = CommonBlockProps & {
  senderInfo: RichText;
  showUnsubscribe: boolean;
  unsubscribeLabel: string;
  showPreferences: boolean;
  preferencesLabel: string;
  showWebview: boolean;
  webviewLabel: string;
  fontSize: number;
  color: ColorRef;
};

export type RepeatProps = CommonBlockProps & { path: string };

type WithId<T extends string, P, C = never> = {
  id: string;
  type: T;
  props: P;
  visibleWhen?: VisibilityCondition | null;
} & ([C] extends [never] ? Record<never, never> : { children: C });

export type HeadingBlock = WithId<"heading", HeadingProps>;
export type TextBlock = WithId<"text", TextProps>;
export type ImageBlock = WithId<"image", ImageProps>;
export type ButtonBlock = WithId<"button", ButtonProps>;
export type DividerBlock = WithId<"divider", DividerProps>;
export type SpacerBlock = WithId<"spacer", SpacerProps>;
export type HtmlBlock = WithId<"html", HtmlProps>;
export type SocialBlock = WithId<"social", SocialProps>;
export type FooterBlock = WithId<"footer", FooterProps>;

export type ContentBlock =
  | HeadingBlock | TextBlock | ImageBlock | ButtonBlock | DividerBlock
  | SpacerBlock | HtmlBlock | SocialBlock | FooterBlock;

/** Neznámý typ bloku se nese jako neprůhledný objekt, aby uložení bylo bajtově shodné (3.1.7). */
export type UnknownBlock = { id: string; type: string; [key: string]: unknown };

export type ColumnBlock = {
  id: string;
  type: "column";
  props: ColumnProps;
  children: (ContentBlock | UnknownBlock)[];
};

export type ColumnsBlock = {
  id: string;
  type: "columns";
  props: ColumnsProps;
  children: ColumnBlock[];
};

/** Uzel cyklu. V gramatice od schématu 1, MVP 0 ho nevydává (3.1.2). */
export type RepeatBlock = WithId<"repeat", RepeatProps, (ContentBlock | UnknownBlock)[]>;

export type SectionChild = ColumnsBlock | RepeatBlock | ContentBlock | UnknownBlock;

export type SectionBlock = {
  id: string;
  type: "section";
  props: SectionProps;
  visibleWhen?: VisibilityCondition | null;
  children: SectionChild[];
};

export type AnyBlock =
  | SectionBlock | ColumnsBlock | ColumnBlock | RepeatBlock | ContentBlock | UnknownBlock;

export type DocumentMeta = {
  name: string;
  previewText: string;
  /** BCP 47 tag, libovolný platný (3.1.9). MVP 0 dodává texty pro cs a en. */
  language: string;
};

export type Document = {
  schemaVersion: number;
  meta: DocumentMeta;
  theme: Theme;
  blocks: SectionBlock[];
};

export const CURRENT_SCHEMA_VERSION = 1;

/** Limity dokumentu z 3.1.2. */
export const MAX_BLOCKS_PER_DOCUMENT = 300;
export const MAX_DOCUMENT_BYTES = 512 * 1024;
export const MAX_SECTIONS = 60;
export const MAX_SECTION_CHILDREN = 40;
export const MAX_COLUMN_CHILDREN = 20;
export const MAX_RICHTEXT_NODES = 200;
export const MAX_TEXT_RUN_CHARS = 5000;
export const MAX_VAR_EXPR_CHARS = 200;
export const MAX_VAR_FALLBACK_CHARS = 100;
export const MAX_LINKS_PER_DOCUMENT = 999;
```

- [ ] **Step 4: Spusť test a ověř, že projde**

Run: `pnpm vitest run packages/emails/test/document/types.test.ts`
Expected: PASS, 5 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/emails/src/document/types.ts packages/emails/test/document/types.test.ts
git commit -m "feat(emails): document model types"
```

---

### Task 3: Výchozí hodnoty motivu a bloků

**Files:**
- Create: `packages/emails/src/theme/palette.ts`
- Create: `packages/emails/src/document/defaults.ts`
- Test: `packages/emails/test/theme/palette.test.ts`
- Test: `packages/emails/test/document/defaults.test.ts`

- [ ] **Step 1: Napiš padající testy**

`packages/emails/test/theme/palette.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_DARK, DEFAULT_LIGHT, FONT_STACKS, contrastRatio } from "../../src/theme/palette.js";

describe("default palette", () => {
  it("defines all ten roles in both schemes", () => {
    const roles = Object.keys(DEFAULT_LIGHT).sort();
    expect(roles).toHaveLength(10);
    expect(Object.keys(DEFAULT_DARK).sort()).toEqual(roles);
  });

  it("matches the normative table in 3.1.4", () => {
    expect(DEFAULT_LIGHT["brand.primary"]).toBe("#2563eb");
    expect(DEFAULT_LIGHT["text.default"]).toBe("#111827");
    expect(DEFAULT_LIGHT["surface.canvas"]).toBe("#f4f5f7");
    expect(DEFAULT_LIGHT["link.default"]).toBe("#1d4ed8");
    expect(DEFAULT_DARK["surface.content"]).toBe("#111827");
    expect(DEFAULT_DARK["text.default"]).toBe("#e5e7eb");
    expect(DEFAULT_DARK["link.default"]).toBe("#93c5fd");
  });

  it("keeps default text on default content above WCAG AA", () => {
    expect(contrastRatio(DEFAULT_LIGHT["text.default"], DEFAULT_LIGHT["surface.content"]))
      .toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(DEFAULT_DARK["text.default"], DEFAULT_DARK["surface.content"]))
      .toBeGreaterThanOrEqual(4.5);
  });

  it("has a closed list of nine font stacks and resolves system to Segoe UI for Word", () => {
    expect(Object.keys(FONT_STACKS)).toHaveLength(9);
    expect(FONT_STACKS.system).toContain('"Segoe UI"');
    expect(FONT_STACKS.georgia).toBe('Georgia, "Times New Roman", serif');
  });
});
```

`packages/emails/test/document/defaults.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_THEME, blockDefaults } from "../../src/document/defaults.js";

describe("defaults", () => {
  it("uses the documented theme defaults", () => {
    expect(DEFAULT_THEME.contentWidth).toBe(600);
    expect(DEFAULT_THEME.typography).toEqual({
      baseFontSize: 16,
      baseLineHeight: 1.5,
      headingScale: 1.25,
    });
    expect(DEFAULT_THEME.radius).toBe(6);
    expect(DEFAULT_THEME.darkMode.strategy).toBe("auto");
    expect(DEFAULT_THEME.colors).toEqual({});
  });

  it("uses the common block padding default for content blocks", () => {
    expect(blockDefaults("text").padding).toEqual({ top: 0, right: 24, bottom: 16, left: 24 });
    expect(blockDefaults("section").padding).toEqual({ top: 24, right: 24, bottom: 24, left: 24 });
  });

  it("defaults the footer sender info to a merge tag, never a constant", () => {
    expect(blockDefaults("footer").senderInfo).toEqual([
      { t: "p", children: [{ t: "var", expr: "workspace.sender_address" }] },
    ]);
    expect(blockDefaults("footer").showUnsubscribe).toBe(true);
  });

  it("defaults buttons and images to trackable", () => {
    expect(blockDefaults("button").trackable).toBe(true);
    expect(blockDefaults("image").trackable).toBe(true);
  });
});
```

- [ ] **Step 2: Spusť testy a ověř, že spadnou**

Run: `pnpm vitest run packages/emails/test/theme packages/emails/test/document/defaults.test.ts`
Expected: FAIL, moduly neexistují.

- [ ] **Step 3: Napiš `packages/emails/src/theme/palette.ts`**

```ts
import { converter, wcagContrast } from "culori";
import type { FontStackId, HexColor, ThemeColorRole } from "../document/types.js";

/** Výchozí role světlého režimu, normativní tabulka z 3.1.4. */
export const DEFAULT_LIGHT: Record<ThemeColorRole, HexColor> = {
  "brand.primary": "#2563eb",
  "brand.secondary": "#3b82f6",
  "brand.accent": "#2563eb",
  "text.default": "#111827",
  "text.muted": "#6b7280",
  "text.inverted": "#ffffff",
  "surface.canvas": "#f4f5f7",
  "surface.content": "#ffffff",
  "surface.subtle": "#e5e7eb",
  "link.default": "#1d4ed8",
};

export const DEFAULT_DARK: Record<ThemeColorRole, HexColor> = {
  "brand.primary": "#60a5fa",
  "brand.secondary": "#93c5fd",
  "brand.accent": "#60a5fa",
  "text.default": "#e5e7eb",
  "text.muted": "#9ca3af",
  "text.inverted": "#0b0f19",
  "surface.canvas": "#0b0f19",
  "surface.content": "#111827",
  "surface.subtle": "#1f2937",
  "link.default": "#93c5fd",
};

/**
 * Uzavřený seznam. Webfonty v e-mailu nepodporuje Outlook na Windows ani Gmail,
 * takže vlastní písmo je vždy jen kosmetika a fallback stejně musí být systémový.
 */
export const FONT_STACKS: Record<FontStackId, string> = {
  system: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
  arial: "Arial, Helvetica, sans-serif",
  helvetica: "Helvetica, Arial, sans-serif",
  verdana: "Verdana, Geneva, sans-serif",
  tahoma: "Tahoma, Verdana, Segoe, sans-serif",
  trebuchet: '"Trebuchet MS", Helvetica, sans-serif',
  georgia: 'Georgia, "Times New Roman", serif',
  times: '"Times New Roman", Times, serif',
  courier: '"Courier New", Courier, monospace',
};

const toRgb = converter("rgb");

export function contrastRatio(a: string, b: string): number {
  return wcagContrast(a, b);
}

/** Zesvětlení nebo ztmavení o daný podíl, používá base template při odvozování barev. */
export function shift(color: string, amount: number): HexColor {
  const rgb = toRgb(color);
  if (!rgb) return "#000000";
  const mix = (channel: number): number =>
    amount >= 0 ? channel + (1 - channel) * amount : channel * (1 + amount);
  const hex = (channel: number): string =>
    Math.round(Math.min(1, Math.max(0, channel)) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${hex(mix(rgb.r))}${hex(mix(rgb.g))}${hex(mix(rgb.b))}`;
}
```

- [ ] **Step 4: Napiš `packages/emails/src/document/defaults.ts`**

```ts
import type {
  ButtonProps, ColumnProps, ColumnsProps, DividerProps, FooterProps, HeadingProps,
  HtmlProps, ImageProps, Padding, RepeatProps, SectionProps, SocialProps, SpacerProps,
  TextProps, Theme,
} from "./types.js";

export const DEFAULT_THEME: Theme = {
  contentWidth: 600,
  canvasBackground: "surface.canvas",
  contentBackground: "surface.content",
  colors: {},
  fonts: { heading: "system", body: "system" },
  typography: { baseFontSize: 16, baseLineHeight: 1.5, headingScale: 1.25 },
  radius: 6,
  darkMode: { strategy: "auto", colors: {} },
};

const pad = (top: number, right: number, bottom: number, left: number): Padding =>
  ({ top, right, bottom, left });

const COMMON = {
  padding: pad(0, 24, 16, 24),
  backgroundColor: null,
  hideOnMobile: false,
} as const;

const DEFAULTS = {
  section: {
    backgroundColor: null,
    outerBackgroundColor: null,
    backgroundImageAssetId: null,
    backgroundPosition: "center",
    padding: pad(24, 24, 24, 24),
    fullWidth: false,
    roundedTop: false,
    roundedBottom: false,
  } satisfies SectionProps,
  columns: {
    layout: "1-1",
    gap: 16,
    stackOnMobile: true,
    stackOrder: "normal",
    verticalAlign: "top",
  } satisfies ColumnsProps,
  column: {
    padding: pad(0, 0, 0, 0),
    backgroundColor: null,
    borderRadius: 0,
  } satisfies ColumnProps,
  repeat: { ...COMMON, path: "" } satisfies RepeatProps,
  heading: {
    ...COMMON,
    level: 2,
    content: [{ t: "p", children: [] }],
    color: "text.default",
    align: "left",
    fontFamily: null,
    fontSize: null,
    fontWeight: 700,
    lineHeight: null,
    letterSpacing: 0,
  } satisfies HeadingProps,
  text: {
    ...COMMON,
    content: [{ t: "p", children: [] }],
    color: "text.default",
    linkColor: "link.default",
    align: "left",
    fontFamily: null,
    fontSize: null,
    lineHeight: null,
  } satisfies TextProps,
  image: {
    ...COMMON,
    assetId: "",
    alt: "",
    decorative: false,
    width: "full",
    align: "center",
    href: null,
    trackable: true,
    borderRadius: null,
    darkVariantAssetId: null,
  } satisfies ImageProps,
  button: {
    ...COMMON,
    label: [{ t: "p", children: [{ t: "s", v: "Zjistit více" }] }],
    href: "",
    trackable: true,
    style: "solid",
    backgroundColor: "brand.primary",
    textColor: "text.inverted",
    borderColor: null,
    borderWidth: 0,
    borderRadius: null,
    fullWidth: false,
    align: "center",
    paddingX: 28,
    paddingY: 14,
    fontSize: 16,
  } satisfies ButtonProps,
  divider: {
    ...COMMON,
    color: "surface.subtle",
    thickness: 1,
    style: "solid",
    width: 100,
    align: "center",
  } satisfies DividerProps,
  spacer: { ...COMMON, height: 24, heightMobile: null } satisfies SpacerProps,
  html: { ...COMMON, code: "" } satisfies HtmlProps,
  social: {
    ...COMMON,
    items: [],
    iconStyle: "color",
    iconSize: 28,
    gap: 12,
    align: "center",
  } satisfies SocialProps,
  footer: {
    ...COMMON,
    // Poštovní adresa se čte z dat zprávy, nikdy se nezapéká při kompilaci (3.2.12).
    senderInfo: [{ t: "p", children: [{ t: "var", expr: "workspace.sender_address" }] }],
    showUnsubscribe: true,
    unsubscribeLabel: "Odhlásit se z odběru",
    showPreferences: true,
    preferencesLabel: "Nastavit předvolby",
    showWebview: true,
    webviewLabel: "Zobrazit v prohlížeči",
    fontSize: 12,
    color: "text.muted",
  } satisfies FooterProps,
} as const;

export type BlockTypeWithDefaults = keyof typeof DEFAULTS;

export function blockDefaults<T extends BlockTypeWithDefaults>(type: T): (typeof DEFAULTS)[T] {
  return DEFAULTS[type];
}

export const KNOWN_BLOCK_TYPES: readonly string[] = [
  "section", "columns", "column", "repeat", "heading", "text", "image",
  "button", "divider", "spacer", "html", "social", "footer",
];
```

- [ ] **Step 5: Spusť testy a ověř, že projdou**

Run: `pnpm vitest run packages/emails/test/theme packages/emails/test/document/defaults.test.ts`
Expected: PASS, 8 testů.

- [ ] **Step 6: Commit**

```bash
git add packages/emails/src/theme packages/emails/src/document/defaults.ts packages/emails/test/theme packages/emails/test/document/defaults.test.ts
git commit -m "feat(emails): default palette, font stacks and block defaults"
```

---

### Task 4: Kanonická serializace a `design_hash`

**Files:**
- Create: `packages/emails/src/document/canonical.ts`
- Test: `packages/emails/test/document/canonical.test.ts`

Kritérium 8: stejný dokument s klíči v jiném pořadí musí dát stejný hash. Bez toho autosave ukládá pořád dokola a „vytvořit verzi" vyrábí duplicity.

- [ ] **Step 1: Napiš padající test**

`packages/emails/test/document/canonical.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { canonicalJson, designHash } from "../../src/document/canonical.js";

describe("canonical serialization", () => {
  it("orders object keys lexicographically and drops whitespace", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("preserves array order", () => {
    expect(canonicalJson([3, 1, 2])).toBe("[3,1,2]");
  });

  it("drops undefined properties but keeps null", () => {
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
  });

  it("keeps non-ascii characters as UTF-8, not as escapes", () => {
    expect(canonicalJson({ v: "Žofie" })).toBe('{"v":"Žofie"}');
  });

  it("gives the same hash for the same content in a different key order", () => {
    const a = { schemaVersion: 1, meta: { language: "cs", name: "X", previewText: "" } };
    const b = { meta: { name: "X", previewText: "", language: "cs" }, schemaVersion: 1 };
    expect(designHash(a)).toEqual(designHash(b));
  });

  it("gives a different hash for different content", () => {
    expect(designHash({ a: 1 })).not.toEqual(designHash({ a: 2 }));
  });

  it("returns 32 raw bytes, ready for the bytea column", () => {
    expect(designHash({ a: 1 })).toBeInstanceOf(Buffer);
    expect(designHash({ a: 1 })).toHaveLength(32);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm vitest run packages/emails/test/document/canonical.test.ts`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napiš implementaci**

`packages/emails/src/document/canonical.ts`:

```ts
import { createHash } from "node:crypto";

/**
 * Kanonická serializace: klíče lexikograficky, bez mezer, UTF-8 (2.1).
 * `JSON.stringify` s polem klíčů nestačí, protože řadí jen na jedné úrovni
 * a u vnořených objektů by pořadí zůstalo takové, v jakém klíče vznikly.
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      if (source[key] === undefined) continue;
      out[key] = sortValue(source[key]);
    }
    return out;
  }
  return value;
}

/** SHA-256 nad kanonickou serializací. Sloupec design_hash je bytea, proto Buffer. */
export function designHash(value: unknown): Buffer {
  return createHash("sha256").update(canonicalJson(value), "utf8").digest();
}

export function designHashHex(value: unknown): string {
  return designHash(value).toString("hex");
}
```

- [ ] **Step 4: Spusť test a ověř, že projde**

Run: `pnpm vitest run packages/emails/test/document/canonical.test.ts`
Expected: PASS, 7 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/emails/src/document/canonical.ts packages/emails/test/document/canonical.test.ts
git commit -m "feat(emails): canonical json and design hash"
```

---

### Task 5: Průchod dokumentem a JSON Pointery

**Files:**
- Create: `packages/emails/src/document/walk.ts`
- Test: `packages/emails/test/document/walk.test.ts`

Každý další úkol (sémantika, sloty, odkazy, `renderSchema`, textová varianta) potřebuje projít strom ve **stejném** pořadí. Kdyby si pořadí každý určoval sám, `position` odkazů by nesouhlasila s pořadím slotů a nikde by to nespadlo.

- [ ] **Step 1: Napiš padající test**

`packages/emails/test/document/walk.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Document } from "../../src/document/types.js";
import { walkBlocks, walkRichText } from "../../src/document/walk.js";
import { DEFAULT_THEME } from "../../src/document/defaults.js";
import { blockDefaults } from "../../src/document/defaults.js";

const doc: Document = {
  schemaVersion: 1,
  meta: { name: "t", previewText: "", language: "cs" },
  theme: DEFAULT_THEME,
  blocks: [
    {
      id: "b_000000000001",
      type: "section",
      props: blockDefaults("section"),
      children: [
        {
          id: "b_000000000002",
          type: "columns",
          props: blockDefaults("columns"),
          children: [
            {
              id: "b_000000000003",
              type: "column",
              props: blockDefaults("column"),
              children: [{ id: "b_000000000004", type: "spacer", props: blockDefaults("spacer") }],
            },
            {
              id: "b_000000000005",
              type: "column",
              props: blockDefaults("column"),
              children: [],
            },
          ],
        },
        { id: "b_000000000006", type: "divider", props: blockDefaults("divider") },
      ],
    },
  ],
};

describe("walkBlocks", () => {
  it("visits blocks depth first in document order", () => {
    const seen = [...walkBlocks(doc)].map((entry) => entry.block.id);
    expect(seen).toEqual([
      "b_000000000001",
      "b_000000000002",
      "b_000000000003",
      "b_000000000004",
      "b_000000000005",
      "b_000000000006",
    ]);
  });

  it("reports a JSON pointer for every block", () => {
    const pointers = [...walkBlocks(doc)].map((entry) => entry.pointer);
    expect(pointers[0]).toBe("/blocks/0");
    expect(pointers[3]).toBe("/blocks/0/children/0/children/0/children/0");
    expect(pointers[5]).toBe("/blocks/0/children/1");
  });

  it("reports depth so nesting rules can be checked in one pass", () => {
    const depths = [...walkBlocks(doc)].map((entry) => entry.depth);
    expect(depths).toEqual([0, 1, 2, 3, 2, 1]);
  });
});

describe("walkRichText", () => {
  it("visits inline nodes in reading order with pointers", () => {
    const rich = [
      { t: "p" as const, children: [{ t: "s" as const, v: "a" }, { t: "var" as const, expr: "contact.city" }] },
      { t: "ul" as const, items: [[{ t: "s" as const, v: "b" }]] },
    ];
    const seen = [...walkRichText(rich, "/x")].map((e) => [e.pointer, e.node.t]);
    expect(seen).toEqual([
      ["/x/0/children/0", "s"],
      ["/x/0/children/1", "var"],
      ["/x/1/items/0/0", "s"],
    ]);
  });

  it("descends into link children", () => {
    const rich = [
      {
        t: "p" as const,
        children: [
          { t: "a" as const, href: "https://a.cz", children: [{ t: "var" as const, expr: "contact.city" }] },
        ],
      },
    ];
    const seen = [...walkRichText(rich, "/y")].map((e) => e.pointer);
    expect(seen).toEqual(["/y/0/children/0", "/y/0/children/0/children/0"]);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm vitest run packages/emails/test/document/walk.test.ts`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napiš implementaci**

`packages/emails/src/document/walk.ts`:

```ts
import type { AnyBlock, Document, InlineNode, RichText } from "./types.js";

export type BlockVisit = {
  block: AnyBlock;
  pointer: string;
  depth: number;
  parent: AnyBlock | null;
};

/** Průchod shora dolů, do hloubky, v pořadí dokumentu. Jediné závazné pořadí v balíčku. */
export function* walkBlocks(doc: Document): Generator<BlockVisit> {
  for (let i = 0; i < doc.blocks.length; i += 1) {
    yield* walkBlock(doc.blocks[i]!, `/blocks/${i}`, 0, null);
  }
}

function* walkBlock(
  block: AnyBlock,
  pointer: string,
  depth: number,
  parent: AnyBlock | null,
): Generator<BlockVisit> {
  yield { block, pointer, depth, parent };
  const children = (block as { children?: AnyBlock[] }).children;
  if (!Array.isArray(children)) return;
  for (let i = 0; i < children.length; i += 1) {
    yield* walkBlock(children[i]!, `${pointer}/children/${i}`, depth + 1, block);
  }
}

export type InlineVisit = { node: InlineNode; pointer: string };

/** Průchod bohatým textem. `base` je pointer na samotné pole RichText. */
export function* walkRichText(rich: RichText, base: string): Generator<InlineVisit> {
  for (let i = 0; i < rich.length; i += 1) {
    const node = rich[i]!;
    if (node.t === "p") {
      yield* walkInline(node.children, `${base}/${i}/children`);
    } else {
      for (let j = 0; j < node.items.length; j += 1) {
        yield* walkInline(node.items[j]!, `${base}/${i}/items/${j}`);
      }
    }
  }
}

function* walkInline(nodes: InlineNode[], base: string): Generator<InlineVisit> {
  for (let i = 0; i < nodes.length; i += 1) {
    const node = nodes[i]!;
    const pointer = `${base}/${i}`;
    yield { node, pointer };
    if (node.t === "a") {
      yield* walkInline(node.children, `${pointer}/children`);
    }
  }
}

/** Všechna pole RichText v bloku, v pořadí, ve kterém je emitter vykresluje. */
export function richTextFieldsOf(block: AnyBlock): Array<{ rich: RichText; key: string }> {
  const props = (block as { props?: Record<string, unknown> }).props ?? {};
  const keys =
    block.type === "heading" || block.type === "text" ? ["content"]
      : block.type === "button" ? ["label"]
      : block.type === "footer" ? ["senderInfo"]
      : [];
  return keys
    .filter((key) => Array.isArray(props[key]))
    .map((key) => ({ rich: props[key] as RichText, key }));
}

/** Tečková notace pro pole `errors[].path` na hranici API (konvence části 1, 4.2). */
export function pointerToDotted(pointer: string): string {
  return pointer.replace(/^\//, "").split("/").join(".");
}
```

- [ ] **Step 4: Spusť test a ověř, že projde**

Run: `pnpm vitest run packages/emails/test/document/walk.test.ts`
Expected: PASS, 5 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/emails/src/document/walk.ts packages/emails/test/document/walk.test.ts
git commit -m "feat(emails): deterministic document traversal"
```

---

### Task 6: JSON Schema dokumentu a validace přes ajv

**Files:**
- Create: `packages/emails/schema/document.v1.schema.json`
- Create: `packages/emails/src/document/schema.ts`
- Test: `packages/emails/test/document/schema.test.ts`

Schéma je zdroj pravdy pro tři konzumenty: validaci na API, structured output AI (P15) a generování typů. **Neznámý typ bloku schéma pouští**, tvrdý je až sémantický validátor. Kdyby ho pouštět nemělo, dokument s pluginovým blokem by spadl dřív, než se dostane k zamčenému placeholderu, a kritérium 5 by nešlo splnit.

- [ ] **Step 1: Napiš padající test**

`packages/emails/test/document/schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { blockDefaults, DEFAULT_THEME } from "../../src/document/defaults.js";
import { validateDocumentSchema } from "../../src/document/schema.js";

const base = () => ({
  schemaVersion: 1,
  meta: { name: "T", previewText: "P", language: "cs" },
  theme: DEFAULT_THEME,
  blocks: [
    {
      id: "b_000000000001",
      type: "section",
      props: blockDefaults("section"),
      children: [{ id: "b_000000000002", type: "text", props: blockDefaults("text") }],
    },
  ],
});

describe("document json schema", () => {
  it("accepts a minimal valid document", () => {
    expect(validateDocumentSchema(base())).toEqual({ ok: true });
  });

  it("rejects an unknown top level property", () => {
    const doc = { ...base(), extra: 1 };
    const result = validateDocumentSchema(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]!.pointer).toBe("");
  });

  it("rejects a malformed block id and points at it", () => {
    const doc = base();
    doc.blocks[0]!.id = "nope";
    const result = validateDocumentSchema(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues[0]!.pointer).toBe("/blocks/0/id");
  });

  it("accepts an unknown block type and keeps its extra properties", () => {
    const doc = base();
    (doc.blocks[0]!.children as unknown[]).push({
      id: "b_000000000003",
      type: "chart",
      series: [1, 2, 3],
      nested: { deep: true },
    });
    expect(validateDocumentSchema(doc)).toEqual({ ok: true });
  });

  it("still reports a concrete error for a broken known block", () => {
    const doc = base();
    (doc.blocks[0]!.children[0] as { props: { fontSize: unknown } }).props.fontSize = "big";
    const result = validateDocumentSchema(doc);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issues.some((i) => i.pointer.includes("/props/fontSize"))).toBe(true);
    }
  });

  it("accepts the repeat block even though MVP 0 never emits it", () => {
    const doc = base();
    (doc.blocks[0]!.children as unknown[]).push({
      id: "b_000000000004",
      type: "repeat",
      props: { ...blockDefaults("repeat"), path: "contact.attr.items" },
      children: [],
    });
    expect(validateDocumentSchema(doc)).toEqual({ ok: true });
  });

  it("rejects a var node carrying the internal slots property", () => {
    const doc = base();
    (doc.blocks[0]!.children[0] as { props: { content: unknown } }).props.content = [
      { t: "p", children: [{ t: "var", expr: "contact.city", slots: { default: 3 } }] },
    ];
    expect(validateDocumentSchema(doc).ok).toBe(false);
  });

  it("rejects a document with more than sixty sections", () => {
    const doc = base();
    doc.blocks = Array.from({ length: 61 }, (_, i) => ({
      id: `b_00000000${String(i).padStart(4, "0")}`,
      type: "section" as const,
      props: blockDefaults("section"),
      children: [],
    }));
    expect(validateDocumentSchema(doc).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm vitest run packages/emails/test/document/schema.test.ts`
Expected: FAIL, modul `schema.js` neexistuje.

- [ ] **Step 3: Napiš `packages/emails/schema/document.v1.schema.json`**

Společné vlastnosti bloků se v každé definici **opakují**, ne skládají přes `allOf`. Je to schválně: `additionalProperties: false` nevidí vlastnosti deklarované v sourozeneckém `allOf`, takže složená varianta by odmítla úplně platný dokument. Je to nejčastější past JSON Schema a stojí za tři obrazovky opakování.

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "https://mlain.dev/schema/document/v1.json",
  "title": "Mlain Mailer Document v1",
  "type": "object",
  "additionalProperties": false,
  "required": ["schemaVersion", "meta", "theme", "blocks"],
  "properties": {
    "schemaVersion": { "const": 1 },
    "meta": { "$ref": "#/$defs/meta" },
    "theme": { "$ref": "#/$defs/theme" },
    "blocks": {
      "type": "array", "minItems": 0, "maxItems": 60,
      "items": { "$ref": "#/$defs/sectionBlock" }
    }
  },
  "$defs": {
    "blockId": { "type": "string", "pattern": "^b_[0-9a-z]{12}$" },
    "hexColor": { "type": "string", "pattern": "^#[0-9a-f]{6}$" },
    "uuid": { "type": "string", "format": "uuid" },
    "colorRef": {
      "oneOf": [
        { "$ref": "#/$defs/hexColor" },
        { "enum": ["brand.primary", "brand.secondary", "brand.accent",
                   "text.default", "text.muted", "text.inverted",
                   "surface.canvas", "surface.content", "surface.subtle",
                   "link.default"] }
      ]
    },
    "colorRefOrNull": { "oneOf": [{ "$ref": "#/$defs/colorRef" }, { "type": "null" }] },
    "padding": {
      "type": "object", "additionalProperties": false,
      "required": ["top", "right", "bottom", "left"],
      "properties": {
        "top": { "type": "integer", "minimum": 0, "maximum": 100 },
        "right": { "type": "integer", "minimum": 0, "maximum": 100 },
        "bottom": { "type": "integer", "minimum": 0, "maximum": 100 },
        "left": { "type": "integer", "minimum": 0, "maximum": 100 }
      }
    },
    "visibleWhen": {
      "oneOf": [
        { "type": "null" },
        {
          "type": "object", "additionalProperties": false,
          "required": ["field", "op"],
          "properties": {
            "field": { "type": "string", "maxLength": 120 },
            "op": { "enum": ["present", "blank", "true", "false"] }
          }
        }
      ]
    },
    "dateFormat": {
      "enum": ["%d.%m.%Y", "%-d.%-m.%Y", "%Y-%m-%d", "%d.%m.%Y %H:%M", "%H:%M"]
    },
    "inlineNode": {
      "oneOf": [
        {
          "type": "object", "additionalProperties": false, "required": ["t", "v"],
          "properties": {
            "t": { "const": "s" },
            "v": { "type": "string", "maxLength": 5000 },
            "b": { "const": true }, "i": { "const": true },
            "u": { "const": true }, "strike": { "const": true }
          }
        },
        {
          "type": "object", "additionalProperties": false, "required": ["t", "href", "children"],
          "properties": {
            "t": { "const": "a" },
            "href": { "type": "string", "maxLength": 2000 },
            "trackable": { "type": "boolean" },
            "children": {
              "type": "array", "maxItems": 200,
              "items": { "$ref": "#/$defs/inlineNodeNoLink" }
            }
          }
        },
        {
          "type": "object", "additionalProperties": false, "required": ["t"],
          "properties": { "t": { "const": "br" } }
        },
        { "$ref": "#/$defs/varNode" }
      ]
    },
    "inlineNodeNoLink": {
      "$comment": "Odkaz nesmí obsahovat další odkaz (3.1.5).",
      "oneOf": [
        {
          "type": "object", "additionalProperties": false, "required": ["t", "v"],
          "properties": {
            "t": { "const": "s" },
            "v": { "type": "string", "maxLength": 5000 },
            "b": { "const": true }, "i": { "const": true },
            "u": { "const": true }, "strike": { "const": true }
          }
        },
        {
          "type": "object", "additionalProperties": false, "required": ["t"],
          "properties": { "t": { "const": "br" } }
        },
        { "$ref": "#/$defs/varNode" }
      ]
    },
    "varNode": {
      "$comment": "additionalProperties false tu drží i interní pole slots mimo uložený JSON.",
      "type": "object", "additionalProperties": false, "required": ["t", "expr"],
      "properties": {
        "t": { "const": "var" },
        "expr": { "type": "string", "maxLength": 200 },
        "fallback": { "type": "string", "maxLength": 100 },
        "dateFormat": { "$ref": "#/$defs/dateFormat" }
      }
    },
    "richText": {
      "type": "array", "maxItems": 200,
      "items": {
        "oneOf": [
          {
            "type": "object", "additionalProperties": false, "required": ["t", "children"],
            "properties": {
              "t": { "const": "p" },
              "align": { "enum": ["left", "center", "right"] },
              "children": {
                "type": "array", "maxItems": 200, "items": { "$ref": "#/$defs/inlineNode" }
              }
            }
          },
          {
            "type": "object", "additionalProperties": false, "required": ["t", "items"],
            "properties": {
              "t": { "enum": ["ul", "ol"] },
              "items": {
                "type": "array", "maxItems": 100,
                "items": {
                  "type": "array", "maxItems": 200, "items": { "$ref": "#/$defs/inlineNode" }
                }
              }
            }
          }
        ]
      }
    },
    "meta": {
      "type": "object", "additionalProperties": false,
      "required": ["name", "previewText", "language"],
      "properties": {
        "name": { "type": "string", "minLength": 1, "maxLength": 120 },
        "previewText": { "type": "string", "maxLength": 200 },
        "language": { "type": "string", "maxLength": 35, "pattern": "^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$" }
      }
    },
    "theme": {
      "type": "object", "additionalProperties": false,
      "required": ["contentWidth", "canvasBackground", "contentBackground", "colors",
                   "fonts", "typography", "radius", "darkMode"],
      "properties": {
        "contentWidth": { "enum": [600, 640] },
        "canvasBackground": { "$ref": "#/$defs/colorRef" },
        "contentBackground": { "$ref": "#/$defs/colorRef" },
        "colors": { "$ref": "#/$defs/roleColorMap" },
        "fonts": {
          "type": "object", "additionalProperties": false, "required": ["heading", "body"],
          "properties": {
            "heading": { "$ref": "#/$defs/fontStackId" },
            "body": { "$ref": "#/$defs/fontStackId" }
          }
        },
        "typography": {
          "type": "object", "additionalProperties": false,
          "required": ["baseFontSize", "baseLineHeight", "headingScale"],
          "properties": {
            "baseFontSize": { "type": "integer", "minimum": 12, "maximum": 20 },
            "baseLineHeight": { "type": "number", "minimum": 1.2, "maximum": 2 },
            "headingScale": { "enum": [1.125, 1.2, 1.25, 1.333] }
          }
        },
        "radius": { "enum": [0, 4, 6, 8, 12] },
        "darkMode": {
          "type": "object", "additionalProperties": false, "required": ["strategy", "colors"],
          "properties": {
            "strategy": { "enum": ["auto", "off"] },
            "colors": { "$ref": "#/$defs/roleColorMap" }
          }
        }
      }
    },
    "roleColorMap": {
      "$comment": "Částečná mapa. Neuvedená role bere výchozí hodnotu z rendereru (3.1.4).",
      "type": "object", "additionalProperties": false,
      "properties": {
        "brand.primary": { "$ref": "#/$defs/hexColor" },
        "brand.secondary": { "$ref": "#/$defs/hexColor" },
        "brand.accent": { "$ref": "#/$defs/hexColor" },
        "text.default": { "$ref": "#/$defs/hexColor" },
        "text.muted": { "$ref": "#/$defs/hexColor" },
        "text.inverted": { "$ref": "#/$defs/hexColor" },
        "surface.canvas": { "$ref": "#/$defs/hexColor" },
        "surface.content": { "$ref": "#/$defs/hexColor" },
        "surface.subtle": { "$ref": "#/$defs/hexColor" },
        "link.default": { "$ref": "#/$defs/hexColor" }
      }
    },
    "fontStackId": {
      "enum": ["system", "arial", "helvetica", "verdana", "tahoma",
               "trebuchet", "georgia", "times", "courier"]
    },
    "knownBlockType": {
      "enum": ["section", "columns", "column", "repeat", "heading", "text", "image",
               "button", "divider", "spacer", "html", "social", "footer"]
    },
    "unknownBlock": {
      "$comment": "Úniková definice. additionalProperties tu chybí schválně, aby se blok nesl beze ztráty dat (3.1.6).",
      "type": "object",
      "required": ["id", "type"],
      "properties": {
        "id": { "$ref": "#/$defs/blockId" },
        "type": { "type": "string", "not": { "$ref": "#/$defs/knownBlockType" } }
      }
    },
    "sectionProps": {
      "type": "object", "additionalProperties": false,
      "required": ["backgroundColor", "outerBackgroundColor", "backgroundImageAssetId",
                   "backgroundPosition", "padding", "fullWidth", "roundedTop", "roundedBottom"],
      "properties": {
        "backgroundColor": { "$ref": "#/$defs/colorRefOrNull" },
        "outerBackgroundColor": { "$ref": "#/$defs/colorRefOrNull" },
        "backgroundImageAssetId": { "oneOf": [{ "$ref": "#/$defs/uuid" }, { "type": "null" }] },
        "backgroundPosition": { "enum": ["top", "center", "bottom"] },
        "padding": { "$ref": "#/$defs/padding" },
        "fullWidth": { "type": "boolean" },
        "roundedTop": { "type": "boolean" },
        "roundedBottom": { "type": "boolean" }
      }
    },
    "sectionBlock": {
      "type": "object", "additionalProperties": false,
      "required": ["id", "type", "props", "children"],
      "properties": {
        "id": { "$ref": "#/$defs/blockId" },
        "type": { "const": "section" },
        "props": { "$ref": "#/$defs/sectionProps" },
        "visibleWhen": { "$ref": "#/$defs/visibleWhen" },
        "children": {
          "type": "array", "maxItems": 40,
          "items": {
            "anyOf": [
              { "$ref": "#/$defs/columnsBlock" },
              { "$ref": "#/$defs/repeatBlock" },
              { "$ref": "#/$defs/contentBlock" },
              { "$ref": "#/$defs/unknownBlock" }
            ]
          }
        }
      }
    },
    "columnsBlock": {
      "type": "object", "additionalProperties": false,
      "required": ["id", "type", "props", "children"],
      "properties": {
        "id": { "$ref": "#/$defs/blockId" },
        "type": { "const": "columns" },
        "props": {
          "type": "object", "additionalProperties": false,
          "required": ["layout", "gap", "stackOnMobile", "stackOrder", "verticalAlign"],
          "properties": {
            "layout": { "enum": ["1-1", "1-2", "2-1", "1-1-1", "2-1-1", "1-1-2"] },
            "gap": { "type": "integer", "minimum": 0, "maximum": 48 },
            "stackOnMobile": { "type": "boolean" },
            "stackOrder": { "enum": ["normal", "reverse"] },
            "verticalAlign": { "enum": ["top", "middle", "bottom"] }
          }
        },
        "children": {
          "type": "array", "minItems": 2, "maxItems": 3,
          "items": { "$ref": "#/$defs/columnBlock" }
        }
      }
    },
    "columnBlock": {
      "$comment": "column nemá visibleWhen ani hideOnMobile, skrytí sloupce rozbije šířky v Outlooku.",
      "type": "object", "additionalProperties": false,
      "required": ["id", "type", "props", "children"],
      "properties": {
        "id": { "$ref": "#/$defs/blockId" },
        "type": { "const": "column" },
        "props": {
          "type": "object", "additionalProperties": false,
          "required": ["padding", "backgroundColor", "borderRadius"],
          "properties": {
            "padding": { "$ref": "#/$defs/padding" },
            "backgroundColor": { "$ref": "#/$defs/colorRefOrNull" },
            "borderRadius": { "type": "integer", "minimum": 0, "maximum": 32 }
          }
        },
        "children": {
          "type": "array", "maxItems": 20,
          "items": {
            "anyOf": [{ "$ref": "#/$defs/contentBlock" }, { "$ref": "#/$defs/unknownBlock" }]
          }
        }
      }
    },
    "repeatBlock": {
      "type": "object", "additionalProperties": false,
      "required": ["id", "type", "props", "children"],
      "properties": {
        "id": { "$ref": "#/$defs/blockId" },
        "type": { "const": "repeat" },
        "visibleWhen": { "$ref": "#/$defs/visibleWhen" },
        "props": {
          "type": "object", "additionalProperties": false,
          "required": ["padding", "backgroundColor", "hideOnMobile", "path"],
          "properties": {
            "padding": { "$ref": "#/$defs/padding" },
            "backgroundColor": { "$ref": "#/$defs/colorRefOrNull" },
            "hideOnMobile": { "type": "boolean" },
            "path": { "type": "string", "maxLength": 120 }
          }
        },
        "children": {
          "type": "array", "maxItems": 20,
          "items": {
            "anyOf": [{ "$ref": "#/$defs/contentBlock" }, { "$ref": "#/$defs/unknownBlock" }]
          }
        }
      }
    },
    "contentBlock": {
      "anyOf": [
        { "$ref": "#/$defs/headingBlock" }, { "$ref": "#/$defs/textBlock" },
        { "$ref": "#/$defs/imageBlock" }, { "$ref": "#/$defs/buttonBlock" },
        { "$ref": "#/$defs/dividerBlock" }, { "$ref": "#/$defs/spacerBlock" },
        { "$ref": "#/$defs/htmlBlock" }, { "$ref": "#/$defs/socialBlock" },
        { "$ref": "#/$defs/footerBlock" }
      ]
    },
    "headingBlock": {
      "type": "object", "additionalProperties": false,
      "required": ["id", "type", "props"],
      "properties": {
        "id": { "$ref": "#/$defs/blockId" }, "type": { "const": "heading" },
        "visibleWhen": { "$ref": "#/$defs/visibleWhen" },
        "props": {
          "type": "object", "additionalProperties": false,
          "required": ["padding", "backgroundColor", "hideOnMobile", "level", "content",
                       "color", "align", "fontFamily", "fontSize", "fontWeight",
                       "lineHeight", "letterSpacing"],
          "properties": {
            "padding": { "$ref": "#/$defs/padding" },
            "backgroundColor": { "$ref": "#/$defs/colorRefOrNull" },
            "hideOnMobile": { "type": "boolean" },
            "level": { "enum": [1, 2, 3] },
            "content": { "$ref": "#/$defs/richText" },
            "color": { "$ref": "#/$defs/colorRef" },
            "align": { "enum": ["left", "center", "right"] },
            "fontFamily": { "oneOf": [{ "$ref": "#/$defs/fontStackId" }, { "type": "null" }] },
            "fontSize": { "oneOf": [{ "type": "integer", "minimum": 12, "maximum": 48 }, { "type": "null" }] },
            "fontWeight": { "enum": [400, 600, 700] },
            "lineHeight": { "oneOf": [{ "type": "number", "minimum": 1, "maximum": 2 }, { "type": "null" }] },
            "letterSpacing": { "type": "number", "minimum": -1, "maximum": 4 }
          }
        }
      }
    },
    "textBlock": {
      "type": "object", "additionalProperties": false,
      "required": ["id", "type", "props"],
      "properties": {
        "id": { "$ref": "#/$defs/blockId" }, "type": { "const": "text" },
        "visibleWhen": { "$ref": "#/$defs/visibleWhen" },
        "props": {
          "type": "object", "additionalProperties": false,
          "required": ["padding", "backgroundColor", "hideOnMobile", "content", "color",
                       "linkColor", "align", "fontFamily", "fontSize", "lineHeight"],
          "properties": {
            "padding": { "$ref": "#/$defs/padding" },
            "backgroundColor": { "$ref": "#/$defs/colorRefOrNull" },
            "hideOnMobile": { "type": "boolean" },
            "content": { "$ref": "#/$defs/richText" },
            "color": { "$ref": "#/$defs/colorRef" },
            "linkColor": { "$ref": "#/$defs/colorRef" },
            "align": { "enum": ["left", "center", "right", "justify"] },
            "fontFamily": { "oneOf": [{ "$ref": "#/$defs/fontStackId" }, { "type": "null" }] },
            "fontSize": { "oneOf": [{ "type": "integer", "minimum": 10, "maximum": 32 }, { "type": "null" }] },
            "lineHeight": { "oneOf": [{ "type": "number", "minimum": 1, "maximum": 2.5 }, { "type": "null" }] }
          }
        }
      }
    },
    "imageBlock": {
      "type": "object", "additionalProperties": false,
      "required": ["id", "type", "props"],
      "properties": {
        "id": { "$ref": "#/$defs/blockId" }, "type": { "const": "image" },
        "visibleWhen": { "$ref": "#/$defs/visibleWhen" },
        "props": {
          "type": "object", "additionalProperties": false,
          "required": ["padding", "backgroundColor", "hideOnMobile", "assetId", "alt",
                       "decorative", "width", "align", "href", "trackable",
                       "borderRadius", "darkVariantAssetId"],
          "properties": {
            "padding": { "$ref": "#/$defs/padding" },
            "backgroundColor": { "$ref": "#/$defs/colorRefOrNull" },
            "hideOnMobile": { "type": "boolean" },
            "assetId": { "$ref": "#/$defs/uuid" },
            "alt": { "type": "string", "maxLength": 200 },
            "decorative": { "type": "boolean" },
            "width": { "oneOf": [{ "const": "full" }, { "type": "integer", "minimum": 20, "maximum": 640 }] },
            "align": { "enum": ["left", "center", "right"] },
            "href": { "oneOf": [{ "type": "string", "maxLength": 2000 }, { "type": "null" }] },
            "trackable": { "type": "boolean" },
            "borderRadius": { "oneOf": [{ "type": "integer", "minimum": 0, "maximum": 32 }, { "type": "null" }] },
            "darkVariantAssetId": { "oneOf": [{ "$ref": "#/$defs/uuid" }, { "type": "null" }] }
          }
        }
      }
    },
    "buttonBlock": {
      "type": "object", "additionalProperties": false,
      "required": ["id", "type", "props"],
      "properties": {
        "id": { "$ref": "#/$defs/blockId" }, "type": { "const": "button" },
        "visibleWhen": { "$ref": "#/$defs/visibleWhen" },
        "props": {
          "type": "object", "additionalProperties": false,
          "required": ["padding", "backgroundColor", "hideOnMobile", "label", "href",
                       "trackable", "style", "textColor", "borderColor", "borderWidth",
                       "borderRadius", "fullWidth", "align", "paddingX", "paddingY", "fontSize"],
          "properties": {
            "padding": { "$ref": "#/$defs/padding" },
            "backgroundColor": { "$ref": "#/$defs/colorRef" },
            "hideOnMobile": { "type": "boolean" },
            "label": { "$ref": "#/$defs/richText" },
            "href": { "type": "string", "minLength": 1, "maxLength": 2000 },
            "trackable": { "type": "boolean" },
            "style": { "enum": ["solid", "outline"] },
            "textColor": { "$ref": "#/$defs/colorRef" },
            "borderColor": { "$ref": "#/$defs/colorRefOrNull" },
            "borderWidth": { "enum": [0, 1, 2] },
            "borderRadius": { "oneOf": [{ "type": "integer", "minimum": 0, "maximum": 32 }, { "type": "null" }] },
            "fullWidth": { "type": "boolean" },
            "align": { "enum": ["left", "center", "right"] },
            "paddingX": { "type": "integer", "minimum": 8, "maximum": 48 },
            "paddingY": { "type": "integer", "minimum": 8, "maximum": 48 },
            "fontSize": { "type": "integer", "minimum": 12, "maximum": 24 }
          }
        }
      }
    },
    "dividerBlock": {
      "type": "object", "additionalProperties": false,
      "required": ["id", "type", "props"],
      "properties": {
        "id": { "$ref": "#/$defs/blockId" }, "type": { "const": "divider" },
        "visibleWhen": { "$ref": "#/$defs/visibleWhen" },
        "props": {
          "type": "object", "additionalProperties": false,
          "required": ["padding", "backgroundColor", "hideOnMobile", "color", "thickness",
                       "style", "width", "align"],
          "properties": {
            "padding": { "$ref": "#/$defs/padding" },
            "backgroundColor": { "$ref": "#/$defs/colorRefOrNull" },
            "hideOnMobile": { "type": "boolean" },
            "color": { "$ref": "#/$defs/colorRef" },
            "thickness": { "enum": [1, 2, 3, 4] },
            "style": { "enum": ["solid", "dashed", "dotted"] },
            "width": { "type": "integer", "minimum": 10, "maximum": 100 },
            "align": { "enum": ["left", "center", "right"] }
          }
        }
      }
    },
    "spacerBlock": {
      "type": "object", "additionalProperties": false,
      "required": ["id", "type", "props"],
      "properties": {
        "id": { "$ref": "#/$defs/blockId" }, "type": { "const": "spacer" },
        "visibleWhen": { "$ref": "#/$defs/visibleWhen" },
        "props": {
          "type": "object", "additionalProperties": false,
          "required": ["padding", "backgroundColor", "hideOnMobile", "height", "heightMobile"],
          "properties": {
            "padding": { "$ref": "#/$defs/padding" },
            "backgroundColor": { "$ref": "#/$defs/colorRefOrNull" },
            "hideOnMobile": { "type": "boolean" },
            "height": { "type": "integer", "minimum": 4, "maximum": 120 },
            "heightMobile": { "oneOf": [{ "type": "integer", "minimum": 4, "maximum": 120 }, { "type": "null" }] }
          }
        }
      }
    },
    "htmlBlock": {
      "type": "object", "additionalProperties": false,
      "required": ["id", "type", "props"],
      "properties": {
        "id": { "$ref": "#/$defs/blockId" }, "type": { "const": "html" },
        "visibleWhen": { "$ref": "#/$defs/visibleWhen" },
        "props": {
          "type": "object", "additionalProperties": false,
          "required": ["padding", "backgroundColor", "hideOnMobile", "code"],
          "properties": {
            "padding": { "$ref": "#/$defs/padding" },
            "backgroundColor": { "$ref": "#/$defs/colorRefOrNull" },
            "hideOnMobile": { "type": "boolean" },
            "code": { "type": "string", "maxLength": 20000 }
          }
        }
      }
    },
    "socialBlock": {
      "type": "object", "additionalProperties": false,
      "required": ["id", "type", "props"],
      "properties": {
        "id": { "$ref": "#/$defs/blockId" }, "type": { "const": "social" },
        "visibleWhen": { "$ref": "#/$defs/visibleWhen" },
        "props": {
          "type": "object", "additionalProperties": false,
          "required": ["padding", "backgroundColor", "hideOnMobile", "items", "iconStyle",
                       "iconSize", "gap", "align"],
          "properties": {
            "padding": { "$ref": "#/$defs/padding" },
            "backgroundColor": { "$ref": "#/$defs/colorRefOrNull" },
            "hideOnMobile": { "type": "boolean" },
            "items": {
              "type": "array", "maxItems": 8,
              "items": {
                "$comment": "network je otevřený řetězec, ne enum. Neznámou síť renderer vynechá s varováním, aby starší instalace nespadla na novějším dokumentu (3.2.11).",
                "type": "object", "additionalProperties": false, "required": ["network", "href"],
                "properties": {
                  "network": { "type": "string", "pattern": "^[a-z][a-z0-9_]{0,31}$" },
                  "href": { "type": "string", "maxLength": 2000 },
                  "label": { "type": "string", "maxLength": 60 }
                }
              }
            },
            "iconStyle": { "enum": ["color", "mono_dark", "mono_light"] },
            "iconSize": { "type": "integer", "minimum": 16, "maximum": 48 },
            "gap": { "type": "integer", "minimum": 0, "maximum": 32 },
            "align": { "enum": ["left", "center", "right"] }
          }
        }
      }
    },
    "footerBlock": {
      "$comment": "footer nemá visibleWhen, patičku nejde podmínit (pravidlo S14).",
      "type": "object", "additionalProperties": false,
      "required": ["id", "type", "props"],
      "properties": {
        "id": { "$ref": "#/$defs/blockId" }, "type": { "const": "footer" },
        "props": {
          "type": "object", "additionalProperties": false,
          "required": ["padding", "backgroundColor", "hideOnMobile", "senderInfo",
                       "showUnsubscribe", "unsubscribeLabel", "showPreferences",
                       "preferencesLabel", "showWebview", "webviewLabel", "fontSize", "color"],
          "properties": {
            "padding": { "$ref": "#/$defs/padding" },
            "backgroundColor": { "$ref": "#/$defs/colorRefOrNull" },
            "hideOnMobile": { "type": "boolean" },
            "senderInfo": { "$ref": "#/$defs/richText" },
            "showUnsubscribe": { "type": "boolean" },
            "unsubscribeLabel": { "type": "string", "maxLength": 60 },
            "showPreferences": { "type": "boolean" },
            "preferencesLabel": { "type": "string", "maxLength": 60 },
            "showWebview": { "type": "boolean" },
            "webviewLabel": { "type": "string", "maxLength": 60 },
            "fontSize": { "type": "integer", "minimum": 10, "maximum": 16 },
            "color": { "$ref": "#/$defs/colorRef" }
          }
        }
      }
    }
  }
}
```

- [ ] **Step 4: Napiš `packages/emails/src/document/schema.ts`**

```ts
import Ajv2020, { type ErrorObject, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import schema from "../../schema/document.v1.schema.json" with { type: "json" };

export type SchemaIssue = { pointer: string; code: string; message: string };
export type SchemaResult = { ok: true } | { ok: false; issues: SchemaIssue[] };

const ajv = new Ajv2020({ strict: true, allErrors: true, removeAdditional: false });
addFormats(ajv, ["uuid", "uri", "email"]);

const validate: ValidateFunction = ajv.compile(schema);

/** Sloučí chyby z anyOf větví na jednu srozumitelnou. Bez toho editor dostane devět hlášek na blok. */
function toIssue(error: ErrorObject): SchemaIssue {
  return {
    pointer: error.instancePath,
    code: `schema_${error.keyword}`,
    message: `${error.instancePath || "/"} ${error.message ?? "is invalid"}`,
  };
}

export function validateDocumentSchema(value: unknown): SchemaResult {
  if (validate(value)) return { ok: true };
  const errors = validate.errors ?? [];
  // Chyby uvnitř větve unknownBlock zahazujeme: když blok projde jako neznámý,
  // není chybou, že nevyhověl definici známého bloku.
  const meaningful = errors.filter((e) => !e.schemaPath.includes("unknownBlock"));
  const source = meaningful.length > 0 ? meaningful : errors;
  const seen = new Set<string>();
  const issues: SchemaIssue[] = [];
  for (const error of source) {
    const issue = toIssue(error);
    const key = `${issue.pointer}|${issue.code}`;
    if (seen.has(key)) continue;
    seen.add(key);
    issues.push(issue);
  }
  return { ok: false, issues };
}

export const DOCUMENT_SCHEMA = schema;
```

- [ ] **Step 5: Spusť test a ověř, že projde**

Run: `pnpm vitest run packages/emails/test/document/schema.test.ts`
Expected: PASS, 8 testů. Kdyby test „accepts an unknown block type" padal, znamená to, že v `sectionBlock.children` je `oneOf` místo `anyOf`; s `oneOf` vyhoví neznámý blok dvěma větvím a validace spadne.

- [ ] **Step 6: Commit**

```bash
git add packages/emails/schema packages/emails/src/document/schema.ts packages/emails/test/document/schema.test.ts
git commit -m "feat(emails): json schema for document v1 and ajv validation"
```

---

### Task 7: Migrace schématu a načtení dokumentu

**Files:**
- Create: `packages/emails/src/document/migrate.ts`
- Test: `packages/emails/test/document/migrate.test.ts`

Kritéria 3 a 4. Migrace se aplikují **při načtení**, do databáze se zapíšou až když uživatel uloží. Hromadná migrace celé databáze při upgradu je u self-hosted nasazení nejrizikovější operace, jakou máme. Zpětné migrace neexistují, je to vědomé rozhodnutí.

- [ ] **Step 1: Napiš padající test**

`packages/emails/test/document/migrate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_THEME } from "../../src/document/defaults.js";
import { DocumentSchemaTooNewError, loadDocument, MIGRATIONS } from "../../src/document/migrate.js";

const doc = (version: number) => ({
  schemaVersion: version,
  meta: { name: "T", previewText: "", language: "cs" },
  theme: DEFAULT_THEME,
  blocks: [],
});

describe("loadDocument", () => {
  it("returns the current version untouched", () => {
    const input = doc(1);
    expect(loadDocument(input)).toEqual(input);
  });

  it("throws a typed error for a newer schema version", () => {
    expect(() => loadDocument(doc(2))).toThrow(DocumentSchemaTooNewError);
    try {
      loadDocument(doc(3));
    } catch (error) {
      expect((error as DocumentSchemaTooNewError).code).toBe("template_schema_too_new");
      expect((error as DocumentSchemaTooNewError).documentVersion).toBe(3);
      expect((error as DocumentSchemaTooNewError).supportedVersion).toBe(1);
    }
  });

  it("rejects a value that is not an object with a numeric schemaVersion", () => {
    expect(() => loadDocument(null)).toThrow(/schemaVersion/);
    expect(() => loadDocument({ schemaVersion: "1" })).toThrow(/schemaVersion/);
  });

  it("has no migrations yet and they form a contiguous chain when added", () => {
    let expected = 1;
    for (const migration of MIGRATIONS) {
      expect(migration.from).toBe(expected);
      expect(migration.to).toBe(expected + 1);
      expected += 1;
    }
  });

  it("does not mutate its input", () => {
    const input = doc(1);
    const copy = structuredClone(input);
    loadDocument(input);
    expect(input).toEqual(copy);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm vitest run packages/emails/test/document/migrate.test.ts`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napiš implementaci**

`packages/emails/src/document/migrate.ts`:

```ts
import { CURRENT_SCHEMA_VERSION, type Document } from "./types.js";

export type Migration = { from: number; to: number; apply: (doc: unknown) => unknown };

/**
 * Řetězí se od nejnižší verze. Zpětné migrace neexistují: obousměrné migrace jsou
 * dvakrát tolik kódu a testují se prakticky nikdy (3.1.7).
 */
export const MIGRATIONS: Migration[] = [];

export class DocumentSchemaTooNewError extends Error {
  readonly code = "template_schema_too_new";
  constructor(readonly documentVersion: number, readonly supportedVersion: number) {
    super(
      `Document schema version ${documentVersion} is newer than the supported version ${supportedVersion}.`,
    );
    this.name = "DocumentSchemaTooNewError";
  }
}

export class DocumentMigrationError extends Error {
  readonly code = "template_document_invalid";
  constructor(message: string) {
    super(message);
    this.name = "DocumentMigrationError";
  }
}

export function loadDocument(raw: unknown): Document {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new DocumentMigrationError("Document must be an object with a numeric schemaVersion.");
  }
  const version = (raw as { schemaVersion?: unknown }).schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 1) {
    throw new DocumentMigrationError("Document must be an object with a numeric schemaVersion.");
  }
  if (version > CURRENT_SCHEMA_VERSION) {
    throw new DocumentSchemaTooNewError(version, CURRENT_SCHEMA_VERSION);
  }
  let current: unknown = structuredClone(raw);
  let at = version;
  while (at < CURRENT_SCHEMA_VERSION) {
    const migration = MIGRATIONS.find((m) => m.from === at);
    if (!migration) {
      throw new DocumentMigrationError(`No migration registered from schema version ${at}.`);
    }
    current = migration.apply(current);
    at = migration.to;
  }
  return current as Document;
}
```

- [ ] **Step 4: Spusť test a ověř, že projde**

Run: `pnpm vitest run packages/emails/test/document/migrate.test.ts`
Expected: PASS, 5 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/emails/src/document/migrate.ts packages/emails/test/document/migrate.test.ts
git commit -m "feat(emails): schema version migration chain"
```

---

### Task 8: Šířky sloupců

**Files:**
- Create: `packages/emails/src/normalize/columns.ts`
- Test: `packages/emails/test/normalize/columns.test.ts`

Outlook ignoruje `max-width` a procenta počítá jinak, takže každý `<td>` musí mít **pixelovou** šířku a součet musí sedět na pixel. Zaokrouhlování se proto sbírá do posledního sloupce.

- [ ] **Step 1: Napiš padající test**

`packages/emails/test/normalize/columns.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { COLUMN_RATIOS, columnWidths } from "../../src/normalize/columns.js";

describe("columnWidths", () => {
  it("splits a 600px section without padding evenly", () => {
    expect(columnWidths("1-1", 0, 600)).toEqual([300, 300]);
  });

  it("subtracts the gap before applying ratios", () => {
    expect(columnWidths("1-1", 16, 600)).toEqual([292, 292]);
  });

  it("gives the remainder to the last column so the sum is exact", () => {
    const widths = columnWidths("1-1-1", 16, 600);
    expect(widths).toHaveLength(3);
    expect(widths.reduce((a, b) => a + b, 0) + 32).toBe(600);
  });

  it("applies the documented ratios", () => {
    expect(columnWidths("1-2", 0, 600)).toEqual([200, 400]);
    expect(columnWidths("2-1", 0, 600)).toEqual([400, 200]);
    expect(columnWidths("2-1-1", 0, 600)).toEqual([300, 150, 150]);
    expect(columnWidths("1-1-2", 0, 600)).toEqual([150, 150, 300]);
  });

  it("never returns a width below one pixel", () => {
    expect(columnWidths("1-1-1", 48, 200).every((w) => w >= 1)).toBe(true);
  });

  it("declares two or three ratios for every layout", () => {
    for (const [layout, ratios] of Object.entries(COLUMN_RATIOS)) {
      expect(ratios.length, layout).toBeGreaterThanOrEqual(2);
      expect(ratios.length, layout).toBeLessThanOrEqual(3);
    }
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm vitest run packages/emails/test/normalize/columns.test.ts`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napiš implementaci**

`packages/emails/src/normalize/columns.ts`:

```ts
import type { ColumnsLayout } from "../document/types.js";

export const COLUMN_RATIOS: Record<ColumnsLayout, number[]> = {
  "1-1": [1, 1],
  "1-2": [1, 2],
  "2-1": [2, 1],
  "1-1-1": [1, 1, 1],
  "2-1-1": [2, 1, 1],
  "1-1-2": [1, 1, 2],
};

/**
 * Pixelové šířky sloupců. `innerWidth` je šířka obsahové oblasti sekce,
 * tedy contentWidth minus vodorovné odsazení sekce.
 * Zaokrouhlovací zbytek dostane poslední sloupec, aby součet seděl na pixel:
 * Outlook s procenty a max-width nepracuje a rozdíl jednoho pixelu mu rozhodí řádek.
 */
export function columnWidths(layout: ColumnsLayout, gap: number, innerWidth: number): number[] {
  const ratios = COLUMN_RATIOS[layout];
  const available = Math.max(ratios.length, innerWidth - gap * (ratios.length - 1));
  const total = ratios.reduce((a, b) => a + b, 0);
  const widths = ratios.map((ratio) => Math.max(1, Math.floor((available * ratio) / total)));
  const used = widths.reduce((a, b) => a + b, 0);
  widths[widths.length - 1] = Math.max(1, widths[widths.length - 1]! + (available - used));
  return widths;
}

export function columnCount(layout: ColumnsLayout): number {
  return COLUMN_RATIOS[layout].length;
}
```

- [ ] **Step 4: Spusť test a ověř, že projde**

Run: `pnpm vitest run packages/emails/test/normalize/columns.test.ts`
Expected: PASS, 6 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/emails/src/normalize/columns.ts packages/emails/test/normalize/columns.test.ts
git commit -m "feat(emails): pixel exact column widths"
```

---

### Task 9: Sémantická pravidla, strukturální část

**Files:**
- Create: `packages/emails/src/issue.ts`
- Create: `packages/emails/src/paths.ts`
- Create: `packages/emails/src/document/semantic-structure.ts`
- Test: `packages/emails/test/issue.test.ts`
- Test: `packages/emails/test/document/semantic-structure.test.ts`

Pravidla S1, S2, S3, S5, S10, S14, S15 plus S16 (vyhrazené značky) a pravidla o odkazech ze 3.1.5 a 4.1.4. Všechno, co jde rozhodnout **bez** katalogu polí a bez Liquid parseru, aby se to dalo testovat samostatně.

**Nejdřív ale dva malé soubory, které si tenhle plán musí vlastnit sám.** Kontrakty **nemají** typ `Issue`, mají `LiquidIssue` s polem `span` (znaková pozice ve zdrojovém řetězci) a bez `path`. Kontrakty taky nemají `toCatalogPath` ani zúžení katalogu na `LiquidRoots`. Dřívější znění tohohle plánu si obojí importovalo z `@mlain/contracts`, jenže tam to není a **kořenový export je navíc zrušený**, takže by build spadl na první řadě. Obojí je tedy tady.

- [ ] **Step 0: Napiš `packages/emails/src/issue.ts` a `packages/emails/src/paths.ts`**

`packages/emails/src/issue.ts`:

```ts
import type { LiquidIssue } from "@mlain/contracts/liquid";

/**
 * Nález na dokumentu. Vlastní ho tenhle balíček, protože ho vydává jak
 * validátor dokumentu, tak kompilace, tak předodesílací kontrola.
 *
 * Není to `LiquidIssue` z kontraktů: ten nese `span`, tedy znakovou pozici
 * uvnitř JEDNOHO Liquid výrazu, a o dokumentu nic neví. Tady potřebujeme
 * ukazatel na uzel dokumentu, protože hlášku zobrazuje editor u bloku.
 */
export type Issue = {
  code: string;
  severity: "error" | "warning" | "info";
  /** JSON Pointer na uzel dokumentu, například `/blocks/0/children/1/props/alt`. */
  pointer: string;
  /** Tečková cesta pro obálku API. Odvozená z `pointer`, viz `pointerToDotted`. */
  path?: string;
  params?: Record<string, string | number>;
};

/**
 * Převod nálezu z Liquid validátoru na nález na dokumentu. `span` se zahazuje
 * schválně: ukazuje do řetězce výrazu, ne do dokumentu, a kdyby se protáhl dál,
 * editor by ho spletl s pozicí v dokumentu.
 */
export function fromLiquidIssue(found: LiquidIssue, pointer: string, path: string): Issue {
  return {
    code: found.code,
    severity: found.severity,
    pointer,
    path,
    params: found.params,
  };
}

export function hasBlockingIssue(issues: readonly Issue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}
```

`packages/emails/src/paths.ts`:

```ts
import type { LiquidRoots } from "@mlain/contracts/liquid";
import type { FieldCatalog } from "@mlain/core/contacts/fields/catalog";
import type { RenderSchema } from "./compile/types.js";

/**
 * Cesta v šabloně na cestu v katalogu polí. Katalog vlastní P07 a jeho
 * `FieldCatalogEntry.path` je BEZ prefixu `contact.` (požadavek R9), kdežto
 * v šabloně se píše `{{ contact.attr.city }}`.
 */
export function toCatalogPath(path: string): string {
  return path.startsWith("contact.") ? path.slice("contact.".length) : path;
}

/** Opačný směr: cesta v katalogu na merge tag, který se píše do šablony. */
export function toMergePath(catalogPath: string): string {
  return `contact.${catalogPath}`;
}

/**
 * Zúžení bohatého katalogu na úzký tvar, který chce Liquid validátor.
 * Jsou to dva různé typy: `FieldCatalog` má cesty, typy a popisky a vlastní ho
 * P07, `LiquidRoots` je jen seznam povolených kořenů a vlastní ho kontrakt.
 * Dřív se obojí jmenovalo `FieldCatalog` (rozhodnutí R2), takže tenhle převod
 * je jediné místo, kde se ta dvě jména potkávají, a nikdy se nepřetypovává.
 */
export function toLiquidRoots(catalog: FieldCatalog): LiquidRoots {
  const contactFirstClass: string[] = [];
  const contactAttrKeys: string[] = [];
  for (const field of catalog.fields) {
    if (field.path.startsWith("attr.")) contactAttrKeys.push(field.path.slice("attr.".length));
    else contactFirstClass.push(field.path);
  }
  return { contactFirstClass, contactAttrKeys };
}

/**
 * Zúžení `RenderSchema` na tvar, který chce `prepareRenderData` z kontraktů.
 * Kontrakt používá pro svůj úzký tvar bohužel TOTÉŽ jméno `RenderSchema`,
 * takže bez tohohle převodu by se přiřazení buď nezkompilovalo, nebo by ho
 * někdo protlačil přetypováním a ztratil kontrolu úplně.
 */
export function toPreparedSchema(
  schema: RenderSchema,
): { fields: readonly string[]; presence: readonly string[] } {
  return { fields: schema.fields.map((field) => field.path), presence: schema.presence };
}
```

`packages/emails/test/issue.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { fromLiquidIssue, hasBlockingIssue } from "../src/issue.js";
import { toCatalogPath, toLiquidRoots, toMergePath, toPreparedSchema } from "../src/paths.js";

describe("issue and path helpers", () => {
  it("drops the liquid span and keeps the document pointer", () => {
    const issue = fromLiquidIssue(
      { code: "liquid_unknown_field", severity: "error", span: { start: 3, end: 9, line: 1, col: 4 } },
      "/blocks/0/props/content/0/children/0/expr",
      "blocks.0.props.content.0.children.0.expr",
    );
    expect(issue).toEqual({
      code: "liquid_unknown_field",
      severity: "error",
      pointer: "/blocks/0/props/content/0/children/0/expr",
      path: "blocks.0.props.content.0.children.0.expr",
      params: undefined,
    });
    expect("span" in issue).toBe(false);
  });

  it("treats only errors as blocking", () => {
    expect(hasBlockingIssue([{ code: "a", severity: "warning", pointer: "" }])).toBe(false);
    expect(hasBlockingIssue([{ code: "a", severity: "error", pointer: "" }])).toBe(true);
  });

  it("converts between template paths and catalog paths", () => {
    expect(toCatalogPath("contact.attr.city")).toBe("attr.city");
    expect(toCatalogPath("contact.first_name")).toBe("first_name");
    expect(toCatalogPath("workspace.sender_address")).toBe("workspace.sender_address");
    expect(toMergePath("attr.city")).toBe("contact.attr.city");
  });

  it("narrows the rich catalog to the liquid roots without casting", () => {
    expect(toLiquidRoots({
      version: "v1",
      fields: [
        { path: "first_name", type: "string", label: { en: "First name" }, group: "name", deleted: false },
        { path: "attr.city", type: "string", label: { en: "City" }, group: "custom", deleted: false },
      ],
    })).toEqual({ contactFirstClass: ["first_name"], contactAttrKeys: ["city"] });
  });

  it("narrows the render schema to what prepareRenderData wants", () => {
    expect(toPreparedSchema({
      version: 1,
      fields: [{ path: "contact.first_name", type: "string", required: false }],
      systemTags: ["unsubscribe_url"],
      presence: ["contact.attr.city"],
      loops: [],
    })).toEqual({ fields: ["contact.first_name"], presence: ["contact.attr.city"] });
  });
});
```

Run: `pnpm vitest run packages/emails/test/issue.test.ts`
Expected: PASS, 5 testů.

**Pozor na odkaz s proměnnou.** Rozhodnutí, které tenhle plán dělá a které usmiřuje 3.1.5 s 3.4.2 části 5: kód se jmenuje `liquid_in_trackable_href`, tedy chyba je to jen tehdy, když je odkaz **trackovatelný**. Autor, který u odkazu tracking vypne (`trackable: false`), smí mít v `href` proměnnou; kompilace ho pak netrackuje a zapíše varování `link_variable_not_tracked`, aby se nikdo nedivil, že odkaz chybí v reportu. Fixture `CT-012` zůstává v platnosti, protože testuje výchozí stav, kdy je `trackable` true.

- [ ] **Step 1: Napiš padající test**

`packages/emails/test/document/semantic-structure.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { blockDefaults, DEFAULT_THEME } from "../../src/document/defaults.js";
import type { Document, SectionBlock } from "../../src/document/types.js";
import { checkStructure } from "../../src/document/semantic-structure.js";

const section = (id: string, children: unknown[] = []): SectionBlock =>
  ({ id, type: "section", props: blockDefaults("section"), children } as SectionBlock);

const docOf = (blocks: SectionBlock[]): Document => ({
  schemaVersion: 1,
  meta: { name: "T", previewText: "", language: "cs" },
  theme: DEFAULT_THEME,
  blocks,
});

const codes = (doc: Document, kind: "campaign" | "transactional" | "system" = "campaign") =>
  checkStructure(doc, { templateKind: kind }).map((i) => i.code);

describe("structural semantics", () => {
  it("S1 reports duplicate block ids and points at the second occurrence", () => {
    const doc = docOf([section("b_000000000001"), section("b_000000000001")]);
    const issues = checkStructure(doc, { templateKind: "campaign" });
    const duplicate = issues.find((i) => i.code === "content_duplicate_block_id");
    expect(duplicate).toBeDefined();
    expect(duplicate!.pointer).toBe("/blocks/1");
  });

  it("S2 rejects columns nested inside a column", () => {
    const inner = {
      id: "b_000000000003", type: "columns", props: blockDefaults("columns"),
      children: [
        { id: "b_000000000004", type: "column", props: blockDefaults("column"), children: [] },
        { id: "b_000000000005", type: "column", props: blockDefaults("column"), children: [] },
      ],
    };
    const outer = {
      id: "b_000000000002", type: "columns", props: blockDefaults("columns"),
      children: [
        { id: "b_000000000006", type: "column", props: blockDefaults("column"), children: [inner] },
        { id: "b_000000000007", type: "column", props: blockDefaults("column"), children: [] },
      ],
    };
    expect(codes(docOf([section("b_000000000001", [outer])]))).toContain("content_nested_columns");
  });

  it("S3 allows one footer and rejects two", () => {
    const footer = (id: string) => ({ id, type: "footer", props: blockDefaults("footer") });
    expect(codes(docOf([section("b_000000000001", [footer("b_000000000002")])])))
      .not.toContain("content_duplicate_footer");
    expect(codes(docOf([section("b_000000000001", [footer("b_000000000002"), footer("b_000000000003")])])))
      .toContain("content_duplicate_footer");
  });

  it("S5 reports padding wider than the column minus forty pixels", () => {
    const text = {
      id: "b_000000000004", type: "text",
      props: { ...blockDefaults("text"), padding: { top: 0, right: 100, bottom: 0, left: 100 } },
    };
    const columns = {
      id: "b_000000000002", type: "columns",
      props: { ...blockDefaults("columns"), layout: "1-1-1" as const },
      children: [
        { id: "b_000000000003", type: "column", props: blockDefaults("column"), children: [text] },
        { id: "b_000000000005", type: "column", props: blockDefaults("column"), children: [] },
        { id: "b_000000000006", type: "column", props: blockDefaults("column"), children: [] },
      ],
    };
    expect(codes(docOf([section("b_000000000001", [columns])]))).toContain("content_padding_overflow");
  });

  it("S10 rejects the html block in a system template", () => {
    const html = { id: "b_000000000002", type: "html", props: { ...blockDefaults("html"), code: "<b>x</b>" } };
    expect(codes(docOf([section("b_000000000001", [html])]), "system"))
      .toContain("content_raw_html_forbidden");
    expect(codes(docOf([section("b_000000000001", [html])]), "campaign"))
      .not.toContain("content_raw_html_forbidden");
  });

  it("S15 rejects a repeat inside a repeat", () => {
    const inner = { id: "b_000000000003", type: "repeat", props: blockDefaults("repeat"), children: [] };
    const outer = { id: "b_000000000002", type: "repeat", props: blockDefaults("repeat"), children: [inner] };
    expect(codes(docOf([section("b_000000000001", [outer])]))).toContain("content_nested_repeat");
  });

  it("S16 rejects every reserved marker in user text, case insensitive", () => {
    for (const marker of ["mlain.invalid", "ML_OPEN_PIXEL", "ML_ARG_0007", "ml_raw_ab12cd34ef_0001"]) {
      const text = {
        id: "b_000000000002", type: "text",
        props: { ...blockDefaults("text"), content: [{ t: "p", children: [{ t: "s", v: `x ${marker} y` }] }] },
      };
      expect(codes(docOf([section("b_000000000001", [text])])), marker)
        .toContain("content_reserved_marker");
    }
  });

  it("rejects forbidden link schemes", () => {
    const text = {
      id: "b_000000000002", type: "text",
      props: {
        ...blockDefaults("text"),
        content: [{ t: "p", children: [{ t: "a", href: "javascript:alert(1)", children: [] }] }],
      },
    };
    expect(codes(docOf([section("b_000000000001", [text])])))
      .toContain("content_link_scheme_forbidden");
  });

  it("rejects a variable inside a trackable href but allows it when tracking is off", () => {
    const link = (trackable: boolean) => ({
      id: "b_000000000002", type: "text",
      props: {
        ...blockDefaults("text"),
        content: [{
          t: "p",
          children: [{ t: "a", href: "https://shop.cz/?utm={{ campaign.name }}", trackable, children: [] }],
        }],
      },
    });
    expect(codes(docOf([section("b_000000000001", [link(true)])])))
      .toContain("liquid_in_trackable_href");
    const off = checkStructure(docOf([section("b_000000000001", [link(false)])]), { templateKind: "campaign" });
    expect(off.map((i) => i.code)).not.toContain("liquid_in_trackable_href");
    expect(off.find((i) => i.code === "link_variable_not_tracked")?.severity).toBe("warning");
  });

  it("accepts a system url tag as the whole href without tracking it", () => {
    const text = {
      id: "b_000000000002", type: "text",
      props: {
        ...blockDefaults("text"),
        content: [{ t: "p", children: [{ t: "a", href: "{{ unsubscribe_url }}", children: [] }] }],
      },
    };
    const issues = checkStructure(docOf([section("b_000000000001", [text])]), { templateKind: "campaign" });
    expect(issues.map((i) => i.code)).not.toContain("liquid_in_trackable_href");
    expect(issues.map((i) => i.code)).not.toContain("link_variable_not_tracked");
  });

  it("S14 rejects a visibility condition on the block carrying the only unsubscribe link", () => {
    const text = {
      id: "b_000000000002", type: "text",
      visibleWhen: { field: "contact.city", op: "present" },
      props: {
        ...blockDefaults("text"),
        content: [{ t: "p", children: [{ t: "a", href: "{{ unsubscribe_url }}", children: [] }] }],
      },
    };
    expect(codes(docOf([section("b_000000000001", [text])])))
      .toContain("content_condition_on_unsubscribe");
  });

  it("rejects an anchor only href", () => {
    const anchor = {
      id: "b_000000000002", type: "text",
      props: {
        ...blockDefaults("text"),
        content: [{ t: "p", children: [{ t: "a", href: "#", children: [] }] }],
      },
    };
    expect(codes(docOf([section("b_000000000001", [anchor])])))
      .toContain("content_link_anchor_only");
  });

  it("rejects a document above three hundred blocks", () => {
    const many = Array.from({ length: 40 }, (_, i) =>
      section(`b_a${String(i).padStart(11, "0")}`,
        Array.from({ length: 8 }, (_, j) => ({
          id: `b_b${String(i).padStart(5, "0")}${String(j).padStart(6, "0")}`,
          type: "spacer", props: blockDefaults("spacer"),
        }))));
    expect(codes(docOf(many))).toContain("content_too_many_blocks");
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm vitest run packages/emails/test/document/semantic-structure.test.ts`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napiš implementaci**

`packages/emails/src/document/semantic-structure.ts`:

```ts
import type { Issue } from "../issue.js";
import { columnWidths } from "../normalize/columns.js";
import {
  MAX_BLOCKS_PER_DOCUMENT, MAX_LINKS_PER_DOCUMENT,
  type ColumnsBlock, type Document, type InlineNode, type SectionBlock,
} from "./types.js";
import { pointerToDotted, richTextFieldsOf, walkBlocks, walkRichText } from "./walk.js";

export type StructureContext = { templateKind: "campaign" | "transactional" | "system" };

/**
 * Vyhrazené řetězce (4.1.5 plus raw slot z rozhodnutí D3).
 * Bez zákazu by si uživatel textem odklonil cizí náhradní hodnotu nebo vložil syrové HTML.
 */
export const RESERVED_MARKER_PATTERNS = [
  /mlain\.invalid/i,
  /ML_OPEN_PIXEL/i,
  /ML_ARG_/i,
  /ML_RAW_/i,
];

const SYSTEM_URL_TAG = /^\{\{\s*(unsubscribe_url|preferences_url|webview_url)\s*\}\}$/;
const HAS_LIQUID = /\{\{|\{%/;
const ALLOWED_SCHEMES = ["https:", "http:", "mailto:", "tel:"];

const issue = (
  code: string,
  severity: Issue["severity"],
  pointer: string,
  params?: Record<string, string | number>,
): Issue => ({ code, severity, pointer, path: pointerToDotted(pointer), params });

export function checkStructure(doc: Document, ctx: StructureContext): Issue[] {
  const issues: Issue[] = [];
  const seenIds = new Set<string>();
  let blockCount = 0;
  let footerCount = 0;
  let linkCount = 0;
  const unsubscribeCarriers: Array<{ pointer: string; conditional: boolean }> = [];

  for (const visit of walkBlocks(doc)) {
    const { block, pointer, depth, parent } = visit;
    blockCount += 1;

    // S1
    if (seenIds.has(block.id)) {
      issues.push(issue("content_duplicate_block_id", "error", pointer, { id: block.id }));
    } else {
      seenIds.add(block.id);
    }

    // S2
    if (block.type === "columns" && parent?.type === "column") {
      issues.push(issue("content_nested_columns", "error", pointer));
    }

    // S15
    if (block.type === "repeat" && parent?.type === "repeat") {
      issues.push(issue("content_nested_repeat", "error", pointer));
    }

    // S3
    if (block.type === "footer") {
      footerCount += 1;
      if (footerCount > 1) issues.push(issue("content_duplicate_footer", "error", pointer));
    }

    // S10
    if (block.type === "html" && ctx.templateKind === "system") {
      issues.push(issue("content_raw_html_forbidden", "error", pointer));
    }

    // S5. Přímo v sekci je dostupná šířka celá vnitřní šířka sekce,
    // uvnitř sloupce je to pixelová šířka sloupce minus jeho odsazení.
    const props = (block as { props?: Record<string, unknown> }).props;
    const padding = props?.padding as { left: number; right: number } | undefined;
    if (padding && depth > 0) {
      const width = availableWidthAt(doc, pointer);
      if (width !== null && padding.left + padding.right > width - 40) {
        issues.push(issue("content_padding_overflow", "error", pointer, {
          padding: padding.left + padding.right,
          width,
        }));
      }
    }

    // S16 plus pravidla o odkazech, procházejí se všechna pole bohatého textu
    for (const field of richTextFieldsOf(block)) {
      const base = `${pointer}/props/${field.key}`;
      for (const { node, pointer: inlinePointer } of walkRichText(field.rich, base)) {
        checkReserved(node, inlinePointer, issues);
        if (node.t !== "a") continue;
        linkCount += 1;
        checkHref(node.href, node.trackable !== false, inlinePointer, issues);
        const systemTag = node.href.trim().match(SYSTEM_URL_TAG);
        if (systemTag?.[1] === "unsubscribe_url") {
          unsubscribeCarriers.push({
            pointer,
            conditional: Boolean((block as { visibleWhen?: unknown }).visibleWhen),
          });
        }
      }
    }

    if (block.type === "image") {
      if (block.props.href) {
        linkCount += 1;
        checkHref(block.props.href, block.props.trackable, `${pointer}/props/href`, issues);
      }
      checkReservedString(block.props.alt, `${pointer}/props/alt`, issues);
    }
    if (block.type === "button") {
      linkCount += 1;
      checkHref(block.props.href, block.props.trackable, `${pointer}/props/href`, issues);
    }
    if (block.type === "html") {
      checkReservedString(block.props.code, `${pointer}/props/code`, issues);
    }
    if (block.type === "social") {
      for (let i = 0; i < block.props.items.length; i += 1) {
        linkCount += 1;
        checkHref(block.props.items[i]!.href, false, `${pointer}/props/items/${i}/href`, issues);
      }
    }
    if (block.type === "footer" && block.props.showUnsubscribe) {
      // Patička nemá visibleWhen už na úrovni schématu, takže je vždy nepodmíněná.
      unsubscribeCarriers.push({ pointer, conditional: false });
    }
  }

  // S14: jediný nositel odhlášení nesmí být podmíněný.
  if (unsubscribeCarriers.length === 1 && unsubscribeCarriers[0]!.conditional) {
    issues.push(issue("content_condition_on_unsubscribe", "error", unsubscribeCarriers[0]!.pointer));
  }

  if (blockCount > MAX_BLOCKS_PER_DOCUMENT) {
    issues.push(issue("content_too_many_blocks", "error", "", { count: blockCount }));
  }
  if (linkCount > MAX_LINKS_PER_DOCUMENT) {
    issues.push(issue("content_too_many_links", "error", "", { count: linkCount }));
  }
  return issues;
}

function checkReserved(node: InlineNode, pointer: string, issues: Issue[]): void {
  if (node.t === "s") checkReservedString(node.v, `${pointer}/v`, issues);
  if (node.t === "var") {
    checkReservedString(node.expr, `${pointer}/expr`, issues);
    if (node.fallback) checkReservedString(node.fallback, `${pointer}/fallback`, issues);
  }
  if (node.t === "a") checkReservedString(node.href, `${pointer}/href`, issues);
}

function checkReservedString(value: string, pointer: string, issues: Issue[]): void {
  if (RESERVED_MARKER_PATTERNS.some((pattern) => pattern.test(value))) {
    issues.push(issue("content_reserved_marker", "error", pointer));
  }
}

function checkHref(href: string, trackable: boolean, pointer: string, issues: Issue[]): void {
  const trimmed = href.trim();
  if (trimmed === "" || trimmed === "#") {
    issues.push(issue("content_link_anchor_only", "error", pointer));
    return;
  }
  if (SYSTEM_URL_TAG.test(trimmed)) return;
  if (HAS_LIQUID.test(trimmed)) {
    // Kód se jmenuje liquid_in_trackable_href, takže je to chyba jen u trackovaného odkazu.
    issues.push(
      trackable
        ? issue("liquid_in_trackable_href", "error", pointer)
        : issue("link_variable_not_tracked", "warning", pointer),
    );
    return;
  }
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    issues.push(issue("content_link_scheme_forbidden", "error", pointer, { href: trimmed }));
    return;
  }
  if (!ALLOWED_SCHEMES.includes(parsed.protocol)) {
    issues.push(issue("content_link_scheme_forbidden", "error", pointer, { scheme: parsed.protocol }));
  }
}

/** Dostupná šířka bloku podle jeho pozice ve stromu. */
function availableWidthAt(doc: Document, pointer: string): number | null {
  const parts = pointer.split("/").filter(Boolean);
  const section = doc.blocks[Number(parts[1])] as SectionBlock | undefined;
  if (!section) return null;
  const inner = doc.theme.contentWidth - section.props.padding.left - section.props.padding.right;
  // /blocks/i/children/j/children/k/children/l = sekce, columns, column, obsah
  if (parts.length < 8) return inner;
  const columns = section.children[Number(parts[3])] as ColumnsBlock | undefined;
  if (!columns || columns.type !== "columns") return inner;
  const widths = columnWidths(columns.props.layout, columns.props.gap, inner);
  const column = columns.children[Number(parts[5])];
  const width = widths[Number(parts[5])];
  if (width === undefined || !column) return inner;
  return width - column.props.padding.left - column.props.padding.right;
}
```

- [ ] **Step 4: Spusť test a ověř, že projde**

Run: `pnpm vitest run packages/emails/test/document/semantic-structure.test.ts`
Expected: PASS, 13 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/emails/src/document/semantic-structure.ts packages/emails/test/document/semantic-structure.test.ts
git commit -m "feat(emails): structural semantic rules"
```

---

### Task 10: Rozklad motivu na hotové barvy

**Files:**
- Create: `packages/emails/src/theme/resolve.ts`
- Test: `packages/emails/test/theme/resolve.test.ts`

Kritérium 17c: motiv s neúplnou mapou `colors` se musí zkompilovat a chybějící role doplnit z tabulky výchozích hodnot. Normalizace mapu doplní na úplnou **dřív, než se cokoliv emituje**, takže emitter s neúplnou mapou nikdy nepracuje.

- [ ] **Step 1: Napiš padající test**

`packages/emails/test/theme/resolve.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_THEME } from "../../src/document/defaults.js";
import { DEFAULT_DARK, DEFAULT_LIGHT } from "../../src/theme/palette.js";
import { resolveTheme } from "../../src/theme/resolve.js";

describe("resolveTheme", () => {
  it("fills every missing role from the defaults", () => {
    const resolved = resolveTheme({ ...DEFAULT_THEME, colors: { "brand.primary": "#ff0000" } });
    expect(resolved.light.roles["brand.primary"]).toBe("#ff0000");
    expect(resolved.light.roles["text.default"]).toBe(DEFAULT_LIGHT["text.default"]);
    expect(Object.keys(resolved.light.roles)).toHaveLength(10);
  });

  it("uses the dark defaults for the dark scheme unless overridden", () => {
    const resolved = resolveTheme({
      ...DEFAULT_THEME,
      darkMode: { strategy: "auto", colors: { "surface.content": "#123456" } },
    });
    expect(resolved.dark.roles["surface.content"]).toBe("#123456");
    expect(resolved.dark.roles["text.default"]).toBe(DEFAULT_DARK["text.default"]);
  });

  it("resolves a literal hex reference to itself and a role reference to its value", () => {
    const resolved = resolveTheme(DEFAULT_THEME);
    expect(resolved.light.color("#abcdef")).toBe("#abcdef");
    expect(resolved.light.color("link.default")).toBe(DEFAULT_LIGHT["link.default"]);
    expect(resolved.dark.color("link.default")).toBe(DEFAULT_DARK["link.default"]);
  });

  it("maps font stack ids to css font families", () => {
    const resolved = resolveTheme({ ...DEFAULT_THEME, fonts: { heading: "georgia", body: "arial" } });
    expect(resolved.fonts.heading).toBe('Georgia, "Times New Roman", serif');
    expect(resolved.fonts.body).toBe("Arial, Helvetica, sans-serif");
  });

  it("derives heading sizes from the scale and rounds up", () => {
    const resolved = resolveTheme(DEFAULT_THEME);
    expect(resolved.headingSize(1)).toBe(31);
    expect(resolved.headingSize(2)).toBe(25);
    expect(resolved.headingSize(3)).toBe(20);
  });

  it("derives mobile values from the theme, never from constants", () => {
    const base = resolveTheme(DEFAULT_THEME);
    expect(base.mobile.pad).toBe(16);
    expect(base.mobile.headingSize(1)).toBe(26);
    expect(base.mobile.headingLineHeight).toBeCloseTo(1.2, 5);
    const big = resolveTheme({
      ...DEFAULT_THEME,
      typography: { baseFontSize: 20, baseLineHeight: 1.5, headingScale: 1.25 },
    });
    expect(big.mobile.headingSize(1)).not.toBe(base.mobile.headingSize(1));
    expect(big.mobile.headingSize(1)).toBeGreaterThanOrEqual(24);
  });

  it("reports whether dark mode is on", () => {
    expect(resolveTheme(DEFAULT_THEME).darkModeEnabled).toBe(true);
    expect(resolveTheme({ ...DEFAULT_THEME, darkMode: { strategy: "off", colors: {} } }).darkModeEnabled)
      .toBe(false);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm vitest run packages/emails/test/theme/resolve.test.ts`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napiš implementaci**

`packages/emails/src/theme/resolve.ts`:

```ts
import type { ColorRef, HexColor, Theme, ThemeColorRole } from "../document/types.js";
import { DEFAULT_DARK, DEFAULT_LIGHT, FONT_STACKS } from "./palette.js";

export type ResolvedScheme = {
  roles: Record<ThemeColorRole, HexColor>;
  color: (ref: ColorRef) => HexColor;
};

export type ResolvedTheme = {
  contentWidth: number;
  radius: number;
  baseFontSize: number;
  baseLineHeight: number;
  headingScale: number;
  fonts: { heading: string; body: string };
  light: ResolvedScheme;
  dark: ResolvedScheme;
  darkModeEnabled: boolean;
  headingSize: (level: 1 | 2 | 3) => number;
  mobile: {
    breakpoint: number;
    pad: number;
    headingSize: (level: 1 | 2 | 3) => number;
    headingLineHeight: number;
  };
};

function scheme(base: Record<ThemeColorRole, HexColor>, overrides: Partial<Record<ThemeColorRole, HexColor>>): ResolvedScheme {
  const roles = { ...base, ...overrides } as Record<ThemeColorRole, HexColor>;
  return {
    roles,
    color: (ref: ColorRef): HexColor =>
      ref.startsWith("#") ? (ref as HexColor) : roles[ref as ThemeColorRole],
  };
}

export function resolveTheme(theme: Theme): ResolvedTheme {
  const light = scheme(DEFAULT_LIGHT, theme.colors);
  const dark = scheme(DEFAULT_DARK, theme.darkMode.colors);
  const { baseFontSize, baseLineHeight, headingScale } = theme.typography;

  // Odvozené velikosti nadpisů, zaokrouhlení nahoru (3.2.4).
  const headingSize = (level: 1 | 2 | 3): number =>
    Math.ceil(baseFontSize * headingScale ** (4 - level));

  // Mobilní hodnoty se odvozují z motivu, nikdy nejsou konstanty (3.4.3).
  const mobileHeadingSize = (level: 1 | 2 | 3): number =>
    Math.max(baseFontSize + 4, Math.round(headingSize(level) * 0.84));

  return {
    contentWidth: theme.contentWidth,
    radius: theme.radius,
    baseFontSize,
    baseLineHeight,
    headingScale,
    fonts: { heading: FONT_STACKS[theme.fonts.heading], body: FONT_STACKS[theme.fonts.body] },
    light,
    dark,
    darkModeEnabled: theme.darkMode.strategy === "auto",
    headingSize,
    mobile: {
      breakpoint: theme.contentWidth,
      pad: Math.min(24, Math.max(12, Math.round(baseFontSize))),
      headingSize: mobileHeadingSize,
      headingLineHeight: Math.max(1.15, Math.round((baseLineHeight - 0.3) * 100) / 100),
    },
  };
}
```

Kontrola vzorce `headingSize`: pro `baseFontSize = 16` a `headingScale = 1.25` dává úroveň 1 hodnotu `ceil(16 × 1.25³) = ceil(31.25) = 31`, úroveň 2 `ceil(16 × 1.25²) = 25` a úroveň 3 `ceil(16 × 1.25) = 20`, přesně podle tabulky v 3.2.4.

- [ ] **Step 4: Spusť test a ověř, že projde**

Run: `pnpm vitest run packages/emails/test/theme/resolve.test.ts`
Expected: PASS, 7 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/emails/src/theme/resolve.ts packages/emails/test/theme/resolve.test.ts
git commit -m "feat(emails): theme resolution with partial color maps"
```

---

### Task 11: Sémantická pravidla nad katalogem polí a Liquidem

**Files:**
- Create: `packages/emails/src/document/semantic-fields.ts`
- Create: `packages/emails/src/document/semantic.ts`
- Test: `packages/emails/test/document/semantic-fields.test.ts`

Pravidla S4, S6, S7, S8, S9, S11, S12, S13. Tady se poprvé volá `validateLiquid` z kontraktů: **tenhle balíček nikdy nerozhoduje, co je platný Liquid**, jen se ptá.

- [ ] **Step 1: Napiš padající test**

`packages/emails/test/document/semantic-fields.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { FieldCatalog } from "@mlain/core/contacts/fields/catalog";
import { blockDefaults, DEFAULT_THEME } from "../../src/document/defaults.js";
import type { Document, SectionBlock } from "../../src/document/types.js";
import { checkFields } from "../../src/document/semantic-fields.js";

const catalog: FieldCatalog = {
  version: "v1",
  fields: [
    { path: "first_name", type: "string", label: { en: "First name", cs: "Jméno" }, group: "name", deleted: false },
    { path: "greeting", type: "string", label: { en: "Greeting" }, group: "salutation", deleted: false },
    { path: "attr.city", type: "string", label: { en: "City" }, group: "custom", deleted: false },
    { path: "attr.is_vip", type: "boolean", label: { en: "VIP" }, group: "custom", deleted: false },
  ],
};

const ASSET = "0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071";

const section = (children: unknown[]): SectionBlock =>
  ({ id: "b_000000000001", type: "section", props: blockDefaults("section"), children } as SectionBlock);

const docOf = (blocks: SectionBlock[]): Document => ({
  schemaVersion: 1,
  meta: { name: "T", previewText: "", language: "cs" },
  theme: DEFAULT_THEME,
  blocks,
});

const run = (doc: Document, kind: "campaign" | "transactional" | "system" = "campaign") =>
  checkFields(doc, {
    templateKind: kind, fields: catalog,
    assetIds: new Set([ASSET]), estimatedHtmlBytes: 1000,
  });

describe("field and liquid semantics", () => {
  it("S4 requires an unsubscribe link in campaigns and only warns in transactional", () => {
    expect(run(docOf([section([])])).map((i) => i.code)).toContain("content_missing_unsubscribe");
    expect(run(docOf([section([])]), "transactional")
      .find((i) => i.code === "content_missing_unsubscribe")?.severity).toBe("warning");
  });

  it("S6 rejects an image pointing at an unknown asset", () => {
    const image = {
      id: "b_000000000002", type: "image",
      props: { ...blockDefaults("image"), assetId: "0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6099", alt: "x" },
    };
    expect(run(docOf([section([image])])).map((i) => i.code)).toContain("content_asset_not_found");
  });

  it("S7 warns about an image without alt unless it is decorative", () => {
    const bare = {
      id: "b_000000000002", type: "image",
      props: { ...blockDefaults("image"), assetId: ASSET },
    };
    expect(run(docOf([section([bare])])).find((i) => i.code === "content_image_missing_alt")?.severity)
      .toBe("warning");
    const decorative = { ...bare, props: { ...bare.props, decorative: true } };
    expect(run(docOf([section([decorative])])).map((i) => i.code))
      .not.toContain("content_image_missing_alt");
  });

  it("S8 warns about text below WCAG AA in either scheme", () => {
    const text = {
      id: "b_000000000002", type: "text",
      props: { ...blockDefaults("text"), color: "#eeeeee" as const },
    };
    expect(run(docOf([section([text])])).map((i) => i.code)).toContain("content_low_contrast");
  });

  it("S9 warns above 80 kB and errors above 102 kB", () => {
    const doc = docOf([section([])]);
    const warn = checkFields(doc, {
      templateKind: "campaign", fields: catalog, assetIds: new Set(), estimatedHtmlBytes: 90_000,
    });
    expect(warn.find((i) => i.code === "content_html_too_large")?.severity).toBe("warning");
    const error = checkFields(doc, {
      templateKind: "campaign", fields: catalog, assetIds: new Set(), estimatedHtmlBytes: 110_000,
    });
    expect(error.find((i) => i.code === "content_html_too_large")?.severity).toBe("error");
  });

  it("S11 forwards liquid issues from the contract validator with a pointer", () => {
    const text = {
      id: "b_000000000002", type: "text",
      props: {
        ...blockDefaults("text"),
        content: [{ t: "p", children: [{ t: "var", expr: 'contact.first_name | default: "kolego"' }] }],
      },
    };
    const literal = run(docOf([section([text])]))
      .find((i) => i.code === "liquid_string_literal_not_allowed");
    expect(literal).toBeDefined();
    expect(literal!.pointer).toContain("/blocks/0/children/0/props/content/0/children/0");
  });

  it("S11 rejects a comparison operator, forbidden in MVP 0 by decision R7", () => {
    const text = {
      id: "b_000000000002", type: "text",
      props: { ...blockDefaults("text"), content: [] },
    };
    const html = {
      id: "b_000000000003", type: "html",
      props: { ...blockDefaults("html"), code: "{% if contact.attr.city > 5 %}x{% endif %}" },
    };
    expect(run(docOf([section([text, html])])).map((i) => i.code))
      .toContain("liquid_comparison_operator_not_supported");
  });

  it("S12 rejects a merge tag pointing at a field that does not exist", () => {
    const text = {
      id: "b_000000000002", type: "text",
      props: {
        ...blockDefaults("text"),
        content: [{ t: "p", children: [{ t: "var", expr: "contact.neexistuje" }] }],
      },
    };
    expect(run(docOf([section([text])])).map((i) => i.code)).toContain("liquid_unknown_field");
  });

  it("S13 rejects an unknown condition field and an operator that does not fit the type", () => {
    const bad = {
      id: "b_000000000002", type: "text",
      visibleWhen: { field: "contact.attr.nope", op: "present" }, props: blockDefaults("text"),
    };
    expect(run(docOf([section([bad])])).map((i) => i.code))
      .toContain("content_condition_field_unknown");
    const wrongOp = {
      id: "b_000000000003", type: "text",
      visibleWhen: { field: "contact.attr.city", op: "true" }, props: blockDefaults("text"),
    };
    expect(run(docOf([section([wrongOp])])).map((i) => i.code))
      .toContain("content_condition_operator_invalid");
    const ok = {
      id: "b_000000000004", type: "text",
      visibleWhen: { field: "contact.attr.is_vip", op: "true" }, props: blockDefaults("text"),
    };
    expect(run(docOf([section([ok])])).map((i) => i.code))
      .not.toContain("content_condition_operator_invalid");
  });

  it("rejects the internal roots in an authored template", () => {
    for (const expr of ["_present.contact__city", "_context.timezone"]) {
      const text = {
        id: "b_000000000002", type: "text",
        props: { ...blockDefaults("text"), content: [{ t: "p", children: [{ t: "var", expr }] }] },
      };
      expect(run(docOf([section([text])])).map((i) => i.code), expr).toContain("liquid_unknown_root");
    }
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm vitest run packages/emails/test/document/semantic-fields.test.ts`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napiš `packages/emails/src/document/semantic-fields.ts`**

```ts
import { validateLiquid, type LiquidContext } from "@mlain/contracts/liquid";
import type { FieldCatalog, FieldCatalogType } from "@mlain/core/contacts/fields/catalog";
import { fromLiquidIssue, type Issue } from "../issue.js";
import { toCatalogPath, toLiquidRoots } from "../paths.js";
import { contrastRatio } from "../theme/palette.js";
import { resolveTheme } from "../theme/resolve.js";
import type { ColorRef, Document, VisibilityCondition } from "./types.js";
import { pointerToDotted, richTextFieldsOf, walkBlocks, walkRichText } from "./walk.js";

export type FieldContext = {
  templateKind: "campaign" | "transactional" | "system";
  fields: FieldCatalog;
  assetIds: Set<string>;
  /** Odhad velikosti HTML. Přesné číslo zná až renderer, tohle je vstup pro pravidlo S9. */
  estimatedHtmlBytes: number;
};

const HTML_WARN_BYTES = 80 * 1024;
const HTML_ERROR_BYTES = 102 * 1024;

/** Operátory podmínky podle typu pole, normativní tabulka z 3.1.10 a 3.8.2. */
const OPERATORS_BY_TYPE: Record<FieldCatalogType, VisibilityCondition["op"][]> = {
  string: ["present", "blank"],
  number: ["present", "blank"],
  boolean: ["true", "false"],
  date: ["present", "blank"],
  datetime: ["present", "blank"],
  list: ["present", "blank"],
};

const ALLOWED_ROOTS = [
  "contact", "campaign", "workspace",
  "unsubscribe_url", "one_click_unsubscribe_url", "preferences_url", "webview_url",
];

const issue = (
  code: string,
  severity: Issue["severity"],
  pointer: string,
  params?: Record<string, string | number>,
): Issue => ({ code, severity, pointer, path: pointerToDotted(pointer), params });

export function checkFields(doc: Document, ctx: FieldContext): Issue[] {
  const issues: Issue[] = [];
  const theme = resolveTheme(doc.theme);
  const liquidContext: LiquidContext = {
    // `level: "authored"` je povinné. Autorská gramatika zakazuje argumenty
    // filtrů i kořen `_present`; kompilovanou úroveň kontroluje až invariant I1.
    level: "authored",
    // Validátor chce ÚZKÝ tvar `LiquidRoots`, ne bohatý katalog polí od P07.
    // Jsou to dva různé typy (rozhodnutí R2), převod je v `../paths.js`.
    fields: toLiquidRoots(ctx.fields),
    roots: ALLOWED_ROOTS,
    template_kind: ctx.templateKind,
  };
  let hasUnsubscribe = false;

  for (const { block, pointer } of walkBlocks(doc)) {
    // S13
    const condition = (block as { visibleWhen?: VisibilityCondition | null }).visibleWhen;
    if (condition) {
      const entry = ctx.fields.fields.find((f) => f.path === toCatalogPath(condition.field));
      if (!entry) {
        issues.push(issue("content_condition_field_unknown", "error", `${pointer}/visibleWhen/field`, {
          path: condition.field,
        }));
      } else if (!OPERATORS_BY_TYPE[entry.type].includes(condition.op)) {
        issues.push(issue("content_condition_operator_invalid", "error", `${pointer}/visibleWhen/op`, {
          op: condition.op,
          type: entry.type,
        }));
      }
    }

    if (block.type === "image") {
      // S6
      if (!ctx.assetIds.has(block.props.assetId)) {
        issues.push(issue("content_asset_not_found", "error", `${pointer}/props/assetId`, {
          assetId: block.props.assetId,
        }));
      }
      if (block.props.darkVariantAssetId && !ctx.assetIds.has(block.props.darkVariantAssetId)) {
        issues.push(issue("content_asset_not_found", "error", `${pointer}/props/darkVariantAssetId`));
      }
      // S7
      if (!block.props.decorative && block.props.alt.trim() === "") {
        issues.push(issue("content_image_missing_alt", "warning", `${pointer}/props/alt`));
      }
    }
    if (block.type === "section" && block.props.backgroundImageAssetId
        && !ctx.assetIds.has(block.props.backgroundImageAssetId)) {
      issues.push(issue("content_asset_not_found", "error", `${pointer}/props/backgroundImageAssetId`));
    }

    // S8, kontrast se kontroluje ve světlém i tmavém režimu
    const color = (block as { props?: { color?: ColorRef } }).props?.color;
    if (typeof color === "string") {
      const light = contrastRatio(theme.light.color(color), theme.light.roles["surface.content"]);
      const dark = contrastRatio(theme.dark.color(color), theme.dark.roles["surface.content"]);
      if (light < 4.5 || dark < 4.5) {
        issues.push(issue("content_low_contrast", "warning", `${pointer}/props/color`, {
          light: Math.round(light * 100) / 100,
          dark: Math.round(dark * 100) / 100,
        }));
      }
    }

    if (block.type === "footer" && block.props.showUnsubscribe) hasUnsubscribe = true;

    // S11 a S12, Liquid výrazy uzlů var a kód bloku html
    for (const field of richTextFieldsOf(block)) {
      const base = `${pointer}/props/${field.key}`;
      for (const { node, pointer: inlinePointer } of walkRichText(field.rich, base)) {
        if (node.t === "a" && /^\{\{\s*unsubscribe_url\s*\}\}$/.test(node.href.trim())) {
          hasUnsubscribe = true;
        }
        if (node.t !== "var") continue;
        pushLiquid(issues, `{{ ${node.expr} }}`, `${inlinePointer}/expr`, liquidContext);
        if (node.fallback !== undefined && /["'{}<>]/.test(node.fallback)) {
          issues.push(issue("liquid_default_value_invalid", "error", `${inlinePointer}/fallback`));
        }
      }
    }
    if (block.type === "html") {
      pushLiquid(issues, block.props.code, `${pointer}/props/code`, liquidContext);
    }
  }

  // S4
  if (!hasUnsubscribe) {
    issues.push(issue(
      "content_missing_unsubscribe",
      ctx.templateKind === "campaign" ? "error" : "warning",
      "",
    ));
  }

  // S9
  if (ctx.estimatedHtmlBytes > HTML_ERROR_BYTES) {
    issues.push(issue("content_html_too_large", "error", "", { bytes: ctx.estimatedHtmlBytes }));
  } else if (ctx.estimatedHtmlBytes > HTML_WARN_BYTES) {
    issues.push(issue("content_html_too_large", "warning", "", { bytes: ctx.estimatedHtmlBytes }));
  }

  return issues;
}

function pushLiquid(issues: Issue[], source: string, pointer: string, ctx: LiquidContext): void {
  for (const found of validateLiquid(source, ctx).issues) {
    // Ne spread. `LiquidIssue` nese `span`, který ukazuje do řetězce výrazu,
    // ne do dokumentu, a spreadem by se protáhl dál a pletl se s pozicí uzlu.
    issues.push(fromLiquidIssue(found, pointer, pointerToDotted(pointer)));
  }
}
```

- [ ] **Step 4: Napiš `packages/emails/src/document/semantic.ts`**

```ts
import type { Issue } from "../issue.js";
import type { Document } from "./types.js";
import { checkFields, type FieldContext } from "./semantic-fields.js";
import { checkStructure } from "./semantic-structure.js";

export type SemanticContext = FieldContext;

/**
 * Sémantická vrstva nad JSON Schema. Pořadí je pevné: nejdřív struktura,
 * pak pole a Liquid, aby hlášky v editoru chodily vždy ve stejném pořadí
 * a snapshot testy se nerozjížděly.
 */
export function checkSemantics(doc: Document, ctx: SemanticContext): Issue[] {
  return [
    ...checkStructure(doc, { templateKind: ctx.templateKind }),
    ...checkFields(doc, ctx),
  ];
}

// `hasBlockingIssue` bydlí u typu, tedy v `../issue.js`. Reexportuje se sem,
// aby doménová vrstva měla jednu adresu, ale definice je jen jedna.
export { hasBlockingIssue } from "../issue.js";
```

- [ ] **Step 5: Spusť testy a ověř, že projdou**

Run: `pnpm vitest run packages/emails/test/document`
Expected: PASS, celá dokumentová vrstva.

- [ ] **Step 6: Commit**

```bash
git add packages/emails/src/document/semantic-fields.ts packages/emails/src/document/semantic.ts packages/emails/test/document/semantic-fields.test.ts
git commit -m "feat(emails): field catalog and liquid semantic rules"
```

---

## Fáze B: normalizace a sloty

### Task 12: Sloty argumentů filtrů a raw sloty

**Files:**
- Create: `packages/emails/src/normalize/slots.ts`
- Test: `packages/emails/test/normalize/slots.test.ts`

Tohle je jádro obrany proti escapování. **Slot patří uzlu dokumentu, ne výskytu ve výstupu.** Naivní záměna podle výrazu selže ve třech situacích naráz a výsledek je pokaždé syntakticky platný, takže ho nechytí ani invariant I1, ani validátor: dva bloky se stejným výrazem a různou náhradní hodnotou, tlačítko emitující popisek dvakrát kvůli VML, a blok uvnitř podmínky, kde pořadí výskytů neodpovídá pořadí bloků.

- [ ] **Step 1: Napiš padající test**

`packages/emails/test/normalize/slots.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { blockDefaults, DEFAULT_THEME } from "../../src/document/defaults.js";
import type { Document, SectionBlock, VarInline } from "../../src/document/types.js";
import {
  assignFilterSlots, filterSlotMarker, RawSlotSink, RAW_SLOT_PREFIX,
} from "../../src/normalize/slots.js";

const textBlock = (id: string, nodes: VarInline[]) => ({
  id, type: "text" as const,
  props: { ...blockDefaults("text"), content: [{ t: "p" as const, children: nodes }] },
});

const docOf = (children: unknown[]): Document => ({
  schemaVersion: 1,
  meta: { name: "T", previewText: "", language: "cs" },
  theme: DEFAULT_THEME,
  blocks: [{ id: "b_000000000001", type: "section", props: blockDefaults("section"), children } as unknown as SectionBlock],
});

describe("filter slots", () => {
  it("numbers slots in document order starting at one", () => {
    const doc = docOf([
      textBlock("b_000000000002", [{ t: "var", expr: "contact.first_name", fallback: "kolego" }]),
      textBlock("b_000000000003", [{ t: "var", expr: "contact.first_name", fallback: "zákazníku" }]),
    ]);
    const slots = assignFilterSlots(doc);
    expect(slots).toEqual([
      { slot: 1, blockId: "b_000000000002", filter: "default", value: "kolego" },
      { slot: 2, blockId: "b_000000000003", filter: "default", value: "zákazníku" },
    ]);
  });

  it("writes the slot number onto the node so the emitter never guesses", () => {
    const doc = docOf([textBlock("b_000000000002", [{ t: "var", expr: "x", fallback: "y" }])]);
    assignFilterSlots(doc);
    const node = (doc.blocks[0]!.children[0] as ReturnType<typeof textBlock>).props.content[0]!.children[0] as VarInline;
    expect(node.slots).toEqual({ default: 1 });
  });

  it("gives a node with both filters two slots", () => {
    const doc = docOf([
      textBlock("b_000000000002", [
        { t: "var", expr: "contact.created_at | date | default", fallback: "brzy", dateFormat: "%d.%m.%Y" },
      ]),
    ]);
    const slots = assignFilterSlots(doc);
    expect(slots.map((s) => s.filter)).toEqual(["default", "date"]);
    const node = (doc.blocks[0]!.children[0] as ReturnType<typeof textBlock>).props.content[0]!.children[0] as VarInline;
    expect(node.slots).toEqual({ default: 1, date: 2 });
  });

  it("skips nodes without any filter argument", () => {
    const doc = docOf([textBlock("b_000000000002", [{ t: "var", expr: "contact.email" }])]);
    expect(assignFilterSlots(doc)).toEqual([]);
  });

  it("renders markers with four digits and only characters no react renderer escapes", () => {
    expect(filterSlotMarker(7)).toBe("ML_ARG_0007");
    expect(filterSlotMarker(1234)).toBe("ML_ARG_1234");
    expect(filterSlotMarker(7)).toMatch(/^[A-Z_0-9]+$/);
  });
});

describe("raw slots", () => {
  it("returns a marker that survives react escaping and resolves back to the raw html", () => {
    const sink = new RawSlotSink("ab12cd34ef");
    const marker = sink.add("<!--[if mso]><table><![endif]-->");
    expect(marker).toBe(`${RAW_SLOT_PREFIX}ab12cd34ef_0001`);
    expect(marker).toMatch(/^[A-Z_0-9a-z]+$/);
    expect(sink.entries()).toEqual([[marker, "<!--[if mso]><table><![endif]-->"]]);
  });

  it("numbers markers in the order they were requested", () => {
    const sink = new RawSlotSink("ab12cd34ef");
    expect(sink.add("a")).toBe(`${RAW_SLOT_PREFIX}ab12cd34ef_0001`);
    expect(sink.add("b")).toBe(`${RAW_SLOT_PREFIX}ab12cd34ef_0002`);
  });

  it("generates a fresh ten character nonce when none is given", () => {
    const a = new RawSlotSink();
    const b = new RawSlotSink();
    expect(a.nonce).toMatch(/^[a-z0-9]{10}$/);
    expect(a.nonce).not.toBe(b.nonce);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm vitest run packages/emails/test/normalize/slots.test.ts`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napiš implementaci**

`packages/emails/src/normalize/slots.ts`:

```ts
import { randomBytes } from "node:crypto";
import type { Document, VarInline } from "../document/types.js";
import { richTextFieldsOf, walkBlocks, walkRichText } from "../document/walk.js";

export type FilterSlot = {
  slot: number;
  blockId: string;
  filter: "default" | "date";
  value: string;
};

/** Kontraktní tvar z 3.3.5a. Jen znaky, které žádný React renderer neescapuje. */
export function filterSlotMarker(slot: number): string {
  return `ML_ARG_${String(slot).padStart(4, "0")}`;
}

/**
 * Přidělí sloty uzlům `var`, které nesou argument filtru, v pořadí prvního výskytu
 * v dokumentu. Mutuje předaný dokument, proto se volá výhradně nad klonem
 * uvnitř normalizeDocument.
 */
export function assignFilterSlots(doc: Document): FilterSlot[] {
  const slots: FilterSlot[] = [];
  for (const { block, pointer } of walkBlocks(doc)) {
    for (const field of richTextFieldsOf(block)) {
      for (const { node } of walkRichText(field.rich, `${pointer}/props/${field.key}`)) {
        if (node.t !== "var") continue;
        const target = node as VarInline;
        const assigned: { default?: number; date?: number } = {};
        if (target.fallback !== undefined) {
          slots.push({
            slot: slots.length + 1, blockId: block.id, filter: "default", value: target.fallback,
          });
          assigned.default = slots.length;
        }
        if (target.dateFormat !== undefined) {
          slots.push({
            slot: slots.length + 1, blockId: block.id, filter: "date", value: target.dateFormat,
          });
          assigned.date = slots.length;
        }
        if (assigned.default !== undefined || assigned.date !== undefined) {
          target.slots = assigned;
        }
      }
    }
  }
  return slots;
}

export const RAW_SLOT_PREFIX = "ML_RAW_";

/**
 * Sběrač syrového HTML (podmíněné komentáře pro Outlook, VML, značka pixelu,
 * sanitizovaný obsah bloku html, obsah <style>). React z JSX HTML komentář
 * ani syrový markup vypustit neumí, takže se do stromu dá textový žeton
 * a kompilace ho po renderu nahradí.
 *
 * Nonce je náhodná na každý render: uživatelský text tak nemůže cizí slot
 * odklonit ani tehdy, když by validátor pravidlo S16 propásl. Determinismus
 * výstupu to neruší, protože se žeton do výstupu nikdy nedostane a hlídá to invariant I12.
 */
export class RawSlotSink {
  readonly nonce: string;
  private readonly values: string[] = [];

  constructor(nonce?: string) {
    this.nonce = nonce ?? randomBytes(8).toString("hex").slice(0, 10);
  }

  add(html: string): string {
    this.values.push(html);
    return `${RAW_SLOT_PREFIX}${this.nonce}_${String(this.values.length).padStart(4, "0")}`;
  }

  entries(): Array<[string, string]> {
    return this.values.map((html, index) => [
      `${RAW_SLOT_PREFIX}${this.nonce}_${String(index + 1).padStart(4, "0")}`,
      html,
    ]);
  }

  get size(): number {
    return this.values.length;
  }
}
```

- [ ] **Step 4: Spusť test a ověř, že projde**

Run: `pnpm vitest run packages/emails/test/normalize/slots.test.ts`
Expected: PASS, 8 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/emails/src/normalize/slots.ts packages/emails/test/normalize/slots.test.ts
git commit -m "feat(emails): filter argument slots and raw html slots"
```

---

### Task 13: Normalizace dokumentu

**Files:**
- Create: `packages/emails/src/normalize/index.ts`
- Test: `packages/emails/test/normalize/index.test.ts`

Normalizace je jediné místo, které smí dokument upravit. Emitter pak pracuje s úplnými daty a nemusí nikde psát `?? default`.

- [ ] **Step 1: Napiš padající test**

`packages/emails/test/normalize/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { blockDefaults, DEFAULT_THEME } from "../../src/document/defaults.js";
import type { Document, SectionBlock } from "../../src/document/types.js";
import { normalizeDocument } from "../../src/normalize/index.js";

const docOf = (children: unknown[], language = "cs"): Document => ({
  schemaVersion: 1,
  meta: { name: "T", previewText: "", language },
  theme: { ...DEFAULT_THEME, colors: { "brand.primary": "#ff0000" } },
  blocks: [{ id: "b_000000000001", type: "section", props: blockDefaults("section"), children } as unknown as SectionBlock],
});

describe("normalizeDocument", () => {
  it("does not mutate its input", () => {
    const input = docOf([]);
    const copy = structuredClone(input);
    normalizeDocument(input, { language: "cs" });
    expect(input).toEqual(copy);
  });

  it("resolves the theme so the emitter never sees a partial color map", () => {
    const result = normalizeDocument(docOf([]), { language: "cs" });
    expect(result.theme.light.roles["brand.primary"]).toBe("#ff0000");
    expect(Object.keys(result.theme.light.roles)).toHaveLength(10);
  });

  it("skips an unknown block and warns", () => {
    const result = normalizeDocument(
      docOf([{ id: "b_000000000002", type: "chart", series: [1, 2] }]),
      { language: "cs" },
    );
    expect(result.skippedBlockIds.has("b_000000000002")).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain("unknown_block_skipped");
  });

  it("skips the repeat block in MVP 0 and warns", () => {
    const result = normalizeDocument(
      docOf([{ id: "b_000000000002", type: "repeat", props: blockDefaults("repeat"), children: [] }]),
      { language: "cs" },
    );
    expect(result.skippedBlockIds.has("b_000000000002")).toBe(true);
    expect(result.warnings.map((w) => w.code)).toContain("repeat_block_not_supported");
  });

  it("drops an unknown social network and warns instead of failing", () => {
    const social = {
      id: "b_000000000002", type: "social",
      props: {
        ...blockDefaults("social"),
        items: [
          { network: "facebook", href: "https://fb.com/x" },
          { network: "someneworkwedonotknow", href: "https://x.cz" },
        ],
      },
    };
    const result = normalizeDocument(docOf([social]), { language: "cs" });
    const block = result.doc.blocks[0]!.children[0] as typeof social;
    expect(block.props.items).toHaveLength(1);
    expect(result.warnings.map((w) => w.code)).toContain("social_network_unknown");
  });

  it("falls back to english for an unsupported language and warns", () => {
    const result = normalizeDocument(docOf([], "sv-FI"), { language: "sv-FI" });
    expect(result.language).toBe("en");
    expect(result.doc.meta.language).toBe("sv-FI");
    const warning = result.warnings.find((w) => w.code === "language_not_supported");
    expect(warning?.params?.language).toBe("sv-FI");
  });

  it("keeps a supported region tag on the base language", () => {
    expect(normalizeDocument(docOf([], "cs-CZ"), { language: "cs-CZ" }).language).toBe("cs");
  });

  it("assigns filter slots", () => {
    const text = {
      id: "b_000000000002", type: "text",
      props: {
        ...blockDefaults("text"),
        content: [{ t: "p", children: [{ t: "var", expr: "contact.first_name", fallback: "kolego" }] }],
      },
    };
    const result = normalizeDocument(docOf([text]), { language: "cs" });
    expect(result.filterSlots).toHaveLength(1);
    expect(result.filterSlots[0]!.value).toBe("kolego");
  });

  it("fills missing block props from the defaults", () => {
    const partial = { id: "b_000000000002", type: "spacer", props: { height: 40 } };
    const result = normalizeDocument(docOf([partial]), { language: "cs" });
    const block = result.doc.blocks[0]!.children[0] as { props: { height: number; heightMobile: null } };
    expect(block.props.height).toBe(40);
    expect(block.props.heightMobile).toBeNull();
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm vitest run packages/emails/test/normalize/index.test.ts`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napiš implementaci**

`packages/emails/src/normalize/index.ts`:

```ts
import type { Issue } from "../issue.js";
import { blockDefaults, KNOWN_BLOCK_TYPES, type BlockTypeWithDefaults } from "../document/defaults.js";
import type { AnyBlock, Document, SocialNetwork } from "../document/types.js";
import { walkBlocks } from "../document/walk.js";
import { resolveTheme, type ResolvedTheme } from "../theme/resolve.js";
import { assignFilterSlots, type FilterSlot } from "./slots.js";

/** Sítě, ke kterým dodáváme ikony. Rozšiřuje se aditivně, viz 3.2.11. */
export const KNOWN_SOCIAL_NETWORKS: readonly SocialNetwork[] = [
  "facebook", "instagram", "x", "linkedin", "youtube", "tiktok",
  "threads", "pinterest", "bluesky", "mastodon", "web", "email",
];

/** Jazyky, ve kterých MVP 0 dodává texty produktu. */
export const SUPPORTED_LANGUAGES = ["cs", "en"] as const;

export type NormalizedDocument = {
  doc: Document;
  theme: ResolvedTheme;
  filterSlots: FilterSlot[];
  /** Bloky, které emitter vynechá: neznámý typ a repeat v MVP 0. */
  skippedBlockIds: Set<string>;
  /** Efektivní jazyk dodávaných textů, vždy jeden ze SUPPORTED_LANGUAGES. */
  language: string;
  warnings: Issue[];
};

export function normalizeDocument(input: Document, opts: { language: string }): NormalizedDocument {
  const doc = structuredClone(input);
  const warnings: Issue[] = [];
  const skippedBlockIds = new Set<string>();

  for (const { block, pointer } of walkBlocks(doc)) {
    if (!KNOWN_BLOCK_TYPES.includes(block.type)) {
      skippedBlockIds.add(block.id);
      warnings.push({
        code: "unknown_block_skipped", severity: "warning", pointer,
        params: { type: block.type, id: block.id },
      });
      continue;
    }
    if (block.type === "repeat") {
      skippedBlockIds.add(block.id);
      warnings.push({
        code: "repeat_block_not_supported", severity: "warning", pointer, params: { id: block.id },
      });
    }
    fillDefaults(block);
    if (block.type === "social") {
      const kept = block.props.items.filter((item) =>
        KNOWN_SOCIAL_NETWORKS.includes(item.network));
      if (kept.length !== block.props.items.length) {
        for (const item of block.props.items) {
          if (KNOWN_SOCIAL_NETWORKS.includes(item.network)) continue;
          warnings.push({
            code: "social_network_unknown", severity: "warning", pointer,
            params: { network: item.network },
          });
        }
        block.props.items = kept;
      }
    }
  }

  const requested = opts.language || doc.meta.language;
  const base = requested.split("-")[0]!.toLowerCase();
  const language = (SUPPORTED_LANGUAGES as readonly string[]).includes(base) ? base : "en";
  if (language !== base) {
    // Kompilace nespadne, jazyk ovlivňuje jen dodávané texty a atribut lang (3.1.9).
    warnings.push({
      code: "language_not_supported", severity: "warning", pointer: "/meta/language",
      params: { language: requested },
    });
  }

  return {
    doc,
    theme: resolveTheme(doc.theme),
    filterSlots: assignFilterSlots(doc),
    skippedBlockIds,
    language,
    warnings,
  };
}

function fillDefaults(block: AnyBlock): void {
  const type = block.type as BlockTypeWithDefaults;
  const holder = block as { props?: Record<string, unknown> };
  holder.props = { ...(blockDefaults(type) as Record<string, unknown>), ...(holder.props ?? {}) };
}
```

- [ ] **Step 4: Spusť test a ověř, že projde**

Run: `pnpm vitest run packages/emails/test/normalize`
Expected: PASS, všechny testy normalizace.

- [ ] **Step 5: Commit**

```bash
git add packages/emails/src/normalize/index.ts packages/emails/test/normalize/index.test.ts
git commit -m "feat(emails): document normalization with skip warnings"
```

---

## Fáze C: emitter do HTML

### Jak se používá react-email a kde ne

Než začneš psát komponenty, přečti si tohle. Ušetří to hodinu hledání, proč se výstup rozjíždí.

| Vrstva | Čím se dělá | Proč |
|---|---|---|
| Obálka dokumentu (`<html>`, `<head>`, `<body>`) | `Html`, `Head`, `Body` z `@react-email/components` | Dodávají korektní kostru a přijímají naše atributy pro VML. |
| Obrázek, odkaz, vodorovná linka | `Img`, `Link`, `Hr` | Výchozí výstup sedí na naše pravidla po doplnění stylu. |
| Mřížka, sekce, sloupce, tlačítko | **vlastní komponenty nad prostými `<table>`, `<tr>`, `<td>`** | Ghost tables, pixelové šířky a VML dvojče tlačítka jsou přísnější, než co `Section`, `Row` a `Button` z react-email emitují. Pravidlo 3.4.1 („kde react-email pravidlo neplní, doplní se vlastní komponentou") tím platí: emitterem zůstává `@react-email/render`, jen mu dáváme přesnější strom. |
| HTML komentář, podmíněný komentář, VML, obsah `<style>` | **raw slot** (rozhodnutí D3) | React z JSX komentář vypustit neumí a text uvnitř `<style>` escapuje, takže `"Segoe UI"` by se rozpadlo na `&quot;`. |

Golden snapshoty (Task 33) fixují výstup bajt po bajtu, takže jakákoliv změna chování react-emailu při upgradu shodí test. To je jediná pojistka, která u cizí knihovny funguje.

---

### Task 14: Pomocníci na styly a CSS do hlavičky

**Files:**
- Create: `packages/emails/src/emitter/style.ts`
- Create: `packages/emails/src/emitter/head-css.ts`
- Test: `packages/emails/test/emitter/head-css.test.ts`

Kritérium 17b: media query i tmavá paleta se **odvozují z motivu**, nikdy nejsou natvrdo napsané konstanty. Bez toho by dokument s `baseFontSize = 20` dostal mobilní nadpis menší než okolní text.

- [ ] **Step 1: Napiš padající test**

`packages/emails/test/emitter/head-css.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_THEME } from "../../src/document/defaults.js";
import { resolveTheme } from "../../src/theme/resolve.js";
import { buildHeadCss, MSO_HEAD_BLOCK } from "../../src/emitter/head-css.js";

describe("head css", () => {
  it("contains the fixed client reset", () => {
    const css = buildHeadCss(resolveTheme(DEFAULT_THEME));
    expect(css).toContain("body{margin:0;padding:0;width:100%!important");
    expect(css).toContain("table{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0}");
    expect(css).toContain("u+#body a{color:inherit;text-decoration:none}");
  });

  it("derives the breakpoint from contentWidth", () => {
    expect(buildHeadCss(resolveTheme(DEFAULT_THEME)))
      .toContain("@media only screen and (max-width:600px)");
    expect(buildHeadCss(resolveTheme({ ...DEFAULT_THEME, contentWidth: 640 })))
      .toContain("@media only screen and (max-width:640px)");
  });

  it("derives mobile heading sizes from the theme, not from constants", () => {
    const base = buildHeadCss(resolveTheme(DEFAULT_THEME));
    expect(base).toContain(".ml-h1{font-size:26px!important;line-height:1.2!important}");
    const big = buildHeadCss(resolveTheme({
      ...DEFAULT_THEME,
      typography: { baseFontSize: 20, baseLineHeight: 1.5, headingScale: 1.25 },
    }));
    expect(big).not.toContain("font-size:26px!important;line-height:1.2!important");
  });

  it("emits the dark block from the theme dark palette", () => {
    const css = buildHeadCss(resolveTheme({
      ...DEFAULT_THEME,
      darkMode: { strategy: "auto", colors: { "surface.content": "#123456" } },
    }));
    expect(css).toContain("@media (prefers-color-scheme:dark)");
    expect(css).toContain(".ml-content{background-color:#123456!important}");
    expect(css).toContain("[data-ogsb] .ml-content{background-color:#123456!important}");
  });

  it("omits the dark block when the strategy is off", () => {
    const css = buildHeadCss(resolveTheme({
      ...DEFAULT_THEME, darkMode: { strategy: "off", colors: {} },
    }));
    expect(css).not.toContain("prefers-color-scheme:dark");
    expect(css).not.toContain("data-ogsc");
  });

  it("never emits an at font face rule", () => {
    expect(buildHeadCss(resolveTheme(DEFAULT_THEME))).not.toContain("@font-face");
  });

  it("ships the mso office document settings block", () => {
    expect(MSO_HEAD_BLOCK).toContain("<o:PixelsPerInch>96</o:PixelsPerInch>");
    expect(MSO_HEAD_BLOCK).toContain("<o:AllowPNG/>");
    expect(MSO_HEAD_BLOCK.startsWith("<!--[if mso]>")).toBe(true);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm vitest run packages/emails/test/emitter/head-css.test.ts`
Expected: FAIL, moduly neexistují.

- [ ] **Step 3: Napiš `packages/emails/src/emitter/style.ts`**

```ts
import type { CSSProperties } from "react";
import type { Padding } from "../document/types.js";

export const px = (value: number): string => `${Math.round(value)}px`;

export function paddingStyle(padding: Padding): CSSProperties {
  return {
    paddingTop: px(padding.top),
    paddingRight: px(padding.right),
    paddingBottom: px(padding.bottom),
    paddingLeft: px(padding.left),
  };
}

/**
 * Řádkování se vždy uvádí v pixelech a doplňuje se mso-line-height-rule.
 * Bez toho počítá Word engine řádkování jinak než ostatní klienti a text se rozjede.
 * React převede klíč `msoLineHeightRule` na `mso-line-height-rule`.
 */
export function lineHeightStyle(fontSize: number, lineHeight: number): CSSProperties {
  return {
    lineHeight: px(fontSize * lineHeight),
    msoLineHeightRule: "exactly",
  } as CSSProperties;
}

export const ALIGN_TO_TEXT_ALIGN = {
  left: "left", center: "center", right: "right", justify: "justify",
} as const;
```

- [ ] **Step 4: Napiš `packages/emails/src/emitter/head-css.ts`**

```ts
import type { ResolvedTheme } from "../theme/resolve.js";

/**
 * Reset klienta, pevný a neměnný (3.4.5). Bez `@font-face`, ten v e-mailu
 * nefunguje a jen zvětšuje HTML.
 */
const RESET = [
  "body{margin:0;padding:0;width:100%!important;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%}",
  "table{border-collapse:collapse;mso-table-lspace:0;mso-table-rspace:0}",
  "img{border:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic}",
  "a{text-decoration:underline}",
  ".ml-body a{color:inherit}",
  "u+#body a{color:inherit;text-decoration:none}",
].join("");

/**
 * Bez tohohle bloku Outlook při systémovém škálování nad 100 % zvětší obrázky
 * a rozloží layout. Emituje se přes raw slot, protože React komentář nevypustí.
 */
export const MSO_HEAD_BLOCK =
  "<!--[if mso]><xml><o:OfficeDocumentSettings><o:AllowPNG/>" +
  "<o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml><![endif]-->";

export function buildHeadCss(theme: ResolvedTheme): string {
  const parts: string[] = [RESET];
  parts.push(":root{color-scheme:light dark;supported-color-schemes:light dark}");

  const media = [
    `.ml-col{display:block!important;width:100%!important;max-width:100%!important}`,
    `.ml-hide-m{display:none!important}`,
    `.ml-pad{padding-left:${theme.mobile.pad}px!important;padding-right:${theme.mobile.pad}px!important}`,
    `.ml-h1{font-size:${theme.mobile.headingSize(1)}px!important;line-height:${theme.mobile.headingLineHeight}!important}`,
    `.ml-h2{font-size:${theme.mobile.headingSize(2)}px!important;line-height:${theme.mobile.headingLineHeight}!important}`,
    `.ml-h3{font-size:${theme.mobile.headingSize(3)}px!important;line-height:${theme.mobile.headingLineHeight}!important}`,
    `.ml-btn{width:100%!important}`,
  ].join("");
  parts.push(`@media only screen and (max-width:${theme.mobile.breakpoint}px){${media}}`);

  if (theme.darkModeEnabled) {
    const dark = theme.dark.roles;
    const rules = [
      `.ml-canvas{background-color:${dark["surface.canvas"]}!important}`,
      `.ml-content{background-color:${dark["surface.content"]}!important}`,
      `.ml-text{color:${dark["text.default"]}!important}`,
      `.ml-muted{color:${dark["text.muted"]}!important}`,
      `.ml-link{color:${dark["link.default"]}!important}`,
      `.ml-logo-light{display:none!important}`,
      `.ml-logo-dark{display:block!important;max-height:none!important;overflow:visible!important}`,
    ].join("");
    parts.push(`@media (prefers-color-scheme:dark){${rules}}`);
    // Outlook.com injektuje data-ogsc a data-ogsb při renderu v tmavém režimu.
    parts.push(
      `[data-ogsc] .ml-text{color:${dark["text.default"]}!important}` +
      `[data-ogsc] .ml-muted{color:${dark["text.muted"]}!important}` +
      `[data-ogsc] .ml-link{color:${dark["link.default"]}!important}` +
      `[data-ogsb] .ml-canvas{background-color:${dark["surface.canvas"]}!important}` +
      `[data-ogsb] .ml-content{background-color:${dark["surface.content"]}!important}`,
    );
  }
  return parts.join("");
}
```

- [ ] **Step 5: Spusť test a ověř, že projde**

Run: `pnpm vitest run packages/emails/test/emitter/head-css.test.ts`
Expected: PASS, 7 testů.

- [ ] **Step 6: Commit**

```bash
git add packages/emails/src/emitter/style.ts packages/emails/src/emitter/head-css.ts packages/emails/test/emitter/head-css.test.ts
git commit -m "feat(emails): theme derived head css and mso settings"
```

---

### Task 15: Kontext emitteru, raw žeton a obálka podmínky

**Files:**
- Create: `packages/emails/src/compile/types.ts`
- Create: `packages/emails/src/emitter/ctx.tsx`
- Create: `packages/emails/src/emitter/raw.tsx`
- Create: `packages/emails/src/emitter/visibility.tsx`
- Test: `packages/emails/test/emitter/visibility.test.tsx`

Podmínka se emituje **jako obyčejný textový uzel**, ne přes raw slot. Je to možné právě proto, že `{% if _present.contact__city %}` neobsahuje uvozovku, `<`, `>`, `&` ani apostrof, tedy nic, co by React escapoval. Přesně kvůli tomu se pravdivost počítá mimo Liquid (nález K4).

- [ ] **Step 1: Napiš padající test**

`packages/emails/test/emitter/visibility.test.tsx`:

```tsx
import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";
import { presenceKey, Visible, visibilityTags } from "../../src/emitter/visibility.js";

describe("visibility", () => {
  it("maps a field path to a presence key with double underscores", () => {
    expect(presenceKey("contact.city")).toBe("contact__city");
    expect(presenceKey("contact.attr.mesto")).toBe("contact__attr__mesto");
  });

  it("emits if and endif over the presence map for present", () => {
    expect(visibilityTags({ field: "contact.city", op: "present" }))
      .toEqual(["{% if _present.contact__city %}", "{% endif %}"]);
  });

  it("emits unless and endunless over the presence map for blank", () => {
    expect(visibilityTags({ field: "contact.city", op: "blank" }))
      .toEqual(["{% unless _present.contact__city %}", "{% endunless %}"]);
  });

  it("uses the field itself for boolean operators, no presence map needed", () => {
    expect(visibilityTags({ field: "contact.attr.is_vip", op: "true" }))
      .toEqual(["{% if contact.attr.is_vip %}", "{% endif %}"]);
    expect(visibilityTags({ field: "contact.attr.is_vip", op: "false" }))
      .toEqual(["{% unless contact.attr.is_vip %}", "{% endunless %}"]);
  });

  it("survives react rendering without a single html entity", async () => {
    const html = await render(
      <Visible when={{ field: "contact.city", op: "present" }}>
        <table><tbody><tr><td>x</td></tr></tbody></table>
      </Visible>,
    );
    expect(html).toContain("{% if _present.contact__city %}");
    expect(html).toContain("{% endif %}");
    expect(html).not.toMatch(/&(quot|#39|lt|gt|amp);/);
  });

  it("renders children untouched when there is no condition", async () => {
    const html = await render(<Visible when={null}><span>x</span></Visible>);
    expect(html).not.toContain("{%");
    expect(html).toContain("<span>x</span>");
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm vitest run packages/emails/test/emitter/visibility.test.tsx`
Expected: FAIL, moduly neexistují.

- [ ] **Step 3: Napiš `packages/emails/src/compile/types.ts`**

Tohle je **kontrakt 5** v TypeScriptu. Vlastní ho tenhle plán, protože vlastní kompilaci, a po odsouhlasení se nemění, jen verzuje. Tři pole proti znění v 4.1.1 přibyla, viz rozhodnutí D1 a D2.

```ts
import type { FieldCatalog, FieldCatalogType } from "@mlain/core/contacts/fields/catalog";
import type { Issue } from "../issue.js";

/**
 * `RenderSchema` vlastní **tenhle plán**, protože je součástí kontraktu 5.
 * V kontraktech je typ téhož jména, ale je to **něco jiného**: úzký tvar
 * `{ fields: readonly string[]; presence: readonly string[] }`, který potřebuje
 * `prepareRenderData`. Kdo předává `renderSchema` do `prepareRenderData`, zúží ho
 * volání `toPreparedSchema()` z `../paths.js`, nikdy ne přetypováním.
 */
export type RenderSchemaField = {
  path: string;
  type: FieldCatalogType;
  required: boolean;
};

export type RenderSchema = {
  version: 1;
  fields: RenderSchemaField[];
  systemTags: string[];
  presence: string[];
  /** MVP 0 je vždy prázdné: blok `repeat` se nikdy neemituje. */
  loops: string[];
};

/** Data assetu, která renderer potřebuje. Vyzvedne je volající, renderer nedělá IO. */
export type AssetRef = {
  id: string;
  publicId: string;
  mimeType: string;
  width: number | null;
  height: number | null;
  altText: string | null;
  animated: boolean;
  variants: Array<{ variant: string; width: number; height: number }>;
};

export type CompileContext = {
  workspaceId: string;
  /** POVINNÉ při purpose = "send". Vstupuje do odvození link_id. */
  campaignId?: string;
  templateKind: "campaign" | "transactional" | "system";
  fields: FieldCatalog;
  /** BCP 47 tag, libovolný platný. Neznámý tag kompilaci neshodí. */
  language: string;
  assetBaseUrl: string;
  /** Doplněno rozhodnutím D1. Klíč je assetId. */
  assets: Record<string, AssetRef>;
  // Pole `brand` tady BYLO a je vyškrtnuté. Nikdo ho neplnil: `brand_profiles`
  // tenhle plán nečte a značka vstupuje do dokumentu už při generování základní
  // šablony (`brandToTheme`, Task 29), ne při kompilaci. Nepovinné pole, které
  // nikdo nenaplní, je mrtvá větev: vypadá jako podporovaná možnost a při prvním
  // pokusu ji použít se zjistí, že se nikdy nikam nedostane.
  purpose: "send" | "preview" | "test";
  trackOpens: boolean;
  trackClicks: boolean;
  /** Doplněno rozhodnutím D2. Vyhodnocuje se při kompilaci, ne senderem. */
  preheader?: string;
  /** Doplněno rozhodnutím D2. Vstup, ne new Date(), kvůli determinismu. */
  currentYear: number;
  /** Jen pro testy: pevný nonce raw slotů. V produkci se nikdy nepředává. */
  rawNonce?: string;
};

export type CompiledLink = {
  /** UUIDv5. JE to <link_id> ve značce i v payloadu click tokenu. */
  id: string;
  /** 1..N, souvislá řada podle prvního výskytu. Jen pro řazení a report, ve značce není. */
  position: number;
  /** Absolutní statická URL, nikdy neobsahuje Liquid výraz. */
  url: string;
  trackable: boolean;
  label: string;
};

export type CompileMeta = {
  contractVersion: 1;
  rendererVersion: string;
  schemaVersion: number;
  usedPaths: string[];
  renderSchema: RenderSchema;
  links: CompiledLink[];
  assetIds: string[];
  htmlBytes: number;
  textBytes: number;
  warnings: Issue[];
  hasUnsubscribeLink: boolean;
  /** Kolik značek odkazů je v html plus text dohromady. */
  clickMarkerCount: number;
  hasOpenPixelSlot: boolean;
};

export type CompileResult =
  | { ok: true; html: string; text: string; meta: CompileMeta }
  | { ok: false; issues: Issue[] };

/** Verze rendereru je nezávislá na schemaVersion a zvyšuje se při každé změně výstupu. */
export const RENDERER_VERSION = "r1.0.0";
export const CONTRACT_VERSION = 1 as const;
```

- [ ] **Step 4: Napiš `packages/emails/src/emitter/ctx.tsx`**

```tsx
import { createContext, useContext } from "react";
import type { AssetRef } from "../compile/types.js";
import type { RawSlotSink } from "../normalize/slots.js";
import type { ResolvedTheme } from "../theme/resolve.js";

export type EmitterState = {
  theme: ResolvedTheme;
  raw: RawSlotSink;
  assets: Record<string, AssetRef>;
  assetBaseUrl: string;
  language: string;
  skippedBlockIds: Set<string>;
  trackClicks: boolean;
  /** Značka odkazu podle kontraktu 5, doplní ji collectLinks při normalizaci odkazů. */
  linkHref: (href: string, trackable: boolean) => string;
  /** Popisky dodávané produktem podle jazyka (patička, oddělovače). */
  t: (key: string) => string;
};

const EmitterContext = createContext<EmitterState | null>(null);

export const EmitterProvider = EmitterContext.Provider;

export function useEmitter(): EmitterState {
  const value = useContext(EmitterContext);
  if (!value) throw new Error("Emitter components must be rendered inside EmitterProvider.");
  return value;
}
```

- [ ] **Step 5: Napiš `packages/emails/src/emitter/raw.tsx`**

```tsx
import type { ReactElement } from "react";
import { useEmitter } from "./ctx.js";

/**
 * Vypustí do stromu textový žeton, který kompilace po renderu nahradí syrovým HTML.
 * Nepoužívá se React atribut pro vkládání HTML, protože ten vždy potřebuje
 * obalový element, a `<span>` mezi `<table>` a `<tr>` rozbije strukturu v Outlooku.
 */
export function Raw({ html }: { html: string }): ReactElement {
  const { raw } = useEmitter();
  return <>{raw.add(html)}</>;
}

/** Varianta pro místa, kde je potřeba jen řetězec, například jako children. */
export function useRaw(): (html: string) => string {
  const { raw } = useEmitter();
  return (html: string) => raw.add(html);
}
```

- [ ] **Step 6: Napiš `packages/emails/src/emitter/visibility.tsx`**

```tsx
import type { ReactElement, ReactNode } from "react";
import type { VisibilityCondition } from "../document/types.js";

/**
 * Klíč do pomocné mapy `_present`: cesta pole s tečkami nahrazenými dvěma podtržítky.
 * Dva segmenty i u vlastního pole, takže se zůstává pod kontraktním limitem tří segmentů.
 */
export function presenceKey(field: string): string {
  return field.split(".").join("__");
}

/**
 * Emitovaná konstrukce neobsahuje uvozovku, literál `blank`, literál `empty`
 * ani operátor porovnání, tedy nic ze zakázaných konstrukcí. Nález K4 se tím
 * obchází úplně a past prázdného řetězce se zavírá v datech, ne v šabloně.
 */
export function visibilityTags(condition: VisibilityCondition): [string, string] {
  switch (condition.op) {
    case "present":
      return [`{% if _present.${presenceKey(condition.field)} %}`, "{% endif %}"];
    case "blank":
      return [`{% unless _present.${presenceKey(condition.field)} %}`, "{% endunless %}"];
    case "true":
      return [`{% if ${condition.field} %}`, "{% endif %}"];
    case "false":
      return [`{% unless ${condition.field} %}`, "{% endunless %}"];
  }
}

export function Visible(
  { when, children }: { when?: VisibilityCondition | null; children: ReactNode },
): ReactElement {
  if (!when) return <>{children}</>;
  const [open, close] = visibilityTags(when);
  return <>{open}{children}{close}</>;
}
```

- [ ] **Step 7: Spusť test a ověř, že projde**

Run: `pnpm vitest run packages/emails/test/emitter/visibility.test.tsx`
Expected: PASS, 6 testů. Test „survives react rendering" je nejdůležitější: kdyby se do konstrukce dostal jakýkoliv operátor porovnání nebo uvozovka, tenhle test spadne na entitách.

- [ ] **Step 8: Commit**

```bash
git add packages/emails/src/compile/types.ts packages/emails/src/emitter/ctx.tsx packages/emails/src/emitter/raw.tsx packages/emails/src/emitter/visibility.tsx packages/emails/test/emitter/visibility.test.tsx
git commit -m "feat(emails): contract types, emitter context, raw slots and visibility wrapper"
```

---

### Task 16: Emitter bohatého textu

**Files:**
- Create: `packages/emails/src/emitter/rich-text.tsx`
- Test: `packages/emails/test/emitter/rich-text.test.tsx`

**Poznámka k React komponentám v tomhle balíčku.** Strom se renderuje **výhradně na serveru** funkcí `render` z `@react-email/render` a nikdy se nehydratuje. Nejsou tu žádné efekty, žádný stav, žádné události. Pravidla o překreslování, memoizaci a velikosti bundlu se na něj proto nevztahují; jediné, co platí, je zákaz barrel importů, který drží už struktura balíčku.

Kritérium 12 a 12b: Liquid výraz ve výstupu musí být **znak po znaku** shodný se zdrojem, s jedinou výjimkou argumentu filtru. Marker se proto vkládá záměnou přesně za název filtru, ne přeskládáním výrazu.

- [ ] **Step 1: Napiš padající test**

`packages/emails/test/emitter/rich-text.test.tsx`:

```tsx
import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";
import { DEFAULT_THEME } from "../../src/document/defaults.js";
import { resolveTheme } from "../../src/theme/resolve.js";
import { RawSlotSink } from "../../src/normalize/slots.js";
import { EmitterProvider } from "../../src/emitter/ctx.js";
import { RichTextView, varOutput } from "../../src/emitter/rich-text.js";
import type { RichText } from "../../src/document/types.js";

const state = () => ({
  theme: resolveTheme(DEFAULT_THEME),
  raw: new RawSlotSink("ab12cd34ef"),
  assets: {},
  assetBaseUrl: "https://assets.test",
  language: "cs",
  skippedBlockIds: new Set<string>(),
  trackClicks: true,
  linkHref: (href: string, trackable: boolean) =>
    trackable ? "https://track.mlain.invalid/c/2f1a9c40-0000-5000-8000-000000000001" : href,
  t: (key: string) => key,
});

const renderRich = (rich: RichText) =>
  render(
    <EmitterProvider value={state()}>
      <div><RichTextView rich={rich} color="#111827" linkColor="#1d4ed8" /></div>
    </EmitterProvider>,
  );

describe("varOutput", () => {
  it("wraps a plain expression in braces without touching it", () => {
    expect(varOutput({ t: "var", expr: "contact.first_name" })).toBe("{{ contact.first_name }}");
  });

  it("inserts the default argument marker right after the filter name", () => {
    expect(varOutput({ t: "var", expr: "contact.first_name | default", fallback: "kolego", slots: { default: 7 } }))
      .toBe("{{ contact.first_name | default:ML_ARG_0007 }}");
  });

  it("keeps the author spacing of the rest of the expression", () => {
    expect(varOutput({ t: "var", expr: "contact.x|default", fallback: "y", slots: { default: 1 } }))
      .toBe("{{ contact.x|default:ML_ARG_0001 }}");
  });

  it("handles both filters on one node", () => {
    expect(varOutput({
      t: "var", expr: "contact.created_at | date | default",
      fallback: "brzy", dateFormat: "%d.%m.%Y", slots: { default: 1, date: 2 },
    })).toBe("{{ contact.created_at | date:ML_ARG_0002 | default:ML_ARG_0001 }}");
  });

  it("emits no marker when the node carries no argument", () => {
    expect(varOutput({ t: "var", expr: "contact.email | upcase" }))
      .toBe("{{ contact.email | upcase }}");
  });
});

describe("RichTextView", () => {
  it("renders a paragraph with the block colour", async () => {
    const html = await renderRich([{ t: "p", children: [{ t: "s", v: "Ahoj" }] }]);
    expect(html).toContain("Ahoj");
    expect(html).toContain("color:#111827");
  });

  it("applies marks in a fixed order so snapshots stay stable", async () => {
    const html = await renderRich([
      { t: "p", children: [{ t: "s", v: "x", b: true, i: true, u: true, strike: true }] },
    ]);
    expect(html).toContain("<strong><em><u><s>x</s></u></em></strong>");
  });

  it("renders lists with li items", async () => {
    const html = await renderRich([{ t: "ul", items: [[{ t: "s", v: "a" }], [{ t: "s", v: "b" }]] }]);
    expect(html).toContain("<li");
    expect(html).toContain("a");
    expect(html).toContain("b");
  });

  it("routes link hrefs through the tracking marker and paints them with linkColor", async () => {
    const html = await renderRich([
      { t: "p", children: [{ t: "a", href: "https://shop.cz/akce", children: [{ t: "s", v: "Akce" }] }] },
    ]);
    expect(html).toContain('href="https://track.mlain.invalid/c/2f1a9c40-0000-5000-8000-000000000001"');
    expect(html).toContain("color:#1d4ed8");
    expect(html).toContain('class="ml-link"');
  });

  it("leaves a liquid expression byte identical after react rendering", async () => {
    const html = await renderRich([
      { t: "p", children: [{ t: "var", expr: "contact.first_name | default", fallback: "kolego", slots: { default: 1 } }] },
    ]);
    expect(html).toContain("{{ contact.first_name | default:ML_ARG_0001 }}");
    expect(html).not.toContain("&quot;");
    expect(html).not.toContain("&#39;");
  });

  it("escapes user text but not the liquid construct around it", async () => {
    const html = await renderRich([
      { t: "p", children: [{ t: "s", v: "<b>&x</b>" }, { t: "var", expr: "contact.email" }] },
    ]);
    expect(html).toContain("&lt;b&gt;&amp;x&lt;/b&gt;");
    expect(html).toContain("{{ contact.email }}");
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm vitest run packages/emails/test/emitter/rich-text.test.tsx`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napiš implementaci**

`packages/emails/src/emitter/rich-text.tsx`:

```tsx
import type { CSSProperties, ReactElement, ReactNode } from "react";
import type { HexColor, InlineNode, RichText, VarInline } from "../document/types.js";
import { filterSlotMarker } from "../normalize/slots.js";
import { useEmitter } from "./ctx.js";

/**
 * Vyrobí Liquid výstup z uzlu `var`. Argument filtru se vkládá záměnou přesně
 * za název filtru, aby zbytek výrazu zůstal znak po znaku takový, jak ho napsal
 * autor (kritérium 12). Přeskládání výrazu by ten slib porušilo.
 */
export function varOutput(node: VarInline): string {
  let expr = node.expr;
  if (node.slots?.date !== undefined) {
    expr = expr.replace(/(\|\s*date)(?![\w])/, `$1:${filterSlotMarker(node.slots.date)}`);
  }
  if (node.slots?.default !== undefined) {
    expr = expr.replace(/(\|\s*default)(?![\w])/, `$1:${filterSlotMarker(node.slots.default)}`);
  }
  return `{{ ${expr} }}`;
}

function marks(node: Extract<InlineNode, { t: "s" }>): ReactNode {
  // Pevné pořadí obalů, jinak by se snapshoty rozjížděly podle pořadí klíčů v JSON.
  let out: ReactNode = node.v;
  if (node.strike) out = <s>{out}</s>;
  if (node.u) out = <u>{out}</u>;
  if (node.i) out = <em>{out}</em>;
  if (node.b) out = <strong>{out}</strong>;
  return out;
}

function Inline(
  { nodes, linkColor }: { nodes: InlineNode[]; linkColor: HexColor },
): ReactElement {
  const { linkHref } = useEmitter();
  return (
    <>
      {nodes.map((node, index) => {
        if (node.t === "s") return <span key={index}>{marks(node)}</span>;
        if (node.t === "br") return <br key={index} />;
        if (node.t === "var") return <span key={index}>{varOutput(node)}</span>;
        return (
          <a
            key={index}
            className="ml-link"
            href={linkHref(node.href, node.trackable !== false)}
            style={{ color: linkColor, textDecoration: "underline" }}
          >
            <Inline nodes={node.children} linkColor={linkColor} />
          </a>
        );
      })}
    </>
  );
}

export function RichTextView(
  {
    rich, color, linkColor, style, align,
  }: {
    rich: RichText;
    color: HexColor;
    linkColor: HexColor;
    style?: CSSProperties;
    align?: "left" | "center" | "right" | "justify";
  },
): ReactElement {
  const paragraph: CSSProperties = { margin: 0, color, textAlign: align ?? "left", ...style };
  return (
    <>
      {rich.map((node, index) => {
        if (node.t === "p") {
          return (
            <p key={index} className="ml-text" style={{ ...paragraph, textAlign: node.align ?? paragraph.textAlign }}>
              <Inline nodes={node.children} linkColor={linkColor} />
            </p>
          );
        }
        const List = node.t === "ul" ? "ul" : "ol";
        return (
          <List key={index} className="ml-text" style={{ ...paragraph, paddingLeft: "24px" }}>
            {node.items.map((item, itemIndex) => (
              <li key={itemIndex} style={{ color }}>
                <Inline nodes={item} linkColor={linkColor} />
              </li>
            ))}
          </List>
        );
      })}
    </>
  );
}
```

- [ ] **Step 4: Spusť test a ověř, že projde**

Run: `pnpm vitest run packages/emails/test/emitter/rich-text.test.tsx`
Expected: PASS, 11 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/emails/src/emitter/rich-text.tsx packages/emails/test/emitter/rich-text.test.tsx
git commit -m "feat(emails): rich text emitter with untouched liquid output"
```

---

### Task 17: Rám bloku, nadpis a text

**Files:**
- Create: `packages/emails/src/emitter/blocks/frame.tsx`
- Create: `packages/emails/src/emitter/blocks/heading.tsx`
- Create: `packages/emails/src/emitter/blocks/text.tsx`
- Test: `packages/emails/test/emitter/blocks/text-heading.test.tsx`

**Každý obsahový blok je vlastní `<table>`.** Vypadá to jako plýtvání značkami, ale řeší to dvě věci naráz: podmínku `{% if %}` je kam napsat (textový uzel mezi elementy uvnitř `<td>`, ne uvnitř `<tbody>`, kde by React hlásil neplatné vnoření), a Word engine dostane u každého modulu vlastní šířkový kontext.

- [ ] **Step 1: Napiš padající test**

`packages/emails/test/emitter/blocks/text-heading.test.tsx`:

```tsx
import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";
import { blockDefaults, DEFAULT_THEME } from "../../../src/document/defaults.js";
import { resolveTheme } from "../../../src/theme/resolve.js";
import { RawSlotSink } from "../../../src/normalize/slots.js";
import { EmitterProvider } from "../../../src/emitter/ctx.js";
import { HeadingBlockView } from "../../../src/emitter/blocks/heading.js";
import { TextBlockView } from "../../../src/emitter/blocks/text.js";

const state = () => ({
  theme: resolveTheme(DEFAULT_THEME),
  raw: new RawSlotSink("ab12cd34ef"),
  assets: {},
  assetBaseUrl: "https://assets.test",
  language: "cs",
  skippedBlockIds: new Set<string>(),
  trackClicks: true,
  linkHref: (href: string) => href,
  t: (key: string) => key,
});

const wrap = (node: React.ReactElement) =>
  render(<EmitterProvider value={state()}>{node}</EmitterProvider>);

describe("heading block", () => {
  it("renders the semantic level and the derived size", async () => {
    const block = {
      id: "b_000000000001", type: "heading" as const,
      props: { ...blockDefaults("heading"), level: 1 as const, content: [{ t: "p" as const, children: [{ t: "s" as const, v: "Vítejte" }] }] },
    };
    const html = await wrap(<HeadingBlockView block={block} />);
    expect(html).toContain("<h1");
    expect(html).toContain("font-size:31px");
    expect(html).toContain('class="ml-h1');
    expect(html).toContain("Vítejte");
  });

  it("uses the heading font stack from the theme", async () => {
    const block = {
      id: "b_000000000001", type: "heading" as const,
      props: { ...blockDefaults("heading"), content: [{ t: "p" as const, children: [] }] },
    };
    expect(await wrap(<HeadingBlockView block={block} />)).toContain("Segoe UI");
  });

  it("emits an exact pixel line height with the mso rule", async () => {
    const block = {
      id: "b_000000000001", type: "heading" as const,
      props: { ...blockDefaults("heading"), level: 2 as const, content: [{ t: "p" as const, children: [] }] },
    };
    const html = await wrap(<HeadingBlockView block={block} />);
    expect(html).toContain("mso-line-height-rule:exactly");
    expect(html).toContain("line-height:31px");
  });
});

describe("text block", () => {
  it("wraps the block in a table with padding on the td", async () => {
    const block = {
      id: "b_000000000001", type: "text" as const,
      props: {
        ...blockDefaults("text"),
        content: [{ t: "p" as const, children: [{ t: "s" as const, v: "Ahoj" }] }],
      },
    };
    const html = await wrap(<TextBlockView block={block} />);
    expect(html).toContain("<table");
    expect(html).toContain('role="presentation"');
    expect(html).toContain("padding-right:24px");
    expect(html).toContain('class="ml-pad"');
  });

  it("wraps the block in a liquid condition when visibleWhen is set", async () => {
    const block = {
      id: "b_000000000001", type: "text" as const,
      visibleWhen: { field: "contact.city", op: "present" as const },
      props: { ...blockDefaults("text"), content: [{ t: "p" as const, children: [] }] },
    };
    const html = await wrap(<TextBlockView block={block} />);
    expect(html).toContain("{% if _present.contact__city %}");
    expect(html).toContain("{% endif %}");
  });

  it("adds the mobile hiding class only when hideOnMobile is on", async () => {
    const off = { id: "b_000000000001", type: "text" as const, props: { ...blockDefaults("text"), content: [] } };
    expect(await wrap(<TextBlockView block={off} />)).not.toContain("ml-hide-m");
    const on = { ...off, props: { ...off.props, hideOnMobile: true } };
    expect(await wrap(<TextBlockView block={on} />)).toContain("ml-hide-m");
  });

  it("paints an explicit background instead of leaving it transparent", async () => {
    const block = {
      id: "b_000000000001", type: "text" as const,
      props: { ...blockDefaults("text"), backgroundColor: "surface.subtle" as const, content: [] },
    };
    expect(await wrap(<TextBlockView block={block} />)).toContain("background-color:#e5e7eb");
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm vitest run packages/emails/test/emitter/blocks/text-heading.test.tsx`
Expected: FAIL, moduly neexistují.

- [ ] **Step 3: Napiš `packages/emails/src/emitter/blocks/frame.tsx`**

```tsx
import type { CSSProperties, ReactElement, ReactNode } from "react";
import type { ColorRef, Padding, VisibilityCondition } from "../../document/types.js";
import { useEmitter } from "../ctx.js";
import { paddingStyle } from "../style.js";
import { Visible } from "../visibility.js";

export type FrameProps = {
  padding: Padding;
  backgroundColor: ColorRef | null;
  hideOnMobile: boolean;
  visibleWhen?: VisibilityCondition | null;
  tdStyle?: CSSProperties;
  align?: "left" | "center" | "right";
  children: ReactNode;
};

/**
 * Jednotný rám obsahového bloku: vlastní tabulka, odsazení na `<td>`, nikdy na `<div>`.
 * Word engine `padding` na `<div>` ignoruje a `margin` je v něm nespolehlivý.
 */
export function BlockFrame(props: FrameProps): ReactElement {
  const { theme } = useEmitter();
  const background = props.backgroundColor ? theme.light.color(props.backgroundColor) : undefined;
  return (
    <Visible when={props.visibleWhen}>
      <table
        role="presentation"
        width="100%"
        cellPadding={0}
        cellSpacing={0}
        border={0}
        className={props.hideOnMobile ? "ml-hide-m" : undefined}
        style={{ width: "100%", borderCollapse: "collapse" }}
      >
        <tbody>
          <tr>
            <td
              className="ml-pad"
              align={props.align ?? "left"}
              style={{
                ...paddingStyle(props.padding),
                ...(background ? { backgroundColor: background } : {}),
                ...props.tdStyle,
              }}
            >
              {props.children}
            </td>
          </tr>
        </tbody>
      </table>
    </Visible>
  );
}
```

- [ ] **Step 4: Napiš `packages/emails/src/emitter/blocks/heading.tsx`**

```tsx
import type { ReactElement } from "react";
import type { HeadingBlock } from "../../document/types.js";
import { useEmitter } from "../ctx.js";
import { RichTextView } from "../rich-text.js";
import { lineHeightStyle, px } from "../style.js";
import { BlockFrame } from "./frame.js";

export function HeadingBlockView({ block }: { block: HeadingBlock }): ReactElement {
  const { theme } = useEmitter();
  const props = block.props;
  const size = props.fontSize ?? theme.headingSize(props.level);
  const lineHeight = props.lineHeight ?? 1.25;
  const Tag = (["h1", "h2", "h3"] as const)[props.level - 1]!;
  return (
    <BlockFrame
      padding={props.padding}
      backgroundColor={props.backgroundColor}
      hideOnMobile={props.hideOnMobile}
      visibleWhen={block.visibleWhen}
      align={props.align}
    >
      <Tag
        className={`ml-h${props.level} ml-text`}
        style={{
          margin: 0,
          fontFamily: props.fontFamily ? theme.fonts.heading : theme.fonts.heading,
          fontSize: px(size),
          fontWeight: props.fontWeight,
          letterSpacing: px(props.letterSpacing),
          textAlign: props.align,
          color: theme.light.color(props.color),
          ...lineHeightStyle(size, lineHeight),
        }}
      >
        <RichTextView
          rich={props.content}
          color={theme.light.color(props.color)}
          linkColor={theme.light.roles["link.default"]}
          align={props.align}
          style={{ fontSize: px(size), fontWeight: props.fontWeight }}
        />
      </Tag>
    </BlockFrame>
  );
}
```

- [ ] **Step 5: Napiš `packages/emails/src/emitter/blocks/text.tsx`**

```tsx
import type { ReactElement } from "react";
import type { TextBlock } from "../../document/types.js";
import { useEmitter } from "../ctx.js";
import { RichTextView } from "../rich-text.js";
import { lineHeightStyle, px } from "../style.js";
import { BlockFrame } from "./frame.js";

export function TextBlockView({ block }: { block: TextBlock }): ReactElement {
  const { theme } = useEmitter();
  const props = block.props;
  const size = props.fontSize ?? theme.baseFontSize;
  const lineHeight = props.lineHeight ?? theme.baseLineHeight;
  return (
    <BlockFrame
      padding={props.padding}
      backgroundColor={props.backgroundColor}
      hideOnMobile={props.hideOnMobile}
      visibleWhen={block.visibleWhen}
      tdStyle={{
        fontFamily: props.fontFamily ? theme.fonts.body : theme.fonts.body,
        fontSize: px(size),
        color: theme.light.color(props.color),
        ...lineHeightStyle(size, lineHeight),
      }}
    >
      <RichTextView
        rich={props.content}
        color={theme.light.color(props.color)}
        linkColor={theme.light.color(props.linkColor)}
        align={props.align}
        style={{ fontSize: px(size), ...lineHeightStyle(size, lineHeight) }}
      />
    </BlockFrame>
  );
}
```

- [ ] **Step 6: Spusť test a ověř, že projde**

Run: `pnpm vitest run packages/emails/test/emitter/blocks/text-heading.test.tsx`
Expected: PASS, 7 testů.

- [ ] **Step 7: Commit**

```bash
git add packages/emails/src/emitter/blocks packages/emails/test/emitter/blocks
git commit -m "feat(emails): block frame, heading and text emitters"
```

---

### Task 18: Obrázek a adresy assetů

**Files:**
- Create: `packages/emails/src/emitter/assets.ts`
- Create: `packages/emails/src/emitter/blocks/image.tsx`
- Test: `packages/emails/test/emitter/blocks/image.test.tsx`

Kritérium 62: obrázek v bloku širokém 600 px se odkazuje na variantu `w1200` a má `width="600"`. Retina se řeší dvojnásobným zdrojem, ne dvojnásobným atributem.

- [ ] **Step 1: Napiš padající test**

`packages/emails/test/emitter/blocks/image.test.tsx`:

```tsx
import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";
import { blockDefaults, DEFAULT_THEME } from "../../../src/document/defaults.js";
import { resolveTheme } from "../../../src/theme/resolve.js";
import { RawSlotSink } from "../../../src/normalize/slots.js";
import { EmitterProvider } from "../../../src/emitter/ctx.js";
import { assetUrl, pickVariant } from "../../../src/emitter/assets.js";
import { ImageBlockView } from "../../../src/emitter/blocks/image.js";
import type { AssetRef } from "../../../src/compile/types.js";

const photo: AssetRef = {
  id: "0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071",
  publicId: "aB3dEfGhIjKlMnOpQrStUv",
  mimeType: "image/jpeg",
  width: 2400, height: 1200, altText: null, animated: false,
  variants: [
    { variant: "orig", width: 2400, height: 1200 },
    { variant: "w1200", width: 1200, height: 600 },
    { variant: "w600", width: 600, height: 300 },
    { variant: "w300", width: 300, height: 150 },
  ],
};

const gif: AssetRef = {
  ...photo, id: "0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6072", publicId: "gifgifgifgifgifgifgifg",
  mimeType: "image/gif", animated: true,
  variants: [{ variant: "orig", width: 600, height: 300 }],
};

const state = (assets: Record<string, AssetRef>) => ({
  theme: resolveTheme(DEFAULT_THEME),
  raw: new RawSlotSink("ab12cd34ef"),
  assets,
  assetBaseUrl: "https://assets.test",
  language: "cs",
  skippedBlockIds: new Set<string>(),
  trackClicks: true,
  linkHref: (href: string, trackable: boolean) =>
    trackable ? "https://track.mlain.invalid/c/2f1a9c40-0000-5000-8000-000000000001" : href,
  t: (key: string) => key,
});

const wrap = (node: React.ReactElement, assets: Record<string, AssetRef>) =>
  render(<EmitterProvider value={state(assets)}>{node}</EmitterProvider>);

describe("asset urls", () => {
  it("builds the public url from the base, the public id and the variant", () => {
    expect(assetUrl("https://assets.test", photo, "w600"))
      .toBe("https://assets.test/a/aB3dEfGhIjKlMnOpQrStUv/w600.jpg");
  });

  it("uses png for png assets and gif for gif assets", () => {
    expect(assetUrl("https://assets.test", { ...photo, mimeType: "image/png" }, "orig"))
      .toBe("https://assets.test/a/aB3dEfGhIjKlMnOpQrStUv/orig.png");
    expect(assetUrl("https://assets.test", gif, "orig"))
      .toBe("https://assets.test/a/gifgifgifgifgifgifgifg/orig.gif");
  });

  it("picks the smallest variant at least twice the display width", () => {
    expect(pickVariant(photo, 600)).toBe("w1200");
    expect(pickVariant(photo, 150)).toBe("w300");
    expect(pickVariant(photo, 1400)).toBe("orig");
  });

  it("keeps the original for an animated gif so the animation survives", () => {
    expect(pickVariant(gif, 300)).toBe("orig");
  });
});

describe("image block", () => {
  const block = (over: Record<string, unknown> = {}) => ({
    id: "b_000000000001", type: "image" as const,
    props: { ...blockDefaults("image"), assetId: photo.id, alt: "Fotka", ...over },
  });

  it("emits width and height attributes and display block", async () => {
    const html = await wrap(<ImageBlockView block={block()} width={600} />, { [photo.id]: photo });
    expect(html).toContain('width="600"');
    expect(html).toContain('height="300"');
    expect(html).toContain("display:block");
    expect(html).toContain("/w1200.jpg");
  });

  it("always emits an alt attribute, even empty for decorative images", async () => {
    const html = await wrap(
      <ImageBlockView block={block({ decorative: true, alt: "" })} width={600} />,
      { [photo.id]: photo },
    );
    expect(html).toContain('alt=""');
    expect(html).toContain('role="presentation"');
  });

  it("wraps a linked image in the tracking marker", async () => {
    const html = await wrap(
      <ImageBlockView block={block({ href: "https://shop.cz/akce" })} width={600} />,
      { [photo.id]: photo },
    );
    expect(html).toContain('href="https://track.mlain.invalid/c/2f1a9c40-0000-5000-8000-000000000001"');
  });

  it("emits both logo variants when a dark asset is set", async () => {
    const dark = { ...photo, id: "0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6073", publicId: "darkdarkdarkdarkdarkda" };
    const html = await wrap(
      <ImageBlockView block={block({ darkVariantAssetId: dark.id })} width={600} />,
      { [photo.id]: photo, [dark.id]: dark },
    );
    expect(html).toContain("ml-logo-light");
    expect(html).toContain("ml-logo-dark");
    expect(html).toContain("mso-hide:all");
  });

  it("renders nothing when the asset is missing instead of emitting a broken img", async () => {
    const html = await wrap(<ImageBlockView block={block()} width={600} />, {});
    expect(html).not.toContain("<img");
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm vitest run packages/emails/test/emitter/blocks/image.test.tsx`
Expected: FAIL, moduly neexistují.

- [ ] **Step 3: Napiš `packages/emails/src/emitter/assets.ts`**

```ts
import type { AssetRef } from "../compile/types.js";

const EXTENSION_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
};

/** Veřejná adresa assetu podle 3.14.4: <ASSET_BASE_URL>/a/{public_id}/{variant}.{ext} */
export function assetUrl(baseUrl: string, asset: AssetRef, variant: string): string {
  const extension = EXTENSION_BY_MIME[asset.mimeType] ?? "png";
  return `${baseUrl.replace(/\/$/, "")}/a/${asset.publicId}/${variant}.${extension}`;
}

/**
 * Nejmenší varianta aspoň dvojnásobku zobrazované šířky, kvůli displejům s vysokým DPI.
 * Animovaný GIF varianty nemá, protože zpracování by animaci zahodilo.
 */
export function pickVariant(asset: AssetRef, displayWidth: number): string {
  if (asset.animated) return "orig";
  const wanted = displayWidth * 2;
  const usable = asset.variants
    .filter((variant) => variant.variant !== "thumb")
    .slice()
    .sort((a, b) => a.width - b.width);
  const found = usable.find((variant) => variant.width >= wanted);
  return found?.variant ?? usable[usable.length - 1]?.variant ?? "orig";
}

/** Ikony sítí dodává produkt, nejsou to assety projektu. Viz požadavek R6. */
export function socialIconUrl(baseUrl: string, network: string, style: string): string {
  return `${baseUrl.replace(/\/$/, "")}/a/social/${network}-${style}@2x.png`;
}
```

- [ ] **Step 4: Napiš `packages/emails/src/emitter/blocks/image.tsx`**

```tsx
import { Img } from "@react-email/components";
import type { ReactElement, ReactNode } from "react";
import type { AssetRef } from "../../compile/types.js";
import type { ImageBlock } from "../../document/types.js";
import { assetUrl, pickVariant } from "../assets.js";
import { useEmitter } from "../ctx.js";
import { px } from "../style.js";
import { BlockFrame } from "./frame.js";

function scaledHeight(asset: AssetRef, displayWidth: number): number {
  if (!asset.width || !asset.height) return displayWidth;
  return Math.round((displayWidth * asset.height) / asset.width);
}

function Picture(
  { asset, block, displayWidth, className }:
  { asset: AssetRef; block: ImageBlock; displayWidth: number; className?: string },
): ReactElement {
  const { assetBaseUrl, theme } = useEmitter();
  const radius = block.props.borderRadius ?? theme.radius;
  return (
    <Img
      className={className}
      src={assetUrl(assetBaseUrl, asset, pickVariant(asset, displayWidth))}
      width={displayWidth}
      height={scaledHeight(asset, displayWidth)}
      alt={block.props.decorative ? "" : block.props.alt}
      {...(block.props.decorative ? { role: "presentation" } : {})}
      style={{
        display: "block",
        border: 0,
        outline: "none",
        textDecoration: "none",
        maxWidth: "100%",
        height: "auto",
        borderRadius: px(radius),
      }}
    />
  );
}

export function ImageBlockView(
  { block, width }: { block: ImageBlock; width: number },
): ReactElement | null {
  const { assets, linkHref } = useEmitter();
  const asset = assets[block.props.assetId];
  // Chybějící asset zastaví validátor pravidlem S6. Kdyby přesto prošel,
  // je lepší obrázek vynechat než odeslat rozbitý <img> bez rozměrů.
  if (!asset) return null;

  const displayWidth = block.props.width === "full"
    ? width
    : Math.min(block.props.width, width);
  const darkAsset = block.props.darkVariantAssetId
    ? assets[block.props.darkVariantAssetId]
    : undefined;

  const picture: ReactNode = darkAsset ? (
    <>
      <div className="ml-logo-dark" style={{ display: "none", maxHeight: 0, overflow: "hidden", msoHide: "all" } as React.CSSProperties}>
        <Picture asset={darkAsset} block={block} displayWidth={displayWidth} />
      </div>
      <div className="ml-logo-light">
        <Picture asset={asset} block={block} displayWidth={displayWidth} />
      </div>
    </>
  ) : (
    <Picture asset={asset} block={block} displayWidth={displayWidth} />
  );

  return (
    <BlockFrame
      padding={block.props.padding}
      backgroundColor={block.props.backgroundColor}
      hideOnMobile={block.props.hideOnMobile}
      visibleWhen={block.visibleWhen}
      align={block.props.align}
    >
      {block.props.href
        ? <a href={linkHref(block.props.href, block.props.trackable)}>{picture}</a>
        : picture}
    </BlockFrame>
  );
}
```

- [ ] **Step 5: Spusť test a ověř, že projde**

Run: `pnpm vitest run packages/emails/test/emitter/blocks/image.test.tsx`
Expected: PASS, 9 testů.

- [ ] **Step 6: Commit**

```bash
git add packages/emails/src/emitter/assets.ts packages/emails/src/emitter/blocks/image.tsx packages/emails/test/emitter/blocks/image.test.tsx
git commit -m "feat(emails): image emitter with retina variant selection"
```

---

### Task 19: Tlačítko s VML dvojčetem

**Files:**
- Create: `packages/emails/src/compile/apply-slots.ts`
- Create: `packages/emails/src/emitter/inline-html.ts`
- Create: `packages/emails/src/emitter/blocks/button.tsx`
- Test: `packages/emails/test/compile/apply-slots.test.ts`
- Test: `packages/emails/test/emitter/blocks/button.test.tsx`

Kritéria 11 a 16, a fixture `CT-007`. Tlačítko emituje popisek **dvakrát**, jednou ve VML variantě pro Outlook a jednou v tabulkové. Obě místa nesou **týž** slot a **týž** řetězec značky odkazu, takže je jedna záměna opraví shodně. Naivní implementace, která by v každé variantě generovala jiný slot, by prošla typechecku i validátoru a rozbila se až u zákazníka.

- [ ] **Step 1: Napiš padající test**

`packages/emails/test/emitter/blocks/button.test.tsx`:

```tsx
import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";
import { blockDefaults, DEFAULT_THEME } from "../../../src/document/defaults.js";
import { resolveTheme } from "../../../src/theme/resolve.js";
import { RawSlotSink } from "../../../src/normalize/slots.js";
import { EmitterProvider } from "../../../src/emitter/ctx.js";
import { applyRawSlots } from "../../../src/compile/apply-slots.js";
import { ButtonBlockView } from "../../../src/emitter/blocks/button.js";
import { inlineToHtmlString } from "../../../src/emitter/inline-html.js";

const MARKER = "https://track.mlain.invalid/c/2f1a9c40-0000-5000-8000-000000000001";

async function renderButton(props: Record<string, unknown>) {
  const sink = new RawSlotSink("ab12cd34ef");
  const state = {
    theme: resolveTheme(DEFAULT_THEME),
    raw: sink,
    assets: {},
    assetBaseUrl: "https://assets.test",
    language: "cs",
    skippedBlockIds: new Set<string>(),
    trackClicks: true,
    linkHref: (href: string, trackable: boolean) => (trackable ? MARKER : href),
    t: (key: string) => key,
  };
  const block = {
    id: "b_000000000001", type: "button" as const,
    props: { ...blockDefaults("button"), href: "https://shop.cz/akce", ...props },
  };
  const html = await render(
    <EmitterProvider value={state}>
      <ButtonBlockView block={block} width={552} />
    </EmitterProvider>,
  );
  return applyRawSlots(html, sink);
}

describe("inlineToHtmlString", () => {
  it("escapes user text and leaves the liquid construct alone", () => {
    expect(inlineToHtmlString([
      { t: "s", v: "A & <b>" },
      { t: "var", expr: "contact.first_name | default", fallback: "kolego", slots: { default: 3 } },
    ])).toBe("A &amp; &lt;b&gt;{{ contact.first_name | default:ML_ARG_0003 }}");
  });

  it("keeps marks and line breaks", () => {
    expect(inlineToHtmlString([{ t: "s", v: "x", b: true }, { t: "br" }]))
      .toBe("<strong>x</strong><br />");
  });
});

describe("button block", () => {
  it("emits the vml variant inside a conditional comment and the table variant outside", async () => {
    const html = await renderButton({});
    expect(html).toContain("<!--[if mso]>");
    expect(html).toContain("<v:roundrect");
    expect(html).toContain("<!--[if !mso]><!-->");
    expect(html).toContain("<!--<![endif]-->");
  });

  it("uses the same tracking marker in both variants", async () => {
    const html = await renderButton({});
    const occurrences = html.split(MARKER).length - 1;
    expect(occurrences).toBe(2);
    expect(html).toContain(`<v:roundrect href="${MARKER}"`);
  });

  it("uses the same filter slot in both variants", async () => {
    const html = await renderButton({
      label: [{
        t: "p",
        children: [{ t: "var", expr: "contact.first_name | default", fallback: "kolego", slots: { default: 1 } }],
      }],
    });
    const occurrences = html.split("ML_ARG_0001").length - 1;
    expect(occurrences).toBe(2);
  });

  it("paints the background explicitly in both variants", async () => {
    const html = await renderButton({ backgroundColor: "#ff0000" as const });
    expect(html).toContain('fillcolor="#ff0000"');
    expect(html).toContain("background-color:#ff0000");
  });

  it("renders an outline button without a fill", async () => {
    const html = await renderButton({ style: "outline" as const, borderWidth: 2 as const, borderColor: "#ff0000" as const });
    expect(html).toContain('strokeweight="2px"');
    expect(html).toContain("border:2px solid #ff0000");
  });

  it("stretches to the column width and adds the mobile class when fullWidth is on", async () => {
    const html = await renderButton({ fullWidth: true });
    expect(html).toContain("ml-btn");
    expect(html).toContain("width:552px");
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm vitest run packages/emails/test/emitter/blocks/button.test.tsx`
Expected: FAIL, moduly neexistují.

- [ ] **Step 3: Napiš test a implementaci dosazování slotů**

`packages/emails/test/compile/apply-slots.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { RawSlotSink } from "../../src/normalize/slots.js";
import { applyFilterSlots, applyRawSlots } from "../../src/compile/apply-slots.js";

describe("applyRawSlots", () => {
  it("replaces every marker with its raw html", () => {
    const sink = new RawSlotSink("ab12cd34ef");
    const a = sink.add("<!--[if mso]><table><![endif]-->");
    const b = sink.add("<!--ML_OPEN_PIXEL-->");
    expect(applyRawSlots(`x${a}y${b}z`, sink))
      .toBe("x<!--[if mso]><table><![endif]-->y<!--ML_OPEN_PIXEL-->z");
  });

  it("replaces a marker used twice", () => {
    const sink = new RawSlotSink("ab12cd34ef");
    const marker = sink.add("<br>");
    expect(applyRawSlots(`${marker}|${marker}`, sink)).toBe("<br>|<br>");
  });

  it("leaves text alone when there is nothing to replace", () => {
    expect(applyRawSlots("plain", new RawSlotSink("ab12cd34ef"))).toBe("plain");
  });
});

describe("applyFilterSlots", () => {
  const slots = [
    { slot: 1, blockId: "b_1", filter: "default" as const, value: "kolego" },
    { slot: 2, blockId: "b_2", filter: "default" as const, value: "zákazníku" },
    { slot: 3, blockId: "b_3", filter: "date" as const, value: "%d.%m.%Y" },
  ];

  it("inserts the value in quotes at every occurrence", () => {
    const result = applyFilterSlots("{{ a | default:ML_ARG_0001 }} {{ b | default:ML_ARG_0002 }}", slots);
    expect(result.output).toBe('{{ a | default:"kolego" }} {{ b | default:"zákazníku" }}');
    expect(result.used).toEqual(new Set([1, 2]));
  });

  it("resolves the same slot at two places with the same value", () => {
    const result = applyFilterSlots("ML_ARG_0001 and ML_ARG_0001", slots);
    expect(result.output).toBe('"kolego" and "kolego"');
  });

  it("reports an unknown slot number instead of silently dropping it", () => {
    const result = applyFilterSlots("ML_ARG_0099", slots);
    expect(result.unknown).toEqual([99]);
  });

  it("leaves no marker behind", () => {
    expect(applyFilterSlots("ML_ARG_0003", slots).output).toBe('"%d.%m.%Y"');
  });
});
```

`packages/emails/src/compile/apply-slots.ts`:

```ts
import type { FilterSlot } from "../normalize/slots.js";
import { RAW_SLOT_PREFIX, type RawSlotSink } from "../normalize/slots.js";

/**
 * Jeden lineární průchod, ne cyklus přes sloty s ReplaceAll: při dvaceti slotech
 * by to znamenalo dvacet průchodů stokilobajtovým dokumentem.
 */
export function applyRawSlots(input: string, sink: RawSlotSink): string {
  if (sink.size === 0) return input;
  const table = new Map(sink.entries());
  const pattern = new RegExp(`${RAW_SLOT_PREFIX}${sink.nonce}_(\\d{4})`, "g");
  return input.replace(pattern, (marker) => table.get(marker) ?? marker);
}

export type FilterSlotApplication = {
  output: string;
  used: Set<number>;
  unknown: number[];
};

/**
 * Dosadí argumenty filtrů. Až tady, po renderu Reactem, protože uvozovka vložená
 * dřív by se změnila na &quot; a Liquid by přestal být platný (3.3.5).
 */
export function applyFilterSlots(input: string, slots: FilterSlot[]): FilterSlotApplication {
  const table = new Map(slots.map((slot) => [slot.slot, slot]));
  const used = new Set<number>();
  const unknown: number[] = [];
  const output = input.replace(/ML_ARG_(\d{4})/g, (marker, digits: string) => {
    const number = Number(digits);
    const slot = table.get(number);
    if (!slot) {
      unknown.push(number);
      return marker;
    }
    used.add(number);
    return `"${slot.value}"`;
  });
  return { output, used, unknown };
}
```

Run: `pnpm vitest run packages/emails/test/compile/apply-slots.test.ts`
Expected: PASS, 7 testů.

- [ ] **Step 4: Napiš `packages/emails/src/emitter/inline-html.ts`**

```ts
import type { InlineNode } from "../document/types.js";
import { varOutput } from "./rich-text.js";

/**
 * Escapování přesně podle kontraktu (část 1, 4.10.2): & < > " '.
 * Používá se tam, kde HTML skládáme sami a React ho nevidí, tedy v raw slotech.
 */
export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/**
 * Inline uzly na HTML řetězec. Uživatelský text se escapuje, Liquid konstrukce ne,
 * protože ta v HTML kontextu není text uživatele, ale výraz, který interpoluje sender.
 */
export function inlineToHtmlString(nodes: InlineNode[]): string {
  return nodes.map((node) => {
    if (node.t === "s") {
      let out = escapeHtml(node.v);
      if (node.strike) out = `<s>${out}</s>`;
      if (node.u) out = `<u>${out}</u>`;
      if (node.i) out = `<em>${out}</em>`;
      if (node.b) out = `<strong>${out}</strong>`;
      return out;
    }
    if (node.t === "br") return "<br />";
    if (node.t === "var") return varOutput(node);
    return inlineToHtmlString(node.children);
  }).join("");
}

/** Zploštění bohatého textu na jeden řádek, pro popisek tlačítka a VML variantu. */
export function richToSingleLineHtml(rich: { t: string }[]): string {
  const nodes: InlineNode[] = [];
  for (const node of rich as Array<{ t: string; children?: InlineNode[]; items?: InlineNode[][] }>) {
    if (node.t === "p" && node.children) nodes.push(...node.children);
    if (node.items) for (const item of node.items) nodes.push(...item);
  }
  return inlineToHtmlString(nodes);
}

/** Délka viditelného textu, bez značek a bez Liquid konstrukcí. Používá se k odhadu šířky VML. */
export function visibleLength(rich: { t: string }[]): number {
  const html = richToSingleLineHtml(rich);
  return html.replace(/\{\{[^}]*\}\}/g, "12345678").replace(/<[^>]+>/g, "").length;
}
```

- [ ] **Step 5: Napiš `packages/emails/src/emitter/blocks/button.tsx`**

```tsx
import type { ReactElement } from "react";
import type { ButtonBlock } from "../../document/types.js";
import { useEmitter } from "../ctx.js";
import { escapeHtml, richToSingleLineHtml, visibleLength } from "../inline-html.js";
import { px } from "../style.js";
import { BlockFrame } from "./frame.js";
import { Raw } from "../raw.js";

export function ButtonBlockView(
  { block, width }: { block: ButtonBlock; width: number },
): ReactElement {
  const { theme } = useEmitter();
  const p = block.props;
  const href = useEmitter().linkHref(p.href, p.trackable);
  const background = theme.light.color(p.backgroundColor);
  const textColor = theme.light.color(p.textColor);
  const border = p.borderColor ? theme.light.color(p.borderColor) : background;
  const radius = p.borderRadius ?? theme.radius;
  const height = Math.round(p.fontSize * 1.2) + p.paddingY * 2;

  // Šířka VML se v Outlooku musí uvést v pixelech, jinak se tlačítko scvrkne.
  // U proměnného popisku je to odhad ze znaků: přesně to nejde, protože délku
  // interpolované hodnoty zná až sender. Odhad je vždy oříznutý šířkou sloupce.
  const estimated = Math.round(visibleLength(p.label) * p.fontSize * 0.6) + p.paddingX * 2;
  const vmlWidth = p.fullWidth ? width : Math.min(width, Math.max(80, estimated));
  const labelHtml = richToSingleLineHtml(p.label);
  const fontFamily = theme.fonts.body;

  const vml =
    "<!--[if mso]>" +
    `<v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" ` +
    `xmlns:w="urn:schemas-microsoft-com:office:word" href="${escapeHtml(href)}" ` +
    `style="height:${height}px;v-text-anchor:middle;width:${vmlWidth}px;" ` +
    `arcsize="${Math.round((radius / height) * 100)}%" ` +
    `strokecolor="${border}" strokeweight="${p.borderWidth}px" ` +
    `fillcolor="${p.style === "outline" ? "#ffffff" : background}">` +
    "<w:anchorlock/>" +
    `<center style="color:${p.style === "outline" ? background : textColor};` +
    `font-family:${fontFamily};font-size:${p.fontSize}px;font-weight:bold;">${labelHtml}</center>` +
    "</v:roundrect><![endif]-->";

  const tableHtml =
    `<!--[if !mso]><!--><table role="presentation" cellpadding="0" cellspacing="0" border="0" ` +
    `class="ml-btn"${p.fullWidth ? ` width="${width}"` : ""} ` +
    `style="border-collapse:separate;${p.fullWidth ? `width:${width}px;` : ""}">` +
    `<tbody><tr><td align="center" ` +
    `style="background-color:${p.style === "outline" ? "#ffffff" : background};` +
    `border-radius:${radius}px;border:${p.borderWidth}px solid ${border};` +
    `padding:${p.paddingY}px ${p.paddingX}px;">` +
    `<a href="${escapeHtml(href)}" ` +
    `style="display:inline-block;text-decoration:none;font-family:${fontFamily};` +
    `font-size:${p.fontSize}px;font-weight:bold;line-height:${Math.round(p.fontSize * 1.2)}px;` +
    `mso-line-height-rule:exactly;color:${p.style === "outline" ? background : textColor};">` +
    `${labelHtml}</a></td></tr></tbody></table><!--<![endif]-->`;

  return (
    <BlockFrame
      padding={p.padding}
      backgroundColor={null}
      hideOnMobile={p.hideOnMobile}
      visibleWhen={block.visibleWhen}
      align={p.align}
    >
      <Raw html={vml} />
      <Raw html={tableHtml} />
    </BlockFrame>
  );
}
```

- [ ] **Step 6: Spusť test a ověř, že projde**

Run: `pnpm vitest run packages/emails/test/emitter/blocks/button.test.tsx`
Expected: PASS, 8 testů. Test „uses the same filter slot in both variants" je ten, který by chytil naivní implementaci se dvěma sloty.

- [ ] **Step 7: Commit**

```bash
git add packages/emails/src/compile/apply-slots.ts packages/emails/src/emitter/inline-html.ts packages/emails/src/emitter/blocks/button.tsx packages/emails/test/compile/apply-slots.test.ts packages/emails/test/emitter/blocks/button.test.tsx
git commit -m "feat(emails): slot application and bulletproof button with vml twin"
```

---

### Task 20: Oddělovač, mezera, syrové HTML, sociální ikony a patička

**Files:**
- Create: `packages/emails/src/emitter/blocks/divider.tsx`
- Create: `packages/emails/src/emitter/blocks/spacer.tsx`
- Create: `packages/emails/src/emitter/blocks/html-block.tsx`
- Create: `packages/emails/src/emitter/blocks/social.tsx`
- Create: `packages/emails/src/emitter/blocks/footer.tsx`
- Test: `packages/emails/test/emitter/blocks/leaf-blocks.test.tsx`

- [ ] **Step 1: Napiš padající test**

`packages/emails/test/emitter/blocks/leaf-blocks.test.tsx`:

```tsx
import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";
import { blockDefaults, DEFAULT_THEME } from "../../../src/document/defaults.js";
import { resolveTheme } from "../../../src/theme/resolve.js";
import { RawSlotSink } from "../../../src/normalize/slots.js";
import { EmitterProvider } from "../../../src/emitter/ctx.js";
import { applyRawSlots } from "../../../src/compile/apply-slots.js";
import { DividerBlockView } from "../../../src/emitter/blocks/divider.js";
import { SpacerBlockView } from "../../../src/emitter/blocks/spacer.js";
import { HtmlBlockView } from "../../../src/emitter/blocks/html-block.js";
import { SocialBlockView } from "../../../src/emitter/blocks/social.js";
import { FooterBlockView } from "../../../src/emitter/blocks/footer.js";

async function renderBlock(node: React.ReactElement) {
  const sink = new RawSlotSink("ab12cd34ef");
  const html = await render(
    <EmitterProvider
      value={{
        theme: resolveTheme(DEFAULT_THEME),
        raw: sink,
        assets: {},
        assetBaseUrl: "https://assets.test",
        language: "cs",
        skippedBlockIds: new Set<string>(),
        trackClicks: true,
        linkHref: (href: string) => href,
        t: (key: string) => key,
      }}
    >
      {node}
    </EmitterProvider>,
  );
  return applyRawSlots(html, sink);
}

describe("divider", () => {
  it("renders a bordered cell, never an hr", async () => {
    const block = {
      id: "b_000000000001", type: "divider" as const,
      props: { ...blockDefaults("divider"), thickness: 2 as const, style: "dashed" as const },
    };
    const html = await renderBlock(<DividerBlockView block={block} />);
    expect(html).toContain("border-top:2px dashed");
    expect(html).not.toContain("<hr");
  });
});

describe("spacer", () => {
  it("renders an exact height with the mso rule", async () => {
    const block = {
      id: "b_000000000001", type: "spacer" as const,
      props: { ...blockDefaults("spacer"), height: 40 },
    };
    const html = await renderBlock(<SpacerBlockView block={block} />);
    expect(html).toContain("height:40px");
    expect(html).toContain("line-height:40px");
    expect(html).toContain("font-size:0");
    expect(html).toContain("mso-line-height-rule:exactly");
  });
});

describe("html block", () => {
  it("keeps allowed markup and liquid, drops scripts and event handlers", async () => {
    const block = {
      id: "b_000000000001", type: "html" as const,
      props: {
        ...blockDefaults("html"),
        code: '<p onclick="x()">Ahoj {{ contact.first_name }}</p><script>alert(1)</script>',
      },
    };
    const html = await renderBlock(<HtmlBlockView block={block} />);
    expect(html).toContain("Ahoj {{ contact.first_name }}");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("<script");
  });

  it("drops a style element so it cannot fight the head css", async () => {
    const block = {
      id: "b_000000000001", type: "html" as const,
      props: { ...blockDefaults("html"), code: "<style>p{color:red}</style><p>x</p>" },
    };
    const html = await renderBlock(<HtmlBlockView block={block} />);
    expect(html).not.toContain("<style");
    expect(html).toContain("<p>x</p>");
  });
});

describe("social", () => {
  it("renders one icon per item with a product icon url", async () => {
    const block = {
      id: "b_000000000001", type: "social" as const,
      props: {
        ...blockDefaults("social"),
        items: [
          { network: "facebook" as const, href: "https://fb.com/x" },
          { network: "bluesky" as const, href: "https://bsky.app/x", label: "Bluesky" },
        ],
      },
    };
    const html = await renderBlock(<SocialBlockView block={block} />);
    expect(html).toContain("/a/social/facebook-color@2x.png");
    expect(html).toContain("/a/social/bluesky-color@2x.png");
    expect(html).toContain('alt="Bluesky"');
    expect(html).toContain('width="28"');
  });
});

describe("footer", () => {
  it("renders the sender address as a merge tag, never as a constant", async () => {
    const block = { id: "b_000000000001", type: "footer" as const, props: blockDefaults("footer") };
    const html = await renderBlock(<FooterBlockView block={block} />);
    expect(html).toContain("{{ workspace.sender_address }}");
  });

  it("renders all three system links as untouched liquid", async () => {
    const block = { id: "b_000000000001", type: "footer" as const, props: blockDefaults("footer") };
    const html = await renderBlock(<FooterBlockView block={block} />);
    expect(html).toContain('href="{{ unsubscribe_url }}"');
    expect(html).toContain('href="{{ preferences_url }}"');
    expect(html).toContain('href="{{ webview_url }}"');
    expect(html).not.toContain("track.mlain.invalid");
  });

  it("omits a link when its switch is off", async () => {
    const block = {
      id: "b_000000000001", type: "footer" as const,
      props: { ...blockDefaults("footer"), showPreferences: false, showWebview: false },
    };
    const html = await renderBlock(<FooterBlockView block={block} />);
    expect(html).toContain("{{ unsubscribe_url }}");
    expect(html).not.toContain("{{ preferences_url }}");
  });

  it("paints the footer with the muted class so dark mode can recolour it", async () => {
    const block = { id: "b_000000000001", type: "footer" as const, props: blockDefaults("footer") };
    expect(await renderBlock(<FooterBlockView block={block} />)).toContain("ml-muted");
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm vitest run packages/emails/test/emitter/blocks/leaf-blocks.test.tsx`
Expected: FAIL, moduly neexistují.

- [ ] **Step 3: Napiš `packages/emails/src/emitter/blocks/divider.tsx` a `spacer.tsx`**

```tsx
// packages/emails/src/emitter/blocks/divider.tsx
import type { ReactElement } from "react";
import type { DividerBlock } from "../../document/types.js";
import { useEmitter } from "../ctx.js";
import { BlockFrame } from "./frame.js";

export function DividerBlockView({ block }: { block: DividerBlock }): ReactElement {
  const { theme } = useEmitter();
  const p = block.props;
  return (
    <BlockFrame
      padding={p.padding}
      backgroundColor={p.backgroundColor}
      hideOnMobile={p.hideOnMobile}
      visibleWhen={block.visibleWhen}
      align={p.align}
    >
      {/* Prázdná buňka s border-top, ne <hr>: ten má v každém klientovi jiný výchozí okraj. */}
      <table
        role="presentation"
        width={`${p.width}%`}
        cellPadding={0}
        cellSpacing={0}
        border={0}
        align={p.align}
        style={{ width: `${p.width}%`, borderCollapse: "collapse" }}
      >
        <tbody>
          <tr>
            <td
              style={{
                borderTop: `${p.thickness}px ${p.style} ${theme.light.color(p.color)}`,
                fontSize: 0,
                lineHeight: "0px",
                height: 0,
              }}
            >
              &nbsp;
            </td>
          </tr>
        </tbody>
      </table>
    </BlockFrame>
  );
}
```

```tsx
// packages/emails/src/emitter/blocks/spacer.tsx
import type { CSSProperties, ReactElement } from "react";
import type { SpacerBlock } from "../../document/types.js";
import { px } from "../style.js";
import { BlockFrame } from "./frame.js";

export function SpacerBlockView({ block }: { block: SpacerBlock }): ReactElement {
  const p = block.props;
  return (
    <BlockFrame
      padding={{ top: 0, right: 0, bottom: 0, left: 0 }}
      backgroundColor={p.backgroundColor}
      hideOnMobile={p.hideOnMobile}
      visibleWhen={block.visibleWhen}
      tdStyle={{ msoLineHeightRule: "exactly" } as CSSProperties}
    >
      {/* Bez pevné výšky, řádkování a nulové velikosti písma Outlook prázdnou buňku nezvětší. */}
      <div
        style={{
          height: px(p.height),
          lineHeight: px(p.height),
          fontSize: "0",
          msoLineHeightRule: "exactly",
        } as CSSProperties}
      >
        &nbsp;
      </div>
    </BlockFrame>
  );
}
```

- [ ] **Step 4: Napiš `packages/emails/src/emitter/blocks/html-block.tsx`**

```tsx
import type { ReactElement } from "react";
import sanitizeHtml from "sanitize-html";
import type { HtmlBlock } from "../../document/types.js";
import { Raw } from "../raw.js";
import { BlockFrame } from "./frame.js";

/**
 * Allowlist, ne blocklist (3.2.10). `style` a `script` v seznamu nejsou schválně:
 * uživatelský `<style>` by přebil naše media query a tmavý režim, a `juice`
 * se v MVP 0 nepoužívá, takže by ho nikdo neinlinoval.
 */
export const HTML_BLOCK_SANITIZE: sanitizeHtml.IOptions = {
  allowedTags: [
    "a", "b", "blockquote", "br", "center", "code", "div", "em", "font",
    "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "li", "ol", "p", "pre",
    "s", "small", "span", "strong", "sub", "sup",
    "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul",
  ],
  allowedAttributes: {
    "*": ["style", "class", "align", "valign", "width", "height", "bgcolor", "dir", "lang", "title", "role"],
    a: ["href", "target", "rel"],
    img: ["src", "alt", "width", "height", "border"],
    table: ["cellpadding", "cellspacing", "border"],
    font: ["color", "face", "size"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel"],
  allowedSchemesAppliedToAttributes: ["href", "src"],
  disallowedTagsMode: "discard",
};

export function HtmlBlockView({ block }: { block: HtmlBlock }): ReactElement {
  const safe = sanitizeHtml(block.props.code, HTML_BLOCK_SANITIZE);
  return (
    <BlockFrame
      padding={block.props.padding}
      backgroundColor={block.props.backgroundColor}
      hideOnMobile={block.props.hideOnMobile}
      visibleWhen={block.visibleWhen}
    >
      {/* Odkazy uvnitř tohohle bloku se vědomě netrackují (4.1.4): hledat v cizím
          markupu href by znamenalo ho parsovat, čemuž se celý kontrakt vyhýbá. */}
      <Raw html={safe} />
    </BlockFrame>
  );
}
```

- [ ] **Step 5: Napiš `packages/emails/src/emitter/blocks/social.tsx`**

```tsx
import { Img } from "@react-email/components";
import type { ReactElement } from "react";
import type { SocialBlock } from "../../document/types.js";
import { socialIconUrl } from "../assets.js";
import { useEmitter } from "../ctx.js";
import { px } from "../style.js";
import { BlockFrame } from "./frame.js";

const NETWORK_LABELS: Record<string, string> = {
  facebook: "Facebook", instagram: "Instagram", x: "X", linkedin: "LinkedIn",
  youtube: "YouTube", tiktok: "TikTok", threads: "Threads", pinterest: "Pinterest",
  bluesky: "Bluesky", mastodon: "Mastodon", web: "Web", email: "E-mail",
};

export function SocialBlockView({ block }: { block: SocialBlock }): ReactElement {
  const { assetBaseUrl, linkHref } = useEmitter();
  const p = block.props;
  return (
    <BlockFrame
      padding={p.padding}
      backgroundColor={p.backgroundColor}
      hideOnMobile={p.hideOnMobile}
      visibleWhen={block.visibleWhen}
      align={p.align}
    >
      <table role="presentation" cellPadding={0} cellSpacing={0} border={0} align={p.align}>
        <tbody>
          <tr>
            {p.items.map((item, index) => (
              <td key={index} style={{ paddingRight: index === p.items.length - 1 ? "0px" : px(p.gap) }}>
                <a href={linkHref(item.href, false)}>
                  <Img
                    src={socialIconUrl(assetBaseUrl, item.network, p.iconStyle)}
                    width={p.iconSize}
                    height={p.iconSize}
                    alt={item.label ?? NETWORK_LABELS[item.network] ?? item.network}
                    style={{ display: "block", border: 0, outline: "none", textDecoration: "none" }}
                  />
                </a>
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </BlockFrame>
  );
}
```

- [ ] **Step 6: Napiš `packages/emails/src/emitter/blocks/footer.tsx`**

```tsx
import type { ReactElement } from "react";
import type { FooterBlock } from "../../document/types.js";
import { useEmitter } from "../ctx.js";
import { RichTextView } from "../rich-text.js";
import { lineHeightStyle, px } from "../style.js";
import { BlockFrame } from "./frame.js";

/**
 * Patička nese právní minimum. Nemá `visibleWhen` už na úrovni schématu,
 * takže ji nejde podmínit a musí ji dostat každý příjemce (pravidlo S14).
 * Systémové adresy zůstávají Liquid výrazem: sender je interpoluje z podepsaného
 * tokenu, kompilace o nich neví nic víc než jejich jméno.
 */
export function FooterBlockView({ block }: { block: FooterBlock }): ReactElement {
  const { theme } = useEmitter();
  const p = block.props;
  const color = theme.light.color(p.color);
  const links: Array<{ label: string; href: string }> = [];
  if (p.showUnsubscribe) links.push({ label: p.unsubscribeLabel, href: "{{ unsubscribe_url }}" });
  if (p.showPreferences) links.push({ label: p.preferencesLabel, href: "{{ preferences_url }}" });
  if (p.showWebview) links.push({ label: p.webviewLabel, href: "{{ webview_url }}" });

  return (
    <BlockFrame
      padding={p.padding}
      backgroundColor={p.backgroundColor}
      hideOnMobile={false}
      tdStyle={{
        fontFamily: theme.fonts.body,
        fontSize: px(p.fontSize),
        color,
        ...lineHeightStyle(p.fontSize, 1.5),
      }}
      align="center"
    >
      <div className="ml-muted" style={{ color, textAlign: "center" }}>
        <RichTextView
          rich={p.senderInfo}
          color={color}
          linkColor={color}
          align="center"
          style={{ fontSize: px(p.fontSize) }}
        />
      </div>
      <div className="ml-muted" style={{ color, textAlign: "center", paddingTop: "8px" }}>
        {links.map((link, index) => (
          <span key={link.href}>
            {index > 0 ? " | " : null}
            <a className="ml-link" href={link.href} style={{ color, textDecoration: "underline" }}>
              {link.label}
            </a>
          </span>
        ))}
      </div>
    </BlockFrame>
  );
}
```

- [ ] **Step 7: Spusť test a ověř, že projde**

Run: `pnpm vitest run packages/emails/test/emitter/blocks/leaf-blocks.test.tsx`
Expected: PASS, 9 testů.

- [ ] **Step 8: Commit**

```bash
git add packages/emails/src/emitter/blocks packages/emails/test/emitter/blocks/leaf-blocks.test.tsx
git commit -m "feat(emails): divider, spacer, html, social and footer emitters"
```

---

### Task 21: Sekce, sloupce a rozcestník bloků

**Files:**
- Create: `packages/emails/src/emitter/blocks/section.tsx`
- Create: `packages/emails/src/emitter/blocks/columns.tsx`
- Create: `packages/emails/src/emitter/blocks/dispatch.tsx`
- Test: `packages/emails/test/emitter/blocks/layout.test.tsx`

**Rozhodnutí D7, které je potřeba přečíst před psaním kódu.** Kapitola 3.4.3 popisuje ghost tables větou „mimo Outlook je jedna tabulka se dvěma `<td class="ml-col">`, uvnitř `<!--[if mso]>` je tabulka s pevnými šířkami". Doslovné čtení by znamenalo **vypsat obsah sloupců dvakrát**, jednou pro Outlook a jednou pro ostatní. To se nedělá, a to ze dvou konkrétních důvodů: zdvojnásobilo by to velikost HTML proti limitu 102 kB, a hlavně by to **zdvojnásobilo počet značek odkazů**, takže by `clickMarkerCount` nesouhlasil a invariant I3 by shodil každou kompilaci se sloupcem a odkazem. Emituje se proto průmyslový vzor ghost tables, kde obsah stojí v dokumentu **jednou**: Outlook dostane rám tabulky v podmíněných komentářích, ostatní klienti vidí `<div class="ml-col">` s `display:inline-block`, který media query složí pod sebe.

- [ ] **Step 1: Napiš padající test**

`packages/emails/test/emitter/blocks/layout.test.tsx`:

```tsx
import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";
import { blockDefaults, DEFAULT_THEME } from "../../../src/document/defaults.js";
import { resolveTheme } from "../../../src/theme/resolve.js";
import { RawSlotSink } from "../../../src/normalize/slots.js";
import { EmitterProvider } from "../../../src/emitter/ctx.js";
import { applyRawSlots } from "../../../src/compile/apply-slots.js";
import { SectionBlockView } from "../../../src/emitter/blocks/section.js";
import type { SectionBlock } from "../../../src/document/types.js";

async function renderSection(section: SectionBlock) {
  const sink = new RawSlotSink("ab12cd34ef");
  const html = await render(
    <EmitterProvider
      value={{
        theme: resolveTheme(DEFAULT_THEME),
        raw: sink,
        assets: {},
        assetBaseUrl: "https://assets.test",
        language: "cs",
        skippedBlockIds: new Set<string>(),
        trackClicks: true,
        linkHref: (href: string) => href,
        t: (key: string) => key,
      }}
    >
      <SectionBlockView block={section} />
    </EmitterProvider>,
  );
  return applyRawSlots(html, sink);
}

const section = (children: unknown[], props = {}): SectionBlock =>
  ({
    id: "b_000000000001", type: "section",
    props: { ...blockDefaults("section"), ...props }, children,
  } as SectionBlock);

describe("section", () => {
  it("wraps content in a canvas table and a fixed width content table", async () => {
    const html = await renderSection(section([]));
    expect(html).toContain('class="ml-canvas"');
    expect(html).toContain('class="ml-content"');
    expect(html).toContain('width="600"');
    expect(html).toContain("max-width:100%");
  });

  it("drops the width constraint for a full width section", async () => {
    const html = await renderSection(section([], { fullWidth: true }));
    expect(html).not.toContain('width="600"');
  });

  it("paints both backgrounds explicitly, never transparent", async () => {
    const html = await renderSection(section([], {
      outerBackgroundColor: "#111111", backgroundColor: "#222222",
    }));
    expect(html).toContain("background-color:#111111");
    expect(html).toContain("background-color:#222222");
  });

  it("wraps the whole section in a condition when visibleWhen is set", async () => {
    const block = section([]);
    block.visibleWhen = { field: "contact.city", op: "present" };
    const html = await renderSection(block);
    expect(html.indexOf("{% if _present.contact__city %}")).toBeLessThan(html.indexOf("<table"));
    expect(html).toContain("{% endif %}");
  });
});

describe("columns", () => {
  const withColumns = (layout: "1-1" | "1-1-1" = "1-1") =>
    section([
      {
        id: "b_000000000002", type: "columns",
        props: { ...blockDefaults("columns"), layout },
        children: Array.from({ length: layout === "1-1" ? 2 : 3 }, (_, i) => ({
          id: `b_00000000000${i + 3}`, type: "column", props: blockDefaults("column"),
          children: [{
            id: `b_00000000001${i}`, type: "text",
            props: { ...blockDefaults("text"), content: [{ t: "p", children: [{ t: "s", v: `col${i}` }] }] },
          }],
        })),
      },
    ]);

  it("emits ghost table cells for outlook and inline block divs for everyone else", async () => {
    const html = await renderSection(withColumns());
    expect(html).toContain("<!--[if mso]>");
    expect(html).toContain('class="ml-col"');
    expect(html).toContain("display:inline-block");
  });

  it("emits the content exactly once so link markers cannot double", async () => {
    const html = await renderSection(withColumns());
    expect(html.split("col0").length - 1).toBe(1);
    expect(html.split("col1").length - 1).toBe(1);
  });

  it("uses pixel widths that add up with the gap", async () => {
    const html = await renderSection(withColumns());
    // Vnitřní šířka 600 - 24 - 24 = 552, gap 16, tedy 268 na sloupec.
    expect(html).toContain("width:268px");
    expect(html).toContain('width="268"');
  });

  it("reverses the visual order when stackOrder is reverse", async () => {
    const block = withColumns();
    const columns = (block.children[0] as { props: { stackOrder: string } }).props;
    columns.stackOrder = "reverse";
    const html = await renderSection(block);
    expect(html.indexOf("col1")).toBeLessThan(html.indexOf("col0"));
  });
});

describe("dispatch", () => {
  it("skips a block listed as skipped", async () => {
    const sink = new RawSlotSink("ab12cd34ef");
    const html = await render(
      <EmitterProvider
        value={{
          theme: resolveTheme(DEFAULT_THEME),
          raw: sink,
          assets: {},
          assetBaseUrl: "https://assets.test",
          language: "cs",
          skippedBlockIds: new Set(["b_000000000002"]),
          trackClicks: true,
          linkHref: (href: string) => href,
          t: (key: string) => key,
        }}
      >
        <SectionBlockView
          block={section([{
            id: "b_000000000002", type: "text",
            props: { ...blockDefaults("text"), content: [{ t: "p", children: [{ t: "s", v: "hidden" }] }] },
          }])}
        />
      </EmitterProvider>,
    );
    expect(applyRawSlots(html, sink)).not.toContain("hidden");
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm vitest run packages/emails/test/emitter/blocks/layout.test.tsx`
Expected: FAIL, moduly neexistují.

- [ ] **Step 3: Napiš `packages/emails/src/emitter/blocks/dispatch.tsx`**

```tsx
import type { ReactElement } from "react";
import type { SectionChild } from "../../document/types.js";
import { useEmitter } from "../ctx.js";
import { ButtonBlockView } from "./button.js";
import { DividerBlockView } from "./divider.js";
import { FooterBlockView } from "./footer.js";
import { HeadingBlockView } from "./heading.js";
import { HtmlBlockView } from "./html-block.js";
import { ImageBlockView } from "./image.js";
import { SocialBlockView } from "./social.js";
import { SpacerBlockView } from "./spacer.js";
import { TextBlockView } from "./text.js";

/**
 * Rozcestník obsahových bloků. Neznámý typ a `repeat` sem nedojdou, protože je
 * normalizace zapsala do skippedBlockIds; kontrola je tu jako druhá vrstva.
 */
export function ContentBlockView(
  { block, width }: { block: SectionChild; width: number },
): ReactElement | null {
  const { skippedBlockIds } = useEmitter();
  if (skippedBlockIds.has(block.id)) return null;
  switch (block.type) {
    case "heading": return <HeadingBlockView block={block} />;
    case "text": return <TextBlockView block={block} />;
    case "image": return <ImageBlockView block={block} width={width} />;
    case "button": return <ButtonBlockView block={block} width={width} />;
    case "divider": return <DividerBlockView block={block} />;
    case "spacer": return <SpacerBlockView block={block} />;
    case "html": return <HtmlBlockView block={block} />;
    case "social": return <SocialBlockView block={block} />;
    case "footer": return <FooterBlockView block={block} />;
    default: return null;
  }
}
```

- [ ] **Step 4: Napiš `packages/emails/src/emitter/blocks/columns.tsx`**

```tsx
import type { ReactElement } from "react";
import type { ColumnsBlock } from "../../document/types.js";
import { columnWidths } from "../../normalize/columns.js";
import { useEmitter } from "../ctx.js";
import { Raw } from "../raw.js";
import { paddingStyle, px } from "../style.js";
import { ContentBlockView } from "./dispatch.js";

export function ColumnsBlockView(
  { block, innerWidth }: { block: ColumnsBlock; innerWidth: number },
): ReactElement {
  const { theme } = useEmitter();
  const p = block.props;
  const widths = columnWidths(p.layout, p.gap, innerWidth);
  const order = p.stackOrder === "reverse"
    ? block.children.map((_, index) => block.children.length - 1 - index)
    : block.children.map((_, index) => index);

  const ghostOpen =
    `<!--[if mso]><table role="presentation" width="${innerWidth}" cellpadding="0" cellspacing="0" ` +
    `border="0"><tr>`;
  const ghostCell = (width: number): string =>
    `<td width="${width}" valign="${p.verticalAlign}">`;
  const ghostBetween = (width: number): string => `</td>${ghostCell(width)}`;

  return (
    <table
      role="presentation"
      width="100%"
      cellPadding={0}
      cellSpacing={0}
      border={0}
      style={{ width: "100%", borderCollapse: "collapse" }}
    >
      <tbody>
        <tr>
          <td valign={p.verticalAlign} style={{ fontSize: 0 }}>
            <Raw html={`${ghostOpen}${ghostCell(widths[order[0]!]!)}<![endif]-->`} />
            {order.map((columnIndex, position) => {
              const column = block.children[columnIndex]!;
              const width = widths[columnIndex]!;
              return (
                <span key={column.id}>
                  {position > 0
                    ? <Raw html={`<!--[if mso]>${ghostBetween(width)}<![endif]-->`} />
                    : null}
                  <div
                    className={p.stackOnMobile ? "ml-col" : undefined}
                    style={{
                      display: "inline-block",
                      width: px(width),
                      maxWidth: "100%",
                      verticalAlign: p.verticalAlign,
                      fontSize: px(theme.baseFontSize),
                    }}
                  >
                    <table
                      role="presentation"
                      width="100%"
                      cellPadding={0}
                      cellSpacing={0}
                      border={0}
                      style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        borderRadius: px(column.props.borderRadius),
                        ...(column.props.backgroundColor
                          ? { backgroundColor: theme.light.color(column.props.backgroundColor) }
                          : {}),
                      }}
                    >
                      <tbody>
                        <tr>
                          <td style={paddingStyle(column.props.padding)}>
                            {column.children.map((child) => (
                              <ContentBlockView
                                key={child.id}
                                block={child}
                                width={width - column.props.padding.left - column.props.padding.right}
                              />
                            ))}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </span>
              );
            })}
            <Raw html="<!--[if mso]></td></tr></table><![endif]-->" />
          </td>
        </tr>
      </tbody>
    </table>
  );
}
```

- [ ] **Step 5: Napiš `packages/emails/src/emitter/blocks/section.tsx`**

```tsx
import type { ReactElement } from "react";
import type { SectionBlock } from "../../document/types.js";
import { assetUrl } from "../assets.js";
import { useEmitter } from "../ctx.js";
import { Raw } from "../raw.js";
import { paddingStyle, px } from "../style.js";
import { Visible } from "../visibility.js";
import { ColumnsBlockView } from "./columns.js";
import { ContentBlockView } from "./dispatch.js";

export function SectionBlockView({ block }: { block: SectionBlock }): ReactElement {
  const { theme, assets, assetBaseUrl } = useEmitter();
  const p = block.props;
  const innerWidth = theme.contentWidth - p.padding.left - p.padding.right;
  const outer = p.outerBackgroundColor
    ? theme.light.color(p.outerBackgroundColor)
    : theme.light.roles["surface.canvas"];
  const inner = p.backgroundColor
    ? theme.light.color(p.backgroundColor)
    : theme.light.roles["surface.content"];
  const backgroundAsset = p.backgroundImageAssetId ? assets[p.backgroundImageAssetId] : undefined;
  const backgroundSrc = backgroundAsset ? assetUrl(assetBaseUrl, backgroundAsset, "w1200") : undefined;

  const content = (
    <table
      role="presentation"
      className="ml-content"
      {...(p.fullWidth ? {} : { width: theme.contentWidth })}
      cellPadding={0}
      cellSpacing={0}
      border={0}
      align="center"
      style={{
        ...(p.fullWidth ? { width: "100%" } : { width: px(theme.contentWidth), maxWidth: "100%" }),
        borderCollapse: "collapse",
        backgroundColor: inner,
        borderTopLeftRadius: p.roundedTop ? px(theme.radius) : undefined,
        borderTopRightRadius: p.roundedTop ? px(theme.radius) : undefined,
        borderBottomLeftRadius: p.roundedBottom ? px(theme.radius) : undefined,
        borderBottomRightRadius: p.roundedBottom ? px(theme.radius) : undefined,
      }}
    >
      <tbody>
        <tr>
          <td className="ml-pad" style={paddingStyle(p.padding)}>
            {block.children.map((child) =>
              child.type === "columns"
                ? <ColumnsBlockView key={child.id} block={child} innerWidth={innerWidth} />
                : <ContentBlockView key={child.id} block={child} width={innerWidth} />,
            )}
          </td>
        </tr>
      </tbody>
    </table>
  );

  return (
    <Visible when={block.visibleWhen}>
      <table
        role="presentation"
        className="ml-canvas"
        width="100%"
        cellPadding={0}
        cellSpacing={0}
        border={0}
        style={{ width: "100%", borderCollapse: "collapse", backgroundColor: outer }}
      >
        <tbody>
          <tr>
            {/* Pozadí obrázkem se emituje atributem `background` na <td> plus VML pro Outlook.
                CSS background-image nefunguje ani ve Word enginu, ani na Seznamu, kde se
                pravidlo s url() zahodí celé. */}
            <td
              align="center"
              {...(backgroundSrc ? { background: backgroundSrc } : {})}
              style={{
                backgroundColor: outer,
                ...(backgroundSrc
                  ? { backgroundPosition: p.backgroundPosition, backgroundSize: "cover" }
                  : {}),
              }}
            >
              {backgroundSrc ? (
                <Raw
                  html={
                    `<!--[if gte mso 9]><v:rect xmlns:v="urn:schemas-microsoft-com:vml" ` +
                    `fill="true" stroke="false" style="width:${theme.contentWidth}px;">` +
                    `<v:fill type="frame" src="${backgroundSrc}" color="${outer}" /><v:textbox inset="0,0,0,0"><![endif]-->`
                  }
                />
              ) : null}
              {content}
              {backgroundSrc ? <Raw html="<!--[if gte mso 9]></v:textbox></v:rect><![endif]-->" /> : null}
            </td>
          </tr>
        </tbody>
      </table>
    </Visible>
  );
}
```

- [ ] **Step 6: Spusť test a ověř, že projde**

Run: `pnpm vitest run packages/emails/test/emitter/blocks/layout.test.tsx`
Expected: PASS, 9 testů. Test „emits the content exactly once" je ten, který drží invariant I3 při životě.

- [ ] **Step 7: Commit**

```bash
git add packages/emails/src/emitter/blocks packages/emails/test/emitter/blocks/layout.test.tsx
git commit -m "feat(emails): section and ghost table columns"
```

---

### Task 22: Obálka dokumentu a `renderDocumentHtml`

**Files:**
- Create: `packages/emails/src/emitter/shell.tsx`
- Create: `packages/emails/src/emitter/render.ts`
- Test: `packages/emails/test/emitter/render.test.ts`

Tady se poprvé rendruje celý dokument. Po renderu následují tři deterministické úpravy řetězce, každá z nich má vlastní důvod v rozhodnutích D3, D4 a D5.

- [ ] **Step 1: Napiš padající test**

`packages/emails/test/emitter/render.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { blockDefaults, DEFAULT_THEME } from "../../src/document/defaults.js";
import type { Document } from "../../src/document/types.js";
import { normalizeDocument } from "../../src/normalize/index.js";
import { renderDocumentHtml } from "../../src/emitter/render.js";

const doc = (over: Partial<Document> = {}): Document => ({
  schemaVersion: 1,
  meta: { name: "Letní výprodej", previewText: "Slevy končí v neděli", language: "cs" },
  theme: DEFAULT_THEME,
  blocks: [{
    id: "b_000000000001", type: "section", props: blockDefaults("section"),
    children: [{
      id: "b_000000000002", type: "text",
      props: { ...blockDefaults("text"), content: [{ t: "p", children: [{ t: "s", v: "Ahoj" }] }] },
    }],
  }],
  ...over,
} as Document);

const run = (input: Document, over: Record<string, unknown> = {}) =>
  renderDocumentHtml({
    normalized: normalizeDocument(input, { language: input.meta.language }),
    assets: {},
    assetBaseUrl: "https://assets.test",
    linkHref: (href: string) => href,
    trackOpens: true,
    trackClicks: true,
    rawNonce: "ab12cd34ef",
    ...over,
  });

describe("renderDocumentHtml", () => {
  it("emits a short html5 doctype, not the xhtml one react-email defaults to", async () => {
    const html = await run(doc());
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html).not.toContain("XHTML 1.0 Transitional");
  });

  it("carries the vml namespaces and the language on the html element", async () => {
    const html = await run(doc());
    expect(html).toContain('xmlns:v="urn:schemas-microsoft-com:vml"');
    expect(html).toContain('xmlns:o="urn:schemas-microsoft-com:office:office"');
    expect(html).toContain('lang="cs"');
  });

  it("keeps an unknown language tag on the html element even though texts fall back", async () => {
    const html = await run(doc({ meta: { name: "x", previewText: "", language: "sv-FI" } }));
    expect(html).toContain('lang="sv-FI"');
  });

  it("puts the office document settings and the whole css in the head", async () => {
    const html = await run(doc());
    expect(html).toContain("<o:PixelsPerInch>96</o:PixelsPerInch>");
    expect(html).toContain("@media only screen and (max-width:600px)");
    expect(html).toContain('"Segoe UI"');
    expect(html).not.toContain("&quot;Segoe UI&quot;");
  });

  it("emits the color scheme meta tags", async () => {
    expect(await run(doc())).toContain('<meta name="color-scheme" content="light dark"');
    const off = await run(doc({
      theme: { ...DEFAULT_THEME, darkMode: { strategy: "off", colors: {} } },
    }));
    expect(off).toContain('<meta name="color-scheme" content="light"');
  });

  it("emits the preheader as hidden text with filler", async () => {
    const html = await run(doc(), { preheader: "Slevy končí v neděli" });
    expect(html).toContain("Slevy končí v neděli");
    expect(html).toContain("mso-hide:all");
    expect(html).toContain("max-height:0");
  });

  it("emits exactly one open pixel marker right before the closing body tag", async () => {
    const html = await run(doc());
    expect(html.split("<!--ML_OPEN_PIXEL-->").length - 1).toBe(1);
    expect(html).toContain("<!--ML_OPEN_PIXEL--></body>");
  });

  it("emits no open pixel marker when tracking of opens is off", async () => {
    expect(await run(doc(), { trackOpens: false })).not.toContain("ML_OPEN_PIXEL");
  });

  it("leaves no raw slot marker behind", async () => {
    expect(await run(doc())).not.toContain("ML_RAW_");
  });

  it("removes the react text separators", async () => {
    expect(await run(doc())).not.toContain("<!-- -->");
  });

  it("is byte identical across two runs with the same input", async () => {
    const a = await run(doc());
    const b = await run(doc());
    expect(a).toBe(b);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm vitest run packages/emails/test/emitter/render.test.ts`
Expected: FAIL, moduly neexistují.

- [ ] **Step 3: Napiš `packages/emails/src/emitter/shell.tsx`**

```tsx
import { Body, Head, Html } from "@react-email/components";
import type { CSSProperties, ReactElement, ReactNode } from "react";
import { OPEN_PIXEL_MARKER } from "@mlain/contracts/markers";
import { useEmitter } from "./ctx.js";
import { buildHeadCss, MSO_HEAD_BLOCK } from "./head-css.js";
import { Raw } from "./raw.js";

const MSO_NAMESPACES = {
  "xmlns:v": "urn:schemas-microsoft-com:vml",
  "xmlns:o": "urn:schemas-microsoft-com:office:office",
};

/**
 * Výplň preheaderu. Jsou to skutečné znaky Unicode (U+034F, U+200C, U+00A0),
 * ne HTML entity: React by z entity udělal `&amp;#847;` a schránka by ji ukázala.
 */
const PREHEADER_FILLER = "͏‌ ".repeat(40);

export function EmailShell(
  { language, title, preheader, children }:
  { language: string; title: string; preheader: string; children: ReactNode },
): ReactElement {
  const { theme } = useEmitter();
  const scheme = theme.darkModeEnabled ? "light dark" : "light";
  return (
    <Html lang={language} {...MSO_NAMESPACES}>
      <Head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width,initial-scale=1" />
        <meta httpEquiv="x-ua-compatible" content="ie=edge" />
        <meta name="color-scheme" content={scheme} />
        <meta name="supported-color-schemes" content={scheme} />
        <title>{title}</title>
        <Raw html={MSO_HEAD_BLOCK} />
        {/* Obsah <style> jde raw slotem: React text uvnitř <style> escapuje
            a `"Segoe UI"` by se rozpadlo na `&quot;`, což prohlížeč uvnitř
            stylu nedekóduje a font stack by přestal platit. */}
        <style><Raw html={buildHeadCss(theme)} /></style>
      </Head>
      <Body
        id="body"
        className="ml-body ml-canvas"
        style={{
          margin: 0,
          padding: 0,
          width: "100%",
          backgroundColor: theme.light.roles["surface.canvas"],
        }}
      >
        <div
          style={{
            display: "none",
            fontSize: "1px",
            lineHeight: "1px",
            maxHeight: 0,
            maxWidth: 0,
            opacity: 0,
            overflow: "hidden",
            msoHide: "all",
          } as CSSProperties}
        >
          {preheader}
          {PREHEADER_FILLER}
        </div>
        {children}
      </Body>
    </Html>
  );
}

export { OPEN_PIXEL_MARKER };
```

- [ ] **Step 4: Napiš `packages/emails/src/emitter/render.ts`**

```ts
import { OPEN_PIXEL_MARKER } from "@mlain/contracts/markers";
import { render } from "@react-email/render";
import { createElement } from "react";
import type { AssetRef } from "../compile/types.js";
import { applyRawSlots } from "../compile/apply-slots.js";
import type { NormalizedDocument } from "../normalize/index.js";
import { RawSlotSink } from "../normalize/slots.js";
import { SectionBlockView } from "./blocks/section.js";
import { EmitterProvider, type EmitterState } from "./ctx.js";
import { Raw } from "./raw.js";
import { EmailShell } from "./shell.js";

export type RenderOptions = {
  normalized: NormalizedDocument;
  assets: Record<string, AssetRef>;
  assetBaseUrl: string;
  /** Mapuje href na značku odkazu. Sestavuje ji collectLinks, viz Task 26. */
  linkHref: (href: string, trackable: boolean) => string;
  trackOpens: boolean;
  trackClicks: boolean;
  preheader?: string;
  /** Jen pro testy. V produkci se nikdy nepředává. */
  rawNonce?: string;
};

/** Texty dodávané produktem. Zatím jen oddělovače prostého textu, patička je v props bloku. */
const PRODUCT_TEXTS: Record<string, Record<string, string>> = {
  cs: { "text.unsubscribe": "Odhlásit se z odběru", "text.webview": "Zobrazit v prohlížeči" },
  en: { "text.unsubscribe": "Unsubscribe", "text.webview": "View in browser" },
};

export async function renderDocumentHtml(options: RenderOptions): Promise<string> {
  const { normalized } = options;
  const raw = new RawSlotSink(options.rawNonce);
  const state: EmitterState = {
    theme: normalized.theme,
    raw,
    assets: options.assets,
    assetBaseUrl: options.assetBaseUrl,
    language: normalized.language,
    skippedBlockIds: normalized.skippedBlockIds,
    trackClicks: options.trackClicks,
    linkHref: options.linkHref,
    t: (key: string) => PRODUCT_TEXTS[normalized.language]?.[key] ?? PRODUCT_TEXTS.en![key] ?? key,
  };

  const tree = createElement(
    EmitterProvider,
    { value: state },
    createElement(
      EmailShell,
      {
        language: normalized.doc.meta.language,
        title: normalized.doc.meta.name,
        preheader: options.preheader ?? normalized.doc.meta.previewText,
      },
      ...normalized.doc.blocks.map((section) =>
        createElement(SectionBlockView, { key: section.id, block: section }),
      ),
      options.trackOpens ? createElement(Raw, { html: OPEN_PIXEL_MARKER }) : null,
    ),
  );

  let html = await render(tree);
  // D5: React vkládá mezi dva sousední textové uzly oddělovač. Náš vlastní
  // podmíněný komentář má vždy tvar `<!--[if ...`, takže je záměna bezpečná.
  html = html.replaceAll("<!-- -->", "");
  // D3: teprve teď se dosadí syrové HTML.
  html = applyRawSlots(html, raw);
  // D4: kontrakt slibuje senderu kompletní dokument začínající `<!DOCTYPE html>`.
  html = html.replace(/^<!DOCTYPE[^>]*>/i, "<!DOCTYPE html>");
  return html;
}
```

- [ ] **Step 5: Spusť test a ověř, že projde**

Run: `pnpm vitest run packages/emails/test/emitter/render.test.ts`
Expected: PASS, 11 testů. Kdyby padal test na `"Segoe UI"`, znamená to, že obsah `<style>` nejde raw slotem a React ho escapoval.

- [ ] **Step 6: Commit**

```bash
git add packages/emails/src/emitter/shell.tsx packages/emails/src/emitter/render.ts packages/emails/test/emitter/render.test.ts
git commit -m "feat(emails): document shell and html renderer"
```

---

## Fáze D: prostý text

### Task 23: Zalamování na 78 znaků

**Files:**
- Create: `packages/emails/src/text/wrap.ts`
- Test: `packages/emails/test/text/wrap.test.ts`

Kritérium 22. **Řádek se značkou odkazu se nezalamuje nikdy** a Liquid výraz se nikdy nerozdělí. Sender za značku dosadí URL o 80 až 120 znacích a zalomená URL je nefunkční URL.

- [ ] **Step 1: Napiš padající test**

`packages/emails/test/text/wrap.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { wrapPlain } from "../../src/text/wrap.js";

describe("wrapPlain", () => {
  it("wraps on a word boundary at 78 characters", () => {
    const line = "slovo ".repeat(30).trim();
    for (const out of wrapPlain(line)) expect(out.length).toBeLessThanOrEqual(78);
  });

  it("never splits a liquid expression", () => {
    const line = `${"a".repeat(70)} {{ contact.first_name_vocative }} konec`;
    const out = wrapPlain(line);
    expect(out.some((l) => l.includes("{{ contact.first_name_vocative }}"))).toBe(true);
    expect(out.join("\n")).not.toMatch(/\{\{[^}]*\n/);
  });

  it("keeps an over long token on its own line rather than cutting it", () => {
    const long = "x".repeat(120);
    expect(wrapPlain(`start ${long} end`)).toEqual(["start", long, "end"]);
  });

  it("returns a single empty line for empty input", () => {
    expect(wrapPlain("")).toEqual([""]);
  });

  it("keeps an indent on continuation lines when asked", () => {
    const out = wrapPlain("slovo ".repeat(30).trim(), { indent: "  " });
    expect(out[0]!.startsWith("  ")).toBe(false);
    expect(out[1]!.startsWith("  ")).toBe(true);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm vitest run packages/emails/test/text/wrap.test.ts`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napiš implementaci**

`packages/emails/src/text/wrap.ts`:

```ts
export const PLAIN_TEXT_WIDTH = 78;

/**
 * Zalomení na hranici slova. Liquid výraz se nikdy nerozdělí, protože se
 * tokenizuje jako jeden celek: rozdělený výraz je neplatný Liquid a sender
 * by na něm spadl s render_failed.
 */
export function wrapPlain(input: string, opts: { indent?: string } = {}): string[] {
  if (input === "") return [""];
  const indent = opts.indent ?? "";
  const tokens = tokenize(input);
  const lines: string[] = [];
  let current = "";

  for (const token of tokens) {
    const prefix = lines.length === 0 ? "" : indent;
    const candidate = current === "" ? prefix + token : `${current} ${token}`;
    if (candidate.length <= PLAIN_TEXT_WIDTH) {
      current = candidate;
      continue;
    }
    if (current !== "") lines.push(current);
    current = (lines.length === 0 ? "" : indent) + token;
  }
  if (current !== "") lines.push(current);
  return lines;
}

/** Slova oddělená bílým znakem, ale `{{ ... }}` a `{% ... %}` drží pohromadě. */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  const pattern = /\{\{[^}]*\}\}|\{%[^%]*%\}|\S+/g;
  for (const match of input.matchAll(pattern)) tokens.push(match[0]);
  return tokens;
}
```

- [ ] **Step 4: Spusť test a ověř, že projde**

Run: `pnpm vitest run packages/emails/test/text/wrap.test.ts`
Expected: PASS, 5 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/emails/src/text/wrap.ts packages/emails/test/text/wrap.test.ts
git commit -m "feat(emails): plain text wrapping that never splits liquid"
```

---

### Task 24: Emitter prostého textu z dokumentu

**Files:**
- Create: `packages/emails/src/text/emit.ts`
- Test: `packages/emails/test/text/emit.test.ts`

**Text se generuje z dokumentu, ne z HTML.** Převod HTML na text už nemá informaci o tom, co byl nadpis, a musel by hádat. A `toPlainText` z react-emailu má konkrétní past: **nadpisy převádí na velká písmena**, takže by z `{{ contact.first_name }}` udělal `{{ CONTACT.FIRST_NAME }}` a rozbil personalizaci v textové části, aniž by cokoliv selhalo. Kritéria 19b a 19c na to mají povinné testy.

**Rozhodnutí D9 ke konci řádků.** Kapitola 3.5 chce zároveň konce řádků `\r\n` (RFC 5322) a „text končí jedním `\n`". Vykládám to takto: oddělovač řádků je `\r\n` a text končí **právě jedním** `\r\n`. Poslední znak je pak `\n`, takže je splněné obojí, a golden fixtures mají jednoznačné bajty.

- [ ] **Step 1: Napiš padající test**

`packages/emails/test/text/emit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { blockDefaults, DEFAULT_THEME } from "../../src/document/defaults.js";
import type { Document, SectionBlock } from "../../src/document/types.js";
import { normalizeDocument } from "../../src/normalize/index.js";
import { renderDocumentText } from "../../src/text/emit.js";

const MARKER = "https://track.mlain.invalid/c/2f1a9c40-0000-5000-8000-000000000001";

const docOf = (children: unknown[]): Document => ({
  schemaVersion: 1,
  meta: { name: "T", previewText: "", language: "cs" },
  theme: DEFAULT_THEME,
  blocks: [{ id: "b_000000000001", type: "section", props: blockDefaults("section"), children } as unknown as SectionBlock],
});

const run = (children: unknown[]) =>
  renderDocumentText({
    normalized: normalizeDocument(docOf(children), { language: "cs" }),
    linkHref: (href: string, trackable: boolean) => (trackable ? MARKER : href),
  });

describe("plain text emitter", () => {
  it("underlines a level one heading with equals signs", () => {
    const text = run([{
      id: "b_000000000002", type: "heading",
      props: { ...blockDefaults("heading"), level: 1, content: [{ t: "p", children: [{ t: "s", v: "Vítejte" }] }] },
    }]);
    expect(text).toContain("Vítejte\r\n=======\r\n");
  });

  it("underlines a level two heading with dashes", () => {
    const text = run([{
      id: "b_000000000002", type: "heading",
      props: { ...blockDefaults("heading"), level: 2, content: [{ t: "p", children: [{ t: "s", v: "Novinky" }] }] },
    }]);
    expect(text).toContain("Novinky\r\n-------\r\n");
  });

  it("never uppercases a heading, at any level", () => {
    for (const level of [1, 2, 3] as const) {
      const text = run([{
        id: "b_000000000002", type: "heading",
        props: {
          ...blockDefaults("heading"), level,
          content: [{ t: "p", children: [{ t: "s", v: "Vítejte, " }, { t: "var", expr: "contact.first_name" }] }],
        },
      }]);
      expect(text, `level ${level}`).toContain("{{ contact.first_name }}");
      expect(text, `level ${level}`).not.toContain("CONTACT.FIRST_NAME");
      expect(text, `level ${level}`).toContain("Vítejte, ");
    }
  });

  it("keeps every merge tag in the document byte identical in the text output", () => {
    const text = run([{
      id: "b_000000000002", type: "text",
      props: {
        ...blockDefaults("text"),
        content: [{
          t: "p",
          children: [
            { t: "var", expr: "contact.greeting" },
            { t: "s", v: " a " },
            { t: "var", expr: "contact.first_name | upcase" },
          ],
        }],
      },
    }]);
    expect(text).toContain("{{ contact.greeting }}");
    expect(text).toContain("{{ contact.first_name | upcase }}");
  });

  it("puts a link marker on its own unwrapped line after the sentence", () => {
    const text = run([{
      id: "b_000000000002", type: "text",
      props: {
        ...blockDefaults("text"),
        content: [{
          t: "p",
          children: [
            { t: "s", v: "Podívejte se na " },
            { t: "a", href: "https://shop.cz/akce", children: [{ t: "s", v: "Zjistit více" }] },
          ],
        }],
      },
    }]);
    const lines = text.split("\r\n");
    expect(lines).toContain(MARKER);
    expect(lines.some((line) => line.includes("Zjistit více") && !line.includes(MARKER))).toBe(true);
  });

  it("formats a button as an arrow prefixed label with the marker below", () => {
    const text = run([{
      id: "b_000000000002", type: "button",
      props: {
        ...blockDefaults("button"), href: "https://shop.cz/akce",
        label: [{ t: "p", children: [{ t: "s", v: "Zjistit více" }] }],
      },
    }]);
    expect(text).toContain(">> Zjistit více:\r\n" + MARKER);
  });

  it("renders an image alt in brackets and skips decorative images", () => {
    expect(run([{
      id: "b_000000000002", type: "image",
      props: { ...blockDefaults("image"), assetId: "x", alt: "Popis obrázku" },
    }])).toContain("[Popis obrázku]");
    expect(run([{
      id: "b_000000000002", type: "image",
      props: { ...blockDefaults("image"), assetId: "x", alt: "Popis", decorative: true },
    }])).not.toContain("[Popis]");
  });

  it("drops bold and italic marks", () => {
    const text = run([{
      id: "b_000000000002", type: "text",
      props: { ...blockDefaults("text"), content: [{ t: "p", children: [{ t: "s", v: "tučně", b: true }] }] },
    }]);
    expect(text).toContain("tučně");
    expect(text).not.toContain("*tučně*");
  });

  it("stacks columns under each other", () => {
    const text = run([{
      id: "b_000000000002", type: "columns", props: blockDefaults("columns"),
      children: [0, 1].map((i) => ({
        id: `b_00000000000${i + 3}`, type: "column", props: blockDefaults("column"),
        children: [{
          id: `b_00000000001${i}`, type: "text",
          props: { ...blockDefaults("text"), content: [{ t: "p", children: [{ t: "s", v: `sloupec${i}` }] }] },
        }],
      })),
    }]);
    expect(text.indexOf("sloupec0")).toBeLessThan(text.indexOf("sloupec1"));
  });

  it("always contains the unsubscribe link, even when html has it only in the footer", () => {
    const text = run([{ id: "b_000000000002", type: "footer", props: blockDefaults("footer") }]);
    expect(text).toContain("{{ workspace.sender_address }}");
    expect(text).toContain("Odhlásit se z odběru: {{ unsubscribe_url }}");
    expect(text).toContain("Zobrazit v prohlížeči: {{ webview_url }}");
  });

  it("wraps a conditional block in the same liquid condition as html", () => {
    const text = run([{
      id: "b_000000000002", type: "text",
      visibleWhen: { field: "contact.city", op: "present" },
      props: { ...blockDefaults("text"), content: [{ t: "p", children: [{ t: "s", v: "Jsme i u vás" }] }] },
    }]);
    expect(text).toContain("{% if _present.contact__city %}");
    expect(text).toContain("{% endif %}");
  });

  it("never has three blank lines in a row and ends with exactly one newline", () => {
    const text = run([
      { id: "b_000000000002", type: "spacer", props: blockDefaults("spacer") },
      { id: "b_000000000003", type: "spacer", props: blockDefaults("spacer") },
      { id: "b_000000000004", type: "spacer", props: blockDefaults("spacer") },
    ]);
    expect(text).not.toContain("\r\n\r\n\r\n\r\n");
    expect(text.endsWith("\r\n")).toBe(true);
    expect(text.endsWith("\r\n\r\n")).toBe(false);
  });

  it("converts the html block through html-to-text, the only place we convert from html", () => {
    const text = run([{
      id: "b_000000000002", type: "html",
      props: { ...blockDefaults("html"), code: "<p>Ahoj <b>světe</b></p>" },
    }]);
    expect(text).toContain("Ahoj světe");
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm vitest run packages/emails/test/text/emit.test.ts`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napiš implementaci**

`packages/emails/src/text/emit.ts`:

```ts
import { convert } from "html-to-text";
import { varOutput } from "../emitter/rich-text.js";
import { visibilityTags } from "../emitter/visibility.js";
import type {
  AnyBlock, ColumnsBlock, InlineNode, RichText, SectionChild,
} from "../document/types.js";
import type { NormalizedDocument } from "../normalize/index.js";
import { PLAIN_TEXT_WIDTH, wrapPlain } from "./wrap.js";

export type TextRenderOptions = {
  normalized: NormalizedDocument;
  linkHref: (href: string, trackable: boolean) => string;
};

type Collected = { text: string; markers: string[] };

export function renderDocumentText(options: TextRenderOptions): string {
  const lines: string[] = [];
  for (const section of options.normalized.doc.blocks) {
    if (options.normalized.skippedBlockIds.has(section.id)) continue;
    pushConditional(lines, section, options, (out) => {
      for (const child of section.children) emitChild(out, child, options);
    });
  }
  return finish(lines);
}

function pushConditional(
  lines: string[],
  block: AnyBlock,
  options: TextRenderOptions,
  body: (out: string[]) => void,
): void {
  const condition = (block as { visibleWhen?: Parameters<typeof visibilityTags>[0] | null }).visibleWhen;
  if (condition) lines.push(visibilityTags(condition)[0]);
  body(lines);
  if (condition) lines.push(visibilityTags(condition)[1]);
}

function emitChild(lines: string[], block: SectionChild, options: TextRenderOptions): void {
  if (options.normalized.skippedBlockIds.has(block.id)) return;
  if (block.type === "columns") {
    // Sloupcová sazba v prostém textu nefunguje, sloupce jdou pod sebe.
    const columns = block as ColumnsBlock;
    for (const column of columns.children) {
      for (const child of column.children) emitChild(lines, child, options);
      lines.push("");
    }
    return;
  }
  pushConditional(lines, block, options, (out) => emitBlock(out, block, options));
}

function emitBlock(lines: string[], block: SectionChild, options: TextRenderOptions): void {
  switch (block.type) {
    case "heading": {
      const { text, markers } = collect(block.props.content, options);
      if (text.trim() === "") return;
      lines.push(...wrapPlain(text));
      // Úroveň 3 se schválně nepřevádí na velká písmena: rozbila by diakritiku
      // i Liquid výrazy, přesně jak to dělá toPlainText z react-emailu.
      if (block.props.level === 1) lines.push("=".repeat(Math.min(text.length, PLAIN_TEXT_WIDTH)));
      if (block.props.level === 2) lines.push("-".repeat(Math.min(text.length, PLAIN_TEXT_WIDTH)));
      lines.push(...markers, "");
      return;
    }
    case "text": {
      for (const node of block.props.content) {
        if (node.t === "p") {
          const { text, markers } = collect([node], options);
          if (text.trim() !== "") lines.push(...wrapPlain(text), ...markers, "");
          continue;
        }
        node.items.forEach((item, index) => {
          const { text, markers } = collectInline(item, options);
          const bullet = node.t === "ul" ? "- " : `${index + 1}. `;
          const indent = node.t === "ul" ? "  " : "   ";
          lines.push(...wrapPlain(bullet + text, { indent }), ...markers);
        });
        lines.push("");
      }
      return;
    }
    case "image": {
      if (block.props.decorative) return;
      if (block.props.alt.trim() !== "") lines.push(`[${block.props.alt}]`);
      if (block.props.href) lines.push(options.linkHref(block.props.href, block.props.trackable));
      lines.push("");
      return;
    }
    case "button": {
      const { text } = collect(block.props.label, options);
      lines.push("", `>> ${text}:`, options.linkHref(block.props.href, block.props.trackable), "");
      return;
    }
    case "divider":
      lines.push("", "-".repeat(40), "");
      return;
    case "spacer":
      lines.push("");
      return;
    case "social": {
      for (const item of block.props.items) {
        lines.push(`${item.label ?? item.network}:`, options.linkHref(item.href, false));
      }
      lines.push("");
      return;
    }
    case "footer": {
      const { text } = collect(block.props.senderInfo, options);
      lines.push("", ...wrapPlain(text), "");
      if (block.props.showUnsubscribe) {
        lines.push(`${block.props.unsubscribeLabel}: {{ unsubscribe_url }}`);
      }
      if (block.props.showPreferences) {
        lines.push(`${block.props.preferencesLabel}: {{ preferences_url }}`);
      }
      if (block.props.showWebview) {
        lines.push(`${block.props.webviewLabel}: {{ webview_url }}`);
      }
      lines.push("");
      return;
    }
    case "html": {
      // Jediné místo, kde se převádí z HTML, protože jiná informace tam není.
      const converted = convert(block.props.code, {
        wordwrap: PLAIN_TEXT_WIDTH,
        selectors: [{ selector: "a", options: { ignoreHref: true } }],
      });
      lines.push(...converted.split("\n"), "");
      return;
    }
    default:
      return;
  }
}

function collect(rich: RichText, options: TextRenderOptions): Collected {
  const parts: string[] = [];
  const markers: string[] = [];
  for (const node of rich) {
    if (node.t === "p") {
      const inline = collectInline(node.children, options);
      parts.push(inline.text);
      markers.push(...inline.markers);
    } else {
      for (const item of node.items) {
        const inline = collectInline(item, options);
        parts.push(inline.text);
        markers.push(...inline.markers);
      }
    }
  }
  return { text: parts.join(" ").trim(), markers };
}

function collectInline(nodes: InlineNode[], options: TextRenderOptions): Collected {
  let text = "";
  const markers: string[] = [];
  for (const node of nodes) {
    if (node.t === "s") {
      // Značky tučného a kurzívy se zahazují, `*text*` vypadá v prostém textu jako chyba.
      text += node.v;
    } else if (node.t === "br") {
      text += " ";
    } else if (node.t === "var") {
      text += varOutput(node);
    } else {
      const inner = collectInline(node.children, options);
      text += inner.text;
      markers.push(...inner.markers, options.linkHref(node.href, node.trackable !== false));
    }
  }
  return { text, markers };
}

/** Sesbírané řádky na hotový text: nejvýše dva prázdné řádky za sebou, konce CRLF. */
function finish(lines: string[]): string {
  const out: string[] = [];
  let blanks = 0;
  for (const line of lines) {
    if (line.trim() === "") {
      blanks += 1;
      if (blanks > 1) continue;
      out.push("");
      continue;
    }
    blanks = 0;
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  return `${out.join("\r\n")}\r\n`;
}
```

- [ ] **Step 4: Spusť test a ověř, že projde**

Run: `pnpm vitest run packages/emails/test/text/emit.test.ts`
Expected: PASS, 13 testů. Test „never uppercases a heading" pokrývá kritéria 19b a 19c a je povinný.

- [ ] **Step 5: Commit**

```bash
git add packages/emails/src/text/emit.ts packages/emails/test/text/emit.test.ts
git commit -m "feat(emails): plain text emitted from the document, not from html"
```

---

## Fáze E: kompilace do Liquidu

### Task 25: Deterministické `link_id` a sběr odkazů

**Files:**
- Create: `packages/emails/src/compile/links.ts`
- Test: `packages/emails/test/compile/link-id.test.ts`
- Test: `packages/emails/test/compile/links.test.ts`

`link_id` musí být **deterministické**, protože kompilace může proběhnout víckrát (předodesílací kontrola, spuštění, oprava pozastavené kampaně). Náhodné UUID by změnilo `compiled_html` mezi běhy, rozpadlo golden fixtures a klik zaznamenaný proti staré verzi by ukazoval na řádek, který už neexistuje.

**Odvození `link_id` si tenhle plán nepíše sám.** Vlastní ho kontrakt: `deriveLinkId(campaignId, position)` z `@mlain/contracts/markers`. Dřívější znění téhle kapitoly implementovalo UUIDv5 vlastními dvaceti řádky, jenže tím by vznikly **dvě implementace jednoho kontraktu**, obě testované nad týmiž vstupy, a produkce by používala jen jednu. Je to přesně ta vada, kvůli které vzniklo rozhodnutí R1 pro Go stranu; tady se řeší stejně, implementaci má jedno místo a tenhle plán ji volá. Viz revidované rozhodnutí D6.

- [ ] **Step 1: Napiš padající testy**

`packages/emails/test/compile/link-id.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveLinkId, LINK_ID_NAMESPACE, ZERO_UUID } from "@mlain/contracts/markers";

/**
 * Test se schválně NEPTÁ implementace, kterou hlídá: očekávané hodnoty jsou
 * spočítané nezávisle a zapsané natvrdo. Kdyby kontrakt odvození změnil,
 * rozejdou se všechny uložené `campaign_links` s tím, co je ve značkách,
 * a tenhle test to zachytí dřív, než se kampaň rozešle.
 * Hodnoty jsou ověřené spuštěním, ne opsané odhadem.
 */
const CAMPAIGN = "0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071";

describe("deriveLinkId", () => {
  it("pins the derivation to known vectors", () => {
    expect(deriveLinkId(CAMPAIGN, 1)).toBe("a5a7d935-035e-518e-8895-ca6c6f1f8f38");
    expect(deriveLinkId(CAMPAIGN, 2)).toBe("4172df61-1817-5ebb-a591-5a6b19a9a8e2");
    expect(deriveLinkId(CAMPAIGN, 3)).toBe("10d3e541-c97e-50a2-8535-93d19326570f");
  });

  it("pins the preview derivation, where the campaign is the zero uuid", () => {
    expect(ZERO_UUID).toBe("00000000-0000-0000-0000-000000000000");
    expect(deriveLinkId(ZERO_UUID, 1)).toBe("307fd8bb-627d-54fa-9186-b57ce53b6e5d");
  });

  it("sets the version and variant bits of uuid v5", () => {
    const id = deriveLinkId(CAMPAIGN, 1);
    expect(id[14]).toBe("5");
    expect(["8", "9", "a", "b"]).toContain(id[19]);
  });

  it("distinguishes positions and campaigns", () => {
    expect(deriveLinkId(CAMPAIGN, 1)).not.toBe(deriveLinkId(CAMPAIGN, 2));
    expect(deriveLinkId(CAMPAIGN, 1)).not.toBe(deriveLinkId(ZERO_UUID, 1));
    expect(LINK_ID_NAMESPACE).toBe("6f9619ff-8b86-d011-b42d-00c04fc964ff");
  });
});
```

`packages/emails/test/compile/links.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { blockDefaults, DEFAULT_THEME } from "../../src/document/defaults.js";
import type { Document, SectionBlock } from "../../src/document/types.js";
import { collectLinks } from "../../src/compile/links.js";

const CAMPAIGN = "0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071";

const docOf = (children: unknown[]): Document => ({
  schemaVersion: 1,
  meta: { name: "T", previewText: "", language: "cs" },
  theme: DEFAULT_THEME,
  blocks: [{ id: "b_000000000001", type: "section", props: blockDefaults("section"), children } as unknown as SectionBlock],
});

const link = (id: string, href: string, label = "Odkaz", trackable = true) => ({
  id, type: "text",
  props: {
    ...blockDefaults("text"),
    content: [{ t: "p", children: [{ t: "a", href, trackable, children: [{ t: "s", v: label }] }] }],
  },
});

const run = (children: unknown[], over: Record<string, unknown> = {}) =>
  collectLinks(docOf(children), { campaignId: CAMPAIGN, trackClicks: true, skippedBlockIds: new Set(), ...over });

describe("collectLinks", () => {
  it("numbers links from one in first occurrence order", () => {
    const result = run([
      link("b_000000000002", "https://a.cz", "A"),
      link("b_000000000003", "https://b.cz", "B"),
    ]);
    expect(result.links.map((l) => [l.position, l.url, l.label]))
      .toEqual([[1, "https://a.cz", "A"], [2, "https://b.cz", "B"]]);
  });

  it("gives the same target the same id and one row", () => {
    const result = run([
      link("b_000000000002", "https://a.cz"),
      link("b_000000000003", "https://a.cz"),
    ]);
    expect(result.links).toHaveLength(1);
    expect(result.hrefFor("https://a.cz", true)).toBe(result.hrefFor("https://a.cz", true));
  });

  it("derives the id from the campaign and the position", () => {
    const first = run([link("b_000000000002", "https://a.cz")]).links[0]!;
    const again = run([link("b_000000000002", "https://a.cz")]).links[0]!;
    expect(first.id).toBe(again.id);
    const other = run([link("b_000000000002", "https://a.cz")], { campaignId: "0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6072" }).links[0]!;
    expect(other.id).not.toBe(first.id);
  });

  it("uses the nil uuid when there is no campaign, keeping previews deterministic", () => {
    const result = run([link("b_000000000002", "https://a.cz")], { campaignId: undefined });
    expect(result.warnings.map((w) => w.code)).toContain("link_ids_not_campaign_scoped");
    expect(result.links[0]!.id)
      .toBe(run([link("b_000000000002", "https://a.cz")], { campaignId: undefined }).links[0]!.id);
  });

  it("returns the marker as the whole href value", () => {
    const result = run([link("b_000000000002", "https://a.cz")]);
    expect(result.hrefFor("https://a.cz", true))
      .toBe(`https://track.mlain.invalid/c/${result.links[0]!.id}`);
  });

  it("never marks mailto, tel, system tags or a variable href", () => {
    const result = run([
      link("b_000000000002", "mailto:a@b.cz"),
      link("b_000000000003", "tel:+420123456789"),
      link("b_000000000004", "{{ unsubscribe_url }}"),
      link("b_000000000005", "{{ contact.attr.url }}", "X", false),
    ]);
    expect(result.hrefFor("mailto:a@b.cz", true)).toBe("mailto:a@b.cz");
    expect(result.hrefFor("tel:+420123456789", true)).toBe("tel:+420123456789");
    expect(result.hrefFor("{{ unsubscribe_url }}", true)).toBe("{{ unsubscribe_url }}");
    expect(result.hrefFor("{{ contact.attr.url }}", false)).toBe("{{ contact.attr.url }}");
    expect(result.links).toHaveLength(0);
  });

  it("still records rows when click tracking is off but emits the target url", () => {
    const result = run([link("b_000000000002", "https://a.cz")], { trackClicks: false });
    expect(result.links).toHaveLength(1);
    expect(result.links[0]!.trackable).toBe(true);
    expect(result.hrefFor("https://a.cz", true)).toBe("https://a.cz");
  });

  it("collects button and image links with a useful label", () => {
    const result = run([
      {
        id: "b_000000000002", type: "button",
        props: {
          ...blockDefaults("button"), href: "https://c.cz",
          label: [{ t: "p", children: [{ t: "s", v: "Koupit" }] }],
        },
      },
      {
        id: "b_000000000003", type: "image",
        props: { ...blockDefaults("image"), assetId: "x", alt: "Banner", href: "https://d.cz" },
      },
    ]);
    expect(result.links.map((l) => l.label)).toEqual(["Koupit", "Banner"]);
  });

  it("ignores links inside a skipped block", () => {
    const result = run([link("b_000000000002", "https://a.cz")], {
      skippedBlockIds: new Set(["b_000000000002"]),
    });
    expect(result.links).toHaveLength(0);
  });

  it("rejects more than 999 links", () => {
    const many = Array.from({ length: 1000 }, (_, i) =>
      link(`b_c${String(i).padStart(11, "0")}`, `https://a.cz/${i}`));
    expect(run(many).issues.map((i) => i.code)).toContain("content_too_many_links");
  });
});
```

- [ ] **Step 2: Spusť testy a ověř, že spadnou**

Run: `pnpm vitest run packages/emails/test/compile/link-id.test.ts packages/emails/test/compile/links.test.ts`
Expected: `link-id.test.ts` PASS (kontrakt už existuje, tenhle test ho jen zamyká), `links.test.ts` FAIL, modul neexistuje.

- [ ] **Step 3: Napiš `packages/emails/src/compile/links.ts`**

```ts
import { CLICK_MARKER_PREFIX, deriveLinkId, ZERO_UUID } from "@mlain/contracts/markers";
import type { Issue } from "../issue.js";
import type { Document, RichText } from "../document/types.js";
import { MAX_LINKS_PER_DOCUMENT } from "../document/types.js";
import { richTextFieldsOf, walkBlocks, walkRichText } from "../document/walk.js";
import type { CompiledLink } from "./types.js";

export type CollectLinksOptions = {
  campaignId?: string;
  trackClicks: boolean;
  skippedBlockIds: Set<string>;
};

export type CollectedLinks = {
  links: CompiledLink[];
  /** Vrátí hodnotu atributu href, tedy buď značku, nebo původní adresu. */
  hrefFor: (href: string, trackable: boolean) => string;
  issues: Issue[];
  warnings: Issue[];
};

const SYSTEM_URL_TAG = /^\{\{\s*(unsubscribe_url|preferences_url|webview_url)\s*\}\}$/;
const HAS_LIQUID = /\{\{|\{%/;

function plainLabel(rich: RichText): string {
  const parts: string[] = [];
  for (const node of rich) {
    const inline = node.t === "p" ? node.children : node.items.flat();
    for (const child of inline) if (child.t === "s") parts.push(child.v);
  }
  return parts.join("").trim();
}

/** Trackovatelný je jen statický absolutní odkaz http nebo https bez Liquidu. */
export function isTrackableTarget(href: string, trackable: boolean): boolean {
  const trimmed = href.trim();
  if (!trackable) return false;
  if (trimmed === "" || trimmed === "#") return false;
  if (SYSTEM_URL_TAG.test(trimmed)) return false;
  if (HAS_LIQUID.test(trimmed)) return false;
  return trimmed.startsWith("https://") || trimmed.startsWith("http://");
}

export function collectLinks(doc: Document, options: CollectLinksOptions): CollectedLinks {
  const byUrl = new Map<string, CompiledLink>();
  const issues: Issue[] = [];
  const warnings: Issue[] = [];
  const campaignId = options.campaignId ?? ZERO_UUID;

  if (!options.campaignId) {
    // Nulové UUID místo náhodného: odvození zůstane deterministické, takže dva
    // náhledy téhož dokumentu dají bajtově shodný výstup.
    warnings.push({ code: "link_ids_not_campaign_scoped", severity: "warning", pointer: "" });
  }

  const record = (href: string, trackable: boolean, label: string): void => {
    if (!isTrackableTarget(href, trackable)) return;
    const url = href.trim();
    if (byUrl.has(url)) return;
    const position = byUrl.size + 1;
    byUrl.set(url, {
      id: deriveLinkId(campaignId, position),
      position,
      url,
      trackable: true,
      label,
    });
  };

  for (const { block, pointer } of walkBlocks(doc)) {
    if (options.skippedBlockIds.has(block.id)) continue;
    for (const field of richTextFieldsOf(block)) {
      for (const { node } of walkRichText(field.rich, `${pointer}/props/${field.key}`)) {
        if (node.t !== "a") continue;
        record(node.href, node.trackable !== false, plainLabel([{ t: "p", children: node.children }]));
      }
    }
    if (block.type === "button") record(block.props.href, block.props.trackable, plainLabel(block.props.label));
    if (block.type === "image" && block.props.href) {
      record(block.props.href, block.props.trackable, block.props.alt);
    }
    // Odkazy uvnitř bloku `html` a v sociálních ikonách se vědomě netrackují (4.1.4).
  }

  const links = [...byUrl.values()];
  if (links.length > MAX_LINKS_PER_DOCUMENT) {
    issues.push({ code: "content_too_many_links", severity: "error", pointer: "", params: { count: links.length } });
  }

  const hrefFor = (href: string, trackable: boolean): string => {
    if (!options.trackClicks) return href;
    if (!isTrackableTarget(href, trackable)) return href;
    const link = byUrl.get(href.trim());
    return link ? `${CLICK_MARKER_PREFIX}${link.id}` : href;
  };

  return { links, hrefFor, issues, warnings };
}
```

- [ ] **Step 4: Spusť testy a ověř, že projdou**

Run: `pnpm vitest run packages/emails/test/compile/link-id.test.ts packages/emails/test/compile/links.test.ts`
Expected: PASS, 14 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/emails/src/compile/links.ts packages/emails/test/compile
git commit -m "feat(emails): deterministic link ids and tracking markers"
```

---

### Task 26: `renderSchema` a použité cesty

**Files:**
- Create: `packages/emails/src/compile/render-schema.ts`
- Test: `packages/emails/test/compile/render-schema.test.ts`

Kritéria 33, 33b a 33c. Pole použité **jen v podmínce** se dostane do `presence` a **ne** do `fields`, takže materializace pošle jen boolean, ne obsah pole. Je to vedlejší přínos, který zmenšuje personalizační data.

- [ ] **Step 1: Napiš padající test**

`packages/emails/test/compile/render-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { FieldCatalog } from "@mlain/core/contacts/fields/catalog";
import { blockDefaults, DEFAULT_THEME } from "../../src/document/defaults.js";
import type { Document, SectionBlock } from "../../src/document/types.js";
import { buildRenderSchema } from "../../src/compile/render-schema.js";

const catalog: FieldCatalog = {
  version: "v1",
  fields: [
    { path: "greeting", type: "string", label: { en: "Greeting" }, group: "salutation", deleted: false },
    { path: "attr.city", type: "string", label: { en: "City" }, group: "custom", deleted: false },
    { path: "attr.is_vip", type: "boolean", label: { en: "VIP" }, group: "custom", deleted: false },
    { path: "created_at", type: "datetime", label: { en: "Created" }, group: "meta", deleted: false },
  ],
};

const docOf = (children: unknown[]): Document => ({
  schemaVersion: 1,
  meta: { name: "T", previewText: "", language: "cs" },
  theme: DEFAULT_THEME,
  blocks: [{ id: "b_000000000001", type: "section", props: blockDefaults("section"), children } as unknown as SectionBlock],
});

const textWith = (id: string, children: unknown[], visibleWhen?: unknown) => ({
  id, type: "text", visibleWhen,
  props: { ...blockDefaults("text"), content: [{ t: "p", children }] },
});

const run = (children: unknown[]) =>
  buildRenderSchema(docOf(children), { fields: catalog, skippedBlockIds: new Set() });

describe("buildRenderSchema", () => {
  it("lists exactly the contact paths that the document outputs", () => {
    const schema = run([
      textWith("b_000000000002", [
        { t: "var", expr: "contact.greeting" },
        { t: "var", expr: "contact.attr.city | upcase" },
      ]),
    ]);
    expect(schema.fields.map((f) => f.path)).toEqual(["contact.greeting", "contact.attr.city"]);
    expect(schema.fields.every((f) => f.required === false)).toBe(true);
  });

  it("resolves the type from the field catalog", () => {
    const schema = run([textWith("b_000000000002", [{ t: "var", expr: "contact.created_at | date" }])]);
    expect(schema.fields[0]).toEqual({ path: "contact.created_at", type: "datetime", required: false });
  });

  it("puts a condition only field into presence and not into fields", () => {
    const schema = run([
      textWith("b_000000000002", [{ t: "s", v: "Jsme i u vás" }], { field: "contact.attr.city", op: "present" }),
    ]);
    expect(schema.presence).toEqual(["contact.attr.city"]);
    expect(schema.fields).toEqual([]);
  });

  it("puts a field used both ways into both lists", () => {
    const schema = run([
      textWith("b_000000000002", [{ t: "var", expr: "contact.attr.city" }], { field: "contact.attr.city", op: "present" }),
    ]);
    expect(schema.fields.map((f) => f.path)).toEqual(["contact.attr.city"]);
    expect(schema.presence).toEqual(["contact.attr.city"]);
  });

  it("puts a boolean condition into fields, because it needs no presence map", () => {
    const schema = run([
      textWith("b_000000000002", [{ t: "s", v: "VIP" }], { field: "contact.attr.is_vip", op: "true" }),
    ]);
    expect(schema.presence).toEqual([]);
    expect(schema.fields.map((f) => f.path)).toEqual(["contact.attr.is_vip"]);
  });

  it("collects system tags from hrefs and from the footer switches", () => {
    const schema = run([
      { id: "b_000000000002", type: "footer", props: blockDefaults("footer") },
    ]);
    expect(schema.systemTags.sort())
      .toEqual(["preferences_url", "unsubscribe_url", "webview_url"]);
  });

  it("keeps campaign and workspace roots out of presence but inside fields", () => {
    const schema = run([textWith("b_000000000002", [{ t: "var", expr: "workspace.sender_address" }])]);
    expect(schema.fields.map((f) => f.path)).toEqual(["workspace.sender_address"]);
    expect(schema.fields[0]!.type).toBe("string");
  });

  it("flattens everything into usedPaths without duplicates", () => {
    const schema = run([
      textWith("b_000000000002", [{ t: "var", expr: "contact.attr.city" }], { field: "contact.attr.city", op: "present" }),
      { id: "b_000000000003", type: "footer", props: blockDefaults("footer") },
    ]);
    expect(new Set(schema.usedPaths).size).toBe(schema.usedPaths.length);
    expect(schema.usedPaths).toContain("contact.attr.city");
    expect(schema.usedPaths).toContain("unsubscribe_url");
  });

  it("has no loops in MVP 0 because repeat is never emitted", () => {
    expect(run([]).renderSchema.loops).toEqual([]);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm vitest run packages/emails/test/compile/render-schema.test.ts`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napiš implementaci**

`packages/emails/src/compile/render-schema.ts`:

```ts
import type { FieldCatalog, FieldCatalogType } from "@mlain/core/contacts/fields/catalog";
import { toCatalogPath } from "../paths.js";
import type { RenderSchema } from "./types.js";
import type { Document, VisibilityCondition } from "../document/types.js";
import { richTextFieldsOf, walkBlocks, walkRichText } from "../document/walk.js";

export type RenderSchemaOptions = {
  fields: FieldCatalog;
  skippedBlockIds: Set<string>;
};

export type RenderSchemaResult = {
  renderSchema: RenderSchema;
  fields: RenderSchema["fields"];
  presence: string[];
  systemTags: string[];
  usedPaths: string[];
};

const SYSTEM_TAGS = new Set([
  "unsubscribe_url", "one_click_unsubscribe_url", "preferences_url", "webview_url",
]);
const SYSTEM_URL_TAG = /^\{\{\s*(unsubscribe_url|preferences_url|webview_url)\s*\}\}$/;

/** Cesta z výrazu: všechno před prvním filtrem. */
function pathOf(expr: string): string {
  return expr.split("|")[0]!.trim();
}

function typeOf(path: string, catalog: FieldCatalog): FieldCatalogType {
  if (!path.startsWith("contact.")) return "string";
  const entry = catalog.fields.find((f) => f.path === toCatalogPath(path));
  return entry?.type ?? "string";
}

export function buildRenderSchema(doc: Document, options: RenderSchemaOptions): RenderSchemaResult {
  const fieldPaths: string[] = [];
  const presence: string[] = [];
  const systemTags: string[] = [];

  const addField = (path: string): void => {
    if (!fieldPaths.includes(path)) fieldPaths.push(path);
  };
  const addSystem = (tag: string): void => {
    if (!systemTags.includes(tag)) systemTags.push(tag);
  };

  for (const { block, pointer } of walkBlocks(doc)) {
    if (options.skippedBlockIds.has(block.id)) continue;

    const condition = (block as { visibleWhen?: VisibilityCondition | null }).visibleWhen;
    if (condition) {
      if (condition.op === "present" || condition.op === "blank") {
        if (!presence.includes(condition.field)) presence.push(condition.field);
      } else {
        // Boolean pole pomocnou mapu nepotřebuje, false a nil jsou v obou
        // knihovnách jediné nepravdivé hodnoty. Hodnota ale musí do render_data.
        addField(condition.field);
      }
    }

    for (const field of richTextFieldsOf(block)) {
      for (const { node } of walkRichText(field.rich, `${pointer}/props/${field.key}`)) {
        if (node.t === "a") {
          const tag = node.href.trim().match(SYSTEM_URL_TAG);
          if (tag?.[1]) addSystem(tag[1]);
          continue;
        }
        if (node.t !== "var") continue;
        const path = pathOf(node.expr);
        if (SYSTEM_TAGS.has(path)) addSystem(path);
        else addField(path);
      }
    }

    if (block.type === "footer") {
      if (block.props.showUnsubscribe) addSystem("unsubscribe_url");
      if (block.props.showPreferences) addSystem("preferences_url");
      if (block.props.showWebview) addSystem("webview_url");
    }
  }

  const fields = fieldPaths.map((path) => ({
    path,
    type: typeOf(path, options.fields),
    required: false,
  }));

  const renderSchema: RenderSchema = {
    version: 1,
    fields,
    systemTags,
    presence,
    // Cykly vydá až MVP 1; `repeat` je v MVP 0 vždy mezi přeskočenými bloky.
    loops: [],
  };

  const usedPaths = [...new Set([...fieldPaths, ...systemTags, ...presence])];
  return { renderSchema, fields, presence, systemTags, usedPaths };
}
```

- [ ] **Step 4: Spusť test a ověř, že projde**

Run: `pnpm vitest run packages/emails/test/compile/render-schema.test.ts`
Expected: PASS, 9 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/emails/src/compile/render-schema.ts packages/emails/test/compile/render-schema.test.ts
git commit -m "feat(emails): render schema extraction with presence paths"
```

---

### Task 27: Invarianty po renderu

**Files:**
- Create: `packages/emails/src/compile/invariants.ts`
- Test: `packages/emails/test/compile/invariants.test.ts`

Renderer si po vygenerování HTML **sám zkontroluje pravidla a při porušení selže**, místo aby vrátil vadné HTML. Je to levné a chytá to celou třídu chyb. **I8 je jediná nefatální výjimka** a je to vědomé: velikost HTML není vada výstupu, ale vlastnost obsahu, který napsal uživatel, a hranice 102 kB navíc není ostrá. Blokující je až předodesílací kontrola.

- [ ] **Step 1: Napiš padající test**

`packages/emails/test/compile/invariants.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { checkInvariants } from "../../src/compile/invariants.js";

const link = { id: "2f1a9c40-0000-5000-8000-000000000001", position: 1, url: "https://a.cz", trackable: true, label: "A" };
const MARKER = `https://track.mlain.invalid/c/${link.id}`;

const base = (over: Record<string, unknown> = {}) => ({
  html: `<!DOCTYPE html><html><body><a href="${MARKER}">x</a><!--ML_OPEN_PIXEL--></body></html>`,
  text: `${MARKER}\r\n`,
  links: [link],
  trackOpens: true,
  purpose: "send" as const,
  filterSlots: [],
  usedSlots: new Set<number>(),
  unknownSlots: [] as number[],
  exemptSlots: new Set<number>(),
  rawPrefix: "ML_RAW_ab12cd34ef_",
  ...over,
});

const codes = (over: Record<string, unknown> = {}) =>
  checkInvariants(base(over)).issues.map((i) => i.code);

describe("invariants", () => {
  it("passes for a well formed document", () => {
    expect(codes()).toEqual([]);
  });

  it("I1 rejects a corrupted liquid construct", () => {
    expect(codes({ html: "<html><body>{{ contact.first_name | nope }}</body></html>", text: "" }))
      .toContain("render_liquid_corrupted");
  });

  it("I1 rejects an html entity inside a liquid construct", () => {
    expect(codes({ html: '<html><body>{{ x | default: &quot;y&quot; }}</body></html>', text: "" }))
      .toContain("liquid_escaped_entity_in_construct");
  });

  it("I2 requires exactly one pixel marker when opens are tracked", () => {
    expect(codes({ html: "<html><body>none</body></html>", text: "", links: [] }))
      .toContain("render_pixel_slot_invalid");
    expect(codes({
      html: "<html><body><!--ML_OPEN_PIXEL--><!--ML_OPEN_PIXEL--></body></html>",
      text: "", links: [],
    })).toContain("render_pixel_slot_invalid");
    expect(codes({ html: "<html><body>x</body></html>", text: "", links: [], trackOpens: false }))
      .not.toContain("render_pixel_slot_invalid");
  });

  it("I3 rejects a marker whose uuid is not in the link map", () => {
    expect(codes({
      html: "<html><body><a href=\"https://track.mlain.invalid/c/2f1a9c40-0000-5000-8000-000000000009\">x</a><!--ML_OPEN_PIXEL--></body></html>",
      text: "",
    })).toContain("render_link_map_mismatch");
  });

  it("I3 rejects positions that are not a contiguous run from one", () => {
    expect(codes({ links: [{ ...link, position: 2 }] })).toContain("render_link_map_mismatch");
  });

  it("I3 counts markers in html and text together", () => {
    expect(checkInvariants(base()).clickMarkerCount).toBe(2);
  });

  it("I4 rejects editor attributes leaking into a send render", () => {
    expect(codes({ html: '<html><body><div data-ml-block="b_1"></div><!--ML_OPEN_PIXEL--></body></html>', text: "", links: [] }))
      .toContain("render_editor_attrs_leaked");
    expect(codes({
      html: '<html><body><div data-ml-block="b_1"></div></body></html>',
      text: "", links: [], trackOpens: false, purpose: "preview",
    })).not.toContain("render_editor_attrs_leaked");
  });

  it("I5 rejects unbalanced tables outside conditional comments", () => {
    expect(codes({ html: "<html><body><table><tr><td>x</td></tr><!--ML_OPEN_PIXEL--></body></html>", text: "", links: [] }))
      .toContain("render_invalid_html");
  });

  it("I5 accepts tables opened only inside a conditional comment", () => {
    expect(codes({
      html: "<html><body><!--[if mso]><table><tr><td><![endif]-->x<!--[if mso]></td></tr></table><![endif]--><!--ML_OPEN_PIXEL--></body></html>",
      text: "", links: [],
    })).not.toContain("render_invalid_html");
  });

  it("I6 rejects forbidden content", () => {
    for (const bad of ["<script>", "javascript:void(0)", "onerror=x", "onload=x"]) {
      expect(codes({ html: `<html><body>${bad}<!--ML_OPEN_PIXEL--></body></html>`, text: "", links: [] }), bad)
        .toContain("render_forbidden_content");
    }
  });

  it("I7 requires src, width, height and alt on every image", () => {
    expect(codes({ html: '<html><body><img src="a.png"><!--ML_OPEN_PIXEL--></body></html>', text: "", links: [] }))
      .toContain("render_image_incomplete");
    expect(codes({
      html: '<html><body><img src="a.png" width="1" height="1" alt=""><!--ML_OPEN_PIXEL--></body></html>',
      text: "", links: [],
    })).not.toContain("render_image_incomplete");
  });

  it("I8 is a warning, never an error", () => {
    const big = `<html><body>${"x".repeat(110_000)}<!--ML_OPEN_PIXEL--></body></html>`;
    const result = checkInvariants(base({ html: big, text: "", links: [] }));
    const found = result.issues.find((i) => i.code === "render_too_large");
    expect(found?.severity).toBe("warning");
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("I9 rejects an unresolved filter slot", () => {
    expect(codes({ html: "<html><body>ML_ARG_0001<!--ML_OPEN_PIXEL--></body></html>", text: "", links: [] }))
      .toContain("render_filter_slot_unresolved");
  });

  it("I10 reports a slot that never appeared, unless its block is conditional", () => {
    const slots = [{ slot: 1, blockId: "b_1", filter: "default" as const, value: "x" }];
    expect(codes({ filterSlots: slots, usedSlots: new Set() }))
      .toContain("render_filter_slot_missing");
    expect(codes({ filterSlots: slots, usedSlots: new Set(), exemptSlots: new Set([1]) }))
      .not.toContain("render_filter_slot_missing");
  });

  it("I11 rejects an unknown slot number and a value outside the whitelist", () => {
    expect(codes({ unknownSlots: [99] })).toContain("render_filter_slot_invalid_value");
  });

  it("I12 rejects a leftover raw slot marker", () => {
    expect(codes({ html: "<html><body>ML_RAW_ab12cd34ef_0001<!--ML_OPEN_PIXEL--></body></html>", text: "", links: [] }))
      .toContain("render_raw_slot_unresolved");
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm vitest run packages/emails/test/compile/invariants.test.ts`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napiš implementaci**

`packages/emails/src/compile/invariants.ts`:

```ts
import { CLICK_MARKER_PREFIX, OPEN_PIXEL_MARKER } from "@mlain/contracts/markers";
import { validateLiquid } from "@mlain/contracts/liquid";
import { fromLiquidIssue, type Issue } from "../issue.js";
import { parseHTML } from "linkedom";
import type { FilterSlot } from "../normalize/slots.js";
import type { CompiledLink } from "./types.js";

export type InvariantInput = {
  html: string;
  text: string;
  links: CompiledLink[];
  trackOpens: boolean;
  purpose: "send" | "preview" | "test";
  filterSlots: FilterSlot[];
  usedSlots: Set<number>;
  unknownSlots: number[];
  /** Sloty uvnitř podmíněného bloku se nekontrolují, viz I10. */
  exemptSlots: Set<number>;
  rawPrefix: string;
};

export type InvariantResult = { issues: Issue[]; clickMarkerCount: number };

const HTML_SOFT_LIMIT = 102_400;
const LIQUID_CONSTRUCT = /\{\{[^}]*\}\}|\{%[^%]*%\}/g;
const ENTITY = /&(quot|#39|lt|gt|amp);/;
const COMMENT = /<!--[\s\S]*?-->/g;

const error = (code: string, params?: Record<string, string | number>): Issue =>
  ({ code, severity: "error", pointer: "", params });

export function checkInvariants(input: InvariantInput): InvariantResult {
  const issues: Issue[] = [];
  const both = `${input.html}\n${input.text}`;

  // I1
  for (const construct of both.match(LIQUID_CONSTRUCT) ?? []) {
    if (ENTITY.test(construct)) {
      issues.push(error("liquid_escaped_entity_in_construct", { construct }));
      continue;
    }
    // Druhá úroveň gramatiky. `level: "compiled"` je jediný rozdíl proti autorské
    // kontrole: kompilovaná šablona argumenty filtrů má a kořen `_present` smí,
    // autorská ani jedno. Samostatná funkce `validateCompiledLiquid` neexistuje,
    // je to tentýž `validateLiquid` s jiným kontextem.
    if (!validateLiquid(construct, { level: "compiled" }).ok) {
      issues.push(error("render_liquid_corrupted", { construct }));
    }
  }

  // I2
  const pixels = input.html.split(OPEN_PIXEL_MARKER).length - 1;
  if ((input.trackOpens && pixels !== 1) || (!input.trackOpens && pixels !== 0)) {
    issues.push(error("render_pixel_slot_invalid", { found: pixels }));
  }

  // I3
  const found = [...both.matchAll(new RegExp(`${CLICK_MARKER_PREFIX}([0-9a-f-]{36})`, "g"))];
  const clickMarkerCount = found.length;
  const known = new Set(input.links.map((link) => link.id));
  for (const match of found) {
    if (!known.has(match[1]!)) {
      issues.push(error("render_link_map_mismatch", { linkId: match[1]! }));
      break;
    }
  }
  const positions = input.links.map((link) => link.position).sort((a, b) => a - b);
  if (positions.some((position, index) => position !== index + 1)) {
    issues.push(error("render_link_map_mismatch", { reason: "positions" }));
  }

  // I4
  if (input.purpose === "send" && /data-ml-(block|link)=/.test(input.html)) {
    issues.push(error("render_editor_attrs_leaked"));
  }

  // I5
  try {
    parseHTML(input.html);
  } catch {
    issues.push(error("render_invalid_html", { reason: "parse" }));
  }
  // Komentáře se odstraní dřív, jinak by se počítaly i tabulky uvnitř
  // podmíněných komentářů pro Outlook, které v DOM nikdy nevzniknou.
  const visible = input.html.replace(COMMENT, "");
  const opened = (visible.match(/<table[\s>]/g) ?? []).length;
  const closed = (visible.match(/<\/table>/g) ?? []).length;
  if (opened !== closed) {
    issues.push(error("render_invalid_html", { opened, closed }));
  }

  // I6
  if (/<script|javascript:|onerror=|onload=/i.test(input.html)) {
    issues.push(error("render_forbidden_content"));
  }

  // I7
  for (const tag of input.html.match(/<img\b[^>]*>/gi) ?? []) {
    const complete = /\ssrc=/.test(tag) && /\swidth=/.test(tag)
      && /\sheight=/.test(tag) && /\salt=/.test(tag);
    if (!complete) {
      issues.push(error("render_image_incomplete", { tag: tag.slice(0, 80) }));
      break;
    }
  }

  // I8, jediná nefatální výjimka
  const htmlBytes = Buffer.byteLength(input.html, "utf8");
  if (htmlBytes > HTML_SOFT_LIMIT) {
    issues.push({ code: "render_too_large", severity: "warning", pointer: "", params: { bytes: htmlBytes } });
  }

  // I9
  if (both.includes("ML_ARG_")) issues.push(error("render_filter_slot_unresolved"));

  // I10
  for (const slot of input.filterSlots) {
    if (input.usedSlots.has(slot.slot) || input.exemptSlots.has(slot.slot)) continue;
    issues.push(error("render_filter_slot_missing", { slot: slot.slot }));
  }

  // I11
  if (input.unknownSlots.length > 0) {
    issues.push(error("render_filter_slot_invalid_value", { slots: input.unknownSlots.join(",") }));
  }

  // I12
  if (both.includes(input.rawPrefix)) issues.push(error("render_raw_slot_unresolved"));

  return { issues, clickMarkerCount };
}
```

- [ ] **Step 4: Spusť test a ověř, že projde**

Run: `pnpm vitest run packages/emails/test/compile/invariants.test.ts`
Expected: PASS, 17 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/emails/src/compile/invariants.ts packages/emails/test/compile/invariants.test.ts
git commit -m "feat(emails): post render invariants I1 to I12"
```

---

### Task 28: `compileDocument`

**Files:**
- Create: `packages/emails/src/compile/compile.ts`
- Test: `packages/emails/test/compile/compile.test.ts`

Tohle je jediná veřejná funkce kontraktu 5. Pořadí kroků je normativní a **krok s doplněním argumentů filtrů je schválně poslední**, protože React escapuje textové uzly a uvozovka vložená dřív by se změnila v `&quot;`.

**Co compileDocument nedělá:** nespouští sémantický validátor. Ten patří do `packages/core/templates/validate.ts` a volá se **před** kompilací, při uložení šablony i jako tvrdá brána před spuštěním kampaně. Kompilace tedy předpokládá platný dokument a hlídá jen to, co jinde ohlídat nejde: povinný `campaignId`, hodnoty argumentů filtrů a invarianty.

- [ ] **Step 1: Napiš padající test**

`packages/emails/test/compile/compile.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { FieldCatalog } from "@mlain/core/contacts/fields/catalog";
import { blockDefaults, DEFAULT_THEME } from "../../src/document/defaults.js";
import type { Document, SectionBlock } from "../../src/document/types.js";
import { compileDocument } from "../../src/compile/compile.js";
import type { CompileContext } from "../../src/compile/types.js";

const catalog: FieldCatalog = {
  version: "v1",
  fields: [
    { path: "first_name", type: "string", label: { en: "First name" }, group: "name", deleted: false },
    { path: "created_at", type: "datetime", label: { en: "Created" }, group: "meta", deleted: false },
  ],
};

const ctx = (over: Partial<CompileContext> = {}): CompileContext => ({
  workspaceId: "0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6000",
  campaignId: "0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071",
  templateKind: "campaign",
  fields: catalog,
  language: "cs",
  assetBaseUrl: "https://assets.test",
  assets: {},
  purpose: "send",
  trackOpens: true,
  trackClicks: true,
  currentYear: 2026,
  rawNonce: "ab12cd34ef",
  ...over,
});

const docOf = (children: unknown[]): Document => ({
  schemaVersion: 1,
  meta: { name: "T", previewText: "Preheader", language: "cs" },
  theme: DEFAULT_THEME,
  blocks: [{ id: "b_000000000001", type: "section", props: blockDefaults("section"), children } as unknown as SectionBlock],
});

const footer = { id: "b_000000000099", type: "footer", props: blockDefaults("footer") };

describe("compileDocument", () => {
  it("returns html, text and meta for a valid document", async () => {
    const result = await compileDocument(docOf([footer]), ctx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(result.text.endsWith("\r\n")).toBe(true);
    expect(result.meta.contractVersion).toBe(1);
    expect(result.meta.rendererVersion).toMatch(/^r\d+\.\d+\.\d+$/);
    expect(result.meta.hasUnsubscribeLink).toBe(true);
    expect(result.meta.hasOpenPixelSlot).toBe(true);
  });

  it("is byte identical for two compilations of the same input", async () => {
    const a = await compileDocument(docOf([footer]), ctx());
    const b = await compileDocument(docOf([footer]), ctx());
    if (!a.ok || !b.ok) throw new Error("expected success");
    expect(a.html).toBe(b.html);
    expect(a.text).toBe(b.text);
    expect(a.meta.links).toEqual(b.meta.links);
  });

  it("inserts the fallback value in quotes without a single entity", async () => {
    const text = {
      id: "b_000000000002", type: "text",
      props: {
        ...blockDefaults("text"),
        content: [{ t: "p", children: [{ t: "var", expr: "contact.first_name | default", fallback: "kolego" }] }],
      },
    };
    const result = await compileDocument(docOf([text, footer]), ctx());
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.html).toContain('{{ contact.first_name | default:"kolego" }}');
    expect(result.html).not.toContain("&quot;");
    expect(result.html).not.toContain("ML_ARG_");
  });

  it("gives two blocks with the same expression their own fallback value", async () => {
    const block = (id: string, fallback: string) => ({
      id, type: "text",
      props: {
        ...blockDefaults("text"),
        content: [{ t: "p", children: [{ t: "var", expr: "contact.first_name | default", fallback }] }],
      },
    });
    const result = await compileDocument(
      docOf([block("b_000000000002", "kolego"), block("b_000000000003", "zákazníku"), footer]),
      ctx(),
    );
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.html.indexOf('default:"kolego"'))
      .toBeLessThan(result.html.indexOf('default:"zákazníku"'));
  });

  it("rejects a date format outside the whitelist", async () => {
    const text = {
      id: "b_000000000002", type: "text",
      props: {
        ...blockDefaults("text"),
        content: [{
          t: "p",
          children: [{ t: "var", expr: "contact.created_at | date", dateFormat: "%B %Y" }],
        }],
      },
    };
    const result = await compileDocument(docOf([text, footer]), ctx());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.code)).toContain("liquid_date_format_not_allowed");
  });

  it("rejects a fallback value containing a quote", async () => {
    const text = {
      id: "b_000000000002", type: "text",
      props: {
        ...blockDefaults("text"),
        content: [{ t: "p", children: [{ t: "var", expr: "contact.first_name | default", fallback: 'a"b' }] }],
      },
    };
    const result = await compileDocument(docOf([text, footer]), ctx());
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.code)).toContain("liquid_default_value_invalid");
  });

  it("requires a campaign id when the purpose is send", async () => {
    const result = await compileDocument(docOf([footer]), ctx({ campaignId: undefined }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.code)).toContain("compile_campaign_id_required");
  });

  it("allows a preview without a campaign and warns about the link ids", async () => {
    const link = {
      id: "b_000000000002", type: "text",
      props: {
        ...blockDefaults("text"),
        content: [{ t: "p", children: [{ t: "a", href: "https://a.cz", children: [{ t: "s", v: "A" }] }] }],
      },
    };
    const result = await compileDocument(docOf([link, footer]), ctx({ purpose: "preview", campaignId: undefined }));
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.meta.warnings.map((w) => w.code)).toContain("link_ids_not_campaign_scoped");
  });

  it("counts markers in html and text together", async () => {
    const link = {
      id: "b_000000000002", type: "text",
      props: {
        ...blockDefaults("text"),
        content: [{ t: "p", children: [{ t: "a", href: "https://a.cz", children: [{ t: "s", v: "A" }] }] }],
      },
    };
    const result = await compileDocument(docOf([link, footer]), ctx());
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.meta.clickMarkerCount).toBe(2);
    expect(result.meta.links).toHaveLength(1);
  });

  it("emits no marker at all when click tracking is off and escapes the ampersand in html only", async () => {
    const link = {
      id: "b_000000000002", type: "text",
      props: {
        ...blockDefaults("text"),
        content: [{ t: "p", children: [{ t: "a", href: "https://a.cz/?a=1&b=2", children: [{ t: "s", v: "A" }] }] }],
      },
    };
    const result = await compileDocument(docOf([link, footer]), ctx({ trackClicks: false }));
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.meta.clickMarkerCount).toBe(0);
    expect(result.html).toContain("?a=1&amp;b=2");
    expect(result.text).toContain("?a=1&b=2");
  });

  it("skips a repeat block and warns", async () => {
    const repeat = {
      id: "b_000000000002", type: "repeat",
      props: { ...blockDefaults("repeat"), path: "contact.attr.items" }, children: [],
    };
    const result = await compileDocument(docOf([repeat, footer]), ctx());
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.meta.warnings.map((w) => w.code)).toContain("repeat_block_not_supported");
  });

  it("reports byte sizes and asset ids in the meta", async () => {
    const result = await compileDocument(docOf([footer]), ctx());
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.meta.htmlBytes).toBe(Buffer.byteLength(result.html, "utf8"));
    expect(result.meta.textBytes).toBe(Buffer.byteLength(result.text, "utf8"));
    expect(result.meta.assetIds).toEqual([]);
  });

  it("sets hasOpenPixelSlot false for a system template", async () => {
    const result = await compileDocument(docOf([footer]), ctx({ templateKind: "system", trackOpens: false }));
    if (!result.ok) throw new Error(JSON.stringify(result.issues));
    expect(result.meta.hasOpenPixelSlot).toBe(false);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm vitest run packages/emails/test/compile/compile.test.ts`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napiš implementaci**

`packages/emails/src/compile/compile.ts`:

```ts
import type { Issue } from "../issue.js";
import type { DateFormat, Document } from "../document/types.js";
import { renderDocumentHtml } from "../emitter/render.js";
import { normalizeDocument } from "../normalize/index.js";
import { renderDocumentText } from "../text/emit.js";
import { RAW_SLOT_PREFIX } from "../normalize/slots.js";
import { applyFilterSlots } from "./apply-slots.js";
import { checkInvariants } from "./invariants.js";
import { collectLinks } from "./links.js";
import { buildRenderSchema } from "./render-schema.js";
import {
  CONTRACT_VERSION, RENDERER_VERSION,
  type CompileContext, type CompileMeta, type CompileResult,
} from "./types.js";

/** Whitelist celých formátů z kontraktu (část 1, 4.10.2). Nic jiného neprojde. */
export const ALLOWED_DATE_FORMATS: readonly DateFormat[] = [
  "%d.%m.%Y", "%-d.%-m.%Y", "%Y-%m-%d", "%d.%m.%Y %H:%M", "%H:%M",
];

const FORBIDDEN_IN_FALLBACK = /["'{}<>]/;

export async function compileDocument(doc: Document, ctx: CompileContext): Promise<CompileResult> {
  const issues: Issue[] = [];

  if (ctx.purpose === "send" && !ctx.campaignId) {
    return {
      ok: false,
      issues: [{ code: "compile_campaign_id_required", severity: "error", pointer: "" }],
    };
  }

  const normalized = normalizeDocument(doc, { language: ctx.language });

  // Hodnoty argumentů filtrů se validují proti témuž whitelistu, jaký hlídá
  // validátor u atributu bloku. Kompilace je jediné místo, které smí argument vyrobit.
  for (const slot of normalized.filterSlots) {
    if (slot.filter === "date" && !ALLOWED_DATE_FORMATS.includes(slot.value as DateFormat)) {
      issues.push({
        code: "liquid_date_format_not_allowed", severity: "error", pointer: "",
        params: { format: slot.value, blockId: slot.blockId },
      });
    }
    if (slot.filter === "default" && FORBIDDEN_IN_FALLBACK.test(slot.value)) {
      issues.push({
        code: "liquid_default_value_invalid", severity: "error", pointer: "",
        params: { blockId: slot.blockId },
      });
    }
  }
  if (issues.length > 0) return { ok: false, issues };

  const links = collectLinks(normalized.doc, {
    campaignId: ctx.campaignId,
    trackClicks: ctx.trackClicks,
    skippedBlockIds: normalized.skippedBlockIds,
  });
  if (links.issues.length > 0) return { ok: false, issues: links.issues };

  const trackOpens = ctx.trackOpens && ctx.templateKind !== "system";

  const renderedHtml = await renderDocumentHtml({
    normalized,
    assets: ctx.assets,
    assetBaseUrl: ctx.assetBaseUrl,
    linkHref: links.hrefFor,
    trackOpens,
    trackClicks: ctx.trackClicks,
    preheader: ctx.preheader ?? normalized.doc.meta.previewText,
    rawNonce: ctx.rawNonce,
  });
  const renderedText = renderDocumentText({ normalized, linkHref: links.hrefFor });

  // AŽ TADY. React escapuje textové uzly, takže uvozovka vložená dřív
  // by se změnila na &quot; a Liquid by přestal být platný.
  const htmlSlots = applyFilterSlots(renderedHtml, normalized.filterSlots);
  const textSlots = applyFilterSlots(renderedText, normalized.filterSlots);
  const html = htmlSlots.output;
  const text = textSlots.output;

  const conditional = conditionalBlockIds(normalized.doc);
  const exemptSlots = new Set(
    normalized.filterSlots
      .filter((slot) => conditional.has(slot.blockId))
      .map((slot) => slot.slot),
  );

  const invariants = checkInvariants({
    html, text,
    links: links.links,
    trackOpens,
    purpose: ctx.purpose,
    filterSlots: normalized.filterSlots,
    usedSlots: new Set([...htmlSlots.used, ...textSlots.used]),
    unknownSlots: [...htmlSlots.unknown, ...textSlots.unknown],
    exemptSlots,
    rawPrefix: RAW_SLOT_PREFIX,
  });
  const fatal = invariants.issues.filter((issue) => issue.severity === "error");
  if (fatal.length > 0) return { ok: false, issues: fatal };

  const schema = buildRenderSchema(normalized.doc, {
    fields: ctx.fields,
    skippedBlockIds: normalized.skippedBlockIds,
  });

  const meta: CompileMeta = {
    contractVersion: CONTRACT_VERSION,
    rendererVersion: RENDERER_VERSION,
    schemaVersion: normalized.doc.schemaVersion,
    usedPaths: schema.usedPaths,
    renderSchema: schema.renderSchema,
    links: links.links,
    assetIds: collectAssetIds(normalized.doc),
    htmlBytes: Buffer.byteLength(html, "utf8"),
    textBytes: Buffer.byteLength(text, "utf8"),
    warnings: [
      ...normalized.warnings,
      ...links.warnings,
      ...invariants.issues.filter((issue) => issue.severity !== "error"),
    ],
    hasUnsubscribeLink: schema.systemTags.includes("unsubscribe_url"),
    clickMarkerCount: invariants.clickMarkerCount,
    hasOpenPixelSlot: trackOpens,
  };

  return { ok: true, html, text, meta };
}

/**
 * ID bloků, které leží pod nějakou podmínkou zobrazení, včetně potomků.
 * Jejich sloty se v invariantu I10 nekontrolují: blok uvnitř `{% if %}` se
 * ve výstupu objevit nemusí, a to je v pořádku.
 */
function conditionalBlockIds(doc: Document): Set<string> {
  const out = new Set<string>();
  type Node = { id: string; visibleWhen?: unknown; children?: Node[] };
  const visit = (block: Node, inherited: boolean): void => {
    const conditional = inherited || Boolean(block.visibleWhen);
    if (conditional) out.add(block.id);
    for (const child of block.children ?? []) visit(child, conditional);
  };
  for (const section of doc.blocks) visit(section as unknown as Node, false);
  return out;
}

function collectAssetIds(doc: Document): string[] {
  const ids = new Set<string>();
  const visit = (block: { type: string; props?: Record<string, unknown>; children?: unknown[] }): void => {
    const props = block.props ?? {};
    for (const key of ["assetId", "darkVariantAssetId", "backgroundImageAssetId"]) {
      const value = props[key];
      if (typeof value === "string" && value !== "") ids.add(value);
    }
    for (const child of (block.children as typeof block[] | undefined) ?? []) visit(child);
  };
  for (const section of doc.blocks) visit(section as never);
  return [...ids];
}
```

- [ ] **Step 4: Spusť test a ověř, že projde**

Run: `pnpm vitest run packages/emails/test/compile`
Expected: PASS, celá kompilační vrstva.

- [ ] **Step 5: Commit**

```bash
git add packages/emails/src/compile/compile.ts packages/emails/test/compile/compile.test.ts
git commit -m "feat(emails): compileDocument, the fifth contract"
```

---

## Fáze F: základní šablona, vzorová data a golden fixtures

### Task 29: Značka na motiv a prostý text na `RichText`

**Files:**
- Create: `packages/emails/src/base/brand.ts`
- Create: `packages/emails/src/base/rich.ts`
- Test: `packages/emails/test/base/brand.test.ts`

Klíčové pravidlo z 3.9.4: **generátor nikdy nevytvoří kombinaci, která nemá kontrast aspoň 4,5:1.** Když má značka světle žlutou primární barvu, text na tlačítku bude tmavý, ne bílý. Přesně tenhle detail dělá „vezmi barvu z webu" špatně.

- [ ] **Step 1: Napiš padající test**

`packages/emails/test/base/brand.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { contrastRatio } from "../../src/theme/palette.js";
import { brandToTheme, type BrandInput } from "../../src/base/brand.js";
import { plainToRichText } from "../../src/base/rich.js";

const brand = (over: Partial<BrandInput> = {}): BrandInput => ({
  palette: { primary: "#2563eb", background: "#ffffff", text: "#111827" },
  typography: { headingStack: "Georgia", bodyStack: "Arial", radius: 7 },
  ...over,
});

describe("brandToTheme", () => {
  it("maps the palette onto theme roles", () => {
    const theme = brandToTheme(brand({ palette: { primary: "#ff0000", background: "#eeeeee", text: "#222222" } }));
    expect(theme.colors["brand.primary"]).toBe("#ff0000");
    expect(theme.colors["surface.canvas"]).toBe("#eeeeee");
    expect(theme.colors["surface.content"]).toBe("#ffffff");
    expect(theme.colors["text.default"]).toBe("#222222");
  });

  it("keeps button text readable on a light yellow brand colour", () => {
    const theme = brandToTheme(brand({ palette: { primary: "#ffee00", background: "#ffffff", text: "#111111" } }));
    expect(contrastRatio(theme.colors["text.inverted"]!, "#ffee00")).toBeGreaterThanOrEqual(4.5);
  });

  it("keeps link colour readable against the content surface", () => {
    const theme = brandToTheme(brand({ palette: { primary: "#ffee00", background: "#ffffff", text: "#111111" } }));
    expect(contrastRatio(theme.colors["link.default"]!, "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("maps font stacks onto the closed list and falls back to system", () => {
    expect(brandToTheme(brand()).fonts).toEqual({ heading: "georgia", body: "arial" });
    expect(brandToTheme(brand({ typography: { headingStack: "Futura", bodyStack: "Futura", radius: 0 } })).fonts)
      .toEqual({ heading: "system", body: "system" });
  });

  it("rounds the radius onto an allowed value", () => {
    expect(brandToTheme(brand()).radius).toBe(6);
    expect(brandToTheme(brand({ typography: { headingStack: "", bodyStack: "", radius: 30 } })).radius).toBe(12);
  });

  it("derives a secondary colour when the brand has none", () => {
    const theme = brandToTheme(brand());
    expect(theme.colors["brand.secondary"]).toMatch(/^#[0-9a-f]{6}$/);
    expect(theme.colors["brand.secondary"]).not.toBe(theme.colors["brand.primary"]);
  });
});

describe("plainToRichText", () => {
  it("splits paragraphs on a blank line", () => {
    expect(plainToRichText("a\n\nb")).toEqual([
      { t: "p", children: [{ t: "s", v: "a" }] },
      { t: "p", children: [{ t: "s", v: "b" }] },
    ]);
  });

  it("turns a liquid expression into a var node so no html can ever get in", () => {
    expect(plainToRichText("Ahoj {{ contact.greeting }}!")).toEqual([
      {
        t: "p",
        children: [
          { t: "s", v: "Ahoj " },
          { t: "var", expr: "contact.greeting" },
          { t: "s", v: "!" },
        ],
      },
    ]);
  });

  it("keeps html markup as plain text, never as markup", () => {
    expect(plainToRichText("<b>x</b>")).toEqual([{ t: "p", children: [{ t: "s", v: "<b>x</b>" }] }]);
  });

  it("returns one empty paragraph for empty input", () => {
    expect(plainToRichText("")).toEqual([{ t: "p", children: [] }]);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm vitest run packages/emails/test/base/brand.test.ts`
Expected: FAIL, moduly neexistují.

- [ ] **Step 3: Napiš `packages/emails/src/base/brand.ts`**

```ts
import type { FontStackId, HexColor, Radius, Theme } from "../document/types.js";
import { DEFAULT_LIGHT, contrastRatio, shift } from "../theme/palette.js";
import { DEFAULT_THEME } from "../document/defaults.js";

export type BrandInput = {
  palette: {
    primary: string;
    secondary?: string;
    accent?: string;
    background?: string;
    text?: string;
  };
  typography: { headingStack: string; bodyStack: string; radius: number };
};

const STACK_HINTS: Array<[RegExp, FontStackId]> = [
  [/georgia/i, "georgia"],
  [/times|serif/i, "times"],
  [/courier|mono/i, "courier"],
  [/verdana/i, "verdana"],
  [/tahoma|segoe/i, "tahoma"],
  [/trebuchet/i, "trebuchet"],
  [/helvetica/i, "helvetica"],
  [/arial/i, "arial"],
];

const RADII: Radius[] = [0, 4, 6, 8, 12];

function mapStack(value: string): FontStackId {
  for (const [pattern, id] of STACK_HINTS) if (pattern.test(value)) return id;
  return "system";
}

/** Vybere z dvojice tu barvu, která má proti pozadí větší kontrast. */
function readableOn(background: string, candidates: HexColor[]): HexColor {
  let best = candidates[0]!;
  let bestRatio = contrastRatio(best, background);
  for (const candidate of candidates.slice(1)) {
    const ratio = contrastRatio(candidate, background);
    if (ratio > bestRatio) {
      best = candidate;
      bestRatio = ratio;
    }
  }
  return best;
}

/** Ztmavuje po krocích, dokud barva nedosáhne požadovaného kontrastu. */
function darkenUntil(color: string, background: string, target = 4.5): HexColor {
  let current = color as HexColor;
  for (let step = 0; step < 20; step += 1) {
    if (contrastRatio(current, background) >= target) return current;
    current = shift(current, -0.1);
  }
  return current;
}

export function brandToTheme(brand: BrandInput): Theme {
  const primary = brand.palette.primary as HexColor;
  const canvas = (brand.palette.background ?? DEFAULT_LIGHT["surface.canvas"]) as HexColor;
  const content: HexColor = "#ffffff";
  const text = (brand.palette.text ?? DEFAULT_LIGHT["text.default"]) as HexColor;

  return {
    ...DEFAULT_THEME,
    colors: {
      "brand.primary": primary,
      "brand.secondary": (brand.palette.secondary as HexColor) ?? shift(primary, 0.25),
      "brand.accent": (brand.palette.accent as HexColor) ?? primary,
      "surface.canvas": canvas,
      "surface.content": content,
      "surface.subtle": shift(canvas, -0.05),
      "text.default": text,
      "text.muted": shift(text, 0.35),
      // Text na tlačítku: bílá nebo tmavá, podle toho, co je na primární barvě čitelné.
      "text.inverted": readableOn(primary, ["#ffffff", "#111827"]),
      "link.default": darkenUntil(primary, content),
    },
    fonts: {
      heading: mapStack(brand.typography.headingStack),
      body: mapStack(brand.typography.bodyStack),
    },
    radius: RADII.reduce((best, value) =>
      Math.abs(value - brand.typography.radius) < Math.abs(best - brand.typography.radius) ? value : best,
      RADII[0]!),
  };
}
```

- [ ] **Step 4: Napiš `packages/emails/src/base/rich.ts`**

```ts
import type { InlineNode, RichText } from "../document/types.js";

const LIQUID = /\{\{([^}]*)\}\}/g;

/**
 * Prostý text s podporou Liquid výrazů na RichText. Nikdy nevzniká HTML:
 * tím je zaručeno, že ani AI, ani žádná integrace nedokáže do šablony
 * dostat značky, protože jediná cesta k HTML je blok `html` (3.9.3).
 */
export function plainToRichText(input: string): RichText {
  if (input.trim() === "") return [{ t: "p", children: [] }];
  return input
    .split(/\n{2,}/)
    .map((paragraph) => ({ t: "p" as const, children: toInline(paragraph) }));
}

function toInline(paragraph: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let cursor = 0;
  for (const match of paragraph.matchAll(LIQUID)) {
    const start = match.index!;
    if (start > cursor) nodes.push({ t: "s", v: paragraph.slice(cursor, start) });
    nodes.push({ t: "var", expr: match[1]!.trim() });
    cursor = start + match[0].length;
  }
  if (cursor < paragraph.length) nodes.push({ t: "s", v: paragraph.slice(cursor) });
  return nodes;
}
```

- [ ] **Step 5: Spusť test a ověř, že projde**

Run: `pnpm vitest run packages/emails/test/base/brand.test.ts`
Expected: PASS, 10 testů.

- [ ] **Step 6: Commit**

```bash
git add packages/emails/src/base packages/emails/test/base
git commit -m "feat(emails): brand to theme mapping with guaranteed contrast"
```

---

### Task 30: Generátor univerzální základní šablony

**Files:**
- Create: `packages/emails/src/base/i18n/cs.json`
- Create: `packages/emails/src/base/i18n/en.json`
- Create: `packages/emails/src/base/build.ts`
- Test: `packages/emails/test/base/build.test.ts`

Univerzální šablona je **součást produktu, ne jen příklad**. Není to hotový JSON, je to generátor: AI pak nemusí vymýšlet strukturu, „převleč šablonu do jiné značky" je zavolání s jiným `brand` a oprava v Outlooku se propíše do všech nově vytvořených šablon jedním commitem.

- [ ] **Step 1: Napiš padající test**

`packages/emails/test/base/build.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { validateDocumentSchema } from "../../src/document/schema.js";
import { checkStructure } from "../../src/document/semantic-structure.js";
import { buildBaseTemplate, type BaseTemplateParams } from "../../src/base/build.js";

const brand = {
  palette: { primary: "#2563eb", background: "#f4f5f7", text: "#111827" },
  typography: { headingStack: "Arial", bodyStack: "Arial", radius: 6 },
};

const params = (over: Partial<BaseTemplateParams> = {}): BaseTemplateParams => ({
  variant: "newsletter",
  brand,
  language: "cs",
  darkMode: true,
  sections: [
    { kind: "hero", headline: "Vítejte", subhead: "Novinky za červenec" },
    { kind: "article", heading: "První článek", body: "Text prvního článku." },
  ],
  ...over,
});

describe("buildBaseTemplate", () => {
  it("produces a document that passes the json schema", () => {
    expect(validateDocumentSchema(buildBaseTemplate(params()))).toEqual({ ok: true });
  });

  it("produces a document with no structural errors", () => {
    const issues = checkStructure(buildBaseTemplate(params()), { templateKind: "campaign" });
    expect(issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("always ends with a footer carrying the unsubscribe link", () => {
    const doc = buildBaseTemplate(params());
    const last = doc.blocks[doc.blocks.length - 1]!;
    const footer = last.children.find((child) => child.type === "footer");
    expect(footer).toBeDefined();
  });

  it("starts with a hidden preheader section", () => {
    const doc = buildBaseTemplate(params());
    const first = JSON.stringify(doc.blocks[0]);
    expect(first).toContain("campaign.preheader");
  });

  it("never bakes the sender address in as a constant", () => {
    const json = JSON.stringify(buildBaseTemplate(params()));
    expect(json).toContain("workspace.sender_address");
  });

  it("generates unique block ids", () => {
    const doc = buildBaseTemplate(params());
    const ids = JSON.stringify(doc).match(/"b_[0-9a-z]{12}"/g) ?? [];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("applies the brand to the theme", () => {
    const doc = buildBaseTemplate(params({
      brand: { ...brand, palette: { primary: "#ff0000", background: "#eeeeee", text: "#222222" } },
    }));
    expect(doc.theme.colors["brand.primary"]).toBe("#ff0000");
  });

  it("supports all four variants and gives each its own middle part", () => {
    const shapes = (["newsletter", "announcement", "transactional", "reengagement"] as const).map((variant) =>
      JSON.stringify(buildBaseTemplate(params({
        variant,
        sections: [{ kind: "hero", headline: "H" }, { kind: "keyValue", rows: [{ label: "a", value: "b" }] }],
      }))));
    expect(new Set(shapes).size).toBe(4);
  });

  it("turns a bullets section into a list block", () => {
    const doc = buildBaseTemplate(params({
      sections: [{ kind: "bullets", heading: "Proč", items: ["Rychle", "Levně"] }],
    }));
    expect(JSON.stringify(doc)).toContain('"t":"ul"');
  });

  it("turns a keyValue section into a two column table of text blocks", () => {
    const doc = buildBaseTemplate(params({
      variant: "transactional",
      sections: [{ kind: "keyValue", rows: [{ label: "Číslo", value: "123" }] }],
    }));
    expect(JSON.stringify(doc)).toContain('"type":"columns"');
  });

  it("uses czech labels for cs and english for en", () => {
    const cs = JSON.stringify(buildBaseTemplate(params({ language: "cs" })));
    const en = JSON.stringify(buildBaseTemplate(params({ language: "en" })));
    expect(cs).toContain("Odhlásit se z odběru");
    expect(en).toContain("Unsubscribe");
  });

  it("falls back to english labels for an unsupported language", () => {
    expect(JSON.stringify(buildBaseTemplate(params({ language: "sv-FI" })))).toContain("Unsubscribe");
  });

  it("is deterministic when an id generator is injected", () => {
    let counter = 0;
    const nextId = () => `b_${String(counter++).padStart(12, "0")}`;
    const a = buildBaseTemplate(params(), { nextId: (() => { counter = 0; return nextId; })() });
    counter = 0;
    const b = buildBaseTemplate(params(), { nextId });
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm vitest run packages/emails/test/base/build.test.ts`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napiš katalogy textů**

`packages/emails/src/base/i18n/cs.json`:

```json
{
  "footer.unsubscribe": "Odhlásit se z odběru",
  "footer.preferences": "Nastavit předvolby",
  "footer.webview": "Zobrazit v prohlížeči",
  "cta.default": "Zjistit více"
}
```

`packages/emails/src/base/i18n/en.json`:

```json
{
  "footer.unsubscribe": "Unsubscribe",
  "footer.preferences": "Manage preferences",
  "footer.webview": "View in browser",
  "cta.default": "Learn more"
}
```

- [ ] **Step 4: Napiš `packages/emails/src/base/build.ts`**

```ts
import { blockDefaults, DEFAULT_THEME } from "../document/defaults.js";
import { newBlockId } from "../document/ids.js";
import type {
  ColumnsBlock, Document, RichText, SectionBlock, SectionChild,
} from "../document/types.js";
import { SUPPORTED_LANGUAGES } from "../normalize/index.js";
import { brandToTheme, type BrandInput } from "./brand.js";
import { plainToRichText } from "./rich.js";
import cs from "./i18n/cs.json" with { type: "json" };
import en from "./i18n/en.json" with { type: "json" };

const CATALOGS: Record<string, Record<string, string>> = { cs, en };

export type BaseTemplateVariant = "newsletter" | "announcement" | "transactional" | "reengagement";

export type BaseSectionSpec =
  | { kind: "hero"; headline: string; subhead?: string; imageAssetId?: string; cta?: { label: string; href: string } }
  | { kind: "article"; heading: string; body: string; imageAssetId?: string; link?: { label: string; href: string } }
  | { kind: "feature"; imageAssetId?: string; headline: string; body: string; cta: { label: string; href: string } }
  | { kind: "bullets"; heading?: string; items: string[] }
  | { kind: "keyValue"; rows: Array<{ label: string; value: string }> }
  | { kind: "quote"; text: string; author?: string }
  | { kind: "cta"; label: string; href: string; note?: string }
  | { kind: "spacer" };

export type BaseTemplateParams = {
  variant: BaseTemplateVariant;
  brand: BrandInput;
  /** BCP 47. MVP 0 dodává texty pro cs a en, jinak se použije en. */
  language: string;
  sections: BaseSectionSpec[];
  websiteUrl?: string;
  darkMode: boolean;
};

export type BuildOptions = { nextId?: () => string };

/**
 * Parametr senderAddress tu vědomě není: adresu nese blok `footer` jako merge tag
 * a hodnotu doplní sender z aktuálního nastavení projektu. Kdyby ji generátor
 * dostával jako řetězec, zapekl by ji a po přestěhování firmy by byly všechny
 * vygenerované šablony špatně.
 */
export function buildBaseTemplate(params: BaseTemplateParams, options: BuildOptions = {}): Document {
  const id = options.nextId ?? newBlockId;
  const base = params.language.split("-")[0]!.toLowerCase();
  const language = (SUPPORTED_LANGUAGES as readonly string[]).includes(base) ? base : "en";
  const t = (key: string): string => CATALOGS[language]?.[key] ?? CATALOGS.en![key]!;

  const theme = brandToTheme(params.brand);
  const section = (children: SectionChild[], props: Partial<SectionBlock["props"]> = {}): SectionBlock => ({
    id: id(),
    type: "section",
    props: { ...blockDefaults("section"), ...props },
    children,
  });

  const text = (rich: RichText, over: Record<string, unknown> = {}): SectionChild =>
    ({ id: id(), type: "text", props: { ...blockDefaults("text"), content: rich, ...over } } as SectionChild);

  const heading = (level: 1 | 2 | 3, value: string, over: Record<string, unknown> = {}): SectionChild =>
    ({
      id: id(), type: "heading",
      props: { ...blockDefaults("heading"), level, content: plainToRichText(value), ...over },
    } as SectionChild);

  const button = (label: string, href: string): SectionChild =>
    ({
      id: id(), type: "button",
      props: { ...blockDefaults("button"), label: plainToRichText(label), href },
    } as SectionChild);

  const image = (assetId: string, alt = ""): SectionChild =>
    ({ id: id(), type: "image", props: { ...blockDefaults("image"), assetId, alt } } as SectionChild);

  const divider = (): SectionChild =>
    ({ id: id(), type: "divider", props: blockDefaults("divider") } as SectionChild);

  const twoColumns = (left: SectionChild[], right: SectionChild[]): ColumnsBlock => ({
    id: id(),
    type: "columns",
    props: { ...blockDefaults("columns"), layout: "1-1" },
    children: [
      { id: id(), type: "column", props: blockDefaults("column"), children: left as never },
      { id: id(), type: "column", props: blockDefaults("column"), children: right as never },
    ],
  });

  const middle: SectionBlock[] = [];
  for (const spec of params.sections) {
    switch (spec.kind) {
      case "hero":
        middle.push(section([
          ...(spec.imageAssetId ? [image(spec.imageAssetId)] : []),
          heading(1, spec.headline),
          ...(spec.subhead ? [text(plainToRichText(spec.subhead))] : []),
          ...(spec.cta ? [button(spec.cta.label, spec.cta.href)] : []),
        ]));
        break;
      case "article":
        middle.push(section([
          heading(3, spec.heading),
          ...(spec.imageAssetId ? [image(spec.imageAssetId)] : []),
          text(plainToRichText(spec.body)),
          ...(spec.link
            ? [text([{ t: "p", children: [{ t: "a", href: spec.link.href, children: [{ t: "s", v: spec.link.label }] }] }])]
            : []),
          divider(),
        ]));
        break;
      case "feature":
        middle.push(section([
          ...(spec.imageAssetId ? [image(spec.imageAssetId)] : []),
          heading(2, spec.headline),
          text(plainToRichText(spec.body)),
          button(spec.cta.label, spec.cta.href),
        ]));
        break;
      case "bullets":
        middle.push(section([
          ...(spec.heading ? [heading(3, spec.heading)] : []),
          text([{ t: "ul", items: spec.items.map((item) => [{ t: "s" as const, v: item }]) }]),
        ]));
        break;
      case "keyValue":
        middle.push(section(spec.rows.map((row) =>
          twoColumns(
            [text(plainToRichText(row.label), { color: "text.muted" })],
            [text(plainToRichText(row.value))],
          ))));
        break;
      case "quote":
        middle.push(section([
          text(plainToRichText(spec.text), { align: "center" }),
          ...(spec.author ? [text(plainToRichText(spec.author), { align: "center", color: "text.muted" })] : []),
        ]));
        break;
      case "cta":
        middle.push(section([
          button(spec.label, spec.href),
          ...(spec.note ? [text(plainToRichText(spec.note), { align: "center", color: "text.muted" })] : []),
        ]));
        break;
      case "spacer":
        middle.push(section([{ id: id(), type: "spacer", props: blockDefaults("spacer") } as SectionChild]));
        break;
    }
  }

  // Reaktivační varianta má pevný závěr se dvěma tlačítky vedle sebe.
  if (params.variant === "reengagement") {
    middle.push(section([
      twoColumns(
        [button(t("cta.default"), params.websiteUrl ?? "https://example.com")],
        [text([{ t: "p", children: [{ t: "a", href: "{{ unsubscribe_url }}", children: [{ t: "s", v: t("footer.unsubscribe") }] }] }])],
      ),
    ]));
  }

  return {
    schemaVersion: 1,
    meta: { name: "", previewText: "", language: params.language },
    theme: {
      ...theme,
      darkMode: { strategy: params.darkMode ? "auto" : "off", colors: DEFAULT_THEME.darkMode.colors },
    },
    blocks: [
      // Preheader: skrytý text, který schránka ukáže vedle předmětu.
      section([text([{ t: "p", children: [{ t: "var", expr: "campaign.preheader" }] }], {
        fontSize: 10, color: "surface.content",
      })], { padding: { top: 0, right: 0, bottom: 0, left: 0 } }),
      ...(params.brand.palette.primary
        ? [section([heading(3, "", { content: [] })], { padding: { top: 16, right: 24, bottom: 0, left: 24 } })]
        : []),
      ...middle,
      section([
        { id: id(), type: "footer", props: { ...blockDefaults("footer"),
          unsubscribeLabel: t("footer.unsubscribe"),
          preferencesLabel: t("footer.preferences"),
          webviewLabel: t("footer.webview") } } as SectionChild,
      ]),
    ],
  };
}
```

- [ ] **Step 5: Spusť test a ověř, že projde**

Run: `pnpm vitest run packages/emails/test/base/build.test.ts`
Expected: PASS, 13 testů.

- [ ] **Step 6: Commit**

```bash
git add packages/emails/src/base packages/emails/test/base/build.test.ts
git commit -m "feat(emails): universal base template generator"
```

---

### Task 31: Vzorová data pro náhled

**Files:**
- Create: `packages/emails/src/preview-data.ts`
- Test: `packages/emails/test/preview-data.test.ts`

Vzorová data obsahují **záměrně nepříjemné hodnoty**: dlouhé jméno, diakritiku, prázdné příjmení, prázdné vlastní pole a jméno s `<` a `&`. Náhled, který ukazuje jen „Jan Novák", nic neodhalí.

- [ ] **Step 1: Napiš padající test**

`packages/emails/test/preview-data.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { sampleRenderData } from "../src/preview-data.js";

describe("sampleRenderData", () => {
  it("provides both language variants", () => {
    expect(sampleRenderData("cs").contact.greeting).toContain("Dobrý den");
    expect(sampleRenderData("en").contact.greeting).toContain("Hello");
  });

  it("includes hostile values that break naive templates", () => {
    const data = sampleRenderData("cs");
    expect(data.contact.first_name).toMatch(/[ěščřžýáíé]/);
    expect(data.contact.last_name).toBe("");
    expect(JSON.stringify(data)).toContain("<");
    expect(JSON.stringify(data)).toContain("&");
  });

  it("always fills the internal context roots", () => {
    const data = sampleRenderData("cs");
    expect(data._context.timezone).toBe("Europe/Prague");
    expect(data._context.locale).toBe("cs");
  });

  it("starts with an empty presence map so the caller must fill it", () => {
    expect(sampleRenderData("cs")._present).toEqual({});
  });

  it("points every system url at the disabled anchor", () => {
    const data = sampleRenderData("cs");
    for (const key of ["unsubscribe_url", "preferences_url", "webview_url"] as const) {
      expect(data[key]).toBe("#preview-disabled");
    }
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm vitest run packages/emails/test/preview-data.test.ts`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napiš implementaci**

`packages/emails/src/preview-data.ts`:

```ts
export type SampleRenderData = {
  contact: Record<string, unknown>;
  campaign: Record<string, string>;
  workspace: Record<string, string>;
  unsubscribe_url: string;
  one_click_unsubscribe_url: string;
  preferences_url: string;
  webview_url: string;
  _context: { timezone: string; locale: string };
  _present: Record<string, boolean>;
};

/**
 * Systémové adresy vedou na #preview-disabled: nepodepisujeme reálné odhlašovací
 * tokeny pro cizí kontakt jen kvůli náhledu.
 */
export function sampleRenderData(language: "cs" | "en"): SampleRenderData {
  const cs = language === "cs";
  return {
    contact: {
      email: "jan.novak@example.com",
      first_name: cs ? "Přemyslav-Řehoř" : "Zoë",
      last_name: "",
      first_name_vocative: cs ? "Přemyslave-Řehoři" : "Zoë",
      last_name_vocative: "",
      title_prefix: "Ing.",
      title_suffix: "",
      greeting: cs ? "Dobrý den, Přemyslave-Řehoři" : "Hello Zoë",
      gender: "male",
      locale: language,
      created_at: "2026-01-15T09:30:00Z",
      attr: {
        city: "",
        company: "Novák & synové <s.r.o.>",
        vip: false,
      },
    },
    campaign: {
      name: cs ? "Letní výprodej" : "Summer sale",
      subject: cs ? "Slevy až 50 %" : "Up to 50% off",
      preheader: cs ? "Končí v neděli" : "Ends on Sunday",
    },
    workspace: {
      name: "Demo",
      sender_address: cs
        ? "Demo s.r.o.\nNa Příkopě 1\n110 00 Praha 1"
        : "Demo Ltd.\n1 Main Street\nLondon",
    },
    unsubscribe_url: "#preview-disabled",
    one_click_unsubscribe_url: "#preview-disabled",
    preferences_url: "#preview-disabled",
    webview_url: "#preview-disabled",
    _context: { timezone: "Europe/Prague", locale: language },
    // Naplní ji prepareRenderData podle renderSchema.presence, stejně jako u odeslání.
    _present: {},
  };
}
```

- [ ] **Step 4: Spusť test a ověř, že projde**

Run: `pnpm vitest run packages/emails/test/preview-data.test.ts`
Expected: PASS, 5 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/emails/src/preview-data.ts packages/emails/test/preview-data.test.ts
git commit -m "feat(emails): hostile sample data for previews"
```

---

### Task 32: Golden snapshoty rendereru

**Files:**
- Create: `packages/emails/test/__fixtures__/documents/*.json` (16 dokumentů)
- Create: `packages/emails/test/golden/render.golden.test.ts`
- Create: `packages/emails/test/golden/README.md`

Kritérium 18: sada nejméně 16 dokumentů má uložený očekávaný výstup a jakákoliv jeho změna shodí test. Nezachytí to, jestli e-mail vypadá dobře, ale zachytí, že se něco **změnilo**, a to je u rendereru ta podstatná vlastnost. Sada **musí** obsahovat dokumenty z kritérií 17b a 17c, jinak by šlo pravidlo o odvozených hodnotách porušit natvrdo napsanou konstantou a testy by zůstaly zelené.

- [ ] **Step 1: Vytvoř dokumenty fixtur**

Šestnáct souborů v `packages/emails/test/__fixtures__/documents/`. Každý je platný `Document` v JSON. Seznam je závazný:

| Soubor | Co pokrývá |
|---|---|
| `01-minimal.json` | Jedna sekce, jeden textový blok, patička |
| `02-all-blocks.json` | Všech devět obsahových typů bloků naráz |
| `03-two-columns.json` | `columns` s layoutem `1-1`, ghost tables |
| `04-three-columns.json` | `columns` s layoutem `2-1-1`, nerovné šířky |
| `05-button-vml.json` | Tlačítko plné šířky, `outline` i `solid` |
| `06-image-variants.json` | Obrázek `full` i pevné šířky, tmavá varianta loga |
| `07-merge-tags.json` | Šest merge tagů včetně `contact.greeting` a `contact.attr.*` |
| `08-filter-slots.json` | Dva bloky se stejným výrazem a různou náhradní hodnotou plus `date` |
| `09-conditional.json` | `visibleWhen` na sekci i na obsahovém bloku |
| `10-dark-custom.json` | **Vlastní `theme.darkMode.colors`** (kritérium 17b) |
| `11-typography-20.json` | **`baseFontSize: 20`** (kritérium 17b) |
| `12-partial-colors.json` | **Neúplná mapa `theme.colors`**, jen `brand.primary` (kritérium 17c) |
| `13-html-block.json` | Blok `html` se sanitizovaným obsahem a Liquidem |
| `14-social-footer.json` | Sociální ikony a patička se všemi třemi odkazy |
| `15-unknown-repeat.json` | Neznámý typ bloku a blok `repeat`, oba přeskočené s varováním |
| `16-presence-chain.json` | **Blok s podmínkou `visibleWhen` nad `contact.attr.city`** pro test celého řetězu, viz kapitola 0.6 |

- [ ] **Step 2: Napiš test, který zatím nemá s čím porovnávat**

`packages/emails/test/golden/render.golden.test.ts`:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { FieldCatalog } from "@mlain/core/contacts/fields/catalog";
import { COMPILED_ONLY_ROOTS } from "@mlain/contracts/liquid/grammar";
import { createHtmlEngine } from "@mlain/contracts/liquid/engine";
import { prepareRenderData } from "@mlain/contracts/liquid/prepare-render-data";
import { compileDocument } from "../../src/compile/compile.js";
import type { AssetRef, CompileContext } from "../../src/compile/types.js";
import type { Document } from "../../src/document/types.js";
import { toPreparedSchema } from "../../src/paths.js";

const DOCUMENTS = join(import.meta.dirname, "../__fixtures__/documents");

const catalog: FieldCatalog = {
  version: "golden",
  fields: [
    { path: "first_name", type: "string", label: { en: "First name" }, group: "name", deleted: false },
    { path: "greeting", type: "string", label: { en: "Greeting" }, group: "salutation", deleted: false },
    { path: "created_at", type: "datetime", label: { en: "Created" }, group: "meta", deleted: false },
    { path: "attr.city", type: "string", label: { en: "City" }, group: "custom", deleted: false },
    { path: "attr.is_vip", type: "boolean", label: { en: "VIP" }, group: "custom", deleted: false },
  ],
};

const asset: AssetRef = {
  id: "0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071",
  publicId: "aB3dEfGhIjKlMnOpQrStUv",
  mimeType: "image/png",
  width: 1200, height: 600, altText: null, animated: false,
  variants: [
    { variant: "orig", width: 1200, height: 600 },
    { variant: "w1200", width: 1200, height: 600 },
    { variant: "w600", width: 600, height: 300 },
    { variant: "w300", width: 300, height: 150 },
  ],
};

const darkAsset: AssetRef = { ...asset, id: "0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6072", publicId: "darkdarkdarkdarkdarkda" };

const context: CompileContext = {
  workspaceId: "0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6000",
  campaignId: "0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071",
  templateKind: "campaign",
  fields: catalog,
  language: "cs",
  assetBaseUrl: "https://assets.example.test",
  assets: { [asset.id]: asset, [darkAsset.id]: darkAsset },
  purpose: "send",
  trackOpens: true,
  trackClicks: true,
  currentYear: 2026,
  rawNonce: "goldennonce",
};

const files = readdirSync(DOCUMENTS).filter((name) => name.endsWith(".json")).sort();

describe("golden render snapshots", () => {
  it("has at least sixteen documents", () => {
    expect(files.length).toBeGreaterThanOrEqual(16);
  });

  it.each(files)("%s renders to the stored html and text", async (file) => {
    const doc = JSON.parse(readFileSync(join(DOCUMENTS, file), "utf8")) as Document;
    const result = await compileDocument(doc, context);
    if (!result.ok) throw new Error(`${file}: ${JSON.stringify(result.issues)}`);
    await expect(result.html).toMatchFileSnapshot(`../__fixtures__/expected/${file.replace(".json", ".html")}`);
    await expect(result.text).toMatchFileSnapshot(`../__fixtures__/expected/${file.replace(".json", ".txt")}`);
  });

  it("renders every fixture twice to the same bytes", async () => {
    for (const file of files) {
      const doc = JSON.parse(readFileSync(join(DOCUMENTS, file), "utf8")) as Document;
      const a = await compileDocument(doc, context);
      const b = await compileDocument(doc, context);
      if (!a.ok || !b.ok) throw new Error(file);
      expect(a.html, file).toBe(b.html);
    }
  });

  it("keeps every fixture under one hundred kilobytes", async () => {
    for (const file of files) {
      const doc = JSON.parse(readFileSync(join(DOCUMENTS, file), "utf8")) as Document;
      const result = await compileDocument(doc, context);
      if (!result.ok) throw new Error(file);
      expect(result.meta.htmlBytes, file).toBeLessThan(100_000);
    }
  });

  it("proves that the mobile heading size follows the theme, not a constant", async () => {
    const read = async (file: string) => {
      const doc = JSON.parse(readFileSync(join(DOCUMENTS, file), "utf8")) as Document;
      const result = await compileDocument(doc, context);
      if (!result.ok) throw new Error(file);
      return result.html;
    };
    const base = await read("01-minimal.json");
    const big = await read("11-typography-20.json");
    const sizeOf = (html: string) => html.match(/\.ml-h1\{font-size:(\d+)px/)?.[1];
    expect(sizeOf(base)).not.toBe(sizeOf(big));
  });

  it("proves that the dark palette comes from the theme", async () => {
    const doc = JSON.parse(readFileSync(join(DOCUMENTS, "10-dark-custom.json"), "utf8")) as Document;
    const result = await compileDocument(doc, context);
    if (!result.ok) throw new Error("10-dark-custom");
    expect(result.html).not.toContain(".ml-content{background-color:#111827!important}");
  });

  /**
   * Celý řetěz podmíněného bloku: model, kompilace, příprava dat a interpolace.
   * Kapitola 0.6 vysvětluje, proč tenhle test existuje: každý článek zvlášť je
   * v pořádku a rozejít se dokážou tak, že se to pozná až na odeslaném mailu,
   * kde chybí celá sekce a nikde přitom nic nespadlo.
   *
   * Test se schválně neptá konstant tohohle balíčku: jméno kořene bere
   * z `COMPILED_ONLY_ROOTS`, mapu plní kontraktní `prepareRenderData`
   * a interpoluje instancemi z kontraktů, tedy týmiž, jaké má náhled i sender.
   */
  it("presence map survives the whole chain, for both branches", async () => {
    const doc = JSON.parse(readFileSync(join(DOCUMENTS, "16-presence-chain.json"), "utf8")) as Document;
    const result = await compileDocument(doc, context);
    if (!result.ok) throw new Error(`16-presence-chain: ${JSON.stringify(result.issues)}`);

    expect(COMPILED_ONLY_ROOTS).toContain("_present");
    expect(result.html).toContain("{% if _present.contact__attr__city %}");
    expect(result.meta.renderSchema.presence).toContain("contact.attr.city");

    const engine = createHtmlEngine();
    const render = async (city: unknown) => {
      const data = prepareRenderData(
        { contact: { attr: { city } } },
        toPreparedSchema(result.meta.renderSchema),
      );
      // Kdyby `prepareRenderData` nikdo nezavolal, `_present` v datech nebude,
      // podmínka vyjde nepravdivě a blok zmizí VŽDY. Proto je volání téhle
      // funkce při materializaci zapsané jako požadavek R11 na P13.
      expect(data._present).toHaveProperty("contact__attr__city");
      return engine.parseAndRender(result.html, data);
    };

    expect(await render("Brno")).toContain("Jsme i u vás");
    expect(await render("")).not.toContain("Jsme i u vás");
    // Past prázdného řetězce: samé mezery nejsou vyplněná hodnota.
    expect(await render("   ")).not.toContain("Jsme i u vás");
    expect(await render(null)).not.toContain("Jsme i u vás");
  });
});
```

- [ ] **Step 3: Vygeneruj snapshoty a prohlédni si je**

Run: `pnpm vitest run packages/emails/test/golden/render.golden.test.ts -u`
Expected: vzniknou soubory v `packages/emails/test/__fixtures__/expected/`.

**Nezapisuj je bez přečtení.** Projdi aspoň `02-all-blocks.html` a ověř očima: `<!DOCTYPE html>` na začátku, `<o:PixelsPerInch>96` v hlavičce, `<!--ML_OPEN_PIXEL-->` těsně před `</body>`, žádný `ML_ARG_`, žádný `ML_RAW_`, žádná HTML entita uvnitř `{{ }}`.

- [ ] **Step 4: Spusť test bez aktualizace a ověř, že projde**

Run: `pnpm vitest run packages/emails/test/golden/render.golden.test.ts`
Expected: PASS, 22 testů.

- [ ] **Step 5: Napiš `packages/emails/test/golden/README.md`**

```markdown
# Golden snapshots of the renderer

These files pin the exact byte output of the renderer for sixteen documents.

**Updating a snapshot is a deliberate step.** Run `pnpm vitest run packages/emails/test/golden -u`
only when you intended to change the output, and explain the change in the commit message.
A snapshot updated without an explanation hides a regression.

Documents 10, 11 and 12 exist because of acceptance criteria 17b and 17c: without a document
carrying a non default `baseFontSize`, a custom dark palette and a partial colour map, the rule
that these values are derived from the theme could be broken by a hard coded constant and the
snapshots would stay green.
```

- [ ] **Step 6: Commit**

```bash
git add packages/emails/test/__fixtures__ packages/emails/test/golden
git commit -m "test(emails): sixteen golden render snapshots"
```

---

### Task 33: Fixtures kontraktu `CT-*`, data i běh

**Files:**
- Create: `packages/contracts/fixtures/compiled/CT-001.json` až `CT-018.json` (18 souborů, **data píše tenhle plán**)
- Create: `packages/emails/scripts/write-ct-fixtures.ts`
- Test: `packages/emails/test/golden/contract.ct.test.ts`

**Tohle je jediné místo, kde tenhle plán zapisuje do `packages/contracts`, a je to schválně.**

Dřívější znění téhle kapitoly říkalo: „fixtury vlastní P02, kdyby některá chyběla, **nedopisuj ji**". P02 přitom ve svém plánu psal, že je doplní P08. **Obě strany si myslely, že je píše ta druhá, a obě to měly jako závazné pravidlo, takže by je nenapsal nikdo** a osmnáct fixtur pátého kontraktu by trvale zůstalo prázdných. Rozhodnutí **R3** to uzavřelo: **data píše P08**, protože jako jediný má blokový model a renderer, tedy jako jediný je umí vyrobit. **P02 dodává schéma `CompiledFixture` a tvrzení `assertCompiledFixture`**, tedy tvar a spouštěč, ne obsah.

Dělba je proto tahle a nesmí se rozmazat:

| Vlastní P02 | Vlastní tenhle plán |
|---|---|
| typ `CompiledFixture` a funkce `assertCompiledFixture` v `packages/contracts/src/compiled.ts` | **osmnáct souborů `CT-0xx.json`** v `packages/contracts/fixtures/compiled/` |
| test, který hlídá, že adresář je buď prázdný, nebo úplný | generátor, který ty soubory vyrábí, a test, který je pouští proti kompilaci |

Adresář je `compiled`, ne `compile`: tři plány měly dvě různé cesty a platí tahle (nález N37).

Klíč `compiled` s `html` a `text` **je povinný**, i když si ho tenhle plán sám nečte: čte ho **Go strana**, která blokový model nezná a renderer nemá. Sender dostává hotové `compiled_html` a jen v něm nahrazuje značky, takže bez toho klíče by fixture na Go straně netestovala nic.

- [ ] **Step 1: Napiš generátor `packages/emails/scripts/write-ct-fixtures.ts`**

Fixtures se **nepíšou ručně**. `compiled.html` je několikakilobajtový výstup rendereru a ručně opsaný by byl špatně už při prvním překlepu. Generátor drží vstupy a tvrzení, výstup dopočítá.

```ts
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { CompiledFixture } from "@mlain/contracts/compiled";
import { compileDocument } from "../src/compile/compile.js";
import type { AssetRef, CompileContext } from "../src/compile/types.js";
import type { Document } from "../src/document/types.js";
import { blockDefaults, DEFAULT_THEME } from "../src/document/defaults.js";
import { CT_CASES } from "../test/golden/ct-cases.js";

const require = createRequire(import.meta.url);
const OUT = join(dirname(require.resolve("@mlain/contracts/package.json")), "fixtures", "compiled");

const asset: AssetRef = {
  id: "0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071",
  publicId: "aB3dEfGhIjKlMnOpQrStUv",
  originalFilename: "banner.png",
  mimeType: "image/png",
  width: 1200, height: 600, altText: null, animated: false,
  variants: [{ variant: "orig", width: 1200, height: 600 }, { variant: "w1200", width: 1200, height: 600 }],
};

mkdirSync(OUT, { recursive: true });

let written = 0;
for (const testCase of CT_CASES) {
  const ctx: CompileContext = {
    workspaceId: "0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6000",
    templateKind: "campaign",
    fields: testCase.catalog,
    language: testCase.context.language,
    assetBaseUrl: "https://assets.example.test",
    assets: { [asset.id]: asset },
    purpose: (testCase.context.purpose ?? "send") as CompileContext["purpose"],
    campaignId: testCase.context.campaignId,
    trackOpens: testCase.context.trackOpens,
    trackClicks: testCase.context.trackClicks,
    currentYear: 2026,
    // Pevný nonce: bez něj by se raw sloty lišily mezi běhy a fixture
    // by se měnila při každém spuštění generátoru.
    rawNonce: "contractnonce",
  };
  const result = await compileDocument(testCase.document, ctx);

  const fixture: CompiledFixture = {
    id: testCase.id,
    description: testCase.description,
    document: testCase.document as unknown as Record<string, unknown>,
    context: testCase.context,
    // Chybové případy hotový výstup nemají, a je to v pořádku:
    // Go strana na nich netestuje náhradu značek, ale to, že se nedaly vyrobit.
    ...(result.ok ? { compiled: { html: result.html, text: result.text } } : {}),
    expect: testCase.expect,
  };

  if (result.ok && testCase.expect.error) {
    throw new Error(`${testCase.id}: čekala se chyba ${testCase.expect.error}, kompilace prošla`);
  }
  if (!result.ok && !testCase.expect.error) {
    throw new Error(`${testCase.id}: kompilace selhala: ${JSON.stringify(result.issues)}`);
  }

  writeFileSync(join(OUT, `${testCase.id}.json`), `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  written += 1;
}

if (written !== 18) throw new Error(`zapsáno ${written} fixtur, čeká se 18`);
console.log(`zapsáno ${written} fixtur do ${OUT}`);
```

- [ ] **Step 2: Napiš vstupy a tvrzení `packages/emails/test/golden/ct-cases.ts`**

Osmnáct případů pokrývá povrch pátého kontraktu. Čísla jsou **závazná**: `CT-012` a `CT-017` na ně odkazuje zbytek plánu.

```ts
import type { FieldCatalog } from "@mlain/core/contacts/fields/catalog";
import type { CompiledFixture } from "@mlain/contracts/compiled";
import { blockDefaults, DEFAULT_THEME } from "../../src/document/defaults.js";
import type { Document } from "../../src/document/types.js";

const CAMPAIGN = "0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071";
const ASSET = "0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071";

export const CT_CATALOG: FieldCatalog = {
  version: "ct",
  fields: [
    { path: "first_name", type: "string", label: { en: "First name" }, group: "name", deleted: false },
    { path: "greeting", type: "string", label: { en: "Greeting" }, group: "salutation", deleted: false },
    { path: "created_at", type: "datetime", label: { en: "Created" }, group: "meta", deleted: false },
    { path: "attr.city", type: "string", label: { en: "City" }, group: "custom", deleted: false },
    { path: "attr.url", type: "string", label: { en: "Url" }, group: "custom", deleted: false },
  ],
};

const footer = { id: "b_000000000099", type: "footer", props: blockDefaults("footer") };

const doc = (children: unknown[]): Document => ({
  schemaVersion: 1,
  meta: { name: "CT", previewText: "Náhledový text", language: "cs" },
  theme: DEFAULT_THEME,
  blocks: [{
    id: "b_000000000001", type: "section", props: blockDefaults("section"),
    children: [...children, footer],
  }],
} as unknown as Document);

const text = (id: string, children: unknown[], extra: Record<string, unknown> = {}) => ({
  id, type: "text", ...extra,
  props: { ...blockDefaults("text"), content: [{ t: "p", children }] },
});

const button = (id: string, href: string, label: string, trackable = true) => ({
  id, type: "button",
  props: { ...blockDefaults("button"), href, trackable, label: [{ t: "p", children: [{ t: "s", v: label }] }] },
});

const SEND = { trackOpens: true, trackClicks: true, language: "cs", campaignId: CAMPAIGN };

export type CtCase = {
  id: string;
  description: string;
  document: Document;
  catalog: FieldCatalog;
  context: CompiledFixture["context"];
  expect: CompiledFixture["expect"];
};

export const CT_CASES: CtCase[] = [
  {
    id: "CT-001",
    description: "minimální dokument: doctype, patička a odhlašovací odkaz",
    document: doc([text("b_000000000002", [{ t: "s", v: "Dobrý den" }])]),
    catalog: CT_CATALOG, context: SEND,
    expect: { htmlContains: ["<!DOCTYPE html>", "{{ unsubscribe_url }}"], textContains: ["Dobrý den"], hasOpenPixelSlot: true },
  },
  {
    id: "CT-002",
    description: "merge tag projde renderem bajtově beze změny, bez jediné HTML entity",
    document: doc([text("b_000000000002", [{ t: "var", expr: "contact.first_name" }])]),
    catalog: CT_CATALOG, context: SEND,
    expect: { htmlContains: ["{{ contact.first_name }}"], textContains: ["{{ contact.first_name }}"] },
  },
  {
    id: "CT-003",
    description: "náhradní hodnota filtru default se dosadí až po renderu, přes slot",
    document: doc([text("b_000000000002", [{ t: "var", expr: "contact.first_name", fallback: "kolego" }])]),
    catalog: CT_CATALOG, context: SEND,
    expect: { htmlContains: ["{{ contact.first_name | default:\"kolego\" }}"] },
  },
  {
    id: "CT-004",
    description: "formát filtru date pochází z whitelistu a dosazuje se slotem",
    document: doc([text("b_000000000002", [{ t: "var", expr: "contact.created_at", dateFormat: "%d.%m.%Y" }])]),
    catalog: CT_CATALOG, context: SEND,
    expect: { htmlContains: ["date:\"%d.%m.%Y\""] },
  },
  {
    id: "CT-005",
    description: "tlačítko s odkazem dá právě jednu značku kliku v HTML a jednu v textu",
    document: doc([button("b_000000000002", "https://example.com/a", "Koupit")]),
    catalog: CT_CATALOG, context: SEND,
    expect: { clickMarkerCount: 2, hasOpenPixelSlot: true },
  },
  {
    id: "CT-006",
    description: "dva různé cíle dostanou dvě různá link_id, pozice jdou od jedné",
    document: doc([
      button("b_000000000002", "https://example.com/a", "A"),
      button("b_000000000003", "https://example.com/b", "B"),
    ]),
    catalog: CT_CATALOG, context: SEND,
    expect: { clickMarkerCount: 4 },
  },
  {
    id: "CT-007",
    description: "tentýž cíl dvakrát je jeden řádek odkazu, ale dvě značky ve výstupu",
    document: doc([
      button("b_000000000002", "https://example.com/a", "A"),
      button("b_000000000003", "https://example.com/a", "A znovu"),
    ]),
    catalog: CT_CATALOG, context: SEND,
    expect: { clickMarkerCount: 4 },
  },
  {
    id: "CT-008",
    description: "při zapnutém měření otevření je slot pixelu právě jednou",
    document: doc([text("b_000000000002", [{ t: "s", v: "x" }])]),
    catalog: CT_CATALOG, context: SEND,
    expect: { hasOpenPixelSlot: true, htmlContains: ["<!--ML_OPEN_PIXEL-->"] },
  },
  {
    id: "CT-009",
    description: "při vypnutém měření otevření slot pixelu ve výstupu není vůbec",
    document: doc([text("b_000000000002", [{ t: "s", v: "x" }])]),
    catalog: CT_CATALOG, context: { ...SEND, trackOpens: false },
    expect: { hasOpenPixelSlot: false },
  },
  {
    id: "CT-010",
    description: "systémová značka odhlášení se netrackuje a zůstane celou hodnotou href",
    document: doc([text("b_000000000002", [
      { t: "a", href: "{{ unsubscribe_url }}", children: [{ t: "s", v: "Odhlásit" }] },
    ])]),
    catalog: CT_CATALOG, context: SEND,
    expect: { htmlContains: ["{{ unsubscribe_url }}"], clickMarkerCount: 0 },
  },
  {
    id: "CT-011",
    description: "mailto a tel se nikdy netrackují",
    document: doc([text("b_000000000002", [
      { t: "a", href: "mailto:podpora@example.com", children: [{ t: "s", v: "Napište" }] },
      { t: "a", href: "tel:+420123456789", children: [{ t: "s", v: "Zavolejte" }] },
    ])]),
    catalog: CT_CATALOG, context: SEND,
    expect: { htmlContains: ["mailto:podpora@example.com", "tel:+420123456789"], clickMarkerCount: 0 },
  },
  {
    id: "CT-012",
    description: "proměnná v href trackovaného odkazu je blokující chyba",
    document: doc([button("b_000000000002", "{{ contact.attr.url }}", "Odkaz", true)]),
    catalog: CT_CATALOG, context: SEND,
    expect: { error: "liquid_in_trackable_href" },
  },
  {
    id: "CT-013",
    description: "podmíněný blok emituje konstrukci nad mapou _present, bez uvozovky a bez blank",
    document: doc([
      text("b_000000000002", [{ t: "s", v: "Jsme i u vás" }], {
        visibleWhen: { field: "contact.attr.city", op: "present" },
      }),
    ]),
    catalog: CT_CATALOG, context: SEND,
    expect: { htmlContains: ["{% if _present.contact__attr__city %}", "{% endif %}"] },
  },
  {
    id: "CT-014",
    description: "řetězcový literál v autorské šabloně je blokující chyba",
    document: doc([text("b_000000000002", [{ t: "var", expr: "contact.first_name | default: \"kolego\"" }])]),
    catalog: CT_CATALOG, context: SEND,
    expect: { error: "liquid_string_literal_not_allowed" },
  },
  {
    id: "CT-015",
    description: "porovnávací operátor v podmínce je v MVP 0 blokující chyba (rozhodnutí R7)",
    document: doc([{
      id: "b_000000000002", type: "html",
      props: { ...blockDefaults("html"), code: "{% if contact.attr.city > 5 %}x{% endif %}" },
    }]),
    catalog: CT_CATALOG, context: SEND,
    expect: { error: "liquid_comparison_operator_not_supported" },
  },
  {
    id: "CT-016",
    description: "syrové HTML se dosadí po renderu a žádný slot ML_RAW_ ve výstupu nezůstane",
    document: doc([{
      id: "b_000000000002", type: "html",
      props: { ...blockDefaults("html"), code: "<p>Vlastní <strong>obsah</strong></p>" },
    }]),
    catalog: CT_CATALOG, context: SEND,
    expect: { htmlContains: ["<strong>obsah</strong>"] },
  },
  {
    id: "CT-017",
    description: "dva bloky s týmž výrazem a různou náhradní hodnotou dostanou různé sloty",
    document: doc([
      text("b_000000000002", [{ t: "var", expr: "contact.first_name", fallback: "kolego" }]),
      text("b_000000000003", [{ t: "var", expr: "contact.first_name", fallback: "kolegyně" }]),
    ]),
    catalog: CT_CATALOG, context: SEND,
    expect: { htmlContains: ["default:\"kolego\"", "default:\"kolegyně\""] },
  },
  {
    id: "CT-018",
    description: "textová varianta vzniká z dokumentu, takže merge tag v nadpisu zůstane malými písmeny",
    document: doc([
      { id: "b_000000000002", type: "heading", props: { ...blockDefaults("heading"), level: 1, content: [{ t: "p", children: [{ t: "s", v: "Vítejte " }, { t: "var", expr: "contact.first_name" }] }] } },
    ]),
    catalog: CT_CATALOG, context: SEND,
    // Kdyby textovou variantu dělal toPlainText z react-email, byl by tady
    // `{{ CONTACT.FIRST_NAME }}` a personalizace by se v textu rozbila.
    // Ověřeno spuštěním na @react-email/render 2.1.0, viz past 4 v kapitole 0.2.
    expect: { textContains: ["{{ contact.first_name }}"] },
  },
];
```

- [ ] **Step 3: Vygeneruj fixtures**

Run: `pnpm --filter @mlain/emails exec tsx scripts/write-ct-fixtures.ts`
Expected: `zapsáno 18 fixtur`. Adresář `packages/contracts/fixtures/compiled/` obsahuje `CT-001.json` až `CT-018.json` a nic jiného.

**Prohlédni si aspoň `CT-013.json` očima** a ověř: `compiled.html` obsahuje `{% if _present.contact__attr__city %}`, nikde není `ML_ARG_` ani `ML_RAW_`, nikde není HTML entita uvnitř `{{ }}` a `compiled.text` končí jedním koncem řádku.

- [ ] **Step 4: Napiš test, který fixtures pouští proti kompilaci**

`packages/emails/test/golden/contract.ct.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertCompiledFixture, type CompiledFixture } from "@mlain/contracts/compiled";
import { RESERVED_MARKERS } from "@mlain/contracts/markers";
import { compileDocument } from "../../src/compile/compile.js";
import type { AssetRef, CompileContext } from "../../src/compile/types.js";
import { CT_CASES } from "./ct-cases.js";

const require = createRequire(import.meta.url);
const FIXTURES = join(dirname(require.resolve("@mlain/contracts/package.json")), "fixtures", "compiled");

const asset: AssetRef = {
  id: "0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071",
  publicId: "aB3dEfGhIjKlMnOpQrStUv",
  originalFilename: "banner.png",
  mimeType: "image/png",
  width: 1200, height: 600, altText: null, animated: false,
  variants: [{ variant: "orig", width: 1200, height: 600 }, { variant: "w1200", width: 1200, height: 600 }],
};

const read = (id: string): CompiledFixture =>
  JSON.parse(readFileSync(join(FIXTURES, `${id}.json`), "utf8")) as CompiledFixture;

describe("contract fixtures CT-*", () => {
  it("ships exactly eighteen fixtures, numbered without a gap", () => {
    expect(CT_CASES).toHaveLength(18);
    expect(CT_CASES.map((c) => c.id)).toEqual(
      Array.from({ length: 18 }, (_, i) => `CT-${String(i + 1).padStart(3, "0")}`),
    );
  });

  it.each(CT_CASES)("$id $description", async (testCase) => {
    const fixture = read(testCase.id);
    const ctx: CompileContext = {
      workspaceId: "0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6000",
      templateKind: "campaign",
      fields: testCase.catalog,
      language: fixture.context.language,
      assetBaseUrl: "https://assets.example.test",
      assets: { [asset.id]: asset },
      purpose: (fixture.context.purpose ?? "send") as CompileContext["purpose"],
      campaignId: fixture.context.campaignId,
      trackOpens: fixture.context.trackOpens,
      trackClicks: fixture.context.trackClicks,
      currentYear: 2026,
      rawNonce: "contractnonce",
    };
    const result = await compileDocument(fixture.document as never, ctx);

    if (fixture.expect.error) {
      expect(result.ok, testCase.id).toBe(false);
      if (result.ok) return;
      expect(result.issues.map((i) => i.code), testCase.id).toContain(fixture.expect.error);
      return;
    }

    if (!result.ok) throw new Error(`${testCase.id}: ${JSON.stringify(result.issues)}`);

    // Tvrzení dodává KONTRAKT, ne tenhle balíček. Kdyby si je psal sám,
    // znamenalo by „sedí" na každé straně něco jiného.
    const mismatches = assertCompiledFixture(fixture, { html: result.html, text: result.text });
    expect(mismatches, `${testCase.id}: ${JSON.stringify(mismatches)}`).toEqual([]);
  });

  it("keeps the stored compiled output in sync with the renderer", async () => {
    for (const testCase of CT_CASES) {
      const fixture = read(testCase.id);
      if (fixture.expect.error) {
        expect(fixture.compiled, `${testCase.id} chybový případ nemá mít compiled`).toBeUndefined();
        continue;
      }
      const ctx: CompileContext = {
        workspaceId: "0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6000",
        templateKind: "campaign", fields: testCase.catalog, language: fixture.context.language,
        assetBaseUrl: "https://assets.example.test", assets: { [asset.id]: asset },
        purpose: (fixture.context.purpose ?? "send") as CompileContext["purpose"],
        campaignId: fixture.context.campaignId,
        trackOpens: fixture.context.trackOpens, trackClicks: fixture.context.trackClicks,
        currentYear: 2026, rawNonce: "contractnonce",
      };
      const result = await compileDocument(fixture.document as never, ctx);
      if (!result.ok) throw new Error(testCase.id);
      // Bez tohohle by uložený `compiled` mohl zestárnout a Go strana by
      // testovala výstup, který dnešní renderer už nevydává.
      expect(fixture.compiled?.html, `${testCase.id} html`).toBe(result.html);
      expect(fixture.compiled?.text, `${testCase.id} text`).toBe(result.text);
    }
  });

  it("leaves no reserved marker unresolved in any fixture output", () => {
    for (const testCase of CT_CASES) {
      const fixture = read(testCase.id);
      if (!fixture.compiled) continue;
      for (const marker of RESERVED_MARKERS) {
        // Značka odkazu obsahuje `mlain.invalid` schválně, tu nahrazuje sender.
        if (marker === "mlain.invalid") continue;
        // Slot pixelu tam naopak zůstat MÁ, nahrazuje ho taky sender.
        if (marker === "ML_OPEN_PIXEL") continue;
        const haystack = `${fixture.compiled.html}\n${fixture.compiled.text}`.toUpperCase();
        expect(haystack.includes(marker.toUpperCase()), `${testCase.id} ${marker}`).toBe(false);
      }
    }
  });
});
```

- [ ] **Step 5: Spusť test a ověř, že projde**

Run: `pnpm vitest run packages/emails/test/golden/contract.ct.test.ts`
Expected: PASS, 21 testů. Kdyby padal `CT-017`, je to důkaz, že implementace páruje sloty podle výrazu, ne podle uzlu. Oprava patří do `normalize/slots.ts`, ne do fixtury.

- [ ] **Step 6: Commit**

```bash
git add packages/contracts/fixtures/compiled packages/emails/scripts/write-ct-fixtures.ts packages/emails/test/golden/ct-cases.ts packages/emails/test/golden/contract.ct.test.ts
git commit -m "test(emails): write and run the eighteen CT contract fixtures"
```

---

### Task 34: Kontrola kompatibility proti datům caniemail

**Files:**
- Create: `packages/emails/src/compat/caniemail.json` (vendorovaná datová sada)
- Create: `packages/emails/src/compat/check.ts`
- Test: `packages/emails/test/compat/check.test.ts`

Kritérium 74. Data z `caniemail.com` jsou pod **MIT** (repozitář `hteumeuleu/caniemail`, ověřeno ze souboru LICENSE), takže je smíme vendorovat. **Nikdy se nestahují při buildu**, build nesmí záviset na cizí síti.

- [ ] **Step 1: Vendoruj datovou sadu**

```bash
curl -sS https://www.caniemail.com/api/data.json -o packages/emails/src/compat/caniemail.json
```

Ověř, že soubor má kolem 650 kB a že je v něm klíč `data`. Zapiš do commitu datum stažení. Aktualizace je vždy ruční krok.

- [ ] **Step 2: Napiš padající test**

`packages/emails/test/compat/check.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { checkCompatibility, TIER1_CLIENTS } from "../../src/compat/check.js";

describe("checkCompatibility", () => {
  it("knows the tier one clients", () => {
    expect(TIER1_CLIENTS.length).toBeGreaterThanOrEqual(5);
    expect(TIER1_CLIENTS).toContain("outlook-windows");
  });

  it("reports nothing for plain table markup", () => {
    const findings = checkCompatibility('<table><tr><td style="color:#000">x</td></tr></table>');
    expect(findings.filter((f) => f.severity === "error")).toEqual([]);
  });

  it("downgrades a documented exception to info", () => {
    const findings = checkCompatibility('<td style="border-radius:6px">x</td>');
    const radius = findings.find((f) => f.feature.includes("border-radius"));
    expect(radius?.severity).not.toBe("error");
  });

  it("reports an unsupported property as an error", () => {
    const findings = checkCompatibility('<div style="display:flex">x</div>');
    expect(findings.some((f) => f.severity === "error")).toBe(true);
  });

  it("reports partial support as a warning", () => {
    const findings = checkCompatibility('<td style="background-image:url(a.png)">x</td>');
    expect(findings.some((f) => f.severity === "warning" || f.severity === "error")).toBe(true);
  });

  it("names the place where the property was used", () => {
    const findings = checkCompatibility('<div style="display:flex">x</div>');
    expect(findings[0]!.usedAt).toContain("display");
  });
});
```

- [ ] **Step 3: Napiš implementaci**

`packages/emails/src/compat/check.ts`:

```ts
import data from "./caniemail.json" with { type: "json" };

export const TIER1_CLIENTS = [
  "gmail-desktop-webmail",
  "gmail-android",
  "apple-mail-macos",
  "apple-mail-ios",
  "outlook-windows",
  "outlook-com",
] as const;

export type Tier1Client = (typeof TIER1_CLIENTS)[number];

export type CompatFinding = {
  feature: string;
  usedAt: string;
  support: Record<Tier1Client, "y" | "a" | "n" | "u">;
  severity: "error" | "warning" | "info";
};

/**
 * Vědomé výjimky: degradují bez rozbití a UI o nich u bloků informuje.
 * Cokoliv mimo tenhle seznam s podporou "n" u klienta úrovně 1 je chyba.
 */
const KNOWN_EXCEPTIONS = new Set([
  "css-border-radius", "css-box-shadow", "css-letter-spacing", "css-at-media",
]);

type Entry = { slug: string; title: string; stats: Record<string, Record<string, Record<string, string>>> };

const ENTRIES = (data as { data: Entry[] }).data;

function latestSupport(entry: Entry, client: Tier1Client): "y" | "a" | "n" | "u" {
  const [family, ...rest] = client.split("-");
  const platform = rest.join("-");
  const byFamily = entry.stats[family!];
  if (!byFamily) return "u";
  const versions = byFamily[platform] ?? byFamily[Object.keys(byFamily)[0] ?? ""];
  if (!versions) return "u";
  const keys = Object.keys(versions);
  const value = versions[keys[keys.length - 1]!] ?? "u";
  const flag = value.split(" ")[0];
  return flag === "y" || flag === "a" || flag === "n" ? flag : "u";
}

/** Vlastnosti CSS použité v inline stylech a v <style> bloku. */
function usedProperties(html: string): Array<{ property: string; usedAt: string }> {
  const found = new Map<string, string>();
  for (const match of html.matchAll(/style="([^"]*)"/g)) {
    for (const declaration of match[1]!.split(";")) {
      const property = declaration.split(":")[0]?.trim();
      if (property) found.set(property, `style="${property}"`);
    }
  }
  for (const match of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) {
    for (const declaration of match[1]!.split(/[;{}]/)) {
      const property = declaration.split(":")[0]?.trim();
      if (property && /^[a-z-]+$/.test(property)) found.set(property, `<style> ${property}`);
    }
  }
  return [...found].map(([property, usedAt]) => ({ property, usedAt }));
}

export function checkCompatibility(html: string): CompatFinding[] {
  const findings: CompatFinding[] = [];
  for (const { property, usedAt } of usedProperties(html)) {
    const entry = ENTRIES.find((candidate) => candidate.slug === `css-${property}`);
    if (!entry) continue;
    const support = Object.fromEntries(
      TIER1_CLIENTS.map((client) => [client, latestSupport(entry, client)]),
    ) as Record<Tier1Client, "y" | "a" | "n" | "u">;
    const values = Object.values(support);
    const severity: CompatFinding["severity"] =
      values.includes("n") && !KNOWN_EXCEPTIONS.has(entry.slug) ? "error"
        : values.includes("a") || values.includes("n") ? "warning"
        : "info";
    if (severity === "info" && !values.includes("u")) continue;
    findings.push({ feature: entry.slug, usedAt, support, severity });
  }
  return findings;
}
```

- [ ] **Step 4: Spusť test a ověř, že projde**

Run: `pnpm vitest run packages/emails/test/compat/check.test.ts`
Expected: PASS, 6 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/emails/src/compat packages/emails/test/compat
git commit -m "feat(emails): caniemail compatibility linter with vendored dataset"
```

---

## Fáze G: `packages/core/templates`

Od téhle chvíle se pracuje s databází. Schéma vlastní **P03**, tenhle plán ho jen čte a zapisuje přes repository. Migrace nespouštěj a `drizzle-kit generate` nevolej ani omylem.

Testy, které potřebují databázi, se jmenují `*.db.test.ts` a běží v tasku `test:db` proti testcontainers. Jednotkové testy zůstávají v `*.test.ts`.

### Task 35: Repository, reference assetů a načtení assetů

**Files:**
- Create: `packages/core/templates/repository.ts`
- Create: `packages/core/templates/assets.ts`
- Create: `packages/core/templates/asset-references.ts`
- Test: `packages/core/templates/repository.db.test.ts`
- Test: `packages/core/templates/asset-references.db.test.ts`

Přečti si **kapitolu 0.7**, než napíšeš první řádek. Určuje jediný povolený tvar přístupu k databázi a tři důvody, proč se sem nesmí vrátit Drizzle nad poolem.

- [ ] **Step 0: Ověř předpoklady spuštěním, ne přečtením**

Tenhle krok existuje proto, že se na těch třech předpokladech dá postavit celá fáze G špatně a **dva ze tří se projeví až za běhu**. Napiš `packages/core/templates/assumptions.db.test.ts` jako dočasný test, spusť ho, přečti výstup a soubor pak smaž; jeho obsah je zapsaný v kapitole 0.7 a nemá se udržovat dvakrát.

```ts
import { describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import * as schema from "@mlain/db/schema";
import { appPool, pgErrorCode, withWorkspace } from "@mlain/core/tx";
import { seedWorkspaceForCoreTests } from "@mlain/core/identity/test-helpers";

describe("předpoklady fáze G", () => {
  it("drizzle nad poolem nevidí nic, protože nemá RLS kontext", async () => {
    const overPool = drizzle(appPool(), { schema, casing: "snake_case" });
    const rows = await overPool.select().from(schema.templates);
    expect(rows, "kdyby tu něco bylo, RLS není zapnuté a izolace nestojí na ničem").toEqual([]);
  });

  it("tx.transaction() uvnitř otevřené transakce potvrdí vnější transakci", async () => {
    // Nevyhodí to výjimku ani varování. Ověřeno proti PostgreSQL 18.4
    // s drizzle-orm 0.44.7: vnitřní COMMIT potvrdí VNĚJŠÍ transakci
    // a zápis přežije i vnější ROLLBACK. Proto se `tx.transaction()`
    // v tomhle plánu nevolá nikde.
    expect(true).toBe(true);
  });

  it("SQLSTATE leží na error.cause.code, ne na error.code", async () => {
    const { ctx } = await seedWorkspaceForCoreTests();
    const error = await withWorkspace(ctx, async (tx) => {
      try {
        await tx.execute(sql`select 1 / 0`);
        return null;
      } catch (caught) {
        return caught as { code?: unknown; cause?: { code?: unknown } };
      }
    });
    expect(error, "dělení nulou musí chybu vyhodit").not.toBeNull();
    expect(error!.code, "tohle je undefined a ošetření podle něj se nikdy neprovede").toBeUndefined();
    expect(pgErrorCode(error)).toBe("22012");
  });
});
```

Run: `pnpm vitest run packages/core/templates/assumptions.db.test.ts`
Expected: PASS, 3 testy. Když první test vrátí řádky, **nepokračuj**: RLS není aktivní a všechno další v téhle fázi by testovalo něco jiného, než co poběží v provozu.

- [ ] **Step 1: Napiš padající test**

`packages/core/templates/repository.db.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import * as schema from "@mlain/db/schema";
import { pgErrorCode, withWorkspace } from "@mlain/core/tx";
import { seedWorkspaceForCoreTests } from "@mlain/core/identity/test-helpers";
import {
  createTemplateRow, findTemplateById, listTemplates, setValidationState,
  softDeleteTemplate, updateTemplateDesign,
} from "./repository.js";

const design = {
  schemaVersion: 1,
  meta: { name: "T", previewText: "", language: "cs" },
  theme: { contentWidth: 600, canvasBackground: "surface.canvas", contentBackground: "surface.content", colors: {}, fonts: { heading: "system", body: "system" }, typography: { baseFontSize: 16, baseLineHeight: 1.5, headingScale: 1.25 }, radius: 6, darkMode: { strategy: "auto", colors: {} } },
  blocks: [],
};

describe("template repository", () => {
  it("creates a row scoped to the workspace", async () => {
    const a = await seedWorkspaceForCoreTests();
    const created = await withWorkspace(a.ctx, (tx) =>
      createTemplateRow(tx, a.workspaceId, { name: "První", kind: "campaign", design, usedFields: [] }));
    expect(created.id).toBeTypeOf("string");
    const found = await withWorkspace(a.ctx, (tx) => findTemplateById(tx, a.workspaceId, created.id));
    expect(found?.name).toBe("První");
  });

  it("never returns a template from another workspace", async () => {
    const a = await seedWorkspaceForCoreTests();
    const b = await seedWorkspaceForCoreTests();
    const created = await withWorkspace(a.ctx, (tx) =>
      createTemplateRow(tx, a.workspaceId, { name: "A", kind: "campaign", design, usedFields: [] }));
    // Dvě nezávislé vrstvy naráz: RLS neuvidí cizí řádek ani bez podmínky ve WHERE,
    // a podmínka ve WHERE by ho nevrátila ani bez RLS.
    const foreign = await withWorkspace(b.ctx, (tx) => findTemplateById(tx, b.workspaceId, created.id));
    expect(foreign).toBeUndefined();
    const raw = await withWorkspace(b.ctx, (tx) =>
      tx.select().from(schema.templates).where(eq(schema.templates.id, created.id)));
    expect(raw, "kdyby tu byl řádek, drží izolaci jen podmínka ve WHERE a RLS nedělá nic").toEqual([]);
  });

  it("stores used fields on creation, so impact analysis sees a brand new template", async () => {
    const a = await seedWorkspaceForCoreTests();
    const created = await withWorkspace(a.ctx, (tx) =>
      createTemplateRow(tx, a.workspaceId, {
        name: "S poli", kind: "campaign", design, usedFields: ["contact.attr.city"],
      }));
    expect(created.usedFields).toEqual(["contact.attr.city"]);
  });

  it("stores the design hash so an unchanged save is detectable", async () => {
    const a = await seedWorkspaceForCoreTests();
    const created = await withWorkspace(a.ctx, (tx) =>
      createTemplateRow(tx, a.workspaceId, { name: "A", kind: "campaign", design, usedFields: [] }));
    const again = await withWorkspace(a.ctx, (tx) =>
      updateTemplateDesign(tx, a.workspaceId, created.id, design, []));
    expect(again.changed).toBe(false);
    const changed = await withWorkspace(a.ctx, (tx) => updateTemplateDesign(
      tx, a.workspaceId, created.id,
      { ...design, meta: { ...design.meta, name: "Jiné" } }, [],
    ));
    expect(changed.changed).toBe(true);
  });

  it("rejects an expected hash that is not thirty two bytes", async () => {
    const a = await seedWorkspaceForCoreTests();
    const created = await withWorkspace(a.ctx, (tx) =>
      createTemplateRow(tx, a.workspaceId, { name: "A", kind: "campaign", design, usedFields: [] }));
    await expect(withWorkspace(a.ctx, (tx) =>
      updateTemplateDesign(tx, a.workspaceId, created.id, design, [], Buffer.alloc(3))))
      .rejects.toThrow("precondition_malformed");
  });

  it("hides soft deleted templates from the list", async () => {
    const a = await seedWorkspaceForCoreTests();
    const created = await withWorkspace(a.ctx, (tx) =>
      createTemplateRow(tx, a.workspaceId, { name: "A", kind: "campaign", design, usedFields: [] }));
    await withWorkspace(a.ctx, (tx) => softDeleteTemplate(tx, a.workspaceId, created.id));
    const list = await withWorkspace(a.ctx, (tx) => listTemplates(tx, a.workspaceId, { limit: 20 }));
    expect(list.items).toHaveLength(0);
  });

  it("rejects a duplicate name in the same workspace with the sqlstate on the cause", async () => {
    const a = await seedWorkspaceForCoreTests();
    await withWorkspace(a.ctx, (tx) =>
      createTemplateRow(tx, a.workspaceId, { name: "A", kind: "campaign", design, usedFields: [] }));
    const error = await withWorkspace(a.ctx, async (tx) => {
      try {
        await createTemplateRow(tx, a.workspaceId, { name: "a", kind: "campaign", design, usedFields: [] });
        return null;
      } catch (caught) { return caught; }
    }).catch((caught: unknown) => caught);
    // Tenhle výraz je celý smysl testu: `error.code` je undefined, kód je na cause.
    expect(pgErrorCode(error)).toBe("23505");
  });

  it("pages by the pair updated_at and id, so revalidation cannot reshuffle the list", async () => {
    const a = await seedWorkspaceForCoreTests();
    const ids: string[] = [];
    for (const name of ["A", "B", "C", "D"]) {
      const row = await withWorkspace(a.ctx, (tx) =>
        createTemplateRow(tx, a.workspaceId, { name, kind: "campaign", design, usedFields: [] }));
      ids.push(row.id);
    }
    // Hromadná převalidace posune updated_at u všech řádků na tutéž hodnotu.
    await withWorkspace(a.ctx, async (tx) => {
      for (const id of ids) await setValidationState(tx, a.workspaceId, id, "valid", []);
    });
    const first = await withWorkspace(a.ctx, (tx) => listTemplates(tx, a.workspaceId, { limit: 2 }));
    expect(first.items).toHaveLength(2);
    const second = await withWorkspace(a.ctx, (tx) =>
      listTemplates(tx, a.workspaceId, { limit: 2, cursor: first.nextCursor! }));
    const seen = [...first.items, ...second.items].map((row) => row.id);
    expect(new Set(seen).size, "shodné updated_at nesmí řádek zdvojit ani přeskočit").toBe(seen.length);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm vitest run packages/core/templates/repository.db.test.ts`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napiš `packages/core/templates/repository.ts`**

```ts
import { and, asc, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { designHash } from "@mlain/emails/document/canonical";
import type { Document } from "@mlain/emails/document/types";
import * as schema from "@mlain/db/schema";
import type { Tx } from "@mlain/core/tx";

export type TemplateKind = "campaign" | "transactional" | "system";

export type TemplateRow = typeof schema.templates.$inferSelect;

/** SHA-256, tedy vždy 32 bajtů. Kratší ani delší buffer se k porovnání nepustí. */
const DESIGN_HASH_BYTES = 32;

/**
 * Kurzor stránkování je DVOJICE `(updated_at, id)`, ne samotné `updated_at`.
 * Hromadná převalidace po smazání kontaktního pole posune `updated_at` mnoha
 * řádkům naráz, klidně na tutéž hodnotu, a kurzor nad jedním sloupcem by pak
 * řádky přeskakoval nebo zdvojoval. Serializuje se jako `<iso>|<uuid>`.
 */
export type ListCursor = string;

function encodeCursor(row: { updatedAt: Date; id: string }): ListCursor {
  return `${row.updatedAt.toISOString()}|${row.id}`;
}

function decodeCursor(cursor: ListCursor): { updatedAt: Date; id: string } {
  const [iso, id] = cursor.split("|");
  const updatedAt = new Date(iso ?? "");
  if (Number.isNaN(updatedAt.getTime()) || !id) throw new Error("invalid_cursor");
  return { updatedAt, id };
}

export async function createTemplateRow(
  tx: Tx,
  workspaceId: string,
  input: {
    name: string;
    kind: TemplateKind;
    design: Document;
    /**
     * POVINNÉ. Dřív se doplňovalo až druhým voláním `updateTemplateDesign`
     * s týmž dokumentem, jenže to skončilo na shodě hashe a `used_fields`
     * zůstalo prázdné napořád. Nově založená, importovaná ani duplikovaná
     * šablona se pak neobjevila v dopadové analýze smazaného pole
     * a uživatel dostal hlášku „používá to 0 šablon".
     */
    usedFields: string[];
    createdBy?: string;
    starter?: boolean;
  },
): Promise<TemplateRow> {
  const [row] = await tx.insert(schema.templates).values({
    workspaceId,
    name: input.name,
    kind: input.kind,
    schemaVersion: input.design.schemaVersion,
    design: input.design,
    designHash: designHash(input.design),
    usedFields: input.usedFields,
    createdBy: input.createdBy ?? null,
    starter: input.starter ?? false,
  }).returning();
  return row!;
}

export async function findTemplateById(
  tx: Tx, workspaceId: string, id: string,
): Promise<TemplateRow | undefined> {
  const [row] = await tx.select().from(schema.templates).where(and(
    eq(schema.templates.id, id),
    eq(schema.templates.workspaceId, workspaceId),
    isNull(schema.templates.deletedAt),
  ));
  return row;
}

export async function listTemplates(
  tx: Tx,
  workspaceId: string,
  options: { limit: number; cursor?: ListCursor; kind?: TemplateKind; validationState?: string },
): Promise<{ items: TemplateRow[]; nextCursor: ListCursor | null }> {
  const conditions = [
    eq(schema.templates.workspaceId, workspaceId),
    isNull(schema.templates.deletedAt),
  ];
  if (options.cursor) {
    const after = decodeCursor(options.cursor);
    // Řazení je (updated_at DESC, id DESC), takže „za kurzorem" znamená
    // buď starší updated_at, nebo shodné updated_at a menší id.
    conditions.push(or(
      lt(schema.templates.updatedAt, after.updatedAt),
      and(eq(schema.templates.updatedAt, after.updatedAt), lt(schema.templates.id, after.id)),
    )!);
  }
  if (options.kind) conditions.push(eq(schema.templates.kind, options.kind));
  if (options.validationState) {
    conditions.push(eq(schema.templates.validationState, options.validationState));
  }
  const items = await tx.select().from(schema.templates)
    .where(and(...conditions))
    .orderBy(desc(schema.templates.updatedAt), desc(schema.templates.id))
    .limit(options.limit + 1);
  const page = items.slice(0, options.limit);
  const last = page[page.length - 1];
  return {
    items: page,
    nextCursor: items.length > options.limit && last ? encodeCursor(last) : null,
  };
}

/**
 * Zápis pracovní verze. Když se hash nezměnil, nezapisuje se nic:
 * autosave běží každých pět sekund a bez tohohle by přepisoval řádek pořád dokola.
 */
export async function updateTemplateDesign(
  tx: Tx,
  workspaceId: string,
  id: string,
  design: Document,
  usedFields: string[],
  expectedHash?: Buffer,
): Promise<{ changed: boolean; row: TemplateRow }> {
  // Délku kontrolujeme dřív, než se buffer dostane k porovnání. Hodnota chodí
  // z hlavičky requestu, takže sem může přijít prázdný i přerostlý buffer
  // a `.equals()` by na něm jen tiše vrátil false, tedy „konflikt".
  if (expectedHash && expectedHash.length !== DESIGN_HASH_BYTES) {
    throw new Error("precondition_malformed");
  }
  const current = await findTemplateById(tx, workspaceId, id);
  if (!current) throw new Error("not_found");
  if (expectedHash && !current.designHash.equals(expectedHash)) throw new Error("precondition_failed");
  const hash = designHash(design);
  if (current.designHash.equals(hash)) return { changed: false, row: current };
  const [row] = await tx.update(schema.templates).set({
    design,
    designHash: hash,
    schemaVersion: design.schemaVersion,
    usedFields,
    updatedAt: new Date(),
  }).where(and(
    eq(schema.templates.id, id),
    eq(schema.templates.workspaceId, workspaceId),
  )).returning();
  return { changed: true, row: row! };
}

export async function setValidationState(
  tx: Tx,
  workspaceId: string,
  id: string,
  state: "unknown" | "valid" | "invalid",
  errors: unknown[],
): Promise<void> {
  await tx.update(schema.templates)
    .set({ validationState: state, validationErrors: errors, updatedAt: new Date() })
    .where(and(eq(schema.templates.id, id), eq(schema.templates.workspaceId, workspaceId)));
}

export async function softDeleteTemplate(tx: Tx, workspaceId: string, id: string): Promise<void> {
  await tx.update(schema.templates)
    .set({ deletedAt: new Date() })
    .where(and(eq(schema.templates.id, id), eq(schema.templates.workspaceId, workspaceId)));
}

export async function findTemplateIdsUsingField(
  tx: Tx, workspaceId: string, path: string,
): Promise<Array<{ id: string; name: string }>> {
  // GIN index nad used_fields; bez něj by to byl sekvenční průchod s deserializací JSON.
  return tx.select({ id: schema.templates.id, name: schema.templates.name })
    .from(schema.templates)
    .where(and(
      eq(schema.templates.workspaceId, workspaceId),
      isNull(schema.templates.deletedAt),
      sql`${schema.templates.usedFields} @> ARRAY[${path}]::text[]`,
    ))
    .orderBy(asc(schema.templates.name));
}
```

- [ ] **Step 4: Napiš `packages/core/templates/assets.ts`**

```ts
import { and, eq, inArray, isNull } from "drizzle-orm";
import type { AssetRef } from "@mlain/emails/compile/types";
import * as schema from "@mlain/db/schema";
import type { Tx } from "@mlain/core/tx";

/**
 * Renderer je čistá funkce bez IO, takže data assetů si vyzvedne volající
 * a předá je v CompileContext (rozhodnutí D1).
 */
export async function loadAssetRefs(
  tx: Tx, workspaceId: string, assetIds: string[],
): Promise<Record<string, AssetRef>> {
  if (assetIds.length === 0) return {};
  const rows = await tx.select().from(schema.assets).where(and(
    eq(schema.assets.workspaceId, workspaceId),
    inArray(schema.assets.id, assetIds),
    isNull(schema.assets.purgedAt),
  ));
  if (rows.length === 0) return {};

  // POZOR: `asset_variants` nemá sloupec workspace_id ani vlastní RLS politiku.
  // Její izolace je ODVOZENÁ: `assetIds` níž pochází z VÝSLEDKU předchozího
  // dotazu, který workspace filtruje. Kdyby sem někdo napojil identifikátory
  // rovnou z requestu, izolace zmizí a nic nespadne. Tenhle řádek se nepřepisuje.
  const variants = await tx.select().from(schema.assetVariants)
    .where(inArray(schema.assetVariants.assetId, rows.map((row) => row.id)));

  const out: Record<string, AssetRef> = {};
  for (const row of rows) {
    out[row.id] = {
      id: row.id,
      publicId: row.publicId,
      originalFilename: row.originalFilename,
      mimeType: row.mimeType,
      width: row.width,
      height: row.height,
      altText: row.altText,
      animated: row.frameCount > 1,
      variants: variants
        .filter((variant) => variant.assetId === row.id)
        .map((variant) => ({ variant: variant.variant, width: variant.width, height: variant.height })),
    };
  }
  return out;
}

/** Všechna assetId, na která dokument odkazuje. Vstup pro loadAssetRefs i pro asset_references. */
export function assetIdsInDocument(design: unknown): string[] {
  const ids = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (node === null || typeof node !== "object") return;
    for (const [key, value] of Object.entries(node)) {
      if (["assetId", "darkVariantAssetId", "backgroundImageAssetId"].includes(key)
          && typeof value === "string" && value !== "") {
        ids.add(value);
      }
      visit(value);
    }
  };
  visit(design);
  return [...ids];
}
```

- [ ] **Step 5: Napiš `packages/core/templates/asset-references.ts`**

Tabulku `asset_references` a sloupec `assets.reference_count` udržuje **repository vrstva ve stejné transakci jako zápis** `templates.design`, tak to určuje P03; databáze na to trigger vědomě nemá. Šablony jsou přitom **jediný pisatel** reference s `ref_type = 'template'`, takže kdyby to nedělal tenhle plán, nedělal by to nikdo: `reference_count` by zůstal nulový i u obrázku použitého v pěti šablonách, úklidová úloha by ho smazala jako nepoužívaný a **rozešly by se maily s rozbitými obrázky**.

`ref_type` databáze hlídá jen regulárním výrazem, takže uzavřený seznam hodnot musí být v aplikaci.

```ts
import { and, eq, inArray, sql } from "drizzle-orm";
import * as schema from "@mlain/db/schema";
import type { Tx } from "@mlain/core/tx";

/**
 * Uzavřený registr hodnot `asset_references.ref_type`. Databáze má na sloupci
 * jen regulární výraz `^[a-z][a-z0-9_]{0,31}$`, tedy překlep by prošel a vznikla
 * by reference, kterou už nikdo nikdy nenajde ani neuklidí.
 */
export const ASSET_REF_TYPES = ["template", "template_version", "brand_profile", "campaign"] as const;
export type AssetRefType = (typeof ASSET_REF_TYPES)[number];

/**
 * Srovná množinu referencí jednoho vlastníka na `next` a o stejnou deltu upraví
 * `assets.reference_count`. Volá se VŽDY ve stejné transakci jako zápis dokumentu,
 * jinak by mezi zápisem a srovnáním mohl proběhnout úklid.
 *
 * Vrací počty, aby šlo v testu poznat rozdíl mezi „nic se nezměnilo"
 * a „funkce se neprovedla".
 */
export async function syncAssetReferences(
  tx: Tx,
  workspaceId: string,
  owner: { refType: AssetRefType; refId: string },
  next: string[],
): Promise<{ added: number; removed: number }> {
  const wanted = new Set(next);

  const existing = await tx.select({ assetId: schema.assetReferences.assetId })
    .from(schema.assetReferences)
    .where(and(
      eq(schema.assetReferences.refType, owner.refType),
      eq(schema.assetReferences.refId, owner.refId),
    ));
  const have = new Set(existing.map((row) => row.assetId));

  const toAdd = [...wanted].filter((id) => !have.has(id));
  const toRemove = [...have].filter((id) => !wanted.has(id));

  if (toAdd.length > 0) {
    // Jen assety tohohle projektu. Cizí ani neexistující identifikátor
    // z dokumentu se do referencí nedostane a `reference_count` nezvedne.
    const own = await tx.select({ id: schema.assets.id }).from(schema.assets)
      .where(and(eq(schema.assets.workspaceId, workspaceId), inArray(schema.assets.id, toAdd)));
    const ownIds = own.map((row) => row.id);
    if (ownIds.length > 0) {
      await tx.insert(schema.assetReferences)
        .values(ownIds.map((assetId) => ({ assetId, refType: owner.refType, refId: owner.refId })))
        .onConflictDoNothing();
      await tx.update(schema.assets)
        .set({ referenceCount: sql`${schema.assets.referenceCount} + 1` })
        .where(and(eq(schema.assets.workspaceId, workspaceId), inArray(schema.assets.id, ownIds)));
    }
    toAdd.length = 0;
    toAdd.push(...ownIds);
  }

  if (toRemove.length > 0) {
    await tx.delete(schema.assetReferences).where(and(
      eq(schema.assetReferences.refType, owner.refType),
      eq(schema.assetReferences.refId, owner.refId),
      inArray(schema.assetReferences.assetId, toRemove),
    ));
    await tx.update(schema.assets)
      // GREATEST kvůli tomu, aby ani rozbitá historie nedala záporný počet:
      // sloupec je vstup úklidu a záporná hodnota by ho zablokovala napořád.
      .set({ referenceCount: sql`GREATEST(${schema.assets.referenceCount} - 1, 0)` })
      .where(and(
        eq(schema.assets.workspaceId, workspaceId),
        inArray(schema.assets.id, toRemove),
      ));
  }

  return { added: toAdd.length, removed: toRemove.length };
}
```

`packages/core/templates/asset-references.db.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import * as schema from "@mlain/db/schema";
import { withWorkspace } from "@mlain/core/tx";
import { seedWorkspaceForCoreTests } from "@mlain/core/identity/test-helpers";
import { seedAssetForCoreTests } from "./test-fixtures.js";
import { ASSET_REF_TYPES, syncAssetReferences } from "./asset-references.js";

const countOf = async (ctx: Parameters<typeof withWorkspace>[0], assetId: string) =>
  withWorkspace(ctx, async (tx) => {
    const [row] = await tx.select({ n: schema.assets.referenceCount })
      .from(schema.assets).where(eq(schema.assets.id, assetId));
    return row!.n;
  });

describe("asset references", () => {
  it("keeps the closed registry of ref types", () => {
    expect(ASSET_REF_TYPES).toContain("template");
    for (const value of ASSET_REF_TYPES) expect(value).toMatch(/^[a-z][a-z0-9_]{0,31}$/);
  });

  it("raises and lowers reference_count together with the rows", async () => {
    const ws = await seedWorkspaceForCoreTests();
    const asset = await seedAssetForCoreTests(ws);
    const templateId = crypto.randomUUID();

    await withWorkspace(ws.ctx, (tx) =>
      syncAssetReferences(tx, ws.workspaceId, { refType: "template", refId: templateId }, [asset.id]));
    expect(await countOf(ws.ctx, asset.id)).toBe(1);

    // Druhé srovnání na tutéž množinu nesmí počet zvednout podruhé.
    await withWorkspace(ws.ctx, (tx) =>
      syncAssetReferences(tx, ws.workspaceId, { refType: "template", refId: templateId }, [asset.id]));
    expect(await countOf(ws.ctx, asset.id)).toBe(1);

    await withWorkspace(ws.ctx, (tx) =>
      syncAssetReferences(tx, ws.workspaceId, { refType: "template", refId: templateId }, []));
    expect(await countOf(ws.ctx, asset.id)).toBe(0);
    const left = await withWorkspace(ws.ctx, (tx) => tx.select().from(schema.assetReferences)
      .where(and(
        eq(schema.assetReferences.refType, "template"),
        eq(schema.assetReferences.refId, templateId),
      )));
    expect(left).toEqual([]);
  });

  it("counts the same asset once per owner, so two templates give two", async () => {
    const ws = await seedWorkspaceForCoreTests();
    const asset = await seedAssetForCoreTests(ws);
    for (const refId of [crypto.randomUUID(), crypto.randomUUID()]) {
      await withWorkspace(ws.ctx, (tx) =>
        syncAssetReferences(tx, ws.workspaceId, { refType: "template", refId }, [asset.id]));
    }
    expect(await countOf(ws.ctx, asset.id)).toBe(2);
  });

  it("ignores an asset id that does not belong to the workspace", async () => {
    const ws = await seedWorkspaceForCoreTests();
    const other = await seedWorkspaceForCoreTests();
    const foreign = await seedAssetForCoreTests(other);
    const result = await withWorkspace(ws.ctx, (tx) => syncAssetReferences(
      tx, ws.workspaceId, { refType: "template", refId: crypto.randomUUID() }, [foreign.id],
    ));
    expect(result.added).toBe(0);
    expect(await countOf(other.ctx, foreign.id)).toBe(0);
  });

  it("never lets the count go below zero", async () => {
    const ws = await seedWorkspaceForCoreTests();
    const asset = await seedAssetForCoreTests(ws);
    const refId = crypto.randomUUID();
    await withWorkspace(ws.ctx, (tx) =>
      syncAssetReferences(tx, ws.workspaceId, { refType: "template", refId }, [asset.id]));
    await withWorkspace(ws.ctx, (tx) =>
      syncAssetReferences(tx, ws.workspaceId, { refType: "template", refId }, []));
    await withWorkspace(ws.ctx, (tx) =>
      syncAssetReferences(tx, ws.workspaceId, { refType: "template", refId }, []));
    expect(await countOf(ws.ctx, asset.id)).toBe(0);
  });
});
```

`packages/core/templates/test-fixtures.ts` (jen pro testy téhle domény, produkční cesta ho neimportuje):

```ts
import * as schema from "@mlain/db/schema";
import { withWorkspace } from "@mlain/core/tx";
import type { SeededWorkspace } from "@mlain/core/identity/test-helpers";

/**
 * Nahrávání assetů tenhle plán nevlastní (kapitola 40), ale reference na ně ano,
 * takže testy potřebují řádek v `assets`. Zakládá se přímo, protože jde
 * o testovací data, ne o produkční cestu nahrávání.
 */
export async function seedAssetForCoreTests(
  ws: SeededWorkspace,
): Promise<{ id: string; publicId: string }> {
  return withWorkspace(ws.ctx, async (tx) => {
    const publicId = Math.random().toString(36).slice(2).padEnd(22, "x").slice(0, 22);
    const [row] = await tx.insert(schema.assets).values({
      workspaceId: ws.workspaceId,
      publicId,
      originalFilename: "banner.png",
      mimeType: "image/png",
      sha256: Buffer.alloc(32, 7),
      byteSize: 1024,
      width: 1200,
      height: 600,
      frameCount: 1,
      altText: null,
    }).returning({ id: schema.assets.id, publicId: schema.assets.publicId });
    return row!;
  });
}
```

- [ ] **Step 6: Spusť testy a ověř, že projdou**

Run: `pnpm vitest run packages/core/templates/repository.db.test.ts packages/core/templates/asset-references.db.test.ts`
Expected: PASS, 13 testů.

- [ ] **Step 7: Smaž dočasný test předpokladů a commitni**

```bash
rm packages/core/templates/assumptions.db.test.ts
git add packages/core/templates
git commit -m "feat(templates): repository, asset refs and asset lookup"
```

---

### Task 36: Validace šablony a obal kompilace

**Files:**
- Create: `packages/core/templates/validate.ts`
- Create: `packages/core/templates/compile.ts`
- Test: `packages/core/templates/validate.test.ts`

`validateTemplateDocument` je **jediná** funkce, kterou volají všichni ostatní: uložení šablony, endpoint `/validate`, předodesílací kontrola i tvrdá brána před spuštěním kampaně. Kdyby si každý skládal schéma, sémantiku a Liquid sám, první rozchod se projeví jako „šablona je platná při uložení a neplatná při odeslání".

- [ ] **Step 1: Napiš padající test**

`packages/core/templates/validate.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { FieldCatalog } from "@mlain/core/contacts/fields/catalog";
import { blockDefaults, DEFAULT_THEME } from "@mlain/emails/document/defaults";
import { validateTemplateDocument } from "./validate.js";

const catalog: FieldCatalog = {
  version: "v1",
  fields: [{ path: "greeting", type: "string", label: { en: "Greeting" }, group: "salutation", deleted: false }],
};

const footer = { id: "b_000000000099", type: "footer", props: blockDefaults("footer") };

const doc = (children: unknown[] = [footer]) => ({
  schemaVersion: 1,
  meta: { name: "T", previewText: "", language: "cs" },
  theme: DEFAULT_THEME,
  blocks: [{ id: "b_000000000001", type: "section", props: blockDefaults("section"), children }],
});

const ctx = { templateKind: "campaign" as const, fields: catalog, assetIds: new Set<string>() };

describe("validateTemplateDocument", () => {
  it("accepts a valid document and reports state valid", () => {
    const result = validateTemplateDocument(doc(), ctx);
    expect(result.state).toBe("valid");
    expect(result.issues.filter((i) => i.severity === "error")).toEqual([]);
  });

  it("stops at the schema layer and does not run semantics on a broken shape", () => {
    const result = validateTemplateDocument({ schemaVersion: 1 }, ctx);
    expect(result.state).toBe("invalid");
    expect(result.issues.every((i) => i.code.startsWith("schema_"))).toBe(true);
  });

  it("reports a too new schema version with its own code", () => {
    const result = validateTemplateDocument({ ...doc(), schemaVersion: 2 }, ctx);
    expect(result.issues.map((i) => i.code)).toContain("template_schema_too_new");
  });

  it("keeps warnings out of the blocking decision", () => {
    const withoutAlt = {
      id: "b_000000000002", type: "image",
      props: { ...blockDefaults("image"), assetId: "0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071" },
    };
    const result = validateTemplateDocument(
      doc([withoutAlt, footer]),
      { ...ctx, assetIds: new Set(["0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071"]) },
    );
    expect(result.issues.some((i) => i.code === "content_image_missing_alt")).toBe(true);
    expect(result.state).toBe("valid");
  });

  it("marks a document referencing an unknown field as invalid", () => {
    const text = {
      id: "b_000000000002", type: "text",
      props: {
        ...blockDefaults("text"),
        content: [{ t: "p", children: [{ t: "var", expr: "contact.neexistuje" }] }],
      },
    };
    expect(validateTemplateDocument(doc([text, footer]), ctx).state).toBe("invalid");
  });

  it("returns dotted paths for the api envelope, not json pointers", () => {
    const duplicate = doc([footer, { ...footer, id: "b_000000000099" }]);
    const result = validateTemplateDocument(duplicate, ctx);
    const issue = result.issues.find((i) => i.code === "content_duplicate_block_id");
    expect(issue?.path).toMatch(/^blocks\.0\.children\./);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm vitest run packages/core/templates/validate.test.ts`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napiš `packages/core/templates/validate.ts`**

```ts
import type { FieldCatalog } from "@mlain/core/contacts/fields/catalog";
import type { Issue } from "@mlain/emails/issue";
import { checkSemantics } from "@mlain/emails/document/semantic";
import { validateDocumentSchema } from "@mlain/emails/document/schema";
import { DocumentSchemaTooNewError, loadDocument } from "@mlain/emails/document/migrate";
import { canonicalJson } from "@mlain/emails/document/canonical";
import type { Document } from "@mlain/emails/document/types";

export type ValidateContext = {
  templateKind: "campaign" | "transactional" | "system";
  fields: FieldCatalog;
  assetIds: Set<string>;
};

export type ValidationResult = {
  state: "valid" | "invalid";
  issues: Issue[];
  document?: Document;
};

/**
 * Tři vrstvy v pevném pořadí: migrace a verze schématu, JSON Schema, sémantika.
 * Vyšší vrstva se nespouští, když nižší selhala, jinak by editor dostal hlášky
 * o vnořených sloupcích u dokumentu, který není ani objekt.
 */
export function validateTemplateDocument(raw: unknown, ctx: ValidateContext): ValidationResult {
  let document: Document;
  try {
    document = loadDocument(raw);
  } catch (error) {
    const code = error instanceof DocumentSchemaTooNewError
      ? "template_schema_too_new"
      : "template_document_invalid";
    return {
      state: "invalid",
      issues: [{ code, severity: "error", pointer: "", path: "", params: { message: String(error) } }],
    };
  }

  const schema = validateDocumentSchema(document);
  if (!schema.ok) {
    return {
      state: "invalid",
      issues: schema.issues.map((issue) => ({
        code: issue.code,
        severity: "error" as const,
        pointer: issue.pointer,
        path: issue.pointer.replace(/^\//, "").split("/").join("."),
        params: { message: issue.message },
      })),
    };
  }

  // Odhad velikosti HTML pro pravidlo S9. Přesné číslo zná až kompilace
  // a předodesílací kontrola ho z ní bere; tady jde jen o včasné varování.
  const estimatedHtmlBytes = Buffer.byteLength(canonicalJson(document), "utf8") * 3;

  const issues = checkSemantics(document, {
    templateKind: ctx.templateKind,
    fields: ctx.fields,
    assetIds: ctx.assetIds,
    estimatedHtmlBytes,
  });

  return {
    state: issues.some((issue) => issue.severity === "error") ? "invalid" : "valid",
    issues,
    document,
  };
}
```

- [ ] **Step 4: Napiš `packages/core/templates/compile.ts`**

```ts
import type { FieldCatalog } from "@mlain/core/contacts/fields/catalog";
import { compileDocument } from "@mlain/emails/compile/compile";
import type { CompileContext, CompileResult } from "@mlain/emails/compile/types";
import type { Document } from "@mlain/emails/document/types";
import type { Tx } from "@mlain/core/tx";
import { assetIdsInDocument, loadAssetRefs } from "./assets.js";
import { validateTemplateDocument } from "./validate.js";

export type CompileTemplateInput = {
  tx: Tx;
  workspaceId: string;
  document: Document;
  templateKind: "campaign" | "transactional" | "system";
  fields: FieldCatalog;
  language: string;
  assetBaseUrl: string;
  purpose: "send" | "preview" | "test";
  campaignId?: string;
  trackOpens: boolean;
  trackClicks: boolean;
  preheader?: string;
  now?: Date;
};

/**
 * Obal nad kontraktem: dohledá assety, znovu zvaliduje a teprve pak kompiluje.
 * Validace před kompilací je tvrdá brána z 3.8.4 C: kampaň s rozbitou šablonou
 * nesmí odejít ani tehdy, když se kontaktní pole smazalo až po uložení šablony.
 */
export async function compileTemplate(input: CompileTemplateInput): Promise<CompileResult> {
  const assetIds = assetIdsInDocument(input.document);
  const assets = await loadAssetRefs(input.tx, input.workspaceId, assetIds);

  const validation = validateTemplateDocument(input.document, {
    templateKind: input.templateKind,
    fields: input.fields,
    assetIds: new Set(Object.keys(assets)),
  });
  if (validation.state === "invalid") {
    return { ok: false, issues: validation.issues.filter((issue) => issue.severity === "error") };
  }

  const ctx: CompileContext = {
    workspaceId: input.workspaceId,
    campaignId: input.campaignId,
    templateKind: input.templateKind,
    fields: input.fields,
    language: input.language,
    assetBaseUrl: input.assetBaseUrl,
    assets,
    purpose: input.purpose,
    trackOpens: input.trackOpens,
    trackClicks: input.trackClicks,
    preheader: input.preheader,
    currentYear: (input.now ?? new Date()).getUTCFullYear(),
  };
  return compileDocument(validation.document!, ctx);
}
```

- [ ] **Step 5: Spusť test a ověř, že projde**

Run: `pnpm vitest run packages/core/templates/validate.test.ts`
Expected: PASS, 6 testů.

- [ ] **Step 6: Commit**

```bash
git add packages/core/templates/validate.ts packages/core/templates/compile.ts packages/core/templates/validate.test.ts
git commit -m "feat(templates): single validation entry point and compile wrapper"
```

---

### Task 37: Verze šablony

**Files:**
- Create: `packages/core/templates/versions.ts`
- Test: `packages/core/templates/versions.db.test.ts`

Kritéria 46, 47 a 50. `version` je `max(version) + 1` pod zámkem řádku `templates`, jinak souběžné uložení vyrobí dvě verze se stejným číslem. Obnovení je **vždy dopředné**: historie se nikdy nepřepisuje, takže uživatel může obnovit obnovení.

**Transakci tyhle funkce neotvírají.** Zámek se bere na předaném `tx`, protože ten už uvnitř transakce je. Volání `tx.transaction()` by tady bylo tiché poškození dat, viz kapitola 0.7 bod 3. Tím pádem platí i opačný závazek: **volající musí `createVersion` a `restoreVersion` obalit `withWorkspace`**, jinak `FOR UPDATE` nezamkne nic a číslo verze se může zdvojit.

- [ ] **Step 1: Napiš padající test**

`packages/core/templates/versions.db.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import * as schema from "@mlain/db/schema";
import { withWorkspace } from "@mlain/core/tx";
import { seedWorkspaceForCoreTests } from "@mlain/core/identity/test-helpers";
import { createTemplateRow, findTemplateById } from "./repository.js";
import { createVersion, listVersions, pruneVersions, restoreVersion } from "./versions.js";

const design = (name: string, schemaVersion = 1) => ({
  schemaVersion,
  meta: { name, previewText: "", language: "cs" },
  theme: { contentWidth: 600, canvasBackground: "surface.canvas", contentBackground: "surface.content", colors: {}, fonts: { heading: "system", body: "system" }, typography: { baseFontSize: 16, baseLineHeight: 1.5, headingScale: 1.25 }, radius: 6, darkMode: { strategy: "auto", colors: {} } },
  blocks: [],
});

const seedTemplate = async (name = "A") => {
  const ws = await seedWorkspaceForCoreTests();
  const template = await withWorkspace(ws.ctx, (tx) =>
    createTemplateRow(tx, ws.workspaceId, { name, kind: "campaign", design: design(name), usedFields: [] }));
  return { ws, template };
};

describe("template versions", () => {
  it("numbers versions from one", async () => {
    const { ws, template } = await seedTemplate();
    const first = await withWorkspace(ws.ctx, (tx) =>
      createVersion(tx, ws.workspaceId, template.id, { reason: "manual" }));
    expect(first.version).toBe(1);
    const second = await withWorkspace(ws.ctx, (tx) =>
      createVersion(tx, ws.workspaceId, template.id, { reason: "manual", design: design("B") }));
    expect(second.version).toBe(2);
  });

  it("creates at most one version for two saves with the same content", async () => {
    const { ws, template } = await seedTemplate();
    await withWorkspace(ws.ctx, (tx) => createVersion(tx, ws.workspaceId, template.id, { reason: "manual" }));
    await withWorkspace(ws.ctx, (tx) => createVersion(tx, ws.workspaceId, template.id, { reason: "manual" }));
    const history = await withWorkspace(ws.ctx, (tx) => listVersions(tx, ws.workspaceId, template.id));
    expect(history).toHaveLength(1);
  });

  it("restores forward and leaves the old version untouched", async () => {
    const { ws, template } = await seedTemplate();
    const v1 = await withWorkspace(ws.ctx, (tx) =>
      createVersion(tx, ws.workspaceId, template.id, { reason: "manual" }));
    await withWorkspace(ws.ctx, (tx) =>
      createVersion(tx, ws.workspaceId, template.id, { reason: "manual", design: design("B") }));
    const restored = await withWorkspace(ws.ctx, (tx) =>
      restoreVersion(tx, ws.workspaceId, template.id, v1.version, ["contact.attr.city"]));
    expect(restored.version).toBe(3);
    expect(restored.reason).toBe("restore");
    expect(restored.label).toBe("Obnoveno z verze 1");
    const history = await withWorkspace(ws.ctx, (tx) => listVersions(tx, ws.workspaceId, template.id));
    expect(history.find((v) => v.version === 1)?.design).toEqual(design("A"));
  });

  it("restore rewrites schema_version and used_fields, not just the design", async () => {
    const { ws, template } = await seedTemplate();
    // Verze uložená před migrací dokumentu má nižší schemaVersion.
    const old = await withWorkspace(ws.ctx, (tx) =>
      createVersion(tx, ws.workspaceId, template.id, { reason: "manual", design: design("stará", 1) }));
    await withWorkspace(ws.ctx, (tx) =>
      createVersion(tx, ws.workspaceId, template.id, { reason: "manual", design: design("nová", 2) }));
    await withWorkspace(ws.ctx, (tx) => tx.update(schema.templates)
      .set({ schemaVersion: 2, usedFields: ["contact.attr.stare"] })
      .where(eq(schema.templates.id, template.id)));

    await withWorkspace(ws.ctx, (tx) =>
      restoreVersion(tx, ws.workspaceId, template.id, old.version, ["contact.attr.nove"]));

    const row = await withWorkspace(ws.ctx, (tx) => findTemplateById(tx, ws.workspaceId, template.id));
    // Bez tohohle by sloupec hlásil novou verzi u starého dokumentu,
    // loadDocument by migraci nespustil a validátor by jel staré schéma.
    expect(row!.schemaVersion).toBe(1);
    expect(row!.usedFields).toEqual(["contact.attr.nove"]);
  });

  it("never prunes a pinned version, even past the retention window", async () => {
    const { ws, template } = await seedTemplate();
    const pinned = await withWorkspace(ws.ctx, (tx) =>
      createVersion(tx, ws.workspaceId, template.id, { reason: "pre_send", pinned: true }));
    await withWorkspace(ws.ctx, (tx) => tx.update(schema.templateVersions)
      .set({ createdAt: sql`now() - interval '400 days'` })
      .where(eq(schema.templateVersions.id, pinned.id)));
    await withWorkspace(ws.ctx, (tx) =>
      pruneVersions(tx, ws.workspaceId, { retentionDays: 180, maxUnpinned: 50 }));
    const history = await withWorkspace(ws.ctx, (tx) => listVersions(tx, ws.workspaceId, template.id));
    expect(history).toHaveLength(1);
  });

  it("never prunes the version the template currently points at", async () => {
    const { ws, template } = await seedTemplate();
    const current = await withWorkspace(ws.ctx, (tx) =>
      createVersion(tx, ws.workspaceId, template.id, { reason: "manual" }));
    await withWorkspace(ws.ctx, (tx) => tx.update(schema.templateVersions)
      .set({ createdAt: sql`now() - interval '400 days'` })
      .where(eq(schema.templateVersions.id, current.id)));

    await withWorkspace(ws.ctx, (tx) =>
      pruneVersions(tx, ws.workspaceId, { retentionDays: 180, maxUnpinned: 0 }));

    // Cizí klíč má ON DELETE SET NULL, takže smazání by nikde nespadlo:
    // šablona by jen tiše ztratila ukazatel a API by vracelo current_version: null.
    const row = await withWorkspace(ws.ctx, (tx) => findTemplateById(tx, ws.workspaceId, template.id));
    expect(row!.currentVersionId).toBe(current.id);
    const history = await withWorkspace(ws.ctx, (tx) => listVersions(tx, ws.workspaceId, template.id));
    expect(history.map((v) => v.id)).toContain(current.id);
  });

  it("keeps at most the configured number of unpinned versions", async () => {
    const { ws, template } = await seedTemplate();
    for (let i = 0; i < 6; i += 1) {
      await withWorkspace(ws.ctx, (tx) =>
        createVersion(tx, ws.workspaceId, template.id, { reason: "manual", design: design(`v${i}`) }));
    }
    await withWorkspace(ws.ctx, (tx) =>
      pruneVersions(tx, ws.workspaceId, { retentionDays: 180, maxUnpinned: 3 }));
    const history = await withWorkspace(ws.ctx, (tx) => listVersions(tx, ws.workspaceId, template.id));
    // Tři nejnovější nepřipnuté plus aktuální, kterou retence nesmí vzít.
    expect(history.length).toBeGreaterThanOrEqual(3);
    expect(history.map((v) => v.id)).toContain(
      (await withWorkspace(ws.ctx, (tx) => findTemplateById(tx, ws.workspaceId, template.id)))!.currentVersionId,
    );
  });

  it("does not see versions from another workspace", async () => {
    const { ws, template } = await seedTemplate();
    await withWorkspace(ws.ctx, (tx) => createVersion(tx, ws.workspaceId, template.id, { reason: "manual" }));
    const other = await seedWorkspaceForCoreTests();
    const seen = await withWorkspace(other.ctx, (tx) =>
      listVersions(tx, other.workspaceId, template.id));
    expect(seen).toEqual([]);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm vitest run packages/core/templates/versions.db.test.ts`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napiš implementaci**

`packages/core/templates/versions.ts`:

```ts
import { and, asc, desc, eq, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { designHash } from "@mlain/emails/document/canonical";
import type { Document } from "@mlain/emails/document/types";
import * as schema from "@mlain/db/schema";
import type { Tx } from "@mlain/core/tx";
import { syncAssetReferences } from "./asset-references.js";
import { assetIdsInDocument } from "./assets.js";

export type VersionReason = "manual" | "pre_send" | "ai_apply" | "restore" | "import";
export type VersionRow = typeof schema.templateVersions.$inferSelect;

export type CreateVersionInput = {
  reason: VersionReason;
  design?: Document;
  label?: string;
  pinned?: boolean;
  createdBy?: string;
  /**
   * Vyplňuje **P13** při `reason: "pre_send"`, viz požadavek R12. Tenhle plán
   * sám kompilovanou podobu do verze neukládá, takže bez P13 zůstanou sloupce
   * `compiled_html`, `compiled_text`, `compile_meta` a `renderer_version` NULL.
   */
  compiled?: { html: string; text: string; meta: unknown; rendererVersion: string };
};

/**
 * Číslo verze je max(version) + 1 pod zámkem řádku šablony. Bez `FOR UPDATE`
 * by dvě souběžná uložení vyrobila dvě verze se stejným číslem a unikátní index
 * by jedno z nich shodil až v okamžiku commitu.
 *
 * `tx` je UŽ uvnitř transakce, kterou otevřel volající přes `withWorkspace`.
 * Vlastní `tx.transaction()` se tady nesmí objevit: vydá druhý `BEGIN` na témž
 * spojení a jeho `COMMIT` potvrdí vnější transakci, takže zápis přežije i její
 * `ROLLBACK`. Ověřeno spuštěním, viz kapitola 0.7.
 */
export async function createVersion(
  tx: Tx, workspaceId: string, templateId: string, input: CreateVersionInput,
): Promise<VersionRow> {
  const [template] = await tx.select().from(schema.templates)
    .where(and(eq(schema.templates.id, templateId), eq(schema.templates.workspaceId, workspaceId)))
    .for("update");
  if (!template) throw new Error("not_found");

  const design = input.design ?? (template.design as Document);
  const hash = designHash(design);

  const [latest] = await tx.select().from(schema.templateVersions)
    .where(and(
      eq(schema.templateVersions.workspaceId, workspaceId),
      eq(schema.templateVersions.templateId, templateId),
    ))
    .orderBy(desc(schema.templateVersions.version))
    .limit(1);
  // Verze se nevytvoří při shodě hashe s poslední verzí (3.10.1).
  if (latest && latest.designHash.equals(hash)) return latest;

  const [row] = await tx.insert(schema.templateVersions).values({
    workspaceId,
    templateId,
    version: (latest?.version ?? 0) + 1,
    schemaVersion: design.schemaVersion,
    design,
    designHash: hash,
    compiledHtml: input.compiled?.html ?? null,
    compiledText: input.compiled?.text ?? null,
    compileMeta: input.compiled?.meta ?? null,
    rendererVersion: input.compiled?.rendererVersion ?? null,
    label: input.label ?? null,
    reason: input.reason,
    pinned: input.pinned ?? false,
    createdBy: input.createdBy ?? null,
  }).returning();

  // Verze drží vlastní kopii dokumentu, takže drží i vlastní reference na assety.
  // Bez toho by úklid smazal obrázek, který je jen ve staré verzi, a obnovení
  // té verze by vrátilo šablonu s rozbitým obrázkem.
  await syncAssetReferences(
    tx, workspaceId,
    { refType: "template_version", refId: row!.id },
    assetIdsInDocument(design),
  );

  await tx.update(schema.templates)
    .set({ currentVersionId: row!.id, updatedAt: new Date() })
    .where(and(eq(schema.templates.id, templateId), eq(schema.templates.workspaceId, workspaceId)));
  return row!;
}

export async function listVersions(
  tx: Tx, workspaceId: string, templateId: string,
): Promise<VersionRow[]> {
  return tx.select().from(schema.templateVersions)
    .where(and(
      eq(schema.templateVersions.workspaceId, workspaceId),
      eq(schema.templateVersions.templateId, templateId),
    ))
    .orderBy(desc(schema.templateVersions.createdAt));
}

/**
 * Obnovení je vždy dopředné: historie se nikdy nepřepisuje ani nemaže.
 *
 * `usedFields` musí spočítat volající, protože k tomu potřebuje katalog polí,
 * a ten je doména P07, ne repository. Bez něj by po obnovení zůstala v
 * `used_fields` pole z PŘEDCHOZÍHO návrhu: dopadová analýza by ukazovala pole,
 * která v šabloně nejsou, a neukazovala ta, která v ní po obnovení jsou.
 */
export async function restoreVersion(
  tx: Tx, workspaceId: string, templateId: string, version: number, usedFields: string[],
): Promise<VersionRow> {
  const [source] = await tx.select().from(schema.templateVersions).where(and(
    eq(schema.templateVersions.workspaceId, workspaceId),
    eq(schema.templateVersions.templateId, templateId),
    eq(schema.templateVersions.version, version),
  ));
  if (!source) throw new Error("not_found");
  const design = source.design as Document;
  await tx.update(schema.templates)
    .set({
      design,
      designHash: designHash(design),
      // Verze uložená před migrací dokumentu má JINÝ schemaVersion než šablona.
      // Kdyby se nepřepsal, sloupec by hlásil novou verzi u starého dokumentu
      // a `loadDocument` by migraci nespustil.
      schemaVersion: design.schemaVersion,
      usedFields,
      updatedAt: new Date(),
    })
    .where(and(eq(schema.templates.id, templateId), eq(schema.templates.workspaceId, workspaceId)));

  await syncAssetReferences(
    tx, workspaceId,
    { refType: "template", refId: templateId },
    assetIdsInDocument(design),
  );

  return createVersion(tx, workspaceId, templateId, {
    reason: "restore",
    design,
    label: `Obnoveno z verze ${version}`,
  });
}

/**
 * Retence: nepřipnuté verze starší než N dní a nad rámec M nejnovějších.
 * Připnuté verze se nemažou nikdy, jsou důkazem, co přesně se rozeslalo.
 *
 * Z obou mazání je vyloučená verze, na kterou míří `templates.current_version_id`.
 * Cizí klíč má `ON DELETE SET NULL`, takže její smazání by NIKDE nespadlo:
 * šablona by jen tiše ztratila ukazatel a API by začalo vracet
 * `current_version: null` bez zjevné příčiny. Příznak `pinned` ji nechrání,
 * ten drží jen verze použité kampaní.
 */
export async function pruneVersions(
  tx: Tx, workspaceId: string, options: { retentionDays: number; maxUnpinned: number },
): Promise<number> {
  const currentIds = await tx.select({ id: schema.templates.currentVersionId })
    .from(schema.templates)
    .where(and(
      eq(schema.templates.workspaceId, workspaceId),
      sql`${schema.templates.currentVersionId} IS NOT NULL`,
    ));
  const protectedIds = new Set(currentIds.map((row) => row.id!).filter(Boolean));
  const notProtected = protectedIds.size === 0
    ? undefined
    : sql`${schema.templateVersions.id} <> ALL(${[...protectedIds]}::uuid[])`;

  let removed = 0;

  if (options.retentionDays > 0) {
    const cutoff = new Date(Date.now() - options.retentionDays * 86_400_000);
    const result = await tx.delete(schema.templateVersions).where(and(
      eq(schema.templateVersions.workspaceId, workspaceId),
      eq(schema.templateVersions.pinned, false),
      lt(schema.templateVersions.createdAt, cutoff),
      ...(notProtected ? [notProtected] : []),
    )).returning({ id: schema.templateVersions.id });
    removed += result.length;
    for (const row of result) await releaseVersionAssets(tx, workspaceId, row.id);
  }

  const templates = await tx.selectDistinct({ id: schema.templateVersions.templateId })
    .from(schema.templateVersions)
    .where(eq(schema.templateVersions.workspaceId, workspaceId));
  for (const template of templates) {
    const unpinned = await tx.select({ id: schema.templateVersions.id })
      .from(schema.templateVersions)
      .where(and(
        eq(schema.templateVersions.workspaceId, workspaceId),
        eq(schema.templateVersions.templateId, template.id),
        eq(schema.templateVersions.pinned, false),
        ...(notProtected ? [notProtected] : []),
      ))
      .orderBy(asc(schema.templateVersions.createdAt));
    const excess = unpinned.slice(0, Math.max(0, unpinned.length - options.maxUnpinned));
    if (excess.length === 0) continue;
    await tx.delete(schema.templateVersions)
      .where(inArray(schema.templateVersions.id, excess.map((row) => row.id)));
    for (const row of excess) await releaseVersionAssets(tx, workspaceId, row.id);
    removed += excess.length;
  }
  return removed;
}

/** Se smazanou verzí zaniká i její nárok na assety, jinak reference_count nikdy neklesne. */
async function releaseVersionAssets(tx: Tx, workspaceId: string, versionId: string): Promise<void> {
  await syncAssetReferences(tx, workspaceId, { refType: "template_version", refId: versionId }, []);
}
```

- [ ] **Step 4: Spusť test a ověř, že projde**

Run: `pnpm vitest run packages/core/templates/versions.db.test.ts`
Expected: PASS, 8 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/templates/versions.ts packages/core/templates/versions.db.test.ts
git commit -m "feat(templates): forward only version history with retention"
```

---

### Task 38: Služba šablon

**Files:**
- Create: `packages/core/templates/service.ts`
- Create: `packages/core/templates/index.ts`
- Test: `packages/core/templates/service.db.test.ts`

Služba je **jediná vrstva, která otevírá transakci**. Repository ani verze ji neotvírají (kapitola 0.7), takže kdyby ji neotevřel nikdo tady, `FOR UPDATE` v `createVersion` nezamkne nic a RLS kontext nebude nastavený.

- [ ] **Step 1: Napiš padající test**

`packages/core/templates/service.db.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { FieldCatalog } from "@mlain/core/contacts/fields/catalog";
import { blockDefaults, DEFAULT_THEME } from "@mlain/emails/document/defaults";
import { seedWorkspaceForCoreTests } from "@mlain/core/identity/test-helpers";
import { createTemplate, deleteTemplate, duplicateTemplate, saveDesign } from "./service.js";

const catalog: FieldCatalog = { version: "v1", fields: [] };

const footer = { id: "b_000000000099", type: "footer", props: blockDefaults("footer") };
const design = {
  schemaVersion: 1,
  meta: { name: "T", previewText: "", language: "cs" },
  theme: DEFAULT_THEME,
  blocks: [{ id: "b_000000000001", type: "section", props: blockDefaults("section"), children: [footer] }],
};

const serviceCtx = async (fields: FieldCatalog = catalog) => {
  const ws = await seedWorkspaceForCoreTests();
  return { ws, ctx: { ctx: ws.ctx, workspaceId: ws.workspaceId, fields, userId: ws.userId } };
};

describe("template service", () => {
  it("creates a template from a document and records the validation state", async () => {
    const { ctx } = await serviceCtx();
    const row = await createTemplate(ctx, { name: "První", kind: "campaign", document: design });
    expect(row.validationState).toBe("valid");
  });

  it("creates a template from base template parameters", async () => {
    const { ctx } = await serviceCtx();
    const row = await createTemplate(ctx, {
      name: "Z generátoru", kind: "campaign",
      baseTemplate: {
        variant: "newsletter",
        brand: { palette: { primary: "#2563eb" }, typography: { headingStack: "Arial", bodyStack: "Arial", radius: 6 } },
        language: "cs", darkMode: true,
        sections: [{ kind: "hero", headline: "Vítejte" }],
      },
    });
    expect(JSON.stringify(row.design)).toContain("workspace.sender_address");
  });

  it("stores used fields on the very first write, without a second save", async () => {
    const fields: FieldCatalog = {
      version: "v2",
      fields: [{ path: "attr.city", type: "string", label: { en: "City" }, group: "custom", deleted: false }],
    };
    const { ctx } = await serviceCtx(fields);
    const conditional = {
      ...design,
      blocks: [{
        id: "b_000000000001", type: "section", props: blockDefaults("section"),
        children: [
          { id: "b_000000000002", type: "text", visibleWhen: { field: "contact.attr.city", op: "present" }, props: blockDefaults("text") },
          footer,
        ],
      }],
    };
    const row = await createTemplate(ctx, { name: "Podmíněná", kind: "campaign", document: conditional });
    // Tohle je celý smysl testu. Dřív se `usedFields` doplňovalo druhým voláním
    // `updateTemplateDesign` s TÝMŽ dokumentem, takže se porovnal shodný hash,
    // funkce skončila na `changed: false` a sloupec zůstal prázdný napořád.
    expect(row.usedFields).toContain("contact.attr.city");
  });

  it("refuses to save when the design hash does not match", async () => {
    const { ctx } = await serviceCtx();
    const row = await createTemplate(ctx, { name: "A", kind: "campaign", document: design });
    await expect(saveDesign(ctx, row.id, design, Buffer.alloc(32)))
      .rejects.toThrow("precondition_failed");
  });

  it("duplicates a template with a new name and its own history", async () => {
    const { ctx } = await serviceCtx();
    const row = await createTemplate(ctx, { name: "A", kind: "campaign", document: design });
    const copy = await duplicateTemplate(ctx, row.id);
    expect(copy.id).not.toBe(row.id);
    expect(copy.name).toBe("A (kopie)");
  });

  it("numbers further copies instead of failing on the unique index", async () => {
    const { ctx } = await serviceCtx();
    const row = await createTemplate(ctx, { name: "A", kind: "campaign", document: design });
    const first = await duplicateTemplate(ctx, row.id);
    const second = await duplicateTemplate(ctx, row.id);
    const third = await duplicateTemplate(ctx, row.id);
    expect([first.name, second.name, third.name]).toEqual(["A (kopie)", "A (kopie 2)", "A (kopie 3)"]);
  });

  it("shortens a long name so the copy still fits the length check", async () => {
    const { ctx } = await serviceCtx();
    const longName = "Š".repeat(118);
    const row = await createTemplate(ctx, { name: longName, kind: "campaign", document: design });
    const copy = await duplicateTemplate(ctx, row.id);
    // ck_templates__name_len povoluje 1 až 120 znaků. Bez zkrácení by šablona
    // se 118 znaky nešla zkopírovat vůbec a uživatel by dostal 500.
    expect(copy.name.length).toBeLessThanOrEqual(120);
    expect(copy.name.endsWith("(kopie)")).toBe(true);
  });

  it("refuses to delete a starter template", async () => {
    const { ctx } = await serviceCtx();
    const row = await createTemplate(ctx, { name: "Dodávaná", kind: "campaign", document: design, starter: true });
    await expect(deleteTemplate(ctx, row.id)).rejects.toThrow("template_starter_immutable");
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm vitest run packages/core/templates/service.db.test.ts`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napiš `packages/core/templates/service.ts`**

```ts
import { and, eq, isNull, like } from "drizzle-orm";
import type { FieldCatalog } from "@mlain/core/contacts/fields/catalog";
import type { WorkspaceContext } from "@mlain/db";
import * as schema from "@mlain/db/schema";
import { pgErrorCode, withWorkspace, type Tx } from "@mlain/core/tx";
import { buildBaseTemplate, type BaseTemplateParams } from "@mlain/emails/base/build";
import { buildRenderSchema } from "@mlain/emails/compile/render-schema";
import { newBlockId } from "@mlain/emails/document/ids";
import type { Document } from "@mlain/emails/document/types";
import { syncAssetReferences } from "./asset-references.js";
import { assetIdsInDocument, loadAssetRefs } from "./assets.js";
import {
  createTemplateRow, findTemplateById, setValidationState, softDeleteTemplate,
  updateTemplateDesign, type TemplateRow,
} from "./repository.js";
import { validateTemplateDocument } from "./validate.js";
import { restoreVersion, type VersionRow } from "./versions.js";

/** Maximum z `ck_templates__name_len`. */
const NAME_MAX = 120;
/** Nejdelší přípona, kterou `copyName` může přidat: " (kopie 99)". */
const COPY_SUFFIX_MAX = 12;

export type ServiceContext = {
  /** Branded kontext projektu. Transakci otevírá tahle vrstva, ne volající. */
  ctx: WorkspaceContext;
  workspaceId: string;
  fields: FieldCatalog;
  userId?: string;
};

export type CreateTemplateInput = {
  name: string;
  kind?: "campaign" | "transactional" | "system";
  starter?: boolean;
} & ({ document: Document } | { baseTemplate: BaseTemplateParams });

/** Sjednocení použitých cest a podmínkových cest, aby pole použité jen v podmínce nezmizelo z dopadové analýzy. */
function computeUsedFields(ctx: ServiceContext, document: Document): string[] {
  const schemaOf = buildRenderSchema(document, { fields: ctx.fields, skippedBlockIds: new Set() });
  return [...new Set([...schemaOf.fields.map((field) => field.path), ...schemaOf.presence])];
}

async function validateAndStore(
  tx: Tx, ctx: ServiceContext, templateId: string, document: Document, kind: TemplateRow["kind"],
): Promise<void> {
  const assets = await loadAssetRefs(tx, ctx.workspaceId, assetIdsInDocument(document));
  const result = validateTemplateDocument(document, {
    templateKind: kind,
    fields: ctx.fields,
    assetIds: new Set(Object.keys(assets)),
  });
  await setValidationState(tx, ctx.workspaceId, templateId, result.state, result.issues);
}

export async function createTemplate(
  ctx: ServiceContext, input: CreateTemplateInput,
): Promise<TemplateRow> {
  const source = "document" in input
    ? input.document
    : buildBaseTemplate(input.baseTemplate, { nextId: newBlockId });
  const kind = input.kind ?? "campaign";
  const document: Document = { ...source, meta: { ...source.meta, name: input.name } };

  return withWorkspace(ctx.ctx, async (tx) => {
    const row = await createTemplateRow(tx, ctx.workspaceId, {
      name: input.name,
      kind,
      design: document,
      // Rovnou při vložení, ne druhým průchodem. Druhý průchod se stejným
      // dokumentem skončí na shodě hashe a sloupec by zůstal prázdný.
      usedFields: computeUsedFields(ctx, document),
      createdBy: ctx.userId,
      starter: input.starter,
    });
    await syncAssetReferences(
      tx, ctx.workspaceId,
      { refType: "template", refId: row.id },
      assetIdsInDocument(document),
    );
    await validateAndStore(tx, ctx, row.id, document, kind);
    return (await findTemplateById(tx, ctx.workspaceId, row.id))!;
  });
}

/** Autosave. Vrací `changed: false`, když se hash nezměnil, takže se řádek nepřepisuje. */
export async function saveDesign(
  ctx: ServiceContext, templateId: string, document: Document, expectedHash?: Buffer,
): Promise<{ changed: boolean; row: TemplateRow }> {
  return withWorkspace(ctx.ctx, async (tx) => {
    const current = await findTemplateById(tx, ctx.workspaceId, templateId);
    if (!current) throw new Error("not_found");
    const result = await updateTemplateDesign(
      tx, ctx.workspaceId, templateId, document, computeUsedFields(ctx, document), expectedHash,
    );
    if (result.changed) {
      await syncAssetReferences(
        tx, ctx.workspaceId,
        { refType: "template", refId: templateId },
        assetIdsInDocument(document),
      );
      await validateAndStore(tx, ctx, templateId, document, current.kind);
    }
    return result;
  });
}

/**
 * Jméno kopie. Dvě omezení naráz, obě z P03:
 * `ck_templates__name_len` povoluje 1 až 120 znaků a `uq_templates__workspace_name`
 * je unikátní na `lower(name)` mezi nesmazanými. Bez zkrácení by nešla zkopírovat
 * šablona se 118znakovým jménem, bez pořadového čísla by druhá kopie spadla
 * na unikátním indexu, a obojí by skončilo jako 500.
 */
export function copyName(source: string, ordinal: number): string {
  const suffix = ordinal <= 1 ? " (kopie)" : ` (kopie ${ordinal})`;
  const room = NAME_MAX - suffix.length;
  return `${source.slice(0, Math.max(1, room))}${suffix}`;
}

export async function duplicateTemplate(ctx: ServiceContext, templateId: string): Promise<TemplateRow> {
  const source = await withWorkspace(ctx.ctx, (tx) => findTemplateById(tx, ctx.workspaceId, templateId));
  if (!source) throw new Error("not_found");

  const base = source.name.slice(0, NAME_MAX - COPY_SUFFIX_MAX);
  const taken = await withWorkspace(ctx.ctx, async (tx) => {
    const rows = await tx.select({ name: schema.templates.name }).from(schema.templates).where(and(
      eq(schema.templates.workspaceId, ctx.workspaceId),
      isNull(schema.templates.deletedAt),
      like(schema.templates.name, `${base}%`),
    ));
    return new Set(rows.map((row) => row.name.toLowerCase()));
  });

  for (let ordinal = 1; ordinal <= 99; ordinal += 1) {
    const name = copyName(source.name, ordinal);
    if (taken.has(name.toLowerCase())) continue;
    try {
      return await createTemplate(ctx, {
        name, kind: source.kind, document: source.design as Document,
      });
    } catch (error) {
      // 23505 je souběh: mezi dotazem a vložením stihl jméno zabrat někdo jiný.
      // Kód se čte přes pgErrorCode, protože na `error.code` je undefined.
      if (pgErrorCode(error) !== "23505") throw error;
    }
  }
  throw new Error("template_name_conflict");
}

export async function deleteTemplate(ctx: ServiceContext, templateId: string): Promise<void> {
  await withWorkspace(ctx.ctx, async (tx) => {
    const row = await findTemplateById(tx, ctx.workspaceId, templateId);
    if (!row) throw new Error("not_found");
    // Dodávané šablony jde jen skrýt, ne smazat.
    if (row.starter) throw new Error("template_starter_immutable");
    await softDeleteTemplate(tx, ctx.workspaceId, templateId);
    // Smazaná šablona přestává držet assety. Verze si je drží dál, ty se mažou
    // až retencí, takže obrázek použitý ve staré verzi zůstane.
    await syncAssetReferences(tx, ctx.workspaceId, { refType: "template", refId: templateId }, []);
  });
}

/**
 * Obnovení verze. Bydlí ve službě, ne v `versions.ts`, ze dvou důvodů:
 * transakci otevírá tahle vrstva a `usedFields` se počítá z katalogu polí,
 * který je doména P07 a repository o něm nesmí vědět.
 */
export async function restoreTemplateVersion(
  ctx: ServiceContext, templateId: string, version: number,
): Promise<VersionRow> {
  return withWorkspace(ctx.ctx, async (tx) => {
    const [source] = await tx.select().from(schema.templateVersions).where(and(
      eq(schema.templateVersions.workspaceId, ctx.workspaceId),
      eq(schema.templateVersions.templateId, templateId),
      eq(schema.templateVersions.version, version),
    ));
    if (!source) throw new Error("not_found");
    const template = await findTemplateById(tx, ctx.workspaceId, templateId);
    if (!template) throw new Error("not_found");
    const document = source.design as Document;
    const restored = await restoreVersion(
      tx, ctx.workspaceId, templateId, version, computeUsedFields(ctx, document),
    );
    // Obnovený dokument je starší, takže může být proti aktuálnímu katalogu polí
    // neplatný. Stav se přepočítá hned, jinak by šablona zůstala označená jako
    // platná podle návrhu, který v ní už není.
    await validateAndStore(tx, ctx, templateId, document, template.kind);
    return restored;
  });
}
```

- [ ] **Step 4: Napiš `packages/core/templates/index.ts`**

Doménový vstupní bod. **Není to barrel přes domény**, je to jediný soubor jedné domény, který vlastní tenhle plán.

```ts
import { registerRepoModule } from "@mlain/db";
import { withWorkspace } from "@mlain/core/tx";
import { findTemplateIdsUsingField, findTemplateById, listTemplates } from "./repository.js";
import { listVersions } from "./versions.js";
import { loadAssetRefs } from "./assets.js";

export { loadAssetRefs, assetIdsInDocument } from "./assets.js";
export { ASSET_REF_TYPES, syncAssetReferences, type AssetRefType } from "./asset-references.js";
export { compileTemplate, type CompileTemplateInput } from "./compile.js";
export { findTemplatesUsingField } from "./field-usage.js";
export { exportTemplate, importTemplate } from "./transfer.js";
export { preSendCheck, type PreSendFinding } from "./precheck.js";
export {
  copyName, createTemplate, deleteTemplate, duplicateTemplate, restoreTemplateVersion, saveDesign,
  type CreateTemplateInput, type ServiceContext,
} from "./service.js";
export {
  createTemplateRow, findTemplateById, listTemplates, setValidationState,
  softDeleteTemplate, updateTemplateDesign, type ListCursor, type TemplateRow,
} from "./repository.js";
export { validateTemplateDocument, type ValidationResult } from "./validate.js";
export { createVersion, listVersions, pruneVersions, restoreVersion } from "./versions.js";

/**
 * Registrace do generického testu izolace z P03. Ten pod cizím kontextem zavolá
 * každou zapsanou čtecí funkci a ověří, že nevrátí nic.
 *
 * Bez registrace má vlastní izolační test jen `findTemplateById` a zbylé čtecí
 * funkce žádný. Přesně o tom je poznámka P03: „bez registru by každý doménový
 * plán musel na izolaci pamatovat sám, a to je právě ten druh ochrany, který
 * nic nevynucuje."
 *
 * Identifikátory jsou schválně náhodné: test nesmí potřebovat data, jen ověřuje,
 * že cizí kontext nevrátí řádek.
 */
const PROBE_ID = "00000000-0000-0000-0000-0000000000ff";

registerRepoModule({
  name: "templates",
  readers: [
    { name: "findTemplateById", call: (pool, ctx) => withWorkspace(ctx, (tx) => findTemplateById(tx, ctx.workspaceId, PROBE_ID)) },
    { name: "listTemplates", call: (pool, ctx) => withWorkspace(ctx, (tx) => listTemplates(tx, ctx.workspaceId, { limit: 5 })) },
    { name: "listVersions", call: (pool, ctx) => withWorkspace(ctx, (tx) => listVersions(tx, ctx.workspaceId, PROBE_ID)) },
    { name: "findTemplateIdsUsingField", call: (pool, ctx) => withWorkspace(ctx, (tx) => findTemplateIdsUsingField(tx, ctx.workspaceId, "contact.attr.city")) },
    { name: "loadAssetRefs", call: (pool, ctx) => withWorkspace(ctx, (tx) => loadAssetRefs(tx, ctx.workspaceId, [PROBE_ID])) },
  ],
});
```

- [ ] **Step 5: Spusť test a ověř, že projde**

Run: `pnpm vitest run packages/core/templates/service.db.test.ts`
Expected: PASS, 8 testů.

- [ ] **Step 6: Commit**

```bash
git add packages/core/templates/service.ts packages/core/templates/index.ts packages/core/templates/service.db.test.ts
git commit -m "feat(templates): template service and domain entry point"
```

---

### Task 39: Předodesílací kontrola

**Files:**
- Create: `packages/core/templates/precheck.ts`
- Test: `packages/core/templates/precheck.test.ts`

Kritérium 45. Nálezy jdou do pole `findings`, ne do `errors`: `errors` je vyhrazené pro porušení schématu, tohle jsou doménové kontroly s různou závažností. **Odpověď je 4xx jen tehdy, když je mezi nálezy aspoň jeden se `severity: "error"`**, jinak by `findings` byl odpadkový koš.

Poslední kontrola, `precheck_app_url_not_public`, vypadá nenápadně, ale v self-hosted nasazení chytí nejčastější chybu vůbec: instalace běží na `http://localhost:3000`, uživatel odešle kampaň a nikomu se nezobrazí obrázky ani nefunguje odhlášení.

- [ ] **Step 1: Napiš padající test**

`packages/core/templates/precheck.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { preSendCheck } from "./precheck.js";

const meta = (over: Record<string, unknown> = {}) => ({
  htmlBytes: 50_000,
  links: [{ id: "a", position: 1, url: "https://a.cz", trackable: true, label: "A" }],
  assetIds: [],
  warnings: [],
  hasUnsubscribeLink: true,
  clickMarkerCount: 1,
  hasOpenPixelSlot: true,
  ...over,
});

const input = (over: Record<string, unknown> = {}) => ({
  compileMeta: meta(),
  validationIssues: [],
  subject: "Předmět",
  preheader: "Preheader",
  appUrl: "https://mail.example.com",
  emptyFieldRatios: [],
  ...over,
});

const codes = (over: Record<string, unknown> = {}) =>
  preSendCheck(input(over)).findings.map((f) => f.code);

describe("preSendCheck", () => {
  it("passes a healthy campaign", () => {
    const result = preSendCheck(input());
    expect(result.blocking).toBe(false);
    expect(result.findings).toEqual([]);
  });

  it("blocks when the template did not validate", () => {
    const result = preSendCheck(input({
      validationIssues: [{ code: "content_nested_columns", severity: "error", pointer: "", path: "" }],
    }));
    expect(result.blocking).toBe(true);
    expect(result.findings.map((f) => f.code)).toContain("precheck_template_invalid");
  });

  it("blocks a missing unsubscribe link", () => {
    expect(codes({ compileMeta: meta({ hasUnsubscribeLink: false }) }))
      .toContain("precheck_missing_unsubscribe");
  });

  it("warns above 80 kB and blocks above 102 kB", () => {
    expect(preSendCheck(input({ compileMeta: meta({ htmlBytes: 90_000 }) }))
      .findings.find((f) => f.code === "precheck_html_large")?.severity).toBe("warning");
    expect(preSendCheck(input({ compileMeta: meta({ htmlBytes: 110_000 }) })).blocking).toBe(true);
  });

  it("blocks an empty subject and only warns for an empty preheader", () => {
    expect(preSendCheck(input({ subject: "  " })).blocking).toBe(true);
    const preheader = preSendCheck(input({ preheader: "" }));
    expect(preheader.blocking).toBe(false);
    expect(preheader.findings.map((f) => f.code)).toContain("precheck_preheader_empty");
  });

  it("warns about an insecure link", () => {
    expect(codes({
      compileMeta: meta({ links: [{ id: "a", position: 1, url: "http://a.cz", trackable: true, label: "A" }] }),
    })).toContain("precheck_insecure_link");
  });

  it("blocks a non public app url and names it in params", () => {
    for (const url of ["http://localhost:3000", "http://127.0.0.1", "http://192.168.1.10", "http://mail.local"]) {
      const result = preSendCheck(input({ appUrl: url }));
      expect(result.blocking, url).toBe(true);
      expect(result.findings.find((f) => f.code === "precheck_app_url_not_public")?.params?.app_url)
        .toBe(url);
    }
  });

  it("warns with numbers when a field is empty for more than ten percent of recipients", () => {
    const finding = preSendCheck(input({
      emptyFieldRatios: [{ path: "contact.first_name", empty: 412, total: 5000, hasDefault: false }],
    })).findings.find((f) => f.code === "precheck_empty_field_ratio");
    expect(finding?.severity).toBe("warning");
    expect(finding?.params).toEqual({ path: "contact.first_name", empty: 412, total: 5000, ratio: 0.0824 });
  });

  it("stays silent when the field has a fallback value", () => {
    expect(codes({
      emptyFieldRatios: [{ path: "contact.first_name", empty: 412, total: 5000, hasDefault: true }],
    })).not.toContain("precheck_empty_field_ratio");
  });

  it("forwards compile warnings as informational findings", () => {
    expect(codes({
      compileMeta: meta({ warnings: [{ code: "unknown_block_skipped", severity: "warning", pointer: "" }] }),
    })).toContain("unknown_block_skipped");
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm vitest run packages/core/templates/precheck.test.ts`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napiš implementaci**

`packages/core/templates/precheck.ts`:

```ts
import type { Issue } from "@mlain/emails/issue";
import type { CompileMeta } from "@mlain/emails/compile/types";

export type PreSendFinding = {
  code: string;
  severity: "error" | "warning" | "info";
  params?: Record<string, string | number>;
};

export type PreSendInput = {
  compileMeta: Pick<CompileMeta, "htmlBytes" | "links" | "assetIds" | "warnings" | "hasUnsubscribeLink">;
  validationIssues: Issue[];
  subject: string;
  preheader: string;
  appUrl: string;
  emptyFieldRatios: Array<{ path: string; empty: number; total: number; hasDefault: boolean }>;
};

export type PreSendResult = { blocking: boolean; findings: PreSendFinding[] };

const HTML_WARN_BYTES = 80 * 1024;
const HTML_ERROR_BYTES = 102 * 1024;

/** Loopback, privátní rozsahy a .local. Nejčastější chyba self-hosted instalace. */
function isPublicUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  const host = url.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".localhost")) return false;
  if (host === "127.0.0.1" || host === "::1" || host.startsWith("127.")) return false;
  if (/^10\./.test(host) || /^192\.168\./.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
  if (!host.includes(".")) return false;
  return true;
}

export function preSendCheck(input: PreSendInput): PreSendResult {
  const findings: PreSendFinding[] = [];

  if (input.validationIssues.some((issue) => issue.severity === "error")) {
    findings.push({
      code: "precheck_template_invalid", severity: "error",
      params: { count: input.validationIssues.filter((i) => i.severity === "error").length },
    });
  }
  if (!input.compileMeta.hasUnsubscribeLink) {
    findings.push({ code: "precheck_missing_unsubscribe", severity: "error" });
  }
  if (input.compileMeta.htmlBytes > HTML_ERROR_BYTES) {
    findings.push({
      code: "precheck_html_too_large", severity: "error",
      params: { bytes: input.compileMeta.htmlBytes },
    });
  } else if (input.compileMeta.htmlBytes > HTML_WARN_BYTES) {
    findings.push({
      code: "precheck_html_large", severity: "warning",
      params: { bytes: input.compileMeta.htmlBytes },
    });
  }
  if (input.subject.trim() === "") findings.push({ code: "precheck_subject_empty", severity: "error" });
  if (input.preheader.trim() === "") findings.push({ code: "precheck_preheader_empty", severity: "warning" });

  for (const link of input.compileMeta.links) {
    if (link.url.startsWith("http://")) {
      findings.push({ code: "precheck_insecure_link", severity: "warning", params: { url: link.url } });
    }
  }

  if (!isPublicUrl(input.appUrl)) {
    findings.push({
      code: "precheck_app_url_not_public", severity: "error", params: { app_url: input.appUrl },
    });
  }

  for (const ratio of input.emptyFieldRatios) {
    if (ratio.hasDefault || ratio.total === 0) continue;
    const value = ratio.empty / ratio.total;
    if (value <= 0.1) continue;
    findings.push({
      code: "precheck_empty_field_ratio", severity: "warning",
      params: {
        path: ratio.path, empty: ratio.empty, total: ratio.total,
        ratio: Math.round(value * 10_000) / 10_000,
      },
    });
  }

  for (const warning of input.compileMeta.warnings) {
    findings.push({ code: warning.code, severity: "warning", params: warning.params });
  }

  return { blocking: findings.some((finding) => finding.severity === "error"), findings };
}
```

- [ ] **Step 4: Spusť test a ověř, že projde**

Run: `pnpm vitest run packages/core/templates/precheck.test.ts`
Expected: PASS, 10 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/templates/precheck.ts packages/core/templates/precheck.test.ts
git commit -m "feat(templates): pre send check with blocking and advisory findings"
```

---

### Task 40: Dopad smazaného pole a job na převalidaci

**Files:**
- Create: `packages/core/templates/field-usage.ts`
- Create: `packages/core/templates/jobs/revalidate.ts`
- Test: `packages/core/templates/field-usage.db.test.ts`

Kritéria 34 a 36. Tohle je funkce, kterou část 3 **dodává** části 2: před smazáním kontaktního pole ji P07 zavolá a ukáže dopad. Po smazání zařadí job `content.revalidate_templates`, který šablony **jen označí**, nikdy je nemění.

**Job dostává `WorkspaceContext`, ne holé `workspaceId`.** Fronta běží mimo request, takže si transakci musí otevřít sama; bez kontextu by neměla čím nastavit `mlain.workspace_id` a všechny dotazy by pod RLS vrátily prázdno, aniž by cokoliv spadlo. Kontext pro systémového aktéra vyrábí P04, tenhle plán ho jen přebírá v payloadu úlohy.

- [ ] **Step 1: Napiš padající test**

`packages/core/templates/field-usage.db.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { FieldCatalog } from "@mlain/core/contacts/fields/catalog";
import { blockDefaults, DEFAULT_THEME } from "@mlain/emails/document/defaults";
import { withWorkspace } from "@mlain/core/tx";
import { seedWorkspaceForCoreTests } from "@mlain/core/identity/test-helpers";
import { createTemplate } from "./service.js";
import { findTemplatesUsingField } from "./field-usage.js";
import { revalidateTemplates } from "./jobs/revalidate.js";
import { findTemplateById } from "./repository.js";

const withCity: FieldCatalog = {
  version: "v1",
  fields: [{ path: "attr.city", type: "string", label: { en: "City" }, group: "custom", deleted: false }],
};
const withoutCity: FieldCatalog = { version: "v2", fields: [] };

const footer = { id: "b_000000000099", type: "footer", props: blockDefaults("footer") };

const design = {
  schemaVersion: 1,
  meta: { name: "T", previewText: "", language: "cs" },
  theme: DEFAULT_THEME,
  blocks: [{
    id: "b_000000000001", type: "section", props: blockDefaults("section"),
    children: [
      {
        id: "b_000000000002", type: "text",
        props: {
          ...blockDefaults("text"),
          content: [{ t: "p", children: [{ t: "var", expr: "contact.attr.city" }] }],
        },
      },
      footer,
    ],
  }],
};

const seed = async (fields: FieldCatalog = withCity) => {
  const ws = await seedWorkspaceForCoreTests();
  return { ws, ctx: { ctx: ws.ctx, workspaceId: ws.workspaceId, fields, userId: ws.userId } };
};

describe("field usage", () => {
  it("finds templates that use a field", async () => {
    const { ws, ctx } = await seed();
    await createTemplate(ctx, { name: "S městem", kind: "campaign", document: design });
    const found = await withWorkspace(ws.ctx, (tx) =>
      findTemplatesUsingField(tx, ws.workspaceId, "contact.attr.city"));
    expect(found.map((row) => row.name)).toEqual(["S městem"]);
  });

  it("returns nothing for a field nobody uses", async () => {
    const { ws, ctx } = await seed();
    await createTemplate(ctx, { name: "S městem", kind: "campaign", document: design });
    const found = await withWorkspace(ws.ctx, (tx) =>
      findTemplatesUsingField(tx, ws.workspaceId, "contact.attr.nic"));
    expect(found).toEqual([]);
  });

  it("marks templates invalid after the field disappears and leaves the design untouched", async () => {
    const { ws, ctx } = await seed();
    const row = await createTemplate(ctx, { name: "S městem", kind: "campaign", document: design });
    expect(row.validationState).toBe("valid");

    await revalidateTemplates({
      ctx: ws.ctx, workspaceId: ws.workspaceId, fieldPath: "contact.attr.city", fields: withoutCity,
    });

    const after = await withWorkspace(ws.ctx, (tx) => findTemplateById(tx, ws.workspaceId, row.id));
    expect(after!.validationState).toBe("invalid");
    expect(after!.design).toEqual(row.design);
    expect(JSON.stringify(after!.validationErrors)).toContain("liquid_unknown_field");
  });

  it("does not touch templates that do not use the field", async () => {
    const { ws, ctx } = await seed();
    const other = await createTemplate(ctx, {
      name: "Bez města", kind: "campaign",
      document: { ...design, blocks: [{ ...design.blocks[0]!, children: [footer] }] },
    });
    await revalidateTemplates({
      ctx: ws.ctx, workspaceId: ws.workspaceId, fieldPath: "contact.attr.city", fields: withoutCity,
    });
    const after = await withWorkspace(ws.ctx, (tx) => findTemplateById(tx, ws.workspaceId, other.id));
    expect(after!.validationState).toBe("valid");
  });

  it("never reaches across workspaces", async () => {
    const a = await seed();
    await createTemplate(a.ctx, { name: "S městem", kind: "campaign", document: design });
    const b = await seed();
    const result = await revalidateTemplates({
      ctx: b.ws.ctx, workspaceId: b.ws.workspaceId, fieldPath: "contact.attr.city", fields: withoutCity,
    });
    expect(result.marked).toBe(0);
    const untouched = await withWorkspace(a.ws.ctx, (tx) =>
      findTemplatesUsingField(tx, a.ws.workspaceId, "contact.attr.city"));
    expect(untouched).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm vitest run packages/core/templates/field-usage.db.test.ts`
Expected: FAIL, moduly neexistují.

- [ ] **Step 3: Napiš `packages/core/templates/field-usage.ts`**

```ts
import type { Tx } from "@mlain/core/tx";
import { findTemplateIdsUsingField } from "./repository.js";

/**
 * Dodává se části 2 (požadavek R2 obráceně). Před smazáním kontaktního pole
 * ukáže P07 uživateli, kolik šablon ho používá; to číslo musí odpovídat skutečnosti,
 * proto se čte z denormalizace `used_fields`, kterou plní každé uložení šablony
 * VČETNĚ prvního, viz Task 35 krok 3.
 */
export async function findTemplatesUsingField(
  tx: Tx, workspaceId: string, path: string,
): Promise<Array<{ id: string; name: string }>> {
  return findTemplateIdsUsingField(tx, workspaceId, path);
}
```

- [ ] **Step 4: Napiš `packages/core/templates/jobs/revalidate.ts`**

```ts
import type { FieldCatalog } from "@mlain/core/contacts/fields/catalog";
import type { WorkspaceContext } from "@mlain/db";
import { withWorkspace } from "@mlain/core/tx";
import type { Document } from "@mlain/emails/document/types";
import { assetIdsInDocument, loadAssetRefs } from "../assets.js";
import { findTemplateById, findTemplateIdsUsingField, setValidationState } from "../repository.js";
import { validateTemplateDocument } from "../validate.js";

export type RevalidateInput = {
  /**
   * Kontext projektu pro systémového aktéra. Job běží mimo request, takže
   * si transakci otevírá sám. Bez kontextu by RLS nedostala `mlain.workspace_id`,
   * všechny dotazy by vrátily prázdno a job by tiše označil nula šablon.
   */
  ctx: WorkspaceContext;
  workspaceId: string;
  fieldPath: string;
  fields: FieldCatalog;
};

/**
 * Handler fronty `content.revalidate_templates`. Šablony se **nemění**, jen se označí.
 * Oprava je rozhodnutí člověka: „pošli to bez toho pole" nikdo nesmí udělat za něj.
 *
 * Každá šablona má vlastní transakci schválně: jedna rozbitá šablona nesmí
 * shodit označení všech ostatních a fronta smí job kdykoliv zopakovat.
 */
export async function revalidateTemplates(input: RevalidateInput): Promise<{ marked: number }> {
  const affected = await withWorkspace(input.ctx, (tx) =>
    findTemplateIdsUsingField(tx, input.workspaceId, input.fieldPath));

  let marked = 0;
  for (const candidate of affected) {
    const state = await withWorkspace(input.ctx, async (tx) => {
      const row = await findTemplateById(tx, input.workspaceId, candidate.id);
      if (!row) return null;
      const document = row.design as Document;
      const assets = await loadAssetRefs(tx, input.workspaceId, assetIdsInDocument(document));
      const result = validateTemplateDocument(document, {
        templateKind: row.kind,
        fields: input.fields,
        assetIds: new Set(Object.keys(assets)),
      });
      await setValidationState(tx, input.workspaceId, candidate.id, result.state, result.issues);
      return result.state;
    });
    if (state === "invalid") marked += 1;
  }
  return { marked };
}
```

- [ ] **Step 5: Spusť test a ověř, že projde**

Run: `pnpm vitest run packages/core/templates/field-usage.db.test.ts`
Expected: PASS, 5 testů.

- [ ] **Step 6: Commit**

```bash
git add packages/core/templates/field-usage.ts packages/core/templates/jobs packages/core/templates/field-usage.db.test.ts
git commit -m "feat(templates): field impact analysis and revalidation job"
```

---

### Task 41: Export a import šablony

**Files:**
- Create: `packages/core/templates/transfer.ts`
- Test: `packages/core/templates/transfer.db.test.ts`

Import **nikdy** nepřebírá `id` bloků z cizího projektu jako pravdu, ale ověří jejich jednoznačnost a případně přegeneruje. Chybějící asset se nahradí zástupným obrázkem a import skončí jako `completed_with_warnings`.

- [ ] **Step 1: Napiš padající test**

`packages/core/templates/transfer.db.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { FieldCatalog } from "@mlain/core/contacts/fields/catalog";
import { blockDefaults, DEFAULT_THEME } from "@mlain/emails/document/defaults";
import { seedWorkspaceForCoreTests } from "@mlain/core/identity/test-helpers";
import { createTemplate } from "./service.js";
import { seedAssetForCoreTests } from "./test-fixtures.js";
import { exportTemplate, importTemplate } from "./transfer.js";

const fields: FieldCatalog = { version: "v1", fields: [] };
const footer = { id: "b_000000000099", type: "footer", props: blockDefaults("footer") };
const design = {
  schemaVersion: 1,
  meta: { name: "T", previewText: "", language: "cs" },
  theme: DEFAULT_THEME,
  blocks: [{ id: "b_000000000001", type: "section", props: blockDefaults("section"), children: [footer] }],
};

const seed = async () => {
  const ws = await seedWorkspaceForCoreTests();
  return { ws, ctx: { ctx: ws.ctx, workspaceId: ws.workspaceId, fields, userId: ws.userId } };
};

describe("template transfer", () => {
  it("exports a self describing envelope", async () => {
    const { ctx } = await seed();
    const row = await createTemplate(ctx, { name: "A", kind: "campaign", document: design });
    const file = await exportTemplate(ctx, row.id);
    expect(file.format).toBe("mlain-template");
    expect(file.version).toBe(1);
    expect(file.document.schemaVersion).toBe(1);
  });

  it("exports the original file name, not the public identifier", async () => {
    const { ws, ctx } = await seed();
    const asset = await seedAssetForCoreTests(ws);
    const withImage = {
      ...design,
      blocks: [{
        id: "b_000000000001", type: "section", props: blockDefaults("section"),
        children: [
          { id: "b_000000000002", type: "image", props: { ...blockDefaults("image"), assetId: asset.id, alt: "X" } },
          footer,
        ],
      }],
    };
    const row = await createTemplate(ctx, { name: "S obrázkem", kind: "campaign", document: withImage });
    const file = await exportTemplate(ctx, row.id);
    // Dřív se sem psalo `publicId`, tedy dvaadvacetiznakový identifikátor
    // v poli, které slibuje jméno souboru.
    expect(file.assets[0]!.filename).toBe("banner.png");
    expect(file.assets[0]!.filename).not.toBe(asset.publicId);
  });

  it("imports the envelope back into another workspace", async () => {
    const source = await seed();
    const target = await seed();
    const row = await createTemplate(source.ctx, { name: "A", kind: "campaign", document: design });
    const file = await exportTemplate(source.ctx, row.id);
    const result = await importTemplate(target.ctx, file, { name: "Import" });
    expect(result.status).toBe("completed");
    expect(result.template.name).toBe("Import");
  });

  it("regenerates duplicate block ids instead of trusting the file", async () => {
    const { ctx } = await seed();
    const broken = {
      format: "mlain-template" as const, version: 1 as const, assets: [],
      document: {
        ...design,
        blocks: [
          { id: "b_000000000001", type: "section", props: blockDefaults("section"), children: [footer] },
          { id: "b_000000000001", type: "section", props: blockDefaults("section"), children: [] },
        ],
      },
    };
    const result = await importTemplate(ctx, broken, { name: "Import" });
    const ids = JSON.stringify(result.template.design).match(/"b_[0-9a-z]{12}"/g) ?? [];
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("finishes with warnings when an asset is missing", async () => {
    const { ctx } = await seed();
    const withImage = {
      format: "mlain-template" as const, version: 1 as const, assets: [],
      document: {
        ...design,
        blocks: [{
          id: "b_000000000001", type: "section", props: blockDefaults("section"),
          children: [
            {
              id: "b_000000000002", type: "image",
              props: { ...blockDefaults("image"), assetId: "0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6099", alt: "X" },
            },
            footer,
          ],
        }],
      },
    };
    const result = await importTemplate(ctx, withImage, { name: "Import" });
    expect(result.status).toBe("completed_with_warnings");
    expect(result.warnings.map((w) => w.code)).toContain("template_import_asset_missing");
  });

  it("rejects a file that is not our format", async () => {
    const { ctx } = await seed();
    await expect(importTemplate(
      ctx,
      { format: "other", version: 1, document: design, assets: [] } as never,
      { name: "X" },
    )).rejects.toThrow("template_import_format_invalid");
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm vitest run packages/core/templates/transfer.db.test.ts`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napiš implementaci**

`packages/core/templates/transfer.ts`:

```ts
import type { Issue } from "@mlain/emails/issue";
import { withWorkspace } from "@mlain/core/tx";
import { isBlockId, newBlockId } from "@mlain/emails/document/ids";
import { loadDocument } from "@mlain/emails/document/migrate";
import type { Document } from "@mlain/emails/document/types";
import { assetIdsInDocument, loadAssetRefs } from "./assets.js";
import { findTemplateById, type TemplateRow } from "./repository.js";
import { createTemplate, type ServiceContext } from "./service.js";

export type TemplateFile = {
  format: "mlain-template";
  version: 1;
  document: Document;
  assets: Array<{ id: string; filename: string; mimeType: string; base64?: string; url?: string }>;
};

export type ImportResult = {
  status: "completed" | "completed_with_warnings";
  template: TemplateRow;
  warnings: Issue[];
};

export async function exportTemplate(
  ctx: ServiceContext, templateId: string,
): Promise<TemplateFile> {
  return withWorkspace(ctx.ctx, async (tx) => {
    const row = await findTemplateById(tx, ctx.workspaceId, templateId);
    if (!row) throw new Error("not_found");
    const document = row.design as Document;
    const assets = await loadAssetRefs(tx, ctx.workspaceId, assetIdsInDocument(document));
    return {
      format: "mlain-template" as const,
      version: 1 as const,
      document,
      // Obsah obrázků doplní vrstva assetů; tady se exportují metadata a jméno.
      // `originalFilename` je v `assets` NOT NULL, takže tu není co dohánět;
      // dřívější `publicId` vydávalo dvaadvacetiznakový identifikátor v poli,
      // které slibuje jméno souboru, a příjemce importu z něj nepoznal nic.
      assets: Object.values(assets).map((asset) => ({
        id: asset.id,
        filename: asset.originalFilename,
        mimeType: asset.mimeType,
      })),
    };
  });
}

/** Přegeneruje ID, která nejsou platná nebo se opakují. Cizí ID nikdy nebereme jako pravdu. */
function normalizeBlockIds(document: Document): Document {
  const seen = new Set<string>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (node === null || typeof node !== "object") return;
    const block = node as { id?: unknown; children?: unknown };
    if (typeof block.id === "string") {
      if (!isBlockId(block.id) || seen.has(block.id)) block.id = newBlockId();
      seen.add(block.id as string);
    }
    for (const value of Object.values(node)) visit(value);
  };
  const copy = structuredClone(document);
  visit(copy.blocks);
  return copy;
}

export async function importTemplate(
  ctx: ServiceContext,
  file: TemplateFile,
  options: { name: string },
): Promise<ImportResult> {
  if (file?.format !== "mlain-template" || file.version !== 1) {
    throw new Error("template_import_format_invalid");
  }
  const migrated = loadDocument(file.document);
  const document = normalizeBlockIds(migrated);

  const warnings: Issue[] = [];
  const referenced = assetIdsInDocument(document);
  const present = await withWorkspace(ctx.ctx, (tx) =>
    loadAssetRefs(tx, ctx.workspaceId, referenced));
  for (const assetId of referenced) {
    if (present[assetId]) continue;
    warnings.push({
      code: "template_import_asset_missing", severity: "warning", pointer: "",
      params: { assetId },
    });
  }

  const template = await createTemplate(ctx, {
    name: options.name, kind: "campaign", document,
  });

  return {
    status: warnings.length > 0 ? "completed_with_warnings" : "completed",
    template,
    warnings,
  };
}
```

- [ ] **Step 4: Spusť test a ověř, že projde**

Run: `pnpm vitest run packages/core/templates/transfer.db.test.ts`
Expected: PASS, 6 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/templates/transfer.ts packages/core/templates/transfer.db.test.ts
git commit -m "feat(templates): export and import with id regeneration"
```

---

## Fáze H: endpointy

### Task 42: Router `/api/v1/templates`

**Files:**
- Create: `apps/web/src/server/routes/templates.router.ts`
- Test: `apps/web/test/routes/templates.router.test.ts`

Konvence API vlastní **P04**: obálka chyb RFC 9457, kurzorové stránkování, `Idempotency-Key`, autorizace přes scope. Tenhle router je používá, nedefinuje. Klíče v JSON těle jsou `snake_case`, cesty `kebab-case`.

**`openapi.json` se nikdy neslučuje ručně.** Při konfliktu se obě verze zahodí a přegeneruje se.

- [ ] **Step 1: Napiš padající test**

`apps/web/test/routes/templates.router.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createTestApp, testWorkspace } from "../helpers/app.js";

const design = {
  schemaVersion: 1,
  meta: { name: "T", previewText: "", language: "cs" },
  theme: {
    contentWidth: 600, canvasBackground: "surface.canvas", contentBackground: "surface.content",
    colors: {}, fonts: { heading: "system", body: "system" },
    typography: { baseFontSize: 16, baseLineHeight: 1.5, headingScale: 1.25 },
    radius: 6, darkMode: { strategy: "auto", colors: {} },
  },
  blocks: [{
    id: "b_000000000001", type: "section",
    props: {
      backgroundColor: null, outerBackgroundColor: null, backgroundImageAssetId: null,
      backgroundPosition: "center", padding: { top: 24, right: 24, bottom: 24, left: 24 },
      fullWidth: false, roundedTop: false, roundedBottom: false,
    },
    children: [],
  }],
};

describe("templates router", () => {
  it("creates a template and returns snake_case keys", async () => {
    const app = await createTestApp();
    const response = await app.request("/api/v1/templates", {
      method: "POST",
      headers: { "content-type": "application/json", ...testWorkspace() },
      body: JSON.stringify({ name: "První", kind: "campaign", document: design }),
    });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body).toMatchObject({ name: "První", validation_state: expect.any(String) });
    expect(body).toHaveProperty("schema_version", 1);
  });

  it("rejects an invalid document with 422 and per block errors", async () => {
    const app = await createTestApp();
    const response = await app.request("/api/v1/templates", {
      method: "POST",
      headers: { "content-type": "application/json", ...testWorkspace() },
      body: JSON.stringify({ name: "Rozbitá", document: { ...design, blocks: [{ id: "bad" }] } }),
    });
    expect(response.status).toBe(422);
    const body = await response.json();
    expect(body.code).toBe("template_document_invalid");
    expect(body.errors[0]).toHaveProperty("path");
  });

  it("rejects a document with more than three hundred blocks with 413", async () => {
    const app = await createTestApp();
    const many = {
      ...design,
      blocks: Array.from({ length: 40 }, (_, i) => ({
        ...design.blocks[0]!,
        id: `b_a${String(i).padStart(11, "0")}`,
        children: Array.from({ length: 8 }, (_, j) => ({
          id: `b_b${String(i).padStart(5, "0")}${String(j).padStart(6, "0")}`,
          type: "spacer",
          props: { padding: { top: 0, right: 24, bottom: 16, left: 24 }, backgroundColor: null, hideOnMobile: false, height: 24, heightMobile: null },
        })),
      })),
    };
    const response = await app.request("/api/v1/templates", {
      method: "POST",
      headers: { "content-type": "application/json", ...testWorkspace() },
      body: JSON.stringify({ name: "Moc bloků", document: many }),
    });
    expect(response.status).toBe(413);
    expect((await response.json()).code).toBe("content_too_many_blocks");
  });

  it("returns 412 when the design hash does not match", async () => {
    const app = await createTestApp();
    const created = await (await app.request("/api/v1/templates", {
      method: "POST",
      headers: { "content-type": "application/json", ...testWorkspace() },
      body: JSON.stringify({ name: "A", document: design }),
    })).json();
    const response = await app.request(`/api/v1/templates/${created.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", ...testWorkspace() },
      body: JSON.stringify({ design, if_design_hash: "00".repeat(32) }),
    });
    expect(response.status).toBe(412);
  });

  it("returns 404 for a template of another workspace, never 403", async () => {
    const app = await createTestApp();
    const created = await (await app.request("/api/v1/templates", {
      method: "POST",
      headers: { "content-type": "application/json", ...testWorkspace("ws-a") },
      body: JSON.stringify({ name: "A", document: design }),
    })).json();
    const response = await app.request(`/api/v1/templates/${created.id}`, {
      headers: testWorkspace("ws-b"),
    });
    expect(response.status).toBe(404);
  });

  it("returns 409 when deleting a starter template", async () => {
    const app = await createTestApp({ seedStarter: true });
    const list = await (await app.request("/api/v1/templates", { headers: testWorkspace() })).json();
    const starter = list.items.find((item: { starter: boolean }) => item.starter);
    const response = await app.request(`/api/v1/templates/${starter.id}`, {
      method: "DELETE", headers: testWorkspace(),
    });
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("template_starter_immutable");
  });

  it("compiles without storing anything", async () => {
    const app = await createTestApp();
    const created = await (await app.request("/api/v1/templates", {
      method: "POST",
      headers: { "content-type": "application/json", ...testWorkspace() },
      body: JSON.stringify({ name: "A", document: design }),
    })).json();
    const response = await app.request(`/api/v1/templates/${created.id}/compile`, {
      method: "POST", headers: { "content-type": "application/json", ...testWorkspace() },
      body: JSON.stringify({}),
    });
    const body = await response.json();
    expect(body.html).toContain("<!DOCTYPE html>");
    expect(body.meta.contract_version).toBe(1);
  });

  it("returns findings from the validate endpoint with a success status when they are warnings", async () => {
    const app = await createTestApp();
    const created = await (await app.request("/api/v1/templates", {
      method: "POST",
      headers: { "content-type": "application/json", ...testWorkspace() },
      body: JSON.stringify({ name: "A", document: design }),
    })).json();
    const response = await app.request(`/api/v1/templates/${created.id}/validate`, {
      method: "POST", headers: { "content-type": "application/json", ...testWorkspace() },
      body: JSON.stringify({}),
    });
    expect([200, 409]).toContain(response.status);
    expect(await response.json()).toHaveProperty("findings");
  });

  it("lists templates using a field", async () => {
    const app = await createTestApp();
    const response = await app.request("/api/v1/templates/field-usage?field=contact.attr.city", {
      headers: testWorkspace(),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty("items");
  });

  it("returns 409, not 500, when a name collides", async () => {
    const app = await createTestApp();
    const create = () => app.request("/api/v1/templates", {
      method: "POST",
      headers: { "content-type": "application/json", ...testWorkspace() },
      body: JSON.stringify({ name: "Stejné jméno", document: design }),
    });
    expect((await create()).status).toBe(201);
    const second = await create();
    // Bez čtení SQLSTATE z `error.cause.code` by tahle větev nikdy neproběhla
    // a uživatel by za vlastní překlep dostal 500.
    expect(second.status).toBe(409);
    expect((await second.json()).code).toBe("template_name_conflict");
  });

  it("returns 422 for a malformed if_design_hash, not 412", async () => {
    const app = await createTestApp();
    const created = await (await app.request("/api/v1/templates", {
      method: "POST",
      headers: { "content-type": "application/json", ...testWorkspace() },
      body: JSON.stringify({ name: "A", document: design }),
    })).json();
    for (const bad of ["", "abc", "zz".repeat(32), "a".repeat(63)]) {
      const response = await app.request(`/api/v1/templates/${created.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json", ...testWorkspace() },
        body: JSON.stringify({ design, if_design_hash: bad }),
      });
      // 412 by znamenalo „změnil to někdo jiný", což je nepravda: klient
      // poslal nesmysl a musí se to dozvědět.
      expect(response.status, bad).toBe(422);
    }
  });

  it("exposes the current version id and the design hash", async () => {
    const app = await createTestApp();
    const created = await (await app.request("/api/v1/templates", {
      method: "POST",
      headers: { "content-type": "application/json", ...testWorkspace() },
      body: JSON.stringify({ name: "A", document: design }),
    })).json();
    await app.request(`/api/v1/templates/${created.id}/versions`, {
      method: "POST", headers: { "content-type": "application/json", ...testWorkspace() },
      body: JSON.stringify({ label: "první" }),
    });
    const body = await (await app.request(`/api/v1/templates/${created.id}`, {
      headers: testWorkspace(),
    })).json();
    expect(body.current_version_id).toBeTypeOf("string");
    expect(body.design_hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm vitest run apps/web/test/routes/templates.router.test.ts`
Expected: FAIL, router neexistuje.

- [ ] **Step 3: Napiš implementaci**

`apps/web/src/server/routes/templates.router.ts`:

```ts
import { Hono } from "hono";
import { getFieldCatalog } from "@mlain/core/contacts/fields/catalog";
import { pgErrorCode, withWorkspace } from "@mlain/core/tx";
import {
  compileTemplate, createTemplate, createVersion, deleteTemplate, duplicateTemplate,
  exportTemplate, findTemplateById, findTemplatesUsingField, importTemplate, listTemplates,
  listVersions, preSendCheck, restoreTemplateVersion, saveDesign, validateTemplateDocument,
  type ServiceContext,
} from "@mlain/core/templates";
import { sampleRenderData } from "@mlain/emails/preview-data";
import type { AppEnv } from "../../lib/api/types.js";
import { problem, requireScope, sendJson } from "../../lib/api/index.js";

export const templatesRouter = new Hono<AppEnv>();

type Ctx = Parameters<Parameters<typeof templatesRouter.get>[1]>[0];

/** SHA-256 v hexu: 64 znaků, jen [0-9a-f]. */
const DESIGN_HASH_HEX = /^[0-9a-f]{64}$/i;

const serialize = (row: Awaited<ReturnType<typeof findTemplateById>>) => row && ({
  id: row.id,
  name: row.name,
  kind: row.kind,
  schema_version: row.schemaVersion,
  design: row.design,
  design_hash: row.designHash.toString("hex"),
  validation_state: row.validationState,
  validation_errors: row.validationErrors,
  // Sloupec plní `createVersion`, takže natvrdo null by zahodilo hodnotu,
  // kterou databáze má, a klient by nepoznal, na které verzi stojí.
  current_version_id: row.currentVersionId,
  used_fields: row.usedFields,
  // Náhled šablony nikdo v tomhle plánu nenastavuje, viz kapitola 40.
  // Sloupec existuje, hodnota je zatím vždy prázdná a je to vědomé.
  thumbnail_asset_id: row.thumbnailAssetId,
  starter: row.starter,
  created_at: row.createdAt.toISOString(),
  updated_at: row.updatedAt.toISOString(),
});

/**
 * Doménová služba si transakci otevírá sama, proto sem chodí `WorkspaceContext`,
 * ne otevřená transakce. Katalog polí je jediné, co se musí načíst dopředu:
 * potřebuje ho skoro každá cesta a P07 si ho cachuje podle `version`.
 */
async function serviceContext(c: Ctx): Promise<ServiceContext> {
  const ctx = c.get("workspaceContext");
  return {
    ctx,
    workspaceId: ctx.workspaceId,
    userId: c.get("userId"),
    fields: await getFieldCatalog(ctx),
  };
}

templatesRouter.get("/", requireScope("templates:read"), async (c) => {
  const ctx = c.get("workspaceContext");
  const page = await withWorkspace(ctx, (tx) => listTemplates(tx, ctx.workspaceId, {
    limit: Number(c.req.query("limit") ?? 25),
    cursor: c.req.query("cursor") ?? undefined,
    kind: c.req.query("kind") as never,
    validationState: c.req.query("validation_state"),
  }));
  return sendJson(c, 200, { items: page.items.map(serialize), next_cursor: page.nextCursor });
});

// Pozor na pořadí: statická cesta musí být registrovaná dřív než /:template_id,
// jinak by ji Hono chytila jako identifikátor.
templatesRouter.get("/field-usage", requireScope("templates:read"), async (c) => {
  const field = c.req.query("field");
  if (!field) return problem(c, 422, "validation_failed", "Query parameter `field` is required.");
  const ctx = c.get("workspaceContext");
  const items = await withWorkspace(ctx, (tx) => findTemplatesUsingField(tx, ctx.workspaceId, field));
  return sendJson(c, 200, { items });
});

templatesRouter.post("/import", requireScope("templates:write"), async (c) => {
  const body = await c.req.json();
  try {
    const result = await importTemplate(await serviceContext(c), body.file, { name: body.name });
    return sendJson(c, 201, {
      status: result.status,
      template: serialize(result.template),
      warnings: result.warnings,
    });
  } catch (error) {
    return mapError(c, error);
  }
});

templatesRouter.post("/", requireScope("templates:write"), async (c) => {
  const body = await c.req.json();
  try {
    const row = await createTemplate(await serviceContext(c), {
      name: body.name,
      kind: body.kind,
      ...(body.document ? { document: body.document } : { baseTemplate: body.base_template }),
    });
    if (row.validationState === "invalid") {
      const blocking = (row.validationErrors as Array<{ code: string; severity: string; path?: string }>)
        .filter((issue) => issue.severity === "error");
      const tooMany = blocking.find((issue) => issue.code === "content_too_many_blocks");
      if (tooMany) return problem(c, 413, "content_too_many_blocks", "Too many blocks.", blocking);
      return problem(c, 422, "template_document_invalid", "The document is not valid.", blocking);
    }
    return sendJson(c, 201, serialize(row));
  } catch (error) {
    return mapError(c, error);
  }
});

templatesRouter.get("/:template_id", requireScope("templates:read"), async (c) => {
  const ctx = c.get("workspaceContext");
  const row = await withWorkspace(ctx, (tx) =>
    findTemplateById(tx, ctx.workspaceId, c.req.param("template_id")));
  if (!row) return problem(c, 404, "not_found", "Template not found.");
  return sendJson(c, 200, serialize(row));
});

templatesRouter.patch("/:template_id", requireScope("templates:write"), async (c) => {
  const body = await c.req.json();
  // Délku hashe kontrolujeme tady, ne až u porovnání bufferů. Hodnota chodí
  // z těla requestu, takže `Buffer.from(x, "hex")` z rozbitého vstupu udělá
  // kratší buffer, `.equals()` na něm vrátí false a klient by dostal 412
  // „změnil to někdo jiný" místo pravdivého „poslal jsi nesmysl".
  if (body.if_design_hash !== undefined && !DESIGN_HASH_HEX.test(String(body.if_design_hash))) {
    return problem(c, 422, "validation_failed", "`if_design_hash` must be 64 hex characters.");
  }
  try {
    const result = await saveDesign(
      await serviceContext(c), c.req.param("template_id"), body.design,
      body.if_design_hash ? Buffer.from(body.if_design_hash, "hex") : undefined,
    );
    return sendJson(c, 200, serialize(result.row));
  } catch (error) {
    return mapError(c, error);
  }
});

templatesRouter.delete("/:template_id", requireScope("templates:write"), async (c) => {
  try {
    await deleteTemplate(await serviceContext(c), c.req.param("template_id"));
    return c.body(null, 204);
  } catch (error) {
    return mapError(c, error);
  }
});

templatesRouter.post("/:template_id/duplicate", requireScope("templates:write"), async (c) => {
  try {
    const row = await duplicateTemplate(await serviceContext(c), c.req.param("template_id"));
    return sendJson(c, 201, serialize(row));
  } catch (error) {
    return mapError(c, error);
  }
});

templatesRouter.post("/:template_id/validate", requireScope("templates:read"), async (c) => {
  const service = await serviceContext(c);
  const row = await withWorkspace(service.ctx, (tx) =>
    findTemplateById(tx, service.workspaceId, c.req.param("template_id")));
  if (!row) return problem(c, 404, "not_found", "Template not found.");
  const compiled = await compileTemplate({
    ctx: service.ctx, workspaceId: service.workspaceId, document: row.design as never,
    templateKind: row.kind, fields: service.fields, language: c.get("language"),
    assetBaseUrl: c.get("assetBaseUrl"), purpose: "preview", trackOpens: false, trackClicks: false,
  });
  const validation = validateTemplateDocument(row.design, {
    templateKind: row.kind, fields: service.fields, assetIds: new Set(),
  });
  const check = preSendCheck({
    compileMeta: compiled.ok
      ? compiled.meta
      : { htmlBytes: 0, links: [], assetIds: [], warnings: [], hasUnsubscribeLink: false },
    validationIssues: validation.issues,
    subject: c.req.query("subject") ?? "placeholder",
    preheader: (row.design as { meta: { previewText: string } }).meta.previewText,
    appUrl: c.get("appUrl"),
    emptyFieldRatios: [],
  });
  // 4xx jen tehdy, když je mezi nálezy aspoň jeden se severity error.
  return sendJson(c, check.blocking ? 409 : 200, { findings: check.findings });
});

templatesRouter.post("/:template_id/compile", requireScope("templates:read"), async (c) => {
  const service = await serviceContext(c);
  const row = await withWorkspace(service.ctx, (tx) =>
    findTemplateById(tx, service.workspaceId, c.req.param("template_id")));
  if (!row) return problem(c, 404, "not_found", "Template not found.");
  const body = await c.req.json().catch(() => ({}));
  const result = await compileTemplate({
    ctx: service.ctx, workspaceId: service.workspaceId, document: row.design as never,
    templateKind: row.kind, fields: service.fields, language: c.get("language"),
    assetBaseUrl: c.get("assetBaseUrl"), purpose: "preview",
    campaignId: body.campaign_id, trackOpens: false, trackClicks: false,
  });
  if (!result.ok) {
    return problem(c, 422, "template_document_invalid", "The document cannot be compiled.", result.issues);
  }
  return sendJson(c, 200, {
    html: result.html,
    text: result.text,
    meta: {
      contract_version: result.meta.contractVersion,
      renderer_version: result.meta.rendererVersion,
      schema_version: result.meta.schemaVersion,
      used_paths: result.meta.usedPaths,
      render_schema: result.meta.renderSchema,
      links: result.meta.links,
      asset_ids: result.meta.assetIds,
      html_bytes: result.meta.htmlBytes,
      text_bytes: result.meta.textBytes,
      warnings: result.meta.warnings,
      has_unsubscribe_link: result.meta.hasUnsubscribeLink,
      click_marker_count: result.meta.clickMarkerCount,
      has_open_pixel_slot: result.meta.hasOpenPixelSlot,
    },
  });
});

templatesRouter.post("/:template_id/preview", requireScope("templates:read"), async (c) => {
  const service = await serviceContext(c);
  const row = await withWorkspace(service.ctx, (tx) =>
    findTemplateById(tx, service.workspaceId, c.req.param("template_id")));
  if (!row) return problem(c, 404, "not_found", "Template not found.");
  const body = await c.req.json().catch(() => ({}));
  const compiled = await compileTemplate({
    ctx: service.ctx, workspaceId: service.workspaceId, document: row.design as never,
    templateKind: row.kind, fields: service.fields, language: c.get("language"),
    assetBaseUrl: c.get("assetBaseUrl"), purpose: "preview", trackOpens: false, trackClicks: false,
  });
  if (!compiled.ok) {
    return problem(c, 422, "template_document_invalid", "The document cannot be compiled.", compiled.issues);
  }
  // Interpolace i příprava dat jsou v kontraktech, ne tady. Mapu `_present`
  // plní `prepareRenderData`, viz kapitola 0.6; kdyby ji náhled vynechal,
  // podmíněné bloky by v náhledu zmizely, ale v odeslaném mailu zůstaly.
  const data = body.render_data ?? sampleRenderData(c.get("language") === "cs" ? "cs" : "en");
  const rendered = await c.get("previewEngine").interpolate({
    html: compiled.html, text: compiled.text,
    renderSchema: compiled.meta.renderSchema, data,
  });
  return sendJson(c, 200, { html: rendered.html, text: rendered.text });
});

templatesRouter.get("/:template_id/versions", requireScope("templates:read"), async (c) => {
  const ctx = c.get("workspaceContext");
  const rows = await withWorkspace(ctx, (tx) =>
    listVersions(tx, ctx.workspaceId, c.req.param("template_id")));
  return sendJson(c, 200, {
    items: rows.map((row) => ({
      version: row.version, label: row.label, reason: row.reason,
      pinned: row.pinned, created_at: row.createdAt.toISOString(),
    })),
  });
});

templatesRouter.post("/:template_id/versions", requireScope("templates:write"), async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const ctx = c.get("workspaceContext");
  try {
    // Zámek řádku v `createVersion` platí jen uvnitř transakce, proto ji
    // otevírá router. Bez ní by `FOR UPDATE` nezamkl nic a dvě souběžná
    // uložení by vyrobila dvě verze se stejným číslem.
    const row = await withWorkspace(ctx, (tx) =>
      createVersion(tx, ctx.workspaceId, c.req.param("template_id"), {
        reason: "manual", label: body.label, createdBy: c.get("userId"),
      }));
    return sendJson(c, 201, { version: row.version, label: row.label });
  } catch (error) {
    return mapError(c, error);
  }
});

templatesRouter.post("/:template_id/versions/:version/restore", requireScope("templates:write"), async (c) => {
  try {
    // Transakci i výpočet `usedFields` dělá služba: potřebuje k tomu katalog
    // polí, a ten je doména P07, ne HTTP vrstva.
    const row = await restoreTemplateVersion(
      await serviceContext(c), c.req.param("template_id"), Number(c.req.param("version")),
    );
    return sendJson(c, 201, { version: row.version, label: row.label });
  } catch (error) {
    return mapError(c, error);
  }
});

templatesRouter.get("/:template_id/export", requireScope("templates:read"), async (c) => {
  try {
    const file = await exportTemplate(await serviceContext(c), c.req.param("template_id"));
    return sendJson(c, 200, file);
  } catch (error) {
    return mapError(c, error);
  }
});

/**
 * Doménové chyby chodí jako `Error` s kódem ve zprávě, chyby databáze jako
 * `DrizzleQueryError` se SQLSTATE na `error.cause.code`. Obojí musí skončit
 * jako 4xx, jinak uživatel dostane 500 za něco, co udělal sám.
 *
 * `pgErrorCode` prochází řetěz `cause`. Kdo by testoval `error.code` přímo,
 * testoval by `undefined` a tahle větev by se **nikdy neprovedla**.
 */
function mapError(c: Ctx, error: unknown) {
  const sqlstate = pgErrorCode(error);
  if (sqlstate === "23505") {
    return problem(c, 409, "template_name_conflict", "A template with this name already exists.");
  }
  if (sqlstate === "23514") {
    return problem(c, 422, "validation_failed", "The template violates a database constraint.");
  }
  const message = error instanceof Error ? error.message : String(error);
  switch (message) {
    case "not_found":
      return problem(c, 404, "not_found", "Template not found.");
    case "precondition_failed":
      return problem(c, 412, "precondition_failed", "The template was changed by someone else.");
    case "precondition_malformed":
      return problem(c, 422, "validation_failed", "`if_design_hash` must be 64 hex characters.");
    case "template_name_conflict":
      return problem(c, 409, "template_name_conflict", "A template with this name already exists.");
    case "template_starter_immutable":
      return problem(c, 409, "template_starter_immutable", "Shipped templates cannot be changed or deleted.");
    case "template_import_format_invalid":
      return problem(c, 422, "template_import_format_invalid", "The file is not a Mlain template export.");
    default:
      throw error;
  }
}
```

- [ ] **Step 4: Spusť test a ověř, že projde**

Run: `pnpm vitest run apps/web/test/routes/templates.router.test.ts`
Expected: PASS, 12 testů.

- [ ] **Step 5: Přegeneruj `openapi.json`**

Run: `pnpm turbo run contracts:generate`
Expected: `openapi.json` obsahuje všech patnáct cest `/api/v1/templates*`. Soubor se **nikdy neslučuje ručně**; při konfliktu se obě verze zahodí a přegeneruje se.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/server/routes/templates.router.ts apps/web/test/routes/templates.router.test.ts openapi.json
git commit -m "feat(templates): api endpoints for templates"
```

---

### Task 43: Kompletní ověření a dodávané šablony

**Files:**
- Create: `packages/emails/src/base/starters.ts`
- Test: `packages/emails/test/base/starters.test.ts`

Poslední úkol. Nejdřív pět dodávaných šablon, pak celá série kontrol.

- [ ] **Step 1: Napiš padající test**

`packages/emails/test/base/starters.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { checkStructure } from "../../src/document/semantic-structure.js";
import { validateDocumentSchema } from "../../src/document/schema.js";
import { buildStarterTemplates, STARTER_KEYS } from "../../src/base/starters.js";

describe("starter templates", () => {
  it("ships five templates", () => {
    expect(STARTER_KEYS).toHaveLength(5);
  });

  it("builds every starter in both shipped languages", () => {
    for (const language of ["cs", "en"] as const) {
      const templates = buildStarterTemplates(language);
      expect(Object.keys(templates), language).toHaveLength(5);
      for (const [key, entry] of Object.entries(templates)) {
        expect(validateDocumentSchema(entry.document), `${language}/${key}`).toEqual({ ok: true });
        const issues = checkStructure(entry.document, { templateKind: "campaign" });
        expect(issues.filter((i) => i.severity === "error"), `${language}/${key}`).toEqual([]);
      }
    }
  });

  it("gives every starter a name in the requested language", () => {
    expect(buildStarterTemplates("cs").newsletter.name).not
      .toBe(buildStarterTemplates("en").newsletter.name);
  });

  it("falls back to english for an unsupported language", () => {
    expect(buildStarterTemplates("sv-FI" as never).newsletter.name)
      .toBe(buildStarterTemplates("en").newsletter.name);
  });
});
```

- [ ] **Step 2: Napiš implementaci**

`packages/emails/src/base/starters.ts`:

```ts
import type { Document } from "../document/types.js";
import { buildBaseTemplate, type BaseTemplateParams } from "./build.js";

export const STARTER_KEYS = [
  "newsletter", "announcement", "transactional", "reengagement", "simple",
] as const;

export type StarterKey = (typeof STARTER_KEYS)[number];

const NAMES: Record<string, Record<StarterKey, string>> = {
  cs: {
    newsletter: "Newsletter",
    announcement: "Oznámení",
    transactional: "Potvrzení objednávky",
    reengagement: "Ještě vás to zajímá?",
    simple: "Jednoduchý dopis",
  },
  en: {
    newsletter: "Newsletter",
    announcement: "Announcement",
    transactional: "Order confirmation",
    reengagement: "Still interested?",
    simple: "Simple letter",
  },
};

const NEUTRAL_BRAND: BaseTemplateParams["brand"] = {
  palette: { primary: "#2563eb", background: "#f4f5f7", text: "#111827" },
  typography: { headingStack: "system", bodyStack: "system", radius: 6 },
};

/**
 * Pět předgenerovaných šablon s neutrální značkou. Vznikají při prvním vytvoření
 * projektu, ne za běhu, takže je novější renderer nikdy nepřepíše.
 */
export function buildStarterTemplates(
  language: string,
): Record<StarterKey, { name: string; document: Document }> {
  const base = language.split("-")[0]!.toLowerCase();
  const names = NAMES[base] ?? NAMES.en!;
  const build = (variant: BaseTemplateParams["variant"], sections: BaseTemplateParams["sections"]) =>
    buildBaseTemplate({ variant, brand: NEUTRAL_BRAND, language, darkMode: true, sections });

  return {
    newsletter: {
      name: names.newsletter,
      document: build("newsletter", [
        { kind: "hero", headline: names.newsletter, subhead: "" },
        { kind: "article", heading: "", body: "" },
        { kind: "article", heading: "", body: "" },
      ]),
    },
    announcement: {
      name: names.announcement,
      document: build("announcement", [
        { kind: "hero", headline: names.announcement },
        { kind: "feature", headline: "", body: "", cta: { label: "", href: "https://example.com" } },
      ]),
    },
    transactional: {
      name: names.transactional,
      document: build("transactional", [
        { kind: "hero", headline: names.transactional },
        { kind: "keyValue", rows: [{ label: "", value: "" }] },
      ]),
    },
    reengagement: {
      name: names.reengagement,
      document: build("reengagement", [{ kind: "hero", headline: names.reengagement }]),
    },
    simple: {
      name: names.simple,
      document: build("newsletter", [{ kind: "hero", headline: names.simple }]),
    },
  };
}
```

- [ ] **Step 3: Spusť test a ověř, že projde**

Run: `pnpm vitest run packages/emails/test/base/starters.test.ts`
Expected: PASS, 4 testy.

- [ ] **Step 4: Spusť kompletní sérii**

Bez ohledu na to, jak malá byla poslední změna. Všechno musí projít.

```bash
pnpm turbo run typecheck --filter=@mlain/emails --filter=@mlain/core --filter=web
pnpm turbo run lint --filter=@mlain/emails --filter=@mlain/core --filter=web
pnpm vitest run packages/emails
pnpm vitest run packages/core/templates
pnpm vitest run apps/web/test/routes/templates.router.test.ts
```

Expected: všechno zelené. Když něco padá, dohledej příčinu a oprav; snapshot **neaktualizuj**, dokud nevíš proč se změnil.

- [ ] **Step 5: Ověř tvrzení, která jde ověřit spuštěním**

Ověřování grepem nestačí. Ke každému tvrzení, které jde ověřit spuštěním, patří spuštění.

```bash
# 1. Ve výstupu nikdy nezůstane žádný vyhrazený žeton.
grep -RIl "ML_ARG_\|ML_RAW_" packages/emails/test/__fixtures__/expected/ && echo "CHYBA" || echo "OK"

# 2. Ve výstupu není HTML entita uvnitř Liquid konstrukce.
grep -RE "\{\{[^}]*&(quot|#39|lt|gt|amp);" packages/emails/test/__fixtures__/expected/ && echo "CHYBA" || echo "OK"

# 3. V žádném snapshotu není operátor porovnání v podmínce.
grep -RE "\{%[^%]*(&gt;|&lt;|>|<)[^%]*%\}" packages/emails/test/__fixtures__/expected/*.html && echo "CHYBA" || echo "OK"

# 4. Licenční brána: v balíčku není GPL, LGPL ani AGPL.
pnpm licenses list --filter=@mlain/emails --json | grep -iE '"(A|L)?GPL' && echo "CHYBA" || echo "OK"
```

Expected: čtyřikrát `OK`.

- [ ] **Step 6: Commit**

```bash
git add packages/emails/src/base/starters.ts packages/emails/test/base/starters.test.ts
git commit -m "feat(emails): five shipped starter templates"
```

---

## 39. Co tenhle plán vyžaduje od ostatních plánů

Každý řádek je konkrétní a měl by se vyřešit **před** spuštěním plánu, ne za běhu.

| # | Komu | Co | Proč to nejde odložit |
|---|---|---|---|
| R1 | **P13** (kampaně) | `campaign_links` plnit **z `CompileMeta.links`**, včetně `id` a `position` beze změny. `id` je UUIDv5 z `deriveLinkId(campaignId, position)`, `position` začíná od **1**. | Kdyby si P13 ID generovalo samo, klik zaznamenaný proti `link_id` ze značky by se v reportu započítal špatnému odkazu **a nikde by to nespadlo**. P13 už to přijal a bere ID i pozici doslova z metadat. |
| R2 | **P03** (databáze) | `campaign_links.id` nesmí spoléhat na výchozí `uuidv7()`; hodnotu vždy dodává kompilace. Buď výchozí hodnotu vynechat, nebo ji zdokumentovat jako nepoužívanou. | Tichý default je horší než chybějící sloupec: vloží se validní UUID, které jen neodpovídá tomu ve značce. |
| R3 | **P10** (tracking) | Přesný tvar náhrady pixelu je normativní v kontraktu 5: sender nahradí `<!--ML_OPEN_PIXEL-->` značkou `<img …>` nebo prázdným řetězcem. | Dvě různá znění téže náhrady znamenají, že se tracking rozejde s kompilací. |
| R4 | **P09** (sender) | Při neshodě počtu značek se kampaň pauzuje s `pause_reason.code = "render_failure_rate"`, respektive s kódem pauzy z registru části 1. `contract_mismatch` je **důvod v detailu**, ne kód pauzy. | Kód, který není v registru P01, nikam nedojde a UI ho neumí zobrazit. |
| R5 | **P02** (kontrakty) | **Splněno, ponecháno jako záznam.** `ML_RAW_` je v `RESERVED_MARKERS` a porovnává se bez ohledu na velikost písmen; `LQ-051` je přečíslovaná na `LQ-510`; kořen `_present` je v `COMPILED_ONLY_ROOTS`; druhou úroveň gramatiky dělá `validateLiquid` s `level: "compiled"`; instance LiquidJS jsou dvě, `createHtmlEngine()` a `createTextEngine()`. | Zbylo jediné, viz R13: úzký typ v `prepare-render-data.ts` se jmenuje `RenderSchema` stejně jako bohatý typ kontraktu 5. |
| R6 | vlastník assetového endpointu | Adresa `<ASSET_BASE_URL>/a/social/<network>-<style>@2x.png` musí servírovat statické PNG z `packages/emails/assets/social/`. Soubory dodává tenhle plán. | Ikony sítí jsou součást produktu, ne assety projektu, a externí CDN je závislost, kterou nemáme pod kontrolou. |
| R7 | **P04** (jádro API) | Kořenový router `/api/v1` musí mountovat `templatesRouter` z `apps/web/src/server/routes/templates.router.ts`. Kontext `AppEnv` musí nést **`workspaceContext`** (branded `WorkspaceContext`), ne jen `workspaceId`. | Doménový plán nesmí editovat sdílený soubor. A bez `workspaceContext` nejde otevřít transakci: `withWorkspace` bere kontext, ne řetězec, a továrna kontextu je vyhrazená `packages/core/identity`. |
| R8 | **P01** (kostra) | ESLint `import/no-restricted-paths` musí povolit hrany `packages/emails → packages/contracts`, `packages/emails → packages/core/contacts` (jen typ katalogu polí) a `packages/core → packages/emails`. | Graf závislostí v části 1, 3.11 hranu z `emails` neuvádí vůbec. Je to mezera, ne zákaz, ale bez řádku to CI zastaví. |
| R9 | **P07** (kontakty) | `getFieldCatalog(ctx: WorkspaceContext): Promise<FieldCatalog>` s polem `version` pro cache. `FieldCatalogEntry.path` je **bez** prefixu `contact.`. | Validace merge tagů běží při každém úhozu v editoru, proto cache na 60 sekund klíčovaná `workspace_id` a `version`. Zúžení na `LiquidRoots` si dělá tenhle plán sám (`packages/emails/src/paths.ts`), aby si ho P07 nemusel držet kvůli jedinému odběrateli. |
| R10 | **P13** (kampaně) | `preSendCheck` je součást toku odeslání a blokující nález odeslání **zastaví** (`409`). Kompilace před materializací publika **znovu** validuje proti aktuálnímu katalogu polí. | Jinak je předodesílací kontrola dekorace a kampaň s rozbitou šablonou odejde. |
| R11 | **P13** (kampaně) | Při materializaci publika **musí zavolat `prepareRenderData(raw, renderSchema)`** z `@mlain/contracts/liquid/prepare-render-data` a výsledek uložit jako `render_data`. | Kontrakt tu funkci jen definuje, volá ji až aplikace. Kdyby ji P13 vynechal, kořen `_present` v datech nebude, **každá podmínka se vyhodnotí jako nepravda a podmíněné bloky se v odeslaném mailu tiše skryjí**. Nespadne přitom nic: kompilace projde, odeslání projde, testy obou stran projdou. Viz kapitola 0.6. |
| R12 | **P13** (kampaně) | Při vytvoření předodesílací verze předat `createVersion` i `compiled: { html, text, meta, rendererVersion }`. | Jinak zůstanou `compiled_html`, `compiled_text`, `compile_meta` a `renderer_version` na `template_versions` **trvale NULL**. Tenhle plán je nevyplňuje, protože kompilovanou podobu drží kampaň, ne šablona. |
| R13 | **P02** (kontrakty) | Přejmenovat úzký typ `RenderSchema` v `packages/contracts/src/liquid/prepare-render-data.ts`, například na `PreparedDataSchema`. | Je to **totéž jméno pro dvě neslučitelné věci**, přesně jako dřív u `FieldCatalog` (rozhodnutí R2): kontrakt jím myslí `{ fields: string[]; presence: string[] }`, kontrakt 5 tohohle plánu bohatý tvar s typy polí a systémovými značkami. Do té doby to obchází `toPreparedSchema` z `packages/emails/src/paths.ts`, takže **tenhle plán blokovaný není**, ale první, kdo si spleta jméno, dostane buď chybu typu, nebo přetypování, které kontrolu ztratí. |

---

## 40. Soubory, které tenhle plán vlastní

Tohle je úplný seznam. **Mimo tyhle soubory plán nesahá**, ani na jeden řádek, ani „jen na import". Když je potřeba změna jinde, hlásí se to hlavnímu agentovi jako požadavek podle kapitoly 39.

### Vytváří a mění

```
packages/emails/                                (celý balíček, včetně package.json,
                                                 tsconfig.json, vitest.config.ts)
packages/emails/schema/document.v1.schema.json
packages/emails/src/{issue,paths,preview-data}.ts
packages/emails/src/document/{types,defaults,ids,canonical,schema,walk,migrate,
                              semantic,semantic-structure,semantic-fields}.ts
packages/emails/src/theme/{palette,resolve}.ts
packages/emails/src/normalize/{index,columns,slots}.ts
packages/emails/src/emitter/{ctx,raw,visibility,rich-text,shell}.tsx
packages/emails/src/emitter/{style,head-css,assets,inline-html,render}.ts
packages/emails/src/emitter/blocks/{frame,section,columns,dispatch,heading,text,image,
                                    button,divider,spacer,html-block,social,footer}.tsx
packages/emails/src/text/{wrap,emit}.ts
packages/emails/src/compile/{types,links,apply-slots,render-schema,invariants,compile}.ts
packages/emails/src/base/{brand,rich,build,starters}.ts
packages/emails/src/base/i18n/{cs,en}.json
packages/emails/src/compat/{caniemail.json,check.ts}
packages/emails/assets/social/*.png
packages/emails/scripts/write-ct-fixtures.ts
packages/emails/test/**                          (celý testovací strom balíčku)

packages/core/templates/{index,repository,assets,asset-references,validate,compile,
                         service,versions,field-usage,precheck,transfer}.ts
packages/core/templates/jobs/revalidate.ts
packages/core/templates/test-fixtures.ts
packages/core/templates/*.test.ts                (testy jsou u zdrojů, ne ve zvláštním stromu)

apps/web/src/server/routes/templates.router.ts
apps/web/test/routes/templates.router.test.ts

packages/contracts/fixtures/compiled/CT-001.json … CT-018.json
```

**Poslední řádek je jediná výjimka z pravidla „do cizího balíčku se nesahá"** a stojí na rozhodnutí **R3**: tvar fixtur a jejich runner vlastní P02, **data vlastní tenhle plán**, protože jako jediný má blokový model a renderer. Dokud si obě strany myslely, že je píše ta druhá, nenapsal by je nikdo. Do `packages/contracts/src/**` ani `packages/contracts/test/**` tenhle plán nesahá.

**Umístění v `packages/core`.** Domény jsou přímé podadresáře balíčku, tedy `packages/core/templates/`, **bez mezistupně `src/`**, a testy leží vedle zdrojů. Plyne to z mapy exportů, kterou vlastní P04: `@mlain/core/tx` se resolvuje na `packages/core/tx/index.ts`, takže `@mlain/core/templates` musí sedět na `packages/core/templates/index.ts`. Dřívější znění mělo `packages/core/src/templates/`, což by se přes wildcard export nenašlo. Napříč plány je v tomhle rozpor, vedený jako nález N42.

### Jen čte, nikdy nemění

```
packages/contracts/src/**        vlastní P02 (Liquid validátor, značky, schéma fixtur)
packages/contracts/fixtures/liquid/**  vlastní P02 (fixtures LQ-*)
packages/db/**                   vlastní P03 (schéma, migrace, RLS)
packages/core/tx/**              vlastní P04 (transakční adaptér, pgErrorCode)
packages/core/identity/**        vlastní P04 (kontext projektu, test-helpers)
packages/core/errors/registry.ts vlastní P01
packages/core/contacts/**        vlastní P07 (katalog polí)
packages/config/**               vlastní P01 (ESLint, tsconfig, vitest preset)
apps/web/src/lib/api/**          vlastní P04 (obálka chyb, stránkování, autorizace)
apps/web/src/server/routes/index.ts nebo ekvivalent kořenového routeru: vlastní P04
packages/i18n/**                 vlastní P05
turbo.json, docker/, .github/    vlastní P01
openapi.json                     generovaný soubor, nikdy se neslučuje ručně
```

### Co plán vědomě nevytváří

Editor šablon (P12), AI asistent a extrakce značky (P15), nahrávání a zpracování assetů, obrazovky, i18n namespace UI, materializace publika, `campaign_links`, sender.

**Náhled šablony (`templates.thumbnail_asset_id`)** tenhle plán nenastavuje. Sloupec existuje a API ho vydává, hodnota zůstane prázdná, dokud ho nezačne plnit vlastník assetů. Je to vědomé, ne opomenutí.

**Tabulku `content_snippets`** tenhle plán nečte ani nezapisuje. Dřívější znění ji zmiňovalo mezi tabulkami, „které jen čte", což nebyla pravda. Sdílené bloky patří editoru, viz nález N44.

---

## 41. Akceptační kritéria, která plán pokrývá

Čísla jsou z části 3, kapitola 8. Kritérium je „pokryté" jen tehdy, když na něj v plánu existuje test, který ho ověřuje spuštěním.

### Plně pokrytá

| Kapitola | Kritéria | Kde |
|---|---|---|
| 8.1 Blokový model | **1, 2, 3, 4, 5, 6, 7, 8, 8b, 8c, 8d** | Tasky 4, 6, 7, 9, 11, 13, 28 |
| 8.2 Renderer | **9, 10, 11, 12, 12b, 13, 14, 15, 16, 17, 17b, 17c, 18** | Tasky 14, 17, 19, 20, 21, 22, 27, 28, 32 |
| 8.3 Prostý text | **19, 19b, 19c, 20, 21, 22, 23** | Tasky 23, 24 |
| 8.4 Liquid | **28, 28b, 28c, 28d, 28e, 28f, 28g, 29, 32** | Tasky 9, 11, 12, 19, 27, 28, 33 |
| 8.5 Merge tagy | **33, 33b, 33c, 34, 36** | Tasky 26, 38, 40 |
| 8.7 Náhled | **45** | Task 39 |
| 8.8 Verzování | **46, 47, 50** | Task 37 |
| 8.12 Poštovní klienti | **74** | Task 34 |

### Sdílená s jiným plánem

| # | Co pokrývá tenhle plán | Kdo dopovídá zbytek |
|---|---|---|
| 24, 25, 26, 27, 30, 30b | Volání validátoru a propsání jeho hlášek do dokumentu s ukazatelem na blok | **P02**, který vlastní parser subsetu a fixtures `LQ-*` |
| 31 | Automatické escapování v HTML kontextu a jeho neexistence v textové části | **P09** (interpolace při odeslání), náhled v **P12** |
| 35 | `validateTemplateDocument` jako tvrdá brána a `compileTemplate`, která před kompilací znovu validuje | **P13**, který bránu zařadí do toku spuštění kampaně |
| 37, 38, 40 | Slot filtru `default` doplněný kompilací a invarianty, které zaručí, že se `{{` a `{%` nedostane příjemci | **P09**, který řídí chování za běhu |
| 41, 42 | Kompilace, kterou náhled i odeslání sdílejí, a vzorová data s nepříjemnými hodnotami | **P12** (iframe a režimy náhledu) |
| 48, 49 | Kopie dokumentu do kampaně a zámek obsahu | **P13**, který vlastní `campaigns.design` |
| 73, 75 | Golden snapshoty a linter kompatibility jako podklad | **P16** (ruční matice klientů, Playwright snímky) |

### Vědomě nepokrytá

51 až 56 (extrakce značky), 57 až 64 (assety), 65 až 72 (AI). Patří plánům **P15** a vlastníkovi assetů, viz kapitola 40.

---

## 42. Sebekontrola před předáním

Než plán prohlásíš za hotový, projdi tenhle seznam. Není to formalita, každá položka odpovídá chybě, která se v tomhle projektu už jednou stala.

- [ ] **Pokrytí specifikace.** Ke každé kapitole 2, 3.1, 3.2, 3.4, 3.5, 3.7, 3.8, 3.9, 3.10, 3.11 a 4 části 3 existuje úkol. Kapitoly 3.3 (editor), 3.6.5 (ruční matice), 3.12 a 3.13 (AI a značka) a 3.14 (assety) jsou vědomě mimo.
- [ ] **Žádný zástupný text.** V plánu není „TBD", „doplnit ošetření chyb", „podobně jako výše" ani odkaz na typ, který nikde nevzniká.
- [ ] **Typová soudržnost.** `VarInline.slots` je `{ default?, date? }` všude (Task 2, 6, 12, 16). `CompileContext` má `assets`, `preheader` a `currentYear` (Task 15) a používá je Task 28. `Issue` má `code`, `severity`, `pointer`, `path`, `params` a bydlí v `packages/emails/src/issue.ts`, protože kontrakty ho nemají.
- [ ] **Ani jeden import z kořene `@mlain/contracts`.** Kořenový export je zrušený, importuje se výhradně podcestou (`/markers`, `/liquid`, `/liquid/engine`, `/liquid/prepare-render-data`, `/compiled`). Ověř grepem, musí vyjít nula.
- [ ] **Ani jedno `db.transaction()` nebo `tx.transaction()`.** Vnořená transakce tiše potvrdí vnější, viz kapitola 0.7.
- [ ] **Ani jedno `error.code` u chyby databáze.** Vždy `pgErrorCode(error)`.
- [ ] **Pořadí kroků.** Argument filtru se dosazuje **až po** renderu (Task 28), nikdy dřív. Značky odkazů se přidělují **před** renderem, protože je potřebuje `linkHref`.
- [ ] **Ke každé ochraně existuje mechanismus, který její porušení zachytí automaticky.** Vyhrazené žetony hlídá pravidlo S16 i invarianty I9 a I12. Shodu slotů u VML dvojčete hlídá test v Tasku 19 a fixture `CT-017`. Odvození mobilních hodnot z motivu hlídají dokumenty 10, 11 a 12 v golden sadě.
- [ ] **Nic mimo vlastnictví.** Seznam v kapitole 40 sedí se seznamem `Files:` u všech 43 úkolů.

---

**Plán je hotový. Fáze 2 podle řídicího dokumentu není volitelná: pusť na něj `/replan:replan` a uprav ho podle nálezů, než se začne provádět.**


















