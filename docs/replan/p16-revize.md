# Revize P16 proti schématu P03

<!-- puvod-dokumentu -->
> **Historický záznam, ne platné zadání.** Revize plánu P16 (onboarding a provoz) z prověrky plánů
> (31. 7. až 1. 8. 2026), tedy kontrola **textu plánu před stavbou**, ne kontrola kódu.
> **Verdikt typu „plán není proveditelný" se týkal tehdejšího plánu, ne dnešního produktu.** Ten stojí a funguje.
> Opravy se prováděly podle `docs/superpowers/plans/POSTUP-OPRAV.md`; **stav jednotlivých nálezů neověřen**.
> **Dnešní stav:** `docs/superpowers/STAV-UKOLU.md` (živý dokument), design `docs/superpowers/DESIGN-INTEGRACE.md`.

**Recenzovaný plán:** `/Users/petr/Projects/Mailing_Tool/docs/superpowers/plans/2026-07-31-p16-onboarding-provoz-zalohy-e2e.md` (8691 řádků)
**Zdroj pravdy pro schéma:** `/Users/petr/Projects/Mailing_Tool/docs/superpowers/plans/2026-07-31-p03-databaze-schema-rls.md`
**Datum:** 2026-08-01
**Rozsah:** soulad doménového plánu P16 s databázovým schématem, rolemi, granty a RLS z P03. Každý nález ověřen grepem přímo v P03.

---

## Verdikt

**Plán není v současném stavu proveditelný.** Sedm kritických nálezů, z toho tři třídy „projde typecheck i testy, ale v provozu tiše nefunguje". P16 se opírá o tři primitiva z `@mlain/db`, která P03 nedefinuje (`openConnection`, `maxKnownSchemaVersion`, subpath `./testing`), volá `runMigrations` s jinou signaturou, než P03 má, a v seedu ukázkových dat i v registru šifrovaných sloupců pracuje se sloupci a tabulkami, které ve schématu neexistují.

Nejzávažnější je nález K2: celá provozní vrstva otevírá holá spojení pod `mlain_app` a nikdy nenastaví `mlain.workspace_id`, takže RLS vrací nula řádků. `mlain doctor` tím přijde o kontrolu, kterou plán sám označuje za své jádro, a odstranění ukázkových dat se tváří jako hotové, přestože nesmazalo nic. Všechny testy P16 běží proti `pg.ownerUrl`, tedy pod vlastníkem schématu, takže tuhle třídu chyb spolehlivě maskují.

Řešení problému se zálohou pod rolí, na kterou platí RLS, je věcně správné a s právy, která P03 dává, proveditelné bez jediného doplňku. Má ale chybu v dotazu (nález D2) a nedotažený protějšek na straně obnovy (nález K5).

---

## Potvrzení dvou nálezů zadavatele

### 1. Záloha pod rolí, na kterou platí RLS: POTVRZUJI

`pg_read_all_data` je členská role, která uděluje `SELECT` na všechno. Není to atribut `BYPASSRLS`. Row level security se na roli s `pg_read_all_data` vztahuje beze změny, takže `pg_dump` pod ní doběhne s návratovým kódem 0 a vyrobí syntakticky bezvadný dump, ve kterém má každá ze 63 tabulek s politikou `ws_isolation` nula řádků. Politika zní `USING (workspace_id = current_setting('mlain.workspace_id', true)::uuid)` (P03 řádky 5061-5067) a `pg_dump` tu proměnnou nikdy nenastaví, takže porovnání vyjde NULL, tedy nepravda, pro každý řádek.

P16 to eviduje v rozhodnutí A2 (řádek 46) a v rozhraní I→P01.3 (řádek 76) a řeší to tak, že se zálohuje přes `DATABASE_URL_MIGRATOR` a před během se způsobilost role ověří dotazem (`assertDumpRoleSeesAllRows`, úkol 5). **To je proveditelné s právy, která P03 dává, a nepotřebuje to od P03 nic navíc:** pohled `pg_roles` i katalog `pg_class` jsou čitelné pro `PUBLIC`, takže dotaz na `rolbypassrls`, `rolsuper`, `relrowsecurity` a `relforcerowsecurity` projde i pod nejslabší rolí. `GRANT SELECT ON ALL TABLES TO mlain_backup` ani žádná pomocná funkce potřeba nejsou.

Dvě výhrady, které z toho plynou, jsou zapsané níž jako D2 (dotaz přehlédne devět partitionovaných tabulek) a D6 (role `mlain_backup` zůstává bez použití a měla by se buď vybavit `BYPASSRLS` v initdb, nebo zrušit).

### 2. `pg_dump --no-privileges` plus obnovený ledger migrací: POTVRZUJI

Je to nález K5 níže a je horší, než jak zní. Řetěz je tenhle:

1. `pg_dump --no-privileges` (P16 řádek 1325) znamená, že ACL v dumpu **vůbec nejsou**.
2. `pg_restore --no-owner --no-privileges` (P16 řádky 1991 a 1704) je nezapíše ani kdyby v dumpu byly.
3. Dump ale nese schéma `drizzle`, tedy i `drizzle.__drizzle_migrations` se všemi hashy (P03 řádky 994-1006). Po obnově se volá `runMigrations` (P16 řádek 2000), runner najde všechny hashe jako aplikované a **přeskočí úplně všechno**.
4. Granty z migrace 0005 (P03 řádky 5181-5290) i append-only REVOKE z migrace 0006 (P03 řádky 5322-5366) tedy nikdo nedoplní.

Dopad je dvojí. `mlain_app` skončí na `permission denied` při prvním dotazu, protože `ALTER DEFAULT PRIVILEGES` platí jen na tabulky založené po jeho nastavení, ne na ty obnovené z dumpu. A zároveň zmizí append-only ochrana: `audit_log`, `consents` a `message_events` půjde po obnově normálně mazat a měnit, aniž by to kdokoli poznal. Test v úkolu 9 to nechytne, protože běží pod vlastníkem schématu.

---

## KRITICKÉ nálezy

### K1. `openConnection` a subpath `@mlain/db/connection` v P03 neexistují

**Kde v plánu:** úkoly 5, 6, 8, 9, 12, 13, 16, 17, 18, 19, 22, 25, 26. Importy na řádcích 1111, 1284, 1643, 1909, 2640, 2879, 3073, 3134, 3619, 3829, 4109, 4329, 4461, 5332.

**Co P03 má:** `package.json` exports (P03 řádky 273-278) obsahuje jen `.`, `./schema`, `./migrate`, `./partitions`, `./rls`. Slovo `openConnection` se v P03 nevyskytuje ani jednou. Exportuje se `createDb`, `createPool(url, kind, max)`, `Database`, `PoolKind` (P03 řádky 5696-5730, 7001-7031). `createPool` vrací `pg.Pool`, jehož `query()` vrací `{ rows }`.

**Neshoda tvaru:** P16 všude píše `const [row] = await conn.query<T>(sql, params)`, tedy očekává pole, a používá `conn.transaction(async (tx) => ...)` a `conn.close()`. `Tx = PoolClient` z P03 (řádek 5604) nic z toho nemá.

**Oprava:** P03 doplní `packages/db/src/connection.ts` a subpath `"./connection": "./src/connection.ts"`:

```ts
export type DbConnection = {
  query<T>(sql: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: DbConnection) => Promise<T>): Promise<T>;
  close(): Promise<void>;
};
export function openConnection(databaseUrl: string): Promise<DbConnection>;
```

Kapitola 0.6 P16 (rozhraní na jiné plány) tenhle požadavek na P03 vůbec neeviduje, uvádí jen I→P03.1 (`workspaces.settings`) a I→P03.2 (migrační runner). Doplnit tam I→P03.3.

**Proč:** bez toho se nezkompiluje ani jeden úkol P16 od 5 výš.

---

### K2. Provozní čtení běží pod `mlain_app` bez workspace kontextu, RLS je utne na nulu

**Kde v plánu:** úkol 11 krok 4 (`runDoctor` dostává `databaseUrl: config.DATABASE_URL`, řádek 3319), úkol 12 celý, úkol 13 (`checks-workspace.ts`), úkol 19 (`rebuildEngagement`, řádek 4594), úkoly 22, 23, 25, 26, 27 (endpointy na řádcích 5738, 7123, 7147, 7169 volají `loadConfig().DATABASE_URL`).

**Co P03 má:** `ws_isolation` na 63 tabulkách včetně `suppressions`, `contacts`, `campaigns`, `templates`, `contact_engagement`; `workspaces` má `ws_isolation_self` (P03 řádky 5061-5100). Bez `mlain.workspace_id` vrací `current_setting(..., true)` NULL, porovnání je nepravda, dotaz vrátí **nula řádků a nespadne nic**. Kontext nastavuje výhradně `withWorkspace(pool, ctx, fn)` (P03 řádek 5613).

**Konkrétní dopady:**

| Místo v P16 | Dotaz | Co se stane |
|---|---|---|
| úkol 12, řádek 2650 | `SELECT DISTINCT fingerprint_key_id FROM suppressions` | vždy prázdno, nález `missing_key_generations` nikdy nevznikne |
| úkol 12, `countSuppressions` | `SELECT count(*) FROM suppressions` | vždy 0, `secret_key_previous_empty` mlčí |
| úkol 13, řádek 3138 | `SELECT id, name, settings FROM workspaces` | prázdno, `trial_mode_enabled` ani `demo_data_present` nevzniknou |
| úkol 26, řádek 6806 | `SELECT settings FROM workspaces ... FOR UPDATE` | prázdno, `purgeDemoData` vrátí `EMPTY` a **tváří se, že smazal** |
| úkol 25 | INSERT do `tags`, `contacts`, ... | spadne na `WITH CHECK` |
| úkol 19, řádek 4350 | `SELECT id FROM workspaces WHERE id = $1` | skončí hláškou „Projekt neexistuje" |
| úkol 22, řádek 5360 | pětinásobný poddotaz nad `sending_providers`, `contacts`, `templates`, `campaigns` | všude 0, checklist onboardingu je trvale prázdný |

Kontroly nad `system_settings` (`schema_version_ahead`, `secret_key_fingerprint_mismatch`) fungují, protože `system_settings` je na whitelistu tabulek bez RLS (P03 řádek 5057). To je zrádné: doktor bude vypadat funkčně, protože dvě kontroly ze čtyř projdou.

**Proč to testy nechytnou:** všech dvacet databázových testů P16 běží proti `pg.ownerUrl`, tedy pod vlastníkem schématu, na kterého se RLS nevztahuje (`FORCE ROW LEVEL SECURITY` se podle P03 nikde nepoužívá).

**Oprava, dvě různé podle místa:**
- Kontroly napříč projekty (`doctor`, `rebuild-engagement`) musí jet pod `adminUrl` a při jeho chybění hlásit kritický nález, ne tiché prázdno. Doktor už `adminUrl` v kontextu má (řádek 3320), jen ho nepoužívá.
- Endpointy v úkolech 23 a 27 musí jít přes `withWorkspace(pool, ctx, tx => ...)` z P03, ne přes nové holé spojení na každý požadavek. Vedlejším efektem se tím opraví i to, že současný tvar obchází pool.

---

### K3. Registr šifrovaných sloupců neodpovídá schématu ve třech ze čtyř položek

**Kde v plánu:** úkol 16 krok 3 (`ENCRYPTED_COLUMNS`, řádky 3635-3660), úkol 17 (`rotateCredentials`), kritérium 55.

**Co P03 má:**

| P16 uvádí | P03 skutečně má | typ v P03 |
|---|---|---|
| `sending_providers.credentials_encrypted` | `sending_providers.config_encrypted` | **TEXT** |
| `ai_providers.api_key_encrypted` | `ai_provider_credentials.api_key_encrypted` | **BYTEA** |
| `webhook_endpoints.secret_encrypted` | sedí | **TEXT** |
| `inbound_endpoints.secret_encrypted` | sedí | **BYTEA** |

Ověřeno: `grep -c credentials_encrypted` v P03 = 0, `grep -c ai_providers` = 0.

**Druhá vrstva:** registr nezaznamenává typ sloupce, ale implementace na řádku 3894 dělá `const value = row.value as Buffer` a `envelopeKeyId(value)` na všech čtyřech položkách. U TEXT sloupců vrátí driver `string`, ne `Buffer`, a `UPDATE ... SET config_encrypted = $1` s Bufferem zapíše do TEXT sloupce hexadecimální literál `\x...`. Rotace by dva ze čtyř sloupců tiše poškodila. Ty čtyři sloupce nesou tutéž obálku `enc:v1:<base64>` ve třech různých typových kabátech a P16 to nikde neřeší.

**Třetí vrstva:** test na řádku 3738 vkládá `INSERT INTO sending_providers (id, workspace_id, kind, credentials_encrypted)`. P03 má sloupec `type` s CHECK `IN ('ses','smtp')`, ne `kind`, a `name` je NOT NULL bez defaultu.

**Oprava:** opravit jména na `sending_providers.config_encrypted`, `ai_provider_credentials.api_key_encrypted`, `sending_providers.type`; do typu `EncryptedColumn` přidat `storage: 'text' | 'bytea'` a podle něj větvit čtení i zápis; do testovacího INSERTu doplnit `name`.

**Proč:** hlídač registru z úkolu 16, krok 4 spadne hned při prvním běhu proti skutečnému schématu, protože najde dva neregistrované sloupce, a `rotateCredentials` pak odmítne běžet vlastní branou na řádku 3846. Rotace je v tomhle stavu neproveditelná.

---

### K4. Ukázková data zapisují do sloupců, které neexistují, a vynechávají NOT NULL

**Kde v plánu:** úkol 24 (datová sada), úkol 25 krok 3 (`insertAll`, řádky 6502-6620).

**Co P03 má:**

| P16 zapisuje | P03 |
|---|---|
| `tags.slug` | není, tabulka má `name`, `color`, `description` |
| `lists.slug` | není |
| `segments.slug` | není; navíc chybí `definition_hash bytea NOT NULL` |
| `templates.slug`, `.subject`, `.blocks` | ani jedno; povinné jsou `design jsonb NOT NULL` a `design_hash bytea NOT NULL`, které ve VALUES nejsou |
| `contacts.custom_fields` | je `attributes jsonb` (`grep -c custom_fields` = 0) |
| `list_subscriptions.id`, `.created_at` | tabulka má složený PK `(contact_id, list_id)`, žádné `id` ani `created_at`; chybí `source text NOT NULL` |
| `campaigns.sent_at` | není, časy jsou `started_at` a `finished_at` |
| `campaign_stats.bounced`, `.computed_at` | jsou `bounced_hard`, `bounced_soft` a `updated_at` |

**Oprava:** slug u tagů, seznamů, segmentů a šablon buď zahodit a pracovat s `name`, nebo o něj požádat P03 jako o nový sloupec s částečným unique indexem (rozhodnutí je na zadavateli, ale zahodit je levnější, protože ukázková data slug nepotřebují). Doplnit `design`, `design_hash`, `definition_hash`, `source`; přejmenovat `custom_fields` na `attributes`, `sent_at` na `finished_at`, `bounced` na `bounced_hard`, `computed_at` na `updated_at`; z `list_subscriptions` odstranit `id` a `created_at`.

**Proč:** seed spadne na prvním INSERTu do `tags`, takže neprojde ani jeden test úkolů 25 až 27 ani zlatá cesta v úkolu 32.

**Co je naopak v pořádku:** manifest ve `workspaces.settings.demoData` je správná volba. `workspaces.settings jsonb NOT NULL DEFAULT '{}'` v P03 existuje (rozhodnutí R7), mazání podle manifestu místo podle značky `source_ref` je dobře odůvodněné (řádek 6800) a `settings - 'demoData'` na řádku 6820 je korektní.

---

### K5. Obnova ze zálohy vyrobí databázi bez jediného grantu a bez append-only ochrany

**Kde v plánu:** úkol 6 krok 3 (`pg_dump --no-owner --no-privileges`, řádky 1322-1329), úkol 8 (`verify`, řádek 1704), úkol 9 krok 3 (`pg_restore`, řádek 1991), akceptační kritéria 9 až 12.

Podrobný rozbor je výš v sekci „Potvrzení dvou nálezů zadavatele", bod 2.

**Oprava, dvě varianty:**
1. Z obou příkazů vypustit `--no-privileges`. Role musí existovat před obnovou, což zajišťuje initdb v P01. Nejjednodušší, ale váže obnovu na to, že cílová instalace má stejná jména rolí.
2. Vyžádat si od P03 exportovanou funkci `reapplyRolePrivileges(databaseUrl): Promise<void>`, která spustí obsah migrací 0005 a 0006 znovu, a volat ji v `restoreBackup` hned po `runMigrations`. Čistší, protože soubory migrací vlastní P03 a P16 do nich podle kapitoly 8 P03 nesmí sahat.

Doporučuji variantu 2 a variantu 1 jako doplněk (`--no-privileges` u dumpu je stejně zbytečné omezení).

---

### K6. `runMigrations` má jinou signaturu, než P16 volá, a `maxKnownSchemaVersion` neexistuje

**Kde v plánu:** kapitola 0.6, rozhraní I→P03.2 (řádek 82) fixuje `runMigrations({ databaseUrl }): Promise<{ applied: string[] }>` a `maxKnownSchemaVersion(): number`. Volání na řádcích 1712 (úkol 8), 2000 (úkol 9), 4538 (úkol 19, `migration.applied.length`) a 3086 (úkol 13).

**Co P03 má:** `export async function runMigrations(options: RunMigrationsOptions): Promise<void>` (P03 řádek 972), volaná jako `runMigrations({ url, migrationsFolder, ensurePartitions })` (P03 řádky 630, 6892). Parametr se jmenuje `url`, ne `databaseUrl`. Návratová hodnota je `void` a test na řádku 6894 to výslovně fixuje (`.resolves.toBeUndefined()`). `maxKnownSchemaVersion` se v P03 nevyskytuje vůbec, maximum se počítá lokálně jako `const maxVersion = entries.length` uvnitř runneru (P03 řádek 977). Exportují se jen `MIGRATION_ADVISORY_LOCK_ID`, `MigrationError`, `runMigrations` (P03 řádek 7030).

**Oprava:** P03 přejmenuje parametr na `databaseUrl` (nebo přijme oba), změní návratovou hodnotu na `{ applied: string[] }` a doplní `export function maxKnownSchemaVersion(): number` do `migrate.ts` i do `index.ts`. Test na P03 řádku 6894 se upraví zároveň.

**Co je naopak v pořádku:** exit code 5, kód `schema_version_ahead` a čtení `system_settings.schema_version` sedí na obou stranách (P03 řádky 987-990, P16 řádky 3090-3095). Rozdělení odpovědnosti je taky čisté: kód 5 při startu vlastní P01, P16 doplňuje jen kontrolu v doktoru, což kapitola 6 P16 na řádku 8648 správně přiznává.

---

### K7. Testovací harness `@mlain/db/testing` v P03 neexistuje

**Kde v plánu:** importy `startTestPostgres` na řádcích 1052, 1195, 1554, 1805, 2533, 2988, 3557, 3713, 4019, 4262, 4395, 4696 a dalších, dohromady dvacet testů. P16 od harnessu chce `startTestPostgres({ withSchema: true })`, `pg.ownerUrl`, `pg.sql<T>(sql, params)` vracející pole, `pg.stop()`, `pg.seedMinimalInstallation({ contacts })` a `pg.truncateWorkspaceData(workspaceId)`.

**Co P03 má:** `packages/db/test/helpers/container.ts` se `startHarness(options)` a typem `Harness = { as(role): Pool, urlFor(role): string, stop() }` (P03 úkol 3, řádky 508-730), plus `test/helpers/fixtures.ts` se `seedTwoWorkspaces(migrator: Pool)`. Leží to v `test/`, ne v `src/`, `tsconfig` má `rootDir: ./src` a subpath `./testing` v `package.json` není. Z `packages/core` je to nedosažitelné.

**Oprava:** P03 přesune harness do `packages/db/src/testing.ts`, doplní subpath `"./testing"` a API rozšíří o `ownerUrl`, `sql`, `seedMinimalInstallation` a `truncateWorkspaceData`. Alternativa, aby si harness napsal P16 sám, znamená duplicitní spouštění testcontaineru a šesti rolí, čemuž se úkol 3 v P03 vědomě vyhýbá.

---

## DŮLEŽITÉ nálezy

### D1. `campaigns.last_test_sent_at` neexistuje, krok „zkušební odeslání" nemá na čem stát

**Kde:** úkol 22 krok 3, `loadFlags`, řádek 5371: `(SELECT count(*) FROM campaigns WHERE workspace_id = $1 AND last_test_sent_at IS NOT NULL)::int AS test_sends`.

**Co P03 má:** `grep -c last_test_sent_at` = 0. Kompletní výpis sloupců `campaigns` (P03 řádky 2649-2917) ho neobsahuje.

**Oprava:** nežádat nový sloupec. P03 má `messages.kind` s hodnotami `campaign|test` (rozhodnutí R2) a částečný index `(next_attempt_at) WHERE pending AND kind='test'`. Přepsat na `EXISTS (SELECT 1 FROM messages m WHERE m.workspace_id = $1 AND m.kind = 'test' AND m.sent_at IS NOT NULL)`. Pokud by zadavatel sloupec přesto chtěl, musí se určit, kdo ho zapisuje: `mlain_sender` má na `campaigns` jen sloupcový UPDATE na `status` a `pause_reason` (P03 řádek 5232), takže by ho zapsat nemohl.

**Proč:** dotaz spadne na `column "last_test_sent_at" does not exist`, takže shodí celý panel onboardingu, ne jen jeden krok.

---

### D2. Pojistka proti tiché prázdné záloze přehlédne devět partitionovaných tabulek

**Kde:** úkol 5 krok 3, `assertDumpRoleSeesAllRows`, řádek 1152: `WHERE c.relkind = 'r'`.

**Co P03 má:** RLS se zapíná na rodičovské partitionované tabulce, která má `relkind = 'p'`, ne `'r'`. Jde o `messages`, `message_events`, `web_events`, `audit_log`, `webhook_events`, `webhook_deliveries`, `provider_event_receipts`, `inbound_deliveries` a `message_engagement` (rozhodnutí R8, devět tabulek). Jednotlivé měsíční partition mají `relkind = 'r'`, ale `relrowsecurity` na nich je `false`, protože politiky se dědí z rodiče až za běhu dotazu. Dotaz tedy prověří 63 běžných tabulek a **ani jednu z devíti největších**.

**Oprava:** `AND c.relkind IN ('r','p')`. Od P03 to nepotřebuje nic.

**Proč:** pojistka má být to jediné, co stojí mezi tichou ztrátou dat a hlasitým selháním. V současném tvaru by u role, která vlastní běžné tabulky, ale ne partitionované, pustila zálohu, ve které jsou všechny zprávy a všechny události prázdné.

---

### D3. `mlain doctor` ignoruje druhý zdroj pokolení klíče v datech

**Kde:** úkol 12 krok 3, `generationsInData`, řádek 2650. Komentář nad funkcí slibuje „suppression otisky a šifrové obálky", dotaz čte jen `suppressions.fingerprint_key_id`.

**Co P03 má:** `gdpr_requests.subject_email_fingerprint_key_id smallint` (P03 řádky 219-226) je druhý a jediný další odkaz na pokolení klíče v datech.

**Oprava:** doplnit `UNION SELECT DISTINCT subject_email_fingerprint_key_id FROM gdpr_requests WHERE subject_email_fingerprint_key_id IS NOT NULL`. Index na ten sloupec P03 nemá, ale `gdpr_requests` je malá tabulka a sekvenční průchod jednou za běh doktoru je v pořádku. Index od P03 žádat nemusíme.

**Proč:** instalace, která ztratila klíč použitý jen u výmazů podle GDPR, projde doktorem jako zdravá, přestože nedokáže ověřit ani jeden vymazaný subjekt.

---

### D4. `mlain reset-password` zakládá session se sloupci, které neexistují

**Kde:** úkol 18 krok 1, testovací fixture, řádek 4060: `INSERT INTO sessions (id, user_id, token_hash, expires_at)`.

**Co P03 má:** `sessions` má `absolute_expires_at timestamptz NOT NULL` a `csrf_secret bytea NOT NULL` (P03 řádky 1248-1260). Sloupec `expires_at` neexistuje, `csrf_secret` nemá default.

**Oprava:** `INSERT INTO sessions (id, user_id, token_hash, csrf_secret, absolute_expires_at)`.

**Proč:** test odvolání sessions po resetu hesla nikdy nedoběhne.

---

### D5. Ukázková data se nesmažou beze zbytku, jakmile se z demo kampaně jednou odešle

**Kde:** úkol 26 (název „Odstranění ukázkových dat beze zbytku"), `deleteAll`, řádky 6840-6890.

**Co P03 má:** migrace 0006 (P03 řádky 5322-5366) odebírá `mlain_app` právo `DELETE` na `message_events` i na `web_events`. Zlatá cesta v úkolu 32 přitom skutečně odešle kampaň přes Mailpit, takže vzniknou řádky v `messages`, `message_events` a `message_engagement`. FK z `message_events` na `messages` v P03 neexistuje (celý plán má jen dva `FOREIGN KEY`, řádky 3785 a 4060), takže `DELETE FROM messages` projde, ale osiřelé `message_events` po smazané kampani zůstanou navždy. Nemažou se ani `contact_engagement` a `message_engagement`.

**Oprava:** doporučuji zmírnit slib v názvu úkolu a v dokumentaci: append-only tabulky se z principu nemažou a `message_events` je auditní stopa. Druhá varianta, vyžádat si `GRANT DELETE ON message_events TO mlain_gdpr` a purge pouštět tou rolí, je horší, protože otevírá mazání auditní stopy kvůli ukázkovým datům.

---

### D6. Role `mlain_backup` zůstává po P16 bez jediného použití

**Kde:** P16 rozhodnutí A2 (řádek 46) a rozhraní I→P01.3 (řádek 76) zálohu vědomě pouští pod `DATABASE_URL_MIGRATOR`.

**Co P03 má:** migrace 0005 (P03 řádky 5285-5290) roli zakládá grantem `GRANT USAGE ON SCHEMA public TO mlain_backup` a v komentáři počítá s tím, že `pg_read_all_data` přidá docker/initdb.

**Oprava, rozhodnout jedno ze dvou:**
1. P01 dá `ALTER ROLE mlain_backup BYPASSRLS` (vyžaduje superuživatele, tedy patří do initdb, ne do migrace) a P16 zálohuje pod ní. Bezpečnější, protože záložní role nesmí zapisovat, kdežto `mlain_migrator` smí všechno. V tom případě potřebuje role navíc `GRANT USAGE ON SCHEMA drizzle, pgboss`, protože dump i `isDatabaseEmpty` s těmi schématy počítají.
2. Roli i její grant z P03 vypustit, ať ve schématu neleží mrtvý objekt, který svádí k použití.

**Proč:** role, kterou nic nepoužívá a která by při použití vyrobila tichou prázdnou zálohu, je past na příštího člověka.

---

## POZNÁMKY

### N1. Partitiony v provozu nikdo z P16 nezakládá a `PoolKind` na to nemá tvar

Rozhodnutí A10 (řádek 54) se opírá o job `platform.maintain_partitions`, který zakládá partition na aktuální a tři následující měsíce. P16 nevolá ani `ensureUpcomingPartitions`, ani `createMonthlyPartitions`, ani `dropPartitionsBefore`, takže povinné veto z rozhodnutí R17 se P16 netýká a `demoCampaignSentAt` (ořez na začátek měsíce, řádek 5904) je správná obrana.

Stojí ale za zapsání jako mezera napříč plány: `CREATE TABLE ... PARTITION OF` smí jen vlastník, tedy `mlain_migrator`, kdežto worker běží pod `mlain_app`, a `PoolKind = 'app' | 'readOnly'` (P03 řádek 5702) třetí variantu nenabízí. `mlain_maintenance` má jen `DELETE ON web_events`, takže partition odpojit ani zahodit nemůže. Někdo (P01 nebo P04) musí říct, pod jakým spojením ten job běží, jinak první den pátého měsíce přestanou jít zapsat zprávy.

### N2. `system_settings.settings.migration_failures` nikdo nečte

P03 rozhodnutím R7 zavádí počítadlo neúspěchů migrace v `settings` (P03 řádky 1073-1074, 1469). P16 slovo `migration_failures` nezná. `mlain doctor` je jediné místo, kde by ta hodnota dávala smysl. Návrh: doplnit do `checks-runtime.ts` kontrolu, která nenulový počet hlásí jako varování s odkazem na log migrace. Není to blokující nález, jen nevyužitý mechanismus.

### N3. Obnova bere s sebou i frontu úloh

`isDatabaseEmpty` (řádek 2043) i `pg_dump` bez `--schema` pracují se schématy `public`, `drizzle` a `pgboss`. Se schématem P03 to sedí (`drizzle.__drizzle_migrations` P03 řádek 996, `pgboss.*` na whitelistu P03 řádek 103). Důsledek stojí za jednu větu v runbooku úkolu 35: obnova vrátí i rozpracované úlohy z `pgboss`, takže po obnově se rozjede odesílání, které v okamžiku zálohy běželo.

### N4. Keyring tabulku nepotřebuje a `SECRET_KEY_PREVIOUS` je v tomhle konzistentní

Ověřeno: tabulka klíčů v P03 není a P16 ji nechce, což je správně. Jediné odkazy na pokolení v datech jsou `suppressions.fingerprint_key_id` (NOT NULL, vlastní index `idx_suppressions__fingerprint_key_id`) a `gdpr_requests.subject_email_fingerprint_key_id` (nullable, bez indexu, viz D3). `loadOpsKeyring` (řádek 736) čte pokolení z prostředí a `checkKeyIdCeiling` hlídá strop 255 proti typu `smallint`, což je s přehledem v rozsahu. Argument, proč se `SECRET_KEY_PREVIOUS` nikdy nevyprazdňuje, je v plánu i ve schématu formulován shodně (P03 komentář u `suppressions.fingerprint`).

### N5. `mlain doctor` nepotřebuje novou tabulku

Výsledky kontrol jdou na stdout, exit code počítá `exitCodeFor`, historie běhů se nikam neukládá a plán ji nikde nečte. Žádná tabulka pro výsledky ani pro historii běhů ve schématu chybět nemůže.

---

## Co jsem ověřil jako v pořádku

- **Manifest ukázkových dat ve `workspaces.settings.demoData`.** `workspaces.settings jsonb NOT NULL DEFAULT '{}'` v P03 existuje (R7), `jsonb_set` i `settings - 'demoData'` jsou korektní, mazání podle manifestu místo podle značky je dobře odůvodněné.
- **Panel onboardingu ve `workspaces.settings.onboarding`.** Stejný mechanismus, žádný nový sloupec potřeba není.
- **Zkušební režim ve `workspaces.settings.trialMode`.** Totéž.
- **`system_settings`.** `schema_version`, `installation_id`, `secret_key_fingerprint` i `settings` existují a P16 je čte správnými jmény. Tabulka je na whitelistu bez RLS, takže tyhle kontroly fungují i pod `mlain_app`.
- **Kód `schema_version_ahead` a exit code 5.** Sedí na obou stranách, rozdělení odpovědnosti (P01 při startu, P16 v doktoru) je v kapitole 6 P16 přiznané správně.
- **Vložení do `suppressions` v testech a v E2E** (řádky 2572, 8244). Všechny sloupce existují, `fingerprint_key_id` je NOT NULL smallint, `source = 'ses_event'` projde, protože na `suppressions.source` P03 CHECK nemá (CHECK je jen na `reason`).
- **Zápis do `audit_log` s `workspaceId: null`.** Politika `ws_isolation_audit` má ve `WITH CHECK` větev `workspace_id IS NULL` právě kvůli globálním akcím (P03 řádky 5085-5091), takže audit u zálohy, obnovy a rotace projde i pod `mlain_app`. `audit_log.action` nemá CHECK, takže vlastní akce P16 (`backup.created`, `backup.verified`, `backup.restored`, `credentials.rotated`, `demo_data.seeded`, `demo_data.purged`, `user.password_reset_from_cli`) jdou zapsat bez zásahu do schématu.
- **`mlain reset-password` proti `users` a `sessions`.** Obě tabulky jsou na whitelistu bez RLS, takže běh pod `DATABASE_URL` je tady v pořádku (kromě jmen sloupců, viz D4).
- **`assertDumpRoleSeesAllRows` a práva.** `pg_roles` i `pg_class` jsou čitelné pro `PUBLIC`, dotaz nepotřebuje od P03 žádný doplněk (kromě opravy `relkind`, viz D2).
- **`isDatabaseEmpty` a seznam schémat.** `public`, `drizzle`, `pgboss` odpovídá tomu, co P03 zakládá.
- **`demoCampaignSentAt`.** Ořez na začátek měsíce je správná obrana proti chybějící DEFAULT partition (rozhodnutí R8, „ŽÁDNÁ DEFAULT partition").
- **E2E zlaté cesty.** Nepotřebují žádnou tabulku ani sloupec, který by ve schématu chyběl. Jediné přímé SQL v celé E2E části je INSERT do `suppressions` na řádku 8244 a ten sedí.
- **Kapitola 0.7 (známá mezera).** Přiznání, že příznak ukázkovosti kontakt nemá a P16 ho nezavádí, je poctivé a se schématem P03 konzistentní.

---

## Souhrnná tabulka

| Co doplnit | Kdo žádá | Typ nebo tvar | Proč |
|---|---|---|---|
| `packages/db/src/connection.ts` + subpath `./connection` s `openConnection` | P16 úkoly 5-26, 14 souborů | `openConnection(url): Promise<DbConnection>`, `query<T>` vrací pole, `transaction`, `close` | P03 má jen `createPool` s tvarem `{rows}`; bez toho se P16 nezkompiluje |
| Migrátorský pool v `PoolKind` | P16 záloha, obnova, rotace, upgrade | `PoolKind = 'app' \| 'readOnly' \| 'migrator'` | provozní příkazy musí jet pod rolí, na kterou neplatí RLS |
| `maxKnownSchemaVersion(): number` v `migrate.ts` a v `index.ts` | P16 kap. 0.6 řádek 82, úkol 13 řádek 3086 | `export function maxKnownSchemaVersion(): number` | v P03 hodnota existuje jen jako lokální `entries.length` |
| `runMigrations` sjednotit na `{ databaseUrl }` a `Promise<{ applied: string[] }>` | P16 úkoly 8, 9, 19 (řádek 4538) | změna signatury v P03 | P03 má `{ url }` a `Promise<void>`, testy to fixují |
| `packages/db/src/testing.ts` + subpath `./testing` | P16 20 databázových testů | `startTestPostgres`, `ownerUrl`, `sql`, `seedMinimalInstallation`, `truncateWorkspaceData` | harness P03 leží v `test/`, mimo `rootDir`, není exportovatelný |
| `reapplyRolePrivileges(databaseUrl)` nebo vypustit `--no-privileges` | P16 úkol 9 obnova | funkce v P03, která znovu spustí migrace 0005 a 0006 | po obnově nemá `mlain_app` žádný grant a append-only ochrana je pryč |
| Opravit `ENCRYPTED_COLUMNS` na `sending_providers.config_encrypted`, `ai_provider_credentials.api_key_encrypted` | P16 úkoly 16, 17 | oprava v P16, plus pole `storage: 'text' \| 'bytea'` | tři ze čtyř položek registru ve schématu neexistují, dva sloupce jsou TEXT |
| Opravit seed ukázkových dat | P16 úkoly 24, 25 | `attributes` místo `custom_fields`, doplnit `design`, `design_hash`, `definition_hash`, `source`, zrušit `slug`, `id` a `created_at` u `list_subscriptions` | seed spadne na prvním INSERTu |
| Nahradit `campaigns.last_test_sent_at` dotazem nad `messages.kind = 'test'` | P16 úkol 22 | oprava v P16, nebo nový sloupec od P03 | sloupec neexistuje a sender by ho ani nesměl zapsat |
| `campaigns.sent_at` → `finished_at`, `campaign_stats.bounced` → `bounced_hard`, `computed_at` → `updated_at` | P16 úkol 24 | oprava v P16 | sloupce neexistují |
| `sessions`: `absolute_expires_at` a `csrf_secret` | P16 úkol 18 | oprava fixture | `expires_at` neexistuje, `csrf_secret` je NOT NULL |
| Doktor a rebuild pod `adminUrl`, endpointy přes `withWorkspace` | P16 úkoly 12, 13, 19, 22, 23, 25, 26, 27 | oprava v P16 | pod `mlain_app` bez kontextu vrací RLS nula řádků a kontroly mlčí |
| `assertDumpRoleSeesAllRows`: `relkind IN ('r','p')` | P16 úkol 5 | oprava v P16 | devět partitionovaných tabulek pojistka přeskočí |
| `generationsInData`: přidat `gdpr_requests.subject_email_fingerprint_key_id` | P16 úkol 12 | UNION do dotazu, index není potřeba | ztráta klíče použitého jen u výmazů projde doktorem jako zdravá instalace |
| Rozhodnout osud role `mlain_backup` | P16 A2 a I→P01.3, P03 migrace 0005 | buď `BYPASSRLS` v initdb, nebo roli zrušit | role bez použití, která by při použití vyrobila tichou prázdnou zálohu |

---

## Nálezy, které jsem podle zadání nehlásil znovu

Už evidované jinde: `identities.shared`, `message_events.processed_at`, `withWorkspaceTx`, `createSystemContext`, příznak ukázkovosti (N8), záloha pod rolí s RLS (N7, ale potvrzuji ho výš na žádost zadavatele), `campaign_links.id` jako UUIDv5, `campaigns.compile_meta`, chybějící kód `contract_mismatch`.
