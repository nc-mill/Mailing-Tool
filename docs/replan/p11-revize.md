# Revize P11 (import, export, segmenty) proti schématu P03

Datum: 2026-08-01
Recenzovaný plán: `docs/superpowers/plans/2026-07-31-p11-import-export-segmenty.md` (10 224 řádků)
Zdroj pravdy pro schéma: `docs/superpowers/plans/2026-07-31-p03-databaze-schema-rls.md`
Předmět: soulad doménového plánu s databázovým schématem. P03 je jediný plán, který smí zakládat a měnit schéma.

## Verdikt

**Plán není ve stávající podobě proveditelný.** Devět kritických nálezů, z toho tři takové, které shodí kód hned při prvním spuštění (neexistující rozhraní `Tx`, neexistující transakční primitiva, dva chybějící sloupce v bezpodmínečném `INSERT` a `UPDATE`), a tři, které selžou tiše (sken napříč projekty pod RLS, dotazy bez partiční podmínky, osiřelé indexy nad `attributes`).

Podstatné je, že věcný návrh plánu je dobrý a slovníky sedí. Většina oprav je na straně P11 (jiná jména sloupců, doplnění podmínek do kompilátoru), ne na straně P03. Skutečné požadavky na P03 jsou jen čtyři: dva sloupce v `imports`, vázané varianty transakčních primitiv a přístupová cesta pro plánovače běžící napříč projekty.

Vlastní kapitola 11 plánu (Požadavky na P03) je neúplná a zčásti chybná: požadavek 3.1 je už splněný, požadavek 10.1 je adresovaný P10 a P14, ačkoli sloupce vlastní P03, a rozhodnutí R13 stojí na tvrzení o P03, které neplatí.

### Rozhodnutí U3 zapracované do této revize

Kolize vlastnictví fronty ke kontrole oslovení mezi P07 a P11 je rozhodnutá **ve prospěch P07**. Z P11 vypadávají **úkoly 37, 38 a 53**. Důvod: vokativ se počítá při zápisu kontaktu, takže nejisté případy vznikají i přes API, z formuláře a z příchozího webhooku, a ty cesty vlastní P07.

Dopad na tuto revizi:

- Nález K9 (`users.attributes`) leží v úkolu 38 a **přechází na P07**. Sloupec tím nezmizí, P07 na něj narazí taky.
- Nález P2 (`import_errors.severity`) a P3 (`first_name_key` v dávkovém zápisu) zůstávají v P11, protože leží v úkolu 31, který je součástí importní roury.
- Kapitola 13.1 plánu se uzavírá, rozpor 11 se ruší. Do kapitoly 11 přibývá požadavek na P07: „poskytni `listReviewGroups(ctx, { importId })`, aby na ni výsledková obrazovka importu mohla odkázat s filtrem na konkrétní import."
- Kritéria 24, 25 a 30 části 2 a kritéria 39 až 42 části 6 přecházejí na P07.
- Zbývajících 57 úkolů se nemění.

---

## Co jsem ověřil jako v pořádku

Ověřeno grepem přímo v P03, aby se to nehlásilo zbytečně a aby se to při další revizi neprocházelo znovu.

| Oblast | Ověření |
|---|---|
| `imports.status` | Osm hodnot v `assertTransition` (úkol 33, krok 4) přesně odpovídá `ck_imports__status`. Žádný `paused`, žádný `reverting`. |
| `imports.delimiter` | `CANDIDATES` v úkolu 25 je `[';', ',', '\t', '\|']`, tedy přesně `ck_imports__delimiter`. Pátý oddělovač nikde. |
| `imports.encoding_source` | Detekce vrací `bom`, `utf8_validation`, `score` (úkol 24), ruční přepis zapisuje `manual` (úkol 34). Všechny čtyři v CHECKu. |
| `imports.encoding` | P11 zapisuje i `iso-8859-2`. P03 na tomhle sloupci **žádný CHECK nemá**, takže je to v pořádku. |
| `exports.kind` | P11 používá jen `contacts` a `import_errors`. Segmenty ani kampaně neexportuje. |
| `exports.format`, `status`, `encoding`, `delimiter` | `csv`, `queued`/`running`/`completed`, `utf-8-bom`/`utf-8`/`windows-1250`, `;`/`,`. Vše v mezích CHECKů. |
| `errors.csv` v `iso-8859-2` | **Neporušuje** `ck_exports__encoding`, protože se servíruje přímo z routy (úkol 43) a žádný řádek v `exports` nezakládá. |
| Prvotřídní sloupce kontaktu | Všech 13 z `TEMPLATES` v úkolu 8 (`email`, `email_domain`, `first_name`, `last_name`, `gender`, `status`, `locale`, `source`, `created_at`, `updated_at`, `last_activity_at`, `vocative_confidence`, `processing_restricted`) v P03 existuje. |
| Obálka segmentu | `contacts.workspace_id`, `deleted_at`, `processing_restricted`, `email`, `email_fingerprints` a `suppressions.workspace_id`, `removed_at`, `email`, `fingerprint` existují. Typy sedí (`bytea` proti `bytea[]`). |
| `ON CONFLICT` u kontaktů | `ON CONFLICT (workspace_id, email) WHERE deleted_at IS NULL` je správná inference částečného indexu `uq_contacts__workspace_email`. Bez `WHERE` by to bylo `42P10`. |
| `ON CONFLICT` u `name_overrides` | `(workspace_id, kind, name_key)` sedí na `uq_name_overrides__ws_kind_key`. |
| `segment_members` | `INSERT ... SELECT` ve `freezeSegment` zapisuje `segment_id`, `contact_id`, `workspace_id`, `added_at` nechává na defaultu. **Statické segmenty nic dalšího nepotřebují**, sloupec „kdo přidal" ani „zdroj" v plánu nikde není. |
| `segments` | Všechny sloupce, které P11 zapisuje i čte, existují: `definition`, `definition_hash`, `ast_version`, `cached_count`, `cached_is_exact`, `cached_at`, `cached_duration_ms`, `recompute_state`, `last_error_code`, `preset_key`, `kind`, `deleted_at`. **Kompilátor nepotřebuje `compiled_sql`, `used_fields`, `depends_on`, `materialized_at` ani `last_run_ms`**, protože kompiluje za běhu a odkazy řeší `resolveReferences` v paměti. |
| `idx_segments__stale` | `ON (cached_at NULLS FIRST) WHERE deleted_at IS NULL AND kind = 'dynamic'` **sedí** na `scheduleStale` v úkolu 22, který filtruje přesně těmito třemi podmínkami. |
| `idx_contacts__ws_vocative_review` | Existuje na `(workspace_id, first_name_key, created_at DESC)` s podmínkou fronty. **Požadavek 3.1 z kapitoly 11 je splněný**, není to nález. Po U3 přechází i tak na P07. |
| `contacts.email_fingerprints` | Existuje jako `bytea[]`. Požadavek 3.4 je splněný. |
| Rozšíření | `pg_trgm` i `btree_gin` jsou v R1 P03. Požadavek 3.7 je splněný. |
| `message_events.type` | `delivered`, `open`, `click`, `bounced_hard` jsou ve dvanáctihodnotovém slovníku. |
| Fronta ke kontrole oslovení | P11 si **ve schématu** nenárokuje nic navíc oproti P07. Sloupce `vocative_*`, `first_name_key` i tabulka `name_overrides` jsou sdílené a v P03 existují. Rozhodnutí U3 tedy nezanechává ve schématu žádný osiřelý sloupec. |

---

## KRITICKÉ nálezy

### K1. `Tx` je `pg.PoolClient`, ale P11 na něm volá Drizzle

**Místo:** Prostupuje plánem. `tx.execute(sql, params)` 47×, například úkol 31 krok 4 (`INSERT INTO import_errors`, `UPDATE imports`) a úkol 15 krok 3 (`SET LOCAL`). Drizzle query builder v úkolu 19 krok 4: `tx.insert(segments).values({...})`, `tx.select().from(segments)`, `tx.update(segments).set(values)`.

**Co P03 má:** `packages/db/src/repo/tx.ts`: `export type Tx = PoolClient;`. Syrový `pg` klient. P03 sám všude píše `const { rows } = await tx.query(sql, params)`. `PoolClient` nemá `.execute()`, `.select()`, `.insert()` ani `.update()`.

**Oprava:** Rozhodnout na jedné straně.

- Varianta A (menší zásah do P11): P03 změní `Tx` na Drizzle transakci a primitiva začnou předávat `db.transaction()`.
- Varianta B (žádný zásah do P03, doporučeno): P11 přepíše veškerý přístup na `tx.query()` a `{ rows }` a Drizzle builder vypustí. Týká se úkolů 15, 17, 19, 22, 31, 34, 35, 38 a 39.

**Proč:** Není to překlep ve jméně, ale rozdíl mezi „vrací pole řádků" a „vrací `QueryResult`". P11 na dvaceti místech typuje návratovou hodnotu jako `as { id: string }[]`, což u `pg` mlčky projde typecheckem a spadne až za běhu na `rows is not iterable`.

### K2. `withWorkspaceId` a `withoutContext` v `@mlain/db` neexistují

**Místo:** Kapitola 2 (seznam importů), úkol 15 krok 3, úkol 19 krok 4, úkol 22 kroky 3 a 4, úkol 31 krok 3, úkol 34, úkol 35 krok 4. Celkem 28 volání `withWorkspaceId`, tři importy `withoutContext`.

**Co P03 má:** `export { withReadOnly, withUser, withWorkspace, type Tx }`. `withoutContext` v P03 není nikde. Všechna tři primitiva berou `pool: Pool` jako **první argument** (`withWorkspace(pool, ctx, fn)`). P11 pool mít nesmí, protože si sám v kapitole 2 zakazuje jeho import mimo `packages/db`.

**Oprava:** P03 exportuje vázané varianty nad interním poolem:

```ts
withWorkspaceId(workspaceId: string, fn: (tx: Tx) => Promise<T>): Promise<T>
withReadOnly(ctx: WorkspaceContext, timeoutMs: number, fn: (tx: Tx) => Promise<T>): Promise<T>
```

Je to stejná rodina jako už evidovaný `withWorkspaceTx`, ale jiný podpis: P11 potřebuje **řetězec**, ne `WorkspaceContext`, aby nevznikl cyklus `db → core → db`.

**Proč:** Bez vázané varianty nemá žádný doménový balíček jak transakci otevřít, aniž by porušil vlastní ESLint pravidlo.

### K3. `withoutContext` je sken přes všechny projekty, ale RLS ho utne na nulu

**Místo:** Úkol 22 krok 3, `scheduleStale` v `jobs/recount.ts`. Úkol 35 krok 4, `recoverStaleImports` v `jobs/recover-stale.ts`.

**Co P03 má:** `segments` i `imports` jsou v seznamu 63 tabulek s politikou `ws_isolation` (migrace 0004). Politika je `USING (workspace_id = current_setting('mlain.workspace_id', true)::uuid)` a P03 k tomu sám píše: „Porovnání s NULL je NULL, tedy nepravda, tedy ŽÁDNÉ ŘÁDKY." `mlain_app` nemá `BYPASSRLS` (P03 to výslovně odmítá) a jediný bypass, `sender_bypass`, je na sedmi tabulkách, mezi kterými `segments` ani `imports` nejsou.

**Oprava:** Buď sedmá role `mlain_scheduler` s `BYPASSRLS` a grantem `SELECT` na `segments` a `imports`, nebo dvě funkce `SECURITY DEFINER` vlastněné `mlain_migrator`:

```sql
list_stale_segments(cutoff timestamptz) RETURNS TABLE (id uuid, workspace_id uuid)
list_stale_imports(stale_minutes int) RETURNS TABLE (id uuid, workspace_id uuid)
```

Druhá varianta je užší a nepotřebuje zakládat roli mimo migraci.

**Proč:** Obě funkce vrátí nula řádků tiše, ne chybou. Hodinový cron bude roky reportovat `{ scheduled: 0 }`, indexy `idx_segments__stale` a `idx_imports__stale` zůstanou nepoužité a zaseknuté importy se nikdy neobnoví. `imports.updated_at` má v P03 komentář, že je to jediný signál živosti, takže P03 tenhle scénář předpokládá, ale nedal mu přístupovou cestu.

### K4. Rollup `contact_engagement`: pět jmen sloupců nesedí a požadavek jde na špatný plán

**Místo:** Úkol 12 krok 3, mapa `ROLLUP_COUNT`: `sent_count`, `delivered_count`, `opened_count`, `clicked_count`, `bounced_count`. Použitá v `countExpr`. Kapitola 11, požadavek 10.1 tytéž sloupce žádá po **P10 a P14** s poznámkou „Je to tvrdý požadavek, ne přání".

**Co P03 má:** `sent_total`, `delivered_total`, `opens_total`, `clicks_total`, `bounces_total`. Pozor na dvě odchylky: `opens_*` a `clicks_*` jsou v množném čísle podstatného jména, ne příčestí. Časová razítka `last_sent_at`, `last_delivered_at`, `last_open_at`, `last_click_at`, `last_bounce_at` naopak sedí přesně, stejně jako předpočítaná okna `opens7d`, `opens30d`, `opens90d` a jejich obdoby (požadavek 10.2 je splněný).

**Oprava:** P11 přepíše `ROLLUP_COUNT` na jména z P03. Požadavek 10.1 se z kapitoly 11 vyškrtne, protože sloupce už existují a vlastní je P03, ne P10 a P14. Na P10 a P14 zůstává jen plnění hodnot.

**Proč:** Adresát požadavku je špatně, takže by ho P10 ani P14 nemohl splnit (schéma vlastní P03) a nikdo by ho zároveň nezamítl jako už hotový. Dotaz spadne na `42703 column ce.opened_count does not exist` u každého segmentu s `count_gte` nebo `count_lte`.

### K5. `imports.stored_error_count` a `imports.resume_from_import_id` chybí a používají se bezpodmínečně

**Místo:** Úkol 31 krok 4: `stored_error_count = stored_error_count + $10` uvnitř checkpointového `UPDATE imports`, tedy v transakci, která běží u **každé dávky každého importu**. Úkol 34, funkce `resumeImport`: `INSERT INTO imports (..., resume_from_import_id, ...) ... RETURNING id, checkpoint_byte, resume_from_import_id`.

**Co P03 má:** Tabulka `imports` má osm čítačů (`processed_rows`, `created_rows`, `updated_rows`, `skipped_rows`, `suppressed_rows`, `error_rows`, `warning_rows`, `review_rows`), ale ani `stored_error_count`, ani `resume_from_import_id`.

**Oprava:** Nová dopředná migrace v P03:

```ts
storedErrorCount: bigint({ mode: 'number' }).notNull().default(0),
resumeFromImportId: uuid().references(() => imports.id, { onDelete: 'set null' }),
```

**Proč:** P11 u požadavku 3.2 píše, že bez sloupce se počet zjistí dotazem `count(*)`, ale ten fallback v kódu není: `UPDATE` sloupec zmiňuje natvrdo. Podobně `resume_from_import_id` je v `INSERT` i v `RETURNING`. Obojí je `42703` při prvním běhu, ne degradace výkonu.

### K6. `campaigns.sent_at` neexistuje

**Místo:** Úkol 12 krok 3, funkce `slowExists`, větev `last_n_campaigns`: `AND me.campaign_id IN (SELECT id FROM campaigns WHERE workspace_id = ... AND sent_at IS NOT NULL ORDER BY sent_at DESC LIMIT ...)`.

**Co P03 má:** `campaigns` má `release_at`, `scheduled_at`, `started_at`, `finished_at`, `paused_at`, ale žádné `sent_at`. Sloupec `sent_at` v P03 existuje jen na `messages`.

**Oprava:** Sloupec **nepřidávat**. P11 přepíše na existující sloupce:

```sql
AND status IN ('sent','partially_sent') AND finished_at IS NOT NULL ORDER BY finished_at DESC
```

**Proč:** Levnější než migrace a slovník `campaigns.status` už rozlišuje `sent` od `partially_sent`. Bez opravy spadne každý segment s rozsahem „posledních N kampaní".

### K7. Segmenty přes partitionované tabulky bez partiční podmínky

**Místo:** Úkol 12 krok 3. Funkce `slowExists`: `AND me.ts >= ${asOf} - make_interval(days => ...)` nad `message_events`. Funkce `compileEventCondition`: `SELECT 1 FROM web_events we WHERE we.contact_id = ... AND we.name = ...`, žádná časová podmínka vůbec.

**Co P03 má:** `message_events` je partitionovaná podle **`received_at`**, `web_events` podle **`received_at`**, obě měsíčně a bez DEFAULT partition. `me.ts` je jiný sloupec než `received_at` (`ts` je čas události od poskytovatele, `received_at` čas přijetí), takže plánovač neprořeže nic a projde všechny měsíční partitiony.

**Oprava:** Není to schéma, je to kompilátor.

- Do `slowExists` přidat `AND me.received_at >= ${asOf} - make_interval(days => ...)` vedle podmínky na `ts`.
- U `web_events` přidat horní i dolní mez na `received_at`. Lepší varianta: použít `web_event_months` s PK `(workspace_id, subject_kind, subject_id, month)`, což je tabulka, kterou P03 pro přesně tenhle dotaz zavedl a P11 ji nezná.
- Ve variantě `countExpr` pro metriku `sent` chybí podmínka na `m.created_at` úplně, doplnit taky.

**Proč:** Bez prořezání je „udělal událost purchase" sken přes všechny měsíce webových událostí. `SEGMENT_PREVIEW_TIMEOUT_MS` je 3 s, takže náhled skončí na `57014` a spadne do odhadu z `EXPLAIN`. Uživatel dostane „přibližně" u dotazu, který by při prořezání byl přesný.

### K8. `contact_fields.indexed` a `index_state` nemá vlastníka

**Místo:** Úkol 16, `resolveReferences`: `if (!row.indexed) out.unindexedFields.push(key)`. Podle toho se vydává varování `segment_unindexed_field` s textem z katalogu (úkol 41). `index_state` P11 nečte ani nezapisuje. Žádné `CREATE INDEX` v P11 není.

**Co P03 má:** `indexed boolean NOT NULL DEFAULT false` a `index_state IN ('none','building','ready','failed') DEFAULT 'none'`, plus jediný GIN index `idx_contacts__attributes_gin` s `jsonb_path_ops` nad celým sloupcem. Kapitola 8 P03 přitom zakazuje všem ostatním plánům „přidat, odebrat ani změnit tabulku, sloupec, **index**, omezení, politiku ani grant".

**Oprava:** Rozhodnout jedno ze dvou.

- Varianta A: P03 dodá funkci `SECURITY DEFINER ensure_attribute_index(workspace_id uuid, key text)`, která uvnitř udělá `CREATE INDEX CONCURRENTLY ... ON contacts ((attributes ->> key)) WHERE workspace_id = ...` a posouvá `index_state`. Zároveň se určí, kdo ji volá (logicky P07 při zakládání vlastního pole).
- Varianta B: `indexed` a `index_state` se z MVP 0 vypustí a P11 nahradí varování statickým pravidlem podle operátoru (viz D5).

**Proč:** V současném stavu je `indexed` navždy `false`, varování „hledá se pomaleji" svítí u každého vlastního pole a nikdy nezhasne, protože ho nemá co zhasnout. `index_state` se čtyřmi stavy je mrtvý sloupec. Tohle je jediné místo v celém P11, kde se dvě kapitoly P03 (schéma vs. zákaz indexů) navzájem vylučují.

### K9. `users.attributes` neexistuje (přechází na P07 podle U3)

**Místo:** Úkol 38, akce `defer`: `UPDATE users SET attributes = jsonb_set(coalesce(attributes, '{}'::jsonb), '{deferredVocativeGroups}', ...) WHERE id = $1`.

**Co P03 má:** `users` má 15 sloupců a `attributes` mezi nimi není. Nejbližší jsou `workspaces.settings jsonb` a `system_settings.settings jsonb`, obojí ale není per uživatel.

**Oprava:** `users.preferences jsonb NOT NULL DEFAULT '{}'` s CHECKem na `jsonb_typeof = 'object'` a stropem `pg_column_size`, po vzoru `contacts.attributes`. Jméno `preferences` je lepší než `attributes`, aby se to nepletlo s uživatelskými poli kontaktu.

**Proč:** Úkol 38 podle rozhodnutí U3 přechází na P07, ale sloupec tím nezmizí. P07 bude potřebovat totéž a narazí na tutéž zeď. Zaznamenáno proto, aby se požadavek přenesl spolu s úkolem.

---

## DŮLEŽITÉ nálezy

### D1. Tvar `Actor` nesedí a `ctx.actor.id` jde do `created_by uuid`

**Místo:** Tvar aktéra `{ kind: 'system', id: '...' }` v úkolu 15 krok 4 (testovací pomocník), úkolu 22 kroky 3 a 4, úkolu 39 krok 4. Čtení `ctx.actor.id` jako hodnoty `created_by`: úkol 34 (`INSERT INTO imports`), úkol 39 (`INSERT INTO exports`), úkol 38 (`INSERT INTO name_overrides`), úkol 19 (`segments.createdBy`).

**Co P03 má:** `packages/db/src/context.ts`: `Actor = { type: 'user'; userId; role } | { type: 'api_key'; apiKeyId; scopes } | { type: 'system'; job }`. Diskriminátor je `type`, ne `kind`, a `.id` neexistuje v žádné z variant. Všechny čtyři sloupce `created_by` jsou `uuid()`. Továrna se jmenuje `unsafeWorkspaceContext`, ne `createWorkspaceContext`, a má ESLint omezení na `packages/db` a `packages/core/identity`.

**Oprava:** P11 přejde na `{ type: 'system', job: 'segments.recount' }` a na `created_by` počítá `ctx.actor.type === 'user' ? ctx.actor.userId : null` (všechny čtyři sloupce jsou nullable). Pokud je autoritou tvaru aktéra P04 a ne P03, je to nález na P04, ale rozhodnout to musí někdo, protože `Actor` i `WorkspaceContext` exportuje P03.

**Proč:** Systémový aktér má `job` typu text, ne UUID. `'segments.recount'` v `created_by uuid` je `22P02 invalid input syntax for type uuid`.

### D2. Obálka nefiltruje anonymizované a smazané kontakty

**Místo:** Úkol 9 krok 3, `buildEnvelope`. Řetězec `anonymized` se v celém P11 nevyskytuje ani jednou.

**Co P03 má:** `contacts.anonymized_at timestamptz` a `status` s hodnotou `deleted` v CHECKu. Rozhodnutí R3 P03 říká, že GDPR **řádek nemaže**, jen přepíše `email` na `erased+{contact_id}@erased.invalid` a vyprázdní `render_data`. `deleted_at` se přitom nastavovat nemusí.

**Oprava:** Do obálky přidat `AND ${alias}.anonymized_at IS NULL` a `AND ${alias}.status <> 'deleted'`. Není to změna schématu, sloupce existují.

**Proč:** P11 v požadavku 13.1 na P13 sám argumentuje, že publikum se skládá výhradně přes `compileAudienceToSql()`, protože „kdyby psala vlastní SQL, odešla by pošta člověku s omezeným zpracováním". Anonymizovaný kontakt je horší případ: pošta odejde na `erased+…@erased.invalid`, což je neexistující doména, vygeneruje hard bounce a poškodí reputaci odesílatele. Obálka má být jediné místo, kde se to hlídá, a tuhle podmínku nemá.

### D3. `withReadOnly` už existuje, P11 ho staví znovu a rozhodnutí R13 stojí na chybném předpokladu

**Místo:** Rozhodnutí R13 v kapitole 1: „Read-only pool, který P03 neslibuje… Nesahám tím do `packages/db` a nepotřebuju od P03 nic nového." Požadavek 3.6 v kapitole 11 žádá po P03 jen „potvrzení, že `withWorkspaceId` dovolí `SET LOCAL`". Rozpor 3 v kapitole 13. Implementace `runReadOnly` v úkolu 15 krok 3.

**Co P03 má:** Dvě věci, které R13 popírá.

1. `withReadOnly(pool, ctx, statementTimeoutMs, fn)` v `repo/tx.ts`, který dělá `BEGIN READ ONLY`, `SET LOCAL statement_timeout` i `set_config('mlain.workspace_id')`, a jehož komentář zní doslova „Používá ji náhled segmentu… Strop 3 s spoléhá na chybu 57014 query_canceled".
2. `createPool(url, 'readOnly')` s `-c default_transaction_read_only=on`, tedy skutečný oddělený pool, i s typem `PoolKind = 'app' | 'readOnly'` v exportech.

**Oprava:** `runReadOnly` z P11 se scvrkne na tenkou obálku kolem `withReadOnly` a doplní jen `SET LOCAL work_mem`, které P03 nenastavuje. Požadavek 3.6 se změní z „potvrď, že SET LOCAL projde" na „exportuj vázanou variantu `withReadOnly(ctx, timeoutMs, fn)` bez argumentu `pool` a napoj ji na pool typu `readOnly`" (viz K2). Rozpor 3 v kapitole 13 se uzavře jako neplatný.

**Proč:** P11 si zbytečně nese vlastní verzi bezpečnostního primitiva, které v P03 už je a je lepší (`BEGIN READ ONLY` na úrovni transakce plus pool s `default_transaction_read_only`, tedy dvě vrstvy místo jedné). Dvě verze téhož se rozejdou při první úpravě a to je přesně ta chyba, před kterou P11 varuje v kapitole 14 u obálky segmentu.

### D4. `runMigrations()` se volá bez povinného argumentu

**Místo:** Úkol 15 krok 4, `packages/core/test/segments/helpers/db.ts`: `await runMigrations();`, předtím jen `process.env.DATABASE_URL = container.getConnectionUri()`.

**Co P03 má:** `runMigrations(options: RunMigrationsOptions)`, kde se `options.url` předává do `new Client({ connectionString: options.url })`. Žádný fallback na `process.env.DATABASE_URL`.

**Oprava:** `await runMigrations({ url: container.getConnectionUri() })`. Případně P03 doplní `options.url ?? process.env.DATABASE_URL`, ale explicitní argument je čistší.

**Proč:** Bez toho spadne bootstrap **všech** databázových testů P11 (`*.dbspec.ts`), tedy úkolů 15, 19, 21, 31, 34 a 39. P11 si u toho souboru sám píše „Když P03 pojmenoval `runMigrations` jinak, oprav to tady", takže je to vědomé místo, jen s nesprávným podpisem.

### D5. GIN nad `attributes` je `jsonb_path_ops`, takže `?`, `?|` a `?&` nemají index

**Místo:** Úkol 10 krok 3, operátory `has_any` (`?|`), `has_all` (`?&`), `has_none` (`NOT ?|`). Úkol 21 krok 3, diagnostika prázdného výsledku: `count(*) FILTER (WHERE attributes ? $2)` a `WHERE ... AND attributes ? $2 GROUP BY 1`.

**Co P03 má:** `idx_contacts__attributes_gin` s `jsonb_path_ops` a komentářem „jsonb_path_ops je menší a rychlejší než výchozí jsonb_ops a stačí na `@>`". Přesně tak: `jsonb_path_ops` podporuje **jen** `@>`. Operátory `?`, `?|` a `?&` umí jen výchozí `jsonb_ops`.

**Oprava:** P11 přepíše `has_any` z `attributes -> k ?| ARRAY[...]` na disjunkci `attributes @> jsonb_build_object(k, v)`, což index využije. Druhý index `GIN (attributes jsonb_ops)` je horší volba, protože roste velikost a P03 zvolil `jsonb_path_ops` vědomě.

**Proč:** Diagnostika má timeout 1500 ms, což u pěti milionů kontaktů nedoběhne, a obrazovka „proč je segment prázdný" pak nic nevysvětlí. Právě tuhle obrazovku přitom P11 staví v úkolech 21 a 59.

### D6. `contacts.is_sample` se používá bezpodmínečně

**Místo:** Úkol 21 krok 4, `audience.ts`, mapa `GATE_SQL`: `sample: 'b.is_sample = true'`. Kapitola 11, požadavek 3.5.

**Co P03 má:** Sloupec neexistuje. Chybějící příznak ukázkovosti je už samostatně evidovaný napříč plány.

**Oprava:** Buď P03 doplní `is_sample boolean NOT NULL DEFAULT false`, nebo P11 bránu `sample` zneškodní stejným způsobem jako bránu `duplicate`, tedy natvrdo `false`, dokud sloupec nebude.

**Proč:** Hlásím jen tu bezpodmínečnost. Rozpad publika nespadne jen na jednu chybějící bránu, ale celý na `42703`, protože `GATE_SQL` se skládá do jednoho dotazu se sedmi `count(*) FILTER`.

---

## POZNÁMKY

| # | Místo | Nález a oprava |
|---|---|---|
| P1 | Úkol 31 krok 4 | `import_errors.severity` se zapisuje natvrdo jako `'error'`. Varovné řádky se počítají do `warning_rows` a `error_summary`, ale nikdy nevzniknou jako řádky. Uživatel u varování neuvidí, který řádek ho způsobil. Buď se `severity = 'warning'` začne zapisovat, nebo se hodnota z CHECKu v P03 vypustí jako mrtvá. Třetí úroveň (`info`, `review`) P11 nikde nepotřebuje, CHECK je tedy jinak v pořádku. |
| P2 | Úkol 31 krok 4 | Dávkový `INSERT INTO contacts` vyjmenovává 20 sloupců a `first_name_key` ani `last_name_key` mezi nimi nejsou. Fronta oslovení by po importu zůstala prázdná, protože klíč by byl NULL, a `idx_contacts__ws_vocative_review` je na něm postavený. Sloupce v P03 jsou, jde o vnitřní mezeru P11. Po U3 to frontu vlastní P07, ale zápis dělá pořád importní roura z P11. |
| P3 | Úkol 34 | `imports.total_rows` nikdo nezapisuje. Sloupec se čte v hlášce o zrušení (`coalesce(total_rows::text, '?')`), ale ani jeden ze sedmi `UPDATE imports` ho nenastaví. Odhad z úkolu 32 počítá `totalRows` jen do paměti. Hláška vždy vypíše `zrušeno uživatelem na řádku 4200 z ?`. |
| P4 | Úkoly 19 a 22 | `segments.recompute_state` se nikdy nedostane do `queued` ani `running`, P11 zapisuje jen `idle` a `error`. Fronta se řídí `singletonKey`, ne sloupcem. Dvě ze čtyř hodnot CHECKu jsou mrtvé a UI nemá jak ukázat „přepočítává se". |
| P5 | Úkol 31 krok 4 | `error_summary = error_summary \|\| $11::jsonb` přepisuje, nesčítá. Operátor `\|\|` nad jsonb nahrazuje klíče na první úrovni, takže po druhé dávce je `email_invalid` počet z druhé dávky, ne součet. Plán to sám přiznává a odkazuje agregaci na čtení, ale žádné takové čtení v plánu není a test v kroku 1 testuje jen jednu dávku. Řešení bez změny schématu: agregace přes `jsonb_object_agg` nad rozbaleným jsonb, nebo per klíč přes `jsonb_set`. |
| P6 | Úkol 12 krok 3 | `EXISTS` nad `contact_engagement` nefiltruje `workspace_id`, ačkoli PK je `(workspace_id, contact_id)` v tomhle pořadí. RLS podmínku doplní, takže výsledek je správný a index použitelný, ale je to jediné místo v kompilátoru, kde se na RLS spoléhá místo explicitní podmínky. Ostatní poddotazy (`suppressions`, `list_subscriptions`, `messages`, `web_events`) `workspace_id` uvádějí. Sjednotit. |
| P7 | Úkol 12 krok 3 | Metrika `bounced` mapuje jen na `bounced_hard`. `message_events.type` má i `bounced_soft`. Segment „odrazilo se" tedy vynechá měkké odrazy, zatímco rollup `bounces_total` je pravděpodobně počítá oba. Náhled a rollupová větev pak dají různá čísla pro tutéž podmínku. |
| P8 | Úkol 25 | Detekce dialektu vrací `escape: 'double'`, ale `imports` na to nemá sloupec (má jen `quote_char`, které P11 taky nikdy nezapisuje a spoléhá na default `"`). Dokud je `double` jediná podporovaná hodnota, je to bez dopadu. Kdyby přibylo escapování zpětným lomítkem, obnova po pádu by soubor přečetla jinak než první běh. |
| P9 | Úkol 19, `markAllStale` | `UPDATE segments SET cached_at = NULL` se pouští na všechny segmenty projektu včetně statických. Zmrazený segment tím ztratí razítko zmrazení, ačkoli jeho členové se nezměnili. Doplnit `AND kind = 'dynamic'`. |
| P10 | Úkol 21 krok 4 | Brána `unsubscribed` gatuje `status IN ('unsubscribed','complained')`, ale ne `'bounced'`. Kontakt s tvrdým odrazem projde bránou a spadne až na `suppressions`, což je správně jen tehdy, když suppression řádek existuje. Ověřit, že ho P07 zakládá vždy. |
| P11 | Kapitola 11, požadavek 3.1 | Už splněný, index `idx_contacts__ws_vocative_review` v P03 existuje. Vyškrtnout, aby se nehlásil znovu. Po U3 přechází celá agenda na P07. |

---

## Souhrn požadavků na P03

| Co doplnit | Kdo žádá | Typ nebo tvar | Proč |
|---|---|---|---|
| `imports.stored_error_count` | Úkol 31 krok 4 | `bigint NOT NULL DEFAULT 0` | Je v `UPDATE` každé checkpointové transakce bez podmínky, ne jako volitelná optimalizace |
| `imports.resume_from_import_id` | Úkol 34, `resumeImport` | `uuid REFERENCES imports(id) ON DELETE SET NULL` | Je v `INSERT` i v `RETURNING`, kritérium 35 části 6 |
| `withWorkspaceId(workspaceId: string, fn)` v exportech `@mlain/db` | Kapitola 2, 28 volání | Vázaná varianta `withWorkspace` bez argumentu `pool` | P03 exportuje jen `withWorkspace(pool, ctx, fn)`, pool si doménový balíček importovat nesmí |
| `withReadOnly(ctx, timeoutMs, fn)` bez `pool`, napojený na `PoolKind='readOnly'` | Rozhodnutí R13, požadavek 3.6 | Vázaná varianta existujícího `withReadOnly` | P03 read-only pool i primitivum má, R13 i rozpor 3 stojí na chybném předpokladu a vyrábí druhou verzi bezpečnostního primitiva |
| Přístupová cesta pro sken napříč projekty | Úkol 22 `scheduleStale`, úkol 35 `recoverStaleImports` | Role `mlain_scheduler` s `BYPASSRLS`, nebo dvě funkce `SECURITY DEFINER` | `ws_isolation` bez kontextu vrací nula řádků tiše, oba plánovače by nikdy nic nenašly |
| Vlastník `contact_fields.indexed` a `index_state` | Úkol 16 (čte), nikdo nezapisuje | `SECURITY DEFINER ensure_attribute_index(ws, key)`, nebo oba sloupce zrušit | Kapitola 8 P03 zakazuje ostatním plánům zakládat indexy, takže `indexed` zůstane navždy `false` |
| `contacts.is_sample` | Úkol 21 krok 4, požadavek 3.5 | `boolean NOT NULL DEFAULT false` | Rozpad publika spadne celý na `42703`, ne že jen vypustí jednu bránu |
| `users.preferences jsonb NOT NULL DEFAULT '{}'` | Úkol 38 (přechází na P07) | jsonb s CHECKem na objekt a stropem velikosti | Odložení skupiny ve frontě oslovení nemá kam zapsat |
| Rozhodnout tvar `Tx` | Prostupuje plánem, 47 volání | Drizzle transakce, nebo `PoolClient` a `tx.query()` v P11 | `PoolClient` nemá `.execute()`, `.select()`, `.insert()` ani `.update()` |

## Souhrn oprav uvnitř P11 (bez zásahu do schématu)

| Co opravit | Kde | Jak |
|---|---|---|
| Jména sloupců rollupu | Úkol 12, `ROLLUP_COUNT` | `sent_total`, `delivered_total`, `opens_total`, `clicks_total`, `bounces_total` |
| Vyškrtnout požadavek 10.1 na P10 a P14 | Kapitola 11 | Sloupce existují a vlastní je P03 |
| `campaigns.sent_at` | Úkol 12, `slowExists` | `status IN ('sent','partially_sent') AND finished_at IS NOT NULL ORDER BY finished_at DESC` |
| Partiční podmínky | Úkol 12 | `me.received_at` u `message_events`, meze na `we.received_at` u `web_events` (nebo `web_event_months`), `m.created_at` v `countExpr` |
| Obálka | Úkol 9 | Přidat `anonymized_at IS NULL` a `status <> 'deleted'` |
| Tvar aktéra | Úkoly 15, 19, 22, 34, 38, 39 | `{ type: 'system', job }`, `created_by` jen u aktéra typu `user` |
| `runMigrations({ url })` | Úkol 15 krok 4 | Doplnit argument |
| `has_any` / `has_all` / `has_none` | Úkol 10 | Přepsat z `?|` a `?&` na `@>`, aby se využil `jsonb_path_ops` |
| Uzavřít kapitolu 13.1 a rozpor 11 | Kapitoly 1 (R2) a 13 | Rozhodnuto U3 ve prospěch P07, vypustit úkoly 37, 38 a 53 |
