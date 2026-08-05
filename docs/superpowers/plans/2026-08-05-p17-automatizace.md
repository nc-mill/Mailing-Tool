# P17: Automatizace, implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. **Nejdřív si ale přečti kapitolu 0**: tenhle dokument je rozhodovací plán, ne rozepsaný seznam úkolů, a před spuštěním se musí fáze A až F rozepsat do úkolů ve tvaru P13.

**Datum:** 5. 8. 2026, verze 2 po prověrce šesti recenzenty (viz kapitola 16)
**Rozsah specifikace:** MVP 2, „Automatizační engine" z kapitoly 7 hlavní specifikace, část 5 (3.9.3 krok 8, 3.12.1, 2.2.1), část 1 (4.10.1), část 4a (2.4).

**Goal:** Dodat automatizační engine Mlain Maileru: vizuální scénář s neměnnými verzemi, běh kontaktu, který přežije restart a čekání dlouhé měsíce, spouštěče navázané na hotové zpracování událostí, uzly čekání, podmínky s větvením a odeslání e-mailu, odesílání týmž outboxem jako kampaně, a časovou osu, která netechnickému člověku vysvětlí větou, proč kontakt šel danou větví.

**Architecture:** Doménová logika žije v `packages/core/src/automations/**` a nezná HTTP ani databázi přímo, datový přístup jde přes `packages/core/src/automations/repo/**` a transakce otevírá `withWorkspace(ctx, fn)` z `@mlain/core/tx`. Scénář má dvě podoby: rozpracovaný graf na řádku `automations` (mění se libovolně) a **zmrazenou verzi** na řádku `automation_versions`, jejíž `graph` je neměnný a neměnnost vynucuje odebraný sloupcový `UPDATE` grant, ne dokumentace. Stav běžícího kontaktu drží dvojice `automation_runs` (běh) a `automation_run_steps` (jednotlivé kroky včetně toho, který teprve nastane). **Naplánovaný krok je řádek v databázi, ne odložený pg-boss job**, protože se na něj musí dát dotázat, zrušit ho a ukázat ho v UI. Motor je dvoutaktní sken po vzoru `campaign.watchdog`: cronový `automations.tick` najde pod rolí `mlain_maintenance` projekty se splatnými kroky a vrátí jen identifikátory, práci pak odvede `automations.run_due` pod `mlain_app` v systémovém kontextu jednoho projektu, tedy pod RLS. Odesílání ze scénáře jde stejným outboxem jako kampaně: každý e-mailový uzel publikované verze má vlastní **skrytou hlavičkovou kampaň** (`campaigns.kind = 'system'`, `status = 'draft'` napořád) jako nosič obsahu a odesílatele, a zprávy nesou nový druh `messages.kind = 'automation'`, který sender claimuje třetí větví po vzoru testovacího odeslání.

**Tech Stack:** TypeScript 5.9.3 (Apache-2.0), Next.js 16.2.12 (MIT), Hono 4.12.33 (MIT), `@hono/zod-openapi` 1.5.1 (MIT), zod 4.4.3 (MIT), Drizzle ORM (MIT), pg 8.22.0 (MIT), pg-boss 12.26.3 (MIT), **`@xyflow/react` 12.11.2 (MIT)** jako jediná nová runtime závislost, `luxon` 3.7.2 (MIT), `next-intl` 4.13.4 (MIT), Go 1.25 pro claim větev senderu, Vitest 4.1.10 (MIT), Playwright. Úplná tabulka s licencemi je v kapitole 12.

---

## 0. Stav dokumentu a co v něm ještě chybí

Tenhle plán je hotový na úrovni **rozhodnutí, datového modelu a pořadí prací**. Není hotový na úrovni úkolů: norma `docs/superpowers/plans/2026-07-31-rozdeleni-implementacnich-planu.md` žádá v každém kroku úplný kód, přesné příkazy a očekávaný výstup včetně toho, že test má nejdřív spadnout. P13 to plní na 14 460 řádcích, P10 na 13 600. Tenhle dokument má řádově 1 700 a fáze A až F jsou seznam kroků, ne rozepsané úkoly.

**Než se začne psát kód, musí projít ještě jeden průchod, který fáze A až F rozepíše do úkolů ve tvaru P13** (Files, Step, kód, příkaz, očekávaný výstup). Je to práce zhruba na dva dny a je vědomě oddělená, protože rozhodnutí z kapitoly 2 se do té doby ještě mohou přehlasovat a rozepsané úkoly by se zahodily.

Co dokument naopak už obsahuje a co se rozepisováním nemá měnit: rozhodnutí D1 až D30, úplné DDL šesti tabulek, tvar grafu, pravidla způsobilosti, seznam cizích souborů, seznam testů s pevnými počty, které se rozbijí, a otevřené otázky pro zadavatele.

---

## 1. Co tenhle plán vlastní

### 1.1 Soubory a adresáře ve výhradním vlastnictví P17

| Cesta | Obsah |
|---|---|
| `packages/core/src/automations/**` | model scénáře, verzování, motor běhu, uzly, spouštěče, repo, joby, audit, API (včetně `api/` sub-appu, viz D23) |
| `packages/db/src/schema/automations.ts` | Drizzle schéma šesti nových tabulek |
| `packages/db/migrations/0016_automations.sql` | migrace (generovaná) |
| `packages/db/migrations/0017_automations_grants_rls.sql` | migrace (ručně psaná): RLS, granty, cyklický FK, `messages.kind` |
| `packages/i18n/messages/cs/automations.json` | český katalog nového namespace |
| `packages/i18n/messages/en/automations.json` | anglický katalog nového namespace |
| `apps/web/src/app/[locale]/w/[workspaceSlug]/automations/**` | obrazovky scénářů |
| `apps/web/src/features/automations/**` | klientské komponenty včetně plátna React Flow |
| `apps/sender/internal/outbox/claim_automation_test.go` | test třetí claim větve |

### 1.2 Soubory, které P17 čte a nikdy nemění

`packages/core/src/segments/**`, `packages/core/src/templates/**` (kromě volání), `packages/emails/**`, `packages/core/src/tx/**`, `packages/core/src/contacts/suppression/**`, `packages/ui/**`, `packages/contracts/**` mimo dva vyjmenované zásahy, `apps/sender/**` mimo pět vyjmenovaných souborů.

### 1.3 Čeho se P17 vědomě nedotýká

- **Kontraktní sloupce `messages` a jejich sémantika.** P17 nemění název, typ ani význam žádného sloupce, nemění stavy ani povolené přechody outboxu. Jediná změna je **rozšíření výčtu** `ck_messages__kind` o hodnotu `automation`, což část 1 v 4.10.1 předem povolila („prostor pro `transactional`", „aditivní změna v rámci verze 1 kontraktu: nová větev claimu s vlastním indexem, vzorem je už existující druhá dráha pro testovací odeslání"). Viz rozhodnutí D6 a požadavek R-C1.
- **Stavový stroj kampaní.** `CAMPAIGN_TRANSITIONS` zůstává beze změny. Hlavičkové kampaně automatizací jím nikdy neprocházejí, protože zůstávají v `draft` (D5).
- **Segmentový kompilátor.** O tom, jestli kontakt splňuje podmínku, rozhoduje výhradně `compileAudienceToSql` z části 2. P17 jeho výstup obaluje, nikdy nepřepisuje (D9).
- **Kompilace šablony.** P17 volá `compileTemplate`, `preSendCheck` a `prepareRenderData` stejně jako materializace kampaní. Vlastní renderovací cestu nezakládá.
- **Importní cesty.** P17 do `contacts/import/**` ani do budoucího importu událostí nepřidá ani řádek. Naopak: přidává test, který hlídá, že tam nikdy nic nepřibude (D18).

### 1.4 Cizí soubory, do kterých P17 přidá vyjmenovaný zásah

Tenhle seznam je závazný. Každý řádek je v úkolech popsaný doslova a nesmí se rozrůst. **Kapitola 3 s požadavky na jiné plány zanikla**: vlny 0 až 3 jsou v `main` a v tomhle repozitáři se pracuje přímo na `main`, takže „požadavek na cizí plán" nemá adresáta. Všechno níž dělá P17 sám.

**Registry a konfigurace**

| Soubor | Zásah |
|---|---|
| `packages/core/src/queues/registry.ts` | pět nových `QueueEntry`. **Rozbije `packages/core/test/queues/registry.test.ts`**, který fixuje 61 front na 66 |
| `packages/core/src/errors/types.ts` | rozhodnout doménu front, viz D24 |
| `packages/core/src/errors/problem-codes.ts` | nové API kódy (`automation_graph_invalid`, `automation_locked`, `automation_not_publishable`) |
| `packages/core/src/errors/message-codes.ts` | nové `messages.error_code` (`automation_paused`, `automation_not_eligible`). **Rozbije `packages/core/test/errors/registry.test.ts`**, který fixuje 34 kódů |
| `packages/core/src/identity/permissions.ts` | šest nových klíčů a jejich zařazení do rolí. **Rozbije `packages/core/src/identity/permissions.test.ts`**, který fixuje 48 na třech místech |
| `packages/core/src/config/schema-domains.ts` | šest automatizačních proměnných |
| `packages/core/src/config/schema-platform.ts` | `SENDER_AUTOMATION_BATCH_SIZE` (všech dvacet `SENDER_*` proměnných je tady, ne v `schema-domains.ts`) |
| `packages/core/src/config/config.manifest.json` | regenerace `tsx packages/core/scripts/write-manifest.ts`. **Rozbije `packages/core/test/config/manifest.test.ts`**, který fixuje 182 proměnných |
| `packages/contracts/config.json` | generovaný soubor, regeneruje se spolu s manifestem |
| `.env.example` | sedm nových proměnných s komentářem |
| `packages/core/package.json` | `"./automations/jobs": "./src/automations/jobs/queue-handlers.ts"`. **Bez toho `apps/worker/codegen.mjs` padne na `assertExportsMapCovers()`**, zástupný vzor `"./*"` lomítko nepohltí |
| `packages/db/drizzle.config.ts` | nové schéma do výslovného seznamu |
| `packages/db/src/schema/index.ts` | reexport |
| `packages/db/src/rls.ts` | šest tabulek do `WS_ISOLATION_TABLES`, `automation_run_steps` do `MAINTENANCE_SCAN_TABLES` **a do `EXTRA_POLICIES`**. Rozbije `rls-registry.test.ts`, který fixuje celkový počet politik |
| `packages/db/src/partitions.ts` | `PARTITIONED_REFERENCES` o odkaz `automation_run_steps.(message_id, message_created_at)`, viz D25 |
| `apps/web/package.json` | `@xyflow/react` |
| `apps/web/scripts/check-bundle-budget.mjs` | `automations-canvas` do `LAZY_ONLY` |
| `apps/web/src/lib/api/openapi.ts` | mount sub-appu, pořadí konkrétní cesta před parametrickou |
| `packages/i18n/src/load-messages.ts` | `'automations'` do `NAMESPACES` |
| `packages/ui/src/patterns/navigation/registry.ts` | `mvp0: true` na položce `automations`, zrušení `reservedFor` |

**Zavěšení spouštěčů**

| Soubor | Zásah |
|---|---|
| `packages/core/src/tracking/ingest/event-process.ts` | jeden řádek `enqueueAutomationTrigger` vedle stávajícího `segments.recalc_for_contact`, uvnitř téže transakce a **až za** stávající brankou `if (isImport) return;` |
| `packages/core/src/tracking/jobs/process-engagement.ts` | dva řádky v místě, kde se dnes emitují webhooky, výhradně na `transition.firstHumanOpen` a `firstHumanClick` |
| `packages/core/src/contacts/lists/confirm-service.ts` | jeden řádek v portu `emit` |
| `packages/core/src/contacts/lists/subscribe-service.ts` | totéž (druhá cesta k `status = 'confirmed'`). Pozor: `subscribe.ts` je čistá doména, zapojení je v `subscribe-service.ts` |
| `packages/core/src/contacts/api/lists.routes.ts` | strop hromadného spuštění u `POST /lists/{id}/subscribe:bulk`, viz D28 |

**Časová osa a reporty (území P14)**

| Soubor | Zásah |
|---|---|
| `packages/core/src/tracking/repo/web-events.repo.ts` | `WebEventInsert.source` se rozšíří z literálu `'email'` na union `'email' | 'automation'` |
| `packages/core/src/reports/timeline/branches.ts` | `webEventBranch` vrací skutečný `source` ze sloupce, `messageBranch` a `messageEventBranch` rozšíří filtr `kind` a přidají `c.kind` do projekce |
| `packages/core/src/reports/timeline/types.ts` | nová hodnota `TimelineFilter` |
| `packages/core/src/reports/timeline/titles.ts` | nové klíče v `TITLE_KEYS`. **Rozbije `titles.test.ts`**, který fixuje `titleKey('automation_entered') === 'timeline.item.generic'` |
| `packages/core/src/reports/api/contact-timeline.routes.ts` | nová hodnota do `FILTERS` |
| `packages/i18n/messages/{cs,en}/reports.json` | **sem patří všechny věty `timeline.item.*`**, ne do `automations.json`. Překladač je scopovaný prefixem `reports.` (`contact-timeline.routes.ts:96`) |
| `apps/web/src/features/reports/timeline/group-sessions.ts` | ikona pro automatizační položky. **Rozbije `group-sessions.test.ts`** |
| `apps/web/e2e/reports/timeline.spec.ts` | scénář používá `automation_entered` jako neznámý typ, přestane platit |

**Kampaně, provideři, GDPR**

| Soubor | Zásah |
|---|---|
| `packages/core/src/campaigns/repo/` | nový zapisovací port `upsertAutomationHeaderCampaign(tx, ctx, …)` vlastněný doménou kampaní, aby P17 nepsal do `campaigns` a `campaign_links` mimo ni (viz D26) |
| `packages/core/src/providers/repo/provider.ts` | `deleteProvider` maže natvrdo všechny `campaigns WHERE kind = 'system'` daného providera. Musí umět uklidit i automatizační hlavičky a jejich zprávy, viz D27 |
| `packages/core/src/contacts/jobs/gdpr-sever-links.ts` | **šestý** krok (soubor má dnes pět, ne šest): ukončení otevřených běhů a vyprázdnění `trigger_ref` |
| `packages/i18n/messages/{cs,en}/settings.json` | překlady nových auditních akcí. **Rozbije `apps/web/src/features/audit/audit-actions.test.ts`**, který fixuje 28 |

**Kontrakty a sender**

| Soubor | Zásah |
|---|---|
| `packages/contracts/src/outbox.ts` | `MESSAGE_KINDS` o `'automation'` (commit s prefixem `contract:`) |
| `packages/contracts/fixtures/outbox/**` | nová fixture `OB-23` |
| `apps/sender/internal/outbox/statements.go` | `StmtClaimAutomationBatch` a položka v `AllStatements()` |
| `apps/sender/internal/outbox/statements_test.go` | registr a `want` |
| `apps/sender/internal/outbox/claim.go` | `Store.ClaimAutomationBatch` |
| `apps/sender/internal/app/loop.go` | rozhraní `Claimer`, `AutomationBatchSize`, blok v `Tick` |
| `apps/sender/internal/app/loop_test.go` | fake `Claimer` |
| `apps/sender/internal/config/config.go` a `load.go` | `SENDER_AUTOMATION_BATCH_SIZE` |
| `apps/worker/test/handler-coverage.test.ts` | dočasný zápis do `UNDELIVERED`, než vzniknou obsluhy |

### 1.5 Věta o vlastnictví

P17 nevytváří ani nemění žádný soubor mimo seznamy 1.1 a 1.4. Zejména se nedotýká `packages/emails/**`, `packages/ui/src/**` mimo jeden řádek navigace, `packages/core/src/segments/**`, `packages/core/src/templates/**`, `apps/sender/internal/provider/**`, `apps/sender/internal/campaign/**`, `docker/**` a `.github/workflows/**`. Kdyby se ukázalo, že je zásah nutný, je to nález proti tomuhle plánu a doplňuje se do 1.4, ne se udělá mlčky.

---

## 2. Rozhodnutí, která tenhle plán udělal sám

Specifikace tyhle body neuzavírá. Jsou tady i s odůvodněním, aby šly přehlasovat vědomě.

### D1. Verze scénáře je samostatný řádek a její neměnnost vynucuje odebraný sloupcový grant

Specifikace žádá: „Každé publikování vytvoří neměnnou verzi. Kontakt, který vstoupil do verze 3, nesmí uprostřed scénáře přeskočit na verzi 4." Model je tříúrovňový:

- `automations` drží **rozpracovaný** graf (`draft_graph`), jméno, stav a politiku vstupu. Mění se libovolně a nikdo podle něj neběží.
- `automation_versions` drží **zmrazený** graf. Vzniká publikováním, číslo verze je monotónní, `graph_hash` je SHA-256 kanonické serializace.
- `automation_runs.version_id` je cizí klíč **s `ON DELETE RESTRICT`**. Běh se na verzi drží celý život a verzi nejde smazat, dokud v ní někdo běží.

Neměnnost se nedeklaruje, ale vynucuje stejnou technikou, jakou už repozitář používá u `consents`, `audit_log`, `web_events` a `system_settings`:

```sql
REVOKE UPDATE, DELETE ON automation_versions FROM mlain_app;
GRANT  UPDATE (state, retired_at) ON automation_versions TO mlain_app;
```

`DELETE` se odebírá taky: `ON DELETE RESTRICT` chrání jen verze, ve kterých někdo běží, takže bez odebrání by šlo smazat zmrazený graf verze, podle které se komu co poslalo. Vyřazení je `state = 'retired'`, ne mazání.

**Past, kterou má tenhle plán pojmenovanou:** `mlain_apply_grants()` z migrace 0005 iteruje katalog, dělá `REVOKE ALL` a rozdá `SELECT, INSERT, UPDATE, DELETE` na všechny tabulky. Migrace 0017 proto musí `automation_versions` doplnit do seznamu výjimek **uvnitř té funkce**. Jinak by první další migrace, která funkci znovu zavolá (0009 to už jednou udělala), neměnnost tiše vrátila zpátky. Prakticky to znamená, že 0017 bude **třetí úplná kopie** té funkce (asi 180 řádků). Do úkolu patří výslovný krok „vzít tělo z 0009, udělat diff, přidat jen vyjmenované bloky".

### D2. Naplánovaný krok je řádek v tabulce, ne pg-boss job s odloženým spuštěním

Tohle je nejdůležitější rozhodnutí celého plánu, protože se z něj odvíjí všechno ostatní.

pg-boss 12 odložené spuštění umí a transakční vkládání s `start_after = now() + make_interval(...)` je v repozitáři na šesti místech. Technicky by čekání tři měsíce fungovalo. Přesto to nestačí, a to ze čtyř nezávislých důvodů:

1. **Produkt se musí na čekající umět zeptat.** Obrazovka scénáře má ukázat „ve kroku 3 čeká 412 lidí, nejbližší pokračuje za 2 dny". To je `SELECT count(*) ... WHERE status = 'scheduled' GROUP BY node_id`. Nad `pgboss.job` je to dotaz do cizího schématu přes JSONB payload, tedy konstrukce, kterou by nikdo neudržoval.
2. **Čekání se musí dát zrušit adresně.** Odhlásí-li se kontakt, ukončí-li se scénář, vyřadí-li se verze nebo smaže-li se kontakt, je potřeba zrušit přesně jeho naplánované kroky. Nad tabulkou je to `UPDATE ... WHERE run_id = $1 AND status = 'scheduled'`. Nad pg-boss by to znamenalo mazat cizí řádky podle singleton klíče a handler by stejně musel stav znovu ověřovat, takže tabulka by musela existovat i tak. Dvě pravdy vedle sebe se rozejdou.
3. **Životnost jobu není záruka.** `pgboss.job` je partitionovaná tabulka s archivací a mazáním, kterou spravuje pg-boss sám. Job, který má ležet tři měsíce, je vystavený každé změně politik údržby a každé budoucí migraci pg-bossu. Tichý úklid tří měsíců naplánovaných odeslání je přesně ta třída chyby, která se pozná až u zákazníka.
4. **Repozitář to už takhle dělá dvakrát.** `domain.recheck` plánuje přes `sender_domains.next_check_at` a `platform.webhook_deliver` přes `webhook_deliveries.next_attempt_at`, obojí s cronovým skenem a `retryLimit: 0`, protože opakování řídí aplikace. Automatizace je třetí případ téhož vzoru.

pg-boss tedy zůstává, ale jen na **krátkou práci**: `automations.tick` (cron), `automations.run_due` (dávka splatných kroků jednoho projektu), `automations.evaluate_triggers` (jedna událost), `automations.cancel_runs` (hromadné ukončení), `automations.sweep` (osiřelé běhy a vyčerpané pokusy). Žádný z nich nemá `start_after` delší než minuty.

**Oprava proti první verzi tohoto plánu: přesnost čekání je jedna minuta, ne 30 sekund.** pg-boss 12.26.3 vkládá cronový tik se `singletonSeconds: 60` a `shouldSendIt()` propustí jen `prevDiff < 60` (`timekeeper.js:139,149`). Šestipolový výraz `*/30 * * * * *` tedy **tiká jednou za minutu**, ne dvakrát. Týká se to i dnešního `campaign.watchdog` a `campaign.scheduler` a je to samostatný nález mimo tenhle plán. Praktický důsledek: `automations.tick` má cron `* * * * *`, přesnost čekání je minuta, a UI píše „odešle se přibližně za 2 dny", ne přesný čas.

### D3. Motor je dvoutaktní sken pod dvěma DB rolemi, se sloupcovým grantem

Sken splatných kroků musí být napříč projekty, jinak by cron v instalaci s 200 projekty pustil 200 dotazů za minutu. Aplikační role `mlain_app` ale bez `mlain.workspace_id` vrátí nula řádků **bez chyby** (doloženo komentářem v `campaigns/jobs/system-deps.ts`).

Řešení je hotový vzor z `campaign.watchdog`:

1. `automations.tick` (cron `* * * * *`) pod `mlain_maintenance` vrátí **jen seznam `workspace_id`**, a to z tabulky joinované na `workspaces` (jinak by motor točil naprázdno v měkce smazaném projektu, viz D29).
2. Pro každý projekt zařadí `automations.run_due`.
3. `automations.run_due` běží pod `withWorkspace(createSystemContext(workspaceId, 'automations.run_due'), ...)`, tedy pod RLS.

**Grant je sloupcový a je to bezpečnostní rozhodnutí, ne detail.** `automation_run_steps` je první tabulka s per-kontaktními daty, kterou by role `mlain_maintenance` viděla napříč projekty, a komentář v `0009_maintenance_scan.sql` říká doslova, že „kontakty, zprávy, souhlasy ani audit tahle role nevidí a vidět nesmí". Grant proto pokrývá jen to, co sken potřebuje:

```sql
GRANT SELECT (id, workspace_id, status, due_at, claim_expires_at)
  ON automation_run_steps TO mlain_maintenance;
CREATE POLICY maintenance_scan ON automation_run_steps
  FOR SELECT TO mlain_maintenance USING (true);
```

`FOR SELECT` je povinné: bez něj je politika `FOR ALL` a role by dostala právo mazat. Grant i politika musí být obojí, jedno bez druhého nefunguje (grant chybí → `permission denied`, politika chybí → nula řádků), a `grants.test.ts` páruje obojí v obou směrech.

### D4. Krok se claimuje podmíněným UPDATE, dokončuje se podmíněně na vlastní claim, a reaper je součástí claimu

Dávka se bere tak, jak si sender bere zprávy z outboxu:

```sql
WITH due AS (
  SELECT id FROM automation_run_steps
   WHERE workspace_id = $1
     AND (   (status = 'scheduled' AND due_at <= now())
          OR (status = 'running'   AND claim_expires_at < now()) )
   ORDER BY due_at, id
   LIMIT $2
   FOR UPDATE SKIP LOCKED
)
UPDATE automation_run_steps s
   SET status = 'running', claimed_at = now(),
       claim_expires_at = now() + make_interval(secs => $3),
       attempts = s.attempts + 1, updated_at = now()
  FROM due
 WHERE s.id = due.id
RETURNING s.*, s.claim_expires_at AS claim_token
```

Tři věci, které se z toho nesmí ztratit:

1. **Vracení zaseknutých kroků je součástí claimu**, ne samostatný reaper. Ubyl tím jeden cron a jedna závodní situace. Samostatný job `automations.sweep` zbývá jen na dvě věci: překlopit kroky s `attempts > AUTOMATION_MAX_STEP_ATTEMPTS` na `failed` a najít osiřelé běhy (viz D30).
2. **Claim je vlastní, samostatně commitnutá transakce.** Kdyby byl ve stejné transakci jako zpracování, rollback jednoho kroku by vrátil i claim a druhý běžec by krok vzal souběžně.
3. **Každý krok se pak zpracovává ve vlastní transakci** a dokončovací `UPDATE` je podmíněný na vlastní claim:
   ```sql
   UPDATE automation_run_steps
      SET status = $2, outcome = $3, completed_at = now(), ...
    WHERE id = $1 AND status = 'running' AND claim_expires_at = $4
   ```
   Vrátí-li nula řádků, znamená to, že claim mezitím vypršel a krok převzal někdo jiný. Transakce se **zruší celá**, tedy i vložená zpráva. Bez téhle podmínky by dávka 200 kroků, která přeteče `AUTOMATION_STEP_CLAIM_TTL_SECONDS`, poslala část e-mailů dvakrát. Právě proto je výchozí dávka 50, ne 200, a TTL 300 sekund, ne 120.

### D5. Odesílání ze scénáře jde týmž outboxem, obsah nese skrytá hlavičková kampaň ve stavu `draft`

Specifikace v části 4a říká, že opakované a průběžné rozesílky se řeší novými řádky `campaigns` s odkazem na rodiče. Plán to bere vážně, ale musí to sladit se třemi tvrdými fakty z kódu:

1. **Sender čte obsah výhradně z `campaigns`.** `StmtCampaignHeader` tahá šestnáct sloupců. Druhý typ hlavičky by znamenal druhou cache, druhé `PrepareHeader` a druhou sadu validací V1 až V5, tedy řádově víc práce než celý claim.
2. **Kampaň ve stavu `sending` si nelze držet trvale.** `campaign.watchdog` ji po deseti sekundách ticha v outboxu uzavře do `sent`, a `sent` je ve stavovém stroji absorpční (`sent: []`).
3. **`fk_messages__campaign_audience` váže `created_at` zprávy na `audience_built_at` kampaně** pro každou zprávu s `kind = 'campaign'`. Průběžný proud zpráv pod jedním řádkem kampaně by musel mít navěky jedno `created_at`, tedy jeden měsíční oddíl a jeden kontakt nejvýš jednou za celý život scénáře.

Zvažoval jsem **mikrokampaně**, tedy nový řádek `campaigns` na každý tik a uzel, s `parent_campaign_id` přesně podle části 4a. Bylo by to bez jediné změny v Go a bez sahání na kontrakt. **Zamítnuto kvůli velikosti obsahu:** každá mikrokampaň by nesla vlastní kopii `compiled_html`, tedy typicky 50 až 200 kB. Uzel odesílající každou minutu by za den vyrobil až 1 440 kopií, tedy stovky megabajtů denně. Cesta, kterou specifikace popisuje pro **opakovanou dávkovou kampaň** (několik běhů za rok), se na průběžný proud přenést nedá, a je poctivější to říct nahlas než to zkusit.

**Zvolené řešení:** jeden řádek `campaigns` na **e-mailový uzel jedné publikované verze**. Vzniká při publikování, obsah se do něj zapíše jednou a už nikdy se nemění.

| Vlastnost | Hodnota | Proč |
|---|---|---|
| `kind` | `'system'` | výčet `ck_campaigns__kind` se nemění a jedenáct existujících míst, která systémové kampaně filtrují, je odstíní |
| `status` | `'draft'` napořád | jediný stav, který obchází watchdog, `stall_watch`, scheduler i `pauseAllForProvider`. Přesně tak funguje doručovací e-mail formulářů |
| `audience_built_at` | `NULL` | žádné materializované publikum neexistuje, `refresh_campaign_progress` řádek proto nevidí |
| `name` | `<jméno scénáře> · v<číslo verze> · <popisek uzlu>` | nikde se nevypisuje, ale časová osa ho čte jako název „kampaně" u odeslání, otevření a prokliku, takže musí dávat smysl člověku a musí rozlišovat verze |
| `revision` | `1`, nikdy se nemění | obsah je vázaný na verzi a verze je neměnná. Tím mizí celá třída chyb se zastaralou cache hlavičky |
| `provider_id`, `sender_identity_id`, `from_*`, `reply_to`, `unsubscribe_list_id`, `track_opens`, `track_clicks` | **z konfigurace uzlu**, povinné při publikování | viz D19 |
| vazba na uzel | tabulka `automation_emails` | vazba přes jméno kampaně, jak to dnes dělá `delivery-email.ts`, je v tom souboru sama označená za obcházení chybějícího sloupce |

Odkaz na rodiče podle části 4a tedy existuje, jen nevede přes `parent_campaign_id`, ale přes `automation_emails.version_id`. Sloupec `parent_campaign_id` tenhle plán nezavádí, protože by měl jediného uživatele a duplikoval by mapovací tabulku.

**Hlavičkové kampaně vyřazených verzí se nemažou**, dokud na ně odkazují zprávy. Uklidí je táž retence, která odpojuje oddíly `messages`. Deset publikování kvůli překlepům znamená deset kopií zkompilovaného HTML, tedy jednotky megabajtů, což je přijatelné.

### D6. Zprávy ze scénáře nesou `messages.kind = 'automation'`, ne `'test'`

Testovací větev by fungovala hned a bez dotyku kontraktu. Přesto je to špatně, a to ze tří důvodů, které se projeví až v provozu:

1. **Časová osa.** `reports/timeline/branches.ts` filtruje `m.kind = 'campaign'`, takže zpráva s druhem `test` se v ose kontaktu **neobjeví vůbec**. Skrytost je u testovacího odeslání úmysl, u automatizace vada.
2. **Přednost v claimu.** Testovací dávka se claimuje před vším ostatním a nemá strop.
3. **Statistiky.** Druh `test` je z reportů vyloučený záměrně.

Rozšíření `ck_messages__kind` a `MESSAGE_KINDS` je změna zmrazeného kontraktu, a plán ji **nezlehčuje**: vyžaduje commit s prefixem `contract:` a souhlas vlastníků obou stran podle `.github/CODEOWNERS`. Zároveň je to přesně ta změna, kterou část 1 předem popsala jako povolenou a jejíž vzor pojmenovala.

Generovaný sloupec `audience_campaign_id` (`CASE WHEN kind = 'campaign' THEN campaign_id END`) tím dostane `NULL`, takže `fk_messages__campaign_audience` se podle MATCH SIMPLE přeskočí a `uq_messages__campaign_contact` (částečný, `WHERE kind = 'campaign'`) taky. Obojí je žádoucí: kontakt smí projít scénářem znovu a dostat týž e-mail podruhé.

**Idempotenci odeslání zajišťuje krok, ne index** (D4). Zpráva se vkládá v téže transakci, ve které krok přechází z `running` na `done`, a ten přechod je podmíněný na vlastní claim.

**Vedlejší důsledek, který musí padnout vědomě (viz O8):** segmentové podmínky typu „za 90 dní nic neotevřel" se ptají nad `messages` a `message_events` **bez filtru na `kind`** (`segments/compile/engagement-event.ts`). Po zavedení nového druhu do nich začnou vstupovat i automatizační e-maily, což změní výsledky existujících segmentů u všech zákazníků, a uzel `condition` uvidí e-mail, který mu tentýž scénář poslal o krok dřív.

### D7. Sender dostane třetí claim větev, ale bez rotace podle projektu

Větev je kopie `StmtClaimTestBatch` s `m.kind = 'automation'`. Doložený odhad podle testovací větve: 80 řádků produkčního Go a 100 řádků testů, kde šablonou je `claim_test_message_test.go`.

Tři odchylky od kopie:

1. **Priorita.** Automatizační dávka jde až za testovací a má vlastní strop `SENDER_AUTOMATION_BATCH_SIZE` (výchozí 50), aby uvítací e-maily chodily rychle a zároveň nevyhladověly běžící kampaň.
2. **Rotace podle projektu se v prvním kroku NEDĚLÁ.** První verze plánu ji chtěla. Recenze ukázala, že `outbox.Rotation.Set()` bere `[]ActiveCampaign`, ne seznam projektů, takže by šlo o nový typ, nový sken „projekty s čekajícími automatizačními zprávami", nový index a dvouúrovňové `exhausted`. Odhad „60 řádků" byl optimistický. Kopie testovací větve s vlastním stropem stačí, dokud nemá instalace víc projektů s velkými scénáři. Zapsáno v kapitole 10 jako odložená položka s podmínkou, kdy se má dodělat.
3. **Revize se vrací přímo z dotazu.** `Job.Revision` se dnes plní z mapy naplněné jen běžícími kampaněmi, takže u kampaně mimo `ActiveCampaigns` vyjde nula. Protože `revision` hlavičkové kampaně je konstantní (D5), nezpůsobilo by to zastaralý obsah, ale způsobilo by to opakované načítání hlavičky. `JOIN campaigns c` v UPDATE už je, takže přidat `c.revision` do `RETURNING` je jeden řádek.

### D8. Uzly prvního kroku: čekání, podmínka, odeslání e-mailu, štítek, konec

| Uzel | V prvním kroku | Proč |
|---|---|---|
| `trigger` | ano | vstupní bod, jeden na verzi |
| `wait` | ano | pevná doba (minuty až dny) nebo „počkej do konkrétní hodiny ve všední den", což je jediný způsob, jak zabránit odeslání ve tři ráno |
| `condition` | ano | dvě výstupní hrany `yes` a `no`, predikát je segmentový AST (D9) |
| `send_email` | ano | jádro produktu |
| `add_tag`, `remove_tag` | ano | bez nich nemá podmínka co číst o vlastním scénáři. **Volají `addTagsToContact` a `removeTagFromContact` z domény kontaktů**, ne vlastní `INSERT`, jinak by se obešel `TAG_LIMIT_PER_CONTACT = 50` |
| `exit` | ano | explicitní konec s důvodem, který se ukáže v ose |
| `wait_until_event` | **ne** | čekání na událost s časovým limitem znamená druhý druh splatnosti kroku a druhý index |
| `ab_split` | **ne** | A/B je v MVP 2 samostatná funkce s vlastními statistikami. Rozdělit provoz jde i podmínkou |
| `add_to_list`, `unsubscribe` | **ne** | zásah do souhlasů, který si žádá vlastní auditní a GDPR rozvahu |
| `webhook`, `http_request` | **ne** | odchozí volání na cizí adresu je SSRF plocha |
| `goal` a konverze | **ne** | vyžaduje konfiguraci konverzních událostí a atribuční okno (část 5, 3.11) |

### D9. Podmínka je segmentový AST, lidský popis k ní napíše člověk při publikování

Predikát podmínky se neduplikuje. Uzel `condition` nese `SegmentAst` a vyhodnocuje se dotazem, který obalí kompilátor části 2:

```ts
const compiled = await compileAudienceToSql(ctx, { ast }, { alias: 'a', paramOffset: 0, asOf, timezone });
const params = [...compiled.params, contactId];
const sql = `SELECT EXISTS (SELECT 1 FROM (${compiled.sql}) m WHERE m.contact_id = $${params.length}::uuid) AS matched`;
await tx.execute(toSql(sql, params));
```

Zabalení do poddotazu je záměr, ne kosmetika: konkatenace `AND a.id = $N` na konec sice dnes vyjde (obálka končí `AND (…)` a nemá `ORDER BY` ani `LIMIT`), ale spoléhá to na vnitřní tvar cizí funkce. Identifikátor kontaktu se do dotazu dostává **výhradně jako parametr** přes `toSql`, nikdy konkatenací.

Zbývá otázka „proč se to stalo". Funkce, která by ze segmentového AST vyrobila českou větu, v repozitáři **není** (ověřeno). Napsat generátor vět nad devíti druhy podmínek a čtyřiceti operátory, ve dvou jazycích a se správnými pády, je samostatná funkce, a její výstup by stejně byl horší než jedna věta od člověka, který scénář stavěl.

**Rozhodnutí: každý uzel `condition` má povinný popisek `label`, který se při publikování zmrazí do grafu verze.** Builder ho předvyplní (na klientovi, protože `field-catalog.ts` a `operator-matrix.ts` žijí v `apps/web`), uživatel ho smí přepsat. Publikování bez popisku je `422 automation_graph_invalid` s ukazatelem na konkrétní uzel. Totéž platí pro popisky obou větví.

### D10. Spouštěče prvního kroku a místa, kde se vyhodnocují

| Spouštěč | Kde se zavěsí | Poznámka |
|---|---|---|
| `list_subscribed` | port `emit` v `confirm-service.ts` **a** `subscribe-service.ts` | vedou tam dvě cesty, obě končí `emit('contact.subscribed')`. Zavěsit jen na jednu je tichá polovina funkce. Pozor: port `emit` otevírá **vlastní** transakci po commitu přihlášení, takže zařazení jobu není ve stejné transakci jako zápis. Je to přijatelné (job je idempotentní), ale plán to nesmí tvrdit jinak |
| `web_event` podle jména | `tracking/ingest/event-process.ts` | jméno události se ve smyčce `latestByContact` ztrácí, takže se musí jít přes pole `inserted`. Zařazení jde do téže transakce a **za** stávající branku `if (isImport) return;` |
| `message_opened`, `message_clicked` | `tracking/jobs/process-engagement.ts` | výhradně na `transition.firstHumanOpen` a `firstHumanClick`. Každé otevření by scénář spouštělo opakovaně a Apple proxy by ho spouštělo bez člověka |
| `manual` | `POST /automations/{id}/enroll` | ruční nebo API vstup, nutný pro odzkoušení scénáře |

Vyhledání se nedělá skenem všech scénářů: publikování zapíše do `automation_triggers` řádek s `type` a `match_key`, a job sáhne indexem.

**Levná brána proti zahlcení fronty.** Bez ní by každá webová událost identifikovaného kontaktu zakládala job i v projektu, který žádnou automatizaci nemá. Funkce `enqueueAutomationTrigger` proto drží v procesu cache s minutovou platností „má tenhle projekt aktivní spouštěč tohohle typu", plněnou jedním indexovaným dotazem. Varovný precedens je v repu: `segments.recalc_for_contact` má živého producenta, žádnou obsluhu, žádný singleton, a úlohy se hromadí.

**Spouštěč se nesmí spustit vlastním výstupem.** `message_opened` a `message_clicked` s `match_key = NULL` by reagovaly i na zprávy, které poslal tentýž scénář, a s `entry_policy = 're_enter'` by vznikla smyčka přes příjemce, kterou brána na cykly v grafu nevidí, protože vede mimo graf. `evaluate_triggers` proto zprávy, jejichž kampaň patří témuž scénáři, vylučuje (join na `automation_emails`).

**Segmentový spouštěč („kontakt vstoupil do segmentu") v prvním kroku není** a je to vědomé. Dynamický segment se nematerializuje, `segment_members` se plní jen u statických, a fronta `segments.recalc_for_contact` má producenta bez obsluhy. „Vstup" tedy není z čeho odvodit bez nové tabulky členství. Vedlejší přínos odkladu je v pojistkách, viz D18.

### D11. Vstup do scénáře je chráněný částečným unikátním indexem, ne kontrolou v aplikaci

```sql
CREATE UNIQUE INDEX uq_automation_runs__open
  ON automation_runs (automation_id, contact_id) WHERE ended_at IS NULL;
```

Dva souběžné spouštěče se tím srazí na `23505` (čte se přes `pgErrorCode`, ne přes `err.code`) a druhý vstup se zahodí. Kontrola dotazem před vložením by tenhle závod nechytila.

Politika opakovaného vstupu je na scénáři: `entry_policy = 'once'` (existuje-li jakýkoliv dřívější běh, další vstup se zahodí) nebo `'re_enter'` s povinnou prodlevou `re_entry_cooldown_hours > 0` od konce posledního běhu.

**Nevpuštění se zapisuje, nezahazuje se tiše.** Nejčastější dotaz podpory není „proč mu přišel e-mail", ale „proč mu nepřišel". `evaluate_triggers` proto zapíše `web_events` s názvem `automation_entry_skipped` a lidským důvodem (`already_running`, `entry_policy_once`, `cooldown`, `not_eligible`), s deduplikací na dvojici kontakt a den, aby to neplnilo osu. Bez toho se na tu otázku nedá odpovědět vůbec.

### D12. Publikování má sedm tvrdých bran

Graf se validuje při publikování, ne za běhu.

1. právě jeden `trigger`, všechny uzly z něj dosažitelné,
2. žádný uzel bez cesty k `exit` (jinak běh uvízne v `running` navždy),
3. **každý cyklus v grafu obsahuje `wait` s dobou nejméně `AUTOMATION_MIN_WAIT_SECONDS`** (výchozí 60), jinak scénář s cyklem vytočí procesor a rozešle tisíce e-mailů za minutu,
4. každý `condition` má popisek a obě hrany (D9), jeho AST projde `SegmentAstV1.parse` **a `assertWithinLimits` z `segments/limits.ts`**. Bez druhé kontroly by graf se 100 uzly po 256 kB AST publikování prošel a selhal až u každého kontaktu, pětkrát,
5. **každý `send_email` projde `preSendCheck` bez jediného nálezu se `severity: 'error'`.** První verze plánu tu měla jen „compileTemplate bez tvrdých nálezů", což je jiná funkce a **nekontroluje odhlašovací odkaz**. Chybějící odhlašovací odkaz je právní vada, ne kosmetika, a sender ji nechytí: `PrepareHeader` pustí i prázdný předmět a prázdné tělo,
6. **každý `send_email` má úplnou odesílací konfiguraci** (D19) a odkazovaný provider je ve stavu, ze kterého se dá odesílat (ne `blocked`, má produkční přístup, `sending_enabled`),
7. **všechny odkazy ze zmrazeného grafu existují**: šablona, seznam pro odhlášení, štítky, segmenty a kontaktní pole uvnitř podmínek. Graf se 100 uzly nejvýš (`AUTOMATION_MAX_NODES`).

Druhá pojistka je za běhu: `automation_runs.step_count` se stropem `AUTOMATION_MAX_STEPS_PER_RUN` (výchozí 500). Statická brána chytá chyby návrhu, běhový strop to, na co brána nestačí.

### D13. Časová osa má dva zdroje, zapisuje se do ní úsporně

Trvalý záznam „proč" je `automation_run_steps.outcome`. Časová osa je jeho **projekce**, ne originál, protože `web_events` podléhají `TRACKING_RETENTION_MONTHS`.

**Do osy se nezapisuje každý krok.** Kontakt ve třech scénářích po patnácti krocích by dal 45 položek osy. Zapisuje se: vstup (`automation_entered`), nevpuštění (`automation_entry_skipped`), odeslání nebo jeho přeskočení (`automation_step`), ukončení (`automation_exited`). Uzly `wait`, `add_tag` a `remove_tag` se do osy nepíšou, zůstávají v detailu běhu.

Zapisuje se stávající funkcí `insertWebEvents`, která zároveň doplní `web_event_months`, bez čehož by osa položky nenašla. Její typ `WebEventInsert.source` je dnes literál `'email'` a musí se rozšířit na union.

Čtení: `webEventBranch` dnes vrací natvrdo `source: 'web'`, změní se na skutečnou hodnotu ze sloupce. `messageBranch` a `messageEventBranch` rozšíří filtr na `m.kind IN ('campaign','automation')` a přidají `c.kind` do projekce. Protože hlavičková kampaň má `kind = 'system'`, pozná se automatizační původ **bez jediného joinu navíc** a položka dostane typ `automation_email_sent` místo `message_sent`.

**Věty patří do `packages/i18n/messages/{cs,en}/reports.json`, ne do `automations.json`.** Překladač časové osy je scopovaný prefixem `reports.` (`contact-timeline.routes.ts:96`), takže klíč `timeline.item.automationEntered` uložený v `automations.json` by se hledal jako `automations.timeline.item.…` a nikdy by se nenašel. Do `automations.json` patří texty obrazovek, ne osy.

**Pozor na strop.** `messageBranch` má natvrdo `LIMIT 500`. Po rozšíření filtru o něj bude soupeřit víc řádků a u aktivního kontaktu ve třech scénářích se starší kampaňové e-maily z osy vytratí. Je to přijatelné, ale patří to do rizik.

### D14. Co se zapisuje ke každému kroku, aby šlo „proč" napsat větou

`outcome` je jsonb s pevným tvarem podle druhu uzlu. **Neukládají se do něj lidské popisky ani osobní údaje, jen identifikátory a kódy.** Popisky se dohledávají z `automation_versions.graph` až při čtení, a to je bezpečné, protože `automation_runs.version_id` má `ON DELETE RESTRICT` a `DELETE` na verzích je aplikační roli odebraný (D1): verze běhu je vždycky naživu.

```jsonc
// condition
{ "kind": "condition", "node_id": "cond_1", "result": true, "branch": "yes",
  "evaluated_at": "2026-08-05T09:12:04Z" }

// wait
{ "kind": "wait", "node_id": "wait_1", "scheduled_for": "2026-08-08T09:12:04Z",
  "shifted_to_window": true, "timezone": "Europe/Prague" }

// send_email
{ "kind": "send_email", "node_id": "mail_1", "campaign_id": "…", "message_id": "…" }

// přeskočené odeslání
{ "kind": "send_email", "node_id": "mail_1", "skipped": true,
  "skip_reason": "suppressed" }
```

První verze plánu tady měla volný text (`"label": "Splnil podmínku Diagnóza obsahuje onkologie"`). Zamítnuto: popisek píše uživatel, takže se do něj přirozeně dostane osobní i citlivý údaj, a ve spojení s `contact_id` je to profilování. Tvrzení „osobní údaje se sem nezapisují" by přitom nešlo vynutit žádným testem. Dohledání z grafu má tuhle vlastnost zadarmo a navíc opraví popisky zpětně, když se změní překlep.

**Věta se pak skládá takto:** `outcome.node_id` → uzel v `graph` → `label` a `branchLabels` → ICU zpráva se sloty. Pro každý `skip_reason` existuje klíč v katalogu, nikdy se neukazuje kód.

`automation_runs.trigger_ref` je omezený zod schématem na identifikátory (typ spouštěče, `list_id`, jméno události, `message_id`), nikdy do něj nejde payload události.

### D15. Pozastavení a smazání scénáře působí na běhy, ne na už odeslané zprávy

| Akce | Běhy | Naplánované kroky | Čekající zprávy |
|---|---|---|---|
| **Pozastavení** | zůstávají | `run_due` je přeskočí (ověří stav scénáře při claimu) | `pending` → `skipped` s `error_code = 'automation_paused'` |
| **Obnovení** | pokračují | splatné se odbaví, ale **kroky splatné o víc než `AUTOMATION_CATCHUP_HOURS` (výchozí 24) se přeskočí** s `skip_reason = 'stale_after_pause'` a běh pokračuje dál | nic |
| **Smazání** | soft delete, otevřené běhy končí s `exit_reason = 'automation_deleted'` | zruší se | → `skipped` |
| **Nové publikování** | běhy staré verze **běží dál ve staré verzi** | beze změny | beze změny |
| **Vyřazení verze** | běhy končí s `exit_reason = 'version_retired'` | zruší se | → `skipped` |

Doháněcí okno je nutné a je to tatáž rozvaha jako stav `schedule_missed` u kampaní. Přeskočené kroky se zapisují do osy s vysvětlením, takže to není tiché.

Hromadné ukončení běží v jobu `automations.cancel_runs`, ne v HTTP požadavku.

**Publikování musí vyřadit spouštěč předchozí verze.** `uq_automation_triggers__version` je jeden řádek na verzi a index hledá `WHERE active`. Bez explicitního kroku by po publikování verze 4 zůstal aktivní i spouštěč verze 3 a kontakty by vstupovaly podle toho, co dřív vrátí index. Publikování proto v téže transakci nastaví staré verzi `state = 'retired'` a jejímu spouštěči `active = false`, ale **běhy staré verze nechává doběhnout** (to je rozdíl proti ručnímu „vyřadit verzi", které je ukončí).

### D16. Způsobilost se ověřuje před každým krokem a je popsaná v kapitole 6

První verze plánu tvrdila, že se použije „týž predikát, jaký používá materializace kampaní", a jmenovala jen obálku segmentového kompilátoru a suppression. To je **o čtyři vrstvy méně**, než co materializace skutečně dělá. Úplný předpis je v kapitole 6 a je závazný.

Dvě rozhodnutí o rozsahu:

1. **Způsobilost se ověřuje před každým krokem, ne až před odesláním.** Obálka kompilátoru sama odečítá suppression, `deleted_at`, `processing_restricted` a spol., takže potlačený člověk neprojde **žádnou** podmínkou a odešel by větví „ne". Osa by pak napsala „Nesplnil podmínku Štítek obsahuje VIP", což je nepravda. Nezpůsobilost se proto vyhodnocuje dřív a zapisuje jako vlastní `outcome`, ne jako nesplněnou podmínku.
2. **Potlačená adresa, neaktivní stav, omezené zpracování nebo smazání ukončí celý běh**, ne jen přeskočí odeslání. Scénář, který dál vyhodnocuje podmínky nad odhlášeným člověkem, jen spotřebovává výkon. Odhlášení z jednoho seznamu běh **neukončí**, jen zablokuje uzly, jejichž `unsubscribe_list_id` na ten seznam míří.

Smazání kontaktu je `ON DELETE CASCADE`. Anonymizace kontakt nemaže, proto `gdpr.sever_links` dostane šestý krok: otevřené běhy se ukončí s `exit_reason = 'contact_erased'` a `trigger_ref` se vyprázdní.

### D17. Nová oprávnění kopírují model kampaní, `events:import` se zavádí zvlášť

| Klíč | Role | Podle vzoru |
|---|---|---|
| `automations:read` | viewer | `campaigns:read` |
| `automations:write` | editor | `campaigns:write` |
| `automations:publish` | editor | `campaigns:send` |
| `automations:control` | editor | `campaigns:control` (pozastavení, obnovení, ruční vstup) |
| `automations:delete` | **admin** | `campaigns:delete`. **Sem patří i vyřazení verze**, protože ukončí i sto tisíc běhů, což je destruktivnější než měkké smazání scénáře |
| `events:import` | **admin** | nový klíč podle části 5, 12.5.20 |

`events:import` je v editorské roli schválně ne: dávkový import obchází sedmidenní okno, zapisuje do historických oddílů a nesmí spouštět automatizace. Endpoint `POST /api/v1/events/import` dnes **neexistuje** a tenhle plán ho nestaví, jen zavádí klíč, aby ho automatizační pojistka mohla vyžadovat, až ta cesta vznikne. **Do té doby se klíč nesmí dát vydat jako scope API klíče**, jinak by klíč vydaný dnes tiše ožil v den, kdy endpoint vznikne. Řeší se výčtem v UI vydávání klíčů, ne vyřazením z `PERMISSIONS`.

**Ruční vstup má audit, idempotenci a strop.** Je to zápisová operace, po které někomu odejde pošta, a `automations:control` je zároveň platný scope API klíče. Endpoint proto vyžaduje hlavičku `Idempotency-Key` (vzor `contacts.routes.ts:233`), má strop kontaktů na požadavek, zapisuje auditní akci `automation.enrolled` s `contact_id` a `automation_id`, a **prochází touž politikou vstupu i touž způsobilostí jako spouštěče**. Ruční vstup není cesta, jak obejít souhlas.

### D18. Import nespouští automatizace, a hlídají to tři vrstvy

Část 5 to označuje za nejnebezpečnější vlastnost celé importní cesty.

1. **Strukturálně.** Vyhodnocení se zařazuje jen ze čtyř vyjmenovaných míst (D10). Import kontaktů zapisuje `list_subscriptions` přímo přes `applyRowExtras` a `emit('contact.subscribed')` nevolá, takže se ho zavěšení netýká. V ingestu událostí navíc **už dnes** stojí branka `if (isImport) return;` a zařazení se dává za ni.
2. **Kontrolou dat.** `evaluate_triggers` odmítne payload se `source` mimo množinu `web`, `server`, `email`, `automation`. Je to záchytná síť, ne brána: nový volající prostě napíše `source: 'server'`. Plán to tak popisuje a nespoléhá na to.
3. **Testem.** Test hlídá, že **exportovaná funkce `enqueueAutomationTrigger`** se volá pouze z vyjmenovaných souborů. První verze plánu chtěla grepovat jméno fronty, jenže to se vyskytuje jen uvnitř `triggers/enqueue.ts` a každý nový volající by testu byl neviditelný.

**Díra, kterou první verze plánu neviděla:** `POST /lists/{id}/subscribe:bulk` (strop 1000 kontaktů na požadavek, oprávnění `lists:write`, tedy editor) volá `subscribeToList` v cyklu, tedy přímo to místo, na které se zavěšuje. Migrace zákazníka přes API by rozeslala přesně to, čemu má pojistka zabránit. Řeší se D28.

**Nepřímé spuštění přes přepočet segmentů je v prvním kroku vyloučené z podstaty**, protože segmentový spouštěč neexistuje (D10). Až přijde, musí `segments.recalc_for_contact` nést příznak původu. Zapsáno jako O4.

### D19. Uzel `send_email` nese úplnou odesílací konfiguraci a snímek obsahu

První verze plánu tohle neřešila a byla to největší díra. Sender čte z hlavičky šestnáct sloupců, `campaigns.provider_id` je nullable a `unsubscribe_list_id = NULL` znamená v senderu **globální odhlášení místo odhlášení ze seznamu**. Obezlička z formulářů (identita z poslední uživatelské kampaně) je pro scénář běžící měsíce nepoužitelná a je v tom souboru sama označená za nouzové řešení.

Uzel `send_email` proto povinně nese: `providerId`, `senderIdentityId`, `fromName`, `fromEmail`, `replyTo`, `unsubscribeListId`, `trackOpens`, `trackClicks`, a **snímek dokumentu šablony**, ne jen `templateId`.

Snímek je podstatný: `campaigns.template_id` má `ON DELETE SET NULL`, takže smazání šablony by rozbilo opětovné publikování a náhled běžící verze. `templateId` zůstává v grafu jako reference pro UI („z které šablony to vzniklo"), ale zdrojem pravdy pro kompilaci je zmrazený `design`.

**Kompilace probíhá při publikování, ne při odeslání.** Publikování pro každý `send_email` uzel zavolá `compileTemplate` s `purpose: 'send'` a `campaignId` hlavičkové kampaně, uloží `compiled_html`, `compiled_text`, `compiled_hash`, `compile_meta`, `compiled_fields`, a přepíše `campaign_links` z `CompileMeta` doslova (identifikátory ani pozice se nedopočítávají podruhé, je to rozhodnutí D17 plánu P13). Odeslání pak jen skládá `render_data` a **volá kontraktní `prepareRenderData`**, bez čehož by se v odeslaných e-mailech tiše skryly všechny podmíněné bloky.

**Důsledek, který musí být v UI:** publikování nové verze je jediná cesta, jak do scénáře dostat opravený text. Tichá editace šablony pod běžícím scénářem obsah nezmění.

### D20. Plátno je jen editor, závazný je zmrazený graf ze serveru

React Flow kreslí graf a nic nevaliduje. Validace je čistá funkce v `packages/core/src/automations/graph/validate.ts`, kterou volá klient (okamžitá zpětná vazba) i server (brána publikování). Jedna kopie pravidel, dvě volání.

**Autosave draftu není bezpečnostní díra.** `graph` přichází od klienta jako jsonb. `PUT /automations/{id}/draft` proto povinně dělá `AutomationGraphSchema.parse` a má strop bajtů (`AUTOMATION_MAX_GRAPH_BYTES`), i když plnou validaci (dosažitelnost, cykly, popisky) dělá až publikování. Ukládat neparsovaný klientský jsonb by znamenalo, že se do databáze dostane cokoliv.

### D21. Náhled a testovací odeslání jsou součástí prvního kroku

Bez nich uživatel publikuje obsah, který nikdy neviděl vyrenderovaný, a publikování je jediná cesta k opravě. To je nepoužitelné.

- **Náhled uzlu z draftu**: `compileTemplate` s `purpose: 'preview'` nad snímkem dokumentu, včetně dosazených ukázkových dat kontaktu. Nezakládá hlavičkovou kampaň.
- **Testovací odeslání uzlu na vlastní adresu**: jde existující cestou `templates/test-send.ts`, tedy `messages.kind = 'test'` pod skrytou systémovou kampaní, ne automatizační cestou. Testovací mail se nesmí počítat do statistik scénáře.

### D22. Kopie scénáře a stavový stroj scénáře

**Kopie** je v repozitáři zavedený vzor (`duplicateCampaign`, `duplicateTemplate`, sdílená `copyName`, endpoint `POST /{id}/duplicate`). U entity, kterou uživatel staví desítky minut, je to samozřejmost a stojí hodinu. Kopíruje se `draft_graph`, ne verze ani běhy.

**Stavový stroj scénáře** je čtyřstavový a publikování není totéž co zapnutí:

```
draft ──publikovat──> paused ──zapnout──> active ──pozastavit──> paused
                                              └──archivovat──> archived
draft ──smazat──> (soft delete)                paused ──archivovat──> archived
```

Publikování tedy vyrobí verzi a nechá scénář **pozastavený**. Vstupy začnou až explicitním zapnutím. Je to o jedno kliknutí navíc a je to jediný způsob, jak si uživatel může scénář publikovat a ještě si ho projít, než začne rozesílat. `archived` je koncový stav pro scénáře, které se už nemají spouštět, ale jejichž historii chce uživatel vidět.

### D23. API žije v `packages/core/src/automations/api/`, ne v `apps/web/src/server/routes/`

Cesta `apps/web/src/server/routes/**` v repozitáři **neexistuje**, přestože ji plán P13 ve svém seznamu vlastnictví uvádí. Skutečná konvence je doménový sub-app v `packages/core/src/<domena>/api/index.ts` (`new OpenAPIHono<Env>({ defaultHook: validationHook })`, naplnění routeru při načtení modulu, `registerXApiRoutes(app)`), mountovaný v `apps/web/src/lib/api/openapi.ts`. P17 se drží skutečnosti.

Každý handler má jako druhý řádek `assertPermission(ctx, '…')` a každá `createRoute` má `security: [{ bearerAuth: ['…'] }]`, protože z toho vzniká OpenAPI. Šest nových klíčů oprávnění se propíše do `PermissionSchema = z.enum(PERMISSIONS)`, takže se musí přegenerovat kontrakt OpenAPI (`pnpm ci:openapi-drift`).

### D24. Fronty automatizací mají `domain: 'campaigns'`

`QueueEntry.domain` je typ `ErrorDomain`, tedy uzavřený union `'platform' | 'contacts' | 'content' | 'campaigns' | 'sender' | 'tracking'`. Hodnota `'automations'` neexistuje.

Rozšiřovat ten union znamená sáhnout na registr chybových kódů celého produktu kvůli pěti frontám. Precedens pro opak existuje: `segments.recalc_for_contact` má `domain: 'contacts'`, tedy prefix jména a doména se schválně nekryjí. Automatizace jsou z hlediska chybových domén odesílání, takže `domain: 'campaigns'`. Adresář modulu s handlerem se odvozuje jinde (`handlerModulePath` z prefixu jména), takže to nic nerozbije.

### D25. Odkaz na `messages` je bez cizího klíče a patří do registru

`automation_run_steps.(message_id, message_created_at)` je odkaz na partitionovanou tabulku podle rozhodnutí R24, tedy dvojice sloupců bez `FOREIGN KEY`. Cizí klíč tam být nesmí: nepartitionovaná tabulka s FK do `messages` by se bila s odpojováním oddílů při retenci a retenční job by nešel spustit.

`PARTITIONED_REFERENCES` v `packages/db/src/partitions.ts` se sám označuje za „ÚPLNÝ registr", takže se do něj odkaz doplňuje i s tímhle důvodem. Bez toho to při příští revizi vypadá jako opomenutí.

### D26. Do `campaigns` a `campaign_links` píše doména kampaní, ne P17

Publikování zapisuje hlavičkovou kampaň, přepisuje `campaign_links` a nastavuje `revision`. Jediný zapisovatel `campaign_links` je dnes `campaigns/repo/links.ts` a kapitola 1.2 slibuje, že P17 do domény kampaní nepíše. Aby se to pravidlo neporušilo hned první úlohou fáze B, doména kampaní vystaví zapisovací port:

```ts
upsertAutomationHeaderCampaign(tx: Tx, ctx: WorkspaceContext, input: AutomationHeaderInput): Promise<{ campaignId: string }>
```

P17 ho volá a nikdy neskládá vlastní `INSERT INTO campaigns`. Soubor je v 1.4.

### D27. Mazání odesílacího účtu musí umět uklidit automatizační hlavičky

`deleteProvider` dnes maže **natvrdo** všechny `campaigns WHERE kind = 'system'` daného providera, a před tím jejich zprávy s `kind = 'test'`. Kdyby `automation_emails.campaign_id` mělo `ON DELETE RESTRICT`, spadlo by mazání účtu na `23503` u kampaně, kterou uživatel v seznamu nevidí, a nešlo by to nijak vysvětlit.

Rozhodnutí:

- `automation_emails.campaign_id` má **`ON DELETE CASCADE`**, ne `RESTRICT`. Integritu drží aplikace, ne cizí klíč.
- `deleteProvider` dostane před mazáním kontrolu: **existuje-li publikovaná verze, která tenhle účet používá, vrátí `409`** se jménem scénáře. Účet používaný živým scénářem nejde smazat omylem.
- Po vyřazení všech verzí `deleteProvider` uklidí i zprávy s `kind = 'automation'`, stejně jako dnes uklízí testovací.

### D28. Hromadné přihlášení přes API má strop běhů

`POST /lists/{id}/subscribe:bulk` je legitimní cesta pro migraci zákazníka a nedá se zakázat. Ale tisíc `emit('contact.subscribed')` na jeden požadavek je hromadné spuštění scénáře, tedy přesně to, čemu D18 brání u importu.

Řešení není zakázat, ale zpomalit a zviditelnit: `evaluate_triggers` sleduje počet běhů založených za minutu na projekt (`AUTOMATION_MAX_ENTRIES_PER_MINUTE`, výchozí 300). Po překročení se další vstupy **odloží**, ne zahodí, a v UI scénáře svítí upozornění „hromadné přihlášení, vstupy se zpracovávají postupně". Je to táž rozvaha jako doháněcí okno: nebezpečná není práce, ale její náraz.

### D29. Měkce smazaný projekt motor nespouští

`automations.tick` běží pod `mlain_maintenance` nad `automation_run_steps` a `workspaces` musí joinovat. Projekt s vyplněným `deleted_at` (mazání je odložené, purge až po retenci) by jinak dál vyhodnocoval podmínky, přidával štítky a vkládal zprávy. Sender by je sice neodeslal (`w.deleted_at IS NULL` v claimu), ale motor by točil naprázdno a měnil data.

`run_due` navíc na začátku ověří, že projekt žije, protože mezi skenem a zpracováním může uplynout minuta.

### D30. Osiřelý běh a vyčerpané pokusy hlídá `automations.sweep`

Běh ve stavu `waiting` bez jediného kroku ve `scheduled` nebo `running` zůstane navěky s `ended_at IS NULL` a `uq_automation_runs__open` znemožní opakovaný vstup. Vzniká to přeskočením kvůli doháněcímu oknu, zrušením nebo chybou. Cronový `automations.sweep` (`*/5 * * * *`, dvoutaktní stejně jako tick) proto:

1. překlopí kroky s `attempts > AUTOMATION_MAX_STEP_ATTEMPTS` na `failed`, ukončí jejich běh a zapíše to do osy,
2. najde běhy bez živého kroku a ukončí je s `exit_reason = 'orphaned'`, se záznamem do logu, protože to je vždycky chyba motoru,
3. **odkazovaná věc zmizela** je vlastní třída výsledku, ne opakovaný pád: smazaný štítek, seznam, segment nebo kontaktní pole vede na `skipped` s lidským textem a ukončení běhu, ne na pět pokusů a `failed`.

### D31. Konfigurace: sedm nových proměnných

| Proměnná | Soubor | Výchozí | Meze | Význam |
|---|---|---|---|---|
| `AUTOMATION_TICK_BATCH_SIZE` | `schema-domains.ts` | 50 | 1–500 | kolik kroků odbaví jeden běh `run_due`, než se sám zařadí znovu |
| `AUTOMATION_STEP_CLAIM_TTL_SECONDS` | `schema-domains.ts` | 300 | 30–3600 | po jak dlouhé nečinnosti se krok vrátí |
| `AUTOMATION_MAX_STEP_ATTEMPTS` | `schema-domains.ts` | 5 | 1–20 | po kolikátém pokusu krok selže natvrdo |
| `AUTOMATION_CATCHUP_HOURS` | `schema-domains.ts` | 24 | 0–720 | jak staré splatné kroky se po obnovení ještě odbaví |
| `AUTOMATION_MIN_WAIT_SECONDS` | `schema-domains.ts` | 60 | 60–86400 | nejkratší čekání v cyklu, brána publikování |
| `AUTOMATION_MAX_ENTRIES_PER_MINUTE` | `schema-domains.ts` | 300 | 1–10000 | strop nových běhů na projekt (D28) |
| `SENDER_AUTOMATION_BATCH_SIZE` | **`schema-platform.ts`** | 50 | 1–500 | dávka třetí claim větve. Všech dvacet `SENDER_*` proměnných je tady |

Stropy `AUTOMATION_MAX_NODES` (100), `AUTOMATION_MAX_STEPS_PER_RUN` (500) a `AUTOMATION_MAX_GRAPH_BYTES` (256 kB) jsou konstanty v kódu, ne konfigurace: mění tvar dat, ne provozní chování, a měnit je za běhu instalace nedává smysl.

Tvar `envInt(min, max).default(n)` je povinný, jinak spadne `packages/core/test/config/defaults.test.ts`. Po přidání se **ručně regeneruje** `config.manifest.json` (`tsx packages/core/scripts/write-manifest.ts`) a zvýší se očekávaný počet v `manifest.test.ts`. Go strana potřebuje `SENDER_AUTOMATION_BATCH_SIZE` samostatně v `apps/sender/internal/config/config.go`, parita Node a Go se v repu nevynucuje.

---

## 3. Datový model

Schéma v `packages/db/src/schema/automations.ts`, DDL vzniká `drizzle-kit generate` do `0016_automations.sql`, ruční část je v `0017_automations_grants_rls.sql`.

> **Past, na kterou se v tomhle repozitáři už jednou naběhlo:** středník uvnitř řetězcového literálu v raw `sql` výrazu (typicky `check()`) rozbije `drizzle-kit generate`. Generátor na tom středníku uřízne celý `CREATE TABLE` a zapíše nespustitelné SQL, přestože snapshot v `migrations/meta/` má hodnotu správně a `drizzle-kit check` nic nehlásí. Potkalo to `ck_imports__delimiter`. **Žádný `CHECK` v tomhle schématu proto nesmí obsahovat středník v literálu** (ověřeno, žádný neobsahuje). Kontrola po vygenerování se nedělá grepem na `IN (')`, ten řetězec nevznikne ani v poškozené migraci: spustí se `pnpm --filter @mlain/db test:migrations`, který migraci pouští proti kontejneru, a porovná se počet `CONSTRAINT ck_` v migraci s počtem v Drizzle schématu.

> **Pozor na Drizzle:** generátor vyrábí cizí klíče jako samostatné `ALTER TABLE ... ADD CONSTRAINT` na konci souboru a pojmenovává je `automation_runs_version_id_automation_versions_id_fk`. DDL níž je psané ručně kvůli čitelnosti; vygenerovaná 0016 bude vypadat jinak a jména constraintů se musí brát z ní.

```sql
-- 1. Scénář. Drží rozpracovaný graf a politiku vstupu.
CREATE TABLE automations (
  id                      uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id            uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name                    text NOT NULL,
  description             text,
  status                  text NOT NULL DEFAULT 'draft',
  draft_graph             jsonb NOT NULL DEFAULT '{"nodes":[],"edges":[]}'::jsonb,
  current_version_id      uuid,                    -- FK doplní 0017, vzor templates/0002
  entry_policy            text NOT NULL DEFAULT 'once',
  re_entry_cooldown_hours integer,
  created_by              uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  deleted_at              timestamptz,
  CONSTRAINT ck_automations__status       CHECK (status IN ('draft','paused','active','archived')),
  CONSTRAINT ck_automations__entry_policy CHECK (entry_policy IN ('once','re_enter')),
  CONSTRAINT ck_automations__cooldown     CHECK (
    entry_policy <> 're_enter' OR (re_entry_cooldown_hours IS NOT NULL AND re_entry_cooldown_hours > 0)),
  CONSTRAINT ck_automations__name_len     CHECK (char_length(name) BETWEEN 1 AND 120),
  CONSTRAINT ck_automations__active_has_version CHECK (status = 'draft' OR current_version_id IS NOT NULL)
);
CREATE UNIQUE INDEX uq_automations__workspace_name
  ON automations (workspace_id, lower(name)) WHERE deleted_at IS NULL;
CREATE INDEX idx_automations__workspace_status
  ON automations (workspace_id, status, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_automations__created_by ON automations (created_by);

-- 2. Zmrazená verze. Neměnnost vynucuje odebraný sloupcový grant (D1).
CREATE TABLE automation_versions (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  automation_id uuid NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  version       integer NOT NULL,
  graph         jsonb NOT NULL,
  graph_hash    bytea NOT NULL,
  entry_node_id text NOT NULL,
  state         text NOT NULL DEFAULT 'live',
  published_at  timestamptz NOT NULL DEFAULT now(),
  published_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  retired_at    timestamptz,
  CONSTRAINT ck_automation_versions__state   CHECK (state IN ('live','retired')),
  CONSTRAINT ck_automation_versions__retired CHECK ((state = 'retired') = (retired_at IS NOT NULL)),
  CONSTRAINT ck_automation_versions__number  CHECK (version > 0)
);
CREATE UNIQUE INDEX uq_automation_versions__number ON automation_versions (automation_id, version);
CREATE INDEX idx_automation_versions__live      ON automation_versions (automation_id) WHERE state = 'live';
CREATE INDEX idx_automation_versions__workspace ON automation_versions (workspace_id);
CREATE INDEX idx_automation_versions__author    ON automation_versions (published_by);

-- 3. Spouštěč verze. Jeden řádek na verzi, index nese vyhledání za běhu.
CREATE TABLE automation_triggers (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  automation_id uuid NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  version_id    uuid NOT NULL REFERENCES automation_versions(id) ON DELETE CASCADE,
  type          text NOT NULL,
  match_key     text NOT NULL DEFAULT '*',   -- '*' = cokoliv. Sentinel, ne NULL, kvůli indexu
  filter        jsonb NOT NULL DEFAULT '{}'::jsonb,
  active        boolean NOT NULL DEFAULT true,
  CONSTRAINT ck_automation_triggers__type CHECK (
    type IN ('list_subscribed','web_event','message_opened','message_clicked','manual'))
);
CREATE UNIQUE INDEX uq_automation_triggers__version ON automation_triggers (version_id);
CREATE INDEX idx_automation_triggers__lookup
  ON automation_triggers (workspace_id, type, match_key) WHERE active;

-- 4. E-mailový uzel a jeho skrytá hlavičková kampaň (D5).
--    CASCADE, ne RESTRICT: deleteProvider maže systémové kampaně natvrdo (D27).
CREATE TABLE automation_emails (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  automation_id uuid NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  version_id   uuid NOT NULL REFERENCES automation_versions(id) ON DELETE CASCADE,
  node_id      text NOT NULL,
  campaign_id  uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_automation_emails__node      ON automation_emails (version_id, node_id);
CREATE UNIQUE INDEX uq_automation_emails__campaign  ON automation_emails (campaign_id);
CREATE INDEX        idx_automation_emails__workspace ON automation_emails (workspace_id);
CREATE INDEX        idx_automation_emails__automation ON automation_emails (automation_id);

-- 5. Běh kontaktu ve verzi.
CREATE TABLE automation_runs (
  id              uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  automation_id   uuid NOT NULL REFERENCES automations(id) ON DELETE CASCADE,
  version_id      uuid NOT NULL REFERENCES automation_versions(id) ON DELETE RESTRICT,
  contact_id      uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  status          text NOT NULL DEFAULT 'running',
  current_node_id text,
  step_count      integer NOT NULL DEFAULT 0,
  trigger_ref     jsonb NOT NULL DEFAULT '{}'::jsonb,
  entered_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  exit_reason     text,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_automation_runs__status CHECK (
    status IN ('running','waiting','completed','exited','failed')),
  CONSTRAINT ck_automation_runs__ended  CHECK ((status IN ('running','waiting')) = (ended_at IS NULL)),
  CONSTRAINT ck_automation_runs__reason CHECK (exit_reason IS NULL OR exit_reason IN (
    'completed','exit_node','not_eligible','unsubscribed','suppressed','contact_erased',
    'automation_deleted','version_retired','step_limit','stale_after_pause','orphaned','failed'))
);
CREATE UNIQUE INDEX uq_automation_runs__open
  ON automation_runs (automation_id, contact_id) WHERE ended_at IS NULL;
CREATE INDEX idx_automation_runs__contact ON automation_runs (workspace_id, contact_id, entered_at DESC);
CREATE INDEX idx_automation_runs__version ON automation_runs (version_id, status);
CREATE INDEX idx_automation_runs__history ON automation_runs (automation_id, contact_id, ended_at DESC);

-- 6. Kroky běhu. Naplánovaný krok je řádek tady, ne odložený job (D2).
CREATE TABLE automation_run_steps (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id       uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  run_id             uuid NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE,
  version_id         uuid NOT NULL REFERENCES automation_versions(id) ON DELETE RESTRICT,
  seq                integer NOT NULL,
  node_id            text NOT NULL,
  node_type          text NOT NULL,
  status             text NOT NULL DEFAULT 'scheduled',
  due_at             timestamptz NOT NULL,
  claimed_at         timestamptz,
  claim_expires_at   timestamptz,
  completed_at       timestamptz,
  attempts           smallint NOT NULL DEFAULT 0,
  outcome            jsonb NOT NULL DEFAULT '{}'::jsonb,
  next_node_id       text,
  message_id         uuid,               -- odkaz do messages BEZ cizího klíče, viz D25
  message_created_at timestamptz,
  error_code         text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_automation_run_steps__status CHECK (
    status IN ('scheduled','running','done','skipped','failed')),
  CONSTRAINT ck_automation_run_steps__node_type CHECK (
    node_type IN ('trigger','wait','condition','send_email','add_tag','remove_tag','exit')),
  CONSTRAINT ck_automation_run_steps__message CHECK (
    (message_id IS NULL) = (message_created_at IS NULL))
);
CREATE UNIQUE INDEX uq_automation_run_steps__seq ON automation_run_steps (run_id, seq);
-- workspace_id JE PRVNÍ SLOUPEC SCHVÁLNĚ. Claim filtruje na projekt; bez něj
-- prochází a zamyká splatné kroky všech projektů. Naměřeno na 3 M kroků
-- a 200 projektech: 166 ms a 45 000 bufferů proti 1,4 ms a 400 bufferům.
-- Je to táž past a totéž zdůvodnění jako u idx_messages__claimable.
CREATE INDEX idx_automation_run_steps__due
  ON automation_run_steps (workspace_id, due_at, id) WHERE status = 'scheduled';
CREATE INDEX idx_automation_run_steps__stuck
  ON automation_run_steps (workspace_id, claim_expires_at) WHERE status = 'running';
-- Čísla u uzlů na plátně. node_id je identifikátor UVNITŘ jednoho grafu
-- (typicky "mail_1"), takže bez version_id by se sčítaly cizí scénáře.
CREATE INDEX idx_automation_run_steps__node
  ON automation_run_steps (version_id, node_id, status);
```

Ruční část v `0017_automations_grants_rls.sql` (hlavička `-- mlain:timeout=180`):

```sql
-- Cyklický FK, vzor 0002_templates_cycle_fk.sql.
-- RESTRICT, ne SET NULL: SET NULL by u aktivního scénáře porušil
-- ck_automations__active_has_version a smazání verze by skončilo 23514
-- z hloubi kaskády. Ověřeno spuštěním na PG 18.4.
ALTER TABLE automations ADD CONSTRAINT fk_automations__current_version
  FOREIGN KEY (current_version_id) REFERENCES automation_versions(id) ON DELETE RESTRICT;
--> statement-breakpoint

-- RLS: šest tabulek, vzor doslova z 0013_sender_identities.sql
ALTER TABLE automations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY ws_isolation ON automations
  USING      (workspace_id = NULLIF(current_setting('mlain.workspace_id', true), '')::uuid)
  WITH CHECK (workspace_id = NULLIF(current_setting('mlain.workspace_id', true), '')::uuid);
--> statement-breakpoint
-- (totéž pro automation_versions, automation_triggers, automation_emails,
--  automation_runs, automation_run_steps)

-- Sken splatných kroků napříč projekty. FOR SELECT je povinné: bez něj
-- je politika FOR ALL a role by dostala právo mazat (viz komentář v rls.ts).
CREATE POLICY maintenance_scan ON automation_run_steps
  FOR SELECT TO mlain_maintenance USING (true);
--> statement-breakpoint

-- CREATE OR REPLACE FUNCTION mlain_apply_grants() ... celé tělo z 0009,
-- do kterého se přidají PRÁVĚ TYHLE DVA BLOKY:
--
--   -- neměnnost verze (D1)
--   REVOKE UPDATE, DELETE ON automation_versions FROM mlain_app;
--   GRANT UPDATE (state, retired_at) ON automation_versions TO mlain_app;
--
--   -- sloupcový grant pro sken (D3). Role mlain_maintenance nesmí vidět
--   -- obsah kroku, jen to, co potřebuje na výběr projektů.
--   GRANT SELECT (id, workspace_id, status, due_at, claim_expires_at)
--     ON automation_run_steps TO mlain_maintenance;
--> statement-breakpoint
SELECT mlain_apply_grants();
--> statement-breakpoint

-- Nový druh zprávy (D6, kontraktní změna R-C1).
-- NOT VALID + VALIDATE, ne přímé ADD CONSTRAINT: přímá cesta bere
-- AccessExclusiveLock na rodiči i všech oddílech a při 50 M zpráv
-- zmrazí outbox na desítky sekund. Naměřeno na 2 M řádcích:
-- ADD 736 ms pod AccessExclusive, proti ADD NOT VALID 21 ms
-- plus VALIDATE 584 ms pod ShareUpdateExclusive.
ALTER TABLE messages ADD CONSTRAINT ck_messages__kind_v2
  CHECK (kind IN ('campaign','test','automation')) NOT VALID;
--> statement-breakpoint
ALTER TABLE messages VALIDATE CONSTRAINT ck_messages__kind_v2;
--> statement-breakpoint
ALTER TABLE messages DROP CONSTRAINT ck_messages__kind;
--> statement-breakpoint
ALTER TABLE messages RENAME CONSTRAINT ck_messages__kind_v2 TO ck_messages__kind;
--> statement-breakpoint

-- Claim index pro třetí větev senderu. workspace_id je první sloupec ze
-- stejného důvodu jako u kroků. Vzorem NENÍ idx_messages__test_claimable
-- (ten workspace nemá, protože testovacích zpráv je zanedbatelně).
CREATE INDEX IF NOT EXISTS idx_messages__automation_claimable
  ON messages (workspace_id, next_attempt_at, id)
  WHERE status = 'pending' AND kind = 'automation';
```

**Poctivé varování k délce migrace.** Migrátor jede celou migraci v jedné transakci, takže i `VALIDATE` drží zámek do commitu. Výluka je při 10 M zpráv řádově sekundy, při 50 M desítky sekund. `CREATE INDEX` na partitionované `messages` navíc **nejde `CONCURRENTLY`** (PostgreSQL to na partitionované tabulce odmítne) a staví se plným skenem všech oddílů pod `ShareLock`, který blokuje zápis: naměřeno 455 ms na 624 MB. Tvrzení první verze plánu, že „index nad prázdnou množinou vznikne okamžitě", bylo věcně nesprávné. Do instalační dokumentace patří věta, že upgrade na tuhle verzi krátce zastaví odesílání.

**Rezervace čísel.** Poslední migrace je 0015 a v repozitáři běží paralelně další práce. Čísla 0016 a 0017 se musí zarezervovat dřív, než se začne psát, jinak vznikne konflikt v souboru, který se needituje.

---

## 4. Tvar grafu

Bez tohohle nemá realizátor hlavní datový model funkce. `graph` je jsonb validovaný `AutomationGraphSchema`.

```jsonc
{
  "version": 1,
  "nodes": [
    { "id": "trg_1", "type": "trigger", "position": { "x": 0, "y": 0 },
      "config": {
        "trigger": "list_subscribed",
        "matchKey": "6a1c…",                 // list_id, nebo "*"
        "filter": {}
      } },

    { "id": "wait_1", "type": "wait", "position": { "x": 0, "y": 120 },
      "config": {
        "mode": "duration",                   // duration | until_window
        "seconds": 259200,                    // 3 dny
        "window": { "days": [1,2,3,4,5], "fromHour": 9, "toHour": 17 },
        "label": "Počkat 3 dny"
      } },

    { "id": "cond_1", "type": "condition", "position": { "x": 0, "y": 240 },
      "config": {
        "label": "Štítek obsahuje VIP",       // POVINNÉ, viz D9
        "branchLabels": { "yes": "Ano", "no": "Ne" },
        "ast": { "version": 1, "root": { "type": "group", "op": "and", "children": [
          { "type": "condition", "field": { "kind": "tag" },
            "operator": "contains", "value": "VIP" } ] } }
      } },

    { "id": "mail_1", "type": "send_email", "position": { "x": -160, "y": 360 },
      "config": {
        "label": "Vítejte",
        "subject": "Vítejte u nás, {{ contact.greeting }}",
        "preheader": "Co pro vás máme připraveného",
        "templateId": "b21f…",                // jen reference pro UI
        "design": { /* zmrazený snímek dokumentu, viz D19 */ },
        "providerId": "9c02…",
        "senderIdentityId": "4411…",
        "fromName": "Mlain",
        "fromEmail": "ahoj@example.com",
        "replyTo": "ahoj@example.com",
        "unsubscribeListId": "6a1c…",
        "trackOpens": true,
        "trackClicks": true
      } },

    { "id": "tag_1", "type": "add_tag", "position": { "x": 160, "y": 360 },
      "config": { "label": "Označit jako vlažný", "tagId": "77a0…" } },

    { "id": "end_1", "type": "exit", "position": { "x": 0, "y": 480 },
      "config": { "label": "Konec série", "reason": "completed" } }
  ],
  "edges": [
    { "from": "trg_1",  "to": "wait_1" },
    { "from": "wait_1", "to": "cond_1" },
    { "from": "cond_1", "to": "mail_1", "branch": "yes" },
    { "from": "cond_1", "to": "tag_1",  "branch": "no" },
    { "from": "mail_1", "to": "end_1" },
    { "from": "tag_1",  "to": "end_1" }
  ]
}
```

Pravidla, která vynucuje `graph/canonical.ts` a `graph/validate.ts`:

- **`node.id` se nikdy nerecykluje ani nemění.** Editor ho generuje jednou při vzniku uzlu a smazaný uzel své id navěky opouští. Bez toho by se smazáním a znovupřidáním uzlu odpojila jeho historie a čísla v reportu by se přiřadila jinému uzlu.
- **Hrana z `condition` má povinné `branch`**, ostatní uzly mají nejvýš jednu odchozí hranu bez `branch`.
- **`position` se do kanonizace a do `graph_hash` nepočítá.** Posun uzlu myší není změna scénáře a nesmí vyrábět novou verzi.
- **`config.label` je povinné u každého uzlu**, protože z něj skládá věty časová osa i detail běhu.

---

## 5. Motor: co se stane od události k odeslání

```
1. Kontakt potvrdí přihlášení do seznamu.
     confirm-service.ts, port emit
       -> enqueueAutomationTrigger({ workspaceId, contactId,
                                     type: 'list_subscribed', matchKey: listId,
                                     source: 'server' })
          (cache v procesu: nemá-li projekt aktivní spouštěč toho typu,
           job se vůbec nezaloží)

2. automations.evaluate_triggers, jedna transakce
     - odmítne source mimo web|server|email|automation            (pojistka D18)
     - SELECT z automation_triggers indexem (workspace, type, match_key)
     - vyloučí zprávy, které poslal týž scénář                    (smyčka, D10)
     - politika vstupu (D11) a způsobilost (kapitola 6)
     - INSERT automation_runs, 23505 = kontakt už uvnitř je, tiše se přeskočí
     - INSERT prvního automation_run_steps (seq = 1, due_at = now())
     - INSERT web_events automation_entered, nebo automation_entry_skipped
       s důvodem, když se nevpustil

3. automations.tick, cron * * * * * (fakticky 1x za minutu, viz D2)
     pod mlain_maintenance, sloupcový grant:
       SELECT DISTINCT s.workspace_id
         FROM automation_run_steps s JOIN workspaces w ON w.id = s.workspace_id
        WHERE w.deleted_at IS NULL
          AND (  (s.status='scheduled' AND s.due_at <= now())
              OR (s.status='running'   AND s.claim_expires_at < now()) )
     pro každý: enqueue automations.run_due

4. automations.run_due, pod mlain_app v systémovém kontextu projektu
     TRANSAKCE 1: claim dávky AUTOMATION_TICK_BATCH_SIZE (D4), commit
     pro každý claimnutý krok TRANSAKCE N:
       a) načíst běh, scénář, verzi. Scénář pozastavený -> krok zpět na scheduled
       b) splatný o víc než AUTOMATION_CATCHUP_HOURS -> skipped, stale_after_pause
       c) způsobilost kontaktu (kapitola 6). Nezpůsobilý -> ukončit běh
       d) provést uzel:
            wait       -> naplánovat další krok podle doby, okna a zóny projektu
            condition  -> SELECT EXISTS (…) přes toSql, zapsat outcome a větev
            send_email -> vložit do messages kind='automation'
            add_tag    -> addTagsToContact z domény kontaktů (limit 50)
            exit       -> ukončit běh
       e) UPDATE kroku PODMÍNĚNÝ NA VLASTNÍ CLAIM, UPDATE běhu,
          případný INSERT web_events. Nula řádků = rollback celé transakce.
     Vyčerpal-li se rozpočet a zbývá práce, job se sám zařadí znovu.

5. Sender, třetí claim větev
     ClaimAutomationBatch -> WHERE kind='automation' AND status='pending'
     hlavička z campaigns podle campaign_id (skrytá kampaň uzlu)
     dál stejná cesta jako kampaňová zpráva: suppression, throttle, dispatch
```

Bod 4e je jádro spolehlivosti. Spadne-li proces mezi vložením zprávy a posunem kroku, transakce se nedokoná, krok zůstane `running`, další claim ho po vypršení TTL vezme znovu a odbaví. Vložení zprávy se neopakuje, protože se vrátilo spolu s ním.

**Propustnost.** Rozpočet 50 kroků na běh, tik jednou za minutu, ale se sebezařazením při zbývající práci: strop je tedy dán rychlostí zpracování, ne periodou tiku. Bez sebezařazení by byl strop 50 kroků za minutu na projekt a scénář, kde 100 000 lidem doběhne třídenní čekání ve stejnou hodinu, by se dojížděl přes třicet hodin. Pozor: `singletonKey` v tomhle repozitáři nededuplikuje (fronty se zakládají bez `policy`, takže pg-boss použije `standard` a unikátní indexy nezaloží), takže se na něj nesmí spoléhat, a `run_due` musí být idempotentní, což díky claimu je.

---

## 6. Způsobilost: kdo smí od scénáře dostat e-mail

Tohle je jediné místo, kde se o způsobilosti rozhoduje (`engine/eligibility.ts`), a je závazné celé. První verze plánu tady měla dvě podmínky ze šesti.

| Vrstva | Co | Odkud |
|---|---|---|
| 1 | `deleted_at IS NULL`, `anonymized_at IS NULL`, `status <> 'deleted'`, `processing_restricted = false`, není v suppression | obálka `buildEnvelope` segmentového kompilátoru |
| 2 | `status = 'active'` | materializace kampaní (`campaigns/repo/outbox.ts`) přidává nad obálku |
| 3 | neprázdná e-mailová adresa | tamtéž |
| 4 | **není ukázkový kontakt**, obě nezávislé podmínky (`source_ref` i manifest) | `campaigns/audience/sample-guard.ts`. Bez toho uvítací scénář nad demo daty rozešle na fiktivní adresy a poškodí reputaci hned první den |
| 5 | **zkušební režim**: `canSendInTrial(email, trial)` | `providers/trial-mode.ts`. Trial je u nového projektu a u SES sandboxu **výchozí stav**. Materializace má `trial` jako povinný parametr právě proto, že se na něj jednou zapomnělo. Nezpůsobilý řádek se zakládá jako `skipped` s `error_code = 'trial_not_verified'`, nezahazuje se |
| 6 | **potvrzené členství** v seznamu, na který míří `unsubscribeListId` uzlu, a není v `snooze` | `list_subscriptions.status = 'confirmed'`, `snooze_until`. Bez toho by kontakt, který vstoupil přes webovou událost a nikdy nic nepotvrdil, dostal marketingový e-mail, tedy přesně to, čemu double opt-in brání |

Vrstvy 1 až 4 se vyhodnocují **před každým krokem** (D16), vrstvy 5 a 6 jen před `send_email`, protože se týkají konkrétní adresy a konkrétního seznamu.

**Co se vědomě nekontroluje:** odvolaný souhlas s účelem `email_marketing` v `contact_consent_state`. Není to opomenutí: tuhle bránu dnes nemá ani kampaň (`evaluateMailability` ji nezná, drží to jen tím, že globální odhlášení zapisuje suppression). Zavést ji jen pro automatizace by znamenalo, že se dva odesílací kanály chovají různě. Je to otázka O9 pro zadavatele a test, který dnešní chování zafixuje, patří do fáze D.

---

## 7. Mapa souborů a fronty

### `packages/core/src/automations/`

| Soubor | Obsah |
|---|---|
| `graph/types.ts` | typy uzlů, hran a grafu, `AutomationGraphSchema` |
| `graph/validate.ts` | sedm bran z D12, čistá funkce, používá klient i server |
| `graph/canonical.ts` | kanonizace bez `position`, `graph_hash`, pravidlo o `node.id` |
| `versions.ts` | publikování, vyřazení, číslování, vyřazení starého spouštěče |
| `entry.ts` | politika vstupu, opakovaný vstup, strop vstupů za minutu |
| `engine/run-step.ts` | přechodová tabulka podle druhu uzlu |
| `engine/nodes/wait.ts` | výpočet `due_at`, **bere `now: Date` a `timezone: string` jako parametry**, jinak nejde testovat letní čas |
| `engine/nodes/condition.ts` | vyhodnocení AST pro jeden kontakt |
| `engine/nodes/send-email.ts` | `render_data`, `prepareRenderData`, vložení do outboxu |
| `engine/nodes/tag.ts` | volá doménu kontaktů, ne vlastní SQL |
| `engine/eligibility.ts` | šest vrstev z kapitoly 6, jediné místo rozhodování |
| `engine/outcome.ts` | tvar `outcome`, skládání vět z grafu verze (D14) |
| `triggers/evaluate.ts` | vyhodnocení spouštěčů, pojistka proti importu, vyloučení vlastních zpráv |
| `triggers/enqueue.ts` | `enqueueAutomationTrigger`, cache aktivních spouštěčů |
| `repo/*.repo.ts` | scénáře, verze, spouštěče, běhy, kroky, hlavičky, osa |
| `reports.ts` | čísla u uzlů (D19 první verze, teď nad `version_id`) |
| `jobs/enqueue.ts` | transakční vkládání jobů, vzor `segments/jobs/enqueue.ts` |
| `jobs/queue-handlers.ts` | **povinné jméno souboru i exportu `handlers`** kvůli codegenu |
| `jobs/{tick,run-due,evaluate-triggers,cancel-runs,sweep}.ts` | obsluhy |
| `audit.ts` | `automation.created/.updated/.published/.activated/.paused/.resumed/.archived/.deleted/.duplicated/.version_retired/.enrolled/.runs_cancelled` |
| `errors.ts` | doménové chyby |
| `api/index.ts`, `api/automations.routes.ts`, `api/schemas.ts` | Hono sub-app (D23) |
| `index.ts` | kurátorovaná veřejná plocha |

### `apps/web/src/features/automations/`

`canvas/` (plátno, uzly, hrany), `inspector/` (**čtyři editory: e-mail, čekání, podmínka nad existujícím segmentovým builderem, štítek**), `list/`, `detail/`, `runs/`, `publish-dialog.tsx`, `preview/`, `actions.ts`.

### Obrazovky

`/w/{slug}/automations`, `/w/{slug}/automations/{id}`, `/w/{slug}/automations/{id}/runs`, `/w/{slug}/automations/{id}/runs/{runId}`.

### Nové fronty

Všechny s `domain: 'campaigns'` (D24), `owner: 'P17'`, `payloadFields` bez osobních údajů.

| Fronta | Cron | `retryLimit` | `singletonKeyTemplate` | Idempotence |
|---|---|---|---|---|
| `automations.tick` | `* * * * *` | 0 | `global` | čistý sken, nic nemění |
| `automations.run_due` | – | 3 | `<workspace_id>` | claim `scheduled` na `running`, dokončení podmíněné na vlastní claim |
| `automations.evaluate_triggers` | – | 3 | – | `uq_automation_runs__open` a politika vstupu |
| `automations.cancel_runs` | – | 3 | `<automation_id>` | podmíněný `UPDATE ... WHERE ended_at IS NULL` |
| `automations.sweep` | `*/5 * * * *` | 0 | `global` | podmíněné `UPDATE` podle stavu |

Cronové obsluhy se obalují `once()`, ne `perJob()`. `singletonKeyTemplate` je dokumentační: v téhle instalaci pg-boss singleton fakticky nevynucuje (viz kapitola 5), takže se na něj nesmí spoléhat.

---

## 8. Pořadí prací

Po každé fázi musí být aplikace použitelná a testy zelené.

### Fáze A: schéma, brány a registry

- [ ] A0 Rozhodnout D19 (odesílací konfigurace uzlu) a kapitolu 4 (tvar grafu). Z nich plyne tvar zod schémat, brány publikování i panel vlastností, takže se to musí rozhodnout dřív než všechno ostatní.
- [ ] A1 Drizzle schéma šesti tabulek, doplnění do `drizzle.config.ts` a `schema/index.ts`.
- [ ] A2 `db:generate` do `0016_automations.sql`, kontrola počtu `CONSTRAINT ck_` proti schématu.
- [ ] A3 Ruční migrace `0017`: cyklický FK, RLS pro šest tabulek, `maintenance_scan FOR SELECT`, kopie `mlain_apply_grants()` s dvěma novými bloky, `ck_messages__kind` přes `NOT VALID`, claim index.
- [ ] A4 `packages/db/src/rls.ts`: `WS_ISOLATION_TABLES`, `MAINTENANCE_SCAN_TABLES`, **`EXTRA_POLICIES`**. `packages/db/src/partitions.ts`: `PARTITIONED_REFERENCES`.
- [ ] A5 Pět front do registru, zápis do `UNDELIVERED`, oprava počtu v `registry.test.ts`.
- [ ] A6 Šest oprávnění do rolí, oprava tří počtů v `permissions.test.ts`, `pnpm ci:openapi-drift`.
- [ ] A7 Sedm konfiguračních proměnných do dvou souborů, `.env.example`, **regenerace manifestu** a oprava počtu v `manifest.test.ts`, Go strana.
- [ ] A8 Namespace `automations` do `load-messages.ts` a prázdné katalogy cs a en.
- [ ] A9 `MESSAGE_KINDS` o `'automation'`, commit s prefixem `contract:`.
- [ ] A10 `audit.ts` s výčtem akcí, překlady v `settings.json`, oprava počtu v `audit-actions.test.ts`.
- [ ] A11 Nové API kódy a `messages.error_code`, oprava počtu v `errors/registry.test.ts`.
- [ ] A12 `packages/core/package.json`: klíč `"./automations/jobs"`.

**Brána A:** `pnpm --filter @mlain/db test`, `pnpm ci:migration-lint`, `pnpm --filter @mlain/db test:migrations`, `pnpm ci:i18n-check`, `pnpm ci:openapi-drift`, typecheck, celý `test:unit`.

### Fáze B: graf, verzování a API bez motoru

- [ ] B1 Typy uzlů a hran podle kapitoly 4, zod schéma, kanonizace, hash.
- [ ] B2 Validace grafu, všech sedm bran z D12, plná sada jednotkových testů.
- [ ] B3 Repo scénáře, CRUD, autosave draftu s `parse` a stropem bajtů, soft delete, kopie, stavový stroj z D22, audit.
- [ ] B4 Port `upsertAutomationHeaderCampaign` v doméně kampaní (D26).
- [ ] B5 Publikování: validace, hlavičkové kampaně, kompilace, `campaign_links`, verze, spouštěč, **vyřazení spouštěče předchozí verze**, audit. Databázový test.
- [ ] B6 Vyřazení verze a `automations.cancel_runs`.
- [ ] B7 Hono sub-app včetně `enroll` s `Idempotency-Key` a stropem, mount v `openapi.ts`.
- [ ] B8 Náhled uzlu (D21).

**Brána B:** publikování bez popisku podmínky vrací `422` s ukazatelem na uzel, publikování bez odesílací konfigurace taky, publikování šablony bez odhlašovacího odkazu taky.

### Fáze C: motor

- [ ] C1 `steps.repo.ts`: claim včetně vracení zaseknutých, dokončení podmíněné na claim, počty. Databázové testy včetně souběhu dvou claimů a vypršeného TTL.
- [ ] C2 `engine/run-step.ts` s přechodovou tabulkou, kde `send_email` zatím vrací `unsupported_node`, plus uzly `wait` a `exit`.
- [ ] C3 Uzel `condition` přes `toSql`, zápis `outcome` bez popisků.
- [ ] C4 Uzly `add_tag` a `remove_tag` přes doménu kontaktů.
- [ ] C5 `automations.tick` a `run_due`, dvoutaktní sken s joinem na `workspaces`, sebezařazení při zbývající práci. Codegen workeru.
- [ ] C6 `automations.sweep`: vyčerpané pokusy, osiřelé běhy, zmizelé odkazy.
- [ ] C7 Běhové stropy, doháněcí okno, chování při pozastavení a smazání.

**Brána C:** databázový test „scénář s čekáním 3 dny se odbaví ve správném pořadí" (posun `due_at` do minulosti, ne posun hodin), test na restart, test na vypršelý claim.

### Fáze D: odesílání

- [ ] D1 `engine/eligibility.ts`, všech šest vrstev z kapitoly 6, jednotkové i databázové testy včetně zkušebního režimu a ukázkových kontaktů.
- [ ] D2 Uzel `send_email` v téže transakci jako posun kroku.
- [ ] D3 Go: `StmtClaimAutomationBatch`, `AllStatements()`, `statements_test.go`, `Store.ClaimAutomationBatch`, revize v `RETURNING`.
- [ ] D4 Go: `AutomationBatchSize`, blok v `Tick`, `SENDER_AUTOMATION_BATCH_SIZE`. **Bez rotace podle projektu** (D7).
- [ ] D5 Go: `claim_automation_test.go`, fixture `OB-23`.
- [ ] D6 Zrušení čekajících zpráv při pozastavení a smazání, `deleteProvider` podle D27.
- [ ] D7 Testovací odeslání uzlu (D21).

**Brána D:** `go test -tags=integration ./...`, `pnpm --filter @mlain/contracts test:parity`, řetězový test od publikování přes vstup a čekání až k hotovému HTML s vyhodnoceným `_present`.

### Fáze E: časová osa a reporty

- [ ] E1 Zápis do osy jen ve čtyřech okamžicích (D13), rozšíření `WebEventInsert.source`.
- [ ] E2 `webEventBranch` vrací skutečný `source`, `TimelineFilter`, `FILTERS`, `TITLE_KEYS`, ikona, oprava tří testů a jednoho e2e scénáře.
- [ ] E3 `messageBranch` a `messageEventBranch`: filtr `kind` a rozlišení podle `c.kind`.
- [ ] E4 ICU věty **v `reports.json`** cs i en, texty obrazovek v `automations.json`.
- [ ] E5 `reports.ts`: čísla u uzlů nad `version_id`, výpis běhů, agregace přes verze.
- [ ] E6 Šestý krok v `gdpr-sever-links.ts` a jeho testy.

**Brána E:** timeline testy, `i18n-check`, test „v `outcome` není volný text".

### Fáze F: rozhraní

- [ ] F1 Plátno React Flow, lazy chunk kvůli rozpočtu balíku.
- [ ] F2 Panel vlastností se čtyřmi editory, včetně vložení segmentového builderu.
- [ ] F3 Klientská validace týmiž pravidly jako server, nálezy u konkrétního uzlu.
- [ ] F4 Dialog publikování se souhrnem, volbou „ukončit běhy staré verze" a varováním o neměnnosti. Zapnutí jako samostatná akce (D22).
- [ ] F5 Seznam, detail s čísly, výpis běhů, detail běhu krok po kroku s větami, kopie scénáře.
- [ ] F6 Navigace: `mvp0: true`, zrušení `reservedFor`. `registry-screens.test.ts` hlídá obojí, takže tenhle krok nejde udělat dřív než F5.
- [ ] F7 E2E scénář: založit, publikovat, zapnout, ručně vložit kontakt, posunout `due_at` v databázi, ověřit odeslání a osu.

**Brána F:** `test:e2e`, vizuální kontrola v běžící instalaci, kompletní série na celém repozitáři.

---

## 9. Rizika

| Riziko | Dopad | Opatření |
|---|---|---|
| **Scénář se zacyklí a rozešle tisíce e-mailů** | kritický, poškodí doručitelnost nevratně | brána na cyklus bez čekání, minimální čekání 60 s, běhový strop 500 kroků, povinná prodleva u opakovaného vstupu, vyloučení vlastních zpráv ze spouštěčů (D10) |
| **Import nebo hromadné API přihlášení spustí scénář** | kritický | tři vrstvy u importu (D18) a strop vstupů za minutu u `subscribe:bulk` (D28) |
| **Dvojí odeslání po vypršení claimu** | vysoký | dokončení podmíněné na vlastní claim, malá dávka, dlouhé TTL (D4) |
| **Scénář rozešle na neověřené nebo ukázkové adresy** | vysoký | zkušební režim a ukázkové kontakty jsou vrstvy 4 a 5 způsobilosti (kapitola 6) |
| **E-mail bez odhlašovacího odkazu** | vysoký, právní | `preSendCheck` bez `error` je brána publikování (D12 bod 5) |
| **Kontraktní změna `messages.kind` rozbije sender** | vysoký | fixture `OB-23`, integrační Go testy, `contract:` commit |
| **Migrace zastaví odesílání** | střední | `NOT VALID` plus `VALIDATE`, poctivý odhad délky v instalační dokumentaci |
| **Mazání odesílacího účtu spadne na cizím klíči** | střední | `CASCADE` plus aplikační kontrola s `409` (D27) |
| **Watchdog uzavře hlavičkovou kampaň** | vysoký, nevratný | řádek nikdy neopustí `draft`, databázový test, který nechá watchdog proběhnout |
| **Zablokovaný provider zastaví kampaně, ale ne scénáře** | střední | brána v `send_email` na stav provideru, plus známá díra R-S1 s návrhem v O2 |
| **Pozastavení na tři týdny a hromadné dorozeslání** | vysoký | doháněcí okno 24 hodin, přeskočené kroky viditelné v ose |
| **Neměnnost verze se ztratí při další migraci** | vysoký, tichý | výjimka uvnitř `mlain_apply_grants()`, test na `42501` |
| **Sken splatných kroků položí databázi** | vysoký | `workspace_id` jako první sloupec indexu, změřeno |
| **Motor běží v měkce smazaném projektu** | střední | join na `workspaces` v tiku i kontrola v `run_due` (D29) |
| **Osiřelý běh navěky blokuje opakovaný vstup** | střední | `automations.sweep` (D30) |
| **Automatizační e-maily změní výsledky existujících segmentů** | střední, tichý | otázka O8, test, který dnešní chování zafixuje |
| **Starší kampaňové e-maily zmizí z osy** | nízký | `messageBranch` má `LIMIT 500`, po rozšíření o něj soupeří víc řádků |
| **Rozsah nabobtná** | vysoký | uzavřený seznam uzlů a spouštěčů, odložené věci v kapitole 10 |

---

## 10. Rozsah prvního kroku a odhad

Tohle je největší zbývající kus produktu. **Odhad po prověrce: 22 až 28 dnů** soustředěné práce jednoho člověka. První verze plánu tvrdila 12 až 16 a byla podstřelená zhruba na polovinu, hlavně ve fázi F.

| Fáze | Odhad | Poznámka |
|---|---|---|
| A, schéma a registry | 1,5 dne | granty, `EXTRA_POLICIES`, čtyři testy s pevnými počty, kontraktní commit |
| B, graf, verzování, API | 4 až 5 dnů | publikování je transakce nad šesti tabulkami plus kompilace a `campaign_links` |
| C, motor | 4 až 5 dnů | claim, souběh, doháněcí okno, sweep, stropy |
| D, odesílání | 3 dny | Go větev, fixture, parita, šest vrstev způsobilosti |
| E, osa a reporty | 2,5 dne | čtyři větve, ICU ve dvou jazycích, GDPR krok |
| F, rozhraní | **7 až 9 dnů** | plátno je den, panel vlastností se čtyřmi editory a vložený segmentový builder je zbytek |
| rezerva | 3 dny | |
| rozepsání plánu do úkolů (kapitola 0) | 2 dny | před fází A |

**Uvnitř prvního kroku:** scénář s jedním spouštěčem, sedm druhů uzlů, neměnné verze, běh, který přežije restart a čekání dlouhé měsíce, čtyři spouštěče, odesílání outboxem, náhled a testovací odeslání, kopie scénáře, časová osa se čtyřmi druhy položek a s vysvětlením větve větou, čísla u uzlů, výpis a detail běhu, pozastavení a smazání, pojistky, oprávnění, audit, cs a en.

**Vědomě odloženo:**

| Odložené | Proč a kdy dodělat |
|---|---|
| rotace claimu podle projektu v senderu | až bude mít instalace víc projektů s velkými scénáři. Poznat se to dá podle toho, že automatizační dávka je trvale plná a jeden projekt v ní převažuje |
| segmentový spouštěč | dynamický segment nemá stav členství, odvodit „vstup" bez nové tabulky nejde |
| `wait_until_event` | druhý druh splatnosti kroku a druhý index |
| A/B rozdělení uvnitř scénáře | samostatná funkce MVP 2 s vlastními statistikami |
| cíle a konverze scénáře | vyžaduje konfiguraci konverzních událostí a atribuční okno |
| uzel webhook nebo HTTP volání | SSRF plocha, vlastní úkol |
| uzly nad seznamy a souhlasy | vlastní auditní a GDPR rozvaha |
| datové spouštěče (narozeniny, výročí) | denní sken nad atributy a časovými zónami |
| vstupní podmínka přímo na spouštěči | obejde se podmínkou hned za triggerem, jen vznikne běh, který okamžitě skončí |
| více spouštěčů na jeden scénář | `uq_automation_triggers__version` to dnes zamyká na jeden. Zrušení indexu je migrace, ale UI a vysvětlení „proč vstoupil" se tím zesloží |
| retence `automation_run_steps` | viz O10, tabulka roste monotónně a nemá dnes plán úklidu |
| materializovaná agregace čísel scénáře | dotaz s indexem v prvních měsících stačí |
| přenos běhů mezi verzemi | specifikace to výslovně zakazuje |

---

## 11. Brány a testy

| Brána | Příkaz | Co hlídá |
|---|---|---|
| jednotkové a databázové v core | `pnpm --filter @mlain/core test:unit` | **`packages/core` nemá skript `test:db`**, jeho DB testy běží pod `test:unit` nad `startTestPostgres()` z `packages/core/test/support/db.ts` (jeden sdílený kontejner, šablona podle otisku migrací, `pg.as(role)`, `beforeAll(…, 240_000)`) |
| schéma a RLS | `pnpm --filter @mlain/db test` | registr proti katalogu 1:1, granty, izolace |
| Go integrační | `go test -tags=integration ./...` | třetí claim větev |
| kontrakty | `pnpm --filter @mlain/contracts test:parity` | fixture `OB-23`. Pozor: otisk sekce outbox se změní, tvrzení „fixtures se nemění" neplatí |
| migrace | `pnpm ci:migration-lint`, `pnpm --filter @mlain/db test:migrations` | čtení hodin, idempotence, drift |
| i18n | `pnpm ci:i18n-check` | úplnost, ICU, glosář, zákaz dlouhé pomlčky |
| OpenAPI | `pnpm ci:openapi-drift` | nová oprávnění v `PermissionSchema` |
| licence | `pnpm ci:licenses-node` | `@xyflow/react` je MIT, projde bez výjimky |
| rozpočet balíku | `apps/web/scripts/check-bundle-budget.mjs` | plátno musí být lazy chunk |
| navigace | `registry-screens.test.ts` | položka má obrazovku a obrazovka má položku |
| E2E | `pnpm test:e2e` | celý tok |

**Testy s pevnými počty, které tenhle plán rozbije a musí je opravit** (jinak spadne brána A): `queues/registry.test.ts` (61 front), `identity/permissions.test.ts` (48 na třech místech), `config/manifest.test.ts` (182 proměnných), `errors/registry.test.ts` (34 kódů), `audit-actions.test.ts` (28 akcí), `rls-registry.test.ts` (celkový počet politik), `timeline/titles.test.ts` a `group-sessions.test.ts` (obojí fixuje `automation_entered` na generický fallback), `apps/web/e2e/reports/timeline.spec.ts`.

**Čas v testech se neposouvá, posouvají se data.** Žádný `Clock` port v repozitáři neexistuje, `vi.useFakeTimers` se v databázových testech nepoužívá a nefungoval by, protože všechna okna se porovnávají proti `now()` v Postgresu. Zavedený vzor je `UPDATE … SET due_at = now() - interval '…'`, jako to dělá `campaigns/test/harness.ts`. Proto musí `engine/nodes/wait.ts` brát `now` a `timezone` jako parametry: jinak nejde testovat letní čas vůbec.

**Tři testy, bez kterých se plán nesmí prohlásit za hotový:**

1. **Import nespustí automatizaci.** Nahraj tisíc kontaktů importem do seznamu, na který míří aktivní scénář s okamžitým e-mailem, a ověř, že nevznikl ani jeden běh a ani jedna zpráva.
2. **Verze se nepřepíše.** Vstup do verze 3, publikování verze 4, posun `due_at`, ověření, že kontakt dojel graf verze 3. Plus pokus o `UPDATE automation_versions SET graph = …` pod `mlain_app`, který musí skončit `42501`.
3. **Vypršelý claim neodešle e-mail dvakrát.** Claimni krok, posuň `claim_expires_at` do minulosti, nech ho claimnout znovu, dokonči původní transakci a ověř, že v `messages` je právě jeden řádek.

---

## 12. Závislosti a licence

### 12.1 Nové runtime závislosti

| Balík | Verze | Licence | Kam | Proč |
|---|---|---|---|---|
| `@xyflow/react` | 12.11.2 | MIT | `apps/web/package.json` | plátno scénáře. Jmenovitě uvedený v hlavní specifikaci |

MIT je na whitelistu `tools/ci/licenses-node.mjs`, takže výjimka v `licenses.allow.json` (kde je povinné `expires_at`) není potřeba.

### 12.2 Závislosti, které plán používá a zavedl je někdo jiný

`zod`, `@hono/zod-openapi`, `drizzle-orm`, `pg`, `pg-boss`, `luxon` (výpočet čekacího okna a letního času), `next-intl`, `liquidjs` nepřímo přes kontrakty, `@dnd-kit` se nepoužívá (React Flow má vlastní interakci).

### 12.3 Vědomě nepoužité

| Balík | Proč ne |
|---|---|
| knihovny na stavové stroje (`xstate` a spol.) | přechodová tabulka nad sedmi druhy uzlů je padesát řádků a stav žije v databázi, ne v paměti |
| `node-cron` a podobné | cron je v pg-boss a v registru front |
| `dagre` na automatické rozmístění uzlů | rozmístění dělá uživatel myší, automatické by přepsalo jeho práci |

---

## 13. Akceptační kritéria, která plán pokrývá

| Zdroj | Kritérium | Kde |
|---|---|---|
| hlavní spec, kap. 7 | server umí čekat měsíce | D2, C1, C5, test 3 |
| hlavní spec, kap. 7 | bezpečně pokračuje po restartu | D4, C1, brána C |
| hlavní spec, kap. 7 | zabrání duplicitnímu spuštění | D11, D4 |
| hlavní spec, kap. 7 | vysvětlí, proč kontakt prošel danou větví | D9, D14, E2, E4 |
| hlavní spec, kap. 7 | každé publikování vytvoří neměnnou verzi | D1, B5, test 2 |
| hlavní spec, kap. 7 | kdo vstoupil do verze 3, nepřeskočí na verzi 4 | D1, D15, test 2 |
| hlavní spec, kap. 10 | verzování od prvního dne | D1 |
| část 5, 3.9.3 krok 8 | vstupní bod pro triggery ve zpracování událostí | D10, 1.4 |
| část 5, 3.12.1 | `automation_entered`, `automation_step`, `automation_exited` v ose | D13, E1, E2 |
| část 5, 2.2.1 a 12.5.20 | import nikdy nespouští automatizace, samostatný scope | D18, D17, test 1 |
| část 5, registr `source` | zdroj `automation` ve `web_events` | D13 |
| část 1, 4.10.1 | zprávy bez kampaně, aditivní rozšíření kontraktu | D5, D6 |
| část 4a, 2.4 | průběžné rozesílky neřeší rozvolnění invariantu I1 | D5, D6 |
| část 6, registr navigace | sedmé místo pro automatizace | F6 |

Kritérium bez úkolu je díra v plánu. Kdyby se při rozepisování (kapitola 0) našlo další, doplňuje se sem.

---

## 14. Otázky, které musí rozhodnout zadavatel

> **ROZHODNUTO ZADAVATELEM 2026-08-05.** Čtyři blokující otázky mají odpověď,
> takže se podle nich smí stavět. Znění otázek níž zůstává, aby bylo vidět,
> co se rozhodovalo a proti čemu.
>
> - **O1 (rozšíření `messages.kind` o `automation`): ANO.** Hotové ještě před
>   začátkem prací: hodnota se do `ck_messages__kind` přidala v migraci 0016
>   spolu s `transactional` a ta migrace je spuštěná.
> - **O2 (pozastavení hlavičkové kampaně ve stavu `draft`): ANO**, a podle
>   doporučení plánu jako samostatná oprava ještě před vydáním. Zavírá tutéž
>   díru i u doručovacích e-mailů formulářů, které dnes při zablokovaném
>   odesílacím účtu vyčerpají pokusy místo aby se zastavily.
> - **O8 (počítat automatizační e-maily do segmentů o zapojení): ANO**, vědomě
>   a s testem. Zadavatel bere důsledek, že podmínka „za 90 dní nic neotevřel"
>   změní výsledek u všech projektů a že uzel `condition` uvidí i e-mail, který
>   mu tentýž scénář poslal o krok dřív.
> - **O10 (retence kroků uzavřených běhů): 90 dní.** Sedí to s rozhodnutím
>   o retenci odeslané pošty, které padlo týž den (`MESSAGE_RETENTION_DAYS`
>   se konečně začne číst), takže osa, detail běhu i odeslané zprávy mizí
>   ve stejné lhůtě a uživatel nemusí držet v hlavě tři různá čísla.
>
> Zbylých šest otázek (O3 až O7 a O9) zadavatel ponechal na výchozích
> odpovědích plánu.


**O1. Smí publikování měnit zmrazený kontrakt `messages.kind`?**
Plán předpokládá ano (D6). Alternativa je `kind = 'test'` a smířit se s tím, že automatizační e-maily nebudou v ose a budou mít neomezenou přednost před kampaněmi. **Doporučení: povolit.**

**O2. Má sender umět pozastavit hlavičkovou kampaň ve stavu `draft`?**
Dnes ne: `StmtPauseCampaign` má `WHERE status IN ('queueing','sending')`, takže při zablokovaném provideru automatizační zpráva vyčerpá pokusy místo aby se scénář zastavil. Navrhovaná oprava je `WHERE id = $1 AND (status IN ('queueing','sending') OR (status = 'draft' AND kind <> 'campaign'))`, což zavře stejnou díru i u doručovacích e-mailů formulářů. Je to druhá kontraktní změna. **Doporučení: opravit samostatným commitem, ale ještě před vydáním, ne po něm.** Brána v `send_email` na stav provideru (D12 bod 6) zakrývá zhruba 90 procent případů, zbytek ne.

**O3. Ukončit běhy staré verze při publikování, nebo je nechat dojet?**
Plán volí „nechat dojet", s volbou v dialogu. Opačná volba by znamenala, že oprava překlepu zabije všechny rozběhnuté série. **Doporučení: ponechat.**

**O4. Kolik dní zpět se má po pozastavení dohánět?**
Plán volí 24 hodin. Delší okno znamená větší riziko hromadného dorozeslání, kratší znamená, že po výpadku přes víkend část lidí scénářem neprojde.

**O5. Má odhlášení z jednoho seznamu ukončit celý běh?**
Plán volí ne (D16, kapitola 6). Opačná volba je bezpečnější a méně užitečná.

**O6. Kdy vznikne `POST /api/v1/events/import` a kdo ho vlastní?**
Klíč `events:import` plán zavádí, endpoint ne. Potřebuje vlastníka a termín, jinak vznikne později bez znalosti pravidla „import nespouští automatizace".

**O7. Stačí minutová přesnost čekání?**
Plán ji volí, protože pg-boss v téhle konfiguraci sekundový cron stejně neumí (D2). Pro drip sekvence ano, pro „pošli 5 minut po opuštění košíku" je na hraně. Zkrátit ji znamená opustit pg-boss cron a mít vlastní smyčku, což je vlastní úkol.

**O8. Mají se automatizační e-maily počítat do segmentových podmínek o zapojení?**
Dnes se to stane samo: `segments/compile/engagement-event.ts` se ptá nad `messages` a `message_events` bez filtru na `kind`. Znamená to, že podmínka „za 90 dní nic neotevřel" změní u všech zákazníků výsledek, a že uzel `condition` uvidí e-mail, který mu tentýž scénář poslal o krok dřív. **Doporučení: počítat je (je to poctivější obraz zapojení), ale rozhodnout to vědomě a mít na to test.**

**O9. Má odvolaný souhlas s účelem `email_marketing` blokovat odeslání?**
Dnes neblokuje nic, ani u kampaní. Zavést to jen pro automatizace by znamenalo dva různě se chovající kanály. **Doporučení: nezavádět v tomhle plánu, otevřít jako samostatný úkol napříč kampaněmi i scénáři.**

**O10. Jak dlouho se mají držet kroky uzavřených běhů?**
`automation_run_steps` roste monotónně a partitionovaná není. Sto tisíc kontaktů krát dvacet kroků jsou dva miliony řádků na jedno protočení scénáře. Zároveň D14 označuje `outcome` za trvalý záznam, který se nemaže retencí událostí. Tyhle dvě věci si odporují a rozhodnutí je věcné: buď se kroky uzavřených běhů po N měsících mažou (a „proč to tak dopadlo" se dá dohledat jen do té doby), nebo tabulka roste bez omezení. **Doporučení: zavést `AUTOMATION_STEPS_RETENTION_MONTHS` s výchozí hodnotou stejnou jako `TRACKING_RETENTION_MONTHS`, aby osa a detail běhu mizely současně.**

---

## 15. Sebekontrola po dopsání plánu

- [x] Každé rozhodnutí, které specifikace neuzavírá, má zdůvodnění a zamítnutou alternativu.
- [x] Datový model má úplné DDL včetně indexů, `CHECK` omezení, RLS vzoru a grantů.
- [x] Past se středníkem v `CHECK` je pojmenovaná a kontrolní krok je takový, který past skutečně chytí.
- [x] Tvar grafu je ukázaný na příkladu, ne jen popsaný.
- [x] Způsobilost je vypsaná celá, ne odkazem na cizí funkci.
- [x] Čekání dlouhé měsíce je rozebrané proti pg-boss a rozhodnuté s důvody, včetně opravy o skutečné granularitě cronu.
- [x] Spouštěče mají vyjmenovaná místa zavěšení a všechna existují.
- [x] Odesílání ze scénáře je rozebrané proti třem faktům z kódu a proti zamítnuté variantě mikrokampaní.
- [x] „Proč se to stalo" má popsaný tvar zápisu, způsob složení věty a rozhodnutí, že se popisky neukládají do `outcome`.
- [x] Pojistky proti hromadnému spuštění pokrývají import i jeho API ekvivalent.
- [x] Seznam cizích souborů je úplný a obsahuje i testy s pevnými počty.
- [x] Rozsah prvního kroku je uzavřený, odhad je po prověrce zvýšený a odložené věci mají podmínku, kdy se mají dodělat.
- [x] Otevřené otázky jsou oddělené od rozhodnutí, která si plán vzal sám.
- [x] Dokument nikde neobsahuje dlouhou pomlčku.
- [ ] **Fáze A až F nejsou rozepsané do úkolů s kódem** (kapitola 0). Tohle je jediný vědomě otevřený bod.

---

## 16. Nálezy prověrky a jak byly vypořádány

Plán prošel prověrkou šesti recenzentů (soulad s kódem, datový model a migrace, proveditelnost, čerstvý pohled, bezpečnost, konvence). Vypořádání:

**Přijato a zapracováno (výběr toho podstatného):** šest tabulek místo pěti; chybějící grant a `FOR SELECT` u skenu, navíc zúžený na sloupce; chybějící `EXTRA_POLICIES`; chybějící klíč v `exports` mapě, bez kterého padne codegen; `workspace_id` jako první sloupec obou claim indexů (změřeno, 120násobný rozdíl v I/O); denormalizace `version_id` do kroků, bez které nešly postavit reporty; chybějící cyklický FK a jeho `ON DELETE RESTRICT` místo `SET NULL` (ověřeno spuštěním, `SET NULL` porušuje vlastní `CHECK`); `NOT VALID` plus `VALIDATE` u `ck_messages__kind` a oprava nepravdivého tvrzení o `CONCURRENTLY`; `deleteProvider` maže systémové kampaně natvrdo, takže `RESTRICT` mění na `CASCADE` plus kontrolu v aplikaci; chybějící brána zkušebního režimu, ukázkových kontaktů, potvrzeného členství a `preSendCheck`; chybějící odesílací konfigurace uzlu; závod claimu s TTL; pg-boss neumí sekundový cron a `singletonKey` v téhle instalaci nededuplikuje; vyřazení spouštěče předchozí verze; smyčka spouštěče přes vlastní zprávy; způsobilost před každým krokem, ne jen před odesláním; ukázka tvaru grafu; ICU věty patří do `reports.json`; devět testů s pevnými počty; `ErrorDomain` nemá hodnotu `automations`; `SENDER_*` proměnné patří do `schema-platform.ts` a manifest se regeneruje ručně; `packages/core` nemá `test:db`; čas v testech se neposouvá, posouvají se data; časová zóna pro `wait`; audit, idempotence a strop u ručního vstupu; hromadné přihlášení přes API; měkce smazaný projekt; osiřelé běhy; zmizelé odkazy jako vlastní třída výsledku; náhled, testovací odeslání a kopie scénáře; oddělení publikování od zapnutí; `outcome` bez volného textu (opravuje zároveň bezpečnostní i praktický problém); zvýšení odhadu na 22 až 28 dnů; kapitoly o licencích, akceptačních kritériích, vlastnictví a stavu dokumentu; `TypeScript 5.9.3` místo nepravdivé 7.0.2; `apps/web/src/server/routes/**` v repozitáři neexistuje.

**Přijato jako známá mezera, ne opraveno:** plán není rozepsaný do úkolů s kódem. Je to největší odchylka od normy plánů v tomhle projektu a je pojmenovaná v kapitole 0 i v sebekontrole. Rozepsání je vlastní průchod na dva dny, který má smysl až po schválení rozhodnutí.

**Zamítnuto:**

- **Rotace claimu podle projektu v senderu v prvním kroku.** Recenze ukázala, že `Rotation.Set()` bere `[]ActiveCampaign`, takže by šlo o nový typ, nový sken a dvouúrovňové `exhausted`, tedy nejtěžší kus fáze D. Odloženo s napsanou podmínkou, kdy se má dodělat.
- **Zavedení generátoru lidských vět ze segmentového AST.** Zůstává povinný ruční popisek (D9). Generátor by byl samostatná funkce a jeho výstup horší.
- **Rozšíření `ErrorDomain` o `'automations'`.** Fronty dostanou `domain: 'campaigns'` podle existujícího precedentu, aby se kvůli pěti frontám nesahalo na registr chybových kódů celého produktu.
- **Blokování odeslání při odvolaném souhlasu s marketingem.** Dnes to neblokuje ani kampaň, takže by vznikly dva různě se chovající kanály. Otevřeno jako O9 místo tichého zavedení.
- **Sloučení `automations.sweep` do claimu úplně.** Vracení zaseknutých kroků do claimu sloučené je (ušetřilo cron a závod), ale překlopení vyčerpaných pokusů a hledání osiřelých běhů zůstává samostatně: jsou to skeny nad jiným kritériem a v claimu by zdržovaly hlavní cestu.
