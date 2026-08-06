# P08 proti P03: revize souladu doménového plánu s databázovým schématem

<!-- puvod-dokumentu -->
> **Historický záznam, ne platné zadání.** Revize plánu P08 (šablony a renderer) z prověrky plánů
> (31. 7. až 1. 8. 2026), tedy kontrola **textu plánu před stavbou**, ne kontrola kódu.
> **Verdikt typu „plán není proveditelný" se týkal tehdejšího plánu, ne dnešního produktu.** Ten stojí a funguje.
> Opravy se prováděly podle `docs/superpowers/plans/POSTUP-OPRAV.md`; **stav jednotlivých nálezů neověřen**.
> **Dnešní stav:** `docs/superpowers/STAV-UKOLU.md` (živý dokument), design `docs/superpowers/DESIGN-INTEGRACE.md`.

**Recenzovaný plán:** `docs/superpowers/plans/2026-07-31-p08-sablony-model-renderer.md` (12019 řádků)
**Zdroj pravdy pro schéma:** `docs/superpowers/plans/2026-07-31-p03-databaze-schema-rls.md`
**Datum:** 2026-08-01
**Rozsah:** fáze G (Task 35 až 41) a fáze H (Task 42), tedy všechna místa, kde P08 sahá na databázi. Fáze A až F jsou čistá logika bez IO a schématu se netýkají.

## Verdikt

**Plán se v současné podobě nedá provést.** Fáze A až F (`packages/emails`, tedy 34 z 43 úkolů) jsou v pořádku a na schématu nezávisí. Fáze G a H mají tři kritické nálezy, z nichž dva zastaví typecheck nebo první běh DB testů hned na prvním úkolu, a jeden je tichá ztráta dat u zákazníka.

Slovníky, výčty a tvary sloupců sedí lépe, než jsem čekal. Skutečný problém není v tom, že by ve schématu něco chybělo, ale v tom, že P08 přistupuje k databázi způsobem, který P03 nepodporuje a který obchází RLS.

Počty: **3 kritické**, **7 důležitých**, **9 poznámek**.

---

## KRITICKÉ

### K1. Repository vrstva obchází RLS a s primitivy P03 ji nejde napsat

**Kde:** Task 35, kroky 3 a 4 (`repository.ts`, `assets.ts`, P08 řádky 9640 až 9816), Task 37 krok 3 (`versions.ts`, řádky 10198 až 10306).

**Co plán dělá:** Všechny dotazy píše nad Drizzle instancí, kterou předává jako první argument: `db: Database, workspaceId: string, ...` (řádek 9641), pak `await db.insert(schema.templates).values({...})` (9645) a `return db.transaction(async (tx) => {...})` (10200).

**Co P03 má:**
- `ws_isolation` politika je i na `templates`, `template_versions`, `assets` a `content_snippets` (P03 řádky 5063 až 5066), s `USING (workspace_id = current_setting('mlain.workspace_id', true)::uuid)` a stejným `WITH CHECK`.
- `withWorkspace(pool: Pool, ctx: WorkspaceContext, fn: (tx: Tx) => Promise<T>)`, kde `export type Tx = PoolClient` (P03 5599 až 5633). Callback tedy dostane syrového `pg` klienta, ne Drizzle.
- `createDb(pool)` vrací `drizzle(pool, { schema, casing: 'snake_case' })` (P03 5724 až 5730), tedy Drizzle nad **poolem**, ne nad klientem v transakci.
- Komentář P03 na řádku 5605: „Bez transakce se dotaz nespustí a repository vrstva ji vždy otevírá."

**Důsledek:** `db.select()` běží na náhodném spojení z poolu bez `set_config`. `current_setting(..., true)` vrátí NULL, porovnání je NULL, tedy nepravda. `findTemplateById` vrátí `undefined` vždy, `db.insert(schema.templates)` selže na `WITH CHECK`. Spadne všech pět testů v `repository.db.test.ts` (Task 35 krok 1), včetně toho, který má izolaci dokazovat.

**Navrhovaná oprava:** P03 doplní primitivum, které dá doméně Drizzle vázaný na transakčního klienta:

```ts
export type WorkspaceDb = ReturnType<typeof drizzle<typeof schema, PoolClient>>;
export async function withWorkspaceDb<T>(
  pool: Pool, ctx: WorkspaceContext, fn: (db: WorkspaceDb) => Promise<T>
): Promise<T>;
```

P08 pak přepíše signatury na `(db: WorkspaceDb, ...)`. Druhá varianta: `withWorkspace` zůstane a P08 uvnitř volá `drizzle(tx, { schema, casing: 'snake_case' })`, pak ale P03 musí `schema` i nastavení `casing` vystavit jako součást kontraktu, aby si to každá doména nekonfigurovala jinak.

**Poznámka navíc:** `packages/core/templates` nemá jak `WorkspaceContext` vůbec vyrobit. Továrna `unsafeWorkspaceContext` je ESLint pravidlem `no-restricted-imports` vyhrazená pro `packages/db` a `packages/core/identity`. Nejostřeji to dopadá na handler fronty `revalidateTemplates` (Task 40 krok 4, řádky 10956 až 11005), který kontext nedostává vůbec, jen `db` a `workspaceId`.

### K2. `import { schema } from "@mlain/db"` neexistuje

**Kde:** Task 35 kroky 3 a 4 (řádky 9634, 9759), Task 37 krok 3 (řádek 10178). Použití dál: `typeof schema.templates.$inferSelect` (9638), `schema.templateVersions` (10181), `schema.assetVariants` (9775).

**Co P03 má:** `packages/db/src/index.ts` (P03 7001 až 7031) exportuje `createDb`, `createPool`, `Database`, `PoolKind`, `unsafeWorkspaceContext`, `Actor`, `Permission`, `Role`, `WorkspaceContext`, `withReadOnly`, `withUser`, `withWorkspace`, `Tx`, `registerRepoModule` a další. Pojmenovaný export `schema` mezi nimi **není**. Balíček ho vystavuje podcestou: `"./schema": "./src/schema/index.ts"` (P03 řádek 275). Vlastní pravidlo P03 v kapitole 8 (řádek 7181) zní: „Doménové plány schéma jen importují (`import { contacts } from '@mlain/db/schema'`)".

**Navrhovaná oprava:** V P08 změnit na `import * as schema from "@mlain/db/schema";` plus `import type { Database } from "@mlain/db";`, případně jmenované importy `import { templates, templateVersions, assets, assetVariants } from "@mlain/db/schema";`. Oprava je celá v P08, P03 se měnit nemusí.

**Proč kritické:** Bez toho neprojde typecheck ani jednoho ze tří souborů, tedy celá fáze G.

### K3. Šablony drží assety, ale `asset_references` ani `reference_count` nikdo neudržuje

**Kde:** Task 35 krok 4, řádek 9796: „`/** Všechna assetId, na která dokument odkazuje. Vstup pro loadAssetRefs i pro asset_references. */`". Zápisy šablon jsou na řádcích 9645 (`createTemplateRow`), 9709 (`updateTemplateDesign`), 9735 (`softDeleteTemplate`) a 10216 (insert do `template_versions`). Ani v jednom reference nefigurují. Grep `assetReferences` v celém P08 nevrací nic.

**Co P03 má:** `asset_references` s PK(asset_id, ref_type, ref_id), `ref_type` hlídaný jen regexem `^[a-z][a-z0-9_]{0,31}$` (P03 2373 až 2380). `assets.reference_count integer NOT NULL DEFAULT 0` s komentářem (P03 2331 až 2334): „Denormalizace `asset_references`. Aktualizuje ji repository vrstva ve stejné transakci jako zápis do `asset_references`, NE trigger." A `purged_at`: „soubor smazán, jen při reference_count = 0".

**Navrhovaná oprava:** Buď P08 rozšířit o krok, který v téže transakci jako zápis `templates.design` srovná množinu `asset_references` pro `ref_type = 'template'` a `ref_id = template_id` a odpovídající deltou upraví `assets.reference_count`, nebo v kapitole 39 založit požadavek na vlastníka assetů, kdo tuhle údržbu dělá. Zároveň někam patří uzavřený registr hodnot `ref_type` v aplikaci, protože databáze ho podle P03 vědomě nehlídá.

**Proč kritické:** `reference_count` zůstane nula i u obrázku, který je v pěti šablonách. Purge job ho smaže a rozešlou se maily s rozbitými obrázky. P08 v kapitole 40 (řádek 11949) zpracování assetů vylučuje, jenže `templates` je jediný pisatel téhle reference, takže s odkazem na „mimo rozsah" ta odpovědnost nemá vlastníka vůbec.

---

## DŮLEŽITÉ

### D1. `templates.used_fields` se při zakládání šablony nikdy nezapíše

**Kde:** Task 38 krok 3, `createTemplate` (řádky 10499 až 10515), proti Task 35 kroku 3, `updateTemplateDesign` (řádky 9707 a 9708).

**Co se děje:** `createTemplate` nejdřív vloží řádek přes `createTemplateRow` (bez `usedFields`) a hned poté volá `updateTemplateDesign` se **stejným** dokumentem, aby `usedFields` doplnil. `updateTemplateDesign` ale porovná hashe, ty jsou z definice shodné, a vrátí `{ changed: false }` dřív, než se dostane k `UPDATE`.

**Co P03 má:** `usedFields: text().array().notNull().default([])` a `index('idx_templates__used_fields').using('gin', t.usedFields)` (P03 2396 a 2416).

**Oprava:** `usedFields` předat rovnou do `createTemplateRow(...).values({...})` a volání `updateTemplateDesign` z `createTemplate` vypustit.

**Proč:** Dopadová analýza smazaného kontaktního pole (`findTemplateIdsUsingField` na řádcích 9740 až 9751 a `revalidateTemplates` na 10971) čte výhradně z `used_fields`. Nově založená, importovaná ani duplikovaná šablona se v ní neobjeví, dokud ji někdo neuloží podruhé. Uživatel smaže pole, dostane hlášku „používá to 0 šablon" a rozešle kampaň s prázdným oslovením. Přes `createTemplate` jde i `importTemplate` (řádek 11215) a `duplicateTemplate` (10533), takže chyba se propisuje do všech tří cest.

### D2. `duplicateTemplate` porušuje `ck_templates__name_len` i `uq_templates__workspace_name`

**Kde:** Task 38 krok 3, řádek 10536: „`name: \`${source.name} (kopie)\`,`". Mapování chyb je v Task 42 kroku 3, `mapError` (řádky 11655 až 11674).

**Co P03 má:** `check('ck_templates__name_len', sql\`length(${t.name}) BETWEEN 1 AND 120\`)` a `uniqueIndex('uq_templates__workspace_name').on(t.workspaceId, sql\`lower(${t.name})\`).where(sql\`${t.deletedAt} IS NULL\`)` (P03 2409, 2414 a 2415).

**Oprava:** Jméno zkrátit tak, aby se i s příponou vešlo do 120 znaků, a při kolizi přidat pořadové číslo, například „(kopie 2)". Do `mapError` doplnit mapování `23505` na `409 template_name_conflict` a `23514` na `422`. Dnes obojí propadne do `throw error`, tedy na 500.

**Proč:** Šablonu se jménem 118 znaků nejde zkopírovat vůbec, dvojí zkopírování téže šablony spadne na unikátním indexu. Vlastní test P08 na duplicitu jména (Task 35 krok 1, řádky 9612 až 9619) přitom existenci indexu potvrzuje, jen z něj plán nevyvodil důsledek pro kopii.

### D3. `pruneVersions` může smazat verzi, na kterou míří `templates.current_version_id`

**Kde:** Task 37 krok 3, `pruneVersions` (řádky 10277 až 10305). Retence maže nepřipnuté verze starší než N dní a nad rámec M nejnovějších, aktuální verzi z výběru nevylučuje.

**Co P03 má:** Migrace 0002 (P03 3784 a 3785): `ADD CONSTRAINT fk_templates__current_version FOREIGN KEY (current_version_id) REFERENCES template_versions(id) ON DELETE SET NULL;`

**Oprava:** Do obou mazacích dotazů přidat vyloučení aktuální verze, například `AND id <> (SELECT current_version_id FROM templates WHERE id = template_versions.template_id)`.

**Proč:** `ON DELETE SET NULL` znamená, že se to nikde neprojeví chybou. Šablona jen tiše ztratí ukazatel na aktuální verzi a API začne vracet `current_version: null` bez zjevného důvodu. Příznak `pinned` chrání jen verze použité kampaní, ne tu právě aktuální, takže šablona, do které se rok nesáhlo, o svou verzi přijde.

### D4. `restoreVersion` nepřepisuje `schema_version` ani `used_fields`

**Kde:** Task 37 krok 3, řádky 10262 až 10264: `await db.update(schema.templates).set({ design, designHash: designHash(design), updatedAt: new Date() })`.

**Co P03 má:** `templates.schemaVersion integer NOT NULL DEFAULT 1` a `usedFields text[]` jako samostatné sloupce (P03 2388 a 2396). `template_versions` má vlastní `schemaVersion` (P03 2425), takže se hodnoty mohou lišit.

**Oprava:** Do `set({...})` doplnit `schemaVersion: design.schemaVersion` a `usedFields` spočítané přes `buildRenderSchema`, stejně jako to dělá `updateTemplateDesign` na řádcích 9709 až 9714.

**Proč:** Verze uložená před migrací dokumentu má nižší `schemaVersion`. Po obnovení sedí `design` na starou verzi, ale sloupec hlásí novou, takže `loadDocument` (Task 7) migraci nespustí a validátor pojede staré schéma proti novým pravidlům. `used_fields` zůstane z předchozího návrhu, takže dopadová analýza ukazuje pole, která už v šabloně nejsou, a neukazuje ta, která přibyla.

### D5. Renderer vydává typ pole `"string"`, který slovník `contact_fields.type` nezná

**Kde:** Task 26 krok 3, `typeOf` (řádky 7547 až 7551): `function typeOf(path: string, catalog: FieldCatalog): FieldCatalogType { if (!path.startsWith("contact.")) return "string"; ... return entry?.type ?? "string"; }`. Test to fixuje v Task 26 kroku 1, řádek 7491: `expect(schema.fields[0]!.type).toBe("string")` pro `workspace.sender_address`.

**Co P03 má:** `ck_contact_fields__type` s výčtem `text, long_text, number, boolean, date, datetime, enum, multi_enum, url, email, phone` (P03, tabulka `contact_fields`). Hodnota `string` v něm není.

**Oprava:** Buď v P08 vracet `"text"` místo `"string"`, pak sedí s DB slovníkem, nebo v P02 zavést `RenderSchemaFieldType` jako samostatný výčet, který je nadmnožinou `FieldCatalogType`, a `typeOf` přetypovat na něj. Rozhodnutí patří do kapitoly 0.5 P08, protože `RenderSchema` je součást zmrazeného kontraktu pro Go sender.

**Proč:** Není to kosmetika. `FieldCatalogType` je odvozený od `contact_fields.type`, takže návrat `"string"` z funkce deklarované jako `FieldCatalogType` neprojde typecheckem. A pokud P02 `"string"` do typu doplní, dostane Go sender ve `render_schema` hodnotu, kterou jeho koercní tabulka odvozená z DB slovníku nezná.

### D6. Doména `templates` se neregistruje přes `registerRepoModule`

**Kde:** chybí. Task 38 krok 4 (`packages/core/src/templates/index.ts`, řádky 10547 až 10566) exportuje jen doménové funkce. Grep `registerRepoModule` v P08 nevrací nic.

**Co P03 má:** `registerRepoModule`, `registeredRepoModules` a `RepoModule` v exportech (P03 7012 až 7014), s komentářem (P03 5958 až 5963): „Doménový plán se sem zaregistruje a generický test izolace jeho čtecí funkce automaticky zavolá pod cizím kontextem. Části 2 až 5 tak nemusí psát vlastní izolační testy. Bez registru by každý doménový plán musel na izolaci pamatovat sám, a to je přesně ten druh ochrany, který nic nevynucuje."

**Oprava:** Do `packages/core/src/templates/index.ts` doplnit registraci se čtenáři `findTemplateById`, `listTemplates`, `listVersions`, `findTemplateIdsUsingField` a `loadAssetRefs`.

**Proč:** P08 má vlastní izolační test jen na `findTemplateById` (Task 35 krok 1, řádky 9579 až 9586). Ostatních pět čtecích funkcí nemá izolační test žádný a s dnešní signaturou ho ani mít nemůže. Signatura registru `call: (pool: Pool, ctx: WorkspaceContext) => Promise<unknown>` navíc nezávisle potvrzuje nález K1: P03 čekal doménové čtení nad `Pool` a `WorkspaceContext`, ne nad `Database` a `workspaceId: string`.

### D7. `content_snippets` nemá vlastníka a chybí mu `schema_version`

**Kde:** P08 se o tabulku zmíní jedinou větou v kapitole 0.3 (řádek 42): „Tabulky `templates`, `template_versions`, `assets`, `asset_references`, `content_snippets` už existují, tenhle plán je jen čte a zapisuje do nich přes repository." Nikde je ale nečte ani nezapisuje a v kapitole 40 pro ně nemá soubor.

**Co P03 má:** `content_snippets` se sloupci `id`, `workspace_id`, `name`, `design jsonb NOT NULL`, `created_at`, `updated_at` a `uniqueIndex('uq_content_snippets__workspace_name')` (P03 2584 až 2593). U `design` komentář: „pole bloků, ne celý dokument". A u `templates.kind` (P03 2408): „Druh 'snippet' je zrušený: sdílené bloky mají jedno místo, `content_snippets`."

**Oprava:** Rozhodnout vlastníka. Pokud jím je P08, doplnit do kapitoly 40 soubor `packages/core/src/templates/snippets.ts` a požádat P03 o `content_snippets.schema_version integer NOT NULL DEFAULT 1`, případně i `design_hash bytea`. Pokud vlastníkem je P12 (editor), napsat to do kapitoly 39 jako předání.

**Proč:** `design` snippetu je pole bloků z téhož modelu, který P08 verzuje přes `MIGRATIONS` a `loadDocument` (Task 7). Bez `schema_version` nejde u snippetu poznat, které migrace se mají pustit, takže první změna blokového modelu snippety tiše rozbije. `templates` i `template_versions` ten sloupec mají, `content_snippets` jako jediná nositelka téhož JSONu ne. Zrušením druhu `snippet` navíc P03 přesunul odpovědnost na tabulku, kterou žádný plán nečte, takže sdílené bloky dnes neimplementuje nikdo.

---

## POZNÁMKY

### N1. Izolace `asset_variants` je odvozená, ne vynucená

Task 35 krok 4, řádky 9769 až 9776. `loadAssetRefs` nejdřív načte `assets` s `eq(workspaceId)` a teprve pak filtruje `asset_variants` přes `inArray(assetId, rows.map(r => r.id))`. To je správně: `asset_variants` podle P03 (2361 až 2374) workspace_id ani RLS nemá a izolace se dědí z předchozího dotazu. Stojí za to ten vztah v P08 pojmenovat komentářem, protože dotaz na varianty projde i bez workspace kontextu. Kdyby někdo `assetIds` napojil rovnou z requestu místo z výsledku prvního dotazu, izolace zmizí bez jediné chyby.

### N2. `AssetRef` nenese `original_filename`, export vydává `public_id` jako jméno souboru

Task 41 krok 3, řádek 11167: `filename: \`${asset.publicId}\``. P03 má `assets.original_filename text NOT NULL` (řádek 2327), ale do `AssetRef` (Task 15 krok 3, řádky 4067 až 4076) se nedostane. Export šablony tak vydá dvaadvacetiznakový identifikátor tam, kde slibuje `filename`. Doplnit `originalFilename: string` do `AssetRef` a do `loadAssetRefs`.

### N3. Čtyři sloupce `template_versions` nikdo v P08 neplní

`compiled_html`, `compiled_text`, `compile_meta` a `renderer_version` jsou v `createVersion` nastavené z `input.compiled` (Task 37 krok 3, řádky 10222 až 10225), jenže jediný volající v P08 je router (Task 42 krok 3, řádky 11614 až 11617), který `compiled` nepředává, a `restoreVersion` (10267 až 10271), který také ne. Sloupce tedy v celém P08 zůstávají NULL. Je to konzistentní s tím, že je má naplnit P13 při `reason: 'pre_send'`, ale v kapitole 39 takový požadavek uvedený není. Doporučuju doplnit řádek R11: „P13 při vytvoření předodesílací verze předá `compiled: { html, text, meta, rendererVersion }`."

### N4. `current_version_id` a `thumbnail_asset_id` se do API nedostanou

Task 42 krok 3, `serialize` (řádky 11440 až 11449) vrací natvrdo `current_version: null` a `thumbnail_url: null`, přestože `createVersion` `current_version_id` plní (řádky 10233 až 10235) a `templates.thumbnail_asset_id` s FK na `assets` existuje (P03 2397). Thumbnail v P08 nenastavuje nikdo, takže sloupec zůstane prázdný napořád. Patří to buď do kapitoly 39 jako předání vlastníkovi assetů, nebo do seznamu vědomě nepokrytého.

### N5. `CompileContext.brand` se z `brand_profiles` nikdy nenačte

`CompileContext` má `brand?: BrandProfileRef` (Task 15 krok 3, řádek 4084), ale `compileTemplate` ho do kontextu nepředává (Task 36 krok 4, řádky 10039 až 10052) a `brand_profiles` P08 nečte vůbec. Buď doplnit načtení výchozího profilu (`uq_brand_profiles__workspace_default`, P03 2466 a 2467), nebo pole z kontraktu vyškrtnout, ať v něm neleží mrtvá větev.

### N6. `campaign_links` nic dalšího nepotřebuje, ale komentář v P03 neplatí

Prověřoval jsem, jestli P08 chce na `campaign_links` sloupec pro typ odkazu, hash URL nebo `is_unsubscribe`. Nechce. Funkce `record()` v `collectLinks` (Task 25 krok 3, okolí řádku 7340) zapisuje jen odkazy, které projdou `isTrackableTarget`, takže `CompiledLink.trackable` je v `links[]` vždy `true` a systémové značky (`unsubscribe_url`, `preferences_url`, `webview_url`) se do seznamu nedostanou vůbec. Sloupce `id`, `workspace_id`, `campaign_id`, `url`, `position`, `label` a `created_at` (P03 2826 až 2836) stačí.

Nesedí jen komentář. P03 u `url` píše „původní URL, může obsahovat Liquid", zatímco P08 v `CompiledLink.url` garantuje „Absolutní statická URL, nikdy neobsahuje Liquid výraz" (řádek 4080). Odkaz s proměnnou v `href` se podle rozhodnutí D8 buď odmítne kódem `liquid_in_trackable_href`, nebo projde jako netrackovatelný a do `campaign_links` se nedostane. Komentář v P03 sjednotit, jinak si P13 přečte, že Liquid v tom sloupci čekat má.

### N7. `design_hash` nemá kontrolu délky

`assets.sha256` má `check('ck_assets__sha256_len', sql\`octet_length(${t.sha256}) = 32\`)` (P03 2354), ale `templates.design_hash` ani `template_versions.design_hash` obdobný CHECK nemají. P08 nad nimi dělá `current.designHash.equals(hash)` (řádky 9706, 9708 a 10215) a přijímá `if_design_hash` z requestu přes `Buffer.from(body.if_design_hash, "hex")` (Task 42 krok 3, řádek 11525) bez kontroly délky, takže do větve `precondition_failed` může vlézt prázdný nebo přerostlý buffer. Doplnit `octet_length = 32` na obou sloupcích a délku ověřit i v routeru.

### N8. `setValidationState` posouvá `updated_at`, tedy kurzor stránkování

`setValidationState` (Task 35 krok 3, řádky 9729 až 9731) nastavuje `updatedAt: new Date()`, a `listTemplates` (řádek 9685) stránkuje právě podle `updated_at DESC` s kurzorem. Hromadná převalidace po smazání kontaktního pole (`revalidateTemplates`, řádky 10971 až 11003) tak přerovná celý seznam a klient uprostřed stránkování buď přeskočí, nebo zdvojí řádky. Buď `updated_at` v `setValidationState` nechat být, nebo stránkovat podle dvojice `(updated_at, id)`. Index `idx_templates__workspace_updated` (P03 2413) druhý sloupec neobsahuje, takže stabilní kurzor by chtěl i změnu indexu.

### N9. `templates.design` nemá strop velikosti

`contacts.attributes` má `pg_column_size(attributes) <= 4 MiB`, `templates.design` žádný analogický CHECK nemá. P08 hlídá velikost jen aplikačně přes `content_too_many_blocks` a `content_html_too_large` (Task 9 a Task 11). Není to blokující nález, jen konstatování, že poslední pojistka na velikost dokumentu je v aplikaci, ne v databázi.

---

## Co jsem ověřil jako v pořádku

Tohle jsem prověřoval a **nález tu není**. Uvádím to proto, aby to nikdo nemusel projít znovu.

| Oblast | Závěr |
|---|---|
| `template_versions.compile_meta` proti `CompileMeta` | Sedí. `compile_meta` je `jsonb` nullable, do kterého se `CompileMeta` (Task 15 krok 3, řádky 4090 až 4105) vejde celý, včetně `clickMarkerCount`, `links`, `renderSchema`, `usedPaths`, `htmlBytes`, `textBytes`, `warnings`, `hasUnsubscribeLink` a `hasOpenPixelSlot`. `renderer_version text` odpovídá `RENDERER_VERSION = "r1.0.0"`. Hash je pokrytý samostatným `design_hash bytea`, v `compile_meta` chybět nemusí. |
| `templates.kind` CHECK | Sedí. P08 používá `TemplateKind = "campaign" \| "transactional" \| "system"` (řádek 9636), druh `snippet` nezapisuje nikde. |
| `template_versions.reason` CHECK | Sedí. `VersionReason = "manual" \| "pre_send" \| "ai_apply" \| "restore" \| "import"` (řádek 10180) je přesně výčet z `ck_template_versions__reason`. Zapisují se `manual` (router) a `restore` (`restoreVersion`). |
| `templates.validation_state` a `validation_errors` | Sedí. `setValidationState` přijímá `"unknown" \| "valid" \| "invalid"` a pole issues do `jsonb NOT NULL DEFAULT []`. |
| `templates.design_hash` jako bytea | Sedí. `designHash()` (Task 4, řádek 1166) vrací `Buffer` s SHA-256 nad kanonickou serializací, sloupec je `bytea().notNull()`, takže `.equals()` na něm je bezpečné. |
| `templates.schema_version` a `used_fields` jako typy | Sedí. `integer` a `text[]`, GIN index nad `used_fields` existuje a `findTemplateIdsUsingField` používá `@>`, tedy operátor, který ten index umí. |
| `templates.starter` | Sedí. Sloupec existuje jako `boolean NOT NULL DEFAULT false`, `deleteTemplate` na něm staví `template_starter_immutable`. |
| Unikátní index na jméno šablony | Existuje (`uq_templates__workspace_name`), takže test „rejects a duplicate name" je oprávněný. Problém je jen v tom, že `duplicateTemplate` s ním nepočítá (viz D2). |
| Index pro stránkování seznamu | Existuje (`idx_templates__workspace_updated` nad `(workspace_id, updated_at DESC)` s `WHERE deleted_at IS NULL`), takže `listTemplates` sekvenční průchod nedělá. |
| `assets` sloupce pro `AssetRef` | Sedí všechny: `public_id`, `mime_type`, `width`, `height`, `alt_text`, `frame_count` (pro `animated`), `purged_at` pro filtr. Chybí jen `original_filename` v samotném typu, viz N2. |
| `asset_variants` sloupce | Sedí: `variant`, `width`, `height`, PK(asset_id, variant). |
| `campaign_links` tvar | Stačí. Žádný sloupec pro `trackable`, hash URL ani `is_unsubscribe` P08 nepotřebuje, viz N6. |
| `contact_fields.key` regex | Nekoliduje. Renderer pracuje s cestami typu `contact.attr.<key>` a klíč sám nevymýšlí, bere ho z katalogu polí od P07. |
| Granty | V pořádku. `mlain_app` má `SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public` plus default privileges (P03 5189 až 5195). `templates`, `template_versions`, `assets`, `asset_variants`, `asset_references` ani `content_snippets` nejsou v append-only revoke seznamu (P03 5322 až 5366), takže `db.delete(schema.templateVersions)` v `pruneVersions` právo má. Chybějící grant tu žádný není. |
| Dvojí vlastnictví | Není. P08 nezakládá žádnou tabulku, migraci ani soubor v `packages/db`. Kapitola 40 `packages/db/**` výslovně uvádí v sekci „Jen čte, nikdy nemění" a fáze G začíná větou „Migrace nespouštěj a `drizzle-kit generate` nevolej ani omylem" (řádek 9541). |
| Textová varianta | P08 do `templates` nekompiluje nic. `compiled_text` existuje jen na `template_versions` a `campaigns` a P08 s tím počítá: endpoint `/compile` vrací výsledek v odpovědi, neukládá ho (Task 42 krok 3, řádky 11586 až 11605). Rozpor tu není. |

---

## Řádky pro souhrnnou tabulku

| Co doplnit | Kdo žádá | Typ nebo tvar | Proč |
|---|---|---|---|
| Drizzle vázaný na transakci s RLS kontextem, například `withWorkspaceDb(pool, ctx, fn)` a typ `WorkspaceDb` | P08 Task 35 kroky 3 a 4, Task 37 krok 3 | nové primitivum v `packages/db/src/repo/tx.ts` a export z `index.ts` | `Tx` je `PoolClient`, P08 píše Drizzle nad poolem; bez `set_config` vrátí `ws_isolation` nula řádků a INSERT spadne na WITH CHECK |
| Oprava importu na `import * as schema from "@mlain/db/schema"` | P08 řádky 9634, 9759, 10178 | změna v P08, ne v P03 | `packages/db/src/index.ts` `schema` neexportuje, podcesta `./schema` ano |
| Údržba `asset_references` s `ref_type='template'` a `assets.reference_count` v téže transakci jako zápis `templates.design` | P08 Task 35 krok 4, komentář na řádku 9796 | nový krok v repository P08 plus registr `ref_type` v aplikaci | P03 ukládá údržbu repository vrstvě; jinak `reference_count` zůstane nula a purge smaže používaný obrázek |
| `usedFields` zapsat rovnou v `createTemplateRow` | P08 Task 38 krok 3 proti Task 35 kroku 3 | `values({ ..., usedFields })` | hash-shodné volání `updateTemplateDesign` skončí na `changed:false`, nová šablona `used_fields` nikdy nedoplní |
| Zkrácení a kolizní suffix jména kopie, mapování 23505 a 23514 v `mapError` | P08 Task 38 krok 3 a Task 42 krok 3 | `name.slice(0, 112) + " (kopie N)"` | `ck_templates__name_len` 1 až 120 a `uq_templates__workspace_name` jinak dají 500 |
| Vyloučit `templates.current_version_id` z `pruneVersions` | P08 Task 37 krok 3 | `AND id <> templates.current_version_id` v obou DELETE | FK má `ON DELETE SET NULL`, ztráta ukazatele je tichá |
| `restoreVersion` má nastavit i `schema_version` a `used_fields` | P08 Task 37 krok 3 | doplnit do `.set({...})` | verze uložená před migrací dokumentu má jiný `schemaVersion`, `loadDocument` pak migraci nespustí |
| Sjednotit typ pole ve `RenderSchema`: buď `"text"`, nebo samostatný `RenderSchemaFieldType` | P08 Task 26 krok 3 a test v kroku 1 | rozhodnutí do kapitoly 0.5 P08 plus požadavek na P02 | `"string"` není v `ck_contact_fields__type` |
| `registerRepoModule({ name: 'templates', readers: [...] })` | chybí, P03 to předpokládá | volání v `packages/core/src/templates/index.ts` | pět ze šesti čtecích funkcí P08 dnes izolační test nemá |
| `content_snippets.schema_version integer NOT NULL DEFAULT 1`, zvážit `design_hash bytea`, plus určení vlastníka tabulky | P08 řádek 42, jinak nikde | ALTER v nové dopředné migraci P03 | `design` je pole bloků z modelu, který P08 verzuje; bez `schema_version` nejde snippet migrovat |
| `originalFilename` do `AssetRef` a `loadAssetRefs` | P08 Task 15 krok 3 a Task 41 krok 3 | `originalFilename: string` | `assets.original_filename` je NOT NULL, export dnes vydává `public_id` jako `filename` |
| Řádek R11 do kapitoly 39: P13 předá `compiled` do `createVersion` | P08 Task 37 krok 3 a Task 42 krok 3 | požadavek na P13 | jinak `compiled_html`, `compiled_text`, `compile_meta` a `renderer_version` zůstanou trvale NULL |
| `octet_length(design_hash) = 32` na `templates` i `template_versions`, kontrola délky `if_design_hash` v routeru | P08 Task 35 krok 3, Task 37 krok 3, Task 42 krok 3 | pojmenovaný CHECK v nové migraci | `assets.sha256` ten CHECK má, tyhle dva ne, a P08 nad nimi porovnává buffery z requestu |
| Stabilní kurzor `(updated_at, id)` nebo nebumpovat `updated_at` v `setValidationState` | P08 Task 35 krok 3 proti stejnému kroku | změna P08, případně rozšíření `idx_templates__workspace_updated` o `id` | hromadná převalidace přerovná seznam a klient uprostřed stránkování řádky přeskočí nebo zdvojí |
| Sjednotit komentář `campaign_links.url` s garancí P08 | P08 Task 15 krok 3 proti P03 řádku 2830 | jen komentář v P03 | P08 do `links[]` netrackovatelné odkazy ani systémové značky nezapisuje, Liquid se tam nedostane |
