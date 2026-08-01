# P07 versus P03: revize souladu doménového plánu s databázovým schématem

**Recenzovaný plán:** `docs/superpowers/plans/2026-07-31-p07-kontakty-souhlasy-vokativ.md` (27 457 řádků)
**Zdroj pravdy pro schéma:** `docs/superpowers/plans/2026-07-31-p03-databaze-schema-rls.md`
**Datum revize:** 2026-08-01
**Rozsah:** kontakty, vlastní pole, štítky, seznamy, souhlasy, suppression, GDPR, retence, vokativ a oslovení, formuláře, příchozí webhooky, veřejné stránky.

Všechna tvrzení o tom, co v P03 chybí, jsou ověřená grepem přímo v souboru P03, ne jen z digestu. U každého nálezu je uvedený řádek v P07 i v P03.

---

## Verdikt

Plán P07 **není proveditelný proti současnému schématu P03**. Šest nálezů je blokujících: dva chybějící objekty ve schématu, dva chybějící granty nebo role, jeden přímý rozpor s rozhodnutím R3 plánu P03 a jedno porušení CHECK omezení.

Tři z nich (K1, K2, K5) zastaví plán hned na začátku fáze B a C, protože se dotýkají jediné cesty, kterou v produktu vzniká kontakt a jediné cesty, kterou se blokuje adresa. Zbylé tři (K3, K4, K6) zastaví GDPR výmaz a frontu kontroly oslovení.

Dobrá zpráva je, že šest ze šestnácti nálezů jsou opravy **v P07**, ne v P03: schéma je u nich navržené správně a plán ho jen porušuje nebo nevyužívá. Skutečných změn schématu je potřeba méně, než by se z počtu nálezů zdálo.

**Souhrn:** 6 kritických, 9 důležitých, 6 poznámek.

---

## Kritické nálezy

### K1. Sloupec `contacts.search_key` neexistuje

| | |
|---|---|
| **Kde v P07** | Kapitola 3, rozhodnutí R12 (ř. 214 a 216). Použití: úkol 14, krok 3 (ř. 3882, 3890, 3919, 3958), úkol 40, krok 3 (ř. 12185) |
| **Doslovný citát** | „**Je to požadavek na P03:** sloupec `search_key text` na `contacts` a trigramový index nad ním místo nad `search_text`" |
| **Co P03 má** | Nic. `grep -n 'search_key' p03` vrací nula shod. P03 má jen generovaný `searchText` (ř. 1584) a GIN trgm index nad ním (ř. 1628) |

**Navrhovaná oprava (P03):** přidat `searchKey: text()` na `contacts`, nullable, bez defaultu, plní ho aplikace funkcí `normalizeNameKey(email + ' ' + first_name + ' ' + last_name)`. K tomu index `index('idx_contacts__search_key_trgm').using('gin', t.workspaceId, sql\`${t.searchKey} gin_trgm_ops\`)`. Generovaný sloupec `search_text` podle R12 zůstává, používá ho řazení.

**Proč to blokuje:** `INSERT INTO contacts (... search_key ...)` z úkolu 14 je jediná cesta, kterou v produktu vzniká kontakt, a jdou přes ni všechny čtyři kanály (API, formulář, webhook, import). Bez sloupce padne každý zápis kontaktu na `42703 column "search_key" does not exist`. Fáze B se nerozběhne vůbec.

**Dopad na jiné plány:** P11 (import) jde přes tentýž upsert, takže bez opravy nepojede ani import.

---

### K2. Tabulka `suppression_rank` neexistuje

| | |
|---|---|
| **Kde v P07** | Úkol 35, text pod krokem 3 (ř. 10884). Použití: úkol 35, krok 3, `addSuppression` (ř. 10750, 10752, 10754) |
| **Doslovný citát** | „Pomocná tabulka `suppression_rank` (mapa důvod na pořadí) **se zakládá migrací v P03** a plní se ze `SUPPRESSION_RANK`." |
| **Co P03 má** | Nic. `grep -n 'suppression_rank' p03` vrací nula shod, v seznamu 73 tabulek není |

Konkrétní použití v SQL: `(SELECT rank FROM suppression_rank WHERE reason = suppressions.reason)`, třikrát v klauzuli `ON CONFLICT DO UPDATE`.

**Navrhovaná oprava (P03):** `suppression_rank(reason text PRIMARY KEY, rank smallint NOT NULL)`, deset řádků odpovídajících výčtu v `ck_suppressions__reason`, plní je migrace. Tabulka je **bez `workspace_id`**, takže musí přibýt i do `TABLES_WITHOUT_WORKSPACE_ID` a `TABLES_WITHOUT_RLS`, jinak spadne `rls-registry.test.ts`.

Alternativa, pokud nechceme jedenáctou tabulku ve whitelistu: nahradit poddotaz `CASE` výrazem přímo v SQL. P07 ale výslovně chce test, který porovná obsah tabulky s konstantou v kódu, takže tabulka je čistší.

**Proč to blokuje:** `suppressions.add` je podle úkolu 35 jediná povolená cesta k zablokování adresy. Bez tabulky padne na `42P01` každý tvrdý odraz, každá stížnost, každé globální odhlášení i každý GDPR výmaz, protože ten volá `addSuppression` jako svůj první krok.

---

### K3. `UPDATE messages SET contact_id = NULL` proti `messages.contact_id NOT NULL`

| | |
|---|---|
| **Kde v P07** | Úkol 41, krok 3, `jobs/gdpr-sever-links.ts` (ř. 12435 až 12438). Test v kroku 1 (ř. 12321) |
| **Doslovný citát** | `UPDATE messages SET contact_id = NULL, email = ${\`erased+${payload.contactId}@erased.invalid\`}, render_data = '{}'::jsonb` |
| **Co P03 má** | Rozhodnutí R3 a SQL DDL: `contact_id uuid NOT NULL`. FK z `messages` na `contacts` neexistuje, odstřižení tedy musí udělat job |

**Navrhovaná oprava (P07, ne P03):** schéma nechat. V jobu `contact_id` neměnit a anonymizovat jen `email` a `render_data` přesně podle R3. Test `expect(await countMessagesWithContact(ctx, contact.id)).toBe(0)` přepsat na kontrolu, že `email` je placeholder a `render_data` je prázdný objekt.

**Proč to blokuje:** `23502 null value in column "contact_id" violates not-null constraint` shodí celou transakci odstřižení vazeb. Je to zároveň vnitřní rozpor P07: komentář v úkolu 40 (ř. 12188) správně popisuje, že agregované statistiky kampaní se výmazem nemění, což s `contact_id NOT NULL` platí, ale kód se o NULL pokusí dřív.

---

### K4. GDPR výmaz maže `consents` pod rolí, která na to nemá právo

| | |
|---|---|
| **Kde v P07** | Úkol 40, krok 3, `gdpr/erase.ts` (ř. 12203 až 12205) |
| **Doslovný citát** | „consents se mažou pod rolí mlain_gdpr, která jako jediná má DELETE", a hned pod tím `await tx.execute(sql\`DELETE FROM consents WHERE contact_id = ${contactId}\`);` uvnitř `withTransaction(ctx, ...)` |
| **Co P03 má** | Migrace 0006 (ř. 5334): `REVOKE UPDATE, DELETE ON consents FROM mlain_app;`. Migrace 0005 (ř. 5261): `GRANT DELETE ON consents TO mlain_gdpr;`. `PoolKind` je jen `'app' \| 'readOnly'` (ř. 5702). `withWorkspace` roli nepřepíná, bere ji z předaného klienta |

P03 to sám dokládá testem na ř. 6269 až 6291: `DELETE FROM consents` pod `mlain_app` hází `permission denied`, a správná cesta je `withWorkspace(h.as('mlain_gdpr'), gdprCtx, ...)`. Komentář v P07 tedy popisuje správný záměr, ale kód ho neprovádí, protože `withTransaction(ctx, ...)` běží nad aplikačním poolem.

**Navrhovaná oprava (P03):** rozšířit `PoolKind` na `'app' | 'readOnly' | 'gdpr'` a exportovat helper, například `withGdpr(ctx, fn)`, který otevře transakci nad gdpr poolem a nastaví `mlain.workspace_id`. Zvážit `GRANT SELECT ON contacts, consents TO mlain_gdpr`, protože dnes ta role nemá právo si nic přečíst, takže by transakce neuměla ani ověřit, co maže.

**Proč to blokuje:** `42501` při každém výmazu v režimu `anonymize`, což je podle P07 výchozí režim. Fyzické smazání kontaktu by prošlo, protože kaskáda `ON DELETE CASCADE` práva obchází (P03 to testuje na ř. 6294), ale režim `anonymize` řádek v `contacts` nechává, takže kaskáda nenastane. Výmaz podle článku 17 by neselhal někdy, ale pokaždé.

---

### K5. `CREATE INDEX CONCURRENTLY` na `contacts` pod aplikační rolí

| | |
|---|---|
| **Kde v P07** | Úkol 23, krok 3, `jobs/build-field-index.ts` (ř. 6314 až 6318) |
| **Doslovný citát** | `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${indexName} ON contacts ((attributes ->> '${key}')) WHERE workspace_id = '${payload.workspaceId}'`, voláno přes `deps.db`, tedy aplikační pool |
| **Co P03 má** | Vlastnictví schématu `public` má `mlain_migrator` (kapitola 7, požadavek A na P01). `mlain_app` má jen DML granty a default privileges. `CREATE INDEX` vyžaduje vlastnictví tabulky |

**Navrhovaná oprava (P03):** buď rozšířit `PoolKind` o `'ddl'` s rolí `mlain_migrator` a exportovat úzké primitivum typu `createAttributeIndex(workspaceId, key)` a `dropAttributeIndex(...)`, nebo zavést vyhrazenou `SECURITY DEFINER` funkci, kterou smí volat aplikace. Obecný DDL grant aplikaci nedávat.

**Proč to blokuje:** `42501 must be owner of table contacts`. Job `contact_fields.build_index` skončí ve větvi `catch`, nastaví `index_state = 'failed'` a osm indexovatelných vlastních polí nikdy nevznikne. Zároveň je to jediné místo v celém P07, kde doménový kód generuje DDL za běhu, takže to potřebuje vědomé rozhodnutí P03, ne tichý grant za běhu implementace.

---

### K6. Zápis do `name_overrides` poruší `ck_name_overrides__has_value`

| | |
|---|---|
| **Kde v P07** | Úkol 54, krok 4, `vocative-review/actions.ts` (ř. 17280 až 17283). Typ na ř. 17208 až 17214 |
| **Doslovný citát** | `VALUES (..., ${input.gender ?? null}, ${input.vocative ?? null}, ...)`, přičemž `saveOverride` je podle komentáře „Ve výchozím stavu ZAŠKRTNUTÉ" |
| **Co P03 má** | `check('ck_name_overrides__has_value', sql\`${t.gender} IS NOT NULL OR ${t.vocative} IS NOT NULL\`)` |

U akcí `confirm` a `no_name` se neplní ani `input.gender`, ani `input.vocative`, takže do INSERTu jdou dvě NULL hodnoty.

**Navrhovaná oprava (P07 u `confirm`, případně P03 u `no_name`):** u akce `confirm` doplnit do INSERTu potvrzený vokativ skupiny, tedy hodnotu `suggested_vocative` z `listReviewGroups`. U akce `no_name` přepis vůbec nezakládat, nebo pro ni zavést třetí nositelnou hodnotu, například `suppress_name boolean NOT NULL DEFAULT false` na `name_overrides` a rozšířit CHECK o ni.

**Proč to blokuje:** „Potvrdit návrh" je nejčastější akce ve frontě oslovení. Dnes padne na `23514` a s ní celá transakce, takže se nezamkne ani vokativ. Přímo tím padá akceptační kritérium 24 („potvrzení skupiny zamkne vokativ a při zaškrtnutí založí přepis") a nepřímo kritérium 25.

---

## Důležité nálezy

### D1. `UPDATE web_events SET contact_id = NULL` bez `erased_at` poruší CHECK

**Kde v P07:** úkol 41, krok 3 (ř. 12444), `UPDATE web_events SET contact_id = NULL WHERE workspace_id = ... AND contact_id = ...`.

**Co P03 má:** `CONSTRAINT ck_web_events__subject CHECK (anonymous_id IS NOT NULL OR contact_id IS NOT NULL OR erased_at IS NOT NULL)`. Migrace 0006 to říká výslovně: „`erased_at` MUSÍ být ve výčtu, jinak GDPR výmaz narazí na oprávnění místo na constraint." Grant `UPDATE (contact_id, identity_merge_id, erased_at)` tam existuje právě proto.

**Oprava (P07):** `SET contact_id = NULL, erased_at = now()`.

**Proč:** serverová událost má vyplněné jen `contact_id`. Vynulování bez `erased_at` skončí na `23514` a odstřižení vazeb spadne.

---

### D2. Výmaz vůbec nesáhne na `message_events` a `message_engagement`

**Kde v P07:** nikde. `grep -n 'message_events\|message_engagement\|erased_at' p07` vrací jen názvy souborů v GDPR exportu (ř. 11716, 11803, 11855, 11903). Job `severContactLinks` v úkolu 41 řeší `messages`, `web_events`, `identities` a `contact_engagement`, nic víc.

**Co P03 má:** `message_events.recipient text NOT NULL` drží e-mailovou adresu, `contact_id` je nullable a platí `CHECK (contact_id IS NOT NULL OR erased_at IS NOT NULL)`. Migrace 0006: `GRANT UPDATE (contact_id, erased_at, recipient) ON message_events TO mlain_app;` a stejný vzor na `message_engagement`. Oba granty existují výhradně kvůli výmazu a nemají v P07 konzumenta.

**Oprava (P07, schéma je hotové):** do `severContactLinks` doplnit
`UPDATE message_events SET contact_id = NULL, erased_at = now(), recipient = 'erased+{contactId}@erased.invalid'`
a `UPDATE message_engagement SET contact_id = NULL, erased_at = now()`.

**Proč:** po výmazu podle článku 17 zůstane původní adresa v `message_events.recipient` a vazba na osobu v `message_engagement`. Je to nesplněný článek 17 a zároveň mrtvý grant, který nikdo nevyužije. Kritérium 67 („anonymizace nezmění počet otevření u žádné kampaně") tím není ohrožené, protože se maže jen vazba, ne řádek.

---

### D3. Sloupec `forms.version` neexistuje

**Kde v P07:** úkol 46, krok 3 (ř. 13767): `form_id: form.id, form_version: form.version`. Typ v `ConsentEvidence` na ř. 11058: `form_version?: number;`.

**Co P03 má:** `forms` má `id, workspace_id, name, slug, fields, design, custom_css, list_ids, tag_ids, double_opt_in, consent_text, consent_required, legal_basis, honeypot_field, min_fill_seconds, allowed_origins, captcha_provider, captcha_config, redirect_url, success_message, active, submission_count, created_at, updated_at`. Žádné `version`.

**Oprava (P03):** `version: integer().notNull().default(1)` na `forms`, zvyšuje ho aplikace při změně `fields` nebo `consent_text`.

**Proč:** bez verze není v důkazu souhlasu doložitelné, jaké znění zaškrtávátka člověk viděl, což je celý smysl `consents.evidence`. Chyba se navíc nikdy neprojeví hlasitě: `form.version` je v TypeScriptu `undefined`, v JSON zmizí a evidence se uloží neúplná.

---

### D4. Odložené skupiny fronty oslovení nemají kam

**Kde v P07:** úkol 54, krok 4 (ř. 17239 až 17243): „Odložení skupinu nezamyká, jen ji schová z výchozího pohledu. **Uloží se do nastavení uživatele, ne do kontaktu**", následuje volání `await deferGroupForUser(tx, ctx, input.nameKey, input.kind);`. Funkce se nikde v plánu neimplementuje. Uživatelsky viditelné to je: i18n klíče `showDeferred` a `hideDeferred` (ř. 19560 a 19561), tlačítko „Odložit" na ř. 23141, hint na ř. 19552.

**Co P03 má:** `users` nemá `settings` (ř. 1203 až 1226: id, email, email_verified_at, password_hash, password_changed_at, name, locale, timezone, status, failed_login_count, locked_until, last_login_at, created_at, updated_at, deleted_at). `memberships` má jen `(workspace_id, user_id, role, created_at, updated_at)`. Tabulka uživatelských předvoleb v projektu neexistuje.

**Oprava (P03):** buď `memberships.ui_settings jsonb NOT NULL DEFAULT '{}'`, což je nejlevnější a je to per uživatel a projekt, nebo samostatná tabulka `vocative_review_deferrals(workspace_id, user_id, kind, name_key, deferred_at)` s PK přes první čtyři sloupce a s RLS.

**Proč:** bez úložiště je akce „Odložit" no-op a fronta se u skupin, které uživatel nechce řešit, nikdy nevyprázdní. Rozhodnout je potřeba teď, protože `memberships` je tabulka P03 a doplnit ji později znamená migraci navíc.

---

### D5. Výchozí `contacts.status` v DDL je `'active'`, doména chce `'unconfirmed'`

**Kde v P07:** úkol 15, krok 3 (ř. 4256 až 4262): `const status = existing === null ? (incoming.status ?? 'unconfirmed') : LOCKED_STATUSES.includes(existing.status) ? existing.status : (incoming.status ?? existing.status);`, uvedené komentářem „Pravidlo 3 ... Je to nejdůležitější pravidlo celé kapitoly." Ale upsert v úkolu 14, kroku 3 sloupec `status` v seznamu vůbec nemá (ř. 3879 až 3885), takže se výsledek pravidla nikam nezapíše.

**Co P03 má:** `status: text().notNull().default('active')`.

**Oprava, dvě části:**
1. P03: změnit DDL default na `'unconfirmed'` jako pojistku pro zápis mimo doménovou vrstvu.
2. P07: doplnit `status` do seznamu sloupců v INSERT i do `DO UPDATE SET` v úkolu 14.

**Proč:** dnes každý nový kontakt z formuláře s dvojím potvrzením vznikne rovnou jako `active`, což je přesně to, čemu má double opt-in bránit. Pravidlo 3 se spočítá a zahodí. Ohrožené je kritérium 50 („přihlášení na seznam s dvojím potvrzením vytvoří `pending` a kontakt není v publiku"), protože brána mailovatelnosti z úkolu 18 čte `contacts.status`.

---

### D6. `dropPartitionsBefore` je volané se špatnou signaturou a pod špatnou rolí

**Kde v P07:** úkol 43, krok 4, handler `inboundDeliveries` (ř. 12842): `const dropped = await dropPartitionsBefore(db, 'inbound_deliveries', policy.days);`

**Co P03 má:** `dropPartitionsBefore(client, table, column, before: Date, veto: PartitionVeto)` (ř. 4709 až 4720) a rozhodnutí R17: „má **povinný** parametr `veto` a bez něj vyhodí výjimku". Uvnitř dělá `ALTER TABLE ... DETACH PARTITION` a `DROP TABLE`, tedy vyžaduje vlastnictví. V testech P03 se volá jako `h.as('mlain_migrator')` (ř. 4476).

**Oprava (P07, případně nové primitivum v P03):** volat s pěti parametry (`'created_at'`, spočítaný `Date`, veto predikát) a pod migrátorským poolem, ne pod `deps.db`. Čistší varianta je vyžádat si od P03 úzké primitivum `dropRetentionPartitions(table, before)` s vestavěným veto a správnou rolí.

**Proč:** dnes to nepřeloží, chybí dva povinné parametry, a i kdyby ano, spadne na oprávnění. Retence `inbound_deliveries` je jeden z pěti cílů, které P07 podle rozhodnutí R6 slibuje dodat.

---

### D7. `WorkspaceSettingsSchema` v `packages/db` neexistuje

**Kde v P07:** úkol 1, krok 3 (ř. 466): „slučuje se do `WorkspaceSettingsSchema` v `packages/db` (konvence 2.5 části 1)". Stejnou cestou P07 čte `workspaces.settings.contacts.salutation_by`, `.vocative_policy` (rozhodnutí R1) a `workspaces.settings.privacy.store_ip` (rozhodnutí R8, kapitola 2.1).

**Co P03 má:** `workspaces.settings jsonb NOT NULL DEFAULT '{}'`, ale žádné zod schéma. `grep -n 'WorkspaceSettingsSchema' p03` vrací nula shod a v exportech ze `src/index.ts` (ř. 7001 až 7031) nic takového není.

**Oprava (P03 nebo P04, rozhodnout u P03, protože sloupec je jeho):** exportovat kostru `WorkspaceSettingsSchema`, například `z.object({}).passthrough()`, do které domény zapojí své větve, nebo to výslovně předat P04 spolu s přepínačem `privacy.store_ip`.

**Proč:** `salutation_by` a `vocative_policy` čte modul oslovení při každém zápisu kontaktu. Bez společného schématu si `settings` naparsuje každý plán po svém a čtyři domény se rozejdou v tom, co je v tom sloupci platné.

---

### D8. Testovací harness, na který se P07 odkazuje, v P03 neexistuje

**Kde v P07:** plán používá **tři různá a vzájemně nekompatibilní API** a všechna přisuzuje P03.

1. Úkol 25, úvod fáze C (ř. 6683): „Testy s databází používají harness z P03 (`createTestWorkspace()` vrací `{ ctx, cleanup }`)". Import z `../support/workspace.js` (ř. 6692, 7895).
2. `resetDatabase, testContext, findByEmail` z `../helpers.js` (ř. 4322, 4384, 4568, 4898, 5684, 5899, 6195, 6397, 9484, 10236, 10512, 10914, 11514, 11975).
3. Kapitola 7.2: „Plus sdílené pomůcky `packages/db/test/helpers.ts`, které plán rozšiřuje".

Navíc `isolation.matrix.test.ts` (ř. 71, 4018, 4020, 7118, 7120) a bod sebekontroly „`isolation.matrix.test.ts` zná všech třináct repository modulů z 7.2".

**Co P03 má:** `startHarness()` vracející `Harness` v `packages/db/test/helpers/container.ts`, `seedTwoWorkspaces()` v `packages/db/test/helpers/fixtures.ts`, a test se jmenuje `packages/db/test/isolation.test.ts`. Soubor `packages/db/test/helpers.ts` neexistuje a v seznamu vlastnictví P03 (kapitola 7) není. `createTestWorkspace`, `resetDatabase`, `testContext` ani `isolation.matrix.test.ts` v P03 nejsou.

**Oprava (P03):** doplnit do `test/helpers/fixtures.ts` funkci `createTestWorkspace()` vracející `{ ctx, cleanup, truncate, auditActions, lastAuditTargetId }` nad existujícím `startHarness`, a sjednotit název testu izolace. Soubor `packages/db/test/helpers.ts` vedle adresáře `helpers/` **nezakládat**, je to kolize v rozlišení modulů.
**Oprava (P07):** sjednotit se na jedno API a jeden název, ne na tři.

**Proč:** dvacet tři testovacích souborů z kapitoly 7.2 se dnes neimportuje. Zároveň je to jediné místo, kde si P07 nárokuje soubor v území P03 (kapitola 7.2, „rozšiřuje `helpers.ts`"), což řídicí pravidlo z kapitoly 8 plánu P03 zakazuje.

---

### D9. `forms.legal_basis` nemá CHECK, ale teče do `consents.legal_basis`, které ho má

**Kde v P07:** úkol 46, krok 3 (ř. 13762): `legalBasis: form.legalBasis` předané rovnou do `recordConsent`, které to zapisuje do `consents.legal_basis` (úkol 36, ř. 11147).

**Co P03 má:** `forms.legalBasis: text().notNull().default('consent')` bez CHECK. `consents` má `ck_consents__legal_basis` na `('consent','legitimate_interest','contract','soft_opt_in')`.

**Oprava (P03):** `check('ck_forms__legal_basis', sql\`${t.legalBasis} IN ('consent','legitimate_interest','contract','soft_opt_in')\`)`.

**Proč:** neplatná hodnota se dnes projeví až při odeslání formuláře v produkci jako `23514` uprostřed transakce, ne při ukládání definice formuláře. Chybu má hlásit ten zápis, který ji způsobil.

---

## Poznámky

### N1. Index fronty oslovení pokrývá jen `first_name_key`

`idx_contacts__ws_vocative_review` je `.on(workspaceId, firstNameKey, createdAt.desc())` s predikátem `vocative_confidence = 'low' AND vocative_locked = false AND deleted_at IS NULL`. `listReviewGroups` (úkol 54, ř. 17160 až 17166) na tom sedí přesně. Ale `applyGroupAction` a `countGroup` pracují i s `kind: 'last'` a filtrují přes `last_name_key` (ř. 17265, 17269), a ta větev index nemá. Buď doplnit druhý částečný index nad `(workspace_id, last_name_key)` se stejným predikátem, nebo v P07 přiznat, že fronta je jen podle křestního jména. `listReviewGroups` dnes `kind: 'first'` hardkóduje (ř. 17175), takže druhá varianta je konzistentnější s tím, co plán skutečně dělá.

### N2. GIN index nad `contacts.email_fingerprints` nemá v P07 čtenáře

P07 to pole jen zapisuje (upsert v úkolu 14, změna adresy v úkolu 17, job `refingerprint`) a maže při anonymizaci (úkol 40). Kontrola suppression jde přes `suppressions.fingerprint`, ne přes `contacts.email_fingerprints` (úkol 34, ř. 10399 až 10403). Buď má čtenáře v P11 (import), nebo je ten index zbytečný a jen zdražuje každý zápis kontaktu. Stojí za ověření u P11.

### N3. `contacts.external_id` nemá v P07 zapisovatele

Rozhodnutí R6 plánu P03 ho přidalo kvůli části 5. Příchozí webhook v P07 mapuje `external_id` do `inbound_dedup`, ne do `contacts` (úkol 48, ř. 14366 až 14368). Částečný unikátní index `uq(workspace_id, external_id)` je tedy zatím bez producenta. Není to chyba, jen ať to není překvapení při čtení plánu.

### N4. `retention_policies.retain_days` versus doménové `policy.days`

P07 pracuje s typem `RetentionPolicy = { days, action, enabled }` (úkol 43, ř. 12723 až 12727) a všechny handlery používají `policy.days`. Mapování na sloupec `retain_days` dělá `loadPolicies`, které v plánu není napsané. Není to chyba schématu, ale je to jediné místo, kde se ty dva názvy potkávají, a zaslouží si v P07 jeden explicitní řádek.

### N5. `withTransaction` v P03 neexistuje

`grep -c 'withTransaction' p03` vrací 0. P07 to používá ve všech repository modulech. Sám plán to v kapitole 2 označuje za nedoložené („**ne**, jen chování", ř. 70), ale v úvodu fáze C (ř. 6683) to už tvrdí jako fakt: „`withTransaction(ctx, fn)` vlastní P03". P03 exportuje `withWorkspace`, `withUser` a `withReadOnly`. Je to tatáž mezera jako už evidované `withWorkspaceTx`, hlásím ji jen kvůli tomu rozporu uvnitř P07.

### N6. Změna adresy nepřepočítá `search_key`

Důsledek nálezu K1. `changeEmail` (úkol 17, ř. 4690 až 4694) přepisuje `email` a `email_fingerprints`, ale `search_key` obsahuje podle R12 i e-mail. Po změně adresy by hledání našlo kontakt pod starou adresou. Až se K1 doplní, opravit v P07 i tohle.

---

## Co jsem ověřil jako v pořádku

Tohle jsem prošel a **nenašel rozpor**. Uvádím to, aby se to nemuselo kontrolovat znovu.

**Slovníky a CHECK omezení**

- `contacts.status`: P07 zapisuje `active`, `unconfirmed`, `unsubscribed`, `bounced`, `complained`, `deleted`. Všech šest je v `ck_contacts__status`. Hodnota `subscribed` v plánu figuruje jen v testu, který dokládá, že neexistuje (ř. 4745, 4824).
- `contacts.gender_source`: P07 produkuje `explicit`, `workspace_override`, `surname_rule`, `surname_rule_translit`, `given_name_dict`, `library_heuristic`, `manual`, `none`. Všech osm je v `ck_contacts__gender_source`.
- `contacts.source`, `contacts.gender`, `contacts.vocative_confidence`, `contacts.name_split_confidence`: bez rozporu.
- `list_subscriptions.status` i `source`: bez rozporu.
- `list_subscriptions.unsubscribe_reason`: P07 zapisuje `link`, `one_click`, `preference_center`, `api`, `manual`, `global`, `objection` (úkol 31, ř. 9612, 9661, 9690). Všech sedm je ve výčtu, který má deset hodnot.
- `consents.purpose`: P07 má přesně pět hodnot `email_marketing`, `analytics`, `personalization`, `profiling`, `third_party` na dvou nezávislých místech (ř. 11102 a 25891) a obě sedí s `ck_consents__purpose`.
- `consents.legal_basis`: `consent`, `soft_opt_in` a typ dovoluje i `legitimate_interest` a `contract`. Sedí.
- `consents.source`: P07 zapisuje `form`, `import`, `api`, `double_opt_in`, `admin`, `preference_center`, `one_click`, `objection`, `reactivation`. Všech devět je ve výčtu, který má dvanáct hodnot.
- `suppressions.reason`: P07 zapisuje `complaint`, `gdpr_erasure`, `global_unsubscribe`, `one_click_unsubscribe`, `hard_bounce`, `manual`. Všechny jsou ve výčtu. `suppressions.source` v P03 CHECK **nemá**, takže hodnoty typu `gdpr` nebo `test` projdou.
- `gdpr_requests.type`, `status`, `channel`, `mode`: úkol 37 zapisuje `access`, `portability`, `erasure`, `rectification`, `restriction`, `objection`, stavy `processing` a `verifying`, kanály `preference_center`, `admin`, `api`, režimy `anonymize` a `purge`. Vše sedí.
- `retention_policies.target`: P07 má sedm cílů `import_files`, `import_errors`, `form_submissions`, `inbound_deliveries`, `unconfirmed_subscriptions`, `inactive_contacts`, `exports` (ř. 12719). Přesně sedí s `ck_retention_policies__target`.
- `retention_runs.status`: `running`, `completed`, `partial`, `failed`. Sedí.
- `contact_fields.type` a `index_state`: sedí, včetně jedenácti typů.
- `form_submissions.status`: `accepted`, `rejected`, `dropped`. Sedí.
- `inbound_deliveries.status`: `received`, `processed`, `ignored`, `unmapped`, `failed`. Sedí (P03 má navíc `rejected`).
- `inbound_endpoints.signature_mode`: P07 implementuje přesně čtyři režimy `none`, `hmac_sha256`, `shared_secret`, `basic` (úkol 47). Sedí.
- `exports.kind = 'gdpr_subject'`: hodnota v CHECK je a úkol 39 ji potřebuje.

**Struktura a klíče**

- `ON CONFLICT (workspace_id, email) WHERE deleted_at IS NULL` u kontaktů a `ON CONFLICT (workspace_id, email) WHERE removed_at IS NULL` u suppression: obojí správně infertuje částečný unikátní index a P07 to i správně komentuje.
- `contact_consent_state`: upsert `ON CONFLICT (contact_id, purpose)` sedí na PK, `workspace_id` se do INSERTu předává explicitně, takže NOT NULL projde. Absence `workspace_id` v PK problém nedělá.
- `ON CONFLICT (workspace_id, kind, name_key)` u `name_overrides`: sedí na `uq_name_overrides__ws_kind_key`.
- `lists`: částečné unikátní indexy `uq_lists__workspace_name` a `uq_lists__workspace_default` odpovídají tomu, co úkol 25 popisuje a testuje, včetně toho, že archivace musí `is_default` shodit.
- `retention_runs.policy_id` je nullable, takže INSERT bez něj (ř. 12915) projde.
- `subscription_confirmations`: `token_hash bytea` s unikátním indexem, `consumed_at`, TTL a evidence IP i user agenta. Přesně to, co rozhodnutí R4 potřebuje.
- Tokeny pro `/u/`, `/p/` a `/r/`: bezstavové podle rozhodnutí R3, žádná tabulka není potřeba. Nonce formuláře je také bezstavový HMAC (úkol 45). Nic tu nechybí.
- Kontrola suppression přes všechna pokolení klíče (úkol 34) sedí na `idx_suppressions__ws_fingerprint` a strop na počet pokolení skutečně nikde není, jak plán slibuje.
- Vlastnictví souborů: P03 vlastní v `packages/db/src/repo` jen `tx.ts`, `registry.ts`, `workspaces-global.ts` a `audit-global.ts`. Třináct repository modulů P07 tedy **nekoliduje**. P07 nezakládá žádnou tabulku, migraci ani soubor v `packages/db/src/schema` a `packages/db/migrations`, jak sám v kapitole 7.7 slibuje. Jediná výjimka je zmíněný `test/helpers.ts` z nálezu D8.

**Rozhodnutí, která jsou schématem podložená**

- R5 (anonymizace nesmí zapsat NULL do `contacts.locale`) je věcně správné. Ověřil jsem všech pět tvrzení v komentáři úkolu 40: `status = 'deleted'` je v CHECK, `gender = 'unknown'` je v CHECK, placeholder `erased+{uuid}@erased.invalid` má 59 znaků a vejde se do rozsahu 3 až 254, `attributes = '{}'` projde oběma omezeními, `timezone` a `source_ref` jsou nullable.
- R2 (výchozí `confirmation_mode` je doménově `one_step`, v DDL `two_step`) je vědomý a plánem vysvětlený rozdíl, ne rozpor.
- R8 (ukládání IP): všechna tři místa (`form_submissions.ip`, `subscription_confirmations.request_ip` a `consumed_ip`, `consents.evidence.ip`) mají ve schématu odpovídající nullable sloupce typu `inet`, respektive jsonb.

---

## Doporučené pořadí oprav

1. **Do P03 jako nová dopředná migrace:** `contacts.search_key` s indexem (K1), tabulka `suppression_rank` s whitelistem (K2), `forms.version` (D3), úložiště odložených skupin (D4), default `contacts.status` (D5), `ck_forms__legal_basis` (D9).
2. **Do P03 jako rozšíření primitiv:** `PoolKind` a helper pro `mlain_gdpr` (K4), primitivum pro DDL indexu vlastního pole (K5), `createTestWorkspace()` a sjednocení názvu testu izolace (D8), kostra `WorkspaceSettingsSchema` (D7).
3. **Do P07 jako oprava kódu, schéma se nemění:** odstřižení `messages` (K3), zápis do `name_overrides` u akce `confirm` (K6), `erased_at` u `web_events` (D1), doplnění `message_events` a `message_engagement` (D2), volání `dropPartitionsBefore` (D6), přepočet `search_key` při změně adresy (N6).

---

## Tabulka požadavků na P03

| Co doplnit | Kdo žádá | Typ nebo tvar | Proč |
|---|---|---|---|
| `contacts.search_key` a GIN trgm index | P07 R12 (ř. 216), úkol 14 (ř. 3882) | `text` nullable, index `(workspace_id, search_key gin_trgm_ops)` | Bez něj padne 42703 při každém zápisu kontaktu |
| Tabulka `suppression_rank` | P07 úkol 35 (ř. 10884, použití 10750 až 10754) | `(reason text PK, rank smallint NOT NULL)`, bez workspace_id, do whitelistu bez RLS | Bez ní padne 42P01 při každém zablokování adresy |
| `PoolKind` a helper pro roli `mlain_gdpr` | P07 úkol 40 (ř. 12205) | `PoolKind: 'app' \| 'readOnly' \| 'gdpr'`, `withGdpr(ctx, fn)`, `GRANT SELECT ON contacts, consents TO mlain_gdpr` | `DELETE FROM consents` pod mlain_app je 42501, výmaz podle článku 17 selže vždy |
| Primitivum pro DDL indexu vlastního pole | P07 úkol 23 (ř. 6316) | úzká funkce v `packages/db` pod rolí `mlain_migrator`, ne obecný grant | `CREATE INDEX` pod mlain_app je 42501, osm indexovatelných polí nevznikne |
| `forms.version` | P07 úkol 46 (ř. 13767) | `integer NOT NULL DEFAULT 1` | Bez ní není doložitelné znění souhlasu, které člověk odsouhlasil |
| Úložiště odložených skupin fronty oslovení | P07 úkol 54 (ř. 17243) | `memberships.ui_settings jsonb NOT NULL DEFAULT '{}'` nebo tabulka `vocative_review_deferrals` | Akce „Odložit" je dnes no-op, fronta se nevyprázdní |
| Výchozí `contacts.status` na `'unconfirmed'` | P07 úkol 15 (ř. 4258) | změna DDL defaultu z `'active'` | Nový kontakt z double opt-in dnes vznikne rovnou jako `active` |
| `ck_forms__legal_basis` | P07 úkol 46 (ř. 13762) | CHECK shodný s `ck_consents__legal_basis` | Neplatná hodnota se dnes projeví až jako 23514 při odeslání formuláře |
| `createTestWorkspace()` a `isolation.matrix.test.ts` | P07 kapitola 7.2, ř. 6683 a 4020 | funkce v `test/helpers/fixtures.ts` vracející `{ ctx, cleanup, truncate, auditActions }`, sjednotit název testu izolace | 23 testovacích souborů P07 se dnes neimportuje |
| `WorkspaceSettingsSchema` v `packages/db` | P07 úkol 1 (ř. 466) | kostra zod schématu nad `workspaces.settings` | Bez ní si čtyři domény naparsují `settings` každá po svém |
