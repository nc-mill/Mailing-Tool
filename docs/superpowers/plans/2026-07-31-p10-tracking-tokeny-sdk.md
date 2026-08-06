# P10 Tracking: podepsané tokeny, sběr událostí a web SDK

<!-- puvod-dokumentu -->
> **Historický záznam, ne platné zadání.** Implementační plán P10 (tracking, tokeny a web SDK) z 31. 7. 2026, sepsaný před
> začátkem stavby. Zachycuje, co se tehdy plánovalo, ne dnešní podobu kódu.
> **Postaveno:** `packages/core/src/tracking` i `packages/sdk-web` existují; měření z Gmailu na vývojové instalaci nefunguje z principu, běží na localhostu.
> **Zaškrtávátka nikdo neodškrtával**, prázdné políčko tady tedy neznamená nedodělek.
> **Dnešní stav:** `docs/superpowers/STAV-UKOLU.md` (živý dokument), design `docs/superpowers/DESIGN-INTEGRACE.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Postavit celou měřicí vrstvu produktu Mlain Mailer: ověřování podepsaných trackovacích tokenů, endpointy pro otevření a proklik, příjem událostí z prohlížeče i ze serveru, web SDK, propojení kliku v mailu s chováním na webu a joby, které z událostí skládají stav pro reporty a časovou osu.

**Architecture:** Doménová logika žije v `packages/core/tracking` bez HTTP. Veřejné povrchy `/t/**` a `/e/**` jsou dva Hono catch-all route handlery v `apps/web`, autentizované výhradně podepsaným tokenem nebo veřejným klíčem. Horké cesty (pixel, redirect) nesahají do databáze: čtou z paměťových cache a zapisují do bufferu, který se vyprazdňuje po 250 ms. Všechno ostatní běží asynchronně v pg-boss jobech. Web SDK je samostatný balíček `packages/sdk-web` bez jediné runtime závislosti, buildovaný esbuildem do IIFE pod 5 kB gzip.

**Tech Stack:** TypeScript 7.0.2 (fallback 5.9.3), Node.js 24.18.1, Next.js 16 App Router, Hono 4.12.33, zod 4.4.3, pg-boss 12.26.3, Drizzle přes `@mlain/db`, Vitest 4.1.10, testcontainers 12.0.4, esbuild (z buildu části 1), PostgreSQL 18.

---

## 0. Než začneš

### 0.1 Co si přečti

| Dokument | Kapitoly | Proč |
|---|---|---|
| `docs/superpowers/specs/parts/05-tracking.md` | 2, 3.1 až 3.10, 3.14 až 3.16, 4, 6, 8, 9, 10 | Zadání tohoto plánu |
| `docs/superpowers/specs/parts/01-platforma.md` | **4.10.3** (zmrazený kontrakt tokenů), 2.1, 3.10, 3.5, 4.1 až 4.5, 6, 9.1 | Kontrakty a konvence, které nevlastníš |
| `docs/superpowers/plans/2026-07-31-rozdeleni-implementacnich-planu.md` | 2, 5 | Kdo vlastní které soubory |

### 0.2 Tři věci, které nesmíš změnit

1. **Bajtový formát tokenů** je zmrazený v části 1, kapitola 4.10.3. Vyrábí je Go sender, ověřuje je tenhle plán. Když změníš jediný bajt, rozejdou se implementace a projeví se to až u příjemce v jeho schránce. Tento plán formát **jen konzumuje** a testuje proti fixtures, které vlastní P02.
2. **Databázové schéma** vlastní P03. Tenhle plán tabulky nezakládá, nemigruje a nemění. Když ti chybí sloupec, je to nález pro P03, ne důvod napsat migraci.
3. **Registr chybových kódů, registr front pg-boss a zod schéma konfigurace** vlastní P01 a jsou předdeklarované dopředu. Ty je používáš, nezakládáš.

### 0.3 Co tenhle plán vědomě nedělá

Reporty, dashboard, agregační čtecí endpointy (`/api/v1/campaigns/{id}/stats`, `/recipients`, `/stream`), časová osa jako čtecí API (`/api/v1/contacts/{id}/timeline`) a SSE. To všechno je plán **P14**. Tenhle plán dodává **data**, ze kterých P14 čte: řádky v `web_events`, `message_engagement`, `contact_engagement`, `campaign_stats`, `campaign_stats_buckets` a `campaign_link_stats`.

Konverze a tržby se v MVP 0 nepočítají. Připravuje se jen cesta: jména událostí a tvar `properties` jsou validované tak, aby `order_completed` s `value` a `currency` prošlo a uložilo se, ale žádná agregace nad tím nevzniká a žádná tabulka konverzí se nezakládá.

**GIN index nad `properties` se v MVP 0 nezakládá a tenhle plán ho nesmí vyžádat.** GIN nad jsonb u tabulky s desítkami milionů řádků výrazně zpomaluje zápis a zvětšuje tabulku o desítky procent, a v MVP 0 žádný dotaz nad `properties` nefiltruje. Praktický důsledek pro každý úkol níž: **žádný dotaz této domény nesmí filtrovat podle obsahu `properties`.** Kdyby ses při psaní takového dotazu přistihl, je to buď chyba v návrhu, nebo požadavek na segmentaci nad vlastnostmi událostí, což je MVP 2 a znamená to samostatné rozhodnutí o indexu (`GIN (properties jsonb_path_ops)` jen na aktivních oddílech), ne tichý `CREATE INDEX`.

---

## 1. Struktura souborů

### 1.1 `packages/core/tracking` (doménová logika, bez HTTP)

| Soubor | Odpovědnost |
|---|---|
| `packages/core/tracking/index.ts` | Veřejný povrch domény pro ostatní balíčky (`verifyTrackingToken`, hooky, typy) |
| `packages/core/tracking/types.ts` | `OpenClass`, `ClickClass`, `EventPage`, `EventContext`, `TrackingTokenPayload` a spol. |
| `packages/core/tracking/settings.ts` | Zod schéma jmenného prostoru `tracking` ve `workspaces.settings` |
| `packages/core/tracking/config.ts` | Typovaný pohled na trackingové proměnné z `@mlain/core/config` |
| `packages/core/tracking/metrics.ts` | Čítače a histogramy s prefixem `tracking_` |
| `packages/core/tracking/audit.ts` | Jména auditních akcí této domény |
| `packages/core/tracking/tokens/keyring.ts` | Obal nad `parseKeyring` a `deriveKey` z `@mlain/contracts/keyring`, **HKDF si nepíše** |
| `packages/core/tracking/tokens/codec.ts` | Překlad jmen a tvarů polí mezi `@mlain/contracts/token` a doménou, **na bajty nesahá** |
| `packages/core/tracking/tokens/verify.ts` | `verifyTrackingToken(token, allowedTypes)` v normativním pořadí kroků |
| `packages/core/tracking/tokens/mint.ts` | `mintIdentityToken()` |
| `packages/core/tracking/tokens/message-lookup.ts` | Dohledání zprávy z tokenu podle obou složek klíče |
| `packages/core/tracking/open/gif.ts` | 42bajtový GIF jako konstanta |
| `packages/core/tracking/open/ua-rules.ts` | Regulární výrazy pro klasifikaci `User-Agent` |
| `packages/core/tracking/open/proxy-ranges.ts` | CIDR strom rozsahů obrazových proxy |
| `packages/core/tracking/open/classify-open.ts` | Jedenáct pravidel klasifikace otevření |
| `packages/core/tracking/open/handle-open.ts` | Zpracování požadavku na pixel bez HTTP vrstvy |
| `packages/core/tracking/click/lru.ts` | Vlastní LRU cache se single flight |
| `packages/core/tracking/click/link-cache.ts` | Cache `campaign_links`, plněná po kampaních |
| `packages/core/tracking/click/classify-click.ts` | Pravidla 1 až 4 a 7 (horká cesta) a pravidla 5 a 6 (asynchronně) |
| `packages/core/tracking/click/append-query.ts` | Přidání `ml_token` do cílové adresy |
| `packages/core/tracking/click/handle-click.ts` | Zpracování kliku bez HTTP vrstvy |
| `packages/core/tracking/domains/domain-cache.ts` | Mapa `tracking_domains` v paměti, obnova po 60 s |
| `packages/core/tracking/domains/service.ts` | Přidání, seznam a odebrání domény |
| `packages/core/tracking/ingest/schema.ts` | Zod schémata `IngestBatch` a `IngestEvent`, verze payloadu `v` |
| `packages/core/tracking/ingest/sanitize-url.ts` | Čištění `page.url`, `referrer`, `search` |
| `packages/core/tracking/ingest/sanitize-properties.ts` | Ořez klíčů, hloubky a délek se `findings` |
| `packages/core/tracking/ingest/clock-skew.ts` | Korekce hodin klienta |
| `packages/core/tracking/ingest/public-key.ts` | Ověření veřejného klíče `ml_pub_` a mapování na workspace |
| `packages/core/tracking/ingest/ingest-service.ts` | Živá cesta: validace, `findings`, zařazení jobu |
| `packages/core/tracking/ingest/import-service.ts` | Dávkový import historie, vyňatý ze sedmidenního okna |
| `packages/core/tracking/identity/jcs.ts` | Kanonizace JSON podle RFC 8785 |
| `packages/core/tracking/identity/signature.ts` | Ověření podpisu u `identify` |
| `packages/core/tracking/identity/bind.ts` | Algoritmus `bind()` včetně kroku 0 (GDPR čl. 18) |
| `packages/core/tracking/identity/merge.ts` | Slučování historie a jeho vrácení |
| `packages/core/tracking/identity/consume-token.ts` | Spotřebování `ml_token` |
| `packages/core/tracking/identity/service.ts` | Seznam zařízení kontaktu a jejich odpojení |
| `packages/core/tracking/privacy/ip.ts` | Maskování IP pro log, volitelné uložení IP a země |
| `packages/core/tracking/privacy/geoip.ts` | Volitelné načtení GeoIP databáze |
| `packages/core/tracking/privacy/erase.ts` | Hooky `erase_contact`, `reassign_contact`, `export_contact` |
| `packages/core/tracking/writer/event-buffer.ts` | Buffer otevření a prokliků, vyprazdňování po 250 ms |
| `packages/core/tracking/writer/flush.ts` | Zápis dávky z bufferu do `message_events` a zařazení navazujícího jobu |
| `packages/core/tracking/repo/web-events.repo.ts` | Zápis a čtení `web_events` a `web_event_months` |
| `packages/core/tracking/repo/message-events.repo.ts` | Zápis `message_events` typů `open` a `click` |
| `packages/core/tracking/repo/engagement.repo.ts` | `message_engagement`, `campaign_stats`, `campaign_link_stats`, bloky |
| `packages/core/tracking/repo/contact-engagement.repo.ts` | Rollup na kontakt pro segmentaci a presety čištění |
| `packages/core/tracking/repo/identities.repo.ts` | `identities`, `identity_bindings`, `identity_merges`, `identity_token_uses` |
| `packages/core/tracking/repo/tracking-domains.repo.ts` | `tracking_domains` |
| `packages/core/tracking/repo/messages.repo.ts` | Čtení `messages` a `campaign_links` (jen `SELECT`) |
| `packages/core/tracking/jobs/event-process.ts` | Job `event.process` |
| `packages/core/tracking/jobs/process-engagement.ts` | Job `tracking.process_engagement` |
| `packages/core/tracking/jobs/process-provider-events.ts` | Job `tracking.process_provider_events` |
| `packages/core/tracking/jobs/identity-merge.ts` | Job `identity.merge` |
| `packages/core/tracking/jobs/recompute-windows.ts` | Job `tracking.recompute_engagement_windows` |
| `packages/core/tracking/jobs/refresh-campaign-progress.ts` | Job `tracking.refresh_campaign_progress` |
| `packages/core/tracking/jobs/cleanup-token-uses.ts` | Job `tracking.cleanup_token_uses` |
| `packages/core/tracking/jobs/enforce-retention.ts` | Job `tracking.enforce_retention` |
| `packages/core/tracking/jobs/refresh-proxy-ranges.ts` | Job `tracking.refresh_proxy_ranges` |
| `packages/core/tracking/jobs/rebuild-engagement.ts` | Přepočet `contact_engagement` od nuly |
| `packages/core/tracking/jobs/index.ts` | Registrace všech handlerů této domény do pg-boss |
| `packages/core/tracking/api/tracking-domains.routes.ts` | Hono podaplikace pro `/api/v1/tracking/domains` |
| `packages/core/tracking/api/events.routes.ts` | Hono podaplikace pro `/api/v1/events` a `/api/v1/events/import` |
| `packages/core/tracking/api/identities.routes.ts` | Hono podaplikace pro identity kontaktu a vrácení sloučení |
| `packages/core/tracking/api/public-tracking.routes.ts` | Hono podaplikace pro celý povrch `/t/**` |
| `packages/core/tracking/api/public-events.routes.ts` | Hono podaplikace pro celý povrch `/e/**` |
| `packages/core/tracking/api/serve-sdk.ts` | Servírování `ml.js` s `ETag` podle verze instance |

**Dvě věci k té tabulce, které nejsou kosmetické.**

**Bajtový layout tokenu nepatří sem.** TypeScriptová implementace zmrazeného kontraktu 4.10.3 leží v `packages/contracts/src/token.ts` a vlastní ji P02. Kdyby sis layout přepsal znovu, máš dvě implementace téhož a golden fixtures ti to neodhalí, protože každá projde svým vlastním testem.

Kontrakt to vynucuje i technicky: `@mlain/contracts/token` vystavuje jen `buildToken`, `verifyToken`, `PAYLOAD_BYTES`, `TOKEN_PREFIX`, `TOKEN_MAC_INPUT_PREFIX`, `TOKEN_MAC_BYTES`, `GLOBAL_LIST_ID`, `TokenType`, `TokenFields`, `TokenError` a `TokenErrorCode`. Skládání a rozebírání payloadu je uvnitř **privátní**, takže mimo P02 neexistuje nic, čím by šlo bajty poskládat jinak. `tokens/codec.ts` proto překládá jen jména polí (kontrakt má snake_case, doména camelCase) a tvar `nonce` (kontrakt hex, doména osm bajtů).

Totéž platí o klíčích: `@mlain/contracts/keyring` vlastní rozklad `SECRET_KEY` i HKDF a `tokens/keyring.ts` je jen propouští dál. Dělicí čára je: **P02 vlastní bajty, MAC a odvození klíče, P10 vlastní vazbu typu na endpoint, expiraci, jednorázovost a tvar výsledku** (hodnota místo výjimky, protože pixel na neplatný token odpovídá GIFem, ne chybou).

**Přístup k databázi jde přes `@mlain/core/tx`, ne přes `@mlain/db`.** Transakční vrstvu dodává **P04** jediným adaptérem `packages/core/tx/index.ts` a je to jediné místo v monorepu, které zná tvar obálek z `@mlain/db`. P04 to hlídá testem, který spadne nad každým importem transakční obálky z `@mlain/db` mimo ten adaptér, takže si tenhle plán vlastní obálku nepíše a na P03 nečeká.

Tři věci z toho adaptéru, které platí pro **každý** dotaz v tomhle plánu:

**1. `sql` se importuje z `drizzle-orm`, ne z `@mlain/db`.** Konvence 3.6 části 1 zakazuje import databázového **klienta** mimo `packages/db`, ne značkovací šablony. `@mlain/db` `sql` neexportuje a exportovat nemá proč. Import je tedy `import { sql } from 'drizzle-orm';`, stejně jako v celém `packages/core` u P04.

**2. `tx.execute()` vrací `QueryResult` z `pg`, ne pole řádků.** Řádky leží v `.rows`, `result[0]` je `undefined` a `result.map` neexistuje. Ověřeno spuštěním proti PostgreSQL 18.4 s `drizzle-orm` 0.44.7 a `pg` 8.22.0: `Array.isArray(result)` je `false`, `Object.keys(result)` vrací `command, rowCount, oid, rows, fields, ...`. Závazný tvar je proto **`const { rows } = await tx.execute<Row>(sql\`...\`)`**.

To není kosmetika. `const rows = await tx.execute(...); return rows[0] ?? null` **vždycky vrátí `null`**, projde typovou kontrolou i revizí a nespadne. U `lookupMessage` by to znamenalo, že se nedohledá jediná zpráva a **každé otevření i každý proklik se tiše zahodí**. `rows.map(...)` naopak spadne za běhu na `rows.map is not a function`. Přetypování `as unknown as Row[]` je tatáž vada schovaná před překladačem a v tomhle plánu se nesmí objevit ani jednou.

**3. Kód chyby z databáze je na `error.cause.code`, ne na `error.code`.** Drizzle balí chyby ovladače do `DrizzleQueryError`. Čte se výhradně přes `pgErrorCode(error)` z `@mlain/core/tx`, který řetěz `cause` projde. Kdo testuje `error.code` přímo, testuje `undefined` a jeho větev se nikdy neprovede.

**Který obal si vzít.** Adaptér nabízí `withWorkspace(ctx, fn)`, `withUser(userId, fn)`, `withReadOnly(ctx, timeoutMs, fn)` a `withoutWorkspace(fn)`. Tenhle plán používá dva:

| Případ | Obal | Proč |
|---|---|---|
| Workspace je znám (z podepsaného tokenu, z veřejného klíče, z payloadu jobu) | `withWorkspace(createSystemContext(workspaceId, job), fn)` | Obálka nastaví `mlain.workspace_id`, takže RLS platí i pro tuhle doménu. Továrnu `createSystemContext` dodává P04 |
| Workspace se teprve zjišťuje, nebo se pracuje napříč projekty | `withoutWorkspace(fn)` | `BEGIN` bez jakéhokoli `set_config` |

**Druhý řádek té tabulky je dnes nefunkční a je to nález na P03.** `withoutWorkspace` kontext nenastavuje, takže `current_setting('mlain.workspace_id', true)` je `NULL` a politika `ws_isolation` pustí **nula řádků, aniž by vrátila chybu**. P03 má dnes jen `sender_bypass` pro `mlain_sender` a `maintenance_bypass` na `web_events` pro `mlain_maintenance`; obecný mechanismus pro systémové joby v něm není. Bez něj by veřejný klíč nešel dohledat vůbec a retenční i přepočtové joby by tiše zpracovaly nula řádků. Požadavek je zapsaný v sekci 2 a v evidenci nálezů; **jednotlivé úkoly ho neobcházejí** a všechny cross-workspace dotazy jsou vyjmenované na jednom místě, aby šlo po dodání mechanismu projít jen je.

Schéma se pořád bere z `@mlain/db/schema`, tabulky tenhle plán nezakládá ani nemění.

### 1.2 `packages/sdk-web` (skript do prohlížeče)

| Soubor | Odpovědnost |
|---|---|
| `packages/sdk-web/package.json` | Balíček `@mlain/sdk-web`, nula runtime závislostí |
| `packages/sdk-web/tsconfig.json` | ES2019, `lib: ["ES2019", "DOM"]` |
| `packages/sdk-web/build.mjs` | Build IIFE i ESM přes esbuild, kontrola velikosti gzip |
| `packages/sdk-web/src/index.ts` | Vstupní bod, fronta `Mlain.q`, veřejné API |
| `packages/sdk-web/src/uuid.ts` | UUIDv4 a UUIDv7 bez závislostí |
| `packages/sdk-web/src/storage.ts` | `ml_aid`, `ml_sid`, `ml_last`, `ml_q` |
| `packages/sdk-web/src/consent.ts` | Souhlas jako vstupní podmínka |
| `packages/sdk-web/src/session.ts` | Session, timeout, `session_started` |
| `packages/sdk-web/src/queue.ts` | Dávkování, `sendBeacon`, offline fronta, backoff |
| `packages/sdk-web/src/page.ts` | `page_view`, automatické sledování historie |
| `packages/sdk-web/src/ml-token.ts` | Přečtení `ml_token`, `replaceState`, `POST /e/identify` |
| `packages/sdk-web/src/emitter.ts` | `on('ready' | 'identified' | 'error' | 'blocked')` |
| `packages/sdk-web/test/*.test.ts` | Testy proti `happy-dom` |

### 1.3 `apps/web` (jen route handlery, žádná logika)

| Soubor | Odpovědnost |
|---|---|
| `apps/web/src/app/t/[[...path]]/route.ts` | Mount Hono podaplikace `/t/**` |
| `apps/web/src/app/e/[[...path]]/route.ts` | Mount Hono podaplikace `/e/**` |
| `apps/web/src/app/t/expired/page.tsx` | Statická stránka pro neplatný odkaz |
| `apps/web/src/lib/tracking-runtime.ts` | Jediné místo s živými instancemi keyringu, cache a bufferu |
| `apps/web/src/lib/tracking-rate-limit.ts` | Limity pro `/t/**` a `/e/**` včetně výjimky bez 429 |

### 1.4 i18n

| Soubor | Odpovědnost |
|---|---|
| `packages/i18n/messages/cs/tracking.json` | Český katalog jmenného prostoru `tracking` |
| `packages/i18n/messages/en/tracking.json` | Anglický katalog |

---

## 2. Integrační body v cizích souborech

Tenhle plán do cizích souborů **nesahá**. Potřebuje ale, aby v nich existovaly konkrétní řádky. Každý z nich je požadavek na vlastníka, ne úkol pro tebe. Když některý chybí, je to nález a zapíše se do `docs/superpowers/plans/P10-BLOCKED.md`, ne obchází.

| Co | Vlastník | Přesné znění |
|---|---|---|
| Mount Hono podaplikací do kořenového routeru `/api/v1/**` | P04, `apps/web/src/app/api/v1/[[...route]]/route.ts` | `app.route('/tracking/domains', trackingDomainsRoutes)`, `app.route('/events', eventsRoutes)`, `app.route('/contacts', trackingIdentitiesRoutes)` |
| Registrace chybových kódů z kapitoly 4.4 části 5 | P01, `packages/core/errors/registry.ts` | Patnáct kódů, viz sekce 3.2 tohoto plánu |
| Registrace front | P01, registr front pg-boss | `event.process`, `identity.merge`, `tracking.process_engagement`, `tracking.process_provider_events`, `tracking.recompute_engagement_windows`, `tracking.refresh_campaign_progress`, `tracking.cleanup_token_uses`, `tracking.enforce_retention`, `tracking.refresh_proxy_ranges`, `tracking.rebuild_engagement` |
| Registrace handlerů ve workeru | P01, `apps/worker/src/main.ts` | `registerTrackingJobs(boss)` z `@mlain/core/tracking/jobs` |
| Konfigurační proměnné | P01, zod schéma v `packages/core/config` | Tabulka v sekci 3.1 tohoto plánu |
| Vyloučení `/t/**` a `/e/**` ze session, CSRF a kontroly `Origin` proti `APP_URL` | P05, `apps/web/src/proxy.ts` | Matcher, který tyhle dva povrchy nechytá |
| Schéma a migrace všech tabulek této části | P03, `packages/db` | Kapitola 2 části 5 |
| `message_events.rank` jako **generovaný sloupec** odvozený z `type` | P03 | Dnes `smallint NOT NULL` bez výchozí hodnoty. Je to čistá funkce typu události, takže ji nemá plnit zapisovatel: každý by si škálu napsal jinak a report by míchal dvě stupnice. Zápisy této domény hodnotu **nevkládají** |
| `message_events.recipient` **nepovinný** s podmíněným omezením | P03 | Dnes `text NOT NULL` bez výchozí hodnoty. U otevření a prokliků je to zbytečná kopie osobního údaje na každém řádku desetimilionové tabulky, kterou pak musí výmaz podle GDPR procházet. Povinnost patří jen doručovacím událostem (`sent`, `rejected`, `delivered`, `delivery_delayed`, `bounced_*`, `complained`), které zapisuje sender. Index `idx_message_events__recipient_bounce` je částečný právě přes ně, takže o nic nepřijde |
| `GRANT UPDATE (contact_id, identity_merge_id, erased_at, properties, context) ON web_events TO mlain_app` | P03 | Dnešní grant `properties` ani `context` neobsahuje, ale hook `tracking.erase_contact` je jediná cesta, jak z uložených událostí odstranit PII a IP adresu. Bez rozšíření skončí celá funkce na `42501` a výmaz podle čl. 17 neproběhne vůbec. Plný `GRANT UPDATE` je zakázaný: kontrolní test v Tasku 47 ověřuje, že `UPDATE web_events SET name` na oprávnění padá |
| `GRANT UPDATE (contact_id, erased_at, recipient, processed_at) ON message_events TO mlain_app` | P03 a P13 | Sloupec `processed_at timestamptz NULL` je značka idempotence pro `tracking.process_provider_events`. Sloupec bez grantu se stejně nepřepíše a job by při každém běhu zpracoval tytéž události znovu, takže `campaign_stats.delivered` by rostlo donekonečna. Náhradní řešení je vlastní tabulka `tracking_processed_events`, kterou by pak vlastnil tenhle plán |
| Šest indexů pro retenci a výmaz | P03 | `identities (last_seen) WHERE contact_id IS NULL`; `identity_bindings (created_at)`; `identity_bindings (workspace_id, contact_id)`; `identity_merges (created_at) WHERE status = 'completed'`; `campaign_stats_buckets (bucket_at)`; `message_engagement (workspace_id, contact_id)` **bez** částečné podmínky `first_open_at IS NOT NULL`. Bez posledního projde výmaz kontaktu, který nikdy nic neotevřel, sekvenčně všech 37 oddílů |
| Mechanismus systémového přístupu napříč projekty | P03 | Politika `system_bypass` pro novou roli, nebo `OR current_setting('mlain.system', true) = 'on'` v `ws_isolation`. Musí pokrýt `api_keys`, `workspaces`, `tracking_domains`, `identities`, `identity_bindings`, `identity_merges`, `identity_token_uses`, `contact_engagement`, `message_engagement`, `message_events`, `campaigns`, `messages`, `campaign_stats` a `campaign_stats_buckets`. Vzor už v P03 existuje pro `sender_bypass` a `maintenance_bypass`. **Bez něj vrací `withoutWorkspace` nula řádků a nevrací chybu**, viz 1.1 |
| Sloupec `identities.shared boolean NOT NULL DEFAULT false` | P03 | DDL v 2.4 části 5 ho nemá, ale 3.8.3 krok 5 předepisuje označení sdíleného zařízení. Bez sloupce se příznak nemá kam uložit a slučování by se u sdíleného počítače nezastavilo |
| Transakční vrstva `@mlain/core/tx` | **P04**, `packages/core/tx/index.ts` | `withWorkspace(ctx, fn)`, `withoutWorkspace(fn)`, `pgErrorCode(error)` a typ `Tx` jako Drizzle handle. **Hotové, tenhle plán na P03 nečeká** |
| Továrna `createSystemContext(workspaceId, job)` | P04, `packages/core/identity` | Vrátí `WorkspaceContext` s `actor: { type: 'system', job }`. Potřebují ji trackovací endpointy a joby, kde workspace pochází z podepsaného tokenu nebo z payloadu jobu, ne ze session |
| Zařazení repository modulů této domény do generického testu izolace | P03, `packages/db/test/isolation.matrix.test.ts` | Registrace modulu znamená automatické pokrytí |
| Scope `events:import` do výčtu oprávnění | P04 | Vedle `events:write`, viz požadavek 12.5.20 části 5 |
| Fixture `token/vectors.json` | P02, `packages/contracts/fixtures` | Kapitola 4.10.3 části 1. Čte se přes exportní mapu jako `@mlain/contracts/fixtures/token/vectors.json`. Vektor podpisu `identify` **od P02 nechceme**, viz Task 28, Step 6 |
| Povrch `@mlain/contracts/token` | P02, `packages/contracts/src/token.ts` | `buildToken`, `verifyToken`, `PAYLOAD_BYTES`, `TOKEN_PREFIX`, `TOKEN_MAC_INPUT_PREFIX`, `TOKEN_MAC_BYTES`, `GLOBAL_LIST_ID`, `TokenError` |
| Povrch `@mlain/contracts/keyring` | P02, `packages/contracts/src/keyring.ts` | `parseKeyring`, `deriveKey`, `KEY_PURPOSES`, typ `Keyring` |
| Volání hooků `tracking.erase_contact` a `tracking.reassign_contact` | P07 | Z jobu `gdpr.sever_links` a ze slučování kontaktů |
| Zápis `message_events` typu `unsubscribe` | P07 | Aby šlo spočítat `campaign_stats.unsubscribed` |
| Job `tracking.process_provider_events` zařadit po zápisu událostí providera | P13 | S polem ID zapsaných událostí |

---

## 3. Registry, které tenhle plán jen naplňuje

### 3.1 Konfigurační proměnné (vlastní P01)

| Proměnná | Typ | Výchozí | Validace |
|---|---|---|---|
| `TRACKING_IDENTITY_TOKEN_TTL_SECONDS` | int | `900` | 60 až 3600 |
| `TRACKING_MERGE_WINDOW_DAYS` | int | `30` | 1 až 365 |
| `TRACKING_MERGE_MAX_EVENTS` | int | `10000` | 100 až 1000000 |
| `TRACKING_RETENTION_MONTHS` | int | `37` | 3 až 120 |
| `TRACKING_APPLE_RELAY_RANGES` | bool | `false` | |
| `TRACKING_ALLOW_IP_STORAGE` | bool | `false` | Instalační pojistka nad projektovým nastavením |
| `TRACKING_STORE_COUNTRY` | bool | `false` | Když `true`, musí existovat GeoIP databáze |
| `TRACKING_GEOIP_DB_PATH` | cesta | prázdné | Soubor musí existovat, když `TRACKING_STORE_COUNTRY=true` |
| `TRACKING_STRIP_QUERY_PARAMS` | seznam | viz 3.7.3.1 části 5 | Jen rozšiřuje výchozí sadu |
| `TRACKING_PII_PROPERTY_KEYS` | seznam | viz 3.15.3 části 5 | Jen rozšiřuje |
| `TRACKING_WRITER_FLUSH_MS` | int | `250` | 50 až 5000 |
| `TRACKING_WRITER_BATCH` | int | `500` | 50 až 5000 |
| `TRACKING_ALLOW_SERVERSIDE_PUBLIC_KEY` | bool | `false` | |
| `TRACKING_PROPERTIES_MAX_KEYS` | int | `32` | 1 až 256 |
| `TRACKING_PROPERTIES_MAX_DEPTH` | int | `3` | 1 až 10 |
| `TRACKING_PROPERTIES_MAX_STRING` | int | `1024` | 64 až 16384 |
| `TRACKING_IMPORT_BATCH_MAX_EVENTS` | int | `1000` | 1 až 5000 |
| `RATE_LIMIT_IDENTIFY_IP` | int | `30` | Požadavků za minutu na IP pro `POST /e/identify` |
| `RATE_LIMIT_TRACK_ANON` | int | `600` | Událostí za minutu na `anonymous_id` |

Poslední dvě jsou doplnění tabulky 4.5 části 1 podle požadavku 12.5.11 části 5. Z tabulky 4.5 se beze změny přebírají `RATE_LIMIT_TRACK_KEY` (6000), `RATE_LIMIT_TRACK_KEY_IP` (120) a `RATE_LIMIT_TRACK_PIXEL_IP` (600).

`TRACKING_SSE_MAX_CONNECTIONS` v tomhle plánu není, patří k P14.

### 3.2 Chybové kódy (vlastní P01, zavádí je část 5)

`tracking_event_too_large` (422), `tracking_invalid_event_name` (422), `tracking_invalid_anonymous_id` (422), `tracking_identify_unsigned_pii` (422), `tracking_domain_limit_reached` (422), `tracking_domain_invalid` (422), `tracking_merge_not_revertible` (409), `tracking_disabled` (409), `tracking_timeline_window_too_large` (422), `tracking_import_partition_missing` (422, opakovatelný), `tracking_import_beyond_retention` (422), `tracking_payload_version_unsupported` (400), `tracking_properties_keys_dropped` (nález), `tracking_properties_value_truncated` (nález), `tracking_properties_depth_truncated` (nález).

Přebírané z části 1: `token_malformed`, `token_signature_invalid`, `token_type_mismatch`, `token_unknown_key`, `token_expired`, `token_already_used`, `origin_not_allowed`, `payload_too_large`, `validation_failed`, `too_many_items`, `rate_limited`, `not_found`, `forbidden`, `dependency_timeout`.

### 3.3 Auditní akce

`tracking.merge_reverted`, `tracking.domain_added`, `tracking.domain_removed`, `tracking.identity_detached`, `tracking.events_imported`.

### 3.4 Knihovny a jejich licence

| Balíček | Verze | Licence | Kde běží | Proč |
|---|---|---|---|---|
| `crawler-user-agents` | 1.56.0 | MIT | server | Seznam regulárních výrazů crawlerů |
| `ipaddr.js` | 2.4.0 | MIT | server | Parsování IP a test příslušnosti do CIDR |
| `bowser` | 2.14.1 | MIT | server | Hrubé určení prohlížeče do `context.browser` |
| `happy-dom` | 20.0.0 | MIT | testy | DOM pro testy SDK |
| `zod` | 4.4.3 | MIT | server | Vybrala část 1 |
| `hono` | 4.12.33 | MIT | server | Vybrala část 1 |
| `rate-limiter-flexible` | 11.2.0 | ISC | server | Vybrala část 1 |
| `pg-boss` | 12.26.3 | MIT | worker | Vybrala část 1 |
| `uuid` | 13.0.0 | MIT | server | Vybrala část 1, UUIDv7 |

**Zakázané, nikdy je nenainstaluj:** `ua-parser-js` 2.x je **AGPL-3.0-or-later** (verze 1.0.40 je ještě MIT, takže povrchní kontrola projde a stejně to bude špatně), `device-detector-js` je **LGPL-3.0**. Obojí je v přímém konfliktu s MIT distribucí a job `licenses-node` na obojím padá. Klasifikaci `User-Agent` děláme vlastními regulárními výrazy v `ua-rules.ts`.

**Nepoužíváme, i když by fungovaly:** `lru-cache` (BlueOak-1.0.0, mimo whitelist, cache je 40 řádků vlastního kódu) a `isbot` (Unlicense; whitelist části 1 ji sice připouští, ale část 5 zvolila `crawler-user-agents` a dvě knihovny na totéž nechceme).

**Kanonizaci JSON podle RFC 8785 píšeme sami** (asi 70 řádků v `identity/jcs.ts`). Důvod je licenční jistota a to, že máme závazný testovací vektor, proti kterému se dá vlastní implementace ověřit lépe než cizí.

`packages/sdk-web` má **nula** runtime závislostí. Je to podmínka rozpočtu 5 kB, ne preference.

---

## 4. Úkoly

Označení `[db]` u úkolu znamená, že jeho testy potřebují Postgres přes testcontainers a spouštějí se v `test:db`, ne v `test:unit`.

**Kde leží testy:** `packages/<balíček>/test/<jméno>.test.ts`, podle vzoru `packages/db/test/isolation.test.ts` z části 1. Jednotkové testy jedou `pnpm turbo run test:unit`, databázové `pnpm turbo run test:db`.

**Brána na velikost SDK není samostatný CI job.** Tabulka šestnácti jobů v 3.15 části 1 je jediný autoritativní seznam a job na velikost JS bundlu v ní není. Kontrolu proto dělá **jednotkový test** `packages/sdk-web/test/size.test.ts`, který build spustí a změří ho. Tím padá v jobu `test-unit` a akceptační kritérium 30 („jinak CI padá") je splněné bez zavádění jobu, který neexistuje.

### Task 1: Typy domény a kostra modulu

**Files:**
- Create: `packages/core/tracking/types.ts`
- Create: `packages/core/tracking/index.ts`
- Test: `packages/core/test/tracking/types.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/types.test.ts
import { describe, expect, it } from 'vitest';
import { EVENT_SOURCES, EVENT_NAME_RE, OPEN_CLASS_BIT } from '../../tracking/types';

describe('tracking types', () => {
  it('registr zdrojů události má pět hodnot a odpovídá ck_web_events__source', () => {
    expect([...EVENT_SOURCES]).toEqual(['web', 'server', 'email', 'automation', 'import']);
  });

  it('jméno události přijme povolený tvar a odmítne nepovolený', () => {
    expect(EVENT_NAME_RE.test('page_view')).toBe(true);
    expect(EVENT_NAME_RE.test('order_completed')).toBe(true);
    expect(EVENT_NAME_RE.test('Product Viewed')).toBe(false);
    expect(EVENT_NAME_RE.test('1page')).toBe(false);
    expect(EVENT_NAME_RE.test('a'.repeat(65))).toBe(false);
  });

  it('bitová maska tříd otevření odpovídá 2.6', () => {
    expect(OPEN_CLASS_BIT).toEqual({
      human: 1, proxy_apple: 2, proxy_image: 4, bot: 8, unknown: 16,
    });
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/types.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/types"`.

- [ ] **Step 3: Napiš typy**

```ts
// packages/core/tracking/types.ts

/** Typ trackovacího tokenu podle kontraktu 4.10.3 části 1. Znak, nikdy číslo. */
export type TrackingTokenType = 'o' | 'c' | 'i' | 'u';

export type OpenTokenFields = {
  type: 'o';
  workspaceId: string;
  messageId: string;
  /** Unixové sekundy, uint32. Lokátor partition, nikdy se nekontroluje proti expiraci. */
  messageCreatedAt: number;
};

export type ClickTokenFields = {
  type: 'c';
  workspaceId: string;
  messageId: string;
  /** campaign_links.id, tedy UUID. Nikdy pořadové číslo. */
  linkId: string;
  messageCreatedAt: number;
};

export type IdentityTokenFields = {
  type: 'i';
  workspaceId: string;
  contactId: string;
  campaignId: string;
  /** Přesně 8 bajtů z CSPRNG. */
  nonce: Uint8Array;
  /** Unixové sekundy, uint32. */
  expiresAt: number;
};

export type UnsubscribeTokenFields = {
  type: 'u';
  workspaceId: string;
  messageId: string;
  contactId: string;
  /** Samé nuly znamenají globální odhlášení, ne odhlášení ze seznamu. */
  listId: string;
  messageCreatedAt: number;
};

export type TrackingTokenFields =
  | OpenTokenFields
  | ClickTokenFields
  | IdentityTokenFields
  | UnsubscribeTokenFields;

/** Chybové kódy tokenů. Vlastní je část 1, tahle část je jen používá. */
export type TokenErrorCode =
  | 'token_malformed'
  | 'token_signature_invalid'
  | 'token_type_mismatch'
  | 'token_unknown_key'
  | 'token_expired'
  | 'token_already_used';

export type OpenClass = 'human' | 'proxy_apple' | 'proxy_image' | 'bot' | 'unknown';
export type ClickClass = 'human' | 'scanner' | 'bot' | 'prefetch';

/**
 * Registr hodnot sloupce web_events.source. Vlastníkem je tahle část.
 * Přidání hodnoty znamená migraci CHECK plus doplnění do TimelineItem.source.
 */
export const EVENT_SOURCES = ['web', 'server', 'email', 'automation', 'import'] as const;
export type EventSource = (typeof EVENT_SOURCES)[number];

/** Vynucuje ck_web_events__name. Stejný výraz používá i SDK, aby se chyba poznala dřív. */
export const EVENT_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;

/** Bity open_class_mask v message_engagement, viz 2.6. */
export const OPEN_CLASS_BIT: Readonly<Record<OpenClass, number>> = Object.freeze({
  human: 1,
  proxy_apple: 2,
  proxy_image: 4,
  bot: 8,
  unknown: 16,
});

/** Klíče uvnitř jsonb jsou snake_case stejně jako klíče v API, viz 2.2. */
export type EventPage = {
  url: string;
  path: string;
  title?: string;
  referrer?: string;
  search?: string;
};

export type EventContext = {
  locale?: string;
  timezone?: string;
  screen?: { w: number; h: number };
  viewport?: { w: number; h: number };
  device?: 'mobile' | 'tablet' | 'desktop' | 'unknown';
  os?: string;
  browser?: string;
  /** ISO 3166-1 alpha-2. Jen když projekt zapnul ukládání země. */
  country?: string;
  /** Jen když provozovatel i projekt zapnuli ukládání IP. Výchozí stav je bez ní. */
  ip?: string;
  sdk?: { name: 'ml-web'; version: string };
  campaign?: {
    source?: string;
    medium?: string;
    campaign?: string;
    content?: string;
    term?: string;
  };
  clock_skew_ms?: number;
  /** Jen u source='import': kdy se dávka nahrála. Čas vzniku je occurred_at. */
  imported_at?: string;
};

/** Odkaz na řádek partitionované tabulky nese vždy obě složky klíče, viz 2.1 části 1. */
export type MessageRef = { messageId: string; messageCreatedAt: Date };
export type WebEventRef = { webEventId: string; webEventReceivedAt: Date };
```

- [ ] **Step 4: Napiš veřejný povrch domény**

```ts
// packages/core/tracking/index.ts
export type {
  ClickClass,
  ClickTokenFields,
  EventContext,
  EventPage,
  EventSource,
  IdentityTokenFields,
  MessageRef,
  OpenClass,
  OpenTokenFields,
  TokenErrorCode,
  TrackingTokenFields,
  TrackingTokenType,
  UnsubscribeTokenFields,
  WebEventRef,
} from './types';
export { EVENT_NAME_RE, EVENT_SOURCES, OPEN_CLASS_BIT } from './types';
```

- [ ] **Step 5: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/types.test.ts`
Expected: PASS, 3 testy.

- [ ] **Step 6: Commit**

```bash
git add packages/core/tracking/types.ts packages/core/tracking/index.ts packages/core/test/tracking/types.test.ts
git commit -m "feat(tracking): add domain types and event source registry"
```

---

### Task 2: Konfigurace a nastavení projektu

Konfigurační proměnné vlastní P01 a jsou v zod schématu v `packages/core/config`. Tenhle úkol dodává **typovaný pohled** na ně a **zod schéma jmenného prostoru `tracking`** ve `workspaces.settings`, který podle konvence 3.6 části 1 exportuje každá doména sama.

Rozhodnutí zadavatele o IP adresách má dvě páky a obě musí být zapnuté, aby se IP uložila: instalační `TRACKING_ALLOW_IP_STORAGE` (provozovatel je správcem údajů) a projektové `store_ip` (rozhodnutí konkrétního projektu). Přepínač odečítání automatických otevření má výchozí polohu tu poctivější, tedy `true`.

**Files:**
- Create: `packages/core/tracking/config.ts`
- Create: `packages/core/tracking/settings.ts`
- Test: `packages/core/test/tracking/settings.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/settings.test.ts
import { describe, expect, it } from 'vitest';
import { TrackingSettingsSchema, DEFAULT_TRACKING_SETTINGS } from '../../tracking/settings';

describe('tracking workspace settings', () => {
  it('prázdný objekt dá výchozí hodnoty', () => {
    expect(TrackingSettingsSchema.parse({})).toEqual(DEFAULT_TRACKING_SETTINGS);
  });

  it('odečítání automatických otevření je ve výchozím stavu zapnuté', () => {
    expect(DEFAULT_TRACKING_SETTINGS.subtract_machine_opens).toBe(true);
  });

  it('ukládání IP a země je ve výchozím stavu vypnuté', () => {
    expect(DEFAULT_TRACKING_SETTINGS.store_ip).toBe(false);
    expect(DEFAULT_TRACKING_SETTINGS.store_country).toBe(false);
  });

  it('měření otevření je ve výchozím stavu zapnuté', () => {
    expect(DEFAULT_TRACKING_SETTINGS.default_track_opens).toBe(true);
  });

  it('neznámý klíč se odmítne', () => {
    expect(() => TrackingSettingsSchema.parse({ nonsense: true })).toThrow();
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/settings.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/settings"`.

- [ ] **Step 3: Napiš schéma nastavení**

```ts
// packages/core/tracking/settings.ts
import { z } from 'zod';

/**
 * Jmenný prostor `tracking` ve workspaces.settings.
 * Schéma se slučuje v packages/db do WorkspaceSettingsSchema, viz konvence 3.6 části 1.
 */
export const TrackingSettingsSchema = z
  .object({
    /** Výchozí hodnota campaigns.track_opens u nové kampaně. */
    default_track_opens: z.boolean().default(true),
    /** Výchozí hodnota campaigns.track_clicks u nové kampaně. */
    default_track_clicks: z.boolean().default(true),
    /**
     * Přepínač odečítání automatických otevření od Apple Mail Privacy Protection.
     * Výchozí poloha je ta poctivější, tedy s odečtenými. Rozhodnutí zadavatele.
     * Data se tím nemění, mění se jen pohled v reportu, který vykresluje P14.
     */
    subtract_machine_opens: z.boolean().default(true),
    /** Sbírat webové události. Bez jediné tracking_domains se SDK stejně nespustí. */
    web_tracking_enabled: z.boolean().default(true),
    /**
     * Použít stažené Apple egress rozsahy při klasifikaci otevření.
     * Nikdy se nepoužijí pro webové události, viz 3.3.3.
     */
    use_apple_relay_ranges: z.boolean().default(false),
    /**
     * Ukládat IP adresu do context.ip. Vyžaduje navíc TRACKING_ALLOW_IP_STORAGE
     * na úrovni instalace. Rozhodnutí zadavatele: je to volba provozovatele
     * a jeho zodpovědnost, ne pevné chování produktu.
     */
    store_ip: z.boolean().default(false),
    /** Ukládat zemi odvozenou z IP. Vyžaduje TRACKING_STORE_COUNTRY a GeoIP databázi. */
    store_country: z.boolean().default(false),
    /** Přijmout veřejný klíč i u požadavku bez hlavičky Origin, viz 3.7.5. */
    allow_serverside_public_key: z.boolean().default(false),
  })
  .strict();

export type TrackingSettings = z.infer<typeof TrackingSettingsSchema>;

export const DEFAULT_TRACKING_SETTINGS: TrackingSettings = TrackingSettingsSchema.parse({});
```

- [ ] **Step 4: Napiš typovaný pohled na konfiguraci**

```ts
// packages/core/tracking/config.ts
import { config } from '@mlain/core/config';

/**
 * Trackingové proměnné z jediného zod schématu části 1.
 * Tenhle modul nic nevaliduje a nic nedoplňuje, jen pojmenovává.
 * Validace i výchozí hodnoty jsou v packages/core/config, exit code 78 při chybě.
 */
export const trackingConfig = {
  identityTokenTtlSeconds: config.TRACKING_IDENTITY_TOKEN_TTL_SECONDS,
  mergeWindowDays: config.TRACKING_MERGE_WINDOW_DAYS,
  mergeMaxEvents: config.TRACKING_MERGE_MAX_EVENTS,
  retentionMonths: config.TRACKING_RETENTION_MONTHS,
  appleRelayRanges: config.TRACKING_APPLE_RELAY_RANGES,
  allowIpStorage: config.TRACKING_ALLOW_IP_STORAGE,
  storeCountry: config.TRACKING_STORE_COUNTRY,
  geoipDbPath: config.TRACKING_GEOIP_DB_PATH,
  stripQueryParams: config.TRACKING_STRIP_QUERY_PARAMS,
  piiPropertyKeys: config.TRACKING_PII_PROPERTY_KEYS,
  writerFlushMs: config.TRACKING_WRITER_FLUSH_MS,
  writerBatch: config.TRACKING_WRITER_BATCH,
  allowServersidePublicKey: config.TRACKING_ALLOW_SERVERSIDE_PUBLIC_KEY,
  propertiesMaxKeys: config.TRACKING_PROPERTIES_MAX_KEYS,
  propertiesMaxDepth: config.TRACKING_PROPERTIES_MAX_DEPTH,
  propertiesMaxString: config.TRACKING_PROPERTIES_MAX_STRING,
  importBatchMaxEvents: config.TRACKING_IMPORT_BATCH_MAX_EVENTS,
  trackingDomain: config.TRACKING_DOMAIN,
  appUrl: config.APP_URL,
} as const;

/** Strop otevření jedné zprávy za den, viz 3.2.3. Není konfigurovatelný. */
export const OPEN_CAP_PER_MESSAGE_PER_DAY = 200;

/** Deduplikační okno opakovaných stažení pixelu, viz 3.3.5. */
export const OPEN_DEDUP_WINDOW_SECONDS = 180;

/** Okno aplikační deduplikace web_events, odpovídá životnosti offline fronty SDK. */
export const WEB_EVENT_DEDUP_WINDOW_DAYS = 7;

/** Maximum domén na projekt, viz 3.7.3. */
export const TRACKING_DOMAIN_LIMIT = 20;
```

> **Pozor na `OPEN_CAP_PER_MESSAGE_PER_DAY`.** Specifikace v 3.2.3 uvádí 100. Hodnota je tady 200 **schválně**: viz Task 14, kde je vysvětlené, proč se strop počítá odděleně pro každou třídu otevření. Kdyby ses držel stovky na zprávu celkem, Apple proxy by u aktivního čtenáře vyčerpala strop a skutečné lidské otevření by se zahodilo. Když se ti to nezdá, je to legitimní nález do revize, ne věc k tichému přepsání.

- [ ] **Step 5: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/settings.test.ts`
Expected: PASS, 5 testů.

- [ ] **Step 6: Commit**

```bash
git add packages/core/tracking/config.ts packages/core/tracking/settings.ts packages/core/test/tracking/settings.test.ts
git commit -m "feat(tracking): add workspace settings schema and config view"
```

---

### Task 3: Metriky

**Files:**
- Create: `packages/core/tracking/metrics.ts`
- Test: `packages/core/test/tracking/metrics.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/metrics.test.ts
import { describe, expect, it } from 'vitest';
import { TRACKING_METRIC_NAMES } from '../../tracking/metrics';

describe('tracking metrics', () => {
  it('všechna jména jsou podtržítková, tečka v názvu Prometheus metriky není platná', () => {
    for (const name of TRACKING_METRIC_NAMES) {
      expect(name).toMatch(/^tracking_[a-z0-9_]+$/);
      expect(name).not.toContain('.');
    }
  });

  it('katalog obsahuje alertované čítače z 9.2', () => {
    expect(TRACKING_METRIC_NAMES).toContain('tracking_message_lookup_miss_total');
    expect(TRACKING_METRIC_NAMES).toContain('tracking_writer_dropped_total');
    expect(TRACKING_METRIC_NAMES).toContain('tracking_token_invalid_total');
    expect(TRACKING_METRIC_NAMES).toContain('tracking_partition_missing');
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/metrics.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/metrics"`.

- [ ] **Step 3: Napiš modul metrik**

```ts
// packages/core/tracking/metrics.ts
import { counter, gauge, histogram } from '@mlain/core/metrics';
import type { ClickClass, OpenClass, TokenErrorCode } from './types';

/**
 * Katalog z 9.1 části 5. Jediná závazná notace je podtržítková.
 * Rozlišení podle druhu řeší label, ne další jméno metriky.
 */
export const TRACKING_METRIC_NAMES = [
  'tracking_open_total',
  'tracking_open_capped_total',
  'tracking_click_total',
  'tracking_token_invalid_total',
  'tracking_message_lookup_miss_total',
  'tracking_writer_buffer_size',
  'tracking_writer_dropped_total',
  'tracking_writer_flush_duration_seconds',
  'tracking_ingest_events_total',
  'tracking_ingest_duration_seconds',
  'tracking_ingest_truncated_total',
  'tracking_identity_bind_total',
  'tracking_identity_merge_events_total',
  'tracking_partition_missing',
  'tracking_redirect_duration_seconds',
] as const;

export const trackingMetrics = {
  openTotal: counter('tracking_open_total', 'Otevření podle třídy', ['class']),
  openCapped: counter('tracking_open_capped_total', 'Otevření zahozená stropem'),
  clickTotal: counter('tracking_click_total', 'Prokliky podle třídy', ['class']),
  tokenInvalid: counter('tracking_token_invalid_total', 'Neplatné tokeny podle kódu', ['code']),
  messageLookupMiss: counter(
    'tracking_message_lookup_miss_total',
    'Dohledání zprávy z tokenu neuspělo, alertované jako porušení invariantu I1',
  ),
  writerBufferSize: gauge('tracking_writer_buffer_size', 'Velikost bufferu zapisovače'),
  writerDropped: counter('tracking_writer_dropped_total', 'Zahozené položky bufferu'),
  writerFlushDuration: histogram(
    'tracking_writer_flush_duration_seconds',
    'Doba zápisu dávky',
  ),
  ingestEvents: counter('tracking_ingest_events_total', 'Přijaté události', ['result']),
  ingestDuration: histogram('tracking_ingest_duration_seconds', 'Latence ingestion'),
  ingestTruncated: counter('tracking_ingest_truncated_total', 'Ořezy v properties', ['limit']),
  identityBind: counter('tracking_identity_bind_total', 'Výsledky vazby identity', ['result']),
  identityMergeEvents: counter(
    'tracking_identity_merge_events_total',
    'Doplněné události při slučování',
  ),
  partitionMissing: gauge('tracking_partition_missing', 'Chybí partition pro aktuální měsíc'),
  redirectDuration: histogram('tracking_redirect_duration_seconds', 'Latence přesměrování'),
};

export function recordOpen(cls: OpenClass): void {
  trackingMetrics.openTotal.inc({ class: cls });
}

export function recordClick(cls: ClickClass): void {
  trackingMetrics.clickTotal.inc({ class: cls });
}

export function recordTokenInvalid(code: TokenErrorCode): void {
  trackingMetrics.tokenInvalid.inc({ code });
}

export type IdentityBindResult =
  | 'created'
  | 'bound'
  | 'unchanged'
  | 'rebound'
  | 'restricted'
  | 'shared';

export function recordIdentityBind(result: IdentityBindResult): void {
  trackingMetrics.identityBind.inc({ result });
}
```

- [ ] **Step 4: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/metrics.test.ts`
Expected: PASS, 2 testy.

- [ ] **Step 5: Commit**

```bash
git add packages/core/tracking/metrics.ts packages/core/test/tracking/metrics.test.ts
git commit -m "feat(tracking): add metric catalog with underscore naming"
```

---

### Task 4: Keyring a odvození `K_tracking`

Odvození je zmrazené v 3.10 části 1: `MASTER = base64url_decode(SECRET_KEY)`, `HKDF(SHA-256, MASTER, salt "mailer/v1", info "mailer/v1/tracking-token", 32)`. Testovací vektor je závazný a je proti čemu se měřit.

**Rozklad `SECRET_KEY` ani HKDF si tenhle modul nepíše.** Obojí vlastní `@mlain/contracts/keyring` (P02): `parseKeyring` umí implicitní `key_id 1`, tvar `<key_id>:<base64url>`, rozsah 1 až 255, kontrolu na 32 bajtů i to, že strop na počet pokolení neexistuje. `deriveKey(master, KEY_PURPOSES.trackingToken)` je totéž odvození, které se tady dřív psalo znovu. Druhá implementace zmrazeného odvození je přesně ta vada, kterou golden fixtures neodhalí, protože každá projde svým vlastním testem. Ověřeno spuštěním: `deriveKey` nad vektorem z 3.10 dá `b9d8…3124`, tedy bajt po bajtu totéž.

Co v téhle doméně zůstává: pojmenování a `deriveTrackingKey`, což je jediná pojistka, že se `KEY_PURPOSES.trackingToken` ani `HKDF_SALT` nezmění pod rukama. Test se přitom neptá kontraktu, ptá se vektoru z části 1.

**Files:**
- Create: `packages/core/tracking/tokens/keyring.ts`
- Test: `packages/core/test/tracking/keyring.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/keyring.test.ts
import { describe, expect, it } from 'vitest';
import { buildTrackingKeyring, deriveTrackingKey } from '../../tracking/tokens/keyring';

const TEST_SECRET_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const EXPECTED_K_TRACKING =
  'b9d815e1212e663c64cce1209229e7cf6af10197254677b7eabb575ea2ac3124';

describe('buildTrackingKeyring', () => {
  it('odvodí K_tracking přesně podle vektoru z 3.10 části 1', () => {
    const ring = buildTrackingKeyring({ secretKey: TEST_SECRET_KEY, secretKeyPrevious: '' });
    // Keyring nese MASTER, odvození dělá kontraktní kodek. Vektor z části 1 je
    // proto zapsaný nad deriveTrackingKey, ne nad obsahem mapy.
    expect(Buffer.from(deriveTrackingKey(ring.get(1)!)).toString('hex')).toBe(EXPECTED_K_TRACKING);
  });

  it('v keyringu je MASTER, ne odvozený klíč: záměna by tiše dala jiný podpis', () => {
    const ring = buildTrackingKeyring({ secretKey: TEST_SECRET_KEY, secretKeyPrevious: '' });
    expect(Buffer.from(ring.get(1)!).toString('base64url')).toBe(TEST_SECRET_KEY);
  });

  it('SECRET_KEY bez prefixu má implicitně key_id 1', () => {
    const ring = buildTrackingKeyring({ secretKey: TEST_SECRET_KEY, secretKeyPrevious: '' });
    expect([...ring.keys()]).toEqual([1]);
  });

  it('explicitní 1: dá stejný klíč jako implicitní tvar', () => {
    const implicitRing = buildTrackingKeyring({ secretKey: TEST_SECRET_KEY, secretKeyPrevious: '' });
    const explicitRing = buildTrackingKeyring({
      secretKey: `1:${TEST_SECRET_KEY}`,
      secretKeyPrevious: '',
    });
    expect(Buffer.from(explicitRing.get(1)!).toString('hex'))
      .toBe(Buffer.from(implicitRing.get(1)!).toString('hex'));
  });

  it('načte i předchozí pokolení a nemá horní strop na jejich počet', () => {
    const previous = Array.from({ length: 40 }, (_, i) => `${i + 2}:${TEST_SECRET_KEY}`).join(',');
    const ring = buildTrackingKeyring({ secretKey: `42:${TEST_SECRET_KEY}`, secretKeyPrevious: previous });
    expect(ring.size).toBe(41);
    expect(ring.has(2)).toBe(true);
    expect(ring.has(41)).toBe(true);
    expect(ring.has(42)).toBe(true);
  });

  it('key_id 0 je neplatný, rozsah je 1 až 255', () => {
    expect(() =>
      buildTrackingKeyring({ secretKey: `0:${TEST_SECRET_KEY}`, secretKeyPrevious: '' }),
    ).toThrow(/key_id/);
  });

  it('klíč, který se nedekóduje na 32 bajtů, se odmítne při startu', () => {
    expect(() => buildTrackingKeyring({ secretKey: 'AAEC', secretKeyPrevious: '' })).toThrow(/32/);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/keyring.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/tokens/keyring"`.

- [ ] **Step 3: Napiš keyring**

```ts
// packages/core/tracking/tokens/keyring.ts
import { KEY_PURPOSES, deriveKey, parseKeyring, type Keyring } from '@mlain/contracts/keyring';

export type KeyringInput = { secretKey: string; secretKeyPrevious: string };

/**
 * key_id 1 až 255 na MASTER, přesně v tom tvaru, jaký žádají `buildToken`
 * a `verifyToken` z kontraktu. Odvození na K_tracking si dělá kodek sám,
 * takže se tady nikdy neukládá odvozený klíč: kdyby ano, kontrakt by ho
 * odvodil podruhé a podpis by tiše nesouhlasil.
 */
export type TrackingKeyring = Keyring;

/**
 * Rozklad `SECRET_KEY` a `SECRET_KEY_PREVIOUS` vlastní kontrakt. Patří k němu
 * implicitní `key_id 1`, tvar `<key_id>:<base64url>`, rozsah 1 až 255, kontrola
 * na 32 bajtů i to, že **horní strop na počet pokolení neexistuje**: bez starých
 * klíčů přestanou platit odkazy v e-mailech, které leží ve schránkách roky.
 */
export function buildTrackingKeyring(input: KeyringInput): TrackingKeyring {
  return parseKeyring({
    secretKey: input.secretKey,
    secretKeyPrevious: input.secretKeyPrevious,
  });
}

/**
 * Odvození zmrazené v 3.10 části 1. Provozní cesta ho nevolá, dělá ho kodek
 * uvnitř kontraktu. Zůstává tady jako jediná pojistka, že se `HKDF_SALT`
 * ani `KEY_PURPOSES.trackingToken` nezmění pod rukama: test proti němu drží
 * vektor z části 1, tedy zdroj nezávislý na kontraktu.
 */
export function deriveTrackingKey(master: Uint8Array): Uint8Array {
  return deriveKey(master, KEY_PURPOSES.trackingToken);
}
```

- [ ] **Step 4: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/keyring.test.ts`
Expected: PASS, 7 testů. Kdyby první test padal na jiný hex, nezkoušej opravit test: znamená to, že se rozešel `salt` nebo `info`, a ty jsou zmrazené.

- [ ] **Step 5: Commit**

```bash
git add packages/core/tracking/tokens/keyring.ts packages/core/test/tracking/keyring.test.ts
git commit -m "feat(tracking): derive K_tracking from secret key ring"
```

---

### Task 5: Adaptér nad kontraktním kodekem tokenů

`packages/contracts/src/token.ts` vlastní P02 a obsahuje bajtový layout. Tenhle úkol dodává jen převod mezi kontraktním tvarem a doménovými typy z Tasku 1. **Nepřepisuj layout znovu.** Dvě implementace téhož projdou každá svým testem a rozejdou se až v provozu.

**Povrch kontraktu, proti kterému se píše.** `@mlain/contracts/token` exportuje `TOKEN_PREFIX`, `TOKEN_MAC_INPUT_PREFIX`, `TOKEN_MAC_BYTES`, `PAYLOAD_BYTES`, `GLOBAL_LIST_ID`, `TokenType`, `TokenFields`, `TokenError`, `TokenErrorCode`, `buildToken` a `verifyToken`. Kódování a dekódování payloadu jsou uvnitř kontraktu **privátní** a to je záměr: ven se dostane jen hotový token nebo hotová pole, takže mimo P02 neexistuje nic, čím by šlo bajty poskládat jinak. Adaptér proto **nesahá na jediný bajt** a překládá pouze jména a tvary polí.

Dvě věci, které se liší a musí je přeložit:

- Kontrakt pojmenovává pole **snake_case** (`workspace_id`, `message_created_at`), protože ta jména jsou součástí zmrazeného layoutu. Doména používá camelCase z Tasku 1.
- Kontrakt nese `nonce` jako **hex řetězec**, doména jako `Uint8Array` o osmi bajtech.

Délku hotového tokenu ve znacích kontrakt neexportuje a nemá proč: plyne z `PAYLOAD_BYTES` a z base64url bez paddingu. Dopočítává se proto tady, nikdy se nepíše ručně. Ověřeno spuštěním, že dopočet dá `{ o: 74, c: 96, i: 106, u: 117 }`, tedy přesně délky z části 1.

**Files:**
- Create: `packages/core/tracking/tokens/codec.ts`
- Test: `packages/core/test/tracking/codec.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/codec.test.ts
import { describe, expect, it } from 'vitest';
import { GLOBAL_LIST_ID, buildToken, verifyToken } from '@mlain/contracts/token';
import {
  PAYLOAD_BYTES,
  TOKEN_CHARS,
  fromContractFields,
  toContractFields,
} from '../../tracking/tokens/codec';
import { buildTrackingKeyring } from '../../tracking/tokens/keyring';
import type { TrackingTokenFields } from '../../tracking/types';

const WS = '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071';
const MSG = '0192f3a0-1c2d-7e41-8b2c-3d4e5f607182';
const LINK = '0192f3a0-1c2d-7e42-9c3d-4e5f60718293';
const CONTACT = '0192f3a0-1c2d-7e43-8d4e-5f60718293a4';
const CAMPAIGN = '0192f3a0-1c2d-7e44-9e5f-60718293a4b5';

const ring = buildTrackingKeyring({
  secretKey: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
  secretKeyPrevious: '',
});

/**
 * Round-trip vede přes SKUTEČNÝ kontraktní kodek, tedy přes bajty i MAC.
 * Adaptér se nesmí testovat sám proti sobě: kdyby si obě strany mapování
 * pletly stejně, test by prošel a token by se rozešel s Go senderem.
 */
function roundTrip(fields: TrackingTokenFields): { fields: TrackingTokenFields; token: string } {
  const contract = toContractFields(fields);
  const { token } = buildToken({
    type: contract.type,
    keyId: 1,
    fields: contract.fields,
    keyring: ring,
  });
  const verified = verifyToken({
    token,
    endpointType: contract.type,
    keyring: ring,
    now: 0,
    isNonceUsed: () => false,
  });
  return { fields: fromContractFields(verified.type, verified.fields), token };
}

describe('token codec adapter', () => {
  it('délky payloadů přebírá z kontraktu, délky tokenů z nich dopočítává', () => {
    expect(PAYLOAD_BYTES).toEqual({ o: 36, c: 52, i: 60, u: 68 });
    expect(TOKEN_CHARS).toEqual({ o: 74, c: 96, i: 106, u: 117 });
  });

  it('open pole projdou kontraktním kodekem beze změny', () => {
    const fields = { type: 'o', workspaceId: WS, messageId: MSG, messageCreatedAt: 1784995200 } as const;
    const result = roundTrip(fields);
    expect(result.fields).toEqual(fields);
    expect(result.token).toHaveLength(TOKEN_CHARS.o);
  });

  it('click pole nesou link_id jako UUID', () => {
    const fields = {
      type: 'c', workspaceId: WS, messageId: MSG, linkId: LINK, messageCreatedAt: 1784995200,
    } as const;
    const result = roundTrip(fields);
    expect(result.fields).toEqual(fields);
    expect(result.token).toHaveLength(TOKEN_CHARS.c);
  });

  it('identity pole přeloží nonce mezi osmi bajty a hexem', () => {
    const fields = {
      type: 'i', workspaceId: WS, contactId: CONTACT, campaignId: CAMPAIGN,
      nonce: new Uint8Array(Buffer.from('0011223344556677', 'hex')), expiresAt: 1785000600,
    } as const;
    const result = roundTrip(fields);
    expect(result.fields).toEqual(fields);
    expect((result.fields as typeof fields).nonce).toBeInstanceOf(Uint8Array);
    expect((result.fields as typeof fields).nonce).toHaveLength(8);
    // Kontrakt drží nonce jako hex řetězec, doména jako bajty. Kdyby se
    // překlad vynechal, prošlo by to typovou kontrolou a rozešlo se v MACu.
    expect(toContractFields(fields).fields.nonce).toBe('0011223344556677');
  });

  it('nonce jiné délky než osm bajtů se odmítne při překladu, ne až v kontraktu', () => {
    expect(() =>
      toContractFields({
        type: 'i', workspaceId: WS, contactId: CONTACT, campaignId: CAMPAIGN,
        nonce: new Uint8Array(7), expiresAt: 1785000600,
      }),
    ).toThrow(/8 bajt/);
  });

  it('unsubscribe pole s nulovým list_id znamenají globální odhlášení', () => {
    const fields = {
      type: 'u', workspaceId: WS, messageId: MSG, contactId: CONTACT,
      listId: GLOBAL_LIST_ID, messageCreatedAt: 1784995200,
    } as const;
    const result = roundTrip(fields);
    expect(result.fields).toEqual(fields);
    expect(result.token).toHaveLength(TOKEN_CHARS.u);
  });

  it('hraniční uint32 projde v obou směrech', () => {
    const fields = { type: 'o', workspaceId: WS, messageId: MSG, messageCreatedAt: 4294967295 } as const;
    expect(roundTrip(fields).fields).toEqual(fields);
    const zero = { ...fields, messageCreatedAt: 0 };
    expect(roundTrip(zero).fields).toEqual(zero);
  });

  it('message_created_at se vrací jako číslo, ne jako řetězec', () => {
    const fields = { type: 'o', workspaceId: WS, messageId: MSG, messageCreatedAt: 1784995200 } as const;
    // Kontraktní TokenFields je Record<string, string | number>. Bez přetypování
    // by se hodnota tiše dostala do jsonb metadata jako řetězec.
    expect(typeof (roundTrip(fields).fields as typeof fields).messageCreatedAt).toBe('number');
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/codec.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/tokens/codec"`.

- [ ] **Step 3: Napiš adaptér**

```ts
// packages/core/tracking/tokens/codec.ts
import {
  PAYLOAD_BYTES,
  TOKEN_MAC_BYTES,
  TOKEN_PREFIX,
  type TokenFields,
  type TokenType,
} from '@mlain/contracts/token';
import type { TrackingTokenFields, TrackingTokenType } from '../types';

/**
 * Délky payloadů pocházejí z kontraktu 4.10.3 a jen se propouštějí dál, aby
 * v téhle doméně neexistovalo druhé místo, kde je někdo napíše ručně.
 */
export { PAYLOAD_BYTES };

/** type + key_id před payloadem. Součást zmrazeného layoutu. */
const HEADER_BYTES = 2;
const NONCE_BYTES = 8;

/**
 * Délka hotového tokenu ve ZNACÍCH, ne v bajtech. Kontrakt ji neexportuje
 * a nemá proč: plyne z PAYLOAD_BYTES a z base64url bez paddingu. Dopočítává
 * se proto tady a nikdy se nepíše ručně, jinak vznikne druhé místo, které
 * se při změně layoutu tiše rozejde.
 */
export const TOKEN_CHARS: Readonly<Record<TrackingTokenType, number>> = Object.freeze(
  Object.fromEntries(
    (Object.keys(PAYLOAD_BYTES) as TrackingTokenType[]).map((type) => {
      const rawBytes = HEADER_BYTES + PAYLOAD_BYTES[type] + TOKEN_MAC_BYTES;
      const remainder = rawBytes % 3;
      const bodyChars = Math.ceil(rawBytes / 3) * 4 - (remainder === 0 ? 0 : 3 - remainder);
      return [type, TOKEN_PREFIX.length + bodyChars];
    }),
  ) as Record<TrackingTokenType, number>,
);

function nonceToHex(nonce: Uint8Array): string {
  if (nonce.length !== NONCE_BYTES) {
    throw new Error(`nonce musí mít ${NONCE_BYTES} bajtů, dostal jsem ${nonce.length}`);
  }
  return Buffer.from(nonce).toString('hex');
}

/**
 * Doménový tvar na kontraktní. Jména polí jsou snake_case, protože jsou
 * součástí zmrazeného layoutu, a nonce jde jako hex řetězec.
 * Tahle funkce nesestavuje bajty, to dělá buildToken uvnitř kontraktu.
 */
export function toContractFields(fields: TrackingTokenFields): {
  type: TokenType;
  fields: TokenFields;
} {
  switch (fields.type) {
    case 'o':
      return {
        type: 'o',
        fields: {
          workspace_id: fields.workspaceId,
          message_id: fields.messageId,
          message_created_at: fields.messageCreatedAt,
        },
      };
    case 'c':
      return {
        type: 'c',
        fields: {
          workspace_id: fields.workspaceId,
          message_id: fields.messageId,
          link_id: fields.linkId,
          message_created_at: fields.messageCreatedAt,
        },
      };
    case 'i':
      return {
        type: 'i',
        fields: {
          workspace_id: fields.workspaceId,
          contact_id: fields.contactId,
          campaign_id: fields.campaignId,
          nonce: nonceToHex(fields.nonce),
          expires_at: fields.expiresAt,
        },
      };
    case 'u':
      return {
        type: 'u',
        fields: {
          workspace_id: fields.workspaceId,
          message_id: fields.messageId,
          contact_id: fields.contactId,
          list_id: fields.listId,
          message_created_at: fields.messageCreatedAt,
        },
      };
  }
}

/**
 * Kontraktní tvar na doménový. Kontraktní TokenFields je
 * `Record<string, string | number>`, takže se hodnoty musí přetypovat: bez toho
 * by se `message_created_at` dostalo do jsonb jako řetězec a nikdo by si toho
 * nevšiml, dokud by se nad ním nepočítalo.
 */
export function fromContractFields(type: TokenType, fields: TokenFields): TrackingTokenFields {
  const text = (name: string): string => String(fields[name]);
  const u32 = (name: string): number => Number(fields[name]);

  switch (type) {
    case 'o':
      return {
        type: 'o',
        workspaceId: text('workspace_id'),
        messageId: text('message_id'),
        messageCreatedAt: u32('message_created_at'),
      };
    case 'c':
      return {
        type: 'c',
        workspaceId: text('workspace_id'),
        messageId: text('message_id'),
        linkId: text('link_id'),
        messageCreatedAt: u32('message_created_at'),
      };
    case 'i':
      return {
        type: 'i',
        workspaceId: text('workspace_id'),
        contactId: text('contact_id'),
        campaignId: text('campaign_id'),
        nonce: new Uint8Array(Buffer.from(text('nonce'), 'hex')),
        expiresAt: u32('expires_at'),
      };
    case 'u':
      return {
        type: 'u',
        workspaceId: text('workspace_id'),
        messageId: text('message_id'),
        contactId: text('contact_id'),
        listId: text('list_id'),
        messageCreatedAt: u32('message_created_at'),
      };
  }
}
```

- [ ] **Step 4: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/codec.test.ts`
Expected: PASS, 8 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/tracking/tokens/codec.ts packages/core/test/tracking/codec.test.ts
git commit -m "feat(tracking): add adapter over contract token codec"
```

---

### Task 6: `verifyTrackingToken` v normativním pořadí kroků

Pořadí kroků 1 až 8 je normativní z 4.10.3 části 1 a **nesmí se přeuspořádat**. Krok 4 (typ proti endpointu) je bezpečnostní: bez něj by šlo zobrazením obrázku odhlásit příjemce z odběru. Krok 7 říká, že hodnoty z payloadu se použijí až po ověření MAC, nikdy dřív.

Tuhle funkci volá i část 2 pro token typu `u`. Vlastní ověření si nepíše, protože kontrola typu proti endpointu musí být na jednom místě.

**Files:**
- Create: `packages/core/tracking/tokens/verify.ts`
- Test: `packages/core/test/tracking/verify.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/verify.test.ts
import { describe, expect, it } from 'vitest';
import { buildTrackingKeyring } from '../../tracking/tokens/keyring';
import { verifyTrackingToken } from '../../tracking/tokens/verify';

const TEST_SECRET_KEY = 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8';
const ring = buildTrackingKeyring({ secretKey: TEST_SECRET_KEY, secretKeyPrevious: '' });

const OPEN = 't1bwEBkvOgHC1-QJobLD1OX2BxAZLzoBwtfkGLLD1OX2Bxgmpk3YDUjmcTwPYu1Q9cpqmSPs4g';
const CLICK =
  't1YwEBkvOgHC1-QJobLD1OX2BxAZLzoBwtfkGLLD1OX2BxggGS86AcLX5CnD1OX2BxgpNqZN2Aa8TprBxqhsgbR6l5AMMNpw';
const now = new Date('2026-07-25T16:00:00Z');

describe('verifyTrackingToken', () => {
  it('ověří open token z vektoru části 1 a vrátí rozparsovaná pole', () => {
    const result = verifyTrackingToken(OPEN, ['o'], { keyring: ring, now });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.keyId).toBe(1);
    expect(result.fields).toEqual({
      type: 'o',
      workspaceId: '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071',
      messageId: '0192f3a0-1c2d-7e41-8b2c-3d4e5f607182',
      messageCreatedAt: 1784995200,
    });
  });

  it('open token na click endpointu skončí kódem token_type_mismatch', () => {
    const result = verifyTrackingToken(OPEN, ['c'], { keyring: ring, now });
    expect(result).toEqual({ ok: false, code: 'token_type_mismatch' });
  });

  it('token bez prefixu t1 je token_malformed', () => {
    const result = verifyTrackingToken(OPEN.slice(2), ['o'], { keyring: ring, now });
    expect(result).toEqual({ ok: false, code: 'token_malformed' });
  });

  it('změna bitu uvnitř MAC vede na token_signature_invalid, ne na malformed', () => {
    // Bit se překlápí v BAJTU, ne v posledním znaku. Poslední znak base64url
    // u payloadu typu `c` nese jen čtyři významné bity, takže jeho změna
    // nechá nenulové zbytkové bity, neprojde kanonickou kontrolou z kroku 2
    // a skončí jako token_malformed. Ověřeno spuštěním: očekávat u ní podpis
    // by znamenalo test, na kterém padne správná implementace.
    const raw = Buffer.from(CLICK.slice(2), 'base64url');
    raw[raw.length - 3] ^= 0x01;
    const tampered = `t1${raw.toString('base64url')}`;
    const result = verifyTrackingToken(tampered, ['c'], { keyring: ring, now });
    expect(result).toEqual({ ok: false, code: 'token_signature_invalid' });
  });

  it('změna posledního znaku je naopak token_malformed, protože nesedí zbytkové bity', () => {
    const flipped = `${CLICK.slice(0, -1)}${CLICK.endsWith('w') ? 'x' : 'w'}`;
    const result = verifyTrackingToken(flipped, ['c'], { keyring: ring, now });
    expect(result).toEqual({ ok: false, code: 'token_malformed' });
  });

  it('base64 se standardní abecedou je token_malformed', () => {
    const result = verifyTrackingToken('t1bw+B/kvOg', ['o'], { keyring: ring, now });
    expect(result).toEqual({ ok: false, code: 'token_malformed' });
  });

  it('base64url s paddingem je token_malformed', () => {
    const result = verifyTrackingToken(`${OPEN}=`, ['o'], { keyring: ring, now });
    expect(result).toEqual({ ok: false, code: 'token_malformed' });
  });

  it('payload zkrácený o bajt je token_malformed', () => {
    const raw = Buffer.from(OPEN.slice(2), 'base64url');
    const short = `t1${raw.subarray(0, raw.length - 1).toString('base64url')}`;
    const result = verifyTrackingToken(short, ['o'], { keyring: ring, now });
    expect(result).toEqual({ ok: false, code: 'token_malformed' });
  });

  it('neznámý key_id je token_unknown_key a nikdy se u něj nepočítá MAC', () => {
    const raw = Buffer.from(OPEN.slice(2), 'base64url');
    raw[1] = 9;
    const result = verifyTrackingToken(`t1${raw.toString('base64url')}`, ['o'], { keyring: ring, now });
    expect(result).toEqual({ ok: false, code: 'token_unknown_key' });
  });

  it('message_created_at se nikdy nekontroluje proti expiraci', () => {
    const farFuture = new Date('2099-01-01T00:00:00Z');
    expect(verifyTrackingToken(OPEN, ['o'], { keyring: ring, now: farFuture }).ok).toBe(true);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/verify.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/tokens/verify"`.

- [ ] **Step 3: Napiš ověření**

```ts
// packages/core/tracking/tokens/verify.ts
import { TokenError, verifyToken } from '@mlain/contracts/token';
import type { TokenErrorCode, TrackingTokenFields, TrackingTokenType } from '../types';
import { fromContractFields } from './codec';
import type { TrackingKeyring } from './keyring';

export type VerifyOptions = { keyring: TrackingKeyring; now: Date };

export type VerifyResult =
  | { ok: true; fields: TrackingTokenFields; keyId: number }
  | { ok: false; code: TokenErrorCode };

/**
 * Kroky 1 až 8 z kontraktu 4.10.3 části 1 v normativním pořadí **dělá
 * kontraktní `verifyToken`**, včetně kanonického base64url, kontroly délky
 * proti typu, vazby typu na endpoint, ověření MAC v konstantním čase
 * a toho, že se hodnoty z payloadu použijí až po něm.
 *
 * Tenhle obal přidává jen tři aplikační věci:
 * 1. seznam povolených typů místo jednoho, protože povrch `/t/**` mountuje
 *    víc cest do jedné podaplikace,
 * 2. výsledek jako hodnotu místo výjimky, protože pixel na neplatný token
 *    nesmí odpovědět chybou, ale GIFem,
 * 3. překlad na doménové typy.
 *
 * Jednorázovost typu `i` (druhá polovina kroku 8) tady schválně **nic
 * neřeší**: potřebuje databázi a tahle funkce je čistá. Dělá ji
 * `consumeIdentityToken` unikátním klíčem, viz Task 31. Proto se sem předává
 * `isNonceUsed`, které vždy vrací `false`.
 */
export function verifyTrackingToken(
  token: string,
  allowedTypes: readonly TrackingTokenType[],
  options: VerifyOptions,
): VerifyResult {
  const nowSeconds = Math.floor(options.now.getTime() / 1000);
  let lastCode: TokenErrorCode = 'token_type_mismatch';

  for (const endpointType of allowedTypes) {
    try {
      const verified = verifyToken({
        token,
        endpointType,
        keyring: options.keyring,
        now: nowSeconds,
        isNonceUsed: () => false,
      });
      return {
        ok: true,
        keyId: verified.keyId,
        fields: fromContractFields(verified.type, verified.fields),
      };
    } catch (error) {
      if (!(error instanceof TokenError)) throw error;
      // Neshoda typu znamená jen "tenhle endpoint ne", zkusí se další povolený.
      // Každá jiná chyba je konečná a další typ by ji nezměnil.
      if (error.code !== 'token_type_mismatch') return { ok: false, code: error.code };
      lastCode = error.code;
    }
  }

  return { ok: false, code: lastCode };
}
```

- [ ] **Step 4: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/verify.test.ts`
Expected: PASS, 10 testů.

- [ ] **Step 5: Přidej kontraktní test proti fixtures P02**

```ts
// packages/core/test/tracking/verify.vectors.test.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildTrackingKeyring } from '../../tracking/tokens/keyring';
import { verifyTrackingToken } from '../../tracking/tokens/verify';
import type { TokenErrorCode, TrackingTokenType } from '../../tracking/types';

type PositiveVector = { id: string; type: TrackingTokenType; key_id: number; expected_token: string };
type NegativeVector = {
  id: string;
  token: string;
  endpoint_type: TrackingTokenType;
  expected_error: TokenErrorCode;
  /** Unixové sekundy. Jen u vektorů, které se vyhodnocují proti času. */
  now?: number;
  nonce_used?: boolean;
};

// Cesta jde přes exportní mapu balíčku, ne relativně: relativní cesta do cizího
// balíčku přežije přesun adresáře a přestane odpovídat tomu, co se publikuje.
const vectors = JSON.parse(
  readFileSync(fileURLToPath(import.meta.resolve('@mlain/contracts/fixtures/token/vectors.json')), 'utf8'),
) as { positive: PositiveVector[]; negative: NegativeVector[] };

const ring = buildTrackingKeyring({
  secretKey: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
  secretKeyPrevious: '',
});
const DEFAULT_NOW = new Date('2026-07-25T16:00:00Z');

/** Jediný kód, který tahle funkce vracet nesmí, protože ho řeší databáze. */
const HANDLED_ELSEWHERE: readonly TokenErrorCode[] = ['token_already_used'];

describe('token vectors from packages/contracts', () => {
  it('fixture existuje a není prázdná', () => {
    expect(vectors.positive.length).toBeGreaterThan(0);
    expect(vectors.negative.length).toBeGreaterThan(0);
  });

  it.each(vectors.positive)('pozitivní vektor $id projde', (vector) => {
    const result = verifyTrackingToken(vector.expected_token, [vector.type], {
      keyring: ring,
      now: DEFAULT_NOW,
    });
    expect(result.ok).toBe(true);
  });

  it.each(vectors.negative.filter((v) => !HANDLED_ELSEWHERE.includes(v.expected_error)))(
    'negativní vektor $id skončí kódem $expected_error',
    (vector) => {
      const result = verifyTrackingToken(vector.token, [vector.endpoint_type], {
        keyring: ring,
        now: vector.now === undefined ? DEFAULT_NOW : new Date(vector.now * 1000),
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe(vector.expected_error);
    },
  );

  it('vynechává se právě jeden vektor a je to ten o jednorázovosti', () => {
    // Bez tohohle testu by filtr mohl tiše narůst a s ním by zmizelo pokrytí.
    const skipped = vectors.negative.filter((v) => HANDLED_ELSEWHERE.includes(v.expected_error));
    expect(skipped.map((v) => v.id)).toEqual(['TK-N7']);
  });
});
```

`TK-N7` (`token_already_used`) je jediný vynechaný vektor a je to záměr: jednorázovost je stav v databázi a `verifyTrackingToken` je čistá funkce. Pokrývá ho Task 31 unikátním klíčem nad `identity_token_uses`. `TK-N6` (`token_expired`) se naopak **kontroluje**, protože expirace je čistá funkce času a fixture k ní nese vlastní `now`. Poslední test hlídá, že se seznam výjimek nerozroste.

- [ ] **Step 6: Spusť oba testy**

Run: `pnpm vitest run packages/core/test/tracking/verify.test.ts packages/core/test/tracking/verify.vectors.test.ts`
Expected: PASS. Kdyby fixture ještě neexistovala, je to blokující nález na P02, ne důvod si vektory vymyslet.

- [ ] **Step 7: Commit**

```bash
git add packages/core/tracking/tokens/verify.ts packages/core/test/tracking/verify.test.ts packages/core/test/tracking/verify.vectors.test.ts
git commit -m "feat(tracking): verify signed tracking tokens with endpoint type binding"
```

---

### Task 7: Vydání identifikačního tokenu

Identifikační token je jediný, který vyrábí tahle část (ostatní tři vyrábí Go sender). Platí **15 minut**, je jednorázový, je vázaný na projekt a kampaň a **neobsahuje nic čitelného**. `contact_id` v něm je, ale jen binárně a jako součást vstupu do MAC, takže ho nejde zaměnit bez zneplatnění tokenu.

**Files:**
- Create: `packages/core/tracking/tokens/mint.ts`
- Test: `packages/core/test/tracking/mint.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/mint.test.ts
import { describe, expect, it } from 'vitest';
import { TOKEN_CHARS } from '../../tracking/tokens/codec';
import { buildTrackingKeyring } from '../../tracking/tokens/keyring';
import { mintIdentityToken } from '../../tracking/tokens/mint';
import { verifyTrackingToken } from '../../tracking/tokens/verify';

const ring = buildTrackingKeyring({
  secretKey: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
  secretKeyPrevious: '',
});
const now = new Date('2026-07-25T16:00:00Z');
const base = {
  workspaceId: '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071',
  contactId: '0192f3a0-1c2d-7e43-8d4e-5f60718293a4',
  campaignId: '0192f3a0-1c2d-7e44-9e5f-60718293a4b5',
};

describe('mintIdentityToken', () => {
  it('vydaný token má 106 znaků a ověří se vlastním keyringem', () => {
    const { token } = mintIdentityToken({ ...base, ttlSeconds: 900, keyring: ring, currentKeyId: 1, now });
    expect(token).toHaveLength(TOKEN_CHARS.i);
    expect(TOKEN_CHARS.i).toBe(106);
    expect(verifyTrackingToken(token, ['i'], { keyring: ring, now }).ok).toBe(true);
  });

  it('expirace je now plus TTL v celých sekundách, výchozí TTL je 15 minut', () => {
    const { expiresAt } = mintIdentityToken({ ...base, ttlSeconds: 900, keyring: ring, currentKeyId: 1, now });
    expect(expiresAt).toBe(Math.floor(now.getTime() / 1000) + 900);
  });

  it('token po uplynutí TTL skončí kódem token_expired, ne signature_invalid', () => {
    const { token } = mintIdentityToken({ ...base, ttlSeconds: 900, keyring: ring, currentKeyId: 1, now });
    const later = new Date(now.getTime() + 901_000);
    expect(verifyTrackingToken(token, ['i'], { keyring: ring, now: later })).toEqual({
      ok: false,
      code: 'token_expired',
    });
  });

  it('dvě volání dají různý nonce, tedy různý token', () => {
    const a = mintIdentityToken({ ...base, ttlSeconds: 900, keyring: ring, currentKeyId: 1, now });
    const b = mintIdentityToken({ ...base, ttlSeconds: 900, keyring: ring, currentKeyId: 1, now });
    expect(a.token).not.toBe(b.token);
    expect(Buffer.from(a.nonce).equals(Buffer.from(b.nonce))).toBe(false);
  });

  it('nonce má přesně 8 bajtů', () => {
    const { nonce } = mintIdentityToken({ ...base, ttlSeconds: 900, keyring: ring, currentKeyId: 1, now });
    expect(nonce).toHaveLength(8);
  });

  it('dekódovaný payload má 60 bajtů a nenese žádný vstup v textové podobě', () => {
    const { token } = mintIdentityToken({ ...base, ttlSeconds: 900, keyring: ring, currentKeyId: 1, now });
    const raw = Buffer.from(token.slice(2), 'base64url');
    const payload = raw.subarray(2, raw.length - 16);
    expect(payload).toHaveLength(60);

    // Hledá se textová podoba vstupů, ne jednotlivé bajty. Kontrola na znak '@'
    // by byla nesmyslná: 0x40 je běžný bajt UUID (verze 7 dá `...-7e40-...`),
    // takže by padala vždycky, a správná implementace by úkolem neprošla.
    // Ověřeno spuštěním: 100 000 z 100 000 vydaných tokenů bajt 0x40 obsahuje.
    for (const value of [base.workspaceId, base.contactId, base.campaignId]) {
      expect(payload.includes(Buffer.from(value, 'ascii'))).toBe(false);
      expect(payload.includes(Buffer.from(value.replace(/-/g, ''), 'ascii'))).toBe(false);
    }
  });

  it('změna bitu v contact_id zneplatní podpis', () => {
    const { token } = mintIdentityToken({ ...base, ttlSeconds: 900, keyring: ring, currentKeyId: 1, now });
    const raw = Buffer.from(token.slice(2), 'base64url');
    raw[2 + 16] ^= 0x01; // první bajt contact_id
    const tampered = `t1${raw.toString('base64url')}`;
    expect(verifyTrackingToken(tampered, ['i'], { keyring: ring, now })).toEqual({
      ok: false,
      code: 'token_signature_invalid',
    });
  });

  it('10 000 náhodných round-tripů projde', () => {
    for (let i = 0; i < 10_000; i += 1) {
      const { token } = mintIdentityToken({ ...base, ttlSeconds: 900, keyring: ring, currentKeyId: 1, now });
      expect(verifyTrackingToken(token, ['i'], { keyring: ring, now }).ok).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/mint.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/tokens/mint"`.

- [ ] **Step 3: Napiš vydávání**

```ts
// packages/core/tracking/tokens/mint.ts
import crypto from 'node:crypto';
import { buildToken } from '@mlain/contracts/token';
import { toContractFields } from './codec';
import type { TrackingKeyring } from './keyring';

const NONCE_BYTES = 8;

export type MintIdentityTokenInput = {
  workspaceId: string;
  contactId: string;
  campaignId: string;
  ttlSeconds: number;
  keyring: TrackingKeyring;
  currentKeyId: number;
  now: Date;
};

export type MintedIdentityToken = {
  token: string;
  nonce: Uint8Array;
  /** Unixové sekundy, stejná hodnota jako v payloadu. */
  expiresAt: number;
};

/**
 * Bajty ani MAC se tady neskládají, dělá to `buildToken` z kontraktu.
 * Aplikační je jen nonce z CSPRNG, výpočet expirace a kontrola, že se
 * podepisuje aktuálním pokolením klíče.
 */
export function mintIdentityToken(input: MintIdentityTokenInput): MintedIdentityToken {
  if (!input.keyring.has(input.currentKeyId)) {
    throw new Error(`Aktuální key_id ${input.currentKeyId} není v keyringu`);
  }

  const nonce = new Uint8Array(crypto.randomBytes(NONCE_BYTES));
  const expiresAt = Math.floor(input.now.getTime() / 1000) + input.ttlSeconds;

  const contract = toContractFields({
    type: 'i',
    workspaceId: input.workspaceId,
    contactId: input.contactId,
    campaignId: input.campaignId,
    nonce,
    expiresAt,
  });

  const { token } = buildToken({
    type: contract.type,
    keyId: input.currentKeyId,
    fields: contract.fields,
    keyring: input.keyring,
  });

  return { token, nonce, expiresAt };
}
```

- [ ] **Step 4: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/mint.test.ts`
Expected: PASS, 8 testů. Poslední trvá pár sekund, je to schválně: round-trip test je jediné, co odhalí chybu v okrajovém bajtu.

- [ ] **Step 5: Commit**

```bash
git add packages/core/tracking/tokens/mint.ts packages/core/test/tracking/mint.test.ts
git commit -m "feat(tracking): mint one-time identity tokens with 15 minute validity"
```

---

### Task 8: Dohledání zprávy z tokenu `[db]`

Token nese `message_id` i `message_created_at`, tedy **obě složky primárního klíče** `messages (id, created_at)`. Dohledání je proto přímý zásah do jedné partition. Fallback na okno jedné sekundy existuje jen kvůli zaokrouhlení na hranici a **nikdy se nesmí zvrhnout v dotaz bez podmínky na `created_at`**: takový dotaz prohledá všechny partition a rozpočet latence padne.

**Files:**
- Create: `packages/core/tracking/repo/tx.ts`
- Create: `packages/core/tracking/repo/messages.repo.ts`
- Create: `packages/core/tracking/tokens/message-lookup.ts`
- Test: `packages/core/test/tracking/tx.db.test.ts`
- Test: `packages/core/test/tracking/message-lookup.db.test.ts`

- [ ] **Step 0: Napiš doménový obal nad transakcemi**

Je to první `[db]` úkol, takže tady vzniká jediné místo, přes které tahle doména otevírá transakce. Nedělá nic navíc, jen pojmenovává dva případy z 1.1 tak, aby se ten druhý dal **spočítat grepem**.

```ts
// packages/core/tracking/repo/tx.ts
import { createSystemContext } from '@mlain/core/identity';
import { withWorkspace, withoutWorkspace, type Tx } from '@mlain/core/tx';

export type { Tx };

/**
 * Transakce v kontextu jednoho projektu pod systémovým aktérem.
 * Obálka nastaví `mlain.workspace_id`, takže RLS platí i pro dotazy této domény.
 * Workspace pochází z podepsaného tokenu, z veřejného klíče nebo z payloadu jobu,
 * nikdy ze session: trackovací povrchy session nemají.
 *
 * `job` se propíše do aktéra a odtud do auditu, takže je vidět, co řádek zapsalo.
 */
export function withTrackingTx<T>(
  workspaceId: string,
  job: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return withWorkspace(createSystemContext(workspaceId, job), fn);
}

/**
 * Transakce **napříč projekty**, tedy bez jakéhokoli `set_config`.
 *
 * Používej ji výhradně tam, kde workspace z principu neznáme (dohledání
 * veřejného klíče) nebo kde se pracuje se všemi projekty naráz (retence,
 * přepočty, mapa trackovacích domén). Každé takové místo je vyjmenované
 * v 1.1 a hlídá ho test v Tasku 47.
 *
 * **Dokud P03 nedodá mechanismus pro systémový přístup, vrací tahle cesta
 * nula řádků a nevrací chybu.** Politika `ws_isolation` porovnává
 * `workspace_id` s `current_setting('mlain.workspace_id', true)`, což je
 * bez kontextu `NULL`. Není to důvod obejít to jinde, je to jeden nález
 * na jednom místě.
 */
export function withCrossWorkspaceTx<T>(job: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  void job; // drží jméno u volání, aby šlo dohledat, kdo napříč projekty sahá
  return withoutWorkspace(fn);
}
```

```ts
// packages/core/test/tracking/tx.db.test.ts
import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { withTestDatabase, seedWorkspace } from '@mlain/db/testing';
import { withCrossWorkspaceTx, withTrackingTx } from '../../tracking/repo/tx';

const db = withTestDatabase();

describe('transakční obal domény', () => {
  it('withTrackingTx nastaví mlain.workspace_id, takže RLS pustí řádky projektu', async () => {
    const { workspaceId } = await seedWorkspace(db);
    const seen = await withTrackingTx(workspaceId, 'tracking.test', async (tx) => {
      const { rows } = await tx.execute<{ ws: string | null }>(
        sql`SELECT current_setting('mlain.workspace_id', true) AS ws`,
      );
      return rows[0]!.ws;
    });
    expect(seen).toBe(workspaceId);
  });

  it('withCrossWorkspaceTx kontext nenastavuje', async () => {
    const seen = await withCrossWorkspaceTx('tracking.test', async (tx) => {
      const { rows } = await tx.execute<{ ws: string | null }>(
        sql`SELECT current_setting('mlain.workspace_id', true) AS ws`,
      );
      return rows[0]!.ws;
    });
    expect(seen === null || seen === '').toBe(true);
  });

  it('tx.execute vrací QueryResult s .rows, ne pole', async () => {
    // Pojistka proti vzoru `const rows = await tx.execute(...); rows[0]`,
    // který projde typovou kontrolou a za běhu vždycky vrátí undefined.
    const result = await withCrossWorkspaceTx('tracking.test', (tx) =>
      tx.execute<{ n: number }>(sql`SELECT 42::int AS n`),
    );
    expect(Array.isArray(result)).toBe(false);
    expect(result.rows[0]!.n).toBe(42);
    expect((result as unknown as unknown[])[0]).toBeUndefined();
  });

  it('pole se do šablony předává přes sql.param, holé pole je record', async () => {
    // Ověřeno spuštěním: `${ids}::uuid[]` drizzle rozloží na ($1, $2, $3),
    // což je record, a dotaz skončí chybou 42846.
    const ids = [
      '0192f3a0-1c2d-7e50-8a1b-2c3d4e5f6071',
      '0192f3a0-1c2d-7e50-8a1b-2c3d4e5f6072',
    ];
    const ok = await withCrossWorkspaceTx('tracking.test', async (tx) => {
      const { rows } = await tx.execute<{ id: string }>(
        sql`SELECT unnest(${sql.param(ids)}::uuid[]) AS id`,
      );
      return rows.map((r) => r.id);
    });
    expect(ok).toEqual(ids);

    await expect(
      withCrossWorkspaceTx('tracking.test', (tx) =>
        tx.execute(sql`SELECT unnest(${ids}::uuid[])`),
      ),
    ).rejects.toThrow();
  });
});
```

Run: `pnpm vitest run packages/core/test/tracking/tx.db.test.ts`
Expected: PASS, 4 testy. Poslední ověřuje i **negativní** větev, tedy že holé pole opravdu spadne. Kdyby prošlo, znamená to, že se změnilo chování `sql` v drizzle a všech 43 míst v tomhle plánu je potřeba projít znovu.

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/message-lookup.db.test.ts
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { withTestDatabase, seedMessage, seedCampaign } from '@mlain/db/testing';
import { lookupMessage } from '../../tracking/tokens/message-lookup';
import { trackingMetrics } from '../../tracking/metrics';

const db = withTestDatabase();

describe('lookupMessage', () => {
  let workspaceId: string;
  let campaignId: string;
  let messageId: string;
  const createdAt = new Date('2026-07-25T16:00:00.000Z');

  beforeAll(async () => {
    ({ workspaceId, campaignId } = await seedCampaign(db, { audienceBuiltAt: createdAt }));
    ({ messageId } = await seedMessage(db, { workspaceId, campaignId, createdAt }));
  });

  it('najde zprávu rovnostním dotazem podle obou složek klíče', async () => {
    const row = await lookupMessage({ workspaceId, messageId, messageCreatedAt: 1784995200 });
    expect(row).not.toBeNull();
    expect(row!.campaignId).toBe(campaignId);
  });

  it('neshoda o půl sekundy se najde fallbackem', async () => {
    const row = await lookupMessage({ workspaceId, messageId, messageCreatedAt: 1784995199 });
    expect(row).not.toBeNull();
  });

  it('zpráva z jiného projektu se nevrátí ani při shodě obou složek klíče', async () => {
    const other = await seedCampaign(db, { audienceBuiltAt: createdAt });
    const row = await lookupMessage({
      workspaceId: other.workspaceId,
      messageId,
      messageCreatedAt: 1784995200,
    });
    expect(row).toBeNull();
  });

  it('nenalezení zvýší tracking_message_lookup_miss_total a vrátí null', async () => {
    const spy = vi.spyOn(trackingMetrics.messageLookupMiss, 'inc');
    const row = await lookupMessage({
      workspaceId,
      messageId: '0192f3a0-1c2d-7e41-8b2c-000000000000',
      messageCreatedAt: 1784995200,
    });
    expect(row).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('plán obou dotazů je Index Scan nad jednou partition, nikdy Seq Scan', async () => {
    // Jména oddílů se berou z katalogu, ne z regulárního výrazu nad konvencí
    // pojmenování. Konvenci vlastní P03 a kdyby ji změnil, regex by přestal
    // sedět a test by prošel s nulou nalezených oddílů, tedy zeleně a naprázdno.
    const { rows: parts } = await db.query<{ name: string }>(
      `SELECT c.relname AS name
         FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
        WHERE i.inhparent = 'messages'::regclass`,
    );
    expect(parts.length).toBeGreaterThan(1); // jinak by test nic neměřil

    const plan = await db.explain(
      `SELECT id, created_at, campaign_id, contact_id, workspace_id, sent_at
         FROM messages WHERE id = $1 AND created_at = to_timestamp($2)`,
      [messageId, 1784995200],
    );
    expect(plan).not.toContain('Seq Scan');
    expect(parts.filter((p) => plan.includes(p.name))).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/message-lookup.db.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/tokens/message-lookup"`.

- [ ] **Step 3: Napiš repository**

```ts
// packages/core/tracking/repo/messages.repo.ts
import { sql } from 'drizzle-orm';
import { withTrackingTx } from './tx';

export type MessageRow = {
  id: string;
  createdAt: Date;
  campaignId: string;
  contactId: string | null;
  workspaceId: string;
  sentAt: Date | null;
};

/** Rovnostní dotaz podle obou složek primárního klíče. Jedna partition, jeden Index Scan. */
export async function selectMessageExact(
  workspaceId: string,
  messageId: string,
  createdAtSeconds: number,
): Promise<MessageRow | null> {
  return withTrackingTx(workspaceId, 'tracking.message_lookup', async (tx) => {
    const { rows } = await tx.execute<MessageRow>(sql`
      SELECT id, created_at AS "createdAt", campaign_id AS "campaignId",
             contact_id AS "contactId", workspace_id AS "workspaceId", sent_at AS "sentAt"
        FROM messages
       WHERE id = ${messageId}
         AND created_at = to_timestamp(${createdAtSeconds})
         AND workspace_id = ${workspaceId}
    `);
    return rows[0] ?? null;
  });
}

/**
 * Fallback pro zaokrouhlení na hranici sekundy. Pořád nejvýš dvě partition.
 * Dotaz bez podmínky na created_at se tady nesmí objevit nikdy.
 */
export async function selectMessageNear(
  workspaceId: string,
  messageId: string,
  createdAtSeconds: number,
): Promise<MessageRow | null> {
  return withTrackingTx(workspaceId, 'tracking.message_lookup', async (tx) => {
    const { rows } = await tx.execute<MessageRow>(sql`
      SELECT id, created_at AS "createdAt", campaign_id AS "campaignId",
             contact_id AS "contactId", workspace_id AS "workspaceId", sent_at AS "sentAt"
        FROM messages
       WHERE id = ${messageId}
         AND workspace_id = ${workspaceId}
         AND created_at >= to_timestamp(${createdAtSeconds}) - interval '1 second'
         AND created_at <  to_timestamp(${createdAtSeconds}) + interval '2 seconds'
       LIMIT 1
    `);
    return rows[0] ?? null;
  });
}

/** Cíl přesměrování a jeho kampaň. campaign_links není partitionovaná. */
export type CampaignLinkRow = {
  id: string;
  url: string;
  campaignId: string;
  workspaceId: string;
  position: number;
};

export async function selectCampaignLinksByLinkId(
  workspaceId: string,
  linkId: string,
): Promise<CampaignLinkRow[]> {
  return withTrackingTx(workspaceId, 'tracking.link_cache', async (tx) =>
    (await tx.execute<CampaignLinkRow>(sql`
      SELECT id, url, campaign_id AS "campaignId", workspace_id AS "workspaceId", position
        FROM campaign_links
       WHERE campaign_id = (SELECT campaign_id FROM campaign_links WHERE id = ${linkId})
    `)).rows,
  );
}
```

- [ ] **Step 4: Napiš dohledání**

```ts
// packages/core/tracking/tokens/message-lookup.ts
import { logger } from '@mlain/core/logging';
import { trackingMetrics } from '../metrics';
import { selectMessageExact, selectMessageNear, type MessageRow } from '../repo/messages.repo';

export type LookupInput = {
  workspaceId: string;
  messageId: string;
  /** Unixové sekundy z tokenu. Lokátor partition. */
  messageCreatedAt: number;
};

/**
 * Chování podle 3.1.2.2 části 5.
 * 1. rovnost, 2. okno jedné sekundy, 3. null plus čítač. Krok 4 zní: NIKDY dotaz
 * bez podmínky na created_at. Růst čítače je alert, protože znamená porušený invariant I1.
 */
export async function lookupMessage(input: LookupInput): Promise<MessageRow | null> {
  const exact = await selectMessageExact(input.workspaceId, input.messageId, input.messageCreatedAt);
  if (exact !== null) return exact;

  const near = await selectMessageNear(input.workspaceId, input.messageId, input.messageCreatedAt);
  if (near !== null) return near;

  trackingMetrics.messageLookupMiss.inc();
  logger.warn(
    { workspace_id: input.workspaceId, message_id: input.messageId },
    'tracking_message_lookup_miss',
  );
  return null;
}
```

- [ ] **Step 5: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/message-lookup.db.test.ts`
Expected: PASS, 5 testů.

- [ ] **Step 6: Commit**

```bash
git add packages/core/tracking/repo/messages.repo.ts packages/core/tracking/tokens/message-lookup.ts packages/core/test/tracking/message-lookup.db.test.ts
git commit -m "feat(tracking): look up message by both primary key parts from token"
```

---

### Task 9: Odpověď open pixelu

Odpověď je **vždy stejná**, ať je token platný nebo ne. Odlišná odpověď by z endpointu udělala orákulum, ze kterého jde uhádnout platnost tokenu, a v některých poštovních klientech by se místo neviditelného pixelu ukázal křížek rozbitého obrázku.

**Files:**
- Create: `packages/core/tracking/open/gif.ts`
- Test: `packages/core/test/tracking/gif.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/gif.test.ts
import { describe, expect, it } from 'vitest';
import { PIXEL_GIF, PIXEL_HEADERS } from '../../tracking/open/gif';

describe('open pixel response', () => {
  it('tělo má přesně 42 bajtů a odpovídá průhlednému GIFu 1x1', () => {
    expect(PIXEL_GIF).toHaveLength(42);
    expect(PIXEL_GIF.toString('hex')).toBe(
      '47494638396101000100800000000000ffffff21f90401000000002c000000000100010000020144003b',
    );
  });

  it('base64 podoba sedí na hodnotu z 3.2.2', () => {
    expect(PIXEL_GIF.toString('base64')).toBe(
      'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    );
  });

  it('hlavičky zakazují kešování a únik referreru', () => {
    expect(PIXEL_HEADERS['Content-Type']).toBe('image/gif');
    expect(PIXEL_HEADERS['Content-Length']).toBe('42');
    expect(PIXEL_HEADERS['Cache-Control']).toContain('no-store');
    expect(PIXEL_HEADERS['Referrer-Policy']).toBe('no-referrer');
    expect(PIXEL_HEADERS['X-Content-Type-Options']).toBe('nosniff');
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/gif.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/open/gif"`.

- [ ] **Step 3: Napiš konstantu**

```ts
// packages/core/tracking/open/gif.ts

/**
 * Průhledný GIF 1x1, 42 bajtů. Konstanta, ne generovaná hodnota:
 * pixel se vrací u každého otevření a nemá smysl ho skládat za běhu.
 */
export const PIXEL_GIF: Buffer = Buffer.from(
  '47494638396101000100800000000000ffffff21f90401000000002c000000000100010000020144003b',
  'hex',
);

/**
 * Hlavičky z 3.2.2. Cache-Control je jediné, čím můžeme proxy požádat,
 * aby si pixel neuložila. Uloží si ho stejně, ale zkusit se to musí.
 */
export const PIXEL_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Content-Type': 'image/gif',
  'Content-Length': String(PIXEL_GIF.length),
  'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0, private',
  Pragma: 'no-cache',
  Expires: '0',
  'Referrer-Policy': 'no-referrer',
  'X-Content-Type-Options': 'nosniff',
});
```

- [ ] **Step 4: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/gif.test.ts`
Expected: PASS, 3 testy.

- [ ] **Step 5: Commit**

```bash
git add packages/core/tracking/open/gif.ts packages/core/test/tracking/gif.test.ts
git commit -m "feat(tracking): add constant 1x1 pixel response"
```

---

### Task 10: Pravidla nad `User-Agent`

Knihovnu na parsování `User-Agent` **nepoužíváme**: `ua-parser-js` 2.x je AGPL a `device-detector-js` je LGPL, obojí je v konfliktu s MIT distribucí a job `licenses-node` na obojím padá. Seznam crawlerů bereme z `crawler-user-agents` (MIT), zbytek jsou naše regulární výrazy.

Pravidlo 4 (`User-Agent` je přesně `Mozilla/5.0`) je klíčové pro Apple MPP a stojí na empirickém zjištění. **Apple to může kdykoliv změnit bez ohlášení**, proto je to datová tabulka, ne podmínka zadrátovaná v kódu, a podíly tříd se sledují metrikou.

**Files:**
- Create: `packages/core/tracking/open/ua-rules.ts`
- Test: `packages/core/test/tracking/ua-rules.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/ua-rules.test.ts
import { describe, expect, it } from 'vitest';
import {
  APPLE_MPP_EXACT_UA,
  IMAGE_PROXY_RE,
  MAIL_CLIENT_RE,
  BROWSER_RE,
  SCANNER_RE,
  SECURITY_PROXY_RE,
  isCrawlerUserAgent,
  isPrefetchRequest,
} from '../../tracking/open/ua-rules';

describe('ua rules', () => {
  it('rozpozná známého crawlera', () => {
    expect(isCrawlerUserAgent('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')).toBe(true);
    expect(isCrawlerUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15')).toBe(false);
  });

  it('Apple proxy posílá doslova Mozilla/5.0 bez dalších tokenů', () => {
    expect(APPLE_MPP_EXACT_UA).toBe('Mozilla/5.0');
    expect('  Mozilla/5.0  '.trim()).toBe(APPLE_MPP_EXACT_UA);
  });

  it('rozpozná obrazové proxy Googlu', () => {
    expect(IMAGE_PROXY_RE.test('GoogleImageProxy')).toBe(true);
    expect(IMAGE_PROXY_RE.test('Mozilla/5.0 via ggpht.com GoogleImageProxy')).toBe(true);
  });

  it('rozpozná bezpečnostní proxy poštovních bran', () => {
    for (const ua of ['YahooMailProxy', 'Barracuda Sentinel', 'ProofPoint-Scanner']) {
      expect(SECURITY_PROXY_RE.test(ua)).toBe(true);
    }
  });

  it('rozpozná bezpečnostní skenery odkazů', () => {
    for (const ua of ['Safelinks', 'ProofPoint', 'Mimecast', 'Barracuda', 'urldefense', 'Symantec', 'FireEye']) {
      expect(SCANNER_RE.test(ua)).toBe(true);
    }
  });

  it('rozpozná poštovní klienty a prohlížeče', () => {
    expect(MAIL_CLIENT_RE.test('Microsoft Outlook 16.0')).toBe(true);
    expect(MAIL_CLIENT_RE.test('Mozilla/5.0 (Macintosh) Thunderbird/128.0')).toBe(true);
    expect(BROWSER_RE.test('Mozilla/5.0 (Windows NT 10.0) Chrome/140.0.0.0 Safari/537.36')).toBe(true);
  });

  it('rozpozná prefetch podle všech čtyř hlaviček', () => {
    expect(isPrefetchRequest({ purpose: 'prefetch' })).toBe(true);
    expect(isPrefetchRequest({ 'x-purpose': 'preview' })).toBe(true);
    expect(isPrefetchRequest({ 'x-moz': 'prefetch' })).toBe(true);
    expect(isPrefetchRequest({ 'sec-purpose': 'prefetch;prerender' })).toBe(true);
    expect(isPrefetchRequest({ 'user-agent': 'Chrome' })).toBe(false);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/ua-rules.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/open/ua-rules"`.

- [ ] **Step 3: Nainstaluj `crawler-user-agents`**

```bash
pnpm --filter @mlain/core add crawler-user-agents@1.56.0
```

Ověř licenci dřív, než pokračuješ:

```bash
pnpm --filter @mlain/core exec npm view crawler-user-agents license
```

Expected: `MIT`. Když vyjde cokoliv jiného, zastav se a nahlas to, brána `licenses-node` by tě stejně zastavila později a hůř.

- [ ] **Step 4: Napiš pravidla**

```ts
// packages/core/tracking/open/ua-rules.ts
import crawlers from 'crawler-user-agents';

/**
 * Regulární výrazy nad User-Agent. Žádná knihovna na parsování UA:
 * ua-parser-js 2.x je AGPL-3.0-or-later a device-detector-js je LGPL-3.0,
 * obojí je zakázané a CI job licenses-node na obojím padá.
 */

const CRAWLER_RES: readonly RegExp[] = (crawlers as Array<{ pattern: string }>).map(
  (entry) => new RegExp(entry.pattern, 'i'),
);

export function isCrawlerUserAgent(userAgent: string): boolean {
  if (userAgent === '') return false;
  return CRAWLER_RES.some((re) => re.test(userAgent));
}

/**
 * Apple Mail Privacy Protection posílá doslova tenhle řetězec bez dalších tokenů,
 * což žádný skutečný klient nedělá. Je to heuristika, ne jistota, a Apple ji může
 * kdykoliv změnit bez ohlášení. Proto je to hodnota v tabulce, ne podmínka v kódu,
 * a proto se podíly tříd sledují metrikou tracking_open_total{class}.
 */
export const APPLE_MPP_EXACT_UA = 'Mozilla/5.0';

/** Gmail a jiné obrazové proxy. Obvykle skutečné otevření, ale nespolehlivý čas. */
export const IMAGE_PROXY_RE = /GoogleImageProxy|via ggpht\.com/i;

/** Poštovní brány, které stahují obrázky samy od sebe. */
export const SECURITY_PROXY_RE = /YahooMailProxy|Barracuda|ProofPoint/i;

/** Bezpečnostní filtry, které po doručení navštíví každý odkaz. */
export const SCANNER_RE = /Safelinks|ProofPoint|Mimecast|Barracuda|urldefense|Symantec|FireEye/i;

/** Známé poštovní klienty. */
export const MAIL_CLIENT_RE =
  /Outlook|Microsoft Office|Thunderbird|AppleMail|Apple-Mail|Airmail|Spark|Superhuman|Edison|BlueMail|em[Cc]lient|Postbox|Evolution|KMail|Zimbra|Roundcube/i;

/** Běžné prohlížeče, tedy webmail s otevřenými obrázky. */
export const BROWSER_RE = /(Chrome|Chromium|Firefox|Safari|Edg|OPR|SamsungBrowser)\/[\d.]+/i;

const PREFETCH_HEADERS = ['purpose', 'x-purpose', 'x-moz', 'sec-purpose'] as const;

/**
 * Prefetch a preview. Prohlížeč nebo klient si stránku stáhne dopředu,
 * aniž ji člověk viděl, takže to není otevření ani proklik.
 */
export function isPrefetchRequest(headers: Record<string, string | undefined>): boolean {
  for (const name of PREFETCH_HEADERS) {
    const value = headers[name]?.toLowerCase();
    if (value === undefined) continue;
    if (value.includes('prefetch') || value.includes('preview') || value.includes('prerender')) {
      return true;
    }
  }
  return false;
}
```

- [ ] **Step 5: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/ua-rules.test.ts`
Expected: PASS, 7 testů.

- [ ] **Step 6: Ověř licenční bránu**

Run: `pnpm licenses:check`
Expected: PASS, žádný zakázaný balíček.

- [ ] **Step 7: Commit**

```bash
git add packages/core/tracking/open/ua-rules.ts packages/core/test/tracking/ua-rules.test.ts packages/core/package.json pnpm-lock.yaml
git commit -m "feat(tracking): add user agent rules without copyleft dependencies"
```

---

### Task 11: Rozsahy obrazových proxy

**V MVP 0 se tabulka `proxy_ranges` plní jen ručně vloženými rozsahy a pevným `17.0.0.0/8`.** Stažení Apple seznamu je ve výchozím stavu **vypnuté** a zapíná se `TRACKING_APPLE_RELAY_RANGES`. Má to dva důvody a oba jsou věcné: tytéž rozsahy používá Private Relay pro běžné surfování v Safari, takže při použití na webové události by označily skutečné návštěvníky za proxy, a 287 tisíc CIDR bloků v paměti je pro self-hostera zbytečná zátěž, když pravidlo nad `User-Agent` pokryje drtivou většinu případů.

Seznam se proto smí použít **jen** pro klasifikaci otevření e-mailu, nikdy pro web SDK. Vynucuje to podpis funkce: `matchProxyRange` bere `purpose: 'email_open'` a jinou hodnotu nepřijme.

**Files:**
- Create: `packages/core/tracking/open/proxy-ranges.ts`
- Test: `packages/core/test/tracking/proxy-ranges.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/proxy-ranges.test.ts
import { describe, expect, it } from 'vitest';
import { APPLE_FIXED_CIDR, ProxyRangeIndex } from '../../tracking/open/proxy-ranges';

describe('ProxyRangeIndex', () => {
  it('pevný Apple rozsah je 17.0.0.0/8 a platí i bez staženého seznamu', () => {
    expect(APPLE_FIXED_CIDR).toBe('17.0.0.0/8');
    const index = new ProxyRangeIndex([]);
    expect(index.match('17.133.1.1', 'email_open')).toBe('apple_private_relay');
    expect(index.match('18.133.1.1', 'email_open')).toBeNull();
  });

  it('ručně vložené rozsahy se vyhodnocují vždy', () => {
    const index = new ProxyRangeIndex([
      { provider: 'manual', cidr: '203.0.113.0/24' },
    ]);
    expect(index.match('203.0.113.7', 'email_open')).toBe('manual');
    expect(index.match('203.0.114.7', 'email_open')).toBe(null);
  });

  it('stažené Apple rozsahy se použijí jen při zapnutém přepínači', () => {
    const ranges = [{ provider: 'apple_private_relay' as const, cidr: '172.224.226.0/27' }];
    const off = new ProxyRangeIndex(ranges, { useAppleRelayRanges: false });
    const on = new ProxyRangeIndex(ranges, { useAppleRelayRanges: true });
    expect(off.match('172.224.226.5', 'email_open')).toBeNull();
    expect(on.match('172.224.226.5', 'email_open')).toBe('apple_private_relay');
  });

  it('IPv6 adresa nespadne a vrátí null, když není v žádném rozsahu', () => {
    const index = new ProxyRangeIndex([]);
    expect(index.match('2001:db8::1', 'email_open')).toBeNull();
  });

  it('nesmyslná adresa vrátí null, ne výjimku', () => {
    const index = new ProxyRangeIndex([]);
    expect(index.match('není-ip', 'email_open')).toBeNull();
  });

  it('parsování Apple CSV vezme první pole a přeskočí prázdné řádky', () => {
    const csv = '172.224.226.0/27,GB,GB-EN,London,\n172.224.226.32/31,GB,GB-SC,Aberdeen,\n\n';
    expect(ProxyRangeIndex.parseAppleCsv(csv)).toEqual(['172.224.226.0/27', '172.224.226.32/31']);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/proxy-ranges.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/open/proxy-ranges"`.

- [ ] **Step 3: Nainstaluj `ipaddr.js`**

```bash
pnpm --filter @mlain/core add ipaddr.js@2.4.0
pnpm --filter @mlain/core exec npm view ipaddr.js license
```

Expected: `MIT`.

- [ ] **Step 4: Napiš index rozsahů**

```ts
// packages/core/tracking/open/proxy-ranges.ts
import ipaddr from 'ipaddr.js';

export type ProxyProvider = 'apple_private_relay' | 'google' | 'manual';
export type ProxyRange = { provider: ProxyProvider; cidr: string };

/** Účel je součástí podpisu schválně, viz 3.3.3: seznam se nikdy nesmí použít na web. */
export type ProxyMatchPurpose = 'email_open';

/**
 * Apple drží celý blok 17.0.0.0/8. Platí vždy, i když je stahování seznamu vypnuté,
 * protože to není stažená informace, ale veřejně známé přidělení adresního prostoru.
 */
export const APPLE_FIXED_CIDR = '17.0.0.0/8';

type ParsedRange = { provider: ProxyProvider; range: [ipaddr.IPv4 | ipaddr.IPv6, number] };

export type ProxyRangeIndexOptions = { useAppleRelayRanges?: boolean };

export class ProxyRangeIndex {
  readonly #v4: ParsedRange[] = [];
  readonly #v6: ParsedRange[] = [];

  constructor(ranges: readonly ProxyRange[], options: ProxyRangeIndexOptions = {}) {
    const useApple = options.useAppleRelayRanges ?? false;
    const effective: ProxyRange[] = [{ provider: 'apple_private_relay', cidr: APPLE_FIXED_CIDR }];

    for (const range of ranges) {
      if (range.provider === 'apple_private_relay' && !useApple) continue;
      effective.push(range);
    }

    for (const entry of effective) {
      let parsed: [ipaddr.IPv4 | ipaddr.IPv6, number];
      try {
        parsed = ipaddr.parseCIDR(entry.cidr);
      } catch {
        continue; // vadný rozsah v tabulce nesmí shodit klasifikaci
      }
      const bucket = parsed[0].kind() === 'ipv4' ? this.#v4 : this.#v6;
      bucket.push({ provider: entry.provider, range: parsed });
    }
  }

  match(ip: string, purpose: ProxyMatchPurpose): ProxyProvider | null {
    if (purpose !== 'email_open') return null;
    let address: ipaddr.IPv4 | ipaddr.IPv6;
    try {
      address = ipaddr.parse(ip);
    } catch {
      return null;
    }
    const bucket = address.kind() === 'ipv4' ? this.#v4 : this.#v6;
    for (const entry of bucket) {
      if (address.match(entry.range as never)) return entry.provider;
    }
    return null;
  }

  /** Formát `cidr,country,region,city,` s prázdným posledním polem. */
  static parseAppleCsv(csv: string): string[] {
    const out: string[] = [];
    for (const line of csv.split('\n')) {
      const cidr = line.split(',')[0]?.trim();
      if (cidr === undefined || cidr === '') continue;
      out.push(cidr);
    }
    return out;
  }
}
```

- [ ] **Step 5: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/proxy-ranges.test.ts`
Expected: PASS, 6 testů.

- [ ] **Step 6: Commit**

```bash
git add packages/core/tracking/open/proxy-ranges.ts packages/core/test/tracking/proxy-ranges.test.ts packages/core/package.json pnpm-lock.yaml
git commit -m "feat(tracking): add proxy range index seeded with fixed apple block"
```

---

### Task 12: Klasifikace otevření

Jedenáct pravidel, **první shoda vyhrává**, pořadí je závazné. Klasifikace se **nikdy nemaže**: otevření se uloží se svou třídou a v reportu se z něj počítají tři různá čísla. Uživatel může přepnout pohled, ale nikdy nemůže původní data ztratit.

Jediná výjimka je třída `bot`: ta se do `message_events` neukládá vůbec, protože crawler není člověk ani jeho poštovní klient a jeho započítání by čísla jen nafouklo.

**Files:**
- Create: `packages/core/tracking/open/classify-open.ts`
- Test: `packages/core/test/tracking/classify-open.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/classify-open.test.ts
import { describe, expect, it } from 'vitest';
import { ProxyRangeIndex } from '../../tracking/open/proxy-ranges';
import { classifyOpen } from '../../tracking/open/classify-open';

const index = new ProxyRangeIndex([]);
const classify = (input: Parameters<typeof classifyOpen>[0]) =>
  classifyOpen({ proxyRanges: index, ...input });

describe('classifyOpen', () => {
  it('pravidlo 1: crawler je bot a vyhrává nad vším ostatním', () => {
    expect(classify({ userAgent: 'Googlebot/2.1', method: 'GET', headers: {}, ip: '17.1.1.1' })).toBe('bot');
  });

  it('pravidlo 2: prefetch hlavička je bot', () => {
    expect(classify({ userAgent: 'Chrome/140.0', method: 'GET', headers: { purpose: 'prefetch' }, ip: null })).toBe('bot');
  });

  it('pravidlo 3: metoda HEAD je bot', () => {
    expect(classify({ userAgent: 'Chrome/140.0', method: 'HEAD', headers: {}, ip: null })).toBe('bot');
  });

  it('pravidlo 4: přesně Mozilla/5.0 je proxy_apple', () => {
    expect(classify({ userAgent: 'Mozilla/5.0', method: 'GET', headers: {}, ip: null })).toBe('proxy_apple');
    expect(classify({ userAgent: '  Mozilla/5.0 ', method: 'GET', headers: {}, ip: null })).toBe('proxy_apple');
  });

  it('pravidlo 4 nesmí chytit skutečný klient, který Mozilla/5.0 jen začíná', () => {
    expect(
      classify({ userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0.0.0', method: 'GET', headers: {}, ip: null }),
    ).toBe('human');
  });

  it('pravidlo 5: IP v 17.0.0.0/8 je proxy_apple i při neznámém UA', () => {
    expect(classify({ userAgent: 'cosi neznámého', method: 'GET', headers: {}, ip: '17.133.1.1' })).toBe('proxy_apple');
  });

  it('pravidlo 7: GoogleImageProxy je proxy_image', () => {
    expect(classify({ userAgent: 'GoogleImageProxy', method: 'GET', headers: {}, ip: null })).toBe('proxy_image');
  });

  it('pravidlo 8: poštovní bezpečnostní proxy je bot', () => {
    expect(classify({ userAgent: 'Barracuda Sentinel', method: 'GET', headers: {}, ip: null })).toBe('bot');
  });

  it('pravidlo 9: poštovní klient je human', () => {
    expect(classify({ userAgent: 'Microsoft Outlook 16.0', method: 'GET', headers: {}, ip: null })).toBe('human');
  });

  it('pravidlo 11: nic nesedí, tedy unknown', () => {
    expect(classify({ userAgent: 'curl/8.5.0', method: 'GET', headers: {}, ip: null })).toBe('unknown');
  });

  it('prázdný User-Agent je unknown, ne human', () => {
    expect(classify({ userAgent: '', method: 'GET', headers: {}, ip: null })).toBe('unknown');
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/classify-open.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/open/classify-open"`.

- [ ] **Step 3: Napiš klasifikaci**

```ts
// packages/core/tracking/open/classify-open.ts
import type { OpenClass } from '../types';
import type { ProxyRangeIndex } from './proxy-ranges';
import {
  APPLE_MPP_EXACT_UA,
  BROWSER_RE,
  IMAGE_PROXY_RE,
  MAIL_CLIENT_RE,
  SECURITY_PROXY_RE,
  isCrawlerUserAgent,
  isPrefetchRequest,
} from './ua-rules';

export type ClassifyOpenInput = {
  userAgent: string;
  method: string;
  headers: Record<string, string | undefined>;
  ip: string | null;
  proxyRanges: ProxyRangeIndex;
};

/**
 * Jedenáct pravidel z 3.3.2, první shoda vyhrává. Pořadí je závazné.
 * Klasifikace se nikdy nemaže: report z ní počítá tři různá čísla a uživatel
 * jen přepíná pohled, nikdy neztrácí původní data.
 */
export function classifyOpen(input: ClassifyOpenInput): OpenClass {
  const ua = input.userAgent.trim();

  // 1. známý crawler
  if (isCrawlerUserAgent(ua)) return 'bot';

  // 2. prefetch a preview
  if (isPrefetchRequest(input.headers)) return 'bot';

  // 3. HEAD
  if (input.method.toUpperCase() === 'HEAD') return 'bot';

  // 4. Apple Mail Privacy Protection posílá doslova Mozilla/5.0 bez dalších tokenů
  if (ua === APPLE_MPP_EXACT_UA) return 'proxy_apple';

  // 5. a 6. Apple adresní prostor. Pevný blok platí vždy, stažené rozsahy jen při
  //         zapnutém tracking.use_apple_relay_ranges, což řeší ProxyRangeIndex.
  if (input.ip !== null && input.proxyRanges.match(input.ip, 'email_open') === 'apple_private_relay') {
    return 'proxy_apple';
  }

  // 7. obrazové proxy
  if (IMAGE_PROXY_RE.test(ua)) return 'proxy_image';

  // 8. poštovní bezpečnostní proxy
  if (SECURITY_PROXY_RE.test(ua)) return 'bot';

  // 9. známý poštovní klient
  if (MAIL_CLIENT_RE.test(ua)) return 'human';

  // 10. běžný prohlížeč, tedy webmail s otevřenými obrázky
  if (BROWSER_RE.test(ua)) return 'human';

  // 11. nestačí signály
  return 'unknown';
}

/** Třída bot se do message_events neukládá vůbec, viz 3.3.4. */
export function isPersistedOpenClass(cls: OpenClass): boolean {
  return cls !== 'bot';
}

/** Ověřené otevření je human nebo proxy_image, viz 3.3.4. */
export function isVerifiedOpenClass(cls: OpenClass): boolean {
  return cls === 'human' || cls === 'proxy_image';
}
```

- [ ] **Step 4: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/classify-open.test.ts`
Expected: PASS, 11 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/tracking/open/classify-open.ts packages/core/test/tracking/classify-open.test.ts
git commit -m "feat(tracking): classify email opens with eleven ordered rules"
```

---

### Task 13: Zapisovač otevření a prokliků

Endpointy `/t/o/` a `/t/c/` **nepíšou do databáze synchronně**. Zapisují do bufferu v procesu, který se vyprazdňuje po 250 ms nebo po 500 položkách.

**Přiznaný kompromis:** tvrdý pád procesu (SIGKILL, OOM, výpadek napájení) ztratí až 250 ms kliků. Při rozesílce 100 zpráv za sekundu a tříprocentní okamžité prokliknutosti jsou to jednotky událostí. Alternativa, tedy synchronní zápis, by ztrojnásobila latenci přesměrování pro každého uživatele. Kompromis je vědomý a patří do provozní dokumentace.

**Files:**
- Create: `packages/core/tracking/writer/event-buffer.ts`
- Test: `packages/core/test/tracking/event-buffer.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/event-buffer.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EventBuffer } from '../../tracking/writer/event-buffer';

type Item = { n: number };

describe('EventBuffer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('vyprázdní se po uplynutí intervalu', async () => {
    const flushed: Item[][] = [];
    const buffer = new EventBuffer<Item>({
      flushMs: 250, batchSize: 500, capacity: 100, flush: async (b) => { flushed.push(b); },
    });
    buffer.push({ n: 1 });
    expect(flushed).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(250);
    expect(flushed).toEqual([[{ n: 1 }]]);
  });

  it('vyprázdní se po dosažení velikosti dávky, aniž se čeká na interval', async () => {
    const flushed: Item[][] = [];
    const buffer = new EventBuffer<Item>({
      flushMs: 250, batchSize: 3, capacity: 100, flush: async (b) => { flushed.push(b); },
    });
    buffer.push({ n: 1 });
    buffer.push({ n: 2 });
    buffer.push({ n: 3 });
    await vi.advanceTimersByTimeAsync(0);
    expect(flushed).toEqual([[{ n: 1 }, { n: 2 }, { n: 3 }]]);
  });

  it('při plném bufferu zahodí nejstarší a zvýší čítač', () => {
    const dropped: number[] = [];
    const buffer = new EventBuffer<Item>({
      flushMs: 250, batchSize: 500, capacity: 2,
      flush: async () => {}, onDrop: (count) => dropped.push(count),
    });
    buffer.push({ n: 1 });
    buffer.push({ n: 2 });
    buffer.push({ n: 3 });
    expect(dropped).toEqual([1]);
    expect(buffer.size).toBe(2);
  });

  it('chyba zápisu se zkusí třikrát s odstupem 100, 300 a 900 ms, pak se zahodí', async () => {
    const attempts: number[] = [];
    const buffer = new EventBuffer<Item>({
      flushMs: 250, batchSize: 500, capacity: 100,
      flush: async () => { attempts.push(Date.now()); throw new Error('nedostupná databáze'); },
    });
    buffer.push({ n: 1 });
    await vi.advanceTimersByTimeAsync(250);
    await vi.advanceTimersByTimeAsync(100);
    await vi.advanceTimersByTimeAsync(300);
    await vi.advanceTimersByTimeAsync(900);
    expect(attempts).toHaveLength(4); // první pokus plus tři opakování
    expect(buffer.size).toBe(0);
  });

  it('shutdown vyprázdní zbytek před ukončením', async () => {
    const flushed: Item[][] = [];
    const buffer = new EventBuffer<Item>({
      flushMs: 250, batchSize: 500, capacity: 100, flush: async (b) => { flushed.push(b); },
    });
    buffer.push({ n: 7 });
    await buffer.shutdown();
    expect(flushed).toEqual([[{ n: 7 }]]);
  });

  it('po shutdown se nová položka odmítne, ne tiše zahodí', async () => {
    const buffer = new EventBuffer<Item>({
      flushMs: 250, batchSize: 500, capacity: 100, flush: async () => {},
    });
    await buffer.shutdown();
    expect(() => buffer.push({ n: 1 })).toThrow(/shutdown/);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/event-buffer.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/writer/event-buffer"`.

- [ ] **Step 3: Napiš buffer**

```ts
// packages/core/tracking/writer/event-buffer.ts
import { logger } from '@mlain/core/logging';

const RETRY_DELAYS_MS = [100, 300, 900] as const;

export type EventBufferOptions<T> = {
  flushMs: number;
  batchSize: number;
  capacity: number;
  flush: (batch: T[]) => Promise<void>;
  onDrop?: (count: number) => void;
  onFlushDuration?: (seconds: number) => void;
};

/**
 * Buffer v procesu pro otevření a prokliky. Odpověď na požadavek se neblokuje
 * na databázi, viz 3.9.1. Tvrdý pád procesu ztratí až jeden interval, což je
 * vědomý a zapsaný kompromis proti ztrojnásobení latence přesměrování.
 */
export class EventBuffer<T> {
  #items: T[] = [];
  #timer: NodeJS.Timeout | null = null;
  #closed = false;
  #inFlight: Promise<void> = Promise.resolve();
  readonly #options: EventBufferOptions<T>;

  constructor(options: EventBufferOptions<T>) {
    this.#options = options;
  }

  get size(): number {
    return this.#items.length;
  }

  push(item: T): void {
    if (this.#closed) throw new Error('EventBuffer je po shutdown a nepřijímá další položky');

    if (this.#items.length >= this.#options.capacity) {
      const overflow = this.#items.length - this.#options.capacity + 1;
      this.#items.splice(0, overflow);
      this.#options.onDrop?.(overflow);
      logger.warn({ dropped: overflow }, 'tracking_writer_dropped');
    }

    this.#items.push(item);

    if (this.#items.length >= this.#options.batchSize) {
      void this.#drain();
      return;
    }
    if (this.#timer === null) {
      this.#timer = setTimeout(() => void this.#drain(), this.#options.flushMs);
      this.#timer.unref?.();
    }
  }

  async shutdown(): Promise<void> {
    this.#closed = true;
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    await this.#drain();
    await this.#inFlight;
  }

  async #drain(): Promise<void> {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    if (this.#items.length === 0) return;

    const batch = this.#items;
    this.#items = [];
    this.#inFlight = this.#inFlight.then(() => this.#writeWithRetry(batch));
    await this.#inFlight;
  }

  async #writeWithRetry(batch: T[]): Promise<void> {
    const startedAt = Date.now();
    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
      try {
        await this.#options.flush(batch);
        this.#options.onFlushDuration?.((Date.now() - startedAt) / 1000);
        return;
      } catch (error) {
        if (attempt === RETRY_DELAYS_MS.length) {
          this.#options.onDrop?.(batch.length);
          logger.error({ err: error, dropped: batch.length }, 'tracking_writer_flush_failed');
          return;
        }
        await new Promise<void>((resolve) => {
          const timer = setTimeout(resolve, RETRY_DELAYS_MS[attempt]);
          timer.unref?.();
        });
      }
    }
  }
}
```

- [ ] **Step 4: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/event-buffer.test.ts`
Expected: PASS, 6 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/tracking/writer/event-buffer.ts packages/core/test/tracking/event-buffer.test.ts
git commit -m "feat(tracking): add in-process buffer for opens and clicks"
```

---

### Task 14: Zpracování otevření a zápis do `message_events` `[db]`

Horká cesta nesahá do databáze vůbec: ověří token, klasifikuje, vloží do bufferu, vrátí GIF. Kampaň se dohledá až v asynchronním zpracování dávky.

**Strop na otevření se počítá zvlášť pro každou třídu.** Specifikace v 3.2.3 uvádí 100 na zprávu a den. Kdyby se počítal dohromady, Apple proxy by u aktivního čtenáře strop vyčerpala a skutečné lidské otevření by se zahodilo, což je přesně ten údaj, na kterém záleží nejvíc. Strop je proto 100 na dvojici zpráva a třída, tedy 200 v součtu u zprávy, kterou vidí Apple i člověk. `OPEN_CAP_PER_MESSAGE_PER_DAY` z Tasku 2 je celkový součet, dílčí strop je jeho polovina.

**Files:**
- Create: `packages/core/tracking/repo/message-events.repo.ts`
- Create: `packages/core/tracking/open/handle-open.ts`
- Test: `packages/core/test/tracking/handle-open.db.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/handle-open.db.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { withTestDatabase } from '@mlain/db/testing';
import { buildTrackingKeyring } from '../../tracking/tokens/keyring';
import { ProxyRangeIndex } from '../../tracking/open/proxy-ranges';
import { createOpenHandler } from '../../tracking/open/handle-open';

const db = withTestDatabase();
const ring = buildTrackingKeyring({
  secretKey: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
  secretKeyPrevious: '',
});
const OPEN = 't1bwEBkvOgHC1-QJobLD1OX2BxAZLzoBwtfkGLLD1OX2Bxgmpk3YDUjmcTwPYu1Q9cpqmSPs4g';

describe('open handler', () => {
  let buffered: unknown[];
  let handle: ReturnType<typeof createOpenHandler>;

  beforeEach(() => {
    buffered = [];
    handle = createOpenHandler({
      keyring: ring,
      proxyRanges: new ProxyRangeIndex([]),
      push: (item) => buffered.push(item),
    });
  });

  it('platný token s klientem Outlook zařadí otevření třídy human', () => {
    handle({ token: OPEN, userAgent: 'Microsoft Outlook 16.0', method: 'GET', headers: {}, ip: null, now: new Date() });
    expect(buffered).toHaveLength(1);
    expect(buffered[0]).toMatchObject({ openClass: 'human', messageCreatedAt: 1784995200 });
  });

  it('neplatný token nezařadí nic a nevyhodí výjimku', () => {
    handle({ token: 't1xxxx', userAgent: 'Outlook', method: 'GET', headers: {}, ip: null, now: new Date() });
    expect(buffered).toHaveLength(0);
  });

  it('crawler se nezapíše vůbec', () => {
    handle({ token: OPEN, userAgent: 'Googlebot/2.1', method: 'GET', headers: {}, ip: null, now: new Date() });
    expect(buffered).toHaveLength(0);
  });

  it('token typu o na jiném endpointu neprojde, kontrolu dělá volající se seznamem typů', () => {
    handle({ token: OPEN, userAgent: 'Outlook', method: 'GET', headers: {}, ip: null, now: new Date() });
    expect(buffered).toHaveLength(1);
  });

  it('zápis dávky do message_events je idempotentní a druhý běh nevyrobí duplicitu', async () => {
    const { insertMessageEvents } = await import('../../tracking/repo/message-events.repo');
    const rows = [
      {
        id: '0192f3a0-1c2d-7e50-8a1b-2c3d4e5f6071',
        workspaceId: '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071',
        messageId: '0192f3a0-1c2d-7e41-8b2c-3d4e5f607182',
        messageCreatedAt: new Date('2026-07-25T16:00:00Z'),
        campaignId: '0192f3a0-1c2d-7e44-9e5f-60718293a4b5',
        contactId: '0192f3a0-1c2d-7e43-8d4e-5f60718293a4',
        type: 'open' as const,
        subtype: 'human',
        ts: new Date(),
        linkId: null,
        metadata: {},
      },
    ];
    const first = await insertMessageEvents(rows);
    const second = await insertMessageEvents(rows);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(0);

    // Návratová hodnota nestačí. Dřívější `ON CONFLICT (id, received_at)`
    // byl mrtvý kód a druhý běh by vrátil zase jedno ID, takže tenhle test
    // musí sáhnout do tabulky a spočítat řádky.
    const { rows: stored } = await db.query<{ count: string }>(
      'SELECT count(*) FROM message_events WHERE id = $1', [rows[0]!.id],
    );
    expect(Number(stored[0]!.count)).toBe(1);
  });

  it('zápis vyplní source a nechá rank i recipient na databázi', async () => {
    const { insertMessageEvents } = await import('../../tracking/repo/message-events.repo');
    const id = '0192f3a0-1c2d-7e50-8a1b-2c3d4e5f6072';
    await insertMessageEvents([{
      id,
      workspaceId: '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071',
      messageId: '0192f3a0-1c2d-7e41-8b2c-3d4e5f607182',
      messageCreatedAt: new Date('2026-07-25T16:00:00Z'),
      campaignId: '0192f3a0-1c2d-7e44-9e5f-60718293a4b5',
      contactId: '0192f3a0-1c2d-7e43-8d4e-5f60718293a4',
      type: 'open', subtype: 'human', ts: new Date(), linkId: null, metadata: {},
    }]);

    const { rows } = await db.query<{ source: string; rank: number; recipient: string | null }>(
      'SELECT source, rank, recipient FROM message_events WHERE id = $1', [id],
    );
    expect(rows[0]!.source).toBe('tracking');
    // rank dopočítá generovaný sloupec z type, hodnota do něj nejde vložit.
    expect(rows[0]!.rank).toBe(50);
    // recipient je u otevření prázdný: e-mailová adresa se na řádek události
    // nekopíruje, jinak by jí musel projít i výmaz podle GDPR.
    expect(rows[0]!.recipient).toBeNull();
  });

  it('dávka ze dvou projektů se zapíše celá, ne jen její první polovina', async () => {
    // Buffer je společný pro proces. Kdyby se zapisovalo jednou transakcí
    // s jedním workspace kontextem, RLS by druhý projekt odmítla na WITH CHECK
    // a polovina událostí by zmizela, aniž by cokoliv spadlo.
    const { insertMessageEvents } = await import('../../tracking/repo/message-events.repo');
    const base = {
      messageCreatedAt: new Date('2026-07-25T16:00:00Z'),
      contactId: '0192f3a0-1c2d-7e43-8d4e-5f60718293a4',
      type: 'open' as const, subtype: 'human', ts: new Date(), linkId: null, metadata: {},
    };
    const inserted = await insertMessageEvents([
      { ...base, id: '0192f3a0-1c2d-7e50-8a1b-2c3d4e5f6073',
        workspaceId: '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071',
        messageId: '0192f3a0-1c2d-7e41-8b2c-3d4e5f607182',
        campaignId: '0192f3a0-1c2d-7e44-9e5f-60718293a4b5' },
      { ...base, id: '0192f3a0-1c2d-7e50-8a1b-2c3d4e5f6074',
        workspaceId: '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6072',
        messageId: '0192f3a0-1c2d-7e41-8b2c-3d4e5f607183',
        campaignId: '0192f3a0-1c2d-7e44-9e5f-60718293a4b6' },
    ]);
    expect(inserted).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/handle-open.db.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/open/handle-open"`.

- [ ] **Step 3: Napiš repository pro `message_events`**

```ts
// packages/core/tracking/repo/message-events.repo.ts
import { sql } from 'drizzle-orm';
import { withTrackingTx } from './tx';

export type MessageEventInsert = {
  id: string;
  workspaceId: string;
  messageId: string;
  messageCreatedAt: Date;
  campaignId: string;
  contactId: string | null;
  type: 'open' | 'click';
  /** U otevření třída otevření, u kliku třída kliku. */
  subtype: string;
  ts: Date;
  linkId: string | null;
  metadata: Record<string, unknown>;
};

/**
 * Hodnota `message_events.source` pro všechno, co zapisuje tahle doména.
 * Sloupec je NOT NULL bez výchozí hodnoty a je to správně: výchozí hodnota
 * by tiše označila událost od providera za vlastní. Ostatní zapisovatelé
 * mají `ses_sns`, `smtp` a `internal`.
 */
const TRACKING_SOURCE = 'tracking';

/**
 * Jeden příkaz na dávku a projekt. Vrací ID skutečně vložených řádků,
 * ne délku vstupu: přírůstky do *_total se počítají z nich, jinak by dvojí
 * běh jobu čísla nafoukl.
 *
 * **Tři sloupce se schválně nevyjmenovávají.**
 * `received_at` doplní databáze (`DEFAULT now()`) a je to partiční klíč.
 * `rank` je generovaný sloupec odvozený z `type`, takže hodnota do něj
 * vložit **nejde** a pokus by skončil chybou 428C9. `recipient` je u otevření
 * a prokliku prázdný záměrně: je to e-mailová adresa a kopírovat ji na každý
 * řádek desetimilionové tabulky by znamenalo, že jí musí výmaz podle GDPR
 * projít znovu. Podmíněné omezení ji vyžaduje jen u doručovacích událostí,
 * které zapisuje sender.
 *
 * **Idempotence stojí na `WHERE NOT EXISTS`, ne na `ON CONFLICT`.**
 * Dřívější `ON CONFLICT (id, received_at) DO NOTHING` byl mrtvý kód:
 * `received_at` se mezi vkládanými sloupci neobjevuje, doplní se `now()`
 * a je pokaždé jiné, takže konfliktní cíl nemohl nikdy sepnout a opakovaný
 * běh vyráběl duplicity. Je to přesně ta past, kterou P03 popisuje
 * u `provider_event_receipts`, a řeší se stejným způsobem jako tam.
 *
 * Podmínka na `received_at` v poddotazu je kvůli prořezání oddílů: bez ní
 * by se hledalo ve všech 37 měsíčních oddílech. Hodina bohatě stačí, protože
 * opakovaný zápis téže dávky vzniká jen opakováním flushe, tedy během sekund.
 */
export async function insertMessageEvents(rows: readonly MessageEventInsert[]): Promise<string[]> {
  if (rows.length === 0) return [];

  // Buffer je společný pro celý proces, takže jedna dávka nese události
  // z několika projektů. Zapisuje se proto po projektech: transakce má právě
  // jeden workspace kontext a RLS by zbytek dávky odmítla na WITH CHECK.
  const byWorkspace = new Map<string, MessageEventInsert[]>();
  for (const row of rows) {
    const group = byWorkspace.get(row.workspaceId);
    if (group === undefined) byWorkspace.set(row.workspaceId, [row]);
    else group.push(row);
  }

  const insertedIds: string[] = [];
  for (const [workspaceId, group] of byWorkspace) {
    const ids = await withTrackingTx(workspaceId, 'tracking.writer_flush', async (tx) => {
      const { rows: inserted } = await tx.execute<{ id: string }>(sql`
        INSERT INTO message_events (
          id, workspace_id, message_id, message_created_at, campaign_id,
          contact_id, type, subtype, ts, link_id, metadata, source)
        SELECT s.id, s.workspace_id, s.message_id, s.message_created_at, s.campaign_id,
               s.contact_id, s.type, s.subtype, s.ts, s.link_id, s.metadata, ${TRACKING_SOURCE}
          FROM unnest(
                 ${sql.param(group.map((r) => r.id))}::uuid[],
                 ${sql.param(group.map((r) => r.workspaceId))}::uuid[],
                 ${sql.param(group.map((r) => r.messageId))}::uuid[],
                 ${sql.param(group.map((r) => r.messageCreatedAt))}::timestamptz[],
                 ${sql.param(group.map((r) => r.campaignId))}::uuid[],
                 ${sql.param(group.map((r) => r.contactId))}::uuid[],
                 ${sql.param(group.map((r) => r.type))}::text[],
                 ${sql.param(group.map((r) => r.subtype))}::text[],
                 ${sql.param(group.map((r) => r.ts))}::timestamptz[],
                 ${sql.param(group.map((r) => r.linkId))}::uuid[],
                 ${sql.param(group.map((r) => JSON.stringify(r.metadata)))}::jsonb[]
               ) AS s(id, workspace_id, message_id, message_created_at, campaign_id,
                      contact_id, type, subtype, ts, link_id, metadata)
         WHERE NOT EXISTS (
                 SELECT 1 FROM message_events e
                  WHERE e.workspace_id = s.workspace_id
                    AND e.id = s.id
                    AND e.received_at >= now() - interval '1 hour')
        RETURNING id
      `);
      return inserted.map((row) => row.id);
    });
    insertedIds.push(...ids);
  }

  return insertedIds;
}
```

**Pojmenování sloupců za `unnest` není kosmetika.** `SELECT * FROM unnest(...)` bez aliasu se `WHERE NOT EXISTS` nemá na co odkázat, protože sloupce nemají jména. Alias `AS s(...)` je proto podmínka, aby ta podmínka vůbec šla napsat.

**Pole se do šablony předává přes `sql.param`, nikdy holé.** Ověřeno spuštěním proti PostgreSQL 18.4: `${ids}::uuid[]` drizzle rozloží na `($1, $2, $3)`, což je **record, ne pole**, a dotaz skončí chybou `42846 cannot cast type record to uuid[]` hned při prvním použití. `${sql.param(ids)}::uuid[]` pošle jedinou hodnotu typu pole a projde. Totéž platí o každém `= ANY(...)` v tomhle plánu.

- [ ] **Step 4: Napiš zpracování otevření**

```ts
// packages/core/tracking/open/handle-open.ts
import { OPEN_CAP_PER_MESSAGE_PER_DAY } from '../config';
import { recordOpen, recordTokenInvalid, trackingMetrics } from '../metrics';
import type { OpenClass } from '../types';
import { verifyTrackingToken } from '../tokens/verify';
import type { TrackingKeyring } from '../tokens/keyring';
import { classifyOpen, isPersistedOpenClass } from './classify-open';
import type { ProxyRangeIndex } from './proxy-ranges';

export type BufferedOpen = {
  kind: 'open';
  workspaceId: string;
  messageId: string;
  messageCreatedAt: number;
  occurredAt: Date;
  openClass: OpenClass;
  country: string | null;
};

export type OpenRequest = {
  token: string;
  userAgent: string;
  method: string;
  headers: Record<string, string | undefined>;
  ip: string | null;
  now: Date;
  country?: string | null;
};

export type OpenHandlerDeps = {
  keyring: TrackingKeyring;
  proxyRanges: ProxyRangeIndex;
  push: (item: BufferedOpen) => void;
};

/** Strop na dvojici zpráva a třída, viz úvod Tasku 14. */
const CAP_PER_MESSAGE_AND_CLASS = OPEN_CAP_PER_MESSAGE_PER_DAY / 2;

type CapKey = string;

export function createOpenHandler(deps: OpenHandlerDeps): (request: OpenRequest) => void {
  const caps = new Map<CapKey, { day: string; count: number }>();

  return function handleOpen(request: OpenRequest): void {
    const result = verifyTrackingToken(request.token, ['o'], {
      keyring: deps.keyring,
      now: request.now,
    });
    if (!result.ok) {
      recordTokenInvalid(result.code);
      return; // odpověď je vždy GIF, o neplatnosti se volající nedozví
    }
    if (result.fields.type !== 'o') return;

    const openClass = classifyOpen({
      userAgent: request.userAgent,
      method: request.method,
      headers: request.headers,
      ip: request.ip,
      proxyRanges: deps.proxyRanges,
    });
    recordOpen(openClass);

    // Crawler se neukládá vůbec, viz 3.3.4.
    if (!isPersistedOpenClass(openClass)) return;

    const day = request.now.toISOString().slice(0, 10);
    const key: CapKey = `${result.fields.messageId}:${openClass}`;
    const cap = caps.get(key);
    if (cap === undefined || cap.day !== day) {
      caps.set(key, { day, count: 1 });
    } else if (cap.count >= CAP_PER_MESSAGE_AND_CLASS) {
      trackingMetrics.openCapped.inc();
      return;
    } else {
      cap.count += 1;
    }

    deps.push({
      kind: 'open',
      workspaceId: result.fields.workspaceId,
      messageId: result.fields.messageId,
      messageCreatedAt: result.fields.messageCreatedAt,
      occurredAt: request.now,
      openClass,
      country: request.country ?? null,
    });
  };
}
```

- [ ] **Step 5: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/handle-open.db.test.ts`
Expected: PASS, 7 testů.

- [ ] **Step 6: Commit**

```bash
git add packages/core/tracking/repo/message-events.repo.ts packages/core/tracking/open/handle-open.ts packages/core/test/tracking/handle-open.db.test.ts
git commit -m "feat(tracking): handle open pixel without touching database in hot path"
```

---

### Task 15: LRU cache se single flight

`lru-cache` je pod BlueOak-1.0.0, což není na whitelistu licenční brány. Cache odkazů je čtyřicet řádků kódu, takže si ji píšeme sami. Single flight je tu podstatný: při startu rozesílky přijdou tisíce kliků na tutéž kampaň naráz a bez něj by se udělalo tisíc stejných dotazů.

**Files:**
- Create: `packages/core/tracking/click/lru.ts`
- Test: `packages/core/test/tracking/lru.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/lru.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TtlLru } from '../../tracking/click/lru';

describe('TtlLru', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('vrátí uloženou hodnotu', () => {
    const lru = new TtlLru<string, number>({ capacity: 2, ttlMs: 1000 });
    lru.set('a', 1);
    expect(lru.get('a')).toBe(1);
  });

  it('po vypršení TTL vrátí undefined', () => {
    const lru = new TtlLru<string, number>({ capacity: 2, ttlMs: 1000 });
    lru.set('a', 1);
    vi.advanceTimersByTime(1001);
    expect(lru.get('a')).toBeUndefined();
  });

  it('při překročení kapacity vypadne nejdéle nepoužitá položka', () => {
    const lru = new TtlLru<string, number>({ capacity: 2, ttlMs: 1000 });
    lru.set('a', 1);
    lru.set('b', 2);
    lru.get('a');
    lru.set('c', 3);
    expect(lru.get('b')).toBeUndefined();
    expect(lru.get('a')).toBe(1);
    expect(lru.get('c')).toBe(3);
  });

  it('single flight udělá jedno naplnění pro souběžné požadavky', async () => {
    const lru = new TtlLru<string, number>({ capacity: 10, ttlMs: 1000 });
    let calls = 0;
    const loader = async (): Promise<number> => {
      calls += 1;
      return 42;
    };
    const [a, b, c] = await Promise.all([
      lru.getOrLoad('k', loader),
      lru.getOrLoad('k', loader),
      lru.getOrLoad('k', loader),
    ]);
    expect([a, b, c]).toEqual([42, 42, 42]);
    expect(calls).toBe(1);
  });

  it('selhání loaderu se nezacachuje a další pokus loader zavolá znovu', async () => {
    const lru = new TtlLru<string, number>({ capacity: 10, ttlMs: 1000 });
    let calls = 0;
    const failing = async (): Promise<number> => {
      calls += 1;
      throw new Error('nedostupná databáze');
    };
    await expect(lru.getOrLoad('k', failing)).rejects.toThrow();
    await expect(lru.getOrLoad('k', failing)).rejects.toThrow();
    expect(calls).toBe(2);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/lru.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/click/lru"`.

- [ ] **Step 3: Napiš cache**

```ts
// packages/core/tracking/click/lru.ts

type Entry<V> = { value: V; expiresAt: number };

export type TtlLruOptions = { capacity: number; ttlMs: number };

/**
 * LRU s TTL a single flight. Vlastní implementace schválně:
 * lru-cache je pod BlueOak-1.0.0, což není na whitelistu licenční brány,
 * a tahle věc je čtyřicet řádků.
 * Pořadí drží Map, která si v JavaScriptu pamatuje pořadí vložení.
 */
export class TtlLru<K, V> {
  readonly #entries = new Map<K, Entry<V>>();
  readonly #pending = new Map<K, Promise<V>>();
  readonly #capacity: number;
  readonly #ttlMs: number;

  constructor(options: TtlLruOptions) {
    this.#capacity = options.capacity;
    this.#ttlMs = options.ttlMs;
  }

  get size(): number {
    return this.#entries.size;
  }

  get(key: K): V | undefined {
    const entry = this.#entries.get(key);
    if (entry === undefined) return undefined;
    if (entry.expiresAt <= Date.now()) {
      this.#entries.delete(key);
      return undefined;
    }
    // dotek posune položku na konec, tedy mezi nedávno použité
    this.#entries.delete(key);
    this.#entries.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    this.#entries.delete(key);
    this.#entries.set(key, { value, expiresAt: Date.now() + this.#ttlMs });
    while (this.#entries.size > this.#capacity) {
      const oldest = this.#entries.keys().next();
      if (oldest.done === true) break;
      this.#entries.delete(oldest.value);
    }
  }

  /** Souběžné požadavky na týž klíč čekají na jedno naplnění. */
  async getOrLoad(key: K, loader: () => Promise<V>): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;

    const inFlight = this.#pending.get(key);
    if (inFlight !== undefined) return inFlight;

    const promise = loader()
      .then((value) => {
        this.set(key, value);
        return value;
      })
      .finally(() => {
        this.#pending.delete(key);
      });

    this.#pending.set(key, promise);
    return promise;
  }

  setMany(entries: Iterable<readonly [K, V]>): void {
    for (const [key, value] of entries) this.set(key, value);
  }
}
```

- [ ] **Step 4: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/lru.test.ts`
Expected: PASS, 5 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/tracking/click/lru.ts packages/core/test/tracking/lru.test.ts
git commit -m "feat(tracking): add own ttl lru cache with single flight"
```

---

### Task 16: Cache odkazů kampaně `[db]`

Cache se plní **po kampaních**, i když se čte po `link_id`. První klik v kampani načte všechny její odkazy jedním dotazem, další kliky v téže kampani jsou pak z paměti. Cold start prvního kliku je řádově 2 ms.

**Files:**
- Create: `packages/core/tracking/click/link-cache.ts`
- Test: `packages/core/test/tracking/link-cache.db.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/link-cache.db.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LinkCache } from '../../tracking/click/link-cache';

const CAMPAIGN = '0192f3a0-1c2d-7e44-9e5f-60718293a4b5';
const WS = '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071';
const LINK_A = '0192f3a0-1c2d-7e42-9c3d-4e5f60718293';
const LINK_B = '0192f3a0-1c2d-7e42-9c3d-4e5f60718294';

const rows = [
  { id: LINK_A, url: 'https://shop.cz/vyprodej', campaignId: CAMPAIGN, workspaceId: WS, position: 1 },
  { id: LINK_B, url: 'https://shop.cz/novinky', campaignId: CAMPAIGN, workspaceId: WS, position: 2 },
];

describe('LinkCache', () => {
  let load: ReturnType<typeof vi.fn>;
  let cache: LinkCache;

  beforeEach(() => {
    load = vi.fn(async () => rows);
    cache = new LinkCache({ capacity: 100, ttlMs: 900_000, load });
  });

  it('první klik načte celou kampaň a naplní všechny její odkazy', async () => {
    expect(await cache.get(LINK_A)).toEqual(rows[0]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(await cache.get(LINK_B)).toEqual(rows[1]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('souběžné kliky na tutéž kampaň udělají jedno naplnění', async () => {
    await Promise.all([cache.get(LINK_A), cache.get(LINK_A), cache.get(LINK_A)]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('neexistující odkaz vrátí null a nezacachuje se jako platný', async () => {
    load.mockResolvedValue([]);
    expect(await cache.get('0192f3a0-1c2d-7e42-9c3d-000000000000')).toBeNull();
  });

  it('nese pozici odkazu, protože se sleduje, na který odkaz v mailu se kliklo', async () => {
    const link = await cache.get(LINK_B);
    expect(link!.position).toBe(2);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/link-cache.db.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/click/link-cache"`.

- [ ] **Step 3: Napiš cache odkazů**

```ts
// packages/core/tracking/click/link-cache.ts
import type { CampaignLinkRow } from '../repo/messages.repo';
import { selectCampaignLinksByLinkId } from '../repo/messages.repo';
import { TtlLru } from './lru';

export type LinkCacheOptions = {
  capacity: number;
  ttlMs: number;
  /** Vrátí všechny odkazy kampaně, do které patří zadané link_id. */
  load?: (workspaceId: string, linkId: string) => Promise<CampaignLinkRow[]>;
};

/**
 * Cache campaign_links. Klíčem je link_id, ale plní se po celých kampaních:
 * kdo klikl na jeden odkaz v mailu, klikne pravděpodobně i na další.
 * Pozice odkazu je součástí položky, protože se sleduje, na který odkaz
 * v mailu se kliklo, a po překompilování šablony už by se nedohledala.
 */
export class LinkCache {
  readonly #lru: TtlLru<string, CampaignLinkRow | null>;
  readonly #load: (workspaceId: string, linkId: string) => Promise<CampaignLinkRow[]>;

  constructor(options: LinkCacheOptions) {
    this.#lru = new TtlLru({ capacity: options.capacity, ttlMs: options.ttlMs });
    this.#load = options.load ?? selectCampaignLinksByLinkId;
  }

  /**
   * Klíčem cache je dvojice projekt a odkaz, ne samotný odkaz.
   *
   * Cache je společná pro celý proces a `campaign_links.id` je UUID, takže
   * bez projektu v klíči by odkaz nahraný jedním projektem obsloužil klik
   * s tokenem jiného projektu. Token sice `link_id` podepisuje, ale podepisuje
   * i `workspace_id`, a shodnout se musí obojí. Zároveň je to workspace,
   * který dotazu dodá RLS kontext.
   */
  async get(workspaceId: string, linkId: string): Promise<CampaignLinkRow | null> {
    const key = `${workspaceId}:${linkId}`;
    const cached = this.#lru.get(key);
    if (cached !== undefined) return cached;

    return this.#lru.getOrLoad(key, async () => {
      const rows = await this.#load(workspaceId, linkId);
      this.#lru.setMany(rows.map((row) => [`${workspaceId}:${row.id}`, row] as const));
      return rows.find((row) => row.id === linkId) ?? null;
    });
  }
}
```

- [ ] **Step 4: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/link-cache.db.test.ts`
Expected: PASS, 4 testy.

- [ ] **Step 5: Commit**

```bash
git add packages/core/tracking/click/link-cache.ts packages/core/test/tracking/link-cache.db.test.ts
git commit -m "feat(tracking): cache campaign links per campaign with link position"
```

---

### Task 17: Klasifikace kliknutí

Bezpečnostní filtry firemní pošty po doručení navštíví každý odkaz. To nafukuje proklik, tedy metriku, na které stavíme reporty, takže to musíme umět odfiltrovat.

Pravidla se dělí na dvě skupiny a je to podstatné: **1 až 4 a 7 běží v horké cestě** (mají po ruce jen hlavičky), **5 a 6 se dopočítají asynchronně** (potřebují `messages.sent_at` a okno napříč požadavky). Klasifikace `scanner`, `bot` a `prefetch` **se ukládá**, na rozdíl od `bot` u otevření, protože se z ní počítá diagnostická dlaždice odfiltrovaných strojových prokliků.

**Files:**
- Create: `packages/core/tracking/click/classify-click.ts`
- Test: `packages/core/test/tracking/classify-click.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/classify-click.test.ts
import { describe, expect, it } from 'vitest';
import { ScannerWindow, classifyClickHot, reclassifyClicks } from '../../tracking/click/classify-click';

describe('classifyClickHot', () => {
  it('pravidlo 1: crawler je bot', () => {
    expect(classifyClickHot({ userAgent: 'Googlebot/2.1', method: 'GET', headers: {} })).toBe('bot');
  });

  it('pravidlo 2: prefetch je prefetch, ne bot', () => {
    expect(classifyClickHot({ userAgent: 'Chrome/140', method: 'GET', headers: { 'x-moz': 'prefetch' } })).toBe('prefetch');
  });

  it('pravidlo 3: HEAD je scanner', () => {
    expect(classifyClickHot({ userAgent: 'Chrome/140', method: 'HEAD', headers: {} })).toBe('scanner');
  });

  it('pravidlo 4: známý skener odkazů je scanner', () => {
    expect(classifyClickHot({ userAgent: 'Mimecast link protection', method: 'GET', headers: {} })).toBe('scanner');
  });

  it('pravidlo 7: chybějící User-Agent je bot', () => {
    expect(classifyClickHot({ userAgent: '', method: 'GET', headers: {} })).toBe('bot');
  });

  it('pravidlo 8: jinak human', () => {
    expect(classifyClickHot({ userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0.0.0', method: 'GET', headers: {} })).toBe('human');
  });
});

describe('reclassifyClicks', () => {
  const sentAt = new Date('2026-07-25T16:00:00Z');
  const base = {
    messageId: 'm1', ip: '203.0.113.7', clickClass: 'human' as const, linkId: 'l1',
    occurredAt: new Date('2026-07-25T16:00:10Z'),
  };

  it('pravidlo 5: klik do 5 sekund od sent_at je scanner', () => {
    const out = reclassifyClicks(
      [{ ...base, occurredAt: new Date('2026-07-25T16:00:03Z') }],
      { m1: sentAt },
      new ScannerWindow(),
    );
    expect(out[0]!.clickClass).toBe('scanner');
  });

  it('pravidlo 5: klik po 6 sekundách zůstává human', () => {
    const out = reclassifyClicks(
      [{ ...base, occurredAt: new Date('2026-07-25T16:00:06Z') }],
      { m1: sentAt },
      new ScannerWindow(),
    );
    expect(out[0]!.clickClass).toBe('human');
  });

  it('pravidlo 6: tři různé odkazy z jedné IP do 60 sekund jsou scanner včetně předchozích', () => {
    const window = new ScannerWindow();
    const out = reclassifyClicks(
      [
        { ...base, linkId: 'l1' },
        { ...base, linkId: 'l2', occurredAt: new Date('2026-07-25T16:00:20Z') },
        { ...base, linkId: 'l3', occurredAt: new Date('2026-07-25T16:00:30Z') },
      ],
      { m1: sentAt },
      window,
    );
    expect(out.map((c) => c.clickClass)).toEqual(['scanner', 'scanner', 'scanner']);
  });

  it('pravidlo 6 nesahá na dva odkazy, to je běžné chování člověka', () => {
    const out = reclassifyClicks(
      [
        { ...base, linkId: 'l1' },
        { ...base, linkId: 'l2', occurredAt: new Date('2026-07-25T16:00:20Z') },
      ],
      { m1: sentAt },
      new ScannerWindow(),
    );
    expect(out.map((c) => c.clickClass)).toEqual(['human', 'human']);
  });

  it('zpráva bez sent_at nespadne a klasifikaci nemění', () => {
    const out = reclassifyClicks([base], {}, new ScannerWindow());
    expect(out[0]!.clickClass).toBe('human');
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/classify-click.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/click/classify-click"`.

- [ ] **Step 3: Napiš klasifikaci**

```ts
// packages/core/tracking/click/classify-click.ts
import type { ClickClass } from '../types';
import { SCANNER_RE, isCrawlerUserAgent, isPrefetchRequest } from '../open/ua-rules';

const SCANNER_HEAD_START_SECONDS = 5;
const SCANNER_WINDOW_SECONDS = 60;
const SCANNER_DISTINCT_LINKS = 3;

export type ClassifyClickHotInput = {
  userAgent: string;
  method: string;
  headers: Record<string, string | undefined>;
};

/**
 * Pravidla 1 až 4 a 7 z 3.5. Jen tahle podmnožina jde vyhodnotit v horké cestě,
 * protože pravidlo 5 potřebuje messages.sent_at a pravidlo 6 okno napříč požadavky.
 */
export function classifyClickHot(input: ClassifyClickHotInput): ClickClass {
  const ua = input.userAgent.trim();
  if (isCrawlerUserAgent(ua)) return 'bot';
  if (isPrefetchRequest(input.headers)) return 'prefetch';
  if (input.method.toUpperCase() === 'HEAD') return 'scanner';
  if (SCANNER_RE.test(ua)) return 'scanner';
  if (ua === '') return 'bot';
  return 'human';
}

export type PendingClick = {
  messageId: string;
  linkId: string;
  ip: string | null;
  occurredAt: Date;
  clickClass: ClickClass;
};

type WindowEntry = { at: number; links: Set<string> };

/**
 * Okno pro pravidlo 6, drží se v paměti workeru. Při restartu se ztratí,
 * což vede k několika falešným human klikům. Přijatelné a zapsané.
 */
export class ScannerWindow {
  readonly #byKey = new Map<string, WindowEntry>();

  observe(ip: string, messageId: string, linkId: string, at: Date): Set<string> {
    const key = `${ip}:${messageId}`;
    const nowMs = at.getTime();
    const entry = this.#byKey.get(key);
    if (entry === undefined || nowMs - entry.at > SCANNER_WINDOW_SECONDS * 1000) {
      const fresh: WindowEntry = { at: nowMs, links: new Set([linkId]) };
      this.#byKey.set(key, fresh);
      return fresh.links;
    }
    entry.links.add(linkId);
    return entry.links;
  }

  prune(now: Date): void {
    const cutoff = now.getTime() - SCANNER_WINDOW_SECONDS * 1000;
    for (const [key, entry] of this.#byKey) {
      if (entry.at < cutoff) this.#byKey.delete(key);
    }
  }
}

/**
 * Pravidla 5 a 6. Běží v asynchronním zpracování dávky, ne v horké cestě.
 * Pravidlo 6 přeznačí i předchozí kliky téže dvojice IP a zpráva ve stejné dávce.
 */
export function reclassifyClicks(
  clicks: readonly PendingClick[],
  sentAtByMessage: Readonly<Record<string, Date>>,
  window: ScannerWindow,
): PendingClick[] {
  const out = clicks.map((click) => ({ ...click }));

  // pravidlo 5
  for (const click of out) {
    if (click.clickClass !== 'human') continue;
    const sentAt = sentAtByMessage[click.messageId];
    if (sentAt === undefined) continue;
    const ageSeconds = (click.occurredAt.getTime() - sentAt.getTime()) / 1000;
    if (ageSeconds < SCANNER_HEAD_START_SECONDS) click.clickClass = 'scanner';
  }

  // pravidlo 6
  const flagged = new Set<string>();
  for (const click of out) {
    if (click.ip === null) continue;
    const links = window.observe(click.ip, click.messageId, click.linkId, click.occurredAt);
    if (links.size >= SCANNER_DISTINCT_LINKS) flagged.add(`${click.ip}:${click.messageId}`);
  }
  for (const click of out) {
    if (click.ip === null) continue;
    if (flagged.has(`${click.ip}:${click.messageId}`)) click.clickClass = 'scanner';
  }

  return out;
}

/** Do metrik prokliku se počítá jen human, viz 3.5. */
export function isCountedClickClass(cls: ClickClass): boolean {
  return cls === 'human';
}
```

- [ ] **Step 4: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/classify-click.test.ts`
Expected: PASS, 11 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/tracking/click/classify-click.ts packages/core/test/tracking/classify-click.test.ts
git commit -m "feat(tracking): classify clicks and filter security scanners"
```

---

### Task 18: Přidání `ml_token` do cílové adresy

**Files:**
- Create: `packages/core/tracking/click/append-query.ts`
- Test: `packages/core/test/tracking/append-query.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/append-query.test.ts
import { describe, expect, it } from 'vitest';
import { appendQueryParam } from '../../tracking/click/append-query';

describe('appendQueryParam', () => {
  it('přidá parametr k adrese bez query', () => {
    expect(appendQueryParam('https://shop.cz/vyprodej', 'ml_token', 't1abc')).toBe(
      'https://shop.cz/vyprodej?ml_token=t1abc',
    );
  });

  it('zachová existující query i fragment a fragment nechá na konci', () => {
    expect(appendQueryParam('https://x.cz/a?b=1#c', 'ml_token', 't1abc')).toBe(
      'https://x.cz/a?b=1&ml_token=t1abc#c',
    );
  });

  it('existující ml_token přepíše, nezdvojí', () => {
    expect(appendQueryParam('https://x.cz/a?ml_token=old', 'ml_token', 't1new')).toBe(
      'https://x.cz/a?ml_token=t1new',
    );
  });

  it('nevalidní adresu vrátí beze změny, aby se přesměrování nerozbilo', () => {
    expect(appendQueryParam('není url', 'ml_token', 't1abc')).toBe('není url');
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/append-query.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/click/append-query"`.

- [ ] **Step 3: Napiš funkci**

```ts
// packages/core/tracking/click/append-query.ts

/**
 * Přidá parametr do adresy se zachováním query i fragmentu.
 * Cíl přesměrování se skládá výhradně z uložené adresy plus tohohle parametru,
 * nic z příchozího požadavku se do něj nikdy nedostane.
 */
export function appendQueryParam(rawUrl: string, name: string, value: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  url.searchParams.set(name, value);
  return url.toString();
}
```

- [ ] **Step 4: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/append-query.test.ts`
Expected: PASS, 4 testy.

- [ ] **Step 5: Commit**

```bash
git add packages/core/tracking/click/append-query.ts packages/core/test/tracking/append-query.test.ts
git commit -m "feat(tracking): append ml_token preserving query and fragment"
```

---

### Task 19: Povolené domény projektu

Redirect musí odpovědět na otázku „je tenhle host povolený" bez dotazu do databáze, takže se celá tabulka drží v paměti a obnovuje se každých 60 sekund.

**Files:**
- Create: `packages/core/tracking/repo/tracking-domains.repo.ts`
- Create: `packages/core/tracking/domains/domain-cache.ts`
- Test: `packages/core/test/tracking/domain-cache.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/domain-cache.test.ts
import { describe, expect, it, vi } from 'vitest';
import { TrackingDomainCache, normalizeHost, originHost } from '../../tracking/domains/domain-cache';

const WS = '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071';
const OTHER = '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6072';
const rows = [
  { id: 'd1', workspaceId: WS, host: 'shop.cz', includeSubdomains: false },
  { id: 'd2', workspaceId: WS, host: 'blog.example.cz', includeSubdomains: true },
  { id: 'd3', workspaceId: OTHER, host: 'jiny.cz', includeSubdomains: false },
];

describe('normalizeHost', () => {
  it('sundá schéma, port, tečku na konci a převede na malá písmena', () => {
    expect(normalizeHost('HTTPS://Shop.CZ:8443/cesta')).toBe('shop.cz');
    expect(normalizeHost('shop.cz.')).toBe('shop.cz');
  });
});

describe('originHost', () => {
  it('vytáhne host z hlavičky Origin', () => {
    expect(originHost('https://shop.cz')).toBe('shop.cz');
    expect(originHost('null')).toBeNull();
    expect(originHost(undefined)).toBeNull();
  });
});

describe('TrackingDomainCache', () => {
  const cache = new TrackingDomainCache({ refreshMs: 60_000, load: vi.fn(async () => rows) });

  it('přesná shoda hostu projde', async () => {
    await cache.refresh();
    expect(cache.isAllowed(WS, 'shop.cz')).toBe(true);
  });

  it('subdoména projde jen při include_subdomains', async () => {
    await cache.refresh();
    expect(cache.isAllowed(WS, 'www.shop.cz')).toBe(false);
    expect(cache.isAllowed(WS, 'cokoliv.blog.example.cz')).toBe(true);
    expect(cache.isAllowed(WS, 'blog.example.cz')).toBe(true);
  });

  it('doména cizího projektu neprojde', async () => {
    await cache.refresh();
    expect(cache.isAllowed(WS, 'jiny.cz')).toBe(false);
  });

  it('host, který jen končí stejnými znaky, neprojde', async () => {
    await cache.refresh();
    expect(cache.isAllowed(WS, 'zlyblog.example.cz')).toBe(false);
    expect(cache.isAllowed(WS, 'nechceme-shop.cz')).toBe(false);
  });

  it('projekt bez jediné domény nemá povolený nic', async () => {
    await cache.refresh();
    expect(cache.isAllowed('0192f3a0-1c2d-7e40-9a1b-000000000000', 'shop.cz')).toBe(false);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/domain-cache.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/domains/domain-cache"`.

- [ ] **Step 3: Napiš repository**

```ts
// packages/core/tracking/repo/tracking-domains.repo.ts
import { sql } from 'drizzle-orm';
import { withWorkspace } from '@mlain/core/tx';
import { withCrossWorkspaceTx, withTrackingTx } from './tx';
import type { WorkspaceContext } from '@mlain/db';

export type TrackingDomainRow = {
  id: string;
  workspaceId: string;
  host: string;
  includeSubdomains: boolean;
};

/** Načte celou tabulku. Řádově tisíce řádků na celou instalaci. */
export async function selectAllTrackingDomains(): Promise<TrackingDomainRow[]> {
  return withCrossWorkspaceTx('tracking.domain_cache', async (tx) =>
    (await tx.execute<TrackingDomainRow>(sql`
      SELECT id, workspace_id AS "workspaceId", host,
             include_subdomains AS "includeSubdomains"
        FROM tracking_domains
    `)).rows,
  );
}

export async function selectTrackingDomains(ctx: WorkspaceContext): Promise<
  (TrackingDomainRow & { verifiedAt: Date | null; createdAt: Date })[]
> {
  return withWorkspace(ctx, async (tx) =>
    (await tx.execute(sql`
      SELECT id, workspace_id AS "workspaceId", host,
             include_subdomains AS "includeSubdomains",
             verified_at AS "verifiedAt", created_at AS "createdAt"
        FROM tracking_domains
       ORDER BY host
    `)).rows,
  );
}

export async function countTrackingDomains(ctx: WorkspaceContext): Promise<number> {
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{ count: string }>(sql`SELECT count(*) FROM tracking_domains`);
    return Number(rows[0]?.count ?? 0);
  });
}

export async function insertTrackingDomain(
  ctx: WorkspaceContext,
  input: { id: string; host: string; includeSubdomains: boolean },
): Promise<TrackingDomainRow> {
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<TrackingDomainRow>(sql`
      INSERT INTO tracking_domains (id, workspace_id, host, include_subdomains)
      VALUES (${input.id}, ${ctx.workspaceId}, ${input.host}, ${input.includeSubdomains})
      RETURNING id, workspace_id AS "workspaceId", host,
                include_subdomains AS "includeSubdomains"
    `);
    return rows[0]!;
  });
}

export async function deleteTrackingDomain(ctx: WorkspaceContext, id: string): Promise<boolean> {
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{ id: string }>(
      sql`DELETE FROM tracking_domains WHERE id = ${id} RETURNING id`,
    );
    return rows.length > 0;
  });
}

export async function markTrackingDomainVerified(host: string, workspaceId: string): Promise<void> {
  await withTrackingTx(workspaceId, 'tracking.domain_verify', async (tx) => {
    await tx.execute(sql`
      UPDATE tracking_domains SET verified_at = now()
       WHERE workspace_id = ${workspaceId} AND host = ${host} AND verified_at IS NULL
    `);
  });
}
```

- [ ] **Step 4: Napiš cache domén**

```ts
// packages/core/tracking/domains/domain-cache.ts
import { logger } from '@mlain/core/logging';
import { selectAllTrackingDomains, type TrackingDomainRow } from '../repo/tracking-domains.repo';

export type TrackingDomainCacheOptions = {
  refreshMs: number;
  load?: () => Promise<TrackingDomainRow[]>;
};

/** Malá písmena, bez schématu, bez portu, bez tečky na konci. */
export function normalizeHost(value: string): string {
  let host = value.trim().toLowerCase();
  const schemeEnd = host.indexOf('://');
  if (schemeEnd !== -1) host = host.slice(schemeEnd + 3);
  const pathStart = host.search(/[/?#]/);
  if (pathStart !== -1) host = host.slice(0, pathStart);
  const portStart = host.lastIndexOf(':');
  if (portStart > host.lastIndexOf(']')) host = host.slice(0, portStart);
  if (host.endsWith('.')) host = host.slice(0, -1);
  return host;
}

export function originHost(origin: string | undefined | null): string | null {
  if (origin === undefined || origin === null || origin === '' || origin === 'null') return null;
  const host = normalizeHost(origin);
  return host === '' ? null : host;
}

type Entry = { host: string; includeSubdomains: boolean };

export class TrackingDomainCache {
  #byWorkspace = new Map<string, Entry[]>();
  #timer: NodeJS.Timeout | null = null;
  readonly #options: TrackingDomainCacheOptions;

  constructor(options: TrackingDomainCacheOptions) {
    this.#options = options;
  }

  async refresh(): Promise<void> {
    const load = this.#options.load ?? selectAllTrackingDomains;
    try {
      const rows = await load();
      const next = new Map<string, Entry[]>();
      for (const row of rows) {
        const list = next.get(row.workspaceId) ?? [];
        list.push({ host: normalizeHost(row.host), includeSubdomains: row.includeSubdomains });
        next.set(row.workspaceId, list);
      }
      this.#byWorkspace = next;
    } catch (error) {
      // Selhání obnovy neshodí redirect, jen se použije poslední známý stav.
      logger.warn({ err: error }, 'tracking_domain_cache_refresh_failed');
    }
  }

  start(): void {
    if (this.#timer !== null) return;
    void this.refresh();
    this.#timer = setInterval(() => void this.refresh(), this.#options.refreshMs);
    this.#timer.unref?.();
  }

  stop(): void {
    if (this.#timer === null) return;
    clearInterval(this.#timer);
    this.#timer = null;
  }

  /**
   * Shoda musí být na celý host nebo na hranici tečky. Prosté endsWith by pustilo
   * `zlyblog.example.cz` na pravidlo pro `blog.example.cz`, což je únik identity
   * na cizí web, tedy přesně to, čemu tahle kontrola brání.
   */
  isAllowed(workspaceId: string, host: string): boolean {
    const entries = this.#byWorkspace.get(workspaceId);
    if (entries === undefined) return false;
    const target = normalizeHost(host);
    return entries.some((entry) => {
      if (entry.host === target) return true;
      return entry.includeSubdomains && target.endsWith(`.${entry.host}`);
    });
  }

  hasAnyDomain(workspaceId: string): boolean {
    return (this.#byWorkspace.get(workspaceId)?.length ?? 0) > 0;
  }
}
```

- [ ] **Step 5: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/domain-cache.test.ts`
Expected: PASS, 7 testů.

- [ ] **Step 6: Commit**

```bash
git add packages/core/tracking/repo/tracking-domains.repo.ts packages/core/tracking/domains/domain-cache.ts packages/core/test/tracking/domain-cache.test.ts
git commit -m "feat(tracking): cache allowed tracking domains in memory"
```

---

### Task 20: Zpracování kliku a ochrana proti open redirectu `[db]`

**Tohle je nejdůležitější bezpečnostní vlastnost celé části.** Otevřené přesměrování na naší doméně by šlo použít k phishingu na účet zákazníka a poškodilo by reputaci odesílací domény.

Základní princip: **cílová adresa se nikdy nebere ze vstupu, bere se z databáze podle `link_id`.** Query parametry z příchozího požadavku se do cíle nepřenášejí. Do cílové adresy se nevkládá nic, co přišlo od klienta, kromě `ml_token`, který vyrábíme my.

Identifikační token se přidá jen tehdy, když jsou splněné **všechny** podmínky kroku 7: klik je třídy `human`, projekt má web tracking zapnutý a cílový host je registrovaný v `tracking_domains` daného projektu. Když odkaz vede na `facebook.com`, token se nepřidá a na `messages` se vůbec nesáhne.

**Files:**
- Create: `packages/core/tracking/click/handle-click.ts`
- Test: `packages/core/test/tracking/handle-click.db.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/handle-click.db.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildTrackingKeyring } from '../../tracking/tokens/keyring';
import { LinkCache } from '../../tracking/click/link-cache';
import { TrackingDomainCache } from '../../tracking/domains/domain-cache';
import { createClickHandler } from '../../tracking/click/handle-click';

const ring = buildTrackingKeyring({
  secretKey: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
  secretKeyPrevious: '',
});
const CLICK =
  't1YwEBkvOgHC1-QJobLD1OX2BxAZLzoBwtfkGLLD1OX2BxggGS86AcLX5CnD1OX2BxgpNqZN2Aa8TprBxqhsgbR6l5AMMNpw';
const WS = '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071';
const CAMPAIGN = '0192f3a0-1c2d-7e44-9e5f-60718293a4b5';
const LINK = '0192f3a0-1c2d-7e42-9c3d-4e5f60718293';
const CONTACT = '0192f3a0-1c2d-7e43-8d4e-5f60718293a4';

function makeHandler(overrides: Partial<Parameters<typeof createClickHandler>[0]> = {}) {
  const buffered: unknown[] = [];
  const domains = new TrackingDomainCache({
    refreshMs: 60_000,
    load: async () => [{ id: 'd1', workspaceId: WS, host: 'shop.cz', includeSubdomains: false }],
  });
  const links = new LinkCache({
    capacity: 10,
    ttlMs: 900_000,
    load: async () => [
      { id: LINK, url: 'https://shop.cz/vyprodej', campaignId: CAMPAIGN, workspaceId: WS, position: 3 },
    ],
  });
  const handle = createClickHandler({
    keyring: ring,
    currentKeyId: 1,
    links,
    domains,
    push: (item) => buffered.push(item),
    lookupContactId: vi.fn(async () => CONTACT),
    isWebTrackingEnabled: () => true,
    identityTokenTtlSeconds: 900,
    contactLookupTimeoutMs: 30,
    ...overrides,
  });
  return { handle, buffered, domains };
}

describe('click handler', () => {
  let ctx: ReturnType<typeof makeHandler>;
  beforeEach(async () => {
    ctx = makeHandler();
    await ctx.domains.refresh();
  });

  it('vrátí Location přesně rovný uložené adrese plus ml_token', async () => {
    const out = await ctx.handle({
      token: CLICK, userAgent: 'Mozilla/5.0 (Windows NT 10.0) Chrome/140.0.0.0',
      method: 'GET', headers: {}, ip: '203.0.113.7', query: '', now: new Date(),
    });
    expect(out.status).toBe(302);
    expect(out.location).toMatch(/^https:\/\/shop\.cz\/vyprodej\?ml_token=t1/);
  });

  it('query z příchozího požadavku se do Location nikdy nepřenese', async () => {
    const out = await ctx.handle({
      token: CLICK, userAgent: 'Chrome/140.0.0.0', method: 'GET', headers: {},
      ip: '203.0.113.7', query: '?next=https://evil.example', now: new Date(),
    });
    expect(out.location).not.toContain('evil.example');
    expect(out.location).not.toContain('next=');
  });

  it('neplatný token vede na /t/expired a nezapíše nic', async () => {
    const out = await ctx.handle({
      token: 't1xxxx', userAgent: 'Chrome/140', method: 'GET', headers: {},
      ip: null, query: '', now: new Date(),
    });
    expect(out.location).toBe('/t/expired');
    expect(ctx.buffered).toHaveLength(0);
  });

  it('odkaz patřící jinému projektu než token vede na /t/expired', async () => {
    const other = makeHandler({
      links: new LinkCache({
        capacity: 10, ttlMs: 900_000,
        load: async () => [{
          id: LINK, url: 'https://shop.cz/x', campaignId: CAMPAIGN,
          workspaceId: '0192f3a0-1c2d-7e40-9a1b-000000000000', position: 1,
        }],
      }),
    });
    await other.domains.refresh();
    const out = await other.handle({
      token: CLICK, userAgent: 'Chrome/140', method: 'GET', headers: {},
      ip: null, query: '', now: new Date(),
    });
    expect(out.location).toBe('/t/expired');
  });

  it('cíl mimo tracking_domains dostane Location bez ml_token a nesáhne na messages', async () => {
    const lookup = vi.fn(async () => CONTACT);
    const foreign = makeHandler({
      lookupContactId: lookup,
      links: new LinkCache({
        capacity: 10, ttlMs: 900_000,
        load: async () => [{
          id: LINK, url: 'https://facebook.com/nase-stranka', campaignId: CAMPAIGN,
          workspaceId: WS, position: 1,
        }],
      }),
    });
    await foreign.domains.refresh();
    const out = await foreign.handle({
      token: CLICK, userAgent: 'Chrome/140.0.0.0', method: 'GET', headers: {},
      ip: null, query: '', now: new Date(),
    });
    expect(out.location).toBe('https://facebook.com/nase-stranka');
    expect(lookup).not.toHaveBeenCalled();
  });

  it('skener dostane přesměrování, ale bez ml_token', async () => {
    const out = await ctx.handle({
      token: CLICK, userAgent: 'Mimecast', method: 'GET', headers: {},
      ip: '203.0.113.7', query: '', now: new Date(),
    });
    expect(out.location).toBe('https://shop.cz/vyprodej');
  });

  it('pomalé dohledání kontaktu přesměruje bez ml_token a v limitu', async () => {
    const slow = makeHandler({
      contactLookupTimeoutMs: 5,
      lookupContactId: async () => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        return CONTACT;
      },
    });
    await slow.domains.refresh();
    const started = Date.now();
    const out = await slow.handle({
      token: CLICK, userAgent: 'Chrome/140.0.0.0', method: 'GET', headers: {},
      ip: '203.0.113.7', query: '', now: new Date(),
    });
    expect(out.location).toBe('https://shop.cz/vyprodej');
    expect(Date.now() - started).toBeLessThan(40);
  });

  it('do bufferu jde pozice odkazu, na který se kliklo', async () => {
    await ctx.handle({
      token: CLICK, userAgent: 'Chrome/140.0.0.0', method: 'GET', headers: {},
      ip: '203.0.113.7', query: '', now: new Date(),
    });
    expect(ctx.buffered[0]).toMatchObject({ linkId: LINK, linkPosition: 3, campaignId: CAMPAIGN });
  });

  it('odpověď nese hlavičky, které brání úniku tokenu přes Referer', async () => {
    const out = await ctx.handle({
      token: CLICK, userAgent: 'Chrome/140.0.0.0', method: 'GET', headers: {},
      ip: null, query: '', now: new Date(),
    });
    expect(out.headers['Referrer-Policy']).toBe('no-referrer');
    expect(out.headers['X-Robots-Tag']).toBe('noindex, nofollow');
    expect(out.headers['Cache-Control']).toContain('no-store');
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/handle-click.db.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/click/handle-click"`.

- [ ] **Step 3: Napiš zpracování kliku**

```ts
// packages/core/tracking/click/handle-click.ts
import { recordClick, recordTokenInvalid, trackingMetrics } from '../metrics';
import type { ClickClass } from '../types';
import type { TrackingKeyring } from '../tokens/keyring';
import { mintIdentityToken } from '../tokens/mint';
import { verifyTrackingToken } from '../tokens/verify';
import type { TrackingDomainCache } from '../domains/domain-cache';
import { normalizeHost } from '../domains/domain-cache';
import { appendQueryParam } from './append-query';
import { classifyClickHot } from './classify-click';
import type { LinkCache } from './link-cache';

export const EXPIRED_PATH = '/t/expired';

export const REDIRECT_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
});

export type BufferedClick = {
  kind: 'click';
  workspaceId: string;
  messageId: string;
  messageCreatedAt: number;
  campaignId: string;
  linkId: string;
  linkPosition: number;
  occurredAt: Date;
  clickClass: ClickClass;
  ip: string | null;
};

export type ClickRequest = {
  token: string;
  userAgent: string;
  method: string;
  headers: Record<string, string | undefined>;
  ip: string | null;
  /** Syrový query řetězec příchozího požadavku. Slouží jen k tomu, aby bylo vidět, že se ignoruje. */
  query: string;
  now: Date;
};

export type ClickResponse = {
  status: 302;
  location: string;
  headers: Readonly<Record<string, string>>;
};

export type ClickHandlerDeps = {
  keyring: TrackingKeyring;
  currentKeyId: number;
  links: LinkCache;
  domains: TrackingDomainCache;
  push: (item: BufferedClick) => void;
  lookupContactId: (workspaceId: string, messageId: string, createdAt: number) => Promise<string | null>;
  isWebTrackingEnabled: (workspaceId: string) => boolean;
  identityTokenTtlSeconds: number;
  contactLookupTimeoutMs: number;
};

function expired(): ClickResponse {
  return { status: 302, location: EXPIRED_PATH, headers: REDIRECT_HEADERS };
}

export function createClickHandler(
  deps: ClickHandlerDeps,
): (request: ClickRequest) => Promise<ClickResponse> {
  return async function handleClick(request: ClickRequest): Promise<ClickResponse> {
    const startedAt = Date.now();

    // 1. ověření tokenu
    const result = verifyTrackingToken(request.token, ['c'], {
      keyring: deps.keyring,
      now: request.now,
    });
    if (!result.ok) {
      recordTokenInvalid(result.code);
      return expired();
    }
    if (result.fields.type !== 'c') return expired();
    const token = result.fields;

    // 2. cíl výhradně z databáze podle link_id, nikdy ze vstupu.
    // Projekt z ověřeného tokenu jde do cache i do dotazu, takže odkaz cizího
    // projektu se nedohledá už v cache, ne až kontrolou o řádek níž.
    const link = await deps.links.get(token.workspaceId, token.linkId);

    // 3. odkaz musí existovat a patřit témuž projektu jako token
    if (link === null || link.workspaceId !== token.workspaceId) return expired();

    // 4. klasifikace z hlaviček, pravidla 5 a 6 se dopočítají asynchronně
    const clickClass = classifyClickHot({
      userAgent: request.userAgent,
      method: request.method,
      headers: request.headers,
    });
    recordClick(clickClass);

    // 5. zápis do bufferu, odpověď se na databázi neblokuje
    deps.push({
      kind: 'click',
      workspaceId: token.workspaceId,
      messageId: token.messageId,
      messageCreatedAt: token.messageCreatedAt,
      campaignId: link.campaignId,
      linkId: link.id,
      linkPosition: link.position,
      occurredAt: request.now,
      clickClass,
      ip: request.ip,
    });

    // 6. a 7. identita se předává jen na vlastní doménu zákazníka
    let target = link.url;
    const host = normalizeHost(link.url);
    if (
      clickClass === 'human' &&
      deps.isWebTrackingEnabled(token.workspaceId) &&
      deps.domains.isAllowed(token.workspaceId, host)
    ) {
      const contactId = await withTimeout(
        deps.lookupContactId(token.workspaceId, token.messageId, token.messageCreatedAt),
        deps.contactLookupTimeoutMs,
      );
      if (contactId !== null) {
        const minted = mintIdentityToken({
          workspaceId: token.workspaceId,
          contactId,
          campaignId: link.campaignId,
          ttlSeconds: deps.identityTokenTtlSeconds,
          keyring: deps.keyring,
          currentKeyId: deps.currentKeyId,
          now: request.now,
        });
        target = appendQueryParam(link.url, 'ml_token', minted.token);
      }
    }

    trackingMetrics.redirectDuration.observe((Date.now() - startedAt) / 1000);
    return { status: 302, location: target, headers: REDIRECT_HEADERS };
  };
}

/**
 * Když dohledání kontaktu trvá dýl než strop, ml_token se nepřidá a přesměrování
 * proběhne bez něj. Ztráta propojení identity u jednoho kliku je nesrovnatelně
 * menší škoda než pomalé přesměrování pro člověka, který čeká na stránku.
 */
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
    timer.unref?.();
  });
  try {
    return await Promise.race([promise.catch(() => null), timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
```

- [ ] **Step 4: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/handle-click.db.test.ts`
Expected: PASS, 9 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/tracking/click/handle-click.ts packages/core/test/tracking/handle-click.db.test.ts
git commit -m "feat(tracking): redirect clicks from stored target only, never from input"
```

---

### Task 21: Povrch `/t/**` a stránka pro neplatný odkaz

Chyby na `/t/**` se **nevrací jako problem+json**. Pixel vrací vždy `200` s GIFem, klik vždy `302` na `/t/expired`. Kód chyby jde jen do metriky a do logu.

Rate limit má na tomhle povrchu výjimku: při překročení se **nevrací 429**, pixel vrátí normální GIF a klik normálně přesměruje, jen se událost nezapíše. Uživatel nesmí kvůli našemu limitu vidět rozbitý obrázek nebo nefunkční odkaz.

**Files:**
- Create: `packages/core/tracking/api/public-tracking.routes.ts`
- Create: `apps/web/src/app/t/[[...path]]/route.ts`
- Create: `apps/web/src/app/t/expired/page.tsx`
- Test: `packages/core/test/tracking/public-tracking.routes.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/public-tracking.routes.test.ts
import { describe, expect, it } from 'vitest';
import { createPublicTrackingRoutes } from '../../tracking/api/public-tracking.routes';

const OPEN = 't1bwEBkvOgHC1-QJobLD1OX2BxAZLzoBwtfkGLLD1OX2Bxgmpk3YDUjmcTwPYu1Q9cpqmSPs4g';

function app(overrides = {}) {
  return createPublicTrackingRoutes({
    handleOpen: () => {},
    handleClick: async () => ({
      status: 302 as const,
      location: 'https://shop.cz/x',
      headers: { 'Referrer-Policy': 'no-referrer' },
    }),
    consumeRateLimit: async () => true,
    ...overrides,
  });
}

describe('/t routes', () => {
  it('platný pixel vrátí 200, image/gif a 42 bajtů', async () => {
    const res = await app().request(`/o/${OPEN}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/gif');
    expect((await res.arrayBuffer()).byteLength).toBe(42);
  });

  it('neplatný token vrátí bajt po bajtu stejnou odpověď jako platný', async () => {
    const ok = await app().request(`/o/${OPEN}`);
    const bad = await app().request('/o/t1nesmysl');
    expect(bad.status).toBe(ok.status);
    expect(Buffer.from(await bad.arrayBuffer())).toEqual(Buffer.from(await ok.arrayBuffer()));
    expect(bad.headers.get('cache-control')).toBe(ok.headers.get('cache-control'));
  });

  it('překročený rate limit vrátí GIF, nikdy 429', async () => {
    const res = await app({ consumeRateLimit: async () => false }).request(`/o/${OPEN}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/gif');
  });

  it('překročený rate limit u kliku přesměruje, nikdy nevrátí 429', async () => {
    const res = await app({ consumeRateLimit: async () => false }).request('/c/t1cokoliv');
    expect(res.status).toBe(302);
  });

  it('klik vrátí 302 a hlavičku Referrer-Policy', async () => {
    const res = await app().request('/c/t1cokoliv');
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('https://shop.cz/x');
    expect(res.headers.get('referrer-policy')).toBe('no-referrer');
  });

  it('HEAD na klik vrátí přesměrování bez těla', async () => {
    const res = await app().request('/c/t1cokoliv', { method: 'HEAD' });
    expect(res.status).toBe(302);
    expect(await res.text()).toBe('');
  });

  it('token delší než 512 znaků vrátí 404 a handler se nezavolá', async () => {
    let called = false;
    const res = await app({ handleOpen: () => { called = true; } }).request(`/o/${'a'.repeat(600)}`);
    expect(res.status).toBe(404);
    expect(called).toBe(false);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/public-tracking.routes.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/api/public-tracking.routes"`.

- [ ] **Step 3: Napiš Hono podaplikaci**

```ts
// packages/core/tracking/api/public-tracking.routes.ts
import { Hono } from 'hono';
import { PIXEL_GIF, PIXEL_HEADERS } from '../open/gif';
import type { OpenRequest } from '../open/handle-open';
import type { ClickRequest, ClickResponse } from '../click/handle-click';
import { EXPIRED_PATH, REDIRECT_HEADERS } from '../click/handle-click';

const MAX_TOKEN_LENGTH = 512;

export type PublicTrackingDeps = {
  handleOpen: (request: OpenRequest) => void;
  handleClick: (request: ClickRequest) => Promise<ClickResponse>;
  /** Vrátí false při překročení limitu. Nikdy z toho nesmí být 429, viz 3.7.4. */
  consumeRateLimit: (key: string, route: 'open' | 'click') => Promise<boolean>;
  clientIp?: (headers: Record<string, string | undefined>) => string | null;
  country?: (ip: string | null) => string | null;
};

function headerBag(request: Request): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  request.headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

export function createPublicTrackingRoutes(deps: PublicTrackingDeps): Hono {
  const app = new Hono();

  app.get('/o/:token', async (c) => {
    const token = c.req.param('token');
    if (token.length > MAX_TOKEN_LENGTH) return c.notFound();

    const headers = headerBag(c.req.raw);
    const ip = deps.clientIp?.(headers) ?? null;

    // Limit se uplatní tak, že se událost nezapíše. Odpověď zůstává stejná.
    if (await deps.consumeRateLimit(ip ?? 'unknown', 'open')) {
      deps.handleOpen({
        token,
        userAgent: headers['user-agent'] ?? '',
        method: c.req.method,
        headers,
        ip,
        now: new Date(),
        country: deps.country?.(ip) ?? null,
      });
    }

    return new Response(PIXEL_GIF, { status: 200, headers: PIXEL_HEADERS });
  });

  app.on(['GET', 'HEAD'], '/c/:token', async (c) => {
    const token = c.req.param('token');
    if (token.length > MAX_TOKEN_LENGTH) return c.notFound();

    const headers = headerBag(c.req.raw);
    const ip = deps.clientIp?.(headers) ?? null;
    const url = new URL(c.req.url);

    if (!(await deps.consumeRateLimit(ip ?? 'unknown', 'click'))) {
      // Bez zápisu, ale odkaz musí fungovat. Neplatnost cíle neznáme, takže expired.
      return new Response(null, {
        status: 302,
        headers: { ...REDIRECT_HEADERS, Location: EXPIRED_PATH },
      });
    }

    const result = await deps.handleClick({
      token,
      userAgent: headers['user-agent'] ?? '',
      method: c.req.method,
      headers,
      ip,
      query: url.search,
      now: new Date(),
    });

    return new Response(null, {
      status: result.status,
      headers: { ...result.headers, Location: result.location },
    });
  });

  return app;
}
```

- [ ] **Step 4: Napiš route handler v Next.js**

```ts
// apps/web/src/app/t/[[...path]]/route.ts
import { handle } from 'hono/vercel';
import { trackingRuntime } from '@/lib/tracking-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const app = trackingRuntime.publicTrackingRoutes.basePath('/t');

export const GET = handle(app);
export const HEAD = handle(app);
```

`@/lib/tracking-runtime` je jediný modul v `apps/web`, který drží živé instance cache, keyringu a bufferu. Dodává ho Task 24. Do té doby test route handleru neexistuje a je to v pořádku, testuje se Hono podaplikace, ne obal.

- [ ] **Step 5: Napiš stránku pro neplatný odkaz**

```tsx
// apps/web/src/app/t/expired/page.tsx
import { getTranslations } from 'next-intl/server';
import Link from 'next/link';

export const dynamic = 'force-static';

/**
 * Statická stránka bez parametrů. Nikdy nepřesměrovává dál,
 * jinak by z ní bylo přesně to otevřené přesměrování, kterému se vyhýbáme.
 */
export default async function TrackingExpiredPage(): Promise<React.ReactElement> {
  const t = await getTranslations('tracking.expired');
  return (
    <main className="mx-auto flex max-w-md flex-col gap-4 px-6 py-24 text-center">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <p className="text-muted-foreground">{t('body')}</p>
      <Link href="/" className="underline">
        {t('home')}
      </Link>
    </main>
  );
}
```

- [ ] **Step 6: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/public-tracking.routes.test.ts`
Expected: PASS, 7 testů.

- [ ] **Step 7: Commit**

```bash
git add packages/core/tracking/api/public-tracking.routes.ts apps/web/src/app/t packages/core/test/tracking/public-tracking.routes.test.ts
git commit -m "feat(tracking): expose /t surface with gif and redirect only responses"
```

---

### Task 22: Schéma přijímané dávky a verzování payloadu

Pole `v` má pravidla s dlouhým dosahem: SDK se distribuuje i jako npm balíček a **jednou zabundlovaná verze na cizím webu žije roky a nikdo ji neaktualizuje**. Zákazník, který si SDK zabundloval v roce 2026, může posílat `v: 1` v roce 2032 a musí to fungovat. Podpora `v: 1` proto nemá časové omezení a nová verze se zavádí aditivně vedle staré, nikdy místo ní.

Chybějící `v` se chová jako neznámé. Nedoplňuje se výchozí hodnota, protože „chybí" a „je jedna" nejsou totéž a tiché doplnění by skrylo rozbitý build u zákazníka.

**Files:**
- Create: `packages/core/tracking/ingest/schema.ts`
- Test: `packages/core/test/tracking/ingest-schema.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/ingest-schema.test.ts
import { describe, expect, it } from 'vitest';
import { IngestBatchSchema, SUPPORTED_PAYLOAD_VERSIONS, parseBatch } from '../../tracking/ingest/schema';

const validEvent = {
  id: '0192f3a0-1c2d-7e50-8a1b-2c3d4e5f6071',
  name: 'page_view',
  occurred_at: '2026-07-31T10:00:00.000Z',
};
const validBatch = {
  v: 1,
  key: 'ml_pub_aebagbafaydqqcik',
  sent_at: '2026-07-31T10:00:01.000Z',
  anonymous_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  events: [validEvent],
};

describe('IngestBatchSchema', () => {
  it('přijme platnou dávku', () => {
    expect(IngestBatchSchema.parse(validBatch).events).toHaveLength(1);
  });

  it('podporované verze payloadu jsou vyjmenované a obsahují 1', () => {
    expect(SUPPORTED_PAYLOAD_VERSIONS).toContain(1);
  });

  it('neznámá verze vrátí tracking_payload_version_unsupported a dávka se celá zahodí', () => {
    const result = parseBatch({ ...validBatch, v: 99 });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('tracking_payload_version_unsupported');
    expect(result.params).toEqual({ supported: [...SUPPORTED_PAYLOAD_VERSIONS] });
  });

  it('chybějící verze se chová jako neznámá, nedoplňuje se výchozí hodnota', () => {
    const { v, ...withoutVersion } = validBatch;
    const result = parseBatch(withoutVersion);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('tracking_payload_version_unsupported');
  });

  it('dávka s 51 událostmi skončí kódem too_many_items', () => {
    const result = parseBatch({ ...validBatch, events: Array.from({ length: 51 }, () => validEvent) });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('too_many_items');
  });

  it('prázdná dávka je validation_failed', () => {
    const result = parseBatch({ ...validBatch, events: [] });
    expect(result.ok).toBe(false);
  });

  it('neplatné anonymous_id skončí kódem tracking_invalid_anonymous_id', () => {
    const result = parseBatch({ ...validBatch, anonymous_id: 'nic' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('tracking_invalid_anonymous_id');
  });

  it('neznámý klíč v těle se odmítne, tiché ignorování překlepu je nejhorší odpověď', () => {
    expect(() => IngestBatchSchema.parse({ ...validBatch, emial: 'x' })).toThrow();
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/ingest-schema.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/ingest/schema"`.

- [ ] **Step 3: Napiš schéma**

```ts
// packages/core/tracking/ingest/schema.ts
import { z } from 'zod';
import { EVENT_NAME_RE } from '../types';

export const MAX_EVENTS_PER_BATCH = 50;
export const MAX_IMPORT_EVENTS_PER_BATCH = 1000;

/**
 * Podpora verze 1 nemá časové omezení a nesmí se odebrat.
 * Nová verze se zavádí aditivně vedle staré, protože zabundlované SDK
 * na cizím webu žije roky a nikdo ho neaktualizuje.
 */
export const SUPPORTED_PAYLOAD_VERSIONS = [1] as const;

const isoDateTime = z.string().datetime({ offset: false });

export const EventPageSchema = z
  .object({
    url: z.string().max(2048),
    path: z.string().max(1024),
    title: z.string().max(512).optional(),
    referrer: z.string().max(2048).optional(),
    search: z.string().max(1024).optional(),
  })
  .strict();

export const EventContextSchema = z
  .object({
    locale: z.string().max(35).optional(),
    timezone: z.string().max(64).optional(),
    screen: z.object({ w: z.number().int(), h: z.number().int() }).strict().optional(),
    viewport: z.object({ w: z.number().int(), h: z.number().int() }).strict().optional(),
    device: z.enum(['mobile', 'tablet', 'desktop', 'unknown']).optional(),
    os: z.string().max(32).optional(),
    browser: z.string().max(32).optional(),
    sdk: z.object({ name: z.literal('ml-web'), version: z.string().max(32) }).strict().optional(),
    campaign: z
      .object({
        source: z.string().max(255).optional(),
        medium: z.string().max(255).optional(),
        campaign: z.string().max(255).optional(),
        content: z.string().max(255).optional(),
        term: z.string().max(255).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const IngestEventSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().regex(EVENT_NAME_RE),
    occurred_at: isoDateTime,
    session_id: z.string().uuid().optional(),
    page: EventPageSchema.optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
    context: EventContextSchema.optional(),
  })
  .strict();

export const IngestBatchSchema = z
  .object({
    v: z.number().int(),
    key: z.string().min(1).max(64),
    sent_at: isoDateTime,
    anonymous_id: z.string().optional(),
    events: z.array(IngestEventSchema).min(1),
  })
  .strict();

export type IngestBatch = z.infer<typeof IngestBatchSchema>;
export type IngestEvent = z.infer<typeof IngestEventSchema>;

export type ParseBatchResult =
  | { ok: true; batch: IngestBatch }
  | { ok: false; code: string; status: number; params?: Record<string, unknown> };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pořadí kontrol je záměrné: verze payloadu se posuzuje dřív než tvar,
 * protože při neznámé verzi nemá smysl vytýkat pole, která v ní možná nejsou.
 */
export function parseBatch(input: unknown): ParseBatchResult {
  const version = (input as { v?: unknown } | null)?.v;
  if (typeof version !== 'number' || !SUPPORTED_PAYLOAD_VERSIONS.includes(version as 1)) {
    return {
      ok: false,
      code: 'tracking_payload_version_unsupported',
      status: 400,
      params: { supported: [...SUPPORTED_PAYLOAD_VERSIONS] },
    };
  }

  const events = (input as { events?: unknown }).events;
  if (Array.isArray(events) && events.length > MAX_EVENTS_PER_BATCH) {
    return { ok: false, code: 'too_many_items', status: 422, params: { limit: MAX_EVENTS_PER_BATCH } };
  }

  const anonymousId = (input as { anonymous_id?: unknown }).anonymous_id;
  if (anonymousId !== undefined && (typeof anonymousId !== 'string' || !UUID_RE.test(anonymousId))) {
    return { ok: false, code: 'tracking_invalid_anonymous_id', status: 422 };
  }

  const parsed = IngestBatchSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: 'validation_failed', status: 422 };

  return { ok: true, batch: parsed.data };
}
```

- [ ] **Step 4: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/ingest-schema.test.ts`
Expected: PASS, 8 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/tracking/ingest/schema.ts packages/core/test/tracking/ingest-schema.test.ts
git commit -m "feat(tracking): validate ingest batch with permanent payload version support"
```

---

### Task 23: Čištění adres a ořez vlastností

**Ořez `properties` nesmí být tichý.** Byla to mezera, kterou je vidět až u zákazníka: kdo posílá do košíkové události čtyřicet vlastností nebo strukturu o čtyřech úrovních, dostal osekaná data a nikde se to nedozvěděl. Projevilo se to až tím, že mu v segmentu chybí kontakty, a hledalo se to týdny.

Události s ořezanými vlastnostmi jsou započítané v `accepted`, ne v `rejected`: uložily se, jen ne celé. Zahodit událost kvůli jedné dlouhé hodnotě by byla horší škoda.

**Files:**
- Create: `packages/core/tracking/ingest/sanitize-url.ts`
- Create: `packages/core/tracking/ingest/sanitize-properties.ts`
- Test: `packages/core/test/tracking/sanitize.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/sanitize.test.ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_STRIP_PARAMS, sanitizeUrl, extractCampaign } from '../../tracking/ingest/sanitize-url';
import { sanitizeProperties } from '../../tracking/ingest/sanitize-properties';

const limits = { maxKeys: 3, maxDepth: 2, maxString: 10 };

describe('sanitizeUrl', () => {
  it('odstraní přihlašovací údaje a fragment', () => {
    expect(sanitizeUrl('https://user:pass@x.cz/a#kotva', DEFAULT_STRIP_PARAMS)).toBe('https://x.cz/a');
  });

  it('odstraní citlivé parametry včetně ml_token', () => {
    const out = sanitizeUrl('https://x.cz/a?token=abc&ml_token=t1&email=a@b.cz&keep=1', DEFAULT_STRIP_PARAMS);
    expect(out).toBe('https://x.cz/a?keep=1');
  });

  it('zachová utm a značkovací parametry', () => {
    const out = sanitizeUrl('https://x.cz/a?utm_source=news&gclid=g1&fbclid=f1', DEFAULT_STRIP_PARAMS);
    expect(out).toContain('utm_source=news');
    expect(out).toContain('gclid=g1');
    expect(out).toContain('fbclid=f1');
  });

  it('u citlivé cesty zahodí celý query řetězec', () => {
    for (const path of ['/reset-hesla', '/obnova-hesla', '/login', '/prihlaseni', '/verify', '/overeni']) {
      expect(sanitizeUrl(`https://x.cz${path}?cokoliv=1`, DEFAULT_STRIP_PARAMS)).toBe(`https://x.cz${path}`);
    }
  });

  it('nevalidní adresu vrátí jako prázdný řetězec, ne jako výjimku', () => {
    expect(sanitizeUrl('není url', DEFAULT_STRIP_PARAMS)).toBe('');
  });

  it('rozparsuje utm parametry do context.campaign', () => {
    expect(extractCampaign('https://x.cz/a?utm_source=news&utm_medium=email')).toEqual({
      source: 'news',
      medium: 'email',
    });
  });
});

describe('sanitizeProperties', () => {
  it('ořeže počet klíčů abecedně od konce a ohlásí nález', () => {
    const out = sanitizeProperties({ a: 1, b: 2, c: 3, d: 4, e: 5 }, limits);
    expect(Object.keys(out.value).sort()).toEqual(['a', 'b', 'c']);
    expect(out.findings[0]).toMatchObject({
      code: 'tracking_properties_keys_dropped',
      severity: 'warning',
    });
    expect(out.findings[0]!.params).toMatchObject({ dropped: 2, limit: 3 });
  });

  it('ořeže dlouhý řetězec a ohlásí původní délku', () => {
    const out = sanitizeProperties({ description: 'x'.repeat(40) }, limits);
    expect((out.value.description as string).length).toBe(10);
    expect(out.findings[0]).toMatchObject({ code: 'tracking_properties_value_truncated' });
    expect(out.findings[0]!.params).toMatchObject({ key: 'description', limit: 10, original_length: 40 });
  });

  it('nahradí hlubší úrovně hodnotou null a ohlásí cestu', () => {
    const out = sanitizeProperties({ cart: { items: { deep: 1 } } }, limits);
    expect(out.value).toEqual({ cart: { items: null } });
    expect(out.findings[0]).toMatchObject({ code: 'tracking_properties_depth_truncated' });
  });

  it('zahodí klíč delší než 64 znaků', () => {
    const out = sanitizeProperties({ [`${'k'.repeat(65)}`]: 1, ok: 2 }, limits);
    expect(Object.keys(out.value)).toEqual(['ok']);
    expect(out.findings.some((f) => f.code === 'tracking_properties_keys_dropped')).toBe(true);
  });

  it('vzorek zahozených klíčů je nejvýš pět jmen', () => {
    const many = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${String(i).padStart(2, '0')}`, i]));
    const out = sanitizeProperties(many, limits);
    expect((out.findings[0]!.params!.keys as string[]).length).toBeLessThanOrEqual(5);
  });

  it('vlastnosti v limitu projdou beze změny a bez nálezu', () => {
    const out = sanitizeProperties({ value: 1490.5, currency: 'CZK' }, limits);
    expect(out.value).toEqual({ value: 1490.5, currency: 'CZK' });
    expect(out.findings).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/sanitize.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/ingest/sanitize-url"`.

- [ ] **Step 3: Napiš čištění adres**

```ts
// packages/core/tracking/ingest/sanitize-url.ts

/**
 * Výchozí sada odstraňovaných parametrů. Konfigurace ji smí jen rozšiřovat,
 * nikdy zkracovat pod tuhle množinu.
 * ml_token je v seznamu schválně: SDK ho sice z adresy maže přes replaceState,
 * ale první page_view může proběhnout dřív.
 */
export const DEFAULT_STRIP_PARAMS: readonly string[] = [
  'token', 'access_token', 'refresh_token', 'id_token', 'password', 'passwd', 'pwd',
  'secret', 'api_key', 'apikey', 'key', 'signature', 'sig', 'auth', 'session',
  'sessionid', 'otp', 'code', 'email', 'e-mail', 'phone', 'tel', 'ssn', 'rc', 'ml_token',
];

const SENSITIVE_PATH_RE = /\/(reset|obnova)-?hesla|\/login|\/prihlaseni|\/verify|\/overeni/i;
const CAMPAIGN_PARAMS = ['source', 'medium', 'campaign', 'content', 'term'] as const;

export function sanitizeUrl(rawUrl: string, stripParams: readonly string[]): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return '';
  }

  url.username = '';
  url.password = '';
  url.hash = '';

  if (SENSITIVE_PATH_RE.test(url.pathname)) {
    url.search = '';
    return url.toString();
  }

  const strip = new Set(stripParams.map((p) => p.toLowerCase()));
  for (const name of [...url.searchParams.keys()]) {
    if (strip.has(name.toLowerCase())) url.searchParams.delete(name);
  }

  return url.toString();
}

export function extractCampaign(rawUrl: string): Record<string, string> | undefined {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const name of CAMPAIGN_PARAMS) {
    const value = url.searchParams.get(`utm_${name}`);
    if (value !== null && value !== '') out[name] = value.slice(0, 255);
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
```

- [ ] **Step 4: Napiš ořez vlastností**

```ts
// packages/core/tracking/ingest/sanitize-properties.ts

export type PropertyLimits = { maxKeys: number; maxDepth: number; maxString: number };

export type Finding = {
  code: string;
  severity: 'warning';
  message: string;
  params?: Record<string, unknown>;
};

export type SanitizeResult = {
  value: Record<string, unknown>;
  findings: Finding[];
};

const MAX_KEY_LENGTH = 64; // není konfigurovatelná, souvisí s čitelností ve filtrech UI
const SAMPLE_SIZE = 5;

/**
 * Ořez se hlásí ve findings odpovědi 202 se severity warning.
 * Událost projde a je započítaná v accepted, protože zahodit ji kvůli
 * jedné dlouhé hodnotě by byla horší škoda než uložit ji osekanou.
 */
export function sanitizeProperties(
  input: Record<string, unknown>,
  limits: PropertyLimits,
): SanitizeResult {
  const findings: Finding[] = [];
  const dropped: string[] = [];

  const keptKeys = Object.keys(input)
    .filter((key) => {
      if (key.length > MAX_KEY_LENGTH) {
        dropped.push(key);
        return false;
      }
      return true;
    })
    .sort();

  // Přebytečné klíče se zahazují abecedně od konce, aby byl výsledek deterministický.
  const overflow = keptKeys.slice(limits.maxKeys);
  dropped.push(...overflow);
  const finalKeys = keptKeys.slice(0, limits.maxKeys);

  if (dropped.length > 0) {
    findings.push({
      code: 'tracking_properties_keys_dropped',
      severity: 'warning',
      message: 'Událost měla víc vlastností, než se ukládá.',
      params: { dropped: dropped.length, limit: limits.maxKeys, keys: dropped.slice(0, SAMPLE_SIZE) },
    });
  }

  const value: Record<string, unknown> = {};
  for (const key of finalKeys) {
    value[key] = walk(input[key], key, 1, limits, findings);
  }

  return { value, findings };
}

function walk(
  node: unknown,
  path: string,
  depth: number,
  limits: PropertyLimits,
  findings: Finding[],
): unknown {
  if (typeof node === 'string') {
    if (node.length <= limits.maxString) return node;
    findings.push({
      code: 'tracking_properties_value_truncated',
      severity: 'warning',
      message: 'Hodnota vlastnosti byla zkrácena.',
      params: { key: path, limit: limits.maxString, original_length: node.length },
    });
    return node.slice(0, limits.maxString);
  }

  if (node === null || typeof node !== 'object') return node;

  if (depth >= limits.maxDepth) {
    findings.push({
      code: 'tracking_properties_depth_truncated',
      severity: 'warning',
      message: 'Vlastnost je zanořená hlouběji, než se ukládá.',
      params: { key: path, limit: limits.maxDepth },
    });
    return null;
  }

  if (Array.isArray(node)) {
    return node.map((item, index) => walk(item, `${path}.${index}`, depth + 1, limits, findings));
  }

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
    if (key.length > MAX_KEY_LENGTH) continue;
    out[key] = walk(child, `${path}.${key}`, depth + 1, limits, findings);
  }
  return out;
}
```

- [ ] **Step 5: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/sanitize.test.ts`
Expected: PASS, 12 testů.

- [ ] **Step 6: Commit**

```bash
git add packages/core/tracking/ingest/sanitize-url.ts packages/core/tracking/ingest/sanitize-properties.ts packages/core/test/tracking/sanitize.test.ts
git commit -m "feat(tracking): clean urls and report property truncation as findings"
```

---

### Task 24: Běhový modul trackingu v `apps/web`

Jedno místo, kde žijí instance keyringu, cache a bufferu. Bez něj by si každý route handler vyrobil vlastní cache a vlastní buffer, takže by se limity počítaly nezávisle a při vypnutí procesu by se nevyprázdnil žádný.

**Files:**
- Create: `apps/web/src/lib/tracking-runtime.ts`
- Test: `apps/web/test/tracking-runtime.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// apps/web/test/tracking-runtime.test.ts
import { describe, expect, it } from 'vitest';
import { trackingRuntime } from '../src/lib/tracking-runtime';

describe('tracking runtime', () => {
  it('je jediná instance napříč importy', async () => {
    const again = (await import('../src/lib/tracking-runtime')).trackingRuntime;
    expect(again).toBe(trackingRuntime);
  });

  it('vystavuje obě Hono podaplikace', () => {
    expect(trackingRuntime.publicTrackingRoutes).toBeDefined();
    expect(trackingRuntime.publicEventRoutes).toBeDefined();
  });

  it('zjistí IP podle TRUST_PROXY, nikdy naivně první hodnotou z XFF', () => {
    const headers = { 'x-forwarded-for': '1.2.3.4, 5.6.7.8, 9.10.11.12' };
    expect(trackingRuntime.clientIp(headers, 0)).toBeNull();
    expect(trackingRuntime.clientIp(headers, 1)).toBe('9.10.11.12');
    expect(trackingRuntime.clientIp(headers, 2)).toBe('5.6.7.8');
  });

  it('shutdown vyprázdní buffer', async () => {
    await expect(trackingRuntime.shutdown()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run apps/web/test/tracking-runtime.test.ts`
Expected: FAIL, `Failed to resolve import "../src/lib/tracking-runtime"`.

- [ ] **Step 3: Napiš běhový modul**

```ts
// apps/web/src/lib/tracking-runtime.ts
import { config } from '@mlain/core/config';
import { trackingConfig } from '@mlain/core/tracking/config';
import { buildTrackingKeyring } from '@mlain/core/tracking/tokens/keyring';
import { ProxyRangeIndex } from '@mlain/core/tracking/open/proxy-ranges';
import { createOpenHandler, type BufferedOpen } from '@mlain/core/tracking/open/handle-open';
import { createClickHandler, type BufferedClick } from '@mlain/core/tracking/click/handle-click';
import { LinkCache } from '@mlain/core/tracking/click/link-cache';
import { TrackingDomainCache } from '@mlain/core/tracking/domains/domain-cache';
import { EventBuffer } from '@mlain/core/tracking/writer/event-buffer';
import { flushTrackingBuffer } from '@mlain/core/tracking/writer/flush';
import { lookupMessage } from '@mlain/core/tracking/tokens/message-lookup';
import { createPublicTrackingRoutes } from '@mlain/core/tracking/api/public-tracking.routes';
import { createPublicEventRoutes } from '@mlain/core/tracking/api/public-events.routes';
import { trackingMetrics } from '@mlain/core/tracking/metrics';
import { TtlLru } from '@mlain/core/tracking/click/lru';
import { consumeTrackingRateLimit } from './tracking-rate-limit';

const keyring = buildTrackingKeyring({
  secretKey: config.SECRET_KEY,
  secretKeyPrevious: config.SECRET_KEY_PREVIOUS,
});
const currentKeyId = Math.max(...keyring.keys());

const proxyRanges = new ProxyRangeIndex([], {
  useAppleRelayRanges: trackingConfig.appleRelayRanges,
});

const domains = new TrackingDomainCache({ refreshMs: 60_000 });
const links = new LinkCache({ capacity: 50_000, ttlMs: 15 * 60_000 });

/** message_id na contact_id. Tentýž člověk obvykle klikne v jednom mailu vícekrát. */
const contactByMessage = new TtlLru<string, string | null>({ capacity: 20_000, ttlMs: 15 * 60_000 });

const buffer = new EventBuffer<BufferedOpen | BufferedClick>({
  flushMs: trackingConfig.writerFlushMs,
  batchSize: trackingConfig.writerBatch,
  capacity: 20_000,
  flush: flushTrackingBuffer,
  onDrop: (count) => trackingMetrics.writerDropped.inc(count),
  onFlushDuration: (seconds) => trackingMetrics.writerFlushDuration.observe(seconds),
});

/**
 * Zjištění IP podle TRUST_PROXY. Naivní „vezmi první hodnotu z XFF" je zakázané,
 * protože tu hodnotu si klient napíše sám a rate limit i klasifikace by šly obejít.
 */
function clientIp(headers: Record<string, string | undefined>, trustProxy = config.TRUST_PROXY): string | null {
  if (trustProxy === 0) return headers['x-real-ip'] ?? null;
  const chain = (headers['x-forwarded-for'] ?? '').split(',').map((v) => v.trim()).filter((v) => v !== '');
  if (chain.length === 0) return null;
  return chain[chain.length - trustProxy] ?? null;
}

const handleOpen = createOpenHandler({
  keyring,
  proxyRanges,
  push: (item) => buffer.push(item),
});

const handleClick = createClickHandler({
  keyring,
  currentKeyId,
  links,
  domains,
  push: (item) => buffer.push(item),
  lookupContactId: async (workspaceId, messageId, createdAt) =>
    contactByMessage.getOrLoad(messageId, async () => {
      const row = await lookupMessage({ workspaceId, messageId, messageCreatedAt: createdAt });
      return row?.contactId ?? null;
    }),
  isWebTrackingEnabled: () => true, // nahradí Task 41 čtením workspaces.settings
  identityTokenTtlSeconds: trackingConfig.identityTokenTtlSeconds,
  contactLookupTimeoutMs: 30,
});

domains.start();

export const trackingRuntime = {
  keyring,
  currentKeyId,
  proxyRanges,
  domains,
  links,
  buffer,
  clientIp,
  publicTrackingRoutes: createPublicTrackingRoutes({
    handleOpen,
    handleClick,
    consumeRateLimit: consumeTrackingRateLimit,
    clientIp: (headers) => clientIp(headers),
  }),
  publicEventRoutes: createPublicEventRoutes({
    keyring,
    domains,
    clientIp: (headers) => clientIp(headers),
  }),
  async shutdown(): Promise<void> {
    domains.stop();
    await buffer.shutdown();
  },
};
```

- [ ] **Step 4: Napiš vyprázdnění bufferu**

```ts
// packages/core/tracking/writer/flush.ts
import { v5 as uuidv5 } from 'uuid';
import { enqueue } from '@mlain/core/jobs';
import type { BufferedOpen } from '../open/handle-open';
import type { BufferedClick } from '../click/handle-click';
import { insertMessageEvents, type MessageEventInsert } from '../repo/message-events.repo';
import { lookupMessage } from '../tokens/message-lookup';

/**
 * Jmenný prostor pro odvození ID události. Je to konstanta, ne náhoda:
 * kdyby se změnila, přestala by fungovat idempotence u dávek, které jsou
 * zrovna v letu.
 */
const EVENT_ID_NAMESPACE = '6ba7b811-9dad-11d1-80b4-00c04fd430c8';

/**
 * ID se **odvozuje z události, negeneruje se náhodně**. Dřív tu bylo
 * `uuidv7()`, takže opakovaný flush téže dávky vyrobil pokaždé jiná ID
 * a `WHERE NOT EXISTS` v repository neměla co porovnat. Duplicita by pak
 * vznikla při každém opakování, které nastane vždycky, když zápis projde
 * a zařazení navazujícího jobu spadne.
 *
 * Do klíče jde vše, co dvě různé události odlišuje: zpráva, obě složky jejího
 * primárního klíče, typ, čas na milisekundu a u kliku i odkaz. Dvě otevření
 * téže zprávy v různý okamžik tak zůstávají dvě události, opakovaný zápis
 * téhož otevření je jedna.
 */
function deriveEventId(parts: readonly (string | number)[]): string {
  return uuidv5(parts.join('|'), EVENT_ID_NAMESPACE);
}

/**
 * Kampaň se u otevření dohledá až tady, tedy mimo horkou cestu.
 * U kliku ji nese už položka z bufferu, protože ji dala cache odkazů.
 */
export async function flushTrackingBuffer(
  batch: (BufferedOpen | BufferedClick)[],
): Promise<void> {
  const rows: MessageEventInsert[] = [];

  for (const item of batch) {
    const message = await lookupMessage({
      workspaceId: item.workspaceId,
      messageId: item.messageId,
      messageCreatedAt: item.messageCreatedAt,
    });
    // Nenalezená zpráva se neztratí, jen se nezapočítá do reportu kampaně.
    if (message === null) continue;

    rows.push(
      item.kind === 'open'
        ? {
            id: deriveEventId([
              item.workspaceId,
              item.messageId,
              item.messageCreatedAt,
              'open',
              item.occurredAt.getTime(),
              item.openClass,
            ]),
            workspaceId: item.workspaceId,
            messageId: item.messageId,
            messageCreatedAt: message.createdAt,
            campaignId: message.campaignId,
            contactId: message.contactId,
            type: 'open',
            subtype: item.openClass,
            ts: item.occurredAt,
            linkId: null,
            metadata: item.country === null ? {} : { country: item.country },
          }
        : {
            id: deriveEventId([
              item.workspaceId,
              item.messageId,
              item.messageCreatedAt,
              'click',
              item.occurredAt.getTime(),
              item.linkId,
            ]),
            workspaceId: item.workspaceId,
            messageId: item.messageId,
            messageCreatedAt: message.createdAt,
            campaignId: item.campaignId,
            contactId: message.contactId,
            type: 'click',
            subtype: item.clickClass,
            ts: item.occurredAt,
            linkId: item.linkId,
            // Pozice odkazu je rozhodnutí zadavatele: sleduje se, na který odkaz
            // v mailu se kliklo, a po překompilování šablony by se nedohledala.
            metadata: { link_position: item.linkPosition },
          },
    );
  }

  const insertedIds = await insertMessageEvents(rows);
  if (insertedIds.length > 0) {
    await enqueue('tracking.process_engagement', { messageEventIds: insertedIds });
  }
}
```

- [ ] **Step 5: Spusť test a ověř, že prochází**

Run: `pnpm vitest run apps/web/test/tracking-runtime.test.ts`
Expected: PASS, 4 testy.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/tracking-runtime.ts packages/core/tracking/writer/flush.ts apps/web/test/tracking-runtime.test.ts
git commit -m "feat(tracking): wire single runtime for caches, keyring and writer buffer"
```

---

### Task 25: Korekce hodin a ověření veřejného klíče `[db]`

Hodiny v prohlížeči nejsou spolehlivé, uživatel si je může nastavit na rok 1970 nebo 2099. Okno je jediné místo, kde se taková hodnota zastaví, a zároveň ohraničuje, o kolik oddílů zpět musí časová osa sáhnout. **Pro dávkový import se korekce ani okno nepoužijí**, tam čas dodává server zákazníka z vlastní databáze objednávek.

**Files:**
- Create: `packages/core/tracking/ingest/clock-skew.ts`
- Create: `packages/core/tracking/ingest/public-key.ts`
- Test: `packages/core/test/tracking/clock-skew.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/clock-skew.test.ts
import { describe, expect, it } from 'vitest';
import { correctOccurredAt } from '../../tracking/ingest/clock-skew';

const serverNow = new Date('2026-07-31T12:00:00.000Z');

describe('correctOccurredAt', () => {
  it('posun hodin klienta se dopočítá a použije', () => {
    const out = correctOccurredAt({
      occurredAt: new Date('2026-07-31T11:59:00.000Z'),
      sentAt: new Date('2026-07-31T11:59:30.000Z'),
      serverNow,
    });
    expect(out.occurredAt.toISOString()).toBe('2026-07-31T11:59:30.000Z');
    expect(out.clockSkewMs).toBe(30_000);
  });

  it('posun nad 24 hodin se zahodí a použije se čas serveru', () => {
    const out = correctOccurredAt({
      occurredAt: new Date('1970-01-01T00:00:00.000Z'),
      sentAt: new Date('1970-01-01T00:00:00.000Z'),
      serverNow,
    });
    expect(out.occurredAt).toEqual(serverNow);
  });

  it('čas se ořízne na sedm dní zpět, aby padl do existujícího oddílu', () => {
    const out = correctOccurredAt({
      occurredAt: new Date('2026-07-01T12:00:00.000Z'),
      sentAt: new Date('2026-07-31T12:00:00.000Z'),
      serverNow,
    });
    expect(out.occurredAt.toISOString()).toBe('2026-07-24T12:00:00.000Z');
  });

  it('čas se ořízne na 60 sekund dopředu', () => {
    const out = correctOccurredAt({
      occurredAt: new Date('2026-07-31T12:10:00.000Z'),
      sentAt: new Date('2026-07-31T12:00:00.000Z'),
      serverNow,
    });
    expect(out.occurredAt.toISOString()).toBe('2026-07-31T12:01:00.000Z');
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/clock-skew.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/ingest/clock-skew"`.

- [ ] **Step 3: Napiš korekci**

```ts
// packages/core/tracking/ingest/clock-skew.ts

const MAX_SKEW_MS = 24 * 60 * 60 * 1000;
const MAX_LAG_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_AHEAD_MS = 60 * 1000;

export type CorrectInput = { occurredAt: Date; sentAt: Date; serverNow: Date };
export type CorrectResult = { occurredAt: Date; clockSkewMs: number };

/**
 * Obě hranice jsou zároveň vynucené constraintem ck_web_events__lag.
 * Dolní odpovídá životnosti offline fronty v SDK, horní pokrývá hodiny napřed.
 * Bez ořezu by událost spadla mimo existující oddíl a zápis by tvrdě selhal,
 * protože výchozí oddíl se nezakládá.
 */
export function correctOccurredAt(input: CorrectInput): CorrectResult {
  const skewMs = input.serverNow.getTime() - input.sentAt.getTime();

  if (Math.abs(skewMs) > MAX_SKEW_MS) {
    return { occurredAt: input.serverNow, clockSkewMs: skewMs };
  }

  const corrected = input.occurredAt.getTime() + skewMs;
  const lowerBound = input.serverNow.getTime() - MAX_LAG_MS;
  const upperBound = input.serverNow.getTime() + MAX_AHEAD_MS;
  const clamped = Math.min(Math.max(corrected, lowerBound), upperBound);

  return { occurredAt: new Date(clamped), clockSkewMs: skewMs };
}
```

- [ ] **Step 4: Napiš ověření veřejného klíče**

```ts
// packages/core/tracking/ingest/public-key.ts
import { sql } from 'drizzle-orm';
import { withCrossWorkspaceTx } from '../repo/tx';
import { TtlLru } from '../click/lru';

const PUBLIC_KEY_PREFIX = 'ml_pub_';
const PUBLIC_KEY_BODY_RE = /^[a-z2-7]{16}$/;

export type PublicKeyOwner = { workspaceId: string; apiKeyId: string };

const cache = new TtlLru<string, PublicKeyOwner | null>({ capacity: 5_000, ttlMs: 60_000 });

/**
 * Větev P z 3.5 části 1: veřejný klíč se ukládá v otevřené podobě, takže se
 * neporovnávají žádné hashe a nedělá se dummy porovnání. Workspace se bere
 * z řádku klíče, nikdy z URL ani z těla requestu.
 * Vadný tvar se odmítne bez jediného dotazu do databáze.
 */
export async function resolvePublicKey(key: string): Promise<PublicKeyOwner | null> {
  if (!key.startsWith(PUBLIC_KEY_PREFIX)) return null;
  const prefix = key.slice(PUBLIC_KEY_PREFIX.length);
  if (!PUBLIC_KEY_BODY_RE.test(prefix)) return null;

  return cache.getOrLoad(prefix, async () =>
    withCrossWorkspaceTx('tracking.public_key', async (tx) => {
      const { rows } = await tx.execute<PublicKeyOwner>(sql`
        SELECT k.workspace_id AS "workspaceId", k.id AS "apiKeyId"
          FROM api_keys k
          JOIN workspaces w ON w.id = k.workspace_id
         WHERE k.prefix = ${prefix}
           AND k.kind = 'public'
           AND k.revoked_at IS NULL
           AND (k.expires_at IS NULL OR k.expires_at > now())
           AND w.deleted_at IS NULL
      `);
      return rows[0] ?? null;
    }),
  );
}
```

- [ ] **Step 5: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/clock-skew.test.ts`
Expected: PASS, 4 testy.

- [ ] **Step 6: Commit**

```bash
git add packages/core/tracking/ingest/clock-skew.ts packages/core/tracking/ingest/public-key.ts packages/core/test/tracking/clock-skew.test.ts
git commit -m "feat(tracking): correct client clock skew and resolve public keys"
```

---

### Task 26: Přijetí dávky událostí

Endpoint musí odpovědět do desítek milisekund, takže **nečeká na zpracování**: zvaliduje, zařadí job a vrátí `202`. Cílová latence je p99 pod 40 ms.

Odpověď **nikdy neobsahuje žádná data o kontaktu**. Nevrací `contact_id`, e-mail ani informaci o tom, jestli je anonymní ID navázané. Kdyby to dělala, stal by se z endpointu nástroj na zjišťování, kdo je návštěvník.

**Files:**
- Create: `packages/core/tracking/ingest/ingest-service.ts`
- Test: `packages/core/test/tracking/ingest-service.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/ingest-service.test.ts
import { describe, expect, it } from 'vitest';
import { createIngestService } from '../../tracking/ingest/ingest-service';

const WS = '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071';
let counter = 0;
const event = (over: Record<string, unknown> = {}) => {
  counter += 1;
  return {
    id: `0192f3a0-1c2d-7e50-8a1b-2c3d4e5f${String(counter).padStart(4, '0')}`,
    name: 'page_view',
    occurred_at: '2026-07-31T11:59:59.000Z',
    ...over,
  };
};

function service(over = {}) {
  const enqueued: unknown[] = [];
  const svc = createIngestService({
    resolvePublicKey: async () => ({ workspaceId: WS, apiKeyId: 'k1' }),
    isOriginAllowed: () => true,
    allowServersidePublicKey: () => false,
    limits: { maxKeys: 32, maxDepth: 3, maxString: 1024 },
    stripParams: ['token', 'ml_token'],
    enqueue: async (payload) => { enqueued.push(payload); },
    now: () => new Date('2026-07-31T12:00:00.000Z'),
    ...over,
  });
  return { svc, enqueued };
}

const batch = (events: unknown[]) => ({
  v: 1,
  key: 'ml_pub_aebagbafaydqqcik',
  sent_at: '2026-07-31T12:00:00.000Z',
  anonymous_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
  events,
});

describe('ingest service', () => {
  it('platná dávka vrátí 202, zařadí job a neprozradí nic o kontaktu', async () => {
    const { svc, enqueued } = service();
    const out = await svc.accept(batch([event()]), { origin: 'https://shop.cz' });
    expect(out.status).toBe(202);
    expect(out.body).toEqual({ accepted: 1, rejected: 0 });
    expect(enqueued).toHaveLength(1);
    expect(JSON.stringify(out.body)).not.toContain('contact');
  });

  it('Origin mimo tracking_domains vrátí 403 a origin_not_allowed', async () => {
    const { svc } = service({ isOriginAllowed: () => false });
    const out = await svc.accept(batch([event()]), { origin: 'https://evil.example' });
    expect(out.status).toBe(403);
    expect(out.problem?.code).toBe('origin_not_allowed');
  });

  it('požadavek bez Origin se přijme jen při zapnutém nastavení projektu', async () => {
    const off = service();
    expect((await off.svc.accept(batch([event()]), { origin: undefined })).status).toBe(403);
    const on = service({ allowServersidePublicKey: () => true });
    expect((await on.svc.accept(batch([event()]), { origin: undefined })).status).toBe(202);
  });

  it('neznámý veřejný klíč vrátí 401', async () => {
    const { svc } = service({ resolvePublicKey: async () => null });
    expect((await svc.accept(batch([event()]), { origin: 'https://shop.cz' })).status).toBe(401);
  });

  it('jedna vadná událost dávku nezastaví, projdou ostatní', async () => {
    const { svc } = service();
    const out = await svc.accept(
      batch([event(), event({ name: 'Product Viewed' })]),
      { origin: 'https://shop.cz' },
    );
    expect(out.body).toMatchObject({ accepted: 1, rejected: 1 });
    expect(out.body?.findings?.[0]).toMatchObject({ code: 'tracking_invalid_event_name' });
    expect(out.body?.findings?.[0]?.params).toMatchObject({ index: 1 });
  });

  it('událost nad 8 kB se zahodí s nálezem, dávka projde', async () => {
    const { svc } = service();
    const big = event({ properties: { blob: 'x'.repeat(9000) } });
    const out = await svc.accept(batch([event(), big]), { origin: 'https://shop.cz' });
    expect(out.body).toMatchObject({ accepted: 1, rejected: 1 });
    expect(out.body?.findings?.[0]).toMatchObject({ code: 'tracking_event_too_large' });
  });

  it('ořez vlastností se hlásí jako varování a událost je v accepted, ne v rejected', async () => {
    const { svc } = service({ limits: { maxKeys: 1, maxDepth: 3, maxString: 5 } });
    const out = await svc.accept(
      batch([event({ properties: { a: 1, b: 2, c: 'dlouhá hodnota' } })]),
      { origin: 'https://shop.cz' },
    );
    expect(out.body).toMatchObject({ accepted: 1, rejected: 0 });
    expect(out.body?.findings?.some((f) => f.code === 'tracking_properties_keys_dropped')).toBe(true);
  });

  it('adresa se vyčistí a utm se rozparsuje do context.campaign', async () => {
    const { svc, enqueued } = service();
    await svc.accept(
      batch([event({ page: { url: 'https://x.cz/a?token=abc&utm_source=news', path: '/a' } })]),
      { origin: 'https://shop.cz' },
    );
    const payload = enqueued[0] as { events: { page: { url: string }; context: { campaign: unknown } }[] };
    expect(payload.events[0]!.page.url).not.toContain('token=abc');
    expect(payload.events[0]!.context.campaign).toEqual({ source: 'news' });
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/ingest-service.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/ingest/ingest-service"`.

- [ ] **Step 3: Napiš službu**

```ts
// packages/core/tracking/ingest/ingest-service.ts
import { trackingMetrics } from '../metrics';
import { EVENT_NAME_RE } from '../types';
import { correctOccurredAt } from './clock-skew';
import type { PublicKeyOwner } from './public-key';
import { parseBatch, type IngestEvent } from './schema';
import { sanitizeProperties, type Finding, type PropertyLimits } from './sanitize-properties';
import { DEFAULT_STRIP_PARAMS, extractCampaign, sanitizeUrl } from './sanitize-url';

const MAX_EVENT_BYTES = 8 * 1024;

export type IngestRequestMeta = { origin: string | undefined; ip?: string | null };

export type IngestResponse = {
  status: 202 | 400 | 401 | 403 | 413 | 422;
  body?: { accepted: number; rejected: number; findings?: Finding[] };
  problem?: { code: string; params?: Record<string, unknown> };
};

export type IngestServiceDeps = {
  resolvePublicKey: (key: string) => Promise<PublicKeyOwner | null>;
  isOriginAllowed: (workspaceId: string, origin: string) => boolean;
  allowServersidePublicKey: (workspaceId: string) => boolean;
  limits: PropertyLimits;
  stripParams?: readonly string[];
  enqueue: (payload: unknown) => Promise<void>;
  now: () => Date;
  /**
   * Zdroj, pod kterým se událost uloží. `web` je prohlížeč, `server`
   * serverové volání s privátním klíčem. Bez tohohle parametru by hodnota
   * `server` byla mrtvá položka slovníku a serverovou událost by nešlo
   * odlišit od prohlížečové.
   */
  source?: Extract<EventSource, 'web' | 'server'>;
};

export function createIngestService(deps: IngestServiceDeps) {
  const stripParams = deps.stripParams ?? DEFAULT_STRIP_PARAMS;
  const source = deps.source ?? 'web';

  return {
    async accept(input: unknown, meta: IngestRequestMeta): Promise<IngestResponse> {
      const parsed = parseBatch(input);
      if (!parsed.ok) {
        return {
          status: parsed.status as IngestResponse['status'],
          problem: { code: parsed.code, params: parsed.params },
        };
      }
      const batch = parsed.batch;

      const owner = await deps.resolvePublicKey(batch.key);
      if (owner === null) return { status: 401, problem: { code: 'unauthenticated' } };

      // CORS chrání prohlížeč před čtením odpovědi, tahle kontrola chrání data před zápisem.
      if (meta.origin === undefined || meta.origin === '') {
        if (!deps.allowServersidePublicKey(owner.workspaceId)) {
          return { status: 403, problem: { code: 'origin_not_allowed' } };
        }
      } else if (!deps.isOriginAllowed(owner.workspaceId, meta.origin)) {
        return { status: 403, problem: { code: 'origin_not_allowed' } };
      }

      const serverNow = deps.now();
      const sentAt = new Date(batch.sent_at);
      const findings: Finding[] = [];
      const prepared: unknown[] = [];
      let rejected = 0;

      batch.events.forEach((event, index) => {
        const size = Buffer.byteLength(JSON.stringify(event), 'utf8');
        if (size > MAX_EVENT_BYTES) {
          rejected += 1;
          findings.push({
            code: 'tracking_event_too_large',
            severity: 'warning',
            message: 'Událost je příliš velká.',
            params: { index, size_bytes: size },
          });
          return;
        }
        if (!EVENT_NAME_RE.test(event.name)) {
          rejected += 1;
          findings.push({
            code: 'tracking_invalid_event_name',
            severity: 'warning',
            message: 'Jméno události smí obsahovat jen malá písmena, číslice a podtržítko.',
            params: { index, name: event.name },
          });
          return;
        }
        prepared.push(
          prepareEvent(event, index, { sentAt, serverNow, stripParams, limits: deps.limits }, findings),
        );
      });

      trackingMetrics.ingestEvents.inc({ result: 'accepted' }, prepared.length);
      if (rejected > 0) trackingMetrics.ingestEvents.inc({ result: 'rejected' }, rejected);
      for (const finding of findings) {
        if (finding.code.startsWith('tracking_properties_')) {
          trackingMetrics.ingestTruncated.inc({ limit: finding.code });
        }
      }

      if (prepared.length > 0) {
        await deps.enqueue({
          workspaceId: owner.workspaceId,
          anonymousId: batch.anonymous_id ?? null,
          source,
          events: prepared,
        });
      }

      return {
        status: 202,
        body: {
          accepted: prepared.length,
          rejected,
          ...(findings.length > 0 ? { findings } : {}),
        },
      };
    },
  };
}

type PrepareOptions = {
  sentAt: Date;
  serverNow: Date;
  stripParams: readonly string[];
  limits: PropertyLimits;
};

function prepareEvent(
  event: IngestEvent,
  index: number,
  options: PrepareOptions,
  findings: Finding[],
): unknown {
  const corrected = correctOccurredAt({
    occurredAt: new Date(event.occurred_at),
    sentAt: options.sentAt,
    serverNow: options.serverNow,
  });

  const page =
    event.page === undefined
      ? undefined
      : {
          ...event.page,
          url: sanitizeUrl(event.page.url, options.stripParams),
          referrer:
            event.page.referrer === undefined
              ? undefined
              : sanitizeUrl(event.page.referrer, options.stripParams),
        };

  const sanitized = sanitizeProperties(event.properties ?? {}, options.limits);
  for (const finding of sanitized.findings) {
    findings.push({ ...finding, params: { ...finding.params, index } });
  }

  const campaign = event.page === undefined ? undefined : extractCampaign(event.page.url);

  return {
    id: event.id,
    name: event.name,
    occurredAt: corrected.occurredAt.toISOString(),
    sessionId: event.session_id ?? null,
    page,
    properties: sanitized.value,
    context: {
      ...event.context,
      ...(campaign === undefined ? {} : { campaign }),
      clock_skew_ms: corrected.clockSkewMs,
    },
  };
}
```

- [ ] **Step 4: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/ingest-service.test.ts`
Expected: PASS, 8 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/tracking/ingest/ingest-service.ts packages/core/test/tracking/ingest-service.test.ts
git commit -m "feat(tracking): accept event batches asynchronously with findings"
```

---

### Task 27: Povrch `/e/**` s CORS

`sendBeacon` posílá **řetězec**, tedy `Content-Type: text/plain;charset=UTF-8`, aby nevyvolal preflight. Server proto **musí** přijmout JSON i s tímhle typem obsahu.

`OPTIONS /e/*` a `POST /e/identify` potřebují CORS výjimku stejně jako `/e/track`. Bez toho neprojde preflight u cross-origin JSON POST a `ml_token` se nikdy nespotřebuje. Navenek by se to projevilo jako „identifikace prostě nefunguje" bez jediné chyby na serveru, protože požadavek by se na server nedostal.

**`/e/v1/batch` je trvalý alias na `/e/track`.** Kanonická cesta je `/e/track`, ale alias existuje, protože zabundlované SDK na cizím webu žije roky. Obsluhuje ho tentýž handler.

**Files:**
- Create: `packages/core/tracking/api/public-events.routes.ts`
- Create: `apps/web/src/app/e/[[...path]]/route.ts`
- Test: `packages/core/test/tracking/public-events.routes.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/public-events.routes.test.ts
import { describe, expect, it, vi } from 'vitest';
import { createPublicEventRoutes } from '../../tracking/api/public-events.routes';

function app(over = {}) {
  return createPublicEventRoutes({
    accept: vi.fn(async () => ({ status: 202 as const, body: { accepted: 1, rejected: 0 } })),
    identify: vi.fn(async () => ({ status: 202 as const, body: { ok: true } })),
    serveSdk: () => new Response('/* sdk */', { headers: { 'content-type': 'application/javascript' } }),
    consumeRateLimit: async () => true,
    ...over,
  });
}

const body = JSON.stringify({
  v: 1, key: 'ml_pub_aebagbafaydqqcik', sent_at: '2026-07-31T12:00:00.000Z', events: [],
});

describe('/e routes', () => {
  it('POST /track přijme application/json i text/plain kvůli sendBeacon', async () => {
    for (const contentType of ['application/json', 'text/plain;charset=UTF-8']) {
      const res = await app().request('/track', {
        method: 'POST', body, headers: { 'content-type': contentType },
      });
      expect(res.status).toBe(202);
    }
  });

  it('/v1/batch je alias na /track a obsluhuje ho tentýž handler', async () => {
    const accept = vi.fn(async () => ({ status: 202 as const, body: { accepted: 1, rejected: 0 } }));
    const res = await app({ accept }).request('/v1/batch', {
      method: 'POST', body, headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(202);
    expect(accept).toHaveBeenCalledTimes(1);
  });

  it('OPTIONS na libovolnou cestu pod /e vrátí 204 s CORS hlavičkami', async () => {
    for (const path of ['/track', '/identify', '/cokoliv']) {
      const res = await app().request(path, { method: 'OPTIONS' });
      expect(res.status).toBe(204);
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(res.headers.get('access-control-allow-methods')).toContain('POST');
      expect(res.headers.get('access-control-allow-headers')).toBe('Content-Type');
      expect(res.headers.get('access-control-max-age')).toBe('86400');
    }
  });

  it('Access-Control-Allow-Credentials se nenastavuje, s hvězdičkou je to neplatné', async () => {
    const res = await app().request('/track', { method: 'OPTIONS' });
    expect(res.headers.get('access-control-allow-credentials')).toBeNull();
  });

  it('POST /identify vrátí 202 a CORS hlavičku', async () => {
    const res = await app().request('/identify', {
      method: 'POST',
      body: JSON.stringify({ v: 1, key: 'ml_pub_aebagbafaydqqcik', anonymous_id: 'a', token: 't1x' }),
      headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(202);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  it('tělo nad 64 kB vrátí 413 a payload_too_large', async () => {
    const res = await app().request('/track', {
      method: 'POST', body: 'x'.repeat(65 * 1024), headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe('payload_too_large');
  });

  it('nevalidní JSON vrátí 400', async () => {
    const res = await app().request('/track', {
      method: 'POST', body: '{nevalidní', headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(400);
  });

  it('překročený limit vrátí 429 s Retry-After', async () => {
    const res = await app({ consumeRateLimit: async () => false }).request('/track', {
      method: 'POST', body, headers: { 'content-type': 'application/json' },
    });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).not.toBeNull();
  });

  it('GET /ml.js vrátí skript', async () => {
    const res = await app().request('/ml.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('javascript');
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/public-events.routes.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/api/public-events.routes"`.

- [ ] **Step 3: Napiš Hono podaplikaci**

```ts
// packages/core/tracking/api/public-events.routes.ts
import { Hono, type Context } from 'hono';
import type { IngestRequestMeta, IngestResponse } from '../ingest/ingest-service';

const MAX_BODY_BYTES = 64 * 1024;

/** CORS podle 3.7.5. Allow-Credentials se nenastavuje, s hvězdičkou je to neplatné. */
const CORS_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
});

export type IdentifyResponse = {
  status: 202 | 400 | 403 | 409 | 410 | 429;
  body?: { ok: boolean; reason?: string };
  problem?: { code: string };
};

export type PublicEventDeps = {
  accept: (input: unknown, meta: IngestRequestMeta) => Promise<IngestResponse>;
  identify: (input: unknown, meta: IngestRequestMeta) => Promise<IdentifyResponse>;
  serveSdk: () => Response;
  consumeRateLimit: (key: string, route: 'track' | 'identify') => Promise<boolean>;
  clientIp?: (headers: Record<string, string | undefined>) => string | null;
};

function problem(code: string, status: number, params?: Record<string, unknown>): Response {
  return new Response(
    JSON.stringify({
      type: `https://docs.mlain.dev/errors/${code}`,
      title: code,
      status,
      code,
      ...(params === undefined ? {} : { params }),
    }),
    { status, headers: { ...CORS_HEADERS, 'content-type': 'application/problem+json' } },
  );
}

function rateLimited(): Response {
  return new Response(JSON.stringify({ code: 'rate_limited', status: 429, retry_after: 60 }), {
    status: 429,
    headers: { ...CORS_HEADERS, 'content-type': 'application/problem+json', 'Retry-After': '60' },
  });
}

function headerBag(c: Context): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  c.req.raw.headers.forEach((value, key) => {
    out[key.toLowerCase()] = value;
  });
  return out;
}

export function createPublicEventRoutes(deps: PublicEventDeps): Hono {
  const app = new Hono();

  app.options('/*', () => new Response(null, { status: 204, headers: CORS_HEADERS }));

  const handleTrack = async (c: Context): Promise<Response> => {
    const raw = await c.req.text();
    if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) return problem('payload_too_large', 413);

    const headers = headerBag(c);
    const ip = deps.clientIp?.(headers) ?? 'unknown';
    if (!(await deps.consumeRateLimit(ip, 'track'))) return rateLimited();

    let parsed: unknown;
    try {
      // sendBeacon posílá text/plain, aby nevyvolal preflight. Tělo je JSON tak jako tak.
      parsed = JSON.parse(raw);
    } catch {
      return problem('invalid_json', 400);
    }

    const result = await deps.accept(parsed, { origin: headers.origin, ip });
    if (result.problem !== undefined) {
      return problem(result.problem.code, result.status, result.problem.params);
    }
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    });
  };

  app.post('/track', handleTrack);
  // Trvalý alias. Kanonická cesta je /e/track, ale zabundlované SDK žije roky.
  app.post('/v1/batch', handleTrack);

  app.post('/identify', async (c) => {
    const headers = headerBag(c);
    const ip = deps.clientIp?.(headers) ?? 'unknown';
    if (!(await deps.consumeRateLimit(ip, 'identify'))) return rateLimited();

    let parsed: unknown;
    try {
      parsed = JSON.parse(await c.req.text());
    } catch {
      return problem('invalid_json', 400);
    }

    const result = await deps.identify(parsed, { origin: headers.origin, ip });
    if (result.problem !== undefined) return problem(result.problem.code, result.status);
    return new Response(JSON.stringify(result.body), {
      status: result.status,
      headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
    });
  });

  app.get('/ml.js', () => deps.serveSdk());

  return app;
}
```

- [ ] **Step 4: Napiš route handler v Next.js**

```ts
// apps/web/src/app/e/[[...path]]/route.ts
import { handle } from 'hono/vercel';
import { trackingRuntime } from '@/lib/tracking-runtime';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const app = trackingRuntime.publicEventRoutes.basePath('/e');

export const GET = handle(app);
export const POST = handle(app);
export const OPTIONS = handle(app);
```

- [ ] **Step 5: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/public-events.routes.test.ts`
Expected: PASS, 9 testů.

- [ ] **Step 6: Commit**

```bash
git add packages/core/tracking/api/public-events.routes.ts apps/web/src/app/e packages/core/test/tracking/public-events.routes.test.ts
git commit -m "feat(tracking): expose /e surface with cors and sendbeacon support"
```

---

### Task 28: Kanonizace JSON podle RFC 8785 a ověření podpisu `identify`

Podpis vyrábí server zákazníka **ve svém jazyce** (PHP, Python, Ruby, Go) a ověřuje ho náš Node. Kanonizace JSONu je klasické místo, kde se dvě implementace rozejdou na drobnosti, kterou nikdo nevidí: na pořadí klíčů, na tom, jestli se `1.0` serializuje jako `1` nebo `1.0`, na escapování diakritiky a na mezeře za dvojtečkou. Výsledek je „podpis nesedí" bez jediné stopy, kde.

Proto je závazné **RFC 8785 (JCS), jmenovitě, bez vlastní varianty**. Píšeme si ho sami, asi sedmdesát řádků, protože máme závazný testovací vektor a licenční jistota je u vlastního kódu vyšší.

Bez podpisu server odmítne payload s e-mailem nebo telefonem chybou `tracking_identify_unsigned_pii`. Kód z prohlížeče vidí každý a kdokoliv ho může zavolat s libovolným e-mailem, takže bez tohohle pravidla by šlo unést cizí kontakt.

**Files:**
- Create: `packages/core/tracking/identity/jcs.ts`
- Create: `packages/core/tracking/identity/signature.ts`
- Create: `packages/core/tracking/fixtures/generate-identify-signature.ts`
- Create: `packages/core/tracking/fixtures/identify-signature.json`
- Test: `packages/core/test/tracking/jcs.test.ts`
- Test: `packages/core/test/tracking/identify-signature.vectors.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/jcs.test.ts
import { describe, expect, it } from 'vitest';
import { canonicalize } from '../../tracking/identity/jcs';
import { PII_TRAIT_KEYS, hasPiiTraits, verifyIdentifySignature } from '../../tracking/identity/signature';

describe('canonicalize (RFC 8785)', () => {
  it('sedí na závazný vektor z 3.6.3', () => {
    expect(
      canonicalize({
        first_name: 'Jan', email: 'jan@example.cz', orders: 3,
        ltv: 1490.5, vip: true, note: 'čeština',
      }),
    ).toBe(
      '{"email":"jan@example.cz","first_name":"Jan","ltv":1490.5,"note":"čeština","orders":3,"vip":true}',
    );
  });

  it('prázdné traits jsou {}, ne prázdný řetězec', () => {
    expect(canonicalize({})).toBe('{}');
  });

  it('klíče se řadí podle UTF-16 code unitů, ne podle locale', () => {
    expect(canonicalize({ b: 1, A: 2, a: 3, Z: 4 })).toBe('{"A":2,"Z":4,"a":3,"b":1}');
  });

  it('celé číslo se nezapisuje s desetinnou částí', () => {
    expect(canonicalize({ n: 1.0 })).toBe('{"n":1}');
  });

  it('diakritika se zapisuje jako surové UTF-8, neescapuje se', () => {
    expect(canonicalize({ x: 'ěščřž' })).toBe('{"x":"ěščřž"}');
  });

  it('řídicí znaky se escapují minimálně', () => {
    expect(canonicalize({ x: 'a\nb"c\\d' })).toBe('{"x":"a\\nb\\"c\\\\d"}');
  });

  it('vnořené objekty se řadí na každé úrovni', () => {
    expect(canonicalize({ b: { d: 1, c: 2 }, a: [3, { f: 4, e: 5 }] })).toBe(
      '{"a":[3,{"e":5,"f":4}],"b":{"c":2,"d":1}}',
    );
  });
});

describe('verifyIdentifySignature', () => {
  const secret = Buffer.from('ml_live_0123456789abcdef', 'utf8');
  const traits = { first_name: 'Jan', email: 'jan@example.cz' };

  it('platný podpis projde', () => {
    const signature = signForTest(secret, 'customer_8472', traits);
    expect(verifyIdentifySignature({ externalId: 'customer_8472', traits, signature, secret })).toBe(true);
  });

  it('podpis pro jiné traits neprojde', () => {
    const signature = signForTest(secret, 'customer_8472', { first_name: 'Jan' });
    expect(verifyIdentifySignature({ externalId: 'customer_8472', traits, signature, secret })).toBe(false);
  });

  it('external_id s bajtem 0x0A se odmítne, ne aby se hádalo', () => {
    expect(() =>
      verifyIdentifySignature({ externalId: 'a\nb', traits, signature: 'x', secret }),
    ).toThrow(/0x0A/);
  });

  it('rozpozná traits s osobními údaji', () => {
    expect(PII_TRAIT_KEYS).toContain('email');
    expect(PII_TRAIT_KEYS).toContain('phone');
    expect(hasPiiTraits({ email: 'a@b.cz' })).toBe(true);
    expect(hasPiiTraits({ EMAIL: 'a@b.cz' })).toBe(true);
    expect(hasPiiTraits({ first_name: 'Jan' })).toBe(false);
  });
});

function signForTest(secret: Buffer, externalId: string, traits: Record<string, unknown>): string {
  const crypto = require('node:crypto') as typeof import('node:crypto');
  return crypto
    .createHmac('sha256', secret)
    .update(Buffer.concat([
      Buffer.from(externalId, 'utf8'),
      Buffer.from([0x0a]),
      Buffer.from(canonicalize(traits), 'utf8'),
    ]))
    .digest('base64url');
}
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/jcs.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/identity/jcs"`.

- [ ] **Step 3: Napiš kanonizaci**

```ts
// packages/core/tracking/identity/jcs.ts

/**
 * JSON Canonicalization Scheme, RFC 8785. Závazně a jmenovitě, bez vlastní varianty.
 * Čtyři věci, na kterých se implementace rozcházejí, a jak je RFC určuje:
 * klíče se řadí podle UTF-16 code unitů, čísla podle ECMAScript Number::toString,
 * řetězce se escapují minimálně, mezi tokeny nejsou mezery.
 */
export function canonicalize(value: unknown): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new Error('RFC 8785 nedovoluje NaN ani Infinity');
      }
      // String(1.0) je "1", String(1490.5) je "1490.5", což RFC vyžaduje.
      return String(value);
    case 'string':
      return serializeString(value);
    case 'object':
      break;
    default:
      throw new Error(`Hodnota typu ${typeof value} se nedá kanonizovat`);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, v]) => v !== undefined,
  );
  // Řazení podle UTF-16 code unitů. Výchozí porovnání řetězců v JavaScriptu
  // přesně tohle dělá, localeCompare by dalo jiné pořadí a rozešlo by se.
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

  return `{${entries.map(([k, v]) => `${serializeString(k)}:${canonicalize(v)}`).join(',')}}`;
}

const ESCAPES: Readonly<Record<string, string>> = Object.freeze({
  '"': '\\"',
  '\\': '\\\\',
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
});

function serializeString(value: string): string {
  let out = '"';
  for (const char of value) {
    const escape = ESCAPES[char];
    if (escape !== undefined) {
      out += escape;
      continue;
    }
    const code = char.codePointAt(0)!;
    if (code < 0x20) {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
      continue;
    }
    // Všechno ostatní včetně diakritiky jde jako surové UTF-8, neescapuje se.
    out += char;
  }
  return `${out}"`;
}
```

- [ ] **Step 4: Napiš ověření podpisu**

```ts
// packages/core/tracking/identity/signature.ts
import crypto from 'node:crypto';
import { canonicalize } from './jcs';

const LF = 0x0a;

/**
 * Traits, které se z prohlížeče nesmí nastavit bez serverového podpisu.
 * Porovnává se bez ohledu na velikost písmen, aby EMAIL neprošlo obchůzkou.
 */
export const PII_TRAIT_KEYS: readonly string[] = ['email', 'e_mail', 'phone', 'tel', 'telefon'];

export function hasPiiTraits(traits: Record<string, unknown>): boolean {
  const pii = new Set(PII_TRAIT_KEYS);
  return Object.keys(traits).some((key) => pii.has(key.toLowerCase()));
}

export type VerifySignatureInput = {
  externalId: string;
  traits: Record<string, unknown>;
  signature: string;
  /** Bajty privátního API klíče projektu, ne jeho textová podoba a ne odvozený klíč. */
  secret: Buffer;
};

export function verifyIdentifySignature(input: VerifySignatureInput): boolean {
  const externalId = Buffer.from(input.externalId, 'utf8');
  if (externalId.includes(LF)) {
    throw new Error('external_id nesmí obsahovat bajt 0x0A, podpis by byl nejednoznačný');
  }

  const expected = crypto
    .createHmac('sha256', input.secret)
    .update(
      Buffer.concat([
        externalId,
        Buffer.from([LF]),
        Buffer.from(canonicalize(input.traits), 'utf8'),
      ]),
    )
    .digest();

  let provided: Buffer;
  try {
    provided = Buffer.from(input.signature, 'base64url');
  } catch {
    return false;
  }
  if (provided.length !== expected.length) return false;
  return crypto.timingSafeEqual(provided, expected);
}
```

- [ ] **Step 5: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/jcs.test.ts`
Expected: PASS, 11 testů.

- [ ] **Step 6: Založ vektor podpisu, který vlastní tenhle plán**

**Rozhodnutí o vlastnictví.** Specifikace v 3.6.3 a požadavek 12.5.21 umisťují vektor do `packages/contracts/fixtures/identify/signature.json`, ale **P02 tu skupinu fixtures nemá a nemá ji proč mít**: podpis `identify` není jedním z pěti zmrazených kontraktů mezi TypeScriptem a Go, sender ho nevyrábí ani neověřuje a v Go pro něj neexistuje druhá implementace, kterou by měly golden fixtures srovnávat. Vektor proto **vlastní tenhle plán** a leží v `packages/core/tracking/fixtures/identify-signature.json`. Účel zůstává beze zbytku: zákazník, který si podpis vyrábí v PHP nebo Pythonu, má proti čemu měřit.

**Odkud se berou hodnoty.** Vstupy a `expected_jcs` jsou **přepsané ze specifikace 3.6.3**, tedy ze zdroje, který o naší implementaci nic neví. Hodnotu `signature` dopočítává generátor, přesně jak specifikace předepisuje. Test proto porovnává kanonizaci proti řetězci ze specifikace, ne proti tomu, co si sám spočítal: jinak by se ptal téhož zdroje, ze kterého ochrana vznikla, a rozchod s RFC 8785 by neodhalil.

```ts
// packages/core/tracking/fixtures/generate-identify-signature.ts
import { createHmac } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { canonicalize } from '../identity/jcs';

/** Přepsáno z 3.6.3 části 5. Nikdy neupravuj podle toho, co vyjde. */
const SECRET_KEY = 'ml_live_0123456789abcdef';
const EXTERNAL_ID = 'customer_8472';
const TRAITS = {
  first_name: 'Jan',
  email: 'jan@example.cz',
  orders: 3,
  ltv: 1490.5,
  vip: true,
  note: 'čeština',
} as const;
const EXPECTED_JCS =
  '{"email":"jan@example.cz","first_name":"Jan","ltv":1490.5,"note":"čeština","orders":3,"vip":true}';

const jcs = canonicalize(TRAITS);
if (jcs !== EXPECTED_JCS) {
  throw new Error(`kanonizace se rozešla se specifikací 3.6.3:\n  ${jcs}\n  ${EXPECTED_JCS}`);
}

const input = Buffer.concat([
  Buffer.from(EXTERNAL_ID, 'utf8'),
  Buffer.from([0x0a]),
  Buffer.from(jcs, 'utf8'),
]);
const signature = createHmac('sha256', Buffer.from(SECRET_KEY, 'utf8')).update(input).digest('base64url');

writeFileSync(
  new URL('./identify-signature.json', import.meta.url),
  `${JSON.stringify({
    secret_key: SECRET_KEY,
    external_id: EXTERNAL_ID,
    traits: TRAITS,
    expected_jcs: EXPECTED_JCS,
    signature,
  }, null, 2)}\n`,
  'utf8',
);
```

```json
// packages/core/tracking/fixtures/identify-signature.json
{
  "secret_key": "ml_live_0123456789abcdef",
  "external_id": "customer_8472",
  "traits": {
    "first_name": "Jan",
    "email": "jan@example.cz",
    "orders": 3,
    "ltv": 1490.5,
    "vip": true,
    "note": "čeština"
  },
  "expected_jcs": "{\"email\":\"jan@example.cz\",\"first_name\":\"Jan\",\"ltv\":1490.5,\"note\":\"čeština\",\"orders\":3,\"vip\":true}",
  "signature": "GoE8G84t_u2jgjfQlWLvaKoFe3RQs91Pwjo1dMn9Ceg"
}
```

Hodnota `signature` je dopočítaná spuštěním nad kanonizací ze specifikace, ne odhadem. Kdyby ti generátor vydal jinou, **neopravuj fixture**: znamená to, že se rozešla kanonizace nebo oddělovač, a obojí je zmrazené.

- [ ] **Step 7: Přidej test proti vektoru**

```ts
// packages/core/test/tracking/identify-signature.vectors.test.ts
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalize } from '../../tracking/identity/jcs';
import { verifyIdentifySignature } from '../../tracking/identity/signature';

type Vector = {
  secret_key: string;
  external_id: string;
  traits: Record<string, unknown>;
  expected_jcs: string;
  signature: string;
};

/**
 * Přepsáno ze specifikace 3.6.3, ne načteno z fixture. Kdyby test četl
 * očekávanou kanonizaci z téhož souboru, který generátor zapsal, ptal by se
 * sám sebe a rozchod s RFC 8785 by prošel oběma stranami stejně.
 */
const SPEC_JCS =
  '{"email":"jan@example.cz","first_name":"Jan","ltv":1490.5,"note":"čeština","orders":3,"vip":true}';

const vector = JSON.parse(
  readFileSync(new URL('../../tracking/fixtures/identify-signature.json', import.meta.url), 'utf8'),
) as Vector;

describe('identify signature vector', () => {
  it('fixture nese přesně tu kanonizaci, kterou předepisuje specifikace', () => {
    expect(vector.expected_jcs).toBe(SPEC_JCS);
  });

  it('kanonizace implementace sedí na řetězec ze specifikace', () => {
    expect(canonicalize(vector.traits)).toBe(SPEC_JCS);
  });

  it('podpis z fixture se ověří', () => {
    expect(
      verifyIdentifySignature({
        externalId: vector.external_id,
        traits: vector.traits,
        signature: vector.signature,
        secret: Buffer.from(vector.secret_key, 'utf8'),
      }),
    ).toBe(true);
  });

  it('podpis nad jinými traits se neověří', () => {
    expect(
      verifyIdentifySignature({
        externalId: vector.external_id,
        traits: { ...vector.traits, orders: 4 },
        signature: vector.signature,
        secret: Buffer.from(vector.secret_key, 'utf8'),
      }),
    ).toBe(false);
  });

  it('oddělovač je jediný bajt 0x0A: podpis nad CRLF se neověří', () => {
    // Pojistka proti nejčastějšímu rozchodu se zákazníkovou implementací.
    const crlf = Buffer.concat([
      Buffer.from(vector.external_id, 'utf8'),
      Buffer.from([0x0d, 0x0a]),
      Buffer.from(SPEC_JCS, 'utf8'),
    ]);
    const wrong = createHmac('sha256', Buffer.from(vector.secret_key, 'utf8'))
      .update(crlf)
      .digest('base64url');
    expect(wrong).not.toBe(vector.signature);
  });
});
```

Run: `pnpm vitest run packages/core/test/tracking/identify-signature.vectors.test.ts`
Expected: PASS, 5 testů. Kdyby první padal, rozešla se kanonizace se specifikací 3.6.3 a fixture se **neopravuje**, opravuje se implementace.

- [ ] **Step 8: Commit**

```bash
git add packages/core/tracking/identity/jcs.ts packages/core/tracking/identity/signature.ts packages/core/tracking/fixtures/generate-identify-signature.ts packages/core/tracking/fixtures/identify-signature.json packages/core/test/tracking/jcs.test.ts packages/core/test/tracking/identify-signature.vectors.test.ts
git commit -m "feat(tracking): canonicalize traits per rfc 8785 and verify identify signature"
```

---

### Task 29: Algoritmus `bind()` `[db]`

**Tohle je nejchoulostivější algoritmus v celé části.** Chyba v něm znamená, že se historie jednoho člověka přiřadí jinému.

Dvě věci, které z něj nesmí zmizet:

**Krok 0 je omezení zpracování podle článku 18 GDPR.** Kontakt s uplatněným omezením se nemaže, ale nesmí se zpracovávat. Vytvořit mu vazbu na prohlížeč, doplnit mu `contact_id` do historických událostí a přepsat mu `last_activity_at` je zpracování osobních údajů v přímém rozporu s uplatněným omezením. Události se dál ukládají, ale **anonymně**.

**Krok 5 je jádro návrhu a je záměrně konzervativní.** Když jeden `anonymous_id` postupně odpovídá dvěma různým kontaktům, znamená to sdílený počítač, přeposlaný e-mail otevřený někým jiným, nebo záměrné zneužití. Ve všech třech případech je špatně přiřadit dosavadní historii nové osobě. **Historie se proto doplňuje výhradně při první vazbě anonymního ID.**

Tenhle krok je zároveň odpověď na otázku „co když se člověk vrátí po dvaceti minutách a klikne znovu". Dostane nový token, ten se spotřebuje, `bind()` skončí v kroku 4 stavem `unchanged` a **žádné druhé slučování se nenaplánuje**. Duplicita tak nevznikne ani při stém kliku.

**Files:**
- Create: `packages/core/tracking/repo/identities.repo.ts`
- Create: `packages/core/tracking/identity/bind.ts`
- Test: `packages/core/test/tracking/bind.db.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/bind.db.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withTestDatabase, seedContact } from '@mlain/db/testing';
import { bindIdentity } from '../../tracking/identity/bind';

const db = withTestDatabase();

describe('bindIdentity', () => {
  let workspaceId: string;
  let contactA: string;
  let contactB: string;
  const anon = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
  let scheduleMerge: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await db.truncateTracking();
    ({ workspaceId, contactId: contactA } = await seedContact(db));
    ({ contactId: contactB } = await seedContact(db, { workspaceId }));
    scheduleMerge = vi.fn(async () => {});
  });

  const bind = (contactId: string, over = {}) =>
    bindIdentity({
      workspaceId, anonymousId: anon, contactId,
      source: 'email_click', evidence: {}, now: new Date(),
      scheduleMerge, ...over,
    });

  it('první vazba vytvoří řádek, zapíše historii a naplánuje sloučení', async () => {
    expect(await bind(contactA)).toBe('created');
    expect(scheduleMerge).toHaveBeenCalledTimes(1);
  });

  it('druhá vazba na týž kontakt je unchanged a NEnaplánuje druhé sloučení', async () => {
    await bind(contactA);
    scheduleMerge.mockClear();
    expect(await bind(contactA)).toBe('unchanged');
    expect(scheduleMerge).not.toHaveBeenCalled();
  });

  it('návrat po dvaceti minutách s novým tokenem nevytvoří duplicitní sloučení', async () => {
    await bind(contactA, { now: new Date('2026-07-31T12:00:00Z') });
    scheduleMerge.mockClear();
    const later = await bind(contactA, { now: new Date('2026-07-31T12:20:00Z') });
    expect(later).toBe('unchanged');
    expect(scheduleMerge).not.toHaveBeenCalled();
    const bindings = await db.countIdentityBindings(workspaceId, anon);
    expect(bindings).toBe(1);
  });

  it('vazba na jiný kontakt je rebound a historii NEslučuje', async () => {
    await bind(contactA);
    scheduleMerge.mockClear();
    expect(await bind(contactB)).toBe('rebound');
    expect(scheduleMerge).not.toHaveBeenCalled();
  });

  it('šestá převazba za 24 hodin označí zařízení jako sdílené', async () => {
    for (let i = 0; i < 6; i += 1) {
      await bind(i % 2 === 0 ? contactA : contactB);
    }
    expect(await db.isIdentityShared(workspaceId, anon)).toBe(true);
    scheduleMerge.mockClear();
    expect(await bind(contactA)).toBe('shared');
    expect(scheduleMerge).not.toHaveBeenCalled();
  });

  it('kontakt s processing_restricted vazbu nezaloží a nespustí sloučení', async () => {
    await db.setProcessingRestricted(contactA, true);
    expect(await bind(contactA)).toBe('restricted');
    expect(scheduleMerge).not.toHaveBeenCalled();
    expect(await db.selectIdentityContactId(workspaceId, anon)).toBeNull();
  });

  it('zrušení omezení obnoví normální chování bez dalšího kroku', async () => {
    await db.setProcessingRestricted(contactA, true);
    await bind(contactA);
    await db.setProcessingRestricted(contactA, false);
    expect(await bind(contactA)).toBe('created');
  });

  it('měkce smazaný kontakt se chová stejně jako omezený', async () => {
    await db.softDeleteContact(contactA);
    expect(await bind(contactA)).toBe('restricted');
  });

  it('neexistující kontakt vazbu nezaloží', async () => {
    expect(await bind('0192f3a0-1c2d-7e43-8d4e-000000000000')).toBe('contact_not_found');
  });

  it('souběžné bind pro tentýž anonymous_id neztratí ani jeden zápis', async () => {
    const results = await Promise.all([bind(contactA), bind(contactA), bind(contactA)]);
    expect(results.filter((r) => r === 'created')).toHaveLength(1);
    expect(results.filter((r) => r === 'unchanged')).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/bind.db.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/identity/bind"`.

- [ ] **Step 3: Napiš repository identit**

```ts
// packages/core/tracking/repo/identities.repo.ts
import { sql } from 'drizzle-orm';
import { withTrackingTx } from './tx';

export type IdentityRow = {
  workspaceId: string;
  anonymousId: string;
  contactId: string | null;
  boundAt: Date | null;
  bindCount: number;
  shared: boolean;
};

export type BindingSource = 'email_click' | 'sdk_identify' | 'server_api' | 'form' | 'reset';

export type ContactGuardRow = {
  id: string;
  processingRestricted: boolean;
  deletedAt: Date | null;
};

/** Krok 0: jedno čtení řádku kontaktu, který stejně potřebujeme kvůli ověření existence. */
export async function selectContactGuard(
  workspaceId: string,
  contactId: string,
): Promise<ContactGuardRow | null> {
  return withTrackingTx(workspaceId, 'tracking.bind', async (tx) => {
    const { rows } = await tx.execute<ContactGuardRow>(sql`
      SELECT id, processing_restricted AS "processingRestricted", deleted_at AS "deletedAt"
        FROM contacts
       WHERE id = ${contactId} AND workspace_id = ${workspaceId}
    `);
    return rows[0] ?? null;
  });
}

export type BindTxResult = {
  outcome: 'created' | 'bound' | 'unchanged' | 'rebound' | 'shared';
  bindingId: string | null;
  shouldMerge: boolean;
};

/**
 * Celý krok 1 až 5 v jedné transakci. SELECT ... FOR UPDATE v kroku 1 řeší souběh:
 * druhý požadavek počká a uvidí výsledek prvního.
 */
export async function bindInTransaction(input: {
  workspaceId: string;
  anonymousId: string;
  contactId: string;
  source: BindingSource;
  evidence: Record<string, unknown>;
  now: Date;
  bindingId: string;
  sharedThreshold: number;
}): Promise<BindTxResult> {
  return withTrackingTx(input.workspaceId, 'tracking.bind', async (tx) => {
    const { rows: existing } = await tx.execute<IdentityRow>(sql`
      SELECT workspace_id AS "workspaceId", anonymous_id AS "anonymousId",
             contact_id AS "contactId", bound_at AS "boundAt",
             bind_count AS "bindCount", shared
        FROM identities
       WHERE workspace_id = ${input.workspaceId} AND anonymous_id = ${input.anonymousId}
         FOR UPDATE
    `);
    const row = existing[0];

    const writeBinding = async (contactId: string | null): Promise<void> => {
      await tx.execute(sql`
        INSERT INTO identity_bindings (id, workspace_id, anonymous_id, contact_id, valid_from, source, evidence)
        VALUES (${input.bindingId}, ${input.workspaceId}, ${input.anonymousId},
                ${contactId}, ${input.now}, ${input.source}, ${JSON.stringify(input.evidence)}::jsonb)
      `);
    };

    // 2. řádek neexistuje: první vazba, slučuje se
    if (row === undefined) {
      await tx.execute(sql`
        INSERT INTO identities (workspace_id, anonymous_id, contact_id, bound_at, bind_count, first_seen, last_seen)
        VALUES (${input.workspaceId}, ${input.anonymousId}, ${input.contactId}, ${input.now}, 1, ${input.now}, ${input.now})
        ON CONFLICT (workspace_id, anonymous_id) DO NOTHING
      `);
      await writeBinding(input.contactId);
      return { outcome: 'created', bindingId: input.bindingId, shouldMerge: true };
    }

    // Sdílené zařízení: slučování se zastavuje úplně
    if (row.shared) {
      await tx.execute(sql`
        UPDATE identities SET last_seen = ${input.now}
         WHERE workspace_id = ${input.workspaceId} AND anonymous_id = ${input.anonymousId}
      `);
      return { outcome: 'shared', bindingId: null, shouldMerge: false };
    }

    // 3. dosud bez vazby: první vazba, slučuje se
    if (row.contactId === null) {
      await tx.execute(sql`
        UPDATE identities
           SET contact_id = ${input.contactId}, bound_at = ${input.now},
               bind_count = bind_count + 1, last_seen = ${input.now}
         WHERE workspace_id = ${input.workspaceId} AND anonymous_id = ${input.anonymousId}
      `);
      await writeBinding(input.contactId);
      return { outcome: 'bound', bindingId: input.bindingId, shouldMerge: true };
    }

    // 4. tentýž kontakt: nic se neslučuje, tohle je návrat téhož člověka
    if (row.contactId === input.contactId) {
      await tx.execute(sql`
        UPDATE identities SET last_seen = ${input.now}
         WHERE workspace_id = ${input.workspaceId} AND anonymous_id = ${input.anonymousId}
      `);
      return { outcome: 'unchanged', bindingId: null, shouldMerge: false };
    }

    // 5. jiný kontakt: mění se jen to, komu se přiřadí BUDOUCÍ události
    const { rows: recent } = await tx.execute<{ count: string }>(sql`
      SELECT count(*) FROM identity_bindings
       WHERE workspace_id = ${input.workspaceId} AND anonymous_id = ${input.anonymousId}
         AND valid_from > ${input.now}::timestamptz - interval '24 hours'
    `);
    const becomesShared = Number(recent[0]?.count ?? 0) + 1 > input.sharedThreshold;

    await tx.execute(sql`
      UPDATE identities
         SET contact_id = ${input.contactId}, bound_at = ${input.now},
             bind_count = bind_count + 1, last_seen = ${input.now},
             shared = ${becomesShared}
       WHERE workspace_id = ${input.workspaceId} AND anonymous_id = ${input.anonymousId}
    `);
    await writeBinding(input.contactId);
    return { outcome: 'rebound', bindingId: input.bindingId, shouldMerge: false };
  });
}
```

- [ ] **Step 4: Napiš algoritmus**

```ts
// packages/core/tracking/identity/bind.ts
import { v7 as uuidv7 } from 'uuid';
import { logger } from '@mlain/core/logging';
import { recordIdentityBind } from '../metrics';
import { bindInTransaction, selectContactGuard, type BindingSource } from '../repo/identities.repo';

/** Víc než pět převazeb za 24 hodin znamená sdílené zařízení. */
const SHARED_THRESHOLD = 5;

export type BindOutcome =
  | 'created'
  | 'bound'
  | 'unchanged'
  | 'rebound'
  | 'shared'
  | 'restricted'
  | 'contact_not_found';

export type BindInput = {
  workspaceId: string;
  anonymousId: string;
  contactId: string;
  source: BindingSource;
  evidence: Record<string, unknown>;
  now: Date;
  scheduleMerge: (input: {
    workspaceId: string;
    anonymousId: string;
    contactId: string;
    bindingId: string;
  }) => Promise<void>;
};

export async function bindIdentity(input: BindInput): Promise<BindOutcome> {
  // 0. GDPR čl. 18. Kontrola se dělá při každém volání, ne jednou při startu,
  //    protože omezení může být uplatněné kdykoliv.
  const guard = await selectContactGuard(input.workspaceId, input.contactId);
  if (guard === null) {
    logger.info(
      { workspace_id: input.workspaceId, contact_id: input.contactId },
      'contact_not_found',
    );
    return 'contact_not_found';
  }
  if (guard.processingRestricted || guard.deletedAt !== null) {
    recordIdentityBind('restricted');
    return 'restricted';
  }

  const result = await bindInTransaction({
    workspaceId: input.workspaceId,
    anonymousId: input.anonymousId,
    contactId: input.contactId,
    source: input.source,
    evidence: input.evidence,
    now: input.now,
    bindingId: uuidv7(),
    sharedThreshold: SHARED_THRESHOLD,
  });

  recordIdentityBind(result.outcome);

  // Historie se doplňuje výhradně při PRVNÍ vazbě anonymního ID.
  if (result.shouldMerge && result.bindingId !== null) {
    await input.scheduleMerge({
      workspaceId: input.workspaceId,
      anonymousId: input.anonymousId,
      contactId: input.contactId,
      bindingId: result.bindingId,
    });
  }

  return result.outcome;
}
```

- [ ] **Step 5: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/bind.db.test.ts`
Expected: PASS, 10 testů.

- [ ] **Step 6: Commit**

```bash
git add packages/core/tracking/repo/identities.repo.ts packages/core/tracking/identity/bind.ts packages/core/test/tracking/bind.db.test.ts
git commit -m "feat(tracking): bind anonymous id to contact, merge only on first binding"
```

---

### Task 30: Slučování anonymní historie a jeho vrácení `[db]`

Slučování doplní `contact_id` do už uložených anonymních událostí. Bez něj by v časové ose chybělo přesně to, kvůli čemu se produkt staví: co člověk dělal na webu **předtím**, než jsme věděli, kdo je.

Tři podmínky, které v dotazu nesmí chybět, každá z jiného důvodu:

- `contact_id IS NULL` dělá job idempotentním. Opakované spuštění po restartu už zpracované řádky vyloučí, takže dvojí běh nezpůsobí duplicity ani chybný stav.
- `erased_at IS NULL` brání vzkříšení vymazaných dat. Kdyby se týž prohlížeč později navázal na jiný kontakt, slučování by mu vymazané události připsalo.
- Podmínka na `received_at` prořezává oddíly. Bez ní se prohledají všechny a rozpočet padne. Řadí se podle `occurred_at`, ale prořezává se podle `received_at`, a ty dvě hodnoty se rozcházejí až o sedm dní.

**Files:**
- Create: `packages/core/tracking/identity/merge.ts`
- Create: `packages/core/tracking/jobs/identity-merge.ts`
- Test: `packages/core/test/tracking/merge.db.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/merge.db.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { withTestDatabase, seedContact, seedWebEvents } from '@mlain/db/testing';
import { runIdentityMerge, revertIdentityMerge } from '../../tracking/identity/merge';

const db = withTestDatabase();

describe('identity merge', () => {
  let workspaceId: string;
  let contactId: string;
  let bindingId: string;
  const anon = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
  const now = new Date('2026-07-31T12:00:00Z');

  beforeEach(async () => {
    await db.truncateTracking();
    ({ workspaceId, contactId } = await seedContact(db));
    bindingId = await db.insertBinding(workspaceId, anon, contactId);
  });

  it('doplní contact_id anonymním událostem v okně 30 dní', async () => {
    await seedWebEvents(db, { workspaceId, anonymousId: anon, count: 5, occurredAt: new Date('2026-07-30T12:00:00Z') });
    const result = await runIdentityMerge({
      workspaceId, anonymousId: anon, contactId, bindingId,
      windowDays: 30, maxEvents: 10_000, batchSize: 1000, now,
    });
    expect(result.status).toBe('completed');
    expect(result.eventsTotal).toBe(5);
    expect(await db.countWebEventsForContact(workspaceId, contactId)).toBe(5);
  });

  it('události starší než okno se nepřipojí', async () => {
    await seedWebEvents(db, { workspaceId, anonymousId: anon, count: 3, occurredAt: new Date('2026-05-01T12:00:00Z') });
    const result = await runIdentityMerge({
      workspaceId, anonymousId: anon, contactId, bindingId,
      windowDays: 30, maxEvents: 10_000, batchSize: 1000, now,
    });
    expect(result.eventsTotal).toBe(0);
  });

  it('při překročení stropu skončí ve stavu truncated a doplní přesně strop', async () => {
    await seedWebEvents(db, { workspaceId, anonymousId: anon, count: 15_000, occurredAt: new Date('2026-07-30T12:00:00Z') });
    const result = await runIdentityMerge({
      workspaceId, anonymousId: anon, contactId, bindingId,
      windowDays: 30, maxEvents: 10_000, batchSize: 1000, now,
    });
    expect(result.status).toBe('truncated');
    expect(result.eventsTotal).toBe(10_000);
  });

  it('události s erased_at se přeskočí, vymazaná historie se nikdy nekřísí', async () => {
    await seedWebEvents(db, { workspaceId, anonymousId: anon, count: 4, occurredAt: new Date('2026-07-30T12:00:00Z'), erased: true });
    const result = await runIdentityMerge({
      workspaceId, anonymousId: anon, contactId, bindingId,
      windowDays: 30, maxEvents: 10_000, batchSize: 1000, now,
    });
    expect(result.eventsTotal).toBe(0);
  });

  it('opakované spuštění téhož jobu nezpůsobí duplicity ani přeskočené řádky', async () => {
    await seedWebEvents(db, { workspaceId, anonymousId: anon, count: 5, occurredAt: new Date('2026-07-30T12:00:00Z') });
    const args = { workspaceId, anonymousId: anon, contactId, bindingId, windowDays: 30, maxEvents: 10_000, batchSize: 1000, now };
    await runIdentityMerge(args);
    const second = await runIdentityMerge(args);
    expect(second.eventsTotal).toBe(0);
    expect(await db.countWebEventsForContact(workspaceId, contactId)).toBe(5);
  });

  it('kontakt s processing_restricted job přeskočí bez práce', async () => {
    await db.setProcessingRestricted(contactId, true);
    const result = await runIdentityMerge({
      workspaceId, anonymousId: anon, contactId, bindingId,
      windowDays: 30, maxEvents: 10_000, batchSize: 1000, now,
    });
    expect(result.status).toBe('skipped_restricted');
  });

  it('doplní web_event_months a posune contacts.last_activity_at', async () => {
    await seedWebEvents(db, { workspaceId, anonymousId: anon, count: 2, occurredAt: new Date('2026-07-30T12:00:00Z') });
    await runIdentityMerge({
      workspaceId, anonymousId: anon, contactId, bindingId,
      windowDays: 30, maxEvents: 10_000, batchSize: 1000, now,
    });
    expect(await db.countWebEventMonths(workspaceId, 'contact', contactId)).toBeGreaterThan(0);
    expect(await db.selectLastActivityAt(contactId)).not.toBeNull();
  });

  it('revert vrátí contact_id na NULL u přesně těch událostí, které merge změnil', async () => {
    await seedWebEvents(db, { workspaceId, anonymousId: anon, count: 3, occurredAt: new Date('2026-07-30T12:00:00Z') });
    const direct = await seedWebEvents(db, {
      workspaceId, anonymousId: anon, contactId, count: 2, occurredAt: new Date('2026-07-31T11:00:00Z'),
    });
    const merge = await runIdentityMerge({
      workspaceId, anonymousId: anon, contactId, bindingId,
      windowDays: 30, maxEvents: 10_000, batchSize: 1000, now,
    });
    await revertIdentityMerge({ workspaceId, mergeId: merge.mergeId, revertedBy: 'u1', now });
    // Události, které přišly už s vyplněným contact_id, k tomu kontaktu skutečně patří.
    expect(await db.countWebEventsForContact(workspaceId, contactId)).toBe(direct.length);
  });

  it('revert sloučení, které není completed ani truncated, skončí kódem tracking_merge_not_revertible', async () => {
    const mergeId = await db.insertMerge(workspaceId, anon, contactId, bindingId, 'running');
    await expect(
      revertIdentityMerge({ workspaceId, mergeId, revertedBy: 'u1', now }),
    ).rejects.toThrow(/tracking_merge_not_revertible/);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/merge.db.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/identity/merge"`.

- [ ] **Step 3: Napiš slučování**

```ts
// packages/core/tracking/identity/merge.ts
import { v7 as uuidv7 } from 'uuid';
import { sql } from 'drizzle-orm';
import { withTrackingTx } from '../repo/tx';
import { AppError } from '@mlain/core/errors';
import { trackingMetrics } from '../metrics';
import { selectContactGuard } from '../repo/identities.repo';

export type MergeStatus = 'completed' | 'truncated' | 'skipped_restricted' | 'failed';

export type RunMergeInput = {
  workspaceId: string;
  anonymousId: string;
  contactId: string;
  bindingId: string;
  windowDays: number;
  maxEvents: number;
  batchSize: number;
  now: Date;
};

export type RunMergeResult = { mergeId: string; status: MergeStatus; eventsTotal: number };

export async function runIdentityMerge(input: RunMergeInput): Promise<RunMergeResult> {
  // 0. omezení zpracování se kontroluje znovu, mohlo být uplatněno mezi vazbou a jobem
  const guard = await selectContactGuard(input.workspaceId, input.contactId);
  if (guard === null || guard.processingRestricted || guard.deletedAt !== null) {
    return { mergeId: '', status: 'skipped_restricted', eventsTotal: 0 };
  }

  const mergeId = uuidv7();
  const windowFrom = new Date(input.now.getTime() - input.windowDays * 24 * 60 * 60 * 1000);
  const windowTo = input.now;

  await withTrackingTx(input.workspaceId, 'identity.merge', async (tx) => {
    await tx.execute(sql`
      INSERT INTO identity_merges (id, workspace_id, anonymous_id, contact_id, binding_id,
                                   window_from, window_to, status)
      VALUES (${mergeId}, ${input.workspaceId}, ${input.anonymousId}, ${input.contactId},
              ${input.bindingId}, ${windowFrom}, ${windowTo}, 'running')
    `);
  });

  let total = 0;
  let truncated = false;

  for (;;) {
    const remaining = input.maxEvents - total;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    const limit = Math.min(input.batchSize, remaining);

    const updated = await withTrackingTx(input.workspaceId, 'identity.merge', async (tx) =>
      (await tx.execute<{ id: string }>(sql`
        UPDATE web_events
           SET contact_id = ${input.contactId}, identity_merge_id = ${mergeId}
         WHERE (id, received_at) IN (
                 SELECT id, received_at FROM web_events
                  WHERE workspace_id = ${input.workspaceId}
                    AND anonymous_id = ${input.anonymousId}
                    AND contact_id IS NULL
                    AND erased_at IS NULL
                    AND occurred_at >= ${windowFrom} AND occurred_at < ${windowTo}
                    AND received_at >= ${windowFrom}
                    AND received_at <  ${windowTo}::timestamptz + interval '7 days'
                  ORDER BY occurred_at DESC
                  LIMIT ${limit})
        RETURNING id
      `)).rows,
    );

    if (updated.length === 0) break;
    total += updated.length;
    if (updated.length < limit) break;
  }

  // Zbývá ještě něco? Pak jsme narazili na strop, ne na konec dat.
  if (total >= input.maxEvents) {
    const rest = await withTrackingTx(input.workspaceId, 'identity.merge', async (tx) =>
      (await tx.execute<{ id: string }>(sql`
        SELECT id FROM web_events
         WHERE workspace_id = ${input.workspaceId} AND anonymous_id = ${input.anonymousId}
           AND contact_id IS NULL AND erased_at IS NULL
           AND occurred_at >= ${windowFrom} AND occurred_at < ${windowTo}
           AND received_at >= ${windowFrom}
           AND received_at <  ${windowTo}::timestamptz + interval '7 days'
         LIMIT 1
      `)).rows,
    );
    truncated = rest.length > 0;
  }

  await withTrackingTx(input.workspaceId, 'identity.merge', async (tx) => {
    await tx.execute(sql`
      INSERT INTO web_event_months (workspace_id, subject_kind, subject_id, month)
      SELECT DISTINCT ${input.workspaceId}, 'contact', ${input.contactId},
             date_trunc('month', received_at)::date
        FROM web_events
       WHERE identity_merge_id = ${mergeId}
      ON CONFLICT DO NOTHING
    `);

    await tx.execute(sql`
      UPDATE contacts
         SET last_activity_at = GREATEST(
               COALESCE(last_activity_at, 'epoch'::timestamptz),
               COALESCE((SELECT max(occurred_at) FROM web_events WHERE identity_merge_id = ${mergeId}),
                        'epoch'::timestamptz))
       WHERE id = ${input.contactId}
    `);

    await tx.execute(sql`
      UPDATE identity_merges
         SET status = ${truncated ? 'truncated' : 'completed'}, events_total = ${total}
       WHERE id = ${mergeId}
    `);
  });

  trackingMetrics.identityMergeEvents.inc(total);
  return { mergeId, status: truncated ? 'truncated' : 'completed', eventsTotal: total };
}

export type RevertInput = {
  workspaceId: string;
  mergeId: string;
  revertedBy: string;
  now: Date;
};

/**
 * Vrácení je úplné, protože identity_merge_id přesně označuje řádky, které merge změnil.
 * Události, které přišly už s vyplněným contact_id, se nevracejí: ty k tomu kontaktu
 * skutečně patří, protože vznikly až po vazbě.
 */
export async function revertIdentityMerge(input: RevertInput): Promise<number> {
  const allowed = await withTrackingTx(input.workspaceId, 'tracking.merge_revert', async (tx) =>
    (await tx.execute<{ status: string }>(sql`
      SELECT status FROM identity_merges
       WHERE id = ${input.mergeId} AND workspace_id = ${input.workspaceId}
    `)).rows,
  );
  const status = allowed[0]?.status;
  if (status !== 'completed' && status !== 'truncated') {
    throw new AppError('tracking_merge_not_revertible', { status: status ?? 'missing' });
  }

  let total = 0;
  for (;;) {
    const updated = await withTrackingTx(input.workspaceId, 'tracking.merge_revert', async (tx) =>
      (await tx.execute<{ id: string }>(sql`
        UPDATE web_events
           SET contact_id = NULL, identity_merge_id = NULL
         WHERE (id, received_at) IN (
                 SELECT id, received_at FROM web_events
                  WHERE identity_merge_id = ${input.mergeId}
                  LIMIT 1000)
        RETURNING id
      `)).rows,
    );
    if (updated.length === 0) break;
    total += updated.length;
  }

  await withTrackingTx(input.workspaceId, 'tracking.merge_revert', async (tx) => {
    await tx.execute(sql`
      UPDATE identity_merges
         SET status = 'reverted', reverted_at = ${input.now}, reverted_by = ${input.revertedBy}
       WHERE id = ${input.mergeId}
    `);
  });

  return total;
}
```

- [ ] **Step 4: Napiš handler jobu**

```ts
// packages/core/tracking/jobs/identity-merge.ts
import { trackingConfig } from '../config';
import { runIdentityMerge } from '../identity/merge';

export type IdentityMergeJobData = {
  workspaceId: string;
  anonymousId: string;
  contactId: string;
  bindingId: string;
};

export const IDENTITY_MERGE_QUEUE = 'identity.merge';

/**
 * Idempotence: podmínka contact_id IS NULL v dotazu vyloučí už zpracované řádky,
 * takže druhý běh po pádu workeru pokračuje tam, kde první skončil.
 */
export async function handleIdentityMerge(data: IdentityMergeJobData): Promise<void> {
  await runIdentityMerge({
    workspaceId: data.workspaceId,
    anonymousId: data.anonymousId,
    contactId: data.contactId,
    bindingId: data.bindingId,
    windowDays: trackingConfig.mergeWindowDays,
    maxEvents: trackingConfig.mergeMaxEvents,
    batchSize: 1000,
    now: new Date(),
  });
}
```

- [ ] **Step 5: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/merge.db.test.ts`
Expected: PASS, 9 testů.

- [ ] **Step 6: Commit**

```bash
git add packages/core/tracking/identity/merge.ts packages/core/tracking/jobs/identity-merge.ts packages/core/test/tracking/merge.db.test.ts
git commit -m "feat(tracking): merge anonymous history on first binding and allow revert"
```

---

### Task 31: Spotřebování `ml_token` na `/e/identify` `[db]`

Jednorázovost vynucuje **unikátní primární klíč nad `nonce`**, ne kontrola „existuje, tak odmítni". Rozdíl je v souběhu: dva požadavky s týmž tokenem ve stejný okamžik projdou kontrolou oba, ale `INSERT` uspěje právě jednomu.

Ve **všech** chybových případech uživatel na webu nic nepozná a tracking pokračuje anonymně.

Kontrola `Origin` je slabší, než by měla být, a je to vědomé: token podle zmrazeného kontraktu neváže cílový host, takže se ověřuje jen to, že `Origin` je **některá** z registrovaných domén projektu. Token vydaný pro `shop.cz` jde spotřebovat i na `blog.shop.cz`. Obě domény patří témuž zákazníkovi, takže dopad je malý. Návrh na vazbu na host patří do `t2`, ne sem.

**Files:**
- Create: `packages/core/tracking/identity/consume-token.ts`
- Test: `packages/core/test/tracking/consume-token.db.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/consume-token.db.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withTestDatabase, seedContact } from '@mlain/db/testing';
import { buildTrackingKeyring } from '../../tracking/tokens/keyring';
import { mintIdentityToken } from '../../tracking/tokens/mint';
import { createIdentifyService } from '../../tracking/identity/consume-token';

const db = withTestDatabase();
const ring = buildTrackingKeyring({
  secretKey: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
  secretKeyPrevious: '',
});
const anon = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('identify service', () => {
  let workspaceId: string;
  let contactId: string;
  let now: Date;
  let bind: ReturnType<typeof vi.fn>;

  const service = (over = {}) =>
    createIdentifyService({
      keyring: ring,
      resolvePublicKey: async () => ({ workspaceId, apiKeyId: 'k1' }),
      isOriginAllowed: () => true,
      bind,
      now: () => now,
      ...over,
    });

  const token = () =>
    mintIdentityToken({
      workspaceId, contactId, campaignId: '0192f3a0-1c2d-7e44-9e5f-60718293a4b5',
      ttlSeconds: 900, keyring: ring, currentKeyId: 1, now,
    }).token;

  const body = (t: string) => ({ v: 1, key: 'ml_pub_aebagbafaydqqcik', anonymous_id: anon, token: t });

  beforeEach(async () => {
    await db.truncateTracking();
    now = new Date('2026-07-31T12:00:00Z');
    ({ workspaceId, contactId } = await seedContact(db));
    bind = vi.fn(async () => 'created');
  });

  it('platný token vytvoří vazbu a vrátí 202 bez jediného údaje o kontaktu', async () => {
    const out = await service().identify(body(token()), { origin: 'https://shop.cz' });
    expect(out.status).toBe(202);
    expect(out.body).toEqual({ ok: true });
    expect(JSON.stringify(out.body)).not.toContain(contactId);
    expect(bind).toHaveBeenCalledTimes(1);
  });

  it('evidence vazby nese campaign_id, protože token nese kampaň, ne zprávu', async () => {
    await service().identify(body(token()), { origin: 'https://shop.cz' });
    expect(bind.mock.calls[0]![0]).toMatchObject({
      source: 'email_click',
      evidence: { campaign_id: '0192f3a0-1c2d-7e44-9e5f-60718293a4b5' },
    });
  });

  it('druhé použití téhož tokenu vrátí 409 a token_already_used', async () => {
    const t = token();
    await service().identify(body(t), { origin: 'https://shop.cz' });
    const second = await service().identify(body(t), { origin: 'https://shop.cz' });
    expect(second.status).toBe(409);
    expect(second.problem?.code).toBe('token_already_used');
  });

  it('souběžné spotřebování téhož tokenu uspěje právě jednou', async () => {
    const t = token();
    const svc = service();
    const results = await Promise.all([
      svc.identify(body(t), { origin: 'https://shop.cz' }),
      svc.identify(body(t), { origin: 'https://shop.cz' }),
      svc.identify(body(t), { origin: 'https://shop.cz' }),
    ]);
    expect(results.filter((r) => r.status === 202)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(2);
  });

  it('token použitý 16 minut po vydání vrátí 410 a token_expired', async () => {
    const t = token();
    now = new Date('2026-07-31T12:16:00Z');
    const out = await service().identify(body(t), { origin: 'https://shop.cz' });
    expect(out.status).toBe(410);
    expect(out.problem?.code).toBe('token_expired');
  });

  it('token použitý 14 minut po vydání ještě projde', async () => {
    const t = token();
    now = new Date('2026-07-31T12:14:00Z');
    expect((await service().identify(body(t), { origin: 'https://shop.cz' })).status).toBe(202);
  });

  it('Origin mimo domény projektu vrátí 403 a nespotřebuje nonce', async () => {
    const t = token();
    const out = await service({ isOriginAllowed: () => false }).identify(body(t), {
      origin: 'https://evil.example',
    });
    expect(out.status).toBe(403);
    expect(out.problem?.code).toBe('origin_not_allowed');
    // nonce se nespotřeboval, takže token jde použít na správné doméně
    expect((await service().identify(body(t), { origin: 'https://shop.cz' })).status).toBe(202);
  });

  it('token jiného typu než i vrátí 400 a token_type_mismatch', async () => {
    const openToken = 't1bwEBkvOgHC1-QJobLD1OX2BxAZLzoBwtfkGLLD1OX2Bxgmpk3YDUjmcTwPYu1Q9cpqmSPs4g';
    const out = await service().identify(body(openToken), { origin: 'https://shop.cz' });
    expect(out.status).toBe(400);
    expect(out.problem?.code).toBe('token_type_mismatch');
  });

  it('mezitím smazaný kontakt vrátí 202 s ok:false, ne chybu', async () => {
    const out = await service({ bind: async () => 'contact_not_found' }).identify(
      body(token()), { origin: 'https://shop.cz' },
    );
    expect(out.status).toBe(202);
    expect(out.body).toEqual({ ok: false, reason: 'contact_not_found' });
  });

  it('token pro jiný projekt, než ke kterému patří veřejný klíč, se odmítne', async () => {
    const foreign = mintIdentityToken({
      workspaceId: '0192f3a0-1c2d-7e40-9a1b-000000000000', contactId,
      campaignId: '0192f3a0-1c2d-7e44-9e5f-60718293a4b5',
      ttlSeconds: 900, keyring: ring, currentKeyId: 1, now,
    }).token;
    const out = await service().identify(body(foreign), { origin: 'https://shop.cz' });
    expect(out.status).toBe(403);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/consume-token.db.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/identity/consume-token"`.

- [ ] **Step 3: Napiš službu**

```ts
// packages/core/tracking/identity/consume-token.ts
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { withTrackingTx } from '../repo/tx';
import type { IdentifyResponse } from '../api/public-events.routes';
import type { PublicKeyOwner } from '../ingest/public-key';
import type { TrackingKeyring } from '../tokens/keyring';
import { verifyTrackingToken } from '../tokens/verify';
import { SUPPORTED_PAYLOAD_VERSIONS } from '../ingest/schema';
import type { BindOutcome } from './bind';

const IdentifyBodySchema = z
  .object({
    v: z.number().int(),
    key: z.string().min(1).max(64),
    anonymous_id: z.string().uuid(),
    token: z.string().min(3).max(512),
  })
  .strict();

export type IdentifyServiceDeps = {
  keyring: TrackingKeyring;
  resolvePublicKey: (key: string) => Promise<PublicKeyOwner | null>;
  isOriginAllowed: (workspaceId: string, origin: string) => boolean;
  bind: (input: {
    workspaceId: string;
    anonymousId: string;
    contactId: string;
    source: 'email_click';
    evidence: Record<string, unknown>;
    now: Date;
  }) => Promise<BindOutcome>;
  now: () => Date;
};

/**
 * Jednorázovost vynucuje unikátní primární klíč nad nonce, ne kontrola
 * "existuje, tak odmítni". Souběžné pokusy projdou kontrolou oba, ale INSERT
 * uspěje právě jednomu.
 */
async function claimNonce(
  workspaceId: string,
  nonce: Uint8Array,
  expiresAt: Date,
): Promise<boolean> {
  return withTrackingTx(workspaceId, 'tracking.consume_token', async (tx) => {
    const { rows } = await tx.execute<{ nonce: Buffer }>(sql`
      INSERT INTO identity_token_uses (nonce, expires_at)
      VALUES (${Buffer.from(nonce)}, ${expiresAt})
      ON CONFLICT (nonce) DO NOTHING
      RETURNING nonce
    `);
    return rows.length > 0;
  });
}

export function createIdentifyService(deps: IdentifyServiceDeps) {
  return {
    async identify(
      input: unknown,
      meta: { origin: string | undefined },
    ): Promise<IdentifyResponse> {
      const version = (input as { v?: unknown } | null)?.v;
      if (typeof version !== 'number' || !SUPPORTED_PAYLOAD_VERSIONS.includes(version as 1)) {
        return { status: 400, problem: { code: 'tracking_payload_version_unsupported' } };
      }

      const parsed = IdentifyBodySchema.safeParse(input);
      if (!parsed.success) return { status: 400, problem: { code: 'validation_failed' } };

      const owner = await deps.resolvePublicKey(parsed.data.key);
      if (owner === null) return { status: 403, problem: { code: 'origin_not_allowed' } };

      const now = deps.now();
      const verified = verifyTrackingToken(parsed.data.token, ['i'], { keyring: deps.keyring, now });
      if (!verified.ok) {
        const status = verified.code === 'token_type_mismatch' ? 400 : 400;
        return { status, problem: { code: verified.code } };
      }
      if (verified.fields.type !== 'i') {
        return { status: 400, problem: { code: 'token_type_mismatch' } };
      }
      const fields = verified.fields;

      // Token musí patřit témuž projektu jako veřejný klíč, jinak jde o záměnu.
      if (fields.workspaceId !== owner.workspaceId) {
        return { status: 403, problem: { code: 'origin_not_allowed' } };
      }

      // Origin se kontroluje dřív než spotřebování nonce, aby špatná doména
      // token nespálila a člověk ho mohl použít na té správné.
      if (meta.origin === undefined || !deps.isOriginAllowed(owner.workspaceId, meta.origin)) {
        return { status: 403, problem: { code: 'origin_not_allowed' } };
      }

      const expiresAt = new Date(fields.expiresAt * 1000);
      if (expiresAt.getTime() <= now.getTime()) {
        return { status: 410, problem: { code: 'token_expired' } };
      }

      if (!(await claimNonce(fields.workspaceId, fields.nonce, expiresAt))) {
        return { status: 409, problem: { code: 'token_already_used' } };
      }

      const outcome = await deps.bind({
        workspaceId: fields.workspaceId,
        anonymousId: parsed.data.anonymous_id,
        contactId: fields.contactId,
        source: 'email_click',
        // Token nese kampaň, ne zprávu, takže evidence je campaign_id.
        evidence: { campaign_id: fields.campaignId },
        now,
      });

      if (outcome === 'contact_not_found' || outcome === 'restricted') {
        return { status: 202, body: { ok: false, reason: outcome } };
      }
      return { status: 202, body: { ok: true } };
    },
  };
}
```

- [ ] **Step 4: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/consume-token.db.test.ts`
Expected: PASS, 10 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/tracking/identity/consume-token.ts packages/core/test/tracking/consume-token.db.test.ts
git commit -m "feat(tracking): consume one-time identity token with nonce uniqueness"
```

---

### Task 32: Job `event.process` `[db]`

Zpracovává dávku webových událostí. Kroky 2 až 6 běží v jedné transakci, ingestion endpoint na ně nečeká.

Deduplikace je **aplikační v okně sedmi dní**, ne databázová. Klíč `(id, received_at)` opakované odeslání nezachytí, protože `received_at` se pokaždé liší. Okno sedmi dní odpovídá životnosti offline fronty v SDK, takže pokrývá každý reálný případ. Událost odeslaná znovu po víc než sedmi dnech se uloží dvakrát, což se projeví jako dvě identické položky v časové ose, ne jako poškozená data. Přijatelné a zapsané.

**Files:**
- Create: `packages/core/tracking/repo/web-events.repo.ts`
- Create: `packages/core/tracking/jobs/event-process.ts`
- Test: `packages/core/test/tracking/event-process.db.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/event-process.db.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withTestDatabase, seedContact } from '@mlain/db/testing';
import { handleEventProcess } from '../../tracking/jobs/event-process';

const db = withTestDatabase();
const anon = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('event.process', () => {
  let workspaceId: string;
  let contactId: string;
  let enqueue: ReturnType<typeof vi.fn>;

  const event = (over = {}) => ({
    id: '0192f3a0-1c2d-7e50-8a1b-2c3d4e5f6071',
    name: 'page_view',
    occurredAt: '2026-07-31T11:59:00.000Z',
    sessionId: null,
    page: { url: 'https://shop.cz/a', path: '/a' },
    properties: {},
    context: {},
    ...over,
  });

  const job = (over = {}) => ({
    workspaceId, anonymousId: anon, source: 'web' as const, events: [event()], ...over,
  });

  beforeEach(async () => {
    await db.truncateTracking();
    ({ workspaceId, contactId } = await seedContact(db));
    enqueue = vi.fn(async () => {});
  });

  it('uloží událost a založí řádek identities s contact_id NULL', async () => {
    await handleEventProcess(job(), { enqueue });
    expect(await db.countWebEvents(workspaceId)).toBe(1);
    expect(await db.selectIdentityContactId(workspaceId, anon)).toBeNull();
  });

  it('u navázaného anonymního ID doplní contact_id na událost', async () => {
    await db.insertIdentity(workspaceId, anon, contactId);
    await handleEventProcess(job(), { enqueue });
    expect(await db.countWebEventsForContact(workspaceId, contactId)).toBe(1);
  });

  it('u kontaktu s processing_restricted se contact_id nedoplní a událost je anonymní', async () => {
    await db.insertIdentity(workspaceId, anon, contactId);
    await db.setProcessingRestricted(contactId, true);
    await handleEventProcess(job(), { enqueue });
    expect(await db.countWebEventsForContact(workspaceId, contactId)).toBe(0);
    expect(await db.countWebEvents(workspaceId)).toBe(1);
    expect(await db.selectLastActivityAt(contactId)).toBeNull();
  });

  it('táž událost odeslaná dvakrát vytvoří jeden řádek', async () => {
    await handleEventProcess(job(), { enqueue });
    await handleEventProcess(job(), { enqueue });
    expect(await db.countWebEvents(workspaceId)).toBe(1);
  });

  it('duplicita uvnitř jedné dávky se zachytí také', async () => {
    await handleEventProcess(job({ events: [event(), event()] }), { enqueue });
    expect(await db.countWebEvents(workspaceId)).toBe(1);
  });

  it('doplní web_event_months podle received_at, ne podle occurred_at', async () => {
    await handleEventProcess(job(), { enqueue });
    expect(await db.countWebEventMonths(workspaceId, 'anonymous', anon)).toBe(1);
  });

  it('u navázaného kontaktu zařadí přepočet segmentů', async () => {
    await db.insertIdentity(workspaceId, anon, contactId);
    await handleEventProcess(job(), { enqueue });
    expect(enqueue).toHaveBeenCalledWith('segments.recalc_for_contact', expect.anything());
  });

  it('import nezvedá last_activity_at ani nespouští přepočet segmentů', async () => {
    await db.insertIdentity(workspaceId, anon, contactId);
    await handleEventProcess(job({ source: 'import' }), { enqueue });
    expect(await db.selectLastActivityAt(contactId)).toBeNull();
    expect(enqueue).not.toHaveBeenCalledWith('segments.recalc_for_contact', expect.anything());
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/event-process.db.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/jobs/event-process"`.

- [ ] **Step 3: Napiš repository webových událostí**

```ts
// packages/core/tracking/repo/web-events.repo.ts
import { sql } from 'drizzle-orm';
import { withTrackingTx } from './tx';
import type { EventContext, EventPage, EventSource } from '../types';

export type WebEventInsert = {
  id: string;
  occurredAt: Date;
  /** U živých cest now(), u importu odvozené z occurredAt, viz 2.2.1. */
  receivedAt: Date;
  workspaceId: string;
  name: string;
  anonymousId: string | null;
  contactId: string | null;
  sessionId: string | null;
  source: EventSource;
  page: EventPage | Record<string, never>;
  properties: Record<string, unknown>;
  context: EventContext;
};

/** Vrátí ID těch, které v okně sedmi dní už existují. */
export async function selectExistingEventIds(
  workspaceId: string,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await withTrackingTx(workspaceId, 'event.process', async (tx) =>
    (await tx.execute<{ id: string }>(sql`
      SELECT id FROM web_events
       WHERE workspace_id = ${workspaceId}
         AND id = ANY(${sql.param([...ids])}::uuid[])
         AND received_at >= now() - interval '7 days'
    `)).rows,
  );
  return new Set(rows.map((row) => row.id));
}

/**
 * Celá dávka patří jednomu projektu: přišla jedním požadavkem ověřeným jedním
 * veřejným klíčem. Workspace se proto předává, negrupuje se z řádků.
 *
 * `ON CONFLICT (id, received_at)` tady na rozdíl od `message_events` **není**
 * mrtvý kód: obě složky klíče se vkládají explicitně a obě jsou stabilní.
 * `id` vyrobil prohlížeč, `received_at` je čas přijetí uložený v payloadu jobu,
 * takže opakovaný běh jobu narazí na tentýž řádek. Dedup v sedmidenním okně
 * navíc dělá selectExistingEventIds.
 */
export async function insertWebEvents(
  workspaceId: string,
  rows: readonly WebEventInsert[],
): Promise<string[]> {
  if (rows.length === 0) return [];
  return withTrackingTx(workspaceId, 'event.process', async (tx) => {
    const { rows: inserted } = await tx.execute<{ id: string }>(sql`
      INSERT INTO web_events (
        id, occurred_at, received_at, workspace_id, name, anonymous_id,
        contact_id, session_id, source, page, properties, context)
      SELECT * FROM unnest(
        ${sql.param(rows.map((r) => r.id))}::uuid[],
        ${sql.param(rows.map((r) => r.occurredAt))}::timestamptz[],
        ${sql.param(rows.map((r) => r.receivedAt))}::timestamptz[],
        ${sql.param(rows.map((r) => r.workspaceId))}::uuid[],
        ${sql.param(rows.map((r) => r.name))}::text[],
        ${sql.param(rows.map((r) => r.anonymousId))}::uuid[],
        ${sql.param(rows.map((r) => r.contactId))}::uuid[],
        ${sql.param(rows.map((r) => r.sessionId))}::uuid[],
        ${sql.param(rows.map((r) => r.source))}::text[],
        ${sql.param(rows.map((r) => JSON.stringify(r.page)))}::jsonb[],
        ${sql.param(rows.map((r) => JSON.stringify(r.properties)))}::jsonb[],
        ${sql.param(rows.map((r) => JSON.stringify(r.context)))}::jsonb[])
      ON CONFLICT (id, received_at) DO NOTHING
      RETURNING id
    `);
    return inserted.map((row) => row.id);
  });
}

export async function upsertWebEventMonths(
  workspaceId: string,
  rows: readonly { workspaceId: string; subjectKind: 'contact' | 'anonymous'; subjectId: string; month: Date }[],
): Promise<void> {
  if (rows.length === 0) return;
  await withTrackingTx(workspaceId, 'event.process', async (tx) => {
    await tx.execute(sql`
      INSERT INTO web_event_months (workspace_id, subject_kind, subject_id, month)
      SELECT * FROM unnest(
        ${sql.param(rows.map((r) => r.workspaceId))}::uuid[],
        ${sql.param(rows.map((r) => r.subjectKind))}::text[],
        ${sql.param(rows.map((r) => r.subjectId))}::uuid[],
        ${rows.map((r) => r.month)}::date[])
      ON CONFLICT DO NOTHING
    `);
  });
}

export type ResolvedIdentity = {
  contactId: string | null;
  processingRestricted: boolean;
  deletedAt: Date | null;
};

export async function resolveIdentity(
  workspaceId: string,
  anonymousId: string,
): Promise<ResolvedIdentity | null> {
  const rows = await withTrackingTx(workspaceId, 'event.process', async (tx) =>
    (await tx.execute<ResolvedIdentity>(sql`
      SELECT i.contact_id AS "contactId",
             COALESCE(c.processing_restricted, false) AS "processingRestricted",
             c.deleted_at AS "deletedAt"
        FROM identities i
        LEFT JOIN contacts c ON c.id = i.contact_id
       WHERE i.workspace_id = ${workspaceId} AND i.anonymous_id = ${anonymousId}
    `)).rows,
  );
  return rows[0] ?? null;
}

export async function ensureIdentityRow(workspaceId: string, anonymousId: string, now: Date): Promise<void> {
  await withTrackingTx(workspaceId, 'event.process', async (tx) => {
    await tx.execute(sql`
      INSERT INTO identities (workspace_id, anonymous_id, contact_id, first_seen, last_seen)
      VALUES (${workspaceId}, ${anonymousId}, NULL, ${now}, ${now})
      ON CONFLICT (workspace_id, anonymous_id) DO UPDATE SET last_seen = ${now}
    `);
  });
}

/** Práh 60 sekund brání tomu, aby aktivní návštěvník generoval desítky UPDATE na jeden řádek. */
export async function touchContactActivity(
  workspaceId: string,
  contactId: string,
  at: Date,
): Promise<void> {
  await withTrackingTx(workspaceId, 'event.process', async (tx) => {
    await tx.execute(sql`
      UPDATE contacts
         SET last_activity_at = ${at}
       WHERE id = ${contactId}
         AND processing_restricted = false
         AND deleted_at IS NULL
         AND (last_activity_at IS NULL OR ${at}::timestamptz - last_activity_at > interval '60 seconds')
    `);
  });
}
```

- [ ] **Step 4: Napiš handler jobu**

```ts
// packages/core/tracking/jobs/event-process.ts
import type { EventContext, EventPage, EventSource } from '../types';
import {
  ensureIdentityRow,
  insertWebEvents,
  resolveIdentity,
  selectExistingEventIds,
  touchContactActivity,
  upsertWebEventMonths,
  type WebEventInsert,
} from '../repo/web-events.repo';

export const EVENT_PROCESS_QUEUE = 'event.process';

export type EventProcessJobData = {
  workspaceId: string;
  anonymousId: string | null;
  source: EventSource;
  events: {
    id: string;
    name: string;
    occurredAt: string;
    sessionId: string | null;
    page?: EventPage;
    properties: Record<string, unknown>;
    context: EventContext;
    /** Jen u serverové cesty a importu. */
    contactId?: string | null;
  }[];
};

export type EventProcessDeps = { enqueue: (queue: string, data: unknown) => Promise<void> };

export async function handleEventProcess(
  data: EventProcessJobData,
  deps: EventProcessDeps,
): Promise<void> {
  const now = new Date();
  const isImport = data.source === 'import';

  // 2. vyřešení identity
  let contactId: string | null = null;
  if (data.anonymousId !== null) {
    const identity = await resolveIdentity(data.workspaceId, data.anonymousId);
    if (identity === null) {
      await ensureIdentityRow(data.workspaceId, data.anonymousId, now);
    } else if (
      identity.contactId !== null &&
      !identity.processingRestricted &&
      identity.deletedAt === null
    ) {
      contactId = identity.contactId;
    }
    // Omezené zpracování nebo smazaný kontakt: contact_id se NEdoplní (GDPR čl. 18).
  }

  // 3. aplikační deduplikace v okně sedmi dní
  const existing = await selectExistingEventIds(
    data.workspaceId,
    data.events.map((event) => event.id),
  );
  const seen = new Set<string>();

  const rows: WebEventInsert[] = [];
  for (const event of data.events) {
    if (existing.has(event.id) || seen.has(event.id)) continue;
    seen.add(event.id);

    const occurredAt = new Date(event.occurredAt);
    rows.push({
      id: event.id,
      occurredAt,
      // U importu padne řádek do oddílu podle času vzniku, jinak by ho
      // dotaz na loňský listopad nenašel a retence by ho zahodila jindy.
      receivedAt: isImport ? occurredAt : now,
      workspaceId: data.workspaceId,
      name: event.name,
      anonymousId: data.anonymousId,
      contactId: event.contactId ?? contactId,
      sessionId: event.sessionId,
      source: data.source,
      page: event.page ?? {},
      properties: event.properties,
      context: event.context,
    });
  }

  const insertedIds = await insertWebEvents(data.workspaceId, rows);
  if (insertedIds.length === 0) return;

  const inserted = rows.filter((row) => insertedIds.includes(row.id));

  // 4. řídká mapa měsíců, ve kterých subjekt vůbec má data
  const months = new Map<string, { workspaceId: string; subjectKind: 'contact' | 'anonymous'; subjectId: string; month: Date }>();
  for (const row of inserted) {
    const month = new Date(Date.UTC(row.receivedAt.getUTCFullYear(), row.receivedAt.getUTCMonth(), 1));
    for (const [kind, id] of [
      ['contact', row.contactId],
      ['anonymous', row.anonymousId],
    ] as const) {
      if (id === null) continue;
      months.set(`${kind}:${id}:${month.toISOString()}`, {
        workspaceId: row.workspaceId,
        subjectKind: kind,
        subjectId: id,
        month,
      });
    }
  }
  await upsertWebEventMonths(data.workspaceId, [...months.values()]);

  // 6. a 7. Historická událost není aktivita a import nespouští živé reakce.
  if (isImport) return;

  const latestByContact = new Map<string, Date>();
  for (const row of inserted) {
    if (row.contactId === null) continue;
    const current = latestByContact.get(row.contactId);
    if (current === undefined || row.occurredAt > current) {
      latestByContact.set(row.contactId, row.occurredAt);
    }
  }
  for (const [id, at] of latestByContact) {
    await touchContactActivity(workspaceId, id, at);
    await deps.enqueue('segments.recalc_for_contact', { workspaceId: data.workspaceId, contactId: id });
  }
}
```

- [ ] **Step 5: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/event-process.db.test.ts`
Expected: PASS, 8 testů.

- [ ] **Step 6: Commit**

```bash
git add packages/core/tracking/repo/web-events.repo.ts packages/core/tracking/jobs/event-process.ts packages/core/test/tracking/event-process.db.test.ts
git commit -m "feat(tracking): process web event batches with seven day dedup window"
```

---

### Task 33: Job `tracking.process_engagement` `[db]`

Krok 5 je klíčový pro správnost unikátních počtů. Přírůstek do `campaign_stats.opens_unique` se udělá **jen tehdy**, když `message_engagement.first_open_at` přešlo z `NULL` na hodnotu. To zaručí, že se jedna zpráva započítá jako unikátní otevření právě jednou, i když job poběží dvakrát.

Přírůstky do `*_total` se počítají z **počtu skutečně vložených řádků**, ne z délky vstupního pole. Kdyby se počítaly z délky, druhý běh po pádu workeru by čísla nafoukl.

Deduplikace opakovaných stažení: dvě otevření téže zprávy stejné třídy do 180 sekund od sebe se počítají jako jedno. Obě události se uloží, data se nezahazují, ale `open_count` se zvýší jen jednou.

> **Pořadí:** tenhle úkol importuje `applyContactEngagementDelta` z `repo/contact-engagement.repo.ts`, který vzniká až v Tasku 34. **Proveď proto Task 34 dřív než Task 33.** Je to jediné místo v plánu, kde pořadí neodpovídá číslování, a je zapsané schválně, aby si toho nikdo nevšiml až podle chyby překladu.

**Files:**
- Create: `packages/core/tracking/repo/engagement.repo.ts`
- Create: `packages/core/tracking/jobs/process-engagement.ts`
- Test: `packages/core/test/tracking/process-engagement.db.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/process-engagement.db.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withTestDatabase, seedCampaign, seedMessage } from '@mlain/db/testing';
import { handleProcessEngagement } from '../../tracking/jobs/process-engagement';

const db = withTestDatabase();

describe('tracking.process_engagement', () => {
  let workspaceId: string;
  let campaignId: string;
  let messageId: string;
  const createdAt = new Date('2026-07-25T16:00:00.000Z');
  let enqueue: ReturnType<typeof vi.fn>;
  let emitWebhook: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    await db.truncateTracking();
    ({ workspaceId, campaignId } = await seedCampaign(db, { audienceBuiltAt: createdAt }));
    ({ messageId } = await seedMessage(db, { workspaceId, campaignId, createdAt, sentAt: createdAt }));
    enqueue = vi.fn(async () => {});
    emitWebhook = vi.fn(async () => {});
  });

  const run = async (eventIds: string[]) =>
    handleProcessEngagement({ messageEventIds: eventIds }, { enqueue, emitWebhook });

  it('první otevření nastaví first_open_at a zvýší opens_unique o jedna', async () => {
    const id = await db.insertMessageEvent({ workspaceId, messageId, messageCreatedAt: createdAt, campaignId, type: 'open', subtype: 'human' });
    await run([id]);
    const stats = await db.selectCampaignStats(campaignId);
    expect(stats.opens_unique).toBe(1);
    expect(stats.opens_unique_human).toBe(1);
  });

  it('dvojí spuštění se stejnou dávkou nezmění opens_unique', async () => {
    const id = await db.insertMessageEvent({ workspaceId, messageId, messageCreatedAt: createdAt, campaignId, type: 'open', subtype: 'human' });
    await run([id]);
    await run([id]);
    expect((await db.selectCampaignStats(campaignId)).opens_unique).toBe(1);
  });

  it('dvě otevření 10 sekund po sobě zvýší open_count o jedna', async () => {
    const a = await db.insertMessageEvent({ workspaceId, messageId, messageCreatedAt: createdAt, campaignId, type: 'open', subtype: 'human', ts: new Date('2026-07-25T17:00:00Z') });
    const b = await db.insertMessageEvent({ workspaceId, messageId, messageCreatedAt: createdAt, campaignId, type: 'open', subtype: 'human', ts: new Date('2026-07-25T17:00:10Z') });
    await run([a, b]);
    expect((await db.selectMessageEngagement(messageId, createdAt)).open_count).toBe(1);
  });

  it('dvě otevření 200 sekund po sobě zvýší open_count o dva', async () => {
    const a = await db.insertMessageEvent({ workspaceId, messageId, messageCreatedAt: createdAt, campaignId, type: 'open', subtype: 'human', ts: new Date('2026-07-25T17:00:00Z') });
    const b = await db.insertMessageEvent({ workspaceId, messageId, messageCreatedAt: createdAt, campaignId, type: 'open', subtype: 'human', ts: new Date('2026-07-25T17:03:20Z') });
    await run([a, b]);
    expect((await db.selectMessageEngagement(messageId, createdAt)).open_count).toBe(2);
  });

  it('otevření jen třídou proxy_apple se počítá do opens_unique_apple, ne do human', async () => {
    const id = await db.insertMessageEvent({ workspaceId, messageId, messageCreatedAt: createdAt, campaignId, type: 'open', subtype: 'proxy_apple' });
    await run([id]);
    const stats = await db.selectCampaignStats(campaignId);
    expect(stats.opens_unique_apple).toBe(1);
    expect(stats.opens_unique_human).toBe(0);
    expect(stats.opens_unique).toBe(1);
  });

  it('přechod z čistě Apple otevření na lidské odečte opens_unique_apple', async () => {
    // Jediné místo v celém plánu, kde se do agregátu zapisuje ZÁPORNÝ přírůstek.
    // `opens_unique_apple` znamená "zpráva má výhradně Apple otevření", takže
    // jakmile dorazí lidské, musí se číslo snížit. Sloupec je bigint, tedy
    // se znaménkem, ale bez tohohle testu by chyba ve znaménku prošla:
    // v součtu by čísla dál rostla a nikdo by si nevšiml.
    const apple = await db.insertMessageEvent({ workspaceId, messageId, messageCreatedAt: createdAt, campaignId, type: 'open', subtype: 'proxy_apple' });
    await run([apple]);
    expect((await db.selectCampaignStats(campaignId)).opens_unique_apple).toBe(1);

    const human = await db.insertMessageEvent({ workspaceId, messageId, messageCreatedAt: createdAt, campaignId, type: 'open', subtype: 'human', ts: new Date('2026-07-25T18:00:00Z') });
    await run([human]);
    const after = await db.selectCampaignStats(campaignId);
    expect(after.opens_unique_apple).toBe(0);
    expect(after.opens_unique_human).toBe(1);
    // Unikátní otevření zprávy zůstává jedno, jen se překlasifikovalo.
    expect(after.opens_unique).toBe(1);
    // A nikdy pod nulu: záporný přírůstek se smí uplatnit jen jednou.
    await run([human]);
    expect((await db.selectCampaignStats(campaignId)).opens_unique_apple).toBe(0);
  });

  it('proxy_image se počítá do ověřených otevření', async () => {
    const id = await db.insertMessageEvent({ workspaceId, messageId, messageCreatedAt: createdAt, campaignId, type: 'open', subtype: 'proxy_image' });
    await run([id]);
    expect((await db.selectMessageEngagement(messageId, createdAt)).first_human_open_at).not.toBeNull();
  });

  it('klik zvýší statistiku odkazu a uloží jeho pozici', async () => {
    const linkId = await db.insertCampaignLink(workspaceId, campaignId, 'https://shop.cz/a', 3);
    const id = await db.insertMessageEvent({ workspaceId, messageId, messageCreatedAt: createdAt, campaignId, type: 'click', subtype: 'human', linkId, metadata: { link_position: 3 } });
    await run([id]);
    const link = await db.selectCampaignLinkStats(workspaceId, campaignId, linkId);
    expect(link.clicks_unique).toBe(1);
    expect(link.clicks_human).toBe(1);
  });

  it('klik třídy scanner se uloží, ale nezvýší clicks_unique_human', async () => {
    const linkId = await db.insertCampaignLink(workspaceId, campaignId, 'https://shop.cz/a', 1);
    const id = await db.insertMessageEvent({ workspaceId, messageId, messageCreatedAt: createdAt, campaignId, type: 'click', subtype: 'scanner', linkId });
    await run([id]);
    const stats = await db.selectCampaignStats(campaignId);
    expect(stats.clicks_unique_human).toBe(0);
    expect(stats.clicks_scanner).toBe(1);
  });

  it('vloží položku do web_events, aby byla událost v jednotné časové ose', async () => {
    const id = await db.insertMessageEvent({ workspaceId, messageId, messageCreatedAt: createdAt, campaignId, type: 'open', subtype: 'human' });
    await run([id]);
    expect(await db.countWebEventsByName(workspaceId, 'email_opened')).toBe(1);
  });

  it('otevření třídy proxy_apple se do web_events nevkládá', async () => {
    const id = await db.insertMessageEvent({ workspaceId, messageId, messageCreatedAt: createdAt, campaignId, type: 'open', subtype: 'proxy_apple' });
    await run([id]);
    expect(await db.countWebEventsByName(workspaceId, 'email_opened')).toBe(0);
  });

  it('vypustí webhook message.opened jen jednou na zprávu', async () => {
    const a = await db.insertMessageEvent({ workspaceId, messageId, messageCreatedAt: createdAt, campaignId, type: 'open', subtype: 'human', ts: new Date('2026-07-25T17:00:00Z') });
    const b = await db.insertMessageEvent({ workspaceId, messageId, messageCreatedAt: createdAt, campaignId, type: 'open', subtype: 'human', ts: new Date('2026-07-25T18:00:00Z') });
    await run([a]);
    await run([b]);
    const opened = emitWebhook.mock.calls.filter((call) => call[0] === 'message.opened');
    expect(opened).toHaveLength(1);
    expect(opened[0]![1]).toMatchObject({ message_id: messageId });
    expect(opened[0]![1]).toHaveProperty('message_created_at');
  });

  it('naplní pětiminutový blok v campaign_stats_buckets', async () => {
    const id = await db.insertMessageEvent({ workspaceId, messageId, messageCreatedAt: createdAt, campaignId, type: 'open', subtype: 'human', ts: new Date('2026-07-25T17:07:00Z') });
    await run([id]);
    const bucket = await db.selectBucket(campaignId, new Date('2026-07-25T17:05:00Z'));
    expect(bucket.opens_unique).toBe(1);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/process-engagement.db.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/jobs/process-engagement"`.

- [ ] **Step 3: Napiš repository engagementu**

```ts
// packages/core/tracking/repo/engagement.repo.ts
import { sql } from 'drizzle-orm';
import { withCrossWorkspaceTx, withTrackingTx } from './tx';
import { OPEN_CLASS_BIT, type ClickClass, type OpenClass } from '../types';

export type MessageEventRow = {
  id: string;
  receivedAt: Date;
  ts: Date;
  workspaceId: string;
  messageId: string;
  messageCreatedAt: Date;
  campaignId: string;
  contactId: string | null;
  type: 'open' | 'click';
  subtype: string;
  linkId: string | null;
  metadata: Record<string, unknown>;
};

export async function selectMessageEventsByIds(ids: readonly string[]): Promise<MessageEventRow[]> {
  if (ids.length === 0) return [];
  return withCrossWorkspaceTx('tracking.process_engagement', async (tx) =>
    (await tx.execute<MessageEventRow>(sql`
      SELECT id, received_at AS "receivedAt", ts, workspace_id AS "workspaceId",
             message_id AS "messageId", message_created_at AS "messageCreatedAt",
             campaign_id AS "campaignId", contact_id AS "contactId",
             type, subtype, link_id AS "linkId", metadata
        FROM message_events
       WHERE id = ANY(${sql.param([...ids])}::uuid[])
         AND received_at >= now() - interval '2 days'
    `)).rows,
  );
}

export type EngagementTransition = {
  messageId: string;
  createdAt: Date;
  campaignId: string;
  contactId: string | null;
  firstOpen: boolean;
  firstHumanOpen: boolean;
  firstClick: boolean;
  firstHumanClick: boolean;
  openClassMaskBefore: number;
  openClassMaskAfter: number;
  openCountDelta: number;
  clickCountDelta: number;
  newLinkIds: string[];
};

export type EngagementDelta = {
  messageId: string;
  createdAt: Date;
  workspaceId: string;
  campaignId: string;
  contactId: string | null;
  opens: { at: Date; cls: OpenClass }[];
  clicks: { at: Date; cls: ClickClass; linkId: string }[];
};

/**
 * Upsert vrací předchozí hodnoty, aby se poznalo, které zprávy poprvé přešly
 * do stavu otevřeno nebo prokliknuto. Právě z těch přechodů se skládají
 * přírůstky do campaign_stats, ne z délky vstupu.
 */
export async function upsertMessageEngagement(
  delta: EngagementDelta,
  openDedupSeconds: number,
): Promise<EngagementTransition> {
  return withTrackingTx(delta.workspaceId, 'tracking.process_engagement', async (tx) => {
    const { rows: before } = await tx.execute<{
      firstOpenAt: Date | null;
      lastOpenAt: Date | null;
      firstHumanOpenAt: Date | null;
      firstClickAt: Date | null;
      firstHumanClickAt: Date | null;
      openClassMask: number;
    }>(sql`
      SELECT first_open_at AS "firstOpenAt", last_open_at AS "lastOpenAt",
             first_human_open_at AS "firstHumanOpenAt", first_click_at AS "firstClickAt",
             first_human_click_at AS "firstHumanClickAt", open_class_mask AS "openClassMask"
        FROM message_engagement
       WHERE message_id = ${delta.messageId} AND created_at = ${delta.createdAt}
         FOR UPDATE
    `);
    const prev = before[0] ?? {
      firstOpenAt: null, lastOpenAt: null, firstHumanOpenAt: null,
      firstClickAt: null, firstHumanClickAt: null, openClassMask: 0,
    };

    // Deduplikace opakovaných stažení: obě události se uloží, ale open_count
    // se zvýší jen jednou. Gmail proxy stáhne tentýž pixel několikrát za čtení.
    let lastOpenAt = prev.lastOpenAt;
    let openCountDelta = 0;
    for (const open of [...delta.opens].sort((a, b) => a.at.getTime() - b.at.getTime())) {
      if (lastOpenAt === null || open.at.getTime() - lastOpenAt.getTime() > openDedupSeconds * 1000) {
        openCountDelta += 1;
      }
      lastOpenAt = open.at;
    }

    const humanOpens = delta.opens.filter((o) => o.cls === 'human' || o.cls === 'proxy_image');
    const humanClicks = delta.clicks.filter((c) => c.cls === 'human');

    let mask = prev.openClassMask;
    for (const open of delta.opens) mask |= OPEN_CLASS_BIT[open.cls];

    const firstOpenAt = prev.firstOpenAt ?? minDate(delta.opens.map((o) => o.at));
    const firstHumanOpenAt = prev.firstHumanOpenAt ?? minDate(humanOpens.map((o) => o.at));
    const firstClickAt = prev.firstClickAt ?? minDate(delta.clicks.map((c) => c.at));
    const firstHumanClickAt = prev.firstHumanClickAt ?? minDate(humanClicks.map((c) => c.at));

    const linkIds = [...new Set(delta.clicks.map((c) => c.linkId))];

    const { rows: updated } = await tx.execute<{ clickedLinks: number }>(sql`
      INSERT INTO message_engagement (
        message_id, created_at, workspace_id, campaign_id, contact_id,
        first_open_at, last_open_at, open_count, first_human_open_at, human_open_count,
        open_class_mask, first_click_at, last_click_at, click_count,
        first_human_click_at, human_click_count, clicked_links)
      VALUES (
        ${delta.messageId}, ${delta.createdAt}, ${delta.workspaceId}, ${delta.campaignId},
        ${delta.contactId}, ${firstOpenAt}, ${lastOpenAt}, ${openCountDelta},
        ${firstHumanOpenAt}, ${humanOpens.length}, ${mask},
        ${firstClickAt}, ${maxDate(delta.clicks.map((c) => c.at))}, ${delta.clicks.length},
        ${firstHumanClickAt}, ${humanClicks.length}, ${linkIds.length})
      ON CONFLICT (message_id, created_at) DO UPDATE SET
        first_open_at        = COALESCE(message_engagement.first_open_at, excluded.first_open_at),
        last_open_at         = GREATEST(message_engagement.last_open_at, excluded.last_open_at),
        open_count           = message_engagement.open_count + excluded.open_count,
        first_human_open_at  = COALESCE(message_engagement.first_human_open_at, excluded.first_human_open_at),
        human_open_count     = message_engagement.human_open_count + excluded.human_open_count,
        open_class_mask      = message_engagement.open_class_mask | excluded.open_class_mask,
        first_click_at       = COALESCE(message_engagement.first_click_at, excluded.first_click_at),
        last_click_at        = GREATEST(message_engagement.last_click_at, excluded.last_click_at),
        click_count          = message_engagement.click_count + excluded.click_count,
        first_human_click_at = COALESCE(message_engagement.first_human_click_at, excluded.first_human_click_at),
        human_click_count    = message_engagement.human_click_count + excluded.human_click_count,
        clicked_links        = GREATEST(message_engagement.clicked_links, excluded.clicked_links)
      RETURNING clicked_links AS "clickedLinks"
    `);
    void updated;

    return {
      messageId: delta.messageId,
      createdAt: delta.createdAt,
      campaignId: delta.campaignId,
      contactId: delta.contactId,
      firstOpen: prev.firstOpenAt === null && firstOpenAt !== null,
      firstHumanOpen: prev.firstHumanOpenAt === null && firstHumanOpenAt !== null,
      firstClick: prev.firstClickAt === null && firstClickAt !== null,
      firstHumanClick: prev.firstHumanClickAt === null && firstHumanClickAt !== null,
      openClassMaskBefore: prev.openClassMask,
      openClassMaskAfter: mask,
      openCountDelta,
      clickCountDelta: delta.clicks.length,
      newLinkIds: linkIds,
    };
  });
}

function minDate(dates: readonly Date[]): Date | null {
  return dates.length === 0 ? null : new Date(Math.min(...dates.map((d) => d.getTime())));
}
function maxDate(dates: readonly Date[]): Date | null {
  return dates.length === 0 ? null : new Date(Math.max(...dates.map((d) => d.getTime())));
}

export type CampaignStatsDelta = {
  opensTotal: number;
  opensUnique: number;
  opensUniqueHuman: number;
  opensUniqueApple: number;
  clicksTotal: number;
  clicksUnique: number;
  clicksUniqueHuman: number;
  clicksScanner: number;
  firstEventAt: Date | null;
  lastEventAt: Date | null;
};

export async function applyCampaignStatsDelta(
  workspaceId: string,
  campaignId: string,
  delta: CampaignStatsDelta,
): Promise<void> {
  await withTrackingTx(workspaceId, 'tracking.process_engagement', async (tx) => {
    await tx.execute(sql`
      INSERT INTO campaign_stats (
        workspace_id, campaign_id, opens_total, opens_unique, opens_unique_human,
        opens_unique_apple, clicks_total, clicks_unique, clicks_unique_human,
        clicks_scanner, first_event_at, last_event_at, updated_at, version)
      VALUES (
        ${workspaceId}, ${campaignId}, ${delta.opensTotal}, ${delta.opensUnique},
        ${delta.opensUniqueHuman}, ${delta.opensUniqueApple}, ${delta.clicksTotal},
        ${delta.clicksUnique}, ${delta.clicksUniqueHuman}, ${delta.clicksScanner},
        ${delta.firstEventAt}, ${delta.lastEventAt}, now(), 1)
      ON CONFLICT (campaign_id) DO UPDATE SET
        opens_total        = campaign_stats.opens_total + excluded.opens_total,
        opens_unique       = campaign_stats.opens_unique + excluded.opens_unique,
        opens_unique_human = campaign_stats.opens_unique_human + excluded.opens_unique_human,
        opens_unique_apple = campaign_stats.opens_unique_apple + excluded.opens_unique_apple,
        clicks_total       = campaign_stats.clicks_total + excluded.clicks_total,
        clicks_unique      = campaign_stats.clicks_unique + excluded.clicks_unique,
        clicks_unique_human= campaign_stats.clicks_unique_human + excluded.clicks_unique_human,
        clicks_scanner     = campaign_stats.clicks_scanner + excluded.clicks_scanner,
        first_event_at     = LEAST(campaign_stats.first_event_at, excluded.first_event_at),
        last_event_at      = GREATEST(campaign_stats.last_event_at, excluded.last_event_at),
        updated_at         = now(),
        version            = campaign_stats.version + 1
    `);
  });
}

export async function applyLinkStatsDelta(
  workspaceId: string,
  campaignId: string,
  rows: readonly { linkId: string; total: number; unique: number; human: number }[],
): Promise<void> {
  if (rows.length === 0) return;
  await withTrackingTx(workspaceId, 'tracking.process_engagement', async (tx) => {
    await tx.execute(sql`
      INSERT INTO campaign_link_stats (workspace_id, campaign_id, link_id, clicks_total, clicks_unique, clicks_human)
      SELECT * FROM unnest(
        ${sql.param(rows.map(() => workspaceId))}::uuid[],
        ${sql.param(rows.map(() => campaignId))}::uuid[],
        ${sql.param(rows.map((r) => r.linkId))}::uuid[],
        ${sql.param(rows.map((r) => r.total))}::bigint[],
        ${sql.param(rows.map((r) => r.unique))}::bigint[],
        ${sql.param(rows.map((r) => r.human))}::bigint[])
      ON CONFLICT (workspace_id, campaign_id, link_id) DO UPDATE SET
        clicks_total  = campaign_link_stats.clicks_total + excluded.clicks_total,
        clicks_unique = campaign_link_stats.clicks_unique + excluded.clicks_unique,
        clicks_human  = campaign_link_stats.clicks_human + excluded.clicks_human
    `);
  });
}

export async function applyBucketDelta(
  workspaceId: string,
  campaignId: string,
  rows: readonly { bucketAt: Date; opensUnique: number; clicksUnique: number }[],
): Promise<void> {
  if (rows.length === 0) return;
  await withTrackingTx(workspaceId, 'tracking.process_engagement', async (tx) => {
    await tx.execute(sql`
      INSERT INTO campaign_stats_buckets (campaign_id, workspace_id, bucket_at, opens_unique, clicks_unique)
      SELECT * FROM unnest(
        ${sql.param(rows.map(() => campaignId))}::uuid[],
        ${sql.param(rows.map(() => workspaceId))}::uuid[],
        ${sql.param(rows.map((r) => r.bucketAt))}::timestamptz[],
        ${sql.param(rows.map((r) => r.opensUnique))}::int[],
        ${sql.param(rows.map((r) => r.clicksUnique))}::int[])
      ON CONFLICT (campaign_id, bucket_at) DO UPDATE SET
        opens_unique  = campaign_stats_buckets.opens_unique + excluded.opens_unique,
        clicks_unique = campaign_stats_buckets.clicks_unique + excluded.clicks_unique
    `);
  });
}
```

- [ ] **Step 4: Napiš handler jobu**

```ts
// packages/core/tracking/jobs/process-engagement.ts
import { v7 as uuidv7 } from 'uuid';
import { OPEN_CLASS_BIT, type ClickClass, type OpenClass } from '../types';
import { OPEN_DEDUP_WINDOW_SECONDS } from '../config';
import { ScannerWindow, reclassifyClicks } from '../click/classify-click';
import { isVerifiedOpenClass } from '../open/classify-open';
import {
  applyBucketDelta,
  applyCampaignStatsDelta,
  applyLinkStatsDelta,
  selectMessageEventsByIds,
  upsertMessageEngagement,
  type EngagementDelta,
} from '../repo/engagement.repo';
import { insertWebEvents } from '../repo/web-events.repo';
import { selectMessageExact } from '../repo/messages.repo';
import { applyContactEngagementDelta } from '../repo/contact-engagement.repo';

export const PROCESS_ENGAGEMENT_QUEUE = 'tracking.process_engagement';

export type ProcessEngagementJobData = { messageEventIds: string[] };
export type ProcessEngagementDeps = {
  enqueue: (queue: string, data: unknown) => Promise<void>;
  emitWebhook: (type: string, payload: Record<string, unknown>) => Promise<void>;
};

/** Okno pravidla 6 přežívá mezi běhy jobu v paměti workeru, viz 3.5. */
const scannerWindow = new ScannerWindow();

export async function handleProcessEngagement(
  data: ProcessEngagementJobData,
  deps: ProcessEngagementDeps,
): Promise<void> {
  const events = await selectMessageEventsByIds(data.messageEventIds);
  if (events.length === 0) return;

  // 2. dohledání zpráv kvůli sent_at pro pravidlo 5
  const sentAtByMessage: Record<string, Date> = {};
  for (const messageId of new Set(events.map((e) => e.messageId))) {
    const event = events.find((e) => e.messageId === messageId)!;
    const message = await selectMessageExact(
      event.workspaceId,
      messageId,
      Math.floor(event.messageCreatedAt.getTime() / 1000),
    );
    if (message?.sentAt != null) sentAtByMessage[messageId] = message.sentAt;
  }

  // 3. doklasifikace kliků pravidly 5 a 6
  const clickEvents = events.filter((e) => e.type === 'click');
  const reclassified = reclassifyClicks(
    clickEvents.map((e) => ({
      messageId: e.messageId,
      linkId: e.linkId ?? '',
      ip: (e.metadata.ip as string | undefined) ?? null,
      occurredAt: e.ts,
      clickClass: e.subtype as ClickClass,
    })),
    sentAtByMessage,
    scannerWindow,
  );
  const classByEvent = new Map<string, ClickClass>();
  clickEvents.forEach((event, index) => {
    classByEvent.set(event.id, reclassified[index]!.clickClass);
  });

  // 4. seskupení podle zprávy
  const byMessage = new Map<string, EngagementDelta>();
  for (const event of events) {
    const key = `${event.messageId}:${event.messageCreatedAt.toISOString()}`;
    const delta = byMessage.get(key) ?? {
      messageId: event.messageId,
      createdAt: event.messageCreatedAt,
      workspaceId: event.workspaceId,
      campaignId: event.campaignId,
      contactId: event.contactId,
      opens: [],
      clicks: [],
    };
    if (event.type === 'open') {
      delta.opens.push({ at: event.ts, cls: event.subtype as OpenClass });
    } else {
      delta.clicks.push({
        at: event.ts,
        cls: classByEvent.get(event.id) ?? 'human',
        linkId: event.linkId ?? '',
      });
    }
    byMessage.set(key, delta);
  }

  // 5. a 6. z přechodů se skládají přírůstky do agregací
  const perCampaign = new Map<string, { workspaceId: string; delta: Parameters<typeof applyCampaignStatsDelta>[2] }>();
  const linkDeltas = new Map<string, Map<string, { total: number; unique: number; human: number }>>();
  const bucketDeltas = new Map<string, Map<number, { opensUnique: number; clicksUnique: number }>>();
  const timelineRows: Parameters<typeof insertWebEvents>[1][number][] = [];

  for (const delta of byMessage.values()) {
    const transition = await upsertMessageEngagement(delta, OPEN_DEDUP_WINDOW_SECONDS);

    const humanClicks = delta.clicks.filter((c) => c.cls === 'human');
    const scannerClicks = delta.clicks.filter((c) => c.cls !== 'human');
    const appleOnly =
      transition.openClassMaskAfter === OPEN_CLASS_BIT.proxy_apple &&
      transition.openClassMaskBefore !== OPEN_CLASS_BIT.proxy_apple;
    const wasAppleOnly = transition.openClassMaskBefore === OPEN_CLASS_BIT.proxy_apple;

    const entry = perCampaign.get(delta.campaignId) ?? {
      workspaceId: delta.workspaceId,
      delta: {
        opensTotal: 0, opensUnique: 0, opensUniqueHuman: 0, opensUniqueApple: 0,
        clicksTotal: 0, clicksUnique: 0, clicksUniqueHuman: 0, clicksScanner: 0,
        firstEventAt: null, lastEventAt: null,
      },
    };

    entry.delta.opensTotal += transition.openCountDelta;
    if (transition.firstOpen) entry.delta.opensUnique += 1;
    if (transition.firstHumanOpen) entry.delta.opensUniqueHuman += 1;
    if (appleOnly) entry.delta.opensUniqueApple += 1;
    // Zpráva, která přestala být "jen Apple", se z toho čísla musí odečíst.
    if (wasAppleOnly && transition.openClassMaskAfter !== OPEN_CLASS_BIT.proxy_apple) {
      entry.delta.opensUniqueApple -= 1;
    }
    entry.delta.clicksTotal += transition.clickCountDelta;
    if (transition.firstClick) entry.delta.clicksUnique += 1;
    if (transition.firstHumanClick) entry.delta.clicksUniqueHuman += 1;
    entry.delta.clicksScanner += scannerClicks.length;

    const times = [...delta.opens.map((o) => o.at), ...delta.clicks.map((c) => c.at)];
    for (const at of times) {
      entry.delta.firstEventAt =
        entry.delta.firstEventAt === null || at < entry.delta.firstEventAt ? at : entry.delta.firstEventAt;
      entry.delta.lastEventAt =
        entry.delta.lastEventAt === null || at > entry.delta.lastEventAt ? at : entry.delta.lastEventAt;
    }
    perCampaign.set(delta.campaignId, entry);

    const links = linkDeltas.get(delta.campaignId) ?? new Map();
    for (const click of delta.clicks) {
      const row = links.get(click.linkId) ?? { total: 0, unique: 0, human: 0 };
      row.total += 1;
      if (transition.newLinkIds.includes(click.linkId)) row.unique += 1;
      if (click.cls === 'human') row.human += 1;
      links.set(click.linkId, row);
    }
    linkDeltas.set(delta.campaignId, links);

    const buckets = bucketDeltas.get(delta.campaignId) ?? new Map();
    for (const at of times) {
      const bucketAt = Math.floor(at.getTime() / 300_000) * 300_000;
      const row = buckets.get(bucketAt) ?? { opensUnique: 0, clicksUnique: 0 };
      if (transition.firstOpen) row.opensUnique += 1;
      if (transition.firstClick) row.clicksUnique += 1;
      buckets.set(bucketAt, row);
    }
    bucketDeltas.set(delta.campaignId, buckets);

    // 8. a 9. položky do jednotné časové osy
    const now = new Date();
    for (const open of delta.opens) {
      if (!isVerifiedOpenClass(open.cls)) continue;
      timelineRows.push({
        id: uuidv7(), occurredAt: open.at, receivedAt: now, workspaceId: delta.workspaceId,
        name: 'email_opened', anonymousId: null, contactId: delta.contactId, sessionId: null,
        source: 'email', page: {}, properties: { campaign_id: delta.campaignId, open_class: open.cls },
        context: {},
      });
    }
    for (const click of delta.clicks) {
      timelineRows.push({
        id: uuidv7(), occurredAt: click.at, receivedAt: now, workspaceId: delta.workspaceId,
        name: 'email_clicked', anonymousId: null, contactId: delta.contactId, sessionId: null,
        source: 'email', page: {},
        properties: { campaign_id: delta.campaignId, link_id: click.linkId, click_class: click.cls },
        context: {},
      });
    }

    // 11. webhooky, jen při prvním přechodu na zprávu
    if (transition.firstHumanOpen) {
      await deps.emitWebhook('message.opened', {
        message_id: delta.messageId,
        message_created_at: delta.createdAt.toISOString(),
        campaign_id: delta.campaignId,
        contact_id: delta.contactId,
        occurred_at: transition.createdAt.toISOString(),
        open_class: delta.opens[0]?.cls ?? 'human',
      });
    }
    for (const click of humanClicks) {
      await deps.emitWebhook('message.clicked', {
        message_id: delta.messageId,
        message_created_at: delta.createdAt.toISOString(),
        campaign_id: delta.campaignId,
        contact_id: delta.contactId,
        link_id: click.linkId,
        occurred_at: click.at.toISOString(),
      });
    }

    // 10. rollup na kontakt
    if (delta.contactId !== null) {
      await applyContactEngagementDelta({
        workspaceId: delta.workspaceId,
        contactId: delta.contactId,
        opened: transition.firstHumanOpen ? delta.opens[0]!.at : null,
        clicked: transition.firstHumanClick ? humanClicks[0]?.at ?? null : null,
      });
    }
  }

  for (const [campaignId, entry] of perCampaign) {
    await applyCampaignStatsDelta(entry.workspaceId, campaignId, entry.delta);
    await applyLinkStatsDelta(
      entry.workspaceId,
      campaignId,
      [...(linkDeltas.get(campaignId) ?? new Map())].map(([linkId, row]) => ({ linkId, ...row })),
    );
    await applyBucketDelta(
      entry.workspaceId,
      campaignId,
      [...(bucketDeltas.get(campaignId) ?? new Map())].map(([bucketAt, row]) => ({
        bucketAt: new Date(bucketAt),
        ...row,
      })),
    );
  }

  await insertWebEvents(delta.workspaceId, timelineRows);
}
```

- [ ] **Step 5: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/process-engagement.db.test.ts`
Expected: PASS, 12 testů.

- [ ] **Step 6: Commit**

```bash
git add packages/core/tracking/repo/engagement.repo.ts packages/core/tracking/jobs/process-engagement.ts packages/core/test/tracking/process-engagement.db.test.ts
git commit -m "feat(tracking): derive engagement and campaign stats from state transitions"
```

---

### Task 34: Rollup na kontakt a události od providera `[db]`

`contact_engagement` je jeden řádek na **kontakt** a bez ní nefunguje segmentace podle engagementu ani žádný z presetů čištění databáze. `message_engagement` na to nestačí ze dvou důvodů: je to jeden řádek na **zprávu** a její kontaktový index je částečný přes `first_open_at IS NOT NULL`, takže z definice neumí odpovědět na dotaz „neotevřel".

**`consecutive_no_open` má past v pořadí událostí.** Čítač se zvyšuje při doručení a nuluje při otevření, jenže pořadí zaručit nejde: u Apple proxy dorazí otevření často **dřív**, než provider doručí `delivered`. Kdyby se čítač nuloval a pak zvýšil, kontakt, který otevřel, by vypadal jako neotvírající. Řešení: čítač se zvýší jen tehdy, když u dané zprávy **neexistuje** řádek `message_engagement` s `first_human_open_at IS NOT NULL`.

Řádek se zakládá **líně**, až při první události kontaktu. Kontakt, kterému se nikdy nic neposlalo, řádek nemá, a segmentační dotaz s tím musí počítat.

**Files:**
- Create: `packages/core/tracking/repo/contact-engagement.repo.ts`
- Create: `packages/core/tracking/jobs/process-provider-events.ts`
- Test: `packages/core/test/tracking/contact-engagement.db.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/contact-engagement.db.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { withTestDatabase, seedCampaign, seedContact, seedMessage } from '@mlain/db/testing';
import { applyContactEngagementDelta } from '../../tracking/repo/contact-engagement.repo';
import { handleProcessProviderEvents } from '../../tracking/jobs/process-provider-events';

const db = withTestDatabase();

describe('contact engagement', () => {
  let workspaceId: string;
  let contactId: string;
  let campaignId: string;
  let messageId: string;
  const createdAt = new Date('2026-07-25T16:00:00.000Z');

  beforeEach(async () => {
    await db.truncateTracking();
    ({ workspaceId, campaignId } = await seedCampaign(db, { audienceBuiltAt: createdAt }));
    ({ contactId } = await seedContact(db, { workspaceId }));
    ({ messageId } = await seedMessage(db, { workspaceId, campaignId, contactId, createdAt }));
  });

  it('kontakt bez jediné odeslané zprávy nemá řádek', async () => {
    expect(await db.selectContactEngagement(workspaceId, contactId)).toBeNull();
  });

  it('doručení založí řádek líně a zvýší consecutive_no_open o jedna', async () => {
    const id = await db.insertMessageEvent({ workspaceId, messageId, messageCreatedAt: createdAt, campaignId, contactId, type: 'delivered' });
    await handleProcessProviderEvents({ messageEventIds: [id] });
    const row = await db.selectContactEngagement(workspaceId, contactId);
    expect(row!.delivered_total).toBe(1);
    expect(row!.consecutive_no_open).toBe(1);
  });

  it('ověřené otevření nastaví consecutive_no_open na nulu', async () => {
    const delivered = await db.insertMessageEvent({ workspaceId, messageId, messageCreatedAt: createdAt, campaignId, contactId, type: 'delivered' });
    await handleProcessProviderEvents({ messageEventIds: [delivered] });
    await applyContactEngagementDelta({ workspaceId, contactId, opened: new Date(), clicked: null });
    expect((await db.selectContactEngagement(workspaceId, contactId))!.consecutive_no_open).toBe(0);
  });

  it('otevření dorazivší dřív než delivered nezpůsobí zvýšení po vynulování', async () => {
    await db.upsertMessageEngagement({ messageId, createdAt, workspaceId, campaignId, contactId, firstHumanOpenAt: new Date('2026-07-25T17:00:00Z') });
    await applyContactEngagementDelta({ workspaceId, contactId, opened: new Date('2026-07-25T17:00:00Z'), clicked: null });
    const delivered = await db.insertMessageEvent({ workspaceId, messageId, messageCreatedAt: createdAt, campaignId, contactId, type: 'delivered' });
    await handleProcessProviderEvents({ messageEventIds: [delivered] });
    expect((await db.selectContactEngagement(workspaceId, contactId))!.consecutive_no_open).toBe(0);
  });

  it('opens_total počítá jen ověřená otevření, kampaň jen s Apple ho nezvýší', async () => {
    await applyContactEngagementDelta({ workspaceId, contactId, opened: null, clicked: null, delivered: new Date() });
    expect((await db.selectContactEngagement(workspaceId, contactId))!.opens_total).toBe(0);
  });

  it('odmítnutí zvýší bounces_total a nastaví last_bounce_at', async () => {
    // Tvrdost nese typ, ne subtype. `type: 'bounce'` by ck_message_events__type
    // vůbec nepustil, takže by seed spadl a job by neměl co číst.
    const id = await db.insertMessageEvent({ workspaceId, messageId, messageCreatedAt: createdAt, campaignId, contactId, type: 'bounced_hard' });
    await handleProcessProviderEvents({ messageEventIds: [id] });
    const row = await db.selectContactEngagement(workspaceId, contactId);
    expect(row!.bounces_total).toBe(1);
    expect(row!.last_bounce_at).not.toBeNull();
  });

  it('tvrdý a měkký odraz i stížnost se promítnou do campaign_stats, ne do nuly', async () => {
    // Původní filtr hledal typy 'bounce' a 'complaint', které ve slovníku
    // neexistují. Nic nespadlo, jen se trvale nezapočítalo nic. Tenhle test
    // je jediné místo, kde by se to poznalo dřív než v reportu kampaně.
    const ids = await Promise.all([
      db.insertMessageEvent({ workspaceId, messageId, messageCreatedAt: createdAt, campaignId, contactId, type: 'bounced_hard' }),
      db.insertMessageEvent({ workspaceId, messageId, messageCreatedAt: createdAt, campaignId, contactId, type: 'bounced_soft' }),
      db.insertMessageEvent({ workspaceId, messageId, messageCreatedAt: createdAt, campaignId, contactId, type: 'complained' }),
    ]);
    await handleProcessProviderEvents({ messageEventIds: ids });
    const stats = await db.selectCampaignStats(campaignId);
    expect(stats.bounced_hard).toBe(1);
    expect(stats.bounced_soft).toBe(1);
    expect(stats.complained).toBe(1);
  });

  it('slovník typů v jobu je podmnožinou ck_message_events__type', async () => {
    // Ptá se BĚŽÍCÍ DATABÁZE, ne zdrojáku P03 a ne konstanty v tomhle plánu.
    // Kdyby se výčet v jobu rozešel se schématem, filtr by zase tiše nevracel
    // nic a čísla by zůstala nulová, aniž by cokoliv spadlo.
    //
    // conrelid je rodičovská tabulka: každý oddíl má vlastní kopii omezení
    // a bez toho filtru by dotaz vracel 37 řádků. Oddíl se přitom neadresuje
    // jménem, ptáme se rodiče.
    const { rows } = await db.query<{ ok: boolean; pocet: number }>(
      `SELECT $1::text[] <@ array_agg(m[1]) AS ok,
              array_length(array_agg(m[1]), 1) AS pocet
         FROM pg_constraint c,
              LATERAL regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') AS m
        WHERE c.conname = 'ck_message_events__type'
          AND c.conrelid = 'message_events'::regclass`,
      [['delivered', 'bounced_hard', 'bounced_soft', 'complained', 'unsubscribe']],
    );
    expect(rows[0]!.ok).toBe(true);
    // Kdyby se výčet ve schématu zúžil pod pět hodnot, dotaz by prošel
    // omylem na prázdném poli. Ověřeno spuštěním: schéma jich dnes má 12.
    expect(rows[0]!.pocet).toBeGreaterThanOrEqual(12);
  });

  it('doručení promítne do campaign_stats.delivered', async () => {
    const id = await db.insertMessageEvent({ workspaceId, messageId, messageCreatedAt: createdAt, campaignId, contactId, type: 'delivered' });
    await handleProcessProviderEvents({ messageEventIds: [id] });
    expect((await db.selectCampaignStats(campaignId)).delivered).toBe(1);
  });

  it('dvojí spuštění se stejnou dávkou nezmění čísla', async () => {
    const id = await db.insertMessageEvent({ workspaceId, messageId, messageCreatedAt: createdAt, campaignId, contactId, type: 'delivered' });
    await handleProcessProviderEvents({ messageEventIds: [id] });
    await handleProcessProviderEvents({ messageEventIds: [id] });
    expect((await db.selectCampaignStats(campaignId)).delivered).toBe(1);
  });

  it('kampaň s vypnutým měřením otevření consecutive_no_open nezvyšuje', async () => {
    await db.setCampaignTracking(campaignId, { trackOpens: false });
    const id = await db.insertMessageEvent({ workspaceId, messageId, messageCreatedAt: createdAt, campaignId, contactId, type: 'delivered' });
    await handleProcessProviderEvents({ messageEventIds: [id] });
    expect((await db.selectContactEngagement(workspaceId, contactId))!.consecutive_no_open).toBe(0);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/contact-engagement.db.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/repo/contact-engagement.repo"`.

- [ ] **Step 3: Napiš repository rollupu**

```ts
// packages/core/tracking/repo/contact-engagement.repo.ts
import { sql } from 'drizzle-orm';
import { withTrackingTx } from './tx';

export type ContactEngagementDelta = {
  workspaceId: string;
  contactId: string;
  /** Čas prvního ověřeného otevření zprávy, jinak null. */
  opened?: Date | null;
  /** Čas prvního lidského kliku na zprávu, jinak null. */
  clicked?: Date | null;
  delivered?: Date | null;
  bounced?: Date | null;
  /** Zvýšit čítače neotevření. Vypnuté u kampaně bez měření a u zprávy, která už otevření má. */
  incrementNoOpen?: boolean;
  incrementNoClick?: boolean;
};

/**
 * Řádek se zakládá líně, až při první události kontaktu.
 * Nulování má přednost před zvýšením a rozhoduje se podle stavu message_engagement,
 * ne podle pořadí zpracování: u Apple proxy dorazí otevření často dřív než delivered.
 */
export async function applyContactEngagementDelta(delta: ContactEngagementDelta): Promise<void> {
  const opened = delta.opened ?? null;
  const clicked = delta.clicked ?? null;
  const delivered = delta.delivered ?? null;
  const bounced = delta.bounced ?? null;

  await withTrackingTx(delta.workspaceId, 'tracking.process_provider_events', async (tx) => {
    await tx.execute(sql`
      INSERT INTO contact_engagement (
        workspace_id, contact_id,
        last_sent_at, last_delivered_at, last_open_at, last_click_at, last_bounce_at,
        sent_total, delivered_total, opens_total, clicks_total, bounces_total,
        consecutive_no_open, consecutive_no_click, updated_at)
      VALUES (
        ${delta.workspaceId}, ${delta.contactId},
        ${delivered}, ${delivered}, ${opened}, ${clicked}, ${bounced},
        ${delivered === null ? 0 : 1}, ${delivered === null ? 0 : 1},
        ${opened === null ? 0 : 1}, ${clicked === null ? 0 : 1}, ${bounced === null ? 0 : 1},
        ${delta.incrementNoOpen === true ? 1 : 0}, ${delta.incrementNoClick === true ? 1 : 0},
        now())
      ON CONFLICT (workspace_id, contact_id) DO UPDATE SET
        last_sent_at      = GREATEST(contact_engagement.last_sent_at, excluded.last_sent_at),
        last_delivered_at = GREATEST(contact_engagement.last_delivered_at, excluded.last_delivered_at),
        last_open_at      = GREATEST(contact_engagement.last_open_at, excluded.last_open_at),
        last_click_at     = GREATEST(contact_engagement.last_click_at, excluded.last_click_at),
        last_bounce_at    = GREATEST(contact_engagement.last_bounce_at, excluded.last_bounce_at),
        sent_total        = contact_engagement.sent_total + excluded.sent_total,
        delivered_total   = contact_engagement.delivered_total + excluded.delivered_total,
        opens_total       = contact_engagement.opens_total + excluded.opens_total,
        clicks_total      = contact_engagement.clicks_total + excluded.clicks_total,
        bounces_total     = contact_engagement.bounces_total + excluded.bounces_total,
        -- Nulování má přednost před zvýšením.
        consecutive_no_open = CASE WHEN excluded.last_open_at IS NOT NULL THEN 0
                                   ELSE contact_engagement.consecutive_no_open + excluded.consecutive_no_open END,
        consecutive_no_click = CASE WHEN excluded.last_click_at IS NOT NULL THEN 0
                                    ELSE contact_engagement.consecutive_no_click + excluded.consecutive_no_click END,
        updated_at = now()
    `);
  });
}

/** Zjistí, jestli zpráva už má ověřené otevření, aby se čítač nezvýšil po vynulování. */
export async function hasVerifiedOpen(
  workspaceId: string,
  messageId: string,
  createdAt: Date,
): Promise<boolean> {
  const rows = await withTrackingTx(workspaceId, 'tracking.process_provider_events', async (tx) =>
    (await tx.execute<{ present: boolean }>(sql`
      SELECT first_human_open_at IS NOT NULL AS present
        FROM message_engagement
       WHERE message_id = ${messageId} AND created_at = ${createdAt}
    `)).rows,
  );
  return rows[0]?.present ?? false;
}
```

- [ ] **Step 4: Napiš handler jobu**

```ts
// packages/core/tracking/jobs/process-provider-events.ts
import { sql } from 'drizzle-orm';
import { withCrossWorkspaceTx } from '../repo/tx';
import { applyContactEngagementDelta, hasVerifiedOpen } from '../repo/contact-engagement.repo';

export const PROCESS_PROVIDER_EVENTS_QUEUE = 'tracking.process_provider_events';

export type ProcessProviderEventsJobData = { messageEventIds: string[] };

type ProviderEventRow = {
  id: string;
  workspaceId: string;
  campaignId: string;
  contactId: string | null;
  messageId: string;
  messageCreatedAt: Date;
  ts: Date;
  type: string;
  subtype: string | null;
  trackOpens: boolean;
  trackClicks: boolean;
};

/**
 * Idempotence: přírůstky do campaign_stats se skládají z počtu skutečně
 * zpracovaných řádků, které si job označí. Dvojí běh druhý průchod nenajde.
 */
export async function handleProcessProviderEvents(
  data: ProcessProviderEventsJobData,
): Promise<void> {
  if (data.messageEventIds.length === 0) return;

  const rows = await withCrossWorkspaceTx('tracking.process_provider_events', async (tx) =>
    (await tx.execute<ProviderEventRow>(sql`
      SELECT e.id, e.workspace_id AS "workspaceId", e.campaign_id AS "campaignId",
             e.contact_id AS "contactId", e.message_id AS "messageId",
             e.message_created_at AS "messageCreatedAt", e.ts, e.type, e.subtype,
             c.track_opens AS "trackOpens", c.track_clicks AS "trackClicks"
        FROM message_events e
        JOIN campaigns c ON c.id = e.campaign_id
       WHERE e.id = ANY(${sql.param([...data.messageEventIds])}::uuid[])
         AND e.received_at >= now() - interval '2 days'
         AND e.processed_at IS NULL
         AND e.type IN ('delivered','bounced_hard','bounced_soft','complained','unsubscribe')
    `)).rows,
  );
  if (rows.length === 0) return;

  const counts = new Map<
    string,
    { workspaceId: string; delivered: number; bouncedHard: number; bouncedSoft: number; complained: number; unsubscribed: number }
  >();

  /**
   * Hodinové bloky pro graf průběhu. `delivered` a `bounced` do nich zapisuje
   * **jedině tenhle job**, protože jedině on ty události vidí. Bez toho by
   * sloupce zůstaly trvale nulové a graf průběhu kampaně by měl jen odeslání
   * a otevření, tedy polovinu.
   */
  const buckets = new Map<string, { campaignId: string; workspaceId: string; bucketAt: Date; delivered: number; bounced: number }>();
  const bucketOf = (campaignId: string, workspaceId: string, at: Date) => {
    const bucketAt = new Date(Date.UTC(
      at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate(), at.getUTCHours(),
    ));
    const key = `${campaignId}:${bucketAt.toISOString()}`;
    const found = buckets.get(key);
    if (found !== undefined) return found;
    const created = { campaignId, workspaceId, bucketAt, delivered: 0, bounced: 0 };
    buckets.set(key, created);
    return created;
  };

  for (const row of rows) {
    const entry = counts.get(row.campaignId) ?? {
      workspaceId: row.workspaceId, delivered: 0, bouncedHard: 0, bouncedSoft: 0,
      complained: 0, unsubscribed: 0,
    };
    // Tvrdost odrazu nese TYP události, ne subtype. Dřívější 'bounce'
    // a 'complaint' nejsou v ck_message_events__type vůbec, takže filtr
    // nevracel nic a čítače zůstávaly trvale nulové, aniž by cokoliv spadlo.
    if (row.type === 'delivered') {
      entry.delivered += 1;
      bucketOf(row.campaignId, row.workspaceId, row.ts).delivered += 1;
    }
    if (row.type === 'bounced_hard' || row.type === 'bounced_soft') {
      if (row.type === 'bounced_hard') entry.bouncedHard += 1;
      else entry.bouncedSoft += 1;
      bucketOf(row.campaignId, row.workspaceId, row.ts).bounced += 1;
    }
    if (row.type === 'complained') entry.complained += 1;
    if (row.type === 'unsubscribe') entry.unsubscribed += 1;
    counts.set(row.campaignId, entry);

    if (row.contactId === null) continue;

    if (row.type === 'delivered') {
      // Kampaň s vypnutým měřením se do "posledních N kampaní" nezapočítává.
      const countsTowardStreak = row.trackOpens && !(await hasVerifiedOpen(row.workspaceId, row.messageId, row.messageCreatedAt));
      await applyContactEngagementDelta({
        workspaceId: row.workspaceId,
        contactId: row.contactId,
        delivered: row.ts,
        incrementNoOpen: countsTowardStreak,
        incrementNoClick: row.trackClicks,
      });
    } else if (row.type === 'bounced_hard' || row.type === 'bounced_soft') {
      await applyContactEngagementDelta({
        workspaceId: row.workspaceId, contactId: row.contactId, bounced: row.ts,
      });
    }
  }

  await withCrossWorkspaceTx('tracking.process_provider_events', async (tx) => {
    for (const [campaignId, entry] of counts) {
      await tx.execute(sql`
        INSERT INTO campaign_stats (workspace_id, campaign_id, delivered, bounced_hard,
                                    bounced_soft, complained, unsubscribed, updated_at, version)
        VALUES (${entry.workspaceId}, ${campaignId}, ${entry.delivered}, ${entry.bouncedHard},
                ${entry.bouncedSoft}, ${entry.complained}, ${entry.unsubscribed}, now(), 1)
        ON CONFLICT (campaign_id) DO UPDATE SET
          delivered     = campaign_stats.delivered + excluded.delivered,
          bounced_hard  = campaign_stats.bounced_hard + excluded.bounced_hard,
          bounced_soft  = campaign_stats.bounced_soft + excluded.bounced_soft,
          complained    = campaign_stats.complained + excluded.complained,
          unsubscribed  = campaign_stats.unsubscribed + excluded.unsubscribed,
          updated_at    = now(),
          version       = campaign_stats.version + 1
      `);
    }
    // Hodinové bloky. `delivered` a `bounced` nemá kdo jiný zapsat, viz komentář
    // u mapy `buckets` výš. Bez ON CONFLICT DO UPDATE by druhý běh v téže hodině
    // přepsal přírůstek místo aby ho přičetl.
    for (const bucket of buckets.values()) {
      await tx.execute(sql`
        INSERT INTO campaign_stats_buckets (campaign_id, workspace_id, bucket_at, delivered, bounced)
        VALUES (${bucket.campaignId}, ${bucket.workspaceId}, ${bucket.bucketAt},
                ${bucket.delivered}, ${bucket.bounced})
        ON CONFLICT (campaign_id, bucket_at) DO UPDATE SET
          delivered = campaign_stats_buckets.delivered + excluded.delivered,
          bounced   = campaign_stats_buckets.bounced + excluded.bounced
      `);
    }

    await tx.execute(sql`
      UPDATE message_events SET processed_at = now()
       WHERE id = ANY(${sql.param(rows.map((r) => r.id))}::uuid[])
         AND received_at >= now() - interval '2 days'
    `);
  });
}
```

> **Sloupec `processed_at` v `message_events` vlastní část 4a.** Potřebuju ho jako značku idempotence a je to nový požadavek na P03 a P13. Se sloupcem musí přijít i rozšíření sloupcového grantu na `GRANT UPDATE (contact_id, erased_at, recipient, processed_at)`, jinak sloupec v tabulce bude a aplikace ho stejně nepřepíše: job by pak při každém běhu zpracoval tytéž události znovu a `campaign_stats.delivered` by rostlo donekonečna. Obojí je v sekci 2 a v evidenci nálezů. Náhradní řešení je vlastní tabulka `tracking_processed_events(message_event_id, message_event_received_at)`, kterou by vlastnil tenhle plán.

- [ ] **Step 5: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/contact-engagement.db.test.ts`
Expected: PASS, 11 testů.

- [ ] **Step 6: Commit**

```bash
git add packages/core/tracking/repo/contact-engagement.repo.ts packages/core/tracking/jobs/process-provider-events.ts packages/core/test/tracking/contact-engagement.db.test.ts
git commit -m "feat(tracking): maintain contact engagement rollup and provider event counters"
```

---

### Task 35: Přepočet klouzavých oken a rekonstrukce `[db]`

Okna 7, 30 a 90 dní **nejdou udržovat přičítáním**, protože hodnota klesá i tehdy, když se nic neděje: kontakt s pěti otevřeními před 91 dny musí mít `opens_90d = 0`, aniž přišla jakákoliv událost.

Částečný index `idx_contact_engagement__stale_windows` je tu klíčový: kontakt, který za 90 dní nedostal nic, má všechna okna na nule, do indexu nepatří a job se ho nedotkne.

**Nepřesnost, kterou to znamená a která musí být v UI vidět:** okna jsou aktuální k poslednímu nočnímu běhu, ne k této vteřině. Absolutní hodnoty (`last_open_at`, `consecutive_no_open`, `*_total`) jsou naopak vždy aktuální, protože se udržují přírůstkově.

**Files:**
- Create: `packages/core/tracking/jobs/recompute-windows.ts`
- Create: `packages/core/tracking/jobs/rebuild-engagement.ts`
- Test: `packages/core/test/tracking/recompute-windows.db.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/recompute-windows.db.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { withTestDatabase, seedCampaign, seedContact, seedMessage } from '@mlain/db/testing';
import { handleRecomputeWindows } from '../../tracking/jobs/recompute-windows';
import { rebuildContactEngagement } from '../../tracking/jobs/rebuild-engagement';

const db = withTestDatabase();

describe('recompute engagement windows', () => {
  let workspaceId: string;
  let contactId: string;
  let campaignId: string;

  beforeEach(async () => {
    await db.truncateTracking();
    ({ workspaceId, campaignId } = await seedCampaign(db));
    ({ contactId } = await seedContact(db, { workspaceId }));
  });

  it('kontakt s otevřením před 91 dny má po běhu opens_90d nula', async () => {
    const createdAt = new Date(Date.now() - 91 * 24 * 3600 * 1000);
    const { messageId } = await seedMessage(db, { workspaceId, campaignId, contactId, createdAt });
    await db.upsertMessageEngagement({ messageId, createdAt, workspaceId, campaignId, contactId, firstHumanOpenAt: createdAt });
    await db.setContactEngagementWindows(workspaceId, contactId, { opens_90d: 5, sent_90d: 5 });
    await handleRecomputeWindows({ batchSize: 5000, maxBatches: 200, now: new Date() });
    expect((await db.selectContactEngagement(workspaceId, contactId))!.opens_90d).toBe(0);
  });

  it('kontakt s otevřením před 10 dny má opens_7d nula a opens_30d jedna', async () => {
    const createdAt = new Date(Date.now() - 10 * 24 * 3600 * 1000);
    const { messageId } = await seedMessage(db, { workspaceId, campaignId, contactId, createdAt });
    await db.upsertMessageEngagement({ messageId, createdAt, workspaceId, campaignId, contactId, firstHumanOpenAt: createdAt });
    await db.setContactEngagementWindows(workspaceId, contactId, { opens_90d: 1, sent_90d: 1 });
    await handleRecomputeWindows({ batchSize: 5000, maxBatches: 200, now: new Date() });
    const row = await db.selectContactEngagement(workspaceId, contactId);
    expect(row!.opens_7d).toBe(0);
    expect(row!.opens_30d).toBe(1);
    expect(row!.opens_90d).toBe(1);
  });

  it('kontakt se všemi okny na nule se nepřepočítává', async () => {
    await db.setContactEngagementWindows(workspaceId, contactId, { opens_90d: 0, sent_90d: 0, clicks_90d: 0 });
    const before = (await db.selectContactEngagement(workspaceId, contactId))!.windows_recomputed_at;
    await handleRecomputeWindows({ batchSize: 5000, maxBatches: 200, now: new Date() });
    expect((await db.selectContactEngagement(workspaceId, contactId))!.windows_recomputed_at).toEqual(before);
  });

  it('opakovaný běh dá tentýž výsledek, přepočet je čistá funkce zdrojových dat', async () => {
    const createdAt = new Date(Date.now() - 10 * 24 * 3600 * 1000);
    const { messageId } = await seedMessage(db, { workspaceId, campaignId, contactId, createdAt });
    await db.upsertMessageEngagement({ messageId, createdAt, workspaceId, campaignId, contactId, firstHumanOpenAt: createdAt });
    await db.setContactEngagementWindows(workspaceId, contactId, { opens_90d: 1, sent_90d: 1 });
    await handleRecomputeWindows({ batchSize: 5000, maxBatches: 200, now: new Date() });
    const first = await db.selectContactEngagement(workspaceId, contactId);
    await db.setContactEngagementWindows(workspaceId, contactId, { windows_recomputed_at: new Date(0) });
    await handleRecomputeWindows({ batchSize: 5000, maxBatches: 200, now: new Date() });
    const second = await db.selectContactEngagement(workspaceId, contactId);
    expect(second!.opens_30d).toBe(first!.opens_30d);
  });

  it('rebuild přepočítá tabulku od nuly a shodne se se stavem udržovaným přírůstkově', async () => {
    const createdAt = new Date(Date.now() - 5 * 24 * 3600 * 1000);
    const { messageId } = await seedMessage(db, { workspaceId, campaignId, contactId, createdAt });
    await db.upsertMessageEngagement({ messageId, createdAt, workspaceId, campaignId, contactId, firstHumanOpenAt: createdAt });
    await handleRecomputeWindows({ batchSize: 5000, maxBatches: 200, now: new Date() });
    const incremental = await db.selectContactEngagement(workspaceId, contactId);
    await rebuildContactEngagement({ workspaceId, batchSize: 1000 });
    const rebuilt = await db.selectContactEngagement(workspaceId, contactId);
    expect(rebuilt!.opens_total).toBe(incremental!.opens_total);
    expect(rebuilt!.last_open_at).toEqual(incremental!.last_open_at);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/recompute-windows.db.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/jobs/recompute-windows"`.

- [ ] **Step 3: Napiš přepočet oken**

```ts
// packages/core/tracking/jobs/recompute-windows.ts
import { sql } from 'drizzle-orm';
import { withCrossWorkspaceTx } from '../repo/tx';

export const RECOMPUTE_WINDOWS_QUEUE = 'tracking.recompute_engagement_windows';

export type RecomputeWindowsJobData = {
  batchSize?: number;
  maxBatches?: number;
  now?: Date;
};

const DEFAULT_BATCH_SIZE = 5000;
const DEFAULT_MAX_BATCHES = 200;
/** Práh čerstvosti, aby denní běh nepřeskočil kontakt kvůli posunu času startu. */
const FRESHNESS_HOURS = 20;

/**
 * Přepočet je čistá funkce zdrojových dat, takže opakování dá tentýž výsledek.
 * Tím je job idempotentní bez jakékoliv další značky.
 */
export async function handleRecomputeWindows(data: RecomputeWindowsJobData = {}): Promise<void> {
  const batchSize = data.batchSize ?? DEFAULT_BATCH_SIZE;
  const maxBatches = data.maxBatches ?? DEFAULT_MAX_BATCHES;

  for (let batch = 0; batch < maxBatches; batch += 1) {
    const updated = await withCrossWorkspaceTx('tracking.recompute_engagement_windows', async (tx) =>
      (await tx.execute<{ contactId: string }>(sql`
        WITH candidates AS (
          SELECT workspace_id, contact_id
            FROM contact_engagement
           WHERE windows_recomputed_at < now() - interval '${sql.raw(String(FRESHNESS_HOURS))} hours'
             AND (sent_90d > 0 OR opens_90d > 0 OR clicks_90d > 0)
           ORDER BY windows_recomputed_at
           LIMIT ${batchSize}
        ),
        windows AS (
          SELECT c.workspace_id, c.contact_id,
                 count(*) FILTER (WHERE m.created_at >= now() - interval '7 days')  AS sent_7d,
                 count(*) FILTER (WHERE m.created_at >= now() - interval '30 days') AS sent_30d,
                 count(*) FILTER (WHERE m.created_at >= now() - interval '90 days') AS sent_90d,
                 count(*) FILTER (WHERE m.first_human_open_at >= now() - interval '7 days')  AS opens_7d,
                 count(*) FILTER (WHERE m.first_human_open_at >= now() - interval '30 days') AS opens_30d,
                 count(*) FILTER (WHERE m.first_human_open_at >= now() - interval '90 days') AS opens_90d,
                 count(*) FILTER (WHERE m.first_human_click_at >= now() - interval '7 days')  AS clicks_7d,
                 count(*) FILTER (WHERE m.first_human_click_at >= now() - interval '30 days') AS clicks_30d,
                 count(*) FILTER (WHERE m.first_human_click_at >= now() - interval '90 days') AS clicks_90d
            FROM candidates c
            LEFT JOIN message_engagement m
              ON m.workspace_id = c.workspace_id
             AND m.contact_id = c.contact_id
             AND m.created_at >= now() - interval '90 days'   -- prořezání partition
           GROUP BY c.workspace_id, c.contact_id
        )
        UPDATE contact_engagement ce
           SET sent_7d = w.sent_7d, sent_30d = w.sent_30d, sent_90d = w.sent_90d,
               opens_7d = w.opens_7d, opens_30d = w.opens_30d, opens_90d = w.opens_90d,
               clicks_7d = w.clicks_7d, clicks_30d = w.clicks_30d, clicks_90d = w.clicks_90d,
               windows_recomputed_at = now()
          FROM windows w
         WHERE ce.workspace_id = w.workspace_id AND ce.contact_id = w.contact_id
        RETURNING ce.contact_id AS "contactId"
      `)).rows,
    );
    if (updated.length === 0) return;
  }
}
```

- [ ] **Step 4: Napiš rekonstrukci**

```ts
// packages/core/tracking/jobs/rebuild-engagement.ts
import { sql } from 'drizzle-orm';
import { withTrackingTx } from '../repo/tx';

export const REBUILD_ENGAGEMENT_QUEUE = 'tracking.rebuild_engagement';

export type RebuildEngagementInput = { workspaceId: string; batchSize?: number };

/**
 * Zdrojem pravdy je message_engagement. Používá se po havárii, po obnově zálohy
 * nebo když se čísla rozejdou. Píše jen do contact_engagement, takže provoz nezastavuje.
 */
export async function rebuildContactEngagement(input: RebuildEngagementInput): Promise<number> {
  const batchSize = input.batchSize ?? 5000;
  let processed = 0;

  for (;;) {
    const rows = await withTrackingTx(input.workspaceId, 'tracking.rebuild_engagement', async (tx) =>
      (await tx.execute<{ contactId: string }>(sql`
        WITH source AS (
          SELECT m.workspace_id, m.contact_id,
                 max(m.created_at)           AS last_sent_at,
                 max(m.first_human_open_at)  AS last_open_at,
                 max(m.first_human_click_at) AS last_click_at,
                 count(*)                                                  AS sent_total,
                 count(*) FILTER (WHERE m.first_human_open_at IS NOT NULL) AS opens_total,
                 count(*) FILTER (WHERE m.first_human_click_at IS NOT NULL) AS clicks_total
            FROM message_engagement m
           WHERE m.workspace_id = ${input.workspaceId}
             AND m.contact_id IS NOT NULL
             AND m.contact_id > COALESCE(
                   (SELECT max(contact_id) FROM contact_engagement
                     WHERE workspace_id = ${input.workspaceId}
                       AND windows_recomputed_at = 'epoch'::timestamptz), '00000000-0000-0000-0000-000000000000'::uuid)
           GROUP BY m.workspace_id, m.contact_id
           ORDER BY m.contact_id
           LIMIT ${batchSize}
        )
        INSERT INTO contact_engagement (
          workspace_id, contact_id, last_sent_at, last_open_at, last_click_at,
          sent_total, opens_total, clicks_total, windows_recomputed_at, updated_at)
        SELECT workspace_id, contact_id, last_sent_at, last_open_at, last_click_at,
               sent_total, opens_total, clicks_total, 'epoch'::timestamptz, now()
          FROM source
        ON CONFLICT (workspace_id, contact_id) DO UPDATE SET
          last_sent_at  = excluded.last_sent_at,
          last_open_at  = excluded.last_open_at,
          last_click_at = excluded.last_click_at,
          sent_total    = excluded.sent_total,
          opens_total   = excluded.opens_total,
          clicks_total  = excluded.clicks_total,
          windows_recomputed_at = 'epoch'::timestamptz,
          updated_at    = now()
        RETURNING contact_id AS "contactId"
      `)).rows,
    );
    if (rows.length === 0) break;
    processed += rows.length;
  }

  return processed;
}

export async function handleRebuildEngagement(data: RebuildEngagementInput): Promise<void> {
  await rebuildContactEngagement(data);
}
```

> **Napojení na CLI `mlain rebuild-engagement` je jeden řádek v souboru, který nevlastním.** Logika je tady a je spustitelná jako job. Registrace podpříkazu patří do kostry CLI, kterou vlastní P01, a je v seznamu integračních bodů.

- [ ] **Step 5: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/recompute-windows.db.test.ts`
Expected: PASS, 5 testů.

- [ ] **Step 6: Commit**

```bash
git add packages/core/tracking/jobs/recompute-windows.ts packages/core/tracking/jobs/rebuild-engagement.ts packages/core/test/tracking/recompute-windows.db.test.ts
git commit -m "feat(tracking): recompute rolling engagement windows nightly and rebuild on demand"
```

---

### Task 36: Průběh odesílání se čte z `messages`, ne z událostí `[db]`

Sender **nezapisuje** do `message_events` typ `sent` ani `failed`. Byl by to jeden `INSERT` navíc na každou odeslanou zprávu, tedy dva miliony zápisů místo jednoho u milionové kampaně, a stav přitom už je na řádku `messages`.

Job je **idempotentní tím, že poslední dva pětiminutové bloky přepisuje celou hodnotou**, ne přičtením. Kdyby se přičítalo, dvojí běh po pádu by čísla nafoukl. Odečet deseti minut pokrývá zprávy, které dorazily do už zapsaného bloku, protože sender běží ve víc instancích a `sent_at` mezi nimi není striktně monotónní.

**Files:**
- Create: `packages/core/tracking/jobs/refresh-campaign-progress.ts`
- Test: `packages/core/test/tracking/refresh-progress.db.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/refresh-progress.db.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { withTestDatabase, seedCampaign, seedMessage } from '@mlain/db/testing';
import { handleRefreshCampaignProgress } from '../../tracking/jobs/refresh-campaign-progress';

const db = withTestDatabase();

describe('tracking.refresh_campaign_progress', () => {
  let workspaceId: string;
  let campaignId: string;
  const createdAt = new Date('2026-07-25T16:00:00.000Z');

  beforeEach(async () => {
    await db.truncateTracking();
    ({ workspaceId, campaignId } = await seedCampaign(db, { audienceBuiltAt: createdAt, status: 'sending' }));
  });

  it('spočítá odeslané a selhané z messages bez jediného řádku typu sent v message_events', async () => {
    await seedMessage(db, { workspaceId, campaignId, createdAt, status: 'sent', sentAt: new Date('2026-07-25T16:01:00Z') });
    await seedMessage(db, { workspaceId, campaignId, createdAt, status: 'sent', sentAt: new Date('2026-07-25T16:02:00Z') });
    await seedMessage(db, { workspaceId, campaignId, createdAt, status: 'failed', sentAt: new Date('2026-07-25T16:03:00Z') });
    await handleRefreshCampaignProgress({ campaignId });
    const stats = await db.selectCampaignStats(campaignId);
    expect(stats.sent).toBe(2);
    expect(stats.failed).toBe(1);
    expect(await db.countMessageEventsByType(workspaceId, 'sent')).toBe(0);
  });

  it('naplní pětiminutové bloky', async () => {
    await seedMessage(db, { workspaceId, campaignId, createdAt, status: 'sent', sentAt: new Date('2026-07-25T16:07:00Z') });
    await handleRefreshCampaignProgress({ campaignId });
    expect((await db.selectBucket(campaignId, new Date('2026-07-25T16:05:00Z'))).sent).toBe(1);
  });

  it('dvojí spuštění se stejným vodoznakem nezmění bloky', async () => {
    await seedMessage(db, { workspaceId, campaignId, createdAt, status: 'sent', sentAt: new Date('2026-07-25T16:07:00Z') });
    await handleRefreshCampaignProgress({ campaignId });
    await handleRefreshCampaignProgress({ campaignId });
    expect((await db.selectBucket(campaignId, new Date('2026-07-25T16:05:00Z'))).sent).toBe(1);
    expect((await db.selectCampaignStats(campaignId)).sent).toBe(1);
  });

  it('posune vodoznak na nejvyšší zpracované sent_at', async () => {
    await seedMessage(db, { workspaceId, campaignId, createdAt, status: 'sent', sentAt: new Date('2026-07-25T16:09:00Z') });
    await handleRefreshCampaignProgress({ campaignId });
    expect((await db.selectCampaignStats(campaignId)).progress_watermark_at)
      .toEqual(new Date('2026-07-25T16:09:00Z'));
  });

  it('kampaň pozastavená na týden a obnovená dorovná průběh', async () => {
    await seedMessage(db, { workspaceId, campaignId, createdAt, status: 'sent', sentAt: new Date('2026-07-25T16:01:00Z') });
    await handleRefreshCampaignProgress({ campaignId });
    await seedMessage(db, { workspaceId, campaignId, createdAt, status: 'sent', sentAt: new Date('2026-08-01T10:00:00Z') });
    await handleRefreshCampaignProgress({ campaignId });
    expect((await db.selectCampaignStats(campaignId)).sent).toBe(2);
  });

  it('dotaz drží podmínku na created_at, takže se prořízne jedna partition', async () => {
    const plan = await db.explain(
      `SELECT count(*) FROM messages WHERE campaign_id = $1 AND created_at = $2 AND sent_at >= $3`,
      [campaignId, createdAt, createdAt],
    );
    expect(plan).not.toContain('Seq Scan');
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/refresh-progress.db.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/jobs/refresh-campaign-progress"`.

- [ ] **Step 3: Napiš handler**

```ts
// packages/core/tracking/jobs/refresh-campaign-progress.ts
import { sql } from 'drizzle-orm';
import { withCrossWorkspaceTx } from '../repo/tx';

export const REFRESH_CAMPAIGN_PROGRESS_QUEUE = 'tracking.refresh_campaign_progress';

export type RefreshCampaignProgressJobData = { campaignId: string };

/** Vodoznak minus dva bloky. Sender běží ve víc instancích, sent_at není monotónní. */
const WATERMARK_LOOKBACK_MINUTES = 10;

export async function handleRefreshCampaignProgress(
  data: RefreshCampaignProgressJobData,
): Promise<void> {
  await withCrossWorkspaceTx('tracking.refresh_campaign_progress', async (tx) => {
    const { rows: campaigns } = await tx.execute<{
      workspaceId: string;
      audienceBuiltAt: Date;
      watermark: Date | null;
    }>(sql`
      SELECT c.workspace_id AS "workspaceId", c.audience_built_at AS "audienceBuiltAt",
             s.progress_watermark_at AS "watermark"
        FROM campaigns c
        LEFT JOIN campaign_stats s ON s.campaign_id = c.id
       WHERE c.id = ${data.campaignId}
    `);
    const campaign = campaigns[0];
    if (campaign === undefined || campaign.audienceBuiltAt === null) return;

    const since = campaign.watermark ?? campaign.audienceBuiltAt;

    const { rows: buckets } = await tx.execute<{
      bucket: Date;
      sent: string;
      failed: string;
      watermark: Date | null;
    }>(sql`
      SELECT to_timestamp(floor(extract(epoch FROM sent_at) / 300) * 300) AS bucket,
             count(*) FILTER (WHERE status = 'sent')   AS sent,
             count(*) FILTER (WHERE status = 'failed') AS failed,
             max(sent_at) AS watermark
        FROM messages
       WHERE campaign_id = ${data.campaignId}
         AND created_at = ${campaign.audienceBuiltAt}
         AND sent_at IS NOT NULL
         AND sent_at >= ${since}::timestamptz - interval '${sql.raw(String(WATERMARK_LOOKBACK_MINUTES))} minutes'
       GROUP BY bucket
    `);

    // Bloky se přepisují celou hodnotou, ne přičtením. Tím je job idempotentní.
    for (const row of buckets) {
      await tx.execute(sql`
        INSERT INTO campaign_stats_buckets (campaign_id, workspace_id, bucket_at, sent)
        VALUES (${data.campaignId}, ${campaign.workspaceId}, ${row.bucket}, ${Number(row.sent)})
        ON CONFLICT (campaign_id, bucket_at) DO UPDATE SET sent = excluded.sent
      `);
    }

    const { rows: totals } = await tx.execute<{ sent: string; failed: string; watermark: Date | null }>(sql`
      SELECT count(*) FILTER (WHERE status = 'sent')   AS sent,
             count(*) FILTER (WHERE status = 'failed') AS failed,
             max(sent_at) AS watermark
        FROM messages
       WHERE campaign_id = ${data.campaignId}
         AND created_at = ${campaign.audienceBuiltAt}
    `);
    const total = totals[0]!;

    await tx.execute(sql`
      INSERT INTO campaign_stats (workspace_id, campaign_id, sent, failed, progress_watermark_at, updated_at, version)
      VALUES (${campaign.workspaceId}, ${data.campaignId}, ${Number(total.sent)},
              ${Number(total.failed)}, ${total.watermark}, now(), 1)
      ON CONFLICT (campaign_id) DO UPDATE SET
        sent = excluded.sent,
        failed = excluded.failed,
        progress_watermark_at = GREATEST(campaign_stats.progress_watermark_at, excluded.progress_watermark_at),
        updated_at = now(),
        version = campaign_stats.version + 1
    `);
  });
}
```

- [ ] **Step 4: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/refresh-progress.db.test.ts`
Expected: PASS, 6 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/tracking/jobs/refresh-campaign-progress.ts packages/core/test/tracking/refresh-progress.db.test.ts
git commit -m "feat(tracking): read sending progress from outbox instead of events"
```

---

### Task 37: Úklidové joby a registrace všech front `[db]`

Tři joby údržby a jeden soubor, který všechny handlery připojí k pg-boss. Registrace je součástí tohohle plánu, ale **entrypoint workeru vlastní P01** a zavolá jednu funkci.

Stažení Apple seznamu je ve výchozím stavu vypnuté. Když se zapne, selhání stažení **není chyba**: použije se poslední známý stav a zaloguje se varování. Když stahování selhává déle než sedm dní, zobrazí se administrátorovi upozornění.

**Files:**
- Create: `packages/core/tracking/jobs/cleanup-token-uses.ts`
- Create: `packages/core/tracking/jobs/enforce-retention.ts`
- Create: `packages/core/tracking/jobs/refresh-proxy-ranges.ts`
- Create: `packages/core/tracking/jobs/index.ts`
- Test: `packages/core/test/tracking/maintenance.db.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/maintenance.db.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withTestDatabase } from '@mlain/db/testing';
import { handleCleanupTokenUses } from '../../tracking/jobs/cleanup-token-uses';
import { handleEnforceRetention } from '../../tracking/jobs/enforce-retention';
import { handleRefreshProxyRanges } from '../../tracking/jobs/refresh-proxy-ranges';
import { TRACKING_QUEUES, registerTrackingJobs } from '../../tracking/jobs';

const db = withTestDatabase();

describe('maintenance jobs', () => {
  beforeEach(async () => {
    await db.truncateTracking();
  });

  it('cleanup smaže vypršelé nonce a ponechá platné', async () => {
    await db.insertTokenUse(Buffer.from('0011223344556677', 'hex'), new Date(Date.now() - 60_000));
    await db.insertTokenUse(Buffer.from('8899aabbccddeeff', 'hex'), new Date(Date.now() + 600_000));
    await handleCleanupTokenUses();
    expect(await db.countTokenUses()).toBe(1);
  });

  it('cleanup je idempotentní, druhý běh nic nezmění', async () => {
    await handleCleanupTokenUses();
    await handleCleanupTokenUses();
    expect(await db.countTokenUses()).toBe(0);
  });

  it('retence smaže anonymní identity bez vazby starší než 400 dní', async () => {
    await db.insertIdentity('ws', 'anon-old', null, new Date(Date.now() - 401 * 24 * 3600 * 1000));
    await db.insertIdentity('ws', 'anon-new', null, new Date());
    await handleEnforceRetention({ retentionMonths: 37, anonymousIdentitiesDays: 400 });
    expect(await db.countIdentities('ws')).toBe(1);
  });

  it('retence nesmaže identitu navázanou na kontakt, i když je stará', async () => {
    const { workspaceId, contactId } = await db.seedContactRow();
    await db.insertIdentity(workspaceId, 'anon-bound', contactId, new Date(Date.now() - 401 * 24 * 3600 * 1000));
    await handleEnforceRetention({ retentionMonths: 37, anonymousIdentitiesDays: 400 });
    expect(await db.countIdentities(workspaceId)).toBe(1);
  });

  it('refresh proxy rozsahů se při vypnutém přepínači nespustí', async () => {
    const fetchCsv = vi.fn();
    await handleRefreshProxyRanges({ enabled: false }, { fetchCsv });
    expect(fetchCsv).not.toHaveBeenCalled();
  });

  it('selhání stažení není chyba, jen se zaloguje a použije poslední stav', async () => {
    await db.insertProxyRange('apple_private_relay', '172.224.226.0/27');
    const fetchCsv = vi.fn(async () => { throw new Error('nedostupné'); });
    await expect(handleRefreshProxyRanges({ enabled: true }, { fetchCsv })).resolves.toBeUndefined();
    expect(await db.countProxyRanges('apple_private_relay')).toBe(1);
  });

  it('úspěšné stažení nahradí jen stažené rozsahy a nesahá na ručně vložené', async () => {
    await db.insertProxyRange('manual', '203.0.113.0/24');
    await db.insertProxyRange('apple_private_relay', '10.0.0.0/8');
    const fetchCsv = vi.fn(async () => '172.224.226.0/27,GB,GB-EN,London,\n');
    await handleRefreshProxyRanges({ enabled: true }, { fetchCsv });
    expect(await db.countProxyRanges('manual')).toBe(1);
    expect(await db.selectProxyRanges('apple_private_relay')).toEqual(['172.224.226.0/27']);
  });

  it('registr front obsahuje všech deset jmen ve tvaru domena.akce', () => {
    expect(TRACKING_QUEUES).toHaveLength(10);
    for (const queue of TRACKING_QUEUES) {
      expect(queue.name).toMatch(/^(tracking|identity|event)\.[a-z_]+$/);
      expect(queue.retryLimit).toBeGreaterThanOrEqual(0);
      expect(queue.expireInSeconds).toBeGreaterThan(0);
    }
  });

  it('registrace připojí handler ke každé frontě', async () => {
    const boss = { createQueue: vi.fn(async () => {}), work: vi.fn(async () => {}), schedule: vi.fn(async () => {}) };
    await registerTrackingJobs(boss as never);
    expect(boss.createQueue).toHaveBeenCalledTimes(TRACKING_QUEUES.length);
    expect(boss.work).toHaveBeenCalledTimes(TRACKING_QUEUES.length);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/maintenance.db.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/jobs/cleanup-token-uses"`.

- [ ] **Step 3: Napiš úklid nonce**

```ts
// packages/core/tracking/jobs/cleanup-token-uses.ts
import { sql } from 'drizzle-orm';
import { withCrossWorkspaceTx } from '../repo/tx';

export const CLEANUP_TOKEN_USES_QUEUE = 'tracking.cleanup_token_uses';

/**
 * Běží hodinově. Při 100 000 kliků za hodinu má tabulka nejvýš 25 000 řádků,
 * protože token platí 15 minut. Idempotence: DELETE WHERE expires_at < now().
 */
export async function handleCleanupTokenUses(): Promise<void> {
  await withCrossWorkspaceTx('tracking.cleanup_token_uses', async (tx) => {
    await tx.execute(sql`DELETE FROM identity_token_uses WHERE expires_at < now()`);
  });
}
```

- [ ] **Step 4: Napiš retenci**

```ts
// packages/core/tracking/jobs/enforce-retention.ts
import { sql } from 'drizzle-orm';
import { withCrossWorkspaceTx } from '../repo/tx';

export const ENFORCE_RETENTION_QUEUE = 'tracking.enforce_retention';

export type EnforceRetentionJobData = {
  retentionMonths: number;
  /** Odpovídá životnosti cookie. Prohlížeč, který se rok neozval, nemá smysl držet. */
  anonymousIdentitiesDays: number;
};

/**
 * Běží denně ve 03:45 UTC, po platform.maintain_partitions a před přepočtem oken.
 * Odpojení a smazání starých oddílů web_events dělá retenční mechanismus části 1,
 * tenhle job uklízí jen nepartitionované doprovodné tabulky.
 */
export async function handleEnforceRetention(data: EnforceRetentionJobData): Promise<void> {
  const months = data.retentionMonths;
  const days = data.anonymousIdentitiesDays;

  await withCrossWorkspaceTx('tracking.enforce_retention', async (tx) => {
    // 1. anonymní identity bez vazby na kontakt
    await tx.execute(sql`
      DELETE FROM identities
       WHERE contact_id IS NULL
         AND last_seen < now() - interval '${sql.raw(String(days))} days'
    `);

    // 2. historie vazeb starší než retence událostí
    await tx.execute(sql`
      DELETE FROM identity_bindings
       WHERE created_at < now() - interval '${sql.raw(String(months))} months'
    `);

    // 3. mapa měsíců, které už nemají oddíl
    await tx.execute(sql`
      DELETE FROM web_event_months
       WHERE month < date_trunc('month', now() - interval '${sql.raw(String(months))} months')::date
    `);

    // 4. dokončená slučování starší než rok
    await tx.execute(sql`
      DELETE FROM identity_merges
       WHERE status = 'completed' AND created_at < now() - interval '12 months'
    `);

    // 5. pětiminutové bloky starší než 30 dní se slijí do hodinových
    await tx.execute(sql`
      WITH hourly AS (
        SELECT campaign_id, workspace_id, date_trunc('hour', bucket_at) AS bucket_at,
               sum(sent) AS sent, sum(delivered) AS delivered,
               sum(opens_unique) AS opens_unique, sum(clicks_unique) AS clicks_unique,
               sum(bounced) AS bounced
          FROM campaign_stats_buckets
         WHERE bucket_at < now() - interval '30 days'
           AND bucket_at <> date_trunc('hour', bucket_at)
         GROUP BY campaign_id, workspace_id, date_trunc('hour', bucket_at)
      ), removed AS (
        DELETE FROM campaign_stats_buckets
         WHERE bucket_at < now() - interval '30 days'
           AND bucket_at <> date_trunc('hour', bucket_at)
        RETURNING 1
      )
      INSERT INTO campaign_stats_buckets (campaign_id, workspace_id, bucket_at, sent, delivered, opens_unique, clicks_unique, bounced)
      SELECT campaign_id, workspace_id, bucket_at, sent, delivered, opens_unique, clicks_unique, bounced
        FROM hourly
      ON CONFLICT (campaign_id, bucket_at) DO UPDATE SET
        sent = campaign_stats_buckets.sent + excluded.sent,
        delivered = campaign_stats_buckets.delivered + excluded.delivered,
        opens_unique = campaign_stats_buckets.opens_unique + excluded.opens_unique,
        clicks_unique = campaign_stats_buckets.clicks_unique + excluded.clicks_unique,
        bounced = campaign_stats_buckets.bounced + excluded.bounced
    `);

    // 6. Úklid osiřelých rollupů tady schválně NENÍ.
    //
    // Dřív tu byl `DELETE FROM contact_engagement ce WHERE NOT EXISTS
    // (SELECT 1 FROM contacts c WHERE c.id = ce.contact_id)`. Ten dotaz
    // nic neřeší a umí uškodit:
    //
    //  1. `contact_engagement.contact_id` má `ON DELETE CASCADE`, takže
    //     osiřelý rollup nemůže vzniknout. Nemá tedy co uklízet.
    //  2. Job běží napříč projekty a co uvidí v `contacts`, určuje RLS.
    //     Pod rolí, která `contacts` vidí jen částečně, by `NOT EXISTS`
    //     platilo i pro **živé** kontakty a smazalo by jim rollupy.
    //     Nespadlo by to a chyběla by data v segmentaci podle engagementu.
    //
    // Kdyby se osiřelý rollup přesto objevil, je to porušení cizího klíče
    // a patří to do `mlain doctor`, ne do noční retence.
  });
}
```

- [ ] **Step 5: Napiš obnovu rozsahů proxy**

```ts
// packages/core/tracking/jobs/refresh-proxy-ranges.ts
import { sql } from 'drizzle-orm';
import { withCrossWorkspaceTx } from '../repo/tx';
import { logger } from '@mlain/core/logging';
import { ProxyRangeIndex } from '../open/proxy-ranges';

export const REFRESH_PROXY_RANGES_QUEUE = 'tracking.refresh_proxy_ranges';

const APPLE_EGRESS_URL = 'https://mask-api.icloud.com/egress-ip-ranges.csv';

export type RefreshProxyRangesJobData = { enabled: boolean };
export type RefreshProxyRangesDeps = { fetchCsv?: () => Promise<string> };

/**
 * Ve výchozím stavu se nic nestahuje. Tabulka se plní jen ručně vloženými rozsahy
 * a pevným 17.0.0.0/8, který je v ProxyRangeIndex a v databázi být nemusí.
 * Selhání stažení není chyba: použije se poslední známý stav.
 */
export async function handleRefreshProxyRanges(
  data: RefreshProxyRangesJobData,
  deps: RefreshProxyRangesDeps = {},
): Promise<void> {
  if (!data.enabled) return;

  const fetchCsv =
    deps.fetchCsv ??
    (async () => {
      const response = await fetch(APPLE_EGRESS_URL, { signal: AbortSignal.timeout(60_000) });
      if (!response.ok) throw new Error(`Apple egress ranges: HTTP ${response.status}`);
      return response.text();
    });

  let cidrs: string[];
  try {
    cidrs = ProxyRangeIndex.parseAppleCsv(await fetchCsv());
  } catch (error) {
    logger.warn({ err: error }, 'tracking_proxy_ranges_refresh_failed');
    return;
  }
  if (cidrs.length === 0) {
    logger.warn('tracking_proxy_ranges_empty_response');
    return;
  }

  await withCrossWorkspaceTx('tracking.refresh_proxy_ranges', async (tx) => {
    // Nahrazují se jen stažené rozsahy. Ručně vložené zůstávají nedotčené.
    await tx.execute(sql`DELETE FROM proxy_ranges WHERE provider = 'apple_private_relay'`);
    await tx.execute(sql`
      INSERT INTO proxy_ranges (provider, cidr)
      SELECT 'apple_private_relay', unnest(${cidrs}::cidr[])
    `);
  });
}
```

- [ ] **Step 6: Napiš registraci front**

```ts
// packages/core/tracking/jobs/index.ts
import type PgBoss from 'pg-boss';
import { trackingConfig } from '../config';
import { handleCleanupTokenUses, CLEANUP_TOKEN_USES_QUEUE } from './cleanup-token-uses';
import { handleEnforceRetention, ENFORCE_RETENTION_QUEUE } from './enforce-retention';
import { handleEventProcess, EVENT_PROCESS_QUEUE, type EventProcessJobData } from './event-process';
import { handleIdentityMerge, IDENTITY_MERGE_QUEUE, type IdentityMergeJobData } from './identity-merge';
import { handleProcessEngagement, PROCESS_ENGAGEMENT_QUEUE, type ProcessEngagementJobData } from './process-engagement';
import { handleProcessProviderEvents, PROCESS_PROVIDER_EVENTS_QUEUE, type ProcessProviderEventsJobData } from './process-provider-events';
import { handleRebuildEngagement, REBUILD_ENGAGEMENT_QUEUE, type RebuildEngagementInput } from './rebuild-engagement';
import { handleRecomputeWindows, RECOMPUTE_WINDOWS_QUEUE } from './recompute-windows';
import { handleRefreshCampaignProgress, REFRESH_CAMPAIGN_PROGRESS_QUEUE, type RefreshCampaignProgressJobData } from './refresh-campaign-progress';
import { handleRefreshProxyRanges, REFRESH_PROXY_RANGES_QUEUE } from './refresh-proxy-ranges';
import { emitWebhook, enqueue } from '@mlain/core/jobs';

export type TrackingQueueSpec = {
  name: string;
  retryLimit: number;
  expireInSeconds: number;
  concurrency: number;
  /** Cron podle konvence pg-boss. Prázdné znamená frontu bez plánu. */
  cron?: string;
};

/** retryLimit a expireInSeconds jsou explicitní u každé fronty, výchozí hodnoty se nepoužívají. */
export const TRACKING_QUEUES: readonly TrackingQueueSpec[] = [
  { name: EVENT_PROCESS_QUEUE, retryLimit: 3, expireInSeconds: 120, concurrency: 8 },
  { name: PROCESS_ENGAGEMENT_QUEUE, retryLimit: 3, expireInSeconds: 300, concurrency: 4 },
  { name: PROCESS_PROVIDER_EVENTS_QUEUE, retryLimit: 3, expireInSeconds: 300, concurrency: 4 },
  { name: IDENTITY_MERGE_QUEUE, retryLimit: 3, expireInSeconds: 600, concurrency: 2 },
  { name: REFRESH_CAMPAIGN_PROGRESS_QUEUE, retryLimit: 1, expireInSeconds: 120, concurrency: 2 },
  { name: RECOMPUTE_WINDOWS_QUEUE, retryLimit: 1, expireInSeconds: 3600, concurrency: 1, cron: '15 4 * * *' },
  { name: ENFORCE_RETENTION_QUEUE, retryLimit: 1, expireInSeconds: 3600, concurrency: 1, cron: '45 3 * * *' },
  { name: CLEANUP_TOKEN_USES_QUEUE, retryLimit: 2, expireInSeconds: 300, concurrency: 1, cron: '7 * * * *' },
  { name: REFRESH_PROXY_RANGES_QUEUE, retryLimit: 2, expireInSeconds: 900, concurrency: 1, cron: '30 2 * * *' },
  { name: REBUILD_ENGAGEMENT_QUEUE, retryLimit: 0, expireInSeconds: 7200, concurrency: 1 },
];

const HANDLERS: Record<string, (data: never) => Promise<void>> = {
  [EVENT_PROCESS_QUEUE]: (data: EventProcessJobData) => handleEventProcess(data, { enqueue }),
  [PROCESS_ENGAGEMENT_QUEUE]: (data: ProcessEngagementJobData) =>
    handleProcessEngagement(data, { enqueue, emitWebhook }),
  [PROCESS_PROVIDER_EVENTS_QUEUE]: (data: ProcessProviderEventsJobData) =>
    handleProcessProviderEvents(data),
  [IDENTITY_MERGE_QUEUE]: (data: IdentityMergeJobData) => handleIdentityMerge(data),
  [REFRESH_CAMPAIGN_PROGRESS_QUEUE]: (data: RefreshCampaignProgressJobData) =>
    handleRefreshCampaignProgress(data),
  [RECOMPUTE_WINDOWS_QUEUE]: () => handleRecomputeWindows(),
  [ENFORCE_RETENTION_QUEUE]: () =>
    handleEnforceRetention({
      retentionMonths: trackingConfig.retentionMonths,
      anonymousIdentitiesDays: 400,
    }),
  [CLEANUP_TOKEN_USES_QUEUE]: () => handleCleanupTokenUses(),
  [REFRESH_PROXY_RANGES_QUEUE]: () =>
    handleRefreshProxyRanges({ enabled: trackingConfig.appleRelayRanges }),
  [REBUILD_ENGAGEMENT_QUEUE]: (data: RebuildEngagementInput) => handleRebuildEngagement(data),
} as Record<string, (data: never) => Promise<void>>;

/** Volá entrypoint workeru, který vlastní P01. Jediný integrační bod téhle domény. */
export async function registerTrackingJobs(boss: PgBoss): Promise<void> {
  for (const spec of TRACKING_QUEUES) {
    await boss.createQueue(spec.name, {
      retryLimit: spec.retryLimit,
      expireInSeconds: spec.expireInSeconds,
    } as never);
    await boss.work(
      spec.name,
      { batchSize: 1, pollingIntervalSeconds: 1 } as never,
      async ([job]: { data: never }[]) => {
        await HANDLERS[spec.name]!(job.data);
      },
    );
    if (spec.cron !== undefined) {
      await boss.schedule(spec.name, spec.cron, {} as never);
    }
  }
}
```

- [ ] **Step 7: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/maintenance.db.test.ts`
Expected: PASS, 9 testů.

- [ ] **Step 8: Commit**

```bash
git add packages/core/tracking/jobs packages/core/test/tracking/maintenance.db.test.ts
git commit -m "feat(tracking): add maintenance jobs and register all tracking queues"
```

---

### Task 38: Soukromí, IP adresy a odvozená země

**Rozhodnutí zadavatele: ukládání IP adresy a z ní odvozené země je volba provozovatele, ne pevné chování produktu.** Provozovatel instalace je správcem osobních údajů. Existují provozovatelé, kteří mají GDPR vyřešené a IP adresy potřebují, a je to jejich zodpovědnost a jejich rozhodnutí.

Výchozí chování zůstává to původní: IP se použije jen průběžně pro rate limiting a pro odvození země, do databáze se nezapisuje. Zapnutí vyžaduje **obě** páky, instalační i projektovou, protože jedna bez druhé by znamenala buď že to zapne někdo bez pravomoci, nebo že se to zapne pro všechny projekty naráz.

Do logu se surová IP nedostane nikdy. Jen `/24` prefix u IPv4 a `/48` u IPv6, a jen na úrovni `warn` a výš.

**Files:**
- Create: `packages/core/tracking/privacy/ip.ts`
- Create: `packages/core/tracking/privacy/geoip.ts`
- Test: `packages/core/test/tracking/privacy.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/privacy.test.ts
import { describe, expect, it } from 'vitest';
import { maskIpForLog, resolveIpStorage } from '../../tracking/privacy/ip';

describe('maskIpForLog', () => {
  it('IPv4 se zkrátí na /24', () => {
    expect(maskIpForLog('203.0.113.42')).toBe('203.0.113.0/24');
  });

  it('IPv6 se zkrátí na /48', () => {
    expect(maskIpForLog('2001:db8:abcd:1234::1')).toBe('2001:db8:abcd::/48');
  });

  it('nesmyslná hodnota se nikdy nevrátí zpátky do logu', () => {
    expect(maskIpForLog('není-ip')).toBe('invalid');
    expect(maskIpForLog(null)).toBe('none');
  });
});

describe('resolveIpStorage', () => {
  const ip = '203.0.113.42';

  it('ve výchozím stavu se neuloží ani IP, ani země', () => {
    expect(resolveIpStorage(ip, {
      allowIpStorage: false, storeCountryCapability: false,
      settings: { store_ip: false, store_country: false }, lookupCountry: () => 'CZ',
    })).toEqual({});
  });

  it('projektové nastavení samo nestačí, instalace to musí povolit', () => {
    expect(resolveIpStorage(ip, {
      allowIpStorage: false, storeCountryCapability: false,
      settings: { store_ip: true, store_country: true }, lookupCountry: () => 'CZ',
    })).toEqual({});
  });

  it('instalační povolení samo nestačí, projekt to musí zapnout', () => {
    expect(resolveIpStorage(ip, {
      allowIpStorage: true, storeCountryCapability: true,
      settings: { store_ip: false, store_country: false }, lookupCountry: () => 'CZ',
    })).toEqual({});
  });

  it('při obou zapnutých pákách se uloží IP i země', () => {
    expect(resolveIpStorage(ip, {
      allowIpStorage: true, storeCountryCapability: true,
      settings: { store_ip: true, store_country: true }, lookupCountry: () => 'CZ',
    })).toEqual({ ip, country: 'CZ' });
  });

  it('země jde uložit i bez IP, to je nejběžnější volba', () => {
    expect(resolveIpStorage(ip, {
      allowIpStorage: false, storeCountryCapability: true,
      settings: { store_ip: false, store_country: true }, lookupCountry: () => 'CZ',
    })).toEqual({ country: 'CZ' });
  });

  it('bez GeoIP databáze se země neuloží a nic nespadne', () => {
    expect(resolveIpStorage(ip, {
      allowIpStorage: false, storeCountryCapability: true,
      settings: { store_ip: false, store_country: true }, lookupCountry: () => null,
    })).toEqual({});
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/privacy.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/privacy/ip"`.

- [ ] **Step 3: Napiš práci s IP**

```ts
// packages/core/tracking/privacy/ip.ts
import ipaddr from 'ipaddr.js';

/**
 * Do logu se surová IP nedostane nikdy. IPv4 na /24, IPv6 na /48,
 * a jen na úrovni warn a výš, viz 6.2.
 */
export function maskIpForLog(ip: string | null | undefined): string {
  if (ip === null || ip === undefined || ip === '') return 'none';
  let address: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    address = ipaddr.parse(ip);
  } catch {
    return 'invalid';
  }
  if (address.kind() === 'ipv4') {
    const parts = (address as ipaddr.IPv4).octets;
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  }
  const parts = (address as ipaddr.IPv6).parts;
  const prefix = [parts[0]!, parts[1]!, parts[2]!]
    .map((part) => part.toString(16))
    .join(':');
  return `${prefix}::/48`;
}

export type IpStorageOptions = {
  /** Instalační pojistka TRACKING_ALLOW_IP_STORAGE. */
  allowIpStorage: boolean;
  /** Instalační schopnost TRACKING_STORE_COUNTRY plus dostupná GeoIP databáze. */
  storeCountryCapability: boolean;
  settings: { store_ip: boolean; store_country: boolean };
  lookupCountry: (ip: string) => string | null;
};

/**
 * Rozhodnutí zadavatele: obojí je volba provozovatele.
 * Ukládá se jen tehdy, když to povolí instalace i konkrétní projekt.
 * Jedna páka bez druhé by znamenala buď zapnutí bez pravomoci,
 * nebo zapnutí pro všechny projekty naráz.
 */
export function resolveIpStorage(
  ip: string | null,
  options: IpStorageOptions,
): { ip?: string; country?: string } {
  if (ip === null || ip === '') return {};
  const out: { ip?: string; country?: string } = {};

  if (options.allowIpStorage && options.settings.store_ip) {
    out.ip = ip;
  }
  if (options.storeCountryCapability && options.settings.store_country) {
    const country = options.lookupCountry(ip);
    if (country !== null) out.country = country;
  }
  return out;
}
```

- [ ] **Step 4: Napiš GeoIP**

```ts
// packages/core/tracking/privacy/geoip.ts
import { existsSync } from 'node:fs';
import { logger } from '@mlain/core/logging';
import { trackingConfig } from '../config';

/**
 * GeoIP databázi si dodává provozovatel sám a přijímá její licenční podmínky.
 * Do image se nebalí, protože MaxMind data mají vlastní licenci mimo náš whitelist.
 * Když databáze chybí, země se prostě neukládá a nic nespadne.
 */
type CountryLookup = (ip: string) => string | null;

let cached: CountryLookup | null = null;

export function getCountryLookup(): CountryLookup {
  if (cached !== null) return cached;

  const path = trackingConfig.geoipDbPath;
  if (!trackingConfig.storeCountry || path === '' || !existsSync(path)) {
    cached = () => null;
    return cached;
  }

  try {
    // Načítá se líně a jen když je opravdu potřeba, aby balíček nebyl
    // tvrdou závislostí instalace, která geolokaci nepoužívá.
    const maxmind = require('maxmind') as typeof import('maxmind');
    const reader = maxmind.openSync<{ country?: { iso_code?: string } }>(path);
    cached = (ip: string) => reader.get(ip)?.country?.iso_code ?? null;
  } catch (error) {
    logger.warn({ err: error, path }, 'tracking_geoip_load_failed');
    cached = () => null;
  }
  return cached;
}

export function resetCountryLookup(): void {
  cached = null;
}
```

> **Balíček `maxmind` se do `package.json` nepřidává jako závislost.** Databáze i knihovna jsou volba provozovatele. Když si geolokaci zapne, doinstaluje si obojí a přijme licenční podmínky MaxMind. Import je proto líný a v `try`, aby chybějící balíček nebyl chyba při startu. Do `licenses.allow.json` se nic nezapisuje, protože v našem stromu závislostí ten balíček není.

- [ ] **Step 5: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/privacy.test.ts`
Expected: PASS, 9 testů.

- [ ] **Step 6: Commit**

```bash
git add packages/core/tracking/privacy packages/core/test/tracking/privacy.test.ts
git commit -m "feat(tracking): make ip and country storage an operator choice"
```

---

### Task 39: Hooky pro GDPR a slučování kontaktů `[db]`

Volá je část 2 při výmazu a při slučování dvou kontaktů. **V obou režimech výmazu dělá tracking totéž**, rozdíl mezi `anonymize` a `purge` je výhradně v tabulkách části 2. Píšu to nahlas, aby nikdo neimplementoval rozdíl, který tam být nemá.

**Události se v žádném režimu nemažou.** Report, jehož čísla se zpětně mění, je k ničemu, a událost bez vazby na osobu je statistický údaj, ne osobní údaj.

`erased_at` má dva důvody a oba jsou nutné. Bez něj by serverová událost po vynulování `contact_id` porušila `CHECK` a `UPDATE` by skončil chybou `23514`. A brání vzkříšení: kdyby se týž prohlížeč později navázal na jiný kontakt, slučování by mu vymazané události připsalo.

**Files:**
- Create: `packages/core/tracking/privacy/erase.ts`
- Test: `packages/core/test/tracking/erase.db.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/erase.db.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { withTestDatabase, seedCampaign, seedContact, seedMessage, seedWebEvents } from '@mlain/db/testing';
import { eraseContact, reassignContact, exportContact } from '../../tracking/privacy/erase';
import { runIdentityMerge } from '../../tracking/identity/merge';

const db = withTestDatabase();
const anon = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('tracking GDPR hooks', () => {
  let workspaceId: string;
  let contactId: string;
  let campaignId: string;

  beforeEach(async () => {
    await db.truncateTracking();
    ({ workspaceId, campaignId } = await seedCampaign(db));
    ({ contactId } = await seedContact(db, { workspaceId }));
  });

  it('anonymize odstraní contact_id ze všech událostí, nastaví erased_at a nezmění campaign_stats', async () => {
    await seedWebEvents(db, { workspaceId, anonymousId: anon, contactId, count: 3 });
    await db.setCampaignStats(campaignId, { opens_unique: 7 });
    await eraseContact({ workspaceId, contactId, mode: 'anonymize' });
    expect(await db.countWebEventsForContact(workspaceId, contactId)).toBe(0);
    expect(await db.countErasedWebEvents(workspaceId)).toBe(3);
    expect((await db.selectCampaignStats(campaignId)).opens_unique).toBe(7);
  });

  it('purge udělá v trackingu přesně totéž co anonymize', async () => {
    await seedWebEvents(db, { workspaceId, anonymousId: anon, contactId, count: 3 });
    await eraseContact({ workspaceId, contactId, mode: 'purge' });
    expect(await db.countErasedWebEvents(workspaceId)).toBe(3);
  });

  it('anonymous_id v událostech zůstává, vazba na osobu je přeťatá jinak', async () => {
    await seedWebEvents(db, { workspaceId, anonymousId: anon, contactId, count: 2 });
    await eraseContact({ workspaceId, contactId, mode: 'anonymize' });
    expect(await db.countWebEventsByAnonymousId(workspaceId, anon)).toBe(2);
  });

  it('výmaz serverové události, která má vyplněné jen contact_id, proběhne bez chyby 23514', async () => {
    await seedWebEvents(db, { workspaceId, anonymousId: null, contactId, count: 1, source: 'server' });
    await expect(eraseContact({ workspaceId, contactId, mode: 'anonymize' })).resolves.toBeDefined();
  });

  it('smaže identity, bindings, merges, web_event_months i contact_engagement', async () => {
    await db.insertIdentity(workspaceId, anon, contactId);
    await eraseContact({ workspaceId, contactId, mode: 'anonymize' });
    expect(await db.countIdentities(workspaceId)).toBe(0);
    expect(await db.countWebEventMonths(workspaceId, 'contact', contactId)).toBe(0);
    expect(await db.selectContactEngagement(workspaceId, contactId)).toBeNull();
  });

  it('vyčistí klíče z TRACKING_PII_PROPERTY_KEYS z properties a context', async () => {
    await seedWebEvents(db, {
      workspaceId, anonymousId: anon, contactId, count: 1,
      properties: { email: 'a@b.cz', product: 'X' },
    });
    await eraseContact({ workspaceId, contactId, mode: 'anonymize', piiKeys: ['email'] });
    const props = await db.selectFirstWebEventProperties(workspaceId);
    expect(props).toEqual({ product: 'X' });
  });

  it('po výmazu se týž anonymous_id naváže na jiný kontakt a vymazané události se nepřipojí', async () => {
    await seedWebEvents(db, { workspaceId, anonymousId: anon, contactId, count: 3 });
    await eraseContact({ workspaceId, contactId, mode: 'anonymize' });
    const { contactId: other } = await seedContact(db, { workspaceId });
    const bindingId = await db.insertBinding(workspaceId, anon, other);
    const result = await runIdentityMerge({
      workspaceId, anonymousId: anon, contactId: other, bindingId,
      windowDays: 30, maxEvents: 10_000, batchSize: 1000, now: new Date(),
    });
    expect(result.eventsTotal).toBe(0);
  });

  it('je idempotentní, druhý běh nic nezmění', async () => {
    await seedWebEvents(db, { workspaceId, anonymousId: anon, contactId, count: 2 });
    const first = await eraseContact({ workspaceId, contactId, mode: 'anonymize' });
    const second = await eraseContact({ workspaceId, contactId, mode: 'anonymize' });
    expect(first.webEvents).toBe(2);
    expect(second.webEvents).toBe(0);
  });

  it('reassign přepíše identities i web_events na cílový kontakt', async () => {
    const { contactId: target } = await seedContact(db, { workspaceId });
    await db.insertIdentity(workspaceId, anon, contactId);
    await seedWebEvents(db, { workspaceId, anonymousId: anon, contactId, count: 4 });
    await reassignContact({ workspaceId, fromContactId: contactId, toContactId: target });
    expect(await db.countWebEventsForContact(workspaceId, target)).toBe(4);
    expect(await db.selectIdentityContactId(workspaceId, anon)).toBe(target);
  });

  it('export obsahuje webové i e-mailové události a žádný token', async () => {
    const createdAt = new Date('2026-07-25T16:00:00Z');
    const { messageId } = await seedMessage(db, { workspaceId, campaignId, contactId, createdAt });
    await db.insertMessageEvent({ workspaceId, messageId, messageCreatedAt: createdAt, campaignId, contactId, type: 'open', subtype: 'human' });
    await seedWebEvents(db, { workspaceId, anonymousId: anon, contactId, count: 2 });
    const out = await exportContact({ workspaceId, contactId });
    expect(out.web_events).toHaveLength(2);
    expect(out.email_events).toHaveLength(1);
    expect(JSON.stringify(out)).not.toContain('t1');
    expect(JSON.stringify(out)).not.toContain('message_id');
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/erase.db.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/privacy/erase"`.

- [ ] **Step 3: Napiš hooky**

```ts
// packages/core/tracking/privacy/erase.ts
import { sql } from 'drizzle-orm';
import { withTrackingTx } from '../repo/tx';
import { trackingConfig } from '../config';
import type { EventPage, OpenClass } from '../types';

/** Části 2 stačí tyhle dva režimy. Hodnota `delete` neexistuje a nikdy se nepošle. */
export type EraseMode = 'anonymize' | 'purge';

export type EraseInput = {
  workspaceId: string;
  contactId: string;
  mode: EraseMode;
  piiKeys?: readonly string[];
};

export type EraseResult = {
  webEvents: number;
  messageEngagement: number;
  messageEvents: number;
};

/**
 * V obou režimech dělá tracking totéž. Rozdíl mezi anonymize a purge je
 * výhradně v tabulkách části 2, kde purge navíc fyzicky maže řádek contacts.
 * Události se nemažou v žádném režimu.
 */
export async function eraseContact(input: EraseInput): Promise<EraseResult> {
  const piiKeys = input.piiKeys ?? trackingConfig.piiPropertyKeys;

  return withTrackingTx(input.workspaceId, 'tracking.erase_contact', async (tx) => {
    // Postupuje se po dávkách a je to idempotentní: erased_at IS NULL už
    // zpracované řádky vyloučí, takže druhý běh nic nezmění.
    let webEvents = 0;
    for (;;) {
      const { rows: updated } = await tx.execute<{ id: string }>(sql`
        UPDATE web_events
           SET contact_id = NULL,
               erased_at = now(),
               properties = properties - ${sql.param([...piiKeys])}::text[],
               context = context - ${sql.param([...piiKeys])}::text[] - 'ip'
         WHERE (id, received_at) IN (
                 SELECT id, received_at FROM web_events
                  WHERE workspace_id = ${input.workspaceId}
                    AND contact_id = ${input.contactId}
                    AND erased_at IS NULL
                  LIMIT 1000)
        RETURNING id
      `);
      if (updated.length === 0) break;
      webEvents += updated.length;
    }

    let messageEngagement = 0;
    for (;;) {
      const { rows: updated } = await tx.execute<{ messageId: string }>(sql`
        UPDATE message_engagement
           SET contact_id = NULL, erased_at = now()
         WHERE (message_id, created_at) IN (
                 SELECT message_id, created_at FROM message_engagement
                  WHERE workspace_id = ${input.workspaceId}
                    AND contact_id = ${input.contactId}
                    AND erased_at IS NULL
                  LIMIT 1000)
        RETURNING message_id AS "messageId"
      `);
      if (updated.length === 0) break;
      messageEngagement += updated.length;
    }

    // message_events se čistí taky, i když se řádky nemažou.
    //
    // Bez tohohle bloku by po výmazu zůstala v tabulce vazba osoba a událost.
    // Sloupcový grant na tyhle tři sloupce existuje právě proto a omezení
    // ck_message_events__subject je psané tak, aby vynulování contact_id
    // prošlo: bez erased_at by skončilo chybou 23514.
    //
    // recipient se NENULUJE, ale anonymizuje. Je NOT NULL u doručovacích
    // událostí a živí částečný index pro rozhodování o suppression, takže
    // po vynulování by přestala fungovat historie odrazů adresy. Tvar
    // placeholderu je stejný jako u messages.email podle rozhodnutí R3 v P03.
    let messageEvents = 0;
    for (;;) {
      const { rows: updated } = await tx.execute<{ id: string }>(sql`
        UPDATE message_events
           SET contact_id = NULL,
               erased_at = now(),
               recipient = CASE WHEN recipient IS NULL THEN NULL
                                ELSE ${`erased+${input.contactId}@erased.invalid`} END
         WHERE (id, received_at) IN (
                 SELECT id, received_at FROM message_events
                  WHERE workspace_id = ${input.workspaceId}
                    AND contact_id = ${input.contactId}
                    AND erased_at IS NULL
                  LIMIT 1000)
        RETURNING id
      `);
      if (updated.length === 0) break;
      messageEvents += updated.length;
    }

    await tx.execute(sql`
      DELETE FROM identity_merges WHERE workspace_id = ${input.workspaceId} AND contact_id = ${input.contactId}
    `);
    await tx.execute(sql`
      DELETE FROM identity_bindings WHERE workspace_id = ${input.workspaceId} AND contact_id = ${input.contactId}
    `);
    await tx.execute(sql`
      DELETE FROM identities WHERE workspace_id = ${input.workspaceId} AND contact_id = ${input.contactId}
    `);
    await tx.execute(sql`
      DELETE FROM web_event_months
       WHERE workspace_id = ${input.workspaceId} AND subject_kind = 'contact' AND subject_id = ${input.contactId}
    `);
    await tx.execute(sql`
      DELETE FROM contact_engagement
       WHERE workspace_id = ${input.workspaceId} AND contact_id = ${input.contactId}
    `);
    // campaign_stats se nemění. Report, jehož čísla se zpětně mění, je k ničemu.

    return { webEvents, messageEngagement, messageEvents };
  });
}

export type ReassignInput = { workspaceId: string; fromContactId: string; toContactId: string };

/** Volá část 2 při slučování dvou kontaktů. */
export async function reassignContact(input: ReassignInput): Promise<void> {
  await withTrackingTx(input.workspaceId, 'tracking.reassign_contact', async (tx) => {
    await tx.execute(sql`
      UPDATE identities SET contact_id = ${input.toContactId}
       WHERE workspace_id = ${input.workspaceId} AND contact_id = ${input.fromContactId}
    `);
    await tx.execute(sql`
      UPDATE web_events SET contact_id = ${input.toContactId}
       WHERE workspace_id = ${input.workspaceId} AND contact_id = ${input.fromContactId}
         AND erased_at IS NULL
    `);
    await tx.execute(sql`
      UPDATE message_engagement SET contact_id = ${input.toContactId}
       WHERE workspace_id = ${input.workspaceId} AND contact_id = ${input.fromContactId}
         AND erased_at IS NULL
    `);
  });
}

export type TrackingExport = {
  identities: { anonymous_id: string; first_seen: string; last_seen: string }[];
  web_events: {
    occurred_at: string;
    name: string;
    page?: EventPage;
    properties?: Record<string, unknown>;
  }[];
  email_events: {
    occurred_at: string;
    type: string;
    campaign_name: string;
    link_url?: string;
    open_class?: OpenClass;
  }[];
};

const EXPORT_PAGE_SIZE = 10_000;

/** Export neobsahuje interní identifikátory zpráv ani tokeny. */
export async function exportContact(input: {
  workspaceId: string;
  contactId: string;
  offset?: number;
}): Promise<TrackingExport> {
  const offset = input.offset ?? 0;

  return withTrackingTx(input.workspaceId, 'tracking.export_contact', async (tx) => {
    const { rows: identities } = await tx.execute<{ anonymous_id: string; first_seen: string; last_seen: string }>(sql`
      SELECT anonymous_id, first_seen::text, last_seen::text
        FROM identities
       WHERE workspace_id = ${input.workspaceId} AND contact_id = ${input.contactId}
    `);

    const { rows: webEvents } = await tx.execute<TrackingExport['web_events'][number]>(sql`
      SELECT occurred_at::text AS occurred_at, name, page, properties
        FROM web_events
       WHERE workspace_id = ${input.workspaceId} AND contact_id = ${input.contactId}
       ORDER BY occurred_at DESC
       LIMIT ${EXPORT_PAGE_SIZE} OFFSET ${offset}
    `);

    const { rows: emailEvents } = await tx.execute<TrackingExport['email_events'][number]>(sql`
      SELECT e.ts::text AS occurred_at, e.type, c.name AS campaign_name,
             l.url AS link_url,
             CASE WHEN e.type = 'open' THEN e.subtype ELSE NULL END AS open_class
        FROM message_events e
        JOIN campaigns c ON c.id = e.campaign_id
        LEFT JOIN campaign_links l ON l.id = e.link_id
       WHERE e.workspace_id = ${input.workspaceId} AND e.contact_id = ${input.contactId}
       ORDER BY e.ts DESC
       LIMIT ${EXPORT_PAGE_SIZE}
    `);

    return { identities, web_events: webEvents, email_events: emailEvents };
  });
}
```

- [ ] **Step 4: Vystav hooky na povrchu domény**

```ts
// packages/core/tracking/index.ts (doplnění na konec souboru)
export { verifyTrackingToken } from './tokens/verify';
export { mintIdentityToken } from './tokens/mint';
export { eraseContact, reassignContact, exportContact } from './privacy/erase';
export type { EraseMode, TrackingExport } from './privacy/erase';
export { TrackingSettingsSchema, DEFAULT_TRACKING_SETTINGS } from './settings';
export type { TrackingSettings } from './settings';
```

Část 2 volá `verifyTrackingToken(token, ['u'])` a dostane rozparsovaná pole nebo chybu z katalogu. Vlastní ověření si nepíše: kontrola typu proti endpointu je bezpečnostní a musí být na jednom místě.

- [ ] **Step 5: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/erase.db.test.ts`
Expected: PASS, 10 testů.

- [ ] **Step 6: Commit**

```bash
git add packages/core/tracking/privacy/erase.ts packages/core/tracking/index.ts packages/core/test/tracking/erase.db.test.ts
git commit -m "feat(tracking): implement gdpr erase, reassign and export hooks"
```

---

### Task 40: API pro domény, zařízení kontaktu a vrácení sloučení `[db]`

Tři Hono podaplikace pod `/api/v1/**`. Kořenový router vlastní P04 a připojí je jedním řádkem, viz sekce 2.

**Cesty pod `/api/v1/contacts/{id}/` vlastní tenhle plán jen pro dvě podcesty:** `identities` a `identity-merges`. Zbytek kontaktů je P07. V Next.js App Routeru i v Honu jsou to samostatné soubory, takže ke konfliktu nedojde.

**Files:**
- Create: `packages/core/tracking/domains/service.ts`
- Create: `packages/core/tracking/identity/service.ts`
- Create: `packages/core/tracking/api/tracking-domains.routes.ts`
- Create: `packages/core/tracking/api/identities.routes.ts`
- Create: `packages/core/tracking/audit.ts`
- Test: `packages/core/test/tracking/tracking-api.db.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/tracking-api.db.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { withTestDatabase, seedContact, testRequest } from '@mlain/db/testing';
import { createTrackingDomainsRoutes } from '../../tracking/api/tracking-domains.routes';
import { createTrackingIdentitiesRoutes } from '../../tracking/api/identities.routes';

const db = withTestDatabase();
const anon = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

describe('tracking API', () => {
  let workspaceId: string;
  let contactId: string;

  beforeEach(async () => {
    await db.truncateTracking();
    ({ workspaceId, contactId } = await seedContact(db));
  });

  const domains = () => testRequest(createTrackingDomainsRoutes(), { workspaceId, scopes: ['settings:read', 'settings:write'] });
  const identities = () => testRequest(createTrackingIdentitiesRoutes(), { workspaceId, scopes: ['contacts:read', 'contacts:write'] });

  it('přidá doménu a vrátí ji v seznamu', async () => {
    const created = await domains().post('/', { host: 'shop.cz', include_subdomains: false });
    expect(created.status).toBe(201);
    const list = await domains().get('/');
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ host: 'shop.cz' });
  });

  it('normalizuje zadaný host, uživatel často vloží celou adresu', async () => {
    const created = await domains().post('/', { host: 'HTTPS://Shop.CZ:443/cesta', include_subdomains: false });
    expect(created.body.host).toBe('shop.cz');
  });

  it('neplatný host vrátí 422 a tracking_domain_invalid', async () => {
    const res = await domains().post('/', { host: 'https://', include_subdomains: false });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('tracking_domain_invalid');
  });

  it('dvacátá první doména vrátí 422 a tracking_domain_limit_reached', async () => {
    for (let i = 0; i < 20; i += 1) {
      await domains().post('/', { host: `shop${i}.cz`, include_subdomains: false });
    }
    const res = await domains().post('/', { host: 'shop20.cz', include_subdomains: false });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe('tracking_domain_limit_reached');
  });

  it('táž doména podruhé vrátí 409 already_exists', async () => {
    await domains().post('/', { host: 'shop.cz', include_subdomains: false });
    const res = await domains().post('/', { host: 'shop.cz', include_subdomains: false });
    expect(res.status).toBe(409);
  });

  it('smazání domény vrátí 204 a zapíše auditní akci', async () => {
    const created = await domains().post('/', { host: 'shop.cz', include_subdomains: false });
    const res = await domains().delete(`/${created.body.id}`);
    expect(res.status).toBe(204);
    expect(await db.countAuditLog(workspaceId, 'tracking.domain_removed')).toBe(1);
  });

  it('doména jiného projektu se nesmaže a vrátí 404, ne 403', async () => {
    const other = await seedContact(db);
    const created = await testRequest(createTrackingDomainsRoutes(), {
      workspaceId: other.workspaceId, scopes: ['settings:write'],
    }).post('/', { host: 'jiny.cz', include_subdomains: false });
    const res = await domains().delete(`/${created.body.id}`);
    expect(res.status).toBe(404);
  });

  it('seznam zařízení kontaktu vrátí navázaná anonymní ID', async () => {
    await db.insertIdentity(workspaceId, anon, contactId);
    const res = await identities().get(`/${contactId}/identities`);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ anonymous_id: anon });
  });

  it('odpojení zařízení nastaví contact_id na NULL a zapíše historii se source reset', async () => {
    await db.insertIdentity(workspaceId, anon, contactId);
    const res = await identities().delete(`/${contactId}/identities/${anon}`);
    expect(res.status).toBe(204);
    expect(await db.selectIdentityContactId(workspaceId, anon)).toBeNull();
    expect(await db.selectLastBindingSource(workspaceId, anon)).toBe('reset');
  });

  it('vrácení sloučení, které není completed, skončí kódem tracking_merge_not_revertible', async () => {
    const bindingId = await db.insertBinding(workspaceId, anon, contactId);
    const mergeId = await db.insertMerge(workspaceId, anon, contactId, bindingId, 'running');
    const res = await identities().post(`/${contactId}/identity-merges/${mergeId}/revert`, {});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('tracking_merge_not_revertible');
  });

  it('vrácení dokončeného sloučení projde a zapíše auditní akci', async () => {
    const bindingId = await db.insertBinding(workspaceId, anon, contactId);
    const mergeId = await db.insertMerge(workspaceId, anon, contactId, bindingId, 'completed');
    const res = await identities().post(`/${contactId}/identity-merges/${mergeId}/revert`, {});
    expect(res.status).toBe(200);
    expect(await db.countAuditLog(workspaceId, 'tracking.merge_reverted')).toBe(1);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/tracking-api.db.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/api/tracking-domains.routes"`.

- [ ] **Step 3: Napiš auditní akce**

```ts
// packages/core/tracking/audit.ts

/** Název akce je <entita>.<sloveso v minulém čase>, konvence 3.7 části 1. */
export const TRACKING_AUDIT_ACTIONS = [
  'tracking.merge_reverted',
  'tracking.domain_added',
  'tracking.domain_removed',
  'tracking.identity_detached',
  'tracking.events_imported',
] as const;

export type TrackingAuditAction = (typeof TRACKING_AUDIT_ACTIONS)[number];
```

- [ ] **Step 4: Napiš služby**

```ts
// packages/core/tracking/domains/service.ts
import { v7 as uuidv7 } from 'uuid';
import { AppError } from '@mlain/core/errors';
import type { WorkspaceContext } from '@mlain/db';
import { TRACKING_DOMAIN_LIMIT } from '../config';
import {
  countTrackingDomains,
  deleteTrackingDomain,
  insertTrackingDomain,
  selectTrackingDomains,
} from '../repo/tracking-domains.repo';
import { normalizeHost } from './domain-cache';

const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;
const MAX_HOST_LENGTH = 253;

export async function listDomains(ctx: WorkspaceContext) {
  return selectTrackingDomains(ctx);
}

export async function addDomain(
  ctx: WorkspaceContext,
  input: { host: string; includeSubdomains: boolean },
) {
  // Uživatel typicky vloží celou adresu z prohlížeče, tak ji přijmeme a očistíme.
  const host = normalizeHost(input.host);
  if (host === '' || host.length > MAX_HOST_LENGTH || !HOST_RE.test(host)) {
    throw new AppError('tracking_domain_invalid', { host: input.host });
  }

  if ((await countTrackingDomains(ctx)) >= TRACKING_DOMAIN_LIMIT) {
    throw new AppError('tracking_domain_limit_reached', { limit: TRACKING_DOMAIN_LIMIT });
  }

  return insertTrackingDomain(ctx, {
    id: uuidv7(),
    host,
    includeSubdomains: input.includeSubdomains,
  });
}

export async function removeDomain(ctx: WorkspaceContext, id: string): Promise<void> {
  // RLS vrátí nula řádků u cizího projektu, takže 404 místo 403 kvůli enumeraci.
  if (!(await deleteTrackingDomain(ctx, id))) throw new AppError('not_found');
}
```

```ts
// packages/core/tracking/identity/service.ts
import { v7 as uuidv7 } from 'uuid';
import { sql } from 'drizzle-orm';
import { withWorkspace } from '@mlain/core/tx';
import type { WorkspaceContext } from '@mlain/db';
import { AppError } from '@mlain/core/errors';
import { revertIdentityMerge } from './merge';

export type ContactIdentity = {
  anonymous_id: string;
  first_seen: string;
  last_seen: string;
  bound_at: string | null;
  bind_count: number;
  shared: boolean;
};

export async function listContactIdentities(
  ctx: WorkspaceContext,
  contactId: string,
): Promise<ContactIdentity[]> {
  return withWorkspace(ctx, async (tx) =>
    (await tx.execute<ContactIdentity>(sql`
      SELECT anonymous_id, first_seen::text, last_seen::text,
             bound_at::text AS bound_at, bind_count, shared
        FROM identities
       WHERE workspace_id = ${ctx.workspaceId} AND contact_id = ${contactId}
       ORDER BY last_seen DESC
    `)).rows,
  );
}

/** Odpojení zařízení od kontaktu. Historii to nemění, jen budoucí atribuci. */
export async function detachIdentity(
  ctx: WorkspaceContext,
  contactId: string,
  anonymousId: string,
): Promise<void> {
  const changed = await withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{ anonymousId: string }>(sql`
      UPDATE identities
         SET contact_id = NULL, bound_at = NULL
       WHERE workspace_id = ${ctx.workspaceId}
         AND anonymous_id = ${anonymousId}
         AND contact_id = ${contactId}
      RETURNING anonymous_id AS "anonymousId"
    `);
    if (rows.length === 0) return false;
    await tx.execute(sql`
      INSERT INTO identity_bindings (id, workspace_id, anonymous_id, contact_id, valid_from, source, evidence)
      VALUES (${uuidv7()}, ${ctx.workspaceId}, ${anonymousId}, NULL, now(), 'reset', '{}'::jsonb)
    `);
    return true;
  });
  if (!changed) throw new AppError('not_found');
}

export async function revertMerge(
  ctx: WorkspaceContext,
  mergeId: string,
): Promise<{ reverted_events: number }> {
  const userId = ctx.actor.type === 'user' ? ctx.actor.userId : null;
  const count = await revertIdentityMerge({
    workspaceId: ctx.workspaceId,
    mergeId,
    revertedBy: userId ?? '',
    now: new Date(),
  });
  return { reverted_events: count };
}
```

- [ ] **Step 5: Napiš routery**

```ts
// packages/core/tracking/api/tracking-domains.routes.ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { requireScope, workspaceContext, writeAudit } from '@mlain/core/api';
import { addDomain, listDomains, removeDomain } from '../domains/service';

const DomainSchema = z.object({
  id: z.string().uuid(),
  host: z.string(),
  include_subdomains: z.boolean(),
  verified_at: z.string().nullable(),
  created_at: z.string(),
});

const CreateSchema = z.object({ host: z.string().min(1).max(300), include_subdomains: z.boolean() }).strict();

export function createTrackingDomainsRoutes(): OpenAPIHono {
  const app = new OpenAPIHono();

  app.openapi(
    createRoute({
      method: 'get', path: '/', tags: ['tracking'],
      security: [{ apiKey: [] }],
      responses: { 200: { description: 'Seznam domén', content: { 'application/json': { schema: z.object({ data: z.array(DomainSchema) }) } } } },
    }),
    async (c) => {
      const ctx = workspaceContext(c);
      requireScope(ctx, 'settings:read');
      const rows = await listDomains(ctx);
      return c.json({
        data: rows.map((row) => ({
          id: row.id,
          host: row.host,
          include_subdomains: row.includeSubdomains,
          verified_at: row.verifiedAt?.toISOString() ?? null,
          created_at: row.createdAt.toISOString(),
        })),
      });
    },
  );

  app.openapi(
    createRoute({
      method: 'post', path: '/', tags: ['tracking'],
      security: [{ apiKey: [] }],
      request: { body: { content: { 'application/json': { schema: CreateSchema } } } },
      responses: { 201: { description: 'Doména přidána', content: { 'application/json': { schema: DomainSchema.partial() } } } },
    }),
    async (c) => {
      const ctx = workspaceContext(c);
      requireScope(ctx, 'settings:write');
      const body = c.req.valid('json');
      const row = await addDomain(ctx, { host: body.host, includeSubdomains: body.include_subdomains });
      await writeAudit(ctx, 'tracking.domain_added', { host: row.host });
      c.header('Location', `/api/v1/tracking/domains/${row.id}`);
      return c.json({ id: row.id, host: row.host, include_subdomains: row.includeSubdomains }, 201);
    },
  );

  app.openapi(
    createRoute({
      method: 'delete', path: '/{id}', tags: ['tracking'],
      security: [{ apiKey: [] }],
      request: { params: z.object({ id: z.string().uuid() }) },
      responses: { 204: { description: 'Doména odebrána' } },
    }),
    async (c) => {
      const ctx = workspaceContext(c);
      requireScope(ctx, 'settings:write');
      const { id } = c.req.valid('param');
      await removeDomain(ctx, id);
      await writeAudit(ctx, 'tracking.domain_removed', { id });
      return c.body(null, 204);
    },
  );

  return app;
}
```

```ts
// packages/core/tracking/api/identities.routes.ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { requireScope, workspaceContext, writeAudit } from '@mlain/core/api';
import { detachIdentity, listContactIdentities, revertMerge } from '../identity/service';

const IdentitySchema = z.object({
  anonymous_id: z.string().uuid(),
  first_seen: z.string(),
  last_seen: z.string(),
  bound_at: z.string().nullable(),
  bind_count: z.number().int(),
  shared: z.boolean(),
});

/**
 * Tenhle plán vlastní pod /api/v1/contacts jen podcesty identities
 * a identity-merges. Zbytek kontaktů je P07.
 */
export function createTrackingIdentitiesRoutes(): OpenAPIHono {
  const app = new OpenAPIHono();

  app.openapi(
    createRoute({
      method: 'get', path: '/{contactId}/identities', tags: ['tracking'],
      security: [{ apiKey: [] }],
      request: { params: z.object({ contactId: z.string().uuid() }) },
      responses: { 200: { description: 'Zařízení navázaná na kontakt', content: { 'application/json': { schema: z.object({ data: z.array(IdentitySchema) }) } } } },
    }),
    async (c) => {
      const ctx = workspaceContext(c);
      requireScope(ctx, 'contacts:read');
      const { contactId } = c.req.valid('param');
      return c.json({ data: await listContactIdentities(ctx, contactId) });
    },
  );

  app.openapi(
    createRoute({
      method: 'delete', path: '/{contactId}/identities/{anonymousId}', tags: ['tracking'],
      security: [{ apiKey: [] }],
      request: { params: z.object({ contactId: z.string().uuid(), anonymousId: z.string().uuid() }) },
      responses: { 204: { description: 'Zařízení odpojeno' } },
    }),
    async (c) => {
      const ctx = workspaceContext(c);
      requireScope(ctx, 'contacts:write');
      const { contactId, anonymousId } = c.req.valid('param');
      await detachIdentity(ctx, contactId, anonymousId);
      await writeAudit(ctx, 'tracking.identity_detached', { contact_id: contactId, anonymous_id: anonymousId });
      return c.body(null, 204);
    },
  );

  app.openapi(
    createRoute({
      method: 'post', path: '/{contactId}/identity-merges/{mergeId}/revert', tags: ['tracking'],
      security: [{ apiKey: [] }],
      request: { params: z.object({ contactId: z.string().uuid(), mergeId: z.string().uuid() }) },
      responses: { 200: { description: 'Sloučení vráceno', content: { 'application/json': { schema: z.object({ reverted_events: z.number().int() }) } } } },
    }),
    async (c) => {
      const ctx = workspaceContext(c);
      requireScope(ctx, 'contacts:write');
      const { contactId, mergeId } = c.req.valid('param');
      const result = await revertMerge(ctx, mergeId);
      await writeAudit(ctx, 'tracking.merge_reverted', { contact_id: contactId, merge_id: mergeId });
      return c.json(result);
    },
  );

  return app;
}
```

- [ ] **Step 6: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/tracking-api.db.test.ts`
Expected: PASS, 12 testů.

- [ ] **Step 7: Přegeneruj OpenAPI**

Run: `pnpm contracts:generate && pnpm openapi:check`
Expected: PASS. **Soubor `openapi.json` se nikdy neslučuje ručně.** Při konfliktu se zahodí obě verze a přegeneruje se.

- [ ] **Step 8: Commit**

```bash
git add packages/core/tracking/domains/service.ts packages/core/tracking/identity/service.ts packages/core/tracking/api packages/core/tracking/audit.ts packages/core/test/tracking/tracking-api.db.test.ts openapi.json
git commit -m "feat(tracking): add api for domains, contact devices and merge revert"
```

---

### Task 41: Serverové události a dávkový import historie `[db]`

Dvě cesty, které se snadno spletou, a rozdíl mezi nimi je zásadní.

`POST /api/v1/events` je **živá cesta**: platí pro ni sedmidenní okno i korekce hodin, autorizuje se scopem `events:write`.

`POST /api/v1/events/import` je **dávkový import historie**, vyňatý ze sedmidenního okna, výhradně se scopem `events:import`. Zákazník při nástupu potřebuje nahrát historii objednávek, aby segment „kdo u nás nakoupil za posledních dvanáct měsíců" fungoval první den, ne až za rok.

**Import nikdy nespouští živé reakce.** Nahrání roční historie nesmí rozeslat rok starých automatizací, nesmí posunout `last_activity_at` a nesmí vypustit odchozí webhooky. Je to nejnebezpečnější vlastnost celé importní cesty: bez tohohle pravidla by první import u zákazníka poslal jeho zákazníkům tisíce e-mailů.

**Files:**
- Create: `packages/core/tracking/ingest/import-service.ts`
- Create: `packages/core/tracking/api/events.routes.ts`
- Test: `packages/core/test/tracking/import-service.db.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/import-service.db.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { withTestDatabase, seedContact } from '@mlain/db/testing';
import { createImportService } from '../../tracking/ingest/import-service';

const db = withTestDatabase();

describe('import service', () => {
  let workspaceId: string;
  let contactId: string;
  let enqueue: ReturnType<typeof vi.fn>;
  let partitionsPresent: ReturnType<typeof vi.fn>;

  const event = (occurredAt: string) => ({
    id: `0192f3a0-1c2d-7e50-8a1b-2c3d4e5f${String(Math.floor(Math.random() * 9000) + 1000)}`,
    name: 'order_completed',
    occurred_at: occurredAt,
    contact_id: contactId,
    properties: { value: 1490.5, currency: 'CZK' },
  });

  const service = (over = {}) =>
    createImportService({
      enqueue,
      partitionsPresent,
      retentionMonths: 37,
      maxEvents: 1000,
      now: () => new Date('2026-07-31T12:00:00Z'),
      ...over,
    });

  beforeEach(async () => {
    await db.truncateTracking();
    ({ workspaceId, contactId } = await seedContact(db));
    enqueue = vi.fn(async () => {});
    partitionsPresent = vi.fn(async (months: string[]) => months);
  });

  it('přijme historickou událost starou půl roku, sedmidenní okno na import neplatí', async () => {
    const out = await service().importBatch(workspaceId, { v: 1, events: [event('2026-01-15T10:00:00.000Z')] });
    expect(out.status).toBe(202);
    expect(out.body).toMatchObject({ accepted: 1 });
  });

  it('received_at se odvodí z occurred_at, aby řádek padl do oddílu podle času vzniku', async () => {
    await service().importBatch(workspaceId, { v: 1, events: [event('2026-01-15T10:00:00.000Z')] });
    const payload = enqueue.mock.calls[0]![1] as { source: string; events: { occurredAt: string }[] };
    expect(payload.source).toBe('import');
    expect(payload.events[0]!.occurredAt).toBe('2026-01-15T10:00:00.000Z');
  });

  it('chybějící oddíl vrátí 422 a tracking_import_partition_missing s uvedením měsíce', async () => {
    const out = await service({ partitionsPresent: async () => [] }).importBatch(
      workspaceId, { v: 1, events: [event('2026-01-15T10:00:00.000Z')] },
    );
    expect(out.status).toBe(422);
    expect(out.problem?.code).toBe('tracking_import_partition_missing');
    expect(out.problem?.params).toMatchObject({ month: '2026-01' });
  });

  it('import oddíl NEZAKLÁDÁ, jen se ptá', async () => {
    // CREATE TABLE ... PARTITION OF smí jen mlain_migrator. Kdyby si to import
    // zakládal sám, musel by za běhu držet migrátorské spojení.
    await service({ partitionsPresent: async () => [] }).importBatch(
      workspaceId, { v: 1, events: [event('2026-01-15T10:00:00.000Z')] },
    );
    const source = createImportService.toString();
    expect(source).not.toContain('CREATE TABLE');
    expect(source).not.toContain('PARTITION OF');
  });

  it('chybí-li druhý ze dvou měsíců, chyba uvede ten chybějící', async () => {
    const out = await service({ partitionsPresent: async () => ['2026-01'] }).importBatch(
      workspaceId,
      { v: 1, events: [event('2026-01-15T10:00:00.000Z'), event('2026-02-15T10:00:00.000Z')] },
    );
    expect(out.problem?.params).toMatchObject({ month: '2026-02' });
  });

  it('událost starší než retence vrátí tracking_import_beyond_retention', async () => {
    const out = await service().importBatch(workspaceId, { v: 1, events: [event('2020-01-15T10:00:00.000Z')] });
    expect(out.status).toBe(422);
    expect(out.problem?.code).toBe('tracking_import_beyond_retention');
  });

  it('dávka nad 1000 událostí vrátí too_many_items', async () => {
    const events = Array.from({ length: 1001 }, () => event('2026-06-15T10:00:00.000Z'));
    const out = await service().importBatch(workspaceId, { v: 1, events });
    expect(out.status).toBe(422);
    expect(out.problem?.code).toBe('too_many_items');
  });

  it('import nespouští přepočet segmentů po dávce, ten se pustí až na konci celého importu', async () => {
    await service().importBatch(workspaceId, { v: 1, events: [event('2026-06-15T10:00:00.000Z')] });
    const queues = enqueue.mock.calls.map((call) => call[0]);
    expect(queues).not.toContain('segments.recalc_for_contact');
  });

  it('konverzní vlastnosti projdou a uloží se, ale žádná agregace nad nimi nevzniká', async () => {
    await service().importBatch(workspaceId, { v: 1, events: [event('2026-06-15T10:00:00.000Z')] });
    const payload = enqueue.mock.calls[0]![1] as { events: { properties: Record<string, unknown> }[] };
    expect(payload.events[0]!.properties).toEqual({ value: 1490.5, currency: 'CZK' });
  });

  it('dávka je idempotentní, stabilní id dodává importér', async () => {
    const fixed = { ...event('2026-06-15T10:00:00.000Z'), id: '0192f3a0-1c2d-7e50-8a1b-2c3d4e5f6071' };
    await service().importBatch(workspaceId, { v: 1, events: [fixed] });
    await service().importBatch(workspaceId, { v: 1, events: [fixed] });
    const ids = enqueue.mock.calls.map((call) => (call[1] as { events: { id: string }[] }).events[0]!.id);
    expect(new Set(ids).size).toBe(1);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/import-service.db.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/ingest/import-service"`.

- [ ] **Step 3: Napiš importní službu**

```ts
// packages/core/tracking/ingest/import-service.ts
import { z } from 'zod';
import { EVENT_NAME_RE } from '../types';
import { EventContextSchema, EventPageSchema, SUPPORTED_PAYLOAD_VERSIONS } from './schema';

const ImportEventSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string().regex(EVENT_NAME_RE),
    occurred_at: z.string().datetime({ offset: false }),
    contact_id: z.string().uuid().optional(),
    anonymous_id: z.string().uuid().optional(),
    session_id: z.string().uuid().optional(),
    page: EventPageSchema.optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
    context: EventContextSchema.optional(),
  })
  .strict();

const ImportBatchSchema = z
  .object({ v: z.number().int(), events: z.array(ImportEventSchema).min(1) })
  .strict();

export type ImportResponse = {
  status: 202 | 400 | 422;
  body?: { accepted: number };
  problem?: { code: string; params?: Record<string, unknown> };
};

export type ImportServiceDeps = {
  enqueue: (queue: string, data: unknown) => Promise<void>;
  /**
   * Zjistí, které z uvedených měsíců mají připravený oddíl. **Jen se ptá,
   * nic nezakládá.**
   *
   * `CREATE TABLE ... PARTITION OF` vyžaduje vlastnictví rodičovské tabulky,
   * tedy roli `mlain_migrator`. Aplikační role ji nemá a mít nesmí: držet
   * migrátorské spojení otevřené za běhu aplikace kvůli dávkovému importu
   * je bezpečnostní ústupek, který se nevyplatí. Chybějící oddíl proto
   * dozaloží noční `platform.maintain_partitions`, což je kód, který už
   * existuje a je označený jako opakovatelný.
   *
   * Cena je zpoždění importu nejvýš o jednu noc a chyba je označená jako
   * opakovatelná, takže volající ví, že má zkusit znovu.
   */
  partitionsPresent: (months: string[]) => Promise<string[]>;
  retentionMonths: number;
  maxEvents: number;
  now: () => Date;
};

export function createImportService(deps: ImportServiceDeps) {
  return {
    async importBatch(workspaceId: string, input: unknown): Promise<ImportResponse> {
      const version = (input as { v?: unknown } | null)?.v;
      if (typeof version !== 'number' || !SUPPORTED_PAYLOAD_VERSIONS.includes(version as 1)) {
        return {
          status: 400,
          problem: {
            code: 'tracking_payload_version_unsupported',
            params: { supported: [...SUPPORTED_PAYLOAD_VERSIONS] },
          },
        };
      }

      const events = (input as { events?: unknown }).events;
      if (Array.isArray(events) && events.length > deps.maxEvents) {
        return { status: 422, problem: { code: 'too_many_items', params: { limit: deps.maxEvents } } };
      }

      const parsed = ImportBatchSchema.safeParse(input);
      if (!parsed.success) return { status: 422, problem: { code: 'validation_failed' } };

      const now = deps.now();
      const retentionCutoff = new Date(now);
      retentionCutoff.setUTCMonth(retentionCutoff.getUTCMonth() - deps.retentionMonths);

      const months = new Set<string>();
      for (const event of parsed.data.events) {
        const occurredAt = new Date(event.occurred_at);
        if (occurredAt < retentionCutoff) {
          // Nejbližší noční retenční běh by je stejně zahodil.
          return {
            status: 422,
            problem: {
              code: 'tracking_import_beyond_retention',
              params: { months: deps.retentionMonths },
            },
          };
        }
        months.add(
          `${occurredAt.getUTCFullYear()}-${String(occurredAt.getUTCMonth() + 1).padStart(2, '0')}`,
        );
      }

      // Výchozí oddíl se nezakládá, takže chybějící oddíl musí selhat hlasitě.
      // Import oddíl NEZAKLÁDÁ, jen se ptá: založit ho smí výhradně migrátor.
      const sortedMonths = [...months].sort();
      const present = new Set(await deps.partitionsPresent(sortedMonths));
      const firstMissing = sortedMonths.find((month) => !present.has(month));
      if (firstMissing !== undefined) {
        return {
          status: 422,
          problem: { code: 'tracking_import_partition_missing', params: { month: firstMissing } },
        };
      }

      const importedAt = now.toISOString();
      await deps.enqueue('event.process', {
        workspaceId,
        anonymousId: null,
        source: 'import',
        events: parsed.data.events.map((event) => ({
          id: event.id,
          name: event.name,
          // Čas se bere tak, jak přišel. Korekce hodin se na import nevztahuje,
          // protože ho dodává server zákazníka z vlastní databáze, ne prohlížeč.
          occurredAt: event.occurred_at,
          sessionId: event.session_id ?? null,
          contactId: event.contact_id ?? null,
          page: event.page,
          properties: event.properties ?? {},
          context: { ...event.context, imported_at: importedAt },
        })),
      });

      // Přepočet segmentů se spouští jednou na konci celého importu, ne po dávce.
      // Automatizace ani odchozí webhooky import nespouští nikdy.
      return { status: 202, body: { accepted: parsed.data.events.length } };
    },
  };
}
```

Dotaz na existenci oddílu patří k repository událostí, protože je to jediné SQL, které tahle cesta potřebuje:

```ts
// packages/core/tracking/repo/web-events.repo.ts (dopiš k existujícím funkcím)

/**
 * Vrátí ty z uvedených měsíců (`YYYY-MM`), pro které už oddíl existuje.
 *
 * **Oddíl se nikdy neadresuje jménem.** Odvozovat `web_events_y2026m08`
 * z data je předpoklad o cizí konvenci pojmenování a rozejde se tiše.
 * Dotaz se místo toho ptá katalogu na hranice oddílů rodičovské tabulky
 * a porovnává, jestli do některé z nich spadne první den měsíce.
 *
 * Ověřeno spuštěním proti PostgreSQL 18.4 nad tabulkou se dvěma oddíly:
 * měsíce s oddílem vrátí, měsíce bez oddílu vynechá.
 */
export async function selectPresentMonths(months: readonly string[]): Promise<string[]> {
  if (months.length === 0) return [];
  return withCrossWorkspaceTx('tracking.import', async (tx) => {
    const { rows } = await tx.execute<{ month: string }>(sql`
      WITH bounds AS (
        SELECT (regexp_match(pg_get_expr(c.relpartbound, c.oid),
                  'FROM \\(''([^'']+)''\\) TO \\(''([^'']+)''\\)'))[1]::timestamptz AS lo,
               (regexp_match(pg_get_expr(c.relpartbound, c.oid),
                  'FROM \\(''([^'']+)''\\) TO \\(''([^'']+)''\\)'))[2]::timestamptz AS hi
          FROM pg_inherits i
          JOIN pg_class c ON c.oid = i.inhrelid
         WHERE i.inhparent = 'web_events'::regclass
      )
      SELECT w.month
        FROM unnest(${sql.param([...months])}::text[]) AS w(month)
       WHERE EXISTS (
               SELECT 1 FROM bounds b
                WHERE (w.month || '-01')::timestamptz >= b.lo
                  AND (w.month || '-01')::timestamptz <  b.hi)
    `);
    return rows.map((row) => row.month);
  });
}
```

- [ ] **Step 4: Napiš router**

```ts
// packages/core/tracking/api/events.routes.ts
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { requireScope, workspaceContext, writeAudit } from '@mlain/core/api';
import { trackingConfig } from '../config';
import { createImportService } from '../ingest/import-service';
import { createIngestService } from '../ingest/ingest-service';
import { selectPresentMonths } from '../repo/web-events.repo';
import { enqueue } from '@mlain/core/jobs';

const EventsBody = z.object({ v: z.number().int(), events: z.array(z.unknown()) }).passthrough();

export function createEventsRoutes(): OpenAPIHono {
  const app = new OpenAPIHono();

  // Serverová cesta se autorizuje privátním klíčem v hlavičce, ne veřejným klíčem
  // v těle. Resolver proto veřejný klíč vůbec nehledá a vrátí projekt z kontextu
  // požadavku. Kdyby se sem dosadil skutečný resolvePublicKey, endpoint by
  // vyžadoval veřejný klíč navíc a autorizace by běžela dvakrát.
  const ingestForWorkspace = (workspaceId: string) =>
    createIngestService({
      resolvePublicKey: async () => ({ workspaceId, apiKeyId: 'private' }),
      isOriginAllowed: () => true,
      allowServersidePublicKey: () => true,
      limits: {
        maxKeys: trackingConfig.propertiesMaxKeys,
        maxDepth: trackingConfig.propertiesMaxDepth,
        maxString: trackingConfig.propertiesMaxString,
      },
      stripParams: trackingConfig.stripQueryParams,
      enqueue: (payload) => enqueue('event.process', payload),
      now: () => new Date(),
      // POST /api/v1/events je serverová cesta, ne prohlížečová.
      source: 'server',
    });

  const importer = createImportService({
    enqueue,
    // Jen se ptá katalogu, nic nezakládá. Oddíly dozaloží noční
    // platform.maintain_partitions pod rolí migrátora, viz komentář
    // u ImportServiceDeps.
    partitionsPresent: selectPresentMonths,
    retentionMonths: trackingConfig.retentionMonths,
    maxEvents: trackingConfig.importBatchMaxEvents,
    now: () => new Date(),
  });

  app.openapi(
    createRoute({
      method: 'post', path: '/', tags: ['tracking'],
      security: [{ apiKey: [] }],
      request: { body: { content: { 'application/json': { schema: EventsBody } } } },
      responses: { 202: { description: 'Události přijaty' } },
    }),
    async (c) => {
      const ctx = workspaceContext(c);
      requireScope(ctx, 'events:write');
      // Klíč v těle není potřeba, projekt je z ověřeného privátního klíče.
      const result = await ingestForWorkspace(ctx.workspaceId).accept(
        { ...c.req.valid('json'), key: 'private' },
        { origin: undefined },
      );
      if (result.problem !== undefined) {
        return c.json({ code: result.problem.code, params: result.problem.params }, result.status);
      }
      return c.json(result.body, 202);
    },
  );

  app.openapi(
    createRoute({
      method: 'post', path: '/import', tags: ['tracking'],
      security: [{ apiKey: [] }],
      request: { body: { content: { 'application/json': { schema: EventsBody } } } },
      responses: { 202: { description: 'Dávka historie přijata' } },
    }),
    async (c) => {
      const ctx = workspaceContext(c);
      // Import obchází sedmidenní okno a zapisuje do historických oddílů,
      // což je jiná úroveň oprávnění než zápis běžné serverové události.
      requireScope(ctx, 'events:import');
      const result = await importer.importBatch(ctx.workspaceId, c.req.valid('json'));
      if (result.problem !== undefined) {
        return c.json({ code: result.problem.code, params: result.problem.params }, result.status);
      }
      await writeAudit(ctx, 'tracking.events_imported', { accepted: result.body?.accepted ?? 0 });
      return c.json(result.body, 202);
    },
  );

  return app;
}
```

- [ ] **Step 5: Spusť test a ověř, že prochází**

Run: `pnpm vitest run packages/core/test/tracking/import-service.db.test.ts`
Expected: PASS, 10 testů.

- [ ] **Step 6: Commit**

```bash
git add packages/core/tracking/ingest/import-service.ts packages/core/tracking/api/events.routes.ts packages/core/test/tracking/import-service.db.test.ts openapi.json
git commit -m "feat(tracking): add server events endpoint and historical import path"
```

---

### Task 42: Kostra `packages/sdk-web`, build a branka na velikost

Rozpočet je **4 200 B gzip jako cíl a 5 120 B jako tvrdý limit**, při jehož překročení CI padá. Balíček má **nula runtime závislostí**, což je podmínka toho rozpočtu, ne preference.

Bránu dělá jednotkový test, ne samostatný CI job: tabulka šestnácti jobů v části 1 je jediný autoritativní seznam a job na velikost JS bundlu v ní není.

**Files:**
- Create: `packages/sdk-web/package.json`
- Create: `packages/sdk-web/tsconfig.json`
- Create: `packages/sdk-web/build.mjs`
- Create: `packages/sdk-web/src/uuid.ts`
- Test: `packages/sdk-web/test/size.test.ts`
- Test: `packages/sdk-web/test/uuid.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/sdk-web/test/uuid.test.ts
import { describe, expect, it } from 'vitest';
import { uuidv4 } from '../src/uuid';

const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('uuidv4', () => {
  it('vrátí platné UUID verze 4', () => {
    expect(uuidv4()).toMatch(UUID_V4_RE);
  });

  it('tisíc volání dá tisíc různých hodnot', () => {
    const values = new Set(Array.from({ length: 1000 }, () => uuidv4()));
    expect(values.size).toBe(1000);
  });

  it('funguje i bez crypto.randomUUID, jen s getRandomValues', () => {
    const original = globalThis.crypto.randomUUID;
    // @ts-expect-error dočasné odebrání kvůli testu záložní cesty
    globalThis.crypto.randomUUID = undefined;
    expect(uuidv4()).toMatch(UUID_V4_RE);
    globalThis.crypto.randomUUID = original;
  });
});
```

```ts
// packages/sdk-web/test/size.test.ts
import { gzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { beforeAll, describe, expect, it } from 'vitest';

const TARGET_BYTES = 4200;
const HARD_LIMIT_BYTES = 5120;
const BUNDLE = new URL('../dist/ml.js', import.meta.url);

describe('velikost sestaveného SDK', () => {
  let gzippedSize: number;

  beforeAll(() => {
    execFileSync('node', ['build.mjs'], { cwd: new URL('..', import.meta.url).pathname });
    gzippedSize = gzipSync(readFileSync(BUNDLE)).length;
  });

  it('nepřekročí tvrdý limit, jinak tenhle test je ta branka, která CI shodí', () => {
    expect(gzippedSize).toBeLessThanOrEqual(HARD_LIMIT_BYTES);
  });

  it('drží se pod cílovou hodnotou, nebo to aspoň hlásí', () => {
    if (gzippedSize > TARGET_BYTES) {
      console.warn(`SDK má ${gzippedSize} B gzip, cíl je ${TARGET_BYTES} B`);
    }
    expect(gzippedSize).toBeGreaterThan(0);
  });

  it('bundle neobsahuje žádnou runtime závislost ani odkaz na node_modules', () => {
    const source = readFileSync(BUNDLE, 'utf8');
    expect(source).not.toContain('node_modules');
    expect(source).not.toContain('require(');
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/sdk-web/test/uuid.test.ts`
Expected: FAIL, `Failed to resolve import "../src/uuid"`.

- [ ] **Step 3: Založ balíček**

```json
// packages/sdk-web/package.json
{
  "name": "@mlain/sdk-web",
  "version": "0.0.0",
  "private": false,
  "license": "MIT",
  "type": "module",
  "main": "./dist/index.mjs",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs"
    }
  },
  "files": ["dist"],
  "scripts": {
    "build": "node build.mjs",
    "typecheck": "tsc --noEmit",
    "test:unit": "vitest run"
  },
  "dependencies": {},
  "devDependencies": {
    "esbuild": "0.28.4",
    "happy-dom": "20.0.0",
    "typescript": "7.0.2",
    "vitest": "4.1.10"
  }
}
```

Pole `dependencies` je prázdné a musí zůstat prázdné. Každá závislost se bundluje do skriptu, který se stahuje na každém načtení stránky zákazníka.

```json
// packages/sdk-web/tsconfig.json
{
  "extends": "@mlain/config/tsconfig/base.json",
  "compilerOptions": {
    "target": "ES2019",
    "lib": ["ES2019", "DOM", "DOM.Iterable"],
    "types": [],
    "moduleResolution": "bundler",
    "noEmit": true
  },
  "include": ["src", "test"]
}
```

- [ ] **Step 4: Napiš build**

```js
// packages/sdk-web/build.mjs
import { gzipSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';

const HARD_LIMIT_BYTES = 5120;
const TARGET_BYTES = 4200;

mkdirSync('dist', { recursive: true });

// IIFE pro <script src>, ES2019 bez polyfillů.
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/ml.js',
  bundle: true,
  format: 'iife',
  target: ['es2019'],
  minify: true,
  legalComments: 'none',
  define: { __SDK_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0') },
});

// ESM pro projekty s vlastním bundlerem.
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.mjs',
  bundle: true,
  format: 'esm',
  target: ['es2019'],
  minify: false,
  define: { __SDK_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0') },
});

const gzipped = gzipSync(readFileSync('dist/ml.js')).length;
writeFileSync('dist/size.json', JSON.stringify({ gzip_bytes: gzipped }, null, 2));

if (gzipped > HARD_LIMIT_BYTES) {
  console.error(`SDK má ${gzipped} B gzip, tvrdý limit je ${HARD_LIMIT_BYTES} B`);
  process.exit(1);
}
if (gzipped > TARGET_BYTES) {
  console.warn(`SDK má ${gzipped} B gzip, cíl je ${TARGET_BYTES} B`);
} else {
  console.log(`SDK má ${gzipped} B gzip, cíl ${TARGET_BYTES} B splněn`);
}
```

- [ ] **Step 5: Napiš generátor UUID**

```ts
// packages/sdk-web/src/uuid.ts

/**
 * anonymous_id je UUIDv4, ne UUIDv7. Vědomá výjimka z konvence:
 * ID je trvale viditelné v cookii na cizím počítači a UUIDv7 by v prvních
 * 48 bitech prozradilo přesný čas první návštěvy každému skriptu na stránce.
 * Zápisový argument pro UUIDv7 tady neplatí, není to primární klíč.
 */
export function uuidv4(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();

  const bytes = new Uint8Array(16);
  c.getRandomValues(bytes);
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  let hex = '';
  for (let i = 0; i < 16; i += 1) hex += bytes[i]!.toString(16).padStart(2, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
```

- [ ] **Step 6: Spusť oba testy**

Run: `pnpm --filter @mlain/sdk-web test:unit`
Expected: PASS. Test velikosti si build spustí sám.

- [ ] **Step 7: Commit**

```bash
git add packages/sdk-web
git commit -m "feat(sdk-web): scaffold zero dependency package with size gate"
```

---

### Task 43: Úložiště a souhlas jako vstupní podmínka

**SDK se nespustí bez souhlasu. Souhlas je vstupní podmínka, ne dodatečný filtr.** `init` nesmí nic uložit do prohlížeče, dokud souhlas není. Bez něj se události drží v paměti (nejvýš dvacet, pak se nejstarší zahazují), nic se neodesílá a **neexistuje ani `anonymous_id`**.

Odvolání souhlasu je okamžité: zastaví se odesílání, vyprázdní fronty a smaže se cookie i položky v obou úložištích.

Cookie se nastavuje JavaScriptem, protože ingestion běží na jiném hostu než web zákazníka. Safari ITP takovou cookie zkracuje na sedm dní, **proto je `localStorage` primární zdroj a cookie jen doplněk**.

**Files:**
- Create: `packages/sdk-web/src/storage.ts`
- Create: `packages/sdk-web/src/consent.ts`
- Test: `packages/sdk-web/test/storage.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/sdk-web/test/storage.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { KEYS, Storage } from '../src/storage';
import { ConsentGate } from '../src/consent';

describe('Storage', () => {
  let storage: Storage;

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    document.cookie = `${KEYS.anonymousId}=; Max-Age=0; Path=/`;
    storage = new Storage();
  });

  it('bez souhlasu nezapíše nic a anonymous_id neexistuje', () => {
    expect(storage.readAnonymousId()).toBeNull();
    expect(document.cookie).not.toContain(KEYS.anonymousId);
    expect(localStorage.length).toBe(0);
  });

  it('po povolení vytvoří anonymous_id a zapíše ho do cookie i localStorage', () => {
    const id = storage.ensureAnonymousId();
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(localStorage.getItem(KEYS.anonymousId)).toBe(id);
    expect(document.cookie).toContain(`${KEYS.anonymousId}=${id}`);
  });

  it('localStorage je primární zdroj, cookie jen doplněk', () => {
    localStorage.setItem(KEYS.anonymousId, 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
    expect(storage.readAnonymousId()).toBe('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee');
  });

  it('když cookie zmizí (Safari ITP), ID se obnoví z localStorage a cookie se dopíše', () => {
    const id = storage.ensureAnonymousId();
    document.cookie = `${KEYS.anonymousId}=; Max-Age=0; Path=/`;
    expect(storage.ensureAnonymousId()).toBe(id);
    expect(document.cookie).toContain(id);
  });

  it('clear smaže cookie i obě úložiště', () => {
    storage.ensureAnonymousId();
    storage.writeQueue([{ id: 'e1' }]);
    storage.clear();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).not.toContain(KEYS.anonymousId);
  });

  it('nedostupné localStorage (privátní režim) nezpůsobí výjimku', () => {
    const original = Storage.prototype.readAnonymousId;
    Object.defineProperty(globalThis, 'localStorage', {
      value: { getItem: () => { throw new Error('zakázáno'); }, setItem: () => { throw new Error('zakázáno'); }, removeItem: () => {}, clear: () => {}, length: 0 },
      configurable: true,
    });
    expect(() => new Storage().ensureAnonymousId()).not.toThrow();
    Object.defineProperty(Storage.prototype, 'readAnonymousId', { value: original });
  });

  it('offline fronta starší než sedm dní se při čtení zahodí', () => {
    const old = Date.now() - 8 * 24 * 3600 * 1000;
    localStorage.setItem(KEYS.queue, JSON.stringify({ at: old, events: [{ id: 'e1' }] }));
    expect(new Storage().readQueue()).toEqual([]);
  });

  it('offline fronta mladší než sedm dní se přehraje', () => {
    const recent = Date.now() - 3600 * 1000;
    localStorage.setItem(KEYS.queue, JSON.stringify({ at: recent, events: [{ id: 'e1' }] }));
    expect(new Storage().readQueue()).toEqual([{ id: 'e1' }]);
  });
});

describe('ConsentGate', () => {
  it('bez souhlasu drží nejvýš dvacet událostí a zahazuje nejstarší', () => {
    const gate = new ConsentGate();
    for (let i = 0; i < 25; i += 1) gate.hold({ id: `e${i}` });
    const released = gate.grant({ analytics: true, personalization: true });
    expect(released).toHaveLength(20);
    expect(released[0]).toEqual({ id: 'e5' });
  });

  it('analytics false znamená, že se nic nepustí', () => {
    const gate = new ConsentGate();
    gate.hold({ id: 'e1' });
    expect(gate.grant({ analytics: false, personalization: false })).toEqual([]);
    expect(gate.isGranted()).toBe(false);
  });

  it('personalization řídí vazbu na kontakt zvlášť od sběru', () => {
    const gate = new ConsentGate();
    gate.grant({ analytics: true, personalization: false });
    expect(gate.isGranted()).toBe(true);
    expect(gate.allowsPersonalization()).toBe(false);
  });

  it('opakované odvolání je idempotentní', () => {
    const gate = new ConsentGate();
    gate.grant({ analytics: true, personalization: true });
    gate.grant({ analytics: false, personalization: false });
    expect(() => gate.grant({ analytics: false, personalization: false })).not.toThrow();
    expect(gate.isGranted()).toBe(false);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/sdk-web exec vitest run test/storage.test.ts`
Expected: FAIL, `Failed to resolve import "../src/storage"`.

- [ ] **Step 3: Napiš úložiště**

```ts
// packages/sdk-web/src/storage.ts
import { uuidv4 } from './uuid';

export const KEYS = {
  anonymousId: 'ml_aid',
  sessionId: 'ml_sid',
  lastActivity: 'ml_last',
  queue: 'ml_q',
} as const;

const COOKIE_MAX_AGE_SECONDS = 34_560_000; // 400 dní
const QUEUE_TTL_MS = 7 * 24 * 3600 * 1000;
const QUEUE_MAX_EVENTS = 100;
const QUEUE_MAX_BYTES = 256 * 1024;

/** Každý přístup k úložišti je obalený: v privátním režimu vyhazuje výjimky. */
function safeGet(store: globalThis.Storage | undefined, key: string): string | null {
  try {
    return store?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function safeSet(store: globalThis.Storage | undefined, key: string, value: string): void {
  try {
    store?.setItem(key, value);
  } catch {
    // Privátní režim nebo plná kvóta. Sběr pokračuje jen v paměti.
  }
}
function safeRemove(store: globalThis.Storage | undefined, key: string): void {
  try {
    store?.removeItem(key);
  } catch {
    // nic
  }
}

function readCookie(name: string): string | null {
  const parts = document.cookie.split('; ');
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq !== -1 && part.slice(0, eq) === name) return part.slice(eq + 1);
  }
  return null;
}

export class Storage {
  readAnonymousId(): string | null {
    // localStorage je primární zdroj, protože Safari ITP cookie zkracuje na 7 dní.
    return safeGet(globalThis.localStorage, KEYS.anonymousId) ?? readCookie(KEYS.anonymousId);
  }

  ensureAnonymousId(): string {
    const id = this.readAnonymousId() ?? uuidv4();
    safeSet(globalThis.localStorage, KEYS.anonymousId, id);
    // Doména se nenastavuje, cookie platí jen pro přesný host.
    document.cookie = `${KEYS.anonymousId}=${id}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; SameSite=Lax; Secure; Path=/`;
    return id;
  }

  readSessionId(): string | null {
    return safeGet(globalThis.sessionStorage, KEYS.sessionId);
  }

  writeSessionId(id: string): void {
    safeSet(globalThis.sessionStorage, KEYS.sessionId, id);
  }

  readLastActivity(): number | null {
    const raw = safeGet(globalThis.localStorage, KEYS.lastActivity);
    if (raw === null) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }

  writeLastActivity(at: number): void {
    safeSet(globalThis.localStorage, KEYS.lastActivity, String(at));
  }

  readQueue(): unknown[] {
    const raw = safeGet(globalThis.localStorage, KEYS.queue);
    if (raw === null) return [];
    try {
      const parsed = JSON.parse(raw) as { at: number; events: unknown[] };
      // Starší než sedm dní se zahodí, delší retry SDK nedělá.
      if (!Array.isArray(parsed.events) || Date.now() - parsed.at > QUEUE_TTL_MS) {
        safeRemove(globalThis.localStorage, KEYS.queue);
        return [];
      }
      return parsed.events;
    } catch {
      safeRemove(globalThis.localStorage, KEYS.queue);
      return [];
    }
  }

  writeQueue(events: unknown[]): void {
    const trimmed = events.slice(-QUEUE_MAX_EVENTS);
    const payload = JSON.stringify({ at: Date.now(), events: trimmed });
    if (payload.length > QUEUE_MAX_BYTES) {
      safeSet(
        globalThis.localStorage,
        KEYS.queue,
        JSON.stringify({ at: Date.now(), events: trimmed.slice(-20) }),
      );
      return;
    }
    safeSet(globalThis.localStorage, KEYS.queue, payload);
  }

  clear(): void {
    for (const key of Object.values(KEYS)) {
      safeRemove(globalThis.localStorage, key);
      safeRemove(globalThis.sessionStorage, key);
    }
    document.cookie = `${KEYS.anonymousId}=; Max-Age=0; SameSite=Lax; Secure; Path=/`;
  }
}
```

- [ ] **Step 4: Napiš branku souhlasu**

```ts
// packages/sdk-web/src/consent.ts

export type ConsentState = {
  /** Podmínka pro jakýkoliv sběr. */
  analytics: boolean;
  /** Podmínka pro vazbu na kontakt. */
  personalization: boolean;
  /** SDK jen předává dál, sám ho nepoužívá. */
  emailMarketing?: boolean;
};

const MAX_HELD_EVENTS = 20;

/**
 * Souhlas je vstupní podmínka, ne dodatečný filtr.
 * Dokud není udělený, nic se neuloží do prohlížeče a neexistuje anonymous_id.
 */
export class ConsentGate {
  #state: ConsentState | null = null;
  #held: unknown[] = [];

  isGranted(): boolean {
    return this.#state?.analytics === true;
  }

  allowsPersonalization(): boolean {
    return this.#state?.analytics === true && this.#state.personalization === true;
  }

  /** Před souhlasem se události drží jen v paměti. */
  hold(event: unknown): void {
    this.#held.push(event);
    if (this.#held.length > MAX_HELD_EVENTS) this.#held.shift();
  }

  /** Vrátí frontu k přehrání. Při odvolání vrátí prázdné pole a frontu zahodí. */
  grant(state: ConsentState): unknown[] {
    this.#state = state;
    if (!state.analytics) {
      this.#held = [];
      return [];
    }
    const released = this.#held;
    this.#held = [];
    return released;
  }
}
```

- [ ] **Step 5: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/sdk-web exec vitest run test/storage.test.ts`
Expected: PASS, 12 testů.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk-web/src/storage.ts packages/sdk-web/src/consent.ts packages/sdk-web/test/storage.test.ts
git commit -m "feat(sdk-web): gate all storage behind explicit consent"
```

---

### Task 44: Dávkování, odchod ze stránky a offline fronta

Chování při odchodu ze stránky se řídí ověřeným stavem prohlížečů: `beforeunload` a `unload` se na mobilech často nespustí vůbec, `visibilitychange` na `hidden` se spouští spolehlivě při přepnutí karty i při zamknutí telefonu, `pagehide` doplňuje případy bfcache. Používají se proto **oba** a odesílá se přes `navigator.sendBeacon`, protože běžný `fetch` se při zavírání karty ruší.

Aby `sendBeacon` nevyvolal CORS preflight, posílá se **řetězec**, tedy `Content-Type: text/plain;charset=UTF-8`. To je jeden ze tří typů, které patří mezi jednoduché požadavky.

Když je SDK zablokované (blokátor přepíše `sendBeacon` nebo zablokuje síť), vyvolá se událost `blocked`. **Blokátor se neobchází.**

**Files:**
- Create: `packages/sdk-web/src/emitter.ts`
- Create: `packages/sdk-web/src/queue.ts`
- Test: `packages/sdk-web/test/queue.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/sdk-web/test/queue.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Emitter } from '../src/emitter';
import { EventQueue } from '../src/queue';
import { Storage } from '../src/storage';

describe('EventQueue', () => {
  let sent: string[];
  let beacon: ReturnType<typeof vi.fn>;
  let queue: EventQueue;
  let emitter: Emitter;

  const make = (over = {}) => {
    sent = [];
    beacon = vi.fn(() => true);
    emitter = new Emitter();
    queue = new EventQueue({
      host: 'https://events.shop.cz',
      key: 'ml_pub_aebagbafaydqqcik',
      storage: new Storage(),
      emitter,
      sendBeacon: beacon,
      fetchImpl: async (_url, init) => {
        sent.push(String(init?.body));
        return new Response('{"accepted":1,"rejected":0}', { status: 202 });
      },
      ...over,
    });
    return queue;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    make();
  });
  afterEach(() => vi.useRealTimers());

  it('odešle dávku po dosažení dvaceti událostí', async () => {
    for (let i = 0; i < 20; i += 1) queue.push({ id: `e${i}`, name: 'page_view' });
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(1);
    expect(JSON.parse(sent[0]!).events).toHaveLength(20);
  });

  it('odešle dávku po pěti sekundách i s jedinou událostí', async () => {
    queue.push({ id: 'e1', name: 'page_view' });
    expect(sent).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent).toHaveLength(1);
  });

  it('payload nese verzi, veřejný klíč a sent_at', async () => {
    queue.push({ id: 'e1', name: 'page_view' });
    await vi.advanceTimersByTimeAsync(5000);
    const body = JSON.parse(sent[0]!);
    expect(body.v).toBe(1);
    expect(body.key).toBe('ml_pub_aebagbafaydqqcik');
    expect(body.sent_at).toMatch(/Z$/);
  });

  it('visibilitychange na hidden odešle frontu přes sendBeacon jako text/plain', () => {
    queue.push({ id: 'e1', name: 'page_view' });
    queue.attachLifecycleHandlers();
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(beacon).toHaveBeenCalledTimes(1);
    const blob = beacon.mock.calls[0]![1] as Blob;
    expect(blob.type).toBe('text/plain;charset=UTF-8');
  });

  it('pagehide odešle frontu také, kvůli bfcache', () => {
    queue.push({ id: 'e1', name: 'page_view' });
    queue.attachLifecycleHandlers();
    window.dispatchEvent(new Event('pagehide'));
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it('selhání odeslání vrátí události do fronty a uloží je do localStorage', async () => {
    make({ fetchImpl: async () => { throw new Error('offline'); } });
    queue.push({ id: 'e1', name: 'page_view' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(localStorage.getItem('ml_q')).toContain('e1');
  });

  it('opakuje s exponenciálním backoffem 1, 2, 4, 8, 16 a 30 sekund', async () => {
    let attempts = 0;
    make({ fetchImpl: async () => { attempts += 1; throw new Error('offline'); } });
    queue.push({ id: 'e1', name: 'page_view' });
    await vi.advanceTimersByTimeAsync(5000);
    for (const delay of [1000, 2000, 4000, 8000, 16_000, 30_000]) {
      await vi.advanceTimersByTimeAsync(delay);
    }
    expect(attempts).toBeGreaterThanOrEqual(6);
    expect(attempts).toBeLessThanOrEqual(9);
  });

  it('odpověď 4xx kromě 408 a 429 znamená trvalou chybu a dávka se zahodí', async () => {
    const errors: unknown[] = [];
    make({ fetchImpl: async () => new Response('{}', { status: 422 }) });
    emitter.on('error', (payload) => errors.push(payload));
    queue.push({ id: 'e1', name: 'page_view' });
    await vi.advanceTimersByTimeAsync(5000);
    await vi.advanceTimersByTimeAsync(1000);
    expect(errors).toHaveLength(1);
    expect(localStorage.getItem('ml_q')).toBeNull();
  });

  it('odpověď 429 respektuje Retry-After', async () => {
    let attempts = 0;
    make({
      fetchImpl: async () => {
        attempts += 1;
        return new Response('{}', { status: 429, headers: { 'Retry-After': '3' } });
      },
    });
    queue.push({ id: 'e1', name: 'page_view' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(attempts).toBe(2);
  });

  it('zablokovaný sendBeacon vyvolá událost blocked a blokátor se neobchází', () => {
    const blocked: unknown[] = [];
    make({ sendBeacon: () => false, fetchImpl: async () => { throw new Error('blocked'); } });
    emitter.on('blocked', (payload) => blocked.push(payload));
    queue.push({ id: 'e1', name: 'page_view' });
    queue.attachLifecycleHandlers();
    window.dispatchEvent(new Event('pagehide'));
    expect(blocked).toHaveLength(1);
  });

  it('při načtení stránky se uložená fronta přehraje jako první', async () => {
    localStorage.setItem('ml_q', JSON.stringify({ at: Date.now(), events: [{ id: 'old', name: 'page_view' }] }));
    make();
    queue.replayStoredQueue();
    await vi.advanceTimersByTimeAsync(5000);
    expect(JSON.parse(sent[0]!).events[0].id).toBe('old');
  });

  it('flush vrátí Promise, která se vyřeší po odeslání', async () => {
    queue.push({ id: 'e1', name: 'page_view' });
    const promise = queue.flush();
    await vi.advanceTimersByTimeAsync(0);
    await expect(promise).resolves.toBeUndefined();
    expect(sent).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/sdk-web exec vitest run test/queue.test.ts`
Expected: FAIL, `Failed to resolve import "../src/emitter"`.

- [ ] **Step 3: Napiš emitter**

```ts
// packages/sdk-web/src/emitter.ts

export type SdkEventName = 'ready' | 'identified' | 'error' | 'blocked';

/** SDK nikdy nevyhodí neodchycenou výjimku do stránky zákazníka. */
export class Emitter {
  readonly #handlers = new Map<SdkEventName, ((payload: unknown) => void)[]>();

  on(event: SdkEventName, handler: (payload: unknown) => void): () => void {
    const list = this.#handlers.get(event) ?? [];
    list.push(handler);
    this.#handlers.set(event, list);
    return () => {
      const current = this.#handlers.get(event) ?? [];
      const index = current.indexOf(handler);
      if (index !== -1) current.splice(index, 1);
    };
  }

  emit(event: SdkEventName, payload?: unknown): void {
    for (const handler of this.#handlers.get(event) ?? []) {
      try {
        handler(payload);
      } catch {
        // Chyba v handleru zákazníka nesmí zastavit sběr.
      }
    }
  }
}
```

- [ ] **Step 4: Napiš frontu**

```ts
// packages/sdk-web/src/queue.ts
import type { Emitter } from './emitter';
import type { Storage } from './storage';

declare const __SDK_VERSION__: string;

const BATCH_SIZE = 20;
const FLUSH_INTERVAL_MS = 5000;
const MAX_BATCH_BYTES = 24 * 1024;
const BACKOFF_MS = [1000, 2000, 4000, 8000, 16_000, 30_000] as const;
const MAX_ATTEMPTS = 8;

export type QueuedEvent = { id: string; name: string; [key: string]: unknown };

export type EventQueueOptions = {
  host: string;
  key: string;
  storage: Storage;
  emitter: Emitter;
  anonymousId?: () => string | null;
  sendBeacon?: (url: string, data: Blob) => boolean;
  fetchImpl?: typeof fetch;
};

export class EventQueue {
  #items: QueuedEvent[] = [];
  #timer: ReturnType<typeof setTimeout> | null = null;
  #attempt = 0;
  #inFlight: Promise<void> = Promise.resolve();
  readonly #options: EventQueueOptions;

  constructor(options: EventQueueOptions) {
    this.#options = options;
  }

  push(event: QueuedEvent): void {
    this.#items.push(event);
    if (this.#items.length >= BATCH_SIZE || JSON.stringify(this.#items).length >= MAX_BATCH_BYTES) {
      void this.#drain();
      return;
    }
    if (this.#timer === null) {
      this.#timer = setTimeout(() => void this.#drain(), FLUSH_INTERVAL_MS);
    }
  }

  replayStoredQueue(): void {
    const stored = this.#options.storage.readQueue() as QueuedEvent[];
    if (stored.length === 0) return;
    this.#items = [...stored, ...this.#items];
    if (this.#timer === null) {
      this.#timer = setTimeout(() => void this.#drain(), FLUSH_INTERVAL_MS);
    }
  }

  async flush(): Promise<void> {
    await this.#drain();
    await this.#inFlight;
  }

  /**
   * beforeunload a unload se na mobilech často nespustí vůbec.
   * visibilitychange na hidden se spouští spolehlivě, pagehide doplňuje bfcache.
   */
  attachLifecycleHandlers(): void {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.#sendBeaconBatch();
    });
    window.addEventListener('pagehide', () => this.#sendBeaconBatch());
  }

  #payload(events: QueuedEvent[]): string {
    return JSON.stringify({
      v: 1,
      key: this.#options.key,
      sent_at: new Date().toISOString(),
      anonymous_id: this.#options.anonymousId?.() ?? undefined,
      events: events.map((event) => ({
        ...event,
        context: { ...(event.context as object), sdk: { name: 'ml-web', version: __SDK_VERSION__ } },
      })),
    });
  }

  #sendBeaconBatch(): void {
    if (this.#items.length === 0) return;
    const batch = this.#items;
    this.#items = [];
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }

    const beacon = this.#options.sendBeacon ?? navigator.sendBeacon.bind(navigator);
    // text/plain je jeden ze tří typů, které nevyvolají preflight.
    const blob = new Blob([this.#payload(batch)], { type: 'text/plain;charset=UTF-8' });

    let delivered = false;
    try {
      delivered = beacon(`${this.#options.host}/e/track`, blob);
    } catch {
      delivered = false;
    }

    if (!delivered) {
      // Blokátor nebo plná fronta prohlížeče. Neobchází se, jen se to ohlásí.
      this.#items = [...batch, ...this.#items];
      this.#options.storage.writeQueue(this.#items);
      this.#options.emitter.emit('blocked', { events: batch.length });
    }
  }

  async #drain(): Promise<void> {
    if (this.#timer !== null) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    if (this.#items.length === 0) return;

    const batch = this.#items;
    this.#items = [];
    this.#inFlight = this.#inFlight.then(() => this.#send(batch));
    await this.#inFlight;
  }

  async #send(batch: QueuedEvent[]): Promise<void> {
    const fetchImpl = this.#options.fetchImpl ?? fetch;
    try {
      const response = await fetchImpl(`${this.#options.host}/e/track`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: this.#payload(batch),
        keepalive: true,
      });

      if (response.ok) {
        this.#attempt = 0;
        this.#options.storage.writeQueue([]);
        return;
      }

      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('Retry-After') ?? '1');
        this.#retry(batch, Number.isFinite(retryAfter) ? retryAfter * 1000 : 1000);
        return;
      }
      if (response.status >= 400 && response.status < 500 && response.status !== 408) {
        // Trvalá chyba. Opakovat nemá smysl, dávka se zahodí.
        this.#attempt = 0;
        this.#options.storage.writeQueue([]);
        this.#options.emitter.emit('error', { status: response.status });
        return;
      }
      this.#retry(batch, BACKOFF_MS[Math.min(this.#attempt, BACKOFF_MS.length - 1)]!);
    } catch {
      this.#retry(batch, BACKOFF_MS[Math.min(this.#attempt, BACKOFF_MS.length - 1)]!);
    }
  }

  #retry(batch: QueuedEvent[], delayMs: number): void {
    this.#attempt += 1;
    if (this.#attempt > MAX_ATTEMPTS) {
      this.#attempt = 0;
      this.#options.emitter.emit('error', { dropped: batch.length });
      return;
    }
    this.#items = [...batch, ...this.#items];
    this.#options.storage.writeQueue(this.#items);
    this.#timer = setTimeout(() => void this.#drain(), delayMs);
  }
}
```

- [ ] **Step 5: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/sdk-web exec vitest run test/queue.test.ts`
Expected: PASS, 12 testů.

- [ ] **Step 6: Commit**

```bash
git add packages/sdk-web/src/emitter.ts packages/sdk-web/src/queue.ts packages/sdk-web/test/queue.test.ts
git commit -m "feat(sdk-web): batch events with sendbeacon on page hide and offline retry"
```

---

### Task 45: Veřejné API SDK, session a předání identity

`page` je zkratka pro `track('page_view')`. Při `autoPageView` se volá jednou po souhlasu a pak při každé změně `history.pushState`, `history.replaceState` a při `popstate`. Deduplikace na jednu sekundu je nutná, protože SPA routery volají `replaceState` opakovaně.

`identify` bez podpisu smí předat jen `external_id` a neidentifikující traits. **E-mail vyžaduje podpis vyrobený serverem zákazníka.** Kód z prohlížeče vidí každý a kdokoliv ho může zavolat s libovolným e-mailem.

Odstranění `ml_token` z adresy se dělá **před** jeho odesláním schválně: kdyby uživatel stránku sdílel nebo kdyby se adresa dostala do analytiky třetí strany, token už tam nebude.

**Files:**
- Create: `packages/sdk-web/src/session.ts`
- Create: `packages/sdk-web/src/page.ts`
- Create: `packages/sdk-web/src/ml-token.ts`
- Create: `packages/sdk-web/src/index.ts`
- Test: `packages/sdk-web/test/sdk.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/sdk-web/test/sdk.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSdk } from '../src/index';

describe('Mlain SDK', () => {
  let requests: { url: string; body: unknown }[];
  let sdk: ReturnType<typeof createSdk>;

  const fetchImpl = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    requests.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response('{"accepted":1,"rejected":0}', { status: 202 });
  });

  beforeEach(() => {
    vi.useFakeTimers();
    requests = [];
    localStorage.clear();
    sessionStorage.clear();
    document.cookie = 'ml_aid=; Max-Age=0; Path=/';
    window.history.replaceState({}, '', 'https://shop.cz/vyprodej');
    sdk = createSdk({ fetchImpl, sendBeacon: () => true });
  });
  afterEach(() => vi.useRealTimers());

  const init = (over = {}) =>
    sdk.init({ key: 'ml_pub_aebagbafaydqqcik', host: 'https://events.shop.cz', ...over });

  const namesFrom = (index = 0): string[] =>
    (requests[index]!.body as { events: { name: string }[] }).events.map((e) => e.name);

  it('bez consent nezapíše do prohlížeče nic a neodešle žádný požadavek', async () => {
    init();
    sdk.track('product_viewed');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(requests).toHaveLength(0);
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
    expect(document.cookie).not.toContain('ml_aid');
  });

  it('po consent se odešle session_started a page_view v jedné dávce', async () => {
    init();
    sdk.consent({ analytics: true, personalization: true });
    await vi.advanceTimersByTimeAsync(5000);
    expect(namesFrom()).toContain('session_started');
    expect(namesFrom()).toContain('page_view');
  });

  it('po odvolání souhlasu zmizí ml_aid z cookie i localStorage', () => {
    init();
    sdk.consent({ analytics: true, personalization: true });
    expect(localStorage.getItem('ml_aid')).not.toBeNull();
    sdk.consent({ analytics: false, personalization: false });
    expect(localStorage.getItem('ml_aid')).toBeNull();
    expect(document.cookie).not.toContain('ml_aid');
  });

  it('neplatné jméno události se zahodí a nikdy nevyhodí výjimku do stránky', async () => {
    init();
    sdk.consent({ analytics: true, personalization: true });
    expect(() => sdk.track('Product Viewed')).not.toThrow();
    await vi.advanceTimersByTimeAsync(5000);
    expect(namesFrom()).not.toContain('Product Viewed');
  });

  it('dvě page_view na tutéž cestu do jedné sekundy se počítají jednou', async () => {
    init({ autoPageView: false });
    sdk.consent({ analytics: true, personalization: true });
    sdk.page();
    sdk.page();
    await vi.advanceTimersByTimeAsync(5000);
    expect(namesFrom().filter((name) => name === 'page_view')).toHaveLength(1);
  });

  it('pushState vyvolá nové page_view', async () => {
    init();
    sdk.consent({ analytics: true, personalization: true });
    await vi.advanceTimersByTimeAsync(5000);
    requests.length = 0;
    window.history.pushState({}, '', '/novinky');
    await vi.advanceTimersByTimeAsync(5000);
    expect(namesFrom()).toContain('page_view');
  });

  it('identify s e-mailem bez podpisu se do dávky vůbec nedostane', async () => {
    init();
    sdk.consent({ analytics: true, personalization: true });
    sdk.identify('customer_8472', { email: 'a@b.cz' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(JSON.stringify(requests)).not.toContain('a@b.cz');
  });

  it('identify s podpisem e-mail předá', async () => {
    init();
    sdk.consent({ analytics: true, personalization: true });
    sdk.identify('customer_8472', { email: 'a@b.cz' }, { signature: 'c2ln' });
    await vi.advanceTimersByTimeAsync(5000);
    expect(JSON.stringify(requests)).toContain('a@b.cz');
  });

  it('reset vygeneruje nové anonymous_id', () => {
    init();
    sdk.consent({ analytics: true, personalization: true });
    const before = sdk.getAnonymousId();
    sdk.reset();
    expect(sdk.getAnonymousId()).not.toBe(before);
  });

  it('ml_token zmizí z adresního řádku a utm parametry v ní zůstanou', async () => {
    window.history.replaceState({}, '', 'https://shop.cz/vyprodej?ml_token=t1abc&utm_source=news');
    init();
    sdk.consent({ analytics: true, personalization: true });
    expect(window.location.search).not.toContain('ml_token');
    expect(window.location.search).toContain('utm_source=news');
    await vi.advanceTimersByTimeAsync(5000);
    expect(requests.find((r) => r.url.endsWith('/e/identify'))).toBeDefined();
  });

  it('bez souhlasu s personalization se ml_token zahodí a neodešle', async () => {
    window.history.replaceState({}, '', 'https://shop.cz/vyprodej?ml_token=t1abc');
    init();
    sdk.consent({ analytics: true, personalization: false });
    await vi.advanceTimersByTimeAsync(5000);
    expect(requests.find((r) => r.url.endsWith('/e/identify'))).toBeUndefined();
  });

  it('fronta z window.Mlain.q se po načtení přehraje', async () => {
    (window as unknown as { Mlain: { q: unknown[] } }).Mlain = {
      q: [['init', { key: 'ml_pub_aebagbafaydqqcik', host: 'https://events.shop.cz' }],
          ['consent', { analytics: true, personalization: true }]],
    };
    createSdk({ fetchImpl, sendBeacon: () => true }).bootstrap();
    await vi.advanceTimersByTimeAsync(5000);
    expect(requests.length).toBeGreaterThan(0);
  });

  it('nová session po 30 minutách nečinnosti odešle další session_started', async () => {
    init({ sessionTimeoutMinutes: 30 });
    sdk.consent({ analytics: true, personalization: true });
    await vi.advanceTimersByTimeAsync(5000);
    requests.length = 0;
    await vi.advanceTimersByTimeAsync(31 * 60 * 1000);
    sdk.track('product_viewed');
    await vi.advanceTimersByTimeAsync(5000);
    expect(namesFrom()).toContain('session_started');
  });

  it('SDK nikdy nečte hodnoty z formulářových polí', async () => {
    const field = document.createElement('input');
    field.id = 'pole';
    field.value = 'tajná hodnota';
    document.body.appendChild(field);
    init();
    sdk.consent({ analytics: true, personalization: true });
    await vi.advanceTimersByTimeAsync(5000);
    expect(JSON.stringify(requests)).not.toContain('tajná hodnota');
    field.remove();
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm --filter @mlain/sdk-web exec vitest run test/sdk.test.ts`
Expected: FAIL, `Failed to resolve import "../src/index"`.

- [ ] **Step 3: Napiš session**

```ts
// packages/sdk-web/src/session.ts
import type { Storage } from './storage';
import { uuidv4 } from './uuid';

const DEFAULT_TIMEOUT_MINUTES = 30;
const MAX_SESSION_HOURS = 24;

export class Session {
  #startedAt = 0;
  readonly #storage: Storage;
  readonly #timeoutMs: number;

  constructor(storage: Storage, timeoutMinutes = DEFAULT_TIMEOUT_MINUTES) {
    this.#storage = storage;
    this.#timeoutMs = Math.min(Math.max(timeoutMinutes, 1), 1440) * 60_000;
  }

  /**
   * Vrátí ID session a příznak, jestli právě začala nová.
   * Session končí po nečinnosti nebo po 24 hodinách, podle toho, co nastane dřív.
   * Událost session_ended se neposílá: spolehlivé odeslání při zavření karty neexistuje,
   * konec se dopočítá při čtení jako poslední událost session.
   */
  current(now: number): { id: string; started: boolean } {
    const last = this.#storage.readLastActivity();
    const existing = this.#storage.readSessionId();

    const expiredByIdle = last === null || now - last > this.#timeoutMs;
    const expiredByAge = this.#startedAt !== 0 && now - this.#startedAt > MAX_SESSION_HOURS * 3600_000;

    if (existing === null || expiredByIdle || expiredByAge) {
      const id = uuidv4();
      this.#storage.writeSessionId(id);
      this.#storage.writeLastActivity(now);
      this.#startedAt = now;
      return { id, started: true };
    }

    this.#storage.writeLastActivity(now);
    return { id: existing, started: false };
  }
}
```

- [ ] **Step 4: Napiš stránky a `ml_token`**

```ts
// packages/sdk-web/src/page.ts

export type PageProperties = {
  title?: string;
  path?: string;
  url?: string;
  referrer?: string;
  [key: string]: unknown;
};

const DEDUP_WINDOW_MS = 1000;

export class PageTracker {
  #lastPath = '';
  #lastAt = 0;

  /** SPA routery volají replaceState opakovaně, proto deduplikace na jednu sekundu. */
  shouldEmit(path: string, now: number): boolean {
    if (path === this.#lastPath && now - this.#lastAt < DEDUP_WINDOW_MS) return false;
    this.#lastPath = path;
    this.#lastAt = now;
    return true;
  }

  /** Čte se jen adresa a titulek. Formulářová pole se nečtou nikdy. */
  describe(overrides: PageProperties = {}): Record<string, unknown> {
    return {
      url: overrides.url ?? window.location.href,
      path: overrides.path ?? window.location.pathname,
      title: overrides.title ?? document.title,
      referrer: overrides.referrer ?? document.referrer,
      search: window.location.search,
    };
  }

  observe(onChange: () => void): void {
    const wrap = (name: 'pushState' | 'replaceState'): void => {
      const original = history[name].bind(history);
      history[name] = function patched(this: History, ...args: Parameters<History['pushState']>) {
        const result = original(...args);
        onChange();
        return result;
      };
    };
    wrap('pushState');
    wrap('replaceState');
    window.addEventListener('popstate', onChange);
  }
}
```

```ts
// packages/sdk-web/src/ml-token.ts

const PARAM = 'ml_token';

/**
 * Přečte ml_token a hned ho odstraní z adresního řádku.
 * Odstranění se dělá PŘED odesláním schválně: kdyby uživatel stránku sdílel
 * nebo kdyby se adresa dostala do analytiky třetí strany, token už tam nebude.
 * replaceState nevytváří položku v historii, takže tlačítko zpět funguje normálně.
 */
export function takeIdentityToken(): string | null {
  const url = new URL(window.location.href);
  const token = url.searchParams.get(PARAM);
  if (token === null || token === '') return null;

  url.searchParams.delete(PARAM);
  const search = url.searchParams.toString();
  window.history.replaceState(
    window.history.state,
    '',
    `${url.pathname}${search === '' ? '' : `?${search}`}${url.hash}`,
  );
  return token;
}

export async function sendIdentityToken(input: {
  host: string;
  key: string;
  anonymousId: string;
  token: string;
  fetchImpl: typeof fetch;
  onIdentified: () => void;
}): Promise<void> {
  try {
    const response = await input.fetchImpl(`${input.host}/e/identify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        v: 1,
        key: input.key,
        anonymous_id: input.anonymousId,
        token: input.token,
      }),
    });
    // Ve všech chybových případech uživatel na webu nic nepozná
    // a tracking pokračuje anonymně.
    if (response.ok) input.onIdentified();
  } catch {
    // Tiše pokračuje anonymně.
  }
}
```

- [ ] **Step 5: Napiš vstupní bod**

```ts
// packages/sdk-web/src/index.ts
import { ConsentGate, type ConsentState } from './consent';
import { Emitter, type SdkEventName } from './emitter';
import { PageTracker, type PageProperties } from './page';
import { EventQueue, type QueuedEvent } from './queue';
import { Session } from './session';
import { Storage } from './storage';
import { takeIdentityToken, sendIdentityToken } from './ml-token';
import { uuidv4 } from './uuid';

const EVENT_NAME_RE = /^[a-z][a-z0-9_]{0,63}$/;
const PII_TRAIT_KEYS = ['email', 'e_mail', 'phone', 'tel', 'telefon'];

export type InitOptions = {
  key: string;
  host: string;
  autoPageView?: boolean;
  consent?: ConsentState;
  sessionTimeoutMinutes?: number;
  debug?: boolean;
};

export type SdkRuntimeOptions = {
  fetchImpl?: typeof fetch;
  sendBeacon?: (url: string, data: Blob) => boolean;
};

export function createSdk(runtime: SdkRuntimeOptions = {}) {
  const storage = new Storage();
  const emitter = new Emitter();
  const gate = new ConsentGate();
  const pages = new PageTracker();

  let options: InitOptions | null = null;
  let queue: EventQueue | null = null;
  let session: Session | null = null;
  let pendingToken: string | null = null;

  const log = (...args: unknown[]): void => {
    if (options?.debug === true) console.warn('[mlain]', ...args);
  };

  const enqueue = (name: string, properties: Record<string, unknown>, page?: Record<string, unknown>): void => {
    const now = Date.now();
    const event: QueuedEvent = {
      id: uuidv4(),
      name,
      occurred_at: new Date(now).toISOString(),
      properties,
      context: {
        locale: navigator.language,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        screen: { w: window.screen.width, h: window.screen.height },
        viewport: { w: window.innerWidth, h: window.innerHeight },
      },
    };
    if (page !== undefined) event.page = page;

    // Souhlas je vstupní podmínka. Bez něj se drží jen v paměti.
    if (!gate.isGranted()) {
      gate.hold(event);
      return;
    }

    const current = session!.current(now);
    if (current.started) {
      queue!.push({
        id: uuidv4(),
        name: 'session_started',
        occurred_at: new Date(now).toISOString(),
        session_id: current.id,
        properties: { referrer: document.referrer, entry_path: window.location.pathname },
        context: {},
      });
    }
    event.session_id = current.id;
    queue!.push(event);
  };

  const emitPageView = (overrides: PageProperties = {}): void => {
    const page = pages.describe(overrides);
    if (!pages.shouldEmit(String(page.path), Date.now())) return;
    enqueue('page_view', {}, page);
  };

  const api = {
    init(input: InitOptions): void {
      options = { autoPageView: true, ...input };
      session = new Session(storage, input.sessionTimeoutMinutes);
      queue = new EventQueue({
        host: input.host,
        key: input.key,
        storage,
        emitter,
        anonymousId: () => storage.readAnonymousId(),
        sendBeacon: runtime.sendBeacon,
        fetchImpl: runtime.fetchImpl,
      });

      // Token se přečte a z adresy odstraní hned, i než přijde souhlas.
      pendingToken = takeIdentityToken();

      if (input.consent !== undefined) api.consent(input.consent);
      emitter.emit('ready');
    },

    consent(state: ConsentState): void {
      const released = gate.grant(state);

      if (!gate.isGranted()) {
        // Odvolání je okamžité a idempotentní.
        storage.clear();
        pendingToken = null;
        return;
      }

      const anonymousId = storage.ensureAnonymousId();
      queue!.attachLifecycleHandlers();
      queue!.replayStoredQueue();

      for (const held of released) queue!.push(held as QueuedEvent);

      if (options?.autoPageView !== false) {
        emitPageView();
        pages.observe(() => emitPageView());
      }

      // Vazba na kontakt vyžaduje souhlas s personalizací, ne jen se sběrem.
      if (pendingToken !== null && gate.allowsPersonalization()) {
        void sendIdentityToken({
          host: options!.host,
          key: options!.key,
          anonymousId,
          token: pendingToken,
          fetchImpl: runtime.fetchImpl ?? fetch,
          onIdentified: () => emitter.emit('identified'),
        });
      }
      pendingToken = null;
    },

    track(name: string, properties: Record<string, unknown> = {}): void {
      if (!EVENT_NAME_RE.test(name)) {
        log('neplatné jméno události, zahazuji', name);
        return;
      }
      enqueue(name, properties);
    },

    page(properties: PageProperties = {}): void {
      emitPageView(properties);
    },

    identify(
      externalId: string,
      traits: Record<string, unknown> = {},
      identifyOptions: { signature?: string } = {},
    ): void {
      const hasPii = Object.keys(traits).some((key) => PII_TRAIT_KEYS.includes(key.toLowerCase()));
      if (hasPii && identifyOptions.signature === undefined) {
        // E-mail z prohlížeče bez serverového podpisu se ani neodešle.
        log('identify s osobním údajem vyžaduje serverový podpis');
        emitter.emit('error', { code: 'tracking_identify_unsigned_pii' });
        return;
      }
      enqueue('identify', {
        external_id: externalId,
        traits,
        signature: identifyOptions.signature,
      });
    },

    reset(): void {
      storage.clear();
      if (gate.isGranted()) storage.ensureAnonymousId();
    },

    getAnonymousId(): string | null {
      return storage.readAnonymousId();
    },

    async flush(): Promise<void> {
      await queue?.flush();
    },

    on(event: SdkEventName, handler: (payload: unknown) => void): () => void {
      return emitter.on(event, handler);
    },

    /** Přehraje frontu window.Mlain.q, aby šlo volat API dřív, než se skript načte. */
    bootstrap(): void {
      const global = window as unknown as { Mlain?: { q?: unknown[][] } };
      const pending = global.Mlain?.q ?? [];
      for (const [method, ...args] of pending) {
        const fn = (api as unknown as Record<string, (...a: unknown[]) => unknown>)[String(method)];
        if (typeof fn === 'function') {
          try {
            fn(...args);
          } catch (error) {
            log('chyba ve frontě', error);
          }
        }
      }
      global.Mlain = api as never;
    },
  };

  return api;
}

// Automatický start při načtení jako <script src>.
if (typeof window !== 'undefined') {
  createSdk().bootstrap();
}
```

- [ ] **Step 6: Spusť test a ověř, že prochází**

Run: `pnpm --filter @mlain/sdk-web exec vitest run test/sdk.test.ts`
Expected: PASS, 13 testů.

- [ ] **Step 7: Ověř, že velikost pořád sedí**

Run: `pnpm --filter @mlain/sdk-web test:unit`
Expected: PASS, včetně testu velikosti. Kdyby překročil 5 120 B, řež v tomhle pořadí: offline fronta v `localStorage`, `reset`, `flush`, pevný timeout session místo nastavitelného, odesílání po jedné události místo dávkování. **Neřezatelné je: souhlas jako vstupní podmínka, `sendBeacon` při odchodu ze stránky, kontrola `Origin` na serveru.**

- [ ] **Step 8: Commit**

```bash
git add packages/sdk-web/src packages/sdk-web/test/sdk.test.ts
git commit -m "feat(sdk-web): add public api, session tracking and identity handoff"
```

---

### Task 46: Servírování `ml.js`, i18n a doplnění běhového modulu

SDK se distribuuje z `{TRACKING_DOMAIN}/e/ml.js`. `TRACKING_DOMAIN` se nastavuje na vlastní subdoménu zákazníka, aby SDK i pixely přežily blokátory. Cesty jsou bez verze v segmentu schválně: adresa `/t/o/...` je zapečená v odeslaných e-mailech napořád a nesmí se nikdy měnit.

Tenhle úkol zároveň dopojí do běhového modulu to, co v Tasku 24 bylo zjednodušené: čtení projektového nastavení, rate limity a ověření `Origin`.

**Files:**
- Create: `packages/core/tracking/api/serve-sdk.ts`
- Create: `apps/web/src/lib/tracking-rate-limit.ts`
- Create: `packages/i18n/messages/cs/tracking.json`
- Create: `packages/i18n/messages/en/tracking.json`
- Modify: `apps/web/src/lib/tracking-runtime.ts`
- Test: `packages/core/test/tracking/serve-sdk.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/core/test/tracking/serve-sdk.test.ts
import { describe, expect, it } from 'vitest';
import { createSdkResponder } from '../../tracking/api/serve-sdk';

describe('serve ml.js', () => {
  const responder = createSdkResponder({ readBundle: () => 'console.log(1)', version: '1.2.3' });

  it('vrátí skript s typem application/javascript', async () => {
    const res = responder(new Request('https://events.shop.cz/e/ml.js'));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/javascript; charset=utf-8');
    expect(await res.text()).toBe('console.log(1)');
  });

  it('nastaví cache na hodinu se stale-while-revalidate na den', () => {
    const res = responder(new Request('https://events.shop.cz/e/ml.js'));
    expect(res.headers.get('cache-control')).toBe('public, max-age=3600, stale-while-revalidate=86400');
  });

  it('ETag odpovídá verzi instance, takže se při upgradu změní', () => {
    const res = responder(new Request('https://events.shop.cz/e/ml.js'));
    expect(res.headers.get('etag')).toBe('W/"1.2.3"');
  });

  it('shodný If-None-Match vrátí 304 bez těla', async () => {
    const res = responder(
      new Request('https://events.shop.cz/e/ml.js', { headers: { 'If-None-Match': 'W/"1.2.3"' } }),
    );
    expect(res.status).toBe(304);
    expect(await res.text()).toBe('');
  });

  it('skript se smí načíst z libovolného původu', () => {
    const res = responder(new Request('https://events.shop.cz/e/ml.js'));
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že padá**

Run: `pnpm vitest run packages/core/test/tracking/serve-sdk.test.ts`
Expected: FAIL, `Failed to resolve import "../../tracking/api/serve-sdk"`.

- [ ] **Step 3: Napiš servírování**

```ts
// packages/core/tracking/api/serve-sdk.ts

export type SdkResponderDeps = {
  readBundle: () => string;
  /** Verze instance. Při upgradu se změní ETag a prohlížeče si stáhnou nový skript. */
  version: string;
};

export function createSdkResponder(deps: SdkResponderDeps): (request: Request) => Response {
  let cached: string | null = null;
  const etag = `W/"${deps.version}"`;

  return function serveSdk(request: Request): Response {
    if (request.headers.get('If-None-Match') === etag) {
      return new Response(null, { status: 304, headers: { ETag: etag } });
    }
    cached ??= deps.readBundle();
    return new Response(cached, {
      status: 200,
      headers: {
        'Content-Type': 'application/javascript; charset=utf-8',
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
        ETag: etag,
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  };
}
```

- [ ] **Step 4: Napiš rate limity**

```ts
// apps/web/src/lib/tracking-rate-limit.ts
import { getRateLimiter } from '@mlain/core/api/rate-limit';
import { config } from '@mlain/core/config';

/**
 * Výjimka pro /t/o/ a /t/c/: při překročení se NEVRACÍ 429. Volající tuhle
 * funkci použije tak, že se událost nezapíše, ale odpověď zůstane stejná.
 * Uživatel nesmí kvůli našemu limitu vidět rozbitý obrázek nebo nefunkční odkaz.
 */
const pixelLimiter = getRateLimiter('tracking:pixel', {
  points: config.RATE_LIMIT_TRACK_PIXEL_IP,
  duration: 60,
});
const trackLimiter = getRateLimiter('tracking:track', {
  points: config.RATE_LIMIT_TRACK_KEY_IP,
  duration: 60,
});
const identifyLimiter = getRateLimiter('tracking:identify', {
  points: config.RATE_LIMIT_IDENTIFY_IP,
  duration: 60,
});

const LIMITERS = {
  open: pixelLimiter,
  click: pixelLimiter,
  track: trackLimiter,
  identify: identifyLimiter,
} as const;

export async function consumeTrackingRateLimit(
  key: string,
  route: keyof typeof LIMITERS,
): Promise<boolean> {
  try {
    await LIMITERS[route].consume(key);
    return true;
  } catch {
    return false;
  }
}
```

- [ ] **Step 5: Dopoj běhový modul**

```ts
// apps/web/src/lib/tracking-runtime.ts (nahraď zjednodušené části z Tasku 24)

// ... zachovej existující importy a přidej:
import { readFileSync } from 'node:fs';
import { createSdkResponder } from '@mlain/core/tracking/api/serve-sdk';
import { createIdentifyService } from '@mlain/core/tracking/identity/consume-token';
import { createIngestService } from '@mlain/core/tracking/ingest/ingest-service';
import { resolvePublicKey } from '@mlain/core/tracking/ingest/public-key';
import { bindIdentity } from '@mlain/core/tracking/identity/bind';
import { originHost } from '@mlain/core/tracking/domains/domain-cache';
import { getWorkspaceSettings } from '@mlain/core/workspaces';
import { DEFAULT_TRACKING_SETTINGS } from '@mlain/core/tracking/settings';
import { enqueue } from '@mlain/core/jobs';

/** Nastavení projektu s krátkou cache, čte se u každé přijaté dávky. */
const settingsCache = new TtlLru<string, typeof DEFAULT_TRACKING_SETTINGS>({
  capacity: 1000,
  ttlMs: 60_000,
});

function trackingSettings(workspaceId: string): typeof DEFAULT_TRACKING_SETTINGS {
  return settingsCache.get(workspaceId) ?? DEFAULT_TRACKING_SETTINGS;
}

async function warmSettings(workspaceId: string): Promise<typeof DEFAULT_TRACKING_SETTINGS> {
  return settingsCache.getOrLoad(workspaceId, async () => {
    const settings = await getWorkspaceSettings(workspaceId);
    return { ...DEFAULT_TRACKING_SETTINGS, ...settings.tracking };
  });
}

const isOriginAllowed = (workspaceId: string, origin: string): boolean => {
  const host = originHost(origin);
  return host !== null && domains.isAllowed(workspaceId, host);
};

const ingestService = createIngestService({
  resolvePublicKey: async (key) => {
    const owner = await resolvePublicKey(key);
    if (owner !== null) await warmSettings(owner.workspaceId);
    return owner;
  },
  isOriginAllowed,
  allowServersidePublicKey: (workspaceId) =>
    trackingSettings(workspaceId).allow_serverside_public_key,
  limits: {
    maxKeys: trackingConfig.propertiesMaxKeys,
    maxDepth: trackingConfig.propertiesMaxDepth,
    maxString: trackingConfig.propertiesMaxString,
  },
  stripParams: trackingConfig.stripQueryParams,
  enqueue: (payload) => enqueue('event.process', payload),
  now: () => new Date(),
});

const identifyService = createIdentifyService({
  keyring,
  resolvePublicKey: async (key) => {
    const owner = await resolvePublicKey(key);
    if (owner !== null) await warmSettings(owner.workspaceId);
    return owner;
  },
  isOriginAllowed,
  bind: (input) =>
    bindIdentity({
      ...input,
      scheduleMerge: (merge) => enqueue('identity.merge', merge),
    }),
  now: () => new Date(),
});

const serveSdk = createSdkResponder({
  readBundle: () =>
    readFileSync(new URL('../../../../packages/sdk-web/dist/ml.js', import.meta.url), 'utf8'),
  version: config.IMAGE_VERSION,
});

// V handleClick nahraď zjednodušené isWebTrackingEnabled skutečným čtením:
//   isWebTrackingEnabled: (workspaceId) => trackingSettings(workspaceId).web_tracking_enabled,

// A publicEventRoutes vytvoř se skutečnými službami:
//   publicEventRoutes: createPublicEventRoutes({
//     accept: (input, meta) => ingestService.accept(input, meta),
//     identify: (input, meta) => identifyService.identify(input, meta),
//     serveSdk: () => serveSdk(new Request('https://local/e/ml.js')),
//     consumeRateLimit: consumeTrackingRateLimit,
//     clientIp: (headers) => clientIp(headers),
//   }),
```

- [ ] **Step 6: Napiš katalogy i18n**

```json
// packages/i18n/messages/cs/tracking.json
{
  "expired": {
    "title": "Tento odkaz už neplatí",
    "body": "Odkaz, na který jste klikli, je neplatný nebo zastaralý. Kampaň už mohla skončit.",
    "home": "Přejít na úvodní stránku"
  },
  "settings": {
    "title": "Měření",
    "domains": {
      "title": "Domény pro měření",
      "description": "Skript se spustí jen na doménách, které tu jsou uvedené. Bez jediné domény se měření na webu nespustí.",
      "add": "Přidat doménu",
      "host_label": "Doména",
      "host_placeholder": "shop.example.cz",
      "include_subdomains": "Zahrnout i subdomény",
      "unverified": "Zatím neověřeno. Ověří se samo při prvním úspěšném běhu skriptu.",
      "remove": "Odebrat",
      "limit": "Můžete mít nejvýše {limit} domén pro měření."
    },
    "opens": {
      "title": "Automatická otevření",
      "description": "Apple Mail otevírá zprávy za uživatele, takže část otevření není skutečná.",
      "subtract": "Odečítat automatická otevření",
      "subtract_hint": "Doporučeno. Když odečítání vypnete, čísla otevření budou vyšší, ale méně pravdivá."
    },
    "privacy": {
      "title": "Soukromí",
      "store_ip": "Ukládat IP adresy návštěvníků",
      "store_ip_hint": "Ve výchozím stavu se IP adresa použije jen pro ochranu před zahlcením a hned se zahodí. Zapnutím přebíráte odpovědnost správce osobních údajů.",
      "store_country": "Ukládat zemi odvozenou z IP adresy",
      "store_country_hint": "Vyžaduje databázi GeoIP na straně instalace.",
      "disabled_by_instance": "Tuto volbu musí nejdřív povolit správce instalace."
    }
  },
  "errors": {
    "tracking_event_too_large": { "detail": "Událost je příliš velká." },
    "tracking_invalid_event_name": { "detail": "Jméno události smí obsahovat jen malá písmena, číslice a podtržítko." },
    "tracking_identify_unsigned_pii": { "detail": "E-mail nelze nastavit z prohlížeče bez serverového podpisu." },
    "tracking_domain_limit_reached": { "detail": "Můžete mít nejvýše {limit} domén pro měření." },
    "tracking_domain_invalid": { "detail": "Zadejte doménu bez protokolu a bez cesty, například shop.example.cz." },
    "tracking_merge_not_revertible": { "detail": "Toto sloučení už nejde vrátit." },
    "tracking_disabled": { "detail": "Měření bylo pro tuto kampaň vypnuté." },
    "tracking_timeline_window_too_large": { "detail": "Zvolte kratší období." },
    "tracking_import_partition_missing": { "detail": "Pro období {month} zatím není připravené úložiště. Zkuste to znovu za chvíli." },
    "tracking_import_beyond_retention": { "detail": "Události starší než {months} měsíců se neukládají, byly by hned smazané." },
    "tracking_properties_keys_dropped": { "detail": "Událost měla víc vlastností, než se ukládá. Uloženo prvních {limit}." },
    "tracking_properties_value_truncated": { "detail": "Hodnota vlastnosti {key} byla zkrácena na {limit} znaků." },
    "tracking_properties_depth_truncated": { "detail": "Vlastnost {key} je zanořená hlouběji, než se ukládá." }
  },
  "identities": {
    "title": "Zařízení",
    "empty": "K tomuto kontaktu zatím není navázané žádné zařízení.",
    "shared": "Zařízení používá víc lidí, část historie může být nepřesná.",
    "detach": "Odpojit zařízení",
    "merge_truncated": "Starší anonymní historie nebyla připojena, protože jí bylo příliš mnoho.",
    "merge_revert": "Vrátit připojení historie"
  }
}
```

```json
// packages/i18n/messages/en/tracking.json
{
  "expired": {
    "title": "This link is no longer valid",
    "body": "The link you clicked is invalid or outdated. The campaign may have already ended.",
    "home": "Go to the home page"
  },
  "settings": {
    "title": "Tracking",
    "domains": {
      "title": "Tracking domains",
      "description": "The script only runs on the domains listed here. Without at least one domain, web tracking will not start.",
      "add": "Add domain",
      "host_label": "Domain",
      "host_placeholder": "shop.example.com",
      "include_subdomains": "Include subdomains",
      "unverified": "Not verified yet. Verification happens automatically on the first successful script run.",
      "remove": "Remove",
      "limit": "You can have at most {limit} tracking domains."
    },
    "opens": {
      "title": "Machine opens",
      "description": "Apple Mail opens messages on behalf of the user, so some opens are not real.",
      "subtract": "Subtract machine opens",
      "subtract_hint": "Recommended. Turning this off gives higher open numbers that are less truthful."
    },
    "privacy": {
      "title": "Privacy",
      "store_ip": "Store visitor IP addresses",
      "store_ip_hint": "By default the IP address is only used for abuse protection and then discarded. Enabling this makes you the data controller.",
      "store_country": "Store the country derived from the IP address",
      "store_country_hint": "Requires a GeoIP database on the installation side.",
      "disabled_by_instance": "The installation administrator must enable this option first."
    }
  },
  "errors": {
    "tracking_event_too_large": { "detail": "The event is too large." },
    "tracking_invalid_event_name": { "detail": "Event names may only contain lowercase letters, digits and underscores." },
    "tracking_identify_unsigned_pii": { "detail": "An email address cannot be set from the browser without a server signature." },
    "tracking_domain_limit_reached": { "detail": "You can have at most {limit} tracking domains." },
    "tracking_domain_invalid": { "detail": "Enter the domain without protocol and without a path, for example shop.example.com." },
    "tracking_merge_not_revertible": { "detail": "This merge can no longer be reverted." },
    "tracking_disabled": { "detail": "Tracking was disabled for this campaign." },
    "tracking_timeline_window_too_large": { "detail": "Choose a shorter period." },
    "tracking_import_partition_missing": { "detail": "Storage for {month} is not ready yet. Please try again shortly." },
    "tracking_import_beyond_retention": { "detail": "Events older than {months} months are not stored, they would be deleted immediately." },
    "tracking_properties_keys_dropped": { "detail": "The event had more properties than we store. The first {limit} were kept." },
    "tracking_properties_value_truncated": { "detail": "The value of property {key} was truncated to {limit} characters." },
    "tracking_properties_depth_truncated": { "detail": "Property {key} is nested deeper than we store." }
  },
  "identities": {
    "title": "Devices",
    "empty": "No device is linked to this contact yet.",
    "shared": "This device is used by more than one person, some history may be inaccurate.",
    "detach": "Detach device",
    "merge_truncated": "Older anonymous history was not attached because there was too much of it.",
    "merge_revert": "Revert history attachment"
  }
}
```

- [ ] **Step 7: Spusť test a kontrolu i18n**

Run: `pnpm vitest run packages/core/test/tracking/serve-sdk.test.ts && pnpm i18n:check`
Expected: PASS. `i18n-check` ověří shodu klíčů mezi `cs` a `en` a validitu ICU výrazů.

- [ ] **Step 8: Commit**

```bash
git add packages/core/tracking/api/serve-sdk.ts apps/web/src/lib packages/i18n/messages/cs/tracking.json packages/i18n/messages/en/tracking.json packages/core/test/tracking/serve-sdk.test.ts
git commit -m "feat(tracking): serve web sdk, add rate limits and tracking i18n namespace"
```

---

### Task 47: Kontrola kritických dotazů a kompletní série

Poslední úkol je ověření, ne psaní funkcí. **Ověřování grepem nestačí:** kontrola „řetězec je v souboru" neodhalí, že SQL je nespustitelné. Ke každému tvrzení, které jde ověřit spuštěním, patří spuštění.

**Files:**
- Create: `packages/core/test/tracking/critical-queries.db.test.ts`
- Create: `packages/core/test/tracking/tx-discipline.test.ts`

- [ ] **Step 0: Napiš test transakční disciplíny**

Cross-workspace dotazy jsou v téhle doméně to nejnebezpečnější místo: dokud P03 nedodá mechanismus systémového přístupu, vracejí **nula řádků a nevracejí chybu**. Jejich seznam proto nesmí růst nepozorovaně a nesmí se obcházet vlastní obálkou.

```ts
// packages/core/test/tracking/tx-discipline.test.ts
import { globSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const files = globSync('packages/core/tracking/**/*.ts');
const read = (f: string) => readFileSync(f, 'utf8');

/**
 * Soubory, které smí sáhnout napříč projekty. Seznam je krátký schválně:
 * každá položka je místo, kde RLS neplatí, a tedy místo, které se musí
 * po dodání mechanismu z P03 projít ručně.
 */
const CROSS_WORKSPACE_ALLOWED = [
  'packages/core/tracking/repo/tracking-domains.repo.ts',
  'packages/core/tracking/repo/web-events.repo.ts',
  'packages/core/tracking/repo/engagement.repo.ts',
  'packages/core/tracking/ingest/public-key.ts',
  'packages/core/tracking/jobs/process-provider-events.ts',
  'packages/core/tracking/jobs/recompute-windows.ts',
  'packages/core/tracking/jobs/refresh-campaign-progress.ts',
  'packages/core/tracking/jobs/cleanup-token-uses.ts',
  'packages/core/tracking/jobs/enforce-retention.ts',
  'packages/core/tracking/jobs/refresh-proxy-ranges.ts',
];

describe('transakční disciplína domény', () => {
  it('transakce se otevírají výhradně přes repo/tx.ts', () => {
    // Import obálek z @mlain/db je vyhrazený adaptéru P04. Vlastní obálka
    // v této doméně by obešla i nastavení workspace kontextu.
    const offenders = files.filter(
      (f) => f !== 'packages/core/tracking/repo/tx.ts' && /from '@mlain\/core\/tx'|from '@mlain\/db'/.test(read(f)),
    );
    expect(offenders).toEqual([]);
  });

  it('napříč projekty sahá jen povolený seznam souborů', () => {
    const actual = files.filter((f) => read(f).includes('withCrossWorkspaceTx('));
    expect(actual.sort()).toEqual([...CROSS_WORKSPACE_ALLOWED].sort());
  });

  it('nikde se nečte výsledek execute jako pole', () => {
    // `const rows = await tx.execute(...)` projde typovou kontrolou a za běhu
    // vrátí QueryResult, takže rows[0] je undefined a rows.map spadne.
    const offenders = files.filter((f) => /const\s+\w+\s*=\s*await tx\.execute/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('nikde se nepřetypovává výsledek na pole řádků', () => {
    const offenders = files.filter((f) => /as unknown as\s+\w+\[\]/.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('pole jde do šablony vždy přes sql.param', () => {
    // Holé pole drizzle rozloží na ((1), (2), (3)), tedy record, a dotaz
    // skončí chybou 42846 hned při prvním použití.
    const bad = /\$\{(?!sql\.param)[^{}]*\}::(?:uuid|text|timestamptz|jsonb|int|bigint|smallint|inet|numeric|bool|boolean)\[\]/;
    const offenders = files.filter((f) => bad.test(read(f)));
    expect(offenders).toEqual([]);
  });

  it('kód chyby z databáze se čte přes pgErrorCode, ne přes error.code', () => {
    // Jen v souborech, které do databáze skutečně sahají. `TokenError.code`
    // z kontraktu je něco jiného a chytat ho do stejné sítě by znamenalo
    // pravidlo, které se obchází výjimkami.
    const offenders = files
      .filter((f) => read(f).includes('tx.execute'))
      .filter((f) => /\b(?:error|err)\.code\b/.test(read(f)));
    expect(offenders).toEqual([]);
  });
});
```

Run: `pnpm vitest run packages/core/test/tracking/tx-discipline.test.ts`
Expected: PASS, 6 testů. Ten druhý je jediné místo, které drží seznam cross-workspace dotazů krátký; když ho někdo rozšíří, musí ho rozšířit i tady a tím se to dostane do revize.

- [ ] **Step 1: Napiš test plánů kritických dotazů**

```ts
// packages/core/test/tracking/critical-queries.db.test.ts
import { beforeAll, describe, expect, it } from 'vitest';
import { withTestDatabase, seedCampaign, seedContact, seedWebEvents } from '@mlain/db/testing';

const db = withTestDatabase();

/**
 * Dotazy, na kterých stojí výkon. Nesmí se v nich objevit Seq Scan nad web_events.
 * Test běží proti reálnému Postgresu, protože grep nad SQL by tuhle vadu nenašel.
 */
describe('kritické dotazy', () => {
  let workspaceId: string;
  let contactId: string;
  let campaignId: string;

  beforeAll(async () => {
    ({ workspaceId, campaignId } = await seedCampaign(db));
    ({ contactId } = await seedContact(db, { workspaceId }));
    await seedWebEvents(db, { workspaceId, contactId, anonymousId: null, count: 5000 });
    await db.analyze('web_events');
  });

  it('timeline kontaktu za jeden měsíc nepoužije Seq Scan', async () => {
    const plan = await db.explain(
      `SELECT id, occurred_at, name FROM web_events
        WHERE workspace_id = $1 AND contact_id = $2
          AND occurred_at >= $3 AND occurred_at < $4
          AND received_at >= $3 AND received_at < $4::timestamptz + interval '7 days'
        ORDER BY occurred_at DESC LIMIT 50`,
      [workspaceId, contactId, '2026-07-01', '2026-08-01'],
    );
    expect(plan).not.toContain('Seq Scan on web_events');
  });

  it('dotaz bez podmínky na received_at prohledá víc oddílů, což je ta chyba, které se vyhýbáme', async () => {
    const withPruning = await db.explain(
      `SELECT id FROM web_events WHERE workspace_id = $1 AND contact_id = $2
         AND occurred_at >= $3 AND received_at >= $3`,
      [workspaceId, contactId, '2026-07-01'],
    );
    const withoutPruning = await db.explain(
      `SELECT id FROM web_events WHERE workspace_id = $1 AND contact_id = $2
         AND occurred_at >= $3`,
      [workspaceId, contactId, '2026-07-01'],
    );
    // Oddíly z katalogu, ne z konvence pojmenování. S regexem nad jménem by
    // obě strany daly nulu a porovnání `0 <= 0` by prošlo, aniž by cokoliv
    // změřilo. Tenhle tvar navíc vyžaduje, aby bez prořezání byl počet vyšší.
    const { rows: parts } = await db.query<{ name: string }>(
      `SELECT c.relname AS name
         FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
        WHERE i.inhparent = 'web_events'::regclass`,
    );
    const count = (plan: string) => parts.filter((p) => plan.includes(p.name)).length;
    expect(count(withoutPruning)).toBeGreaterThan(1);
    expect(count(withPruning)).toBeLessThan(count(withoutPruning));
  });

  it('mapa měsíců pro kontakt je hledání podle primárního klíče', async () => {
    const plan = await db.explain(
      `SELECT month FROM web_event_months
        WHERE workspace_id = $1 AND subject_kind = 'contact' AND subject_id = $2`,
      [workspaceId, contactId],
    );
    expect(plan).not.toContain('Seq Scan');
  });

  it('výběr anonymních událostí ke sloučení nepoužije Seq Scan', async () => {
    const plan = await db.explain(
      `SELECT id, received_at FROM web_events
        WHERE workspace_id = $1 AND anonymous_id = $2 AND contact_id IS NULL AND erased_at IS NULL
          AND occurred_at >= $3 AND received_at >= $3
        ORDER BY occurred_at DESC LIMIT 1000`,
      [workspaceId, '3f2504e0-4f89-41d3-9a0c-0305e82c3301', '2026-07-01'],
    );
    expect(plan).not.toContain('Seq Scan on web_events');
  });

  it('campaign_stats se čte podle primárního klíče', async () => {
    const plan = await db.explain(`SELECT * FROM campaign_stats WHERE campaign_id = $1`, [campaignId]);
    expect(plan).not.toContain('Seq Scan');
  });

  it('rozsah bloků pro graf je hledání podle indexu', async () => {
    const plan = await db.explain(
      `SELECT * FROM campaign_stats_buckets WHERE campaign_id = $1 AND bucket_at >= $2`,
      [campaignId, '2026-07-01'],
    );
    expect(plan).not.toContain('Seq Scan');
  });

  it('preset neotevřel využije index nad contact_engagement', async () => {
    const plan = await db.explain(
      `SELECT contact_id FROM contact_engagement
        WHERE workspace_id = $1 AND (last_open_at IS NULL OR last_open_at < now() - interval '90 days')`,
      [workspaceId],
    );
    expect(plan).not.toContain('Seq Scan on contact_engagement');
  });

  it('segmentační dotaz z jiného projektu vrátí nula řádků i při obejití repository vrstvy', async () => {
    const rows = await db.rawAsAppRole(
      `SELECT count(*) FROM contact_engagement`,
      { workspaceId: '0192f3a0-1c2d-7e40-9a1b-000000000000' },
    );
    expect(Number(rows[0]!.count)).toBe(0);
  });

  it('pokus o UPDATE neatribučního sloupce ve web_events selže na oprávnění, ne tiše', async () => {
    await expect(
      db.rawAsAppRole(`UPDATE web_events SET name = 'podvrh' WHERE workspace_id = $1`, { workspaceId }),
    ).rejects.toThrow(/permission denied|oprávnění/i);
  });
});
```

- [ ] **Step 2: Spusť test**

Run: `pnpm vitest run packages/core/test/tracking/critical-queries.db.test.ts`
Expected: PASS, 9 testů. Kdyby některý ukázal `Seq Scan`, je to nález na chybějící index a patří P03, ne obejití testu.

- [ ] **Step 3: Spusť kompletní sérii**

```bash
pnpm turbo run typecheck
pnpm turbo run lint
pnpm turbo run test:unit
pnpm turbo run test:db
pnpm licenses:check
pnpm i18n:check
pnpm openapi:check
```

Expected: všechno zelené. Když něco padá, dohledej příčinu a oprav ji. Zelené testy jsou jediný doklad hotové práce, hlášení agenta není doklad.

- [ ] **Step 4: Zkontroluj, že se nikde neobjevila zakázaná knihovna**

```bash
pnpm ls ua-parser-js device-detector-js lru-cache --recursive
```

Expected: prázdný výstup nebo `unmet dependency`. Kdyby se některá objevila jako tranzitivní závislost, patří to do `licenses.allow.json` s `expires_at`, nebo se ta závislost odstraní. Výjimka bez `expires_at` neprojde validací.

- [ ] **Step 5: Ověř velikost SDK naposledy**

```bash
pnpm --filter @mlain/sdk-web build
cat packages/sdk-web/dist/size.json
```

Expected: `gzip_bytes` pod 5120, ideálně pod 4200.

- [ ] **Step 6: Commit**

```bash
git add packages/core/test/tracking/critical-queries.db.test.ts
git commit -m "test(tracking): verify query plans and workspace isolation against real postgres"
```

---

---

## 5. Pokrytá akceptační kritéria

Čísla odkazují na kapitolu 10 části 5 (`docs/superpowers/specs/parts/05-tracking.md`).

| Skupina | Kritéria | Kde se ověřují |
|---|---|---|
| 10.1 Tokeny | 1 až 10 | Tasky 4 až 8 |
| 10.2 Open pixel | 11, 12, 13, 14, 15, 16, 17 | Tasky 9, 12, 14, 21, 33 |
| 10.3 Click redirect | 19 až 29 | Tasky 16 až 21, 33 |
| 10.4 Web SDK a ingestion | 30 až 42 | Tasky 22, 23, 26, 27, 42 až 45 |
| 10.5 Identity resolution | 43 až 54 | Tasky 29, 30, 39 |
| 10.6 Předání identity z kliku | 55 až 60 | Tasky 7, 20, 31, 45 |
| 10.7 Reporty a timeline, datová část | 70, 71, 72, 73, 74, 75, 76, 77, 78, 80, 81, 82, 83 | Tasky 33 až 36, 47 |
| 10.8 Retence a GDPR | 88, 89, 90, 91, 92 | Tasky 37, 39 |

**Kritéria, která tenhle plán nepokrývá, a proč:**

| Číslo | Vlastník | Důvod |
|---|---|---|
| 18, 79 | P09 (sender) | Týkají se toho, co sender vloží do HTML odeslané zprávy |
| 61 až 69, 84 | P14 | Reporty, dopočtené míry a čtecí API časové osy. P10 dodává data, ze kterých se počítají |
| 85, 86, 87 | P03 a P01 | Zakládání a odpojování oddílů, hlasité selhání zápisu mimo oddíl |
| 93 až 102 | P14 | SSE, polling a chování UI při výpadku spojení |

Kritérium 78 (izolace projektů v segmentačním dotazu) se ověřuje v Tasku 47, i když politiku `ws_isolation` vlastní P03: test patří k dotazu, ne k migraci.

---

## 6. Vlastnictví souborů

### 6.1 Soubory, které tenhle plán vlastní

Vytváří je a mění výhradně P10.

**`packages/core/tracking/`** (celý adresář)

```
index.ts, types.ts, settings.ts, config.ts, metrics.ts, audit.ts
tokens/keyring.ts, tokens/codec.ts, tokens/verify.ts, tokens/mint.ts, tokens/message-lookup.ts
open/gif.ts, open/ua-rules.ts, open/proxy-ranges.ts, open/classify-open.ts, open/handle-open.ts
click/lru.ts, click/link-cache.ts, click/classify-click.ts, click/append-query.ts, click/handle-click.ts
domains/domain-cache.ts, domains/service.ts
ingest/schema.ts, ingest/sanitize-url.ts, ingest/sanitize-properties.ts, ingest/clock-skew.ts,
ingest/public-key.ts, ingest/ingest-service.ts, ingest/import-service.ts
identity/jcs.ts, identity/signature.ts, identity/bind.ts, identity/merge.ts,
identity/consume-token.ts, identity/service.ts
privacy/ip.ts, privacy/geoip.ts, privacy/erase.ts
writer/event-buffer.ts, writer/flush.ts
repo/web-events.repo.ts, repo/message-events.repo.ts, repo/engagement.repo.ts,
repo/contact-engagement.repo.ts, repo/identities.repo.ts, repo/tracking-domains.repo.ts,
repo/messages.repo.ts
jobs/index.ts, jobs/event-process.ts, jobs/process-engagement.ts, jobs/process-provider-events.ts,
jobs/identity-merge.ts, jobs/recompute-windows.ts, jobs/refresh-campaign-progress.ts,
jobs/cleanup-token-uses.ts, jobs/enforce-retention.ts, jobs/refresh-proxy-ranges.ts,
jobs/rebuild-engagement.ts
api/public-tracking.routes.ts, api/public-events.routes.ts, api/tracking-domains.routes.ts,
api/identities.routes.ts, api/events.routes.ts, api/serve-sdk.ts
```

**`packages/sdk-web/`** (celý balíček)

```
package.json, tsconfig.json, build.mjs
src/index.ts, src/uuid.ts, src/storage.ts, src/consent.ts, src/session.ts,
src/queue.ts, src/page.ts, src/ml-token.ts, src/emitter.ts
test/*.test.ts
```

**`apps/web/`** (jen tyhle soubory)

```
src/app/t/[[...path]]/route.ts
src/app/t/expired/page.tsx
src/app/e/[[...path]]/route.ts
src/lib/tracking-runtime.ts
src/lib/tracking-rate-limit.ts
test/tracking-runtime.test.ts
```

**Testy**

```
packages/core/test/tracking/**  (celý adresář)
```

**i18n**

```
packages/i18n/messages/cs/tracking.json
packages/i18n/messages/en/tracking.json
```

### 6.2 Věta o hranicích

**Mimo soubory vyjmenované v sekci 6.1 tenhle plán nesahá.** Když se ukáže, že je potřeba změnit cizí soubor, není to důvod ho změnit: je to nález, který se zapíše do `docs/superpowers/plans/P10-BLOCKED.md` s uvedením souboru, vlastníka a přesného znění požadované změny, a plán pokračuje dál v tom, co udělat jde. Sdílené soubory, kterých se to týká nejčastěji, jsou `packages/db/**` (P03), `packages/contracts/**` (P02), `packages/core/errors/registry.ts` (P01), registr front (P01), zod schéma konfigurace (P01), `apps/web/src/app/api/v1/[[...route]]/route.ts` (P04), `apps/web/src/proxy.ts` (P05), `apps/worker/src/main.ts` (P01) a `packages/ui/**` (P05).

Dvě výjimky z pravidla „nesahat", obě s jasnou hranicí:

1. **`openapi.json`** se nikdy neslučuje ručně. Při konfliktu se zahodí obě verze a přegeneruje se příkazem `pnpm contracts:generate`. Do souboru se nikdy nepíše po řádcích.
2. **`packages/core/package.json`** dostane dvě nové závislosti (`crawler-user-agents`, `ipaddr.js`) a `packages/sdk-web/package.json` vzniká celý nový. Instalace závislosti není změna cizího souboru v tom smyslu, který pravidlo míní, ale musí projít branou `licenses-node`, jinak je to nález.

---

## 7. Rekapitulace rozhodnutí, která tenhle plán zapisuje

Věci, kde specifikace nechávala prostor nebo si odporovala a plán je uzavřel. Každá je legitimní nález do revize, ne hotová věc.

| # | Rozhodnutí | Odůvodnění |
|---|---|---|
| 1 | Bajtový kodek tokenu se nekopíruje, bere se z `@mlain/contracts/token` | Dvě implementace téhož projdou každá svým testem a rozejdou se až v provozu. P02 vlastní bajty, P10 sémantiku |
| 2 | Repository moduly této domény žijí v `packages/core/tracking/repo` a do databáze sahají přes `withTrackingTx` a `withCrossWorkspaceTx` z vlastního `repo/tx.ts`, který stojí nad `@mlain/core/tx` od P04 | `packages/db` vlastní P03 celý, takže tam doménové plány psát nemůžou. Adaptér P04 je zároveň jediné místo v monorepu, které smí importovat obálky z `@mlain/db`, a P04 to hlídá testem. Vlastní obal navíc dělá cross-workspace dotazy spočitatelné grepem |
| 3 | Strop na otevření je 100 na dvojici zpráva a třída, ne 100 na zprávu celkem | Se společným stropem by Apple proxy u aktivního čtenáře vyčerpala limit a skutečné lidské otevření by se zahodilo. To je přesně ten údaj, na kterém záleží nejvíc |
| 4 | `/e/v1/batch` zůstává jako trvalý alias na `/e/track` | Specifikace cesty sjednotila na `/e/track`, ale zabundlované SDK na cizím webu žije roky. Alias nic nestojí a rozbitý web zákazníka stojí hodně |
| 5 | Branka na velikost SDK je jednotkový test, ne nový CI job | Tabulka šestnácti CI jobů v části 1 je jediný autoritativní seznam a job na velikost JS bundlu v ní není |
| 6 | Ukládání IP má dvě páky: instalační `TRACKING_ALLOW_IP_STORAGE` a projektové `store_ip` | Rozhodnutí zadavatele mluví o volbě na úrovni projektu, kapitola 8 měla jen instalační proměnnou. Jedna páka bez druhé znamená buď zapnutí bez pravomoci, nebo zapnutí pro všechny projekty naráz |
| 7 | Pozice odkazu se ukládá do `message_events.metadata.link_position` | Zadavatel rozhodl, že se sleduje pozice odkazu. Do `campaign_link_stats` sloupec nepřidávám, protože tabulku vlastní P03, a po překompilování šablony by se pozice z `campaign_links` už nedohledala |
| 8 | Přepínač odečítání automatických otevření je `tracking.subtract_machine_opens` s výchozí hodnotou `true` | Zadavatel rozhodl pro přepínač. Výchozí poloha musí být ta poctivější, jinak platí námitka autora části 5, že si každý vybere číslo, které se mu líbí |
| 9 | `tracking.refresh_campaign_progress` patří do P10, ne do P14 | Je to zapisovač do `campaign_stats`, a ta tabulka musí mít jediného zapisovatele. P14 z ní jen čte. **Upřesnění po revizi:** „jediný zapisovatel" platí pro sloupce, které tenhle plán jmenuje. `campaign_stats.materialized` a `.skipped` **nepíše nikdo** a nepatří sem: vznikají při materializaci publika, což je práce P09. Je to zapsané jako nález, ne jako tichý dopočet z událostí, protože z událostí je dopočítat nejde |
| 10 | `mlain rebuild-engagement` je job plus samostatný modul, registrace podpříkazu je integrační bod | Kostru CLI vlastní P01. Logika je tady a je spustitelná, chybí jí jeden řádek v cizím souboru |
| 11 | Kanonizace JSON podle RFC 8785 se píše vlastní | Sedmdesát řádků proti licenční nejistotě u cizího balíčku, a máme závazný vektor, proti kterému se dá ověřit |
| 12 | `message_events` potřebuje sloupec `processed_at` jako značku idempotence | Bez něj nejde odlišit už zpracovanou událost providera. Sloupec vlastní P03 a P13, takže je to požadavek. Náhradní řešení je vlastní tabulka, kterou by vlastnil tenhle plán |

---

## 8. Co tenhle plán nedělá a kdo to dělá

| Oblast | Plán |
|---|---|
| Report kampaně, dashboard, katalog metrik, čtecí API statistik | P14 |
| Časová osa jako čtecí endpoint a komponenta | P14 (data plní P10) |
| SSE a polling | P14 |
| Schéma, migrace, RLS, oddíly, granty | P03 |
| Bajtový formát tokenů a golden fixtures | P02 |
| Generování tokenů při odesílání, vkládání pixelu, přepis odkazů | P09 |
| Endpoint `/u/**` a stránka odhlášení | P07 (ověření tokenu dodává P10) |
| Registrace odkazů do `campaign_links` a validace adres při kompilaci | P08 |
| Obrazovka nastavení měření | P06 nebo P14 podle umístění v navigaci, texty dodává tenhle plán v `tracking.json` |
| Konverze a tržby | Mimo MVP 0. Připravená je jen cesta: vlastnosti `value` a `currency` projdou validací a uloží se, žádná agregace nad nimi nevzniká |
