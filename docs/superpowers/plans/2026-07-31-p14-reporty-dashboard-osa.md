# P14 Reporty, dashboard a časová osa: implementační plán

> **Pro agentní pracovníky:** POVINNÁ PODŘÍZENÁ DOVEDNOST: použij `superpowers:subagent-driven-development` (doporučeno) nebo `superpowers:executing-plans` a proveď plán úkol po úkolu. Kroky mají zaškrtávací syntaxi (`- [ ]`) kvůli sledování postupu.

**Cíl:** Dodat čtecí vrstvu nad agregacemi trackingu a všechny obrazovky, které z nich žijí: report kampaně se třemi patry, přehled projektu, statistiky vývoje v čase a naplněnou časovou osu kontaktu, včetně pěti endpointů (`stats`, `stats/timeline`, `links`, `recipients`, `stream`), časové osy kontaktu, dashboardu a živého průběhu odesílání, který přežije výpadek spojení.

**Architektura:** Doménová logika žije v nové doméně `packages/core/src/reports` a nezná HTTP: metriky jsou čisté funkce nad předpočítanými čísly z `campaign_stats`, dotazy jsou tenké čtecí funkce nad transakčním handlem `Tx` z `@mlain/core/tx`, což je Drizzle handle `NodePgDatabase<typeof schema>` (rozhodnutí R34 v P03). Veřejné API je pět modulů Hono cest složených do routeru `reportsApi`, který mountuje `apps/web/src/lib/api/app.ts`. Obrazovky jsou klientské komponenty v `apps/web/src/features/reports`, které mluví výhradně přes `/api/v1`, takže nezávisí na tom, jak se autentizace řeší v serverových komponentách. Živé aktualizace mají dva režimy (SSE nad HTTP/2, jinak dotazování s `ETag`) a jeden vůdcovský tab na prohlížeč; obrazovka funguje i tehdy, když selžou oba.

**Technologie:** TypeScript 7.0.2, Node.js 24.18.1, PostgreSQL 18, Drizzle ORM (schéma z `@mlain/db`), Hono 4.12.33 se `@hono/zod-openapi` a `hono/streaming`, zod 4.4.3, `next-intl` 4.13.4 (ICU pro věty skládané na serveru), React 19 v Next.js 16 App Router, komponenty K1, K7 a K8 z `@mlain/ui`, Vitest 4.1.10, `@testcontainers/postgresql` 12.0.4, Playwright 1.62.1 s `@axe-core/playwright`.

---

## 0. Než začneš

### 0.1 Povinná četba

| Dokument | Kapitoly |
|---|---|
| `docs/superpowers/plans/2026-07-31-rozdeleni-implementacnich-planu.md` | celý, hlavně 1.1, 2 (uzávěry S4, S7, S8, S9, S11), 5 (P14) |
| `docs/superpowers/specs/parts/05-tracking.md` | 2.6 až 2.9, 3.9.4, 3.9.5, 3.11, 3.12, 3.13, 3.15.3, 3.16, 4.2, 4.4, 5.1 až 5.6, 7, 9, 10.7, 10.9, 12.2 |
| `docs/superpowers/specs/parts/06-ui-ux.md` | 4.3, 5.9, 5.10, 7.1, 7.2, 8.7 celá, 8.8, 8.11, 9.1, 12.3, 12.4, 13.1, 15 |
| `docs/superpowers/specs/parts/01-platforma.md` | 4.1, 4.2, 4.3, 5.4 |
| `docs/superpowers/specs/ROZHODNUTI-PRO-ZADAVATELE.md` | odpovědi na otázky částí 5 a 6 |

### 0.2 Jediné řídicí pravidlo

> **Každý soubor v repozitáři má právě jeden plán, který ho smí vytvořit a měnit. Ostatní plány ho jen čtou.**

Úplný seznam souborů, které vlastní tenhle plán, je v kapitole 8 na konci. **Mimo ně plán nesahá**, s výjimkou tří úzkých a jmenovitě vypsaných zásahů v 0.4.

### 0.3 Co tenhle plán vědomě nevlastní

| Oblast | Vlastník | Co z toho jen čtu |
|---|---|---|
| Databázové schéma, migrace, RLS, partitioning | **P03** | tabulky `campaign_stats`, `campaign_stats_buckets`, `campaign_link_stats`, `message_engagement`, `message_events`, `messages`, `web_events`, `web_event_months`, `contacts`, `campaigns`, `campaign_links`, `sending_providers`, `list_subscriptions`, `consents` |
| Sběr událostí, tokeny, web SDK, identity resolution, joby `tracking.process_engagement`, `event.process`, `identity.merge`, `tracking.enforce_retention`, `tracking.recompute_engagement_windows`, `tracking.cleanup_token_uses`, `packages/core/tracking`, `packages/sdk-web` | **P10** | výsledky, které tyhle joby zapsaly |
| Kampaně, provideři, outbox, materializace publika, obrazovky kampaní, `packages/core/campaigns` | **P13** | `campaigns`, `campaign_links`, `sending_providers`, `campaign_stats.materialized` |
| Design systém, komponenty K1 až K8, i18n infrastruktura, registr navigace, skořápka, `proxy.ts`, `playwright.config.ts` | **P05** | `@mlain/ui/patterns/data-table`, `@mlain/ui/patterns/charts/lazy`, `@mlain/ui/patterns/timeline`, `@mlain/i18n` |
| Průřezové API (chyby, stránkování, idempotence, rate limit, autentizace, OpenAPI) a transakční adaptér | **P04** | `apps/web/src/lib/api/*`, `@mlain/core/identity`, `@mlain/core/tx` |
| Registr chybových kódů, registr front, konfigurace, CI, worker | **P01** | `@mlain/core/errors/registry`, `@mlain/core/queues`, `@mlain/core/config` |
| Kontakty, souhlasy, detail kontaktu, veřejné stránky | **P07** | `contacts`, `list_subscriptions`, `consents` |
| Segmenty a jejich zakládání z reportu | **P11** | odkaz s předvyplněnou definicí, samotný builder je jeho |

**Sběr událostí ani web SDK tenhle plán nepíše.** Když se ukáže, že chybí data, není řešením začít je sbírat, ale zapsat nález do kapitoly 7 (Požadavky na jiné plány).

### 0.4 Tři úzké výjimky mimo vlastnictví

Bez nich se endpointy nikam nenamountují a balíček nepůjde přeložit. Každá je jmenovitě vypsaná a nic dalšího si plán nedovolí.

| Soubor | Vlastník | Co plán smí | Co nesmí |
|---|---|---|---|
| `apps/web/src/lib/api/app.ts` | P04 | přidat jeden import a jedno volání `app.route('/api/v1', reportsApi)` | měnit pořadí middleware, měnit cizí cesty, měnit chybovou vrstvu |
| `packages/core/package.json` | P01 | přidat položky do `dependencies` a `devDependencies` | měnit `name`, `version`, `scripts`, `exports` |
| `apps/web/package.json` | P01 | přidat položky do `dependencies` a `devDependencies` | měnit `scripts`, konfiguraci Next.js |

### 0.5 Git

Commit kroky provádí **hlavní agent**. Subagent, který úkol provádí, píše soubory a spouští testy, gitu se nedotýká. Plán běží ve vlastním worktree založeném z `HEAD`, na vlastní větvi, po smergování P10 a P13 do `main`.

---

## 1. Rozhodnutí, která tenhle plán udělal sám

Dvacet tři míst, kde zdroje mlčí nebo si odporují. Kdo plán provádí, se jimi řídí a nevymýšlí je znovu.

| # | Věc | Rozhodnutí | Důvod |
|---|---|---|---|
| R1 | Kam patří doménový kód | Nová doména **`packages/core/src/reports`**, ne `packages/core/tracking` | `packages/core/tracking` vlastní P10. Dva plány v jednom adresáři jsou porušení řídicího pravidla. Reporty jsou navíc čtecí vrstva a mají jiný životní cyklus než sběr událostí. **Prefix `src/` je povinný, ne kosmetický:** `packages/core/vitest.config.ts` z P01 má `include: ['src/**/*.test.ts', 'test/**/*.test.ts']` a mapa `exports` má `"./*": "./src/*/index.ts"`. Kód mimo `src/` by se nepřeložil pod `@mlain/core/reports` a jeho testy by se **vůbec nespustily**, takže by série skončila zeleně nad nespuštěnou sadou. |
| R2 | Kdo zapisuje do `campaign_stats` | **Nikdo z P14.** Tabulka má jediného zapisovatele a je jím P10, včetně jobu `tracking.refresh_campaign_progress` | Původní znění tohohle rozhodnutí si job bralo pro P14 s odůvodněním, že nečte události. P10 si ho vzal také a má přednost: `campaign_stats` je jediný řádek, na kterém se potkávají všechny zdroje čísel, a dva zapisovatelé z různých plánů jsou přesně ta tichá varianta konfliktu, které se celé dělení vyhýbá. **P14 je čistě čtecí vrstva.** „Přepočet a verzování" ze zadání zůstává v P14 jako **čtecí** funkce `recomputeCampaignCounts` a `compareWithStored`, které nic nezapisují a slouží ke kontrole driftu. Slévání bloků (`stats.compact`, krok 5 v 3.15.2) je rovněž P10; čtecí vrstva P14 zvládne pětiminutovou i hodinovou granularitu. |
| R3 | Jak obrazovky získávají data | Výhradně přes `/api/v1`, obrazovky jsou **klientské komponenty**, serverová komponenta jen předá parametry | Serverové čtení by potřebovalo překlad session na `WorkspaceContext` mimo Hono, což vlastní P04 a P06 a jejich tvar neznám. Přes veřejné API závisím jen na kontraktu, který je stabilní a testovaný. |
| R4 | Použití komponent K1, K7, K8 | Přes **tři adaptérové soubory** ve `features/reports`, které sedí na hotové rozhraní P05: `DataTable` z `@mlain/ui/patterns/data-table`, `LineChart` z `@mlain/ui/patterns/charts/lazy`, `Timeline` z `@mlain/ui/patterns/timeline` | `packages/ui` vlastní P05. Adaptér znamená, že případný rozdíl je změna ve třech souborech, ne ve dvaceti. Importuje se **na úroveň adresáře** (požadavek P05 na P14): `exports` mapa cestu k souboru nevystavuje a `@mlain/ui/patterns/charts/line-chart` skončí chybou `ERR_PACKAGE_PATH_NOT_EXPORTED` už při sestavení. Výjimka je `patterns/charts/lazy`, což je samostatná položka `exports` a jediná povolená cesta ke grafům (kritérium 82, R14). |
| R5 | Pořadí hlavních dlaždic reportu | **Kliklo (největší), Doručeno, Odhlásilo se** | Část 6 (8.7.2) žádá tři dlaždice v tomto složení, část 5 (5.1) žádá míru prokliku na první pozici a největší. Rozhodnutí zadavatele („hlavní metrika je proklik") rozhoduje o pořadí, složení zůstává podle 8.7.2. Kritérium 57 části 6 je tím splněné, protože jmenuje složení, ne pořadí. |
| R6 | Výchozí poloha přepínače automatických otevření | **Odečteno** (zobrazují se ověřená otevření), stav je v URL jako `?opens=verified` nebo `?opens=all` | Rozhodnutí zadavatele: výchozí poloha musí být ta poctivější a přepnutí musí být viditelně označené v reportu. URL kvůli pravidlu „co jde poslat kolegovi, má URL" (4.3 části 6). |
| R7 | Prediktivní otevření | **Wilsonův interval** nad měřitelnou částí publika, zobrazený jako rozsah se slovem „odhad", jen když je jmenovatel aspoň 200 | Zadavatel prediktivní otevření schválil a zároveň nařídil, že to musí vypadat jako odhad, ne jako měření. Rozsah místo jednoho čísla je přesně ta forma. Práh 200 je stejný jako práh malého vzorku v 3.11.4. |
| R8 | Odkud se bere `delivered_source` | Z **typu provideru kampaně** (`sending_providers.type`), `ses` znamená `provider_events`, `smtp` znamená `derived_from_sent` | Odvození z „`delivered > 0`" by u čerstvě rozeslané SES kampaně dalo `derived_from_sent` a jmenovatel by se během odesílání změnil pod rukama. Výčet `type` je otevřený, takže neznámá hodnota se chová jako `provider_events`, když kampaň má aspoň jednu událost doručení, jinak jako `derived_from_sent`. |
| R9 | Typ `status` v odpovědi `/stats` | **Otevřený řetězec**, ne union z 4.2 části 5 | Registr stavů kampaně vlastní část 4a a má deset hodnot (`draft`, `scheduled`, `queueing`, `sending`, `paused`, `sent`, `partially_sent`, `cancelled`, `failed`, `schedule_missed`). Union v části 5 zná sedm a chybí mu `queueing`, `partially_sent` a `schedule_missed`. Klient by na nich spadl. |
| R10 | Tvar `RecipientItem` | `contact_id`, `email` a `name` jsou **nullable** a přibývá `contact_state` s hodnotami `active`, `deleted`, `erased` | Rozhodnutí zadavatele: smazání kontaktu nemaže historii. Část 5 sama v 3.15.3 nuluje `message_engagement.contact_id`, takže `email: string` v její 4.2 je vnitřní rozpor. Report o smazaném kontaktu musí umět mlčet, ne spadnout. |
| R11 | Kodér kurzoru | Vlastní `packages/core/src/reports/cursor.ts` s testem na **doslovný vektor** z 4.3 části 1 | P04 má kodér v `apps/web/src/lib/api/pagination.ts`, kam `packages/core` podle grafu závislostí nesmí. Shodu obou implementací zaručuje společný pinovaný vektor, ne důvěra. Přesun kodéru do `packages/core` je zapsaný jako požadavek na P04. |
| R12 | Kdy SSE pošle zprávu | Podle **otisku** `(version, sent, delivered, opens_unique, clicks_unique, bounced, unsubscribed, updated_at)`, `ETag` zůstává `W/"<version>"` | Kdyby některý zapisovatel zapomněl zvýšit `version`, spojení by mlčelo a report by tiše zamrzl. Otisk to přežije. Že `version` zvyšovat mají, hlídá integrační test v úkolu 12, tedy mechanismus, ne přání. |
| R13 | Rozsah dashboardu | `/api/v1/dashboard` vrací **jen zdroje 1 a 2** z 8.11.1 (`campaign_stats` a `web_events`). Zdroje 3 až 5 (kvóta provideru, doručitelnost, stav projektu) se do obrazovky vkládají přes sloty | Zdroje 3 až 5 vlastní P13, P01 a P16. Kdybych je četl sám, sáhnu do cizí domény a zároveň zablokuju stránku na cizí chybě. Sloty drží stav S8 (částečná data) v platnosti. |
| R14 | Grafy v balíku | Komponenta grafu se načítá **dynamicky** (`next/dynamic`) | Kritérium 82 části 6 zakazuje grafy v základním balíku. |
| R15 | Rozsah sekce Statistiky | P14 dodává **jen `/w/{slug}/stats/campaigns`** | 8.11.2 přiřazuje obsah tří obrazovek třem různým vlastníkům. Doručitelnost je část 4a (P13), vývoj kontaktů část 2 (P07 nebo P11). Sekční navigaci dodává registr navigace z P05, takže P14 nezakládá `stats/layout.tsx` a nikomu tím nebrání. |
| R16 | Přepočet `campaign_stats` | **Knihovní funkce**, ne endpoint, a zároveň testovací nástroj proti driftu | „Přepočet a verzování" ze zadání. Bez přepočtu není jak dokázat, že přírůstkové čítače sedí. Napojení na CLI patří P16. |
| R17 | Skládání `title` v časové ose | Na serveru, přes `createTranslator` z `next-intl` nad namespace `reports` | 4.2 části 5 to výslovně žádá („aby se stejný text nemusel implementovat v každém klientovi API"). Tentýž katalog pak používá i UI, takže věta existuje jednou. |
| R18 | Jak se testuje UI | **Žádné jsdom testy komponent.** Prezentační logika se vytahuje do čistých funkcí testovaných Vitestem, chování komponent testuje Playwright s `page.route()` fixtures | `apps/web` jsdom konfiguraci Vitestu z P01 má (`vitest.config.ts`, jsdom, plugin React), ale testy komponent by duplikovaly to, co P05 testuje uvnitř `packages/ui`. Playwright s odchycenou odpovědí API navíc otestuje i stavy (chyba, prázdno, vypnutý tracking) věrněji než jsdom. |
| R19 | Jména typů událostí v `message_events` | Platí **slovník `ck_message_events__type` z P03**: `sent`, `rejected`, `delivered`, `delivery_delayed`, `bounced_hard`, `bounced_soft`, `complained`, `render_failed`, `open`, `click`, `unsubscribe`, `circuit_breaker_open`. Tvrdost odrazu nese **typ**, ne `subtype` | Návrh části 5 s hodnotami `bounce` a `complaint` odmítlo rozhodnutí R5 v P03 ve prospěch slovníku části 4a. Filtr `type = 'bounce'` v omezení není, takže by **nevracel nic a nic by nespadlo**: čítače odrazů a stížností by zůstaly trvale nulové, filtr příjemců „Odraženo" trvale prázdný a odraz by zmizel z časové osy. Tutéž chybu měl P10 a opravil ji stejným směrem. Slovník je v jediné konstantě `EVENT_TYPES` (úkol 2) a katalogový test ho porovnává s omezením v běžící databázi. |
| R20 | Kurzor seznamu příjemců | Řadí se podle **`messages.contact_id` sestupně**, ne podle `messages.id` | `uq_messages__campaign_contact (campaign_id, contact_id, created_at)` z P03 dává při pevném `campaign_id` uspořádání podle `contact_id` a zaručuje jeho jednoznačnost uvnitř kampaně, takže kurzor je stabilní a stránka se čte přímo z indexu. Podle `messages.id` **žádný index není** a řazení by u kampaně na sto tisíc příjemců znamenalo setřídit celý oddíl na každou stránku po padesáti. Obojí pořadí je pro uživatele stejně libovolné, takže se nic neztrácí. Hlídá to test s `EXPLAIN` v úkolu 12. |
| R21 | Horní mez `received_at` v časové ose | Pro `web_events` platí **7 dní** (`ck_web_events__lag`), pro `message_events` **`TRACKING_RETENTION_MONTHS`** z konfigurace P01 | Sedmidenní strop platí jen pro webové události a vynucuje ho omezení v P03. `message_events` žádné takové omezení nemá a mít nemůže: asynchronní odraz od SES chodí i po týdnech a `delivery_delayed` opakovaně. Jedna konstanta pro obě tabulky by zpožděný odraz z osy **tiše** vypustila, protože okno se posouvá spolu s ním. Proto dvě konstanty, každá se svým zdrojem. |
| R22 | Doménový vstupní bod | `packages/core/src/reports/index.ts` a `packages/core/src/reports/api/index.ts` **se zakládají** | Uzávěr S11 zakazuje `packages/core/index.ts`, tedy jeden barrel s řádkem na doménu. Doménový vstupní bod je naopak to, co dělá import podcesty `@mlain/core/reports` možným, protože mapa `exports` z P01 má `"./*": "./src/*/index.ts"`. Ověřeno v P01 spuštěním pod Node. Stejný tvar má `contactsApi` v P07. |
| R23 | Kontext projektu v testech | Přes `unsafeWorkspaceContext(workspaceId, actor)` z `@mlain/db/unsafe-context`, nikdy přetypováním | `WorkspaceContext` je branded typ s jedinou továrnou. `{ workspaceId } as WorkspaceContext` projde typovou kontrolou, ale vyrobí objekt **bez `actor`**, na kterém `withWorkspace` z P03 spadne až za běhu při čtení `ctx.actor.type`. Testy pak selhávají na místě vzdáleném od příčiny. |

---

## 2. Knihovny a licence

Projekt je **MIT**. Povolené licence produkčních závislostí jsou MIT, Apache-2.0, BSD a ISC. **GPL, LGPL a AGPL jsou zakázané** a hlídá to CI job `licenses-node`.

### 2.1 Co plán přidává

| Balíček | Verze | Licence | Kde | K čemu |
|---|---|---|---|---|
| `next-intl` | 4.13.4 | MIT | `packages/core` | `createTranslator` pro věty časové osy skládané na serveru (R17) |
| `@testcontainers/postgresql` | 12.0.4 | MIT | `packages/core` (dev) | PostgreSQL 18 pro databázové testy |
| `eventsource-parser` | 3.1.0 | MIT | `apps/web` (dev) | parsování SSE v testech endpointu |

### 2.2 Co plán používá a už v repozitáři je

| Balíček | Verze | Licence | Zavedl |
|---|---|---|---|
| `hono` | 4.12.33 | MIT | P04 |
| `@hono/zod-openapi` | 1.5.1 | MIT | P04 |
| `zod` | 4.4.3 | MIT | P01 |
| `drizzle-orm` | podle P03 | Apache-2.0 | P03 |
| `pg` | 8.22.0 | MIT | P01 |
| `pg-boss` | 12.26.3 | MIT | P01 |
| `recharts` | 3.10.1 | MIT | P05 (uvnitř K7, přímo se nepoužívá) |
| `@tanstack/react-table` | 8.21.3 | MIT | P05 (uvnitř K1) |
| `next-intl` | 4.13.4 | MIT | P05 |
| `vitest` | 4.1.10 | MIT | P01 |
| `testcontainers` | 12.0.4 | MIT | P03 |
| `@playwright/test` | 1.62.1 | Apache-2.0 | P05 |
| `@axe-core/playwright` | 4.12.1 | MPL-2.0, vývojová závislost s výjimkou v `licenses.allow.json` | P05 |

### 2.3 Co plán vědomě nepřidává

| Balíček | Důvod |
|---|---|
| `recharts` přímo | Graf je komponenta K7 z `packages/ui`. Přímá závislost by znamenala dvě verze grafové knihovny a obejití požadavků 13.1. |
| `date-fns`, `dayjs`, `luxon` | Časová pásma a formáty řeší `Intl` přes `useFormatter` z `next-intl` (12.4 části 6) a `date_trunc ... AT TIME ZONE` v SQL. |
| `swr`, `@tanstack/react-query` | Dotazování má jen jeden vzorec (jeden zdroj, `ETag`, přepínání na SSE) a knihovna by přinesla vlastní model cache, který by se s vůdcovským tabem tloukl. |
| jakákoliv knihovna na SSE klienta | `EventSource` je ve všech cílových prohlížečích. |

---

## 3. Mapa souborů

```
packages/core/src/reports/
├── index.ts                      doménový vstupní bod (R22), reexport čtecích funkcí a typů
├── event-types.ts                EVENT_TYPES: slovník ck_message_events__type (R19)
├── event-types.test.ts
├── cursor.ts                     kodér kurzoru podle 4.3 části 1
├── cursor.test.ts
├── errors.ts                     mapování doménových stavů na kódy z registru P01
├── metrics/
│   ├── counts.ts                 typ StatsCounts a jeho čtení z řádku
│   ├── rates.ts                  delivered_effective a všech osm měr
│   ├── rates.test.ts
│   ├── open-breakdown.ts         tři patra klasifikace otevření (8.7.3)
│   ├── open-breakdown.test.ts
│   ├── predicted-opens.ts        Wilsonův interval, prediktivní otevření
│   ├── predicted-opens.test.ts
│   ├── display.ts                zaokrouhlení, malý vzorek, pomlčka místo NaN
│   └── display.test.ts
├── campaign-stats/
│   ├── read.ts                   složení CampaignStatsResponse
│   ├── read.db.test.ts
│   ├── fingerprint.ts            otisk pro SSE
│   ├── fingerprint.test.ts
│   ├── buckets.ts                průběh v čase, tři granularity
│   ├── buckets.db.test.ts
│   ├── links.ts                  statistika odkazů a link_share
│   ├── links.db.test.ts
│   ├── recipients.ts             seznam příjemců, dva tvary dotazu
│   ├── recipients.db.test.ts
│   ├── recompute.ts              přepočet agregací od nuly
│   └── recompute.db.test.ts
├── progress/
│   ├── read.ts                   čtení průběhu odesílání pro pruh a report
│   └── read.db.test.ts
├── timeline/
│   ├── types.ts                  TimelineItem a otevřené výčty
│   ├── months.ts                 okno měsíců z web_event_months
│   ├── months.db.test.ts
│   ├── branches.ts               čtyři větve dotazu
│   ├── branches.db.test.ts
│   ├── merge.ts                  k-cestné slévání seřazených větví
│   ├── merge.test.ts
│   ├── titles.ts                 věty ze slotů podle rodu kontaktu
│   ├── titles.test.ts
│   ├── query.ts                  orchestrace a stránkování
│   └── query.db.test.ts
├── dashboard/
│   ├── cache.ts                  TTL cache s computed_at a stale
│   ├── cache.test.ts
│   ├── read.ts                   dlaždice ze zdrojů 1 a 2
│   └── read.db.test.ts
├── stream/
│   ├── poller.ts                 jeden poller na kampaň, odběratelé
│   ├── poller.test.ts
│   ├── connections.ts            stropy spojení a čítač
│   └── connections.test.ts
├── api/
│   ├── index.ts                  router `reportsApi`, mountuje ho P04 (R22)
│   ├── context.ts                jediné místo, kde se sahá na kontext Hono a transakci
│   ├── schemas.ts                zod schémata odpovědí
│   ├── campaign-stats.routes.ts
│   ├── campaign-recipients.routes.ts
│   ├── campaign-stream.routes.ts
│   ├── contact-timeline.routes.ts
│   └── dashboard.routes.ts
├── ownership.test.ts             hlídá, že doména do agregací nezapisuje
└── test-support/
    ├── db.ts                     testcontainer, migrace, čistý stav
    └── fixtures.ts               workspace, kampaň, zprávy, události

packages/i18n/messages/
├── cs/reports.json
└── en/reports.json

apps/web/src/features/reports/
├── api-client.ts                 tenký typovaný klient nad /api/v1
├── api-client.test.ts
├── adapters/
│   ├── report-chart.tsx          adaptér nad K7
│   ├── report-table.tsx          adaptér nad K1
│   └── report-timeline.tsx       adaptér nad K8
├── live/
│   ├── live-mode.ts              detekce protokolu, volba režimu
│   ├── live-mode.test.ts
│   ├── leader.ts                 volba vůdce přes BroadcastChannel
│   ├── leader.test.ts
│   ├── live-stats.ts             stavový automat SSE a dotazování
│   ├── live-stats.test.ts
│   └── use-live-stats.ts         React hook nad stavovým automatem
├── report/
│   ├── campaign-report.tsx
│   ├── headline-tiles.tsx
│   ├── opens-panel.tsx
│   ├── opens-toggle.tsx
│   ├── problems-panel.tsx
│   ├── links-table.tsx
│   ├── progress-chart.tsx
│   ├── diagnostics-panel.tsx
│   ├── report-banner.ts          výběr pruhu podle stavu kampaně
│   ├── report-banner.test.ts
│   ├── report-states.tsx
│   └── follow-up-actions.tsx
├── recipients/
│   ├── recipients-panel.tsx
│   ├── recipients-filter.ts
│   └── recipients-filter.test.ts
├── timeline/
│   ├── contact-timeline.tsx
│   ├── timeline-filters.tsx
│   ├── group-sessions.ts         shlukování webových sérií
│   └── group-sessions.test.ts
├── dashboard/
│   ├── dashboard-grid.tsx
│   ├── dashboard-slots.ts        typy slotů pro cizí zdroje
│   ├── tiles.tsx
│   └── period.ts
└── stats/
    ├── campaign-trend.tsx
    ├── trend-series.ts           série a tabulková alternativa
    └── trend-series.test.ts

apps/web/src/app/[locale]/w/[workspaceSlug]/
├── page.tsx                              přehled
├── campaigns/[campaignId]/report/page.tsx
├── contacts/[contactId]/timeline/page.tsx
└── stats/campaigns/page.tsx

apps/web/e2e/reports/
├── report.spec.ts
├── report-states.spec.ts
├── timeline.spec.ts
├── dashboard.spec.ts
├── live-updates.spec.ts
└── fixtures.ts
```

---

## 4. Konvence platné v celém plánu

| Věc | Pravidlo |
|---|---|
| Soubory | `kebab-case.ts`, React komponenta `PascalCase` uvnitř souboru s `kebab-case.tsx` |
| Importy uvnitř domény | **Relativní s příponou `.js`**: `./counts.js`, `../metrics/rates.js`. Mapa `exports` z P01 má jediné pravidlo `"./*": "./src/*/index.ts"`, takže `@mlain/core/reports/metrics/rates` by se rozřešilo na `src/reports/metrics/rates/index.ts` a **neexistovalo by**. |
| Importy z cizí domény | Doménový vstupní bod: `@mlain/core/tx`, `@mlain/core/errors`, `@mlain/core/identity`, `@mlain/db/schema`, `@mlain/db/unsafe-context`. Nikdy z kořene `@mlain/db` ani `@mlain/ui`. |
| Importy z `@mlain/ui` | Vždy na úroveň adresáře: `@mlain/ui/patterns/data-table`, `@mlain/ui/patterns/timeline`, `@mlain/ui/patterns/charts/lazy`. Cesta k souboru skončí `ERR_PACKAGE_PATH_NOT_EXPORTED` (požadavek P05 na P14). |
| Klíče v API | `snake_case` (4.1 části 1). Konverzi na `camelCase` dělá až klient v `sdk-node`. |
| Uvnitř TypeScriptu | `camelCase`. Převod je jen na hranici odpovědi. |
| Workspace | Každá doménová funkce bere `ctx: WorkspaceContext`, nikdy `workspaceId: string`. |
| Čísla v UI | Vždy přes `useFormatter` z `next-intl`, nikdy ruční `toLocaleString`. |
| Texty | Žádný literál v komponentě. Všechno přes `useTranslations('reports')` nebo přes server složený `title`. |
| Dlouhá pomlčka | Znak U+2014 se nesmí objevit nikde: kód, katalogy, komentáře. Hlídá test v úkolu 27. |
| Testy během práce | Jen na změněných a nových souborech. |
| Testy na konci | Kompletní série v úkolu 34. |

**Příkazy, které se opakují:**

```bash
# jednotkové testy balíčku core
pnpm --filter @mlain/core test:unit

# jeden testovací soubor
pnpm --filter @mlain/core exec vitest run src/reports/metrics/rates.test.ts

# databázové testy (testcontainers, běžící Docker je podmínka)
pnpm --filter @mlain/core test:db

# integrační testy API
pnpm --filter @mlain/web test:db

# typová kontrola
pnpm --filter @mlain/core typecheck && pnpm --filter @mlain/web typecheck

# testy v prohlížeči
pnpm --filter @mlain/web exec playwright test e2e/reports
```

---

## 5. Předpoklady a preflight

Plán běží po smergování P01, P03, P04, P05, P10 a P13 do `main`. Úkol 1 je preflight, který každý předpoklad **ověří spuštěním**. Když se název liší, opraví se na jediném místě ve sloupci „adaptér", ne ve dvaceti souborech.

| # | Zdroj | Symbol nebo artefakt | Adaptér |
|---|---|---|---|
| E1 | `@mlain/db/schema` | tabulky `campaignStats`, `campaignStatsBuckets`, `campaignLinkStats`, `messageEngagement`, `messageEvents`, `messages`, `webEvents`, `webEventMonths`, `contacts`, `campaigns`, `campaignLinks`, `sendingProviders`, `listSubscriptions`, `consents`. **Podcesta, ne kořen:** rozhodnutí R37 v P03 `schema` z kořene schválně nereexportuje | typová opora dotazů, které jsou psané syrovým SQL |
| E2 | `@mlain/core/tx` | `withWorkspace(ctx, fn)`, `withoutContext(fn)`, `pgErrorCode(error)`, typ `Tx` = `NodePgDatabase<typeof schema>` | `packages/core/src/reports/api/context.ts` |
| E3 | `@mlain/db` | `runMigrations` pro testy | `packages/core/src/reports/test-support/db.ts` |
| E4 | `@mlain/core/identity` | `WorkspaceContext` (reexport z `@mlain/db`, jediná továrna je v P04) | přímý import typu |
| E5 | `@mlain/db/unsafe-context` | `unsafeWorkspaceContext(workspaceId, actor)` pro testy (R23) | `packages/core/src/reports/test-support/db.ts` |
| E6 | `@mlain/core/errors` | `ERROR_CODES` s kódy `not_found`, `forbidden`, `validation_failed`, `dependency_timeout`, `tracking_disabled`, `tracking_timeline_window_too_large` | `packages/core/src/reports/errors.ts` |
| E7 | `@mlain/core/errors` | `ApiError` | `packages/core/src/reports/errors.ts` |
| E8 | P10 | frontu `tracking.refresh_campaign_progress` obsluhuje **P10** a plní `campaign_stats.sent`, `failed`, `progress_watermark_at` a `campaign_stats_buckets`. P14 nevlastní žádnou frontu | kontrola v úkolu 14 |
| E9 | `@mlain/core/config` | `config.TRACKING_SSE_MAX_CONNECTIONS` (P01, výchozí 500) a `config.TRACKING_RETENTION_MONTHS` (P01, výchozí 37) | `stream/connections.ts` a `timeline/months.ts` |
| E10 | `apps/web/src/lib/api/app.ts` | funkce, která skládá Hono aplikaci a jde do ní přidat `app.route()` | úzká výjimka 0.4 |
| E11 | `@mlain/ui/patterns/charts/lazy` | `LineChart` s props `{ title, series: ChartSeries[], labels: ChartLabels, formatValue? }` | `features/reports/adapters/report-chart.tsx` |
| E12 | `@mlain/ui/patterns/data-table` | `DataTable` s props `{ tableId, caption, columns, rows, getRowId, labels, count, pagination, ... }` a typ `CountInfo` | `features/reports/adapters/report-table.tsx` |
| E13 | `@mlain/ui/patterns/timeline` | `Timeline` s props `{ events: TimelineEvent[], gender, timeZone, labels, renderSentence, formatTime, formatDate, hasMore, onLoadOlder }` | `features/reports/adapters/report-timeline.tsx` |
| E14 | `@mlain/i18n` | skládání katalogů z `messages/{locale}/<namespace>.json` | `packages/i18n/messages/{cs,en}/reports.json` |
| E15 | P10 | job `tracking.process_engagement` je k dispozici jako importovatelný handler | integrační test v úkolu 12 |
| E16 | P13 | `campaigns` má vyplněné `audience_built_at` a `campaign_stats.materialized` po materializaci | test v úkolu 6 |
| E17 | P07 | detail kontaktu odkazuje na `/w/{slug}/contacts/{id}/timeline` | kontrola v úkolu 1, případný nález do kapitoly 7 |

---

## 6. Úkoly

### Úkol 1: Preflight

Jediný úkol bez testu. Ověřuje se výstupem příkazů. Když některý bod selže, **neopravuj to tady**: zapiš nález do kapitoly 7 a zjednej nápravu v plánu, který soubor vlastní.

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/docs/superpowers/plans/p14-preflight.md` (dočasný záznam výsledků, na konci plánu se maže v úkolu 34)

- [ ] **Krok 1: Ověř, že existují tabulky, ze kterých plán čte**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && grep -o "campaign_stats_buckets\|campaign_link_stats\|campaign_stats\|message_engagement\|web_event_months\|web_events\|message_events" packages/db/migrations/*.sql | sort -u
```
Expected: ve výpisu jsou všechny názvy `campaign_stats`, `campaign_stats_buckets`, `campaign_link_stats`, `message_engagement`, `message_events`, `web_events`, `web_event_months`.

- [ ] **Krok 2: Ověř exporty, na kterých plán stojí**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && node --input-type=module -e "
const tx = await import('@mlain/core/tx');
const needTx = ['withWorkspace','withoutContext','pgErrorCode'];
const missingTx = needTx.filter((k) => typeof tx[k] !== 'function');
console.log(missingTx.length ? 'MISSING tx: ' + missingTx.join(',') : 'OK tx');
const schema = await import('@mlain/db/schema');
const needTables = ['campaignStats','campaignStatsBuckets','campaignLinkStats','messageEngagement','messageEvents','messages','webEvents','webEventMonths','contacts','campaigns','campaignLinks','sendingProviders','listSubscriptions','consents'];
const missingTables = needTables.filter((k) => !(k in schema));
console.log(missingTables.length ? 'MISSING schema: ' + missingTables.join(',') : 'OK schema');
const unsafe = await import('@mlain/db/unsafe-context');
console.log('unsafe-context: ' + (typeof unsafe.unsafeWorkspaceContext === 'function' ? 'OK' : 'MISSING'));
const e = await import('@mlain/core/errors');
const codes = ['not_found','forbidden','validation_failed','dependency_timeout','tracking_disabled','tracking_timeline_window_too_large'];
const missingCodes = codes.filter((c) => !(c in e.ERROR_CODES));
console.log(missingCodes.length ? 'MISSING codes: ' + missingCodes.join(',') : 'OK codes');
const cfg = await import('@mlain/core/config');
for (const key of ['TRACKING_SSE_MAX_CONNECTIONS','TRACKING_RETENTION_MONTHS']) {
  console.log(key + ': ' + (key in cfg.config ? 'OK' : 'MISSING'));
}
"
```
Expected: `OK tx`, `OK schema`, `unsafe-context: OK`, `OK codes` a obě proměnné `OK`.

Kořenový import `@mlain/db` **nestačí**: rozhodnutí R37 v P03 `schema` z kořene schválně nereexportuje a `withWorkspaceId` v žádném balíčku neexistuje, protože obálky P03 berou `pool` prvním argumentem a doplňuje ho až adaptér `@mlain/core/tx` z P04.

- [ ] **Krok 2b: Ověř frontu průběhu a jejího vlastníka**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && node --input-type=module -e "
const q = await import('@mlain/core/queues');
const entry = q.QUEUE_REGISTRY.find((x) => x.name === 'tracking.refresh_campaign_progress');
console.log(entry ? 'queue OK, owner=' + entry.owner : 'MISSING tracking.refresh_campaign_progress');
"; grep -rln "refresh_campaign_progress" packages/core/src --include=*.ts | grep -v "src/reports"
```
Expected: fronta existuje a handler leží mimo `packages/core/src/reports`, typicky v `packages/core/src/tracking/jobs/`. **Sloupec `owner` musí být `P10`.** Když je tam `P14`, je to nález proti registru front P01 (rozhodnutí R2 tenhle job P14 nebere) a patří do kapitoly 7. Plán to neblokuje, protože do fronty stejně nesahá.

- [ ] **Krok 3: Ověř, že P05 dodal komponenty K1, K7 a K8**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && cat packages/ui/src/patterns/data-table/index.ts packages/ui/src/patterns/charts/index.ts packages/ui/src/patterns/charts/lazy.ts packages/ui/src/patterns/timeline/index.ts && node -e "
const map = require('./packages/ui/package.json').exports;
for (const key of ['./patterns/data-table','./patterns/charts','./patterns/charts/lazy','./patterns/timeline']) {
  console.log(key + ': ' + (key in map ? 'OK' : 'MISSING'));
}
console.log('koren \".\": ' + ('.' in map ? 'CHYBA, kořen nemá existovat' : 'OK, neexistuje'));
"
```
Expected: v `exports` jsou všechny čtyři podcesty a kořen `"."` chybí. Barrely vypíšou `DataTable`, `LineChart`, `BarChart`, `ChartFrame`, `Timeline` a jejich typy. Zapiš do `p14-preflight.md` **doslovné podpisy props**, protože z nich vychází tři adaptéry v úkolu 28. Plán je psaný proti tomuto tvaru:

| Komponenta | Podcesta | Klíčové props |
|---|---|---|
| `DataTable` | `@mlain/ui/patterns/data-table` | `tableId`, `caption`, `columns: DataTableColumn<Row>[]` (`{ id, header, cell, sortable?, width? }`), `rows`, `getRowId`, `labels: DataTableLabels`, `count: CountInfo`, `pagination: { hasMore, canGoBack, onPrevious, onNext }`, `emptyState?` |
| `LineChart` | `@mlain/ui/patterns/charts/lazy` | `title`, `series: ChartSeries[]` (`{ id, label, pattern, points: { x, y }[] }`), `labels: ChartLabels` (`{ showTable, hideTable, tableCaption, periodColumn }`), `formatValue?` |
| `Timeline` | `@mlain/ui/patterns/timeline` | `events: TimelineEvent[]` (`{ id, type, occurredAt: Date, payload }`), `gender`, `timeZone`, `labels: TimelineLabels`, `renderSentence`, `formatTime`, `formatDate`, `hasMore`, `onLoadOlder` |

Když se od téhle tabulky liší, oprav **jen tři adaptéry v úkolu 28** a rozdíl zapiš do kapitoly 7.

- [ ] **Krok 4: Ověř, že P07 odkazuje na časovou osu, a že P13 plní `campaign_stats.materialized`**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && grep -rn "contacts/\[contactId\]/timeline\|/timeline" apps/web/src/app --include=*.tsx | head -5; grep -rn "campaign_stats" packages/core/src/campaigns | head -5
```
Expected: aspoň jeden odkaz na `/timeline` z detailu kontaktu a aspoň jedno místo, kde P13 zapisuje `materialized`. Chybějící odkaz je nález proti P07, chybějící zápis nález proti P13. Obojí zapiš do kapitoly 7 a pokračuj, protože ani jedno tenhle plán neblokuje.

- [ ] **Krok 5: Ověř, že běží Docker (podmínka databázových testů)**

Run:
```bash
docker info --format '{{.ServerVersion}}'
```
Expected: číslo verze, ne chyba.

---

### Úkol 2: Doména `packages/core/src/reports`, slovník typů událostí a testovací zázemí

**Files:**
- Modify: `/Users/petr/Projects/Mailing_Tool/packages/core/package.json` (úzká výjimka 0.4)
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/event-types.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/test-support/db.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/test-support/fixtures.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/test-support/db.db.test.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/event-types.db.test.ts`

- [ ] **Krok 1: Přidej závislosti do `packages/core/package.json`**

Do `dependencies` přidej `"next-intl": "4.13.4"`, do `devDependencies` `"@testcontainers/postgresql": "12.0.4"`. Nic jiného v souboru neměň.

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm install && pnpm exec license-checker --production --json --start packages/core 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);const bad=Object.entries(j).filter(([,v])=>/GPL|AGPL|LGPL/.test(v.licenses||''));console.log(bad.length?'BAD: '+bad.map(([k])=>k).join(','):'licenses OK')})"
```
Expected: `licenses OK`.

- [ ] **Krok 2: Napiš padající test testovacího zázemí**

`packages/core/src/reports/test-support/db.db.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from './db.js';
import { seedWorkspace } from './fixtures.js';

describe('testovací databáze', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('má po migracích všechny tabulky, ze kterých reporty čtou', async () => {
    const { rows } = await db.pool.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
    );
    const names = new Set(rows.map((r) => r.table_name));
    for (const table of [
      'campaign_stats',
      'campaign_stats_buckets',
      'campaign_link_stats',
      'message_engagement',
      'message_events',
      'messages',
      'web_events',
      'web_event_months',
    ]) {
      expect(names.has(table), `chybí tabulka ${table}`).toBe(true);
    }
  });

  it('seedWorkspace založí projekt a vrátí kontext', async () => {
    const ws = await seedWorkspace(db);
    expect(ws.workspaceId).toMatch(/^[0-9a-f-]{36}$/);
    const { rows } = await db.pool.query(`SELECT count(*)::int AS n FROM workspaces WHERE id = $1`, [
      ws.workspaceId,
    ]);
    expect(rows[0]).toEqual({ n: 1 });
  });
});
```

- [ ] **Krok 3: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/test-support/db.db.test.ts`
Expected: FAIL, `Cannot find module './db.js'`.

- [ ] **Krok 4: Napiš `test-support/db.ts`**

```ts
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { runMigrations } from '@mlain/db';
import * as schema from '@mlain/db/schema';
import { unsafeWorkspaceContext } from '@mlain/db/unsafe-context';
import type { Tx } from '@mlain/core/tx';
import type { WorkspaceContext } from '@mlain/core/identity';

export type TestDatabase = {
  pool: Pool;
  url: string;
  stop: () => Promise<void>;
};

/**
 * Startuje PostgreSQL 18 v kontejneru a pouští proti němu migrace z packages/db.
 * Kontejner je jeden na testovací soubor: Vitest izoluje moduly per soubor,
 * takže sdílený singleton by stejně vznikl vícekrát a jen by matoucím způsobem
 * zdržoval start.
 */
export async function startTestDatabase(): Promise<TestDatabase> {
  const container: StartedPostgreSqlContainer = await new PostgreSqlContainer('postgres:18-alpine')
    .withDatabase('mlain_test')
    .withUsername('mlain_test')
    .withPassword('mlain_test')
    .start();

  const url = container.getConnectionUri();
  const pool = new Pool({ connectionString: url, max: 4, options: '-c timezone=UTC' });
  await runMigrations({ connectionString: url });

  return {
    pool,
    url,
    stop: async () => {
      await pool.end();
      await container.stop();
    },
  };
}

/**
 * Transakční handle pro testy.
 *
 * `Tx` je od rozhodnutí R34 v P03 `NodePgDatabase<typeof schema>`, tedy přímo
 * Drizzle handle. Žádné přetypování se tu proto neděje a dít nesmí: kdyby
 * `drizzle(...)` skutečnému typu neodpovídal, má to spadnout tady a ne až
 * v provozu na `tx.execute is not a function`.
 *
 * POZOR na tvar výsledku. `tx.execute(sql`...`)` vrací OBÁLKU (`pg.Result`),
 * ne pole. Vzor `await tx.execute(...) as unknown as Row[]` projde typovou
 * kontrolou i revizí a při prvním `rows[0]` vrátí `undefined`. Správně je
 * vždycky `const { rows } = await tx.execute(...)`.
 */
export function createTestTx(db: TestDatabase): Tx {
  return drizzle(db.pool, { schema });
}

/**
 * Kontext projektu pro testy (R23). Branded typ má jedinou továrnu a ta je
 * `unsafeWorkspaceContext`. Zápis `{ workspaceId } as WorkspaceContext` by
 * prošel typovou kontrolou, ale vyrobil by objekt **bez `actor`**, na kterém
 * `withWorkspace` z P03 spadne až za běhu při čtení `ctx.actor.type`.
 */
export function testContext(workspaceId: string): WorkspaceContext {
  return unsafeWorkspaceContext(workspaceId, { type: 'system', job: 'reports.test' });
}
```

Když se spouštěč migrací jmenuje jinak, oprav **jen tenhle soubor** (adaptér E3) a zapiš skutečný název do kapitoly 7.

- [ ] **Krok 4b: Napiš `event-types.ts` a jeho katalogový test**

Slovník je na jednom místě (R19), protože jinak ho každý dotaz opíše po svém a překlep se pozná až tím, že filtr trvale nic nevrací.

`packages/core/src/reports/event-types.ts`:

```ts
/**
 * Slovník `ck_message_events__type` z P03. Zdroj je omezení v databázi,
 * ne tenhle soubor: katalogový test níž je porovnává proti běžící databázi.
 *
 * Tvrdost odrazu nese TYP, ne `subtype`. Dřívější návrh části 5 s hodnotami
 * `bounce` a `complaint` odmítlo rozhodnutí R5 v P03. Filtr na neexistující
 * hodnotu **nic nevrátí a nic nespadne**, takže by čítače zůstaly nulové.
 */
export const EVENT_TYPES = [
  'sent', 'rejected', 'delivered', 'delivery_delayed',
  'bounced_hard', 'bounced_soft', 'complained', 'render_failed',
  'open', 'click', 'unsubscribe', 'circuit_breaker_open',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** Odraz je jeden pojem se dvěma tvrdostmi. Report je zobrazuje dohromady. */
export const BOUNCE_TYPES = ['bounced_hard', 'bounced_soft'] as const;

/** Typy, které se objevují v časové ose kontaktu. Provozní se nezobrazují. */
export const TIMELINE_EVENT_TYPES = [
  'delivered', 'bounced_hard', 'bounced_soft', 'complained',
  'open', 'click', 'unsubscribe',
] as const;

/** Podtypy prokliku, které nedělal člověk. Do ověřených prokliků nepatří. */
export const NON_HUMAN_CLICK_SUBTYPES = ['scanner', 'bot', 'prefetch'] as const;

/** Podtypy otevření, které nedělal člověk a v ose se nezobrazují vůbec. */
export const HIDDEN_OPEN_SUBTYPES = ['bot'] as const;
```

`packages/core/src/reports/event-types.db.test.ts`:

Test se **neptá zdrojáků P03**, ptá se běžící databáze. Kdyby se ptal souboru, ze kterého konstanta vznikla, neověřil by nic.

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestDatabase, type TestDatabase } from './test-support/db.js';
import { EVENT_TYPES, TIMELINE_EVENT_TYPES, BOUNCE_TYPES } from './event-types.js';

describe('EVENT_TYPES', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('se kryje s omezením ck_message_events__type v databázi', async () => {
    const { rows } = await db.pool.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def
         FROM pg_constraint WHERE conname = 'ck_message_events__type'`,
    );
    expect(rows[0], 'omezení ck_message_events__type v databázi není').toBeDefined();
    const inDatabase = [...rows[0]!.def.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(inDatabase).toEqual([...EVENT_TYPES].sort());
  });

  it('každý typ z osy i každý odraz je platná hodnota omezení', async () => {
    for (const type of [...TIMELINE_EVENT_TYPES, ...BOUNCE_TYPES]) {
      expect(EVENT_TYPES).toContain(type);
    }
  });

  it('hodnoty bounce a complaint ve slovníku NEJSOU (R19)', () => {
    expect(EVENT_TYPES).not.toContain('bounce');
    expect(EVENT_TYPES).not.toContain('complaint');
  });
});
```

Run: `pnpm --filter @mlain/core exec vitest run src/reports/event-types.db.test.ts`
Expected: PASS, `Tests  3 passed (3)`.

- [ ] **Krok 5: Napiš `test-support/fixtures.ts`**

Fixtures píšou syrovým SQL schválně: závisí tak jen na schématu z P03, ne na tom, jak se v Drizzle jmenují objekty tabulek.

```ts
import { randomUUID } from 'node:crypto';
import type { TestDatabase } from './db.js';

export type SeededWorkspace = { workspaceId: string; slug: string };
export type SeededCampaign = {
  campaignId: string;
  audienceBuiltAt: Date;
  providerId: string;
};

export async function seedWorkspace(db: TestDatabase): Promise<SeededWorkspace> {
  const workspaceId = randomUUID();
  const slug = `ws-${workspaceId.slice(0, 8)}`;
  await db.pool.query(
    `INSERT INTO workspaces (id, name, slug, timezone) VALUES ($1, $2, $3, 'Europe/Prague')`,
    [workspaceId, 'Testovací projekt', slug],
  );
  return { workspaceId, slug };
}

export async function seedProvider(
  db: TestDatabase,
  workspaceId: string,
  type: 'ses' | 'smtp',
): Promise<string> {
  const providerId = randomUUID();
  await db.pool.query(
    `INSERT INTO sending_providers (id, workspace_id, name, type, config_encrypted, status)
     VALUES ($1, $2, $3, $4, 'enc:v1:test', 'ready')`,
    [providerId, workspaceId, `provider-${type}`, type],
  );
  return providerId;
}

export async function seedCampaign(
  db: TestDatabase,
  workspaceId: string,
  options: {
    status?: string;
    trackOpens?: boolean;
    trackClicks?: boolean;
    providerType?: 'ses' | 'smtp';
    audienceBuiltAt?: Date;
  } = {},
): Promise<SeededCampaign> {
  const campaignId = randomUUID();
  const audienceBuiltAt = options.audienceBuiltAt ?? new Date('2026-07-31T12:00:00.000Z');
  const providerId = await seedProvider(db, workspaceId, options.providerType ?? 'ses');
  await db.pool.query(
    `INSERT INTO campaigns
       (id, workspace_id, name, status, subject, track_opens, track_clicks,
        audience_built_at, provider_id, started_at)
     VALUES ($1, $2, 'Letní výprodej', $3, 'Sleva 30 %', $4, $5, $6, $7, $6)`,
    [
      campaignId,
      workspaceId,
      options.status ?? 'sent',
      options.trackOpens ?? true,
      options.trackClicks ?? true,
      audienceBuiltAt,
      providerId,
    ],
  );
  await ensurePartitions(db, audienceBuiltAt);
  return { campaignId, audienceBuiltAt, providerId };
}

/** Vytvoří měsíční oddíly pro daný měsíc u všech partitionovaných tabulek, které reporty čtou. */
export async function ensurePartitions(db: TestDatabase, at: Date): Promise<void> {
  const start = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), 1));
  const end = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));
  const suffix = `y${start.getUTCFullYear()}m${String(start.getUTCMonth() + 1).padStart(2, '0')}`;
  for (const table of ['messages', 'message_events', 'message_engagement', 'web_events']) {
    await db.pool.query(
      `CREATE TABLE IF NOT EXISTS ${table}_${suffix}
         PARTITION OF ${table} FOR VALUES FROM ($1) TO ($2)`,
      [start.toISOString(), end.toISOString()],
    );
  }
}

export async function seedContact(
  db: TestDatabase,
  workspaceId: string,
  options: { email?: string; firstName?: string; lastName?: string; gender?: 'female' | 'male' | 'unknown' } = {},
): Promise<string> {
  const contactId = randomUUID();
  await db.pool.query(
    `INSERT INTO contacts (id, workspace_id, email, first_name, last_name, gender)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [
      contactId,
      workspaceId,
      options.email ?? `k-${contactId.slice(0, 8)}@example.cz`,
      options.firstName ?? 'Jana',
      options.lastName ?? 'Nováková',
      options.gender ?? 'female',
    ],
  );
  return contactId;
}

export async function seedCampaignStats(
  db: TestDatabase,
  workspaceId: string,
  campaignId: string,
  values: Record<string, number>,
): Promise<void> {
  const columns = Object.keys(values);
  const placeholders = columns.map((_, i) => `$${i + 3}`);
  // ON CONFLICT (campaign_id): PK campaign_stats je jednosloupcový, viz P03.
  await db.pool.query(
    `INSERT INTO campaign_stats (workspace_id, campaign_id${columns.length ? ', ' + columns.join(', ') : ''})
     VALUES ($1, $2${placeholders.length ? ', ' + placeholders.join(', ') : ''})
     ON CONFLICT (campaign_id) DO UPDATE SET ${columns
       .map((c) => `${c} = excluded.${c}`)
       .join(', ')}, version = campaign_stats.version + 1, updated_at = now()`,
    [workspaceId, campaignId, ...columns.map((c) => values[c])],
  );
}

/** Rodina doručovacích typů, u které `ck_message_events__recipient` vyžaduje adresu. */
const DELIVERY_FAMILY = new Set([
  'sent', 'rejected', 'delivered', 'delivery_delayed',
  'bounced_hard', 'bounced_soft', 'complained', 'render_failed',
]);

/**
 * Jediný zapisovač událostí v celém plánu. Existuje proto, že `message_events`
 * má tři pasti, na které se naráží až za běhu:
 *
 *  1. `source` je NOT NULL BEZ výchozí hodnoty a drží ho `ck_message_events__source`
 *     s výčtem `ses_sns`, `smtp`, `internal`, `tracking`. Vynechaný sloupec = 23502.
 *  2. `recipient` je nepovinný, ale `ck_message_events__recipient` ho vyžaduje
 *     pro celou doručovací rodinu. `delivered` bez adresy skončí chybou 23514,
 *     `open` bez adresy projde. Ověřeno v P03 spuštěním.
 *  3. `rank` je GENERATED ALWAYS ... STORED (rozhodnutí R32 v P03). Uvést ho
 *     v seznamu sloupců je chyba 428C9, ne jen zbytečnost.
 */
export async function seedMessageEvent(
  db: TestDatabase,
  input: {
    workspaceId: string;
    campaignId: string;
    messageId: string;
    messageCreatedAt: Date | string;
    contactId: string | null;
    type: string;
    subtype?: string | null;
    ts?: Date | string;
    receivedAt?: Date | string;
    recipient?: string;
    source?: 'ses_sns' | 'smtp' | 'internal' | 'tracking';
  },
): Promise<void> {
  const ts = input.ts ?? input.messageCreatedAt;
  const receivedAt = input.receivedAt ?? ts;
  const source = input.source ?? (DELIVERY_FAMILY.has(input.type) ? 'ses_sns' : 'tracking');
  const recipient = input.recipient ?? (DELIVERY_FAMILY.has(input.type) ? 'x@example.cz' : null);

  await db.pool.query(
    `INSERT INTO message_events
       (id, received_at, ts, workspace_id, message_id, message_created_at,
        campaign_id, contact_id, type, subtype, recipient, source)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      receivedAt, ts, input.workspaceId, input.messageId, input.messageCreatedAt,
      input.campaignId, input.contactId, input.type, input.subtype ?? null, recipient, source,
    ],
  );
}
```

- [ ] **Krok 6: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/test-support/db.db.test.ts src/reports/event-types.db.test.ts`
Expected: PASS, `Tests  5 passed (5)`.

- [ ] **Krok 7: Ověř, že testy domény vitest opravdu vidí**

Prázdná sada projde zeleně a nikdo se to nedozví. Tenhle krok je jediná ochrana proti tomu, aby celá doména existovala mimo hlídaný vzor.

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest list --run 2>/dev/null | grep -c "src/reports/"
```
Expected: číslo větší než nula. Nula znamená, že soubory leží mimo `packages/core/src/`, kam míří `include` z `packages/core/vitest.config.ts` (P01). Přesuň je, netrhej konfiguraci.

- [ ] **Krok 8: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add packages/core/package.json packages/core/src/reports pnpm-lock.yaml && git commit -m "test(reports): add postgres test harness and message event type catalogue"
```

---

### Úkol 3: Kodér kurzoru

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/cursor.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/errors.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/cursor.test.ts`

- [ ] **Krok 1: Napiš padající test**

`packages/core/src/reports/cursor.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { decodeCursor, encodeCursor } from './cursor.js';

const VECTOR_JSON =
  '{"k":["2026-07-31T14:22:03.000Z","0192f3a0-1c2d-7e43-8d4e-5f60718293a4"],"d":"n","o":"created_at.desc"}';
const VECTOR_ENCODED =
  'eyJrIjpbIjIwMjYtMDctMzFUMTQ6MjI6MDMuMDAwWiIsIjAxOTJmM2EwLTFjMmQtN2U0My04ZDRlLTVmNjA3MTgyOTNhNCJdLCJkIjoibiIsIm8iOiJjcmVhdGVkX2F0LmRlc2MifQ';

describe('kurzor', () => {
  it('zakóduje vektor z konvence 4.3 části 1 doslova', () => {
    expect(
      encodeCursor({
        k: ['2026-07-31T14:22:03.000Z', '0192f3a0-1c2d-7e43-8d4e-5f60718293a4'],
        d: 'n',
        o: 'created_at.desc',
      }),
    ).toBe(VECTOR_ENCODED);
  });

  it('dekóduje týž vektor zpět', () => {
    expect(decodeCursor(VECTOR_ENCODED, 'created_at.desc')).toEqual(JSON.parse(VECTOR_JSON));
  });

  it('odmítne kurzor s jiným řazením kódem validation_failed', () => {
    expect(() => decodeCursor(VECTOR_ENCODED, 'id.desc')).toThrowError(
      expect.objectContaining({ code: 'validation_failed' }),
    );
  });

  it('odmítne poškozený kurzor kódem validation_failed', () => {
    expect(() => decodeCursor('tohle-neni-base64url-json', 'id.desc')).toThrowError(
      expect.objectContaining({ code: 'validation_failed' }),
    );
  });

  it('odmítne kurzor bez pole o', () => {
    const broken = Buffer.from('{"k":["a"],"d":"n"}', 'utf8').toString('base64url');
    expect(() => decodeCursor(broken, 'id.desc')).toThrowError(
      expect.objectContaining({ code: 'validation_failed' }),
    );
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/cursor.test.ts`
Expected: FAIL, `Cannot find module './cursor.js'`.

- [ ] **Krok 3: Napiš `errors.ts` a `cursor.ts`**

`packages/core/src/reports/errors.ts`:

```ts
import { ApiError } from '@mlain/core/errors';

/**
 * Jediné místo, kde tahle doména vyrábí chyby. Kódy pocházejí z registru P01,
 * tenhle plán žádný nezakládá.
 *
 * `ApiError` z P04 **nemá volbu `detail`**: text pro uživatele se skládá až
 * v HTTP vrstvě z katalogu, protože závisí na `Accept-Language`, který doména
 * nezná. Strojová vysvětlení proto patří do `params`, ne do věty.
 *
 * `errors[]` má zmrazený tvar `{ path, code, message }` a smí ho nést
 * **výhradně** kód `validation_failed`. U jiného kódu konstruktor P04 spadne,
 * a to je záměr, ne past.
 */
export function notFound(what: 'campaign' | 'contact'): ApiError {
  return new ApiError('not_found', { params: { resource: what } });
}

export function validationFailed(path: string, code: string, message: string): ApiError {
  return new ApiError('validation_failed', { errors: [{ path, code, message }] });
}

export function timelineWindowTooLarge(): ApiError {
  return new ApiError('tracking_timeline_window_too_large', {
    params: { max_months: 3 },
  });
}

export function dependencyTimeout(): ApiError {
  return new ApiError('dependency_timeout', { params: { source: 'timeline' } });
}

export function trackingDisabled(): ApiError {
  return new ApiError('tracking_disabled', { params: { scope: 'workspace' } });
}
```

`packages/core/src/reports/cursor.ts`:

```ts
import { validationFailed } from './errors.js';

export type CursorDirection = 'n' | 'p';

/** Tvar z konvence 4.3 části 1. Kurzor není podepsaný a nenese nic tajného. */
export type Cursor = {
  k: string[];
  d: CursorDirection;
  o: string;
};

export function encodeCursor(cursor: Cursor): string {
  const json = JSON.stringify({ k: cursor.k, d: cursor.d, o: cursor.o });
  return Buffer.from(json, 'utf8').toString('base64url');
}

export function decodeCursor(raw: string, expectedOrder: string): Cursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw validationFailed('cursor', 'invalid_cursor', 'Kurzor je poškozený. Načtěte seznam znovu od začátku.');
  }

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray((parsed as Cursor).k) ||
    !(parsed as Cursor).k.every((value) => typeof value === 'string') ||
    ((parsed as Cursor).d !== 'n' && (parsed as Cursor).d !== 'p') ||
    typeof (parsed as Cursor).o !== 'string'
  ) {
    throw validationFailed('cursor', 'invalid_cursor', 'Kurzor je poškozený. Načtěte seznam znovu od začátku.');
  }

  const cursor = parsed as Cursor;
  if (cursor.o !== expectedOrder) {
    // Konvence 4.3: kurzor z jiného řazení by dal nesmyslný výsledek.
    throw validationFailed('cursor', 'cursor_order_mismatch', 'Kurzor patří k jinému řazení. Načtěte seznam znovu.');
  }
  return { k: cursor.k, d: cursor.d, o: cursor.o };
}
```

- [ ] **Krok 4: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/cursor.test.ts`
Expected: PASS, `Tests  5 passed (5)`.

- [ ] **Krok 5: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add packages/core/src/reports/cursor.ts packages/core/src/reports/cursor.test.ts packages/core/src/reports/errors.ts && git commit -m "feat(reports): add cursor codec pinned to the part 1 vector"
```

---

### Úkol 4: Metriky, míry a jmenovatele

Tohle je jádro poctivosti celého produktu. Špatný jmenovatel tady znamená špatné produktové rozhodnutí u zákazníka.

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/metrics/counts.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/metrics/rates.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/metrics/rates.test.ts`

- [ ] **Krok 1: Napiš padající test**

`packages/core/src/reports/metrics/rates.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { emptyCounts, type StatsCounts } from './counts.js';
import { computeRates, deliveredEffective, isSmallSample } from './rates.js';

/** Případ z akceptačních kritérií 61 a 62 části 5. */
const APPLE_CASE: StatsCounts = {
  ...emptyCounts(),
  materialized: 1000,
  sent: 1000,
  delivered: 1000,
  opensTotal: 900,
  opensUnique: 500,
  opensUniqueHuman: 200,
  opensUniqueApple: 300,
  clicksTotal: 210,
  clicksUnique: 190,
  clicksUniqueHuman: 187,
  clicksScanner: 20,
  unsubscribed: 4,
};

const BOTH_ON = { trackOpens: true, trackClicks: true };

describe('deliveredEffective', () => {
  it('u provideru s událostmi doručení vrací delivered', () => {
    expect(deliveredEffective({ ...emptyCounts(), sent: 100, delivered: 97 }, 'provider_events')).toBe(97);
  });

  it('bez událostí doručení odečítá odrazy a selhání od odeslaných', () => {
    expect(
      deliveredEffective(
        { ...emptyCounts(), sent: 100, bouncedHard: 3, bouncedSoft: 2, failed: 1 },
        'derived_from_sent',
      ),
    ).toBe(94);
  });

  it('nikdy nevrací záporné číslo', () => {
    expect(
      deliveredEffective({ ...emptyCounts(), sent: 1, bouncedHard: 5 }, 'derived_from_sent'),
    ).toBe(0);
  });
});

describe('computeRates', () => {
  it('počítá ověřenou míru otevření z jmenovatele bez Apple příjemců (kritérium 62)', () => {
    const rates = computeRates(APPLE_CASE, 'provider_events', BOTH_ON);
    expect(rates.verifiedOpenRate).toBeCloseTo(200 / 700, 10);
    expect(rates.verifiedOpenRate).not.toBeCloseTo(200 / 1000, 4);
  });

  it('počítá míru otevření z doručených', () => {
    expect(computeRates(APPLE_CASE, 'provider_events', BOTH_ON).openRate).toBeCloseTo(0.5, 10);
  });

  it('počítá CTOR z ověřených otevření, ne ze všech (kritérium 63)', () => {
    const rates = computeRates(APPLE_CASE, 'provider_events', BOTH_ON);
    expect(rates.clickToOpenRate).toBeCloseTo(187 / 200, 10);
  });

  it('počítá míru prokliku z doručených a z ověřených prokliků', () => {
    expect(computeRates(APPLE_CASE, 'provider_events', BOTH_ON).clickRate).toBeCloseTo(187 / 1000, 10);
  });

  it('počítá míru odmítnutí z odeslaných, ne z doručených', () => {
    const counts = { ...APPLE_CASE, bouncedHard: 8, bouncedSoft: 4 };
    expect(computeRates(counts, 'provider_events', BOTH_ON).bounceRate).toBeCloseTo(12 / 1000, 10);
  });

  it('vrací null místo dělení nulou', () => {
    const rates = computeRates(emptyCounts(), 'provider_events', BOTH_ON);
    expect(rates.openRate).toBeNull();
    expect(rates.clickRate).toBeNull();
    expect(rates.bounceRate).toBeNull();
    expect(rates.clickToOpenRate).toBeNull();
  });

  it('nezobrazuje ověřenou míru pod padesáti měřitelnými příjemci', () => {
    const counts = { ...emptyCounts(), sent: 60, delivered: 60, opensUnique: 20, opensUniqueHuman: 8, opensUniqueApple: 30 };
    expect(computeRates(counts, 'provider_events', BOTH_ON).verifiedOpenRate).toBeNull();
  });

  it('u kampaně s vypnutým měřením otevření vrací null, ne nulu (kritérium 65)', () => {
    const rates = computeRates(APPLE_CASE, 'provider_events', { trackOpens: false, trackClicks: true });
    expect(rates.openRate).toBeNull();
    expect(rates.machineOpenShare).toBeNull();
    expect(rates.verifiedOpenRate).toBeNull();
    expect(rates.clickToOpenRate).toBeNull();
    expect(rates.clickRate).toBeCloseTo(187 / 1000, 10);
  });

  it('u kampaně s vypnutým měřením prokliků vrací null u prokliků', () => {
    const rates = computeRates(APPLE_CASE, 'provider_events', { trackOpens: true, trackClicks: false });
    expect(rates.clickRate).toBeNull();
    expect(rates.clickToOpenRate).toBeNull();
    expect(rates.openRate).toBeCloseTo(0.5, 10);
  });
});

describe('isSmallSample', () => {
  it('je pravda pod dvěma sty doručenými (kritérium 66)', () => {
    expect(isSmallSample(199)).toBe(true);
    expect(isSmallSample(200)).toBe(false);
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/metrics/rates.test.ts`
Expected: FAIL, `Cannot find module './counts.js'`.

- [ ] **Krok 3: Napiš `metrics/counts.ts`**

```ts
/**
 * Předpočítaná čísla z campaign_stats. Uvnitř TypeScriptu camelCase,
 * převod na snake_case dělá až vrstva API (konvence 4.1 části 1).
 */
export type StatsCounts = {
  materialized: number;
  sent: number;
  skipped: number;
  failed: number;
  delivered: number;
  bouncedHard: number;
  bouncedSoft: number;
  complained: number;
  unsubscribed: number;
  opensTotal: number;
  opensUnique: number;
  opensUniqueHuman: number;
  opensUniqueApple: number;
  clicksTotal: number;
  clicksUnique: number;
  clicksUniqueHuman: number;
  clicksScanner: number;
};

export function emptyCounts(): StatsCounts {
  return {
    materialized: 0,
    sent: 0,
    skipped: 0,
    failed: 0,
    delivered: 0,
    bouncedHard: 0,
    bouncedSoft: 0,
    complained: 0,
    unsubscribed: 0,
    opensTotal: 0,
    opensUnique: 0,
    opensUniqueHuman: 0,
    opensUniqueApple: 0,
    clicksTotal: 0,
    clicksUnique: 0,
    clicksUniqueHuman: 0,
    clicksScanner: 0,
  };
}

/** Řádek campaign_stats přichází z pg jako bigint v řetězci, proto Number(). */
export function countsFromRow(row: Record<string, unknown> | undefined): StatsCounts {
  const n = (key: string): number => {
    const value = row?.[key];
    if (value === null || value === undefined) return 0;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  return {
    materialized: n('materialized'),
    sent: n('sent'),
    skipped: n('skipped'),
    failed: n('failed'),
    delivered: n('delivered'),
    bouncedHard: n('bounced_hard'),
    bouncedSoft: n('bounced_soft'),
    complained: n('complained'),
    unsubscribed: n('unsubscribed'),
    opensTotal: n('opens_total'),
    opensUnique: n('opens_unique'),
    opensUniqueHuman: n('opens_unique_human'),
    opensUniqueApple: n('opens_unique_apple'),
    clicksTotal: n('clicks_total'),
    clicksUnique: n('clicks_unique'),
    clicksUniqueHuman: n('clicks_unique_human'),
    clicksScanner: n('clicks_scanner'),
  };
}
```

- [ ] **Krok 4: Napiš `metrics/rates.ts`**

```ts
import type { StatsCounts } from './counts.js';

export type DeliveredSource = 'provider_events' | 'derived_from_sent';

export type TrackingFlags = { trackOpens: boolean; trackClicks: boolean };

export type Rates = {
  openRate: number | null;
  machineOpenShare: number | null;
  verifiedOpenRate: number | null;
  clickRate: number | null;
  clickToOpenRate: number | null;
  bounceRate: number | null;
  complaintRate: number | null;
  unsubscribeRate: number | null;
};

/** Pod tímhle počtem měřitelných příjemců se ověřená míra nezobrazuje (3.11.2). */
export const VERIFIED_OPEN_MIN_DENOMINATOR = 50;

/** Pod tímhle počtem doručených se místo procent ukazují absolutní počty (3.11.4). */
export const SMALL_SAMPLE_THRESHOLD = 200;

export function deliveredEffective(counts: StatsCounts, source: DeliveredSource): number {
  if (source === 'provider_events') return counts.delivered;
  return Math.max(counts.sent - counts.bouncedHard - counts.bouncedSoft - counts.failed, 0);
}

/** Počet příjemců, u kterých měření otevření prokazatelně funguje. */
export function measurableAudience(counts: StatsCounts, source: DeliveredSource): number {
  return Math.max(deliveredEffective(counts, source) - counts.opensUniqueApple, 0);
}

export function isSmallSample(deliveredEffectiveValue: number): boolean {
  return deliveredEffectiveValue < SMALL_SAMPLE_THRESHOLD;
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  const value = numerator / denominator;
  return Number.isFinite(value) ? value : null;
}

export function computeRates(
  counts: StatsCounts,
  source: DeliveredSource,
  flags: TrackingFlags,
): Rates {
  const de = deliveredEffective(counts, source);
  const measurable = measurableAudience(counts, source);

  return {
    openRate: flags.trackOpens ? ratio(counts.opensUnique, de) : null,
    machineOpenShare: flags.trackOpens ? ratio(counts.opensUniqueApple, counts.opensUnique) : null,
    // Jiný jmenovatel schválně: Apple příjemci nikdy nemůžou být v čitateli,
    // takže by míra systematicky podstřelovala. Viz 3.11.2.
    verifiedOpenRate:
      flags.trackOpens && measurable >= VERIFIED_OPEN_MIN_DENOMINATOR
        ? ratio(counts.opensUniqueHuman, measurable)
        : null,
    clickRate: flags.trackClicks ? ratio(counts.clicksUniqueHuman, de) : null,
    clickToOpenRate:
      flags.trackClicks && flags.trackOpens
        ? ratio(counts.clicksUniqueHuman, counts.opensUniqueHuman)
        : null,
    // Z odeslaných, protože odmítnutá zpráva z definice doručená není.
    bounceRate: ratio(counts.bouncedHard + counts.bouncedSoft, counts.sent),
    complaintRate: ratio(counts.complained, de),
    unsubscribeRate: ratio(counts.unsubscribed, de),
  };
}
```

- [ ] **Krok 5: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/metrics/rates.test.ts`
Expected: PASS, `Tests  13 passed (13)`.

- [ ] **Krok 6: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add packages/core/src/reports/metrics && git commit -m "feat(reports): add metric denominators with click rate as the primary rate"
```

---

### Úkol 5: Tři patra klasifikace otevření

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/metrics/open-breakdown.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/metrics/open-breakdown.test.ts`

- [ ] **Krok 1: Napiš padající test**

`packages/core/src/reports/metrics/open-breakdown.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { emptyCounts } from './counts.js';
import { breakdownShares, openBreakdown } from './open-breakdown.js';

describe('openBreakdown', () => {
  it('rozpadne otevření na tři skupiny podle 8.7.3 (kritérium 61)', () => {
    const b = openBreakdown({
      ...emptyCounts(),
      opensUnique: 500,
      opensUniqueHuman: 200,
      opensUniqueApple: 300,
      clicksUniqueHuman: 187,
    });
    expect(b).toEqual({ verified: 200, machine: 300, uncertain: 0, total: 500, clickedFromVerified: 187 });
  });

  it('zbytek po ověřených a automatických je nejistý', () => {
    const b = openBreakdown({
      ...emptyCounts(),
      opensUnique: 832,
      opensUniqueHuman: 387,
      opensUniqueApple: 411,
    });
    expect(b.uncertain).toBe(34);
  });

  it('nikdy nevrací zápornou nejistou skupinu, ani když se čítače rozejdou', () => {
    const b = openBreakdown({
      ...emptyCounts(),
      opensUnique: 10,
      opensUniqueHuman: 8,
      opensUniqueApple: 7,
    });
    expect(b.uncertain).toBe(0);
    expect(b.verified + b.machine + b.uncertain).toBeGreaterThanOrEqual(b.total);
  });

  it('podíly v pruhu dávají dohromady jedničku', () => {
    const shares = breakdownShares(
      openBreakdown({ ...emptyCounts(), opensUnique: 500, opensUniqueHuman: 200, opensUniqueApple: 300 }),
    );
    expect(shares.verified + shares.machine + shares.uncertain).toBeCloseTo(1, 10);
    expect(shares.verified).toBeCloseTo(0.4, 10);
  });

  it('u nulových otevření vrací nulové podíly, ne NaN', () => {
    const shares = breakdownShares(openBreakdown(emptyCounts()));
    expect(shares).toEqual({ verified: 0, machine: 0, uncertain: 0 });
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/metrics/open-breakdown.test.ts`
Expected: FAIL, `Cannot find module './open-breakdown.js'`.

- [ ] **Krok 3: Napiš `metrics/open-breakdown.ts`**

```ts
import type { StatsCounts } from './counts.js';

/**
 * Tři patra z 8.7.3 části 6. Skupiny jsou přesně ty, které vrací část 5:
 * ověřená (opens_unique_human), pravděpodobně automatická (opens_unique_apple)
 * a nejistá (zbytek, tedy zprávy otevřené jen se třídou unknown).
 *
 * "Kliklo" NENÍ třída otevření. Je to samostatná věta pod pruhem a nese ji
 * pole clickedFromVerified.
 */
export type OpenBreakdown = {
  verified: number;
  machine: number;
  uncertain: number;
  total: number;
  clickedFromVerified: number;
};

export function openBreakdown(counts: StatsCounts): OpenBreakdown {
  const verified = counts.opensUniqueHuman;
  const machine = counts.opensUniqueApple;
  const uncertain = Math.max(counts.opensUnique - verified - machine, 0);
  return {
    verified,
    machine,
    uncertain,
    total: counts.opensUnique,
    clickedFromVerified: counts.clicksUniqueHuman,
  };
}

/** Podíly pro pruh. Základem je součet skupin, ne total, aby pruh vždy sedl na sto procent. */
export function breakdownShares(breakdown: OpenBreakdown): {
  verified: number;
  machine: number;
  uncertain: number;
} {
  const sum = breakdown.verified + breakdown.machine + breakdown.uncertain;
  if (sum <= 0) return { verified: 0, machine: 0, uncertain: 0 };
  return {
    verified: breakdown.verified / sum,
    machine: breakdown.machine / sum,
    uncertain: breakdown.uncertain / sum,
  };
}
```

- [ ] **Krok 4: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/metrics/open-breakdown.test.ts`
Expected: PASS, `Tests  5 passed (5)`.

- [ ] **Krok 5: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add packages/core/src/reports/metrics/open-breakdown.ts packages/core/src/reports/metrics/open-breakdown.test.ts && git commit -m "feat(reports): add three tier open classification"
```

---

### Úkol 6: Prediktivní otevření jako rozsah

Zadavatel prediktivní otevření schválil a zároveň nařídil, že to musí vypadat jako odhad. Proto rozsah, ne číslo.

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/metrics/predicted-opens.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/metrics/predicted-opens.test.ts`

- [ ] **Krok 1: Napiš padající test**

`packages/core/src/reports/metrics/predicted-opens.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { emptyCounts } from './counts.js';
import { predictedOpens, wilsonInterval } from './predicted-opens.js';

describe('wilsonInterval', () => {
  it('vrací interval, který obsahuje bodový odhad', () => {
    const { low, high } = wilsonInterval(200, 700);
    expect(low).toBeLessThan(200 / 700);
    expect(high).toBeGreaterThan(200 / 700);
  });

  it('drží meze uvnitř nuly a jedničky i v krajních případech', () => {
    expect(wilsonInterval(0, 500).low).toBeGreaterThanOrEqual(0);
    expect(wilsonInterval(500, 500).high).toBeLessThanOrEqual(1);
  });

  it('s rostoucím vzorkem se interval zužuje', () => {
    const small = wilsonInterval(200, 700);
    const large = wilsonInterval(2000, 7000);
    expect(large.high - large.low).toBeLessThan(small.high - small.low);
  });

  it('u vzorku 200 ze 700 dává meze zhruba 0,253 a 0,320', () => {
    const { low, high } = wilsonInterval(200, 700);
    expect(low).toBeCloseTo(0.2535, 3);
    expect(high).toBeCloseTo(0.3203, 3);
  });
});

describe('predictedOpens', () => {
  it('dopočítá rozsah z měřitelné části publika', () => {
    const counts = { ...emptyCounts(), delivered: 1000, opensUnique: 500, opensUniqueHuman: 200, opensUniqueApple: 300 };
    const prediction = predictedOpens(counts, 1000);
    expect(prediction).not.toBeNull();
    expect(prediction?.sampleSize).toBe(700);
    expect(prediction?.lowCount).toBe(Math.round(prediction!.low * 1000));
    expect(prediction?.highCount).toBe(Math.round(prediction!.high * 1000));
    expect(prediction!.lowCount).toBeLessThan(prediction!.highCount);
  });

  it('se nezobrazuje u malého vzorku, protože odhad by byl k ničemu', () => {
    const counts = { ...emptyCounts(), delivered: 220, opensUniqueHuman: 20, opensUniqueApple: 100 };
    expect(predictedOpens(counts, 220)).toBeNull();
  });

  it('se nezobrazuje, když nejsou žádní doručení', () => {
    expect(predictedOpens(emptyCounts(), 0)).toBeNull();
  });

  it('nikdy neodhadne víc otevření, než kolik je doručených', () => {
    const counts = { ...emptyCounts(), delivered: 1000, opensUniqueHuman: 690, opensUniqueApple: 300 };
    const prediction = predictedOpens(counts, 1000);
    expect(prediction!.highCount).toBeLessThanOrEqual(1000);
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/metrics/predicted-opens.test.ts`
Expected: FAIL, `Cannot find module './predicted-opens.js'`.

- [ ] **Krok 3: Napiš `metrics/predicted-opens.ts`**

```ts
import type { StatsCounts } from './counts.js';
import { SMALL_SAMPLE_THRESHOLD } from './rates.js';

/** Kvantil normálního rozdělení pro 95% interval. */
export const Z_95 = 1.959963984540054;

export type Interval = { low: number; high: number };

export type PredictedOpens = Interval & {
  lowCount: number;
  highCount: number;
  sampleSize: number;
};

/**
 * Wilsonův skórový interval. Proti obvyklému normálnímu intervalu se chová
 * rozumně i u malých podílů a nikdy nevyleze mimo interval nula až jedna,
 * což je u míry otevření podstatné: normální interval by u tří procent
 * vyrobil zápornou spodní mez a odhad by vypadal jako chyba.
 */
export function wilsonInterval(successes: number, sample: number, z: number = Z_95): Interval {
  if (sample <= 0) return { low: 0, high: 0 };
  const k = Math.min(Math.max(successes, 0), sample);
  const p = k / sample;
  const z2 = z * z;
  const denominator = 1 + z2 / sample;
  const center = (p + z2 / (2 * sample)) / denominator;
  const half =
    (z / denominator) * Math.sqrt((p * (1 - p)) / sample + z2 / (4 * sample * sample));
  return {
    low: Math.max(0, center - half),
    high: Math.min(1, center + half),
  };
}

/**
 * Prediktivní otevření: kolik lidí by e-mail otevřelo, kdyby se dalo měřit
 * u celého publika. Model bere ověřenou míru otevření z části publika, kterou
 * Apple nezkresluje, a promítne ji na všechny doručené.
 *
 * Vrací null, když je měřitelná část publika pod prahem malého vzorku.
 * Model nad padesáti lidmi by dal rozsah tak široký, že by nic neříkal,
 * a číslo, které nic neříká, je horší než žádné.
 */
export function predictedOpens(
  counts: StatsCounts,
  deliveredEffectiveValue: number,
): PredictedOpens | null {
  const sampleSize = deliveredEffectiveValue - counts.opensUniqueApple;
  if (deliveredEffectiveValue <= 0 || sampleSize < SMALL_SAMPLE_THRESHOLD) return null;

  const { low, high } = wilsonInterval(counts.opensUniqueHuman, sampleSize);
  return {
    low,
    high,
    lowCount: Math.round(low * deliveredEffectiveValue),
    highCount: Math.round(high * deliveredEffectiveValue),
    sampleSize,
  };
}
```

- [ ] **Krok 4: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/metrics/predicted-opens.test.ts`
Expected: PASS, `Tests  8 passed (8)`.

- [ ] **Krok 5: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add packages/core/src/reports/metrics/predicted-opens.ts packages/core/src/reports/metrics/predicted-opens.test.ts && git commit -m "feat(reports): add predicted opens as a Wilson interval range"
```

---

### Úkol 7: Pravidla zobrazení čísel

Rozhodnutí „co se má u téhle metriky vůbec ukázat" patří na server, ne do komponenty. Jinak se rozjede report, dashboard a export.

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/metrics/display.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/metrics/display.test.ts`

- [ ] **Krok 1: Napiš padající test**

`packages/core/src/reports/metrics/display.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { metricDisplay } from './display.js';

describe('metricDisplay', () => {
  it('u vypnutého měření vrací not_measured, nikdy nulu', () => {
    expect(metricDisplay({ rate: null, absolute: 0, enabled: false, smallSample: false, disabledReason: 'opens_disabled' })).toEqual({
      kind: 'not_measured',
      reason: 'opens_disabled',
    });
  });

  it('u nulového jmenovatele vrací dash, ne nulu ani NaN', () => {
    expect(metricDisplay({ rate: null, absolute: 0, enabled: true, smallSample: false, disabledReason: 'opens_disabled' })).toEqual({
      kind: 'dash',
    });
  });

  it('u malého vzorku vrací absolutní počet s příznakem', () => {
    expect(metricDisplay({ rate: 0.25, absolute: 12, enabled: true, smallSample: true, disabledReason: 'opens_disabled' })).toEqual({
      kind: 'absolute',
      value: 12,
      rate: 0.25,
      hint: 'small_sample',
    });
  });

  it('jinak vrací míru', () => {
    expect(metricDisplay({ rate: 0.164, absolute: 187, enabled: true, smallSample: false, disabledReason: 'clicks_disabled' })).toEqual({
      kind: 'rate',
      rate: 0.164,
      absolute: 187,
    });
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/metrics/display.test.ts`
Expected: FAIL, `Cannot find module './display.js'`.

- [ ] **Krok 3: Napiš `metrics/display.ts`**

```ts
export type DisabledReason = 'opens_disabled' | 'clicks_disabled';

/**
 * Vypnutý tracking nikdy nesmí vypadat jako nula (3.16 části 5).
 * Nula znamená "nikdo neotevřel", což je úplně jiná informace.
 */
export type MetricDisplay =
  | { kind: 'rate'; rate: number; absolute: number }
  | { kind: 'absolute'; value: number; rate: number; hint: 'small_sample' }
  | { kind: 'dash' }
  | { kind: 'not_measured'; reason: DisabledReason };

export function metricDisplay(input: {
  rate: number | null;
  absolute: number;
  enabled: boolean;
  smallSample: boolean;
  disabledReason: DisabledReason;
}): MetricDisplay {
  if (!input.enabled) return { kind: 'not_measured', reason: input.disabledReason };
  if (input.rate === null) return { kind: 'dash' };
  if (input.smallSample) {
    return { kind: 'absolute', value: input.absolute, rate: input.rate, hint: 'small_sample' };
  }
  return { kind: 'rate', rate: input.rate, absolute: input.absolute };
}
```

- [ ] **Krok 4: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/metrics/display.test.ts`
Expected: PASS, `Tests  4 passed (4)`.

- [ ] **Krok 5: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add packages/core/src/reports/metrics/display.ts packages/core/src/reports/metrics/display.test.ts && git commit -m "feat(reports): never render disabled tracking as zero"
```

---

### Úkol 8: Čtení souhrnu kampaně

`createTestTx` a `testContext` už existují z úkolu 2 a nepíšou se znovu.

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/campaign-stats/read.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/campaign-stats/read.db.test.ts`

- [ ] **Krok 1: Napiš padající test**

`packages/core/src/reports/campaign-stats/read.db.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestTx, startTestDatabase, testContext, type TestDatabase } from '../test-support/db.js';
import { seedCampaign, seedCampaignStats, seedWorkspace } from '../test-support/fixtures.js';
import { readCampaignStats } from './read.js';

describe('readCampaignStats', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('vrátí nuly a verzi 0 pro kampaň, která ještě nemá řádek agregace', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId, { status: 'draft' });
    const result = await readCampaignStats(
      createTestTx(db),
      testContext(ws.workspaceId),
      campaign.campaignId,
    );
    expect(result.counts.sent).toBe(0);
    expect(result.version).toBe(0);
    expect(result.status).toBe('draft');
    expect(result.rates.openRate).toBeNull();
  });

  it('složí souhrn z campaign_stats a spočítá míry', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId, { providerType: 'ses' });
    await seedCampaignStats(db, ws.workspaceId, campaign.campaignId, {
      materialized: 1000,
      sent: 1000,
      delivered: 1000,
      opens_unique: 500,
      opens_unique_human: 200,
      opens_unique_apple: 300,
      clicks_unique_human: 187,
      unsubscribed: 4,
    });
    const result = await readCampaignStats(
      createTestTx(db),
      testContext(ws.workspaceId),
      campaign.campaignId,
    );
    expect(result.deliveredSource).toBe('provider_events');
    expect(result.deliveredEffective).toBe(1000);
    expect(result.rates.clickRate).toBeCloseTo(0.187, 10);
    expect(result.rates.verifiedOpenRate).toBeCloseTo(200 / 700, 10);
    expect(result.breakdown).toMatchObject({ verified: 200, machine: 300, uncertain: 0 });
    expect(result.smallSample).toBe(false);
    expect(result.version).toBeGreaterThan(0);
  });

  it('u SMTP provideru odvozuje doručení z odeslaných', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId, { providerType: 'smtp' });
    await seedCampaignStats(db, ws.workspaceId, campaign.campaignId, {
      sent: 100,
      delivered: 0,
      bounced_hard: 3,
      failed: 1,
    });
    const result = await readCampaignStats(
      createTestTx(db),
      testContext(ws.workspaceId),
      campaign.campaignId,
    );
    expect(result.deliveredSource).toBe('derived_from_sent');
    expect(result.deliveredEffective).toBe(96);
  });

  it('u kampaně s vypnutým měřením otevření vrací null místo nuly (kritérium 65)', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId, { trackOpens: false });
    await seedCampaignStats(db, ws.workspaceId, campaign.campaignId, { sent: 500, delivered: 500 });
    const result = await readCampaignStats(
      createTestTx(db),
      testContext(ws.workspaceId),
      campaign.campaignId,
    );
    expect(result.trackOpens).toBe(false);
    expect(result.rates.openRate).toBeNull();
  });

  it('označí malý vzorek pod dvěma sty doručenými (kritérium 66)', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    await seedCampaignStats(db, ws.workspaceId, campaign.campaignId, { sent: 150, delivered: 150 });
    const result = await readCampaignStats(
      createTestTx(db),
      testContext(ws.workspaceId),
      campaign.campaignId,
    );
    expect(result.smallSample).toBe(true);
  });

  it('kampaň jiného projektu hlásí not_found, ne forbidden (kvůli enumeraci)', async () => {
    const mine = await seedWorkspace(db);
    const other = await seedWorkspace(db);
    const campaign = await seedCampaign(db, other.workspaceId);
    await expect(
      readCampaignStats(
        createTestTx(db),
        testContext(mine.workspaceId),
        campaign.campaignId,
      ),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/campaign-stats/read.db.test.ts`
Expected: FAIL, `Cannot find module './read.js'`.

- [ ] **Krok 3: Napiš `campaign-stats/read.ts`**

```ts
import { sql } from 'drizzle-orm';
import type { Tx } from '@mlain/core/tx';
import type { WorkspaceContext } from '@mlain/core/identity';
import { countsFromRow, type StatsCounts } from '../metrics/counts.js';
import {
  computeRates,
  deliveredEffective,
  isSmallSample,
  type DeliveredSource,
  type Rates,
} from '../metrics/rates.js';
import { openBreakdown, type OpenBreakdown } from '../metrics/open-breakdown.js';
import { predictedOpens, type PredictedOpens } from '../metrics/predicted-opens.js';
import { notFound } from '../errors.js';

export type CampaignStatsRead = {
  campaignId: string;
  name: string;
  subject: string;
  /** Otevřený výčet, registr vlastní část 4a. Klient nesmí dělat exhaustivní switch. */
  status: string;
  trackOpens: boolean;
  trackClicks: boolean;
  deliveredSource: DeliveredSource;
  counts: StatsCounts;
  deliveredEffective: number;
  rates: Rates;
  breakdown: OpenBreakdown;
  predicted: PredictedOpens | null;
  smallSample: boolean;
  audienceBuiltAt: Date | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  firstEventAt: Date | null;
  lastEventAt: Date | null;
  updatedAt: Date;
  version: number;
};

/**
 * Neznámý typ provideru není chyba: výčet je podle 3.11 části 4a otevřený.
 * Rozhodne se podle toho, jestli od něj kdy přišla událost doručení.
 */
export function resolveDeliveredSource(
  providerType: string | null,
  counts: StatsCounts,
): DeliveredSource {
  if (providerType === 'smtp') return 'derived_from_sent';
  if (providerType === 'ses') return 'provider_events';
  return counts.delivered > 0 ? 'provider_events' : 'derived_from_sent';
}

export async function readCampaignStats(
  tx: Tx,
  ctx: WorkspaceContext,
  campaignId: string,
): Promise<CampaignStatsRead> {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT c.id            AS campaign_id,
           c.name,
           c.subject,
           c.status,
           c.track_opens,
           c.track_clicks,
           c.audience_built_at,
           c.started_at,
           c.finished_at,
           p.type          AS provider_type,
           s.materialized, s.sent, s.failed, s.skipped, s.delivered,
           s.bounced_hard, s.bounced_soft, s.complained, s.unsubscribed,
           s.opens_total, s.opens_unique, s.opens_unique_human, s.opens_unique_apple,
           s.clicks_total, s.clicks_unique, s.clicks_unique_human, s.clicks_scanner,
           s.first_event_at, s.last_event_at, s.updated_at, s.version
      FROM campaigns c
      LEFT JOIN campaign_stats s
             ON s.campaign_id = c.id AND s.workspace_id = c.workspace_id
      LEFT JOIN sending_providers p
             ON p.id = c.provider_id AND p.workspace_id = c.workspace_id
     WHERE c.workspace_id = ${ctx.workspaceId}
       AND c.id = ${campaignId}
       AND c.deleted_at IS NULL
  `);

  const row = rows[0];
  if (!row) throw notFound('campaign');

  const counts = countsFromRow(row);
  const trackOpens = row.track_opens === true;
  const trackClicks = row.track_clicks === true;
  const deliveredSource = resolveDeliveredSource(
    typeof row.provider_type === 'string' ? row.provider_type : null,
    counts,
  );
  const de = deliveredEffective(counts, deliveredSource);

  return {
    campaignId: String(row.campaign_id),
    name: String(row.name ?? ''),
    subject: String(row.subject ?? ''),
    status: String(row.status),
    trackOpens,
    trackClicks,
    deliveredSource,
    counts,
    deliveredEffective: de,
    rates: computeRates(counts, deliveredSource, { trackOpens, trackClicks }),
    breakdown: openBreakdown(counts),
    predicted: trackOpens ? predictedOpens(counts, de) : null,
    smallSample: isSmallSample(de),
    audienceBuiltAt: asDate(row.audience_built_at),
    startedAt: asDate(row.started_at),
    finishedAt: asDate(row.finished_at),
    firstEventAt: asDate(row.first_event_at),
    lastEventAt: asDate(row.last_event_at),
    updatedAt: asDate(row.updated_at) ?? new Date(0),
    version: Number(row.version ?? 0),
  };
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}
```

- [ ] **Krok 4: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/campaign-stats/read.db.test.ts`
Expected: PASS, `Tests  6 passed (6)`.

- [ ] **Krok 5: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add packages/core/src/reports/campaign-stats/read.ts packages/core/src/reports/campaign-stats/read.db.test.ts && git commit -m "feat(reports): read campaign summary with honest denominators"
```

---

### Úkol 9: Otisk pro živé aktualizace

`version` řídí `ETag`. Kdyby ji ale některý zapisovatel zapomněl zvýšit, spojení by mlčelo a report by tiše zamrzl na starých číslech. Otisk to přežije a zároveň to nahlásí.

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/campaign-stats/fingerprint.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/campaign-stats/fingerprint.test.ts`

- [ ] **Krok 1: Napiš padající test**

`packages/core/src/reports/campaign-stats/fingerprint.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { emptyCounts } from '../metrics/counts.js';
import { detectStaleVersion, statsFingerprint } from './fingerprint.js';

const base = {
  version: 4711,
  updatedAt: new Date('2026-07-31T14:00:00.000Z'),
  counts: { ...emptyCounts(), sent: 12043, delivered: 11890, opensUnique: 3120 },
};

describe('statsFingerprint', () => {
  it('je pro stejný vstup stejný', () => {
    expect(statsFingerprint(base)).toBe(statsFingerprint({ ...base }));
  });

  it('se změní se změnou verze', () => {
    expect(statsFingerprint({ ...base, version: 4712 })).not.toBe(statsFingerprint(base));
  });

  it('se změní i tehdy, když se změní počty a verze zůstane stejná', () => {
    const changed = { ...base, counts: { ...base.counts, opensUnique: 3121 } };
    expect(statsFingerprint(changed)).not.toBe(statsFingerprint(base));
  });
});

describe('detectStaleVersion', () => {
  it('nehlásí nic, když se s počty zvýšila i verze', () => {
    const next = { ...base, version: 4712, counts: { ...base.counts, opensUnique: 3121 } };
    expect(detectStaleVersion(base, next)).toBe(false);
  });

  it('nahlásí zapisovatele, který změnil počty a nezvýšil verzi', () => {
    const next = { ...base, counts: { ...base.counts, opensUnique: 3121 } };
    expect(detectStaleVersion(base, next)).toBe(true);
  });

  it('nehlásí nic, když se nezměnilo nic', () => {
    expect(detectStaleVersion(base, { ...base })).toBe(false);
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/campaign-stats/fingerprint.test.ts`
Expected: FAIL, `Cannot find module './fingerprint.js'`.

- [ ] **Krok 3: Napiš `campaign-stats/fingerprint.ts`**

```ts
import type { StatsCounts } from '../metrics/counts.js';

export type FingerprintInput = {
  version: number;
  updatedAt: Date;
  counts: StatsCounts;
};

/**
 * Otisk stavu kampaně. SSE poller podle něj rozhoduje, jestli má co poslat.
 * `ETag` zůstává podle 4.2 části 5 `W/"<version>"`; otisk je pojistka pro případ,
 * že by některý zapisovatel `version` nezvýšil.
 */
export function statsFingerprint(input: FingerprintInput): string {
  const c = input.counts;
  return [
    input.version,
    c.sent,
    c.failed,
    c.delivered,
    c.bouncedHard + c.bouncedSoft,
    c.complained,
    c.unsubscribed,
    c.opensUnique,
    c.opensUniqueHuman,
    c.opensUniqueApple,
    c.clicksUnique,
    c.clicksUniqueHuman,
    input.updatedAt.getTime(),
  ].join(':');
}

/**
 * Vrací true, když se změnily počty, ale `version` zůstala. To je porušení
 * dohody se zapisovateli (P10 a P13) a musí se ohlásit, ne přejít mlčky.
 */
export function detectStaleVersion(previous: FingerprintInput, next: FingerprintInput): boolean {
  if (next.version !== previous.version) return false;
  return countsKey(next.counts) !== countsKey(previous.counts);
}

function countsKey(c: StatsCounts): string {
  return [
    c.sent,
    c.failed,
    c.delivered,
    c.bouncedHard,
    c.bouncedSoft,
    c.complained,
    c.unsubscribed,
    c.opensUnique,
    c.opensUniqueHuman,
    c.opensUniqueApple,
    c.clicksUnique,
    c.clicksUniqueHuman,
  ].join(':');
}
```

- [ ] **Krok 4: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/campaign-stats/fingerprint.test.ts`
Expected: PASS, `Tests  6 passed (6)`.

- [ ] **Krok 5: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add packages/core/src/reports/campaign-stats/fingerprint.ts packages/core/src/reports/campaign-stats/fingerprint.test.ts && git commit -m "feat(reports): detect writers that forget to bump stats version"
```

---

### Úkol 10: Průběh v čase a jeho granularity

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/campaign-stats/buckets.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/campaign-stats/buckets.db.test.ts`

- [ ] **Krok 1: Napiš padající test**

`packages/core/src/reports/campaign-stats/buckets.db.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestTx, startTestDatabase, testContext, type TestDatabase } from '../test-support/db.js';
import { seedCampaign, seedWorkspace } from '../test-support/fixtures.js';
import { readCampaignBuckets } from './buckets.js';

describe('readCampaignBuckets', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  async function seedBuckets(workspaceId: string, campaignId: string) {
    const rows: Array<[string, number, number, number, number, number]> = [
      ['2026-07-31T12:00:00.000Z', 100, 90, 10, 2, 1],
      ['2026-07-31T12:05:00.000Z', 200, 190, 30, 5, 0],
      ['2026-07-31T13:00:00.000Z', 50, 48, 8, 1, 0],
      ['2026-08-01T09:00:00.000Z', 10, 10, 2, 0, 0],
    ];
    for (const [at, sent, delivered, opens, clicks, bounced] of rows) {
      await db.pool.query(
        `INSERT INTO campaign_stats_buckets
           (campaign_id, workspace_id, bucket_at, sent, delivered, opens_unique, clicks_unique, bounced)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [campaignId, workspaceId, at, sent, delivered, opens, clicks, bounced],
      );
    }
  }

  it('vrací pětiminutové bloky tak, jak jsou', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    await seedBuckets(ws.workspaceId, campaign.campaignId);
    const result = await readCampaignBuckets(createTestTx(db), testContext(ws.workspaceId), {
      campaignId: campaign.campaignId,
      granularity: '5m',
      timezone: 'Europe/Prague',
    });
    expect(result.points).toHaveLength(4);
    expect(result.points[0]).toMatchObject({ sent: 100, delivered: 90, opensUnique: 10 });
  });

  it('slévá do hodin', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    await seedBuckets(ws.workspaceId, campaign.campaignId);
    const result = await readCampaignBuckets(createTestTx(db), testContext(ws.workspaceId), {
      campaignId: campaign.campaignId,
      granularity: 'hour',
      timezone: 'Europe/Prague',
    });
    expect(result.points).toHaveLength(3);
    expect(result.points[0]).toMatchObject({ sent: 300, delivered: 280, opensUnique: 40, clicksUnique: 7 });
  });

  it('slévá do dnů v časové zóně projektu, ne v UTC', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    await db.pool.query(
      `INSERT INTO campaign_stats_buckets
         (campaign_id, workspace_id, bucket_at, sent, delivered, opens_unique, clicks_unique, bounced)
       VALUES ($1, $2, '2026-07-31T22:30:00.000Z', 7, 7, 0, 0, 0)`,
      [campaign.campaignId, ws.workspaceId],
    );
    const prague = await readCampaignBuckets(createTestTx(db), testContext(ws.workspaceId), {
      campaignId: campaign.campaignId,
      granularity: 'day',
      timezone: 'Europe/Prague',
    });
    const utc = await readCampaignBuckets(createTestTx(db), testContext(ws.workspaceId), {
      campaignId: campaign.campaignId,
      granularity: 'day',
      timezone: 'UTC',
    });
    // 22:30 UTC je 1. srpna v Praze, ale ještě 31. července v UTC.
    expect(prague.points[0]?.at).not.toBe(utc.points[0]?.at);
  });

  it('u kampaně jiného projektu vrací prázdno', async () => {
    const mine = await seedWorkspace(db);
    const other = await seedWorkspace(db);
    const campaign = await seedCampaign(db, other.workspaceId);
    await seedBuckets(other.workspaceId, campaign.campaignId);
    const result = await readCampaignBuckets(createTestTx(db), testContext(mine.workspaceId), {
      campaignId: campaign.campaignId,
      granularity: '5m',
      timezone: 'UTC',
    });
    expect(result.points).toEqual([]);
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/campaign-stats/buckets.db.test.ts`
Expected: FAIL, `Cannot find module './buckets.js'`.

- [ ] **Krok 3: Napiš `campaign-stats/buckets.ts`**

```ts
import { sql } from 'drizzle-orm';
import type { Tx } from '@mlain/core/tx';
import type { WorkspaceContext } from '@mlain/core/identity';

export type Granularity = '5m' | 'hour' | 'day';

export type BucketPoint = {
  at: string;
  sent: number;
  delivered: number;
  opensUnique: number;
  clicksUnique: number;
  bounced: number;
};

export type BucketsResult = {
  granularity: Granularity;
  points: BucketPoint[];
  /**
   * Bloky starší třiceti dní slévá retenční job P10 do hodinových (3.15.2, krok 5).
   * Report to musí přiznat, jinak si uživatel myslí, že v datech je díra.
   */
  compacted: boolean;
};

const MAX_POINTS = 10_000;
const COMPACTION_AFTER_DAYS = 30;

export async function readCampaignBuckets(
  tx: Tx,
  ctx: WorkspaceContext,
  input: { campaignId: string; granularity: Granularity; timezone: string },
): Promise<BucketsResult> {
  const rows = await selectPoints(tx, ctx, input);
  const points = rows.map((row) => ({
    at: new Date(row.at as string | Date).toISOString(),
    sent: Number(row.sent ?? 0),
    delivered: Number(row.delivered ?? 0),
    opensUnique: Number(row.opens_unique ?? 0),
    clicksUnique: Number(row.clicks_unique ?? 0),
    bounced: Number(row.bounced ?? 0),
  }));

  const oldest = points[0]?.at ? new Date(points[0].at) : null;
  const compacted =
    input.granularity === '5m' &&
    oldest !== null &&
    Date.now() - oldest.getTime() > COMPACTION_AFTER_DAYS * 24 * 60 * 60 * 1000;

  return { granularity: input.granularity, points, compacted };
}

async function selectPoints(
  tx: Tx,
  ctx: WorkspaceContext,
  input: { campaignId: string; granularity: Granularity; timezone: string },
): Promise<Array<Record<string, unknown>>> {
  if (input.granularity === '5m') {
    const { rows } = await tx.execute<Record<string, unknown>>(sql`
      SELECT bucket_at AS at, sent, delivered, opens_unique, clicks_unique, bounced
        FROM campaign_stats_buckets
       WHERE workspace_id = ${ctx.workspaceId}
         AND campaign_id  = ${input.campaignId}
       ORDER BY bucket_at
       LIMIT ${MAX_POINTS}
    `);
    return rows;
  }

  if (input.granularity === 'hour') {
    const { rows } = await tx.execute<Record<string, unknown>>(sql`
      SELECT date_trunc('hour', bucket_at) AS at,
             sum(sent)          AS sent,
             sum(delivered)     AS delivered,
             sum(opens_unique)  AS opens_unique,
             sum(clicks_unique) AS clicks_unique,
             sum(bounced)       AS bounced
        FROM campaign_stats_buckets
       WHERE workspace_id = ${ctx.workspaceId}
         AND campaign_id  = ${input.campaignId}
       GROUP BY 1
       ORDER BY 1
       LIMIT ${MAX_POINTS}
    `);
    return rows;
  }

  // Den se počítá v časové zóně projektu, ne v UTC. Kampaň odeslaná ve 23:30
  // patří v Praze do dalšího dne a report to musí ukázat tak, jak to vidí uživatel.
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT (date_trunc('day', bucket_at AT TIME ZONE ${input.timezone}) AT TIME ZONE ${input.timezone}) AS at,
           sum(sent)          AS sent,
           sum(delivered)     AS delivered,
           sum(opens_unique)  AS opens_unique,
           sum(clicks_unique) AS clicks_unique,
           sum(bounced)       AS bounced
      FROM campaign_stats_buckets
     WHERE workspace_id = ${ctx.workspaceId}
       AND campaign_id  = ${input.campaignId}
     GROUP BY 1
     ORDER BY 1
     LIMIT ${MAX_POINTS}
  `);
  return rows;
}
```

- [ ] **Krok 4: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/campaign-stats/buckets.db.test.ts`
Expected: PASS, `Tests  4 passed (4)`.

- [ ] **Krok 5: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add packages/core/src/reports/campaign-stats/buckets.ts packages/core/src/reports/campaign-stats/buckets.db.test.ts && git commit -m "feat(reports): read campaign progress buckets in three granularities"
```

---

### Úkol 11: Statistika odkazů

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/campaign-stats/links.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/campaign-stats/links.db.test.ts`

- [ ] **Krok 1: Napiš padající test**

`packages/core/src/reports/campaign-stats/links.db.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestTx, startTestDatabase, testContext, type TestDatabase } from '../test-support/db.js';
import { seedCampaign, seedWorkspace } from '../test-support/fixtures.js';
import { readCampaignLinks } from './links.js';

describe('readCampaignLinks', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  async function seedLink(
    workspaceId: string,
    campaignId: string,
    position: number,
    url: string,
    label: string,
    stats: { total: number; unique: number; human: number } | null,
  ) {
    const linkId = randomUUID();
    await db.pool.query(
      `INSERT INTO campaign_links (id, workspace_id, campaign_id, url, position, label)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [linkId, workspaceId, campaignId, url, position, label],
    );
    if (stats) {
      await db.pool.query(
        `INSERT INTO campaign_link_stats (workspace_id, campaign_id, link_id, clicks_total, clicks_unique, clicks_human)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [workspaceId, campaignId, linkId, stats.total, stats.unique, stats.human],
      );
    }
    return linkId;
  }

  it('řadí odkazy sestupně podle ověřených prokliků a počítá podíl', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    await seedLink(ws.workspaceId, campaign.campaignId, 0, 'https://x.cz/nabidka', 'Zobrazit nabídku', {
      total: 142,
      unique: 112,
      human: 142,
    });
    await seedLink(ws.workspaceId, campaign.campaignId, 1, 'https://x.cz/kola', 'Kola do 20 000 Kč', {
      total: 48,
      unique: 41,
      human: 48,
    });
    const links = await readCampaignLinks(
      createTestTx(db),
      testContext(ws.workspaceId),
      campaign.campaignId,
    );
    expect(links.map((l) => l.label)).toEqual(['Zobrazit nabídku', 'Kola do 20 000 Kč']);
    expect(links[0]?.share).toBeCloseTo(142 / 190, 10);
    expect(links[0]?.clicksUnique).toBe(112);
  });

  it('vrací i odkaz, na který nikdo neklikl, s nulami', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    await seedLink(ws.workspaceId, campaign.campaignId, 0, 'https://x.cz/a', 'A', null);
    const links = await readCampaignLinks(
      createTestTx(db),
      testContext(ws.workspaceId),
      campaign.campaignId,
    );
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ clicksHuman: 0, share: 0 });
  });

  it('označí dva odkazy se stejnou adresou, aby se v reportu nepletly', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    await seedLink(ws.workspaceId, campaign.campaignId, 0, 'https://x.cz/a', 'Obrázek', { total: 5, unique: 5, human: 5 });
    await seedLink(ws.workspaceId, campaign.campaignId, 1, 'https://x.cz/a', 'Text pod obrázkem', { total: 3, unique: 3, human: 3 });
    const links = await readCampaignLinks(
      createTestTx(db),
      testContext(ws.workspaceId),
      campaign.campaignId,
    );
    expect(links.every((l) => l.duplicateUrl)).toBe(true);
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/campaign-stats/links.db.test.ts`
Expected: FAIL, `Cannot find module './links.js'`.

- [ ] **Krok 3: Napiš `campaign-stats/links.ts`**

```ts
import { sql } from 'drizzle-orm';
import type { Tx } from '@mlain/core/tx';
import type { WorkspaceContext } from '@mlain/core/identity';

export type CampaignLinkStat = {
  linkId: string;
  url: string;
  label: string | null;
  position: number;
  clicksTotal: number;
  clicksUnique: number;
  clicksHuman: number;
  share: number;
  /** Dva odkazy na tutéž adresu (obrázek a text pod ním) jsou dva řádky, ne chyba. */
  duplicateUrl: boolean;
};

const MAX_LINKS = 200;

export async function readCampaignLinks(
  tx: Tx,
  ctx: WorkspaceContext,
  campaignId: string,
): Promise<CampaignLinkStat[]> {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT l.id       AS link_id,
           l.url,
           l.label,
           l.position,
           coalesce(s.clicks_total, 0)  AS clicks_total,
           coalesce(s.clicks_unique, 0) AS clicks_unique,
           coalesce(s.clicks_human, 0)  AS clicks_human
      FROM campaign_links l
      LEFT JOIN campaign_link_stats s
             ON s.link_id = l.id
            AND s.campaign_id = l.campaign_id
            AND s.workspace_id = l.workspace_id
     WHERE l.workspace_id = ${ctx.workspaceId}
       AND l.campaign_id  = ${campaignId}
     ORDER BY coalesce(s.clicks_human, 0) DESC, l.position ASC
     LIMIT ${MAX_LINKS}
  `);

  const parsed = rows.map((row) => ({
    linkId: String(row.link_id),
    url: String(row.url),
    label: row.label === null || row.label === undefined ? null : String(row.label),
    position: Number(row.position ?? 0),
    clicksTotal: Number(row.clicks_total ?? 0),
    clicksUnique: Number(row.clicks_unique ?? 0),
    clicksHuman: Number(row.clicks_human ?? 0),
  }));

  const totalHuman = parsed.reduce((sum, link) => sum + link.clicksHuman, 0);
  const urlCounts = new Map<string, number>();
  for (const link of parsed) urlCounts.set(link.url, (urlCounts.get(link.url) ?? 0) + 1);

  return parsed.map((link) => ({
    ...link,
    share: totalHuman > 0 ? link.clicksHuman / totalHuman : 0,
    duplicateUrl: (urlCounts.get(link.url) ?? 0) > 1,
  }));
}
```

- [ ] **Krok 4: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/campaign-stats/links.db.test.ts`
Expected: PASS, `Tests  3 passed (3)`.

- [ ] **Krok 5: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add packages/core/src/reports/campaign-stats/links.ts packages/core/src/reports/campaign-stats/links.db.test.ts && git commit -m "feat(reports): add link statistics with share and duplicate marking"
```

---

### Úkol 12: Seznam příjemců, včetně těch, kteří už neexistují

Zadavatel schválil, že smazání kontaktu nemaže historii kampaní. Report o smazaném člověku tedy musí umět mlčet, ne spadnout.

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/campaign-stats/recipients.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/campaign-stats/recipients.db.test.ts`

- [ ] **Krok 1: Napiš padající test**

`packages/core/src/reports/campaign-stats/recipients.db.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestTx, startTestDatabase, testContext, type TestDatabase } from '../test-support/db.js';
import { seedCampaign, seedContact, seedMessageEvent, seedWorkspace } from '../test-support/fixtures.js';
import { readCampaignRecipients } from './recipients.js';

describe('readCampaignRecipients', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  async function seedMessage(
    workspaceId: string,
    campaignId: string,
    createdAt: Date,
    contactId: string | null,
    engagement?: {
      firstOpenAt?: string;
      firstHumanOpenAt?: string;
      firstClickAt?: string;
      firstHumanClickAt?: string;
      openMask?: number;
      erased?: boolean;
    },
  ) {
    const messageId = randomUUID();
    await db.pool.query(
      `INSERT INTO messages (id, workspace_id, campaign_id, contact_id, email, status, created_at, sent_at)
       VALUES ($1, $2, $3, $4, $5, 'sent', $6, $6)`,
      [messageId, workspaceId, campaignId, contactId ?? randomUUID(), 'x@example.cz', createdAt],
    );
    if (engagement) {
      await db.pool.query(
        `INSERT INTO message_engagement
           (message_id, created_at, workspace_id, campaign_id, contact_id, erased_at,
            first_open_at, first_human_open_at, open_count, open_class_mask,
            first_click_at, first_human_click_at, click_count)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          messageId,
          createdAt,
          workspaceId,
          campaignId,
          engagement.erased ? null : contactId,
          engagement.erased ? new Date() : null,
          engagement.firstOpenAt ?? null,
          engagement.firstHumanOpenAt ?? null,
          engagement.firstOpenAt ? 1 : 0,
          engagement.openMask ?? 0,
          engagement.firstClickAt ?? null,
          engagement.firstHumanClickAt ?? null,
          engagement.firstClickAt ? 1 : 0,
        ],
      );
    }
    return messageId;
  }

  it('vrátí i příjemce bez jediné události pod filtrem not_opened', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    const contact = await seedContact(db, ws.workspaceId, { email: 'ticho@example.cz' });
    await seedMessage(ws.workspaceId, campaign.campaignId, campaign.audienceBuiltAt, contact);

    const page = await readCampaignRecipients(
      createTestTx(db),
      testContext(ws.workspaceId),
      { campaignId: campaign.campaignId, filter: 'not_opened', limit: 50 },
    );
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ email: 'ticho@example.cz', firstOpenAt: null, contactState: 'active' });
    expect(page.hasMore).toBe(false);
  });

  it('filtr machine_open_only vrací jen zprávy, kde je otevření výhradně automatické', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    const apple = await seedContact(db, ws.workspaceId, { email: 'apple@example.cz' });
    const human = await seedContact(db, ws.workspaceId, { email: 'human@example.cz' });
    await seedMessage(ws.workspaceId, campaign.campaignId, campaign.audienceBuiltAt, apple, {
      firstOpenAt: '2026-07-31T13:00:00.000Z',
      openMask: 2,
    });
    await seedMessage(ws.workspaceId, campaign.campaignId, campaign.audienceBuiltAt, human, {
      firstOpenAt: '2026-07-31T13:00:00.000Z',
      firstHumanOpenAt: '2026-07-31T13:00:00.000Z',
      openMask: 1 | 2,
    });

    const page = await readCampaignRecipients(
      createTestTx(db),
      testContext(ws.workspaceId),
      { campaignId: campaign.campaignId, filter: 'machine_open_only', limit: 50 },
    );
    expect(page.items.map((i) => i.email)).toEqual(['apple@example.cz']);
    expect(page.items[0]?.openReliability).toBe('machine');
  });

  it('smazaný kontakt se zobrazí jako řádek bez osobních údajů, ne jako pád', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    const contact = await seedContact(db, ws.workspaceId, { email: 'pryc@example.cz' });
    await seedMessage(ws.workspaceId, campaign.campaignId, campaign.audienceBuiltAt, contact, {
      firstOpenAt: '2026-07-31T13:00:00.000Z',
      firstHumanOpenAt: '2026-07-31T13:00:00.000Z',
      openMask: 1,
      erased: true,
    });
    await db.pool.query(`DELETE FROM contacts WHERE id = $1`, [contact]);

    const page = await readCampaignRecipients(
      createTestTx(db),
      testContext(ws.workspaceId),
      { campaignId: campaign.campaignId, filter: 'opened', limit: 50 },
    );
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ contactId: null, email: null, name: null, contactState: 'erased' });
  });

  it('anonymizovaný kontakt zůstane v seznamu s náhradními údaji, ne s prázdnem', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    const contact = await seedContact(db, ws.workspaceId, { email: 'anonym@example.cz' });
    await seedMessage(ws.workspaceId, campaign.campaignId, campaign.audienceBuiltAt, contact, {
      firstOpenAt: '2026-07-31T13:00:00.000Z',
      firstHumanOpenAt: '2026-07-31T13:00:00.000Z',
      openMask: 1,
    });
    // Tvar anonymizace vlastní P07: řádek zůstává, osobní údaje mizí.
    await db.pool.query(
      `UPDATE contacts
          SET anonymized_at = now(), first_name = NULL, last_name = NULL,
              email = ('erased+' || id || '@erased.invalid')::citext
        WHERE id = $1`,
      [contact],
    );

    const page = await readCampaignRecipients(
      createTestTx(db),
      testContext(ws.workspaceId),
      { campaignId: campaign.campaignId, filter: 'opened', limit: 50 },
    );
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ contactId: contact, email: null, name: null, contactState: 'erased' });
    expect(page.items[0]?.openCount).toBe(1);
  });

  it('stránkuje kurzorem a nevrací položku dvakrát', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    for (let i = 0; i < 5; i += 1) {
      const contact = await seedContact(db, ws.workspaceId, { email: `p${i}@example.cz` });
      await seedMessage(ws.workspaceId, campaign.campaignId, campaign.audienceBuiltAt, contact);
    }
    const tx = createTestTx(db);
    const ctx = testContext(ws.workspaceId);
    const first = await readCampaignRecipients(tx, ctx, {
      campaignId: campaign.campaignId,
      filter: 'all',
      limit: 2,
    });
    expect(first.items).toHaveLength(2);
    expect(first.hasMore).toBe(true);
    const second = await readCampaignRecipients(tx, ctx, {
      campaignId: campaign.campaignId,
      filter: 'all',
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });
    const overlap = first.items.filter((a) => second.items.some((b) => b.messageId === a.messageId));
    expect(overlap).toEqual([]);
  });

  it('filtr bounced čte z událostí a nevrací zprávu dvakrát ani při obou tvrdostech', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    const contact = await seedContact(db, ws.workspaceId, { email: 'odraz@example.cz' });
    const messageId = await seedMessage(ws.workspaceId, campaign.campaignId, campaign.audienceBuiltAt, contact);
    // Tvrdost odrazu nese TYP, ne subtype (R19). Zapisuje se přes seedMessageEvent,
    // který doplní povinný `source` a adresu vyžadovanou ck_message_events__recipient.
    for (const type of ['bounced_soft', 'bounced_hard']) {
      await seedMessageEvent(db, {
        workspaceId: ws.workspaceId,
        campaignId: campaign.campaignId,
        messageId,
        messageCreatedAt: campaign.audienceBuiltAt,
        contactId: contact,
        type,
        recipient: 'odraz@example.cz',
      });
    }
    const page = await readCampaignRecipients(
      createTestTx(db),
      testContext(ws.workspaceId),
      { campaignId: campaign.campaignId, filter: 'bounced', limit: 50 },
    );
    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.email).toBe('odraz@example.cz');
  });

  it('filtr complained najde stížnost pod jménem, které schéma zná', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    const contact = await seedContact(db, ws.workspaceId, { email: 'stiznost@example.cz' });
    const messageId = await seedMessage(ws.workspaceId, campaign.campaignId, campaign.audienceBuiltAt, contact);
    await seedMessageEvent(db, {
      workspaceId: ws.workspaceId,
      campaignId: campaign.campaignId,
      messageId,
      messageCreatedAt: campaign.audienceBuiltAt,
      contactId: contact,
      type: 'complained',
      recipient: 'stiznost@example.cz',
    });
    const page = await readCampaignRecipients(
      createTestTx(db),
      testContext(ws.workspaceId),
      { campaignId: campaign.campaignId, filter: 'complained', limit: 50 },
    );
    expect(page.items.map((i) => i.email)).toEqual(['stiznost@example.cz']);
  });

  it('stránka příjemců se čte z indexu, ne přes řazení celého oddílu (R20)', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    for (let i = 0; i < 40; i += 1) {
      const contact = await seedContact(db, ws.workspaceId, { email: `x${i}@example.cz` });
      await seedMessage(ws.workspaceId, campaign.campaignId, campaign.audienceBuiltAt, contact);
    }
    await db.pool.query('ANALYZE messages');
    const { rows } = await db.pool.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN (FORMAT TEXT)
       SELECT m.id, m.contact_id FROM messages m
        WHERE m.workspace_id = $1 AND m.campaign_id = $2 AND m.created_at = $3
        ORDER BY m.contact_id DESC LIMIT 51`,
      [ws.workspaceId, campaign.campaignId, campaign.audienceBuiltAt],
    );
    const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
    // Bez uq_messages__campaign_contact by tu byl Sort nad celým oddílem.
    expect(plan).toMatch(/uq_messages__campaign_contact/);
    expect(plan).not.toMatch(/\bSort\b/);
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/campaign-stats/recipients.db.test.ts`
Expected: FAIL, `Cannot find module './recipients.js'`.

- [ ] **Krok 3: Napiš `campaign-stats/recipients.ts`**

```ts
import { sql, type SQL } from 'drizzle-orm';
import type { Tx } from '@mlain/core/tx';
import type { WorkspaceContext } from '@mlain/core/identity';
import { decodeCursor, encodeCursor } from '../cursor.js';
import { BOUNCE_TYPES } from '../event-types.js';
import { notFound, validationFailed } from '../errors.js';

export const RECIPIENT_FILTERS = [
  'all',
  'opened',
  'clicked',
  'not_opened',
  'not_clicked',
  'bounced',
  'complained',
  'unsubscribed',
  'machine_open_only',
] as const;

export type RecipientFilter = (typeof RECIPIENT_FILTERS)[number];

/** Bity masky tříd otevření podle 2.6 části 5. */
const MASK_HUMAN = 1;
const MASK_PROXY_APPLE = 2;
const MASK_PROXY_IMAGE = 4;

/**
 * Řadí se podle `messages.contact_id` (R20), protože `uq_messages__campaign_contact
 * (campaign_id, contact_id, created_at)` z P03 dává při pevném `campaign_id`
 * přesně tohle uspořádání a zároveň zaručuje jeho jednoznačnost uvnitř kampaně.
 * Podle `messages.id` žádný index není a stránka by se platila setříděním
 * celého měsíčního oddílu.
 */
export const RECIPIENTS_ORDER = 'contact_id.desc';

export type RecipientItem = {
  messageId: string;
  /** null u kontaktu, jehož vazbu odstřihl GDPR výmaz. */
  contactId: string | null;
  email: string | null;
  name: string | null;
  contactState: 'active' | 'deleted' | 'erased';
  firstOpenAt: string | null;
  firstClickAt: string | null;
  openCount: number;
  clickCount: number;
  openReliability: 'confirmed' | 'machine' | null;
};

export type RecipientsPage = {
  items: RecipientItem[];
  hasMore: boolean;
  nextCursor: string | null;
};

/**
 * Jména typů podle `ck_message_events__type` (R19). Odraz je jeden pojem
 * se dvěma tvrdostmi a obě jsou vlastní typ, ne `subtype`.
 */
const EVENT_FILTERS: Partial<Record<RecipientFilter, readonly string[]>> = {
  bounced: BOUNCE_TYPES,
  complained: ['complained'],
  unsubscribed: ['unsubscribe'],
};

export async function readCampaignRecipients(
  tx: Tx,
  ctx: WorkspaceContext,
  input: { campaignId: string; filter: RecipientFilter; limit: number; cursor?: string },
): Promise<RecipientsPage> {
  if (!RECIPIENT_FILTERS.includes(input.filter)) {
    throw validationFailed('filter', 'unknown_recipient_filter', 'Neznámý filtr příjemců.');
  }
  const limit = Math.min(Math.max(input.limit, 1), 200);
  const after = input.cursor ? decodeCursor(input.cursor, RECIPIENTS_ORDER).k[0] ?? null : null;

  const { rows: campaignRows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT audience_built_at
      FROM campaigns
     WHERE workspace_id = ${ctx.workspaceId} AND id = ${input.campaignId} AND deleted_at IS NULL
  `);
  const campaign = campaignRows[0];
  if (!campaign) throw notFound('campaign');
  // Invariant I1: všechny zprávy kampaně mají created_at rovné audience_built_at.
  // Bez téhle podmínky by dotaz prošel všechny partition messages.
  const partitionKey = campaign.audience_built_at as Date | string | null;
  if (partitionKey === null) return { items: [], hasMore: false, nextCursor: null };

  const eventTypes = EVENT_FILTERS[input.filter];
  const rows = eventTypes
    ? await selectByEvents(tx, ctx, input.campaignId, partitionKey, eventTypes, after, limit + 1)
    : await selectByEngagement(tx, ctx, input.campaignId, partitionKey, input.filter, after, limit + 1);

  const hasMore = rows.length > limit;
  const kept = rows.slice(0, limit);
  const page = kept.map(toItem);
  // Kurzor nese contact_id z řádku, ne z položky: `RecipientItem.contactId`
  // je u vymazané vazby null a stránkování by se na něm zastavilo.
  const lastRow = kept[kept.length - 1];

  return {
    items: page,
    hasMore,
    nextCursor:
      hasMore && lastRow
        ? encodeCursor({ k: [String(lastRow.cursor_contact_id)], d: 'n', o: RECIPIENTS_ORDER })
        : null,
  };
}

function engagementPredicate(filter: RecipientFilter): SQL {
  switch (filter) {
    case 'opened':
      return sql`me.first_open_at IS NOT NULL`;
    case 'not_opened':
      return sql`me.first_open_at IS NULL`;
    case 'clicked':
      return sql`me.first_click_at IS NOT NULL`;
    case 'not_clicked':
      return sql`me.first_click_at IS NULL`;
    case 'machine_open_only':
      return sql`(me.open_class_mask & ${MASK_PROXY_APPLE}) <> 0
                 AND (me.open_class_mask & ${MASK_HUMAN | MASK_PROXY_IMAGE}) = 0`;
    default:
      return sql`TRUE`;
  }
}

async function selectByEngagement(
  tx: Tx,
  ctx: WorkspaceContext,
  campaignId: string,
  partitionKey: Date | string,
  filter: RecipientFilter,
  after: string | null,
  limit: number,
): Promise<Array<Record<string, unknown>>> {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT m.id AS message_id,
           m.contact_id,
           m.contact_id AS cursor_contact_id,
           c.id AS contact_row_id,
           c.email AS contact_email,
           c.first_name,
           c.last_name,
           c.deleted_at,
           c.anonymized_at,
           c.status AS contact_status,
           me.first_open_at,
           me.first_click_at,
           me.first_human_open_at,
           me.open_count,
           me.click_count,
           me.open_class_mask,
           me.erased_at
      FROM messages m
      LEFT JOIN message_engagement me
             ON me.message_id = m.id AND me.created_at = m.created_at
      LEFT JOIN contacts c
             ON c.id = m.contact_id AND c.workspace_id = m.workspace_id
     WHERE m.workspace_id = ${ctx.workspaceId}
       AND m.campaign_id  = ${campaignId}
       AND m.created_at   = ${partitionKey}
       AND ${engagementPredicate(filter)}
       AND (${after}::uuid IS NULL OR m.contact_id < ${after}::uuid)
     ORDER BY m.contact_id DESC
     LIMIT ${limit}
  `);
  return rows;
}

/**
 * Odrazy, stížnosti a odhlášení jsou v message_events, ne v engagementu.
 * Seskupení podle zprávy je nutné: jedna zpráva může mít měkký i tvrdý odraz
 * a v seznamu příjemců patří jednou.
 *
 * `sql.param` u pole je POVINNÝ. Holé pole vložené do šablony `sql` Drizzle
 * rozloží na jednotlivé parametry, takže `= ANY($1, $2)` je syntaktická chyba
 * a dotaz spadne při prvním použití. S `sql.param` se pole předá jako jedna
 * hodnota a přetypování `::text[]` řekne ovladači, co s ní.
 */
async function selectByEvents(
  tx: Tx,
  ctx: WorkspaceContext,
  campaignId: string,
  partitionKey: Date | string,
  types: readonly string[],
  after: string | null,
  limit: number,
): Promise<Array<Record<string, unknown>>> {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT m.id AS message_id,
           m.contact_id,
           m.contact_id AS cursor_contact_id,
           c.id AS contact_row_id,
           c.email AS contact_email,
           c.first_name,
           c.last_name,
           c.deleted_at,
           c.anonymized_at,
           c.status AS contact_status,
           me.first_open_at,
           me.first_click_at,
           me.first_human_open_at,
           me.open_count,
           me.click_count,
           me.open_class_mask,
           me.erased_at
      FROM message_events e
      JOIN messages m
        ON m.id = e.message_id AND m.created_at = e.message_created_at
      LEFT JOIN message_engagement me
             ON me.message_id = m.id AND me.created_at = m.created_at
      LEFT JOIN contacts c
             ON c.id = m.contact_id AND c.workspace_id = m.workspace_id
     WHERE e.workspace_id = ${ctx.workspaceId}
       AND e.campaign_id  = ${campaignId}
       AND e.type         = ANY(${sql.param([...types])}::text[])
       AND e.received_at >= ${partitionKey}
       AND m.created_at   = ${partitionKey}
       AND (${after}::uuid IS NULL OR m.contact_id < ${after}::uuid)
     GROUP BY m.id, m.contact_id, c.id, c.email, c.first_name, c.last_name,
              c.deleted_at, c.anonymized_at, c.status, me.first_open_at, me.first_click_at,
              me.first_human_open_at, me.open_count, me.click_count,
              me.open_class_mask, me.erased_at
     ORDER BY m.contact_id DESC
     LIMIT ${limit}
  `);
  return rows;
}

function toItem(row: Record<string, unknown>): RecipientItem {
  const erasedInTracking = row.erased_at !== null && row.erased_at !== undefined;
  // P07 kontakt anonymizuje, tedy řádek nechá a osobní údaje z něj vymaže.
  // Pro report je to totéž jako výmaz vazby: údaje nejsou, čísla platí.
  const anonymized = row.anonymized_at !== null && row.anonymized_at !== undefined;
  const contactMissing = row.contact_row_id === null || row.contact_row_id === undefined;
  const softDeleted =
    row.deleted_at !== null && row.deleted_at !== undefined ? true : row.contact_status === 'deleted';

  const contactState: RecipientItem['contactState'] =
    erasedInTracking || anonymized
      ? 'erased'
      : contactMissing || softDeleted
        ? 'deleted'
        : 'active';

  const visible = contactState === 'active';
  const firstName = typeof row.first_name === 'string' ? row.first_name : '';
  const lastName = typeof row.last_name === 'string' ? row.last_name : '';
  const name = `${firstName} ${lastName}`.trim();

  return {
    messageId: String(row.message_id),
    // Anonymizovaný kontakt si ID nechává: v aplikaci na něj jde prokliknout
    // a uvidí se, že takový člověk existoval. Vymazaná vazba ID nemá.
    contactId: erasedInTracking || contactMissing ? null : String(row.contact_id),
    email: visible && typeof row.contact_email === 'string' ? row.contact_email : null,
    name: visible && name.length > 0 ? name : null,
    contactState,
    firstOpenAt: toIso(row.first_open_at),
    firstClickAt: toIso(row.first_click_at),
    openCount: Number(row.open_count ?? 0),
    clickCount: Number(row.click_count ?? 0),
    openReliability: openReliability(row),
  };
}

function openReliability(row: Record<string, unknown>): RecipientItem['openReliability'] {
  if (row.first_open_at === null || row.first_open_at === undefined) return null;
  return row.first_human_open_at ? 'confirmed' : 'machine';
}

function toIso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}
```

- [ ] **Krok 4: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/campaign-stats/recipients.db.test.ts`
Expected: PASS, `Tests  8 passed (8)`.

- [ ] **Krok 5: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add packages/core/src/reports/campaign-stats/recipients.ts packages/core/src/reports/campaign-stats/recipients.db.test.ts && git commit -m "feat(reports): list campaign recipients and survive deleted contacts"
```

---

### Úkol 13: Přepočet agregací a kontrola driftu

Bez přepočtu není jak dokázat, že přírůstkové čítače sedí. Tenhle úkol je zároveň jediná automatická kontrola, která rozdíl odhalí.

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/campaign-stats/recompute.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/campaign-stats/recompute.db.test.ts`

- [ ] **Krok 1: Napiš padající test**

`packages/core/src/reports/campaign-stats/recompute.db.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestTx, startTestDatabase, testContext, type TestDatabase } from '../test-support/db.js';
import { seedCampaign, seedCampaignStats, seedContact, seedMessageEvent, seedWorkspace } from '../test-support/fixtures.js';
import { compareWithStored, recomputeCampaignCounts } from './recompute.js';

describe('recomputeCampaignCounts', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  async function seedFullCampaign() {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    // tři zprávy: jedna ověřeně otevřená a prokliknutá, jedna jen Apple, jedna beze všeho
    const cases = [
      { mask: 1, human: true, click: true },
      { mask: 2, human: false, click: false },
      { mask: 0, human: false, click: false },
    ];
    for (const item of cases) {
      const contact = await seedContact(db, ws.workspaceId);
      const messageId = randomUUID();
      await db.pool.query(
        `INSERT INTO messages (id, workspace_id, campaign_id, contact_id, email, status, created_at, sent_at)
         VALUES ($1, $2, $3, $4, 'x@example.cz', 'sent', $5, $5)`,
        [messageId, ws.workspaceId, campaign.campaignId, contact, campaign.audienceBuiltAt],
      );
      if (item.mask !== 0) {
        await db.pool.query(
          `INSERT INTO message_engagement
             (message_id, created_at, workspace_id, campaign_id, contact_id,
              first_open_at, first_human_open_at, open_count, human_open_count, open_class_mask,
              first_click_at, first_human_click_at, click_count, human_click_count)
           VALUES ($1, $2, $3, $4, $5, $2, $6, 1, $7, $8, $9, $10, $11, $11)`,
          [
            messageId,
            campaign.audienceBuiltAt,
            ws.workspaceId,
            campaign.campaignId,
            contact,
            item.human ? campaign.audienceBuiltAt : null,
            item.human ? 1 : 0,
            item.mask,
            item.click ? campaign.audienceBuiltAt : null,
            item.click ? campaign.audienceBuiltAt : null,
            item.click ? 1 : 0,
          ],
        );
      }
    }
    return { ws, campaign };
  }

  it('spočítá agregace od nuly z engagementu a událostí', async () => {
    const { ws, campaign } = await seedFullCampaign();
    const counts = await recomputeCampaignCounts(
      createTestTx(db),
      testContext(ws.workspaceId),
      campaign.campaignId,
    );
    expect(counts.materialized).toBe(3);
    expect(counts.sent).toBe(3);
    expect(counts.opensUnique).toBe(2);
    expect(counts.opensUniqueHuman).toBe(1);
    expect(counts.opensUniqueApple).toBe(1);
    expect(counts.clicksUniqueHuman).toBe(1);
  });

  it('nahlásí rozdíl mezi uloženou agregací a přepočtem', async () => {
    const { ws, campaign } = await seedFullCampaign();
    await seedCampaignStats(db, ws.workspaceId, campaign.campaignId, {
      materialized: 3,
      sent: 3,
      opens_unique: 99,
    });
    const drift = await compareWithStored(
      createTestTx(db),
      testContext(ws.workspaceId),
      campaign.campaignId,
    );
    expect(drift.matches).toBe(false);
    expect(drift.differences).toContainEqual({ key: 'opensUnique', stored: 99, recomputed: 2 });
  });

  it('spočítá doručení, oba odrazy a stížnost pod jmény ze schématu (R19)', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    const plan: Array<[string, string]> = [
      ['delivered', 'a@example.cz'],
      ['bounced_hard', 'b@example.cz'],
      ['bounced_soft', 'c@example.cz'],
      ['complained', 'd@example.cz'],
    ];
    for (const [type, email] of plan) {
      const contact = await seedContact(db, ws.workspaceId, { email });
      const messageId = randomUUID();
      await db.pool.query(
        `INSERT INTO messages (id, workspace_id, campaign_id, contact_id, email, status, created_at, sent_at)
         VALUES ($1, $2, $3, $4, $5, 'sent', $6, $6)`,
        [messageId, ws.workspaceId, campaign.campaignId, contact, email, campaign.audienceBuiltAt],
      );
      await seedMessageEvent(db, {
        workspaceId: ws.workspaceId,
        campaignId: campaign.campaignId,
        messageId,
        messageCreatedAt: campaign.audienceBuiltAt,
        contactId: contact,
        type,
        recipient: email,
      });
    }

    const counts = await recomputeCampaignCounts(
      createTestTx(db),
      testContext(ws.workspaceId),
      campaign.campaignId,
    );
    // Se starým slovníkem (`bounce`, `complaint`) by tu byly samé nuly
    // a žádný dotaz by přitom nespadl. To je celý smysl tohohle testu.
    expect(counts.delivered).toBe(1);
    expect(counts.bouncedHard).toBe(1);
    expect(counts.bouncedSoft).toBe(1);
    expect(counts.complained).toBe(1);
  });

  it('u správně vedené agregace nehlásí žádný rozdíl', async () => {
    const { ws, campaign } = await seedFullCampaign();
    const tx = createTestTx(db);
    const ctx = testContext(ws.workspaceId);
    const counts = await recomputeCampaignCounts(tx, ctx, campaign.campaignId);
    await seedCampaignStats(db, ws.workspaceId, campaign.campaignId, {
      materialized: counts.materialized,
      sent: counts.sent,
      failed: counts.failed,
      skipped: counts.skipped,
      delivered: counts.delivered,
      bounced_hard: counts.bouncedHard,
      bounced_soft: counts.bouncedSoft,
      complained: counts.complained,
      unsubscribed: counts.unsubscribed,
      opens_total: counts.opensTotal,
      opens_unique: counts.opensUnique,
      opens_unique_human: counts.opensUniqueHuman,
      opens_unique_apple: counts.opensUniqueApple,
      clicks_total: counts.clicksTotal,
      clicks_unique: counts.clicksUnique,
      clicks_unique_human: counts.clicksUniqueHuman,
      clicks_scanner: counts.clicksScanner,
    });
    const drift = await compareWithStored(tx, ctx, campaign.campaignId);
    expect(drift.differences).toEqual([]);
    expect(drift.matches).toBe(true);
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/campaign-stats/recompute.db.test.ts`
Expected: FAIL, `Cannot find module './recompute.js'`.

- [ ] **Krok 3: Napiš `campaign-stats/recompute.ts`**

```ts
import { sql } from 'drizzle-orm';
import type { Tx } from '@mlain/core/tx';
import type { WorkspaceContext } from '@mlain/core/identity';
import { countsFromRow, emptyCounts, type StatsCounts } from '../metrics/counts.js';
import { NON_HUMAN_CLICK_SUBTYPES } from '../event-types.js';
import { notFound } from '../errors.js';

const MASK_HUMAN = 1;
const MASK_PROXY_APPLE = 2;
const MASK_PROXY_IMAGE = 4;

/**
 * Přepočet agregací kampaně od nuly. Zdrojem pravdy jsou message_engagement,
 * messages a message_events, tedy tabulky, do kterých se zapisuje přímo.
 * Slouží ke třem věcem: rekonstrukci po havárii, kontrole driftu v testech
 * a budoucímu příkazu CLI, který dodá P16.
 */
export async function recomputeCampaignCounts(
  tx: Tx,
  ctx: WorkspaceContext,
  campaignId: string,
): Promise<StatsCounts> {
  const { rows: campaignRows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT audience_built_at
      FROM campaigns
     WHERE workspace_id = ${ctx.workspaceId} AND id = ${campaignId} AND deleted_at IS NULL
  `);
  const campaign = campaignRows[0];
  if (!campaign) throw notFound('campaign');
  const partitionKey = campaign.audience_built_at as Date | string | null;
  if (partitionKey === null) return emptyCounts();

  const { rows: messageRows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT count(*)                                          AS materialized,
           count(*) FILTER (WHERE status = 'sent')           AS sent,
           count(*) FILTER (WHERE status = 'failed')         AS failed,
           count(*) FILTER (WHERE status = 'skipped')        AS skipped
      FROM messages
     WHERE workspace_id = ${ctx.workspaceId}
       AND campaign_id  = ${campaignId}
       AND created_at   = ${partitionKey}
  `);

  const { rows: engagementRows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT coalesce(sum(open_count), 0)                      AS opens_total,
           count(*) FILTER (WHERE first_open_at IS NOT NULL) AS opens_unique,
           count(*) FILTER (WHERE first_human_open_at IS NOT NULL) AS opens_unique_human,
           count(*) FILTER (
             WHERE (open_class_mask & ${MASK_PROXY_APPLE}) <> 0
               AND (open_class_mask & ${MASK_HUMAN | MASK_PROXY_IMAGE}) = 0
           )                                                 AS opens_unique_apple,
           -- clicks_total je součet VŠECH prokliků, ne jen lidských. Human má
           -- vlastní čítač clicks_unique_human a P10 plní campaign_stats
           -- stejným způsobem. Se sum(human_click_count) by kontrola driftu
           -- hlásila rozdíl u každé kampaně, kterou navštívil skener.
           coalesce(sum(click_count), 0)                     AS clicks_total,
           count(*) FILTER (WHERE first_click_at IS NOT NULL) AS clicks_unique,
           count(*) FILTER (WHERE first_human_click_at IS NOT NULL) AS clicks_unique_human
      FROM message_engagement
     WHERE workspace_id = ${ctx.workspaceId}
       AND campaign_id  = ${campaignId}
       AND created_at   = ${partitionKey}
  `);

  // Jména typů drží ck_message_events__type (R19). Tvrdost odrazu nese TYP.
  // Filtr na `bounce` nebo `complaint` by nevrátil nic a nic by nespadlo.
  const { rows: eventRows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT count(DISTINCT message_id) FILTER (WHERE type = 'delivered')     AS delivered,
           count(DISTINCT message_id) FILTER (WHERE type = 'bounced_hard')  AS bounced_hard,
           count(DISTINCT message_id) FILTER (WHERE type = 'bounced_soft')  AS bounced_soft,
           count(DISTINCT message_id) FILTER (WHERE type = 'complained')    AS complained,
           count(DISTINCT message_id) FILTER (WHERE type = 'unsubscribe')   AS unsubscribed,
           count(*) FILTER (
             WHERE type = 'click' AND subtype = ANY(${sql.param([...NON_HUMAN_CLICK_SUBTYPES])}::text[])
           )                                                                AS clicks_scanner
      FROM message_events
     WHERE workspace_id = ${ctx.workspaceId}
       AND campaign_id  = ${campaignId}
       AND received_at >= ${partitionKey}
  `);

  return countsFromRow({
    ...(messageRows[0] ?? {}),
    ...(engagementRows[0] ?? {}),
    ...(eventRows[0] ?? {}),
  });
}

export type DriftReport = {
  matches: boolean;
  differences: Array<{ key: keyof StatsCounts; stored: number; recomputed: number }>;
};

export async function compareWithStored(
  tx: Tx,
  ctx: WorkspaceContext,
  campaignId: string,
): Promise<DriftReport> {
  const recomputed = await recomputeCampaignCounts(tx, ctx, campaignId);
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT * FROM campaign_stats
     WHERE workspace_id = ${ctx.workspaceId} AND campaign_id = ${campaignId}
  `);
  const stored = countsFromRow(rows[0]);

  const differences = (Object.keys(recomputed) as Array<keyof StatsCounts>)
    .filter((key) => stored[key] !== recomputed[key])
    .map((key) => ({ key, stored: stored[key], recomputed: recomputed[key] }));

  return { matches: differences.length === 0, differences };
}
```

- [ ] **Krok 4: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/campaign-stats/recompute.db.test.ts`
Expected: PASS, `Tests  4 passed (4)`.

- [ ] **Krok 5: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add packages/core/src/reports/campaign-stats/recompute.ts packages/core/src/reports/campaign-stats/recompute.db.test.ts && git commit -m "feat(reports): recompute campaign aggregates and report drift"
```

---

### Úkol 14: Průběh odesílání pro pruh a report

Průběh se čte z `campaign_stats` a `campaign_stats_buckets`, které plní **P10** jobem `tracking.refresh_campaign_progress`. Tenhle plán do nich nezapisuje ani jeden řádek, jen z nich čte a hlídá, že do sebe sedí.

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/progress/read.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/progress/read.db.test.ts`

- [ ] **Krok 1: Napiš padající test**

`packages/core/src/reports/progress/read.db.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestTx, startTestDatabase, testContext, type TestDatabase } from '../test-support/db.js';
import { seedCampaign, seedCampaignStats, seedWorkspace } from '../test-support/fixtures.js';
import { bucketDrift, readCampaignProgress } from './read.js';

describe('readCampaignProgress', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  async function seedBucket(workspaceId: string, campaignId: string, at: string, sent: number) {
    await db.pool.query(
      `INSERT INTO campaign_stats_buckets
         (campaign_id, workspace_id, bucket_at, sent, delivered, opens_unique, clicks_unique, bounced)
       VALUES ($1, $2, $3, $4, 0, 0, 0, 0)`,
      [campaignId, workspaceId, at, sent],
    );
  }

  it('vrátí průběh, který zapsal job P10', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId, { status: 'sending' });
    await seedCampaignStats(db, ws.workspaceId, campaign.campaignId, {
      materialized: 1129,
      sent: 428,
      failed: 2,
      skipped: 1,
    });

    const progress = await readCampaignProgress(
      createTestTx(db),
      testContext(ws.workspaceId),
      campaign.campaignId,
    );
    expect(progress).toMatchObject({ sent: 428, total: 1129, failed: 2, skipped: 1, isSending: true });
    expect(progress.percent).toBeCloseTo(428 / 1129, 10);
  });

  it('u kampaně bez materializace nevrací procenta, ale null', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId, { status: 'draft' });
    const progress = await readCampaignProgress(
      createTestTx(db),
      testContext(ws.workspaceId),
      campaign.campaignId,
    );
    expect(progress.percent).toBeNull();
    expect(progress.isSending).toBe(false);
  });

  it('nahlásí rozdíl mezi součtem bloků a čítačem, protože obojí píše týž job', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId, { status: 'sending' });
    await seedCampaignStats(db, ws.workspaceId, campaign.campaignId, { materialized: 100, sent: 30 });
    await seedBucket(ws.workspaceId, campaign.campaignId, '2026-07-31T12:00:00.000Z', 10);
    await seedBucket(ws.workspaceId, campaign.campaignId, '2026-07-31T12:05:00.000Z', 10);

    const drift = await bucketDrift(
      createTestTx(db),
      testContext(ws.workspaceId),
      campaign.campaignId,
    );
    expect(drift).toEqual({ statsSent: 30, bucketSum: 20, statsMissing: false, matches: false });
  });

  it('bloky bez řádku souhrnu jsou drift, ne shoda', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId, { status: 'sending' });
    // Bloky už zapsané, souhrn ještě ne. Job z P10 doběhl jen zpola.
    await seedBucket(ws.workspaceId, campaign.campaignId, '2026-07-31T12:00:00.000Z', 20);

    const drift = await bucketDrift(
      createTestTx(db),
      testContext(ws.workspaceId),
      campaign.campaignId,
    );
    // S `FROM campaign_stats` by dotaz nevrátil žádný řádek, obě čísla by byla
    // nula a funkce by ohlásila shodu, tedy pravý opak skutečnosti.
    expect(drift.statsMissing).toBe(true);
    expect(drift.bucketSum).toBe(20);
    expect(drift.matches).toBe(false);
  });

  it('u konzistentních dat žádný rozdíl nehlásí', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId, { status: 'sending' });
    await seedCampaignStats(db, ws.workspaceId, campaign.campaignId, { materialized: 100, sent: 20 });
    await seedBucket(ws.workspaceId, campaign.campaignId, '2026-07-31T12:00:00.000Z', 20);

    const drift = await bucketDrift(
      createTestTx(db),
      testContext(ws.workspaceId),
      campaign.campaignId,
    );
    expect(drift.matches).toBe(true);
  });

  it('kampaň jiného projektu hlásí not_found', async () => {
    const mine = await seedWorkspace(db);
    const other = await seedWorkspace(db);
    const campaign = await seedCampaign(db, other.workspaceId);
    await expect(
      readCampaignProgress(createTestTx(db), testContext(mine.workspaceId), campaign.campaignId),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/progress/read.db.test.ts`
Expected: FAIL, `Cannot find module './read.js'`.

- [ ] **Krok 3: Napiš `progress/read.ts`**

```ts
import { sql } from 'drizzle-orm';
import type { Tx } from '@mlain/core/tx';
import type { WorkspaceContext } from '@mlain/core/identity';
import { notFound } from '../errors.js';

/** Stavy, ve kterých se čísla ještě mění a obrazovka drží živý indikátor. */
const LIVE_STATUSES = new Set(['queueing', 'sending']);

export type CampaignProgress = {
  campaignId: string;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  percent: number | null;
  watermarkAt: string | null;
  isSending: boolean;
  status: string;
};

/**
 * Čtení průběhu odesílání. Zdrojem je `campaign_stats`, kterou plní job
 * `tracking.refresh_campaign_progress` z P10 (3.9.5 části 5).
 * Tenhle balíček do agregací nezapisuje, hlídá to test `ownership.test.ts`.
 */
export async function readCampaignProgress(
  tx: Tx,
  ctx: WorkspaceContext,
  campaignId: string,
): Promise<CampaignProgress> {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT c.status,
           coalesce(s.materialized, 0)  AS materialized,
           coalesce(s.sent, 0)          AS sent,
           coalesce(s.failed, 0)        AS failed,
           coalesce(s.skipped, 0)       AS skipped,
           s.progress_watermark_at
      FROM campaigns c
      LEFT JOIN campaign_stats s ON s.campaign_id = c.id AND s.workspace_id = c.workspace_id
     WHERE c.workspace_id = ${ctx.workspaceId} AND c.id = ${campaignId} AND c.deleted_at IS NULL
  `);

  const row = rows[0];
  if (!row) throw notFound('campaign');

  const total = Number(row.materialized ?? 0);
  const sent = Number(row.sent ?? 0);
  const status = String(row.status);

  return {
    campaignId,
    total,
    sent,
    failed: Number(row.failed ?? 0),
    skipped: Number(row.skipped ?? 0),
    // Procenta z nuly nejsou nula, jsou to procenta z ničeho. Proto null.
    percent: total > 0 ? Math.min(sent / total, 1) : null,
    watermarkAt: row.progress_watermark_at
      ? new Date(row.progress_watermark_at as string | Date).toISOString()
      : null,
    isSending: LIVE_STATUSES.has(status),
    status,
  };
}

export type BucketDrift = {
  statsSent: number;
  bucketSum: number;
  /** Kampaň má bloky, ale řádek souhrnu ještě ne. Job z P10 nedoběhl. */
  statsMissing: boolean;
  matches: boolean;
};

/**
 * Čítač `campaign_stats.sent` a součet bloků píše tentýž job. Když se rozejdou,
 * report ukazuje jiné číslo v dlaždici než v grafu a nikdo neví, které platí.
 * Tahle funkce ten rozdíl pojmenuje. Nic neopravuje: oprava patří do P10.
 *
 * Řídicí tabulka je `campaigns`, ne `campaign_stats`. Řádek agregace vzniká
 * líně až prvním během jobu, a právě stav „bloky už jsou, souhrn ještě ne"
 * je drift, který má tahle funkce najít. S `FROM campaign_stats` by dotaz
 * nevrátil žádný řádek, obě čísla by spadla na nulu a funkce by ohlásila
 * `matches: true`, tedy pravý opak skutečnosti.
 */
export async function bucketDrift(
  tx: Tx,
  ctx: WorkspaceContext,
  campaignId: string,
): Promise<BucketDrift> {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT coalesce(s.sent, 0) AS stats_sent,
           coalesce((
             SELECT sum(b.sent) FROM campaign_stats_buckets b
              WHERE b.workspace_id = c.workspace_id AND b.campaign_id = c.id
           ), 0) AS bucket_sum,
           (s.campaign_id IS NULL) AS stats_missing
      FROM campaigns c
      LEFT JOIN campaign_stats s ON s.campaign_id = c.id AND s.workspace_id = c.workspace_id
     WHERE c.workspace_id = ${ctx.workspaceId} AND c.id = ${campaignId}
       AND c.deleted_at IS NULL
  `);

  const row = rows[0];
  if (!row) throw notFound('campaign');

  const statsSent = Number(row.stats_sent ?? 0);
  const bucketSum = Number(row.bucket_sum ?? 0);
  return {
    statsSent,
    bucketSum,
    statsMissing: row.stats_missing === true,
    matches: statsSent === bucketSum,
  };
}
```

- [ ] **Krok 4: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/progress/read.db.test.ts`
Expected: PASS, `Tests  6 passed (6)`.

- [ ] **Krok 5: Ověř, že frontu průběhu skutečně obsluhuje P10**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && node apps/worker/codegen.mjs && grep -n "tracking.refresh_campaign_progress" apps/worker/src/handlers.generated.ts && grep -rln "refresh_campaign_progress" packages/core --include=*.ts | grep -v "packages/core/src/reports"
```
Expected: fronta je v generovaném souboru a obsluhuje ji modul mimo `packages/core/src/reports`, typicky `packages/core/tracking/jobs/queue-handlers.ts`. Když handler neexistuje nikde, je to **blokující nález proti P10**: bez něj se průběh odesílání nikdy nepohne. Zapiš ho do kapitoly 7 a neřeš ho v tomhle plánu.

- [ ] **Krok 6: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add packages/core/src/reports/progress && git commit -m "feat(reports): read sending progress written by the tracking job"
```

---

### Úkol 15: Pojistka pravidla o jediném zapisovateli

`campaign_stats` má jediného zapisovatele a je jím P10. Pravidlo, které hlídá jen člověk při čtení kódu, není pravidlo. Tenhle úkol dodává test, který jeho porušení zachytí sám.

**Files:**
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/ownership.test.ts`

- [ ] **Krok 1: Napiš padající test**

`packages/core/src/reports/ownership.test.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const PACKAGE_ROOT = path.resolve(import.meta.dirname);

/** Tabulky, do kterých tenhle balíček nesmí zapsat ani jeden řádek. */
const READ_ONLY_TABLES = [
  'campaign_stats',
  'campaign_stats_buckets',
  'campaign_link_stats',
  'contact_engagement',
  'message_engagement',
  'message_events',
  'messages',
  'web_events',
  'web_event_months',
  'campaigns',
  'contacts',
];

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      // Fixtures smějí zapisovat: simulují to, co v provozu zapíše P10 a P13.
      return entry.name === 'test-support' ? [] : sourceFiles(full);
    }
    if (!entry.name.endsWith('.ts')) return [];
    if (entry.name.includes('.test.')) return [];
    return [full];
  });
}

describe('vlastnictví zápisu', () => {
  it('balíček reports nikam nezapisuje, jen čte', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(PACKAGE_ROOT)) {
      const source = fs.readFileSync(file, 'utf8');
      for (const table of READ_ONLY_TABLES) {
        const write = new RegExp(
          `(INSERT\\s+INTO|UPDATE|DELETE\\s+FROM)\\s+${table}\\b`,
          'i',
        );
        if (write.test(source)) offenders.push(`${path.relative(PACKAGE_ROOT, file)} -> ${table}`);
      }
    }
    expect(offenders, 'zápis do cizí tabulky').toEqual([]);
  });

  it('balíček reports neobsluhuje žádnou frontu', () => {
    expect(fs.existsSync(path.join(PACKAGE_ROOT, 'jobs'))).toBe(false);
  });

  it('seznam hlídaných tabulek pokrývá všechny agregace části 5', () => {
    for (const table of ['campaign_stats', 'campaign_stats_buckets', 'campaign_link_stats']) {
      expect(READ_ONLY_TABLES).toContain(table);
    }
  });

  it('na proměnné kontextu Hono a na transakci sahá jediný soubor', () => {
    // Adaptér má smysl jen tehdy, když je opravdu jediný. Jakmile si druhá
    // cesta sáhne na `c.get('auth')` nebo si otevře vlastní transakci,
    // přestane být rozdíl proti P04 opravou na jednom místě.
    const offenders: string[] = [];
    for (const file of sourceFiles(PACKAGE_ROOT)) {
      const relative = path.relative(PACKAGE_ROOT, file);
      if (relative === path.join('api', 'context.ts')) continue;
      const source = fs.readFileSync(file, 'utf8');
      if (/c\.get\(\s*'auth'\s*\)/.test(source)) offenders.push(`${relative} -> c.get('auth')`);
      if (/\bwithWorkspace\s*\(/.test(source)) offenders.push(`${relative} -> withWorkspace`);
    }
    expect(offenders, 'kontext Hono nebo transakce mimo api/context.ts').toEqual([]);
  });

  it('doména neimportuje z apps/web ani z kořene @mlain/db', () => {
    // Graf závislostí z 3.11 části 1 opačný směr zakazuje. Kořen @mlain/db
    // navíc `schema` nereexportuje (R37 v P03), takže by import prošel
    // typovou kontrolou a spadl až za běhu.
    const offenders: string[] = [];
    for (const file of sourceFiles(PACKAGE_ROOT)) {
      const source = fs.readFileSync(file, 'utf8');
      for (const bad of [/from '(\.\.\/)*apps\/web/, /from '@mlain\/db'/]) {
        if (bad.test(source)) offenders.push(path.relative(PACKAGE_ROOT, file));
      }
    }
    expect(offenders, 'zakázaný import').toEqual([]);
  });
});
```

`runMigrations` z kořene `@mlain/db` potřebuje jen `test-support/db.ts`, a ten je
z prohlídky vyjmutý spolu s celým adresářem fixtures.

- [ ] **Krok 2: Spusť test a ověř výsledek**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/ownership.test.ts`
Expected: PASS, `Tests  5 passed (5)`.

Když test padne, **neupravuj test**. Padající test znamená, že v balíčku vznikl zápis do tabulky, kterou vlastní jiný plán, a to se řeší odstraněním zápisu.

- [ ] **Krok 3: Ověř, že se test dostane i do CI**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core test:unit 2>&1 | grep -c "ownership.test.ts"
```
Expected: aspoň `1`, tedy test běží v běžné jednotkové sadě, ne jen na vyžádání.

- [ ] **Krok 4: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add packages/core/src/reports/ownership.test.ts && git commit -m "test(reports): enforce single writer rule for campaign aggregates"
```

---



### Úkol 16: Typy časové osy a mapa měsíců

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/timeline/types.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/timeline/months.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/timeline/months.db.test.ts`

- [ ] **Krok 1: Napiš padající test**

`packages/core/src/reports/timeline/months.db.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestTx, startTestDatabase, testContext, type TestDatabase } from '../test-support/db.js';
import { seedContact, seedWorkspace } from '../test-support/fixtures.js';
import { listWebEventMonths, pickWindow } from './months.js';

describe('mapa měsíců webových událostí', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('vrací měsíce sestupně a jen pro daný kontakt', async () => {
    const ws = await seedWorkspace(db);
    const contact = await seedContact(db, ws.workspaceId);
    const other = await seedContact(db, ws.workspaceId);
    for (const month of ['2026-05-01', '2026-07-01', '2026-06-01']) {
      await db.pool.query(
        `INSERT INTO web_event_months (workspace_id, subject_kind, subject_id, month)
         VALUES ($1, 'contact', $2, $3)`,
        [ws.workspaceId, contact, month],
      );
    }
    await db.pool.query(
      `INSERT INTO web_event_months (workspace_id, subject_kind, subject_id, month)
       VALUES ($1, 'contact', $2, '2026-01-01')`,
      [ws.workspaceId, other],
    );

    const months = await listWebEventMonths(
      createTestTx(db),
      testContext(ws.workspaceId),
      contact,
    );
    expect(months.map((m) => m.toISOString().slice(0, 7))).toEqual(['2026-07', '2026-06', '2026-05']);
  });
});

describe('pickWindow', () => {
  const SCOPE = new Date('2020-01-01T00:00:00.000Z');

  it('vezme nejvýš tři měsíce na jeden požadavek', () => {
    const window = pickWindow(new Date('2026-07-31T23:59:59.000Z'), SCOPE, 37);
    expect(window.from.toISOString()).toBe('2026-05-01T00:00:00.000Z');
    expect(window.to.toISOString()).toBe('2026-07-31T23:59:59.000Z');
  });

  it('nikdy nesestoupí pod začátek rozsahu, který uživatel zvolil', () => {
    const window = pickWindow(new Date('2026-07-31T23:59:59.000Z'), new Date('2026-07-10T00:00:00.000Z'), 37);
    expect(window.from.toISOString()).toBe('2026-07-10T00:00:00.000Z');
  });

  it('okno webových událostí sahá o sedm dní dál kvůli offline frontě', () => {
    const window = pickWindow(new Date('2026-07-31T00:00:00.000Z'), SCOPE, 37);
    expect(window.webReceivedTo.getTime() - window.to.getTime()).toBe(7 * 24 * 60 * 60 * 1000);
  });

  it('dolní mez webových událostí má minutovou rezervu, kterou ck_web_events__lag povoluje', () => {
    const window = pickWindow(new Date('2026-07-31T00:00:00.000Z'), SCOPE, 37);
    expect(window.from.getTime() - window.webReceivedFrom.getTime()).toBe(60 * 1000);
  });

  it('okno událostí zprávy je řádově širší než webové, jinak by zpožděný odraz vypadl (R21)', () => {
    const window = pickWindow(new Date('2026-07-31T00:00:00.000Z'), SCOPE, 37);
    expect(window.messageReceivedTo.getTime()).toBeGreaterThan(window.webReceivedTo.getTime());
    // Sedmidenní strop platí jen pro web_events. message_events žádný nemá.
    expect(window.messageReceivedTo.getTime() - window.to.getTime()).toBe(37 * 31 * 24 * 60 * 60 * 1000);
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/timeline/months.db.test.ts`
Expected: FAIL, `Cannot find module './months.js'`.

- [ ] **Krok 3: Napiš `timeline/types.ts`**

```ts
/**
 * Položka časové osy. `source` i `type` jsou OTEVŘENÉ výčty a klient musí
 * neznámou hodnotu tolerovat (4.2 části 5). Proto je typ `string`, ne union:
 * union by v klientovi vyrobil exhaustivní switch, který se u nové hodnoty
 * chová nedefinovaně, a projevilo by se to až u zákazníka.
 */
export type TimelineRow = {
  id: string;
  occurredAt: Date;
  source: string;
  type: string;
  campaign?: { id: string; name: string };
  sessionId?: string;
  reliability?: 'confirmed' | 'machine';
  detail?: Record<string, unknown>;
  /** Sloty pro složení věty, viz timeline/titles.ts. */
  slots: Record<string, string | number>;
};

export type TimelineItem = {
  id: string;
  occurred_at: string;
  source: string;
  type: string;
  title: string;
  detail?: Record<string, unknown>;
  campaign?: { id: string; name: string };
  session_id?: string;
  reliability?: 'confirmed' | 'machine';
};

export type TimelineFilter = 'email' | 'web' | 'contact' | 'consent';

export const TIMELINE_ORDER = 'occurred_at.desc';
```

Třídy, které se do osy nikdy nedostanou (3.12.1), tady schválně **nejsou**:
bydlí v `event-types.ts` jako `HIDDEN_OPEN_SUBTYPES` a `NON_HUMAN_CLICK_SUBTYPES`
vedle slovníku, ke kterému patří. Dvě kopie téhož výčtu jsou zdroj rozporu,
který se pozná až tím, že jedna cesta filtruje a druhá ne.

- [ ] **Krok 4: Napiš `timeline/months.ts`**

```ts
import { sql } from 'drizzle-orm';
import type { Tx } from '@mlain/core/tx';
import type { WorkspaceContext } from '@mlain/core/identity';

/** Maximum měsíců na jeden požadavek podle 3.12.2 části 5. */
export const MAX_MONTHS_PER_REQUEST = 3;

/**
 * Zpoždění doručení WEBOVÉ události. Vynucuje ho `ck_web_events__lag` z P03:
 * `occurred_at > received_at - 7 days`. Offline fronta SDK dál nesahá,
 * dávkový import je z omezení vyňatý a `received_at` si odvozuje z `occurred_at`.
 */
export const WEB_MAX_LAG_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Dolní tolerance u webových událostí. Totéž omezení povoluje
 * `occurred_at <= received_at + 60 seconds`, takže `received_at` smí být až
 * o minutu PŘED `occurred_at`. Bez téhle rezervy by událost, která vznikla
 * těsně nad hranicí okna, z osy vypadla.
 */
export const WEB_LAG_TOLERANCE_MS = 60 * 1000;

/**
 * Zpoždění u událostí ZPRÁVY. `message_events` žádné omezení na vztah `ts`
 * a `received_at` nemá a mít nemůže (R21): asynchronní odraz od SES chodí
 * i po týdnech a `delivery_delayed` opakovaně. Mez se proto bere z retence,
 * ne ze sedmi dnů. Jedna sdílená konstanta by zpožděný odraz z osy **tiše**
 * vypustila, protože okno se posouvá spolu s ním.
 */
export function messageMaxLagMs(retentionMonths: number): number {
  return retentionMonths * 31 * 24 * 60 * 60 * 1000;
}

export type TimeWindow = {
  from: Date;
  to: Date;
  /** Dolní mez pro received_at u webových událostí, o minutu pod `from`. */
  webReceivedFrom: Date;
  /** Horní mez pro received_at u webových událostí. Prořezává partition. */
  webReceivedTo: Date;
  /** Horní mez pro received_at u událostí zprávy. Prořezává partition. */
  messageReceivedTo: Date;
};

export async function listWebEventMonths(
  tx: Tx,
  ctx: WorkspaceContext,
  contactId: string,
): Promise<Date[]> {
  const { rows } = await tx.execute<{ month: string | Date }>(sql`
    SELECT month
      FROM web_event_months
     WHERE workspace_id = ${ctx.workspaceId}
       AND subject_kind = 'contact'
       AND subject_id   = ${contactId}
     ORDER BY month DESC
  `);
  return rows.map((row) => new Date(row.month));
}

/**
 * Okno pro jeden požadavek. Jde vždy nejvýš tři kalendářní měsíce zpět od `to`,
 * a nikdy pod `scopeStart`, což je začátek rozsahu, který si uživatel zvolil.
 *
 * `retentionMonths` předává volající z `config.TRACKING_RETENTION_MONTHS` (P01).
 * Doména konfiguraci nečte sama, aby šla testovat bez prostředí.
 */
export function pickWindow(to: Date, scopeStart: Date, retentionMonths: number): TimeWindow {
  const startOfMonth = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  const candidate = new Date(
    Date.UTC(startOfMonth.getUTCFullYear(), startOfMonth.getUTCMonth() - (MAX_MONTHS_PER_REQUEST - 1), 1),
  );
  const from = candidate < scopeStart ? scopeStart : candidate;
  return {
    from,
    to,
    webReceivedFrom: new Date(from.getTime() - WEB_LAG_TOLERANCE_MS),
    webReceivedTo: new Date(to.getTime() + WEB_MAX_LAG_MS),
    messageReceivedTo: new Date(to.getTime() + messageMaxLagMs(retentionMonths)),
  };
}
```

- [ ] **Krok 5: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/timeline/months.db.test.ts`
Expected: PASS, `Tests  6 passed (6)`.

- [ ] **Krok 6: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add packages/core/src/reports/timeline/types.ts packages/core/src/reports/timeline/months.ts packages/core/src/reports/timeline/months.db.test.ts && git commit -m "feat(reports): add timeline types and month window picker"
```

---

### Úkol 17: Čtyři větve časové osy

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/timeline/branches.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/timeline/branches.db.test.ts`

- [ ] **Krok 1: Napiš padající test**

`packages/core/src/reports/timeline/branches.db.test.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestTx, startTestDatabase, testContext, type TestDatabase } from '../test-support/db.js';
import { ensurePartitions, seedCampaign, seedContact, seedMessageEvent, seedWorkspace } from '../test-support/fixtures.js';
import { messageBranch, messageEventBranch, contactBranch, webEventBranch } from './branches.js';
import { pickWindow } from './months.js';

// Okno se skládá stejně jako v provozu, aby se test neptal jiných čísel
// než produkční kód. Retence 37 měsíců je výchozí hodnota P01.
const WINDOW = pickWindow(
  new Date('2026-08-01T00:00:00.000Z'),
  new Date('2026-07-01T00:00:00.000Z'),
  37,
);

describe('větve časové osy', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('větev zpráv vrátí položku "dostal kampaň" i bez jediné události (kritérium 84)', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    const contact = await seedContact(db, ws.workspaceId);
    await db.pool.query(
      `INSERT INTO messages (id, workspace_id, campaign_id, contact_id, email, status, created_at, sent_at)
       VALUES ($1, $2, $3, $4, 'x@example.cz', 'sent', $5, '2026-07-31T14:38:00.000Z')`,
      [randomUUID(), ws.workspaceId, campaign.campaignId, contact, campaign.audienceBuiltAt],
    );

    const rows = await messageBranch(createTestTx(db), testContext(ws.workspaceId), {
      contactId: contact,
      window: WINDOW,
      limit: 51,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('message_sent');
    expect(rows[0]?.occurredAt.toISOString()).toBe('2026-07-31T14:38:00.000Z');
    expect(rows[0]?.campaign?.name).toBe('Letní výprodej');
  });

  it('větev událostí zprávy skryje boty, skenery a předstahování (kritérium 69)', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    const contact = await seedContact(db, ws.workspaceId);
    const messageId = randomUUID();
    await db.pool.query(
      `INSERT INTO messages (id, workspace_id, campaign_id, contact_id, email, status, created_at, sent_at)
       VALUES ($1, $2, $3, $4, 'x@example.cz', 'sent', $5, $5)`,
      [messageId, ws.workspaceId, campaign.campaignId, contact, campaign.audienceBuiltAt],
    );
    const events: Array<[string, string | null]> = [
      ['open', 'human'],
      ['open', 'proxy_apple'],
      ['open', 'bot'],
      ['click', 'human'],
      ['click', 'scanner'],
      ['delivered', null],
    ];
    for (const [type, subtype] of events) {
      await seedMessageEvent(db, {
        workspaceId: ws.workspaceId,
        campaignId: campaign.campaignId,
        messageId,
        messageCreatedAt: campaign.audienceBuiltAt,
        contactId: contact,
        type,
        subtype,
        ts: '2026-07-31T15:00:00.000Z',
      });
    }

    const rows = await messageEventBranch(createTestTx(db), testContext(ws.workspaceId), {
      contactId: contact,
      window: WINDOW,
      limit: 51,
    });
    const types = rows.map((r) => `${r.type}:${r.reliability ?? '-'}`);
    expect(types).toContain('message_opened:confirmed');
    expect(types).toContain('message_opened:machine');
    expect(types).toContain('message_clicked:confirmed');
    expect(types).toContain('message_delivered:-');
    expect(rows).toHaveLength(4);
  });

  it('odraz, který dorazil dlouho po odeslání, v ose zůstane (R21)', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    const contact = await seedContact(db, ws.workspaceId);
    const messageId = randomUUID();
    await db.pool.query(
      `INSERT INTO messages (id, workspace_id, campaign_id, contact_id, email, status, created_at, sent_at)
       VALUES ($1, $2, $3, $4, 'x@example.cz', 'sent', $5, $5)`,
      [messageId, ws.workspaceId, campaign.campaignId, contact, campaign.audienceBuiltAt],
    );
    // Událost vznikla uvnitř okna, ale provider ji doručil o třicet dní později.
    // Se sedmidenní mezí převzatou z ck_web_events__lag by z osy tiše zmizela.
    await ensurePartitions(db, new Date('2026-08-30T00:00:00.000Z'));
    await seedMessageEvent(db, {
      workspaceId: ws.workspaceId,
      campaignId: campaign.campaignId,
      messageId,
      messageCreatedAt: campaign.audienceBuiltAt,
      contactId: contact,
      type: 'bounced_soft',
      ts: '2026-07-31T15:00:00.000Z',
      receivedAt: '2026-08-30T15:00:00.000Z',
      recipient: 'x@example.cz',
    });

    const rows = await messageEventBranch(createTestTx(db), testContext(ws.workspaceId), {
      contactId: contact,
      window: WINDOW,
      limit: 51,
    });
    expect(rows.map((r) => r.type)).toEqual(['message_bounced']);
  });

  it('větev webu prořezává partition podle received_at', async () => {
    const ws = await seedWorkspace(db);
    const contact = await seedContact(db, ws.workspaceId);
    await ensurePartitions(db, new Date('2026-07-15T00:00:00.000Z'));
    await db.pool.query(
      `INSERT INTO web_events (id, received_at, occurred_at, workspace_id, name, contact_id, session_id, source, page)
       VALUES (gen_random_uuid(), '2026-07-15T10:00:00.000Z', '2026-07-15T09:59:00.000Z', $1, 'page_view', $2, gen_random_uuid(), 'web', $3)`,
      [ws.workspaceId, contact, JSON.stringify({ url: 'https://x.cz/kola', title: 'Kola' })],
    );

    const rows = await webEventBranch(createTestTx(db), testContext(ws.workspaceId), {
      contactId: contact,
      window: WINDOW,
      limit: 51,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.type).toBe('page_view');
    expect(rows[0]?.slots.page).toBe('https://x.cz/kola');
  });

  it('větev kontaktu složí vznik, přihlášení a souhlasy', async () => {
    const ws = await seedWorkspace(db);
    const contact = await seedContact(db, ws.workspaceId);
    await db.pool.query(`UPDATE contacts SET created_at = '2026-07-02T08:00:00.000Z' WHERE id = $1`, [contact]);
    const listId = randomUUID();
    await db.pool.query(`INSERT INTO lists (id, workspace_id, name) VALUES ($1, $2, 'Newsletter')`, [listId, ws.workspaceId]);
    await db.pool.query(
      `INSERT INTO list_subscriptions (contact_id, list_id, workspace_id, status, source, subscribed_at)
       VALUES ($1, $2, $3, 'confirmed', 'form', '2026-07-03T09:00:00.000Z')`,
      [contact, listId, ws.workspaceId],
    );
    await db.pool.query(
      `INSERT INTO consents (id, workspace_id, contact_id, purpose, status, legal_basis, source, occurred_at)
       VALUES (gen_random_uuid(), $1, $2, 'email_marketing', 'granted', 'consent', 'form', '2026-07-03T09:00:01.000Z')`,
      [ws.workspaceId, contact],
    );

    const rows = await contactBranch(createTestTx(db), testContext(ws.workspaceId), {
      contactId: contact,
      window: WINDOW,
      limit: 51,
    });
    expect(rows.map((r) => r.type)).toEqual(['consent_granted', 'list_subscribed', 'contact_created']);
    expect(rows[1]?.slots.list).toBe('Newsletter');
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/timeline/branches.db.test.ts`
Expected: FAIL, `Cannot find module './branches.js'`.

- [ ] **Krok 3: Napiš `timeline/branches.ts`**

```ts
import { sql } from 'drizzle-orm';
import type { Tx } from '@mlain/core/tx';
import type { WorkspaceContext } from '@mlain/core/identity';
import {
  HIDDEN_OPEN_SUBTYPES,
  NON_HUMAN_CLICK_SUBTYPES,
  TIMELINE_EVENT_TYPES,
} from '../event-types.js';
import type { TimeWindow } from './months.js';
import type { TimelineRow } from './types.js';

export type BranchInput = {
  contactId: string;
  window: TimeWindow;
  limit: number;
  /** Kurzor: vrací se jen položky starší než tahle dvojice. */
  before?: { occurredAt: Date; id: string };
};

/**
 * Zprávy. Položka "dostal kampaň X" musí existovat i pro kampaň, ke které
 * nikdy nedorazila žádná událost (kritérium 84), proto se čte z messages.
 *
 * Řadí se podle sent_at, ale index je nad created_at. U jednoho kontaktu jde
 * o jednotky až stovky řádků za měsíc, takže se okno načte celé a doseřadí
 * se v aplikaci. Rozdíl mezi created_at a sent_at je u naplánované kampaně
 * i několik hodin a uživateli se musí ukázat čas odeslání, ne materializace.
 */
export async function messageBranch(
  tx: Tx,
  ctx: WorkspaceContext,
  input: BranchInput,
): Promise<TimelineRow[]> {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT m.id,
           coalesce(m.sent_at, m.created_at) AS occurred_at,
           m.status,
           m.error_code,
           c.id   AS campaign_id,
           c.name AS campaign_name
      FROM messages m
      JOIN campaigns c ON c.id = m.campaign_id AND c.workspace_id = m.workspace_id
     WHERE m.workspace_id = ${ctx.workspaceId}
       AND m.contact_id   = ${input.contactId}
       AND m.created_at  >= ${input.window.from}
       AND m.created_at   < ${input.window.to}
       AND m.kind = 'campaign'
     ORDER BY m.created_at DESC
     LIMIT 500
  `);

  return sortAndCut(
    rows.map((row) => ({
      id: String(row.id),
      occurredAt: new Date(row.occurred_at as string | Date),
      source: 'email',
      type: row.status === 'failed' ? 'message_failed' : 'message_sent',
      campaign: { id: String(row.campaign_id), name: String(row.campaign_name) },
      detail:
        row.error_code === null || row.error_code === undefined
          ? undefined
          : { error_code: String(row.error_code) },
      slots: { campaign: String(row.campaign_name) },
    })),
    input,
  );
}

/**
 * Překlad typu ze schématu na typ položky osy. Klíče jsou jména
 * z `ck_message_events__type` (R19), ne z odmítnutého návrhu části 5.
 * Obě tvrdosti odrazu mají v ose jednu položku: uživatele zajímá, že se
 * zpráva nedoručila, tvrdost je detail.
 */
const EVENT_TYPE_MAP: Record<string, string> = {
  delivered: 'message_delivered',
  bounced_hard: 'message_bounced',
  bounced_soft: 'message_bounced',
  complained: 'message_complained',
  open: 'message_opened',
  click: 'message_clicked',
  unsubscribe: 'message_unsubscribed',
};

/**
 * Události ke zprávě. Podmínka na received_at je povinná: řadí se podle ts,
 * ale partition prořezává jen partiční klíč.
 *
 * Třídy bot, scanner a prefetch se do osy nedostanou vůbec (3.12.1).
 * Automatické stažení (proxy_apple) ano, ale označené jako 'machine'.
 */
export async function messageEventBranch(
  tx: Tx,
  ctx: WorkspaceContext,
  input: BranchInput,
): Promise<TimelineRow[]> {
  const before = input.before ?? null;
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT e.id,
           e.ts AS occurred_at,
           e.type,
           e.subtype,
           e.campaign_id,
           c.name AS campaign_name,
           l.url  AS link_url,
           l.label AS link_label
      FROM message_events e
      JOIN campaigns c ON c.id = e.campaign_id AND c.workspace_id = e.workspace_id
      LEFT JOIN campaign_links l ON l.id = e.link_id AND l.workspace_id = e.workspace_id
     WHERE e.workspace_id = ${ctx.workspaceId}
       AND e.contact_id   = ${input.contactId}
       AND e.ts          >= ${input.window.from}
       AND e.ts           < ${input.window.to}
       AND e.received_at >= ${input.window.from}
       AND e.received_at  < ${input.window.messageReceivedTo}
       AND e.type = ANY(${sql.param([...TIMELINE_EVENT_TYPES])}::text[])
       AND (e.type <> 'open'  OR e.subtype IS NULL
            OR e.subtype <> ALL(${sql.param([...HIDDEN_OPEN_SUBTYPES])}::text[]))
       AND (e.type <> 'click' OR e.subtype IS NULL
            OR e.subtype <> ALL(${sql.param([...NON_HUMAN_CLICK_SUBTYPES])}::text[]))
       -- Porovnává se jako TEXT, ne jako uuid. Sloučený kurzor osy může nést
       -- klíč z větve kontaktu ve tvaru '<uuid>:sub' a `'...:sub'::uuid` by
       -- skončilo chybou 22P02. U kanonického zápisu uuid se textové
       -- a bajtové uspořádání kryjí, takže se řazení nemění.
       AND (${before === null}::boolean
            OR (e.ts, e.id::text) < (${before?.occurredAt ?? null}::timestamptz, ${before?.id ?? null}::text))
     ORDER BY e.ts DESC, e.id DESC
     LIMIT ${input.limit}
  `);

  return rows.map((row) => {
    const type = EVENT_TYPE_MAP[String(row.type)] ?? String(row.type);
    const subtype = row.subtype === null || row.subtype === undefined ? null : String(row.subtype);
    return {
      id: String(row.id),
      occurredAt: new Date(row.occurred_at as string | Date),
      source: 'email',
      type,
      campaign: { id: String(row.campaign_id), name: String(row.campaign_name) },
      reliability:
        type === 'message_opened'
          ? subtype === 'proxy_apple'
            ? ('machine' as const)
            : ('confirmed' as const)
          : type === 'message_clicked'
            ? ('confirmed' as const)
            : undefined,
      detail:
        subtype === null && row.link_url === null
          ? undefined
          : {
              ...(subtype === null ? {} : { subtype }),
              ...(row.link_url ? { link_url: String(row.link_url) } : {}),
            },
      slots: {
        campaign: String(row.campaign_name),
        link: row.link_label ? String(row.link_label) : row.link_url ? String(row.link_url) : '',
      },
    };
  });
}

/** Webové události. Dvojice podmínek na occurred_at a received_at je povinná. */
export async function webEventBranch(
  tx: Tx,
  ctx: WorkspaceContext,
  input: BranchInput,
): Promise<TimelineRow[]> {
  const before = input.before ?? null;
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT e.id, e.occurred_at, e.name, e.session_id, e.page, e.properties
      FROM web_events e
     WHERE e.workspace_id = ${ctx.workspaceId}
       AND e.contact_id   = ${input.contactId}
       AND e.occurred_at >= ${input.window.from}
       AND e.occurred_at  < ${input.window.to}
       AND e.received_at >= ${input.window.webReceivedFrom}
       AND e.received_at  < ${input.window.webReceivedTo}
       -- Text ze stejného důvodu jako u větve událostí zprávy.
       AND (${before === null}::boolean
            OR (e.occurred_at, e.id::text) < (${before?.occurredAt ?? null}::timestamptz, ${before?.id ?? null}::text))
     ORDER BY e.occurred_at DESC, e.id DESC
     LIMIT ${input.limit}
  `);

  return rows.map((row) => {
    const page = (row.page ?? {}) as { url?: string; title?: string };
    return {
      id: String(row.id),
      occurredAt: new Date(row.occurred_at as string | Date),
      source: 'web',
      type: String(row.name),
      sessionId: row.session_id ? String(row.session_id) : undefined,
      detail: {
        ...(page.url ? { page } : {}),
        ...(row.properties && Object.keys(row.properties).length > 0
          ? { properties: row.properties as Record<string, unknown> }
          : {}),
      },
      slots: { page: page.url ?? '', title: page.title ?? '', name: String(row.name) },
    };
  });
}

/** Změny kontaktu: vznik, přihlášení a odhlášení ze seznamů, souhlasy. */
export async function contactBranch(
  tx: Tx,
  ctx: WorkspaceContext,
  input: BranchInput,
): Promise<TimelineRow[]> {
  const before = input.before ?? null;
  // `id` je TEXT, ne uuid. `list_subscriptions` žádné vlastní `id` nemá, jeho
  // klíč je (contact_id, list_id), takže přihlášení i odhlášení téhož seznamu
  // by dostaly stejnou identitu a kurzor `(occurred_at, id)` by na nich přeskočil
  // jednu z položek. Přípona je proto součástí klíče řádku.
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT * FROM (
      SELECT ct.id::text AS id, ct.created_at AS occurred_at, 'contact_created' AS type,
             ''::text AS list_name, ''::text AS purpose
        FROM contacts ct
       WHERE ct.workspace_id = ${ctx.workspaceId} AND ct.id = ${input.contactId}
      UNION ALL
      SELECT ls.list_id::text || ':sub', ls.subscribed_at, 'list_subscribed', l.name, ''
        FROM list_subscriptions ls
        JOIN lists l ON l.id = ls.list_id AND l.workspace_id = ls.workspace_id
       WHERE ls.workspace_id = ${ctx.workspaceId} AND ls.contact_id = ${input.contactId}
         AND ls.subscribed_at IS NOT NULL
      UNION ALL
      SELECT ls.list_id::text || ':unsub', ls.unsubscribed_at, 'list_unsubscribed', l.name, ''
        FROM list_subscriptions ls
        JOIN lists l ON l.id = ls.list_id AND l.workspace_id = ls.workspace_id
       WHERE ls.workspace_id = ${ctx.workspaceId} AND ls.contact_id = ${input.contactId}
         AND ls.unsubscribed_at IS NOT NULL
      UNION ALL
      SELECT co.id::text, co.occurred_at,
             CASE WHEN co.status = 'granted' THEN 'consent_granted' ELSE 'consent_withdrawn' END,
             '', co.purpose
        FROM consents co
       WHERE co.workspace_id = ${ctx.workspaceId} AND co.contact_id = ${input.contactId}
    ) t
     WHERE t.occurred_at >= ${input.window.from}
       AND t.occurred_at  < ${input.window.to}
       AND (${before === null}::boolean
            OR (t.occurred_at, t.id) < (${before?.occurredAt ?? null}::timestamptz, ${before?.id ?? null}::text))
     ORDER BY t.occurred_at DESC, t.id DESC
     LIMIT ${input.limit}
  `);

  return rows.map((row) => ({
    id: String(row.id),
    occurredAt: new Date(row.occurred_at as string | Date),
    source: String(row.type).startsWith('consent_') ? 'consent' : 'contact',
    type: String(row.type),
    detail: row.purpose ? { purpose: String(row.purpose) } : undefined,
    slots: { list: String(row.list_name ?? ''), purpose: String(row.purpose ?? '') },
  }));
}

function sortAndCut(rows: TimelineRow[], input: BranchInput): TimelineRow[] {
  const before = input.before;
  return rows
    .filter((row) => {
      if (!before) return true;
      if (row.occurredAt.getTime() !== before.occurredAt.getTime()) {
        return row.occurredAt < before.occurredAt;
      }
      return row.id < before.id;
    })
    .sort((a, b) =>
      a.occurredAt.getTime() === b.occurredAt.getTime()
        ? b.id.localeCompare(a.id)
        : b.occurredAt.getTime() - a.occurredAt.getTime(),
    )
    .slice(0, input.limit);
}
```

- [ ] **Krok 4: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/timeline/branches.db.test.ts`
Expected: PASS, `Tests  5 passed (5)`.

- [ ] **Krok 5: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add packages/core/src/reports/timeline/branches.ts packages/core/src/reports/timeline/branches.db.test.ts && git commit -m "feat(reports): add four timeline branches with partition pruning"
```

---

### Úkol 18: Slévání větví a věty ze slotů

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/timeline/merge.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/timeline/titles.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/timeline/merge.test.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/timeline/titles.test.ts`

- [ ] **Krok 1: Napiš padající testy**

`packages/core/src/reports/timeline/merge.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mergeSortedBranches } from './merge.js';
import type { TimelineRow } from './types.js';

function row(id: string, iso: string): TimelineRow {
  return { id, occurredAt: new Date(iso), source: 'web', type: 'page_view', slots: {} };
}

describe('mergeSortedBranches', () => {
  it('slije seřazené větve sestupně podle času', () => {
    const merged = mergeSortedBranches(
      [
        [row('a', '2026-07-31T12:00:00.000Z'), row('b', '2026-07-30T12:00:00.000Z')],
        [row('c', '2026-07-31T13:00:00.000Z'), row('d', '2026-07-29T12:00:00.000Z')],
      ],
      10,
    );
    expect(merged.map((r) => r.id)).toEqual(['c', 'a', 'b', 'd']);
  });

  it('při shodném čase řadí sestupně podle id, aby byl kurzor jednoznačný', () => {
    const merged = mergeSortedBranches(
      [[row('a1', '2026-07-31T12:00:00.000Z')], [row('a2', '2026-07-31T12:00:00.000Z')]],
      10,
    );
    expect(merged.map((r) => r.id)).toEqual(['a2', 'a1']);
  });

  it('vrátí nejvýš tolik položek, kolik se chce', () => {
    const merged = mergeSortedBranches(
      [[row('a', '2026-07-31T12:00:00.000Z'), row('b', '2026-07-30T12:00:00.000Z')]],
      1,
    );
    expect(merged).toHaveLength(1);
  });

  it('prázdné větve nevadí', () => {
    expect(mergeSortedBranches([[], []], 5)).toEqual([]);
  });
});
```

`packages/core/src/reports/timeline/titles.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { composeTitle, titleKey } from './titles.js';
import type { TimelineRow } from './types.js';

const translate = (key: string, values: Record<string, unknown>) =>
  `${key}|${JSON.stringify(values)}`;

function row(type: string, slots: Record<string, string | number> = {}): TimelineRow {
  return { id: 'x', occurredAt: new Date(), source: 'email', type, slots };
}

describe('titleKey', () => {
  it('mapuje známé typy na klíče katalogu', () => {
    expect(titleKey('message_opened')).toBe('timeline.item.messageOpened');
    expect(titleKey('page_view')).toBe('timeline.item.pageView');
  });

  it('neznámý typ dostane obecný klíč, ne výjimku', () => {
    expect(titleKey('automation_entered')).toBe('timeline.item.generic');
  });
});

describe('composeTitle', () => {
  it('předá rod jako slot, aby se věta složila v katalogu, ne v kódu', () => {
    const title = composeTitle(translate, row('message_opened', { campaign: 'Letní výprodej' }), 'female');
    expect(title).toContain('timeline.item.messageOpened');
    expect(title).toContain('"gender":"female"');
    expect(title).toContain('"campaign":"Letní výprodej"');
  });

  it('u neznámého rodu předá other, ne mužský tvar', () => {
    const title = composeTitle(translate, row('message_opened'), 'unknown');
    expect(title).toContain('"gender":"other"');
  });

  it('u neznámého typu předá jeho název jako slot', () => {
    const title = composeTitle(translate, row('product_viewed', { name: 'product_viewed' }), 'male');
    expect(title).toContain('timeline.item.generic');
    expect(title).toContain('"name":"product_viewed"');
  });
});
```

- [ ] **Krok 2: Spusť testy a ověř, že padají**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/timeline/merge.test.ts reports/timeline/titles.test.ts`
Expected: FAIL, `Cannot find module './merge.js'`.

- [ ] **Krok 3: Napiš `timeline/merge.ts`**

```ts
import type { TimelineRow } from './types.js';

/**
 * Trojcestné (a víc) slévání už seřazených větví. Dělá se v aplikaci schválně:
 * UNION ALL s ORDER BY v jednom SQL by Postgres přinutil seřadit celý
 * mezivýsledek, kdežto každá větev je seřazená svým indexem.
 */
export function mergeSortedBranches(branches: TimelineRow[][], limit: number): TimelineRow[] {
  const cursors = branches.map(() => 0);
  const result: TimelineRow[] = [];

  while (result.length < limit) {
    let bestBranch = -1;
    let best: TimelineRow | undefined;

    for (let i = 0; i < branches.length; i += 1) {
      const candidate = branches[i]?.[cursors[i] ?? 0];
      if (!candidate) continue;
      if (!best || isNewer(candidate, best)) {
        best = candidate;
        bestBranch = i;
      }
    }

    if (!best || bestBranch < 0) break;
    cursors[bestBranch] = (cursors[bestBranch] ?? 0) + 1;
    result.push(best);
  }

  return result;
}

function isNewer(a: TimelineRow, b: TimelineRow): boolean {
  const diff = a.occurredAt.getTime() - b.occurredAt.getTime();
  if (diff !== 0) return diff > 0;
  return a.id > b.id;
}
```

- [ ] **Krok 4: Napiš `timeline/titles.ts`**

```ts
import type { TimelineRow } from './types.js';

export type Gender = 'female' | 'male' | 'unknown';

export type Translate = (key: string, values: Record<string, unknown>) => string;

const TITLE_KEYS: Record<string, string> = {
  message_sent: 'timeline.item.messageSent',
  message_failed: 'timeline.item.messageFailed',
  message_delivered: 'timeline.item.messageDelivered',
  message_opened: 'timeline.item.messageOpened',
  message_clicked: 'timeline.item.messageClicked',
  message_bounced: 'timeline.item.messageBounced',
  message_complained: 'timeline.item.messageComplained',
  message_unsubscribed: 'timeline.item.messageUnsubscribed',
  page_view: 'timeline.item.pageView',
  session_started: 'timeline.item.sessionStarted',
  contact_created: 'timeline.item.contactCreated',
  list_subscribed: 'timeline.item.listSubscribed',
  list_unsubscribed: 'timeline.item.listUnsubscribed',
  consent_granted: 'timeline.item.consentGranted',
  consent_withdrawn: 'timeline.item.consentWithdrawn',
};

/**
 * Neznámý typ nesmí shodit odpověď. Dostane obecnou větu s názvem události,
 * aby klient, který o typu nikdy neslyšel, uměl zobrazit aspoň něco smysluplného.
 */
export function titleKey(type: string): string {
  return TITLE_KEYS[type] ?? 'timeline.item.generic';
}

/**
 * Věta se skládá v katalogu ze slotů, ne v kódu ze zřetězených fragmentů.
 * Rod se předává jako slot a ICU `select` v katalogu vybere tvar slovesa.
 * U neznámého rodu je správný tvar podstatné jméno, ne mužský rod: polovina
 * kontaktů jsou ženy.
 */
export function composeTitle(translate: Translate, row: TimelineRow, gender: Gender): string {
  return translate(titleKey(row.type), {
    ...row.slots,
    gender: gender === 'unknown' ? 'other' : gender,
  });
}
```

- [ ] **Krok 5: Spusť testy a ověř, že procházejí**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/timeline/merge.test.ts src/reports/timeline/titles.test.ts`
Expected: PASS, `Tests  9 passed (9)`.

- [ ] **Krok 6: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add packages/core/src/reports/timeline/merge.ts packages/core/src/reports/timeline/merge.test.ts packages/core/src/reports/timeline/titles.ts packages/core/src/reports/timeline/titles.test.ts && git commit -m "feat(reports): merge timeline branches and compose sentences from slots"
```

---

### Úkol 19: Orchestrace časové osy a stránkování

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/timeline/query.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/timeline/query.db.test.ts`

- [ ] **Krok 1: Napiš padající test**

`packages/core/src/reports/timeline/query.db.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestTx, startTestDatabase, testContext, type TestDatabase } from '../test-support/db.js';
import { ensurePartitions, seedContact, seedWorkspace } from '../test-support/fixtures.js';
import { readContactTimeline } from './query.js';

const translate = (key: string, values: Record<string, unknown>) => `${key}:${values.gender ?? ''}`;

describe('readContactTimeline', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  async function seedWebEvents(workspaceId: string, contactId: string, count: number, month: string) {
    await ensurePartitions(db, new Date(`${month}-15T00:00:00.000Z`));
    await db.pool.query(
      `INSERT INTO web_events (id, received_at, occurred_at, workspace_id, name, contact_id, source, page)
       SELECT gen_random_uuid(),
              ($4::timestamptz + (g || ' seconds')::interval),
              ($4::timestamptz + (g || ' seconds')::interval),
              $1, 'page_view', $2, 'web', '{"url":"https://x.cz/a"}'::jsonb
         FROM generate_series(1, $3) AS g`,
      [workspaceId, contactId, count, `${month}-15T00:00:00.000Z`],
    );
    await db.pool.query(
      `INSERT INTO web_event_months (workspace_id, subject_kind, subject_id, month)
       VALUES ($1, 'contact', $2, $3) ON CONFLICT DO NOTHING`,
      [workspaceId, contactId, `${month}-01`],
    );
  }

  it('vrátí první stránku seřazenou od nejnovější položky', async () => {
    const ws = await seedWorkspace(db);
    const contact = await seedContact(db, ws.workspaceId);
    await seedWebEvents(ws.workspaceId, contact, 60, '2026-07');

    const page = await readContactTimeline(
      createTestTx(db),
      testContext(ws.workspaceId),
      { contactId: contact, limit: 50, translate, now: new Date('2026-07-31T23:00:00.000Z') },
    );
    expect(page.items).toHaveLength(50);
    expect(page.hasMore).toBe(true);
    expect(new Date(page.items[0]!.occurred_at).getTime()).toBeGreaterThan(
      new Date(page.items[49]!.occurred_at).getTime(),
    );
    expect(page.items[0]?.title).toContain('timeline.item.pageView');
  });

  it('druhá stránka nenavazuje duplicitou ani mezerou', async () => {
    const ws = await seedWorkspace(db);
    const contact = await seedContact(db, ws.workspaceId);
    await seedWebEvents(ws.workspaceId, contact, 60, '2026-07');
    const tx = createTestTx(db);
    const ctx = testContext(ws.workspaceId);
    const first = await readContactTimeline(tx, ctx, {
      contactId: contact,
      limit: 50,
      translate,
      now: new Date('2026-07-31T23:00:00.000Z'),
    });
    const second = await readContactTimeline(tx, ctx, {
      contactId: contact,
      limit: 50,
      translate,
      now: new Date('2026-07-31T23:00:00.000Z'),
      cursor: first.nextCursor ?? undefined,
    });
    expect(second.items).toHaveLength(10);
    const ids = new Set(first.items.map((i) => i.id));
    expect(second.items.some((i) => ids.has(i.id))).toBe(false);
  });

  it('přeskočí měsíce bez dat a najde starší položky (chování 3.12.2)', async () => {
    const ws = await seedWorkspace(db);
    const contact = await seedContact(db, ws.workspaceId);
    await seedWebEvents(ws.workspaceId, contact, 3, '2026-02');

    const page = await readContactTimeline(
      createTestTx(db),
      testContext(ws.workspaceId),
      { contactId: contact, limit: 50, translate, now: new Date('2026-07-31T23:00:00.000Z') },
    );
    expect(page.items).toHaveLength(3);
  });

  it('filtr podle zdroje vrátí jen požadované položky', async () => {
    const ws = await seedWorkspace(db);
    const contact = await seedContact(db, ws.workspaceId);
    await seedWebEvents(ws.workspaceId, contact, 5, '2026-07');

    const page = await readContactTimeline(
      createTestTx(db),
      testContext(ws.workspaceId),
      {
        contactId: contact,
        limit: 50,
        translate,
        types: ['email'],
        now: new Date('2026-07-31T23:00:00.000Z'),
      },
    );
    expect(page.items).toEqual([]);
  });

  it('odmítne rozsah delší než tři měsíce kódem tracking_timeline_window_too_large', async () => {
    const ws = await seedWorkspace(db);
    const contact = await seedContact(db, ws.workspaceId);
    await expect(
      readContactTimeline(createTestTx(db), testContext(ws.workspaceId), {
        contactId: contact,
        limit: 50,
        translate,
        from: new Date('2025-01-01T00:00:00.000Z'),
        to: new Date('2026-01-01T00:00:00.000Z'),
        now: new Date('2026-07-31T23:00:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'tracking_timeline_window_too_large' });
  });

  it('u neexistujícího kontaktu hlásí not_found', async () => {
    const ws = await seedWorkspace(db);
    await expect(
      readContactTimeline(createTestTx(db), testContext(ws.workspaceId), {
        contactId: '00000000-0000-4000-8000-000000000000',
        limit: 50,
        translate,
        now: new Date('2026-07-31T23:00:00.000Z'),
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/timeline/query.db.test.ts`
Expected: FAIL, `Cannot find module './query.js'`.

- [ ] **Krok 3: Napiš `timeline/query.ts`**

```ts
import { sql } from 'drizzle-orm';
import type { Tx } from '@mlain/core/tx';
import type { WorkspaceContext } from '@mlain/core/identity';
import { config } from '@mlain/core/config';
import { decodeCursor, encodeCursor } from '../cursor.js';
import { dependencyTimeout, notFound, timelineWindowTooLarge } from '../errors.js';
import { contactBranch, messageBranch, messageEventBranch, webEventBranch } from './branches.js';
import { mergeSortedBranches } from './merge.js';
import { MAX_MONTHS_PER_REQUEST, pickWindow } from './months.js';
import { composeTitle, type Gender, type Translate } from './titles.js';
import { TIMELINE_ORDER, type TimelineFilter, type TimelineItem, type TimelineRow } from './types.js';

/** Výchozí rozsah je posledních dvanáct měsíců, dál se jde tlačítkem "načíst starší". */
const DEFAULT_SCOPE_MONTHS = 12;

/** Kolik oken smí jeden požadavek projít, než vrátí i prázdnou stránku. */
const MAX_WINDOWS_PER_REQUEST = 4;

/** Rozpočet z 7.2 části 5. Přes něj se vrací dependency_timeout, ne prázdno. */
const QUERY_BUDGET_MS = 3000;

export type TimelinePage = {
  items: TimelineItem[];
  /**
   * Rod kontaktu. Věty ze slotů na něm stojí (13.1) a klient kontakt sám
   * nečte, takže bez něj by osa v UI skládala věty v neutrálním tvaru,
   * ačkoliv server rod zná.
   */
  gender: Gender;
  hasMore: boolean;
  nextCursor: string | null;
};

export type TimelineInput = {
  contactId: string;
  limit: number;
  translate: Translate;
  cursor?: string;
  types?: TimelineFilter[];
  from?: Date;
  to?: Date;
  now?: Date;
};

export async function readContactTimeline(
  tx: Tx,
  ctx: WorkspaceContext,
  input: TimelineInput,
): Promise<TimelinePage> {
  const now = input.now ?? new Date();
  const limit = Math.min(Math.max(input.limit, 1), 200);

  const { rows: contactRows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT id, gender FROM contacts
     WHERE workspace_id = ${ctx.workspaceId} AND id = ${input.contactId}
  `);
  const contact = contactRows[0];
  if (!contact) throw notFound('contact');
  const gender = normalizeGender(contact.gender);

  const scopeEnd = input.to ?? now;
  const scopeStart =
    input.from ?? new Date(Date.UTC(scopeEnd.getUTCFullYear(), scopeEnd.getUTCMonth() - DEFAULT_SCOPE_MONTHS, 1));

  if (input.from && input.to && monthsBetween(input.from, input.to) > MAX_MONTHS_PER_REQUEST) {
    throw timelineWindowTooLarge();
  }

  const before = input.cursor ? cursorToPosition(input.cursor) : null;
  const wanted = input.types ?? null;

  const startedAt = Date.now();
  let windowTo = before ? before.occurredAt : scopeEnd;
  const collected: TimelineRow[] = [];

  for (let round = 0; round < MAX_WINDOWS_PER_REQUEST; round += 1) {
    if (windowTo <= scopeStart) break;
    if (Date.now() - startedAt > QUERY_BUDGET_MS) throw dependencyTimeout();

    const window = pickWindow(windowTo, scopeStart, config.TRACKING_RETENTION_MONTHS);
    const branchInput = { contactId: input.contactId, window, limit: limit + 1, before: before ?? undefined };

    const branches = await Promise.all([
      enabled(wanted, 'email') ? messageBranch(tx, ctx, branchInput) : Promise.resolve([]),
      enabled(wanted, 'email') ? messageEventBranch(tx, ctx, branchInput) : Promise.resolve([]),
      enabled(wanted, 'web') ? webEventBranch(tx, ctx, branchInput) : Promise.resolve([]),
      enabled(wanted, 'contact') || enabled(wanted, 'consent')
        ? contactBranch(tx, ctx, branchInput)
        : Promise.resolve([]),
    ]);

    const filtered = branches.map((rows) =>
      rows.filter((row) => (wanted === null ? true : wanted.includes(row.source as TimelineFilter))),
    );

    collected.push(...mergeSortedBranches(filtered, limit + 1 - collected.length));
    if (collected.length > limit) break;
    windowTo = window.from;
  }

  const hasMore = collected.length > limit;
  const page = collected.slice(0, limit);
  const last = page[page.length - 1];

  return {
    items: page.map((row) => toItem(row, input.translate, gender)),
    gender,
    hasMore,
    nextCursor:
      hasMore && last
        ? encodeCursor({ k: [last.occurredAt.toISOString(), last.id], d: 'n', o: TIMELINE_ORDER })
        : null,
  };
}

function enabled(wanted: TimelineFilter[] | null, source: TimelineFilter): boolean {
  return wanted === null || wanted.includes(source);
}

function cursorToPosition(raw: string): { occurredAt: Date; id: string } {
  const cursor = decodeCursor(raw, TIMELINE_ORDER);
  return { occurredAt: new Date(cursor.k[0] ?? ''), id: cursor.k[1] ?? '' };
}

function monthsBetween(from: Date, to: Date): number {
  return (
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth()) + 1
  );
}

function normalizeGender(value: unknown): Gender {
  return value === 'female' || value === 'male' ? value : 'unknown';
}

function toItem(row: TimelineRow, translate: Translate, gender: Gender): TimelineItem {
  return {
    id: row.id,
    occurred_at: row.occurredAt.toISOString(),
    source: row.source,
    type: row.type,
    title: composeTitle(translate, row, gender),
    ...(row.detail ? { detail: row.detail } : {}),
    ...(row.campaign ? { campaign: row.campaign } : {}),
    ...(row.sessionId ? { session_id: row.sessionId } : {}),
    ...(row.reliability ? { reliability: row.reliability } : {}),
  };
}
```

- [ ] **Krok 4: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/timeline/query.db.test.ts`
Expected: PASS, `Tests  6 passed (6)`.

- [ ] **Krok 5: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add packages/core/src/reports/timeline/query.ts packages/core/src/reports/timeline/query.db.test.ts && git commit -m "feat(reports): assemble contact timeline with keyset paging"
```

---

### Úkol 20: Výkon časové osy při sto tisících událostech

Kritérium 67 mluví o sto tisících událostech a o dvacáté stránce. Bez měření je to jen přání.

**Files:**
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/timeline/query-performance.db.test.ts`

- [ ] **Krok 1: Napiš test výkonu**

`packages/core/src/reports/timeline/query-performance.db.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { WorkspaceContext } from '@mlain/core/identity';
import { createTestTx, startTestDatabase, testContext, type TestDatabase } from '../test-support/db.js';
import { ensurePartitions, seedContact, seedWorkspace } from '../test-support/fixtures.js';
import { readContactTimeline } from './query.js';

const translate = (key: string) => key;
const NOW = new Date('2026-07-31T23:00:00.000Z');

describe('výkon časové osy', () => {
  let db: TestDatabase;
  let ctx: WorkspaceContext;
  let contactId: string;

  beforeAll(async () => {
    db = await startTestDatabase();
    const ws = await seedWorkspace(db);
    ctx = testContext(ws.workspaceId);
    contactId = await seedContact(db, ws.workspaceId);

    for (const month of ['2026-05', '2026-06', '2026-07']) {
      await ensurePartitions(db, new Date(`${month}-15T00:00:00.000Z`));
      await db.pool.query(
        `INSERT INTO web_events (id, received_at, occurred_at, workspace_id, name, contact_id, source, page)
         SELECT gen_random_uuid(),
                ($3::timestamptz + (g || ' seconds')::interval),
                ($3::timestamptz + (g || ' seconds')::interval),
                $1, 'page_view', $2, 'web', '{"url":"https://x.cz/a"}'::jsonb
           FROM generate_series(1, 34000) AS g`,
        [ws.workspaceId, contactId, `${month}-01T00:00:00.000Z`],
      );
      await db.pool.query(
        `INSERT INTO web_event_months (workspace_id, subject_kind, subject_id, month)
         VALUES ($1, 'contact', $2, $3) ON CONFLICT DO NOTHING`,
        [ws.workspaceId, contactId, `${month}-01`],
      );
    }
    await db.pool.query('ANALYZE web_events');
  }, 600_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('první i dvacátá stránka se vejdou do rozpočtu (kritérium 67)', async () => {
    const tx = createTestTx(db);
    let cursor: string | undefined;
    const durations: number[] = [];

    for (let page = 0; page < 20; page += 1) {
      const started = performance.now();
      const result = await readContactTimeline(tx, ctx, {
        contactId,
        limit: 50,
        translate,
        now: NOW,
        cursor,
      });
      durations.push(performance.now() - started);
      expect(result.items).toHaveLength(50);
      cursor = result.nextCursor ?? undefined;
      expect(cursor).toBeTruthy();
    }

    // Rozpočet 7.2 části 5 je p99 120 ms. V kontejneru na notebooku měříme
    // s rezervou, protože zajímá nás řádová shoda, ne absolutní číslo.
    expect(Math.max(...durations)).toBeLessThan(500);
  });

  it('dotaz na webovou větev nepoužije Seq Scan nad web_events (7.3)', async () => {
    const { rows } = await db.pool.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN (FORMAT TEXT)
       SELECT e.id, e.occurred_at FROM web_events e
        WHERE e.workspace_id = $1 AND e.contact_id = $2
          AND e.occurred_at >= '2026-07-01' AND e.occurred_at < '2026-08-01'
          AND e.received_at >= '2026-07-01' AND e.received_at < '2026-08-08'
        ORDER BY e.occurred_at DESC, e.id DESC LIMIT 51`,
      [ctx.workspaceId, contactId],
    );
    const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
    expect(plan).not.toMatch(/Seq Scan on web_events/);
  });
});
```

- [ ] **Krok 2: Spusť test a ověř výsledek**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/timeline/query-performance.db.test.ts`
Expected: PASS. Když test padne na `Seq Scan`, je to nález proti P03 (chybí index `idx_web_events__contact_occurred`) a patří do kapitoly 7, ne do obcházení testu.

- [ ] **Krok 3: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add packages/core/src/reports/timeline/query-performance.db.test.ts && git commit -m "test(reports): measure timeline paging over 100k events"
```

---

### Úkol 21: Cache dlaždic přehledu

Zastaralá hodnota se nikdy nesmí tvářit jako čerstvá, a selhání jedné dlaždice nesmí shodit stránku (stavy S7 a S8).

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/dashboard/cache.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/dashboard/cache.test.ts`

- [ ] **Krok 1: Napiš padající test**

`packages/core/src/reports/dashboard/cache.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TileCache } from './cache.js';

describe('TileCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('vrátí čerstvou hodnotu bez dalšího výpočtu', async () => {
    const cache = new TileCache();
    const compute = vi.fn().mockResolvedValue(42);
    const first = await cache.resolve('a', 60_000, compute);
    const second = await cache.resolve('a', 60_000, compute);
    expect(compute).toHaveBeenCalledTimes(1);
    expect(second).toEqual({ status: 'ok', data: 42, computedAt: first.computedAt, stale: false });
  });

  it('po vypršení TTL počítá znovu', async () => {
    const cache = new TileCache();
    const compute = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2);
    await cache.resolve('a', 60_000, compute);
    vi.advanceTimersByTime(61_000);
    const result = await cache.resolve('a', 60_000, compute);
    expect(result).toMatchObject({ status: 'ok', data: 2 });
  });

  it('při chybě výpočtu vrátí poslední známou hodnotu označenou jako zastaralou', async () => {
    const cache = new TileCache();
    await cache.resolve('a', 60_000, async () => 1);
    vi.advanceTimersByTime(61_000);
    const result = await cache.resolve('a', 60_000, async () => {
      throw new Error('databáze mlčí');
    });
    expect(result).toMatchObject({ status: 'ok', data: 1, stale: true });
  });

  it('když není co vracet, přizná chybu dlaždice a nezhroutí celou odpověď', async () => {
    const cache = new TileCache();
    const result = await cache.resolve('a', 60_000, async () => {
      throw new Error('databáze mlčí');
    });
    expect(result).toEqual({ status: 'error', code: 'tile_unavailable' });
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/dashboard/cache.test.ts`
Expected: FAIL, `Cannot find module './cache.js'`.

- [ ] **Krok 3: Napiš `dashboard/cache.ts`**

```ts
export type Tile<T> =
  | { status: 'ok'; data: T; computedAt: string; stale: boolean }
  | { status: 'error'; code: string };

type Entry = { value: unknown; computedAt: number };

/**
 * Cache dlaždic přehledu, jedna instance na proces. Klíčem je dvojice
 * projektu a období, takže se nikdy nesmíchají data dvou projektů.
 *
 * Dvě pravidla, na kterých stojí poctivost obrazovky:
 * 1. Když se přepočet nepovede a stará hodnota existuje, vrátí se stará
 *    hodnota označená jako zastaralá. Prázdná dlaždice je horší.
 * 2. Když stará hodnota není, dlaždice přizná chybu a zbytek stránky žije dál.
 */
export class TileCache {
  private readonly entries = new Map<string, Entry>();

  async resolve<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<Tile<T>> {
    const now = Date.now();
    const cached = this.entries.get(key);
    if (cached && now - cached.computedAt < ttlMs) {
      return {
        status: 'ok',
        data: cached.value as T,
        computedAt: new Date(cached.computedAt).toISOString(),
        stale: false,
      };
    }

    try {
      const value = await compute();
      this.entries.set(key, { value, computedAt: now });
      return { status: 'ok', data: value, computedAt: new Date(now).toISOString(), stale: false };
    } catch {
      if (!cached) return { status: 'error', code: 'tile_unavailable' };
      return {
        status: 'ok',
        data: cached.value as T,
        computedAt: new Date(cached.computedAt).toISOString(),
        stale: true,
      };
    }
  }

  clear(): void {
    this.entries.clear();
  }
}
```

- [ ] **Krok 4: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/dashboard/cache.test.ts`
Expected: PASS, `Tests  4 passed (4)`.

- [ ] **Krok 5: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add packages/core/src/reports/dashboard/cache.ts packages/core/src/reports/dashboard/cache.test.ts && git commit -m "feat(reports): cache dashboard tiles and never hide staleness"
```

---

### Úkol 22: Dlaždice přehledu

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/dashboard/read.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/dashboard/read.db.test.ts`

- [ ] **Krok 1: Napiš padající test**

`packages/core/src/reports/dashboard/read.db.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestTx, startTestDatabase, testContext, type TestDatabase } from '../test-support/db.js';
import { ensurePartitions, seedCampaign, seedCampaignStats, seedContact, seedWorkspace } from '../test-support/fixtures.js';
import { TileCache } from './cache.js';
import { readDashboard } from './read.js';

describe('readDashboard', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  it('sečte odeslané a spočítá vážené míry přes kampaně období', async () => {
    const ws = await seedWorkspace(db);
    const ctx = testContext(ws.workspaceId);
    const recent = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const old = new Date(Date.now() - 200 * 24 * 60 * 60 * 1000);

    const a = await seedCampaign(db, ws.workspaceId, { audienceBuiltAt: recent });
    await seedCampaignStats(db, ws.workspaceId, a.campaignId, {
      sent: 1000, delivered: 1000, opens_unique: 500, opens_unique_apple: 200,
      opens_unique_human: 300, clicks_unique_human: 40, bounced_hard: 5, complained: 1,
    });
    const b = await seedCampaign(db, ws.workspaceId, { audienceBuiltAt: old });
    await seedCampaignStats(db, ws.workspaceId, b.campaignId, { sent: 9999, delivered: 9999 });

    const result = await readDashboard(createTestTx(db), ctx, {
      periodDays: 7,
      timezone: 'Europe/Prague',
      cache: new TileCache(),
    });

    expect(result.tiles.sent).toMatchObject({ status: 'ok', data: { value: 1000 } });
    const clicks = result.tiles.click_rate;
    expect(clicks.status).toBe('ok');
    if (clicks.status === 'ok') expect(clicks.data.rate).toBeCloseTo(0.04, 10);
    const opens = result.tiles.open_rate;
    if (opens.status === 'ok') {
      expect(opens.data.rate).toBeCloseTo(0.5, 10);
      expect(opens.data.machineShare).toBeCloseTo(0.4, 10);
    }
  });

  it('označí překročené prahy vrácení a stížností', async () => {
    const ws = await seedWorkspace(db);
    const ctx = testContext(ws.workspaceId);
    const campaign = await seedCampaign(db, ws.workspaceId, { audienceBuiltAt: new Date() });
    await seedCampaignStats(db, ws.workspaceId, campaign.campaignId, {
      sent: 1000, delivered: 950, bounced_hard: 45, bounced_soft: 5, complained: 3,
    });
    const result = await readDashboard(createTestTx(db), ctx, {
      periodDays: 30,
      timezone: 'UTC',
      cache: new TileCache(),
    });
    const problems = result.tiles.problems;
    expect(problems.status).toBe('ok');
    if (problems.status === 'ok') expect(problems.data.level).toBe('bad');
  });

  it('spočítá kontakty aktivní na webu za posledních 24 hodin', async () => {
    const ws = await seedWorkspace(db);
    const ctx = testContext(ws.workspaceId);
    const contact = await seedContact(db, ws.workspaceId);
    await ensurePartitions(db, new Date());
    await db.pool.query(
      `INSERT INTO web_events (id, received_at, occurred_at, workspace_id, name, contact_id, source)
       VALUES (gen_random_uuid(), now(), now(), $1, 'page_view', $2, 'web'),
              (gen_random_uuid(), now(), now(), $1, 'page_view', $2, 'web')`,
      [ws.workspaceId, contact],
    );
    const result = await readDashboard(createTestTx(db), ctx, {
      periodDays: 7,
      timezone: 'UTC',
      cache: new TileCache(),
    });
    const web = result.tiles.web_active;
    if (web.status === 'ok') expect(web.data.contacts).toBe(1);
  });

  it('kampaň bez řádku agregace z přehledu nevypadne (líné zakládání rollupu)', async () => {
    const ws = await seedWorkspace(db);
    // seedCampaign schválně NEzakládá campaign_stats: přesně tenhle stav má
    // kampaň mezi odesláním a prvním během jobu z P10.
    await seedCampaign(db, ws.workspaceId, { audienceBuiltAt: new Date() });
    const withStats = await seedCampaign(db, ws.workspaceId, { audienceBuiltAt: new Date() });
    await seedCampaignStats(db, ws.workspaceId, withStats.campaignId, { sent: 100, delivered: 90 });

    const result = await readDashboard(createTestTx(db), testContext(ws.workspaceId), {
      periodDays: 7,
      timezone: 'UTC',
      cache: new TileCache(),
    });
    const recent = result.tiles.recent_campaigns;
    expect(recent.status).toBe('ok');
    // S `FROM campaign_stats` by tu byla jen jedna kampaň a nic by nespadlo.
    if (recent.status === 'ok') expect(recent.data.items).toHaveLength(2);
    const sent = result.tiles.sent;
    if (sent.status === 'ok') expect(sent.data.value).toBe(100);
  });

  it('dlaždice aktivity na webu se čte z indexu, ne sekvenčním průchodem oddílu', async () => {
    const ws = await seedWorkspace(db);
    const contact = await seedContact(db, ws.workspaceId);
    await ensurePartitions(db, new Date());
    await db.pool.query(
      `INSERT INTO web_events (id, received_at, occurred_at, workspace_id, name, contact_id, source)
       SELECT gen_random_uuid(), now(), now(), $1, 'page_view', $2, 'web'
         FROM generate_series(1, 500)`,
      [ws.workspaceId, contact],
    );
    await db.pool.query('ANALYZE web_events');
    const { rows } = await db.pool.query<{ 'QUERY PLAN': string }>(
      `EXPLAIN (FORMAT TEXT)
       SELECT count(DISTINCT contact_id) FROM web_events
        WHERE workspace_id = $1 AND contact_id IS NOT NULL
          AND occurred_at >= now() - interval '24 hours'
          AND received_at >= now() - interval '24 hours' - interval '60 seconds'
          AND received_at <  now() + interval '7 days'`,
      [ws.workspaceId],
    );
    const plan = rows.map((r) => r['QUERY PLAN']).join('\n');
    expect(plan).not.toMatch(/Seq Scan on web_events/);
  });

  it('projekt bez jediné odeslané kampaně nemá míry, ale odpověď se nerozbije', async () => {
    const ws = await seedWorkspace(db);
    const result = await readDashboard(createTestTx(db), testContext(ws.workspaceId), {
      periodDays: 7,
      timezone: 'UTC',
      cache: new TileCache(),
    });
    const clicks = result.tiles.click_rate;
    if (clicks.status === 'ok') expect(clicks.data.rate).toBeNull();
    expect(result.tiles.recent_campaigns.status).toBe('ok');
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/dashboard/read.db.test.ts`
Expected: FAIL, `Cannot find module './read.js'`.

- [ ] **Krok 3: Napiš `dashboard/read.ts`**

```ts
import { sql } from 'drizzle-orm';
import type { Tx } from '@mlain/core/tx';
import type { WorkspaceContext } from '@mlain/core/identity';
import { TileCache, type Tile } from './cache.js';

export const DASHBOARD_PERIODS = [7, 30, 90] as const;
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

/** Prahy z 8.11.1 části 6, hodnoty vlastní část 4a (3.15.2). */
export const BOUNCE_WARN = 0.04;
export const COMPLAINT_WARN = 0.001;

const STATS_TTL_MS = 60_000;
const WEB_TTL_MS = 300_000;

export type DashboardResponse = {
  periodDays: DashboardPeriod;
  computedAt: string;
  tiles: {
    sent: Tile<{ value: number }>;
    click_rate: Tile<{ rate: number | null; delta: number | null }>;
    open_rate: Tile<{ rate: number | null; machineShare: number | null }>;
    problems: Tile<{ bounceRate: number | null; complaintRate: number | null; level: 'ok' | 'warn' | 'bad' }>;
    web_active: Tile<{ contacts: number }>;
    recent_campaigns: Tile<{ items: RecentCampaign[] }>;
    running: Tile<{ campaign: RunningCampaign | null }>;
  };
};

/**
 * Jedna kampaň v dlaždici „poslední kampaně".
 *
 * Nese i syrové počty, ne jen `clickRate`. Obrazovka Statistiky (úkol 35)
 * z téhle dlaždice kreslí vývoj měr v čase a potřebuje k tomu jmenovatele.
 * Kdyby tu byla jen hotová míra, spočítala by si graf podíly z `undefined`
 * a vykreslil samé nuly, aniž by cokoliv spadlo.
 */
export type RecentCampaign = {
  campaignId: string;
  name: string;
  status: string;
  startedAt: string | null;
  clickRate: number | null;
  sent: number;
  delivered: number;
  deliveredEffective: number;
  opens: number;
  opensApple: number;
  clicks: number;
  unsubscribed: number;
};

export type RunningCampaign = {
  campaignId: string;
  name: string;
  sent: number;
  total: number;
};

type Totals = {
  sent: number;
  deliveredEffective: number;
  bounced: number;
  complained: number;
  opensUnique: number;
  opensApple: number;
  clicksHuman: number;
};

export async function readDashboard(
  tx: Tx,
  ctx: WorkspaceContext,
  input: { periodDays: DashboardPeriod; timezone: string; cache: TileCache },
): Promise<DashboardResponse> {
  const key = (name: string) => `${ctx.workspaceId}:${input.periodDays}:${name}`;
  const now = new Date();
  const from = daysAgo(now, input.periodDays);
  const previousFrom = daysAgo(now, input.periodDays * 2);

  const [current, previous] = await Promise.all([
    input.cache.resolve(key('totals'), STATS_TTL_MS, () => readTotals(tx, ctx, from, now)),
    input.cache.resolve(key('totals_previous'), STATS_TTL_MS, () =>
      readTotals(tx, ctx, previousFrom, from),
    ),
  ]);

  const [webActive, recent, running] = await Promise.all([
    input.cache.resolve(key('web_active'), WEB_TTL_MS, async () => ({
      contacts: await readWebActive(tx, ctx),
    })),
    input.cache.resolve(key('recent'), STATS_TTL_MS, async () => ({
      items: await readRecentCampaigns(tx, ctx, from, now),
    })),
    input.cache.resolve(key('running'), STATS_TTL_MS, async () => ({
      campaign: await readRunningCampaign(tx, ctx),
    })),
  ]);

  return {
    periodDays: input.periodDays,
    computedAt: now.toISOString(),
    tiles: {
      sent: mapTile(current, (t) => ({ value: t.sent })),
      click_rate: mapTile(current, (t) => ({
        rate: ratio(t.clicksHuman, t.deliveredEffective),
        delta: deltaOf(current, previous),
      })),
      open_rate: mapTile(current, (t) => ({
        rate: ratio(t.opensUnique, t.deliveredEffective),
        machineShare: ratio(t.opensApple, t.opensUnique),
      })),
      problems: mapTile(current, (t) => {
        const bounceRate = ratio(t.bounced, t.sent);
        const complaintRate = ratio(t.complained, t.deliveredEffective);
        return { bounceRate, complaintRate, level: severity(bounceRate, complaintRate) };
      }),
      web_active: webActive,
      recent_campaigns: recent,
      running,
    },
  };
}

/**
 * Vážený průměr přes kampaně se počítá jako podíl součtů, ne jako průměr podílů.
 * Průměr podílů by dal kampani na deset lidí stejnou váhu jako kampani na deset tisíc.
 *
 * Míra prokliku bere ověřené prokliky (clicks_unique_human), stejně jako report.
 * Definice metrik vlastní část 5 (3.11.3), 8.11.1 části 6 na ni odkazuje.
 *
 * Řídicí tabulka je `campaigns`, ne `campaign_stats`, a spojení je LEFT JOIN.
 * Řádek agregace zakládá až první běh jobu z P10, takže ho čerstvě odeslaná
 * kampaň ještě nemá. S `FROM campaign_stats` by z přehledu vypadla úplně,
 * a je to právě ta kampaň, kvůli které se uživatel na přehled dívá. Nespadlo
 * by nic, jen by chyběla. Každý čítač proto prochází `coalesce(..., 0)`
 * dvakrát: jednou proti chybějícímu řádku, podruhé proti prázdné množině.
 */
async function readTotals(tx: Tx, ctx: WorkspaceContext, from: Date, to: Date): Promise<Totals> {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT coalesce(sum(coalesce(s.sent, 0)), 0)   AS sent,
           coalesce(sum(
             CASE WHEN p.type = 'smtp' OR coalesce(s.delivered, 0) = 0
                  THEN greatest(coalesce(s.sent, 0) - coalesce(s.bounced_hard, 0)
                                - coalesce(s.bounced_soft, 0) - coalesce(s.failed, 0), 0)
                  ELSE s.delivered END
           ), 0)                                   AS delivered_effective,
           coalesce(sum(coalesce(s.bounced_hard, 0) + coalesce(s.bounced_soft, 0)), 0) AS bounced,
           coalesce(sum(coalesce(s.complained, 0)), 0)          AS complained,
           coalesce(sum(coalesce(s.opens_unique, 0)), 0)        AS opens_unique,
           coalesce(sum(coalesce(s.opens_unique_apple, 0)), 0)  AS opens_apple,
           coalesce(sum(coalesce(s.clicks_unique_human, 0)), 0) AS clicks_human
      FROM campaigns c
      LEFT JOIN campaign_stats s ON s.campaign_id = c.id AND s.workspace_id = c.workspace_id
      LEFT JOIN sending_providers p ON p.id = c.provider_id AND p.workspace_id = c.workspace_id
     WHERE c.workspace_id = ${ctx.workspaceId}
       AND c.deleted_at IS NULL
       AND c.started_at >= ${from}
       AND c.started_at <  ${to}
  `);
  const row = rows[0] ?? {};
  return {
    sent: Number(row.sent ?? 0),
    deliveredEffective: Number(row.delivered_effective ?? 0),
    bounced: Number(row.bounced ?? 0),
    complained: Number(row.complained ?? 0),
    opensUnique: Number(row.opens_unique ?? 0),
    opensApple: Number(row.opens_apple ?? 0),
    clicksHuman: Number(row.clicks_human ?? 0),
  };
}

/**
 * Jediný dotaz přehledu, který sahá do web_events.
 *
 * Dvě podmínky, obě povinné a každá z jiného důvodu:
 *   - `received_at` je partiční klíč a prořezává na jednu, nejvýš dvě partition,
 *   - `occurred_at` je ve sloupcích indexu `idx_web_events__contact_occurred
 *     (workspace_id, contact_id, occurred_at DESC) WHERE contact_id IS NOT NULL`,
 *     takže se dotaz přečte z indexu.
 *
 * Se samotným `received_at` by uvnitř oddílu nezbylo nic než sekvenční průchod:
 * index nad dvojicí `(workspace_id, received_at)` v P03 NENÍ. Oddíl je přitom
 * měsíc událostí **celé instalace**, ne jednoho projektu.
 *
 * Dolní mez `received_at` má minutovou rezervu, protože `ck_web_events__lag`
 * povoluje `received_at` až o minutu před `occurred_at`.
 */
async function readWebActive(tx: Tx, ctx: WorkspaceContext): Promise<number> {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT count(DISTINCT contact_id) AS contacts
      FROM web_events
     WHERE workspace_id = ${ctx.workspaceId}
       AND contact_id IS NOT NULL
       AND occurred_at >= now() - interval '24 hours'
       AND received_at >= now() - interval '24 hours' - interval '60 seconds'
       AND received_at <  now() + interval '7 days'
  `);
  return Number(rows[0]?.contacts ?? 0);
}

/** Kolik kampaní se vejde do dlaždice a zároveň stačí grafu vývoje (úkol 35). */
const RECENT_CAMPAIGNS_LIMIT = 24;

/**
 * Poslední kampaně **zvoleného období**, ne posledních pět bez ohledu na filtr.
 * Perioda se respektuje ze stejného důvodu jako u dlaždic: kdyby ji dlaždice
 * ignorovala, ukazovala by přehled za sedm dní kampaně staré půl roku.
 */
async function readRecentCampaigns(
  tx: Tx,
  ctx: WorkspaceContext,
  from: Date,
  to: Date,
): Promise<RecentCampaign[]> {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT c.id, c.name, c.status, c.started_at, p.type AS provider_type,
           s.clicks_unique_human, s.delivered, s.sent, s.bounced_hard, s.bounced_soft,
           s.failed, s.opens_unique, s.opens_unique_apple, s.unsubscribed
      FROM campaigns c
      LEFT JOIN campaign_stats s ON s.campaign_id = c.id AND s.workspace_id = c.workspace_id
      LEFT JOIN sending_providers p ON p.id = c.provider_id AND p.workspace_id = c.workspace_id
     WHERE c.workspace_id = ${ctx.workspaceId}
       AND c.deleted_at IS NULL
       AND c.started_at IS NOT NULL
       AND c.started_at >= ${from}
       AND c.started_at <  ${to}
     ORDER BY c.started_at DESC
     LIMIT ${RECENT_CAMPAIGNS_LIMIT}
  `);
  return rows.map((row) => {
    const delivered = Number(row.delivered ?? 0);
    const derived = Math.max(
      Number(row.sent ?? 0) - Number(row.bounced_hard ?? 0) - Number(row.bounced_soft ?? 0) - Number(row.failed ?? 0),
      0,
    );
    // Stejné pravidlo jako v readTotals: SMTP provider události doručení neposílá.
    const base = row.provider_type === 'smtp' || delivered === 0 ? derived : delivered;
    return {
      campaignId: String(row.id),
      name: String(row.name),
      status: String(row.status),
      startedAt: row.started_at ? new Date(row.started_at as string | Date).toISOString() : null,
      clickRate: ratio(Number(row.clicks_unique_human ?? 0), base),
      sent: Number(row.sent ?? 0),
      delivered,
      deliveredEffective: base,
      opens: Number(row.opens_unique ?? 0),
      opensApple: Number(row.opens_unique_apple ?? 0),
      clicks: Number(row.clicks_unique_human ?? 0),
      unsubscribed: Number(row.unsubscribed ?? 0),
    };
  });
}

async function readRunningCampaign(tx: Tx, ctx: WorkspaceContext): Promise<RunningCampaign | null> {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT c.id, c.name, coalesce(s.sent, 0) AS sent, coalesce(s.materialized, 0) AS total
      FROM campaigns c
      LEFT JOIN campaign_stats s ON s.campaign_id = c.id AND s.workspace_id = c.workspace_id
     WHERE c.workspace_id = ${ctx.workspaceId}
       AND c.deleted_at IS NULL
       AND c.status IN ('sending', 'queueing')
     ORDER BY c.started_at DESC NULLS LAST
     LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    campaignId: String(row.id),
    name: String(row.name),
    sent: Number(row.sent ?? 0),
    total: Number(row.total ?? 0),
  };
}

function mapTile<T, U>(tile: Tile<T>, project: (value: T) => U): Tile<U> {
  if (tile.status === 'error') return tile;
  return { status: 'ok', data: project(tile.data), computedAt: tile.computedAt, stale: tile.stale };
}

function deltaOf(current: Tile<Totals>, previous: Tile<Totals>): number | null {
  if (current.status !== 'ok' || previous.status !== 'ok') return null;
  const now = ratio(current.data.clicksHuman, current.data.deliveredEffective);
  const before = ratio(previous.data.clicksHuman, previous.data.deliveredEffective);
  if (now === null || before === null) return null;
  return now - before;
}

function severity(bounceRate: number | null, complaintRate: number | null): 'ok' | 'warn' | 'bad' {
  if ((bounceRate ?? 0) > BOUNCE_WARN || (complaintRate ?? 0) > COMPLAINT_WARN) return 'bad';
  if ((bounceRate ?? 0) > BOUNCE_WARN / 2 || (complaintRate ?? 0) > COMPLAINT_WARN / 2) return 'warn';
  return 'ok';
}

function ratio(numerator: number, denominator: number): number | null {
  if (denominator <= 0) return null;
  const value = numerator / denominator;
  return Number.isFinite(value) ? value : null;
}

function daysAgo(from: Date, days: number): Date {
  return new Date(from.getTime() - days * 24 * 60 * 60 * 1000);
}
```

- [ ] **Krok 4: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/dashboard/read.db.test.ts`
Expected: PASS, `Tests  6 passed (6)`.

- [ ] **Krok 5: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add packages/core/src/reports/dashboard/read.ts packages/core/src/reports/dashboard/read.db.test.ts && git commit -m "feat(reports): read dashboard tiles with click rate as the headline"
```

---

### Úkol 23: Stropy spojení a poller kampaně

Sto souběžných uživatelů na jedné kampani musí znamenat **jeden** dotaz za dvě sekundy, ne sto (kritérium 97).

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/stream/connections.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/stream/poller.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/stream/connections.test.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/stream/poller.test.ts`

- [ ] **Krok 1: Napiš padající testy**

`packages/core/src/reports/stream/connections.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ConnectionLimiter } from './connections.js';

describe('ConnectionLimiter', () => {
  it('pustí nejvýš dvě spojení na jednu relaci', () => {
    const limiter = new ConnectionLimiter({ maxTotal: 100, maxPerSession: 2 });
    expect(limiter.acquire('s1')).not.toBeNull();
    expect(limiter.acquire('s1')).not.toBeNull();
    expect(limiter.acquire('s1')).toBeNull();
    expect(limiter.acquire('s2')).not.toBeNull();
  });

  it('po uvolnění dá slot zpátky', () => {
    const limiter = new ConnectionLimiter({ maxTotal: 100, maxPerSession: 1 });
    const release = limiter.acquire('s1');
    release?.();
    expect(limiter.acquire('s1')).not.toBeNull();
  });

  it('drží strop instance a hlásí obsazenost', () => {
    const limiter = new ConnectionLimiter({ maxTotal: 2, maxPerSession: 5 });
    limiter.acquire('a');
    limiter.acquire('b');
    expect(limiter.acquire('c')).toBeNull();
    expect(limiter.count).toBe(2);
  });

  it('dvojí uvolnění téhož spojení nesníží čítač dvakrát', () => {
    const limiter = new ConnectionLimiter({ maxTotal: 2, maxPerSession: 5 });
    const release = limiter.acquire('a');
    release?.();
    release?.();
    expect(limiter.count).toBe(0);
  });
});
```

`packages/core/src/reports/stream/poller.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { emptyCounts } from '../metrics/counts.js';
import { PollerRegistry } from './poller.js';

function snapshot(version: number, sent: number) {
  return {
    version,
    updatedAt: new Date('2026-07-31T12:00:00.000Z'),
    counts: { ...emptyCounts(), sent },
    status: 'sending',
  };
}

describe('PollerRegistry', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sto odběratelů na jedné kampani znamená jeden dotaz za interval (kritérium 97)', async () => {
    const load = vi.fn().mockResolvedValue(snapshot(1, 10));
    const registry = new PollerRegistry({ intervalMs: 2000, load });
    for (let i = 0; i < 100; i += 1) registry.subscribe('c1', () => {});
    await vi.advanceTimersByTimeAsync(2000);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('pošle zprávu jen při změně otisku', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce(snapshot(1, 10))
      .mockResolvedValueOnce(snapshot(1, 10))
      .mockResolvedValueOnce(snapshot(2, 11));
    const registry = new PollerRegistry({ intervalMs: 2000, load });
    const received: number[] = [];
    registry.subscribe('c1', (data) => received.push(data.counts.sent));
    await vi.advanceTimersByTimeAsync(6000);
    expect(received).toEqual([10, 11]);
  });

  it('po odhlášení posledního odběratele se poller zastaví', async () => {
    const load = vi.fn().mockResolvedValue(snapshot(1, 10));
    const registry = new PollerRegistry({ intervalMs: 2000, load });
    const unsubscribe = registry.subscribe('c1', () => {});
    await vi.advanceTimersByTimeAsync(2000);
    unsubscribe();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(load).toHaveBeenCalledTimes(1);
    expect(registry.activeCampaigns).toBe(0);
  });

  it('nahlásí zapisovatele, který změnil počty a nezvýšil verzi', async () => {
    const load = vi
      .fn()
      .mockResolvedValueOnce(snapshot(1, 10))
      .mockResolvedValueOnce(snapshot(1, 11));
    const onStaleVersion = vi.fn();
    const registry = new PollerRegistry({ intervalMs: 2000, load, onStaleVersion });
    registry.subscribe('c1', () => {});
    await vi.advanceTimersByTimeAsync(4000);
    expect(onStaleVersion).toHaveBeenCalledWith('c1');
  });

  it('chyba načtení poller nezabije, další interval to zkusí znovu', async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('databáze mlčí'))
      .mockResolvedValue(snapshot(2, 5));
    const registry = new PollerRegistry({ intervalMs: 2000, load });
    const received: number[] = [];
    registry.subscribe('c1', (data) => received.push(data.counts.sent));
    await vi.advanceTimersByTimeAsync(4000);
    expect(received).toEqual([5]);
  });
});
```

- [ ] **Krok 2: Spusť testy a ověř, že padají**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/stream`
Expected: FAIL, `Cannot find module './connections.js'`.

- [ ] **Krok 3: Napiš `stream/connections.ts`**

```ts
export type ReleaseFn = () => void;

/**
 * Stropy z 3.13.3 části 5: nejvýš dvě spojení na relaci a nejvýš
 * TRACKING_SSE_MAX_CONNECTIONS na instanci. Nad limit se vrací 503
 * a klient přejde na dotazování, což je plnohodnotný režim, ne degradace.
 */
export class ConnectionLimiter {
  private total = 0;
  private readonly perSession = new Map<string, number>();

  constructor(private readonly limits: { maxTotal: number; maxPerSession: number }) {}

  get count(): number {
    return this.total;
  }

  acquire(sessionKey: string): ReleaseFn | null {
    const used = this.perSession.get(sessionKey) ?? 0;
    if (this.total >= this.limits.maxTotal) return null;
    if (used >= this.limits.maxPerSession) return null;

    this.total += 1;
    this.perSession.set(sessionKey, used + 1);

    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.total -= 1;
      const current = this.perSession.get(sessionKey) ?? 1;
      if (current <= 1) this.perSession.delete(sessionKey);
      else this.perSession.set(sessionKey, current - 1);
    };
  }
}
```

- [ ] **Krok 4: Napiš `stream/poller.ts`**

```ts
import type { StatsCounts } from '../metrics/counts.js';
import { detectStaleVersion, statsFingerprint } from '../campaign-stats/fingerprint.js';

export type StatsSnapshot = {
  version: number;
  updatedAt: Date;
  counts: StatsCounts;
  status: string;
};

export type Subscriber = (snapshot: StatsSnapshot) => void;

export type PollerOptions = {
  intervalMs: number;
  load: (campaignId: string) => Promise<StatsSnapshot>;
  onStaleVersion?: (campaignId: string) => void;
};

type PollerState = {
  timer: ReturnType<typeof setInterval>;
  subscribers: Set<Subscriber>;
  last: StatsSnapshot | null;
  lastFingerprint: string | null;
};

/**
 * Jeden poller na kampaň, ne jeden na spojení. Sto otevřených streamů na
 * jednu kampaň tedy dělá jeden dotaz za interval. Poller se sám ukončí,
 * jakmile nemá odběratele.
 */
export class PollerRegistry {
  private readonly pollers = new Map<string, PollerState>();

  constructor(private readonly options: PollerOptions) {}

  get activeCampaigns(): number {
    return this.pollers.size;
  }

  subscribe(campaignId: string, subscriber: Subscriber): () => void {
    const state = this.pollers.get(campaignId) ?? this.start(campaignId);
    state.subscribers.add(subscriber);
    if (state.last) subscriber(state.last);

    return () => {
      state.subscribers.delete(subscriber);
      if (state.subscribers.size === 0) {
        clearInterval(state.timer);
        this.pollers.delete(campaignId);
      }
    };
  }

  private start(campaignId: string): PollerState {
    const state: PollerState = {
      subscribers: new Set(),
      last: null,
      lastFingerprint: null,
      timer: setInterval(() => void this.tick(campaignId), this.options.intervalMs),
    };
    this.pollers.set(campaignId, state);
    return state;
  }

  private async tick(campaignId: string): Promise<void> {
    const state = this.pollers.get(campaignId);
    if (!state) return;

    let snapshot: StatsSnapshot;
    try {
      snapshot = await this.options.load(campaignId);
    } catch {
      // Výpadek dotazu spojení nezabíjí. Klient dostane další zprávu, až se to povede.
      return;
    }

    if (state.last && detectStaleVersion(state.last, snapshot)) {
      this.options.onStaleVersion?.(campaignId);
    }

    const fingerprint = statsFingerprint(snapshot);
    state.last = snapshot;
    if (fingerprint === state.lastFingerprint) return;
    state.lastFingerprint = fingerprint;

    for (const subscriber of state.subscribers) subscriber(snapshot);
  }
}
```

- [ ] **Krok 5: Spusť testy a ověř, že procházejí**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/stream`
Expected: PASS, `Tests  9 passed (9)`.

- [ ] **Krok 6: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add packages/core/src/reports/stream && git commit -m "feat(reports): one poller per campaign and hard connection limits"
```

---

### Úkol 24: Schémata odpovědí a endpoint souhrnu kampaně

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/api/context.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/api/schemas.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/api/campaign-stats.routes.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/api/campaign-stats.routes.db.test.ts`

- [ ] **Krok 1: Napiš padající test**

`packages/core/src/reports/api/campaign-stats.routes.db.test.ts`:

```ts
import { OpenAPIHono } from '@hono/zod-openapi';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestTx, startTestDatabase, testContext, type TestDatabase } from '../test-support/db.js';
import { seedCampaign, seedCampaignStats, seedWorkspace } from '../test-support/fixtures.js';
import { campaignStatsRoutes } from './campaign-stats.routes.js';

describe('GET /campaigns/{id}/stats', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  function appFor(workspaceId: string) {
    const app = new OpenAPIHono();
    app.use('*', async (c, next) => {
      // Stejný tvar, jaký v provozu nastavuje middleware z P04.
      c.set('auth', { ctx: testContext(workspaceId), label: 'test' });
      c.set('reportsTx', createTestTx(db));
      await next();
    });
    app.route('/', campaignStatsRoutes);
    return app;
  }

  it('vrátí souhrn v snake_case s ETagem z verze', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    await seedCampaignStats(db, ws.workspaceId, campaign.campaignId, {
      sent: 1000, delivered: 1000, opens_unique: 500, opens_unique_human: 200,
      opens_unique_apple: 300, clicks_unique_human: 187,
    });

    const response = await appFor(ws.workspaceId).request(`/campaigns/${campaign.campaignId}/stats`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ campaign_id: campaign.campaignId, delivered_source: 'provider_events' });
    expect((body.counts as Record<string, number>).opens_unique_apple).toBe(300);
    expect((body.rates as Record<string, number>).click_rate).toBeCloseTo(0.187, 10);
    expect(response.headers.get('etag')).toBe(`W/"${body.version}"`);
  });

  it('při shodě If-None-Match vrátí 304 bez těla (kritérium 100)', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    await seedCampaignStats(db, ws.workspaceId, campaign.campaignId, { sent: 1 });
    const app = appFor(ws.workspaceId);
    const first = await app.request(`/campaigns/${campaign.campaignId}/stats`);
    const etag = first.headers.get('etag') ?? '';
    const second = await app.request(`/campaigns/${campaign.campaignId}/stats`, {
      headers: { 'If-None-Match': etag },
    });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe('');
  });

  it('kampaň jiného projektu vrátí 404, ne 403', async () => {
    const mine = await seedWorkspace(db);
    const other = await seedWorkspace(db);
    const campaign = await seedCampaign(db, other.workspaceId);
    const response = await appFor(mine.workspaceId).request(`/campaigns/${campaign.campaignId}/stats`);
    expect(response.status).toBe(404);
  });

  it('neplatné id vrátí 422 validation_failed', async () => {
    const ws = await seedWorkspace(db);
    const response = await appFor(ws.workspaceId).request('/campaigns/neni-uuid/stats');
    expect(response.status).toBe(422);
  });

  it('vrátí průběh v čase a statistiku odkazů', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    await db.pool.query(
      `INSERT INTO campaign_stats_buckets (campaign_id, workspace_id, bucket_at, sent, delivered, opens_unique, clicks_unique, bounced)
       VALUES ($1, $2, '2026-07-31T12:00:00.000Z', 100, 90, 10, 2, 1)`,
      [campaign.campaignId, ws.workspaceId],
    );
    const app = appFor(ws.workspaceId);
    const timeline = await app.request(`/campaigns/${campaign.campaignId}/stats/timeline?granularity=hour`);
    expect(timeline.status).toBe(200);
    expect(((await timeline.json()) as { points: unknown[] }).points).toHaveLength(1);

    const links = await app.request(`/campaigns/${campaign.campaignId}/links`);
    expect(links.status).toBe(200);
    expect(((await links.json()) as { data: unknown[] }).data).toEqual([]);
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/api/campaign-stats.routes.db.test.ts`
Expected: FAIL, `Cannot find module './campaign-stats.routes.js'`.

- [ ] **Krok 3: Napiš `api/context.ts`**

```ts
import type { Context } from 'hono';
import { withWorkspace, type Tx } from '@mlain/core/tx';
import type { WorkspaceContext } from '@mlain/core/identity';

/**
 * Jediné místo, kde tahle doména sahá na proměnné kontextu Hono a na
 * transakci. Kdyby se cokoliv z toho v P04 přejmenovalo, opravuje se to
 * tady a nikde jinde (rozhodnutí R4 o adaptérech platí i pro server).
 *
 * `auth` nastavuje autentizační middleware z P04 (`c.set('auth', { ctx, label })`).
 * Doména z něj bere jen `ctx`; `label` je pro audit, který tenhle plán nepíše.
 */
export type ReportsEnv = {
  Variables: {
    auth: { ctx: WorkspaceContext; label: string };
    /** Nastavují jen testy. V provozu se transakce otevírá přes withWorkspace. */
    reportsTx?: Tx;
  };
};

export function workspaceOf(c: Context<ReportsEnv>): WorkspaceContext {
  const auth = c.get('auth');
  if (!auth?.ctx) throw new Error('Chybí kontext projektu. Cesta musí být za autentizací.');
  return auth.ctx;
}

/**
 * Stabilní klíč aktéra pro stropy spojení. Vlastní proměnnou pro relaci
 * middleware z P04 nenastavuje, takže by `c.get('sessionKey')` bylo
 * `undefined` a všichni uživatelé projektu by sdíleli jeden kbelík: druhý
 * otevřený tab kohokoliv by shodil kolegovi živý report na dotazování.
 */
export function actorKey(actor: WorkspaceContext['actor']): string {
  if (actor.type === 'user') return `user:${actor.userId}`;
  if (actor.type === 'api_key') return `api_key:${actor.apiKeyId}`;
  return `system:${actor.job}`;
}

/**
 * Otevře transakci v kontextu projektu.
 *
 * Bere **celý `WorkspaceContext`**, ne `workspaceId`. Obálky P03 to vyžadují
 * a je to schválně: obálka podle aktéra nastaví `mlain.workspace_id` vždy
 * a `mlain.user_id` u aktéra typu `user`, takže tady se `set_config` nevolá
 * ručně. Pool doplňuje adaptér `@mlain/core/tx` z P04, protože `packages/db`
 * žádný singleton nedrží a držet ho nemá.
 */
export async function inWorkspace<T>(
  c: Context<ReportsEnv>,
  fn: (tx: Tx, ctx: WorkspaceContext) => Promise<T>,
): Promise<T> {
  const ctx = workspaceOf(c);
  const injected = c.get('reportsTx');
  if (injected) return fn(injected, ctx);
  return withWorkspace(ctx, (tx) => fn(tx, ctx));
}
```

Kdyby middleware z P04 ukládal kontext pod jiným klíčem, projeví se to jako `Chybí kontext projektu` na **každé** cestě tohohle plánu. Oprav `ReportsEnv` a `workspaceOf` a rozdíl zapiš do kapitoly 7. Nikde jinde se na proměnné Hono ani na transakci nesahá, hlídá to test `ownership.test.ts` z úkolu 15.

- [ ] **Krok 4: Napiš `api/schemas.ts`**

```ts
import { z } from '@hono/zod-openapi';
import type { CampaignStatsRead } from '../campaign-stats/read.js';

export const uuidParam = z.object({ id: z.string().uuid() });

export const countsSchema = z.object({
  materialized: z.number(),
  sent: z.number(),
  skipped: z.number(),
  failed: z.number(),
  delivered: z.number(),
  delivered_effective: z.number(),
  bounced_hard: z.number(),
  bounced_soft: z.number(),
  complained: z.number(),
  unsubscribed: z.number(),
  opens_total: z.number(),
  opens_unique: z.number(),
  opens_unique_human: z.number(),
  opens_unique_apple: z.number(),
  clicks_total: z.number(),
  clicks_unique: z.number(),
  clicks_unique_human: z.number(),
  clicks_scanner: z.number(),
});

export const ratesSchema = z.object({
  open_rate: z.number().nullable(),
  machine_open_share: z.number().nullable(),
  verified_open_rate: z.number().nullable(),
  click_rate: z.number().nullable(),
  click_to_open_rate: z.number().nullable(),
  bounce_rate: z.number().nullable(),
  complaint_rate: z.number().nullable(),
  unsubscribe_rate: z.number().nullable(),
});

export const campaignStatsSchema = z.object({
  campaign_id: z.string(),
  name: z.string(),
  subject: z.string(),
  // Otevřený výčet, registr vlastní část 4a. Union by klienta rozbil u nové hodnoty.
  status: z.string(),
  track_opens: z.boolean(),
  track_clicks: z.boolean(),
  delivered_source: z.enum(['provider_events', 'derived_from_sent']),
  counts: countsSchema,
  rates: ratesSchema,
  open_breakdown: z.object({
    verified: z.number(),
    machine: z.number(),
    uncertain: z.number(),
    total: z.number(),
    clicked_from_verified: z.number(),
  }),
  predicted_opens: z
    .object({ low_count: z.number(), high_count: z.number(), sample_size: z.number() })
    .nullable(),
  small_sample: z.boolean(),
  audience_built_at: z.string().nullable(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  first_event_at: z.string().nullable(),
  last_event_at: z.string().nullable(),
  version: z.number(),
  updated_at: z.string(),
});

export function toStatsResponse(read: CampaignStatsRead): z.infer<typeof campaignStatsSchema> {
  return {
    campaign_id: read.campaignId,
    name: read.name,
    subject: read.subject,
    status: read.status,
    track_opens: read.trackOpens,
    track_clicks: read.trackClicks,
    delivered_source: read.deliveredSource,
    counts: {
      materialized: read.counts.materialized,
      sent: read.counts.sent,
      skipped: read.counts.skipped,
      failed: read.counts.failed,
      delivered: read.counts.delivered,
      delivered_effective: read.deliveredEffective,
      bounced_hard: read.counts.bouncedHard,
      bounced_soft: read.counts.bouncedSoft,
      complained: read.counts.complained,
      unsubscribed: read.counts.unsubscribed,
      opens_total: read.counts.opensTotal,
      opens_unique: read.counts.opensUnique,
      opens_unique_human: read.counts.opensUniqueHuman,
      opens_unique_apple: read.counts.opensUniqueApple,
      clicks_total: read.counts.clicksTotal,
      clicks_unique: read.counts.clicksUnique,
      clicks_unique_human: read.counts.clicksUniqueHuman,
      clicks_scanner: read.counts.clicksScanner,
    },
    rates: {
      open_rate: read.rates.openRate,
      machine_open_share: read.rates.machineOpenShare,
      verified_open_rate: read.rates.verifiedOpenRate,
      click_rate: read.rates.clickRate,
      click_to_open_rate: read.rates.clickToOpenRate,
      bounce_rate: read.rates.bounceRate,
      complaint_rate: read.rates.complaintRate,
      unsubscribe_rate: read.rates.unsubscribeRate,
    },
    open_breakdown: {
      verified: read.breakdown.verified,
      machine: read.breakdown.machine,
      uncertain: read.breakdown.uncertain,
      total: read.breakdown.total,
      clicked_from_verified: read.breakdown.clickedFromVerified,
    },
    predicted_opens: read.predicted
      ? {
          low_count: read.predicted.lowCount,
          high_count: read.predicted.highCount,
          sample_size: read.predicted.sampleSize,
        }
      : null,
    small_sample: read.smallSample,
    audience_built_at: read.audienceBuiltAt?.toISOString() ?? null,
    started_at: read.startedAt?.toISOString() ?? null,
    finished_at: read.finishedAt?.toISOString() ?? null,
    first_event_at: read.firstEventAt?.toISOString() ?? null,
    last_event_at: read.lastEventAt?.toISOString() ?? null,
    version: read.version,
    updated_at: read.updatedAt.toISOString(),
  };
}
```

- [ ] **Krok 5: Napiš `api/campaign-stats.routes.ts`**

```ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { readCampaignBuckets } from '../campaign-stats/buckets.js';
import { readCampaignLinks } from '../campaign-stats/links.js';
import { readCampaignStats } from '../campaign-stats/read.js';
import { inWorkspace, type ReportsEnv } from './context.js';
import { campaignStatsSchema, toStatsResponse, uuidParam } from './schemas.js';

export const campaignStatsRoutes = new OpenAPIHono<ReportsEnv>();

const statsRoute = createRoute({
  method: 'get',
  path: '/campaigns/{id}/stats',
  tags: ['reports'],
  summary: 'Souhrn kampaně',
  request: { params: uuidParam },
  responses: {
    200: { description: 'Souhrn', content: { 'application/json': { schema: campaignStatsSchema } } },
    304: { description: 'Beze změny' },
    404: { description: 'Kampaň neexistuje' },
  },
});

campaignStatsRoutes.openapi(statsRoute, async (c) => {
  const { id } = c.req.valid('param');
  const read = await inWorkspace(c, (tx, ctx) => readCampaignStats(tx, ctx, id));
  const etag = `W/"${read.version}"`;

  // Levné "beze změny" v režimu dotazování: odpověď 304 nemá tělo
  // a serverová práce je jedno čtení řádku podle primárního klíče.
  if (c.req.header('If-None-Match') === etag) {
    return c.body(null, 304, { ETag: etag, 'Cache-Control': 'no-store' });
  }

  c.header('ETag', etag);
  c.header('Cache-Control', 'no-store');
  return c.json(toStatsResponse(read), 200);
});

const timelineRoute = createRoute({
  method: 'get',
  path: '/campaigns/{id}/stats/timeline',
  tags: ['reports'],
  summary: 'Průběh kampaně v čase',
  request: {
    params: uuidParam,
    query: z.object({ granularity: z.enum(['5m', 'hour', 'day']).default('5m') }),
  },
  responses: {
    200: {
      description: 'Body grafu',
      content: {
        'application/json': {
          schema: z.object({
            granularity: z.enum(['5m', 'hour', 'day']),
            compacted: z.boolean(),
            points: z.array(
              z.object({
                at: z.string(),
                sent: z.number(),
                delivered: z.number(),
                opens_unique: z.number(),
                clicks_unique: z.number(),
                bounced: z.number(),
              }),
            ),
          }),
        },
      },
    },
  },
});

campaignStatsRoutes.openapi(timelineRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { granularity } = c.req.valid('query');
  const result = await inWorkspace(c, async (tx, ctx) => {
    const { rows } = await tx.execute<{ timezone: string }>(
      // Zóna projektu, ne uživatele: report je vázaný k projektu (12.4 části 6).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (await import('drizzle-orm')).sql`SELECT timezone FROM workspaces WHERE id = ${ctx.workspaceId}`,
    );
    return readCampaignBuckets(tx, ctx, {
      campaignId: id,
      granularity,
      timezone: rows[0]?.timezone ?? 'UTC',
    });
  });

  return c.json(
    {
      granularity: result.granularity,
      compacted: result.compacted,
      points: result.points.map((point) => ({
        at: point.at,
        sent: point.sent,
        delivered: point.delivered,
        opens_unique: point.opensUnique,
        clicks_unique: point.clicksUnique,
        bounced: point.bounced,
      })),
    },
    200,
  );
});

const linksRoute = createRoute({
  method: 'get',
  path: '/campaigns/{id}/links',
  tags: ['reports'],
  summary: 'Na co lidé klikali',
  request: { params: uuidParam },
  responses: {
    200: {
      description: 'Odkazy kampaně',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(
              z.object({
                link_id: z.string(),
                url: z.string(),
                label: z.string().nullable(),
                position: z.number(),
                clicks_total: z.number(),
                clicks_unique: z.number(),
                clicks_human: z.number(),
                share: z.number(),
                duplicate_url: z.boolean(),
              }),
            ),
          }),
        },
      },
    },
  },
});

campaignStatsRoutes.openapi(linksRoute, async (c) => {
  const { id } = c.req.valid('param');
  const links = await inWorkspace(c, (tx, ctx) => readCampaignLinks(tx, ctx, id));
  return c.json(
    {
      data: links.map((link) => ({
        link_id: link.linkId,
        url: link.url,
        label: link.label,
        position: link.position,
        clicks_total: link.clicksTotal,
        clicks_unique: link.clicksUnique,
        clicks_human: link.clicksHuman,
        share: link.share,
        duplicate_url: link.duplicateUrl,
      })),
    },
    200,
  );
});
```

- [ ] **Krok 6: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/api/campaign-stats.routes.db.test.ts`
Expected: PASS, `Tests  5 passed (5)`.

- [ ] **Krok 7: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add packages/core/src/reports/api && git commit -m "feat(reports): expose campaign stats, progress and link endpoints"
```

---

### Úkol 25: Endpointy příjemců, časové osy a přehledu

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/api/campaign-recipients.routes.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/api/contact-timeline.routes.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/api/dashboard.routes.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/api/routes.db.test.ts`

- [ ] **Krok 1: Napiš padající test**

`packages/core/src/reports/api/routes.db.test.ts`:

```ts
import { OpenAPIHono } from '@hono/zod-openapi';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestTx, startTestDatabase, testContext, type TestDatabase } from '../test-support/db.js';
import { seedCampaign, seedContact, seedWorkspace } from '../test-support/fixtures.js';
import { campaignRecipientsRoutes } from './campaign-recipients.routes.js';
import { contactTimelineRoutes } from './contact-timeline.routes.js';
import { dashboardRoutes } from './dashboard.routes.js';

describe('endpointy příjemců, osy a přehledu', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  function appFor(workspaceId: string) {
    const app = new OpenAPIHono();
    app.use('*', async (c, next) => {
      // Stejný tvar, jaký v provozu nastavuje middleware z P04.
      c.set('auth', { ctx: testContext(workspaceId), label: 'test' });
      c.set('reportsTx', createTestTx(db));
      await next();
    });
    app.route('/', campaignRecipientsRoutes);
    app.route('/', contactTimelineRoutes);
    app.route('/', dashboardRoutes);
    return app;
  }

  it('příjemci vracejí stránkovanou obálku podle konvence 4.3', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    const response = await appFor(ws.workspaceId).request(
      `/campaigns/${campaign.campaignId}/recipients?filter=all&limit=10`,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toHaveProperty('data');
    expect(body.pagination).toMatchObject({ has_more: false, limit: 10, next_cursor: null });
  });

  it('neznámý filtr příjemců vrátí 422', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId);
    const response = await appFor(ws.workspaceId).request(
      `/campaigns/${campaign.campaignId}/recipients?filter=vsichni_kdo_neco`,
    );
    expect(response.status).toBe(422);
  });

  it('časová osa vrací položky s lokalizovaným title', async () => {
    const ws = await seedWorkspace(db);
    const contact = await seedContact(db, ws.workspaceId, { gender: 'female' });
    await db.pool.query(`UPDATE contacts SET created_at = now() - interval '2 days' WHERE id = $1`, [contact]);
    const response = await appFor(ws.workspaceId).request(`/contacts/${contact}/timeline`, {
      headers: { 'Accept-Language': 'cs' },
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: Array<{ title: string; type: string }> };
    expect(body.data[0]?.type).toBe('contact_created');
    expect(body.data[0]?.title.length).toBeGreaterThan(0);
  });

  it('časová osa neexistujícího kontaktu vrací 404', async () => {
    const ws = await seedWorkspace(db);
    const response = await appFor(ws.workspaceId).request(
      '/contacts/00000000-0000-4000-8000-000000000000/timeline',
    );
    expect(response.status).toBe(404);
  });

  it('přehled vrací dlaždice a čas výpočtu', async () => {
    const ws = await seedWorkspace(db);
    const response = await appFor(ws.workspaceId).request('/dashboard?period=30');
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.period_days).toBe(30);
    expect(body).toHaveProperty('computed_at');
    expect(Object.keys(body.tiles as Record<string, unknown>)).toContain('click_rate');
  });

  it('neplatné období přehledu vrátí 422', async () => {
    const ws = await seedWorkspace(db);
    const response = await appFor(ws.workspaceId).request('/dashboard?period=365');
    expect(response.status).toBe(422);
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/api/routes.db.test.ts`
Expected: FAIL, `Cannot find module './campaign-recipients.routes.js'`.

- [ ] **Krok 3: Napiš `api/campaign-recipients.routes.ts`**

```ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { RECIPIENT_FILTERS, readCampaignRecipients } from '../campaign-stats/recipients.js';
import { inWorkspace, type ReportsEnv } from './context.js';
import { uuidParam } from './schemas.js';

export const campaignRecipientsRoutes = new OpenAPIHono<ReportsEnv>();

const recipientsRoute = createRoute({
  method: 'get',
  path: '/campaigns/{id}/recipients',
  tags: ['reports'],
  summary: 'Příjemci kampaně a jejich engagement',
  request: {
    params: uuidParam,
    query: z.object({
      filter: z.enum(RECIPIENT_FILTERS).default('all'),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
  },
  responses: {
    200: {
      description: 'Stránka příjemců',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(
              z.object({
                message_id: z.string(),
                contact_id: z.string().nullable(),
                email: z.string().nullable(),
                name: z.string().nullable(),
                contact_state: z.enum(['active', 'deleted', 'erased']),
                first_open_at: z.string().nullable(),
                first_click_at: z.string().nullable(),
                open_count: z.number(),
                click_count: z.number(),
                open_reliability: z.enum(['confirmed', 'machine']).nullable(),
              }),
            ),
            pagination: z.object({
              next_cursor: z.string().nullable(),
              prev_cursor: z.string().nullable(),
              has_more: z.boolean(),
              limit: z.number(),
            }),
          }),
        },
      },
    },
  },
});

campaignRecipientsRoutes.openapi(recipientsRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { filter, cursor, limit } = c.req.valid('query');
  const page = await inWorkspace(c, (tx, ctx) =>
    readCampaignRecipients(tx, ctx, { campaignId: id, filter, limit, cursor }),
  );

  return c.json(
    {
      data: page.items.map((item) => ({
        message_id: item.messageId,
        contact_id: item.contactId,
        email: item.email,
        name: item.name,
        contact_state: item.contactState,
        first_open_at: item.firstOpenAt,
        first_click_at: item.firstClickAt,
        open_count: item.openCount,
        click_count: item.clickCount,
        open_reliability: item.openReliability,
      })),
      pagination: {
        next_cursor: page.nextCursor,
        prev_cursor: null,
        has_more: page.hasMore,
        limit,
      },
    },
    200,
  );
});
```

- [ ] **Krok 4: Napiš `api/contact-timeline.routes.ts`**

```ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { createTranslator } from 'next-intl';
import { loadMessages } from '@mlain/i18n';
import { readContactTimeline } from '../timeline/query.js';
import type { TimelineFilter } from '../timeline/types.js';
import { inWorkspace, type ReportsEnv } from './context.js';
import { uuidParam } from './schemas.js';

export const contactTimelineRoutes = new OpenAPIHono<ReportsEnv>();

const SUPPORTED_LOCALES = ['cs', 'en'] as const;
const FILTERS = ['email', 'web', 'contact', 'consent'] as const;

const timelineRoute = createRoute({
  method: 'get',
  path: '/contacts/{id}/timeline',
  tags: ['reports'],
  summary: 'Sjednocená časová osa kontaktu',
  request: {
    params: uuidParam,
    query: z.object({
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
      types: z.string().optional(),
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Stránka časové osy',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(
              z.object({
                id: z.string(),
                occurred_at: z.string(),
                // Otevřené výčty. Klient MUSÍ neznámou hodnotu tolerovat.
                source: z.string(),
                type: z.string(),
                title: z.string(),
                detail: z.record(z.string(), z.unknown()).optional(),
                campaign: z.object({ id: z.string(), name: z.string() }).optional(),
                session_id: z.string().optional(),
                reliability: z.enum(['confirmed', 'machine']).optional(),
              }),
            ),
            // Rod kontaktu pro věty ze slotů. Klient kontakt sám nečte.
            // Výčet je stejný jako `contacts.gender` v P03, tedy s `unknown`.
            // Na `other`, které používá komponenta K8, ho převádí až UI.
            contact: z.object({ gender: z.enum(['female', 'male', 'unknown']) }),
            pagination: z.object({
              next_cursor: z.string().nullable(),
              prev_cursor: z.string().nullable(),
              has_more: z.boolean(),
              limit: z.number(),
            }),
          }),
        },
      },
    },
  },
});

contactTimelineRoutes.openapi(timelineRoute, async (c) => {
  const { id } = c.req.valid('param');
  const query = c.req.valid('query');
  const locale = negotiateLocale(c.req.header('Accept-Language'));

  // Věty se skládají na serveru, aby je nemusel implementovat každý klient API.
  const messages = await loadMessages(locale);
  const translator = createTranslator({ locale, messages });
  const translate = (key: string, values: Record<string, unknown>) =>
    translator(`reports.${key}` as never, values as never);

  const types = query.types
    ? query.types
        .split(',')
        .map((value) => value.trim())
        .filter((value): value is TimelineFilter => (FILTERS as readonly string[]).includes(value))
    : undefined;

  const page = await inWorkspace(c, (tx, ctx) =>
    readContactTimeline(tx, ctx, {
      contactId: id,
      limit: query.limit,
      translate,
      cursor: query.cursor,
      types,
      from: query.from ? new Date(query.from) : undefined,
      to: query.to ? new Date(query.to) : undefined,
    }),
  );

  return c.json(
    {
      data: page.items,
      contact: { gender: page.gender },
      pagination: {
        next_cursor: page.nextCursor,
        prev_cursor: null,
        has_more: page.hasMore,
        limit: query.limit,
      },
    },
    200,
  );
});

function negotiateLocale(header: string | undefined): 'cs' | 'en' {
  const preferred = (header ?? '').split(',')[0]?.trim().slice(0, 2).toLowerCase();
  return (SUPPORTED_LOCALES as readonly string[]).includes(preferred ?? '')
    ? (preferred as 'cs' | 'en')
    : 'cs';
}
```

- [ ] **Krok 5: Napiš `api/dashboard.routes.ts`**

```ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { sql } from 'drizzle-orm';
import { TileCache } from '../dashboard/cache.js';
import { readDashboard, type DashboardPeriod } from '../dashboard/read.js';
import { inWorkspace, type ReportsEnv } from './context.js';

export const dashboardRoutes = new OpenAPIHono<ReportsEnv>();

/** Jedna cache na proces. Klíč nese projekt i období, takže se data nemíchají. */
const cache = new TileCache();

const tileSchema = z.union([
  z.object({
    status: z.literal('ok'),
    data: z.record(z.string(), z.unknown()),
    computed_at: z.string(),
    stale: z.boolean(),
  }),
  z.object({ status: z.literal('error'), code: z.string() }),
]);

const dashboardRoute = createRoute({
  method: 'get',
  path: '/dashboard',
  tags: ['reports'],
  summary: 'Dlaždice přehledu',
  request: {
    query: z.object({ period: z.coerce.number().int().refine((v) => [7, 30, 90].includes(v)).default(30) }),
  },
  responses: {
    200: {
      description: 'Dlaždice',
      content: {
        'application/json': {
          schema: z.object({
            period_days: z.number(),
            computed_at: z.string(),
            tiles: z.record(z.string(), tileSchema),
          }),
        },
      },
    },
  },
});

dashboardRoutes.openapi(dashboardRoute, async (c) => {
  const { period } = c.req.valid('query');
  const result = await inWorkspace(c, async (tx, ctx) => {
    const { rows } = await tx.execute<{ timezone: string }>(
      sql`SELECT timezone FROM workspaces WHERE id = ${ctx.workspaceId}`,
    );
    return readDashboard(tx, ctx, {
      periodDays: period as DashboardPeriod,
      timezone: rows[0]?.timezone ?? 'UTC',
      cache,
    });
  });

  return c.json(
    {
      period_days: result.periodDays,
      computed_at: result.computedAt,
      tiles: Object.fromEntries(
        Object.entries(result.tiles).map(([key, tile]) => [
          key,
          tile.status === 'ok'
            ? {
                status: 'ok' as const,
                data: tile.data as Record<string, unknown>,
                computed_at: tile.computedAt,
                stale: tile.stale,
              }
            : tile,
        ]),
      ),
    },
    200,
  );
});
```

- [ ] **Krok 6: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/api/routes.db.test.ts`
Expected: PASS, `Tests  6 passed (6)`.

- [ ] **Krok 7: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add packages/core/src/reports/api && git commit -m "feat(reports): expose recipients, timeline and dashboard endpoints"
```

---

### Úkol 26: SSE endpoint živého průběhu

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/api/campaign-stream.routes.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/api/index.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/index.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/api/campaign-stream.routes.db.test.ts`
- Modify: `/Users/petr/Projects/Mailing_Tool/apps/web/src/lib/api/app.ts` (úzká výjimka 0.4)
- Modify: `/Users/petr/Projects/Mailing_Tool/apps/web/package.json` (úzká výjimka 0.4)

- [ ] **Krok 1: Napiš padající test**

`packages/core/src/reports/api/campaign-stream.routes.db.test.ts`:

```ts
import { OpenAPIHono } from '@hono/zod-openapi';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { unsafeWorkspaceContext } from '@mlain/db/unsafe-context';
import { createTestTx, startTestDatabase, type TestDatabase } from '../test-support/db.js';
import { seedCampaign, seedCampaignStats, seedWorkspace } from '../test-support/fixtures.js';
import { campaignStreamRoutes, streamLimiter } from './campaign-stream.routes.js';

async function readFirstEvent(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('odpověď nemá tělo');
  const { value } = await reader.read();
  await reader.cancel();
  return new TextDecoder().decode(value);
}

describe('GET /campaigns/{id}/stream', () => {
  let db: TestDatabase;

  beforeAll(async () => {
    db = await startTestDatabase();
  }, 180_000);

  afterAll(async () => {
    await db?.stop();
  });

  function appFor(workspaceId: string, actorId = 'user-1') {
    const app = new OpenAPIHono();
    app.use('*', async (c, next) => {
      // Aktér typu `user` je to, co v provozu nastaví middleware z P04
      // po ověření relace. Strop spojení se počítá právě na něj.
      c.set('auth', {
        ctx: unsafeWorkspaceContext(workspaceId, { type: 'user', userId: actorId, role: 'owner' }),
        label: 'test',
      });
      c.set('reportsTx', createTestTx(db));
      await next();
    });
    app.route('/', campaignStreamRoutes);
    return app;
  }

  it('pošle hlavičky, které nepustí buffering proxy', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId, { status: 'sending' });
    await seedCampaignStats(db, ws.workspaceId, campaign.campaignId, { sent: 10 });
    const response = await appFor(ws.workspaceId).request(`/campaigns/${campaign.campaignId}/stream`, {
      headers: { Accept: 'text/event-stream' },
    });
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    await response.body?.cancel();
  });

  it('první zpráva nese aktuální snímek, ne přírůstek', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId, { status: 'sending' });
    await seedCampaignStats(db, ws.workspaceId, campaign.campaignId, { sent: 12043, delivered: 11890 });
    const response = await appFor(ws.workspaceId).request(`/campaigns/${campaign.campaignId}/stream`, {
      headers: { Accept: 'text/event-stream' },
    });
    const chunk = await readFirstEvent(response);
    expect(chunk).toContain('event: stats');
    expect(chunk).toContain('"sent":12043');
  });

  it('třetí spojení téže relace dostane 503, aby klient přešel na dotazování (kritérium 99)', async () => {
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId, { status: 'sending' });
    await seedCampaignStats(db, ws.workspaceId, campaign.campaignId, { sent: 1 });
    const app = appFor(ws.workspaceId, 'session-limit');
    const open: Response[] = [];
    for (let i = 0; i < 2; i += 1) {
      open.push(await app.request(`/campaigns/${campaign.campaignId}/stream`, { headers: { Accept: 'text/event-stream' } }));
    }
    const third = await app.request(`/campaigns/${campaign.campaignId}/stream`, {
      headers: { Accept: 'text/event-stream' },
    });
    expect(third.status).toBe(503);
    for (const response of open) await response.body?.cancel();
  });

  it('po ukončení spojení se uvolní slot', async () => {
    const before = streamLimiter.count;
    const ws = await seedWorkspace(db);
    const campaign = await seedCampaign(db, ws.workspaceId, { status: 'sending' });
    await seedCampaignStats(db, ws.workspaceId, campaign.campaignId, { sent: 1 });
    const response = await appFor(ws.workspaceId, 'session-release').request(
      `/campaigns/${campaign.campaignId}/stream`,
      { headers: { Accept: 'text/event-stream' } },
    );
    await response.body?.cancel();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(streamLimiter.count).toBe(before);
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/api/campaign-stream.routes.db.test.ts`
Expected: FAIL, `Cannot find module './campaign-stream.routes.js'`.

- [ ] **Krok 3: Napiš `api/campaign-stream.routes.ts`**

```ts
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { streamSSE } from 'hono/streaming';
import { config } from '@mlain/core/config';
import { readCampaignStats } from '../campaign-stats/read.js';
import { ConnectionLimiter } from '../stream/connections.js';
import { PollerRegistry, type StatsSnapshot } from '../stream/poller.js';
import { actorKey, inWorkspace, type ReportsEnv, workspaceOf } from './context.js';
import { uuidParam } from './schemas.js';

/** Kontrola změny po dvou sekundách, heartbeat po patnácti, strop spojení třicet minut. */
const CHECK_INTERVAL_MS = 2000;
const HEARTBEAT_MS = 15_000;
const MAX_CONNECTION_MS = 30 * 60 * 1000;

export const streamLimiter = new ConnectionLimiter({
  maxTotal: config.TRACKING_SSE_MAX_CONNECTIONS ?? 500,
  maxPerSession: 2,
});

/** Zapisovatel, který nezvýšil verzi, se musí projevit v logu, ne tichým zamrznutím reportu. */
let staleVersionCount = 0;
export function staleVersionTotal(): number {
  return staleVersionCount;
}

export const campaignStreamRoutes = new OpenAPIHono<ReportsEnv>();

const streamRoute = createRoute({
  method: 'get',
  path: '/campaigns/{id}/stream',
  tags: ['reports'],
  summary: 'Živý průběh kampaně (SSE)',
  request: { params: uuidParam },
  responses: {
    200: { description: 'Proud událostí' },
    503: { description: 'Strop spojení vyčerpán, klient přejde na dotazování' },
  },
});

campaignStreamRoutes.openapi(streamRoute, async (c) => {
  const { id } = c.req.valid('param');
  const ctx = workspaceOf(c);
  // Klíč stropu se skládá z aktéra, ne z proměnné `sessionKey`: tu middleware
  // z P04 nenastavuje a `undefined` by sloučilo všechny uživatele projektu
  // do jednoho kbelíku, takže by druhý otevřený tab shodil kolegu.
  const sessionKey = `${ctx.workspaceId}:${actorKey(ctx.actor)}`;

  // Ověření přístupu proběhne dřív, než se otevře proud: chyba v těle SSE
  // by se ke klientovi dostala jako prázdný stream bez vysvětlení.
  const initial = await inWorkspace(c, (tx, workspace) => readCampaignStats(tx, workspace, id));

  const release = streamLimiter.acquire(sessionKey);
  if (!release) {
    return c.json({ code: 'sse_capacity_reached' }, 503, { 'Retry-After': '5' });
  }

  const registry = new PollerRegistry({
    intervalMs: CHECK_INTERVAL_MS,
    load: async (campaignId) =>
      inWorkspace(c, async (tx, workspace) => {
        const read = await readCampaignStats(tx, workspace, campaignId);
        return {
          version: read.version,
          updatedAt: read.updatedAt,
          counts: read.counts,
          status: read.status,
        } satisfies StatsSnapshot;
      }),
    onStaleVersion: () => {
      staleVersionCount += 1;
    },
  });

  c.header('Content-Type', 'text/event-stream; charset=utf-8');
  c.header('Cache-Control', 'no-store, no-transform');
  c.header('Connection', 'keep-alive');
  // Bez tohohle nginx odpověď bufferuje a události chodí po dávkách.
  c.header('X-Accel-Buffering', 'no');

  return streamSSE(c, async (stream) => {
    const startedAt = Date.now();
    let closed = false;
    const queue: StatsSnapshot[] = [
      {
        version: initial.version,
        updatedAt: initial.updatedAt,
        counts: initial.counts,
        status: initial.status,
      },
    ];

    const unsubscribe = registry.subscribe(id, (snapshot) => queue.push(snapshot));
    stream.onAbort(() => {
      closed = true;
      unsubscribe();
      release();
    });

    let lastHeartbeat = Date.now();

    try {
      while (!closed) {
        const snapshot = queue.shift();
        if (snapshot) {
          await stream.writeSSE({
            event: 'stats',
            id: String(snapshot.version),
            data: JSON.stringify({
              version: snapshot.version,
              status: snapshot.status,
              sent: snapshot.counts.sent,
              delivered: snapshot.counts.delivered,
              opens_unique: snapshot.counts.opensUnique,
              clicks_unique_human: snapshot.counts.clicksUniqueHuman,
            }),
          });
        }

        if (Date.now() - lastHeartbeat >= HEARTBEAT_MS) {
          await stream.writeln(': heartbeat');
          lastHeartbeat = Date.now();
        }

        if (Date.now() - startedAt >= MAX_CONNECTION_MS) {
          await stream.writeSSE({ event: 'end', data: '{"reason":"max_duration"}' });
          break;
        }

        await stream.sleep(200);
      }
    } finally {
      unsubscribe();
      release();
    }
  });
});
```

- [ ] **Krok 4: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/api/campaign-stream.routes.db.test.ts`
Expected: PASS, `Tests  4 passed (4)`.

- [ ] **Krok 5: Slož router domény a namountuj ho do aplikace**

Pět modulů cest se skládá do **jednoho** routeru uvnitř `packages/core`. Opačný směr graf závislostí z 3.11 části 1 zakazuje: `packages/core` nesmí importovat z `apps/web`, takže cesty žijí v core a mount je v aplikaci. Stejný tvar má `contactsApi` v P07.

`packages/core/src/reports/api/index.ts`:

```ts
import { OpenAPIHono } from '@hono/zod-openapi';
import { campaignRecipientsRoutes } from './campaign-recipients.routes.js';
import { campaignStatsRoutes } from './campaign-stats.routes.js';
import { campaignStreamRoutes } from './campaign-stream.routes.js';
import { contactTimelineRoutes } from './contact-timeline.routes.js';
import { dashboardRoutes } from './dashboard.routes.js';
import type { ReportsEnv } from './context.js';

export type { ReportsEnv } from './context.js';

/**
 * Router celé domény. Mountuje ho `apps/web/src/lib/api/app.ts` (výjimka 0.4).
 *
 * Vstupní bod je nutný: mapa `exports` balíčku `@mlain/core` má jediné
 * pravidlo `"./*": "./src/*/index.ts"`, takže import na úroveň souboru,
 * například `@mlain/core/reports/api/campaign-stats.routes`, se nerozřeší.
 */
export const reportsApi = new OpenAPIHono<ReportsEnv>();

reportsApi.route('/', campaignStatsRoutes);
reportsApi.route('/', campaignRecipientsRoutes);
reportsApi.route('/', campaignStreamRoutes);
reportsApi.route('/', contactTimelineRoutes);
reportsApi.route('/', dashboardRoutes);
```

`packages/core/src/reports/index.ts` (doménový vstupní bod, R22):

```ts
// Čtecí funkce, které mimo doménu potřebuje CLI z P16 a integrační testy.
export { readCampaignStats, type CampaignStatsRead } from './campaign-stats/read.js';
export { readCampaignBuckets } from './campaign-stats/buckets.js';
export { readCampaignLinks } from './campaign-stats/links.js';
export { readCampaignRecipients, RECIPIENT_FILTERS } from './campaign-stats/recipients.js';
export { compareWithStored, recomputeCampaignCounts, type DriftReport } from './campaign-stats/recompute.js';
export { readCampaignProgress, bucketDrift } from './progress/read.js';
export { readContactTimeline } from './timeline/query.js';
export { readDashboard } from './dashboard/read.js';
export { EVENT_TYPES, type EventType } from './event-types.js';

// Router se schválně NEREEXPORTUJE. Cesty se importují z '@mlain/core/reports/api',
// aby si aplikace kvůli mountu netáhla celou doménu do svého grafu modulů.
```

Do `apps/web/src/lib/api/app.ts` přidej **právě jeden import a jedno volání** `app.route()`. Nic jiného v souboru neměň.

```ts
import { reportsApi } from '@mlain/core/reports/api';

// ...za existující mounty:
app.route('/api/v1', reportsApi);
```

Do `apps/web/package.json` přidej do `devDependencies` `"eventsource-parser": "3.1.0"`.

- [ ] **Krok 5b: Ověř, že se doména importuje podcestou, kterou mapa `exports` zná**

Run:
```bash
node --input-type=module -e "
for (const spec of ['@mlain/core/reports', '@mlain/core/reports/api']) {
  const mod = await import(spec);
  console.log(spec + ': OK, ' + Object.keys(mod).length + ' exportů');
}
await import('@mlain/core/reports/api/campaign-stats.routes')
  .then(() => console.log('CHYBA: import na úroveň souboru prošel, mapa exports je jinak, než plán čeká'))
  .catch((e) => console.log('import na úroveň souboru správně selhal: ' + e.code));
"
```
Expected: obě podcesty se rozřeší a import na úroveň souboru skončí `ERR_PACKAGE_PATH_NOT_EXPORTED`.

- [ ] **Krok 6: Ověř, že se aplikace přeloží a OpenAPI zná nové cesty**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm install && pnpm --filter @mlain/web typecheck && pnpm --filter @mlain/web exec tsx scripts/generate-openapi.ts && node -e "const d=require('./packages/contracts/openapi.json');const need=['/api/v1/campaigns/{id}/stats','/api/v1/campaigns/{id}/recipients','/api/v1/campaigns/{id}/stream','/api/v1/contacts/{id}/timeline','/api/v1/dashboard'];const missing=need.filter(p=>!d.paths[p]);console.log(missing.length?'MISSING '+missing.join(','):'openapi OK')"
```
Expected: `openapi OK`. `openapi.json` se **nikdy neslučuje ručně**: při konfliktu se obě verze zahodí a soubor se přegeneruje.

- [ ] **Krok 7: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add packages/core/src/reports/api apps/web/src/lib/api/app.ts apps/web/package.json packages/contracts/openapi.json pnpm-lock.yaml && git commit -m "feat(reports): add SSE stream endpoint and mount report routes"
```

---

### Úkol 27: Katalog textů `reports`

Namespace `reports` vlastní tenhle plán. Ostatní katalogy se nedotýká.

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/i18n/messages/cs/reports.json`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/i18n/messages/en/reports.json`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/src/reports/timeline/titles-icu.test.ts`

- [ ] **Krok 1: Napiš padající test ICU vět**

`packages/core/src/reports/timeline/titles-icu.test.ts`:

```ts
import { createTranslator } from 'next-intl';
import { describe, expect, it } from 'vitest';
import csReports from '@mlain/i18n/messages/cs/reports.json' with { type: 'json' };
import enReports from '@mlain/i18n/messages/en/reports.json' with { type: 'json' };
import { composeTitle } from './titles.js';
import type { TimelineRow } from './types.js';

function translatorFor(locale: 'cs' | 'en') {
  const messages = { reports: locale === 'cs' ? csReports : enReports };
  const t = createTranslator({ locale, messages });
  return (key: string, values: Record<string, unknown>) =>
    t(`reports.${key}` as never, values as never);
}

function row(type: string, slots: Record<string, string | number> = {}): TimelineRow {
  return { id: 'x', occurredAt: new Date(), source: 'email', type, slots };
}

describe('věty časové osy v katalogu', () => {
  it('skloňuje sloveso podle rodu kontaktu (kritérium 61 části 6)', () => {
    const cs = translatorFor('cs');
    expect(composeTitle(cs, row('message_opened', { campaign: 'Letní výprodej' }), 'female')).toBe(
      'Otevřela kampaň Letní výprodej',
    );
    expect(composeTitle(cs, row('message_opened', { campaign: 'Letní výprodej' }), 'male')).toBe(
      'Otevřel kampaň Letní výprodej',
    );
  });

  it('u neznámého rodu použije podstatné jméno, ne mužský tvar', () => {
    const cs = translatorFor('cs');
    const title = composeTitle(cs, row('message_opened', { campaign: 'Letní výprodej' }), 'unknown');
    expect(title).toBe('Otevření kampaně Letní výprodej');
    expect(title.startsWith('Otevřel ')).toBe(false);
  });

  it('má všechny typy položek v obou jazycích', () => {
    const types = [
      'message_sent', 'message_failed', 'message_delivered', 'message_opened',
      'message_clicked', 'message_bounced', 'message_complained', 'message_unsubscribed',
      'page_view', 'session_started', 'contact_created', 'list_subscribed',
      'list_unsubscribed', 'consent_granted', 'consent_withdrawn', 'neznamy_typ',
    ];
    for (const locale of ['cs', 'en'] as const) {
      const translate = translatorFor(locale);
      for (const type of types) {
        const title = composeTitle(translate, row(type, { campaign: 'C', link: 'L', list: 'S', page: 'P', name: 'n' }), 'female');
        expect(title.length, `${locale}/${type}`).toBeGreaterThan(0);
        expect(title).not.toContain('reports.');
      }
    }
  });

  it('katalogy neobsahují dlouhou pomlčku', () => {
    const EM_DASH = String.fromCharCode(0x2014);
    for (const catalog of [csReports, enReports]) {
      expect(JSON.stringify(catalog)).not.toContain(EM_DASH);
    }
  });

  it('klíče cs a en se přesně shodují', () => {
    const flatten = (value: unknown, prefix = ''): string[] =>
      typeof value === 'object' && value !== null
        ? Object.entries(value).flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key))
        : [prefix];
    expect(flatten(csReports).sort()).toEqual(flatten(enReports).sort());
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/timeline/titles-icu.test.ts`
Expected: FAIL, `Cannot find module '../../../i18n/messages/cs/reports.json'`.

- [ ] **Krok 3: Napiš `packages/i18n/messages/cs/reports.json`**

```json
{
  "chart": {
    "showTable": "Zobrazit tabulku hodnot",
    "hideTable": "Skrýt tabulku hodnot"
  },
  "table": {
    "selectRow": "Vybrat řádek",
    "selectAllOnPage": "Vybrat vše na stránce",
    "previous": "Předchozí",
    "next": "Další",
    "showing": "{shown, number} z {total, number}{estimated, select, true { (odhad)} other {}}",
    "selectedOnPage": "{count, plural, one {# vybraný} few {# vybrané} other {# vybraných}}",
    "selectAllMatching": "Vybrat všech {total, number} odpovídajících",
    "selectedAllMatching": "Vybráno všech {total, number}",
    "clearSelection": "Zrušit výběr",
    "cursorInvalid": "Odkaz na stránku už neplatí, ukazujeme první stránku stejného filtru.",
    "sortNotAvailable": "Podle tohohle sloupce se řadit nedá",
    "sortedAscending": "Seřazeno vzestupně",
    "sortedDescending": "Seřazeno sestupně",
    "columnSettings": "Nastavení sloupců",
    "columnVisible": "Zobrazit sloupec {column}",
    "columnWidth": "Šířka sloupce {column}"
  },
  "report": {
    "title": "Report kampaně",
    "clicked": { "label": "Kliklo", "denominator": "z doručených", "hint": "Podíl doručených zpráv, u kterých někdo klikl na odkaz. Nejspolehlivější číslo v reportu." },
    "delivered": { "label": "Doručeno", "denominator": "z odeslaných" },
    "unsubscribed": { "label": "Odhlásilo se", "denominator": "z doručených" },
    "opens": {
      "heading": "Otevření",
      "verified": "ověřených",
      "machine": "pravděpodobně automatických",
      "uncertain": "nejistých",
      "clickedFromVerified": "{count, plural, =0 {Z ověřených nikdo neklikl na odkaz.} one {Z ověřených jeden navíc klikl na odkaz.} few {Z ověřených jich # navíc kliklo na odkaz.} many {Z ověřených jich # navíc kliklo na odkaz.} other {Z ověřených jich # navíc kliklo na odkaz.}}",
      "warning": "Část otevření vyrábějí poštovní programy samy, bez toho aby e-mail někdo četl. Spolehlivé číslo je kliknutí.",
      "explainTitle": "Proč jsou otevření nepřesná",
      "explainBody": "Otevření se pozná podle toho, že si poštovní program stáhne malý neviditelný obrázek. Od roku 2021 si ho Apple Mail a další programy stahují předem, samy od sebe, ještě než si e-mail někdo přečte. Nástroj to nemá jak odlišit.",
      "explainAdvice": "Dívejte se na kliknutí. Kliknout musí člověk. Otevření se pořád hodí na jednu věc: kdo za rok neotevřel ani jeden e-mail, je téměř jistě neaktivní.",
      "verifiedRate": { "label": "Ověřená otevření", "denominator": "z doručených bez Apple Mailu", "hint": "Počítá se jen z příjemců, u kterých měření funguje." },
      "toggle": {
        "label": "Odečíst pravděpodobně automatická otevření",
        "onDescription": "Ukazujeme jen ověřená otevření. Jmenovatel je doručeno bez příjemců s Apple Mailem.",
        "offDescription": "Ukazujeme všechna otevření včetně pravděpodobně automatických. Číslo je tím nadhodnocené.",
        "badgeOff": "Zobrazena všechna otevření"
      },
      "predicted": { "label": "Odhad skutečných otevření", "range": "odhad {low} až {high}", "hint": "Není to měření, ale dopočet z části publika, kterou Apple nezkresluje." }
    },
    "problems": {
      "heading": "Problémy",
      "bounced": "Nedoručeno",
      "complained": "Spam",
      "failed": "Chyby",
      "withinNorm": "v normě",
      "high": "vysoké",
      "showWho": "Zobrazit komu"
    },
    "links": { "heading": "Na co lidé klikali", "clicks": "{count, plural, =0 {žádné kliknutí} one {# kliknutí} few {# kliknutí} many {# kliknutí} other {# kliknutí}}", "people": "{count, plural, =0 {nikdo} one {# člověk} few {# lidé} many {# lidí} other {# lidí}}", "share": "podíl", "duplicate": "Stejná adresa jako jiný odkaz v e-mailu", "showWho": "Zobrazit koho", "empty": "V kampani nebyl žádný měřený odkaz." },
    "chart": { "heading": "V čase", "granularity5m": "Po 5 minutách", "granularityHour": "Po hodinách", "granularityDay": "Po dnech", "tableCaption": "Tabulka hodnot z grafu", "compacted": "Starší než 30 dní se ukládá po hodinách, jemnější rozlišení už není k dispozici.", "columnTime": "Čas", "columnSent": "Odesláno", "columnDelivered": "Doručeno", "columnOpens": "Otevření", "columnClicks": "Prokliky" },
    "diagnostics": { "heading": "Diagnostika", "scannerClicks": "Odfiltrované strojové prokliky", "scannerClicksHint": "Firemní antispam navštíví každý odkaz, aby ho prověřil. Tyhle prokliky do čísel nepočítáme.", "lastEvent": "Poslední událost", "noEvents": "Zatím nedorazila žádná událost.", "deliveredSourceProvider": "Doručení hlásí odesílací služba.", "deliveredSourceDerived": "Odesílací služba doručení nehlásí, počítá se jako odeslané minus odmítnutá." },
    "banner": { "sending": "Odesílání probíhá, čísla se průběžně mění", "progress": "Kampaň se ještě odesílá, {sent} z {total}", "settling": "Čísla se ještě dopočítávají. Většina otevření a kliknutí dorazí během první hodiny.", "mayChange": "Čísla se ještě mohou mírně změnit.", "stopped": "Rozesílka byla zastavena po {sent} z {total} e-mailů. Procenta se počítají z odeslaných, ne z původního publika.", "deletedContacts": "Část kontaktů z téhle kampaně byla smazána. Souhrnná čísla platí, ale u jednotlivých lidí se nedostanete dál.", "liveUnavailable": "Živé aktualizace se nedaří, čísla obnovujeme každých 15 sekund." },
    "states": { "draft": "Report bude dostupný po odeslání kampaně.", "draftAction": "Upravit kampaň", "justSent": "Odesílání právě začalo, první data se objeví během několika sekund.", "trackingOffOpens": "Měření otevření bylo pro tuto kampaň vypnuté", "trackingOffClicks": "Měření prokliků bylo pro tuto kampaň vypnuté", "trackingOffBody": "Sledování bylo pro tuhle kampaň vypnuté, proto tu čísla nejsou.", "error": "Report se nepodařilo načíst.", "retry": "Zkusit znovu", "smallSample": "Malý vzorek, procenta nemusí nic znamenat" },
    "actions": { "resendToUnopened": "Poslat znovu neotevřevším", "resendWarning": "Otevření jsou nepřesná, takže mezi příjemci budou i lidé, kteří e-mail četli. Zvažte jinou formulaci než „nestihli jste".", "duplicate": "Duplikovat kampaň", "download": "Stáhnout report", "segmentFromClicked": "Vytvořit segment z těch, kdo klikli", "segmentFromNotOpened": "Vytvořit segment z těch, kdo neotevřeli", "showUndelivered": "Zobrazit, komu se nedoručilo" },
    "recipients": { "heading": "Příjemci", "filterAll": "Všichni", "filterOpened": "Otevřeli", "filterClicked": "Klikli", "filterNotOpened": "Neotevřeli", "filterNotClicked": "Neklikli", "filterBounced": "Nedoručeno", "filterComplained": "Nahlásili spam", "filterUnsubscribed": "Odhlásili se", "filterMachineOpenOnly": "Jen automatické otevření", "deletedContact": "Smazaný kontakt", "erasedContact": "Údaje byly na žádost smazány", "columnContact": "Kontakt", "columnOpened": "Otevřeno", "columnClicked": "Kliknuto", "machineOpen": "automatické stažení", "empty": "Tomuhle filtru neodpovídá žádný příjemce." }
  },
  "timeline": {
    "heading": "Časová osa",
    "filterAll": "Vše",
    "filterEmail": "E-maily",
    "filterWeb": "Web",
    "filterContact": "Změny kontaktu",
    "filterConsent": "Souhlasy",
    "loadOlder": "Načíst starší",
    "today": "Dnes",
    "yesterday": "Včera",
    "machineOpen": "Automatické stažení poštovním klientem, nemusí znamenat skutečné otevření",
    "sessionGroup": "{pages, plural, one {Návštěva webu, # stránka} few {Návštěva webu, # stránky} many {Návštěva webu, # stránky} other {Návštěva webu, # stránek}}",
    "empty": "U tohoto kontaktu zatím nemáme žádnou aktivitu.",
    "emptyHint": "Až kontaktu pošlete e-mail nebo až navštíví váš web, uvidíte to tady.",
    "emptyFiltered": "V tomhle období se nic nestalo.",
    "emptyFilteredAction": "Zobrazit posledních 90 dní",
    "webNotMeasured": "Chování na webu se neměří.",
    "webNotMeasuredAction": "Nastavit",
    "error": "Historie se nenačetla. Zkuste zúžit období.",
    "item": {
      "messageSent": "{gender, select, female {Dostala kampaň {campaign}} male {Dostal kampaň {campaign}} other {Odeslání kampaně {campaign}}}",
      "messageFailed": "Kampaň {campaign} se nepodařilo odeslat",
      "messageDelivered": "Kampaň {campaign} byla doručena",
      "messageOpened": "{gender, select, female {Otevřela kampaň {campaign}} male {Otevřel kampaň {campaign}} other {Otevření kampaně {campaign}}}",
      "messageClicked": "{gender, select, female {Klikla na {link} v kampani {campaign}} male {Klikl na {link} v kampani {campaign}} other {Kliknutí na {link} v kampani {campaign}}}",
      "messageBounced": "Kampaň {campaign} se vrátila jako nedoručitelná",
      "messageComplained": "{gender, select, female {Označila kampaň {campaign} jako spam} male {Označil kampaň {campaign} jako spam} other {Označení kampaně {campaign} jako spam}}",
      "messageUnsubscribed": "{gender, select, female {Odhlásila se z odběru} male {Odhlásil se z odběru} other {Odhlášení z odběru}}",
      "pageView": "{gender, select, female {Zobrazila stránku {page}} male {Zobrazil stránku {page}} other {Zobrazení stránky {page}}}",
      "sessionStarted": "{gender, select, female {Přišla na web} male {Přišel na web} other {Návštěva webu}}",
      "contactCreated": "{gender, select, female {Byla přidána do kontaktů} male {Byl přidán do kontaktů} other {Vznik kontaktu}}",
      "listSubscribed": "{gender, select, female {Přihlásila se k odběru seznamu {list}} male {Přihlásil se k odběru seznamu {list}} other {Přihlášení k odběru seznamu {list}}}",
      "listUnsubscribed": "{gender, select, female {Odhlásila se ze seznamu {list}} male {Odhlásil se ze seznamu {list}} other {Odhlášení ze seznamu {list}}}",
      "consentGranted": "{gender, select, female {Udělila souhlas} male {Udělil souhlas} other {Udělení souhlasu}}",
      "consentWithdrawn": "{gender, select, female {Odvolala souhlas} male {Odvolal souhlas} other {Odvolání souhlasu}}",
      "generic": "Událost {name}"
    },
    "purpose": { "email_marketing": "marketingová sdělení", "analytics": "měření chování", "personalization": "personalizace", "profiling": "profilování", "third_party": "předání třetí straně" }
  },
  "dashboard": {
    "heading": "Přehled",
    "period7": "7 dní",
    "period30": "30 dní",
    "period90": "90 dní",
    "sent": "Odesláno",
    "clicked": "Kliklo",
    "clickedHint": "Hlavní číslo. Kliknout musí člověk.",
    "opened": "Otevřelo",
    "openedMachine": "z toho {share} automatických",
    "problems": "Problémy",
    "problemsOk": "v pořádku",
    "problemsBad": "vyžaduje pozornost",
    "bounced": "vráceno",
    "complaints": "stížnosti",
    "webActive": "Na webu právě teď",
    "webActiveValue": "{count, plural, =0 {žádný kontakt za 24 h} one {# kontakt za 24 h} few {# kontakty za 24 h} many {# kontaktu za 24 h} other {# kontaktů za 24 h}}",
    "recentCampaigns": "Poslední kampaně",
    "running": "Rozesílka {name}: {sent} z {total}",
    "runningAction": "Zobrazit",
    "computedAt": "spočítáno v {time}",
    "tileError": "Tuhle dlaždici se nepodařilo načíst.",
    "tileRetry": "Zkusit znovu",
    "emptyFirstRun": "Až odešlete první kampaň, uvidíte tady, jak dopadla.",
    "emptyNoCampaigns": "Zatím žádná odeslaná kampaň, proto tu nejsou míry."
  },
  "stats": {
    "campaignsHeading": "Vývoj v čase",
    "campaignsQuestion": "Zlepšuju se, nebo zhoršuju?",
    "seriesDelivered": "Doručeno",
    "seriesClicked": "Kliklo",
    "seriesOpened": "Otevřelo",
    "seriesUnsubscribed": "Odhlásilo se",
    "tableCaption": "Kampaně a jejich míry",
    "columnCampaign": "Kampaň",
    "columnSentAt": "Odesláno",
    "emptyTooFew": "Trend se ukáže od třetí odeslané kampaně.",
    "openWithMachineNote": "U míry otevření je vždy uvedený podíl automatických."
  }
}
```

- [ ] **Krok 4: Napiš `packages/i18n/messages/en/reports.json`**

Stejná struktura klíčů, anglické znění. Klíče se musí shodovat do posledního, hlídá to test z kroku 1 i CI job `i18n-check`.

```json
{
  "chart": {
    "showTable": "Show table of values",
    "hideTable": "Hide table of values"
  },
  "table": {
    "selectRow": "Select row",
    "selectAllOnPage": "Select all on this page",
    "previous": "Previous",
    "next": "Next",
    "showing": "{shown, number} of {total, number}{estimated, select, true { (estimated)} other {}}",
    "selectedOnPage": "{count, plural, one {# selected} other {# selected}}",
    "selectAllMatching": "Select all {total, number} matching",
    "selectedAllMatching": "All {total, number} selected",
    "clearSelection": "Clear selection",
    "cursorInvalid": "That page link is no longer valid, showing the first page of the same filter.",
    "sortNotAvailable": "This column cannot be sorted",
    "sortedAscending": "Sorted ascending",
    "sortedDescending": "Sorted descending",
    "columnSettings": "Column settings",
    "columnVisible": "Show column {column}",
    "columnWidth": "Width of column {column}"
  },
  "report": {
    "title": "Campaign report",
    "clicked": { "label": "Clicked", "denominator": "of delivered", "hint": "Share of delivered messages where somebody clicked a link. The most reliable number in this report." },
    "delivered": { "label": "Delivered", "denominator": "of sent" },
    "unsubscribed": { "label": "Unsubscribed", "denominator": "of delivered" },
    "opens": {
      "heading": "Opens",
      "verified": "verified",
      "machine": "likely machine",
      "uncertain": "uncertain",
      "clickedFromVerified": "{count, plural, =0 {None of the verified opens clicked a link.} one {One verified open also clicked a link.} other {# verified opens also clicked a link.}}",
      "warning": "Some opens are produced by mail apps on their own, without anybody reading the message. The reliable number is clicks.",
      "explainTitle": "Why opens are imprecise",
      "explainBody": "An open is detected when a mail app downloads a small invisible image. Since 2021 Apple Mail and other apps download it up front, on their own, before anybody reads the message. The tool cannot tell the difference.",
      "explainAdvice": "Look at clicks. A click needs a human. Opens are still good for one thing: somebody who opened nothing for a year is almost certainly inactive.",
      "verifiedRate": { "label": "Verified opens", "denominator": "of delivered excluding Apple Mail", "hint": "Calculated only from recipients where measurement works." },
      "toggle": {
        "label": "Subtract likely machine opens",
        "onDescription": "Showing verified opens only. The denominator is delivered without Apple Mail recipients.",
        "offDescription": "Showing all opens including likely machine ones. The number is inflated by that.",
        "badgeOff": "Showing all opens"
      },
      "predicted": { "label": "Estimated real opens", "range": "estimate {low} to {high}", "hint": "This is not a measurement. It is derived from the part of the audience Apple does not distort." }
    },
    "problems": {
      "heading": "Problems",
      "bounced": "Not delivered",
      "complained": "Spam",
      "failed": "Errors",
      "withinNorm": "within norm",
      "high": "high",
      "showWho": "Show who"
    },
    "links": { "heading": "What people clicked", "clicks": "{count, plural, =0 {no clicks} one {# click} other {# clicks}}", "people": "{count, plural, =0 {nobody} one {# person} other {# people}}", "share": "share", "duplicate": "Same address as another link in the e-mail", "showWho": "Show who", "empty": "The campaign had no measured link." },
    "chart": { "heading": "Over time", "granularity5m": "Every 5 minutes", "granularityHour": "Hourly", "granularityDay": "Daily", "tableCaption": "Table of chart values", "compacted": "Data older than 30 days is stored hourly, finer resolution is no longer available.", "columnTime": "Time", "columnSent": "Sent", "columnDelivered": "Delivered", "columnOpens": "Opens", "columnClicks": "Clicks" },
    "diagnostics": { "heading": "Diagnostics", "scannerClicks": "Filtered machine clicks", "scannerClicksHint": "Corporate spam filters visit every link to check it. We do not count those clicks.", "lastEvent": "Last event", "noEvents": "No event has arrived yet.", "deliveredSourceProvider": "Delivery is reported by the sending service.", "deliveredSourceDerived": "The sending service does not report delivery, so it is counted as sent minus rejected." },
    "banner": { "sending": "Sending in progress, numbers keep changing", "progress": "The campaign is still sending, {sent} of {total}", "settling": "Numbers are still settling. Most opens and clicks arrive within the first hour.", "mayChange": "Numbers may still change slightly.", "stopped": "Sending was stopped after {sent} of {total} e-mails. Percentages are calculated from sent, not from the original audience.", "deletedContacts": "Some contacts from this campaign were deleted. Totals still hold, but you cannot drill down to individual people.", "liveUnavailable": "Live updates are failing, we refresh the numbers every 15 seconds." },
    "states": { "draft": "The report becomes available once the campaign is sent.", "draftAction": "Edit campaign", "justSent": "Sending has just started, the first data appears within seconds.", "trackingOffOpens": "Open tracking was disabled for this campaign", "trackingOffClicks": "Click tracking was disabled for this campaign", "trackingOffBody": "Tracking was disabled for this campaign, that is why the numbers are missing.", "error": "The report could not be loaded.", "retry": "Try again", "smallSample": "Small sample, percentages may be misleading" },
    "actions": { "resendToUnopened": "Resend to people who did not open", "resendWarning": "Opens are imprecise, so the audience will include people who did read the e-mail. Consider wording other than „you missed it".", "duplicate": "Duplicate campaign", "download": "Download report", "segmentFromClicked": "Create a segment from people who clicked", "segmentFromNotOpened": "Create a segment from people who did not open", "showUndelivered": "Show who did not receive it" },
    "recipients": { "heading": "Recipients", "filterAll": "Everyone", "filterOpened": "Opened", "filterClicked": "Clicked", "filterNotOpened": "Did not open", "filterNotClicked": "Did not click", "filterBounced": "Not delivered", "filterComplained": "Reported spam", "filterUnsubscribed": "Unsubscribed", "filterMachineOpenOnly": "Machine opens only", "deletedContact": "Deleted contact", "erasedContact": "Data was erased on request", "columnContact": "Contact", "columnOpened": "Opened", "columnClicked": "Clicked", "machineOpen": "automatic download", "empty": "No recipient matches this filter." }
  },
  "timeline": {
    "heading": "Timeline",
    "filterAll": "All",
    "filterEmail": "E-mails",
    "filterWeb": "Web",
    "filterContact": "Contact changes",
    "filterConsent": "Consents",
    "loadOlder": "Load older",
    "today": "Today",
    "yesterday": "Yesterday",
    "machineOpen": "Automatic download by the mail client, may not mean a real open",
    "sessionGroup": "{pages, plural, one {Web visit, # page} other {Web visit, # pages}}",
    "empty": "No activity recorded for this contact yet.",
    "emptyHint": "Once you send an e-mail or the contact visits your site, it shows up here.",
    "emptyFiltered": "Nothing happened in this period.",
    "emptyFilteredAction": "Show the last 90 days",
    "webNotMeasured": "Web behaviour is not measured.",
    "webNotMeasuredAction": "Set up",
    "error": "History failed to load. Try a shorter period.",
    "item": {
      "messageSent": "{gender, select, female {Received campaign {campaign}} male {Received campaign {campaign}} other {Campaign {campaign} was sent}}",
      "messageFailed": "Campaign {campaign} could not be sent",
      "messageDelivered": "Campaign {campaign} was delivered",
      "messageOpened": "{gender, select, female {Opened campaign {campaign}} male {Opened campaign {campaign}} other {Campaign {campaign} was opened}}",
      "messageClicked": "{gender, select, female {Clicked {link} in campaign {campaign}} male {Clicked {link} in campaign {campaign}} other {{link} was clicked in campaign {campaign}}}",
      "messageBounced": "Campaign {campaign} bounced as undeliverable",
      "messageComplained": "{gender, select, female {Marked campaign {campaign} as spam} male {Marked campaign {campaign} as spam} other {Campaign {campaign} was marked as spam}}",
      "messageUnsubscribed": "{gender, select, female {Unsubscribed} male {Unsubscribed} other {Unsubscribed from the list}}",
      "pageView": "{gender, select, female {Viewed page {page}} male {Viewed page {page}} other {Page {page} was viewed}}",
      "sessionStarted": "{gender, select, female {Visited the website} male {Visited the website} other {Website visit}}",
      "contactCreated": "{gender, select, female {Was added to contacts} male {Was added to contacts} other {Contact was created}}",
      "listSubscribed": "{gender, select, female {Subscribed to list {list}} male {Subscribed to list {list}} other {Subscription to list {list}}}",
      "listUnsubscribed": "{gender, select, female {Unsubscribed from list {list}} male {Unsubscribed from list {list}} other {Unsubscribed from list {list}}}",
      "consentGranted": "{gender, select, female {Granted consent} male {Granted consent} other {Consent was granted}}",
      "consentWithdrawn": "{gender, select, female {Withdrew consent} male {Withdrew consent} other {Consent was withdrawn}}",
      "generic": "Event {name}"
    },
    "purpose": { "email_marketing": "marketing messages", "analytics": "behaviour measurement", "personalization": "personalization", "profiling": "profiling", "third_party": "sharing with a third party" }
  },
  "dashboard": {
    "heading": "Overview",
    "period7": "7 days",
    "period30": "30 days",
    "period90": "90 days",
    "sent": "Sent",
    "clicked": "Clicked",
    "clickedHint": "The headline number. A click needs a human.",
    "opened": "Opened",
    "openedMachine": "{share} of which are machine opens",
    "problems": "Problems",
    "problemsOk": "all good",
    "problemsBad": "needs attention",
    "bounced": "bounced",
    "complaints": "complaints",
    "webActive": "On the website right now",
    "webActiveValue": "{count, plural, =0 {no contacts in 24 h} one {# contact in 24 h} other {# contacts in 24 h}}",
    "recentCampaigns": "Recent campaigns",
    "running": "Sending {name}: {sent} of {total}",
    "runningAction": "Open",
    "computedAt": "computed at {time}",
    "tileError": "This tile could not be loaded.",
    "tileRetry": "Try again",
    "emptyFirstRun": "Once you send your first campaign, you will see how it did here.",
    "emptyNoCampaigns": "No campaign sent yet, so there are no rates."
  },
  "stats": {
    "campaignsHeading": "Trend over time",
    "campaignsQuestion": "Am I getting better or worse?",
    "seriesDelivered": "Delivered",
    "seriesClicked": "Clicked",
    "seriesOpened": "Opened",
    "seriesUnsubscribed": "Unsubscribed",
    "tableCaption": "Campaigns and their rates",
    "columnCampaign": "Campaign",
    "columnSentAt": "Sent at",
    "emptyTooFew": "The trend shows up from the third sent campaign.",
    "openWithMachineNote": "The open rate is always shown together with the share of machine opens."
  }
}
```

- [ ] **Krok 5: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/core exec vitest run src/reports/timeline/titles-icu.test.ts && pnpm ci:i18n-check`
Expected: PASS a `i18n-check` bez chyby.

- [ ] **Krok 6: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add packages/i18n/messages/cs/reports.json packages/i18n/messages/en/reports.json packages/core/src/reports/timeline/titles-icu.test.ts && git commit -m "feat(i18n): add reports namespace in Czech and English"
```

---

### Úkol 28: Klient API a tři adaptéry nad komponentami P05

Adaptéry existují proto, že přesný tvar props komponent K1, K7 a K8 vlastní P05. Případný rozdíl se pak opravuje ve třech souborech, ne ve dvaceti.

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/features/reports/api-client.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/features/reports/adapters/report-chart.tsx`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/features/reports/adapters/report-table.tsx`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/features/reports/adapters/report-timeline.tsx`
- Test: `/Users/petr/Projects/Mailing_Tool/apps/web/src/features/reports/api-client.test.ts`

- [ ] **Krok 1: Napiš padající test klienta**

`apps/web/src/features/reports/api-client.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { ReportsApiError, fetchJson } from './api-client.js';

describe('fetchJson', () => {
  it('posílá If-None-Match a 304 hlásí jako beze změny', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 304 }));
    const result = await fetchJson('/api/v1/dashboard', { etag: 'W/"7"', fetchImpl: fetchMock });
    expect(fetchMock.mock.calls[0]?.[1]?.headers).toMatchObject({ 'If-None-Match': 'W/"7"' });
    expect(result).toEqual({ status: 'not_modified' });
  });

  it('vrátí tělo i etag', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ version: 7 }), { status: 200, headers: { ETag: 'W/"7"' } }),
    );
    const result = await fetchJson<{ version: number }>('/api/v1/x', { fetchImpl: fetchMock });
    expect(result).toEqual({ status: 'ok', data: { version: 7 }, etag: 'W/"7"' });
  });

  it('chybu převede na ReportsApiError s kódem a request_id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: 'not_found', request_id: 'req-1' }), {
        status: 404,
        headers: { 'Content-Type': 'application/problem+json' },
      }),
    );
    await expect(fetchJson('/api/v1/x', { fetchImpl: fetchMock })).rejects.toMatchObject({
      code: 'not_found',
      requestId: 'req-1',
      status: 404,
    });
  });

  it('u odpovědi bez těla nevyhodí výjimku při parsování', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('', { status: 500 }));
    await expect(fetchJson('/api/v1/x', { fetchImpl: fetchMock })).rejects.toBeInstanceOf(ReportsApiError);
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/web exec vitest run src/features/reports/api-client.test.ts`
Expected: FAIL, `Cannot find module './api-client.js'`.

- [ ] **Krok 3: Napiš `api-client.ts`**

```ts
export class ReportsApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly requestId: string | null,
    readonly detail: string | null,
  ) {
    super(detail ?? code);
    this.name = 'ReportsApiError';
  }
}

export type FetchResult<T> =
  | { status: 'ok'; data: T; etag: string | null }
  | { status: 'not_modified' };

export type FetchOptions = {
  etag?: string | null;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
};

/**
 * Tenký klient nad veřejným API. Obrazovky reportů nemluví s databází přímo,
 * takže závisí jen na kontraktu, který vlastní P04, ne na jeho vnitřcích.
 */
export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<FetchResult<T>> {
  const doFetch = options.fetchImpl ?? fetch;
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (options.etag) headers['If-None-Match'] = options.etag;

  const response = await doFetch(url, {
    method: 'GET',
    credentials: 'same-origin',
    headers,
    ...(options.signal ? { signal: options.signal } : {}),
  });

  if (response.status === 304) return { status: 'not_modified' };

  if (!response.ok) {
    let code = 'unknown_error';
    let requestId: string | null = null;
    let detail: string | null = null;
    try {
      const problem = (await response.json()) as Record<string, unknown>;
      code = typeof problem.code === 'string' ? problem.code : code;
      requestId = typeof problem.request_id === 'string' ? problem.request_id : null;
      detail = typeof problem.detail === 'string' ? problem.detail : null;
    } catch {
      // Tělo nemuselo být JSON. Kód chyby zůstane obecný, stránka se nerozbije.
    }
    throw new ReportsApiError(response.status, code, requestId, detail);
  }

  return { status: 'ok', data: (await response.json()) as T, etag: response.headers.get('ETag') };
}

export function campaignStatsUrl(campaignId: string): string {
  return `/api/v1/campaigns/${campaignId}/stats`;
}

export function campaignProgressUrl(campaignId: string, granularity: string): string {
  return `/api/v1/campaigns/${campaignId}/stats/timeline?granularity=${granularity}`;
}

export function campaignLinksUrl(campaignId: string): string {
  return `/api/v1/campaigns/${campaignId}/links`;
}

export function recipientsUrl(campaignId: string, filter: string, cursor?: string): string {
  const query = new URLSearchParams({ filter, limit: '50' });
  if (cursor) query.set('cursor', cursor);
  return `/api/v1/campaigns/${campaignId}/recipients?${query.toString()}`;
}

export function timelineUrl(contactId: string, params: { types?: string; cursor?: string }): string {
  const query = new URLSearchParams({ limit: '50' });
  if (params.types) query.set('types', params.types);
  if (params.cursor) query.set('cursor', params.cursor);
  return `/api/v1/contacts/${contactId}/timeline?${query.toString()}`;
}

export function dashboardUrl(period: number): string {
  return `/api/v1/dashboard?period=${period}`;
}
```

- [ ] **Krok 4: Napiš tři adaptéry**

Adaptér **překládá** tvar reportů na tvar P05. Nepředává props dál beze změny a nevymýšlí si jména: props níž jsou opsané z hotových komponent P05 (viz tabulka v úkolu 1, kroku 3).

`apps/web/src/features/reports/adapters/report-chart.tsx`:

```tsx
'use client';

// Podcesta na úroveň adresáře. `patterns/charts/lazy` je vlastní položka
// v `exports` a jediná povolená cesta ke grafům: recharts se do základního
// balíku nesmí dostat (kritérium 82). Import souboru, například
// `patterns/charts/line-chart`, skončí `ERR_PACKAGE_PATH_NOT_EXPORTED`.
import { LineChart } from '@mlain/ui/patterns/charts/lazy';
import type { ChartSeries } from '@mlain/ui/patterns/charts';

/** Tvar, ve kterém reporty data mají: bod v čase a k němu hodnoty všech řad. */
export type ReportSeries = { key: string; label: string };
export type ReportPoint = { at: string; values: Record<string, number> };

export type ReportChartProps = {
  title: string;
  series: ReportSeries[];
  points: ReportPoint[];
  /** Popisky tabulkové alternativy. K7 je vyžaduje, prázdné být nesmějí. */
  labels: { showTable: string; hideTable: string; tableCaption: string; periodColumn: string };
  formatValue?: (value: number) => string;
  formatPeriod?: (iso: string) => string;
};

/** Vzory čar, aby graf zůstal čitelný bez rozlišení barev (tvrdý požadavek K7). */
const PATTERNS = ['solid', 'dashed', 'dotted'] as const;

/**
 * Jediné místo, kde se reportové obrazovky dotýkají komponenty K7 z packages/ui.
 *
 * Překlad je tady schválně: reporty drží data jako „bod a k němu hodnoty",
 * K7 je chce jako „řada a k ní body". Kdyby si každá obrazovka převáděla
 * sama, byl by rozdíl v props P05 změnou na dvaceti místech.
 *
 * Tabulková alternativa, klávesová dostupnost hodnot i osa Y od nuly jsou
 * uvnitř K7, tenhle soubor je nezajišťuje ani nepřepisuje.
 */
export function ReportChart(props: ReportChartProps) {
  const format = props.formatPeriod ?? ((iso: string) => iso);
  const series: ChartSeries[] = props.series.map((item, index) => ({
    id: item.key,
    label: item.label,
    pattern: PATTERNS[index % PATTERNS.length],
    points: props.points.map((point) => ({
      x: format(point.at),
      y: point.values[item.key] ?? 0,
    })),
  }));

  return (
    <LineChart
      title={props.title}
      series={series}
      labels={props.labels}
      formatValue={props.formatValue}
    />
  );
}
```

`apps/web/src/features/reports/adapters/report-table.tsx`:

```tsx
'use client';

import { DataTable, type DataTableColumn, type DataTableLabels } from '@mlain/ui/patterns/data-table';
import type { CountInfo } from '@mlain/ui/patterns/data-table';

export type ReportTableColumn<T> = {
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
};

export type ReportTableProps<T> = {
  tableId: string;
  columns: ReportTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  caption: string;
  labels: DataTableLabels;
  /** Kolik řádků filtr má. Odhad se v K1 označuje, proto `precision`. */
  count: CountInfo;
  hasMore: boolean;
  canGoBack: boolean;
  onNext: () => void;
  onPrevious: () => void;
  /** Kurzor přestal platit: K1 ukáže první stránku a vysvětlení (kritérium 79). */
  cursorInvalid?: boolean;
  emptyState: React.ReactNode;
};

/**
 * Jediné místo, kde se reporty dotýkají komponenty K1.
 *
 * Stránkování je kurzorové a bez čísel stránek, což K1 vyjadřuje čtveřicí
 * `hasMore`, `canGoBack`, `onNext`, `onPrevious`. Řazení se nenabízí vůbec:
 * seznam příjemců má pevné pořadí podle kurzoru (R20) a zašedlá šipka,
 * která nic nedělá, je horší než žádná.
 */
export function ReportTable<T>(props: ReportTableProps<T>) {
  const columns: DataTableColumn<T>[] = props.columns.map((column) => ({
    id: column.key,
    header: column.header,
    cell: column.cell,
  }));

  return (
    <DataTable
      tableId={props.tableId}
      caption={props.caption}
      columns={columns}
      rows={props.rows}
      getRowId={props.rowKey}
      labels={props.labels}
      count={props.count}
      cursorInvalid={props.cursorInvalid ?? false}
      pagination={{
        hasMore: props.hasMore,
        canGoBack: props.canGoBack,
        onNext: props.onNext,
        onPrevious: props.onPrevious,
      }}
      emptyState={props.emptyState}
    />
  );
}
```

`apps/web/src/features/reports/adapters/report-timeline.tsx`:

```tsx
'use client';

import {
  Timeline,
  type TimelineEvent,
  type TimelineGender,
  type TimelineLabels,
} from '@mlain/ui/patterns/timeline';

/**
 * Položka osy tak, jak ji vrací `/api/v1/contacts/{id}/timeline`. Větu skládá
 * server (R17), takže `title` je hotový text a klient ho už jen zobrazí.
 */
export type TimelineEntry = {
  id: string;
  occurredAt: string;
  type: string;
  title: string;
  icon: 'mail' | 'open' | 'click' | 'web' | 'contact' | 'consent' | 'problem' | 'generic';
  reliability?: 'confirmed' | 'machine';
  detail?: Record<string, unknown>;
};

export type ReportTimelineProps = {
  entries: TimelineEntry[];
  /** Rod kontaktu z pole `gender`. Neznámý rod dostane podstatné jméno. */
  gender: TimelineGender;
  /** Zóna uživatele, ne serveru. Oddělovače dnů se počítají v ní. */
  timeZone: string;
  labels: TimelineLabels;
  formatTime: (value: Date) => string;
  formatDate: (value: Date) => string;
  hasMore: boolean;
  onLoadOlder: () => void;
  renderSentence?: (entry: TimelineEntry) => React.ReactNode;
};

/**
 * Jediné místo, kde se reporty dotýkají komponenty K8.
 *
 * Shlukování sérií, oddělovače dnů v zóně uživatele, dávky bez skoku scrollu
 * i kotvy jsou uvnitř K8 a tenhle soubor je neřeší. Překládá jen dvě věci:
 * ISO řetězec z API na `Date`, který K8 očekává, a hotový `title` na uzel,
 * který K8 vykreslí přes `renderSentence`.
 *
 * `renderSentence` bere K8 jako props schválně: věta se skládá jako JEDNA
 * ICU zpráva se `select` nad celou větou, ne z fragmentů. Tady ji jen podáme,
 * protože ji podle R17 složil server.
 */
export function ReportTimeline(props: ReportTimelineProps) {
  const events: TimelineEvent[] = props.entries.map((entry) => ({
    id: entry.id,
    type: entry.type,
    occurredAt: new Date(entry.occurredAt),
    payload: {
      title: entry.title,
      icon: entry.icon,
      ...(entry.reliability ? { reliability: entry.reliability } : {}),
      ...(entry.detail ? { detail: entry.detail } : {}),
    },
  }));

  return (
    <Timeline
      events={events}
      gender={props.gender}
      timeZone={props.timeZone}
      labels={props.labels}
      renderSentence={({ event }) => String(event.payload.title ?? '')}
      formatTime={props.formatTime}
      formatDate={props.formatDate}
      hasMore={props.hasMore}
      onLoadOlder={props.onLoadOlder}
    />
  );
}
```

- [ ] **Krok 4b: Ověř, že adaptéry sedí na skutečné rozhraní P05**

Typová kontrola je tady jediná ochrana, kterou má smysl mít: props komponent P05 jsou typované a rozdíl se pozná při překladu, ne až v prohlížeči.

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/web typecheck && node --input-type=module -e "
const fs = await import('node:fs/promises');
const files = ['report-chart.tsx','report-table.tsx','report-timeline.tsx'];
for (const f of files) {
  const src = await fs.readFile('apps/web/src/features/reports/adapters/' + f, 'utf8');
  const bad = [...src.matchAll(/from '@mlain\/ui\/patterns\/([a-z-]+)\/([a-z-]+)'/g)]
    .filter((m) => m[2] !== 'lazy');
  console.log(f + ': ' + (bad.length ? 'CHYBA, import na úroveň souboru: ' + bad.map((m) => m[0]).join(', ') : 'OK'));
}
"
```
Expected: typová kontrola bez chyby a třikrát `OK`. Import na úroveň souboru neprojde sestavením, protože `exports` v `packages/ui/package.json` cestu k souboru nevystavuje. Jediná výjimka je `patterns/charts/lazy`, což je samostatná položka mapy.

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && grep -rn "@mlain/ui" apps/web/src/features/reports --include=*.tsx | grep -v "src/features/reports/adapters/"
```
Expected: prázdný výstup. Komponenty P05 se dotýkají **jen** tři adaptéry (R4); kdokoliv další si je začne importovat sám a rozdíl v props přestane být opravou na třech místech.

- [ ] **Krok 5: Spusť test a typovou kontrolu**

Run: `pnpm --filter @mlain/web exec vitest run src/features/reports/api-client.test.ts && pnpm --filter @mlain/web typecheck`
Expected: PASS a typová kontrola bez chyby. Když se props komponent P05 liší, oprav **jen tyhle tři adaptéry** a rozdíl zapiš do kapitoly 7.

- [ ] **Krok 6: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add apps/web/src/features/reports && git commit -m "feat(reports): add API client and adapters over shared components"
```

---

### Úkol 29: Živé aktualizace, které přežijí výpadek

Tenhle úkol nese kritéria 93 až 102. Klíčové pravidlo: **žádná obrazovka nesmí být závislá na živém spojení pro základní funkci.**

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/features/reports/live/live-mode.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/features/reports/live/leader.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/features/reports/live/live-stats.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/features/reports/live/use-live-stats.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/apps/web/src/features/reports/live/live-mode.test.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/apps/web/src/features/reports/live/leader.test.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/apps/web/src/features/reports/live/live-stats.test.ts`

- [ ] **Krok 1: Napiš padající testy volby režimu a vůdce**

`apps/web/src/features/reports/live/live-mode.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { chooseLiveMode, pollIntervalMs } from './live-mode.js';

describe('chooseLiveMode', () => {
  it('nad HTTP/2 a HTTP/3 volí SSE', () => {
    expect(chooseLiveMode('h2')).toBe('sse');
    expect(chooseLiveMode('h3')).toBe('sse');
  });

  it('nad HTTP/1.1 volí dotazování (kritérium 94)', () => {
    expect(chooseLiveMode('http/1.1')).toBe('polling');
  });

  it('prázdná nebo neznámá hodnota znamená dotazování, tedy bezpečnou stranu', () => {
    expect(chooseLiveMode('')).toBe('polling');
    expect(chooseLiveMode(undefined)).toBe('polling');
  });
});

describe('pollIntervalMs', () => {
  it('při odesílání se ptá po třech sekundách, jinak po třiceti', () => {
    expect(pollIntervalMs('sending')).toBe(3000);
    expect(pollIntervalMs('sent')).toBe(30_000);
  });

  it('po přechodu na dotazování kvůli selhání SSE je interval patnáct sekund', () => {
    expect(pollIntervalMs('sending', { degraded: true })).toBe(15_000);
  });
});
```

`apps/web/src/features/reports/live/leader.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { FakeChannel, electLeader } from './leader.js';

describe('electLeader', () => {
  it('první karta se stane vůdcem', async () => {
    vi.useFakeTimers();
    const bus = new Map<string, FakeChannel[]>();
    const promise = electLeader('c1', () => new FakeChannel('c1', bus));
    await vi.advanceTimersByTimeAsync(200);
    const result = await promise;
    expect(result.isLeader).toBe(true);
    result.release();
    vi.useRealTimers();
  });

  it('druhá karta vůdcem není a dostává data od vůdce', async () => {
    vi.useFakeTimers();
    const bus = new Map<string, FakeChannel[]>();
    const first = await (async () => {
      const p = electLeader('c1', () => new FakeChannel('c1', bus));
      await vi.advanceTimersByTimeAsync(200);
      return p;
    })();
    const secondPromise = electLeader('c1', () => new FakeChannel('c1', bus));
    await vi.advanceTimersByTimeAsync(200);
    const second = await secondPromise;
    expect(second.isLeader).toBe(false);

    const received: unknown[] = [];
    second.onMessage((data) => received.push(data));
    first.broadcast({ sent: 5 });
    expect(received).toEqual([{ sent: 5 }]);
    first.release();
    second.release();
    vi.useRealTimers();
  });

  it('bez BroadcastChannel se karta chová jako vůdce, jen si otevře vlastní spojení (kritérium 96)', async () => {
    vi.useFakeTimers();
    const promise = electLeader('c1', () => null);
    await vi.advanceTimersByTimeAsync(200);
    const result = await promise;
    expect(result.isLeader).toBe(true);
    result.release();
    vi.useRealTimers();
  });
});
```

- [ ] **Krok 2: Spusť testy a ověř, že padají**

Run: `pnpm --filter @mlain/web exec vitest run src/features/reports/live`
Expected: FAIL, `Cannot find module './live-mode.js'`.

- [ ] **Krok 3: Napiš `live/live-mode.ts`**

```ts
export type LiveMode = 'sse' | 'polling';

/** Multiplexované protokoly, nad kterými limit šesti spojení v prohlížeči neplatí. */
const MULTIPLEXED = new Set(['h2', 'h3']);

/**
 * SSE se použije jen tam, kde je prokazatelně bezpečné. Nad HTTP/1.1 drží
 * prohlížeč nejvýš šest spojení na původ a trvale otevřený stream by je sežral:
 * uživatel se šesti kartami reportu by aplikaci zastavil úplně.
 *
 * Prázdná hodnota se vyhodnocuje jako "ne", tedy bezpečně směrem k dotazování.
 */
export function chooseLiveMode(nextHopProtocol: string | undefined): LiveMode {
  return MULTIPLEXED.has((nextHopProtocol ?? '').toLowerCase()) ? 'sse' : 'polling';
}

export function detectProtocol(): string | undefined {
  if (typeof performance === 'undefined') return undefined;
  const [navigation] = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
  return navigation?.nextHopProtocol;
}

/** Intervaly z 3.13.2 části 5 a z 5.9 části 6. */
export function pollIntervalMs(status: string, options: { degraded?: boolean } = {}): number {
  if (options.degraded) return 15_000;
  return status === 'sending' || status === 'queueing' ? 3000 : 30_000;
}
```

- [ ] **Krok 4: Napiš `live/leader.ts`**

```ts
export type LeaderHandle = {
  isLeader: boolean;
  broadcast: (data: unknown) => void;
  onMessage: (handler: (data: unknown) => void) => void;
  release: () => void;
};

type ChannelLike = {
  postMessage: (data: unknown) => void;
  addEventListener: (type: 'message', handler: (event: { data: unknown }) => void) => void;
  close: () => void;
};

/** Testovací dvojník BroadcastChannel. Sdílená sběrnice je obyčejná mapa. */
export class FakeChannel implements ChannelLike {
  private handlers: Array<(event: { data: unknown }) => void> = [];

  constructor(
    private readonly name: string,
    private readonly bus: Map<string, FakeChannel[]>,
  ) {
    this.bus.set(name, [...(bus.get(name) ?? []), this]);
  }

  postMessage(data: unknown): void {
    for (const peer of this.bus.get(this.name) ?? []) {
      if (peer !== this) for (const handler of peer.handlers) handler({ data });
    }
  }

  addEventListener(_type: 'message', handler: (event: { data: unknown }) => void): void {
    this.handlers.push(handler);
  }

  close(): void {
    this.bus.set(this.name, (this.bus.get(this.name) ?? []).filter((peer) => peer !== this));
  }
}

const CLAIM_WINDOW_MS = 150;

/**
 * Volba vůdce mezi kartami. Spojení drží jedna karta a ostatním výsledek
 * přeposílá, takže deset otevřených karet znamená jedno spojení, ne deset.
 *
 * Když BroadcastChannel není k dispozici, karta se prostě chová jako vůdce
 * a otevře si vlastní spojení. Nic se nerozbije, jen se ušetří míň.
 */
export async function electLeader(
  channelName: string,
  factory: (name: string) => ChannelLike | null = defaultFactory,
): Promise<LeaderHandle> {
  const channel = factory(`mlain-stats-${channelName}`);
  if (!channel) {
    return { isLeader: true, broadcast: () => {}, onMessage: () => {}, release: () => {} };
  }

  const handlers: Array<(data: unknown) => void> = [];
  let leaderSeen = false;

  channel.addEventListener('message', (event) => {
    const payload = event.data as { kind?: string; data?: unknown };
    if (payload?.kind === 'leader') leaderSeen = true;
    if (payload?.kind === 'data') for (const handler of handlers) handler(payload.data);
  });

  channel.postMessage({ kind: 'claim' });
  await new Promise((resolve) => setTimeout(resolve, CLAIM_WINDOW_MS));

  const isLeader = !leaderSeen;
  if (isLeader) channel.postMessage({ kind: 'leader' });

  return {
    isLeader,
    broadcast: (data) => channel.postMessage({ kind: 'data', data }),
    onMessage: (handler) => handlers.push(handler),
    release: () => channel.close(),
  };
}

function defaultFactory(name: string): ChannelLike | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  return new BroadcastChannel(name) as unknown as ChannelLike;
}
```

- [ ] **Krok 5: Napiš padající test stavového automatu**

`apps/web/src/features/reports/live/live-stats.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { LiveStatsMachine } from './live-stats.js';

function machine(overrides: Partial<ConstructorParameters<typeof LiveStatsMachine>[0]> = {}) {
  return new LiveStatsMachine({
    mode: 'sse',
    fetchSnapshot: vi.fn().mockResolvedValue({ status: 'ok', data: { version: 1, status: 'sending' }, etag: 'W/"1"' }),
    openStream: vi.fn(),
    ...overrides,
  });
}

describe('LiveStatsMachine', () => {
  it('po třech neúspěších SSE přejde trvale na dotazování (kritérium 101)', () => {
    const m = machine();
    m.onStreamError();
    m.onStreamError();
    expect(m.state.mode).toBe('sse');
    m.onStreamError();
    expect(m.state.mode).toBe('polling');
    expect(m.state.degraded).toBe(true);
    m.onStreamError();
    expect(m.state.attempts).toBe(3);
  });

  it('indikátor spojení hlásí obnovování, ne chybu', () => {
    const m = machine();
    m.onStreamError();
    expect(m.state.connection).toBe('reconnecting');
    m.onStreamError();
    m.onStreamError();
    expect(m.state.connection).toBe('connected');
  });

  it('v režimu dotazování se odpověď 304 nepovažuje za změnu', async () => {
    const fetchSnapshot = vi
      .fn()
      .mockResolvedValueOnce({ status: 'ok', data: { version: 1, status: 'sending' }, etag: 'W/"1"' })
      .mockResolvedValueOnce({ status: 'not_modified' });
    const m = machine({ mode: 'polling', fetchSnapshot });
    const seen: unknown[] = [];
    m.subscribe((snapshot) => seen.push(snapshot));
    await m.pollOnce();
    await m.pollOnce();
    expect(seen).toHaveLength(1);
    expect(fetchSnapshot.mock.calls[1]?.[0]).toBe('W/"1"');
  });

  it('selhání dotazu obrazovku nezabije, jen označí data za zastaralá (kritérium 102)', async () => {
    const fetchSnapshot = vi.fn().mockRejectedValue(new Error('offline'));
    const m = machine({ mode: 'polling', fetchSnapshot });
    await m.pollOnce();
    expect(m.state.connection).toBe('disconnected');
    expect(m.state.lastError).toBe(true);
  });

  it('ruční obnovení funguje i po selhání živých aktualizací', async () => {
    const fetchSnapshot = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ status: 'ok', data: { version: 2, status: 'sent' }, etag: 'W/"2"' });
    const m = machine({ mode: 'polling', fetchSnapshot });
    const seen: unknown[] = [];
    m.subscribe((snapshot) => seen.push(snapshot));
    await m.pollOnce();
    await m.pollOnce();
    expect(seen).toEqual([{ version: 2, status: 'sent' }]);
    expect(m.state.connection).toBe('connected');
  });
});
```

- [ ] **Krok 6: Napiš `live/live-stats.ts` a `live/use-live-stats.ts`**

`live-stats.ts`:

```ts
import type { FetchResult } from '../api-client.js';
import type { LiveMode } from './live-mode.js';

export type LiveSnapshot = { version: number; status: string } & Record<string, unknown>;

export type LiveState = {
  mode: LiveMode;
  attempts: number;
  degraded: boolean;
  connection: 'connected' | 'reconnecting' | 'disconnected';
  lastError: boolean;
};

export type MachineOptions = {
  mode: LiveMode;
  fetchSnapshot: (etag: string | null) => Promise<FetchResult<LiveSnapshot>>;
  openStream?: () => void;
};

/** Po třech neúspěších se na SSE do konce života stránky rezignuje. */
const MAX_STREAM_ATTEMPTS = 3;

/**
 * Stavový automat živých aktualizací. Je schválně mimo React, aby se dal
 * otestovat bez prohlížeče a bez jsdom.
 *
 * Pravidlo, které řídí celý návrh: obrazovka nesmí být závislá na spojení.
 * Když selže SSE i dotazování, čísla z prvního načtení zůstanou na obrazovce
 * a uživatel má tlačítko Obnovit.
 */
export class LiveStatsMachine {
  private subscribers: Array<(snapshot: LiveSnapshot) => void> = [];
  private etag: string | null = null;

  state: LiveState;

  constructor(private readonly options: MachineOptions) {
    this.state = {
      mode: options.mode,
      attempts: 0,
      degraded: false,
      connection: 'connected',
      lastError: false,
    };
  }

  subscribe(handler: (snapshot: LiveSnapshot) => void): () => void {
    this.subscribers.push(handler);
    return () => {
      this.subscribers = this.subscribers.filter((item) => item !== handler);
    };
  }

  onStreamError(): void {
    if (this.state.mode !== 'sse') return;
    this.state.attempts += 1;
    if (this.state.attempts >= MAX_STREAM_ATTEMPTS) {
      this.state.mode = 'polling';
      this.state.degraded = true;
      this.state.connection = 'connected';
      return;
    }
    this.state.connection = 'reconnecting';
  }

  onStreamMessage(snapshot: LiveSnapshot): void {
    this.state.connection = 'connected';
    this.state.lastError = false;
    this.emit(snapshot);
  }

  async pollOnce(): Promise<void> {
    try {
      const result = await this.options.fetchSnapshot(this.etag);
      this.state.connection = 'connected';
      this.state.lastError = false;
      if (result.status === 'not_modified') return;
      this.etag = result.etag;
      this.emit(result.data);
    } catch {
      this.state.connection = 'disconnected';
      this.state.lastError = true;
    }
  }

  private emit(snapshot: LiveSnapshot): void {
    for (const handler of this.subscribers) handler(snapshot);
  }
}
```

`use-live-stats.ts`:

```ts
'use client';

import { useEffect, useRef, useState } from 'react';
import { campaignStatsUrl, fetchJson } from '../api-client.js';
import { electLeader } from './leader.js';
import { chooseLiveMode, detectProtocol, pollIntervalMs } from './live-mode.js';
import { LiveStatsMachine, type LiveSnapshot, type LiveState } from './live-stats.js';

export type UseLiveStats = {
  snapshot: LiveSnapshot | null;
  state: LiveState;
  refresh: () => void;
};

/**
 * Živé aktualizace se používají výhradně na reportu kampaně ve stavu odesílání.
 * Nikdy na přehledu, nikdy na seznamech. Bez tohohle omezení by i dotazování
 * zbytečně zatěžovalo server.
 */
export function useLiveStats(campaignId: string, initial: LiveSnapshot | null): UseLiveStats {
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(initial);
  const [state, setState] = useState<LiveState>({
    mode: 'polling',
    attempts: 0,
    degraded: false,
    connection: 'connected',
    lastError: false,
  });
  const machineRef = useRef<LiveStatsMachine | null>(null);

  useEffect(() => {
    let disposed = false;
    const machine = new LiveStatsMachine({
      mode: chooseLiveMode(detectProtocol()),
      fetchSnapshot: (etag) => fetchJson<LiveSnapshot>(campaignStatsUrl(campaignId), { etag }),
    });
    machineRef.current = machine;
    const unsubscribe = machine.subscribe((next) => {
      if (disposed) return;
      setSnapshot(next);
      setState({ ...machine.state });
    });

    let source: EventSource | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const loop = async () => {
      if (disposed) return;
      if (document.visibilityState === 'hidden') {
        timer = setTimeout(loop, 5000);
        return;
      }
      await machine.pollOnce();
      setState({ ...machine.state });
      const interval = pollIntervalMs(String(snapshot?.status ?? 'sent'), { degraded: machine.state.degraded });
      timer = setTimeout(loop, interval);
    };

    void (async () => {
      const leader = await electLeader(campaignId);
      if (disposed) return;

      if (!leader.isLeader) {
        // Následovník nedrží spojení. Data mu přeposílá vůdce.
        leader.onMessage((data) => setSnapshot(data as LiveSnapshot));
        return;
      }

      if (machine.state.mode === 'sse') {
        source = new EventSource(`/api/v1/campaigns/${campaignId}/stream`, { withCredentials: true });
        source.addEventListener('stats', (event) => {
          const data = JSON.parse((event as MessageEvent<string>).data) as LiveSnapshot;
          machine.onStreamMessage(data);
          leader.broadcast(data);
          setState({ ...machine.state });
        });
        source.addEventListener('error', () => {
          machine.onStreamError();
          setState({ ...machine.state });
          if (machine.state.mode === 'polling') {
            source?.close();
            source = null;
            void loop();
          }
        });
        return;
      }

      void loop();
    })();

    return () => {
      disposed = true;
      unsubscribe();
      source?.close();
      if (timer) clearTimeout(timer);
    };
  }, [campaignId]);

  return {
    snapshot,
    state,
    refresh: () => {
      void machineRef.current?.pollOnce().then(() => {
        if (machineRef.current) setState({ ...machineRef.current.state });
      });
    },
  };
}
```

- [ ] **Krok 7: Spusť testy a ověř, že procházejí**

Run: `pnpm --filter @mlain/web exec vitest run src/features/reports/live`
Expected: PASS, `Tests  13 passed (13)`.

- [ ] **Krok 8: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add apps/web/src/features/reports/live && git commit -m "feat(reports): live updates with SSE, polling fallback and leader election"
```

---

### Úkol 30: Model reportu: pruhy, dlaždice a přepínač otevření

Prezentační rozhodnutí patří do čistých funkcí, ne do komponent. Jde je pak otestovat bez prohlížeče a stejný model použije report, přehled i export.

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/features/reports/report/report-banner.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/features/reports/report/report-model.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/apps/web/src/features/reports/report/report-model.test.ts`

- [ ] **Krok 1: Napiš padající test**

`apps/web/src/features/reports/report/report-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { reportBanner } from './report-banner.js';
import { headlineTiles, opensView, type StatsPayload } from './report-model.js';

const payload: StatsPayload = {
  campaign_id: 'c1',
  name: 'Letní výprodej',
  subject: 'Sleva 30 %',
  status: 'sent',
  track_opens: true,
  track_clicks: true,
  delivered_source: 'provider_events',
  counts: {
    materialized: 1153, sent: 1153, skipped: 0, failed: 0,
    delivered: 1141, delivered_effective: 1141,
    bounced_hard: 8, bounced_soft: 4, complained: 1, unsubscribed: 4,
    opens_total: 1200, opens_unique: 832, opens_unique_human: 387, opens_unique_apple: 411,
    clicks_total: 210, clicks_unique: 190, clicks_unique_human: 187, clicks_scanner: 20,
  },
  rates: {
    open_rate: 0.729, machine_open_share: 0.494, verified_open_rate: 0.53,
    click_rate: 0.164, click_to_open_rate: 0.483,
    bounce_rate: 0.0104, complaint_rate: 0.00088, unsubscribe_rate: 0.0035,
  },
  open_breakdown: { verified: 387, machine: 411, uncertain: 34, total: 832, clicked_from_verified: 187 },
  predicted_opens: { low_count: 560, high_count: 640, sample_size: 730 },
  small_sample: false,
  audience_built_at: '2026-07-31T14:38:00.000Z',
  started_at: '2026-07-31T14:38:00.000Z',
  finished_at: '2026-07-31T14:52:00.000Z',
  first_event_at: '2026-07-31T14:39:00.000Z',
  last_event_at: '2026-07-31T18:02:00.000Z',
  version: 42,
  updated_at: '2026-07-31T18:02:00.000Z',
};

describe('headlineTiles', () => {
  it('má tři dlaždice a proklik je první a největší', () => {
    const tiles = headlineTiles(payload);
    expect(tiles.map((t) => t.key)).toEqual(['clicked', 'delivered', 'unsubscribed']);
    expect(tiles[0]?.size).toBe('primary');
    expect(tiles[1]?.size).toBe('secondary');
  });

  it('u každé dlaždice uvádí jmenovatel (kritérium 59)', () => {
    for (const tile of headlineTiles(payload)) {
      expect(tile.denominatorKey.length).toBeGreaterThan(0);
    }
  });

  it('míra otevření mezi hlavními dlaždicemi není (kritérium 57)', () => {
    expect(headlineTiles(payload).some((t) => t.key.includes('open'))).toBe(false);
  });
});

describe('opensView', () => {
  it('ve výchozím stavu odečítá automatická otevření a řekne to', () => {
    const view = opensView(payload, 'verified');
    expect(view.headlineCount).toBe(387);
    expect(view.rate).toBe(0.53);
    expect(view.denominatorKey).toBe('report.opens.verifiedRate.denominator');
    expect(view.badgeKey).toBeNull();
  });

  it('po přepnutí ukazuje všechna otevření a nese viditelný odznak', () => {
    const view = opensView(payload, 'all');
    expect(view.headlineCount).toBe(832);
    expect(view.rate).toBe(0.729);
    expect(view.badgeKey).toBe('report.opens.toggle.badgeOff');
  });

  it('pruh má tři skupiny a součet podílů je jedna', () => {
    const view = opensView(payload, 'verified');
    expect(view.segments.map((s) => s.key)).toEqual(['verified', 'machine', 'uncertain']);
    expect(view.segments.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1, 10);
  });

  it('u vypnutého měření vrací vysvětlení, ne nulu (kritérium 60)', () => {
    const off = opensView({ ...payload, track_opens: false }, 'verified');
    expect(off.disabled).toBe(true);
    expect(off.headlineCount).toBeNull();
  });

  it('prediktivní otevření podává jako rozsah označený jako odhad', () => {
    const view = opensView(payload, 'verified');
    expect(view.predicted).toEqual({ low: 560, high: 640 });
  });
});

describe('reportBanner', () => {
  it('u odesílané kampaně hlásí průběh', () => {
    const banner = reportBanner({ ...payload, status: 'sending', counts: { ...payload.counts, sent: 428, materialized: 1129 } }, new Date('2026-07-31T14:40:00.000Z'));
    expect(banner?.key).toBe('report.banner.progress');
    expect(banner?.values).toMatchObject({ sent: 428, total: 1129 });
  });

  it('do patnácti minut po odeslání upozorní, že se čísla dopočítávají', () => {
    const banner = reportBanner(payload, new Date('2026-07-31T14:59:00.000Z'));
    expect(banner?.key).toBe('report.banner.settling');
  });

  it('po 72 hodinách je report konečný a pruh zmizí', () => {
    expect(reportBanner(payload, new Date('2026-08-04T00:00:00.000Z'))).toBeNull();
  });

  it('u zastavené kampaně vysvětlí, z čeho se počítají procenta', () => {
    const banner = reportBanner({ ...payload, status: 'cancelled' }, new Date('2026-08-04T00:00:00.000Z'));
    expect(banner?.key).toBe('report.banner.stopped');
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/web exec vitest run src/features/reports/report/report-model.test.ts`
Expected: FAIL, `Cannot find module './report-banner.js'`.

- [ ] **Krok 3: Napiš `report/report-model.ts`**

```ts
export type StatsPayload = {
  campaign_id: string;
  name: string;
  subject: string;
  status: string;
  track_opens: boolean;
  track_clicks: boolean;
  delivered_source: 'provider_events' | 'derived_from_sent';
  counts: Record<string, number>;
  rates: Record<string, number | null>;
  open_breakdown: { verified: number; machine: number; uncertain: number; total: number; clicked_from_verified: number };
  predicted_opens: { low_count: number; high_count: number; sample_size: number } | null;
  small_sample: boolean;
  audience_built_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  first_event_at: string | null;
  last_event_at: string | null;
  version: number;
  updated_at: string;
};

export type HeadlineTile = {
  key: 'clicked' | 'delivered' | 'unsubscribed';
  size: 'primary' | 'secondary';
  count: number;
  rate: number | null;
  labelKey: string;
  denominatorKey: string;
  hintKey: string | null;
  disabled: boolean;
};

/**
 * Tři hlavní dlaždice podle 8.7.2 části 6, s prokliky na první pozici a největší.
 * Míra otevření mezi nimi schválně není: je o patro níž ve vlastním panelu.
 */
export function headlineTiles(payload: StatsPayload): HeadlineTile[] {
  return [
    {
      key: 'clicked',
      size: 'primary',
      count: payload.counts.clicks_unique_human ?? 0,
      rate: payload.rates.click_rate ?? null,
      labelKey: 'report.clicked.label',
      denominatorKey: 'report.clicked.denominator',
      hintKey: 'report.clicked.hint',
      disabled: !payload.track_clicks,
    },
    {
      key: 'delivered',
      size: 'secondary',
      count: payload.counts.delivered_effective ?? 0,
      rate: safeRatio(payload.counts.delivered_effective, payload.counts.sent),
      labelKey: 'report.delivered.label',
      denominatorKey: 'report.delivered.denominator',
      hintKey: null,
      disabled: false,
    },
    {
      key: 'unsubscribed',
      size: 'secondary',
      count: payload.counts.unsubscribed ?? 0,
      rate: payload.rates.unsubscribe_rate ?? null,
      labelKey: 'report.unsubscribed.label',
      denominatorKey: 'report.unsubscribed.denominator',
      hintKey: null,
      disabled: false,
    },
  ];
}

export type OpensMode = 'verified' | 'all';

export type OpensView = {
  disabled: boolean;
  mode: OpensMode;
  headlineCount: number | null;
  rate: number | null;
  denominatorKey: string;
  badgeKey: string | null;
  segments: Array<{ key: 'verified' | 'machine' | 'uncertain'; count: number; share: number }>;
  clickedFromVerified: number;
  predicted: { low: number; high: number } | null;
};

/**
 * Přepínač automatických otevření. Výchozí poloha je ta poctivější, tedy
 * s odečtenými automatickými otevřeními; rozhodl to zadavatel. Druhá poloha
 * musí být v reportu viditelně označená, aby si za měsíc nikdo nemyslel,
 * že se dívá na totéž číslo.
 */
export function opensView(payload: StatsPayload, mode: OpensMode): OpensView {
  const breakdown = payload.open_breakdown;
  const sum = breakdown.verified + breakdown.machine + breakdown.uncertain;
  const share = (value: number) => (sum > 0 ? value / sum : 0);

  if (!payload.track_opens) {
    return {
      disabled: true,
      mode,
      headlineCount: null,
      rate: null,
      denominatorKey: 'report.states.trackingOffOpens',
      badgeKey: null,
      segments: [],
      clickedFromVerified: 0,
      predicted: null,
    };
  }

  return {
    disabled: false,
    mode,
    headlineCount: mode === 'verified' ? breakdown.verified : breakdown.total,
    rate: mode === 'verified' ? (payload.rates.verified_open_rate ?? null) : (payload.rates.open_rate ?? null),
    denominatorKey:
      mode === 'verified' ? 'report.opens.verifiedRate.denominator' : 'report.delivered.denominator',
    badgeKey: mode === 'all' ? 'report.opens.toggle.badgeOff' : null,
    segments: [
      { key: 'verified', count: breakdown.verified, share: share(breakdown.verified) },
      { key: 'machine', count: breakdown.machine, share: share(breakdown.machine) },
      { key: 'uncertain', count: breakdown.uncertain, share: share(breakdown.uncertain) },
    ],
    clickedFromVerified: breakdown.clicked_from_verified,
    predicted: payload.predicted_opens
      ? { low: payload.predicted_opens.low_count, high: payload.predicted_opens.high_count }
      : null,
  };
}

function safeRatio(numerator: number | undefined, denominator: number | undefined): number | null {
  if (!denominator || denominator <= 0) return null;
  return (numerator ?? 0) / denominator;
}
```

- [ ] **Krok 4: Napiš `report/report-banner.ts`**

```ts
import type { StatsPayload } from './report-model.js';

export type ReportBanner = {
  key: string;
  tone: 'info' | 'warning';
  values: Record<string, string | number>;
};

const SETTLING_MS = 15 * 60 * 1000;
const FINAL_AFTER_MS = 72 * 60 * 60 * 1000;

/**
 * Pruh nad reportem podle 8.7.4 části 6. Pořadí podmínek je pořadí priorit:
 * běžící odesílání je důležitější než "čísla se dopočítávají".
 */
export function reportBanner(payload: StatsPayload, now: Date): ReportBanner | null {
  if (payload.status === 'sending' || payload.status === 'queueing') {
    return {
      key: 'report.banner.progress',
      tone: 'info',
      values: { sent: payload.counts.sent ?? 0, total: payload.counts.materialized ?? 0 },
    };
  }

  if (payload.status === 'cancelled' || payload.status === 'partially_sent') {
    return {
      key: 'report.banner.stopped',
      tone: 'warning',
      values: { sent: payload.counts.sent ?? 0, total: payload.counts.materialized ?? 0 },
    };
  }

  const startedAt = payload.started_at ? new Date(payload.started_at).getTime() : null;
  if (startedAt === null) return null;
  const age = now.getTime() - startedAt;

  if (age < SETTLING_MS) return { key: 'report.banner.settling', tone: 'info', values: {} };
  if (age < FINAL_AFTER_MS) return { key: 'report.banner.mayChange', tone: 'info', values: {} };
  return null;
}
```

- [ ] **Krok 5: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/web exec vitest run src/features/reports/report/report-model.test.ts`
Expected: PASS, `Tests  12 passed (12)`.

- [ ] **Krok 6: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add apps/web/src/features/reports/report && git commit -m "feat(reports): model report tiles, opens toggle and banners"
```

---

### Úkol 31: Obrazovka reportu kampaně

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/app/[locale]/w/[workspaceSlug]/campaigns/[campaignId]/report/page.tsx`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/features/reports/report/campaign-report.tsx`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/features/reports/report/headline-tiles.tsx`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/features/reports/report/opens-panel.tsx`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/features/reports/report/problems-panel.tsx`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/features/reports/report/links-table.tsx`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/features/reports/report/progress-chart.tsx`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/features/reports/report/diagnostics-panel.tsx`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/features/reports/report/follow-up-actions.tsx`

- [ ] **Krok 1: Napiš serverovou stránku**

`.../campaigns/[campaignId]/report/page.tsx`:

```tsx
import { CampaignReport } from '@/features/reports/report/campaign-report';

export default async function CampaignReportPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string; campaignId: string }>;
}) {
  const { workspaceSlug, campaignId } = await params;
  return <CampaignReport workspaceSlug={workspaceSlug} campaignId={campaignId} />;
}
```

- [ ] **Krok 2: Napiš dlaždice a panel otevření**

`report/headline-tiles.tsx`:

```tsx
'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { headlineTiles, type StatsPayload } from './report-model';

export function HeadlineTiles({ payload }: { payload: StatsPayload }) {
  const t = useTranslations('reports');
  const format = useFormatter();
  const tiles = headlineTiles(payload);

  return (
    <div className="grid gap-4 sm:grid-cols-3">
      {tiles.map((tile) => (
        <section
          key={tile.key}
          aria-labelledby={`tile-${tile.key}`}
          className={
            tile.size === 'primary'
              ? 'rounded-lg border border-border bg-card p-6'
              : 'rounded-lg border border-border bg-card p-4'
          }
        >
          <h3 id={`tile-${tile.key}`} className="text-sm text-muted-foreground">
            {t(tile.labelKey)}
          </h3>
          <p className={tile.size === 'primary' ? 'text-5xl font-semibold' : 'text-3xl font-semibold'}>
            {format.number(tile.count)}
          </p>
          {tile.rate === null ? (
            <p className="text-sm text-muted-foreground">{'–'}</p>
          ) : (
            <p className="text-sm">
              {format.number(tile.rate, { style: 'percent', maximumFractionDigits: 1 })}
            </p>
          )}
          <p className="text-xs text-muted-foreground">{t(tile.denominatorKey)}</p>
          {tile.hintKey === null ? null : (
            <p className="mt-2 text-xs text-muted-foreground">{t(tile.hintKey)}</p>
          )}
        </section>
      ))}
    </div>
  );
}
```

`report/opens-panel.tsx`:

```tsx
'use client';

import { useFormatter, useTranslations } from 'next-intl';
import { opensView, type OpensMode, type StatsPayload } from './report-model';

export function OpensPanel({
  payload,
  mode,
  onModeChange,
}: {
  payload: StatsPayload;
  mode: OpensMode;
  onModeChange: (mode: OpensMode) => void;
}) {
  const t = useTranslations('reports');
  const format = useFormatter();
  const view = opensView(payload, mode);

  if (view.disabled) {
    return (
      <section aria-labelledby="opens-heading" className="rounded-lg border border-border p-4">
        <h2 id="opens-heading">{t('report.opens.heading')}</h2>
        <p>{t('report.states.trackingOffOpens')}</p>
        <p className="text-sm text-muted-foreground">{t('report.states.trackingOffBody')}</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="opens-heading" className="rounded-lg border border-border p-4">
      <h2 id="opens-heading">{t('report.opens.heading')}</h2>

      <p className="text-3xl font-semibold">
        {format.number(view.headlineCount ?? 0)}
        {view.rate === null ? null : (
          <span className="ml-2 text-base">
            {format.number(view.rate, { style: 'percent', maximumFractionDigits: 1 })}
          </span>
        )}
      </p>
      <p className="text-xs text-muted-foreground">{t(view.denominatorKey)}</p>
      {view.badgeKey === null ? null : (
        <p className="mt-1 inline-block rounded bg-amber-100 px-2 py-1 text-xs text-amber-900">
          {t(view.badgeKey)}
        </p>
      )}

      {/* Pruh tří skupin. Skupiny se liší i vzorem a popiskem, ne jen barvou. */}
      <div className="mt-3 flex h-4 overflow-hidden rounded" role="img" aria-label={t('report.opens.heading')}>
        {view.segments.map((segment) => (
          <div
            key={segment.key}
            style={{ width: `${Math.round(segment.share * 100)}%` }}
            className={
              segment.key === 'verified'
                ? 'bg-emerald-600'
                : segment.key === 'machine'
                  ? 'bg-slate-400 bg-[repeating-linear-gradient(45deg,transparent,transparent_4px,rgba(255,255,255,.5)_4px,rgba(255,255,255,.5)_8px)]'
                  : 'bg-slate-200'
            }
          />
        ))}
      </div>
      <ul className="mt-2 flex flex-wrap gap-4 text-sm">
        {view.segments.map((segment) => (
          <li key={segment.key}>
            {format.number(segment.count)} {t(`report.opens.${segment.key}`)}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-sm">
        {t('report.opens.clickedFromVerified', { count: view.clickedFromVerified })}
      </p>

      <p className="mt-2 text-sm text-amber-900">{t('report.opens.warning')}</p>

      <label className="mt-3 flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={mode === 'verified'}
          onChange={(event) => onModeChange(event.target.checked ? 'verified' : 'all')}
        />
        {t('report.opens.toggle.label')}
      </label>
      <p className="text-xs text-muted-foreground">
        {mode === 'verified'
          ? t('report.opens.toggle.onDescription')
          : t('report.opens.toggle.offDescription')}
      </p>

      {view.predicted === null ? null : (
        <p className="mt-3 text-sm italic text-muted-foreground">
          {t('report.opens.predicted.label')}:{' '}
          {t('report.opens.predicted.range', {
            low: format.number(view.predicted.low),
            high: format.number(view.predicted.high),
          })}
          <span className="ml-1">{t('report.opens.predicted.hint')}</span>
        </p>
      )}

      <details className="mt-3">
        <summary>{t('report.opens.explainTitle')}</summary>
        <p>{t('report.opens.explainBody')}</p>
        <p>{t('report.opens.explainAdvice')}</p>
      </details>
    </section>
  );
}
```

- [ ] **Krok 3: Napiš panely problémů, odkazů, grafu a diagnostiky**

`report/problems-panel.tsx`:

```tsx
'use client';

import { useFormatter, useTranslations } from 'next-intl';
import type { StatsPayload } from './report-model';

const BOUNCE_WARN = 0.04;
const COMPLAINT_WARN = 0.001;

export function ProblemsPanel({ payload, onShowWho }: { payload: StatsPayload; onShowWho: (filter: string) => void }) {
  const t = useTranslations('reports');
  const format = useFormatter();

  const rows = [
    {
      key: 'bounced',
      filter: 'bounced',
      count: (payload.counts.bounced_hard ?? 0) + (payload.counts.bounced_soft ?? 0),
      rate: payload.rates.bounce_rate ?? null,
      warn: (payload.rates.bounce_rate ?? 0) > BOUNCE_WARN,
    },
    {
      key: 'complained',
      filter: 'complained',
      count: payload.counts.complained ?? 0,
      rate: payload.rates.complaint_rate ?? null,
      warn: (payload.rates.complaint_rate ?? 0) > COMPLAINT_WARN,
    },
    { key: 'failed', filter: 'bounced', count: payload.counts.failed ?? 0, rate: null, warn: false },
  ];

  return (
    <section aria-labelledby="problems-heading" className="rounded-lg border border-border p-4">
      <h2 id="problems-heading">{t('report.problems.heading')}</h2>
      <table className="w-full text-sm">
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row" className="text-left font-normal">{t(`report.problems.${row.key}`)}</th>
              <td>{format.number(row.count)}</td>
              <td>
                {row.rate === null
                  ? '–'
                  : format.number(row.rate, { style: 'percent', maximumFractionDigits: 2 })}
              </td>
              <td>{row.warn ? t('report.problems.high') : t('report.problems.withinNorm')}</td>
              <td>
                <button type="button" onClick={() => onShowWho(row.filter)}>
                  {t('report.problems.showWho')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

`report/links-table.tsx`:

```tsx
'use client';

import { useFormatter, useTranslations } from 'next-intl';

export type LinkRow = {
  link_id: string;
  url: string;
  label: string | null;
  clicks_total: number;
  clicks_unique: number;
  clicks_human: number;
  share: number;
  duplicate_url: boolean;
};

export function LinksTable({ links, disabled }: { links: LinkRow[]; disabled: boolean }) {
  const t = useTranslations('reports');
  const format = useFormatter();

  if (disabled) {
    return (
      <section aria-labelledby="links-heading" className="rounded-lg border border-border p-4">
        <h2 id="links-heading">{t('report.links.heading')}</h2>
        <p>{t('report.states.trackingOffClicks')}</p>
      </section>
    );
  }

  return (
    <section aria-labelledby="links-heading" className="rounded-lg border border-border p-4">
      <h2 id="links-heading">{t('report.links.heading')}</h2>
      {links.length === 0 ? (
        <p>{t('report.links.empty')}</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr>
              <th scope="col" className="text-left">{t('report.links.heading')}</th>
              <th scope="col">{t('report.links.clicks', { count: 0 })}</th>
              <th scope="col">{t('report.links.people', { count: 0 })}</th>
              <th scope="col">{t('report.links.share')}</th>
            </tr>
          </thead>
          <tbody>
            {links.map((link) => (
              <tr key={link.link_id}>
                <th scope="row" className="text-left font-normal">
                  {link.label ?? link.url}
                  {link.duplicate_url ? (
                    <span className="ml-1 text-xs text-muted-foreground">{t('report.links.duplicate')}</span>
                  ) : null}
                </th>
                <td>{t('report.links.clicks', { count: link.clicks_human })}</td>
                <td>{t('report.links.people', { count: link.clicks_unique })}</td>
                <td>{format.number(link.share, { style: 'percent', maximumFractionDigits: 1 })}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
```

`report/progress-chart.tsx`:

```tsx
'use client';

import dynamic from 'next/dynamic';
import { useFormatter, useTranslations } from 'next-intl';

/**
 * Graf není součástí základního balíku, viz kritérium 82 části 6.
 *
 * Líné hranice jsou dvě a obě mají důvod: `@mlain/ui/patterns/charts/lazy`
 * drží mimo balík `recharts`, tenhle `dynamic` drží mimo balík i adaptér.
 */
const ReportChart = dynamic(() => import('../adapters/report-chart').then((m) => m.ReportChart), {
  ssr: false,
});

export type ProgressPoint = {
  at: string;
  sent: number;
  delivered: number;
  opens_unique: number;
  clicks_unique: number;
};

export function ProgressChart({
  points,
  granularity,
  onGranularityChange,
  compacted,
}: {
  points: ProgressPoint[];
  granularity: '5m' | 'hour' | 'day';
  onGranularityChange: (value: '5m' | 'hour' | 'day') => void;
  compacted: boolean;
}) {
  const t = useTranslations('reports');
  const format = useFormatter();

  return (
    <section aria-labelledby="chart-heading" className="rounded-lg border border-border p-4">
      <h2 id="chart-heading">{t('report.chart.heading')}</h2>
      <div role="group" aria-label={t('report.chart.heading')} className="mb-2 flex gap-2">
        {(['5m', 'hour', 'day'] as const).map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={granularity === value}
            onClick={() => onGranularityChange(value)}
          >
            {t(value === '5m' ? 'report.chart.granularity5m' : value === 'hour' ? 'report.chart.granularityHour' : 'report.chart.granularityDay')}
          </button>
        ))}
      </div>
      {compacted ? <p className="text-xs text-muted-foreground">{t('report.chart.compacted')}</p> : null}
      <ReportChart
        title={t('report.chart.heading')}
        labels={{
          showTable: t('chart.showTable'),
          hideTable: t('chart.hideTable'),
          tableCaption: t('report.chart.tableCaption'),
          periodColumn: t('report.chart.columnTime'),
        }}
        formatValue={(value) => format.number(value)}
        formatPeriod={(iso) => format.dateTime(new Date(iso), 'short')}
        series={[
          { key: 'sent', label: t('report.chart.columnSent') },
          { key: 'delivered', label: t('report.chart.columnDelivered') },
          { key: 'opens_unique', label: t('report.chart.columnOpens') },
          { key: 'clicks_unique', label: t('report.chart.columnClicks') },
        ]}
        points={points.map((point) => ({
          at: point.at,
          values: {
            sent: point.sent,
            delivered: point.delivered,
            opens_unique: point.opens_unique,
            clicks_unique: point.clicks_unique,
          },
        }))}
      />
    </section>
  );
}
```

`report/diagnostics-panel.tsx`:

```tsx
'use client';

import { useFormatter, useTranslations } from 'next-intl';
import type { StatsPayload } from './report-model';

export function DiagnosticsPanel({ payload }: { payload: StatsPayload }) {
  const t = useTranslations('reports');
  const format = useFormatter();

  return (
    <details className="rounded-lg border border-border p-4">
      <summary>{t('report.diagnostics.heading')}</summary>
      <dl className="mt-2 text-sm">
        <dt>{t('report.diagnostics.scannerClicks')}</dt>
        <dd>{format.number(payload.counts.clicks_scanner ?? 0)}</dd>
        <dd className="text-xs text-muted-foreground">{t('report.diagnostics.scannerClicksHint')}</dd>
        <dt>{t('report.diagnostics.lastEvent')}</dt>
        <dd>
          {payload.last_event_at === null
            ? t('report.diagnostics.noEvents')
            : format.dateTime(new Date(payload.last_event_at), { dateStyle: 'short', timeStyle: 'short' })}
        </dd>
        <dd className="text-xs text-muted-foreground">
          {payload.delivered_source === 'provider_events'
            ? t('report.diagnostics.deliveredSourceProvider')
            : t('report.diagnostics.deliveredSourceDerived')}
        </dd>
      </dl>
    </details>
  );
}
```

`report/follow-up-actions.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';

export function FollowUpActions({
  workspaceSlug,
  campaignId,
}: {
  workspaceSlug: string;
  campaignId: string;
}) {
  const t = useTranslations('reports');
  const base = `/w/${workspaceSlug}`;

  return (
    <section aria-label={t('report.title')} className="flex flex-wrap gap-3">
      {/* Segment vzniká v části 2, sem patří jen předvyplněný odkaz. */}
      <Link href={`${base}/segments/new?from_campaign=${campaignId}&preset=clicked`}>
        {t('report.actions.segmentFromClicked')}
      </Link>
      <Link href={`${base}/segments/new?from_campaign=${campaignId}&preset=not_opened`}>
        {t('report.actions.segmentFromNotOpened')}
      </Link>
      <Link href={`${base}/campaigns/new?duplicate=${campaignId}`}>{t('report.actions.duplicate')}</Link>
      <Link href={`${base}/campaigns/new?resend_unopened=${campaignId}`}>
        {t('report.actions.resendToUnopened')}
      </Link>
      <p className="w-full text-xs text-muted-foreground">{t('report.actions.resendWarning')}</p>
    </section>
  );
}
```

- [ ] **Krok 4: Napiš `report/campaign-report.tsx`**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  campaignLinksUrl,
  campaignProgressUrl,
  campaignStatsUrl,
  fetchJson,
  ReportsApiError,
} from '../api-client';
import { useLiveStats } from '../live/use-live-stats';
import { DiagnosticsPanel } from './diagnostics-panel';
import { FollowUpActions } from './follow-up-actions';
import { HeadlineTiles } from './headline-tiles';
import { LinksTable, type LinkRow } from './links-table';
import { OpensPanel } from './opens-panel';
import { ProblemsPanel } from './problems-panel';
import { ProgressChart, type ProgressPoint } from './progress-chart';
import { reportBanner } from './report-banner';
import type { OpensMode, StatsPayload } from './report-model';

export function CampaignReport({ workspaceSlug, campaignId }: { workspaceSlug: string; campaignId: string }) {
  const t = useTranslations('reports');
  const router = useRouter();
  const searchParams = useSearchParams();
  const mode: OpensMode = searchParams.get('opens') === 'all' ? 'all' : 'verified';
  const granularity = (searchParams.get('granularity') ?? '5m') as '5m' | 'hour' | 'day';

  const [payload, setPayload] = useState<StatsPayload | null>(null);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [progress, setProgress] = useState<{ points: ProgressPoint[]; compacted: boolean }>({
    points: [],
    compacted: false,
  });
  const [error, setError] = useState<ReportsApiError | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Tři nezávislé zdroje se načítají paralelně, ne za sebou.
    void Promise.allSettled([
      fetchJson<StatsPayload>(campaignStatsUrl(campaignId)),
      fetchJson<{ data: LinkRow[] }>(campaignLinksUrl(campaignId)),
      fetchJson<{ points: ProgressPoint[]; compacted: boolean }>(campaignProgressUrl(campaignId, granularity)),
    ]).then(([stats, linkResult, progressResult]) => {
      if (cancelled) return;
      if (stats.status === 'fulfilled' && stats.value.status === 'ok') setPayload(stats.value.data);
      if (stats.status === 'rejected') setError(stats.reason as ReportsApiError);
      if (linkResult.status === 'fulfilled' && linkResult.value.status === 'ok') setLinks(linkResult.value.data.data);
      if (progressResult.status === 'fulfilled' && progressResult.value.status === 'ok') {
        setProgress(progressResult.value.data);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [campaignId, granularity]);

  const live = useLiveStats(campaignId, null);

  useEffect(() => {
    if (!live.snapshot || !payload) return;
    setPayload({ ...payload, ...(live.snapshot as Partial<StatsPayload>) });
  }, [live.snapshot]);

  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams.toString());
    next.set(key, value);
    router.replace(`?${next.toString()}`, { scroll: false });
  };

  if (error) {
    return (
      <div role="alert" className="rounded-lg border border-destructive p-4">
        <p>{t('report.states.error')}</p>
        <button type="button" onClick={() => router.refresh()}>{t('report.states.retry')}</button>
        <details>
          <summary>{t('report.diagnostics.heading')}</summary>
          <p className="text-xs">{error.code} {error.requestId}</p>
        </details>
      </div>
    );
  }

  if (!payload) return <div aria-busy="true" className="h-64 animate-pulse rounded-lg bg-muted" />;

  if (payload.status === 'draft') {
    return (
      <div className="rounded-lg border border-border p-6">
        <p>{t('report.states.draft')}</p>
        <a href={`/w/${workspaceSlug}/campaigns/${campaignId}`}>{t('report.states.draftAction')}</a>
      </div>
    );
  }

  const banner = reportBanner(payload, new Date());

  return (
    <div className="flex flex-col gap-6">
      {banner === null ? null : (
        <p role="status" className={banner.tone === 'warning' ? 'text-amber-900' : 'text-muted-foreground'}>
          {t(banner.key, banner.values)}
        </p>
      )}
      {live.state.degraded ? (
        <p role="status" className="text-xs text-muted-foreground">{t('report.banner.liveUnavailable')}</p>
      ) : null}
      {payload.small_sample ? <p className="text-sm">{t('report.states.smallSample')}</p> : null}

      <HeadlineTiles payload={payload} />
      <OpensPanel payload={payload} mode={mode} onModeChange={(next) => setParam('opens', next)} />
      <ProblemsPanel
        payload={payload}
        onShowWho={(filter) => router.push(`?recipients=${filter}`)}
      />
      <LinksTable links={links} disabled={!payload.track_clicks} />
      <ProgressChart
        points={progress.points}
        compacted={progress.compacted}
        granularity={granularity}
        onGranularityChange={(value) => setParam('granularity', value)}
      />
      <DiagnosticsPanel payload={payload} />
      <FollowUpActions workspaceSlug={workspaceSlug} campaignId={campaignId} />
      <button type="button" onClick={live.refresh}>{t('report.states.retry')}</button>
    </div>
  );
}
```

- [ ] **Krok 5: Ověř překlad a mez balíku**

Run: `pnpm --filter @mlain/web typecheck && pnpm --filter @mlain/web build && pnpm --filter @mlain/web check:bundle`
Expected: build projde a kontrola balíku hlásí, že graf není v základním balíku.

- [ ] **Krok 6: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add apps/web/src/features/reports/report apps/web/src/app && git commit -m "feat(reports): campaign report screen with three tier opens"
```

---

### Úkol 32: Seznam příjemců v reportu

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/features/reports/recipients/recipients-filter.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/features/reports/recipients/recipients-panel.tsx`
- Test: `/Users/petr/Projects/Mailing_Tool/apps/web/src/features/reports/recipients/recipients-filter.test.ts`

- [ ] **Krok 1: Napiš padající test**

`apps/web/src/features/reports/recipients/recipients-filter.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { availableFilters, contactLabelKey, parseFilter } from './recipients-filter.js';

describe('parseFilter', () => {
  it('neznámou hodnotu z URL převede na všechny, ne na chybu', () => {
    expect(parseFilter('kdovico')).toBe('all');
    expect(parseFilter(null)).toBe('all');
    expect(parseFilter('machine_open_only')).toBe('machine_open_only');
  });
});

describe('availableFilters', () => {
  it('u kampaně s vypnutým měřením otevření nenabízí filtry otevření', () => {
    const filters = availableFilters({ trackOpens: false, trackClicks: true });
    expect(filters).not.toContain('opened');
    expect(filters).not.toContain('machine_open_only');
    expect(filters).toContain('clicked');
  });

  it('u vypnutého měření prokliků nenabízí filtry prokliků', () => {
    expect(availableFilters({ trackOpens: true, trackClicks: false })).not.toContain('clicked');
  });

  it('odrazy a odhlášení nabízí vždy, ty na měření nezávisí', () => {
    const filters = availableFilters({ trackOpens: false, trackClicks: false });
    expect(filters).toEqual(['all', 'bounced', 'complained', 'unsubscribed']);
  });
});

describe('contactLabelKey', () => {
  it('smazaný a anonymizovaný kontakt má náhradní popisek, ne prázdno', () => {
    expect(contactLabelKey('deleted')).toBe('report.recipients.deletedContact');
    expect(contactLabelKey('erased')).toBe('report.recipients.erasedContact');
    expect(contactLabelKey('active')).toBeNull();
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/web exec vitest run src/features/reports/recipients`
Expected: FAIL, `Cannot find module './recipients-filter.js'`.

- [ ] **Krok 3: Napiš `recipients-filter.ts`**

```ts
export const ALL_FILTERS = [
  'all',
  'opened',
  'clicked',
  'not_opened',
  'not_clicked',
  'bounced',
  'complained',
  'unsubscribed',
  'machine_open_only',
] as const;

export type RecipientFilter = (typeof ALL_FILTERS)[number];

export type ContactState = 'active' | 'deleted' | 'erased';

export function parseFilter(value: string | null): RecipientFilter {
  return (ALL_FILTERS as readonly string[]).includes(value ?? '') ? (value as RecipientFilter) : 'all';
}

/**
 * Filtr, který se opírá o vypnuté měření, by vždy vrátil prázdno a uživatel
 * by si myslel, že nikdo neotevřel. Nenabízí se vůbec.
 */
export function availableFilters(tracking: { trackOpens: boolean; trackClicks: boolean }): RecipientFilter[] {
  const filters: RecipientFilter[] = ['all'];
  if (tracking.trackOpens) filters.push('opened', 'not_opened', 'machine_open_only');
  if (tracking.trackClicks) filters.push('clicked', 'not_clicked');
  filters.push('bounced', 'complained', 'unsubscribed');
  return filters;
}

/** Smazaný ani anonymizovaný kontakt se nikdy nezobrazí jako prázdná buňka. */
export function contactLabelKey(state: ContactState): string | null {
  if (state === 'deleted') return 'report.recipients.deletedContact';
  if (state === 'erased') return 'report.recipients.erasedContact';
  return null;
}
```

- [ ] **Krok 4: Napiš `recipients-panel.tsx`**

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { fetchJson, recipientsUrl } from '../api-client';
import { ReportTable } from '../adapters/report-table';
import { availableFilters, contactLabelKey, type ContactState, type RecipientFilter } from './recipients-filter';

type Recipient = {
  message_id: string;
  contact_id: string | null;
  email: string | null;
  name: string | null;
  contact_state: ContactState;
  first_open_at: string | null;
  first_click_at: string | null;
  open_count: number;
  click_count: number;
  open_reliability: 'confirmed' | 'machine' | null;
};

export function RecipientsPanel({
  campaignId,
  filter,
  onFilterChange,
  tracking,
}: {
  campaignId: string;
  filter: RecipientFilter;
  onFilterChange: (filter: RecipientFilter) => void;
  tracking: { trackOpens: boolean; trackClicks: boolean };
}) {
  const t = useTranslations('reports');
  const format = useFormatter();
  const [rows, setRows] = useState<Recipient[]>([]);
  // Zásobník kurzorů předchozích stránek. K1 stránkuje dopředu i zpět,
  // ale kurzorové API zpětný kurzor nevrací, takže si ho drží obrazovka.
  const [history, setHistory] = useState<Array<string | null>>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [cursorInvalid, setCursorInvalid] = useState(false);

  const load = useCallback(
    async (nextCursor?: string) => {
      const result = await fetchJson<{
        data: Recipient[];
        pagination: { next_cursor: string | null; has_more: boolean };
      }>(recipientsUrl(campaignId, filter, nextCursor));
      if (result.status !== 'ok') {
        // Neplatný kurzor není chyba stránky: ukáže se první stránka téhož
        // filtru a řekne se to (kritérium 79). K1 na to má `cursorInvalid`.
        if (nextCursor !== undefined) {
          setCursorInvalid(true);
          setHistory([]);
          await load();
        }
        return;
      }
      setCursorInvalid(false);
      setRows(result.data.data);
      setCursor(result.data.pagination.next_cursor);
      setHasMore(result.data.pagination.has_more);
    },
    [campaignId, filter],
  );

  useEffect(() => {
    setHistory([]);
    void load();
  }, [load]);

  const goNext = useCallback(() => {
    if (cursor === null) return;
    setHistory((previous) => [...previous, cursor]);
    void load(cursor);
  }, [cursor, load]);

  const goPrevious = useCallback(() => {
    setHistory((previous) => {
      const next = previous.slice(0, -1);
      void load(next[next.length - 1] ?? undefined);
      return next;
    });
  }, [load]);

  const tableLabels = {
    selectRow: t('table.selectRow'),
    selectAllOnPage: t('table.selectAllOnPage'),
    previous: t('table.previous'),
    next: t('table.next'),
    showing: (shown: number, total: number, estimated: boolean) =>
      t('table.showing', { shown, total, estimated: String(estimated) }),
    selectedOnPage: (count: number) => t('table.selectedOnPage', { count }),
    selectAllMatching: (total: number) => t('table.selectAllMatching', { total }),
    selectedAllMatching: (total: number) => t('table.selectedAllMatching', { total }),
    clearSelection: t('table.clearSelection'),
    cursorInvalid: t('table.cursorInvalid'),
    sortNotAvailable: t('table.sortNotAvailable'),
    sortedAscending: t('table.sortedAscending'),
    sortedDescending: t('table.sortedDescending'),
    columnSettings: t('table.columnSettings'),
    columnVisible: (column: string) => t('table.columnVisible', { column }),
    columnWidth: (column: string) => t('table.columnWidth', { column }),
  };

  return (
    <section aria-labelledby="recipients-heading" className="rounded-lg border border-border p-4">
      <h2 id="recipients-heading">{t('report.recipients.heading')}</h2>
      <div role="group" aria-label={t('report.recipients.heading')} className="mb-3 flex flex-wrap gap-2">
        {availableFilters(tracking).map((value) => (
          <button key={value} type="button" aria-pressed={filter === value} onClick={() => onFilterChange(value)}>
            {t(`report.recipients.filter${value.replace(/(^|_)(\w)/g, (_, __, c: string) => c.toUpperCase())}`)}
          </button>
        ))}
      </div>
      <ReportTable
        tableId="report-recipients"
        caption={t('report.recipients.heading')}
        rows={rows}
        rowKey={(row) => row.message_id}
        labels={tableLabels}
        // Přesný počet příjemců by znamenal COUNT(*) přes celý oddíl na každou
        // stránku. K1 umí odhad označit, takže se počítá jen to, co je na stránce.
        count={{ value: rows.length, precision: hasMore ? 'estimated' : 'exact' }}
        hasMore={hasMore}
        canGoBack={history.length > 0}
        onNext={goNext}
        onPrevious={goPrevious}
        cursorInvalid={cursorInvalid}
        emptyState={<p>{t('report.recipients.empty')}</p>}
        columns={[
          {
            key: 'contact',
            header: t('report.recipients.columnContact'),
            cell: (row) => {
              const fallback = contactLabelKey(row.contact_state);
              if (fallback) return <span className="italic text-muted-foreground">{t(fallback)}</span>;
              return <span>{row.name ?? row.email}</span>;
            },
          },
          {
            key: 'opened',
            header: t('report.recipients.columnOpened'),
            cell: (row) =>
              row.first_open_at === null ? (
                <span>{'–'}</span>
              ) : (
                <span>
                  {format.dateTime(new Date(row.first_open_at), { dateStyle: 'short', timeStyle: 'short' })}
                  {row.open_reliability === 'machine' ? (
                    <span className="ml-1 text-xs text-muted-foreground">{t('report.recipients.machineOpen')}</span>
                  ) : null}
                </span>
              ),
          },
          {
            key: 'clicked',
            header: t('report.recipients.columnClicked'),
            cell: (row) =>
              row.first_click_at === null
                ? '–'
                : format.dateTime(new Date(row.first_click_at), { dateStyle: 'short', timeStyle: 'short' }),
          },
        ]}
      />
    </section>
  );
}
```

- [ ] **Krok 5: Spusť test a typovou kontrolu**

Run: `pnpm --filter @mlain/web exec vitest run src/features/reports/recipients && pnpm --filter @mlain/web typecheck`
Expected: PASS, `Tests  5 passed (5)`.

- [ ] **Krok 6: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add apps/web/src/features/reports/recipients && git commit -m "feat(reports): recipients panel that survives deleted contacts"
```

---

### Úkol 33: Časová osa na detailu kontaktu

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/app/[locale]/w/[workspaceSlug]/contacts/[contactId]/timeline/page.tsx`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/features/reports/timeline/group-sessions.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/features/reports/timeline/contact-timeline.tsx`
- Test: `/Users/petr/Projects/Mailing_Tool/apps/web/src/features/reports/timeline/group-sessions.test.ts`

- [ ] **Krok 1: Napiš padající test shlukování**

`apps/web/src/features/reports/timeline/group-sessions.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { groupWebSeries, iconFor } from './group-sessions.js';

function item(id: string, type: string, at: string, sessionId?: string) {
  return { id, type, source: type.startsWith('message') ? 'email' : 'web', occurred_at: at, title: id, session_id: sessionId };
}

describe('groupWebSeries', () => {
  it('shlukne webové události jedné session do jedné položky s počtem', () => {
    const grouped = groupWebSeries([
      item('a', 'page_view', '2026-07-31T18:20:00.000Z', 's1'),
      item('b', 'page_view', '2026-07-31T18:19:00.000Z', 's1'),
      item('c', 'page_view', '2026-07-31T18:18:00.000Z', 's1'),
    ]);
    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.groupCount).toBe(3);
    expect(grouped[0]?.children).toHaveLength(3);
  });

  it('e-mailové položky nikdy neshlukuje, aby ve webu nezmizely', () => {
    const grouped = groupWebSeries([
      item('a', 'page_view', '2026-07-31T18:20:00.000Z', 's1'),
      item('m', 'message_opened', '2026-07-31T18:19:00.000Z'),
      item('b', 'page_view', '2026-07-31T18:18:00.000Z', 's1'),
    ]);
    expect(grouped.map((g) => g.id)).toEqual(['a', 'm', 'b']);
  });

  it('dvě různé session zůstanou dvě položky', () => {
    const grouped = groupWebSeries([
      item('a', 'page_view', '2026-07-31T18:20:00.000Z', 's1'),
      item('b', 'page_view', '2026-07-31T18:19:00.000Z', 's2'),
    ]);
    expect(grouped).toHaveLength(2);
  });

  it('položka bez session se neshlukuje', () => {
    const grouped = groupWebSeries([
      item('a', 'page_view', '2026-07-31T18:20:00.000Z'),
      item('b', 'page_view', '2026-07-31T18:19:00.000Z'),
    ]);
    expect(grouped).toHaveLength(2);
  });
});

describe('iconFor', () => {
  it('neznámý typ dostane obecnou ikonu, ne výjimku', () => {
    expect(iconFor('automation_entered', 'automation')).toBe('generic');
    expect(iconFor('message_clicked', 'email')).toBe('click');
  });
});
```

- [ ] **Krok 2: Napiš `group-sessions.ts`**

```ts
export type ApiTimelineItem = {
  id: string;
  occurred_at: string;
  source: string;
  type: string;
  title: string;
  detail?: Record<string, unknown>;
  campaign?: { id: string; name: string };
  session_id?: string;
  reliability?: 'confirmed' | 'machine';
};

export type GroupedItem = ApiTimelineItem & {
  groupCount?: number;
  children?: ApiTimelineItem[];
};

/**
 * Šest zobrazení stránky během čtyř minut je jeden rozbalitelný řádek.
 * Bez toho web tracking osu zaplaví a e-mailové položky v ní zmizí.
 * Shlukují se jen sousední webové položky téže session, nikdy e-maily.
 */
export function groupWebSeries(items: ApiTimelineItem[]): GroupedItem[] {
  const result: GroupedItem[] = [];

  for (const item of items) {
    const previous = result[result.length - 1];
    const groupable = item.source === 'web' && typeof item.session_id === 'string';
    const sameGroup =
      groupable && previous?.source === 'web' && previous.session_id === item.session_id;

    if (sameGroup && previous) {
      previous.children = [...(previous.children ?? [previous]), item];
      previous.groupCount = previous.children.length;
      continue;
    }

    result.push(groupable ? { ...item, groupCount: 1, children: [item] } : { ...item });
  }

  return result.map((item) =>
    item.groupCount === 1 ? { ...item, groupCount: undefined, children: undefined } : item,
  );
}

export type TimelineIcon = 'mail' | 'open' | 'click' | 'web' | 'contact' | 'consent' | 'problem' | 'generic';

const ICONS: Record<string, TimelineIcon> = {
  message_sent: 'mail',
  message_delivered: 'mail',
  message_opened: 'open',
  message_clicked: 'click',
  message_failed: 'problem',
  message_bounced: 'problem',
  message_complained: 'problem',
  message_unsubscribed: 'contact',
  page_view: 'web',
  session_started: 'web',
  contact_created: 'contact',
  list_subscribed: 'contact',
  list_unsubscribed: 'contact',
  consent_granted: 'consent',
  consent_withdrawn: 'consent',
};

/** Otevřený výčet: neznámý typ dostane neutrální ikonu a zobrazí se. */
export function iconFor(type: string, _source: string): TimelineIcon {
  return ICONS[type] ?? 'generic';
}
```

- [ ] **Krok 3: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/web exec vitest run src/features/reports/timeline`
Expected: PASS, `Tests  5 passed (5)`.

- [ ] **Krok 4: Napiš obrazovku a stránku**

`timeline/contact-timeline.tsx`:

```tsx
'use client';

import { useCallback, useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import type { TimelineGender } from '@mlain/ui/patterns/timeline';
import { fetchJson, timelineUrl } from '../api-client';
import { ReportTimeline } from '../adapters/report-timeline';
import { groupWebSeries, iconFor, type ApiTimelineItem } from './group-sessions';

const FILTERS = ['all', 'email', 'web', 'contact', 'consent'] as const;
type Filter = (typeof FILTERS)[number];

export function ContactTimeline({ contactId, timezone }: { contactId: string; timezone: string }) {
  const t = useTranslations('reports');
  const format = useFormatter();
  const [filter, setFilter] = useState<Filter>('all');
  const [items, setItems] = useState<ApiTimelineItem[]>([]);
  // Rod kontaktu pro věty ze slotů. Vrací ho endpoint, protože klient
  // kontakt sám nečte a bez rodu by K8 skládala věty v neutrálním tvaru.
  //
  // Výčty se liší schválně a převod je tady: schéma zná `unknown`
  // (`contacts.gender` v P03), komponenta K8 zná `other`. Bez převodu by
  // `unknown` prošlo jako neplatná hodnota props a věta by se složila divně.
  const [gender, setGender] = useState<TimelineGender>('other');
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(
    async (nextCursor?: string) => {
      try {
        const result = await fetchJson<{
          data: ApiTimelineItem[];
          contact: { gender: 'female' | 'male' | 'unknown' };
          pagination: { next_cursor: string | null; has_more: boolean };
        }>(timelineUrl(contactId, { types: filter === 'all' ? undefined : filter, cursor: nextCursor }));
        if (result.status !== 'ok') return;
        setItems((previous) => (nextCursor ? [...previous, ...result.data.data] : result.data.data));
        setGender(result.data.contact.gender === 'unknown' ? 'other' : result.data.contact.gender);
        setCursor(result.data.pagination.next_cursor);
        setHasMore(result.data.pagination.has_more);
        setFailed(false);
      } catch {
        setFailed(true);
      }
    },
    [contactId, filter],
  );

  useEffect(() => {
    void load();
  }, [load]);

  if (failed) {
    return (
      <div role="alert">
        <p>{t('timeline.error')}</p>
        <button type="button" onClick={() => void load()}>{t('report.states.retry')}</button>
      </div>
    );
  }

  // Prázdný stav řeší obrazovka, ne komponenta: K8 props `emptyState` nemá
  // a mít nemusí, protože stav S3 patří obrazovce (registr stavů z P05).
  if (items.length === 0) {
    return (
      <section aria-labelledby="timeline-heading">
        <h2 id="timeline-heading">{t('timeline.heading')}</h2>
        <p>{t('timeline.empty')}</p>
        <p className="text-sm text-muted-foreground">{t('timeline.emptyHint')}</p>
      </section>
    );
  }

  const entries = groupWebSeries(items).map((item) => ({
    id: item.id,
    occurredAt: item.occurred_at,
    type: item.type,
    title:
      item.groupCount === undefined
        ? item.title
        : t('timeline.sessionGroup', { pages: item.groupCount }),
    icon: iconFor(item.type, item.source),
    reliability: item.reliability,
    detail: item.detail,
  }));

  const timelineLabels = {
    today: t('timeline.today'),
    yesterday: t('timeline.yesterday'),
    loadOlder: t('timeline.loadOlder'),
    expandCluster: (count: number) => t('timeline.expandCluster', { count }),
    collapseCluster: t('timeline.collapseCluster'),
    expanded: t('timeline.expanded'),
    collapsed: t('timeline.collapsed'),
  };

  return (
    <section aria-labelledby="timeline-heading">
      <h2 id="timeline-heading">{t('timeline.heading')}</h2>
      <div role="group" aria-label={t('timeline.heading')} className="mb-3 flex flex-wrap gap-2">
        {FILTERS.map((value) => (
          <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}>
            {t(`timeline.filter${value.charAt(0).toUpperCase()}${value.slice(1)}`)}
          </button>
        ))}
      </div>
      <ReportTimeline
        entries={entries}
        gender={gender}
        timeZone={timezone}
        labels={timelineLabels}
        formatTime={(value) => format.dateTime(value, { timeStyle: 'short', timeZone: timezone })}
        formatDate={(value) => format.dateTime(value, { dateStyle: 'long', timeZone: timezone })}
        hasMore={hasMore}
        onLoadOlder={() => void load(cursor ?? undefined)}
      />
    </section>
  );
}
```

Rod se bere z odpovědi endpointu, ne z prohlížeče: `gender` je pole kontaktu a věty ze slotů na něm stojí (13.1). Endpoint ho vrací vedle položek, protože klient kontakt jinak nečte.

`.../contacts/[contactId]/timeline/page.tsx`:

```tsx
import { ContactTimeline } from '@/features/reports/timeline/contact-timeline';

export default async function ContactTimelinePage({
  params,
}: {
  params: Promise<{ contactId: string }>;
}) {
  const { contactId } = await params;
  // Zóna se bere z profilu uživatele, běžné časy v UI se zobrazují v jeho zóně.
  return <ContactTimeline contactId={contactId} timezone={Intl.DateTimeFormat().resolvedOptions().timeZone} />;
}
```

- [ ] **Krok 5: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add apps/web/src/features/reports/timeline apps/web/src/app && git commit -m "feat(reports): fill the contact timeline with data"
```

---

### Úkol 34: Přehled projektu

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/app/[locale]/w/[workspaceSlug]/page.tsx`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/features/reports/dashboard/dashboard-grid.tsx`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/features/reports/dashboard/dashboard-slots.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/apps/web/src/features/reports/dashboard/dashboard-slots.test.ts`

- [ ] **Krok 1: Napiš padající test slotů a stárnutí**

`apps/web/src/features/reports/dashboard/dashboard-slots.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isStale, parsePeriod, tileOrder } from './dashboard-slots.js';

describe('parsePeriod', () => {
  it('bere jen povolená období, jinak třicet dní', () => {
    expect(parsePeriod('7')).toBe(7);
    expect(parsePeriod('365')).toBe(30);
    expect(parsePeriod(null)).toBe(30);
  });
});

describe('tileOrder', () => {
  it('proklik je první, otevření až za ním', () => {
    expect(tileOrder()[0]).toBe('click_rate');
    expect(tileOrder().indexOf('open_rate')).toBeGreaterThan(0);
  });
});

describe('isStale', () => {
  it('hodnota starší než dvojnásobek TTL se označí', () => {
    const now = new Date('2026-07-31T12:03:00.000Z');
    expect(isStale('2026-07-31T12:00:00.000Z', 60_000, now)).toBe(true);
    expect(isStale('2026-07-31T12:02:30.000Z', 60_000, now)).toBe(false);
  });
});
```

- [ ] **Krok 2: Napiš `dashboard-slots.ts`**

```ts
import type { ReactNode } from 'react';

export type DashboardPeriod = 7 | 30 | 90;

export function parsePeriod(value: string | null): DashboardPeriod {
  const parsed = Number(value);
  return parsed === 7 || parsed === 90 ? parsed : 30;
}

/** Proklik je hlavní číslo, otevření stojí vedle něj a menší. */
export function tileOrder(): string[] {
  return ['click_rate', 'sent', 'open_rate', 'problems', 'web_active', 'recent_campaigns'];
}

export function isStale(computedAt: string, ttlMs: number, now: Date): boolean {
  return now.getTime() - new Date(computedAt).getTime() > ttlMs * 2;
}

/**
 * Zdroje 3 až 5 z 8.11.1 (kvóta provideru, stav doručitelnosti, rozdělaná práce)
 * vlastní jiné plány. Přehled je bere jako sloty, takže jejich selhání
 * nezhroutí stránku a jejich doplnění nevyžaduje zásah do téhle obrazovky.
 */
export type DashboardSlots = {
  providerQuota?: ReactNode;
  deliverabilityWarning?: ReactNode;
  onboardingSteps?: ReactNode;
};
```

- [ ] **Krok 3: Napiš `dashboard-grid.tsx` a stránku**

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import Link from 'next/link';
import { dashboardUrl, fetchJson } from '../api-client';
import { isStale, parsePeriod, type DashboardPeriod, type DashboardSlots } from './dashboard-slots';

type Tile =
  | { status: 'ok'; data: Record<string, unknown>; computed_at: string; stale: boolean }
  | { status: 'error'; code: string };

type DashboardPayload = {
  period_days: number;
  computed_at: string;
  tiles: Record<string, Tile>;
};

export function DashboardGrid({ workspaceSlug, slots = {} }: { workspaceSlug: string; slots?: DashboardSlots }) {
  const t = useTranslations('reports');
  const format = useFormatter();
  const [period, setPeriod] = useState<DashboardPeriod>(parsePeriod(null));
  const [payload, setPayload] = useState<DashboardPayload | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchJson<DashboardPayload>(dashboardUrl(period)).then((result) => {
      if (!cancelled && result.status === 'ok') setPayload(result.data);
    });
    return () => {
      cancelled = true;
    };
  }, [period]);

  if (!payload) return <div aria-busy="true" className="h-64 animate-pulse rounded-lg bg-muted" />;

  const running = payload.tiles.running;
  const clicks = payload.tiles.click_rate;
  const opens = payload.tiles.open_rate;
  const problems = payload.tiles.problems;
  const sent = payload.tiles.sent;
  const web = payload.tiles.web_active;
  const recent = payload.tiles.recent_campaigns;

  return (
    <div className="flex flex-col gap-6">
      <h1>{t('dashboard.heading')}</h1>

      <div role="group" aria-label={t('dashboard.heading')} className="flex gap-2">
        {([7, 30, 90] as const).map((value) => (
          <button key={value} type="button" aria-pressed={period === value} onClick={() => setPeriod(value)}>
            {t(`dashboard.period${value}`)}
          </button>
        ))}
      </div>

      {running?.status === 'ok' && running.data.campaign ? (
        <p role="status">
          {t('dashboard.running', running.data.campaign as Record<string, string | number>)}{' '}
          <Link href={`/w/${workspaceSlug}/campaigns/${(running.data.campaign as { campaignId: string }).campaignId}/report`}>
            {t('dashboard.runningAction')}
          </Link>
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-4">
        {/* Kliklo je vizuálně největší dlaždice. */}
        <section aria-labelledby="tile-clicks" className="rounded-lg border border-border p-6 sm:col-span-2">
          <h2 id="tile-clicks">{t('dashboard.clicked')}</h2>
          {clicks?.status === 'error' ? (
            <p role="alert">{t('dashboard.tileError')}</p>
          ) : clicks?.status === 'ok' && typeof clicks.data.rate === 'number' ? (
            <p className="text-5xl font-semibold">
              {format.number(clicks.data.rate, { style: 'percent', maximumFractionDigits: 1 })}
            </p>
          ) : (
            <p>{t('dashboard.emptyNoCampaigns')}</p>
          )}
          <p className="text-xs text-muted-foreground">{t('dashboard.clickedHint')}</p>
        </section>

        <section aria-labelledby="tile-sent" className="rounded-lg border border-border p-4">
          <h2 id="tile-sent">{t('dashboard.sent')}</h2>
          {sent?.status === 'ok' ? <p className="text-3xl">{format.number(Number(sent.data.value))}</p> : <p role="alert">{t('dashboard.tileError')}</p>}
        </section>

        <section aria-labelledby="tile-opens" className="rounded-lg border border-border p-4">
          <h2 id="tile-opens">{t('dashboard.opened')}</h2>
          {opens?.status === 'ok' && typeof opens.data.rate === 'number' ? (
            <>
              <p className="text-3xl">{format.number(opens.data.rate, { style: 'percent', maximumFractionDigits: 1 })}</p>
              <p className="text-xs text-muted-foreground">
                {t('dashboard.openedMachine', {
                  share: format.number(Number(opens.data.machineShare ?? 0), { style: 'percent', maximumFractionDigits: 0 }),
                })}
              </p>
            </>
          ) : (
            <p>{t('dashboard.emptyNoCampaigns')}</p>
          )}
        </section>

        <section aria-labelledby="tile-problems" className="rounded-lg border border-border p-4">
          <h2 id="tile-problems">{t('dashboard.problems')}</h2>
          {problems?.status === 'ok' ? (
            <p>{problems.data.level === 'ok' ? t('dashboard.problemsOk') : t('dashboard.problemsBad')}</p>
          ) : (
            <p role="alert">{t('dashboard.tileError')}</p>
          )}
        </section>

        <section aria-labelledby="tile-web" className="rounded-lg border border-border p-4">
          <h2 id="tile-web">{t('dashboard.webActive')}</h2>
          {web?.status === 'ok' ? (
            <>
              <p>{t('dashboard.webActiveValue', { count: Number(web.data.contacts) })}</p>
              {isStale(web.computed_at, 300_000, new Date()) ? (
                <p className="text-xs text-muted-foreground">
                  {t('dashboard.computedAt', { time: format.dateTime(new Date(web.computed_at), { timeStyle: 'short' }) })}
                </p>
              ) : null}
            </>
          ) : (
            <p role="alert">{t('dashboard.tileError')}</p>
          )}
        </section>

        <section aria-labelledby="tile-recent" className="rounded-lg border border-border p-4 sm:col-span-2">
          <h2 id="tile-recent">{t('dashboard.recentCampaigns')}</h2>
          {recent?.status === 'ok' ? (
            <ul>
              {(recent.data.items as Array<{ campaignId: string; name: string; clickRate: number | null }>).map((item) => (
                <li key={item.campaignId}>
                  <Link href={`/w/${workspaceSlug}/campaigns/${item.campaignId}/report`}>{item.name}</Link>{' '}
                  {item.clickRate === null ? '–' : format.number(item.clickRate, { style: 'percent', maximumFractionDigits: 1 })}
                </li>
              ))}
            </ul>
          ) : (
            <p role="alert">{t('dashboard.tileError')}</p>
          )}
        </section>
      </div>

      {slots.providerQuota}
      {slots.deliverabilityWarning}
      {slots.onboardingSteps}
    </div>
  );
}
```

`.../w/[workspaceSlug]/page.tsx`:

```tsx
import { DashboardGrid } from '@/features/reports/dashboard/dashboard-grid';

export default async function WorkspaceDashboardPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  return <DashboardGrid workspaceSlug={workspaceSlug} />;
}
```

- [ ] **Krok 4: Spusť test a typovou kontrolu**

Run: `pnpm --filter @mlain/web exec vitest run src/features/reports/dashboard && pnpm --filter @mlain/web typecheck`
Expected: PASS, `Tests  3 passed (3)`.

- [ ] **Krok 5: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add apps/web/src/features/reports/dashboard apps/web/src/app && git commit -m "feat(reports): overview screen with click rate as the headline"
```

---

### Úkol 35: Statistiky, vývoj v čase

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/app/[locale]/w/[workspaceSlug]/stats/campaigns/page.tsx`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/features/reports/stats/trend-series.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/features/reports/stats/campaign-trend.tsx`
- Test: `/Users/petr/Projects/Mailing_Tool/apps/web/src/features/reports/stats/trend-series.test.ts`

- [ ] **Krok 1: Napiš padající test**

`apps/web/src/features/reports/stats/trend-series.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { trendRows, trendSeries } from './trend-series.js';

const campaigns = [
  { campaignId: 'a', name: 'A', startedAt: '2026-06-01T10:00:00.000Z', delivered: 1000, deliveredEffective: 1000, opens: 500, opensApple: 200, clicks: 40, unsubscribed: 5, sent: 1010 },
  { campaignId: 'b', name: 'B', startedAt: '2026-07-01T10:00:00.000Z', delivered: 2000, deliveredEffective: 2000, opens: 900, opensApple: 300, clicks: 100, unsubscribed: 6, sent: 2050 },
];

describe('trendSeries', () => {
  it('vrací čtyři řady a body v pořadí odeslání', () => {
    const series = trendSeries(campaigns);
    expect(series.map((s) => s.key)).toEqual(['delivered', 'clicked', 'opened', 'unsubscribed']);
  });

  it('míry počítá z doručených, ne z odeslaných', () => {
    const rows = trendRows(campaigns);
    expect(rows[0]?.values.clicked).toBeCloseTo(40 / 1000, 10);
    expect(rows[1]?.values.opened).toBeCloseTo(900 / 2000, 10);
  });

  it('u nulového jmenovatele vrací nulu místo NaN, aby graf nespadl', () => {
    const rows = trendRows([{ ...campaigns[0]!, delivered: 0, deliveredEffective: 0, sent: 0 }]);
    expect(Number.isNaN(rows[0]?.values.clicked)).toBe(false);
  });

  it('tvar TrendCampaign sedí na to, co vrací dlaždice recent_campaigns', () => {
    // Kdyby endpoint pole přejmenoval nebo je přestal vracet, spočítal by graf
    // podíly z undefined a vykreslil nuly, aniž by cokoliv spadlo.
    for (const key of ['sent', 'delivered', 'deliveredEffective', 'opens', 'opensApple', 'clicks', 'unsubscribed', 'startedAt']) {
      expect(campaigns[0]).toHaveProperty(key);
    }
  });

  it('u každé kampaně nese podíl automatických otevření, aby otevření nestálo samo', () => {
    expect(trendRows(campaigns)[0]?.machineShare).toBeCloseTo(200 / 500, 10);
  });
});
```

- [ ] **Krok 2: Napiš `trend-series.ts`**

```ts
/**
 * Tvar jedné kampaně tak, jak ji vrací dlaždice `recent_campaigns`
 * z `/api/v1/dashboard`. Pole se jmenují stejně jako v `RecentCampaign`
 * (úkol 22) schválně: kdyby se lišila, graf by počítal podíly z `undefined`
 * a vykreslil samé nuly, aniž by cokoliv spadlo. Hlídá to test v kroku 1.
 */
export type TrendCampaign = {
  campaignId: string;
  name: string;
  startedAt: string;
  sent: number;
  delivered: number;
  deliveredEffective: number;
  opens: number;
  opensApple: number;
  clicks: number;
  unsubscribed: number;
};

export type TrendRow = {
  campaignId: string;
  name: string;
  at: string;
  values: { delivered: number; clicked: number; opened: number; unsubscribed: number };
  machineShare: number;
};

export function trendSeries(_campaigns: TrendCampaign[]) {
  return [
    { key: 'delivered', labelKey: 'stats.seriesDelivered' },
    { key: 'clicked', labelKey: 'stats.seriesClicked' },
    { key: 'opened', labelKey: 'stats.seriesOpened' },
    { key: 'unsubscribed', labelKey: 'stats.seriesUnsubscribed' },
  ];
}

/** Osa Y u měr začíná na nule, proto se pracuje s podíly, ne s absolutními počty. */
export function trendRows(campaigns: TrendCampaign[]): TrendRow[] {
  return [...campaigns]
    .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime())
    .map((campaign) => ({
      campaignId: campaign.campaignId,
      name: campaign.name,
      at: campaign.startedAt,
      values: {
        delivered: ratio(campaign.deliveredEffective, campaign.sent),
        // Jmenovatel je deliveredEffective, ne delivered: u SMTP provideru
        // je `delivered` trvale nula a míry by vyšly nulové u každé kampaně.
        clicked: ratio(campaign.clicks, campaign.deliveredEffective),
        opened: ratio(campaign.opens, campaign.deliveredEffective),
        unsubscribed: ratio(campaign.unsubscribed, campaign.deliveredEffective),
      },
      machineShare: ratio(campaign.opensApple, campaign.opens),
    }));
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}
```

- [ ] **Krok 3: Napiš obrazovku**

`stats/campaign-trend.tsx`:

```tsx
'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { fetchJson } from '../api-client';
import { trendRows, trendSeries, type TrendCampaign } from './trend-series';

const ReportChart = dynamic(() => import('../adapters/report-chart').then((m) => m.ReportChart), {
  ssr: false,
});

const MIN_CAMPAIGNS_FOR_TREND = 3;

export function CampaignTrend() {
  const t = useTranslations('reports');
  const format = useFormatter();
  const [campaigns, setCampaigns] = useState<TrendCampaign[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchJson<{ tiles: Record<string, { status: string; data?: { items?: TrendCampaign[] } }> }>(
      '/api/v1/dashboard?period=90',
    ).then((result) => {
      if (cancelled || result.status !== 'ok') return;
      const tile = result.data.tiles.recent_campaigns;
      setCampaigns(tile?.status === 'ok' ? (tile.data?.items ?? []) : []);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!campaigns) return <div aria-busy="true" className="h-64 animate-pulse rounded-lg bg-muted" />;

  if (campaigns.length < MIN_CAMPAIGNS_FOR_TREND) {
    return (
      <section aria-labelledby="trend-heading">
        <h1 id="trend-heading">{t('stats.campaignsHeading')}</h1>
        <p>{t('stats.emptyTooFew')}</p>
      </section>
    );
  }

  const rows = trendRows(campaigns);

  return (
    <section aria-labelledby="trend-heading" className="flex flex-col gap-4">
      <h1 id="trend-heading">{t('stats.campaignsHeading')}</h1>
      <p className="text-sm text-muted-foreground">{t('stats.openWithMachineNote')}</p>
      <ReportChart
        title={t('stats.campaignsHeading')}
        labels={{
          showTable: t('chart.showTable'),
          hideTable: t('chart.hideTable'),
          tableCaption: t('stats.tableCaption'),
          periodColumn: t('stats.columnSentAt'),
        }}
        formatValue={(value) => format.number(value, { style: 'percent', maximumFractionDigits: 1 })}
        formatPeriod={(iso) => format.dateTime(new Date(iso), { dateStyle: 'short' })}
        series={trendSeries(campaigns).map((serie) => ({ key: serie.key, label: t(serie.labelKey) }))}
        points={rows.map((row) => ({ at: row.at, values: row.values }))}
      />
      <table className="w-full text-sm">
        <caption>{t('stats.tableCaption')}</caption>
        <thead>
          <tr>
            <th scope="col">{t('stats.columnCampaign')}</th>
            <th scope="col">{t('stats.seriesClicked')}</th>
            <th scope="col">{t('stats.seriesOpened')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.campaignId}>
              <th scope="row" className="text-left font-normal">{row.name}</th>
              <td>{format.number(row.values.clicked, { style: 'percent', maximumFractionDigits: 1 })}</td>
              <td>
                {format.number(row.values.opened, { style: 'percent', maximumFractionDigits: 1 })}
                <span className="ml-1 text-xs text-muted-foreground">
                  {t('dashboard.openedMachine', {
                    share: format.number(row.machineShare, { style: 'percent', maximumFractionDigits: 0 }),
                  })}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
```

`.../stats/campaigns/page.tsx`:

```tsx
import { CampaignTrend } from '@/features/reports/stats/campaign-trend';

export default function CampaignStatsPage() {
  return <CampaignTrend />;
}
```

- [ ] **Krok 4: Spusť test a typovou kontrolu**

Run: `pnpm --filter @mlain/web exec vitest run src/features/reports/stats && pnpm --filter @mlain/web typecheck`
Expected: PASS, `Tests  5 passed (5)`.

- [ ] **Krok 5: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add apps/web/src/features/reports/stats apps/web/src/app && git commit -m "feat(reports): campaign trend screen with table alternative"
```

---

### Úkol 36: Testy v prohlížeči

Stavy obrazovek a chování živých aktualizací se testují proti běžící aplikaci s odchycenými odpověďmi API. Databáze k tomu není potřeba a testy jsou tím rychlé i deterministické.

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/e2e/reports/fixtures.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/e2e/reports/report.spec.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/e2e/reports/report-states.spec.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/e2e/reports/live-updates.spec.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/e2e/reports/timeline.spec.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/e2e/reports/dashboard.spec.ts`

- [ ] **Krok 1: Napiš fixtures**

`apps/web/e2e/reports/fixtures.ts`:

```ts
import type { Page } from '@playwright/test';

export const STATS = {
  campaign_id: 'c1',
  name: 'Letní výprodej',
  subject: 'Sleva 30 %',
  status: 'sent',
  track_opens: true,
  track_clicks: true,
  delivered_source: 'provider_events',
  counts: {
    materialized: 1153, sent: 1153, skipped: 0, failed: 0,
    delivered: 1141, delivered_effective: 1141,
    bounced_hard: 8, bounced_soft: 4, complained: 1, unsubscribed: 4,
    opens_total: 1200, opens_unique: 832, opens_unique_human: 387, opens_unique_apple: 411,
    clicks_total: 210, clicks_unique: 190, clicks_unique_human: 187, clicks_scanner: 20,
  },
  rates: {
    open_rate: 0.729, machine_open_share: 0.494, verified_open_rate: 0.53,
    click_rate: 0.164, click_to_open_rate: 0.483,
    bounce_rate: 0.0104, complaint_rate: 0.00088, unsubscribe_rate: 0.0035,
  },
  open_breakdown: { verified: 387, machine: 411, uncertain: 34, total: 832, clicked_from_verified: 187 },
  predicted_opens: { low_count: 560, high_count: 640, sample_size: 730 },
  small_sample: false,
  audience_built_at: '2026-07-31T14:38:00.000Z',
  started_at: '2026-07-25T14:38:00.000Z',
  finished_at: '2026-07-25T14:52:00.000Z',
  first_event_at: '2026-07-25T14:39:00.000Z',
  last_event_at: '2026-07-25T18:02:00.000Z',
  version: 42,
  updated_at: '2026-07-25T18:02:00.000Z',
};

export async function stubReportApi(page: Page, overrides: Partial<typeof STATS> = {}): Promise<void> {
  await page.route('**/api/v1/campaigns/*/stats', (route) =>
    route.fulfill({ json: { ...STATS, ...overrides }, headers: { ETag: 'W/"42"' } }),
  );
  await page.route('**/api/v1/campaigns/*/links', (route) =>
    route.fulfill({
      json: {
        data: [
          { link_id: 'l1', url: 'https://x.cz/nabidka', label: 'Zobrazit nabídku', position: 0, clicks_total: 142, clicks_unique: 112, clicks_human: 142, share: 0.75, duplicate_url: false },
        ],
      },
    }),
  );
  await page.route('**/api/v1/campaigns/*/stats/timeline*', (route) =>
    route.fulfill({ json: { granularity: '5m', compacted: false, points: [] } }),
  );
  await page.route('**/api/v1/campaigns/*/recipients*', (route) =>
    route.fulfill({ json: { data: [], pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit: 50 } } }),
  );
}
```

- [ ] **Krok 2: Napiš `report.spec.ts`**

```ts
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { stubReportApi } from './fixtures';

test.describe('report kampaně', () => {
  test.beforeEach(async ({ page }) => {
    await stubReportApi(page);
    await page.goto('/w/demo/campaigns/c1/report');
  });

  test('hlavní dlaždice jsou kliklo, doručeno a odhlásilo se (kritérium 57)', async ({ page }) => {
    const headings = await page.getByRole('heading', { level: 3 }).allInnerTexts();
    expect(headings).toEqual(['Kliklo', 'Doručeno', 'Odhlásilo se']);
  });

  test('u otevření je trvalá poznámka o nepřesnosti a rozpad na tři skupiny (kritérium 58)', async ({ page }) => {
    await expect(page.getByText('Spolehlivé číslo je kliknutí.')).toBeVisible();
    await expect(page.getByText('387 ověřených')).toBeVisible();
    await expect(page.getByText('411 pravděpodobně automatických')).toBeVisible();
    await expect(page.getByText('34 nejistých')).toBeVisible();
    await expect(page.getByText(/navíc kliklo na odkaz/)).toBeVisible();
  });

  test('přepínač automatických otevření je ve výchozím stavu zapnutý a mění číslo', async ({ page }) => {
    const toggle = page.getByLabel('Odečíst pravděpodobně automatická otevření');
    await expect(toggle).toBeChecked();
    await expect(page.getByText('z doručených bez Apple Mailu')).toBeVisible();
    await toggle.uncheck();
    await expect(page.getByText('Zobrazena všechna otevření')).toBeVisible();
    await expect(page).toHaveURL(/opens=all/);
  });

  test('prediktivní otevření je označené jako odhad a je to rozsah', async ({ page }) => {
    await expect(page.getByText(/odhad 560 až 640/)).toBeVisible();
  });

  test('u každého procenta je jmenovatel (kritérium 59)', async ({ page }) => {
    await expect(page.getByText('z doručených').first()).toBeVisible();
    await expect(page.getByText('z odeslaných').first()).toBeVisible();
  });

  test('obrazovka nemá vážné prohřešky proti přístupnosti', async ({ page }) => {
    const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag22aa']).analyze();
    expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
  });
});
```

- [ ] **Krok 3: Napiš `report-states.spec.ts`**

```ts
import { expect, test } from '@playwright/test';
import { STATS, stubReportApi } from './fixtures';

test('kampaň s vypnutým měřením ukáže vysvětlení, ne nuly (kritérium 60)', async ({ page }) => {
  await stubReportApi(page, { track_opens: false, track_clicks: false });
  await page.goto('/w/demo/campaigns/c1/report');
  await expect(page.getByText('Měření otevření bylo pro tuto kampaň vypnuté')).toBeVisible();
  await expect(page.getByText('Měření prokliků bylo pro tuto kampaň vypnuté')).toBeVisible();
  await expect(page.getByText('0 ověřených')).toHaveCount(0);
});

test('koncept ukáže cestu k editaci, ne prázdný report', async ({ page }) => {
  await stubReportApi(page, { status: 'draft' });
  await page.goto('/w/demo/campaigns/c1/report');
  await expect(page.getByText('Report bude dostupný po odeslání kampaně.')).toBeVisible();
});

test('odesílaná kampaň ukáže pruh s průběhem', async ({ page }) => {
  await stubReportApi(page, { status: 'sending', counts: { ...STATS.counts, sent: 428, materialized: 1129 } });
  await page.goto('/w/demo/campaigns/c1/report');
  await expect(page.getByText(/428 z 1 129/)).toBeVisible();
});

test('chyba načtení ukáže kód a request_id pod podrobnostmi (kritérium 22)', async ({ page }) => {
  await page.route('**/api/v1/campaigns/*/stats', (route) =>
    route.fulfill({ status: 500, json: { code: 'internal_error', request_id: 'req-42' } }),
  );
  await page.goto('/w/demo/campaigns/c1/report');
  await expect(page.getByRole('alert')).toBeVisible();
  await page.getByText('Diagnostika').click();
  await expect(page.getByText(/req-42/)).toBeVisible();
});
```

- [ ] **Krok 4: Napiš `live-updates.spec.ts`**

```ts
import { expect, test } from '@playwright/test';
import { STATS, stubReportApi } from './fixtures';

test('nad HTTP/1.1 se neotevře žádné SSE spojení (kritérium 94)', async ({ page }) => {
  await stubReportApi(page, { status: 'sending' });
  const streamRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/stream')) streamRequests.push(request.url());
  });
  await page.goto('/w/demo/campaigns/c1/report');
  await page.waitForTimeout(1000);
  // Testovací server Playwrightu jede po HTTP/1.1, takže klient musí zvolit dotazování.
  expect(streamRequests).toEqual([]);
});

test('report se dá načíst a obnovit i bez živých aktualizací (kritérium 102)', async ({ page }) => {
  await stubReportApi(page, { status: 'sending' });
  await page.route('**/api/v1/campaigns/*/stream', (route) => route.abort());
  await page.goto('/w/demo/campaigns/c1/report');
  await expect(page.getByText('Kliklo')).toBeVisible();
  await page.getByRole('button', { name: 'Zkusit znovu' }).click();
  await expect(page.getByText('Kliklo')).toBeVisible();
});

test('šest karet reportu nezablokuje sedmý požadavek na API (kritérium 94)', async ({ browser }) => {
  const context = await browser.newContext();
  const pages = [];
  for (let i = 0; i < 6; i += 1) {
    const page = await context.newPage();
    await stubReportApi(page, { status: 'sending' });
    await page.goto('/w/demo/campaigns/c1/report');
    pages.push(page);
  }
  const seventh = await context.newPage();
  await stubReportApi(seventh);
  const started = Date.now();
  await seventh.goto('/w/demo/campaigns/c1/report');
  await expect(seventh.getByText('Kliklo')).toBeVisible();
  expect(Date.now() - started).toBeLessThan(10_000);
  await context.close();
});

test('v režimu dotazování se nezměněná data nepřekreslují', async ({ page }) => {
  let calls = 0;
  await stubReportApi(page, { status: 'sending' });
  await page.route('**/api/v1/campaigns/*/stats', (route) => {
    calls += 1;
    if (calls === 1) return route.fulfill({ json: { ...STATS, status: 'sending' }, headers: { ETag: 'W/"42"' } });
    return route.fulfill({ status: 304, body: '' });
  });
  await page.goto('/w/demo/campaigns/c1/report');
  await page.waitForTimeout(4000);
  expect(calls).toBeGreaterThan(1);
  await expect(page.getByText('Kliklo')).toBeVisible();
});
```

- [ ] **Krok 5: Napiš `timeline.spec.ts` a `dashboard.spec.ts`**

`timeline.spec.ts`:

```ts
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const ITEMS = [
  { id: '1', occurred_at: '2026-07-31T14:42:00.000Z', source: 'email', type: 'message_clicked', title: 'Klikla na Zobrazit nabídku v kampani Letní výprodej' },
  { id: '2', occurred_at: '2026-07-31T14:41:00.000Z', source: 'email', type: 'message_opened', title: 'Otevřela kampaň Letní výprodej', reliability: 'machine' },
  { id: '3', occurred_at: '2026-07-30T18:20:00.000Z', source: 'web', type: 'page_view', title: 'Zobrazila stránku', session_id: 's1' },
  { id: '4', occurred_at: '2026-07-30T18:19:00.000Z', source: 'web', type: 'page_view', title: 'Zobrazila stránku', session_id: 's1' },
  { id: '5', occurred_at: '2026-07-30T18:18:00.000Z', source: 'automation', type: 'automation_entered', title: 'Vstup do automatizace' },
];

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/contacts/*/timeline*', (route) =>
    route.fulfill({ json: { data: ITEMS, pagination: { next_cursor: null, prev_cursor: null, has_more: false, limit: 50 } } }),
  );
  await page.goto('/w/demo/contacts/k1/timeline');
});

test('věty jsou skloňované podle rodu a automatické otevření je označené', async ({ page }) => {
  await expect(page.getByText('Klikla na Zobrazit nabídku v kampani Letní výprodej')).toBeVisible();
  await expect(page.getByText('Automatické stažení poštovním klientem')).toBeVisible();
});

test('webová série jedné návštěvy je jeden rozbalitelný řádek', async ({ page }) => {
  await expect(page.getByText(/Návštěva webu, 2 stránky/)).toBeVisible();
});

test('neznámý typ položky obrazovku nerozbije', async ({ page }) => {
  await expect(page.getByText('Vstup do automatizace')).toBeVisible();
});

test('osa nemá vážné prohřešky proti přístupnosti', async ({ page }) => {
  const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
  expect(results.violations.filter((v) => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
});
```

`dashboard.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

const OK = (data: Record<string, unknown>) => ({ status: 'ok', data, computed_at: new Date().toISOString(), stale: false });

test('selhání jedné dlaždice nezhroutí přehled (kritérium 24)', async ({ page }) => {
  await page.route('**/api/v1/dashboard*', (route) =>
    route.fulfill({
      json: {
        period_days: 30,
        computed_at: new Date().toISOString(),
        tiles: {
          sent: OK({ value: 48320 }),
          click_rate: OK({ rate: 0.038, delta: 0.004 }),
          open_rate: OK({ rate: 0.241, machineShare: 0.41 }),
          problems: OK({ bounceRate: 0.009, complaintRate: 0.0004, level: 'ok' }),
          web_active: { status: 'error', code: 'tile_unavailable' },
          recent_campaigns: OK({ items: [] }),
          running: OK({ campaign: null }),
        },
      },
    }),
  );
  await page.goto('/w/demo');
  await expect(page.getByText('3,8 %')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(1);
});

test('hlavní číslo přehledu je proklik, otevření je menší a s podílem automatických', async ({ page }) => {
  await page.route('**/api/v1/dashboard*', (route) =>
    route.fulfill({
      json: {
        period_days: 30,
        computed_at: new Date().toISOString(),
        tiles: {
          sent: OK({ value: 100 }),
          click_rate: OK({ rate: 0.038, delta: null }),
          open_rate: OK({ rate: 0.241, machineShare: 0.41 }),
          problems: OK({ bounceRate: 0, complaintRate: 0, level: 'ok' }),
          web_active: OK({ contacts: 34 }),
          recent_campaigns: OK({ items: [] }),
          running: OK({ campaign: null }),
        },
      },
    }),
  );
  await page.goto('/w/demo');
  const clicks = page.getByRole('heading', { name: 'Kliklo' });
  await expect(clicks).toBeVisible();
  await expect(page.getByText(/41 % automatických/)).toBeVisible();
});
```

- [ ] **Krok 6: Spusť testy v prohlížeči**

Run: `pnpm --filter @mlain/web exec playwright test e2e/reports`
Expected: PASS, všech 15 scénářů.

- [ ] **Krok 7: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add apps/web/e2e/reports && git commit -m "test(reports): browser tests for report states, timeline and live updates"
```

---

### Úkol 37: Kompletní série a úklid

- [ ] **Krok 1: Spusť celou sérii**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm lint && pnpm typecheck && pnpm test:unit && pnpm test:db && pnpm --filter @mlain/web exec playwright test e2e/reports
```
Expected: všechno zelené. Padající test se **neobchází**: dohledá se příčina a opraví se, nebo se zapíše jako nález do kapitoly 7, když leží mimo vlastnictví tohohle plánu.

- [ ] **Krok 2: Ověř, že nikde není dlouhá pomlčka**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && ! grep -rP "\x{2014}" packages/core/src/reports packages/i18n/messages/*/reports.json apps/web/src/features/reports apps/web/e2e/reports
```
Expected: exit code 0, tedy žádný nález.

- [ ] **Krok 3: Ověř, že plán nesáhl mimo své vlastnictví**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && git diff --name-only main... | grep -v -E "^(packages/core/src/reports/|packages/i18n/messages/(cs|en)/reports.json|apps/web/src/features/reports/|apps/web/e2e/reports/|apps/web/src/app/\[locale\]/w/\[workspaceSlug\]/(page.tsx|campaigns/\[campaignId\]/report/|contacts/\[contactId\]/timeline/|stats/campaigns/)|packages/core/package.json|apps/web/package.json|apps/web/src/lib/api/app.ts|packages/contracts/openapi.json|pnpm-lock.yaml)"
```
Expected: prázdný výstup. Každý řádek navíc je porušení vlastnictví a musí se vrátit zpět.

- [ ] **Krok 4: Smaž dočasný záznam preflightu**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && rm -f docs/superpowers/plans/p14-preflight.md
```
Expected: soubor zmizí. Nálezy z něj musí být do téhle chvíle přepsané do kapitoly 7 tohohle plánu.

- [ ] **Krok 5: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add -A && git commit -m "chore(reports): full test series green"
```

---

## 7. Požadavky na jiné plány a nálezy

Nic z toho tenhle plán neopravuje sám. Když některý předpoklad neplatí, zapíše se sem a řeší se v plánu, který soubor vlastní.

| # | Komu | Co potřebuju | Co se stane, když to nebude |
|---|---|---|---|
| P14→P10.1 | P10 | Job `tracking.refresh_campaign_progress` musí běžet a plnit `campaign_stats.sent`, `failed`, `progress_watermark_at` a `campaign_stats_buckets` podle 3.9.5 | Průběh odesílání se nikdy nepohne, pruh na reportu i na přehledu zamrzne na nule |
| P14→P10.2 | P10 | **Každý** `UPDATE campaign_stats` musí zvýšit `version` a `updated_at` | `ETag` přestane odpovídat skutečnosti a dotazování bude vracet 304 na změněná data. Poller to sice přežije (otisk v `fingerprint.ts`), ale nahlásí to čítačem `staleVersionTotal()` |
| P14→P10.3 | P10 | Součet `campaign_stats_buckets.sent` se musí rovnat `campaign_stats.sent` | Dlaždice a graf ukazují jiné číslo. Rozdíl pojmenuje `bucketDrift()` z úkolu 14 |
| P14→P10.4 | P10 | Slévání pětiminutových bloků do hodinových (krok 5 v 3.15.2) | Graf u kampaně starší třiceti dnů bude mít desetitisíce bodů |
| P14→P13.1 | P13 | `campaign_stats.materialized` naplněné při materializaci publika (požadavek 12.2.9) | Report neukáže velikost publika a procenta průběhu nepůjdou spočítat |
| P14→P13.2 | P13 | `campaigns.started_at` u každé odeslané kampaně | Přehled ani statistiky nepoznají, do kterého období kampaň patří |
| P14→P13.3 | P13 | Odkaz na záložku Report z detailu kampaně | Report půjde otevřít jen ručně zadanou adresou |
| P14→P07.1 | P07 | Odkaz na `/w/{slug}/contacts/{id}/timeline` z detailu kontaktu | Časová osa bude existovat, ale nikdo ji nenajde |
| P14→P07.2 | P07 | Anonymizace kontaktu nechá řádek `contacts` a vyplní `anonymized_at` | Report nepozná rozdíl mezi smazaným a anonymizovaným člověkem a ukáže obojí stejně |
| P14→P05.1 | P05 | Komponenta K7 s tabulkovou alternativou pod grafem a čitelností bez rozlišení barev | Grafy nesplní kritérium 2 z 8.11.2 a přístupnost |
| P14→P05.2 | P05 | Komponenta K8 se shlukováním, oddělovači dnů v zóně uživatele a bez skoku scrollu | Časová osa nesplní tvrdé požadavky 13.1 |
| P14→P05.3 | P05 | Komponenta K1 s kurzorovým stránkováním bez čísel stránek | Seznam příjemců nesplní kritérium 78 |
| P14→P03.1 | P03 | Sloupec `campaign_stats.rejected bigint NOT NULL DEFAULT 0` | Zpráva, kterou provider odmítl, se v odvozeném jmenovateli počítá jako **doručená**. U kampaně, kterou SES odmítne kvůli suppression listu, ukáže report doručení blízko sta procent a míru prokliku podstřelí. Proklik je hlavní metrika produktu a jmenovatel je právě `deliveredEffective` |
| P14→P03.2 | P03 | Index `idx_campaigns__ws_started ON campaigns (workspace_id, started_at DESC) WHERE deleted_at IS NULL AND started_at IS NOT NULL` | Přehled i statistiky filtrují a řadí podle `started_at` a index nad ním není. V MVP 0 to nikdo nepozná, za rok provozu je to seřazení všech kampaní projektu při každém otevření nejčastější stránky produktu |
| P14→P03.3 | P03 | Rozlišení granularity v `campaign_stats_buckets`, například `granularity text NOT NULL DEFAULT '5m'` v primárním klíči | Po slití pětiminutových bloků do hodinových (job `tracking.enforce_retention` z P10) se v tabulce oba tvary nedají rozlišit. `bucketDrift()` pak hlásí rozdíl pokaždé, když se slévání zastaví v půlce, a graf ukazuje hodinové body pod popiskem „po 5 minutách". Dnes to plán obchází heuristikou podle stáří nejstaršího bodu, což je dohad, ne údaj |
| P14→P10.5 | P10 | Započítat typ `rejected` do agregací, jakmile pro něj bude sloupec | Bez toho zůstane P14→P03.1 neúplný: sloupec by existoval a nikdo by ho neplnil |
| P14→P04.1 | P04 | Autentizační middleware musí do kontextu Hono uložit `auth: { ctx, label }`. **Zároveň sjednotit s P07 a P13, které čtou `c.get('ctx')`** | Endpointy nepůjdou napojit. Adaptér `api/context.ts` je jediné místo k opravě na straně P14, ale rozpor mezi P04 a dvěma doménovými plány musí rozsoudit P04 |
| P14→P04.2 | P04 | Přesunout kodér kurzoru z `apps/web/src/lib/api/pagination.ts` do `packages/core`, aby existoval jednou | Dnes existuje dvakrát, shodu drží společný vektor z 4.3 části 1 |
| P14→P01.1 | P01 | Chybové kódy `tracking_timeline_window_too_large`, `tracking_disabled` a `dependency_timeout` v `PROBLEM_CODES` **(ověřeno, že tam už jsou)** a validační kód `unknown_recipient_filter` ve `VALIDATION_CODES`. Kódy `invalid_cursor` a `cursor_order_mismatch` už žádá P04→P01.1, P14 je jen používá | Endpointy vrátí obecnou chybu bez použitelného kódu, nebo kód, který registr nezná |
| P14→P01.2 | P01 | Proměnná `TRACKING_SSE_MAX_CONNECTIONS` v zod schématu konfigurace | Strop spojení spadne na výchozích 500 bez možnosti nastavení |
| P14→P01.3 | P01 | Vystavení čítače `tracking_sse_connections` a `reports_stats_version_stale_total` na metrikovém endpointu | Provoz neuvidí, že se spojení blíží stropu ani že některý zapisovatel nezvyšuje verzi |
| P14→P16.1 | P16 | Napojení `recomputeCampaignCounts` a `compareWithStored` na CLI (`mlain rebuild-campaign-stats`) | Rekonstrukce po havárii půjde spustit jen z testu |

**Co plán vědomě dělá jinak, než by bylo ideální, a proč to není mezera.**

`campaign_stats` nemá čítač pro `rejected` a P14 do ní nesmí zapsat ani sloupec, ani řádek. Odvozený jmenovatel proto odmítnutou zprávu odečíst neumí. Plán to nezakrývá: `delivered_source` je součástí odpovědi `/stats`, takže je z API poznat, kdy je číslo měřené a kdy dopočítané. Až sloupec vznikne (P14→P03.1 a P14→P10.5), je změna v `deliveredEffective` jednořádková.

Kritérium 79 části 6 („odkaz s neplatným kurzorem zobrazí první stránku stejného filtru a hlášku o tom") je od téhle revize splněné celé: server na vadný kurzor odpoví `validation_failed`, panel načte první stránku a předá K1 příznak `cursorInvalid`, na který komponenta hlášku zobrazí. Text je v katalogu pod `table.cursorInvalid`.

---

## 8. Pořadí provádění

Úkoly jdou po sobě, ale tři skupiny se dají dělat souběžně, když plán provádí víc lidí nebo agentů.

```
1  preflight
2  balíček a testovací zázemí
│
├─ větev A (čistá logika, bez databáze)
│   3 kurzor · 4 míry · 5 tři patra · 6 predikce · 7 zobrazení
│
├─ větev B (databáze, po větvi A)
│   8 souhrn · 9 otisk · 10 bloky · 11 odkazy · 12 příjemci · 13 přepočet
│   14 průběh · 15 pojistka vlastnictví
│   16 typy osy · 17 větve · 18 slévání a věty · 19 orchestrace · 20 výkon
│   21 cache · 22 dlaždice · 23 poller
│
└─ větev C (rozhraní, po větvi B a po úkolu 27)
    24 endpoint souhrnu · 25 endpointy příjemců, osy a přehledu · 26 SSE
    27 katalog textů
    28 klient a adaptéry · 29 živé aktualizace
    30 model reportu · 31 obrazovka reportu · 32 příjemci
    33 časová osa · 34 přehled · 35 statistiky
    36 testy v prohlížeči
37 kompletní série a úklid
```

Úkol 27 (katalog textů) je předpokladem úkolu 25, protože časová osa skládá věty na serveru z téhož katalogu.

---

## 9. Pokrytá akceptační kritéria

### 9.1 Část 5, kapitola 10

| # | Kritérium | Kde je pokryté |
|---|---|---|
| 61 | Rozpad 1000 příjemců na 500, 300 a 200 | úkoly 4 a 5 |
| 62 | Ověřená míra 200 / (1000 − 300) | úkol 4 |
| 63 | CTOR z ověřených otevření | úkol 4 |
| 64 | Report velké kampaně pod 200 ms | úkoly 8 a 20 (čtení podle primárního klíče, `EXPLAIN` bez `Seq Scan`) |
| 65 | Vypnuté měření vrací `null`, ne nulu | úkoly 4, 8, 30, 36 |
| 66 | Pod 200 doručenými příznak `small_sample` | úkoly 4 a 8 |
| 67 | Časová osa 100 000 událostí, první i dvacátá stránka | úkol 20 |
| 68 | Apple otevření má `reliability: machine` | úkoly 17 a 12 |
| 69 | Osa nezobrazí `bot`, `scanner` ani `prefetch` | úkol 17 |
| 70 | Dvojí běh `tracking.process_engagement` nezmění `opens_unique` | **P10.** P14 ho hlídá z druhé strany kontrolou driftu v úkolu 13 |
| 71 až 78 | `contact_engagement` a segmentace | **P10 a P11**, mimo tenhle plán |
| 79, 80 | Testovací odeslání se netrackuje | **P13 a P10** |
| 81 | Průběh bez řádků `sent` v `message_events` | **P10** (job), čtecí strana v úkolu 14 |
| 82 | Dvojí běh jobu nezmění bloky | **P10** (job), kontrola shody v úkolu 14 |
| 83 | Kampaň obnovená po týdnu dorovná průběh | **P10** (job) |
| 84 | Osa obsahuje „dostal kampaň X" i bez události | úkol 17 |
| 93 | Aktualizace do 2,5 s (SSE) nebo 3,5 s (dotazování) | úkoly 23, 26 a 29 |
| 94 | Nad HTTP/1.1 se neotevře SSE | úkoly 29 a 36 |
| 95 | Nad HTTP/2 nejvýš jedno spojení na prohlížeč | úkol 29 (volba vůdce) |
| 96 | Prohlížeč bez `BroadcastChannel` funguje dál | úkol 29 |
| 97 | Sto spojení na kampaň dělá jeden dotaz za interval | úkol 23 |
| 98 | Znovupřipojení obnoví stav bez duplicit | úkoly 26 a 29 (vždy úplný snímek) |
| 99 | Po překročení stropu 503 a přechod na dotazování | úkol 26 |
| 100 | Druhý požadavek bez změny vrátí 304 bez těla | úkol 24 |
| 101 | Po třech neúspěších trvale dotazování | úkol 29 |
| 102 | Report se dá načíst a obnovit i bez živých aktualizací | úkoly 29 a 36 |

### 9.2 Část 6, kapitola 15

| # | Kritérium | Kde je pokryté |
|---|---|---|
| 10 | Po třech neúspěších SSE dotazování po 15 s a informace o tom | úkoly 29 a 31 |
| 19 | Obrazovka reportu má všechny povinné stavy z matice 7.2 | úkoly 31 a 36 |
| 20, 21 | Prázdný stav má vysvětlení i akci, filtrovaný se liší | úkoly 31, 32 a 33 |
| 22 | Chybový stav má kód a `request_id` pod podrobnostmi | úkoly 31 a 36 |
| 24 | Selhání jedné dlaždice přehledu nezhroutí stránku | úkoly 21, 22, 34 a 36 |
| 57 | Report nemá míru otevření jako hlavní metriku | úkoly 30 a 36 |
| 58 | Trvalá poznámka a rozpad na tři skupiny, věta o proklicích | úkoly 30, 31 a 36 |
| 59 | U každého procenta je jmenovatel | úkoly 30, 31 a 36 |
| 60 | Vypnuté sledování ukáže vysvětlení, ne nuly | úkoly 30, 31 a 36 |
| 61 | Osa používá tvary sloves podle rodu | úkoly 18, 27 a 36 |
| 68 | Nikde v katalozích není znak U+2014 | úkoly 27 a 37 |
| 70 | Každý klíč v `cs` má protějšek v `en` | úkol 27 |
| 72 | Počty používají ICU `plural` včetně `=0` | úkol 27 |
| 76 | Neznámý chybový kód zobrazí `detail` ze serveru | úkol 28 (klient) a 31 |
| 78 | Tabulka nezobrazuje čísla stránek, stránkuje kurzorem | úkoly 12, 25 a 32 |
| 79 | Neplatný kurzor zobrazí první stránku stejného filtru | **částečně**, viz známá mezera v kapitole 7 |
| 81, 82 | Grafy nejsou v základním balíku | úkoly 31 a 35 (dynamický import), měří CI job `bundle-budget` |

---

## 10. Soubory, které tenhle plán vlastní

**Balíček `packages/core/src/reports` (celý):**

```
packages/core/src/reports/index.ts, event-types.ts, event-types.db.test.ts,
  cursor.ts, cursor.test.ts, errors.ts, ownership.test.ts
packages/core/src/reports/metrics/counts.ts, rates.ts, rates.test.ts,
  open-breakdown.ts, open-breakdown.test.ts, predicted-opens.ts,
  predicted-opens.test.ts, display.ts, display.test.ts
packages/core/src/reports/campaign-stats/read.ts, read.db.test.ts, fingerprint.ts,
  fingerprint.test.ts, buckets.ts, buckets.db.test.ts, links.ts, links.db.test.ts,
  recipients.ts, recipients.db.test.ts, recompute.ts, recompute.db.test.ts
packages/core/src/reports/progress/read.ts, read.db.test.ts
packages/core/src/reports/timeline/types.ts, months.ts, months.db.test.ts, branches.ts,
  branches.db.test.ts, merge.ts, merge.test.ts, titles.ts, titles.test.ts,
  titles-icu.test.ts, query.ts, query.db.test.ts, query-performance.db.test.ts
packages/core/src/reports/dashboard/cache.ts, cache.test.ts, read.ts, read.db.test.ts
packages/core/src/reports/stream/connections.ts, connections.test.ts, poller.ts, poller.test.ts
packages/core/src/reports/api/index.ts, context.ts, schemas.ts, campaign-stats.routes.ts,
  campaign-stats.routes.db.test.ts, campaign-recipients.routes.ts,
  campaign-stream.routes.ts, campaign-stream.routes.db.test.ts,
  contact-timeline.routes.ts, dashboard.routes.ts, routes.db.test.ts
packages/core/src/reports/test-support/db.ts, db.db.test.ts, fixtures.ts
```

**Katalogy textů:**

```
packages/i18n/messages/cs/reports.json
packages/i18n/messages/en/reports.json
```

**Rozhraní v `apps/web`:**

```
apps/web/src/features/reports/api-client.ts, api-client.test.ts
apps/web/src/features/reports/adapters/report-chart.tsx, report-table.tsx, report-timeline.tsx
apps/web/src/features/reports/live/live-mode.ts, live-mode.test.ts, leader.ts, leader.test.ts,
  live-stats.ts, live-stats.test.ts, use-live-stats.ts
apps/web/src/features/reports/report/report-model.ts, report-model.test.ts, report-banner.ts,
  campaign-report.tsx, headline-tiles.tsx, opens-panel.tsx, problems-panel.tsx,
  links-table.tsx, progress-chart.tsx, diagnostics-panel.tsx, follow-up-actions.tsx
apps/web/src/features/reports/recipients/recipients-filter.ts, recipients-filter.test.ts,
  recipients-panel.tsx
apps/web/src/features/reports/timeline/group-sessions.ts, group-sessions.test.ts,
  contact-timeline.tsx
apps/web/src/features/reports/dashboard/dashboard-slots.ts, dashboard-slots.test.ts,
  dashboard-grid.tsx
apps/web/src/features/reports/stats/trend-series.ts, trend-series.test.ts, campaign-trend.tsx
apps/web/src/app/[locale]/w/[workspaceSlug]/page.tsx
apps/web/src/app/[locale]/w/[workspaceSlug]/campaigns/[campaignId]/report/page.tsx
apps/web/src/app/[locale]/w/[workspaceSlug]/contacts/[contactId]/timeline/page.tsx
apps/web/src/app/[locale]/w/[workspaceSlug]/stats/campaigns/page.tsx
apps/web/e2e/reports/fixtures.ts, report.spec.ts, report-states.spec.ts,
  live-updates.spec.ts, timeline.spec.ts, dashboard.spec.ts
```

**Mimo tyhle soubory tenhle plán nesahá.** Jmenovitě nesahá na:

- **`packages/db` a databázové schéma**, migrace, RLS politiky, indexy ani partitioning. Vlastní je **P03**. Tenhle plán tabulky jen čte a žádnou `drizzle-kit generate` nespouští.
- **Sběr událostí**: `packages/core/src/tracking`, `packages/sdk-web`, trackovací endpointy `/t/**` a `/e/**`, joby `tracking.process_engagement`, `event.process`, `identity.merge`, `tracking.enforce_retention`, `tracking.recompute_engagement_windows`, `tracking.cleanup_token_uses` a **`tracking.refresh_campaign_progress`**. Vlastní je **P10**, které je zároveň **jediný zapisovatel do `campaign_stats`, `campaign_stats_buckets`, `campaign_link_stats`, `message_engagement` a `contact_engagement`**. Hlídá to test `packages/core/src/reports/ownership.test.ts`.
- **Kampaně**: `packages/core/src/campaigns`, `packages/core/src/providers`, materializace publika, ovládání kampaně a obrazovky kampaní kromě záložky Report. Vlastní je **P13**.
- **Komponenty a design systém**: `packages/ui` celý, včetně K1, K7 a K8, i18n infrastruktura, registr navigace, skořápka a `playwright.config.ts`. Vlastní je **P05**. P14 komponenty jen používá přes tři adaptéry.

**Tři úzké výjimky**, každá vypsaná v kapitole 0.4: dva řádky v `apps/web/src/lib/api/app.ts` (mount cest), položky v `dependencies` v `packages/core/package.json` a `apps/web/package.json`. `packages/contracts/openapi.json` je generovaný artefakt, který se při konfliktu nikdy neslučuje ručně, ale přegeneruje.

---

## 11. Sebekontrola plánu

Provedeno proti zdrojům z kapitoly 0.1 po dopsání plánu.

**Pokrytí zadání.** Všech pět bodů zadání P14 má úkoly: agregace a jejich přepočet (úkoly 4 až 14), pět endpointů (24 až 26), obrazovky reportu, přehledu a statistik (30 až 35), naplnění časové osy (16 až 19 a 33), namespace `reports` (27).

**Rozhodnutí zadavatele.** Proklik je hlavní metrika v reportu i na přehledu, a to velikostí dlaždice, ne jen pořadím (úkoly 30 a 34). Přepínač automatických otevření má výchozí polohu „odečteno" a druhá poloha je viditelně označená (úkol 30). Prediktivní otevření je rozsah se slovem odhad (úkoly 6 a 30). Události se drží 37 měsíců, což je konfigurace P01, a čtecí vrstva na retenci nezávisí, s jedinou výjimkou horní meze `received_at` u událostí zprávy (R21). Smazaný ani anonymizovaný kontakt report neshodí (úkoly 12 a 32). Konverze a tržby se nedělají, `campaign_conversion_stats` se nezakládá.

**Tři místa, kde jsem musel jít proti liteře zdroje, a proč.** Pořadí hlavních dlaždic reportu (R5), typ `status` v odpovědi (R9) a nullable `email` v `RecipientItem` (R10). U každého je v kapitole 1 zapsaný důvod včetně toho, který zdroj si odporoval.

**Co změnila revize proti dodavatelům.** Šest tříd chyb, které by prošly typovou kontrolou i revizí a projevily se až za běhu, nebo vůbec:

| Co | Kde to bylo | Jak to teď hlídá mechanismus |
|---|---|---|
| Slovník typů `message_events` používal `bounce` a `complaint`, které v `ck_message_events__type` nejsou. Filtr by nevracel nic a nic by nespadlo | úkoly 12, 13, 17 | jediná konstanta `EVENT_TYPES` (R19) a katalogový test, který ji porovnává s omezením v **běžící databázi**, ne se zdrojáky P03 |
| Doména ležela mimo `packages/core/src/`, takže by se její testy vůbec nespustily a série by prošla zeleně | celý plán | úkol 2, krok 7: `vitest list` musí najít aspoň jeden soubor pod `src/reports/` |
| `withWorkspaceId` a kořenový `schema` z `@mlain/db` neexistují; obálky P03 berou `pool` a pool doplňuje adaptér P04 | E1, E2, `api/context.ts` | preflight importuje skutečné symboly a vypíše, co chybí |
| Props komponent K1, K7 a K8 se neshodovaly s tím, co P05 dodal, a importovalo se na úroveň souboru | úkol 28 | úkol 28, krok 4b: typová kontrola plus skript, který import na úroveň souboru najde |
| Holé pole v šabloně `sql` Drizzle rozloží na jednotlivé parametry, takže `= ANY($1, $2)` spadne při prvním použití | seznam příjemců, časová osa | všechna pole jdou přes `sql.param(...)` s přetypováním |
| Kurzor seznamu příjemců řadil podle `messages.id`, na což index není | úkol 12 | R20 plus test s `EXPLAIN`, který hledá jméno indexu a zakazuje `Sort` |

**Co po revizi zbývá dořešit.** Nic na straně tohohle plánu. Dvaadvacet požadavků na jiné plány je v kapitole 7 a žádný z nich P14 neopravuje sám; sedm nálezů, které se týkají cizích plánů, je v `NALEZY-NAPRIC-PLANY.md` jako N65 až N71. Jediné vědomé omezení je chybějící čítač `campaign_stats.rejected`, popsané v kapitole 7 včetně toho, proč se dnes neprojeví jako tichá chyba.

