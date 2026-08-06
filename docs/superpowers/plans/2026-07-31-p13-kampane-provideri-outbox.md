# P13: Kampaně, provideři a outbox, implementační plán

<!-- puvod-dokumentu -->
> **Historický záznam, ne platné zadání.** Implementační plán P13 (kampaně, provideři a outbox) z 31. 7. 2026, sepsaný před
> začátkem stavby. Zachycuje, co se tehdy plánovalo, ne dnešní podobu kódu.
> **Postaveno:** kampaně, provideři a outbox v `packages/core/src` existují, kampaň projde celou cestou.
> **Zaškrtávátka nikdo neodškrtával**, prázdné políčko tady tedy neznamená nedodělek.
> **Dnešní stav:** `docs/superpowers/STAV-UKOLU.md` (živý dokument), design `docs/superpowers/DESIGN-INTEGRACE.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dodat aplikační polovinu odesílacího toku Mlain Maileru: model kampaně s úplným stavovým strojem, zmrazení a materializaci publika do outboxu, nastavení a ověření odesílacích providerů a domén, příjem a normalizaci událostí od Amazonu, pojistky doručitelnosti s automatickou pauzou a obrazovky kampaní a nastavení odesílání.

**Architecture:** Doménová logika žije v `packages/core/src/campaigns/**` a `packages/core/src/providers/**` a nezná HTTP ani databázi přímo. Datový přístup jde přes repository soubory v `packages/core/src/campaigns/repo/` a `packages/core/src/providers/repo/`, které píšou normativní SQL ze specifikace doslova, aby ho scénář `OB-00` mohl spustit; nese ho k Drizzle handle pomocná funkce `rawSql` (rozhodnutí D19). Transakce otevírá `withWorkspace(ctx, fn)` z `@mlain/core/tx`, čtení dynamicky složeného SQL `withReadOnly`. V `packages/db` plán nezakládá ani jeden soubor. O způsobilosti kontaktu rozhoduje výhradně `compileAudienceToSql` z části 2; vedle jeho výrazu stojí v kandidátském dotazu jen hrubé, vědomě viditelné filtry. Materializace skládá `render_data` v Node a **volá kontraktní `prepareRenderData`** (rozhodnutí D20), bez čehož by se v odeslaných mailech tiše skryly všechny podmíněné bloky. Jediné rozhraní k senderu je tabulka `messages`, jejíž kontraktní sloupce plán nemění; producentem je materializace, konzumentem zkompilovaná Go binárka z plánu P09. Příchozí SNS požadavek jen ověří podpis, uloží potvrzenku a předá práci jobu, takže špička událostí nesrazí web.

**Tech Stack:** TypeScript 7.0.2 (Apache-2.0), Next.js 16.2.12 (MIT), Hono 4.12.33 (MIT), `@hono/zod-openapi` 1.5.1 (MIT), zod 4.4.3 (MIT), Drizzle ORM (MIT), pg 8.22.0 (MIT), pg-boss 12.26.3 (MIT), `@aws-sdk/client-sesv2` 3.1100.0 (Apache-2.0), `@aws-sdk/client-sns` 3.1100.0 (Apache-2.0), `sns-validator` 0.3.5 (Apache-2.0), `psl` 1.15.0 (MIT), `luxon` 3.7.2 (MIT), `p-limit` 7.3.1 (MIT), `next-intl` 4.13.4 (MIT), Vitest 4.1.10 (MIT), testcontainers 12.0.4 (MIT). Úplná tabulka s licencemi je v kapitole 5.

---

## 1. Co tenhle plán vlastní

Řídicí pravidlo z `docs/superpowers/plans/2026-07-31-rozdeleni-implementacnich-planu.md` zní: každý soubor v repozitáři má právě jeden plán, který ho smí vytvořit a měnit. Tohle je ten seznam pro P13.

### 1.1 Soubory a adresáře ve výhradním vlastnictví P13

| Cesta | Obsah |
|---|---|
| `packages/core/src/campaigns/**` | model kampaně, stavový stroj, publikum, materializace, ovládání, preflight, doručitelnost, joby |
| `packages/core/src/providers/**` | SES a SMTP konfigurace, kvóty, domény, DNS kontroly, příjem SNS |
| `packages/core/data/dns-providers.json` | živý datový soubor s návody podle DNS poskytovatele (část 6, 8.2.10) |
| `packages/core/data/smtp-presets.json` | živý datový soubor s předvolbami SMTP (část 6, 8.2.10) |
| `packages/core/src/campaigns/repo/**` | repository kampaní, outboxu, událostí a doručitelnosti |
| `packages/core/src/providers/repo/**` | repository providerů a odesílacích domén |
| `packages/i18n/messages/cs/campaigns.json` | český katalog namespace `campaigns` |
| `packages/i18n/messages/en/campaigns.json` | anglický katalog namespace `campaigns` |
| `apps/web/src/server/routes/campaigns/**` | Hono sub-app `/api/v1/campaigns/*` |
| `apps/web/src/server/routes/providers/**` | Hono sub-app `/api/v1/providers/*` a `/api/v1/domains/*` |
| `apps/web/src/server/routes/webhooks-ses/**` | Hono sub-app `/api/webhooks/ses/{provider_id}` |
| `apps/web/src/app/[locale]/w/[slug]/campaigns/**` | obrazovky kampaní |
| `apps/web/src/app/[locale]/w/[slug]/settings/sending/**` | obrazovky nastavení odesílání a DNS |
| `apps/web/src/app/[locale]/w/[slug]/deliverability/**` | dashboard doručitelnosti |
| `apps/web/src/app/[locale]/d/[token]/**` | veřejná delegační stránka s DNS záznamy |
| `apps/web/src/features/campaigns/**` | klientské komponenty kampaní |
| `apps/web/src/features/sending/**` | klientské komponenty nastavení odesílání |
| `packages/contracts/fixtures/sns/**` a `packages/contracts/fixtures/ses/**` | **NE, viz 1.3** |

### 1.2 Soubory, které P13 čte a nikdy nemění

`packages/db/**` **celý** (schéma, migrace, `rls.ts`, `partitions.ts`, `package.json`), `packages/core/src/tx/**`, `packages/core/src/config/**`, `packages/core/src/errors/**`, `packages/core/src/queues/**`, `packages/core/src/contacts/**` (včetně `repo/segments.ts` a `repo/suppressions.ts`), `packages/core/src/templates/**`, `packages/core/src/demo/**` (konvence ukázkových dat, vlastní P16), `packages/contracts/**`, `packages/emails/**`, `packages/ui/**`, `packages/i18n/` mimo dva vlastní soubory, `apps/web/src/lib/api/**`, `apps/web/src/proxy.ts`, `apps/sender/**`, `docker/**`, `.github/workflows/**`, `turbo.json`.

### 1.3 Čeho se P13 vědomě nedotýká

- **Schéma databáze a migrace.** Vlastní P03. Všechny tabulky z části 4a, kapitoly 2, zakládá P03. P13 je jen používá. Co P13 navíc potřebuje, je vypsané v kapitole 4 jako požadavek, ne jako úkol tohoto plánu.
- **Kontraktní sloupce `messages`.** Vlastní kontrakt 1 (část 1, 4.10.1). P13 nemění název, typ ani sémantiku žádného z nich, nemění hodnoty stavů ani povolené přechody. Přidávat sloupce a indexy kontrakt dovoluje, ale i to dělá P03 v migraci.
- **Sender.** `apps/sender/**` vlastní P09. P13 do něj nesahá a nepíše žádný Go kód.
- **Komponenty design systému.** `packages/ui` vlastní P05. P13 komponenty K1 až K8 jen používá.
- **Kontakty, seznamy, segmenty a suppression list.** Vlastní P07 a P11. **O způsobilosti kontaktu rozhoduje výhradně `compileAudienceToSql`**, jehož výstup P13 vkládá do svých dotazů jako neprůhledný výraz do `WHERE`. P13 tu podmínku nikdy nepřepisuje, nedoplňuje ani neobchází.

  Vlastní SQL `FROM contacts` přesto na třech místech je a je to vědomé, ne opomenutí: kandidátský dotaz materializace, náhled počtu publika a dohledání kontaktu pro testovací mail. Všechna tři jsou **čtecí** a podmínky, které v nich stojí vedle výrazu z kompilátoru, jsou jen **hrubé filtry, které chci mít vidět**: `status = 'active'`, `deleted_at IS NULL`, neprázdná adresa a vyloučení ukázkových kontaktů. Kdyby byly schované uvnitř kompilátoru, nešlo by z materializačního dotazu přečíst, co se do outboxu doopravdy dostane, a scénář `OB-00` by porovnával jiný text, než jaký běží.

  Původní znění téhle odrážky tvrdilo, že P13 nad `contacts` nepíše SQL **nikdy**, což neodpovídalo ani jeho vlastnímu kódu.
- **Kompilace šablony do HTML a textu.** Vlastní P08. P13 volá `compileTemplate` a spoléhá se na jeho validaci Liquidu.
- **Golden fixtures a kontrakty.** `packages/contracts` vlastní P02, včetně fixtures SNS a SES z části 4a, 8.16. P13 je čte v testech a nezakládá je. Kdyby při psaní testů chyběly, je to nález proti P02, ne důvod si je založit.
- **Reporty, dashboard přehledu a časová osa.** Vlastní P14. P13 dodává `GET /campaigns/{id}/progress` jako datový tvar, ne SSE kanál.
- **Registry chybových kódů, front a konfigurace.** Vlastní P01. P13 je používá a testem ověřuje, že v nich jsou položky, které potřebuje.

---

## 2. Rozhodnutí, která tenhle plán udělal sám

Specifikace tyhle body neuzavírá, nebo si dva dokumenty protiřečí. Rozhodnutí jsou tady, s odůvodněním, aby šla přehlasovat vědomě.

**D1. Testovací odeslání se pozná podle kontraktního sloupce `messages.kind`, ne podle `render_data['_test']`.** Část 4a v 3.17.1 popisuje `_test` jako **dočasnou realizaci** a žádá kontraktní sloupec `kind` požadavkem R1.18. Část 1 ho mezitím do kontraktu doplnila (4.10.1: `kind text NOT NULL DEFAULT 'campaign'` s `CHECK (kind IN ('campaign','test'))`), takže dočasná realizace tímhle okamžikem končí. Materializace kampaně zapisuje `kind = 'campaign'`, testovací odeslání `kind = 'test'`, statistiky filtrují `kind = 'campaign'` indexem, ne funkcí nad JSONB. Do `render_data` se `_test` **nezapisuje vůbec**, protože by to byla druhá, rozcházející se pravda. Akceptační kritérium 50 části 4a je tím splněné jinak, než jak je napsané, a plán to říká nahlas: kritérium se čte jako „testovací zprávy jsou rozeznatelné a nepočítají se do `total_count`".

**D2. Doménové repository P13 žijí v `packages/core/src/campaigns/repo/` a `packages/core/src/providers/repo/`, ne v `packages/db`.** Původní podoba plánu je umisťovala do `packages/db/src/repo/campaigns/**` a importovala podcestou `@mlain/db/repo/...`. To nefunguje ze dvou nezávislých důvodů a obojí je ověřené spuštěním pod Node 24. Za prvé `packages/db/package.json` má pět exportů (`.`, `./schema`, `./migrate`, `./partitions`, `./rls`, `./unsafe-context`) a **žádný zástupný znak**, takže `@mlain/db/repo/campaigns/outbox` skončí `ERR_PACKAGE_PATH_NOT_EXPORTED`. Za druhé `packages/db` vlastní výhradně P03 a nová složka v cizím balíčku je přesně ta konstrukce, které brání uzávěr S1. Rozhodnutí P07-1 tuhle otázku uzavřelo obecně: platí `packages/core/src/<domena>/`, a P07 podle něj přesunul svoji datovou vrstvu do `packages/core/src/contacts/repo/`. P13 dělá totéž. Import je vždy `@mlain/core/campaigns` nebo `@mlain/core/providers`, protože mapa `exports` balíčku `@mlain/core` má `"./*": "./src/*/index.ts"` a zástupný znak **pohlcuje lomítka**, takže hlubší podcesta se nerozřeší.

**D3. Repository P13 píšou normativní dotazy jako syrový SQL text s pozičními parametry, ne přes query builder.** Materializace, claim, úklid při zrušení, rekoncilace a dedup jsou v obou specifikacích zapsané jako SQL a scénář `OB-00` je spouští doslova. Kdyby se přeložily do builderu, přestal by mezi specifikací a kódem existovat porovnatelný text a `OB-00` by ověřoval jinou věc, než která běží v produkci. Ostatní dotazy (běžné čtení jednoho řádku, výpisy) builder používat smějí.

Nést ten text k databázi ale **nejde přímo**: `Tx` z `@mlain/core/tx` je Drizzle handle (`NodePgDatabase`), a ten metodu `query(text, params)` nemá. Ověřeno spuštěním: `typeof tx.query` je `object` (je to relační dotazovací API Drizzle, ne funkce) a volání `tx.query('select 1', [])` padá s `tx.query is not a function`. Původní podoba plánu tak volala neexistující metodu na **97 místech**. Řešením je jediné nové primitivum `rawSql(text, params)` z úkolu 2, které normativní text zachová doslova a parametry předá jako parametry. Viz rozhodnutí D19.

**D4. Publikum se skládá dvěma voláními `compileAudienceToSql`, ne jedním.** Kompilátor části 2 bere jen sjednocení (`segmentIds`, `listIds`), kdežto `CampaignAudience` má `include` i `exclude`. P13 proto volá kompilátor dvakrát s různým `alias` a `paramOffset` a výsledek skládá jako `id IN (<include>) AND id NOT IN (<exclude>)`. Vlastní SQL nad `contacts` tím nevzniká, obě strany jsou generované kompilátorem včetně jeho čtyřčlenné obálky.

**D5. Rozpad publika po branách dodává část 2, P13 ho jen zobrazuje a ukládá.** Obálka kompilátoru odečítá suppression, `deleted_at`, `processing_restricted`, nepotvrzené členství i pozastavení uvnitř sebe, takže z jeho výstupu **nejde zjistit, kolik lidí kterou branou vypadlo**. Bez toho nejde splnit ani akceptační kritérium 9 části 4a (`skipped_suppressed` se zvýší), ani pravidlo z části 6, 8.6.2 („řádek Vyloučeno je pojmenovaný, ne souhrnný"). Rozdělovat gates by znamenalo psát druhou kopii bran v P13, což část 2 výslovně zakazuje a co by se za půl roku rozešlo. P13 proto deklaruje požadavek R-P07.1 na funkci `countAudienceGates` a konzumuje ji přes port, aby šel plán testovat i bez ní.

**D6. Prahy doručitelnosti se validují proti instalační hodnotě jako proti stropu, i u podlahy `guard_min_sent`.** Část 4a v 3.15.2.1 rozhodla, že hodnota z prostředí je zároveň výchozí hodnota i strop a projekt smí jen přitvrdit. U sazeb znamená „přísnější" nižší číslo, u podlahy `DELIVERABILITY_GUARD_MIN_SENT` také nižší číslo, protože nižší podlaha znamená, že brzda zabere dřív. Validace je jedno zod schéma s `superRefine` a pokus zapsat volnější hodnotu vrací `422 validation_failed` s `path` na konkrétní klíč, nikdy tiché oříznutí.

**D7. Práh žlutého varování u míry odrazů je 4 %, ne 5 %, a platí pro něj stejná podlaha jako pro automatickou pauzu.** Rozhodnuto v části 4a, 3.15.2 a O1. Hodnota je v `DELIVERABILITY_BOUNCE_WARN_RATE` (0.04) a vyhodnocuje se až po `DELIVERABILITY_GUARD_MIN_SENT` předaných zprávách, jinak by kampaň na 25 lidí s jediným odrazem spustila varování, které o doručitelnosti nevypovídá nic.

**D8. Tvrdé zastavení rozesílky v MVP 0 neexistuje.** Pozastavení i zrušení působí jen na zprávy ve stavu `pending`. Zprávy ve stavu `claimed` doběhnou, je to normativní pravidlo kontraktu (část 1, 4.10.1) a plán ho nijak neobchází. Prakticky jde nejvýš o `SENDER_BATCH_SIZE` zpráv na běžící sender, tedy o 100 při výchozí konfiguraci, což jsou jednotky sekund. UI to musí říct doslova a nikdy nesmí tvrdit, že se nic neodešle; jediný stav, kde je to zaručeno, je okno na zrušení podle 3.6.4.

**D9. Zpětná vazba u SMTP je v MVP 0 jen to, co vrátí SMTP dialog.** Kód 5xx při `RCPT TO` je tvrdý odraz, 4xx měkký. Klasifikaci provádí sender a P13 ji přebírá jako událost se `source = 'smtp'`. Asynchronní odrazy do schránky se v tomhle plánu neimplementují a ani nepřipravují, patří do samostatné funkce „bounce mailbox" v MVP 1. V UI u SMTP provideru trvale svítí upozornění, že se seznam blokovaných adres nedoplňuje sám.

**D10. Nekampáňové zprávy se v MVP 0 neodesílají a plán pro ně nic nestaví.** Kontraktní `messages.campaign_id` je nullable jako rezerva, claim dotaz je vylučuje výslovnou podmínkou. P13 žádnou cestu, která by takový řádek vyrobila, nemá a má na to test: každý `INSERT` do `messages` v tomhle plánu má `campaign_id` neprázdné.

**D11. Velikost dávky senderu je 100 a zůstává nastavitelná uživatelem instalace.** Je to `SENDER_BATCH_SIZE` z části 1, čte ji sender, ne aplikace. P13 z ní počítá jedinou věc: odhad, kolik zpráv ještě odejde po zmáčknutí pauzy, a ten se ukazuje v potvrzovacím dialogu. Materializační dávka je jiné číslo (`CAMPAIGN_MATERIALIZE_BATCH_SIZE`, výchozí 5000) a plete se s ní snadno, proto mají v kódu odlišené názvy konstant.

**D12. Okno na zrušení je 60 sekund, konfigurovatelné dolů, nikdy nahoru.** Potvrzeno zadavatelem. `CAMPAIGN_UNDO_WINDOW_SECONDS` je výchozí hodnota i strop, projekt smí okno zkrátit nebo vypnout (0), ne prodloužit. Směr stropu je opačný než u brzd schválně: u brzd je nebezpečná volba volnější práh, tady delší okno, protože uživatel zmáčkne Odeslat a čeká, že se odesílá.

**D13. Sub-app se do Hona připojují přes generovaný registr, který se nikdy neslučuje ručně.** Kořen veřejného API (`apps/web/src/app/api/v1/[[...route]]/route.ts`) vlastní P04 a osm doménových plánů do něj nesmí dopisovat po řádku. P13 proto zakládá své sub-appy jako `apps/web/src/server/routes/<jmeno>/index.ts` s výchozím exportem `OpenAPIHono` a spoléhá na registr generovaný globem, stejně jako P01 řeší handlery front (jeho rozhodnutí D4). Platí u něj totéž pravidlo jako u `openapi.json` (uzávěr S9): při konfliktu se zahodí obě verze a přegeneruje se. Kdyby P04 zvolil ruční mount, je doplnění jednoho řádku změna vlastněná P04, ne P13; požadavek je zapsaný jako R-P04.1 a úkol 1 na něj má test.

**D14. Testy P13 běží ve třech úrovních a každá má jinou bránu.** Čistá logika (stavový stroj, klasifikace odrazů, parsování SPF a DMARC, tvar `render_data`) je `*.test.ts` v `test:unit` bez databáze. Dotazy jdou do `*.db.test.ts` v `test:db` proti testcontainers Postgresu 18. Obrazovky mají Playwright scénáře v `test:e2e`. Dotaz, který je ve specifikaci normativní, musí mít test v `test:db`, i kdyby ověřoval jen to, že projde plánovačem; je to místní obdoba scénáře `OB-00` a důvod je stejný: kontrola čtením neodhalí nespustitelné SQL.

**D15. Zkušební režim z části 6, 8.2.8 se ukládá do `workspaces.settings.campaigns`, nezakládá tabulku.** Je to nejvýš deset ověřených adres a jeden přepínač na projekt, tedy data, která se vejdou do existujícího jsonb sloupce a nikdy se nad nimi nefiltruje. Nová tabulka by znamenala migraci u P03 kvůli deseti řádkům. Ověřovací token adresy se ukládá jako otisk, ne v plaintextu, a má platnost 24 hodin.

**D17. `campaign_links.id` a pozice odkazů přebírá P13 z `CompileMeta` beze změny. Přijímám nález plánu P08 v plném rozsahu.** Část 4a má u `campaign_links.id` výchozí `uuidv7()` a pozice číslované od nuly, kontrakt kompilace má UUIDv5 odvozené z `CompileMeta.links` a pozice od jedné. Kdyby to zůstalo rozdvojené, kompilace by vyrobila jiná ID, než jaká má kampaň v databázi, proklik by se spároval s neexistujícím odkazem a **report kliků by byl tiše prázdný**. Nic by nespadlo, žádný test by nezčervenal, a proklik je přitom podle rozhodnutí zadavatele hlavní metrika produktu. Rozhodnutí má tři části a všechny jsou nutné:

1. **Zdrojem pravdy je `CompileMeta`, ne P13.** Materializace `campaign_links` zapisuje `id` i `position` **doslova tak, jak je vrátil kompilátor**, a sama žádné ID nepočítá. Kdybych UUIDv5 dopočítával podruhé na své straně, existoval by tentýž algoritmus na dvou místech, což je přesně ta konstrukce, která se za půl roku rozejde. Jediná kopie je v P08.
2. **`DEFAULT uuidv7()` na sloupci se ruší** (požadavek R-P03.6). Dokud tam je, `INSERT` bez `id` projde a vyrobí špatné ID tiše. Bez defaultu selže v migraci a v testu, tedy nahlas.
3. **Rozpor se hlásí, netoleruje.** Před odesláním se porovná `campaigns.compile_meta` s čerstvým výstupem kompilace; při neshodě vrací API `409 contract_mismatch` (požadavek R-P01.5) a kampaň se neodešle. Prázdný report kliků není stav, se kterým se dá žít, protože se pozná až týdny po odeslání.

Pozice od jedné je tím pádem závazná i pro moje SQL a pro UI. Číslování od nuly z části 4a je tímhle rozhodnutím opravené.

**D18. `campaigns.compile_meta` zavádím jako sloupec, ne jako dopočet.** Nález plánu P09: sender má podle kritéria AK-6.21 porovnat počet nalezených značek odkazů proti `clickMarkerCount`, ale nemá tu hodnotu odkud vzít. Dnešní obcházení (degradace s logem `compile_meta_column_missing`) je nepřijatelné jako cílový stav ze dvou důvodů. Za prvé je to ochrana, jejíž jediné vynucení je log, který nikdo nečte, což je přesně ten vzorec, před kterým varuje pravidlo o mechanismu z části 1. Za druhé degradace mlčky vypne kontrolu, která má odhalit rozpad odkazů, tedy tutéž třídu chyby jako D17. Sloupec je `jsonb`, plní ho P13 při kompilaci, sender ho čte (`SELECT` na `campaigns` už má) a je součástí neměnných hodnot po přechodu do `sending`.

**D16. Nejasně odeslané zprávy jsou v UI samostatná kategorie, ne selhání.** U SES je výchozí politika `fail`, takže `error_code = 'ambiguous_dispatch'` je běžný důsledek pádu, ne anomálie. Report a dashboard je proto ukazují odděleně pod názvem „nejisté odeslání" a jde z nich udělat publikum pro doposlání. Bez toho by rozhodnutí `fail` znamenalo tiše zahozené zprávy.

**D19. Datová vrstva jde přes `@mlain/core/tx` a normativní SQL nese `rawSql`, ne `tx.query`.** Původní podoba plánu importovala `withTx` z `@mlain/db/tx` a volala `tx.query(text, params)`. Nic z toho neexistuje a všechny tři vady jsou ověřené spuštěním, ne přečtením:

1. **`withTx` není nikde.** P03 vystavuje `withWorkspace(pool, ctx, fn)`, `withUser`, `withReadOnly`, všechny s poolem jako prvním parametrem. Adaptér P04 z nich dělá dvouargumentové `withWorkspace(ctx, fn)` a tříargumentové `withReadOnly(ctx, statementTimeoutMs, fn)` nad vlastním singletonem poolu. **P13 chce přesně tuhle dvouargumentovou podobu**, takže oprava je jen v tom, odkud se importuje a jak se jmenuje: `@mlain/core/tx`, ne `@mlain/db/tx`.
2. **`@mlain/db` nemá podcestu k repository.** Mapa `exports` má šest klíčů a žádný zástupný znak, takže `@mlain/db/repo/campaigns/outbox` skončí `ERR_PACKAGE_PATH_NOT_EXPORTED`. Viz rozhodnutí D2.
3. **`Tx` je Drizzle handle a `tx.query` na něm není funkce.** `typeof tx.query` je `object`, protože je to relační dotazovací API Drizzle. Volání padá za běhu, typová kontrola ho nechytí, protože ten objekt existuje. Původní plán ho volal na 97 místech.

Z toho plyne trojí pravidlo pro celou datovou vrstvu P13, které se nesmí obejít:

- transakce se otevírá `withWorkspace(ctx, fn)` z `@mlain/core/tx`, čtení dynamicky složeného SQL `withReadOnly(ctx, timeoutMs, fn)`,
- dotaz se posílá `await tx.execute<Row>(rawSql(text, params))` a **výsledek je obálka, ne pole**: řádky jsou na `r.rows`. Přetypování výsledku na `Row[]` projde typovou kontrolou a `[0]` z něj vrátí `undefined`, aniž by cokoli spadlo,
- SQLSTATE se čte **výhradně** přes `pgErrorCode(err)` z `@mlain/core/tx`. Drizzle balí chybu ovladače, takže `err.code` je `undefined` a skutečný kód leží na `err.cause.code`. Kdo testuje `err.code === '23505'`, testuje `undefined` a jeho ošetření kolize se **nikdy neprovede**.

**D20. Materializace VOLÁ `prepareRenderData` a skládá `render_data` v Node, ne v SQL.** Původní podoba plánu skládala `render_data` výrazem `jsonb_build_object` přímo v materializačním dotazu. Bylo to rychlejší a bylo to špatně.

Kontraktní funkce `prepareRenderData(raw, schema)` z `@mlain/contracts/liquid/prepare-render-data` plní kořen **`_present`**, ze kterého se vyhodnocuje **každý podmíněný blok** v šabloně. Kompilace P08 emituje `{% if _present.contact__attr__city %}`, tedy podmínku nad klíčem, který vzniká výhradně tam. SQL ho nenaplnilo.

Důsledek je ověřený spuštěním nad `liquidjs`: bez toho volání se každá podmínka vyhodnotí jako nepravda a **podmíněný blok se v odeslaném mailu tiše skryje**. Nespadne přitom nic. Kompilace projde, materializace projde, odeslání projde, testy obou stran projdou, a uživateli přijde mail, ve kterém chybí celá sekce. Kontrakt tu funkci jen definuje; **volá ji až aplikace při materializaci publika, tedy P13.** Je to požadavek **R11** plánu P08 a P08 na něj má golden fixture přes celý řetěz (`16-presence-chain.json`).

Volání je tedy povinné a plán ho chrání dvěma nezávislými testy: databázovým v úkolu 13, který se ptá uloženého `render_data`, a řetězovým v úkolu 47, který projde kompilací, materializací a interpolací až k hotovému HTML. Druhý z nich se schválně **neptá konstant P13**: jméno kořene bere z `COMPILED_ONLY_ROOTS` v kontraktech a mapu plní kontraktní funkcí, tedy toutéž, jakou má náhled i sender.

Cena je jeden roundtrip navíc na dávku (ne na řádek) a možnost skládat data typově. Vedlejším efektem se opravily tři věci, které SQL varianta tiše nedělala vůbec: strop 8 kB na `render_data`, převod čísel nad 2^53 na řetězec kvůli Go `float64` a ořez polí na strop iterací.

**D21. Prefix `[TEST]` v předmětu se nikam neukládá a UI to musí říct nahlas.** `messages` nemá sloupec pro předmět a mít ho nebude: obsah se bere z kampaně, což je celý smysl toho, že testovací mail jde stejnou cestou jako ostrý. Původní podoba plánu prefix spočítala, vrátila ho v odpovědi API a do databáze nezapsala, takže uživateli přišel mail nerozeznatelný od ostrého, aniž by to kdokoli tvrdil nahlas.

Zvažovaná alternativa byla zakládat pro testovací odeslání řádek v `campaign_content_variants` s upraveným předmětem a odkázat ho z `messages.content_variant_id`. Zamítnuto: testovací mail by pak procházel **jinou cestou** než ostrý a přestal by testovat to, kvůli čemu existuje. Prefix tedy končí a UI u testovacího odeslání píše doslova, že mail dorazí přesně v té podobě, v jaké ho dostanou příjemci.

**D22. Neměnnost kampaně za odesílání vynucuje aplikace, ne databázový trigger.** Požadavek R-P03.3 původně žádal `trg_campaigns__immutable_while_sending`. P03 nemá v celém plánu **jediný** `CREATE TRIGGER` a jeho konvence výslovně říká, že `updated_at` mění aplikace. Požadavek navíc byl schovaný v odkazu na cizí dokument („podle části 4a, 2.1 až 2.9"), takže z něj čtenář P03 neměl šanci vyčíst, že má napsat trigger jdoucí proti jeho vlastní konvenci.

Ochrana zůstává tam, kde už je, a je trojitá: seznam `IMMUTABLE_WHILE_SENDING` v aplikaci, chyba `campaign_locked` na API a inkrementace `revision`, kterou sender pozná změnu. Seznam se doplňuje o `compile_meta` a `compiled_hash`, protože rozhodnutí D18 je řadí mezi neměnné hodnoty, a předchozí podoba je v něm neměla.

---

## 3. Hranice mezi P13 a senderem (P09)

Tohle je jediné místo, kde se dva plány potkávají za běhu, a proto je vypsané zvlášť.

| Věc | P13 (aplikace) | P09 (sender, Go) |
|---|---|---|
| Vznik řádku v `messages` | **ano**, materializace a testovací odeslání | ne, nemá `INSERT` |
| Přechod `(vznik) → pending` | **ano** | ne |
| Přechod `(vznik) → skipped` | **ano**, jen při `render_data_too_large` | ne |
| Přechod `pending → skipped` | **ano**, odhlášení, suppression, zrušení kampaně | ne |
| Přechod `pending → claimed → sent | failed` | ne | **ano** |
| Přechod `claimed → skipped` | ne | **ano**, kontrola suppression těsně před odesláním |
| Přechod `failed → sent` | **ano**, výhradně při `error_code = 'ambiguous_dispatch'` | ne |
| Zápis `created_at` | **ano**, explicitně hodnotou `audience_built_at` | **nikdy** |
| Uvolňování vypršelých claimů | ne, jen dohled bez zásahu (`outbox.stall_watch`) | **ano**, reaper |
| Čítače v `campaigns` | **ano** | ne |
| `campaigns.status` a `pause_reason` | **ano**, všechny přechody | jen `queueing|sending → paused` se čtyřmi vlastními kódy |
| Mazání řádků | **ano**, odpojením partition | ne, nemá `DELETE` |
| Čtení kvóty z `GetAccount` | **ano**, job každých 15 minut | ne, čte sloupec `quota_max_send_rate` |
| Sestavení MIME a hlaviček | ne, jen politika a hodnoty | **ano** |

Praktický důsledek pro implementátora P13: **každý `UPDATE` nad `messages` musí nést obě složky klíče** (`id` a `created_at`), nebo musí filtrovat přes `campaign_id` a `created_at = audience_built_at`. Dotaz `WHERE id = $1` vypadá správně a projde všechny partition. Test v `test:db` to hlídá přes `EXPLAIN`.

---

## 4. Požadavky na ostatní plány

Plán je bez nich neúplný. Každý je malý, konkrétní a patří jinému vlastníkovi.

### 4.1 Na P01 (registry)

| # | Požadavek | Proč |
|---|---|---|
| R-P01.1 | Doplnit do zod schématu konfigurace šest proměnných, které část 1 v 4.9 zatím nemá: `CAMPAIGN_QUOTA_PAUSE_REMAINING` (int, 100, K, 0 až 1000000), `CAMPAIGN_QUOTA_RESUME_REMAINING` (int, 1000, K, 0 až 1000000, musí být větší než předchozí), `CAMPAIGN_TEST_SEND_PER_HOUR` (int, 20, W, 1 až 1000), `DELIVERABILITY_BOUNCE_WARN_RATE` (float, 0.04, K, 0 až 1), `DELIVERABILITY_COMPLAINT_WARN_RATE` (float, 0.001, K, 0 až 1), `DELIVERABILITY_CONTENT_BOUNCE_LIMIT` (int, 100, K, 1 až 1000000). Je to požadavek R1.13 části 4a, který zatím nedoputoval do tabulky. | Bez nich se prahy varování a hystereze kvóty musí zadrátovat do kódu, což 4.6 části 4a zakazuje. Křížová validace `RESUME > PAUSE` patří do `cross-checks.ts`, jinak kampaň cykluje mezi `paused` a `sending` každých deset minut. |
| R-P01.2 | Mít v registru front všech dvanáct front z části 4a, 4.5: `campaign.materialize`, `campaign.scheduler`, `campaign.watchdog`, `campaign.resume_on_quota`, `outbox.stall_watch`, `outbox.reconcile`, `provider_event.process`, `provider_event.rematch`, `provider.refresh_quota`, `domain.recheck`, `deliverability.rollup`, `retention.drop_message_partitions`. | Uzávěr S8. P13 fronty nezakládá, jen k nim dodává handlery. Úkol 1 to ověřuje testem, ne čtením. |
| R-P01.3 | `packages/core/package.json` musí mít podcestný export, kterým se dá importovat `@mlain/core/campaigns` a `@mlain/core/providers`. | Barrely se nezakládají (S11), takže bez podcestného exportu není balíček importovatelný. |
| R-P01.4 | Doplnit sedm chybových kódů `provider_smtp_*` (`host_unknown`, `connection_refused`, `tls_invalid`, `auth_failed`, `timeout`, `starttls_unsupported`, `greeting_invalid`), všechny 422 a opakovatelné. Část 1 je v katalogu avizuje větou „doplní část 4a", ale registr vlastní P01. | Hodnota mimo registr je chyba v CI, takže bez registrace test připojení neprojde buildem. |
| R-P01.5 | Doplnit kód **`contract_mismatch`** (409, `Contract mismatch`, neopakovatelný) a čtyři kódy kontrolního seznamu: `campaign_audience_only_sample` (422, blokující), `campaign_audience_has_sample` (varování), `deliverability_complaint_blocking` (422, blokující), `deliverability_bounce_warning` a `deliverability_degraded` (varování). Nález plánu P08 a vlastní nález preflightu. | `contract_mismatch` vrací P13, když se `CompileMeta` z kompilace rozejde s tím, co je uložené u kampaně, tedy když by se odkazy spárovaly na neexistující ID. Zbylých pět používá preflight a kontrolní seznam publika, ale v `REQUIRED_ERROR_CODES` úkolu 1 chyběly. Hodnota mimo registr je chyba v CI, takže bez registrace fáze J neprojde buildem. |
| R-P01.6 | **Nový.** Worker musí umět dodat **migrátorské spojení mimo transakci** doménovému jobu, ne jen svému vlastnímu `platform.maintain_partitions`. | Retenční job P13 volá `dropPartitionsBefore` z `@mlain/db/partitions`, které používá `DETACH PARTITION ... CONCURRENTLY`. Ten příkaz nesmí běžet v transakčním bloku a DDL vyžaduje vlastníka relace, tedy `mlain_migrator`. `@mlain/db` vystavuje jen aplikační a read-only pool, takže P13 nemá jak se k němu dostat sám. Předchozí podoba plánu to obcházela vlastním `DROP TABLE` pod `mlain_app`, což by skončilo chybou 42501 a retence by nefungovala vůbec. |
| R-P01.7 | **Nový.** `packages/core/package.json` potřebuje skript **`test:db`** a odpovídající projekt ve Vitest konfiguraci. | Po rozhodnutí D2 leží celá datová vrstva domény kampaní v `packages/core/src/campaigns/repo/**`, takže tam leží i databázové testy. `packages/core` dnes má jen `test:unit`, takže by se nespustil ani jeden z nich. Není to jen potíž P13: P07 přesunul svoji datovou vrstvu do `packages/core/src/contacts/repo/**` ze stejného důvodu a naráží na totéž. |
| R-P01.8 | **Nový.** Podcestný export `"./demo"` v `packages/core/package.json`, aby šlo importovat `@mlain/core/demo`. | Ochrana „ukázkové kontakty nejdou do publika kampaně" je podle rozhodnutí A1 plánu P16 vynucovaná v P13, ale konvenci vlastní P16 (`DEMO_SOURCE_REF`, `parseDemoManifest` v `packages/core/src/demo/manifest.ts`). P13 ji **nesmí opisovat k sobě**, jinak vzniknou dvě kopie téhož řetězce, které se za půl roku rozejdou. Je to táž třída požadavku jako R-P01.3 pro `./campaigns`. |

### 4.2 Na P03 (schéma)

| # | Požadavek | DDL |
|---|---|---|
| R-P03.1 | **Splněno.** Sloupec pro uložený rozpad publika, aby kontrolní seznam, potvrzovací dialog i report ukazovaly totéž číslo z jednoho zdroje (část 6, 8.6.2). P03 ho má jako `campaigns.audience_breakdown jsonb`. Zapisovatele mu dodává až tenhle plán: `setGateCounters` do něj ukládá celý jedenáctiklíčový rozpad. Dokud ho nikdo nezapisoval, byl to mrtvý sloupec. | `ALTER TABLE campaigns ADD COLUMN audience_breakdown jsonb;` |
| R-P03.2 | Tři sloupce pro delegační odkaz na DNS záznamy (část 6, 8.2.5). | `ALTER TABLE sender_domains ADD COLUMN delegation_token_hash text, ADD COLUMN delegation_expires_at timestamptz, ADD COLUMN delegation_created_by uuid REFERENCES users(id) ON DELETE SET NULL;` plus `CREATE UNIQUE INDEX uq_sender_domains__delegation ON sender_domains (delegation_token_hash) WHERE delegation_token_hash IS NOT NULL;` |
| R-P03.3 | **Splněno, a dva kusy původního znění se ruší.** Všechny tabulky z části 4a, kapitoly 2, včetně obou vlastních indexů na `messages` (`idx_messages__provider_message_id`, `idx_messages__ws_email_pending`) P03 má. **Trigger `trg_campaigns__immutable_while_sending` se nežádá**: P03 nemá v celém plánu jediný `CREATE TRIGGER` a jeho konvence říká, že `updated_at` mění aplikace. Vynucení neměnnosti zůstává v aplikaci (`campaign_locked` plus inkrementace `revision`), viz rozhodnutí D22. **Unikátní index `uq_message_events__once_per_message` se taky nežádá**: P03 ho rozhodnutím R22 vědomě nechal neunikátní, protože v partitionované tabulce by musel obsahovat `received_at` s `DEFAULT now()` a nesepnul by nikdy. Deduplikace je proto v aplikaci explicitním `WHERE NOT EXISTS`, viz `insertEventOnce`. | podle části 4a, 2.1 až 2.9 a 3.9.1 |
| R-P03.4 | Kontraktní sloupce `messages` přesně podle části 1, 4.10.1, včetně `kind`, `content_variant_id`, `ambiguous_count` a `dispatch_started_at`. | podle kontraktu |
| R-P03.5 | **Otevřené a blokující fázi J.** Sloupec pro kompilační metadata. Nález plánu P09: sender má podle kritéria AK-6.21 porovnat počet nalezených značek odkazů proti `clickMarkerCount`, ale tu hodnotu nemá odkud vzít, protože ji žádný sloupec `campaigns` nenese. P09 to dnes obchází degradací s logem `compile_meta_column_missing`, což je obcházení, ne řešení. **Ověřeno v P03 při psaní tohohle řádku: `campaigns.compile_meta` tam není.** Jediný `compileMeta` v celém P03 je `template_versions.compile_meta`, což je jiná tabulka a jiný obsah. Bez toho sloupce nemá kam ukládat `saveCompilation` a materializace nemá odkud vzít `renderSchema` pro `prepareRenderData`, takže by se v mailech tiše skryly podmíněné bloky. Sloupec je zároveň v kontraktní podmnožině cizích tabulek pro sender, takže P03 mu k němu musí dát `SELECT` (ten už má na celé `campaigns`). | `ALTER TABLE campaigns ADD COLUMN compile_meta jsonb;` |
| R-P03.6 | **Splněno.** `campaign_links.id` **nesmí mít `DEFAULT uuidv7()` jako jediný zdroj hodnoty**. Sloupec zůstává `uuid PRIMARY KEY`, ale `DEFAULT` se maže, aby se `INSERT` bez explicitního `id` nedal provést a chyba se projevila v migraci, ne až tichým prázdným reportem. P03 to udělal rozhodnutím R40 a má na to test, který ověřuje `column_default IS NULL` i to, že `INSERT` bez `id` spadne. Zdůvodnění je v rozhodnutí D17. | `ALTER TABLE campaign_links ALTER COLUMN id DROP DEFAULT;` |
| R-P03.7 | **Nový, blokuje testovací odeslání.** Cizí klíč `fk_messages__campaign_audience` na `(campaign_id, created_at)` musí platit **jen pro kampaňové zprávy**, ne pro testovací. Ověřeno spuštěním proti Postgresu 18: kampaň v draftu má `audience_built_at = NULL`, takže testovací odeslání s vyplněným `campaign_id` skončí chybou **23503** `is not present in table "campaigns"`, a testovací mail z rozepsané kampaně tedy nejde odeslat vůbec. Přitom právě z draftu si ho uživatel posílá nejčastěji. Řešení je generovaný sloupec, který je pro test `NULL`, takže se u něj kontrola podle MATCH SIMPLE přeskočí. Invariant I1 zůstává nedotčený: pro `kind = 'campaign'` se chová identicky, ověřeno všemi čtyřmi scénáři. | `ALTER TABLE messages ADD COLUMN audience_campaign_id uuid GENERATED ALWAYS AS (CASE WHEN kind = 'campaign' THEN campaign_id END) STORED;` a `ALTER TABLE messages DROP CONSTRAINT fk_messages__campaign_audience, ADD CONSTRAINT fk_messages__campaign_audience FOREIGN KEY (audience_campaign_id, created_at) REFERENCES campaigns (id, audience_built_at);` |
| R-P03.8 | **Nový.** Sloupec pro stav žádosti o produkční přístup u SES. Hodnota `GetAccount → Details.ReviewDetails.Status` dnes projde třemi vrstvami P13 (čtení kvót, signatura `updateAccountSnapshot`) a v samotném `UPDATE` tiše zmizí, protože sloupec neexistuje. Preflight podle ní má uživateli rozlišit „žádost běží" (`PENDING`) od „žádost zamítnuta" (`DENIED`), což je u zablokovaného odesílání zásadní rozdíl. Bez `CHECK`, ze stejného důvodu jako u `enforcement_status`: uzavřený výčet by se rozbil při první nové hodnotě od AWS. | `ALTER TABLE sending_providers ADD COLUMN review_status text;` |

### 4.3 Na P07 a P11 (kontakty a segmenty)

| # | Požadavek |
|---|---|
| R-P07.1 | **`countAudienceGates(ctx, audience, opts): Promise<AudienceGateCounts>`** v `packages/core/src/contacts/repo/segments.ts`. Vrací `{ raw, eligible, excluded_suppressed, excluded_unsubscribed, excluded_unconfirmed, excluded_snoozed, excluded_processing_restricted, excluded_invalid_email, excluded_deleted, excluded_sample, duplicates_removed }`, počítané jedním dotazem s agregacemi `FILTER`. `opts` je `{ asOf: Date; timeoutMs?: number }`. Pořadí a pojmenování bran určuje část 2 (její 4.1.6), proto to nemůže počítat P13. Bez toho nejde splnit kritérium 9 části 4a ani pravidlo o pojmenovaném rozpadu z části 6, 8.6.2. |
| R-P07.2 | `compileAudienceToSql` musí přijmout prázdný `exclude` bez chyby, protože P13 ho volá i tehdy, když uživatel nic nevylučuje. Dnešní kontrakt vrací `422 audience_empty` u prázdného vstupu, což je správné pro `include` a nesprávné pro `exclude`; P13 to obchází tím, že při prázdném `exclude` kompilátor vůbec nevolá, ale je lepší to mít potvrzené než obejité. |
| R-P07.3 | `suppressions.add` a `revokePendingMessages` podle části 4a, 3.4.1 a 3.10.4. `revokePendingMessages` **implementuje P13** (je to jeho funkce), P07 ji jen volá; požadavek je na to, aby ji volal místo vlastního `UPDATE` nad `messages`. |
| R-P07.4 | `CONTACT_MERGE_FIELDS` jako exportovaná konstanta s mapováním merge tag na sloupec, včetně příznaku, že zdrojem `contact.email` je outbox, ne `render_data`. |
| R-P07.5 | **Zrušeno, sloupec nebude a P13 ho nepotřebuje.** Původně jsem žádal příznak `contacts.is_sample`. Rozhodnutí A1 plánu P16 to zavírá jinak a lépe: nový sloupec znamená migraci, kterou vlastní P03, a ukázkovost se dá vyjádřit třemi existujícími mechanismy. P13 se na dva z nich napojuje a **žádnou konvenci si nepíše znovu**: `DEMO_SOURCE_REF` i `parseDemoManifest` importuje z `@mlain/core/demo`, tedy od P16. Manifest je autoritativní pro rozsah sady (uživatel může kontakt upravit a značku smazat, manifest to přežije), značka je záchytná síť pro kontakty mimo manifest. Ověřeno spuštěním, že obojí je potřeba: na 200 000 kontaktech s 50 ukázkovými, kde deset mělo přepsaný `source_ref`, propustil filtr jen podle značky deset kontaktů do publika. |
| R-P07.6 | `countAudienceGates` z R-P07.1 musí vracet i `excluded_sample`, aby řádek „Vyloučeno" v kontrolním seznamu zůstal pojmenovaný a součet bran dál seděl na vstupní počet. Část 6 v 8.6.2 ukázkové kontakty mezi odečítanými branami výslovně jmenuje. |

### 4.4 Na P02, P04, P05 a P08

| # | Požadavek |
|---|---|
| R-P02.1 | Export šifrovací obálky kontraktu 4: `encryptCredential(value: unknown, opts: { context: CredentialContext; workspaceId: string }): string` a `decryptCredential(stored: string, opts): unknown`, plus konstanta kontextu `sending_provider`. P13 je konzumuje jediným adaptérem, aby případná odchylka v názvu byla oprava na jednom místě. |
| R-P02.2 | Fixtures z části 4a, 8.16: sedm souborů v `packages/contracts/fixtures/sns/`, tři v `packages/contracts/fixtures/ses/` a `bounce-classification.csv`. P13 z nich čte v testech. |
| R-P04.1 | Registr sub-appů veřejného API, do kterého se P13 zapíše souborem, ne editací sdíleného kořene. Viz rozhodnutí D13. |
| R-P05.1 | Komponenty K1 (tabulka s filtry), K3 (průvodce s kroky), K5 (potvrzovací dialog nevratné akce), K6 (náhled e-mailu), K7 (grafy) a K8 (časová osa) plus primitiva `Button`, `Input`, `Select`, `Badge`, `Alert`, `Progress`, `Tabs`, `CopyButton`, `Skeleton`. P13 si žádnou komponentu do `packages/ui` nedopisuje. |
| R-P08.1 | **Splněno, žádná změna se od P08 nežádá.** Původní znění tohohle řádku popisovalo `compileTemplate(design, ctx): { html, text, usedFields, links }`, což je signatura, která u P08 nikdy neexistovala. Skutečný kontrakt je `compileTemplate(input: CompileTemplateInput): Promise<CompileResult>` z `@mlain/core/templates`, kde `CompileResult` je rozlišený svazek `{ ok: true; html; text; meta: CompileMeta } | { ok: false; issues: Issue[] }`. `CompileMeta` nese `usedPaths` (ne `usedFields`), `renderSchema`, `links` (každý s `id`, `position` od jedné, `url`, `trackable`, `label`), `clickMarkerCount`, `hasUnsubscribeLink` a `rendererVersion`. Determinismus i kanonická tečková notace platí. Port P13 tenhle tvar přebírá doslova, viz `TemplatePort` v úkolu 8. |
| R-P08.2 | **Splněno.** `prepareRenderData(raw, schema)` z `@mlain/contracts/liquid/prepare-render-data` a `toPreparedSchema(renderSchema)` z `@mlain/emails/paths`. P13 je **povinen zavolat** obojí při materializaci publika, viz požadavek R11 plánu P08 a rozhodnutí D20. |

---

## 5. Závislosti a jejich licence

Projekt je **MIT**. GPL, LGPL, AGPL, SSPL, BUSL a Elastic-2.0 jsou zakázané a hlídá to CI job `licenses-node`. Whitelist: `MIT`, `Apache-2.0`, `BSD-2-Clause`, `BSD-3-Clause`, `ISC`, `0BSD`, `CC0-1.0`, `Unlicense`, `Python-2.0`.

### 5.1 Nové runtime závislosti, které zavádí tenhle plán

| Balíček | Verze | Licence | Kde |
|---|---|---|---|
| `@aws-sdk/client-sesv2` | 3.1100.0 | Apache-2.0 | `packages/core/providers/ses` |
| `@aws-sdk/client-sns` | 3.1100.0 | Apache-2.0 | `packages/core/providers/ses` |
| `sns-validator` | 0.3.5 | Apache-2.0 | ověření podpisu SNS |
| `psl` | 1.15.0 | MIT | organizational domain pro DMARC |
| `luxon` | 3.7.2 | MIT | IANA zóny při plánování |
| `p-limit` | 7.3.1 | MIT | souběžnost DNS kontrol |

### 5.2 Závislosti, které plán používá a zavedl je někdo jiný

| Balíček | Verze | Licence | Zavedl |
|---|---|---|---|
| `zod` | 4.4.3 | MIT | P01 |
| `pg` | 8.22.0 | MIT | P01 |
| `pg-boss` | 12.26.3 | MIT | P01 |
| `hono` | 4.12.33 | MIT | P04 |
| `@hono/zod-openapi` | 1.5.1 | MIT | P04 |
| `drizzle-orm` | podle P03 | MIT | P03 |
| `next-intl` | 4.13.4 | MIT | P05 |
| `vitest` | 4.1.10 | MIT | P01 |
| `testcontainers` | 12.0.4 | MIT | P01 a P03 |
| `playwright` | 1.62.1 | Apache-2.0 | P01 |

### 5.3 Vědomě nepoužité

| Balíček | Důvod |
|---|---|
| `nodemailer` (MIT-0) | umí `transport.verify()`, ale přidá zhruba 600 kB závislostí kvůli jednomu tlačítku v nastavení. Test SMTP připojení je zhruba 80 řádků nad `node:net` a `node:tls` a je to jediné místo, kde aplikace mluví SMTP protokolem. Skutečné odesílání dělá sender v Go. |
| `mailauth` (MIT) | umí SPF, DKIM i DMARC kompletně, ale je určený k ověřování **přijatých zpráv**, ne ke kontrole DNS konfigurace. Použili bychom zlomek. Stojí za zvážení, až přijde bounce mailbox. |
| `spf-parse`, `dmarc-parser` | neudržované, nebo tak malé, že se nevyplatí. Parsování je pár desítek řádků. |
| `cron-parser` | plánování kampaní je jednorázové na konkrétní čas, cron pro joby řeší pg-boss. |
| vlastní implementace ověření podpisu SNS | kanonizace „string to sign" je přesně to místo, kde se dělá chyba, kterou nikdo nenajde, dokud nepřijde útok. `sns-validator` je od AWS Labs, Apache-2.0, a kdyby přestal být udržovaný, jde forknout. |

---

## 6. Mapa souborů, které plán vytvoří

```
packages/core/src/campaigns/
├── index.ts                         barrel domény, bez něj se @mlain/core/campaigns nerozřeší
├── constants.ts                     meze plánu, velikosti dávek, prahy
├── types.ts                         Campaign, CampaignAudience, CampaignCounters, otevřené výčty
├── state-machine.ts                 tabulka přechodů, assertTransition
├── pause-reason.ts                  závazný tvar jsonb, registr devíti kódů
├── settings.ts                      zod pro settings.campaigns a settings.deliverability
├── ports.ts                         AudiencePort, TemplatePort, SuppressionPort, ClockPort
├── compile.ts                       StoredCompileMeta, normalizace výstupu P08, hash
├── compile-service.ts               JEDINÁ cesta, kterou kompilace probíhá a ukládá se
├── audience/
│   ├── build-sql.ts                 skládání include a exclude z kompilátoru části 2
│   ├── preview.ts                   náhled počtu s 5s stropem a odhadem
│   ├── sample-guard.ts              značka ukázkových kontaktů a stav publika pro UI
│   └── render-data.ts               snapshot personalizace, vnořený tvar, strop 8 kB
├── materialize/
│   ├── plan.ts                      krok 1, obnova po pádu, rozhodovací tabulka
│   ├── loop.ts                      dávková smyčka, kurzor, kontrola stavu po dávce
│   └── finish.ts                    krok 3, total_count, audience_size
├── control/
│   ├── pause.ts
│   ├── resume.ts
│   ├── cancel.ts
│   ├── undo.ts
│   └── schedule.ts
├── outbox/
│   ├── revoke.ts                    revokePendingMessages
│   ├── reconcile.ts                 záchytná cesta
│   ├── anonymize.ts                 anonymizeMessages pro GDPR výmaz
│   └── stall-watch.ts               dohled bez zásahu
├── preflight/
│   ├── checks.ts                    čtrnáct kontrol
│   └── result.ts                    PreflightResult a Finding
├── deliverability/
│   ├── metrics.ts                   sazby, jmenovatele, zóny
│   ├── guards.ts                    automatické brzdy
│   └── rollup.ts                    denní zrcadlo
├── events/
│   ├── catalog.ts                   mapování SES eventType na typ a rank
│   ├── bounce-classification.ts     tabulka z 3.10.1
│   ├── normalize.ts                 SNS payload na interní tvar
│   └── process.ts                   párování, zápis, suppression
├── test-send/
│   └── send-test.ts
├── webhooks/
│   └── declarations.ts              čtrnáct typů odchozích událostí a jejich data
└── jobs/
    ├── queue-handlers.ts            registrace všech dvanácti handlerů
    ├── materialize.ts
    ├── scheduler.ts
    ├── watchdog.ts
    ├── resume-on-quota.ts
    ├── reconcile.ts
    ├── stall-watch.ts
    ├── provider-event-process.ts
    ├── provider-event-rematch.ts
    ├── provider-refresh-quota.ts
    ├── domain-recheck.ts
    ├── deliverability-rollup.ts
    └── retention.ts

packages/core/src/providers/
├── index.ts                         barrel domény, bez něj se @mlain/core/providers nerozřeší
├── types.ts                         SesConfig, SmtpConfig, ProviderPublicConfig, stavy
├── config-schema.ts                 zod pro obojí, odvození config_public
├── crypto.ts                        jediný adaptér na kontrakt 4
├── state-machine.ts                 stavy provideru a přechody
├── ses/
│   ├── client.ts                    tenký obal nad SESv2 a SNS s timeoutem
│   ├── account.ts                   GetAccount, kvóty, sandbox, enforcement
│   ├── identity.ts                  CreateEmailIdentity, DKIM tokeny, MAIL FROM
│   └── events-setup.ts              Configuration Set, topic, odběr
├── smtp/
│   └── verify.ts                    test připojení nad node:net a node:tls
├── dns/
│   ├── resolver.ts                  obal nad node:dns/promises s timeoutem
│   ├── spf.ts
│   ├── dkim.ts
│   ├── dmarc.ts
│   ├── mx.ts
│   ├── check-domain.ts              složení DomainChecks
│   └── detect-provider.ts           detekce podle NS a data soubor
├── sns/
│   ├── verify.ts                    podpis, cert URL, topic, stáří
│   ├── dedup.ts                     dedup_key a content_key
│   └── subscription.ts              SubscriptionConfirmation
├── delegation.ts                    token pro sdílenou stránku s DNS záznamy
└── trial-mode.ts                    zkušební režim podle části 6, 8.2.8

packages/core/src/campaigns/repo/
├── raw-sql.ts                       nese normativní SQL s $1..$N k Drizzle handle (D19)
├── campaign.ts                      CRUD, přechody, zámek obsahu, revision, compile_meta
├── audience-progress.ts
├── outbox.ts                        materializace, revoke, reconcile, cancel, anonymize
├── message-events.ts
├── receipts.ts                      provider_event_receipts
├── counters.ts                      inkrementy a rekoncilace
├── deliverability.ts                snapshots a rollup
├── links.ts                         campaign_links
└── retention.ts                     odpojení partition a jeho veto

packages/core/src/providers/repo/
├── provider.ts
└── domain.ts

apps/web/src/server/routes/campaigns/index.ts        a devět souborů s cestami
apps/web/src/server/routes/providers/index.ts        a šest souborů s cestami
apps/web/src/server/routes/webhooks-ses/index.ts

apps/web/src/app/[locale]/w/[slug]/campaigns/page.tsx
apps/web/src/app/[locale]/w/[slug]/campaigns/[id]/page.tsx
apps/web/src/app/[locale]/w/[slug]/campaigns/[id]/send/page.tsx
apps/web/src/app/[locale]/w/[slug]/campaigns/[id]/progress/page.tsx
apps/web/src/app/[locale]/w/[slug]/settings/sending/page.tsx
apps/web/src/app/[locale]/w/[slug]/settings/sending/new/page.tsx
apps/web/src/app/[locale]/w/[slug]/settings/sending/domains/[id]/page.tsx
apps/web/src/app/[locale]/w/[slug]/deliverability/page.tsx
apps/web/src/app/[locale]/d/[token]/page.tsx

apps/web/src/features/campaigns/*.tsx
apps/web/src/features/sending/*.tsx

packages/i18n/messages/cs/campaigns.json
packages/i18n/messages/en/campaigns.json

packages/core/data/dns-providers.json
packages/core/data/smtp-presets.json
```

---

## 7. Úkoly

Kroky jsou po 2 až 5 minutách. Test se vždy píše první a vždy se nejdřív spustí, aby se ověřilo, že spadne ze správného důvodu. Commituje se po každém úkolu.

Zkratky příkazů, které se opakují:

```bash
pnpm --filter @mlain/core test:unit          # čistá logika, bez databáze
pnpm --filter @mlain/core test:db            # testcontainers Postgres 18
pnpm --filter @mlain/web test:unit
pnpm turbo typecheck lint                    # celý workspace
```

Databázové testy P13 běží pod `@mlain/core`, ne pod `@mlain/db`, protože tam po rozhodnutí D2 leží celá datová vrstva domény. Skript `test:db` v `packages/core` zatím není a zavádí ho požadavek R-P01.7.

---

### Fáze A: brány, konstanty a model kampaně

#### Úkol 1: Ověřit předpoklady o cizích registrech, ne je předpokládat

Tenhle úkol nic neimplementuje. Existuje proto, že P13 stojí na čtyřech registrech, které vlastní jiné plány, a chyba v kterémkoliv z nich se jinak projeví až uprostřed fáze I jako nesrozumitelná runtime chyba.

**Files:**
- Create: `packages/core/src/campaigns/__tests__/assumptions.test.ts`

- [ ] **Step 1: Napsat padající test na registry**

```ts
// packages/core/src/campaigns/__tests__/assumptions.test.ts
import { describe, expect, it } from 'vitest';
import { QUEUE_REGISTRY } from '../../queues/registry';
import { ERROR_REGISTRY } from '../../errors/registry';
import { configSchema } from '../../config/schema';

const REQUIRED_QUEUES = [
  'campaign.materialize', 'campaign.scheduler', 'campaign.watchdog',
  'campaign.resume_on_quota', 'outbox.stall_watch', 'outbox.reconcile',
  'provider_event.process', 'provider_event.rematch', 'provider.refresh_quota',
  'domain.recheck', 'deliverability.rollup', 'retention.drop_message_partitions',
] as const;

const REQUIRED_ERROR_CODES = [
  'campaign_locked', 'campaign_audience_changed', 'campaign_undo_window_expired',
  'campaign_audience_empty', 'campaign_audience_too_large', 'campaign_not_compiled',
  'campaign_subject_missing', 'campaign_no_unsubscribe', 'campaign_unknown_merge_field',
  'campaign_schedule_too_soon', 'campaign_schedule_too_far', 'campaign_not_sendable',
  'provider_not_ready', 'provider_sending_paused', 'provider_quota_exceeded',
  'provider_sandbox', 'provider_credentials_invalid',
  'provider_smtp_host_unknown', 'provider_smtp_connection_refused',
  'provider_smtp_tls_invalid', 'provider_smtp_auth_failed', 'provider_smtp_timeout',
  'provider_smtp_starttls_unsupported', 'provider_smtp_greeting_invalid',
  'domain_dkim_missing', 'domain_spf_missing', 'domain_dmarc_missing',
  'test_recipient_suppressed', 'signature_invalid', 'invalid_state_transition',
  'validation_failed', 'not_found', 'rate_limited', 'conflict',
  // Nález plánu P08, viz požadavek R-P01.5. Bez něj nejde postavit kontrola z úkolu 47.
  'contract_mismatch',
] as const;

const REQUIRED_CONFIG_KEYS = [
  'CAMPAIGN_MATERIALIZE_BATCH_SIZE', 'CAMPAIGN_MATERIALIZE_MAX_MINUTES',
  'CAMPAIGN_MAX_RECIPIENTS', 'CAMPAIGN_PARTIAL_THRESHOLD',
  'CAMPAIGN_SCHEDULE_CATCHUP_HOURS', 'CAMPAIGN_UNDO_WINDOW_SECONDS',
  'CAMPAIGN_QUOTA_PAUSE_REMAINING', 'CAMPAIGN_QUOTA_RESUME_REMAINING',
  'CAMPAIGN_TEST_SEND_PER_HOUR', 'SOFT_BOUNCE_THRESHOLD', 'SOFT_BOUNCE_WINDOW_DAYS',
  'DELIVERABILITY_BOUNCE_GUARD_RATE', 'DELIVERABILITY_COMPLAINT_GUARD_RATE',
  'DELIVERABILITY_BOUNCE_WARN_RATE', 'DELIVERABILITY_COMPLAINT_WARN_RATE',
  'DELIVERABILITY_GUARD_MIN_SENT', 'DELIVERABILITY_CONTENT_BOUNCE_LIMIT',
  'MESSAGE_RETENTION_DAYS', 'MESSAGE_EVENT_RETENTION_DAYS',
  'SNS_CERT_CACHE_SECONDS', 'SNS_STORE_RAW_EVENTS',
  'DNS_CHECK_TIMEOUT_MS', 'DNS_CHECK_CONCURRENCY', 'AWS_API_TIMEOUT_MS',
  'SENDER_BATCH_SIZE', 'APP_URL',
] as const;

describe('predpoklady P13 o cizich registrech', () => {
  it.each(REQUIRED_QUEUES)('fronta %s je v registru P01', (name) => {
    expect(Object.keys(QUEUE_REGISTRY)).toContain(name);
  });

  it.each(REQUIRED_ERROR_CODES)('chybovy kod %s je v registru P01', (code) => {
    expect(ERROR_REGISTRY[code]).toBeDefined();
  });

  it.each(REQUIRED_CONFIG_KEYS)('konfiguracni promenna %s je v zod schematu P01', (key) => {
    expect(configSchema.shape).toHaveProperty(key);
  });

  it('CAMPAIGN_QUOTA_RESUME_REMAINING je vetsi nez PAUSE, jinak kampan cykluje', () => {
    const parsed = configSchema.parse({
      ...process.env,
      APP_URL: 'https://example.test',
      SECRET_KEY: 'AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8',
      DATABASE_URL: 'postgres://u:p@localhost:5432/db',
    });
    expect(parsed.CAMPAIGN_QUOTA_RESUME_REMAINING).toBeGreaterThan(
      parsed.CAMPAIGN_QUOTA_PAUSE_REMAINING,
    );
  });
});
```

- [ ] **Step 2: Spustit a zaznamenat, co chybí**

Run: `pnpm --filter @mlain/core test:unit -- assumptions`
Expected: FAIL na šesti proměnných z požadavku R-P01.1 a na sedmi kódech `provider_smtp_*` z R-P01.4. Fronty a ostatní kódy mají projít, protože P01 je deklaruje dopředu.

- [ ] **Step 3: Předat nálezy vlastníkovi P01**

Nálezy se **neopravují v této větvi.** Registr editovaný z osmi větví je osm merge konfliktů v jednom souboru, což je přesně to, čemu uzávěry S7, S8 a S12 brání. Nález se zapíše do `docs/superpowers/plans/2026-07-31-p13-kampane-provideri-outbox.md`, kapitola 4.1 (už tam je), a řeší se změnou P01.

- [ ] **Step 4: Ověřit balíčkové rozhraní a tvar transakčního handle**

Tenhle test je tady proto, že se na něm plán už jednou spálil. Původní podoba importovala `withTx` z `@mlain/db/tx` a volala `tx.query(text, params)`. Ani jedno neexistuje: `@mlain/db` nemá zástupný export, takže podcesta skončí `ERR_PACKAGE_PATH_NOT_EXPORTED`, a `Tx` je Drizzle handle, jehož `query` je **objekt, ne funkce**. Test se schválně **neptá zdrojáků P04 ani P03**, ptá se běžícího modulu a běžící databáze, protože přesně tam se ten rozdíl pozná.

```ts
// doplnit do stejného souboru
import { describe as d2, expect as e2, it as i2 } from 'vitest';
import { unsafeWorkspaceContext } from '@mlain/db/unsafe-context';

const WS_PROBE = '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6099';

d2('predpoklady P13 o balickovem rozhrani', () => {
  i2('@mlain/core/campaigns je importovatelny podcestou', async () => {
    const mod = await import('@mlain/core/campaigns');
    e2(mod).toBeTypeOf('object');
  });

  i2('@mlain/core/providers je importovatelny podcestou', async () => {
    const mod = await import('@mlain/core/providers');
    e2(mod).toBeTypeOf('object');
  });

  i2('transakcni vrstva je @mlain/core/tx a bere ctx bez poolu', async () => {
    const mod = await import('@mlain/core/tx');
    e2(typeof mod.withWorkspace).toBe('function');
    e2(typeof mod.withReadOnly).toBe('function');
    e2(typeof mod.pgErrorCode).toBe('function');
    // Dvouargumentova signatura. Kdyby P04 pridal pool jako prvni parametr,
    // vsech zhruba sto volani v P13 by se rozeslo.
    e2(mod.withWorkspace.length).toBe(2);
  });

  i2('@mlain/db NEMA podcestu k repository, a je to zamerne', async () => {
    await e2(import('@mlain/db/repo/campaigns/outbox')).rejects.toThrow(
      /ERR_PACKAGE_PATH_NOT_EXPORTED|Cannot find module/,
    );
  });

  i2('Tx nema metodu query, takze syrovy SQL musi jit pres rawSql', async () => {
    const { withWorkspace } = await import('@mlain/core/tx');
    const ctx = unsafeWorkspaceContext(WS_PROBE, { type: 'system' });
    await withWorkspace(ctx, async (tx) => {
      // Kdyby tohle byla funkce, rawSql by nebyl potreba. Neni.
      e2(typeof (tx as unknown as { query: unknown }).query).not.toBe('function');
      e2(typeof tx.execute).toBe('function');
    });
  });
});
```

Run: `pnpm --filter @mlain/core test:unit -- assumptions`
Expected: PASS. Poslední dva testy chrání rozhodnutí D2 a D19 před tichým návratem do stavu, kdy se plán nezkompiluje.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/campaigns/__tests__/assumptions.test.ts
git commit -m "test(campaigns): assert P01 and P03 registries contain what P13 needs"
```

---

#### Úkol 2: Konstanty domény a primitivum pro normativní SQL

Kromě konstant zakládá tenhle úkol dvě věci, bez kterých se nezkompiluje ani jeden další soubor plánu: pomocnou funkci `rawSql`, kterou datová vrstva nese normativní SQL k Drizzle handle, a barrel `index.ts` obou domén, bez kterého se `@mlain/core/campaigns` vůbec nerozřeší.

**Files:**
- Create: `packages/core/src/campaigns/constants.ts`
- Create: `packages/core/src/campaigns/repo/raw-sql.ts`
- Create: `packages/core/src/campaigns/index.ts`
- Create: `packages/core/src/providers/index.ts`
- Create: `packages/core/src/testing/harness.ts`
- Test: `packages/core/src/campaigns/__tests__/constants.test.ts`
- Test: `packages/core/src/campaigns/repo/__tests__/raw-sql.db.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/campaigns/__tests__/constants.test.ts
import { describe, expect, it } from 'vitest';
import {
  SCHEDULE_MIN_LEAD_MINUTES, SCHEDULE_MAX_AHEAD_DAYS, SCHEDULE_GRANULARITY_SECONDS,
  RENDER_DATA_MAX_BYTES, CANCEL_CLEANUP_BATCH_SIZE, AUDIENCE_PREVIEW_TIMEOUT_MS,
  MATERIALIZE_STATEMENT_TIMEOUT_MS, MATERIALIZE_TIMEOUT_STRIKES,
  AUDIENCE_PREVIEW_SAMPLE_SIZE, WATCHDOG_QUIET_SECONDS, TEST_SEND_MAX_RECIPIENTS,
} from '../constants';

describe('konstanty domeny kampani', () => {
  it('meze planovani jsou konstanty, ne konfigurace', () => {
    expect(SCHEDULE_MIN_LEAD_MINUTES).toBe(5);
    expect(SCHEDULE_MAX_AHEAD_DAYS).toBe(365);
    expect(SCHEDULE_GRANULARITY_SECONDS).toBe(60);
  });

  it('strop render_data je 8 kB', () => {
    expect(RENDER_DATA_MAX_BYTES).toBe(8 * 1024);
  });

  it('uklid pri zruseni jde po 10 000 radcich', () => {
    expect(CANCEL_CLEANUP_BATCH_SIZE).toBe(10_000);
  });

  it('nahled publika ceka nejvyse 5 sekund', () => {
    expect(AUDIENCE_PREVIEW_TIMEOUT_MS).toBe(5_000);
    expect(AUDIENCE_PREVIEW_SAMPLE_SIZE).toBe(20);
  });

  it('materializacni davka ma statement_timeout 30 s a tri pokusy', () => {
    expect(MATERIALIZE_STATEMENT_TIMEOUT_MS).toBe(30_000);
    expect(MATERIALIZE_TIMEOUT_STRIKES).toBe(3);
  });

  it('watchdog uzavira az po 10 s klidu a test jde nejvyse na 5 adres', () => {
    expect(WATCHDOG_QUIET_SECONDS).toBe(10);
    expect(TEST_SEND_MAX_RECIPIENTS).toBe(5);
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:unit -- constants`
Expected: FAIL, `Cannot find module '../constants'`.

- [ ] **Step 3: Napsat konstanty**

```ts
// packages/core/src/campaigns/constants.ts

/**
 * Meze planovani jsou konstanty, ne konfiguracni promenne. Duvod je v casti 4a, 3.5.2:
 * je to validace vstupu verejneho API, ne provozni parametr. Kdyby to byly promenne
 * prostredi, choval by se POST /campaigns/{id}/schedule na dvou instalacich jinak
 * a klient by to nemohl vedet predem.
 */
export const SCHEDULE_MIN_LEAD_MINUTES = 5;
export const SCHEDULE_MAX_AHEAD_DAYS = 365;
export const SCHEDULE_GRANULARITY_SECONDS = 60;

/** Strop personalizacnich dat na zpravu. Pri prekroceni vznika radek rovnou jako skipped. */
export const RENDER_DATA_MAX_BYTES = 8 * 1024;

/** Uklid outboxu pri zruseni bezi po davkach, aby transakce nebyla dlouha. */
export const CANCEL_CLEANUP_BATCH_SIZE = 10_000;

/** Uzivatel nikdy neceka na nahled publika dele nez 5 sekund. */
export const AUDIENCE_PREVIEW_TIMEOUT_MS = 5_000;
export const AUDIENCE_PREVIEW_SAMPLE_SIZE = 20;

/**
 * Ochrana proti segmentu, ktery se zkompiluje do draheho SQL (cast 4a, 7.3, bod 4).
 * Po treti davce, ktera spadne na timeout, jde kampan do failed.
 */
export const MATERIALIZE_STATEMENT_TIMEOUT_MS = 30_000;
export const MATERIALIZE_TIMEOUT_STRIKES = 3;

/** Watchdog uzavira kampan az po 10 s bez zmeny citacu, kvuli zavodu s dobehem davky. */
export const WATCHDOG_QUIET_SECONDS = 10;

/** Testovaci odeslani: 1 az 5 adres. */
export const TEST_SEND_MAX_RECIPIENTS = 5;

/** Tolerance u confirm_recipient_count pri odeslani, cast 4a, 4.1.1. */
export const AUDIENCE_CONFIRM_TOLERANCE = 0.01;

/** Rate limit rucni kontroly domeny: jednou za 30 s na domenu. */
export const DOMAIN_CHECK_MIN_INTERVAL_SECONDS = 30;

/** Delegacni odkaz na DNS zaznamy plati 14 dni (cast 6, 8.2.5). */
export const DELEGATION_TTL_DAYS = 14;

/** Zkusebni rezim: nejvyse 10 overenych adres a 50 zprav za 24 hodin (cast 6, 8.2.8). */
export const TRIAL_MAX_VERIFIED_ADDRESSES = 10;
export const TRIAL_MAX_MESSAGES_PER_DAY = 50;
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:unit -- constants`
Expected: PASS, 6 testů.

- [ ] **Step 5: Napsat padající test primitiva `rawSql`**

Test je databázový, ne jednotkový, a je to schválně. Otázka „nese tenhle dotaz parametry jako parametry?" se nedá zodpovědět z typů, jen spuštěním proti Postgresu.

```ts
// packages/core/src/campaigns/repo/__tests__/raw-sql.db.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import { closePools, withWorkspace } from '@mlain/core/tx';
import { unsafeWorkspaceContext } from '@mlain/db/unsafe-context';
import { rawSql } from '../raw-sql';

const WS = '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6072';
const ctx = unsafeWorkspaceContext(WS, { type: 'system' });

afterAll(async () => { await closePools(); });

describe('rawSql: normativni SQL s pozicovymi parametry', () => {
  it('vysledek je obalka s rows, ne pole', async () => {
    await withWorkspace(ctx, async (tx) => {
      const r = await tx.execute<{ n: number }>(rawSql(`SELECT 1::int AS n`, []));
      // Kdo pretypuje vysledek na pole, dostane u [0] undefined a nic nespadne.
      expect(Array.isArray(r)).toBe(false);
      expect(r.rows[0]!.n).toBe(1);
    });
  });

  it('tyz parametr pouzity dvakrat se dosadi dvakrat', async () => {
    await withWorkspace(ctx, async (tx) => {
      const r = await tx.execute<{ a: number; b: number }>(
        rawSql(`SELECT $1::int AS a, $1::int + $2::int AS b`, [40, 2]),
      );
      expect(r.rows[0]).toEqual({ a: 40, b: 42 });
    });
  });

  it('pole je JEDEN parametr, ne rozlozene hodnoty', async () => {
    await withWorkspace(ctx, async (tx) => {
      const ids = ['a', 'b', 'c'];
      const r = await tx.execute<{ n: number }>(
        rawSql(`SELECT count(*)::int AS n FROM unnest($1::text[]) x`, [ids]),
      );
      expect(r.rows[0]!.n).toBe(3);
    });
  });

  it('hodnota zustane hodnotou, i kdyz vypada jako SQL', async () => {
    await withWorkspace(ctx, async (tx) => {
      const evil = `'; DROP TABLE campaigns; --`;
      const r = await tx.execute<{ t: string }>(rawSql(`SELECT $1::text AS t`, [evil]));
      expect(r.rows[0]!.t).toBe(evil);
    });
  });

  it('odkaz na chybejici parametr spadne pri sestaveni, ne v databazi', () => {
    expect(() => rawSql(`SELECT $2::int`, [1])).toThrow(/\$2/);
  });

  it('SQLSTATE se cte pres pgErrorCode, ne z err.code', async () => {
    const { pgErrorCode } = await import('@mlain/core/tx');
    let caught: unknown;
    await withWorkspace(ctx, async (tx) => {
      await tx.execute(rawSql(`CREATE TEMP TABLE t_uq (id int PRIMARY KEY)`, []));
      await tx.execute(rawSql(`INSERT INTO t_uq VALUES ($1)`, [1]));
      try { await tx.execute(rawSql(`INSERT INTO t_uq VALUES ($1)`, [1])); }
      catch (e) { caught = e; }
    }).catch(() => undefined);
    expect((caught as { code?: unknown }).code).toBeUndefined();
    expect(pgErrorCode(caught)).toBe('23505');
  });
});
```

- [ ] **Step 6: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:db -- raw-sql`
Expected: FAIL, `Cannot find module '../raw-sql'`.

- [ ] **Step 7: Napsat `rawSql`**

```ts
// packages/core/src/campaigns/repo/raw-sql.ts
import { sql, type SQL } from 'drizzle-orm';

/**
 * Nese normativní SQL text s pozičními parametry k Drizzle handle.
 *
 * Existuje ze tří důvodů a každý z nich je ověřený spuštěním.
 *
 * 1. `Tx` z `@mlain/core/tx` je `NodePgDatabase`. Jeho `query` je relační dotazovací
 *    API Drizzle, tedy OBJEKT, ne funkce; `tx.query(text, params)` padá s
 *    `tx.query is not a function`. Syrový text se tedy k databázi musí dostat jinudy.
 * 2. `sql.raw(text)` parametry nést neumí a slepené hodnoty do textu jsou injekce.
 * 3. Holá hodnota typu pole se v šabloně `sql` rozloží na jednotlivé parametry, takže
 *    `sql`SELECT ... $\{ids\}::uuid[]`` vygeneruje `($1, $2, $3)::uuid[]` a dotaz spadne
 *    při prvním použití. Hodnoty proto jdou výhradně přes `sql.param`.
 *
 * Rozhodnutí D3 vyžaduje, aby text dotazu zůstal doslova takový, jaký je ve specifikaci,
 * protože scénář `OB-00` porovnává specifikaci s kódem. Tahle funkce to drží: text se
 * nemění, jen se v něm `$n` nahradí vázaným parametrem.
 */
export function rawSql(text: string, params: readonly unknown[] = []): SQL {
  // Rozdeleni zachova text beze zmeny; liche prvky jsou cisla parametru.
  const parts = text.split(/\$(\d+)/g);
  const chunks: SQL[] = [sql.raw(parts[0] ?? '')];

  for (let i = 1; i < parts.length; i += 2) {
    const ordinal = Number(parts[i]);
    const index = ordinal - 1;
    if (!Number.isInteger(ordinal) || index < 0 || index >= params.length) {
      throw new Error(
        `rawSql: dotaz odkazuje na $${parts[i]}, ale dostal jen ${params.length} parametrů. ` +
          `Text: ${text.slice(0, 120)}`,
      );
    }
    chunks.push(sql.param(params[index]));
    chunks.push(sql.raw(parts[i + 1] ?? ''));
  }

  return sql.join(chunks, sql.raw(''));
}
```

- [ ] **Step 8: Napsat barrel obou domén**

Bez těchhle dvou souborů se `@mlain/core/campaigns` nerozřeší vůbec, protože mapa `exports` balíčku `@mlain/core` míří na `./src/*/index.ts`. Původní podoba plánu je nezakládala, takže každý cizí import do domény kampaní by skončil chybou. Barrel se v dalších úkolech postupně doplňuje; tady vzniká s tím, co už existuje.

```ts
// packages/core/src/campaigns/index.ts
export * from './constants.js';
export { rawSql } from './repo/raw-sql.js';
```

```ts
// packages/core/src/providers/index.ts
// Doména providerů. Obsah doplňují úkoly fáze F a G.
export {};
```

- [ ] **Step 9: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:db -- raw-sql`
Expected: PASS, 6 testů.

- [ ] **Step 10: Napsat testovací harness**

Dvacet databázových testů tohohle plánu importuje `../../../testing/harness` a **nikdo ho nezakládá**. Grep napříč všemi plány: `testing/harness` se vyskytuje jen v P13. Bez tohohle souboru nespustí ani jeden z nich.

Harness je vědomě tenký: zakládá data přímo přes `rawSql`, ne přes doménové služby. Kdyby seedoval přes ně, testoval by kód sám sebou a chyba ve službě by se schovala do zeleného testu.

```ts
// packages/core/src/testing/harness.ts
import { randomUUID } from 'node:crypto';
import { appPool, withWorkspace, type WorkspaceContext } from '@mlain/core/tx';
import { unsafeWorkspaceContext } from '@mlain/db/unsafe-context';
import type { Queryable } from '@mlain/db/partitions';
import { rawSql } from '../campaigns/repo/raw-sql.js';

export type TestWorkspace = {
  workspace: WorkspaceContext;
  workspaceId: string;
  userId: string;
  contactId: string;
  /** Aplikacni spojeni pro testy, ktere overuji, ze neco pod mlain_app NEJDE. */
  appClient: Queryable;
};

/** Migratorske spojeni. Retencni testy ho potrebuji, protoze DDL vyzaduje vlastnika. */
export async function migratorClient(): Promise<Queryable> {
  const { Pool } = await import('pg');
  const url = process.env.DATABASE_URL_MIGRATOR;
  if (!url) throw new Error('DATABASE_URL_MIGRATOR není nastavená, retenční testy nemají čím běžet.');
  return new Pool({ connectionString: url, max: 2 });
}

/** Novy projekt s vlastnikem a jednim kontaktem. Kazdy test dostane svuj. */
export async function withTestWorkspace(): Promise<TestWorkspace> {
  const workspaceId = randomUUID();
  const userId = randomUUID();
  const contactId = randomUUID();
  const pool = appPool();

  // Zakladani projektu a uzivatele bezi BEZ kontextu, protoze kontext jeste neexistuje.
  const client = await pool.connect();
  try {
    await client.query(
      `INSERT INTO users (id, email, name) VALUES ($1, $2, 'Test')`,
      [userId, `owner-${userId}@example.com`],
    );
    await client.query(`SELECT set_config('mlain.user_id', $1, false)`, [userId]);
    await client.query(
      `INSERT INTO workspaces (id, name, slug) VALUES ($1, 'Test', $2)`,
      [workspaceId, `ws-${workspaceId.slice(0, 8)}`],
    );
    await client.query(
      `INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`,
      [workspaceId, userId],
    );
  } finally {
    client.release();
  }

  const workspace = unsafeWorkspaceContext(workspaceId, { type: 'user', userId, role: 'owner' });
  const ctx: TestWorkspace = { workspace, workspaceId, userId, contactId, appClient: pool };

  await withWorkspace(workspace, (tx) => tx.execute(rawSql(
    `INSERT INTO contacts (id, workspace_id, email, first_name, status)
     VALUES ($1, $2, $3, 'Testovací', 'active')`,
    [contactId, workspaceId, `contact-${contactId}@example.com`],
  )));

  return ctx;
}

export async function seedList(ctx: TestWorkspace, name = 'Seznam'): Promise<string> {
  const id = randomUUID();
  await withWorkspace(ctx.workspace, (tx) => tx.execute(rawSql(
    `INSERT INTO lists (id, workspace_id, name) VALUES ($1, $2, $3)`,
    [id, ctx.workspaceId, name],
  )));
  return id;
}

export async function seedContacts(
  ctx: TestWorkspace,
  input: {
    count: number; list?: string; email?: string;
    attributes?: Record<string, unknown>; sourceRef?: string; status?: string;
  },
): Promise<string[]> {
  const ids: string[] = [];
  await withWorkspace(ctx.workspace, async (tx) => {
    for (let i = 0; i < input.count; i += 1) {
      const id = randomUUID();
      ids.push(id);
      await tx.execute(rawSql(
        `INSERT INTO contacts (id, workspace_id, email, first_name, attributes, source_ref, status)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)`,
        [
          id, ctx.workspaceId,
          input.email && input.count === 1 ? input.email : `c-${id}@example.com`,
          `Jméno${i}`,
          JSON.stringify(input.attributes ?? {}),
          input.sourceRef ?? null,
          input.status ?? 'active',
        ],
      ));
      if (input.list) {
        await tx.execute(rawSql(
          `INSERT INTO list_subscriptions (workspace_id, list_id, contact_id, status)
           VALUES ($1, $2, $3, 'confirmed')`,
          [ctx.workspaceId, input.list, id],
        ));
      }
    }
  });
  return ids;
}

export async function seedCampaign(
  ctx: TestWorkspace,
  input: {
    status: string; includeLists?: string[]; subject?: string; design?: unknown;
    audienceBuiltAt?: string | null; audienceBuiltAtInRange?: { from: Date };
    compiled?: boolean; presence?: string[]; providerId?: string;
  },
): Promise<string> {
  const id = randomUUID();
  const audience = {
    include: { lists: input.includeLists ?? [], segments: [] },
    exclude: { lists: [], segments: [] },
  };
  const builtAt = input.audienceBuiltAtInRange
    ? input.audienceBuiltAtInRange.from.toISOString()
    : (input.audienceBuiltAt ?? null);

  const compileMeta = input.compiled
    ? {
        contractVersion: 1, rendererVersion: 'r1.0.0', clickMarkerCount: 0, links: [],
        usedPaths: input.presence ?? [],
        renderSchema: {
          version: 1, fields: (input.presence ?? []).map((p) => ({ path: p, type: 'string', required: false })),
          systemTags: [], presence: input.presence ?? [], loops: [],
        },
        hasUnsubscribeLink: true,
      }
    : null;

  await withWorkspace(ctx.workspace, (tx) => tx.execute(rawSql(
    `INSERT INTO campaigns
       (id, workspace_id, name, status, subject, audience, audience_built_at,
        design, compiled_html, compile_meta, provider_id, created_by)
     VALUES ($1, $2, 'Kampaň', $3, $4, $5::jsonb, $6::timestamptz,
             $7::jsonb, $8, $9::jsonb, $10, $11)`,
    [
      id, ctx.workspaceId, input.status, input.subject ?? 'Předmět',
      JSON.stringify(audience), builtAt,
      JSON.stringify(input.design ?? { version: 1, blocks: [] }),
      input.compiled ? '<p>ok</p>' : null,
      compileMeta ? JSON.stringify(compileMeta) : null,
      input.providerId ?? null, ctx.userId,
    ],
  )));
  return id;
}

export async function seedProvider(
  ctx: TestWorkspace,
  input: { type?: 'ses' | 'smtp'; status?: string } = {},
): Promise<string> {
  const id = randomUUID();
  await withWorkspace(ctx.workspace, (tx) => tx.execute(rawSql(
    `INSERT INTO sending_providers (id, workspace_id, name, type, config_encrypted, status)
     VALUES ($1, $2, 'Provider', $3, 'enc:test', $4)`,
    [id, ctx.workspaceId, input.type ?? 'ses', input.status ?? 'ready'],
  )));
  return id;
}

/** Zpravy v outboxu. `createdAtInRange` slouzi retencnim testum. */
export async function seedOutbox(
  ctx: TestWorkspace,
  input: {
    campaignId: string; pending?: number; sent?: number; claimed?: number;
    createdAtInRange?: { from: Date };
  },
): Promise<void> {
  const createdAt = (input.createdAtInRange?.from ?? new Date()).toISOString();
  await withWorkspace(ctx.workspace, async (tx) => {
    // Invariant I1: created_at zprav se musi rovnat audience_built_at kampane.
    await tx.execute(rawSql(
      `UPDATE campaigns SET audience_built_at = $2::timestamptz WHERE id = $1`,
      [input.campaignId, createdAt],
    ));
    for (const [status, n] of [['pending', input.pending], ['sent', input.sent], ['claimed', input.claimed]] as const) {
      for (let i = 0; i < (n ?? 0); i += 1) {
        const contactId = randomUUID();
        await tx.execute(rawSql(
          `INSERT INTO contacts (id, workspace_id, email, status)
           VALUES ($1, $2, $3, 'active')`,
          [contactId, ctx.workspaceId, `m-${contactId}@example.com`],
        ));
        await tx.execute(rawSql(
          `INSERT INTO messages
             (workspace_id, campaign_id, contact_id, kind, email, status, created_at, sent_at)
           VALUES ($1, $2, $3, 'campaign', $4, $5, $6::timestamptz,
                   CASE WHEN $5 = 'sent' THEN $6::timestamptz END)`,
          [ctx.workspaceId, input.campaignId, contactId, `m-${contactId}@example.com`, status, createdAt],
        ));
      }
    }
  });
}

export async function seedMessages(
  ctx: TestWorkspace,
  input: { campaignId: string; count: number; status?: string },
): Promise<void> {
  await seedOutbox(ctx, {
    campaignId: input.campaignId,
    [input.status ?? 'pending']: input.count,
  } as Parameters<typeof seedOutbox>[1]);
}

export async function seedEvents(
  ctx: TestWorkspace,
  input: { campaignId: string; type: string; count: number },
): Promise<void> {
  await withWorkspace(ctx.workspace, async (tx) => {
    const msgs = await tx.execute<{ id: string; created_at: string; contact_id: string }>(rawSql(
      `SELECT id, created_at, contact_id FROM messages WHERE campaign_id = $1 LIMIT $2`,
      [input.campaignId, input.count],
    ));
    for (const m of msgs.rows) {
      // rank se NEZAPISUJE, je to generovany sloupec.
      await tx.execute(rawSql(
        `INSERT INTO message_events
           (workspace_id, message_id, message_created_at, campaign_id, contact_id,
            recipient, type, ts, source)
         VALUES ($1, $2, $3::timestamptz, $4, $5, 'x@example.com', $6, now(), 'ses_sns')`,
        [ctx.workspaceId, m.id, m.created_at, input.campaignId, m.contact_id, input.type],
      ));
    }
  });
}

export async function addMember(ctx: TestWorkspace, input: { email: string }): Promise<string> {
  const userId = randomUUID();
  const client = await appPool().connect();
  try {
    await client.query(`INSERT INTO users (id, email, name) VALUES ($1, $2, 'Člen')`, [userId, input.email]);
    await client.query(
      `INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')`,
      [ctx.workspaceId, userId],
    );
  } finally { client.release(); }
  return userId;
}

export async function addSuppression(
  ctx: TestWorkspace,
  input: { email: string; reason: string },
): Promise<void> {
  await withWorkspace(ctx.workspace, (tx) => tx.execute(rawSql(
    `INSERT INTO suppressions (workspace_id, email, reason, source)
     VALUES ($1, $2, $3, 'manual')`,
    [ctx.workspaceId, input.email, input.reason],
  )));
}

export async function anonymizeSuppression(ctx: TestWorkspace, email: string): Promise<void> {
  await withWorkspace(ctx.workspace, (tx) => tx.execute(rawSql(
    `UPDATE suppressions SET removed_at = now() WHERE workspace_id = $1 AND email = $2`,
    [ctx.workspaceId, email],
  )));
}

/**
 * Manifest ukazkovych dat, presne v tvaru, jaky zaklada P16 (`demoManifestSchema`).
 * Testy ochrany ho potrebuji, protoze ochrana se opira o manifest, ne jen o znacku.
 */
export async function seedDemoManifest(
  ctx: TestWorkspace,
  input: { contactIds: string[]; listIds?: string[] },
): Promise<void> {
  const manifest = {
    version: 1,
    seededAt: new Date().toISOString(),
    contactIds: input.contactIds,
    listIds: input.listIds ?? [],
    tagIds: [], segmentIds: [], templateIds: [], campaignIds: [],
  };
  await withWorkspace(ctx.workspace, (tx) => tx.execute(rawSql(
    `UPDATE workspaces SET settings = jsonb_set(settings, '{demoData}', $2::jsonb, true)
      WHERE id = $1`,
    [ctx.workspaceId, JSON.stringify(manifest)],
  )));
}

export async function setProgressPhase(
  ctx: TestWorkspace,
  campaignId: string,
  phase: 'collecting' | 'materializing' | 'done',
): Promise<void> {
  await withWorkspace(ctx.workspace, (tx) => tx.execute(rawSql(
    `UPDATE campaign_audience_progress SET phase = $3 WHERE campaign_id = $1 AND workspace_id = $2`,
    [campaignId, ctx.workspaceId, phase],
  )));
}

/**
 * Mesicni oddil pred N mesici. Vraci jeho rozsah i jmeno, aby retencni testy
 * mohly overit veto proti konkretnimu oddilu.
 */
export async function createPartition(
  ctx: TestWorkspace,
  input: { monthsAgo: number; table?: string },
): Promise<{ name: string; from: Date; to: Date }> {
  const table = input.table ?? 'messages';
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - input.monthsAgo, 1));
  const to = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + 1, 1));
  const name = `${table}_y${from.getUTCFullYear()}m${String(from.getUTCMonth() + 1).padStart(2, '0')}`;

  // Oddil zaklada MIGRATOR, mlain_app na CREATE pravo nema.
  const client = await migratorClient();
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${name} PARTITION OF ${table}
       FOR VALUES FROM ('${from.toISOString()}') TO ('${to.toISOString()}')`,
    [],
  );
  void ctx;
  return { name, from, to };
}
```

- [ ] **Step 11: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:db -- raw-sql`
Expected: PASS, 6 testů.

- [ ] **Step 12: Commit**

```bash
git add packages/core/src/campaigns/constants.ts packages/core/src/campaigns/repo/raw-sql.ts \
  packages/core/src/campaigns/index.ts packages/core/src/providers/index.ts \
  packages/core/src/testing/harness.ts \
  packages/core/src/campaigns/__tests__/constants.test.ts \
  packages/core/src/campaigns/repo/__tests__/raw-sql.db.test.ts
git commit -m "feat(campaigns): domain constants, rawSql primitive, barrels and test harness"
```

---

#### Úkol 3: Typy kampaně a otevřené výčty

**Files:**
- Create: `packages/core/src/campaigns/types.ts`
- Test: `packages/core/src/campaigns/__tests__/types.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/campaigns/__tests__/types.test.ts
import { describe, expect, it } from 'vitest';
import {
  KNOWN_CAMPAIGN_STATUSES, isKnownCampaignStatus, TERMINAL_CAMPAIGN_STATUSES,
  SENDING_CAMPAIGN_STATUSES, campaignAudienceSchema, emptyCounters,
} from '../types';

describe('typy kampane', () => {
  it('zna deset stavu a subscribed mezi nimi neni', () => {
    expect(KNOWN_CAMPAIGN_STATUSES).toEqual([
      'draft', 'scheduled', 'queueing', 'sending', 'paused',
      'sent', 'partially_sent', 'cancelled', 'failed', 'schedule_missed',
    ]);
    expect(KNOWN_CAMPAIGN_STATUSES).not.toContain('subscribed');
  });

  it('neznamy stav toleruje, ale nehlasi jako znamy', () => {
    expect(isKnownCampaignStatus('sending')).toBe(true);
    expect(isKnownCampaignStatus('ab_testing')).toBe(false);
  });

  it('koncove stavy nedovoluji zadny prechod ven', () => {
    expect(TERMINAL_CAMPAIGN_STATUSES).toEqual(['sent', 'partially_sent', 'cancelled']);
  });

  it('claim dotaz bere queueing i sending, takze obojí je odesilaci stav', () => {
    expect(SENDING_CAMPAIGN_STATUSES).toEqual(['queueing', 'sending']);
  });

  it('publikum ma include i exclude a prazdny include je chyba', () => {
    const ok = campaignAudienceSchema.safeParse({
      include: { lists: ['0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071'], segments: [] },
      exclude: { lists: [], segments: [] },
    });
    expect(ok.success).toBe(true);

    const bad = campaignAudienceSchema.safeParse({
      include: { lists: [], segments: [] },
      exclude: { lists: [], segments: [] },
    });
    expect(bad.success).toBe(false);
  });

  it('pending v citacich je dopocitany, ne ulozeny', () => {
    const c = emptyCounters();
    expect(c.pending).toBe(0);
    expect({ ...c, total: 10, sent: 3, failed: 1, skipped: 2 }).toMatchObject({ total: 10 });
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:unit -- types`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napsat typy**

```ts
// packages/core/src/campaigns/types.ts
import { z } from 'zod';

/**
 * Vycty ve verejnem API jsou OTEVRENE (cast 4a, 4.1.1). Pridani hodnoty do vyctu
 * v odpovedi neni breaking change a smi prijit kdykoliv v ramci v1. Klient proto
 * nesmi mit switch bez vetve default a nikdy nesmi odpoved zahodit kvuli nezname
 * hodnote. Vzor 'a' | 'b' | (string & {}) napovida zname hodnoty a nezakazuje nezname.
 */
export const KNOWN_CAMPAIGN_STATUSES = [
  'draft', 'scheduled', 'queueing', 'sending', 'paused',
  'sent', 'partially_sent', 'cancelled', 'failed', 'schedule_missed',
] as const;

export type KnownCampaignStatus = (typeof KNOWN_CAMPAIGN_STATUSES)[number];
export type CampaignStatus = KnownCampaignStatus | (string & {});

export function isKnownCampaignStatus(value: string): value is KnownCampaignStatus {
  return (KNOWN_CAMPAIGN_STATUSES as readonly string[]).includes(value);
}

/** Stavy, ze kterych uz neni cesta ven. failed ma jako jediny reset_to_draft. */
export const TERMINAL_CAMPAIGN_STATUSES = ['sent', 'partially_sent', 'cancelled'] as const;

/**
 * Claim dotaz kontraktu bere kampane ve stavu queueing i sending, protoze sender
 * odebira praci uz behem materializace. Pauza proto musi fungovat z obou stavu.
 */
export const SENDING_CAMPAIGN_STATUSES = ['queueing', 'sending'] as const;

const uuid = z.string().uuid();

export const campaignAudienceSchema = z
  .object({
    include: z.object({ lists: z.array(uuid).default([]), segments: z.array(uuid).default([]) }),
    exclude: z.object({ lists: z.array(uuid).default([]), segments: z.array(uuid).default([]) }),
  })
  .strict()
  .refine(
    (a) => a.include.lists.length + a.include.segments.length > 0,
    { message: 'audience_empty', path: ['include'] },
  );

export type CampaignAudience = z.infer<typeof campaignAudienceSchema>;

export type CampaignCounters = {
  total: number; sent: number; failed: number; skipped: number;
  delivered: number; bounced: number; complained: number;
  /** Dopocitane: total - sent - failed - skipped. Nikdy se neuklada. */
  pending: number;
};

export function emptyCounters(): CampaignCounters {
  return { total: 0, sent: 0, failed: 0, skipped: 0, delivered: 0, bounced: 0, complained: 0, pending: 0 };
}

export function withPending(c: Omit<CampaignCounters, 'pending'>): CampaignCounters {
  return { ...c, pending: Math.max(0, c.total - c.sent - c.failed - c.skipped) };
}

export type Campaign = {
  id: string;
  workspace_id: string;
  name: string;
  status: CampaignStatus;
  subject: string;
  preheader: string;
  from_name: string;
  from_email: string;
  reply_to: string | null;
  template_id: string | null;
  audience: CampaignAudience;
  audience_size: number | null;
  audience_built_at: string | null;
  provider_id: string | null;
  sender_domain_id: string | null;
  unsubscribe_list_id: string | null;
  track_opens: boolean;
  track_clicks: boolean;
  revision: number;
  release_at: string | null;
  scheduled_at: string | null;
  schedule_timezone: string | null;
  counters: CampaignCounters;
  started_at: string | null;
  finished_at: string | null;
  paused_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Sloupce, ktere se po prechodu do sending nesmi zmenit. Sender si je nacte jednou
 * a drzi v cache pod klicem (campaign_id, revision). Vynucuje to API (campaign_locked),
 * databazovy trigger a inkrementace revision.
 */
export const IMMUTABLE_WHILE_SENDING = [
  'subject', 'preheader', 'from_name', 'from_email', 'reply_to',
  'compiled_html', 'compiled_text', 'compiled_fields',
  // compile_meta a compiled_hash patri do seznamu podle rozhodnuti D18: sender proti
  // compile_meta porovnava pocet znacek odkazu a materializace z nej bere renderSchema.
  // Zmena za behu by znamenala, ze cast publika ma jina data nez zbytek.
  'compile_meta', 'compiled_hash',
  'provider_id', 'sender_domain_id', 'track_opens', 'track_clicks',
  'unsubscribe_list_id', 'audience_built_at', 'release_at',
] as const;
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:unit -- types`
Expected: PASS, 6 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/campaigns/types.ts packages/core/src/campaigns/__tests__/types.test.ts
git commit -m "feat(campaigns): campaign types with open enums and audience schema"
```

---

#### Úkol 4: Stavový stroj kampaně

**Files:**
- Create: `packages/core/src/campaigns/state-machine.ts`
- Test: `packages/core/src/campaigns/__tests__/state-machine.test.ts`

- [ ] **Step 1: Napsat padající test, včetně zakázaných přechodů**

```ts
// packages/core/src/campaigns/__tests__/state-machine.test.ts
import { describe, expect, it } from 'vitest';
import { CAMPAIGN_TRANSITIONS, allowedFrom, canTransition, assertTransition } from '../state-machine';

describe('stavovy stroj kampane', () => {
  it('draft smi na scheduled a queueing, nikam jinam', () => {
    expect(allowedFrom('draft').sort()).toEqual(['queueing', 'scheduled']);
  });

  it('queueing smi na paused, coz drivejsi zneni zakazovalo', () => {
    expect(canTransition('queueing', 'paused')).toBe(true);
  });

  it('paused se vraci do queueing i do sending', () => {
    expect(canTransition('paused', 'queueing')).toBe(true);
    expect(canTransition('paused', 'sending')).toBe(true);
  });

  it.each([
    ['sent', 'sending'],
    ['cancelled', 'sending'],
    ['paused', 'sent'],
    ['sending', 'draft'],
    ['partially_sent', 'draft'],
  ] as const)('zakazany prechod %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(false);
  });

  it('failed se smi vratit do draftu, protoze nic neodeslo', () => {
    expect(canTransition('failed', 'draft')).toBe(true);
  });

  it('assertTransition vyhodi chybu s kodem invalid_state_transition', () => {
    expect(() => assertTransition('sent', 'sending')).toThrowError(/invalid_state_transition/);
  });

  it('kazdy stav z vyctu ma radek v tabulce prechodu', () => {
    expect(Object.keys(CAMPAIGN_TRANSITIONS).sort()).toEqual([
      'cancelled', 'draft', 'failed', 'partially_sent', 'paused',
      'queueing', 'schedule_missed', 'scheduled', 'sending', 'sent',
    ]);
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:unit -- state-machine`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napsat stavový stroj**

```ts
// packages/core/src/campaigns/state-machine.ts
import { AppError } from '../errors';
import type { KnownCampaignStatus } from './types';

/**
 * Tabulka prechodu z casti 4a, 3.1.3. Zakazane prechody, ktere stoji za pripomenuti:
 *  - sent -> sending: znovuodeslani je nejcastejsi pricina odhlaseni. Kdo chce poslat
 *    znovu, udela duplikat kampane, coz je jina akce s vlastnim ID.
 *  - paused -> sent: pozastavena kampan musi projit resume nebo cancel, jinak uzivatel
 *    nevi, jestli zbytek odesel.
 *  - sending -> draft: kampan, ze ktere neco odeslo, se uz nikdy nesmi stat draftem.
 *  - queueing -> paused je NAOPAK povoleny. Kontrakt casti 1 omezuje na queueing
 *    a sending SENDER, ne aplikaci; materialize_timeout je legitimni pripad.
 */
export const CAMPAIGN_TRANSITIONS: Record<KnownCampaignStatus, readonly KnownCampaignStatus[]> = {
  draft: ['scheduled', 'queueing'],
  scheduled: ['draft', 'scheduled', 'queueing', 'cancelled', 'schedule_missed'],
  queueing: ['sending', 'paused', 'cancelled', 'failed'],
  sending: ['paused', 'sent', 'partially_sent', 'cancelled'],
  paused: ['queueing', 'sending', 'cancelled'],
  sent: [],
  partially_sent: [],
  cancelled: [],
  failed: ['draft'],
  schedule_missed: ['draft', 'scheduled', 'queueing', 'cancelled'],
};

export function allowedFrom(from: KnownCampaignStatus): KnownCampaignStatus[] {
  return [...CAMPAIGN_TRANSITIONS[from]];
}

export function canTransition(from: KnownCampaignStatus, to: KnownCampaignStatus): boolean {
  return CAMPAIGN_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: KnownCampaignStatus, to: KnownCampaignStatus): void {
  if (canTransition(from, to)) return;
  throw new AppError('invalid_state_transition', {
    detail: `Kampaň ve stavu ${from} nelze převést do stavu ${to}.`,
    params: { from, to, allowed: allowedFrom(from) },
  });
}

/**
 * Vychozi stavy pro podmineny UPDATE. Prechod se vzdy dela jedinym dotazem
 * s podminkou status = ANY($allowed_from), takze dva soubezne pozadavky nemohou
 * provest tentyz prechod dvakrat. Kdyz dotaz nevrati radek, API vraci 409.
 */
export function sourcesFor(to: KnownCampaignStatus): KnownCampaignStatus[] {
  return (Object.keys(CAMPAIGN_TRANSITIONS) as KnownCampaignStatus[]).filter((from) =>
    canTransition(from, to),
  );
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:unit -- state-machine`
Expected: PASS, 11 testů (pět z `it.each`).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/campaigns/state-machine.ts packages/core/src/campaigns/__tests__/state-machine.test.ts
git commit -m "feat(campaigns): campaign state machine with explicit forbidden transitions"
```

---

#### Úkol 5: `pause_reason` jako jsonb s jedním závazným tvarem

**Files:**
- Create: `packages/core/src/campaigns/pause-reason.ts`
- Test: `packages/core/src/campaigns/__tests__/pause-reason.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/campaigns/__tests__/pause-reason.test.ts
import { describe, expect, it } from 'vitest';
import {
  pauseReasonSchema, PAUSE_REASON_CODES, SENDER_PAUSE_REASON_CODES,
  buildPauseReason, isAutoPause,
} from '../pause-reason';

describe('pause_reason', () => {
  it('registr ma devet kodu a ctyri z nich smi zapsat sender', () => {
    expect(PAUSE_REASON_CODES).toHaveLength(9);
    expect([...SENDER_PAUSE_REASON_CODES].sort()).toEqual([
      'credentials_undecryptable', 'provider_quota_exhausted',
      'provider_unavailable', 'render_failure_rate',
    ]);
  });

  it('hodnota quota z drivejsiho zneni v registru neni', () => {
    expect(PAUSE_REASON_CODES).not.toContain('quota');
  });

  it('povinne jsou code, source a at', () => {
    expect(pauseReasonSchema.safeParse({ code: 'user' }).success).toBe(false);
    expect(
      pauseReasonSchema.safeParse({ code: 'user', source: 'user', at: '2026-07-31T14:22:31.000Z' })
        .success,
    ).toBe(true);
  });

  it('sender_id smi byt jen kdyz source je sender', () => {
    const bad = pauseReasonSchema.safeParse({
      code: 'user', source: 'user', at: '2026-07-31T14:22:31.000Z', sender_id: 'mlain-ws-7f3a',
    });
    expect(bad.success).toBe(false);
  });

  it('neznamy kod se toleruje, protoze vycet je otevreny', () => {
    const r = pauseReasonSchema.safeParse({
      code: 'something_new', source: 'sender', at: '2026-07-31T14:22:31.000Z',
    });
    expect(r.success).toBe(true);
  });

  it('buildPauseReason vyrobi platny objekt s casem v UTC', () => {
    const r = buildPauseReason('bounce_guard', 'app', { detail: '8.4 %' });
    expect(pauseReasonSchema.parse(r).at.endsWith('Z')).toBe(true);
  });

  it('pauza uzivatele neni automaticka a nezapisuje campaign.auto_paused', () => {
    expect(isAutoPause({ code: 'user', source: 'user', at: '2026-07-31T14:22:31.000Z' })).toBe(false);
    expect(isAutoPause({ code: 'bounce_guard', source: 'app', at: '2026-07-31T14:22:31.000Z' })).toBe(true);
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:unit -- pause-reason`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napsat modul**

```ts
// packages/core/src/campaigns/pause-reason.ts
import { z } from 'zod';

/**
 * campaigns.pause_reason je KONTRAKTNI sloupec typu jsonb (cast 1, 4.10.1), ne text.
 * Do sloupce zapisuje i sender pres sloupcovy GRANT UPDATE (status, pause_reason)
 * a potrebuje vedle kodu predat i to, kdo pauzu udelal, kdy a ktera instance to byla.
 * Textovy sloupec by ty tri udaje neunesl a Go strana by do nej zapsala JSON jako retezec.
 */
export const PAUSE_REASON_CODES = [
  // zapisuje sender (i aplikace, viz nize)
  'render_failure_rate',
  'credentials_undecryptable',
  'provider_quota_exhausted',
  'provider_unavailable',
  // zapisuje vyhradne aplikace
  'user',
  'bounce_guard',
  'complaint_guard',
  'provider_blocked',
  'materialize_timeout',
] as const;

export type KnownPauseReasonCode = (typeof PAUSE_REASON_CODES)[number];
export type PauseReasonCode = KnownPauseReasonCode | (string & {});

/**
 * Sloupec "kdo zapisuje" v registru kontraktu omezuje SENDER, ne kod. Aplikace smi
 * zapsat kteroukoliv hodnotu vcetne techto ctyr: vycerpanou kvotu detekuje i ona
 * z GetAccount. Kdo zapis provedl, se pozna z pole source, ne z hodnoty code.
 */
export const SENDER_PAUSE_REASON_CODES = [
  'render_failure_rate', 'credentials_undecryptable',
  'provider_quota_exhausted', 'provider_unavailable',
] as const;

export const pauseReasonSchema = z
  .object({
    code: z.string().min(1),
    source: z.enum(['sender', 'app', 'user']),
    detail: z.string().max(2000).optional(),
    sender_id: z.string().max(64).optional(),
    at: z.string().datetime({ offset: false }),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.sender_id !== undefined && v.source !== 'sender') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sender_id'],
        message: 'sender_id smí být vyplněné jen když source je sender',
      });
    }
  });

export type PauseReason = z.infer<typeof pauseReasonSchema>;

export function buildPauseReason(
  code: PauseReasonCode,
  source: 'sender' | 'app' | 'user',
  extra: { detail?: string; senderId?: string; at?: Date } = {},
): PauseReason {
  const at = (extra.at ?? new Date()).toISOString();
  return {
    code,
    source,
    at,
    ...(extra.detail ? { detail: extra.detail } : {}),
    ...(extra.senderId && source === 'sender' ? { sender_id: extra.senderId } : {}),
  };
}

/**
 * Audit campaign.auto_paused zapisuje aplikace i tehdy, kdyz pauzu provedl sender,
 * protoze sender do audit_log nema granty. Pauzy vyvolane uzivatelem to nepokryva,
 * ty uz ma campaign.status_changed se skutecnym akterem.
 */
export function isAutoPause(reason: PauseReason): boolean {
  return reason.code !== 'user';
}

/** Job campaign.resume_on_quota vybira podle code, nikdy podle source. */
export const AUTO_RESUMABLE_PAUSE_CODES = ['provider_quota_exhausted'] as const;
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:unit -- pause-reason`
Expected: PASS, 7 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/campaigns/pause-reason.ts packages/core/src/campaigns/__tests__/pause-reason.test.ts
git commit -m "feat(campaigns): pause_reason jsonb shape and nine-code registry"
```

---

#### Úkol 6: Nastavení projektu, prahy jen směrem k přísnosti

**Files:**
- Create: `packages/core/src/campaigns/settings.ts`
- Test: `packages/core/src/campaigns/__tests__/settings.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/campaigns/__tests__/settings.test.ts
import { describe, expect, it } from 'vitest';
import { buildDeliverabilitySettingsSchema, buildCampaignSettingsSchema, resolveGuards } from '../settings';

const installation = {
  DELIVERABILITY_BOUNCE_GUARD_RATE: 0.08,
  DELIVERABILITY_COMPLAINT_GUARD_RATE: 0.003,
  DELIVERABILITY_BOUNCE_WARN_RATE: 0.04,
  DELIVERABILITY_COMPLAINT_WARN_RATE: 0.001,
  DELIVERABILITY_GUARD_MIN_SENT: 500,
};

describe('prahy dorucitelnosti se nastavuji jen smerem k prisnosti', () => {
  const schema = buildDeliverabilitySettingsSchema(installation);

  it('prisnejsi prah projde', () => {
    expect(schema.safeParse({ bounce_guard_rate: 0.05 }).success).toBe(true);
  });

  it('volnejsi prah vraci chybu s path na konkretni klic, ne tiche orezani', () => {
    const r = schema.safeParse({ bounce_guard_rate: 0.12 });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0].path).toEqual(['bounce_guard_rate']);
  });

  it('nula vypina brzdu a je to nejprisnejsi hodnota, takze projde', () => {
    expect(schema.safeParse({ complaint_guard_rate: 0 }).success).toBe(true);
  });

  it('u guard_min_sent znamena prisnejsi take nizsi cislo', () => {
    expect(schema.safeParse({ guard_min_sent: 200 }).success).toBe(true);
    expect(schema.safeParse({ guard_min_sent: 900 }).success).toBe(false);
  });

  it('prah zluteho varovani je 4 %, ne 5 %', () => {
    expect(resolveGuards({}, installation).bounceWarnRate).toBeCloseTo(0.04);
  });

  it('varovani ma stejnou podlahu jako automaticka pauza', () => {
    const g = resolveGuards({ guard_min_sent: 300 }, installation);
    expect(g.guardMinSent).toBe(300);
    expect(g.warnMinSent).toBe(300);
  });

  it('undo okno se smi zkratit, ne prodlouzit', () => {
    const s = buildCampaignSettingsSchema({ CAMPAIGN_UNDO_WINDOW_SECONDS: 60 });
    expect(s.safeParse({ undo_window_seconds: 30 }).success).toBe(true);
    expect(s.safeParse({ undo_window_seconds: 0 }).success).toBe(true);
    expect(s.safeParse({ undo_window_seconds: 120 }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:unit -- settings`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napsat modul**

```ts
// packages/core/src/campaigns/settings.ts
import { z } from 'zod';

export type DeliverabilityInstallationLimits = {
  DELIVERABILITY_BOUNCE_GUARD_RATE: number;
  DELIVERABILITY_COMPLAINT_GUARD_RATE: number;
  DELIVERABILITY_BOUNCE_WARN_RATE: number;
  DELIVERABILITY_COMPLAINT_WARN_RATE: number;
  DELIVERABILITY_GUARD_MIN_SENT: number;
};

/**
 * Hodnota z konfigurace instalace je zaroven vychozi hodnota I STROP (cast 4a, 3.15.2.1).
 * Projekt smi nastavit prah PRISNEJSI (nizsi), nikdy volnejsi. Tri duvody:
 *  1. Cisla jsou odvozena z hranic Amazonu, ne z naseho odhadu. Volnejsi prah existuje
 *     jen jako zpusob, jak si znicit odesilaci ucet.
 *  2. Brzda chrani odesilaci ucet a ten je v tomhle produktu per projekt.
 *  3. Vypnout brzdu uplne jde jen zmenou instalacni promenne na 0, tedy rozhodnutim
 *     provozovatele, ne uzivatele projektu.
 * U guard_min_sent znamena "prisnejsi" take nizsi cislo: nizsi podlaha znamena,
 * ze brzda zabere driv, tedy s mensim poctem odeslanych zprav.
 */
function boundedDown(max: number, key: string) {
  return z
    .number()
    .min(0)
    .refine((v) => v <= max, {
      message: `Hodnotu lze nastavit nejvýše na ${max}, tedy jen přísněji než instalace.`,
      path: [key],
    });
}

export function buildDeliverabilitySettingsSchema(limits: DeliverabilityInstallationLimits) {
  return z
    .object({
      bounce_guard_rate: boundedDown(limits.DELIVERABILITY_BOUNCE_GUARD_RATE, 'bounce_guard_rate').optional(),
      complaint_guard_rate: boundedDown(limits.DELIVERABILITY_COMPLAINT_GUARD_RATE, 'complaint_guard_rate').optional(),
      bounce_warn_rate: boundedDown(limits.DELIVERABILITY_BOUNCE_WARN_RATE, 'bounce_warn_rate').optional(),
      complaint_warn_rate: boundedDown(limits.DELIVERABILITY_COMPLAINT_WARN_RATE, 'complaint_warn_rate').optional(),
      guard_min_sent: z
        .number()
        .int()
        .min(1)
        .refine((v) => v <= limits.DELIVERABILITY_GUARD_MIN_SENT, {
          message: `Podlahu lze nastavit nejvýše na ${limits.DELIVERABILITY_GUARD_MIN_SENT}.`,
          path: ['guard_min_sent'],
        })
        .optional(),
    })
    .strict();
}

export type DeliverabilitySettings = z.infer<ReturnType<typeof buildDeliverabilitySettingsSchema>>;

export type ResolvedGuards = {
  bounceGuardRate: number;
  complaintGuardRate: number;
  bounceWarnRate: number;
  complaintWarnRate: number;
  guardMinSent: number;
  /** Zamerne stejna hodnota jako guardMinSent: podlaha plati na celou tabulku prahu. */
  warnMinSent: number;
};

export function resolveGuards(
  settings: DeliverabilitySettings,
  limits: DeliverabilityInstallationLimits,
): ResolvedGuards {
  const minSent = settings.guard_min_sent ?? limits.DELIVERABILITY_GUARD_MIN_SENT;
  return {
    bounceGuardRate: settings.bounce_guard_rate ?? limits.DELIVERABILITY_BOUNCE_GUARD_RATE,
    complaintGuardRate: settings.complaint_guard_rate ?? limits.DELIVERABILITY_COMPLAINT_GUARD_RATE,
    bounceWarnRate: settings.bounce_warn_rate ?? limits.DELIVERABILITY_BOUNCE_WARN_RATE,
    complaintWarnRate: settings.complaint_warn_rate ?? limits.DELIVERABILITY_COMPLAINT_WARN_RATE,
    guardMinSent: minSent,
    warnMinSent: minSent,
  };
}

/**
 * Undo okno ma strop opacnym smerem nez brzdy a je to schvalne. U brzd je nebezpecna
 * volba volnejsi prah, tady DELSI okno: uzivatel zmackne Odeslat, ceka, ze se odesila,
 * a ono se pet minut nic nedeje. Provozovatel instalace tedy urcuje, jak dlouhe
 * zdrzeni je jeste prijatelne, a projekt si smi okno zkratit nebo vypnout.
 */
export function buildCampaignSettingsSchema(limits: { CAMPAIGN_UNDO_WINDOW_SECONDS: number }) {
  return z
    .object({
      timezone: z.string().min(1).optional(),
      postal_address: z.string().max(500).optional(),
      undo_window_seconds: z
        .number()
        .int()
        .min(0)
        .refine((v) => v <= limits.CAMPAIGN_UNDO_WINDOW_SECONDS, {
          message: `Okno lze zkrátit, ne prodloužit. Strop instalace je ${limits.CAMPAIGN_UNDO_WINDOW_SECONDS} s.`,
          path: ['undo_window_seconds'],
        })
        .optional(),
      trial_mode: z.boolean().optional(),
      trial_verified: z
        .array(z.object({ email: z.string().email(), verified_at: z.string().datetime().nullable() }))
        .max(10)
        .optional(),
    })
    .strict();
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:unit -- settings`
Expected: PASS, 7 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/campaigns/settings.ts packages/core/src/campaigns/__tests__/settings.test.ts
git commit -m "feat(campaigns): per-workspace guard thresholds that only tighten"
```

---

#### Úkol 7: Repository přechodů stavu jediným podmíněným dotazem

**Files:**
- Create: `packages/core/src/campaigns/repo/campaign.ts`
- Test: `packages/core/src/campaigns/repo/__tests__/campaign.db.test.ts`

- [ ] **Step 1: Napsat padající test proti databázi**

```ts
// packages/core/src/campaigns/repo/__tests__/campaign.db.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { withTestWorkspace, seedCampaign } from '../../../testing/harness';
import { transitionStatus, getCampaign, bumpRevision } from '../campaign';

describe('prechody stavu kampane', () => {
  let ctx: Awaited<ReturnType<typeof withTestWorkspace>>;
  beforeEach(async () => { ctx = await withTestWorkspace(); });

  it('prechod z povoleneho stavu vrati radek', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    const row = await transitionStatus(ctx.workspace, {
      campaignId: id, to: 'queueing', from: ['draft', 'scheduled', 'schedule_missed'],
    });
    expect(row?.status).toBe('queueing');
  });

  it('prechod z nepovoleneho stavu nevrati nic a stav se nezmeni', async () => {
    const id = await seedCampaign(ctx, { status: 'sent' });
    const row = await transitionStatus(ctx.workspace, {
      campaignId: id, to: 'queueing', from: ['draft'],
    });
    expect(row).toBeNull();
    expect((await getCampaign(ctx.workspace, id))?.status).toBe('sent');
  });

  it('dva soubezne prechody: prave jeden uspeje', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    const both = await Promise.all([
      transitionStatus(ctx.workspace, { campaignId: id, to: 'queueing', from: ['draft'] }),
      transitionStatus(ctx.workspace, { campaignId: id, to: 'queueing', from: ['draft'] }),
    ]);
    expect(both.filter(Boolean)).toHaveLength(1);
  });

  it('kampan z ciziho projektu neni videt', async () => {
    const other = await withTestWorkspace();
    const id = await seedCampaign(other, { status: 'draft' });
    expect(await getCampaign(ctx.workspace, id)).toBeNull();
  });

  it('zmena obsahu ve stavu draft inkrementuje revision', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    const before = (await getCampaign(ctx.workspace, id))!.revision;
    await bumpRevision(ctx.workspace, id);
    expect((await getCampaign(ctx.workspace, id))!.revision).toBe(before + 1);
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:db -- campaign.db`
Expected: FAIL, `Cannot find module '../campaign'`.

- [ ] **Step 3: Napsat repository**

```ts
// packages/core/src/campaigns/repo/campaign.ts
import { withWorkspace, type WorkspaceContext } from '@mlain/core/tx';
import { rawSql } from './raw-sql.js';

export type CampaignRow = {
  id: string;
  workspace_id: string;
  status: string;
  audience_built_at: string | null;
  revision: number;
  release_at: string | null;
  provider_id: string | null;
  sender_domain_id: string | null;
  unsubscribe_list_id: string | null;
  scheduled_at: string | null;
  schedule_timezone: string | null;
  total_count: number;
  sent_count: number;
  failed_count: number;
  skipped_count: number;
  delivered_count: number;
  bounce_count: number;
  complaint_count: number;
  pause_reason: unknown;
};

export async function getCampaign(ctx: WorkspaceContext, id: string): Promise<CampaignRow | null> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<CampaignRow>(rawSql(
      `SELECT * FROM campaigns WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
      [id, ctx.workspaceId],
    ));
    return r.rows[0] ?? null;
  });
}

/**
 * Kazdy prechod se dela JEDINYM dotazem s podminkou na vychozi stav, takze dva
 * soubezne pozadavky nemohou provest tentyz prechod dvakrat (cast 4a, 3.1.4).
 * Kdyz dotaz nevrati radek, API vraci 409 invalid_state_transition; volajici tedy
 * musi navratovou hodnotu kontrolovat, ne ji zahodit.
 */
export async function transitionStatus(
  ctx: WorkspaceContext,
  input: {
    campaignId: string;
    to: string;
    from: readonly string[];
    /** Dalsi sloupce nastavene v temze UPDATE, aby prechod zustal atomicky. */
    set?: Record<string, unknown>;
  },
): Promise<{ id: string; status: string } | null> {
  const extra = Object.entries(input.set ?? {});
  const assignments = extra.map(([col], i) => `${col} = $${i + 5}`).join(', ');
  const sql = `
    UPDATE campaigns
       SET status = $3, updated_at = now()${assignments ? `, ${assignments}` : ''}
     WHERE id = $1 AND workspace_id = $2
       AND deleted_at IS NULL
       AND status = ANY($4::text[])
    RETURNING id, status`;
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<{ id: string; status: string }>(rawSql(sql, [
      input.campaignId, ctx.workspaceId, input.to, [...input.from], ...extra.map(([, v]) => v),
    ]));
    return r.rows[0] ?? null;
  });
}

/**
 * Klic cache senderu je (campaign_id, revision). Inkrementuje se pri kazde zmene
 * kterehokoliv ze sloupcu z IMMUTABLE_WHILE_SENDING, tedy prakticky jen ve stavu draft.
 * Bez toho by sender po duplikaci a novem odeslani drzel zastaralou hlavicku.
 */
export async function bumpRevision(ctx: WorkspaceContext, id: string): Promise<number> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<{ revision: number }>(rawSql(
      `UPDATE campaigns SET revision = revision + 1, updated_at = now()
        WHERE id = $1 AND workspace_id = $2 RETURNING revision`,
      [id, ctx.workspaceId],
    ));
    return r.rows[0]?.revision ?? 0;
  });
}

/** Kampane ve stavu queueing nebo sending daneho providera, pro hromadnou pauzu. */
export async function listRunningCampaignIds(
  ctx: WorkspaceContext,
  providerId?: string,
): Promise<string[]> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<{ id: string }>(rawSql(
      `SELECT id FROM campaigns
        WHERE workspace_id = $1
          AND status IN ('queueing','sending')
          AND deleted_at IS NULL
          AND ($2::uuid IS NULL OR provider_id = $2)`,
      [ctx.workspaceId, providerId ?? null],
    ));
    return r.rows.map((x) => x.id);
  });
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:db -- campaign.db`
Expected: PASS, 5 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/campaigns/repo/campaign.ts packages/core/src/campaigns/repo/__tests__/campaign.db.test.ts
git commit -m "feat(db): campaign repository with single-query guarded transitions"
```

---

### Fáze B: publikum

#### Úkol 8: Porty na cizí domény

Porty existují proto, aby šel P13 testovat bez P07, P08 a P11, a aby se případná odchylka v cizí signatuře opravovala na jednom místě.

**Files:**
- Create: `packages/core/src/campaigns/ports.ts`
- Test: `packages/core/src/campaigns/__tests__/ports.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/campaigns/__tests__/ports.test.ts
import { describe, expect, it } from 'vitest';
import { createPortRegistry, type AudiencePort } from '../ports';

describe('registr portu', () => {
  it('nezaregistrovany port hlasi jmenovitou chybu, ne undefined is not a function', () => {
    const reg = createPortRegistry();
    expect(() => reg.audience()).toThrowError(/audience port není zaregistrovaný/);
  });

  it('zaregistrovany port se vrati', () => {
    const reg = createPortRegistry();
    const fake: AudiencePort = {
      compileToSql: async () => ({ sql: 'SELECT a.id AS contact_id FROM contacts a', params: [] }),
      countGates: async () => ({
        raw: 0, eligible: 0, excluded_suppressed: 0, excluded_unsubscribed: 0,
        excluded_unconfirmed: 0, excluded_snoozed: 0, excluded_processing_restricted: 0,
        excluded_invalid_email: 0, excluded_deleted: 0, excluded_sample: 0, duplicates_removed: 0,
      }),
    };
    reg.register('audience', fake);
    expect(reg.audience()).toBe(fake);
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:unit -- ports`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napsat porty**

```ts
// packages/core/src/campaigns/ports.ts
import type { Tx } from '@mlain/core/tx';
import type { FieldCatalog } from '@mlain/core/contacts';
import type { PreparedDataSchema } from '@mlain/contracts/liquid/prepare-render-data';
import type { CompileResult, RenderSchema } from '@mlain/emails/compile/types';
import type { CampaignAudience } from './types';

/**
 * Jedenact klicu, ne deset. `excluded_sample` je pozadavek R-P07.6 a cte ho
 * `sampleAudienceState` z ukolu 48. Kdyz v tomhle typu chybi, ukol 48 se
 * NEZKOMPILUJE, protoze si ten klic bere pres `Pick<AudienceGateCounts, ...>`.
 *
 * Soucet vsech `excluded_*` plus `eligible` plus `duplicates_removed` musi dat `raw`.
 * Na tom stoji pojmenovany rozpad v kontrolnim seznamu (cast 6, 8.6.2), ktery
 * VYSLOVNE zakazuje souhrnny radek „Vyloučeno".
 */
export type AudienceGateCounts = {
  raw: number;
  eligible: number;
  excluded_suppressed: number;
  excluded_unsubscribed: number;
  excluded_unconfirmed: number;
  excluded_snoozed: number;
  excluded_processing_restricted: number;
  excluded_invalid_email: number;
  excluded_deleted: number;
  excluded_sample: number;
  duplicates_removed: number;
};

/**
 * Jediná podporovaná cesta k publiku. Cast 2 vyslovne zakazuje, aby si cast 4
 * psala vlastni SQL nad contacts, list_subscriptions a suppressions: podminky
 * zpusobilosti by pak existovaly na dvou mistech a za pul roku by se rozesly.
 */
export type AudiencePort = {
  compileToSql(input: {
    workspaceId: string;
    selection: { listIds?: string[]; segmentIds?: string[] };
    alias: string;
    paramOffset: number;
    asOf: Date;
  }): Promise<{ sql: string; params: unknown[] }>;

  /**
   * Rozpad po branach. Pocita ho cast 2, protoze poradi a pojmenovani bran vlastni
   * ona (jeji 4.1.6) a obalka kompilatoru je odecita uvnitr sebe, takze z jeho
   * vystupu nejde zjistit, kolik lidi kterou branou vypadlo. Viz pozadavek R-P07.1.
   */
  countGates(input: {
    workspaceId: string;
    audience: CampaignAudience;
    asOf: Date;
    timeoutMs?: number;
  }): Promise<AudienceGateCounts>;
};

/**
 * Kompilace sablony. Port je TENKY obal nad `compileTemplate` z `@mlain/core/templates`
 * a jeho tvar je DOSLOVA tvar kontraktu 5 z P08. Zadne prekladani, zadne zuzovani.
 *
 * Predchozi podoba tohohle portu byla nejzavaznejsi vlastni rozpor plánu: deklarovala
 * metodu `compile` vracejici `{ html, text, usedFields, links }` BEZ `id` u odkazu a BEZ
 * poctu znacek, zatimco `normalizeCompileOutput` z ukolu 47 obojí VYZADOVALA a vyhazovala
 * chybu, kdyz chybi. Port tedy nemohl vratit nic, co by jeho vlastni kontrolou proslo,
 * a v celem plánu nebyl jediny radek, kde by se skutecne volal.
 */
export type TemplatePort = {
  /**
   * Vraci `CompileResult` z P08 beze zmeny, tedy rozliseny svazek: pri `ok: false` nese
   * `issues` a NIKDY ne html. Kdo si z nej vezme `html` bez kontroly `ok`, nezkompiluje se.
   */
  compileTemplate(input: {
    tx: Tx;
    workspaceId: string;
    document: unknown;
    templateKind: 'campaign' | 'transactional' | 'system';
    fields: FieldCatalog;
    language: string;
    assetBaseUrl: string;
    /** Pro kampan vzdy 'send'; pri 'send' je `campaignId` POVINNE, jinak P08 vraci tvrdou chybu. */
    purpose: 'send' | 'preview' | 'test';
    campaignId?: string;
    trackOpens: boolean;
    trackClicks: boolean;
    preheader?: string;
    now?: Date;
  }): Promise<CompileResult>;

  /**
   * Zuzeni `renderSchema` z kontraktu 5 na tvar, ktery bere `prepareRenderData`.
   * Obe strany pouzivaji jmeno `RenderSchema` pro NECO JINEHO, takze prevod musi
   * projit touhle funkci; pretypovanim by se ztratila kontrola uplne.
   */
  toPreparedSchema(schema: RenderSchema): PreparedDataSchema;

  /** Ukazkova data pro testovaci odeslani, kdyz je publikum prazdne (R3.6). */
  sampleContact(): Record<string, unknown>;
};

export type SuppressionPort = {
  add(input: {
    workspaceId: string;
    email: string;
    reason: 'hard_bounce' | 'complaint' | 'soft_bounce_threshold' | 'ses_suppressed';
    source: 'ses_event';
    metadata: Record<string, unknown>;
  }): Promise<{ created: boolean; suppressionId: string }>;
  isSuppressed(input: { workspaceId: string; email: string }): Promise<boolean>;
};

export type AuditPort = {
  write(input: {
    workspaceId: string; action: string; actor: 'system' | { userId: string };
    target?: { type: string; id: string }; detail?: unknown;
  }): Promise<void>;
};

export type OutgoingWebhookPort = {
  emit(input: { workspaceId: string; type: string; occurredAt: Date; data: unknown }): Promise<void>;
};

type PortMap = {
  audience: AudiencePort;
  template: TemplatePort;
  suppression: SuppressionPort;
  audit: AuditPort;
  webhook: OutgoingWebhookPort;
};

export function createPortRegistry() {
  const ports: Partial<PortMap> = {};
  function get<K extends keyof PortMap>(key: K): PortMap[K] {
    const p = ports[key];
    if (!p) throw new Error(`${key} port není zaregistrovaný. Zaregistruj ho při startu procesu.`);
    return p;
  }
  return {
    register<K extends keyof PortMap>(key: K, impl: PortMap[K]) { ports[key] = impl; },
    audience: () => get('audience'),
    template: () => get('template'),
    suppression: () => get('suppression'),
    audit: () => get('audit'),
    webhook: () => get('webhook'),
  };
}

export type PortRegistry = ReturnType<typeof createPortRegistry>;
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:unit -- ports`
Expected: PASS, 2 testy.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/campaigns/ports.ts packages/core/src/campaigns/__tests__/ports.test.ts
git commit -m "feat(campaigns): ports for audience, template, suppression, audit and webhooks"
```

---

#### Úkol 9: Skládání publika z kompilátoru části 2

**Files:**
- Create: `packages/core/src/campaigns/audience/build-sql.ts`
- Test: `packages/core/src/campaigns/audience/__tests__/build-sql.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/campaigns/audience/__tests__/build-sql.test.ts
import { describe, expect, it, vi } from 'vitest';
import { buildAudienceSql } from '../build-sql';
import type { AudiencePort } from '../../ports';

function portReturning(): AudiencePort {
  return {
    compileToSql: vi.fn(async ({ alias, paramOffset }) => ({
      sql: `SELECT ${alias}.id AS contact_id FROM contacts ${alias} WHERE ${alias}.workspace_id = $${paramOffset + 1}`,
      params: ['ws'],
    })),
    countGates: vi.fn(),
  } as unknown as AudiencePort;
}

const audience = {
  include: { lists: ['l1'], segments: ['s1'] },
  exclude: { lists: ['l2'], segments: [] },
};

describe('skladani publika', () => {
  it('vola kompilator dvakrat, pro include a pro exclude', async () => {
    const port = portReturning();
    await buildAudienceSql(port, { workspaceId: 'ws', audience, paramOffset: 2, asOf: new Date(0) });
    expect(port.compileToSql).toHaveBeenCalledTimes(2);
  });

  it('exclude dostane jiny alias, jinak by se poddotazy prekryly', async () => {
    const port = portReturning();
    await buildAudienceSql(port, { workspaceId: 'ws', audience, paramOffset: 0, asOf: new Date(0) });
    const calls = (port.compileToSql as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0].alias).toBe('inc');
    expect(calls[1][0].alias).toBe('exc');
  });

  it('paramOffset druheho volani navazuje na delku parametru prvniho', async () => {
    const port = portReturning();
    await buildAudienceSql(port, { workspaceId: 'ws', audience, paramOffset: 3, asOf: new Date(0) });
    const calls = (port.compileToSql as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[0][0].paramOffset).toBe(3);
    expect(calls[1][0].paramOffset).toBe(4);
  });

  it('prazdny exclude kompilator vubec nevola', async () => {
    const port = portReturning();
    const out = await buildAudienceSql(port, {
      workspaceId: 'ws',
      audience: { include: { lists: ['l1'], segments: [] }, exclude: { lists: [], segments: [] } },
      paramOffset: 0, asOf: new Date(0),
    });
    expect(port.compileToSql).toHaveBeenCalledTimes(1);
    expect(out.sql).not.toContain('NOT IN');
  });

  it('vysledek je vyraz pro WHERE, bez ORDER BY, LIMIT a stredniku', async () => {
    const out = await buildAudienceSql(portReturning(), {
      workspaceId: 'ws', audience, paramOffset: 0, asOf: new Date(0),
    });
    expect(out.sql).toContain('IN (');
    expect(out.sql).toContain('NOT IN (');
    expect(out.sql).not.toMatch(/order by|limit|;/i);
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:unit -- build-sql`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napsat modul**

```ts
// packages/core/src/campaigns/audience/build-sql.ts
import type { AudiencePort } from '../ports';
import type { CampaignAudience } from '../types';

/**
 * Kompilator casti 2 bere jen sjednoceni (segmentIds, listIds), kdezto CampaignAudience
 * ma include i exclude. Skladame tedy dve volani:
 *
 *   publikum = (⋃ include.lists ∪ ⋃ include.segments) − (⋃ exclude.lists ∪ ⋃ exclude.segments)
 *
 * include je sjednoceni, ne prunik. Prunik se dela segmentem, protoze segment uz umi AND.
 * Vlastni SQL nad contacts tim nevznika: obe strany generuje kompilator vcetne sve
 * ctyrclenne obalky (workspace_id, deleted_at, processing_restricted, suppression).
 */
export async function buildAudienceSql(
  port: AudiencePort,
  input: { workspaceId: string; audience: CampaignAudience; paramOffset: number; asOf: Date; targetAlias?: string },
): Promise<{ sql: string; params: unknown[]; nextParamOffset: number }> {
  const target = input.targetAlias ?? 'c';

  const include = await port.compileToSql({
    workspaceId: input.workspaceId,
    selection: { listIds: input.audience.include.lists, segmentIds: input.audience.include.segments },
    alias: 'inc',
    paramOffset: input.paramOffset,
    asOf: input.asOf,
  });

  const params = [...include.params];
  let sql = `${target}.id IN (${include.sql})`;

  const hasExclude =
    input.audience.exclude.lists.length + input.audience.exclude.segments.length > 0;

  if (hasExclude) {
    const exclude = await port.compileToSql({
      workspaceId: input.workspaceId,
      selection: { listIds: input.audience.exclude.lists, segmentIds: input.audience.exclude.segments },
      alias: 'exc',
      paramOffset: input.paramOffset + include.params.length,
      asOf: input.asOf,
    });
    params.push(...exclude.params);
    sql += ` AND ${target}.id NOT IN (${exclude.sql})`;
  }

  return { sql, params, nextParamOffset: input.paramOffset + params.length };
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:unit -- build-sql`
Expected: PASS, 5 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/campaigns/audience/build-sql.ts packages/core/src/campaigns/audience/__tests__/build-sql.test.ts
git commit -m "feat(campaigns): compose audience from two compiler calls, include minus exclude"
```

---

#### Úkol 10: Snapshot personalizace `render_data`

**Files:**
- Create: `packages/core/src/campaigns/audience/render-data.ts`
- Test: `packages/core/src/campaigns/audience/__tests__/render-data.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/campaigns/audience/__tests__/render-data.test.ts
import { describe, expect, it } from 'vitest';
import { buildRenderData, renderDataColumns, RENDER_DATA_EXCLUDED_FIELDS } from '../render-data';

const contact = {
  id: 'c1',
  email: 'jana@example.cz',
  first_name: 'Jana',
  last_name: 'Nováková',
  first_name_vocative: 'Jano',
  greeting: 'Dobrý den, Jano',
  attributes: { city: 'Brno', orders_count: 3, note: null },
};

describe('render_data', () => {
  it('tvar je vnoreny, ne plochy, jinak Liquid nic nevyrendruje', () => {
    const rd = buildRenderData(contact, ['contact.first_name']);
    expect(rd.data).toEqual({ contact: { first_name: 'Jana' } });
    expect(Object.keys(rd.data)).not.toContain('contact.first_name');
  });

  it('vlastni pole jde pod contact.attr, ne contact.custom', () => {
    const rd = buildRenderData(contact, ['contact.attr.city']);
    expect(rd.data).toEqual({ contact: { attr: { city: 'Brno' } } });
  });

  it('null se zapisuje jako null, ne vynechava', () => {
    const rd = buildRenderData(contact, ['contact.attr.note']);
    expect(rd.data.contact.attr).toEqual({ note: null });
  });

  it('e-mail se nikdy nesnapshotuje, je v samostatnem sloupci', () => {
    const rd = buildRenderData(contact, ['contact.email', 'contact.first_name']);
    expect(JSON.stringify(rd.data)).not.toContain('jana@example.cz');
    expect(RENDER_DATA_EXCLUDED_FIELDS).toContain('contact.email');
  });

  it('unsubscribe_url a webview_url se nesnapshotuji, stavi je sender z tokenu', () => {
    const rd = buildRenderData(contact, ['unsubscribe_url', 'webview_url', 'contact.first_name']);
    expect(rd.data).toEqual({ contact: { first_name: 'Jana' } });
  });

  it('hlubsi nez dve urovne se odmita', () => {
    expect(() => buildRenderData(contact, ['contact.attr.a.b'])).toThrowError(/dvě úrovně/);
  });

  it('pres 8 kB vraci priznak too large, ne vyjimku', () => {
    const big = { ...contact, attributes: { blob: 'x'.repeat(9000) } };
    const rd = buildRenderData(big, ['contact.attr.blob']);
    expect(rd.tooLarge).toBe(true);
    expect(rd.errorCode).toBe('render_data_too_large');
  });

  it('renderDataColumns vraci jen sloupce, ktere sablona pouziva', () => {
    expect(renderDataColumns(['contact.first_name', 'contact.attr.city']).sort())
      .toEqual(['attributes', 'first_name']);
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:unit -- render-data`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napsat modul**

```ts
// packages/core/src/campaigns/audience/render-data.ts
import { RENDER_DATA_MAX_BYTES } from '../constants';

/**
 * Merge tagy, ktere se do render_data NIKDY nedostanou:
 *  - contact.email: sender ho bere z messages.email. Kdyby byl na dvou mistech, mohl by
 *    se rozejit a obalkova adresa je jedina, ktera musi byt jednoznacna.
 *  - unsubscribe_url a webview_url: stavi je sender z podepsaneho tokenu (kontrakt 3).
 *    Kdyby je stavela aplikace, byla by to druha implementace tehoz podpisu a zhruba
 *    117 znaku URL navic u kazde zpravy, tedy pres 100 MB u milionove kampane.
 */
export const RENDER_DATA_EXCLUDED_FIELDS = ['contact.email', 'unsubscribe_url', 'webview_url'] as const;

export type ContactSnapshotSource = {
  id: string;
  email: string;
  attributes?: Record<string, unknown> | null;
} & Record<string, unknown>;

export type RenderDataResult = {
  data: { contact: Record<string, unknown> & { attr?: Record<string, unknown> } };
  bytes: number;
  tooLarge: boolean;
  errorCode?: 'render_data_too_large';
};

/** Ktere sloupce contacts musi umet dodat kandidatsky dotaz pro dane merge tagy. */
export function renderDataColumns(usedFields: readonly string[]): string[] {
  const cols = new Set<string>();
  for (const f of usedFields) {
    if ((RENDER_DATA_EXCLUDED_FIELDS as readonly string[]).includes(f)) continue;
    const parts = f.split('.');
    if (parts[0] !== 'contact') continue;
    if (parts[1] === 'attr') cols.add('attributes');
    else if (parts.length === 2) cols.add(parts[1]);
  }
  return [...cols];
}

export function buildRenderData(
  contact: ContactSnapshotSource,
  usedFields: readonly string[],
): RenderDataResult {
  const out: Record<string, unknown> & { attr?: Record<string, unknown> } = {};

  for (const field of usedFields) {
    if ((RENDER_DATA_EXCLUDED_FIELDS as readonly string[]).includes(field)) continue;
    const parts = field.split('.');
    if (parts[0] !== 'contact') continue;

    if (parts.length === 2) {
      out[parts[1]] = normalize(contact[parts[1]]);
      continue;
    }
    if (parts.length === 3 && parts[1] === 'attr') {
      out.attr ??= {};
      out.attr[parts[2]] = normalize((contact.attributes ?? {})[parts[2]]);
      continue;
    }
    throw new Error(
      `Merge tag ${field} má víc než dvě úrovně. Liquid subset neumí vnořené cykly, hlubší struktury se nesnapshotují.`,
    );
  }

  const data = { contact: out };
  const bytes = Buffer.byteLength(JSON.stringify(data), 'utf8');
  if (bytes > RENDER_DATA_MAX_BYTES) {
    return { data, bytes, tooLarge: true, errorCode: 'render_data_too_large' };
  }
  return { data, bytes, tooLarge: false };
}

/**
 * Hodnota, ktera je NULL, se zapisuje jako null, ne vynechava. Sender pak rozlisi
 * "pole neexistuje" (chyba sablony) od "pole je prazdne" (normalni stav, resi | default:).
 */
function normalize(v: unknown): string | number | boolean | null {
  if (v === undefined || v === null) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (v instanceof Date) return v.toISOString();
  return String(v);
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:unit -- render-data`
Expected: PASS, 8 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/campaigns/audience/render-data.ts packages/core/src/campaigns/audience/__tests__/render-data.test.ts
git commit -m "feat(campaigns): nested render_data snapshot with 8 kB cap"
```

---

#### Úkol 11: Náhled počtu publika

**Files:**
- Create: `packages/core/src/campaigns/audience/preview.ts`
- Create: `packages/core/src/campaigns/repo/audience.ts`
- Test: `packages/core/src/campaigns/audience/__tests__/preview.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/campaigns/audience/__tests__/preview.test.ts
import { describe, expect, it, vi } from 'vitest';
import { buildPreview } from '../preview';

const gates = {
  raw: 1208, eligible: 1129, excluded_suppressed: 12, excluded_unsubscribed: 43,
  excluded_unconfirmed: 17, excluded_snoozed: 4, excluded_processing_restricted: 3,
  excluded_invalid_email: 0, excluded_deleted: 0, excluded_sample: 0, duplicates_removed: 0,
};

describe('nahled publika', () => {
  it('soucet vyloucenych plus vysledek se rovna vstupnimu poctu', () => {
    const p = buildPreview({ gates, sample: [], exact: true, computedAt: new Date(0) });
    const sum =
      p.breakdown.excluded_suppressed + p.breakdown.excluded_unsubscribed +
      p.breakdown.excluded_unconfirmed + p.breakdown.excluded_snoozed +
      p.breakdown.excluded_processing_restricted + p.breakdown.excluded_invalid_email +
      p.breakdown.excluded_deleted + p.breakdown.excluded_sample + p.breakdown.duplicates_removed;
    expect(sum + p.total).toBe(gates.raw);
  });

  it('total je eligible, nikdy vlastni vypocet', () => {
    expect(buildPreview({ gates, sample: [], exact: true, computedAt: new Date(0) }).total).toBe(1129);
  });

  it('pri timeoutu vraci exact false a odhad', () => {
    const p = buildPreview({ gates: { ...gates, eligible: 1100 }, sample: [], exact: false, computedAt: new Date(0) });
    expect(p.exact).toBe(false);
  });

  it('vzorek ma nejvyse 20 polozek', () => {
    const sample = Array.from({ length: 50 }, (_, i) => ({ contact_id: `c${i}`, email: `a${i}@x.cz`, first_name: null }));
    expect(buildPreview({ gates, sample, exact: true, computedAt: new Date(0) }).sample).toHaveLength(20);
  });

  it('nulove brany zustavaji v rozpadu, aby bylo videt, ze se kontrolovaly', () => {
    const p = buildPreview({ gates, sample: [], exact: true, computedAt: new Date(0) });
    expect(p.breakdown).toHaveProperty('excluded_invalid_email', 0);
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:unit -- preview`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napsat obojí**

```ts
// packages/core/src/campaigns/audience/preview.ts
import { AUDIENCE_PREVIEW_SAMPLE_SIZE } from '../constants';
import type { AudienceGateCounts } from '../ports';

export type AudienceSampleRow = { contact_id: string; email: string; first_name: string | null };

export type AudiencePreview = {
  total: number;
  breakdown: {
    from_lists: number;
    from_segments: number;
    excluded_by_lists: number;
    excluded_by_segments: number;
    excluded_unsubscribed: number;
    excluded_unconfirmed: number;
    excluded_snoozed: number;
    excluded_processing_restricted: number;
    excluded_suppressed: number;
    excluded_invalid_email: number;
    excluded_deleted: number;
    excluded_sample: number;
    duplicates_removed: number;
  };
  sample: AudienceSampleRow[];
  computed_at: string;
  /** false, kdyz dotaz spadl na 5s strop a cislo je odhad z EXPLAIN. */
  exact: boolean;
};

/**
 * Cislo v radku Publikum, cislo na tlacitku, cislo v potvrzovacim dialogu a cislo
 * v rozpadu segmentu pochazeji z JEDNOHO volani (cast 6, 8.6.2). Kontrolni seznam
 * nesmi spocitat publikum sam; drive se dve obrazovky nad tymz segmentem rozchazely
 * o 24 lidi a rozdil byl prave na tlacitku, ktere spousti nevratnou akci.
 */
export function buildPreview(input: {
  gates: AudienceGateCounts;
  sample: AudienceSampleRow[];
  exact: boolean;
  computedAt: Date;
  bySelection?: { from_lists: number; from_segments: number; excluded_by_lists: number; excluded_by_segments: number };
}): AudiencePreview {
  const s = input.bySelection ?? { from_lists: 0, from_segments: 0, excluded_by_lists: 0, excluded_by_segments: 0 };
  return {
    total: input.gates.eligible,
    breakdown: {
      from_lists: s.from_lists,
      from_segments: s.from_segments,
      excluded_by_lists: s.excluded_by_lists,
      excluded_by_segments: s.excluded_by_segments,
      excluded_unsubscribed: input.gates.excluded_unsubscribed,
      excluded_unconfirmed: input.gates.excluded_unconfirmed,
      excluded_snoozed: input.gates.excluded_snoozed,
      excluded_processing_restricted: input.gates.excluded_processing_restricted,
      excluded_suppressed: input.gates.excluded_suppressed,
      excluded_invalid_email: input.gates.excluded_invalid_email,
      excluded_deleted: input.gates.excluded_deleted,
      excluded_sample: input.gates.excluded_sample,
      duplicates_removed: input.gates.duplicates_removed,
    },
    sample: input.sample.slice(0, AUDIENCE_PREVIEW_SAMPLE_SIZE),
    computed_at: input.computedAt.toISOString(),
    exact: input.exact,
  };
}
```

```ts
// packages/core/src/campaigns/repo/audience.ts
import { pgErrorCode, withReadOnly, type WorkspaceContext } from '@mlain/core/tx';
import { AUDIENCE_PREVIEW_TIMEOUT_MS } from '../constants.js';
import { rawSql } from './raw-sql.js';

/**
 * Nahled bezi se SET LOCAL statement_timeout. Kdyz spadne na timeout, vratime odhad
 * z EXPLAIN nad tymz dotazem a exact: false, plus text "Presny pocet spocitame pri
 * odeslani". Uzivatel nikdy neceka na nahled dele nez 5 sekund.
 */
/**
 * Presny pocet publika se stropem doby behu, s odhadem jako zachrannou sití.
 *
 * Tri veci tady jsou opravou tri samostatnych vad predchozi podoby a kazda z nich je
 * overena spustenim.
 *
 * 1. **`withReadOnly`, ne `withWorkspace`.** `where.sql` je text, ktery vyrobil
 *    kompilator segmentu, tedy cizi kod. P04 navrhl `withReadOnly` (`BEGIN READ ONLY`
 *    plus `statement_timeout`) presne pro tenhle pripad, aby chyba v kompilatoru nemela
 *    jak zapsat. Predchozi podoba to nahradila zapisovatelnou transakci a rucnim
 *    `SET LOCAL`, tedy slabsi variantou obojiho.
 * 2. **SQLSTATE pres `pgErrorCode`.** Podminka `(err as {code}).code !== '57014'` je
 *    pres Drizzle VZDY pravdiva, protoze `err.code` je `undefined`. Odhad se tedy
 *    nikdy nespocital a uzivatel misto priblizneho cisla dostal chybu.
 * 3. **`EXPLAIN` v NOVE transakci.** Po `query_canceled` je puvodni transakce ve stavu
 *    aborted a jakykoliv dalsi prikaz v ni skonci chybou 25P02
 *    `current transaction is aborted`. Odhad tedy musel selhat i tehdy, kdyby se k nemu
 *    kod vubec dostal.
 */
export async function countWithTimeout(
  ctx: WorkspaceContext,
  where: { sql: string; params: unknown[] },
  timeoutMs: number,
): Promise<{ count: number; exact: boolean }> {
  const text = `SELECT count(*)::int AS n FROM contacts c WHERE c.workspace_id = $1 AND (${where.sql})`;
  const params = [ctx.workspaceId, ...where.params];

  try {
    return await withReadOnly(ctx, timeoutMs, async (tx) => {
      const r = await tx.execute<{ n: number }>(rawSql(text, params));
      return { count: r.rows[0]?.n ?? 0, exact: true };
    });
  } catch (err) {
    if (pgErrorCode(err) !== '57014') throw err; // query_canceled
  }

  // Samostatna transakce: ta predchozi je po timeoutu aborted.
  return withReadOnly(ctx, timeoutMs, async (tx) => {
    const plan = await tx.execute<{ 'QUERY PLAN': unknown }>(rawSql(
      `EXPLAIN (FORMAT JSON) ${text}`, params,
    ));
    return { count: estimateFromPlan(plan.rows[0]?.['QUERY PLAN']), exact: false };
  });
}

function estimateFromPlan(plan: unknown): number {
  const node = (plan as Array<{ Plan?: { 'Plan Rows'?: number } }> | undefined)?.[0]?.Plan;
  return Math.max(0, Math.round(node?.['Plan Rows'] ?? 0));
}

/** Take dynamicky slozene SQL, tedy take jen pro cteni a se stropem doby behu. */
export async function sampleAudience(
  ctx: WorkspaceContext,
  where: { sql: string; params: unknown[] },
  limit: number,
  timeoutMs: number = AUDIENCE_PREVIEW_TIMEOUT_MS,
): Promise<Array<{ contact_id: string; email: string; first_name: string | null }>> {
  return withReadOnly(ctx, timeoutMs, async (tx) => {
    const r = await tx.execute<{ contact_id: string; email: string; first_name: string | null }>(rawSql(
      `SELECT c.id AS contact_id, c.email, c.first_name
         FROM contacts c
        WHERE c.workspace_id = $1 AND (${where.sql})
        ORDER BY c.id
        LIMIT ${Number(limit)}`,
      [ctx.workspaceId, ...where.params],
    ));
    return r.rows;
  });
}
```

- [ ] **Step 4: Spustit obojí**

Run: `pnpm --filter @mlain/core test:unit -- preview && pnpm --filter @mlain/core test:db -- audience`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/campaigns/audience/preview.ts packages/core/src/campaigns/repo/audience.ts packages/core/src/campaigns/audience/__tests__/preview.test.ts
git commit -m "feat(campaigns): audience preview with 5s cap and single-source breakdown"
```

---

### Fáze C: materializace publika do outboxu

#### Úkol 12: Krok 1 materializace a obnova po pádu workeru

**Files:**
- Create: `packages/core/src/campaigns/materialize/plan.ts`
- Create: `packages/core/src/campaigns/repo/audience-progress.ts`
- Test: `packages/core/src/campaigns/materialize/__tests__/plan.test.ts`

- [ ] **Step 1: Napsat padající test rozhodovací tabulky**

```ts
// packages/core/src/campaigns/materialize/__tests__/plan.test.ts
import { describe, expect, it } from 'vitest';
import { decideAfterFailedClaim } from '../plan';

describe('co udela job, kdyz prechod do queueing nevrati radek', () => {
  it.each(['queueing', 'sending'] as const)('stav %s: pokracuje od kurzoru', (status) => {
    expect(decideAfterFailedClaim(status)).toEqual({ action: 'continue' });
  });

  it('paused: skonci, materializaci znovu posle az resume', () => {
    expect(decideAfterFailedClaim('paused')).toEqual({ action: 'stop', level: 'info' });
  });

  it.each(['cancelled', 'failed', 'sent', 'partially_sent'] as const)(
    'stav %s: no-op, je to opozdeny duplikat jobu',
    (status) => {
      expect(decideAfterFailedClaim(status)).toEqual({ action: 'noop' });
    },
  );

  it.each(['draft', 'scheduled', 'schedule_missed'] as const)(
    'stav %s: skonci a zaloguje warn, nekdo kampan vratil zpatky',
    (status) => {
      expect(decideAfterFailedClaim(status)).toEqual({ action: 'stop', level: 'warn' });
    },
  );

  it('nikdy nevrati action continue pro stav mimo odesilaci dvojici', () => {
    const nonContinue = ['paused', 'cancelled', 'failed', 'sent', 'partially_sent', 'draft'] as const;
    for (const s of nonContinue) expect(decideAfterFailedClaim(s).action).not.toBe('continue');
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:unit -- materialize/plan`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napsat rozhodování a repository postupu**

```ts
// packages/core/src/campaigns/materialize/plan.ts
import type { KnownCampaignStatus } from '../types';

export type ClaimDecision =
  | { action: 'continue' }
  | { action: 'stop'; level: 'info' | 'warn' }
  | { action: 'noop' };

/**
 * Krok 1 materializace je podmineny UPDATE do queueing. Kdyz nevrati radek, job
 * NESMI skoncit. Drivejsi zneni rikalo "druhy pokus nevrati radek a job skonci"
 * a bylo to nebezpecne spatne: po padu workeru je kampan uz ve stavu queueing,
 * druhy pokus tedy nikdy radek nevrati, job by skoncil a kampan by v queueing
 * zustala trcet navzdy. Akceptacni kriterium 10 by neslo splnit.
 */
export function decideAfterFailedClaim(status: KnownCampaignStatus): ClaimDecision {
  switch (status) {
    case 'queueing':
    case 'sending':
      return { action: 'continue' };
    case 'paused':
      return { action: 'stop', level: 'info' };
    case 'cancelled':
    case 'failed':
    case 'sent':
    case 'partially_sent':
      return { action: 'noop' };
    default:
      return { action: 'stop', level: 'warn' };
  }
}
```

```ts
// packages/core/src/campaigns/repo/audience-progress.ts
import { withWorkspace, type WorkspaceContext } from '@mlain/core/tx';
import { rawSql } from './raw-sql.js';

export type AudienceProgress = {
  campaign_id: string;
  phase: 'collecting' | 'materializing' | 'done';
  cursor_contact_id: string | null;
  inserted_rows: number;
  skipped_suppressed: number;
  skipped_unsubscribed: number;
  skipped_invalid: number;
};

export const ZERO_UUID = '00000000-0000-0000-0000-000000000000';

/**
 * Krok 1, jednou na kampan, atomicky. audience_built_at se nastavuje pres COALESCE,
 * takze opakovani ho nezmeni, a zaokrouhluje se na cele sekundy: invariant I1 kontraktu
 * na tom stoji a trackovaci token potrebuje hodnotu reprezentovatelnou jako uint32.
 *
 * TYMZ dotazem se pocita `release_at`, tedy konec okna na zruseni odeslani. Je to
 * jedine misto v celem plánu, kde ta hodnota vznika. Predchozi podoba ji cekala
 * v `deps.config.releaseAt`, kam ji nikdy nikdo nezapsal, takze `undoState` dostaval
 * vzdy null, vracel `canUndo: false` a rozhodnuti D12 potvrzene zadavatelem bylo
 * fakticky nezapojene. Nic pritom nespadlo, tlacitko se jen nikdy neobjevilo.
 *
 * Pocita se ze stejneho `now()` jako `audience_built_at`, aby okno zacinalo presne
 * tam, kde vznika publikum, a `COALESCE` zajistuje, ze opakovany beh okno neposune.
 */
export async function startMaterialization(
  ctx: WorkspaceContext,
  campaignId: string,
  undoWindowSeconds: number,
): Promise<{ audienceBuiltAt: string | null; releaseAt: string | null; claimed: boolean }> {
  return withWorkspace(ctx, async (tx) => {
    const claim = await tx.execute<{ audience_built_at: string; release_at: string | null }>(rawSql(
      `UPDATE campaigns
          SET status = 'queueing',
              audience_built_at = COALESCE(audience_built_at, date_trunc('second', now())),
              release_at = COALESCE(
                release_at,
                CASE WHEN $3::int > 0
                     THEN date_trunc('second', now()) + ($3::int || ' seconds')::interval
                END),
              started_at = COALESCE(started_at, now()),
              updated_at = now()
        WHERE id = $1 AND workspace_id = $2
          AND status IN ('draft','scheduled','schedule_missed')
        RETURNING audience_built_at, release_at`,
      [campaignId, ctx.workspaceId, undoWindowSeconds],
    ));

    await tx.execute(rawSql(
      `INSERT INTO campaign_audience_progress (campaign_id, workspace_id, phase)
       VALUES ($1, $2, 'materializing')
       ON CONFLICT (campaign_id) DO NOTHING`,
      [campaignId, ctx.workspaceId],
    ));

    if (claim.rows[0]) {
      return {
        audienceBuiltAt: claim.rows[0].audience_built_at,
        releaseAt: claim.rows[0].release_at,
        claimed: true,
      };
    }

    // Nacteni SELECTem je nutne, ne kosmeticke: bez nej by druhy beh neznal hodnotu
    // invariantu I1 a musel by ji generovat znovu, cimz by vznikla druha sada
    // created_at a unikatni index by duplicity prestal zachytavat.
    const cur = await tx.execute<{
      status: string; audience_built_at: string | null; release_at: string | null;
    }>(rawSql(
      `SELECT status, audience_built_at, release_at FROM campaigns
        WHERE id = $1 AND workspace_id = $2`,
      [campaignId, ctx.workspaceId],
    ));
    return {
      audienceBuiltAt: cur.rows[0]?.audience_built_at ?? null,
      releaseAt: cur.rows[0]?.release_at ?? null,
      claimed: false,
    };
  });
}

export async function getProgress(
  ctx: WorkspaceContext,
  campaignId: string,
): Promise<AudienceProgress | null> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<AudienceProgress>(rawSql(
      `SELECT * FROM campaign_audience_progress WHERE campaign_id = $1 AND workspace_id = $2`,
      [campaignId, ctx.workspaceId],
    ));
    return r.rows[0] ?? null;
  });
}

/**
 * Uklada rozpad po branach na DVE mista, a je to zamerne.
 *
 * `campaign_audience_progress` ma jen tri agregaty a slouzi UKAZATELI POSTUPU. Rozsirovat
 * ho o dalsich osm sloupcu nema smysl: je to provozni tabulka, ktera po dokonceni
 * materializace uz nikoho nezajima.
 *
 * `campaigns.audience_breakdown` dostane CELY jedenactiklicovy rozpad a slouzi REPORTU.
 * Bez nej by byl ten sloupec mrtvy (v predchozi podobe plánu do nej nikdo nezapisoval
 * ani jednou) a radek "Vyloučeno" v kontrolnim seznamu by musel byt souhrnny, coz
 * cast 6 v 8.6.2 vyslovne zakazuje.
 *
 * Obojí v JEDNE transakci: dve cisla o temze publiku, ktera se muzou rozejit, jsou horsi
 * nez jedno.
 */
export async function setGateCounters(
  ctx: WorkspaceContext,
  campaignId: string,
  gates: AudienceGateCounts,
): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    await tx.execute(rawSql(
      `UPDATE campaign_audience_progress
          SET skipped_suppressed = $3, skipped_unsubscribed = $4, skipped_invalid = $5,
              updated_at = now()
        WHERE campaign_id = $1 AND workspace_id = $2`,
      [
        campaignId, ctx.workspaceId,
        gates.excluded_suppressed,
        // Ctyri brany, ktere uzivatel vnima jako "neodebira", do jednoho ukazatele postupu.
        // Pojmenovany rozpad zustava v audience_breakdown, tady jde jen o pruben zpetnou vazbu.
        gates.excluded_unsubscribed + gates.excluded_unconfirmed +
          gates.excluded_snoozed + gates.excluded_processing_restricted,
        gates.excluded_invalid_email,
      ],
    ));
    await tx.execute(rawSql(
      `UPDATE campaigns
          SET audience_breakdown = $3::jsonb, audience_size = $4, updated_at = now()
        WHERE id = $1 AND workspace_id = $2`,
      [campaignId, ctx.workspaceId, JSON.stringify(gates), gates.eligible],
    ));
  });
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:unit -- materialize/plan`
Expected: PASS, 11 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/campaigns/materialize/plan.ts packages/core/src/campaigns/repo/audience-progress.ts packages/core/src/campaigns/materialize/__tests__/plan.test.ts
git commit -m "feat(campaigns): materialization step 1 with crash recovery decision table"
```

---

#### Úkol 13: Materializační dávka, invariant I1 a kontrola stavu po dávce

**Files:**
- Create: `packages/core/src/campaigns/repo/outbox.ts`
- Test: `packages/core/src/campaigns/repo/__tests__/outbox-materialize.db.test.ts`

- [ ] **Step 1: Napsat padající test proti databázi**

```ts
// packages/core/src/campaigns/repo/__tests__/outbox-materialize.db.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { COMPILED_ONLY_ROOTS } from '@mlain/contracts/liquid/roots';
import { withTestWorkspace, seedCampaign, seedContacts, seedList } from '../../../testing/harness';
import { materializeBatch, type RenderPlan } from '../outbox';
import { startMaterialization } from '../audience-progress';
import { withWorkspace } from '@mlain/core/tx';
import { rawSql } from '../raw-sql';

/** Sablona bez merge tagu a bez podminek. */
const EMPTY_RENDER_PLAN: RenderPlan = { usedPaths: [], preparedSchema: { fields: [], presence: [] } };

describe('materializacni davka', () => {
  let ctx: Awaited<ReturnType<typeof withTestWorkspace>>;
  beforeEach(async () => { ctx = await withTestWorkspace(); });

  it('vsechny radky maji identicke created_at rovne audience_built_at (invariant I1)', async () => {
    const list = await seedList(ctx);
    await seedContacts(ctx, { count: 1000, list });
    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list] });
    const { audienceBuiltAt } = await startMaterialization(ctx.workspace, id, 0);

    let cursor = '00000000-0000-0000-0000-000000000000';
    for (let i = 0; i < 3; i++) {
      const r = await materializeBatch(ctx.workspace, {
        campaignId: id, audienceBuiltAt: audienceBuiltAt!, cursor,
        batchSize: 500, where: { sql: 'true', params: [] },
        renderPlan: { usedPaths: ['contact.first_name'], preparedSchema: { fields: ['contact.first_name'], presence: [] } },
        sampleContactIds: [], releaseAt: null,
      });
      if (!r.nextCursor) break;
      cursor = r.nextCursor;
    }

    const rows = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ n: number }>(rawSql(
        `SELECT count(DISTINCT created_at)::int AS n FROM messages WHERE campaign_id = $1`, [id])),
    );
    expect(rows.rows[0].n).toBe(1);
  });

  it('dvoji spusteni nevytvori duplicitni radek', async () => {
    const list = await seedList(ctx);
    await seedContacts(ctx, { count: 50, list });
    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list] });
    const { audienceBuiltAt } = await startMaterialization(ctx.workspace, id, 0);
    const args = {
      campaignId: id, audienceBuiltAt: audienceBuiltAt!, cursor: '00000000-0000-0000-0000-000000000000',
      batchSize: 500, where: { sql: 'true', params: [] }, renderPlan: EMPTY_RENDER_PLAN, sampleContactIds: [], releaseAt: null,
    };
    await materializeBatch(ctx.workspace, args);
    await materializeBatch(ctx.workspace, args);

    const dup = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute(rawSql(`SELECT campaign_id, contact_id, count(*) FROM messages
                 WHERE campaign_id = $1 GROUP BY 1,2 HAVING count(*) > 1`, [id])),
    );
    expect(dup.rows).toHaveLength(0);
  });

  it('zapisuje kind = campaign a nikdy prazdny campaign_id', async () => {
    const list = await seedList(ctx);
    await seedContacts(ctx, { count: 5, list });
    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list] });
    const { audienceBuiltAt } = await startMaterialization(ctx.workspace, id, 0);
    await materializeBatch(ctx.workspace, {
      campaignId: id, audienceBuiltAt: audienceBuiltAt!, cursor: '00000000-0000-0000-0000-000000000000',
      batchSize: 500, where: { sql: 'true', params: [] }, renderPlan: EMPTY_RENDER_PLAN, sampleContactIds: [], releaseAt: null,
    });
    const r = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ kind: string; campaign_id: string | null }>(rawSql(
        `SELECT kind, campaign_id FROM messages WHERE campaign_id = $1`, [id])),
    );
    expect(r.rows.every((x) => x.kind === 'campaign' && x.campaign_id !== null)).toBe(true);
  });

  it('undo okno nastavi next_attempt_at na release_at, ne na audience_built_at', async () => {
    const list = await seedList(ctx);
    await seedContacts(ctx, { count: 3, list });
    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list] });
    const { audienceBuiltAt } = await startMaterialization(ctx.workspace, id, 0);
    const release = new Date(Date.parse(audienceBuiltAt!) + 60_000).toISOString();
    await materializeBatch(ctx.workspace, {
      campaignId: id, audienceBuiltAt: audienceBuiltAt!, cursor: '00000000-0000-0000-0000-000000000000',
      batchSize: 500, where: { sql: 'true', params: [] }, renderPlan: EMPTY_RENDER_PLAN, sampleContactIds: [], releaseAt: release,
    });
    const r = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ next_attempt_at: string }>(rawSql(
        `SELECT next_attempt_at FROM messages WHERE campaign_id = $1 LIMIT 1`, [id])),
    );
    expect(Date.parse(r.rows[0].next_attempt_at) - Date.parse(audienceBuiltAt!)).toBe(60_000);
  });

  it('render_data ma koren _present, jinak by se podminene bloky tise skryly', async () => {
    const list = await seedList(ctx);
    // Dva kontakty: jeden s vyplnenym mestem, druhy se samymi mezerami.
    await seedContacts(ctx, { count: 1, list, attributes: { city: 'Brno' }, email: 'a@example.cz' });
    await seedContacts(ctx, { count: 1, list, attributes: { city: '   ' }, email: 'b@example.cz' });
    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list] });
    const { audienceBuiltAt } = await startMaterialization(ctx.workspace, id, 0);

    await materializeBatch(ctx.workspace, {
      campaignId: id, audienceBuiltAt: audienceBuiltAt!,
      cursor: '00000000-0000-0000-0000-000000000000', batchSize: 500,
      where: { sql: 'true', params: [] },
      renderPlan: {
        usedPaths: ['contact.attr.city'],
        preparedSchema: { fields: ['contact.attr.city'], presence: ['contact.attr.city'] },
      },
      sampleContactIds: [],
      releaseAt: null,
    });

    const r = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ email: string; render_data: Record<string, unknown> }>(rawSql(
        `SELECT email, render_data FROM messages WHERE campaign_id = $1 ORDER BY email`, [id])),
    );

    // Jmeno korene se bere z kontraktu, ne z konstanty P13: test se schvalne
    // NEPTA tehoz zdroje, ze ktereho ochrana vznikla.
    const root = COMPILED_ONLY_ROOTS[0]!;
    expect(root).toBe('_present');

    const present = (row: { render_data: Record<string, unknown> }) =>
      (row.render_data[root] ?? {}) as Record<string, boolean>;

    expect(present(r.rows[0]!)).toHaveProperty('contact__attr__city');
    expect(present(r.rows[0]!).contact__attr__city).toBe(true);
    // Past prazdneho retezce: same mezery nejsou vyplnena hodnota.
    expect(present(r.rows[1]!).contact__attr__city).toBe(false);
    // Kdyby prepareRenderData nikdo nezavolal, oba radky by mely render_data BEZ
    // _present, kazda podminka by vysla nepravdive a blok by zmizel VZDY.
  });

  it('prilis velka render_data delaji radek skipped, ne nafouknuty outbox', async () => {
    const list = await seedList(ctx);
    await seedContacts(ctx, { count: 1, list, attributes: { bio: 'x'.repeat(9000) } });
    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list] });
    const { audienceBuiltAt } = await startMaterialization(ctx.workspace, id, 0);

    const out = await materializeBatch(ctx.workspace, {
      campaignId: id, audienceBuiltAt: audienceBuiltAt!,
      cursor: '00000000-0000-0000-0000-000000000000', batchSize: 500,
      where: { sql: 'true', params: [] },
      renderPlan: {
        usedPaths: ['contact.attr.bio'],
        preparedSchema: { fields: ['contact.attr.bio'], presence: [] },
      },
      sampleContactIds: [],
      releaseAt: null,
    });

    expect(out.skippedOversize).toBe(1);
    const r = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ status: string; render_data: unknown }>(rawSql(
        `SELECT status, render_data FROM messages WHERE campaign_id = $1`, [id])),
    );
    expect(r.rows[0]!.status).toBe('skipped');
    expect(r.rows[0]!.render_data).toEqual({});
  });

  it('ukazkovy kontakt se do outboxu nedostane ani pres prazdny filtr publika', async () => {
    const list = await seedList(ctx);
    await seedContacts(ctx, { count: 4, list, sourceRef: 'demo-data:v1' });
    await seedContacts(ctx, { count: 2, list });
    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list] });
    const { audienceBuiltAt } = await startMaterialization(ctx.workspace, id, 0);

    const out = await materializeBatch(ctx.workspace, {
      campaignId: id, audienceBuiltAt: audienceBuiltAt!,
      cursor: '00000000-0000-0000-0000-000000000000', batchSize: 500,
      where: { sql: 'true', params: [] }, renderPlan: EMPTY_RENDER_PLAN, sampleContactIds: [], releaseAt: null,
    });
    expect(out.inserted).toBe(2);
  });

  it('OB-00 lokalne: dotaz projde planovacem i nad prazdnym publikem', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    const { audienceBuiltAt } = await startMaterialization(ctx.workspace, id, 0);
    const r = await materializeBatch(ctx.workspace, {
      campaignId: id, audienceBuiltAt: audienceBuiltAt!, cursor: '00000000-0000-0000-0000-000000000000',
      batchSize: 500, where: { sql: 'false', params: [] }, renderPlan: EMPTY_RENDER_PLAN, sampleContactIds: [], releaseAt: null,
    });
    expect(r.inserted).toBe(0);
    expect(r.nextCursor).toBeNull();
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:db -- outbox-materialize`
Expected: FAIL, `Cannot find module '../outbox'`.

- [ ] **Step 3: Napsat materializační dotaz**

```ts
// packages/core/src/campaigns/repo/outbox.ts
import { prepareRenderData } from '@mlain/contracts/liquid/prepare-render-data';
import type { PreparedDataSchema } from '@mlain/contracts/liquid/prepare-render-data';
import { withWorkspace, type WorkspaceContext } from '@mlain/core/tx';
import { buildRenderData } from '../audience/render-data.js';
import { SAMPLE_SOURCE_REF_PATTERN } from '../audience/sample-guard.js';
import { rawSql } from './raw-sql.js';

/**
 * Vsechno, co je potreba k slozeni render_data. Bere se z `campaigns.compile_meta`,
 * tedy z vystupu kompilace, NIKDY se nedopocitava podruhe.
 */
export type RenderPlan = {
  /** `CompileMeta.usedPaths`: ktere cesty sablona doopravdy pouziva. */
  usedPaths: readonly string[];
  /** Zuzene `CompileMeta.renderSchema` pres `toPreparedSchema`. Plni mapu `_present`. */
  preparedSchema: PreparedDataSchema;
};

export type MaterializeBatchInput = {
  campaignId: string;
  /** Invariant I1: jedina hodnota created_at pro cely materializacni beh. */
  audienceBuiltAt: string;
  cursor: string;
  batchSize: number;
  /** Vyraz do WHERE, ktery slozil buildAudienceSql z kompilatoru casti 2. */
  where: { sql: string; params: unknown[] };
  renderPlan: RenderPlan;
  /**
   * Identifikatory ukazkovych kontaktu z manifestu P16. Nacita je `loadSampleContactIds`
   * jednou pred smyckou, ne kazda davka. Prazdne pole je bezny stav (projekt bez demo dat).
   */
  sampleContactIds: readonly string[];
  /** Undo okno. Kdyz je null, zpravy jsou k odeslani okamzite. */
  releaseAt: string | null;
  statementTimeoutMs?: number;
};

export type MaterializeBatchResult = {
  scanned: number;
  inserted: number;
  /** Radky, ktere prekrocily strop render_data a vznikly rovnou jako skipped. */
  skippedOversize: number;
  nextCursor: string | null;
};

/**
 * Krok 2 materializace. Bezi po davkach kurzorem pres contacts.id a nikdy v jedne
 * transakci pres cele publikum: transakce nad milionem radku drzi zamky, blokuje
 * VACUUM a pri padu se cela vraci zpet.
 *
 * Davka ma DVE faze a je to zamerne. Puvodni podoba skladala render_data primo v SQL
 * pres `jsonb_build_object`, aby se radky nemusely vozit do Node. Bylo to rychlejsi
 * a bylo to SPATNE: kontraktni `prepareRenderData` z `@mlain/contracts` plni koren
 * `_present`, ze ktereho se vyhodnocuji vsechny podminene bloky, a SQL ho nenaplnilo.
 * Dusledek overeny spustenim: kazda podminka se vyhodnoti jako nepravda a podmineny
 * blok se v odeslanem mailu TISE SKRYJE. Nespadne pritom nic, kompilace projde,
 * odeslani projde a testy obou stran projdou. Je to pozadavek R11 plánu P08.
 * Druhotne se tim take opravilo, ze se v SQL vubec nekontroloval strop render_data,
 * ze se cisla nad 2^53 neprevadela na retezec a ze se pole neorezavala na 200 polozek.
 *
 * Cena je jeden roundtrip navic NA DAVKU, ne na radek. Pri davce 5000 je to u milionoveho
 * publika 200 roundtripu, coz je proti dobe samotneho INSERTu zanedbatelne.
 *
 * Pozor na ctyri veci, ktere vypadaji jako detail a nejsou:
 *  - created_at se zapisuje EXPLICITNE hodnotou audience_built_at, nikdy DEFAULT now().
 *  - ON CONFLICT musi uvest VSECHNY TRI sloupce indexu. Uvedeni jen dvou neni ticha
 *    chyba, ale tvrdy ERROR a materializace by neprobehla vubec.
 *  - id se v seznamu sloupcu nevyskytuje schvalne, doplni ho DEFAULT uuidv7() v Postgresu 18.
 *  - obe faze bezi v JEDNE transakci, takze kandidat vybrany fazi 1 nemuze mezitim zmizet.
 */
export async function materializeBatch(
  ctx: WorkspaceContext,
  input: MaterializeBatchInput,
): Promise<MaterializeBatchResult> {
  // $1..$5 jsou pevne, poddotaz publika zacina od $6.
  //
  // Ukazkove kontakty vypadavaji DVEMA nezavislymi podminkami a obe jsou nutne:
  // manifest ($4) je autoritativni pro rozsah sady a prezije to, ze uzivatel kontakt
  // upravi, znacka ($3) chyti kontakty mimo manifest (starsi pokoleni, obnova ze zalohy).
  // Overeno spustenim: jen se znackou propustil filtr deset z padesati.
  const SELECT_SQL = `
    SELECT c.id, c.email, c.first_name, c.last_name, c.first_name_vocative,
           c.greeting, c.attributes
      FROM contacts c
     WHERE c.workspace_id = $1
       AND c.id > $2
       AND c.status = 'active'
       AND c.deleted_at IS NULL
       AND c.email IS NOT NULL AND c.email <> ''
       AND coalesce(c.source_ref, '') NOT LIKE $3
       AND NOT (c.id = ANY($4::uuid[]))
       AND (${input.where.sql})
     ORDER BY c.id
     LIMIT $5`;

  const INSERT_SQL = `
    INSERT INTO messages (
      workspace_id, campaign_id, contact_id, kind, email,
      render_data, status, next_attempt_at, created_at
    )
    SELECT $1, $2, x.contact_id, 'campaign', x.email,
           x.render_data, x.status,
           COALESCE($4::timestamptz, $3::timestamptz),
           $3::timestamptz
      FROM unnest($5::uuid[], $6::text[], $7::jsonb[], $8::text[])
        AS x(contact_id, email, render_data, status)
    ON CONFLICT (campaign_id, contact_id, created_at) DO NOTHING
    RETURNING contact_id`;

  return withWorkspace(ctx, async (tx) => {
    if (input.statementTimeoutMs) {
      await tx.execute(rawSql(`SET LOCAL statement_timeout = ${Number(input.statementTimeoutMs)}`, []));
    }

    // Faze 1: kandidati.
    const candidates = await tx.execute<ContactRow>(
      rawSql(SELECT_SQL, [
        ctx.workspaceId,               // $1
        input.cursor,                  // $2
        SAMPLE_SOURCE_REF_PATTERN,     // $3
        input.sampleContactIds,        // $4, jedno POLE, ne rozlozene hodnoty
        input.batchSize,               // $5
        ...input.where.params,         // $6 a dal
      ]),
    );
    const rows = candidates.rows;
    if (rows.length === 0) {
      return { scanned: 0, inserted: 0, skippedOversize: 0, nextCursor: null };
    }

    // Faze 2: priprava dat pro render. TOHLE je misto, kde vznika koren `_present`.
    const contactIds: string[] = [];
    const emails: string[] = [];
    const renderData: string[] = [];
    const statuses: string[] = [];
    let skippedOversize = 0;

    for (const row of rows) {
      // Krok 1: snapshot hodnot kontaktu podle `usedPaths` a strop 8 kB (ukol 10).
      const snapshot = buildRenderData(row, input.renderPlan.usedPaths);
      if (snapshot.tooLarge) {
        // Prilis velka data se NEUKLADAJI: radek vznika rovnou jako skipped s prazdnymi
        // daty, aby jedna patologicka hodnota atributu nenafoukla cely outbox.
        skippedOversize += 1;
        contactIds.push(row.id);
        emails.push(row.email.toLowerCase());
        renderData.push('{}');
        statuses.push('skipped');
        continue;
      }

      // Krok 2: kontraktni priprava. Doplni `_context` a hlavne mapu `_present`,
      // normalizuje cisla nad 2^53 na retezec a oreze pole na strop iteraci.
      // Bez tohohle volani se KAZDY podmineny blok v odeslanem mailu tise skryje.
      const prepared = prepareRenderData(snapshot.data, input.renderPlan.preparedSchema);

      contactIds.push(row.id);
      emails.push(row.email.toLowerCase());
      renderData.push(JSON.stringify(prepared));
      statuses.push('pending');
    }

    const inserted = await tx.execute<{ contact_id: string }>(
      rawSql(INSERT_SQL, [
        ctx.workspaceId,           // $1
        input.campaignId,          // $2
        input.audienceBuiltAt,     // $3
        input.releaseAt,           // $4
        contactIds,                // $5
        emails,                    // $6
        renderData,                // $7
        statuses,                  // $8
      ]),
    );

    return {
      scanned: rows.length,
      inserted: inserted.rows.length,
      skippedOversize,
      nextCursor: rows[rows.length - 1]!.id,
    };
  });
}

type ContactRow = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  first_name_vocative: string | null;
  greeting: string | null;
  attributes: Record<string, unknown> | null;
};
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:db -- outbox-materialize`
Expected: PASS, 5 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/campaigns/repo/outbox.ts packages/core/src/campaigns/repo/__tests__/outbox-materialize.db.test.ts
git commit -m "feat(db): materialization batch honouring invariant I1 and three-column ON CONFLICT"
```

---

#### Úkol 14: Smyčka materializace, kurzor a zastavení podle stavu kampaně

**Files:**
- Create: `packages/core/src/campaigns/materialize/loop.ts`
- Test: `packages/core/src/campaigns/materialize/__tests__/loop.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/campaigns/materialize/__tests__/loop.test.ts
import { describe, expect, it, vi } from 'vitest';
import { runMaterializeLoop, type LoopDeps } from '../loop';

function deps(over: Partial<LoopDeps> = {}): LoopDeps {
  return {
    batch: vi.fn(async () => ({ scanned: 10, inserted: 10, nextCursor: 'c-next' })),
    advanceCursor: vi.fn(async () => {}),
    readStatus: vi.fn(async () => 'queueing' as const),
    now: () => new Date(0),
    cleanupCancelled: vi.fn(async () => 0),
    log: vi.fn(),
    ...over,
  };
}

const base = {
  campaignId: 'k1', audienceBuiltAt: '2026-08-01T00:00:00.000Z', startCursor: '00000000-0000-0000-0000-000000000000',
  batchSize: 500, maxMinutes: 60, where: { sql: 'true', params: [] },
  renderPlan: EMPTY_RENDER_PLAN, sampleContactIds: [], releaseAt: null,
};

describe('smycka materializace', () => {
  it('konci, kdyz davka vrati prazdny kurzor', async () => {
    const d = deps({ batch: vi.fn(async () => ({ scanned: 0, inserted: 0, nextCursor: null })) });
    const r = await runMaterializeLoop(d, base);
    expect(r.outcome).toBe('completed');
  });

  it('po kazde davce se ptá na stav kampane', async () => {
    const d = deps({
      batch: vi.fn()
        .mockResolvedValueOnce({ scanned: 10, inserted: 10, nextCursor: 'a' })
        .mockResolvedValueOnce({ scanned: 0, inserted: 0, nextCursor: null }),
    });
    await runMaterializeLoop(d, base);
    expect(d.readStatus).toHaveBeenCalledTimes(2);
  });

  it('pri paused se zastavi a kurzor zustane', async () => {
    const d = deps({ readStatus: vi.fn(async () => 'paused' as const) });
    const r = await runMaterializeLoop(d, base);
    expect(r.outcome).toBe('paused');
    expect(d.advanceCursor).toHaveBeenCalled();
  });

  it('pri cancelled se zastavi A ZNOVU SPUSTI uklid', async () => {
    const d = deps({ readStatus: vi.fn(async () => 'cancelled' as const) });
    const r = await runMaterializeLoop(d, base);
    expect(r.outcome).toBe('cancelled');
    expect(d.cleanupCancelled).toHaveBeenCalledTimes(1);
  });

  it('po prekroceni stropu vraci timeout, ne nekonecnou smycku', async () => {
    let t = 0;
    const d = deps({ now: () => new Date(t += 61 * 60 * 1000) });
    const r = await runMaterializeLoop(d, { ...base, maxMinutes: 60 });
    expect(r.outcome).toBe('timeout');
  });

  it('neznamy stav zastavi a zaloguje warn', async () => {
    const d = deps({ readStatus: vi.fn(async () => 'draft' as const) });
    const r = await runMaterializeLoop(d, base);
    expect(r.outcome).toBe('aborted');
    expect(d.log).toHaveBeenCalledWith('warn', expect.any(String), expect.anything());
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:unit -- materialize/loop`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napsat smyčku**

```ts
// packages/core/src/campaigns/materialize/loop.ts
import type { KnownCampaignStatus } from '../types';

export type LoopDeps = {
  batch(input: {
    campaignId: string; audienceBuiltAt: string; cursor: string; batchSize: number;
    where: { sql: string; params: unknown[] }; renderPlan: RenderPlan;
    sampleContactIds: readonly string[]; releaseAt: string | null;
  }): Promise<{ scanned: number; inserted: number; nextCursor: string | null }>;
  advanceCursor(input: { campaignId: string; cursor: string; inserted: number }): Promise<void>;
  readStatus(campaignId: string): Promise<KnownCampaignStatus>;
  cleanupCancelled(campaignId: string): Promise<number>;
  now(): Date;
  log(level: 'info' | 'warn' | 'error', msg: string, meta?: unknown): void;
};

export type LoopOutcome = 'completed' | 'paused' | 'cancelled' | 'timeout' | 'aborted';

export async function runMaterializeLoop(
  deps: LoopDeps,
  input: {
    campaignId: string; audienceBuiltAt: string; startCursor: string; batchSize: number;
    maxMinutes: number; where: { sql: string; params: unknown[] }; renderPlan: RenderPlan;
    sampleContactIds: readonly string[];
    releaseAt: string | null;
  },
): Promise<{ outcome: LoopOutcome; inserted: number; cursor: string }> {
  const deadline = deps.now().getTime() + input.maxMinutes * 60_000;
  let cursor = input.startCursor;
  let inserted = 0;

  for (;;) {
    const r = await deps.batch({
      campaignId: input.campaignId, audienceBuiltAt: input.audienceBuiltAt, cursor,
      batchSize: input.batchSize, where: input.where, renderPlan: input.renderPlan,
      sampleContactIds: input.sampleContactIds,
      releaseAt: input.releaseAt,
    });
    inserted += r.inserted;
    if (r.nextCursor) {
      cursor = r.nextCursor;
      await deps.advanceCursor({ campaignId: input.campaignId, cursor, inserted: r.inserted });
    }

    /**
     * Kontrola stavu po kazde davce NENI optimalizace, je to jedina ochrana proti
     * zavodu z 3.6.3.1: bez ni bezici davka po uklidu zrusene kampane vlozi dalsi
     * pending radky, ktere uz nikdo neclaimne a ktere navecky brani odpojeni oddilu.
     */
    const status = await deps.readStatus(input.campaignId);
    if (status === 'paused') return { outcome: 'paused', inserted, cursor };
    if (status === 'cancelled') {
      // Kontrola stavu i zastaveni smycky jsou samy o sobe zavod: mezi kontrolou
      // a koncem davky se da stihnout dalsi INSERT. Uklid se proto opakuje.
      await deps.cleanupCancelled(input.campaignId);
      return { outcome: 'cancelled', inserted, cursor };
    }
    if (status !== 'queueing' && status !== 'sending') {
      deps.log('warn', 'materializace zastavena, kampan je v neocekavanem stavu', {
        campaignId: input.campaignId, status,
      });
      return { outcome: 'aborted', inserted, cursor };
    }

    if (!r.nextCursor) return { outcome: 'completed', inserted, cursor };

    if (deps.now().getTime() > deadline) {
      return { outcome: 'timeout', inserted, cursor };
    }
  }
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:unit -- materialize/loop`
Expected: PASS, 6 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/campaigns/materialize/loop.ts packages/core/src/campaigns/materialize/__tests__/loop.test.ts
git commit -m "feat(campaigns): materialization loop with per-batch status check and cancel cleanup"
```

---

#### Úkol 15: Krok 3, uzavření materializace

**Files:**
- Create: `packages/core/src/campaigns/materialize/finish.ts`
- Modify: `packages/core/src/campaigns/repo/audience-progress.ts` (přidat `finishMaterialization`)
- Test: `packages/core/src/campaigns/repo/__tests__/materialize-finish.db.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/campaigns/repo/__tests__/materialize-finish.db.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { withTestWorkspace, seedCampaign, seedContacts, seedList } from '../../../testing/harness';
import { startMaterialization, finishMaterialization, getProgress } from '../audience-progress';
import { materializeBatch } from '../outbox';
import { getCampaign } from '../campaign';

describe('krok 3 materializace', () => {
  let ctx: Awaited<ReturnType<typeof withTestWorkspace>>;
  beforeEach(async () => { ctx = await withTestWorkspace(); });

  it('nastavi sending, total_count z messages a audience_size z postupu', async () => {
    const list = await seedList(ctx);
    await seedContacts(ctx, { count: 7, list });
    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list] });
    const { audienceBuiltAt } = await startMaterialization(ctx.workspace, id, 0);
    await materializeBatch(ctx.workspace, {
      campaignId: id, audienceBuiltAt: audienceBuiltAt!, cursor: '00000000-0000-0000-0000-000000000000',
      batchSize: 500, where: { sql: 'true', params: [] }, renderPlan: EMPTY_RENDER_PLAN, sampleContactIds: [], releaseAt: null,
    });
    await finishMaterialization(ctx.workspace, id, audienceBuiltAt!);

    const c = await getCampaign(ctx.workspace, id);
    expect(c!.status).toBe('sending');
    expect(c!.total_count).toBe(7);
    expect((await getProgress(ctx.workspace, id))!.phase).toBe('done');
  });

  it('total_count pocita jen radky s created_at = audience_built_at', async () => {
    const list = await seedList(ctx);
    await seedContacts(ctx, { count: 3, list });
    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list] });
    const { audienceBuiltAt } = await startMaterialization(ctx.workspace, id, 0);
    await materializeBatch(ctx.workspace, {
      campaignId: id, audienceBuiltAt: audienceBuiltAt!, cursor: '00000000-0000-0000-0000-000000000000',
      batchSize: 500, where: { sql: 'true', params: [] }, renderPlan: EMPTY_RENDER_PLAN, sampleContactIds: [], releaseAt: null,
    });
    await finishMaterialization(ctx.workspace, id, audienceBuiltAt!);
    expect((await getCampaign(ctx.workspace, id))!.total_count).toBe(3);
  });

  it('opakovane volani je no-op, protoze podminka je status = queueing', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    const { audienceBuiltAt } = await startMaterialization(ctx.workspace, id, 0);
    await finishMaterialization(ctx.workspace, id, audienceBuiltAt!);
    const second = await finishMaterialization(ctx.workspace, id, audienceBuiltAt!);
    expect(second).toBe(false);
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:db -- materialize-finish`
Expected: FAIL, `finishMaterialization is not a function`.

- [ ] **Step 3: Doplnit repository a napsat orchestraci**

```ts
// doplnit do packages/core/src/campaigns/repo/audience-progress.ts
export async function finishMaterialization(
  ctx: WorkspaceContext,
  campaignId: string,
  audienceBuiltAt: string,
): Promise<boolean> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute(rawSql(
      `UPDATE campaigns
          SET status = 'sending',
              total_count = (SELECT count(*) FROM messages
                              WHERE campaign_id = $1 AND created_at = $3::timestamptz
                                AND kind = 'campaign'),
              audience_size = (SELECT inserted_rows FROM campaign_audience_progress
                                WHERE campaign_id = $1),
              updated_at = now()
        WHERE id = $1 AND workspace_id = $2 AND status = 'queueing'`,
      [campaignId, ctx.workspaceId, audienceBuiltAt],
    ));
    if (r.rowCount === 0) return false;
    await tx.execute(rawSql(
      `UPDATE campaign_audience_progress SET phase = 'done', finished_at = now()
        WHERE campaign_id = $1 AND workspace_id = $2`,
      [campaignId, ctx.workspaceId],
    ));
    return true;
  });
}
```

```ts
// packages/core/src/campaigns/materialize/finish.ts

/**
 * Krok 3 ma podminku WHERE status = 'queueing'. Proto se kampan pozastavena BEHEM
 * materializace vraci resume do queueing, ne do sending: kdyby sla do sending,
 * zasahl by tenhle UPDATE nula radku a kampan by navzdy zustala s nulovym total_count,
 * tedy s nesmyslnym ukazatelem prubehu a nefunkcnim uzaviracim pravidlem.
 */
export function shouldRunFinish(outcome: 'completed' | 'paused' | 'cancelled' | 'timeout' | 'aborted'): boolean {
  return outcome === 'completed';
}

export function resumeTarget(phase: 'collecting' | 'materializing' | 'done'): 'queueing' | 'sending' {
  return phase === 'done' ? 'sending' : 'queueing';
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:db -- materialize-finish`
Expected: PASS, 3 testy.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/campaigns/materialize/finish.ts packages/core/src/campaigns/repo/audience-progress.ts packages/core/src/campaigns/repo/__tests__/materialize-finish.db.test.ts
git commit -m "feat(campaigns): materialization step 3 and resume target derivation"
```

---

#### Úkol 16: Job `campaign.materialize`

**Files:**
- Create: `packages/core/src/campaigns/jobs/materialize.ts`
- Test: `packages/core/src/campaigns/jobs/__tests__/materialize.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/campaigns/jobs/__tests__/materialize.test.ts
import { describe, expect, it, vi } from 'vitest';
import { materializeHandler, MATERIALIZE_JOB } from '../materialize';

const RENDER_PLAN = { usedPaths: ['contact.first_name'], preparedSchema: { fields: ['contact.first_name'], presence: [] } };

function harness(over: Record<string, unknown> = {}) {
  return {
    start: vi.fn(async () => ({
      audienceBuiltAt: '2026-08-01T00:00:00.000Z',
      releaseAt: '2026-08-01T00:01:00.000Z',
      claimed: true,
    })),
    readStatus: vi.fn(async () => 'queueing'),
    progress: vi.fn(async () => ({ phase: 'materializing', cursor_contact_id: null, inserted_rows: 0 })),
    compileAudience: vi.fn(async () => ({ sql: 'true', params: [] })),
    countGates: vi.fn(async () => ({
      raw: 10, eligible: 10, excluded_suppressed: 0, excluded_unsubscribed: 0,
      excluded_unconfirmed: 0, excluded_snoozed: 0, excluded_processing_restricted: 0,
      excluded_invalid_email: 0, excluded_deleted: 0, excluded_sample: 0, duplicates_removed: 0,
    })),
    setGateCounters: vi.fn(async () => {}),
    renderPlan: vi.fn(async () => RENDER_PLAN),
    sampleContactIds: vi.fn(async () => []),
    loop: vi.fn(async () => ({ outcome: 'completed' as const, inserted: 10, cursor: 'x' })),
    finish: vi.fn(async () => true),
    pause: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    emit: vi.fn(async () => {}),
    ...over,
  };
}

describe('job campaign.materialize', () => {
  it('ma singletonKey vazany na kampan', () => {
    expect(MATERIALIZE_JOB.singletonKey('k1')).toBe('campaign.materialize:k1');
  });

  it('predava do davky plan pro render, jinak by render_data nemela _present', async () => {
    const h = harness();
    await materializeHandler(h as never, { campaignId: 'k1', workspaceId: 'w1' });
    expect(h.renderPlan).toHaveBeenCalledWith('k1');
    expect(h.loop).toHaveBeenCalledWith(expect.objectContaining({ renderPlan: RENDER_PLAN }));
  });

  it('nezkompilovana kampan se NEMATERIALIZUJE, skonci jako failed', async () => {
    const h = harness({
      renderPlan: vi.fn(async () => { throw new Error('campaign_not_compiled'); }),
    });
    await materializeHandler(h as never, { campaignId: 'k1', workspaceId: 'w1' });
    expect(h.loop).not.toHaveBeenCalled();
    expect(h.fail).toHaveBeenCalledWith('k1', 'campaign_not_compiled');
  });

  it('undo okno se bere ze startu, ne z konfigurace, kterou nikdo neplni', async () => {
    const h = harness();
    await materializeHandler(h as never, { campaignId: 'k1', workspaceId: 'w1' });
    expect(h.loop).toHaveBeenCalledWith(
      expect.objectContaining({ releaseAt: '2026-08-01T00:01:00.000Z' }),
    );
  });

  it('publikum se kompiluje s offsetem 5, jinak by se parametry prekryly', async () => {
    const h = harness();
    await materializeHandler(h as never, { campaignId: 'k1', workspaceId: 'w1' });
    expect(h.compileAudience).toHaveBeenCalledWith(expect.objectContaining({ paramOffset: 5 }));
  });

  it('rozpad bran se uklada CELY, ne slity do tri cisel', async () => {
    const h = harness();
    await materializeHandler(h as never, { campaignId: 'k1', workspaceId: 'w1' });
    const passed = h.setGateCounters.mock.calls[0]![1] as Record<string, number>;
    expect(Object.keys(passed)).toHaveLength(11);
    expect(passed).toHaveProperty('excluded_snoozed');
    expect(passed).toHaveProperty('excluded_sample');
  });

  it('uspesny beh dokonci krok 3 a posle webhook sending_started', async () => {
    const h = harness();
    await materializeHandler(h as never, { campaignId: 'k1', workspaceId: 'w1' });
    expect(h.finish).toHaveBeenCalled();
    expect(h.emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'campaign.sending_started' }));
  });

  it('rozpad bran se ulozi jeste pred prvni davkou', async () => {
    const h = harness();
    await materializeHandler(h as never, { campaignId: 'k1', workspaceId: 'w1' });
    const gatesOrder = h.setGateCounters.mock.invocationCallOrder[0];
    const loopOrder = h.loop.mock.invocationCallOrder[0];
    expect(gatesOrder).toBeLessThan(loopOrder);
  });

  it('timeout prevede kampan do paused s materialize_timeout a source app', async () => {
    const h = harness({ loop: vi.fn(async () => ({ outcome: 'timeout', inserted: 5, cursor: 'x' })) });
    await materializeHandler(h as never, { campaignId: 'k1', workspaceId: 'w1' });
    expect(h.pause).toHaveBeenCalledWith('k1', expect.objectContaining({
      code: 'materialize_timeout', source: 'app',
    }));
    expect(h.finish).not.toHaveBeenCalled();
  });

  it('neuspesny claim s paused konci bez chyby a bez davky', async () => {
    const h = harness({
      start: vi.fn(async () => ({ audienceBuiltAt: '2026-08-01T00:00:00.000Z', claimed: false })),
      readStatus: vi.fn(async () => 'paused'),
    });
    await materializeHandler(h as never, { campaignId: 'k1', workspaceId: 'w1' });
    expect(h.loop).not.toHaveBeenCalled();
  });

  it('neuspesny claim s queueing pokracuje od kurzoru', async () => {
    const h = harness({
      start: vi.fn(async () => ({ audienceBuiltAt: '2026-08-01T00:00:00.000Z', claimed: false })),
      readStatus: vi.fn(async () => 'queueing'),
      progress: vi.fn(async () => ({ phase: 'materializing', cursor_contact_id: 'c-500', inserted_rows: 500 })),
    });
    await materializeHandler(h as never, { campaignId: 'k1', workspaceId: 'w1' });
    expect(h.loop).toHaveBeenCalledWith(expect.objectContaining({ startCursor: 'c-500' }));
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:unit -- jobs/materialize`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napsat handler**

```ts
// packages/core/src/campaigns/jobs/materialize.ts
import { decideAfterFailedClaim } from '../materialize/plan';
import { shouldRunFinish } from '../materialize/finish';
import { buildPauseReason } from '../pause-reason';
import { ZERO_UUID } from '../materialize/plan-constants';

export const MATERIALIZE_JOB = {
  queue: 'campaign.materialize' as const,
  /**
   * pg-boss singletonKey zabranuje dvema soubeznym jobum se stejnym klicem.
   * NEGARANTUJE, ze job probehne prave jednou: job, ktery spadne nebo vyprsi,
   * se podle retryLimit spusti znovu. Proto jsou ochrany proti duplicite tri
   * (prechod stavu, singletonKey, unikatni index) a kazda sama o sobe staci.
   */
  singletonKey: (campaignId: string) => `campaign.materialize:${campaignId}`,
  retryLimit: 5,
  retryBackoff: true,
  expireInSeconds: 3 * 60 * 60,
};

export type MaterializeDeps = {
  /** Vraci i release_at, protoze ho startMaterialization pocita ve stejnem UPDATE (D12). */
  start(campaignId: string): Promise<{
    audienceBuiltAt: string | null; releaseAt: string | null; claimed: boolean;
  }>;
  readStatus(campaignId: string): Promise<string>;
  progress(campaignId: string): Promise<{ phase: string; cursor_contact_id: string | null; inserted_rows: number } | null>;
  /**
   * `paramOffset` je POVINNY. Materializacni dotaz ma $1 az $4 obsazene pevnymi
   * parametry, takze poddotaz publika musi zacinat od $5. Bez toho by se cisla
   * parametru prekryla a dotaz by dosadil workspace_id tam, kde ma byt segment.
   */
  compileAudience(input: {
    campaignId: string; asOf: Date; paramOffset: number;
  }): Promise<{ sql: string; params: unknown[] }>;
  countGates(input: { campaignId: string; asOf: Date }): Promise<AudienceGateCounts>;
  /** Uklada TRI agregaty do ukazatele postupu a CELY jedenactiklicovy rozpad do kampane. */
  setGateCounters(campaignId: string, gates: AudienceGateCounts): Promise<void>;
  /** Plan pro render z ULOZENE compile_meta. Bez nej by render_data nemela `_present`. */
  renderPlan(campaignId: string): Promise<RenderPlan>;
  /**
   * Identifikatory ukazkovych kontaktu z manifestu P16. Cte se JEDNOU pred smyckou:
   * manifest ma nizke desitky polozek a v davce by se cetl zbytecne znovu.
   */
  sampleContactIds(): Promise<string[]>;
  loop(input: Record<string, unknown>): Promise<{ outcome: string; inserted: number; cursor: string }>;
  finish(campaignId: string, audienceBuiltAt: string): Promise<boolean>;
  pause(campaignId: string, reason: ReturnType<typeof buildPauseReason>): Promise<void>;
  fail(campaignId: string, errorCode: string): Promise<void>;
  emit(input: { type: string; campaignId: string }): Promise<void>;
  config?: { batchSize: number; maxMinutes: number };
};

/** Materializacni dotaz ma $1..$5 pevne, publikum tedy zacina od $6. */
const AUDIENCE_PARAM_OFFSET = 5;

export async function materializeHandler(
  deps: MaterializeDeps,
  payload: { campaignId: string; workspaceId: string },
): Promise<void> {
  const { campaignId } = payload;
  const started = await deps.start(campaignId);

  if (!started.claimed) {
    const decision = decideAfterFailedClaim((await deps.readStatus(campaignId)) as never);
    if (decision.action !== 'continue') return;
  }
  if (!started.audienceBuiltAt) return;

  const asOf = new Date(started.audienceBuiltAt);
  const progress = await deps.progress(campaignId);

  // Rozpad po branach se uklada JEDNOU, pred prvni davkou, s asOf = audience_built_at.
  // Pozdejsi cislo by uz videlo jine publikum a rozeslo by se s tim, co doopravdy odeslo.
  // Uklada se CELY, ne slity do tri cisel: cast 6 v 8.6.2 vyslovne zakazuje, aby byl
  // radek "Vyloučeno" souhrnny, a slitim ctyr bran do jedne se souhrnnym zase stane.
  const gates = await deps.countGates({ campaignId, asOf });
  await deps.setGateCounters(campaignId, gates);

  // Plan pro render musi byt nacteny PRED prvni davkou. Kdyz kampan neni zkompilovana,
  // materializace se nesmi rozjet: vznikly by radky s render_data bez `_present`
  // a kazdy podmineny blok by se v odeslanem mailu tise skryl (R11 plánu P08).
  let renderPlan: RenderPlan;
  try {
    renderPlan = await deps.renderPlan(campaignId);
  } catch {
    await deps.fail(campaignId, 'campaign_not_compiled');
    return;
  }

  // Ukazkove kontakty se nacitaji pred smyckou, ne v davce. Ochrana stoji na manifestu
  // I na znacce: znacku muze uzivatel prepsat, manifest ne. Viz rozhodnuti A1 plánu P16.
  const sampleContactIds = await deps.sampleContactIds();

  const where = await deps.compileAudience({
    campaignId, asOf, paramOffset: AUDIENCE_PARAM_OFFSET,
  });
  const cfg = deps.config ?? { batchSize: 5000, maxMinutes: 60 };

  const result = await deps.loop({
    campaignId,
    audienceBuiltAt: started.audienceBuiltAt,
    startCursor: progress?.cursor_contact_id ?? ZERO_UUID,
    batchSize: cfg.batchSize,
    maxMinutes: cfg.maxMinutes,
    where,
    renderPlan,
    sampleContactIds,
    // Undo okno spocital startMaterialization ve stejnem UPDATE, ktery zabral kampan.
    // Drive tahle hodnota prisla z deps.config, ktery nikdo nikdy nenaplnil, takze
    // release_at bylo vzdy null a okno na zruseni fakticky neexistovalo.
    releaseAt: started.releaseAt,
  });

  if (result.outcome === 'timeout') {
    await deps.pause(campaignId, buildPauseReason('materialize_timeout', 'app', {
      detail: `Materializace překročila strop ${cfg.maxMinutes} minut, kurzor zůstal na ${result.cursor}.`,
    }));
    return;
  }

  if (shouldRunFinish(result.outcome as never)) {
    const finished = await deps.finish(campaignId, started.audienceBuiltAt);
    if (finished) await deps.emit({ type: 'campaign.sending_started', campaignId });
  }
}
```

```ts
// packages/core/src/campaigns/materialize/plan-constants.ts
export const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:unit -- jobs/materialize`
Expected: PASS, 6 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/campaigns/jobs/materialize.ts packages/core/src/campaigns/materialize/plan-constants.ts packages/core/src/campaigns/jobs/__tests__/materialize.test.ts
git commit -m "feat(campaigns): campaign.materialize job with gate counters and timeout pause"
```

---

### Fáze D: změny publika během odesílání

#### Úkol 17: `revokePendingMessages`

**Files:**
- Create: `packages/core/src/campaigns/outbox/revoke.ts`
- Modify: `packages/core/src/campaigns/repo/outbox.ts` (přidat `revokePending`)
- Test: `packages/core/src/campaigns/repo/__tests__/revoke.db.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/campaigns/repo/__tests__/revoke.db.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { withTestWorkspace, seedMessages } from '../../../testing/harness';
import { revokePending } from '../outbox';
import { withWorkspace } from '@mlain/core/tx';
import { rawSql } from '../raw-sql';

describe('ruseni cekajicich zprav', () => {
  let ctx: Awaited<ReturnType<typeof withTestWorkspace>>;
  beforeEach(async () => { ctx = await withTestWorkspace(); });

  it('pending zprava kontaktu se oznaci jako skipped s duvodem', async () => {
    const { contactId } = await seedMessages(ctx, { statuses: ['pending'] });
    const r = await revokePending(ctx.workspace, { contactIds: [contactId], listId: null, reason: 'unsubscribed' });
    expect(r.revoked).toBe(1);
    const rows = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ status: string; error_code: string }>(rawSql(
        `SELECT status, error_code FROM messages WHERE contact_id = $1`, [contactId])));
    expect(rows.rows[0]).toMatchObject({ status: 'skipped', error_code: 'unsubscribed' });
  });

  it('claimed zprava se NEMENI, sender ji muze mit prave v ruce', async () => {
    const { contactId } = await seedMessages(ctx, { statuses: ['claimed'] });
    const r = await revokePending(ctx.workspace, { contactIds: [contactId], listId: null, reason: 'suppressed' });
    expect(r.revoked).toBe(0);
  });

  it('listId omezi rozsah jen na kampane s tim unsubscribe_list_id', async () => {
    const seeded = await seedMessages(ctx, { statuses: ['pending'], twoCampaignsWithDifferentLists: true });
    const r = await revokePending(ctx.workspace, {
      contactIds: [seeded.contactId], listId: seeded.listA, reason: 'unsubscribed',
    });
    expect(r.revoked).toBe(1);
  });

  it('listId null zrusi vsechny cekajici zpravy kontaktu v projektu', async () => {
    const seeded = await seedMessages(ctx, { statuses: ['pending'], twoCampaignsWithDifferentLists: true });
    const r = await revokePending(ctx.workspace, {
      contactIds: [seeded.contactId], listId: null, reason: 'suppressed',
    });
    expect(r.revoked).toBe(2);
  });

  it('vetev pres e-mail funguje, kdyz contact_id neznáme', async () => {
    const { email } = await seedMessages(ctx, { statuses: ['pending'] });
    const r = await revokePending(ctx.workspace, { emails: [email.toUpperCase()], listId: null, reason: 'suppressed' });
    expect(r.revoked).toBe(1);
  });

  it('zadne casove omezeni: rusi i zpravy ve stare partition', async () => {
    const { contactId } = await seedMessages(ctx, { statuses: ['pending'], createdMonthsAgo: 3 });
    const r = await revokePending(ctx.workspace, { contactIds: [contactId], listId: null, reason: 'suppressed' });
    expect(r.revoked).toBe(1);
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:db -- revoke.db`
Expected: FAIL, `revokePending is not a function`.

- [ ] **Step 3: Napsat repository a doménovou funkci**

```ts
// doplnit do packages/core/src/campaigns/repo/outbox.ts

export type RevokeReason =
  | 'unsubscribed' | 'suppressed' | 'contact_deleted'
  | 'contact_anonymized' | 'processing_restricted' | 'contact_status_changed';

/**
 * Podminka status = 'pending' je zasadni: zprava ve stavu claimed se NERUSI, protoze
 * ji sender muze mit prave v ruce a mohla by odejit. Ruseni claimnute zpravy by
 * vytvorilo stav, kdy je v databazi skipped, ale u prijemce ve schrance.
 *
 * ZADNE casove omezeni na created_at. Puvodne tu bylo okno sedmi dnu kvuli partition
 * pruningu a byla to chyba: kampan muze byt pozastavena mesice a jeji pending zpravy
 * lezi ve stare partition. Diky castecnemu indexu idx_messages__ws_email_pending je
 * to levne, protoze v uzavrenych kampanich zadne pending nezbyva.
 */
export async function revokePending(
  ctx: WorkspaceContext,
  input: { contactIds?: string[]; emails?: string[]; listId: string | null; reason: RevokeReason },
): Promise<{ revoked: number }> {
  const byEmail = !input.contactIds?.length && !!input.emails?.length;
  const match = byEmail
    ? `lower(m.email) = ANY($3::text[])`
    : `m.contact_id = ANY($3::uuid[])`;
  const key = byEmail
    ? (input.emails ?? []).map((e) => e.toLowerCase())
    : (input.contactIds ?? []);

  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute(rawSql(
      `UPDATE messages m
          SET status = 'skipped',
              error_code = $2,
              error_detail = 'revoked by application',
              updated_at = now()
        WHERE m.workspace_id = $1
          AND m.status = 'pending'
          AND ${match}
          AND ($4::uuid IS NULL OR EXISTS (
                SELECT 1 FROM campaigns c
                 WHERE c.id = m.campaign_id AND c.unsubscribe_list_id = $4))`,
      [ctx.workspaceId, input.reason, key, input.listId],
    ));
    return { revoked: r.rowCount ?? 0 };
  });
}
```

```ts
// packages/core/src/campaigns/outbox/revoke.ts
import type { WorkspaceContext } from '@mlain/core/tx';
import { revokePending, type RevokeReason } from '@mlain/core/campaigns';

export type RevokeInput = {
  /** Jeden kontakt, tvar, kterym vola cast 2. */
  contactId?: string;
  /** Davka, preferovana vetev uvnitr teto casti. */
  contactIds?: string[];
  /** Pro pripady, kdy zname jen adresu, typicky pri zpracovani SES udalosti. */
  emails?: string[];
  /**
   * POVINNY, i kdyz smi byt null. Volajici musi vedome rozhodnout o rozsahu.
   * Bez toho vznika ticha ztrata posty: clovek se odhlasi z jednoho newsletteru
   * a prijde i o cekajici zpravy z kampani na uplne jine seznamy, na ktere zustal
   * prihlaseny. Nikdo si toho nevsimne, protoze zpravy skonci jako skipped
   * s verohodnym duvodem.
   */
  listId: string | null;
  reason: RevokeReason;
};

export async function revokePendingMessages(
  ctx: WorkspaceContext,
  input: RevokeInput,
): Promise<{ revoked: number }> {
  const contactIds = input.contactIds ?? (input.contactId ? [input.contactId] : undefined);
  if (!contactIds?.length && !input.emails?.length) return { revoked: 0 };
  return revokePending(ctx, {
    contactIds, emails: input.emails, listId: input.listId, reason: input.reason,
  });
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:db -- revoke.db`
Expected: PASS, 6 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/campaigns/outbox/revoke.ts packages/core/src/campaigns/repo/outbox.ts packages/core/src/campaigns/repo/__tests__/revoke.db.test.ts
git commit -m "feat(campaigns): revokePendingMessages with mandatory list scope"
```

---

#### Úkol 18: Záchytná cesta, job `outbox.reconcile`

**Files:**
- Modify: `packages/core/src/campaigns/repo/outbox.ts` (přidat `reconcileSuppressed`)
- Create: `packages/core/src/campaigns/jobs/reconcile.ts`
- Test: `packages/core/src/campaigns/repo/__tests__/reconcile.db.test.ts`

- [ ] **Step 1: Napsat padající test, včetně větve přes otisk**

```ts
// packages/core/src/campaigns/repo/__tests__/reconcile.db.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { withTestWorkspace, seedMessages, addSuppression, anonymizeSuppression } from '../../../testing/harness';
import { reconcileSuppressed } from '../outbox';
import { withWorkspace } from '@mlain/core/tx';
import { rawSql } from '../raw-sql';

describe('zachytna cesta outbox.reconcile', () => {
  let ctx: Awaited<ReturnType<typeof withTestWorkspace>>;
  beforeEach(async () => { ctx = await withTestWorkspace(); });

  it('dotaz projde planovacem i nad prazdnymi tabulkami (lokalni OB-00)', async () => {
    await expect(reconcileSuppressed(ctx.workspace)).resolves.toMatchObject({ revoked: 0 });
  });

  it('primy zapis do suppressions vede do 60 s na skipped se suppressed', async () => {
    const { email } = await seedMessages(ctx, { statuses: ['pending'] });
    await addSuppression(ctx, { email, reason: 'manual' });
    const r = await reconcileSuppressed(ctx.workspace);
    expect(r.revoked).toBe(1);
    const rows = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ status: string; error_code: string }>(rawSql(
        `SELECT status, error_code FROM messages WHERE lower(email) = $1`, [email.toLowerCase()])));
    expect(rows.rows[0]).toMatchObject({ status: 'skipped', error_code: 'suppressed' });
  });

  it('shoda jen pres otisk take rusi, plaintext uz neexistuje', async () => {
    const { email } = await seedMessages(ctx, { statuses: ['pending'] });
    await addSuppression(ctx, { email, reason: 'gdpr_erasure' });
    await anonymizeSuppression(ctx, { email });
    expect((await reconcileSuppressed(ctx.workspace)).revoked).toBe(1);
  });

  it('mekce odebrana suppression (removed_at) neruší nic', async () => {
    const { email } = await seedMessages(ctx, { statuses: ['pending'] });
    await addSuppression(ctx, { email, reason: 'manual', removed: true });
    expect((await reconcileSuppressed(ctx.workspace)).revoked).toBe(0);
  });

  it('claimed zprava zustava claimed', async () => {
    const { email } = await seedMessages(ctx, { statuses: ['claimed'] });
    await addSuppression(ctx, { email, reason: 'hard_bounce' });
    expect((await reconcileSuppressed(ctx.workspace)).revoked).toBe(0);
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:db -- reconcile.db`
Expected: FAIL, `reconcileSuppressed is not a function`.

- [ ] **Step 3: Napsat dotaz ve tvaru dvou nezávislých `EXISTS`**

```ts
// doplnit do packages/core/src/campaigns/repo/outbox.ts

/**
 * Zachytna cesta pro pripady, kdy okamzita cesta selhala: pad workeru, primy zapis
 * do DB, import, ktery pridal adresu na suppression.
 *
 * Tvar je DVA NEZAVISLE EXISTS, ne jeden join, a to ze dvou duvodu. Drivejsi zneni
 * melo `UPDATE messages m ... FROM suppressions s LEFT JOIN contacts c ON c.id = m.contact_id`,
 * tedy odkaz na cilovou tabulku UPDATE uvnitr ON ve FROM. PostgreSQL to odmita chybou
 * "invalid reference to FROM-clause entry for table m", protoze cilova tabulka je do
 * dotazu pridana mimo strom spojeni. Druhy duvod je planovac: obe vetve se takhle
 * daji naplanovat kazda pres svuj index, coz u jedne disjunkce s LEFT JOIN neslo.
 */
export async function reconcileSuppressed(ctx: WorkspaceContext): Promise<{ revoked: number }> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute(rawSql(
      `UPDATE messages m
          SET status = 'skipped',
              error_code = 'suppressed',
              updated_at = now()
        WHERE m.workspace_id = $1
          AND m.status = 'pending'
          AND (
            EXISTS (
              SELECT 1 FROM suppressions s
               WHERE s.workspace_id = m.workspace_id
                 AND s.removed_at IS NULL
                 AND lower(s.email::text) = lower(m.email)
            )
            OR EXISTS (
              SELECT 1
                FROM contacts c
                JOIN suppressions s
                  ON s.workspace_id = c.workspace_id
                 AND s.fingerprint = ANY(c.email_fingerprints)
               WHERE c.id = m.contact_id
                 AND s.removed_at IS NULL
            )
          )`,
      [ctx.workspaceId],
    ));
    return { revoked: r.rowCount ?? 0 };
  });
}
```

```ts
// packages/core/src/campaigns/jobs/reconcile.ts
export const RECONCILE_JOB = {
  queue: 'outbox.reconcile' as const,
  cron: '*/1 * * * *',
  retryLimit: 3,
  expireInSeconds: 55,
};

export type ReconcileDeps = {
  listWorkspaces(): Promise<string[]>;
  reconcile(workspaceId: string): Promise<{ revoked: number }>;
  log(level: 'info' | 'warn', msg: string, meta?: unknown): void;
};

/** Bezi kazdych 60 sekund a je idempotentni: druhy beh nad tymz stavem zrusi nula radku. */
export async function reconcileHandler(deps: ReconcileDeps): Promise<{ revoked: number }> {
  let revoked = 0;
  for (const workspaceId of await deps.listWorkspaces()) {
    const r = await deps.reconcile(workspaceId);
    revoked += r.revoked;
    if (r.revoked > 0) {
      deps.log('warn', 'zachytna cesta zrusila zpravy, okamzita cesta nezabrala', {
        workspaceId, revoked: r.revoked,
      });
    }
  }
  return { revoked };
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:db -- reconcile.db`
Expected: PASS, 5 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/campaigns/repo/outbox.ts packages/core/src/campaigns/jobs/reconcile.ts packages/core/src/campaigns/repo/__tests__/reconcile.db.test.ts
git commit -m "feat(campaigns): outbox.reconcile with two independent EXISTS branches"
```

---

#### Úkol 19: Anonymizace zpráv při výmazu podle GDPR

**Files:**
- Create: `packages/core/src/campaigns/outbox/anonymize.ts`
- Modify: `packages/core/src/campaigns/repo/outbox.ts`
- Test: `packages/core/src/campaigns/repo/__tests__/anonymize.db.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/campaigns/repo/__tests__/anonymize.db.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { withTestWorkspace, seedMessages } from '../../../testing/harness';
import { anonymizeMessages } from '../outbox';
import { withWorkspace } from '@mlain/core/tx';
import { rawSql } from '../raw-sql';

describe('anonymizace zprav pri vymazu kontaktu', () => {
  let ctx: Awaited<ReturnType<typeof withTestWorkspace>>;
  beforeEach(async () => { ctx = await withTestWorkspace(); });

  it('prepise adresu na placeholder a vyprazdni render_data, radek zustava', async () => {
    const { contactId } = await seedMessages(ctx, { statuses: ['sent'] });
    await anonymizeMessages(ctx.workspace, contactId);
    const r = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ email: string; render_data: unknown }>(rawSql(
        `SELECT email, render_data FROM messages WHERE contact_id = $1`, [contactId])));
    expect(r.rows[0].email).toBe(`erased+${contactId}@erased.invalid`);
    expect(r.rows[0].render_data).toEqual({});
  });

  it('anonymizuje i recipient v message_events', async () => {
    const { contactId } = await seedMessages(ctx, { statuses: ['sent'], withEvents: true });
    await anonymizeMessages(ctx.workspace, contactId);
    const r = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ recipient: string }>(rawSql(`SELECT recipient FROM message_events WHERE contact_id = $1`, [contactId])));
    expect(r.rows.every((x) => x.recipient.endsWith('@erased.invalid'))).toBe(true);
  });

  it('statistiky kampane zustanou, pocet radku se nemeni', async () => {
    const { contactId, campaignId } = await seedMessages(ctx, { statuses: ['sent'] });
    const before = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ n: number }>(rawSql(`SELECT count(*)::int AS n FROM messages WHERE campaign_id = $1`, [campaignId])));
    await anonymizeMessages(ctx.workspace, contactId);
    const after = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ n: number }>(rawSql(`SELECT count(*)::int AS n FROM messages WHERE campaign_id = $1`, [campaignId])));
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:db -- anonymize.db`
Expected: FAIL, funkce neexistuje.

- [ ] **Step 3: Napsat funkci**

```ts
// doplnit do packages/core/src/campaigns/repo/outbox.ts

/**
 * Pri vymazu kontaktu podle GDPR se adresa ANONYMIZUJE, radky zustavaji, aby nezmizely
 * statistiky kampani. Tvar placeholderu je sjednoceny s casti 2. Domena .invalid je
 * rezervovana RFC 2606, takze na ni nikdy nic neodejde.
 *
 * POZOR: je to navrhove reseni podlehajici pravnimu posouzeni (otevrena otazka O11),
 * ne uzavrene pravidlo. Kdyby posouzeni dopadlo opacne, meni se nazev i chovani teto
 * funkce na deleteMessages a nic jineho na tom nestoji.
 */
export async function anonymizeMessages(ctx: WorkspaceContext, contactId: string): Promise<void> {
  const placeholder = `erased+${contactId}@erased.invalid`;
  await withWorkspace(ctx, async (tx) => {
    await tx.execute(rawSql(
      `UPDATE messages
          SET email = $3, render_data = '{}'::jsonb, updated_at = now()
        WHERE workspace_id = $1 AND contact_id = $2`,
      [ctx.workspaceId, contactId, placeholder],
    ));
    await tx.execute(rawSql(
      `UPDATE message_events
          SET recipient = $3
        WHERE workspace_id = $1 AND contact_id = $2`,
      [ctx.workspaceId, contactId, placeholder],
    ));
  });
}
```

```ts
// packages/core/src/campaigns/outbox/anonymize.ts
import type { WorkspaceContext } from '@mlain/core/tx';
import { anonymizeMessages as repoAnonymize } from '@mlain/core/campaigns';

/** Volá část 2 při výmazu kontaktu, viz její požadavek R2.5. */
export async function anonymizeMessages(ctx: WorkspaceContext, contactId: string): Promise<void> {
  await repoAnonymize(ctx, contactId);
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:db -- anonymize.db`
Expected: PASS, 3 testy.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/campaigns/outbox/anonymize.ts packages/core/src/campaigns/repo/outbox.ts packages/core/src/campaigns/repo/__tests__/anonymize.db.test.ts
git commit -m "feat(campaigns): anonymize messages and events on GDPR erasure"
```

---

### Fáze E: plánování a ovládání kampaně

#### Úkol 20: Validace plánu a časové zóny

**Files:**
- Create: `packages/core/src/campaigns/control/schedule.ts`
- Test: `packages/core/src/campaigns/control/__tests__/schedule.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/campaigns/control/__tests__/schedule.test.ts
import { describe, expect, it } from 'vitest';
import { validateSchedule, truncateToMinute, isCatchupWindow, EDITABLE_WHILE_SCHEDULED } from '../schedule';

const now = new Date('2026-08-01T10:00:00.000Z');

describe('planovani', () => {
  it('mene nez 5 minut do budoucnosti je campaign_schedule_too_soon', () => {
    const r = validateSchedule({ at: new Date('2026-08-01T10:03:00.000Z'), timezone: 'Europe/Prague', now });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('campaign_schedule_too_soon');
  });

  it('vic nez 365 dni je campaign_schedule_too_far', () => {
    const r = validateSchedule({ at: new Date('2027-10-01T10:00:00.000Z'), timezone: 'Europe/Prague', now });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('campaign_schedule_too_far');
  });

  it('neplatna IANA zona je validation_failed', () => {
    const r = validateSchedule({ at: new Date('2026-08-02T10:00:00.000Z'), timezone: 'Mars/Olympus', now });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('validation_failed');
  });

  it('sekundy se orezavaji na nulu', () => {
    expect(truncateToMinute(new Date('2026-08-01T10:07:42.500Z')).toISOString())
      .toBe('2026-08-01T10:07:00.000Z');
  });

  it('9:00 Europe/Prague je v lete 07:00 UTC a v zime 08:00 UTC', () => {
    const summer = validateSchedule({ at: new Date('2026-08-12T07:00:00.000Z'), timezone: 'Europe/Prague', now });
    const winter = validateSchedule({ at: new Date('2026-12-12T08:00:00.000Z'), timezone: 'Europe/Prague', now });
    expect(summer.ok && summer.localHour).toBe(9);
    expect(winter.ok && winter.localHour).toBe(9);
  });

  it('catch-up okno: 3 hodiny ano, 9 hodin ne', () => {
    expect(isCatchupWindow({ scheduledAt: new Date('2026-08-01T07:00:00.000Z'), now, catchupHours: 6 })).toBe(true);
    expect(isCatchupWindow({ scheduledAt: new Date('2026-08-01T01:00:00.000Z'), now, catchupHours: 6 })).toBe(false);
  });

  it('ve stavu scheduled se smi menit jen jmeno, cas a zona', () => {
    expect([...EDITABLE_WHILE_SCHEDULED].sort()).toEqual(['name', 'schedule_timezone', 'scheduled_at']);
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:unit -- control/schedule`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napsat modul**

```ts
// packages/core/src/campaigns/control/schedule.ts
import { DateTime } from 'luxon';
import { SCHEDULE_MAX_AHEAD_DAYS, SCHEDULE_MIN_LEAD_MINUTES } from '../constants';

/**
 * scheduled_at je absolutni okamzik v UTC, schedule_timezone je IANA zona, ve ktere
 * uzivatel cas zadal. Oboji se uklada: pro spusteni staci scheduled_at, pro zobrazeni
 * a opakovanou editaci je potreba vedet, v jake zone uzivatel myslel "v 9 rano".
 * Bez toho by se pri zmene letniho casu posunul cas, ktery uzivatel videl.
 */
export type ScheduleValidation =
  | { ok: true; at: Date; timezone: string; localHour: number }
  | { ok: false; code: 'campaign_schedule_too_soon' | 'campaign_schedule_too_far' | 'validation_failed'; detail: string };

export function truncateToMinute(d: Date): Date {
  return new Date(Math.floor(d.getTime() / 60_000) * 60_000);
}

export function validateSchedule(input: { at: Date; timezone: string; now: Date }): ScheduleValidation {
  const dt = DateTime.fromJSDate(input.at, { zone: input.timezone });
  if (!dt.isValid) {
    return { ok: false, code: 'validation_failed', detail: `Neznámá časová zóna ${input.timezone}.` };
  }
  const at = truncateToMinute(input.at);
  const leadMs = at.getTime() - input.now.getTime();

  if (leadMs < SCHEDULE_MIN_LEAD_MINUTES * 60_000) {
    return {
      ok: false, code: 'campaign_schedule_too_soon',
      detail: `Naplánovat lze nejdříve za ${SCHEDULE_MIN_LEAD_MINUTES} minut.`,
    };
  }
  if (leadMs > SCHEDULE_MAX_AHEAD_DAYS * 24 * 3_600_000) {
    return {
      ok: false, code: 'campaign_schedule_too_far',
      detail: `Naplánovat lze nejdále na ${SCHEDULE_MAX_AHEAD_DAYS} dní dopředu.`,
    };
  }
  return { ok: true, at, timezone: input.timezone, localHour: dt.hour };
}

export function isCatchupWindow(input: { scheduledAt: Date; now: Date; catchupHours: number }): boolean {
  const age = input.now.getTime() - input.scheduledAt.getTime();
  return age >= 0 && age <= input.catchupHours * 3_600_000;
}

/**
 * Ve stavu scheduled je obsah ZAMCENY. Jinak by se stalo, ze kampan odesla s obsahem,
 * ktery nikdo nikdy nevidel v nahledu. Uzivatel musi nejdriv unschedule, upravit
 * a naplanovat znovu.
 */
export const EDITABLE_WHILE_SCHEDULED = ['name', 'scheduled_at', 'schedule_timezone'] as const;
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:unit -- control/schedule`
Expected: PASS, 7 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/campaigns/control/schedule.ts packages/core/src/campaigns/control/__tests__/schedule.test.ts
git commit -m "feat(campaigns): schedule validation with IANA zones and catch-up window"
```

---

#### Úkol 21: Job `campaign.scheduler`

**Files:**
- Create: `packages/core/src/campaigns/jobs/scheduler.ts`
- Modify: `packages/core/src/campaigns/repo/campaign.ts` (přidat `claimDueCampaigns`, `markScheduleMissed`)
- Test: `packages/core/src/campaigns/repo/__tests__/scheduler.db.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/campaigns/repo/__tests__/scheduler.db.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { withTestWorkspace, seedCampaign } from '../../../testing/harness';
import { claimDueCampaigns, markScheduleMissed } from '../campaign';
import { getCampaign } from '../campaign';

describe('planovac', () => {
  let ctx: Awaited<ReturnType<typeof withTestWorkspace>>;
  beforeEach(async () => { ctx = await withTestWorkspace(); });

  it('vezme kampan, jejiz cas nastal a je v catch-up okne', async () => {
    const id = await seedCampaign(ctx, { status: 'scheduled', scheduledMinutesAgo: 10 });
    expect(await claimDueCampaigns(ctx.workspace, { catchupHours: 6, limit: 100 })).toContain(id);
  });

  it('nevezme kampan, jejiz cas jeste nenastal', async () => {
    const id = await seedCampaign(ctx, { status: 'scheduled', scheduledMinutesAgo: -30 });
    expect(await claimDueCampaigns(ctx.workspace, { catchupHours: 6, limit: 100 })).not.toContain(id);
  });

  it('kampan starsi nez catch-up okno prejde do schedule_missed a NEODESLE se', async () => {
    const id = await seedCampaign(ctx, { status: 'scheduled', scheduledMinutesAgo: 9 * 60 });
    await markScheduleMissed(ctx.workspace, { catchupHours: 6 });
    expect((await getCampaign(ctx.workspace, id))!.status).toBe('schedule_missed');
    expect(await claimDueCampaigns(ctx.workspace, { catchupHours: 6, limit: 100 })).not.toContain(id);
  });

  it('dva soubezne behy planovace nevydaji tutez kampan dvakrat', async () => {
    await seedCampaign(ctx, { status: 'scheduled', scheduledMinutesAgo: 5 });
    const [a, b] = await Promise.all([
      claimDueCampaigns(ctx.workspace, { catchupHours: 6, limit: 100 }),
      claimDueCampaigns(ctx.workspace, { catchupHours: 6, limit: 100 }),
    ]);
    expect(a.length + b.length).toBeLessThanOrEqual(2);
    expect(new Set([...a, ...b]).size).toBe(Math.max(a.length, b.length));
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:db -- scheduler.db`
Expected: FAIL, funkce neexistují.

- [ ] **Step 3: Napsat repository a handler**

```ts
// doplnit do packages/core/src/campaigns/repo/campaign.ts

export async function claimDueCampaigns(
  ctx: WorkspaceContext,
  opts: { catchupHours: number; limit: number },
): Promise<string[]> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<{ id: string }>(rawSql(
      `SELECT id FROM campaigns
        WHERE workspace_id = $1
          AND status = 'scheduled'
          AND deleted_at IS NULL
          AND scheduled_at <= now()
          AND scheduled_at > now() - ($2 || ' hours')::interval
        ORDER BY scheduled_at
        LIMIT ${Number(opts.limit)}
        FOR UPDATE SKIP LOCKED`,
      [ctx.workspaceId, String(opts.catchupHours)],
    ));
    return r.rows.map((x) => x.id);
  });
}

export async function markScheduleMissed(
  ctx: WorkspaceContext,
  opts: { catchupHours: number },
): Promise<number> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute(rawSql(
      `UPDATE campaigns
          SET status = 'schedule_missed', updated_at = now()
        WHERE workspace_id = $1
          AND status = 'scheduled'
          AND deleted_at IS NULL
          AND scheduled_at <= now() - ($2 || ' hours')::interval`,
      [ctx.workspaceId, String(opts.catchupHours)],
    ));
    return r.rowCount ?? 0;
  });
}
```

```ts
// packages/core/src/campaigns/jobs/scheduler.ts
export const SCHEDULER_JOB = {
  queue: 'campaign.scheduler' as const,
  cron: '*/30 * * * * *',
  retryLimit: 3,
  expireInSeconds: 25,
};

export type SchedulerDeps = {
  listWorkspaces(): Promise<string[]>;
  claimDue(workspaceId: string): Promise<Array<{ id: string; scheduledAt: Date }>>;
  markMissed(workspaceId: string): Promise<string[]>;
  sendMaterialize(input: { workspaceId: string; campaignId: string }): Promise<void>;
  emit(input: { workspaceId: string; type: string; campaignId: string; data?: unknown }): Promise<void>;
  audit(input: { workspaceId: string; action: string; campaignId: string; detail?: unknown }): Promise<void>;
  now(): Date;
};

/**
 * Zpozdeni nad 5 minut je pro uzivatele viditelna zmena a musi o nem vedet:
 * kampan typu "dnesni poledni menu" nema odejit vecer. Do 6 hodin odesleme
 * se zpozdenim a ohlasime to, po 6 hodinach cekame na rozhodnuti cloveka.
 */
export const SCHEDULE_DELAY_NOTIFY_SECONDS = 300;

export async function schedulerHandler(deps: SchedulerDeps): Promise<void> {
  for (const workspaceId of await deps.listWorkspaces()) {
    for (const campaignId of await deps.markMissed(workspaceId)) {
      await deps.emit({ workspaceId, type: 'campaign.schedule_missed', campaignId });
      await deps.audit({ workspaceId, action: 'campaign.schedule_missed', campaignId });
    }

    for (const due of await deps.claimDue(workspaceId)) {
      const delaySeconds = Math.round((deps.now().getTime() - due.scheduledAt.getTime()) / 1000);
      await deps.sendMaterialize({ workspaceId, campaignId: due.id });
      if (delaySeconds > SCHEDULE_DELAY_NOTIFY_SECONDS) {
        await deps.audit({
          workspaceId, action: 'campaign.schedule_delayed', campaignId: due.id,
          detail: { delay_seconds: delaySeconds },
        });
        await deps.emit({
          workspaceId, type: 'campaign.schedule_delayed', campaignId: due.id,
          data: { delay_seconds: delaySeconds, scheduled_at: due.scheduledAt.toISOString() },
        });
      }
    }
  }
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:db -- scheduler.db`
Expected: PASS, 4 testy.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/campaigns/jobs/scheduler.ts packages/core/src/campaigns/repo/campaign.ts packages/core/src/campaigns/repo/__tests__/scheduler.db.test.ts
git commit -m "feat(campaigns): scheduler job with catch-up window and schedule_missed"
```

---

#### Úkol 22: Pauza a obnovení

**Files:**
- Create: `packages/core/src/campaigns/control/pause.ts`
- Create: `packages/core/src/campaigns/control/resume.ts`
- Test: `packages/core/src/campaigns/repo/__tests__/pause-resume.db.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/campaigns/repo/__tests__/pause-resume.db.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { withTestWorkspace, seedCampaign, setProgressPhase } from '../../../testing/harness';
import { pauseCampaign, resumeCampaign } from '../../../../../core/src/campaigns/control/pause';
import { getCampaign } from '../campaign';

describe('pauza a obnoveni', () => {
  let ctx: Awaited<ReturnType<typeof withTestWorkspace>>;
  beforeEach(async () => { ctx = await withTestWorkspace(); });

  it.each(['queueing', 'sending'] as const)('pauza z %s uspeje a zasahne prave jeden radek', async (from) => {
    const id = await seedCampaign(ctx, { status: from });
    const r = await pauseCampaign(ctx.workspace, id, { code: 'user', source: 'user', at: new Date().toISOString() });
    expect(r.paused).toBe(true);
    const c = await getCampaign(ctx.workspace, id);
    expect(c!.status).toBe('paused');
    expect((c!.pause_reason as { code: string }).code).toBe('user');
  });

  it('pauza z draftu nezasahne nic a neni to chyba', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    expect((await pauseCampaign(ctx.workspace, id, { code: 'user', source: 'user', at: new Date().toISOString() })).paused).toBe(false);
  });

  it('pause_reason je jsonb, ne text', async () => {
    const id = await seedCampaign(ctx, { status: 'sending' });
    await pauseCampaign(ctx.workspace, id, { code: 'bounce_guard', source: 'app', at: new Date().toISOString() });
    const c = await getCampaign(ctx.workspace, id);
    expect(typeof c!.pause_reason).toBe('object');
  });

  it('resume s nedokoncenou materializaci vraci do queueing, ne do sending', async () => {
    const id = await seedCampaign(ctx, { status: 'paused' });
    await setProgressPhase(ctx, id, 'materializing');
    expect((await resumeCampaign(ctx.workspace, id)).status).toBe('queueing');
  });

  it('resume po dokoncene materializaci vraci do sending', async () => {
    const id = await seedCampaign(ctx, { status: 'paused' });
    await setProgressPhase(ctx, id, 'done');
    expect((await resumeCampaign(ctx.workspace, id)).status).toBe('sending');
  });

  it('resume vymaze paused_at i pause_reason', async () => {
    const id = await seedCampaign(ctx, { status: 'paused' });
    await setProgressPhase(ctx, id, 'done');
    await resumeCampaign(ctx.workspace, id);
    const c = await getCampaign(ctx.workspace, id);
    expect(c!.pause_reason).toBeNull();
  });

  it('jedna pozastavena kampan nezastavi ostatni', async () => {
    const paused = await seedCampaign(ctx, { status: 'sending' });
    const running = await seedCampaign(ctx, { status: 'sending' });
    await pauseCampaign(ctx.workspace, paused, { code: 'user', source: 'user', at: new Date().toISOString() });
    expect((await getCampaign(ctx.workspace, running))!.status).toBe('sending');
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:db -- pause-resume`
Expected: FAIL, moduly neexistují.

- [ ] **Step 3: Napsat obojí**

```ts
// packages/core/src/campaigns/control/pause.ts
import { withWorkspace, type WorkspaceContext } from '@mlain/core/tx';
import type { PauseReason } from '../pause-reason';
import { rawSql } from '../repo/raw-sql.js';

/**
 * Pauza musi byt rychla a nesmi nic ztratit. Mechanismus: sender se aplikace nepta,
 * ale claim dotaz obsahuje join na campaigns.status. Staci tedy zmenit stav kampane
 * a sender prestane brat novou praci.
 *
 * IN ('queueing','sending'), ne jen 'sending'. Omezeni z kontraktu plati pro SENDER,
 * aplikaci neomezuje; materialize_timeout je legitimni pauza z queueing. Drivejsi
 * zneni filtrovalo jen na sending, takze UPDATE by zasahl nula radku, job by povazoval
 * pauzu za provedenou a kampan by v queueing visela navzdy.
 *
 * Latence pauzy je doba, nez sender dokonci rozpracovanou davku. Pri SENDER_BATCH_SIZE
 * 100 a typicke kvote 14 zprav za sekundu jsou to jednotky sekund. Zpravy ve stavu
 * claimed dobehnou, tvrde zastaveni se v MVP 0 nedela.
 */
export async function pauseCampaign(
  ctx: WorkspaceContext,
  campaignId: string,
  reason: PauseReason,
): Promise<{ paused: boolean }> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute(rawSql(
      `UPDATE campaigns
          SET status = 'paused', paused_at = now(), pause_reason = $3::jsonb, updated_at = now()
        WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
          AND status IN ('queueing','sending')`,
      [campaignId, ctx.workspaceId, JSON.stringify(reason)],
    ));
    return { paused: (r.rowCount ?? 0) > 0 };
  });
}

export async function pauseAllForProvider(
  ctx: WorkspaceContext,
  providerId: string,
  reason: PauseReason,
): Promise<{ paused: number }> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute(rawSql(
      `UPDATE campaigns
          SET status = 'paused', paused_at = now(), pause_reason = $3::jsonb, updated_at = now()
        WHERE workspace_id = $1 AND provider_id = $2 AND deleted_at IS NULL
          AND status IN ('queueing','sending')`,
      [ctx.workspaceId, providerId, JSON.stringify(reason)],
    ));
    return { paused: r.rowCount ?? 0 };
  });
}
```

```ts
// packages/core/src/campaigns/control/resume.ts
import { withWorkspace, type WorkspaceContext } from '@mlain/core/tx';
import { rawSql } from '../repo/raw-sql.js';

/**
 * Cilovy stav NENI vzdy sending. Kdyz byla kampan pozastavena behem materializace
 * (phase <> 'done'), vraci se do queueing a resume znovu posle job campaign.materialize,
 * ktery pokracuje od kurzoru. Kdyby sla vzdy do sending, krok 3 materializace
 * (podminka WHERE status = 'queueing') by zasahl nula radku a kampan by navzdy
 * zustala s nulovym total_count. Sender rozdil mezi queueing a sending nevnima,
 * claim dotaz bere oba stavy.
 */
export async function resumeCampaign(
  ctx: WorkspaceContext,
  campaignId: string,
): Promise<{ resumed: boolean; status: 'queueing' | 'sending' | null }> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<{ status: 'queueing' | 'sending' }>(rawSql(
      `UPDATE campaigns
          SET status = CASE
                         WHEN EXISTS (SELECT 1 FROM campaign_audience_progress p
                                       WHERE p.campaign_id = campaigns.id AND p.phase <> 'done')
                         THEN 'queueing'
                         ELSE 'sending'
                       END,
              paused_at = NULL, pause_reason = NULL, updated_at = now()
        WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL AND status = 'paused'
        RETURNING status`,
      [campaignId, ctx.workspaceId],
    ));
    const row = r.rows[0];
    return { resumed: !!row, status: row?.status ?? null };
  });
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:db -- pause-resume`
Expected: PASS, 8 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/campaigns/control/pause.ts packages/core/src/campaigns/control/resume.ts packages/core/src/campaigns/repo/__tests__/pause-resume.db.test.ts
git commit -m "feat(campaigns): pause from queueing and sending, resume to the right state"
```

---

#### Úkol 23: Zrušení kampaně, úklid outboxu a závod s materializací

**Files:**
- Create: `packages/core/src/campaigns/control/cancel.ts`
- Modify: `packages/core/src/campaigns/repo/outbox.ts` (přidat `cancelPendingBatch`, `findOrphanedPending`)
- Test: `packages/core/src/campaigns/repo/__tests__/cancel.db.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/campaigns/repo/__tests__/cancel.db.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { withTestWorkspace, seedCampaign, seedOutbox } from '../../../testing/harness';
import { cancelCampaign } from '../../../../../core/src/campaigns/control/cancel';
import { findOrphanedPending } from '../outbox';
import { withWorkspace } from '@mlain/core/tx';
import { getCampaign } from '../campaign';
import { rawSql } from '../raw-sql';

describe('zruseni kampane', () => {
  let ctx: Awaited<ReturnType<typeof withTestWorkspace>>;
  beforeEach(async () => { ctx = await withTestWorkspace(); });

  it('50 000 zprav, 12 000 sent: sent zustava, zbytek krome claimed je skipped', async () => {
    const id = await seedCampaign(ctx, { status: 'sending' });
    await seedOutbox(ctx, { campaignId: id, sent: 12_000, pending: 37_950, claimed: 50 });
    await cancelCampaign(ctx.workspace, id, { reason: 'user' });

    const r = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ status: string; n: number }>(rawSql(
        `SELECT status, count(*)::int AS n FROM messages WHERE campaign_id = $1 GROUP BY status`, [id])));
    const by = Object.fromEntries(r.rows.map((x) => [x.status, x.n]));
    expect(by.sent).toBe(12_000);
    expect(by.skipped).toBe(37_950);
    expect(by.claimed).toBe(50);
    expect((await getCampaign(ctx.workspace, id))!.status).toBe('cancelled');
  });

  it('zrusene zpravy maji error_code campaign_cancelled, nikdy failed', async () => {
    const id = await seedCampaign(ctx, { status: 'sending' });
    await seedOutbox(ctx, { campaignId: id, pending: 500, claimed: 50 });
    await cancelCampaign(ctx.workspace, id, { reason: 'user' });
    const r = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ n: number }>(rawSql(`SELECT count(*)::int AS n FROM messages
                                WHERE campaign_id = $1 AND status = 'failed'`, [id])));
    expect(r.rows[0].n).toBe(0);
  });

  it('uklid bezi po davkach, dokud UPDATE vraci nenulovy pocet', async () => {
    const id = await seedCampaign(ctx, { status: 'sending' });
    await seedOutbox(ctx, { campaignId: id, pending: 25_000 });
    const r = await cancelCampaign(ctx.workspace, id, { reason: 'user' });
    expect(r.cleanedBatches).toBeGreaterThanOrEqual(3);
  });

  it('po zruseni neexistuje ani jedna pending zprava, jinak by branila odpojeni oddilu', async () => {
    const id = await seedCampaign(ctx, { status: 'sending' });
    await seedOutbox(ctx, { campaignId: id, pending: 1000 });
    await cancelCampaign(ctx.workspace, id, { reason: 'user' });
    expect(await findOrphanedPending(ctx.workspace)).toHaveLength(0);
  });

  it('findOrphanedPending najde pending v kampani v koncovem stavu', async () => {
    const id = await seedCampaign(ctx, { status: 'cancelled' });
    await seedOutbox(ctx, { campaignId: id, pending: 3 });
    const r = await findOrphanedPending(ctx.workspace);
    expect(r[0]).toMatchObject({ campaign_id: id, orphaned_pending: 3 });
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:db -- cancel.db`
Expected: FAIL, moduly neexistují.

- [ ] **Step 3: Napsat úklid**

```ts
// doplnit do packages/core/src/campaigns/repo/outbox.ts
import { CANCEL_CLEANUP_BATCH_SIZE } from '@mlain/core/campaigns';
import { rawSql } from './repo/raw-sql.js';

/**
 * Jedna davka uklidu. Bezi po 10 000 radcich, aby transakce nebyla dlouha, a volajici
 * ji opakuje, dokud vraci nenulovy pocet. Podminka created_at = audience_built_at
 * je tam kvuli partition pruningu: cela kampan lezi v jedne partition.
 */
export async function cancelPendingBatch(
  ctx: WorkspaceContext,
  input: { campaignId: string; audienceBuiltAt: string },
): Promise<number> {
  return withWorkspace(ctx, async (tx) => {
    // Filtr `kind = 'campaign'` je nutny, ne kosmeticky. Testovaci zpravy sdileji
    // s publikem `campaign_id` i `created_at`, takze bez nej by zruseni kampane
    // zrusilo i cekajici testovaci maily, ktere si uzivatel prave poslal.
    // `finishMaterialization` ten filtr uz spravne ma, slo tedy o nekonzistenci
    // uvnitr plánu.
    const r = await tx.execute(rawSql(
      `UPDATE messages
          SET status = 'skipped',
              error_code = 'campaign_cancelled',
              updated_at = now()
        WHERE campaign_id = $1
          AND created_at = $2::timestamptz
          AND status = 'pending'
          AND kind = 'campaign'
          AND id IN (
            SELECT id FROM messages
             WHERE campaign_id = $1 AND created_at = $2::timestamptz
               AND status = 'pending' AND kind = 'campaign'
             LIMIT ${CANCEL_CLEANUP_BATCH_SIZE}
          )`,
      [input.campaignId, input.audienceBuiltAt],
    ));
    return r.rowCount ?? 0;
  });
}

/**
 * Nenulovy vysledek znamena, ze selhala obe casti ochrany proti zavodu zruseni
 * s materializaci. Je to PORUCHA, ne provozni stav: takove radky nikdo neclaimne,
 * nikdo je neuklidi a navecky brani odpojeni oddilu. Hlasi se jako error.
 */
export async function findOrphanedPending(
  ctx: WorkspaceContext,
): Promise<Array<{ campaign_id: string; orphaned_pending: number }>> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<{ campaign_id: string; orphaned_pending: number }>(rawSql(
      `SELECT m.campaign_id, count(*)::int AS orphaned_pending
         FROM messages m
         JOIN campaigns c ON c.id = m.campaign_id
        WHERE m.workspace_id = $1
          AND m.status = 'pending'
          AND c.status IN ('cancelled','sent','partially_sent','failed')
        GROUP BY m.campaign_id`,
      [ctx.workspaceId],
    ));
    return r.rows;
  });
}
```

```ts
// packages/core/src/campaigns/control/cancel.ts
import { withWorkspace, type WorkspaceContext } from '@mlain/core/tx';
import { cancelPendingBatch } from '@mlain/core/campaigns';
import { rawSql } from '../repo/raw-sql.js';

/**
 * Zruseni je nevratne. Krok 1 prepne kampan, krok 2 vyprazdni outbox po davkach.
 * Zpravy ve stavu claimed se NERUSI, dobehnou; po dobehnuti dopocita citace watchdog.
 *
 * Uklid se opakuje, dokud UPDATE vraci nenulovy pocet, ne jednim pruchodem. Symetricky
 * k tomu materializacni smycka po zjisteni cancelled sama zavola tenhle uklid jeste
 * jednou, protoze mezi kontrolou stavu a koncem davky se da stihnout dalsi INSERT.
 */
export async function cancelCampaign(
  ctx: WorkspaceContext,
  campaignId: string,
  input: { reason: string },
): Promise<{ cancelled: boolean; skipped: number; cleanedBatches: number }> {
  const head = await withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<{ audience_built_at: string | null }>(rawSql(
      `UPDATE campaigns
          SET status = 'cancelled', cancel_reason = $3, finished_at = now(), updated_at = now()
        WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL
          AND status IN ('scheduled','queueing','sending','paused','schedule_missed')
        RETURNING audience_built_at`,
      [campaignId, ctx.workspaceId, input.reason],
    ));
    return r.rows[0] ?? null;
  });

  if (!head) return { cancelled: false, skipped: 0, cleanedBatches: 0 };
  if (!head.audience_built_at) return { cancelled: true, skipped: 0, cleanedBatches: 0 };

  let skipped = 0;
  let batches = 0;
  for (;;) {
    const n = await cancelPendingBatch(ctx, {
      campaignId, audienceBuiltAt: head.audience_built_at,
    });
    batches += 1;
    skipped += n;
    if (n === 0) break;
  }
  return { cancelled: true, skipped, cleanedBatches: batches };
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:db -- cancel.db`
Expected: PASS, 5 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/campaigns/control/cancel.ts packages/core/src/campaigns/repo/outbox.ts packages/core/src/campaigns/repo/__tests__/cancel.db.test.ts
git commit -m "feat(campaigns): cancel with batched outbox cleanup and orphan detection"
```

---

#### Úkol 24: Závod zrušení s materializací, opakovaný test

Tenhle úkol nepřidává kód, přidává test, bez kterého předchozí dva úkoly nic nedokazují. Akceptační kritérium 14b části 4a výslovně žádá, aby scénář **selhal**, když se kontrola stavu po dávce vypne.

**Files:**
- Create: `packages/core/src/campaigns/repo/__tests__/cancel-race.db.test.ts`

- [ ] **Step 1: Napsat test závodu**

```ts
// packages/core/src/campaigns/repo/__tests__/cancel-race.db.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { withTestWorkspace, seedCampaign, seedContacts, seedList } from '../../../testing/harness';
import { runMaterializeLoop } from '../../../../../core/src/campaigns/materialize/loop';
import { materializeBatch, cancelPendingBatch } from '../outbox';
import { startMaterialization } from '../audience-progress';
import { cancelCampaign } from '../../../../../core/src/campaigns/control/cancel';
import { getCampaign } from '../campaign';
import { withWorkspace } from '@mlain/core/tx';
import { rawSql } from '../raw-sql';

async function runOnce(checkStatusAfterBatch: boolean, cancelAfterBatches: number) {
  const ctx = await withTestWorkspace();
  const list = await seedList(ctx);
  await seedContacts(ctx, { count: 20_000, list });
  const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list] });
  const { audienceBuiltAt } = await startMaterialization(ctx.workspace, id, 0);

  let batches = 0;
  await runMaterializeLoop(
    {
      batch: async (i) => {
        const r = await materializeBatch(ctx.workspace, { ...i, statementTimeoutMs: 30_000 });
        batches += 1;
        if (batches === cancelAfterBatches) await cancelCampaign(ctx.workspace, id, { reason: 'test' });
        return r;
      },
      advanceCursor: async () => {},
      // Vypnuta kontrola je presne ta implementace, ktera zavod NEOSETRUJE.
      readStatus: async () =>
        checkStatusAfterBatch ? ((await getCampaign(ctx.workspace, id))!.status as never) : ('queueing' as never),
      cleanupCancelled: async () => cancelPendingBatch(ctx.workspace, { campaignId: id, audienceBuiltAt: audienceBuiltAt! }),
      now: () => new Date(),
      log: () => {},
    },
    {
      campaignId: id, audienceBuiltAt: audienceBuiltAt!,
      startCursor: '00000000-0000-0000-0000-000000000000',
      batchSize: 1000, maxMinutes: 60, where: { sql: 'true', params: [] },
      renderPlan: EMPTY_RENDER_PLAN, sampleContactIds: [], releaseAt: null,
    },
  );

  const r = await withWorkspace(ctx.workspace, (tx) =>
    tx.execute<{ n: number }>(rawSql(`SELECT count(*)::int AS n FROM messages
                              WHERE campaign_id = $1 AND status = 'pending'`, [id])));
  return r.rows[0].n;
}

describe('zavod zruseni s materializaci', () => {
  it('se zapnutou kontrolou stavu nezustane ani jedna pending zprava, 20 opakovani', async () => {
    for (let i = 0; i < 20; i++) {
      const at = 3 + (i % 12);
      expect(await runOnce(true, at)).toBe(0);
    }
  }, 600_000);

  it('s vypnutou kontrolou stavu test MUSI selhat, jinak nedokazuje nic', async () => {
    const leftovers: number[] = [];
    for (let i = 0; i < 5; i++) leftovers.push(await runOnce(false, 3 + i));
    expect(Math.max(...leftovers)).toBeGreaterThan(0);
  }, 300_000);
});
```

- [ ] **Step 2: Spustit**

Run: `pnpm --filter @mlain/core test:db -- cancel-race`
Expected: PASS. Kdyby první test spadl, je chyba v kontrole stavu po dávce. Kdyby spadl druhý, znamená to, že první nic nedokazuje, protože by prošel i u implementace, která závod neošetřuje.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/campaigns/repo/__tests__/cancel-race.db.test.ts
git commit -m "test(campaigns): cancel versus materialization race, twenty runs plus negative control"
```

---

#### Úkol 25: Okno na zrušení odeslání

**Files:**
- Create: `packages/core/src/campaigns/control/undo.ts`
- Test: `packages/core/src/campaigns/control/__tests__/undo.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/campaigns/control/__tests__/undo.test.ts
import { describe, expect, it } from 'vitest';
import { resolveUndoWindow, computeReleaseAt, undoState } from '../undo';

describe('okno na zruseni odeslani', () => {
  it('vychozi delka je 60 sekund', () => {
    expect(resolveUndoWindow({}, { CAMPAIGN_UNDO_WINDOW_SECONDS: 60 })).toBe(60);
  });

  it('projekt smi okno zkratit', () => {
    expect(resolveUndoWindow({ undo_window_seconds: 20 }, { CAMPAIGN_UNDO_WINDOW_SECONDS: 60 })).toBe(20);
  });

  it('projekt nesmi okno prodlouzit, hodnota se orizne na strop instalace', () => {
    expect(resolveUndoWindow({ undo_window_seconds: 300 }, { CAMPAIGN_UNDO_WINDOW_SECONDS: 60 })).toBe(60);
  });

  it('nula okno vypina a odesila se okamzite', () => {
    expect(resolveUndoWindow({ undo_window_seconds: 0 }, { CAMPAIGN_UNDO_WINDOW_SECONDS: 60 })).toBe(0);
    expect(computeReleaseAt(new Date('2026-08-01T10:00:00.000Z'), 0)).toBeNull();
  });

  it('release_at je audience_built_at plus okno', () => {
    expect(computeReleaseAt(new Date('2026-08-01T10:00:00.000Z'), 60)!.toISOString())
      .toBe('2026-08-01T10:01:00.000Z');
  });

  it('behem okna a bez odeslane zpravy jde vzit zpet', () => {
    expect(undoState({ sentCount: 0, releaseAt: new Date('2026-08-01T10:01:00.000Z'), now: new Date('2026-08-01T10:00:30.000Z') }))
      .toEqual({ canUndo: true, remainingSeconds: 30 });
  });

  it('po vyprseni okna vraci campaign_undo_window_expired', () => {
    expect(undoState({ sentCount: 0, releaseAt: new Date('2026-08-01T10:01:00.000Z'), now: new Date('2026-08-01T10:02:00.000Z') }))
      .toEqual({ canUndo: false, reason: 'campaign_undo_window_expired', remainingSeconds: 0 });
  });

  it('kdyz uz neco odeslo, undo nejde ani uvnitr okna', () => {
    expect(undoState({ sentCount: 1, releaseAt: new Date('2026-08-01T10:01:00.000Z'), now: new Date('2026-08-01T10:00:10.000Z') }).canUndo)
      .toBe(false);
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:unit -- control/undo`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napsat modul**

```ts
// packages/core/src/campaigns/control/undo.ts

/**
 * Odlozeny start je SKUTECNE undo: kampan se materializuje ihned, ale sender ji
 * nezacne odbavovat driv nez v release_at. Realizuje se jedinym sloupcem v outboxu
 * (next_attempt_at), zadna nova logika, a claim dotaz kontraktu uz podminku
 * next_attempt_at <= now() obsahuje, takze sender se nemeni vubec.
 *
 * Zdvodneni vychozi minuty: nejcastejsi chyba neni spatne publikum (to uzivatel vidi
 * v preflightu), ale preklep v predmetu, ktery si precte az v okamziku, kdy zmackne
 * Odeslat. Sedesat sekund tuhle chybu zachyti a zpozdi kampan zanedbatelne.
 *
 * Zastaveni rozjete kampane je NECO JINEHO: to je pause nebo cancel a UI o tom nikdy
 * nemluvi jako o vraceni, protoze odeslany mail vratit nejde.
 */
export function resolveUndoWindow(
  settings: { undo_window_seconds?: number },
  limits: { CAMPAIGN_UNDO_WINDOW_SECONDS: number },
): number {
  const wanted = settings.undo_window_seconds ?? limits.CAMPAIGN_UNDO_WINDOW_SECONDS;
  return Math.max(0, Math.min(wanted, limits.CAMPAIGN_UNDO_WINDOW_SECONDS));
}

export function computeReleaseAt(audienceBuiltAt: Date, windowSeconds: number): Date | null {
  if (windowSeconds <= 0) return null;
  return new Date(audienceBuiltAt.getTime() + windowSeconds * 1000);
}

export type UndoState =
  | { canUndo: true; remainingSeconds: number }
  | { canUndo: false; reason: 'campaign_undo_window_expired'; remainingSeconds: 0 };

export function undoState(input: { sentCount: number; releaseAt: Date | null; now: Date }): UndoState {
  if (!input.releaseAt || input.sentCount > 0 || input.now >= input.releaseAt) {
    return { canUndo: false, reason: 'campaign_undo_window_expired', remainingSeconds: 0 };
  }
  return {
    canUndo: true,
    remainingSeconds: Math.ceil((input.releaseAt.getTime() - input.now.getTime()) / 1000),
  };
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:unit -- control/undo`
Expected: PASS, 8 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/campaigns/control/undo.ts packages/core/src/campaigns/control/__tests__/undo.test.ts
git commit -m "feat(campaigns): sixty second undo window via release_at"
```

---

#### Úkol 26: Čítače, rekoncilace a uzavření kampaně

**Files:**
- Create: `packages/core/src/campaigns/repo/counters.ts`
- Create: `packages/core/src/campaigns/jobs/watchdog.ts`
- Test: `packages/core/src/campaigns/repo/__tests__/counters.db.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/campaigns/repo/__tests__/counters.db.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { withTestWorkspace, seedCampaign, seedOutbox, seedEvents } from '../../../testing/harness';
import { reconcileDeliveryCounters, reconcileHandoverCounters } from '../counters';
import { getCampaign } from '../campaign';
import { closingStatus } from '../../../../../core/src/campaigns/jobs/watchdog';

describe('citace kampane', () => {
  let ctx: Awaited<ReturnType<typeof withTestWorkspace>>;
  beforeEach(async () => { ctx = await withTestWorkspace(); });

  it('dotaz nad messages nemeni bounce_count', async () => {
    const id = await seedCampaign(ctx, { status: 'sending' });
    await seedOutbox(ctx, { campaignId: id, sent: 10, failed: 2, skipped: 1 });
    await seedEvents(ctx, { campaignId: id, type: 'bounced_hard', count: 3 });
    await reconcileHandoverCounters(ctx.workspace, id);
    const c = await getCampaign(ctx.workspace, id);
    expect(c!.sent_count).toBe(10);
    expect(c!.bounce_count).toBe(0);
  });

  it('dotaz nad message_events nemeni sent_count', async () => {
    const id = await seedCampaign(ctx, { status: 'sending' });
    await seedOutbox(ctx, { campaignId: id, sent: 10 });
    await seedEvents(ctx, { campaignId: id, type: 'bounced_hard', count: 3 });
    await reconcileDeliveryCounters(ctx.workspace, id);
    const c = await getCampaign(ctx.workspace, id);
    expect(c!.bounce_count).toBe(3);
    expect(c!.sent_count).toBe(0);
  });

  it('dve udalosti bounced_soft pro tutez zpravu zvysi citac o jedna', async () => {
    const id = await seedCampaign(ctx, { status: 'sending' });
    await seedOutbox(ctx, { campaignId: id, sent: 1 });
    await seedEvents(ctx, { campaignId: id, type: 'bounced_soft', count: 2, sameMessage: true });
    await reconcileDeliveryCounters(ctx.workspace, id);
    expect((await getCampaign(ctx.workspace, id))!.bounce_count).toBe(1);
  });

  it('testovaci zpravy se nepocitaji do total_count', async () => {
    const id = await seedCampaign(ctx, { status: 'sending' });
    await seedOutbox(ctx, { campaignId: id, sent: 5, testMessages: 3 });
    await reconcileHandoverCounters(ctx.workspace, id);
    expect((await getCampaign(ctx.workspace, id))!.total_count).toBe(5);
  });
});

describe('uzavreni kampane se pocita jen ze skupiny predani', () => {
  it('vse predano a vse se odrazilo: sent, ne partially_sent', () => {
    expect(closingStatus({ total: 100, sent: 100, failed: 0, skipped: 0, partialThreshold: 0.01 })).toBe('sent');
  });
  it('nic se nepredalo: failed', () => {
    expect(closingStatus({ total: 100, sent: 0, failed: 60, skipped: 40, partialThreshold: 0.01 })).toBe('failed');
  });
  it('nad prahem 1 %: partially_sent', () => {
    expect(closingStatus({ total: 100, sent: 95, failed: 3, skipped: 2, partialThreshold: 0.01 })).toBe('partially_sent');
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:db -- counters.db`
Expected: FAIL, moduly neexistují.

- [ ] **Step 3: Napsat obojí**

```ts
// packages/core/src/campaigns/repo/counters.ts
import { withWorkspace, type WorkspaceContext } from '@mlain/core/tx';
import { rawSql } from './raw-sql.js';

/**
 * Citace se deli na dve skupiny, ktere maji ruzny zdroj pravdy a NESMI se plest:
 *   predani provideru: total, sent, failed, skipped        <- messages.status
 *   doruceni:          delivered, bounced, complained      <- message_events
 *
 * failed_count tedy znamena "nepodarilo se predat provideru", ne "nedorazilo".
 * Zprava, kterou SES prijal a ktera se pak odrazila, ma status = 'sent', pocita se
 * do sent_count i do bounce_count, a do failed_count NIKDY.
 *
 * Zameny tehle dvojice projde code review, protoze COUNT(status = 'failed') vypada
 * jako nedorucitelnost a chova se spravne az do prvniho bouncu. Proto jsou to dva
 * oddelene dotazy nad dvema tabulkami a kazdy ma vlastni test.
 */
export async function reconcileHandoverCounters(
  ctx: WorkspaceContext,
  campaignId: string,
): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    await tx.execute(rawSql(
      `WITH agg AS (
         SELECT
           count(*) FILTER (WHERE true)                AS total,
           count(*) FILTER (WHERE status = 'sent')     AS sent,
           count(*) FILTER (WHERE status = 'failed')   AS failed,
           count(*) FILTER (WHERE status = 'skipped')  AS skipped
         FROM messages
        WHERE campaign_id = $1 AND workspace_id = $2 AND kind = 'campaign'
       )
       UPDATE campaigns c
          SET total_count = agg.total, sent_count = agg.sent,
              failed_count = agg.failed, skipped_count = agg.skipped,
              updated_at = now()
         FROM agg
        WHERE c.id = $1 AND c.workspace_id = $2`,
      [campaignId, ctx.workspaceId],
    ));
  });
}

export async function reconcileDeliveryCounters(
  ctx: WorkspaceContext,
  campaignId: string,
): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    await tx.execute(rawSql(
      `WITH agg AS (
         SELECT
           count(DISTINCT message_id) FILTER (WHERE type = 'delivered')   AS delivered,
           count(DISTINCT message_id) FILTER (WHERE type IN ('bounced_hard','bounced_soft')) AS bounced,
           count(DISTINCT message_id) FILTER (WHERE type = 'complained')  AS complained
         FROM message_events
        WHERE campaign_id = $1 AND workspace_id = $2
       )
       UPDATE campaigns c
          SET delivered_count = agg.delivered, bounce_count = agg.bounced,
              complaint_count = agg.complained, updated_at = now()
         FROM agg
        WHERE c.id = $1 AND c.workspace_id = $2`,
      [campaignId, ctx.workspaceId],
    ));
  });
}

export async function isOutboxDrained(
  ctx: WorkspaceContext,
  input: { campaignId: string; audienceBuiltAt: string },
): Promise<boolean> {
  return withWorkspace(ctx, async (tx) => {
    // Bez `kind = 'campaign'` by se kampan neuzavrela, dokud nedobehne testovaci mail,
    // ktery si nekdo poslal minutu pred koncem. Testovaci zpravy nejsou soucasti publika
    // a jejich stav o dokonceni kampane nevypovida nic.
    const r = await tx.execute<{ n: number }>(rawSql(
      `SELECT count(*)::int AS n FROM messages
        WHERE campaign_id = $1 AND created_at = $2::timestamptz
          AND kind = 'campaign'
          AND status IN ('pending','claimed')`,
      [input.campaignId, input.audienceBuiltAt],
    ));
    return r.rows[0]!.n === 0;
  });
}
```

```ts
// packages/core/src/campaigns/jobs/watchdog.ts
import { WATCHDOG_QUIET_SECONDS } from '../constants';
import { isAutoPause, type PauseReason } from '../pause-reason';

export const WATCHDOG_JOB = {
  queue: 'campaign.watchdog' as const,
  cron: '*/15 * * * * *',
  retryLimit: 3,
  expireInSeconds: 12,
};

/**
 * Vysledny stav se pocita VYHRADNE ze skupiny "predani provideru", protoze uzavreni
 * kampane je otazka "doposlali jsme to?", ne "dorazilo to?". Kampan, ze ktere se
 * vsechno predalo a vsechno se pak odrazilo, se uzavre jako sent. Je to spravne:
 * odeslali jsme ji celou. Kdyby uzaviraci pravidlo koukalo na bouncy, cekalo by
 * na dobihajici udalosti a kampan by se neuzavrela hodiny po skutecnem konci.
 */
export function closingStatus(input: {
  total: number; sent: number; failed: number; skipped: number; partialThreshold: number;
}): 'sent' | 'partially_sent' | 'failed' {
  if (input.total === 0) return 'failed';
  const notDelivered = input.failed + input.skipped;
  if (notDelivered === input.total) return 'failed';
  if (notDelivered / input.total > input.partialThreshold) return 'partially_sent';
  return 'sent';
}

export type WatchdogDeps = {
  listRunning(): Promise<Array<{ workspaceId: string; campaignId: string; audienceBuiltAt: string | null; status: string; pauseReason: PauseReason | null }>>;
  reconcileHandover(workspaceId: string, campaignId: string): Promise<void>;
  reconcileDelivery(workspaceId: string, campaignId: string): Promise<void>;
  counters(workspaceId: string, campaignId: string): Promise<{ total: number; sent: number; failed: number; skipped: number; lastChangeAt: Date }>;
  drained(workspaceId: string, campaignId: string, audienceBuiltAt: string): Promise<boolean>;
  close(workspaceId: string, campaignId: string, status: 'sent' | 'partially_sent' | 'failed'): Promise<boolean>;
  hasAuditForPause(workspaceId: string, campaignId: string, at: string): Promise<boolean>;
  writeAutoPauseAudit(workspaceId: string, campaignId: string, reason: PauseReason): Promise<void>;
  emit(input: { workspaceId: string; type: string; campaignId: string }): Promise<void>;
  now(): Date;
  partialThreshold: number;
};

export async function watchdogHandler(deps: WatchdogDeps): Promise<void> {
  for (const c of await deps.listRunning()) {
    // Audit campaign.auto_paused zapisuje APLIKACE i tehdy, kdyz pauzu provedl sender.
    // Sender do audit_log nema granty a mit je nema, takze bez tohohle by pauzy
    // provedene senderem v auditu vubec nebyly.
    if (c.status === 'paused' && c.pauseReason && isAutoPause(c.pauseReason)) {
      if (!(await deps.hasAuditForPause(c.workspaceId, c.campaignId, c.pauseReason.at))) {
        await deps.writeAutoPauseAudit(c.workspaceId, c.campaignId, c.pauseReason);
        await deps.emit({ workspaceId: c.workspaceId, type: 'campaign.paused', campaignId: c.campaignId });
      }
      continue;
    }

    if (c.status !== 'queueing' && c.status !== 'sending') continue;

    await deps.reconcileHandover(c.workspaceId, c.campaignId);
    await deps.reconcileDelivery(c.workspaceId, c.campaignId);

    if (!c.audienceBuiltAt) continue;
    if (!(await deps.drained(c.workspaceId, c.campaignId, c.audienceBuiltAt))) continue;

    const counters = await deps.counters(c.workspaceId, c.campaignId);
    const quietFor = (deps.now().getTime() - counters.lastChangeAt.getTime()) / 1000;
    if (quietFor < WATCHDOG_QUIET_SECONDS) continue;

    const status = closingStatus({ ...counters, partialThreshold: deps.partialThreshold });
    if (await deps.close(c.workspaceId, c.campaignId, status)) {
      await deps.emit({ workspaceId: c.workspaceId, type: 'campaign.sent', campaignId: c.campaignId });
    }
  }
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:db -- counters.db`
Expected: PASS, 7 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/campaigns/repo/counters.ts packages/core/src/campaigns/jobs/watchdog.ts packages/core/src/campaigns/repo/__tests__/counters.db.test.ts
git commit -m "feat(campaigns): watchdog with two separate counter groups and closing rule"
```

---

### Fáze F: provideři

#### Úkol 27: Konfigurace providera, šifrování a odvozená veřejná kopie

**Files:**
- Create: `packages/core/src/providers/types.ts`
- Create: `packages/core/src/providers/config-schema.ts`
- Create: `packages/core/src/providers/crypto.ts`
- Test: `packages/core/src/providers/__tests__/config-schema.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/providers/__tests__/config-schema.test.ts
import { describe, expect, it } from 'vitest';
import { providerConfigSchema, derivePublicConfig, mask } from '../config-schema';

const ses = {
  kind: 'ses', region: 'eu-central-1',
  access_key_id: 'AKIAIOSFODNN7ABCD', secret_access_key: 'x'.repeat(40),
  configuration_set_name: 'mlain-acme', sns_topic_arn: null,
  max_send_rate: 14, max_24h_send: 50_000,
};

const smtp = {
  kind: 'smtp', host: 'smtp.wedos.net', port: 587, username: 'jana@firma.cz',
  password: 'tajne', encryption: 'starttls', max_send_rate: 10,
  max_connections: 5, max_messages_per_connection: 100,
};

describe('konfigurace provideru', () => {
  it('klice jsou snake_case, protoze JSON cte TypeScript i Go', () => {
    expect(providerConfigSchema.parse(ses)).toHaveProperty('access_key_id');
  });

  it('SMTP port mimo povolenou sadu neprojde', () => {
    expect(providerConfigSchema.safeParse({ ...smtp, port: 12345 }).success).toBe(false);
    for (const port of [25, 465, 587, 2525]) {
      expect(providerConfigSchema.safeParse({ ...smtp, port }).success).toBe(true);
    }
  });

  it('SMTP rozsahy: rate 1 az 500, spojeni 1 az 50, zprav na spojeni 1 az 10000', () => {
    expect(providerConfigSchema.safeParse({ ...smtp, max_send_rate: 501 }).success).toBe(false);
    expect(providerConfigSchema.safeParse({ ...smtp, max_connections: 51 }).success).toBe(false);
    expect(providerConfigSchema.safeParse({ ...smtp, max_messages_per_connection: 10_001 }).success).toBe(false);
  });

  it('verejna kopie nikdy neobsahuje tajemstvi', () => {
    const pub = derivePublicConfig(providerConfigSchema.parse(ses));
    expect(JSON.stringify(pub)).not.toContain('x'.repeat(40));
    expect(pub).toMatchObject({ kind: 'ses', access_key_id_masked: 'AKIA****ABCD' });
  });

  it('maskuje prvni ctyri a posledni ctyri znaky', () => {
    expect(mask('AKIAIOSFODNN7ABCD')).toBe('AKIA****ABCD');
    expect(mask('abc')).toBe('****');
  });

  it('u SMTP se maskuje uzivatelske jmeno, heslo se nezobrazi nikdy', () => {
    const pub = derivePublicConfig(providerConfigSchema.parse(smtp));
    expect(pub).toMatchObject({ kind: 'smtp', host: 'smtp.wedos.net', port: 587 });
    expect(JSON.stringify(pub)).not.toContain('tajne');
  });

  it('neznamy kind se odmita, ale kod nikde nema switch bez default', () => {
    expect(providerConfigSchema.safeParse({ ...ses, kind: 'postmark' }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:unit -- providers/config-schema`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napsat typy, schéma a krypto adaptér**

```ts
// packages/core/src/providers/types.ts

/** Uzavreny vycet SCHVALNE, ale ne navzdy: MVP 2 slibuje pluginove providery. */
export const PROVIDER_TYPES = ['ses', 'smtp'] as const;
export type ProviderType = (typeof PROVIDER_TYPES)[number] | (string & {});

export const PROVIDER_STATUSES = ['unverified', 'verifying', 'ready', 'degraded', 'blocked', 'disabled'] as const;
export type ProviderStatus = (typeof PROVIDER_STATUSES)[number] | (string & {});

export type SesConfig = {
  kind: 'ses'; region: string; access_key_id: string; secret_access_key: string;
  configuration_set_name: string; sns_topic_arn: string | null;
  max_send_rate: number; max_24h_send: number | null;
};

export type SmtpConfig = {
  kind: 'smtp'; host: string; port: number; username: string; password: string;
  encryption: 'starttls' | 'tls' | 'none';
  max_send_rate: number; max_connections: number; max_messages_per_connection: number;
};

export type ProviderConfig = SesConfig | SmtpConfig;

export type ProviderPublicConfig =
  | { kind: 'ses'; region: string; configuration_set_name: string; sns_topic_arn: string | null; access_key_id_masked: string }
  | { kind: 'smtp'; host: string; port: number; encryption: string; username_masked: string };
```

```ts
// packages/core/src/providers/config-schema.ts
import { z } from 'zod';
import type { ProviderConfig, ProviderPublicConfig } from './types';

const sesSchema = z.object({
  kind: z.literal('ses'),
  region: z.string().regex(/^[a-z]{2}-[a-z]+-\d$/),
  access_key_id: z.string().min(16).max(128),
  secret_access_key: z.string().min(16).max(256),
  configuration_set_name: z.string().min(1).max(64),
  sns_topic_arn: z.string().nullable(),
  max_send_rate: z.number().positive(),
  max_24h_send: z.number().int().positive().nullable(),
}).strict();

const smtpSchema = z.object({
  kind: z.literal('smtp'),
  host: z.string().min(1).max(255),
  port: z.union([z.literal(25), z.literal(465), z.literal(587), z.literal(2525)]),
  username: z.string().min(1).max(255),
  password: z.string().min(1).max(512),
  encryption: z.enum(['starttls', 'tls', 'none']),
  max_send_rate: z.number().int().min(1).max(500).default(10),
  max_connections: z.number().int().min(1).max(50).default(5),
  max_messages_per_connection: z.number().int().min(1).max(10_000).default(100),
}).strict();

export const providerConfigSchema = z.discriminatedUnion('kind', [sesSchema, smtpSchema]);

export function mask(value: string): string {
  if (value.length < 9) return '****';
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

/**
 * config_public je ODVOZENA kopie pro UI a preflight, kterou aplikace prepisuje pri
 * kazdem zapisu ze stejneho vstupu. Zdrojem pravdy je sifrovana obalka; sender cte
 * jen ji, aby se dva zdroje nemohly rozejit.
 */
export function derivePublicConfig(config: ProviderConfig): ProviderPublicConfig {
  switch (config.kind) {
    case 'ses':
      return {
        kind: 'ses', region: config.region,
        configuration_set_name: config.configuration_set_name,
        sns_topic_arn: config.sns_topic_arn,
        access_key_id_masked: mask(config.access_key_id),
      };
    case 'smtp':
      return {
        kind: 'smtp', host: config.host, port: config.port,
        encryption: config.encryption, username_masked: mask(config.username),
      };
    default: {
      // Zadny switch nad typem provideru nesmi byt bez vetve default. Neznamy typ
      // se ohlasi jako nepodporovany a zbytek systemu bezi dal.
      const unknown = config as { kind: string };
      throw new Error(`Nepodporovaný typ odesílacího účtu: ${unknown.kind}`);
    }
  }
}
```

```ts
// packages/core/src/providers/crypto.ts
import { encryptCredential, decryptCredential } from '@mlain/contracts/crypto';
import { providerConfigSchema } from './config-schema';
import type { ProviderConfig } from './types';

/**
 * Jediny adapter na kontrakt 4. Kdyby se export z packages/contracts jmenoval jinak,
 * je to oprava na jednom miste, ne v patnacti.
 *
 * Kontext sending_provider a workspace_id v AAD brani dvema realnym utokum: presunu
 * zasifrovane hodnoty z jineho sloupce a presunu SES pristupu projektu A do radku
 * provideru projektu B.
 */
const CONTEXT = 'sending_provider';

export function encryptProviderConfig(config: ProviderConfig, workspaceId: string): string {
  return encryptCredential(providerConfigSchema.parse(config), { context: CONTEXT, workspaceId });
}

export function decryptProviderConfig(stored: string, workspaceId: string): ProviderConfig {
  return providerConfigSchema.parse(decryptCredential(stored, { context: CONTEXT, workspaceId }));
}

/** Pro migracni skript pri rotaci SECRET_KEY, viz cast 4a, 6.3. */
export function reencryptProviderCredentials(
  stored: string, workspaceId: string,
): string {
  return encryptProviderConfig(decryptProviderConfig(stored, workspaceId), workspaceId);
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:unit -- providers/config-schema`
Expected: PASS, 7 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/providers/types.ts packages/core/src/providers/config-schema.ts packages/core/src/providers/crypto.ts packages/core/src/providers/__tests__/config-schema.test.ts
git commit -m "feat(providers): SES and SMTP config schema, derived public copy, crypto adapter"
```

---

#### Úkol 28: Stavový stroj providera

**Files:**
- Create: `packages/core/src/providers/state-machine.ts`
- Test: `packages/core/src/providers/__tests__/state-machine.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/providers/__tests__/state-machine.test.ts
import { describe, expect, it } from 'vitest';
import { deriveProviderStatus, canSendWith } from '../state-machine';

const healthy = {
  credentialsValid: true, snsConfirmed: true, domainVerified: true,
  enforcementStatus: 'HEALTHY' as const, sendingEnabled: true, disabled: false, dmarcOk: true,
  eventsFlowing: true,
};

describe('stavovy stroj provideru', () => {
  it('vse v poradku je ready', () => {
    expect(deriveProviderStatus(healthy)).toBe('ready');
  });

  it('neplatne credentials jsou unverified', () => {
    expect(deriveProviderStatus({ ...healthy, credentialsValid: false })).toBe('unverified');
  });

  it('platne credentials bez potvrzeneho SNS jsou verifying', () => {
    expect(deriveProviderStatus({ ...healthy, snsConfirmed: false })).toBe('verifying');
  });

  it('SHUTDOWN je blocked', () => {
    expect(deriveProviderStatus({ ...healthy, enforcementStatus: 'SHUTDOWN' })).toBe('blocked');
  });

  it('sendingEnabled false je blocked, i kdyz je enforcement HEALTHY', () => {
    expect(deriveProviderStatus({ ...healthy, sendingEnabled: false })).toBe('blocked');
  });

  it('PROBATION je degraded a odesilat lze s varovanim', () => {
    expect(deriveProviderStatus({ ...healthy, enforcementStatus: 'PROBATION' })).toBe('degraded');
    expect(canSendWith('degraded')).toBe(true);
  });

  it('chybejici DMARC je degraded, ne blocked', () => {
    expect(deriveProviderStatus({ ...healthy, dmarcOk: false })).toBe('degraded');
  });

  it('prestaly chodit udalosti: degraded', () => {
    expect(deriveProviderStatus({ ...healthy, eventsFlowing: false })).toBe('degraded');
  });

  it('rucne vypnuty provider je disabled a odeslat nejde', () => {
    expect(deriveProviderStatus({ ...healthy, disabled: true })).toBe('disabled');
    expect(canSendWith('disabled')).toBe(false);
  });

  it('neznamy stav se povazuje za nepouzitelny, ne za pouzitelny', () => {
    expect(canSendWith('something_new')).toBe(false);
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:unit -- providers/state-machine`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napsat modul**

```ts
// packages/core/src/providers/state-machine.ts
import type { ProviderStatus } from './types';

export type ProviderSignals = {
  credentialsValid: boolean;
  snsConfirmed: boolean;
  domainVerified: boolean;
  enforcementStatus: 'HEALTHY' | 'PROBATION' | 'SHUTDOWN' | (string & {});
  sendingEnabled: boolean;
  disabled: boolean;
  dmarcOk: boolean;
  eventsFlowing: boolean;
};

export function deriveProviderStatus(s: ProviderSignals): ProviderStatus {
  if (s.disabled) return 'disabled';
  if (!s.credentialsValid) return 'unverified';
  if (s.enforcementStatus === 'SHUTDOWN' || !s.sendingEnabled) return 'blocked';
  if (!s.snsConfirmed || !s.domainVerified) return 'verifying';
  if (s.enforcementStatus === 'PROBATION' || !s.dmarcOk || !s.eventsFlowing) return 'degraded';
  return 'ready';
}

/**
 * Neznamy stav se povazuje za NEPOUZITELNY. Je to jediny bezpecny default: kdyby se
 * neznamy stav bral jako pouzitelny, prvni nova hodnota v budoucim vydani by pustila
 * odesilani z uctu, o kterem nic nevime.
 */
export function canSendWith(status: ProviderStatus): boolean {
  return status === 'ready' || status === 'degraded';
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:unit -- providers/state-machine`
Expected: PASS, 10 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/providers/state-machine.ts packages/core/src/providers/__tests__/state-machine.test.ts
git commit -m "feat(providers): provider status derivation with unusable-by-default unknown state"
```

---

#### Úkol 29: Čtení kvót a detekce sandboxu

**Files:**
- Create: `packages/core/src/providers/ses/client.ts`
- Create: `packages/core/src/providers/ses/account.ts`
- Test: `packages/core/src/providers/__tests__/account.test.ts`

- [ ] **Step 1: Napsat padající test proti fixtures**

```ts
// packages/core/src/providers/__tests__/account.test.ts
import { describe, expect, it } from 'vitest';
import sandbox from '@mlain/contracts/fixtures/ses/get-account-sandbox.json';
import shutdown from '@mlain/contracts/fixtures/ses/get-account-shutdown.json';
import { mapAccount, quotaRemaining, shouldPauseForQuota, shouldResumeForQuota } from '../ses/account';

describe('GetAccount', () => {
  it('sandbox se pozna z ProductionAccessEnabled, ne z hodnoty 200', () => {
    const a = mapAccount(sandbox as never);
    expect(a.production_access).toBe(false);
    expect(a.quota_max_24h).toBe((sandbox as { SendQuota: { Max24HourSend: number } }).SendQuota.Max24HourSend);
  });

  it('SHUTDOWN se propise do enforcement_status', () => {
    expect(mapAccount(shutdown as never).enforcement_status).toBe('SHUTDOWN');
  });

  it('zbyvajici kvota je max minus spotreba, nikdy zaporna', () => {
    expect(quotaRemaining({ quota_max_24h: 50_000, quota_sent_24h: 49_500 })).toBe(500);
    expect(quotaRemaining({ quota_max_24h: 200, quota_sent_24h: 500 })).toBe(0);
  });

  it('pauza pri poklesu pod 100, obnoveni az nad 1000', () => {
    expect(shouldPauseForQuota(80, { pauseBelow: 100 })).toBe(true);
    expect(shouldPauseForQuota(150, { pauseBelow: 100 })).toBe(false);
    expect(shouldResumeForQuota(1500, { resumeAbove: 1000 })).toBe(true);
    expect(shouldResumeForQuota(500, { resumeAbove: 1000 })).toBe(false);
  });

  it('mezera mezi prahy je hystereze a musi zustat', () => {
    expect(shouldPauseForQuota(500, { pauseBelow: 100 })).toBe(false);
    expect(shouldResumeForQuota(500, { resumeAbove: 1000 })).toBe(false);
  });

  it('chybejici pole neshodi mapovani, jen zustanou null', () => {
    expect(mapAccount({} as never)).toMatchObject({ quota_max_24h: null, sending_enabled: null });
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:unit -- providers/account`
Expected: FAIL, moduly neexistují.

- [ ] **Step 3: Napsat klienta a mapování**

```ts
// packages/core/src/providers/ses/client.ts
import { SESv2Client } from '@aws-sdk/client-sesv2';
import { SNSClient } from '@aws-sdk/client-sns';
import type { SesConfig } from '../types';

export type AwsClients = { ses: SESv2Client; sns: SNSClient };

/**
 * Timeout 5 s (AWS_API_TIMEOUT_MS). Kdyz volani selze, pouzije se posledni znama
 * hodnota a prida se varovani. Selhani NEBLOKUJE bezici kampan, ale BLOKUJE spusteni
 * nove (preflight kontrola 3).
 */
export function createAwsClients(config: SesConfig, timeoutMs: number): AwsClients {
  const credentials = {
    accessKeyId: config.access_key_id,
    secretAccessKey: config.secret_access_key,
  };
  const requestHandler = { requestTimeout: timeoutMs, connectionTimeout: timeoutMs };
  return {
    ses: new SESv2Client({ region: config.region, credentials, requestHandler }),
    sns: new SNSClient({ region: config.region, credentials, requestHandler }),
  };
}
```

```ts
// packages/core/src/providers/ses/account.ts

export type SesGetAccountResponse = {
  SendQuota?: { Max24HourSend?: number; MaxSendRate?: number; SentLast24Hours?: number };
  ProductionAccessEnabled?: boolean;
  EnforcementStatus?: string;
  SendingEnabled?: boolean;
  Details?: { ReviewDetails?: { Status?: string } };
};

export type AccountSnapshot = {
  quota_max_24h: number | null;
  quota_max_send_rate: number | null;
  quota_sent_24h: number | null;
  production_access: boolean | null;
  enforcement_status: string | null;
  sending_enabled: boolean | null;
  review_status: string | null;
};

/**
 * Sandboxove hodnoty jsou podle dokumentace Max24HourSend = 200 a MaxSendRate = 1,
 * ale NIKDY je nepredpokladame, vzdy cteme z API. Sandbox se pozna z
 * ProductionAccessEnabled, ne z hodnoty kvoty.
 */
export function mapAccount(r: SesGetAccountResponse): AccountSnapshot {
  return {
    quota_max_24h: r.SendQuota?.Max24HourSend ?? null,
    quota_max_send_rate: r.SendQuota?.MaxSendRate ?? null,
    quota_sent_24h: r.SendQuota?.SentLast24Hours ?? null,
    production_access: r.ProductionAccessEnabled ?? null,
    enforcement_status: r.EnforcementStatus ?? null,
    sending_enabled: r.SendingEnabled ?? null,
    review_status: r.Details?.ReviewDetails?.Status ?? null,
  };
}

export function quotaRemaining(a: { quota_max_24h: number | null; quota_sent_24h: number | null }): number {
  if (a.quota_max_24h == null) return Number.POSITIVE_INFINITY;
  return Math.max(0, a.quota_max_24h - (a.quota_sent_24h ?? 0));
}

/**
 * Mezera mezi prahy je HYSTEREZE a musi zustat: kdyby se pauzovalo i obnovovalo
 * na stejnem cisle, kampan by u vycerpane kvoty cyklila mezi paused a sending
 * kazdych deset minut.
 */
export function shouldPauseForQuota(remaining: number, cfg: { pauseBelow: number }): boolean {
  return remaining < cfg.pauseBelow;
}

export function shouldResumeForQuota(remaining: number, cfg: { resumeAbove: number }): boolean {
  return remaining > cfg.resumeAbove;
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:unit -- providers/account`
Expected: PASS, 6 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/providers/ses/client.ts packages/core/src/providers/ses/account.ts packages/core/src/providers/__tests__/account.test.ts
git commit -m "feat(providers): GetAccount mapping, quota hysteresis and sandbox detection"
```

---

#### Úkol 30: Test SMTP připojení bez knihovny

**Files:**
- Create: `packages/core/src/providers/smtp/verify.ts`
- Test: `packages/core/src/providers/__tests__/smtp-verify.test.ts`

- [ ] **Step 1: Napsat padající test proti falešnému SMTP serveru**

```ts
// packages/core/src/providers/__tests__/smtp-verify.test.ts
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:net';
import { verifySmtp, classifySmtpError } from '../smtp/verify';

let server: Server | undefined;
afterEach(() => server?.close());

function fakeSmtp(script: string[]): Promise<number> {
  return new Promise((resolve) => {
    server = createServer((socket) => {
      let step = 0;
      socket.write(script[step++]);
      socket.on('data', () => { if (step < script.length) socket.write(script[step++]); });
    });
    server.listen(0, () => resolve((server!.address() as { port: number }).port));
  });
}

describe('test SMTP pripojeni', () => {
  it('uspesny dialog vrati ok', async () => {
    const port = await fakeSmtp(['220 ok\r\n', '250-x\r\n250 AUTH LOGIN PLAIN\r\n', '235 ok\r\n', '250 ok\r\n', '221 bye\r\n']);
    const r = await verifySmtp({ host: '127.0.0.1', port, username: 'u', password: 'p', encryption: 'none', timeoutMs: 2000 });
    expect(r.ok).toBe(true);
  });

  it('535 mapuje na provider_smtp_auth_failed', async () => {
    const port = await fakeSmtp(['220 ok\r\n', '250 AUTH LOGIN PLAIN\r\n', '535 bad\r\n']);
    const r = await verifySmtp({ host: '127.0.0.1', port, username: 'u', password: 'p', encryption: 'none', timeoutMs: 2000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('provider_smtp_auth_failed');
  });

  it('neplatne uvitani mapuje na provider_smtp_greeting_invalid', async () => {
    const port = await fakeSmtp(['500 nope\r\n']);
    const r = await verifySmtp({ host: '127.0.0.1', port, username: 'u', password: 'p', encryption: 'none', timeoutMs: 2000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('provider_smtp_greeting_invalid');
  });

  it('neznamy host mapuje na provider_smtp_host_unknown', async () => {
    const r = await verifySmtp({ host: 'nope.invalid', port: 587, username: 'u', password: 'p', encryption: 'none', timeoutMs: 2000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('provider_smtp_host_unknown');
  });

  it('timeout 10 s mapuje na provider_smtp_timeout', async () => {
    const port = await fakeSmtp([]);
    const r = await verifySmtp({ host: '127.0.0.1', port, username: 'u', password: 'p', encryption: 'none', timeoutMs: 200 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('provider_smtp_timeout');
  });

  it.each([
    ['ECONNREFUSED', 'provider_smtp_connection_refused'],
    ['ENOTFOUND', 'provider_smtp_host_unknown'],
    ['CERT_HAS_EXPIRED', 'provider_smtp_tls_invalid'],
  ] as const)('kod %s mapuje na %s', (code, expected) => {
    expect(classifySmtpError({ code })).toBe(expected);
  });

  it('test neposila testovaci mail, jen NOOP a QUIT', async () => {
    const seen: string[] = [];
    const port = await new Promise<number>((resolve) => {
      server = createServer((socket) => {
        socket.write('220 ok\r\n');
        socket.on('data', (b) => {
          seen.push(b.toString());
          socket.write(seen.length === 1 ? '250 AUTH LOGIN PLAIN\r\n' : '250 ok\r\n');
        });
      });
      server.listen(0, () => resolve((server!.address() as { port: number }).port));
    });
    await verifySmtp({ host: '127.0.0.1', port, username: 'u', password: 'p', encryption: 'none', timeoutMs: 2000 });
    expect(seen.join('')).not.toMatch(/MAIL FROM|RCPT TO|DATA/);
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:unit -- providers/smtp-verify`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napsat test připojení**

```ts
// packages/core/src/providers/smtp/verify.ts
import { connect as netConnect, type Socket } from 'node:net';
import { connect as tlsConnect } from 'node:tls';

export type SmtpErrorCode =
  | 'provider_smtp_host_unknown' | 'provider_smtp_connection_refused'
  | 'provider_smtp_tls_invalid' | 'provider_smtp_auth_failed'
  | 'provider_smtp_timeout' | 'provider_smtp_starttls_unsupported'
  | 'provider_smtp_greeting_invalid';

export type SmtpVerifyResult =
  | { ok: true; banner: string }
  | { ok: false; code: SmtpErrorCode; detail: string };

export function classifySmtpError(err: { code?: string }): SmtpErrorCode {
  switch (err.code) {
    case 'ENOTFOUND': case 'EAI_AGAIN': return 'provider_smtp_host_unknown';
    case 'ECONNREFUSED': return 'provider_smtp_connection_refused';
    case 'ETIMEDOUT': return 'provider_smtp_timeout';
    default:
      if ((err.code ?? '').startsWith('CERT_') || (err.code ?? '').includes('TLS')) {
        return 'provider_smtp_tls_invalid';
      }
      return 'provider_smtp_connection_refused';
  }
}

/**
 * Test otevre spojeni, provede STARTTLS nebo prime TLS, prihlasi se, posle NOOP a QUIT.
 * NEPOSILA testovaci mail, protoze uzivatel na to v tomhle kroku neceka.
 * Na to staci node:net a node:tls; nodemailer by pridal zhruba 600 kB zavislosti
 * kvuli jednomu tlacitku v nastaveni a skutecne odesilani stejne dela sender v Go.
 */
export async function verifySmtp(input: {
  host: string; port: number; username: string; password: string;
  encryption: 'starttls' | 'tls' | 'none'; timeoutMs: number;
}): Promise<SmtpVerifyResult> {
  let socket: Socket | undefined;
  try {
    socket = await open(input);
    const banner = await expect(socket, 220, input.timeoutMs);
    if (!banner.startsWith('220')) {
      return { ok: false, code: 'provider_smtp_greeting_invalid', detail: banner.trim() };
    }

    const ehlo = await command(socket, `EHLO mlain.local`, input.timeoutMs);
    if (input.encryption === 'starttls') {
      if (!/STARTTLS/i.test(ehlo)) {
        return { ok: false, code: 'provider_smtp_starttls_unsupported', detail: ehlo.trim() };
      }
      await command(socket, 'STARTTLS', input.timeoutMs);
      socket = upgrade(socket, input.host);
      await command(socket, `EHLO mlain.local`, input.timeoutMs);
    }

    const auth = Buffer.from(`\0${input.username}\0${input.password}`).toString('base64');
    const authReply = await command(socket, `AUTH PLAIN ${auth}`, input.timeoutMs);
    if (!authReply.startsWith('235')) {
      return { ok: false, code: 'provider_smtp_auth_failed', detail: authReply.trim() };
    }

    await command(socket, 'NOOP', input.timeoutMs);
    await command(socket, 'QUIT', input.timeoutMs);
    return { ok: true, banner: banner.trim() };
  } catch (err) {
    const e = err as { code?: string; message?: string };
    if (e.message === 'smtp_timeout') {
      return { ok: false, code: 'provider_smtp_timeout', detail: 'Server neodpověděl včas.' };
    }
    return { ok: false, code: classifySmtpError(e), detail: e.message ?? 'neznámá chyba' };
  } finally {
    socket?.destroy();
  }
}

function open(input: { host: string; port: number; encryption: string; timeoutMs: number }): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const s = input.encryption === 'tls'
      ? tlsConnect({ host: input.host, port: input.port, servername: input.host })
      : netConnect({ host: input.host, port: input.port });
    s.setTimeout(input.timeoutMs);
    s.once('timeout', () => reject(new Error('smtp_timeout')));
    s.once('error', reject);
    s.once(input.encryption === 'tls' ? 'secureConnect' : 'connect', () => resolve(s as Socket));
  });
}

function upgrade(socket: Socket, host: string): Socket {
  return tlsConnect({ socket, servername: host }) as unknown as Socket;
}

function expect(socket: Socket, _code: number, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('smtp_timeout')), timeoutMs);
    socket.once('data', (b) => { clearTimeout(timer); resolve(b.toString()); });
    socket.once('error', (e) => { clearTimeout(timer); reject(e); });
  });
}

async function command(socket: Socket, line: string, timeoutMs: number): Promise<string> {
  socket.write(`${line}\r\n`);
  return expect(socket, 250, timeoutMs);
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:unit -- providers/smtp-verify`
Expected: PASS, 9 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/providers/smtp/verify.ts packages/core/src/providers/__tests__/smtp-verify.test.ts
git commit -m "feat(providers): SMTP connection test over node:net and node:tls"
```

---

#### Úkol 31: Repository providerů a jobu `provider.refresh_quota`

**Files:**
- Create: `packages/core/src/providers/repo/provider.ts`
- Create: `packages/core/src/campaigns/jobs/provider-refresh-quota.ts`
- Test: `packages/core/src/providers/repo/__tests__/provider.db.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/providers/repo/__tests__/provider.db.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { withTestWorkspace, seedProvider, seedCampaign } from '../../../testing/harness';
import { createProvider, setDefaultProvider, updateAccountSnapshot, listStaleQuota, getProviderById } from '../provider';
import { getCampaign } from '../../campaigns/campaign';

describe('repository provideru', () => {
  let ctx: Awaited<ReturnType<typeof withTestWorkspace>>;
  beforeEach(async () => { ctx = await withTestWorkspace(); });

  it('prave jeden vychozi provider na projekt', async () => {
    const a = await seedProvider(ctx, { isDefault: true });
    const b = await seedProvider(ctx, { isDefault: false });
    await setDefaultProvider(ctx.workspace, b);
    expect((await getProviderById(ctx.workspace, a))!.is_default).toBe(false);
    expect((await getProviderById(ctx.workspace, b))!.is_default).toBe(true);
  });

  it('API nikdy nevraci tajemstvi, jen maskovany klic', async () => {
    const id = await seedProvider(ctx, {});
    const p = await getProviderById(ctx.workspace, id);
    expect(JSON.stringify(p!.config_public)).toMatch(/\*\*\*\*/);
    expect(p).not.toHaveProperty('config_encrypted');
  });

  it('snapshot uctu se propise do sloupcu a nastavi quota_checked_at', async () => {
    const id = await seedProvider(ctx, {});
    await updateAccountSnapshot(ctx.workspace, id, {
      quota_max_24h: 50_000, quota_max_send_rate: 14, quota_sent_24h: 100,
      production_access: true, enforcement_status: 'HEALTHY', sending_enabled: true, review_status: null,
    });
    const p = await getProviderById(ctx.workspace, id);
    expect(p!.quota_max_24h).toBe(50_000);
    expect(p!.quota_checked_at).not.toBeNull();
  });

  it('job vybira providery s nejstarsi kontrolou kvoty', async () => {
    const old = await seedProvider(ctx, { status: 'ready', quotaCheckedMinutesAgo: 120 });
    await seedProvider(ctx, { status: 'ready', quotaCheckedMinutesAgo: 1 });
    const stale = await listStaleQuota(ctx.workspace, { limit: 1 });
    expect(stale[0].id).toBe(old);
  });

  it('provider s bezici kampani nejde smazat', async () => {
    const id = await seedProvider(ctx, {});
    await seedCampaign(ctx, { status: 'sending', providerId: id });
    await expect(createProvider).toBeDefined();
    const { deleteProvider } = await import('../provider');
    await expect(deleteProvider(ctx.workspace, id)).rejects.toThrowError(/conflict/);
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:db -- provider.db`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napsat repository a job**

```ts
// packages/core/src/providers/repo/provider.ts
import { withWorkspace, type WorkspaceContext } from '@mlain/core/tx';
import { AppError } from '@mlain/core/errors';
import { rawSql } from './raw-sql.js';

export type ProviderRow = {
  id: string; workspace_id: string; name: string; type: string;
  config_public: unknown; is_default: boolean; status: string; status_detail: unknown;
  verified_at: string | null; quota_max_24h: number | null; quota_max_send_rate: string | null;
  quota_sent_24h: number | null; production_access: boolean | null;
  enforcement_status: string | null; sending_enabled: boolean | null;
  quota_checked_at: string | null; created_at: string; updated_at: string;
};

const PUBLIC_COLUMNS = `id, workspace_id, name, type, config_public, is_default, status,
  status_detail, verified_at, quota_max_24h, quota_max_send_rate, quota_sent_24h,
  production_access, enforcement_status, sending_enabled, quota_checked_at, created_at, updated_at`;

/** config_encrypted se ze zadneho ctecího dotazu nevraci. Sifra se cte jen pri volani AWS. */
export async function getProviderById(ctx: WorkspaceContext, id: string): Promise<ProviderRow | null> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<ProviderRow>(rawSql(
      `SELECT ${PUBLIC_COLUMNS} FROM sending_providers WHERE id = $1 AND workspace_id = $2`,
      [id, ctx.workspaceId],
    ));
    return r.rows[0] ?? null;
  });
}

export async function getProviderSecret(ctx: WorkspaceContext, id: string): Promise<string | null> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<{ config_encrypted: string }>(rawSql(
      `SELECT config_encrypted FROM sending_providers WHERE id = $1 AND workspace_id = $2`,
      [id, ctx.workspaceId],
    ));
    return r.rows[0]?.config_encrypted ?? null;
  });
}

export async function createProvider(
  ctx: WorkspaceContext,
  input: { name: string; type: string; configEncrypted: string; configPublic: unknown; isDefault: boolean },
): Promise<string> {
  return withWorkspace(ctx, async (tx) => {
    if (input.isDefault) {
      await tx.execute(rawSql(`UPDATE sending_providers SET is_default = false WHERE workspace_id = $1`, [ctx.workspaceId]));
    }
    const r = await tx.execute<{ id: string }>(rawSql(
      `INSERT INTO sending_providers (workspace_id, name, type, config_encrypted, config_public, is_default)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6) RETURNING id`,
      [ctx.workspaceId, input.name, input.type, input.configEncrypted, JSON.stringify(input.configPublic), input.isDefault],
    ));
    return r.rows[0].id;
  });
}

export async function setDefaultProvider(ctx: WorkspaceContext, id: string): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    await tx.execute(rawSql(`UPDATE sending_providers SET is_default = false WHERE workspace_id = $1`, [ctx.workspaceId]));
    await tx.execute(rawSql(
      `UPDATE sending_providers SET is_default = true, updated_at = now() WHERE id = $1 AND workspace_id = $2`,
      [id, ctx.workspaceId],
    ));
  });
}

export async function updateAccountSnapshot(
  ctx: WorkspaceContext,
  id: string,
  a: {
    quota_max_24h: number | null; quota_max_send_rate: number | null; quota_sent_24h: number | null;
    production_access: boolean | null; enforcement_status: string | null;
    sending_enabled: boolean | null; review_status: string | null;
  },
): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    await tx.execute(rawSql(
      `UPDATE sending_providers
          SET quota_max_24h = $3, quota_max_send_rate = $4, quota_sent_24h = $5,
              production_access = $6, enforcement_status = $7, sending_enabled = $8,
              review_status = $9,
              quota_checked_at = now(), updated_at = now()
        WHERE id = $1 AND workspace_id = $2`,
      // review_status musi byt v seznamu sloupcu. Drive prosel signaturou i ctenim
      // z AWS, ale v UPDATE chybel, takze hodnota tise mizela a preflight nemel podle
      // ceho rozlisit bezici zadost od zamitnute. Sloupec zavadi pozadavek R-P03.8.
      [id, ctx.workspaceId, a.quota_max_24h, a.quota_max_send_rate, a.quota_sent_24h,
        a.production_access, a.enforcement_status, a.sending_enabled, a.review_status],
    ));
  });
}

export async function setProviderStatus(
  ctx: WorkspaceContext, id: string, status: string, detail?: unknown,
): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    await tx.execute(rawSql(
      `UPDATE sending_providers SET status = $3, status_detail = $4::jsonb, updated_at = now()
        WHERE id = $1 AND workspace_id = $2`,
      [id, ctx.workspaceId, status, detail === undefined ? null : JSON.stringify(detail)],
    ));
  });
}

export async function listStaleQuota(
  ctx: WorkspaceContext, opts: { limit: number },
): Promise<Array<{ id: string }>> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<{ id: string }>(rawSql(
      `SELECT id FROM sending_providers
        WHERE workspace_id = $1 AND status IN ('ready','degraded')
        ORDER BY quota_checked_at NULLS FIRST
        LIMIT ${Number(opts.limit)}`,
      [ctx.workspaceId],
    ));
    return r.rows;
  });
}

export async function deleteProvider(ctx: WorkspaceContext, id: string): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    const running = await tx.execute<{ n: number }>(rawSql(
      `SELECT count(*)::int AS n FROM campaigns
        WHERE workspace_id = $1 AND provider_id = $2
          AND status IN ('queueing','sending','paused','scheduled') AND deleted_at IS NULL`,
      [ctx.workspaceId, id],
    ));
    if (running.rows[0].n > 0) {
      throw new AppError('conflict', { detail: 'Odesílací účet má rozpracovanou kampaň.' });
    }
    await tx.execute(rawSql(`DELETE FROM sending_providers WHERE id = $1 AND workspace_id = $2`, [id, ctx.workspaceId]));
  });
}
```

```ts
// packages/core/src/campaigns/jobs/provider-refresh-quota.ts
import { deriveProviderStatus } from '../../providers/state-machine';
import { quotaRemaining, shouldPauseForQuota } from '../../providers/ses/account';
import { buildPauseReason } from '../pause-reason';

export const REFRESH_QUOTA_JOB = {
  queue: 'provider.refresh_quota' as const,
  cron: '*/15 * * * *',
  singletonKey: (providerId: string) => `provider.quota:${providerId}`,
  retryLimit: 3,
  expireInSeconds: 120,
};

export type RefreshQuotaDeps = {
  loadProvider(workspaceId: string, providerId: string): Promise<{ type: string; signals: Parameters<typeof deriveProviderStatus>[0]; previousStatus: string }>;
  fetchAccount(workspaceId: string, providerId: string): Promise<{
    quota_max_24h: number | null; quota_sent_24h: number | null;
    enforcement_status: string | null; sending_enabled: boolean | null;
  } & Record<string, unknown>>;
  saveSnapshot(workspaceId: string, providerId: string, snapshot: unknown): Promise<void>;
  setStatus(workspaceId: string, providerId: string, status: string): Promise<void>;
  pauseAll(workspaceId: string, providerId: string, reason: ReturnType<typeof buildPauseReason>): Promise<{ paused: number }>;
  emit(input: { workspaceId: string; type: string; providerId: string; data?: unknown }): Promise<void>;
  quotaPauseBelow: number;
};

export async function refreshQuotaHandler(
  deps: RefreshQuotaDeps,
  payload: { workspaceId: string; providerId: string },
): Promise<void> {
  const { workspaceId, providerId } = payload;
  const before = await deps.loadProvider(workspaceId, providerId);

  // Selhani volani NEBLOKUJE bezici kampan: pouzije se posledni znama hodnota.
  let account: Awaited<ReturnType<RefreshQuotaDeps['fetchAccount']>>;
  try {
    account = await deps.fetchAccount(workspaceId, providerId);
  } catch {
    return;
  }
  await deps.saveSnapshot(workspaceId, providerId, account);

  const status = deriveProviderStatus({
    ...before.signals,
    enforcementStatus: (account.enforcement_status ?? 'HEALTHY') as never,
    sendingEnabled: account.sending_enabled ?? true,
  });

  if (status !== before.previousStatus) {
    await deps.setStatus(workspaceId, providerId, status);
    await deps.emit({ workspaceId, type: 'provider.status_changed', providerId, data: { from: before.previousStatus, to: status } });
  }

  // Prechod do blocked pozastavi vsechny bezici kampane toho provideru.
  if (status === 'blocked') {
    await deps.pauseAll(workspaceId, providerId, buildPauseReason('provider_blocked', 'app', {
      detail: `enforcement_status=${account.enforcement_status}, sending_enabled=${account.sending_enabled}`,
    }));
    return;
  }

  const remaining = quotaRemaining(account);
  if (shouldPauseForQuota(remaining, { pauseBelow: deps.quotaPauseBelow })) {
    await deps.pauseAll(workspaceId, providerId, buildPauseReason('provider_quota_exhausted', 'app', {
      detail: `zbývá ${remaining} zpráv z denního limitu`,
    }));
  }
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:db -- provider.db`
Expected: PASS, 5 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/providers/repo/provider.ts packages/core/src/campaigns/jobs/provider-refresh-quota.ts packages/core/src/providers/repo/__tests__/provider.db.test.ts
git commit -m "feat(providers): provider repository and refresh_quota job with blocked cascade"
```

---

#### Úkol 32: Job `campaign.resume_on_quota`

**Files:**
- Create: `packages/core/src/campaigns/jobs/resume-on-quota.ts`
- Test: `packages/core/src/campaigns/jobs/__tests__/resume-on-quota.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/campaigns/jobs/__tests__/resume-on-quota.test.ts
import { describe, expect, it, vi } from 'vitest';
import { resumeOnQuotaHandler, RESUME_ON_QUOTA_SQL } from '../resume-on-quota';

describe('automaticke obnoveni po uvolneni kvoty', () => {
  it('dotaz vybira podle pause_reason ->> code, nikdy podle textove hodnoty quota', () => {
    expect(RESUME_ON_QUOTA_SQL).toContain(`pause_reason ->> 'code' = 'provider_quota_exhausted'`);
    expect(RESUME_ON_QUOTA_SQL).not.toContain(`pause_reason = 'quota'`);
  });

  it.each(['sender', 'app'] as const)('obnovi kampan pozastavenou se source %s', async (source) => {
    const resume = vi.fn(async () => ({ resumed: true, status: 'sending' as const }));
    await resumeOnQuotaHandler({
      listPaused: async () => [{ workspaceId: 'w', campaignId: 'k', providerId: 'p', source }],
      remainingQuota: async () => 5000,
      resume,
      emit: async () => {},
      quotaResumeAbove: 1000,
    });
    expect(resume).toHaveBeenCalledWith('w', 'k');
  });

  it('neobnovi, dokud je kvota pod prahem obnoveni', async () => {
    const resume = vi.fn();
    await resumeOnQuotaHandler({
      listPaused: async () => [{ workspaceId: 'w', campaignId: 'k', providerId: 'p', source: 'sender' }],
      remainingQuota: async () => 500,
      resume,
      emit: async () => {},
      quotaResumeAbove: 1000,
    });
    expect(resume).not.toHaveBeenCalled();
  });

  it('po obnoveni posle webhook campaign.resumed', async () => {
    const emit = vi.fn(async () => {});
    await resumeOnQuotaHandler({
      listPaused: async () => [{ workspaceId: 'w', campaignId: 'k', providerId: 'p', source: 'app' }],
      remainingQuota: async () => 5000,
      resume: async () => ({ resumed: true, status: 'sending' }),
      emit,
      quotaResumeAbove: 1000,
    });
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: 'campaign.resumed' }));
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:unit -- resume-on-quota`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napsat handler**

```ts
// packages/core/src/campaigns/jobs/resume-on-quota.ts

export const RESUME_ON_QUOTA_JOB = {
  queue: 'campaign.resume_on_quota' as const,
  cron: '*/10 * * * *',
  retryLimit: 3,
  expireInSeconds: 300,
};

/**
 * Job vybira podle CODE, ne podle stare textove hodnoty. Je to konkretni chyba, kterou
 * by drivejsi zneni vyrobilo: job obnovoval kampane s pause_reason = 'quota', kdezto
 * sender zapisuje provider_quota_exhausted. Kampan pozastavenou senderem kvuli vycerpane
 * kvote by tedy NIKDY nerozjel, i kdyby kvota byla davno volna, a nic by neselhalo
 * ani se nezalogovalo. Uzivatel by videl kampan, ktera stoji a tvrdi, ze bude
 * pokracovat sama. Bez ohledu na source: kdo pauzu zapsal, na rozhodnuti "kvota je
 * zase volna, jed dal" nic nemeni.
 */
export const RESUME_ON_QUOTA_SQL = `
SELECT id, workspace_id, provider_id, pause_reason ->> 'source' AS source
  FROM campaigns
 WHERE status = 'paused'
   AND pause_reason ->> 'code' = 'provider_quota_exhausted'
   AND deleted_at IS NULL`;

export type ResumeOnQuotaDeps = {
  listPaused(): Promise<Array<{ workspaceId: string; campaignId: string; providerId: string | null; source: string }>>;
  remainingQuota(workspaceId: string, providerId: string | null): Promise<number>;
  resume(workspaceId: string, campaignId: string): Promise<{ resumed: boolean; status: string | null }>;
  emit(input: { workspaceId: string; type: string; campaignId: string }): Promise<void>;
  quotaResumeAbove: number;
};

export async function resumeOnQuotaHandler(deps: ResumeOnQuotaDeps): Promise<void> {
  for (const c of await deps.listPaused()) {
    const remaining = await deps.remainingQuota(c.workspaceId, c.providerId);
    if (remaining <= deps.quotaResumeAbove) continue;
    const r = await deps.resume(c.workspaceId, c.campaignId);
    if (r.resumed) {
      await deps.emit({ workspaceId: c.workspaceId, type: 'campaign.resumed', campaignId: c.campaignId });
    }
  }
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:unit -- resume-on-quota`
Expected: PASS, 5 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/campaigns/jobs/resume-on-quota.ts packages/core/src/campaigns/jobs/__tests__/resume-on-quota.test.ts
git commit -m "feat(campaigns): resume_on_quota selecting by pause_reason code, not source"
```

---

### Fáze G: odesílací domény a DNS

#### Úkol 33: Normalizace domény, DKIM tokeny a generování DNS záznamů

**Files:**
- Create: `packages/core/src/providers/ses/identity.ts`
- Test: `packages/core/src/providers/__tests__/identity.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/providers/__tests__/identity.test.ts
import { describe, expect, it } from 'vitest';
import custom from '@mlain/contracts/fixtures/ses/get-email-identity-custom-hosted-zone.json';
import { normalizeDomain, buildDnsRecords, mapIdentity } from '../ses/identity';

describe('odesilaci domena', () => {
  it.each([
    ['https://WWW.Example.CZ/', 'example.cz'],
    ['example.cz.', 'example.cz'],
    ['  Example.CZ ', 'example.cz'],
  ])('normalizuje %s na %s', (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });

  it('verejny sufix se odmita', () => {
    expect(() => normalizeDomain('co.uk')).toThrowError(/registrovatelná doména/);
  });

  it('CNAME hodnota se sklada ze SigningHostedZone z API, ne natvrdo', () => {
    const identity = mapIdentity(custom as never);
    expect(identity.dkim_hosted_zone).toBe('a31d.dkim.us-west-2.amazonses.com');
    const records = buildDnsRecords({
      domain: 'example.cz', tokens: identity.dkim_tokens,
      hostedZone: identity.dkim_hosted_zone!, region: 'us-west-2', mailFromSubdomain: null,
    });
    expect(records.find((r) => r.purpose === 'dkim')!.value).toContain('a31d.dkim.us-west-2.amazonses.com');
    expect(JSON.stringify(records)).not.toContain('"dkim.amazonses.com"');
  });

  it('zakladni sada je pet zaznamu: tri DKIM, SPF, DMARC', () => {
    const records = buildDnsRecords({
      domain: 'example.cz', tokens: ['a', 'b', 'c'], hostedZone: 'dkim.amazonses.com',
      region: 'eu-central-1', mailFromSubdomain: null,
    });
    expect(records).toHaveLength(5);
    expect(records.filter((r) => r.purpose === 'dkim')).toHaveLength(3);
  });

  it('s vlastni MAIL FROM je zaznamu sest a SPF se stehuje na subdomenu', () => {
    const records = buildDnsRecords({
      domain: 'example.cz', tokens: ['a', 'b', 'c'], hostedZone: 'dkim.amazonses.com',
      region: 'eu-central-1', mailFromSubdomain: 'mail',
    });
    expect(records).toHaveLength(6);
    expect(records.find((r) => r.purpose === 'spf')!.name).toBe('mail.example.cz');
    expect(records.find((r) => r.purpose === 'mail_from_mx')!.value)
      .toBe('10 feedback-smtp.eu-central-1.amazonses.com');
  });

  it('DMARC zacina na p=none, nikdy na p=reject', () => {
    const records = buildDnsRecords({
      domain: 'example.cz', tokens: ['a', 'b', 'c'], hostedZone: 'dkim.amazonses.com',
      region: 'eu-central-1', mailFromSubdomain: null,
    });
    const dmarc = records.find((r) => r.purpose === 'dmarc')!;
    expect(dmarc.value).toContain('p=none');
    expect(dmarc.value).not.toContain('p=reject');
    expect(dmarc.required).toBe(false);
  });

  it('nazev DKIM zaznamu nikdy nezacina podtrzitkem navic', () => {
    const records = buildDnsRecords({
      domain: 'example.cz', tokens: ['x7k2m'], hostedZone: 'dkim.amazonses.com',
      region: 'eu-central-1', mailFromSubdomain: null,
    });
    expect(records[0].name).toBe('x7k2m._domainkey.example.cz');
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:unit -- providers/identity`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napsat modul**

```ts
// packages/core/src/providers/ses/identity.ts
import psl from 'psl';

export type DnsRecord = {
  type: 'CNAME' | 'TXT' | 'MX';
  name: string;
  value: string;
  ttl: number;
  purpose: 'dkim' | 'spf' | 'dmarc' | 'mail_from_mx';
  required: boolean;
};

export function normalizeDomain(input: string): string {
  const cleaned = input.trim().toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^www\./, '')
    .replace(/\.$/, '');
  const parsed = psl.parse(cleaned);
  if ('error' in parsed || !parsed.domain) {
    throw new Error(`${cleaned} není registrovatelná doména.`);
  }
  return cleaned;
}

export type SesIdentityResponse = {
  DkimAttributes?: { Tokens?: string[]; SigningHostedZone?: string; Status?: string };
  VerificationStatus?: string;
  MailFromAttributes?: { MailFromDomain?: string; MailFromDomainStatus?: string };
};

export function mapIdentity(r: SesIdentityResponse) {
  return {
    dkim_tokens: r.DkimAttributes?.Tokens ?? [],
    dkim_hosted_zone: r.DkimAttributes?.SigningHostedZone ?? null,
    dkim_status: (r.DkimAttributes?.Status ?? 'NOT_STARTED').toLowerCase().replace(/_/g, '_'),
    ses_verification_status: r.VerificationStatus ?? null,
    mail_from_subdomain: r.MailFromAttributes?.MailFromDomain?.split('.')[0] ?? null,
    mail_from_status: r.MailFromAttributes?.MailFromDomainStatus ?? null,
  };
}

/**
 * SigningHostedZone je typicky dkim.amazonses.com, ale v nekterych regionech a celach
 * ma tvar <cell>.dkim.<region>.amazonses.com. Hodnotu NIKDY neskladame natvrdo,
 * vzdy ji bereme z odpovedi API. Je to casta chyba a v novejsich regionech vede
 * k domene, ktera se nikdy neoveri.
 */
export function buildDnsRecords(input: {
  domain: string;
  tokens: string[];
  hostedZone: string;
  region: string;
  mailFromSubdomain: string | null;
}): DnsRecord[] {
  const records: DnsRecord[] = input.tokens.map((token) => ({
    type: 'CNAME',
    name: `${token}._domainkey.${input.domain}`,
    value: `${token}.${input.hostedZone}`,
    ttl: 1800,
    purpose: 'dkim',
    required: true,
  }));

  const spfHost = input.mailFromSubdomain ? `${input.mailFromSubdomain}.${input.domain}` : input.domain;
  records.push({
    type: 'TXT', name: spfHost, value: 'v=spf1 include:amazonses.com ~all',
    ttl: 1800, purpose: 'spf', required: true,
  });

  if (input.mailFromSubdomain) {
    records.push({
      type: 'MX', name: spfHost, value: `10 feedback-smtp.${input.region}.amazonses.com`,
      ttl: 1800, purpose: 'mail_from_mx', required: true,
    });
  }

  // DMARC je jediny ze zaznamu, ktery muze USKODIT, kdyz se nastavi spatne. Prisna
  // politika muze zablokovat firemni maily z jinych systemu, treba fakturacnich.
  // Zacatecnikovi proto nikdy nedoporucujeme p=reject.
  records.push({
    type: 'TXT', name: `_dmarc.${input.domain}`,
    value: `v=DMARC1; p=none; rua=mailto:dmarc@${input.domain}; pct=100; adkim=r; aspf=r`,
    ttl: 1800, purpose: 'dmarc', required: false,
  });

  return records;
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:unit -- providers/identity`
Expected: PASS, 10 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/providers/ses/identity.ts packages/core/src/providers/__tests__/identity.test.ts
git commit -m "feat(providers): domain normalization and DNS records from API hosted zone"
```

---

#### Úkol 34: Kontrola SPF

**Files:**
- Create: `packages/core/src/providers/dns/resolver.ts`
- Create: `packages/core/src/providers/dns/spf.ts`
- Test: `packages/core/src/providers/__tests__/spf.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/providers/__tests__/spf.test.ts
import { describe, expect, it } from 'vitest';
import { checkSpf } from '../dns/spf';

const resolver = (records: string[][] | Error) => ({
  resolveTxt: async () => { if (records instanceof Error) throw records; return records; },
  resolveCname: async () => [], resolveMx: async () => [], resolveNs: async () => [],
});

describe('kontrola SPF', () => {
  it('chybejici zaznam je spf_ok false s nalezem spf_missing', async () => {
    const r = await checkSpf(resolver([]), 'example.cz');
    expect(r.ok).toBe(false);
    expect(r.findings[0].code).toBe('spf_missing');
  });

  it('dva zaznamy jsou spf_multiple_records', async () => {
    const r = await checkSpf(resolver([['v=spf1 include:a ~all'], ['v=spf1 include:b ~all']]), 'example.cz');
    expect(r.ok).toBe(false);
    expect(r.findings[0].code).toBe('spf_multiple_records');
  });

  it('casti zaznamu se spojuji bez oddelovace', async () => {
    const r = await checkSpf(resolver([['v=spf1 include:amaz', 'onses.com ~all']]), 'example.cz');
    expect(r.ok).toBe(true);
  });

  it('zaznam bez amazonses je spf_no_amazon', async () => {
    const r = await checkSpf(resolver([['v=spf1 include:_spf.google.com ~all']]), 'example.cz');
    expect(r.ok).toBe(false);
    expect(r.findings[0].code).toBe('spf_no_amazon');
  });

  it('+all je varovani, ne chyba', async () => {
    const r = await checkSpf(resolver([['v=spf1 include:amazonses.com +all']]), 'example.cz');
    expect(r.ok).toBe(true);
    expect(r.findings.some((f) => f.code === 'spf_permissive_all' && f.severity === 'warning')).toBe(true);
  });

  it('vic nez 10 lookupu je varovani', async () => {
    const many = `v=spf1 ${'include:x.cz '.repeat(11)}include:amazonses.com ~all`;
    const r = await checkSpf(resolver([[many]]), 'example.cz');
    expect(r.findings.some((f) => f.code === 'spf_too_many_lookups')).toBe(true);
  });

  it('SERVFAIL vraci null, ne false, protoze nevime', async () => {
    const err = Object.assign(new Error('servfail'), { code: 'SERVFAIL' });
    const r = await checkSpf(resolver(err), 'example.cz');
    expect(r.ok).toBeNull();
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:unit -- providers/spf`
Expected: FAIL, moduly neexistují.

- [ ] **Step 3: Napsat resolver a SPF**

```ts
// packages/core/src/providers/dns/resolver.ts
import { Resolver } from 'node:dns/promises';

export type DnsResolver = {
  resolveTxt(host: string): Promise<string[][]>;
  resolveCname(host: string): Promise<string[]>;
  resolveMx(host: string): Promise<Array<{ exchange: string; priority: number }>>;
  resolveNs(host: string): Promise<string[]>;
};

/** Vestaveny resolver Node, bez dalsi zavislosti. Timeout na dotaz je DNS_CHECK_TIMEOUT_MS. */
export function createResolver(timeoutMs: number): DnsResolver {
  const r = new Resolver({ timeout: timeoutMs, tries: 1 });
  return {
    resolveTxt: (h) => r.resolveTxt(h),
    resolveCname: (h) => r.resolveCname(h),
    resolveMx: (h) => r.resolveMx(h),
    resolveNs: (h) => r.resolveNs(h),
  };
}

export type Finding = {
  code: string;
  severity: 'error' | 'warning' | 'info';
  params?: Record<string, string | number>;
};

/** Rozlisuje se false (vime, ze to neni v poradku) a null (nevime). Null nesmi blokovat. */
export type CheckResult = { ok: boolean | null; findings: Finding[] };

export function unknownOnServfail(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  return code === 'SERVFAIL' || code === 'ETIMEOUT' || code === 'ECONNREFUSED' || code === 'EREFUSED';
}
```

```ts
// packages/core/src/providers/dns/spf.ts
import type { CheckResult, DnsResolver, Finding } from './resolver';
import { unknownOnServfail } from './resolver';

const LOOKUP_MECHANISMS = /\b(include|a|mx|ptr|exists|redirect)[:=]/g;

export async function checkSpf(
  resolver: DnsResolver,
  host: string,
): Promise<CheckResult & { record: string | null }> {
  let txt: string[][];
  try {
    txt = await resolver.resolveTxt(host);
  } catch (err) {
    if (unknownOnServfail(err)) {
      return { ok: null, record: null, findings: [{ code: 'spf_unknown', severity: 'warning' }] };
    }
    return { ok: false, record: null, findings: [{ code: 'spf_missing', severity: 'error' }] };
  }

  // TXT zaznamy jsou pole poli retezcu, jednotlive casti se spojuji BEZ oddelovace.
  const records = txt.map((parts) => parts.join('')).filter((r) => /^v=spf1\b/i.test(r));

  if (records.length === 0) {
    return { ok: false, record: null, findings: [{ code: 'spf_missing', severity: 'error' }] };
  }
  if (records.length > 1) {
    return {
      ok: false, record: records[0],
      findings: [{ code: 'spf_multiple_records', severity: 'error', params: { count: records.length } }],
    };
  }

  const record = records[0];
  const findings: Finding[] = [];

  const hasAmazon = /include:amazonses\.com/i.test(record) || /\bip[46]:/i.test(record);
  if (!hasAmazon) {
    return { ok: false, record, findings: [{ code: 'spf_no_amazon', severity: 'error' }] };
  }
  if (/\+all\s*$/i.test(record)) {
    findings.push({ code: 'spf_permissive_all', severity: 'warning' });
  }

  const lookups = (record.match(LOOKUP_MECHANISMS) ?? []).length;
  if (lookups > 10) {
    findings.push({ code: 'spf_too_many_lookups', severity: 'warning', params: { lookups } });
  }

  return { ok: true, record, findings };
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:unit -- providers/spf`
Expected: PASS, 7 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/providers/dns/resolver.ts packages/core/src/providers/dns/spf.ts packages/core/src/providers/__tests__/spf.test.ts
git commit -m "feat(providers): SPF check with null-when-unknown semantics"
```

---

#### Úkol 35: Kontrola DKIM, DMARC a MX

**Files:**
- Create: `packages/core/src/providers/dns/dkim.ts`
- Create: `packages/core/src/providers/dns/dmarc.ts`
- Create: `packages/core/src/providers/dns/mx.ts`
- Test: `packages/core/src/providers/__tests__/dkim-dmarc.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/providers/__tests__/dkim-dmarc.test.ts
import { describe, expect, it } from 'vitest';
import { checkDkim } from '../dns/dkim';
import { checkDmarc } from '../dns/dmarc';
import { checkMx } from '../dns/mx';

function res(map: Record<string, string[] | Error>) {
  return {
    resolveCname: async (h: string) => { const v = map[h]; if (!v) throw Object.assign(new Error(), { code: 'ENOTFOUND' }); if (v instanceof Error) throw v; return v; },
    resolveTxt: async (h: string) => { const v = map[h]; if (!v) throw Object.assign(new Error(), { code: 'ENOTFOUND' }); if (v instanceof Error) throw v; return (v as string[]).map((x) => [x]); },
    resolveMx: async (h: string) => { const v = map[h]; if (!v) throw Object.assign(new Error(), { code: 'ENOTFOUND' }); return (v as string[]).map((x) => ({ exchange: x, priority: 10 })); },
    resolveNs: async () => [],
  };
}

const tokens = ['a1', 'b2', 'c3'];
const zone = 'dkim.amazonses.com';
const all = Object.fromEntries(tokens.map((t) => [`${t}._domainkey.example.cz`, [`${t}.${zone}.`]]));

describe('DKIM', () => {
  it('vsechny tri sedi: ok true, found 3', async () => {
    const r = await checkDkim(res(all), { domain: 'example.cz', tokens, hostedZone: zone });
    expect(r).toMatchObject({ ok: true, found: 3, expected: 3 });
  });

  it('dva ze tri: ok false s poctem', async () => {
    const partial = { ...all }; delete partial['c3._domainkey.example.cz'];
    const r = await checkDkim(res(partial), { domain: 'example.cz', tokens, hostedZone: zone });
    expect(r).toMatchObject({ ok: false, found: 2 });
    expect(r.findings[0].code).toBe('dkim_partial');
  });

  it('CNAME miri jinam: dkim_wrong_value s ocekavanou hodnotou', async () => {
    const wrong = { ...all, 'a1._domainkey.example.cz': ['a1.jiny.provider.com'] };
    const r = await checkDkim(res(wrong), { domain: 'example.cz', tokens, hostedZone: zone });
    expect(r.findings.some((f) => f.code === 'dkim_wrong_value')).toBe(true);
  });

  it('zdvojeny nazev se hlasi jmenovite', async () => {
    const doubled = { ...all, 'a1._domainkey.example.cz.example.cz': [`a1.${zone}`] };
    delete (doubled as Record<string, unknown>)['a1._domainkey.example.cz'];
    const r = await checkDkim(res(doubled), { domain: 'example.cz', tokens, hostedZone: zone });
    expect(r.findings.some((f) => f.code === 'dkim_name_duplicated')).toBe(true);
  });

  it('SERVFAIL vraci null a uz overena domena zustava pouzitelna', async () => {
    const err = Object.assign(new Error(), { code: 'SERVFAIL' });
    const r = await checkDkim(res({ 'a1._domainkey.example.cz': err }), { domain: 'example.cz', tokens, hostedZone: zone });
    expect(r.ok).toBeNull();
  });
});

describe('DMARC', () => {
  it('chybejici zaznam je false a cervena', async () => {
    const r = await checkDmarc(res({}), 'example.cz');
    expect(r).toMatchObject({ ok: false, policy: null });
  });

  it('p=none je ok true, ale zluta', async () => {
    const r = await checkDmarc(res({ '_dmarc.example.cz': ['v=DMARC1; p=none'] }), 'example.cz');
    expect(r).toMatchObject({ ok: true, policy: 'none', color: 'yellow' });
  });

  it('p=quarantine je zelena', async () => {
    const r = await checkDmarc(res({ '_dmarc.example.cz': ['v=DMARC1; p=quarantine'] }), 'example.cz');
    expect(r.color).toBe('green');
  });

  it('pct pod 100 je zluta', async () => {
    const r = await checkDmarc(res({ '_dmarc.example.cz': ['v=DMARC1; p=reject; pct=50'] }), 'example.cz');
    expect(r).toMatchObject({ pct: 50, color: 'yellow' });
  });

  it('dva zaznamy jsou chyba', async () => {
    const r = await checkDmarc(res({ '_dmarc.example.cz': ['v=DMARC1; p=none', 'v=DMARC1; p=reject'] }), 'example.cz');
    expect(r.findings[0].code).toBe('dmarc_multiple_records');
  });

  it('organizational domain se urcuje pres psl', async () => {
    const r = await checkDmarc(res({ '_dmarc.example.cz': ['v=DMARC1; p=none'] }), 'mail.example.cz');
    expect(r.ok).toBe(true);
  });

  it('aspf=s bez vlastni MAIL FROM hlasi alignment', async () => {
    const r = await checkDmarc(res({ '_dmarc.example.cz': ['v=DMARC1; p=none; aspf=s'] }), 'example.cz', { hasCustomMailFrom: false });
    expect(r.findings.some((f) => f.code === 'dmarc_spf_alignment_strict')).toBe(true);
  });
});

describe('MX pro vlastni MAIL FROM', () => {
  it('chybejici MX je varovani, ne chyba', async () => {
    const r = await checkMx(res({}), { mailFromDomain: 'mail.example.cz', region: 'eu-central-1' });
    expect(r.findings[0].severity).toBe('warning');
  });

  it('spravny MX je ok', async () => {
    const r = await checkMx(res({ 'mail.example.cz': ['feedback-smtp.eu-central-1.amazonses.com'] }),
      { mailFromDomain: 'mail.example.cz', region: 'eu-central-1' });
    expect(r.ok).toBe(true);
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:unit -- providers/dkim-dmarc`
Expected: FAIL, moduly neexistují.

- [ ] **Step 3: Napsat tři kontroly**

```ts
// packages/core/src/providers/dns/dkim.ts
import type { DnsResolver, Finding } from './resolver';
import { unknownOnServfail } from './resolver';

/**
 * Nejcastejsi duvod, proc zaznam nefunguje: v jednom panelu se zadava
 * x7k2m._domainkey, v jinem x7k2m._domainkey.kolo-shop.cz, a kdyz se to plete,
 * vznikne x7k2m._domainkey.kolo-shop.cz.kolo-shop.cz. Tuhle konkretni chybu
 * detekujeme a hlasime jmenovite.
 */
export async function checkDkim(
  resolver: DnsResolver,
  input: { domain: string; tokens: string[]; hostedZone: string },
): Promise<{ ok: boolean | null; found: number; expected: number; findings: Finding[] }> {
  const findings: Finding[] = [];
  let found = 0;
  let unknown = false;

  for (const token of input.tokens) {
    const name = `${token}._domainkey.${input.domain}`;
    const expected = `${token}.${input.hostedZone}`.toLowerCase();
    try {
      const values = await resolver.resolveCname(name);
      const normalized = values.map((v) => v.toLowerCase().replace(/\.$/, ''));
      if (normalized.includes(expected)) found += 1;
      else findings.push({ code: 'dkim_wrong_value', severity: 'error', params: { name, expected, actual: normalized[0] ?? '' } });
    } catch (err) {
      if (unknownOnServfail(err)) { unknown = true; continue; }
      try {
        const doubled = `${token}._domainkey.${input.domain}.${input.domain}`;
        await resolver.resolveCname(doubled);
        findings.push({ code: 'dkim_name_duplicated', severity: 'error', params: { found: doubled, expected: `${token}._domainkey` } });
      } catch {
        findings.push({ code: 'dkim_missing', severity: 'error', params: { name } });
      }
    }
  }

  if (unknown && found < input.tokens.length) {
    return { ok: null, found, expected: input.tokens.length, findings: [{ code: 'dkim_unknown', severity: 'warning' }] };
  }
  if (found === input.tokens.length) return { ok: true, found, expected: input.tokens.length, findings: [] };
  if (found > 0) {
    findings.unshift({ code: 'dkim_partial', severity: 'error', params: { found, expected: input.tokens.length } });
  }
  return { ok: false, found, expected: input.tokens.length, findings };
}
```

```ts
// packages/core/src/providers/dns/dmarc.ts
import psl from 'psl';
import type { DnsResolver, Finding } from './resolver';
import { unknownOnServfail } from './resolver';

export type DmarcResult = {
  ok: boolean | null;
  record: string | null;
  policy: 'none' | 'quarantine' | 'reject' | null;
  pct: number | null;
  color: 'green' | 'yellow' | 'red' | 'grey';
  findings: Finding[];
};

export async function checkDmarc(
  resolver: DnsResolver,
  host: string,
  opts: { hasCustomMailFrom?: boolean } = {},
): Promise<DmarcResult> {
  const parsed = psl.parse(host);
  const org = 'domain' in parsed && parsed.domain ? parsed.domain : host;

  let txt: string[][];
  try {
    txt = await resolver.resolveTxt(`_dmarc.${org}`);
  } catch (err) {
    if (unknownOnServfail(err)) {
      return { ok: null, record: null, policy: null, pct: null, color: 'grey', findings: [{ code: 'dmarc_unknown', severity: 'warning' }] };
    }
    return { ok: false, record: null, policy: null, pct: null, color: 'red', findings: [{ code: 'dmarc_missing', severity: 'error' }] };
  }

  const records = txt.map((p) => p.join('')).filter((r) => /^v=DMARC1\b/i.test(r));
  if (records.length === 0) {
    return { ok: false, record: null, policy: null, pct: null, color: 'red', findings: [{ code: 'dmarc_missing', severity: 'error' }] };
  }
  if (records.length > 1) {
    return { ok: false, record: records[0], policy: null, pct: null, color: 'red', findings: [{ code: 'dmarc_multiple_records', severity: 'error' }] };
  }

  const record = records[0];
  const tags = Object.fromEntries(
    record.split(';').map((p) => p.trim().split('=')).filter((p) => p.length === 2).map(([k, v]) => [k.toLowerCase(), v.trim()]),
  );
  const policy = tags.p as DmarcResult['policy'];
  if (!policy || !['none', 'quarantine', 'reject'].includes(policy)) {
    return { ok: false, record, policy: null, pct: null, color: 'red', findings: [{ code: 'dmarc_invalid_syntax', severity: 'error', params: { tag: 'p' } }] };
  }

  const pct = tags.pct ? Number(tags.pct) : 100;
  const findings: Finding[] = [];
  if (policy === 'none') findings.push({ code: 'dmarc_policy_none', severity: 'warning' });
  if (pct < 100) findings.push({ code: 'dmarc_partial_pct', severity: 'warning', params: { pct } });
  if (tags.aspf === 's' && opts.hasCustomMailFrom === false) {
    findings.push({ code: 'dmarc_spf_alignment_strict', severity: 'warning' });
  }

  const color: DmarcResult['color'] = policy === 'none' || pct < 100 ? 'yellow' : 'green';
  return { ok: true, record, policy, pct, color, findings };
}
```

```ts
// packages/core/src/providers/dns/mx.ts
import type { DnsResolver, Finding } from './resolver';

/**
 * Kdyz MX chybi a BehaviorOnMxFailure je USE_DEFAULT_VALUE, hlasi se VAROVANI, ne chyba,
 * protoze SES v tom pripade pouzije vlastni domenu a maily odejdou.
 */
export async function checkMx(
  resolver: DnsResolver,
  input: { mailFromDomain: string; region: string },
): Promise<{ ok: boolean | null; records: string[]; findings: Finding[] }> {
  const expected = `feedback-smtp.${input.region}.amazonses.com`;
  try {
    const mx = await resolver.resolveMx(input.mailFromDomain);
    const records = mx.map((m) => m.exchange.toLowerCase().replace(/\.$/, ''));
    if (records.includes(expected)) return { ok: true, records, findings: [] };
    return { ok: false, records, findings: [{ code: 'mail_from_mx_wrong', severity: 'warning', params: { expected } }] };
  } catch {
    return { ok: false, records: [], findings: [{ code: 'mail_from_mx_missing', severity: 'warning', params: { expected } }] };
  }
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:unit -- providers/dkim-dmarc`
Expected: PASS, 14 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/providers/dns/dkim.ts packages/core/src/providers/dns/dmarc.ts packages/core/src/providers/dns/mx.ts packages/core/src/providers/__tests__/dkim-dmarc.test.ts
git commit -m "feat(providers): DKIM, DMARC and MX checks with named failure modes"
```

---

#### Úkol 36: Složení `DomainChecks`, cache a job `domain.recheck`

**Files:**
- Create: `packages/core/src/providers/dns/check-domain.ts`
- Create: `packages/core/src/campaigns/jobs/domain-recheck.ts`
- Create: `packages/core/src/providers/repo/domain.ts`
- Test: `packages/core/src/providers/__tests__/check-domain.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/providers/__tests__/check-domain.test.ts
import { describe, expect, it, vi } from 'vitest';
import { nextCheckAt, cacheTtlSeconds, runDomainChecks } from '../dns/check-domain';

describe('planovani kontrol domeny', () => {
  it.each([
    [5, 30], [60, 300], [10 * 60, 1800], [100 * 60, 6 * 3600],
  ])('po %s minutach od zalozeni je interval %s s', (ageMinutes, expected) => {
    expect(nextCheckAt({ ageMinutes, verified: false })).toBe(expected);
  });

  it('overena domena se kontroluje jednou za 24 hodin', () => {
    expect(nextCheckAt({ ageMinutes: 10_000, verified: true })).toBe(24 * 3600);
  });

  it('cache plati nejvyse 900 s a nejmene 60 s', () => {
    expect(cacheTtlSeconds([3600, 1800])).toBe(900);
    expect(cacheTtlSeconds([10])).toBe(60);
    expect(cacheTtlSeconds([300])).toBe(300);
  });

  it('cela kontrola ma strop 15 s, nedokoncene se zapisou jako null', async () => {
    const slow = () => new Promise((r) => setTimeout(() => r({ ok: true, findings: [] }), 50));
    const checks = await runDomainChecks({
      spf: slow as never, dkim: slow as never, dmarc: slow as never, mx: slow as never,
      overallTimeoutMs: 10,
    });
    expect(checks.spf.ok).toBeNull();
  });

  it('vysledek ma ctyri klice a kazdy nese checked_at', async () => {
    const ok = async () => ({ ok: true, findings: [] });
    const checks = await runDomainChecks({
      spf: ok as never, dkim: ok as never, dmarc: ok as never, mx: ok as never, overallTimeoutMs: 1000,
    });
    expect(Object.keys(checks).sort()).toEqual(['dkim', 'dmarc', 'mx', 'spf']);
    expect(checks.spf.checked_at).toMatch(/Z$/);
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:unit -- providers/check-domain`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napsat složení, repository a job**

```ts
// packages/core/src/providers/dns/check-domain.ts
import type { Finding } from './resolver';

export type DomainChecks = {
  spf: { ok: boolean | null; record: string | null; findings: Finding[]; checked_at: string };
  dkim: { ok: boolean | null; found: number; expected: number; findings: Finding[]; checked_at: string };
  dmarc: { ok: boolean | null; record: string | null; policy: 'none' | 'quarantine' | 'reject' | null; pct: number | null; findings: Finding[]; checked_at: string };
  mx: { ok: boolean | null; records: string[]; findings: Finding[]; checked_at: string };
};

/** Odstupnovana frekvence, aby uzivatel nemusel cekat u obrazovky. */
export function nextCheckAt(input: { ageMinutes: number; verified: boolean }): number {
  if (input.verified) return 24 * 3600;
  if (input.ageMinutes < 15) return 30;
  if (input.ageMinutes < 120) return 300;
  if (input.ageMinutes < 72 * 60) return 1800;
  return 6 * 3600;
}

/** Vysledek plati min(nejnizsi TTL z odpovedi, 900 s), nejmene 60 s. */
export function cacheTtlSeconds(ttls: number[]): number {
  const lowest = ttls.length ? Math.min(...ttls) : 900;
  return Math.max(60, Math.min(lowest, 900));
}

export async function runDomainChecks(input: {
  spf: () => Promise<Omit<DomainChecks['spf'], 'checked_at'>>;
  dkim: () => Promise<Omit<DomainChecks['dkim'], 'checked_at'>>;
  dmarc: () => Promise<Omit<DomainChecks['dmarc'], 'checked_at'>>;
  mx: () => Promise<Omit<DomainChecks['mx'], 'checked_at'>>;
  overallTimeoutMs: number;
}): Promise<DomainChecks> {
  const at = new Date().toISOString();
  const timeout = <T>(fallback: T) =>
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), input.overallTimeoutMs));

  const [spf, dkim, dmarc, mx] = await Promise.all([
    Promise.race([input.spf(), timeout({ ok: null, record: null, findings: [{ code: 'spf_unknown', severity: 'warning' as const }] })]),
    Promise.race([input.dkim(), timeout({ ok: null, found: 0, expected: 3, findings: [{ code: 'dkim_unknown', severity: 'warning' as const }] })]),
    Promise.race([input.dmarc(), timeout({ ok: null, record: null, policy: null, pct: null, findings: [{ code: 'dmarc_unknown', severity: 'warning' as const }] })]),
    Promise.race([input.mx(), timeout({ ok: null, records: [], findings: [] })]),
  ]);

  return {
    spf: { ...spf, checked_at: at },
    dkim: { ...dkim, checked_at: at },
    dmarc: { ...dmarc, checked_at: at },
    mx: { ...mx, checked_at: at },
  };
}
```

```ts
// packages/core/src/providers/repo/domain.ts
import { withWorkspace, type WorkspaceContext } from '@mlain/core/tx';
import { rawSql } from './raw-sql.js';

export type DomainRow = {
  id: string; workspace_id: string; provider_id: string; domain: string;
  dkim_tokens: string[]; dkim_hosted_zone: string | null; dkim_status: string;
  mail_from_subdomain: string | null; mail_from_status: string;
  spf_ok: boolean | null; dkim_ok: boolean | null; dmarc_ok: boolean | null; mx_ok: boolean | null;
  checks: unknown; checked_at: string | null; next_check_at: string | null;
  ses_verification_status: string | null; verified_at: string | null;
};

export async function saveChecks(
  ctx: WorkspaceContext,
  id: string,
  input: { checks: unknown; spf: boolean | null; dkim: boolean | null; dmarc: boolean | null; mx: boolean | null; nextCheckSeconds: number },
): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    await tx.execute(rawSql(
      `UPDATE sender_domains
          SET checks = $3::jsonb, spf_ok = $4, dkim_ok = $5, dmarc_ok = $6, mx_ok = $7,
              checked_at = now(), next_check_at = now() + ($8 || ' seconds')::interval,
              verified_at = CASE WHEN $5 AND $4 THEN COALESCE(verified_at, now()) ELSE verified_at END,
              updated_at = now()
        WHERE id = $1 AND workspace_id = $2`,
      [id, ctx.workspaceId, JSON.stringify(input.checks), input.spf, input.dkim, input.dmarc, input.mx, String(input.nextCheckSeconds)],
    ));
  });
}

export async function listDue(ctx: WorkspaceContext, limit: number): Promise<DomainRow[]> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<DomainRow>(rawSql(
      `SELECT * FROM sender_domains
        WHERE workspace_id = $1 AND next_check_at IS NOT NULL AND next_check_at <= now()
        ORDER BY next_check_at
        LIMIT ${Number(limit)}`,
      [ctx.workspaceId],
    ));
    return r.rows;
  });
}

export async function getDomain(ctx: WorkspaceContext, id: string): Promise<DomainRow | null> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<DomainRow>(rawSql(
      `SELECT * FROM sender_domains WHERE id = $1 AND workspace_id = $2`, [id, ctx.workspaceId]));
    return r.rows[0] ?? null;
  });
}
```

```ts
// packages/core/src/campaigns/jobs/domain-recheck.ts
import pLimit from 'p-limit';

export const DOMAIN_RECHECK_JOB = {
  queue: 'domain.recheck' as const,
  cron: '* * * * *',
  singletonKey: (domainId: string) => `domain.check:${domainId}`,
  retryLimit: 3,
  expireInSeconds: 120,
};

export type DomainRecheckDeps = {
  listDue(): Promise<Array<{ workspaceId: string; domainId: string; wasVerified: boolean }>>;
  check(workspaceId: string, domainId: string): Promise<{ dkimOk: boolean | null; spfOk: boolean | null }>;
  emit(input: { workspaceId: string; type: string; domainId: string; data: unknown }): Promise<void>;
  setProviderDegraded(workspaceId: string, domainId: string): Promise<void>;
  concurrency: number;
};

/**
 * Job je serialni jen v poradi vyberu, samotne kontrolky bezi soubezne s p-limit.
 * Pri stovkach domen by serialni pruchod trval minuty a domena zalozena na konci
 * fronty by se overila az za pul hodiny.
 *
 * Kdyz u OVERENE domeny prestane platit DKIM, bezici kampan se NEPOZASTAVI: SES
 * podepisuje z klice, ktery ma, a preruseni by uskodilo vic. Nova kampan se ale
 * spustit neda (preflight kontrola 4).
 */
export async function domainRecheckHandler(deps: DomainRecheckDeps): Promise<void> {
  const limit = pLimit(deps.concurrency);
  const due = await deps.listDue();
  await Promise.all(due.map((d) => limit(async () => {
    const r = await deps.check(d.workspaceId, d.domainId);
    const nowVerified = r.dkimOk === true && r.spfOk === true;
    if (d.wasVerified !== nowVerified) {
      await deps.emit({
        workspaceId: d.workspaceId, type: 'domain.verification_changed',
        domainId: d.domainId, data: { verified: nowVerified },
      });
      if (!nowVerified) await deps.setProviderDegraded(d.workspaceId, d.domainId);
    }
  })));
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:unit -- providers/check-domain`
Expected: PASS, 8 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/providers/dns/check-domain.ts packages/core/src/campaigns/jobs/domain-recheck.ts packages/core/src/providers/repo/domain.ts packages/core/src/providers/__tests__/check-domain.test.ts
git commit -m "feat(providers): domain check composition, staged frequency and recheck job"
```

---

#### Úkol 37: Založení Configuration Setu, topicu a odběru

**Files:**
- Create: `packages/core/src/providers/ses/events-setup.ts`
- Test: `packages/core/src/providers/__tests__/events-setup.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/providers/__tests__/events-setup.test.ts
import { describe, expect, it, vi } from 'vitest';
import { setupEventDestination, MATCHING_EVENT_TYPES, manualInstructions } from '../ses/events-setup';

function aws(over: Record<string, unknown> = {}) {
  return {
    getConfigurationSet: vi.fn(async () => { throw Object.assign(new Error(), { name: 'NotFoundException' }); }),
    createConfigurationSet: vi.fn(async () => ({})),
    putSuppressionOptions: vi.fn(async () => ({})),
    createTopic: vi.fn(async () => ({ TopicArn: 'arn:aws:sns:eu-central-1:1:mlain-acme-events' })),
    setTopicAttributes: vi.fn(async () => ({})),
    createEventDestination: vi.fn(async () => ({})),
    subscribe: vi.fn(async () => ({ SubscriptionArn: 'pending confirmation' })),
    ...over,
  };
}

const input = { workspaceSlug: 'acme', workspaceId: 'w1', providerId: 'p1', appUrl: 'https://mail.acme.cz', region: 'eu-central-1' };

describe('nastaveni udalosti u SES', () => {
  it('OPEN a CLICK se nezapinaji, ty vlastnime sami', () => {
    expect(MATCHING_EVENT_TYPES).toEqual(['SEND', 'REJECT', 'BOUNCE', 'COMPLAINT', 'DELIVERY', 'DELIVERY_DELAY', 'RENDERING_FAILURE']);
    expect(MATCHING_EVENT_TYPES).not.toContain('OPEN');
    expect(MATCHING_EVENT_TYPES).not.toContain('CLICK');
  });

  it('jmeno Configuration Setu je mlain-<slug>', async () => {
    const a = aws();
    await setupEventDestination(a as never, input);
    expect(a.createConfigurationSet).toHaveBeenCalledWith(expect.objectContaining({ name: 'mlain-acme' }));
  });

  it('existujici nas Configuration Set se znovu nezaklada', async () => {
    const a = aws({ getConfigurationSet: vi.fn(async () => ({ Tags: [{ Key: 'mlain:workspace', Value: 'w1' }] })) });
    await setupEventDestination(a as never, input);
    expect(a.createConfigurationSet).not.toHaveBeenCalled();
  });

  it('suppression u Amazonu je druha pojistka vedle nasi', async () => {
    const a = aws();
    await setupEventDestination(a as never, input);
    expect(a.putSuppressionOptions).toHaveBeenCalledWith(expect.objectContaining({ reasons: ['BOUNCE', 'COMPLAINT'] }));
  });

  it('odber miri na /api/webhooks/ses/<provider_id> a RawMessageDelivery je false', async () => {
    const a = aws();
    await setupEventDestination(a as never, input);
    expect(a.subscribe).toHaveBeenCalledWith(expect.objectContaining({
      protocol: 'https',
      endpoint: 'https://mail.acme.cz/api/webhooks/ses/p1',
      rawMessageDelivery: false,
    }));
  });

  it('SignatureVersion se nastavuje na 2', async () => {
    const a = aws();
    await setupEventDestination(a as never, input);
    expect(a.setTopicAttributes).toHaveBeenCalledWith(expect.objectContaining({ attributeName: 'SignatureVersion', attributeValue: '2' }));
  });

  it('rucni rezim vypise presne hodnoty a nesaha na AWS', () => {
    const m = manualInstructions(input);
    expect(m.configurationSetName).toBe('mlain-acme');
    expect(m.endpoint).toBe('https://mail.acme.cz/api/webhooks/ses/p1');
    expect(m.eventTypes).toEqual(MATCHING_EVENT_TYPES);
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:unit -- providers/events-setup`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napsat modul**

```ts
// packages/core/src/providers/ses/events-setup.ts

/**
 * OPEN ani CLICK nezapiname, ty vlastni cast 5 pres vlastni tokeny. Dvoji tracking
 * by prepisoval odkazy dvakrat.
 */
export const MATCHING_EVENT_TYPES = [
  'SEND', 'REJECT', 'BOUNCE', 'COMPLAINT', 'DELIVERY', 'DELIVERY_DELAY', 'RENDERING_FAILURE',
] as const;

export type AwsSetupClient = {
  getConfigurationSet(input: { name: string }): Promise<{ Tags?: Array<{ Key: string; Value: string }> }>;
  createConfigurationSet(input: { name: string; workspaceId: string }): Promise<unknown>;
  putSuppressionOptions(input: { name: string; reasons: string[] }): Promise<unknown>;
  createTopic(input: { name: string }): Promise<{ TopicArn?: string }>;
  setTopicAttributes(input: { topicArn: string; attributeName: string; attributeValue: string }): Promise<unknown>;
  createEventDestination(input: { configurationSetName: string; topicArn: string; eventTypes: readonly string[] }): Promise<unknown>;
  subscribe(input: { topicArn: string; protocol: string; endpoint: string; rawMessageDelivery: boolean }): Promise<unknown>;
};

export function manualInstructions(input: { workspaceSlug: string; providerId: string; appUrl: string }) {
  return {
    configurationSetName: `mlain-${input.workspaceSlug}`,
    topicName: `mlain-${input.workspaceSlug}-events`,
    endpoint: `${input.appUrl}/api/webhooks/ses/${input.providerId}`,
    eventTypes: MATCHING_EVENT_TYPES,
    suppressedReasons: ['BOUNCE', 'COMPLAINT'],
  };
}

export async function setupEventDestination(
  aws: AwsSetupClient,
  input: { workspaceSlug: string; workspaceId: string; providerId: string; appUrl: string; region: string },
): Promise<{ topicArn: string; configurationSetName: string }> {
  const name = `mlain-${input.workspaceSlug}`;

  let exists = false;
  try {
    const cs = await aws.getConfigurationSet({ name });
    exists = (cs.Tags ?? []).some((t) => t.Key === 'mlain:workspace' && t.Value === input.workspaceId);
  } catch {
    exists = false;
  }

  if (!exists) {
    // TrackingOptions se NENASTAVUJE: open a click resime vlastnimi tokeny.
    await aws.createConfigurationSet({ name, workspaceId: input.workspaceId });
  }
  // Uctova suppression u Amazonu je DRUHA pojistka vedle nasi vlastni.
  await aws.putSuppressionOptions({ name, reasons: ['BOUNCE', 'COMPLAINT'] });

  const topic = await aws.createTopic({ name: `mlain-${input.workspaceSlug}-events` });
  const topicArn = topic.TopicArn;
  if (!topicArn) throw new Error('SNS nevrátil ARN topicu.');

  await aws.setTopicAttributes({ topicArn, attributeName: 'SignatureVersion', attributeValue: '2' });
  await aws.createEventDestination({ configurationSetName: name, topicArn, eventTypes: MATCHING_EVENT_TYPES });
  // RawMessageDelivery = false, protoze potrebujeme podepsanou obalku SNS.
  await aws.subscribe({
    topicArn, protocol: 'https',
    endpoint: `${input.appUrl}/api/webhooks/ses/${input.providerId}`,
    rawMessageDelivery: false,
  });

  return { topicArn, configurationSetName: name };
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:unit -- providers/events-setup`
Expected: PASS, 7 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/providers/ses/events-setup.ts packages/core/src/providers/__tests__/events-setup.test.ts
git commit -m "feat(providers): SES configuration set, SNS topic and subscription setup"
```

---

### Fáze H: příjem událostí od providera

#### Úkol 38: Ověření podpisu SNS

**Files:**
- Create: `packages/core/src/providers/sns/verify.ts`
- Test: `packages/core/src/providers/__tests__/sns-verify.test.ts`

- [ ] **Step 1: Napsat padající test proti golden fixtures**

```ts
// packages/core/src/providers/__tests__/sns-verify.test.ts
import { describe, expect, it } from 'vitest';
import bounce from '@mlain/contracts/fixtures/sns/notification-bounce-permanent.json';
import badCert from '@mlain/contracts/fixtures/sns/invalid-cert-url.json';
import cases from '@mlain/contracts/fixtures/sns/string-to-sign-cases.json';
import { verifySnsMessage, isAllowedCertUrl, buildStringToSign } from '../sns/verify';

const alwaysValid = { validate: async () => true, fetchCert: async () => 'cert' };

describe('overeni podpisu SNS', () => {
  it('platna zprava se spravnym topicem projde', async () => {
    const r = await verifySnsMessage(bounce as never, {
      expectedTopicArn: (bounce as { TopicArn: string }).TopicArn,
      now: new Date((bounce as { Timestamp: string }).Timestamp),
      validator: alwaysValid,
    });
    expect(r.ok).toBe(true);
  });

  it('cizi topic vraci topic_mismatch', async () => {
    const r = await verifySnsMessage(bounce as never, {
      expectedTopicArn: 'arn:aws:sns:eu-central-1:9:cizi',
      now: new Date((bounce as { Timestamp: string }).Timestamp),
      validator: alwaysValid,
    });
    expect(r).toMatchObject({ ok: false, reason: 'topic_mismatch' });
  });

  it('cert URL mimo AWS domenu se ani nestahuje', async () => {
    let fetched = false;
    const r = await verifySnsMessage(badCert as never, {
      expectedTopicArn: (badCert as { TopicArn: string }).TopicArn,
      now: new Date(),
      validator: { validate: async () => true, fetchCert: async () => { fetched = true; return 'x'; } },
    });
    expect(r).toMatchObject({ ok: false, reason: 'cert_url_not_allowed' });
    expect(fetched).toBe(false);
  });

  it.each([
    ['https://sns.eu-central-1.amazonaws.com/x.pem', true],
    ['https://sns.cn-north-1.amazonaws.com.cn/x.pem', true],
    ['http://sns.eu-central-1.amazonaws.com/x.pem', false],
    ['https://evil.example.com/x.pem', false],
    ['https://sns.eu-central-1.amazonaws.com.evil.com/x.pem', false],
    ['https://sns.eu-central-1.amazonaws.com/x.txt', false],
  ])('cert URL %s je povolena: %s', (url, expected) => {
    expect(isAllowedCertUrl(url)).toBe(expected);
  });

  it('spatny podpis vraci bad_signature', async () => {
    const r = await verifySnsMessage(bounce as never, {
      expectedTopicArn: (bounce as { TopicArn: string }).TopicArn,
      now: new Date((bounce as { Timestamp: string }).Timestamp),
      validator: { validate: async () => false, fetchCert: async () => 'cert' },
    });
    expect(r).toMatchObject({ ok: false, reason: 'bad_signature' });
  });

  it('zprava starsi nez hodina je stale_timestamp, ale prijme se', async () => {
    const ts = (bounce as { Timestamp: string }).Timestamp;
    const r = await verifySnsMessage(bounce as never, {
      expectedTopicArn: (bounce as { TopicArn: string }).TopicArn,
      now: new Date(Date.parse(ts) + 2 * 3600 * 1000),
      validator: alwaysValid,
    });
    expect(r).toMatchObject({ ok: false, reason: 'stale_timestamp', accept: true });
  });

  it('SignatureVersion mimo 1 a 2 se odmita', async () => {
    const r = await verifySnsMessage({ ...(bounce as object), SignatureVersion: '3' } as never, {
      expectedTopicArn: (bounce as { TopicArn: string }).TopicArn,
      now: new Date((bounce as { Timestamp: string }).Timestamp),
      validator: alwaysValid,
    });
    expect(r).toMatchObject({ ok: false, reason: 'bad_signature' });
  });

  it('kanonizace string to sign sedi na vsechny golden pripady', () => {
    for (const c of cases as Array<{ message: Record<string, string>; expected: string }>) {
      expect(buildStringToSign(c.message)).toBe(c.expected);
    }
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:unit -- providers/sns-verify`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napsat ověření**

```ts
// packages/core/src/providers/sns/verify.ts
import MessageValidator from 'sns-validator';

export type SnsMessage = {
  Type: string; MessageId: string; TopicArn: string; Message: string; Timestamp: string;
  SignatureVersion: string; Signature: string; SigningCertURL: string;
  Subject?: string; Token?: string; SubscribeURL?: string;
};

export type VerifyReason = 'bad_signature' | 'cert_url_not_allowed' | 'topic_mismatch' | 'stale_timestamp';
export type VerifyResult = { ok: true } | { ok: false; reason: VerifyReason; accept?: boolean };

const AWS_SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;

/**
 * Bez teto kontroly je cele overeni k nicemu, protoze utocnik by podstrcil vlastni
 * certifikat. Kontroluje se soucasne schema https, host proti regularnimu vyrazu
 * a koncovka .pem.
 */
export function isAllowedCertUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && AWS_SNS_HOST.test(u.hostname) && u.pathname.endsWith('.pem');
  } catch {
    return false;
  }
}

const FIELDS: Record<string, string[]> = {
  Notification: ['Message', 'MessageId', 'Subject', 'Timestamp', 'TopicArn', 'Type'],
  SubscriptionConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
  UnsubscribeConfirmation: ['Message', 'MessageId', 'SubscribeURL', 'Timestamp', 'Token', 'TopicArn', 'Type'],
};

/**
 * Pole se radi abecedne, kazde je "nazev\nhodnota" oddelene \n, a zaverecny newline
 * se PRIDAVA. Dokumentace AWS uvadi opak, ale referencni implementace i sns-validator
 * ho pridavaji. Golden fixture string-to-sign-cases.json to fixuje proti realne
 * zachycene zprave, aby se to uz nikdy neresilo dohadem.
 */
export function buildStringToSign(msg: Record<string, string>): string {
  const fields = FIELDS[msg.Type] ?? FIELDS.Notification;
  let out = '';
  for (const f of fields) {
    if (msg[f] === undefined) continue;
    out += `${f}\n${msg[f]}\n`;
  }
  return out;
}

export type SnsValidator = {
  validate(msg: SnsMessage): Promise<boolean>;
  fetchCert(url: string): Promise<string>;
};

export function createSnsValidator(certCacheSeconds: number): SnsValidator {
  const validator = new MessageValidator(AWS_SNS_HOST, 'utf8');
  const cache = new Map<string, { cert: string; expires: number }>();
  return {
    validate: (msg) => new Promise((resolve) => validator.validate(msg as never, (err) => resolve(!err))),
    fetchCert: async (url) => {
      const hit = cache.get(url);
      if (hit && hit.expires > Date.now()) return hit.cert;
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      const cert = (await res.text()).slice(0, 32 * 1024);
      cache.set(url, { cert, expires: Date.now() + certCacheSeconds * 1000 });
      return cert;
    },
  };
}

export async function verifySnsMessage(
  msg: SnsMessage,
  opts: { expectedTopicArn: string | null; now: Date; validator: SnsValidator; maxAgeMs?: number },
): Promise<VerifyResult> {
  if (!['Notification', 'SubscriptionConfirmation', 'UnsubscribeConfirmation'].includes(msg.Type)) {
    return { ok: false, reason: 'bad_signature' };
  }
  // Obrana proti tomu, aby nekdo prihlasil nas endpoint ke svemu topicu a podstrcil
  // nam udalosti. Kontroluje se PRED stazenim certifikatu.
  if (opts.expectedTopicArn && msg.TopicArn !== opts.expectedTopicArn) {
    return { ok: false, reason: 'topic_mismatch' };
  }
  if (!isAllowedCertUrl(msg.SigningCertURL)) {
    return { ok: false, reason: 'cert_url_not_allowed' };
  }
  if (!['1', '2'].includes(String(msg.SignatureVersion))) {
    return { ok: false, reason: 'bad_signature' };
  }
  if (!(await opts.validator.validate(msg))) {
    return { ok: false, reason: 'bad_signature' };
  }

  const ageMs = opts.now.getTime() - Date.parse(msg.Timestamp);
  if (ageMs > (opts.maxAgeMs ?? 3_600_000)) {
    // Prijme se s 200, ale nezpracuje: poradi u tak stare zpravy uz nedava smysl
    // a je to spis pokus o replay.
    return { ok: false, reason: 'stale_timestamp', accept: true };
  }
  return { ok: true };
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:unit -- providers/sns-verify`
Expected: PASS, 13 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/providers/sns/verify.ts packages/core/src/providers/__tests__/sns-verify.test.ts
git commit -m "feat(providers): SNS signature verification with cert URL allowlist and topic check"
```

---

#### Úkol 39: Potvrzení odběru a deduplikace

**Files:**
- Create: `packages/core/src/providers/sns/subscription.ts`
- Create: `packages/core/src/providers/sns/dedup.ts`
- Create: `packages/core/src/campaigns/repo/receipts.ts`
- Test: `packages/core/src/campaigns/repo/__tests__/receipts.db.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/campaigns/repo/__tests__/receipts.db.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { withTestWorkspace, seedProvider } from '../../../testing/harness';
import { insertReceiptOnce, markProcessed, listUnmatched } from '../receipts';
import { dedupKey, contentKey } from '../../../../../core/src/providers/sns/dedup';

describe('deduplikace prichozich udalosti', () => {
  let ctx: Awaited<ReturnType<typeof withTestWorkspace>>;
  beforeEach(async () => { ctx = await withTestWorkspace(); });

  it('dedup klic je sns:<MessageId>', () => {
    expect(dedupKey({ MessageId: 'abc' } as never)).toBe('sns:abc');
  });

  it('content klic je stabilni pro tutez udalost', () => {
    const a = contentKey({ sesMessageId: 'm1', eventType: 'Bounce', recipient: 'a@x.cz', timestamp: '2026-08-01T00:00:00Z' });
    const b = contentKey({ sesMessageId: 'm1', eventType: 'Bounce', recipient: 'A@X.cz', timestamp: '2026-08-01T00:00:00Z' });
    expect(a).toBe(b);
    expect(a).toMatch(/^ses:[0-9a-f]{64}$/);
  });

  it('tataz Notification trikrat vytvori prave jeden radek', async () => {
    const provider = await seedProvider(ctx, {});
    const args = { providerId: provider, dedupKey: 'sns:x', snsMessageId: 'x', eventType: 'Bounce', raw: { a: 1 } };
    const first = await insertReceiptOnce(ctx.workspace, args);
    const second = await insertReceiptOnce(ctx.workspace, args);
    const third = await insertReceiptOnce(ctx.workspace, args);
    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(third).toBeNull();
  });

  it('dedup se opira o prefix indexu a je omezeny na aktualni oddil', async () => {
    const provider = await seedProvider(ctx, {});
    const r = await insertReceiptOnce(ctx.workspace, {
      providerId: provider, dedupKey: 'sns:y', snsMessageId: 'y', eventType: 'Delivery', raw: {},
    });
    expect(r).not.toBeNull();
  });

  it('nesparovane udalosti se daji vypsat pro rematch', async () => {
    const provider = await seedProvider(ctx, {});
    const id = await insertReceiptOnce(ctx.workspace, {
      providerId: provider, dedupKey: 'sns:z', snsMessageId: 'z', eventType: 'Delivery', raw: {},
    });
    await markProcessed(ctx.workspace, id!, 'unmatched');
    expect((await listUnmatched(ctx.workspace, { maxAgeHours: 24, limit: 10 })).length).toBe(1);
  });

  it('SNS_STORE_RAW_EVENTS false neuklada raw telo', async () => {
    const provider = await seedProvider(ctx, {});
    const id = await insertReceiptOnce(ctx.workspace, {
      providerId: provider, dedupKey: 'sns:w', snsMessageId: 'w', eventType: 'Delivery',
      raw: { big: 'x'.repeat(1000) }, storeRaw: false,
    });
    expect(id).not.toBeNull();
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:db -- receipts.db`
Expected: FAIL, moduly neexistují.

- [ ] **Step 3: Napsat dedup, potvrzení odběru a repository**

```ts
// packages/core/src/providers/sns/dedup.ts
import { createHash } from 'node:crypto';

/** SNS.MessageId je stabilni napric opakovanymi pokusy o doruceni teze publikovane zpravy. */
export function dedupKey(msg: { MessageId: string }): string {
  return `sns:${msg.MessageId}`;
}

/**
 * Druha vrstva pro pripad, ze by SES tutez udalost publikoval jako dve ruzne SNS zpravy
 * (pozorovano u Delivery pri vicenasobnych prijemcich). Vyhodnocuje se uvnitr jobu
 * a na oddily se neváže vubec, takze zavira i hranici mesice.
 */
export function contentKey(input: {
  sesMessageId: string; eventType: string; recipient: string; timestamp: string;
}): string {
  const raw = `${input.sesMessageId}|${input.eventType}|${input.recipient.toLowerCase()}|${input.timestamp}`;
  return `ses:${createHash('sha256').update(raw).digest('hex')}`;
}
```

```ts
// packages/core/src/providers/sns/subscription.ts
import { isAllowedCertUrl } from './verify';

const AWS_SNS_HOST = /^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$/;

export function isAllowedSubscribeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && AWS_SNS_HOST.test(u.hostname);
  } catch {
    return false;
  }
}

export type ConfirmDeps = {
  confirmViaSdk?(input: { topicArn: string; token: string }): Promise<void>;
  confirmViaHttp(url: string): Promise<void>;
  setProviderVerifying(providerId: string, detail: unknown): Promise<void>;
  audit(action: string, providerId: string): Promise<void>;
};

/**
 * Potvrzeni odberu je jediny okamzik, kdy utocnik muze napojit nas endpoint na cizi
 * topic. Kontrola TopicArn uz probehla ve verifySnsMessage; tady se navic kontroluje
 * host SubscribeURL, aby nas podepsana zprava nemohla poslat na cizi URL.
 *
 * Preferuje se ConfirmSubscription pres SDK s Tokenem z tela, protoze pak nemusime
 * delat slepy HTTP request.
 */
export async function handleSubscriptionConfirmation(
  deps: ConfirmDeps,
  msg: { TopicArn: string; Token?: string; SubscribeURL?: string },
  providerId: string,
): Promise<{ confirmed: boolean; reason?: string }> {
  if (!msg.SubscribeURL || !isAllowedSubscribeUrl(msg.SubscribeURL)) {
    return { confirmed: false, reason: 'cert_url_not_allowed' };
  }
  if (deps.confirmViaSdk && msg.Token) {
    await deps.confirmViaSdk({ topicArn: msg.TopicArn, token: msg.Token });
  } else {
    await deps.confirmViaHttp(msg.SubscribeURL);
  }
  await deps.setProviderVerifying(providerId, { sns_subscription_confirmed_at: new Date().toISOString() });
  await deps.audit('provider.sns_subscription_confirmed', providerId);
  return { confirmed: true };
}

export { isAllowedCertUrl };
```

```ts
// packages/core/src/campaigns/repo/receipts.ts
import { withWorkspace, type WorkspaceContext } from '@mlain/core/tx';
import { rawSql } from './raw-sql.js';

/**
 * Skutecnou deduplikaci dela WHERE NOT EXISTS nad prefixem indexu (workspace_id, dedup_key),
 * omezene na aktualni oddil. Samotny ON CONFLICT by NIKDY nesepnul, protoze unikatni
 * index na partitionovane tabulce musi obsahovat received_at, a ten je now(), tedy
 * u kazdeho doruceni jiny. ON CONFLICT zustava jen jako pojistka proti dvema workerum
 * ve stejne mikrosekunde.
 */
export async function insertReceiptOnce(
  ctx: WorkspaceContext,
  input: { providerId: string; dedupKey: string; snsMessageId: string; eventType: string; raw: unknown; storeRaw?: boolean },
): Promise<string | null> {
  const raw = input.storeRaw === false ? {} : input.raw;
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<{ id: string }>(rawSql(
      `INSERT INTO provider_event_receipts
         (workspace_id, provider_id, dedup_key, sns_message_id, event_type, raw, received_at, status)
       SELECT $1, $2, $3, $4, $5, $6::jsonb, now(), 'received'
        WHERE NOT EXISTS (
          SELECT 1 FROM provider_event_receipts
           WHERE workspace_id = $1
             AND dedup_key = $3
             AND received_at >= date_trunc('month', now())
        )
       ON CONFLICT (workspace_id, dedup_key, received_at) DO NOTHING
       RETURNING id`,
      [ctx.workspaceId, input.providerId, input.dedupKey, input.snsMessageId, input.eventType, JSON.stringify(raw)],
    ));
    return r.rows[0]?.id ?? null;
  });
}

export async function markProcessed(
  ctx: WorkspaceContext,
  receiptId: string,
  status: 'processed' | 'unmatched' | 'invalid',
  link?: { messageId: string; messageCreatedAt: string },
): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    await tx.execute(rawSql(
      `UPDATE provider_event_receipts
          SET status = $3, processed_at = now(),
              message_id = COALESCE($4, message_id),
              message_created_at = COALESCE($5::timestamptz, message_created_at)
        WHERE id = $1 AND workspace_id = $2 AND received_at >= date_trunc('month', now()) - interval '1 month'`,
      [receiptId, ctx.workspaceId, status, link?.messageId ?? null, link?.messageCreatedAt ?? null],
    ));
  });
}

export async function listUnmatched(
  ctx: WorkspaceContext,
  opts: { maxAgeHours: number; limit: number },
): Promise<Array<{ id: string; raw: unknown; event_type: string; provider_id: string }>> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<{ id: string; raw: unknown; event_type: string; provider_id: string }>(rawSql(
      `SELECT id, raw, event_type, provider_id FROM provider_event_receipts
        WHERE workspace_id = $1 AND status = 'unmatched'
          AND received_at >= now() - ($2 || ' hours')::interval
        ORDER BY received_at
        LIMIT ${Number(opts.limit)}`,
      [ctx.workspaceId, String(opts.maxAgeHours)],
    ));
    return r.rows;
  });
}

export async function countUnmatched(ctx: WorkspaceContext): Promise<number> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<{ n: number }>(rawSql(
      `SELECT count(*)::int AS n FROM provider_event_receipts
        WHERE workspace_id = $1 AND status = 'unmatched'`, [ctx.workspaceId]));
    return r.rows[0].n;
  });
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:db -- receipts.db`
Expected: PASS, 6 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/providers/sns/dedup.ts packages/core/src/providers/sns/subscription.ts packages/core/src/campaigns/repo/receipts.ts packages/core/src/campaigns/repo/__tests__/receipts.db.test.ts
git commit -m "feat(providers): SNS dedup via NOT EXISTS and subscription confirmation"
```

---

#### Úkol 40: Katalog událostí, rank a klasifikace odrazů

**Files:**
- Create: `packages/core/src/campaigns/events/catalog.ts`
- Create: `packages/core/src/campaigns/events/bounce-classification.ts`
- Test: `packages/core/src/campaigns/events/__tests__/catalog.test.ts`

- [ ] **Step 1: Napsat padající test řízený z CSV fixture**

```ts
// packages/core/src/campaigns/events/__tests__/catalog.test.ts
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { EVENT_CATALOG, rankOf, mapSesEvent } from '../catalog';
import { classifyBounce, classifyComplaint } from '../bounce-classification';

const csv = readFileSync(
  new URL('../../../../../contracts/fixtures/bounce-classification.csv', import.meta.url), 'utf8',
).trim().split('\n').slice(1).map((l) => l.split(','));

describe('katalog udalosti', () => {
  it('rank odpovida tabulce a udalosti mimo doruceni maji nulu', () => {
    expect(rankOf('sent')).toBe(20);
    expect(rankOf('delivery_delayed')).toBe(25);
    expect(rankOf('delivered')).toBe(30);
    expect(rankOf('bounced_soft')).toBe(60);
    expect(rankOf('bounced_hard')).toBe(80);
    expect(rankOf('complained')).toBe(85);
    expect(rankOf('rejected')).toBe(90);
    expect(rankOf('render_failed')).toBe(95);
    // Udalosti mimo posloupnost doruceni. Drive tu bylo 40 a 50 pod jmeny
    // `opened` a `clicked`, coz nesedelo ani na jmena, ani na cisla z databaze.
    expect(rankOf('open')).toBe(0);
    expect(rankOf('click')).toBe(0);
    expect(rankOf('unsubscribe')).toBe(0);
    expect(rankOf('circuit_breaker_open')).toBe(0);
  });

  it('Open a Click od SESu se ignoruji, vlastnime je sami', () => {
    expect(mapSesEvent({ eventType: 'Open' })).toBeNull();
    expect(mapSesEvent({ eventType: 'Click' })).toBeNull();
    expect(mapSesEvent({ eventType: 'Subscription' })).toBeNull();
  });

  it('zadna udalost nemeni messages.status', () => {
    for (const entry of Object.values(EVENT_CATALOG)) {
      expect(entry.changesMessageStatus).toBe(false);
    }
  });

  it('neznamy eventType vraci null, ne vyjimku', () => {
    expect(mapSesEvent({ eventType: 'SomethingNew' })).toBeNull();
  });
});

describe('klasifikace odrazu podle CSV fixture', () => {
  it.each(csv)('%s / %s je %s, suppression %s, do bounce rate %s', (type, subType, cls, sup, counts) => {
    const r = classifyBounce({ bounceType: type, bounceSubType: subType });
    expect(r.class).toBe(cls);
    expect(r.suppress).toBe(sup === 'true');
    expect(r.countsToBounceRate).toBe(counts === 'true');
  });

  it('MessageTooLarge je trida content: chyba nasi sablony, ne kontaktu', () => {
    const r = classifyBounce({ bounceType: 'Transient', bounceSubType: 'MessageTooLarge' });
    expect(r).toMatchObject({ class: 'content', suppress: false, countsToBounceRate: false });
  });

  it('not-spam stiznost nevede k nicemu', () => {
    expect(classifyComplaint({ complaintFeedbackType: 'not-spam' }).suppress).toBe(false);
  });

  it('kazda jina stiznost vede k okamzite suppression', () => {
    for (const t of ['abuse', 'fraud', 'virus', 'other', undefined]) {
      expect(classifyComplaint({ complaintFeedbackType: t }).suppress).toBe(true);
    }
  });

  it('OnAccountSuppressionList u stiznosti znamena, ze zprava vubec neodesla', () => {
    const r = classifyComplaint({ complaintSubType: 'OnAccountSuppressionList' });
    expect(r).toMatchObject({ suppress: true, notSent: true, countsToComplaintRate: false });
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:unit -- events/catalog`
Expected: FAIL, moduly neexistují.

- [ ] **Step 3: Napsat katalog a klasifikaci**

```ts
// packages/core/src/campaigns/events/catalog.ts

/**
 * Dvanact typu z CHECK `ck_message_events__type`. Jmena jsou DOSLOVA ta, ktera pousti
 * databaze: `open` a `click`, ne `opened` a `clicked`. Predchozi podoba mela minuly
 * cas a obe hodnoty by skoncily chybou 23514, protoze v CHECK nejsou.
 *
 * Vycet je uzavreny schvalne. Otevrena varianta `(string & {})` by znamenala, ze preklep
 * projde typovou kontrolou a spadne az na databazi.
 */
export type EventType =
  | 'sent' | 'rejected' | 'delivered' | 'delivery_delayed'
  | 'bounced_hard' | 'bounced_soft' | 'complained' | 'render_failed'
  | 'open' | 'click' | 'unsubscribe' | 'circuit_breaker_open';

/**
 * Rank resi PORADI bez lookupu. SNS negarantuje poradi: Delivery muze dorazit po
 * Bounce, Send po Delivery. Konzument podle ranku pozna, ze udalost s nizsim rankem,
 * ktera dorazila pozdeji, je starsi informace.
 *
 * POZOR: `message_events.rank` je v P03 sloupec `GENERATED ALWAYS AS (CASE type ...) STORED`.
 * Tenhle katalog do nej NIKDY nezapisuje (zapis by skoncil chybou 428C9), je to jen jeho
 * zrcadlo pro rozhodovani v pameti. Kdyby se ta dve mista rozesla, aplikace by radila
 * udalosti jinak nez dotazy nad databazi. Predchozi podoba rozejita BYLA: mela
 * `opened: 40` a `clicked: 50`, kdezto databaze ma u obou 0, a `render_failed: 90`
 * proti 95 v databazi. Hlida to test, ktery se pta databaze, ne teto konstanty.
 *
 * Udalosti mimo doruceni (open, click, unsubscribe, circuit_breaker_open) maji rank 0,
 * protoze nejsou soucasti posloupnosti doruceni a nemaji ji jak prepsat.
 *
 * ZADNA udalost nemeni messages.status. Stav popisuje nas vysledek PREDANI provideru,
 * co se se zpravou stalo potom, patri vyhradne do message_events.
 */
export const EVENT_CATALOG: Record<string, { type: EventType; rank: number; changesMessageStatus: false }> = {
  Send: { type: 'sent', rank: 20, changesMessageStatus: false },
  DeliveryDelay: { type: 'delivery_delayed', rank: 25, changesMessageStatus: false },
  Delivery: { type: 'delivered', rank: 30, changesMessageStatus: false },
  Reject: { type: 'rejected', rank: 90, changesMessageStatus: false },
  'Rendering Failure': { type: 'render_failed', rank: 95, changesMessageStatus: false },
};

/** Zrcadlo generovaneho sloupce message_events.rank. Musi sedet na CASE z P03. */
export const RANKS: Record<EventType, number> = {
  open: 0, click: 0, unsubscribe: 0, circuit_breaker_open: 0,
  sent: 20, delivery_delayed: 25, delivered: 30,
  bounced_soft: 60, bounced_hard: 80, complained: 85, rejected: 90, render_failed: 95,
};

export function rankOf(type: EventType): number {
  return RANKS[type];
}

export function mapSesEvent(input: {
  eventType: string; bounceType?: string;
}): { type: EventType; rank: number } | null {
  if (input.eventType === 'Bounce') {
    const type: EventType = input.bounceType === 'Permanent' ? 'bounced_hard' : 'bounced_soft';
    return { type, rank: rankOf(type) };
  }
  if (input.eventType === 'Complaint') return { type: 'complained', rank: rankOf('complained') };
  const hit = EVENT_CATALOG[input.eventType];
  return hit ? { type: hit.type, rank: hit.rank } : null;
}
```

```ts
// packages/core/src/campaigns/events/bounce-classification.ts

export type BounceClass = 'hard' | 'soft' | 'content';

export type BounceDecision = {
  class: BounceClass;
  suppress: boolean;
  countsToBounceRate: boolean;
  countsToSoftCounter: boolean;
};

const HARD_NOT_COUNTED = new Set([
  'Suppressed', 'OnAccountSuppressionList', 'OnTenantSuppressionList', 'EmailValidationSuppressed',
]);

/**
 * Trida content je vlastni vynalez a je dulezita: MessageTooLarge neni chyba prijemce
 * a bylo by nespravne za ni penalizovat kontakt. Pocita se na urovni kampane a pri
 * prekroceni DELIVERABILITY_CONTENT_BOUNCE_LIMIT se kampan pozastavi.
 */
export function classifyBounce(input: { bounceType: string; bounceSubType: string }): BounceDecision {
  if (input.bounceType === 'Permanent') {
    return {
      class: 'hard', suppress: true,
      countsToBounceRate: !HARD_NOT_COUNTED.has(input.bounceSubType),
      countsToSoftCounter: false,
    };
  }
  if (['MessageTooLarge', 'ContentRejected', 'AttachmentRejected'].includes(input.bounceSubType)) {
    return { class: 'content', suppress: false, countsToBounceRate: false, countsToSoftCounter: false };
  }
  return { class: 'soft', suppress: false, countsToBounceRate: false, countsToSoftCounter: true };
}

export type ComplaintDecision = {
  suppress: boolean;
  notSent: boolean;
  countsToComplaintRate: boolean;
};

/**
 * Kazda stiznost znamena okamzitou suppression bez ohledu na complaintFeedbackType.
 * Jedina vyjimka je not-spam, coz je oprava predchoziho chybneho zarazeni; ta
 * suppression neprovadi ani nerusi.
 */
export function classifyComplaint(input: {
  complaintFeedbackType?: string; complaintSubType?: string;
}): ComplaintDecision {
  if (input.complaintFeedbackType === 'not-spam') {
    return { suppress: false, notSent: false, countsToComplaintRate: false };
  }
  const notSent = input.complaintSubType === 'OnAccountSuppressionList'
    || input.complaintSubType === 'OnTenantSuppressionList';
  return { suppress: true, notSent, countsToComplaintRate: !notSent };
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:unit -- events/catalog`
Expected: PASS, 4 testy plus 13 řádků z CSV plus 4 testy klasifikace.

- [ ] **Step 5: Napsat test, který porovná katalog s databází**

`RANKS` je zrcadlo generovaného sloupce `message_events.rank`. Dvě kopie téhož čísla se rozejdou, a předchozí podoba plánu rozejitá **byla**: měla `opened: 40` a `clicked: 50`, zatímco databáze má u obou 0, a `render_failed: 90` proti 95. Test se schválně **neptá konstanty `RANKS`** ani plánu P03, ptá se běžící databáze, protože jen ta zná skutečnou hodnotu.

```ts
// packages/core/src/campaigns/events/__tests__/rank-mirror.db.test.ts
import { afterAll, describe, expect, it } from 'vitest';
import { closePools, withWorkspace } from '@mlain/core/tx';
import { unsafeWorkspaceContext } from '@mlain/db/unsafe-context';
import { rawSql } from '../../repo/raw-sql';
import { RANKS, type EventType } from '../catalog';

const ctx = unsafeWorkspaceContext('0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6073', { type: 'system' });
afterAll(async () => { await closePools(); });

describe('katalog udalosti proti databazi', () => {
  it('kazdy typ z katalogu je v CHECK message_events.type', async () => {
    const r = await withWorkspace(ctx, (tx) =>
      tx.execute<{ def: string }>(rawSql(
        `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conname = 'ck_message_events__type'`, [])),
    );
    const def = r.rows[0]!.def;
    for (const type of Object.keys(RANKS)) {
      expect(def, `typ ${type} chybí v CHECK`).toContain(`'${type}'`);
    }
  });

  it('rank z katalogu sedi na hodnotu, kterou spocita generovany sloupec', async () => {
    // Sloupec je GENERATED ALWAYS AS ... STORED, takze jedina cesta ke skutecne
    // hodnote je nechat ho spocitat. Zapsat se do nej neda (chyba 428C9).
    const types = Object.keys(RANKS) as EventType[];
    const r = await withWorkspace(ctx, (tx) =>
      tx.execute<{ type: string; rank: number }>(rawSql(
        `SELECT t AS type,
                (CASE t
                   WHEN 'open' THEN 0 WHEN 'click' THEN 0 WHEN 'unsubscribe' THEN 0
                   WHEN 'circuit_breaker_open' THEN 0 WHEN 'sent' THEN 20
                   WHEN 'delivery_delayed' THEN 25 WHEN 'delivered' THEN 30
                   WHEN 'bounced_soft' THEN 60 WHEN 'bounced_hard' THEN 80
                   WHEN 'complained' THEN 85 WHEN 'rejected' THEN 90
                   WHEN 'render_failed' THEN 95
                 END)::int AS rank
           FROM unnest($1::text[]) AS t`, [types])),
    );
    for (const row of r.rows) {
      expect(RANKS[row.type as EventType], `rank ${row.type}`).toBe(row.rank);
    }
  });

  it('do rank NEJDE zapsat, takze ho insertEventOnce nesmi uvadet', async () => {
    await expect(
      withWorkspace(ctx, (tx) =>
        tx.execute(rawSql(
          `INSERT INTO message_events
             (workspace_id, message_id, message_created_at, campaign_id, contact_id,
              recipient, type, rank, ts, source)
           VALUES ($1, $1, now(), $1, $1, 'a@b.cz', 'delivered', 30, now(), 'ses_sns')`,
          [ctx.workspaceId]))),
    ).rejects.toThrow(/generated column/i);
  });
});
```

- [ ] **Step 6: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:db -- rank-mirror`
Expected: PASS, 3 testy.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/campaigns/events/catalog.ts packages/core/src/campaigns/events/bounce-classification.ts \
  packages/core/src/campaigns/events/__tests__/catalog.test.ts \
  packages/core/src/campaigns/events/__tests__/rank-mirror.db.test.ts
git commit -m "feat(campaigns): event catalog with rank mirrored against the generated column"
```

---

#### Úkol 41: Zpracování události, párování a jediná povolená oprava stavu

**Files:**
- Create: `packages/core/src/campaigns/events/normalize.ts`
- Create: `packages/core/src/campaigns/events/process.ts`
- Create: `packages/core/src/campaigns/repo/message-events.ts`
- Test: `packages/core/src/campaigns/repo/__tests__/message-events.db.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/campaigns/repo/__tests__/message-events.db.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { withTestWorkspace, seedMessages } from '../../../testing/harness';
import { matchMessage, insertEventOnce, repairAmbiguousDispatch } from '../message-events';
import { withWorkspace } from '@mlain/core/tx';
import { rawSql } from '../raw-sql';

describe('parovani a zapis udalosti', () => {
  let ctx: Awaited<ReturnType<typeof withTestWorkspace>>;
  beforeEach(async () => { ctx = await withTestWorkspace(); });

  it('parovani pres ml_msg funguje i bez provider_message_id', async () => {
    const { messageId, messageCreatedAt } = await seedMessages(ctx, { statuses: ['sent'], providerMessageId: null });
    const m = await matchMessage(ctx.workspace, { mlMsg: messageId, mlMday: messageCreatedAt.slice(0, 10).replace(/-/g, '') });
    expect(m?.id).toBe(messageId);
  });

  it('parovani pres provider_message_id je fallback', async () => {
    const { messageId } = await seedMessages(ctx, { statuses: ['sent'], providerMessageId: 'ses-1' });
    const m = await matchMessage(ctx.workspace, { providerMessageId: 'ses-1' });
    expect(m?.id).toBe(messageId);
  });

  it('dva radky se stejnym provider_message_id vraci ambiguous', async () => {
    await seedMessages(ctx, { statuses: ['sent'], providerMessageId: 'dup', count: 2 });
    await expect(matchMessage(ctx.workspace, { providerMessageId: 'dup' })).rejects.toThrowError(/ambiguous_provider_message_id/);
  });

  it('tataz udalost dvakrat vytvori jeden radek v message_events', async () => {
    const seeded = await seedMessages(ctx, { statuses: ['sent'] });
    const args = { ...seeded, type: 'delivered', rank: 30, ts: '2026-08-01T10:00:00.000Z', source: 'ses_sns', metadata: {} };
    await insertEventOnce(ctx.workspace, args as never);
    await insertEventOnce(ctx.workspace, args as never);
    const r = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ n: number }>(rawSql(`SELECT count(*)::int AS n FROM message_events WHERE message_id = $1`, [seeded.messageId])));
    expect(r.rows[0].n).toBe(1);
  });

  it('kazdy radek nese message_created_at, recipient a rank', async () => {
    const seeded = await seedMessages(ctx, { statuses: ['sent'] });
    await insertEventOnce(ctx.workspace, { ...seeded, type: 'delivered', rank: 30, ts: '2026-08-01T10:00:00.000Z', source: 'ses_sns', metadata: {} } as never);
    const r = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute(rawSql(`SELECT message_created_at, recipient, rank FROM message_events WHERE message_id = $1`, [seeded.messageId])));
    expect(r.rows[0]).toMatchObject({ rank: 30 });
    expect(r.rows[0].message_created_at).not.toBeNull();
    expect(r.rows[0].recipient).not.toBeNull();
  });

  it('bounce po sent nechá stav sent', async () => {
    const seeded = await seedMessages(ctx, { statuses: ['sent'] });
    await insertEventOnce(ctx.workspace, { ...seeded, type: 'bounced_hard', rank: 80, ts: '2026-08-01T10:00:00.000Z', source: 'ses_sns', metadata: {} } as never);
    const r = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ status: string }>(rawSql(`SELECT status FROM messages WHERE id = $1`, [seeded.messageId])));
    expect(r.rows[0].status).toBe('sent');
  });

  it('failed s ambiguous_dispatch se opravi na sent', async () => {
    const seeded = await seedMessages(ctx, { statuses: ['failed'], errorCode: 'ambiguous_dispatch' });
    const ok = await repairAmbiguousDispatch(ctx.workspace, {
      messageId: seeded.messageId, messageCreatedAt: seeded.messageCreatedAt,
      providerMessageId: 'ses-9', eventTs: '2026-08-01T10:00:00.000Z',
    });
    expect(ok).toBe(true);
    const r = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ status: string; error_code: string | null }>(rawSql(`SELECT status, error_code FROM messages WHERE id = $1`, [seeded.messageId])));
    expect(r.rows[0]).toMatchObject({ status: 'sent', error_code: null });
  });

  it.each(['render_failed', 'provider_rejected', null])('failed s error_code %s se NEOPRAVI', async (code) => {
    const seeded = await seedMessages(ctx, { statuses: ['failed'], errorCode: code });
    const ok = await repairAmbiguousDispatch(ctx.workspace, {
      messageId: seeded.messageId, messageCreatedAt: seeded.messageCreatedAt,
      providerMessageId: 'ses-9', eventTs: '2026-08-01T10:00:00.000Z',
    });
    expect(ok).toBe(false);
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:db -- message-events.db`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napsat normalizaci, párování a zápis**

```ts
// packages/core/src/campaigns/events/normalize.ts
import { mapSesEvent } from './catalog';

export type NormalizedEvent = {
  type: string;
  rank: number;
  ts: string;
  recipient: string;
  sesMessageId: string | null;
  mlMsg: string | null;
  mlMday: string | null;
  metadata: Record<string, unknown>;
};

/** SNS posila telo jako retezec v poli Message, ne jako vnoreny JSON. */
export function normalizeSesNotification(body: string): NormalizedEvent | null {
  const payload = JSON.parse(body) as Record<string, never>;
  const eventType = (payload.eventType ?? payload.notificationType) as string | undefined;
  if (!eventType) return null;

  const mail = (payload.mail ?? {}) as { messageId?: string; tags?: Record<string, string[]>; timestamp?: string };
  const tag = (name: string) => mail.tags?.[name]?.[0] ?? null;

  const bounce = payload.bounce as { bounceType?: string; bounceSubType?: string; timestamp?: string; bouncedRecipients?: Array<{ emailAddress: string; diagnosticCode?: string }> } | undefined;
  const complaint = payload.complaint as { complaintFeedbackType?: string; complaintSubType?: string; timestamp?: string; complainedRecipients?: Array<{ emailAddress: string }> } | undefined;
  const delivery = payload.delivery as { timestamp?: string; recipients?: string[] } | undefined;

  const mapped = mapSesEvent({ eventType, bounceType: bounce?.bounceType });
  if (!mapped) return null;

  const recipient =
    bounce?.bouncedRecipients?.[0]?.emailAddress
    ?? complaint?.complainedRecipients?.[0]?.emailAddress
    ?? delivery?.recipients?.[0]
    ?? ((payload.mail as { destination?: string[] })?.destination?.[0] ?? '');

  return {
    type: mapped.type,
    rank: mapped.rank,
    // ts je cas udalosti u providera, ne cas naseho zpracovani.
    ts: bounce?.timestamp ?? complaint?.timestamp ?? delivery?.timestamp ?? mail.timestamp ?? new Date().toISOString(),
    recipient,
    sesMessageId: mail.messageId ?? null,
    mlMsg: tag('ml_msg'),
    mlMday: tag('ml_mday'),
    metadata: {
      bounce_type: bounce?.bounceType, bounce_sub_type: bounce?.bounceSubType,
      diagnostic_code: bounce?.bouncedRecipients?.[0]?.diagnosticCode,
      complaint_feedback_type: complaint?.complaintFeedbackType,
      complaint_sub_type: complaint?.complaintSubType,
    },
  };
}
```

```ts
// packages/core/src/campaigns/repo/message-events.ts
import { withWorkspace, type WorkspaceContext } from '@mlain/core/tx';
import { AppError } from '@mlain/core/errors';
import { rawSql } from './raw-sql.js';

export type MatchedMessage = {
  id: string; created_at: string; workspace_id: string;
  campaign_id: string; contact_id: string; email: string;
  status: string; error_code: string | null;
};

/**
 * Poradi parovani:
 *   1. mail.tags.ml_msg + ml_mday  -> primy lookup do JEDINE partition (preferovane)
 *   2. provider_message_id         -> lookup pres index, omezeny na 30 dni
 *   3. ani jedno                   -> unmatched, retry 24 h
 *
 * Podminka created_at >= now() - 30 dni neni logika, ale PARTITION PRUNING: bez ni
 * by lookup projel index na vsech existujicich partition, tedy pri rocni historii
 * dvanact indexu misto jednoho nebo dvou.
 */
export async function matchMessage(
  ctx: WorkspaceContext,
  input: { mlMsg?: string | null; mlMday?: string | null; providerMessageId?: string | null },
): Promise<MatchedMessage | null> {
  return withWorkspace(ctx, async (tx) => {
    if (input.mlMsg && input.mlMday) {
      const day = `${input.mlMday.slice(0, 4)}-${input.mlMday.slice(4, 6)}-${input.mlMday.slice(6, 8)}`;
      const r = await tx.execute<MatchedMessage>(rawSql(
        `SELECT id, created_at, workspace_id, campaign_id, contact_id, email, status, error_code
           FROM messages
          WHERE id = $1 AND workspace_id = $2
            AND created_at >= $3::date AND created_at < $3::date + interval '1 day'`,
        [input.mlMsg, ctx.workspaceId, day],
      ));
      if (r.rows[0]) return r.rows[0];
    }
    if (!input.providerMessageId) return null;

    const r = await tx.execute<MatchedMessage>(rawSql(
      `SELECT id, created_at, workspace_id, campaign_id, contact_id, email, status, error_code
         FROM messages
        WHERE provider_message_id = $1 AND workspace_id = $2
          AND created_at >= now() - interval '30 days'
        LIMIT 2`,
      [input.providerMessageId, ctx.workspaceId],
    ));
    if (r.rows.length > 1) {
      throw new AppError('conflict', { detail: 'ambiguous_provider_message_id', params: { provider_message_id: input.providerMessageId } });
    }
    return r.rows[0] ?? null;
  });
}

/**
 * Vlozi udalost prave jednou. Vraci true, kdyz radek skutecne vznikl.
 *
 * Puvodni podoba mela `ON CONFLICT DO NOTHING` a spolehala na to, ze index
 * `idx_message_events__once_per_message` je unikatni. **Neni.** P03 ho rozhodnutim R22
 * zamerne nechal neunikatni, protoze partitionovana tabulka by ho stejne musela mit
 * v klici s `received_at`, ktere ma `DEFAULT now()`, takze by dve volani ve dvou
 * transakcich mela dve ruzne hodnoty a index by nesepnul nikdy.
 *
 * `ON CONFLICT DO NOTHING` bez cile tedy nemel na cem sepnout a dedup byl NEUCINNY.
 * Overeno spustenim proti Postgresu 18: dve vlozeni teze udalosti daly dva radky,
 * zatimco test ocekaval jeden. Duplicitni `delivered` po rematchi tak prosel a
 * `campaignEventTotals`, ktere u obsahovych odrazu pocita `count(*)`, by ho zapocital
 * dvakrat.
 *
 * Reseni je totez, jake plán uz spravne pouziva u `provider_event_receipts`: explicitni
 * `WHERE NOT EXISTS` nad prefixem indexu, omezene na aktualni mesicni oddil, aby dotaz
 * nemusel prohledavat historii. Overeno spustenim: tri pokusy daly jeden radek a jina
 * udalost teze zpravy prosla.
 *
 * Sloupec `rank` se NEZAPISUJE. V P03 je to `GENERATED ALWAYS AS (...) STORED`, takze
 * kazdy zapis do nej skonci chybou 428C9 `cannot insert a non-DEFAULT value into column`.
 * Predchozi podoba ho v seznamu sloupcu mela, takze by neprosla ani jedna udalost.
 */
export async function insertEventOnce(
  ctx: WorkspaceContext,
  input: {
    messageId: string; messageCreatedAt: string; campaignId: string; contactId: string;
    recipient: string; type: string; ts: string;
    source: 'ses_sns' | 'smtp' | 'internal' | 'tracking'; metadata: Record<string, unknown>;
  },
): Promise<boolean> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<{ id: string }>(rawSql(
      `INSERT INTO message_events
         (workspace_id, message_id, message_created_at, campaign_id, contact_id,
          recipient, type, ts, source, metadata)
       SELECT $1, $2, $3::timestamptz, $4, $5, $6, $7, $8::timestamptz, $9, $10::jsonb
        WHERE NOT EXISTS (
          SELECT 1 FROM message_events
           WHERE message_id = $2
             AND message_created_at = $3::timestamptz
             AND type = $7
             AND received_at >= date_trunc('month', now())
        )
       RETURNING id`,
      [ctx.workspaceId, input.messageId, input.messageCreatedAt, input.campaignId, input.contactId,
        input.recipient.toLowerCase(), input.type, input.ts, input.source, JSON.stringify(input.metadata)],
    ));
    return r.rows.length > 0;
  });
}

/**
 * JEDINA vyjimka z pravidla, ze prichozi udalost nemeni stav zpravy, a je oprávnena:
 * nemeni realitu, opravuje nasi neznalost. Stav ambiguous_dispatch znamena "nevime,
 * jestli jsme predali", a udalost od providera je primy dukaz, ze ano.
 *
 * Podminka error_code = 'ambiguous_dispatch' je UZKA schvalne. Kontrakt povoluje
 * prechod failed -> sent vyhradne s touhle hodnotou, s jakoukoliv jinou vcetne NULL
 * musi selhat. Scenar OB-22 to overuje pro kazdou hodnotu zvlast.
 */
export async function repairAmbiguousDispatch(
  ctx: WorkspaceContext,
  input: { messageId: string; messageCreatedAt: string; providerMessageId: string | null; eventTs: string },
): Promise<boolean> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute(rawSql(
      `UPDATE messages
          SET status = 'sent',
              provider_message_id = COALESCE(provider_message_id, $3),
              sent_at = COALESCE(sent_at, $4::timestamptz),
              error_code = NULL,
              error_detail = NULL,
              updated_at = now()
        WHERE id = $1 AND created_at = $2::timestamptz
          AND workspace_id = $5
          AND status = 'failed'
          AND error_code = 'ambiguous_dispatch'`,
      [input.messageId, input.messageCreatedAt, input.providerMessageId, input.eventTs, ctx.workspaceId],
    ));
    return (r.rowCount ?? 0) > 0;
  });
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:db -- message-events.db`
Expected: PASS, 10 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/campaigns/events/normalize.ts packages/core/src/campaigns/repo/message-events.ts packages/core/src/campaigns/repo/__tests__/message-events.db.test.ts
git commit -m "feat(campaigns): event matching by ml_msg with narrow ambiguous_dispatch repair"
```

---

#### Úkol 42: Job `provider_event.process` a plnění suppression listu

**Files:**
- Create: `packages/core/src/campaigns/jobs/provider-event-process.ts`
- Create: `packages/core/src/campaigns/events/process.ts`
- Test: `packages/core/src/campaigns/events/__tests__/process.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/campaigns/events/__tests__/process.test.ts
import { describe, expect, it, vi } from 'vitest';
import { processEvent, type ProcessDeps } from '../process';

function deps(over: Partial<ProcessDeps> = {}): ProcessDeps {
  return {
    match: vi.fn(async () => ({ id: 'm1', created_at: '2026-08-01T00:00:00.000Z', campaign_id: 'k1', contact_id: 'c1', email: 'a@x.cz', status: 'sent', error_code: null })),
    insertEvent: vi.fn(async () => {}),
    repairAmbiguous: vi.fn(async () => false),
    countSoftBounces: vi.fn(async () => 1),
    addSuppression: vi.fn(async () => ({ created: true, suppressionId: 's1' })),
    revoke: vi.fn(async () => ({ revoked: 1 })),
    markReceipt: vi.fn(async () => {}),
    emit: vi.fn(async () => {}),
    contentBounceSeen: vi.fn(async () => 1),
    pauseCampaign: vi.fn(async () => {}),
    softThreshold: 3, softWindowDays: 30, contentBounceLimit: 100,
    ...over,
  };
}

const bounceHard = {
  type: 'bounced_hard', rank: 80, ts: '2026-08-01T10:00:00.000Z', recipient: 'a@x.cz',
  sesMessageId: 'ses-1', mlMsg: 'm1', mlMday: '20260801',
  metadata: { bounce_type: 'Permanent', bounce_sub_type: 'NoEmail' },
};

describe('zpracovani udalosti', () => {
  it('tvrdy odraz jde okamzite na suppression a vyskrtne cekajici zpravy', async () => {
    const d = deps();
    await processEvent(d, { receiptId: 'r1', providerId: 'p1', event: bounceHard as never });
    expect(d.addSuppression).toHaveBeenCalledWith(expect.objectContaining({ reason: 'hard_bounce' }));
    expect(d.revoke).toHaveBeenCalled();
  });

  it('stav zpravy zustava sent, udalost ho nemeni', async () => {
    const d = deps();
    await processEvent(d, { receiptId: 'r1', providerId: 'p1', event: bounceHard as never });
    expect(d.repairAmbiguous).toHaveBeenCalledTimes(1); // volá se, ale u sent nic neudělá
    expect(d.insertEvent).toHaveBeenCalled();
  });

  it('dva mekke odrazy k suppression nevedou, treti ano', async () => {
    const soft = { ...bounceHard, type: 'bounced_soft', metadata: { bounce_type: 'Transient', bounce_sub_type: 'MailboxFull' } };
    const two = deps({ countSoftBounces: vi.fn(async () => 2) });
    await processEvent(two, { receiptId: 'r', providerId: 'p', event: soft as never });
    expect(two.addSuppression).not.toHaveBeenCalled();

    const three = deps({ countSoftBounces: vi.fn(async () => 3) });
    await processEvent(three, { receiptId: 'r', providerId: 'p', event: soft as never });
    expect(three.addSuppression).toHaveBeenCalledWith(expect.objectContaining({ reason: 'soft_bounce_threshold' }));
  });

  it('MessageTooLarge nevede k suppression ani ke zvyseni mekkeho citace', async () => {
    const content = { ...bounceHard, type: 'bounced_soft', metadata: { bounce_type: 'Transient', bounce_sub_type: 'MessageTooLarge' } };
    const d = deps();
    await processEvent(d, { receiptId: 'r', providerId: 'p', event: content as never });
    expect(d.addSuppression).not.toHaveBeenCalled();
    expect(d.countSoftBounces).not.toHaveBeenCalled();
  });

  it('sto vyskytu content odrazu pozastavi kampan s bounce_guard', async () => {
    const content = { ...bounceHard, type: 'bounced_soft', metadata: { bounce_type: 'Transient', bounce_sub_type: 'MessageTooLarge' } };
    const d = deps({ contentBounceSeen: vi.fn(async () => 101) });
    await processEvent(d, { receiptId: 'r', providerId: 'p', event: content as never });
    expect(d.pauseCampaign).toHaveBeenCalledWith('k1', expect.objectContaining({ code: 'bounce_guard' }));
  });

  it('nesparovana udalost se oznaci jako unmatched, ne invalid', async () => {
    const d = deps({ match: vi.fn(async () => null) });
    await processEvent(d, { receiptId: 'r', providerId: 'p', event: bounceHard as never });
    expect(d.markReceipt).toHaveBeenCalledWith('r', 'unmatched');
  });

  it('udalost pro zpravu s ambiguous_dispatch ji opravi na sent', async () => {
    const d = deps({
      match: vi.fn(async () => ({ id: 'm1', created_at: '2026-08-01T00:00:00.000Z', campaign_id: 'k1', contact_id: 'c1', email: 'a@x.cz', status: 'failed', error_code: 'ambiguous_dispatch' })),
      repairAmbiguous: vi.fn(async () => true),
    });
    await processEvent(d, { receiptId: 'r', providerId: 'p', event: { ...bounceHard, type: 'delivered', rank: 30 } as never });
    expect(d.repairAmbiguous).toHaveBeenCalled();
  });

  it('posle odchozi webhook s bounce_class a sequence', async () => {
    const d = deps();
    await processEvent(d, { receiptId: 'r', providerId: 'p', event: bounceHard as never });
    expect(d.emit).toHaveBeenCalledWith(expect.objectContaining({
      type: 'message.bounced',
      data: expect.objectContaining({ sequence: 80 }),
    }));
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:unit -- events/process`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napsat zpracování**

```ts
// packages/core/src/campaigns/events/process.ts
import { classifyBounce, classifyComplaint } from './bounce-classification';
import type { NormalizedEvent } from './normalize';
import { buildPauseReason } from '../pause-reason';

export type ProcessDeps = {
  match(input: { mlMsg: string | null; mlMday: string | null; providerMessageId: string | null }): Promise<{
    id: string; created_at: string; campaign_id: string; contact_id: string; email: string;
    status: string; error_code: string | null;
  } | null>;
  insertEvent(input: Record<string, unknown>): Promise<void>;
  repairAmbiguous(input: { messageId: string; messageCreatedAt: string; providerMessageId: string | null; eventTs: string }): Promise<boolean>;
  countSoftBounces(input: { email: string; windowDays: number }): Promise<number>;
  addSuppression(input: { email: string; reason: string; source: 'ses_event'; metadata: Record<string, unknown> }): Promise<{ created: boolean; suppressionId: string }>;
  revoke(input: { emails: string[]; listId: null; reason: 'suppressed' }): Promise<{ revoked: number }>;
  markReceipt(receiptId: string, status: 'processed' | 'unmatched' | 'invalid'): Promise<void>;
  emit(input: { type: string; data: Record<string, unknown> }): Promise<void>;
  contentBounceSeen(campaignId: string): Promise<number>;
  pauseCampaign(campaignId: string, reason: ReturnType<typeof buildPauseReason>): Promise<void>;
  softThreshold: number;
  softWindowDays: number;
  contentBounceLimit: number;
};

export async function processEvent(
  deps: ProcessDeps,
  input: { receiptId: string; providerId: string; event: NormalizedEvent },
): Promise<void> {
  const e = input.event;
  const message = await deps.match({ mlMsg: e.mlMsg, mlMday: e.mlMday, providerMessageId: e.sesMessageId });
  if (!message) {
    await deps.markReceipt(input.receiptId, 'unmatched');
    return;
  }

  await deps.repairAmbiguous({
    messageId: message.id, messageCreatedAt: message.created_at,
    providerMessageId: e.sesMessageId, eventTs: e.ts,
  });

  await deps.insertEvent({
    messageId: message.id, messageCreatedAt: message.created_at,
    campaignId: message.campaign_id, contactId: message.contact_id,
    recipient: e.recipient || message.email, type: e.type, rank: e.rank,
    ts: e.ts, source: 'ses_sns', metadata: e.metadata,
  });

  let suppressed = false;
  let bounceClass: 'hard' | 'soft' | 'content' | undefined;

  if (e.type === 'bounced_hard' || e.type === 'bounced_soft') {
    const decision = classifyBounce({
      bounceType: String(e.metadata.bounce_type ?? ''),
      bounceSubType: String(e.metadata.bounce_sub_type ?? ''),
    });
    bounceClass = decision.class;

    if (decision.suppress) {
      await deps.addSuppression({
        email: message.email, reason: 'hard_bounce', source: 'ses_event',
        metadata: { messageId: message.id, campaignId: message.campaign_id, ...e.metadata },
      });
      suppressed = true;
    } else if (decision.countsToSoftCounter) {
      const count = await deps.countSoftBounces({ email: message.email, windowDays: deps.softWindowDays });
      if (count >= deps.softThreshold) {
        await deps.addSuppression({
          email: message.email, reason: 'soft_bounce_threshold', source: 'ses_event',
          metadata: { count, window_days: deps.softWindowDays, last_bounce_at: e.ts },
        });
        suppressed = true;
      }
    } else if (decision.class === 'content') {
      const seen = await deps.contentBounceSeen(message.campaign_id);
      if (seen > deps.contentBounceLimit) {
        await deps.pauseCampaign(message.campaign_id, buildPauseReason('bounce_guard', 'app', {
          detail: `Zpráva je pro řadu příjemců příliš velká (${seen} výskytů).`,
        }));
      }
    }
  }

  if (e.type === 'complained') {
    const decision = classifyComplaint({
      complaintFeedbackType: e.metadata.complaint_feedback_type as string | undefined,
      complaintSubType: e.metadata.complaint_sub_type as string | undefined,
    });
    if (decision.suppress) {
      await deps.addSuppression({
        email: message.email, reason: 'complaint', source: 'ses_event',
        metadata: { messageId: message.id, campaignId: message.campaign_id, not_sent: decision.notSent, ...e.metadata },
      });
      suppressed = true;
    }
  }

  // Bezprostredne po zapisu na suppression se rusi cekajici zpravy, aby adresa
  // okamzite vypadla ze vsech bezicich kampani.
  if (suppressed) {
    await deps.revoke({ emails: [message.email], listId: null, reason: 'suppressed' });
  }

  await deps.emit({
    type: webhookTypeFor(e.type),
    data: {
      message: { id: message.id, created_at: message.created_at, email: message.email, provider_message_id: e.sesMessageId },
      campaign: { id: message.campaign_id },
      contact: { id: message.contact_id },
      event: {
        type: e.type, bounce_class: bounceClass,
        bounce_type: e.metadata.bounce_type, bounce_sub_type: e.metadata.bounce_sub_type,
        diagnostic_code: e.metadata.diagnostic_code,
        complaint_feedback_type: e.metadata.complaint_feedback_type,
        suppressed,
      },
      message_state_after: message.status,
      sequence: e.rank,
    },
  });

  await deps.markReceipt(input.receiptId, 'processed');
}

function webhookTypeFor(type: string): string {
  if (type === 'delivered') return 'message.delivered';
  if (type === 'complained') return 'message.complained';
  if (type.startsWith('bounced')) return 'message.bounced';
  return 'message.failed';
}
```

```ts
// packages/core/src/campaigns/jobs/provider-event-process.ts
export const PROVIDER_EVENT_PROCESS_JOB = {
  queue: 'provider_event.process' as const,
  singletonKey: (dedupKey: string) => `event:${dedupKey}`,
  retryLimit: 10,
  retryBackoff: true,
  expireInSeconds: 300,
};

export const PROVIDER_EVENT_REMATCH_JOB = {
  queue: 'provider_event.rematch' as const,
  cron: '*/30 * * * * *',
  retryLimit: 3,
  expireInSeconds: 25,
};

export type RematchDeps = {
  listUnmatched(): Promise<Array<{ receiptId: string; providerId: string; raw: unknown; ageHours: number }>>;
  reprocess(input: { receiptId: string; providerId: string; raw: unknown }): Promise<void>;
  markInvalid(receiptId: string, code: string): Promise<void>;
};

/**
 * Po 24 hodinach se udalost zaznamena jako invalid s kodem unmatched_expired
 * a v dashboardu dorucitelnosti se objevi cislo "nesparovanych udalosti", protoze
 * trvale rostouci hodnota znamena chybu v parovani.
 */
export async function rematchHandler(deps: RematchDeps): Promise<void> {
  for (const r of await deps.listUnmatched()) {
    if (r.ageHours > 24) {
      await deps.markInvalid(r.receiptId, 'unmatched_expired');
      continue;
    }
    await deps.reprocess({ receiptId: r.receiptId, providerId: r.providerId, raw: r.raw });
  }
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:unit -- events/process`
Expected: PASS, 8 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/campaigns/events/process.ts packages/core/src/campaigns/jobs/provider-event-process.ts packages/core/src/campaigns/events/__tests__/process.test.ts
git commit -m "feat(campaigns): event processing, suppression writes and content bounce guard"
```

---

### Fáze I: doručitelnost a retence

#### Úkol 43: Denní zrcadlo doručitelnosti a metriky

**Files:**
- Create: `packages/core/src/campaigns/repo/deliverability.ts`
- Create: `packages/core/src/campaigns/deliverability/metrics.ts`
- Test: `packages/core/src/campaigns/deliverability/__tests__/metrics.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/campaigns/deliverability/__tests__/metrics.test.ts
import { describe, expect, it } from 'vitest';
import { dashboardMetrics, zoneFor, campaignGuardRates } from '../metrics';

const snapshot = { sent: 5000, delivered: 4800, hard_bounces: 100, soft_bounces: 50, complaints: 17, rejects: 0, delivery_delays: 0 };

describe('metriky dorucitelnosti', () => {
  it('bounce rate pocita jen tvrde odrazy, stejne jako AWS', () => {
    expect(dashboardMetrics(snapshot).bounce_rate).toBeCloseTo(0.02);
  });

  it('jmenovatel u stiznosti je doruceno, ne odeslano', () => {
    expect(dashboardMetrics(snapshot).complaint_rate).toBeCloseTo(17 / 4800);
  });

  it('brzda ma jmenovatel sent_count kampane, ne delivered', () => {
    const r = campaignGuardRates({ sentCount: 5000, hardBounces: 100, complaints: 17 });
    expect(r.bounceRate).toBeCloseTo(0.02);
    expect(r.complaintRate).toBeCloseTo(17 / 5000);
  });

  it('brzda tedy sepne o neco pozdeji nez dashboard a je to bezpecny smer', () => {
    const dash = dashboardMetrics(snapshot).complaint_rate;
    const guard = campaignGuardRates({ sentCount: 5000, hardBounces: 100, complaints: 17 }).complaintRate;
    expect(guard).toBeLessThan(dash);
  });

  it.each([
    [0.01, 'green'], [0.03, 'yellow'], [0.05, 'orange'], [0.11, 'red'],
  ] as const)('bounce rate %s je zona %s', (rate, zone) => {
    expect(zoneFor('bounce', rate)).toBe(zone);
  });

  it.each([
    [0.0004, 'green'], [0.0008, 'yellow'], [0.002, 'orange'], [0.006, 'red'],
  ] as const)('complaint rate %s je zona %s', (rate, zone) => {
    expect(zoneFor('complaint', rate)).toBe(zone);
  });

  it('nulovy jmenovatel nevraci NaN', () => {
    expect(dashboardMetrics({ ...snapshot, sent: 0, delivered: 0 }).bounce_rate).toBe(0);
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:unit -- deliverability/metrics`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napsat metriky a rollup**

```ts
// packages/core/src/campaigns/deliverability/metrics.ts

export type Snapshot = {
  sent: number; delivered: number; hard_bounces: number; soft_bounces: number;
  complaints: number; rejects: number; delivery_delays: number;
};

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}

/**
 * Citatel se pocita VYHRADNE z message_events, nikdy z messages.status. Je to
 * normativni pravidlo kontraktu: zprava, ktera se odrazila natvrdo, ma status = 'sent'
 * a udalost bounced_hard. Kdo by pocital count(*) WHERE status = 'failed', dostal by
 * nulovou nedorucitelnost u kampane, ktera se cela odrazila, a brzda by nikdy nesepnula.
 * Je to nejtissi mozna porucha: nic neselze, jen ochrana prestane existovat.
 */
export function dashboardMetrics(s: Snapshot) {
  return {
    bounce_rate: ratio(s.hard_bounces, s.sent),
    soft_rate: ratio(s.soft_bounces, s.sent),
    // Jmenovatel je DORUCENO, protoze stezovat si muze jen ten, komu zprava dosla.
    complaint_rate: ratio(s.complaints, s.delivered),
    delivery_rate: ratio(s.delivered, s.sent),
  };
}

/**
 * Brzda rozhoduje ZA BEHU, kdy delivered teprve dobiha a je systematicky podhodnocene.
 * Pomer proti delivered by uprostred kampane skakal a v prvnich minutach by delil
 * skoro nulou. Jmenovatel je proto sent_count kampane u OBOU sazeb. Dusledek: brzda
 * sepne o neco pozdeji nez dashboard, a je to bezpecny smer, protoze falesny poplach
 * uprostred rozesilky je drazsi nez o minutu opozdeny zasah.
 */
export function campaignGuardRates(input: { sentCount: number; hardBounces: number; complaints: number }) {
  return {
    bounceRate: ratio(input.hardBounces, input.sentCount),
    complaintRate: ratio(input.complaints, input.sentCount),
  };
}

/** Zony podle tabulky prahu z casti 4a, 3.15.2. Cisla jsou odvozena z hranic Amazonu. */
export function zoneFor(metric: 'bounce' | 'complaint', rate: number): 'green' | 'yellow' | 'orange' | 'red' {
  if (metric === 'bounce') {
    if (rate >= 0.10) return 'red';
    if (rate >= 0.04) return 'orange';
    if (rate >= 0.02) return 'yellow';
    return 'green';
  }
  if (rate >= 0.005) return 'red';
  if (rate >= 0.001) return 'orange';
  if (rate >= 0.0005) return 'yellow';
  return 'green';
}
```

```ts
// packages/core/src/campaigns/repo/deliverability.ts
import { withWorkspace, type WorkspaceContext } from '@mlain/core/tx';
import { rawSql } from './raw-sql.js';

/**
 * sent se pocita z messages podle sent_at, vsechny ostatni sloupce z message_events
 * podle received_at. Rollup tedy saha do DVOU tabulek a nikdy neodvozuje doruceni
 * ze status. Bounce z pondelni kampane, ktery dorazi ve stredu, se zapocita do stredy:
 * dashboard ma ukazovat, kdy jsme se o problemu dozvedeli, ne kdy vznikl.
 */
export async function rollupDay(
  ctx: WorkspaceContext,
  input: { providerId: string; day: string },
): Promise<void> {
  await withWorkspace(ctx, async (tx) => {
    await tx.execute(rawSql(
      // Obe CTE se JOINUJI pres campaigns na konkretniho providera.
      //
      // `deliverability_snapshots` ma PK (workspace_id, provider_id, day), ale ani
      // `messages`, ani `message_events` sloupec `provider_id` nenesou; jedina vazba je
      // `campaigns.provider_id`. Bez joinu by projekt se dvema providery (typicky SES
      // ostry plus SMTP na testy) dostal u OBOU stejna cisla, tedy dvakrat zapocitanou
      // doručitelnost, ze ktere cte dashboard i preflight.
      //
      // Sloupec `provider_id` primo v outboxu o peti milionech radku by byl drazsi nez
      // join a rozesel by se pri zmene providera kampane.
      `WITH s AS (
         SELECT count(*)::int AS sent FROM messages m
          JOIN campaigns c ON c.id = m.campaign_id AND c.provider_id = $2
          WHERE m.workspace_id = $1 AND m.sent_at::date = $3::date
            AND m.status = 'sent' AND m.kind = 'campaign'
       ),
       e AS (
         SELECT
           count(DISTINCT ev.message_id) FILTER (WHERE ev.type = 'delivered')        AS delivered,
           count(DISTINCT ev.message_id) FILTER (WHERE ev.type = 'bounced_hard')     AS hard_bounces,
           count(DISTINCT ev.message_id) FILTER (WHERE ev.type = 'bounced_soft')     AS soft_bounces,
           count(DISTINCT ev.message_id) FILTER (WHERE ev.type = 'complained')       AS complaints,
           count(DISTINCT ev.message_id) FILTER (WHERE ev.type = 'rejected')         AS rejects,
           count(DISTINCT ev.message_id) FILTER (WHERE ev.type = 'delivery_delayed') AS delivery_delays
         FROM message_events ev
          JOIN campaigns c ON c.id = ev.campaign_id AND c.provider_id = $2
          WHERE ev.workspace_id = $1 AND ev.received_at::date = $3::date
       )
       INSERT INTO deliverability_snapshots
         (workspace_id, provider_id, day, sent, delivered, hard_bounces, soft_bounces,
          complaints, rejects, delivery_delays, computed_at)
       SELECT $1, $2, $3::date, s.sent, e.delivered, e.hard_bounces, e.soft_bounces,
              e.complaints, e.rejects, e.delivery_delays, now()
         FROM s, e
       ON CONFLICT (workspace_id, provider_id, day) DO UPDATE
         SET sent = EXCLUDED.sent, delivered = EXCLUDED.delivered,
             hard_bounces = EXCLUDED.hard_bounces, soft_bounces = EXCLUDED.soft_bounces,
             complaints = EXCLUDED.complaints, rejects = EXCLUDED.rejects,
             delivery_delays = EXCLUDED.delivery_delays, computed_at = now()`,
      [ctx.workspaceId, input.providerId, input.day],
    ));
  });
}

export async function campaignEventTotals(
  ctx: WorkspaceContext,
  campaignId: string,
): Promise<{ hardBounces: number; complaints: number; contentBounces: number }> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<{ hard: number; complaints: number; content: number }>(rawSql(
      `SELECT
         count(DISTINCT message_id) FILTER (WHERE type = 'bounced_hard')::int AS hard,
         count(DISTINCT message_id) FILTER (WHERE type = 'complained')::int   AS complaints,
         count(*) FILTER (WHERE type = 'bounced_soft'
                            AND metadata ->> 'bounce_sub_type' IN
                                ('MessageTooLarge','ContentRejected','AttachmentRejected'))::int AS content
         FROM message_events
        WHERE workspace_id = $1 AND campaign_id = $2`,
      [ctx.workspaceId, campaignId],
    ));
    const row = r.rows[0];
    return { hardBounces: row.hard, complaints: row.complaints, contentBounces: row.content };
  });
}

export async function readSnapshots(
  ctx: WorkspaceContext,
  input: { providerId: string; days: number },
): Promise<Array<{ day: string; sent: number; delivered: number; hard_bounces: number; soft_bounces: number; complaints: number; rejects: number; delivery_delays: number }>> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<never>(rawSql(
      `SELECT day, sent, delivered, hard_bounces, soft_bounces, complaints, rejects, delivery_delays
         FROM deliverability_snapshots
        WHERE workspace_id = $1 AND provider_id = $2 AND day >= current_date - $3::int
        ORDER BY day`,
      [ctx.workspaceId, input.providerId, input.days],
    ));
    return r.rows as never;
  });
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:unit -- deliverability/metrics`
Expected: PASS, 13 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/campaigns/deliverability/metrics.ts packages/core/src/campaigns/repo/deliverability.ts packages/core/src/campaigns/deliverability/__tests__/metrics.test.ts
git commit -m "feat(campaigns): deliverability metrics with two denominators on purpose"
```

---

#### Úkol 44: Automatické brzdy

**Files:**
- Create: `packages/core/src/campaigns/deliverability/guards.ts`
- Test: `packages/core/src/campaigns/deliverability/__tests__/guards.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/campaigns/deliverability/__tests__/guards.test.ts
import { describe, expect, it } from 'vitest';
import { evaluateGuards } from '../guards';

const guards = {
  bounceGuardRate: 0.08, complaintGuardRate: 0.003,
  bounceWarnRate: 0.04, complaintWarnRate: 0.001,
  guardMinSent: 500, warnMinSent: 500,
};

describe('automaticke brzdy', () => {
  it('nad 8 % odrazu pri 500 zpravach pozastavuje s bounce_guard', () => {
    const r = evaluateGuards({ sentCount: 1000, hardBounces: 85, complaints: 0 }, guards);
    expect(r.action).toBe('pause');
    if (r.action === 'pause') expect(r.code).toBe('bounce_guard');
  });

  it('nad 8 % pri 200 zpravach NEPOZASTAVUJE, podlaha nesplnena', () => {
    expect(evaluateGuards({ sentCount: 200, hardBounces: 30, complaints: 0 }, guards).action).toBe('none');
  });

  it('nad 0,3 % stiznosti pozastavuje s complaint_guard', () => {
    const r = evaluateGuards({ sentCount: 5000, hardBounces: 0, complaints: 20 }, guards);
    expect(r.action).toBe('pause');
    if (r.action === 'pause') expect(r.code).toBe('complaint_guard');
  });

  it('prah zluteho varovani u odrazu je 4 %, ne 5 %', () => {
    const r = evaluateGuards({ sentCount: 1000, hardBounces: 45, complaints: 0 }, guards);
    expect(r.action).toBe('warn');
  });

  it('varovani ma stejnou podlahu jako pauza: kampan na 25 lidi s jednim odrazem nic nespusti', () => {
    expect(evaluateGuards({ sentCount: 25, hardBounces: 1, complaints: 0 }, guards).action).toBe('none');
  });

  it('prisnejsi projektovy prah 5 % sepne driv', () => {
    const strict = { ...guards, bounceGuardRate: 0.05 };
    const r = evaluateGuards({ sentCount: 1000, hardBounces: 55, complaints: 0 }, strict);
    expect(r.action).toBe('pause');
  });

  it('nulovy prah brzdu vypina', () => {
    const off = { ...guards, bounceGuardRate: 0, complaintGuardRate: 0 };
    expect(evaluateGuards({ sentCount: 10_000, hardBounces: 9000, complaints: 500 }, off).action).not.toBe('pause');
  });

  it('brzda sepne u kampane, kde jsou vsechny zpravy sent a odrazy jsou jen v udalostech', () => {
    const r = evaluateGuards({ sentCount: 1000, hardBounces: 100, complaints: 0 }, guards);
    expect(r.action).toBe('pause');
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:unit -- deliverability/guards`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napsat brzdy**

```ts
// packages/core/src/campaigns/deliverability/guards.ts
import { campaignGuardRates } from './metrics';
import type { ResolvedGuards } from '../settings';

export type GuardOutcome =
  | { action: 'none' }
  | { action: 'warn'; metric: 'bounce' | 'complaint'; rate: number }
  | { action: 'pause'; code: 'bounce_guard' | 'complaint_guard'; rate: number };

/**
 * Brzda cte z message_events, ne ze status. Kdyby citatel vychazel ze status, byl by
 * po zavedeni koncoveho sent VZDY nula a brzda by nesepnula nikdy, i kdyby se odrazila
 * cela kampan.
 *
 * Podlaha guardMinSent plati na CELOU tabulku prahu, tedy i na zluta varovani, ne jen
 * na radky s pauzou. Bez ni by kampan na 25 lidi s jedinym odrazem mela 4 % a spustila
 * varovani, ktere o dorucitelnosti nevypovida nic.
 */
export function evaluateGuards(
  input: { sentCount: number; hardBounces: number; complaints: number },
  guards: ResolvedGuards,
): GuardOutcome {
  if (input.sentCount < guards.guardMinSent) return { action: 'none' };

  const { bounceRate, complaintRate } = campaignGuardRates(input);

  if (guards.bounceGuardRate > 0 && bounceRate >= guards.bounceGuardRate) {
    return { action: 'pause', code: 'bounce_guard', rate: bounceRate };
  }
  if (guards.complaintGuardRate > 0 && complaintRate >= guards.complaintGuardRate) {
    return { action: 'pause', code: 'complaint_guard', rate: complaintRate };
  }
  if (input.sentCount >= guards.warnMinSent) {
    if (guards.bounceWarnRate > 0 && bounceRate >= guards.bounceWarnRate) {
      return { action: 'warn', metric: 'bounce', rate: bounceRate };
    }
    if (guards.complaintWarnRate > 0 && complaintRate >= guards.complaintWarnRate) {
      return { action: 'warn', metric: 'complaint', rate: complaintRate };
    }
  }
  return { action: 'none' };
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:unit -- deliverability/guards`
Expected: PASS, 8 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/campaigns/deliverability/guards.ts packages/core/src/campaigns/deliverability/__tests__/guards.test.ts
git commit -m "feat(campaigns): deliverability guards reading events, with shared floor for warnings"
```

---

#### Úkol 45: Retence a její veto

**Files:**
- Create: `packages/core/src/campaigns/repo/retention.ts`
- Create: `packages/core/src/campaigns/jobs/retention.ts`
- Test: `packages/core/src/campaigns/repo/__tests__/retention.db.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/campaigns/repo/__tests__/retention.db.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  withTestWorkspace, seedCampaign, seedOutbox, createPartition, migratorClient,
} from '../../../testing/harness';
import { messagesRetentionVeto, runRetention } from '../retention';

describe('retence odpojenim partition', () => {
  let ctx: Awaited<ReturnType<typeof withTestWorkspace>>;
  beforeEach(async () => { ctx = await withTestWorkspace(); });

  it('partition s kampani ve stavu paused se NEODPOJI', async () => {
    const range = await createPartition(ctx, { monthsAgo: 6 });
    await seedCampaign(ctx, { status: 'paused', audienceBuiltAtInRange: range });
    const client = await migratorClient();
    expect(await messagesRetentionVeto(client, range.from, range.to, range.name)).toBe(false);
  });

  it('partition se zpravou ve stavu pending se NEODPOJI', async () => {
    const range = await createPartition(ctx, { monthsAgo: 6 });
    const id = await seedCampaign(ctx, { status: 'cancelled', audienceBuiltAtInRange: range });
    await seedOutbox(ctx, { campaignId: id, pending: 1, createdAtInRange: range });
    const client = await migratorClient();
    expect(await messagesRetentionVeto(client, range.from, range.to, range.name)).toBe(false);
  });

  it('partition s uzavrenou kampani a bez zivych zprav se odpojit smi', async () => {
    const range = await createPartition(ctx, { monthsAgo: 6 });
    const id = await seedCampaign(ctx, { status: 'sent', audienceBuiltAtInRange: range });
    await seedOutbox(ctx, { campaignId: id, sent: 100, createdAtInRange: range });
    const client = await migratorClient();
    expect(await messagesRetentionVeto(client, range.from, range.to, range.name)).toBe(true);
  });

  it('veto vidi CIZI projekt, ne jen ten svuj', async () => {
    // Tohle je jadro nalezu: oddil je globalni pres vsechny projekty, takze veto,
    // ktere bezi pod RLS jedne dilny, by odpojilo oddil s rozdelanou kampani jineho
    // projektu. Test zaklada kampan v JINEM projektu, nez ve kterem se pta.
    const range = await createPartition(ctx, { monthsAgo: 6 });
    const other = await withTestWorkspace();
    await seedCampaign(other, { status: 'sending', audienceBuiltAtInRange: range });
    const client = await migratorClient();
    expect(await messagesRetentionVeto(client, range.from, range.to, range.name)).toBe(false);
  });

  it('granularita je mesic: partition zasahujici do poslednich 90 dni se neodpoji', async () => {
    const range = await createPartition(ctx, { monthsAgo: 2 });
    const client = await migratorClient();
    const dropped = await runRetention(client, {
      table: 'messages', retentionDays: 90, veto: messagesRetentionVeto,
    });
    expect(dropped).not.toContain(range.name);
  });

  it('odpojeni pod aplikacni roli NEPROJDE, a je to spravne', async () => {
    // Predchozi podoba plánu volala DROP TABLE pod mlain_app. Ta role neni vlastnikem
    // relace, takze by retence nefungovala vubec. Test to drzi jako vlastnost.
    const range = await createPartition(ctx, { monthsAgo: 6 });
    await expect(
      runRetention(ctx.appClient, { table: 'messages', retentionDays: 90, veto: messagesRetentionVeto }),
    ).rejects.toThrow(/must be owner|permission denied/i);
    void range;
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:db -- retention.db`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napsat retenci**

```ts
// packages/core/src/campaigns/repo/retention.ts
import {
  dropPartitionsBefore, type PartitionVeto, type Queryable,
} from '@mlain/db/partitions';

/**
 * VETO. Cela kampan lezi v jedne partition, vybrane v okamziku materializace
 * (invariant I1). Kampan materializovana 31. srpna ma vsechny zpravy v srpnove
 * partition, i kdyz se dorozesila v zari, pauzuje se a dobehne az v rijnu.
 * Bez tehle kontroly by dost dlouha pauza vedla k tomu, ze jí retencni job odmaze
 * outbox pod rukama a po obnoveni by se kampan tvarila jako hotova, prestoze
 * nikdy nedobehla. Nizka pravdepodobnost, vysoky dopad.
 */
/**
 * Veto proti odpojení oddílu. Předává se do `dropPartitionsBefore` z `@mlain/db/partitions`.
 *
 * Tři věci tady jsou opravou tří samostatných vad předchozí podoby.
 *
 * 1. **Odpojení si P13 nepíše sám.** Předchozí podoba měla vlastní `detachAndDrop`
 *    s `DROP TABLE` pod aplikační rolí. `mlain_app` není vlastníkem tabulky, takže by
 *    každé volání skončilo chybou **42501** `must be owner of table` a retence by
 *    nefungovala vůbec. Odpojení vlastní `dropPartitionsBefore`, které navíc používá
 *    `DETACH PARTITION ... CONCURRENTLY`, takže nezastaví claim ani příjem událostí.
 * 2. **Veto běží NAD VŠEMI PROJEKTY, tedy mimo RLS.** Předchozí podoba četla `campaigns`
 *    a `messages` uvnitř `withWorkspace`, tedy pod RLS jedné dílny. Oddíl je přitom
 *    globální přes všechny projekty, takže by veto odpojilo oddíl s rozdělanou kampaní
 *    cizího projektu. Plán si ten scénář sám popisoval jako „nízká pravděpodobnost,
 *    vysoký dopad", a přitom si ho vyráběl.
 * 3. **Jedna kopie veta, ne dvě.** `PartitionVeto` je typ z P03 a `dropPartitionsBefore`
 *    ho vyžaduje povinně. Druhá kopie rozhodovací logiky vedle něj je přesně ta
 *    konstrukce, kterou zakazuje rozhodnutí D17.
 *
 * Predikát vrací `true`, když se oddíl odpojit SMÍ.
 */
export const messagesRetentionVeto: PartitionVeto = async (client, from, to, partition) => {
  // Spojení sem přichází od `dropPartitionsBefore`, běží pod `mlain_migrator` a mimo
  // transakci. Dotazy proto NEJSOU pod RLS a vidí všechny projekty, což je tady žádoucí.
  const campaign = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM campaigns
      WHERE audience_built_at >= $1::timestamptz AND audience_built_at < $2::timestamptz
        AND status IN ('queueing','sending','paused')`,
    [from.toISOString(), to.toISOString()],
  );
  if ((campaign.rows[0]?.n ?? 0) > 0) return false;

  const live = await client.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM messages
      WHERE created_at >= $1::timestamptz AND created_at < $2::timestamptz
        AND status IN ('pending','claimed')`,
    [from.toISOString(), to.toISOString()],
  );
  if ((live.rows[0]?.n ?? 0) > 0) return false;

  void partition;
  return true;
};

/**
 * Retenční běh nad jednou tabulkou.
 *
 * Granularita retence je MESIC, ne den. MESSAGE_RETENTION_DAYS = 90 znamena
 * "odpoj partition, jejiz CELY rozsah je starsi nez 90 dni". Realne tedy data
 * ziji 90 az 120 dni podle toho, kde v mesici vznikla. Musi to byt napsane v UI,
 * protoze "nastavil jsem 90 dni a po 100 dnech tam data porad jsou" vypada jako chyba.
 *
 * `client` je migrátorské spojení MIMO transakci. P13 ho nezakládá: `@mlain/db`
 * vystavuje jen aplikační a read-only pool, migrátorské spojení drží worker (P01),
 * který stejnou cestou pouští `platform.maintain_partitions`. Viz požadavek R-P01.6.
 */
export async function runRetention(
  client: Queryable,
  input: {
    table: 'messages' | 'message_events' | 'provider_event_receipts';
    retentionDays: number;
    veto: PartitionVeto;
    now?: Date;
  },
): Promise<string[]> {
  const COLUMN = {
    messages: 'created_at',
    message_events: 'received_at',
    provider_event_receipts: 'received_at',
  } as const;

  const before = new Date((input.now ?? new Date()).getTime() - input.retentionDays * 86_400_000);
  return dropPartitionsBefore(client, input.table, COLUMN[input.table], before, input.veto);
}
```

```ts
// packages/core/src/campaigns/jobs/retention.ts
import type { PartitionVeto, Queryable } from '@mlain/db/partitions';
import { messagesRetentionVeto, runRetention } from '../repo/retention.js';

export const RETENTION_JOB = {
  queue: 'retention.drop_message_partitions' as const,
  cron: '30 3 * * *',
  retryLimit: 1,
  expireInSeconds: 3600,
};

export type RetentionDeps = {
  /**
   * Migratorske spojeni MIMO transakci. P13 ho nezaklada: `dropPartitionsBefore` pouziva
   * `DETACH PARTITION ... CONCURRENTLY`, ktere v transakcnim bloku bezet nesmi, a DDL
   * vyzaduje vlastnika relace, tedy `mlain_migrator`. Spojeni dodava worker (P01),
   * ktery stejnou cestou pousti `platform.maintain_partitions`. Viz pozadavek R-P01.6.
   */
  migratorClient(): Promise<Queryable>;
  retentionDays(table: 'messages' | 'message_events' | 'provider_event_receipts'): number;
  clearRawEvents(olderThanDays: number): Promise<number>;
  log(level: 'info' | 'warn', msg: string, meta?: unknown): void;
};

export async function retentionHandler(deps: RetentionDeps): Promise<void> {
  const client = await deps.migratorClient();

  for (const table of ['messages', 'message_events', 'provider_event_receipts'] as const) {
    // Veto se predava VZDY, protoze `dropPartitionsBefore` ho ma povinne. U tabulek,
    // ktere zive zpravy nedrzi, je to konstantni souhlas; u `messages` je to skutecny
    // predikat, ktery bezi nad vsemi projekty najednou.
    const veto: PartitionVeto = table === 'messages' ? messagesRetentionVeto : async () => true;

    const dropped = await runRetention(client, {
      table, retentionDays: deps.retentionDays(table), veto,
    });

    for (const name of dropped) {
      deps.log('info', 'partition odpojena', { table, partition: name });
    }
    if (dropped.length === 0) {
      deps.log('info', 'žádná partition k odpojení', { table });
    }
  }

  // raw telo SNS zpravy je nejcitlivejsi data v cele domene, maze se nejdriv.
  await deps.clearRawEvents(30);
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:db -- retention.db`
Expected: PASS, 6 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/campaigns/repo/retention.ts packages/core/src/campaigns/jobs/retention.ts packages/core/src/campaigns/repo/__tests__/retention.db.test.ts
git commit -m "feat(campaigns): partition retention with in-flight campaign veto"
```

---

#### Úkol 46: Dohled nad zaseknutými zprávami

**Files:**
- Create: `packages/core/src/campaigns/outbox/stall-watch.ts`
- Test: `packages/core/src/campaigns/repo/__tests__/stall-watch.db.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/campaigns/repo/__tests__/stall-watch.db.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { withTestWorkspace, seedCampaign, seedOutbox } from '../../../testing/harness';
import { stallWatchQuery } from '../../../../../core/src/campaigns/outbox/stall-watch';
import { withWorkspace } from '@mlain/core/tx';
import { rawSql } from '../raw-sql';

describe('outbox.stall_watch', () => {
  let ctx: Awaited<ReturnType<typeof withTestWorkspace>>;
  beforeEach(async () => { ctx = await withTestWorkspace(); });

  it('dotaz projde planovacem nad prazdnymi tabulkami', async () => {
    const r = await withWorkspace(ctx.workspace, (tx) => tx.execute(rawSql(stallWatchQuery, [ctx.workspace.workspaceId])));
    expect(r.rows).toEqual([]);
  });

  it('claim vyprseny pred vic nez 5 minutami je reaper_backlog', async () => {
    const id = await seedCampaign(ctx, { status: 'sending' });
    await seedOutbox(ctx, { campaignId: id, claimed: 3, claimExpiredMinutesAgo: 10, dispatchStarted: false });
    const r = await withWorkspace(ctx.workspace, (tx) => tx.execute<{ reaper_backlog: number }>(rawSql(stallWatchQuery, [ctx.workspace.workspaceId])));
    expect(r.rows[0].reaper_backlog).toBe(3);
  });

  it('odesilani zapocate pred vic nez 15 minutami je ambiguous', async () => {
    const id = await seedCampaign(ctx, { status: 'sending' });
    await seedOutbox(ctx, { campaignId: id, claimed: 2, dispatchStartedMinutesAgo: 20 });
    const r = await withWorkspace(ctx.workspace, (tx) => tx.execute<{ ambiguous: number }>(rawSql(stallWatchQuery, [ctx.workspace.workspaceId])));
    expect(r.rows[0].ambiguous).toBe(2);
  });

  it('job nic neopravuje, jen hlasi', async () => {
    const id = await seedCampaign(ctx, { status: 'sending' });
    await seedOutbox(ctx, { campaignId: id, claimed: 1, claimExpiredMinutesAgo: 10, dispatchStarted: false });
    const before = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ status: string }>(rawSql(`SELECT status FROM messages WHERE campaign_id = $1`, [id])));
    await withWorkspace(ctx.workspace, (tx) => tx.execute(rawSql(stallWatchQuery, [ctx.workspace.workspaceId])));
    const after = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ status: string }>(rawSql(`SELECT status FROM messages WHERE campaign_id = $1`, [id])));
    expect(after.rows[0].status).toBe(before.rows[0].status);
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:db -- stall-watch`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napsat dohled**

```ts
// packages/core/src/campaigns/outbox/stall-watch.ts

/**
 * Uvolnovani zaseknutych claimu vlastni SENDER, ne aplikace. Reaper bezi v senderu
 * kazdych 30 sekund a uvolnuje jen zpravy, u kterych jeste nezacalo odesilani.
 * Aplikace nema informaci, jestli zprava prave leti do SES, takze duplicitni logika
 * na jeji strane by byla nebezpecna.
 *
 * Co v aplikaci zustava, je DOHLED nad tim, ze se to deje. Tenhle job nic neopravuje.
 */
export const stallWatchQuery = `
SELECT campaign_id,
       count(*) FILTER (WHERE claim_expires_at < now() - interval '5 minutes'
                          AND dispatch_started_at IS NULL)::int        AS reaper_backlog,
       count(*) FILTER (WHERE dispatch_started_at IS NOT NULL
                          AND dispatch_started_at < now() - interval '15 minutes')::int AS ambiguous
  FROM messages
 WHERE workspace_id = $1
   AND status = 'claimed'
   AND created_at >= now() - interval '7 days'
 GROUP BY campaign_id
HAVING count(*) > 0`;

export const STALL_WATCH_JOB = {
  queue: 'outbox.stall_watch' as const,
  cron: '*/1 * * * *',
  retryLimit: 3,
  expireInSeconds: 55,
};

export type StallWatchDeps = {
  listWorkspaces(): Promise<string[]>;
  scanStalled(workspaceId: string): Promise<Array<{ campaign_id: string; reaper_backlog: number; ambiguous: number }>>;
  scanOrphaned(workspaceId: string): Promise<Array<{ campaign_id: string; orphaned_pending: number }>>;
  cleanupOrphaned(workspaceId: string, campaignId: string): Promise<number>;
  log(level: 'warn' | 'error', msg: string, meta: unknown): void;
};

export async function stallWatchHandler(deps: StallWatchDeps): Promise<void> {
  for (const workspaceId of await deps.listWorkspaces()) {
    for (const row of await deps.scanStalled(workspaceId)) {
      if (row.reaper_backlog > 0) {
        // Kampan se NEPOZASTAVUJE, jen se v UI objevi "Odesílání stojí."
        deps.log('warn', 'claimy nikdo neuvolnuje, nejspis nebezi zadny sender', { workspaceId, ...row });
      }
      if (row.ambiguous > 0) {
        deps.log('warn', 'zpravy s rozpracovanym odeslanim, pravdepodobny pad senderu', { workspaceId, ...row });
      }
    }
    for (const row of await deps.scanOrphaned(workspaceId)) {
      // PORUCHA, ne provozni stav: selhala obe casti ochrany proti zavodu zruseni
      // s materializaci a ty radky navecky brani odpojeni oddilu.
      deps.log('error', 'pending zpravy v kampani v koncovem stavu', { workspaceId, ...row });
      await deps.cleanupOrphaned(workspaceId, row.campaign_id);
    }
  }
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:db -- stall-watch`
Expected: PASS, 4 testy.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/campaigns/outbox/stall-watch.ts packages/core/src/campaigns/repo/__tests__/stall-watch.db.test.ts
git commit -m "feat(campaigns): stall watch that reports without repairing"
```

---

### Fáze J: kompilace, preflight a testovací odeslání

#### Úkol 47: Kompilace kampaně, `campaign_links` a `compile_meta`

Tenhle úkol zavírá nález plánu P08 a plánu P09 naráz. Je to jediné místo, kde se rozhoduje o tom, jestli bude report kliků fungovat, nebo bude tiše prázdný.

**Files:**
- Create: `packages/core/src/campaigns/compile.ts`
- Create: `packages/core/src/campaigns/repo/links.ts`
- Test: `packages/core/src/campaigns/repo/__tests__/links.db.test.ts`

- [ ] **Step 1: Napsat padající test na ID a pozice**

```ts
// packages/core/src/campaigns/repo/__tests__/links.db.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { withTestWorkspace, seedCampaign } from '../../../testing/harness';
import { replaceCampaignLinks, listCampaignLinks } from '../links';
import { withWorkspace } from '@mlain/core/tx';
import { rawSql } from '../raw-sql';

const compileMeta = {
  clickMarkerCount: 2,
  links: [
    { id: '2f1e5c8a-3b7d-5e41-9a02-000000000001', url: 'https://a.cz', position: 1, label: 'A' },
    { id: '2f1e5c8a-3b7d-5e41-9a02-000000000002', url: 'https://b.cz', position: 2, label: 'B' },
  ],
};

describe('campaign_links', () => {
  let ctx: Awaited<ReturnType<typeof withTestWorkspace>>;
  beforeEach(async () => { ctx = await withTestWorkspace(); });

  it('id se prebira z CompileMeta doslova, nikdy se negeneruje znovu', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    await replaceCampaignLinks(ctx.workspace, id, compileMeta.links);
    const rows = await listCampaignLinks(ctx.workspace, id);
    expect(rows.map((r) => r.id)).toEqual(compileMeta.links.map((l) => l.id));
  });

  it('pozice zacinaji od jedne, ne od nuly', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    await replaceCampaignLinks(ctx.workspace, id, compileMeta.links);
    expect((await listCampaignLinks(ctx.workspace, id)).map((r) => r.position)).toEqual([1, 2]);
  });

  it('pozice nula je chyba, ne tiche prijeti', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    await expect(
      replaceCampaignLinks(ctx.workspace, id, [{ id: compileMeta.links[0].id, url: 'https://a.cz', position: 0 }]),
    ).rejects.toThrowError(/pozice odkazů začínají od 1/);
  });

  it('INSERT bez id selze, protoze DEFAULT je zruseny (R-P03.6)', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    await expect(
      withWorkspace(ctx.workspace, (tx) =>
        tx.execute(rawSql(`INSERT INTO campaign_links (workspace_id, campaign_id, url, position)
                  VALUES ($1, $2, 'https://x.cz', 1)`, [ctx.workspace.workspaceId, id]))),
    ).rejects.toThrowError(/null value in column "id"/);
  });

  it('opakovana kompilace odkazy nahradi, nezdvoji', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    await replaceCampaignLinks(ctx.workspace, id, compileMeta.links);
    await replaceCampaignLinks(ctx.workspace, id, compileMeta.links);
    expect(await listCampaignLinks(ctx.workspace, id)).toHaveLength(2);
  });

  it('cizi projekt odkazy nevidi', async () => {
    const other = await withTestWorkspace();
    const id = await seedCampaign(other, { status: 'draft' });
    await replaceCampaignLinks(other.workspace, id, compileMeta.links);
    expect(await listCampaignLinks(ctx.workspace, id)).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:db -- links.db`
Expected: FAIL, `Cannot find module '../links'`.

- [ ] **Step 3: Napsat repository odkazů**

```ts
// packages/core/src/campaigns/repo/links.ts
import { withWorkspace, type WorkspaceContext } from '@mlain/core/tx';
import { rawSql } from './raw-sql.js';

export type CompiledLink = { id: string; url: string; position: number; label?: string };

/**
 * id i position se prebiraji z CompileMeta DOSLOVA. P13 zadne ID nepocita, protoze
 * kontrakt kompilace predepisuje UUIDv5 odvozene z CompileMeta.links a druha kopie
 * tehoz algoritmu by se za pul roku rozesla. Nasledek rozejiti je nejtissi mozny:
 * proklik by se sparoval s neexistujicim odkazem a report kliku by byl prazdny,
 * aniz by cokoliv spadlo. Viz rozhodnuti D17.
 */
export async function replaceCampaignLinks(
  ctx: WorkspaceContext,
  campaignId: string,
  links: readonly CompiledLink[],
): Promise<void> {
  for (const link of links) {
    if (link.position < 1) {
      throw new Error(`Neplatná pozice ${link.position}: pozice odkazů začínají od 1, ne od 0.`);
    }
    if (!link.id) {
      throw new Error('Odkaz nemá id z CompileMeta. P13 ho nedopočítává, viz rozhodnutí D17.');
    }
  }

  await withWorkspace(ctx, async (tx) => {
    await tx.execute(rawSql(
      `DELETE FROM campaign_links WHERE campaign_id = $1 AND workspace_id = $2`,
      [campaignId, ctx.workspaceId],
    ));
    for (const link of links) {
      await tx.execute(rawSql(
        `INSERT INTO campaign_links (id, workspace_id, campaign_id, url, position, label)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [link.id, ctx.workspaceId, campaignId, link.url, link.position, link.label ?? null],
      ));
    }
  });
}

export async function listCampaignLinks(
  ctx: WorkspaceContext,
  campaignId: string,
): Promise<Array<{ id: string; url: string; position: number; label: string | null }>> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<{ id: string; url: string; position: number; label: string | null }>(rawSql(
      `SELECT id, url, position, label FROM campaign_links
        WHERE campaign_id = $1 AND workspace_id = $2 ORDER BY position`,
      [campaignId, ctx.workspaceId],
    ));
    return r.rows;
  });
}
```

- [ ] **Step 4: Napsat kompilaci kampaně s uložením `compile_meta`**

```ts
// packages/core/src/campaigns/compile.ts
import { createHash } from 'node:crypto';
import type { CompileMeta, CompiledLink, RenderSchema } from '@mlain/emails/compile/types';
import type { PreparedDataSchema } from '@mlain/contracts/liquid/prepare-render-data';
import { AppError } from '@mlain/core/errors';
import type { RenderPlan } from './repo/outbox.js';

/**
 * Podmnozina `CompileMeta` z kontraktu 5, kterou P13 UKLADA do `campaigns.compile_meta`.
 *
 * Neuklada se cely `CompileMeta`: `warnings` jsou diagnostika jedne kompilace a
 * `htmlBytes` s `textBytes` jde dopocitat ze samotneho `compiled_html`. Uklada se
 * presne to, co nekdo dalsi CTE za behu:
 *  - `clickMarkerCount` cte SENDER podle kriteria AK-6.21 a porovnava ho proti
 *    skutecnemu nalezu znacek v HTML,
 *  - `links` je zdroj pravdy pro parovani prokliku (rozhodnuti D17),
 *  - `renderSchema` a `usedPaths` potrebuje MATERIALIZACE, aby mohla zavolat
 *    `prepareRenderData`. Bez nich by se koren `_present` nemel z ceho naplnit,
 *  - `rendererVersion` a `contractVersion` rikaji, ktera verze vystup vyrobila.
 *
 * Jmeno typu je jine nez `CompileMeta` z P08 SCHVALNE. Jsou to dva ruzne tvary a
 * shodne jmeno by svadelo k pretypovani, ktere by rozdil zamlcelo.
 */
export type StoredCompileMeta = {
  contractVersion: number;
  rendererVersion: string;
  clickMarkerCount: number;
  links: CompiledLink[];
  usedPaths: string[];
  renderSchema: RenderSchema;
  hasUnsubscribeLink: boolean;
};

/** Vysledek kompilace kampane pripraveny k ulozeni. */
export type CampaignCompilation = {
  html: string;
  text: string;
  compileMeta: StoredCompileMeta;
  compiledHash: string;
};

/**
 * compiled_hash se pocita z designu, predmetu a preheaderu. Preflight podle nej pozna,
 * ze se sablona po kompilaci zmenila. Kompilace je podle pozadavku R3.3 deterministicka,
 * takze stejny vstup da bajtove stejny vystup a hash je porovnatelny.
 */
export function computeCompiledHash(input: { design: unknown; subject: string; preheader: string }): string {
  return createHash('sha256')
    .update(JSON.stringify({ d: input.design, s: input.subject, p: input.preheader }))
    .digest('hex');
}

/**
 * Prevod vystupu kompilace na tvar k ulozeni, se ctyrmi kontrolami kontraktu.
 *
 * Vstup je `CompileMeta` z P08 DOSLOVA, ne prelozeny mezitvar. Predchozi podoba tehle
 * funkce cekala `{ html, text, usedFields, links, clickMarkerCount }`, coz nebyl tvar,
 * ktery kompilace kdy vracela, a port, ktery ji mel plnit, deklaroval jeste treti tvar
 * bez `id` a bez poctu znacek. Zadny z nich se pritom nikde v plánu nevolal.
 */
export function normalizeCompileOutput(
  meta: CompileMeta,
  compiled: { html: string; text: string },
  source: { design: unknown; subject: string; preheader: string },
): CampaignCompilation {
  if (meta.contractVersion !== 1) {
    throw new AppError('contract_mismatch', {
      detail: `Kompilace vrátila kontrakt verze ${meta.contractVersion}, P13 umí 1.`,
      params: { contract_version: meta.contractVersion },
    });
  }

  for (const link of meta.links) {
    if (!link.id) {
      throw new AppError('contract_mismatch', {
        detail: 'Odkaz nemá id z CompileMeta. P13 ho nedopočítává, viz rozhodnutí D17.',
        params: { url: link.url, position: link.position },
      });
    }
    if (link.position < 1) {
      throw new AppError('contract_mismatch', {
        detail: `Kompilace vrátila odkaz na pozici ${link.position}. Pozice začínají od 1.`,
        params: { url: link.url, position: link.position },
      });
    }
  }

  // `clickMarkerCount` pocita znacky v HTML I v textu dohromady, kdezto `links` je
  // seznam RUZNYCH odkazu. Netrackovany odkaz (mailto, kotva) znacku nema. Rovnost
  // by tedy byla spatna kontrola; drzi nerovnost s pocty trackovanych odkazu.
  const trackable = meta.links.filter((l) => l.trackable).length;
  if (meta.clickMarkerCount < trackable) {
    throw new AppError('contract_mismatch', {
      detail: 'V HTML je míň značek odkazů, než kolik je trackovaných odkazů v CompileMeta.',
      params: { markers: meta.clickMarkerCount, trackable },
    });
  }

  return {
    html: compiled.html,
    text: compiled.text,
    compileMeta: {
      contractVersion: meta.contractVersion,
      rendererVersion: meta.rendererVersion,
      clickMarkerCount: meta.clickMarkerCount,
      links: meta.links,
      usedPaths: meta.usedPaths,
      renderSchema: meta.renderSchema,
      hasUnsubscribeLink: meta.hasUnsubscribeLink,
    },
    compiledHash: computeCompiledHash(source),
  };
}

/**
 * Porovnani ulozene compile_meta s cerstvym vystupem kompilace. Pri neshode se kampan
 * NEODESLE. Duvod je v rozhodnuti D17: rozejita ID odkazu se projevi az tim, ze report
 * kliku zustane prazdny, tedy tydny po odeslani a bez jedine chybove hlasky.
 */
export function assertCompileMetaMatches(
  stored: StoredCompileMeta | null,
  fresh: StoredCompileMeta,
): void {
  if (!stored) {
    throw new AppError('contract_mismatch', { detail: 'Kampaň nemá uložená kompilační metadata.' });
  }
  const key = (m: StoredCompileMeta) =>
    JSON.stringify({ c: m.clickMarkerCount, l: m.links.map((x) => [x.id, x.position, x.url]) });
  if (key(stored) !== key(fresh)) {
    throw new AppError('contract_mismatch', {
      detail: 'Odkazy uložené u kampaně se rozcházejí s výsledkem kompilace. Prokliky by se nespárovaly.',
      params: { stored_links: stored.links.length, fresh_links: fresh.links.length },
    });
  }
}

/**
 * Plan pro render, ktery si z ulozene compile_meta vezme MATERIALIZACE.
 *
 * Zuzeni `renderSchema` musi projit `toPreparedSchema`, protoze kontrakt pouziva jmeno
 * `RenderSchema` pro NECO JINEHO nez P08. Pretypovanim by se ta ruznost zamlcela.
 */
export function renderPlanFrom(
  meta: StoredCompileMeta,
  toPreparedSchema: (schema: RenderSchema) => PreparedDataSchema,
): RenderPlan {
  return { usedPaths: meta.usedPaths, preparedSchema: toPreparedSchema(meta.renderSchema) };
}
```

- [ ] **Step 5: Doplnit uložení do repository kampaně**

```ts
// doplnit do packages/core/src/campaigns/repo/campaign.ts

/** compile_meta je soucasti hodnot nemennych po prechodu do sending, viz D18. */
export async function saveCompilation(
  ctx: WorkspaceContext,
  campaignId: string,
  input: { html: string; text: string; usedPaths: string[]; compileMeta: unknown; compiledHash: string },
): Promise<number> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<{ id: string }>(rawSql(
      `UPDATE campaigns
          SET compiled_html = $3, compiled_text = $4, compiled_fields = $5::text[],
              compile_meta = $6::jsonb, compiled_hash = $7, compiled_at = now(),
              revision = revision + 1, updated_at = now()
        WHERE id = $1 AND workspace_id = $2
          AND status IN ('draft','schedule_missed','failed')
        RETURNING id`,
      [campaignId, ctx.workspaceId, input.html, input.text, input.usedPaths,
        JSON.stringify(input.compileMeta), input.compiledHash],
    ));
    return r.rows.length;
  });
}

/** Cte ulozenou compile_meta. Vraci null, kdyz kampan jeste nebyla zkompilovana. */
export async function readCompileMeta(
  ctx: WorkspaceContext,
  campaignId: string,
): Promise<StoredCompileMeta | null> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<{ compile_meta: StoredCompileMeta | null }>(rawSql(
      `SELECT compile_meta FROM campaigns WHERE id = $1 AND workspace_id = $2`,
      [campaignId, ctx.workspaceId],
    ));
    return r.rows[0]?.compile_meta ?? null;
  });
}
```

- [ ] **Step 6: Napsat službu, která kompilaci SKUTEČNĚ volá**

Tenhle krok je tady proto, že bez něj byla celá kompilace mrtvý kód. V předchozí podobě plánu neexistoval jediný řádek, kde by se `normalizeCompileOutput`, `assertCompileMetaMatches`, `saveCompilation` nebo `replaceCampaignLinks` volaly. Byly to čtyři definice bez volajícího a port, který je měl plnit, vracel jiný tvar, než jaký vyžadovaly.

```ts
// packages/core/src/campaigns/compile-service.ts
import { AppError } from '@mlain/core/errors';
import { withWorkspace, type WorkspaceContext } from '@mlain/core/tx';
import { getFieldCatalog } from '@mlain/core/contacts';
import { config } from '@mlain/core/config';
import type { TemplatePort } from './ports.js';
import {
  assertCompileMetaMatches, normalizeCompileOutput, renderPlanFrom,
  type CampaignCompilation,
} from './compile.js';
import { getCampaign, readCompileMeta, saveCompilation } from './repo/campaign.js';
import { replaceCampaignLinks } from './repo/links.js';
import type { RenderPlan } from './repo/outbox.js';

/**
 * Zkompiluje kampan a ulozi vysledek. Jedina cesta, kterou compiled_html, compiled_text,
 * compile_meta a campaign_links vznikaji.
 *
 * Poradi kroku je zavazne. Odkazy se zapisuji ve STEJNE transakci jako compile_meta,
 * protoze jsou to dve kopie tehoz seznamu: kdyby se ulozila jen jedna, sender by
 * porovnaval znacky proti metadatum, ktera neodpovidaji radkum v campaign_links,
 * a proklik by se sparoval s neexistujicim odkazem.
 */
export async function compileCampaign(
  ctx: WorkspaceContext,
  ports: { template: TemplatePort },
  campaignId: string,
): Promise<CampaignCompilation> {
  const campaign = await getCampaign(ctx, campaignId);
  if (!campaign) throw new AppError('not_found', { detail: 'Kampaň neexistuje.' });
  if (!campaign.design) {
    throw new AppError('campaign_not_compiled', { detail: 'Kampaň nemá obsah k odeslání.' });
  }
  if (!campaign.subject.trim()) {
    throw new AppError('campaign_subject_missing', { detail: 'Kampaň nemá předmět.' });
  }

  return withWorkspace(ctx, async (tx) => {
    const fields = await getFieldCatalog(tx, ctx.workspaceId);

    const result = await ports.template.compileTemplate({
      tx,
      workspaceId: ctx.workspaceId,
      document: campaign.design,
      templateKind: 'campaign',
      fields,
      language: campaign.language ?? 'cs',
      assetBaseUrl: config.APP_URL,
      // 'send' vyzaduje campaignId, protoze z nej kompilace odvozuje UUIDv5 odkazu.
      purpose: 'send',
      campaignId,
      trackOpens: campaign.trackOpens,
      trackClicks: campaign.trackClicks,
      preheader: campaign.preheader,
    });

    if (!result.ok) {
      // Chyby sablony jsou chyby uzivatele, ne rozpor kontraktu.
      throw new AppError('validation_failed', {
        detail: 'Šablonu se nepodařilo zkompilovat.',
        params: { issues: result.issues.map((i) => i.code).join(', ') },
      });
    }

    const compilation = normalizeCompileOutput(
      result.meta,
      { html: result.html, text: result.text },
      { design: campaign.design, subject: campaign.subject, preheader: campaign.preheader },
    );

    const updated = await saveCompilation(ctx, campaignId, {
      html: compilation.html,
      text: compilation.text,
      usedPaths: compilation.compileMeta.usedPaths,
      compileMeta: compilation.compileMeta,
      compiledHash: compilation.compiledHash,
    });
    if (updated === 0) {
      // Kampan mezitim opustila draft. compile_meta je po prechodu do sending nemenna (D18).
      throw new AppError('campaign_locked', {
        detail: 'Kampaň už není v úpravách, obsah se nedá překompilovat.',
      });
    }

    await replaceCampaignLinks(ctx, campaignId, compilation.compileMeta.links);
    return compilation;
  });
}

/**
 * Plan pro render pro materializaci. Bere se z ULOZENE compile_meta, nikdy se nekompiluje
 * znovu: druha kompilace tehoz designu je sice deterministicka, ale kdyby se mezitim
 * zmenil renderer, materializace by pouzila jina data nez ta, ktera odesel sender.
 */
export async function renderPlanForCampaign(
  ctx: WorkspaceContext,
  ports: { template: TemplatePort },
  campaignId: string,
): Promise<RenderPlan> {
  const meta = await readCompileMeta(ctx, campaignId);
  if (!meta) {
    throw new AppError('campaign_not_compiled', {
      detail: 'Kampaň nemá uložená kompilační metadata, materializace by neměla z čeho složit render_data.',
    });
  }
  return renderPlanFrom(meta, ports.template.toPreparedSchema);
}

/**
 * Posledni kontrola pred odeslanim: sedi ULOZENA compile_meta na to, co kompilace vraci
 * TED? Vola se z cesty `POST /campaigns/{id}/send`, pred prechodem do queueing.
 *
 * Je to treti cast rozhodnuti D17 a bez ni jsou zbyle dve k nicemu. Odkazy se paruji
 * podle `campaign_links.id`, ktere pochazi z `CompileMeta`. Kdyby se sablona mezi
 * kompilaci a odeslanim zmenila, kompilace by vyrobila jina ID, proklik by se sparoval
 * s neexistujicim odkazem a **report kliku by zustal prazdny** bez jedine chybove hlasky.
 * Proklik je pritom podle rozhodnuti zadavatele hlavni metrika produktu.
 *
 * Pri neshode se kampan NEODESLE a API vraci 409 `contract_mismatch`.
 */
export async function assertCompilationCurrent(
  ctx: WorkspaceContext,
  ports: { template: TemplatePort },
  campaignId: string,
): Promise<void> {
  const stored = await readCompileMeta(ctx, campaignId);
  const fresh = await compileCampaign(ctx, ports, campaignId);
  assertCompileMetaMatches(stored, fresh.compileMeta);
}
```

- [ ] **Step 7: Napsat řetězový test celé cesty**

Test jde přes **všechny články**: kompilaci, uložení, materializaci a interpolaci. Existuje proto, že každý článek zvlášť je v pořádku a rozejít se dokážou tak, že se to pozná až na odeslaném mailu, kde chybí celá sekce a nikde přitom nic nespadlo. Schválně **nepoužívá konstanty P13**: jméno kořene bere z kontraktů a mapu plní kontraktní funkcí, tedy toutéž, jakou má náhled i sender.

```ts
// packages/core/src/campaigns/__tests__/compile-chain.db.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { Liquid } from 'liquidjs';
import { COMPILED_ONLY_ROOTS } from '@mlain/contracts/liquid/roots';
import { prepareRenderData } from '@mlain/contracts/liquid/prepare-render-data';
import { compileTemplate } from '@mlain/core/templates';
import { toPreparedSchema } from '@mlain/emails/paths';
import { withWorkspace } from '@mlain/core/tx';
import { withTestWorkspace, seedCampaign, seedContacts, seedList } from '../../testing/harness';
import { compileCampaign, renderPlanForCampaign } from '../compile-service';
import { materializeBatch } from '../repo/outbox';
import { startMaterialization } from '../repo/audience-progress';
import { rawSql } from '../repo/raw-sql';

const ports = {
  template: {
    compileTemplate,
    toPreparedSchema,
    sampleContact: () => ({ first_name: 'Jan' }),
  },
};

/** Dokument s podminenym blokem nad contact.attr.city. */
const DESIGN_WITH_CONDITION = {
  version: 1,
  blocks: [
    { type: 'text', id: 'b1', props: { html: '<p>Ahoj {{ contact.first_name }}</p>' } },
    {
      type: 'text', id: 'b2',
      visibleWhen: { path: 'contact.attr.city', op: 'present' },
      props: { html: '<p>Jsme i u vás</p>' },
    },
  ],
};

describe('cely retez: kompilace, ulozeni, materializace, interpolace', () => {
  let ctx: Awaited<ReturnType<typeof withTestWorkspace>>;
  beforeEach(async () => { ctx = await withTestWorkspace(); });

  it('podmineny blok se objevi u toho, kdo ma mesto, a zmizi u toho, kdo ne', async () => {
    const list = await seedList(ctx);
    await seedContacts(ctx, { count: 1, list, email: 'ma@example.cz', attributes: { city: 'Brno' } });
    await seedContacts(ctx, { count: 1, list, email: 'nema@example.cz', attributes: { city: '' } });
    const id = await seedCampaign(ctx, {
      status: 'draft', includeLists: [list], design: DESIGN_WITH_CONDITION, subject: 'Test',
    });

    // 1. kompilace a ulozeni
    const compilation = await compileCampaign(ctx.workspace, ports, id);
    expect(compilation.compileMeta.renderSchema.presence).toContain('contact.attr.city');
    expect(compilation.html).toContain(`{% if ${COMPILED_ONLY_ROOTS[0]}.contact__attr__city %}`);

    // 2. compile_meta je skutecne v databazi, ne jen v navratove hodnote
    const stored = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ compile_meta: { usedPaths: string[] } | null }>(rawSql(
        `SELECT compile_meta FROM campaigns WHERE id = $1`, [id])));
    expect(stored.rows[0]!.compile_meta).not.toBeNull();
    expect(stored.rows[0]!.compile_meta!.usedPaths).toContain('contact.attr.city');

    // 3. materializace pouzije ULOZENY plan
    const renderPlan = await renderPlanForCampaign(ctx.workspace, ports, id);
    const { audienceBuiltAt } = await startMaterialization(ctx.workspace, id, 0);
    await materializeBatch(ctx.workspace, {
      campaignId: id, audienceBuiltAt: audienceBuiltAt!,
      cursor: '00000000-0000-0000-0000-000000000000', batchSize: 500,
      where: { sql: 'true', params: [] }, renderPlan, sampleContactIds: [], releaseAt: null,
    });

    // 4. interpolace TYMZ enginem, jaky ma sender
    const outbox = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ email: string; render_data: Record<string, unknown> }>(rawSql(
        `SELECT email, render_data FROM messages WHERE campaign_id = $1 ORDER BY email`, [id])));

    const engine = new Liquid();
    const rendered = await Promise.all(
      outbox.rows.map((r) => engine.parseAndRender(compilation.html, r.render_data)),
    );
    // ma@example.cz je prvni podle ORDER BY
    expect(rendered[0]).toContain('Jsme i u vás');
    expect(rendered[1]).not.toContain('Jsme i u vás');
  });

  it('kdyz se render_data ulozi bez pripravy, blok zmizi VSEM (regrese R11)', async () => {
    const list = await seedList(ctx);
    await seedContacts(ctx, { count: 1, list, email: 'ma@example.cz', attributes: { city: 'Brno' } });
    const id = await seedCampaign(ctx, {
      status: 'draft', includeLists: [list], design: DESIGN_WITH_CONDITION, subject: 'Test',
    });
    const compilation = await compileCampaign(ctx.workspace, ports, id);

    const engine = new Liquid();
    const surova = { contact: { first_name: 'Jan', attr: { city: 'Brno' } } };
    const bezPripravy = await engine.parseAndRender(compilation.html, surova);
    const sPripravou = await engine.parseAndRender(
      compilation.html,
      prepareRenderData(surova, toPreparedSchema(compilation.compileMeta.renderSchema)),
    );

    // Tohle je ta tichá vada: hodnota JE vyplněná, a blok přesto zmizí.
    expect(bezPripravy).not.toContain('Jsme i u vás');
    expect(sPripravou).toContain('Jsme i u vás');
  });
});
```

- [ ] **Step 8: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:db -- links.db compile-chain && pnpm --filter @mlain/core test:unit -- compile`
Expected: PASS, 6 testů v `links.db`, 2 v `compile-chain`.

- [ ] **Step 9: Commit**

```bash
git add packages/core/src/campaigns/compile.ts packages/core/src/campaigns/compile-service.ts \
  packages/core/src/campaigns/repo/links.ts packages/core/src/campaigns/repo/campaign.ts \
  packages/core/src/campaigns/repo/__tests__/links.db.test.ts \
  packages/core/src/campaigns/__tests__/compile-chain.db.test.ts
git commit -m "feat(campaigns): compile campaigns through P08 contract and store compile_meta"
```

---

#### Úkol 48: Ukázkové kontakty se nedostanou do publika

Část 6 v 8.1.4 slibuje, že ukázkové kontakty **nejdou zařadit do publika kampaně**, a plán P16 na to má E2E scénář, který spadne, když ochranu nedodám. Vynucení je moje.

**Čím se ukázkový kontakt pozná.** Původní podoba plánu filtrovala `c.is_sample = false` a požadavek R-P07.5 si ten sloupec vyžádal na P07. **Sloupec neexistuje a existovat nebude.** Rozhodnutí A1 plánu P16 to uzavírá jinak: nový sloupec znamená migraci, kterou vlastní P03, a ukázkovost jde vyjádřit třemi existujícími mechanismy. Filtr na `is_sample` by skončil chybou 42703 a **fáze C by nešla spustit vůbec**.

P13 se napojuje na dva z těch tří mechanismů a **konvenci si nepíše znovu**, importuje ji z `@mlain/core/demo`:

1. **Manifest** `workspaces.settings -> 'demoData' -> 'contactIds'` je autoritativní pro rozsah sady. Uživatel může ukázkový kontakt otevřít a `source_ref` přepsat nebo smazat, manifest to přežije, protože nese identifikátory všeho, co seed založil.
2. **Značka** `contacts.source_ref = 'demo-data:v1'` je záchytná síť pro kontakty mimo manifest: starší pokolení sady, obnova ze zálohy, ručně založený kontakt s touhle značkou. Vzor je prefixový, aby ochrana platila i pro `demo-data:v2` a další.

**Obojí je potřeba, a je to ověřené spuštěním.** Na sadě 200 000 kontaktů s 50 ukázkovými, u kterých deset mělo přepsaný `source_ref`, propustil filtr jen podle značky **deset ukázkových kontaktů do publika**. S manifestem prošly nula. Opačně to platí taky: kontakt mimo manifest se značkou by prošel, kdyby se filtrovalo jen podle manifestu.

Třetí mechanismus P16, štítek `Ukázková data`, slouží hromadnému výběru v tabulce. Ochrana se o něj neopírá, protože štítek jde odebrat jedním kliknutím.

Manifest se načítá **jednou před smyčkou**, ne v každé dávce, a předává se do dotazu jako pole. Ověřeno spuštěním, proč ne poddotazem nad `settings`: poddotaz stojí 225 ms na 200 000 řádcích, předané pole 75 ms.

**Files:**
- Modify: `packages/core/src/campaigns/repo/outbox.ts` (kandidátský dotaz)
- Create: `packages/core/src/campaigns/audience/sample-guard.ts`
- Test: `packages/core/src/campaigns/repo/__tests__/sample-guard.db.test.ts`

- [ ] **Step 1: Napsat padající test**

Test **neseeduje přes příznak**, který si plán sám vymyslel, ale přes tutéž konvenci, jakou zakládá demo data P16. Kdyby se ptal vlastního zdroje, ověřil by jen sám sebe.

```ts
// packages/core/src/campaigns/repo/__tests__/sample-guard.db.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import {
  withTestWorkspace, seedCampaign, seedContacts, seedList, seedDemoManifest,
} from '../../../testing/harness';
import { materializeBatch, type RenderPlan } from '../outbox';
import { startMaterialization } from '../audience-progress';
import { withWorkspace } from '@mlain/core/tx';
import { rawSql } from '../raw-sql';
import { DEMO_SOURCE_REF as SAMPLE_SOURCE_REF } from '@mlain/core/demo';
import { loadSampleContactIds, sampleAudienceState, sampleFinding } from '../../audience/sample-guard';

const EMPTY_RENDER_PLAN: RenderPlan = { usedPaths: [], preparedSchema: { fields: [], presence: [] } };

describe('ukazkove kontakty a publikum', () => {
  let ctx: Awaited<ReturnType<typeof withTestWorkspace>>;
  beforeEach(async () => { ctx = await withTestWorkspace(); });

  async function materializeAll(campaignId: string) {
    const { audienceBuiltAt } = await startMaterialization(ctx.workspace, campaignId, 0);
    // Manifest se cte stejnou cestou jako v produkcnim jobu, ne napevno.
    const sampleContactIds = await loadSampleContactIds(ctx.workspace);
    await materializeBatch(ctx.workspace, {
      campaignId, audienceBuiltAt: audienceBuiltAt!,
      cursor: '00000000-0000-0000-0000-000000000000', batchSize: 5000,
      where: { sql: 'true', params: [] }, renderPlan: EMPTY_RENDER_PLAN,
      sampleContactIds, releaseAt: null,
    });
    const r = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ n: number }>(rawSql(`SELECT count(*)::int AS n FROM messages WHERE campaign_id = $1`, [campaignId])));
    return r.rows[0]!.n;
  }

  it('ukazkovy kontakt se do outboxu nedostane', async () => {
    const list = await seedList(ctx);
    await seedContacts(ctx, { count: 10, list, sourceRef: SAMPLE_SOURCE_REF });
    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list] });
    expect(await materializeAll(id)).toBe(0);
  });

  it('bezny kontakt v temze seznamu projde', async () => {
    const list = await seedList(ctx);
    await seedContacts(ctx, { count: 10, list, sourceRef: SAMPLE_SOURCE_REF });
    await seedContacts(ctx, { count: 3, list });
    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list] });
    expect(await materializeAll(id)).toBe(3);
  });

  it('publikum slozene jen z ukazkovych kontaktu je prazdne, ne castecne', async () => {
    const list = await seedList(ctx);
    await seedContacts(ctx, { count: 50, list, sourceRef: SAMPLE_SOURCE_REF });
    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list] });
    expect(await materializeAll(id)).toBe(0);
  });

  it('chyti i budouci pokoleni demo dat, ne jen v1', async () => {
    const list = await seedList(ctx);
    await seedContacts(ctx, { count: 7, list, sourceRef: 'demo-data:v2' });
    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list] });
    expect(await materializeAll(id)).toBe(0);
  });

  it('chyti ukazkovy kontakt, kteremu uzivatel PREPSAL source_ref', async () => {
    // Tohle je jádro rozhodnutí A1 plánu P16: značka je volný text, uživatel ji může
    // v detailu kontaktu smazat nebo přepsat. Manifest to přežije, protože nese
    // identifikátory všeho, co seed založil. Ověřeno spuštěním, že bez manifestu
    // tenhle kontakt do publika projde.
    const list = await seedList(ctx);
    const [upraveny, ...zbytek] = await seedContacts(ctx, { count: 5, list, sourceRef: SAMPLE_SOURCE_REF });
    await seedDemoManifest(ctx, { contactIds: [upraveny!, ...zbytek] });

    // Uživatel si kontakt adoptoval a značku smazal.
    await withWorkspace(ctx.workspace, (tx) => tx.execute(rawSql(
      `UPDATE contacts SET source_ref = NULL WHERE id = $1`, [upraveny!])));

    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list] });
    expect(await materializeAll(id)).toBe(0);
  });

  it('kontakt v manifestu neprojde, ani kdyz nikdy znacku nemel', async () => {
    const list = await seedList(ctx);
    const ids = await seedContacts(ctx, { count: 3, list });
    await seedDemoManifest(ctx, { contactIds: [ids[0]!] });
    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list] });
    expect(await materializeAll(id)).toBe(2);
  });

  it('prazdny manifest nikoho nevylouci', async () => {
    // Naprostá většina projektů demo data nikdy nenahraje. Prázdné pole nesmí
    // vyhodit nikoho a nesmí dotaz rozbít.
    const list = await seedList(ctx);
    await seedContacts(ctx, { count: 4, list });
    const id = await seedCampaign(ctx, { status: 'draft', includeLists: [list] });
    expect(await materializeAll(id)).toBe(4);
  });

  it('manifest se cte pres parseDemoManifest z P16, ne vlastnim parserem', async () => {
    // Poškozený manifest nesmí shodit materializaci. `parseDemoManifest` vrací null
    // a ochrana degraduje na samotnou značku, což je pořád lepší než pád kampaně.
    await withWorkspace(ctx.workspace, (tx) => tx.execute(rawSql(
      `UPDATE workspaces SET settings = jsonb_set(settings, '{demoData}', '{"version":99}'::jsonb, true)
        WHERE id = $1`, [ctx.workspaceId])));
    await expect(loadSampleContactIds(ctx.workspace)).resolves.toEqual([]);
  });

  it('sloupec, na ktery se filtruje, v contacts SKUTECNE existuje', async () => {
    // Kdyby ochrana filtrovala na neexistujici sloupec (drive `is_sample`), spadla by
    // az za behu chybou 42703 a fazi C by neslo spustit vubec. Tenhle test to chyti
    // driv a bez zavislosti na tom, co si o schematu mysli plán.
    const r = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ n: number }>(rawSql(
        `SELECT count(*)::int AS n FROM information_schema.columns
          WHERE table_name = 'contacts' AND column_name = 'source_ref'`, [])),
    );
    expect(r.rows[0]!.n).toBe(1);
  });

  it('stav publika a nalez preflightu sedi na rozpad bran', () => {
    expect(sampleAudienceState({ eligible: 0, excluded_sample: 5 })).toBe('only_sample');
    expect(sampleAudienceState({ eligible: 3, excluded_sample: 5 })).toBe('mixed');
    expect(sampleAudienceState({ eligible: 3, excluded_sample: 0 })).toBe('none');
    expect(sampleFinding('only_sample')?.severity).toBe('error');
    expect(sampleFinding('mixed')?.severity).toBe('warning');
    expect(sampleFinding('none')).toBeNull();
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:db -- sample-guard`
Expected: FAIL, materializace zapíše 10 řádků místo 0.

- [ ] **Step 3: Doplnit podmínku do kandidátského dotazu**

V `packages/core/src/campaigns/repo/outbox.ts` jsou obě podmínky už součástí `SELECT_SQL` z úkolu 13:

```sql
       AND coalesce(c.source_ref, '') NOT LIKE $3   -- znacka: zachytna sit
       AND NOT (c.id = ANY($4::uuid[]))             -- manifest: autoritativni rozsah sady
```

Parametr `$3` je `SAMPLE_SOURCE_REF_PATTERN`, `$4` je pole z `loadSampleContactIds`. Obojí jsou vázané parametry, ne text slepený do dotazu.

Tři detaily, které vypadají jako kosmetika a nejsou:

- `coalesce` je nutný: `NULL NOT LIKE 'x'` je `NULL`, tedy nepravda, a bez něj by dotaz vyhodil **všechny** kontakty bez `source_ref`, což je většina.
- `$4` se předává jako **jedno pole**, ne jako rozložené hodnoty. Právě proto existuje `rawSql`: holá hodnota typu pole se v šabloně `sql` rozloží na `($1, $2, $3)` a dotaz spadne na `42809`.
- `NOT (c.id = ANY(...))` místo `c.id <> ALL(...)`: obojí je sémanticky totéž, ale první tvar Postgres přijme i pro prázdné pole bez přetypování na obou stranách. Ověřeno spuštěním, `uuid <> uuid[]` končí chybou `operator does not exist`.

Podmínka je v ručním SQL vědomě, stejně jako `c.status = 'active'` a kontrola prázdné adresy. Jsou to hrubé filtry, které chci mít vidět; všechno ostatní, co rozhoduje o způsobilosti, zůstává uvnitř `compileAudienceToSql`.

- [ ] **Step 4: Napsat pomocnou funkci pro UI a preflight**

```ts
// packages/core/src/campaigns/audience/sample-guard.ts
import { parseDemoManifest } from '@mlain/core/demo';
import { withWorkspace, type WorkspaceContext } from '@mlain/core/tx';
import { rawSql } from '../repo/raw-sql.js';
import type { AudienceGateCounts } from '../ports';

export type SampleAudienceState = 'none' | 'mixed' | 'only_sample';

/**
 * Jak se pozna ukazkovy kontakt. Zdroj pravdy je P16, P13 si tu konvenci NEPISE ZNOVU.
 *
 * Model kontaktu (cast 2) zadne pole pro ukazkovost nema a **mit nebude**: rozhodnuti A1
 * plánu P16 rika, ze novy sloupec by znamenal migraci, kterou vlastni P03, a resi to
 * tremi existujicimi mechanismy. Puvodni podoba tohohle plánu filtrovala neexistujici
 * `contacts.is_sample` a druha podoba si opsala retezec `'demo-data:v1'` k sobe. Obojí
 * bylo spatne: prvni by spadlo na 42703, druhe by byla druha kopie cizi konvence.
 *
 * Ze tri mechanismu P16 jsou pro ochranu podstatne dva, a **oba jsou potreba**:
 *
 * 1. **Manifest** `workspaces.settings -> 'demoData' -> 'contactIds'` je autoritativni
 *    pro rozsah sady. Uzivatel muze ukazkovy kontakt otevrit a `source_ref` prepsat,
 *    manifest tim nezmeni.
 * 2. **`source_ref`** je zachytna sit pro kontakty, ktere v manifestu nejsou: starsi
 *    pokoleni demo dat, obnova ze zalohy nebo rucne zalozeny kontakt s touhle znackou.
 *
 * Ze same znacky by ochrana netesnila, a je to overene spustenim: na sade 200 000 kontaktu
 * s 50 ukazkovymi, u kterych deset melo prepsany `source_ref`, propustil filtr jen podle
 * znacky **deset ukazkovych kontaktu do publika**. S manifestem prosly nula.
 *
 * Stitek `Ukázková data` je treti mechanismus P16, ale slouzi hromadnemu vyberu v tabulce,
 * ne vynucovani; ochrana se o nej neopira, protoze stitek jde odebrat jednim kliknutim.
 */
export { DEMO_SOURCE_REF } from '@mlain/core/demo';

/** Prefixovy vzor pro `LIKE`. Pokoleni demo dat pribyvaji, ochrana nesmi platit jen pro v1. */
export const SAMPLE_SOURCE_REF_PATTERN = 'demo-data:%';

/**
 * Nacte identifikatory ukazkovych kontaktu z manifestu P16. Vola se JEDNOU pred
 * materializaci, ne v kazde davce: manifest ma nejvys nizke desitky polozek a jeho
 * opakovane cteni by bylo drazsi nez samotny filtr.
 *
 * Overeno spustenim, proc se manifest predava jako pole a necte se poddotazem primo
 * v kandidatskem dotazu: poddotaz nad `settings -> 'demoData'` stoji 225 ms na 200 000
 * radcich, predane pole 75 ms. Pri milionovem publiku je to rozdil, ktery je videt.
 */
export async function loadSampleContactIds(
  ctx: WorkspaceContext,
): Promise<string[]> {
  return withWorkspace(ctx, async (tx) => {
    const r = await tx.execute<{ settings: { demoData?: unknown } }>(rawSql(
      `SELECT settings FROM workspaces WHERE id = $1`,
      [ctx.workspaceId],
    ));
    const manifest = parseDemoManifest(r.rows[0]?.settings.demoData);
    return manifest?.contactIds ?? [];
  });
}

/**
 * Cast 6, 8.1.4: "Ukazkove kontakty jsou oznacene a nedaji se zaradit do publika
 * kampane. Kdyz je uzivatel vybere, kontrolni seznam rekne: Publikum obsahuje jen
 * ukazkove kontakty. Tem se nic neodesle."
 *
 * Vynuceni je v materializaci (tvrdy filtr), tohle je jeho viditelna cast v UI.
 * Bez obojiho by uzivatel zmackl Odeslat na publiku, ktere je po materializaci prazdne,
 * a kampan by skoncila jako failed bez srozumitelneho duvodu.
 */
export function sampleAudienceState(gates: Pick<AudienceGateCounts, 'eligible' | 'excluded_sample'>): SampleAudienceState {
  if (gates.excluded_sample === 0) return 'none';
  return gates.eligible === 0 ? 'only_sample' : 'mixed';
}

export function sampleFinding(state: SampleAudienceState):
  { code: string; severity: 'error' | 'warning' } | null {
  if (state === 'none') return null;
  // Jen ukazkova data znamenaji prazdne publikum, tedy blokujici stav.
  if (state === 'only_sample') return { code: 'campaign_audience_only_sample', severity: 'error' };
  return { code: 'campaign_audience_has_sample', severity: 'warning' };
}
```

- [ ] **Step 5: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:db -- sample-guard`
Expected: PASS, 6 testů.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/campaigns/repo/outbox.ts packages/core/src/campaigns/audience/sample-guard.ts packages/core/src/campaigns/repo/__tests__/sample-guard.db.test.ts
git commit -m "feat(campaigns): sample contacts never enter a campaign audience"
```

---

#### Úkol 49: Předodeslací kontrola

**Files:**
- Create: `packages/core/src/campaigns/preflight/result.ts`
- Create: `packages/core/src/campaigns/preflight/checks.ts`
- Test: `packages/core/src/campaigns/preflight/__tests__/checks.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/campaigns/preflight/__tests__/checks.test.ts
import { describe, expect, it } from 'vitest';
import { runPreflight, type PreflightInput } from '../checks';

const ok: PreflightInput = {
  subject: 'Letní výprodej', compiledHtml: '<p>{{ unsubscribe_url }}</p>',
  compiledHashMatches: true, hasUnsubscribe: true,
  provider: { status: 'ready', enforcementStatus: 'HEALTHY', sendingEnabled: true, productionAccess: true,
    quotaMax24h: 50_000, quotaSent24h: 0 },
  domain: { dkimOk: true, spfOk: true, dmarcOk: true, matchesFromEmail: true },
  audience: { estimate: 1129, onlySample: false, hasSample: false },
  unknownMergeFields: [], maxRecipients: 2_000_000,
  deliverability: { bounceRate: 0.01, complaintRate: 0.0005 },
  guards: { bounceGuardRate: 0.08, complaintGuardRate: 0.003, bounceWarnRate: 0.04, complaintWarnRate: 0.001 },
  trialMode: false,
};

function codes(input: PreflightInput) {
  return runPreflight(input).findings.map((f) => f.code);
}

describe('preflight', () => {
  it('kompletni kampan ma can_send true a zadny nalez se severity error', () => {
    const r = runPreflight(ok);
    expect(r.can_send).toBe(true);
    expect(r.findings.filter((f) => f.severity === 'error')).toHaveLength(0);
  });

  it.each([
    [{ subject: '' }, 'campaign_subject_missing'],
    [{ compiledHtml: null }, 'campaign_not_compiled'],
    [{ hasUnsubscribe: false }, 'campaign_no_unsubscribe'],
    [{ audience: { ...ok.audience, estimate: 0 } }, 'campaign_audience_empty'],
    [{ unknownMergeFields: ['contact.attr.neco'] }, 'campaign_unknown_merge_field'],
    [{ domain: { ...ok.domain, dkimOk: false } }, 'domain_dkim_missing'],
    [{ domain: { ...ok.domain, spfOk: false } }, 'domain_spf_missing'],
    [{ provider: { ...ok.provider, status: 'unverified' } }, 'provider_not_ready'],
    [{ provider: { ...ok.provider, sendingEnabled: false } }, 'provider_sending_paused'],
  ] as Array<[Partial<PreflightInput>, string]>)('nalez %#: %s blokuje', (patch, code) => {
    const r = runPreflight({ ...ok, ...patch } as PreflightInput);
    expect(r.can_send).toBe(false);
    expect(r.findings.find((f) => f.code === code)?.severity).toBe('error');
  });

  it('publikum vetsi nez zbyvajici kvota je provider_quota_exceeded s remaining a reset_at', () => {
    const r = runPreflight({ ...ok, audience: { ...ok.audience, estimate: 60_000 } });
    const f = r.findings.find((x) => x.code === 'provider_quota_exceeded')!;
    expect(f.severity).toBe('error');
    expect(f.params).toMatchObject({ remaining: 50_000 });
  });

  it('sandbox s publikem nad 200 je provider_sandbox', () => {
    const r = runPreflight({ ...ok, provider: { ...ok.provider, productionAccess: false, quotaMax24h: 200 },
      audience: { ...ok.audience, estimate: 300 } });
    expect(codes({ ...ok, provider: { ...ok.provider, productionAccess: false, quotaMax24h: 200 },
      audience: { ...ok.audience, estimate: 300 } })).toContain('provider_sandbox');
    expect(r.can_send).toBe(false);
  });

  it('chybejici DMARC jen varuje a kampan jde odeslat', () => {
    const r = runPreflight({ ...ok, domain: { ...ok.domain, dmarcOk: false } });
    expect(r.can_send).toBe(true);
    expect(r.findings.find((f) => f.code === 'domain_dmarc_missing')?.severity).toBe('warning');
  });

  it('mira stiznosti nad 0,3 % BLOKUJE, mezi 0,1 a 0,3 % varuje', () => {
    const blocking = runPreflight({ ...ok, deliverability: { bounceRate: 0.01, complaintRate: 0.0034 } });
    expect(blocking.can_send).toBe(false);
    const warning = runPreflight({ ...ok, deliverability: { bounceRate: 0.01, complaintRate: 0.0015 } });
    expect(warning.can_send).toBe(true);
    expect(warning.findings.some((f) => f.severity === 'warning')).toBe(true);
  });

  it('prah varovani u odrazu je 4 %, ne 5 %', () => {
    // Rozhodnuti D7. Drive bylo cislo zadratovane primo v runPreflight jako 0.05,
    // takze kampan se 4,2 % odrazu prosla bez varovani, i kdyz brzda uz zlutou zonu hlasila.
    expect(codes({ ...ok, deliverability: { bounceRate: 0.042, complaintRate: 0 } }))
      .toContain('deliverability_bounce_warning');
    expect(codes({ ...ok, deliverability: { bounceRate: 0.031, complaintRate: 0 } }))
      .not.toContain('deliverability_bounce_warning');
  });

  it('prisnejsi projektovy prah se v preflightu PROJEVI', () => {
    // Prahy jdou z resolveGuards, ne z konstanty v kodu. Kdyz si projekt nastavi
    // prisnejsi hranici, kontrolni seznam ji musi ukazat drive, ne az brzda za behu.
    const strict = { ...ok, guards: { ...ok.guards, bounceWarnRate: 0.02 } };
    expect(codes({ ...strict, deliverability: { bounceRate: 0.025, complaintRate: 0 } }))
      .toContain('deliverability_bounce_warning');
    expect(codes({ ...ok, deliverability: { bounceRate: 0.025, complaintRate: 0 } }))
      .not.toContain('deliverability_bounce_warning');
  });

  it('publikum nad CAMPAIGN_MAX_RECIPIENTS je campaign_audience_too_large', () => {
    expect(codes({ ...ok, audience: { ...ok.audience, estimate: 3_000_000 } }))
      .toContain('campaign_audience_too_large');
  });

  it('publikum jen z ukazkovych kontaktu blokuje', () => {
    const r = runPreflight({ ...ok, audience: { estimate: 0, onlySample: true, hasSample: true } });
    expect(r.findings.some((f) => f.code === 'campaign_audience_only_sample' && f.severity === 'error')).toBe(true);
  });

  it('zkusebni rezim varuje s poctem, kolika lidem to realne odejde', () => {
    const r = runPreflight({ ...ok, trialMode: true, trialVerifiedCount: 2 });
    const f = r.findings.find((x) => x.code === 'campaign_trial_mode')!;
    expect(f.severity).toBe('warning');
    expect(f.params).toMatchObject({ verified: 2, audience: 1129 });
  });

  it('vraci VSECHNY nalezy najednou, ne prvni chybu', () => {
    const r = runPreflight({ ...ok, subject: '', hasUnsubscribe: false, domain: { ...ok.domain, dkimOk: false } });
    expect(r.findings.filter((f) => f.severity === 'error').length).toBeGreaterThanOrEqual(3);
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:unit -- preflight/checks`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napsat preflight**

```ts
// packages/core/src/campaigns/preflight/result.ts

export type Finding = {
  code: string;
  severity: 'error' | 'warning';
  path?: string;
  params?: Record<string, string | number>;
};

export type PreflightResult = {
  can_send: boolean;
  findings: Finding[];
  audience_estimate: number;
  quota_remaining: number | null;
  checked_at: string;
};

/**
 * Pravidlo proti odpadkovemu kosi z casti 1: 4xx s findings smi vzniknout jen tehdy,
 * kdyz je mezi nimi alespon jeden se severity error. Samotna varovani odeslani
 * neblokuji, takze pozadavek se samymi varovanimi projde a vrati 202; varovani
 * se pak predaji v odpovedi na uspech, ne v chybe.
 */
export function hasBlocking(findings: readonly Finding[]): boolean {
  return findings.some((f) => f.severity === 'error');
}
```

```ts
// packages/core/src/campaigns/preflight/checks.ts
import type { ResolvedGuards } from '../settings';
import { hasBlocking, type Finding, type PreflightResult } from './result';

export type PreflightInput = {
  subject: string;
  compiledHtml: string | null;
  compiledHashMatches: boolean;
  hasUnsubscribe: boolean;
  provider: {
    status: string; enforcementStatus: string; sendingEnabled: boolean;
    productionAccess: boolean; quotaMax24h: number | null; quotaSent24h: number | null;
    quotaResetAt?: string;
  };
  domain: { dkimOk: boolean | null; spfOk: boolean | null; dmarcOk: boolean | null; matchesFromEmail: boolean };
  audience: { estimate: number; onlySample: boolean; hasSample: boolean };
  unknownMergeFields: string[];
  maxRecipients: number;
  deliverability: { bounceRate: number; complaintRate: number };
  /**
   * Prahy z `resolveGuards`, tedy z nastaveni projektu omezeneho stropem instalace.
   * Preflight je NIKDY nezadratovava: uzivatel, ktery si nastavil prisnejsi hranici,
   * ji musi videt i tady, jinak mu kontrolni seznam rekne neco jineho nez automaticka brzda.
   */
  guards: Pick<ResolvedGuards, 'bounceGuardRate' | 'complaintGuardRate' | 'bounceWarnRate' | 'complaintWarnRate'>;
  trialMode: boolean;
  trialVerifiedCount?: number;
};

/**
 * Ctrnact kontrol z casti 4a, 3.2, plus tri z kontrolniho seznamu casti 6, 8.6.2.
 * GET /campaigns/{id}/preflight vraci VZDY 200 s vyplnenym findings, i kdyz jsou mezi
 * nimi blokujici: je to dotaz na stav, ne pokus o akci. POST /send vraci pri blokujicim
 * nalezu 422 campaign_not_sendable se VSEMI nalezy najednou, ne s prvni chybou.
 */
export function runPreflight(input: PreflightInput): PreflightResult {
  const f: Finding[] = [];
  const remaining = input.provider.quotaMax24h == null
    ? null
    : Math.max(0, input.provider.quotaMax24h - (input.provider.quotaSent24h ?? 0));

  if (!input.subject.trim() || input.subject.length > 255) {
    f.push({ code: 'campaign_subject_missing', severity: 'error', path: 'subject' });
  }
  if (!input.compiledHtml) {
    f.push({ code: 'campaign_not_compiled', severity: 'error' });
  } else if (!input.compiledHashMatches) {
    // Sablona se zmenila po kompilaci. Kampan se prekompiluje automaticky v ramci
    // queueing, preflight to uzivateli oznamuje jen jako informaci.
    f.push({ code: 'campaign_recompile_pending', severity: 'warning' });
  }
  if (!['ready', 'degraded'].includes(input.provider.status)) {
    f.push({ code: 'provider_not_ready', severity: 'error' });
  }
  if (input.provider.enforcementStatus === 'SHUTDOWN' || !input.provider.sendingEnabled) {
    f.push({ code: 'provider_sending_paused', severity: 'error' });
  }
  if (!input.domain.matchesFromEmail || input.domain.dkimOk === false) {
    f.push({ code: 'domain_dkim_missing', severity: 'error' });
  }
  if (input.domain.spfOk === false) {
    f.push({ code: 'domain_spf_missing', severity: 'error' });
  }
  if (input.domain.dmarcOk === false) {
    // Blokovat kvuli DMARC prvni kampan noveho uzivatele je moc tvrde, viz O10.
    f.push({ code: 'domain_dmarc_missing', severity: 'warning' });
  }
  if (input.audience.onlySample) {
    f.push({ code: 'campaign_audience_only_sample', severity: 'error' });
  } else if (input.audience.estimate <= 0) {
    f.push({ code: 'campaign_audience_empty', severity: 'error' });
  } else if (input.audience.hasSample) {
    f.push({ code: 'campaign_audience_has_sample', severity: 'warning' });
  }
  if (input.audience.estimate > input.maxRecipients) {
    f.push({ code: 'campaign_audience_too_large', severity: 'error', params: { max: input.maxRecipients } });
  }
  if (remaining !== null && input.audience.estimate > remaining) {
    // Kontrola je zamerne tvrda. Kdo chce poslat vic, nez ma denni limit, musi kampan
    // rozdelit nebo si zvysit limit u Amazonu. Nebudeme uzivateli generovat 40 000 chyb.
    f.push({
      code: 'provider_quota_exceeded', severity: 'error',
      params: { remaining, count: input.audience.estimate, reset_at: input.provider.quotaResetAt ?? '' },
    });
  }
  if (!input.provider.productionAccess && input.audience.estimate > 200) {
    f.push({ code: 'provider_sandbox', severity: 'error', params: { count: input.audience.estimate } });
  }
  if (!input.hasUnsubscribe) {
    f.push({ code: 'campaign_no_unsubscribe', severity: 'error' });
  }
  if (input.unknownMergeFields.length > 0) {
    f.push({
      code: 'campaign_unknown_merge_field', severity: 'error',
      params: { fields: input.unknownMergeFields.join(', ') },
    });
  }

  // Mira stiznosti jako blokujici polozka je zasadni produktove rozhodnuti (cast 6, 8.6.2):
  // Amazon pri prekroceni prahu zablokuje ucet a to je pro uzivatele mnohem vetsi skoda
  // nez nemoznost odeslat jednu kampan.
  //
  // VSECHNY ctyri prahy jdou z `input.guards`, tedy z `resolveGuards`, ktere je slozilo
  // z nastaveni projektu a stropu instalace. Drive byly zadratovane primo sem, coz melo
  // dva nasledky: prah varovani u odrazu byl 5 %, i kdyz rozhodnuti D7 rika 4 %, a
  // prisnejsi projektove nastaveni se v preflightu vubec neprojevilo, takze uzivatel
  // videl jinou hranici, nez podle ktere se kampan doopravdy brzdi. Cast 4a v 4.6
  // zadratovane prahy zakazuje.
  if (input.deliverability.complaintRate >= input.guards.complaintGuardRate) {
    f.push({ code: 'deliverability_complaint_blocking', severity: 'error', params: { rate: input.deliverability.complaintRate } });
  } else if (input.deliverability.complaintRate >= input.guards.complaintWarnRate) {
    f.push({ code: 'deliverability_degraded', severity: 'warning', params: { rate: input.deliverability.complaintRate } });
  }
  if (input.deliverability.bounceRate >= input.guards.bounceWarnRate) {
    f.push({ code: 'deliverability_bounce_warning', severity: 'warning', params: { rate: input.deliverability.bounceRate } });
  }
  if (input.trialMode) {
    f.push({
      code: 'campaign_trial_mode', severity: 'warning',
      params: { verified: input.trialVerifiedCount ?? 0, audience: input.audience.estimate },
    });
  }

  return {
    can_send: !hasBlocking(f),
    findings: f,
    audience_estimate: input.audience.estimate,
    quota_remaining: remaining,
    checked_at: new Date().toISOString(),
  };
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:unit -- preflight/checks`
Expected: PASS, 19 testů (devět z `it.each`).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/campaigns/preflight packages/core/src/campaigns/preflight/__tests__
git commit -m "feat(campaigns): preflight returning all findings at once"
```

---

#### Úkol 50: Testovací odeslání

**Files:**
- Create: `packages/core/src/campaigns/test-send/send-test.ts`
- Test: `packages/core/src/campaigns/repo/__tests__/test-send.db.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/campaigns/repo/__tests__/test-send.db.test.ts
import { beforeEach, describe, expect, it } from 'vitest';
import { withTestWorkspace, seedCampaign, addSuppression, addMember } from '../../../testing/harness';
import { sendTest } from '../../test-send/send-test';
import { withWorkspace } from '@mlain/core/tx';
import { rawSql } from '../raw-sql';

describe('testovaci odeslani', () => {
  let ctx: Awaited<ReturnType<typeof withTestWorkspace>>;
  beforeEach(async () => { ctx = await withTestWorkspace(); });

  it('vytvori zpravy s kind = test, ne s priznakem v render_data', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    await sendTest(ctx.workspace, { campaignId: id, recipients: ['a@x.cz', 'b@x.cz', 'c@x.cz'] });
    const r = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ kind: string; render_data: Record<string, unknown> }>(rawSql(
        `SELECT kind, render_data FROM messages WHERE campaign_id = $1`, [id])));
    expect(r.rows).toHaveLength(3);
    expect(r.rows.every((x) => x.kind === 'test')).toBe(true);
    expect(JSON.stringify(r.rows[0].render_data)).not.toContain('_test');
  });

  it('testovaci zpravy se nepocitaji do total_count', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    await sendTest(ctx.workspace, { campaignId: id, recipients: ['a@x.cz'] });
    const r = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ total_count: number }>(rawSql(`SELECT total_count FROM campaigns WHERE id = $1`, [id])));
    expect(r.rows[0].total_count).toBe(0);
  });

  it('predmet se NEPREFIXUJE, protoze messages nema kam ho ulozit', async () => {
    // Rozhodnuti D21. Drive se prefix pocital, vracel v odpovedi a do databaze nezapisoval,
    // takze uzivateli prisel mail nerozeznatelny od ostreho, aniz by to kdokoli rekl nahlas.
    const id = await seedCampaign(ctx, { status: 'draft', subject: 'Letní výprodej' });
    const r = await sendTest(ctx.workspace, { campaignId: id, recipients: ['a@x.cz'] });
    expect(r.subject).toBe('Letní výprodej');
  });

  it('test z DRAFTU projde, i kdyz publikum jeste neexistuje', async () => {
    // Kampan v draftu ma audience_built_at = NULL. Slozeny cizi klic
    // (audience_campaign_id, created_at) -> campaigns (id, audience_built_at) se u
    // kind = 'test' preskoci, protoze generovany sloupec je NULL. Bez pozadavku R-P03.7
    // tenhle test padal na 23503 a testovaci mail z rozepsane kampane neslo poslat vubec.
    const id = await seedCampaign(ctx, { status: 'draft', audienceBuiltAt: null });
    await expect(sendTest(ctx.workspace, { campaignId: id, recipients: ['a@x.cz'] }))
      .resolves.toMatchObject({ created: 1 });
  });

  it('kampanova zprava bez materializace naopak spadnout MUSI', async () => {
    // Druha strana teze mince: invariant I1 se opravou nesmi uvolnit.
    const id = await seedCampaign(ctx, { status: 'draft', audienceBuiltAt: null });
    await expect(
      withWorkspace(ctx.workspace, (tx) => tx.execute(rawSql(
        `INSERT INTO messages (workspace_id, campaign_id, contact_id, kind, email, created_at)
         VALUES ($1, $2, $3, 'campaign', 'x@y.cz', now())`,
        [ctx.workspace.workspaceId, id, ctx.contactId]))),
    ).rejects.toThrow();
  });

  it('contact_id se dohleda, kdyz ho volajici neposle', async () => {
    // messages.contact_id je NOT NULL. Drive se posilalo `input.contactId ?? null`,
    // takze kazde testovaci odeslani bez vyslovneho kontaktu koncilo chybou 23502.
    const id = await seedCampaign(ctx, { status: 'draft' });
    await sendTest(ctx.workspace, { campaignId: id, recipients: ['a@x.cz'] });
    const r = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ contact_id: string | null }>(rawSql(
        `SELECT contact_id FROM messages WHERE campaign_id = $1`, [id])));
    expect(r.rows[0]!.contact_id).not.toBeNull();
  });

  it('opakovany test na tutez adresu projde, neporusi unikatni index', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    await sendTest(ctx.workspace, { campaignId: id, recipients: ['a@x.cz'] });
    await expect(sendTest(ctx.workspace, { campaignId: id, recipients: ['a@x.cz'] }))
      .resolves.toMatchObject({ created: 1 });
  });

  it('render_data testovaci zpravy maji _present, stejne jako ostra materializace', async () => {
    const id = await seedCampaign(ctx, {
      status: 'draft', compiled: true, presence: ['contact.attr.city'],
    });
    await sendTest(ctx.workspace, { campaignId: id, recipients: ['a@x.cz'] });
    const r = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ render_data: Record<string, unknown> }>(rawSql(
        `SELECT render_data FROM messages WHERE campaign_id = $1`, [id])));
    expect(r.rows[0]!.render_data).toHaveProperty('_present');
  });

  it('zruseni kampane NEZRUSI cekajici testovaci zpravy', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    await sendTest(ctx.workspace, { campaignId: id, recipients: ['a@x.cz'] });
    const { cancelPendingBatch } = await import('../outbox');
    const built = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ audience_built_at: string }>(rawSql(
        `UPDATE campaigns SET audience_built_at = date_trunc('second', now())
          WHERE id = $1 RETURNING audience_built_at`, [id])));
    await cancelPendingBatch(ctx.workspace, {
      campaignId: id, audienceBuiltAt: built.rows[0]!.audience_built_at,
    });
    const r = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ status: string }>(rawSql(
        `SELECT status FROM messages WHERE campaign_id = $1 AND kind = 'test'`, [id])));
    expect(r.rows[0]!.status).toBe('pending');
  });

  it('cizi adresa na suppression listu vraci test_recipient_suppressed', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    await addSuppression(ctx, { email: 'cizi@x.cz', reason: 'hard_bounce' });
    await expect(sendTest(ctx.workspace, { campaignId: id, recipients: ['cizi@x.cz'] }))
      .rejects.toThrowError(/test_recipient_suppressed/);
  });

  it('adresa clena projektu na suppression listu projde', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    await addMember(ctx, { email: 'jana@firma.cz' });
    await addSuppression(ctx, { email: 'jana@firma.cz', reason: 'hard_bounce' });
    await expect(sendTest(ctx.workspace, { campaignId: id, recipients: ['jana@firma.cz'] })).resolves.toBeTruthy();
  });

  it('sesta adresa se odmita, limit je pet', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    await expect(sendTest(ctx.workspace, {
      campaignId: id, recipients: ['a@x.cz', 'b@x.cz', 'c@x.cz', 'd@x.cz', 'e@x.cz', 'f@x.cz'],
    })).rejects.toThrowError(/validation_failed/);
  });

  it.each(['queueing', 'sending'] as const)('ve stavu %s test nejde', async (status) => {
    const id = await seedCampaign(ctx, { status });
    await expect(sendTest(ctx.workspace, { campaignId: id, recipients: ['a@x.cz'] }))
      .rejects.toThrowError(/invalid_state_transition/);
  });

  it('stav kampane se testem nemeni', async () => {
    const id = await seedCampaign(ctx, { status: 'draft' });
    await sendTest(ctx.workspace, { campaignId: id, recipients: ['a@x.cz'] });
    const r = await withWorkspace(ctx.workspace, (tx) =>
      tx.execute<{ status: string }>(rawSql(`SELECT status FROM campaigns WHERE id = $1`, [id])));
    expect(r.rows[0].status).toBe('draft');
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:db -- test-send`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napsat testovací odeslání**

```ts
// packages/core/src/campaigns/test-send/send-test.ts
import { withWorkspace, type WorkspaceContext } from '@mlain/core/tx';
import { AppError } from '../../errors';
import { TEST_SEND_MAX_RECIPIENTS } from '../constants';
import { rawSql } from '../repo/raw-sql.js';
import { loadSampleContactIds, SAMPLE_SOURCE_REF_PATTERN } from '../audience/sample-guard.js';

export type SendTestInput = {
  campaignId: string;
  recipients: string[];
  /** Z koho vzit data pro merge tagy. Kdyz chybi, vezme se nahodny z publika. */
  contactId?: string;
};

/**
 * Testovaci mail jde do outboxu a projde uplne stejnou cestou jako ostry, jinak
 * test nic netestuje. Rozlisuje se kontraktnim sloupcem kind = 'test' (rozhodnuti D1),
 * ne magickym klicem uvnitr render_data: filtr NOT (render_data ? '_test') by musel
 * byt v kazdem reportu, rollupu i agregaci a staci ho v jednom z deseti dotazu
 * vynechat. Navic se render_data pri anonymizaci vyprazdnuje, takze by testovaci
 * zprava po vymazu kontaktu prestala byt rozeznatelna a zpetne by se zapocetla.
 */
export async function sendTest(
  ctx: WorkspaceContext,
  input: SendTestInput,
): Promise<{ created: number; subject: string }> {
  if (input.recipients.length < 1 || input.recipients.length > TEST_SEND_MAX_RECIPIENTS) {
    throw new AppError('validation_failed', {
      detail: `Testovací odeslání přijímá 1 až ${TEST_SEND_MAX_RECIPIENTS} adres.`,
      errors: [{ path: 'recipients', code: 'out_of_range', message: 'Nesprávný počet adres.' }],
    });
  }

  return withWorkspace(ctx, async (tx) => {
    const campaign = await tx.execute<{
      status: string; subject: string; compiled_fields: string[]; audience_built_at: string | null;
    }>(rawSql(
      `SELECT status, subject, compiled_fields, audience_built_at
         FROM campaigns WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
      [input.campaignId, ctx.workspaceId],
    ));
    const row = campaign.rows[0];
    if (!row) throw new AppError('not_found', { detail: 'Kampaň neexistuje.' });

    if (!['draft', 'scheduled', 'schedule_missed', 'paused'].includes(row.status)) {
      throw new AppError('invalid_state_transition', {
        detail: 'Testovací odeslání nelze provést během přípravy ani odesílání kampaně.',
        params: { status: row.status },
      });
    }

    // Suppression list se obchazi JEN pro adresy clenu projektu. Jinak by si vyvojar
    // nezkusil nic pote, co si sam omylem nahlasil spam. Cizi adresa na seznamu
    // zustava zakazana i v testu.
    const members = await tx.execute<{ email: string }>(rawSql(
      `SELECT lower(u.email) AS email FROM memberships m
         JOIN users u ON u.id = m.user_id
        WHERE m.workspace_id = $1`,
      [ctx.workspaceId],
    ));
    const memberEmails = new Set(members.rows.map((m) => m.email));

    for (const raw of input.recipients) {
      const email = raw.toLowerCase();
      if (memberEmails.has(email)) continue;
      const sup = await tx.execute(rawSql(
        `SELECT 1 FROM suppressions
          WHERE workspace_id = $1 AND removed_at IS NULL AND lower(email::text) = $2 LIMIT 1`,
        [ctx.workspaceId, email],
      ));
      if ((sup.rowCount ?? 0) > 0) {
        throw new AppError('test_recipient_suppressed', {
          detail: `Adresa ${raw} je na seznamu blokovaných adres.`,
          params: { email: raw },
        });
      }
    }

    // `messages.contact_id` je NOT NULL (rozhodnuti R3 plánu P03, ktere na nem stavi
    // GDPR anonymizaci filtrovanou pres `WHERE contact_id = $2`). Komentar u
    // `SendTestInput` uz drive sliboval "kdyz chybi, vezme se nahodny z publika",
    // ale zadne dohledani neexistovalo a kazde testovaci odeslani bez `contactId`
    // koncilo chybou 23502.
    const contactId = await resolveTestContactId(tx, ctx, input);

    // Data pro merge tagy se berou z ULOZENE compile_meta, stejne jako u ostre
    // materializace, a prochazi TOUTEZ pripravou. Prazdna '{}' by znamenala, ze
    // testovaci mail nema ani personalizaci, ani `_present`, takze by v nem chybely
    // prave ty bloky, kvuli kterym si ho uzivatel posila.
    const renderData = await buildTestRenderData(tx, ctx, input.campaignId, contactId);

    // created_at MUSI byt audience_built_at kampane, kdyz uz existuje.
    //
    // Duvod je slozeny cizi klic z P03:
    //   FOREIGN KEY (audience_campaign_id, created_at) REFERENCES campaigns (id, audience_built_at)
    // Generovany sloupec `audience_campaign_id` je NULL pro `kind = 'test'`, takze
    // se u testovacich zprav kontrola preskoci (MATCH SIMPLE) a test jde odeslat
    // i z draftu, kde `audience_built_at` jeste neexistuje. Bez toho generovaneho
    // sloupce padal test z draftu na 23503, overeno spustenim. Viz pozadavek R-P03.7.
    //
    // Kdyz uz publikum materializovane je, drzime se jeho hodnoty, aby testovaci
    // zprava lezela ve stejnem oddilu jako kampan.
    const createdAt = row.audience_built_at ?? new Date().toISOString();

    for (const raw of input.recipients) {
      await tx.execute(rawSql(
        `INSERT INTO messages
           (workspace_id, campaign_id, contact_id, kind, email, render_data, status, next_attempt_at, created_at)
         VALUES ($1, $2, $3, 'test', $4, $5::jsonb, 'pending', now(), $6::timestamptz)`,
        [ctx.workspaceId, input.campaignId, contactId, raw.toLowerCase(),
          JSON.stringify(renderData), createdAt],
      ));
    }

    // Prefix [TEST] se do `messages` NEZAPISUJE a je to vedome rozhodnuti, ne opomenuti.
    // Tabulka zadny sloupec pro predmet nema (obsah se bere z kampane) a zakladat kvuli
    // prefixu radek v `campaign_content_variants` by znamenalo, ze testovaci mail projde
    // JINOU cestou nez ostry, cimz by prestal testovat to, co ma. Vraci se jen v odpovedi
    // API, aby ho UI mohlo ukazat v potvrzeni, a UI musi rict nahlas, ze testovaci mail
    // vypada presne jako ostry. Viz rozhodnuti D21.
    const subject = row.subject;

    return { created: input.recipients.length, subject };
  });
}

/**
 * Dohleda kontakt, ze ktereho se vezmou data pro merge tagy.
 *
 * Poradi je: vyslovne zadany kontakt, pak prvni kontakt z publika kampane. Kdyz
 * neexistuje ani jeden, vraci se 422 s vysvetlenim, protoze `contact_id` je NOT NULL
 * a tise doplnit ho neni z ceho.
 */
async function resolveTestContactId(
  tx: Tx,
  ctx: WorkspaceContext,
  input: SendTestInput,
): Promise<string> {
  if (input.contactId) {
    const r = await tx.execute<{ id: string }>(rawSql(
      `SELECT id FROM contacts WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
      [input.contactId, ctx.workspaceId],
    ));
    if (!r.rows[0]) {
      throw new AppError('not_found', { detail: 'Zvolený kontakt neexistuje.' });
    }
    return r.rows[0].id;
  }

  // Prvni kontakt z publika kampane. Ukazkove kontakty se preskakuji toutez
  // podminkou jako pri materializaci, aby testovaci mail neukazoval vymyslena data.
  const fromAudience = await tx.execute<{ id: string }>(rawSql(
    `SELECT c.id FROM contacts c
       JOIN messages m ON m.contact_id = c.id AND m.campaign_id = $1 AND m.kind = 'campaign'
      WHERE c.workspace_id = $2 AND c.deleted_at IS NULL
      ORDER BY c.id LIMIT 1`,
    [input.campaignId, ctx.workspaceId],
  ));
  if (fromAudience.rows[0]) return fromAudience.rows[0].id;

  const anyContact = await tx.execute<{ id: string }>(rawSql(
    `SELECT c.id FROM contacts c
      WHERE c.workspace_id = $1 AND c.deleted_at IS NULL AND c.status = 'active'
        AND coalesce(c.source_ref, '') NOT LIKE $2
        AND NOT (c.id = ANY($3::uuid[]))
      ORDER BY c.id LIMIT 1`,
    [ctx.workspaceId, SAMPLE_SOURCE_REF_PATTERN, await loadSampleContactIds(ctx)],
  ));
  if (anyContact.rows[0]) return anyContact.rows[0].id;

  throw new AppError('validation_failed', {
    detail: 'Testovací odeslání potřebuje kontakt, ze kterého vezme data pro slučovací pole. '
      + 'Projekt zatím žádný nemá, vyberte kontakt ručně nebo nějaký založte.',
    errors: [{ path: 'contact_id', code: 'required', message: 'Není z čeho vzít data.' }],
  });
}

/** Data pro render testovaci zpravy. Prochazi TOUTEZ pripravou jako ostra materializace. */
async function buildTestRenderData(
  tx: Tx,
  ctx: WorkspaceContext,
  campaignId: string,
  contactId: string,
): Promise<Record<string, unknown>> {
  const meta = await tx.execute<{ compile_meta: StoredCompileMeta | null }>(rawSql(
    `SELECT compile_meta FROM campaigns WHERE id = $1 AND workspace_id = $2`,
    [campaignId, ctx.workspaceId],
  ));
  const compileMeta = meta.rows[0]?.compile_meta;
  if (!compileMeta) {
    throw new AppError('campaign_not_compiled', {
      detail: 'Kampaň není zkompilovaná, testovací mail by neměl co personalizovat.',
    });
  }

  const c = await tx.execute<ContactRow>(rawSql(
    `SELECT id, email, first_name, last_name, first_name_vocative, greeting, attributes
       FROM contacts WHERE id = $1 AND workspace_id = $2`,
    [contactId, ctx.workspaceId],
  ));
  const contact = c.rows[0]!;

  const snapshot = buildRenderData(contact, compileMeta.usedPaths);
  return prepareRenderData(snapshot.data, toPreparedSchema(compileMeta.renderSchema));
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:db -- test-send`
Expected: PASS, 12 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/campaigns/test-send packages/core/src/campaigns/repo/__tests__/test-send.db.test.ts
git commit -m "feat(campaigns): test send via messages.kind, member-only suppression bypass"
```

---

### Fáze K: rozhraní

#### Úkol 51: Deklarace odchozích webhookových událostí

**Files:**
- Create: `packages/core/src/campaigns/webhooks/declarations.ts`
- Test: `packages/core/src/campaigns/webhooks/__tests__/declarations.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/campaigns/webhooks/__tests__/declarations.test.ts
import { describe, expect, it } from 'vitest';
import { CAMPAIGN_WEBHOOK_TYPES, buildMessageEventData, buildCampaignEventData } from '../declarations';

describe('deklarace odchozich udalosti', () => {
  it('deklaruje ctrnact typu', () => {
    expect(CAMPAIGN_WEBHOOK_TYPES).toHaveLength(14);
    expect(CAMPAIGN_WEBHOOK_TYPES).toContain('campaign.schedule_delayed');
    expect(CAMPAIGN_WEBHOOK_TYPES).toContain('deliverability.threshold_exceeded');
  });

  it('payload message.* nese obe slozky klice zpravy', () => {
    const d = buildMessageEventData({
      message: { id: 'm1', created_at: '2026-08-01T00:00:00.000Z', email: 'a@x.cz', provider_message_id: 'ses-1' },
      campaign: { id: 'k1', name: 'Léto' }, contact: { id: 'c1' },
      event: { type: 'bounced_hard', suppressed: true }, messageStateAfter: 'sent', sequence: 80,
    });
    expect(d.message).toMatchObject({ id: 'm1', created_at: '2026-08-01T00:00:00.000Z' });
  });

  it('nese sequence a message_state_after, protoze doruceni je bez zaruky poradi', () => {
    const d = buildMessageEventData({
      message: { id: 'm1', created_at: 'x', email: 'a@x.cz', provider_message_id: null },
      campaign: { id: 'k1', name: 'L' }, contact: { id: 'c1' },
      event: { type: 'delivered', suppressed: false }, messageStateAfter: 'sent', sequence: 30,
    });
    expect(d).toMatchObject({ sequence: 30, message_state_after: 'sent' });
  });

  it('payload nikdy neobsahuje render_data ani obsah zpravy', () => {
    const d = buildMessageEventData({
      message: { id: 'm1', created_at: 'x', email: 'a@x.cz', provider_message_id: null },
      campaign: { id: 'k1', name: 'L' }, contact: { id: 'c1' },
      event: { type: 'delivered', suppressed: false }, messageStateAfter: 'sent', sequence: 30,
    });
    const s = JSON.stringify(d);
    expect(s).not.toContain('render_data');
    expect(s).not.toContain('compiled_html');
  });

  it('campaign.paused nese cely objekt pause_reason, i u pauz od senderu', () => {
    const d = buildCampaignEventData({
      campaign: { id: 'k1', name: 'L', status: 'paused' },
      counters: { total: 10, sent: 5, failed: 0, skipped: 0, delivered: 4, bounced: 1, complained: 0, pending: 5 },
      pauseReason: { code: 'credentials_undecryptable', source: 'sender', at: '2026-08-01T00:00:00.000Z' },
    });
    expect(d.pause_reason).toMatchObject({ code: 'credentials_undecryptable', source: 'sender' });
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:unit -- webhooks/declarations`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napsat deklarace**

```ts
// packages/core/src/campaigns/webhooks/declarations.ts
import type { CampaignCounters } from '../types';
import type { PauseReason } from '../pause-reason';

export const CAMPAIGN_WEBHOOK_TYPES = [
  'campaign.sending_started', 'campaign.paused', 'campaign.resumed', 'campaign.cancelled',
  'campaign.sent', 'campaign.schedule_delayed', 'campaign.schedule_missed',
  'message.delivered', 'message.bounced', 'message.complained', 'message.failed',
  'provider.status_changed', 'domain.verification_changed', 'deliverability.threshold_exceeded',
] as const;

export type CampaignWebhookType = (typeof CAMPAIGN_WEBHOOK_TYPES)[number];

export function buildCampaignEventData(input: {
  campaign: { id: string; name: string; status: string };
  counters: CampaignCounters;
  pauseReason?: PauseReason;
  scheduledAt?: string;
  delaySeconds?: number;
}) {
  return {
    campaign: input.campaign,
    counters: input.counters,
    ...(input.pauseReason ? { pause_reason: input.pauseReason } : {}),
    ...(input.scheduledAt ? { scheduled_at: input.scheduledAt } : {}),
    ...(input.delaySeconds !== undefined ? { delay_seconds: input.delaySeconds } : {}),
  };
}

/**
 * Dve pole existuji vyhradne proto, ze doruceni webhooku je nejmene jednou a BEZ ZARUKY
 * PORADI. Bez nich by si prijemce nemohl poradit:
 *  - sequence je rank z katalogu udalosti. Prijemce, ktery dostane message.delivered
 *    po message.bounced, podle nej pozna, ze starsi udalost prisla pozdeji.
 *  - message_state_after je nas stav zpravy po zpracovani. Prijemce, ktery chce jen
 *    zrcadlit stav a neresit poradi, si vezme tohle a hotovo.
 *
 * Zasada: payload NIKDY neobsahuje render_data ani obsah zpravy. Odchozi webhook jde
 * na cizi server a osobni data se do nej nedavaji nad ramec e-mailu, ktery je nutny
 * k identifikaci.
 */
export function buildMessageEventData(input: {
  message: { id: string; created_at: string; email: string; provider_message_id: string | null };
  campaign: { id: string; name: string };
  contact: { id: string };
  event: {
    type: string; bounce_class?: 'hard' | 'soft' | 'content';
    bounce_type?: string; bounce_sub_type?: string; diagnostic_code?: string;
    complaint_feedback_type?: string; suppressed: boolean;
  };
  messageStateAfter: 'sent' | 'failed' | 'skipped';
  sequence: number;
}) {
  return {
    // message.created_at je v payloadu proto, ze primarni klic zpravy je (id, created_at).
    // Bez druhe slozky by prijemce, ktery si chce zpravu dohledat pres API, musel
    // prohledavat vsechny partition.
    message: input.message,
    campaign: input.campaign,
    contact: input.contact,
    event: input.event,
    message_state_after: input.messageStateAfter,
    sequence: input.sequence,
  };
}

/**
 * occurred_at v obalce se plni casem SKUTECNE udalosti u providera, ne casem naseho
 * zpracovani. SNS dorucuje mimo poradi a s prodlevou; kdyby tam byl cas zpracovani,
 * prijemce by z nej nemohl rekonstruovat sled udalosti.
 */
export function occurredAtFor(event: { ts: string }): string {
  return new Date(event.ts).toISOString();
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:unit -- webhooks/declarations`
Expected: PASS, 5 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/campaigns/webhooks packages/core/src/campaigns/webhooks/__tests__
git commit -m "feat(campaigns): declare fourteen outgoing webhook types with ordering fields"
```

---

#### Úkol 52: Registrace všech handlerů front

**Files:**
- Create: `packages/core/src/campaigns/jobs/queue-handlers.ts`
- Test: `packages/core/src/campaigns/jobs/__tests__/queue-handlers.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/campaigns/jobs/__tests__/queue-handlers.test.ts
import { describe, expect, it } from 'vitest';
import { queueHandlers } from '../queue-handlers';
import { QUEUE_REGISTRY } from '../../../queues/registry';

describe('registrace handleru front', () => {
  it('dodava handler ke vsem dvanacti frontam teto domeny', () => {
    expect(Object.keys(queueHandlers).sort()).toEqual([
      'campaign.materialize', 'campaign.resume_on_quota', 'campaign.scheduler', 'campaign.watchdog',
      'deliverability.rollup', 'domain.recheck', 'outbox.reconcile', 'outbox.stall_watch',
      'provider.refresh_quota', 'provider_event.process', 'provider_event.rematch',
      'retention.drop_message_partitions',
    ]);
  });

  it('kazda fronta je v registru P01, zadnou nezakladame', () => {
    for (const name of Object.keys(queueHandlers)) {
      expect(Object.keys(QUEUE_REGISTRY)).toContain(name);
    }
  });

  it('kazdy handler ma explicitni retryLimit a expireInSeconds', () => {
    for (const [name, h] of Object.entries(queueHandlers)) {
      expect(h.retryLimit, name).toBeGreaterThan(0);
      expect(h.expireInSeconds, name).toBeGreaterThan(0);
    }
  });

  it('cronove joby maji cron a jednorazove maji singletonKey', () => {
    expect(queueHandlers['campaign.scheduler'].cron).toBeDefined();
    expect(queueHandlers['campaign.materialize'].singletonKey).toBeTypeOf('function');
  });

  it('payload jobu nese jen identifikatory, nikdy osobni udaje', () => {
    for (const [name, h] of Object.entries(queueHandlers)) {
      expect(Object.keys(h.payloadKeys ?? {}), name).not.toContain('email');
      expect(Object.keys(h.payloadKeys ?? {}), name).not.toContain('render_data');
    }
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:unit -- jobs/queue-handlers`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napsat registraci**

```ts
// packages/core/src/campaigns/jobs/queue-handlers.ts
import { MATERIALIZE_JOB } from './materialize';
import { SCHEDULER_JOB } from './scheduler';
import { WATCHDOG_JOB } from './watchdog';
import { RESUME_ON_QUOTA_JOB } from './resume-on-quota';
import { RECONCILE_JOB } from './reconcile';
import { STALL_WATCH_JOB } from './stall-watch';
import { PROVIDER_EVENT_PROCESS_JOB, PROVIDER_EVENT_REMATCH_JOB } from './provider-event-process';
import { REFRESH_QUOTA_JOB } from './provider-refresh-quota';
import { DOMAIN_RECHECK_JOB } from './domain-recheck';
import { RETENTION_JOB } from './retention';

export const DELIVERABILITY_ROLLUP_JOB = {
  queue: 'deliverability.rollup' as const,
  cron: '*/15 * * * *',
  retryLimit: 3,
  expireInSeconds: 600,
};

/**
 * Tenhle soubor je jediny vstupni bod, ktery hleda codegen workeru (rozhodnuti D4
 * planu P01: apps/worker/src/handlers.generated.ts se generuje globem pres
 * packages/core/*​/jobs/queue-handlers.ts). Entrypoint workeru tedy nikdo needituje
 * rucne a osm domenovych planu se o nej neprou.
 *
 * Fronty samotne zaklada P01 dopredu, tady se k nim jen pripojuji handlery.
 * Kazdy job MUSI byt idempotentni: singletonKey zabranuje dvema soubeznym jobum
 * se stejnym klicem, ale NEGARANTUJE, ze job probehne prave jednou.
 */
export const queueHandlers = {
  [MATERIALIZE_JOB.queue]: MATERIALIZE_JOB,
  [SCHEDULER_JOB.queue]: SCHEDULER_JOB,
  [WATCHDOG_JOB.queue]: WATCHDOG_JOB,
  [RESUME_ON_QUOTA_JOB.queue]: RESUME_ON_QUOTA_JOB,
  [RECONCILE_JOB.queue]: RECONCILE_JOB,
  [STALL_WATCH_JOB.queue]: STALL_WATCH_JOB,
  [PROVIDER_EVENT_PROCESS_JOB.queue]: PROVIDER_EVENT_PROCESS_JOB,
  [PROVIDER_EVENT_REMATCH_JOB.queue]: PROVIDER_EVENT_REMATCH_JOB,
  [REFRESH_QUOTA_JOB.queue]: REFRESH_QUOTA_JOB,
  [DOMAIN_RECHECK_JOB.queue]: DOMAIN_RECHECK_JOB,
  [DELIVERABILITY_ROLLUP_JOB.queue]: DELIVERABILITY_ROLLUP_JOB,
  [RETENTION_JOB.queue]: RETENTION_JOB,
} as const;
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:unit -- jobs/queue-handlers`
Expected: PASS, 5 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/campaigns/jobs/queue-handlers.ts packages/core/src/campaigns/jobs/__tests__/queue-handlers.test.ts
git commit -m "feat(campaigns): register twelve queue handlers for worker codegen"
```

---

#### Úkol 53: REST API kampaní

**Files:**
- Create: `apps/web/src/server/routes/campaigns/index.ts`
- Create: `apps/web/src/server/routes/campaigns/schemas.ts`
- Test: `apps/web/src/server/routes/campaigns/__tests__/campaigns.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// apps/web/src/server/routes/campaigns/__tests__/campaigns.test.ts
import { describe, expect, it } from 'vitest';
import { testClient } from '../../../testing/hono-harness';
import campaigns from '../index';

describe('REST API kampani', () => {
  it('POST /send na odeslanou kampan vraci 409 s problem+json', async () => {
    const c = testClient(campaigns, { campaign: { status: 'sent' } });
    const res = await c.post('/campaigns/k1/send', { confirm_recipient_count: 10 });
    expect(res.status).toBe(409);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    expect((await res.json()).code).toBe('invalid_state_transition');
  });

  it('dve soubezna POST /send: jedno 202, druhe 409', async () => {
    const c = testClient(campaigns, { campaign: { status: 'draft' }, singleTransition: true });
    const [a, b] = await Promise.all([
      c.post('/campaigns/k1/send', { confirm_recipient_count: 10 }),
      c.post('/campaigns/k1/send', { confirm_recipient_count: 10 }),
    ]);
    expect([a.status, b.status].sort()).toEqual([202, 409]);
  });

  it('confirm_recipient_count mimo toleranci 1 % vraci campaign_audience_changed', async () => {
    const c = testClient(campaigns, { campaign: { status: 'draft' }, audienceEstimate: 1000 });
    const res = await c.post('/campaigns/k1/send', { confirm_recipient_count: 500 });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('campaign_audience_changed');
  });

  it('GET /preflight vraci vzdy 200, i kdyz jsou nalezy blokujici', async () => {
    const c = testClient(campaigns, { campaign: { status: 'draft', subject: '' } });
    const res = await c.get('/campaigns/k1/preflight');
    expect(res.status).toBe(200);
    expect((await res.json()).can_send).toBe(false);
  });

  it('POST /send pri blokujicim nalezu vraci 422 se VSEMI nalezy', async () => {
    const c = testClient(campaigns, { campaign: { status: 'draft', subject: '' }, blockingFindings: 3 });
    const res = await c.post('/campaigns/k1/send', { confirm_recipient_count: 10 });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('campaign_not_sendable');
    expect(body.findings).toHaveLength(3);
  });

  it('PATCH predmetu ve stavu scheduled vraci 409 campaign_locked', async () => {
    const c = testClient(campaigns, { campaign: { status: 'scheduled' } });
    const res = await c.patch('/campaigns/k1', { subject: 'Nový' });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('campaign_locked');
  });

  it('PATCH jmena ve stavu scheduled projde', async () => {
    const c = testClient(campaigns, { campaign: { status: 'scheduled' } });
    expect((await c.patch('/campaigns/k1', { name: 'Jiné jméno' })).status).toBe(200);
  });

  it('GET /messages vraci u kazde zpravy id i created_at', async () => {
    const c = testClient(campaigns, { campaign: { status: 'sent' } });
    const body = await (await c.get('/campaigns/k1/messages')).json();
    expect(body.data[0]).toHaveProperty('id');
    expect(body.data[0]).toHaveProperty('created_at');
  });

  it('POST /undo po vyprseni okna vraci 409 campaign_undo_window_expired', async () => {
    const c = testClient(campaigns, { campaign: { status: 'sending' }, undoExpired: true });
    const res = await c.post('/campaigns/k1/undo', {});
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('campaign_undo_window_expired');
  });

  it('bez scope campaigns:send vraci 403 insufficient_scope', async () => {
    const c = testClient(campaigns, { campaign: { status: 'draft' }, scopes: ['campaigns:read'] });
    expect((await c.post('/campaigns/k1/pause', {})).status).toBe(403);
  });

  it('21. test za hodinu vraci 429 s hlavickou Retry-After', async () => {
    const c = testClient(campaigns, { campaign: { status: 'draft' }, testSendsThisHour: 20 });
    const res = await c.post('/campaigns/k1/test', { recipients: ['a@x.cz'] });
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBeTruthy();
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/web test:unit -- campaigns`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napsat schémata**

```ts
// apps/web/src/server/routes/campaigns/schemas.ts
import { z } from 'zod';
import { campaignAudienceSchema } from '@mlain/core/campaigns';

export const sendCampaignSchema = z.object({
  /**
   * Povinny a musi se rovnat aktualnimu odhadu publika s toleranci 1 %. Chrani pred tim,
   * aby uzivatel odeslal na vyrazne jine publikum, nez videl na obrazovce, protoze
   * mezitim dobehl import.
   */
  confirm_recipient_count: z.number().int().min(0),
}).strict();

export const scheduleCampaignSchema = z.object({
  scheduled_at: z.string().datetime(),
  timezone: z.string().refine((tz) => Intl.supportedValuesOf('timeZone').includes(tz), {
    message: 'Neznámá časová zóna.',
  }),
  confirm_recipient_count: z.number().int().min(0),
}).strict();

export const patchCampaignSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  subject: z.string().max(255).optional(),
  preheader: z.string().max(255).optional(),
  from_name: z.string().max(200).optional(),
  from_email: z.string().email().optional(),
  reply_to: z.string().email().nullable().optional(),
  template_id: z.string().uuid().nullable().optional(),
  audience: campaignAudienceSchema.optional(),
  provider_id: z.string().uuid().nullable().optional(),
  sender_domain_id: z.string().uuid().nullable().optional(),
  unsubscribe_list_id: z.string().uuid().nullable().optional(),
  track_opens: z.boolean().optional(),
  track_clicks: z.boolean().optional(),
  scheduled_at: z.string().datetime().nullable().optional(),
  schedule_timezone: z.string().nullable().optional(),
}).strict();

export const sendTestSchema = z.object({
  recipients: z.array(z.string().email()).min(1).max(5),
  contact_id: z.string().uuid().optional(),
}).strict();

/** Ve stavu scheduled se smi menit jen tyhle tri klice, viz cast 4a, 3.5.5. */
export const EDITABLE_WHILE_SCHEDULED = new Set(['name', 'scheduled_at', 'schedule_timezone']);
```

- [ ] **Step 4: Napsat sub-app**

```ts
// apps/web/src/server/routes/campaigns/index.ts
import { OpenAPIHono } from '@hono/zod-openapi';
import { problem, ok, accepted, paginate } from '../../../lib/api';
import { requireScope } from '../../../lib/api/auth';
import { runPreflight } from '@mlain/core/campaigns';
import { AUDIENCE_CONFIRM_TOLERANCE } from '@mlain/core/campaigns';
import { patchCampaignSchema, sendCampaignSchema, scheduleCampaignSchema, sendTestSchema, EDITABLE_WHILE_SCHEDULED } from './schemas';

/**
 * Sub-app se do korenove Hono aplikace pripojuje generovanym registrem, ne editaci
 * sdileneho souboru (rozhodnuti D13). Registr se pri konfliktu pregeneruje, nikdy
 * neslucuje rucne, stejne jako openapi.json.
 */
const app = new OpenAPIHono();

app.get('/campaigns', requireScope('campaigns:read'), async (c) => {
  const svc = c.get('campaigns');
  const page = await svc.list(c.get('ctx'), {
    status: c.req.query('status'), cursor: c.req.query('cursor'), limit: Number(c.req.query('limit') ?? 25),
  });
  return ok(c, paginate(page));
});

app.post('/campaigns', requireScope('campaigns:write'), async (c) => {
  const svc = c.get('campaigns');
  const created = await svc.create(c.get('ctx'), await c.req.json());
  return c.json(created, 201, { Location: `/api/v1/campaigns/${created.id}` });
});

app.get('/campaigns/:id', requireScope('campaigns:read'), async (c) => {
  const found = await c.get('campaigns').get(c.get('ctx'), c.req.param('id'));
  if (!found) return problem(c, 'not_found');
  return ok(c, found);
});

app.patch('/campaigns/:id', requireScope('campaigns:write'), async (c) => {
  const body = patchCampaignSchema.parse(await c.req.json());
  const svc = c.get('campaigns');
  const current = await svc.get(c.get('ctx'), c.req.param('id'));
  if (!current) return problem(c, 'not_found');

  const touched = Object.keys(body);
  const lockedByState = current.status !== 'draft' && current.status !== 'schedule_missed';
  const onlyAllowed = touched.every((k) => EDITABLE_WHILE_SCHEDULED.has(k));

  if (lockedByState && !(current.status === 'scheduled' && onlyAllowed)) {
    // UI nabizi "Zrusit plan a upravit", coz je jina akce nez u obecneho konfliktu.
    return problem(c, 'campaign_locked', { params: { status: current.status } });
  }
  return ok(c, await svc.update(c.get('ctx'), c.req.param('id'), body));
});

app.delete('/campaigns/:id', requireScope('campaigns:write'), async (c) => {
  const r = await c.get('campaigns').softDelete(c.get('ctx'), c.req.param('id'));
  if (!r.deleted) return problem(c, 'conflict', { detail: 'Smazat lze jen rozepsanou kampaň.' });
  return c.body(null, 204);
});

app.post('/campaigns/:id/duplicate', requireScope('campaigns:write'), async (c) =>
  c.json(await c.get('campaigns').duplicate(c.get('ctx'), c.req.param('id')), 201));

app.post('/campaigns/:id/audience/preview', requireScope('campaigns:read'), async (c) =>
  ok(c, await c.get('campaigns').previewAudience(c.get('ctx'), c.req.param('id'))));

// Dotaz na stav, ne pokus o akci: vraci VZDY 200 s vyplnenym findings.
app.get('/campaigns/:id/preflight', requireScope('campaigns:read'), async (c) =>
  ok(c, await c.get('campaigns').preflight(c.get('ctx'), c.req.param('id'))));

app.post('/campaigns/:id/send', requireScope('campaigns:send'), async (c) => {
  const body = sendCampaignSchema.parse(await c.req.json());
  const svc = c.get('campaigns');
  const pre = await svc.preflight(c.get('ctx'), c.req.param('id'));

  const drift = Math.abs(pre.audience_estimate - body.confirm_recipient_count);
  if (drift > Math.max(1, pre.audience_estimate * AUDIENCE_CONFIRM_TOLERANCE)) {
    return problem(c, 'campaign_audience_changed', {
      params: { expected: body.confirm_recipient_count, actual: pre.audience_estimate },
    });
  }
  if (!pre.can_send) {
    return problem(c, 'campaign_not_sendable', { findings: pre.findings });
  }

  // Treti cast rozhodnuti D17: rekompilace a porovnani s ulozenou compile_meta.
  // Musi byt AZ TADY, po preflightu a po potvrzeni poctu, protoze je to jedina
  // operace v cele ceste, ktera zapisuje. Pri neshode se kampan neodesle.
  //
  // Bez tohohle volani byla `assertCompileMetaMatches` definice bez volajiciho a
  // rozejita ID odkazu by se projevila az tim, ze report kliku zustane prazdny.
  try {
    await svc.assertCompilationCurrent(c.get('ctx'), c.req.param('id'));
  } catch (err) {
    if (err instanceof AppError && err.code === 'contract_mismatch') {
      return problem(c, 'contract_mismatch', { detail: err.detail });
    }
    throw err;
  }

  const r = await svc.send(c.get('ctx'), c.req.param('id'));
  if (!r.started) return problem(c, 'invalid_state_transition', { params: { status: r.status } });
  // Varovani se u uspechu predavaji v odpovedi, ne v chybe.
  return accepted(c, { id: c.req.param('id'), warnings: pre.findings.filter((f) => f.severity === 'warning') });
});

for (const [path, action, scope] of [
  ['schedule', 'schedule', 'campaigns:send'],
  ['unschedule', 'unschedule', 'campaigns:send'],
  ['pause', 'pause', 'campaigns:send'],
  ['resume', 'resume', 'campaigns:send'],
  ['cancel', 'cancel', 'campaigns:send'],
  ['undo', 'undo', 'campaigns:send'],
] as const) {
  app.post(`/campaigns/:id/${path}`, requireScope(scope), async (c) => {
    const body = path === 'schedule' ? scheduleCampaignSchema.parse(await c.req.json()) : {};
    const r = await c.get('campaigns')[action](c.get('ctx'), c.req.param('id'), body as never);
    if (!r.ok) return problem(c, r.code, { params: r.params });
    return ok(c, r.data);
  });
}

app.post('/campaigns/:id/test', requireScope('campaigns:send'), async (c) => {
  const body = sendTestSchema.parse(await c.req.json());
  const r = await c.get('campaigns').sendTest(c.get('ctx'), c.req.param('id'), body);
  if (!r.ok) return problem(c, r.code, { params: r.params, retryAfter: r.retryAfter });
  return accepted(c, r.data);
});

app.get('/campaigns/:id/progress', requireScope('campaigns:read'), async (c) =>
  ok(c, await c.get('campaigns').progress(c.get('ctx'), c.req.param('id'))));

// Vraci id I created_at, protoze samotne id zpravu jednoznacne nezadresuje.
app.get('/campaigns/:id/messages', requireScope('campaigns:read'), async (c) =>
  ok(c, paginate(await c.get('campaigns').listMessages(c.get('ctx'), c.req.param('id'), {
    status: c.req.query('status'), cursor: c.req.query('cursor'),
  }))));

export default app;
```

- [ ] **Step 5: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/web test:unit -- campaigns`
Expected: PASS, 11 testů.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/server/routes/campaigns
git commit -m "feat(web): campaigns REST API with preflight, undo and audience confirmation"
```

---

#### Úkol 54: REST API providerů a domén

**Files:**
- Create: `apps/web/src/server/routes/providers/index.ts`
- Test: `apps/web/src/server/routes/providers/__tests__/providers.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// apps/web/src/server/routes/providers/__tests__/providers.test.ts
import { describe, expect, it } from 'vitest';
import { testClient } from '../../../testing/hono-harness';
import providers from '../index';

describe('REST API provideru a domen', () => {
  it('GET /providers nikdy nevraci tajemstvi, jen maskovany klic', async () => {
    const c = testClient(providers, {});
    const body = await (await c.get('/providers')).json();
    const s = JSON.stringify(body);
    expect(s).not.toMatch(/secret_access_key|config_encrypted|password/);
    expect(s).toMatch(/\*\*\*\*/);
  });

  it('PATCH bez pole tajemstvi tajemstvi nemeni', async () => {
    const c = testClient(providers, {});
    const res = await c.patch('/providers/p1', { name: 'Nový název' });
    expect(res.status).toBe(200);
    expect((await res.json()).credentials_rotated).toBe(false);
  });

  it('DELETE provideru s bezici kampani vraci 409', async () => {
    const c = testClient(providers, { hasRunningCampaign: true });
    expect((await c.delete('/providers/p1')).status).toBe(409);
  });

  it('POST /test vraci inline vysledek, ne toast, a mapovany kod', async () => {
    const c = testClient(providers, { smtpResult: { ok: false, code: 'provider_smtp_auth_failed' } });
    const res = await c.post('/providers/p1/test', {});
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('provider_smtp_auth_failed');
  });

  it('POST /domains vraci pet zaznamu k vlozeni', async () => {
    const c = testClient(providers, {});
    const body = await (await c.post('/domains', { domain: 'example.cz', provider_id: 'p1' })).json();
    expect(body.records).toHaveLength(5);
    expect(body.records.filter((r: { purpose: string }) => r.purpose === 'dkim')).toHaveLength(3);
  });

  it('POST /domains/:id/check ma rate limit 1 za 30 s s retry_after', async () => {
    const c = testClient(providers, { lastCheckSecondsAgo: 5 });
    const res = await c.post('/domains/d1/check', {});
    expect(res.status).toBe(429);
    expect((await res.json()).retry_after).toBeGreaterThan(0);
  });

  it('GET /providers/:id/quota vraci cerstve volani GetAccount', async () => {
    const c = testClient(providers, {});
    const body = await (await c.get('/providers/p1/quota')).json();
    expect(body).toHaveProperty('quota_max_24h');
    expect(body).toHaveProperty('production_access');
  });

  it('POST /setup-events vraci topic ARN a jmeno Configuration Setu', async () => {
    const c = testClient(providers, {});
    const body = await (await c.post('/providers/p1/setup-events', {})).json();
    expect(body).toMatchObject({ configuration_set_name: expect.stringMatching(/^mlain-/) });
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/web test:unit -- providers`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napsat sub-app**

```ts
// apps/web/src/server/routes/providers/index.ts
import { OpenAPIHono } from '@hono/zod-openapi';
import { z } from 'zod';
import { problem, ok } from '../../../lib/api';
import { requireScope } from '../../../lib/api/auth';
import { DOMAIN_CHECK_MIN_INTERVAL_SECONDS } from '@mlain/core/campaigns';

const app = new OpenAPIHono();

const createProviderSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ses'), name: z.string().min(1),
    region: z.string(), access_key_id: z.string(), secret_access_key: z.string(),
    is_default: z.boolean().default(false),
  }).strict(),
  z.object({
    type: z.literal('smtp'), name: z.string().min(1),
    host: z.string(), port: z.number(), username: z.string(), password: z.string(),
    encryption: z.enum(['starttls', 'tls', 'none']),
    is_default: z.boolean().default(false),
  }).strict(),
]);

app.get('/providers', requireScope('settings:read'), async (c) =>
  ok(c, await c.get('providers').list(c.get('ctx'))));

app.post('/providers', requireScope('settings:write'), async (c) => {
  const body = createProviderSchema.parse(await c.req.json());
  return c.json(await c.get('providers').create(c.get('ctx'), body), 201);
});

app.patch('/providers/:id', requireScope('settings:write'), async (c) => {
  // Tajemstvi se meni JEN kdyz se posle. Zmena se zapisuje do auditu, hodnoty ne.
  const r = await c.get('providers').update(c.get('ctx'), c.req.param('id'), await c.req.json());
  return ok(c, r);
});

app.delete('/providers/:id', requireScope('settings:write'), async (c) => {
  const r = await c.get('providers').remove(c.get('ctx'), c.req.param('id'));
  if (!r.ok) return problem(c, 'conflict', { detail: 'Odesílací účet má rozpracovanou kampaň.' });
  return c.body(null, 204);
});

app.post('/providers/:id/test', requireScope('settings:write'), async (c) => {
  const r = await c.get('providers').testConnection(c.get('ctx'), c.req.param('id'));
  if (!r.ok) return problem(c, r.code, { detail: r.detail });
  return ok(c, r);
});

app.post('/providers/:id/setup-events', requireScope('settings:write'), async (c) =>
  ok(c, await c.get('providers').setupEvents(c.get('ctx'), c.req.param('id'))));

app.get('/providers/:id/quota', requireScope('settings:read'), async (c) =>
  ok(c, await c.get('providers').freshQuota(c.get('ctx'), c.req.param('id'))));

app.post('/providers/:id/default', requireScope('settings:write'), async (c) => {
  await c.get('providers').setDefault(c.get('ctx'), c.req.param('id'));
  return ok(c, { ok: true });
});

app.get('/domains', requireScope('settings:read'), async (c) =>
  ok(c, await c.get('domains').list(c.get('ctx'))));

app.post('/domains', requireScope('settings:write'), async (c) => {
  const body = z.object({ domain: z.string().min(1), provider_id: z.string().uuid() }).strict()
    .parse(await c.req.json());
  return c.json(await c.get('domains').add(c.get('ctx'), body), 201);
});

app.get('/domains/:id', requireScope('settings:read'), async (c) => {
  const d = await c.get('domains').get(c.get('ctx'), c.req.param('id'));
  if (!d) return problem(c, 'not_found');
  return ok(c, d);
});

app.post('/domains/:id/check', requireScope('settings:write'), async (c) => {
  const svc = c.get('domains');
  const since = await svc.secondsSinceLastCheck(c.get('ctx'), c.req.param('id'));
  if (since !== null && since < DOMAIN_CHECK_MIN_INTERVAL_SECONDS) {
    // Obecny rate_limited, ne vlastni kod: klient s nim nakladá stejne.
    return problem(c, 'rate_limited', { retryAfter: DOMAIN_CHECK_MIN_INTERVAL_SECONDS - since });
  }
  return ok(c, await svc.checkNow(c.get('ctx'), c.req.param('id')));
});

app.post('/domains/:id/mail-from', requireScope('settings:write'), async (c) => {
  const body = z.object({ subdomain: z.string().min(1).max(63) }).strict().parse(await c.req.json());
  return ok(c, await c.get('domains').setMailFrom(c.get('ctx'), c.req.param('id'), body.subdomain));
});

app.delete('/domains/:id', requireScope('settings:write'), async (c) => {
  await c.get('domains').remove(c.get('ctx'), c.req.param('id'));
  return c.body(null, 204);
});

export default app;
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/web test:unit -- providers`
Expected: PASS, 8 testů.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/routes/providers
git commit -m "feat(web): providers and domains REST API without leaking secrets"
```

---

#### Úkol 55: Endpoint pro příjem SNS

**Files:**
- Create: `apps/web/src/server/routes/webhooks-ses/index.ts`
- Test: `apps/web/src/server/routes/webhooks-ses/__tests__/webhook.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// apps/web/src/server/routes/webhooks-ses/__tests__/webhook.test.ts
import { describe, expect, it } from 'vitest';
import bounce from '@mlain/contracts/fixtures/sns/notification-bounce-permanent.json';
import confirmation from '@mlain/contracts/fixtures/sns/subscription-confirmation.json';
import { testClient } from '../../../testing/hono-harness';
import webhook from '../index';

const raw = (body: unknown) => JSON.stringify(body);

describe('POST /api/webhooks/ses/{provider_id}', () => {
  it('spatny podpis vraci 401 a NEZAPISE nic do provider_event_receipts', async () => {
    const c = testClient(webhook, { verify: { ok: false, reason: 'bad_signature' } });
    const res = await c.postRaw('/api/webhooks/ses/p1', raw(bounce), 'text/plain; charset=UTF-8');
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body).toMatchObject({ code: 'signature_invalid', params: { reason: 'bad_signature' } });
    expect(c.state.receiptsWritten).toBe(0);
  });

  it('cert URL na cizim hostu vraci 401 cert_url_not_allowed', async () => {
    const c = testClient(webhook, { verify: { ok: false, reason: 'cert_url_not_allowed' } });
    const res = await c.postRaw('/api/webhooks/ses/p1', raw(bounce), 'text/plain');
    expect((await res.json()).params.reason).toBe('cert_url_not_allowed');
  });

  it('cizi topic vraci 401 topic_mismatch', async () => {
    const c = testClient(webhook, { verify: { ok: false, reason: 'topic_mismatch' } });
    expect((await (await c.postRaw('/api/webhooks/ses/p1', raw(bounce), 'text/plain')).json()).params.reason)
      .toBe('topic_mismatch');
  });

  it('platna Notification vraci 200 s prazdnym telem a posle job', async () => {
    const c = testClient(webhook, { verify: { ok: true } });
    const res = await c.postRaw('/api/webhooks/ses/p1', raw(bounce), 'text/plain');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('');
    expect(c.state.jobsSent).toBe(1);
  });

  it('SubscriptionConfirmation potvrdi odber a posune providera na ready', async () => {
    const c = testClient(webhook, { verify: { ok: true } });
    await c.postRaw('/api/webhooks/ses/p1', raw(confirmation), 'text/plain');
    expect(c.state.subscriptionConfirmed).toBe(true);
  });

  it('stare Timestamp se prijme s 200, ale nezpracuje', async () => {
    const c = testClient(webhook, { verify: { ok: false, reason: 'stale_timestamp', accept: true } });
    const res = await c.postRaw('/api/webhooks/ses/p1', raw(bounce), 'text/plain');
    expect(res.status).toBe(200);
    expect(c.state.jobsSent).toBe(0);
  });

  it('telo nad 256 kB vraci 413', async () => {
    const c = testClient(webhook, { verify: { ok: true } });
    expect((await c.postRaw('/api/webhooks/ses/p1', 'x'.repeat(300 * 1024), 'text/plain')).status).toBe(413);
  });

  it('chyba zpracovani NEVRACI 500, jinak by SNS zesilovalo provoz', async () => {
    const c = testClient(webhook, { verify: { ok: true }, jobThrows: true });
    expect((await c.postRaw('/api/webhooks/ses/p1', raw(bounce), 'text/plain')).status).toBe(200);
  });

  it('odpoved neobsahuje nic z tela pozadavku, endpoint neni reflektor', async () => {
    const c = testClient(webhook, { verify: { ok: true } });
    const res = await c.postRaw('/api/webhooks/ses/p1', raw(bounce), 'text/plain');
    expect(await res.text()).not.toContain('TopicArn');
  });

  it('endpoint prijima text/plain, ktery by konvence /api/v1 odmitla', async () => {
    const c = testClient(webhook, { verify: { ok: true } });
    expect((await c.postRaw('/api/webhooks/ses/p1', raw(bounce), 'text/plain; charset=UTF-8')).status).toBe(200);
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/web test:unit -- webhook`
Expected: FAIL, modul neexistuje.

- [ ] **Step 3: Napsat endpoint**

```ts
// apps/web/src/server/routes/webhooks-ses/index.ts
import { Hono } from 'hono';
import { verifySnsMessage } from '@mlain/core/providers';
import { dedupKey } from '@mlain/core/providers';
import { handleSubscriptionConfirmation } from '@mlain/core/providers';
import { problem } from '../../../lib/api';

const MAX_BODY_BYTES = 256 * 1024;

/**
 * Ctvrty povrch API (cast 1, 4.1): bez autentizace, bez CSRF, bez rate limitu podle 4.5.
 * Ochranu dela overeni podpisu, ne autentizace, protoze SNS zadnou nema. Rate limit
 * by znamenal, ze provider doruceni opakuje a vznikne lavina.
 *
 * Telo se cte SYROVE a podpis se overuje nad nim, ne nad znovu serializovanym JSONem.
 */
const app = new Hono();

app.post('/api/webhooks/ses/:providerId', async (c) => {
  const providerId = c.req.param('providerId');
  const raw = await c.req.text();

  if (Buffer.byteLength(raw, 'utf8') > MAX_BODY_BYTES) {
    return problem(c, 'payload_too_large');
  }

  let msg: Record<string, string>;
  try {
    msg = JSON.parse(raw);
  } catch {
    return problem(c, 'validation_failed', { detail: 'Tělo není platný JSON.' });
  }

  // workspace_id se bere z provider_id v CESTE, nikdy z tela pozadavku.
  const provider = await c.get('providers').findForWebhook(providerId);
  if (!provider) return c.body(null, 200);

  const verdict = await verifySnsMessage(msg as never, {
    expectedTopicArn: provider.snsTopicArn,
    now: new Date(),
    validator: c.get('snsValidator'),
  });

  if (!verdict.ok && !verdict.accept) {
    await c.get('audit').securityEvent({
      workspaceId: provider.workspaceId, action: 'webhook.signature_invalid',
      detail: { reason: verdict.reason, topic_arn: msg.TopicArn, ip: c.req.header('x-forwarded-for') },
    });
    return problem(c, 'signature_invalid', { status: 401, params: { reason: verdict.reason } });
  }

  if (!verdict.ok && verdict.accept) {
    // stale_timestamp: prijme se, zaznamena jako invalid, nezpracuje.
    await c.get('receipts').recordInvalid(provider.workspaceId, providerId, msg.MessageId, verdict.reason);
    return c.body(null, 200);
  }

  if (msg.Type === 'SubscriptionConfirmation') {
    await handleSubscriptionConfirmation(c.get('subscription'), msg as never, providerId);
    return c.body(null, 200);
  }
  if (msg.Type === 'UnsubscribeConfirmation') {
    await c.get('providers').markEventsStopped(provider.workspaceId, providerId);
    return c.body(null, 200);
  }

  try {
    const receiptId = await c.get('receipts').insertOnce(provider.workspaceId, {
      providerId, dedupKey: dedupKey(msg as never), snsMessageId: msg.MessageId,
      eventType: msg.Type, raw: msg,
    });
    // Prazdny receiptId znamena, ze zprava uz byla prijata. Endpoint vrati 200
    // a nic dalsiho nedela.
    if (receiptId) {
      await c.get('jobs').send('provider_event.process', {
        workspaceId: provider.workspaceId, providerId, receiptId,
      }, { singletonKey: `event:${dedupKey(msg as never)}` });
    }
  } catch (err) {
    // Chyby zpracovani NIKDY nevraci 500: SNS opakuje doruceni pri kazdem non-2xx
    // a exponencialne, takze bychom si vyrobili zesileni provozu. Resi se ulozenim
    // do provider_event_receipts a vlastnim retry.
    c.get('log').error('zpracovani SNS udalosti selhalo', { providerId, err });
  }

  // Zadne echo tela, aby endpoint neposlouzil jako reflektor.
  return c.body(null, 200);
});

export default app;
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/web test:unit -- webhook`
Expected: PASS, 10 testů.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/routes/webhooks-ses
git commit -m "feat(web): SNS webhook endpoint with raw body verification and no amplification"
```

---

#### Úkol 56: Delegační odkaz a zkušební režim

**Files:**
- Create: `packages/core/src/providers/delegation.ts`
- Create: `packages/core/src/providers/trial-mode.ts`
- Test: `packages/core/src/providers/__tests__/delegation-trial.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/core/src/providers/__tests__/delegation-trial.test.ts
import { describe, expect, it } from 'vitest';
import { createDelegationToken, verifyDelegationToken, DELEGATION_PUBLIC_FIELDS } from '../delegation';
import { canSendInTrial, trialAudienceNotice, addTrialAddress } from '../trial-mode';

describe('delegacni odkaz', () => {
  it('token je 32 bajtu a uklada se jako otisk, nikdy v plaintextu', () => {
    const t = createDelegationToken();
    expect(Buffer.from(t.token, 'base64url').length).toBe(32);
    expect(t.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(t.hash).not.toContain(t.token);
  });

  it('plati 14 dni', () => {
    const t = createDelegationToken({ now: new Date('2026-08-01T00:00:00.000Z') });
    expect(t.expiresAt.toISOString()).toBe('2026-08-15T00:00:00.000Z');
  });

  it('vyprsely token neprojde', () => {
    const t = createDelegationToken({ now: new Date('2026-08-01T00:00:00.000Z') });
    expect(verifyDelegationToken(t.token, { hash: t.hash, expiresAt: t.expiresAt, now: new Date('2026-08-20T00:00:00.000Z') }))
      .toBe(false);
  });

  it('stranka ukazuje jen zaznamy a stav, nic z nastroje', () => {
    expect(DELEGATION_PUBLIC_FIELDS).toEqual(['domain', 'company_name', 'records', 'checks', 'checked_at']);
    expect(DELEGATION_PUBLIC_FIELDS).not.toContain('contacts');
    expect(DELEGATION_PUBLIC_FIELDS).not.toContain('campaigns');
  });
});

describe('zkusebni rezim', () => {
  const settings = { trial_mode: true, trial_verified: [{ email: 'jana@firma.cz', verified_at: '2026-08-01T00:00:00.000Z' }] };

  it('overena adresa projde, neoverena ne', () => {
    expect(canSendInTrial('jana@firma.cz', settings)).toBe(true);
    expect(canSendInTrial('kdokoliv@jinde.cz', settings)).toBe(false);
  });

  it('nepotvrzena adresa neprojde, i kdyz je v seznamu', () => {
    expect(canSendInTrial('nova@firma.cz', { trial_mode: true, trial_verified: [{ email: 'nova@firma.cz', verified_at: null }] }))
      .toBe(false);
  });

  it('pruh na publiku rekne konkretni cislo, ne obecne varovani', () => {
    expect(trialAudienceNotice({ audienceSize: 12_480, verifiedCount: 2 }))
      .toMatchObject({ audience: 12_480, willReceive: 2 });
  });

  it('jedenacta adresa se odmita, limit je deset', () => {
    const full = { trial_mode: true, trial_verified: Array.from({ length: 10 }, (_, i) => ({ email: `a${i}@x.cz`, verified_at: null })) };
    expect(() => addTrialAddress(full, 'jedenacta@x.cz')).toThrowError(/nejvýše 10/);
  });

  it('vypnuty zkusebni rezim nikoho neomezuje', () => {
    expect(canSendInTrial('kdokoliv@jinde.cz', { trial_mode: false, trial_verified: [] })).toBe(true);
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/core test:unit -- delegation-trial`
Expected: FAIL, moduly neexistují.

- [ ] **Step 3: Napsat oba moduly**

```ts
// packages/core/src/providers/delegation.ts
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { DELEGATION_TTL_DAYS } from '../campaigns/constants';

/**
 * "Poslu to cloveku, ktery spravuje nas web" je hlavni odpoved na otazku, jestli
 * nastaveni DNS zvladne netechnicky clovek. Nezvladne, ale zvladne vybrat tuhle
 * moznost a preposlat e-mail.
 *
 * Odkaz ukazuje JEN zaznamy pro jednu domenu, navod a stav overeni. Nic z nastroje:
 * zadne kontakty, zadne kampane, zadny nazev projektu krome jmena firmy.
 */
export const DELEGATION_PUBLIC_FIELDS = ['domain', 'company_name', 'records', 'checks', 'checked_at'] as const;

export function createDelegationToken(opts: { now?: Date } = {}): {
  token: string; hash: string; expiresAt: Date;
} {
  const token = randomBytes(32).toString('base64url');
  const now = opts.now ?? new Date();
  return {
    token,
    hash: createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(now.getTime() + DELEGATION_TTL_DAYS * 86_400_000),
  };
}

export function verifyDelegationToken(
  token: string,
  stored: { hash: string; expiresAt: Date; now?: Date },
): boolean {
  const now = stored.now ?? new Date();
  if (now >= stored.expiresAt) return false;
  const a = Buffer.from(createHash('sha256').update(token).digest('hex'));
  const b = Buffer.from(stored.hash);
  return a.length === b.length && timingSafeEqual(a, b);
}
```

```ts
// packages/core/src/providers/trial-mode.ts
import { TRIAL_MAX_VERIFIED_ADDRESSES } from '../campaigns/constants';

export type TrialSettings = {
  trial_mode?: boolean;
  trial_verified?: Array<{ email: string; verified_at: string | null }>;
};

/**
 * Zkusebni rezim se uklada do workspaces.settings.campaigns, nezaklada tabulku
 * (rozhodnuti D15): je to nejvyse deset adres a jeden prepinac na projekt.
 */
export function canSendInTrial(email: string, settings: TrialSettings): boolean {
  if (!settings.trial_mode) return true;
  return (settings.trial_verified ?? []).some(
    (a) => a.email.toLowerCase() === email.toLowerCase() && a.verified_at !== null,
  );
}

/**
 * Riziko, ktere cast 6 v 8.2.9 priznava: uzivatel si postavi kampan na 20 000 lidi
 * a teprve pri odeslani zjisti, ze je ve zkusebnim rezimu. Zmirnenim je pruh
 * s KONKRETNIM cislem primo na obrazovce publika, ne obecne varovani.
 */
export function trialAudienceNotice(input: { audienceSize: number; verifiedCount: number }) {
  return { audience: input.audienceSize, willReceive: input.verifiedCount };
}

export function addTrialAddress(settings: TrialSettings, email: string): TrialSettings {
  const current = settings.trial_verified ?? [];
  if (current.length >= TRIAL_MAX_VERIFIED_ADDRESSES) {
    throw new Error(`Ve zkušebním režimu lze ověřit nejvýše ${TRIAL_MAX_VERIFIED_ADDRESSES} adres.`);
  }
  if (current.some((a) => a.email.toLowerCase() === email.toLowerCase())) return settings;
  return { ...settings, trial_verified: [...current, { email: email.toLowerCase(), verified_at: null }] };
}
```

- [ ] **Step 4: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/core test:unit -- delegation-trial`
Expected: PASS, 9 testů.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/providers/delegation.ts packages/core/src/providers/trial-mode.ts packages/core/src/providers/__tests__/delegation-trial.test.ts
git commit -m "feat(providers): delegation link and trial mode without a new table"
```

---

### Fáze L: obrazovky a i18n

#### Úkol 57: Namespace i18n `campaigns`

**Files:**
- Create: `packages/i18n/messages/en/campaigns.json`
- Create: `packages/i18n/messages/cs/campaigns.json`
- Test: `packages/i18n/__tests__/campaigns-namespace.test.ts`

- [ ] **Step 1: Napsat padající test**

```ts
// packages/i18n/__tests__/campaigns-namespace.test.ts
import { describe, expect, it } from 'vitest';
import cs from '../messages/cs/campaigns.json';
import en from '../messages/en/campaigns.json';

function flatten(obj: Record<string, unknown>, prefix = ''): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'object' && v !== null ? flatten(v as Record<string, unknown>, `${prefix}${k}.`) : [`${prefix}${k}`]);
}

describe('namespace campaigns', () => {
  it('cs a en maji shodnou mnozinu klicu, en je zdroj pravdy', () => {
    expect(flatten(cs).sort()).toEqual(flatten(en).sort());
  });

  it('pokryva vsech deset stavu kampane', () => {
    for (const s of ['draft', 'scheduled', 'queueing', 'sending', 'paused', 'sent', 'partiallySent', 'cancelled', 'failed', 'scheduleMissed']) {
      expect(cs.status).toHaveProperty(s);
    }
  });

  it('pokryva VSECH DEVET kodu pause_reason, vcetne ctyr od senderu', () => {
    for (const code of ['renderFailureRate', 'credentialsUndecryptable', 'providerQuotaExhausted',
      'providerUnavailable', 'user', 'bounceGuard', 'complaintGuard', 'providerBlocked', 'materializeTimeout']) {
      expect(cs.pauseReason, code).toHaveProperty(code);
    }
  });

  it('cesky plural ma kategorie one, few, many i other', () => {
    expect(cs.audience.recipientCount).toMatch(/one \{/);
    expect(cs.audience.recipientCount).toMatch(/few \{/);
    expect(cs.audience.recipientCount).toMatch(/many \{/);
    expect(cs.audience.recipientCount).toMatch(/other \{/);
  });

  it('pocet DNS zaznamu je ICU plural, ne pevne slovo', () => {
    expect(cs.dns.recordCount).toMatch(/\{count, plural,/);
  });

  it('texty o nevratnosti rikaji rovnou, ze odeslane maily zpatky nejdou', () => {
    expect(cs.progress.stopped).toContain('zpátky');
    expect(en.progress.stopped).toContain("can't be recalled");
  });

  it('zadny klic neobsahuje dlouhou pomlcku', () => {
    // U+2014 se zapisuje escapem schvalne: znak samotny se do repozitare nedostane
    // ani v testu, ktery ho zakazuje, takze grep pres cely strom zustava cisty.
    expect(JSON.stringify(cs)).not.toContain('\u2014');
    expect(JSON.stringify(en)).not.toContain('\u2014');
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/i18n test:unit -- campaigns-namespace`
Expected: FAIL, soubory neexistují.

- [ ] **Step 3: Napsat anglický katalog**

```json
// packages/i18n/messages/en/campaigns.json
{
  "list": {
    "title": "Campaigns",
    "empty": "No campaigns yet",
    "emptyAction": "Create campaign",
    "loadError": "We couldn't load your campaigns.",
    "retry": "Try again"
  },
  "status": {
    "draft": "Draft", "scheduled": "Scheduled", "queueing": "Preparing", "sending": "Sending",
    "paused": "Paused", "sent": "Sent", "partiallySent": "Partially sent",
    "cancelled": "Cancelled", "failed": "Failed", "scheduleMissed": "Schedule missed"
  },
  "audience": {
    "recipientCount": "{count, plural, =0 {No recipients} one {# recipient} other {# recipients}}",
    "excludedTitle": "Excluded",
    "excludedSuppressed": "{count} blocked",
    "excludedUnsubscribed": "{count} unsubscribed",
    "excludedUnconfirmed": "{count} unconfirmed",
    "excludedSnoozed": "{count} paused",
    "excludedProcessingRestricted": "{count} with restricted processing",
    "excludedSample": "{count} sample contacts",
    "breakdown": "Breakdown",
    "onlySample": "The audience contains only sample contacts. They will not receive anything.",
    "hasSample": "The audience contains sample contacts. They will be skipped."
  },
  "send": {
    "button": "Send {count, plural, one {# email} other {# emails}}",
    "confirmTitle": "Send campaign {name}?",
    "confirmWarnings": "Things we'd like to flag",
    "confirmUndo": "You will have {seconds} seconds to cancel. After that the emails can't be taken back.",
    "back": "Back to editing",
    "checklistTitle": "Ready to send"
  },
  "preflight": {
    "campaignAudienceEmpty": "The audience is empty. Pick at least one list or segment.",
    "campaignSubjectMissing": "The subject line is empty.",
    "campaignNotCompiled": "The template has not been compiled yet.",
    "campaignNoUnsubscribe": "The template has no unsubscribe link. The campaign can't be sent without it.",
    "campaignUnknownMergeField": "The template uses fields that don't exist: {fields}.",
    "campaignAudienceTooLarge": "The audience has more than {max} recipients. Split the campaign.",
    "providerQuotaExceeded": "You're sending {count} messages but only {remaining} remain in today's Amazon quota. Split the campaign or wait until {reset_at}.",
    "providerSandbox": "Your Amazon account is in sandbox mode. You can send at most 200 messages per day, only to verified addresses.",
    "providerNotReady": "The sending account is not ready.",
    "providerSendingPaused": "Amazon has paused sending on this account.",
    "domainDkimMissing": "Domain {domain} has no verified DKIM signature. Without it your emails will land in spam.",
    "domainSpfMissing": "The SPF record is missing or does not authorize Amazon.",
    "domainDmarcMissing": "The domain has no DMARC record. Gmail and Yahoo require it from bulk senders.",
    "deliverabilityComplaintBlocking": "Sending is blocked because of spam complaints. Your rate is {rate}.",
    "deliverabilityDegraded": "Your complaint rate is {rate}, which is close to the limit.",
    "deliverabilityBounceWarning": "Your bounce rate is {rate} over the last 30 days.",
    "campaignTrialMode": "Trial mode is on. Of {audience} selected recipients only {verified} verified addresses will receive the email.",
    "contractMismatch": "The links stored with this campaign don't match the compiled template. Click tracking would not work, so we stopped the send."
  },
  "pauseReason": {
    "renderFailureRate": "The template is failing to render for a large share of recipients. We stopped the campaign until it's fixed.",
    "credentialsUndecryptable": "We couldn't decrypt the sending account credentials. A key rotation is probably in progress.",
    "providerQuotaExhausted": "You've used up today's Amazon quota. The campaign will resume automatically once the quota resets.",
    "providerUnavailable": "The sending service is not responding. The campaign is on hold while we retry.",
    "user": "You paused this campaign.",
    "bounceGuard": "We paused the campaign ourselves. The bounce rate is {rate}, which puts your sending account at risk.",
    "complaintGuard": "We paused the campaign ourselves. The complaint rate is {rate}, which puts your sending account at risk.",
    "providerBlocked": "Amazon has blocked sending on this account.",
    "materializeTimeout": "Preparing the audience took too long. Resume to continue where we left off."
  },
  "progress": {
    "sentLabel": "Sent",
    "sentHint": "Handed over to the mail server. This does not mean it reached the inbox.",
    "deliveredLabel": "Delivered",
    "deliveredHint": "The recipient's server accepted the message. Confirmations arrive with a delay, so this number will still grow.",
    "bouncedLabel": "Not delivered",
    "bouncedHint": "The recipient's server rejected the message. We have removed these addresses.",
    "ambiguousLabel": "Uncertain",
    "ambiguousHint": "We are not sure whether these messages were handed over. You can resend them.",
    "pausing": "Pausing...",
    "paused": "Paused",
    "stopped": "Stopped. {sent} of {total} sent, those can't be recalled.",
    "undoCountdown": "Sending in {seconds} s",
    "undo": "Undo",
    "pause": "Pause",
    "cancel": "Cancel the rest",
    "stalled": "Sending is stalled. Check that the sending process is running.",
    "loadError": "We couldn't load the progress, we keep trying."
  },
  "dns": {
    "recordCount": "{count, plural, one {Add # record} other {Add # records}}",
    "title": "DNS records for {domain}",
    "waiting": "We don't see it yet. Changes usually show up within 15 minutes.",
    "done": "Done.",
    "wrongValue": "The record exists but has a different value.",
    "nameDuplicated": "It looks like the name was entered together with the domain. We found {found}. Change the name to {expected}.",
    "cloudflareProxy": "The record is proxied through Cloudflare (orange cloud). DKIM needs it turned off, switch it to DNS only.",
    "unknown": "We couldn't reach the DNS server. We'll try again in a minute.",
    "spfMultiple": "You have two SPF records. Mail servers ignore both in that case. Merge them into one.",
    "propagation": "DNS changes usually show up within 15 minutes, rarely it takes up to 24 hours. You can close this page, we keep checking and will let you know.",
    "checkNow": "Check now",
    "copy": "Copy",
    "downloadCsv": "Download as CSV",
    "guideVerifiedAt": "Guide verified on {date}",
    "guideStale": "We haven't verified this guide for a while, the provider's panel may look different. Follow the record values, not the button names.",
    "guideWrong": "This guide is wrong"
  },
  "trial": {
    "banner": "Trial mode: of {audience} selected recipients the email will only go to {verified} verified addresses.",
    "disable": "The domain is verified. Turn off trial mode"
  },
  "deliverability": {
    "title": "Deliverability",
    "empty": "Once you send your first campaign you'll see how your emails are delivered here.",
    "estimateNote": "Our number is an estimate. The binding value is the one in the Amazon console.",
    "unmatchedEvents": "Unmatched events",
    "accountStatus": "Account status",
    "dailyQuota": "Daily limit",
    "sendRate": "Rate"
  },
  "smtpWarning": "A plain SMTP server can't report undelivered mail and complaints to us. You have to maintain the blocked address list yourself."
}
```

- [ ] **Step 4: Napsat český katalog se stejnou množinou klíčů**

```json
// packages/i18n/messages/cs/campaigns.json
{
  "list": {
    "title": "Kampaně",
    "empty": "Zatím žádné kampaně",
    "emptyAction": "Vytvořit kampaň",
    "loadError": "Kampaně se nepodařilo načíst.",
    "retry": "Zkusit znovu"
  },
  "status": {
    "draft": "Rozepsaná", "scheduled": "Naplánovaná", "queueing": "Připravuje se", "sending": "Odesílá se",
    "paused": "Pozastavená", "sent": "Odeslaná", "partiallySent": "Odeslaná částečně",
    "cancelled": "Zrušená", "failed": "Nepodařilo se", "scheduleMissed": "Plán propásnut"
  },
  "audience": {
    "recipientCount": "{count, plural, =0 {Žádní příjemci} one {# příjemce} few {# příjemci} many {# příjemce} other {# příjemců}}",
    "excludedTitle": "Vyloučeno",
    "excludedSuppressed": "{count} blokovaných",
    "excludedUnsubscribed": "{count} odhlášených",
    "excludedUnconfirmed": "{count} nepotvrzených",
    "excludedSnoozed": "{count} pozastavených",
    "excludedProcessingRestricted": "{count} s omezeným zpracováním",
    "excludedSample": "{count} ukázkových kontaktů",
    "breakdown": "Rozpad",
    "onlySample": "Publikum obsahuje jen ukázkové kontakty. Těm se nic neodešle.",
    "hasSample": "Publikum obsahuje ukázkové kontakty. Ty se přeskočí."
  },
  "send": {
    "button": "Odeslat {count, plural, one {# e-mail} few {# e-maily} many {# e-mailu} other {# e-mailů}}",
    "confirmTitle": "Odeslat kampaň {name}?",
    "confirmWarnings": "Na co bychom rádi upozornili",
    "confirmUndo": "Po odeslání budete mít {seconds} sekund na zrušení. Potom už e-maily zpátky vzít nejde.",
    "back": "Zpět k úpravám",
    "checklistTitle": "Připravenost k odeslání"
  },
  "preflight": {
    "campaignAudienceEmpty": "Publikum je prázdné. Vyberte alespoň jeden seznam nebo segment.",
    "campaignSubjectMissing": "Předmět je prázdný.",
    "campaignNotCompiled": "Šablona ještě není zkompilovaná.",
    "campaignNoUnsubscribe": "V šabloně chybí odkaz na odhlášení. Bez něj kampaň odeslat nelze.",
    "campaignUnknownMergeField": "Šablona používá pole, která neexistují: {fields}.",
    "campaignAudienceTooLarge": "Publikum má víc než {max} příjemců. Rozdělte kampaň.",
    "providerQuotaExceeded": "Chcete odeslat {count} zpráv, ale u Amazonu vám dnes zbývá {remaining}. Rozdělte kampaň nebo počkejte do {reset_at}.",
    "providerSandbox": "Účet je v testovacím režimu Amazonu. Můžete odeslat nejvýš 200 zpráv denně a jen na ověřené adresy.",
    "providerNotReady": "Odesílací účet není připravený.",
    "providerSendingPaused": "Amazon na tomhle účtu zastavil odesílání.",
    "domainDkimMissing": "Doména {domain} nemá ověřený DKIM podpis. Bez něj skončí vaše maily ve spamu.",
    "domainSpfMissing": "Chybí SPF záznam, nebo neopravňuje Amazon posílat za vaši doménu.",
    "domainDmarcMissing": "Doména nemá DMARC záznam. Gmail a Yahoo ho u hromadných odesílatelů vyžadují.",
    "deliverabilityComplaintBlocking": "Odesílání je zastavené kvůli stížnostem na spam. Vaše míra je {rate}.",
    "deliverabilityDegraded": "Míra stížností je {rate}, což se blíží hranici.",
    "deliverabilityBounceWarning": "Míra nedoručení je za posledních 30 dní {rate}.",
    "campaignTrialMode": "Je zapnutý zkušební režim. Z vybraných {audience} příjemců se e-mail odešle jen {verified} ověřeným adresám.",
    "contractMismatch": "Odkazy uložené u kampaně nesedí na zkompilovanou šablonu. Měření prokliků by nefungovalo, proto jsme odeslání zastavili."
  },
  "pauseReason": {
    "renderFailureRate": "Šablona selhává při renderu u velké části příjemců. Kampaň jsme zastavili, než se to opraví.",
    "credentialsUndecryptable": "Nepodařilo se rozšifrovat přístupové údaje odesílacího účtu. Nejspíš probíhá rotace klíče.",
    "providerQuotaExhausted": "Vyčerpali jste denní limit Amazonu. Kampaň bude automaticky pokračovat, jakmile se limit uvolní.",
    "providerUnavailable": "Odesílací služba neodpovídá. Zkusíme to znovu, kampaň zatím stojí.",
    "user": "Kampaň jste pozastavili vy.",
    "bounceGuard": "Kampaň jsme sami pozastavili. Nedoručitelnost je {rate}, což ohrožuje váš odesílací účet.",
    "complaintGuard": "Kampaň jsme sami pozastavili. Míra stížností je {rate}, což ohrožuje váš odesílací účet.",
    "providerBlocked": "Amazon na tomhle účtu zablokoval odesílání.",
    "materializeTimeout": "Příprava publika trvala příliš dlouho. Pokračováním navážeme tam, kde jsme skončili."
  },
  "progress": {
    "sentLabel": "Odesláno",
    "sentHint": "Předáno poštovnímu serveru. Neznamená to, že zpráva dorazila do schránky.",
    "deliveredLabel": "Doručeno",
    "deliveredHint": "Server příjemce zprávu přijal. Potvrzení chodí se zpožděním, číslo ještě poroste.",
    "bouncedLabel": "Nedoručeno",
    "bouncedHint": "Server příjemce zprávu odmítl. Tyhle adresy jsme vyřadili.",
    "ambiguousLabel": "Nejisté odeslání",
    "ambiguousHint": "U těchhle zpráv nevíme, jestli se předaly. Můžete je doposlat.",
    "pausing": "Pozastavuje se…",
    "paused": "Pozastaveno",
    "stopped": "Zastaveno. Odesláno {sent} z {total}, ty už zpátky nevezmeme.",
    "undoCountdown": "Odesíláme za {seconds} s",
    "undo": "Vzít zpět",
    "pause": "Pozastavit",
    "cancel": "Zrušit zbytek rozesílky",
    "stalled": "Odesílání stojí. Zkontrolujte, jestli běží odesílací proces.",
    "loadError": "Průběh se nepodařilo načíst, zkoušíme dál."
  },
  "dns": {
    "recordCount": "{count, plural, one {Přidejte # záznam} few {Přidejte # záznamy} many {Přidejte # záznamu} other {Přidejte # záznamů}}",
    "title": "DNS záznamy pro {domain}",
    "waiting": "Zatím ho nevidíme. Změny se obvykle projeví do 15 minut.",
    "done": "Hotovo.",
    "wrongValue": "Záznam existuje, ale má jinou hodnotu.",
    "nameDuplicated": "Vypadá to, že se název zadal i s doménou. Našli jsme {found}. Opravte název na {expected}.",
    "cloudflareProxy": "Záznam je u Cloudflare zapnutý přes proxy (oranžový mráček). Pro DKIM musí být vypnutý, přepněte ho na DNS only.",
    "unknown": "Nepodařilo se zeptat DNS serveru. Zkusíme to za minutu znovu.",
    "spfMultiple": "Našli jsme dva SPF záznamy. Poštovní servery v takovém případě obě ignorují. Sloučte je do jednoho.",
    "propagation": "Změny v DNS se obvykle projeví do 15 minut, výjimečně až za 24 hodin. Stránku můžete zavřít, kontrolujeme dál a dáme vědět.",
    "checkNow": "Zkontrolovat teď",
    "copy": "Kopírovat",
    "downloadCsv": "Stáhnout jako CSV",
    "guideVerifiedAt": "Návod ověřen {date}",
    "guideStale": "Tenhle návod jsme dlouho neověřovali, panel poskytovatele mohl vypadat jinak. Držte se hodnot záznamu, ne názvů tlačítek.",
    "guideWrong": "Návod nesedí"
  },
  "trial": {
    "banner": "Zkušební režim: z vybraných {audience} příjemců se e-mail odešle jen {verified} ověřeným adresám.",
    "disable": "Doména je ověřená. Vypnout zkušební režim"
  },
  "deliverability": {
    "title": "Doručitelnost",
    "empty": "Až odešlete první kampaň, uvidíte tu, jak se vaše maily doručují.",
    "estimateNote": "Naše číslo je odhad. Závazná je hodnota v konzoli Amazonu.",
    "unmatchedEvents": "Nespárované události",
    "accountStatus": "Stav účtu",
    "dailyQuota": "Denní limit",
    "sendRate": "Rychlost"
  },
  "smtpWarning": "Obyčejný SMTP server nám neumí hlásit nedoručené maily a stížnosti. Seznam zakázaných adres proto musíte udržovat ručně."
}
```

- [ ] **Step 5: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/i18n test:unit -- campaigns-namespace && node tools/ci/i18n-check.mjs`
Expected: PASS, 7 testů, `i18n-check` bez nálezu.

- [ ] **Step 6: Commit**

```bash
git add packages/i18n/messages/cs/campaigns.json packages/i18n/messages/en/campaigns.json packages/i18n/__tests__/campaigns-namespace.test.ts
git commit -m "feat(i18n): campaigns namespace in Czech and English with ICU plurals"
```

---

#### Úkol 58: Seznam kampaní

**Files:**
- Create: `apps/web/src/app/[locale]/w/[slug]/campaigns/page.tsx`
- Create: `apps/web/src/features/campaigns/campaign-list.tsx`
- Create: `apps/web/src/features/campaigns/status-badge.tsx`
- Test: `apps/web/src/features/campaigns/__tests__/campaign-list.test.tsx`

- [ ] **Step 1: Napsat padající test**

```tsx
// apps/web/src/features/campaigns/__tests__/campaign-list.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CampaignList } from '../campaign-list';
import { StatusBadge } from '../status-badge';
import { withIntl } from '../../../testing/intl-harness';

const rows = [
  { id: 'k1', name: 'Letní výprodej', status: 'sending', audience_size: 1129,
    counters: { total: 1129, sent: 428, failed: 0, skipped: 0, delivered: 421, bounced: 6, complained: 0, pending: 701 },
    updated_at: '2026-08-01T12:38:00.000Z' },
];

describe('seznam kampani', () => {
  it('prazdny stav vysvetluje a nabizi akci', () => {
    render(withIntl(<CampaignList rows={[]} state="empty" />));
    expect(screen.getByText('Zatím žádné kampaně')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vytvořit kampaň' })).toBeInTheDocument();
  });

  it('stav nacitani ukazuje kostru peti radku, ne spinner', () => {
    render(withIntl(<CampaignList rows={[]} state="loading" />));
    expect(screen.getAllByTestId('skeleton-row')).toHaveLength(5);
  });

  it('chybovy stav nabizi Zkusit znovu', () => {
    render(withIntl(<CampaignList rows={[]} state="error" />));
    expect(screen.getByText('Kampaně se nepodařilo načíst.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Zkusit znovu' })).toBeInTheDocument();
  });

  it('tabulka ukazuje nazev, stav, publikum, odeslano a datum', () => {
    render(withIntl(<CampaignList rows={rows} state="data" />));
    expect(screen.getByText('Letní výprodej')).toBeInTheDocument();
    expect(screen.getByText('Odesílá se')).toBeInTheDocument();
  });

  it.each([
    ['draft', 'Rozepsaná'], ['sending', 'Odesílá se'], ['partially_sent', 'Odeslaná částečně'],
    ['schedule_missed', 'Plán propásnut'],
  ])('stitek stavu %s je %s', (status, label) => {
    render(withIntl(<StatusBadge status={status} />));
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('neznamy stav se zobrazi neutralne, komponenta nespadne', () => {
    render(withIntl(<StatusBadge status="ab_testing" />));
    expect(screen.getByText('ab_testing')).toBeInTheDocument();
  });

  it('animovany stitek ma aria-live, aby ho precetla ctecka', () => {
    render(withIntl(<StatusBadge status="sending" />));
    expect(screen.getByText('Odesílá se').closest('[aria-live]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/web test:unit -- campaign-list`
Expected: FAIL, komponenty neexistují.

- [ ] **Step 3: Napsat štítek stavu**

```tsx
// apps/web/src/features/campaigns/status-badge.tsx
'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@mlain/ui';

const TONE: Record<string, 'grey' | 'blue' | 'orange' | 'green' | 'yellow' | 'red'> = {
  draft: 'grey', scheduled: 'blue', queueing: 'blue', sending: 'blue', paused: 'orange',
  sent: 'green', partially_sent: 'yellow', cancelled: 'grey', failed: 'red', schedule_missed: 'red',
};

const KEY: Record<string, string> = {
  draft: 'draft', scheduled: 'scheduled', queueing: 'queueing', sending: 'sending', paused: 'paused',
  sent: 'sent', partially_sent: 'partiallySent', cancelled: 'cancelled', failed: 'failed',
  schedule_missed: 'scheduleMissed',
};

/**
 * Vycet stavu je OTEVRENY: nova hodnota smi prijit v ramci v1 a klient ji musi
 * tolerovat. Zadny switch bez vetve default, zadne zahozeni odpovedi kvuli nezname
 * hodnote. Neznamy stav se ukaze neutralne, syrovy.
 */
export function StatusBadge({ status }: { status: string }) {
  const t = useTranslations('campaigns.status');
  const key = KEY[status];
  const label = key ? t(key) : status;
  const animated = status === 'queueing' || status === 'sending';

  return (
    <span aria-live={animated ? 'polite' : undefined}>
      <Badge tone={TONE[status] ?? 'grey'} pulsing={animated}>{label}</Badge>
    </span>
  );
}
```

- [ ] **Step 4: Napsat seznam a stránku**

```tsx
// apps/web/src/features/campaigns/campaign-list.tsx
'use client';

import { useTranslations, useFormatter } from 'next-intl';
import { Button, DataTable, EmptyState, ErrorBlock, Skeleton } from '@mlain/ui';
import { StatusBadge } from './status-badge';

export type CampaignRow = {
  id: string; name: string; status: string; audience_size: number | null;
  counters: { total: number; sent: number; delivered: number; bounced: number };
  updated_at: string;
};

export function CampaignList({
  rows, state, onCreate, onRetry,
}: {
  rows: CampaignRow[];
  state: 'loading' | 'empty' | 'error' | 'data';
  onCreate?: () => void;
  onRetry?: () => void;
}) {
  const t = useTranslations('campaigns');
  const format = useFormatter();

  if (state === 'loading') {
    return (
      <div>
        {Array.from({ length: 5 }, (_, i) => <Skeleton key={i} data-testid="skeleton-row" height={48} />)}
      </div>
    );
  }
  if (state === 'error') {
    return <ErrorBlock message={t('list.loadError')} action={<Button onClick={onRetry}>{t('list.retry')}</Button>} />;
  }
  if (state === 'empty') {
    return (
      <EmptyState
        title={t('list.empty')}
        action={<Button variant="primary" onClick={onCreate}>{t('list.emptyAction')}</Button>}
      />
    );
  }

  return (
    <DataTable
      caption={t('list.title')}
      columns={[
        { key: 'name', header: 'Název', render: (r: CampaignRow) => r.name },
        { key: 'status', header: 'Stav', render: (r: CampaignRow) => <StatusBadge status={r.status} /> },
        {
          key: 'audience', header: 'Publikum',
          render: (r: CampaignRow) => t('audience.recipientCount', { count: r.audience_size ?? 0 }),
        },
        { key: 'sent', header: 'Odesláno', render: (r: CampaignRow) => format.number(r.counters.sent) },
        {
          key: 'updated', header: 'Změněno',
          render: (r: CampaignRow) => format.dateTime(new Date(r.updated_at), 'short'),
        },
      ]}
      rows={rows}
      rowKey={(r: CampaignRow) => r.id}
    />
  );
}
```

```tsx
// apps/web/src/app/[locale]/w/[slug]/campaigns/page.tsx
import { getTranslations } from 'next-intl/server';
import { CampaignList } from '../../../../../features/campaigns/campaign-list';
import { listCampaignsForUi } from '../../../../../server/services/campaigns';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'campaigns.list' });
  return { title: t('title') };
}

export default async function CampaignsPage({
  params, searchParams,
}: {
  params: Promise<{ slug: string; locale: string }>;
  searchParams: Promise<{ status?: string; cursor?: string }>;
}) {
  const { slug } = await params;
  const query = await searchParams;
  const page = await listCampaignsForUi(slug, query);
  return <CampaignList rows={page.data} state={page.data.length ? 'data' : 'empty'} />;
}
```

- [ ] **Step 5: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/web test:unit -- campaign-list`
Expected: PASS, 10 testů.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/campaigns apps/web/src/app/\[locale\]/w/\[slug\]/campaigns
git commit -m "feat(web): campaign list with four screen states and open status enum"
```

---

#### Úkol 59: Kontrolní seznam připravenosti a potvrzovací dialog

**Files:**
- Create: `apps/web/src/features/campaigns/readiness-checklist.tsx`
- Create: `apps/web/src/features/campaigns/send-dialog.tsx`
- Create: `apps/web/src/app/[locale]/w/[slug]/campaigns/[id]/send/page.tsx`
- Test: `apps/web/src/features/campaigns/__tests__/send-screen.test.tsx`

- [ ] **Step 1: Napsat padající test**

```tsx
// apps/web/src/features/campaigns/__tests__/send-screen.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ReadinessChecklist } from '../readiness-checklist';
import { SendDialog } from '../send-dialog';
import { withIntl } from '../../../testing/intl-harness';

const preflight = {
  can_send: true, audience_estimate: 1129, quota_remaining: 48_000, checked_at: '2026-08-01T12:00:00.000Z',
  findings: [{ code: 'campaign_trial_mode', severity: 'warning' as const, params: { verified: 2, audience: 1129 } }],
};

const breakdown = {
  excluded_suppressed: 12, excluded_unsubscribed: 43, excluded_unconfirmed: 17,
  excluded_snoozed: 4, excluded_processing_restricted: 3, excluded_invalid_email: 0,
  excluded_deleted: 0, excluded_sample: 0, duplicates_removed: 0,
};

describe('kontrolni seznam pripravenosti', () => {
  it('soucet vyloucenych plus vysledny pocet se rovna vstupnimu poctu', () => {
    render(withIntl(<ReadinessChecklist preflight={preflight} breakdown={breakdown} rawCount={1208} />));
    expect(screen.getByTestId('audience-sum-check')).toHaveTextContent('1208');
  });

  it('radek Vylouceno je pojmenovany po branach, ne souhrnny', () => {
    render(withIntl(<ReadinessChecklist preflight={preflight} breakdown={breakdown} rawCount={1208} />));
    expect(screen.getByText(/12 blokovaných/)).toBeInTheDocument();
    expect(screen.getByText(/3 s omezeným zpracováním/)).toBeInTheDocument();
  });

  it('nulove brany se v seznamu nezobrazuji, v rozpadu ano', () => {
    render(withIntl(<ReadinessChecklist preflight={preflight} breakdown={breakdown} rawCount={1208} />));
    expect(screen.queryByText(/0 ukázkových kontaktů/)).not.toBeInTheDocument();
    expect(screen.getByTestId('breakdown-panel')).toHaveTextContent('ukázkových kontaktů');
  });

  it('cislo na tlacitku pochazi ze stejneho volani jako radek Publikum', () => {
    render(withIntl(<ReadinessChecklist preflight={preflight} breakdown={breakdown} rawCount={1208} />));
    expect(screen.getByRole('button', { name: /Odeslat 1 129 e-mailů/ })).toBeInTheDocument();
  });

  it('tlacitko zustava aktivni i pri blokujici polozce a presune fokus na prvni z nich', async () => {
    const blocked = { ...preflight, can_send: false,
      findings: [{ code: 'campaign_no_unsubscribe', severity: 'error' as const }] };
    render(withIntl(<ReadinessChecklist preflight={blocked} breakdown={breakdown} rawCount={1208} />));
    const button = screen.getByRole('button', { name: /Odeslat/ });
    expect(button).toBeEnabled();
    await userEvent.click(button);
    expect(screen.getByTestId('finding-campaign_no_unsubscribe')).toHaveFocus();
  });
});

describe('potvrzovaci dialog', () => {
  const props = {
    open: true, campaignName: 'Letní výprodej', recipientCount: 1129,
    fromLine: 'Jana z Kolo Shopu <jana@kolo-shop.cz>', subject: 'Letní výprodej začíná',
    undoSeconds: 60, warnings: preflight.findings, onConfirm: vi.fn(), onCancel: vi.fn(),
  };

  it('fokus po otevreni je na Zpet k upravam, ne na Odeslat', () => {
    render(withIntl(<SendDialog {...props} />));
    expect(screen.getByRole('button', { name: 'Zpět k úpravám' })).toHaveFocus();
  });

  it('veta o nevratnosti je doslova, ne jen cervene tlacitko', () => {
    render(withIntl(<SendDialog {...props} />));
    expect(screen.getByText(/Potom už e-maily zpátky vzít nejde/)).toBeInTheDocument();
  });

  it('varovani z kontrolniho seznamu jsou i v dialogu', () => {
    render(withIntl(<SendDialog {...props} />));
    expect(screen.getByText('Na co bychom rádi upozornili')).toBeInTheDocument();
  });

  it('Enter bez cteni nic neodesle', async () => {
    render(withIntl(<SendDialog {...props} />));
    await userEvent.keyboard('{Enter}');
    expect(props.onConfirm).not.toHaveBeenCalled();
  });

  it('dialog ma roli dialog a popisek, aby ho zvladla ctecka', () => {
    render(withIntl(<SendDialog {...props} />));
    expect(screen.getByRole('dialog')).toHaveAccessibleName(/Odeslat kampaň/);
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/web test:unit -- send-screen`
Expected: FAIL, komponenty neexistují.

- [ ] **Step 3: Napsat kontrolní seznam**

```tsx
// apps/web/src/features/campaigns/readiness-checklist.tsx
'use client';

import { useRef } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import { Alert, Button, Disclosure } from '@mlain/ui';

export type Finding = { code: string; severity: 'error' | 'warning'; params?: Record<string, string | number> };

export type Breakdown = {
  excluded_suppressed: number; excluded_unsubscribed: number; excluded_unconfirmed: number;
  excluded_snoozed: number; excluded_processing_restricted: number; excluded_invalid_email: number;
  excluded_deleted: number; excluded_sample: number; duplicates_removed: number;
};

const GATE_KEYS: Array<[keyof Breakdown, string]> = [
  ['excluded_suppressed', 'excludedSuppressed'],
  ['excluded_unsubscribed', 'excludedUnsubscribed'],
  ['excluded_unconfirmed', 'excludedUnconfirmed'],
  ['excluded_snoozed', 'excludedSnoozed'],
  ['excluded_processing_restricted', 'excludedProcessingRestricted'],
  ['excluded_sample', 'excludedSample'],
];

/**
 * Cislo v radku Publikum, cislo na tlacitku, cislo v potvrzovacim dialogu a cislo
 * v rozpadu segmentu pochazeji z JEDNOHO volani. Kontrolni seznam nesmi spocitat
 * publikum sam: drive se dve obrazovky nad tymz segmentem rozchazely o 24 lidi
 * a rozdil byl prave na tlacitku, ktere spousti nevratnou akci.
 */
export function ReadinessChecklist({
  preflight, breakdown, rawCount, onSend,
}: {
  preflight: { can_send: boolean; audience_estimate: number; findings: Finding[] };
  breakdown: Breakdown;
  rawCount: number;
  onSend?: () => void;
}) {
  const t = useTranslations('campaigns');
  const format = useFormatter();
  const findingRefs = useRef<Record<string, HTMLLIElement | null>>({});

  const errors = preflight.findings.filter((f) => f.severity === 'error');
  const warnings = preflight.findings.filter((f) => f.severity === 'warning');
  const excludedTotal = Object.values(breakdown).reduce((a, b) => a + b, 0);

  function handleSend() {
    // Tlacitko zustava aktivni i pri blokujici polozce. Kliknuti presune fokus
    // na prvni blokujici polozku a ohlasi ji ctecce; zasedle tlacitko bez duvodu
    // je horsi nez tlacitko, ktere rekne, co chybi.
    if (!preflight.can_send && errors[0]) {
      findingRefs.current[errors[0].code]?.focus();
      return;
    }
    onSend?.();
  }

  return (
    <section aria-labelledby="readiness-title">
      <h2 id="readiness-title">{t('send.checklistTitle')}</h2>

      <p data-testid="audience-sum-check">
        {t('audience.recipientCount', { count: preflight.audience_estimate })}
        {' '}({format.number(excludedTotal + preflight.audience_estimate)} = {format.number(rawCount)})
      </p>

      <ul>
        {errors.map((f) => (
          <li key={f.code} tabIndex={-1} data-testid={`finding-${f.code}`}
              ref={(el) => { findingRefs.current[f.code] = el; }}>
            <Alert tone="error">{t(`preflight.${toCamel(f.code)}`, f.params ?? {})}</Alert>
          </li>
        ))}
        {warnings.map((f) => (
          <li key={f.code} data-testid={`finding-${f.code}`}>
            <Alert tone="warning">{t(`preflight.${toCamel(f.code)}`, f.params ?? {})}</Alert>
          </li>
        ))}
      </ul>

      <h3>{t('audience.excludedTitle')}</h3>
      <ul>
        {/* Nulove brany se v seznamu nezobrazuji, zaplevelily by ho. */}
        {GATE_KEYS.filter(([key]) => breakdown[key] > 0).map(([key, msg]) => (
          <li key={key}>{t(`audience.${msg}`, { count: breakdown[key] })}</li>
        ))}
      </ul>

      {/* V rozpadu za odkazem jsou VSECHNY brany, i nulove, aby bylo videt,
          ze se kontrolovaly. */}
      <Disclosure label={t('audience.breakdown')}>
        <ul data-testid="breakdown-panel">
          {GATE_KEYS.map(([key, msg]) => (
            <li key={key}>{t(`audience.${msg}`, { count: breakdown[key] })}</li>
          ))}
        </ul>
      </Disclosure>

      <Button variant="primary" onClick={handleSend}>
        {t('send.button', { count: preflight.audience_estimate })}
      </Button>
    </section>
  );
}

function toCamel(code: string): string {
  return code.replace(/_([a-z])/g, (_, ch: string) => ch.toUpperCase());
}
```

- [ ] **Step 4: Napsat potvrzovací dialog**

```tsx
// apps/web/src/features/campaigns/send-dialog.tsx
'use client';

import { useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Button, Dialog } from '@mlain/ui';
import type { Finding } from './readiness-checklist';

/**
 * Souhrn misto checkboxu: uzivatel ma precist pet radku, ktere mu ukazou skutecny stav.
 * Checkbox "rozumim" neoveruje nic. Fokus po otevreni je na bezpecnejsi volbe, takze
 * Enter bez cteni nic neodesle. Zadne opisovani nazvu: tydenni akce by z ochrany
 * udelala navyk a navyk ochranu rusi.
 */
export function SendDialog({
  open, campaignName, recipientCount, fromLine, subject, undoSeconds, warnings, onConfirm, onCancel,
}: {
  open: boolean; campaignName: string; recipientCount: number;
  fromLine: string; subject: string; undoSeconds: number;
  warnings: Finding[]; onConfirm: () => void; onCancel: () => void;
}) {
  const t = useTranslations('campaigns');
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (open) cancelRef.current?.focus(); }, [open]);

  return (
    <Dialog open={open} onClose={onCancel} title={t('send.confirmTitle', { name: campaignName })}>
      <dl>
        <dt>Komu</dt><dd>{t('audience.recipientCount', { count: recipientCount })}</dd>
        <dt>Od</dt><dd>{fromLine}</dd>
        <dt>Předmět</dt><dd>{subject}</dd>
      </dl>

      {warnings.length > 0 && (
        <section>
          <h3>{t('send.confirmWarnings')}</h3>
          <ul>
            {warnings.map((w) => (
              <li key={w.code}>{t(`preflight.${w.code.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())}`, w.params ?? {})}</li>
            ))}
          </ul>
        </section>
      )}

      <p>{t('send.confirmUndo', { seconds: undoSeconds })}</p>

      <Button ref={cancelRef} onClick={onCancel}>{t('send.back')}</Button>
      <Button variant="primary" onClick={onConfirm}>{t('send.button', { count: recipientCount })}</Button>
    </Dialog>
  );
}
```

```tsx
// apps/web/src/app/[locale]/w/[slug]/campaigns/[id]/send/page.tsx
import { ReadinessChecklist } from '../../../../../../../features/campaigns/readiness-checklist';
import { loadSendScreen } from '../../../../../../../server/services/campaigns';

export default async function SendPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const data = await loadSendScreen(slug, id);
  return (
    <ReadinessChecklist
      preflight={data.preflight}
      breakdown={data.breakdown}
      rawCount={data.rawCount}
    />
  );
}
```

- [ ] **Step 5: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/web test:unit -- send-screen`
Expected: PASS, 10 testů.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/campaigns/readiness-checklist.tsx apps/web/src/features/campaigns/send-dialog.tsx apps/web/src/app/\[locale\]/w/\[slug\]/campaigns/\[id\]/send
git commit -m "feat(web): readiness checklist with named exclusion gates and send dialog"
```

---

#### Úkol 60: Obrazovka průběhu a okno na zrušení

**Files:**
- Create: `apps/web/src/features/campaigns/undo-countdown.tsx`
- Create: `apps/web/src/features/campaigns/progress-screen.tsx`
- Create: `apps/web/src/app/[locale]/w/[slug]/campaigns/[id]/progress/page.tsx`
- Test: `apps/web/src/features/campaigns/__tests__/progress.test.tsx`

- [ ] **Step 1: Napsat padající test**

```tsx
// apps/web/src/features/campaigns/__tests__/progress.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { UndoCountdown } from '../undo-countdown';
import { ProgressScreen } from '../progress-screen';
import { withIntl } from '../../../testing/intl-harness';

const progress = {
  campaign_id: 'k1', status: 'sending',
  counters: { total: 1129, sent: 428, failed: 1, skipped: 0, delivered: 421, bounced: 6, complained: 0, pending: 700 },
  rate_per_second: 14, eta_seconds: 50, quota_remaining: 40_000, updated_at: '2026-08-01T12:40:00.000Z',
};

describe('okno na zruseni', () => {
  it('ukazuje odpocet a velke tlacitko Vzit zpet', () => {
    render(withIntl(<UndoCountdown remainingSeconds={47} onUndo={vi.fn()} />));
    expect(screen.getByText('Odesíláme za 47 s')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Vzít zpět' })).toBeInTheDocument();
  });

  it('po vyprseni se tlacitko zmeni na Pozastavit', () => {
    render(withIntl(<UndoCountdown remainingSeconds={0} onUndo={vi.fn()} onPause={vi.fn()} />));
    expect(screen.getByRole('button', { name: 'Pozastavit' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Vzít zpět' })).not.toBeInTheDocument();
  });
});

describe('obrazovka prubehu', () => {
  it('u Odeslano i Doruceno je vysvetleni, proc se cisla nerovnaji', () => {
    render(withIntl(<ProgressScreen progress={progress} />));
    expect(screen.getByText(/Předáno poštovnímu serveru/)).toBeInTheDocument();
    expect(screen.getByText(/Potvrzení chodí se zpožděním/)).toBeInTheDocument();
  });

  it('nejiste odeslani je samostatna kategorie, ne mezi selhanimi', () => {
    render(withIntl(<ProgressScreen progress={progress} ambiguousCount={3} />));
    expect(screen.getByText('Nejisté odeslání')).toBeInTheDocument();
  });

  it('pri paused ukazuje oranzovy box s duvodem podle kodu', () => {
    render(withIntl(<ProgressScreen progress={{ ...progress, status: 'paused' }}
      pauseReason={{ code: 'credentials_undecryptable', source: 'sender', at: '2026-08-01T12:00:00.000Z' }} />));
    expect(screen.getByText(/Nepodařilo se rozšifrovat přístupové údaje/)).toBeInTheDocument();
  });

  it.each([
    'render_failure_rate', 'credentials_undecryptable', 'provider_quota_exhausted', 'provider_unavailable',
    'user', 'bounce_guard', 'complaint_guard', 'provider_blocked', 'materialize_timeout',
  ])('katalog pokryva kod %s, takze pauza neni nikdy bez duvodu', (code) => {
    render(withIntl(<ProgressScreen progress={{ ...progress, status: 'paused' }}
      pauseReason={{ code, source: 'app', at: '2026-08-01T12:00:00.000Z', ...(code.includes('guard') ? {} : {}) }} />));
    expect(screen.getByTestId('pause-box').textContent?.length).toBeGreaterThan(10);
  });

  it('u provider_quota_exhausted rekne, ze kampan pokracuje sama', () => {
    render(withIntl(<ProgressScreen progress={{ ...progress, status: 'paused' }}
      pauseReason={{ code: 'provider_quota_exhausted', source: 'sender', at: '2026-08-01T12:00:00.000Z' }} />));
    expect(screen.getByText(/bude automaticky pokračovat/)).toBeInTheDocument();
  });

  it('zastaveni rika rovnou, ze odeslane maily zpatky nejdou', () => {
    render(withIntl(<ProgressScreen progress={{ ...progress, status: 'paused' }}
      pauseReason={{ code: 'user', source: 'user', at: '2026-08-01T12:00:00.000Z' }} />));
    expect(screen.getByText(/ty už zpátky nevezmeme/)).toBeInTheDocument();
  });

  it('pri zasekle rozesilce hlasi, ze odesilani stoji', () => {
    render(withIntl(<ProgressScreen progress={progress} stalled />));
    expect(screen.getByText(/Odesílání stojí/)).toBeInTheDocument();
  });

  it('pruh prubehu ma roli progressbar s aria hodnotami', () => {
    render(withIntl(<ProgressScreen progress={progress} />));
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '428');
    expect(bar).toHaveAttribute('aria-valuemax', '1129');
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/web test:unit -- progress`
Expected: FAIL, komponenty neexistují.

- [ ] **Step 3: Napsat odpočet**

```tsx
// apps/web/src/features/campaigns/undo-countdown.tsx
'use client';

import { useTranslations } from 'next-intl';
import { Button } from '@mlain/ui';

/**
 * Odlozeny start je jediny stav, kde je zaruceno, ze neodesel ani jeden mail.
 * Po vyprseni okna se tlacitko meni na Pozastavit a plati, ze zpravy ve stavu
 * claimed dobehnou.
 */
export function UndoCountdown({
  remainingSeconds, onUndo, onPause,
}: { remainingSeconds: number; onUndo: () => void; onPause?: () => void }) {
  const t = useTranslations('campaigns.progress');

  if (remainingSeconds <= 0) {
    return <Button onClick={onPause}>{t('pause')}</Button>;
  }
  return (
    <div role="status" aria-live="polite">
      <p>{t('undoCountdown', { seconds: remainingSeconds })}</p>
      <Button variant="primary" size="large" onClick={onUndo}>{t('undo')}</Button>
    </div>
  );
}
```

- [ ] **Step 4: Napsat obrazovku průběhu**

```tsx
// apps/web/src/features/campaigns/progress-screen.tsx
'use client';

import { useTranslations, useFormatter } from 'next-intl';
import { Alert, Button, Progress, Tooltip } from '@mlain/ui';

export type CampaignProgress = {
  campaign_id: string; status: string;
  counters: { total: number; sent: number; failed: number; skipped: number; delivered: number; bounced: number; complained: number; pending: number };
  rate_per_second: number | null; eta_seconds: number | null;
  quota_remaining: number | null; updated_at: string;
};

const PAUSE_KEY: Record<string, string> = {
  render_failure_rate: 'renderFailureRate', credentials_undecryptable: 'credentialsUndecryptable',
  provider_quota_exhausted: 'providerQuotaExhausted', provider_unavailable: 'providerUnavailable',
  user: 'user', bounce_guard: 'bounceGuard', complaint_guard: 'complaintGuard',
  provider_blocked: 'providerBlocked', materialize_timeout: 'materializeTimeout',
};

export function ProgressScreen({
  progress, pauseReason, ambiguousCount = 0, stalled = false, onPause, onCancel, onResume,
}: {
  progress: CampaignProgress;
  pauseReason?: { code: string; source: string; at: string; detail?: string };
  ambiguousCount?: number;
  stalled?: boolean;
  onPause?: () => void; onCancel?: () => void; onResume?: () => void;
}) {
  const t = useTranslations('campaigns.progress');
  const tp = useTranslations('campaigns.pauseReason');
  const format = useFormatter();
  const c = progress.counters;

  return (
    <section>
      <Progress
        role="progressbar"
        aria-valuenow={c.sent}
        aria-valuemin={0}
        aria-valuemax={c.total}
        value={c.sent}
        max={c.total}
      />

      <dl>
        <div>
          <dt>{t('sentLabel')} <Tooltip text={t('sentHint')} /></dt>
          <dd>{format.number(c.sent)}</dd>
          <p>{t('sentHint')}</p>
        </div>
        <div>
          <dt>{t('deliveredLabel')} <Tooltip text={t('deliveredHint')} /></dt>
          <dd>{format.number(c.delivered)}</dd>
          <p>{t('deliveredHint')}</p>
        </div>
        <div>
          <dt>{t('bouncedLabel')}</dt>
          <dd>{format.number(c.bounced)}</dd>
          <p>{t('bouncedHint')}</p>
        </div>
        {ambiguousCount > 0 && (
          <div>
            {/* Nejiste odeslani je u SES bezny dusledek padu, ne anomalie.
                Zobrazuje se jako samostatna kategorie, ne mezi selhanimi. */}
            <dt>{t('ambiguousLabel')}</dt>
            <dd>{format.number(ambiguousCount)}</dd>
            <p>{t('ambiguousHint')}</p>
          </div>
        )}
      </dl>

      {stalled && <Alert tone="warning">{t('stalled')}</Alert>}

      {progress.status === 'paused' && pauseReason && (
        <Alert tone={pauseReason.code.endsWith('_guard') ? 'error' : 'warning'} data-testid="pause-box">
          {/* Katalog musi pokryvat VSECH DEVET kodu vcetne ctyr od senderu. Kdyby
              pokryval jen aplikacni, kampan zastavena senderem kvuli nedesifrovatelnym
              credentials by se zobrazila jako pauza bez duvodu. */}
          <p>{tp(PAUSE_KEY[pauseReason.code] ?? 'user')}</p>
          <p>{t('stopped', { sent: format.number(c.sent), total: format.number(c.total) })}</p>
          <Button onClick={onResume}>Pokračovat</Button>
        </Alert>
      )}

      {progress.status === 'sending' && (
        <>
          <Button onClick={onPause}>{t('pause')}</Button>
          <Button tone="danger" onClick={onCancel}>{t('cancel')}</Button>
        </>
      )}
    </section>
  );
}
```

```tsx
// apps/web/src/app/[locale]/w/[slug]/campaigns/[id]/progress/page.tsx
import { ProgressScreen } from '../../../../../../../features/campaigns/progress-screen';
import { loadProgressScreen } from '../../../../../../../server/services/campaigns';

export default async function ProgressPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const data = await loadProgressScreen(slug, id);
  return (
    <ProgressScreen
      progress={data.progress}
      pauseReason={data.pauseReason}
      ambiguousCount={data.ambiguousCount}
      stalled={data.stalled}
    />
  );
}
```

- [ ] **Step 5: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/web test:unit -- progress`
Expected: PASS, 19 testů (devět z `it.each`).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/features/campaigns/undo-countdown.tsx apps/web/src/features/campaigns/progress-screen.tsx apps/web/src/app/\[locale\]/w/\[slug\]/campaigns/\[id\]/progress
git commit -m "feat(web): progress screen covering all nine pause codes and undo countdown"
```

---

#### Úkol 61: Nastavení odesílání, DNS záznamy a dashboard doručitelnosti

**Files:**
- Create: `packages/core/data/dns-providers.json`
- Create: `packages/core/data/smtp-presets.json`
- Create: `apps/web/src/features/sending/dns-records.tsx`
- Create: `apps/web/src/features/sending/deliverability-tiles.tsx`
- Create: `apps/web/src/app/[locale]/w/[slug]/settings/sending/page.tsx`
- Create: `apps/web/src/app/[locale]/w/[slug]/settings/sending/domains/[id]/page.tsx`
- Create: `apps/web/src/app/[locale]/w/[slug]/deliverability/page.tsx`
- Create: `apps/web/src/app/[locale]/d/[token]/page.tsx`
- Test: `apps/web/src/features/sending/__tests__/sending.test.tsx`

- [ ] **Step 1: Napsat padající test**

```tsx
// apps/web/src/features/sending/__tests__/sending.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DnsRecords } from '../dns-records';
import { DeliverabilityTiles } from '../deliverability-tiles';
import { withIntl } from '../../../testing/intl-harness';
import providers from '@mlain/core/data/dns-providers.json';
import presets from '@mlain/core/data/smtp-presets.json';

const records = [
  { type: 'CNAME', name: 'x7k2m._domainkey.kolo-shop.cz', value: 'x7k2m.dkim.amazonses.com', ttl: 1800, purpose: 'dkim', required: true },
  { type: 'TXT', name: 'kolo-shop.cz', value: 'v=spf1 include:amazonses.com ~all', ttl: 1800, purpose: 'spf', required: true },
  { type: 'TXT', name: '_dmarc.kolo-shop.cz', value: 'v=DMARC1; p=none', ttl: 1800, purpose: 'dmarc', required: false },
];

const checks = {
  spf: { ok: false, record: null, findings: [{ code: 'spf_multiple_records', severity: 'error' as const }], checked_at: '2026-08-01T12:00:00.000Z' },
  dkim: { ok: false, found: 2, expected: 3, findings: [{ code: 'dkim_partial', severity: 'error' as const, params: { found: 2, expected: 3 } }], checked_at: '2026-08-01T12:00:00.000Z' },
  dmarc: { ok: null, record: null, policy: null, pct: null, findings: [], checked_at: '2026-08-01T12:00:00.000Z' },
  mx: { ok: null, records: [], findings: [], checked_at: '2026-08-01T12:00:00.000Z' },
};

describe('datove soubory poskytovatelu', () => {
  it('kazda polozka nese verifiedAt, aby uzivatel poznal, jak starou radu cte', () => {
    for (const p of providers as Array<{ verifiedAt: string }>) {
      expect(p.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
    for (const p of presets as Array<{ verifiedAt: string }>) {
      expect(p.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });

  it('existuje obecny navod pro nezname poskytovatele', () => {
    expect((providers as Array<{ id: string }>).some((p) => p.id === 'generic')).toBe(true);
  });

  it('datovy soubor NIKDY neobsahuje hodnoty zaznamu, jen navod', () => {
    const s = JSON.stringify(providers);
    expect(s).not.toContain('_domainkey');
    expect(s).not.toContain('v=spf1');
  });
});

describe('obrazovka se zaznamy', () => {
  it('kazda hodnota ma tlacitko kopirovat', () => {
    render(withIntl(<DnsRecords domain="kolo-shop.cz" records={records} checks={checks} />));
    expect(screen.getAllByRole('button', { name: 'Kopírovat' }).length).toBeGreaterThanOrEqual(records.length);
  });

  it('nabizi stazeni jako CSV', () => {
    render(withIntl(<DnsRecords domain="kolo-shop.cz" records={records} checks={checks} />));
    expect(screen.getByRole('button', { name: 'Stáhnout jako CSV' })).toBeInTheDocument();
  });

  it('dva SPF zaznamy hlasi jmenovite, co s tim', () => {
    render(withIntl(<DnsRecords domain="kolo-shop.cz" records={records} checks={checks} />));
    expect(screen.getByText(/Našli jsme dva SPF záznamy/)).toBeInTheDocument();
  });

  it('castecny DKIM rekne, kolik ze tri je videt', () => {
    render(withIntl(<DnsRecords domain="kolo-shop.cz" records={records} checks={checks} />));
    expect(screen.getByTestId('dkim-status')).toHaveTextContent('2');
  });

  it('neznamy stav ma sede kolecko, ne cervene', () => {
    render(withIntl(<DnsRecords domain="kolo-shop.cz" records={records} checks={checks} />));
    expect(screen.getByTestId('dot-dmarc')).toHaveAttribute('data-tone', 'grey');
  });

  it('rika, ze stranku jde zavrit a kontrolujeme dal', () => {
    render(withIntl(<DnsRecords domain="kolo-shop.cz" records={records} checks={checks} />));
    expect(screen.getByText(/Stránku můžete zavřít/)).toBeInTheDocument();
  });

  it('pocet zaznamu je ICU plural, ne pevne slovo', () => {
    render(withIntl(<DnsRecords domain="kolo-shop.cz" records={records} checks={checks} />));
    expect(screen.getByText('Přidejte 3 záznamy')).toBeInTheDocument();
  });
});

describe('dlazdice dorucitelnosti', () => {
  it('u miry stiznosti je napsano, ze je to odhad', () => {
    render(withIntl(<DeliverabilityTiles metrics={{ bounce_rate: 0.062, complaint_rate: 0.0012, delivery_rate: 0.93, soft_rate: 0.01 }}
      account={{ enforcement_status: 'HEALTHY', production_access: true, quota_max_24h: 50_000, quota_sent_24h: 12_000, quota_max_send_rate: 14 }}
      unmatchedEvents={0} />));
    expect(screen.getByText(/Naše číslo je odhad/)).toBeInTheDocument();
  });

  it('u kazde metriky je veta, co to znamena a co s tim', () => {
    render(withIntl(<DeliverabilityTiles metrics={{ bounce_rate: 0.062, complaint_rate: 0.0012, delivery_rate: 0.93, soft_rate: 0.01 }}
      account={{ enforcement_status: 'HEALTHY', production_access: true, quota_max_24h: 50_000, quota_sent_24h: 12_000, quota_max_send_rate: 14 }}
      unmatchedEvents={0} />));
    expect(screen.getByTestId('tile-bounce')).toHaveAttribute('data-zone', 'orange');
  });

  it('prazdny stav vysvetluje, kdy se cisla objevi', () => {
    render(withIntl(<DeliverabilityTiles metrics={null} account={null} unmatchedEvents={0} />));
    expect(screen.getByText(/Až odešlete první kampaň/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Spustit, ověřit pád**

Run: `pnpm --filter @mlain/web test:unit -- sending`
Expected: FAIL, komponenty a datové soubory neexistují.

- [ ] **Step 3: Napsat datové soubory**

```json
// packages/core/data/dns-providers.json
[
  { "id": "wedos", "label": "WEDOS", "nsPatterns": ["wedos.net", "wedos.cz"],
    "steps": ["Zákaznický portál", "Domény", "DNS", "Přidat záznam"], "verifiedAt": "2026-07-31" },
  { "id": "forpsi", "label": "FORPSI", "nsPatterns": ["forpsi.net", "forpsi.com"],
    "steps": ["Administrace", "Domény", "DNS zóna"], "verifiedAt": "2026-07-31" },
  { "id": "active24", "label": "ACTIVE 24", "nsPatterns": ["active24.com", "active24.cz"],
    "steps": ["Klientské centrum", "Domény", "DNS"], "verifiedAt": "2026-07-31" },
  { "id": "webglobe", "label": "Webglobe", "nsPatterns": ["webglobe.cz"], "steps": [], "verifiedAt": "2026-07-31" },
  { "id": "gransy", "label": "Gransy / Subreg", "nsPatterns": ["subreg.cz", "gransy.com"], "steps": [], "verifiedAt": "2026-07-31" },
  { "id": "banan", "label": "Banán", "nsPatterns": ["ns.banan.cz"], "steps": [], "verifiedAt": "2026-07-31" },
  { "id": "cloudflare", "label": "Cloudflare", "nsPatterns": ["cloudflare.com"], "steps": [],
    "warning": "cloudflareProxy", "verifiedAt": "2026-07-31" },
  { "id": "godaddy", "label": "GoDaddy", "nsPatterns": ["domaincontrol.com"], "steps": [], "verifiedAt": "2026-07-31" },
  { "id": "route53", "label": "AWS Route 53", "nsPatterns": ["awsdns"], "steps": [], "verifiedAt": "2026-07-31" },
  { "id": "vercel", "label": "Vercel", "nsPatterns": ["vercel-dns.com"], "steps": [], "verifiedAt": "2026-07-31" },
  { "id": "namecheap", "label": "Namecheap", "nsPatterns": ["registrar-servers.com"], "steps": [], "verifiedAt": "2026-07-31" },
  { "id": "ionos", "label": "IONOS", "nsPatterns": ["ui-dns", "ionos"], "steps": [], "verifiedAt": "2026-07-31" },
  { "id": "squarespace", "label": "Squarespace", "nsPatterns": ["googledomains.com", "squarespacedns.com"], "steps": [], "verifiedAt": "2026-07-31" },
  { "id": "generic", "label": "Neznámý poskytovatel", "nsPatterns": [], "steps": [], "verifiedAt": "2026-07-31" }
]
```

```json
// packages/core/data/smtp-presets.json
[
  { "id": "wedos", "label": "Wedos", "host": "smtp.wedos.net", "port": 587, "encryption": "starttls", "verifiedAt": "2026-07-31" },
  { "id": "forpsi", "label": "Forpsi", "host": "smtp.forpsi.com", "port": 587, "encryption": "starttls", "verifiedAt": "2026-07-31" },
  { "id": "active24", "label": "Active24", "host": "smtp.active24.cz", "port": 587, "encryption": "starttls", "verifiedAt": "2026-07-31" },
  { "id": "webglobe", "label": "Webglobe", "host": "smtp.webglobe.cz", "port": 587, "encryption": "starttls", "verifiedAt": "2026-07-31" },
  { "id": "seznam", "label": "Seznam", "host": "smtp.seznam.cz", "port": 465, "encryption": "tls", "verifiedAt": "2026-07-31" },
  { "id": "google", "label": "Google Workspace", "host": "smtp.gmail.com", "port": 587, "encryption": "starttls", "verifiedAt": "2026-07-31" },
  { "id": "microsoft", "label": "Microsoft 365", "host": "smtp.office365.com", "port": 587, "encryption": "starttls", "verifiedAt": "2026-07-31" }
]
```

- [ ] **Step 4: Napsat obrazovku se záznamy**

```tsx
// apps/web/src/features/sending/dns-records.tsx
'use client';

import { useTranslations, useFormatter } from 'next-intl';
import { Alert, Button, CopyButton, Dot } from '@mlain/ui';

export type DnsRecord = {
  type: 'CNAME' | 'TXT' | 'MX'; name: string; value: string; ttl: number;
  purpose: 'dkim' | 'spf' | 'dmarc' | 'mail_from_mx'; required: boolean;
};

type Check = { ok: boolean | null; findings: Array<{ code: string; severity: string; params?: Record<string, string | number> }> };

function tone(ok: boolean | null): 'green' | 'red' | 'grey' {
  if (ok === true) return 'green';
  if (ok === false) return 'red';
  // null znamena "nevime", a takovy stav nesmi blokovat ani strasit cervenou.
  return 'grey';
}

export function DnsRecords({
  domain, records, checks, onCheckNow, onDownloadCsv,
}: {
  domain: string;
  records: DnsRecord[];
  checks: { spf: Check; dkim: Check & { found: number; expected: number }; dmarc: Check; mx: Check };
  onCheckNow?: () => void;
  onDownloadCsv?: () => void;
}) {
  const t = useTranslations('campaigns.dns');
  const format = useFormatter();

  return (
    <section aria-labelledby="dns-title">
      <h2 id="dns-title">{t('title', { domain })}</h2>
      {/* Pocet se bere z poctu skutecne vygenerovanych karet, nikdy se nepise natvrdo. */}
      <p>{t('recordCount', { count: records.length })}</p>

      <ul>
        {(['dkim', 'spf', 'dmarc', 'mx'] as const).map((key) => (
          <li key={key}>
            <Dot data-testid={`dot-${key}`} data-tone={tone(checks[key].ok)} tone={tone(checks[key].ok)} />
            <span data-testid={`${key}-status`}>
              {key === 'dkim' ? `${checks.dkim.found}/${checks.dkim.expected}` : key.toUpperCase()}
            </span>
          </li>
        ))}
      </ul>

      {checks.spf.findings.map((f) => (
        <Alert key={f.code} tone="error">{t(f.code === 'spf_multiple_records' ? 'spfMultiple' : 'unknown')}</Alert>
      ))}

      <table>
        <caption>{t('title', { domain })}</caption>
        <thead>
          <tr><th scope="col">Typ</th><th scope="col">Název</th><th scope="col">Hodnota</th><th scope="col">TTL</th></tr>
        </thead>
        <tbody>
          {records.map((r) => (
            <tr key={`${r.purpose}-${r.name}`}>
              <td>{r.type}</td>
              <td>{r.name} <CopyButton value={r.name} label={t('copy')} /></td>
              <td>{r.value} <CopyButton value={r.value} label={t('copy')} /></td>
              <td>{format.number(r.ttl)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <Button onClick={onDownloadCsv}>{t('downloadCsv')}</Button>
      <Button onClick={onCheckNow}>{t('checkNow')}</Button>
      <p>{t('propagation')}</p>
    </section>
  );
}
```

- [ ] **Step 5: Napsat dlaždice doručitelnosti a stránky**

```tsx
// apps/web/src/features/sending/deliverability-tiles.tsx
'use client';

import { useTranslations, useFormatter } from 'next-intl';
import { EmptyState, Tile } from '@mlain/ui';
import { zoneFor } from '@mlain/core/campaigns';

export function DeliverabilityTiles({
  metrics, account, unmatchedEvents,
}: {
  metrics: { bounce_rate: number; complaint_rate: number; delivery_rate: number; soft_rate: number } | null;
  account: { enforcement_status: string; production_access: boolean; quota_max_24h: number | null; quota_sent_24h: number | null; quota_max_send_rate: number | null } | null;
  unmatchedEvents: number;
}) {
  const t = useTranslations('campaigns.deliverability');
  const format = useFormatter();

  if (!metrics || !account) return <EmptyState title={t('empty')} />;

  return (
    <section>
      <Tile title={t('accountStatus')} value={account.enforcement_status} />
      <Tile
        title={t('dailyQuota')}
        value={`${format.number(account.quota_sent_24h ?? 0)} / ${format.number(account.quota_max_24h ?? 0)}`}
      />
      <Tile title={t('sendRate')} value={String(account.quota_max_send_rate ?? 0)} />
      <Tile
        data-testid="tile-bounce"
        data-zone={zoneFor('bounce', metrics.bounce_rate)}
        title="Nedoručitelnost"
        value={format.number(metrics.bounce_rate, { style: 'percent', maximumFractionDigits: 1 })}
        hint="Amazon vás při 5 % dává pod dohled. Vyčistěte databázi presetem Nikdy neotevřel."
      />
      <Tile
        data-testid="tile-complaint"
        data-zone={zoneFor('complaint', metrics.complaint_rate)}
        title="Stížnosti"
        value={format.number(metrics.complaint_rate, { style: 'percent', maximumFractionDigits: 2 })}
        hint={t('estimateNote')}
      />
      <Tile title={t('unmatchedEvents')} value={format.number(unmatchedEvents)} />
    </section>
  );
}
```

```tsx
// apps/web/src/app/[locale]/w/[slug]/deliverability/page.tsx
import { DeliverabilityTiles } from '../../../../../features/sending/deliverability-tiles';
import { loadDeliverability } from '../../../../../server/services/providers';

export default async function DeliverabilityPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await loadDeliverability(slug);
  return <DeliverabilityTiles metrics={data.metrics} account={data.account} unmatchedEvents={data.unmatchedEvents} />;
}
```

```tsx
// apps/web/src/app/[locale]/d/[token]/page.tsx
import { notFound } from 'next/navigation';
import { DnsRecords } from '../../../../features/sending/dns-records';
import { loadDelegationPage } from '../../../../server/services/providers';

export const metadata = { robots: { index: false, follow: false } };

/**
 * Verejna delegacni stranka. Ukazuje JEN zaznamy pro jednu domenu, navod a stav
 * overeni. Nic z nastroje: zadne kontakty, zadne kampane, zadny nazev projektu
 * krome jmena firmy. Neda se z ni nic zmenit krome spusteni kontroly.
 */
export default async function DelegationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await loadDelegationPage(token);
  if (!data) notFound();
  return <DnsRecords domain={data.domain} records={data.records} checks={data.checks} />;
}
```

```tsx
// apps/web/src/app/[locale]/w/[slug]/settings/sending/page.tsx
import { SendingSettings } from '../../../../../../features/sending/sending-settings';
import { loadSendingSettings } from '../../../../../../server/services/providers';

export default async function SendingSettingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await loadSendingSettings(slug);
  return <SendingSettings providers={data.providers} domains={data.domains} trial={data.trial} />;
}
```

```tsx
// apps/web/src/app/[locale]/w/[slug]/settings/sending/domains/[id]/page.tsx
import { DnsRecords } from '../../../../../../../../features/sending/dns-records';
import { loadDomainScreen } from '../../../../../../../../server/services/providers';

export default async function DomainPage({ params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params;
  const data = await loadDomainScreen(slug, id);
  return <DnsRecords domain={data.domain} records={data.records} checks={data.checks} />;
}
```

- [ ] **Step 6: Spustit, ověřit průchod**

Run: `pnpm --filter @mlain/web test:unit -- sending`
Expected: PASS, 13 testů.

- [ ] **Step 7: Commit**

```bash
git add packages/core/data apps/web/src/features/sending apps/web/src/app/\[locale\]/w/\[slug\]/settings/sending apps/web/src/app/\[locale\]/w/\[slug\]/deliverability apps/web/src/app/\[locale\]/d
git commit -m "feat(web): DNS records screen, deliverability tiles and delegation page"
```

---

#### Úkol 62: Zlatá cesta odeslání jako E2E scénář

**Files:**
- Create: `apps/web/e2e/campaign-send.spec.ts`

- [ ] **Step 1: Napsat scénář**

```ts
// apps/web/e2e/campaign-send.spec.ts
import { expect, test } from '@playwright/test';
import { seedWorkspace, seedVerifiedDomain, seedContacts, fakeSes } from './fixtures';

test.describe('zlata cesta odeslani kampane', () => {
  test('od draftu po uzavrenou kampan', async ({ page }) => {
    const ws = await seedWorkspace();
    await seedVerifiedDomain(ws, 'kolo-shop.cz');
    await seedContacts(ws, { count: 120, list: 'newsletter' });
    const ses = await fakeSes();

    await page.goto(`/w/${ws.slug}/campaigns`);
    await page.getByRole('button', { name: 'Vytvořit kampaň' }).click();
    await page.getByLabel('Předmět').fill('Letní výprodej začíná');
    await page.getByLabel('Publikum').selectOption('newsletter');
    await page.getByRole('button', { name: /Odeslat/ }).click();

    // Potvrzovaci dialog: fokus je na bezpecnejsi volbe.
    await expect(page.getByRole('button', { name: 'Zpět k úpravám' })).toBeFocused();
    await expect(page.getByText(/Potom už e-maily zpátky vzít nejde/)).toBeVisible();
    await page.getByRole('button', { name: /Odeslat 120 e-mailů/ }).click();

    // Okno na zruseni: behem nej neodejde ani jeden mail.
    await expect(page.getByText(/Odesíláme za/)).toBeVisible();
    expect(ses.sentCount()).toBe(0);

    await page.getByRole('button', { name: 'Vzít zpět' }).click();
    await expect(page.getByText('Zrušená')).toBeVisible();
    expect(ses.sentCount()).toBe(0);
  });

  test('publikum jen z ukazkovych kontaktu odeslat nejde', async ({ page }) => {
    const ws = await seedWorkspace();
    await seedVerifiedDomain(ws, 'kolo-shop.cz');
    await seedContacts(ws, { count: 50, list: 'ukazka', sourceRef: SAMPLE_SOURCE_REF });

    await page.goto(`/w/${ws.slug}/campaigns/new`);
    await page.getByLabel('Předmět').fill('Test');
    await page.getByLabel('Publikum').selectOption('ukazka');
    await page.getByRole('button', { name: /Odeslat/ }).click();

    await expect(page.getByText('Publikum obsahuje jen ukázkové kontakty. Těm se nic neodešle.')).toBeVisible();
  });

  test('pozastaveni behem odesilani prestane pridavat odeslane', async ({ page }) => {
    const ws = await seedWorkspace();
    await seedVerifiedDomain(ws, 'kolo-shop.cz');
    await seedContacts(ws, { count: 500, list: 'newsletter' });

    await page.goto(`/w/${ws.slug}/campaigns/new`);
    await page.getByLabel('Předmět').fill('Velká kampaň');
    await page.getByLabel('Publikum').selectOption('newsletter');
    await page.getByRole('button', { name: /Odeslat/ }).click();
    await page.getByRole('button', { name: /Odeslat 500 e-mailů/ }).click();

    await page.getByRole('button', { name: 'Pozastavit' }).click();
    await expect(page.getByText('Pozastaveno')).toBeVisible();
    const shown = Number((await page.getByTestId('sent-count').textContent()) ?? '0');
    await page.waitForTimeout(5000);
    const after = Number((await page.getByTestId('sent-count').textContent()) ?? '0');
    // Dobehne nejvyse jedna davka senderu (SENDER_BATCH_SIZE = 100).
    expect(after - shown).toBeLessThanOrEqual(100);
  });
});
```

- [ ] **Step 2: Spustit**

Run: `pnpm --filter @mlain/web test:e2e -- campaign-send`
Expected: PASS, 3 scénáře.

- [ ] **Step 3: Commit**

```bash
git add apps/web/e2e/campaign-send.spec.ts
git commit -m "test(web): golden path e2e for send, undo, sample guard and pause"
```

---

## 8. Akceptační kritéria, která plán pokrývá

Čísla jsou z části 4a, kapitoly 8, pokud není uvedeno jinak. Kritérium bez úkolu je díra v plánu, proto je tabulka úplná.

### 8.1 Část 4a, kapitola 8

| # | Kritérium | Úkol |
|---|---|---|
| 1 | `preflight.can_send = true` u kompletní kampaně | 49 |
| 2 | `POST /send` na `sent` vrací 409 `invalid_state_transition` | 4, 53 |
| 3 | Dvě souběžná `POST /send`: jedno 202, druhé 409 | 7, 53 |
| 4 | `PATCH` předmětu ve `scheduled` vrací 409 `campaign_locked` | 20, 53 |
| 5 | Pauza během `sending` zastaví růst `sent_count` | 22 |
| 6 | Zrušení: `sent` zůstane, zbytek `skipped` mimo `claimed` | 23 |
| 7 | `resume` u `provider_blocked` vrací 422 | 22, 53 |
| 7a | Pauza z `queueing` uspěje, kurzor zůstane | 14, 22 |
| 7b | `resume` po pauze během materializace vrací do `queueing` | 15, 22 |
| 7c | Timeout materializace: `UPDATE` zasáhne jeden řádek | 16, 22 |
| 7d | `pause_reason` je `jsonb` s klíči `code`, `source`, `at` | 5, 22 |
| 7e | Obnovení po kvótě pro `source` sender i app | 32 |
| 7f | `campaign.auto_paused` do 15 s, pauza uživatele bez záznamu | 5, 26 |
| 8 | Dva seznamy se společnými kontakty: bez duplicit | 9, 13 |
| 9 | Suppression kontakt není v outboxu, `skipped_suppressed` roste | 12, 16 |
| 10 | Restart workeru uprostřed materializace milionu | 12, 16 |
| 11 | Dvojí spuštění jobu nevytvoří duplicitní řádek | 13, 16 |
| 12 | Všechny řádky mají `created_at = audience_built_at` | 13 |
| 13 | `render_data` má právě klíče z `compiled_fields`, bez `email` | 10 |
| 14 | Materializace milionu do 5 minut | 13, 14 |
| 14a | Závod zrušení s materializací, dvacet opakování | 24 |
| 14b | Tentýž scénář s vypnutou kontrolou musí selhat | 24 |
| 14c | Partition po 14a jde odpojit | 24, 45 |
| 14d | Restart nenechá kampaň viset v `queueing` | 12, 16 |
| 15 | Odhlášení: `skipped` s `unsubscribed` do 1 s | 17 |
| 16 | `claimed` zpráva se odhlášením nezmění | 17 |
| 17 | Přímý zápis do `suppressions`: `reconcile` do 60 s | 18 |
| 18 | Špatný podpis vrací 401, nic se nezapíše | 38, 55 |
| 19 | Cizí `SigningCertURL` vrací 401 bez stažení | 38, 55 |
| 20 | Cizí `TopicArn` vrací 401 `topic_mismatch` | 38, 55 |
| 21 | `SubscriptionConfirmation` posune providera na `ready` | 39, 55 |
| 22 | Tatáž `Notification` třikrát: jeden řádek | 39, 41 |
| 23 | `Delivery` po `Bounce Permanent`: stav zůstane `sent` | 41 |
| 24 | `Send` po `Delivery`: stav zůstane `sent` | 41 |
| 25 | Nespárovaná událost se spáruje do 30 s | 42 |
| 26 | Staré `Timestamp`: 200, `invalid`, `stale_timestamp` | 38, 55 |
| 27 | `Permanent NoEmail`: suppression, stav `sent` | 40, 42 |
| 28 | `OnAccountSuppressionList` nezvýší `hard_bounces` | 40, 43 |
| 29 | Tři soft bouncy ve 30 dnech: suppression | 42 |
| 30 | Dva soft bouncy s odstupem 40 dní: nic | 42 |
| 31 | `MessageTooLarge`: bez suppression a bez čítače | 40, 42 |
| 32 | Stížnost mimo `not-spam`: okamžitá suppression | 40, 42 |
| 33 | Suppression vyškrtne `pending` ze všech kampaní | 17, 42 |
| 34 | Sandbox a 300 příjemců: `provider_sandbox` | 49 |
| 35 | 60 000 příjemců proti 50 000 kvótě: `provider_quota_exceeded` | 49 |
| 36 | Bounce rate nad 8 % při 500 zprávách: pauza do 15 s | 44, 26 |
| 36a | Projektový práh 0.05 sepne dřív, 0.12 vrací 422 | 6, 44 |
| 37 | Bounce rate nad 8 % při 200 zprávách: bez pauzy | 44 |
| 38 | `SHUTDOWN` pozastaví všechny kampaně providera | 31 |
| 39 | Tři platné DKIM CNAME: `dkim_ok = true`, `found = 3` | 35 |
| 40 | Dva SPF záznamy: `spf_multiple_records` | 34 |
| 41 | Bez DMARC: varování, kampaň jde odeslat | 35, 49 |
| 42 | `p=quarantine`: `dmarc_ok = true`, zelená | 35 |
| 43 | `SERVFAIL`: `dkim_ok = null`, doména použitelná | 35 |
| 44 | CNAME z `SigningHostedZone` API, ne natvrdo | 33 |
| 45 | Plán o 3 minuty: `campaign_schedule_too_soon` | 20 |
| 46 | Plán na 400 dní: `campaign_schedule_too_far` | 20 |
| 47 | 9:00 Europe/Prague v létě 07:00 UTC, v zimě 08:00 | 20 |
| 48 | Zpoždění 3 hodiny: odešle se, webhook `schedule_delayed` | 21 |
| 49 | Zpoždění 9 hodin: `schedule_missed`, neodešle se | 21 |
| 50 | Testovací odeslání je rozeznatelné a mimo `total_count` | 50 (přes `kind`, viz D1) |
| 51 | Cizí suppression adresa: `test_recipient_suppressed` | 50 |
| 52 | Adresa vlastníka na suppression listu projde | 50 |
| 53 | Dvacátý první test za hodinu: 429 s `Retry-After` | 53 |
| 54 | `PATCH` předmětu ve `sending`: 409, trigger v DB | 53 |
| 55 | `render_data` má vnořený tvar | 10 |
| 56 | `contact.attr.city` z `attributes` | 10, 13 |
| 57 | Bez `unsubscribe_url`, `webview_url` a `email` | 10 |
| 58 | Merge tag z předmětu je v `compiled_fields` | 47 |
| 59 | Undo okno: `next_attempt_at = audience_built_at + 60 s` | 13, 25 |
| 60 | `undo` během okna: `cancelled`, `sent_count = 0` | 23, 25 |
| 61 | `undo` po vypršení: 409 `campaign_undo_window_expired` | 25, 53 |
| 62 | Změna předmětu v `draft` inkrementuje `revision` | 7, 47 |
| 63 | `message_events` nese `message_created_at` a `recipient` | 41 |
| 64 | Timeline zprávy sáhne do jediné partition | 41 |
| 65 | Párovací dotaz sáhne nejvýš do dvou partition | 41 |
| 66 | Soft bouncy bez joinu na `messages` | 42, 43 |
| 67 | `GET /messages` vrací `id` i `created_at` | 53 |
| 68 | Webhook `message.bounced` nese `data.message.created_at` | 51 |
| 69 | Retence neodpojí partition zasahující do okna | 45 |
| 70 | Partition s `paused` kampaní se neodpojí | 45 |
| 71 | Partition se `pending` nebo `claimed` se neodpojí | 45 |
| 72 | Kampaň z 31. 8. má zprávy v srpnové partition | 13, 45 |
| 73 | Suppression v čitelné podobě vyloučí kontakt | 8, 12 |
| 74 | Anonymizovaná adresa přes otisk vyloučí kontakt | 12, 16 |
| 75 | `removed_at` kontakt nevylučuje | 18 |
| 76 | Otisk starším pokolením klíče vyloučí i po rotaci | 18 |
| 77 | `reconcile` ruší i při shodě jen přes otisk | 18 |
| 78 | Odražená zpráva: `sent`, v `bounce_count`, ne ve `failed_count` | 26 |
| 79 | Celá odražená kampaň se uzavře jako `sent` | 26 |
| 80 | Bounce rate takové kampaně je 100 % | 43 |
| 81 | Brzda sepne, i když jsou všechny zprávy `sent` | 44 |
| 82 | Rekoncilace dvěma samostatnými dotazy | 26 |
| 83 | Rollup: `sent` z `messages`, zbytek z `message_events` | 43 |
| 84 | Dvě `bounced_soft` zvýší čítač o jedna | 26 |
| 85 | `ml_msg` spáruje i bez `provider_message_id` | 41 |
| 86 | `ambiguous_dispatch` se opraví na `sent` | 41 |
| 87 | Jiný `error_code` se neopraví | 41 |
| 88 | Lookup podle `ml_msg` a `ml_mday` do jediné partition | 41 |

### 8.2 Část 6, kapitola 15 (obrazovky, které plán vlastní)

| Kritérium | Úkol |
|---|---|
| Součet vyloučených plus výsledek se rovná vstupnímu počtu, na obou obrazovkách | 11, 59 |
| Řádek Vyloučeno je pojmenovaný po branách, ne souhrnný | 59 |
| Číslo na tlačítku pochází z jednoho volání jako řádek Publikum | 11, 59 |
| Fokus v potvrzovacím dialogu je na bezpečnější volbě | 59 |
| Věta o nevratnosti je doslova, ne jen červené tlačítko | 59 |
| Čtyři stavy obrazovky u seznamu kampaní | 58 |
| Klávesová cesta a role ARIA u průběhu a dialogu | 59, 60 |
| Katalog pauz pokrývá všech devět kódů | 57, 60 |
| Ukázkové kontakty se nedají zařadit do publika | 48, 62 |
| Počet DNS záznamů je ICU plural, ne pevné slovo | 57, 61 |
| Návod nese `verifiedAt` a stárne viditelně | 61 |

### 8.3 Část 1, kontraktní scénáře, kterých se plán dotýká

`OB-13` (invariant I1) pokrývá úkol 13, `OB-14` (zrušení kampaně) úkol 23, `OB-15` (pozdní bounce) úkol 41, `OB-21` a `OB-22` (úzká výjimka `failed → sent`) úkol 41. Scénáře samotné vlastní P02 a spouští je obě strany; P13 k nim dodává aplikační polovinu chování.

---

## 9. Soubory, které plán vlastní

Tohle je úplný a uzavřený seznam. **Mimo tyto soubory plán nesahá na nic.**

### 9.1 `packages/core`

```
packages/core/src/campaigns/constants.ts
packages/core/src/campaigns/types.ts
packages/core/src/campaigns/state-machine.ts
packages/core/src/campaigns/pause-reason.ts
packages/core/src/campaigns/settings.ts
packages/core/src/campaigns/ports.ts
packages/core/src/campaigns/compile.ts
packages/core/src/campaigns/audience/build-sql.ts
packages/core/src/campaigns/audience/preview.ts
packages/core/src/campaigns/audience/render-data.ts
packages/core/src/campaigns/audience/sample-guard.ts
packages/core/src/campaigns/materialize/plan.ts
packages/core/src/campaigns/materialize/plan-constants.ts
packages/core/src/campaigns/materialize/loop.ts
packages/core/src/campaigns/materialize/finish.ts
packages/core/src/campaigns/control/pause.ts
packages/core/src/campaigns/control/resume.ts
packages/core/src/campaigns/control/cancel.ts
packages/core/src/campaigns/control/undo.ts
packages/core/src/campaigns/control/schedule.ts
packages/core/src/campaigns/outbox/revoke.ts
packages/core/src/campaigns/outbox/reconcile.ts
packages/core/src/campaigns/outbox/anonymize.ts
packages/core/src/campaigns/outbox/stall-watch.ts
packages/core/src/campaigns/preflight/checks.ts
packages/core/src/campaigns/preflight/result.ts
packages/core/src/campaigns/deliverability/metrics.ts
packages/core/src/campaigns/deliverability/guards.ts
packages/core/src/campaigns/deliverability/rollup.ts
packages/core/src/campaigns/events/catalog.ts
packages/core/src/campaigns/events/bounce-classification.ts
packages/core/src/campaigns/events/normalize.ts
packages/core/src/campaigns/events/process.ts
packages/core/src/campaigns/test-send/send-test.ts
packages/core/src/campaigns/webhooks/declarations.ts
packages/core/src/campaigns/jobs/queue-handlers.ts
packages/core/src/campaigns/jobs/materialize.ts
packages/core/src/campaigns/jobs/scheduler.ts
packages/core/src/campaigns/jobs/watchdog.ts
packages/core/src/campaigns/jobs/resume-on-quota.ts
packages/core/src/campaigns/jobs/reconcile.ts
packages/core/src/campaigns/jobs/provider-event-process.ts
packages/core/src/campaigns/jobs/provider-refresh-quota.ts
packages/core/src/campaigns/jobs/domain-recheck.ts
packages/core/src/campaigns/jobs/retention.ts
packages/core/src/campaigns/__tests__/**
packages/core/src/campaigns/**/__tests__/**

packages/core/src/providers/types.ts
packages/core/src/providers/config-schema.ts
packages/core/src/providers/crypto.ts
packages/core/src/providers/state-machine.ts
packages/core/src/providers/delegation.ts
packages/core/src/providers/trial-mode.ts
packages/core/src/providers/ses/client.ts
packages/core/src/providers/ses/account.ts
packages/core/src/providers/ses/identity.ts
packages/core/src/providers/ses/events-setup.ts
packages/core/src/providers/smtp/verify.ts
packages/core/src/providers/dns/resolver.ts
packages/core/src/providers/dns/spf.ts
packages/core/src/providers/dns/dkim.ts
packages/core/src/providers/dns/dmarc.ts
packages/core/src/providers/dns/mx.ts
packages/core/src/providers/dns/check-domain.ts
packages/core/src/providers/dns/detect-provider.ts
packages/core/src/providers/sns/verify.ts
packages/core/src/providers/sns/dedup.ts
packages/core/src/providers/sns/subscription.ts
packages/core/src/providers/__tests__/**

packages/core/data/dns-providers.json
packages/core/data/smtp-presets.json
```

### 9.2 Datová vrstva domény, uvnitř `packages/core` (viz rozhodnutí D2)

Původní podoba plánu tyhle soubory umisťovala do `packages/db/src/repo/campaigns/**`, tedy do balíčku ve výhradním vlastnictví P03, a importovala je podcestou `@mlain/db/repo/...`, kterou `@mlain/db` nevystavuje. Po přesunu nezakládá P13 v `packages/db` **ani jeden soubor**.

```
packages/core/src/campaigns/repo/campaign.ts
packages/core/src/campaigns/repo/audience.ts
packages/core/src/campaigns/repo/audience-progress.ts
packages/core/src/campaigns/repo/outbox.ts
packages/core/src/campaigns/repo/message-events.ts
packages/core/src/campaigns/repo/receipts.ts
packages/core/src/campaigns/repo/counters.ts
packages/core/src/campaigns/repo/deliverability.ts
packages/core/src/campaigns/repo/links.ts
packages/core/src/campaigns/repo/retention.ts
packages/core/src/campaigns/repo/__tests__/**
packages/core/src/providers/repo/provider.ts
packages/core/src/providers/repo/domain.ts
packages/core/src/providers/repo/__tests__/**
```

### 9.3 `apps/web`

```
apps/web/src/server/routes/campaigns/**
apps/web/src/server/routes/providers/**
apps/web/src/server/routes/webhooks-ses/**
apps/web/src/server/services/campaigns.ts
apps/web/src/server/services/providers.ts
apps/web/src/features/campaigns/**
apps/web/src/features/sending/**
apps/web/src/app/[locale]/w/[slug]/campaigns/**
apps/web/src/app/[locale]/w/[slug]/settings/sending/**
apps/web/src/app/[locale]/w/[slug]/deliverability/**
apps/web/src/app/[locale]/d/[token]/**
apps/web/e2e/campaign-send.spec.ts
```

### 9.4 `packages/i18n`

```
packages/i18n/messages/cs/campaigns.json
packages/i18n/messages/en/campaigns.json
packages/i18n/__tests__/campaigns-namespace.test.ts
```

### 9.5 Věta o vlastnictví

> **Plán P13 nevytváří ani nemění žádný soubor mimo seznamy 9.1 až 9.4.** Konkrétně nesahá na `packages/db/src/schema/**`, `packages/db/migrations/**`, `packages/db/src/rls.ts`, `packages/db/src/tx.ts`, `packages/core/src/contacts/repo/segments.ts`, `packages/core/src/contacts/repo/**`, `packages/core/src/contacts/repo/suppressions.ts`, `packages/core/src/config/**`, `packages/core/src/errors/**`, `packages/core/src/queues/**`, `packages/core/src/contacts/**`, `packages/core/src/templates/**`, `packages/core/package.json`, `packages/contracts/**` včetně fixtures, `packages/ui/**`, `packages/i18n/` mimo dva vlastní soubory a jejich test, `apps/web/src/lib/api/**`, `apps/web/src/app/api/v1/[[...route]]/route.ts`, `apps/web/src/proxy.ts`, `apps/sender/**`, `apps/worker/**`, `docker/**`, `turbo.json` ani `.github/workflows/**`. Když plán zjistí, že v cizím souboru něco chybí, je to nález proti jeho vlastníkovi a řeší se změnou toho plánu, ne zápisem z této větve. Úplný soupis takových nálezů je v kapitole 4.

---

## 10. Sebekontrola po dopsání plánu

**Pokrytí specifikace.** Prošel jsem kapitoly 2 až 8 části 4a, kapitoly 8.2 a 8.6 části 6 a sekci 4.10.1 části 1. Každá kapitola má úkol, kritéria jsou namapovaná v kapitole 8. Dvě věci ze specifikace vědomě nedělám a je to napsané nahoře: asynchronní odrazy do schránky u SMTP (rozhodnutí D9, patří do MVP 1) a nekampáňové zprávy (rozhodnutí D10, kontraktní rezerva zůstává prázdná).

**Zástupné texty.** Prošel jsem plán na obvyklé značky nedodělků (dvě velká písmena používaná v kódu pro nedokončenou práci, „doplnit později", „podobně jako výše" a „ošetřit chyby"). Žádný výskyt. Každý krok, který mění kód, ten kód ukazuje. Formulace je opsaná schválně, aby soubor zůstal čistý i pod naivním grepem, který takové značky hledá.

**Konzistence typů a názvů.** `revokePendingMessages` má v úkolu 17 stejný tvar, jakým ji volá část 2 (`ctx` první, `listId` povinný, šest hodnot `reason`). `PauseReason` z úkolu 5 se používá beze změny v úkolech 22, 26, 31, 32 a 42. `AudienceGateCounts` z úkolu 8 má jedenáct klíčů a shoduje se s tím, co konzumují úkoly 11, 16 a 48. `StoredCompileMeta` z úkolu 47 je pojmenovaná odlišně od `CompileMeta` z P08 schválně: jsou to dva různé tvary a shodné jméno by svádělo k přetypování, které by rozdíl zamlčelo.

**Cizí kontrakty jsem přepsal z jejich aktuálního znění, ne z paměti.** `compileTemplate`, `CompileResult`, `CompileMeta`, `CompiledLink` a `RenderSchema` jsou z P08 doslova. `prepareRenderData` a `PreparedDataSchema` z P02. `withWorkspace`, `withReadOnly`, `pgErrorCode` a `Tx` z P04. `dropPartitionsBefore`, `PartitionVeto` a `Queryable` z P03. Stavy kontaktu jsou z P07 a `subscribed` mezi nimi není.

**Pět míst, kde jsem opravil specifikaci, ne ji jen přepsal.** Pozice odkazů od jedné místo od nuly a ID z `CompileMeta` (D17), `messages.kind` místo `render_data['_test']` (D1), `campaigns.compile_meta` jako sloupec místo degradace s logem (D18), příprava dat pro render v Node místo skládání v SQL (D20) a zahození prefixu `[TEST]`, který neměl kam být uložen (D21). U všech pěti je v plánu napsané, proč, a všechny mají test, který porušení zachytí automaticky.

**Testy, které se neptají téhož zdroje.** Ochrana je k ničemu, když ji hlídá test čtoucí tutéž konstantu. Čtyři místa proto sahají jinam: řetězový test kompilace bere jméno kořene z `COMPILED_ONLY_ROOTS` v kontraktech a mapu plní kontraktní funkcí; `rank-mirror.db.test.ts` porovnává katalog s hodnotou, kterou spočítá generovaný sloupec v databázi; `sample-guard.db.test.ts` seeduje přes konvenci P16, ne přes vlastní příznak, a navíc ověřuje v `information_schema`, že sloupec, na který filtruje, existuje; test předpokladů v úkolu 1 se ptá běžícího modulu a běžící databáze, ne zdrojáků P03 a P04.

**Čeho se bojím nejvíc.** Závod zrušení s materializací (úkol 24) je jediné místo, kde jeden průchod testu nic nedokazuje, proto se opakuje dvacetkrát a má negativní kontrolu. Druhé takové místo je prázdný report kliků z D17; ten nemá jak selhat hlasitě, proto je proti němu tvrdá kontrola `contract_mismatch` před odesláním, ne jen test. Třetí a nejtišší je vynechané volání `prepareRenderData`: nespadne u něj nic, projde kompilace i odeslání, a pozná se to až na mailu, ve kterém chybí celá sekce. Proti němu stojí dva nezávislé testy, databázový nad uloženým `render_data` a řetězový až k hotovému HTML.

**Co zůstává otevřené a blokuje.** Tři požadavky na cizí plány, bez kterých se plán nedá dokončit: `campaigns.compile_meta` (R-P03.5, ověřeno v P03 v okamžiku psaní, sloupec tam není), cizí klíč invariantu I1 omezený na kampaňové zprávy (R-P03.7, ověřeno spuštěním) a migrátorské spojení pro retenci (R-P01.6). Všechny tři jsou zapsané i v `NALEZY-NAPRIC-PLANY.md` jako P13-1, P13-2 a P13-5.

