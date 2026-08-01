# P03 Databáze: schéma, migrace, RLS. Implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Postavit balíček `packages/db` celý: Drizzle schéma všech sedmi domén naráz, migrace včetně vlastního runneru se zamykáním, partitioning, RLS politiky, databázové role a granty, základ repository vrstvy a testy proti reálnému PostgreSQL 18 v testcontainers.

**Architecture:** Schéma je rozdělené do sedmi souborů podle domén plus jeden soubor pro partitionované tabulky. Nepartitionované tabulky se generují přes `drizzle-kit generate` do jediné migrace; partitioning, RLS, granty a append-only omezení jsou ruční migrace, protože je Drizzle neumí vyjádřit. Izolace projektů stojí na dvou nezávislých vrstvách: repository vrstva s branded typem `WorkspaceContext`, který nejde vyrobit z řetězce, a row-level security nad session proměnnou `mlain.workspace_id`. Sender má vlastní roli se sloupcovými granty a permisivními politikami `sender_bypass`; každá z nich má test, který běží pod skutečnou rolí `mlain_sender`, ne pod migrátorem.

**Tech Stack:** PostgreSQL 18 (`uuidv7()` v jádře), Drizzle ORM (Apache-2.0) + drizzle-kit 0.31.10 (MIT), `pg` 8.22.0 (MIT), `uuid` 14.0.1 (MIT), Vitest 4.1.10 (MIT), testcontainers 12.0.4 (MIT), TypeScript 7.0.2 (Apache-2.0), zod 4.4.3 (MIT). Žádná GPL, LGPL ani AGPL závislost; licence každého balíčku je ověřená krokem v úkolu 1.

---

## 0. Než začneš: co tenhle plán je a co není

Tohle je **jediný plán v celém projektu, který smí zakládat a měnit databázové schéma.** Ostatních patnáct plánů schéma jen čte a importuje. Důvod není estetický: kdyby si každá doména psala vlastní migraci, konflikt v `packages/db/migrations/meta/_journal.json` by byl ta lepší varianta. Horší je ta tichá: git spojí dvě syntakticky správné migrace do schématu, které nikdo nenavrhl, a projeví se to až u zákazníka, který nemá rollback.

Z toho plyne jediné pravidlo, kterým se řídí celý plán:

> Schéma **všech** domén se zapisuje dopředu a naráz, podle všech sedmi specifikací. Ne jen jádro, ne jen to, co se hned používá. Tabulka, kterou MVP 0 nepoužívá (`campaign_content_variants`, `content_snippets`), se stejně zakládá, protože pozdější migrace u self-hosted instalace je nejrizikovější operace, jakou produkt má.

Druhé pravidlo, které si přečti dřív, než napíšeš první řádek:

> Ke každé ochraně musí existovat mechanismus, který její porušení **zachytí automaticky**. Ochrana, jejíž jediné vynucení je „implementátor si to přečte", je přání, ne ochrana. Historicky v tomhle projektu selhalo přesně tohle třikrát: RLS politika, kterou test nezachytil, protože běžel pod jinou rolí; stráž `claimed_by`, u které nebylo napsáno, že se musí kontrolovat počet ovlivněných řádků; a normativní SQL v kontraktu, které nikdo nikdy nespustil.

### 0.1 Co tenhle plán vlastní

Výhradně adresář `packages/db`. Úplný seznam souborů je v kapitole 7 na konci plánu.

### 0.2 Čeho se tenhle plán nedotkne

- Kořenových souborů repa (`package.json`, `pnpm-workspace.yaml`, `turbo.json`), které vlastní P01.
- Adresáře `docker/` včetně `docker/initdb/10-roles.sql`, který vlastní P01. Tenhle plán role **nezakládá**, jen jim přiděluje práva v migraci. Zakládání role vyžaduje `CREATEROLE` nebo superuživatele a migrátor je záměrně nemá.
- Adresáře `.github/workflows`, který vlastní P01. Tenhle plán jen dodá npm skripty, které CI joby `test-db`, `migrations-check` a `contracts-schema` volají.
- Balíčku `packages/contracts`, který vlastní P02. Fixtures `OB-00` až `OB-22` a jejich runner patří P02 a P09. Tenhle plán má vlastní, menší smoke test kontraktního SQL uvnitř `packages/db/test`, aby schéma nešlo mergnout ve stavu, kdy kontraktní dotaz neprojde ani parserem.
- Doménová logika. `packages/db/src/repo` obsahuje jen infrastrukturu (transakce, kontext, registr, dvě globální repository, které si RLS vynutila). Doménové repository si píše každý doménový plán do svého balíčku.

---

## 1. Rozhodnutí, která tenhle plán uzavírá

Datové modely sedmi částí si na osmnácti místech odporují nebo se nedoplňují. Schéma je jedno, takže rozpor musí někdo rozhodnout. Rozhoduju je tady, s odůvodněním, aby se za půl roku neotvíraly znovu.

| # | Rozpor | Zdroje | Rozhodnutí a proč |
|---|---|---|---|
| R1 | Rozšíření: část 1 (2.1) povoluje jen `citext`, část 2 (11.1, body 1.1 a 1.2) vyžaduje `pg_trgm` a `btree_gin` | 01 vs 02 | **Zapínají se všechna tři.** Bez `pg_trgm` je hledání kontaktu podle části jména seq scan nad pěti miliony řádků, a hledání kontaktu je nejčastější operace v nástroji. Bez `btree_gin` nejde `workspace_id` (uuid) do stejného GIN indexu jako trigramy, takže by hledání procházelo cizí projekty. Obojí jsou `contrib` moduly dodávané s `postgres:18-alpine` a od PostgreSQL 13 jsou **trusted**, takže je nainstaluje i `mlain_migrator` bez superuživatele, když má `CREATE` na databázi. |
| R2 | `messages.kind text` (část 1, 4.10.1, doplněno 2026-07-31) versus `is_test boolean` (část 4b, 2.1) | 01 vs 04b | **Platí `kind`.** Je to zmrazený kontraktní sloupec. `is_test` je starší návrh části 4b z doby před doplněním `kind` a v témž dokumentu je i věta, že kontrakt je zdroj pravdy. Index `idx_messages__test_claimable` se proto zapisuje s predikátem `kind = 'test'`, ne `is_test = true`. |
| R3 | `messages.contact_id`: kontrakt má `NOT NULL`, část 4b ho chce nullable kvůli testovacímu odeslání na volně zadanou adresu, část 2 (11.3, bod 4.10) chce při výmazu podle čl. 17 `contact_id = NULL` | 01 vs 04b vs 02 | **Zůstává `NOT NULL`.** Je to kontraktní sloupec a tenhle plán kontrakt neotevírá. Praktické důsledky: (a) testovací odeslání musí nést `contact_id` a to je věc P13, ne schématu; (b) výmaz podle čl. 17 anonymizuje `email` na `erased+{contact_id}@erased.invalid` (tvar z části 2, 11.3, bod 4.14) a vyprázdní `render_data`, `contact_id` zůstává. Placeholder adresy sám `contact_id` obsahuje, takže jeho nulování by stejně nic nezískalo. Kdyby právní posouzení (otevřená otázka O11 části 5) rozhodlo jinak, je to **formální rozmrazení kontraktu**, ne úprava v rámci implementace. |
| R4 | DDL `message_events`: část 4a (2.5) má `recipient`, `rank`, `source` a `contact_id NOT NULL`; část 5 (12.2.1) má `subtype`, `link_id`, `erased_at` a `contact_id NULL` | 04a vs 05 | **Sjednocení.** Tabulku vlastní část 4a, ale požadavky části 5 jsou přijaté požadavky, ne návrh. Schéma nese všechny sloupce obou verzí. `contact_id` je nullable a doprovází ho `erased_at` s `ck_message_events__subject`, protože jinak by GDPR výmaz skončil chybou `23514` u prvního kontaktu, který kdy něco otevřel. `recipient` zůstává `NOT NULL` a anonymizuje se na placeholder, nenuluje se. |
| R5 | Hodnoty `ck_message_events__type`: část 5 (12.2.1) navrhuje `delivered, bounce, complaint, open, click, unsubscribe, circuit_breaker_open`, ale část 4a (3.9.2) zapisuje `bounced_hard`, `bounced_soft`, `complained`, `rejected`, `delivery_delayed`, `sent`, `render_failed` | 04a vs 05 | **Platí slovník části 4a**, protože ta registr vlastní a její indexy ho v predikátu jmenují (`uq_message_events__once_per_message`, `idx_message_events__recipient_bounce`). Výčet je sjednocení všeho, co kterákoliv část deklaruje, že zapisuje: `sent`, `rejected`, `delivered`, `delivery_delayed`, `bounced_hard`, `bounced_soft`, `complained`, `render_failed`, `open`, `click`, `unsubscribe`, `circuit_breaker_open`. Hodnota `sent` v `CHECK` zůstává i přes rozhodnutí P5.15, že ji sender nezapisuje: `CHECK` říká „je povolená", ne „zapisuje se", a bez ní by index `uq_message_events__once_per_message` měl v predikátu hodnotu, kterou constraint zakazuje. |
| R6 | `contacts.external_id` vyžaduje část 5 (12.3, bod 4), část 2 ho v DDL nemá | 05 vs 02 | **Sloupec se přidává.** Je to formálně vznesený a nezamítnutý požadavek a bez něj nefunguje nepodepsané `identify` z prohlížeče. Přidání nullable sloupce a částečného unikátního indexu je aditivní a nic nerozbíjí. |
| R7 | `system_settings.settings`: část 1 (3.13) po runneru chce počítat neúspěchy migrace „v `system_settings.settings`", ale DDL téhle tabulky (2.3) žádný sloupec `settings` nemá | 01 vnitřní | **Sloupec `settings jsonb NOT NULL DEFAULT '{}'::jsonb` se doplňuje.** Bez něj runner nemá kam zapsat čítač a pravidlo „po třech neúspěších režim údržby" je neproveditelné. Zápis do něj **nesmí** používat holé `jsonb_set` nad prázdným objektem, viz R23. |
| R8 | Seznam partitionovaných tabulek v části 1 (2.1) má sedm položek, ale část 2 (3.10) přidává `inbound_deliveries` a část 5 (2.1) `message_engagement` | 01 vs 02 vs 05 | **Devět tabulek.** Obě doplnění jsou formální požadavky (2, bod 1.14 a 5, bod 12.5.3). Chybějící partition znamená zastavený zápis, protože `DEFAULT` partition se nezakládá. Registr je v `packages/db/src/partitions.ts` a test ho porovnává s `pg_partitioned_table`. |
| R9 | Whitelist tabulek bez `workspace_id` v části 1 (3.6) nezná `asset_variants`, `asset_references` (část 3), `identity_token_uses` a `proxy_ranges` (část 5) | 01 vs 03 vs 05 | **Whitelist se rozšiřuje o `identity_token_uses` a `proxy_ranges`**, které část 5 výslovně vyjímá (2.1), a o `secret_key_generations` z rozhodnutí R28. `asset_variants` a `asset_references` na něm **nejsou**, dostávají `workspace_id` a plnou izolaci, viz R26. Test „každá tabulka mimo whitelist má `workspace_id`" se řídí registrem, ne pevným seznamem, právě proto, aby výjimka nešla vyřešit vypnutím testu. |
| R10 | `ALTER DATABASE ... SET timezone = 'UTC'` (část 1, 2.1) v migraci | 01 vnitřní | **Nepatří do migrace.** `ALTER DATABASE` smí vlastník databáze nebo superuživatel, a `mlain_migrator` je ani jeden. Časová zóna se nastavuje ve `docker/initdb` (P01) a nezávisle na tom **na každém spojení** v `packages/db/src/client.ts` přes `options: '-c timezone=UTC'`. Druhá cesta je ta spolehlivá, protože platí i u externí databáze, kterou nespravujeme. |
| R11 | Role: část 1 zná `mlain_app`, `mlain_migrator`, `mlain_sender`, `mlain_backup`; část 2 (11.1, bod 1.8) žádá `mlain_gdpr`, část 5 (2.2) `mlain_maintenance` | 01 vs 02 vs 05 | **Šest rolí.** `mlain_gdpr` má `SELECT` a `DELETE ON consents`, používá ji jen job `gdpr.erase`; samotný `DELETE` nestačí, protože `DELETE ... WHERE contact_id = $1` čte sloupec v podmínce a bez `SELECT` skončí na `permission denied` (ověřeno spuštěním). `mlain_maintenance` má `SELECT` a `DELETE ON web_events` plus politiku `maintenance_bypass`, protože retence běží napříč projekty a bez politiky by `DELETE` ovlivnil nula řádků a **nevrátil chybu**. Granty se **neobalují** do `EXCEPTION WHEN undefined_object`, viz R19. |
| R12 | `templates.thumbnail_asset_id` odkazuje na `assets` a `templates.current_version_id` na `template_versions`, která odkazuje zpět na `templates` | 03 vnitřní | **Cyklus se zakládá ve dvou fázích**, jak specifikace sama předepisuje: obě tabulky bez cyklického klíče, pak `ALTER TABLE templates ADD CONSTRAINT fk_templates__current_version`. Pojmenovaný constraint je povinný, jinak ho příští migrace nedokáže adresovat. `assets` se v pořadí zakládá před `templates`, takže `thumbnail_asset_id` cyklus netvoří. |
| R13 | Části 4a a 5 chtějí na `messages` a `message_events` různě široké indexy pro tytéž dotazy | 04a vs 05 | **Bere se širší varianta se `workspace_id` v čele.** `idx_message_events__campaign_type` je `(workspace_id, campaign_id, type, ts DESC)`, `idx_message_events__contact` je `(workspace_id, contact_id, ts DESC)`, `idx_messages__contact` je `(workspace_id, contact_id, created_at DESC)`. Užší varianta je vždy podmnožinou a `workspace_id` v čele znamená, že se politika RLS vyhodnocuje nad indexovaným sloupcem. |
| R14 | `identity_bindings.id`, `identity_merges.id`, `tracking_domains.id` a `web_events.id` nemají v části 5 `DEFAULT` | 05 vs 01 | **Doplňuje se `DEFAULT uuidv7()`** u prvních tří podle konvence 2.1 části 1. U `web_events.id` **ne**, protože ID generuje klient a server ho jen přebírá; default by zamaskoval chybu, kdy klient ID neposlal. |
| R15 | Část 4b navrhuje zrušit senderu grant na `campaign_links` (P1.15) | 04b vs 01 | **Grant a politika `sender_bypass` zůstávají.** Jsou v zmrazeném kontraktu. Zúžení je legitimní návrh, ale je to změna kontraktu, ne implementační rozhodnutí. |
| R16 | Část 2 (3.1) píše u `contacts` omezení dvakrát: jednou inline v těle sloupce, jednou jako pojmenovaný `CONSTRAINT` | 02 vnitřní | **Zapisují se jen pojmenovaná omezení** podle konvence 2.1 části 1. Dvojí zápis by vyrobil dva identické `CHECK` s různým jménem a chybová hláška by byla nahodilá. |
| R17 | Retence `messages` musí být stejná jako u `message_events` a `message_engagement` (část 5, 12.2.13), ale odpojení partition `messages` má veto podle části 1 (2.1) | 05 vs 01 | **Veto vyhrává.** `dropPartitionsBefore` má povinný parametr `veto` a bez něj odmítne cokoliv odpojit. Retence se stejnou délkou neznamená odpojení ve stejný okamžik. |
| R18 | `system_settings` singleton: kdo zakládá řádek | 01 vnitřní | **Zakládá ho migrace** s `schema_version = 0` a `secret_key_fingerprint = ''`, protože runner na něj hned v prvním běhu zapisuje `schema_version`. Otisk klíče doplní `POST /api/v1/setup` (P04). Prázdný otisk znamená „instalace ještě neproběhla" a `mlain doctor` (P16) na něj má dosah. |
| R19 | Chybějící role: migrace granty buď obalí výjimkou, nebo hlasitě spadne | vnitřní | **Hlasitě spadne. Žádný `EXCEPTION WHEN undefined_object` v migracích není.** Obalení vypadá jako odolnost, ale je to tichá ztráta celé bezpečnostní vrstvy: na instalaci, kde P01 roli nezaložil, se grant přeskočí, `RAISE NOTICE` nikdo nečte a příslušná operace je navždy neproveditelná. Migrace 0004 navíc roli `mlain_sender` jmenuje v politice, takže by na takové databázi spadla o krok dřív a odůvodnění „ať to projde bez rolí" stejně neplatí. Existenci všech šesti rolí kontroluje `test/grants.test.ts` dotazem do `pg_roles`. |
| R20 | Přímý přístup na měsíční oddíl: kopírovat granty z rodiče, nebo ho zakázat | vnitřní | **Zakázat úplně. Oddíl nedostane žádný grant a `copyGrantsFromParent` se ruší.** `CREATE TABLE ... PARTITION OF` nedědí `relrowsecurity` ani politiky, takže oddíl s granty je díra vedle RLS: pod `mlain_app` vrátí `SELECT` z oddílu řádky všech projektů a `DELETE` z oddílu `audit_log` smaže i cizí a globální záznamy. Ověřeno spuštěním na PostgreSQL 18: bez grantu na oddílu skončí přímý dotaz `permission denied for table web_events_y2026m08`, zatímco dotaz přes rodiče projde a RLS na něm platí. Práva se v PostgreSQL kontrolují na relaci, na kterou dotaz míří, takže přístup přes rodiče kopii grantů nepotřebuje. Padá s tím i kritérium AK-20.2 („nová partition je pro sender čitelná"), protože sender **žádný oddíl jménem nečte**; nahrazuje ho opačné kritérium: nová partition není pro nikoho přímo čitelná. Vynucuje to `test/grants.test.ts` dotazem do `pg_class.relacl`, ne seznamem v kódu. |
| R21 | `current_setting('mlain.workspace_id', true)` po skončení transakce | vnitřní | **Každá politika i každý dotaz čte kontext přes `NULLIF(current_setting(...), '')`.** Holá varianta je rozbitá a plán ji měl na dvanácti místech. Ověřeno spuštěním: na spojení, kde se kontext **někdy** nastavil přes `SET LOCAL`, vrací `current_setting(..., true)` po commitu **prázdný řetězec, ne NULL**. Důsledky jsou dva a oba tiché až do provozu: (a) `''::uuid` skončí chybou 22P02 `invalid input syntax for type uuid`, takže druhý dotaz ze stejného poolového spojení bez kontextu **spadne**, místo aby vrátil prázdno; (b) `current_setting('mlain.user_id', true) IS NOT NULL` je na prázdném řetězci **pravda**, takže politika `ws_insert_bootstrap` by pustila založení projektu bez jakéhokoli přihlášeného uživatele. V testech se to neprojeví, dokud každý test dostane čerstvé spojení. |
| R22 | Unikátní index na partitionované tabulce, jehož složkou je sloupec s `DEFAULT now()` | vnitřní | **Negarantuje nic a nesmí se tvářit, že ano.** Partiční klíč musí být v každém unikátním indexu, ale když je to `now()`, jsou dva zápisy téže události v různý čas dvě různé hodnoty a oba projdou. Plán to u `provider_event_receipts` řešil správně a u dvou dalších indexů ne. Rozhodnutí: `uq_message_events__once_per_message` se mění na **neunikátní** `idx_message_events__once_per_message` a deduplikaci nese `provider_event_receipts` přes `WHERE NOT EXISTS` nad `(workspace_id, dedup_key)`; `uq_webhook_deliveries__event_endpoint` zůstává unikátní, ale `webhook_deliveries.created_at` **ztrácí `DEFAULT now()`** a plní se hodnotou `webhook_events.created_at`, takže je deterministické a index skutečně chrání (řeší zároveň druhou složku klíče, viz R24). Do budoucna to hlídá katalogový test, který projde `pg_index` a spadne nad každým unikátním indexem partitionované tabulky, jehož složka má výchozí hodnotu s `now()` a není v registru výjimek. |
| R23 | Čítač neúspěšných migrací v `settings` | vnitřní | **`jsonb_set` se předchází vytvořením mezikroku cesty.** Ověřeno spuštěním: `jsonb_set('{}', ARRAY['migration_failures','0003_x'], to_jsonb(1), true)` vrátí `{}`, tedy čítač by zůstal navždy na nule a pravidlo „po třech neúspěších režim údržby" by bylo neproveditelné. Správný tvar nejdřív doplní prázdný objekt (`settings || '{"migration_failures":{}}'::jsonb`, když klíč chybí) a teprve pak zapisuje. Volající chybu čítače **nesmí polykat mlčky**: loguje ji, ale nepřebíjí jí původní chybu migrace. |
| R24 | Invariant I1 („všechny zprávy jednoho běhu mají `created_at` = `campaigns.audience_built_at`") nemá v databázi vynucení | 01 vnitřní | **Vynucuje ho složený cizí klíč** `messages (campaign_id, created_at) REFERENCES campaigns (id, audience_built_at)`. Bez něj je invariant jen věta v dokumentu a `messages.created_at DEFAULT now()` znamená, že první cesta, která zprávu vloží bez explicitního `created_at`, obejde `uq_messages__campaign_contact` a **kontakt dostane e-mail dvakrát**, aniž by cokoli spadlo. Ověřeno spuštěním: se složeným cizím klíčem takový zápis skončí chybou 23503, zápis se správným `created_at` projde a zprávy s `campaign_id IS NULL` (testovací odeslání) cizí klíč nekontroluje. Kontraktní sloupce se tím nemění, přibývá jen omezení a unikátní index `uq_campaigns__id_audience_built_at`. Stejný důvod platí pro odkazy na partitionované tabulky obecně: registr `PARTITIONED_REFERENCES` je jediný zdroj pravdy a test podle něj kontroluje **každý** odkaz, ne jen `message_events`. |
| R25 | Granty jako jednorázová migrace, nebo jako idempotentní funkce | vnitřní | **Jako idempotentní funkce `mlain_apply_grants()`, kterou migrace jen zavolá.** `pg_dump --no-privileges`, který předepisuje specifikace pro zálohu, obsahuje politiky RLS, ale **žádné granty**. Po obnově ze zálohy se obnoví i ledger migrací, takže migrace s granty je označená za aplikovanou a už ji nikdo nespustí; aplikace by se rozeběhla do `permission denied`. Funkce v databázi to řeší: volá ji migrace, `mlain doctor` (P16) i postup obnovy. Funkce odvozuje seznam tabulek z `pg_class` s podmínkou `relispartition = false`, ne z výčtu v kódu, takže se nemůže rozejít se schématem a nikdy nedá práva oddílu. |
| R26 | `asset_variants` a `asset_references` bez `workspace_id` a bez RLS | 03 vnitřní | **Obě dostávají `workspace_id` a běžnou `ws_isolation`.** Nesou úložné klíče a referenční graf, tedy data, u kterých únik mezi projekty smysl dává. Původní odůvodnění („izolované přes `assets` v repository vrstvě") popisuje jednovrstvou ochranu, zatímco celý model plánu stojí na dvou. Denormalizace `workspace_id` je přesně ten vzor, který plán sám používá u `contact_tags` a `segment_members`. Whitelist se tím zkracuje a rozhodnutí R9 se v téhle části ruší. |
| R27 | `ck_web_events__lag`: posunuté hodiny v prohlížeči | 05 vnitřní | **Server hodnotu `occurred_at` ořízne do povoleného okna a `CHECK` zůstává jako pojistka.** Plán obě varianty nechával otevřené, což je nejhorší stav: implementátor P10 si vybere a druhá strana se to dozví z chybějících dat. Oříznutí znamená, že událost z počítače s hodinami o den napřed dorazí s `occurred_at = received_at`, ne že se ztratí a ne že zápis dávky tvrdě spadne. Je to požadavek na P10, zapsaný v evidenci nálezů. |
| R28 | Pokolení šifrovacího klíče: jak pozná `mlain doctor`, že klíč pod daným `key_id` ještě existuje | 01 vs 02 | **Zakládá se tabulka `secret_key_generations`.** Ze `SELECT DISTINCT fingerprint_key_id` se pozná, která pokolení se používají, ne jestli klíč pod tím číslem pořád existuje a jestli ho někdo neprohodil. Prohození `SECRET_KEY` a `SECRET_KEY_PREVIOUS` po obnově je u samohostitele reálné a projeví se nejtišší možnou poruchou: vymazaný člověk dostane e-mail a nikde se to nezaloguje. Tabulka drží `key_id`, otisk klíče a čas zavedení, takže doctor porovnává otisk, ne existenci čísla. |
| R29 | Dvě `CHECK` omezení na `messages`, která ve zmrazeném kontraktu nejsou | 01 vnitřní | **`ck_messages__attempts` a `ck_messages__sent_has_timestamp` se ruší.** Kontrakt povoluje přidávat sloupce a indexy, omezení ne. Dnes obojí shodou okolností prochází, ale kterákoli budoucí cesta, která nastaví stav bez časového razítka, skončí chybou uvnitř senderu, tedy přesně tím tvrdým selháním, kvůli kterému se kontrakt mrazí. Kontraktní `ck_messages__status` a `ck_messages__kind` zůstávají beze změny. |
| R30 | Kdo zakládá a odpojuje měsíční oddíly | vnitřní | **Výhradně `mlain_migrator`.** Zakládání oddílu je `CREATE TABLE` ve schématu, které vlastní migrátor, a `mlain_app` na něj `CREATE` nemá ani mít nesmí. Job `platform.maintain_partitions` (P01) proto běží nad migrátorským spojením, ne nad aplikačním poolem. `dropPartitionsBefore` používá `DETACH PARTITION ... CONCURRENTLY` (ověřeno spuštěním), aby odpojení nezastavilo claim ani příjem událostí; z toho plyne, že běží **mimo transakci**. |
| R31 | Čtrnáct testovacích souborů, každý s vlastním kontejnerem a plnou sadou migrací | vnitřní | **Jeden kontejner na celý běh, každý soubor dostane vlastní databázi z předmigrované šablony.** `globalSetup` nastartuje kontejner, založí role, zmigruje databázi `mlain_template` a soubory si pak berou `CREATE DATABASE mlain_<n> TEMPLATE mlain_template`. Ověřeno spuštěním, že `TEMPLATE` kopíruje politiky RLS i granty, takže izolace testů zůstává úplná. Bez toho startuje sada přes dvacet kontejnerů a přehraje migrace dvacetkrát, což je u patnáctiminutového limitu v CI vratké ještě předtím, než doménové plány přidají vlastní soubory. |
| R32 | `message_events.rank` předává volající, ale hodnota je čistá funkce typu události | 04a vs 13 vs 10 | **`rank` je generovaný sloupec `GENERATED ALWAYS AS (CASE type ... END) STORED` a škálu vlastní P03.** P13 tutéž hodnotu odvozuje katalogem v úkolu 40 (`sent` 20, `delivery_delayed` 25, `delivered` 30, `bounced_soft` 60, `bounced_hard` 80, `complained` 85, `rejected` 90), takže se dnes tatáž funkce píše dvakrát a P10 na ni zapomněl úplně. Když je hodnota odvoditelná z jiného sloupce téhož řádku, je předávání zvenčí zbytečná příležitost k chybě. `DEFAULT` je tu obzvlášť nebezpečný: špatný `rank` nezpůsobí chybu, ale **tiše rozbije odvození stavu zprávy**. Výraz nad literály je `IMMUTABLE`, takže je legální, a plán generované sloupce už používá (`contacts.email_domain`, `contacts.search_text`). `CASE` **nemá větev `ELSE`**: nový typ v `CHECK` bez odpovídajícího ramene dá `NULL` a `NOT NULL` ho odmítne, tedy hlasitě. Ověřeno spuštěním na PostgreSQL 18: generovaný sloupec na partitionované tabulce projde, `INSERT` s explicitním `rank` skončí chybou „cannot insert a non-DEFAULT value into column rank", a typ bez ramene skončí chybou `not-null constraint`. Tím zmizí i neshoda, kdy P13 volá `rankOf('opened')`, zatímco `CHECK` povoluje `open`: katalog přestává být zdrojem hodnoty. |
| R33 | `message_events.recipient NOT NULL` pro všech dvanáct typů událostí | 04a vnitřní | **Uvolňuje se na nepovinný s podmíněným `CHECK` jen pro doručovací rodinu.** Adresu čte v celém schématu jediný index, `idx_message_events__recipient_bounce`, a ten je částečný přes odrazy a stížnosti. Pro otevření a proklik ji nečte nikdo, zato je to osobní údaj: `NOT NULL` znamená, že se e-mailová adresa okopíruje na **každý řádek desetimilionové tabulky** a výmaz podle článku 17 ji musí anonymizovat všude. `DEFAULT ''` je nepřijatelný, protože prázdné řetězce by se dostaly do bounce indexu a rozhodování o suppression by pracovalo s tichým nesmyslem. `CHECK` drží povinnost tam, kde na ní něco stojí, a jinde ji ruší. Ověřeno spuštěním: `delivered` bez adresy skončí chybou `ck_message_events__recipient`, `open` bez adresy projde, částečný bounce index se nad nepovinným sloupcem založí i použije. |
| R34 | `type Tx = PoolClient` versus Drizzle handle, který čeká P04 a přes něj všechny doménové plány | 03 vs 04 | **`Tx` je `NodePgDatabase<typeof schema>` nad vyhrazeným spojením a transakci otevírá obálka sama.** Syrový `PoolClient` nemá `.select()`, `.insert()` ani `.execute()`, takže by se datová vrstva nezkompilovala nikde. Cesta „otevřít přes `db.transaction()`" je ale **taky špatně** a je to ověřené spuštěním: `drizzle(pool).transaction()` předá callbacku `NodePgTransaction`, ne `NodePgDatabase`, takže by neseděl typ, který P04 deklaruje, a hlavně by obálka ztratila kontrolu nad spojením a nemohla by po neúspěšném `ROLLBACK` zahodit rozbité spojení přes `release(true)`. Správný tvar drží obojí: obálka si vezme `pool.connect()`, obalí **ten jeden klient** přes `drizzle(client, { schema })`, `BEGIN`, `set_config`, `COMMIT` a `ROLLBACK` posílá sama přes `tx.execute()`, a v `finally` spojení uklidí. Ověřeno spuštěním: `drizzle(client).constructor.name` je `NodePgDatabase`, `SET LOCAL` uvnitř funguje a po `COMMIT` se hodnota chová podle R21. |
| R35 | Kód chyby databáze se čte přes `error.code` | 03 vnitřní, nález P04 | **Čte se přes `pgErrorCode(error)`, který sáhne na `error.cause.code` i na `error.code`.** Ověřeno spuštěním na `drizzle-orm` 0.45 a `pg` 8.22: chyba z Drizzle je `DrizzleQueryError`, kde je `error.code` **`undefined`** a kód `23505` leží na `error.cause.code`; chyba ze syrového `pool.query` má naopak kód přímo na `error.code` a žádné `cause`. Každé ošetření kolize napsané podle jediného z těch dvou vzorů **by se nikdy neprovedlo** a projde přitom typovou kontrolou i revizí. Proto jeden pomocník a žádné přímé sahání na `code`. |
| R36 | Tabulka `rate_limits` pro `RATE_LIMIT_BACKEND=postgres`: whitelist, nebo nullable `workspace_id` | 04 vs vnitřní | **Zakládá se bez sloupce `workspace_id`, jde na whitelist a RLS se na ní nezapíná.** Rozsah limitu je `user`, `workspace`, `ip` i `global` a nese ho **jediný textový klíč** `scope:identifier:window` s tvarovým `CHECK`. Varianta s nullable `workspace_id` je horší ze stejného důvodu, kvůli kterému má `audit_log` vlastní politiku: přihlašovací a IP limity žádný workspace kontext nemají, takže by `WITH CHECK` vyhodnocený jako `NULL` zápis odmítl a **limiter by přestal fungovat právě na přihlašování**, tedy tam, kde je nejpotřebnější. Tabulka nenese obsah zákazníka, jen čítače, a je to tentýž tvar, jaký už mají `sessions` a `password_reset_tokens`. Ověřeno spuštěním: role bez kontextu vrátí z tabulky s RLS nula řádků, zatímco `rate_limits` čte i zapisuje normálně, a `ON CONFLICT DO UPDATE SET hits = hits + 1` je atomický inkrement. |
| R37 | Jak se importuje `schema` z `@mlain/db` | 03 vs 04 | **Výhradně podcestou `@mlain/db/schema`. Kořenový export `schema` nereexportuje a reexport se do něj ani nedoplňuje.** P04 už podle podcesty píše (`import * as schema from '@mlain/db/schema'`) a doménové plány po něm. Kdyby P03 doplnil ještě `export * as schema` do `src/index.ts`, vznikly by dvě rovnocenné cesty k témuž a plány by si vybíraly každý po svém, což je přesně ten stav, kterému se doplněk měl vyhnout. Jeden zjevný způsob znamená **jeden**, ne „ten nový a ten starý". Hlídá to test kořenového exportu v úkolu 30. |
| R38 | `RepoModule.readers[].call` bere `pool: Pool`, zatímco doménové funkce se píšou proti `Tx` | 03 vs 04 | **Registr přechází na `Tx`.** Doménová funkce psaná podle vzoru P04 (`sluzba(tx, ctx)`) se do registru s `Pool` nedá zapojit bez obalu a ten obal by předaný pool zahodil, protože adaptér P04 si pool bere ze singletonu; registr by tedy dostával argument, který nikdo nepoužije. Transakci otevírá generický test izolace, ne registrovaná funkce, takže `call(tx, ctx)` je zároveň jediný tvar, ve kterém test může volání zabalit do cizího kontextu. |
| R39 | Kam patří doplňky schématu z doplňkového průchodu: nová migrace, nebo původní | vnitřní | **Do původních migrací 0001, 0003 a 0004. Nová migrace se nepíše a počet zůstává sedm.** Plán tohle rozhodnutí už jednou udělal u politiky `user_own_global_audit` a důvod platí beze změny: nic není vydané, takže se sloupec nemusí přidávat `ALTER TABLE`, ale rovnou se narodí správně. Zásadní je to u `rank` a `recipient`, protože to jsou **změna typu a změna nepovinnosti**: dokud jsou tabulky prázdné, je to úprava textu migrace, po vydání by to byl přepis dat na živé instalaci, tedy operace, kterou plán sám označuje za nejrizikovější u samohostitele. Jediné, co by devátá migrace přinesla navíc, je test, který se nejdřív nastaví na jedno číslo a o pár úkolů později se přepíše na jiné. |
| R40 | `campaign_links.id` má `DEFAULT uuidv7()`, ale hodnota musí být UUIDv5 odvozená z kampaně a URL | 13 vs vnitřní | **`DEFAULT` se ruší, `id` se vždy dodává explicitně.** Odkaz v odeslaném e-mailu se počítá deterministicky, aby přežil rekompilaci kampaně; s výchozí hodnotou by první cesta, která řádek vloží bez `id`, dostala náhodné UUID, proklik by na něj nenavázal a **report odkazů by zůstal prázdný, aniž by cokoli spadlo**. Bez `DEFAULT` skončí takový zápis chybou `not-null constraint`, tedy hlasitě a v testu. Ověřeno spuštěním. |

---

## 2. Registr tabulek

**Celkem 75 tabulek**, z toho **9 partitionovaných**. Tabulka `campaign_conversion_stats` z části 5 (3.11) se **nezakládá**, protože ji specifikace sama označuje jako „NEZAKLÁDÁ SE V MVP 0".

### 2.1 Podle souboru schématu

| Soubor | Tabulky | Počet |
|---|---|---|
| `schema/identity.ts` | `users`, `sessions`, `password_reset_tokens`, `workspaces`, `memberships`, `invitations`, `api_keys` | 7 |
| `schema/platform.ts` | `idempotency_keys`, `webhook_endpoints`, `system_settings`, `secret_key_generations`, `rate_limits` | 5 |
| `schema/contacts.ts` | `contacts`, `contact_fields`, `tags`, `contact_tags`, `lists`, `list_subscriptions`, `subscription_confirmations`, `consents`, `contact_consent_state`, `suppressions`, `imports`, `import_errors`, `exports`, `name_overrides`, `segments`, `segment_members`, `forms`, `form_submissions`, `inbound_endpoints`, `inbound_dedup`, `gdpr_requests`, `retention_policies`, `retention_runs` | 23 |
| `schema/content.ts` | `assets`, `asset_variants`, `asset_references`, `templates`, `template_versions`, `brand_profiles`, `brand_extractions`, `ai_provider_credentials`, `ai_conversations`, `ai_messages`, `ai_usage_daily`, `content_snippets` | 12 |
| `schema/campaigns.ts` | `sending_providers`, `sender_domains`, `campaigns`, `campaign_content_variants`, `campaign_links`, `deliverability_snapshots`, `campaign_audience_progress`, `campaign_render_warnings` | 8 |
| `schema/tracking.ts` | `web_event_months`, `identities`, `identity_bindings`, `identity_merges`, `identity_token_uses`, `tracking_domains`, `contact_engagement`, `campaign_stats`, `campaign_stats_buckets`, `campaign_link_stats`, `proxy_ranges` | 11 |
| `schema/partitioned.ts` | `audit_log`, `webhook_events`, `webhook_deliveries`, `messages`, `message_events`, `provider_event_receipts`, `inbound_deliveries`, `web_events`, `message_engagement` | 9 |
| **Celkem** | | **75** |

### 2.2 Partitionované tabulky a jejich partitioning sloupec

| Tabulka | Sloupec | Vlastník specifikace |
|---|---|---|
| `audit_log` | `created_at` | část 1 |
| `webhook_events` | `created_at` | část 1 |
| `webhook_deliveries` | `created_at` | část 1 |
| `messages` | `created_at` | část 4a (kontraktní podmnožina část 1) |
| `message_events` | `received_at` | část 4a |
| `provider_event_receipts` | `received_at` | část 4a |
| `inbound_deliveries` | `created_at` | část 2 |
| `web_events` | `received_at` | část 5 |
| `message_engagement` | `created_at` | část 5 |

Pravidlo, které platí u všech devíti: **partitioning sloupec musí být čas, který generujeme my.** `ts` u `message_events` je hodnota od providera a partitionovat podle ní znamená, že zpožděný bounce s časovou značkou mimo existující okno tvrdě selže a událost o doručení se ztratí.

Druhé pravidlo, které je nejčastějším zdrojem chyb: **primární klíč je složený a každý odkaz nese obě složky.** Sloupec s druhou složkou se jmenuje `<entita>_<partitioning_sloupec>`, tedy `message_created_at`, `message_event_received_at`. `WHERE id = $1` vypadá jako správný dotaz, přitom prohledá všechny partition, a projeví se to až na objemu dat.

Pravidlo není přání: úplný seznam takových odkazů je registr `PARTITIONED_REFERENCES` v `src/partitions.ts` a test podle něj kontroluje **každý** odkaz proti `information_schema.columns` (rozhodnutí R24). Dokud se řídil jmenovitým výčtem, chyběla druhá složka u `webhook_deliveries.event_id` i u `inbound_dedup.delivery_id` a nikdo si toho nevšiml.

### 2.3 Whitelist tabulek bez sloupce `workspace_id`

`users`, `sessions`, `password_reset_tokens`, `system_settings`, `secret_key_generations`, `workspaces`, `identity_token_uses`, `proxy_ranges`, `rate_limits`, plus schémata `pgboss.*` a `drizzle.__drizzle_migrations`.

`rate_limits` je na whitelistu podle rozhodnutí R36: rozsah limitu nese textový klíč `scope:identifier:window`, ne sloupec, protože přihlašovací a IP limity žádný workspace kontext nemají a nullable `workspace_id` by je s `WITH CHECK` vyhodnoceným jako NULL úplně zablokoval.

`workspaces` je na whitelistu, ale **RLS na ní přesto běží**; izoluje se přes `id`. Whitelist říká „nemá sloupec `workspace_id`", ne „nemá RLS".

`asset_variants` ani `asset_references` na whitelistu **nejsou**: podle rozhodnutí R26 mají `workspace_id` a běžnou izolaci.

### 2.4 Počty politik RLS

| Politika | Kde | Počet |
|---|---|---|
| `ws_isolation` | každá tabulka se sloupcem `workspace_id` kromě `audit_log` | 65 |
| `ws_isolation_audit` | `audit_log` | 1 |
| `ws_isolation_self` | `workspaces` | 1 |
| `ws_member_visibility` | `workspaces`, jen `FOR SELECT` | 1 |
| `ws_insert_bootstrap` | `workspaces`, jen `FOR INSERT` | 1 |
| `user_own_memberships` | `memberships`, jen `FOR SELECT` | 1 |
| `user_own_global_audit` | `audit_log`, jen `FOR SELECT` | 1 |
| `sender_bypass` | `messages`, `campaigns`, `sending_providers`, `campaign_links`, `workspaces`, `suppressions`, `message_events`, `campaign_render_warnings` | 8 |
| `maintenance_bypass` | `web_events`, pro `mlain_maintenance` | 1 |
| `api_key_lookup` | `api_keys`, jen `FOR SELECT` | 1 |
| `api_key_touch` | `api_keys`, jen `FOR UPDATE` | 1 |
| `ws_api_key_lookup` | `workspaces`, jen `FOR SELECT` | 1 |
| `invitation_token_lookup` | `invitations`, jen `FOR SELECT` | 1 |
| **Celkem** | | **84** |

Počet je přepočítaný z `pg_policies` na čisté databázi po celé sérii migrací, ne odhadem z tabulky výš.

Poslední čtyři politiky doplňuje tenhle plán na požadavky **P04→P03.5** a **P04→P03.6** a mají společnou příčinu: obě cesty zjišťují projekt teprve z tajemství, které poslal volající, takže workspace kontext v okamžiku dotazu **z principu neexistuje**. Bez nich by pod `ws_isolation` vracel dotaz nula řádků a vypadalo by to jako správné odmítnutí: každý požadavek s hlavičkou `Authorization: Bearer ml_live_...` by skončil na `unauthenticated` a `acceptInvitation` by vracelo 404 vždy. Ani jedno by nespadlo hlasitě.

`ws_api_key_lookup` je nutná proto, že ověřovací dotaz JOINuje `workspaces` kvůli `deleted_at`: bez ní by se klíč našel a JOIN by ho zase zahodil. Má v `USING` podmínku, že **není nastavený ani jeden** z obou GUC. Bez té podmínky by se uplatnila i na výpisu projektů (`repo/workspaces-global.ts` čte holé `SELECT FROM workspaces` pod `withUser`) a uživatel by ve svém seznamu uviděl cizí projekt jen proto, že má API klíč. Naměřeno spuštěním proti uvolněné variantě: výpis vracel místo dvou vlastních projektů čtyři.

Obdoba pro `invitations` **záměrně neexistuje**. Přijetí pozvánky běží pod `mlain.user_id`, takže by taková politika platila i na výpisu projektů a každý přihlášený uživatel by v seznamu viděl cizí projekt s otevřenou pozvánkou (naměřeno: pět cizích projektů místo nuly). Jméno a slug projektu proto `acceptInvitation` čte **až v druhé transakci**, která workspace kontext z pozvánky nastavuje; tam ho pustí `ws_isolation_self`. Dotaz, který by `invitations` a `workspaces` JOINoval v jedné transakci pod `withUser`, vrátí nula řádků a je to vlastnost, ne vada.

RLS je zapnutá na **67 tabulkách**. Osm tabulek (`users`, `sessions`, `password_reset_tokens`, `system_settings`, `secret_key_generations`, `identity_token_uses`, `proxy_ranges`, `rate_limits`) ji zapnutou nemá.

Všechny politiky čtou kontext přes `NULLIF(current_setting(...), '')`, nikdy holým `current_setting`. Důvod je v rozhodnutí R21 a je ověřený spuštěním: holá varianta na recyklovaném poolovém spojení buď spadne chybou 22P02, nebo pustí zápis, který pustit neměla.

Politika `user_own_global_audit` v původním rozpisu části 1 není a doplňuje ji tenhle plán. Bez ní je `packages/db/src/repo/audit-global.ts`, který specifikace sama předepisuje jako jedinou cestu ke globálním auditním záznamům, **nespustitelný**: `ws_isolation_audit` porovnává v `USING` jen s `mlain.workspace_id`, který tahle cesta z principu nenastavuje. Politika má v `USING` navíc podmínku, že workspace kontext **není nastavený**; bez ní by pod kontextem projektu B viděl uživatel svoje globální řádky a padlo by kritérium 21c, které říká, že se pod workspace kontextem nevrátí ani jeden globální řádek. Ověřeno spuštěním: pod kontextem projektu vrátí dotaz jen projektový záznam, přes `withUser` jen globální.

Politika `maintenance_bypass` je nutná ze stejného důvodu jako `sender_bypass`: retenční job běží napříč projekty a workspace kontext nenastavuje, takže by `ws_isolation` nepustila nic a `DELETE` by ovlivnil **nula řádků, aniž by vrátil chybu**. Retence osobních údajů by se nikdy neprovedla a nikdo by se to nedozvěděl.

---

## 3. Migrace

**Sedm migrací.** Číslování je dané pořadím v `meta/_journal.json` a soubory se po commitu needitují.

| # | Soubor | Jak vzniká | Obsah |
|---|---|---|---|
| 0000 | `0000_extensions.sql` | `--custom` | `citext`, `pg_trgm`, `btree_gin` |
| 0001 | `0001_core_tables.sql` | `drizzle-kit generate` | 66 nepartitionovaných tabulek, jejich indexy a omezení |
| 0002 | `0002_templates_cycle_fk.sql` | `--custom` | cyklický cizí klíč `templates.current_version_id` |
| 0003 | `0003_partitioned_tables.sql` | `--custom` | 9 partitionovaných rodičů, jejich indexy a cizí klíč invariantu I1 |
| 0004 | `0004_rls_policies.sql` | `--custom` | `ENABLE ROW LEVEL SECURITY` a všech 84 politik |
| 0005 | `0005_grants.sql` | `--custom` | funkce `mlain_apply_grants()` a její první zavolání |
| 0006 | `0006_system_settings_seed.sql` | `--custom` | řádek singletonu |

Append-only omezení **nemají vlastní migraci**. Jsou uvnitř `mlain_apply_grants()`, protože `GRANT ... ON ALL TABLES` je jinak při každém dalším zavolání funkce zase vrátí. Dvě migrace by znamenaly dva popisy oprávnění a ten platný by se poznal podle pořadí.

Migrace **0000 musí být první**, protože `contacts.email` je `citext` a jeho indexy potřebují `pg_trgm` a `btree_gin`.

Devátá migrace, kterou dřívější verze plánu zaváděla jen kvůli politice `user_own_global_audit`, se **nepíše**. Nic není vydané, takže politika patří rovnou do 0004. Jediné, co by přinesla, je test, který se nejdřív nastaví na jedno číslo politik a o pár úkolů později se přepíše na jiné.

Ze stejného důvodu se nepíše ani migrace pro **doplňky z doplňkového průchodu schématem** (rozhodnutí R39). Devět nových sloupců (`api_keys` dva, `contacts.search_key`, `imports` dva, `campaigns.audience_breakdown`, `sender_domains` tři), nová tabulka `rate_limits` a zrušení `DEFAULT` u `campaign_links.id` patří rovnou do 0001, změna `message_events.rank` na generovaný sloupec a uvolnění `recipient` do 0003. Zvlášť u těch dvou posledních to není kosmetika: je to **změna typu a změna nepovinnosti**, tedy jediné dvě operace, které se po vydání dělají přepisem dat na živé instalaci. Dokud jsou tabulky prázdné, je to úprava textu migrace a nic víc.

Žádná migrace **neobaluje granty do `DO $$ ... EXCEPTION WHEN undefined_object`**. Rozhodnutí R19: chybějící role musí migraci hlasitě položit. Obalení by z chybějící role udělalo tichý stav, ve kterém příslušná operace navždy nefunguje a nikdo o tom neví. Role zakládá `docker/initdb/10-roles.sql` (P01) a v testech je zakládá `globalSetup`.

**Down migrace se nepíšou.** Chybná migrace zjištěná po vydání se opravuje novou dopřednou migrací, ne návratem. Down migrace se nikdy netestuje, takže v okamžiku, kdy ji potřebuješ, nefunguje.

---

## 4. Struktura souborů

```
packages/db/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── drizzle.config.ts
├── migrations/
│   ├── 0000_extensions.sql
│   ├── 0001_core_tables.sql
│   ├── 0002_templates_cycle_fk.sql
│   ├── 0003_partitioned_tables.sql
│   ├── 0004_rls_policies.sql
│   ├── 0005_grants.sql
│   ├── 0006_system_settings_seed.sql
│   └── meta/
│       ├── _journal.json
│       └── 0001_snapshot.json
├── src/
│   ├── index.ts
│   ├── client.ts
│   ├── context.ts
│   ├── unsafe-context.ts          (vlastní podcesta, z kořenového exportu vynechaná)
│   ├── migrate.ts
│   ├── partitions.ts
│   ├── attribute-index.ts
│   ├── rls.ts
│   ├── schema/
│   │   ├── _types.ts
│   │   ├── identity.ts
│   │   ├── platform.ts
│   │   ├── contacts.ts
│   │   ├── content.ts
│   │   ├── campaigns.ts
│   │   ├── tracking.ts
│   │   ├── partitioned.ts
│   │   └── index.ts
│   └── repo/
│       ├── tx.ts
│       ├── registry.ts
│       ├── workspaces-global.ts
│       └── audit-global.ts
└── test/
    ├── global-setup.ts             (jeden kontejner a šablona pro celý běh)
    ├── helpers/
    │   ├── container.ts
    │   └── fixtures.ts
    ├── schema-shape.test.ts        (projekt unit, bez databáze)
    ├── column-types.test.ts        (projekt unit, bez databáze)
    ├── migrate.test.ts
    ├── extensions.test.ts
    ├── core-tables.test.ts
    ├── partitioned-tables.test.ts
    ├── partitions.test.ts
    ├── attribute-index.test.ts
    ├── rls-registry.test.ts
    ├── grants.test.ts
    ├── system-settings.test.ts
    ├── context.test.ts
    ├── workspaces-global.test.ts
    ├── isolation.test.ts
    ├── audit-log.test.ts
    ├── sender-role.test.ts
    ├── contract-sql.test.ts
    └── migrations-check.test.ts
```

Rozdělení podle domén, ne podle technické vrstvy: soubory, které se mění spolu, leží spolu. Jediná výjimka je `schema/partitioned.ts`, kde je devět tabulek ze čtyř domén; ty spolu drží proto, že se všechny generují ručně a `drizzle-kit generate` se na ně nesmí dostat.

---

## 5. Úkoly

### Task 1: Kostra balíčku `packages/db` a licenční kontrola

**Files:**
- Modify: `packages/db/package.json` (**zakládá ho P01, úkol 5 krok 3, jako prázdný manifest**)
- Modify: `packages/db/tsconfig.json` (totéž)
- Create: `packages/db/vitest.config.ts`
- Create: `packages/db/drizzle.config.ts`
- Create: `packages/db/test/schema-shape.test.ts`

`package.json` ani `tsconfig.json` se **nezakládají**. P01 oba soubory už vytvořil, včetně `"license": "MIT"`, na které se dívá licenční brána v CI. Přepsat je celým novým obsahem znamená ten údaj zahodit a shodit cizí job. Tenhle úkol do nich jen doplňuje, co k nim patří.

- [ ] **Step 1: Napiš padající test na počet tabulek**

Tenhle test je zároveň brána proti tomu, aby se plán uzavřel s neúplným schématem. Bude červený až do úkolu 15.

```ts
// packages/db/test/schema-shape.test.ts
import { describe, expect, it } from 'vitest';
import { is } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from '../src/schema/index.js';

function allTables(): PgTable[] {
  return Object.values(schema).filter((value): value is PgTable => is(value, PgTable));
}

describe('tvar schématu', () => {
  it('schéma obsahuje přesně 75 tabulek', () => {
    expect(allTables()).toHaveLength(75);
  });

  it('každý název tabulky je snake_case', () => {
    for (const table of allTables()) {
      const name = getTableConfig(table).name;
      expect(name, `tabulka ${name} porušuje snake_case`).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm --filter @mlain/db test:unit`
Expected: FAIL, `Cannot find module '../src/schema/index.js'`.

- [ ] **Step 3: Doplň `package.json`, který založil P01**

Otevři existující soubor a doplň do něj `exports`, zbytek `scripts` a obě sekce závislostí. **`name`, `version`, `private`, `license` a `type` zůstávají beze změny**, stejně jako existující skript `typecheck`. Výsledek:

```json
{
  "name": "@mlain/db",
  "version": "0.0.0",
  "private": true,
  "license": "MIT",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./schema": "./src/schema/index.ts",
    "./migrate": "./src/migrate.ts",
    "./partitions": "./src/partitions.ts",
    "./rls": "./src/rls.ts",
    "./unsafe-context": "./src/unsafe-context.ts"
  },
  "scripts": {
    "build": "tsc --build",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test:unit": "vitest run --project unit",
    "test:db": "vitest run --project db",
    "test:migrations": "vitest run --project db test/migrations-check.test.ts",
    "test": "pnpm test:unit && pnpm test:db",
    "db:generate": "drizzle-kit generate",
    "db:custom": "drizzle-kit generate --custom",
    "db:check": "drizzle-kit check"
  },
  "dependencies": {
    "@mlain/contracts": "workspace:*",
    "drizzle-orm": "0.44.7",
    "pg": "8.22.0",
    "uuid": "14.0.1"
  },
  "devDependencies": {
    "@mlain/config": "workspace:*",
    "@testcontainers/postgresql": "12.0.4",
    "@types/pg": "8.15.6",
    "drizzle-kit": "0.31.10",
    "testcontainers": "12.0.4",
    "typescript": "7.0.2",
    "vitest": "4.1.10"
  }
}
```

Kdyby v souboru `"license": "MIT"` chybělo, **nedoplňuj ho a zastav se**: znamená to, že P01 není domergovaný ve stavu, který tenhle plán předpokládá.

Podcesta `./unsafe-context` je záměrná a je to jediná cesta k `unsafeWorkspaceContext`. Z kořenového exportu `@mlain/db` je ta funkce **vynechaná**, aby si ji nikdo nedoplnil našeptávačem; kontroluje to test v úkolu 30.

Barrel `packages/db/index.ts` v kořeni balíčku se **nezakládá** a `@mlain/db` se importuje podcestou (`@mlain/db/schema`). Barrel je sdílený soubor s jedním řádkem na doménu, tedy konflikt v každém plánu.

- [ ] **Step 4: Doplň `tsconfig.json`, který založil P01**

```json
{
  "extends": "@mlain/config/tsconfig/base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "composite": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["dist", "node_modules", "test"]
}
```

- [ ] **Step 5: Napiš `vitest.config.ts` se dvěma projekty**

Rozdělení je nutné: `test:unit` běží bez databáze a je v CI v jobu `test-unit` s limitem 8 minut, `test:db` startuje kontejner a je v jobu `test-db` s limitem 15 minut.

```ts
// packages/db/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/schema-shape.test.ts', 'test/column-types.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'db',
          include: ['test/**/*.test.ts'],
          exclude: ['test/schema-shape.test.ts', 'test/column-types.test.ts'],
          environment: 'node',
          // Rozhodnutí R31: JEDEN kontejner na celý běh, ne jeden na soubor.
          // globalSetup ho nastartuje, založí role a zmigruje šablonu; každý
          // soubor si pak vytvoří vlastní databázi z té šablony. Bez toho
          // startuje sada přes dvacet kontejnerů a přehraje migrace dvacetkrát.
          globalSetup: ['./test/global-setup.ts'],
          testTimeout: 60_000,
          hookTimeout: 120_000,
          // Každý soubor má vlastní databázi, takže si soubory nelezou do dat.
          // Souběh je omezený, ne vypnutý: jeden kontejner unese víc spojení,
          // ale ne dvacet paralelních sad migrací.
          maxWorkers: 4,
        },
      },
    ],
  },
});
```

- [ ] **Step 6: Napiš `drizzle.config.ts` s výslovným seznamem souborů**

Seznam je výslovný, ne glob. Kdyby to byl glob, `schema/index.ts` by do generování vtáhl `schema/partitioned.ts` a `drizzle-kit` by se pokusil vygenerovat partitionované tabulky jako obyčejné. Tichá varianta té chyby je horší než hlasitá: schéma by prošlo, `PARTITION BY` by zmizel a projevilo by se to až u zákazníka na objemu dat.

```ts
// packages/db/drizzle.config.ts
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  // VÝSLOVNÝ seznam. schema/index.ts ani schema/partitioned.ts tu být NESMÍ,
  // partitionované tabulky se generují ručně v migraci 0003.
  schema: [
    './src/schema/identity.ts',
    './src/schema/platform.ts',
    './src/schema/contacts.ts',
    './src/schema/content.ts',
    './src/schema/campaigns.ts',
    './src/schema/tracking.ts',
  ],
  out: './migrations',
  breakpoints: true,
  casing: 'snake_case',
  dbCredentials: {
    url: process.env.DATABASE_URL_MIGRATOR ?? 'postgres://mlain_migrator:mlain@localhost:5432/mlain',
  },
});
```

- [ ] **Step 7: Nainstaluj závislosti a ověř licence**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm install
npm view drizzle-orm version license
npm view drizzle-kit@0.31.10 license
npm view pg@8.22.0 license
npm view uuid@14.0.1 license
npm view testcontainers@12.0.4 license
npm view @testcontainers/postgresql@12.0.4 license
```

Expected: `drizzle-orm` `Apache-2.0`, `drizzle-kit` `MIT`, `pg` `MIT`, `uuid` `MIT`, obojí `testcontainers` `MIT`. Kdyby `npm view drizzle-orm version` hlásil verzi neslučitelnou s `drizzle-kit 0.31.10`, zapiš do `package.json` skutečnou verzi z řady, kterou `drizzle-kit 0.31.10` podporuje, a **v tom kroku ověř znovu licenci**.

Kdyby kterákoliv licence byla `GPL-*`, `LGPL-*`, `AGPL-*`, `SSPL-*`, `BUSL-*` nebo `Elastic-2.0`, balíček se **nepoužije** a úkol se zastaví. Projekt je MIT a licenční brána se zavádí v hodině 0, ne později; vyhodit zabudovanou závislost je řádově dražší než ji nepustit dovnitř.

- [ ] **Step 8: Commit**

```bash
git add packages/db/package.json packages/db/tsconfig.json packages/db/vitest.config.ts packages/db/drizzle.config.ts packages/db/test/schema-shape.test.ts
git commit -m "chore(db): package skeleton, drizzle config and schema shape gate"
```

---

### Task 2: Vlastní typy sloupců, které Drizzle nemá

**Files:**
- Create: `packages/db/src/schema/_types.ts`
- Create: `packages/db/test/column-types.test.ts`

Drizzle nemá vestavěný `citext`, `bytea`, `inet` ani `cidr`. Bez nich by `contacts.email`, `sessions.token_hash` a `proxy_ranges.cidr` musely být `text`, a to je tichá změna sémantiky: porovnání e-mailu by přestalo být necitlivé na velikost písmen a chyba by se projevila jako duplicitní kontakt.

- [ ] **Step 1: Napiš padající test**

```ts
// packages/db/test/column-types.test.ts
import { describe, expect, it } from 'vitest';
import { bytea, byteaArray, cidr, citext, inet, inetArray } from '../src/schema/_types.js';

describe('vlastní typy sloupců', () => {
  it('citext se do SQL zapíše jako citext', () => {
    expect(citext('email').getSQLType()).toBe('citext');
  });
  it('bytea se do SQL zapíše jako bytea', () => {
    expect(bytea('token_hash').getSQLType()).toBe('bytea');
  });
  it('byteaArray se do SQL zapíše jako bytea[]', () => {
    expect(byteaArray('email_fingerprints').getSQLType()).toBe('bytea[]');
  });
  it('inet se do SQL zapíše jako inet', () => {
    expect(inet('ip').getSQLType()).toBe('inet');
  });
  it('inetArray se do SQL zapíše jako inet[]', () => {
    expect(inetArray('ip_allowlist').getSQLType()).toBe('inet[]');
  });
  it('cidr se do SQL zapíše jako cidr', () => {
    expect(cidr('range').getSQLType()).toBe('cidr');
  });

  it('byteaArray nemá vlastní konverzi, hodnotu předává ovladači beze změny', () => {
    // Ovladač pg vrací bytea[] rovnou jako Buffer[] a stejné pole i přijímá,
    // takže jakákoli konverze tady by hodnotu jen poškodila. Test je brána
    // proti tomu, aby ji někdo doplnil podle vzoru pro bytea.
    const type = byteaArray('email_fingerprints');
    expect(type.mapToDriverValue).toBeUndefined();
    expect(type.mapFromDriverValue).toBeUndefined();
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm --filter @mlain/db test:unit`
Expected: FAIL, `Cannot find module '../src/schema/_types.js'`.

- [ ] **Step 3: Napiš `_types.ts`**

```ts
// packages/db/src/schema/_types.ts
import { customType } from 'drizzle-orm/pg-core';

/** citext: e-mailové adresy. Porovnání je necitlivé na velikost písmen v databázi,
 *  ne v aplikaci, protože aplikací je víc a jedna z nich je v Go. */
export const citext = customType<{ data: string; driverData: string }>({
  dataType: () => 'citext',
});

/** bytea: hashe tokenů, otisky adres, CSRF sekrety. Nikdy text: hex zdvojnásobí
 *  velikost indexu a svádí k porovnávání řetězců místo bajtů. */
export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => 'bytea',
});

/**
 * bytea[]: contacts.email_fingerprints nese otisk pod každým pokolením klíče.
 *
 * `driverData` je `Buffer[]`, NE `string`, a je to ověřené spuštěním proti
 * ovladači `pg` 8.22, ne odvozené: `SELECT $1::bytea[]` vrátí
 * `[ <Buffer 9f 86 …>, <Buffer 0d 1b …> ]` a stejné pole i přijme jako
 * parametr. Konverzní funkce `toDriver` a `fromDriver` proto tenhle typ
 * nepotřebuje a **nesmí je mít**: kdo je dopíše podle vzoru pro `bytea`,
 * rozbije jimi hodnotu.
 *
 * Špatně deklarovaný `driverData: string` byl přesně ta pobídka konverzi
 * dopsat. Tichá ztráta otisků je přitom podle specifikace nejhorší scénář,
 * jaký suppression má: otisk se přestane shodovat, kontrola projde a vymazaný
 * člověk dostane e-mail, aniž by cokoli selhalo. Průchod přes skutečný ovladač
 * proto hlídá test v `core-tables.test.ts`; tvar `driverData` je vlastnost
 * ovladače, ne tohohle souboru, a testem v paměti se dokázat nedá.
 */
export const byteaArray = customType<{ data: Buffer[]; driverData: Buffer[] }>({
  dataType: () => 'bytea[]',
});

export const inet = customType<{ data: string; driverData: string }>({
  dataType: () => 'inet',
});

export const inetArray = customType<{ data: string[]; driverData: string }>({
  dataType: () => 'inet[]',
});

export const cidr = customType<{ data: string; driverData: string }>({
  dataType: () => 'cidr',
});
```

- [ ] **Step 4: Spusť test a ověř, že projde**

Run: `pnpm --filter @mlain/db test:unit`
Expected: `column-types.test.ts` PASS (7 testů), `schema-shape.test.ts` dál FAIL. To je správně.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/_types.ts packages/db/test/column-types.test.ts
git commit -m "feat(db): custom column types for citext, bytea, inet and cidr"
```

---

### Task 3: Sdílený kontejner, testovací harness a šest rolí

**Files:**
- Create: `packages/db/test/global-setup.ts`
- Create: `packages/db/test/helpers/container.ts`
- Create: `packages/db/test/helpers/fixtures.ts`
- Create: `packages/db/test/migrate.test.ts`
- Create: `packages/db/src/migrate.ts` (zatím zaslepený)
- Create: `packages/db/src/partitions.ts` (zatím zaslepený)

Harness je nejdůležitější infrastruktura celého plánu. Kdyby testy běžely pod migrátorem, chybějící politiku `sender_bypass` by dokonale zamaskovaly, protože migrátor jako vlastník schématu RLS obchází. Harness proto otevírá **šest různých spojení pod šesti různými rolemi** a test si vybírá, pod kterou chce běžet.

Podle rozhodnutí R31 startuje kontejner **jednou pro celý běh** a každý testovací soubor dostane vlastní databázi z předmigrované šablony. Ověřeno spuštěním, že `CREATE DATABASE ... TEMPLATE` kopíruje politiky RLS i granty, takže izolace mezi soubory zůstává úplná a nic se nemaskuje.

- [ ] **Step 1: Napiš padající test, který ověří, že harness umí spojení pod všemi rolemi**

```ts
// packages/db/test/migrate.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './helpers/container.js';

let h: Harness;
// migrate: false je zde POVINNÉ. Migrační runner je do úkolu 5 zaslepený
// a soubor migrations/meta/_journal.json ještě neexistuje. Kdyby se harness
// pokusil migrovat, výjimka v beforeAll shodí CELÝ soubor, ne jeden test.
beforeAll(async () => { h = await startHarness({ migrate: false }); }, 120_000);
afterAll(async () => { await h.stop(); });

describe('testovací harness', () => {
  it('otevře spojení pod všemi šesti rolemi a každé hlásí svou roli', async () => {
    const roles = ['mlain_migrator', 'mlain_app', 'mlain_sender', 'mlain_gdpr',
                   'mlain_maintenance', 'mlain_backup'] as const;
    for (const role of roles) {
      const { rows } = await h.as(role).query('SELECT current_user AS who');
      expect(rows[0].who).toBe(role);
    }
  });

  it('mlain_migrator vlastní schéma public', async () => {
    const { rows } = await h.as('mlain_migrator').query(
      `SELECT nspowner::regrole::text AS owner FROM pg_namespace WHERE nspname = 'public'`,
    );
    expect(rows[0].owner).toBe('mlain_migrator');
  });

  it('každé spojení běží v UTC bez ohledu na časovou zónu databáze', async () => {
    // Databáze je schválně nastavená na Europe/Prague (viz global-setup.ts),
    // aby test dokázal, že UTC vynucuje SPOJENÍ, ne server. Kdyby se ptal
    // databáze nastavené na UTC, nemohl by spadnout nikdy.
    for (const role of ['mlain_app', 'mlain_sender'] as const) {
      const { rows } = await h.as(role).query<{ TimeZone: string }>('SHOW timezone');
      expect(rows[0].TimeZone, `${role} neběží v UTC`).toBe('UTC');
    }
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm --filter @mlain/db test:db -- test/migrate.test.ts`
Expected: FAIL, `Cannot find module './helpers/container.js'`.

- [ ] **Step 3: Napiš `test/global-setup.ts`**

```ts
// packages/db/test/global-setup.ts
//
// Běží JEDNOU pro celý projekt `db`. Nastartuje kontejner, udělá to,
// co v produkci dělá docker/initdb (P01), a připraví předmigrovanou šablonu.
// Testovací soubory pak jen klonují databázi, což trvá desítky milisekund
// místo desítek sekund.
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Client } from 'pg';
import type { TestProject } from 'vitest/node';
import { runMigrations } from '../src/migrate.js';

export const ROLES = [
  'mlain_migrator', 'mlain_app', 'mlain_sender',
  'mlain_gdpr', 'mlain_maintenance', 'mlain_backup',
] as const;

export const TEMPLATE_DB = 'mlain_template';

let container: StartedPostgreSqlContainer | undefined;

export default async function setup(project: TestProject) {
  // Verze je pravidlo, ne číslo: poslední produkční PostgreSQL. K 2026-07-31 je to 18.
  // Osmnáctka má uuidv7() v jádře, takže DEFAULT uuidv7() v DDL drží.
  container = await new PostgreSqlContainer('postgres:18-alpine')
    .withDatabase('postgres')
    .withUsername('postgres')
    .withPassword('postgres')
    .start();

  const host = container.getHost();
  const port = container.getMappedPort(5432);

  const su = new Client({
    host, port, database: 'postgres', user: 'postgres', password: 'postgres',
  });
  await su.connect();

  for (const role of ROLES) {
    await su.query(`CREATE ROLE ${role} LOGIN PASSWORD '${role}'`);
  }
  await su.query(`GRANT pg_read_all_data TO mlain_backup`);

  // Časová zóna databáze je SCHVÁLNĚ jiná než UTC. V produkci ji docker/initdb
  // nastavuje na UTC, ale u externí databáze, kterou nespravujeme, to zaručit
  // nejde. Test „spojení běží v UTC" má dokazovat, že UTC vynucuje aplikace;
  // proti databázi nastavené na UTC by nemohl spadnout ani při úplném
  // odstranění options z klienta.
  await su.query(`CREATE DATABASE ${TEMPLATE_DB}`);
  await su.query(`ALTER DATABASE ${TEMPLATE_DB} SET timezone = 'Europe/Prague'`);
  await su.query(`GRANT CREATE ON DATABASE ${TEMPLATE_DB} TO mlain_migrator`);

  const tpl = new Client({
    host, port, database: TEMPLATE_DB, user: 'postgres', password: 'postgres',
  });
  await tpl.connect();
  // Migrátor vlastní schéma. Bez vlastnictví na něj RLS nedopadá a testy
  // izolace by prošly, i kdyby politiky vůbec neexistovaly.
  await tpl.query(`ALTER SCHEMA public OWNER TO mlain_migrator`);
  await tpl.query(`GRANT CREATE, USAGE ON SCHEMA public TO mlain_migrator`);
  await tpl.end();

  // Šablona se migruje JEDNOU. ensurePartitions je vypnuté schválně: oddíly
  // si zakládá každý test podle svého data, aby sada nezačala padat na přelomu
  // měsíce a aby šablona zůstala malá.
  await runMigrations({
    url: `postgres://mlain_migrator:mlain_migrator@${host}:${port}/${TEMPLATE_DB}`,
    ensurePartitions: false,
  });

  await su.query(`ALTER DATABASE ${TEMPLATE_DB} IS_TEMPLATE true`);
  await su.end();

  project.provide('pgHost', host);
  project.provide('pgPort', port);

  return async () => { await container?.stop(); };
}

declare module 'vitest' {
  export interface ProvidedContext {
    pgHost: string;
    pgPort: number;
  }
}
```

- [ ] **Step 4: Napiš `test/helpers/container.ts`**

```ts
// packages/db/test/helpers/container.ts
import { Client, Pool } from 'pg';
import { inject } from 'vitest';
import { runMigrations } from '../../src/migrate.js';
import { ROLES, TEMPLATE_DB, type RoleName } from '../global-setup.js';

export type { RoleName };

export type Harness = {
  database: string;
  as(role: RoleName): Pool;
  urlFor(role: RoleName): string;
  stop(): Promise<void>;
};

export type HarnessOptions = {
  /**
   * false = vznikne PRÁZDNÁ databáze bez migrací, pro testy runneru.
   * true (výchozí) = databáze se klonuje z předmigrované šablony.
   */
  migrate?: boolean;
};

let counter = 0;

export async function startHarness(options: HarnessOptions = {}): Promise<Harness> {
  const migrate = options.migrate ?? true;
  const host = inject('pgHost');
  const port = inject('pgPort');
  const database = `mlain_t${process.pid}_${counter += 1}`;

  const su = new Client({ host, port, database: 'postgres', user: 'postgres', password: 'postgres' });
  await su.connect();
  // TEMPLATE kopíruje tabulky, politiky RLS I granty. Ověřeno spuštěním,
  // ne odvozeno: bez grantů by testy oprávnění byly falešně zelené.
  await su.query(migrate
    ? `CREATE DATABASE ${database} TEMPLATE ${TEMPLATE_DB}`
    : `CREATE DATABASE ${database}`);
  await su.query(`ALTER DATABASE ${database} SET timezone = 'Europe/Prague'`);
  await su.query(`GRANT CREATE ON DATABASE ${database} TO mlain_migrator`);
  if (!migrate) {
    const fresh = new Client({ host, port, database, user: 'postgres', password: 'postgres' });
    await fresh.connect();
    await fresh.query(`ALTER SCHEMA public OWNER TO mlain_migrator`);
    await fresh.query(`GRANT CREATE, USAGE ON SCHEMA public TO mlain_migrator`);
    await fresh.end();
  }
  await su.end();

  const urlFor = (role: RoleName) =>
    `postgres://${role}:${role}@${host}:${port}/${database}`;

  const pools = new Map<RoleName, Pool>();
  for (const role of ROLES) {
    pools.set(role, new Pool({
      host, port, database, user: role, password: role,
      // Časová zóna se vynucuje na každém spojení, ne jen na databázi.
      // U externí databáze, kterou nespravujeme, je tohle jediná spolehlivá cesta.
      options: '-c timezone=UTC',
      max: 4,
    }));
  }

  return {
    database,
    as: (role) => pools.get(role)!,
    urlFor,
    async stop() {
      for (const pool of pools.values()) await pool.end();
      const admin = new Client({
        host, port, database: 'postgres', user: 'postgres', password: 'postgres' });
      await admin.connect();
      await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`);
      await admin.end();
    },
  };
}

/** Zmigruje databázi harnessu založeného s `migrate: false`. */
export async function migrateHarness(h: Harness): Promise<void> {
  await runMigrations({ url: h.urlFor('mlain_migrator') });
}
```

`RoleName` se exportuje z `global-setup.ts`, aby existoval jeden seznam rolí, ne dva. Doplň tam k němu typ:

```ts
// packages/db/test/global-setup.ts, k seznamu ROLES
export type RoleName = (typeof ROLES)[number];
```

- [ ] **Step 5: Napiš zaslepené `src/migrate.ts` a `src/partitions.ts`**

Obojí se plnohodnotně píše v úkolech 4 a 17. Tady jde jen o to, aby modul existoval a harness šel spustit.

```ts
// packages/db/src/migrate.ts
export type RunMigrationsOptions = { url: string; ensurePartitions?: boolean };

export async function runMigrations(_options: RunMigrationsOptions): Promise<void> {
  // Doplní se v úkolu 4.
}
```

```ts
// packages/db/src/partitions.ts
import type { Client } from 'pg';

export async function ensureUpcomingPartitions(
  _client: Client, _from: Date, _months: number,
): Promise<void> {
  // Doplní se v úkolu 17.
}
```

- [ ] **Step 6: Spusť test a ověř, že projde**

Run: `pnpm --filter @mlain/db test:db -- test/migrate.test.ts`
Expected: PASS, 3 testy. První běh stahuje image `postgres:18-alpine`, počítej s minutou navíc. `global-setup.ts` v tuhle chvíli volá zaslepený runner, takže šablona vznikne prázdná; to je správně a od úkolu 5 se to změní samo.

- [ ] **Step 7: Napiš `test/helpers/fixtures.ts`**

Dvě workspace a jeden kontakt v jedné z nich jsou fixture, kterou používá skoro každý test izolace. Bez ní by si ji každý soubor psal znovu a odchýlily by se.

```ts
// packages/db/test/helpers/fixtures.ts
import type { Pool } from 'pg';
import { v7 as uuidv7 } from 'uuid';

export type TwoWorkspaces = {
  userId: string;
  workspaceA: string;
  workspaceB: string;
  contactInA: string;
};

/**
 * Zakládá se pod migrátorem schválně: migrátor vlastní schéma, takže se na něj
 * RLS nevztahuje a fixture jde vložit bez nastavování kontextu. Testy izolace
 * pak běží pod mlain_app, tedy pod rolí, na kterou RLS dopadá.
 */
export async function seedTwoWorkspaces(migrator: Pool): Promise<TwoWorkspaces> {
  const userId = uuidv7();
  const workspaceA = uuidv7();
  const workspaceB = uuidv7();
  const contactInA = uuidv7();

  await migrator.query(
    `INSERT INTO users (id, email, password_hash, locale, timezone)
     VALUES ($1, $2, 'argon2id$dummy', 'cs', 'Europe/Prague')`,
    [userId, `owner-${userId}@example.test`],
  );
  for (const [id, prefix] of [[workspaceA, 'ws-a'], [workspaceB, 'ws-b']] as const) {
    await migrator.query(
      `INSERT INTO workspaces (id, name, slug, locale, timezone, created_by)
       VALUES ($1, $2, $3, 'cs', 'Europe/Prague', $4)`,
      [id, prefix, `${prefix}-${id.slice(0, 8)}`, userId],
    );
    await migrator.query(
      `INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [id, userId],
    );
  }
  await migrator.query(
    `INSERT INTO contacts (id, workspace_id, email, locale) VALUES ($1, $2, $3, 'cs')`,
    [contactInA, workspaceA, `contact-${contactInA}@example.test`],
  );

  return { userId, workspaceA, workspaceB, contactInA };
}
```

- [ ] **Step 8: Commit**

```bash
git add packages/db/test/global-setup.ts packages/db/test/helpers packages/db/test/migrate.test.ts packages/db/src/migrate.ts packages/db/src/partitions.ts packages/db/vitest.config.ts
git commit -m "test(db): shared container, template database and six database roles"
```

---

### Task 4: Migrační runner s advisory lockem

**Files:**
- Modify: `packages/db/src/migrate.ts`
- Modify: `packages/db/test/migrate.test.ts`

Vlastní runner je nutný ze dvou důvodů, které `drizzle-kit migrate` neumí: advisory lock kolem celého běhu (tři repliky nesmí aplikovat migrace vícekrát) a migrace, které nesmí běžet v transakci (`CREATE INDEX CONCURRENTLY`).

- [ ] **Step 1: Napiš padající testy runneru**

```ts
// packages/db/test/migrate.test.ts, doplň za existující describe
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MIGRATION_ADVISORY_LOCK_ID, runMigrations } from '../src/migrate.js';

function fixtureMigrations(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'mlain-mig-'));
  mkdirSync(join(dir, 'meta'), { recursive: true });
  const entries = Object.keys(files).sort().map((tag, idx) => ({
    idx, version: '7', when: 1_800_000_000_000 + idx, tag, breakpoints: true,
  }));
  writeFileSync(join(dir, 'meta', '_journal.json'),
    JSON.stringify({ version: '7', dialect: 'postgresql', entries }, null, 2));
  for (const [tag, sql] of Object.entries(files)) {
    writeFileSync(join(dir, `${tag}.sql`), sql);
  }
  return dir;
}

describe('migrační runner', () => {
  it('konstanta advisory locku je pevná a nesmí se měnit', () => {
    expect(MIGRATION_ADVISORY_LOCK_ID).toBe(7264150401);
  });

  it('aplikuje migrace v pořadí z _journal.json a zapíše je do drizzle.__drizzle_migrations',
    async () => {
      const t = await startHarness({ migrate: false });
      try {
        const dir = fixtureMigrations({
          '0000_a': 'CREATE TABLE t_a (id int PRIMARY KEY);',
          '0001_b': 'CREATE TABLE t_b (a_id int REFERENCES t_a(id));',
        });
        await runMigrations({
          url: t.urlFor('mlain_migrator'), migrationsFolder: dir, ensurePartitions: false,
        });
        const { rows } = await t.as('mlain_migrator').query(
          'SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations',
        );
        expect(rows[0].n).toBe(2);
      } finally { await t.stop(); }
    });

  it('tři souběžné běhy aplikují každou migraci právě jednou (kritérium 4)', async () => {
    const t = await startHarness({ migrate: false });
    try {
      const dir = fixtureMigrations({
        '0000_a': 'CREATE TABLE t_a (id int PRIMARY KEY);',
        '0001_b': 'CREATE TABLE t_b (id int PRIMARY KEY);',
      });
      const url = t.urlFor('mlain_migrator');
      const opts = { url, migrationsFolder: dir, ensurePartitions: false };
      await Promise.all([runMigrations(opts), runMigrations(opts), runMigrations(opts)]);
      const { rows } = await t.as('mlain_migrator').query(
        `SELECT hash, count(*)::int AS n FROM drizzle.__drizzle_migrations GROUP BY hash`,
      );
      expect(rows).toHaveLength(2);
      for (const row of rows) expect(row.n).toBe(1);
    } finally { await t.stop(); }
  });

  it('opakovaný běh nad hotovou databází neudělá nic (kritérium 5)', async () => {
    const t = await startHarness({ migrate: false });
    try {
      const dir = fixtureMigrations({ '0000_a': 'CREATE TABLE t_a (id int PRIMARY KEY);' });
      const opts = { url: t.urlFor('mlain_migrator'), migrationsFolder: dir, ensurePartitions: false };
      await runMigrations(opts);
      await runMigrations(opts);
      const { rows } = await t.as('mlain_migrator').query(
        'SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations',
      );
      expect(rows[0].n).toBe(1);
    } finally { await t.stop(); }
  });

  it('migrace s -- mlain:no-transaction běží mimo transakci', async () => {
    const t = await startHarness({ migrate: false });
    try {
      const dir = fixtureMigrations({
        '0000_a': 'CREATE TABLE t_a (id int PRIMARY KEY);',
        // CREATE INDEX CONCURRENTLY uvnitř transakce skončí chybou 25001.
        '0001_c': '-- mlain:no-transaction\nCREATE INDEX CONCURRENTLY IF NOT EXISTS idx_t_a ON t_a (id);',
      });
      await expect(runMigrations({
        url: t.urlFor('mlain_migrator'), migrationsFolder: dir, ensurePartitions: false,
      })).resolves.toBeUndefined();
    } finally { await t.stop(); }
  });

  it('spadlá migrace vrátí MigrationError s exit code 3 a názvem migrace', async () => {
    const t = await startHarness({ migrate: false });
    try {
      const dir = fixtureMigrations({ '0000_bad': 'CREATE TABLE (;' });
      await expect(runMigrations({
        url: t.urlFor('mlain_migrator'), migrationsFolder: dir, ensurePartitions: false,
      })).rejects.toMatchObject({ exitCode: 3, tag: '0000_bad' });
    } finally { await t.stop(); }
  });

  it('schema_version vyšší, než runner zná, skončí exit code 5 (kritérium 13)', async () => {
    const t = await startHarness({ migrate: false });
    try {
      const dir = fixtureMigrations({ '0000_a': 'CREATE TABLE t_a (id int PRIMARY KEY);' });
      const opts = { url: t.urlFor('mlain_migrator'), migrationsFolder: dir, ensurePartitions: false };
      await runMigrations(opts);
      await t.as('mlain_migrator').query(`
        CREATE TABLE system_settings (
          id boolean PRIMARY KEY DEFAULT true,
          schema_version integer NOT NULL,
          settings jsonb NOT NULL DEFAULT '{}'::jsonb,
          updated_at timestamptz NOT NULL DEFAULT now())`);
      await t.as('mlain_migrator').query(
        `INSERT INTO system_settings (id, schema_version) VALUES (true, 999)`,
      );
      await expect(runMigrations(opts))
        .rejects.toMatchObject({ exitCode: 5, code: 'schema_version_ahead' });
    } finally { await t.stop(); }
  });

  it('změna obsahu už aplikované migrace skončí exit code 6, ne tichým přehráním', async () => {
    // Bez téhle kontroly stačí přidat mezeru do vydané migrace a runner ji
    // pustí ZNOVU nad hotovým schématem, protože se řídí hashem obsahu.
    // U CREATE TABLE to spadne hlasitě, u GRANT nebo INSERT tiše projde.
    const t = await startHarness({ migrate: false });
    try {
      const opts = (dir: string) => ({
        url: t.urlFor('mlain_migrator'), migrationsFolder: dir, ensurePartitions: false,
      });
      const first = fixtureMigrations({ '0000_a': 'CREATE TABLE t_a (id int PRIMARY KEY);' });
      await runMigrations(opts(first));
      const edited = fixtureMigrations({ '0000_a': 'CREATE TABLE t_a (id int PRIMARY KEY);\n' });
      await expect(runMigrations(opts(edited)))
        .rejects.toMatchObject({ exitCode: 6, code: 'migration_hash_mismatch', tag: '0000_a' });
    } finally { await t.stop(); }
  });

  it('neúspěšná migrace ZVÝŠÍ čítač v settings, i když je settings prázdný objekt', async () => {
    // jsonb_set nad prázdným objektem cestu nevytvoří a vrátí původní hodnotu,
    // takže původní tvar čítače by zůstal navždy na nule a pravidlo
    // „po třech neúspěších režim údržby" by bylo neproveditelné.
    const t = await startHarness({ migrate: false });
    try {
      await t.as('mlain_migrator').query(`
        CREATE TABLE system_settings (
          id boolean PRIMARY KEY DEFAULT true,
          schema_version integer NOT NULL,
          settings jsonb NOT NULL DEFAULT '{}'::jsonb,
          updated_at timestamptz NOT NULL DEFAULT now())`);
      await t.as('mlain_migrator').query(
        `INSERT INTO system_settings (id, schema_version) VALUES (true, 0)`);

      const dir = fixtureMigrations({ '0000_bad': 'CREATE TABLE (;' });
      const opts = { url: t.urlFor('mlain_migrator'), migrationsFolder: dir, ensurePartitions: false };
      await expect(runMigrations(opts)).rejects.toMatchObject({ exitCode: 3 });
      await expect(runMigrations(opts)).rejects.toMatchObject({ exitCode: 3 });

      const { rows } = await t.as('mlain_migrator').query<{ n: number }>(
        `SELECT (settings #>> ARRAY['migration_failures','0000_bad'])::int AS n
           FROM system_settings WHERE id = true`);
      expect(rows[0].n).toBe(2);
    } finally { await t.stop(); }
  });
});
```

- [ ] **Step 2: Spusť testy a ověř, že spadnou**

Run: `pnpm --filter @mlain/db test:db -- test/migrate.test.ts`
Expected: FAIL, `MIGRATION_ADVISORY_LOCK_ID` není exportované.

- [ ] **Step 3: Napiš runner**

```ts
// packages/db/src/migrate.ts
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';

/**
 * Pevná konstanta. Session-scoped advisory lock se uvolní i při pádu procesu,
 * což je jeho hlavní výhoda proti zámkové tabulce, kterou by po pádu musel
 * někdo uklidit ručně. Hodnota se NIKDY nemění: změna znamená, že staré
 * a nové repliky drží jiný zámek a migrují současně.
 */
export const MIGRATION_ADVISORY_LOCK_ID = 7264150401;

const DEFAULT_MIGRATIONS_FOLDER = fileURLToPath(new URL('../migrations', import.meta.url));

export type RunMigrationsOptions = {
  url: string;
  migrationsFolder?: string;
  /** Strop čekání na zámek. Přetečení = exit 75 (EX_TEMPFAIL), kontejner restartuje. */
  lockTimeoutSeconds?: number;
  /** Zajistí partition na aktuální a další tři měsíce. Vypíná se jen v testech runneru. */
  ensurePartitions?: boolean;
  logger?: (message: string) => void;
};

export class MigrationError extends Error {
  constructor(
    message: string,
    readonly exitCode: number,
    readonly code: string,
    readonly tag?: string,
    readonly statement?: string,
  ) {
    super(message);
    this.name = 'MigrationError';
  }
}

type JournalEntry = { idx: number; version: string; when: number; tag: string; breakpoints: boolean };
type Journal = { version: string; dialect: string; entries: JournalEntry[] };
type Directives = { noTransaction: boolean; timeoutSeconds: number; expand: boolean };

/** Direktivy smí nést jen souvislý blok komentářů na začátku souboru. */
export function parseDirectives(sql: string): Directives {
  const result: Directives = { noTransaction: false, timeoutSeconds: 60, expand: false };
  for (const line of sql.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    if (!trimmed.startsWith('--')) break;
    if (/^--\s*mlain:no-transaction\s*$/.test(trimmed)) result.noTransaction = true;
    const timeout = trimmed.match(/^--\s*mlain:timeout=(\d+)\s*$/);
    if (timeout) result.timeoutSeconds = Number(timeout[1]);
    if (/^--\s*mlain:expand\s*$/.test(trimmed)) result.expand = true;
  }
  return result;
}

export function splitStatements(sql: string): string[] {
  return sql
    .split('--> statement-breakpoint')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

async function acquireLock(client: Client, timeoutSeconds: number, log: (m: string) => void) {
  const deadline = Date.now() + timeoutSeconds * 1000;
  for (;;) {
    const { rows } = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS locked',
      [MIGRATION_ADVISORY_LOCK_ID],
    );
    if (rows[0].locked) return;
    if (Date.now() >= deadline) {
      throw new MigrationError(
        `nepodařilo se získat migrační zámek do ${timeoutSeconds} s`,
        75, 'migration_lock_timeout',
      );
    }
    log('migrační zámek drží jiná replika, čekám');
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

/** Vrací schema_version, nebo null, když tabulka system_settings ještě neexistuje. */
async function readSchemaVersion(client: Client): Promise<number | null> {
  const exists = await client.query<{ present: boolean }>(
    `SELECT to_regclass('public.system_settings') IS NOT NULL AS present`,
  );
  if (!exists.rows[0].present) return null;
  const { rows } = await client.query<{ schema_version: number }>(
    'SELECT schema_version FROM system_settings WHERE id = true',
  );
  return rows[0]?.schema_version ?? null;
}

export async function runMigrations(options: RunMigrationsOptions): Promise<void> {
  const folder = options.migrationsFolder ?? DEFAULT_MIGRATIONS_FOLDER;
  const log = options.logger ?? ((m: string) => console.info(`[migrate] ${m}`));
  const journal: Journal = JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8'));
  const entries = [...journal.entries].sort((a, b) => a.idx - b.idx);
  const maxVersion = entries.length;

  const client = new Client({ connectionString: options.url, options: '-c timezone=UTC' });
  await client.connect();
  try {
    await acquireLock(client, options.lockTimeoutSeconds ?? 300, log);

    // Downgrade guard. Bez něj by starší aplikace zapisovala do novějšího
    // schématu a tiše ho poškodila.
    const current = await readSchemaVersion(client);
    if (current !== null && current > maxVersion) {
      throw new MigrationError(
        `schema_version ${current} je vyšší než maximum ${maxVersion}, které tahle verze zná`,
        5, 'schema_version_ahead',
      );
    }

    await client.query('CREATE SCHEMA IF NOT EXISTS drizzle');
    await client.query(`
      CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
        id serial PRIMARY KEY,
        hash text NOT NULL,
        tag text NOT NULL,
        created_at bigint
      )`);
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_drizzle_migrations__hash
         ON drizzle.__drizzle_migrations (hash)`,
    );
    // Tag je druhý unikátní klíč. Bez něj se drift ve vydané migraci pozná
    // jen jako "neznámý hash", tedy jako pokyn migraci PŘEHRÁT.
    await client.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_drizzle_migrations__tag
         ON drizzle.__drizzle_migrations (tag)`,
    );
    const applied = await client.query<{ hash: string; tag: string }>(
      'SELECT hash, tag FROM drizzle.__drizzle_migrations',
    );
    const appliedHashes = new Set(applied.rows.map((row) => row.hash));
    const appliedByTag = new Map(applied.rows.map((row) => [row.tag, row.hash]));

    for (const entry of entries) {
      const sql = readFileSync(join(folder, `${entry.tag}.sql`), 'utf8');
      const hash = createHash('sha256').update(sql).digest('hex');

      // Drift guard. Vydaná migrace se needituje ani o bílý znak. Kdyby se
      // editovala, runner by ji podle hashe považoval za novou a přehrál by ji
      // nad hotovým schématem: u CREATE TABLE hlasitě, u GRANT nebo INSERT tiše.
      const previous = appliedByTag.get(entry.tag);
      if (previous !== undefined && previous !== hash) {
        throw new MigrationError(
          `migrace ${entry.tag} je už aplikovaná, ale její obsah se změnil `
          + `(v databázi ${previous.slice(0, 12)}, na disku ${hash.slice(0, 12)})`,
          6, 'migration_hash_mismatch', entry.tag,
        );
      }
      if (appliedHashes.has(hash)) continue;

      const directives = parseDirectives(sql);
      const statements = splitStatements(sql);
      log(`aplikuji ${entry.tag}${directives.noTransaction ? ' (mimo transakci)' : ''}`);

      let failing = '';
      try {
        await client.query(`SET lock_timeout = '${directives.timeoutSeconds}s'`);
        await client.query(`SET statement_timeout = '${directives.timeoutSeconds}s'`);
        if (!directives.noTransaction) await client.query('BEGIN');
        for (const statement of statements) {
          failing = statement;
          await client.query(statement);
        }
        failing = 'zápis do drizzle.__drizzle_migrations';
        await client.query(
          'INSERT INTO drizzle.__drizzle_migrations (hash, tag, created_at) VALUES ($1, $2, $3)',
          [hash, entry.tag, entry.when],
        );
        if (!directives.noTransaction) await client.query('COMMIT');
      } catch (error) {
        if (!directives.noTransaction) await client.query('ROLLBACK').catch(() => undefined);
        // Čítač se počítá až PO rollbacku, jinak by ho rollback vzal s sebou.
        // Jeho selhání se loguje, ale nepřebíjí původní chybu migrace:
        // tichý `.catch(() => undefined)` by zamaskoval i to, že se do čítače
        // nikdy nezapsalo, a přesně to se dřív stalo.
        await bumpFailureCounter(client, entry.tag).catch((counterError: unknown) => {
          log(`čítač neúspěchů migrace ${entry.tag} se nepodařilo zvýšit: `
            + `${(counterError as Error).message}`);
        });
        throw new MigrationError(
          `migrace ${entry.tag} selhala: ${(error as Error).message}`,
          3, 'migration_failed', entry.tag, failing,
        );
      } finally {
        await client.query('SET lock_timeout = DEFAULT').catch(() => undefined);
        await client.query('SET statement_timeout = DEFAULT').catch(() => undefined);
      }
    }

    if ((await readSchemaVersion(client)) !== null) {
      await client.query(
        'UPDATE system_settings SET schema_version = $1, updated_at = now() WHERE id = true',
        [maxVersion],
      );
    }

    if (options.ensurePartitions ?? true) {
      const { ensureUpcomingPartitions } = await import('./partitions.js');
      await ensureUpcomingPartitions(client, new Date(), 4);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_ADVISORY_LOCK_ID])
      .catch(() => undefined);
    await client.end();
  }
}

/**
 * Deterministicky chybná migrace by jinak zacyklila restart kontejneru.
 * Po třech neúspěších téže migrace se aplikace pouští v režimu údržby (P01).
 *
 * Mezikrok `migration_failures` se MUSÍ vytvořit zvlášť. `jsonb_set` s příznakem
 * create_missing doplní jen POSLEDNÍ složku cesty; když chybí složka dřívější,
 * vrátí funkce původní hodnotu beze změny a nic neohlásí. Ověřeno spuštěním:
 * `jsonb_set('{}', ARRAY['migration_failures','0003_x'], to_jsonb(1), true)`
 * vrátí `{}`, takže čítač by zůstal navždy na nule.
 */
async function bumpFailureCounter(client: Client, tag: string): Promise<void> {
  await client.query(
    `UPDATE system_settings
        SET settings = jsonb_set(
              CASE WHEN settings ? 'migration_failures'
                   THEN settings
                   ELSE settings || '{"migration_failures":{}}'::jsonb END,
              ARRAY['migration_failures', $1],
              to_jsonb(COALESCE((settings #>> ARRAY['migration_failures', $1])::int, 0) + 1),
              true),
            updated_at = now()
      WHERE id = true`,
    [tag],
  );
}
```

Kdyby souběžný běh v testu „tři repliky" selhal na unikátním indexu místo aby korektně přeskočil, znamená to, že se replika dostala k `INSERT` dřív, než jiná commitnula. Řešení je uvnitř zámku, ne mimo něj: zámek se drží po celý běh a `SELECT` aplikovaných hashů je uvnitř. Kdyby test přesto blikal, je chyba v pořadí `acquireLock` a `SELECT`.

- [ ] **Step 4: Spusť testy a ověř, že projdou**

Run: `pnpm --filter @mlain/db test:db -- test/migrate.test.ts`
Expected: PASS, 12 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/migrate.ts packages/db/test/migrate.test.ts
git commit -m "feat(db): migration runner with advisory lock, directives and downgrade guard"
```

---

### Task 5: Migrace 0000, rozšíření

**Files:**
- Create: `packages/db/migrations/0000_extensions.sql`
- Create: `packages/db/migrations/meta/_journal.json`
- Create: `packages/db/test/extensions.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/db/test/extensions.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './helpers/container.js';

let h: Harness;
beforeAll(async () => { h = await startHarness(); }, 180_000);
afterAll(async () => { await h.stop(); });

describe('rozšíření', () => {
  it('citext, pg_trgm a btree_gin jsou nainstalované', async () => {
    const { rows } = await h.as('mlain_app').query<{ extname: string }>(
      'SELECT extname FROM pg_extension ORDER BY extname',
    );
    const names = rows.map((r) => r.extname);
    expect(names).toContain('citext');
    expect(names).toContain('pg_trgm');
    expect(names).toContain('btree_gin');
  });
});
```

Test „spojení běží v UTC" tady **není**. Patří k harnessu (úkol 3) a jeho hodnota stojí a padá s tím, že databáze pod ním má **jinou** časovou zónu než UTC. Proti databázi, kterou si tentýž harness nastavil na UTC, by nemohl spadnout, ani kdyby se `options: '-c timezone=UTC'` z klienta úplně smazalo.

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm --filter @mlain/db test:db -- test/extensions.test.ts`
Expected: FAIL, `ENOENT ... migrations/meta/_journal.json` (runner ho čte při startu harnessu).

- [ ] **Step 3: Napiš `migrations/0000_extensions.sql`**

```sql
-- mlain:timeout=120

-- citext: jen pro e-mailové adresy. Porovnání adres musí být necitlivé na
-- velikost písmen v databázi, protože porovnávají dvě aplikace a jedna je v Go.
CREATE EXTENSION IF NOT EXISTS citext;
--> statement-breakpoint
-- pg_trgm: hledání kontaktu podle části jména nebo adresy. Bez něj je hledání
-- "nov" nad pěti miliony řádků seq scan v řádu sekund, a je to nejčastější
-- operace v celém nástroji. Požadavek části 2, kapitola 11.1, bod 1.1.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
-- btree_gin: aby šlo workspace_id (uuid) do stejného GIN indexu jako trigramy.
-- Bez něj by hledání procházelo cizí projekty a teprve pak je zahodilo.
-- Požadavek části 2, kapitola 11.1, bod 1.2.
CREATE EXTENSION IF NOT EXISTS btree_gin;
```

`ALTER DATABASE ... SET timezone = 'UTC'` tu **není schválně**: `ALTER DATABASE` smí jen vlastník databáze nebo superuživatel a `mlain_migrator` je ani jeden. Časovou zónu nastavuje `docker/initdb` (P01) a nezávisle na tom každé spojení přes `options: '-c timezone=UTC'` ve `src/client.ts`.

- [ ] **Step 4: Napiš `migrations/meta/_journal.json`**

```json
{
  "version": "7",
  "dialect": "postgresql",
  "entries": [
    { "idx": 0, "version": "7", "when": 1785000000000, "tag": "0000_extensions", "breakpoints": true }
  ]
}
```

- [ ] **Step 5: Spusť test a ověř, že projde**

Run: `pnpm --filter @mlain/db test:db -- test/extensions.test.ts`
Expected: PASS, 1 test.

- [ ] **Step 6: Commit**

```bash
git add packages/db/migrations packages/db/test/extensions.test.ts
git commit -m "feat(db): migration 0000 installs citext, pg_trgm and btree_gin"
```

---

### Task 6: Schéma identity (7 tabulek)

**Files:**
- Create: `packages/db/src/schema/identity.ts`

Tabulky: `users`, `sessions`, `password_reset_tokens`, `workspaces`, `memberships`, `invitations`, `api_keys`.

Konvence, které v tomhle a všech dalších schématech platí bez výjimky:

- Primární klíč je `uuid` s `DEFAULT uuidv7()`. Ne `bigserial`, protože ID cestují do URL, do tokenů a do webhooků a nesmí prozrazovat objemy. Ne UUIDv4, protože náhodné klíče roztrhají B-tree při zápisu.
- Časové razítko je vždy `timestamptz`, nikdy `timestamp`.
- `updated_at` aktualizuje **aplikace explicitně**, ne trigger. Trigger je neviditelná magie, kterou Go strana nezná.
- Enum je `text` plus pojmenovaný `CHECK`, nikdy nativní `CREATE TYPE`. Nativní enum nejde bezpečně měnit a jeho úprava je zámek nad tabulkou.
- Unikátní index nad měkce mazanou tabulkou je **částečný** (`WHERE deleted_at IS NULL`). Bez toho nejde znovu použít stejný e-mail nebo slug po smazání.

- [ ] **Step 1: Napiš `schema/identity.ts`**

```ts
// packages/db/src/schema/identity.ts
import { sql } from 'drizzle-orm';
import {
  check, index, integer, jsonb, pgTable, primaryKey,
  text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import { bytea, citext, inet } from './_types.js';

/**
 * Podmnožina BCP 47: jazyk[-Písmo][-Region]. Projde cs, en-GB, zh-Hant,
 * sr-Latn-RS i es-419. Rozšířené tagy (-u-, -x-) neprojdou schválně: v katalogu
 * zpráv nemají co dělat a jméno souboru messages/<locale>.json je součástí cesty.
 * Je to hrubá pojistka proti překlepu, přesnou validaci proti SUPPORTED_LOCALES
 * dělá aplikace, protože jen ona zná seznam existujících katalogů.
 */
const LOCALE_CHECK = sql.raw(`~ '^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$'`);

export const users = pgTable('users', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  email: citext().notNull(),
  emailVerifiedAt: timestamp({ withTimezone: true }),
  passwordHash: text().notNull(), // PHC řetězec argon2id
  passwordChangedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  name: text().notNull().default(''),
  // Defaulty jsou POJISTKA, ne konfigurace. Zdrojem hodnoty jsou DEFAULT_LOCALE
  // a DEFAULT_TIMEZONE a aplikace obě vždy vyplňuje explicitně, i když se rovnají.
  locale: text().notNull().default('cs'),
  timezone: text().notNull().default('Europe/Prague'),
  status: text().$type<'active' | 'suspended'>().notNull().default('active'),
  failedLoginCount: integer().notNull().default(0),
  lockedUntil: timestamp({ withTimezone: true }),
  lastLoginAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp({ withTimezone: true }),
}, (t) => [
  check('ck_users__status', sql`${t.status} IN ('active','suspended')`),
  check('ck_users__locale', sql`${t.locale} ${LOCALE_CHECK}`),
  // Přihlášení hledá podle e-mailu. Částečný, aby šlo znovu založit účet po smazání.
  uniqueIndex('uq_users__email').on(t.email).where(sql`${t.deletedAt} IS NULL`),
]);

export const sessions = pgTable('sessions', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: bytea().notNull(),   // SHA-256 z tokenu, 32 B. Syrový token se neukládá.
  csrfSecret: bytea().notNull(),  // 32 B
  userAgent: text().notNull().default(''),
  ip: inet(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  absoluteExpiresAt: timestamp({ withTimezone: true }).notNull(),
  revokedAt: timestamp({ withTimezone: true }),
  revokedReason: text(),
}, (t) => [
  // Ověření session na každém requestu: jediný lookup podle hashe.
  uniqueIndex('uq_sessions__token_hash').on(t.tokenHash),
  // "Odhlásit ze všech zařízení" a výpis relací uživatele.
  index('idx_sessions__user_id').on(t.userId).where(sql`${t.revokedAt} IS NULL`),
  // Úklidový job maže expirované relace.
  index('idx_sessions__absolute_expires_at').on(t.absoluteExpiresAt),
]);

export const passwordResetTokens = pgTable('password_reset_tokens', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: bytea().notNull(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  usedAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_password_reset_tokens__token_hash').on(t.tokenHash),
  // Invalidace starých tokenů při vydání nového a při změně hesla.
  index('idx_password_reset_tokens__user_id').on(t.userId),
]);

export const workspaces = pgTable('workspaces', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  name: text().notNull(),
  slug: text().notNull(),
  locale: text().notNull().default('cs'),
  timezone: text().notNull().default('Europe/Prague'),
  addressForm: text().$type<'formal' | 'informal'>().notNull().default('formal'),
  settings: jsonb().notNull().default({}),
  createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp({ withTimezone: true }),
}, (t) => [
  check('ck_workspaces__slug', sql`${t.slug} ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'`),
  check('ck_workspaces__locale', sql`${t.locale} ${LOCALE_CHECK}`),
  check('ck_workspaces__address_form', sql`${t.addressForm} IN ('formal','informal')`),
  // Slug je v URL, musí být unikátní mezi živými workspaces.
  uniqueIndex('uq_workspaces__slug').on(t.slug).where(sql`${t.deletedAt} IS NULL`),
]);

export const memberships = pgTable('memberships', {
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  userId: uuid().notNull().references(() => users.id, { onDelete: 'cascade' }),
  role: text().$type<'owner' | 'admin' | 'editor' | 'viewer'>().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ name: 'pk_memberships', columns: [t.workspaceId, t.userId] }),
  check('ck_memberships__role', sql`${t.role} IN ('owner','admin','editor','viewer')`),
  // Přepínač projektů: "které workspaces vidí tento uživatel".
  index('idx_memberships__user_id').on(t.userId),
  // Nejvýš jeden owner na workspace NENÍ vynuceno indexem, vynucuje ho aplikace (P04).
]);

export const invitations = pgTable('invitations', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  email: citext().notNull(),
  role: text().$type<'owner' | 'admin' | 'editor' | 'viewer'>().notNull(),
  tokenHash: bytea().notNull(),
  invitedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  acceptedAt: timestamp({ withTimezone: true }),
  acceptedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  revokedAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('ck_invitations__role', sql`${t.role} IN ('owner','admin','editor','viewer')`),
  uniqueIndex('uq_invitations__token_hash').on(t.tokenHash),
  // Jedna aktivní pozvánka na e-mail a workspace, jinak se nedá poznat, která platí.
  uniqueIndex('uq_invitations__ws_email_pending')
    .on(t.workspaceId, t.email)
    .where(sql`${t.acceptedAt} IS NULL AND ${t.revokedAt} IS NULL`),
]);

export const apiKeys = pgTable('api_keys', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  kind: text().$type<'secret' | 'public'>().notNull().default('secret'),
  prefix: text().notNull(),   // base32, 8 znaků u secret, 16 u public
  secretHash: bytea(),        // SHA-256, NULL pro kind='public'
  // Odklad při rotaci klíče (grace_seconds). Bez těchhle dvou sloupců je rotace
  // nutně okamžitá: integrace zákazníka přestane fungovat ve chvíli, kdy si
  // v UI vygeneruje nový klíč, a jediná náhradní cesta by byl druhý řádek
  // v api_keys, který rozbije uq_api_keys__prefix i ověřovací algoritmus,
  // protože ten dělá podle prefixu JEDINÝ lookup.
  previousSecretHash: bytea(),
  previousExpiresAt: timestamp({ withTimezone: true }),
  scopes: text().array().notNull().default([]),
  createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  lastUsedAt: timestamp({ withTimezone: true }),
  expiresAt: timestamp({ withTimezone: true }),
  revokedAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('ck_api_keys__kind', sql`${t.kind} IN ('secret','public')`),
  check('ck_api_keys__secret_hash', sql`
    (${t.kind} = 'secret' AND ${t.secretHash} IS NOT NULL) OR
    (${t.kind} = 'public' AND ${t.secretHash} IS NULL)`),
  // Délka prefixu je vázaná na druh klíče. Bez tohohle omezení by šlo založit
  // veřejný klíč s osmiznakovým prefixem a ověřovací algoritmus by ho nerozpoznal.
  check('ck_api_keys__prefix', sql`
    (${t.kind} = 'secret' AND ${t.prefix} ~ '^[a-z2-7]{8}$') OR
    (${t.kind} = 'public' AND ${t.prefix} ~ '^[a-z2-7]{16}$')`),
  // Předchozí hash a konec jeho odkladu drží nebo padají spolu. Hash bez času
  // by platil navždy, což je z rotace klíče, která má zvýšit bezpečnost,
  // přesně naopak: zneplatněný klíč by fungoval doživotně.
  check('ck_api_keys__previous_secret', sql`
    (${t.previousSecretHash} IS NULL AND ${t.previousExpiresAt} IS NULL) OR
    (${t.previousSecretHash} IS NOT NULL AND ${t.previousExpiresAt} IS NOT NULL)`),
  // Ověření klíče: jediný lookup podle prefixu, pak časově konstantní porovnání hashe.
  uniqueIndex('uq_api_keys__prefix').on(t.prefix),
  index('idx_api_keys__workspace_id').on(t.workspaceId).where(sql`${t.revokedAt} IS NULL`),
]);

export type User = typeof users.$inferSelect;
export type UserInsert = typeof users.$inferInsert;
export type Session = typeof sessions.$inferSelect;
export type SessionInsert = typeof sessions.$inferInsert;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type PasswordResetTokenInsert = typeof passwordResetTokens.$inferInsert;
export type Workspace = typeof workspaces.$inferSelect;
export type WorkspaceInsert = typeof workspaces.$inferInsert;
export type Membership = typeof memberships.$inferSelect;
export type MembershipInsert = typeof memberships.$inferInsert;
export type Invitation = typeof invitations.$inferSelect;
export type InvitationInsert = typeof invitations.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type ApiKeyInsert = typeof apiKeys.$inferInsert;
```

- [ ] **Step 2: Ověř, že soubor prochází typovou kontrolou**

Run: `pnpm --filter @mlain/db typecheck`
Expected: PASS (`schema/index.ts` ještě neexistuje, takže `schema-shape.test.ts` je dál červený, to je v pořádku).

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/schema/identity.ts
git commit -m "feat(db): identity schema, seven tables"
```

---

### Task 7: Schéma platformy (5 tabulek)

**Files:**
- Create: `packages/db/src/schema/platform.ts`

Tabulky: `idempotency_keys`, `webhook_endpoints`, `system_settings`, `secret_key_generations`, `rate_limits`. Partitionované tabulky platformy (`audit_log`, `webhook_events`, `webhook_deliveries`) jsou v úkolu 12.

- [ ] **Step 1: Napiš `schema/platform.ts`**

```ts
// packages/db/src/schema/platform.ts
import { sql } from 'drizzle-orm';
import {
  boolean, check, index, integer, jsonb, pgTable, primaryKey,
  smallint, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import { bytea } from './_types.js';
import { workspaces } from './identity.js';

export const idempotencyKeys = pgTable('idempotency_keys', {
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  key: text().notNull(),
  fingerprint: bytea().notNull(), // SHA-256(method|path|kanonické tělo)
  status: text().$type<'in_progress' | 'completed'>().notNull(),
  responseStatus: integer(),
  responseBody: jsonb(),
  lockedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp({ withTimezone: true }),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
}, (t) => [
  primaryKey({ name: 'pk_idempotency_keys', columns: [t.workspaceId, t.key] }),
  check('ck_idempotency_keys__status', sql`${t.status} IN ('in_progress','completed')`),
  check('ck_idempotency_keys__key_len', sql`length(${t.key}) BETWEEN 8 AND 255`),
  index('idx_idempotency_keys__expires_at').on(t.expiresAt),
]);

export const webhookEndpoints = pgTable('webhook_endpoints', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  url: text().notNull(),
  description: text().notNull().default(''),
  eventTypes: text().array().notNull(),
  secretEncrypted: text().notNull(), // obálka enc:v1:<base64>, context 'webhook_secret'
  status: text().$type<'active' | 'disabled'>().notNull().default('active'),
  disabledReason: text(),
  disabledAt: timestamp({ withTimezone: true }),
  consecutiveFailures: integer().notNull().default(0),
  lastSuccessAt: timestamp({ withTimezone: true }),
  lastFailureAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp({ withTimezone: true }),
}, (t) => [
  check('ck_webhook_endpoints__status', sql`${t.status} IN ('active','disabled')`),
  check('ck_webhook_endpoints__event_types',
    sql`cardinality(${t.eventTypes}) BETWEEN 1 AND 50`),
  // Fan-out události: "které aktivní endpointy v tomhle projektu chtějí tenhle typ".
  index('idx_webhook_endpoints__ws_active').on(t.workspaceId)
    .where(sql`${t.deletedAt} IS NULL AND ${t.status} = 'active'`),
  index('idx_webhook_endpoints__event_types').using('gin', t.eventTypes),
]);

/**
 * Jeden řádek, stav instalace. Trik s boolean primárním klíčem a CHECK (id = true)
 * je standardní: bez něj se dřív nebo později objeví dva řádky konfigurace
 * a nikdo nebude vědět, který platí.
 */
export const systemSettings = pgTable('system_settings', {
  id: boolean().primaryKey().default(true),
  installationId: uuid().notNull().default(sql`uuidv7()`),
  schemaVersion: integer().notNull(),
  secretKeyFingerprint: text().notNull(),
  // Rozhodnutí R7: sloupec doplněný proti DDL části 1. Migrační runner do něj
  // počítá neúspěchy migrace (klíč migration_failures), protože pravidlo
  // "po třech neúspěších režim údržby" jinak nemá kam zapsat stav.
  settings: jsonb().notNull().default({}),
  setupCompletedAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('ck_system_settings__singleton', sql`${t.id} = true`),
]);

/**
 * Pokolení šifrovacího klíče (rozhodnutí R28).
 *
 * Bez téhle tabulky nemá `mlain doctor` (P16) jak poznat rozdíl mezi
 * „klíč pokolení 2 existuje" a „pod číslem 2 je dnes jiný klíč". Otisky
 * v suppressions se po výmazu přepočítat NEDAJÍ, takže prohození SECRET_KEY
 * a SECRET_KEY_PREVIOUS po obnově ze zálohy znamená, že vymazaný člověk
 * projde suppression kontrolou a dostane e-mail. Nic přitom nespadne
 * a nic se nezaloguje: je to nejtišší porucha, jakou produkt má.
 *
 * `fingerprint` je otisk SAMOTNÉHO KLÍČE, ne adresy: SHA-256 z odvozeného
 * podklíče, stejný recept jako system_settings.secret_key_fingerprint.
 * Řádky zapisuje POST /api/v1/setup a rotace klíče (P16), nikdy migrace.
 */
export const secretKeyGenerations = pgTable('secret_key_generations', {
  keyId: smallint().primaryKey(),
  fingerprint: text().notNull(),
  introducedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  retiredAt: timestamp({ withTimezone: true }),
}, (t) => [
  check('ck_secret_key_generations__key_id', sql`${t.keyId} >= 0`),
  // Dva různé klíče pod týmž otiskem nedávají smysl a dva různé otisky
  // pod týmž key_id jsou přesně ta porucha, kterou tabulka odhaluje.
  uniqueIndex('uq_secret_key_generations__fingerprint').on(t.fingerprint),
]);

/**
 * Čítače pro RATE_LIMIT_BACKEND=postgres. Preflight P04 tabulku vyžaduje
 * a bez ní rate limiting nad Postgresem nejde spustit vůbec.
 *
 * Rozsah limitu nese TEXTOVÝ KLÍČ `scope:identifier:window`, ne sloupec
 * workspace_id (rozhodnutí R36). Přihlašovací a IP limity žádný workspace
 * kontext nemají, takže by je politika s WITH CHECK vyhodnoceným jako NULL
 * odmítla a limiter by přestal fungovat právě na přihlašování, tedy tam,
 * kde na něm stojí ochrana proti hádání hesel. Tabulka je proto na whitelistu
 * a RLS se na ni nezapíná; nese čítače, ne obsah zákazníka, a je to tentýž
 * tvar, jaký už mají sessions a password_reset_tokens.
 *
 * window_start je začátek okna zaokrouhlený dolů, NE now(): dva zápisy
 * v témž okně musí kolidovat, jinak by ON CONFLICT nikdy nesepnul a limiter
 * by počítal každý požadavek jako první. Je to táž past, kterou plán řeší
 * u provider_event_receipts (rozhodnutí R22).
 */
export const rateLimits = pgTable('rate_limits', {
  bucket: text().notNull(),
  windowStart: timestamp({ withTimezone: true }).notNull(),
  hits: integer().notNull().default(0),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
}, (t) => [
  primaryKey({ name: 'pk_rate_limits', columns: [t.bucket, t.windowStart] }),
  // Tvarová pojistka. Bez ní by překlep ve jméně rozsahu vyrobil vlastní
  // kbelík, který nikdy nic neomezí, a nikdo by si toho nevšiml, protože
  // "limit se nepřekročil" vypadá stejně jako "limit se nepočítá".
  check('ck_rate_limits__bucket', sql`${t.bucket} ~
    '^(user|workspace|ip|global):[^:]{1,128}:[a-z0-9_]{1,32}$'`),
  check('ck_rate_limits__hits', sql`${t.hits} >= 0`),
  // Úklid prošlých oken. Bez indexu by mazací dotaz skenoval celou tabulku.
  index('idx_rate_limits__expires').on(t.expiresAt),
]);

export type IdempotencyKey = typeof idempotencyKeys.$inferSelect;
export type IdempotencyKeyInsert = typeof idempotencyKeys.$inferInsert;
export type WebhookEndpoint = typeof webhookEndpoints.$inferSelect;
export type WebhookEndpointInsert = typeof webhookEndpoints.$inferInsert;
export type SystemSettings = typeof systemSettings.$inferSelect;
export type SystemSettingsInsert = typeof systemSettings.$inferInsert;
export type SecretKeyGeneration = typeof secretKeyGenerations.$inferSelect;
export type SecretKeyGenerationInsert = typeof secretKeyGenerations.$inferInsert;
export type RateLimit = typeof rateLimits.$inferSelect;
export type RateLimitInsert = typeof rateLimits.$inferInsert;
```

Import `users` v seznamu **není** a být nesmí: vazba na `users` v téhle doméně neexistuje, `webhook_endpoints` nemá `created_by`. Nepoužitý import shodí typovou kontrolu se zapnutým `noUnusedLocals`, což je přesně ten druh chyby, která se v plánu dřív předávala dál jako poznámka „kdyby ho linter hlásil, odstraň ho".

- [ ] **Step 2: Ověř typovou kontrolu**

Run: `pnpm --filter @mlain/db typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/schema/platform.ts
git commit -m "feat(db): platform schema, idempotency keys, webhook endpoints and system settings"
```

---

### Task 8: Schéma kontaktů (23 tabulek)

**Files:**
- Create: `packages/db/src/schema/contacts.ts`

Tabulky: `contacts`, `contact_fields`, `tags`, `contact_tags`, `lists`, `list_subscriptions`, `subscription_confirmations`, `consents`, `contact_consent_state`, `suppressions`, `imports`, `import_errors`, `exports`, `name_overrides`, `segments`, `segment_members`, `forms`, `form_submissions`, `inbound_endpoints`, `inbound_dedup`, `gdpr_requests`, `retention_policies`, `retention_runs`. Partitionovaná `inbound_deliveries` je v úkolu 12.

Tři věci, které jsou u téhle domény snadné pokazit a projeví se až v provozu:

1. `contacts.email_fingerprints` je **pole**, ne jedna hodnota. U kontaktu máme plaintext adresy, takže otisk umíme kdykoliv dopočítat pod všemi pokoleními klíče. U řádku v `suppressions` po výmazu už ne. Kdyby tu byla jedna hodnota pod aktuálním klíčem, po rotaci `SECRET_KEY` by se přestala shodovat se starými otisky a **vymazaný člověk by se vrátil prvním importem, aniž by cokoliv selhalo.**
2. `contact_fields.archived_at` **není měkké mazání**, proto se nejmenuje `deleted_at`. Archivované pole je živý záznam, jeho hodnoty v `attributes` zůstávají a segmenty na něj dál fungují. Jeho unikátní index je proto **úplný**, ne částečný, aby se klíč archivovaného pole nedal znovu použít s jiným typem.
3. `contacts.first_name_key` a `last_name_key` plní aplikace funkcí `normalizeNameKey()`, ne databázový výraz. Je to bajt za bajt tatáž funkce, jakou se hledá ve slovníku jmen a v `name_overrides`; tři místa nesmí dát tři různé odpovědi.

- [ ] **Step 1: Napiš `schema/contacts.ts`, první polovina (kontakty, pole, štítky, seznamy, souhlasy, suppression)**

```ts
// packages/db/src/schema/contacts.ts
import { sql } from 'drizzle-orm';
import {
  bigint, boolean, check, index, integer, jsonb, pgTable, primaryKey,
  smallint, text, timestamp, uniqueIndex, uuid, type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { bytea, byteaArray, citext, inet, inetArray } from './_types.js';
import { workspaces } from './identity.js';

export const contacts = pgTable('contacts', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),

  email: citext().notNull(),
  // Otisky adresy pro VŠECHNA známá pokolení klíče. Recept vlastní část 1 (3.10):
  // HMAC-SHA256(HKDF(SECRET_KEY, "mailer/v1", "mailer/v1/suppression-fingerprint"), lower(email)).
  emailFingerprints: byteaArray().notNull().default(sql`'{}'::bytea[]`),
  emailDomain: text().generatedAlwaysAs(sql`lower(split_part(email::text, '@', 2))`),

  status: text().$type<'active' | 'unconfirmed' | 'unsubscribed' | 'bounced' | 'complained' | 'deleted'>()
    .notNull().default('active'),
  processingRestricted: boolean().notNull().default(false), // GDPR čl. 18

  firstName: text(),
  lastName: text(),
  middleName: text(),
  titlePrefix: text(),
  titleSuffix: text(),

  // lower + NFD + odstraněné kombinovací znaky, plní aplikace normalizeNameKey().
  firstNameKey: text(),
  lastNameKey: text(),

  // Vyhledávací klíč BEZ DIAKRITIKY přes celý kontakt (e-mail, jméno, příjmení),
  // plní ho aplikace týmž normalizeNameKey() jako klíče výš. Nesmí to být
  // generovaný sloupec: odstranění diakritiky umí jen unaccent(), a to je
  // funkce STABLE, ne IMMUTABLE, takže ji generovaný sloupec ani indexový
  // výraz použít nemůže. Rozšíření unaccent je navíc zamítnuté.
  //
  // Proč vedle search_text: search_text drží text v původním tvaru, takže
  // "Novacek" v něm "Nováčka" nenajde. Hledání bez diakritiky musí fungovat
  // OBOUSMĚRNĚ, tedy i dotaz s diakritikou nad odstraněnou a naopak, a to jde
  // jen tak, že se obě strany normalizují stejně. Je to požadavek P07 (R12).
  searchKey: text(),

  gender: text().$type<'female' | 'male' | 'unknown'>().notNull().default('unknown'),
  genderSource: text().notNull().default('none'),

  firstNameVocative: text(),
  lastNameVocative: text(),
  vocativeConfidence: text().$type<'high' | 'low' | 'none'>().notNull().default('none'),
  vocativeLocked: boolean().notNull().default(false),
  vocativeLockedFor: text(),
  vocativeReviewedAt: timestamp({ withTimezone: true }),
  vocativeReviewedBy: uuid(),

  greeting: text().notNull().default(''),
  greetingNeutral: text().notNull().default(''),
  nameSplitConfidence: text().$type<'high' | 'low' | 'none'>().notNull().default('none'),

  attributes: jsonb().notNull().default({}),
  locale: text().notNull().default('cs'),
  timezone: text(),

  source: text().notNull().default('manual'),
  sourceRef: text(),

  // Rozhodnutí R6: požadavek části 5 (12.3, bod 4). Nepodepsané identify
  // z prohlížeče páruje kontakt podle vlastního identifikátoru zákazníka.
  externalId: text(),

  lastActivityAt: timestamp({ withTimezone: true }), // udržuje část 5
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp({ withTimezone: true }),
  anonymizedAt: timestamp({ withTimezone: true }),

  searchText: text().generatedAlwaysAs(sql`lower(
    coalesce(email::text,'') || ' ' || coalesce(first_name,'') || ' ' || coalesce(last_name,''))`),
}, (t) => [
  check('ck_contacts__status', sql`${t.status} IN
    ('active','unconfirmed','unsubscribed','bounced','complained','deleted')`),
  check('ck_contacts__gender', sql`${t.gender} IN ('female','male','unknown')`),
  check('ck_contacts__gender_source', sql`${t.genderSource} IN
    ('explicit','workspace_override','surname_rule','surname_rule_translit',
     'given_name_dict','library_heuristic','manual','none')`),
  check('ck_contacts__vocative_confidence', sql`${t.vocativeConfidence} IN ('high','low','none')`),
  check('ck_contacts__name_split_confidence',
    sql`${t.nameSplitConfidence} IN ('high','low','none')`),
  check('ck_contacts__source', sql`${t.source} IN
    ('manual','import','api','form','webhook','double_opt_in','migration')`),
  // Tvarová pojistka, ne seznam povolených jazyků. Import z cizího CRM běžně nese
  // fr-CA nebo zh-Hant a shodit kvůli tomu řádek je nepřiměřené.
  check('ck_contacts__locale',
    sql`${t.locale} ~ '^[a-zA-Z]{2,3}(-[A-Za-z]{4})?(-([A-Za-z]{2}|[0-9]{3}))?$'`),
  check('ck_contacts__email_len', sql`char_length(${t.email}::text) BETWEEN 3 AND 254`),
  check('ck_contacts__attributes_object', sql`jsonb_typeof(${t.attributes}) = 'object'`),
  // Pojistka proti havárii, ne vynucení limitu. Skutečný limit hlídá aplikace nad
  // SERIALIZOVANOU délkou JSON, protože pg_column_size měří velikost po TOAST
  // kompresi a dva kontakty se stejně dlouhými daty by skončily jeden pod limitem
  // a druhý nad ním podle toho, jak dobře se text komprimuje.
  check('ck_contacts__attributes_sane', sql`pg_column_size(${t.attributes}) <= 4194304`),

  // 1. Klíč pro upsert. Částečný: měkce smazaný kontakt nesmí blokovat nové přihlášení.
  uniqueIndex('uq_contacts__workspace_email').on(t.workspaceId, t.email)
    .where(sql`${t.deletedAt} IS NULL`),
  // 2. Výchozí řazení v seznamu a kurzorové stránkování (keyset na (created_at, id)).
  index('idx_contacts__ws_created')
    .on(t.workspaceId, t.createdAt.desc(), t.id.desc())
    .where(sql`${t.deletedAt} IS NULL`),
  // 3. Filtr podle stavu v seznamu i v segmentech.
  index('idx_contacts__ws_status_created')
    .on(t.workspaceId, t.status, t.createdAt.desc())
    .where(sql`${t.deletedAt} IS NULL`),
  // 4. Preset "neaktivní 90+ dní" a řazení podle poslední aktivity.
  index('idx_contacts__ws_last_activity')
    .on(t.workspaceId, t.lastActivityAt.desc().nullsLast())
    .where(sql`${t.deletedAt} IS NULL`),
  // 5. Fulltext v UI. btree_gin dovolí uuid do stejného indexu jako trigramy,
  //    takže dotaz nikdy neprochází cizí projekty.
  index('idx_contacts__search_trgm')
    .using('gin', t.workspaceId, sql`${t.searchText} gin_trgm_ops`),
  // 5b. Totéž nad klíčem bez diakritiky. Ověřeno spuštěním: dotaz
  //     `search_key LIKE '%novacek%'` najde kontakt "Nováček" a plánovač
  //     na index skutečně sáhne (Bitmap Index Scan), takže hledání
  //     neprochází cizí projekty ani nedělá seq scan.
  index('idx_contacts__search_key_trgm')
    .using('gin', t.workspaceId, sql`${t.searchKey} gin_trgm_ops`),
  // 6. Rovnostní a containment predikáty nad vlastními poli v segmentech.
  //    jsonb_path_ops je menší a rychlejší než výchozí jsonb_ops a stačí na @>.
  index('idx_contacts__attributes_gin')
    .using('gin', sql`${t.attributes} jsonb_path_ops`),
  // 7. Fronta ke kontrole vokativu. Zobrazuje se výhradně seskupená podle
  //    first_name_key, nikdy po jednotlivých kontaktech.
  index('idx_contacts__ws_vocative_review')
    .on(t.workspaceId, t.firstNameKey, t.createdAt.desc())
    .where(sql`${t.vocativeConfidence} = 'low' AND ${t.vocativeLocked} = false
               AND ${t.deletedAt} IS NULL`),
  // 8. Operátor matches_domain v segmentech a analýza doručitelnosti.
  index('idx_contacts__ws_email_domain').on(t.workspaceId, t.emailDomain)
    .where(sql`${t.deletedAt} IS NULL`),
  // 9. Kontrola suppression po výmazu: kontakt nese otisk pod všemi pokoleními klíče.
  index('idx_contacts__email_fingerprints').using('gin', t.emailFingerprints),
  // 10. Kurzorový průchod celým projektem podle id: materializace publika po dávkách,
  //     hromadné mazání, export, přepočty. Bez něj by dotaz sedl na primární klíč
  //     a procházel i cizí projekty, než by je zahodil.
  index('idx_contacts__ws_id').on(t.workspaceId, t.id).where(sql`${t.deletedAt} IS NULL`),
  // 11. Rozhodnutí R6: párování podle externího identifikátoru zákazníka.
  uniqueIndex('uq_contacts__ws_external_id').on(t.workspaceId, t.externalId)
    .where(sql`${t.externalId} IS NOT NULL AND ${t.deletedAt} IS NULL`),
]);

export const contactFields = pgTable('contact_fields', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  key: text().notNull(),
  // Otevřená mapa jazyk na text. Sada jazyků je záměrně neomezená, přidání
  // jazyka nesmí vyžadovat migraci ani změnu kódu.
  label: jsonb().notNull().default({}),
  description: jsonb().notNull().default({}),
  type: text().notNull(),
  options: jsonb().notNull().default({}),
  required: boolean().notNull().default(false),
  subjectEditable: boolean().notNull().default(false),
  indexed: boolean().notNull().default(false),
  indexState: text().$type<'none' | 'building' | 'ready' | 'failed'>().notNull().default('none'),
  position: integer().notNull().default(0),
  archivedAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('ck_contact_fields__key', sql`${t.key} ~ '^[a-z][a-z0-9_]{0,39}$'`),
  check('ck_contact_fields__type', sql`${t.type} IN
    ('text','long_text','number','boolean','date','datetime',
     'enum','multi_enum','url','email','phone')`),
  check('ck_contact_fields__index_state',
    sql`${t.indexState} IN ('none','building','ready','failed')`),
  // ÚPLNÝ index schválně: archivované pole je živý záznam a jeho klíč se nesmí
  // dát znovu použít s jiným typem.
  uniqueIndex('uq_contact_fields__workspace_key').on(t.workspaceId, t.key),
  index('idx_contact_fields__ws_position').on(t.workspaceId, t.position)
    .where(sql`${t.archivedAt} IS NULL`),
]);

export const tags = pgTable('tags', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  color: text(),
  description: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('ck_tags__name_len', sql`char_length(${t.name}) BETWEEN 1 AND 60`),
  check('ck_tags__color', sql`${t.color} IS NULL OR ${t.color} ~ '^#[0-9a-fA-F]{6}$'`),
  // Štítky se zadávají volným textem, kolize na velikosti písmen je nejčastější chyba.
  uniqueIndex('uq_tags__workspace_name').on(t.workspaceId, sql`lower(${t.name})`),
]);

export const contactTags = pgTable('contact_tags', {
  contactId: uuid().notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  tagId: uuid().notNull().references(() => tags.id, { onDelete: 'cascade' }),
  // workspace_id je odvoditelné z kontaktu, ale je tu schválně: kompilátor
  // segmentů díky tomu nemusí joinovat zpět na contacts.
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ name: 'pk_contact_tags', columns: [t.contactId, t.tagId] }),
  // Segment "má štítek X" jde od štítku ke kontaktům, proto obrácený index.
  // workspace_id v čele je POVINNÉ u každé tabulky s kaskádou na workspaces:
  // bez něj je tvrdé smazání projektu sekvenční průchod celou tabulkou
  // a politika ws_isolation se nevyhodnocuje nad indexovaným sloupcem.
  index('idx_contact_tags__ws_tag_contact').on(t.workspaceId, t.tagId, t.contactId),
]);

export const lists = pgTable('lists', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  description: text(),
  optIn: text().$type<'single' | 'double'>().notNull().default('double'),
  confirmationMode: text().$type<'one_step' | 'two_step'>().notNull().default('two_step'),
  confirmationTtlHours: integer().notNull().default(168),
  confirmationTemplateId: uuid(),  // FK doplní část 3 přes templates, viz poznámka níž
  welcomeTemplateId: uuid(),
  sendWelcome: boolean().notNull().default(false),
  confirmationMaxResends: smallint().notNull().default(3),
  isDefault: boolean().notNull().default(false),
  deletedAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('ck_lists__name_len', sql`char_length(${t.name}) BETWEEN 1 AND 120`),
  check('ck_lists__opt_in', sql`${t.optIn} IN ('single','double')`),
  check('ck_lists__confirmation_mode', sql`${t.confirmationMode} IN ('one_step','two_step')`),
  check('ck_lists__confirmation_ttl', sql`${t.confirmationTtlHours} BETWEEN 1 AND 720`),
  check('ck_lists__confirmation_max_resends',
    sql`${t.confirmationMaxResends} BETWEEN 0 AND 10`),
  uniqueIndex('uq_lists__workspace_name').on(t.workspaceId, sql`lower(${t.name})`)
    .where(sql`${t.deletedAt} IS NULL`),
  uniqueIndex('uq_lists__workspace_default').on(t.workspaceId)
    .where(sql`${t.isDefault} AND ${t.deletedAt} IS NULL`),
]);
```

`lists.confirmation_template_id` a `welcome_template_id` **záměrně nemají cizí klíč**. Míří do `templates`, které zakládá `schema/content.ts`, a cizí klíč mezi doménami by v pořadí vytváření znamenal cyklus mezi soubory. Integritu drží aplikace při zápisu a `ON DELETE SET NULL` by tu stejně nedávalo smysl, protože šablona potvrzovacího e-mailu je systémová a nemaže se.

- [ ] **Step 2: Napiš druhou polovinu `schema/contacts.ts` (přihlášení, souhlasy, suppression, import, segmenty, formuláře, GDPR)**

Pokračuj ve stejném souboru.

```ts
export const listSubscriptions = pgTable('list_subscriptions', {
  contactId: uuid().notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  listId: uuid().notNull().references(() => lists.id, { onDelete: 'cascade' }),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  status: text().$type<'pending' | 'confirmed' | 'unsubscribed' | 'bounced' | 'complained'>().notNull(),
  source: text().notNull(),
  sourceRef: text(),
  subscribedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp({ withTimezone: true }),
  unsubscribedAt: timestamp({ withTimezone: true }),
  unsubscribeReason: text(),
  unsubscribeCampaignId: uuid(),
  snoozeUntil: timestamp({ withTimezone: true }),
  confirmationSentAt: timestamp({ withTimezone: true }),
  confirmationResends: smallint().notNull().default(0),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Klíč je (contact_id, list_id) schválně proti opačnému pořadí: detail kontaktu
  // potřebuje všechny jeho seznamy, což je nejčastější přístup z UI.
  primaryKey({ name: 'pk_list_subscriptions', columns: [t.contactId, t.listId] }),
  check('ck_list_subscriptions__status', sql`${t.status} IN
    ('pending','confirmed','unsubscribed','bounced','complained')`),
  check('ck_list_subscriptions__source', sql`${t.source} IN
    ('manual','import','api','form','webhook','preference_center','double_opt_in','migration')`),
  check('ck_list_subscriptions__unsubscribe_reason', sql`${t.unsubscribeReason} IS NULL OR
    ${t.unsubscribeReason} IN ('link','one_click','preference_center','api','manual',
                               'complaint','bounce','global','objection','import')`),
  // Sestavení publika kampaně: "všichni potvrzení na seznamu X". Nejčastější dotaz v systému.
  index('idx_list_subscriptions__list_status').on(t.listId, t.status, t.contactId),
  index('idx_list_subscriptions__pending').on(t.workspaceId, t.confirmationSentAt)
    .where(sql`${t.status} = 'pending'`),
  index('idx_list_subscriptions__snooze').on(t.workspaceId, t.snoozeUntil)
    .where(sql`${t.snoozeUntil} IS NOT NULL`),
]);

export const subscriptionConfirmations = pgTable('subscription_confirmations', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  contactId: uuid().notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  listId: uuid().notNull().references(() => lists.id, { onDelete: 'cascade' }),
  tokenHash: bytea().notNull(),  // SHA-256, syrový token se neukládá
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  consumedAt: timestamp({ withTimezone: true }),
  consumedIp: inet(),
  requestIp: inet(),
  requestUserAgent: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_subscription_confirmations__token_hash').on(t.tokenHash),
  index('idx_subscription_confirmations__expiry').on(t.expiresAt)
    .where(sql`${t.consumedAt} IS NULL`),
  // Úplný, ne částečný: slouží i kaskádovému mazání projektu, které predikát
  // částečného indexu nesplňuje.
  index('idx_subscription_confirmations__ws_created').on(t.workspaceId, t.createdAt),
]);

/** Append only. Vynucuje se odebráním práv aplikační roli v migraci 0006, ne pravidly. */
export const consents = pgTable('consents', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  contactId: uuid().notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  purpose: text().notNull(),
  scopeListId: uuid().references(() => lists.id, { onDelete: 'set null' }), // NULL = celý projekt
  status: text().$type<'granted' | 'withdrawn'>().notNull(),
  legalBasis: text().notNull(),
  source: text().notNull(),
  sourceRef: text(),
  consentText: text(),
  consentTextHash: bytea(),
  evidence: jsonb().notNull().default({}),
  recordedBy: text().notNull().default('system'),
  occurredAt: timestamp({ withTimezone: true }).notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('ck_consents__purpose', sql`${t.purpose} IN
    ('email_marketing','analytics','personalization','profiling','third_party')`),
  check('ck_consents__status', sql`${t.status} IN ('granted','withdrawn')`),
  check('ck_consents__legal_basis', sql`${t.legalBasis} IN
    ('consent','legitimate_interest','contract','soft_opt_in')`),
  // Otevřený výčet: rozšíření je čistá migrace omezení a nevyžaduje synchronizaci
  // s ostatními částmi, protože hodnotu nikdo nečte jako řídicí údaj.
  check('ck_consents__source', sql`${t.source} IN
    ('form','import','api','double_opt_in','admin','webhook','preference_center',
     'one_click','complaint','objection','reactivation','migration')`),
  index('idx_consents__contact_purpose').on(t.contactId, t.purpose, t.occurredAt.desc()),
  index('idx_consents__ws_purpose').on(t.workspaceId, t.purpose, t.occurredAt.desc()),
]);

/** Rychlý pohled na aktuální stav souhlasu. Segmentace nesmí procházet append-only log. */
export const contactConsentState = pgTable('contact_consent_state', {
  contactId: uuid().notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  purpose: text().notNull(),
  status: text().$type<'granted' | 'withdrawn'>().notNull(),
  legalBasis: text().notNull(),
  since: timestamp({ withTimezone: true }).notNull(),
  lastConsentId: uuid().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ name: 'pk_contact_consent_state', columns: [t.contactId, t.purpose] }),
  check('ck_contact_consent_state__status', sql`${t.status} IN ('granted','withdrawn')`),
  index('idx_contact_consent_state__ws_purpose_status')
    .on(t.workspaceId, t.purpose, t.status, t.contactId),
]);

export const suppressions = pgTable('suppressions', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  email: citext().notNull(),  // u reason='gdpr_erasure' placeholder
  // Otisk původní adresy. Přepočítat ho po rotaci NELZE, protože plaintext je
  // po výmazu pryč. Proto se ověřuje svým pokolením a proto se SECRET_KEY_PREVIOUS
  // nikdy nevyprazdňuje.
  fingerprint: bytea().notNull(),
  fingerprintKeyId: smallint().notNull(),
  reason: text().notNull(),
  source: text().notNull(),
  sourceRef: text(),
  detail: text(),
  metadata: jsonb().notNull().default({}),
  removable: boolean().notNull().default(false),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  createdBy: text().notNull().default('system'),
  removedAt: timestamp({ withTimezone: true }),
  removedBy: uuid(),
  removalNote: text(),
}, (t) => [
  check('ck_suppressions__reason', sql`${t.reason} IN
    ('hard_bounce','soft_bounce_threshold','complaint','manual','global_unsubscribe',
     'one_click_unsubscribe','invalid','import','gdpr_erasure','ses_suppressed')`),
  // Kontrola "smí se na tuhle adresu poslat" musí být O(1), běží při každém
  // přihlášení, importovaném řádku i materializaci publika.
  uniqueIndex('uq_suppressions__workspace_email').on(t.workspaceId, t.email)
    .where(sql`${t.removedAt} IS NULL`),
  // Druhá větev téže kontroly pro adresy vymazané podle GDPR, kde plaintext nemáme.
  index('idx_suppressions__ws_fingerprint').on(t.workspaceId, t.fingerprint)
    .where(sql`${t.removedAt} IS NULL`),
  // mlain doctor čte SELECT DISTINCT fingerprint_key_id a chybějící pokolení
  // hlásí jako KRITICKOU chybu: bez starých klíčů přestanou platit otisky
  // smazaných adres a vymazaný člověk se vrátí prvním importem.
  index('idx_suppressions__fingerprint_key_id').on(t.fingerprintKeyId),
  index('idx_suppressions__ws_reason').on(t.workspaceId, t.reason, t.createdAt.desc()),
]);
```

- [ ] **Step 3: Napiš třetí část `schema/contacts.ts` (import, export, přepisy jmen, segmenty, formuláře, příchozí webhooky, GDPR, retence)**

```ts
export const imports = pgTable('imports', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  filename: text().notNull(),
  // NULL znamená "soubor už v úložišti není". NOT NULL by retenčnímu jobu nedal
  // jak stav zaznamenat a job by donekonečna nabízel ke smazání soubory,
  // které už smazal.
  storageKey: text(),
  byteSize: bigint({ mode: 'number' }).notNull(),
  contentSha256: bytea().notNull(),
  idempotencyKey: text().notNull(),
  status: text().notNull(),
  encoding: text(),
  encodingSource: text(),
  delimiter: text(),
  quoteChar: text().notNull().default('"'),
  hasHeader: boolean().notNull().default(true),
  mapping: jsonb().notNull().default({}),
  options: jsonb().notNull().default({}),
  totalRows: bigint({ mode: 'number' }),
  checkpointRow: bigint({ mode: 'number' }).notNull().default(0),
  checkpointByte: bigint({ mode: 'number' }).notNull().default(0),
  processedRows: bigint({ mode: 'number' }).notNull().default(0),
  createdRows: bigint({ mode: 'number' }).notNull().default(0),
  updatedRows: bigint({ mode: 'number' }).notNull().default(0),
  skippedRows: bigint({ mode: 'number' }).notNull().default(0),
  suppressedRows: bigint({ mode: 'number' }).notNull().default(0),
  errorRows: bigint({ mode: 'number' }).notNull().default(0),
  warningRows: bigint({ mode: 'number' }).notNull().default(0),
  reviewRows: bigint({ mode: 'number' }).notNull().default(0),
  // Kolik chybných řádků je SKUTEČNĚ uložených v import_errors. Liší se od
  // error_rows, protože ukládání chyb má strop: u souboru, kde je špatně
  // všechno, se neukládá milion řádků. Bez tohohle sloupce by se počet
  // uložených musel zjišťovat přes count(*) nad import_errors v KAŽDÉ
  // checkpointové dávce, tedy nejčastějším dotazem celého importu.
  storedErrorCount: bigint({ mode: 'number' }).notNull().default(0),
  // Pokračování zrušeného nebo spadlého importu novým během (kritérium 35
  // části 6). ON DELETE SET NULL, ne cascade: smazání starého záznamu
  // nesmí vzít s sebou import, který na něj jen navazuje.
  resumeFromImportId: uuid().references((): AnyPgColumn => imports.id,
    { onDelete: 'set null' }),
  errorSummary: jsonb().notNull().default({}),
  failureCode: text(),
  failureDetail: text(),
  createdBy: uuid(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  // Zapisuje se v KAŽDÉ checkpointové transakci importu. Je to jediný signál
  // živosti, ze kterého obnova po pádu pozná zaseknutý import. Bez něj by
  // zabitý worker import zablokoval navždy.
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  startedAt: timestamp({ withTimezone: true }),
  finishedAt: timestamp({ withTimezone: true }),
  fileExpiresAt: timestamp({ withTimezone: true }).notNull(),
}, (t) => [
  check('ck_imports__byte_size', sql`${t.byteSize} > 0`),
  check('ck_imports__stored_error_count', sql`${t.storedErrorCount} >= 0`),
  // Import nesmí navazovat sám na sebe. Bez tohohle omezení by obnova
  // uvázla v nekonečné smyčce nad jediným řádkem a vypadalo by to
  // jako zaseknutý worker. Ověřeno spuštěním.
  check('ck_imports__resume_not_self',
    sql`${t.resumeFromImportId} IS DISTINCT FROM ${t.id}`),
  check('ck_imports__status', sql`${t.status} IN
    ('pending','validating','previewing','importing','completed',
     'completed_with_errors','failed','cancelled')`),
  check('ck_imports__encoding_source', sql`${t.encodingSource} IS NULL OR
    ${t.encodingSource} IN ('bom','utf8_validation','score','manual')`),
  check('ck_imports__delimiter', sql`${t.delimiter} IS NULL OR
    ${t.delimiter} IN (';', ',', E'\\t', '|')`),
  uniqueIndex('uq_imports__workspace_idempotency').on(t.workspaceId, t.idempotencyKey),
  index('idx_imports__ws_created').on(t.workspaceId, t.createdAt.desc()),
  index('idx_imports__file_expiry').on(t.fileExpiresAt)
    .where(sql`${t.storageKey} IS NOT NULL`),
  index('idx_imports__stale').on(t.updatedAt).where(sql`${t.status} = 'importing'`),
]);

export const importErrors = pgTable('import_errors', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  importId: uuid().notNull().references(() => imports.id, { onDelete: 'cascade' }),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  rowNumber: bigint({ mode: 'number' }).notNull(),
  severity: text().$type<'error' | 'warning'>().notNull(),
  columnName: text(),
  errorCode: text().notNull(),
  errorDetail: text(),
  rawLine: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('ck_import_errors__severity', sql`${t.severity} IN ('error','warning')`),
  index('idx_import_errors__ws_import_row').on(t.workspaceId, t.importId, t.rowNumber),
]);

export const exports = pgTable('exports', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  kind: text().notNull(),
  filter: jsonb().notNull().default({}),
  columns: jsonb().notNull().default([]),
  format: text().$type<'csv' | 'ndjson'>().notNull().default('csv'),
  encoding: text().notNull().default('utf-8-bom'),
  delimiter: text().notNull().default(';'),
  status: text().notNull(),
  rowCount: bigint({ mode: 'number' }),
  storageKey: text(),
  byteSize: bigint({ mode: 'number' }),
  downloadTokenHash: bytea(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
  failureCode: text(),
  createdBy: uuid(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp({ withTimezone: true }),
}, (t) => [
  check('ck_exports__kind', sql`${t.kind} IN
    ('contacts','suppressions','import_errors','gdpr_subject')`),
  check('ck_exports__format', sql`${t.format} IN ('csv','ndjson')`),
  check('ck_exports__encoding', sql`${t.encoding} IN ('utf-8-bom','utf-8','windows-1250')`),
  check('ck_exports__status', sql`${t.status} IN
    ('queued','running','completed','failed','expired')`),
  index('idx_exports__ws_created').on(t.workspaceId, t.createdAt.desc()),
  uniqueIndex('uq_exports__download_token').on(t.downloadTokenHash)
    .where(sql`${t.downloadTokenHash} IS NOT NULL`),
  index('idx_exports__expiry').on(t.expiresAt).where(sql`${t.status} = 'completed'`),
]);

/**
 * Jediný mechanismus, kterým se fronta ke kontrole vokativu časem vyprázdní
 * místo toho, aby při každém importu narostla znovu.
 */
export const nameOverrides = pgTable('name_overrides', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  kind: text().$type<'first' | 'last'>().notNull(),
  nameKey: text().notNull(),  // lower + NFD + odstraněné diakritické znaky
  gender: text().$type<'female' | 'male' | 'unknown'>(),
  vocative: text(),
  note: text(),
  createdBy: uuid(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('ck_name_overrides__kind', sql`${t.kind} IN ('first','last')`),
  check('ck_name_overrides__gender', sql`${t.gender} IS NULL OR
    ${t.gender} IN ('female','male','unknown')`),
  check('ck_name_overrides__has_value',
    sql`${t.gender} IS NOT NULL OR ${t.vocative} IS NOT NULL`),
  // Vyhledání při každém zápisu kontaktu, musí být O(1).
  uniqueIndex('uq_name_overrides__ws_kind_key').on(t.workspaceId, t.kind, t.nameKey),
]);

export const segments = pgTable('segments', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  description: text(),
  kind: text().$type<'dynamic' | 'static'>().notNull().default('dynamic'),
  presetKey: text(),
  definition: jsonb().notNull(),
  definitionHash: bytea().notNull(),  // SHA-256 kanonického JSON, detekce změny
  astVersion: smallint().notNull().default(1),
  cachedCount: bigint({ mode: 'number' }),
  cachedIsExact: boolean(),
  cachedAt: timestamp({ withTimezone: true }),
  cachedDurationMs: integer(),
  recomputeState: text().$type<'idle' | 'queued' | 'running' | 'error'>()
    .notNull().default('idle'),
  lastErrorCode: text(),
  createdBy: uuid(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp({ withTimezone: true }),
}, (t) => [
  check('ck_segments__name_len', sql`char_length(${t.name}) BETWEEN 1 AND 120`),
  check('ck_segments__kind', sql`${t.kind} IN ('dynamic','static')`),
  check('ck_segments__recompute_state',
    sql`${t.recomputeState} IN ('idle','queued','running','error')`),
  uniqueIndex('uq_segments__workspace_name').on(t.workspaceId, sql`lower(${t.name})`)
    .where(sql`${t.deletedAt} IS NULL`),
  // Plánovač přepočtu bere segmenty s nejstarším cached_at.
  // NULLS FIRST kvůli nově vytvořeným, které cached_at ještě nemají.
  index('idx_segments__stale').on(t.cachedAt.nullsFirst())
    .where(sql`${t.deletedAt} IS NULL AND ${t.kind} = 'dynamic'`),
]);

export const segmentMembers = pgTable('segment_members', {
  segmentId: uuid().notNull().references(() => segments.id, { onDelete: 'cascade' }),
  contactId: uuid().notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  addedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ name: 'pk_segment_members', columns: [t.segmentId, t.contactId] }),
  // "Ve kterých segmentech kontakt je" z detailu kontaktu, a zároveň jediný
  // použitelný index pro kaskádu z workspaces.
  index('idx_segment_members__ws_contact').on(t.workspaceId, t.contactId, t.segmentId),
]);

export const forms = pgTable('forms', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  slug: text().notNull(),
  fields: jsonb().notNull().default([]),
  design: jsonb().notNull().default({}),
  customCss: text(),
  listIds: uuid().array().notNull().default([]),
  tagIds: uuid().array().notNull().default([]),
  doubleOptIn: boolean().notNull().default(true),
  consentText: text(),
  consentRequired: boolean().notNull().default(true),
  legalBasis: text().notNull().default('consent'),
  honeypotField: text().notNull().default('website'),
  minFillSeconds: smallint().notNull().default(2),
  allowedOrigins: text().array().notNull().default([]),
  captchaProvider: text(),
  captchaConfig: jsonb(),
  redirectUrl: text(),
  successMessage: jsonb().notNull().default({}),
  active: boolean().notNull().default(true),
  submissionCount: bigint({ mode: 'number' }).notNull().default(0),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Neuhodnutelný slug: veřejný endpoint /f/{slug} hledá bez znalosti projektu.
  check('ck_forms__slug', sql`${t.slug} ~ '^[a-z0-9]{16,32}$'`),
  check('ck_forms__custom_css_len',
    sql`${t.customCss} IS NULL OR char_length(${t.customCss}) <= 20000`),
  check('ck_forms__min_fill_seconds', sql`${t.minFillSeconds} BETWEEN 0 AND 60`),
  check('ck_forms__captcha_provider', sql`${t.captchaProvider} IS NULL OR
    ${t.captchaProvider} IN ('none','turnstile','hcaptcha')`),
  uniqueIndex('uq_forms__slug').on(t.slug),
  index('idx_forms__ws_created').on(t.workspaceId, t.createdAt.desc()),
]);

export const formSubmissions = pgTable('form_submissions', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  formId: uuid().notNull().references(() => forms.id, { onDelete: 'cascade' }),
  contactId: uuid().references(() => contacts.id, { onDelete: 'set null' }),
  status: text().$type<'accepted' | 'rejected' | 'dropped'>().notNull(),
  errorCode: text(),
  payload: jsonb().notNull().default({}),
  pageUrl: text(),
  ip: inet(),
  userAgent: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('ck_form_submissions__status', sql`${t.status} IN ('accepted','rejected','dropped')`),
  index('idx_form_submissions__form_created').on(t.formId, t.createdAt.desc()),
  index('idx_form_submissions__ws_created').on(t.workspaceId, t.createdAt),
]);

export const inboundEndpoints = pgTable('inbound_endpoints', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  slug: text().notNull(),
  signatureMode: text().notNull().default('hmac_sha256'),
  signatureConfig: jsonb().notNull().default({}),
  // Obálka enc:v1:<base64>, context 'inbound_endpoint'. TEXT, ne bytea:
  // kontrakt 4.10.4 žádá text kvůli dohledatelnosti při rotaci klíčů
  // a stejný tvar mají webhook_endpoints.secret_encrypted
  // i sending_providers.config_encrypted. Dvě různé signatury pro tutéž
  // obálku znamenají dvě různé cesty k dešifrování.
  secretEncrypted: text(),
  ipAllowlist: inetArray().notNull().default(sql`'{}'::inet[]`),
  mapping: jsonb().notNull().default({}),
  mappingVersion: integer().notNull().default(1),
  active: boolean().notNull().default(true),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('ck_inbound_endpoints__slug', sql`${t.slug} ~ '^[a-z0-9]{24,40}$'`),
  check('ck_inbound_endpoints__signature_mode', sql`${t.signatureMode} IN
    ('none','hmac_sha256','shared_secret','basic')`),
  uniqueIndex('uq_inbound_endpoints__slug').on(t.slug),
  index('idx_inbound_endpoints__ws_created').on(t.workspaceId, t.createdAt),
]);

/**
 * Deduplikace přes hranici měsíce. inbound_deliveries je partitionovaná, takže
 * unikátní index na ní musí obsahovat partiční klíč a přes měsíc nefunguje.
 */
export const inboundDedup = pgTable('inbound_dedup', {
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  endpointId: uuid().notNull().references(() => inboundEndpoints.id, { onDelete: 'cascade' }),
  externalId: text().notNull(),
  deliveryId: uuid().notNull(),
  // Druhá složka klíče inbound_deliveries. Bez ní projde dohledání doručení
  // podle deliveryId všemi oddíly; je to tentýž vzor jako message_created_at
  // a hlídá ho registr PARTITIONED_REFERENCES, ne jmenovitý test.
  deliveryCreatedAt: timestamp({ withTimezone: true }).notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // workspace_id v čele PK: endpointId sice projekt jednoznačně určuje,
  // ale politika RLS se pak vyhodnocuje nad indexovaným sloupcem a upsert
  // z jobu nemůže omylem trefit cizí projekt. Unikátnost se tím nemění.
  primaryKey({
    name: 'pk_inbound_dedup',
    columns: [t.workspaceId, t.endpointId, t.externalId],
  }),
  index('idx_inbound_dedup__created').on(t.createdAt),
]);

export const gdprRequests = pgTable('gdpr_requests', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  contactId: uuid().references(() => contacts.id, { onDelete: 'set null' }),
  // Plaintext se tady NIKDY neukládá. Otisk se počítá stejným receptem jako
  // suppressions.fingerprint a stejně jako tam se ukládá s pokolením klíče.
  subjectEmailFingerprint: bytea().notNull(),
  subjectEmailFingerprintKeyId: smallint().notNull(),
  type: text().notNull(),
  mode: text(),  // jen u type='erasure'
  status: text().notNull(),
  channel: text().notNull(),
  requestedAt: timestamp({ withTimezone: true }).notNull(),
  dueAt: timestamp({ withTimezone: true }).notNull(),   // requested_at + 1 měsíc, čl. 12 odst. 3
  extendedUntil: timestamp({ withTimezone: true }),
  extensionReason: text(),
  verifiedAt: timestamp({ withTimezone: true }),
  completedAt: timestamp({ withTimezone: true }),
  exportId: uuid().references(() => exports.id, { onDelete: 'set null' }),
  affected: jsonb().notNull().default({}),
  rejectionReason: text(),
  requestedBy: text(),
  processedBy: uuid(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('ck_gdpr_requests__type', sql`${t.type} IN
    ('access','portability','erasure','rectification','restriction','objection')`),
  check('ck_gdpr_requests__mode', sql`${t.mode} IS NULL OR ${t.mode} IN ('anonymize','purge')`),
  check('ck_gdpr_requests__status', sql`${t.status} IN
    ('received','verifying','processing','completed','rejected','failed')`),
  check('ck_gdpr_requests__channel', sql`${t.channel} IN ('preference_center','admin','api')`),
  // Panel "co je po termínu" je hlavní pohled v téhle tabulce.
  index('idx_gdpr_requests__ws_due').on(t.workspaceId, t.dueAt)
    .where(sql`${t.status} IN ('received','verifying','processing')`),
  index('idx_gdpr_requests__ws_created').on(t.workspaceId, t.createdAt.desc()),
  index('idx_gdpr_requests__ws_fingerprint').on(t.workspaceId, t.subjectEmailFingerprint),
]);

export const retentionPolicies = pgTable('retention_policies', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  target: text().notNull(),
  retainDays: integer().notNull(),
  action: text().$type<'delete' | 'anonymize'>().notNull(),
  enabled: boolean().notNull().default(true),
  lastRunAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('ck_retention_policies__target', sql`${t.target} IN
    ('import_files','import_errors','form_submissions','inbound_deliveries',
     'unconfirmed_subscriptions','inactive_contacts','exports')`),
  check('ck_retention_policies__retain_days', sql`${t.retainDays} BETWEEN 1 AND 3650`),
  check('ck_retention_policies__action', sql`${t.action} IN ('delete','anonymize')`),
  uniqueIndex('uq_retention_policies__workspace_target').on(t.workspaceId, t.target),
]);

export const retentionRuns = pgTable('retention_runs', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  policyId: uuid().references(() => retentionPolicies.id, { onDelete: 'set null' }),
  target: text().notNull(),
  startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp({ withTimezone: true }),
  scanned: bigint({ mode: 'number' }).notNull().default(0),
  affected: bigint({ mode: 'number' }).notNull().default(0),
  status: text().notNull(),
  errorDetail: text(),
}, (t) => [
  check('ck_retention_runs__status', sql`${t.status} IN
    ('running','completed','partial','failed')`),
  index('idx_retention_runs__ws_started').on(t.workspaceId, t.startedAt.desc()),
]);

export type Contact = typeof contacts.$inferSelect;
export type ContactInsert = typeof contacts.$inferInsert;
export type ContactField = typeof contactFields.$inferSelect;
export type ContactFieldInsert = typeof contactFields.$inferInsert;
export type Tag = typeof tags.$inferSelect;
export type TagInsert = typeof tags.$inferInsert;
export type ContactTag = typeof contactTags.$inferSelect;
export type ContactTagInsert = typeof contactTags.$inferInsert;
export type List = typeof lists.$inferSelect;
export type ListInsert = typeof lists.$inferInsert;
export type ListSubscription = typeof listSubscriptions.$inferSelect;
export type ListSubscriptionInsert = typeof listSubscriptions.$inferInsert;
export type SubscriptionConfirmation = typeof subscriptionConfirmations.$inferSelect;
export type SubscriptionConfirmationInsert = typeof subscriptionConfirmations.$inferInsert;
export type Consent = typeof consents.$inferSelect;
export type ConsentInsert = typeof consents.$inferInsert;
export type ContactConsentState = typeof contactConsentState.$inferSelect;
export type ContactConsentStateInsert = typeof contactConsentState.$inferInsert;
export type Suppression = typeof suppressions.$inferSelect;
export type SuppressionInsert = typeof suppressions.$inferInsert;
export type Import = typeof imports.$inferSelect;
export type ImportInsert = typeof imports.$inferInsert;
export type ImportError = typeof importErrors.$inferSelect;
export type ImportErrorInsert = typeof importErrors.$inferInsert;
export type Export = typeof exports.$inferSelect;
export type ExportInsert = typeof exports.$inferInsert;
export type NameOverride = typeof nameOverrides.$inferSelect;
export type NameOverrideInsert = typeof nameOverrides.$inferInsert;
export type Segment = typeof segments.$inferSelect;
export type SegmentInsert = typeof segments.$inferInsert;
export type SegmentMember = typeof segmentMembers.$inferSelect;
export type SegmentMemberInsert = typeof segmentMembers.$inferInsert;
export type Form = typeof forms.$inferSelect;
export type FormInsert = typeof forms.$inferInsert;
export type FormSubmission = typeof formSubmissions.$inferSelect;
export type FormSubmissionInsert = typeof formSubmissions.$inferInsert;
export type InboundEndpoint = typeof inboundEndpoints.$inferSelect;
export type InboundEndpointInsert = typeof inboundEndpoints.$inferInsert;
export type InboundDedup = typeof inboundDedup.$inferSelect;
export type InboundDedupInsert = typeof inboundDedup.$inferInsert;
export type GdprRequest = typeof gdprRequests.$inferSelect;
export type GdprRequestInsert = typeof gdprRequests.$inferInsert;
export type RetentionPolicy = typeof retentionPolicies.$inferSelect;
export type RetentionPolicyInsert = typeof retentionPolicies.$inferInsert;
export type RetentionRun = typeof retentionRuns.$inferSelect;
export type RetentionRunInsert = typeof retentionRuns.$inferInsert;
```

- [ ] **Step 4: Ověř typovou kontrolu**

Run: `pnpm --filter @mlain/db typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/schema/contacts.ts
git commit -m "feat(db): contacts schema, 23 tables including consents and suppressions"
```

---

### Task 9: Schéma obsahu (12 tabulek)

**Files:**
- Create: `packages/db/src/schema/content.ts`

Tabulky: `assets`, `asset_variants`, `asset_references`, `templates`, `template_versions`, `brand_profiles`, `brand_extractions`, `ai_provider_credentials`, `ai_conversations`, `ai_messages`, `ai_usage_daily`, `content_snippets`.

Pořadí je závazné: `assets` musí vzniknout před `templates`, protože `templates.thumbnail_asset_id` na ně míří. Cyklus `templates` a `template_versions` se v tomhle souboru **nezakládá**, doplňuje ho migrace 0002.

- [ ] **Step 1: Napiš `schema/content.ts`**

```ts
// packages/db/src/schema/content.ts
import { sql } from 'drizzle-orm';
import {
  bigint, boolean, check, date, index, integer, jsonb, pgTable, primaryKey,
  text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import { bytea } from './_types.js';
import { users, workspaces } from './identity.js';

export const assets = pgTable('assets', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  publicId: text().notNull(),
  sha256: bytea().notNull(),
  byteSize: bigint({ mode: 'number' }).notNull(),
  mimeType: text().notNull(),
  width: integer(),
  height: integer(),
  frameCount: integer().notNull().default(1), // > 1 znamená animovaný GIF
  originalFilename: text().notNull(),
  altText: text(),
  source: text().notNull().default('upload'),
  storageKey: text().notNull(),
  // Denormalizace asset_references. Aktualizuje ji repository vrstva ve stejné
  // transakci jako zápis do asset_references, NE trigger: konvence triggery
  // zakazuje jako neviditelnou magii, kterou Go strana nezná.
  referenceCount: integer().notNull().default(0),
  hiddenAt: timestamp({ withTimezone: true }),  // skryto z knihovny, soubor zůstává
  purgedAt: timestamp({ withTimezone: true }),  // soubor smazán, jen při reference_count = 0
  createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('ck_assets__public_id', sql`${t.publicId} ~ '^[0-9A-Za-z]{22}$'`),
  check('ck_assets__sha256_len', sql`octet_length(${t.sha256}) = 32`),
  check('ck_assets__byte_size', sql`${t.byteSize} > 0`),
  check('ck_assets__source', sql`${t.source} IN ('upload','brand_extraction','seed','ai')`),
  check('ck_assets__reference_count', sql`${t.referenceCount} >= 0`),
  // Deduplikace: stejný soubor nahraný podruhé se neuloží dvakrát.
  uniqueIndex('uq_assets__workspace_sha256').on(t.workspaceId, t.sha256)
    .where(sql`${t.purgedAt} IS NULL`),
  // Veřejná URL obsahuje jen public_id, musí být globálně jednoznačné.
  uniqueIndex('uq_assets__public_id').on(t.publicId),
  index('idx_assets__workspace_created').on(t.workspaceId, t.createdAt.desc())
    .where(sql`${t.hiddenAt} IS NULL AND ${t.purgedAt} IS NULL`),
]);

/**
 * Výčty variant a druhů odkazu NEJSOU v databázi uzavřené schválně. Databáze
 * hlídá jen tvar identifikátoru, platný výčet vlastní registr v aplikaci.
 * Uzavřený CHECK by z přidání varianty udělal ALTER TABLE ... DROP CONSTRAINT
 * u každé instalace, a to je u self-hosted nasazení nejrizikovější operace.
 */
export const assetVariants = pgTable('asset_variants', {
  // Rozhodnutí R26: workspace_id je denormalizované z assets, aby na tabulku
  // platila běžná ws_isolation. Nese úložné klíče, tedy data, u kterých únik
  // mezi projekty smysl dává; jednovrstvá ochrana přes repository je proti
  // zbytku modelu výjimka bez důvodu.
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  assetId: uuid().notNull().references(() => assets.id, { onDelete: 'cascade' }),
  variant: text().notNull(),
  width: integer().notNull(),
  height: integer().notNull(),
  byteSize: bigint({ mode: 'number' }).notNull(),
  mimeType: text().notNull(),
  storageKey: text().notNull(),
}, (t) => [
  primaryKey({ name: 'pk_asset_variants', columns: [t.workspaceId, t.assetId, t.variant] }),
  check('ck_asset_variants__variant', sql`${t.variant} ~ '^[a-z][a-z0-9_]{0,15}$'`),
]);

export const assetReferences = pgTable('asset_references', {
  // Rozhodnutí R26. Referenční graf říká, který asset je kde použitý,
  // tedy prozrazuje strukturu cizího projektu.
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  assetId: uuid().notNull().references(() => assets.id, { onDelete: 'cascade' }),
  refType: text().notNull(),
  refId: uuid().notNull(),
}, (t) => [
  primaryKey({
    name: 'pk_asset_references',
    columns: [t.workspaceId, t.assetId, t.refType, t.refId],
  }),
  check('ck_asset_references__ref_type', sql`${t.refType} ~ '^[a-z][a-z0-9_]{0,31}$'`),
  index('idx_asset_references__ref').on(t.workspaceId, t.refType, t.refId),
]);

export const templates = pgTable('templates', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  kind: text().$type<'campaign' | 'transactional' | 'system'>().notNull().default('campaign'),
  schemaVersion: integer().notNull().default(1),
  design: jsonb().notNull(),
  // SHA-256 nad KANONICKOU serializací JSON (klíče lexikograficky, bez mezer,
  // UTF-8). Autosave neukládá, když se nic nezměnilo; "vytvořit verzi" nevyrobí
  // duplicitu; náhled se cachuje podle hashe.
  designHash: bytea().notNull(),
  // Cizí klíč doplňuje migrace 0002, tady by tvořil cyklus.
  currentVersionId: uuid(),
  usedFields: text().array().notNull().default([]),
  thumbnailAssetId: uuid().references(() => assets.id, { onDelete: 'set null' }),
  starter: boolean().notNull().default(false),
  validationState: text().$type<'unknown' | 'valid' | 'invalid'>().notNull().default('unknown'),
  validationErrors: jsonb().notNull().default([]),
  deletedAt: timestamp({ withTimezone: true }),
  createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('ck_templates__name_len', sql`length(${t.name}) BETWEEN 1 AND 120`),
  // Druh 'snippet' je zrušený: sdílené bloky mají jedno místo, content_snippets.
  check('ck_templates__kind', sql`${t.kind} IN ('campaign','transactional','system')`),
  check('ck_templates__validation_state',
    sql`${t.validationState} IN ('unknown','valid','invalid')`),
  index('idx_templates__workspace_updated').on(t.workspaceId, t.updatedAt.desc())
    .where(sql`${t.deletedAt} IS NULL`),
  uniqueIndex('uq_templates__workspace_name').on(t.workspaceId, sql`lower(${t.name})`)
    .where(sql`${t.deletedAt} IS NULL`),
  index('idx_templates__invalid').on(t.workspaceId)
    .where(sql`${t.validationState} = 'invalid' AND ${t.deletedAt} IS NULL`),
  // Vyhledání šablon podle merge tagu. Bez indexu by to byl sekvenční průchod
  // s deserializací JSON u každé šablony.
  index('idx_templates__used_fields').using('gin', t.usedFields),
]);

export const templateVersions = pgTable('template_versions', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  templateId: uuid().notNull().references(() => templates.id, { onDelete: 'cascade' }),
  version: integer().notNull(),
  schemaVersion: integer().notNull(),
  design: jsonb().notNull(),
  designHash: bytea().notNull(),
  compiledHtml: text(),
  compiledText: text(),
  compileMeta: jsonb(),
  rendererVersion: text(),  // např. "r1.4.0", nutné pro reprodukovatelnost
  label: text(),
  reason: text().notNull().default('manual'),
  // Verze použitá kampaní. Nikdy se nemaže, je to důkaz, co přesně se rozeslalo.
  pinned: boolean().notNull().default(false),
  createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('ck_template_versions__version', sql`${t.version} >= 1`),
  check('ck_template_versions__label_len',
    sql`${t.label} IS NULL OR length(${t.label}) <= 80`),
  check('ck_template_versions__reason', sql`${t.reason} IN
    ('manual','pre_send','ai_apply','restore','import')`),
  uniqueIndex('uq_template_versions__template_version').on(t.templateId, t.version),
  index('idx_template_versions__template_created').on(t.templateId, t.createdAt.desc()),
  index('idx_template_versions__cleanup').on(t.workspaceId, t.createdAt)
    .where(sql`${t.pinned} = false`),
]);

export const brandProfiles = pgTable('brand_profiles', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  sourceUrl: text(),
  logoAssetId: uuid().references(() => assets.id, { onDelete: 'set null' }),
  logoDarkAssetId: uuid().references(() => assets.id, { onDelete: 'set null' }),
  palette: jsonb().notNull(),
  typography: jsonb().notNull(),
  tone: jsonb().notNull().default({}),
  // Bez prefixu is_, protože `default` je klíčové slovo.
  defaultProfile: boolean().notNull().default(false),
  extractedAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Právě jedna výchozí značka na projekt. Částečný unikátní index to vynutí
  // v databázi, ne v aplikaci: souběžné "nastav jako výchozí" jinak vyrobí dvě.
  uniqueIndex('uq_brand_profiles__workspace_default').on(t.workspaceId)
    .where(sql`${t.defaultProfile}`),
]);

export const brandExtractions = pgTable('brand_extractions', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  requestedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  inputUrl: text().notNull(),
  normalizedUrl: text().notNull(),
  status: text().notNull().default('pending'),
  errorCode: text(),
  hopSummary: jsonb().notNull().default([]),  // bez syrových IP adres
  bytesFetched: bigint({ mode: 'number' }).notNull().default(0),
  durationMs: integer(),
  result: jsonb(),
  brandProfileId: uuid().references(() => brandProfiles.id, { onDelete: 'set null' }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp({ withTimezone: true }),
}, (t) => [
  check('ck_brand_extractions__status', sql`${t.status} IN
    ('pending','running','succeeded','failed','blocked')`),
  // Rate limit "10 extrakcí za hodinu na projekt" se počítá tímhle indexem.
  index('idx_brand_extractions__workspace_created').on(t.workspaceId, t.createdAt.desc()),
]);

/**
 * Výčet provider NENÍ v databázi uzavřený a je to podstatné: Azure OpenAI
 * a AWS Bedrock jsou připravené hodnoty bez implementace a jejich přidání
 * by jinak bylo ALTER TABLE ... DROP CONSTRAINT u každé instalace.
 */
export const aiProviderCredentials = pgTable('ai_provider_credentials', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  provider: text().notNull(),
  label: text().notNull(),
  // Obálka enc:v1:<base64>, context 'ai_provider'. TEXT, ne bytea, viz 4.10.4.
  apiKeyEncrypted: text().notNull(),
  keyFingerprint: text().notNull(),    // sha256(api_key), prvních 16 hex znaků
  keyHint: text().notNull(),           // poslední 4 znaky klíče, pro UI
  baseUrl: text(),
  defaultModel: text().notNull(),
  defaultCredential: boolean().notNull().default(false),
  lastUsedAt: timestamp({ withTimezone: true }),
  lastErrorAt: timestamp({ withTimezone: true }),
  lastErrorCode: text(),
  createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('ck_ai_provider_credentials__provider', sql`${t.provider} ~ '^[a-z][a-z0-9_]{0,31}$'`),
  check('ck_ai_provider_credentials__label_len', sql`length(${t.label}) BETWEEN 1 AND 60`),
  uniqueIndex('uq_ai_provider_credentials__workspace_label')
    .on(t.workspaceId, sql`lower(${t.label})`),
  uniqueIndex('uq_ai_provider_credentials__workspace_default').on(t.workspaceId)
    .where(sql`${t.defaultCredential}`),
]);

export const aiConversations = pgTable('ai_conversations', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  templateId: uuid().references(() => templates.id, { onDelete: 'cascade' }),
  // Bez cizího klíče: campaigns vzniká v jiném souboru schématu a odkaz
  // přes hranici domény by tvořil cyklus mezi soubory.
  campaignId: uuid(),
  title: text(),
  credentialId: uuid().references(() => aiProviderCredentials.id, { onDelete: 'set null' }),
  model: text().notNull(),
  createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('idx_ai_conversations__template_created').on(t.templateId, t.createdAt.desc()),
  // Seznam konverzací projektu podle poslední aktivity, a zároveň jediný
  // použitelný index pro kaskádu z workspaces.
  index('idx_ai_conversations__ws_updated').on(t.workspaceId, t.updatedAt.desc()),
]);

export const aiMessages = pgTable('ai_messages', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  conversationId: uuid().notNull().references(() => aiConversations.id, { onDelete: 'cascade' }),
  seq: integer().notNull(),
  role: text().$type<'system' | 'user' | 'assistant' | 'tool'>().notNull(),
  parts: jsonb().notNull(),
  inputTokens: integer(),
  outputTokens: integer(),
  finishReason: text(),
  errorCode: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('ck_ai_messages__role', sql`${t.role} IN ('system','user','assistant','tool')`),
  // Konverzace se vždy čte celá a v pořadí. Tohle je jediný přístupový vzor.
  // workspace_id v čele: conversationId projekt jednoznačně určuje, takže se
  // unikátnost nemění, ale kaskádové mazání projektu i RLS dostanou index.
  uniqueIndex('uq_ai_messages__ws_conversation_seq').on(t.workspaceId, t.conversationId, t.seq),
]);

/**
 * Agregát zapisovaný přes INSERT ... ON CONFLICT DO UPDATE. Existuje proto,
 * aby "kolik mě to stálo za posledních 30 dní" byl dotaz na 30 řádků,
 * ne na 30 000 zpráv.
 */
export const aiUsageDaily = pgTable('ai_usage_daily', {
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  day: date().notNull(),
  provider: text().notNull(),
  model: text().notNull(),
  requests: integer().notNull().default(0),
  inputTokens: bigint({ mode: 'number' }).notNull().default(0),
  outputTokens: bigint({ mode: 'number' }).notNull().default(0),
  errors: integer().notNull().default(0),
}, (t) => [
  primaryKey({
    name: 'pk_ai_usage_daily',
    columns: [t.workspaceId, t.day, t.provider, t.model],
  }),
]);

/** MVP 2. V MVP 0 se tabulka založí, ale UI ji nepoužívá, aby se pak nemuselo
 *  migrovat `design`. */
export const contentSnippets = pgTable('content_snippets', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  design: jsonb().notNull(),  // pole bloků, ne celý dokument
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('uq_content_snippets__workspace_name').on(t.workspaceId, sql`lower(${t.name})`),
]);

export type Asset = typeof assets.$inferSelect;
export type AssetInsert = typeof assets.$inferInsert;
export type AssetVariant = typeof assetVariants.$inferSelect;
export type AssetVariantInsert = typeof assetVariants.$inferInsert;
export type AssetReference = typeof assetReferences.$inferSelect;
export type AssetReferenceInsert = typeof assetReferences.$inferInsert;
export type Template = typeof templates.$inferSelect;
export type TemplateInsert = typeof templates.$inferInsert;
export type TemplateVersion = typeof templateVersions.$inferSelect;
export type TemplateVersionInsert = typeof templateVersions.$inferInsert;
export type BrandProfile = typeof brandProfiles.$inferSelect;
export type BrandProfileInsert = typeof brandProfiles.$inferInsert;
export type BrandExtraction = typeof brandExtractions.$inferSelect;
export type BrandExtractionInsert = typeof brandExtractions.$inferInsert;
export type AiProviderCredential = typeof aiProviderCredentials.$inferSelect;
export type AiProviderCredentialInsert = typeof aiProviderCredentials.$inferInsert;
export type AiConversation = typeof aiConversations.$inferSelect;
export type AiConversationInsert = typeof aiConversations.$inferInsert;
export type AiMessage = typeof aiMessages.$inferSelect;
export type AiMessageInsert = typeof aiMessages.$inferInsert;
export type AiUsageDaily = typeof aiUsageDaily.$inferSelect;
export type AiUsageDailyInsert = typeof aiUsageDaily.$inferInsert;
export type ContentSnippet = typeof contentSnippets.$inferSelect;
export type ContentSnippetInsert = typeof contentSnippets.$inferInsert;
```

- [ ] **Step 2: Ověř typovou kontrolu**

Run: `pnpm --filter @mlain/db typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/schema/content.ts
git commit -m "feat(db): content schema, templates, assets, brand and AI"
```

---

### Task 10: Schéma kampaní (8 tabulek)

**Files:**
- Create: `packages/db/src/schema/campaigns.ts`

Tabulky: `sending_providers`, `sender_domains`, `campaigns`, `campaign_content_variants`, `campaign_links`, `deliverability_snapshots`, `campaign_audience_progress`, `campaign_render_warnings`. Partitionované `messages`, `message_events` a `provider_event_receipts` jsou v úkolu 12.

Dvě věci, které se nesmí zjednodušit:

1. **`campaigns.pause_reason` je `jsonb`, ne `text`.** Zapisuje do něj i sender a potřebuje vedle kódu předat i zdroj, čas a svoje ID. Je to kontraktní sloupec: bez něj sender pozastavení kampaně fyzicky neprovede a neplatí ani circuit breaker, ani pravidlo o 5 % selhání renderu.
2. **`campaign_links` nesmí být partitionovaná.** Redirect ji čte podle primárního klíče v horké cestě a `campaign_links.id` musí být stabilní od kompilace do konce života kampaně; změna po odeslání by přesměrovala staré odkazy na jiné cíle.

- [ ] **Step 1: Napiš `schema/campaigns.ts`**

```ts
// packages/db/src/schema/campaigns.ts
import { sql } from 'drizzle-orm';
import {
  bigint, boolean, check, date, index, integer, jsonb, numeric, pgTable,
  primaryKey, smallint, text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import { users, workspaces } from './identity.js';
import { lists } from './contacts.js';
import { templates } from './content.js';

export const sendingProviders = pgTable('sending_providers', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  // Uzavřený výčet schválně, ale ne navždy: MVP 2 slibuje pluginové providery
  // a rozšíření je jednořádková migrace. Aplikační kód s vyčerpaností výčtu
  // počítat nesmí.
  type: text().$type<'ses' | 'smtp'>().notNull(),
  // enc:v1:<base64>, context 'sending_provider', workspace_id v AAD.
  // Šifrovaný obsah je KOMPLETNÍ konfigurace, ne jen tajemství: sender by ji
  // jinak skládal ze dvou zdrojů a hrozilo by, že se rozejdou.
  configEncrypted: text().notNull(),
  configPublic: jsonb().notNull().default({}),  // odvozená necitlivá kopie pro UI
  isDefault: boolean().notNull().default(false),
  status: text().notNull().default('unverified'),
  statusDetail: jsonb(),
  verifiedAt: timestamp({ withTimezone: true }),
  // Zrcadlo stavu účtu, plní job provider.refresh_quota. Pro SES je
  // quota_max_send_rate ZÁVAZNÝM zdrojem rychlosti, obálku sender použije,
  // jen když je sloupec NULL. Kvůli tomu, aby se rate měnil bez přešifrovávání.
  quotaMax24h: integer(),
  quotaMaxSendRate: numeric({ precision: 10, scale: 2 }),
  quotaSent24h: integer(),
  productionAccess: boolean(),
  enforcementStatus: text(),  // HEALTHY | PROBATION | SHUTDOWN
  sendingEnabled: boolean(),
  quotaCheckedAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('ck_sending_providers__type', sql`${t.type} IN ('ses','smtp')`),
  check('ck_sending_providers__status', sql`${t.status} IN
    ('unverified','verifying','ready','degraded','blocked','disabled')`),
  // Právě jeden výchozí provider na projekt. Částečný unikátní index je levnější
  // než trigger a na rozdíl od aplikační kontroly nejde obejít souběhem.
  uniqueIndex('uq_sending_providers__one_default').on(t.workspaceId)
    .where(sql`${t.isDefault}`),
  index('idx_sending_providers__workspace').on(t.workspaceId, t.createdAt.desc()),
  index('idx_sending_providers__quota_stale').on(t.quotaCheckedAt.nullsFirst())
    .where(sql`${t.status} IN ('ready','degraded')`),
]);

export const senderDomains = pgTable('sender_domains', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  providerId: uuid().notNull().references(() => sendingProviders.id, { onDelete: 'cascade' }),
  domain: text().notNull(),  // lowercase, bez trailing tečky, bez "www."
  dkimTokens: text().array().notNull().default([]),
  dkimHostedZone: text(),
  dkimKeyLength: text().notNull().default('RSA_2048_BIT'),
  dkimStatus: text().notNull().default('not_started'),
  mailFromSubdomain: text(),
  mailFromStatus: text().notNull().default('not_configured'),
  spfOk: boolean(),
  dkimOk: boolean(),
  dmarcOk: boolean(),
  mxOk: boolean(),
  checks: jsonb().notNull().default({}),
  checkedAt: timestamp({ withTimezone: true }),
  nextCheckAt: timestamp({ withTimezone: true }),
  sesVerificationStatus: text(),
  verifiedAt: timestamp({ withTimezone: true }),
  // Delegace nastavení DNS na někoho, kdo do nástroje přístup nemá (část 6,
  // bod 8.2.5). Ukládá se HASH tokenu, nikdy token sám: odkaz se posílá
  // e-mailem a v databázi po něm nesmí zůstat použitelná kopie.
  delegationTokenHash: text(),
  delegationExpiresAt: timestamp({ withTimezone: true }),
  delegationCreatedBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('ck_sender_domains__dkim_status', sql`${t.dkimStatus} IN
    ('not_started','pending','success','failed','temporary_failure')`),
  // Hash a jeho platnost drží nebo padají spolu. Token bez konce platnosti
  // by byl trvalý přístupový odkaz do nastavení domény. Ověřeno spuštěním.
  check('ck_sender_domains__delegation', sql`
    (${t.delegationTokenHash} IS NULL AND ${t.delegationExpiresAt} IS NULL) OR
    (${t.delegationTokenHash} IS NOT NULL AND ${t.delegationExpiresAt} IS NOT NULL)`),
  check('ck_sender_domains__mail_from_status', sql`${t.mailFromStatus} IN
    ('not_configured','pending','success','failed')`),
  uniqueIndex('uq_sender_domains__workspace_domain')
    .on(t.workspaceId, sql`lower(${t.domain})`),
  index('idx_sender_domains__next_check').on(t.nextCheckAt)
    .where(sql`${t.nextCheckAt} IS NOT NULL`),
  // Ověření delegačního odkazu: jediný lookup podle hashe. Index je ČÁSTEČNÝ,
  // jinak by unikátnost platila i pro NULL a druhá doména bez delegace by
  // se nedala založit. Ověřeno spuštěním: dva řádky bez tokenu projdou,
  // dva se stejným tokenem skončí chybou 23505.
  uniqueIndex('uq_sender_domains__delegation_token').on(t.delegationTokenHash)
    .where(sql`${t.delegationTokenHash} IS NOT NULL`),
]);

export const campaigns = pgTable('campaigns', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  name: text().notNull(),
  status: text().notNull().default('draft'),
  subject: text().notNull().default(''),
  preheader: text().notNull().default(''),
  fromName: text().notNull().default(''),
  fromEmail: text().notNull().default(''),  // normalizováno na lowercase při zápisu
  replyTo: text(),
  templateId: uuid().references(() => templates.id, { onDelete: 'set null' }),
  design: jsonb(),
  compiledHtml: text(),
  compiledText: text(),
  compiledAt: timestamp({ withTimezone: true }),
  compiledFields: text().array().notNull().default([]),
  compiledHash: text(),
  audience: jsonb().notNull().default(
    { include: { lists: [], segments: [] }, exclude: { lists: [], segments: [] } }),
  audienceSize: integer(),
  // Rozpad publika na složky (kolik z kterého seznamu a segmentu, kolik ubral
  // který filtr). Kontrolní seznam před odesláním, potvrzovací dialog i report
  // mají ukazovat TOTOŽNÉ číslo z jednoho zdroje; bez uloženého rozpadu si ho
  // každá ze tří cest počítá znovu a v okamžiku, kdy se publikum mezitím
  // změní, ukáže každá jiné. Zmrazuje se spolu s audience_built_at.
  audienceBreakdown: jsonb(),
  // Okamžik zmrazení publika. Je zároveň created_at VŠECH zpráv kampaně,
  // viz invariant I1. Ukládá se zaokrouhlené na celé sekundy.
  audienceBuiltAt: timestamp({ withTimezone: true }),
  providerId: uuid().references(() => sendingProviders.id, { onDelete: 'restrict' }),
  senderDomainId: uuid().references(() => senderDomains.id, { onDelete: 'restrict' }),
  trackOpens: boolean().notNull().default(true),
  trackClicks: boolean().notNull().default(true),
  unsubscribeListId: uuid().references(() => lists.id, { onDelete: 'set null' }),
  revision: integer().notNull().default(1),  // klíč cache senderu
  releaseAt: timestamp({ withTimezone: true }),  // undo okno
  scheduledAt: timestamp({ withTimezone: true }),
  scheduleTimezone: text(),  // IANA, např. 'Europe/Prague'
  totalCount: integer().notNull().default(0),
  sentCount: integer().notNull().default(0),
  failedCount: integer().notNull().default(0),
  skippedCount: integer().notNull().default(0),
  bounceCount: integer().notNull().default(0),
  complaintCount: integer().notNull().default(0),
  deliveredCount: integer().notNull().default(0),
  startedAt: timestamp({ withTimezone: true }),
  finishedAt: timestamp({ withTimezone: true }),
  pausedAt: timestamp({ withTimezone: true }),
  // KONTRAKTNÍ SLOUPEC (část 1, 4.10.1). Typ je jsonb, ne text, protože do něj
  // zapisuje i sender a potřebuje vedle kódu předat zdroj, čas a svoje ID.
  // Sender na něj má sloupcový GRANT UPDATE (status, pause_reason).
  pauseReason: jsonb(),
  cancelReason: text(),
  lastError: jsonb(),
  createdBy: uuid().references(() => users.id, { onDelete: 'set null' }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp({ withTimezone: true }),
}, (t) => [
  check('ck_campaigns__status', sql`${t.status} IN (
    'draft','scheduled','queueing','sending','paused',
    'sent','partially_sent','cancelled','failed','schedule_missed')`),
  check('ck_campaigns__schedule', sql`(${t.status} <> 'scheduled') OR
    (${t.scheduledAt} IS NOT NULL AND ${t.scheduleTimezone} IS NOT NULL)`),
  index('idx_campaigns__workspace_status')
    .on(t.workspaceId, t.status, t.updatedAt.desc())
    .where(sql`${t.deletedAt} IS NULL`),
  // Plánovač hledá jen kampaně čekající na svůj čas. Částečný index drží
  // skenování v jednotkách řádků.
  index('idx_campaigns__scheduler').on(t.scheduledAt)
    .where(sql`${t.status} = 'scheduled' AND ${t.deletedAt} IS NULL`),
  index('idx_campaigns__running').on(t.workspaceId)
    .where(sql`${t.status} IN ('queueing','sending') AND ${t.deletedAt} IS NULL`),
]);

/** MVP 1. V MVP 0 zůstává prázdná, UI ji nepoužívá. Je tu proto, že přidat
 *  prázdný sloupec dnes stojí jeden ALTER TABLE bez přepisu dat, kdežto za rok
 *  do tabulky s desítkami milionů řádků je to něco jiného. */
export const campaignContentVariants = pgTable('campaign_content_variants', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  campaignId: uuid().notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  label: text().notNull(),  // 'A', 'B', ... pro report
  weight: smallint().notNull().default(1),  // poměr rozdělení publika
  // Přepisy obsahu. NULL znamená "ber hodnotu ze sloupce kampaně".
  subject: text(),
  preheader: text(),
  fromName: text(),
  design: jsonb(),
  compiledHtml: text(),
  compiledText: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // workspace_id v čele: campaignId projekt jednoznačně určuje, unikátnost
  // se nemění, ale kaskáda z workspaces a RLS dostanou index.
  uniqueIndex('uq_campaign_content_variants__ws_campaign_label')
    .on(t.workspaceId, t.campaignId, t.label),
]);

export const campaignLinks = pgTable('campaign_links', {
  // BEZ .default(): id je UUIDv5 odvozené z kampaně a URL, aby proklik přežil
  // rekompilaci kampaně (rozhodnutí R40). S výchozí hodnotou by první cesta,
  // která řádek vloží bez id, dostala náhodné UUID, odkaz v už odeslaném
  // e-mailu by na něj nenavázal a report odkazů by zůstal PRÁZDNÝ, aniž by
  // cokoli spadlo. Bez DEFAULT skončí takový zápis chybou not-null, tedy
  // hlasitě a v testu. Ověřeno spuštěním.
  id: uuid().primaryKey(),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  campaignId: uuid().notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  url: text().notNull(),      // původní URL, může obsahovat Liquid
  position: integer().notNull(),  // pořadí výskytu v HTML, od 0
  label: text(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Horká cesta prokliku jde přes primární klíč id a ta se nemění. Tenhle
  // index slouží kompilaci šablony, reportu odkazů a kaskádě z workspaces.
  uniqueIndex('uq_campaign_links__ws_campaign_position')
    .on(t.workspaceId, t.campaignId, t.position),
]);

/** Denní zrcadlo doručitelnosti. Bez něj by dashboard počítal agregace
 *  přes message_events při každém načtení. */
export const deliverabilitySnapshots = pgTable('deliverability_snapshots', {
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  providerId: uuid().notNull().references(() => sendingProviders.id, { onDelete: 'cascade' }),
  day: date().notNull(),
  sent: integer().notNull().default(0),
  delivered: integer().notNull().default(0),
  hardBounces: integer().notNull().default(0),
  softBounces: integer().notNull().default(0),
  complaints: integer().notNull().default(0),
  rejects: integer().notNull().default(0),
  deliveryDelays: integer().notNull().default(0),
  computedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({
    name: 'pk_deliverability_snapshots',
    columns: [t.workspaceId, t.providerId, t.day],
  }),
]);

/** Stav materializace, aby šla po restartu workeru bezpečně dokončit. */
export const campaignAudienceProgress = pgTable('campaign_audience_progress', {
  campaignId: uuid().primaryKey().references(() => campaigns.id, { onDelete: 'cascade' }),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  phase: text().notNull().default('collecting'),
  cursorContactId: uuid(),  // kurzor přes ORDER BY id
  insertedRows: integer().notNull().default(0),
  skippedSuppressed: integer().notNull().default(0),
  skippedUnsubscribed: integer().notNull().default(0),
  skippedInvalid: integer().notNull().default(0),
  startedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp({ withTimezone: true }),
}, (t) => [
  check('ck_campaign_audience_progress__phase',
    sql`${t.phase} IN ('collecting','materializing','done')`),
  // Obnova po restartu workeru: "co je v tomhle projektu rozpracované".
  // Zároveň jediný index použitelný pro kaskádu z workspaces.
  index('idx_campaign_audience_progress__ws_updated')
    .on(t.workspaceId, t.updatedAt.desc()),
]);

/**
 * Agregovaná varování z renderu. Vlastní část 4a, zapisuje sender, čte report.
 * NEPATŘÍ do message_events: kampaň na 50 000 příjemců, kde šablona sahá na pole,
 * které polovina kontaktů nemá, by tam vyrobila 25 000 řádků s toutéž informací
 * a zdvojnásobila objem tabulky. Navíc by se kvůli tomu musely message_id
 * a message_created_at uvolnit na NULL pro všechny typy a přestala by platit
 * jediná záruka, na které stojí levné dohledání zprávy.
 */
export const campaignRenderWarnings = pgTable('campaign_render_warnings', {
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  campaignId: uuid().notNull().references(() => campaigns.id, { onDelete: 'cascade' }),
  code: text().notNull(),   // 'missing_value', ...
  path: text().notNull(),   // 'contact.attributes.city'
  count: bigint({ mode: 'number' }).notNull().default(0),
  firstSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  sample: jsonb().notNull().default([]),
}, (t) => [
  primaryKey({
    name: 'pk_campaign_render_warnings',
    columns: [t.workspaceId, t.campaignId, t.code, t.path],
  }),
]);

export type SendingProvider = typeof sendingProviders.$inferSelect;
export type SendingProviderInsert = typeof sendingProviders.$inferInsert;
export type SenderDomain = typeof senderDomains.$inferSelect;
export type SenderDomainInsert = typeof senderDomains.$inferInsert;
export type Campaign = typeof campaigns.$inferSelect;
export type CampaignInsert = typeof campaigns.$inferInsert;
export type CampaignContentVariant = typeof campaignContentVariants.$inferSelect;
export type CampaignContentVariantInsert = typeof campaignContentVariants.$inferInsert;
export type CampaignLink = typeof campaignLinks.$inferSelect;
export type CampaignLinkInsert = typeof campaignLinks.$inferInsert;
export type DeliverabilitySnapshot = typeof deliverabilitySnapshots.$inferSelect;
export type DeliverabilitySnapshotInsert = typeof deliverabilitySnapshots.$inferInsert;
export type CampaignAudienceProgress = typeof campaignAudienceProgress.$inferSelect;
export type CampaignAudienceProgressInsert = typeof campaignAudienceProgress.$inferInsert;
export type CampaignRenderWarning = typeof campaignRenderWarnings.$inferSelect;
export type CampaignRenderWarningInsert = typeof campaignRenderWarnings.$inferInsert;
```

- [ ] **Step 2: Ověř typovou kontrolu**

Run: `pnpm --filter @mlain/db typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/schema/campaigns.ts
git commit -m "feat(db): campaigns schema with jsonb pause_reason contract column"
```

---

### Task 11: Schéma trackingu (11 tabulek)

**Files:**
- Create: `packages/db/src/schema/tracking.ts`

Tabulky: `web_event_months`, `identities`, `identity_bindings`, `identity_merges`, `identity_token_uses`, `tracking_domains`, `contact_engagement`, `campaign_stats`, `campaign_stats_buckets`, `campaign_link_stats`, `proxy_ranges`. Partitionované `web_events` a `message_engagement` jsou v úkolu 12.

Tabulka `campaign_conversion_stats` z části 5 (3.11) se **nezakládá**, protože specifikace sama uvádí „NEZAKLÁDÁ SE V MVP 0".

Dvě věci, které mají za sebou konkrétní poruchu:

1. **`contact_engagement` je jeden řádek na kontakt, ne na zprávu.** Segmentace podle engagementu a všech šest presetů čištění databáze na ní stojí. `message_engagement` na dotaz „neotevřel" odpovědět neumí, protože její kontaktový index je částečný přes `first_open_at IS NOT NULL`.
2. **`campaign_link_stats.link_id` je `uuid`, ne `int`.** Je to `campaign_links.id`. Do `int` sloupce se UUID neuloží a job, který statistiku odkazů plní, by na prvním kliku spadl s chybou typu.

- [ ] **Step 1: Napiš `schema/tracking.ts`**

```ts
// packages/db/src/schema/tracking.ts
import { sql } from 'drizzle-orm';
import {
  bigint, boolean, check, date, index, integer, jsonb, pgTable, primaryKey,
  text, timestamp, uniqueIndex, uuid,
} from 'drizzle-orm/pg-core';
import { bytea, cidr } from './_types.js';
import { workspaces } from './identity.js';
import { contacts } from './contacts.js';

/**
 * Řídká mapa "v kterých měsících má tenhle subjekt vůbec nějaká data".
 * Bez ní musí timeline prohledat všechny měsíční partition pozpátku,
 * i když kontakt existuje tři měsíce a partition je jich 37.
 */
export const webEventMonths = pgTable('web_event_months', {
  workspaceId: uuid().notNull(),
  subjectKind: text().$type<'contact' | 'anonymous'>().notNull(),
  subjectId: uuid().notNull(),
  month: date().notNull(),  // první den měsíce podle received_at, NE occurred_at
}, (t) => [
  primaryKey({
    name: 'pk_web_event_months',
    columns: [t.workspaceId, t.subjectKind, t.subjectId, t.month],
  }),
  check('ck_web_event_months__kind', sql`${t.subjectKind} IN ('contact','anonymous')`),
]);

/** Aktuální vazba. Právě jeden řádek na (workspace_id, anonymous_id). */
export const identities = pgTable('identities', {
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  anonymousId: uuid().notNull(),
  contactId: uuid().references(() => contacts.id, { onDelete: 'set null' }),
  boundAt: timestamp({ withTimezone: true }),
  bindCount: integer().notNull().default(0),
  firstSeen: timestamp({ withTimezone: true }).notNull().defaultNow(),
  lastSeen: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ name: 'pk_identities', columns: [t.workspaceId, t.anonymousId] }),
  // Reverzní pohled: která anonymní ID patří kontaktu. Kontakt jich může mít
  // víc (jiný prohlížeč, jiné zařízení). Index, ne tabulka.
  index('idx_identities__contact').on(t.workspaceId, t.contactId)
    .where(sql`${t.contactId} IS NOT NULL`),
]);

/**
 * Historie vazeb, append only. Umožňuje odpovědět "komu patřila návštěva
 * v 14:07", i když se vazba později změnila (sdílený počítač).
 */
export const identityBindings = pgTable('identity_bindings', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  workspaceId: uuid().notNull(),
  anonymousId: uuid().notNull(),
  contactId: uuid(),  // NULL = odvázání (reset)
  validFrom: timestamp({ withTimezone: true }).notNull(),
  source: text().notNull(),
  evidence: jsonb().notNull().default({}),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('ck_identity_bindings__source', sql`${t.source} IN
    ('email_click','sdk_identify','server_api','form','reset')`),
  index('idx_identity_bindings__lookup')
    .on(t.workspaceId, t.anonymousId, t.validFrom.desc()),
]);

/** Záznam o doplnění historie ke kontaktu. Bez něj nejde slučování vrátit. */
export const identityMerges = pgTable('identity_merges', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  anonymousId: uuid().notNull(),
  contactId: uuid().notNull(),
  bindingId: uuid().notNull().references(() => identityBindings.id),
  windowFrom: timestamp({ withTimezone: true }).notNull(),
  windowTo: timestamp({ withTimezone: true }).notNull(),
  eventsTotal: integer().notNull().default(0),
  status: text().notNull().default('pending'),
  revertedAt: timestamp({ withTimezone: true }),
  revertedBy: uuid(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('ck_identity_merges__status', sql`${t.status} IN
    ('pending','running','completed','truncated','reverted','failed')`),
  index('idx_identity_merges__contact')
    .on(t.workspaceId, t.contactId, t.createdAt.desc()),
]);

/**
 * Jednorázovost identifikačního tokenu. Token je bezstavově podepsaný,
 * jednorázovost vynucuje unikátní klíč nonce. Řádky se mažou po expiraci.
 * RLS tahle tabulka NEMÁ: nemá workspace_id, klíčem je náhodný nonce
 * a řádek žije 15 minut.
 */
export const identityTokenUses = pgTable('identity_token_uses', {
  nonce: bytea().primaryKey(),  // přesně 8 bajtů
  usedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp({ withTimezone: true }).notNull(),
}, (t) => [
  check('ck_identity_token_uses__nonce_len', sql`octet_length(${t.nonce}) = 8`),
  index('idx_identity_token_uses__expiry').on(t.expiresAt),
]);

/**
 * Domény, na kterých smí běžet SDK a na které se smí přidat ml_token.
 * Bez zápisu v téhle tabulce SDK odmítne startovat a redirect token nepřidá.
 */
export const trackingDomains = pgTable('tracking_domains', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  host: text().notNull(),  // lowercase, bez schématu a portu
  includeSubdomains: boolean().notNull().default(false),
  verifiedAt: timestamp({ withTimezone: true }),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('ck_tracking_domains__host', sql`${t.host} ~ '^[a-z0-9.-]{1,253}$'`),
  uniqueIndex('uq_tracking_domains__workspace_host').on(t.workspaceId, t.host),
]);

/**
 * Rollup na kontakt. Řádek se zakládá LÍNĚ, až při první události kontaktu.
 * Kontakt, kterému se nikdy nic neposlalo, řádek nemá a segmentační dotaz
 * proto musí být LEFT JOIN s COALESCE, ne INNER JOIN. Jinak z presetu
 * "nikdy neotevřel" vypadnou právě ti nejnovější kontakti.
 */
export const contactEngagement = pgTable('contact_engagement', {
  contactId: uuid().notNull().references(() => contacts.id, { onDelete: 'cascade' }),
  workspaceId: uuid().notNull().references(() => workspaces.id, { onDelete: 'cascade' }),

  lastSentAt: timestamp({ withTimezone: true }),
  lastDeliveredAt: timestamp({ withTimezone: true }),
  lastOpenAt: timestamp({ withTimezone: true }),
  lastClickAt: timestamp({ withTimezone: true }),
  lastBounceAt: timestamp({ withTimezone: true }),

  sentTotal: integer().notNull().default(0),
  deliveredTotal: integer().notNull().default(0),
  opensTotal: integer().notNull().default(0),
  clicksTotal: integer().notNull().default(0),
  bouncesTotal: integer().notNull().default(0),

  sent7d: integer().notNull().default(0),
  sent30d: integer().notNull().default(0),
  sent90d: integer().notNull().default(0),
  opens7d: integer().notNull().default(0),
  opens30d: integer().notNull().default(0),
  opens90d: integer().notNull().default(0),
  clicks7d: integer().notNull().default(0),
  clicks30d: integer().notNull().default(0),
  clicks90d: integer().notNull().default(0),

  consecutiveNoOpen: integer().notNull().default(0),
  consecutiveNoClick: integer().notNull().default(0),

  // Klouzavá okna 7, 30 a 90 dní SE NEDAJÍ udržovat jen přičítáním. Bez tohohle
  // sloupce by je nešlo přepočítávat přírůstkově a musely by se počítat
  // pokaždé znovu přes všech pět milionů kontaktů.
  windowsRecomputedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Klíč je (workspace_id, contact_id), ne jen contact_id: se samotným
  // contact_id by každý dotaz musel workspace_id dohledávat joinem.
  primaryKey({ name: 'pk_contact_engagement', columns: [t.workspaceId, t.contactId] }),
  // NULLS FIRST je podstatné: kontakt, který nikdy neotevřel, má NULL a musí
  // v dotazu "neaktivní 90+ dní" vyjít. Bez explicitního pořadí by dotaz
  // WHERE last_open_at IS NULL OR last_open_at < ... index nevyužil pro obě větve.
  index('idx_contact_engagement__ws_last_open')
    .on(t.workspaceId, t.lastOpenAt.nullsFirst()),
  index('idx_contact_engagement__ws_no_open')
    .on(t.workspaceId, t.consecutiveNoOpen.desc()),
  index('idx_contact_engagement__ws_last_click')
    .on(t.workspaceId, t.lastClickAt.nullsFirst()),
  index('idx_contact_engagement__stale_windows').on(t.windowsRecomputedAt)
    .where(sql`${t.sent90d} > 0 OR ${t.opens90d} > 0 OR ${t.clicks90d} > 0`),
]);

/** Jeden řádek na kampaň. Aktualizuje se dávkově, nikdy per event. */
export const campaignStats = pgTable('campaign_stats', {
  workspaceId: uuid().notNull(),
  campaignId: uuid().primaryKey(),

  materialized: bigint({ mode: 'number' }).notNull().default(0),
  sent: bigint({ mode: 'number' }).notNull().default(0),
  failed: bigint({ mode: 'number' }).notNull().default(0),
  skipped: bigint({ mode: 'number' }).notNull().default(0),
  delivered: bigint({ mode: 'number' }).notNull().default(0),
  bouncedHard: bigint({ mode: 'number' }).notNull().default(0),
  bouncedSoft: bigint({ mode: 'number' }).notNull().default(0),
  complained: bigint({ mode: 'number' }).notNull().default(0),
  unsubscribed: bigint({ mode: 'number' }).notNull().default(0),

  opensTotal: bigint({ mode: 'number' }).notNull().default(0),
  opensUnique: bigint({ mode: 'number' }).notNull().default(0),
  opensUniqueHuman: bigint({ mode: 'number' }).notNull().default(0),
  opensUniqueApple: bigint({ mode: 'number' }).notNull().default(0),
  clicksTotal: bigint({ mode: 'number' }).notNull().default(0),
  clicksUnique: bigint({ mode: 'number' }).notNull().default(0),
  clicksUniqueHuman: bigint({ mode: 'number' }).notNull().default(0),
  clicksScanner: bigint({ mode: 'number' }).notNull().default(0),

  firstEventAt: timestamp({ withTimezone: true }),
  lastEventAt: timestamp({ withTimezone: true }),
  // Nejvyšší zpracované messages.sent_at. Průběh odesílání se čte přírůstkově
  // podle něj, ne z událostí typu 'sent', které se právě proto zrušily.
  progressWatermarkAt: timestamp({ withTimezone: true }),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  version: bigint({ mode: 'number' }).notNull().default(0),  // inkrement pro SSE
}, (t) => [
  index('idx_campaign_stats__workspace').on(t.workspaceId, t.updatedAt.desc()),
]);

/** Průběh v čase pro graf v reportu a pro živé sledování odesílání. */
export const campaignStatsBuckets = pgTable('campaign_stats_buckets', {
  campaignId: uuid().notNull(),
  workspaceId: uuid().notNull(),
  bucketAt: timestamp({ withTimezone: true }).notNull(),  // zaokrouhleno dolů na 5 minut
  sent: integer().notNull().default(0),
  delivered: integer().notNull().default(0),
  opensUnique: integer().notNull().default(0),
  clicksUnique: integer().notNull().default(0),
  bounced: integer().notNull().default(0),
}, (t) => [
  // workspace_id v čele ze stejného důvodu jako u campaign_link_stats:
  // politika RLS se vyhodnocuje nad indexovaným sloupcem a upsert z jobu
  // nemůže omylem trefit cizí projekt.
  primaryKey({
    name: 'pk_campaign_stats_buckets',
    columns: [t.workspaceId, t.campaignId, t.bucketAt],
  }),
]);

export const campaignLinkStats = pgTable('campaign_link_stats', {
  workspaceId: uuid().notNull(),
  campaignId: uuid().notNull(),
  // = campaign_links.id. Typ je uuid, NE int: do int sloupce se UUID neuloží
  // a job plnící statistiku odkazů by na prvním kliku spadl s chybou typu.
  linkId: uuid().notNull(),
  clicksTotal: bigint({ mode: 'number' }).notNull().default(0),
  clicksUnique: bigint({ mode: 'number' }).notNull().default(0),
  clicksHuman: bigint({ mode: 'number' }).notNull().default(0),
}, (t) => [
  // workspace_id je v klíči proto, že se politika RLS vyhodnocuje nad
  // indexovaným sloupcem a upsert z jobu nemůže omylem trefit cizí projekt.
  primaryKey({
    name: 'pk_campaign_link_stats',
    columns: [t.workspaceId, t.campaignId, t.linkId],
  }),
]);

/**
 * Cache stažených IP rozsahů obrazových proxy. Globální provozní data,
 * žádný obsah zákazníka, proto bez workspace_id a bez RLS.
 */
export const proxyRanges = pgTable('proxy_ranges', {
  id: uuid().primaryKey().default(sql`uuidv7()`),
  provider: text().notNull(),
  cidr: cidr().notNull(),
  fetchedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check('ck_proxy_ranges__provider', sql`${t.provider} IN
    ('apple_private_relay','google','manual')`),
  index('idx_proxy_ranges__provider').on(t.provider),
  index('idx_proxy_ranges__cidr').using('gist', sql`${t.cidr} inet_ops`),
]);

export type WebEventMonth = typeof webEventMonths.$inferSelect;
export type WebEventMonthInsert = typeof webEventMonths.$inferInsert;
export type Identity = typeof identities.$inferSelect;
export type IdentityInsert = typeof identities.$inferInsert;
export type IdentityBinding = typeof identityBindings.$inferSelect;
export type IdentityBindingInsert = typeof identityBindings.$inferInsert;
export type IdentityMerge = typeof identityMerges.$inferSelect;
export type IdentityMergeInsert = typeof identityMerges.$inferInsert;
export type IdentityTokenUse = typeof identityTokenUses.$inferSelect;
export type IdentityTokenUseInsert = typeof identityTokenUses.$inferInsert;
export type TrackingDomain = typeof trackingDomains.$inferSelect;
export type TrackingDomainInsert = typeof trackingDomains.$inferInsert;
export type ContactEngagement = typeof contactEngagement.$inferSelect;
export type ContactEngagementInsert = typeof contactEngagement.$inferInsert;
export type CampaignStats = typeof campaignStats.$inferSelect;
export type CampaignStatsInsert = typeof campaignStats.$inferInsert;
export type CampaignStatsBucket = typeof campaignStatsBuckets.$inferSelect;
export type CampaignStatsBucketInsert = typeof campaignStatsBuckets.$inferInsert;
export type CampaignLinkStats = typeof campaignLinkStats.$inferSelect;
export type CampaignLinkStatsInsert = typeof campaignLinkStats.$inferInsert;
export type ProxyRange = typeof proxyRanges.$inferSelect;
export type ProxyRangeInsert = typeof proxyRanges.$inferInsert;
```

- [ ] **Step 2: Ověř typovou kontrolu**

Run: `pnpm --filter @mlain/db typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/schema/tracking.ts
git commit -m "feat(db): tracking schema, identities, engagement and campaign stats"
```

---

### Task 12: Schéma partitionovaných tabulek (9 tabulek, jen typy)

**Files:**
- Create: `packages/db/src/schema/partitioned.ts`

Tenhle soubor **není v seznamu v `drizzle.config.ts`**, takže `drizzle-kit generate` ho nikdy neuvidí. DDL těchhle devíti tabulek píše ručně migrace 0003. Drizzle definice tu je proto, aby aplikace měla typy a query builder, a proto, aby test parity porovnal, co je v TypeScriptu, s tím, co je v databázi.

- [ ] **Step 1: Napiš `schema/partitioned.ts`**

```ts
// packages/db/src/schema/partitioned.ts
//
// POZOR: tenhle soubor NENÍ v seznamu schema v drizzle.config.ts a nikdy tam
// být nesmí. Devět tabulek níž je PARTITION BY RANGE a drizzle-kit by je
// vygeneroval jako obyčejné tabulky. To by prošlo, PARTITION BY by zmizel
// a projevilo by se to až u zákazníka na objemu dat. DDL píše migrace 0003.
import { sql } from 'drizzle-orm';
import {
  integer, jsonb, pgTable, primaryKey, smallint,
  text, timestamp, uuid,
} from 'drizzle-orm/pg-core';
import { inet } from './_types.js';

export const auditLog = pgTable('audit_log', {
  id: uuid().notNull().default(sql`uuidv7()`),
  // NULL u globálních akcí (user.login, user.password_changed). Právě proto
  // má audit_log vlastní politiku ws_isolation_audit: s obyčejnou ws_isolation
  // by INSERT globálního záznamu selhal na WITH CHECK a vzal s sebou celou
  // transakci, takže by se NEULOŽILA ani změna hesla.
  workspaceId: uuid(),
  actorType: text().$type<'user' | 'api_key' | 'system'>().notNull(),
  actorId: uuid(),
  actorLabel: text().notNull().default(''),  // e-mail nebo název klíče v okamžiku akce
  action: text().notNull(),
  targetType: text(),
  targetId: uuid(),
  ip: inet(),
  userAgent: text(),
  requestId: text(),
  metadata: jsonb().notNull().default({}),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ name: 'pk_audit_log', columns: [t.id, t.createdAt] }),
]);

export const webhookEvents = pgTable('webhook_events', {
  id: uuid().notNull().default(sql`uuidv7()`),
  workspaceId: uuid().notNull(),
  type: text().notNull(),
  payload: jsonb().notNull(),
  occurredAt: timestamp({ withTimezone: true }).notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ name: 'pk_webhook_events', columns: [t.id, t.createdAt] }),
]);

export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: uuid().notNull().default(sql`uuidv7()`),
  workspaceId: uuid().notNull(),
  endpointId: uuid().notNull(),
  eventId: uuid().notNull(),
  eventType: text().notNull(),
  status: text().notNull().default('pending'),
  attempt: integer().notNull().default(0),
  nextAttemptAt: timestamp({ withTimezone: true }),
  responseStatus: integer(),
  responseBodySnippet: text(),  // max 2 kB
  durationMs: integer(),
  errorCode: text(),
  deliveredAt: timestamp({ withTimezone: true }),
  // PARTIČNÍ KLÍČ A ZÁROVEŇ DRUHÁ SLOŽKA KLÍČE UDÁLOSTI. DEFAULT now() tu
  // SCHVÁLNĚ NENÍ: hodnota se přebírá z webhook_events.created_at, takže
  // (event_id, created_at) je celý klíč události a doručení leží ve stejném
  // měsíčním okně jako událost, ze které vzniklo.
  //
  // Bez toho by unikátní index uq_webhook_deliveries__event_endpoint
  // negarantoval nic (rozhodnutí R22): jeho třetí složkou musí být partiční
  // klíč, a kdyby to bylo now(), prošly by dva fan-outy téže události
  // a příjemce by dostal webhook dvakrát.
  //
  // Opakovaný pokus o doručení je UPDATE téhož řádku (attempt + 1),
  // ne nový řádek. Jeden řádek na dvojici (událost, endpoint).
  createdAt: timestamp({ withTimezone: true }).notNull(),
}, (t) => [
  primaryKey({ name: 'pk_webhook_deliveries', columns: [t.id, t.createdAt] }),
]);

/**
 * OUTBOX. Kontraktní podmnožinu sloupců, stavů a dotazů vlastní zmrazený
 * kontrakt (část 1, 4.10.1). Název, typ ani sémantika kontraktního sloupce
 * se NESMÍ změnit. Přidávat sloupce a indexy je dovolené.
 */
export const messages = pgTable('messages', {
  id: uuid().notNull().default(sql`uuidv7()`),
  workspaceId: uuid().notNull(),
  campaignId: uuid(),          // NULL = nekampáňová zpráva, rezerva pro MVP 1
  contentVariantId: uuid(),    // NULL = obsah ze sloupců kampaně, rezerva pro MVP 1
  kind: text().$type<'campaign' | 'test'>().notNull().default('campaign'),
  contactId: uuid().notNull(),
  email: text().notNull(),     // text, ne citext: Go nemá pro citext nativní typ
  renderData: jsonb().notNull().default({}),
  status: text().$type<'pending' | 'claimed' | 'sent' | 'failed' | 'skipped'>()
    .notNull().default('pending'),
  claimedBy: text(),
  claimedAt: timestamp({ withTimezone: true }),
  claimExpiresAt: timestamp({ withTimezone: true }),
  attempts: smallint().notNull().default(0),
  ambiguousCount: smallint().notNull().default(0),
  dispatchStartedAt: timestamp({ withTimezone: true }),
  nextAttemptAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  providerMessageId: text(),
  sentAt: timestamp({ withTimezone: true }),
  errorCode: text(),
  errorDetail: text(),
  // INVARIANT I1: všechny řádky jednoho materializačního běhu batch kampaně
  // mají created_at rovné campaigns.audience_built_at. Sender created_at
  // NIKDY nemění a nemá na něj sloupcový grant.
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ name: 'pk_messages', columns: [t.id, t.createdAt] }),
]);

export const messageEvents = pgTable('message_events', {
  id: uuid().notNull().default(sql`uuidv7()`),
  workspaceId: uuid().notNull(),
  messageId: uuid().notNull(),
  // Druhá složka primárního klíče zprávy. Bez ní by každý skok z události
  // na zprávu prohledal všechny partition.
  messageCreatedAt: timestamp({ withTimezone: true }).notNull(),
  campaignId: uuid().notNull(),
  contactId: uuid(),   // NULL až po GDPR výmazu, viz erasedAt
  erasedAt: timestamp({ withTimezone: true }),
  // Adresa v okamžiku odeslání. NEPOVINNÁ (rozhodnutí R33): čte ji jediný
  // index, a ten je částečný přes odrazy a stížnosti. U otevření a prokliku
  // by to byla kopie osobního údaje na každém řádku desetimilionové tabulky,
  // kterou pak musí výmaz podle článku 17 procházet. Povinnost drží
  // ck_message_events__recipient jen pro doručovací rodinu.
  recipient: text(),
  type: text().notNull(),
  subtype: text(),      // 'hard','soft','transient'; u open a click třída
  linkId: uuid(),       // campaign_links.id
  // GENEROVANÝ (rozhodnutí R32). Škálu vlastní P03, nikdo ji nezapisuje,
  // takže se nemůže rozejít. Bez větve ELSE schválně: nový typ v CHECK bez
  // ramene tady dá NULL a NOT NULL ho odmítne, tedy hlasitě.
  // Nula znamená "neúčastní se odvození stavu doručení".
  rank: smallint().notNull().generatedAlwaysAs(sql`CASE type
      WHEN 'open'                 THEN 0
      WHEN 'click'                THEN 0
      WHEN 'unsubscribe'          THEN 0
      WHEN 'circuit_breaker_open' THEN 0
      WHEN 'sent'                 THEN 20
      WHEN 'delivery_delayed'     THEN 25
      WHEN 'delivered'            THEN 30
      WHEN 'bounced_soft'         THEN 60
      WHEN 'bounced_hard'         THEN 80
      WHEN 'complained'           THEN 85
      WHEN 'rejected'             THEN 90
      WHEN 'render_failed'        THEN 95
    END`),
  ts: timestamp({ withTimezone: true }).notNull(),  // čas události u providera
  // PARTIČNÍ KLÍČ. Vždy now(), tedy monotónní a vždy uvnitř existujícího okna.
  // Partitionovat podle ts by znamenalo, že zpožděný bounce s časovou značkou
  // mimo okno TVRDĚ SELŽE a událost o doručení se ztratí.
  receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  source: text().notNull(),
  metadata: jsonb().notNull().default({}),
}, (t) => [
  primaryKey({ name: 'pk_message_events', columns: [t.id, t.receivedAt] }),
]);

export const providerEventReceipts = pgTable('provider_event_receipts', {
  id: uuid().notNull().default(sql`uuidv7()`),
  workspaceId: uuid().notNull(),
  providerId: uuid().notNull(),
  dedupKey: text().notNull(),
  snsMessageId: text(),
  eventType: text().notNull(),
  messageId: uuid(),
  messageCreatedAt: timestamp({ withTimezone: true }),
  receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp({ withTimezone: true }),
  status: text().notNull().default('received'),
  raw: jsonb().notNull(),
}, (t) => [
  primaryKey({ name: 'pk_provider_event_receipts', columns: [t.id, t.receivedAt] }),
]);

export const inboundDeliveries = pgTable('inbound_deliveries', {
  id: uuid().notNull().default(sql`uuidv7()`),
  workspaceId: uuid().notNull(),
  endpointId: uuid().notNull(),
  externalId: text(),
  status: text().notNull(),
  errorCode: text(),
  errorDetail: text(),
  contactId: uuid(),
  action: text(),  // subscribe | unsubscribe | update | ignore
  payload: jsonb().notNull(),
  headers: jsonb().notNull().default({}),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp({ withTimezone: true }),
}, (t) => [
  primaryKey({ name: 'pk_inbound_deliveries', columns: [t.id, t.createdAt] }),
]);

export const webEvents = pgTable('web_events', {
  // DEFAULT schválně NENÍ: ID generuje klient a server ho jen přebírá.
  // Default by zamaskoval chybu, kdy klient ID neposlal.
  id: uuid().notNull(),
  receivedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  occurredAt: timestamp({ withTimezone: true }).notNull(),
  workspaceId: uuid().notNull(),
  name: text().notNull(),
  anonymousId: uuid(),
  contactId: uuid(),
  sessionId: uuid(),
  source: text().notNull().default('web'),
  page: jsonb().notNull().default({}),
  properties: jsonb().notNull().default({}),
  context: jsonb().notNull().default({}),
  identityMergeId: uuid(),
  erasedAt: timestamp({ withTimezone: true }),
}, (t) => [
  primaryKey({ name: 'pk_web_events', columns: [t.id, t.receivedAt] }),
]);

export const messageEngagement = pgTable('message_engagement', {
  messageId: uuid().notNull(),
  // Kopie messages.created_at. Řádek engagementu tak leží ve stejném měsíčním
  // okně jako zpráva, retence obou se odpojuje společně a dotaz, který zná
  // zprávu, zná i partition.
  createdAt: timestamp({ withTimezone: true }).notNull(),
  workspaceId: uuid().notNull(),
  campaignId: uuid().notNull(),
  contactId: uuid(),
  erasedAt: timestamp({ withTimezone: true }),

  firstOpenAt: timestamp({ withTimezone: true }),
  lastOpenAt: timestamp({ withTimezone: true }),
  openCount: integer().notNull().default(0),
  firstHumanOpenAt: timestamp({ withTimezone: true }),
  humanOpenCount: integer().notNull().default(0),
  // Bity: 1 = human, 2 = proxy_apple, 4 = proxy_image, 8 = bot, 16 = unknown.
  openClassMask: integer().notNull().default(0),

  firstClickAt: timestamp({ withTimezone: true }),
  lastClickAt: timestamp({ withTimezone: true }),
  clickCount: integer().notNull().default(0),
  firstHumanClickAt: timestamp({ withTimezone: true }),
  humanClickCount: integer().notNull().default(0),
  clickedLinks: integer().notNull().default(0),
}, (t) => [
  primaryKey({ name: 'pk_message_engagement', columns: [t.messageId, t.createdAt] }),
]);

export type AuditLog = typeof auditLog.$inferSelect;
export type AuditLogInsert = typeof auditLog.$inferInsert;
export type WebhookEvent = typeof webhookEvents.$inferSelect;
export type WebhookEventInsert = typeof webhookEvents.$inferInsert;
export type WebhookDelivery = typeof webhookDeliveries.$inferSelect;
export type WebhookDeliveryInsert = typeof webhookDeliveries.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type MessageInsert = typeof messages.$inferInsert;
export type MessageEvent = typeof messageEvents.$inferSelect;
export type MessageEventInsert = typeof messageEvents.$inferInsert;
export type ProviderEventReceipt = typeof providerEventReceipts.$inferSelect;
export type ProviderEventReceiptInsert = typeof providerEventReceipts.$inferInsert;
export type InboundDelivery = typeof inboundDeliveries.$inferSelect;
export type InboundDeliveryInsert = typeof inboundDeliveries.$inferInsert;
export type WebEvent = typeof webEvents.$inferSelect;
export type WebEventInsert = typeof webEvents.$inferInsert;
export type MessageEngagement = typeof messageEngagement.$inferSelect;
export type MessageEngagementInsert = typeof messageEngagement.$inferInsert;
```

- [ ] **Step 2: Ověř typovou kontrolu**

Run: `pnpm --filter @mlain/db typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/schema/partitioned.ts
git commit -m "feat(db): typed definitions for nine partitioned tables"
```

---

### Task 13: Barrel schématu a zelený test na 75 tabulek

**Files:**
- Create: `packages/db/src/schema/index.ts`
- Modify: `packages/db/test/schema-shape.test.ts`

- [ ] **Step 1: Napiš `schema/index.ts`**

```ts
// packages/db/src/schema/index.ts
//
// Reexport všech domén. Tenhle soubor NENÍ v seznamu schema v drizzle.config.ts,
// protože by přes něj drizzle-kit vtáhl i partitioned.ts.
export * from './identity.js';
export * from './platform.js';
export * from './contacts.js';
export * from './content.js';
export * from './campaigns.js';
export * from './tracking.js';
export * from './partitioned.js';
```

- [ ] **Step 2: Rozšiř `schema-shape.test.ts` o kontrolu rozdělení po doménách**

Samotný počet 75 by se dal splnit i tak, že se tabulka omylem vytvoří dvakrát a jiná chybí. Rozdělení po souborech to zachytí.

```ts
// packages/db/test/schema-shape.test.ts
import { describe, expect, it } from 'vitest';
import { is } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from '../src/schema/index.js';
import * as identity from '../src/schema/identity.js';
import * as platform from '../src/schema/platform.js';
import * as contactsSchema from '../src/schema/contacts.js';
import * as content from '../src/schema/content.js';
import * as campaignsSchema from '../src/schema/campaigns.js';
import * as tracking from '../src/schema/tracking.js';
import * as partitioned from '../src/schema/partitioned.js';

function tablesOf(mod: Record<string, unknown>): PgTable[] {
  return Object.values(mod).filter((value): value is PgTable => is(value, PgTable));
}
function namesOf(mod: Record<string, unknown>): string[] {
  return tablesOf(mod).map((table) => getTableConfig(table).name).sort();
}

describe('tvar schématu', () => {
  it('schéma obsahuje přesně 75 tabulek', () => {
    expect(tablesOf(schema)).toHaveLength(75);
  });

  it('každý název tabulky je snake_case', () => {
    for (const table of tablesOf(schema)) {
      const name = getTableConfig(table).name;
      expect(name, `tabulka ${name} porušuje snake_case`).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it('rozdělení tabulek po doménách odpovídá registru v plánu', () => {
    expect(namesOf(identity)).toEqual([
      'api_keys', 'invitations', 'memberships', 'password_reset_tokens',
      'sessions', 'users', 'workspaces',
    ]);
    expect(namesOf(platform)).toEqual([
      'idempotency_keys', 'rate_limits', 'secret_key_generations',
      'system_settings', 'webhook_endpoints',
    ]);
    expect(namesOf(contactsSchema)).toHaveLength(23);
    expect(namesOf(content)).toHaveLength(12);
    expect(namesOf(campaignsSchema)).toHaveLength(8);
    expect(namesOf(tracking)).toHaveLength(11);
    expect(namesOf(partitioned)).toEqual([
      'audit_log', 'inbound_deliveries', 'message_engagement', 'message_events',
      'messages', 'provider_event_receipts', 'web_events',
      'webhook_deliveries', 'webhook_events',
    ]);
  });

  it('žádná tabulka se nejmenuje campaign_conversion_stats (MVP 2, nezakládá se)', () => {
    expect(namesOf(schema)).not.toContain('campaign_conversion_stats');
  });
});
```

Import `contactsSchema` a `campaignsSchema` je pojmenovaný takhle schválně: `contacts` a `campaigns` už jsou názvy tabulek reexportované ze `schema/index.js` a kolidovaly by.

- [ ] **Step 3: Spusť test a ověř, že projde**

Run: `pnpm --filter @mlain/db test:unit`
Expected: PASS, 11 testů celkem v projektu `unit` (4 v `schema-shape.test.ts`, 7 v `column-types.test.ts`). Kdyby počet tabulek nesedel, chybí nebo přebývá tabulka; porovnej ho s registrem v kapitole 2 tohohle plánu a **nikdy neupravuj očekávané číslo v testu**.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/schema/index.ts packages/db/test/schema-shape.test.ts
git commit -m "feat(db): schema barrel, all 75 tables present"
```

---

### Task 14: Migrace 0001, generování nepartitionovaných tabulek

**Files:**
- Create: `packages/db/migrations/0001_core_tables.sql` (generuje `drizzle-kit`)
- Create: `packages/db/migrations/meta/0001_snapshot.json` (generuje `drizzle-kit`)
- Modify: `packages/db/migrations/meta/_journal.json` (upravuje `drizzle-kit`)
- Create: `packages/db/test/core-tables.test.ts`

- [ ] **Step 1: Napiš padající test, který ověří výsledek migrace v databázi**

Test kontroluje **skutečný stav databáze**, ne obsah souboru. Kontrola grepem by neodhalila, že SQL je nespustitelné.

```ts
// packages/db/test/core-tables.test.ts
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './helpers/container.js';
import { seedTwoWorkspaces } from './helpers/fixtures.js';

let h: Harness;
beforeAll(async () => { h = await startHarness(); }, 180_000);
afterAll(async () => { await h.stop(); });

describe('migrace 0001, jádro schématu', () => {
  it('vzniklo 66 nepartitionovaných tabulek', async () => {
    // relispartition = false je nutné: partition samotné jsou taky relkind 'r'
    // a od úkolu 17 je runner zakládá na čtyři měsíce dopředu, takže bez téhle
    // podmínky by test po přidání partitioningu začal počítat desítky navíc.
    const { rows } = await h.as('mlain_migrator').query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relispartition = false`,
    );
    expect(rows[0].n).toBe(66);
  });

  it('contacts.email je citext a email_domain je generovaný sloupec', async () => {
    const { rows } = await h.as('mlain_migrator').query<
      { column_name: string; data_type: string; is_generated: string }
    >(`SELECT column_name, data_type, is_generated
         FROM information_schema.columns
        WHERE table_name = 'contacts' AND column_name IN ('email','email_domain','search_text')
        ORDER BY column_name`);
    const byName = Object.fromEntries(rows.map((r) => [r.column_name, r]));
    expect(byName.email.data_type).toBe('USER-DEFINED');
    expect(byName.email_domain.is_generated).toBe('ALWAYS');
    expect(byName.search_text.is_generated).toBe('ALWAYS');
  });

  it('campaigns.pause_reason je jsonb, ne text (kontraktní sloupec)', async () => {
    const { rows } = await h.as('mlain_migrator').query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns
        WHERE table_name = 'campaigns' AND column_name = 'pause_reason'`,
    );
    expect(rows[0].data_type).toBe('jsonb');
  });

  it('částečné unikátní indexy nad měkce mazanými tabulkami existují', async () => {
    const { rows } = await h.as('mlain_migrator').query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes
        WHERE schemaname = 'public' AND indexdef LIKE '%WHERE (deleted_at IS NULL)%'
        ORDER BY 1`,
    );
    const names = rows.map((r) => r.indexname);
    for (const expected of ['uq_users__email', 'uq_workspaces__slug',
                            'uq_contacts__workspace_email', 'uq_lists__workspace_name',
                            'uq_segments__workspace_name', 'uq_templates__workspace_name']) {
      expect(names).toContain(expected);
    }
  });

  it('žádná tabulka nepoužívá nativní enum typ', async () => {
    const { rows } = await h.as('mlain_migrator').query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_type t
         JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE t.typtype = 'e' AND n.nspname = 'public'`,
    );
    expect(rows[0].n).toBe(0);
  });

  it('žádná tabulka nemá trigger', async () => {
    const { rows } = await h.as('mlain_migrator').query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_trigger WHERE NOT tgisinternal`,
    );
    expect(rows[0].n).toBe(0);
  });

  it('otisky v email_fingerprints projdou tam i zpět přes skutečný ovladač', async () => {
    // Tvar hodnoty na drátě je vlastnost ovladače, ne našeho typu, takže tohle
    // je jediné místo, kde se dá ověřit. Kdyby se rozešly, otisky by se tiše
    // znehodnotily, kontrola suppression by přestala platit a vymazaný člověk
    // by dostal e-mail, aniž by cokoli selhalo.
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const otisky = [Buffer.from('9f86d081884c7d65', 'hex'), Buffer.from('0d1b48', 'hex')];
    await h.as('mlain_migrator').query(
      `UPDATE contacts SET email_fingerprints = $2 WHERE id = $1`,
      [ws.contactInA, otisky]);

    const { rows } = await h.as('mlain_migrator').query<{ f: Buffer[] }>(
      'SELECT email_fingerprints AS f FROM contacts WHERE id = $1', [ws.contactInA]);
    expect(Array.isArray(rows[0].f)).toBe(true);
    expect(rows[0].f).toHaveLength(2);
    expect(Buffer.isBuffer(rows[0].f[0])).toBe(true);
    expect(rows[0].f[0].equals(otisky[0])).toBe(true);
    expect(rows[0].f[1].equals(otisky[1])).toBe(true);

    // A že se pole dá i vyhledat, protože přesně to dělá kontrola suppression.
    const { rows: found } = await h.as('mlain_migrator').query<{ n: number }>(
      `SELECT count(*)::int AS n FROM contacts WHERE email_fingerprints && $1::bytea[]`,
      [[otisky[1]]]);
    expect(found[0].n).toBe(1);
  });

  it('migrace 0001 nezakládá žádnou z devíti partitionovaných tabulek', () => {
    // Tichá varianta téhle chyby je horší než hlasitá: kdyby drizzle-kit
    // partitionovanou tabulku vygeneroval, PARTITION BY by zmizel, schéma
    // by prošlo a projevilo by se to až u zákazníka na objemu dat.
    const sql = readFileSync(
      new URL('../migrations/0001_core_tables.sql', import.meta.url), 'utf8');
    for (const table of ['messages', 'message_events', 'provider_event_receipts',
                         'web_events', 'webhook_events', 'webhook_deliveries',
                         'audit_log', 'inbound_deliveries', 'message_engagement']) {
      expect(sql, `migrace 0001 zakládá partitionovanou tabulku ${table}`)
        .not.toMatch(new RegExp(`CREATE TABLE[^;]*"?${table}"?\\s*\\(`));
    }
  });
});

describe('doplňky schématu z doplňkového průchodu', () => {
  const sloupec = async (table: string, column: string) => {
    const { rows } = await h.as('mlain_migrator').query<{
      data_type: string; is_nullable: string; column_default: string | null;
    }>(`SELECT data_type, is_nullable, column_default
          FROM information_schema.columns
         WHERE table_name = $1 AND column_name = $2`, [table, column]);
    return rows[0];
  };

  it('api_keys nese oba sloupce pro odklad při rotaci klíče', async () => {
    // Bez nich je rotace nutně okamžitá a integrace zákazníka přestane
    // fungovat ve chvíli, kdy si v UI vygeneruje nový klíč.
    expect((await sloupec('api_keys', 'previous_secret_hash'))?.data_type).toBe('bytea');
    expect((await sloupec('api_keys', 'previous_expires_at'))?.data_type)
      .toBe('timestamp with time zone');
  });

  it('hash předchozího klíče bez konce odkladu neprojde', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    await expect(h.as('mlain_migrator').query(
      `INSERT INTO api_keys (workspace_id, name, kind, prefix, secret_hash,
                             previous_secret_hash)
       VALUES ($1, 'k', 'secret', 'abcdefgh', '\\x00'::bytea, '\\x01'::bytea)`,
      [ws.workspaceA])).rejects.toThrow(/ck_api_keys__previous_secret/);
  });

  it('rate_limits existuje, nemá workspace_id a RLS na ní neběží', async () => {
    expect(await sloupec('rate_limits', 'bucket')).toBeDefined();
    expect(await sloupec('rate_limits', 'workspace_id'),
      'rozsah nese textový klíč, ne sloupec (R36)').toBeUndefined();
    const { rows } = await h.as('mlain_migrator').query<{ relrowsecurity: boolean }>(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'rate_limits'`);
    expect(rows[0].relrowsecurity).toBe(false);
  });

  it('rate_limits počítá atomicky a odmítne kbelík ve špatném tvaru', async () => {
    const zapis = () => h.as('mlain_migrator').query<{ hits: number }>(
      `INSERT INTO rate_limits (bucket, window_start, hits, expires_at)
       VALUES ('user:u1:login', date_trunc('minute', now()), 1, now() + interval '1 min')
       ON CONFLICT (bucket, window_start) DO UPDATE SET hits = rate_limits.hits + 1
       RETURNING hits`);
    expect((await zapis()).rows[0].hits).toBe(1);
    expect((await zapis()).rows[0].hits, 'druhý zápis musí kolidovat, ne založit řádek')
      .toBe(2);
    await expect(h.as('mlain_migrator').query(
      `INSERT INTO rate_limits (bucket, window_start, hits, expires_at)
       VALUES ('spatny_tvar', now(), 1, now())`)).rejects.toThrow(/ck_rate_limits__bucket/);
  });

  it('contacts.search_key existuje a má vlastní trigramový index', async () => {
    expect((await sloupec('contacts', 'search_key'))?.data_type).toBe('text');
    const { rows } = await h.as('mlain_migrator').query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'contacts' AND indexname = 'idx_contacts__search_key_trgm'`);
    expect(rows[0].indexdef).toContain('gin_trgm_ops');
  });

  it('hledání bez diakritiky najde kontakt s diakritikou', async () => {
    // Ověřeno spuštěním, že to jinak nejde: unaccent() je STABLE, ne IMMUTABLE,
    // takže generovaný sloupec ani indexový výraz ho použít nemůže.
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    await h.as('mlain_migrator').query(
      `INSERT INTO contacts (workspace_id, email, first_name, last_name, search_key)
       VALUES ($1, 'novacek@example.test', 'Petr', 'Nováček',
               'petr novacek novacek@example.test')`, [ws.workspaceA]);
    const { rows } = await h.as('mlain_migrator').query<{ last_name: string }>(
      `SELECT last_name FROM contacts
        WHERE workspace_id = $1 AND search_key LIKE '%novacek%'`, [ws.workspaceA]);
    expect(rows.map((r) => r.last_name)).toContain('Nováček');
  });

  it('imports nese oba sloupce a nesmí navazovat sám na sebe', async () => {
    expect((await sloupec('imports', 'stored_error_count'))?.is_nullable).toBe('NO');
    expect((await sloupec('imports', 'resume_from_import_id'))?.data_type).toBe('uuid');
    const { rows } = await h.as('mlain_migrator').query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE conname = 'ck_imports__resume_not_self'`);
    expect(rows[0].def).toContain('DISTINCT FROM');
  });

  it('campaigns.audience_breakdown je jsonb a smí být prázdné', async () => {
    const col = await sloupec('campaigns', 'audience_breakdown');
    expect(col?.data_type).toBe('jsonb');
    expect(col?.is_nullable, 'kampaň bez zmrazeného publika rozpad nemá').toBe('YES');
  });

  it('sender_domains nese delegaci a token je unikátní jen když existuje', async () => {
    for (const c of ['delegation_token_hash', 'delegation_expires_at',
                     'delegation_created_by']) {
      expect(await sloupec('sender_domains', c), `chybí ${c}`).toBeDefined();
    }
    const { rows } = await h.as('mlain_migrator').query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'sender_domains'
          AND indexname = 'uq_sender_domains__delegation_token'`);
    expect(rows[0].indexdef).toContain('UNIQUE');
    expect(rows[0].indexdef,
      'bez částečnosti by druhá doména bez delegace neprošla').toContain('WHERE');
  });

  it('campaign_links.id nemá DEFAULT, takže zápis bez id spadne hlasitě', async () => {
    // S DEFAULT by odkaz v už odeslaném e-mailu na řádek nenavázal
    // a report odkazů by zůstal prázdný, aniž by cokoli spadlo (R40).
    expect((await sloupec('campaign_links', 'id'))?.column_default).toBeNull();
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    await expect(h.as('mlain_migrator').query(
      `INSERT INTO campaign_links (workspace_id, campaign_id, url, position)
       VALUES ($1, gen_random_uuid(), 'https://example.test', 0)`, [ws.workspaceA]))
      .rejects.toThrow(/null value in column "id"/);
  });

  it('všechny čtyři šifrované obálky mají týž typ text', async () => {
    // Kontrakt 4.10.4 je textový. Dva sloupce v bytea by rotaci klíče nutily
    // pracovat na každém jinak.
    for (const [table, column] of [
      ['sending_providers', 'config_encrypted'],
      ['webhook_endpoints', 'secret_encrypted'],
      ['inbound_endpoints', 'secret_encrypted'],
      ['ai_provider_credentials', 'api_key_encrypted'],
    ] as const) {
      expect((await sloupec(table, column))?.data_type, `${table}.${column}`).toBe('text');
    }
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm --filter @mlain/db test:db -- test/core-tables.test.ts`
Expected: FAIL, počet tabulek je 0.

- [ ] **Step 3: Vygeneruj migraci**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool/packages/db && pnpm db:generate --name=core_tables
```
Expected: vznikne `migrations/0001_core_tables.sql`, `migrations/meta/0001_snapshot.json` a do `_journal.json` přibude záznam s `tag: "0001_core_tables"`.

- [ ] **Step 4: Přečti vygenerované SQL a ověř, že v něm není žádná z devíti partitionovaných tabulek**

Run:
```bash
grep -c "CREATE TABLE" packages/db/migrations/0001_core_tables.sql
grep -E "CREATE TABLE (IF NOT EXISTS )?\"?(messages|message_events|provider_event_receipts|web_events|webhook_events|webhook_deliveries|audit_log|inbound_deliveries|message_engagement)\"?" packages/db/migrations/0001_core_tables.sql
```
Expected: první příkaz vypíše `66`, druhý nevypíše nic a skončí kódem 1. Kdyby druhý něco našel, je v `drizzle.config.ts` špatný seznam souborů a `schema/partitioned.ts` nebo `schema/index.ts` se do něj dostal.

- [ ] **Step 5: Spusť test a ověř, že projde**

Run: `pnpm --filter @mlain/db test:db -- test/core-tables.test.ts`
Expected: PASS, 19 testů (8 původních a 11 na doplňky schématu).

Kdyby některý test spadl na tom, že `drizzle-kit` konkrétní konstrukci nevygeneroval (typicky výrazový index, generovaný sloupec nebo `NULLS FIRST`), platí **pravidlo náhrady**: chybějící DDL se **nedopisuje ručně do vygenerovaného souboru** (ten se needituje), ale doplní se novou ruční migrací `pnpm db:custom --name=<popis>` zařazenou hned za 0001. Očekávaný sloupec nebo index se z Drizzle schématu **neodstraňuje**, aby zůstal zdrojem pravdy pro typy.

- [ ] **Step 6: Commit**

```bash
git add packages/db/migrations packages/db/test/core-tables.test.ts
git commit -m "feat(db): migration 0001 generates 65 core tables"
```

---

### Task 15: Migrace 0002, cyklický cizí klíč šablon

**Files:**
- Create: `packages/db/migrations/0002_templates_cycle_fk.sql`
- Modify: `packages/db/migrations/meta/_journal.json`
- Modify: `packages/db/test/core-tables.test.ts`

`templates.current_version_id` míří na `template_versions`, `template_versions.template_id` míří zpátky na `templates`. Kdyby byly oba deklarované uvnitř `CREATE TABLE`, migrace by spadla na neexistující tabulce.

- [ ] **Step 1: Doplň padající test**

```ts
// packages/db/test/core-tables.test.ts, doplň do describe
  it('templates.current_version_id má pojmenovaný cizí klíč na template_versions', async () => {
    const { rows } = await h.as('mlain_migrator').query<{ conname: string; def: string }>(
      `SELECT conname, pg_get_constraintdef(oid) AS def
         FROM pg_constraint
        WHERE conrelid = 'templates'::regclass AND contype = 'f'
          AND conname = 'fk_templates__current_version'`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].def).toContain('REFERENCES template_versions(id)');
    expect(rows[0].def).toContain('ON DELETE SET NULL');
  });
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm --filter @mlain/db test:db -- test/core-tables.test.ts`
Expected: FAIL, `expected [] to have a length of 1`.

- [ ] **Step 3: Vytvoř prázdnou ruční migraci a zapiš do ní SQL**

Run: `cd /Users/petr/Projects/Mailing_Tool/packages/db && pnpm db:custom --name=templates_cycle_fk`

Pak do vzniklého `migrations/0002_templates_cycle_fk.sql` zapiš:

```sql
-- Fáze 2 dvoufázového zakládání cyklu mezi templates a template_versions.
-- Pojmenovaný constraint je povinný: bez ADD CONSTRAINT <jméno> by si ho
-- Postgres pojmenoval sám a příští migrace by ho nedokázala spolehlivě adresovat.
ALTER TABLE templates
  ADD CONSTRAINT fk_templates__current_version
  FOREIGN KEY (current_version_id) REFERENCES template_versions(id) ON DELETE SET NULL;
```

- [ ] **Step 4: Spusť test a ověř, že projde**

Run: `pnpm --filter @mlain/db test:db -- test/core-tables.test.ts`
Expected: PASS, 20 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/db/migrations packages/db/test/core-tables.test.ts
git commit -m "feat(db): migration 0002 closes the templates version cycle"
```

---

### Task 16: Migrace 0003, devět partitionovaných tabulek

**Files:**
- Create: `packages/db/migrations/0003_partitioned_tables.sql`
- Modify: `packages/db/migrations/meta/_journal.json`
- Create: `packages/db/test/partitioned-tables.test.ts`

Tohle je nejcitlivější migrace celého plánu. `messages` je zmrazený kontrakt: název, typ ani sémantika kontraktního sloupce se nesmí změnit.

- [ ] **Step 1: Napiš padající test**

```ts
// packages/db/test/partitioned-tables.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './helpers/container.js';
import { createMonthlyPartitions } from '../src/partitions.js';

let h: Harness;
beforeAll(async () => { h = await startHarness(); }, 180_000);
afterAll(async () => { await h.stop(); });

const EXPECTED: Record<string, string> = {
  audit_log: 'created_at',
  webhook_events: 'created_at',
  webhook_deliveries: 'created_at',
  messages: 'created_at',
  message_events: 'received_at',
  provider_event_receipts: 'received_at',
  inbound_deliveries: 'created_at',
  web_events: 'received_at',
  message_engagement: 'created_at',
};

describe('partitionované tabulky', () => {
  it('existuje přesně devět partitionovaných tabulek', async () => {
    const { rows } = await h.as('mlain_migrator').query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'p' ORDER BY 1`,
    );
    expect(rows.map((r) => r.relname)).toEqual(Object.keys(EXPECTED).sort());
  });

  it('každá partitionuje podle sloupce z registru, nikdy podle cizího času', async () => {
    for (const [table, column] of Object.entries(EXPECTED)) {
      const { rows } = await h.as('mlain_migrator').query<{ col: string }>(
        `SELECT a.attname AS col
           FROM pg_partitioned_table p
           JOIN pg_class c ON c.oid = p.partrelid
           JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = p.partattrs[0]
          WHERE c.relname = $1`, [table]);
      expect(rows[0]?.col, `${table} partitionuje podle špatného sloupce`).toBe(column);
    }
  });

  it('primární klíč každé partitionované tabulky obsahuje partiční sloupec', async () => {
    for (const [table, column] of Object.entries(EXPECTED)) {
      const { rows } = await h.as('mlain_migrator').query<{ def: string }>(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conrelid = $1::regclass AND contype = 'p'`, [table]);
      expect(rows[0].def, `${table} nemá ${column} v primárním klíči`).toContain(column);
    }
  });

  it('žádná partitionovaná tabulka nemá DEFAULT partition', async () => {
    const { rows } = await h.as('mlain_migrator').query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_class c
         JOIN pg_inherits i ON i.inhrelid = c.oid
        WHERE pg_get_expr(c.relpartbound, c.oid) = 'DEFAULT'`,
    );
    expect(rows[0].n).toBe(0);
  });

  it('messages má všech 23 kontraktních sloupců se správným typem', async () => {
    const expected: Record<string, string> = {
      id: 'uuid', workspace_id: 'uuid', campaign_id: 'uuid', content_variant_id: 'uuid',
      kind: 'text', contact_id: 'uuid', email: 'text', render_data: 'jsonb',
      status: 'text', claimed_by: 'text',
      claimed_at: 'timestamp with time zone', claim_expires_at: 'timestamp with time zone',
      attempts: 'smallint', ambiguous_count: 'smallint',
      dispatch_started_at: 'timestamp with time zone',
      next_attempt_at: 'timestamp with time zone',
      provider_message_id: 'text', sent_at: 'timestamp with time zone',
      error_code: 'text', error_detail: 'text',
      created_at: 'timestamp with time zone', updated_at: 'timestamp with time zone',
    };
    const { rows } = await h.as('mlain_migrator').query<
      { column_name: string; data_type: string; is_nullable: string }
    >(`SELECT column_name, data_type, is_nullable FROM information_schema.columns
        WHERE table_name = 'messages'`);
    const byName = Object.fromEntries(rows.map((r) => [r.column_name, r]));
    for (const [column, type] of Object.entries(expected)) {
      expect(byName[column], `messages.${column} chybí`).toBeDefined();
      expect(byName[column].data_type, `messages.${column} má špatný typ`).toBe(type);
    }
    // contact_id je v kontraktu NOT NULL. Rozhodnutí R3.
    expect(byName.contact_id.is_nullable).toBe('NO');
    // campaign_id a content_variant_id jsou rezervy a musí být nullable.
    expect(byName.campaign_id.is_nullable).toBe('YES');
    expect(byName.content_variant_id.is_nullable).toBe('YES');
  });

  it('messages má kontraktní indexy včetně dvousložkové unikátnosti publika', async () => {
    const { rows } = await h.as('mlain_migrator').query<{ indexname: string; indexdef: string }>(
      `SELECT indexname, indexdef FROM pg_indexes
        WHERE schemaname = 'public' AND tablename = 'messages'`,
    );
    const byName = Object.fromEntries(rows.map((r) => [r.indexname, r.indexdef]));
    expect(byName.idx_messages__claimable).toContain('campaign_id');
    expect(byName.idx_messages__claimable).toContain("status = 'pending'");
    expect(byName.uq_messages__campaign_contact).toContain('created_at');
    expect(byName.idx_messages__stuck).toBeDefined();
    expect(byName.idx_messages__campaign_status).toBeDefined();
    expect(byName.idx_messages__test_claimable).toContain("kind = 'test'");
  });

  it('message_events nese obě složky klíče zprávy a obě jsou NOT NULL', async () => {
    const { rows } = await h.as('mlain_migrator').query<
      { column_name: string; is_nullable: string }
    >(`SELECT column_name, is_nullable FROM information_schema.columns
        WHERE table_name = 'message_events'
          AND column_name IN ('message_id','message_created_at')`);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.is_nullable).toBe('NO');
  });

  // --- rank a recipient, rozhodnutí R32 a R33 -------------------------------

  it('rank je generovaný sloupec a nejde do něj zapsat zvenčí', async () => {
    const { rows } = await h.as('mlain_migrator').query<{ is_generated: string }>(
      `SELECT is_generated FROM information_schema.columns
        WHERE table_name = 'message_events' AND column_name = 'rank'`);
    expect(rows[0].is_generated,
      'rank musí být GENERATED ALWAYS, jinak ho může volající uvést špatně')
      .toBe('ALWAYS');

    await expect(h.as('mlain_migrator').query(
      `INSERT INTO message_events (workspace_id, message_id, message_created_at,
         campaign_id, contact_id, recipient, type, rank, ts, source)
       VALUES (gen_random_uuid(), gen_random_uuid(), now(), gen_random_uuid(),
               gen_random_uuid(), 'a@b.cz', 'delivered', 99, now(), 'ses_sns')`))
      .rejects.toThrow(/non-DEFAULT value into column "rank"/i);
  });

  /**
   * Ochrana proti driftu škály. Ptá se KATALOGU dvakrát ze dvou nezávislých
   * míst: jednou na text omezení ck_message_events__type, podruhé na výraz
   * generovaného sloupce. Kdyby se ptal registru v TypeScriptu, ze kterého
   * obojí vzniklo, byl by slepý přesně vůči té chybě, kterou má chytat.
   *
   * Ověřeno, že test NENÍ slepý: po dopsání typu do CHECK bez odpovídajícího
   * ramene v CASE se množiny přestanou rovnat a test spadne.
   */
  it('každý povolený typ události má rameno ve škále rank a naopak', async () => {
    const { rows } = await h.as('mlain_migrator').query<{
      check_types: string[]; rank_arms: string[];
    }>(`
      WITH check_types AS (
        SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) AS t
          FROM regexp_matches(
                 (SELECT pg_get_constraintdef(oid) FROM pg_constraint
                   WHERE conname = 'ck_message_events__type'
                     AND conrelid = 'message_events'::regclass),
                 '''([a-z_]+)''', 'g') AS m
      ), rank_arms AS (
        SELECT array_agg(DISTINCT m[1] ORDER BY m[1]) AS t
          FROM regexp_matches(
                 (SELECT pg_get_expr(d.adbin, d.adrelid) FROM pg_attrdef d
                    JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
                   WHERE d.adrelid = 'message_events'::regclass AND a.attname = 'rank'),
                 '''([a-z_]+)''', 'g') AS m
      )
      SELECT (SELECT t FROM check_types) AS check_types,
             (SELECT t FROM rank_arms)   AS rank_arms`);
    expect(rows[0].rank_arms,
      'typ povolený v CHECK bez ramene v CASE dostane rank NULL a zápis spadne')
      .toEqual(rows[0].check_types);
    expect(rows[0].check_types).toHaveLength(12);
  });

  it('recipient je nepovinný, ale doručovací rodina ho mít musí', async () => {
    const { rows } = await h.as('mlain_migrator').query<{ is_nullable: string }>(
      `SELECT is_nullable FROM information_schema.columns
        WHERE table_name = 'message_events' AND column_name = 'recipient'`);
    expect(rows[0].is_nullable,
      'NOT NULL by kopírovalo osobní údaj na každý řádek desetimilionové tabulky')
      .toBe('YES');

    const partition = `message_events_${new Date().toISOString().slice(0, 7).replace('-', '_')}`;
    await createMonthlyPartitions(h.as('mlain_migrator'), 'message_events', new Date(), 1);

    // otevření bez adresy projde a dostane rank 0
    const { rows: opened } = await h.as('mlain_migrator').query<{ rank: number }>(
      `INSERT INTO message_events (workspace_id, message_id, message_created_at,
         campaign_id, contact_id, type, ts, source)
       VALUES (gen_random_uuid(), gen_random_uuid(), now(), gen_random_uuid(),
               gen_random_uuid(), 'open', now(), 'tracking')
       RETURNING rank`);
    expect(opened[0].rank).toBe(0);

    // doručení bez adresy musí selhat
    await expect(h.as('mlain_migrator').query(
      `INSERT INTO message_events (workspace_id, message_id, message_created_at,
         campaign_id, contact_id, type, ts, source)
       VALUES (gen_random_uuid(), gen_random_uuid(), now(), gen_random_uuid(),
               gen_random_uuid(), 'delivered', now(), 'ses_sns')`))
      .rejects.toThrow(/ck_message_events__recipient/);

    // a s adresou projde a dostane rank z katalogu P13
    const { rows: delivered } = await h.as('mlain_migrator').query<{ rank: number }>(
      `INSERT INTO message_events (workspace_id, message_id, message_created_at,
         campaign_id, contact_id, recipient, type, ts, source)
       VALUES (gen_random_uuid(), gen_random_uuid(), now(), gen_random_uuid(),
               gen_random_uuid(), 'a@b.cz', 'delivered', now(), 'ses_sns')
       RETURNING rank`);
    expect(delivered[0].rank).toBe(30);
    expect(partition).toMatch(/^message_events_\d{4}_\d{2}$/);
  });

  it('bounce index nad nepovinným recipient dál existuje a je částečný', async () => {
    const { rows } = await h.as('mlain_migrator').query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes
        WHERE tablename = 'message_events'
          AND indexname = 'idx_message_events__recipient_bounce'`);
    expect(rows[0].indexdef).toContain('WHERE');
    expect(rows[0].indexdef).toContain('bounced_soft');
  });
});
```

Import `createMonthlyPartitions` je v hlavičce souboru; bez oddílu by zápis do partitionované tabulky skončil chybou „no partition of relation found for row", ne na omezení, které test zkoumá.

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm --filter @mlain/db test:db -- test/partitioned-tables.test.ts`
Expected: FAIL, seznam partitionovaných tabulek je prázdný.

- [ ] **Step 3: Vytvoř ruční migraci a zapiš do ní tabulky platformy a outboxu**

Run: `cd /Users/petr/Projects/Mailing_Tool/packages/db && pnpm db:custom --name=partitioned_tables`

Do `migrations/0003_partitioned_tables.sql` zapiš:

```sql
-- mlain:timeout=300

-- ---------------------------------------------------------------------------
-- audit_log: append only, partitionovaný po měsících.
-- workspace_id je NULLABLE schválně: globální akce (přihlášení, změna hesla)
-- k žádnému projektu nepatří. Politika ws_isolation_audit z migrace 0004 na to
-- navazuje a bez ní by INSERT globálního záznamu shodil celou transakci.
-- ---------------------------------------------------------------------------
CREATE TABLE audit_log (
  id            uuid NOT NULL DEFAULT uuidv7(),
  workspace_id  uuid,
  actor_type    text NOT NULL,
  actor_id      uuid,
  actor_label   text NOT NULL DEFAULT '',
  action        text NOT NULL,
  target_type   text,
  target_id     uuid,
  ip            inet,
  user_agent    text,
  request_id    text,
  metadata      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at),
  CONSTRAINT ck_audit_log__actor_type CHECK (actor_type IN ('user','api_key','system'))
) PARTITION BY RANGE (created_at);
--> statement-breakpoint
-- Hlavní pohled: audit jednoho projektu v čase, nejnovější první.
CREATE INDEX idx_audit_log__ws_created ON audit_log (workspace_id, created_at DESC);
--> statement-breakpoint
-- Dohledání "co dělal tenhle aktér".
CREATE INDEX idx_audit_log__actor ON audit_log (actor_type, actor_id, created_at DESC);
--> statement-breakpoint

CREATE TABLE webhook_events (
  id           uuid NOT NULL DEFAULT uuidv7(),
  workspace_id uuid NOT NULL,
  type         text NOT NULL,
  payload      jsonb NOT NULL,
  occurred_at  timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
--> statement-breakpoint
CREATE INDEX idx_webhook_events__ws_created ON webhook_events (workspace_id, created_at DESC);
--> statement-breakpoint

CREATE TABLE webhook_deliveries (
  id                    uuid NOT NULL DEFAULT uuidv7(),
  workspace_id          uuid NOT NULL,
  endpoint_id           uuid NOT NULL,
  event_id              uuid NOT NULL,
  event_type            text NOT NULL,
  status                text NOT NULL DEFAULT 'pending',
  attempt               integer NOT NULL DEFAULT 0,
  next_attempt_at       timestamptz,
  response_status       integer,
  response_body_snippet text,
  duration_ms           integer,
  error_code            text,
  delivered_at          timestamptz,
  -- Partiční klíč A ZÁROVEŇ druhá složka klíče události. DEFAULT now() tu
  -- SCHVÁLNĚ není: hodnota se přebírá z webhook_events.created_at.
  created_at            timestamptz NOT NULL,
  PRIMARY KEY (id, created_at),
  CONSTRAINT ck_webhook_deliveries__status
    CHECK (status IN ('pending','delivering','succeeded','failed','abandoned'))
) PARTITION BY RANGE (created_at);
--> statement-breakpoint
CREATE INDEX idx_webhook_deliveries__endpoint
  ON webhook_deliveries (endpoint_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX idx_webhook_deliveries__event ON webhook_deliveries (event_id);
--> statement-breakpoint
-- Idempotence fan-outu. created_at v indexu je VYNUCENÉ: unikátní index na
-- partitionované tabulce musí obsahovat partiční klíč, takže (event_id, endpoint_id)
-- samo o sobě nejde vytvořit.
--
-- Index chrání POUZE proto, že created_at je deterministické (kopie
-- webhook_events.created_at, viz rozhodnutí R22). S DEFAULT now() by dva
-- fan-outy téže události prošly oba a příjemce by dostal webhook dvakrát.
-- Registr UNIQUE_INDEX_EXCEPTIONS v src/partitions.ts tenhle index vyjmenovává
-- i s důvodem a katalogový test v grants.test.ts to porovnává se skutečností.
CREATE UNIQUE INDEX uq_webhook_deliveries__event_endpoint
  ON webhook_deliveries (event_id, endpoint_id, created_at);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- messages: OUTBOX. Kontraktní podmnožinu vlastní zmrazený kontrakt
-- (část 1, 4.10.1). Název, typ ani sémantika kontraktního sloupce se NESMÍ
-- změnit. Přidávat sloupce a indexy dovoleno je.
-- ---------------------------------------------------------------------------
CREATE TABLE messages (
  id                  uuid        NOT NULL DEFAULT uuidv7(),
  workspace_id        uuid        NOT NULL,
  campaign_id         uuid,       -- NULL = nekampáňová zpráva, rezerva pro MVP 1
  content_variant_id  uuid,       -- NULL = obsah ze sloupců kampaně, rezerva pro MVP 1
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
  -- ck_messages__attempts ani ck_messages__sent_has_timestamp tu SCHVÁLNĚ
  -- NEJSOU (rozhodnutí R29). Kontrakt 4.10.1 povoluje přidávat sloupce
  -- a indexy, omezení ne. Cesta, která nastaví status bez časového razítka,
  -- by skončila chybou 23514 uvnitř senderu, tedy tvrdým selháním v běhu,
  -- kvůli kterému se kontrakt mrazí.
) PARTITION BY RANGE (created_at);
--> statement-breakpoint
-- Rezerva pro A/B test obsahu. Partitionovaná tabulka smí mít odchozí cizí klíč.
ALTER TABLE messages
  ADD CONSTRAINT fk_messages__campaign_content_variants
  FOREIGN KEY (content_variant_id)
  REFERENCES campaign_content_variants(id) ON DELETE SET NULL;
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- INVARIANT I1 SE VYNUCUJE ZDE (rozhodnutí R24), ne dokumentací.
--
-- uq_messages__campaign_contact obsahuje created_at, protože partiční klíč
-- v unikátním indexu být musí. Sám o sobě proto proti duplicitám NECHRÁNÍ:
-- messages.created_at má DEFAULT now(), takže první cesta, která zprávu vloží
-- bez explicitního created_at, index obejde a KONTAKT DOSTANE E-MAIL DVAKRÁT.
-- Nic přitom nespadne.
--
-- Složený cizí klíč to mění v tvrdou chybu 23503: zpráva smí existovat jen
-- s created_at rovným audience_built_at své kampaně. Ověřeno spuštěním na
-- PostgreSQL 18, včetně toho, že zápis s DEFAULT now() selže a že zprávy
-- s campaign_id IS NULL (testovací odeslání) cizí klíč nekontroluje.
--
-- audience_built_at je nullable, takže kampaň bez materializace nemůže být
-- cílem odkazu a zpráva k ní nevznikne. To je záměr, ne vedlejší účinek.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX uq_campaigns__id_audience_built_at
  ON campaigns (id, audience_built_at);
--> statement-breakpoint
ALTER TABLE messages
  ADD CONSTRAINT fk_messages__campaign_audience
  FOREIGN KEY (campaign_id, created_at)
  REFERENCES campaigns (id, audience_built_at);
--> statement-breakpoint
-- Claim dotaz senderu. campaign_id je první sloupec SCHVÁLNĚ: claim vždy běží
-- v rámci konkrétní běžící kampaně. Index (next_attempt_at, id) BEZ campaign_id
-- by znamenal, že pozastavená kampaň na 500 tisíc příjemců má nejstarší časy,
-- řadí se první, a každý claim jakékoliv jiné kampaně by musel projít
-- a zamknout jejích 500 tisíc řádků, než je join zahodí. Dvakrát za sekundu
-- na každý běžící sender.
CREATE INDEX idx_messages__claimable
  ON messages (campaign_id, next_attempt_at, id)
  WHERE status = 'pending';
--> statement-breakpoint
-- Reaper hledá zaseknuté claimy. Částečný index drží velikost v jednotkách řádků.
CREATE INDEX idx_messages__stuck ON messages (claim_expires_at) WHERE status = 'claimed';
--> statement-breakpoint
CREATE INDEX idx_messages__campaign_status ON messages (campaign_id, status);
--> statement-breakpoint
-- Deduplikace publika. created_at v indexu je VYNUCENÉ. Sám o sobě index
-- ochranu proti duplicitám NEDÁVÁ, dává ji až ve spojení s invariantem I1:
-- všechny řádky jednoho materializačního běhu mají created_at rovné
-- campaigns.audience_built_at.
CREATE UNIQUE INDEX uq_messages__campaign_contact
  ON messages (campaign_id, contact_id, created_at);
--> statement-breakpoint
-- Testovací odeslání se claimuje napříč kampaněmi a má přednost. Bez vlastního
-- indexu by test čekal za probíhající kampaní.
CREATE INDEX idx_messages__test_claimable ON messages (next_attempt_at)
  WHERE status = 'pending' AND kind = 'test';
--> statement-breakpoint
-- Párování příchozích událostí od providera na zprávu.
CREATE INDEX idx_messages__provider_message_id ON messages (provider_message_id)
  WHERE provider_message_id IS NOT NULL;
--> statement-breakpoint
-- Recovery pass při startu senderu a uvolnění zbytku dávky při shutdownu.
CREATE INDEX idx_messages__claimed_by ON messages (claimed_by) WHERE status = 'claimed';
--> statement-breakpoint
-- Vyškrtnutí pending zpráv při odhlášení nebo suppression konkrétní adresy.
-- Bez něj by odhlášení jednoho člověka skenovalo celou kampaň.
CREATE INDEX idx_messages__ws_email_pending ON messages (workspace_id, lower(email))
  WHERE status = 'pending';
--> statement-breakpoint
-- Přírůstkové čtení průběhu odesílání podle vodoznaku. Bez něj by se muselo
-- vrátit k událostem typu 'sent', tedy k milionu zápisů navíc na kampaň.
CREATE INDEX idx_messages__campaign_sent_at ON messages (campaign_id, sent_at)
  WHERE sent_at IS NOT NULL;
--> statement-breakpoint
-- Timeline kontaktu: "které kampaně dostal" napříč kampaněmi. Dnešní
-- uq_messages__campaign_contact je vedený od campaign_id, takže na tenhle
-- dotaz neodpoví, a GDPR výmaz i export dat subjektu by bez něj procházely
-- celou tabulku.
CREATE INDEX idx_messages__contact ON messages (workspace_id, contact_id, created_at DESC);
```

- [ ] **Step 4: Doplň do `0003_partitioned_tables.sql` tabulky událostí a trackingu**

Pokračuj ve stejném souboru za poslední `--> statement-breakpoint`:

```sql
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- message_events: append only. Partiční klíč je received_at, NE ts.
-- ts je hodnota od providera a nemáme nad ní kontrolu: SES pošle zpožděný bounce
-- s časovou značkou mimo existující okno, a protože výchozí partition
-- nezakládáme, zápis by TVRDĚ SELHAL a událost o doručení by se ztratila.
-- ---------------------------------------------------------------------------
CREATE TABLE message_events (
  id                 uuid        NOT NULL DEFAULT uuidv7(),
  workspace_id       uuid        NOT NULL,
  message_id         uuid        NOT NULL,
  message_created_at timestamptz NOT NULL,
  campaign_id        uuid        NOT NULL,
  contact_id         uuid,
  erased_at          timestamptz,
  -- NEPOVINNÝ (rozhodnutí R33). Povinnost drží ck_message_events__recipient
  -- jen pro doručovací rodinu, na které stojí bounce index. Tracking adresu
  -- k ničemu nepotřebuje a NOT NULL by ji rozmnožoval na každý řádek
  -- desetimilionové tabulky, odkud ji pak musí vybírat GDPR výmaz.
  recipient          text,
  type               text        NOT NULL,
  subtype            text,
  link_id            uuid,
  -- GENEROVANÝ (rozhodnutí R32). Hodnota je čistá funkce typu, takže ji
  -- nemá předávat volající: P13 tutéž škálu drží v katalogu a P10 na ni
  -- zapomněl úplně. Výraz nad literály je IMMUTABLE, takže je legální.
  --
  -- ŽÁDNÁ větev ELSE. Nový typ dopsaný do ck_message_events__type bez ramene
  -- tady dá NULL, NOT NULL ho odmítne a zápis spadne HLASITĚ. S ELSE 0 by
  -- událost tiše dostala rank, který neodpovídá ničemu, a odvození stavu
  -- zprávy by se rozpadlo beze stopy. Že se obě množiny kryjí, hlídá
  -- katalogový test v partitioned-tables.test.ts.
  rank smallint NOT NULL GENERATED ALWAYS AS (CASE type
      WHEN 'open'                 THEN 0
      WHEN 'click'                THEN 0
      WHEN 'unsubscribe'          THEN 0
      WHEN 'circuit_breaker_open' THEN 0
      WHEN 'sent'                 THEN 20
      WHEN 'delivery_delayed'     THEN 25
      WHEN 'delivered'            THEN 30
      WHEN 'bounced_soft'         THEN 60
      WHEN 'bounced_hard'         THEN 80
      WHEN 'complained'           THEN 85
      WHEN 'rejected'             THEN 90
      WHEN 'render_failed'        THEN 95
    END) STORED,
  ts                 timestamptz NOT NULL,
  received_at        timestamptz NOT NULL DEFAULT now(),
  source             text        NOT NULL,
  metadata           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (id, received_at),
  -- Registr vlastní část 4a. Výčet je sjednocení všeho, co kterákoliv část
  -- deklaruje, že zapisuje. Rozšíření je migrace CHECK, ne změna kontraktu.
  CONSTRAINT ck_message_events__type CHECK (type IN (
    'sent','rejected','delivered','delivery_delayed',
    'bounced_hard','bounced_soft','complained','render_failed',
    'open','click','unsubscribe','circuit_breaker_open')),
  CONSTRAINT ck_message_events__source
    CHECK (source IN ('ses_sns','smtp','internal','tracking')),
  -- Stejný vzor jako u web_events: řádek buď má subjekt, nebo je na něm vidět,
  -- že ho schválně nemá po výmazu. S contact_id NOT NULL by hook
  -- tracking.erase_contact skončil chybou 23514 u prvního kontaktu, který kdy
  -- něco otevřel, a výmaz by nikdy neproběhl.
  CONSTRAINT ck_message_events__subject
    CHECK (contact_id IS NOT NULL OR erased_at IS NOT NULL),
  -- Adresu musí mít doručovací rodina, protože na ní stojí bounce index
  -- a rozhodování o suppression. Otevření, proklik, odhlášení ani provozní
  -- událost ji nepotřebují. DEFAULT '' by byl NEPŘIJATELNÝ: prázdné řetězce
  -- by se dostaly do bounce indexu a suppression by pracovala s tichým
  -- nesmyslem. Ověřeno spuštěním: 'delivered' bez adresy skončí chybou
  -- tohohle omezení, 'open' bez adresy projde.
  CONSTRAINT ck_message_events__recipient
    CHECK (type NOT IN ('sent','rejected','delivered','delivery_delayed',
                        'bounced_hard','bounced_soft','complained','render_failed')
           OR recipient IS NOT NULL)
) PARTITION BY RANGE (received_at);
--> statement-breakpoint
-- Timeline jedné zprávy. Obě složky klíče, aby šlo z události skočit na zprávu
-- jedním přístupem do jedné partition.
CREATE INDEX idx_message_events__message
  ON message_events (message_id, message_created_at, ts);
--> statement-breakpoint
CREATE INDEX idx_message_events__campaign_type
  ON message_events (workspace_id, campaign_id, type, ts DESC);
--> statement-breakpoint
CREATE INDEX idx_message_events__contact
  ON message_events (workspace_id, contact_id, ts DESC);
--> statement-breakpoint
-- Rozhodování o suppression podle historie adresy. Bez něj by se počítání
-- soft bounců muselo joinovat na messages přes obě partition.
CREATE INDEX idx_message_events__recipient_bounce
  ON message_events (workspace_id, lower(recipient), ts)
  WHERE type IN ('bounced_soft','bounced_hard','complained');
--> statement-breakpoint
-- Typy, které se nemají opakovat. Index je SCHVÁLNĚ NEUNIKÁTNÍ (rozhodnutí R22).
--
-- Unikátní být nemůže: partiční klíč received_at musí být jeho složkou a je to
-- now(), takže dva zápisy téže události v různý čas jsou dvě různé hodnoty
-- a projdou OBĚ. Unikátní index by tedy sliboval ochranu, kterou nemá, a to je
-- horší než žádná: dvakrát započtený odraz a stížnost rozjedou statistiky
-- kampaně a nikdo nebude vědět proč.
--
-- Deduplikaci NESE provider_event_receipts přes explicitní
-- WHERE NOT EXISTS nad prefixem (workspace_id, dedup_key), viz test
-- "dedup příchozích událostí" v contract-sql.test.ts. Tenhle index slouží
-- tomu dotazu a výpisu historie adresy.
CREATE INDEX idx_message_events__once_per_message
  ON message_events (message_id, type, received_at)
  WHERE type IN ('sent','delivered','bounced_hard','bounced_soft','complained');
--> statement-breakpoint

CREATE TABLE provider_event_receipts (
  id                 uuid        NOT NULL DEFAULT uuidv7(),
  workspace_id       uuid        NOT NULL,
  provider_id        uuid        NOT NULL,
  dedup_key          text        NOT NULL,
  sns_message_id     text,
  event_type         text        NOT NULL,
  message_id         uuid,
  message_created_at timestamptz,
  received_at        timestamptz NOT NULL DEFAULT now(),
  processed_at       timestamptz,
  status             text        NOT NULL DEFAULT 'received',
  raw                jsonb       NOT NULL,
  PRIMARY KEY (id, received_at),
  CONSTRAINT ck_provider_event_receipts__status
    CHECK (status IN ('received','processed','unmatched','invalid'))
) PARTITION BY RANGE (received_at);
--> statement-breakpoint
-- received_at v unikátním indexu je VYNUCENÉ, ne volba. Je to jedna ze čtyř
-- evidovaných výjimek v UNIQUE_INDEX_EXCEPTIONS (rozhodnutí R22). Důsledek:
-- received_at je now(), tedy u každého doručení jiné, takže samotný
-- ON CONFLICT by NIKDY nesepnul. Skutečnou deduplikaci dělá explicitní WHERE NOT EXISTS nad prefixem
-- (workspace_id, dedup_key); ON CONFLICT zůstává jen jako pojistka proti dvěma
-- workerům ve stejné mikrosekundě.
CREATE UNIQUE INDEX uq_provider_event_receipts__dedup
  ON provider_event_receipts (workspace_id, dedup_key, received_at);
--> statement-breakpoint
CREATE INDEX idx_provider_event_receipts__unmatched
  ON provider_event_receipts (received_at) WHERE status = 'unmatched';
--> statement-breakpoint

CREATE TABLE inbound_deliveries (
  id            uuid        NOT NULL DEFAULT uuidv7(),
  workspace_id  uuid        NOT NULL,
  endpoint_id   uuid        NOT NULL,
  external_id   text,
  status        text        NOT NULL,
  error_code    text,
  error_detail  text,
  contact_id    uuid,
  action        text,
  payload       jsonb       NOT NULL,
  headers       jsonb       NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  PRIMARY KEY (id, created_at),
  CONSTRAINT ck_inbound_deliveries__status CHECK (status IN
    ('received','processed','ignored','unmapped','rejected','failed'))
) PARTITION BY RANGE (created_at);
--> statement-breakpoint
CREATE UNIQUE INDEX uq_inbound_deliveries__dedup
  ON inbound_deliveries (endpoint_id, external_id, created_at)
  WHERE external_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX idx_inbound_deliveries__endpoint_created
  ON inbound_deliveries (endpoint_id, created_at DESC);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- web_events. Dva časy a rozdíl mezi nimi je podstatný pro každý dotaz:
-- occurred_at je kdy se událost stala, received_at kdy dorazila k nám.
-- Partition se prořezávají podle received_at, ale timeline řadí podle
-- occurred_at, a ty se rozcházejí až o 7 dní. Dotaz na okno podle occurred_at
-- proto MUSÍ nést i podmínku na received_at, jinak se prohledají všechny.
-- ---------------------------------------------------------------------------
CREATE TABLE web_events (
  id                uuid        NOT NULL,
  received_at       timestamptz NOT NULL DEFAULT now(),
  occurred_at       timestamptz NOT NULL,
  workspace_id      uuid        NOT NULL,
  name              text        NOT NULL,
  anonymous_id      uuid,
  contact_id        uuid,
  session_id        uuid,
  source            text        NOT NULL DEFAULT 'web',
  page              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  properties        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  context           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  identity_merge_id uuid,
  erased_at         timestamptz,
  PRIMARY KEY (id, received_at),
  CONSTRAINT ck_web_events__source
    CHECK (source IN ('web','server','email','automation','import')),
  CONSTRAINT ck_web_events__name CHECK (name ~ '^[a-z][a-z0-9_]{0,63}$'),
  -- erased_at je v CHECK schválně. Serverová událost má vyplněné jen contact_id
  -- a výmaz ho nastavuje na NULL, takže bez třetího legitimního stavu by
  -- u každé takové události skončil chybou 23514 a výchozí režim výmazu
  -- by nikdy neproběhl.
  CONSTRAINT ck_web_events__subject CHECK (
    anonymous_id IS NOT NULL OR contact_id IS NOT NULL OR erased_at IS NOT NULL),
  -- Okno mezi vznikem a doručením. Platí pro ŽIVÉ zdroje. Dávkový import
  -- historie je z něj vyňatý, protože u něj se received_at odvozuje
  -- z occurred_at, aby řádek padl do oddílu podle času vzniku.
  CONSTRAINT ck_web_events__lag CHECK (
    source = 'import' OR (
      occurred_at >  received_at - interval '7 days' AND
      occurred_at <= received_at + interval '60 seconds'))
) PARTITION BY RANGE (received_at);
--> statement-breakpoint
-- 1. Timeline kontaktu. Nejčastější dotaz produktu.
CREATE INDEX idx_web_events__contact_occurred
  ON web_events (workspace_id, contact_id, occurred_at DESC)
  WHERE contact_id IS NOT NULL;
--> statement-breakpoint
-- 2. Anonymní timeline a vyhledání událostí k doplnění při slučování identit.
CREATE INDEX idx_web_events__anon_occurred
  ON web_events (workspace_id, anonymous_id, occurred_at DESC)
  WHERE anonymous_id IS NOT NULL;
--> statement-breakpoint
-- 3. Analytika a segmentace typu "kdo udělal X za posledních N dní".
CREATE INDEX idx_web_events__name_occurred
  ON web_events (workspace_id, name, occurred_at DESC);
--> statement-breakpoint
-- 4. Vrácení slučování identit. Řídký, malý.
CREATE INDEX idx_web_events__merge ON web_events (identity_merge_id)
  WHERE identity_merge_id IS NOT NULL;
--> statement-breakpoint
-- 5. Session detail v timeline.
CREATE INDEX idx_web_events__session ON web_events (workspace_id, session_id, occurred_at)
  WHERE session_id IS NOT NULL;
--> statement-breakpoint
-- 6. Deduplikace v aplikačním okně 7 dní. Klíč (id, received_at) opakování
-- nezachytí, protože received_at se pokaždé liší.
CREATE INDEX idx_web_events__dedup ON web_events (workspace_id, id);
--> statement-breakpoint
-- GIN index nad properties se v MVP 0 NEZAKLÁDÁ: u tabulky s desítkami milionů
-- řádků výrazně zpomaluje zápis a nic nad properties zatím nefiltruje.

CREATE TABLE message_engagement (
  message_id           uuid        NOT NULL,
  created_at           timestamptz NOT NULL,
  workspace_id         uuid        NOT NULL,
  campaign_id          uuid        NOT NULL,
  contact_id           uuid,
  erased_at            timestamptz,
  first_open_at        timestamptz,
  last_open_at         timestamptz,
  open_count           integer     NOT NULL DEFAULT 0,
  first_human_open_at  timestamptz,
  human_open_count     integer     NOT NULL DEFAULT 0,
  open_class_mask      integer     NOT NULL DEFAULT 0,
  first_click_at       timestamptz,
  last_click_at        timestamptz,
  click_count          integer     NOT NULL DEFAULT 0,
  first_human_click_at timestamptz,
  human_click_count    integer     NOT NULL DEFAULT 0,
  clicked_links        integer     NOT NULL DEFAULT 0,
  PRIMARY KEY (message_id, created_at),
  CONSTRAINT ck_message_engagement__subject
    CHECK (contact_id IS NOT NULL OR erased_at IS NOT NULL)
) PARTITION BY RANGE (created_at);
--> statement-breakpoint
-- Rekonstrukce campaign_stats po havárii a exporty "kdo otevřel".
CREATE INDEX idx_message_engagement__campaign
  ON message_engagement (workspace_id, campaign_id)
  INCLUDE (first_open_at, first_click_at);
--> statement-breakpoint
-- Segmenty "otevřel libovolnou kampaň za posledních N dní". Částečný, takže
-- vymazaný řádek s contact_id IS NULL do dotazů podle kontaktu nespadne.
CREATE INDEX idx_message_engagement__contact
  ON message_engagement (workspace_id, contact_id, first_open_at DESC)
  WHERE first_open_at IS NOT NULL;
```

- [ ] **Step 5: Spusť test a ověř, že projde**

Run: `pnpm --filter @mlain/db test:db -- test/partitioned-tables.test.ts`
Expected: PASS, 11 testů (7 původních plus 4 na `rank`, `recipient` a škálu událostí).

- [ ] **Step 6: Commit**

```bash
git add packages/db/migrations packages/db/test/partitioned-tables.test.ts
git commit -m "feat(db): migration 0003 creates nine partitioned tables"
```

---

### Task 17: Utility pro DDL za běhu: partitionování a indexy nad vlastními poli

**Files:**
- Modify: `packages/db/src/partitions.ts`
- Create: `packages/db/test/partitions.test.ts`

`packages/db` je **jediné místo, kde se DDL partition generuje.** Parametr `column` je povinný, protože ne všechny tabulky partitionují podle `created_at`. Parametr `veto` u odpojování je povinný taky, a bez něj funkce odmítne cokoliv odpojit.

- [ ] **Step 1: Napiš padající testy**

```ts
// packages/db/test/partitions.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './helpers/container.js';
import {
  PARTITIONED_REFERENCES, PARTITIONED_TABLES, UNIQUE_INDEX_EXCEPTIONS,
  createIndexConcurrentlyOnPartitioned, createMonthlyPartitions, dropPartitionsBefore,
  ensurePartitionsForRange, ensureUpcomingPartitions, partitionName,
} from '../src/partitions.js';
import { seedTwoWorkspaces } from './helpers/fixtures.js';

let h: Harness;
beforeAll(async () => { h = await startHarness(); }, 180_000);
afterAll(async () => { await h.stop(); });

describe('registr partitionovaných tabulek', () => {
  it('obsahuje devět tabulek a u každé partiční sloupec', () => {
    expect(PARTITIONED_TABLES).toHaveLength(9);
    const byName = Object.fromEntries(PARTITIONED_TABLES.map((t) => [t.table, t.column]));
    expect(byName.messages).toBe('created_at');
    expect(byName.message_events).toBe('received_at');
    expect(byName.provider_event_receipts).toBe('received_at');
    expect(byName.web_events).toBe('received_at');
    expect(byName.message_engagement).toBe('created_at');
    expect(byName.inbound_deliveries).toBe('created_at');
    expect(byName.audit_log).toBe('created_at');
  });

  it('registr sedí na skutečný stav databáze', async () => {
    const { rows } = await h.as('mlain_migrator').query<{ relname: string; col: string }>(
      `SELECT c.relname, a.attname AS col
         FROM pg_partitioned_table p
         JOIN pg_class c ON c.oid = p.partrelid
         JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = p.partattrs[0]`,
    );
    const actual = Object.fromEntries(rows.map((r) => [r.relname, r.col]));
    for (const { table, column } of PARTITIONED_TABLES) {
      expect(actual[table], `${table} chybí nebo partitionuje jinak`).toBe(column);
    }
    expect(Object.keys(actual)).toHaveLength(PARTITIONED_TABLES.length);
  });

  it('každý odkaz na partitionovanou tabulku nese obě složky klíče', async () => {
    // Test se řídí REGISTREM, ne jmenovitým výčtem. Dokud kontroloval jen
    // message_events, chyběla druhá složka u webhook_deliveries.event_id
    // i u inbound_dedup.delivery_id a nikdo si toho nevšiml. Načtení payloadu
    // při opakovaném pokusu tedy procházelo všechny oddíly.
    for (const ref of PARTITIONED_REFERENCES) {
      const { rows } = await h.as('mlain_migrator').query<{ is_nullable: string }>(
        `SELECT is_nullable FROM information_schema.columns
          WHERE table_name = $1 AND column_name = $2`, [ref.from, ref.secondColumn]);
      expect(rows, `${ref.from}.${ref.secondColumn} chybí, odkaz na ${ref.to} `
        + `by prohledal všechny oddíly`).toHaveLength(1);
      expect(rows[0].is_nullable,
        `${ref.from}.${ref.secondColumn} je nullable, klíč by byl neúplný`)
        .toBe(ref.nullable ? 'YES' : 'NO');
    }
  });

  it('žádný unikátní index partitionované tabulky nestojí na sloupci s DEFAULT now()',
    async () => {
      // Katalogová kontrola rozhodnutí R22. Unikátní index, jehož složkou je
      // now(), NEGARANTUJE NIC: dva zápisy téže věci v různý čas projdou oba.
      // Výjimky jsou pojmenované a odůvodněné v registru; cokoli mimo něj
      // je nový výskyt téže chyby.
      const { rows } = await h.as('mlain_migrator').query<
        { tabulka: string; idx: string; sloupec: string }
      >(`SELECT c.relname AS tabulka, i.relname AS idx, a.attname AS sloupec
           FROM pg_index x
           JOIN pg_class i ON i.oid = x.indexrelid
           JOIN pg_class c ON c.oid = x.indrelid
           JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY (x.indkey)
           JOIN pg_attrdef d ON d.adrelid = c.oid AND d.adnum = a.attnum
          WHERE c.relkind = 'p' AND x.indisunique AND NOT x.indisprimary
            AND pg_get_expr(d.adbin, d.adrelid) ILIKE '%now()%'
          ORDER BY 2`);
      const nezname = rows
        .map((r) => r.idx)
        .filter((idx) => !UNIQUE_INDEX_EXCEPTIONS.some((e) => e.index === idx));
      expect(nezname, 'unikátní index nad sloupcem s DEFAULT now() bez evidované '
        + 'výjimky slibuje ochranu, kterou nemá').toEqual([]);

      // A opačně: evidovaná výjimka, která zmizela, se má z registru smazat,
      // jinak registr přestane popisovat skutečnost.
      for (const vyjimka of UNIQUE_INDEX_EXCEPTIONS) {
        expect(rows.map((r) => r.idx), `výjimka ${vyjimka.index} už neexistuje`)
          .toContain(vyjimka.index);
      }
    });
});

describe('zakládání partition', () => {
  it('název partition má tvar <tabulka>_yYYYYmMM', () => {
    expect(partitionName('web_events', new Date('2026-08-15T00:00:00Z')))
      .toBe('web_events_y2026m08');
    expect(partitionName('messages', new Date('2027-01-01T00:00:00Z')))
      .toBe('messages_y2027m01');
  });

  it('založí partition na aktuální a další tři měsíce pro všech devět tabulek', async () => {
    await ensureUpcomingPartitions(h.as('mlain_migrator'), new Date('2026-08-15T00:00:00Z'), 4);
    const { rows } = await h.as('mlain_migrator').query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_class c
         JOIN pg_inherits i ON i.inhrelid = c.oid
        WHERE c.relname LIKE '%\\_y2026m%' OR c.relname LIKE '%\\_y2027m%'`,
    );
    expect(rows[0].n).toBeGreaterThanOrEqual(9 * 4);
  });

  it('je idempotentní, druhý běh nezaloží nic navíc a nespadne', async () => {
    const count = async () => {
      const { rows } = await h.as('mlain_migrator').query<{ n: number }>(
        `SELECT count(*)::int AS n FROM pg_inherits`);
      return rows[0].n;
    };
    const before = await count();
    await ensureUpcomingPartitions(h.as('mlain_migrator'), new Date('2026-08-15T00:00:00Z'), 4);
    expect(await count()).toBe(before);
  });

  it('partition messages dostane fillfactor a agresivnější autovacuum', async () => {
    await createMonthlyPartitions(
      h.as('mlain_migrator'), 'messages', 'created_at', new Date('2026-08-01T00:00:00Z'), 1,
      { fillfactor: 70, autovacuumVacuumScaleFactor: 0.02, autovacuumVacuumThreshold: 1000,
        autovacuumAnalyzeScaleFactor: 0.02, autovacuumVacuumCostDelay: 0 },
    );
    const { rows } = await h.as('mlain_migrator').query<{ reloptions: string[] }>(
      `SELECT reloptions FROM pg_class WHERE relname = 'messages_y2026m08'`,
    );
    expect(rows[0].reloptions.join(',')).toContain('fillfactor=70');
    expect(rows[0].reloptions.join(',')).toContain('autovacuum_vacuum_scale_factor=0.02');
  });

  it('nová partition NENÍ přímo přístupná žádné roli kromě migrátora (R20)', async () => {
    // Původní znění kritéria AK-20.2 znělo opačně („nová partition je pro
    // sender čitelná") a bylo jediným důvodem existence copyGrantsFromParent.
    // Sender ale žádný oddíl jménem nečte, zato kopie grantů obcházela RLS:
    // oddíl nedědí relrowsecurity ani politiky, takže s granty se z něj daly
    // číst řádky všech projektů.
    await createMonthlyPartitions(
      h.as('mlain_migrator'), 'messages', 'created_at', new Date('2027-06-01T00:00:00Z'), 1);

    for (const role of ['mlain_app', 'mlain_sender'] as const) {
      await expect(
        h.as(role).query('SELECT count(*) FROM messages_y2027m06'),
        `${role} se dostane přímo na oddíl`,
      ).rejects.toThrow(/permission denied/i);
    }
    // Přístup přes rodiče přitom funguje dál. Práva se kontrolují na relaci,
    // na kterou dotaz míří, takže kopie grantů na oddíly není k ničemu potřeba.
    await expect(
      h.as('mlain_sender').query('SELECT count(*) FROM messages'),
    ).resolves.toBeDefined();
  });

  it('žádný oddíl nemá ACL záznam, a je to zjištěné z katalogu', async () => {
    // Kontrola se NEPTÁ seznamu tabulek v kódu, ale pg_class. Pevný seznam
    // by se se schématem tiše rozešel, protože oddíly vznikají za běhu.
    await ensureUpcomingPartitions(
      h.as('mlain_migrator'), new Date('2026-08-15T00:00:00Z'), 4);
    const { rows } = await h.as('mlain_migrator').query<{ relname: string; acl: string }>(
      `SELECT c.relname, c.relacl::text AS acl
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relispartition AND c.relacl IS NOT NULL`);
    expect(rows.map((r) => `${r.relname}: ${r.acl}`)).toEqual([]);
  });

  it('hranice oddílu je v UTC bez ohledu na časovou zónu spojení', async () => {
    // FOR VALUES FROM ('2026-08-01') se přetypuje podle TimeZone spojení.
    // Oddíl založený pod Europe/Prague začíná v 2026-07-31 22:00+00 a mezi
    // ním a dalším měsícem založeným pod UTC zůstane dvouhodinová DÍRA.
    // Zápis do ní tvrdě selže, protože výchozí oddíl se nezakládá, a ztracené
    // řádky jsou právě ty, které se ztratit nesmí: odrazy a stížnosti.
    const client = await h.as('mlain_migrator').connect();
    try {
      await client.query(`SET TimeZone = 'Europe/Prague'`);
      await createMonthlyPartitions(
        client, 'web_events', 'received_at', new Date('2027-03-01T00:00:00Z'), 1);
      const { rows } = await client.query<{ bound: string }>(
        `SELECT pg_get_expr(relpartbound, oid) AS bound
           FROM pg_class WHERE relname = 'web_events_y2027m03'`);
      expect(rows[0].bound).toContain(`'2027-03-01 00:00:00+00'`);
      expect(rows[0].bound).toContain(`'2027-04-01 00:00:00+00'`);
    } finally {
      client.release();
    }
  });

  it('doplní chybějící oddíly pro zpětný rozsah, kvůli dávkovému importu historie',
    async () => {
      const created = await ensurePartitionsForRange(
        h.as('mlain_migrator'), 'web_events', 'received_at',
        new Date('2025-11-01T00:00:00Z'), new Date('2026-02-01T00:00:00Z'));
      expect(created).toEqual([
        'web_events_y2025m11', 'web_events_y2025m12', 'web_events_y2026m01',
      ]);
    });

  it('výchozí partition se nezakládá nikdy', async () => {
    const { rows } = await h.as('mlain_migrator').query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_class c
        WHERE pg_get_expr(c.relpartbound, c.oid) = 'DEFAULT'`);
    expect(rows[0].n).toBe(0);
  });
});

describe('odpojování partition', () => {
  it('bez veto predikátu odmítne cokoliv odpojit', async () => {
    await expect(
      dropPartitionsBefore(h.as('mlain_migrator'), 'messages', 'created_at',
        new Date('2027-01-01T00:00:00Z'), undefined as never),
    ).rejects.toThrow(/veto/i);
  });

  it('třífázový index nad partitionovanou tabulkou vznikne platný', async () => {
    // Jediný povolený postup pro index nad tabulkou s daty. Prosté CREATE INDEX
    // na rodiči zamkne tabulku i všechny oddíly na dobu stavby, takže první
    // upgradová migrace nad velkou instalací skončí na lock_timeout.
    await createMonthlyPartitions(
      h.as('mlain_migrator'), 'web_events', 'received_at',
      new Date('2027-09-01T00:00:00Z'), 2);
    await createIndexConcurrentlyOnPartitioned(h.as('mlain_migrator'), {
      parent: 'web_events',
      indexName: 'idx_web_events__probe_session',
      definition: '(workspace_id, session_id)',
    });
    const { rows } = await h.as('mlain_migrator').query<{ indisvalid: boolean }>(
      `SELECT indisvalid FROM pg_index
        WHERE indexrelid = 'idx_web_events__probe_session'::regclass`);
    expect(rows[0].indisvalid, 'index rodiče zůstal neplatný, chybí ATTACH').toBe(true);
  });

  it('veto zabrání odpojení partition, ve které leží nedoručená zpráva', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    await createMonthlyPartitions(
      h.as('mlain_migrator'), 'messages', 'created_at', new Date('2026-09-01T00:00:00Z'), 1);
    await h.as('mlain_migrator').query(
      `INSERT INTO messages (workspace_id, contact_id, email, status, created_at)
       VALUES ($1, $2, 'a@example.test', 'pending', '2026-09-15T00:00:00Z')`,
      [ws.workspaceA, ws.contactInA]);

    const dropped = await dropPartitionsBefore(
      h.as('mlain_migrator'), 'messages', 'created_at', new Date('2026-10-01T00:00:00Z'),
      async (client, from, to) => {
        const { rows } = await client.query(
          `SELECT 1 FROM messages
            WHERE created_at >= $1 AND created_at < $2
              AND status IN ('pending','claimed') LIMIT 1`, [from, to]);
        return rows.length === 0; // true = smí se odpojit
      },
    );
    expect(dropped).not.toContain('messages_y2026m09');
    const { rows } = await h.as('mlain_migrator').query(
      `SELECT to_regclass('public.messages_y2026m09') AS t`);
    expect(rows[0].t).not.toBeNull();
  });
});
```

- [ ] **Step 2: Spusť testy a ověř, že spadnou**

Run: `pnpm --filter @mlain/db test:db -- test/partitions.test.ts`
Expected: FAIL, `PARTITIONED_TABLES is not exported`.

- [ ] **Step 3: Napiš `src/partitions.ts`**

```ts
// packages/db/src/partitions.ts
import type { Client, Pool } from 'pg';

export type Queryable = Pick<Client | Pool, 'query'>;

export type PartitionedTable = { table: string; column: string; owner: string };

/**
 * ÚPLNÝ registr partitionovaných tabulek. Kdo přidá partitionovanou tabulku
 * a nezapíše ji sem, dostane selhání zápisu od první minuty provozu, protože
 * výchozí partition je zakázaná. Test partitions.test.ts registr porovnává
 * s pg_partitioned_table, takže rozejít se nemůžou tiše.
 *
 * Partitioning sloupec MUSÍ být čas, který generujeme my. Nikdy ne `ts`
 * z message_events ani occurred_at z web_events: obojí dodává třetí strana
 * a hodnota mimo existující okno by zápis tvrdě položila.
 */
export const PARTITIONED_TABLES: readonly PartitionedTable[] = [
  { table: 'audit_log',               column: 'created_at',  owner: 'platform' },
  { table: 'webhook_events',          column: 'created_at',  owner: 'platform' },
  { table: 'webhook_deliveries',      column: 'created_at',  owner: 'platform' },
  { table: 'messages',                column: 'created_at',  owner: 'campaigns' },
  { table: 'message_events',          column: 'received_at', owner: 'campaigns' },
  { table: 'provider_event_receipts', column: 'received_at', owner: 'campaigns' },
  { table: 'inbound_deliveries',      column: 'created_at',  owner: 'contacts' },
  { table: 'web_events',              column: 'received_at', owner: 'tracking' },
  { table: 'message_engagement',      column: 'created_at',  owner: 'tracking' },
];

/**
 * ÚPLNÝ registr odkazů na partitionované tabulky (rozhodnutí R24).
 *
 * Každý odkaz musí nést OBĚ složky složeného klíče, jinak dohledání projde
 * všechny oddíly. `WHERE id = $1` vypadá jako správný dotaz a chová se špatně
 * teprve na objemu dat, tedy až u zákazníka.
 *
 * Test partitions.test.ts porovnává tenhle registr s information_schema,
 * takže nový odkaz bez druhé složky spadne v CI. Dokud se test řídil
 * jmenovitým výčtem, chyběly obě položky níž a nikdo si toho nevšiml.
 */
export type PartitionedReference = {
  from: string;
  /** Sloupec s první složkou klíče. */
  column: string;
  to: string;
  /** Sloupec s druhou složkou, tedy s partičním klíčem cílové tabulky. */
  secondColumn: string;
  nullable?: boolean;
};

export const PARTITIONED_REFERENCES: readonly PartitionedReference[] = [
  { from: 'message_events', column: 'message_id', to: 'messages',
    secondColumn: 'message_created_at' },
  { from: 'message_engagement', column: 'message_id', to: 'messages',
    secondColumn: 'created_at' },
  // Doručení nese čas události, ne čas svého vzniku. Je to zároveň jeho
  // partiční klíč, viz komentář u tabulky a rozhodnutí R22.
  { from: 'webhook_deliveries', column: 'event_id', to: 'webhook_events',
    secondColumn: 'created_at' },
  { from: 'inbound_dedup', column: 'delivery_id', to: 'inbound_deliveries',
    secondColumn: 'delivery_created_at' },
  // Účtenka se na zprávu spáruje až po dohledání, takže obě složky jsou
  // nullable společně.
  { from: 'provider_event_receipts', column: 'message_id', to: 'messages',
    secondColumn: 'message_created_at', nullable: true },
];

/**
 * Evidované výjimky z pravidla R22 („unikátní index partitionované tabulky
 * nesmí stát na sloupci s DEFAULT now()").
 *
 * Každá položka musí říct, co ochranu nese MÍSTO indexu. Bez toho je to
 * jen seznam míst, kde pravidlo neplatí.
 */
export const UNIQUE_INDEX_EXCEPTIONS: ReadonlyArray<{ index: string; reason: string }> = [
  {
    index: 'uq_messages__campaign_contact',
    reason: 'created_at není volné now(): invariant I1 ho váže cizím klíčem '
      + 'fk_messages__campaign_audience na campaigns.audience_built_at.',
  },
  {
    index: 'uq_provider_event_receipts__dedup',
    reason: 'skutečnou deduplikaci dělá explicitní WHERE NOT EXISTS nad prefixem '
      + '(workspace_id, dedup_key); index je jen pojistka proti dvěma workerům '
      + 've stejné mikrosekundě.',
  },
  {
    index: 'uq_inbound_deliveries__dedup',
    reason: 'skutečnou deduplikaci nese nepartitionovaná tabulka inbound_dedup '
      + 's primárním klíčem (workspace_id, endpoint_id, external_id).',
  },
];

/** Úložné parametry na partition. Na partitionované tabulce jako celku je
 *  nastavit nejde, propisují se jen na nově zakládané partition. */
export type StorageOptions = {
  fillfactor?: number;
  autovacuumVacuumScaleFactor?: number;
  autovacuumVacuumThreshold?: number;
  autovacuumAnalyzeScaleFactor?: number;
  autovacuumVacuumCostDelay?: number;
};

/**
 * messages se za život řádku nejméně třikrát přepíše (claim, marker, výsledek).
 * HOT update se NEUPLATNÍ, protože se pokaždé mění indexovaný sloupec, včetně
 * sloupce v predikátu částečného indexu. Nižší fillfactor přesto pomáhá,
 * ale z jiného důvodu: nová verze řádku se vejde do téže stránky, takže se
 * nenafukuje počet stránek a sekvenční čtení reportu zůstane rychlé.
 * Bez agresivnějšího autovacuum degraduje claim v průběhu kampaně: mrtvé verze
 * zůstávají v částečném indexu idx_messages__claimable a claim je přeskakuje.
 */
export const MESSAGES_STORAGE: StorageOptions = {
  fillfactor: 70,
  autovacuumVacuumScaleFactor: 0.02,
  autovacuumVacuumThreshold: 1000,
  autovacuumAnalyzeScaleFactor: 0.02,
  autovacuumVacuumCostDelay: 0,
};

const IDENT = /^[a-z_][a-z0-9_]*$/;
function assertIdent(value: string, what: string): string {
  if (!IDENT.test(value)) throw new Error(`nepovolený identifikátor ${what}: ${value}`);
  return value;
}

function monthStart(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}
function addMonths(date: Date, months: number): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}
/** Hranice oddílu jako výslovný okamžik v UTC, nikdy jen datum. */
function isoBoundary(date: Date): string {
  return `${date.toISOString().slice(0, 10)} 00:00:00+00`;
}

export function partitionName(table: string, month: Date): string {
  const start = monthStart(month);
  const yyyy = String(start.getUTCFullYear());
  const mm = String(start.getUTCMonth() + 1).padStart(2, '0');
  return `${table}_y${yyyy}m${mm}`;
}

function storageClause(options: StorageOptions): string {
  const parts: string[] = [];
  if (options.fillfactor !== undefined) parts.push(`fillfactor = ${options.fillfactor}`);
  if (options.autovacuumVacuumScaleFactor !== undefined)
    parts.push(`autovacuum_vacuum_scale_factor = ${options.autovacuumVacuumScaleFactor}`);
  if (options.autovacuumVacuumThreshold !== undefined)
    parts.push(`autovacuum_vacuum_threshold = ${options.autovacuumVacuumThreshold}`);
  if (options.autovacuumAnalyzeScaleFactor !== undefined)
    parts.push(`autovacuum_analyze_scale_factor = ${options.autovacuumAnalyzeScaleFactor}`);
  if (options.autovacuumVacuumCostDelay !== undefined)
    parts.push(`autovacuum_vacuum_cost_delay = ${options.autovacuumVacuumCostDelay}`);
  return parts.join(', ');
}

/**
 * ODDÍL NEDOSTÁVÁ ŽÁDNÝ GRANT. Rozhodnutí R20.
 *
 * Dřívější verze plánu tu měla funkci copyGrantsFromParent, která kopírovala
 * práva z rodiče. Byla to díra vedle celé vrstvy RLS: `CREATE TABLE ...
 * PARTITION OF` nedědí relrowsecurity ani politiky, takže oddíl s granty se dal
 * adresovat přímo a vrátil řádky VŠECH projektů. U audit_log šlo přímým
 * DELETE z oddílu smazat i cizí a globální záznamy.
 *
 * Ověřeno spuštěním na PostgreSQL 18: bez grantu na oddílu skončí přímý dotaz
 * `permission denied for table <oddíl>`, zatímco dotaz přes rodiče projde
 * a politika rodiče na něm platí. Práva se kontrolují na relaci, na kterou
 * dotaz míří, takže kopie grantů není k ničemu potřeba.
 *
 * Aplikace ani sender žádný oddíl jménem nečtou a číst nesmí. Hlídá to
 * katalogový test nad pg_class.relacl, ne komentář.
 */

/**
 * Zajistí existenci měsíčních partition. Idempotentní: partition, která už
 * existuje, se přeskočí. Výchozí partition se NEZAKLÁDÁ NIKDY: zápis mimo
 * existující okno má selhat hlasitě, ne skončit v koši, ze kterého se pak
 * nedá odpojit rozsah.
 */
export async function createMonthlyPartitions(
  client: Queryable,
  table: string,
  column: string,
  from: Date,
  months: number,
  storageOptions?: StorageOptions,
): Promise<string[]> {
  assertIdent(table, 'tabulka');
  assertIdent(column, 'sloupec');
  const created: string[] = [];
  const first = monthStart(from);

  for (let offset = 0; offset < months; offset += 1) {
    const start = addMonths(first, offset);
    const end = addMonths(first, offset + 1);
    const name = partitionName(table, start);

    const exists = await client.query<{ present: boolean }>(
      `SELECT to_regclass($1) IS NOT NULL AS present`, [`public.${name}`]);
    if (exists.rows[0].present) continue;

    const storage = storageOptions ? storageClause(storageOptions) : '';
    // TIMESTAMPTZ s výslovným +00 je POVINNÉ. Holé 'YYYY-MM-DD' se přetypuje
    // podle TimeZone spojení, takže oddíl založený pod Europe/Prague začíná
    // v 22:00 předchozího dne. Ověřeno spuštěním: mezi ním a dalším měsícem
    // založeným pod UTC zůstane DVOUHODINOVÁ DÍRA a zápis do ní tvrdě selže,
    // protože výchozí oddíl se nezakládá. Opačné pořadí dá překryv a oddíl
    // nejde založit vůbec.
    await client.query(
      `CREATE TABLE ${name} PARTITION OF ${table}
         FOR VALUES FROM (TIMESTAMPTZ '${isoBoundary(start)}')
                      TO (TIMESTAMPTZ '${isoBoundary(end)}')
         ${storage ? `WITH (${storage})` : ''}`);
    // Žádné granty. Viz rozhodnutí R20.
    created.push(name);
  }
  return created;
}

/**
 * Doplní chybějící oddíly pro LIBOVOLNÝ rozsah, včetně minulosti.
 * `to` je výlučné. Potřebuje to dávkový import historie (část 5, bod 12.5.3):
 * bez něj by import událostí starších než aktuální měsíc tvrdě selhal,
 * protože výchozí oddíl se nezakládá.
 *
 * Volá se pod mlain_migrator, viz rozhodnutí R30. Aplikační role CREATE
 * na schématu nemá a mít nesmí.
 */
export async function ensurePartitionsForRange(
  client: Queryable, table: string, column: string, from: Date, to: Date,
  storageOptions?: StorageOptions,
): Promise<string[]> {
  const first = monthStart(from);
  const last = monthStart(to);
  let months = 0;
  for (let cursor = first; cursor < last; cursor = addMonths(cursor, 1)) months += 1;
  if (months <= 0) return [];
  return createMonthlyPartitions(client, table, column, first, months, storageOptions);
}

/** Volá se z migračního runneru a z jobu platform.maintain_partitions. */
export async function ensureUpcomingPartitions(
  client: Queryable, from: Date, months: number,
): Promise<void> {
  for (const { table, column } of PARTITIONED_TABLES) {
    await createMonthlyPartitions(
      client, table, column, from, months,
      table === 'messages' ? MESSAGES_STORAGE : undefined,
    );
  }
}

/**
 * Predikát vlastníka tabulky. Vrací true, když se rozsah SMÍ odpojit.
 * Bez něj funkce neudělá nic: jen vlastník ví, kdy jsou data zbytná.
 */
export type PartitionVeto = (
  client: Queryable, from: Date, to: Date, partition: string,
) => Promise<boolean>;

/**
 * Odpojí a zahodí partition starší než `before`. `veto` je POVINNÉ.
 *
 * U messages je to past, ne formalita: celá kampaň leží v jedné partition
 * vybrané při materializaci (invariant I1), takže kampaň materializovaná
 * 31. srpna má všechny zprávy v srpnové partition, i když se dorozesílá
 * v září. Dlouho pozastavená kampaň by si jinak přišla o outbox pod rukama
 * a po obnovení by se tvářila jako doběhlá, přestože neodeslala nic.
 */
export async function dropPartitionsBefore(
  client: Queryable,
  table: string,
  column: string,
  before: Date,
  veto: PartitionVeto,
): Promise<string[]> {
  assertIdent(table, 'tabulka');
  assertIdent(column, 'sloupec');
  if (typeof veto !== 'function') {
    throw new Error(
      `dropPartitionsBefore(${table}): chybí veto predikát, bez něj se neodpojuje nic`);
  }

  const { rows } = await client.query<{ relname: string; bound: string }>(
    `SELECT c.relname, pg_get_expr(c.relpartbound, c.oid) AS bound
       FROM pg_class c
       JOIN pg_inherits i ON i.inhrelid = c.oid
      WHERE i.inhparent = $1::regclass
      ORDER BY c.relname`, [table]);

  const dropped: string[] = [];
  for (const row of rows) {
    const match = row.relname.match(/_y(\d{4})m(\d{2})$/);
    if (!match) continue;
    const from = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, 1));
    const to = addMonths(from, 1);
    if (to > before) continue;

    if (!(await veto(client, from, to, row.relname))) continue;

    // CONCURRENTLY je povinné: prosté DETACH bere ACCESS EXCLUSIVE zámek
    // na CELOU partitionovanou tabulku, takže u velké instalace zastaví claim
    // i příjem událostí na dobu odpojení. Ověřeno spuštěním na PostgreSQL 18.
    //
    // Cena je, že příkaz NESMÍ běžet uvnitř transakčního bloku. Volající proto
    // předává spojení mimo transakci; retenční job to tak dělá.
    //
    // Když se předchozí pokus přerušil, zůstane oddíl ve stavu "detach pending"
    // a další DETACH skončí chybou. FINALIZE ten stav dokončí a je bezpečné
    // ho volat i tehdy, když nic nevisí.
    try {
      await client.query(
        `ALTER TABLE ${table} DETACH PARTITION ${row.relname} CONCURRENTLY`);
    } catch (error) {
      if ((error as { code?: string }).code !== '55006') throw error;
      await client.query(
        `ALTER TABLE ${table} DETACH PARTITION ${row.relname} FINALIZE`);
    }
    await client.query(`DROP TABLE ${row.relname}`);
    dropped.push(row.relname);
  }
  return dropped;
}

/**
 * Třífázové založení indexu na partitionované tabulce, která už nese data.
 *
 * Prosté `CREATE INDEX` na rodiči vezme ACCESS EXCLUSIVE zámek na tabulku
 * i všechny oddíly a drží ho po celou dobu stavby. Nad velkou tabulkou to
 * znamená, že první upgradová migrace narazí na lock_timeout a instalace
 * skončí v režimu údržby. `CREATE INDEX CONCURRENTLY` zase na partitionované
 * tabulce jako celku nefunguje.
 *
 * Jediný povolený postup je tenhle a ověřeno spuštěním dává platný index:
 *   1. `CREATE INDEX ... ON ONLY <rodič>` (vznikne neplatný, prázdný index)
 *   2. `CREATE INDEX CONCURRENTLY` na každém oddílu zvlášť
 *   3. `ALTER INDEX ... ATTACH PARTITION ...` pro každý z nich; po připojení
 *      posledního se index rodiče sám stane platným
 *
 * Migrace, která tuhle funkci volá, MUSÍ mít direktivu `-- mlain:no-transaction`.
 */
export async function createIndexConcurrentlyOnPartitioned(
  client: Queryable,
  options: { parent: string; indexName: string; definition: string },
): Promise<void> {
  const parent = assertIdent(options.parent, 'tabulka');
  const parentIndex = assertIdent(options.indexName, 'index');

  await client.query(
    `CREATE INDEX IF NOT EXISTS ${parentIndex} ON ONLY ${parent} ${options.definition}`);

  const { rows } = await client.query<{ relname: string }>(
    `SELECT c.relname FROM pg_class c
       JOIN pg_inherits i ON i.inhrelid = c.oid
      WHERE i.inhparent = $1::regclass ORDER BY c.relname`, [parent]);

  for (const row of rows) {
    const childIndex = assertIdent(`${row.relname}__${parentIndex}`.slice(0, 63), 'index');
    await client.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${childIndex} `
      + `ON ${assertIdent(row.relname, 'partition')} ${options.definition}`);
    await client.query(`ALTER INDEX ${parentIndex} ATTACH PARTITION ${childIndex}`);
  }
}
```

`createIndexConcurrentlyOnPartitioned` v MVP 0 nikdo nevolá: migrace 0003 zakládá indexy nad prázdnými tabulkami, kde je zamykání zadarmo. Je tady proto, že **první upgradová migrace nad zákaznickou databází ho volat bude**, a v tu chvíli je pozdě ho vymýšlet. Test v `partitions.test.ts` ověřuje, že vyrobí platný index nad tabulkou se dvěma oddíly.

- [ ] **Step 4: Spusť testy a ověř, že projdou**

Run: `pnpm --filter @mlain/db test:db -- test/partitions.test.ts`
Expected: PASS, 16 testů.

- [ ] **Step 5: Napiš `src/attribute-index.ts`**

`contact_fields` má sloupce `indexed boolean` a `index_state text CHECK IN ('none','building','ready','failed')`. Stav `building` znamená, že někdo **za běhu zakládá index nad `contacts.attributes`**. Kapitola 8 to ostatním plánům zakazuje a P03 na to dosud nedodával utilitu, takže ta cesta neexistovala ani pro nikoho: sloupec `indexed` by zůstal navždy na `false`, aniž by to kdokoli nazval rozhodnutím.

Existující `idx_contacts__attributes_gin` s `jsonb_path_ops` na to nestačí a je to ověřené spuštěním: umí jen operátor `@>`, kdežto matice operátorů z části 2 potřebuje i porovnání a rozsahy. Nad výrazovým indexem `(workspace_id, (attributes->>'klic'))` plánovač na dotaz `(attributes->>'vek') > '30'` skutečně sáhne (`Index Scan`), nad GIN indexem ne.

```ts
// packages/db/src/attribute-index.ts
import type { Pool } from 'pg';

/**
 * Zakládá a ruší indexy nad vlastními poli v contacts.attributes.
 *
 * Proč to patří sem: DDL smí podle kapitoly 8 jedině tenhle balíček, ale
 * seznam vlastních polí vlastní doména kontaktů. Utilita je ta hranice.
 *
 * CONCURRENTLY je POVINNÉ a nesmí běžet v transakci. Ověřeno spuštěním:
 * uvnitř BEGIN skončí příkaz chybou 25001. Kdyby se index zakládal bez
 * CONCURRENTLY, zamkl by contacts na zápis na celou dobu stavby, tedy
 * u pěti milionů kontaktů na minuty, během kterých by neprošel jediný
 * import ani jediné přihlášení k odběru.
 */

/** Jméno indexu je odvozené, ne předané: volající nesmí určovat identifikátor. */
export function attributeIndexName(key: string): string {
  return `idx_contacts__attr_${key}`;
}

function assertKey(key: string): void {
  // Týž tvar jako ck_contact_fields__key. Klíč jde do identifikátoru
  // i do textového literálu, takže kontrola musí být tady, ne u volajícího.
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(key)) {
    throw new Error(`klíč vlastního pole '${key}' nemá povolený tvar`);
  }
}

/**
 * Založí index nad jedním vlastním polem. Vrací true, když index po doběhnutí
 * existuje a je PLATNÝ.
 *
 * Neplatný index po neúspěchu je ten stav, kvůli kterému má index_state
 * hodnotu 'failed': CREATE INDEX CONCURRENTLY po chybě nechá v katalogu
 * záznam s indisvalid = false, který nikdo nepoužije, ale místo zabírá.
 * Volající ho musí zahodit a stav zapsat, ne to mlčky zkusit znovu.
 */
export async function ensureAttributeIndex(pool: Pool, key: string): Promise<boolean> {
  assertKey(key);
  const name = attributeIndexName(key);
  const client = await pool.connect();
  try {
    // Bez transakce. CONCURRENTLY uvnitř BEGIN skončí chybou 25001.
    await client.query(
      `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${name} `
      + `ON contacts (workspace_id, (attributes->>'${key}')) `
      + `WHERE deleted_at IS NULL`);
  } catch (error) {
    await dropAttributeIndex(pool, key);   // ať po sobě neuklízí nikdo jiný
    throw error;
  } finally {
    client.release();
  }
  return isAttributeIndexValid(pool, key);
}

/** Ptá se KATALOGU, ne toho, jestli příkaz nevyhodil chybu. */
export async function isAttributeIndexValid(pool: Pool, key: string): Promise<boolean> {
  assertKey(key);
  const { rows } = await pool.query<{ valid: boolean }>(
    `SELECT i.indisvalid AS valid
       FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid
      WHERE c.relname = $1`, [attributeIndexName(key)]);
  return rows[0]?.valid === true;
}

export async function dropAttributeIndex(pool: Pool, key: string): Promise<void> {
  assertKey(key);
  await pool.query(`DROP INDEX CONCURRENTLY IF EXISTS ${attributeIndexName(key)}`);
}
```

- [ ] **Step 6: Napiš `test/attribute-index.test.ts`**

```ts
// packages/db/test/attribute-index.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './helpers/container.js';
import { seedTwoWorkspaces } from './helpers/fixtures.js';
import {
  attributeIndexName, dropAttributeIndex, ensureAttributeIndex, isAttributeIndexValid,
} from '../src/attribute-index.js';

let h: Harness;
beforeAll(async () => { h = await startHarness(); }, 180_000);
afterAll(async () => { await h.stop(); });

describe('indexy nad vlastními poli', () => {
  it('založí platný index a katalog ho potvrdí', async () => {
    await seedTwoWorkspaces(h.as('mlain_migrator'));
    expect(await ensureAttributeIndex(h.as('mlain_migrator'), 'vek')).toBe(true);
    expect(await isAttributeIndexValid(h.as('mlain_migrator'), 'vek')).toBe(true);
    await dropAttributeIndex(h.as('mlain_migrator'), 'vek');
    expect(await isAttributeIndexValid(h.as('mlain_migrator'), 'vek')).toBe(false);
  });

  it('rozsahový dotaz index použije, GIN nad attributes na to nestačí', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    await h.as('mlain_migrator').query(
      `INSERT INTO contacts (workspace_id, email, attributes)
       VALUES ($1, 'attr@example.test', '{"vek":"42"}')`, [ws.workspaceA]);
    await ensureAttributeIndex(h.as('mlain_migrator'), 'vek');
    const client = await h.as('mlain_migrator').connect();
    try {
      await client.query('SET enable_seqscan = off');
      const { rows } = await client.query<{ 'QUERY PLAN': string }>(
        `EXPLAIN SELECT id FROM contacts
          WHERE workspace_id = $1 AND (attributes->>'vek') > '30' AND deleted_at IS NULL`,
        [ws.workspaceA]);
      expect(rows.map((r) => r['QUERY PLAN']).join('\n'))
        .toContain(attributeIndexName('vek'));
    } finally { client.release(); }
    await dropAttributeIndex(h.as('mlain_migrator'), 'vek');
  });

  it('klíč mimo povolený tvar se odmítne dřív, než se sáhne na databázi', async () => {
    // Klíč jde do IDENTIFIKÁTORU i do textového literálu, takže bez téhle
    // kontroly by to byla injekce do DDL běžícího pod migrátorem.
    for (const key of ['Vek', 'vek; DROP TABLE contacts', '1vek', '', "a'||''"]) {
      await expect(ensureAttributeIndex(h.as('mlain_migrator'), key))
        .rejects.toThrow(/nemá povolený tvar/);
    }
    const { rows } = await h.as('mlain_migrator').query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_name = 'contacts'`);
    expect(rows[0].n).toBe(1);
  });

  it('CONCURRENTLY v transakci selže, proto si utilita bere vlastní spojení', async () => {
    // Pojistka proti tomu, aby někdo utilitu zabalil do withWorkspace.
    const client = await h.as('mlain_migrator').connect();
    try {
      await client.query('BEGIN');
      await expect(client.query(
        `CREATE INDEX CONCURRENTLY idx_contacts__attr_x ON contacts ((attributes->>'x'))`))
        .rejects.toThrow(/cannot run inside a transaction block/i);
      await client.query('ROLLBACK');
    } finally { client.release(); }
  });
});
```

- [ ] **Step 7: Spusť testy a ověř, že projdou**

Run: `pnpm --filter @mlain/db test:db -- test/partitions.test.ts test/attribute-index.test.ts`
Expected: PASS, 16 + 4 testů.

- [ ] **Step 8: Commit**

```bash
git add packages/db/src/partitions.ts packages/db/src/attribute-index.ts \
        packages/db/test/partitions.test.ts packages/db/test/attribute-index.test.ts
git commit -m "feat(db): monthly partition utilities and runtime attribute indexes"
```

---

### Task 18: Registr RLS politik

**Files:**
- Create: `packages/db/src/rls.ts`

Registr existuje proto, že tabulek jsou tři druhy a každý má jiné izolační pravidlo. Testy se řídí **registrem**, ne pevným řetězcem `ws_isolation`. Bez registru by test na názvu politiky spadl na první tabulce, která potřebuje výjimku, a výjimku by někdo vyřešil vypnutím testu.

- [ ] **Step 1: Napiš `src/rls.ts`**

```ts
// packages/db/src/rls.ts

/** Tabulky bez sloupce workspace_id. Test "každá tabulka mimo whitelist má
 *  workspace_id" se řídí tímhle seznamem.
 *
 *  workspaces je na seznamu, ale RLS na ní PŘESTO BĚŽÍ, jen se izoluje přes id.
 *  Whitelist říká "nemá sloupec workspace_id", ne "nemá RLS". */
export const TABLES_WITHOUT_WORKSPACE_ID: readonly string[] = [
  'users',
  'sessions',
  'password_reset_tokens',
  'system_settings',
  // Pokolení šifrovacího klíče je vlastnost instalace, ne projektu (R28).
  'secret_key_generations',
  'workspaces',
  // Část 5 je vyjímá výslovně: klíčem je náhodný nonce a řádek žije 15 minut.
  'identity_token_uses',
  // Globální provozní data, žádný obsah zákazníka.
  'proxy_ranges',
  // Rozsah limitu nese textový klíč scope:identifier:window, ne sloupec (R36).
  // Přihlašovací a IP limity žádný workspace kontext nemají, takže by je
  // politika s WITH CHECK vyhodnoceným jako NULL odmítla a limiter by přestal
  // fungovat právě na přihlašování.
  'rate_limits',
];

/** Tabulky, na kterých se RLS vůbec nezapíná. */
export const TABLES_WITHOUT_RLS: readonly string[] = [
  'users',
  'sessions',
  'password_reset_tokens',
  'system_settings',
  'secret_key_generations',
  'identity_token_uses',
  'proxy_ranges',
  'rate_limits',
];

export type PolicyKind = 'ws_isolation' | 'ws_isolation_audit' | 'ws_isolation_self';

export type TablePolicy = {
  table: string;
  policy: PolicyKind;
  /** Sloupec, přes který se izolace vyhodnocuje. */
  isolationColumn: string;
  /** Další politiky, které na tabulce legitimně existují. */
  extraPolicies?: readonly string[];
};

/** Tabulky, na které má sender grant, a proto potřebují permisivní politiku
 *  sender_bypass. Role mlain_sender nemá BYPASSRLS a nikdy nenastavuje
 *  mlain.workspace_id, protože pracuje napříč projekty. Bez sender_bypass
 *  by claim dotaz vracel NULA ŘÁDKŮ VŽDY a nikdo by se to nedozvěděl,
 *  protože prázdná dávka je legitimní stav. */
export const SENDER_BYPASS_TABLES: readonly string[] = [
  'messages',
  'campaigns',
  'sending_providers',
  'campaign_links',
  'workspaces',
  'suppressions',
  'message_events',
  // Agregovaná varování z renderu. Grant tu byl od začátku, politika ne, takže
  // zápis by NIKDY neprošel: sender by dostal nejdřív permission denied
  // (INSERT ... ON CONFLICT DO UPDATE čte existující řádek, potřebuje tedy
  // i SELECT) a po jeho doplnění "new row violates row-level security policy".
  // Report varování by byl navždy prázdný a nikdo by se nedozvěděl proč.
  'campaign_render_warnings',
];

/** Tabulky, na které má mlain_maintenance grant, a proto potřebují
 *  permisivní politiku maintenance_bypass. Retenční job běží NAPŘÍČ projekty
 *  a workspace kontext nenastavuje, takže by ws_isolation nepustila nic
 *  a DELETE by ovlivnil nula řádků BEZ CHYBY. Retence osobních údajů by se
 *  tiše neprovedla, což je ta nejhorší varianta selhání, jakou tahle tabulka má. */
export const MAINTENANCE_BYPASS_TABLES: readonly string[] = ['web_events'];

const WS_ISOLATION_TABLES = [
  // identita a platforma
  'memberships', 'invitations', 'api_keys', 'idempotency_keys', 'webhook_endpoints',
  'webhook_events', 'webhook_deliveries',
  // kontakty
  'contacts', 'contact_fields', 'tags', 'contact_tags', 'lists', 'list_subscriptions',
  'subscription_confirmations', 'consents', 'contact_consent_state', 'suppressions',
  'imports', 'import_errors', 'exports', 'name_overrides', 'segments', 'segment_members',
  'forms', 'form_submissions', 'inbound_endpoints', 'inbound_dedup', 'inbound_deliveries',
  'gdpr_requests', 'retention_policies', 'retention_runs',
  // obsah
  'assets', 'templates', 'template_versions', 'brand_profiles', 'brand_extractions',
  'ai_provider_credentials', 'ai_conversations', 'ai_messages', 'ai_usage_daily',
  'content_snippets',
  // obsah, podřízené tabulky assets (rozhodnutí R26)
  'asset_variants', 'asset_references',
  // kampaně
  'sending_providers', 'sender_domains', 'campaigns', 'campaign_content_variants',
  'campaign_links', 'deliverability_snapshots', 'campaign_audience_progress',
  'campaign_render_warnings', 'messages', 'message_events', 'provider_event_receipts',
  // tracking
  'web_event_months', 'identities', 'identity_bindings', 'identity_merges',
  'tracking_domains', 'contact_engagement', 'campaign_stats', 'campaign_stats_buckets',
  'campaign_link_stats', 'web_events', 'message_engagement',
] as const;

export const RLS_REGISTRY: readonly TablePolicy[] = [
  ...WS_ISOLATION_TABLES.map((table): TablePolicy => ({
    table,
    policy: 'ws_isolation',
    isolationColumn: 'workspace_id',
    extraPolicies: SENDER_BYPASS_TABLES.includes(table) ? ['sender_bypass'] : undefined,
  })),
  {
    table: 'audit_log',
    policy: 'ws_isolation_audit',
    isolationColumn: 'workspace_id',
  },
  {
    table: 'workspaces',
    policy: 'ws_isolation_self',
    isolationColumn: 'id',
    extraPolicies: ['ws_member_visibility', 'ws_insert_bootstrap', 'sender_bypass'],
  },
];

/** Politiky, které legitimně existují mimo hlavní izolační politiku tabulky. */
export const EXTRA_POLICIES: Readonly<Record<string, readonly string[]>> = {
  memberships: ['user_own_memberships'],
  // Globální auditní záznamy patří uživateli, ne projektu. Bez téhle politiky
  // je repo/audit-global.ts nespustitelné.
  audit_log: ['user_own_global_audit'],
  web_events: ['maintenance_bypass'],
};

/** Úplný seznam očekávaných politik na tabulce, včetně těch doplňkových. */
export function expectedPolicies(table: string): string[] {
  const entry = RLS_REGISTRY.find((row) => row.table === table);
  if (!entry) return [];
  return [
    entry.policy,
    ...(entry.extraPolicies ?? []),
    ...(EXTRA_POLICIES[table] ?? []),
  ];
}
```

- [ ] **Step 2: Ověř typovou kontrolu**

Run: `pnpm --filter @mlain/db typecheck`
Expected: PASS. Seznam `WS_ISOLATION_TABLES` má **65 položek**; kdyby jich bylo jiné množství, porovnej ho s registrem tabulek v kapitole 2 tohohle plánu.

Registr je zdroj, ze kterého se politiky **zakládají**. Kontrola, jestli sedí se skutečností, se ho proto ptát nesmí: `test/grants.test.ts` (úkol 22) porovnává politiky se skutečnými granty z `pg_class.relacl`, tedy z druhé strany. Kdyby se kontrolovalo proti témuž seznamu, chyběla by politika `sender_bypass` na `campaign_render_warnings` dál a test by zůstal zelený.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/rls.ts
git commit -m "feat(db): RLS policy registry drives isolation tests"
```

---

### Task 19: Migrace 0004, RLS politiky

**Files:**
- Create: `packages/db/migrations/0004_rls_policies.sql`
- Modify: `packages/db/migrations/meta/_journal.json`
- Create: `packages/db/test/rls-registry.test.ts`

Row-level security je **druhá vrstva**, ne jediná. Kdyby existovala jen RLS, každá chyba v nastavení session proměnné by tiše vrátila prázdné výsledky a nikdo by si nevšiml. Kdyby existovala jen repository vrstva, jeden zapomenutý `WHERE` by tiše vrátil cizí data.

`FORCE ROW LEVEL SECURITY` se **nepoužívá**: schéma vlastní `mlain_migrator`, aplikace se připojuje pod `mlain_app`, která ho nevlastní, takže se na ni RLS vztahuje sama od sebe.

- [ ] **Step 1: Napiš padající test, který porovná registr se skutečným stavem**

```ts
// packages/db/test/rls-registry.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './helpers/container.js';
import {
  RLS_REGISTRY, SENDER_BYPASS_TABLES, TABLES_WITHOUT_RLS,
  TABLES_WITHOUT_WORKSPACE_ID, expectedPolicies,
} from '../src/rls.js';

let h: Harness;
beforeAll(async () => { h = await startHarness(); }, 180_000);
afterAll(async () => { await h.stop(); });

async function allTables(): Promise<string[]> {
  const { rows } = await h.as('mlain_migrator').query<{ relname: string }>(
    `SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
        AND c.relispartition = false ORDER BY 1`);
  return rows.map((r) => r.relname);
}

describe('registr RLS proti skutečnému stavu', () => {
  it('každá tabulka mimo whitelist má sloupec workspace_id (kritérium 21e)', async () => {
    for (const table of await allTables()) {
      if (TABLES_WITHOUT_WORKSPACE_ID.includes(table)) continue;
      const { rows } = await h.as('mlain_migrator').query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_name = $1 AND column_name = 'workspace_id'`, [table]);
      expect(rows, `${table} nemá workspace_id a není na whitelistu`).toHaveLength(1);
    }
  });

  it('workspaces je na whitelistu a přesto má zapnuté RLS (kritérium 21e)', async () => {
    expect(TABLES_WITHOUT_WORKSPACE_ID).toContain('workspaces');
    const { rows } = await h.as('mlain_migrator').query<{ relrowsecurity: boolean }>(
      `SELECT relrowsecurity FROM pg_class WHERE relname = 'workspaces'`);
    expect(rows[0].relrowsecurity).toBe(true);
  });

  it('každá tabulka má zapnuté RLS a přesně ty politiky, které říká registr', async () => {
    for (const entry of RLS_REGISTRY) {
      const { rows: rls } = await h.as('mlain_migrator').query<{ relrowsecurity: boolean }>(
        `SELECT relrowsecurity FROM pg_class WHERE relname = $1`, [entry.table]);
      expect(rls[0]?.relrowsecurity, `${entry.table} nemá zapnuté RLS`).toBe(true);

      const { rows: policies } = await h.as('mlain_migrator').query<{ policyname: string }>(
        `SELECT policyname FROM pg_policies WHERE tablename = $1 ORDER BY 1`, [entry.table]);
      expect(policies.map((p) => p.policyname).sort())
        .toEqual(expectedPolicies(entry.table).sort());
    }
  });

  it('žádná tabulka nemá politiku, která v registru není', async () => {
    const { rows } = await h.as('mlain_migrator').query<
      { tablename: string; policyname: string }
    >(`SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public'`);
    for (const row of rows) {
      expect(expectedPolicies(row.tablename), `${row.tablename}.${row.policyname} není v registru`)
        .toContain(row.policyname);
    }
  });

  it('tabulky bez RLS ho opravdu vypnuté mají', async () => {
    for (const table of TABLES_WITHOUT_RLS) {
      const { rows } = await h.as('mlain_migrator').query<{ relrowsecurity: boolean }>(
        `SELECT relrowsecurity FROM pg_class WHERE relname = $1`, [table]);
      expect(rows[0].relrowsecurity, `${table} má RLS, ale nemá mít`).toBe(false);
    }
  });

  it('sender_bypass existuje na všech osmi tabulkách z registru', async () => {
    for (const table of SENDER_BYPASS_TABLES) {
      const { rows } = await h.as('mlain_migrator').query<{ roles: string[] }>(
        `SELECT roles FROM pg_policies
          WHERE tablename = $1 AND policyname = 'sender_bypass'`, [table]);
      expect(rows, `${table} nemá politiku sender_bypass`).toHaveLength(1);
      expect(rows[0].roles).toContain('mlain_sender');
    }
  });

  it('celkem existuje 84 politik', async () => {
    const { rows } = await h.as('mlain_migrator').query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'public'`);
    expect(rows[0].n).toBe(84);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm --filter @mlain/db test:db -- test/rls-registry.test.ts`
Expected: FAIL, počet politik je 0.

- [ ] **Step 3: Vytvoř ruční migraci a zapiš do ní hromadné politiky**

Run: `cd /Users/petr/Projects/Mailing_Tool/packages/db && pnpm db:custom --name=rls_policies`

Do `migrations/0004_rls_policies.sql` zapiš:

```sql
-- mlain:timeout=120

-- ---------------------------------------------------------------------------
-- ws_isolation na 65 tabulkách se sloupcem workspace_id.
--
-- KAŽDÁ politika čte kontext přes NULLIF(current_setting(...), ''), nikdy
-- holým current_setting. Rozhodnutí R21, ověřeno spuštěním:
--
--   * na ČERSTVÉM spojení vrátí current_setting('mlain.workspace_id', true)
--     hodnotu NULL a porovnání dá nepravdu, tedy žádné řádky. Tak to plán
--     původně popisoval a potud to platí.
--   * na spojení, kde se kontext NĚKDY nastavil přes SET LOCAL, vrátí táž
--     funkce po commitu PRÁZDNÝ ŘETĚZEC. ''::uuid skončí chybou 22P02, takže
--     druhý dotaz ze stejného poolového spojení bez kontextu SPADNE místo
--     aby vrátil prázdno. V testech s čerstvým poolem se to neprojeví
--     a v provozu se to projeví hned.
--
-- FORCE ROW LEVEL SECURITY se NEPOUŽÍVÁ: schéma vlastní mlain_migrator,
-- aplikace jede pod mlain_app, která ho nevlastní, takže na ni RLS dopadá
-- sama od sebe.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'memberships','invitations','api_keys','idempotency_keys','webhook_endpoints',
    'webhook_events','webhook_deliveries',
    'contacts','contact_fields','tags','contact_tags','lists','list_subscriptions',
    'subscription_confirmations','consents','contact_consent_state','suppressions',
    'imports','import_errors','exports','name_overrides','segments','segment_members',
    'forms','form_submissions','inbound_endpoints','inbound_dedup','inbound_deliveries',
    'gdpr_requests','retention_policies','retention_runs',
    'assets','asset_variants','asset_references',
    'templates','template_versions','brand_profiles','brand_extractions',
    'ai_provider_credentials','ai_conversations','ai_messages','ai_usage_daily',
    'content_snippets',
    'sending_providers','sender_domains','campaigns','campaign_content_variants',
    'campaign_links','deliverability_snapshots','campaign_audience_progress',
    'campaign_render_warnings','messages','message_events','provider_event_receipts',
    'web_event_months','identities','identity_bindings','identity_merges',
    'tracking_domains','contact_engagement','campaign_stats','campaign_stats_buckets',
    'campaign_link_stats','web_events','message_engagement'
  ];
BEGIN
  IF array_length(tables, 1) <> 65 THEN
    RAISE EXCEPTION 'seznam ws_isolation tabulek má % položek, očekává se 65',
      array_length(tables, 1);
  END IF;

  FOREACH t IN ARRAY tables LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY ws_isolation ON %I '
      '  USING      (workspace_id = NULLIF(current_setting(''mlain.workspace_id'', true), '''')::uuid) '
      '  WITH CHECK (workspace_id = NULLIF(current_setting(''mlain.workspace_id'', true), '''')::uuid)', t);
  END LOOP;
END $$;
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- audit_log: NULL ve WITH CHECK je POVINNÝ, jinak spadne změna hesla.
--
-- audit_log.workspace_id je nullable, protože globální akce (user.login,
-- user.password_changed, user.login_failed) k žádnému projektu nepatří.
-- S obyčejnou ws_isolation je NULL = current_setting(...)::uuid vyhodnocené
-- jako NULL, tedy nepravda, takže INSERT globálního záznamu SELŽE na WITH CHECK
-- A VEZME S SEBOU CELOU TRANSAKCI. Protože se audit zapisuje ve stejné transakci
-- jako auditovaná změna, znamenalo by to, že se ZMĚNA HESLA NEULOŽÍ.
-- Přihlašovací flow navíc žádný workspace kontext nenastavuje, takže by tam
-- padalo úplně všechno.
-- ---------------------------------------------------------------------------
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ws_isolation_audit ON audit_log
  -- Čtení: jen řádky aktuálního projektu. Globální řádky se přes workspace
  -- kontext ZÁMĚRNĚ nečtou, patří uživateli, ne projektu; kdyby je USING
  -- pustilo, viděl by admin projektu A přihlášení uživatelů projektu B.
  USING      (workspace_id = NULLIF(current_setting('mlain.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id IS NULL
              OR workspace_id = NULLIF(current_setting('mlain.workspace_id', true), '')::uuid);
--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Globální auditní záznamy (workspace_id IS NULL) patří uživateli, ne projektu.
-- Bez téhle politiky je repo/audit-global.ts nespustitelné: ws_isolation_audit
-- v USING porovnává jen s mlain.workspace_id, který tahle cesta nenastavuje.
--
-- Podmínka "workspace kontext NENÍ nastavený" je nutná kvůli kritériu 21c,
-- které říká, že se pod kontextem projektu nevrátí ani jeden globální řádek.
-- Bez ní by ho uživatel pod kontextem projektu B viděl, protože withWorkspace
-- u aktéra typu user nastavuje i mlain.user_id a politiky se OR-ují.
-- Ověřeno spuštěním: s podmínkou vrátí dotaz pod kontextem projektu jen
-- projektový záznam a přes withUser jen globální.
-- ---------------------------------------------------------------------------
CREATE POLICY user_own_global_audit ON audit_log FOR SELECT
  USING (NULLIF(current_setting('mlain.workspace_id', true), '') IS NULL
         AND workspace_id IS NULL
         AND actor_type = 'user'
         AND actor_id = NULLIF(current_setting('mlain.user_id', true), '')::uuid);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- workspaces: izolace přes id plus dvě cesty, které kontext z principu nemají.
-- ---------------------------------------------------------------------------
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ws_isolation_self ON workspaces
  USING      (id = NULLIF(current_setting('mlain.workspace_id', true), '')::uuid)
  WITH CHECK (id = NULLIF(current_setting('mlain.workspace_id', true), '')::uuid);
--> statement-breakpoint
-- Výpis projektů aktéra: kontextů je víc než jeden, takže ws_isolation_self
-- by ho zablokovala. Politiky se v PostgreSQL OR-ují, takže ws_isolation_self
-- zůstává pro běžnou cestu nedotčená.
CREATE POLICY ws_member_visibility ON workspaces FOR SELECT
  USING (EXISTS (SELECT 1 FROM memberships m
                  WHERE m.workspace_id = workspaces.id
                    AND m.user_id = NULLIF(current_setting('mlain.user_id', true), '')::uuid));
--> statement-breakpoint
-- Založení projektu: kontext ještě neexistuje.
--
-- NULLIF je tu bezpečnostní opatření, ne kosmetika. Holé
-- `current_setting('mlain.user_id', true) IS NOT NULL` je na prázdném řetězci
-- PRAVDA, takže na spojení, které kdykoli dřív obsloužilo přihlášeného
-- uživatele, by politika pustila založení projektu BEZ JAKÉHOKOLI aktéra.
-- Ověřeno spuštěním.
CREATE POLICY ws_insert_bootstrap ON workspaces FOR INSERT
  WITH CHECK (NULLIF(current_setting('mlain.user_id', true), '') IS NOT NULL);
--> statement-breakpoint
-- Poddotaz v ws_member_visibility se vyhodnocuje s politikami tabulky
-- memberships, takže by pod ws_isolation vracel prázdno. Členství vlastního
-- uživatele proto musí být viditelné i bez workspace kontextu.
CREATE POLICY user_own_memberships ON memberships FOR SELECT
  USING (user_id = NULLIF(current_setting('mlain.user_id', true), '')::uuid);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- api_keys: ověření klíče běží MIMO workspace kontext (požadavek P04→P03.5).
--
-- Workspace se z klíče teprve ZJIŠŤUJE, takže ověřovací dotaz nemá co nastavit
-- a jede přes withoutContext. Pod samotnou ws_isolation by SELECT vracel VŽDY
-- nula řádků a KAŽDÝ požadavek s hlavičkou `Authorization: Bearer ml_live_...`
-- by skončil na `unauthenticated`. Nespadlo by to hlasitě: vypadá to jako
-- „klíč neexistuje", tedy jako správné odmítnutí.
--
-- Politika NEFILTRUJE expires_at. Vypršelý klíč musí ověřovací algoritmus
-- najít a odmítnout vlastním kódem chyby; kdyby ho politika schovala, dostal
-- by integrátor „klíč neexistuje" místo „klíč vypršel".
-- ---------------------------------------------------------------------------
CREATE POLICY api_key_lookup ON api_keys FOR SELECT
  USING (NULLIF(current_setting('mlain.workspace_id', true), '') IS NULL
         AND revoked_at IS NULL);
--> statement-breakpoint
-- Zápis last_used_at běží toutéž cestou bez kontextu, jen mimo hlavní
-- transakci. Bez politiky pro UPDATE by se `last_used_at` nezapsal nikdy
-- a ticho by bylo úplné: zápis je fire and forget a chybu nikdo nečte.
--
-- WITH CHECK je tu úmyslně PŘÍSNĚJŠÍ než USING a je to táž úvaha jako
-- u sender_bypass na campaigns: politika, která pouští UPDATE, nesmí mlčet
-- o HODNOTÁCH. Nový řádek musí nést čerstvý last_used_at, takže bezkontextový
-- `UPDATE api_keys SET scopes = ...` skončí chybou RLS místo tichého rozšíření
-- oprávnění klíče. Není to zeď (kdo přidá i last_used_at = now(), projde),
-- je to pojistka, která tichou cestu mění na hlasitou.
CREATE POLICY api_key_touch ON api_keys FOR UPDATE
  USING      (NULLIF(current_setting('mlain.workspace_id', true), '') IS NULL
              AND revoked_at IS NULL)
  WITH CHECK (NULLIF(current_setting('mlain.workspace_id', true), '') IS NULL
              AND revoked_at IS NULL
              AND last_used_at >= now() - interval '1 minute');
--> statement-breakpoint
-- Ověřovací dotaz JOINuje workspaces kvůli deleted_at, protože klíč zrušeného
-- projektu nesmí projít. Pod mlain_app na workspaces dopadá RLS taky, takže
-- by JOIN nevrátil nic a api_key_lookup by byla k ničemu: klíč by se našel
-- a JOIN by ho zase zahodil, opět tiše.
--
-- Podmínka „ani jeden kontext není nastavený" je POVINNÁ. Kdyby politika
-- platila i pod mlain.user_id, uplatnila by se na výpisu projektů
-- (repo/workspaces-global.ts čte holé SELECT FROM workspaces pod withUser)
-- a uživatel by ve svém seznamu uviděl cizí projekt, který má API klíč.
-- EXISTS se vyhodnocuje pod politikami api_keys, tedy pod api_key_lookup výš.
CREATE POLICY ws_api_key_lookup ON workspaces FOR SELECT
  USING (NULLIF(current_setting('mlain.workspace_id', true), '') IS NULL
         AND NULLIF(current_setting('mlain.user_id', true), '') IS NULL
         AND EXISTS (SELECT 1 FROM api_keys k
                      WHERE k.workspace_id = workspaces.id AND k.revoked_at IS NULL));
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- invitations: dohledání pozvánky podle token_hash (požadavek P04→P03.6).
--
-- Pozvánku přijímá uživatel, který v projektu JEŠTĚ NENÍ, takže workspace
-- kontext nemá odkud vzít; jede přes withUser. Bez téhle politiky vrátí
-- acceptInvitation VŽDY 404 a z hlášky to nikdo nepozná, protože plán vrací
-- 404 schválně i u neplatného tokenu, aby nešlo zjistit, jestli pozvánka
-- existuje.
--
-- Únik je nulový: jediný filtr, který volající má, je token_hash s unikátním
-- indexem. Bez znalosti tokenu se z tabulky nedá vybrat nic užitečného
-- a politika navíc pouští jen pozvánky živé, nepřijaté a neodvolané.
--
-- Obdoba ws_api_key_lookup pro workspaces tu ZÁMĚRNĚ NENÍ. Přijetí běží pod
-- mlain.user_id, takže by taková politika platila i na výpisu projektů
-- a každý přihlášený uživatel by v seznamu viděl cizí projekt s otevřenou
-- pozvánkou. Jméno a slug projektu si volající přečte až v druhé transakci,
-- která workspace kontext z pozvánky nastavuje, a tam ho pustí ws_isolation_self.
-- ---------------------------------------------------------------------------
CREATE POLICY invitation_token_lookup ON invitations FOR SELECT
  USING (NULLIF(current_setting('mlain.workspace_id', true), '') IS NULL
         AND accepted_at IS NULL
         AND revoked_at IS NULL
         AND expires_at > now());
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- sender_bypass. Tvrzení "sender nepodléhá RLS" bez mechanismu je NEFUNKČNÍ:
-- role mlain_sender nemá BYPASSRLS a nikdy nevolá set_config('mlain.workspace_id'),
-- protože pracuje napříč projekty. current_setting(..., true) proto vrátí NULL,
-- ws_isolation nepustí nic a claim dotaz by vracel NULA ŘÁDKŮ VŽDY.
--
-- ALTER ROLE mlain_sender BYPASSRLS se nepoužívá: je hrubší (platí na všechno
-- včetně tabulek, na které sender přístup mít nemá) a vyžaduje superuživatele,
-- takže by patřilo do docker/initdb, ne do migrace.
--
-- U campaigns je WITH CHECK POVINNÝ a je to jediné místo, kde se vynucuje,
-- že sender kampaň smí jen POZASTAVIT. Sloupcový grant povoluje zápis do
-- status a pause_reason, ale neříká NIC o hodnotě: bez WITH CHECK by šlo
-- nastavit status = 'sent' nebo 'cancelled'. Kdyby politika WITH CHECK
-- neměla, použil by PostgreSQL u UPDATE klauzuli USING, a ta je `true`.
-- Ověřeno spuštěním: s WITH CHECK projde přechod na 'paused' a pokusy
-- o 'sent' i 'cancelled' skončí chybou RLS.
-- ---------------------------------------------------------------------------
CREATE POLICY sender_bypass ON messages          TO mlain_sender USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY sender_bypass ON campaigns         TO mlain_sender
  USING (true) WITH CHECK (status = 'paused');
--> statement-breakpoint
CREATE POLICY sender_bypass ON sending_providers TO mlain_sender USING (true);
--> statement-breakpoint
CREATE POLICY sender_bypass ON campaign_links    TO mlain_sender USING (true);
--> statement-breakpoint
CREATE POLICY sender_bypass ON workspaces        TO mlain_sender USING (true);
--> statement-breakpoint
CREATE POLICY sender_bypass ON suppressions      TO mlain_sender USING (true);
--> statement-breakpoint
CREATE POLICY sender_bypass ON message_events    TO mlain_sender WITH CHECK (true);
--> statement-breakpoint
-- campaign_render_warnings: sender píše agregovaná varování z renderu přes
-- INSERT ... ON CONFLICT DO UPDATE, takže potřebuje USING i WITH CHECK.
-- Bez téhle politiky by zápis neprošel NIKDY a report varování by byl vždy
-- prázdný, aniž by kdokoli viděl chybu, protože sender ji jen zaloguje.
CREATE POLICY sender_bypass ON campaign_render_warnings TO mlain_sender
  USING (true) WITH CHECK (true);
--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- maintenance_bypass. Retenční job běží NAPŘÍČ projekty a mlain.workspace_id
-- nenastavuje, takže by ws_isolation nepustila ani řádek. DELETE by pak
-- ovlivnil NULA ŘÁDKŮ A NEVRÁTIL CHYBU: retence osobních údajů by se nikdy
-- neprovedla a nikdo by se to nedozvěděl. Role nemá BYPASSRLS, protože ta
-- platí na všechno včetně tabulek, kam nesmí.
-- ---------------------------------------------------------------------------
CREATE POLICY maintenance_bypass ON web_events TO mlain_maintenance USING (true);
```

Politiky `sender_bypass` a `maintenance_bypass` odkazují role jménem, takže migrace 0004 na databázi bez těch rolí selže. Je to schválně: bez role není bezpečnostní model úplný a tichý start by ho zrušil, aniž by si toho kdokoliv všiml. Role zakládá `docker/initdb/10-roles.sql` (P01) a v testech je zakládá `global-setup.ts`.

- [ ] **Step 4: Spusť test a ověř, že projde**

Run: `pnpm --filter @mlain/db test:db -- test/rls-registry.test.ts`
Expected: PASS, 7 testů. Kdyby poslední test hlásil jiné číslo než 84, porovnej ho s tabulkou počtů v kapitole 2.4 a najdi, která tabulka politiku nedostala.

- [ ] **Step 5: Commit**

```bash
git add packages/db/migrations packages/db/test/rls-registry.test.ts
git commit -m "feat(db): migration 0004 adds 84 row level security policies"
```

---

### Task 20: Migrace 0005, granty jako idempotentní funkce

**Files:**
- Create: `packages/db/migrations/0005_grants.sql`
- Modify: `packages/db/migrations/meta/_journal.json`

Rozdělení „zakládání role mimo migraci, granty v migraci" je nutné, ne kosmetické. `CREATE ROLE` vyžaduje `CREATEROLE` nebo superuživatele a migrátor je záměrně nemá, protože migrace nemají umět zakládat účty. Granty se naopak vztahují k tabulkám, které migrátor vlastní.

Tři věci se proti dřívějšímu návrhu mění a každá zavírá konkrétní díru:

1. **Granty jsou funkce `mlain_apply_grants()`, ne jednorázový skript** (rozhodnutí R25). `pg_dump --no-privileges` z předepsaného postupu zálohy obsahuje politiky RLS, ale žádné granty, a spolu s daty se obnoví i ledger migrací. Migrace s granty je tedy po obnově označená za aplikovanou a už ji nikdo nespustí; aplikace by se rozeběhla do `permission denied` v nejhorší možný okamžik. Funkci v databázi umí zavolat obnova i `mlain doctor`.
2. **`ALTER DEFAULT PRIVILEGES` se nepoužívá** (rozhodnutí R20). Byla to cesta, kterou každý nový měsíční oddíl dostal plná práva pro `mlain_app`, přestože oddíl nedědí RLS. Funkce místo toho iteruje katalog s podmínkou `relispartition = false`.
3. **Append-only omezení jsou uvnitř téže funkce.** Kdyby zůstala v samostatné migraci, druhé zavolání `mlain_apply_grants()` po obnově by je zase zrušilo, protože `GRANT ... ON ALL TABLES` je vrátí zpátky. Jedna funkce je jediný úplný popis oprávnění; rozdělené na dvě je popis dva a jeden z nich vyhrává podle pořadí.

- [ ] **Step 1: Vytvoř ruční migraci a zapiš do ní funkci**

Run: `cd /Users/petr/Projects/Mailing_Tool/packages/db && pnpm db:custom --name=grants`

Do `migrations/0005_grants.sql` zapiš:

```sql
-- mlain:timeout=120

-- ---------------------------------------------------------------------------
-- mlain_apply_grants(): ÚPLNÝ a IDEMPOTENTNÍ popis oprávnění.
--
-- Volá ji tahle migrace, `mlain doctor --fix` a postup obnovy ze zálohy (P16).
-- Opakované zavolání musí skončit ve stejném stavu, proto se každý blok
-- otevírá REVOKE ALL a teprve pak přiděluje.
--
-- Funkce NEMÁ SECURITY DEFINER: běží pod tím, kdo ji volá, a to musí být
-- vlastník tabulek, tedy mlain_migrator. Kdyby ji uměla zavolat aplikační
-- role, mohla by si přidělit práva sama.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION mlain_apply_grants() RETURNS void
LANGUAGE plpgsql AS $fn$
DECLARE
  t text;
BEGIN
  -- Seznam tabulek se bere Z KATALOGU, ne z výčtu v kódu. Dvě podmínky nesou
  -- celé rozhodnutí R20:
  --   relispartition = false  ... měsíční oddíl NEDOSTANE ŽÁDNÉ PRÁVO. Oddíl
  --     nedědí relrowsecurity ani politiky, takže grant na oddílu je díra
  --     vedle RLS: přímý SELECT z oddílu vrátí řádky všech projektů a přímý
  --     DELETE z oddílu audit_log smaže i cizí a globální záznamy.
  --     Přístup přes rodiče funguje bez toho, práva se kontrolují na relaci,
  --     na kterou dotaz míří.
  --   relkind IN ('r','p')    ... běžné i partitionované tabulky, ne pohledy.
  FOR t IN
    SELECT c.relname
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind IN ('r', 'p')
       AND c.relispartition = false
     ORDER BY c.relname
  LOOP
    EXECUTE format('REVOKE ALL ON %I FROM mlain_app, mlain_sender, '
                   'mlain_gdpr, mlain_maintenance', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO mlain_app', t);
  END LOOP;

  GRANT USAGE ON SCHEMA public TO mlain_app, mlain_sender, mlain_gdpr,
                                  mlain_maintenance, mlain_backup;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO mlain_app;

  -- -------------------------------------------------------------------------
  -- Append-only. Vynucuje se ODEBRÁNÍM PRÁV, ne pravidly. Varianta
  -- `CREATE RULE ... DO INSTEAD NOTHING` je zamítnutá a nesmí se použít:
  -- pravidlo na DELETE tiše zablokuje i ON DELETE CASCADE z contacts, takže
  -- smazání kontaktu proběhne bez chyby, ale jeho souhlasy zůstanou jako
  -- osiřelé řádky s osobními údaji.
  -- -------------------------------------------------------------------------
  REVOKE UPDATE, DELETE ON audit_log      FROM mlain_app;
  REVOKE UPDATE, DELETE ON consents       FROM mlain_app;
  REVOKE UPDATE, DELETE ON message_events FROM mlain_app;

  -- web_events NEMŮŽE být čistě append-only a je to poctivé přiznání, ne
  -- výjimka z rozmaru: doplnění identity, GDPR anonymizace i vrácení sloučení
  -- musí na existující řádek sáhnout. Sloupcový grant zachová záměr konvence
  -- (obsah události je neměnný) a povolí jen atribuční sloupce. Pokus o UPDATE
  -- jiného sloupce skončí chybou oprávnění, tedy hlasitě a v testu.
  -- erased_at MUSÍ být ve výčtu, jinak GDPR výmaz narazí na oprávnění
  -- místo na constraint.
  REVOKE UPDATE, DELETE ON web_events FROM mlain_app;
  GRANT  UPDATE (contact_id, identity_merge_id, erased_at) ON web_events TO mlain_app;

  REVOKE UPDATE ON message_engagement FROM mlain_app;
  GRANT  UPDATE (contact_id, erased_at, first_open_at, last_open_at, open_count,
                 first_human_open_at, human_open_count, open_class_mask,
                 first_click_at, last_click_at, click_count,
                 first_human_click_at, human_click_count, clicked_links)
    ON message_engagement TO mlain_app;

  GRANT UPDATE (contact_id, erased_at, recipient) ON message_events TO mlain_app;

  -- system_settings drží schema_version, ze kterého se odvozuje downgrade
  -- guard migračního runneru. Aplikační role ho přepsat nesmí, jinak si
  -- instalace umí ochranu proti downgradu vypnout sama.
  REVOKE UPDATE, DELETE ON system_settings FROM mlain_app;
  GRANT  UPDATE (secret_key_fingerprint, setup_completed_at, settings, updated_at)
    ON system_settings TO mlain_app;
  REVOKE UPDATE, DELETE ON secret_key_generations FROM mlain_app;
  GRANT  UPDATE (retired_at) ON secret_key_generations TO mlain_app;

  -- -------------------------------------------------------------------------
  -- mlain_sender: KONTRAKTNÍ blok. Přebírá se z části 1, 4.10.1.
  -- Každá tabulka v tomhle bloku MUSÍ mít politiku sender_bypass, jinak grant
  -- nic neznamená; kontroluje to test nad katalogem, ne seznam v kódu.
  -- -------------------------------------------------------------------------
  -- Sloupcové granty na messages: sender smí měnit jen to, co je jeho.
  -- Bez nich by chyba v senderu mohla přepsat render_data nebo email.
  --
  -- created_at ve výčtu SCHVÁLNĚ NENÍ: invariant I1 říká, že celá kampaň leží
  -- v jedné partition vybrané při materializaci a sender do toho nesahá.
  --
  -- ambiguous_count ve výčtu BÝT MUSÍ: reaper nejednoznačných odeslání běží
  -- uvnitř senderu a dělá SET ambiguous_count = ambiguous_count + 1. Bez tohohle
  -- sloupce skončí na permission denied a celý mechanismus ambiguous_dispatch
  -- včetně scénářů OB-03 a OB-04 je neproveditelný.
  GRANT SELECT ON messages TO mlain_sender;
  GRANT UPDATE (status, claimed_by, claimed_at, claim_expires_at,
                dispatch_started_at, attempts, next_attempt_at,
                provider_message_id, sent_at, error_code, error_detail,
                ambiguous_count, updated_at)
    ON messages TO mlain_sender;

  GRANT SELECT ON campaigns TO mlain_sender;
  -- Sloupcový GRANT UPDATE na campaigns: sender smí kampaň POUZE pozastavit.
  -- Grant říká, DO KTERÝCH sloupců smí psát; že smí nastavit jen 'paused',
  -- vynucuje WITH CHECK politiky sender_bypass z migrace 0004. Bez obojího
  -- neplatí circuit breaker, ani pravidlo o 5 % selhání renderu, ani
  -- SENDER_CREDENTIALS_MAX_RETRIES. Grant je sloupcový, NIKDY na celou tabulku:
  -- sender nesmí sáhnout na compiled_html ani na subject.
  GRANT UPDATE (status, pause_reason) ON campaigns TO mlain_sender;

  GRANT SELECT ON sending_providers TO mlain_sender;
  GRANT SELECT ON campaign_links    TO mlain_sender;
  GRANT SELECT ON workspaces        TO mlain_sender;
  -- Bez SELECT na suppressions je přechod claimed -> skipped, který kontrakt
  -- sám povoluje, fyzicky neproveditelný.
  GRANT SELECT ON suppressions      TO mlain_sender;
  GRANT INSERT ON message_events    TO mlain_sender;
  -- Agregovaná varování z renderu. Sender je drží v paměti a zapisuje jednou
  -- za 10 sekund přes INSERT ... ON CONFLICT DO UPDATE. SELECT tu MUSÍ být:
  -- ON CONFLICT DO UPDATE čte existující řádek, takže bez něj skončí zápis
  -- na permission denied ještě dřív, než na něj dopadne RLS.
  GRANT SELECT, INSERT, UPDATE ON campaign_render_warnings TO mlain_sender;

  -- Žádná práva na contacts, web_events, users, sessions, api_keys, audit_log.
  -- Sender kontakty nečte, data má v render_data. Zajišťuje to REVOKE ALL
  -- v cyklu výš, ne výčet tabulek, na které se zapomnělo.

  -- -------------------------------------------------------------------------
  -- mlain_gdpr: výhradně job gdpr.erase. Výmaz podle čl. 17 musí souhlasy
  -- smazat a aplikační role na to právo nemá, protože consents je append only.
  --
  -- SELECT tu MUSÍ být: `DELETE FROM consents WHERE contact_id = $1` čte
  -- sloupec v podmínce, takže se samotným DELETE skončí na
  -- `permission denied for table consents`. Ověřeno spuštěním. Test, který
  -- to nezachytil, mazal bez WHERE, což je tvar, jaký job nikdy nepoužije.
  -- -------------------------------------------------------------------------
  GRANT SELECT, DELETE ON consents TO mlain_gdpr;

  -- -------------------------------------------------------------------------
  -- mlain_maintenance: retenční job. SELECT je tu ze stejného důvodu jako
  -- u mlain_gdpr, politiku maintenance_bypass přidává migrace 0004.
  -- -------------------------------------------------------------------------
  GRANT SELECT, DELETE ON web_events TO mlain_maintenance;

  -- -------------------------------------------------------------------------
  -- mlain_backup: jen pg_dump, nikdy nezapisuje. Roli pg_read_all_data
  -- přiděluje docker/initdb (vyžaduje superuživatele), tady jen USAGE.
  --
  -- pg_read_all_data NENÍ totéž co BYPASSRLS. Pod rolí, na kterou RLS platí,
  -- doběhne pg_dump bez chyby a vyrobí dump, ve kterém má každá chráněná
  -- tabulka NULA ŘÁDKŮ. Kontrolu, že záloha neběží pod takovou rolí, dělá
  -- `mlain backup` (P16); tady se jen nepřiděluje nic, co by to zamaskovalo.
  -- -------------------------------------------------------------------------
END
$fn$;
--> statement-breakpoint

-- Odebrat právo volání všem kromě vlastníka. Kdyby funkci uměla zavolat
-- aplikační role, přidělila by si REVOKE i GRANT sama.
REVOKE ALL ON FUNCTION mlain_apply_grants() FROM PUBLIC;
--> statement-breakpoint

SELECT mlain_apply_grants();
```

Funkce **nemá** `EXCEPTION WHEN undefined_object` (rozhodnutí R19). Na databázi, kde P01 některou roli nezaložil, migrace hlasitě spadne. Předchozí varianta se tvářila odolně a přitom tiše zahazovala celou vrstvu oprávnění: chybějící role znamenala, že příslušná operace navždy nefunguje a v logu je jeden `NOTICE`, který nikdo nečte.

- [ ] **Step 2: Spusť celou dosavadní sadu a ověř, že nic nespadlo**

Run: `pnpm --filter @mlain/db test:db`
Expected: PASS. Testy grantů se píšou v úkolu 22, tady jde jen o to, že migrace prochází.

- [ ] **Step 3: Commit**

```bash
git add packages/db/migrations
git commit -m "feat(db): migration 0005 applies all grants through an idempotent function"
```


---

### Task 21: Migrace 0006, řádek singletonu `system_settings`

**Files:**
- Create: `packages/db/migrations/0006_system_settings_seed.sql`
- Modify: `packages/db/migrations/meta/_journal.json`
- Create: `packages/db/test/system-settings.test.ts`

- [ ] **Step 1: Napiš padající test**

```ts
// packages/db/test/system-settings.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './helpers/container.js';

let h: Harness;
beforeAll(async () => { h = await startHarness(); }, 180_000);
afterAll(async () => { await h.stop(); });

describe('system_settings', () => {
  it('existuje právě jeden řádek', async () => {
    const { rows } = await h.as('mlain_app').query<{ n: number }>(
      'SELECT count(*)::int AS n FROM system_settings');
    expect(rows[0].n).toBe(1);
  });

  it('druhý řádek nejde vložit', async () => {
    await expect(
      h.as('mlain_migrator').query(
        `INSERT INTO system_settings (id, schema_version, secret_key_fingerprint)
         VALUES (false, 0, '')`),
    ).rejects.toThrow();
  });

  it('runner do něj zapsal schema_version rovné počtu migrací', async () => {
    const { rows } = await h.as('mlain_app').query<{ schema_version: number }>(
      'SELECT schema_version FROM system_settings WHERE id = true');
    expect(rows[0].schema_version).toBe(7);
  });

  it('aplikační role NESMÍ přepsat schema_version ani řádek smazat', async () => {
    // Bez tohohle omezení si instalace umí vypnout ochranu proti downgradu
    // sama a runner pak pustí starší schéma nad novějšími daty.
    await expect(h.as('mlain_app').query(
      'UPDATE system_settings SET schema_version = 1 WHERE id = true'),
    ).rejects.toThrow(/permission denied/i);
    await expect(h.as('mlain_app').query('DELETE FROM system_settings'))
      .rejects.toThrow(/permission denied/i);
    // Sloupce, které aplikace plnit MUSÍ, zůstávají zapisovatelné.
    await expect(h.as('mlain_app').query(
      `UPDATE system_settings SET secret_key_fingerprint = 'abc', updated_at = now()
        WHERE id = true`),
    ).resolves.toBeDefined();
  });

  it('tabulka pokolení klíče existuje a je prázdná (plní ji setup, ne migrace)',
    async () => {
      const { rows } = await h.as('mlain_app').query<{ n: number }>(
        'SELECT count(*)::int AS n FROM secret_key_generations');
      expect(rows[0].n).toBe(0);
    });

  it('sloupec settings existuje a je jsonb (rozhodnutí R7)', async () => {
    const { rows } = await h.as('mlain_app').query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns
        WHERE table_name = 'system_settings' AND column_name = 'settings'`);
    expect(rows[0].data_type).toBe('jsonb');
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm --filter @mlain/db test:db -- test/system-settings.test.ts`
Expected: FAIL, počet řádků je 0.

- [ ] **Step 3: Vytvoř ruční migraci a zapiš do ní seed**

Run: `cd /Users/petr/Projects/Mailing_Tool/packages/db && pnpm db:custom --name=system_settings_seed`

Do `migrations/0006_system_settings_seed.sql` zapiš:

```sql
-- Řádek zakládá migrace, ne aplikace: migrační runner na něj zapisuje
-- schema_version hned v prvním běhu a downgrade guard z něj čte.
--
-- secret_key_fingerprint zůstává prázdný, protože migrace SECRET_KEY nezná
-- a znát nemá. Doplní ho POST /api/v1/setup (P04). Prázdná hodnota tak znamená
-- "instalace ještě neproběhla" a mlain doctor (P16) na ni má dosah.
INSERT INTO system_settings (id, schema_version, secret_key_fingerprint)
VALUES (true, 0, '')
ON CONFLICT (id) DO NOTHING;
```

- [ ] **Step 4: Spusť test a ověř, že projde**

Run: `pnpm --filter @mlain/db test:db -- test/system-settings.test.ts`
Expected: PASS, 6 testů. Očekávaná hodnota `schema_version` je **7**, tedy počet migrací; kdyby migrací bylo víc, uprav číslo v testu a v kapitole 3 tohohle plánu naráz.

- [ ] **Step 5: Commit**

```bash
git add packages/db/migrations packages/db/test/system-settings.test.ts
git commit -m "feat(db): migration 0006 seeds the system settings singleton"
```

---

### Task 22: Testy rolí, grantů a nepřístupnosti oddílů

**Files:**
- Create: `packages/db/test/grants.test.ts`

Tenhle soubor zavírá vzorec, který revize pojmenovala jako společnou příčinu většiny nálezů: **ochrana se odvozovala z konstanty v kódu místo ze skutečného stavu databáze.** Každý test tady se ptá katalogu (`pg_roles`, `pg_class.relacl`, `aclexplode`, `pg_policies`), ne seznamu, ze kterého ochrana vznikla. Kdyby se ptal registru, chyběla by politika `sender_bypass` na `campaign_render_warnings` dál a test by byl zelený.

Migrace 0005 dosud jako jediná neměla žádný padající test. Její selhání je přitom tiché v obou směrech: chybějící grant se pozná až v provozu, přebytečný nikdy.

- [ ] **Step 1: Napiš testy**

```ts
// packages/db/test/grants.test.ts
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './helpers/container.js';
import {
  MAINTENANCE_BYPASS_TABLES, SENDER_BYPASS_TABLES,
} from '../src/rls.js';
import { ROLES } from './global-setup.js';

let h: Harness;
beforeAll(async () => { h = await startHarness(); }, 120_000);
afterAll(async () => { await h.stop(); });

/** Skutečné granty z katalogu, ne z registru. */
async function grantsOf(role: string): Promise<Map<string, Set<string>>> {
  const { rows } = await h.as('mlain_migrator').query<
    { relname: string; privilege_type: string }
  >(`SELECT c.relname, a.privilege_type
       FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       CROSS JOIN LATERAL aclexplode(c.relacl) a
      WHERE n.nspname = 'public' AND a.grantee = $1::regrole`, [role]);
  const out = new Map<string, Set<string>>();
  for (const row of rows) {
    if (!out.has(row.relname)) out.set(row.relname, new Set());
    out.get(row.relname)!.add(row.privilege_type);
  }
  // Sloupcové granty se v relacl neobjeví, tabulka se jimi ale stává
  // pro roli přístupnou, takže se musí započítat taky.
  const columns = await h.as('mlain_migrator').query<
    { relname: string; privilege_type: string }
  >(`SELECT c.relname, a.privilege_type
       FROM pg_attribute att
       JOIN pg_class c ON c.oid = att.attrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       CROSS JOIN LATERAL aclexplode(att.attacl) a
      WHERE n.nspname = 'public' AND att.attacl IS NOT NULL
        AND a.grantee = $1::regrole`, [role]);
  for (const row of columns.rows) {
    if (!out.has(row.relname)) out.set(row.relname, new Set());
    out.get(row.relname)!.add(row.privilege_type);
  }
  return out;
}

describe('role a jejich atributy', () => {
  it('všech šest rolí v databázi existuje', async () => {
    // Testovací harness si role zakládá sám, takže tenhle test NEDOKAZUJE,
    // že je založí produkce. Dokazuje, že jich je právě šest a že se seznam
    // v kódu nerozešel se skutečností. Že je zakládá i produkce, je požadavek
    // na P01 v kapitole 7 a hlídá ho `mlain doctor` (P16).
    const { rows } = await h.as('mlain_migrator').query<{ rolname: string }>(
      `SELECT rolname FROM pg_roles WHERE rolname LIKE 'mlain\\_%' ORDER BY 1`);
    expect(rows.map((r) => r.rolname)).toEqual([...ROLES].sort());
  });

  it('žádná aplikační role nemá BYPASSRLS ani superuživatele', async () => {
    // Kdyby P01 založil mlain_app s BYPASSRLS, izolace projektů by zmizela
    // a VŠECHNY ostatní testy by zůstaly zelené, protože RLS by se prostě
    // neuplatnila. Tohle je jediné místo, které to zachytí.
    const { rows } = await h.as('mlain_migrator').query<{
      rolname: string; rolsuper: boolean; rolbypassrls: boolean;
      rolcreatedb: boolean; rolcreaterole: boolean;
    }>(`SELECT rolname, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole
          FROM pg_roles WHERE rolname LIKE 'mlain\\_%'`);
    expect(rows).toHaveLength(6);
    for (const row of rows) {
      expect(row.rolsuper, `${row.rolname} je superuživatel`).toBe(false);
      expect(row.rolbypassrls, `${row.rolname} má BYPASSRLS`).toBe(false);
      expect(row.rolcreatedb, `${row.rolname} má CREATEDB`).toBe(false);
      expect(row.rolcreaterole, `${row.rolname} má CREATEROLE`).toBe(false);
    }
  });

  it('mlain_app nesmí zakládat tabulky (rozhodnutí R30)', async () => {
    // Oddíly zakládá výhradně migrátor. Kdyby je uměla založit aplikace,
    // vznikaly by mimo migrační cestu a bez kontroly.
    await expect(h.as('mlain_app').query('CREATE TABLE pokus_o_tabulku (id int)'))
      .rejects.toThrow(/permission denied/i);
  });
});

describe('granty proti politikám, obojí z katalogu', () => {
  it('každá tabulka s grantem pro mlain_sender má politiku sender_bypass', async () => {
    // Tohle je K3 z bezpečnostní revize. Původní test iteroval seznam
    // SENDER_BYPASS_TABLES, tedy TÝŽ zdroj, ze kterého politiky vznikly,
    // takže tabulku s grantem a bez politiky nemohl najít z principu.
    const granted = await grantsOf('mlain_sender');
    const { rows } = await h.as('mlain_migrator').query<{ tablename: string }>(
      `SELECT tablename FROM pg_policies
        WHERE schemaname = 'public' AND policyname = 'sender_bypass'`);
    const withPolicy = new Set(rows.map((r) => r.tablename));

    for (const table of granted.keys()) {
      expect(withPolicy.has(table),
        `sender má grant na ${table}, ale chybí politika sender_bypass, `
        + `takže dotaz vrátí nula řádků nebo zápis selže na RLS`).toBe(true);
    }
    // A opačně: politika bez grantu je mrtvý kód, který svádí k tomu,
    // považovat tabulku za dostupnou.
    for (const table of withPolicy) {
      expect(granted.has(table),
        `${table} má politiku sender_bypass, ale sender na ni nemá grant`).toBe(true);
    }
    // Registr v kódu musí popisovat totéž. Když se rozejde, je špatně registr,
    // ne katalog.
    expect([...withPolicy].sort()).toEqual([...SENDER_BYPASS_TABLES].sort());
  });

  it('každá tabulka s grantem pro mlain_maintenance má politiku maintenance_bypass',
    async () => {
      const granted = await grantsOf('mlain_maintenance');
      const { rows } = await h.as('mlain_migrator').query<{ tablename: string }>(
        `SELECT tablename FROM pg_policies
          WHERE schemaname = 'public' AND policyname = 'maintenance_bypass'`);
      const withPolicy = new Set(rows.map((r) => r.tablename));
      for (const table of granted.keys()) {
        expect(withPolicy.has(table),
          `mlain_maintenance má grant na ${table} bez politiky, takže DELETE `
          + `ovlivní nula řádků a NEVRÁTÍ CHYBU`).toBe(true);
      }
      expect([...withPolicy].sort()).toEqual([...MAINTENANCE_BYPASS_TABLES].sort());
    });

  it('mlain_gdpr má na consents SELECT i DELETE, ne jen DELETE', async () => {
    // Se samotným DELETE skončí `DELETE FROM consents WHERE contact_id = $1`
    // na permission denied, protože čte sloupec v podmínce. Test, který mazal
    // bez WHERE, to maskoval tvarem, jaký job nikdy nepoužije.
    const granted = await grantsOf('mlain_gdpr');
    expect([...(granted.get('consents') ?? [])].sort()).toEqual(['DELETE', 'SELECT']);
    expect([...granted.keys()], 'mlain_gdpr má práva mimo consents').toEqual(['consents']);
  });

  it('sender nemá grant na žádnou tabulku mimo registr', async () => {
    const granted = await grantsOf('mlain_sender');
    expect([...granted.keys()].sort()).toEqual([...SENDER_BYPASS_TABLES].sort());
  });
});

describe('oddíly nejsou přímo přístupné (rozhodnutí R20)', () => {
  it('žádný oddíl nemá tabulkový ani sloupcový ACL záznam', async () => {
    const { rows } = await h.as('mlain_migrator').query<{ relname: string }>(
      `SELECT c.relname
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relispartition
          AND (c.relacl IS NOT NULL
               OR EXISTS (SELECT 1 FROM pg_attribute a
                           WHERE a.attrelid = c.oid AND a.attacl IS NOT NULL))
        ORDER BY 1`);
    expect(rows.map((r) => r.relname)).toEqual([]);
  });

  it('přímý SELECT z oddílu web_events nevrátí cizí projekt, ale chybu', async () => {
    // Naměřený scénář z revize: přes rodiče vrátí dotaz jeden řádek,
    // přímo na oddíl dva, tedy včetně cizího projektu. S rozhodnutím R20
    // druhá cesta neexistuje.
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    await createMonthlyPartitions(
      h.as('mlain_migrator'), 'web_events', 'received_at', new Date(), 1);
    const { rows: part } = await h.as('mlain_migrator').query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_inherits i ON i.inhrelid = c.oid
        WHERE i.inhparent = 'web_events'::regclass LIMIT 1`);
    const partition = part[0].relname;

    for (const workspace of [ws.workspaceA, ws.workspaceB]) {
      await h.as('mlain_migrator').query(
        `INSERT INTO web_events (id, workspace_id, name, occurred_at)
         VALUES (gen_random_uuid(), $1, 'page_view', now())`, [workspace]);
    }

    const ctxA = unsafeWorkspaceContext(ws.workspaceA, { type: 'system', job: 'test' });
    const viaParent = await withWorkspace(h.as('mlain_app'), ctxA, async (tx) => {
      const r = await tx.execute<{ n: string }>(sql`SELECT count(*)::int AS n FROM web_events`);
      return r.rows[0].n;
    });
    expect(viaParent).toBe(1);

    await expect(
      h.as('mlain_app').query(`SELECT count(*) FROM ${partition}`),
      'přímý přístup na oddíl obchází RLS',
    ).rejects.toThrow(/permission denied/i);
  });

  it('DELETE přímo z oddílu audit_log neprojde', async () => {
    // Naměřeno v revizi: DELETE FROM audit_log skončil permission denied,
    // ale DELETE FROM audit_log_y2026m08 smazal VŠECHNO včetně cizích
    // a globálních auditních záznamů.
    await createMonthlyPartitions(
      h.as('mlain_migrator'), 'audit_log', 'created_at', new Date(), 1);
    const { rows } = await h.as('mlain_migrator').query<{ relname: string }>(
      `SELECT c.relname FROM pg_class c JOIN pg_inherits i ON i.inhrelid = c.oid
        WHERE i.inhparent = 'audit_log'::regclass LIMIT 1`);
    await expect(h.as('mlain_app').query(`DELETE FROM ${rows[0].relname}`))
      .rejects.toThrow(/permission denied/i);
  });
});

describe('mlain_apply_grants() je idempotentní a obnovitelná', () => {
  /** Otisk všech oprávnění, ze kterého jde porovnat "před" a "po". */
  async function aclSnapshot(): Promise<string> {
    const { rows } = await h.as('mlain_migrator').query<{ acl: string }>(
      `SELECT c.relname || ' ' || COALESCE(c.relacl::text, '-') AS acl
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
        ORDER BY c.relname`);
    return rows.map((r) => r.acl).join('\n');
  }

  it('druhé zavolání nezmění ani jedno oprávnění', async () => {
    const before = await aclSnapshot();
    await h.as('mlain_migrator').query('SELECT mlain_apply_grants()');
    expect(await aclSnapshot()).toBe(before);
  });

  it('po ztrátě grantů je funkce obnoví do stejného stavu', async () => {
    // Přesně to, co se stane po obnově z pg_dump --no-privileges: politiky
    // v dumpu jsou, granty ne, a ledger migrací tvrdí, že migrace s granty
    // proběhla. Bez téhle funkce by aplikace skončila na permission denied.
    const before = await aclSnapshot();
    await h.as('mlain_migrator').query(`
      DO $$ DECLARE t text; BEGIN
        FOR t IN SELECT c.relname FROM pg_class c
                   JOIN pg_namespace n ON n.oid = c.relnamespace
                  WHERE n.nspname = 'public' AND c.relkind IN ('r','p')
                    AND c.relispartition = false
        LOOP
          EXECUTE format('REVOKE ALL ON %I FROM mlain_app, mlain_sender, '
                         'mlain_gdpr, mlain_maintenance', t);
        END LOOP;
      END $$`);
    expect(await aclSnapshot()).not.toBe(before);

    await h.as('mlain_migrator').query('SELECT mlain_apply_grants()');
    expect(await aclSnapshot()).toBe(before);
  });

  it('funkci nesmí zavolat aplikační role', async () => {
    await expect(h.as('mlain_app').query('SELECT mlain_apply_grants()'))
      .rejects.toThrow(/permission denied/i);
  });
});
```

Doplň k importům ještě fixture a kontext, které používají testy oddílů:

```ts
import { seedTwoWorkspaces } from './helpers/fixtures.js';
import { unsafeWorkspaceContext } from '../src/unsafe-context.js';
import { withWorkspace } from '../src/repo/tx.js';
import { createMonthlyPartitions } from '../src/partitions.js';
```

- [ ] **Step 2: Spusť testy a ověř výsledek**

Run: `pnpm --filter @mlain/db test:db -- test/grants.test.ts`
Expected: PASS, 13 testů.

Kdyby spadl test „každá tabulka s grantem pro mlain_sender má politiku sender_bypass", **neupravuj registr tak, aby test prošel**. Rozhodni, jestli tabulka do senderova kontraktu patří: když ano, chybí politika v migraci 0004, když ne, patří pryč grant z migrace 0005.

- [ ] **Step 3: Commit**

```bash
git add packages/db/test/grants.test.ts
git commit -m "test(db): grants and role attributes verified against the catalog"
```

---

### Task 23: Klient, kontext a transakční obálka

**Files:**
- Create: `packages/db/src/client.ts`
- Create: `packages/db/src/context.ts`
- Create: `packages/db/src/unsafe-context.ts`
- Create: `packages/db/src/repo/tx.ts`
- Create: `packages/db/test/context.test.ts`

`unsafeWorkspaceContext` má **vlastní soubor a vlastní podcestu** `@mlain/db/unsafe-context`. Z kořenového exportu je vynechaná. Dokud byla v `@mlain/db` vedle `withWorkspace`, byla jediná ochrana proti jejímu použití pravidlo ESLintu, které si tenhle plán jen přál a po nikom ho nevyžádal; našeptávač ji přitom nabízel každému, kdo psal `import { w` .`

Repository vrstva je **primární obrana** a jediná, na které závisí funkčnost. RLS je druhá vrstva, která zachytí chybu v první.

`WorkspaceContext` je branded typ, který **nejde vyrobit z řetězce**. Kdyby repository funkce brala `workspaceId: string`, dřív nebo později by jí někdo předal hodnotu z URL nebo z těla requestu.

- [ ] **Step 1: Napiš padající test**

```ts
// packages/db/test/context.test.ts
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './helpers/container.js';
import { seedTwoWorkspaces } from './helpers/fixtures.js';
import { unsafeWorkspaceContext } from '../src/unsafe-context.js';
import {
  pgErrorCode, withReadOnly, withUser, withWorkspace, withoutContext,
} from '../src/repo/tx.js';
import { checkIsolationPrerequisites } from '../src/client.js';

let h: Harness;
beforeAll(async () => { h = await startHarness(); }, 180_000);
afterAll(async () => { await h.stop(); });

describe('transakční obálka', () => {
  it('nastaví mlain.workspace_id na dobu transakce a po ní ho zapomene', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctx = unsafeWorkspaceContext(ws.workspaceA, { type: 'system', job: 'test' });

    const inside = await withWorkspace(h.as('mlain_app'), ctx, async (tx) => {
      const { rows } = await tx.execute(sql`SELECT current_setting('mlain.workspace_id', true) AS ws`);
      return rows[0].ws;
    });
    expect(inside).toBe(ws.workspaceA);

    const { rows } = await h.as('mlain_app').query(
      `SELECT current_setting('mlain.workspace_id', true) AS ws`);
    expect(rows[0].ws).toBeNull();
  });

  it('u aktéra typu user nastaví i mlain.user_id', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctx = unsafeWorkspaceContext(ws.workspaceA,
      { type: 'user', userId: ws.userId, role: 'owner' });
    const seen = await withWorkspace(h.as('mlain_app'), ctx, async (tx) => {
      const { rows } = await tx.execute(sql`SELECT current_setting('mlain.user_id', true) AS u`);
      return rows[0].u;
    });
    expect(seen).toBe(ws.userId);
  });

  it('výjimka uvnitř transakci rollbackne', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctx = unsafeWorkspaceContext(ws.workspaceA, { type: 'system', job: 'test' });
    await expect(withWorkspace(h.as('mlain_app'), ctx, async (tx) => {
      await tx.execute(sql`INSERT INTO tags (workspace_id, name) VALUES (${ws.workspaceA}, 'rollback-me')`);
      throw new Error('bum');
    })).rejects.toThrow('bum');

    const after = await withWorkspace(h.as('mlain_app'), ctx, async (tx) => {
      const { rows } = await tx.execute(sql`SELECT count(*)::int AS n FROM tags`);
      return rows[0].n;
    });
    expect(after).toBe(0);
  });

  it('withUser nastaví mlain.user_id a NEnastaví mlain.workspace_id', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const seen = await withUser(h.as('mlain_app'), ws.userId, async (tx) => {
      const { rows } = await tx.execute(sql`SELECT current_setting('mlain.user_id', true) AS u,
                NULLIF(current_setting('mlain.workspace_id', true), '') AS w`);
      return rows[0];
    });
    expect(seen.u).toBe(ws.userId);
    expect(seen.w).toBeNull();
  });

  it('druhý dotaz ze stejného spojení bez kontextu vrátí prázdno, ne chybu 22P02',
    async () => {
      // Po SET LOCAL vrací current_setting(..., true) na TOMTÉŽ spojení
      // po commitu prázdný řetězec, ne NULL. Politika s holým
      // current_setting(...)::uuid by tedy skončila chybou
      // "invalid input syntax for type uuid" místo prázdného výsledku,
      // a to až v provozu, kde se spojení recyklují. Proto NULLIF (R21).
      const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
      const ctx = unsafeWorkspaceContext(ws.workspaceA, { type: 'system', job: 'test' });
      const pool = h.as('mlain_app');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('mlain.workspace_id', $1, true)`,
          [ws.workspaceA]);
        await client.query('COMMIT');
        // Prázdný řetězec, ne NULL. Tohle je ten stav.
        const { rows: leaked } = await client.query<{ w: string | null }>(
          `SELECT current_setting('mlain.workspace_id', true) AS w`);
        expect(leaked[0].w).toBe('');
        // A přesto musí dotaz vrátit nula řádků, ne spadnout.
        const { rows } = await client.query('SELECT * FROM contacts');
        expect(rows).toHaveLength(0);
      } finally {
        client.release();
      }
      // Kontext se pak dá nastavit znovu a funguje.
      const seen = await withWorkspace(pool, ctx, async (tx) => {
        const r = await tx.execute(sql`SELECT count(*)::int AS n FROM contacts`);
        return r.rows[0].n;
      });
      expect(seen).toBe(1);
    });

  it('bootstrap politika nepustí založení projektu na spojení po přihlášeném uživateli',
    async () => {
      // Prázdný řetězec je IS NOT NULL, takže holá podmínka by pustila INSERT
      // bez jakéhokoli aktéra na každém spojení, které kdy obsloužilo přihlášení.
      const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
      const client = await h.as('mlain_app').connect();
      try {
        await client.query('BEGIN');
        await client.query(`SELECT set_config('mlain.user_id', $1, true)`, [ws.userId]);
        await client.query('COMMIT');
        await expect(client.query(
          `INSERT INTO workspaces (name, slug, locale, timezone)
           VALUES ('podvrh', 'podvrh-ws', 'cs', 'Europe/Prague')`),
        ).rejects.toThrow(/row-level security/i);
      } finally {
        client.release();
      }
    });

  it('přenastavení kontextu uvnitř read-only transakce shodí celou operaci', async () => {
    // BEGIN READ ONLY nezakazuje SET LOCAL. Náhled segmentu spouští dynamicky
    // sestavené SQL, takže injekce v něm by si mohla přepnout kontext
    // na cizí projekt a přečíst cizí kontakty. Obálka to musí poznat
    // a výsledek NEVYDAT.
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctxB = unsafeWorkspaceContext(ws.workspaceB, { type: 'system', job: 'test' });
    await expect(withReadOnly(h.as('mlain_app'), ctxB, { statementTimeoutMs: 3000 }, async (tx) => {
      await tx.execute(sql`SELECT set_config('mlain.workspace_id', ${ws.workspaceA}, true)`);
      const r = await tx.execute(sql`SELECT * FROM contacts`);
      return r.rows;
    })).rejects.toThrow(/kontext/i);
  });

  it('checkIsolationPrerequisites pozná roli, na kterou se RLS nevztahuje', async () => {
    // Bez téhle kontroly dostane samohostitel s jedinou databázovou rolí
    // funkční aplikaci BEZ IZOLACE PROJEKTŮ a nedozví se to.
    expect(await checkIsolationPrerequisites(h.as('mlain_app'))).toEqual([]);

    const migratorReasons = await checkIsolationPrerequisites(h.as('mlain_migrator'));
    expect(migratorReasons.join(' ')).toMatch(/vlastní schéma public/);
  });

  it('spojení se do poolu nevrací s cizím kontextem ani po chybě', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctx = unsafeWorkspaceContext(ws.workspaceA, { type: 'system', job: 'test' });
    await expect(withWorkspace(h.as('mlain_app'), ctx, async () => {
      throw new Error('bum');
    })).rejects.toThrow('bum');

    // Pool má max 4 spojení, takže projdeme všechna: kdyby se některé vrátilo
    // s nastaveným kontextem, další nájemce by viděl cizí data.
    for (let i = 0; i < 4; i += 1) {
      const client = await h.as('mlain_app').connect();
      try {
        const { rows } = await client.query<{ w: string | null }>(
          `SELECT NULLIF(current_setting('mlain.workspace_id', true), '') AS w`);
        expect(rows[0].w).toBeNull();
      } finally {
        client.release();
      }
    }
  });
});

describe('tvar transakčního handle', () => {
  // Kdyby Tx zůstal PoolClient, projde tenhle test až ve chvíli, kdy se
  // datová vrstva NEZKOMPILUJE. Proto se ptá za běhu, ne typem.
  it('Tx je Drizzle handle, ne syrový PoolClient', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctx = unsafeWorkspaceContext(ws.workspaceA, { type: 'system', job: 'test' });
    await withWorkspace(h.as('mlain_app'), ctx, async (tx) => {
      for (const method of ['select', 'insert', 'update', 'delete', 'execute']) {
        expect(typeof (tx as unknown as Record<string, unknown>)[method],
          `Tx nemá ${method}, což znamená, že to není Drizzle handle`).toBe('function');
      }
    });
  });

  // Tenhle vzor P04 našel na 41 místech u sebe. Projde typovou kontrolou
  // i revizí a za běhu vrátí undefined při prvním rows[0].
  it('tx.execute vrací obálku výsledku, ne pole řádků', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctx = unsafeWorkspaceContext(ws.workspaceA, { type: 'system', job: 'test' });
    await withWorkspace(h.as('mlain_app'), ctx, async (tx) => {
      const result = await tx.execute(sql`SELECT 1 AS x`);
      expect(Array.isArray(result),
        'kdyby to bylo pole, byl by vzor `as unknown as Row[]` v pořádku').toBe(false);
      expect(Array.isArray(result.rows)).toBe(true);
      expect((result as unknown as unknown[])[0],
        'takhle se ta vada projeví: index na obálce je undefined').toBeUndefined();
    });
  });

  it('pgErrorCode najde kód z Drizzle chyby i ze syrové chyby pg', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctx = unsafeWorkspaceContext(ws.workspaceA, { type: 'system', job: 'test' });

    // (a) přes Drizzle: kód je na cause, error.code je undefined
    let viaDrizzle: unknown;
    try {
      await withWorkspace(h.as('mlain_app'), ctx, async (tx) => {
        await tx.execute(sql`INSERT INTO tags (workspace_id, name)
                             VALUES (${ws.workspaceA}, 'dup')`);
        await tx.execute(sql`INSERT INTO tags (workspace_id, name)
                             VALUES (${ws.workspaceA}, 'dup')`);
      });
    } catch (error) { viaDrizzle = error; }
    expect((viaDrizzle as { code?: unknown }).code,
      'kdyby tu byl kód, byl by vzor error.code správný').toBeUndefined();
    expect(pgErrorCode(viaDrizzle)).toBe('23505');

    // (b) přes syrový pool: kód je přímo na error.code a cause není
    let viaRaw: unknown;
    try {
      await h.as('mlain_migrator').query(
        `INSERT INTO workspaces (id, name, slug, locale, timezone)
         VALUES ($1, 'dup', 'dup-slug', 'cs', 'Europe/Prague'), 
                ($1, 'dup', 'dup-slug2', 'cs', 'Europe/Prague')`, [ws.workspaceA]);
    } catch (error) { viaRaw = error; }
    expect(pgErrorCode(viaRaw)).toBe('23505');
  });
});

describe('withoutContext', () => {
  it('na tabulce s RLS nevrátí nic, na platformové tabulce funguje', async () => {
    // Není to zadní vrátka. Kontext se nenastaví, takže RLS nepustí ani řádek;
    // použitelná je výhradně nad tabulkami z TABLES_WITHOUT_RLS.
    await seedTwoWorkspaces(h.as('mlain_migrator'));
    const seen = await withoutContext(h.as('mlain_app'), async (tx) => {
      const chranene = await tx.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM contacts`);
      await tx.execute(sql`INSERT INTO rate_limits (bucket, window_start, hits, expires_at)
        VALUES ('user:u1:login', date_trunc('minute', now()), 1, now() + interval '1 minute')
        ON CONFLICT (bucket, window_start) DO UPDATE SET hits = rate_limits.hits + 1`);
      const limity = await tx.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM rate_limits`);
      return { chranene: chranene.rows[0].n, limity: limity.rows[0].n };
    });
    expect(seen.chranene, 'bez kontextu nesmí RLS pustit ani řádek').toBe(0);
    expect(seen.limity, 'rate_limits RLS nemá, takže limiter funguje').toBe(1);
  });

  it('zápis do tabulky s RLS bez kontextu skončí chybou, ne tichým nic', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    await expect(withoutContext(h.as('mlain_app'), async (tx) => {
      await tx.execute(sql`INSERT INTO tags (workspace_id, name)
                           VALUES (${ws.workspaceA}, 'bez-kontextu')`);
    })).rejects.toThrow(/row-level security/i);
  });
});

describe('withReadOnly a SET LOCAL', () => {
  it('pustí dovnitř work_mem i statement_timeout a po commitu je vrátí', async () => {
    // Požadavek P11 (3.6). Bez work_mem se řazení nad velkým publikem přelije
    // na disk a tvrdý strop doby běhu vyprší dřív, než náhled segmentu doběhne.
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctx = unsafeWorkspaceContext(ws.workspaceA, { type: 'system', job: 'test' });
    const uvnitr = await withReadOnly(h.as('mlain_app'), ctx,
      { statementTimeoutMs: 3000, workMem: '64MB' }, async (tx) => {
        const { rows } = await tx.execute<{ wm: string; st: string; ro: string }>(
          sql`SELECT current_setting('work_mem') AS wm,
                     current_setting('statement_timeout') AS st,
                     current_setting('transaction_read_only') AS ro`);
        return rows[0];
      });
    expect([uvnitr.wm, uvnitr.st, uvnitr.ro]).toEqual(['64MB', '3s', 'on']);

    // Po transakci se hodnota vrací; SET LOCAL ji na spojení nenechá.
    const { rows } = await h.as('mlain_app').query<{ wm: string }>(
      `SELECT current_setting('work_mem') AS wm`);
    expect(rows[0].wm).not.toBe('64MB');
  });

  it('work_mem mimo povolený tvar se odmítne dřív, než se sáhne na databázi', async () => {
    // SET LOCAL NEJDE parametrizovat, hodnota se do příkazu vkládá textem.
    // Bez téhle kontroly je to přímá cesta k injekci pod aplikační rolí.
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctx = unsafeWorkspaceContext(ws.workspaceA, { type: 'system', job: 'test' });
    await expect(withReadOnly(h.as('mlain_app'), ctx,
      { statementTimeoutMs: 3000, workMem: "64MB'; DROP TABLE contacts; --" },
      async () => 'nemělo doběhnout')).rejects.toThrow(/work_mem/);

    // A tabulka pořád existuje.
    const { rows } = await h.as('mlain_migrator').query<{ n: number }>(
      `SELECT count(*)::int AS n FROM information_schema.tables
        WHERE table_name = 'contacts'`);
    expect(rows[0].n).toBe(1);
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm --filter @mlain/db test:db -- test/context.test.ts`
Expected: FAIL, `Cannot find module '../src/unsafe-context.js'`. Je to první chybějící modul v pořadí importů; `context.ts` samotný test neimportuje, bere si z něj jen typy přes `unsafe-context.ts`.

- [ ] **Step 3: Napiš `src/context.ts`**

```ts
// packages/db/src/context.ts

declare const brand: unique symbol;

export type Role = 'owner' | 'admin' | 'editor' | 'viewer';
export type Permission = string;  // 'resource:action', úplný registr vlastní P04

export type Actor =
  | { type: 'user'; userId: string; role: Role }
  | { type: 'api_key'; apiKeyId: string; scopes: readonly Permission[] }
  | { type: 'system'; job: string };

/**
 * Branded typ. NEJDE ho vyrobit z řetězce a je to jeho jediný smysl.
 * Jediná legitimní továrna žije v packages/core/identity (P04) a ověřuje
 * členství nebo klíč. Odkud se bere workspaceId:
 *   - aktér api_key: z api_keys.workspace_id, NIKDY z URL ani z těla requestu
 *   - aktér user:    ze segmentu cesty /w/{slug} nebo z hlavičky X-Workspace-Id,
 *                    vždy po ověření členství
 */
export type WorkspaceContext = {
  readonly [brand]: 'WorkspaceContext';
  readonly workspaceId: string;
  readonly actor: Actor;
};

```

Funkce, která kontext vyrábí, je ve **vlastním souboru**:

```ts
// packages/db/src/unsafe-context.ts
import type { Actor, WorkspaceContext } from './context.js';

/**
 * Jediná cesta, jak kontext vyrobit. Je určená pro testy a pro migrační
 * a údržbové joby, které žádného uživatele nemají.
 *
 * Soubor je zvlášť a z kořenového exportu `@mlain/db` je VYNECHANÝ. Importuje
 * se výhradně podcestou `@mlain/db/unsafe-context`, tedy vždy vědomě.
 * Když byla vedle withWorkspace v hlavním exportu, nabízel ji našeptávač
 * každému a jediná ochrana bylo pravidlo ESLintu, které si tenhle plán přál,
 * ale po nikom si ho nevyžádal. Že v kořenovém exportu není, hlídá test
 * v posledním úkolu.
 *
 * Aplikační kód ji volat NESMÍ: obešel by ověření členství, což je celá
 * obrana první vrstvy. Legitimní továrna žije v packages/core/identity (P04).
 */
export function unsafeWorkspaceContext(workspaceId: string, actor: Actor): WorkspaceContext {
  return { workspaceId, actor } as WorkspaceContext;
}
```

- [ ] **Step 4: Napiš `src/repo/tx.ts`**

```ts
// packages/db/src/repo/tx.ts
import { sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool, PoolClient } from 'pg';
import type { WorkspaceContext } from '../context.js';
import * as schema from '../schema/index.js';

/**
 * Transakční handle. Je to DRIZZLE handle, ne syrový PoolClient (rozhodnutí R34).
 *
 * Syrový `pg.PoolClient` umí jen `client.query(text, params)`. Nemá `.select()`,
 * `.insert()` ani `.execute()`, takže by se proti němu nezkompilovala jediná
 * doménová funkce a padlo by to naráz v P04, P07, P10, P11, P13, P14 a P15.
 *
 * Handle se vyrábí obalením JEDNOHO vyhrazeného spojení, ne přes
 * `drizzle(pool).transaction()`. Ověřeno spuštěním a jsou pro to dva důvody:
 *   1. `drizzle(pool).transaction()` předá callbacku `NodePgTransaction`,
 *      ne `NodePgDatabase`, takže by neseděl typ, který deklaruje P04.
 *   2. Nad transakcí, kterou otevírá Drizzle, ztrácíme kontrolu nad spojením
 *      a nemůžeme po neúspěšném ROLLBACK zahodit rozbité spojení přes
 *      `release(true)`. To je ochrana, kterou tenhle plán mít musí: spojení
 *      vrácené do poolu s cizí otevřenou transakcí dostane další nájemce.
 */
export type Tx = NodePgDatabase<typeof schema>;

/**
 * POZOR na tvar výsledku. `tx.execute(sql`...`)` vrací OBÁLKU výsledku
 * (`pg.Result`), ne pole řádků. Ověřeno spuštěním: `Array.isArray(result)`
 * je `false` a řádky leží na `result.rows`.
 *
 * Vzor `const rows = await tx.execute(...) as unknown as Row[]` proto projde
 * typovou kontrolou i revizí a ZA BĚHU VRÁTÍ undefined při prvním `rows[0]`.
 * Správně je vždycky `const { rows } = await tx.execute(...)`.
 */

/** Kolik smí trvat dotaz a kolik paměti dostane na řazení a hash spojení. */
export type ReadOnlyOptions = {
  statementTimeoutMs: number;
  /**
   * Volitelný work_mem, například '64MB'. Náhled segmentu na něm stojí:
   * bez něj se řazení nad velkým publikem přelije na disk a tvrdý strop
   * doby běhu vyprší dřív, než dotaz doběhne (požadavek P11, 3.6).
   */
  workMem?: string;
};

/**
 * SET LOCAL NEJDE parametrizovat, hodnota se do příkazu vkládá textem.
 * Bez téhle kontroly by `workMem` z konfigurace nebo z požadavku byl
 * přímá cesta k injekci do příkazu, který běží pod aplikační rolí.
 */
function assertSafeWorkMem(value: string): void {
  if (!/^\d{1,6}(kB|MB|GB)$/.test(value)) {
    throw new Error(`work_mem '${value}' nemá povolený tvar, například '64MB'`);
  }
}

/**
 * Společné jádro všech obálek. Drží tři věci, které se nesmí opakovat
 * v každé z nich zvlášť, protože by se rozešly:
 *   - vyhrazené spojení a jeho úklid, včetně zahození rozbitého spojení,
 *   - Drizzle handle nad tím jedním spojením,
 *   - kontrola, že se kontext uvnitř transakce nezměnil.
 */
async function runInTransaction<T>(
  pool: Pool,
  begin: string,
  setup: (tx: Tx, client: PoolClient) => Promise<void>,
  expectedWorkspaceId: string | null,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  const tx = drizzle(client, { schema, casing: 'snake_case' }) as Tx;
  let broken = false;
  try {
    await client.query(begin);
    await setup(tx, client);
    const result = await fn(tx);
    if (expectedWorkspaceId !== null) {
      await assertContextUnchanged(client, expectedWorkspaceId);
    }
    await client.query('COMMIT');
    return result;
  } catch (error) {
    // Když ROLLBACK selže, je spojení v neznámém stavu a NESMÍ se vrátit
    // do poolu: další nájemce by dostal transakci a kontext předchozího.
    // client.release(true) ho zahodí a pool otevře nové.
    try {
      await client.query('ROLLBACK');
    } catch {
      broken = true;
    }
    throw error;
  } finally {
    client.release(broken || undefined);
  }
}

/**
 * Ověří, že se kontext uvnitř transakce nezměnil.
 *
 * `SET LOCAL` uvnitř transakce nikdo nezakáže, ani v režimu READ ONLY.
 * U cest, které spouštějí dynamicky sestavené SQL (náhled segmentu), by tedy
 * injekce mohla přepnout kontext na cizí projekt a přečíst cizí data.
 * Kontrola po doběhnutí callbacku je poslední místo, kde to jde zachytit
 * dřív, než výsledek opustí tuhle funkci: transakce se rollbackne a volající
 * dostane chybu, ne data.
 *
 * Chytá i druhý případ, na který by nikdo nemyslel: kdyby volající uvnitř
 * zavolal `tx.transaction()`, Drizzle by poslal vlastní BEGIN a COMMIT
 * a předčasně by potvrdil NAŠI transakci. Po takovém commitu je hodnota
 * ze `SET LOCAL` pryč (vrací prázdný řetězec, viz R21), takže se to tady
 * projeví jako změněný kontext a transakce se zruší.
 */
async function assertContextUnchanged(client: PoolClient, expected: string): Promise<void> {
  const { rows } = await client.query<{ w: string | null }>(
    `SELECT NULLIF(current_setting('mlain.workspace_id', true), '') AS w`);
  if (rows[0].w !== expected) {
    throw new Error(
      `kontext projektu se uvnitř transakce změnil z ${expected} na ${rows[0].w}; `
      + 'transakce se ruší a výsledek se nevydává',
    );
  }
}

/**
 * Otevře transakci a nastaví mlain.workspace_id na dobu jejího trvání.
 * Třetí argument set_config je `true`, tedy SET LOCAL: hodnota platí do konce
 * transakce a nepřenese se na další dotaz ze stejného spojení v poolu.
 *
 * Bez transakce se dotaz nespustí a repository vrstva ji vždy otevírá.
 */
export async function withWorkspace<T>(
  pool: Pool,
  ctx: WorkspaceContext,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return runInTransaction(pool, 'BEGIN', async (_tx, client) => {
    await client.query(`SELECT set_config('mlain.workspace_id', $1, true)`, [ctx.workspaceId]);
    if (ctx.actor.type === 'user') {
      await client.query(`SELECT set_config('mlain.user_id', $1, true)`, [ctx.actor.userId]);
    }
  }, ctx.workspaceId, fn);
}

/**
 * Transakce BEZ workspace kontextu, jen s mlain.user_id. Existuje pro dvě
 * operace nad workspaces, které kontext z principu nemají: výpis projektů
 * aktéra (kontextů je víc než jeden) a založení projektu (kontext ještě
 * neexistuje). Používají ji jen repo/workspaces-global.ts a repo/audit-global.ts.
 *
 * mlain.user_id nastavuje výhradně už ověřená session, NIKDY hodnota
 * z requestu. Kdo ho nenastaví, nevidí nic, protože current_setting(..., true)
 * vrátí NULL.
 */
export async function withUser<T>(
  pool: Pool,
  userId: string,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return runInTransaction(pool, 'BEGIN', async (_tx, client) => {
    await client.query(`SELECT set_config('mlain.user_id', $1, true)`, [userId]);
  }, null, fn);
}

/**
 * Transakce ÚPLNĚ BEZ kontextu: ani projekt, ani uživatel.
 *
 * Je pro cesty, které žádného aktéra nemají a mít nemůžou: přihlášení
 * (čte `users`, zapisuje `sessions`), rate limiting nad `rate_limits`,
 * čtení `system_settings` při startu a migrační a údržbové joby.
 *
 * NENÍ to zadní vrátka. Kontext se nenastaví, takže na každé tabulce s RLS
 * vrátí dotaz NULA ŘÁDKŮ a zápis skončí chybou row-level security. Použitelná
 * je výhradně nad tabulkami z TABLES_WITHOUT_RLS. Ověřeno spuštěním: pod rolí
 * bez kontextu vrátí `SELECT` z `contacts` nula řádků, zatímco `rate_limits`
 * čte i zapisuje normálně.
 *
 * Tohle je ta varianta, kterou P04 čeká pod jménem `withoutContext`
 * a bez které si každý volající vyráběl vlastní obcházku.
 */
export async function withoutContext<T>(
  pool: Pool,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return runInTransaction(pool, 'BEGIN', async () => { /* žádný kontext */ }, null, fn);
}

/**
 * Transakce jen pro čtení s tvrdým stropem doby běhu. Používá ji náhled
 * segmentu, který spouští dynamicky sestavené SQL: chyba v kompilátoru nesmí
 * mít možnost zapsat. Strop 3 s spoléhá na chybu 57014 query_canceled.
 *
 * Ověřeno spuštěním, že `SET LOCAL work_mem` i `SET LOCAL statement_timeout`
 * uvnitř `BEGIN READ ONLY` skutečně platí a po commitu se hodnota vrací
 * na původní. READ ONLY zakazuje zápis, ne nastavování parametrů.
 */
export async function withReadOnly<T>(
  pool: Pool,
  ctx: WorkspaceContext,
  options: ReadOnlyOptions,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  if (options.workMem !== undefined) assertSafeWorkMem(options.workMem);
  return runInTransaction(pool, 'BEGIN READ ONLY', async (_tx, client) => {
    await client.query(`SET LOCAL statement_timeout = ${Math.trunc(options.statementTimeoutMs)}`);
    if (options.workMem !== undefined) {
      await client.query(`SET LOCAL work_mem = '${options.workMem}'`);
    }
    await client.query(`SELECT set_config('mlain.workspace_id', $1, true)`, [ctx.workspaceId]);
  }, ctx.workspaceId, fn);
}

/**
 * Kód chyby PostgreSQL, ať přišla odkudkoli (rozhodnutí R35).
 *
 * Ověřeno spuštěním na drizzle-orm 0.45 a pg 8.22 a je to past, na kterou
 * se nedá přijít čtením:
 *   - chyba z Drizzle je `DrizzleQueryError`, kde je `error.code`
 *     **undefined** a kód `23505` leží na `error.cause.code`;
 *   - chyba ze syrového `pool.query` má kód přímo na `error.code`
 *     a žádné `cause` nemá.
 *
 * Každé ošetření kolize napsané jen podle jednoho z těch dvou vzorů se tedy
 * NIKDY neprovede a projde přitom typovou kontrolou i revizí. Proto jeden
 * pomocník a žádné přímé sahání na `code`.
 */
export function pgErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const direct = (error as { code?: unknown }).code;
  if (typeof direct === 'string') return direct;
  const cause = (error as { cause?: unknown }).cause;
  if (typeof cause === 'object' && cause !== null) {
    const nested = (cause as { code?: unknown }).code;
    if (typeof nested === 'string') return nested;
  }
  return undefined;
}
```

Adaptér P04 v `packages/core/tx` **tuhle logiku neopakuje**. Bere jen pool ze singletonu a předává ho sem, takže transakční logika (BEGIN, `set_config`, kontrola kontextu, úklid rozbitého spojení) existuje v celém repozitáři **jednou**. Kdyby si ji P04 napsal znovu, byly by to dvě implementace téhož a ta druhá by neměla ani kontrolu kontextu, ani `release(true)`.

- [ ] **Step 5: Napiš `src/client.ts`**

```ts
// packages/db/src/client.ts
import { Pool, type PoolConfig } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './schema/index.js';

export type PoolKind = 'app' | 'readOnly';

/**
 * Časová zóna se vynucuje NA KAŽDÉM SPOJENÍ, ne jen na databázi.
 * ALTER DATABASE smí vlastník databáze nebo superuživatel, a mlain_migrator
 * je ani jeden, takže u externí databáze, kterou nespravujeme, je tohle
 * jediná spolehlivá cesta.
 */
const BASE: PoolConfig = { options: '-c timezone=UTC' };

export function createPool(url: string, kind: PoolKind = 'app', max = 10): Pool {
  return new Pool({
    ...BASE,
    connectionString: url,
    max,
    // Náhled segmentu spouští dynamicky sestavené SQL. Chyba v kompilátoru
    // nesmí mít možnost zapsat, proto je celý pool read-only.
    options: kind === 'readOnly'
      ? '-c timezone=UTC -c default_transaction_read_only=on'
      : BASE.options,
  });
}

export function createDb(pool: Pool) {
  return drizzle(pool, { schema, casing: 'snake_case' });
}

export type Database = ReturnType<typeof createDb>;

/**
 * Ověří, že aplikace neběží pod rolí, na kterou se izolace nevztahuje.
 *
 * Celý model izolace mlčky předpokládá, že `mlain_app` schéma nevlastní a nemá
 * BYPASSRLS. U samohostitele s managed PostgreSQL, kde je k dispozici jediná
 * role (typicky vlastník databáze nebo rovnou superuživatel), ten předpoklad
 * neplatí a **aplikace se rozeběhne úplně normálně, jen bez izolace projektů**.
 * Nic nespadne, žádný test to nezachytí a zákazník se to nedozví.
 *
 * Volá se při startu aplikace (P04) a z `mlain doctor` (P16). Vrací seznam
 * důvodů; prázdný seznam znamená, že je konfigurace v pořádku.
 */
export async function checkIsolationPrerequisites(pool: Pool): Promise<string[]> {
  const { rows } = await pool.query<{
    rolname: string; rolsuper: boolean; rolbypassrls: boolean; owns_schema: boolean;
  }>(`SELECT r.rolname, r.rolsuper, r.rolbypassrls,
             (n.nspowner = r.oid) AS owns_schema
        FROM pg_roles r
        JOIN pg_namespace n ON n.nspname = 'public'
       WHERE r.rolname = current_user`);

  const row = rows[0];
  const reasons: string[] = [];
  if (!row) return ['roli aktuálního spojení se nepodařilo zjistit'];
  if (row.rolsuper) {
    reasons.push(`role ${row.rolname} je superuživatel, row-level security se na ni `
      + 'nevztahuje a projekty nejsou izolované');
  }
  if (row.rolbypassrls) {
    reasons.push(`role ${row.rolname} má atribut BYPASSRLS, projekty nejsou izolované`);
  }
  if (row.owns_schema) {
    reasons.push(`role ${row.rolname} vlastní schéma public, takže se na ni politiky `
      + 'RLS neuplatní; aplikace musí běžet pod mlain_app, ne pod migrátorem');
  }
  return reasons;
}
```

- [ ] **Step 6: Spusť test a ověř, že projde**

Run: `pnpm --filter @mlain/db test:db -- test/context.test.ts`
Expected: PASS, 16 testů (9 v „transakční obálka", 3 v „tvar transakčního handle", 2 v `withoutContext`, 2 v „withReadOnly a SET LOCAL").

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/client.ts packages/db/src/context.ts packages/db/src/unsafe-context.ts packages/db/src/repo/tx.ts packages/db/test/context.test.ts
git commit -m "feat(db): workspace context, transaction wrappers and pooled client"
```

---

### Task 24: Dvě globální repository a registr repository modulů

**Files:**
- Create: `packages/db/src/repo/workspaces-global.ts`
- Create: `packages/db/src/repo/audit-global.ts`
- Create: `packages/db/src/repo/registry.ts`
- Create: `packages/db/test/workspaces-global.test.ts`

Tyhle dvě repository existují **jen proto, že si je RLS vynutila.** Všechno ostatní čtení jde přes doménové repository v `packages/core`, které si píší doménové plány.

Registr modulů je mechanismus pro generický test izolace napříč doménami: doménový plán se do něj zaregistruje a jeho čtecí funkce se automaticky zavolají pod cizím kontextem. Části 2 až 5 tedy nemusí psát vlastní izolační testy.

- [ ] **Step 1: Napiš padající test**

```ts
// packages/db/test/workspaces-global.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './helpers/container.js';
import { seedTwoWorkspaces } from './helpers/fixtures.js';
import { createWorkspaceAsUser, listWorkspacesForUser } from '../src/repo/workspaces-global.js';
import { listGlobalAuditForUser } from '../src/repo/audit-global.js';

let h: Harness;
beforeAll(async () => { h = await startHarness(); }, 180_000);
afterAll(async () => { await h.stop(); });

describe('workspaces-global (kritérium 21d)', () => {
  it('výpis pod nastaveným mlain.user_id vrátí jen projekty s členstvím', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const rows = await listWorkspacesForUser(h.as('mlain_app'), ws.userId);
    expect(rows.map((r) => r.id).sort()).toEqual([ws.workspaceA, ws.workspaceB].sort());
  });

  it('výpis pro cizího uživatele vrátí 0 řádků', async () => {
    await seedTwoWorkspaces(h.as('mlain_migrator'));
    const rows = await listWorkspacesForUser(
      h.as('mlain_app'), '01930000-0000-7000-8000-000000000000');
    expect(rows).toHaveLength(0);
  });

  it('založení projektu bez mlain.user_id selže na WITH CHECK', async () => {
    await expect(
      h.as('mlain_app').query(
        `INSERT INTO workspaces (name, slug, locale, timezone)
         VALUES ('x', 'no-context-ws', 'cs', 'Europe/Prague')`),
    ).rejects.toThrow(/row-level security/i);
  });

  it('založení projektu s nastaveným mlain.user_id projde', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const created = await createWorkspaceAsUser(h.as('mlain_app'), ws.userId, {
      name: 'Nový projekt', slug: `novy-${Date.now()}`, locale: 'cs',
      timezone: 'Europe/Prague',
    });
    expect(created.id).toBeTruthy();
  });
});

describe('audit-global', () => {
  it('vrací jen řádky, jejichž actor_id je ten uživatel', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const other = '01930000-0000-7000-8000-0000000000ff';
    await h.as('mlain_migrator').query(
      `INSERT INTO audit_log (workspace_id, actor_type, actor_id, action)
       VALUES (NULL, 'user', $1, 'user.password_changed'),
              (NULL, 'user', $2, 'user.password_changed')`, [ws.userId, other]);
    const rows = await listGlobalAuditForUser(h.as('mlain_app'), ws.userId);
    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe('user.password_changed');
  });
});
```

- [ ] **Step 2: Spusť test a ověř, že spadne**

Run: `pnpm --filter @mlain/db test:db -- test/workspaces-global.test.ts`
Expected: FAIL, `Cannot find module '../src/repo/workspaces-global.js'`.

- [ ] **Step 3: Napiš `src/repo/workspaces-global.ts`**

```ts
// packages/db/src/repo/workspaces-global.ts
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { v7 as uuidv7 } from 'uuid';
import { withUser } from './tx.js';

export type WorkspaceRow = {
  id: string; name: string; slug: string; locale: string; timezone: string;
};

/**
 * Výpis projektů aktéra. Běží MIMO workspace kontext, protože kontextů je víc
 * než jeden. Politika ws_member_visibility ho pustí jen k projektům,
 * ve kterých má uživatel členství; bez mlain.user_id vrátí nula řádků.
 */
export async function listWorkspacesForUser(pool: Pool, userId: string): Promise<WorkspaceRow[]> {
  return withUser(pool, userId, async (tx) => {
    const { rows } = await tx.execute<WorkspaceRow>(sql`SELECT id, name, slug, locale, timezone
         FROM workspaces
        WHERE deleted_at IS NULL
        ORDER BY name`);
    return rows;
  });
}

export type CreateWorkspaceInput = {
  name: string; slug: string; locale: string; timezone: string;
};

/**
 * Založení projektu. Kontext ještě neexistuje, takže ws_isolation_self by ho
 * zablokovala; pouští ho politika ws_insert_bootstrap.
 *
 * locale a timezone se předávají VŽDY EXPLICITNĚ, i když se rovnají výchozí
 * hodnotě v DDL. Defaulty v DDL jsou pojistka proti NOT NULL při ručním
 * INSERT v migraci, ne konfigurace; zdrojem hodnoty jsou DEFAULT_LOCALE
 * a DEFAULT_TIMEZONE. Bez toho by instalace s DEFAULT_LOCALE=de dostávala
 * u řádků mimo hlavní cestu české hodnoty a projevilo by se to až e-mailem
 * v cizím jazyce.
 */
export async function createWorkspaceAsUser(
  pool: Pool, userId: string, input: CreateWorkspaceInput,
): Promise<WorkspaceRow> {
  return withUser(pool, userId, async (tx) => {
    // ID se generuje DOPŘEDU a hned se nastaví jako kontext. Bez toho operace
    // neprojde a ověřeno je to spuštěním, ne úvahou:
    //
    //   * `INSERT ... RETURNING` uplatní na nový řádek i politiky pro čtení.
    //     ws_insert_bootstrap je FOR INSERT, takže na RETURNING nedosáhne,
    //     a ws_isolation_self porovnává s kontextem, který by nebyl nastavený.
    //     Naměřeno: tentýž INSERT bez RETURNING projde, s RETURNING skončí
    //     na "new row violates row-level security policy".
    //   * Vložení členství by neprošlo ani tak: ws_isolation na memberships
    //     má WITH CHECK proti workspace kontextu.
    //
    // Past, které se tímhle vyhýbáme, je nejlevnější cesta k zelenému testu:
    // uvolnit politiku na memberships. To je přesně ta chyba, které má celý
    // model bránit, a nikdo by si toho v revizi nevšiml.
    const id = uuidv7();
    await tx.execute(sql`SELECT set_config('mlain.workspace_id', ${id}, true)`);

    const { rows } = await tx.execute<WorkspaceRow>(sql`INSERT INTO workspaces (id, name, slug, locale, timezone, created_by)
       VALUES (${id}, ${input.name}, ${input.slug}, ${input.locale}, ${input.timezone}, ${userId})
       RETURNING id, name, slug, locale, timezone`);
    await tx.execute(sql`INSERT INTO memberships (workspace_id, user_id, role) VALUES (${id}, ${userId}, 'owner')`);
    return rows[0];
  });
}
```

Nastavení kontextu na **vlastní, právě generované** ID není obcházení izolace. Kontext ukazuje na projekt, který v té transakci vzniká, takže politika `ws_isolation_self` pustí jen ten jediný řádek a `ws_isolation` na `memberships` jen členství v něm. Kdyby transakce spadla, kontext s ní zmizí (`SET LOCAL`) a řádek nevznikne.

- [ ] **Step 4: Napiš `src/repo/audit-global.ts`**

```ts
// packages/db/src/repo/audit-global.ts
import { sql } from 'drizzle-orm';
import type { Pool } from 'pg';
import { withUser } from './tx.js';

export type GlobalAuditRow = {
  id: string; action: string; actorLabel: string; ip: string | null;
  userAgent: string | null; createdAt: Date;
};

/**
 * JEDINÁ cesta ke globálním auditním záznamům (workspace_id IS NULL).
 *
 * Politika ws_isolation_audit je pro čtení schválně přísná a globální řádky
 * přes workspace kontext nepouští: patří uživateli, ne projektu. Kdyby je USING
 * pustilo, viděl by admin projektu A přihlášení uživatelů projektu B.
 *
 * GET /api/v1/audit-log je projektový a globální řádky nevrací vůbec.
 */
export async function listGlobalAuditForUser(
  pool: Pool, userId: string, limit = 50,
): Promise<GlobalAuditRow[]> {
  return withUser(pool, userId, async (tx) => {
    const { rows } = await tx.execute<GlobalAuditRow>(sql`SELECT id, action, actor_label AS "actorLabel", ip,
              user_agent AS "userAgent", created_at AS "createdAt"
         FROM audit_log
        WHERE workspace_id IS NULL AND actor_type = 'user' AND actor_id = ${userId}
        ORDER BY created_at DESC
        LIMIT ${limit}`);
    return rows;
  });
}
```

Tohle čtení stojí na politice `user_own_global_audit`, kterou zakládá migrace 0004. Samotná `ws_isolation_audit` má v `USING` jen porovnání s `mlain.workspace_id`, který tahle cesta z principu nenastavuje, takže bez druhé politiky by dotaz vracel nula řádků. Politika má zároveň podmínku, že workspace kontext **není** nastavený, jinak by pod kontextem projektu B viděl uživatel svoje globální řádky a padlo by kritérium 21c.

Dřívější verze plánu na to zakládala samostatnou devátou migraci. Ta se **nepíše**: nic není vydané, politika patří rovnou do 0004 a jediné, co by devátá migrace přinesla, je test, který se nejdřív nastaví na jedno číslo politik a o dva úkoly později se přepíše na jiné.

- [ ] **Step 5: Napiš `src/repo/registry.ts`**

```ts
// packages/db/src/repo/registry.ts
import type { WorkspaceContext } from '../context.js';
import type { Tx } from './tx.js';

/**
 * Metadata jednoho doménového repository modulu. Doménový plán se sem
 * zaregistruje a generický test izolace jeho čtecí funkce automaticky zavolá
 * pod cizím kontextem. Části 2 až 5 tak nemusí psát vlastní izolační testy.
 *
 * Bez registru by každý doménový plán musel na izolaci pamatovat sám,
 * a to je přesně ten druh ochrany, který nic nevynucuje.
 */
export type RepoModule = {
  /** Doména, například 'contacts'. */
  name: string;
  /**
   * Čtecí funkce modulu. Každá dostane kontext cizího projektu a musí vrátit
   * prázdný výsledek nebo null, nikdy cizí data a nikdy výjimku.
   */
  readers: ReadonlyArray<{
    name: string;
    /**
     * Bere `Tx`, ne `Pool` (rozhodnutí R38). Doménové funkce se podle vzoru,
     * který zavedl P04, píšou jako `sluzba(tx, ctx)` a transakci otevírá až
     * volající. S `Pool` by se sem taková funkce nedala zapojit bez obalu
     * a ten obal by předaný pool zahodil, protože adaptér P04 si pool bere
     * ze singletonu; registr by tedy dostával argument, který nikdo nepoužije.
     *
     * Transakci otevírá generický test izolace, ne registrovaná funkce.
     * Jen tak ji test umí zabalit do CIZÍHO kontextu, což je celý smysl
     * registru.
     */
    call: (tx: Tx, ctx: WorkspaceContext) => Promise<unknown>;
  }>;
};

const modules = new Map<string, RepoModule>();

export function registerRepoModule(module: RepoModule): void {
  if (modules.has(module.name)) {
    throw new Error(`repository modul ${module.name} je už zaregistrovaný`);
  }
  modules.set(module.name, module);
}

export function registeredRepoModules(): RepoModule[] {
  return [...modules.values()];
}
```

- [ ] **Step 6: Spusť testy a ověř, že projdou**

Run: `pnpm --filter @mlain/db test:db`
Expected: PASS. `workspaces-global.test.ts` má 5 testů, `rls-registry.test.ts` hlásí 84 politik, `system-settings.test.ts` hlásí `schema_version` 7.

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/repo packages/db/src/rls.ts packages/db/migrations packages/db/test
git commit -m "feat(db): global workspace and audit repositories with their own RLS policy"
```

---

### Task 25: Testy izolace projektů

**Files:**
- Create: `packages/db/test/isolation.test.ts`

Tenhle soubor pokrývá akceptační kritéria **20**, **21**, **21c** a **21d** části 1. Běží proti reálnému PostgreSQL v testcontainers, ne proti mocku, protože dokazuje, že RLS není jen deklarovaná, ale opravdu blokuje.

- [ ] **Step 1: Napiš testy**

```ts
// packages/db/test/isolation.test.ts
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './helpers/container.js';
import { seedTwoWorkspaces } from './helpers/fixtures.js';
import { unsafeWorkspaceContext } from '../src/unsafe-context.js';
import { withWorkspace } from '../src/repo/tx.js';
import { registeredRepoModules } from '../src/repo/registry.js';

let h: Harness;
beforeAll(async () => { h = await startHarness(); }, 180_000);
afterAll(async () => { await h.stop(); });

describe('izolace projektů', () => {
  it('surové SQL bez set_config vrátí 0 řádků (kritérium 20)', async () => {
    await seedTwoWorkspaces(h.as('mlain_migrator'));
    const { rows } = await h.as('mlain_app').query('SELECT * FROM contacts');
    expect(rows).toHaveLength(0);
  });

  it('čtení kontaktu z A pod kontextem B vrátí 0 řádků', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctxB = unsafeWorkspaceContext(ws.workspaceB, { type: 'system', job: 'test' });
    const rows = await withWorkspace(h.as('mlain_app'), ctxB, async (tx) => {
      const r = await tx.execute(sql`SELECT * FROM contacts WHERE id = ${ws.contactInA}`);
      return r.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it('update kontaktu z A pod kontextem B ovlivní 0 řádků', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctxB = unsafeWorkspaceContext(ws.workspaceB, { type: 'system', job: 'test' });
    const affected = await withWorkspace(h.as('mlain_app'), ctxB, async (tx) => {
      const r = await tx.execute(sql`UPDATE contacts SET first_name = 'ukradeno' WHERE id = ${ws.contactInA}`);
      return r.rowCount;
    });
    expect(affected).toBe(0);
  });

  it('insert s cizím workspace_id selže na WITH CHECK (kritérium 21)', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctxB = unsafeWorkspaceContext(ws.workspaceB, { type: 'system', job: 'test' });
    await expect(withWorkspace(h.as('mlain_app'), ctxB, async (tx) => {
      await tx.execute(sql`INSERT INTO contacts (workspace_id, email, locale)
         VALUES (${ws.workspaceA}, 'pruniku@example.test', 'cs')`);
    })).rejects.toThrow(/row-level security/i);
  });

  it('insert s vlastním workspace_id pod svým kontextem projde', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctxB = unsafeWorkspaceContext(ws.workspaceB, { type: 'system', job: 'test' });
    const inserted = await withWorkspace(h.as('mlain_app'), ctxB, async (tx) => {
      const r = await tx.execute(sql`INSERT INTO contacts (workspace_id, email, locale)
         VALUES (${ws.workspaceB}, 'vlastni@example.test', 'cs') RETURNING id`);
      return r.rows[0].id;
    });
    expect(inserted).toBeTruthy();
  });

  it('SELECT workspaces pod kontextem B vrátí právě jeden řádek, a to B (kritérium 21d)',
    async () => {
      const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
      const ctxB = unsafeWorkspaceContext(ws.workspaceB, { type: 'system', job: 'test' });
      const rows = await withWorkspace(h.as('mlain_app'), ctxB, async (tx) => {
        const r = await tx.execute<{ id: string }>(sql`SELECT id FROM workspaces`);
        return r.rows;
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].id).toBe(ws.workspaceB);
    });

  it('výpis projektů bez mlain.user_id i bez workspace kontextu vrátí 0 řádků', async () => {
    await seedTwoWorkspaces(h.as('mlain_migrator'));
    const { rows } = await h.as('mlain_app').query('SELECT id FROM workspaces');
    expect(rows).toHaveLength(0);
  });

  it('izolace platí i na partitionovaných tabulkách', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    await h.as('mlain_migrator').query(
      `INSERT INTO web_events (id, workspace_id, name, occurred_at, contact_id)
       VALUES (gen_random_uuid(), $1, 'page_view', now(), $2)`,
      [ws.workspaceA, ws.contactInA]);
    const ctxB = unsafeWorkspaceContext(ws.workspaceB, { type: 'system', job: 'test' });
    const rows = await withWorkspace(h.as('mlain_app'), ctxB, async (tx) => {
      const r = await tx.execute(sql`SELECT * FROM web_events`);
      return r.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it('RLS neruší prořezávání partition u web_events', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctxA = unsafeWorkspaceContext(ws.workspaceA, { type: 'system', job: 'test' });
    const plan = await withWorkspace(h.as('mlain_app'), ctxA, async (tx) => {
      const r = await tx.execute<{ 'QUERY PLAN': string }>(sql`EXPLAIN SELECT * FROM web_events
          WHERE received_at >= now() - interval '1 day' AND received_at < now()`);
      return r.rows.map((row) => row['QUERY PLAN']).join('\n');
    });
    // UNIKÁTNÍ názvy, ne počet výskytů řetězce. Název oddílu se v plánu
    // objeví vícekrát (uzel skenu i název indexu), takže počítání výskytů
    // hlásí čtyři i tehdy, když prořezávání odstranilo sedm oddílů z devíti,
    // tedy pracovalo bezvadně. Na přelomu měsíce by test spadl vždy.
    const scanned = new Set(plan.match(/web_events_y\d{4}m\d{2}/g) ?? []).size;
    expect(scanned, `plán sahá na ${scanned} oddílů:\n${plan}`).toBeLessThanOrEqual(2);
  });

  it('generický test napříč doménami: každý zaregistrovaný reader vrací pod cizím kontextem prázdno',
    async () => {
      const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
      const ctxB = unsafeWorkspaceContext(ws.workspaceB, { type: 'system', job: 'test' });
      for (const module of registeredRepoModules()) {
        for (const reader of module.readers) {
          // Transakci otevírá TEST, ne registrovaná funkce (rozhodnutí R38).
          // Jen tak jde cizí kontext vnutit zvenčí; kdyby si ji otevírala
          // funkce sama, kontrolovala by se sama sebou.
          const result = await withWorkspace(h.as('mlain_app'), ctxB,
            (tx) => reader.call(tx, ctxB));
          const empty = result === null || result === undefined ||
            (Array.isArray(result) && result.length === 0);
          expect(empty, `${module.name}.${reader.name} vrátil pod cizím kontextem data`)
            .toBe(true);
        }
      }
    });
});
```

Poslední test v tuhle chvíli projde triviálně, protože registr je prázdný. To je správně: je to **připravený mechanismus** pro plány P07 až P14. Jakmile se doménový modul zaregistruje, test ho začne kontrolovat, aniž by kdokoliv psal nový test.

- [ ] **Step 2: Spusť testy a ověř výsledek**

Run: `pnpm --filter @mlain/db test:db -- test/isolation.test.ts`
Expected: PASS, 10 testů.

Kdyby spadl test na prořezávání partition, je to **zásadní zjištění pro celý projekt, ne jen pro tenhle plán**: na pruningu stojí celý výkonový rozpočet timeline. V takovém případě zapiš skutečný počet prohledaných partition do plánu jako přiznané riziko a upozorni na to plán P10, nesnižuj hranici v testu.

- [ ] **Step 3: Commit**

```bash
git add packages/db/test/isolation.test.ts
git commit -m "test(db): workspace isolation covers acceptance criteria 20, 21 and 21d"
```

---

### Task 26: Testy `audit_log` a globálních akcí

**Files:**
- Create: `packages/db/test/audit-log.test.ts`

Tohle je přesně ten případ, který dřív shodil změnu hesla i s transakcí. Pokrývá kritéria **21b** a **21c**.

- [ ] **Step 1: Napiš testy**

```ts
// packages/db/test/audit-log.test.ts
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './helpers/container.js';
import { seedTwoWorkspaces } from './helpers/fixtures.js';
import { unsafeWorkspaceContext } from '../src/unsafe-context.js';
import { withWorkspace } from '../src/repo/tx.js';

let h: Harness;
beforeAll(async () => { h = await startHarness(); }, 180_000);
afterAll(async () => { await h.stop(); });

describe('audit_log a globální akce', () => {
  it('INSERT s workspace_id = NULL projde i BEZ nastaveného workspace kontextu', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    await expect(h.as('mlain_app').query(
      `INSERT INTO audit_log (workspace_id, actor_type, actor_id, action)
       VALUES (NULL, 'user', $1, 'user.login')`, [ws.userId],
    )).resolves.toBeDefined();
  });

  it('INSERT s workspace_id = NULL projde i pod nastaveným kontextem', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctxA = unsafeWorkspaceContext(ws.workspaceA, { type: 'system', job: 'test' });
    await expect(withWorkspace(h.as('mlain_app'), ctxA, async (tx) => {
      await tx.execute(sql`INSERT INTO audit_log (workspace_id, actor_type, actor_id, action)
         VALUES (NULL, 'user', ${ws.userId}, 'user.password_changed')`);
    })).resolves.toBeUndefined();
  });

  it('INSERT s cizím workspace_id pod kontextem B selže na WITH CHECK', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    const ctxB = unsafeWorkspaceContext(ws.workspaceB, { type: 'system', job: 'test' });
    await expect(withWorkspace(h.as('mlain_app'), ctxB, async (tx) => {
      await tx.execute(sql`INSERT INTO audit_log (workspace_id, actor_type, action)
         VALUES (${ws.workspaceA}, 'system', 'settings.updated')`);
    })).rejects.toThrow(/row-level security/i);
  });

  it('změna hesla se commitne i s auditním záznamem, transakce se nerollbackne (kritérium 21b)',
    async () => {
      const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
      // Přihlašovací flow ŽÁDNÝ workspace kontext nenastavuje. Přesně tohle
      // dřív padalo: audit s workspace_id NULL selhal na WITH CHECK a vzal
      // s sebou celou transakci, takže se heslo neuložilo.
      const client = await h.as('mlain_app').connect();
      try {
        await client.query('BEGIN');
        await client.query(
          `UPDATE users SET password_hash = 'argon2id$novy', password_changed_at = now()
            WHERE id = $1`, [ws.userId]);
        await client.query(
          `INSERT INTO audit_log (workspace_id, actor_type, actor_id, action)
           VALUES (NULL, 'user', $1, 'user.password_changed')`, [ws.userId]);
        await client.query('COMMIT');
      } finally {
        client.release();
      }

      const { rows } = await h.as('mlain_app').query<{ password_hash: string }>(
        'SELECT password_hash FROM users WHERE id = $1', [ws.userId]);
      expect(rows[0].password_hash).toBe('argon2id$novy');

      const { rows: audit } = await h.as('mlain_migrator').query<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit_log
          WHERE actor_id = $1 AND action = 'user.password_changed'
            AND workspace_id IS NULL`, [ws.userId]);
      expect(audit[0].n).toBe(1);
    });

  it('pod kontextem B nevrátí čtení ani řádek A, ani globální řádek (kritérium 21c)', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    await h.as('mlain_migrator').query(
      `INSERT INTO audit_log (workspace_id, actor_type, actor_id, action)
       VALUES ($1, 'system', NULL, 'settings.updated'),
              (NULL, 'user', $2, 'user.login')`, [ws.workspaceA, ws.userId]);

    const ctxB = unsafeWorkspaceContext(ws.workspaceB, { type: 'system', job: 'test' });
    const rows = await withWorkspace(h.as('mlain_app'), ctxB, async (tx) => {
      const r = await tx.execute(sql`SELECT * FROM audit_log`);
      return r.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it('aplikační role nesmí audit_log měnit ani mazat', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    await h.as('mlain_migrator').query(
      `INSERT INTO audit_log (workspace_id, actor_type, action)
       VALUES ($1, 'system', 'settings.updated')`, [ws.workspaceA]);
    const ctxA = unsafeWorkspaceContext(ws.workspaceA, { type: 'system', job: 'test' });
    await expect(withWorkspace(h.as('mlain_app'), ctxA, async (tx) => {
      await tx.execute(sql`UPDATE audit_log SET action = 'podvrzeno'`);
    })).rejects.toThrow(/permission denied/i);
    await expect(withWorkspace(h.as('mlain_app'), ctxA, async (tx) => {
      await tx.execute(sql`DELETE FROM audit_log`);
    })).rejects.toThrow(/permission denied/i);
  });

  it('consents jsou append only a mazat je smí jen mlain_gdpr', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    await h.as('mlain_migrator').query(
      `INSERT INTO consents (workspace_id, contact_id, purpose, status, legal_basis,
                             source, occurred_at)
       VALUES ($1, $2, 'email_marketing', 'granted', 'consent', 'form', now())`,
      [ws.workspaceA, ws.contactInA]);

    const ctxA = unsafeWorkspaceContext(ws.workspaceA, { type: 'system', job: 'test' });
    await expect(withWorkspace(h.as('mlain_app'), ctxA, async (tx) => {
      await tx.execute(sql`UPDATE consents SET status = 'withdrawn'`);
    })).rejects.toThrow(/permission denied/i);
    await expect(withWorkspace(h.as('mlain_app'), ctxA, async (tx) => {
      await tx.execute(sql`DELETE FROM consents`);
    })).rejects.toThrow(/permission denied/i);

    // mlain_gdpr DELETE má. Výmaz podle čl. 17 musí souhlasy smazat.
    const gdprCtx = unsafeWorkspaceContext(ws.workspaceA, { type: 'system', job: 'gdpr.erase' });
    const deleted = await withWorkspace(h.as('mlain_gdpr'), gdprCtx, async (tx) => {
      const r = await tx.execute(sql`DELETE FROM consents`);
      return r.rowCount;
    });
    expect(deleted).toBe(1);
  });

  it('ON DELETE CASCADE z contacts souhlasy odstraní, přestože aplikace DELETE nemá', async () => {
    const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
    await h.as('mlain_migrator').query(
      `INSERT INTO consents (workspace_id, contact_id, purpose, status, legal_basis,
                             source, occurred_at)
       VALUES ($1, $2, 'analytics', 'granted', 'consent', 'form', now())`,
      [ws.workspaceA, ws.contactInA]);
    await h.as('mlain_migrator').query('DELETE FROM contacts WHERE id = $1', [ws.contactInA]);
    const { rows } = await h.as('mlain_migrator').query<{ n: number }>(
      'SELECT count(*)::int AS n FROM consents WHERE contact_id = $1', [ws.contactInA]);
    expect(rows[0].n).toBe(0);
  });
});
```

Poslední dva testy jsou tam proto, že zamítnutá varianta s `CREATE RULE ... DO INSTEAD NOTHING` by u obou vypadala stejně a u druhého by tiše selhala: kaskáda by proběhla bez chyby, ale souhlasy by v tabulce zůstaly jako osiřelé řádky s osobními údaji v `evidence`.

- [ ] **Step 2: Spusť testy a ověř výsledek**

Run: `pnpm --filter @mlain/db test:db -- test/audit-log.test.ts`
Expected: PASS, 8 testů.

- [ ] **Step 3: Commit**

```bash
git add packages/db/test/audit-log.test.ts
git commit -m "test(db): audit log global actions cover criteria 21b and 21c"
```

---

### Task 27: Testy role senderu pod skutečnou rolí `mlain_sender`

**Files:**
- Create: `packages/db/test/sender-role.test.ts`

Tohle je nejcennější testovací soubor v plánu. Historicky se stalo přesně tohle: RLS politika chyběla, sender by v produkci neviděl ani řádek, a testy byly zelené, protože běžely pod migrátorem. **Každý test v tomhle souboru běží pod `h.as('mlain_sender')`.** Pokrývá kritérium **49** části 1 a scénáře `OB-08`, `OB-09`, `OB-16`, `OB-17`.

- [ ] **Step 1: Napiš testy**

```ts
// packages/db/test/sender-role.test.ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './helpers/container.js';
import { seedTwoWorkspaces } from './helpers/fixtures.js';
import { MESSAGES_STORAGE, createMonthlyPartitions } from '../src/partitions.js';
import { v7 as uuidv7 } from 'uuid';

let h: Harness;
beforeAll(async () => { h = await startHarness(); }, 180_000);
afterAll(async () => { await h.stop(); });

type Fixture = { workspaceId: string; campaignId: string; messageId: string; createdAt: string };

async function seedCampaignWithMessage(): Promise<Fixture> {
  const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
  const campaignId = uuidv7();
  const messageId = uuidv7();
  // Invariant I1: created_at všech zpráv běhu = campaigns.audience_built_at,
  // zaokrouhlené na celé sekundy.
  const createdAt = '2026-08-10T09:00:00.000Z';
  // Partition MUSÍ existovat před vložením. Výchozí partition se nezakládá,
  // takže zápis mimo existující okno tvrdě selže, a to je záměr: fixture
  // s pevným datem si oddíl zakládá sama, nespoléhá na to, že ho runner
  // náhodou vytvořil pro aktuální měsíc.
  await createMonthlyPartitions(h.as('mlain_migrator'), 'messages', 'created_at',
    new Date(createdAt), 1, MESSAGES_STORAGE);
  await h.as('mlain_migrator').query(
    `INSERT INTO campaigns (id, workspace_id, name, status, audience_built_at)
     VALUES ($1, $2, 'Kampaň', 'sending', $3)`, [campaignId, ws.workspaceA, createdAt]);
  await h.as('mlain_migrator').query(
    `INSERT INTO messages (id, workspace_id, campaign_id, contact_id, email, created_at)
     VALUES ($1, $2, $3, $4, 'prijemce@example.test', $5)`,
    [messageId, ws.workspaceA, campaignId, ws.contactInA, createdAt]);
  return { workspaceId: ws.workspaceA, campaignId, messageId, createdAt };
}

describe('role mlain_sender, vše pod skutečnou rolí senderu', () => {
  it('sender SKUTEČNĚ VIDÍ řádky messages, sender_bypass funguje', async () => {
    const f = await seedCampaignWithMessage();
    const { rows } = await h.as('mlain_sender').query<{ id: string }>(
      'SELECT id FROM messages WHERE campaign_id = $1', [f.campaignId]);
    expect(rows, 'sender nevidí žádnou zprávu, chybí politika sender_bypass').toHaveLength(1);
    expect(rows[0].id).toBe(f.messageId);
  });

  it('sender vidí i campaigns, workspaces, sending_providers a suppressions', async () => {
    await seedCampaignWithMessage();
    for (const table of ['campaigns', 'workspaces', 'sending_providers',
                         'campaign_links', 'suppressions']) {
      await expect(
        h.as('mlain_sender').query(`SELECT count(*) FROM ${table}`),
        `sender neumí číst ${table}`,
      ).resolves.toBeDefined();
    }
  });

  it('claim dotaz z kontraktu vrátí dávku a označí ji (scénář OB-01 v malém)', async () => {
    const f = await seedCampaignWithMessage();
    const { rows } = await h.as('mlain_sender').query(`
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
      SET status = 'claimed', claimed_by = $1, claimed_at = now(),
          claim_expires_at = now() + make_interval(secs => $3), updated_at = now()
      FROM claimable cl, campaigns c, workspaces w
      WHERE m.id = cl.id
        AND m.created_at = cl.created_at
        AND m.campaign_id IS NOT NULL
        AND c.id = m.campaign_id
        AND w.id = m.workspace_id
        AND c.status IN ('queueing','sending')
        AND c.deleted_at IS NULL
        AND w.deleted_at IS NULL
      RETURNING m.id, m.created_at, m.workspace_id, m.campaign_id, m.contact_id,
                m.email, m.render_data, m.attempts`,
      ['sender-test', 100, 300, f.campaignId]);
    expect(rows).toHaveLength(1);
  });

  it('sender NESMÍ mazat z messages (scénář OB-08, kritérium 49)', async () => {
    await seedCampaignWithMessage();
    await expect(h.as('mlain_sender').query('DELETE FROM messages'))
      .rejects.toThrow(/permission denied/i);
  });

  it('sender NESMÍ číst contacts (scénář OB-09, kritérium 49)', async () => {
    await seedCampaignWithMessage();
    await expect(h.as('mlain_sender').query('SELECT * FROM contacts'))
      .rejects.toThrow(/permission denied/i);
  });

  it('sender nesmí číst users, sessions, api_keys, audit_log ani web_events', async () => {
    for (const table of ['users', 'sessions', 'api_keys', 'audit_log', 'web_events']) {
      await expect(
        h.as('mlain_sender').query(`SELECT * FROM ${table}`),
        `sender čte ${table}, a nemá`,
      ).rejects.toThrow(/permission denied/i);
    }
  });

  it('sender NESMÍ vkládat do messages', async () => {
    const f = await seedCampaignWithMessage();
    await expect(h.as('mlain_sender').query(
      `INSERT INTO messages (workspace_id, campaign_id, contact_id, email)
       VALUES ($1, $2, gen_random_uuid(), 'x@example.test')`,
      [f.workspaceId, f.campaignId]),
    ).rejects.toThrow(/permission denied/i);
  });

  it('sender NESMÍ přepsat created_at (invariant I1)', async () => {
    const f = await seedCampaignWithMessage();
    await expect(h.as('mlain_sender').query(
      `UPDATE messages SET created_at = now() WHERE id = $1`, [f.messageId]),
    ).rejects.toThrow(/permission denied/i);
  });

  it('sender NESMÍ přepsat render_data ani email', async () => {
    const f = await seedCampaignWithMessage();
    for (const column of ['render_data', 'email']) {
      const value = column === 'render_data' ? `'{}'::jsonb` : `'jiny@example.test'`;
      await expect(
        h.as('mlain_sender').query(
          `UPDATE messages SET ${column} = ${value} WHERE id = $1`, [f.messageId]),
        `sender přepsal ${column}`,
      ).rejects.toThrow(/permission denied/i);
    }
  });

  it('sender SMÍ inkrementovat ambiguous_count (bez toho je reaper neproveditelný)', async () => {
    const f = await seedCampaignWithMessage();
    const r = await h.as('mlain_sender').query(
      `UPDATE messages SET ambiguous_count = ambiguous_count + 1, updated_at = now()
        WHERE id = $1 AND created_at = $2`, [f.messageId, f.createdAt]);
    expect(r.rowCount).toBe(1);
  });

  it('sender SMÍ pozastavit kampaň ze stavu sending i queueing (scénář OB-16)', async () => {
    const f = await seedCampaignWithMessage();
    const reason = JSON.stringify({
      code: 'provider_quota_exhausted', source: 'sender',
      detail: 'SES daily quota reached', sender_id: 'mlain-ws-7f3a',
      at: '2026-07-31T14:22:31Z',
    });
    const r = await h.as('mlain_sender').query(
      `UPDATE campaigns SET status = 'paused', pause_reason = $2
        WHERE id = $1 AND status IN ('queueing','sending')`, [f.campaignId, reason]);
    expect(r.rowCount).toBe(1);

    // Tentýž UPDATE na už pozastavené kampani ovlivní 0 řádků a NENÍ to chyba.
    const again = await h.as('mlain_sender').query(
      `UPDATE campaigns SET status = 'paused', pause_reason = $2
        WHERE id = $1 AND status IN ('queueing','sending')`, [f.campaignId, reason]);
    expect(again.rowCount).toBe(0);
  });

  it('sender NESMÍ změnit jiný sloupec campaigns než status a pause_reason (OB-17)', async () => {
    const f = await seedCampaignWithMessage();
    await expect(h.as('mlain_sender').query(
      `UPDATE campaigns SET subject = 'podvrzeno' WHERE id = $1`, [f.campaignId]),
    ).rejects.toThrow(/permission denied/i);
    await expect(h.as('mlain_sender').query(
      `UPDATE campaigns SET compiled_html = '<p>x</p>' WHERE id = $1`, [f.campaignId]),
    ).rejects.toThrow(/permission denied/i);
  });

  it('sender SMÍ vložit událost do message_events', async () => {
    // `rank` ve výčtu SCHVÁLNĚ NENÍ: je to generovaný sloupec (rozhodnutí R32)
    // a explicitní hodnota by skončila chybou „cannot insert a non-DEFAULT
    // value". Sender ho tedy nemá jak uvést špatně, což je celý smysl změny.
    const f = await seedCampaignWithMessage();
    const r = await h.as('mlain_sender').query(
      `INSERT INTO message_events (workspace_id, message_id, message_created_at,
                                   campaign_id, contact_id, recipient, type,
                                   ts, source)
       SELECT $1, $2, $3, $4, m.contact_id, m.email, 'circuit_breaker_open', now(), 'internal'
         FROM messages m WHERE m.id = $2 AND m.created_at = $3`,
      [f.workspaceId, f.messageId, f.createdAt, f.campaignId]);
    expect(r.rowCount).toBe(1);
  });

  it('sender NESMÍ číst ani měnit message_events, má jen INSERT', async () => {
    await seedCampaignWithMessage();
    await expect(h.as('mlain_sender').query('SELECT * FROM message_events'))
      .rejects.toThrow(/permission denied/i);
  });

  it('sender SMÍ zapsat agregované varování renderu přes ON CONFLICT DO UPDATE', async () => {
    // Tenhle zápis dřív neprošel NIKDY: grant byl, politika sender_bypass ne.
    // Sender by dostal nejdřív permission denied (ON CONFLICT DO UPDATE čte
    // existující řádek, potřebuje tedy i SELECT) a po jejím doplnění
    // "new row violates row-level security policy". Report varování by byl
    // vždy prázdný a nikdo by nevěděl proč, protože sender chybu jen loguje.
    const f = await seedCampaignWithMessage();
    const zapis = () => h.as('mlain_sender').query(
      `INSERT INTO campaign_render_warnings
         (workspace_id, campaign_id, code, path, count, sample)
       VALUES ($1, $2, 'missing_value', 'contact.attributes.city', 1, '[]'::jsonb)
       ON CONFLICT (workspace_id, campaign_id, code, path)
       DO UPDATE SET count = campaign_render_warnings.count + 1, last_seen_at = now()`,
      [f.workspaceId, f.campaignId]);

    await expect(zapis()).resolves.toBeDefined();
    // Druhý průchod jde větví DO UPDATE, tedy tou, která potřebuje SELECT.
    await expect(zapis()).resolves.toBeDefined();

    const { rows } = await h.as('mlain_migrator').query<{ count: string }>(
      `SELECT count FROM campaign_render_warnings WHERE campaign_id = $1`, [f.campaignId]);
    expect(Number(rows[0].count)).toBe(2);
  });

  it('sender NESMÍ označit kampaň za odeslanou ani ji zrušit (jen pozastavit)', async () => {
    // Sloupcový grant říká, DO KTERÝCH sloupců smí sender psát, ne jakou
    // hodnotu. Bez WITH CHECK na politice sender_bypass by šlo nastavit
    // status = 'sent' a kampaň by se tvářila jako doběhlá.
    const f = await seedCampaignWithMessage();
    for (const status of ['sent', 'cancelled', 'draft']) {
      await expect(
        h.as('mlain_sender').query(
          `UPDATE campaigns SET status = $2 WHERE id = $1`, [f.campaignId, status]),
        `sender nastavil kampani status ${status}`,
      ).rejects.toThrow(/row-level security/i);
    }
  });

  it('claim nevrátí nic, když je kampaň pozastavená (OB-05)', async () => {
    const f = await seedCampaignWithMessage();
    await h.as('mlain_migrator').query(
      `UPDATE campaigns SET status = 'paused' WHERE id = $1`, [f.campaignId]);
    const { rows } = await h.as('mlain_sender').query(
      `SELECT c.id FROM campaigns c JOIN workspaces w ON w.id = c.workspace_id
        WHERE c.status IN ('queueing','sending')
          AND c.deleted_at IS NULL AND w.deleted_at IS NULL`);
    expect(rows).toHaveLength(0);
  });

  it('claim nevrátí nic, když je workspace měkce smazaný (OB-06)', async () => {
    const f = await seedCampaignWithMessage();
    await h.as('mlain_migrator').query(
      `UPDATE workspaces SET deleted_at = now() WHERE id = $1`, [f.workspaceId]);
    const { rows } = await h.as('mlain_sender').query(
      `SELECT c.id FROM campaigns c JOIN workspaces w ON w.id = c.workspace_id
        WHERE c.status IN ('queueing','sending')
          AND c.deleted_at IS NULL AND w.deleted_at IS NULL`);
    expect(rows).toHaveLength(0);
  });

  it('claim nevrátí nic, když je kampaň měkce smazaná ve stavu sending (OB-18)', async () => {
    const f = await seedCampaignWithMessage();
    await h.as('mlain_migrator').query(
      `UPDATE campaigns SET deleted_at = now() WHERE id = $1`, [f.campaignId]);
    const { rows } = await h.as('mlain_sender').query(
      `SELECT c.id FROM campaigns c JOIN workspaces w ON w.id = c.workspace_id
        WHERE c.status IN ('queueing','sending')
          AND c.deleted_at IS NULL AND w.deleted_at IS NULL`);
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Spusť testy a ověř výsledek**

Run: `pnpm --filter @mlain/db test:db -- test/sender-role.test.ts`
Expected: PASS, 19 testů.

Kdyby spadl **první** test (sender nevidí ani řádek), chybí politika `sender_bypass` a je to přesně ta chyba, kvůli které tenhle soubor existuje. Nespravuj to tím, že test poběží pod migrátorem.

- [ ] **Step 3: Commit**

```bash
git add packages/db/test/sender-role.test.ts
git commit -m "test(db): sender role tests run under mlain_sender, covering criterion 49"
```

---

### Task 28: Smoke test kontraktního SQL

**Files:**
- Create: `packages/db/test/contract-sql.test.ts`

Tenhle test je obdobou scénáře `OB-00` uvnitř `packages/db`. Vezme každý normativní dotaz kontraktu, spustí ho proti čerstvě zmigrované databázi s prázdnými tabulkami a ověří **jedinou věc: že neskončí chybou.** Prázdný výsledek je úspěch.

Zní to triviálně. Přesto by právě on odhalil obě chyby, které kontrakt v jednom vydání obsahoval: neplatný odkaz na cíl `UPDATE` v klauzuli `ON` a obrácené znaménko u reaperu. Obojí prošlo dvěma koly revize, protože se ověřovalo **čtením**, a čtení neumí zjistit, jestli je SQL platné.

Dotazy se **načítají ze souborů, které vlastní P02** (`packages/contracts/fixtures/outbox/sql/01-*.sql` až `11-*.sql`), ne opisují do testu. Ruční opis dokazuje, že projde opis, ne kontrakt: kdyby se kontrakt změnil, test by zůstal zelený nad starým zněním. Přesně tahle porucha („normativní SQL, které nikdo nikdy nespustil") je jedním ze tří případů, kvůli kterým platí pravidlo o automatickém zachycení.

Čtení souboru z cizího balíčku **není import**: nevzniká build závislost ani hrana v grafu balíčků. Je to tentýž postup, jakým P02 čte manifest konfigurace z P01.

Úplný scénář `OB-00` proti `packages/contracts/fixtures` vlastní P02 a P09. Tenhle test je menší a slouží jako brána, aby schéma nešlo mergnout ve stavu, kdy kontraktní dotaz neprojde ani parserem.

- [ ] **Step 1: Napiš testy**

```ts
// packages/db/test/contract-sql.test.ts
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Harness, startHarness } from './helpers/container.js';

let h: Harness;
beforeAll(async () => { h = await startHarness(); }, 120_000);
afterAll(async () => { await h.stop(); });

/** Soubory vlastní P02. Tenhle plán je jen čte, nikdy nemění. */
const CONTRACT_SQL_DIR = fileURLToPath(
  new URL('../../contracts/fixtures/outbox/sql/', import.meta.url));

type ContractQuery = { name: string; sql: string; paramTypes: string[]; args: string };

/**
 * Hlavičku souboru definuje P02 a má tři direktivy:
 *   -- role: sender
 *   -- params: text, int, int, uuid
 *   -- args: 'mlain-ws-7f3a', 100, 300, '0192...'
 *
 * Bez explicitních typů skončí PREPARE u výrazu `WHEN $1 = 'retry'` chybou
 * "could not determine data type of parameter $1", protože obě strany
 * porovnání jsou neznámého typu.
 */
function loadContractQueries(): ContractQuery[] {
  const files = readdirSync(CONTRACT_SQL_DIR).filter((f) => f.endsWith('.sql')).sort();
  return files.map((file) => {
    const raw = readFileSync(join(CONTRACT_SQL_DIR, file), 'utf8');
    const params = raw.match(/^--\s*params:\s*(.*)$/m)?.[1]?.trim() ?? '';
    const args = raw.match(/^--\s*args:\s*(.*)$/m)?.[1]?.trim() ?? '';
    const sql = raw
      .split('\n')
      .filter((line) => !/^--\s*(role|params|args):/.test(line))
      .join('\n')
      .trim()
      .replace(/;\s*$/, '');
    return {
      name: file.replace(/\.sql$/, ''),
      sql,
      paramTypes: params ? params.split(',').map((t) => t.trim()) : [],
      args,
    };
  });
}

const CONTRACT_QUERIES = loadContractQueries();

describe('kontraktní SQL projde parserem i plánovačem (obdoba OB-00)', () => {
  it('načetlo se jedenáct normativních dotazů kontraktu', () => {
    // Kdyby se adresář přejmenoval nebo vyprázdnil, prošel by test „všechny
    // dotazy jsou v pořádku" nad prázdným seznamem. Prázdná sada není úspěch.
    expect(CONTRACT_QUERIES.length,
      `v ${CONTRACT_SQL_DIR} není jedenáct dotazů; vlastní je P02`).toBe(11);
  });

  for (const query of CONTRACT_QUERIES) {
    // Všechny běží pod rolí mlain_sender, protože spuštění pod migrátorem
    // by zamaskovalo chybějící politiku sender_bypass.
    //
    // PREPARE projde parserem a analyzátorem, EXPLAIN EXECUTE navíc spustí
    // plánovač a nic nevykoná. U UPDATE je to jediný bezpečný způsob, jak
    // dotaz ověřit proti databázi s daty.
    it(query.name, async () => {
      const client = await h.as('mlain_sender').connect();
      const stmt = `ob_${query.name.replace(/[^a-z0-9]/gi, '_')}`;
      try {
        const types = query.paramTypes.length ? `(${query.paramTypes.join(', ')})` : '';
        await client.query(`PREPARE ${stmt} ${types} AS ${query.sql}`);
        await expect(
          client.query(`EXPLAIN (COSTS OFF) EXECUTE ${stmt}${query.args ? `(${query.args})` : ''}`),
        ).resolves.toBeDefined();
      } finally {
        await client.query(`DEALLOCATE ALL`).catch(() => undefined);
        client.release();
      }
    });
  }
});


describe('normativní dotazy aplikační strany', () => {
  it('materializace publika s ON CONFLICT nad všemi třemi sloupci indexu', async () => {
    // Uvedení jen dvou sloupců není tichá chyba, ale tvrdý ERROR
    // "there is no unique or exclusion constraint matching the ON CONFLICT
    // specification", a materializace by neproběhla vůbec.
    await expect(h.as('mlain_migrator').query(
      `INSERT INTO messages (id, workspace_id, campaign_id, contact_id, email,
                             render_data, created_at)
       SELECT gen_random_uuid(), $1, $2, $3, 'x@example.test', '{}'::jsonb, $4
       WHERE false
       ON CONFLICT (campaign_id, contact_id, created_at) DO NOTHING`,
      ['01930000-0000-7000-8000-000000000003', '01930000-0000-7000-8000-000000000001',
       '01930000-0000-7000-8000-000000000004', '2026-08-01T00:00:00Z']),
    ).resolves.toBeDefined();
  });

  it('ON CONFLICT jen nad dvěma sloupci naopak MUSÍ selhat', async () => {
    await expect(h.as('mlain_migrator').query(
      `INSERT INTO messages (id, workspace_id, campaign_id, contact_id, email, created_at)
       SELECT gen_random_uuid(), $1, $2, $3, 'x@example.test', $4
       WHERE false
       ON CONFLICT (campaign_id, contact_id) DO NOTHING`,
      ['01930000-0000-7000-8000-000000000003', '01930000-0000-7000-8000-000000000001',
       '01930000-0000-7000-8000-000000000004', '2026-08-01T00:00:00Z']),
    ).rejects.toThrow(/no unique or exclusion constraint/i);
  });

  it('dedup příchozích událostí přes NOT EXISTS nad prefixem indexu', async () => {
    await expect(h.as('mlain_migrator').query(
      `INSERT INTO provider_event_receipts (workspace_id, provider_id, dedup_key,
                                            sns_message_id, event_type, raw, received_at, status)
       SELECT $1, $2, $3, $4, $5, $6::jsonb, $7, 'received'
        WHERE NOT EXISTS (
          SELECT 1 FROM provider_event_receipts
           WHERE workspace_id = $1 AND dedup_key = $3
             AND received_at >= date_trunc('month', $7::timestamptz))
       ON CONFLICT (workspace_id, dedup_key, received_at) DO NOTHING
       RETURNING id`,
      ['01930000-0000-7000-8000-000000000003', '01930000-0000-7000-8000-000000000005',
       'sns:abc', 'abc', 'Delivery', '{}', new Date().toISOString()]),
    ).resolves.toBeDefined();
  });

  it('veto retenčního jobu: oba dotazy z konvence 2.1 jsou spustitelné', async () => {
    for (const sql of [
      `SELECT 1 FROM campaigns
        WHERE audience_built_at >= $1 AND audience_built_at < $2
          AND status IN ('queueing','sending','paused') LIMIT 1`,
      `SELECT 1 FROM messages
        WHERE created_at >= $1 AND created_at < $2
          AND status IN ('pending','claimed') LIMIT 1`,
    ]) {
      await expect(h.as('mlain_migrator').query(
        sql, ['2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z']),
      ).resolves.toBeDefined();
    }
  });

  it('dotaz na web_events podle occurred_at nese i podmínku na received_at', async () => {
    // Bez druhého řádku se prohledají VŠECHNY partition. Je to přesně ta chyba,
    // před kterou konvence varuje u dvousložkových klíčů, jen o úroveň výš.
    await expect(h.as('mlain_migrator').query(
      `SELECT count(*) FROM web_events
        WHERE occurred_at >= $1 AND occurred_at < $2
          AND received_at >= $1 AND received_at < $2::timestamptz + interval '7 days'`,
      ['2026-08-01T00:00:00Z', '2026-09-01T00:00:00Z']),
    ).resolves.toBeDefined();
  });
});
```

- [ ] **Step 2: Spusť testy a ověř výsledek**

Run: `pnpm --filter @mlain/db test:db -- test/contract-sql.test.ts`
Expected: PASS, 17 testů (11 kontraktních dotazů, kontrola jejich počtu a 5 dotazů aplikační strany).

Kdyby některý kontraktní dotaz spadl, **neopravuj ho v `packages/contracts`**: ty soubory vlastní P02. Buď je chyba ve schématu, které tenhle plán vlastní, nebo je to nález proti kontraktu a patří do `NALEZY-NAPRIC-PLANY.md`.

- [ ] **Step 3: Commit**

```bash
git add packages/db/test/contract-sql.test.ts
git commit -m "test(db): contract SQL smoke test loads normative queries from contracts"
```

---

### Task 29: Tři scénáře jobu `migrations-check`

**Files:**
- Create: `packages/db/test/migrations-check.test.ts`

CI job `migrations-check` je blokující a má tři scénáře. Tenhle úkol je píše. Skript `test:migrations` do `package.json` zapisuje už úkol 1, tenhle úkol ho jen ověřuje.

- [ ] **Step 1: Napiš testy**

```ts
// packages/db/test/migrations-check.test.ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { startHarness } from './helpers/container.js';
import { runMigrations } from '../src/migrate.js';
import { seedTwoWorkspaces } from './helpers/fixtures.js';
import { v7 as uuidv7 } from 'uuid';

const MIGRATIONS = fileURLToPath(new URL('../migrations', import.meta.url));

type Journal = { entries: Array<{ idx: number; tag: string }> };
function journal(): Journal {
  return JSON.parse(readFileSync(join(MIGRATIONS, 'meta', '_journal.json'), 'utf8'));
}

describe('scénář 1: prázdná databáze plus všechny migrace, žádný drift', () => {
  it('drizzle-kit check nehlásí konflikt ani drift', async () => {
    // drizzle-kit check porovnává snapshoty v meta/ mezi sebou. Když projde,
    // znamená to, že žádné dvě migrace nepopisují nekompatibilní stav.
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const run = promisify(execFile);
    const { stdout, stderr } = await run(
      'pnpm', ['exec', 'drizzle-kit', 'check'],
      { cwd: fileURLToPath(new URL('..', import.meta.url)) });
    expect(`${stdout}${stderr}`).not.toMatch(/conflict|drift|error/i);
  }, 120_000);

  it('opakovaný drizzle-kit generate nevygeneruje žádnou novou migraci', async () => {
    // Generuje se do DOČASNÉHO adresáře, ne do repozitáře. Původní varianta
    // psala rovnou do packages/db/migrations, takže test mutoval pracovní strom
    // a poslední úkol plánu, který kontroluje jeho čistotu, by hlásil porušení
    // vlastnictví souborů kvůli vlastnímu testu.
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const { cpSync, mkdtempSync, readdirSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const run = promisify(execFile);

    const pkg = fileURLToPath(new URL('..', import.meta.url));
    const out = mkdtempSync(join(tmpdir(), 'mlain-drift-'));
    // Existující migrace i snapshoty musí být na místě, jinak by drizzle-kit
    // vygeneroval celé schéma znovu a test by hlásil drift vždy.
    cpSync(MIGRATIONS, out, { recursive: true });

    const config = join(out, 'drizzle.drift.config.ts');
    writeFileSync(config, [
      `import base from ${JSON.stringify(join(pkg, 'drizzle.config.ts'))};`,
      `export default { ...base, out: ${JSON.stringify(out)} };`,
    ].join('\n'));

    const before = readdirSync(out).filter((f) => f.endsWith('.sql')).length;
    await run('pnpm', ['exec', 'drizzle-kit', 'generate',
      `--config=${config}`, '--name=drift_probe'], { cwd: pkg });
    const after = readdirSync(out).filter((f) => f.endsWith('.sql')).length;

    expect(after,
      'drizzle-kit vygeneroval migraci, Drizzle schéma se rozešlo se snapshotem')
      .toBe(before);
  }, 120_000);
});

describe('scénář 2: databáze z předchozího vydání plus nové migrace', () => {
  it('aplikace poslední migrace nad databází zmigrovanou o krok zpět projde', async () => {
    const h = await startHarness({ migrate: false });
    try {
      const entries = journal().entries;
      const url = h.urlFor('mlain_migrator');

      // Krok zpět: dočasný adresář s journalem bez poslední migrace.
      const { mkdtempSync, writeFileSync, mkdirSync, copyFileSync } = await import('node:fs');
      const { tmpdir } = await import('node:os');
      const dir = mkdtempSync(join(tmpdir(), 'mlain-prev-'));
      mkdirSync(join(dir, 'meta'), { recursive: true });
      const previous = entries.slice(0, -1);
      writeFileSync(join(dir, 'meta', '_journal.json'),
        JSON.stringify({ version: '7', dialect: 'postgresql', entries: previous }, null, 2));
      for (const entry of previous) {
        copyFileSync(join(MIGRATIONS, `${entry.tag}.sql`), join(dir, `${entry.tag}.sql`));
      }

      await runMigrations({ url, migrationsFolder: dir, ensurePartitions: false });
      // A teď plná sada, tedy jen ta poslední migrace navíc.
      await expect(runMigrations({ url })).resolves.toBeUndefined();

      const { rows } = await h.as('mlain_migrator').query<{ n: number }>(
        'SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations');
      expect(rows[0].n).toBe(entries.length);
    } finally { await h.stop(); }
  }, 180_000);
});

describe('scénář 3: migrace nad databází s reálnými daty', () => {
  it('10 000 kontaktů a 10 000 zpráv projde opakovaným během migrací', async () => {
    const h = await startHarness();
    try {
      const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
      await h.as('mlain_migrator').query(
        `INSERT INTO contacts (workspace_id, email, locale)
         SELECT $1, 'seed-' || g || '@example.test', 'cs'
           FROM generate_series(1, 10000) AS g`, [ws.workspaceA]);

      const campaignId = uuidv7();
      // Aktuální měsíc: oddíl už založil migrační runner, takže se test neváže
      // na pevné datum a nezačne padat, až aktuální měsíc přeteče.
      const { rows: nowRow } = await h.as('mlain_migrator').query<{ t: string }>(
        `SELECT date_trunc('second', now())::text AS t`);
      const builtAt = nowRow[0].t;
      await h.as('mlain_migrator').query(
        `INSERT INTO campaigns (id, workspace_id, name, status, audience_built_at)
         VALUES ($1, $2, 'Zátěž', 'sending', $3)`, [campaignId, ws.workspaceA, builtAt]);
      await h.as('mlain_migrator').query(
        `INSERT INTO messages (workspace_id, campaign_id, contact_id, email, created_at)
         SELECT $1, $2, c.id, c.email::text, $3
           FROM contacts c WHERE c.workspace_id = $1 LIMIT 10000`,
        [ws.workspaceA, campaignId, builtAt]);

      // Opakovaný běh nad naplněnou databází musí projít bez chyby.
      await expect(runMigrations({ url: h.urlFor('mlain_migrator') })).resolves.toBeUndefined();

      const { rows } = await h.as('mlain_migrator').query<{ n: number }>(
        'SELECT count(*)::int AS n FROM messages');
      expect(rows[0].n).toBe(10000);
    } finally { await h.stop(); }
  }, 240_000);

  it('invariant I1 drží: všech 10 000 zpráv má identické created_at s nulovými setinami',
    async () => {
      const h = await startHarness();
      try {
        const ws = await seedTwoWorkspaces(h.as('mlain_migrator'));
        const campaignId = uuidv7();
        await h.as('mlain_migrator').query(
          `INSERT INTO campaigns (id, workspace_id, name, status, audience_built_at)
           VALUES ($1, $2, 'I1', 'queueing', date_trunc('second', now()))`,
          [campaignId, ws.workspaceA]);
        // Dvě dávky po 500, jak předepisuje scénář OB-13.
        for (let batch = 0; batch < 2; batch += 1) {
          await h.as('mlain_migrator').query(
            `INSERT INTO messages (workspace_id, campaign_id, contact_id, email, created_at)
             SELECT $1, $2, gen_random_uuid(), 'b' || $3 || '-' || g || '@example.test',
                    (SELECT audience_built_at FROM campaigns WHERE id = $2)
               FROM generate_series(1, 500) AS g`,
            [ws.workspaceA, campaignId, batch]);
        }
        const { rows } = await h.as('mlain_migrator').query<
          { distinct_times: number; subsecond: number }
        >(`SELECT count(DISTINCT created_at)::int AS distinct_times,
                  count(*) FILTER (WHERE date_trunc('second', created_at) <> created_at)::int
                    AS subsecond
             FROM messages WHERE campaign_id = $1`, [campaignId]);
        expect(rows[0].distinct_times).toBe(1);
        expect(rows[0].subsecond).toBe(0);
      } finally { await h.stop(); }
    }, 180_000);
});
```

Scénář 2 je v čerstvém repozitáři nutně přiblížení: tag předchozího vydání ještě neexistuje, takže se „krok zpět" simuluje journalem bez poslední migrace. Jakmile vznikne první vydaný tag, P16 tenhle test rozšíří o skutečnou databázi z tagu. Zapisuju to jako přiznané zjednodušení, ne jako splněný scénář.

- [ ] **Step 2: Ověř, že skript v `package.json` je**

Zapsal ho úkol 1, krok 3. **Nepřidávej ho znovu**, jen zkontroluj, že v souboru je přesně tenhle řádek:

```json
    "test:migrations": "vitest run --project db test/migrations-check.test.ts",
```

Kdyby chyběl, je to chyba v provedení úkolu 1 a doplň ho tam, ne sem.

- [ ] **Step 3: Spusť testy a ověř výsledek**

Run: `pnpm --filter @mlain/db test:migrations`
Expected: PASS, 5 testů.

Kdyby druhý test scénáře 1 vygeneroval migraci, znamená to, že se Drizzle schéma rozešlo s tím, co je v migracích. Rozdíl najdi v dočasném adresáři, který si test vyrobil; typicky je to konstrukce, kterou `drizzle-kit` v úkolu 14 nevygeneroval a doplnila ji ruční migrace. V takovém případě se konstrukce z Drizzle schématu **neodstraňuje**, ale doplní se do `meta/` snapshotu tím, že se ruční migrace zapíše jako `--custom` a snapshot se přegeneruje příkazem `pnpm db:generate --name=<popis>` a **výsledný prázdný soubor se smaže i s řádkem v journalu**.

- [ ] **Step 4: Commit**

```bash
git add packages/db/test/migrations-check.test.ts
git commit -m "test(db): three migrations-check scenarios including the I1 invariant"
```

---

### Task 30: Vstupní bod balíčku a kompletní série

**Files:**
- Create: `packages/db/src/index.ts`
- Modify: `packages/db/test/schema-shape.test.ts` (brána na kořenový export)

Skript `test` do `package.json` zapisuje úkol 1, krok 3. Tenhle úkol na `package.json` **nesahá**.

- [ ] **Step 1: Napiš `src/index.ts`**

```ts
// packages/db/src/index.ts
//
// Vstupní bod balíčku. NENÍ to doménový barrel: doménové repository si píše
// každý doménový plán do packages/core/<domena> a importuje se podcestou.
export {
  checkIsolationPrerequisites, createDb, createPool,
  type Database, type PoolKind,
} from './client.js';
// unsafeWorkspaceContext tu SCHVÁLNĚ NENÍ. Importuje se výhradně podcestou
// @mlain/db/unsafe-context, tedy vždy vědomě. Dokud byla tady, nabízel ji
// našeptávač každému, kdo psal `import { w` z '@mlain/db', a jediná ochrana
// bylo pravidlo ESLintu, které si tenhle plán přál a po nikom nevyžádal.
export {
  type Actor, type Permission, type Role, type WorkspaceContext,
} from './context.js';
// `schema` se tu SCHVÁLNĚ nereexportuje (rozhodnutí R37). Importuje se výhradně
// podcestou `@mlain/db/schema`, podle které už píše P04 i doménové plány.
// Kdyby tu navíc bylo `export * as schema`, existovaly by dvě rovnocenné cesty
// k témuž a plány by si vybíraly každý po svém, což je přesně ten stav,
// kterému se to mělo vyhnout. Hlídá to test kořenového exportu v kroku 2.
export {
  pgErrorCode, withReadOnly, withUser, withWorkspace, withoutContext,
  type ReadOnlyOptions, type Tx,
} from './repo/tx.js';
export {
  registerRepoModule, registeredRepoModules, type RepoModule,
} from './repo/registry.js';
export { listGlobalAuditForUser, type GlobalAuditRow } from './repo/audit-global.js';
export {
  createWorkspaceAsUser, listWorkspacesForUser,
  type CreateWorkspaceInput, type WorkspaceRow,
} from './repo/workspaces-global.js';
export {
  MESSAGES_STORAGE, PARTITIONED_REFERENCES, PARTITIONED_TABLES,
  UNIQUE_INDEX_EXCEPTIONS, createIndexConcurrentlyOnPartitioned,
  createMonthlyPartitions, dropPartitionsBefore, ensurePartitionsForRange,
  ensureUpcomingPartitions, partitionName,
  type PartitionVeto, type PartitionedReference, type PartitionedTable,
  type StorageOptions,
} from './partitions.js';
export {
  EXTRA_POLICIES, MAINTENANCE_BYPASS_TABLES, RLS_REGISTRY, SENDER_BYPASS_TABLES,
  TABLES_WITHOUT_RLS, TABLES_WITHOUT_WORKSPACE_ID, expectedPolicies,
  type PolicyKind, type TablePolicy,
} from './rls.js';
export {
  attributeIndexName, dropAttributeIndex, ensureAttributeIndex, isAttributeIndexValid,
} from './attribute-index.js';
export { MIGRATION_ADVISORY_LOCK_ID, MigrationError, runMigrations } from './migrate.js';
```

- [ ] **Step 2: Přidej do `schema-shape.test.ts` bránu na kořenový export**

Ochrana, kterou nic nevynucuje, není ochrana. Tenhle test běží v projektu `unit`, tedy bez databáze.

```ts
// packages/db/test/schema-shape.test.ts, doplň nový describe
import * as rootExport from '../src/index.js';

describe('kořenový export balíčku', () => {
  it('nevystavuje unsafeWorkspaceContext', () => {
    expect(Object.keys(rootExport),
      'unsafeWorkspaceContext patří výhradně do @mlain/db/unsafe-context')
      .not.toContain('unsafeWorkspaceContext');
  });

  it('vystavuje všechny čtyři transakční obálky, pgErrorCode a kontrolu předpokladů', () => {
    // withoutContext tu MUSÍ být: bez něj si každý volající, který nemá
    // aktéra (přihlášení, rate limiting, start aplikace), vyrobí vlastní
    // obcházku a ta nebude mít ani úklid rozbitého spojení.
    for (const name of ['withWorkspace', 'withUser', 'withReadOnly', 'withoutContext',
                        'pgErrorCode', 'checkIsolationPrerequisites']) {
      expect(Object.keys(rootExport)).toContain(name);
    }
  });

  it('nereexportuje schema, to jde výhradně podcestou @mlain/db/schema', () => {
    // Rozhodnutí R37. Dvě rovnocenné cesty k témuž znamenají, že si každý plán
    // vybere jinou, a „jeden zjevný způsob" přestane platit v okamžiku,
    // kdy vznikne druhý.
    expect(Object.keys(rootExport),
      'schema patří výhradně do podcesty @mlain/db/schema').not.toContain('schema');
  });
});
```

- [ ] **Step 3: Spusť kompletní sérii**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool
pnpm --filter @mlain/db typecheck
pnpm --filter @mlain/db test
pnpm lint
```

Lint se pouští **z kořene**, ne přes `--filter`. Skript `lint` má jen kořenový `package.json` (`oxlint . && eslint . && prettier --check .`) a žádný balíček vlastní `lint` nemá; `pnpm --filter @mlain/db lint` by skončil chybou „no script named lint". Že kořenový lint pokrývá i `packages/db`, je požadavek na P01 a je zapsaný v evidenci nálezů.

Expected: všechny tři zelené. Konkrétně:
- `typecheck`: bez chyb.
- `test:unit`: 2 soubory, 14 testů (`schema-shape` 7, `column-types` 7).
- `test:db`: 16 souborů, 170 testů. Rozpis: `migrate` 12, `extensions` 1, `core-tables` 20, `partitioned-tables` 11, `partitions` 16, `attribute-index` 4, `rls-registry` 7, `grants` 13, `system-settings` 6, `context` 16, `workspaces-global` 5, `isolation` 10, `audit-log` 8, `sender-role` 19, `contract-sql` 17, `migrations-check` 5.
- **Celkem 184 testů** v 18 souborech.
- `lint`: bez chyb.

Když cokoliv padá, dohledej příčinu a oprav ji. **Nezvyšuj hranice v testech a nepřepisuj očekávaná čísla**, dokud nevíš, které tabulce, politice nebo grantu odpovídají.

- [ ] **Step 4: Ověř, že plán nesáhl mimo své vlastnictví**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && git status --porcelain
```
Expected: každý změněný soubor je pod `packages/db/` nebo je to `docs/superpowers/plans/2026-07-31-p03-databaze-schema-rls.md`. Kdyby se v seznamu objevil `turbo.json`, `docker/`, `.github/workflows` nebo jiný balíček, je to **chyba plánu** a změnu je nutné vrátit a předat příslušnému plánu.

- [ ] **Step 5: Commit**

```bash
git add packages/db/src/index.ts packages/db/test/schema-shape.test.ts
git commit -m "feat(db): package entry point and full test suite green"
```

---

## 6. Akceptační kritéria, která plán pokrývá

Číslování je z části 1, kapitoly 8, není-li uvedeno jinak.

| Kritérium | Znění (zkráceně) | Kde se testuje |
|---|---|---|
| **4** | Tři repliky aplikují migrace právě jednou, `drizzle.__drizzle_migrations` obsahuje každou migraci jednou | `test/migrate.test.ts`, „tři souběžné běhy" |
| **5** | Zabití kontejneru během migrace a restart vede k dokončení bez ruční akce | `test/migrate.test.ts`, „opakovaný běh nad hotovou databází" plus session-scoped advisory lock, který se po pádu uvolní sám |
| **8e** | Migrace se aplikují pod rolí `mlain_migrator`; spuštění pod `mlain_app` selže na chybějícím vlastnictví schématu | `test/migrate.test.ts` plus vlastnictví `public` v `test/helpers/container.ts` |
| **13** | Start se `schema_version` vyšší, než image zná, skončí exit code 5 a kódem `schema_version_ahead` | `test/migrate.test.ts`, poslední test |
| **20** | `SELECT * FROM contacts` pod `mlain_app` bez `set_config('mlain.workspace_id')` vrátí **0 řádků** | `test/isolation.test.ts`, první test |
| **21** | Vložení řádku s cizím `workspace_id` selže na `WITH CHECK` | `test/isolation.test.ts` |
| **21b** | Změna hesla uspěje, v `audit_log` vznikne řádek s `workspace_id IS NULL` a transakce se nerollbackne ani bez workspace kontextu | `test/audit-log.test.ts`, „změna hesla se commitne" |
| **21c** | `SELECT * FROM audit_log` pod kontextem B nevrátí ani řádek A, ani globální řádek | `test/audit-log.test.ts` |
| **21d** | `SELECT * FROM workspaces` pod kontextem B vrátí právě jeden řádek; výpis přes `workspaces-global` s `mlain.user_id` vrátí jen projekty s členstvím, bez něj 0 řádků | `test/isolation.test.ts`, `test/workspaces-global.test.ts` |
| **21e** | Test „každá tabulka mimo whitelist má `workspace_id`" projde, přestože `workspaces` sloupec nemá, a zároveň `workspaces` má zapnuté RLS | `test/rls-registry.test.ts`, první dva testy |
| **49** | Sender s rolí `mlain_sender` dostane chybu oprávnění na `SELECT * FROM contacts` i na `DELETE FROM messages` | `test/sender-role.test.ts` |
| **Scénáře migrací z 3.13** | Tři scénáře jobu `migrations-check` | `test/migrations-check.test.ts` |
| **AK-20.2** (část 4b) | **Nahrazeno rozhodnutím R20.** Nová partition není přímo přístupná žádné roli; sender čte výhradně přes rodičovskou tabulku a žádný oddíl jménem nečte | `test/partitions.test.ts` a `test/grants.test.ts`, testy přímého přístupu na oddíl a kontrola `pg_class.relacl` |
| **Invariant I1** (část 1, 4.10.1) | Všechny zprávy jednoho materializačního běhu mají `created_at` rovné `campaigns.audience_built_at`; porušení skončí chybou, ne duplicitním e-mailem | `test/partitioned-tables.test.ts` a cizí klíč `fk_messages__campaign_audience` z migrace 0003 |
| **Obnova ze zálohy** (část 1, 3.14) | Po obnově z `pg_dump --no-privileges` jde oprávnění obnovit jedním voláním, bez zásahu do ledgeru migrací | `test/grants.test.ts`, „po ztrátě grantů je funkce obnoví do stejného stavu" |
| **AK-20.5** (část 4b) | Scénáře `OB-*` běží pod rolí `mlain_sender`, ne pod migrátorem | `test/sender-role.test.ts` a `test/contract-sql.test.ts`, celé soubory |
| **OB-00** (část 1, 4.10.1) | Každý normativní dotaz kontraktu projde proti čerstvě zmigrované databázi | `test/contract-sql.test.ts` (úplný scénář proti fixtures vlastní P02 a P09) |
| **OB-05, OB-06, OB-08, OB-09, OB-13, OB-16, OB-17, OB-18** | Claim pod pauzou, pod smazaným projektem, oprávnění, invariant I1, pozastavení kampaně senderem | `test/sender-role.test.ts`, `test/migrations-check.test.ts` |

Kritéria, která plán **nepokrývá a pokrývat nemá**: 1 až 3, 6 až 8d, 9 až 12 (instalace a provoz, vlastní P01 a P16), 14 až 19 a 22 až 26c (identita a přístup, vlastní P04), 27 až 40 (API framework a webhooky, vlastní P04), 41 až 46 a 50 (kontrakty a tokeny, vlastní P02 a P09), 47 a 48 (souběh a ztráta zpráv v senderu, vlastní P09), 51 až 56 (i18n a rotace klíčů, vlastní P05 a P16).

---

## 7. Co tenhle plán vlastní

Následující soubory smí vytvořit a měnit **výhradně tenhle plán**. Mimo tenhle seznam plán nesahá na nic.

`packages/db/package.json` a `packages/db/tsconfig.json` v seznamu jsou, ale **zakládá je P01** (úkol 5, krok 3) jako prázdné manifesty. Tenhle plán je jen doplňuje a nesmí z nich zahodit `license`, na kterou se dívá licenční brána v CI.

```
packages/db/package.json          (doplňuje, nezakládá)
packages/db/tsconfig.json         (doplňuje, nezakládá)
packages/db/vitest.config.ts
packages/db/drizzle.config.ts

packages/db/migrations/0000_extensions.sql
packages/db/migrations/0001_core_tables.sql
packages/db/migrations/0002_templates_cycle_fk.sql
packages/db/migrations/0003_partitioned_tables.sql
packages/db/migrations/0004_rls_policies.sql
packages/db/migrations/0005_grants.sql
packages/db/migrations/0006_system_settings_seed.sql
packages/db/migrations/meta/_journal.json
packages/db/migrations/meta/0001_snapshot.json

packages/db/src/index.ts
packages/db/src/client.ts
packages/db/src/context.ts
packages/db/src/unsafe-context.ts
packages/db/src/migrate.ts
packages/db/src/partitions.ts
packages/db/src/attribute-index.ts
packages/db/src/rls.ts
packages/db/src/schema/_types.ts
packages/db/src/schema/identity.ts
packages/db/src/schema/platform.ts
packages/db/src/schema/contacts.ts
packages/db/src/schema/content.ts
packages/db/src/schema/campaigns.ts
packages/db/src/schema/tracking.ts
packages/db/src/schema/partitioned.ts
packages/db/src/schema/index.ts
packages/db/src/repo/tx.ts
packages/db/src/repo/registry.ts
packages/db/src/repo/workspaces-global.ts
packages/db/src/repo/audit-global.ts

packages/db/test/global-setup.ts
packages/db/test/helpers/container.ts
packages/db/test/helpers/fixtures.ts
packages/db/test/schema-shape.test.ts
packages/db/test/column-types.test.ts
packages/db/test/migrate.test.ts
packages/db/test/extensions.test.ts
packages/db/test/core-tables.test.ts
packages/db/test/partitioned-tables.test.ts
packages/db/test/partitions.test.ts
packages/db/test/attribute-index.test.ts
packages/db/test/rls-registry.test.ts
packages/db/test/grants.test.ts
packages/db/test/system-settings.test.ts
packages/db/test/context.test.ts
packages/db/test/workspaces-global.test.ts
packages/db/test/isolation.test.ts
packages/db/test/audit-log.test.ts
packages/db/test/sender-role.test.ts
packages/db/test/contract-sql.test.ts
packages/db/test/migrations-check.test.ts
```

**Mimo tenhle seznam plán nesahá na žádný soubor v repozitáři.** Když se během provádění ukáže, že je potřeba změna jinde (nový CI job, nová konfigurační proměnná, nová položka v `turbo.json`, řádek v `docker/initdb/10-roles.sql`), zapíše se jako **požadavek na vlastnící plán** a plán P03 pokračuje bez ní. Změna cizího souboru je chyba plánu, i když je správná.

Konkrétně tenhle plán vyžaduje od P01 tři věci a žádnou z nich si neudělá sám:

| # | Požadavek na P01 | Proč |
|---|---|---|
| A | `docker/initdb/10-roles.sql` zakládá šest rolí: `mlain_migrator`, `mlain_app`, `mlain_sender`, `mlain_gdpr`, `mlain_maintenance`, `mlain_backup`, dává `mlain_migrator` vlastnictví schématu `public` a `CREATE` na databázi, a `mlain_backup` roli `pg_read_all_data` | `CREATE ROLE` vyžaduje `CREATEROLE` nebo superuživatele a migrátor je záměrně nemá. `CREATE` na databázi je nutné pro `CREATE EXTENSION`, i když jsou všechna tři rozšíření trusted. |
| B | `docker/initdb` nastavuje `ALTER DATABASE ... SET timezone = 'UTC'` | `ALTER DATABASE` smí jen vlastník databáze nebo superuživatel. Aplikace navíc vynucuje `timezone=UTC` na každém spojení, což je jediná spolehlivá cesta u externí databáze. |
| C | CI joby `test-db`, `migrations-check` a `contracts-schema` volají skripty `pnpm --filter @mlain/db test:db`, `test:migrations` a `test:db -- test/contract-sql.test.ts` | Tabulka jobů v části 1, kapitole 3.15 je jediný autoritativní seznam a vlastní ji P01. |
| D | Kořenový skript `lint` pokrývá i `packages/db` | Balíčkový skript `lint` neexistuje a tenhle plán ho zavádět nesmí: lintovací konfigurace je kořenová a vlastní ji P01. Finální brána proto volá `pnpm lint` z kořene. |
| E | Kontrolní skript v `tools/ci`, který P01 předává jako „selže, dokud mu někdo nedodá scénáře", si najde scénáře tam, kde je tenhle plán skutečně píše (`packages/db/test/migrations-check.test.ts`) | P03 nesmí sáhnout do `tools/ci` ani do `.github/workflows`, takže tu opravu nemá kdo udělat. Dokud nevznikne, zůstane blokující job po mergnutí červený. |

---

## 8. Pravidlo, které platí pro všech ostatních patnáct plánů

> **Žádný jiný plán než P03 nesmí spustit `drizzle-kit generate` ani `drizzle-kit generate --custom`, nesmí založit ani upravit soubor v `packages/db/migrations`, nesmí přidat, odebrat ani změnit tabulku, sloupec, index, omezení, politiku ani grant v `packages/db/src/schema`, a nesmí měnit `packages/db/migrations/meta/_journal.json`.**

Doménové plány schéma **jen importují** (`import { contacts } from '@mlain/db/schema'`) a datový přístup vedou přes repository vrstvu.

Důvod není administrativní. Merge konflikt v `meta/_journal.json` je ještě ta lepší varianta: je vidět a někdo ho vyřeší. Horší je tichá varianta, kdy git spojí dvě syntakticky správné migrace do schématu, které nikdo nenavrhl. Projeví se to až u zákazníka, který nemá rollback a aktualizuje, kdy chce.

Když doménový plán zjistí, že mu ve schématu něco chybí, postup je:

1. Zapsat požadavek do svého plánu jako **požadavek na P03**, s odůvodněním a navrženým tvarem.
2. Pokračovat bez něj, pokud to jde.
3. Změnu provede P03 jako novou dopřednou migraci. **Down migrace se nepíše nikdy.**

Zvlášť ostře to platí pro **kontraktní sloupce `messages`** (část 1, kapitola 4.10.1). Jejich název, typ ani sémantika se nesmí změnit ani v P03. Změna je formální rozmrazení kontraktu, tedy rozhodnutí, ne implementační krok.

---

## 9. Nejčastější způsoby, jak tenhle plán pokazit

Sepsané proto, že každý z nich má za sebou konkrétní poruchu v tomhle projektu.

| Chyba | Jak se projeví | Co ji zachytí |
|---|---|---|
| Testy RLS běží pod migrátorem | Zelené testy, v produkci sender nevidí ani řádek | Každý test v `sender-role.test.ts` běží pod `h.as('mlain_sender')`; první test kontroluje, že sender **skutečně vidí** řádky |
| `schema/partitioned.ts` se dostane do `drizzle.config.ts` | `PARTITION BY` zmizí, projeví se až na objemu dat | Test „partitionované tabulky v tuhle chvíli ještě neexistují" a grep v úkolu 14, krok 4 |
| Odkaz na partitionovanou tabulku nese jen `id` | `WHERE id = $1` vypadá správně, ale prohledá všechny partition | Test „message_events nese obě složky klíče" a test prořezávání v `isolation.test.ts` |
| `audit_log` dostane obyčejnou `ws_isolation` | Změna hesla se neuloží, protože audit spadne na `WITH CHECK` a vezme s sebou transakci | `audit-log.test.ts`, test „změna hesla se commitne" |
| `ON CONFLICT` u materializace jen nad dvěma sloupci | Tvrdý `ERROR`, materializace neproběhne vůbec | `contract-sql.test.ts`, test „ON CONFLICT jen nad dvěma sloupci naopak MUSÍ selhat" |
| `ambiguous_count` chybí ve sloupcovém grantu senderu | Reaper skončí na `permission denied` a celý mechanismus `ambiguous_dispatch` je neproveditelný | `sender-role.test.ts`, test „sender SMÍ inkrementovat ambiguous_count" |
| `created_at` se dostane do sloupcového grantu senderu | Sender může porušit invariant I1 a duplicitní příjemce projde | `sender-role.test.ts`, test „sender NESMÍ přepsat created_at" |
| Retenční job odpojí partition s běžící kampaní | Kampaň přijde o outbox pod rukama a po obnovení se tváří jako doběhlá, přestože neodeslala nic | `dropPartitionsBefore` má **povinný** parametr `veto` a bez něj vyhodí výjimku; test na to je v `partitions.test.ts` |
| Zavede se `DEFAULT` partition, aby „zápis neselhal" | Data skončí v koši, ze kterého se nedá odpojit rozsah | Test „žádná partitionovaná tabulka nemá DEFAULT partition" |
| Append-only se řeší přes `CREATE RULE ... DO INSTEAD NOTHING` | Smazání kontaktu proběhne bez chyby, ale souhlasy zůstanou jako osiřelé řádky s osobními údaji | `audit-log.test.ts`, test „ON DELETE CASCADE z contacts souhlasy odstraní" |
| Očekávané číslo v testu se upraví podle výsledku | Test přestane být bránou a stane se popisem stavu | Každé číslo v testech (75 tabulek, 84 politik, 9 partitionovaných tabulek, 7 migrací) má protějšek v kapitolách 2 a 3 tohohle plánu; mění se obojí naráz, nebo nic |
| `rank` se doplní `DEFAULT`, aby „zápis neselhal" | Špatná hodnota nezpůsobí chybu, ale tiše rozbije odvození stavu zprávy, což je nejtišší možná porucha | `partitioned-tables.test.ts`, test „rank je generovaný sloupec a nejde do něj zapsat zvenčí" |
| Do `ck_message_events__type` přibude typ bez ramene ve škále `rank` | Zápis takové události spadne na `NOT NULL`, což vypadá jako chyba volajícího | `partitioned-tables.test.ts`, test „každý povolený typ události má rameno ve škále rank", který se ptá katalogu dvakrát ze dvou nezávislých míst |
| `recipient` se vrátí na `NOT NULL`, protože „adresa přece vždycky je" | E-mailová adresa se okopíruje na každý řádek desetimilionové tabulky a GDPR výmaz ji musí procházet všude | `partitioned-tables.test.ts`, test „recipient je nepovinný, ale doručovací rodina ho mít musí" |
| `Tx` zůstane `PoolClient`, nebo se transakce otevře přes `db.transaction()` | V prvním případě se datová vrstva nezkompiluje, ve druhém neseděl typ P04 a ztratí se úklid rozbitého spojení | `context.test.ts`, test „Tx je Drizzle handle, ne syrový PoolClient" |
| Řádky se čtou vzorem `await tx.execute(...) as unknown as Row[]` | Projde typovou kontrolou i revizí a **za běhu vrátí `undefined`**, protože ovladač vrací obálku výsledku, ne pole | `context.test.ts`, test „tx.execute vrací obálku výsledku, ne pole řádků" |
| Kolize se ošetří přes `error.code` | Přes Drizzle je `error.code` `undefined`, takže se ošetření **nikdy neprovede** a kolize projde jako neznámá chyba | `context.test.ts`, test „pgErrorCode najde kód z Drizzle chyby i ze syrové chyby pg" |
| `withoutContext` se použije nad tabulkou s RLS | Dotaz vrátí nula řádků bez chyby, což vypadá jako „nic tam není" | `context.test.ts`, test „na tabulce s RLS nevrátí nic, na platformové tabulce funguje" |
| `work_mem` se do `SET LOCAL` vloží bez kontroly tvaru | `SET LOCAL` nejde parametrizovat, takže je to přímá injekce do příkazu běžícího pod aplikační rolí | `context.test.ts`, test „work_mem mimo povolený tvar se odmítne dřív, než se sáhne na databázi" |
| `campaign_links.id` se nechá s `DEFAULT uuidv7()` | Odkaz v odeslaném e-mailu na řádek nenaváže a report odkazů zůstane prázdný, aniž by cokoli spadlo | Zápis bez `id` skončí chybou `not-null`; kontroluje to `core-tables.test.ts` |
| Oddílu se zkopírují granty z rodiče | `SELECT` přímo z oddílu vrátí řádky všech projektů a `DELETE` z oddílu `audit_log` smaže i cizí a globální záznamy, protože oddíl nedědí RLS | `grants.test.ts` se ptá `pg_class.relacl`, jestli má **jakýkoli** oddíl ACL záznam, plus dva behaviorální testy přímého přístupu |
| Politika čte kontext holým `current_setting(..., true)` | Druhý dotaz z recyklovaného poolového spojení spadne na 22P02 místo prázdného výsledku, a bootstrap politika pustí založení projektu bez aktéra | `context.test.ts`, testy „druhý dotaz ze stejného spojení" a „bootstrap politika nepustí" |
| Kontrola ochrany se ptá téhož seznamu, ze kterého ochrana vznikla | Tabulka s grantem a bez politiky projde, protože v seznamu chybí obojí | `grants.test.ts` porovnává `aclexplode` proti `pg_policies`, tedy dva nezávislé katalogové zdroje, a teprve pak obojí proti registru |
| Unikátní index na partitionované tabulce se opře o sloupec s `DEFAULT now()` | Index slibuje ochranu, kterou nemá: dva zápisy téže události projdou oba a statistiky kampaně se rozjedou | Katalogový test v `partitions.test.ts` nad `pg_index` a `pg_attrdef`, s pojmenovaným registrem výjimek |
| Hranice oddílu se zapíše jako `'2026-08-01'` místo `TIMESTAMPTZ '2026-08-01 00:00:00+00'` | Oddíl založený pod jinou časovou zónou začne o dvě hodiny dřív a mezi měsíci zůstane díra, do které se nedá zapsat | `partitions.test.ts`, test „hranice oddílu je v UTC bez ohledu na časovou zónu spojení" |

---

## 10. Provedení

Plán je psaný pro provádění ve worktree založeném z `HEAD`, ne ze zastaralého `origin/main`. Do worktree se zkopírují soubory `.env*` a nainstalují závislosti, jinak build spadne.

Vlna 0 je sekvenční: P03 se otevírá teprve tehdy, když jsou P01 a P02 **smergované do `main`**, ne jen hotové ve svém worktree. Plány vlny 1 čtou schéma z P03, takže kdyby četly rozpracovanou verzi, každý si přečte jinou.

Git dělá jen hlavní agent. Subagenti píšou soubory, necommitují, nemergují a nepushují.

