# P04 proti schématu P03: revize souladu

<!-- puvod-dokumentu -->
> **Historický záznam, ne platné zadání.** Revize plánu P04 (jádro API a identita) z prověrky plánů
> (31. 7. až 1. 8. 2026), tedy kontrola **textu plánu před stavbou**, ne kontrola kódu.
> **Verdikt typu „plán není proveditelný" se týkal tehdejšího plánu, ne dnešního produktu.** Ten stojí a funguje.
> Opravy se prováděly podle `docs/superpowers/plans/POSTUP-OPRAV.md`; **stav jednotlivých nálezů neověřen**.
> **Dnešní stav:** `docs/superpowers/STAV-UKOLU.md` (živý dokument), design `docs/superpowers/DESIGN-INTEGRACE.md`.

**Recenzovaný plán:** `docs/superpowers/plans/2026-07-31-p04-jadro-api-identita.md` (jádro API, identita, workspaces, API klíče, audit log, idempotence, rate limit, setup)
**Zdroj pravdy o schématu:** `docs/superpowers/plans/2026-07-31-p03-databaze-schema-rls.md`
**Datum revize:** 2026-08-01
**Rozsah:** kapitola 0 a úkoly 1 až 36. Soubor P04 během revize rostl z 9109 na 11634 řádků, poslední napsaná kapitola je „Úkol 36: Členové a pozvánky". Fáze webhooků, OpenAPI a jobů (úkoly 37 až 43) v době revize neexistovala, viz N5.

## Verdikt

Plán **nelze spustit proti schématu P03 bez sedmi zásahů do P03**. Rozpory nejsou kosmetické: čtyři z nich (K1, K4, K5, K6) znamenají, že se aplikace nedostane ani přes první request. Doménová část plánu je jinak se schématem v souladu, sloupce a slovníky sedí (viz N2 a N3) a plán do `packages/db` nesahá (N8).

Přehled: **7 kritických nálezů, 7 důležitých, 8 poznámek.**

Nejvíc rozporů má jeden společný kořen: P04 předpokládá tvar transakčních primitiv a několik RLS politik, které v P03 nejsou, protože P03 vznikl dřív než doménové plány. Většina oprav patří do P03, dvě do P04 (D4, D3).

---

## Kritické nálezy

### K1. Transakční primitiva mají jiná jména, jinou signaturu a jedno vůbec neexistuje

- **Co:** `withWorkspaceId`, `withUserId`, `withoutContext` z `@mlain/db`
- **Kde v P04:** kapitola 0.6 tabulka (ř. 235 až 237), Úkol 1 krok 2 (preflight sonda, ř. 386), Úkol 1 krok 4 (adaptér `packages/core/tx/index.ts`, ř. 469). Doslova: „`withWorkspaceId(workspaceId, fn)` | otevře transakci a provede `set_config('mlain.workspace_id', $1, true)`".
- **Co má P03:** `withWorkspace<T>(pool: Pool, ctx: WorkspaceContext, fn)`, `withUser<T>(pool: Pool, userId: string, fn)`, `withReadOnly<T>(pool, ctx, statementTimeoutMs, fn)` (P03 ř. 5599 až 5692). Grep na `withoutContext`, `withWorkspaceId` a `withUserId` v P03 vrací nula výskytů.
- **Tři nezávislé rozpory:** (a) jména, (b) P03 bere `Pool` prvním argumentem a P04 ho nikde nemá, přičemž P03 žádný singleton poolu neexportuje, jen továrnu `createPool`, (c) `withoutContext` neexistuje vůbec, přitom je to nejpoužívanější primitivum P04.
- **Oprava:** P03 doplní `withoutContext<T>(pool, fn)`, tedy BEGIN bez jakéhokoli `set_config`. P01 nebo P03 vystaví aplikační singleton poolu, aby adaptér P04 mohl mít signaturu bez poolu. Přejmenování je volitelné, adaptér ho ustojí; chybějící primitivum ne.
- **Proč:** bez `withoutContext` nejde napsat přihlášení, ověření session, setup ani ověření API klíče. `withReadOnly` není náhrada, nastavuje workspace_id a je read only.

### K2. `api_keys.previous_secret_hash` a `previous_expires_at` ve schématu nejsou

- **Co:** dva sloupce na `api_keys`
- **Kde v P04:** kapitola 0.6 ř. 246 („bez nich nefunguje `grace_seconds`"), Úkol 1 krok 2 (ř. 410), Úkol 30 funkce `loadApiKeyRow` (ř. 8648 a 8649), Úkol 31 kritérium 26c.
- **Co má P03:** `api_keys` = id, workspace_id, name, kind, prefix, secret_hash, scopes, created_by, last_used_at, expires_at, revoked_at, created_at, updated_at (P03 ř. 1334 až 1360). Grep `previous_secret_hash` v P03: nula.
- **Oprava:** `previousSecretHash: bytea()` nullable, `previousExpiresAt: timestamp({ withTimezone: true })` nullable. Rozšířit `ck_api_keys__secret_hash` tak, aby u `kind='public'` byly oba NULL. Index není potřeba, dohledává se přes `uq_api_keys__prefix`.
- **Proč:** bez nich spadne typová kontrola v preflightu i SQL v `loadApiKeyRow`, a kritérium 26c (rotace s grace obdobím) je neproveditelné.

### K3. Tabulka `platform.rate_limits` ani schéma `platform` neexistují

- **Co:** `platform.rate_limits`
- **Kde v P04:** kapitola 0.6 ř. 245, Úkol 1 krok 7 (ř. 554: `select to_regclass('platform.rate_limits')`), Úkol 10 krok 3 (ř. 2528 až 2534: `new RateLimiterPostgres({ tableName: 'rate_limits', schemaName: 'platform', tableCreated: true })` s komentářem „Tabulku zakládá migrace v P03").
- **Co má P03:** nic. Grep `rate_limits` v P03: nula. Jediné `CREATE SCHEMA` v P03 je na ř. 994 a zakládá schéma `drizzle`.
- **Oprava:** `CREATE SCHEMA platform;` plus tabulka v tvaru, který `rate-limiter-flexible` očekává: `key varchar(255) PRIMARY KEY, points integer NOT NULL DEFAULT 0, expire bigint`. Bez workspace_id, tedy doplnit do `TABLES_WITHOUT_WORKSPACE_ID` i `TABLES_WITHOUT_RLS` a upravit očekávané počty v `rls-registry.test.ts`. Granty pro `mlain_app` musí být explicitní: `ALTER DEFAULT PRIVILEGES` z migrace 0005 platí jen pro schéma `public`.
- **Proč:** `RATE_LIMIT_BACKEND=postgres` je v konfiguraci P01, ale bez tabulky spadne start aplikace, protože startovní kontrola z Úkolu 10 nedostupnost tabulky hlásí jako chybu konfigurace. Víceinstančový provoz by neměl funkční rate limit.

### K4. Ověření API klíče čte `api_keys` bez workspace kontextu, RLS to nepustí

- **Co:** chybí RLS politika pro dohledání klíče podle prefixu
- **Kde v P04:** Úkol 30, `loadApiKeyRow` (ř. 8636: „Načtení řádku pro ověření. Běží mimo workspace kontext, protože ten se z klíče teprve zjišťuje"), Úkol 32, middleware `authenticate` (ř. 9273: `await withoutWorkspace((tx) => verifyApiKey(bearer, (prefix, kind) => loadApiKeyRow(tx, prefix, kind)))`) a ř. 9311 (`touchApiKeyLastUsed` taky pod `withoutWorkspace`). Dotaz navíc dělá `JOIN workspaces w ON w.id = k.workspace_id` (ř. 8654).
- **Co má P03:** `api_keys` je v seznamu 63 tabulek s `ws_isolation` (USING i WITH CHECK proti `current_setting('mlain.workspace_id')`). Žádná další politika na `api_keys` neexistuje. `workspaces` má `ws_isolation_self`, `ws_member_visibility` (potřebuje `mlain.user_id`) a `ws_insert_bootstrap`.
- **Oprava:** nová politika, například
  `CREATE POLICY api_key_lookup ON api_keys FOR SELECT USING (current_setting('mlain.workspace_id', true) IS NULL AND revoked_at IS NULL);`
  a obdoba pro UPDATE kvůli `touchApiKeyLastUsed`. Čistší varianta je `SECURITY DEFINER` funkce `lookup_api_key(prefix text, kind text)`, která vrací jen sloupce potřebné k ověření. Join na `workspaces` buď pokrýt politikou, nebo `deleted_at` číst až pod kontextem.
- **Proč:** SELECT pod rolí `mlain_app` vrátí vždy nula řádků, takže každý request s `Authorization: Bearer ml_live_...` skončí na `unauthenticated`. Celá fáze E (úkoly 30 až 33, kritéria 19, 24, 25, 26, 26b, 26c) je neproveditelná. Nespadne to hlasitě, jen „klíč neexistuje", což je nejhůř dohledatelný druh chyby.

### K5. Přijetí pozvánky čte `invitations` pod `withUser`, RLS to nepustí

- **Co:** chybí RLS politika pro dohledání pozvánky podle `token_hash`
- **Kde v P04:** Úkol 36, `invitation-service.ts`, funkce `acceptInvitation`: `const found = await withUser(input.userId, async (tx) => { ... SELECT ... FROM invitations i JOIN workspaces w ... WHERE i.token_hash = ${hash} ... })`.
- **Co má P03:** `invitations` je v seznamu `ws_isolation`. Pod `withUser` není `mlain.workspace_id` nastavené, porovnání s NULL je nepravda.
- **Oprava:** `CREATE POLICY invitation_token_lookup ON invitations FOR SELECT USING (current_setting('mlain.workspace_id', true) IS NULL AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now());` Únik dat je nulový, jediný filtr, který volající má, je `token_hash` s unikátním indexem.
- **Proč:** dotaz vrátí nula řádků a `acceptInvitation` vždy hodí `not_found`. Pozvánky by nešly přijmout vůbec, a protože plán sám píše, že neplatný token vrací 404 „aby z reakce nešlo zjistit, jestli pozvánka existuje", nikdo by na příčinu z chybové hlášky nepřišel.

### K6. `INSERT INTO memberships` bez `mlain.workspace_id` selže na WITH CHECK

- **Co:** chybí bootstrap politika pro `memberships`, případně špatné pořadí `set_config` v P04
- **Kde v P04:** pět míst.
  - Úkol 34, `setup.ts` ř. 9900 až 9909: nejdřív `set_config('mlain.user_id', ...)`, pak `tx.insert(schema.memberships)`, a teprve potom `set_config('mlain.workspace_id', ...)`.
  - Úkol 35, `createWorkspace` ř. 10312 až 10314: stejné pořadí.
  - Úkol 18 test (ř. 4287), Úkol 20 test (ř. 4665 a 4666), Úkol 22 test (ř. 5200 až 5203) vkládají členství pod `withUser`.
  - Stejnou chybu má i samotný P03 v `createWorkspaceAsUser` (P03 ř. 5877 až 5879), takže to není nález jen proti P04.
- **Co má P03:** `memberships` má `ws_isolation` (USING i WITH CHECK) a `user_own_memberships`, která je jen `FOR SELECT`. Pro INSERT tedy platí výhradně `ws_isolation`, a ta bez `mlain.workspace_id` neprojde.
- **Oprava:** politika
  `CREATE POLICY member_bootstrap ON memberships FOR INSERT WITH CHECK (user_id = current_setting('mlain.user_id', true)::uuid AND role = 'owner');`
  a zároveň v P04 přesunout `set_config('mlain.workspace_id', ...)` před vložení členství. Doporučuji obojí: politiku kvůli `createWorkspaceAsUser` v P03, pořadí kvůli srozumitelnosti.
- **Proč:** bez toho spadne první spuštění instalace (`POST /api/v1/setup`) i každé založení projektu, tedy hned první request po instalaci.

### K7. `WorkspaceContext`, `Actor`, `Role` a `Permission` jsou definované dvakrát

- **Co:** dvojí branded typ
- **Kde v P04:** Úkol 12 krok 3 zakládá `packages/core/identity/types.ts` s vlastním `declare const brand: unique symbol` (ř. 2889 až 2905), Úkol 12 krok 4 zavádí `Permission` jako sjednocení 48 literálů (ř. 2939 až 2990). `unsafeWorkspaceContext` z `@mlain/db` P04 nevolá ani jednou.
- **Co má P03:** `packages/db/src/context.ts` exportuje `Role`, `Permission = string`, `Actor`, `WorkspaceContext` (branded jiným symbolem) a `unsafeWorkspaceContext`, výslovně určený „pro packages/db a packages/core/identity". `withWorkspace` a `withReadOnly` berou P03ovský `WorkspaceContext`.
- **Oprava:** P04 má typ importovat z `@mlain/db` a `createWorkspaceContext` (Úkol 18) má být tenký obal nad `unsafeWorkspaceContext`, který nejdřív ověří členství. Zúžení `Permission` na 48 literálů je v pořádku a patří do P04, P03 nechá `Permission` jako `string`, což už dělá.
- **Proč:** dva branded typy nejsou vzájemně přiřaditelné. Jakmile kterýkoli doménový plán zavolá `withReadOnly` (potřebuje ho náhled segmentu v P10) nebo `registerRepoModule`, dostane typovou chybu, kterou půjde obejít jen přetypováním, a tím padá celá první vrstva izolace. Zároveň se tím zahazuje ESLint pravidlo, které hlídá `unsafeWorkspaceContext`.

---

## Důležité nálezy

### D1. `schema` se z kořene `@mlain/db` neexportuje

- **Kde v P04:** kapitola 0.6 ř. 234 („`@mlain/db` | `schema` | ... | přímý import") a zhruba 220 výskytů `schema.<tabulka>` napříč úkoly.
- **Co má P03:** `src/index.ts` (P03 ř. 7001 až 7031) `schema` neexportuje, importuje ho jen interně v `client.ts`. Balíček má ale subpath `"./schema": "./src/schema/index.ts"` (P03 ř. 275) a P03 píše: „`@mlain/db` se importuje podcestou (`@mlain/db/schema`)".
- **Oprava:** v P04 změnit import na `import * as schema from '@mlain/db/schema';`. Alternativa `export * as schema` v P03 jde proti jeho záměru („NENÍ to doménový barrel").
- **Proč:** mechanická oprava, ale je ve všech souborech plánu, lepší ji udělat teď než po dvacátém souboru.

### D2. `mlain_app` nemá právo zakládat schéma, ale test kritéria 33 to dělá

- **Kde v P04:** Úkol 7 krok 5, `apps/web/test/api/pagination-integrity.test.ts` ř. 1907 až 1929: `CREATE SCHEMA IF NOT EXISTS pagination_probe`, `CREATE TABLE`, `CREATE INDEX`, `DROP SCHEMA ... CASCADE`, vše uvnitř `withoutWorkspace`, tedy pod aplikačním poolem.
- **Co má P03:** `GRANT USAGE ON SCHEMA public TO mlain_app` a DML granty. Žádné `CREATE`, ani na databázi, ani na schématu.
- **Oprava:** test si má otevřít vlastní spojení pod `mlain_migrator`, jak to dělají testy P03 (`h.as('mlain_migrator')`). Případně P01 doplní `GRANT CREATE ON DATABASE` jen pro testovací prostředí, v produkci ne.
- **Proč:** test spadne na `permission denied for database` a kritérium 33 se nikdy neověří.

### D3. Unikátní slug se hledá pod RLS, která cizí projekty schová

- **Kde v P04:** Úkol 35, `workspace-service.ts`, funkce `uniqueSlug` (ř. 10256 až 10265): `SELECT 1 FROM workspaces WHERE slug = ${candidate} AND deleted_at IS NULL LIMIT 1`, volaná uvnitř `withUser` v `createWorkspace` a uvnitř workspace kontextu v `updateWorkspace`.
- **Co má P03:** `uniqueIndex('uq_workspaces__slug').on(t.slug).where(deleted_at IS NULL)`, tedy globální unikátnost, a RLS, která uživateli ukáže jen projekty s jeho členstvím.
- **Oprava (v P04):** chytat SQLSTATE 23505 a zkusit další kandidát, případně si od P03 vyžádat `SECURITY DEFINER` funkci `slug_taken(text) returns boolean`.
- **Proč:** `uniqueSlug` dnes vrátí obsazený slug, INSERT skončí na unikátním indexu a uživatel dostane 500 místo 409. Projeví se to až u druhého zákazníka se stejným názvem projektu.

### D4. `restoreWorkspace` mění `workspaces` bez jakéhokoli kontextu

- **Kde v P04:** Úkol 35, `workspace-service.ts` ř. 10436 až 10442: `UPDATE workspaces SET deleted_at = NULL ... RETURNING ...` uvnitř `withUser`, přičemž `set_config('mlain.workspace_id', ...)` se volá až po tomhle UPDATE.
- **Co má P03:** pro UPDATE nad `workspaces` platí jen `ws_isolation_self` (`id = current_setting('mlain.workspace_id')`). `ws_member_visibility` je `FOR SELECT`, `ws_insert_bootstrap` je `FOR INSERT`.
- **Oprava (v P04):** přesunout `set_config('mlain.workspace_id', ${workspaceId}, true)` před UPDATE. Politiku měnit netřeba.
- **Proč:** UPDATE ovlivní nula řádků bez chyby, `restored[0]!` je `undefined` a endpoint spadne na `TypeError`, tedy 500. Projekt zůstane smazaný.

### D5. `withWorkspace` v P04 nenastavuje `mlain.user_id`, a tři místa to obcházejí ručním `set_config`

- **Kde v P04:** Úkol 1 krok 4, adaptér ř. 474 až 476 (`withWorkspace(workspaceId, fn)` bez aktéra). Obchvaty: Úkol 34 ř. 9900 a 9909, Úkol 35 ř. 10314 a 10442.
- **Co má P03:** `withWorkspace(pool, ctx, fn)` nastaví `mlain.workspace_id` vždy a `mlain.user_id` jen u aktéra typu `user`.
- **Posouzení dopadu:** dnes žádná politika nepotřebuje `mlain.user_id` současně s workspace kontextem. `user_own_memberships` i `ws_member_visibility` jsou obě `FOR SELECT` a uvnitř workspace kontextu je pokrývá `ws_isolation`. Audit log `user_id` nečte, `actor_id` se předává jako hodnota. Ztráta `user_id` v P04 tedy zatím nic nerozbíjí. Rozbíjí to ale opačný směr: existují tři flow, které potřebují oba GUC naráz, a všechny sahají pod adaptér.
- **Oprava:** P03 doplní primitivum nastavující oba GUC (`withUserAndWorkspace(pool, userId, workspaceId, fn)`), nebo P04 zachová P03ovskou signaturu s `ctx`. Ruční `set_config` uvnitř doménové služby je přesně to, co má adaptér zapouzdřit.

### D6. P04 si píše vlastní varianty funkcí, které P03 exportuje

- **Kde v P04:** Úkol 35 zakládá `createWorkspace` (ř. 10292) a `listWorkspaces` (ř. 10267), Úkol 23 zakládá `listWorkspacesOfUser` (ř. 5682). P03ovské `createWorkspaceAsUser`, `listWorkspacesForUser` a `listGlobalAuditForUser` P04 nevolá ani jednou.
- **Co má P03:** tři exportované funkce, `packages/db/test/workspaces-global.test.ts` s pěti testy a migraci 0008, která kvůli `listGlobalAuditForUser` zavádí politiku `user_own_global_audit`.
- **Oprava:** rozhodnout jednou. Buď P04 tyhle funkce použije, čímž zmizí i chyba K6 v P03, nebo se z P03 vypustí i s testy. Politika `user_own_global_audit` má zůstat, potřebuje ji výpis „moje přihlášení" v profilu uživatele.
- **Proč:** dvě implementace téhož s různým chováním vůči RLS je zdroj rozporu, který se pozná až za běhu.

### D7. Test helper mlčky nic nesmaže

- **Kde v P04:** Úkol 34 krok 1, `resetInstallation` v `setup.test.ts` (ř. 9691 až 9698): `DELETE FROM memberships`, `DELETE FROM workspaces`, `DELETE FROM users` pod `withoutWorkspace`.
- **Co má P03:** `memberships` i `workspaces` mají RLS. Bez kontextu je `USING` nepravda, takže DELETE smaže nula řádků a nehlásí chybu. Projde jen `DELETE FROM users`, protože users má RLS vypnutou.
- **Oprava:** helper má běžet pod `mlain_migrator`, stejně jako `seedTwoWorkspaces` v P03.
- **Proč:** `beforeEach` bude vypadat, že uklidil. Testy „na prázdné instalaci vrací true" budou padat, nebo hůř, náhodně procházet.

---

## Poznámky

### N1. Nejvýš jeden owner nikdo nevynucuje

P03 explicitně píše „vynucuje aplikace (P04)". P04 v `transferOwnership` (Úkol 35, ř. 10500 až 10517) dělá dva samostatné UPDATE bez `SELECT ... FOR UPDATE` a bez zámku nad projektem, takže dva souběžné převody nechají dva ownery. Oprava: `FOR UPDATE` nad řádky členství v P04, nebo částečný unikátní index `uniqueIndex('uq_memberships__single_owner').on(t.workspaceId).where(sql\`role = 'owner'\`)` v P03.

### N2. Co jsem ověřil jako v pořádku, sloupec po sloupci

Mimo K2 jsem **nenašel žádný chybějící sloupec**:

- **`audit_log`** (Úkol 22): P04 zapisuje `workspace_id`, `actor_type`, `actor_id`, `actor_label`, `action`, `target_type`, `target_id`, `ip`, `user_agent`, `request_id`, `metadata`. Všech jedenáct existuje. `workspace_id` je nullable a `ws_isolation_audit` má ve `WITH CHECK` NULL povolený, takže kritérium 21b projde. `target_id` je `uuid` a P04 do něj dává jen UUID, ověřeno na všech osmi výskytech `targetId:`.
- **`idempotency_keys`** (Úkol 9): PK `(workspace_id, key)`, `fingerprint bytea`, `status` s CHECK na obě hodnoty, které P04 zapisuje, `response_status`, `response_body jsonb` nullable pro odpověď nad 64 kB. `locked_at` má `defaultNow()`, což je podstatné, protože P04 ho při INSERTu nevyplňuje a bez defaultu by INSERT spadl na NOT NULL.
- **`sessions`** (Úkol 16): `csrf_secret bytea`, `absolute_expires_at`, `last_used_at`, `revoked_reason` bez CHECK, takže všech šest hodnot `RevokedReason` projde. **Sloupec pro idle timeout nechybí**, P04 ho počítá z `last_used_at` a `SESSION_IDLE_TTL_DAYS`.
- **`users`** (úkoly 23, 28, 29): `failed_login_count`, `locked_until`, `password_changed_at`, `email_verified_at`, `deleted_at` sedí s implementací zamykání účtu i změny hesla.
- **`api_keys`** (Úkol 30): CHECK na prefix (8 znaků `[a-z2-7]` u secret, 16 u public) sedí s formátem `ml_live_ugzmhvhf_...` a `ml_pub_...`. `scopes text[]` bez CHECK snese všech 48 hodnot P04. `secret_hash` NULL u veřejného klíče sedí s CHECK `ck_api_keys__secret_hash`.
- **`system_settings`** (Úkol 34): `setup_completed_at` nullable, řádek zakládá migrace 0007 (`INSERT ... VALUES (true, 0, '') ON CONFLICT DO NOTHING`), takže `isSetupAvailable()` má co číst. Singleton CHECK `id = true` P04 respektuje.
- **`workspaces`**: `address_form`, `settings`, `created_by`, `deleted_at` sedí s `PublicWorkspace` v Úkolu 35.

### N3. Slovníky sedí, žádný nesoulad

P04 zapisuje `idempotency_keys.status` z {in_progress, completed}, `api_keys.kind` z {secret, public}, `memberships.role` a `invitations.role` z {owner, admin, editor, viewer}, `audit_log.actor_type` z {user, api_key, system}, `workspaces.address_form` z {formal, informal}. Vše je uvnitř CHECK v P03. Obráceně také nic nezůstává nezapsané. `webhook_endpoints.status='disabled'` a stavy `webhook_deliveries` zatím nikdo nezapisuje, ale příslušné úkoly P04 ještě nejsou napsané.

### N4. Granty jsou v pořádku

Kromě D2 (chybějící CREATE) a K3 (grant na novou tabulku) nechybí nic. Append-only REVOKE z migrace 0006 se P04 netýká: do `audit_log` jen vkládá, `consents` ani `message_events` nepoužívá.

### N5. Plán není dopsaný, část zadání nešla zrecenzovat

Poslední existující kapitola je Úkol 36. Kapitoly 0.1 a 0.4 slibují úkoly 37 až 43: webhooky (`endpoint-service`, `emit`, `deliver`, `disable`, `delivery-query`, SSRF), audit query endpoint, OpenAPI a joby. Body zadání „`webhook_endpoints` a `webhook_deliveries`, retry stavy, event_types" a „registr oprávnění" tedy nejdou uzavřít. Co už teď plyne ze schématu a bude třeba prověřit, až úkoly vzniknou: `webhook_endpoints` **nemá sloupec `name` ani `created_by`**, má jen `description NOT NULL DEFAULT ''`, takže pokud obrazovka z kapitoly 5.3 chce endpointy pojmenovávat, sloupec chybí. `webhook_deliveries` nemá `response_headers` ani `attempted_at`, jen `duration_ms` a `delivered_at`.

### N6. `secret_encrypted` je TEXT u `webhook_endpoints` a BYTEA u `inbound_endpoints`

Pro P04 je TEXT správně, protože `encryptEnvelope` vrací `enc:v1:<base64>`. Nesoulad mezi oběma tabulkami patří do revize P07 nebo P11, tady je jen zaznamenaný.

### N7. Idempotence a souběh

`withIdempotency` (Úkol 9) běží celý uvnitř jedné transakce, takže řádek `in_progress` je pro souběžný request neviditelný až do commitu. Druhý request se zablokuje na unikátním indexu místo aby dostal `idempotency_request_in_progress`, a mechanismus převzetí po 60 sekundách (`LOCK_TAKEOVER_SECONDS`) tak nikdy nenastane. Není to nesoulad se schématem, ale stojí za zvážení commitnout `in_progress` v samostatné transakci.

### N8. Dvojí vlastnictví: čisté

P04 nezakládá žádnou tabulku, migraci ani soubor v `packages/db`. Jediné dva zásahy do cizích souborů jsou přiznané v kapitole 0.3 (`packages/core/package.json` a `apps/web/package.json`, obojí P01, jen přidání závislostí). Požadavky na schéma jsou ale schované v tabulce předpokladů 0.6 a v kroku 7 preflightu. Patří do samostatné kapitoly „požadavky na P03", aby je nikdo nepřehlédl.

---

## Souhrnná tabulka

| Co doplnit | Kdo žádá | Typ nebo tvar | Proč |
|---|---|---|---|
| `withoutContext(pool, fn)` v `packages/db/src/repo/tx.ts` | P04 0.6 ř. 237, Úkol 1 ř. 386 a 469 | transakce bez `set_config`, export z `@mlain/db` | bez ní nejde napsat login, setup, ověření session ani ověření API klíče |
| Singleton aplikačního poolu, nebo primitiva bez argumentu `pool` | P04 Úkol 1, adaptér ř. 474 až 489 | `Pool` z `createPool(config.DATABASE_URL)` na jednom místě | P03ovská primitiva berou `pool` prvním argumentem, P04 ho nikde nemá |
| `api_keys.previous_secret_hash` | P04 0.6 ř. 246, Úkol 30 ř. 8648 | `bytea` NULL, bez indexu | bez něj nejde rotace klíče s grace obdobím, kritérium 26c |
| `api_keys.previous_expires_at` | P04 0.6 ř. 246, Úkol 30 ř. 8649 | `timestamptz` NULL | určuje konec platnosti starého sekretu |
| Tabulka `platform.rate_limits` a schéma `platform` | P04 0.6 ř. 245, Úkol 1 ř. 554, Úkol 10 ř. 2530 | `key varchar(255) PK, points int NOT NULL DEFAULT 0, expire bigint`, granty pro `mlain_app`, whitelist bez RLS | bez ní nefunguje `RATE_LIMIT_BACKEND=postgres` a víceinstančový rate limit |
| Politika `api_key_lookup` (SELECT) a obdoba pro UPDATE na `api_keys` | P04 Úkol 30 ř. 8636, Úkol 32 ř. 9273 a 9311 | `USING (current_setting('mlain.workspace_id', true) IS NULL AND revoked_at IS NULL)`, nebo `SECURITY DEFINER` funkce | jinak vrací ověření klíče vždy nula řádků a celá fáze E je mrtvá |
| Politika `invitation_token_lookup` (SELECT) na `invitations` | P04 Úkol 36, `acceptInvitation` | `USING (mlain.workspace_id IS NULL AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now())` | jinak vrací přijetí pozvánky vždy 404 |
| Politika `member_bootstrap` (INSERT) na `memberships` | P04 Úkol 34 ř. 9907, Úkol 35 ř. 10312, testy ř. 4287, 4665, 5200; i P03 `createWorkspaceAsUser` | `WITH CHECK (user_id = current_setting('mlain.user_id', true)::uuid AND role = 'owner')` | jinak spadne první spuštění instalace i každé založení projektu |
| Sjednotit `WorkspaceContext`, `Actor`, `Role` na verzi z `@mlain/db` | P04 Úkol 12 ř. 2877 až 2905 vs P03 `context.ts` | import z `@mlain/db`, `createWorkspaceContext` jako obal nad `unsafeWorkspaceContext` | dva branded typy nejsou přiřaditelné, `withReadOnly` a `registerRepoModule` půjdou zavolat jen přetypováním |
| Import `schema` přes `@mlain/db/schema` | P04 0.6 ř. 234 a zhruba 220 výskytů | `import * as schema from '@mlain/db/schema'` | kořenový `index.ts` v P03 `schema` neexportuje |
| CREATE právo pro testovací roli, nebo test pod `mlain_migrator` | P04 Úkol 7 ř. 1907 | `h.as('mlain_migrator')` v testu | `mlain_app` má jen USAGE, test kritéria 33 spadne na permission denied |
| `set_config('mlain.workspace_id')` před UPDATE v `restoreWorkspace` | P04 Úkol 35 ř. 10436 až 10442 | přesun jednoho řádku, oprava v P04 | UPDATE dnes ovlivní nula řádků, endpoint spadne na `undefined` |
| Ošetření kolize slugu přes SQLSTATE 23505 | P04 Úkol 35 ř. 10256 | catch 23505 a další kandidát, nebo `SECURITY DEFINER slug_taken()` | RLS schová cizí projekt, uživatel dostane 500 místo 409 |
| Primitivum nastavující oba GUC naráz | P04 ruční `set_config` na ř. 9900, 9909, 10314, 10442 | `withUserAndWorkspace(pool, userId, workspaceId, fn)` | doménové služby dnes sahají pod adaptér a nastavují GUC ručně |
| Vynucení jediného ownera | P03 („vynucuje aplikace P04"), P04 Úkol 35 ř. 10500 | `SELECT ... FOR UPDATE` v P04, nebo částečný unikátní index `WHERE role='owner'` v P03 | souběžný převod vlastnictví nechá dva ownery |
| Test helper `resetInstallation` pod rolí migrátora | P04 Úkol 34 ř. 9691 | `h.as('mlain_migrator')` | RLS smaže nula řádků bez chyby, testy se navzájem ovlivní |
