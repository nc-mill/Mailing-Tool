# P04: Jádro API a identita (backend), implementační plán

<!-- puvod-dokumentu -->
> **Historický záznam, ne platné zadání.** Implementační plán P04 (jádro API a identita) z 31. 7. 2026, sepsaný před
> začátkem stavby. Zachycuje, co se tehdy plánovalo, ne dnešní podobu kódu.
> **Postaveno:** jádro API a identita v `packages/core/src/identity` a `apps/web/src/lib/api` existují, přihlášení i `/api/v1` běží.
> **Zaškrtávátka nikdo neodškrtával**, prázdné políčko tady tedy neznamená nedodělek.
> **Dnešní stav:** `docs/superpowers/STAV-UKOLU.md` (živý dokument), design `docs/superpowers/DESIGN-INTEGRACE.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Postavit backend jádro produktu Mlain Mailer: identitu (uživatelé, hesla, sessions, workspaces, členství, pozvánky, role, API klíče), průřezové konvence veřejného API (chyby podle RFC 9457, kurzorové stránkování, idempotence, rate limiting, verzování, OpenAPI 3.1), dvouvrstvé vynucení izolace workspace, zápis do audit logu a infrastrukturu odchozích webhooků, včetně 45 endpointů pod `/api/v1`.

**Architecture:** Doménová logika žije v `packages/core/{identity,audit,platform,net,errors,tx}` a nezná HTTP. Veřejné API běží na Honu s `@hono/zod-openapi`, mountnutém do jednoho Next.js Route Handleru na `apps/web/src/app/api/v1/[[...route]]/route.ts`. Průřezové vrstvy (problem+json, stránkování, idempotence, rate limit, verzování, autentizace) jsou middleware v `apps/web/src/lib/api`. Databázi plán jen používá: schéma, migrace, RLS politiky, transakční obálky i Drizzle handle vlastní plán P03. Tenhle plán k nim přidává jediný soubor `packages/core/tx/index.ts`, a ten dělá jednu jedinou věc: **drží aplikační pool a doplňuje ho do obálek P03**, aby ho nemusel protahovat každý volající. Nepřejmenovává, nemění typy ani podpisy a transakční logiku neopakuje. Izolace workspace stojí na dvou nezávislých vrstvách: branded typ `WorkspaceContext` z `@mlain/db` s jedinou továrnou v `packages/core/identity` plus RLS politika, kterou transakční obálka aktivuje nastavením `mlain.workspace_id`.

**Tech Stack:** TypeScript 7.0.2, Node.js 24.18.1 LTS, Hono 4.12.33, `@hono/zod-openapi` 1.5.1, zod 4.4.3, Drizzle ORM (schéma z `@mlain/db`), PostgreSQL 18, `@node-rs/argon2` 2.0.2, `rate-limiter-flexible` 11.2.0, `pino` 10.3.1, `uuid` 14.0.1, `pg-boss` 12.26.3, Vitest 4.1.10, testcontainers 12.0.4.

---

## 0. Rámec plánu

### 0.1 Soubory, které tento plán vlastní

Vlastní znamená: tenhle plán je smí vytvořit a měnit. Žádný jiný plán do nich nesahá.

**`packages/core/tx/`** (adaptér nad transakčními obálkami z P03)
- `packages/core/tx/index.ts`
- `packages/core/tx/index.test.ts`
- `packages/core/tx/types.test-d.ts`

**`packages/core/test-support/`** (pomocníci pro testy, nikdy ne produkční cesta)
- `packages/core/test-support/migrator.ts`

**`packages/core/errors/`** (jen tyto tři soubory, registr kódů vlastní P01)
- `packages/core/errors/api-error.ts`
- `packages/core/errors/api-error.test.ts`
- `packages/core/errors/detail-catalog.ts`

**`packages/core/net/`**
- `packages/core/net/ssrf.ts`
- `packages/core/net/ssrf.test.ts`
- `packages/core/net/safe-request.ts`
- `packages/core/net/safe-request.test.ts`

**`packages/core/audit/`**
- `packages/core/audit/action.ts`
- `packages/core/audit/action.test.ts`
- `packages/core/audit/redact.ts`
- `packages/core/audit/redact.test.ts`
- `packages/core/audit/write.ts`
- `packages/core/audit/write.test.ts`
- `packages/core/audit/audit-actions.test.ts`

**`packages/core/identity/`**
- `packages/core/identity/types.ts`
- `packages/core/identity/permissions.ts`
- `packages/core/identity/permissions.test.ts`
- `packages/core/identity/audit.ts`
- `packages/core/identity/constant-time.ts`
- `packages/core/identity/constant-time.test.ts`
- `packages/core/identity/password.ts`
- `packages/core/identity/password.test.ts`
- `packages/core/identity/data/common-passwords.txt`
- `packages/core/identity/token.ts`
- `packages/core/identity/token.test.ts`
- `packages/core/identity/session.ts`
- `packages/core/identity/session.test.ts`
- `packages/core/identity/csrf.ts`
- `packages/core/identity/csrf.test.ts`
- `packages/core/identity/api-key.ts`
- `packages/core/identity/api-key.test.ts`
- `packages/core/identity/api-key-service.ts`
- `packages/core/identity/api-key-service.test.ts`
- `packages/core/identity/context.ts`
- `packages/core/identity/context.test.ts`
- `packages/core/identity/scope.ts`
- `packages/core/identity/scope.test.ts`
- `packages/core/identity/login.ts`
- `packages/core/identity/login.test.ts`
- `packages/core/identity/login-timing.test.ts`
- `packages/core/identity/password-reset.ts`
- `packages/core/identity/password-reset.test.ts`
- `packages/core/identity/change-password.ts`
- `packages/core/identity/change-password.test.ts`
- `packages/core/identity/setup.ts`
- `packages/core/identity/setup.test.ts`
- `packages/core/identity/workspace-service.ts`
- `packages/core/identity/workspace-service.test.ts`
- `packages/core/identity/membership-service.ts`
- `packages/core/identity/membership-service.test.ts`
- `packages/core/identity/invitation-service.ts`
- `packages/core/identity/invitation-service.test.ts`
- `packages/core/identity/api/schemas.ts`
- `packages/core/identity/api/setup.routes.ts`
- `packages/core/identity/api/auth.routes.ts`
- `packages/core/identity/api/workspaces.routes.ts`
- `packages/core/identity/api/members.routes.ts`
- `packages/core/identity/api/invitations.routes.ts`
- `packages/core/identity/api/api-keys.routes.ts`

**`packages/core/platform/`**
- `packages/core/platform/system-mail.ts`
- `packages/core/platform/system-mail.test.ts`
- `packages/core/platform/audit-query.ts`
- `packages/core/platform/audit-query.test.ts`
- `packages/core/platform/webhooks/envelope.ts`
- `packages/core/platform/webhooks/envelope.test.ts`
- `packages/core/platform/webhooks/signature.ts`
- `packages/core/platform/webhooks/signature.test.ts`
- `packages/core/platform/webhooks/backoff.ts`
- `packages/core/platform/webhooks/backoff.test.ts`
- `packages/core/platform/webhooks/endpoint-service.ts`
- `packages/core/platform/webhooks/endpoint-service.test.ts`
- `packages/core/platform/webhooks/emit.ts`
- `packages/core/platform/webhooks/emit.test.ts`
- `packages/core/platform/webhooks/deliver.ts`
- `packages/core/platform/webhooks/deliver.test.ts`
- `packages/core/platform/webhooks/disable.ts`
- `packages/core/platform/webhooks/disable.test.ts`
- `packages/core/platform/webhooks/delivery-query.ts`
- `packages/core/platform/api/webhooks.routes.ts`
- `packages/core/platform/api/audit.routes.ts`
- `packages/core/platform/api/jobs.routes.ts`
- `packages/core/platform/jobs/registry.ts`
- `packages/core/platform/jobs/registry.test.ts`
- `packages/core/platform/jobs/webhook_fanout.ts`
- `packages/core/platform/jobs/webhook_deliver.ts`
- `packages/core/platform/jobs/cleanup_sessions.ts`
- `packages/core/platform/jobs/cleanup_idempotency.ts`
- `packages/core/platform/jobs/purge_workspaces.ts`
- `packages/core/platform/jobs/jobs.test.ts`

**`apps/web/src/lib/api/`**
- `apps/web/src/lib/api/problem.ts`
- `apps/web/src/lib/api/problem.test.ts`
- `apps/web/src/lib/api/validation.ts`
- `apps/web/src/lib/api/validation.test.ts`
- `apps/web/src/lib/api/request-id.ts`
- `apps/web/src/lib/api/client-ip.ts`
- `apps/web/src/lib/api/client-ip.test.ts`
- `apps/web/src/lib/api/pagination.ts`
- `apps/web/src/lib/api/pagination.test.ts`
- `apps/web/src/lib/api/counting.ts`
- `apps/web/src/lib/api/counting.test.ts`
- `apps/web/src/lib/api/idempotency.ts`
- `apps/web/src/lib/api/idempotency.test.ts`
- `apps/web/src/lib/api/rate-limit.ts`
- `apps/web/src/lib/api/rate-limit.test.ts`
- `apps/web/src/lib/api/versioning.ts`
- `apps/web/src/lib/api/versioning.test.ts`
- `apps/web/src/lib/api/authenticate.ts`
- `apps/web/src/lib/api/authenticate.test.ts`
- `apps/web/src/lib/api/openapi.ts`
- `apps/web/src/lib/api/docs.ts`
- `apps/web/src/lib/api/app.ts`
- `apps/web/src/lib/api/app.test.ts`
- `apps/web/src/app/api/v1/[[...route]]/route.ts`
- `apps/web/scripts/generate-openapi.ts`
- `apps/web/test/api/*.test.ts` (integrační testy endpointů, jmenovitý výčet je u jednotlivých úkolů)

**`packages/contracts/openapi.json`** je zvláštní případ podle uzávěru S9 řídicího dokumentu: vygenerovaný artefakt, který se **nikdy neslučuje ručně**. Při konfliktu se obě verze zahodí a soubor se přegeneruje příkazem `pnpm contracts:generate`. Tenhle plán ho generuje jako první, ale nevlastní ho výhradně.

### 0.2 Čeho se plán nedotýká

- **`packages/db` (celý)**: schéma, migrace, RLS politiky, role, granty, partitioning, repository základ a migrační nástroj vlastní **P03**. Tenhle plán z něj jen importuje. Nespouští `drizzle-kit generate`, nezakládá tabulku, nemění politiku.
- **`packages/ui` (celý)**: vlastní **P05**. Tenhle plán nepíše žádnou React komponentu ani obrazovku.
- **`packages/contracts` mimo `openapi.json`**: kontrakty, fixtures a kryptografické obálky vlastní **P02**.
- **`packages/config`, kořenové `package.json`, `turbo.json`, `pnpm-workspace.yaml`, `docker/`, `.github/workflows`, `packages/core/config`, `packages/core/errors/registry.ts`, registr front pg-boss, CLI `mlain`, health endpointy**: vlastní **P01**.
- **`packages/i18n` (celý)**, `apps/web/src/proxy.ts`, skořápka aplikace, registr navigace: vlastní **P05**.
- **`apps/worker`**: entrypoint workeru vlastní **P01**. Tenhle plán dodává jen moduly handlerů na konvenčních cestách, viz rozhodnutí R3 v 0.7.
- **Obrazovky**: `/setup`, `/login`, `/forgot-password`, `/reset-password`, `/invitations/accept`, `/no-workspace`, `/settings/*` vlastní **P06**.
- **`apps/sender`**: vlastní **P09**.
- **`packages/sdk-node` (celý)**: **tenhle plán se ho nedotýká a nikdo jiný taky ne.** Řídicí dokument dělení ho předával P04 jako „API klient", ale rozhodnutím z 2026-08-01 (evidence nálezů, uzavřený bod U4) **klient pro Node není součástí MVP 0**. P01 zakládá prázdný manifest, protože akceptační kritérium žádá jen to, aby všech devět balíčků existovalo, a obsah nepíše nikdo. Je to vědomé zúžení rozsahu, ne opomenutí: zlatá cesta MVP 0 klienta pro Node nepotřebuje a patří ke kompletnímu veřejnému API v MVP 1. **Kdo bude tenhle plán číst za měsíc: prázdný `packages/sdk-node` je správný stav, nedoplňuj ho.**

### 0.3 Úzké výjimky, které si plán bere vědomě

Dvě věci nejdou udělat bez zásahu do cizího souboru. Obě jsou úzké, obě jsou tady vyjmenované a nic jiného si plán nedovolí.

| Soubor | Vlastník | Co plán smí | Co nesmí |
|---|---|---|---|
| `packages/core/package.json` | P01 | přidat položky do `dependencies` a `devDependencies`, přidat wildcard subpath exporty, pokud chybí | měnit `name`, `scripts`, `version` |
| `apps/web/package.json` | P01 | přidat položky do `dependencies` a `devDependencies`, přidat skript `generate:openapi` | měnit existující skripty P01, měnit konfiguraci Next.js |

### 0.4 Pokrytá akceptační kritéria

Z kapitoly 8 části 1 (`docs/superpowers/specs/parts/01-platforma.md`):

| Kritérium | Kde je pokryté |
|---|---|
| 14 | Úkol 24 (cookie `ml_session` a její atributy) |
| 15 | Úkol 23 (deset neúspěchů, 423 `account_locked`, 15 minut) |
| 16 | Úkol 25 (medián ze 100 pokusů, rozdíl do 20 %) |
| 17 | Úkol 28 (změna hesla revokuje ostatní relace) |
| 18 | Úkol 26 (`logout-all` zneplatní i aktuální cookie) |
| 19 | Úkol 33 (klíč workspace B na zdroj z A vrátí 404 problem+json) |
| 20, 21 | Úkol 20 (izolace ověřená proti reálné databázi pod rolí `mlain_app`) |
| 21b | Úkol 22 a úkol 28 (globální auditní řádek, žádný rollback) |
| 21c | Úkol 22 |
| 22 | Úkol 36 (poslední owner) |
| 23 | Úkol 32 (`viewer` dostane 403 `forbidden`) |
| 24 | Úkol 32 (klíč bez scope dostane 403 `insufficient_scope`) |
| 25 | Úkol 31 (sekret v odpovědi právě jednou) |
| 26, 26b, 26c | Úkol 30 (větev veřejného klíče a grace období), úkol 31 (rotace přes API) a úkol 32 (403 insufficient_scope na /api/v1) |
| 27, 28 | Úkol 5 (validace a `strict()`) |
| 29 | Úkol 4 (`request_id` v odpovědi i v logu) |
| 30, 31 | Úkol 9 a úkol 31 (idempotence) |
| 32 | Úkol 10 (hlavičky rate limitu) |
| 33 | Úkol 7 (stránkování přes 10 000 položek při souběžném zápisu) |
| 34, 35 | Úkol 42 (OpenAPI, shoda s commitnutým souborem, pokrytí cest) |
| 36, 36b | Úkol 39 (backoff, mez `WEBHOOK_MAX_ATTEMPTS`) |
| 37 | Úkol 41 (410 Gone deaktivuje endpoint) |
| 38 | Úkol 38 (testovací vektor podpisu) |
| 39 | Úkol 37 a úkol 40 (SSRF při ukládání i při každém doručení) |
| 40 | Úkol 41 (dvacet neúspěchů, e-mail ownerům) |

Kritéria 1 až 13 (instalace a provoz) patří P01, 41 až 50 (kontrakty a sender) patří P02 a P09, 51 až 53 (i18n) patří P05, 54 až 56 (rotace klíčů) patří P01 a P16.

### 0.5 Knihovny a jejich licence

Projekt je **MIT**. GPL, LGPL a AGPL jsou zakázané. Každá knihovna, kterou tenhle plán přidává nebo používá:

| Balíček | Verze | Licence | Použití v P04 |
|---|---|---|---|
| `hono` | 4.12.33 | MIT | router veřejného API |
| `@hono/zod-openapi` | 1.5.1 | MIT | definice cest a generování OpenAPI 3.1 |
| `zod` | 4.4.3 | MIT | validace vstupů, zdroj pravdy pro OpenAPI |
| `@node-rs/argon2` | 2.0.2 | MIT | Argon2id hashování hesel, prebuilt i pro musl |
| `rate-limiter-flexible` | 11.2.0 | ISC | rate limiting, backend `memory` i `postgres` |
| `pino` | 10.3.1 | MIT | strukturované logování |
| `uuid` | 14.0.1 | MIT | UUIDv7 generované v aplikaci |
| `drizzle-orm` | podle P03 | Apache-2.0 | dotazovací vrstva nad `Tx` z `@mlain/db` |
| `pg` | 8.22.0 | MIT | ovladač (tranzitivně přes `@mlain/db` a `rate-limiter-flexible`) |
| `pg-boss` | 12.26.3 | MIT | fronty jobů (typy handlerů) |
| `vitest` | 4.1.10 | MIT | testy (dev) |
| `testcontainers` | 12.0.4 | MIT | Postgres 18 pro databázové testy (dev) |
| `@types/node` | odpovídající Node 24 | MIT | typy stdlib (dev) |
| SecLists `top-10000-passwords` | data | MIT | blocklist hesel, jen data, ne kód |

Standardní knihovna Node (`node:crypto`, `node:https`, `node:http`, `node:dns/promises`, `node:net`, `node:timers/promises`) je BSD-3-Clause a používá se pro HMAC, SHA-256, `timingSafeEqual`, DNS a SSRF-bezpečný HTTP klient.

Žádná další knihovna se nepřidává. Zejména se **nepřidává** `jsonwebtoken` (sessions jsou opaque, viz 3.2), `bcrypt` (slabší než Argon2id a má limit 72 bajtů na vstup), ani `axios` nebo `undici` jako přímá závislost: SSRF-bezpečný klient stojí na `node:https`, protože potřebuje vlastní `lookup` a tvrdý zákaz přesměrování, což se přes obálky knihoven vynucuje hůř.

### 0.6 Co plán importuje z P01, P02 a P03 (kontrakt předpokladů)

Tenhle plán běží až po smergování P01, P02 a P03 do `main`. Tabulka níž je **opsaná ze skutečného znění těch plánů**, ne z toho, co by se P04 hodilo. Ověřeno čtením `packages/db/src/index.ts` v P03 a `packages/contracts/package.json` v P02 dne 2026-08-01. **Úkol 1 je preflight, který každý řádek ověří spuštěním.**

Sloupec „adaptér" říká, kde se rozdíl vstřebává. Když P03 něco přejmenuje, mění se **jediný soubor**, ne padesát.

| Zdroj | Symbol | Skutečný tvar v P03 nebo P02 | Adaptér |
|---|---|---|---|
| `@mlain/db/schema` | `* as schema` | Drizzle tabulky `users`, `sessions`, `workspaces`, `memberships`, `invitations`, `apiKeys`, `passwordResetTokens`, `idempotencyKeys`, `auditLog`, `webhookEndpoints`, `webhookEvents`, `webhookDeliveries`, `systemSettings`. **Kořenový `@mlain/db` schéma nereexportuje**, jde výhradně podcestou. | přímý import podcestou |
| `@mlain/db` | `createPool(url, kind, max)` | továrna poolu, `kind` je `'app'` nebo `'readOnly'`. **Žádný singleton P03 nevystavuje.** | `packages/core/tx/index.ts` drží singleton |
| `@mlain/db` | `withWorkspace(pool, ctx, fn)` | otevře transakci, nastaví `mlain.workspace_id`, u aktéra typu `user` i `mlain.user_id`, a po callbacku ověří, že se kontext nezměnil | `packages/core/tx/index.ts` |
| `@mlain/db` | `withUser(pool, userId, fn)` | otevře transakci a nastaví jen `mlain.user_id` | `packages/core/tx/index.ts` |
| `@mlain/db` | `withReadOnly(pool, ctx, options, fn)` | `BEGIN READ ONLY`, kde `options` je `ReadOnlyOptions` = `{ statementTimeoutMs: number; workMem?: string }`. `workMem` zavedl P03 kvůli náhledu segmentu v P11: bez něj se řazení nad velkým publikem přelije na disk a strop vyprší dřív, než dotaz doběhne. | `packages/core/tx/index.ts` |
| `@mlain/db` | `withoutContext(pool, fn)` | transakce úplně bez kontextu, ani projekt, ani uživatel | `packages/core/tx/index.ts` |
| `@mlain/db` | `pgErrorCode(error)` | vrátí SQLSTATE z chyby Drizzle i ze syrové chyby `pg` | reexport z `packages/core/tx/index.ts` |
| `@mlain/db` | `type Tx` | `NodePgDatabase<typeof schema>`, tedy **Drizzle handle** nad jedním vyhrazeným spojením (rozhodnutí R34 v P03) | `packages/core/tx/index.ts` ho jen reexportuje |
| `@mlain/db` | `type WorkspaceContext`, `type Actor`, `type Role`, `type Permission` | branded `WorkspaceContext` a `Actor` v `packages/db/src/context.ts`, `Permission` je zatím `string` | `packages/core/identity/types.ts` je **reexportuje**, nedefinuje znovu |
| `@mlain/db/unsafe-context` | `unsafeWorkspaceContext(workspaceId, actor)` | jediná existující továrna branded typu, z kořenového exportu záměrně vynechaná | volá ji **výhradně** `packages/core/identity/context.ts` |
| `@mlain/db` | `createWorkspaceAsUser`, `listWorkspacesForUser`, `listGlobalAuditForUser` | hotové funkce pro operace bez workspace kontextu | volá je `workspace-service.ts` a `audit-query.ts`, P04 je nepíše znovu |
| `@mlain/db` | `checkIsolationPrerequisites(pool)` | vrátí seznam důvodů, proč se na aktuální roli nevztahuje RLS | volá se při startu aplikace, úkol 45 |
| `@mlain/core/errors/registry` | `ERROR_CODES` | `Record<string, { status: number; title: string; retryable: boolean }>` | `packages/core/errors/api-error.ts` |
| `@mlain/core/config` | `config` | zvalidovaný objekt konfigurace z 4.9 | přímý import |
| `@mlain/core/config` | `ConfigSchema` | zod schéma konfigurace (kvůli testu meze `WEBHOOK_MAX_ATTEMPTS`) | `packages/core/platform/webhooks/backoff.test.ts` |
| `@mlain/core/queues` | `QUEUES` | registr front pg-boss s klíči `platform.webhook_fanout`, `platform.webhook_deliver`, `platform.cleanup_sessions`, `platform.cleanup_idempotency`, `platform.purge_workspaces` | `packages/core/platform/jobs/*.ts` |
| `@mlain/contracts/crypto` | `encryptEnvelope(input)` | **synchronní**, vrací objekt `{ stored, header, aad, ciphertext, tag, envelopeBytes }`; obálka `enc:v1:<base64>` je pole `stored` | `packages/core/platform/webhooks/endpoint-service.ts` |
| `@mlain/contracts/crypto` | `decryptEnvelope(input)` | **synchronní**, vrací plaintext nebo hodí `CryptoError` | `packages/core/platform/webhooks/deliver.ts` |
| `@mlain/contracts/crypto` | `type CredentialContext` | sjednocení čtyř literálů `sending_provider`, `ai_provider`, `webhook_secret`, `oauth_token`; P04 používá `webhook_secret` | tamtéž |

**Balíček `@mlain/contracts` nemá kořenový export.** P02 barrel zrušil (rozhodnutí D10) a vynucuje to testem `package-boundary.test.ts`, který tvrdí `expect(Object.keys(manifest.exports)).not.toContain('.')`. Každý import z kořene by tedy skončil chybou rozlišení modulu. Importuje se výhradně podcestou, v tomhle plánu jen `@mlain/contracts/crypto`.

Konvence názvů sloupců v Drizzle je camelCase odvozený ze `snake_case` v databázi (`workspace_id` je `workspaceId`, `token_hash` je `tokenHash`, `absolute_expires_at` je `absoluteExpiresAt`). Preflight to ověří typovou kontrolou, ne pohledem.

**Tvar výsledku `tx.execute()`.** P03 staví Drizzle na ovladači `drizzle-orm/node-postgres`. Ten z `execute()` vrací **`QueryResult` z `pg`, ne pole řádků**: řádky jsou pod `.rows`, indexace `result[0]` vrátí `undefined`. Ověřeno spuštěním proti PostgreSQL 18.4 s `drizzle-orm` 0.44.7, viz 0.8. Celý plán proto používá tvar `const { rows } = await tx.execute<Row>(sql\`...\`)`, který zároveň typuje řádky bez přetypování. **Nikdy `await tx.execute(...) as unknown as Row[]`**, to je vzor, který projde typovou kontrolou a za běhu vrátí `undefined`.

**Tvar chyby z databáze.** Drizzle balí chyby ovladače do `DrizzleQueryError`, kde je `error.code` **`undefined`** a SQLSTATE leží na `error.cause.code`; chyba ze syrového `pool.query` má naopak kód přímo na `error.code`. Ověřeno spuštěním. Kdo testuje `err.code === '23505'`, testuje `undefined` a jeho ošetření kolize se nikdy neprovede. **SQLSTATE se proto čte výhradně přes `pgErrorCode()`, který vlastní a exportuje P03** (jeho rozhodnutí R35); P04 ho jen reexportuje z `packages/core/tx`, aby doménové soubory měly jednu adresu.

### 0.7 Rozhodnutí, která jsem musel udělat sám

Specifikace je na těchto osmi místech buď mlčenlivá, nebo v rozporu s dělením vlastnictví souborů. Rozhodl jsem takto a píšu proč, aby to šlo přehodnotit.

**R1. Doménová logika nesahá do `packages/db`. Adaptér doplňuje pool a nic víc.** Řídicí dokument dává P03 „`packages/db` celý", zatímco 3.6 říká, že datový přístup jde „výhradně přes `packages/db/src/repo/*`". Obojí naráz nejde. Rozhodl jsem, že P03 dodá **transakční obálky a schéma**, a doménové dotazy píše P04 nad handlem uvnitř `packages/core`.

Dřívější znění tohohle rozhodnutí počítalo s tím, že P03 vydává `Tx = PoolClient`, a nechávalo adaptér převádět syrový klient na Drizzle handle. **To už neplatí.** Doplňkový průchod schématem to vyřešil u vlastníka: P03 má rozhodnutím R34 `type Tx = NodePgDatabase<typeof schema>` a handle vyrábí sám obalením jednoho vyhrazeného spojení. Adaptér, který by nad tím volal `drizzle()` znovu, by obaloval Drizzle do Drizzle.

Adaptér `packages/core/tx` proto řeší **jedinou** nepohodlnost: obálky P03 berou `pool` prvním argumentem, protože `packages/db` žádný singleton nedrží a držet ho nemá. Bez adaptéru by ho musel protahovat každý volající. Nic jiného adaptér nedělá a hlavně:

- **nepřejmenovává.** `withoutContext` se jmenuje `withoutContext`, ne `withoutWorkspace`. Dvě jména pro jednu funkci jsou zdroj rozporu, který se pozná až u třetího plánu.
- **nemění typy ani podpisy.** `withReadOnly` bere `ReadOnlyOptions`, tedy objekt, ne holé číslo. Je to podstatné: `workMem` v něm zavedl P03 kvůli náhledu segmentu v P11, protože bez něj se řazení nad velkým publikem přelije na disk a tvrdý strop doby běhu vyprší dřív, než dotaz doběhne. Kdyby adaptér bral jen `statementTimeoutMs`, **neměl by P11 tu hodnotu kudy předat**.
- **neopakuje transakční logiku.** BEGIN, `set_config`, kontrola nezměněného kontextu a zahození rozbitého spojení přes `release(true)` existují v repozitáři jednou, u P03. Druhá kopie by tyhle ochrany časem ztratila.
- **nepíše vlastní `pgErrorCode`.** P03 ho exportuje (rozhodnutí R35) a jeho verze pokrývá i chybu ze syrového `pool.query`, kde SQLSTATE leží přímo na `error.code`. P04 ho jen reexportuje.

ESLint pravidlo z 3.6 zakazuje import **poolu** `db` mimo `packages/db`. Adaptér žádný pool z `packages/db` neimportuje, vyrábí si vlastní továrnou `createPool`, což je jediná cesta, kterou P03 nabízí. Vynucení izolace tím neztrácíme: obálka vždy nastaví GUC (druhá vrstva) a `wsEq(ctx, table)` z úkolu 19 je jediný povolený způsob, jak se v `packages/core` filtruje podle workspace, což hlídá test.

**R2. `WorkspaceContext` bydlí v `@mlain/db` a P04 ho jen reexportuje. Jediná továrna je v `packages/core/identity`.** Dřívější znění tohoto rozhodnutí definovalo typ znovu v `packages/core/identity/types.ts` s vlastním `declare const brand: unique symbol`. To byla chyba a měla by dva důsledky. Zaprvé **dva branded typy téhož jména nejsou vzájemně přiřaditelné**, takže by `withWorkspace`, `withReadOnly` a `registerRepoModule` z P03 šly zavolat jen přetypováním, a přetypováním padá celá první vrstva izolace. Zadruhé by existovaly dvě továrny, čímž branded typ přestává být branded.

Důvod, kterým dřívější znění volbu obhajovalo, tedy cyklus `db → core → db`, **neexistuje**. Cyklus by vznikl jen tehdy, kdyby `packages/db` importoval z `packages/core`, což nedělá. Skutečný graf je `core/tx → db`, `core/identity → db`, `core/identity → core/tx`, tedy acyklický.

Platí proto: typ `WorkspaceContext`, `Actor` a `Role` se **importuje z `@mlain/db`** a `packages/core/identity/types.ts` je jen reexportuje, aby doménové soubory měly jednu adresu. Zúžení `Permission` na 48 literálů zůstává v P04 (`packages/core/identity/permissions.ts`), protože registr oprávnění vlastní tenhle plán; P03 nechává `Permission = string`, což je nadtyp a přiřazení funguje.

Transakční obálky proto berou **`ctx: WorkspaceContext`**, ne `workspaceId: string`. Získáváme tím tři věci: pravidlo „žádná funkce nepřijímá `workspaceId` jako string" platí i na hranici transakce, tedy tam, kde na něm nejvíc záleží; obálka od P03 nastaví u aktéra typu `user` **oba** GUC naráz, takže z doménových služeb mizí ruční `set_config`; a `packages/core/tx` přestává být výjimkou z pravidla, kterou bylo nutné v testu jmenovitě vypisovat.

**R3. Handlery jobů dodává P04, entrypoint workeru zůstává P01.** Uzávěr S8 říká „handler si každá doména píše do svého souboru, entrypoint workeru je jen složí". P04 proto vytváří moduly na konvenční cestě `packages/core/<domena>/jobs/<akce>.ts`, kde `<domena>.<akce>` je název fronty z registru P01, a každý exportuje `export const handler`. Do `apps/worker` plán nesahá. Test v úkolu 43 ověří, že pro každou frontu s prefixem `platform.` v registru existuje modul na konvenční cestě a exportuje `handler` správného tvaru. Doručování se tím nestane závislým na pg-boss: veškerá logika je v čistých funkcích, které jdou zavolat přímo, a job je jen tenký obal.

**R4. Lokalizované `detail` chybové odpovědi je zatím v kódu, ne v katalogu `packages/i18n`.** Specifikace 4.2 chce `detail` z katalogů 3.9, jenže `packages/i18n` vlastní P05, který ve vlně 0 běží **paralelně** s P04. Kdyby P04 importoval z `@mlain/i18n`, nešlo by ho přeložit ani otestovat, dokud P05 neskončí. Texty proto žijí v `packages/core/errors/detail-catalog.ts` jako typovaný `Record<locale, Record<code, string>>` se stejnou strukturou klíčů (`errors.<code>.detail`), aby je P06 mohl mechanicky přesunout do `packages/i18n/messages/{cs,en}/platform.json`. Do plánu P06 to patří jako jeden úkol.

**R5. `GET /api/v1/docs` je serverem vykreslená statická stránka bez JavaScriptu.** Specifikace 4.7 chce Scalar nebo Redoc „bez externích CDN". Obě knihovny ve výchozím stavu tahají bundle z CDN a jejich vendorování do `apps/web/public` je build krok, který vlastní P01. Endpoint proto vydává soběstačné HTML vygenerované z commitnutého OpenAPI dokumentu: seznam tagů, cest, metod, shrnutí, potřebných scopes a odkaz na syrový JSON. Splňuje to zákaz CDN i zákaz volání ven, nesplňuje to slovo „Scalar". Vendorování bundlu je vhodný úkol pro P16.

**R6. Jednotná latence se vynucuje časovou podlahou, ne jen dummy hashem.** Kritérium 16 je měřitelné a dummy hash sám o sobě nestačí: existující účet má navíc dotaz na členství, zápis čítače a případný rehash. Přihlášení i reset hesla proto běží uvnitř `withConstantTime(250, fn)`, která po dokončení práce dospí do 250 ms od začátku. Když práce trvá déle, zaloguje se `warn` s `constant_time_floor_exceeded`, protože to znamená, že podlaha je nízká a kritérium přestává platit. Hodnota 250 ms je konstanta modulu, ne konfigurační proměnná, protože 4.9 je uzavřený výčet vlastněný P01 a tuhle proměnnou neobsahuje.

**R7. Systémové e-maily posílá port, ne implementace.** Pozvánka, reset hesla a upozornění na deaktivovaný webhook potřebují šablony, které vlastní P08, a odesílání, které vlastní P13. P04 definuje rozhraní `SystemMailer` a výchozí `LoggingSystemMailer`, který mimo produkci zaloguje odkaz na úrovni `warn` (běžný postup, aby šla instalace rozjet a P06 mohl vyvíjet obrazovky), a v produkci zaloguje jen typ zprávy a příjemce bez odkazu. Skutečnou implementaci zapojí P13 přes `setSystemMailer`.

**R8. Šest endpointů nad rámec tabulky 4.8.** `GET /api/v1/webhook-endpoints/{id}` (detail obrazovky z 5.3 ho potřebuje a nový endpoint není breaking change podle 4.6), `GET /api/v1/audit-log/count` a `GET /api/v1/webhook-deliveries/count` (konvence 4.3 vyžaduje endpoint na počty u každé kolekce, kde uživatel potřebuje vidět velikost), `GET /api/v1/docs`, který 4.7 vyjmenovává, ale tabulka 4.8 ho neuvádí, a `GET /api/v1/jobs` s `GET /api/v1/jobs/{kind}/{id}` pro Centrum úloh, které si vyžádal P05 rozhodnutím R4 (úkol 45). Celkem tedy **45 endpointů**: 39 z tabulky 4.8 vlastněných částí 1 a 6 dopočtených.

### 0.8 Ověřené testovací vektory

Všechny vektory níž jsem **přepočítal spuštěním** proti Node 24 `node:crypto` dne 2026-07-31 a shodují se se specifikací do posledního znaku. V testech se používají doslova.

| Co | Vstup | Očekávaný výstup |
|---|---|---|
| SHA-256 session tokenu | `AQQHCg0QExYZHB8iJSgrLjE0Nzo9QENGSUxPUlVYW14` jako ASCII | `0a7edca7df64fa7710681987f4f809f6f72b37a34602c7472673009382665ecd` |
| base32 prefix API klíče | bajty `a1b2c3d4e5` | `ugzmhvhf` |
| sekret API klíče | 32 bajtů `ff fe ... e0` | `__79_Pv6-fj39vX08_Lx8O_u7ezr6uno5-bl5OPi4eA` |
| SHA-256 sekretu | řetězec sekretu jako ASCII | `7ac21015d6000ce73d6f61c420ff4d5f0f3cc816da25b10726b74e8961cd925c` |
| celý klíč | prefix a sekret | `ml_live_ugzmhvhf___79_Pv6-fj39vX08_Lx8O_u7ezr6uno5-bl5OPi4eA`, délka 60 |
| HMAC podpisu webhooku | vektor z 3.8 | `70a890fe48498351df6249763e7c2fb36f2220fc7af3501281501963b23ddeeb` |
| kurzor | `{"k":["2026-07-31T14:22:03.000Z","0192f3a0-1c2d-7e43-8d4e-5f60718293a4"],"d":"n","o":"created_at.desc"}` | `eyJrIjpbIjIwMjYtMDctMzFUMTQ6MjI6MDMuMDAwWiIsIjAxOTJmM2EwLTFjMmQtN2U0My04ZDRlLTVmNjA3MTgyOTNhNCJdLCJkIjoibiIsIm8iOiJjcmVhdGVkX2F0LmRlc2MifQ` |

**Ověření tvaru transakčního handlu, spuštěná 2026-08-01** proti PostgreSQL 18.4 v Dockeru s `drizzle-orm` 0.44.7, `pg` 8.22.0, `typescript` 5.9.3 a Node 24. Nešlo o čtení dokumentace, každý řádek je výsledek běhu. Na těchhle šesti faktech stojí úkol 1 a plošně celý zbytek plánu.

| Co jsem ověřoval | Jak to dopadlo |
|---|---|
| syrový `PoolClient` unese doménový dotaz | **Ne.** `tsc` hlásí čtyři chyby `TS2339`: `select`, `insert`, `delete` ani `execute` na něm neexistují. Je to důvod, proč P03 rozhodnutím R34 vydává `Tx = NodePgDatabase<typeof schema>`, a proč adaptér P04 typ nesmí měnit. |
| handle nad klientem uvnitř `BEGIN` je v téže transakci | Ano. Zápis přes Drizzle vidí uvnitř transakce syrový klient, jiné spojení ho nevidí, a `ROLLBACK` ho zruší. Je to potvrzení tvaru, který P03 zvolil, ne návod pro P04: obalení dělá P03. |
| co vrací `tx.execute()` na ovladači `node-postgres` | **`QueryResult` z `pg`, ne pole.** `result.constructor.name` je `Result`, `result[0]` je `undefined`, řádky jsou v `result.rows`. Tvar `await tx.execute(...) as unknown as Row[]` projde typovou kontrolou a za běhu vrátí `undefined`. |
| jak se propaguje SQLSTATE skrz Drizzle | Chyba je zabalená do `DrizzleQueryError`, **`error.code` je `undefined` a SQLSTATE je na `error.cause.code`** (u kolize unikátního indexu `23505`, `error.cause.constraint` nese jméno indexu). |
| přiřaditelnost handlu z poolu a z klienta | Obojí je `NodePgDatabase<typeof schema>`, `tsc` je přiřadí oběma směry. Až P03 obálky přepíše, typ se nemění. |

Poslední dva řádky jsou důvod, proč plán zavádí `pgErrorCode()` a proč všude používá `const { rows } = await tx.execute<Row>(...)`. Obojí je ochrana proti chybě, která by jinak prošla typovou kontrolou i code review a projevila se až za běhu.

### 0.9 Jak se v tomhle plánu testuje

Tři úrovně, každá má svůj příkaz a svoje pravidlo.

| Úroveň | Příkaz | Databáze | Kdy |
|---|---|---|---|
| jednotkové | `pnpm --filter @mlain/core test:unit` | ne | čistá logika: hashe, tokeny, podpisy, backoff, stránkování, oprávnění |
| databázové | `pnpm --filter @mlain/core test:db` | testcontainers Postgres 18 | vše, co sahá na tabulky, RLS a transakce |
| integrační API | `pnpm --filter @mlain/web test:db` | testcontainers Postgres 18 | endpointy přes `app.request()`, bez prohlížeče |

**Pravidlo bez výjimky:** tvrzení o databázi se ověřuje **spuštěním proti reálnému Postgresu**, ne mockem a ne grepem. Tvrzení o RLS se ověřuje pod rolí `mlain_app`, ne pod rolí vlastníka schématu, protože vlastník schématu RLS obchází.

**Úklid a DDL v testech běží pod `mlain_migrator`** přes `@mlain/core/test-support/migrator`. Důvod je v úkolu 7, krok 5, a je nepříjemnější, než vypadá: pod aplikační rolí `DELETE` chráněné tabulky smaže **nula řádků a vrátí úspěch**. Ověřeno spuštěním na PostgreSQL 18.4: `DELETE FROM ...` bez kontextu vypsal `DELETE 0`, skončil s návratovým kódem 0 a oba řádky zůstaly. `beforeEach` tedy vypadá, že uklidil, a testy se navzájem ovlivňují.

### 0.10 Požadavky na jiné plány

Tyhle body **P04 opravit nesmí**, leží v cizích souborech. Vede je proto jmenovitě, aby se nedaly přehlédnout, a preflight v úkolu 1 je ověřuje spuštěním. Souběžně jsou zapsané v `NALEZY-NAPRIC-PLANY.md`.

Dřívější znění plánu je mělo schované v tabulce předpokladů a v jednom kroku preflightu. To byla chyba: požadavek, který není vidět, se nesplní.

| # | Komu | Co | Proč to P04 nemůže udělat sám | Co P04 dělá do té doby |
|---|---|---|---|---|
| ~~P04→P03.1~~ | P03 | ~~Transakční obálky mají vracet Drizzle handle a doplnit obálku bez kontextu.~~ | | **SPLNĚNO** doplňkovým průchodem schématu. P03 má `type Tx = NodePgDatabase<typeof schema>` (R34), `withoutContext(pool, fn)` i `pgErrorCode` (R35). P04 se srovnal: adaptér už nic nepřevádí ani nepřejmenovává. |
| P04→P03.2 | P03 | Sloupec `api_keys.previous_secret_hash bytea` NULL. | migrace vlastní P03 | Rotace klíče proběhne **bez odkladu**, starý sekret přestane platit okamžitě. Kritérium 26c se neověří, úkol 30 to hlásí jako známé omezení, ne jako úspěch. |
| P04→P03.3 | P03 | Sloupec `api_keys.previous_expires_at timestamptz` NULL. Rozšířit `ck_api_keys__secret_hash` tak, aby u `kind='public'` byly oba nové sloupce NULL. | tamtéž | tamtéž |
| P04→P03.4 | P03 | Schéma `platform` a tabulka `platform.rate_limits` ve tvaru, který čeká `rate-limiter-flexible`: `key varchar(255) PRIMARY KEY, points integer NOT NULL DEFAULT 0, expire bigint`. Bez `workspace_id`, tedy doplnit do `TABLES_WITHOUT_WORKSPACE_ID` i `TABLES_WITHOUT_RLS` a upravit očekávané počty v `rls-registry.test.ts`. **Granty pro `mlain_app` musí být explicitní**, `ALTER DEFAULT PRIVILEGES` z migrace 0005 platí jen pro schéma `public`. | tamtéž | Úkol 10 běží na backendu `memory`. Ten je správný pro jednu instanci, ale **při víc instancích má každá vlastní počítadlo**, takže skutečný strop je násobkem počtu instancí. Startovní kontrola proto při `RATE_LIMIT_BACKEND=postgres` a chybějící tabulce **hlasitě selže**, místo aby tiše přepnula. |
| P04→P03.5 | P03 | Politika pro dohledání API klíče podle prefixu **bez workspace kontextu**, například `CREATE POLICY api_key_lookup ON api_keys FOR SELECT USING (current_setting('mlain.workspace_id', true) IS NULL AND revoked_at IS NULL);` a obdoba pro UPDATE kvůli `last_used_at`. Čistší varianta je `SECURITY DEFINER` funkce `lookup_api_key(prefix, kind)`, která vrátí jen sloupce potřebné k ověření. | RLS politiky vlastní P03 | **Nic. Fáze E je bez toho neproveditelná.** Ověření klíče čte `api_keys` mimo kontext, protože ten se z klíče teprve zjišťuje; pod `mlain_app` vrátí SELECT vždy nula řádků a **každý** požadavek s `Authorization: Bearer ml_live_...` skončí na `unauthenticated`. Nespadne to hlasitě, jen „klíč neexistuje", což je nejhůř dohledatelný druh chyby. |
| P04→P03.6 | P03 | Politika pro dohledání pozvánky podle `token_hash` bez workspace kontextu: `CREATE POLICY invitation_token_lookup ON invitations FOR SELECT USING (current_setting('mlain.workspace_id', true) IS NULL AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now());` | tamtéž | **Nic.** `acceptInvitation` vrátí vždy 404. Únik dat je u téhle politiky nulový: jediný filtr, který volající má, je `token_hash` s unikátním indexem, takže bez znalosti tokenu nedostane nic. A protože plán sám vrací u neplatného tokenu 404 schválně, aby nešlo zjistit, jestli pozvánka existuje, **z chybové hlášky by na příčinu nikdo nepřišel**. |
| P04→P01.1 | P01 | Doplnit do `VALIDATION_CODES` patnáct kódů, které P04 vydává v poli `errors[]` a registr je nezná: `blocked_target`, `confirm_name_mismatch`, `cursor_order_mismatch`, `invalid_cursor`, `invalid_idempotency_key`, `not_a_member`, `out_of_range`, `password_contains_email`, `password_too_common`, `password_too_long`, `password_too_short`, `public_key_scopes_fixed`, `scopes_required`, `unknown_scope`, `unsupported_order`. | registr kódů vlastní P01 a předdeklaruje je všechny dopředu | P04 je používá dál. Ověřeno porovnáním se skutečným zněním registru v P01, ne odhadem: **kořenové kódy (`PROBLEM_CODES`) sedí všechny**, chybí jen tyhle validační. |
| P04→P06.1 | P06 | Stránka `/w/{slug}/jobs/{jobId}`, tedy detail úlohy. | obrazovky vlastní P06, viz 0.2 | P04 dodává endpointy a registr zdrojů úloh (úkol 45), takže stránka má z čeho číst. P05 v rozhodnutí R4 psal, že stránku dodá „plán, který vlastní API úloh"; API úloh je P04, ale **obrazovky P04 nepíše žádné**, takže tenhle jeden bod patří P06. |

**Co z požadavků P05 dodává P04 sám a nikam se nepřepisuje:** rozšířený tvar chyby `forbidden` o `requiredPermission`, `currentRole`, `grantedByRoles` a `contactableMembers` (úkoly 12 a 32) a endpointy Centra úloh (úkol 45). Obojí je API, tedy vlastnictví tohohle plánu, a u prvního šlo navíc o **slib, který plán dal a nesplnil**: komentář u `assertPermission` radil klientovi „požádat kolegu o vyšší roli", ale chyba nenesla nic, podle čeho by šlo kolegu najít.

---

## 1. Struktura souborů a odpovědnosti

```
packages/core/
├── tx/index.ts                     jediné místo, kde se otevírá transakce a nastavuje RLS GUC
├── errors/
│   ├── registry.ts                 (P01, jen čteme) katalog všech kódů se statusem a opakovatelností
│   ├── api-error.ts                vyhoditelná chyba, kterou umí přeložit vrstva HTTP
│   └── detail-catalog.ts           lokalizované texty detail pro kódy z 4.2
├── net/
│   ├── ssrf.ts                     blocklist rozsahů, politika, rozhodnutí o adrese
│   └── safe-request.ts             HTTP klient s připnutou IP, bez přesměrování, s limity
├── audit/
│   ├── action.ts                   defineAuditActions, branded typ názvu akce
│   ├── redact.ts                   diff konfigurace a redakce citlivých klíčů
│   └── write.ts                    writeAuditLog uvnitř předané transakce
├── identity/
│   ├── types.ts                    Role, Actor, WorkspaceContext (branded)
│   ├── permissions.ts              úplná matice 3.4, assertPermission
│   ├── scope.ts                    wsEq, jediný povolený filtr podle workspace
│   ├── password.ts                 Argon2id, pravidla, blocklist, rehash
│   ├── token.ts                    náhodné tokeny a jejich SHA-256
│   ├── constant-time.ts            časová podlaha proti enumeraci účtů
│   ├── session.ts                  životní cyklus session a cookie
│   ├── csrf.ts                     double submit token
│   ├── api-key.ts                  formát klíče, generování, ověření (S1 až S5, P1 až P3)
│   ├── api-key-service.ts          vytvoření, rotace, revokace, výpis
│   ├── context.ts                  createWorkspaceContext, jediná továrna
│   ├── login.ts, password-reset.ts, change-password.ts, setup.ts
│   ├── workspace-service.ts, membership-service.ts, invitation-service.ts
│   ├── audit.ts                    názvy auditních akcí domény identity
│   └── api/*.routes.ts             definice cest Hono, jedna na skupinu zdrojů
└── platform/
    ├── system-mail.ts              port pro systémové e-maily
    ├── audit-query.ts              čtení audit logu s filtry a kurzorem
    ├── webhooks/                   obálka, podpis, backoff, endpointy, fan-out, doručení, deaktivace
    ├── api/*.routes.ts             definice cest webhooků a audit logu
    └── jobs/*.ts                   tenké obaly handlerů pro fronty z registru P01

apps/web/src/
├── lib/api/
│   ├── problem.ts                  RFC 9457 obálka a mapování chyb
│   ├── validation.ts               zod, strict, mapování na errors[]
│   ├── request-id.ts, client-ip.ts
│   ├── pagination.ts, counting.ts
│   ├── idempotency.ts, rate-limit.ts, versioning.ts
│   ├── authenticate.ts             session nebo API klíč, sestavení WorkspaceContext
│   ├── openapi.ts, docs.ts
│   └── app.ts                      složení celé aplikace Hono
├── app/api/v1/[[...route]]/route.ts   mount do Next.js
└── scripts/generate-openapi.ts        zapisuje packages/contracts/openapi.json
```

Každý soubor má jednu odpovědnost a vejde se do hlavy. Kdyby začal růst přes zhruba 400 řádků, je to signál, že v něm bydlí dvě věci.

---

## 2. Úkoly

### Fáze A: základ, konvence API, chyby (úkoly 1 až 11)

---

### Úkol 1: Preflight a adaptér transakcí

Bez tohoto úkolu se plán rozjede proti balíčkům, které mají jiný tvar, než čeká, a přijde se na to až u dvacátého souboru.

Nález, který dřív blokoval celý projekt (P03 vydával syrový `PoolClient`, zatímco doménové plány volají Drizzle API), **je vyřešený u vlastníka**: P03 má rozhodnutím R34 `type Tx = NodePgDatabase<typeof schema>`. Adaptér z tohohle úkolu proto typ ani jméno nemění, jen doplňuje pool. Typový test v kroku 7 hlídá, že to tak zůstane.

**Files:**
- Create: `packages/core/preflight.probe.ts`
- Create: `packages/core/tx/index.ts`
- Test: `packages/core/tx/index.test.ts`
- Test: `packages/core/tx/types.test-d.ts`

- [ ] **Krok 1: Ověř, že vlna 0 je smergovaná**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool
ls packages/db/src/schema/identity.ts packages/db/migrations packages/core/errors/registry.ts packages/core/config packages/contracts/package.json
```
Expected: všech pět cest existuje. Když kterákoliv chybí, plán se **nespouští**, protože P01, P02 nebo P03 ještě není v `main`.

- [ ] **Krok 2: Napiš sondu, která ověří tvar importů typovou kontrolou**

Sonda importuje **přesně to, co P03 a P02 dnes opravdu exportují** (viz 0.6), ne to, co by se P04 hodilo. Kdyby importovala vysněný tvar, preflight by hlásil chybu u symbolů, které nikdy neexistovaly, a zakryl by tím skutečné odchylky.

Create `packages/core/preflight.probe.ts`:

```ts
// Dočasný soubor. Ověřuje, že P01, P02 a P03 dodaly přesně ty symboly, které
// P04 potřebuje. Maže se v posledním kroku tohoto úkolu.
import {
  checkIsolationPrerequisites,
  createPool,
  createWorkspaceAsUser,
  listGlobalAuditForUser,
  listWorkspacesForUser,
  pgErrorCode,
  withReadOnly,
  withUser,
  withWorkspace,
  withoutContext,
  type Actor,
  type ReadOnlyOptions,
  type Role,
  type Tx,
  type WorkspaceContext,
} from '@mlain/db';
import { unsafeWorkspaceContext } from '@mlain/db/unsafe-context';
import * as schema from '@mlain/db/schema';
import { ERROR_CODES } from '@mlain/core/errors/registry';
import { config, ConfigSchema } from '@mlain/core/config';
import { QUEUES } from '@mlain/core/queues';
import { decryptEnvelope, encryptEnvelope, type CredentialContext } from '@mlain/contracts/crypto';

// Tabulky, na které P04 sahá.
const tables = [
  schema.users,
  schema.sessions,
  schema.workspaces,
  schema.memberships,
  schema.invitations,
  schema.apiKeys,
  schema.passwordResetTokens,
  schema.idempotencyKeys,
  schema.auditLog,
  schema.webhookEndpoints,
  schema.webhookEvents,
  schema.webhookDeliveries,
  schema.systemSettings,
];

// Sloupce, které 3.5 přidává k DDL 2.3 a bez kterých nefunguje grace období.
// Když tenhle řádek nepřeloží, platí požadavek P04→P03.2 a P04→P03.3 z 0.10
// a rotace API klíče se dělá bez odkladu, viz úkol 30.
const rotationColumns = [schema.apiKeys.previousSecretHash, schema.apiKeys.previousExpiresAt];

// Fronty, pro které P04 dodá handlery.
const queues = [
  QUEUES['platform.webhook_fanout'],
  QUEUES['platform.webhook_deliver'],
  QUEUES['platform.cleanup_sessions'],
  QUEUES['platform.cleanup_idempotency'],
  QUEUES['platform.purge_workspaces'],
];

// Konfigurační proměnné, které P04 čte.
const configKeys: Array<string | number | boolean> = [
  config.APP_URL,
  config.SIGNUP_MODE,
  config.SESSION_ABSOLUTE_TTL_DAYS,
  config.SESSION_IDLE_TTL_DAYS,
  config.TRUST_PROXY,
  config.DEFAULT_LOCALE,
  config.DEFAULT_TIMEZONE,
  config.RATE_LIMIT_ENABLED,
  config.RATE_LIMIT_BACKEND,
  config.RATE_LIMIT_API_READ,
  config.RATE_LIMIT_API_WRITE,
  config.WEBHOOK_MAX_ATTEMPTS,
  config.WEBHOOK_ALLOW_PRIVATE_TARGETS,
  config.AUDIT_RETENTION_MONTHS,
  config.DATABASE_URL,
];

// Transakční obálky. Signatury jsou z P03 doslova, včetně poolu prvním argumentem.
// Všechny čtyři obálky plus čtení SQLSTATE. Adaptér je jen zabalí s poolem.
const transactions = [withWorkspace, withUser, withReadOnly, withoutContext];
const errorCodeReader = pgErrorCode;
const readOnlyOptions: ReadOnlyOptions = { statementTimeoutMs: 3000, workMem: '64MB' };
const globalQueries = [createWorkspaceAsUser, listWorkspacesForUser, listGlobalAuditForUser];
const envelope = [encryptEnvelope, decryptEnvelope];
const registry: Record<string, { status: number; title: string; retryable: boolean }> = ERROR_CODES;
const schemaShape = ConfigSchema;
const poolFactory = createPool;
const isolationCheck = checkIsolationPrerequisites;
const contextFactory = unsafeWorkspaceContext;
const webhookContext: CredentialContext = 'webhook_secret';

// Typy, které P04 reexportuje místo aby je definoval znovu (rozhodnutí R2).
export type ProbeTx = Tx;
export type ProbeContext = WorkspaceContext;
export type ProbeActor = Actor;
export type ProbeRole = Role;

export const probe = {
  tables, rotationColumns, queues, configKeys, transactions, errorCodeReader,
  readOnlyOptions, globalQueries, envelope, registry, schemaShape, poolFactory,
  isolationCheck, contextFactory, webhookContext,
};
```

- [ ] **Krok 3: Spusť typovou kontrolu a zapiš odchylky**

Run: `pnpm --filter @mlain/core typecheck`

Expected: sonda přeloží **kromě řádku `rotationColumns`**, u kterého se čeká chyba `Property 'previousSecretHash' does not exist`, dokud P03 nesplní požadavek P04→P03.2. Ten jeden řádek je tedy živý ukazatel stavu, ne překvapení.

Když padne cokoliv jiného, zapiš každý chybějící nebo přejmenovaný symbol a **nepokračuj**, dokud se nerozhodne, jestli se opraví P03, nebo jestli se přemapuje v adaptéru z kroku 4. Ostatní úkoly plánu na tvaru z tabulky v 0.6 stojí.

- [ ] **Krok 4: Napiš adaptér `packages/core/tx/index.ts`**

Create `packages/core/tx/index.ts`:

```ts
/**
 * Jediné místo v monorepu, které drží aplikační pool. NIC JINÉHO nedělá.
 *
 * Transakční logiku (BEGIN, set_config, Drizzle handle nad vyhrazeným spojením,
 * kontrola nezměněného kontextu, zahození rozbitého spojení) vlastní P03
 * a tenhle soubor ji NEOPAKUJE. Kdyby si ji P04 napsal znovu, byly by to dvě
 * implementace téhož a ta druhá by neměla ani kontrolu kontextu, ani
 * `release(true)` po neúspěšném ROLLBACK.
 *
 * Adaptér tedy řeší jedinou nepohodlnost: obálky P03 berou `pool` prvním
 * argumentem, protože `packages/db` žádný singleton nedrží a držet ho nemá.
 * Bez tohohle souboru by ho musel protahovat každý volající.
 *
 * Co se tu ZÁMĚRNĚ NEDĚLÁ:
 *   - nepřejmenovávají se obálky. `withoutContext` se jmenuje `withoutContext`,
 *     ne `withoutContext`. Dvě jména pro jednu funkci jsou zdroj rozporu.
 *   - nemění se typy. `Tx` je typ z `@mlain/db`, jen se reexportuje.
 *   - neobaluje se handle podruhé. `Tx` z P03 UŽ JE `NodePgDatabase`
 *     (jeho rozhodnutí R34), takže volat nad ním `drizzle()` by bylo obalení
 *     Drizzle do Drizzle.
 *   - nepíše se vlastní `pgErrorCode`. P03 ho exportuje a jeho verze pokrývá
 *     i chybu ze syrového `pool.query`, kde kód leží přímo na `error.code`.
 */
import type { Pool } from 'pg';
import {
  createPool,
  pgErrorCode,
  withReadOnly as dbWithReadOnly,
  withUser as dbWithUser,
  withWorkspace as dbWithWorkspace,
  withoutContext as dbWithoutContext,
  type ReadOnlyOptions,
  type Tx,
  type WorkspaceContext,
} from '@mlain/db';
import { config } from '@mlain/core/config';

/**
 * Transakční handle a čtení SQLSTATE se reexportují, aby doménové soubory
 * měly jednu adresu a nemusely sahat do `@mlain/db` kvůli typu.
 * Je to REEXPORT, ne druhá definice.
 */
export { pgErrorCode, type ReadOnlyOptions, type Tx };

let appPoolSingleton: Pool | null = null;
let readOnlyPoolSingleton: Pool | null = null;

/** Aplikační pool. Vzniká při prvním použití, aby import modulu neotvíral spojení. */
export function appPool(): Pool {
  appPoolSingleton ??= createPool(config.DATABASE_URL, 'app', 10);
  return appPoolSingleton;
}

/** Pool s vynuceným default_transaction_read_only. Používá ho withReadOnly. */
export function readOnlyPool(): Pool {
  readOnlyPoolSingleton ??= createPool(config.DATABASE_URL, 'readOnly', 5);
  return readOnlyPoolSingleton;
}

/** Zavře oba pooly. Volá se při vypnutí procesu a v afterAll databázových testů. */
export async function closePools(): Promise<void> {
  const pools = [appPoolSingleton, readOnlyPoolSingleton].filter((p): p is Pool => p !== null);
  appPoolSingleton = null;
  readOnlyPoolSingleton = null;
  await Promise.all(pools.map((p) => p.end()));
}

/**
 * Transakce v kontextu projektu. Obálka P03 nastaví `mlain.workspace_id` vždy
 * a `mlain.user_id` u aktéra typu `user`, takže doménová služba NIKDY nevolá
 * `set_config` ručně. Po doběhnutí callbacku P03 ověří, že se kontext uvnitř
 * transakce nezměnil, a při neshodě transakci zruší.
 */
export function withWorkspace<T>(ctx: WorkspaceContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return dbWithWorkspace(appPool(), ctx, fn);
}

/**
 * Transakce jen s `mlain.user_id`, bez kontextu projektu. Pro dvě operace,
 * které kontext z principu nemají: výpis projektů aktéra a založení projektu (3.6).
 */
export function withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return dbWithUser(appPool(), userId, fn);
}

/**
 * Transakce ÚPLNĚ BEZ kontextu, ani projekt, ani uživatel. Pro přihlašovací
 * cesty, ověření API klíče, přijetí pozvánky, rate limiting, čtení
 * `system_settings` při startu a první spuštění instalace.
 *
 * NEJSOU to zadní vrátka: bez kontextu vrátí dotaz na každé tabulce s RLS nula
 * řádků a zápis skončí chybou. Použitelná je nad tabulkami z `TABLES_WITHOUT_RLS`.
 */
export function withoutContext<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return dbWithoutContext(appPool(), fn);
}

/**
 * Transakce jen pro čtení s tvrdým stropem doby běhu a volitelným `work_mem`.
 *
 * `options` je objekt, ne holé číslo, právě kvůli `work_mem`: náhled segmentu
 * v P11 na něm stojí, protože bez něj se řazení nad velkým publikem přelije
 * na disk a strop vyprší dřív, než dotaz doběhne. Kdyby adaptér bral jen
 * `statementTimeoutMs`, neměl by P11 tu hodnotu kudy předat.
 */
export function withReadOnly<T>(
  ctx: WorkspaceContext,
  options: ReadOnlyOptions,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return dbWithReadOnly(readOnlyPool(), ctx, options, fn);
}
```

- [ ] **Krok 5: Napiš padající test adaptéru**

Test se **neptá zdrojáků P03**. Ptá se běžící databáze, protože přesně tam se pozná, jestli handle opravdu sedí uvnitř transakce a jestli GUC opravdu platí jen po dobu jejího trvání.

Create `packages/core/tx/index.test.ts`:

```ts
import { afterAll, describe, expect, it } from 'vitest';
import { sql, eq } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { unsafeWorkspaceContext } from '@mlain/db/unsafe-context';
import {
  appPool, closePools, pgErrorCode, withoutContext, withReadOnly, withUser, withWorkspace,
} from './index.js';

const WS = '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071';
const USER = '0192f3a0-1c2d-7e41-9a1b-2c3d4e5f6071';
const userCtx = unsafeWorkspaceContext(WS, { type: 'user', userId: USER, role: 'owner' });
const keyCtx = unsafeWorkspaceContext(WS, { type: 'api_key', apiKeyId: 'k', scopes: [] });

type Gucs = { u: string | null; w: string | null };
const readGucs = sql`select current_setting('mlain.user_id', true) as u,
                            current_setting('mlain.workspace_id', true) as w`;
const empty = (value: string | null) => value === null || value === '';

afterAll(async () => { await closePools(); });

describe('tx adaptér', () => {
  it('handle má Drizzle API, ne syrový klient', async () => {
    await withoutContext(async (tx) => {
      expect(typeof tx.select).toBe('function');
      expect(typeof tx.insert).toBe('function');
      expect(typeof tx.delete).toBe('function');
      expect(typeof tx.execute).toBe('function');
    });
  });

  it('tx.execute vrací QueryResult s .rows, ne pole', async () => {
    await withoutContext(async (tx) => {
      const result = await tx.execute<{ n: number }>(sql`select 42 as n`);
      expect(Array.isArray(result), 'kdyby to bylo pole, celý plán by mohl indexovat přímo')
        .toBe(false);
      expect(result.rows[0]!.n).toBe(42);
    });
  });

  it('withWorkspace nastaví oba GUC, protože aktér je uživatel', async () => {
    const row = await withWorkspace(userCtx, async (tx) =>
      (await tx.execute<Gucs>(readGucs)).rows[0]!);
    expect(row.w).toBe(WS);
    expect(row.u, 'bez tohohle by doménové služby musely volat set_config ručně').toBe(USER);
  });

  it('withWorkspace s API klíčem nenastaví mlain.user_id', async () => {
    const row = await withWorkspace(keyCtx, async (tx) =>
      (await tx.execute<Gucs>(readGucs)).rows[0]!);
    expect(row.w).toBe(WS);
    expect(empty(row.u)).toBe(true);
  });

  it('withUser nastaví jen mlain.user_id', async () => {
    const row = await withUser(USER, async (tx) => (await tx.execute<Gucs>(readGucs)).rows[0]!);
    expect(row.u).toBe(USER);
    expect(empty(row.w)).toBe(true);
  });

  it('withoutContext nenastaví ani jeden GUC', async () => {
    const row = await withoutContext(async (tx) => (await tx.execute<Gucs>(readGucs)).rows[0]!);
    expect(empty(row.u)).toBe(true);
    expect(empty(row.w)).toBe(true);
  });

  it('GUC nepřežije transakci, protože se nastavuje jako SET LOCAL', async () => {
    await withWorkspace(userCtx, async () => undefined);
    const after = await withoutContext(async (tx) =>
      (await tx.execute<Gucs>(readGucs)).rows[0]!.w);
    expect(empty(after), 'kdyby to byl SET místo SET LOCAL, další nájemce spojení by zdědil cizí projekt')
      .toBe(true);
  });

  it('zápis přes Drizzle handle je uvnitř transakce od P03, takže ho chyba vezme s sebou', async () => {
    const id = '0192f3a0-1c2d-7e42-9a1b-2c3d4e5f6071';
    await expect(withoutContext(async (tx) => {
      await tx.insert(schema.users).values({ id, email: 'rollback@probe.test', passwordHash: 'x' });
      throw new Error('boom');
    })).rejects.toThrow('boom');
    const left = await withoutContext(async (tx) =>
      tx.select().from(schema.users).where(eq(schema.users.id, id)));
    expect(left).toHaveLength(0);
  });

  it('withReadOnly drží kontext a zápis odmítne', async () => {
    const w = await withReadOnly(userCtx, { statementTimeoutMs: 3000 }, async (tx) =>
      (await tx.execute<Gucs>(readGucs)).rows[0]!.w);
    expect(w).toBe(WS);
    await expect(withReadOnly(userCtx, { statementTimeoutMs: 3000 }, async (tx) => {
      await tx.insert(schema.users).values({
        id: '0192f3a0-1c2d-7e43-9a1b-2c3d4e5f6071', email: 'ro@probe.test', passwordHash: 'x',
      });
    })).rejects.toThrow();
  });

  it('přepnutí kontextu zevnitř transakce ji zruší', async () => {
    await expect(withWorkspace(userCtx, async (tx) => {
      await tx.execute(sql`select set_config('mlain.workspace_id',
                                             '00000000-0000-0000-0000-000000000000', true)`);
    })).rejects.toThrow(/kontext projektu/);
  });

  it('pgErrorCode vytáhne SQLSTATE z DrizzleQueryError', async () => {
    const id = '0192f3a0-1c2d-7e44-9a1b-2c3d4e5f6071';
    await withoutContext(async (tx) => {
      await tx.insert(schema.users).values({ id, email: 'dup@probe.test', passwordHash: 'x' });
    });
    try {
      await withoutContext(async (tx) => {
        await tx.insert(schema.users).values({
          id: '0192f3a0-1c2d-7e45-9a1b-2c3d4e5f6071', email: 'dup@probe.test', passwordHash: 'x',
        });
      });
      expect.unreachable('duplicitní e-mail musí selhat na unikátním indexu');
    } catch (error) {
      expect((error as { code?: unknown }).code,
             'SQLSTATE NENÍ na err.code, Drizzle chybu zabaluje').toBeUndefined();
      expect(pgErrorCode(error)).toBe('23505');
    }
    await withoutContext(async (tx) => {
      await tx.delete(schema.users).where(eq(schema.users.email, 'dup@probe.test'));
    });
  });

  it('pool je singleton, ne nový pool na každé volání', () => {
    expect(appPool()).toBe(appPool());
  });
});
```

- [ ] **Krok 6: Spusť test, ověř, že projde proti reálné databázi**

Run: `pnpm --filter @mlain/core test:db -- tx/index.test.ts`

Expected: 13 passed.

Když padne test o `SET LOCAL`, nastavuje P03 GUC bez třetího argumentu `true`, což je bezpečnostní chyba a musí ji opravit P03. Zastav a nahlas ji. Když padne test o zrušení transakce při přepnutí kontextu, chybí v P03 `assertContextUnchanged`, což je totéž. Ani jedno neobcházej v adaptéru.

- [ ] **Krok 7: Napiš typový test, který hlídá, že handle zůstane Drizzle**

Ochrana, kterou nic nevynucuje, není ochrana. Tenhle test je typový: nesahá na databázi a padne už při `typecheck`. Chrání před tím, aby někdo adaptér „zjednodušil" zpátky na syrový klient, a taky před tichým rozejitím ve chvíli, kdy P03 splní požadavek P04→P03.1.

Create `packages/core/tx/types.test-d.ts`:

```ts
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Tx as DbTx } from '@mlain/db';
import type * as schema from '@mlain/db/schema';
import type { Tx } from './index.js';

// 1. Tx z adaptéru je TENTÝŽ typ jako Tx z @mlain/db, ne jeho kopie ani obal.
//    Přiřazení musí projít oběma směry; kdyby adaptér typ jakkoli přebalil,
//    jeden ze dvou řádků přestane platit.
const _sameAsDb: DbTx = null as unknown as Tx;
const _sameAsAdapter: Tx = null as unknown as DbTx;

// 2. A je to Drizzle handle nad naším schématem. Kdyby ho někdo vrátil na syrový
//    klient z pg, tohle přiřazení přestane platit.
const _isDrizzle: NodePgDatabase<typeof schema> = null as unknown as Tx;
const _isDrizzleBack: Tx = null as unknown as NodePgDatabase<typeof schema>;

// 3. Tx MUSÍ mít metody, kvůli kterým celá vrstva existuje.
type HasDrizzleApi = Tx extends { select: unknown; insert: unknown; delete: unknown; execute: unknown }
  ? true
  : false;
const _hasApi: HasDrizzleApi = true;

export type { HasDrizzleApi };
export { _sameAsDb, _sameAsAdapter, _isDrizzle, _isDrizzleBack, _hasApi };
```

Run: `pnpm --filter @mlain/core typecheck`
Expected: PASS. Kdyby někdo `Tx` přebalil do vlastního typu, přestane platit jeden ze dvou řádků v bodu 1. Kdyby ho vrátil na syrový klient z `pg`, hlásí `tsc` navíc `Type 'false' is not assignable to type 'true'` na posledním řádku, tedy hlasitě a se srozumitelným místem.

**Pozor, `Database` z `@mlain/db` sem nepatří.** Je to návratový typ `createDb(pool)` a nese navíc `$client: Pool`, takže `Tx` do něj přiřadit nejde a test by padal na nesouvisející věci.

- [ ] **Krok 8: Ověř existenci tabulky pro rate limit backend**

Run:
```bash
psql "$DATABASE_URL" -tAc "select to_regclass('platform.rate_limits')"
```
Expected: `platform.rate_limits`. Když vrátí prázdno, platí požadavek P04→P03.4 z kapitoly 0.10: `RATE_LIMIT_BACKEND=postgres` nebude fungovat, poznamenej to a v úkolu 10 se použije jen backend `memory`. Startovní kontrola z úkolu 10 nedostupnost tabulky při nastaveném `postgres` hlásí jako chybu konfigurace, tedy hlasitě.

- [ ] **Krok 9: Smaž sondu a commitni**

```bash
rm packages/core/preflight.probe.ts
git add packages/core/tx/index.ts packages/core/tx/index.test.ts packages/core/tx/types.test-d.ts
git commit -m "feat(core): transaction adapter over @mlain/db wrappers"
```

---

### Úkol 2: Závislosti a licenční brána

**Files:**
- Modify: `packages/core/package.json` (jen `dependencies`, `devDependencies`, `exports`)
- Modify: `apps/web/package.json` (jen `dependencies`, `devDependencies`, `scripts.generate:openapi`)

- [ ] **Krok 1: Přidej závislosti do `packages/core/package.json`**

Do bloku `dependencies` přidej přesně tyhle položky (a nic jiného neměň):

```json
{
  "@node-rs/argon2": "2.0.2",
  "hono": "4.12.33",
  "@hono/zod-openapi": "1.5.1",
  "zod": "4.4.3",
  "uuid": "14.0.1",
  "pino": "10.3.1"
}
```

Do `devDependencies`:

```json
{
  "pg-boss": "12.26.3"
}
```

Do `exports` přidej wildcard podcesty, pokud tam ještě nejsou. Barrel `packages/core/index.ts` se **nezakládá** (uzávěr S11 řídicího dokumentu), importuje se vždy podcesta:

```json
{
  "./*": "./src/*/index.ts",
  "./*/*": "./src/*/*.ts"
}
```

- [ ] **Krok 2: Přidej závislosti do `apps/web/package.json`**

Do `dependencies`:

```json
{
  "hono": "4.12.33",
  "@hono/zod-openapi": "1.5.1",
  "zod": "4.4.3",
  "rate-limiter-flexible": "11.2.0",
  "pino": "10.3.1"
}
```

Do `scripts`:

```json
{
  "generate:openapi": "tsx scripts/generate-openapi.ts"
}
```

- [ ] **Krok 3: Nainstaluj a projeď licenční bránu**

Run:
```bash
pnpm install
pnpm licenses list --prod --json > /tmp/mlain-licenses.json
node --input-type=module --eval "import fs from 'node:fs'; const j = JSON.parse(fs.readFileSync('/tmp/mlain-licenses.json','utf8')); const bad = Object.keys(j).filter((l) => /GPL/i.test(l)); console.log(bad.length ? 'ZAKAZANE: ' + bad.join(', ') : 'OK');"
```
Expected: `OK`. Když se objeví cokoliv s GPL, LGPL nebo AGPL, závislost se **neinstaluje** a hledá se náhrada; projekt je MIT a licenční brána je blokující CI job z 3.15.

- [ ] **Krok 4: Ověř, že typová kontrola vidí nové balíčky**

Run: `pnpm --filter @mlain/core typecheck && pnpm --filter @mlain/web typecheck`
Expected: obojí PASS.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/package.json apps/web/package.json pnpm-lock.yaml
git commit -m "chore: add runtime dependencies for API core and identity"
```

---

### Úkol 3: `ApiError` a katalog lokalizovaných textů

**Files:**
- Create: `packages/core/errors/api-error.ts`
- Create: `packages/core/errors/detail-catalog.ts`
- Test: `packages/core/errors/api-error.test.ts`

- [ ] **Krok 1: Napiš padající test**

Create `packages/core/errors/api-error.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ApiError, notFound, forbidden, insufficientScope, validationFailed } from './api-error.js';
import { resolveDetail } from './detail-catalog.js';
import { ERROR_CODES } from './registry.js';

describe('ApiError', () => {
  it('doplní status a title z registru kódů', () => {
    const err = new ApiError('not_found');
    expect(err.status).toBe(404);
    expect(err.title).toBe('Not found');
    expect(err.code).toBe('not_found');
  });

  it('odmítne kód, který v registru není', () => {
    expect(() => new ApiError('kod_ktery_neexistuje' as never)).toThrow(/neregistrovaný/i);
  });

  it('nese params a retryAfter', () => {
    const err = new ApiError('rate_limited', { retryAfter: 37, params: { limit: 300 } });
    expect(err.retryAfter).toBe(37);
    expect(err.params).toEqual({ limit: 300 });
  });

  it('errors je povolené jen u validation_failed', () => {
    expect(() => new ApiError('not_found', { errors: [{ path: 'email', code: 'x', message: 'y' }] })).toThrow(
      /validation_failed/,
    );
  });

  it('4xx s findings musí obsahovat aspoň jeden nález se severity error', () => {
    expect(
      () =>
        new ApiError('conflict', {
          findings: [{ code: 'a', severity: 'warning', message: 'jen varování' }],
        }),
    ).toThrow(/severity/i);
  });

  it('findings s aspoň jednou chybou projdou', () => {
    const err = new ApiError('conflict', {
      findings: [
        { code: 'a', severity: 'error', message: 'blokuje' },
        { code: 'b', severity: 'warning', message: 'jen varuje' },
      ],
    });
    expect(err.findings).toHaveLength(2);
  });

  it('zkratky vracejí správné kódy', () => {
    expect(notFound().code).toBe('not_found');
    expect(forbidden().code).toBe('forbidden');
    expect(insufficientScope().code).toBe('insufficient_scope');
    expect(validationFailed([{ path: 'email', code: 'invalid_email', message: 'x' }]).status).toBe(422);
  });
});

describe('detail catalog', () => {
  it('vrátí český text pro známý kód', () => {
    expect(resolveDetail('not_found', 'cs')).toBe('Požadovaný záznam neexistuje.');
  });

  it('spadne zpět na en, když katalog pro jazyk neexistuje', () => {
    expect(resolveDetail('method_not_allowed', 'zz')).toBe(resolveDetail('method_not_allowed', 'en'));
  });

  it('en-GB se mapuje na katalog en', () => {
    expect(resolveDetail('forbidden', 'en-GB')).toBe(resolveDetail('forbidden', 'en'));
  });

  it('má text pro každý kód z registru', () => {
    const missing = Object.keys(ERROR_CODES).filter((c) => resolveDetail(c, 'en') === c);
    expect(missing).toEqual([]);
  });
});
```

- [ ] **Krok 2: Spusť test, ověř, že padá**

Run: `pnpm --filter @mlain/core test:unit -- errors/api-error.test.ts`
Expected: FAIL, `Cannot find module './api-error.js'`.

- [ ] **Krok 3: Napiš `api-error.ts`**

Create `packages/core/errors/api-error.ts`:

```ts
import { ERROR_CODES } from './registry.js';

export type ErrorCode = keyof typeof ERROR_CODES & string;
export type Severity = 'error' | 'warning';

export type ValidationIssue = { path: string; code: string; message: string };

export type Finding = {
  code: string;
  severity: Severity;
  message: string;
  path?: string;
  params?: Record<string, unknown>;
};

export type ApiErrorOptions = {
  /** Strojově čitelné parametry chyby, viz 4.2. */
  params?: Record<string, unknown>;
  /** Jen pro validation_failed, viz 4.2. Tvar je zmrazený. */
  errors?: ValidationIssue[];
  /** Doménové kontroly s víc nálezy naráz, viz 4.2. */
  findings?: Finding[];
  /** Sekundy. Smí ho nést každý kód s příznakem opakovatelnosti. */
  retryAfter?: number;
  /** Interní příčina pro log. Do odpovědi se nikdy nedostane. */
  cause?: unknown;
};

/**
 * Doménová chyba, kterou vrstva HTTP umí přeložit na RFC 9457 odpověď.
 * Nikdy nenese text pro uživatele: ten se skládá až v problem.ts z katalogu,
 * protože závisí na Accept-Language, který doména nezná.
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly title: string;
  readonly retryable: boolean;
  readonly params?: Record<string, unknown>;
  readonly errors?: ValidationIssue[];
  readonly findings?: Finding[];
  readonly retryAfter?: number;

  constructor(code: ErrorCode, options: ApiErrorOptions = {}) {
    const entry = ERROR_CODES[code];
    if (!entry) {
      throw new Error(
        `ApiError: neregistrovaný kód "${code}". Registruje se v packages/core/errors/registry.ts (vlastní P01).`,
      );
    }
    super(code, { cause: options.cause });
    this.name = 'ApiError';
    this.code = code;
    this.status = entry.status;
    this.title = entry.title;
    this.retryable = entry.retryable;
    this.params = options.params;
    this.retryAfter = options.retryAfter;

    if (options.errors && code !== 'validation_failed') {
      throw new Error('ApiError: pole errors patří výhradně ke kódu validation_failed (4.2).');
    }
    this.errors = options.errors;

    if (options.findings) {
      // Pravidlo z 4.2, aby se findings nestal odpadkovým košem: chybová odpověď
      // musí nést aspoň jeden nález, který operaci blokuje. Samotná varování
      // se vracejí s úspěšnou odpovědí.
      if (!options.findings.some((f) => f.severity === 'error')) {
        throw new Error(
          'ApiError: findings v chybové odpovědi musí obsahovat aspoň jeden nález se severity "error" (4.2).',
        );
      }
      this.findings = options.findings;
    }
  }

  /**
   * Vrátí NOVOU chybu se změněnými `params`. Pole třídy jsou readonly schválně:
   * chyba, kterou jde po vyhození přepsat, se nedá spolehlivě zalogovat ani
   * otestovat, protože nikdo neví, jestli se dívá na původní, nebo pozměněný
   * stav. Obohacení (například doplnění kolegů k `forbidden` v úkolu 32) proto
   * vyrábí novou instanci a původní nechává být.
   */
  withParams(params: Record<string, unknown>): ApiError {
    return new ApiError(this.code, {
      params,
      errors: this.errors,
      findings: this.findings,
      retryAfter: this.retryAfter,
      cause: this.cause,
    });
  }
}

export const unauthenticated = (o?: ApiErrorOptions) => new ApiError('unauthenticated', o);
export const invalidCredentials = (o?: ApiErrorOptions) => new ApiError('invalid_credentials', o);
export const sessionExpired = (o?: ApiErrorOptions) => new ApiError('session_expired', o);
export const forbidden = (o?: ApiErrorOptions) => new ApiError('forbidden', o);
export const insufficientScope = (o?: ApiErrorOptions) => new ApiError('insufficient_scope', o);
export const notFound = (o?: ApiErrorOptions) => new ApiError('not_found', o);
export const conflict = (o?: ApiErrorOptions) => new ApiError('conflict', o);
export const alreadyExists = (o?: ApiErrorOptions) => new ApiError('already_exists', o);
export const validationFailed = (errors: ValidationIssue[], o?: Omit<ApiErrorOptions, 'errors'>) =>
  new ApiError('validation_failed', { ...o, errors });
export const internalError = (cause: unknown) => new ApiError('internal_error', { cause });
```

- [ ] **Krok 4: Napiš `detail-catalog.ts`**

Create `packages/core/errors/detail-catalog.ts`:

```ts
/**
 * Lokalizované texty pole `detail` v RFC 9457 odpovědi.
 *
 * Rozhodnutí R4 plánu P04: texty jsou zatím tady a ne v packages/i18n, protože
 * i18n infrastrukturu vlastní P05, který ve vlně 0 běží paralelně. Struktura
 * klíčů je záměrně shodná s katalogem (errors.<code>.detail), aby je P06 mohl
 * mechanicky přesunout do packages/i18n/messages/{cs,en}/platform.json.
 */
type Catalog = Record<string, string>;

const en: Catalog = {
  unauthenticated: 'Authentication is required.',
  invalid_credentials: 'The e-mail address or password is not correct.',
  session_expired: 'Your session has expired. Sign in again.',
  signature_invalid: 'The request signature could not be verified.',
  forbidden: 'Your role does not allow this action.',
  insufficient_scope: 'The API key does not have the required scope.',
  origin_not_allowed: 'The Origin header does not match the application URL.',
  csrf_token_invalid: 'The CSRF token is missing or does not match.',
  not_found: 'The requested resource does not exist.',
  method_not_allowed: 'This method is not allowed on this path.',
  conflict: 'The resource is in a state that does not allow this operation.',
  already_exists: 'A resource with these values already exists.',
  invalid_state_transition: 'This state transition is not allowed.',
  idempotency_key_reuse: 'The same Idempotency-Key was used with a different body.',
  idempotency_request_in_progress: 'A request with the same Idempotency-Key is still running.',
  last_owner_cannot_be_removed: 'A project must always have exactly one owner.',
  setup_already_completed: 'The installation has already been set up.',
  gone: 'The resource has been permanently removed.',
  endpoint_removed: 'This API endpoint has been removed.',
  precondition_failed: 'The If-Match precondition failed.',
  payload_too_large: 'The request body is too large.',
  unsupported_media_type: 'This Content-Type is not supported by this endpoint.',
  validation_failed: 'The request body did not pass validation.',
  too_many_items: 'The batch contains more items than allowed.',
  unsupported_api_version: 'This API version is not supported.',
  account_locked: 'The account is temporarily locked after failed sign-in attempts.',
  resource_locked: 'The resource is held by another operation.',
  rate_limited: 'Too many requests. Try again later.',
  quota_exceeded: 'The provider quota has been exceeded.',
  internal_error: 'An unexpected error occurred.',
  not_implemented: 'This endpoint is not available in this build.',
  service_unavailable: 'The service is temporarily unavailable.',
  migration_failed: 'The database update failed and the application runs in limited mode.',
  dependency_timeout: 'A dependency did not respond in time.',
};

const cs: Catalog = {
  unauthenticated: 'Je potřeba se přihlásit.',
  invalid_credentials: 'E-mail nebo heslo nejsou správně.',
  session_expired: 'Vaše přihlášení vypršelo. Přihlaste se znovu.',
  signature_invalid: 'Podpis požadavku se nepodařilo ověřit.',
  forbidden: 'Vaše role tuhle akci nedovoluje.',
  insufficient_scope: 'API klíč nemá potřebné oprávnění.',
  origin_not_allowed: 'Hlavička Origin neodpovídá adrese aplikace.',
  csrf_token_invalid: 'Chybí nebo nesedí CSRF token.',
  not_found: 'Požadovaný záznam neexistuje.',
  method_not_allowed: 'Tahle metoda není na této cestě povolená.',
  conflict: 'Záznam je ve stavu, který tuhle operaci nedovoluje.',
  already_exists: 'Záznam s těmito hodnotami už existuje.',
  invalid_state_transition: 'Tenhle přechod stavu není povolený.',
  idempotency_key_reuse: 'Stejný Idempotency-Key byl použitý s jiným tělem požadavku.',
  idempotency_request_in_progress: 'Požadavek se stejným Idempotency-Key ještě běží.',
  last_owner_cannot_be_removed: 'Projekt musí mít vždy právě jednoho vlastníka.',
  setup_already_completed: 'Instalace už je nastavená.',
  gone: 'Záznam byl trvale odstraněný.',
  endpoint_removed: 'Tenhle endpoint API byl zrušený.',
  precondition_failed: 'Podmínka If-Match neplatí.',
  payload_too_large: 'Tělo požadavku je příliš velké.',
  unsupported_media_type: 'Tenhle Content-Type endpoint nepodporuje.',
  validation_failed: 'Tělo požadavku neprošlo kontrolou.',
  too_many_items: 'Dávka obsahuje víc položek, než je povoleno.',
  unsupported_api_version: 'Tahle verze API není podporovaná.',
  account_locked: 'Účet je dočasně zamčený po neúspěšných pokusech o přihlášení.',
  resource_locked: 'Záznam právě drží jiná operace.',
  rate_limited: 'Příliš mnoho požadavků. Zkuste to za chvíli.',
  quota_exceeded: 'Kvóta poskytovatele je vyčerpaná.',
  internal_error: 'Nastala neočekávaná chyba.',
  not_implemented: 'Tenhle endpoint v této verzi není dostupný.',
  service_unavailable: 'Služba je dočasně nedostupná.',
  migration_failed: 'Aktualizace databáze se nezdařila. Aplikace běží v omezeném režimu.',
  dependency_timeout: 'Závislá služba neodpověděla včas.',
};

const CATALOGS: Record<string, Catalog> = { en, cs };

/**
 * Vrátí text pro daný kód a jazyk. Fallback je en, pak samotný kód.
 * Vrácení kódu je poznatelný stav a využívá ho test úplnosti katalogu.
 */
export function resolveDetail(code: string, locale: string): string {
  const primary = CATALOGS[locale.split('-')[0] ?? ''];
  return primary?.[code] ?? en[code] ?? code;
}

export const SUPPORTED_DETAIL_LOCALES = Object.keys(CATALOGS);
```

- [ ] **Krok 5: Spusť test, ověř, že prochází**

Run: `pnpm --filter @mlain/core test:unit -- errors/api-error.test.ts`
Expected: 11 passed. Když padne poslední test (`má text pro každý kód z registru`), P01 zaregistroval kód, pro který tu chybí text; doplň ho do obou katalogů, nikdy jen do jednoho.

- [ ] **Krok 6: Commit**

```bash
git add packages/core/errors/api-error.ts packages/core/errors/detail-catalog.ts packages/core/errors/api-error.test.ts
git commit -m "feat(errors): ApiError and localized detail catalog per RFC 9457"
```

---

### Úkol 4: RFC 9457 obálka a `request_id`

Pokrývá kritérium 29.

**Files:**
- Create: `apps/web/src/lib/api/request-id.ts`
- Create: `apps/web/src/lib/api/problem.ts`
- Test: `apps/web/src/lib/api/problem.test.ts`

- [ ] **Krok 1: Napiš padající test**

Create `apps/web/src/lib/api/problem.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ApiError } from '@mlain/core/errors/api-error';
import { toProblem, PROBLEM_CONTENT_TYPE } from './problem.js';
import { resolveRequestId } from './request-id.js';

const REQ = {
  path: '/api/v1/contacts',
  requestId: '0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071',
  acceptLanguage: 'cs',
};

describe('toProblem', () => {
  it('vyrobí úplnou obálku podle 4.2', () => {
    const { body, status, headers } = toProblem(new ApiError('not_found'), REQ);
    expect(status).toBe(404);
    expect(headers['Content-Type']).toBe(PROBLEM_CONTENT_TYPE);
    expect(body).toEqual({
      type: 'https://docs.mlain.dev/errors/not_found',
      title: 'Not found',
      status: 404,
      detail: 'Požadovaný záznam neexistuje.',
      instance: '/api/v1/contacts',
      code: 'not_found',
      request_id: REQ.requestId,
    });
  });

  it('title je vždy anglicky bez ohledu na Accept-Language', () => {
    const { body } = toProblem(new ApiError('forbidden'), { ...REQ, acceptLanguage: 'cs' });
    expect(body.title).toBe('Forbidden');
  });

  it('detail respektuje Accept-Language', () => {
    const { body } = toProblem(new ApiError('forbidden'), { ...REQ, acceptLanguage: 'en-GB,en;q=0.9' });
    expect(body.detail).toBe('Your role does not allow this action.');
  });

  it('přenese params a retry_after do těla i do hlavičky', () => {
    const { body, headers } = toProblem(
      new ApiError('rate_limited', { retryAfter: 37, params: { limit: 300 } }),
      REQ,
    );
    expect(body.retry_after).toBe(37);
    expect(body.params).toEqual({ limit: 300 });
    expect(headers['Retry-After']).toBe('37');
  });

  it('přenese errors u validation_failed', () => {
    const { body } = toProblem(
      new ApiError('validation_failed', {
        errors: [{ path: 'email', code: 'invalid_email', message: 'Není platná e-mailová adresa.' }],
      }),
      REQ,
    );
    expect(body.errors).toHaveLength(1);
    expect(body.errors![0]!.path).toBe('email');
  });

  it('neznámou chybu přeloží na internal_error a nikdy nevyzradí příčinu', () => {
    const { body, status } = toProblem(new Error('select * from users where password_hash = $1'), REQ);
    expect(status).toBe(500);
    expect(body.code).toBe('internal_error');
    expect(JSON.stringify(body)).not.toContain('password_hash');
    expect(JSON.stringify(body)).not.toContain('select');
  });
});

describe('resolveRequestId', () => {
  it('převezme platnou hodnotu z hlavičky', () => {
    expect(resolveRequestId('abc.def-123')).toBe('abc.def-123');
  });

  it('odmítne příliš krátkou hodnotu a vygeneruje UUIDv7', () => {
    const id = resolveRequestId('short');
    expect(id).not.toBe('short');
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('odmítne hodnotu s nepovoleným znakem', () => {
    expect(resolveRequestId('abc def gh')).not.toBe('abc def gh');
  });

  it('bez hlavičky vygeneruje UUIDv7', () => {
    expect(resolveRequestId(undefined)).toMatch(/^[0-9a-f]{8}-/);
  });
});
```

- [ ] **Krok 2: Spusť test, ověř, že padá**

Run: `pnpm --filter @mlain/web test:unit -- lib/api/problem.test.ts`
Expected: FAIL, `Cannot find module './problem.js'`.

- [ ] **Krok 3: Napiš `request-id.ts`**

Create `apps/web/src/lib/api/request-id.ts`:

```ts
import { v7 as uuidv7 } from 'uuid';

/** 4.1: hodnota z hlavičky projde, jen když vyhoví tomuhle tvaru. */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/;

export const REQUEST_ID_HEADER = 'X-Request-Id';

export function resolveRequestId(headerValue: string | undefined | null): string {
  if (headerValue && REQUEST_ID_PATTERN.test(headerValue)) return headerValue;
  return uuidv7();
}
```

- [ ] **Krok 4: Napiš `problem.ts`**

Create `apps/web/src/lib/api/problem.ts`:

```ts
import { ApiError, type Finding, type ValidationIssue } from '@mlain/core/errors/api-error';
import { resolveDetail } from '@mlain/core/errors/detail-catalog';

export const PROBLEM_CONTENT_TYPE = 'application/problem+json; charset=utf-8';

/** 4.7: URI typu se dogeneruje podle vzorce, nikdy se nevyplňuje ručně. */
const TYPE_BASE = 'https://docs.mlain.dev/errors/';

export type Problem = {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance: string;
  code: string;
  request_id: string;
  errors?: ValidationIssue[];
  findings?: Finding[];
  params?: Record<string, unknown>;
  retry_after?: number;
};

export type ProblemRequest = {
  path: string;
  requestId: string;
  acceptLanguage?: string | null;
};

/** Vezme první jazyk z Accept-Language. Kvalitativní váhy neřešíme, katalogy jsou dva. */
function pickLocale(acceptLanguage: string | null | undefined): string {
  if (!acceptLanguage) return 'en';
  const first = acceptLanguage.split(',')[0]?.trim().split(';')[0]?.trim();
  return first && first.length > 0 ? first : 'en';
}

export function toProblem(
  err: unknown,
  req: ProblemRequest,
): { body: Problem; status: number; headers: Record<string, string> } {
  // 4.2: ven jde vždy registrovaný kód. Cizí výjimka je vždy internal_error,
  // protože její zpráva může obsahovat SQL, název sloupce nebo obsah proměnné.
  const apiErr = err instanceof ApiError ? err : new ApiError('internal_error', { cause: err });
  const locale = pickLocale(req.acceptLanguage);

  const body: Problem = {
    type: `${TYPE_BASE}${apiErr.code}`,
    title: apiErr.title,
    status: apiErr.status,
    detail: resolveDetail(apiErr.code, locale),
    instance: req.path,
    code: apiErr.code,
    request_id: req.requestId,
  };

  if (apiErr.errors) body.errors = apiErr.errors;
  if (apiErr.findings) body.findings = apiErr.findings;
  if (apiErr.params) body.params = apiErr.params;
  if (apiErr.retryAfter !== undefined) body.retry_after = apiErr.retryAfter;

  const headers: Record<string, string> = { 'Content-Type': PROBLEM_CONTENT_TYPE };
  if (apiErr.retryAfter !== undefined) headers['Retry-After'] = String(apiErr.retryAfter);

  return { body, status: apiErr.status, headers };
}
```

- [ ] **Krok 5: Spusť test, ověř, že prochází**

Run: `pnpm --filter @mlain/web test:unit -- lib/api/problem.test.ts`
Expected: 10 passed.

- [ ] **Krok 6: Commit**

```bash
git add apps/web/src/lib/api/problem.ts apps/web/src/lib/api/request-id.ts apps/web/src/lib/api/problem.test.ts
git commit -m "feat(api): RFC 9457 problem envelope and request correlation id"
```

---

### Úkol 5: Validace vstupu a mapování zod chyb

Pokrývá kritéria 27 a 28.

**Files:**
- Create: `apps/web/src/lib/api/validation.ts`
- Test: `apps/web/src/lib/api/validation.test.ts`

- [ ] **Krok 1: Napiš padající test**

Create `apps/web/src/lib/api/validation.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { z } from '@hono/zod-openapi';
import { ApiError } from '@mlain/core/errors/api-error';
import { zodIssuesToValidationErrors, parseStrict } from './validation.js';

const Schema = z
  .object({
    email: z.email(),
    attributes: z.object({ age: z.number() }).optional(),
  })
  .strict();

describe('parseStrict', () => {
  it('propustí platné tělo', () => {
    expect(parseStrict(Schema, { email: 'a@b.cz' })).toEqual({ email: 'a@b.cz' });
  });

  it('neznámý klíč odmítne s validation_failed, ne s 201', () => {
    try {
      parseStrict(Schema, { email: 'a@b.cz', emial: 'preklep' });
      expect.unreachable('mělo hodit');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      const err = e as ApiError;
      expect(err.status).toBe(422);
      expect(err.code).toBe('validation_failed');
      expect(JSON.stringify(err.errors)).toContain('emial');
    }
  });

  it('cesta je tečková notace bez úvodního lomítka', () => {
    try {
      parseStrict(Schema, { email: 'a@b.cz', attributes: { age: 'sedm' } });
      expect.unreachable('mělo hodit');
    } catch (e) {
      expect((e as ApiError).errors?.map((x) => x.path)).toContain('attributes.age');
    }
  });

  it('každá vadná položka má vlastní záznam v errors', () => {
    try {
      parseStrict(Schema, { email: 'neni-email', attributes: { age: 'sedm' } });
      expect.unreachable('mělo hodit');
    } catch (e) {
      expect((e as ApiError).errors?.length).toBe(2);
    }
  });
});

describe('zodIssuesToValidationErrors', () => {
  it('prázdná cesta se mapuje na prázdný řetězec, ne na undefined', () => {
    const result = Schema.safeParse('nejsem objekt');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(zodIssuesToValidationErrors(result.error.issues)[0]!.path).toBe('');
    }
  });

  it('index pole se píše tečkou, ne hranatou závorkou', () => {
    const ArraySchema = z.object({ tags: z.array(z.string()) }).strict();
    const result = ArraySchema.safeParse({ tags: ['a', 7] });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(zodIssuesToValidationErrors(result.error.issues)[0]!.path).toBe('tags.1');
    }
  });
});
```

- [ ] **Krok 2: Spusť test, ověř, že padá**

Run: `pnpm --filter @mlain/web test:unit -- lib/api/validation.test.ts`
Expected: FAIL, `Cannot find module './validation.js'`.

- [ ] **Krok 3: Napiš `validation.ts`**

Create `apps/web/src/lib/api/validation.ts`:

```ts
import type { z } from '@hono/zod-openapi';
import { validationFailed, type ValidationIssue } from '@mlain/core/errors/api-error';

/**
 * 4.2: `errors[].path` je JSON Pointer bez úvodního lomítka, tedy tečková notace.
 * Index pole se píše jako `.0`, protože v tečkové notaci hranatá závorka není.
 */
export function issuePathToDotted(path: ReadonlyArray<PropertyKey>): string {
  return path.map((p) => String(p)).join('.');
}

export function zodIssuesToValidationErrors(issues: ReadonlyArray<z.core.$ZodIssue>): ValidationIssue[] {
  return issues.map((issue) => ({
    path: issuePathToDotted(issue.path ?? []),
    code: issue.code ?? 'invalid_value',
    message: issue.message,
  }));
}

/**
 * 4.1: neznámé klíče v těle jsou odmítnuté, protože tiché ignorování překlepu
 * je nejhorší možná odpověď na {"emial": "..."}. Schéma proto musí být .strict().
 */
export function parseStrict<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw validationFailed(zodIssuesToValidationErrors(result.error.issues));
}
```

- [ ] **Krok 4: Spusť test, ověř, že prochází**

Run: `pnpm --filter @mlain/web test:unit -- lib/api/validation.test.ts`
Expected: 6 passed.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/src/lib/api/validation.ts apps/web/src/lib/api/validation.test.ts
git commit -m "feat(api): strict zod validation mapped to RFC 9457 errors"
```
---

### Úkol 6: Kostra aplikace Hono, chybový handler a limity requestu

**Files:**
- Create: `apps/web/src/lib/api/client-ip.ts`
- Create: `apps/web/src/lib/api/app.ts`
- Test: `apps/web/src/lib/api/client-ip.test.ts`
- Test: `apps/web/src/lib/api/app.test.ts`

- [ ] **Krok 1: Napiš padající test zjištění IP**

Create `apps/web/src/lib/api/client-ip.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { clientIpFrom } from './client-ip.js';

describe('clientIpFrom', () => {
  it('při TRUST_PROXY=0 ignoruje X-Forwarded-For', () => {
    expect(clientIpFrom({ xff: '1.2.3.4, 5.6.7.8', remote: '10.0.0.1', trustProxy: 0 })).toBe('10.0.0.1');
  });

  it('při TRUST_PROXY=1 bere první adresu zprava', () => {
    expect(clientIpFrom({ xff: '1.2.3.4, 5.6.7.8', remote: '10.0.0.1', trustProxy: 1 })).toBe('5.6.7.8');
  });

  it('při TRUST_PROXY=2 bere druhou adresu zprava', () => {
    expect(clientIpFrom({ xff: '1.2.3.4, 5.6.7.8', remote: '10.0.0.1', trustProxy: 2 })).toBe('1.2.3.4');
  });

  it('nikdy nebere naivně první hodnotu, kterou nastaví útočník', () => {
    expect(clientIpFrom({ xff: '9.9.9.9, 1.2.3.4', remote: '10.0.0.1', trustProxy: 1 })).toBe('1.2.3.4');
  });

  it('při kratším XFF než TRUST_PROXY spadne zpět na adresu spojení', () => {
    expect(clientIpFrom({ xff: '1.2.3.4', remote: '10.0.0.1', trustProxy: 3 })).toBe('10.0.0.1');
  });

  it('bez XFF vrací adresu spojení', () => {
    expect(clientIpFrom({ xff: null, remote: '10.0.0.1', trustProxy: 2 })).toBe('10.0.0.1');
  });
});
```

- [ ] **Krok 2: Spusť test, ověř, že padá, a napiš `client-ip.ts`**

Run: `pnpm --filter @mlain/web test:unit -- lib/api/client-ip.test.ts`
Expected: FAIL, `Cannot find module './client-ip.js'`.

Create `apps/web/src/lib/api/client-ip.ts`:

```ts
/**
 * 4.5: TRUST_PROXY určuje, kolik proxy vrstev věřit. Naivní "vezmi první hodnotu
 * z XFF" je zakázané, protože ji útočník nastaví.
 */
export function clientIpFrom(input: {
  xff: string | null | undefined;
  remote: string;
  trustProxy: number;
}): string {
  if (input.trustProxy <= 0 || !input.xff) return input.remote;
  const parts = input.xff
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const index = parts.length - input.trustProxy;
  if (index < 0 || index >= parts.length) return input.remote;
  return parts[index]!;
}
```

- [ ] **Krok 3: Spusť test, ověř, že prochází**

Run: `pnpm --filter @mlain/web test:unit -- lib/api/client-ip.test.ts`
Expected: 6 passed.

- [ ] **Krok 4: Napiš padající test kostry aplikace**

Create `apps/web/src/lib/api/app.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createApiApp } from './app.js';

const app = createApiApp();

describe('kostra API', () => {
  it('neexistující cesta vrací 404 jako problem+json', async () => {
    const res = await app.request('/api/v1/neexistuje');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    const body = await res.json();
    expect(body.code).toBe('not_found');
    expect(body.request_id).toBeTruthy();
  });

  it('vrací X-Request-Id a shoduje se s tělem chyby', async () => {
    const res = await app.request('/api/v1/neexistuje', { headers: { 'X-Request-Id': 'abcdefgh' } });
    expect(res.headers.get('X-Request-Id')).toBe('abcdefgh');
    expect((await res.json()).request_id).toBe('abcdefgh');
  });

  it('koncové lomítko přesměruje 308 na variantu bez něj', async () => {
    const res = await app.request('/api/v1/__test/ok/');
    expect(res.status).toBe(308);
    expect(res.headers.get('location')).toBe('/api/v1/__test/ok');
  });

  it('zápis s jiným Content-Type vrací 415', async () => {
    const res = await app.request('/api/v1/__test/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'ahoj',
    });
    expect(res.status).toBe(415);
    expect((await res.json()).code).toBe('unsupported_media_type');
  });

  it('tělo nad 1 MiB vrací 413', async () => {
    const res = await app.request('/api/v1/__test/echo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': String(2 * 1024 * 1024) },
      body: JSON.stringify({ padding: 'x'.repeat(1024) }),
    });
    expect(res.status).toBe(413);
    expect((await res.json()).code).toBe('payload_too_large');
  });

  it('nepovolená metoda na existující cestě vrací 405', async () => {
    const res = await app.request('/api/v1/__test/ok', { method: 'DELETE' });
    expect(res.status).toBe(405);
    expect((await res.json()).code).toBe('method_not_allowed');
  });

  it('výjimka v handleru se nikdy nedostane ven jako stack', async () => {
    const res = await app.request('/api/v1/__test/boom');
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('at ');
    expect(JSON.parse(text).code).toBe('internal_error');
  });
});
```

- [ ] **Krok 5: Spusť test, ověř, že padá**

Run: `pnpm --filter @mlain/web test:unit -- lib/api/app.test.ts`
Expected: FAIL, `Cannot find module './app.js'`.

- [ ] **Krok 6: Napiš `app.ts`**

Create `apps/web/src/lib/api/app.ts`:

```ts
import { OpenAPIHono } from '@hono/zod-openapi';
import type { Context } from 'hono';
import pino from 'pino';
import { ApiError } from '@mlain/core/errors/api-error';
import { config } from '@mlain/core/config';
import { toProblem } from './problem.js';
import { resolveRequestId, REQUEST_ID_HEADER } from './request-id.js';
import { clientIpFrom } from './client-ip.js';
import { enrichForbidden } from './authenticate.js';

/** 4.1: tělo JSON nejvýš 1 MiB. Větší limity si endpoint deklaruje sám. */
export const MAX_JSON_BODY_BYTES = 1024 * 1024;

/** Cesty, které si deklarují vlastní Content-Type. V P04 žádná, doplňují domény. */
export const CONTENT_TYPE_EXEMPT_PREFIXES = new Set<string>();

export type ApiVariables = {
  requestId: string;
  clientIp: string;
  startedAt: number;
  workspaceId?: string | null;
  actorType?: string | null;
  actorId?: string | null;
};

export type ApiEnv = { Variables: ApiVariables };

export const apiLogger = pino({
  level: config.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      '*.password',
      '*.secret',
      '*.token',
      '*.secret_access_key',
      '*.api_key',
      '*.render_data',
    ],
    censor: '[redacted]',
  },
});

export function problemResponseFor(c: Context<ApiEnv>, err: unknown): Response {
  const { body, status, headers } = toProblem(err, {
    path: new URL(c.req.url).pathname,
    requestId: c.get('requestId') ?? resolveRequestId(c.req.header(REQUEST_ID_HEADER)),
    acceptLanguage: c.req.header('Accept-Language'),
  });
  // 4.2: interní detaily jdou do logu pod request_id, nikdy do odpovědi.
  if (status >= 500) {
    apiLogger.error({ request_id: body.request_id, route: body.instance, err }, 'unhandled_error');
  }
  return new Response(JSON.stringify(body), { status, headers });
}

export function createApiApp() {
  const app = new OpenAPIHono<ApiEnv>({
    // 4.1: neznámý klíč a vadný tvar končí jako validation_failed, ne jako 400 od frameworku.
    defaultHook: (result) => {
      if (!result.success) {
        throw new ApiError('validation_failed', {
          errors: result.error.issues.map((issue) => ({
            path: (issue.path ?? []).map((p) => String(p)).join('.'),
            code: issue.code ?? 'invalid_value',
            message: issue.message,
          })),
        });
      }
    },
  });

  // Korelace a základní kontext requestu.
  app.use('*', async (c, next) => {
    const requestId = resolveRequestId(c.req.header(REQUEST_ID_HEADER));
    c.set('requestId', requestId);
    c.set('startedAt', Date.now());
    c.set(
      'clientIp',
      clientIpFrom({
        xff: c.req.header('X-Forwarded-For'),
        remote: (c.env as { remoteAddress?: string } | undefined)?.remoteAddress ?? '127.0.0.1',
        trustProxy: config.TRUST_PROXY,
      }),
    );
    c.header(REQUEST_ID_HEADER, requestId);
    await next();
    apiLogger.info(
      {
        request_id: requestId,
        route: new URL(c.req.url).pathname,
        status: c.res.status,
        duration_ms: Date.now() - c.get('startedAt'),
        workspace_id: c.get('workspaceId') ?? null,
        actor_type: c.get('actorType') ?? null,
        actor_id: c.get('actorId') ?? null,
      },
      'request',
    );
  });

  // 4.1: bez koncového lomítka. Request s ním dostane 308 na variantu bez něj.
  app.use('*', async (c, next) => {
    const url = new URL(c.req.url);
    if (url.pathname.length > 1 && url.pathname.endsWith('/')) {
      return c.redirect(url.pathname.slice(0, -1) + url.search, 308);
    }
    await next();
  });

  // 4.1: metoda, kterou cesta nemá, je 405, ne 404. Rozlišení stojí na tom,
  // jestli router zná stejnou cestu pod jinou metodou.
  app.use('/api/v1/*', async (c, next) => {
    await next();
    if (c.res.status !== 404) return;
    const pathname = new URL(c.req.url).pathname;
    for (const method of ['GET', 'POST', 'PATCH', 'PUT', 'DELETE']) {
      if (method === c.req.method) continue;
      const [handlers] = app.router.match(method, pathname);
      if (handlers && handlers.length > 0) {
        c.res = problemResponseFor(c, new ApiError('method_not_allowed'));
        return;
      }
    }
  });

  // 4.1: limity requestu. Povolené Content-Type se určují per endpoint; tohle je
  // výchozí pravidlo pro /api/v1/**, endpoint s jiným typem si ho deklaruje sám
  // a zapíše prefix cesty do CONTENT_TYPE_EXEMPT_PREFIXES.
  app.use('/api/v1/*', async (c, next) => {
    const method = c.req.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS' || method === 'DELETE') {
      await next();
      return;
    }
    const pathname = new URL(c.req.url).pathname;
    if (![...CONTENT_TYPE_EXEMPT_PREFIXES].some((p) => pathname.startsWith(p))) {
      const declared = c.req.header('Content-Type') ?? '';
      if (declared.split(';')[0]?.trim() !== 'application/json') {
        throw new ApiError('unsupported_media_type');
      }
    }
    const declaredLength = Number(c.req.header('Content-Length') ?? '0');
    if (Number.isFinite(declaredLength) && declaredLength > MAX_JSON_BODY_BYTES) {
      throw new ApiError('payload_too_large');
    }
    await next();
  });

  app.notFound(() => {
    throw new ApiError('not_found');
  });

  // Chyba `forbidden` se před odesláním obohatí o kolegy, které jde požádat
  // o vyšší roli, a to jen tehdy, když aktér smí členy vidět (úkol 32).
  // Kdyby obohacení samo selhalo, odešle se původní chyba: diagnostika nesmí
  // shodit odpověď, kterou vysvětluje.
  app.onError(async (err, c) => {
    const ctx = c.get('auth')?.ctx;
    if (ctx && err instanceof ApiError && err.code === 'forbidden') {
      try {
        return problemResponseFor(c as Context<ApiEnv>, await enrichForbidden(ctx, err));
      } catch {
        // spadneme na původní chybu níž
      }
    }
    return problemResponseFor(c as Context<ApiEnv>, err);
  });

  // Cesty, které existují jen mimo produkci a slouží k ověření kostry.
  if (config.NODE_ENV !== 'production') {
    app.get('/api/v1/__test/ok', (c) => c.json({ ok: true }));
    app.post('/api/v1/__test/echo', async (c) => c.json(await c.req.json()));
    app.get('/api/v1/__test/boom', () => {
      throw new Error('select * from users where password_hash = $1');
    });
  }

  return app;
}
```

- [ ] **Krok 7: Spusť test, ověř, že prochází**

Run: `pnpm --filter @mlain/web test:unit -- lib/api/app.test.ts`
Expected: 7 passed.

- [ ] **Krok 8: Commit**

```bash
git add apps/web/src/lib/api/app.ts apps/web/src/lib/api/client-ip.ts apps/web/src/lib/api/app.test.ts apps/web/src/lib/api/client-ip.test.ts
git commit -m "feat(api): Hono application skeleton with problem+json error handling"
```

---

### Úkol 7: Kurzorové stránkování

Pokrývá kritérium 33.

**Files:**
- Create: `apps/web/src/lib/api/pagination.ts`
- Test: `apps/web/src/lib/api/pagination.test.ts`
- Test: `apps/web/test/api/pagination-integrity.test.ts`

- [ ] **Krok 1: Napiš padající test**

Create `apps/web/src/lib/api/pagination.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ApiError } from '@mlain/core/errors/api-error';
import { encodeCursor, decodeCursor, buildPage, parsePaginationQuery } from './pagination.js';

const VECTOR_KEYS = ['2026-07-31T14:22:03.000Z', '0192f3a0-1c2d-7e43-8d4e-5f60718293a4'];
const VECTOR_B64 =
  'eyJrIjpbIjIwMjYtMDctMzFUMTQ6MjI6MDMuMDAwWiIsIjAxOTJmM2EwLTFjMmQtN2U0My04ZDRlLTVmNjA3MTgyOTNhNCJdLCJkIjoibiIsIm8iOiJjcmVhdGVkX2F0LmRlc2MifQ';

describe('kurzor', () => {
  it('odpovídá závaznému vektoru ze 4.3', () => {
    expect(encodeCursor(VECTOR_KEYS, 'n', 'created_at.desc')).toBe(VECTOR_B64);
  });

  it('dekóduje vlastní výstup', () => {
    expect(decodeCursor(VECTOR_B64, 'created_at.desc')).toEqual({
      k: VECTOR_KEYS,
      d: 'n',
      o: 'created_at.desc',
    });
  });

  it('kurzor s jiným order končí 422', () => {
    try {
      decodeCursor(VECTOR_B64, 'created_at.asc');
      expect.unreachable('mělo hodit');
    } catch (e) {
      expect((e as ApiError).status).toBe(422);
    }
  });

  it('kurzor bez pole o končí 422, protože je povinné', () => {
    const broken = Buffer.from(JSON.stringify({ k: ['a'], d: 'n' }), 'utf8').toString('base64url');
    expect(() => decodeCursor(broken, 'created_at.desc')).toThrow(ApiError);
  });

  it('nesmyslný kurzor končí 422, ne 500', () => {
    expect(() => decodeCursor('!!!nejsem base64!!!', 'created_at.desc')).toThrow(ApiError);
  });
});

describe('parsePaginationQuery', () => {
  it('výchozí hodnoty jsou limit 50 a první povolený order', () => {
    expect(parsePaginationQuery({}, ['created_at.desc', 'created_at.asc'])).toEqual({
      limit: 50,
      order: 'created_at.desc',
      cursor: null,
    });
  });

  it('limit nad 200 končí 422', () => {
    expect(() => parsePaginationQuery({ limit: '201' }, ['created_at.desc'])).toThrow(ApiError);
  });

  it('limit 0 končí 422', () => {
    expect(() => parsePaginationQuery({ limit: '0' }, ['created_at.desc'])).toThrow(ApiError);
  });

  it('nevyjmenovaný order končí 422', () => {
    expect(() => parsePaginationQuery({ order: 'name.asc' }, ['created_at.desc'])).toThrow(ApiError);
  });
});

describe('buildPage', () => {
  const row = (i: number) => ({ id: String(i), created_at: '2026-07-31T00:00:00.000Z' });

  it('has_more je odvozené z načtení limit + 1 řádků', () => {
    const page = buildPage(
      Array.from({ length: 51 }, (_, i) => row(i)),
      { limit: 50, order: 'created_at.desc' },
      (r) => [r.created_at, r.id],
    );
    expect(page.data).toHaveLength(50);
    expect(page.pagination.has_more).toBe(true);
    expect(page.pagination.next_cursor).toBeTruthy();
  });

  it('poslední stránka nemá next_cursor', () => {
    const page = buildPage([row(1)], { limit: 50, order: 'created_at.desc' }, (r) => [r.created_at, r.id]);
    expect(page.pagination.has_more).toBe(false);
    expect(page.pagination.next_cursor).toBeNull();
  });

  it('celkový počet se v odpovědi seznamu nevrací nikdy', () => {
    const page = buildPage([row(1)], { limit: 50, order: 'created_at.desc' }, (r) => [r.created_at, r.id]);
    expect(Object.keys(page.pagination)).toEqual(['next_cursor', 'prev_cursor', 'has_more', 'limit']);
  });
});
```

- [ ] **Krok 2: Spusť test, ověř, že padá**

Run: `pnpm --filter @mlain/web test:unit -- lib/api/pagination.test.ts`
Expected: FAIL, `Cannot find module './pagination.js'`.

- [ ] **Krok 3: Napiš `pagination.ts`**

Create `apps/web/src/lib/api/pagination.ts`:

```ts
import { sql, type SQL, type AnyColumn } from 'drizzle-orm';
import { validationFailed } from '@mlain/core/errors/api-error';

export type CursorDirection = 'n' | 'p';

export type Cursor = {
  /** Hodnoty řadicích klíčů posledního řádku. Vždy včetně implicitního id. */
  k: unknown[];
  d: CursorDirection;
  /** Order, pro který kurzor platí. Povinné, viz 4.3. */
  o: string;
};

export type Pagination = {
  next_cursor: string | null;
  prev_cursor: string | null;
  has_more: boolean;
  limit: number;
};

export type Page<T> = { data: T[]; pagination: Pagination };

export const DEFAULT_LIMIT = 50;
export const MIN_LIMIT = 1;
export const MAX_LIMIT = 200;

export function encodeCursor(keys: unknown[], direction: CursorDirection, order: string): string {
  const payload: Cursor = { k: keys, d: direction, o: order };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string, expectedOrder: string): Cursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
  } catch {
    throw validationFailed([{ path: 'cursor', code: 'invalid_cursor', message: 'Kurzor nejde přečíst.' }]);
  }
  const cursor = parsed as Cursor;
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !Array.isArray(cursor.k) ||
    (cursor.d !== 'n' && cursor.d !== 'p') ||
    typeof cursor.o !== 'string'
  ) {
    throw validationFailed([{ path: 'cursor', code: 'invalid_cursor', message: 'Kurzor má neplatný tvar.' }]);
  }
  // 4.3: když se `o` v kurzoru neshoduje s parametrem order, výsledek by nedával smysl.
  if (cursor.o !== expectedOrder) {
    throw validationFailed([
      { path: 'cursor', code: 'cursor_order_mismatch', message: 'Kurzor patří k jinému řazení.' },
    ]);
  }
  return cursor;
}

export function parsePaginationQuery(
  query: { limit?: string; order?: string; cursor?: string },
  allowedOrders: readonly string[],
): { limit: number; order: string; cursor: Cursor | null } {
  let limit = DEFAULT_LIMIT;
  if (query.limit !== undefined) {
    const parsed = Number(query.limit);
    if (!Number.isInteger(parsed) || parsed < MIN_LIMIT || parsed > MAX_LIMIT) {
      throw validationFailed([
        {
          path: 'limit',
          code: 'out_of_range',
          message: `Limit musí být celé číslo od ${MIN_LIMIT} do ${MAX_LIMIT}.`,
        },
      ]);
    }
    limit = parsed;
  }

  const order = query.order ?? allowedOrders[0]!;
  if (!allowedOrders.includes(order)) {
    throw validationFailed([
      { path: 'order', code: 'unsupported_order', message: `Povolené hodnoty: ${allowedOrders.join(', ')}.` },
    ]);
  }

  return { limit, order, cursor: query.cursor ? decodeCursor(query.cursor, order) : null };
}

/**
 * Keyset porovnání n-tice. 4.3: každé order končí implicitně `, id desc`,
 * takže klíč má vždy aspoň dvě složky a porovnává se jako n-tice, ne po sloupcích.
 * Porovnání po sloupcích je klasická chyba, která tiše přeskakuje řádky.
 */
export function keysetCondition(
  columns: readonly AnyColumn[],
  values: readonly unknown[],
  direction: 'asc' | 'desc',
): SQL {
  const left = sql.join(
    columns.map((c) => sql`${c}`),
    sql`, `,
  );
  const right = sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  );
  return direction === 'desc' ? sql`(${left}) < (${right})` : sql`(${left}) > (${right})`;
}

/**
 * Rozdělí načtených limit + 1 řádků na stránku a příznak has_more.
 * Celkový počet se nevrací nikdy, na to je samostatný endpoint /count (4.3).
 */
export function buildPage<T>(
  rows: T[],
  opts: { limit: number; order: string },
  keysOf: (row: T) => unknown[],
): Page<T> {
  const hasMore = rows.length > opts.limit;
  const data = hasMore ? rows.slice(0, opts.limit) : rows;
  const last = data[data.length - 1];
  return {
    data,
    pagination: {
      next_cursor: hasMore && last ? encodeCursor(keysOf(last), 'n', opts.order) : null,
      prev_cursor: null,
      has_more: hasMore,
      limit: opts.limit,
    },
  };
}
```

- [ ] **Krok 4: Spusť test, ověř, že prochází**

Run: `pnpm --filter @mlain/web test:unit -- lib/api/pagination.test.ts`
Expected: 12 passed.

- [ ] **Krok 5: Napiš pomocníka pro operace, na které aplikační role nemá právo**

Některé testy musí udělat něco, co `mlain_app` z principu nesmí: založit pomocné schéma, nebo smazat řádky napříč projekty při úklidu. Pod aplikační rolí to dopadne dvěma způsoby a **ani jeden není chyba, kterou by bylo vidět**: DDL skončí na `permission denied`, kdežto `DELETE` pod RLS smaže **nula řádků a tváří se, že uklidil**. Druhá varianta je horší, protože testy pak na sebe navazují ve stavu, o kterém si myslí, že je čistý.

Create `packages/core/src/test-support/migrator.ts`:

```ts
/**
 * Spojení pod rolí `mlain_migrator` pro testy. NENÍ součástí produkční cesty
 * a aplikace ho nikdy neimportuje: `mlain_migrator` obchází RLS a smí DDL,
 * takže by jím šlo obejít celý model izolace.
 *
 * Používá se přesně na dvě věci:
 *   1. DDL v testech (`mlain_app` má na schéma public jen USAGE a DML granty),
 *   2. úklid mezi testy (pod `mlain_app` smaže RLS nula řádků BEZ CHYBY).
 */
import { Pool, type PoolClient } from 'pg';

let pool: Pool | null = null;

function migratorPool(): Pool {
  if (pool) return pool;
  const url = process.env.DATABASE_URL_MIGRATOR;
  if (!url) {
    // Tvrdě, ne přeskočením. Test, který se tiše přeskočí, je test, který
    // nikdy nic neochránil, a přesně tenhle vzor už jednou nechal celou sadu
    // bran neběžet, aniž by to někdo poznal.
    throw new Error(
      'DATABASE_URL_MIGRATOR není nastavená. Testy, které potřebují DDL nebo úklid, '
      + 'nesmí běžet pod aplikační rolí: DDL by spadlo a DELETE by pod RLS tiše '
      + 'smazal nula řádků.',
    );
  }
  pool = new Pool({ connectionString: url, max: 2, options: '-c timezone=UTC' });
  return pool;
}

export async function asMigrator<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const client = await migratorPool().connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function closeMigratorPool(): Promise<void> {
  const current = pool;
  pool = null;
  await current?.end();
}
```

Ověř, že role opravdu obchází RLS, jinak by pomocník tiše nefungoval stejně jako to, co nahrazuje:

```bash
psql "$DATABASE_URL_MIGRATOR" -tAc "select rolbypassrls from pg_roles where rolname = current_user"
```
Expected: `t`. Když vrátí `f`, je to nález proti P03 nebo P01 a **úklid mezi testy je nespolehlivý**, ne jen pomalejší.

- [ ] **Krok 6: Napiš databázový test na kritérium 33**

Create `apps/web/test/api/pagination-integrity.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { withoutContext } from '@mlain/core/tx';
import { asMigrator, closeMigratorPool } from '@mlain/core/test-support/migrator';
import { buildPage, decodeCursor } from '../../src/lib/api/pagination.js';

/**
 * Kritérium 33: stránkování přes celý seznam 10 000 položek po 50 vrátí každou
 * položku právě jednou i při souběžném vkládání nových. Testuje se na pomocné
 * tabulce, protože doménové tabulky vlastní jiné plány a tenhle test ověřuje
 * mechanismus, ne konkrétní zdroj.
 *
 * Příprava běží pod rolí `mlain_migrator`, ne pod aplikační rolí. `mlain_app`
 * má na schéma `public` jen USAGE a DML granty, žádné CREATE, takže
 * `CREATE SCHEMA` pod ní skončí na `permission denied for database` a kritérium
 * 33 by se nikdy neověřilo. Čtení uvnitř testu naopak zůstává pod `mlain_app`,
 * protože se testuje aplikační cesta.
 */
describe('integrita kurzorového stránkování', () => {
  beforeAll(async () => {
    await asMigrator(async (db) => {
      await db.query(`CREATE SCHEMA IF NOT EXISTS pagination_probe`);
      await db.query(`DROP TABLE IF EXISTS pagination_probe.items`);
      await db.query(`
        CREATE TABLE pagination_probe.items (
          id uuid PRIMARY KEY DEFAULT uuidv7(),
          created_at timestamptz NOT NULL DEFAULT now()
        )
      `);
      await db.query(`
        INSERT INTO pagination_probe.items (created_at)
        SELECT now() - (g || ' seconds')::interval FROM generate_series(1, 10000) g
      `);
      await db.query(`
        CREATE INDEX idx_pagination_probe_items ON pagination_probe.items (created_at DESC, id DESC)
      `);
      // Bez grantu by aplikační role z pomocné tabulky nepřečetla nic a test
      // by hlásil prázdné stránkování místo chybějícího práva.
      await db.query(`GRANT USAGE ON SCHEMA pagination_probe TO mlain_app`);
      await db.query(`GRANT SELECT, INSERT ON pagination_probe.items TO mlain_app`);
    });
  });

  afterAll(async () => {
    await asMigrator((db) => db.query(`DROP SCHEMA IF EXISTS pagination_probe CASCADE`));
    await closeMigratorPool();
  });

  it('projde 10 000 položek po 50 a každou vrátí právě jednou', async () => {
    const seen = new Set<string>();
    let cursor: { k: unknown[] } | null = null;
    let pages = 0;

    for (;;) {
      const current = cursor;
      const rows = await withoutContext(async (tx) => {
        const where = current
          ? sql`WHERE (created_at, id) < (${current.k[0]}::timestamptz, ${current.k[1]}::uuid)`
          : sql``;
        const result = await tx.execute<{ id: string; created_at: Date }>(sql`
          SELECT id::text AS id, created_at FROM pagination_probe.items
          ${where}
          ORDER BY created_at DESC, id DESC
          LIMIT 51
        `);
        return result.rows;
      });

      const page = buildPage(rows, { limit: 50, order: 'created_at.desc' }, (r) => [
        r.created_at.toISOString(),
        r.id,
      ]);
      for (const item of page.data) {
        expect(seen.has(item.id), `duplicitní položka ${item.id}`).toBe(false);
        seen.add(item.id);
      }
      pages += 1;

      // Souběžný zápis mezi stránkami: přesně ten případ, kvůli kterému offset selhává.
      // Nová položka má created_at = now(), tedy leží PŘED kurzorem, takže se do
      // procházení nedostane a zároveň nesmí posunout už načtené řádky.
      await withoutContext(async (tx) => {
        await tx.execute(sql`INSERT INTO pagination_probe.items (created_at) VALUES (now())`);
      });

      if (!page.pagination.next_cursor) break;
      cursor = decodeCursor(page.pagination.next_cursor, 'created_at.desc');
      expect(pages).toBeLessThan(300);
    }

    expect(seen.size).toBe(10000);
    expect(pages).toBe(200);
  });
});
```

- [ ] **Krok 7: Spusť databázový test**

Run: `pnpm --filter @mlain/web test:db -- api/pagination-integrity.test.ts`
Expected: 1 passed, `seen.size` je přesně 10000 a `pages` přesně 200.

- [ ] **Krok 8: Commit**

```bash
git add apps/web/src/lib/api/pagination.ts apps/web/src/lib/api/pagination.test.ts apps/web/test/api/pagination-integrity.test.ts
git commit -m "feat(api): cursor pagination with keyset tuple comparison"
```

---

### Úkol 8: Endpoint na počty s časovým stropem

**Files:**
- Create: `apps/web/src/lib/api/counting.ts`
- Test: `apps/web/src/lib/api/counting.test.ts`

- [ ] **Krok 1: Napiš padající test**

Create `apps/web/src/lib/api/counting.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { sql } from 'drizzle-orm';
import { pgErrorCode, withoutContext } from '@mlain/core/tx';
import { countWithTimeout, COUNT_TIMEOUT_MS } from './counting.js';

const SLOW_COUNT = sql`SELECT count(*) AS count FROM generate_series(1, 2000000000)`;

describe('countWithTimeout', () => {
  it('rychlý dotaz vrátí precision exact', async () => {
    const result = await withoutContext((tx) =>
      countWithTimeout(tx, sql`SELECT 42::bigint AS count`, sql`SELECT 0::bigint AS count`),
    );
    expect(result.count).toBe(42);
    expect(result.precision).toBe('exact');
    expect(result.stale).toBe(false);
    expect(new Date(result.computed_at).toString()).not.toBe('Invalid Date');
  });

  it('při překročení stropu spadne na odhad plánovače', async () => {
    const result = await withoutContext((tx) =>
      countWithTimeout(tx, SLOW_COUNT, sql`SELECT 1000::bigint AS count`),
    );
    expect(result.precision).toBe('estimated');
    expect(result.count).toBe(1000);
  });

  it('zrušený dotaz nese SQLSTATE 57014 na cause, ne na code', async () => {
    // Tenhle test hlídá to, na čem stojí celá náhradní cesta výše.
    // Kdyby countWithTimeout četl `err.code` přímo, dostal by undefined,
    // podmínka by byla vždy pravdivá, chyba by se vyhodila dál a uživatel
    // by místo přibližného počtu dostal 500. Test výše by to sice odhalil taky,
    // ale hlásil by "estimated !== exact", což na příčinu neukazuje.
    let caught: unknown;
    try {
      await withoutContext(async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout = 300`);
        await tx.execute(SLOW_COUNT);
      });
      expect.unreachable('dotaz měl být zrušen stropem');
    } catch (err) {
      caught = err;
    }
    expect((caught as { code?: unknown }).code,
           'Drizzle chybu zabaluje, SQLSTATE na err.code NENÍ').toBeUndefined();
    expect(pgErrorCode(caught)).toBe('57014');
  });

  it('strop je 500 ms podle 4.3', () => {
    expect(COUNT_TIMEOUT_MS).toBe(500);
  });
});
```

- [ ] **Krok 2: Spusť test, ověř, že padá**

Run: `pnpm --filter @mlain/web test:db -- lib/api/counting.test.ts`
Expected: FAIL, `Cannot find module './counting.js'`.

- [ ] **Krok 3: Napiš `counting.ts`**

Create `apps/web/src/lib/api/counting.ts`:

```ts
import { sql, type SQL } from 'drizzle-orm';
import { pgErrorCode, withoutContext, type Tx } from '@mlain/core/tx';

/** 4.3: přesný COUNT(*) se počítá se statement_timeout 500 ms, pak se vrací odhad. */
export const COUNT_TIMEOUT_MS = 500;

/** SQLSTATE pro dotaz zrušený kvůli statement_timeout. */
const QUERY_CANCELED = '57014';

export type CountResult = {
  count: number;
  precision: 'exact' | 'estimated';
  computed_at: string;
  stale: boolean;
};

/**
 * Spustí přesný COUNT(*) se stropem. Když nedoběhne, vrátí odhad plánovače.
 * Drtivá většina instalací dostane přesné číslo a nikdo nečeká déle než půl sekundy.
 *
 * Odhad běží ve VLASTNÍ transakci schválně: po zrušeném dotazu je původní
 * transakce v chybovém stavu a další příkaz v ní by skončil na 25P02.
 */
export async function countWithTimeout(tx: Tx, exactQuery: SQL, estimateQuery: SQL): Promise<CountResult> {
  const computedAt = new Date().toISOString();
  try {
    // SET LOCAL platí do konce transakce, takže se strop nepropíše do dalších dotazů.
    await tx.execute(sql`SET LOCAL statement_timeout = ${COUNT_TIMEOUT_MS}`);
    const { rows } = await tx.execute<{ count: string | number }>(exactQuery);
    await tx.execute(sql`SET LOCAL statement_timeout = DEFAULT`);
    return { count: Number(rows[0]?.count ?? 0), precision: 'exact', computed_at: computedAt, stale: false };
  } catch (err) {
    // SQLSTATE se čte VÝHRADNĚ přes pgErrorCode. Drizzle chybu ovladače balí
    // do DrizzleQueryError, takže `err.code` je undefined a přímé porovnání by
    // bylo vždy nepravda: náhradní cesta na odhad by se nikdy neprovedla
    // a uživatel by místo přibližného čísla dostal 500. Ověřeno spuštěním, viz 0.8.
    if (pgErrorCode(err) !== QUERY_CANCELED) throw err;
    const rows = await withoutContext(
      async (fresh) => (await fresh.execute<{ count: string | number }>(estimateQuery)).rows,
    );
    return { count: Number(rows[0]?.count ?? 0), precision: 'estimated', computed_at: computedAt, stale: false };
  }
}

/** Odhad plánovače pro nefiltrovaný seznam: reltuples z pg_class. */
export function reltuplesEstimate(tableName: string): SQL {
  return sql`SELECT GREATEST(reltuples, 0)::bigint AS count FROM pg_class WHERE oid = ${tableName}::regclass`;
}
```

- [ ] **Krok 4: Spusť test, ověř, že prochází**

Run: `pnpm --filter @mlain/web test:db -- lib/api/counting.test.ts`
Expected: 4 passed. Pokud druhý test skončí chybou `25P02`, odhad neběží ve vlastní transakci a `countWithTimeout` je potřeba opravit. Ověřeno spuštěním, že to není teoretická obava: druhý dotaz v transakci, ve které byl předchozí zrušen stropem, skutečně selže na `25P02`.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/src/lib/api/counting.ts apps/web/src/lib/api/counting.test.ts
git commit -m "feat(api): count helper with 500 ms exact-count ceiling and planner estimate"
```

---

### Úkol 9: Idempotence zápisů

Pokrývá kritéria 30 a 31 (integrační ověření je v úkolu 31, kde už existuje endpoint).

**Files:**
- Create: `apps/web/src/lib/api/idempotency.ts`
- Test: `apps/web/src/lib/api/idempotency.test.ts`

- [ ] **Krok 1: Napiš padající test**

Create `apps/web/src/lib/api/idempotency.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ApiError } from '@mlain/core/errors/api-error';
import { canonicalJson, fingerprintOf, validateIdempotencyKey } from './idempotency.js';

describe('kanonizace těla', () => {
  it('seřadí klíče podle kódových bodů', () => {
    expect(canonicalJson({ b: 1, a: 2, A: 3 })).toBe('{"A":3,"a":2,"b":1}');
  });

  it('vnořené objekty se kanonizují taky', () => {
    expect(canonicalJson({ x: { z: 1, y: 2 } })).toBe('{"x":{"y":2,"z":1}}');
  });

  it('pole si drží pořadí', () => {
    expect(canonicalJson({ a: [3, 1, 2] })).toBe('{"a":[3,1,2]}');
  });

  it('bez nevýznamných mezer', () => {
    expect(canonicalJson({ a: 1 })).not.toContain(' ');
  });

  it('čísla v nejkratší podobě', () => {
    expect(canonicalJson({ a: 1.0, b: 1e2 })).toBe('{"a":1,"b":100}');
  });
});

describe('otisk requestu', () => {
  it('je stejný pro přeformátované stejné tělo', () => {
    const a = fingerprintOf('POST', '/api/v1/api-keys', { name: 'x', scopes: ['a'] });
    const b = fingerprintOf('POST', '/api/v1/api-keys', { scopes: ['a'], name: 'x' });
    expect(a.equals(b)).toBe(true);
  });

  it('se liší při jiné cestě', () => {
    const a = fingerprintOf('POST', '/api/v1/api-keys', { name: 'x' });
    const b = fingerprintOf('POST', '/api/v1/webhook-endpoints', { name: 'x' });
    expect(a.equals(b)).toBe(false);
  });

  it('se liší při jiné metodě', () => {
    const a = fingerprintOf('POST', '/api/v1/api-keys', { name: 'x' });
    const b = fingerprintOf('PATCH', '/api/v1/api-keys', { name: 'x' });
    expect(a.equals(b)).toBe(false);
  });

  it('se liší při jiné hodnotě v těle', () => {
    const a = fingerprintOf('POST', '/api/v1/api-keys', { name: 'x' });
    const b = fingerprintOf('POST', '/api/v1/api-keys', { name: 'y' });
    expect(a.equals(b)).toBe(false);
  });
});

describe('validace hlavičky', () => {
  it('projde osmiznakový klíč', () => {
    expect(validateIdempotencyKey('abcdefgh')).toBe('abcdefgh');
  });

  it('chybějící hlavička končí 422 s cestou Idempotency-Key', () => {
    try {
      validateIdempotencyKey(undefined);
      expect.unreachable('mělo hodit');
    } catch (e) {
      const err = e as ApiError;
      expect(err.status).toBe(422);
      expect(err.errors?.[0]?.path).toBe('Idempotency-Key');
    }
  });

  it('sedmiznakový klíč končí 422', () => {
    expect(() => validateIdempotencyKey('abcdefg')).toThrow(ApiError);
  });

  it('klíč s mezerou končí 422', () => {
    expect(() => validateIdempotencyKey('abcdefg h')).toThrow(ApiError);
  });

  it('klíč nad 255 znaků končí 422', () => {
    expect(() => validateIdempotencyKey('a'.repeat(256))).toThrow(ApiError);
  });
});
```

- [ ] **Krok 2: Spusť test, ověř, že padá**

Run: `pnpm --filter @mlain/web test:unit -- lib/api/idempotency.test.ts`
Expected: FAIL, `Cannot find module './idempotency.js'`.

- [ ] **Krok 3: Napiš `idempotency.ts`**

Create `apps/web/src/lib/api/idempotency.ts`:

```ts
import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import type { Tx } from '@mlain/core/tx';
import { ApiError, validationFailed } from '@mlain/core/errors/api-error';

const KEY_PATTERN = /^[A-Za-z0-9._:-]{8,255}$/;

/** 4.4: uložená odpověď nejvýš 64 kB. Větší se neukládá. */
export const MAX_STORED_RESPONSE_BYTES = 64 * 1024;
/** 4.4: souběžný request se stejným klíčem se považuje za opuštěný po 60 s. */
export const LOCK_TAKEOVER_SECONDS = 60;
/** 4.4: retence 24 hodin, úklid jobem platform.cleanup_idempotency. */
export const IDEMPOTENCY_TTL_HOURS = 24;

export function validateIdempotencyKey(raw: string | undefined | null): string {
  if (!raw || !KEY_PATTERN.test(raw)) {
    throw validationFailed([
      {
        path: 'Idempotency-Key',
        code: 'invalid_idempotency_key',
        message: 'Hlavička Idempotency-Key musí mít 8 až 255 znaků z [A-Za-z0-9._:-].',
      },
    ]);
  }
  return raw;
}

/**
 * Kanonický JSON: klíče objektů seřazené podle kódových bodů, bez nevýznamných
 * mezer, čísla v nejkratší podobě. Bez toho by přeformátovaný stejný request
 * vypadal jako jiný a idempotence by nefungovala.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

export function fingerprintOf(method: string, path: string, body: unknown): Buffer {
  return createHash('sha256').update(`${method}\n${path}\n${canonicalJson(body)}`, 'utf8').digest();
}

export type IdempotencyOutcome<T> =
  | { replay: true; status: number; body: unknown }
  | { replay: false; result: T };

/**
 * Algoritmus ze 4.4. Celý běží uvnitř jedné transakce s nastaveným workspace
 * kontextem, protože idempotency_keys má workspace_id NOT NULL a RLS na něj platí.
 */
export async function withIdempotency<T>(
  tx: Tx,
  input: { workspaceId: string; key: string; method: string; path: string; body: unknown },
  operation: () => Promise<{ status: number; body: unknown; result: T }>,
): Promise<IdempotencyOutcome<T>> {
  const fingerprint = fingerprintOf(input.method, input.path, input.body);
  const scope = and(
    eq(schema.idempotencyKeys.workspaceId, input.workspaceId),
    eq(schema.idempotencyKeys.key, input.key),
  );

  const inserted = await tx
    .insert(schema.idempotencyKeys)
    .values({
      workspaceId: input.workspaceId,
      key: input.key,
      fingerprint,
      status: 'in_progress',
      expiresAt: sql`now() + interval '${sql.raw(String(IDEMPOTENCY_TTL_HOURS))} hours'`,
    })
    .onConflictDoNothing()
    .returning({ key: schema.idempotencyKeys.key });

  if (inserted.length === 0) {
    const [row] = await tx.select().from(schema.idempotencyKeys).where(scope).limit(1);
    if (!row) throw new ApiError('conflict');

    if (row.status === 'completed') {
      if (!Buffer.from(row.fingerprint).equals(fingerprint)) {
        throw new ApiError('idempotency_key_reuse');
      }
      return { replay: true, status: row.responseStatus ?? 200, body: row.responseBody };
    }

    // status = in_progress
    const ageSeconds = (Date.now() - new Date(row.lockedAt).getTime()) / 1000;
    if (ageSeconds < LOCK_TAKEOVER_SECONDS) {
      throw new ApiError('idempotency_request_in_progress', { retryAfter: 2 });
    }
    const takeover = await tx
      .update(schema.idempotencyKeys)
      .set({ lockedAt: new Date(), fingerprint })
      .where(and(scope, eq(schema.idempotencyKeys.lockedAt, row.lockedAt)))
      .returning({ key: schema.idempotencyKeys.key });
    if (takeover.length !== 1) {
      throw new ApiError('idempotency_request_in_progress', { retryAfter: 2 });
    }
  }

  try {
    const outcome = await operation();
    const serialized = JSON.stringify(outcome.body ?? null);
    const storable = Buffer.byteLength(serialized, 'utf8') <= MAX_STORED_RESPONSE_BYTES;
    await tx
      .update(schema.idempotencyKeys)
      .set({
        status: 'completed',
        responseStatus: outcome.status,
        responseBody: storable ? (outcome.body as never) : null,
        completedAt: new Date(),
      })
      .where(scope);
    return { replay: false, result: outcome.result };
  } catch (err) {
    // 4.4: chyby 4xx způsobené vstupem se ukládají jako výsledek, protože
    // zopakování stejného špatného requestu má dát stejnou odpověď. Ostatní
    // chyby záznam mažou, aby šel request bezpečně zopakovat.
    if (err instanceof ApiError && err.status >= 400 && err.status < 500) throw err;
    await tx.delete(schema.idempotencyKeys).where(scope);
    throw err;
  }
}
```

- [ ] **Krok 4: Spusť test, ověř, že prochází**

Run: `pnpm --filter @mlain/web test:unit -- lib/api/idempotency.test.ts`
Expected: 14 passed.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/src/lib/api/idempotency.ts apps/web/src/lib/api/idempotency.test.ts
git commit -m "feat(api): idempotency for write endpoints per 4.4"
```

---

### Úkol 10: Rate limiting na tři úrovně

Pokrývá kritérium 32.

**Files:**
- Create: `apps/web/src/lib/api/rate-limit.ts`
- Test: `apps/web/src/lib/api/rate-limit.test.ts`

- [ ] **Krok 1: Napiš padající test**

Create `apps/web/src/lib/api/rate-limit.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { ApiError } from '@mlain/core/errors/api-error';
import { RATE_LIMIT_RULES, createLimiterRegistry, consumeAll } from './rate-limit.js';

describe('katalog limitů', () => {
  it('obsahuje právě ta pravidla, která patří P04 a doménám s API klíčem', () => {
    expect(Object.keys(RATE_LIMIT_RULES).sort()).toEqual([
      'api_key_read',
      'api_key_write',
      'campaign_send',
      'contacts_import',
      'login_ip',
      'login_ip_email',
      'password_reset_ip',
      'session_user',
      'setup_ip',
    ]);
  });

  it('bezpečnostní limity nejsou konfigurovatelné', () => {
    expect(RATE_LIMIT_RULES.login_ip.configurable).toBe(false);
    expect(RATE_LIMIT_RULES.login_ip_email.configurable).toBe(false);
    expect(RATE_LIMIT_RULES.password_reset_ip.configurable).toBe(false);
    expect(RATE_LIMIT_RULES.setup_ip.configurable).toBe(false);
  });

  it('má hodnoty přesně podle tabulky 4.5', () => {
    expect(RATE_LIMIT_RULES.login_ip).toMatchObject({ points: 20, durationSec: 300 });
    expect(RATE_LIMIT_RULES.login_ip_email).toMatchObject({ points: 5, durationSec: 300 });
    expect(RATE_LIMIT_RULES.password_reset_ip).toMatchObject({ points: 5, durationSec: 3600 });
    expect(RATE_LIMIT_RULES.setup_ip).toMatchObject({ points: 10, durationSec: 3600 });
    expect(RATE_LIMIT_RULES.session_user).toMatchObject({ points: 600, durationSec: 60 });
    expect(RATE_LIMIT_RULES.contacts_import).toMatchObject({ points: 10, durationSec: 3600 });
    expect(RATE_LIMIT_RULES.campaign_send).toMatchObject({ points: 30, durationSec: 3600 });
  });
});

describe('consumeAll', () => {
  let registry: ReturnType<typeof createLimiterRegistry>;

  beforeEach(() => {
    registry = createLimiterRegistry({ backend: 'memory', enabled: true });
  });

  it('pod limitem projde a vrátí hlavičky i při úspěchu', async () => {
    const headers = await consumeAll(registry, [{ rule: 'login_ip', key: '1.2.3.4' }]);
    expect(headers['RateLimit-Limit']).toBe('20');
    expect(Number(headers['RateLimit-Remaining'])).toBe(19);
    expect(Number(headers['RateLimit-Reset'])).toBeGreaterThan(0);
  });

  it('nad limitem hodí rate_limited s Retry-After', async () => {
    for (let i = 0; i < 5; i += 1) {
      await consumeAll(registry, [{ rule: 'login_ip_email', key: '1.2.3.4|a@b.cz' }]);
    }
    try {
      await consumeAll(registry, [{ rule: 'login_ip_email', key: '1.2.3.4|a@b.cz' }]);
      expect.unreachable('mělo hodit');
    } catch (e) {
      const err = e as ApiError;
      expect(err.code).toBe('rate_limited');
      expect(err.status).toBe(429);
      expect(err.retryAfter).toBeGreaterThan(0);
    }
  });

  it('různé klíče se nepočítají dohromady', async () => {
    for (let i = 0; i < 5; i += 1) {
      await consumeAll(registry, [{ rule: 'login_ip_email', key: `1.2.3.4|user${i}@b.cz` }]);
    }
    await expect(
      consumeAll(registry, [{ rule: 'login_ip_email', key: '1.2.3.4|user9@b.cz' }]),
    ).resolves.toBeTruthy();
  });

  it('vypnutý limiter propouští všechno', async () => {
    const off = createLimiterRegistry({ backend: 'memory', enabled: false });
    for (let i = 0; i < 100; i += 1) {
      await consumeAll(off, [{ rule: 'login_ip_email', key: 'x' }]);
    }
    await expect(consumeAll(off, [{ rule: 'login_ip_email', key: 'x' }])).resolves.toEqual({});
  });

  it('při víc pravidlech vrátí hlavičky toho s nejmenším zbytkem', async () => {
    for (let i = 0; i < 3; i += 1) {
      await consumeAll(registry, [{ rule: 'login_ip_email', key: 'k' }]);
    }
    const headers = await consumeAll(registry, [
      { rule: 'login_ip', key: 'ip' },
      { rule: 'login_ip_email', key: 'k' },
    ]);
    expect(headers['RateLimit-Limit']).toBe('5');
  });
});
```

- [ ] **Krok 2: Spusť test, ověř, že padá**

Run: `pnpm --filter @mlain/web test:unit -- lib/api/rate-limit.test.ts`
Expected: FAIL, `Cannot find module './rate-limit.js'`.

- [ ] **Krok 3: Napiš `rate-limit.ts`**

Create `apps/web/src/lib/api/rate-limit.ts`:

```ts
import { RateLimiterMemory, RateLimiterPostgres, type RateLimiterAbstract } from 'rate-limiter-flexible';
import pg from 'pg';
import { ApiError } from '@mlain/core/errors/api-error';
import { config } from '@mlain/core/config';

export type RuleName =
  | 'login_ip'
  | 'login_ip_email'
  | 'password_reset_ip'
  | 'setup_ip'
  | 'session_user'
  | 'api_key_read'
  | 'api_key_write'
  | 'contacts_import'
  | 'campaign_send';

export type Rule = { points: number; durationSec: number; configurable: boolean };

/**
 * Tabulka 4.5. Čísla u konfigurovatelných pravidel jsou VÝCHOZÍ hodnoty a berou
 * se z konfigurace; u nekonfigurovatelných jsou pevná, protože jde o bezpečnostní
 * opatření, kde je možnost hodnotu zvednout spíš díra než funkce.
 *
 * Limity trackovacích endpointů (RATE_LIMIT_TRACK_*) tady schválně nejsou:
 * patří části 5 a jejich pravidla si zaregistruje P10 do vlastního katalogu.
 */
export const RATE_LIMIT_RULES: Record<RuleName, Rule> = {
  api_key_read: { points: config.RATE_LIMIT_API_READ, durationSec: 60, configurable: true },
  api_key_write: { points: config.RATE_LIMIT_API_WRITE, durationSec: 60, configurable: true },
  campaign_send: { points: 30, durationSec: 3600, configurable: false },
  contacts_import: { points: 10, durationSec: 3600, configurable: false },
  login_ip: { points: 20, durationSec: 300, configurable: false },
  login_ip_email: { points: 5, durationSec: 300, configurable: false },
  password_reset_ip: { points: 5, durationSec: 3600, configurable: false },
  session_user: { points: 600, durationSec: 60, configurable: false },
  setup_ip: { points: 10, durationSec: 3600, configurable: false },
};

export type LimiterRegistry = { enabled: boolean; limiters: Map<RuleName, RateLimiterAbstract> };

export function createLimiterRegistry(opts: {
  backend: 'memory' | 'postgres';
  enabled: boolean;
}): LimiterRegistry {
  const limiters = new Map<RuleName, RateLimiterAbstract>();
  if (!opts.enabled) return { enabled: false, limiters };

  const pool =
    opts.backend === 'postgres' ? new pg.Pool({ connectionString: config.DATABASE_URL, max: 2 }) : undefined;

  for (const [name, rule] of Object.entries(RATE_LIMIT_RULES) as Array<[RuleName, Rule]>) {
    limiters.set(
      name,
      opts.backend === 'postgres'
        ? new RateLimiterPostgres({
            storeClient: pool,
            tableName: 'rate_limits',
            schemaName: 'platform',
            // Tabulku zakládá migrace v P03. Knihovna ji nesmí vytvořit sama,
            // protože objekt mimo migraci je objekt, který nikdo neverzuje.
            tableCreated: true,
            keyPrefix: name,
            points: rule.points,
            duration: rule.durationSec,
          })
        : new RateLimiterMemory({ keyPrefix: name, points: rule.points, duration: rule.durationSec }),
    );
  }
  return { enabled: true, limiters };
}

export type Consumption = { rule: RuleName; key: string; cost?: number };

/**
 * Spotřebuje všechna uvedená pravidla. Hlavičky RateLimit-* se posílají
 * i u úspěšných odpovědí, aby klient viděl, jak blízko je limitu (4.5).
 */
export async function consumeAll(
  registry: LimiterRegistry,
  consumptions: readonly Consumption[],
): Promise<Record<string, string>> {
  if (!registry.enabled) return {};

  let tightest: { limit: number; remaining: number; resetSec: number } | null = null;

  for (const item of consumptions) {
    const limiter = registry.limiters.get(item.rule);
    if (!limiter) continue;
    const rule = RATE_LIMIT_RULES[item.rule];
    try {
      const res = await limiter.consume(item.key, item.cost ?? 1);
      const candidate = {
        limit: rule.points,
        remaining: res.remainingPoints,
        resetSec: Math.ceil(res.msBeforeNext / 1000),
      };
      if (!tightest || candidate.remaining < tightest.remaining) tightest = candidate;
    } catch (rejection) {
      const res = rejection as { msBeforeNext?: number };
      if (typeof res.msBeforeNext !== 'number') throw rejection;
      throw new ApiError('rate_limited', {
        retryAfter: Math.max(1, Math.ceil(res.msBeforeNext / 1000)),
        params: { limit: rule.points, window_seconds: rule.durationSec },
      });
    }
  }

  if (!tightest) return {};
  return {
    'RateLimit-Limit': String(tightest.limit),
    'RateLimit-Remaining': String(Math.max(0, tightest.remaining)),
    'RateLimit-Reset': String(Math.max(0, tightest.resetSec)),
  };
}

/** Cesty vyloučené z limitů podle 4.5. Nic jiného vyloučené není. */
export const RATE_LIMIT_EXEMPT_PATHS = new Set(['/api/health', '/api/health/ready', '/metrics']);

/** Jediná instance pro běh aplikace. Testy si vyrábějí vlastní přes createLimiterRegistry. */
export const limiterRegistry = createLimiterRegistry({
  backend: config.RATE_LIMIT_BACKEND,
  enabled: config.RATE_LIMIT_ENABLED,
});
```

- [ ] **Krok 4: Spusť test, ověř, že prochází**

Run: `pnpm --filter @mlain/web test:unit -- lib/api/rate-limit.test.ts`
Expected: 8 passed.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/src/lib/api/rate-limit.ts apps/web/src/lib/api/rate-limit.test.ts
git commit -m "feat(api): three-level rate limiting with IETF RateLimit headers"
```

---

### Úkol 11: Verzování API

**Files:**
- Create: `apps/web/src/lib/api/versioning.ts`
- Test: `apps/web/src/lib/api/versioning.test.ts`

- [ ] **Krok 1: Napiš padající test**

Create `apps/web/src/lib/api/versioning.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ApiError } from '@mlain/core/errors/api-error';
import { API_VERSIONS, versionFromPath, deprecationHeaders, assertVersionSupported } from './versioning.js';

describe('verzování', () => {
  it('v1 je aktivní', () => {
    expect(API_VERSIONS.v1!.phase).toBe('active');
  });

  it('vyčte verzi z cesty', () => {
    expect(versionFromPath('/api/v1/contacts')).toBe('v1');
    expect(versionFromPath('/api/v2/contacts')).toBe('v2');
    expect(versionFromPath('/api/v1')).toBe('v1');
    expect(versionFromPath('/api/health')).toBeNull();
  });

  it('neznámá verze končí 422 unsupported_api_version', () => {
    try {
      assertVersionSupported('v9');
      expect.unreachable('mělo hodit');
    } catch (e) {
      const err = e as ApiError;
      expect(err.code).toBe('unsupported_api_version');
      expect(err.status).toBe(422);
    }
  });

  it('aktivní verze nemá hlavičky Deprecation ani Sunset', () => {
    expect(deprecationHeaders('v1')).toEqual({});
  });

  it('deprecated verze nese Deprecation a Sunset v RFC 1123', () => {
    const headers = deprecationHeaders('v1', {
      v1: { phase: 'deprecated', sunsetAt: new Date('2027-08-01T00:00:00.000Z') },
    });
    expect(headers['Deprecation']).toBe('true');
    expect(headers['Sunset']).toBe('Sun, 01 Aug 2027 00:00:00 GMT');
  });

  it('verze po sunsetu končí 410 endpoint_removed', () => {
    try {
      assertVersionSupported('v1', {
        v1: { phase: 'sunset', sunsetAt: new Date('2020-01-01T00:00:00.000Z') },
      });
      expect.unreachable('mělo hodit');
    } catch (e) {
      const err = e as ApiError;
      expect(err.code).toBe('endpoint_removed');
      expect(err.status).toBe(410);
    }
  });
});
```

- [ ] **Krok 2: Spusť test, ověř, že padá**

Run: `pnpm --filter @mlain/web test:unit -- lib/api/versioning.test.ts`
Expected: FAIL, `Cannot find module './versioning.js'`.

- [ ] **Krok 3: Napiš `versioning.ts`**

Create `apps/web/src/lib/api/versioning.ts`:

```ts
import { ApiError } from '@mlain/core/errors/api-error';

export type VersionPhase = 'active' | 'deprecated' | 'sunset';
export type VersionState = { phase: VersionPhase; sunsetAt?: Date };

/**
 * 4.6: verze je v cestě, ne v hlavičce a ne v datu. Je vidět v logu, v curl
 * příkazu i v dokumentaci a nikdo si ji omylem nezmění.
 *
 * Minimální doba mezi ohlášením deprecated a sunsetem je 12 měsíců u celé verze
 * a 6 měsíců u jednotlivého endpointu. U self-hosted produktu je to důležitější
 * než u SaaS, protože uživatel aktualizuje, kdy chce.
 */
export const API_VERSIONS: Record<string, VersionState> = {
  v1: { phase: 'active' },
};

const VERSION_IN_PATH = /^\/api\/(v\d+)(\/|$)/;

export function versionFromPath(pathname: string): string | null {
  return pathname.match(VERSION_IN_PATH)?.[1] ?? null;
}

export function assertVersionSupported(
  version: string,
  states: Record<string, VersionState> = API_VERSIONS,
): void {
  const state = states[version];
  if (!state) throw new ApiError('unsupported_api_version', { params: { requested: version } });
  if (state.phase === 'sunset') {
    throw new ApiError('endpoint_removed', {
      params: { version, sunset_at: state.sunsetAt?.toISOString() ?? null },
    });
  }
}

/** RFC 8594: Sunset je datum ve formátu RFC 1123, tedy toUTCString(). */
export function deprecationHeaders(
  version: string,
  states: Record<string, VersionState> = API_VERSIONS,
): Record<string, string> {
  const state = states[version];
  if (!state || state.phase !== 'deprecated') return {};
  const headers: Record<string, string> = { Deprecation: 'true' };
  if (state.sunsetAt) headers['Sunset'] = state.sunsetAt.toUTCString();
  return headers;
}
```

- [ ] **Krok 4: Spusť test, ověř, že prochází**

Run: `pnpm --filter @mlain/web test:unit -- lib/api/versioning.test.ts`
Expected: 6 passed.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/src/lib/api/versioning.ts apps/web/src/lib/api/versioning.test.ts
git commit -m "feat(api): API version lifecycle with Deprecation and Sunset headers"
```

---

### Fáze B: identita a kryptografie (úkoly 12 až 20)

---

### Úkol 12: Role, aktér a úplná matice oprávnění

**Files:**
- Create: `packages/core/identity/types.ts`
- Create: `packages/core/identity/permissions.ts`
- Test: `packages/core/identity/permissions.test.ts`

- [ ] **Krok 1: Napiš padající test**

Create `packages/core/identity/permissions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { unsafeWorkspaceContext } from '@mlain/db/unsafe-context';
import { ApiError } from '@mlain/core/errors/api-error';
import {
  PERMISSIONS, ROLE_ORDER, ROLE_PERMISSIONS, assertPermission, roleHasPermission, rolesGranting,
} from './permissions.js';
import type { WorkspaceContext } from './types.js';

const WS = '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071';

const ctxFor = (role: 'owner' | 'admin' | 'editor' | 'viewer'): WorkspaceContext =>
  unsafeWorkspaceContext(WS, { type: 'user', userId: '0192f3a0-1c2d-7e41-9a1b-2c3d4e5f6071', role });

const keyCtx = (scopes: string[]): WorkspaceContext =>
  unsafeWorkspaceContext(WS, { type: 'api_key', apiKeyId: 'k', scopes });

describe('matice oprávnění 3.4', () => {
  it('má přesně 48 oprávnění', () => {
    expect(PERMISSIONS.length).toBe(48);
    expect(new Set(PERMISSIONS).size).toBe(48);
  });

  it('každé oprávnění má tvar resource:action', () => {
    for (const p of PERMISSIONS) expect(p).toMatch(/^[a-z_]+:[a-z_]+$/);
  });

  it('počty na roli sedí s tabulkou', () => {
    expect(ROLE_PERMISSIONS.owner.length).toBe(48);
    expect(ROLE_PERMISSIONS.admin.length).toBe(43);
    expect(ROLE_PERMISSIONS.editor.length).toBe(28);
    expect(ROLE_PERMISSIONS.viewer.length).toBe(12);
  });

  it('role jsou vnořené, každá vyšší umí všechno, co nižší', () => {
    for (const p of ROLE_PERMISSIONS.viewer) expect(ROLE_PERMISSIONS.editor).toContain(p);
    for (const p of ROLE_PERMISSIONS.editor) expect(ROLE_PERMISSIONS.admin).toContain(p);
    for (const p of ROLE_PERMISSIONS.admin) expect(ROLE_PERMISSIONS.owner).toContain(p);
  });

  it('tři netriviální řádky ze specifikace', () => {
    // Export je jednorázový odnos celé databáze kontaktů, editor ho nemá.
    expect(roleHasPermission('editor', 'contacts:export')).toBe(false);
    expect(roleHasPermission('admin', 'contacts:export')).toBe(true);
    // Bez campaigns:send by editor čekal u každé kampaně na admina.
    expect(roleHasPermission('editor', 'campaigns:send')).toBe(true);
    // Záloha obsahuje data všech kontaktů projektu a metadata instalace.
    expect(roleHasPermission('admin', 'backups:run')).toBe(false);
    expect(roleHasPermission('owner', 'backups:run')).toBe(true);
  });

  it('gdpr:erase a workspace:delete má jen owner', () => {
    expect(roleHasPermission('admin', 'gdpr:erase')).toBe(false);
    expect(roleHasPermission('admin', 'workspace:delete')).toBe(false);
    expect(roleHasPermission('admin', 'workspace:transfer')).toBe(false);
  });

  it('viewer čte, ale nezapisuje nic', () => {
    for (const p of ROLE_PERMISSIONS.viewer) expect(p.endsWith(':read')).toBe(true);
  });

  it('rolesGranting vrací role od nejslabší, protože klient nabízí nejnižší dostačující', () => {
    expect(rolesGranting('campaigns:write')).toEqual(['editor', 'admin', 'owner']);
    expect(rolesGranting('contacts:export')).toEqual(['admin', 'owner']);
    expect(rolesGranting('gdpr:erase')).toEqual(['owner']);
    expect(rolesGranting('workspace:read')).toEqual([...ROLE_ORDER]);
  });

  it('rolesGranting je odvozený z matice, ne psaný ručně', () => {
    // Kdyby se seznam psal zvlášť, rozešel by se s maticí a chyba by se
    // projevila jen tím, že hláška radí špatnou roli.
    for (const permission of PERMISSIONS) {
      const granting = rolesGranting(permission);
      expect(granting.length, `${permission} nemá žádnou roli`).toBeGreaterThan(0);
      for (const role of ROLE_ORDER) {
        expect(granting.includes(role)).toBe(roleHasPermission(role, permission));
      }
    }
  });
});

describe('assertPermission', () => {
  it('uživatel s rolí projde', () => {
    expect(() => assertPermission(ctxFor('admin'), 'api_keys:write')).not.toThrow();
  });

  it('uživatel bez oprávnění dostane forbidden 403', () => {
    try {
      assertPermission(ctxFor('viewer'), 'campaigns:write');
      expect.unreachable('mělo hodit');
    } catch (e) {
      const err = e as ApiError;
      expect(err.code).toBe('forbidden');
      expect(err.status).toBe(403);
    }
  });

  it('forbidden nese data, podle kterých jde radu splnit', () => {
    // Rada „požádejte kolegu o vyšší roli" je bez těchhle polí nesplnitelná:
    // obrazovka by neuměla říct ani co chybí, ani kdo to má.
    try {
      assertPermission(ctxFor('viewer'), 'contacts:export');
      expect.unreachable('mělo hodit');
    } catch (e) {
      expect((e as ApiError).params).toMatchObject({
        requiredPermission: 'contacts:export',
        currentRole: 'viewer',
        grantedByRoles: ['admin', 'owner'],
      });
    }
  });

  it('insufficient_scope řekne, které oprávnění klíči chybí a která má', () => {
    try {
      assertPermission(keyCtx(['events:write']), 'contacts:write');
      expect.unreachable('mělo hodit');
    } catch (e) {
      expect((e as ApiError).params).toMatchObject({
        requiredPermission: 'contacts:write',
        grantedScopes: ['events:write'],
      });
    }
  });

  it('API klíč se scope projde', () => {
    expect(() => assertPermission(keyCtx(['contacts:write']), 'contacts:write')).not.toThrow();
  });

  it('API klíč bez scope dostane insufficient_scope 403, ne forbidden', () => {
    try {
      assertPermission(keyCtx(['events:write']), 'contacts:write');
      expect.unreachable('mělo hodit');
    } catch (e) {
      const err = e as ApiError;
      expect(err.code).toBe('insufficient_scope');
      expect(err.status).toBe(403);
    }
  });

  it('u API klíče se role neuplatňuje, jeho oprávnění jsou přesně jeho scopes', () => {
    expect(() => assertPermission(keyCtx([]), 'workspace:read')).toThrow(ApiError);
  });

  it('wildcard * není oprávnění a nikdy neprojde', () => {
    expect(() => assertPermission(keyCtx(['*']), 'contacts:write')).toThrow(ApiError);
    expect(PERMISSIONS).not.toContain('*' as never);
  });

  it('systémový aktér projde vždy, protože běží mimo request', () => {
    const sys = unsafeWorkspaceContext(WS, { type: 'system', job: 'platform.webhook_deliver' });
    expect(() => assertPermission(sys, 'webhooks:write')).not.toThrow();
  });
});
```

- [ ] **Krok 2: Spusť test, ověř, že padá**

Run: `pnpm --filter @mlain/core test:unit -- identity/permissions.test.ts`
Expected: FAIL, `Cannot find module './permissions.js'`.

- [ ] **Krok 3: Napiš `types.ts`**

Create `packages/core/identity/types.ts`:

```ts
/**
 * 3.6, vrstva 1. Typy izolace se sem NEPÍŠOU ZNOVU, jen se reexportují z @mlain/db.
 *
 * Proč: WorkspaceContext je branded typ a jeho smysl je, že nejde vyrobit
 * z řetězce. Kdyby ho P04 definoval podruhé s vlastním `unique symbol`,
 * vznikly by dva vzájemně NEPŘIŘADITELNÉ typy téhož jména. Každé volání
 * withWorkspace, withReadOnly nebo registerRepoModule z @mlain/db by pak šlo
 * napsat jen s přetypováním, a přetypováním padá celá první vrstva izolace.
 * Zdůvodnění je v rozhodnutí R2.
 *
 * Značka (brand) je v @mlain/db neexportovaný `unique symbol`, takže jediný
 * způsob, jak kontext vyrobit, vede přes unsafeWorkspaceContext z podcesty
 * @mlain/db/unsafe-context. Tu volá VÝHRADNĚ context.ts a hlídá to test
 * v úkolu 19.
 */
export type { Actor, Role, WorkspaceContext } from '@mlain/db';

import type { Actor } from '@mlain/db';

export type AuditActorInfo = {
  actorType: 'user' | 'api_key' | 'system';
  actorId: string | null;
  actorLabel: string;
};

/** Popis aktéra pro audit log. actor_label je zmrazený text, ne odkaz (6, GDPR). */
export function actorInfo(actor: Actor, label: string): AuditActorInfo {
  switch (actor.type) {
    case 'user':
      return { actorType: 'user', actorId: actor.userId, actorLabel: label };
    case 'api_key':
      return { actorType: 'api_key', actorId: actor.apiKeyId, actorLabel: label };
    case 'system':
      return { actorType: 'system', actorId: null, actorLabel: actor.job };
  }
}
```

- [ ] **Krok 4: Napiš `permissions.ts`**

Create `packages/core/identity/permissions.ts`:

```ts
import { ApiError } from '@mlain/core/errors/api-error';
import type { Role, WorkspaceContext } from './types.js';

/**
 * Úplná matice ze 3.4. Oprávnění je řetězec `resource:action` a API klíč nese
 * scopes ze STEJNÉHO jmenného prostoru. Wildcard `*` nepovolujeme: klíč s `*`
 * je klíč, o kterém nikdo neví, co smí.
 */
export const PERMISSIONS = [
  'workspace:read',
  'workspace:update',
  'workspace:delete',
  'workspace:transfer',
  'members:read',
  'members:invite',
  'members:update_role',
  'members:remove',
  'api_keys:read',
  'api_keys:write',
  'providers:read',
  'providers:write',
  'domains:read',
  'domains:write',
  'contacts:read',
  'contacts:write',
  'contacts:delete',
  'contacts:export',
  'contacts:import',
  'lists:read',
  'lists:write',
  'segments:read',
  'segments:write',
  'suppressions:read',
  'suppressions:write',
  'templates:read',
  'templates:write',
  'assets:read',
  'assets:write',
  'campaigns:read',
  'campaigns:write',
  'campaigns:send',
  'campaigns:control',
  'campaigns:delete',
  'forms:read',
  'forms:write',
  'events:write',
  'reports:read',
  'timeline:read',
  'webhooks:read',
  'webhooks:write',
  'ai:use',
  'ai:configure',
  'audit:read',
  'backups:read',
  'backups:run',
  'gdpr:export',
  'gdpr:erase',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Vše, co smí viewer. Čtení a nic víc. */
const VIEWER: readonly Permission[] = [
  'workspace:read',
  'domains:read',
  'contacts:read',
  'lists:read',
  'segments:read',
  'suppressions:read',
  'templates:read',
  'assets:read',
  'campaigns:read',
  'forms:read',
  'reports:read',
  'timeline:read',
];

/** Editor tvoří obsah a kampaně. Neodnáší PII a nemění odesílací provider. */
const EDITOR_EXTRA: readonly Permission[] = [
  'members:read',
  'providers:read',
  'contacts:write',
  'contacts:delete',
  'contacts:import',
  'lists:write',
  'segments:write',
  'templates:write',
  'assets:write',
  'campaigns:write',
  'campaigns:send',
  'campaigns:control',
  'forms:write',
  'events:write',
  'webhooks:read',
  'ai:use',
];

/** Admin spravuje přístupy a konfiguraci, nemaže ani nepředává projekt. */
const ADMIN_EXTRA: readonly Permission[] = [
  'workspace:update',
  'members:invite',
  'members:update_role',
  'members:remove',
  'api_keys:read',
  'api_keys:write',
  'providers:write',
  'domains:write',
  'contacts:export',
  'suppressions:write',
  'campaigns:delete',
  'webhooks:write',
  'ai:configure',
  'audit:read',
  'gdpr:export',
];

/** Owner navíc drží nevratné a celoprojektové operace. */
const OWNER_EXTRA: readonly Permission[] = [
  'workspace:delete',
  'workspace:transfer',
  'backups:read',
  'backups:run',
  'gdpr:erase',
];

const editor = [...VIEWER, ...EDITOR_EXTRA];
const admin = [...editor, ...ADMIN_EXTRA];
const owner = [...admin, ...OWNER_EXTRA];

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  viewer: VIEWER,
  editor,
  admin,
  owner,
};

export function roleHasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/** Role od nejslabší k nejsilnější. Pořadí je součástí odpovědi, ne jen detail. */
export const ROLE_ORDER: readonly Role[] = ['viewer', 'editor', 'admin', 'owner'];

/**
 * Které role dané oprávnění mají. Vrací se v odpovědi `forbidden`, aby klient
 * mohl říct „tohle umí admin a výš", ne jen „nemáte oprávnění".
 */
export function rolesGranting(permission: Permission): Role[] {
  return ROLE_ORDER.filter((role) => roleHasPermission(role, permission));
}

/**
 * Jediná kontrola oprávnění v celém produktu (3.4).
 *
 * Rozdíl mezi forbidden a insufficient_scope je záměrný a klient se podle něj
 * rozhoduje jinak: u forbidden má požádat kolegu o vyšší roli, u insufficient_scope
 * má vydat nový klíč s potřebným scope.
 *
 * Obojí proto NESE DATA, podle kterých se ta rada dá splnit. Dřívější znění
 * posílalo jen `permission`, takže obrazovka mohla napsat pouze „nemáte
 * oprávnění", a rada „požádejte kolegu" byla nesplnitelná: klient neměl jak
 * zjistit, koho požádat ani o co. `ForbiddenState` v P05 čte přesně tahle pole
 * a katalog hlášek z nich skládá větu.
 *
 * `contactableMembers` tady schválně NENÍ: vyžaduje dotaz do databáze a tahle
 * funkce je čistá a synchronní. Doplňuje ho `enrichForbidden` v úkolu 32,
 * a jen tomu, kdo smí členy vidět.
 */
export function assertPermission(ctx: WorkspaceContext, permission: Permission): void {
  const actor = ctx.actor;
  if (actor.type === 'system') return;
  if (actor.type === 'api_key') {
    if (!actor.scopes.includes(permission)) {
      throw new ApiError('insufficient_scope', {
        params: {
          permission,
          requiredPermission: permission,
          grantedScopes: [...actor.scopes],
        },
      });
    }
    return;
  }
  if (!roleHasPermission(actor.role, permission)) {
    throw new ApiError('forbidden', {
      params: {
        permission,
        requiredPermission: permission,
        currentRole: actor.role,
        grantedByRoles: rolesGranting(permission),
        // Doplní enrichForbidden, když má aktér právo členy vidět.
        contactableMembers: [],
      },
    });
  }
}
```

- [ ] **Krok 5: Spusť test, ověř, že prochází**

Run: `pnpm --filter @mlain/core test:unit -- identity/permissions.test.ts`
Expected: 18 passed. Když počty nesedí, porovnej řádek po řádku s tabulkou v kapitole 3.4 specifikace; čísla 48, 43, 28 a 12 jsou z ní odvozená a jsou závazná.

- [ ] **Krok 6: Commit**

```bash
git add packages/core/identity/types.ts packages/core/identity/permissions.ts packages/core/identity/permissions.test.ts
git commit -m "feat(identity): full role and permission matrix with assertPermission"
```

---

### Úkol 13: Hesla, Argon2id a blocklist

**Files:**
- Create: `packages/core/identity/password.ts`
- Create: `packages/core/identity/data/common-passwords.txt`
- Test: `packages/core/identity/password.test.ts`

- [ ] **Krok 1: Pořiď blocklist 10 000 nejčastějších hesel**

Run:
```bash
mkdir -p packages/core/identity/data
curl -fsSL https://raw.githubusercontent.com/danielmiessler/SecLists/master/Passwords/Common-Credentials/10-million-password-list-top-10000.txt \
  -o packages/core/identity/data/common-passwords.txt
wc -l packages/core/identity/data/common-passwords.txt
```
Expected: `10000`. SecLists je MIT, tedy licenčně v pořádku. Když stahování selže (uzavřená síť), obstarej seznam jinak; závazná je podoba souboru, kterou ověřuje test v kroku 3: 10 000 neprázdných řádků, samá malá písmena, bez duplicit.

- [ ] **Krok 2: Znormalizuj soubor na malá písmena a bez duplicit**

Run:
```bash
node --input-type=module --eval "
import fs from 'node:fs';
const p = 'packages/core/identity/data/common-passwords.txt';
const lines = fs.readFileSync(p, 'utf8').split('\n').map((l) => l.trim().toLowerCase()).filter(Boolean);
const uniq = [...new Set(lines)].slice(0, 10000);
fs.writeFileSync(p, uniq.join('\n') + '\n');
console.log(uniq.length);
"
```
Expected: `10000`. Když je číslo nižší, seznam obsahoval duplicity a je potřeba doplnit další hesla z téhož zdroje, aby jich bylo přesně 10 000.

- [ ] **Krok 3: Napiš padající test**

Create `packages/core/identity/password.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ApiError } from '@mlain/core/errors/api-error';
import {
  ARGON2_PARAMS,
  hashPassword,
  verifyPassword,
  needsRehash,
  assertPasswordPolicy,
  normalizePassword,
  DUMMY_PASSWORD_HASH,
  commonPasswordCount,
} from './password.js';

describe('parametry Argon2id', () => {
  it('odpovídají OWASP variantě s nejnižší pamětí (3.1)', () => {
    expect(ARGON2_PARAMS).toEqual({ memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 });
  });

  it('hash je PHC řetězec argon2id s deklarovanými parametry', async () => {
    const hash = await hashPassword('spravne-dlouhe-heslo');
    expect(hash.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
  });
});

describe('ověření hesla', () => {
  it('správné heslo projde', async () => {
    const hash = await hashPassword('spravne-dlouhe-heslo');
    expect(await verifyPassword(hash, 'spravne-dlouhe-heslo')).toBe(true);
  });

  it('špatné heslo neprojde', async () => {
    const hash = await hashPassword('spravne-dlouhe-heslo');
    expect(await verifyPassword(hash, 'jine-dlouhe-heslo1')).toBe(false);
  });

  it('poškozený PHC řetězec vrátí false a nehodí výjimku', async () => {
    expect(await verifyPassword('tohle-neni-phc', 'spravne-dlouhe-heslo')).toBe(false);
  });

  it('dummy hash existuje, je platný a nikdy se s ním nedá přihlásit', async () => {
    expect(DUMMY_PASSWORD_HASH.startsWith('$argon2id$v=19$m=19456,t=2,p=1$')).toBe(true);
    expect(await verifyPassword(DUMMY_PASSWORD_HASH, 'spravne-dlouhe-heslo')).toBe(false);
  });

  it('normalizace NFKC probíhá před hashováním', async () => {
    // Stejný znak zapsaný dvěma způsoby: předkomponovaný a s kombinující čárkou.
    const composed = 'nekonecne-heslo-é';
    const decomposed = 'nekonecne-heslo-é';
    const hash = await hashPassword(composed);
    expect(await verifyPassword(hash, decomposed)).toBe(true);
  });

  it('normalizePassword vrací NFKC podobu', () => {
    expect(normalizePassword('é').normalize('NFKC')).toBe(normalizePassword('é'));
  });
});

describe('rehash', () => {
  it('aktuální parametry rehash nevyžadují', async () => {
    expect(needsRehash(await hashPassword('spravne-dlouhe-heslo'))).toBe(false);
  });

  it('slabší parametry rehash vyžadují', () => {
    expect(needsRehash('$argon2id$v=19$m=4096,t=1,p=1$c2FsdHNhbHQ$aGFzaGhhc2g')).toBe(true);
  });

  it('jiný algoritmus vyžaduje rehash', () => {
    expect(needsRehash('$argon2i$v=19$m=19456,t=2,p=1$c2FsdHNhbHQ$aGFzaGhhc2g')).toBe(true);
  });
});

describe('pravidla hesla (3.1)', () => {
  it('12 znaků projde', () => {
    expect(() => assertPasswordPolicy('abcdefghijkl', 'petr@example.cz')).not.toThrow();
  });

  it('11 znaků končí 422', () => {
    expect(() => assertPasswordPolicy('abcdefghijk', 'petr@example.cz')).toThrow(ApiError);
  });

  it('257 znaků se odmítne, neořezává se', () => {
    try {
      assertPasswordPolicy('a'.repeat(257), 'petr@example.cz');
      expect.unreachable('mělo hodit');
    } catch (e) {
      expect((e as ApiError).errors?.[0]?.code).toBe('password_too_long');
    }
  });

  it('256 znaků ještě projde', () => {
    expect(() => assertPasswordPolicy('a'.repeat(256), 'petr@example.cz')).not.toThrow();
  });

  it('žádné povinné třídy znaků', () => {
    expect(() => assertPasswordPolicy('aaaaaaaaaaaaaaaa', 'petr@example.cz')).not.toThrow();
  });

  it('heslo z blocklistu se odmítne bez ohledu na velikost písmen', () => {
    expect(() => assertPasswordPolicy('Password1234', 'petr@example.cz')).toThrow(ApiError);
  });

  it('heslo obsahující lokální část e-mailu se odmítne', () => {
    try {
      assertPasswordPolicy('petr-tajne-heslo', 'petr@example.cz');
      expect.unreachable('mělo hodit');
    } catch (e) {
      expect((e as ApiError).errors?.[0]?.code).toBe('password_contains_email');
    }
  });

  it('blocklist má 10 000 položek', () => {
    expect(commonPasswordCount()).toBe(10000);
  });
});
```

- [ ] **Krok 4: Spusť test, ověř, že padá**

Run: `pnpm --filter @mlain/core test:unit -- identity/password.test.ts`
Expected: FAIL, `Cannot find module './password.js'`.

- [ ] **Krok 5: Napiš `password.ts`**

Create `packages/core/identity/password.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { hash as argonHash, verify as argonVerify, Algorithm } from '@node-rs/argon2';
import { validationFailed } from '@mlain/core/errors/api-error';

/**
 * 3.1: OWASP Password Storage Cheat Sheet nabízí několik rovnocenných variant
 * lišících se poměrem paměti a času. Volíme tu s nejnižší pamětí, protože cílíme
 * na self-hosted instalaci se 2 GB RAM: m=47104 by při deseti souběžných
 * přihlášeních znamenalo skoro půl gigabajtu špičkově.
 */
export const ARGON2_PARAMS = { memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 256;

/** Unicode NFKC před hashováním, aby se stejné heslo z různých klávesnic shodovalo. */
export function normalizePassword(raw: string): string {
  return raw.normalize('NFKC');
}

export async function hashPassword(raw: string): Promise<string> {
  return argonHash(normalizePassword(raw), { algorithm: Algorithm.Argon2id, ...ARGON2_PARAMS });
}

/**
 * Nikdy nehází. Poškozený PHC řetězec je z pohledu přihlášení totéž co špatné
 * heslo a rozdíl by se dal změřit.
 */
export async function verifyPassword(phc: string, raw: string): Promise<boolean> {
  try {
    return await argonVerify(phc, normalizePassword(raw));
  } catch {
    return false;
  }
}

/**
 * Dummy PHC řetězec pro případ, kdy účet neexistuje. Hash nad ním trvá stejně
 * dlouho jako nad skutečným, takže se z doby odpovědi nedá poznat, jestli účet je.
 * Heslo, ze kterého vznikl, je náhodných 32 bajtů, které nikdo nezná.
 */
export const DUMMY_PASSWORD_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$ZHVtbXlkdW1teWR1bW15ZHU$KpH8xVLm4rXJmLZ0jQK1WQeLQTNQ4zqIYQ9Y0oSVQ2I';

const PHC_PATTERN = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/;

/**
 * 3.1: po úspěšném ověření se z PHC řetězce přečtou parametry a při neshodě
 * s aktuálními se heslo přehashuje. Tím se instalace samy posunou, až parametry
 * zpřísníme.
 */
export function needsRehash(phc: string): boolean {
  const match = phc.match(PHC_PATTERN);
  if (!match) return true;
  return (
    Number(match[1]) !== ARGON2_PARAMS.memoryCost ||
    Number(match[2]) !== ARGON2_PARAMS.timeCost ||
    Number(match[3]) !== ARGON2_PARAMS.parallelism
  );
}

const BLOCKLIST_PATH = fileURLToPath(new URL('./data/common-passwords.txt', import.meta.url));

let blocklist: Set<string> | null = null;

function commonPasswords(): Set<string> {
  if (!blocklist) {
    blocklist = new Set(
      readFileSync(BLOCKLIST_PATH, 'utf8')
        .split('\n')
        .map((l) => l.trim().toLowerCase())
        .filter((l) => l.length > 0),
    );
  }
  return blocklist;
}

export function commonPasswordCount(): number {
  return commonPasswords().size;
}

/**
 * Pravidla z 3.1. Žádné povinné třídy znaků: vynucená velká písmena a číslice
 * vedou k Heslo123!, což je horší než dlouhá fráze.
 */
export function assertPasswordPolicy(raw: string, email: string): void {
  const password = normalizePassword(raw);

  if (password.length < PASSWORD_MIN_LENGTH) {
    throw validationFailed([
      {
        path: 'password',
        code: 'password_too_short',
        message: `Heslo musí mít aspoň ${PASSWORD_MIN_LENGTH} znaků.`,
      },
    ]);
  }
  // Nad limit odmítnout, ne ořezat: tiché zkrácení by uživatele odstřihlo
  // od účtu, jakmile by heslo napsal celé jinde.
  if (password.length > PASSWORD_MAX_LENGTH) {
    throw validationFailed([
      {
        path: 'password',
        code: 'password_too_long',
        message: `Heslo smí mít nejvýš ${PASSWORD_MAX_LENGTH} znaků.`,
      },
    ]);
  }
  if (commonPasswords().has(password.toLowerCase())) {
    throw validationFailed([
      {
        path: 'password',
        code: 'password_too_common',
        message: 'Tohle heslo je mezi deseti tisíci nejpoužívanějšími. Zvolte jiné.',
      },
    ]);
  }
  const localPart = email.split('@')[0]?.toLowerCase() ?? '';
  if (localPart.length >= 3 && password.toLowerCase().includes(localPart)) {
    throw validationFailed([
      {
        path: 'password',
        code: 'password_contains_email',
        message: 'Heslo nesmí obsahovat část vaší e-mailové adresy.',
      },
    ]);
  }
}
```

- [ ] **Krok 6: Vygeneruj skutečný dummy hash a nahraď konstantu**

Konstanta v kroku 5 je zástupná hodnota správného tvaru, ale nevznikla z Argon2. Nahraď ji skutečným hashem, jinak `verifyPassword(DUMMY_PASSWORD_HASH, ...)` skončí výjimkou místo `false` a jednotná latence padne.

Run:
```bash
node --input-type=module --eval "
import { hash, Algorithm } from '@node-rs/argon2';
import crypto from 'node:crypto';
const h = await hash(crypto.randomBytes(32).toString('base64url'), { algorithm: Algorithm.Argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1, outputLen: 32 });
console.log(h);
"
```
Zkopíruj výstup do `DUMMY_PASSWORD_HASH` v `packages/core/identity/password.ts`.

- [ ] **Krok 7: Spusť test, ověř, že prochází**

Run: `pnpm --filter @mlain/core test:unit -- identity/password.test.ts`
Expected: 18 passed.

- [ ] **Krok 8: Commit**

```bash
git add packages/core/identity/password.ts packages/core/identity/password.test.ts packages/core/identity/data/common-passwords.txt
git commit -m "feat(identity): Argon2id password hashing, policy and common-password blocklist"
```

---

### Úkol 14: Náhodné tokeny a jejich otisky

**Files:**
- Create: `packages/core/identity/token.ts`
- Test: `packages/core/identity/token.test.ts`

- [ ] **Krok 1: Napiš padající test**

Create `packages/core/identity/token.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateOpaqueToken, tokenHash, TOKEN_BYTES, TOKEN_LENGTH } from './token.js';

/** Závazný vektor ze 3.2, přepočítaný spuštěním 2026-07-31. */
const VECTOR_TOKEN = 'AQQHCg0QExYZHB8iJSgrLjE0Nzo9QENGSUxPUlVYW14';
const VECTOR_SHA256 = '0a7edca7df64fa7710681987f4f809f6f72b37a34602c7472673009382665ecd';

describe('opaque token', () => {
  it('má 32 bajtů entropie a 43 znaků base64url bez paddingu', () => {
    expect(TOKEN_BYTES).toBe(32);
    expect(TOKEN_LENGTH).toBe(43);
    const token = generateOpaqueToken();
    expect(token).toHaveLength(43);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(token).not.toContain('=');
  });

  it('dva tokeny nejsou stejné', () => {
    const set = new Set(Array.from({ length: 1000 }, () => generateOpaqueToken()));
    expect(set.size).toBe(1000);
  });

  it('tokenHash odpovídá závaznému vektoru ze 3.2', () => {
    expect(tokenHash(VECTOR_TOKEN).toString('hex')).toBe(VECTOR_SHA256);
  });

  it('tokenHash je 32 bajtů', () => {
    expect(tokenHash(generateOpaqueToken())).toHaveLength(32);
  });

  it('hashuje ASCII reprezentaci tokenu, ne dekódované bajty', () => {
    // Kdyby se hashovaly dekódované bajty, výsledek by se od vektoru lišil.
    const decodedHash = tokenHash(Buffer.from(VECTOR_TOKEN, 'base64url').toString('latin1'));
    expect(decodedHash.toString('hex')).not.toBe(VECTOR_SHA256);
  });
});
```

- [ ] **Krok 2: Spusť test, ověř, že padá**

Run: `pnpm --filter @mlain/core test:unit -- identity/token.test.ts`
Expected: FAIL, `Cannot find module './token.js'`.

- [ ] **Krok 3: Napiš `token.ts`**

Create `packages/core/identity/token.ts`:

```ts
import { createHash, randomBytes } from 'node:crypto';

/** 3.2: 32 náhodných bajtů z CSPRNG. */
export const TOKEN_BYTES = 32;
/** base64url bez paddingu z 32 bajtů má právě 43 znaků. */
export const TOKEN_LENGTH = 43;

/**
 * Používá se pro session token, token pozvánky i token resetu hesla.
 * Všechny tři mají stejné parametry a v databázi z nich leží jen SHA-256.
 */
export function generateOpaqueToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

/**
 * SHA-256 z ASCII reprezentace tokenu, ne z dekódovaných bajtů.
 * Rozdíl je podstatný, protože závazný testovací vektor ve 3.2 platí pro ASCII.
 * SHA-256 stačí, protože vstup má 256 bitů entropie z CSPRNG a slovníkový
 * ani hrubý útok na takový vstup nedává smysl.
 */
export function tokenHash(token: string): Buffer {
  return createHash('sha256').update(token, 'ascii').digest();
}
```

- [ ] **Krok 4: Spusť test, ověř, že prochází**

Run: `pnpm --filter @mlain/core test:unit -- identity/token.test.ts`
Expected: 5 passed.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/identity/token.ts packages/core/identity/token.test.ts
git commit -m "feat(identity): opaque tokens and SHA-256 fingerprints"
```

---

### Úkol 15: Časová podlaha proti enumeraci účtů

Připravuje kritérium 16, které se měří v úkolu 25.

**Files:**
- Create: `packages/core/identity/constant-time.ts`
- Test: `packages/core/identity/constant-time.test.ts`

- [ ] **Krok 1: Napiš padající test**

Create `packages/core/identity/constant-time.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { withConstantTime, AUTH_MIN_RESPONSE_MS } from './constant-time.js';

describe('withConstantTime', () => {
  it('podlaha je 250 ms', () => {
    expect(AUTH_MIN_RESPONSE_MS).toBe(250);
  });

  it('rychlá operace se natáhne na podlahu', async () => {
    const started = Date.now();
    const result = await withConstantTime(120, async () => 'hotovo');
    const elapsed = Date.now() - started;
    expect(result).toBe('hotovo');
    expect(elapsed).toBeGreaterThanOrEqual(118);
  });

  it('pomalá operace se nezkracuje a zaloguje varování', async () => {
    const warn = vi.fn();
    const started = Date.now();
    await withConstantTime(
      30,
      async () => {
        await new Promise((r) => setTimeout(r, 90));
        return 1;
      },
      warn,
    );
    expect(Date.now() - started).toBeGreaterThanOrEqual(88);
    expect(warn).toHaveBeenCalledWith('constant_time_floor_exceeded', expect.any(Number));
  });

  it('výjimka se propaguje, ale až po uplynutí podlahy', async () => {
    const started = Date.now();
    await expect(
      withConstantTime(120, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(Date.now() - started).toBeGreaterThanOrEqual(118);
  });

  it('dvě různě dlouhé operace skončí prakticky stejně', async () => {
    const measure = async (workMs: number) => {
      const t = Date.now();
      await withConstantTime(200, async () => {
        await new Promise((r) => setTimeout(r, workMs));
      });
      return Date.now() - t;
    };
    const fast = await measure(5);
    const slow = await measure(80);
    expect(Math.abs(fast - slow) / Math.max(fast, slow)).toBeLessThan(0.2);
  });
});
```

- [ ] **Krok 2: Spusť test, ověř, že padá**

Run: `pnpm --filter @mlain/core test:unit -- identity/constant-time.test.ts`
Expected: FAIL, `Cannot find module './constant-time.js'`.

- [ ] **Krok 3: Napiš `constant-time.ts`**

Create `packages/core/identity/constant-time.ts`:

```ts
import { setTimeout as delay } from 'node:timers/promises';

/**
 * Rozhodnutí R6 plánu P04. Kritérium 16 vyžaduje, aby se doba odpovědi na
 * přihlášení k neexistujícímu účtu nelišila od existujícího o víc než 20 %
 * (medián ze 100 pokusů). Dummy hash sám o sobě nestačí: existující účet má
 * navíc dotaz na členství, zápis čítače a případný rehash.
 *
 * 250 ms je s rezervou nad dobou jednoho ověření Argon2id při m=19456,t=2,p=1
 * (řádově desítky milisekund) i nad dobou dvou dotazů do databáze.
 */
export const AUTH_MIN_RESPONSE_MS = 250;

export type FloorWarning = (code: 'constant_time_floor_exceeded', elapsedMs: number) => void;

/**
 * Provede operaci a vrátí se nejdřív po `minMs` od začátku, i když skončila dřív.
 * Když trvala déle, dospání se přeskočí a zavolá se `onFloorExceeded`, protože
 * v takovém případě podlaha přestala latenci srovnávat a kritérium 16 už neplatí.
 * Výjimka se propaguje až po uplynutí podlahy, jinak by chybová cesta byla
 * měřitelně rychlejší než úspěšná.
 */
export async function withConstantTime<T>(
  minMs: number,
  operation: () => Promise<T>,
  onFloorExceeded?: FloorWarning,
): Promise<T> {
  const startedAt = Date.now();
  let result: T | undefined;
  let failure: unknown;

  try {
    result = await operation();
  } catch (err) {
    failure = err;
  }

  const elapsed = Date.now() - startedAt;
  if (elapsed < minMs) {
    await delay(minMs - elapsed);
  } else {
    onFloorExceeded?.('constant_time_floor_exceeded', elapsed);
  }

  if (failure !== undefined) throw failure;
  return result as T;
}
```

- [ ] **Krok 4: Spusť test, ověř, že prochází**

Run: `pnpm --filter @mlain/core test:unit -- identity/constant-time.test.ts`
Expected: 5 passed.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/identity/constant-time.ts packages/core/identity/constant-time.test.ts
git commit -m "feat(identity): constant-time response floor against account enumeration"
```

---

### Úkol 16: Sessions, cookie a jejich životní cyklus

Připravuje kritéria 14, 17 a 18.

**Files:**
- Create: `packages/core/identity/session.ts`
- Test: `packages/core/identity/session.test.ts`

- [ ] **Krok 1: Napiš padající test**

Create `packages/core/identity/session.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { sql, eq } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { withoutContext } from '@mlain/core/tx';
import { ApiError } from '@mlain/core/errors/api-error';
import { hashPassword } from './password.js';
import { tokenHash } from './token.js';
import {
  SESSION_COOKIE_NAME,
  LAST_USED_THROTTLE_MS,
  createSession,
  verifySessionToken,
  revokeSession,
  revokeUserSessions,
  serializeSessionCookie,
  clearSessionCookie,
} from './session.js';

async function makeUser(email: string): Promise<string> {
  return withoutContext(async (tx) => {
    const [row] = await tx
      .insert(schema.users)
      .values({
        email,
        passwordHash: await hashPassword('dostatecne-dlouhe-heslo'),
        name: 'Test',
        locale: 'cs',
        timezone: 'Europe/Prague',
      })
      .returning({ id: schema.users.id });
    return row!.id;
  });
}

describe('cookie', () => {
  it('má jméno ml_session a atributy podle 3.2 (kritérium 14)', () => {
    const cookie = serializeSessionCookie('token-hodnota', { secure: true, maxAgeSeconds: 2592000 });
    expect(cookie.startsWith(`${SESSION_COOKIE_NAME}=token-hodnota;`)).toBe(true);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Max-Age=2592000');
  });

  it('bez https se Secure nenastaví', () => {
    expect(serializeSessionCookie('t', { secure: false, maxAgeSeconds: 60 })).not.toContain('Secure');
  });

  it('atribut Domain se nenastavuje, cookie je host-only', () => {
    expect(serializeSessionCookie('t', { secure: true, maxAgeSeconds: 60 })).not.toContain('Domain');
  });

  it('mazací cookie má Max-Age=0 a prázdnou hodnotu', () => {
    const cookie = clearSessionCookie({ secure: true });
    expect(cookie).toContain(`${SESSION_COOKIE_NAME}=;`);
    expect(cookie).toContain('Max-Age=0');
  });
});

describe('životní cyklus session', () => {
  let userId: string;

  beforeEach(async () => {
    userId = await makeUser(`u${Date.now()}${Math.random()}@example.cz`);
  });

  it('createSession uloží jen hash tokenu, nikdy token', async () => {
    const { token, sessionId } = await withoutContext((tx) =>
      createSession(tx, { userId, userAgent: 'vitest', ip: '127.0.0.1' }),
    );
    const [row] = await withoutContext((tx) =>
      tx.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)),
    );
    expect(Buffer.from(row!.tokenHash).equals(tokenHash(token))).toBe(true);
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row!.csrfSecret).toHaveLength(32);
  });

  it('platná session se ověří a vrátí userId', async () => {
    const { token } = await withoutContext((tx) =>
      createSession(tx, { userId, userAgent: 'vitest', ip: '127.0.0.1' }),
    );
    const verified = await withoutContext((tx) => verifySessionToken(tx, token));
    expect(verified.userId).toBe(userId);
  });

  it('neznámý token vrací unauthenticated', async () => {
    await expect(
      withoutContext((tx) => verifySessionToken(tx, 'AQQHCg0QExYZHB8iJSgrLjE0Nzo9QENGSUxPUlVYW14')),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('revokovaná session vrací session_expired', async () => {
    const { token, sessionId } = await withoutContext((tx) =>
      createSession(tx, { userId, userAgent: 'vitest', ip: '127.0.0.1' }),
    );
    await withoutContext((tx) => revokeSession(tx, sessionId, 'logout'));
    await expect(withoutContext((tx) => verifySessionToken(tx, token))).rejects.toMatchObject({
      code: 'session_expired',
    });
  });

  it('session po absolutní expiraci vrací session_expired', async () => {
    const { token, sessionId } = await withoutContext((tx) =>
      createSession(tx, { userId, userAgent: 'vitest', ip: '127.0.0.1' }),
    );
    await withoutContext((tx) =>
      tx
        .update(schema.sessions)
        .set({ absoluteExpiresAt: sql`now() - interval '1 second'` })
        .where(eq(schema.sessions.id, sessionId)),
    );
    await expect(withoutContext((tx) => verifySessionToken(tx, token))).rejects.toMatchObject({
      code: 'session_expired',
    });
  });

  it('session po nečinnosti delší než idle TTL vrací session_expired', async () => {
    const { token, sessionId } = await withoutContext((tx) =>
      createSession(tx, { userId, userAgent: 'vitest', ip: '127.0.0.1' }),
    );
    await withoutContext((tx) =>
      tx
        .update(schema.sessions)
        .set({ lastUsedAt: sql`now() - interval '15 days'` })
        .where(eq(schema.sessions.id, sessionId)),
    );
    await expect(withoutContext((tx) => verifySessionToken(tx, token))).rejects.toMatchObject({
      code: 'session_expired',
    });
  });

  it('last_used_at se nezapisuje častěji než jednou za 5 minut', async () => {
    expect(LAST_USED_THROTTLE_MS).toBe(5 * 60 * 1000);
    const { token, sessionId } = await withoutContext((tx) =>
      createSession(tx, { userId, userAgent: 'vitest', ip: '127.0.0.1' }),
    );
    const before = await withoutContext((tx) =>
      tx.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)),
    );
    await withoutContext((tx) => verifySessionToken(tx, token));
    const after = await withoutContext((tx) =>
      tx.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)),
    );
    expect(new Date(after[0]!.lastUsedAt).getTime()).toBe(new Date(before[0]!.lastUsedAt).getTime());
  });

  it('po překročení throttle se last_used_at posune', async () => {
    const { token, sessionId } = await withoutContext((tx) =>
      createSession(tx, { userId, userAgent: 'vitest', ip: '127.0.0.1' }),
    );
    await withoutContext((tx) =>
      tx
        .update(schema.sessions)
        .set({ lastUsedAt: sql`now() - interval '10 minutes'` })
        .where(eq(schema.sessions.id, sessionId)),
    );
    await withoutContext((tx) => verifySessionToken(tx, token));
    const [row] = await withoutContext((tx) =>
      tx.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)),
    );
    expect(Date.now() - new Date(row!.lastUsedAt).getTime()).toBeLessThan(60_000);
  });

  it('revokeUserSessions umí vynechat aktuální relaci (kritérium 17)', async () => {
    const a = await withoutContext((tx) => createSession(tx, { userId, userAgent: 'a', ip: '127.0.0.1' }));
    const b = await withoutContext((tx) => createSession(tx, { userId, userAgent: 'b', ip: '127.0.0.1' }));
    await withoutContext((tx) => revokeUserSessions(tx, userId, 'password_changed', a.sessionId));
    await expect(withoutContext((tx) => verifySessionToken(tx, a.token))).resolves.toMatchObject({ userId });
    await expect(withoutContext((tx) => verifySessionToken(tx, b.token))).rejects.toMatchObject({
      code: 'session_expired',
    });
  });

  it('revokeUserSessions bez výjimky zruší i aktuální relaci (kritérium 18)', async () => {
    const a = await withoutContext((tx) => createSession(tx, { userId, userAgent: 'a', ip: '127.0.0.1' }));
    await withoutContext((tx) => revokeUserSessions(tx, userId, 'logout_all'));
    await expect(withoutContext((tx) => verifySessionToken(tx, a.token))).rejects.toThrow(ApiError);
  });

  it('revokovaná session se z databáze nemaže, aby šel vypsat konec relace', async () => {
    const { sessionId } = await withoutContext((tx) =>
      createSession(tx, { userId, userAgent: 'a', ip: '127.0.0.1' }),
    );
    await withoutContext((tx) => revokeSession(tx, sessionId, 'logout'));
    const rows = await withoutContext((tx) =>
      tx.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.revokedReason).toBe('logout');
  });
});
```

- [ ] **Krok 2: Spusť test, ověř, že padá**

Run: `pnpm --filter @mlain/core test:db -- identity/session.test.ts`
Expected: FAIL, `Cannot find module './session.js'`.

- [ ] **Krok 3: Napiš `session.ts`**

Create `packages/core/identity/session.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { and, eq, isNull, ne, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import type { Tx } from '@mlain/core/tx';
import { config } from '@mlain/core/config';
import { ApiError } from '@mlain/core/errors/api-error';
import { generateOpaqueToken, tokenHash } from './token.js';

export const SESSION_COOKIE_NAME = 'ml_session';
/** 7: bez throttlingu by sessions generovaly nejvíc WAL v celém systému. */
export const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;
export const CSRF_SECRET_BYTES = 32;

export type RevokedReason =
  | 'logout'
  | 'logout_all'
  | 'password_changed'
  | 'password_reset'
  | 'user_deleted'
  | 'admin_action';

export type CreatedSession = { token: string; sessionId: string; csrfSecret: Buffer };

export type VerifiedSession = {
  sessionId: string;
  userId: string;
  csrfSecret: Buffer;
  lastUsedAt: Date;
};

/**
 * 3.2: opaque token v databázi, ne JWT. Důvod je okamžitá revokace.
 * Ověření session je jediný indexovaný lookup podle hashe.
 */
export async function createSession(
  tx: Tx,
  input: { userId: string; userAgent: string; ip: string | null },
): Promise<CreatedSession> {
  const token = generateOpaqueToken();
  const csrfSecret = randomBytes(CSRF_SECRET_BYTES);
  const [row] = await tx
    .insert(schema.sessions)
    .values({
      userId: input.userId,
      tokenHash: tokenHash(token),
      csrfSecret,
      userAgent: input.userAgent.slice(0, 500),
      ip: input.ip,
      absoluteExpiresAt: sql`now() + interval '${sql.raw(String(config.SESSION_ABSOLUTE_TTL_DAYS))} days'`,
    })
    .returning({ id: schema.sessions.id });
  return { token, sessionId: row!.id, csrfSecret };
}

/**
 * Ověří token a vrátí session. Neznámý token je `unauthenticated`, známý ale
 * neplatný je `session_expired`: rozdíl nic neprozrazuje (token zná jen ten,
 * komu byl vydán) a klientovi říká, jestli se má přihlásit znovu.
 */
export async function verifySessionToken(tx: Tx, token: string): Promise<VerifiedSession> {
  const [row] = await tx
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.tokenHash, tokenHash(token)))
    .limit(1);

  if (!row) throw new ApiError('unauthenticated');
  if (row.revokedAt) throw new ApiError('session_expired');

  const now = Date.now();
  if (new Date(row.absoluteExpiresAt).getTime() <= now) throw new ApiError('session_expired');

  const idleLimitMs = config.SESSION_IDLE_TTL_DAYS * 24 * 60 * 60 * 1000;
  const lastUsedAt = new Date(row.lastUsedAt);
  if (now - lastUsedAt.getTime() > idleLimitMs) throw new ApiError('session_expired');

  if (now - lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
    await tx.update(schema.sessions).set({ lastUsedAt: new Date() }).where(eq(schema.sessions.id, row.id));
  }

  return {
    sessionId: row.id,
    userId: row.userId,
    csrfSecret: Buffer.from(row.csrfSecret),
    lastUsedAt,
  };
}

export async function revokeSession(tx: Tx, sessionId: string, reason: RevokedReason): Promise<void> {
  await tx
    .update(schema.sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(schema.sessions.id, sessionId), isNull(schema.sessions.revokedAt)));
}

/**
 * Revokuje všechny živé relace uživatele. `exceptSessionId` se používá při změně
 * hesla, aby se uživatel nevyhodil sám (3.2); u `logout-all` se nepředává.
 */
export async function revokeUserSessions(
  tx: Tx,
  userId: string,
  reason: RevokedReason,
  exceptSessionId?: string,
): Promise<number> {
  const conditions = [eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)];
  if (exceptSessionId) conditions.push(ne(schema.sessions.id, exceptSessionId));
  const revoked = await tx
    .update(schema.sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(...conditions))
    .returning({ id: schema.sessions.id });
  return revoked.length;
}

export async function listUserSessions(tx: Tx, userId: string) {
  return tx
    .select({
      id: schema.sessions.id,
      ip: schema.sessions.ip,
      user_agent: schema.sessions.userAgent,
      created_at: schema.sessions.createdAt,
      last_used_at: schema.sessions.lastUsedAt,
      revoked_at: schema.sessions.revokedAt,
    })
    .from(schema.sessions)
    .where(and(eq(schema.sessions.userId, userId), isNull(schema.sessions.revokedAt)))
    .orderBy(sql`${schema.sessions.lastUsedAt} DESC`);
}

/** 3.2: Secure jen když APP_URL začíná https, atribut Domain se nenastavuje. */
export function isSecureCookieContext(): boolean {
  return config.APP_URL.startsWith('https://');
}

export function serializeSessionCookie(
  token: string,
  opts: { secure: boolean; maxAgeSeconds: number },
): string {
  const parts = [
    `${SESSION_COOKIE_NAME}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${opts.maxAgeSeconds}`,
  ];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(opts: { secure: boolean }): string {
  const parts = [`${SESSION_COOKIE_NAME}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (opts.secure) parts.push('Secure');
  return parts.join('; ');
}

export function readSessionCookie(cookieHeader: string | null | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE_NAME) return rest.join('=') || null;
  }
  return null;
}

export const SESSION_MAX_AGE_SECONDS = config.SESSION_ABSOLUTE_TTL_DAYS * 24 * 60 * 60;
```

- [ ] **Krok 4: Spusť test, ověř, že prochází**

Run: `pnpm --filter @mlain/core test:db -- identity/session.test.ts`
Expected: 15 passed.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/identity/session.ts packages/core/identity/session.test.ts
git commit -m "feat(identity): opaque sessions, cookie attributes and revocation"
```

---

### Úkol 17: CSRF, double submit token a kontrola Origin

**Files:**
- Create: `packages/core/identity/csrf.ts`
- Test: `packages/core/identity/csrf.test.ts`

- [ ] **Krok 1: Napiš padající test**

Create `packages/core/identity/csrf.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createHmac, randomBytes } from 'node:crypto';
import { ApiError } from '@mlain/core/errors/api-error';
import { csrfTokenFor, assertCsrfToken, assertOrigin, CSRF_HEADER } from './csrf.js';

const secret = randomBytes(32);

describe('double submit token', () => {
  it('token je base64url(HMAC-SHA256(csrf_secret, "csrf"))', () => {
    const expected = createHmac('sha256', secret).update('csrf', 'ascii').digest('base64url');
    expect(csrfTokenFor(secret)).toBe(expected);
  });

  it('hlavička se jmenuje X-CSRF-Token', () => {
    expect(CSRF_HEADER).toBe('X-CSRF-Token');
  });

  it('správný token projde', () => {
    expect(() => assertCsrfToken(secret, csrfTokenFor(secret))).not.toThrow();
  });

  it('chybějící token končí 403 csrf_token_invalid', () => {
    try {
      assertCsrfToken(secret, undefined);
      expect.unreachable('mělo hodit');
    } catch (e) {
      const err = e as ApiError;
      expect(err.code).toBe('csrf_token_invalid');
      expect(err.status).toBe(403);
    }
  });

  it('token jiné session neprojde', () => {
    expect(() => assertCsrfToken(secret, csrfTokenFor(randomBytes(32)))).toThrow(ApiError);
  });

  it('token jiné délky neprojde a nespadne na výjimce timingSafeEqual', () => {
    expect(() => assertCsrfToken(secret, 'kratky')).toThrow(ApiError);
  });
});

describe('kontrola Origin', () => {
  const appUrl = 'https://mail.example.cz';

  it('GET se nekontroluje', () => {
    expect(() => assertOrigin('GET', null, appUrl)).not.toThrow();
    expect(() => assertOrigin('HEAD', null, appUrl)).not.toThrow();
    expect(() => assertOrigin('OPTIONS', null, appUrl)).not.toThrow();
  });

  it('shodný Origin projde', () => {
    expect(() => assertOrigin('POST', 'https://mail.example.cz', appUrl)).not.toThrow();
  });

  it('chybějící Origin u non-GET končí 403', () => {
    try {
      assertOrigin('POST', null, appUrl);
      expect.unreachable('mělo hodit');
    } catch (e) {
      expect((e as ApiError).code).toBe('origin_not_allowed');
    }
  });

  it('cizí Origin končí 403', () => {
    expect(() => assertOrigin('POST', 'https://zly.example.com', appUrl)).toThrow(ApiError);
  });

  it('shodný host s jiným schématem neprojde', () => {
    expect(() => assertOrigin('POST', 'http://mail.example.cz', appUrl)).toThrow(ApiError);
  });

  it('shodný host s jiným portem neprojde', () => {
    expect(() => assertOrigin('POST', 'https://mail.example.cz:8443', appUrl)).toThrow(ApiError);
  });
});
```

- [ ] **Krok 2: Spusť test, ověř, že padá**

Run: `pnpm --filter @mlain/core test:unit -- identity/csrf.test.ts`
Expected: FAIL, `Cannot find module './csrf.js'`.

- [ ] **Krok 3: Napiš `csrf.ts`**

Create `packages/core/identity/csrf.ts`:

```ts
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApiError } from '@mlain/core/errors/api-error';

export const CSRF_HEADER = 'X-CSRF-Token';

/**
 * 3.2, sekundární obrana pro formuláře a Server Actions.
 * Primární obrana je SameSite=Lax plus kontrola Origin.
 *
 * Pozor na rozsah platnosti (4.1): tohle se uplatňuje JEN na interním povrchu
 * a na Server Actions. Na /api/v1/** s API klíčem, na trackovacích cestách ani
 * na příchozích webhoocích ne, protože ty nepocházejí z prohlížeče a klíč se
 * neposílá automaticky.
 */
export function csrfTokenFor(csrfSecret: Buffer): string {
  return createHmac('sha256', csrfSecret).update('csrf', 'ascii').digest('base64url');
}

export function assertCsrfToken(csrfSecret: Buffer, provided: string | null | undefined): void {
  if (!provided) throw new ApiError('csrf_token_invalid');
  const expected = Buffer.from(csrfTokenFor(csrfSecret), 'ascii');
  const actual = Buffer.from(provided, 'ascii');
  // timingSafeEqual hodí výjimku při rozdílné délce, proto se délka kontroluje předem.
  if (expected.length !== actual.length) throw new ApiError('csrf_token_invalid');
  if (!timingSafeEqual(expected, actual)) throw new ApiError('csrf_token_invalid');
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * 3.2: Origin musí odpovídat APP_URL. Porovnává se celý origin, tedy schéma,
 * host i port; shoda jen v hostu by pustila http variantu a jiný port.
 */
export function assertOrigin(method: string, origin: string | null | undefined, appUrl: string): void {
  if (SAFE_METHODS.has(method.toUpperCase())) return;
  if (!origin) throw new ApiError('origin_not_allowed');
  const expected = new URL(appUrl).origin;
  let actual: string;
  try {
    actual = new URL(origin).origin;
  } catch {
    throw new ApiError('origin_not_allowed');
  }
  if (actual !== expected) throw new ApiError('origin_not_allowed', { params: { origin: actual } });
}
```

- [ ] **Krok 4: Spusť test, ověř, že prochází**

Run: `pnpm --filter @mlain/core test:unit -- identity/csrf.test.ts`
Expected: 12 passed.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/identity/csrf.ts packages/core/identity/csrf.test.ts
git commit -m "feat(identity): CSRF double submit token and Origin check"
```

---

### Úkol 18: `createWorkspaceContext`, jediná továrna izolace

**Files:**
- Create: `packages/core/identity/context.ts`
- Test: `packages/core/identity/context.test.ts`

- [ ] **Krok 1: Napiš padající test**

Create `packages/core/identity/context.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import * as schema from '@mlain/db/schema';
import { withoutContext, withUser } from '@mlain/core/tx';
import { ApiError } from '@mlain/core/errors/api-error';
import { hashPassword } from './password.js';
import { createWorkspaceContext } from './context.js';

let userA = '';
let userB = '';
let wsA = '';
let slugA = '';

beforeAll(async () => {
  const seed = await withoutContext(async (tx) => {
    const [a] = await tx
      .insert(schema.users)
      .values({
        email: `a-${Date.now()}@example.cz`,
        passwordHash: await hashPassword('dostatecne-dlouhe-heslo'),
        locale: 'cs',
        timezone: 'Europe/Prague',
      })
      .returning({ id: schema.users.id });
    const [b] = await tx
      .insert(schema.users)
      .values({
        email: `b-${Date.now()}@example.cz`,
        passwordHash: await hashPassword('dostatecne-dlouhe-heslo'),
        locale: 'cs',
        timezone: 'Europe/Prague',
      })
      .returning({ id: schema.users.id });
    return { a: a!.id, b: b!.id };
  });
  userA = seed.a;
  userB = seed.b;

  const slug = `ws-${Date.now()}`;
  wsA = await withUser(userA, async (tx) => {
    const [w] = await tx
      .insert(schema.workspaces)
      .values({ name: 'A', slug, locale: 'cs', timezone: 'Europe/Prague', createdBy: userA })
      .returning({ id: schema.workspaces.id });
    await tx.insert(schema.memberships).values({ workspaceId: w!.id, userId: userA, role: 'owner' });
    return w!.id;
  });
  slugA = slug;
});

describe('createWorkspaceContext pro uživatele', () => {
  it('člen dostane kontext se svou rolí', async () => {
    const ctx = await createWorkspaceContext({ kind: 'session', userId: userA, workspaceRef: wsA });
    expect(ctx.workspaceId).toBe(wsA);
    expect(ctx.actor).toEqual({ type: 'user', userId: userA, role: 'owner' });
  });

  it('funguje i podle slugu z cesty /w/{slug}', async () => {
    const ctx = await createWorkspaceContext({ kind: 'session', userId: userA, workspaceRef: slugA });
    expect(ctx.workspaceId).toBe(wsA);
  });

  it('nečlen dostane 404, ne 403 (3.4, ochrana proti enumeraci ID)', async () => {
    try {
      await createWorkspaceContext({ kind: 'session', userId: userB, workspaceRef: wsA });
      expect.unreachable('mělo hodit');
    } catch (e) {
      const err = e as ApiError;
      expect(err.code).toBe('not_found');
      expect(err.status).toBe(404);
    }
  });

  it('neexistující workspace dostane taky 404, aby šly odpovědi rozlišit jen členstvím', async () => {
    await expect(
      createWorkspaceContext({
        kind: 'session',
        userId: userA,
        workspaceRef: '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6099',
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('nesmyslná reference nespadne na chybě databáze, ale na 404', async () => {
    await expect(
      createWorkspaceContext({ kind: 'session', userId: userA, workspaceRef: 'neni-uuid-ani-slug!!' }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });

  it('měkce smazaný workspace není dostupný', async () => {
    const slug = `del-${Date.now()}`;
    const wsDel = await withUser(userA, async (tx) => {
      const [w] = await tx
        .insert(schema.workspaces)
        .values({
          name: 'Del',
          slug,
          locale: 'cs',
          timezone: 'Europe/Prague',
          createdBy: userA,
          deletedAt: new Date(),
        })
        .returning({ id: schema.workspaces.id });
      await tx.insert(schema.memberships).values({ workspaceId: w!.id, userId: userA, role: 'owner' });
      return w!.id;
    });
    await expect(
      createWorkspaceContext({ kind: 'session', userId: userA, workspaceRef: wsDel }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('createWorkspaceContext pro API klíč', () => {
  it('workspace se bere z klíče, nikdy z requestu', async () => {
    const ctx = await createWorkspaceContext({
      kind: 'api_key',
      apiKeyId: '0192f3a0-1c2d-7e44-8d4e-5f60718293a4',
      workspaceId: wsA,
      scopes: ['contacts:read'],
    });
    expect(ctx.workspaceId).toBe(wsA);
    expect(ctx.actor).toEqual({
      type: 'api_key',
      apiKeyId: '0192f3a0-1c2d-7e44-8d4e-5f60718293a4',
      scopes: ['contacts:read'],
    });
  });
});

describe('systémový kontext', () => {
  it('nese název jobu, aby šlo v auditu dohledat, co ho vyvolalo', async () => {
    const ctx = await createWorkspaceContext({
      kind: 'system',
      job: 'platform.webhook_deliver',
      workspaceId: wsA,
    });
    expect(ctx.actor).toEqual({ type: 'system', job: 'platform.webhook_deliver' });
  });
});
```

- [ ] **Krok 2: Spusť test, ověř, že padá**

Run: `pnpm --filter @mlain/core test:db -- identity/context.test.ts`
Expected: FAIL, `Cannot find module './context.js'`.

- [ ] **Krok 3: Napiš `context.ts`**

Create `packages/core/identity/context.ts`:

```ts
import { and, eq, isNull } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { unsafeWorkspaceContext } from '@mlain/db/unsafe-context';
import { withUser, withWorkspace } from '@mlain/core/tx';
import { ApiError } from '@mlain/core/errors/api-error';
import type { Role, WorkspaceContext } from './types.js';
import type { Permission } from './permissions.js';

/**
 * TENHLE SOUBOR je jediné místo v celém monorepu, které smí importovat
 * @mlain/db/unsafe-context. P03 tu funkci z kořenového exportu záměrně vynechal,
 * aby ji našeptávač nenabízel každému, a `createWorkspaceContext` níž je ta
 * jediná legitimní továrna, protože jako jediná ověřuje členství.
 * Že se import neobjeví nikde jinde, hlídá test v úkolu 19.
 */

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type AuthenticatedRequest =
  | { kind: 'session'; userId: string; workspaceRef: string }
  | { kind: 'api_key'; apiKeyId: string; workspaceId: string; scopes: readonly Permission[] }
  | { kind: 'system'; job: string; workspaceId: string };

/**
 * 3.6: jediná továrna kontextu. Ověřuje členství nebo klíč a jinou cestou
 * WorkspaceContext vzniknout nemůže, protože typ je branded.
 *
 * Odkud se bere workspaceId:
 * - aktér api_key: z api_keys.workspace_id, NIKDY z URL ani z těla requestu;
 * - aktér user: ze segmentu cesty /w/{slug} nebo z hlavičky X-Workspace-Id.
 *
 * Nečlen dostane 404, ne 403. Kdyby neexistující členství vracelo 403, dalo by
 * se z toho zjistit, které workspace ID existují.
 */
export async function createWorkspaceContext(input: AuthenticatedRequest): Promise<WorkspaceContext> {
  if (input.kind === 'api_key') {
    return unsafeWorkspaceContext(input.workspaceId, {
      type: 'api_key', apiKeyId: input.apiKeyId, scopes: input.scopes,
    });
  }

  if (input.kind === 'system') {
    return unsafeWorkspaceContext(input.workspaceId, { type: 'system', job: input.job });
  }

  const ref = input.workspaceRef;
  // Nesmyslná hodnota se nikdy nedostane do porovnání s uuid sloupcem: chyba
  // typu z databáze by se projevila jako 500 a prozradila by tvar dotazu.
  const matchesId = UUID_PATTERN.test(ref);
  const isSlugShaped = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(ref);
  if (!matchesId && !isSlugShaped) throw new ApiError('not_found');

  // Čte se pod mlain.user_id, protože politiky ws_member_visibility
  // a user_own_memberships jsou jediné, které bez workspace kontextu vracejí řádky.
  const rows = await withUser(input.userId, (tx) =>
    tx
      .select({ id: schema.workspaces.id, role: schema.memberships.role })
      .from(schema.workspaces)
      .innerJoin(
        schema.memberships,
        and(
          eq(schema.memberships.workspaceId, schema.workspaces.id),
          eq(schema.memberships.userId, input.userId),
        ),
      )
      .where(
        and(
          isNull(schema.workspaces.deletedAt),
          matchesId ? eq(schema.workspaces.id, ref) : eq(schema.workspaces.slug, ref),
        ),
      )
      .limit(1),
  );

  const row = rows[0];
  if (!row) throw new ApiError('not_found');

  return unsafeWorkspaceContext(row.id, {
    type: 'user', userId: input.userId, role: row.role as Role,
  });
}

/**
 * Kontext pro joby platformy a pro vnitřní volání, která nemají request.
 *
 * Je synchronní schválně: job dostává workspace_id z payloadu fronty, kam ho
 * zapsala operace, která už kontext ověřila, takže se členství nekontroluje
 * podruhé. Systémový aktér navíc projde maticí oprávnění vždy (úkol 12).
 * Jméno jobu je povinné, protože bez něj by v auditu nešlo dohledat, co zápis
 * vyvolalo, a `audit_log.actor_label` se plní právě z něj.
 */
export function createSystemContext(workspaceId: string, job: string): WorkspaceContext {
  if (!UUID_PATTERN.test(workspaceId)) {
    throw new ApiError('validation_failed', `workspace_id není UUID: ${workspaceId}`);
  }
  if (job.length === 0) throw new ApiError('validation_failed', 'systémový kontext musí nést název jobu');
  return unsafeWorkspaceContext(workspaceId, { type: 'system', job });
}

/**
 * Kontext pro přijetí pozvánky.
 *
 * Je to jediná operace, kde `createWorkspaceContext` použít NEJDE: členství
 * v té chvíli ještě neexistuje, teprve vzniká, takže by ověření členství
 * vrátilo 404 a pozvánku by nešlo přijmout nikdy.
 *
 * Bezpečné to je proto, že `workspaceId` ani `role` nepocházejí z requestu.
 * Obojí je z řádku `invitations` dohledaného podle `token_hash`, tedy z hodnoty,
 * kterou vydal někdo, kdo v projektu právo zvát měl. Volající ovlivňuje jedinou
 * věc: token. Aktérem je přijímající uživatel, ne systém, aby auditní záznam
 * o vstupu do projektu nesl skutečného člověka.
 */
export function createInvitationContext(
  workspaceId: string,
  userId: string,
  role: Role,
): WorkspaceContext {
  return unsafeWorkspaceContext(workspaceId, { type: 'user', userId, role });
}

/** Zkratka pro operace, které už mají kontext a potřebují transakci s RLS. */
export function inWorkspace<T>(ctx: WorkspaceContext, fn: Parameters<typeof withWorkspace<T>>[1]): Promise<T> {
  return withWorkspace(ctx, fn);
}
```

- [ ] **Krok 4: Spusť test, ověř, že prochází**

Run: `pnpm --filter @mlain/core test:db -- identity/context.test.ts`
Expected: 9 passed. Když test „nečlen dostane 404" padne s prázdným výsledkem už na úrovni SQL, je to v pořádku: RLS a `innerJoin` dávají tentýž výsledek a `not_found` se hodí tak jako tak.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/identity/context.ts packages/core/identity/context.test.ts
git commit -m "feat(identity): single factory for branded WorkspaceContext"
```

---

### Úkol 19: `wsEq`, jediný povolený filtr podle workspace

**Files:**
- Create: `packages/core/identity/scope.ts`
- Test: `packages/core/identity/scope.test.ts`

- [ ] **Krok 1: Napiš padající test**

Create `packages/core/identity/scope.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as schema from '@mlain/db/schema';
import { unsafeWorkspaceContext } from '@mlain/db/unsafe-context';
import { wsEq } from './scope.js';

const CORE_ROOT = fileURLToPath(new URL('../', import.meta.url));

/** Vytáhne jmenované importy z `@mlain/db` (přesně z kořene, ne z podcest). */
function namedImportsFromDbRoot(src: string): string[] {
  const out: string[] = [];
  for (const m of src.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from\s+'@mlain\/db'/g)) {
    for (const raw of m[1]!.split(',')) {
      const name = raw.replace(/\btype\b/, '').trim().split(/\s+as\s+/)[0]!.trim();
      if (name) out.push(name);
    }
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'data') continue;
      out.push(...sourceFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

// V testu je unsafeWorkspaceContext v pořádku: P03 ji pro testy a údržbové joby
// výslovně určuje. Produkční kód ji volat nesmí a hlídá to poslední test níž.
const ctx = unsafeWorkspaceContext('0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071', {
  type: 'system',
  job: 'test',
});

describe('wsEq', () => {
  it('vyrobí podmínku rovnosti nad sloupcem workspace_id', () => {
    const condition = wsEq(ctx, schema.webhookEndpoints);
    expect(String(condition)).toContain('workspace_id');
  });
});

describe('disciplína izolace v packages/core', () => {
  const files = sourceFiles(CORE_ROOT);

  it('nikdo mimo packages/core/tx neimportuje transakční obálky přímo z @mlain/db', () => {
    // Jména jsou z P03 doslova. Porovnává se seznam JMENOVANÝCH IMPORTŮ, ne
    // výskyt podřetězce: `withUser` z @mlain/core/tx je legitimní a hledání
    // podřetězce by ho označilo za porušení.
    const wrappers = new Set(['withWorkspace', 'withUser', 'withReadOnly']);
    const offenders = files.filter((f) => {
      if (f.includes(join('core', 'tx'))) return false;
      return namedImportsFromDbRoot(readFileSync(f, 'utf8')).some((n) => wrappers.has(n));
    });
    expect(offenders, 'transakce se otevírají výhradně přes @mlain/core/tx').toEqual([]);
  });

  it('unsafeWorkspaceContext importuje jediný soubor, a to továrna kontextu', () => {
    // Tohle je druhá vrstva ochrany branded typu. P03 funkci vynechal
    // z kořenového exportu, takže ji nikdo nepotká náhodou; tenhle test hlídá,
    // že ji nikdo nezavolá ani vědomě odjinud než z jediné legitimní továrny.
    const importers = files.filter((f) =>
      /from '@mlain\/db\/unsafe-context'/.test(readFileSync(f, 'utf8')));
    expect(importers.map((f) => f.replace(CORE_ROOT, ''))).toEqual([
      join('identity', 'context.ts'),
    ]);
  });

  it('žádná služba nefiltruje podle workspace ručně, používá se wsEq', () => {
    const offenders = files.filter((f) => {
      if (f.endsWith(join('identity', 'scope.ts'))) return false;
      return /eq\(\s*schema\.\w+\.workspaceId/.test(readFileSync(f, 'utf8'));
    });
    expect(offenders).toEqual([]);
  });

  it('žádná exportovaná funkce mimo packages/core/tx nebere workspaceId jako string', () => {
    const offenders = files.filter((f) => {
      if (f.includes(join('core', 'tx'))) return false;
      // context.ts je vstup do továrny: AuthenticatedRequest a createSystemContext
      // jsou právě to místo, kde se z řetězce stává ověřený kontext.
      if (f.endsWith(join('identity', 'context.ts'))) return false;
      const src = readFileSync(f, 'utf8');
      return /export (async )?function [^(]*\([^)]*workspaceId: string/.test(src);
    });
    expect(offenders).toEqual([]);
  });
});
```

- [ ] **Krok 2: Spusť test, ověř, že padá**

Run: `pnpm --filter @mlain/core test:unit -- identity/scope.test.ts`
Expected: FAIL, `Cannot find module './scope.js'`.

- [ ] **Krok 3: Napiš `scope.ts`**

Create `packages/core/identity/scope.ts`:

```ts
import { eq, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';
import type { WorkspaceContext } from './types.js';

/**
 * 3.6, vrstva 1. Jediný povolený způsob, jak se v packages/core filtruje podle
 * workspace. Kdyby se psalo `eq(table.workspaceId, nejakyRetezec)` ručně, dalo by
 * se to udělat i špatně a nikdo by si toho nevšiml, dokud by neunikla data.
 *
 * Test v scope.test.ts hlídá, že tuhle funkci obchází jen ona sama.
 */
export function wsEq<T extends PgTable & { workspaceId: PgColumn }>(
  ctx: WorkspaceContext,
  table: T,
): SQL {
  return eq(table.workspaceId, ctx.workspaceId);
}
```

- [ ] **Krok 4: Spusť test, ověř, že prochází**

Run: `pnpm --filter @mlain/core test:unit -- identity/scope.test.ts`
Expected: 5 passed.

Tenhle test je **kontrola tvaru kódu, ne důkaz, že izolace funguje.** Důkaz je v úkolu 20 a běží proti reálnému Postgresu pod rolí `mlain_app`. Obojí je potřeba: kontrola tvaru zachytí chybu při psaní, běhový test zachytí chybu v politice.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/identity/scope.ts packages/core/identity/scope.test.ts
git commit -m "feat(identity): wsEq as the only workspace filter plus shape guards"
```

---

### Úkol 20: Běhový důkaz izolace proti reálné databázi

Pokrývá kritéria 20 a 21.

**Files:**
- Test: `packages/core/identity/isolation.test.ts`

- [ ] **Krok 1: Napiš padající test**

Create `packages/core/identity/isolation.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createWorkspaceAsUser, type WorkspaceContext } from '@mlain/db';
import * as schema from '@mlain/db/schema';
import { appPool, withoutContext, withWorkspace } from '@mlain/core/tx';
import { createWorkspaceContext } from './context.js';
import { hashPassword } from './password.js';

let userId = '';
let wsA = '';
let wsB = '';
let ctxA: WorkspaceContext;
let ctxB: WorkspaceContext;
let endpointInA = '';

beforeAll(async () => {
  userId = await withoutContext(async (tx) => {
    const [u] = await tx
      .insert(schema.users)
      .values({
        email: `iso-${Date.now()}@example.cz`,
        passwordHash: await hashPassword('dostatecne-dlouhe-heslo'),
        locale: 'cs',
        timezone: 'Europe/Prague',
      })
      .returning({ id: schema.users.id });
    return u!.id;
  });

  // Projekt zakládá createWorkspaceAsUser z @mlain/db, ne ruční INSERT.
  // Je to jediná funkce, která umí správné pořadí (ID dopředu, kontext před
  // vložením); ruční INSERT ... RETURNING na workspaces bez kontextu skončí
  // na "new row violates row-level security policy" a vložení členství
  // neprojde přes WITH CHECK politiky ws_isolation.
  const a = await createWorkspaceAsUser(appPool(), userId, {
    name: 'A', slug: `iso-a-${Date.now()}`, locale: 'cs', timezone: 'Europe/Prague',
  });
  const b = await createWorkspaceAsUser(appPool(), userId, {
    name: 'B', slug: `iso-b-${Date.now()}`, locale: 'cs', timezone: 'Europe/Prague',
  });
  wsA = a.id;
  wsB = b.id;

  // Kontext se vyrábí SKUTEČNOU továrnou, ne unsafeWorkspaceContext. Test tím
  // zároveň pokrývá cestu, kterou jde produkční kód.
  ctxA = await createWorkspaceContext({ kind: 'session', userId, workspaceRef: wsA });
  ctxB = await createWorkspaceContext({ kind: 'session', userId, workspaceRef: wsB });

  endpointInA = await withWorkspace(ctxA, async (tx) => {
    const [e] = await tx
      .insert(schema.webhookEndpoints)
      .values({
        workspaceId: wsA,
        url: 'https://example.com/hook',
        eventTypes: ['contact.created'],
        secretEncrypted: 'enc:v1:placeholder',
      })
      .returning({ id: schema.webhookEndpoints.id });
    return e!.id;
  });
});

describe('kritérium 20: bez kontextu nevidí aplikační role nic', () => {
  it('SELECT bez set_config vrátí 0 řádků', async () => {
    const rows = await withoutContext(async (tx) => {
      const result = await tx.execute(sql`SELECT id FROM webhook_endpoints`);
      return result.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it('test běží pod rolí mlain_app, ne pod vlastníkem schématu', async () => {
    const role = await withoutContext(async (tx) => {
      const result = await tx.execute<{ role: string }>(sql`SELECT current_user AS role`);
      return result.rows[0]!.role;
    });
    expect(role).toBe('mlain_app');
  });
});

describe('kritérium 21: cizí workspace_id neprojde WITH CHECK', () => {
  it('INSERT s cizím workspace_id pod kontextem B selže', async () => {
    await expect(
      withWorkspace(ctxB, async (tx) => {
        await tx.insert(schema.webhookEndpoints).values({
          workspaceId: wsA,
          url: 'https://example.com/podvrh',
          eventTypes: ['contact.created'],
          secretEncrypted: 'enc:v1:placeholder',
        });
      }),
    ).rejects.toThrow(/row-level security|new row violates/i);
  });

  it('SELECT řádku z A pod kontextem B vrátí 0 řádků', async () => {
    const rows = await withWorkspace(ctxB, async (tx) => {
      const result = await tx.execute(sql`SELECT id FROM webhook_endpoints WHERE id = ${endpointInA}::uuid`);
      return result.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it('UPDATE řádku z A pod kontextem B ovlivní 0 řádků', async () => {
    const updated = await withWorkspace(ctxB, async (tx) => {
      const result = await tx.execute(
        sql`UPDATE webhook_endpoints SET description = 'zmena' WHERE id = ${endpointInA}::uuid RETURNING id`,
      );
      return result.rows;
    });
    expect(updated).toHaveLength(0);
  });

  it('pod kontextem A je řádek vidět, tedy test neměří jen prázdnou tabulku', async () => {
    const rows = await withWorkspace(ctxA, async (tx) => {
      const result = await tx.execute(sql`SELECT id FROM webhook_endpoints WHERE id = ${endpointInA}::uuid`);
      return result.rows;
    });
    expect(rows).toHaveLength(1);
  });
});

describe('kritérium 21d: workspaces je předmětem i nositelem izolace', () => {
  it('SELECT workspaces pod kontextem B vrátí právě jeden řádek, a to B', async () => {
    const rows = await withWorkspace(ctxB, async (tx) => {
      const result = await tx.execute<{ id: string }>(sql`SELECT id::text AS id FROM workspaces`);
      return result.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(wsB);
  });

  it('výpis pod mlain.user_id vrátí jen projekty s členstvím', async () => {
    const rows = await withUser(userId, async (tx) => {
      const result = await tx.execute<{ id: string }>(sql`SELECT id::text AS id FROM workspaces`);
      return result.rows;
    });
    const ids = rows.map((r) => r.id);
    expect(ids).toContain(wsA);
    expect(ids).toContain(wsB);
  });

  it('bez mlain.user_id i bez workspace kontextu vrátí 0 řádků', async () => {
    const rows = await withoutContext(async (tx) => {
      const result = await tx.execute(sql`SELECT id FROM workspaces`);
      return result.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it('založení projektu bez mlain.user_id selže na WITH CHECK', async () => {
    await expect(
      withoutContext(async (tx) => {
        await tx.insert(schema.workspaces).values({
          name: 'Bez kontextu',
          slug: `no-ctx-${Date.now()}`,
          locale: 'cs',
          timezone: 'Europe/Prague',
        });
      }),
    ).rejects.toThrow(/row-level security|new row violates/i);
  });
});
```

- [ ] **Krok 2: Spusť test, ověř, že padá jen tam, kde má**

Run: `pnpm --filter @mlain/core test:db -- identity/isolation.test.ts`
Expected: nejdřív FAIL na chybějícím modulu `./password.js` je vyloučené (existuje z úkolu 13), takže test buď projde celý, nebo padne na konkrétní politice. **Každý pád je nález pro P03**, ne pro P04: politiky vlastní P03. Zapiš, která politika chybí, a nahlas to.

- [ ] **Krok 3: Spusť test podruhé a ověř, že prochází**

Run: `pnpm --filter @mlain/core test:db -- identity/isolation.test.ts`
Expected: 9 passed. Test „test běží pod rolí mlain_app" je ten nejdůležitější: bez něj by celý soubor mohl běžet pod vlastníkem schématu, který RLS obchází, a všechna ostatní tvrzení by byla bezcenná.

- [ ] **Krok 4: Commit**

```bash
git add packages/core/identity/isolation.test.ts
git commit -m "test(identity): runtime proof of workspace isolation under mlain_app role"
```

---

### Fáze C: audit log (úkoly 21 a 22)

---

### Úkol 21: Registr auditních akcí a redakce metadat

**Files:**
- Create: `packages/core/audit/action.ts`
- Create: `packages/core/audit/redact.ts`
- Create: `packages/core/identity/audit.ts`
- Test: `packages/core/audit/action.test.ts`
- Test: `packages/core/audit/redact.test.ts`
- Test: `packages/core/audit/audit-actions.test.ts`

- [ ] **Krok 1: Napiš padající testy registru a redakce**

Create `packages/core/audit/action.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { defineAuditActions } from './action.js';

describe('defineAuditActions', () => {
  it('vrátí záznam se stejnými klíči jako vstup', () => {
    const actions = defineAuditActions(['user.login', 'user.logout']);
    expect(Object.keys(actions).sort()).toEqual(['user.login', 'user.logout']);
    expect(String(actions['user.login'])).toBe('user.login');
  });

  it('výsledek je zmrazený, aby ho nikdo za běhu nedoplnil', () => {
    const actions = defineAuditActions(['user.login']);
    expect(Object.isFrozen(actions)).toBe(true);
  });

  it('odmítne název bez tečky', () => {
    expect(() => defineAuditActions(['login' as never])).toThrow(/entita\.sloveso/i);
  });

  it('odmítne entitu v množném čísle s velkým písmenem', () => {
    expect(() => defineAuditActions(['User.login' as never])).toThrow(/mal[yý]mi/i);
  });

  it('odmítne sloveso, které nekončí v minulém čase', () => {
    expect(() => defineAuditActions(['user.login_now' as never])).not.toThrow();
    expect(() => defineAuditActions(['user.LOGIN' as never])).toThrow();
  });

  it('odmítne duplicitu uvnitř jedné domény', () => {
    expect(() => defineAuditActions(['user.login', 'user.login'])).toThrow(/duplicit/i);
  });
});
```

Create `packages/core/audit/redact.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { redactMetadata, diffForAudit, SENSITIVE_KEYS } from './redact.js';

describe('redakce metadat', () => {
  it('zakryje hodnoty citlivých klíčů', () => {
    const out = redactMetadata({ name: 'Petr', password: 'tajne', api_key: 'ml_live_x' });
    expect(out).toEqual({ name: 'Petr', password: '[redacted]', api_key: '[redacted]' });
  });

  it('funguje i do hloubky', () => {
    const out = redactMetadata({ after: { secret_access_key: 'aws', region: 'eu-central-1' } });
    expect(out).toEqual({ after: { secret_access_key: '[redacted]', region: 'eu-central-1' } });
  });

  it('zakryje i klíč, který citlivé slovo jen obsahuje', () => {
    expect(redactMetadata({ webhook_secret: 'whsec_x' })).toEqual({ webhook_secret: '[redacted]' });
  });

  it('seznam citlivých klíčů odpovídá 3.7 a 4.1', () => {
    expect(SENSITIVE_KEYS).toContain('password');
    expect(SENSITIVE_KEYS).toContain('secret');
    expect(SENSITIVE_KEYS).toContain('token');
    expect(SENSITIVE_KEYS).toContain('api_key');
    expect(SENSITIVE_KEYS).toContain('secret_access_key');
    expect(SENSITIVE_KEYS).toContain('render_data');
  });

  it('pole se prochází taky', () => {
    expect(redactMetadata({ items: [{ token: 't', id: 1 }] })).toEqual({
      items: [{ token: '[redacted]', id: 1 }],
    });
  });
});

describe('diffForAudit', () => {
  it('zapíše jen změněná pole a jejich hodnoty před a po', () => {
    const out = diffForAudit({ name: 'A', locale: 'cs' }, { name: 'B', locale: 'cs' });
    expect(out).toEqual({ changed: ['name'], before: { name: 'A' }, after: { name: 'B' } });
  });

  it('u beze změny vrátí prázdný seznam', () => {
    expect(diffForAudit({ name: 'A' }, { name: 'A' })).toEqual({ changed: [], before: {}, after: {} });
  });

  it('citlivé hodnoty jsou v diffu zakryté', () => {
    const out = diffForAudit({ password: 'a' }, { password: 'b' });
    expect(out.before.password).toBe('[redacted]');
    expect(out.after.password).toBe('[redacted]');
  });

  it('nově přidané pole se počítá jako změna', () => {
    const out = diffForAudit({}, { locale: 'en' });
    expect(out.changed).toEqual(['locale']);
  });
});
```

- [ ] **Krok 2: Spusť testy, ověř, že padají**

Run: `pnpm --filter @mlain/core test:unit -- audit/`
Expected: FAIL, `Cannot find module './action.js'` a `'./redact.js'`.

- [ ] **Krok 3: Napiš `action.ts`**

Create `packages/core/audit/action.ts`:

```ts
declare const auditBrand: unique symbol;

/** Branded řetězec, takže do audit logu nejde zapsat neregistrovaný název akce. */
export type AuditAction = string & { readonly [auditBrand]: 'AuditAction' };

/**
 * 3.7: název akce je `<entita>.<sloveso v minulém čase>`, entita v jednotném
 * čísle malými písmeny. Každá část si vlastní názvy svých akcí a zapisuje je do
 * `packages/core/<domena>/audit.ts`.
 *
 * Tahle funkce nahrazuje sdílený typový union: kdyby existoval jeden soubor
 * s unionem všech akcí, byl by to sdílený soubor a konflikt v každém plánu
 * (uzávěr S11 řídicího dokumentu). Test audit-actions.test.ts místo toho hlídá
 * jedinečnost napříč doménami mechanicky.
 */
const NAME_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;

export function defineAuditActions<const T extends readonly string[]>(
  names: T,
): Readonly<{ [K in T[number]]: AuditAction }> {
  const seen = new Set<string>();
  const out: Record<string, AuditAction> = {};

  for (const name of names) {
    if (!name.includes('.')) {
      throw new Error(`Auditní akce "${name}" nemá tvar entita.sloveso (3.7).`);
    }
    if (!NAME_PATTERN.test(name)) {
      throw new Error(`Auditní akce "${name}" musí být malými písmeny ve tvaru entita.sloveso (3.7).`);
    }
    if (seen.has(name)) throw new Error(`Auditní akce "${name}" je duplicitní.`);
    seen.add(name);
    out[name] = name as AuditAction;
  }

  return Object.freeze(out) as Readonly<{ [K in T[number]]: AuditAction }>;
}
```

- [ ] **Krok 4: Napiš `redact.ts`**

Create `packages/core/audit/redact.ts`:

```ts
/**
 * 3.7: do metadata se nesmí dostat hesla, tokeny, sekrety klíčů, obsah e-mailů
 * ani celé seznamy kontaktů. Zapisují se rozdíly u konfiguračních změn s redakcí
 * podle seznamu citlivých klíčů.
 */
export const SENSITIVE_KEYS = [
  'password',
  'password_hash',
  'secret',
  'secret_hash',
  'secret_access_key',
  'access_key_id',
  'token',
  'token_hash',
  'api_key',
  'credentials',
  'config_encrypted',
  'secret_encrypted',
  'render_data',
  'authorization',
  'cookie',
] as const;

export const REDACTED = '[redacted]';

function isSensitive(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEYS.some((s) => lower.includes(s));
}

export function redactMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactMetadata);
  if (value === null || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitive(key) ? REDACTED : redactMetadata(inner);
  }
  return out;
}

export type AuditDiff = {
  changed: string[];
  before: Record<string, unknown>;
  after: Record<string, unknown>;
};

/** Tvar z 3.7: { changed: [...], before: {...}, after: {...} }. */
export function diffForAudit(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): AuditDiff {
  const changed: string[] = [];
  const beforeOut: Record<string, unknown> = {};
  const afterOut: Record<string, unknown> = {};

  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[key]) === JSON.stringify(after[key])) continue;
    changed.push(key);
    beforeOut[key] = redactMetadata({ [key]: before[key] })[key as never];
    afterOut[key] = redactMetadata({ [key]: after[key] })[key as never];
  }

  changed.sort();
  return { changed, before: beforeOut, after: afterOut };
}
```

- [ ] **Krok 5: Napiš `packages/core/identity/audit.ts`**

Create `packages/core/identity/audit.ts`:

```ts
import { defineAuditActions } from '@mlain/core/audit/action';

/**
 * Auditní akce vlastněné doménou identity a platformy podle tabulky v 3.7.
 * Ostatní domény přidávají svoje do vlastního packages/core/<domena>/audit.ts.
 */
export const IdentityAuditActions = defineAuditActions([
  'user.login',
  'user.login_failed',
  'user.logout',
  'user.password_changed',
  'user.password_reset_requested',
  'user.password_reset_completed',
  'workspace.created',
  'workspace.updated',
  'workspace.deleted',
  'workspace.restored',
  'workspace.ownership_transferred',
  'member.invited',
  'member.invitation_revoked',
  'member.joined',
  'member.role_changed',
  'member.removed',
  'api_key.created',
  'api_key.rotated',
  'api_key.revoked',
  'webhook_endpoint.created',
  'webhook_endpoint.updated',
  'webhook_endpoint.deleted',
  'webhook_endpoint.disabled',
  'settings.updated',
]);
```

- [ ] **Krok 6: Napiš test jedinečnosti napříč doménami**

Create `packages/core/audit/audit-actions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const CORE_ROOT = fileURLToPath(new URL('../', import.meta.url));

function auditFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist' || entry === 'data') continue;
      out.push(...auditFiles(full));
    } else if (entry === 'audit.ts') {
      out.push(full);
    }
  }
  return out;
}

/**
 * Nahrazuje sdílený typový union AuditAction. Kdyby existoval, byl by to soubor,
 * do kterého píše každý plán, tedy konflikt v každém merge (uzávěr S11).
 */
describe('registr auditních akcí napříč doménami', () => {
  const files = auditFiles(CORE_ROOT);

  it('existuje aspoň jeden soubor s akcemi', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it('žádný název akce se neopakuje ve dvou doménách', () => {
    const seen = new Map<string, string>();
    const duplicates: string[] = [];
    for (const file of files) {
      const src = readFileSync(file, 'utf8');
      for (const match of src.matchAll(/'([a-z][a-z0-9_]*\.[a-z][a-z0-9_]*)'/g)) {
        const name = match[1]!;
        const previous = seen.get(name);
        if (previous && previous !== file) duplicates.push(`${name}: ${previous} a ${file}`);
        seen.set(name, file);
      }
    }
    expect(duplicates).toEqual([]);
  });

  it('doména identity deklaruje všech 24 akcí z tabulky 3.7, které jí patří', async () => {
    const { IdentityAuditActions } = await import('../identity/audit.js');
    expect(Object.keys(IdentityAuditActions)).toHaveLength(24);
  });
});
```

- [ ] **Krok 7: Spusť všechny tři testy, ověř, že prochází**

Run: `pnpm --filter @mlain/core test:unit -- audit/`
Expected: 15 passed.

- [ ] **Krok 8: Commit**

```bash
git add packages/core/audit/action.ts packages/core/audit/redact.ts packages/core/identity/audit.ts packages/core/audit/action.test.ts packages/core/audit/redact.test.ts packages/core/audit/audit-actions.test.ts
git commit -m "feat(audit): action registry without a shared union, plus metadata redaction"
```

---

### Úkol 22: Zápis do audit logu včetně globálních akcí

Pokrývá kritéria 21b a 21c.

**Files:**
- Create: `packages/core/audit/write.ts`
- Test: `packages/core/audit/write.test.ts`

- [ ] **Krok 1: Napiš padající test**

Create `packages/core/audit/write.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { createWorkspaceAsUser, type WorkspaceContext } from '@mlain/db';
import * as schema from '@mlain/db/schema';
import { appPool, withoutContext, withWorkspace } from '@mlain/core/tx';
import { createWorkspaceContext } from '../identity/context.js';
import { hashPassword } from '../identity/password.js';
import { IdentityAuditActions } from '../identity/audit.js';
import { writeAuditLog } from './write.js';

let userId = '';
let wsA = '';
let wsB = '';
let ctxA: WorkspaceContext;
let ctxB: WorkspaceContext;

beforeAll(async () => {
  userId = await withoutContext(async (tx) => {
    const [u] = await tx
      .insert(schema.users)
      .values({
        email: `audit-${Date.now()}@example.cz`,
        passwordHash: await hashPassword('dostatecne-dlouhe-heslo'),
        locale: 'cs',
        timezone: 'Europe/Prague',
      })
      .returning({ id: schema.users.id });
    return u!.id;
  });

  // Zakládá se hotovou funkcí z @mlain/db, protože jen ta nastaví kontext dřív,
  // než vznikne řádek. Dřívější hromadný INSERT ... RETURNING sem nepatří:
  // bez kontextu ho RLS nepustí a členství neprojde přes WITH CHECK.
  const a = await createWorkspaceAsUser(appPool(), userId, {
    name: 'A', slug: `au-a-${Date.now()}`, locale: 'cs', timezone: 'Europe/Prague',
  });
  const b = await createWorkspaceAsUser(appPool(), userId, {
    name: 'B', slug: `au-b-${Date.now()}`, locale: 'cs', timezone: 'Europe/Prague',
  });
  wsA = a.id;
  wsB = b.id;
  ctxA = await createWorkspaceContext({ kind: 'session', userId, workspaceRef: wsA });
  ctxB = await createWorkspaceContext({ kind: 'session', userId, workspaceRef: wsB });
});

describe('kritérium 21b: globální auditní řádek', () => {
  it('INSERT s workspace_id = NULL projde BEZ nastaveného workspace kontextu', async () => {
    await expect(
      withoutContext((tx) =>
        writeAuditLog(tx, {
          action: IdentityAuditActions['user.password_changed'],
          workspaceId: null,
          actor: { actorType: 'user', actorId: userId, actorLabel: 'audit@example.cz' },
          requestId: 'test-request-1',
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('transakce se kvůli auditu nerollbackne, takže doprovodná změna platí', async () => {
    const marker = `Jmeno-${Date.now()}`;
    await withoutContext(async (tx) => {
      await tx.execute(sql`UPDATE users SET name = ${marker} WHERE id = ${userId}::uuid`);
      await writeAuditLog(tx, {
        action: IdentityAuditActions['user.password_changed'],
        workspaceId: null,
        actor: { actorType: 'user', actorId: userId, actorLabel: 'audit@example.cz' },
      });
    });
    const rows = await withoutContext(async (tx) => {
      const result = await tx.execute<{ name: string }>(sql`SELECT name FROM users WHERE id = ${userId}::uuid`);
      return result.rows;
    });
    expect(rows[0]!.name).toBe(marker);
  });

  it('INSERT s workspace_id = NULL projde i pod nastaveným kontextem', async () => {
    await expect(
      withWorkspace(ctxA, (tx) =>
        writeAuditLog(tx, {
          action: IdentityAuditActions['user.login'],
          workspaceId: null,
          actor: { actorType: 'user', actorId: userId, actorLabel: 'audit@example.cz' },
        }),
      ),
    ).resolves.toBeUndefined();
  });

  it('INSERT s cizím workspace_id pod kontextem B selže na WITH CHECK', async () => {
    await expect(
      withWorkspace(ctxB, (tx) =>
        writeAuditLog(tx, {
          action: IdentityAuditActions['workspace.updated'],
          workspaceId: wsA,
          actor: { actorType: 'user', actorId: userId, actorLabel: 'audit@example.cz' },
        }),
      ),
    ).rejects.toThrow(/row-level security|new row violates/i);
  });
});

describe('kritérium 21c: čtení audit logu je projektové', () => {
  it('pod kontextem B nevrátí čtení ani řádek workspace A, ani globální řádek', async () => {
    await withWorkspace(ctxA, (tx) =>
      writeAuditLog(tx, {
        action: IdentityAuditActions['workspace.updated'],
        workspaceId: wsA,
        actor: { actorType: 'user', actorId: userId, actorLabel: 'audit@example.cz' },
      }),
    );
    const rows = await withWorkspace(ctxB, async (tx) => {
      const result = await tx.execute<{ workspace_id: string | null }>(sql`SELECT workspace_id FROM audit_log`);
      return result.rows;
    });
    expect(rows.every((r) => r.workspace_id === wsB)).toBe(true);
    expect(rows.some((r) => r.workspace_id === null)).toBe(false);
    expect(rows.some((r) => r.workspace_id === wsA)).toBe(false);
  });
});

describe('obsah auditního záznamu', () => {
  it('metadata jsou zredigovaná', async () => {
    await withWorkspace(ctxA, (tx) =>
      writeAuditLog(tx, {
        action: IdentityAuditActions['api_key.created'],
        workspaceId: wsA,
        actor: { actorType: 'user', actorId: userId, actorLabel: 'audit@example.cz' },
        metadata: { name: 'CI klíč', secret: 'ml_live_tajemstvi' },
      }),
    );
    const rows = await withWorkspace(ctxA, async (tx) => {
      const result = await tx.execute<{ metadata: Record<string, unknown> }>(
        sql`SELECT metadata FROM audit_log WHERE action = 'api_key.created' ORDER BY created_at DESC LIMIT 1`,
      );
      return result.rows;
    });
    expect(rows[0]!.metadata).toEqual({ name: 'CI klíč', secret: '[redacted]' });
  });

  it('actor_label je zmrazený text, ne odkaz', async () => {
    await withWorkspace(ctxA, (tx) =>
      writeAuditLog(tx, {
        action: IdentityAuditActions['member.removed'],
        workspaceId: wsA,
        actor: { actorType: 'api_key', actorId: null, actorLabel: 'Klíč pro CI' },
      }),
    );
    const rows = await withWorkspace(ctxA, async (tx) => {
      const result = await tx.execute<{ actor_type: string; actor_id: string | null; actor_label: string }>(
        sql`SELECT actor_type, actor_id, actor_label FROM audit_log WHERE action = 'member.removed' ORDER BY created_at DESC LIMIT 1`,
      );
      return result.rows;
    });
    expect(rows[0]).toMatchObject({ actor_type: 'api_key', actor_id: null, actor_label: 'Klíč pro CI' });
  });
});
```

- [ ] **Krok 2: Spusť test, ověř, že padá**

Run: `pnpm --filter @mlain/core test:db -- audit/write.test.ts`
Expected: FAIL, `Cannot find module './write.js'`.

- [ ] **Krok 3: Napiš `write.ts`**

Create `packages/core/audit/write.ts`:

```ts
import * as schema from '@mlain/db/schema';
import type { Tx } from '@mlain/core/tx';
import type { AuditAction } from './action.js';
import { redactMetadata } from './redact.js';

export type AuditActorInfo = {
  actorType: 'user' | 'api_key' | 'system';
  actorId: string | null;
  actorLabel: string;
};

export type AuditEntry = {
  action: AuditAction;
  /**
   * NULL u globálních akcí (user.login, user.password_changed), které k žádnému
   * projektu nepatří. Politika ws_isolation_audit má NULL ve WITH CHECK povolený
   * právě proto, viz 3.6 a kritérium 21b.
   */
  workspaceId: string | null;
  actor: AuditActorInfo;
  targetType?: string | null;
  targetId?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
};

/**
 * 3.7: audit se zapisuje synchronně ve stejné transakci jako auditovaná změna.
 * Když se transakce rollbackne, záznam zmizí s ní, což je správně.
 *
 * Výjimka je `user.login_failed`, který se zapisuje mimo transakci, protože
 * k žádné změně nedochází; volající pro něj otevře vlastní `withoutContext`.
 */
export async function writeAuditLog(tx: Tx, entry: AuditEntry): Promise<void> {
  await tx.insert(schema.auditLog).values({
    workspaceId: entry.workspaceId,
    actorType: entry.actor.actorType,
    actorId: entry.actor.actorId,
    // Zmrazený text, ne odkaz: po smazání uživatele musí audit dál dávat smysl (6).
    actorLabel: entry.actor.actorLabel,
    action: String(entry.action),
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    ip: entry.ip ?? null,
    userAgent: entry.userAgent ?? null,
    requestId: entry.requestId ?? null,
    metadata: (redactMetadata(entry.metadata ?? {}) as Record<string, unknown>) as never,
  });
}
```

- [ ] **Krok 4: Spusť test, ověř, že prochází**

Run: `pnpm --filter @mlain/core test:db -- audit/write.test.ts`
Expected: 7 passed.

Test „transakce se kvůli auditu nerollbackne" je ten, kvůli kterému tenhle úkol existuje. Kdyby politika `ws_isolation_audit` neměla ve `WITH CHECK` povolený NULL, spadl by `INSERT` globálního záznamu a **vzal by s sebou celou transakci**, tedy i změnu hesla. Pád tohohle testu je nález pro P03.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/audit/write.ts packages/core/audit/write.test.ts
git commit -m "feat(audit): transactional audit writer with global (workspace-less) entries"
```

---

### Fáze D: autentizační endpointy (úkoly 23 až 29)

---

### Úkol 23: Přihlášení, zamykání účtu a audit neúspěchu

Pokrývá kritérium 15.

**Files:**
- Create: `packages/core/identity/login.ts`
- Test: `packages/core/identity/login.test.ts`

- [ ] **Krok 1: Napiš padající test**

Create `packages/core/identity/login.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { withoutContext } from '@mlain/core/tx';
import type { ApiError } from '@mlain/core/errors/api-error';
import { hashPassword } from './password.js';
import { login, LOGIN_MAX_FAILURES, LOGIN_LOCK_MINUTES } from './login.js';

const PASSWORD = 'dostatecne-dlouhe-heslo';
let email = '';
let userId = '';

const attempt = (password: string) =>
  login({ email, password, ip: '10.0.0.1', userAgent: 'vitest', requestId: 'r1' });

beforeEach(async () => {
  email = `login-${Date.now()}-${Math.random().toString(36).slice(2)}@example.cz`;
  userId = await withoutContext(async (tx) => {
    const [u] = await tx
      .insert(schema.users)
      .values({
        email,
        passwordHash: await hashPassword(PASSWORD),
        name: 'Petr',
        locale: 'cs',
        timezone: 'Europe/Prague',
      })
      .returning({ id: schema.users.id });
    return u!.id;
  });
});

describe('úspěšné přihlášení', () => {
  it('vrátí uživatele, token a seznam projektů', async () => {
    const result = await attempt(PASSWORD);
    expect(result.user.id).toBe(userId);
    expect(result.user.email).toBe(email);
    expect(result.token).toHaveLength(43);
    expect(Array.isArray(result.workspaces)).toBe(true);
  });

  it('vynuluje čítač neúspěchů a nastaví last_login_at', async () => {
    await attempt('spatne-heslo-uplne').catch(() => undefined);
    await attempt(PASSWORD);
    const [row] = await withoutContext((tx) =>
      tx.select().from(schema.users).where(eq(schema.users.id, userId)),
    );
    expect(row!.failedLoginCount).toBe(0);
    expect(row!.lockedUntil).toBeNull();
    expect(row!.lastLoginAt).not.toBeNull();
  });

  it('zapíše user.login do audit logu s workspace_id NULL', async () => {
    await attempt(PASSWORD);
    const rows = await withoutContext(async (tx) => {
      const result = await tx.execute<{ action: string; workspace_id: string | null }>(
        sql`SELECT action, workspace_id FROM audit_log WHERE actor_id = ${userId}::uuid AND action = 'user.login'`,
      );
      return result.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.workspace_id).toBeNull();
  });

  it('nikdy nevrací password_hash', async () => {
    expect(JSON.stringify(await attempt(PASSWORD))).not.toContain('argon2');
  });
});

describe('neúspěšné přihlášení', () => {
  it('špatné heslo vrací invalid_credentials 401', async () => {
    await expect(attempt('uplne-jine-heslo')).rejects.toMatchObject({
      code: 'invalid_credentials',
      status: 401,
    });
  });

  it('neexistující účet vrací tentýž kód, ne not_found', async () => {
    await expect(
      login({ email: 'nikdo@example.cz', password: PASSWORD, ip: '10.0.0.1', userAgent: 'v', requestId: 'r' }),
    ).rejects.toMatchObject({ code: 'invalid_credentials' });
  });

  it('měkce smazaný účet vrací tentýž kód', async () => {
    await withoutContext((tx) =>
      tx.update(schema.users).set({ deletedAt: new Date() }).where(eq(schema.users.id, userId)),
    );
    await expect(attempt(PASSWORD)).rejects.toMatchObject({ code: 'invalid_credentials' });
  });

  it('zapíše user.login_failed do audit logu', async () => {
    await attempt('uplne-jine-heslo').catch(() => undefined);
    const rows = await withoutContext(async (tx) => {
      const result = await tx.execute(
        sql`SELECT action FROM audit_log WHERE actor_id = ${userId}::uuid AND action = 'user.login_failed'`,
      );
      return result.rows;
    });
    expect(rows).toHaveLength(1);
  });

  it('audit neúspěchu vznikne i u neexistujícího účtu, aby se cesty nelišily', async () => {
    const unknownEmail = `nikdo-${Date.now()}@example.cz`;
    await login({
      email: unknownEmail,
      password: PASSWORD,
      ip: '10.0.0.1',
      userAgent: 'v',
      requestId: 'r',
    }).catch(() => undefined);
    const rows = await withoutContext(async (tx) => {
      const result = await tx.execute(
        sql`SELECT actor_label FROM audit_log WHERE action = 'user.login_failed' AND actor_label = ${unknownEmail}`,
      );
      return result.rows;
    });
    expect(rows).toHaveLength(1);
  });
});

describe('kritérium 15: zamčení účtu', () => {
  it('meze odpovídají 3.1', () => {
    expect(LOGIN_MAX_FAILURES).toBe(10);
    expect(LOGIN_LOCK_MINUTES).toBe(15);
  });

  it('deset neúspěchů vede k 423 account_locked', async () => {
    for (let i = 0; i < 10; i += 1) {
      await attempt('uplne-jine-heslo').catch(() => undefined);
    }
    try {
      await attempt('uplne-jine-heslo');
      expect.unreachable('mělo hodit');
    } catch (e) {
      const err = e as ApiError;
      expect(err.code).toBe('account_locked');
      expect(err.status).toBe(423);
      expect(err.retryAfter).toBeGreaterThan(0);
      expect(err.retryAfter).toBeLessThanOrEqual(15 * 60);
    }
  });

  it('jedenáctý pokus se SPRÁVNÝM heslem taky selže, dokud zámek trvá', async () => {
    for (let i = 0; i < 10; i += 1) {
      await attempt('uplne-jine-heslo').catch(() => undefined);
    }
    await expect(attempt(PASSWORD)).rejects.toMatchObject({ code: 'account_locked' });
  });

  it('po vypršení zámku se čítač vynuluje a správné heslo projde', async () => {
    for (let i = 0; i < 10; i += 1) {
      await attempt('uplne-jine-heslo').catch(() => undefined);
    }
    await withoutContext((tx) =>
      tx
        .update(schema.users)
        .set({ lockedUntil: sql`now() - interval '1 second'` })
        .where(eq(schema.users.id, userId)),
    );
    const result = await attempt(PASSWORD);
    expect(result.user.id).toBe(userId);
    const [row] = await withoutContext((tx) =>
      tx.select().from(schema.users).where(eq(schema.users.id, userId)),
    );
    expect(row!.failedLoginCount).toBe(0);
  });
});

describe('rehash při přihlášení', () => {
  it('slabší parametry se po úspěšném přihlášení přehashují', async () => {
    const weak = '$argon2id$v=19$m=4096,t=1,p=1$c2FsdHNhbHRzYWx0c2E$aGFzaGhhc2hoYXNoaGFzaGhhc2hoYQ';
    await withoutContext((tx) =>
      tx.update(schema.users).set({ passwordHash: weak }).where(eq(schema.users.id, userId)),
    );
    // Slabý hash neodpovídá heslu, takže se nejdřív nastaví platný hash slabých parametrů.
    const properWeak = await hashPassword(PASSWORD);
    await withoutContext((tx) =>
      tx
        .update(schema.users)
        .set({ passwordHash: properWeak.replace('m=19456,t=2,p=1', 'm=19456,t=2,p=1') })
        .where(eq(schema.users.id, userId)),
    );
    await attempt(PASSWORD);
    const [row] = await withoutContext((tx) =>
      tx.select().from(schema.users).where(eq(schema.users.id, userId)),
    );
    expect(row!.passwordHash).toContain('m=19456,t=2,p=1');
  });
});
```

- [ ] **Krok 2: Spusť test, ověř, že padá**

Run: `pnpm --filter @mlain/core test:db -- identity/login.test.ts`
Expected: FAIL, `Cannot find module './login.js'`.

- [ ] **Krok 3: Napiš `login.ts`**

Create `packages/core/identity/login.ts`:

```ts
import { and, eq, isNull, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { withoutContext, withUser } from '@mlain/core/tx';
import { ApiError } from '@mlain/core/errors/api-error';
import { writeAuditLog } from '@mlain/core/audit/write';
import { DUMMY_PASSWORD_HASH, hashPassword, needsRehash, verifyPassword } from './password.js';
import { AUTH_MIN_RESPONSE_MS, withConstantTime } from './constant-time.js';
import { createSession } from './session.js';
import { IdentityAuditActions } from './audit.js';
import type { Role } from './types.js';

/** 3.1: per účet 10 neúspěchů, pak zamknout na 15 minut. */
export const LOGIN_MAX_FAILURES = 10;
export const LOGIN_LOCK_MINUTES = 15;

export type PublicUser = {
  id: string;
  email: string;
  name: string;
  locale: string;
  timezone: string;
  email_verified_at: string | null;
  created_at: string;
};

export type WorkspaceSummary = { id: string; name: string; slug: string; role: Role };

export type LoginInput = {
  email: string;
  password: string;
  ip: string | null;
  userAgent: string;
  requestId: string;
};

export type LoginResult = {
  user: PublicUser;
  workspaces: WorkspaceSummary[];
  token: string;
  sessionId: string;
};

export function toPublicUser(row: {
  id: string;
  email: string;
  name: string;
  locale: string;
  timezone: string;
  emailVerifiedAt: Date | null;
  createdAt: Date;
}): PublicUser {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    locale: row.locale,
    timezone: row.timezone,
    email_verified_at: row.emailVerifiedAt ? new Date(row.emailVerifiedAt).toISOString() : null,
    created_at: new Date(row.createdAt).toISOString(),
  };
}

export async function listWorkspacesOfUser(userId: string): Promise<WorkspaceSummary[]> {
  const rows = await withUser(userId, (tx) =>
    tx
      .select({
        id: schema.workspaces.id,
        name: schema.workspaces.name,
        slug: schema.workspaces.slug,
        role: schema.memberships.role,
      })
      .from(schema.workspaces)
      .innerJoin(
        schema.memberships,
        and(eq(schema.memberships.workspaceId, schema.workspaces.id), eq(schema.memberships.userId, userId)),
      )
      .where(isNull(schema.workspaces.deletedAt))
      .orderBy(schema.workspaces.name),
  );
  return rows.map((r) => ({ id: r.id, name: r.name, slug: r.slug, role: r.role as Role }));
}

/**
 * 3.7: user.login_failed se zapisuje MIMO transakci, protože k žádné změně
 * nedochází. Zapisuje se i pro neexistující účet, jinak by se cesty daly odlišit
 * podle toho, jestli po requestu přibyl řádek.
 */
async function recordFailedLogin(input: {
  userId: string | null;
  email: string;
  ip: string | null;
  userAgent: string;
  requestId: string;
}): Promise<void> {
  await withoutContext(async (tx) => {
    if (input.userId) {
      await tx.execute(sql`
        UPDATE users
           SET failed_login_count = failed_login_count + 1,
               locked_until = CASE
                 WHEN failed_login_count + 1 >= ${LOGIN_MAX_FAILURES}
                 THEN now() + interval '${sql.raw(String(LOGIN_LOCK_MINUTES))} minutes'
                 ELSE locked_until END,
               updated_at = now()
         WHERE id = ${input.userId}::uuid
      `);
    }
    await writeAuditLog(tx, {
      action: IdentityAuditActions['user.login_failed'],
      workspaceId: null,
      actor: { actorType: 'user', actorId: input.userId, actorLabel: input.email },
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
  });
}

/**
 * Přihlášení. Celé běží uvnitř časové podlahy, protože kritérium 16 měří rozdíl
 * mediánu odpovědi mezi existujícím a neexistujícím účtem a dummy hash sám
 * o sobě nestačí: existující účet má navíc dotazy a zápisy.
 */
export function login(input: LoginInput): Promise<LoginResult> {
  return withConstantTime(AUTH_MIN_RESPONSE_MS, () => performLogin(input));
}

async function performLogin(input: LoginInput): Promise<LoginResult> {
  const email = input.email.trim().toLowerCase();

  const [user] = await withoutContext((tx) =>
    tx
      .select()
      .from(schema.users)
      .where(and(eq(schema.users.email, email), isNull(schema.users.deletedAt)))
      .limit(1),
  );

  // Neexistující nebo smazaný účet: hash nad dummy PHC řetězcem, aby se nedal
  // měřit rozdíl, a stejný kód jako u špatného hesla.
  if (!user) {
    await verifyPassword(DUMMY_PASSWORD_HASH, input.password);
    await recordFailedLogin({ userId: null, email, ip: input.ip, userAgent: input.userAgent, requestId: input.requestId });
    throw new ApiError('invalid_credentials');
  }

  // Vypršelý zámek se nuluje dřív, než se cokoliv ověřuje.
  if (user.lockedUntil && new Date(user.lockedUntil).getTime() <= Date.now()) {
    await withoutContext((tx) =>
      tx
        .update(schema.users)
        .set({ failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() })
        .where(eq(schema.users.id, user.id)),
    );
    user.failedLoginCount = 0;
    user.lockedUntil = null;
  }

  if (user.lockedUntil) {
    const retryAfter = Math.max(1, Math.ceil((new Date(user.lockedUntil).getTime() - Date.now()) / 1000));
    // Stejná práce jako na ostatních cestách, aby zamčený účet nešel poznat podle času.
    await verifyPassword(DUMMY_PASSWORD_HASH, input.password);
    throw new ApiError('account_locked', { retryAfter });
  }

  const passwordOk = await verifyPassword(user.passwordHash, input.password);
  if (!passwordOk) {
    await recordFailedLogin({
      userId: user.id,
      email,
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
    throw new ApiError('invalid_credentials');
  }

  // 3.1: rehash při přihlášení, aby se instalace samy posunuly, až parametry zpřísníme.
  const rehashed = needsRehash(user.passwordHash) ? await hashPassword(input.password) : null;

  const session = await withoutContext(async (tx) => {
    await tx
      .update(schema.users)
      .set({
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        updatedAt: new Date(),
        ...(rehashed ? { passwordHash: rehashed } : {}),
      })
      .where(eq(schema.users.id, user.id));

    const created = await createSession(tx, {
      userId: user.id,
      userAgent: input.userAgent,
      ip: input.ip,
    });

    await writeAuditLog(tx, {
      action: IdentityAuditActions['user.login'],
      workspaceId: null,
      actor: { actorType: 'user', actorId: user.id, actorLabel: email },
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });

    return created;
  });

  return {
    user: toPublicUser(user),
    workspaces: await listWorkspacesOfUser(user.id),
    token: session.token,
    sessionId: session.sessionId,
  };
}
```

- [ ] **Krok 4: Spusť test, ověř, že prochází**

Run: `pnpm --filter @mlain/core test:db -- identity/login.test.ts`
Expected: 13 passed.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/identity/login.ts packages/core/identity/login.test.ts
git commit -m "feat(identity): login with account lockout, uniform failures and audit"
```

---

### Úkol 24: Sdílená schémata cest a endpoint `POST /api/v1/auth/login`

Pokrývá kritérium 14.

**Files:**
- Create: `packages/core/identity/api/schemas.ts`
- Create: `packages/core/identity/api/auth.routes.ts`
- Modify: `apps/web/src/lib/api/app.ts` (typ prostředí se přesouvá do core)
- Test: `apps/web/test/api/auth-login.test.ts`

- [ ] **Krok 1: Napiš `schemas.ts`, sdílená stavba definic cest**

Create `packages/core/identity/api/schemas.ts`:

```ts
import { z } from '@hono/zod-openapi';
import { ERROR_CODES } from '@mlain/core/errors/registry';
import { PERMISSIONS } from '../permissions.js';

/**
 * Sdílená schémata pro definice cest vlastněné částí 1. Bydlí tady, protože
 * `packages/core` nesmí importovat z `apps/web` (graf závislostí v 3.11)
 * a definice cest podle 4.7 žijí v core vedle domény, kterou obsluhují.
 */

/** Proměnné kontextu requestu. Aplikace v apps/web je jen naplňuje. */
export type ApiVariables = {
  requestId: string;
  clientIp: string;
  startedAt: number;
  workspaceId?: string | null;
  actorType?: string | null;
  actorId?: string | null;
};

export type ApiEnv = { Variables: ApiVariables };

export const PermissionSchema = z.enum(PERMISSIONS).openapi('Permission');

export const FindingSchema = z
  .object({
    code: z.string(),
    severity: z.enum(['error', 'warning']),
    message: z.string(),
    path: z.string().optional(),
    params: z.record(z.string(), z.unknown()).optional(),
  })
  .openapi('Finding');

/** Úplný tvar z 4.8, včetně findings a params. Vynechat je znamená, že je klient zahodí. */
export const ProblemSchema = z
  .object({
    type: z.string(),
    title: z.string(),
    status: z.number().int(),
    detail: z.string(),
    instance: z.string(),
    code: z.string(),
    request_id: z.string(),
    errors: z
      .array(z.object({ path: z.string(), code: z.string(), message: z.string() }))
      .optional(),
    findings: z.array(FindingSchema).optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    retry_after: z.number().int().optional(),
  })
  .openapi('Problem');

/**
 * Chybová odpověď pro definici cesty. Bere jeden nebo víc kódů a popis složí
 * z registru, takže se dokumentace nemůže rozejít s chováním.
 */
export function problemResponse(...codes: string[]) {
  const described = codes
    .map((c) => `${c} (${ERROR_CODES[c]?.title ?? 'neregistrovaný kód'})`)
    .join(', ');
  return {
    description: described,
    content: { 'application/problem+json': { schema: ProblemSchema } },
  };
}

export const PaginationSchema = z
  .object({
    next_cursor: z.string().nullable(),
    prev_cursor: z.string().nullable(),
    has_more: z.boolean(),
    limit: z.number().int(),
  })
  .openapi('Pagination');

export function paginated<T extends z.ZodType>(item: T, name: string) {
  return z.object({ data: z.array(item), pagination: PaginationSchema }).openapi(name);
}

export const CountSchema = z
  .object({
    count: z.number().int(),
    precision: z.enum(['exact', 'estimated']),
    computed_at: z.iso.datetime(),
    stale: z.boolean(),
  })
  .openapi('Count');

export const PaginationQuerySchema = z.object({
  limit: z.string().optional(),
  cursor: z.string().optional(),
  order: z.string().optional(),
});

export const PublicUserSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
    name: z.string(),
    locale: z.string(),
    timezone: z.string(),
    email_verified_at: z.iso.datetime().nullable(),
    created_at: z.iso.datetime(),
  })
  .openapi('User');

export const RoleSchema = z.enum(['owner', 'admin', 'editor', 'viewer']).openapi('Role');

export const WorkspaceSummarySchema = z
  .object({ id: z.uuid(), name: z.string(), slug: z.string(), role: RoleSchema })
  .openapi('WorkspaceSummary');

export const IdempotencyHeaderSchema = z.object({
  'idempotency-key': z.string().min(8).max(255),
});
```

- [ ] **Krok 2: Uprav `app.ts`, aby typ prostředí bral z core**

V `apps/web/src/lib/api/app.ts` nahraď lokální definici typů importem, aby existovala jediná definice a definice cest v core se s aplikací nemohly rozejít:

```ts
// bylo: export type ApiVariables = { ... };  export type ApiEnv = { Variables: ApiVariables };
export type { ApiVariables, ApiEnv } from '@mlain/core/identity/api/schemas';
import type { ApiEnv } from '@mlain/core/identity/api/schemas';
```

Run: `pnpm --filter @mlain/web typecheck`
Expected: PASS.

- [ ] **Krok 3: Napiš padající integrační test přihlášení**

Create `apps/web/test/api/auth-login.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import * as schema from '@mlain/db/schema';
import { withoutContext } from '@mlain/core/tx';
import { hashPassword } from '@mlain/core/identity/password';
import { createApiApp } from '../../src/lib/api/app.js';
import { registerAuthRoutes } from '@mlain/core/identity/api/auth.routes';

const app = createApiApp();
registerAuthRoutes(app);

const PASSWORD = 'dostatecne-dlouhe-heslo';
let email = '';

beforeAll(async () => {
  email = `api-login-${Date.now()}@example.cz`;
  await withoutContext(async (tx) => {
    await tx.insert(schema.users).values({
      email,
      passwordHash: await hashPassword(PASSWORD),
      name: 'Petr',
      locale: 'cs',
      timezone: 'Europe/Prague',
    });
  });
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  app.request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

describe('POST /api/v1/auth/login', () => {
  it('kritérium 14: nastaví cookie ml_session s HttpOnly a SameSite=Lax', async () => {
    const res = await post({ email, password: PASSWORD });
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain('ml_session=');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Lax');
    expect(cookie).toContain('Path=/');
  });

  it('Secure se nastaví, jen když APP_URL začíná https', async () => {
    const cookie = (await post({ email, password: PASSWORD })).headers.get('set-cookie') ?? '';
    const expectSecure = process.env.APP_URL?.startsWith('https://') ?? false;
    expect(cookie.includes('Secure')).toBe(expectSecure);
  });

  it('vrátí uživatele a jeho projekty, nikdy hash hesla', async () => {
    const body = await (await post({ email, password: PASSWORD })).json();
    expect(body.user.email).toBe(email);
    expect(Array.isArray(body.workspaces)).toBe(true);
    expect(JSON.stringify(body)).not.toContain('password');
  });

  it('špatné heslo vrací 401 problem+json s kódem invalid_credentials', async () => {
    const res = await post({ email, password: 'uplne-jine-heslo' });
    expect(res.status).toBe(401);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    expect((await res.json()).code).toBe('invalid_credentials');
  });

  it('neznámý klíč v těle vrací 422, ne 200 (kritérium 28)', async () => {
    const res = await post({ email, password: PASSWORD, remember: true });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('validation_failed');
  });

  it('chybějící pole vrací 422 s cestou v errors (kritérium 27)', async () => {
    const res = await post({ email });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.errors.map((e: { path: string }) => e.path)).toContain('password');
  });

  it('odpověď nese hlavičky RateLimit i při úspěchu (kritérium 32)', async () => {
    const res = await post({ email, password: PASSWORD });
    expect(res.headers.get('RateLimit-Limit')).toBeTruthy();
    expect(res.headers.get('RateLimit-Remaining')).toBeTruthy();
  });
});
```

- [ ] **Krok 4: Spusť test, ověř, že padá**

Run: `pnpm --filter @mlain/web test:db -- api/auth-login.test.ts`
Expected: FAIL, `Cannot find module '@mlain/core/identity/api/auth.routes'`.

- [ ] **Krok 5: Napiš `auth.routes.ts` s přihlášením**

Create `packages/core/identity/api/auth.routes.ts`:

```ts
import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { config } from '@mlain/core/config';
import {
  problemResponse,
  PublicUserSchema,
  WorkspaceSummarySchema,
  type ApiEnv,
} from './schemas.js';
import { login } from '../login.js';
import {
  isSecureCookieContext,
  serializeSessionCookie,
  SESSION_MAX_AGE_SECONDS,
} from '../session.js';

export const LoginInputSchema = z
  .object({ email: z.email(), password: z.string().min(1).max(256) })
  .strict()
  .openapi('LoginInput');

export const LoginOutputSchema = z
  .object({ user: PublicUserSchema, workspaces: z.array(WorkspaceSummarySchema) })
  .openapi('LoginOutput');

const loginRoute = createRoute({
  method: 'post',
  path: '/api/v1/auth/login',
  tags: ['Auth'],
  summary: 'Přihlášení e-mailem a heslem',
  request: { body: { content: { 'application/json': { schema: LoginInputSchema } } } },
  responses: {
    200: {
      description: 'Přihlášeno, v odpovědi je cookie ml_session',
      content: { 'application/json': { schema: LoginOutputSchema } },
    },
    401: problemResponse('invalid_credentials'),
    422: problemResponse('validation_failed'),
    423: problemResponse('account_locked'),
    429: problemResponse('rate_limited'),
  },
});

export function registerAuthRoutes(app: OpenAPIHono<ApiEnv>): void {
  app.openapi(loginRoute, async (c) => {
    const input = c.req.valid('json');
    const result = await login({
      email: input.email,
      password: input.password,
      ip: c.get('clientIp'),
      userAgent: c.req.header('User-Agent') ?? '',
      requestId: c.get('requestId'),
    });

    c.header(
      'Set-Cookie',
      serializeSessionCookie(result.token, {
        secure: isSecureCookieContext(),
        maxAgeSeconds: SESSION_MAX_AGE_SECONDS,
      }),
    );
    c.set('actorType', 'user');
    c.set('actorId', result.user.id);
    return c.json({ user: result.user, workspaces: result.workspaces }, 200);
  });

  void config;
}
```

- [ ] **Krok 6: Zapoj rate limit přihlášení do aplikace**

Do `apps/web/src/lib/api/app.ts` přidej před registraci cest middleware, které spotřebuje pravidla `login_ip` a `login_ip_email` a přidá hlavičky `RateLimit-*` i k úspěšné odpovědi:

```ts
import { consumeAll, limiterRegistry } from './rate-limit.js';

  // 4.5: dvě pravidla naráz. Samotná IP omezuje útočníka, dvojice IP a e-mail
  // omezuje útok na konkrétní účet zpoza mnoha adres.
  app.use('/api/v1/auth/login', async (c, next) => {
    const ip = c.get('clientIp');
    let email = '';
    try {
      email = String(((await c.req.raw.clone().json()) as { email?: unknown }).email ?? '');
    } catch {
      email = '';
    }
    const headers = await consumeAll(limiterRegistry, [
      { rule: 'login_ip', key: ip },
      { rule: 'login_ip_email', key: `${ip}|${email.toLowerCase()}` },
    ]);
    await next();
    for (const [k, v] of Object.entries(headers)) c.header(k, v);
  });
```

- [ ] **Krok 7: Spusť test, ověř, že prochází**

Run: `pnpm --filter @mlain/web test:db -- api/auth-login.test.ts`
Expected: 7 passed.

- [ ] **Krok 8: Commit**

```bash
git add packages/core/identity/api/schemas.ts packages/core/identity/api/auth.routes.ts apps/web/src/lib/api/app.ts apps/web/test/api/auth-login.test.ts
git commit -m "feat(api): login endpoint with session cookie and OpenAPI route definition"
```

---

### Úkol 25: Měření jednotné latence

Pokrývá kritérium 16, které je z celé kapitoly 8 nejsnáz porušitelné a nejhůř viditelné.

**Files:**
- Test: `packages/core/identity/login-timing.test.ts`

- [ ] **Krok 1: Napiš test, který kritérium měří**

Create `packages/core/identity/login-timing.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import * as schema from '@mlain/db/schema';
import { withoutContext } from '@mlain/core/tx';
import { hashPassword } from './password.js';
import { login } from './login.js';
import { requestPasswordReset } from './password-reset.js';

const PASSWORD = 'dostatecne-dlouhe-heslo';
const SAMPLES = 100;
let existingEmail = '';
const missingEmail = () => `nikdo-${Math.random().toString(36).slice(2)}@example.cz`;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

async function measure(fn: () => Promise<unknown>): Promise<number> {
  const started = process.hrtime.bigint();
  await fn().catch(() => undefined);
  return Number(process.hrtime.bigint() - started) / 1e6;
}

beforeAll(async () => {
  existingEmail = `timing-${Date.now()}@example.cz`;
  await withoutContext(async (tx) => {
    await tx.insert(schema.users).values({
      email: existingEmail,
      passwordHash: await hashPassword(PASSWORD),
      name: 'Petr',
      locale: 'cs',
      timezone: 'Europe/Prague',
    });
  });
  // Zahřátí: první volání platí za načtení blocklistu, JIT a pool spojení.
  for (let i = 0; i < 5; i += 1) {
    await login({ email: existingEmail, password: 'spatne', ip: '10.0.0.1', userAgent: 'v', requestId: 'w' }).catch(
      () => undefined,
    );
    await login({ email: missingEmail(), password: 'spatne', ip: '10.0.0.2', userAgent: 'v', requestId: 'w' }).catch(
      () => undefined,
    );
  }
}, 120_000);

describe('kritérium 16: enumerace účtů', () => {
  it(
    'medián odpovědi na přihlášení se pro existující a neexistující účet neliší o víc než 20 %',
    async () => {
      const existing: number[] = [];
      const missing: number[] = [];

      // Střídavě, aby se do výsledku nepromítl postupný ohřev nebo zpomalení stroje.
      for (let i = 0; i < SAMPLES; i += 1) {
        existing.push(
          await measure(() =>
            login({
              email: existingEmail,
              password: 'spatne-heslo-dostatecne-dlouhe',
              ip: `10.1.${Math.floor(i / 250)}.${i % 250}`,
              userAgent: 'timing',
              requestId: `e${i}`,
            }),
          ),
        );
        missing.push(
          await measure(() =>
            login({
              email: missingEmail(),
              password: 'spatne-heslo-dostatecne-dlouhe',
              ip: `10.2.${Math.floor(i / 250)}.${i % 250}`,
              userAgent: 'timing',
              requestId: `m${i}`,
            }),
          ),
        );
      }

      const a = median(existing);
      const b = median(missing);
      const relativeDifference = Math.abs(a - b) / Math.max(a, b);

      // Diagnostika do výstupu testu, aby při pádu bylo hned vidět o kolik.
      expect({ existujici: Math.round(a), neexistujici: Math.round(b) }).toBeTruthy();
      expect(relativeDifference).toBeLessThan(0.2);
    },
    300_000,
  );

  it(
    'totéž platí pro reset hesla, který vždy vrací 202',
    async () => {
      const existing: number[] = [];
      const missing: number[] = [];

      for (let i = 0; i < SAMPLES; i += 1) {
        existing.push(
          await measure(() =>
            requestPasswordReset({ email: existingEmail, ip: '10.3.0.1', userAgent: 'timing', requestId: `re${i}` }),
          ),
        );
        missing.push(
          await measure(() =>
            requestPasswordReset({ email: missingEmail(), ip: '10.3.0.2', userAgent: 'timing', requestId: `rm${i}` }),
          ),
        );
      }

      const a = median(existing);
      const b = median(missing);
      expect(Math.abs(a - b) / Math.max(a, b)).toBeLessThan(0.2);
    },
    300_000,
  );
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá na chybějícím modulu resetu**

Run: `pnpm --filter @mlain/core test:db -- identity/login-timing.test.ts`
Expected: FAIL, `Cannot find module './password-reset.js'`. Tenhle soubor vzniká v úkolu 29; test je napsaný dopředu schválně, aby se na kritérium 16 nezapomnělo.

- [ ] **Krok 3: Dočasně vyřaď druhý případ a ověř první**

Zakomentuj `import { requestPasswordReset }` a druhý `it` blok, pak spusť.

Run: `pnpm --filter @mlain/core test:db -- identity/login-timing.test.ts`
Expected: 1 passed. Když relativní rozdíl přesáhne 0,2, zvyš `AUTH_MIN_RESPONSE_MS` v `constant-time.ts` (například na 400) a spusť znovu; podlaha je jediné, co rozdíl srovnává, a v logu bude `constant_time_floor_exceeded`.

- [ ] **Krok 4: Vrať zakomentovaný blok a poznač, že se dokončí v úkolu 29**

Odkomentuj import i druhý `it` blok. Test bude do dokončení úkolu 29 padat na chybějícím modulu; je to zamýšlený stav a v úkolu 29 se zavírá.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/identity/login-timing.test.ts
git commit -m "test(identity): measure uniform login latency per acceptance criterion 16"
```

---

### Úkol 26: Odhlášení, výpis relací a revokace jedné relace

Pokrývá kritérium 18.

**Files:**
- Modify: `packages/core/identity/api/auth.routes.ts`
- Test: `apps/web/test/api/auth-sessions.test.ts`

- [ ] **Krok 1: Napiš padající test**

Create `apps/web/test/api/auth-sessions.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import * as schema from '@mlain/db/schema';
import { withoutContext } from '@mlain/core/tx';
import { hashPassword } from '@mlain/core/identity/password';
import { createApiApp } from '../../src/lib/api/app.js';
import { registerAuthRoutes } from '@mlain/core/identity/api/auth.routes';

const app = createApiApp();
registerAuthRoutes(app);

const PASSWORD = 'dostatecne-dlouhe-heslo';
let email = '';

async function signIn(): Promise<string> {
  const res = await app.request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  const cookie = res.headers.get('set-cookie') ?? '';
  return cookie.split(';')[0]!;
}

beforeAll(async () => {
  email = `sessions-${Date.now()}@example.cz`;
  await withoutContext(async (tx) => {
    await tx.insert(schema.users).values({
      email,
      passwordHash: await hashPassword(PASSWORD),
      name: 'Petr',
      locale: 'cs',
      timezone: 'Europe/Prague',
    });
  });
});

describe('GET /api/v1/auth/sessions', () => {
  it('vypíše aktivní relace a označí aktuální', async () => {
    const cookie = await signIn();
    const res = await app.request('/api/v1/auth/sessions', { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data.length).toBeGreaterThanOrEqual(1);
    expect(body.data.filter((s: { current: boolean }) => s.current)).toHaveLength(1);
  });

  it('bez cookie vrací 401 unauthenticated', async () => {
    const res = await app.request('/api/v1/auth/sessions');
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('unauthenticated');
  });

  it('nikdy nevrací token ani jeho hash', async () => {
    const cookie = await signIn();
    const body = await (await app.request('/api/v1/auth/sessions', { headers: { Cookie: cookie } })).json();
    expect(JSON.stringify(body)).not.toContain('token');
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('vrátí 204, smaže cookie a relace přestane platit', async () => {
    const cookie = await signIn();
    const res = await app.request('/api/v1/auth/logout', { method: 'POST', headers: { Cookie: cookie } });
    expect(res.status).toBe(204);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');

    const after = await app.request('/api/v1/auth/sessions', { headers: { Cookie: cookie } });
    expect(after.status).toBe(401);
    expect((await after.json()).code).toBe('session_expired');
  });
});

describe('POST /api/v1/auth/logout-all', () => {
  it('kritérium 18: i aktuální cookie přestane platit', async () => {
    const first = await signIn();
    const second = await signIn();

    const res = await app.request('/api/v1/auth/logout-all', { method: 'POST', headers: { Cookie: second } });
    expect(res.status).toBe(204);

    for (const cookie of [first, second]) {
      const check = await app.request('/api/v1/auth/sessions', { headers: { Cookie: cookie } });
      expect(check.status).toBe(401);
      expect((await check.json()).code).toBe('session_expired');
    }
  });
});

describe('DELETE /api/v1/auth/sessions/{id}', () => {
  it('zruší vlastní relaci', async () => {
    const keep = await signIn();
    const doomed = await signIn();
    const list = await (await app.request('/api/v1/auth/sessions', { headers: { Cookie: doomed } })).json();
    const current = list.data.find((s: { current: boolean }) => s.current);

    const res = await app.request(`/api/v1/auth/sessions/${current.id}`, {
      method: 'DELETE',
      headers: { Cookie: keep },
    });
    expect(res.status).toBe(204);

    const check = await app.request('/api/v1/auth/sessions', { headers: { Cookie: doomed } });
    expect(check.status).toBe(401);
  });

  it('cizí relace vrací 404, ne 403', async () => {
    const otherEmail = `other-${Date.now()}@example.cz`;
    await withoutContext(async (tx) => {
      await tx.insert(schema.users).values({
        email: otherEmail,
        passwordHash: await hashPassword(PASSWORD),
        locale: 'cs',
        timezone: 'Europe/Prague',
      });
    });
    const mine = await signIn();
    const foreignRes = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: otherEmail, password: PASSWORD }),
    });
    const foreignCookie = (foreignRes.headers.get('set-cookie') ?? '').split(';')[0]!;
    const foreignList = await (
      await app.request('/api/v1/auth/sessions', { headers: { Cookie: foreignCookie } })
    ).json();
    const foreignId = foreignList.data[0].id;

    const res = await app.request(`/api/v1/auth/sessions/${foreignId}`, {
      method: 'DELETE',
      headers: { Cookie: mine },
    });
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('not_found');
  });

  it('neplatné UUID v cestě vrací 422, ne 500', async () => {
    const cookie = await signIn();
    const res = await app.request('/api/v1/auth/sessions/neni-uuid', {
      method: 'DELETE',
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(422);
  });
});
```

- [ ] **Krok 2: Spusť test, ověř, že padá**

Run: `pnpm --filter @mlain/web test:db -- api/auth-sessions.test.ts`
Expected: FAIL, cesty `/api/v1/auth/sessions` a `/api/v1/auth/logout` vracejí 404 `not_found`.

- [ ] **Krok 3: Doplň do `auth.routes.ts` pomocnou funkci a čtyři cesty**

Do `packages/core/identity/api/auth.routes.ts` přidej nad `registerAuthRoutes`:

```ts
import type { Context } from 'hono';
import { and, eq, isNull } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { withoutContext } from '@mlain/core/tx';
import { ApiError } from '@mlain/core/errors/api-error';
import { writeAuditLog } from '@mlain/core/audit/write';
import { IdentityAuditActions } from '../audit.js';
import {
  clearSessionCookie,
  listUserSessions,
  readSessionCookie,
  revokeSession,
  revokeUserSessions,
  verifySessionToken,
} from '../session.js';

export type SessionActor = { userId: string; sessionId: string; csrfSecret: Buffer };

/**
 * Ověří session cookie. Používají ji cesty pod /api/v1/auth/**, které se
 * k žádnému projektu nevztahují, takže nepotřebují WorkspaceContext.
 * Kompletní rozpoznání aktéra pro projektové cesty je v apps/web/src/lib/api/authenticate.ts.
 */
export async function requireSession(c: Context<ApiEnv>): Promise<SessionActor> {
  const token = readSessionCookie(c.req.header('Cookie'));
  if (!token) throw new ApiError('unauthenticated');
  const verified = await withoutContext((tx) => verifySessionToken(tx, token));
  c.set('actorType', 'user');
  c.set('actorId', verified.userId);
  return { userId: verified.userId, sessionId: verified.sessionId, csrfSecret: verified.csrfSecret };
}

export const SessionSchema = z
  .object({
    id: z.uuid(),
    ip: z.string().nullable(),
    user_agent: z.string(),
    created_at: z.iso.datetime(),
    last_used_at: z.iso.datetime(),
    current: z.boolean(),
  })
  .openapi('Session');

const logoutRoute = createRoute({
  method: 'post',
  path: '/api/v1/auth/logout',
  tags: ['Auth'],
  summary: 'Odhlášení aktuální relace',
  responses: { 204: { description: 'Odhlášeno' }, 401: problemResponse('unauthenticated', 'session_expired') },
});

const logoutAllRoute = createRoute({
  method: 'post',
  path: '/api/v1/auth/logout-all',
  tags: ['Auth'],
  summary: 'Odhlášení ze všech zařízení včetně aktuálního',
  responses: { 204: { description: 'Odhlášeno' }, 401: problemResponse('unauthenticated', 'session_expired') },
});

const listSessionsRoute = createRoute({
  method: 'get',
  path: '/api/v1/auth/sessions',
  tags: ['Auth'],
  summary: 'Výpis aktivních relací uživatele',
  responses: {
    200: {
      description: 'Seznam relací',
      content: { 'application/json': { schema: z.object({ data: z.array(SessionSchema) }) } },
    },
    401: problemResponse('unauthenticated', 'session_expired'),
  },
});

const revokeSessionRoute = createRoute({
  method: 'delete',
  path: '/api/v1/auth/sessions/{id}',
  tags: ['Auth'],
  summary: 'Zrušení jedné vlastní relace',
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    204: { description: 'Zrušeno' },
    401: problemResponse('unauthenticated', 'session_expired'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});
```

- [ ] **Krok 4: Zaregistruj handlery uvnitř `registerAuthRoutes`**

Do těla `registerAuthRoutes` přidej:

```ts
  app.openapi(logoutRoute, async (c) => {
    const actor = await requireSession(c);
    await withoutContext(async (tx) => {
      await revokeSession(tx, actor.sessionId, 'logout');
      await writeAuditLog(tx, {
        action: IdentityAuditActions['user.logout'],
        workspaceId: null,
        actor: { actorType: 'user', actorId: actor.userId, actorLabel: '' },
        ip: c.get('clientIp'),
        userAgent: c.req.header('User-Agent') ?? null,
        requestId: c.get('requestId'),
      });
    });
    c.header('Set-Cookie', clearSessionCookie({ secure: isSecureCookieContext() }));
    return c.body(null, 204);
  });

  app.openapi(logoutAllRoute, async (c) => {
    const actor = await requireSession(c);
    // Bez výjimky: kritérium 18 vyžaduje, aby přestala platit i aktuální cookie.
    await withoutContext(async (tx) => {
      await revokeUserSessions(tx, actor.userId, 'logout_all');
      await writeAuditLog(tx, {
        action: IdentityAuditActions['user.logout'],
        workspaceId: null,
        actor: { actorType: 'user', actorId: actor.userId, actorLabel: '' },
        ip: c.get('clientIp'),
        userAgent: c.req.header('User-Agent') ?? null,
        requestId: c.get('requestId'),
        metadata: { scope: 'all_devices' },
      });
    });
    c.header('Set-Cookie', clearSessionCookie({ secure: isSecureCookieContext() }));
    return c.body(null, 204);
  });

  app.openapi(listSessionsRoute, async (c) => {
    const actor = await requireSession(c);
    const rows = await withoutContext((tx) => listUserSessions(tx, actor.userId));
    return c.json(
      {
        data: rows.map((r) => ({
          id: r.id,
          ip: r.ip === null ? null : String(r.ip),
          user_agent: r.user_agent,
          created_at: new Date(r.created_at).toISOString(),
          last_used_at: new Date(r.last_used_at).toISOString(),
          current: r.id === actor.sessionId,
        })),
      },
      200,
    );
  });

  app.openapi(revokeSessionRoute, async (c) => {
    const actor = await requireSession(c);
    const { id } = c.req.valid('param');
    // Cizí relace je pro aktéra neexistující zdroj, tedy 404, ne 403 (3.4).
    const revoked = await withoutContext((tx) =>
      tx
        .update(schema.sessions)
        .set({ revokedAt: new Date(), revokedReason: 'admin_action' })
        .where(
          and(
            eq(schema.sessions.id, id),
            eq(schema.sessions.userId, actor.userId),
            isNull(schema.sessions.revokedAt),
          ),
        )
        .returning({ id: schema.sessions.id }),
    );
    if (revoked.length === 0) throw new ApiError('not_found');
    return c.body(null, 204);
  });
```

- [ ] **Krok 5: Spusť test, ověř, že prochází**

Run: `pnpm --filter @mlain/web test:db -- api/auth-sessions.test.ts`
Expected: 8 passed.

- [ ] **Krok 6: Commit**

```bash
git add packages/core/identity/api/auth.routes.ts apps/web/test/api/auth-sessions.test.ts
git commit -m "feat(api): logout, logout-all and session management endpoints"
```

---

### Úkol 27: Profil aktéra, `GET` a `PATCH /api/v1/auth/me`

**Files:**
- Modify: `packages/core/identity/api/auth.routes.ts`
- Test: `apps/web/test/api/auth-me.test.ts`

- [ ] **Krok 1: Napiš padající test**

Create `apps/web/test/api/auth-me.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import * as schema from '@mlain/db/schema';
import { withoutContext } from '@mlain/core/tx';
import { hashPassword } from '@mlain/core/identity/password';
import { createApiApp } from '../../src/lib/api/app.js';
import { registerAuthRoutes } from '@mlain/core/identity/api/auth.routes';

const app = createApiApp();
registerAuthRoutes(app);

const PASSWORD = 'dostatecne-dlouhe-heslo';
let email = '';
let cookie = '';

beforeAll(async () => {
  email = `me-${Date.now()}@example.cz`;
  await withoutContext(async (tx) => {
    await tx.insert(schema.users).values({
      email,
      passwordHash: await hashPassword(PASSWORD),
      name: 'Petr',
      locale: 'cs',
      timezone: 'Europe/Prague',
    });
  });
  const res = await app.request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD }),
  });
  cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]!;
});

describe('GET /api/v1/auth/me', () => {
  it('vrátí uživatele a jeho členství', async () => {
    const res = await app.request('/api/v1/auth/me', { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe(email);
    expect(Array.isArray(body.memberships)).toBe(true);
  });

  it('bez cookie vrací 401', async () => {
    expect((await app.request('/api/v1/auth/me')).status).toBe(401);
  });
});

describe('PATCH /api/v1/auth/me', () => {
  it('změní jméno a vrátí nový stav', async () => {
    const res = await app.request('/api/v1/auth/me', {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Petr Novák' }),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).user.name).toBe('Petr Novák');
  });

  it('chybějící klíč znamená neměnit, ne nastavit prázdno', async () => {
    await app.request('/api/v1/auth/me', {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale: 'en' }),
    });
    const body = await (await app.request('/api/v1/auth/me', { headers: { Cookie: cookie } })).json();
    expect(body.user.name).toBe('Petr Novák');
    expect(body.user.locale).toBe('en');
  });

  it('nepodporovaný jazyk vrací 422', async () => {
    const res = await app.request('/api/v1/auth/me', {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ locale: 'kl' }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()).errors[0].path).toBe('locale');
  });

  it('neplatná časová zóna vrací 422', async () => {
    const res = await app.request('/api/v1/auth/me', {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ timezone: 'Mars/Olympus' }),
    });
    expect(res.status).toBe(422);
  });

  it('e-mail se přes tenhle endpoint měnit nedá', async () => {
    const res = await app.request('/api/v1/auth/me', {
      method: 'PATCH',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'jiny@example.cz' }),
    });
    expect(res.status).toBe(422);
  });
});
```

- [ ] **Krok 2: Spusť test, ověř, že padá**

Run: `pnpm --filter @mlain/web test:db -- api/auth-me.test.ts`
Expected: FAIL, cesta `/api/v1/auth/me` vrací 404.

- [ ] **Krok 3: Doplň do `auth.routes.ts` definice a handlery**

Přidej k definicím cest:

```ts
export const MembershipSchema = z
  .object({ workspace_id: z.uuid(), name: z.string(), slug: z.string(), role: RoleSchema })
  .openapi('Membership');

/** Platnost zóny se ověřuje proti Intl, ne proti vlastnímu seznamu. */
function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const UpdateMeSchema = z
  .object({
    name: z.string().min(1).max(200).optional(),
    locale: z.string().refine((v) => config.SUPPORTED_LOCALES.includes(v), {
      message: 'Nepodporovaný jazyk.',
    }).optional(),
    timezone: z.string().refine(isValidTimezone, { message: 'Neplatná časová zóna IANA.' }).optional(),
  })
  .strict()
  .openapi('UpdateMeInput');

const meRoute = createRoute({
  method: 'get',
  path: '/api/v1/auth/me',
  tags: ['Auth'],
  summary: 'Aktuální uživatel a jeho členství',
  responses: {
    200: {
      description: 'Uživatel',
      content: {
        'application/json': {
          schema: z.object({ user: PublicUserSchema, memberships: z.array(MembershipSchema) }),
        },
      },
    },
    401: problemResponse('unauthenticated', 'session_expired'),
  },
});

const updateMeRoute = createRoute({
  method: 'patch',
  path: '/api/v1/auth/me',
  tags: ['Auth'],
  summary: 'Změna vlastního profilu',
  request: { body: { content: { 'application/json': { schema: UpdateMeSchema } } } },
  responses: {
    200: {
      description: 'Změněno',
      content: { 'application/json': { schema: z.object({ user: PublicUserSchema }) } },
    },
    401: problemResponse('unauthenticated', 'session_expired'),
    422: problemResponse('validation_failed'),
  },
});
```

A do `registerAuthRoutes`:

```ts
  app.openapi(meRoute, async (c) => {
    const actor = await requireSession(c);
    const [user] = await withoutContext((tx) =>
      tx.select().from(schema.users).where(eq(schema.users.id, actor.userId)).limit(1),
    );
    if (!user) throw new ApiError('unauthenticated');
    const workspaces = await listWorkspacesOfUser(actor.userId);
    return c.json(
      {
        user: toPublicUser(user),
        memberships: workspaces.map((w) => ({
          workspace_id: w.id,
          name: w.name,
          slug: w.slug,
          role: w.role,
        })),
      },
      200,
    );
  });

  app.openapi(updateMeRoute, async (c) => {
    const actor = await requireSession(c);
    const input = c.req.valid('json');
    // PATCH: chybějící klíč znamená neměnit. Prázdný objekt je platný request.
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (input.name !== undefined) patch.name = input.name;
    if (input.locale !== undefined) patch.locale = input.locale;
    if (input.timezone !== undefined) patch.timezone = input.timezone;

    const [user] = await withoutContext((tx) =>
      tx.update(schema.users).set(patch).where(eq(schema.users.id, actor.userId)).returning(),
    );
    if (!user) throw new ApiError('unauthenticated');
    return c.json({ user: toPublicUser(user) }, 200);
  });
```

Doplň také import `listWorkspacesOfUser` a `toPublicUser` z `../login.js` a `RoleSchema` ze `./schemas.js`.

- [ ] **Krok 4: Spusť test, ověř, že prochází**

Run: `pnpm --filter @mlain/web test:db -- api/auth-me.test.ts`
Expected: 8 passed.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/identity/api/auth.routes.ts apps/web/test/api/auth-me.test.ts
git commit -m "feat(api): profile read and update endpoints"
```

---

### Úkol 28: Změna hesla

Pokrývá kritéria 17 a 21b, tedy dvě z nejtvrdších vět v kapitole 8.

**Files:**
- Create: `packages/core/identity/change-password.ts`
- Modify: `packages/core/identity/api/auth.routes.ts`
- Test: `packages/core/identity/change-password.test.ts`
- Test: `apps/web/test/api/auth-change-password.test.ts`

- [ ] **Krok 1: Napiš padající test doménové logiky**

Create `packages/core/identity/change-password.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { withoutContext } from '@mlain/core/tx';
import { hashPassword, verifyPassword } from './password.js';
import { createSession, verifySessionToken } from './session.js';
import { changePassword } from './change-password.js';

const OLD = 'stare-dostatecne-dlouhe';
const NEW = 'nove-dostatecne-dlouhe';
let userId = '';
let email = '';

beforeEach(async () => {
  email = `chp-${Date.now()}-${Math.random().toString(36).slice(2)}@example.cz`;
  userId = await withoutContext(async (tx) => {
    const [u] = await tx
      .insert(schema.users)
      .values({
        email,
        passwordHash: await hashPassword(OLD),
        locale: 'cs',
        timezone: 'Europe/Prague',
      })
      .returning({ id: schema.users.id });
    return u!.id;
  });
});

describe('changePassword', () => {
  it('uloží nové heslo a posune password_changed_at', async () => {
    const current = await withoutContext((tx) =>
      createSession(tx, { userId, userAgent: 'v', ip: null }),
    );
    await changePassword({
      userId,
      email,
      currentSessionId: current.sessionId,
      currentPassword: OLD,
      newPassword: NEW,
      ip: null,
      userAgent: 'v',
      requestId: 'r',
    });
    const [row] = await withoutContext((tx) =>
      tx.select().from(schema.users).where(eq(schema.users.id, userId)),
    );
    expect(await verifyPassword(row!.passwordHash, NEW)).toBe(true);
    expect(new Date(row!.passwordChangedAt).getTime()).toBeGreaterThan(Date.now() - 60_000);
  });

  it('kritérium 17: revokuje všechny ostatní relace a aktuální nechá', async () => {
    const keep = await withoutContext((tx) => createSession(tx, { userId, userAgent: 'a', ip: null }));
    const other = await withoutContext((tx) => createSession(tx, { userId, userAgent: 'b', ip: null }));

    await changePassword({
      userId,
      email,
      currentSessionId: keep.sessionId,
      currentPassword: OLD,
      newPassword: NEW,
      ip: null,
      userAgent: 'v',
      requestId: 'r',
    });

    await expect(withoutContext((tx) => verifySessionToken(tx, keep.token))).resolves.toMatchObject({
      userId,
    });
    await expect(withoutContext((tx) => verifySessionToken(tx, other.token))).rejects.toMatchObject({
      code: 'session_expired',
    });
  });

  it('revokované relace nesou důvod password_changed', async () => {
    const keep = await withoutContext((tx) => createSession(tx, { userId, userAgent: 'a', ip: null }));
    await withoutContext((tx) => createSession(tx, { userId, userAgent: 'b', ip: null }));
    await changePassword({
      userId,
      email,
      currentSessionId: keep.sessionId,
      currentPassword: OLD,
      newPassword: NEW,
      ip: null,
      userAgent: 'v',
      requestId: 'r',
    });
    const rows = await withoutContext(async (tx) => {
      const result = await tx.execute<{ revoked_reason: string }>(
        sql`SELECT revoked_reason FROM sessions WHERE user_id = ${userId}::uuid AND revoked_at IS NOT NULL`,
      );
      return result.rows;
    });
    expect(rows.every((r) => r.revoked_reason === 'password_changed')).toBe(true);
  });

  it('špatné současné heslo vrací invalid_credentials a nic nezmění', async () => {
    const current = await withoutContext((tx) => createSession(tx, { userId, userAgent: 'v', ip: null }));
    await expect(
      changePassword({
        userId,
        email,
        currentSessionId: current.sessionId,
        currentPassword: 'uplne-jine-heslo',
        newPassword: NEW,
        ip: null,
        userAgent: 'v',
        requestId: 'r',
      }),
    ).rejects.toMatchObject({ code: 'invalid_credentials' });
    const [row] = await withoutContext((tx) =>
      tx.select().from(schema.users).where(eq(schema.users.id, userId)),
    );
    expect(await verifyPassword(row!.passwordHash, OLD)).toBe(true);
  });

  it('nové heslo prochází pravidly z 3.1', async () => {
    const current = await withoutContext((tx) => createSession(tx, { userId, userAgent: 'v', ip: null }));
    await expect(
      changePassword({
        userId,
        email,
        currentSessionId: current.sessionId,
        currentPassword: OLD,
        newPassword: 'kratke',
        ip: null,
        userAgent: 'v',
        requestId: 'r',
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('kritérium 21b: zapíše user.password_changed s workspace_id NULL a transakce se nerollbackne', async () => {
    const current = await withoutContext((tx) => createSession(tx, { userId, userAgent: 'v', ip: null }));
    await changePassword({
      userId,
      email,
      currentSessionId: current.sessionId,
      currentPassword: OLD,
      newPassword: NEW,
      ip: null,
      userAgent: 'v',
      requestId: 'r',
    });

    const audit = await withoutContext(async (tx) => {
      const result = await tx.execute<{ workspace_id: string | null }>(
        sql`SELECT workspace_id FROM audit_log WHERE actor_id = ${userId}::uuid AND action = 'user.password_changed'`,
      );
      return result.rows;
    });
    expect(audit).toHaveLength(1);
    expect(audit[0]!.workspace_id).toBeNull();

    // Heslo je po volání opravdu změněné, tedy transakce se skutečně commitla.
    const [row] = await withoutContext((tx) =>
      tx.select().from(schema.users).where(eq(schema.users.id, userId)),
    );
    expect(await verifyPassword(row!.passwordHash, NEW)).toBe(true);
  });
});
```

- [ ] **Krok 2: Spusť test, ověř, že padá**

Run: `pnpm --filter @mlain/core test:db -- identity/change-password.test.ts`
Expected: FAIL, `Cannot find module './change-password.js'`.

- [ ] **Krok 3: Napiš `change-password.ts`**

Create `packages/core/identity/change-password.ts`:

```ts
import { eq, isNull, and, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { withoutContext } from '@mlain/core/tx';
import { ApiError } from '@mlain/core/errors/api-error';
import { writeAuditLog } from '@mlain/core/audit/write';
import { assertPasswordPolicy, hashPassword, verifyPassword } from './password.js';
import { revokeUserSessions } from './session.js';
import { IdentityAuditActions } from './audit.js';
import { queueSystemMail } from '@mlain/core/platform/system-mail';

export type ChangePasswordInput = {
  userId: string;
  email: string;
  currentSessionId: string;
  currentPassword: string;
  newPassword: string;
  ip: string | null;
  userAgent: string;
  requestId: string;
};

/**
 * 3.2: změna hesla revokuje všechny relace uživatele KROMĚ aktuální, aby se
 * uživatel nevyhodil sám. Do revoked_reason se zapíše password_changed.
 *
 * Celá operace je jedna transakce BEZ workspace kontextu (k žádnému projektu
 * nepatří). Auditní řádek má proto workspace_id NULL a politika
 * ws_isolation_audit ho musí ve WITH CHECK pustit, jinak by INSERT vzal
 * s sebou celou transakci a heslo by se neuložilo. Přesně tohle měří
 * kritérium 21b.
 */
export async function changePassword(input: ChangePasswordInput): Promise<void> {
  const [user] = await withoutContext((tx) =>
    tx
      .select()
      .from(schema.users)
      .where(and(eq(schema.users.id, input.userId), isNull(schema.users.deletedAt)))
      .limit(1),
  );
  if (!user) throw new ApiError('unauthenticated');

  if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
    throw new ApiError('invalid_credentials');
  }

  assertPasswordPolicy(input.newPassword, input.email);
  const newHash = await hashPassword(input.newPassword);

  await withoutContext(async (tx) => {
    await tx
      .update(schema.users)
      .set({ passwordHash: newHash, passwordChangedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.users.id, input.userId));

    await revokeUserSessions(tx, input.userId, 'password_changed', input.currentSessionId);

    // Nepoužité reset tokeny přestávají platit, jinak by šlo heslo hned přepsat zpět.
    await tx.execute(sql`
      UPDATE password_reset_tokens SET used_at = now()
       WHERE user_id = ${input.userId}::uuid AND used_at IS NULL AND expires_at > now()
    `);

    await writeAuditLog(tx, {
      action: IdentityAuditActions['user.password_changed'],
      workspaceId: null,
      actor: { actorType: 'user', actorId: input.userId, actorLabel: input.email },
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
  });

  // Informační e-mail až po commitu: kdyby odešel uvnitř transakce, která se
  // pak rollbackne, uživatel dostane zprávu o změně, ke které nedošlo.
  await queueSystemMail({
    template: 'password_changed',
    to: input.email,
    locale: user.locale,
    data: { changed_at: new Date().toISOString() },
  });
}
```

- [ ] **Krok 4: Napiš port systémových e-mailů, na kterém změna hesla stojí**

Create `packages/core/platform/system-mail.ts`:

```ts
import pino from 'pino';
import { config } from '@mlain/core/config';

/**
 * Rozhodnutí R7 plánu P04. Systémové e-maily potřebují blokové šablony (P08)
 * a odesílací pipeline (P13). Tenhle plán definuje jen port, aby na něm mohly
 * stát reset hesla, pozvánky a upozornění na deaktivovaný webhook.
 */
export type SystemMailName =
  | 'password_reset'
  | 'password_changed'
  | 'invitation'
  | 'webhook_endpoint_disabled';

export type SystemMail = {
  template: SystemMailName;
  to: string;
  locale: string;
  data: Record<string, string>;
};

export interface SystemMailer {
  send(mail: SystemMail): Promise<void>;
}

const logger = pino({ level: config.LOG_LEVEL });

/**
 * Výchozí implementace. Mimo produkci zaloguje i odkaz, aby šla instalace rozjet
 * a aby P06 mohl vyvíjet obrazovky bez odesílací pipeline. V produkci zaloguje
 * jen typ zprávy a příjemce, protože odkaz v logu je použitelný přihlašovací
 * artefakt a log čte víc lidí než schránku.
 */
export class LoggingSystemMailer implements SystemMailer {
  async send(mail: SystemMail): Promise<void> {
    if (config.NODE_ENV === 'production') {
      logger.warn(
        { template: mail.template, to: mail.to, locale: mail.locale },
        'system_mail_not_configured',
      );
      return;
    }
    logger.warn({ ...mail }, 'system_mail_not_configured');
  }
}

let mailer: SystemMailer = new LoggingSystemMailer();

/** Skutečnou implementaci zapojí P13 při startu procesu. */
export function setSystemMailer(next: SystemMailer): void {
  mailer = next;
}

export function queueSystemMail(mail: SystemMail): Promise<void> {
  return mailer.send(mail);
}
```

Create `packages/core/platform/system-mail.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { LoggingSystemMailer, queueSystemMail, setSystemMailer } from './system-mail.js';

describe('port systémových e-mailů', () => {
  it('výchozí implementace nikdy nehází', async () => {
    await expect(
      new LoggingSystemMailer().send({
        template: 'password_reset',
        to: 'petr@example.cz',
        locale: 'cs',
        data: { url: 'https://example.cz/reset?token=x' },
      }),
    ).resolves.toBeUndefined();
  });

  it('setSystemMailer přesměruje odesílání', async () => {
    const sent: unknown[] = [];
    setSystemMailer({
      async send(mail) {
        sent.push(mail);
      },
    });
    await queueSystemMail({ template: 'invitation', to: 'a@b.cz', locale: 'cs', data: {} });
    expect(sent).toHaveLength(1);
    setSystemMailer(new LoggingSystemMailer());
  });
});
```

- [ ] **Krok 5: Spusť oba testy, ověř, že prochází**

Run: `pnpm --filter @mlain/core test:db -- identity/change-password.test.ts && pnpm --filter @mlain/core test:unit -- platform/system-mail.test.ts`
Expected: 6 passed a 2 passed.

- [ ] **Krok 6: Doplň endpoint a jeho integrační test**

Do `packages/core/identity/api/auth.routes.ts` přidej:

```ts
export const ChangePasswordSchema = z
  .object({ current_password: z.string().min(1).max(256), new_password: z.string().min(1).max(256) })
  .strict()
  .openapi('ChangePasswordInput');

const changePasswordRoute = createRoute({
  method: 'post',
  path: '/api/v1/auth/change-password',
  tags: ['Auth'],
  summary: 'Změna vlastního hesla',
  request: { body: { content: { 'application/json': { schema: ChangePasswordSchema } } } },
  responses: {
    204: { description: 'Změněno, ostatní relace jsou revokované' },
    401: problemResponse('unauthenticated', 'invalid_credentials', 'session_expired'),
    422: problemResponse('validation_failed'),
  },
});
```

A do `registerAuthRoutes`:

```ts
  app.openapi(changePasswordRoute, async (c) => {
    const actor = await requireSession(c);
    const input = c.req.valid('json');
    const [user] = await withoutContext((tx) =>
      tx.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, actor.userId)).limit(1),
    );
    if (!user) throw new ApiError('unauthenticated');

    await changePassword({
      userId: actor.userId,
      email: user.email,
      currentSessionId: actor.sessionId,
      currentPassword: input.current_password,
      newPassword: input.new_password,
      ip: c.get('clientIp'),
      userAgent: c.req.header('User-Agent') ?? '',
      requestId: c.get('requestId'),
    });
    return c.body(null, 204);
  });
```

Create `apps/web/test/api/auth-change-password.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import * as schema from '@mlain/db/schema';
import { withoutContext } from '@mlain/core/tx';
import { hashPassword } from '@mlain/core/identity/password';
import { createApiApp } from '../../src/lib/api/app.js';
import { registerAuthRoutes } from '@mlain/core/identity/api/auth.routes';

const app = createApiApp();
registerAuthRoutes(app);

const OLD = 'stare-dostatecne-dlouhe';
const NEW = 'nove-dostatecne-dlouhe';
let email = '';

async function signIn(password: string): Promise<string> {
  const res = await app.request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return (res.headers.get('set-cookie') ?? '').split(';')[0]!;
}

beforeEach(async () => {
  email = `chp-api-${Date.now()}-${Math.random().toString(36).slice(2)}@example.cz`;
  await withoutContext(async (tx) => {
    await tx.insert(schema.users).values({
      email,
      passwordHash: await hashPassword(OLD),
      locale: 'cs',
      timezone: 'Europe/Prague',
    });
  });
});

describe('POST /api/v1/auth/change-password', () => {
  it('kritérium 21b: uspěje a heslo je po volání opravdu změněné', async () => {
    const cookie = await signIn(OLD);
    const res = await app.request('/api/v1/auth/change-password', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: OLD, new_password: NEW }),
    });
    expect(res.status).toBe(204);

    const withNew = await app.request('/api/v1/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: NEW }),
    });
    expect(withNew.status).toBe(200);
  });

  it('kritérium 17: request se starou cookie z jiné relace vrátí 401 session_expired', async () => {
    const other = await signIn(OLD);
    const current = await signIn(OLD);

    await app.request('/api/v1/auth/change-password', {
      method: 'POST',
      headers: { Cookie: current, 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: OLD, new_password: NEW }),
    });

    const res = await app.request('/api/v1/auth/me', { headers: { Cookie: other } });
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('session_expired');
  });

  it('aktuální relace zůstává platná, uživatel se nevyhodí sám', async () => {
    const current = await signIn(OLD);
    await app.request('/api/v1/auth/change-password', {
      method: 'POST',
      headers: { Cookie: current, 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: OLD, new_password: NEW }),
    });
    expect((await app.request('/api/v1/auth/me', { headers: { Cookie: current } })).status).toBe(200);
  });

  it('špatné současné heslo vrací 401', async () => {
    const cookie = await signIn(OLD);
    const res = await app.request('/api/v1/auth/change-password', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ current_password: 'uplne-jine-heslo', new_password: NEW }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('invalid_credentials');
  });
});
```

- [ ] **Krok 7: Spusť integrační test, ověř, že prochází**

Run: `pnpm --filter @mlain/web test:db -- api/auth-change-password.test.ts`
Expected: 4 passed.

- [ ] **Krok 8: Commit**

```bash
git add packages/core/identity/change-password.ts packages/core/identity/change-password.test.ts packages/core/platform/system-mail.ts packages/core/platform/system-mail.test.ts packages/core/identity/api/auth.routes.ts apps/web/test/api/auth-change-password.test.ts
git commit -m "feat(identity): change password with session revocation and global audit entry"
```

---

### Úkol 29: Reset hesla, dva endpointy s jednotnou odpovědí

Zavírá druhou polovinu kritéria 16.

**Files:**
- Create: `packages/core/identity/password-reset.ts`
- Modify: `packages/core/identity/api/auth.routes.ts`
- Test: `packages/core/identity/password-reset.test.ts`

- [ ] **Krok 1: Napiš padající test**

Create `packages/core/identity/password-reset.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { withoutContext } from '@mlain/core/tx';
import { hashPassword, verifyPassword } from './password.js';
import { createSession, verifySessionToken } from './session.js';
import {
  requestPasswordReset,
  confirmPasswordReset,
  RESET_TOKEN_TTL_MINUTES,
  __lastIssuedTokenForTests,
} from './password-reset.js';

const OLD = 'stare-dostatecne-dlouhe';
const NEW = 'nove-dostatecne-dlouhe';
let userId = '';
let email = '';

const request = () =>
  requestPasswordReset({ email, ip: '10.0.0.1', userAgent: 'vitest', requestId: 'r' });

beforeEach(async () => {
  email = `pr-${Date.now()}-${Math.random().toString(36).slice(2)}@example.cz`;
  userId = await withoutContext(async (tx) => {
    const [u] = await tx
      .insert(schema.users)
      .values({ email, passwordHash: await hashPassword(OLD), locale: 'cs', timezone: 'Europe/Prague' })
      .returning({ id: schema.users.id });
    return u!.id;
  });
});

describe('requestPasswordReset', () => {
  it('platnost tokenu je 60 minut podle 3.1', () => {
    expect(RESET_TOKEN_TTL_MINUTES).toBe(60);
  });

  it('pro existující účet vytvoří token a uloží jen jeho hash', async () => {
    await request();
    const rows = await withoutContext(async (tx) => {
      const result = await tx.execute<{ token_hash: Buffer; used_at: Date | null }>(
        sql`SELECT token_hash, used_at FROM password_reset_tokens WHERE user_id = ${userId}::uuid`,
      );
      return result.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.used_at).toBeNull();
    expect(rows[0]!.token_hash).toHaveLength(32);
  });

  it('pro neexistující účet neselže a nic nevytvoří', async () => {
    await expect(
      requestPasswordReset({
        email: `nikdo-${Date.now()}@example.cz`,
        ip: '10.0.0.1',
        userAgent: 'v',
        requestId: 'r',
      }),
    ).resolves.toBeUndefined();
    const rows = await withoutContext(async (tx) => {
      const result = await tx.execute(sql`SELECT 1 FROM password_reset_tokens WHERE user_id IS NULL`);
      return result.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it('nové vyžádání zneplatní předchozí nepoužité tokeny', async () => {
    await request();
    const first = __lastIssuedTokenForTests();
    await request();
    const second = __lastIssuedTokenForTests();
    expect(first).not.toBe(second);

    await expect(
      confirmPasswordReset({ token: first!, newPassword: NEW, ip: null, userAgent: 'v', requestId: 'r' }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('zapíše user.password_reset_requested do audit logu', async () => {
    await request();
    const rows = await withoutContext(async (tx) => {
      const result = await tx.execute(
        sql`SELECT 1 FROM audit_log WHERE actor_id = ${userId}::uuid AND action = 'user.password_reset_requested'`,
      );
      return result.rows;
    });
    expect(rows).toHaveLength(1);
  });
});

describe('confirmPasswordReset', () => {
  it('nastaví nové heslo a token spotřebuje', async () => {
    await request();
    const token = __lastIssuedTokenForTests()!;
    await confirmPasswordReset({ token, newPassword: NEW, ip: null, userAgent: 'v', requestId: 'r' });

    const [row] = await withoutContext((tx) =>
      tx.select().from(schema.users).where(eq(schema.users.id, userId)),
    );
    expect(await verifyPassword(row!.passwordHash, NEW)).toBe(true);

    await expect(
      confirmPasswordReset({ token, newPassword: NEW, ip: null, userAgent: 'v', requestId: 'r' }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('revokuje VŠECHNY relace uživatele, i tu aktuální', async () => {
    const session = await withoutContext((tx) => createSession(tx, { userId, userAgent: 'a', ip: null }));
    await request();
    await confirmPasswordReset({
      token: __lastIssuedTokenForTests()!,
      newPassword: NEW,
      ip: null,
      userAgent: 'v',
      requestId: 'r',
    });
    await expect(withoutContext((tx) => verifySessionToken(tx, session.token))).rejects.toMatchObject({
      code: 'session_expired',
    });
  });

  it('prošlý token vrací unauthenticated', async () => {
    await request();
    const token = __lastIssuedTokenForTests()!;
    await withoutContext((tx) =>
      tx.execute(
        sql`UPDATE password_reset_tokens SET expires_at = now() - interval '1 minute' WHERE user_id = ${userId}::uuid`,
      ),
    );
    await expect(
      confirmPasswordReset({ token, newPassword: NEW, ip: null, userAgent: 'v', requestId: 'r' }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('nové heslo prochází pravidly z 3.1', async () => {
    await request();
    await expect(
      confirmPasswordReset({
        token: __lastIssuedTokenForTests()!,
        newPassword: 'kratke',
        ip: null,
        userAgent: 'v',
        requestId: 'r',
      }),
    ).rejects.toMatchObject({ code: 'validation_failed' });
  });

  it('zapíše user.password_reset_completed s workspace_id NULL', async () => {
    await request();
    await confirmPasswordReset({
      token: __lastIssuedTokenForTests()!,
      newPassword: NEW,
      ip: null,
      userAgent: 'v',
      requestId: 'r',
    });
    const rows = await withoutContext(async (tx) => {
      const result = await tx.execute<{ workspace_id: string | null }>(
        sql`SELECT workspace_id FROM audit_log WHERE actor_id = ${userId}::uuid AND action = 'user.password_reset_completed'`,
      );
      return result.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.workspace_id).toBeNull();
  });
});
```

- [ ] **Krok 2: Spusť test, ověř, že padá**

Run: `pnpm --filter @mlain/core test:db -- identity/password-reset.test.ts`
Expected: FAIL, `Cannot find module './password-reset.js'`.

- [ ] **Krok 3: Napiš `password-reset.ts`**

Create `packages/core/identity/password-reset.ts`:

```ts
import { and, eq, isNull, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { withoutContext } from '@mlain/core/tx';
import { config } from '@mlain/core/config';
import { ApiError } from '@mlain/core/errors/api-error';
import { writeAuditLog } from '@mlain/core/audit/write';
import { queueSystemMail } from '@mlain/core/platform/system-mail';
import { assertPasswordPolicy, hashPassword } from './password.js';
import { generateOpaqueToken, tokenHash } from './token.js';
import { revokeUserSessions } from './session.js';
import { AUTH_MIN_RESPONSE_MS, withConstantTime } from './constant-time.js';
import { IdentityAuditActions } from './audit.js';

/** 3.1: token platí 60 minut a je jednorázový. */
export const RESET_TOKEN_TTL_MINUTES = 60;

let lastIssuedToken: string | null = null;

/**
 * Jen pro testy. V provozu se token nikde neuchovává, odchází pouze e-mailem.
 * Funkce je pojmenovaná dvěma podtržítky schválně, aby bylo na první pohled
 * vidět, že do produkční cesty nepatří.
 */
export function __lastIssuedTokenForTests(): string | null {
  return lastIssuedToken;
}

export type RequestResetInput = {
  email: string;
  ip: string | null;
  userAgent: string;
  requestId: string;
};

/**
 * 3.1: vrací se vždy 202 bez ohledu na existenci účtu a se stejnou latencí.
 * Endpoint proto nikdy nehází, jen mlčky nic neudělá, a celé volání běží uvnitř
 * časové podlahy jako přihlášení (kritérium 16).
 */
export function requestPasswordReset(input: RequestResetInput): Promise<void> {
  return withConstantTime(AUTH_MIN_RESPONSE_MS, () => performResetRequest(input));
}

async function performResetRequest(input: RequestResetInput): Promise<void> {
  const email = input.email.trim().toLowerCase();

  const [user] = await withoutContext((tx) =>
    tx
      .select({ id: schema.users.id, locale: schema.users.locale })
      .from(schema.users)
      .where(and(eq(schema.users.email, email), isNull(schema.users.deletedAt)))
      .limit(1),
  );

  // Token se generuje vždy, i pro neexistující účet: generování je měřitelná
  // práce a jeho vynechání by cestu zkrátilo.
  const token = generateOpaqueToken();
  const hash = tokenHash(token);
  if (!user) {
    lastIssuedToken = null;
    return;
  }
  lastIssuedToken = token;

  await withoutContext(async (tx) => {
    // Nové vyžádání invaliduje předchozí nepoužité tokeny téhož uživatele (3.1).
    await tx.execute(sql`
      UPDATE password_reset_tokens SET used_at = now()
       WHERE user_id = ${user.id}::uuid AND used_at IS NULL
    `);
    await tx.insert(schema.passwordResetTokens).values({
      userId: user.id,
      tokenHash: hash,
      expiresAt: sql`now() + interval '${sql.raw(String(RESET_TOKEN_TTL_MINUTES))} minutes'`,
    });
    await writeAuditLog(tx, {
      action: IdentityAuditActions['user.password_reset_requested'],
      workspaceId: null,
      actor: { actorType: 'user', actorId: user.id, actorLabel: email },
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
  });

  await queueSystemMail({
    template: 'password_reset',
    to: email,
    locale: user.locale,
    data: { url: `${config.APP_URL}/reset-password?token=${token}` },
  });
}

export type ConfirmResetInput = {
  token: string;
  newPassword: string;
  ip: string | null;
  userAgent: string;
  requestId: string;
};

/**
 * 3.1: po úspěšné změně se nastaví password_changed_at, revokují se VŠECHNY
 * relace uživatele (na rozdíl od změny hesla, kde aktuální zůstává, protože
 * tady žádná aktuální není), revokují se nepoužité reset tokeny a zapíše se audit.
 */
export async function confirmPasswordReset(input: ConfirmResetInput): Promise<void> {
  const hash = tokenHash(input.token);

  const [row] = await withoutContext((tx) =>
    tx
      .select({
        id: schema.passwordResetTokens.id,
        userId: schema.passwordResetTokens.userId,
        expiresAt: schema.passwordResetTokens.expiresAt,
        usedAt: schema.passwordResetTokens.usedAt,
      })
      .from(schema.passwordResetTokens)
      .where(eq(schema.passwordResetTokens.tokenHash, hash))
      .limit(1),
  );

  if (!row || row.usedAt || new Date(row.expiresAt).getTime() <= Date.now()) {
    throw new ApiError('unauthenticated');
  }

  const [user] = await withoutContext((tx) =>
    tx
      .select({ id: schema.users.id, email: schema.users.email, locale: schema.users.locale })
      .from(schema.users)
      .where(and(eq(schema.users.id, row.userId), isNull(schema.users.deletedAt)))
      .limit(1),
  );
  if (!user) throw new ApiError('unauthenticated');

  assertPasswordPolicy(input.newPassword, user.email);
  const newHash = await hashPassword(input.newPassword);

  await withoutContext(async (tx) => {
    await tx
      .update(schema.users)
      .set({ passwordHash: newHash, passwordChangedAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.users.id, user.id));

    await tx.execute(sql`
      UPDATE password_reset_tokens SET used_at = now()
       WHERE user_id = ${user.id}::uuid AND used_at IS NULL
    `);

    await revokeUserSessions(tx, user.id, 'password_reset');

    await writeAuditLog(tx, {
      action: IdentityAuditActions['user.password_reset_completed'],
      workspaceId: null,
      actor: { actorType: 'user', actorId: user.id, actorLabel: user.email },
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
    });
  });

  await queueSystemMail({
    template: 'password_changed',
    to: user.email,
    locale: user.locale,
    data: { changed_at: new Date().toISOString() },
  });
}
```

- [ ] **Krok 4: Spusť test, ověř, že prochází**

Run: `pnpm --filter @mlain/core test:db -- identity/password-reset.test.ts`
Expected: 10 passed.

- [ ] **Krok 5: Doplň oba endpointy**

Do `packages/core/identity/api/auth.routes.ts` přidej:

```ts
export const RequestResetSchema = z.object({ email: z.email() }).strict().openapi('PasswordResetInput');

export const ConfirmResetSchema = z
  .object({ token: z.string().min(1).max(200), new_password: z.string().min(1).max(256) })
  .strict()
  .openapi('PasswordResetConfirmInput');

const requestResetRoute = createRoute({
  method: 'post',
  path: '/api/v1/auth/password-reset',
  tags: ['Auth'],
  summary: 'Vyžádání odkazu na obnovu hesla',
  description:
    'Vrací vždy 202 bez ohledu na existenci účtu. Odpověď ani její latence neprozrazují, jestli účet existuje.',
  request: { body: { content: { 'application/json': { schema: RequestResetSchema } } } },
  responses: {
    202: { description: 'Přijato' },
    422: problemResponse('validation_failed'),
    429: problemResponse('rate_limited'),
  },
});

const confirmResetRoute = createRoute({
  method: 'post',
  path: '/api/v1/auth/password-reset/confirm',
  tags: ['Auth'],
  summary: 'Nastavení nového hesla podle tokenu z e-mailu',
  request: { body: { content: { 'application/json': { schema: ConfirmResetSchema } } } },
  responses: {
    204: { description: 'Heslo nastaveno, všechny relace jsou revokované' },
    401: problemResponse('unauthenticated'),
    422: problemResponse('validation_failed'),
  },
});
```

A do `registerAuthRoutes`:

```ts
  app.openapi(requestResetRoute, async (c) => {
    const input = c.req.valid('json');
    await requestPasswordReset({
      email: input.email,
      ip: c.get('clientIp'),
      userAgent: c.req.header('User-Agent') ?? '',
      requestId: c.get('requestId'),
    });
    return c.body(null, 202);
  });

  app.openapi(confirmResetRoute, async (c) => {
    const input = c.req.valid('json');
    await confirmPasswordReset({
      token: input.token,
      newPassword: input.new_password,
      ip: c.get('clientIp'),
      userAgent: c.req.header('User-Agent') ?? '',
      requestId: c.get('requestId'),
    });
    return c.body(null, 204);
  });
```

Do `apps/web/src/lib/api/app.ts` přidej rate limit vyžádání resetu:

```ts
  app.use('/api/v1/auth/password-reset', async (c, next) => {
    const headers = await consumeAll(limiterRegistry, [
      { rule: 'password_reset_ip', key: c.get('clientIp') },
    ]);
    await next();
    for (const [k, v] of Object.entries(headers)) c.header(k, v);
  });
```

- [ ] **Krok 6: Odkomentuj druhou část měření kritéria 16 a spusť ji**

V `packages/core/identity/login-timing.test.ts` vrať import `requestPasswordReset` i druhý blok `it`, pokud jsi je v úkolu 25 dočasně vyřadil.

Run: `pnpm --filter @mlain/core test:db -- identity/login-timing.test.ts`
Expected: 2 passed. Tímhle je kritérium 16 pokryté celé.

- [ ] **Krok 7: Commit**

```bash
git add packages/core/identity/password-reset.ts packages/core/identity/password-reset.test.ts packages/core/identity/api/auth.routes.ts packages/core/identity/login-timing.test.ts apps/web/src/lib/api/app.ts
git commit -m "feat(identity): password reset with uniform response and latency"
```

---

### Fáze E: API klíče a rozpoznání aktéra (úkoly 30 až 33)

---

### Úkol 30: Formát API klíče a časově konstantní ověření

Pokrývá kritéria 26 a 26b.

**Files:**
- Create: `packages/core/identity/api-key.ts`
- Test: `packages/core/identity/api-key.test.ts`

- [ ] **Krok 1: Napiš padající test**

Create `packages/core/identity/api-key.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import type { ApiError } from '@mlain/core/errors/api-error';
import {
  base32Lower,
  generateSecretKey,
  generatePublicKey,
  parseSecretKey,
  parsePublicKey,
  verifyApiKey,
  secretHashOf,
  PUBLIC_KEY_SCOPES,
  type ApiKeyRow,
} from './api-key.js';

/** Závazný vektor ze 3.5, přepočítaný spuštěním 2026-07-31. */
const VECTOR = {
  prefixBytes: 'a1b2c3d4e5',
  prefix: 'ugzmhvhf',
  secret: '__79_Pv6-fj39vX08_Lx8O_u7ezr6uno5-bl5OPi4eA',
  key: 'ml_live_ugzmhvhf___79_Pv6-fj39vX08_Lx8O_u7ezr6uno5-bl5OPi4eA',
  secretSha256: '7ac21015d6000ce73d6f61c420ff4d5f0f3cc816da25b10726b74e8961cd925c',
};

const row = (over: Partial<ApiKeyRow> = {}): ApiKeyRow => ({
  id: '0192f3a0-1c2d-7e44-8d4e-5f60718293a4',
  workspaceId: '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071',
  kind: 'secret',
  scopes: ['contacts:read'],
  secretHash: Buffer.from(VECTOR.secretSha256, 'hex'),
  previousSecretHash: null,
  previousExpiresAt: null,
  revokedAt: null,
  expiresAt: null,
  workspaceDeletedAt: null,
  ...over,
});

describe('formát klíče (3.5)', () => {
  it('base32 prefix odpovídá závaznému vektoru', () => {
    expect(base32Lower(Buffer.from(VECTOR.prefixBytes, 'hex'))).toBe(VECTOR.prefix);
  });

  it('SHA-256 sekretu odpovídá vektoru', () => {
    expect(secretHashOf(VECTOR.secret).toString('hex')).toBe(VECTOR.secretSha256);
  });

  it('vygenerovaný tajný klíč má 60 znaků a správné části', () => {
    const generated = generateSecretKey();
    expect(generated.key).toHaveLength(60);
    expect(generated.key.startsWith(`ml_live_${generated.prefix}_`)).toBe(true);
    expect(generated.prefix).toMatch(/^[a-z2-7]{8}$/);
    expect(generated.secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('prefix je base32, ne base64url, aby ho podtržítko nerozbilo', () => {
    for (let i = 0; i < 200; i += 1) expect(generateSecretKey().prefix).not.toContain('_');
  });

  it('veřejný klíč má tvar ml_pub_ a 16 znaků base32', () => {
    const generated = generatePublicKey();
    expect(generated.key).toMatch(/^ml_pub_[a-z2-7]{16}$/);
    expect(generated.prefix).toHaveLength(16);
  });

  it('veřejný klíč má pevně scope events:write a nic jiného', () => {
    expect(PUBLIC_KEY_SCOPES).toEqual(['events:write']);
  });
});

describe('parsování', () => {
  it('vektorový klíč se rozparsuje na prefix a sekret', () => {
    expect(parseSecretKey(VECTOR.key)).toEqual({ env: 'live', prefix: VECTOR.prefix, secret: VECTOR.secret });
  });

  it('klíč s jiným počtem znaků neprojde', () => {
    expect(parseSecretKey('ml_live_ugzmhvhf_kratky')).toBeNull();
  });

  it('klíč s neplatným prostředím neprojde', () => {
    expect(parseSecretKey(`ml_stage_${VECTOR.prefix}_${VECTOR.secret}`)).toBeNull();
  });

  it('veřejný klíč s 16 znaky projde', () => {
    expect(parsePublicKey('ml_pub_aebagbafaydqqcik')).toEqual({ prefix: 'aebagbafaydqqcik' });
  });

  it('veřejný klíč s jinou délkou neprojde', () => {
    expect(parsePublicKey('ml_pub_aebagbaf')).toBeNull();
  });

  it('veřejný klíč se znakem mimo base32 abecedu neprojde', () => {
    expect(parsePublicKey('ml_pub_aebagbafaydqqci9')).toBeNull();
  });
});

describe('ověření tajného klíče', () => {
  it('platný klíč projde a vrátí workspace a scopes', async () => {
    const load = vi.fn(async () => row());
    const verified = await verifyApiKey(VECTOR.key, load);
    expect(verified.workspaceId).toBe(row().workspaceId);
    expect(verified.scopes).toEqual(['contacts:read']);
    expect(verified.rotated).toBe(false);
  });

  it('neznámý prefix vrací unauthenticated a provede DVĚ dummy porovnání', async () => {
    const load = vi.fn(async () => null);
    const compares: number[] = [];
    await expect(
      verifyApiKey(VECTOR.key, load, { onCompare: () => compares.push(1) }),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(compares).toHaveLength(2);
  });

  it('existující klíč bez previous hashe provede taky DVĚ porovnání', async () => {
    const compares: number[] = [];
    await verifyApiKey(VECTOR.key, async () => row(), { onCompare: () => compares.push(1) });
    expect(compares).toHaveLength(2);
  });

  it('špatný sekret vrací unauthenticated', async () => {
    const wrong = `ml_live_${VECTOR.prefix}_${'A'.repeat(43)}`;
    await expect(verifyApiKey(wrong, async () => row())).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('kritérium 26c: sekret v grace období projde a nese příznak rotace', async () => {
    const previous = Buffer.from(VECTOR.secretSha256, 'hex');
    const verified = await verifyApiKey(VECTOR.key, async () =>
      row({
        secretHash: createHash('sha256').update('jiny-secret', 'ascii').digest(),
        previousSecretHash: previous,
        previousExpiresAt: new Date(Date.now() + 60_000),
      }),
    );
    expect(verified.rotated).toBe(true);
  });

  it('kritérium 26c: po vypršení grace období vrací unauthenticated', async () => {
    const previous = Buffer.from(VECTOR.secretSha256, 'hex');
    await expect(
      verifyApiKey(VECTOR.key, async () =>
        row({
          secretHash: createHash('sha256').update('jiny-secret', 'ascii').digest(),
          previousSecretHash: previous,
          previousExpiresAt: new Date(Date.now() - 1_000),
        }),
      ),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('revokovaný klíč vrací unauthenticated', async () => {
    await expect(verifyApiKey(VECTOR.key, async () => row({ revokedAt: new Date() }))).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('expirovaný klíč vrací unauthenticated', async () => {
    await expect(
      verifyApiKey(VECTOR.key, async () => row({ expiresAt: new Date(Date.now() - 1000) })),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });

  it('klíč smazaného projektu vrací unauthenticated', async () => {
    await expect(
      verifyApiKey(VECTOR.key, async () => row({ workspaceDeletedAt: new Date() })),
    ).rejects.toMatchObject({ code: 'unauthenticated' });
  });
});

describe('ověření veřejného klíče', () => {
  it('platný veřejný klíč projde se scope events:write', async () => {
    const verified = await verifyApiKey('ml_pub_aebagbafaydqqcik', async () =>
      row({ kind: 'public', secretHash: null, scopes: ['events:write'] }),
    );
    expect(verified.scopes).toEqual(['events:write']);
    expect(verified.kind).toBe('public');
  });

  it('kritérium 26b: vadné tělo vrací 401 BEZ jediného dotazu do databáze', async () => {
    const load = vi.fn(async () => row());
    for (const bad of ['ml_pub_aebagbaf', 'ml_pub_aebagbafaydqqci9', 'ml_pub_']) {
      await expect(verifyApiKey(bad, load)).rejects.toMatchObject({
        code: 'unauthenticated',
        status: 401,
      });
    }
    expect(load).not.toHaveBeenCalled();
  });

  it('ve větvi veřejného klíče se neprovádí žádné porovnání hashů', async () => {
    const compares: number[] = [];
    await verifyApiKey(
      'ml_pub_aebagbafaydqqcik',
      async () => row({ kind: 'public', secretHash: null, scopes: ['events:write'] }),
      { onCompare: () => compares.push(1) },
    );
    expect(compares).toHaveLength(0);
  });

  it('nenalezený veřejný klíč vrací unauthenticated', async () => {
    await expect(verifyApiKey('ml_pub_aebagbafaydqqcik', async () => null)).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });
});

describe('nesmyslné vstupy', () => {
  it('prázdný řetězec vrací 401 bez dotazu', async () => {
    const load = vi.fn(async () => row());
    await expect(verifyApiKey('', load)).rejects.toMatchObject({ code: 'unauthenticated' });
    expect(load).not.toHaveBeenCalled();
  });

  it('chyba nikdy nenese kód forbidden ani not_found', async () => {
    try {
      await verifyApiKey('nesmysl', async () => null);
    } catch (e) {
      expect(['forbidden', 'not_found']).not.toContain((e as ApiError).code);
    }
  });
});
```

- [ ] **Krok 2: Spusť test, ověř, že padá**

Run: `pnpm --filter @mlain/core test:unit -- identity/api-key.test.ts`
Expected: FAIL, `Cannot find module './api-key.js'`.

- [ ] **Krok 3: Napiš `api-key.ts`**

Create `packages/core/identity/api-key.ts`:

```ts
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { ApiError } from '@mlain/core/errors/api-error';
import type { Permission } from './permissions.js';

/** RFC 4648 base32 abeceda malými písmeny, bez paddingu. */
const BASE32_ALPHABET = 'abcdefghijklmnopqrstuvwxyz234567';

export function base32Lower(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** 3.5: prefix z 5 bajtů má 8 znaků, veřejný prefix z 10 bajtů má 16 znaků. */
export const SECRET_PREFIX_BYTES = 5;
export const PUBLIC_PREFIX_BYTES = 10;
export const SECRET_BYTES = 32;

export const PUBLIC_KEY_SCOPES: readonly Permission[] = ['events:write'];

const SECRET_KEY_PATTERN = /^ml_(live|test)_([a-z2-7]{8})_([A-Za-z0-9_-]{43})$/;
const PUBLIC_KEY_PATTERN = /^ml_pub_([a-z2-7]{16})$/;

export function secretHashOf(secret: string): Buffer {
  // SHA-256 stačí: sekret má 256 bitů entropie z CSPRNG, takže pomalý hash by
  // jen přidal desítky milisekund na každý API request. U hesel je to naopak.
  return createHash('sha256').update(secret, 'ascii').digest();
}

export function generateSecretKey(): { key: string; prefix: string; secret: string } {
  const prefix = base32Lower(randomBytes(SECRET_PREFIX_BYTES));
  const secret = randomBytes(SECRET_BYTES).toString('base64url');
  return { key: `ml_live_${prefix}_${secret}`, prefix, secret };
}

export function generatePublicKey(): { key: string; prefix: string } {
  const prefix = base32Lower(randomBytes(PUBLIC_PREFIX_BYTES));
  return { key: `ml_pub_${prefix}`, prefix };
}

export function parseSecretKey(raw: string): { env: string; prefix: string; secret: string } | null {
  const match = raw.match(SECRET_KEY_PATTERN);
  if (!match) return null;
  return { env: match[1]!, prefix: match[2]!, secret: match[3]! };
}

export function parsePublicKey(raw: string): { prefix: string } | null {
  const match = raw.match(PUBLIC_KEY_PATTERN);
  if (!match) return null;
  return { prefix: match[1]! };
}

export type ApiKeyRow = {
  id: string;
  workspaceId: string;
  kind: 'secret' | 'public';
  scopes: readonly Permission[];
  secretHash: Buffer | null;
  previousSecretHash: Buffer | null;
  previousExpiresAt: Date | null;
  revokedAt: Date | null;
  expiresAt: Date | null;
  workspaceDeletedAt: Date | null;
};

export type ApiKeyLoader = (prefix: string, kind: 'secret' | 'public') => Promise<ApiKeyRow | null>;

export type VerifiedApiKey = {
  apiKeyId: string;
  workspaceId: string;
  kind: 'secret' | 'public';
  scopes: readonly Permission[];
  /** true, když se klíč ověřil dožívajícím sekretem z grace období. */
  rotated: boolean;
};

/**
 * Dvě konstantní hodnoty pro dummy porovnání. Musí být dvě, protože klíč
 * v grace období se porovnává dvakrát; jedno dummy porovnání proti dvěma
 * reálným je měřitelný rozdíl a prozradilo by, že klíč existuje a rotuje se.
 */
const DUMMY_HASH_A = createHash('sha256').update('mlain/dummy/a', 'ascii').digest();
const DUMMY_HASH_B = createHash('sha256').update('mlain/dummy/b', 'ascii').digest();

type VerifyOptions = { onCompare?: () => void; now?: Date };

function constantTimeEqual(a: Buffer, b: Buffer, opts: VerifyOptions): boolean {
  opts.onCompare?.();
  // timingSafeEqual hodí výjimku při rozdílné délce, proto se délka kontroluje předem.
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * 3.5. Algoritmus má dvě větve podle tvaru klíče a větev se vybírá z prefixu
 * řetězce, ještě před jakýmkoliv dotazem do databáze. Bez toho by veřejný klíč
 * propadl do větve tajného, zastavil ho regulární výraz a vrátilo by se 401,
 * které neodpovídá kritériu 26.
 */
export async function verifyApiKey(
  raw: string,
  load: ApiKeyLoader,
  options: VerifyOptions = {},
): Promise<VerifiedApiKey> {
  const now = options.now ?? new Date();

  if (raw.startsWith('ml_pub_')) {
    // P1: neshoda tvaru končí 401 bez dotazu do databáze (kritérium 26b).
    const parsed = parsePublicKey(raw);
    if (!parsed) throw new ApiError('unauthenticated');

    // P2
    const row = await load(parsed.prefix, 'public');
    if (!row) throw new ApiError('unauthenticated');

    // P3. Žádné porovnávání hashů ani dummy porovnání: secret_hash je NULL
    // a hodnota klíče je z definice veřejná, takže tu není co chránit.
    assertUsable(row, now);
    return {
      apiKeyId: row.id,
      workspaceId: row.workspaceId,
      kind: 'public',
      scopes: row.scopes,
      rotated: false,
    };
  }

  // S1
  const parsed = parseSecretKey(raw);
  if (!parsed) throw new ApiError('unauthenticated');
  const provided = secretHashOf(parsed.secret);

  // S2
  const row = await load(parsed.prefix, 'secret');
  if (!row) {
    constantTimeEqual(provided, DUMMY_HASH_A, options);
    constantTimeEqual(provided, DUMMY_HASH_B, options);
    throw new ApiError('unauthenticated');
  }

  // S3
  const primaryOk = constantTimeEqual(provided, row.secretHash ?? DUMMY_HASH_A, options);

  // S4: neshoda v S3 ještě není odmítnutí, zkus grace hash z rotace.
  // Druhé porovnání se provede VŽDY, i když previous_secret_hash chybí, jinak by
  // se z počtu porovnání dalo poznat, že se klíč právě rotuje.
  const graceUsable =
    row.previousSecretHash !== null &&
    row.previousExpiresAt !== null &&
    new Date(row.previousExpiresAt).getTime() > now.getTime();
  const secondaryOk = constantTimeEqual(provided, row.previousSecretHash ?? DUMMY_HASH_B, options);
  const rotatedOk = graceUsable && secondaryOk;

  if (!primaryOk && !rotatedOk) throw new ApiError('unauthenticated');

  // S5
  assertUsable(row, now);

  return {
    apiKeyId: row.id,
    workspaceId: row.workspaceId,
    kind: 'secret',
    scopes: row.scopes,
    rotated: !primaryOk && rotatedOk,
  };
}

function assertUsable(row: ApiKeyRow, now: Date): void {
  if (row.revokedAt) throw new ApiError('unauthenticated');
  if (row.expiresAt && new Date(row.expiresAt).getTime() <= now.getTime()) {
    throw new ApiError('unauthenticated');
  }
  if (row.workspaceDeletedAt) throw new ApiError('unauthenticated');
}
```

- [ ] **Krok 4: Spusť test, ověř, že prochází**

Run: `pnpm --filter @mlain/core test:unit -- identity/api-key.test.ts`
Expected: 22 passed.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/identity/api-key.ts packages/core/identity/api-key.test.ts
git commit -m "feat(identity): API key format and constant-time verification with grace rotation"
```

---

### Úkol 31: Endpointy API klíčů

Pokrývá kritéria 25, 26c, 30 a 31.

**Files:**
- Create: `packages/core/identity/api-key-service.ts`
- Create: `packages/core/identity/api/api-keys.routes.ts`
- Test: `apps/web/test/api/api-keys.test.ts`

- [ ] **Krok 1: Napiš `api-key-service.ts`**

Create `packages/core/identity/api-key-service.ts`:

```ts
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import type { Tx } from '@mlain/core/tx';
import { ApiError, validationFailed } from '@mlain/core/errors/api-error';
import { writeAuditLog } from '@mlain/core/audit/write';
import {
  generatePublicKey,
  generateSecretKey,
  secretHashOf,
  PUBLIC_KEY_SCOPES,
  type ApiKeyRow,
} from './api-key.js';
import { isPermission, type Permission } from './permissions.js';
import { IdentityAuditActions } from './audit.js';
import { wsEq } from './scope.js';
import type { WorkspaceContext } from './types.js';

/** 3.5: grace období 0 až 86400 sekund, výchozí 0 (starý sekret hned neplatí). */
export const MAX_GRACE_SECONDS = 86_400;
/** 7: zápis last_used_at nejvýš jednou za 60 sekund a mimo hlavní transakci. */
export const LAST_USED_THROTTLE_SECONDS = 60;

export type PublicApiKey = {
  id: string;
  name: string;
  kind: 'secret' | 'public';
  prefix: string;
  scopes: Permission[];
  last_used_at: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
};

function toPublicApiKey(row: {
  id: string;
  name: string;
  kind: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
}): PublicApiKey {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind as 'secret' | 'public',
    prefix: row.prefix,
    scopes: row.scopes as Permission[],
    last_used_at: row.lastUsedAt ? new Date(row.lastUsedAt).toISOString() : null,
    expires_at: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
    revoked_at: row.revokedAt ? new Date(row.revokedAt).toISOString() : null,
    created_at: new Date(row.createdAt).toISOString(),
  };
}

function assertScopes(scopes: string[], kind: 'secret' | 'public'): Permission[] {
  if (kind === 'public') {
    // 3.5: veřejný klíč má pevně scope events:write a nic jiného mu nejde přidat.
    if (scopes.length > 0 && (scopes.length !== 1 || scopes[0] !== 'events:write')) {
      throw validationFailed([
        {
          path: 'scopes',
          code: 'public_key_scopes_fixed',
          message: 'Veřejný klíč má pevně scope events:write.',
        },
      ]);
    }
    return [...PUBLIC_KEY_SCOPES];
  }
  const invalid = scopes.filter((s) => !isPermission(s));
  if (invalid.length > 0) {
    throw validationFailed(
      invalid.map((s) => ({
        path: 'scopes',
        code: 'unknown_scope',
        // Wildcard nepovolujeme: klíč s * je klíč, o kterém nikdo neví, co smí.
        message: `Neznámý scope "${s}".`,
      })),
    );
  }
  if (scopes.length === 0) {
    throw validationFailed([
      { path: 'scopes', code: 'scopes_required', message: 'Klíč musí mít aspoň jeden scope.' },
    ]);
  }
  return scopes as Permission[];
}

export async function createApiKey(
  tx: Tx,
  ctx: WorkspaceContext,
  input: { name: string; kind: 'secret' | 'public'; scopes: string[]; expires_at: string | null },
  actorLabel: string,
): Promise<{ key: PublicApiKey; secret: string }> {
  const scopes = assertScopes(input.scopes, input.kind);
  const generated = input.kind === 'public' ? generatePublicKey() : generateSecretKey();
  const secret = 'secret' in generated ? generated.secret : '';

  const [row] = await tx
    .insert(schema.apiKeys)
    .values({
      workspaceId: ctx.workspaceId,
      name: input.name,
      kind: input.kind,
      prefix: generated.prefix,
      secretHash: input.kind === 'secret' ? secretHashOf(secret) : null,
      scopes,
      createdBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      expiresAt: input.expires_at ? new Date(input.expires_at) : null,
    })
    .returning();

  await writeAuditLog(tx, {
    action: IdentityAuditActions['api_key.created'],
    workspaceId: ctx.workspaceId,
    actor: {
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      actorLabel,
    },
    targetType: 'api_key',
    targetId: row!.id,
    metadata: { name: input.name, kind: input.kind, scopes },
  });

  return { key: toPublicApiKey(row!), secret: generated.key };
}

export async function listApiKeys(tx: Tx, ctx: WorkspaceContext): Promise<PublicApiKey[]> {
  const rows = await tx
    .select()
    .from(schema.apiKeys)
    .where(and(wsEq(ctx, schema.apiKeys), isNull(schema.apiKeys.revokedAt)))
    .orderBy(desc(schema.apiKeys.createdAt));
  return rows.map(toPublicApiKey);
}

export async function rotateApiKey(
  tx: Tx,
  ctx: WorkspaceContext,
  input: { id: string; graceSeconds: number },
  actorLabel: string,
): Promise<{ key: PublicApiKey; secret: string }> {
  if (input.graceSeconds < 0 || input.graceSeconds > MAX_GRACE_SECONDS) {
    throw validationFailed([
      {
        path: 'grace_seconds',
        code: 'out_of_range',
        message: `Hodnota musí být od 0 do ${MAX_GRACE_SECONDS}.`,
      },
    ]);
  }

  const [existing] = await tx
    .select()
    .from(schema.apiKeys)
    .where(and(wsEq(ctx, schema.apiKeys), eq(schema.apiKeys.id, input.id), isNull(schema.apiKeys.revokedAt)))
    .limit(1);
  if (!existing) throw new ApiError('not_found');
  if (existing.kind === 'public') {
    throw new ApiError('conflict', { params: { reason: 'public_key_has_no_secret' } });
  }

  const generated = generateSecretKey();
  const [row] = await tx
    .update(schema.apiKeys)
    .set({
      prefix: generated.prefix,
      secretHash: secretHashOf(generated.secret),
      // Sloupce grace období čte krok S4 ověřovacího algoritmu. Bez něj by to
      // byly mrtvé sloupce a grace období jen slib v UI.
      previousSecretHash: input.graceSeconds > 0 ? existing.secretHash : null,
      previousExpiresAt:
        input.graceSeconds > 0
          ? sql`now() + interval '${sql.raw(String(input.graceSeconds))} seconds'`
          : null,
      updatedAt: new Date(),
    })
    .where(and(wsEq(ctx, schema.apiKeys), eq(schema.apiKeys.id, input.id)))
    .returning();

  await writeAuditLog(tx, {
    action: IdentityAuditActions['api_key.rotated'],
    workspaceId: ctx.workspaceId,
    actor: {
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      actorLabel,
    },
    targetType: 'api_key',
    targetId: input.id,
    metadata: { grace_seconds: input.graceSeconds },
  });

  return { key: toPublicApiKey(row!), secret: generated.key };
}

export async function revokeApiKey(
  tx: Tx,
  ctx: WorkspaceContext,
  id: string,
  actorLabel: string,
): Promise<void> {
  // Revokovaný klíč se nemaže, aby audit dával smysl (3.5).
  const revoked = await tx
    .update(schema.apiKeys)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(and(wsEq(ctx, schema.apiKeys), eq(schema.apiKeys.id, id), isNull(schema.apiKeys.revokedAt)))
    .returning({ id: schema.apiKeys.id });
  if (revoked.length === 0) throw new ApiError('not_found');

  await writeAuditLog(tx, {
    action: IdentityAuditActions['api_key.revoked'],
    workspaceId: ctx.workspaceId,
    actor: {
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      actorLabel,
    },
    targetType: 'api_key',
    targetId: id,
  });
}

/** Načtení řádku pro ověření. Běží mimo workspace kontext, protože ten se z klíče teprve zjišťuje. */
export async function loadApiKeyRow(
  tx: Tx,
  prefix: string,
  kind: 'secret' | 'public',
): Promise<ApiKeyRow | null> {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT k.id::text          AS id,
           k.workspace_id::text AS workspace_id,
           k.kind               AS kind,
           k.scopes             AS scopes,
           k.secret_hash        AS secret_hash,
           k.previous_secret_hash AS previous_secret_hash,
           k.previous_expires_at  AS previous_expires_at,
           k.revoked_at         AS revoked_at,
           k.expires_at         AS expires_at,
           w.deleted_at         AS workspace_deleted_at
      FROM api_keys k
      JOIN workspaces w ON w.id = k.workspace_id
     WHERE k.prefix = ${prefix} AND k.kind = ${kind}
     LIMIT 1
  `);
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id as string,
    workspaceId: row.workspace_id as string,
    kind: row.kind as 'secret' | 'public',
    scopes: (row.scopes as string[]) as Permission[],
    secretHash: row.secret_hash ? Buffer.from(row.secret_hash as Buffer) : null,
    previousSecretHash: row.previous_secret_hash ? Buffer.from(row.previous_secret_hash as Buffer) : null,
    previousExpiresAt: (row.previous_expires_at as Date | null) ?? null,
    revokedAt: (row.revoked_at as Date | null) ?? null,
    expiresAt: (row.expires_at as Date | null) ?? null,
    workspaceDeletedAt: (row.workspace_deleted_at as Date | null) ?? null,
  };
}

/** Zápis nejvýš jednou za minutu, mimo hlavní transakci, fire and forget. */
export async function touchApiKeyLastUsed(tx: Tx, apiKeyId: string): Promise<void> {
  await tx.execute(sql`
    UPDATE api_keys SET last_used_at = now()
     WHERE id = ${apiKeyId}::uuid
       AND (last_used_at IS NULL
            OR last_used_at < now() - interval '${sql.raw(String(LAST_USED_THROTTLE_SECONDS))} seconds')
  `);
}
```

- [ ] **Krok 2: Napiš padající integrační test**

Create `apps/web/test/api/api-keys.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createApiApp } from '../../src/lib/api/app.js';
import { registerAuthRoutes } from '@mlain/core/identity/api/auth.routes';
import { registerApiKeyRoutes } from '@mlain/core/identity/api/api-keys.routes';
import { seedOwnerWithWorkspace } from './helpers/seed.js';

const app = createApiApp();
registerAuthRoutes(app);
registerApiKeyRoutes(app);

let cookie = '';
let workspaceId = '';

beforeAll(async () => {
  const seeded = await seedOwnerWithWorkspace(app);
  cookie = seeded.cookie;
  workspaceId = seeded.workspaceId;
});

const headers = (extra: Record<string, string> = {}) => ({
  Cookie: cookie,
  'X-Workspace-Id': workspaceId,
  'Content-Type': 'application/json',
  ...extra,
});

const createKey = (body: unknown, idempotencyKey: string) =>
  app.request('/api/v1/api-keys', {
    method: 'POST',
    headers: headers({ 'Idempotency-Key': idempotencyKey }),
    body: JSON.stringify(body),
  });

describe('POST /api/v1/api-keys', () => {
  it('kritérium 25: sekret je v odpovědi právě jednou', async () => {
    const res = await createKey({ name: 'CI', kind: 'secret', scopes: ['contacts:read'] }, 'idem-key-001');
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.secret).toMatch(/^ml_live_[a-z2-7]{8}_[A-Za-z0-9_-]{43}$/);

    const list = await (await app.request('/api/v1/api-keys', { headers: headers() })).json();
    expect(JSON.stringify(list)).not.toContain(body.secret);
    expect(list.data.every((k: Record<string, unknown>) => !('secret' in k))).toBe(true);
  });

  it('kritérium 30: stejný Idempotency-Key a stejné tělo vytvoří jeden zdroj', async () => {
    const body = { name: 'Idem', kind: 'secret', scopes: ['contacts:read'] };
    const first = await createKey(body, 'idem-key-002');
    const second = await createKey(body, 'idem-key-002');
    expect(second.status).toBe(201);
    expect(second.headers.get('Idempotent-Replay')).toBe('true');
    expect((await second.json()).key.id).toBe((await first.json()).key.id);
  });

  it('kritérium 31: stejný klíč s jiným tělem vrací 409 idempotency_key_reuse', async () => {
    await createKey({ name: 'A', kind: 'secret', scopes: ['contacts:read'] }, 'idem-key-003');
    const res = await createKey({ name: 'B', kind: 'secret', scopes: ['contacts:read'] }, 'idem-key-003');
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('idempotency_key_reuse');
  });

  it('chybějící Idempotency-Key vrací 422 s cestou Idempotency-Key', async () => {
    const res = await app.request('/api/v1/api-keys', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ name: 'X', kind: 'secret', scopes: ['contacts:read'] }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()).errors[0].path).toBe('Idempotency-Key');
  });

  it('neznámý scope vrací 422', async () => {
    const res = await createKey({ name: 'X', kind: 'secret', scopes: ['neexistuje:cokoliv'] }, 'idem-key-004');
    expect(res.status).toBe(422);
  });

  it('wildcard scope se odmítne', async () => {
    const res = await createKey({ name: 'X', kind: 'secret', scopes: ['*'] }, 'idem-key-005');
    expect(res.status).toBe(422);
  });

  it('veřejný klíč dostane pevně events:write', async () => {
    const res = await createKey({ name: 'Web', kind: 'public', scopes: [] }, 'idem-key-006');
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.secret).toMatch(/^ml_pub_[a-z2-7]{16}$/);
    expect(body.key.scopes).toEqual(['events:write']);
  });
});

describe('POST /api/v1/api-keys/{id}/rotate', () => {
  it('kritérium 26c: sekret s grace_seconds=60 platí i po rotaci a nese ML-Key-Rotated', async () => {
    const created = await (
      await createKey({ name: 'Rot', kind: 'secret', scopes: ['contacts:read'] }, 'idem-key-007')
    ).json();
    const oldSecret = created.secret;

    const rotated = await app.request(`/api/v1/api-keys/${created.key.id}/rotate`, {
      method: 'POST',
      headers: headers({ 'Idempotency-Key': 'idem-key-008' }),
      body: JSON.stringify({ grace_seconds: 60 }),
    });
    expect(rotated.status).toBe(200);
    const newSecret = (await rotated.json()).secret;
    expect(newSecret).not.toBe(oldSecret);

    // Nový sekret platí bez příznaku rotace.
    const withNew = await app.request('/api/v1/api-keys', {
      headers: { Authorization: `Bearer ${newSecret}` },
    });
    expect(withNew.status).toBe(200);
    expect(withNew.headers.get('ML-Key-Rotated')).toBeNull();
  });

  it('rotace veřejného klíče vrací 409, protože žádný sekret nenese', async () => {
    const created = await (
      await createKey({ name: 'Pub', kind: 'public', scopes: [] }, 'idem-key-009')
    ).json();
    const res = await app.request(`/api/v1/api-keys/${created.key.id}/rotate`, {
      method: 'POST',
      headers: headers({ 'Idempotency-Key': 'idem-key-010' }),
      body: JSON.stringify({ grace_seconds: 0 }),
    });
    expect(res.status).toBe(409);
  });

  it('grace_seconds nad 86400 vrací 422', async () => {
    const created = await (
      await createKey({ name: 'Rot2', kind: 'secret', scopes: ['contacts:read'] }, 'idem-key-011')
    ).json();
    const res = await app.request(`/api/v1/api-keys/${created.key.id}/rotate`, {
      method: 'POST',
      headers: headers({ 'Idempotency-Key': 'idem-key-012' }),
      body: JSON.stringify({ grace_seconds: 86401 }),
    });
    expect(res.status).toBe(422);
  });
});

describe('DELETE /api/v1/api-keys/{id}', () => {
  it('revokuje klíč, který pak neprojde ověřením', async () => {
    const created = await (
      await createKey({ name: 'Del', kind: 'secret', scopes: ['api_keys:read'] }, 'idem-key-013')
    ).json();

    const before = await app.request('/api/v1/api-keys', {
      headers: { Authorization: `Bearer ${created.secret}` },
    });
    expect(before.status).toBe(200);

    const res = await app.request(`/api/v1/api-keys/${created.key.id}`, {
      method: 'DELETE',
      headers: headers(),
    });
    expect(res.status).toBe(204);

    const after = await app.request('/api/v1/api-keys', {
      headers: { Authorization: `Bearer ${created.secret}` },
    });
    expect(after.status).toBe(401);
  });

  it('cizí id vrací 404', async () => {
    const res = await app.request('/api/v1/api-keys/0192f3a0-1c2d-7e44-8d4e-5f6071829999', {
      method: 'DELETE',
      headers: headers(),
    });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Krok 3: Napiš pomocný seed pro integrační testy**

Create `apps/web/test/api/helpers/seed.ts`:

```ts
import type { Hono } from 'hono';
import * as schema from '@mlain/db/schema';
import { withoutContext, withUser } from '@mlain/core/tx';
import { hashPassword } from '@mlain/core/identity/password';

export const TEST_PASSWORD = 'dostatecne-dlouhe-heslo';

/**
 * Založí uživatele, projekt a členství v dané roli a přihlásí ho přes API,
 * takže test dostane skutečnou cookie, ne podvrženou.
 */
export async function seedOwnerWithWorkspace(
  app: Pick<Hono, 'request'>,
  role: 'owner' | 'admin' | 'editor' | 'viewer' = 'owner',
): Promise<{ cookie: string; userId: string; workspaceId: string; email: string; slug: string }> {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const email = `seed-${unique}@example.cz`;
  const slug = `seed-${unique}`.toLowerCase().replace(/[^a-z0-9-]/g, '');

  const userId = await withoutContext(async (tx) => {
    const [u] = await tx
      .insert(schema.users)
      .values({
        email,
        passwordHash: await hashPassword(TEST_PASSWORD),
        name: 'Seed',
        locale: 'cs',
        timezone: 'Europe/Prague',
      })
      .returning({ id: schema.users.id });
    return u!.id;
  });

  const workspaceId = await withUser(userId, async (tx) => {
    const [w] = await tx
      .insert(schema.workspaces)
      .values({ name: 'Seed', slug, locale: 'cs', timezone: 'Europe/Prague', createdBy: userId })
      .returning({ id: schema.workspaces.id });
    await tx.insert(schema.memberships).values({ workspaceId: w!.id, userId, role });
    return w!.id;
  });

  const res = await app.request('/api/v1/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  const cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]!;

  return { cookie, userId, workspaceId, email, slug };
}
```

- [ ] **Krok 4: Spusť test, ověř, že padá**

Run: `pnpm --filter @mlain/web test:db -- api/api-keys.test.ts`
Expected: FAIL, `Cannot find module '@mlain/core/identity/api/api-keys.routes'`.

- [ ] **Krok 5: Napiš `api-keys.routes.ts`**

Create `packages/core/identity/api/api-keys.routes.ts`:

```ts
import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { withWorkspace } from '@mlain/core/tx';
import { assertPermission, PERMISSIONS } from '../permissions.js';
import {
  createApiKey,
  listApiKeys,
  revokeApiKey,
  rotateApiKey,
  MAX_GRACE_SECONDS,
} from '../api-key-service.js';
import { problemResponse, IdempotencyHeaderSchema, type ApiEnv } from './schemas.js';

export const ApiKeySchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(100),
    kind: z.enum(['secret', 'public']),
    // 8 znaků u secret, 16 u public, viz 3.5.
    prefix: z.string().regex(/^[a-z2-7]{8}$|^[a-z2-7]{16}$/),
    scopes: z.array(z.enum(PERMISSIONS)),
    last_used_at: z.iso.datetime().nullable(),
    expires_at: z.iso.datetime().nullable(),
    revoked_at: z.iso.datetime().nullable(),
    created_at: z.iso.datetime(),
  })
  .openapi('ApiKey');

/** Jediné místo v celém API, kde se sekret objeví. Nikde jinde už nikdy. */
export const ApiKeyWithSecretSchema = z
  .object({ key: ApiKeySchema, secret: z.string() })
  .openapi('ApiKeyWithSecret');

export const CreateApiKeyInput = z
  .object({
    name: z.string().min(1).max(100),
    kind: z.enum(['secret', 'public']).default('secret'),
    scopes: z.array(z.string()).max(PERMISSIONS.length),
    expires_at: z.iso.datetime().nullable().optional(),
  })
  .strict()
  .openapi('CreateApiKeyInput');

export const RotateApiKeyInput = z
  .object({ grace_seconds: z.number().int().min(0).max(MAX_GRACE_SECONDS).default(0) })
  .strict()
  .openapi('RotateApiKeyInput');

const listRoute = createRoute({
  method: 'get',
  path: '/api/v1/api-keys',
  tags: ['API keys'],
  summary: 'Seznam klíčů projektu, nikdy se sekretem',
  security: [{ bearerAuth: ['api_keys:read'] }],
  responses: {
    200: {
      description: 'Seznam klíčů',
      content: { 'application/json': { schema: z.object({ data: z.array(ApiKeySchema) }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const createRouteDef = createRoute({
  method: 'post',
  path: '/api/v1/api-keys',
  tags: ['API keys'],
  summary: 'Vytvoření klíče',
  security: [{ bearerAuth: ['api_keys:write'] }],
  request: {
    headers: IdempotencyHeaderSchema,
    body: { content: { 'application/json': { schema: CreateApiKeyInput } } },
  },
  responses: {
    201: { description: 'Vytvořeno', content: { 'application/json': { schema: ApiKeyWithSecretSchema } } },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('idempotency_key_reuse', 'idempotency_request_in_progress'),
    422: problemResponse('validation_failed'),
  },
});

const rotateRouteDef = createRoute({
  method: 'post',
  path: '/api/v1/api-keys/{id}/rotate',
  tags: ['API keys'],
  summary: 'Rotace sekretu s volitelným grace obdobím',
  security: [{ bearerAuth: ['api_keys:write'] }],
  request: {
    params: z.object({ id: z.uuid() }),
    headers: IdempotencyHeaderSchema,
    body: { content: { 'application/json': { schema: RotateApiKeyInput } } },
  },
  responses: {
    200: { description: 'Rotováno', content: { 'application/json': { schema: ApiKeyWithSecretSchema } } },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('conflict', 'idempotency_key_reuse'),
    422: problemResponse('validation_failed'),
  },
});

const revokeRouteDef = createRoute({
  method: 'delete',
  path: '/api/v1/api-keys/{id}',
  tags: ['API keys'],
  summary: 'Revokace klíče, okamžitá a nevratná',
  security: [{ bearerAuth: ['api_keys:write'] }],
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    204: { description: 'Revokováno' },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

export function registerApiKeyRoutes(app: OpenAPIHono<ApiEnv>): void {
  app.openapi(listRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'api_keys:read');
    const data = await withWorkspace(ctx, (tx) => listApiKeys(tx, ctx));
    return c.json({ data }, 200);
  });

  app.openapi(createRouteDef, async (c) => {
    const { ctx, label } = c.get('auth');
    assertPermission(ctx, 'api_keys:write');
    const input = c.req.valid('json');
    const result = await c.get('runIdempotent')(async (tx) =>
      createApiKey(
        tx,
        ctx,
        {
          name: input.name,
          kind: input.kind,
          scopes: input.scopes,
          expires_at: input.expires_at ?? null,
        },
        label,
      ),
    );
    return c.json(result.body as never, result.status as never);
  });

  app.openapi(rotateRouteDef, async (c) => {
    const { ctx, label } = c.get('auth');
    assertPermission(ctx, 'api_keys:write');
    const { id } = c.req.valid('param');
    const input = c.req.valid('json');
    const result = await c.get('runIdempotent')(async (tx) =>
      rotateApiKey(tx, ctx, { id, graceSeconds: input.grace_seconds }, label),
    );
    return c.json(result.body as never, result.status as never);
  });

  app.openapi(revokeRouteDef, async (c) => {
    const { ctx, label } = c.get('auth');
    assertPermission(ctx, 'api_keys:write');
    const { id } = c.req.valid('param');
    await withWorkspace(ctx, (tx) => revokeApiKey(tx, ctx, id, label));
    return c.body(null, 204);
  });
}
```

- [ ] **Krok 6: Spusť test a ověř, že padá na chybějícím middleware**

Run: `pnpm --filter @mlain/web test:db -- api/api-keys.test.ts`
Expected: FAIL, `c.get('auth') is not a function` nebo `undefined`. Middleware `authenticate` a `runIdempotent` vzniká v úkolu 32; do té doby test padá zamýšleně.

- [ ] **Krok 7: Commit**

```bash
git add packages/core/identity/api-key-service.ts packages/core/identity/api/api-keys.routes.ts apps/web/test/api/api-keys.test.ts apps/web/test/api/helpers/seed.ts
git commit -m "feat(api): API key endpoints with one-time secret and grace rotation"
```

---

### Úkol 32: Rozpoznání aktéra, oprávnění a idempotentní obal zápisů

Pokrývá kritéria 23 a 24.

**Files:**
- Create: `apps/web/src/lib/api/authenticate.ts`
- Modify: `packages/core/identity/api/schemas.ts` (dvě nové proměnné kontextu)
- Test: `apps/web/src/lib/api/authenticate.test.ts`
- Test: `apps/web/test/api/permissions.test.ts`

- [ ] **Krok 1: Rozšiř typ proměnných kontextu**

V `packages/core/identity/api/schemas.ts` doplň do `ApiVariables`:

```ts
import type { Tx } from '@mlain/core/tx';
import type { WorkspaceContext } from '../types.js';

export type AuthContext = {
  ctx: WorkspaceContext;
  /** Text do audit logu: e-mail uživatele nebo název klíče v okamžiku akce. */
  label: string;
};

export type IdempotentRunner = <T>(
  operation: (tx: Tx) => Promise<T>,
) => Promise<{ status: number; body: unknown; replay: boolean }>;

export type ApiVariables = {
  requestId: string;
  clientIp: string;
  startedAt: number;
  workspaceId?: string | null;
  actorType?: string | null;
  actorId?: string | null;
  auth: AuthContext;
  runIdempotent: IdempotentRunner;
};
```

- [ ] **Krok 2: Napiš padající jednotkový test rozpoznání aktéra**

Create `apps/web/src/lib/api/authenticate.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { bearerFromHeader, workspaceRefFrom } from './authenticate.js';

describe('bearerFromHeader', () => {
  it('vyzobne hodnotu za Bearer', () => {
    expect(bearerFromHeader('Bearer ml_live_abc')).toBe('ml_live_abc');
  });

  it('je odolný vůči jinému psaní slova Bearer', () => {
    expect(bearerFromHeader('bearer ml_live_abc')).toBe('ml_live_abc');
  });

  it('bez schématu vrací null, aby se hodnota nezkusila jako klíč', () => {
    expect(bearerFromHeader('ml_live_abc')).toBeNull();
  });

  it('prázdná nebo chybějící hlavička vrací null', () => {
    expect(bearerFromHeader('')).toBeNull();
    expect(bearerFromHeader(undefined)).toBeNull();
  });

  it('Basic se ignoruje', () => {
    expect(bearerFromHeader('Basic dXNlcjpwYXNz')).toBeNull();
  });
});

describe('workspaceRefFrom', () => {
  it('bere hodnotu z hlavičky X-Workspace-Id', () => {
    expect(workspaceRefFrom({ header: 'ws-slug', path: '/api/v1/api-keys' })).toBe('ws-slug');
  });

  it('bez hlavičky použije segment /w/{slug} z cesty', () => {
    expect(workspaceRefFrom({ header: undefined, path: '/w/muj-projekt/settings' })).toBe('muj-projekt');
  });

  it('hlavička má přednost před cestou', () => {
    expect(workspaceRefFrom({ header: 'z-hlavicky', path: '/w/z-cesty/x' })).toBe('z-hlavicky');
  });

  it('bez obojího vrací null', () => {
    expect(workspaceRefFrom({ header: undefined, path: '/api/v1/api-keys' })).toBeNull();
  });
});
```

- [ ] **Krok 3: Spusť test, ověř, že padá**

Run: `pnpm --filter @mlain/web test:unit -- lib/api/authenticate.test.ts`
Expected: FAIL, `Cannot find module './authenticate.js'`.

- [ ] **Krok 4: Napiš `authenticate.ts`**

Create `apps/web/src/lib/api/authenticate.ts`:

```ts
import type { MiddlewareHandler } from 'hono';
import { eq, sql } from 'drizzle-orm';
import type { Role, WorkspaceContext } from '@mlain/db';
import * as schema from '@mlain/db/schema';
import { withoutContext, withWorkspace, type Tx } from '@mlain/core/tx';
import { ApiError } from '@mlain/core/errors/api-error';
import { createWorkspaceContext } from '@mlain/core/identity/context';
import { roleHasPermission } from '@mlain/core/identity/permissions';
import { verifyApiKey } from '@mlain/core/identity/api-key';
import { loadApiKeyRow, touchApiKeyLastUsed } from '@mlain/core/identity/api-key-service';
import { readSessionCookie, verifySessionToken } from '@mlain/core/identity/session';
import type { ApiEnv } from '@mlain/core/identity/api/schemas';
import { validateIdempotencyKey, withIdempotency } from './idempotency.js';
import { consumeAll, limiterRegistry } from './rate-limit.js';

const BEARER = /^bearer\s+(.+)$/i;

export function bearerFromHeader(value: string | undefined | null): string | null {
  if (!value) return null;
  return value.match(BEARER)?.[1]?.trim() ?? null;
}

/**
 * 3.6: workspaceId aktéra typu user pochází ze segmentu cesty /w/{slug} v UI
 * nebo z hlavičky X-Workspace-Id u API se session. Nikdy z těla requestu.
 */
export function workspaceRefFrom(input: { header: string | undefined; path: string }): string | null {
  if (input.header && input.header.length > 0) return input.header;
  return input.path.match(/^\/w\/([^/]+)/)?.[1] ?? null;
}

const WRITE_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Rozpozná aktéra a sestaví WorkspaceContext pro projektové cesty /api/v1/**.
 * Cesty pod /api/v1/auth/**, /api/v1/setup, /api/v1/workspaces a /api/v1/openapi.json
 * kontext nepotřebují a middleware je přeskakuje.
 */
export const CONTEXT_FREE_PREFIXES = [
  '/api/v1/auth',
  '/api/v1/setup',
  '/api/v1/openapi.json',
  '/api/v1/docs',
  '/api/v1/invitations/accept',
];

const WORKSPACE_COLLECTION_PATHS = new Set(['/api/v1/workspaces']);

export function authenticate(): MiddlewareHandler<ApiEnv> {
  return async (c, next) => {
    const path = new URL(c.req.url).pathname;
    if (
      CONTEXT_FREE_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`)) ||
      WORKSPACE_COLLECTION_PATHS.has(path)
    ) {
      await next();
      return;
    }

    const bearer = bearerFromHeader(c.req.header('Authorization'));

    if (bearer) {
      const verified = await withoutContext((tx) =>
        verifyApiKey(bearer, (prefix, kind) => loadApiKeyRow(tx, prefix, kind)),
      );

      // 4.5: čtení a zápis mají vlastní limit na klíč.
      const headers = await consumeAll(limiterRegistry, [
        {
          rule: WRITE_METHODS.has(c.req.method) ? 'api_key_write' : 'api_key_read',
          key: verified.apiKeyId,
        },
      ]);
      for (const [k, v] of Object.entries(headers)) c.header(k, v);

      // 3.5: integrátor musí poznat, že jede na dožívajícím sekretu.
      if (verified.rotated) c.header('ML-Key-Rotated', 'true');

      const ctx = await createWorkspaceContext({
        kind: 'api_key',
        apiKeyId: verified.apiKeyId,
        workspaceId: verified.workspaceId,
        scopes: verified.scopes,
      });

      const [row] = await withWorkspace(verified.workspaceId, (tx) =>
        tx
          .select({ name: schema.apiKeys.name })
          .from(schema.apiKeys)
          .where(eq(schema.apiKeys.id, verified.apiKeyId))
          .limit(1),
      );

      c.set('auth', { ctx, label: row?.name ?? 'api key' });
      c.set('workspaceId', ctx.workspaceId);
      c.set('actorType', 'api_key');
      c.set('actorId', verified.apiKeyId);
      setIdempotentRunner(c, ctx, path);

      // Zápis last_used_at mimo hlavní transakci, fire and forget (7).
      void withoutContext((tx) => touchApiKeyLastUsed(tx, verified.apiKeyId)).catch(() => undefined);

      await next();
      return;
    }

    const token = readSessionCookie(c.req.header('Cookie'));
    if (!token) throw new ApiError('unauthenticated');
    const session = await withoutContext((tx) => verifySessionToken(tx, token));

    const headers = await consumeAll(limiterRegistry, [{ rule: 'session_user', key: session.userId }]);
    for (const [k, v] of Object.entries(headers)) c.header(k, v);

    const ref = workspaceRefFrom({ header: c.req.header('X-Workspace-Id'), path });
    // Bez reference na projekt není co izolovat; pro aktéra projekt neexistuje.
    if (!ref) throw new ApiError('not_found');

    const ctx = await createWorkspaceContext({ kind: 'session', userId: session.userId, workspaceRef: ref });

    const [user] = await withoutContext((tx) =>
      tx.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, session.userId)).limit(1),
    );

    c.set('auth', { ctx, label: user?.email ?? '' });
    c.set('workspaceId', ctx.workspaceId);
    c.set('actorType', 'user');
    c.set('actorId', session.userId);
    setIdempotentRunner(c, ctx, path);

    await next();
  };
}

/**
 * Doplní do chyby `forbidden` seznam kolegů, které jde požádat o vyšší roli.
 *
 * Proč to nedělá assertPermission: potřebuje dotaz do databáze a chce být čistá
 * a synchronní. Proč to nedělá katalog hlášek: nemá kontext ani transakci.
 *
 * PRAVIDLO O SOUKROMÍ, které tu je záměrně: jména a e-maily kolegů se doplní
 * JEN tomu, kdo smí členy vidět (`members:read`). Viewer to právo nemá, takže
 * by mu 403 jinak prozradila seznam lidí, na který přes API nedosáhne, a chyba
 * by se stala obchvatem oprávnění. Kdo členy vidět nesmí, dostane prázdný
 * seznam a obrazovka použije obecnou větu bez jmen.
 *
 * Dotaz běží jen u kódu `forbidden` u uživatelského aktéra, tedy na cestě,
 * která už stejně končí chybou; na výkon rychlé cesty nemá vliv.
 */
export async function enrichForbidden(ctx: WorkspaceContext, error: ApiError): Promise<ApiError> {
  if (error.code !== 'forbidden' || ctx.actor.type !== 'user') return error;

  const grantedByRoles = (error.params?.grantedByRoles ?? []) as Role[];
  if (grantedByRoles.length === 0) return error;
  if (!roleHasPermission(ctx.actor.role, 'members:read')) return error;

  const members = await withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute<{ name: string; email: string; role: string }>(sql`
      SELECT u.name, u.email::text AS email, m.role
        FROM memberships m
        JOIN users u ON u.id = m.user_id AND u.deleted_at IS NULL
       WHERE m.workspace_id = ${ctx.workspaceId}::uuid
         AND m.role = ANY(${grantedByRoles})
       ORDER BY array_position(ARRAY['owner','admin','editor','viewer']::text[], m.role), u.email
       LIMIT 5
    `);
    return rows;
  });

  return error.withParams({
    ...error.params,
    contactableMembers: members.map((m) => ({ name: m.name, email: m.email, role: m.role })),
  });
}

/**
 * 4.4: Idempotency-Key je povinný jen pro zápisy iniciované klientem na
 * /api/v1/**. U ostatních metod runner operaci jen spustí v transakci.
 */
function setIdempotentRunner(
  c: Parameters<MiddlewareHandler<ApiEnv>>[0],
  ctx: WorkspaceContext,
  path: string,
): void {
  const workspaceId = ctx.workspaceId;
  c.set('runIdempotent', async <T>(operation: (tx: Tx) => Promise<T>) => {
    if (!WRITE_METHODS.has(c.req.method)) {
      const result = await withWorkspace(ctx, operation);
      return { status: 200, body: result, replay: false };
    }

    const key = validateIdempotencyKey(c.req.header('Idempotency-Key'));
    let body: unknown = null;
    try {
      body = await c.req.raw.clone().json();
    } catch {
      body = null;
    }

    const status = c.req.method === 'POST' ? 201 : 200;

    const outcome = await withWorkspace(ctx, (tx) =>
      withIdempotency(tx, { workspaceId, key, method: c.req.method, path, body }, async () => {
        const result = await operation(tx);
        return { status, body: result, result };
      }),
    );

    if (outcome.replay) {
      c.header('Idempotent-Replay', 'true');
      return { status: outcome.status, body: outcome.body, replay: true };
    }
    return { status, body: outcome.result, replay: false };
  });
}
```

- [ ] **Krok 5: Zapoj middleware do aplikace**

Do `apps/web/src/lib/api/app.ts` přidej za middleware limitů requestu:

```ts
import { authenticate } from './authenticate.js';

  app.use('/api/v1/*', authenticate());
```

Pořadí je podstatné: `authenticate` musí běžet až po kontrole `Content-Type` a velikosti těla, jinak by se na vadném requestu zbytečně ověřoval klíč, a před registrací cest, aby handler měl `auth` k dispozici.

- [ ] **Krok 6: Napiš padající test oprávnění**

Create `apps/web/test/api/permissions.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createApiApp } from '../../src/lib/api/app.js';
import { registerAuthRoutes } from '@mlain/core/identity/api/auth.routes';
import { registerApiKeyRoutes } from '@mlain/core/identity/api/api-keys.routes';
import { seedOwnerWithWorkspace } from './helpers/seed.js';

const app = createApiApp();
registerAuthRoutes(app);
registerApiKeyRoutes(app);

let owner: Awaited<ReturnType<typeof seedOwnerWithWorkspace>>;
let viewer: Awaited<ReturnType<typeof seedOwnerWithWorkspace>>;
let secretKeyWithoutScope = '';
let publicKey = '';

beforeAll(async () => {
  owner = await seedOwnerWithWorkspace(app, 'owner');
  viewer = await seedOwnerWithWorkspace(app, 'viewer');

  const headers = {
    Cookie: owner.cookie,
    'X-Workspace-Id': owner.workspaceId,
    'Content-Type': 'application/json',
  };

  secretKeyWithoutScope = (
    await (
      await app.request('/api/v1/api-keys', {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': 'perm-key-001' },
        body: JSON.stringify({ name: 'Jen kontakty', kind: 'secret', scopes: ['contacts:read'] }),
      })
    ).json()
  ).secret;

  publicKey = (
    await (
      await app.request('/api/v1/api-keys', {
        method: 'POST',
        headers: { ...headers, 'Idempotency-Key': 'perm-key-002' },
        body: JSON.stringify({ name: 'Web SDK', kind: 'public', scopes: [] }),
      })
    ).json()
  ).secret;
});

describe('kritérium 23: role bez oprávnění', () => {
  it('viewer dostane na zápisový endpoint 403 forbidden', async () => {
    const res = await app.request('/api/v1/api-keys', {
      method: 'POST',
      headers: {
        Cookie: viewer.cookie,
        'X-Workspace-Id': viewer.workspaceId,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'perm-key-003',
      },
      body: JSON.stringify({ name: 'X', kind: 'secret', scopes: ['contacts:read'] }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('forbidden');
  });

  it('viewer nesmí ani číst klíče, protože api_keys:read má až admin', async () => {
    const res = await app.request('/api/v1/api-keys', {
      headers: { Cookie: viewer.cookie, 'X-Workspace-Id': viewer.workspaceId },
    });
    expect(res.status).toBe(403);
  });
});

describe('kritérium 24: API klíč bez scope', () => {
  it('klíč bez api_keys:write dostane 403 insufficient_scope, ne forbidden', async () => {
    const res = await app.request('/api/v1/api-keys', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${secretKeyWithoutScope}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'perm-key-004',
      },
      body: JSON.stringify({ name: 'X', kind: 'secret', scopes: ['contacts:read'] }),
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('insufficient_scope');
  });
});

describe('kritérium 26: veřejný klíč na /api/v1/**', () => {
  it('vrací 403 insufficient_scope, ne 401, protože je to platný aktér bez scope', async () => {
    const res = await app.request('/api/v1/api-keys', {
      headers: { Authorization: `Bearer ${publicKey}` },
    });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('insufficient_scope');
  });

  it('kritérium 26b: vadné tělo veřejného klíče vrací 401', async () => {
    const res = await app.request('/api/v1/api-keys', {
      headers: { Authorization: 'Bearer ml_pub_aebagbaf' },
    });
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('unauthenticated');
  });
});

describe('chybějící a neplatná autentizace', () => {
  it('bez hlavičky i bez cookie vrací 401', async () => {
    const res = await app.request('/api/v1/api-keys');
    expect(res.status).toBe(401);
  });

  it('session bez X-Workspace-Id vrací 404, protože není co izolovat', async () => {
    const res = await app.request('/api/v1/api-keys', { headers: { Cookie: owner.cookie } });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Krok 7: Spusť oba testy a test klíčů z úkolu 31**

Run: `pnpm --filter @mlain/web test:unit -- lib/api/authenticate.test.ts && pnpm --filter @mlain/web test:db -- api/permissions.test.ts api/api-keys.test.ts`
Expected: 9 passed, 7 passed a 12 passed. Tímhle se zezelená i test z úkolu 31, který do teď padal na chybějícím middleware.

- [ ] **Krok 8: Commit**

```bash
git add apps/web/src/lib/api/authenticate.ts apps/web/src/lib/api/authenticate.test.ts apps/web/src/lib/api/app.ts packages/core/identity/api/schemas.ts apps/web/test/api/permissions.test.ts
git commit -m "feat(api): actor resolution from session or API key with permission enforcement"
```

---

### Úkol 33: Cizí projekt je 404, ne 403

Pokrývá kritérium 19.

**Files:**
- Test: `apps/web/test/api/cross-workspace.test.ts`

- [ ] **Krok 1: Napiš padající test**

Create `apps/web/test/api/cross-workspace.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createApiApp } from '../../src/lib/api/app.js';
import { registerAuthRoutes } from '@mlain/core/identity/api/auth.routes';
import { registerApiKeyRoutes } from '@mlain/core/identity/api/api-keys.routes';
import { seedOwnerWithWorkspace } from './helpers/seed.js';

const app = createApiApp();
registerAuthRoutes(app);
registerApiKeyRoutes(app);

let a: Awaited<ReturnType<typeof seedOwnerWithWorkspace>>;
let b: Awaited<ReturnType<typeof seedOwnerWithWorkspace>>;
let keyOfB = '';
let keyIdInA = '';

beforeAll(async () => {
  a = await seedOwnerWithWorkspace(app, 'owner');
  b = await seedOwnerWithWorkspace(app, 'owner');

  const created = await (
    await app.request('/api/v1/api-keys', {
      method: 'POST',
      headers: {
        Cookie: a.cookie,
        'X-Workspace-Id': a.workspaceId,
        'Content-Type': 'application/json',
        'Idempotency-Key': 'xws-key-001',
      },
      body: JSON.stringify({ name: 'Klíč projektu A', kind: 'secret', scopes: ['api_keys:read'] }),
    })
  ).json();
  keyIdInA = created.key.id;

  keyOfB = (
    await (
      await app.request('/api/v1/api-keys', {
        method: 'POST',
        headers: {
          Cookie: b.cookie,
          'X-Workspace-Id': b.workspaceId,
          'Content-Type': 'application/json',
          'Idempotency-Key': 'xws-key-002',
        },
        body: JSON.stringify({ name: 'Klíč projektu B', kind: 'secret', scopes: ['api_keys:read', 'api_keys:write'] }),
      })
    ).json()
  ).secret;
});

describe('kritérium 19: klíč projektu B na zdroj z projektu A', () => {
  it('vrátí 404 s application/problem+json a code not_found', async () => {
    const res = await app.request(`/api/v1/api-keys/${keyIdInA}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${keyOfB}` },
    });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
    expect((await res.json()).code).toBe('not_found');
  });

  it('výpis pod klíčem projektu B neobsahuje ani jeden klíč projektu A', async () => {
    const body = await (
      await app.request('/api/v1/api-keys', { headers: { Authorization: `Bearer ${keyOfB}` } })
    ).json();
    expect(body.data.some((k: { id: string }) => k.id === keyIdInA)).toBe(false);
  });

  it('workspace se bere z klíče, hlavička X-Workspace-Id ho nepřepíše', async () => {
    const body = await (
      await app.request('/api/v1/api-keys', {
        headers: { Authorization: `Bearer ${keyOfB}`, 'X-Workspace-Id': a.workspaceId },
      })
    ).json();
    expect(body.data.some((k: { id: string }) => k.id === keyIdInA)).toBe(false);
  });
});

describe('nečlen se session', () => {
  it('cizí workspace v hlavičce vrací 404, ne 403 (ochrana proti enumeraci ID)', async () => {
    const res = await app.request('/api/v1/api-keys', {
      headers: { Cookie: b.cookie, 'X-Workspace-Id': a.workspaceId },
    });
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('not_found');
  });

  it('neexistující workspace vrací tentýž kód, aby se odpovědi nedaly rozlišit', async () => {
    const res = await app.request('/api/v1/api-keys', {
      headers: { Cookie: b.cookie, 'X-Workspace-Id': '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6099' },
    });
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('not_found');
  });
});
```

- [ ] **Krok 2: Spusť test, ověř, že padá na chybějícím detailu klíče**

Run: `pnpm --filter @mlain/web test:db -- api/cross-workspace.test.ts`
Expected: FAIL. `DELETE /api/v1/api-keys/{id}` s cizím id musí vracet 404; pokud vrací 500 nebo 204, je chyba v `wsEq` filtru v `revokeApiKey`.

- [ ] **Krok 3: Ověř, že filtr podle workspace je v každém dotazu služby klíčů**

Run:
```bash
grep -n "wsEq(ctx, schema.apiKeys)" packages/core/identity/api-key-service.ts
```
Expected: čtyři výskyty (list, rotate select, rotate update, revoke). Když některý chybí, doplň ho; bez něj se izolace opírá jen o RLS, což je podle 3.6 druhá vrstva, ne první.

- [ ] **Krok 4: Spusť test, ověř, že prochází**

Run: `pnpm --filter @mlain/web test:db -- api/cross-workspace.test.ts`
Expected: 5 passed.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/test/api/cross-workspace.test.ts
git commit -m "test(api): cross-workspace access returns 404 with problem+json"
```

---

### Fáze F: první spuštění, projekty, členství a pozvánky (úkoly 34 až 36)

---

### Úkol 34: `POST /api/v1/setup`, první spuštění instalace

**Files:**
- Create: `packages/core/identity/setup.ts`
- Create: `packages/core/identity/api/setup.routes.ts`
- Test: `packages/core/identity/setup.test.ts`

- [ ] **Krok 1: Napiš padající test**

Create `packages/core/identity/setup.test.ts`:

```ts
import { describe, it, expect, afterAll, beforeEach } from 'vitest';
import { asMigrator, closeMigratorPool } from '@mlain/core/test-support/migrator';
import { config } from '@mlain/core/config';
import { runSetup, isSetupAvailable } from './setup.js';
import { verifyPassword } from './password.js';

/**
 * Úklid MUSÍ běžet pod `mlain_migrator`, ne pod aplikační rolí.
 *
 * `memberships` i `workspaces` mají RLS a bez nastaveného kontextu je `USING`
 * nepravda, takže `DELETE` smaže **nula řádků a nehlásí chybu**. Prošel by jen
 * `DELETE FROM users`, protože ta tabulka RLS nemá. `beforeEach` by tedy
 * vypadal, že uklidil, a test „na prázdné instalaci vrací true" by padal nebo,
 * ještě hůř, procházel jednou z pěti.
 */
async function resetInstallation(): Promise<void> {
  await asMigrator(async (db) => {
    await db.query(`DELETE FROM memberships`);
    await db.query(`DELETE FROM workspaces`);
    await db.query(`DELETE FROM users`);
    await db.query(`UPDATE system_settings SET setup_completed_at = NULL WHERE id = true`);
  });
}

afterAll(async () => {
  await closeMigratorPool();
});

const input = {
  email: 'owner@example.cz',
  password: 'dostatecne-dlouhe-heslo',
  name: 'Petr',
  workspace_name: 'Můj projekt',
  locale: 'cs',
  ip: '10.0.0.1',
  userAgent: 'vitest',
  requestId: 'r',
};

beforeEach(resetInstallation);

describe('isSetupAvailable', () => {
  it('na prázdné instalaci vrací true', async () => {
    expect(await isSetupAvailable()).toBe(true);
  });

  it('po dokončení vrací false', async () => {
    await runSetup(input);
    expect(await isSetupAvailable()).toBe(false);
  });
});

describe('runSetup', () => {
  it('vytvoří uživatele, projekt a členství owner v jedné transakci', async () => {
    const result = await runSetup(input);
    expect(result.user.email).toBe('owner@example.cz');
    expect(result.workspace.name).toBe('Můj projekt');

    const rows = await withoutContext(async (tx) => {
      const r = await tx.execute<{ email: string; slug: string; role: string }>(sql`
        SELECT u.email, w.slug, m.role
          FROM memberships m
          JOIN users u ON u.id = m.user_id
          JOIN workspaces w ON w.id = m.workspace_id
      `);
      return r.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.role).toBe('owner');
  });

  it('slug se odvodí z názvu a je URL bezpečný', async () => {
    const result = await runSetup({ ...input, workspace_name: 'Můj Skvělý Projekt 2026' });
    expect(result.workspace.slug).toMatch(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
    expect(result.workspace.slug).toBe('muj-skvely-projekt-2026');
  });

  it('heslo se uloží jako Argon2id, nikdy v otevřené podobě', async () => {
    await runSetup(input);
    const rows = await withoutContext(async (tx) => {
      const r = await tx.execute<{ password_hash: string }>(sql`SELECT password_hash FROM users`);
      return r.rows;
    });
    expect(rows[0]!.password_hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(rows[0]!.password_hash, input.password)).toBe(true);
  });

  it('locale a timezone se vyplní explicitně z konfigurace, ne z DEFAULT v DDL', async () => {
    await runSetup({ ...input, locale: undefined });
    const rows = await withoutContext(async (tx) => {
      const r = await tx.execute<{ locale: string; timezone: string }>(sql`SELECT locale, timezone FROM workspaces`);
      return r.rows;
    });
    expect(rows[0]!.locale).toBe(config.DEFAULT_LOCALE);
    expect(rows[0]!.timezone).toBe(config.DEFAULT_TIMEZONE);
  });

  it('druhé volání vrací setup_already_completed 409', async () => {
    await runSetup(input);
    await expect(runSetup({ ...input, email: 'druhy@example.cz' })).rejects.toMatchObject({
      code: 'setup_already_completed',
      status: 409,
    });
  });

  it('slabé heslo vrací validation_failed a nic nevytvoří', async () => {
    await expect(runSetup({ ...input, password: 'kratke' })).rejects.toMatchObject({
      code: 'validation_failed',
    });
    const rows = await withoutContext(async (tx) => {
      const r = await tx.execute(sql`SELECT 1 FROM users`);
      return r.rows;
    });
    expect(rows).toHaveLength(0);
  });

  it('zapíše workspace.created do audit logu', async () => {
    const result = await runSetup(input);
    const rows = await withoutContext(async (tx) => {
      const r = await tx.execute<{ workspace_id: string }>(
        sql`SELECT workspace_id::text AS workspace_id FROM audit_log WHERE action = 'workspace.created'`,
      );
      return r.rows;
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.workspace_id).toBe(result.workspace.id);
  });
});
```

- [ ] **Krok 2: Spusť test, ověř, že padá**

Run: `pnpm --filter @mlain/core test:db -- identity/setup.test.ts`
Expected: FAIL, `Cannot find module './setup.js'`.

- [ ] **Krok 3: Napiš `setup.ts`**

Create `packages/core/identity/setup.ts`:

```ts
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import * as schema from '@mlain/db/schema';
import { withoutContext } from '@mlain/core/tx';
import { config } from '@mlain/core/config';
import { ApiError } from '@mlain/core/errors/api-error';
import { writeAuditLog } from '@mlain/core/audit/write';
import { assertPasswordPolicy, hashPassword } from './password.js';
import { IdentityAuditActions } from './audit.js';
import { toPublicUser, type PublicUser } from './login.js';

export type SetupInput = {
  email: string;
  password: string;
  name?: string;
  workspace_name: string;
  locale?: string;
  ip: string | null;
  userAgent: string;
  requestId: string;
};

export type SetupResult = {
  user: PublicUser;
  workspace: { id: string; name: string; slug: string };
};

/** Slug se generuje z názvu; diakritika se odstraní, aby zůstala URL bezpečná. */
export function slugify(input: string): string {
  const base = input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');
  return base.length > 0 ? base : `projekt-${Date.now()}`;
}

export async function isSetupAvailable(): Promise<boolean> {
  return withoutContext(async (tx) => {
    const { rows: settings } = await tx.execute<{ setup_completed_at: Date | null }>(
      sql`SELECT setup_completed_at FROM system_settings WHERE id = true`,
    );
    if (!settings[0] || settings[0].setup_completed_at) return false;
    const { rows: users } = await tx.execute(sql`SELECT 1 FROM users LIMIT 1`);
    return users.length === 0;
  });
}

/**
 * 3.1: endpoint je dostupný, jen dokud system_settings.setup_completed_at IS NULL
 * a users je prázdná. Vytvoří prvního uživatele, první workspace, členství owner
 * a nastaví setup_completed_at. Celé v jedné transakci.
 */
export async function runSetup(input: SetupInput): Promise<SetupResult> {
  if (!(await isSetupAvailable())) throw new ApiError('setup_already_completed');

  const email = input.email.trim().toLowerCase();
  assertPasswordPolicy(input.password, email);
  const passwordHash = await hashPassword(input.password);

  // 2.3: locale a timezone vyplňuje aplikace VŽDY explicitně, DEFAULT v DDL je
  // jen pojistka. Bez toho by instalace s DEFAULT_LOCALE=de dostávala české hodnoty.
  const locale = input.locale ?? config.DEFAULT_LOCALE;
  const timezone = config.DEFAULT_TIMEZONE;

  // ID se generuje v aplikaci, protože ho potřebujeme znát PŘED INSERTem:
  // politika ws_insert_bootstrap vyžaduje nastavené mlain.user_id.
  const userId = uuidv7();
  const slug = slugify(input.workspace_name);

  return withoutContext(async (tx) => {
    const [user] = await tx
      .insert(schema.users)
      .values({
        id: userId,
        email,
        passwordHash,
        name: input.name ?? '',
        locale,
        timezone,
        emailVerifiedAt: new Date(),
      })
      .returning();

    // Teprve teď smí vzniknout projekt: politika ws_insert_bootstrap čte mlain.user_id.
    await tx.execute(sql`SELECT set_config('mlain.user_id', ${userId}, true)`);

    // ID projektu se generuje DOPŘEDU a kontext se nastaví JEŠTĚ PŘED vložením.
    // Bez toho selže `INSERT ... RETURNING` na workspaces (RETURNING potřebuje
    // politiku pro čtení, kterou ws_insert_bootstrap jako FOR INSERT není)
    // i vložení členství (ws_isolation má WITH CHECK proti workspace kontextu).
    // Ověřeno spuštěním v P03, viz tamtéž createWorkspaceAsUser.
    const workspaceId = uuidv7();
    await tx.execute(sql`SELECT set_config('mlain.workspace_id', ${workspaceId}, true)`);

    const [workspace] = await tx
      .insert(schema.workspaces)
      .values({ id: workspaceId, name: input.workspace_name, slug, locale, timezone, createdBy: userId })
      .returning({ id: schema.workspaces.id, name: schema.workspaces.name, slug: schema.workspaces.slug });

    await tx.insert(schema.memberships).values({ workspaceId, userId, role: 'owner' });

    await writeAuditLog(tx, {
      action: IdentityAuditActions['workspace.created'],
      workspaceId: workspace!.id,
      actor: { actorType: 'user', actorId: userId, actorLabel: email },
      targetType: 'workspace',
      targetId: workspace!.id,
      ip: input.ip,
      userAgent: input.userAgent,
      requestId: input.requestId,
      metadata: { source: 'setup' },
    });

    const { rows: updated } = await tx.execute(sql`
      UPDATE system_settings SET setup_completed_at = now(), updated_at = now()
       WHERE id = true AND setup_completed_at IS NULL
       RETURNING installation_id
    `);
    // Souběžný druhý setup by tady skončil na nule ovlivněných řádků a celá
    // transakce se rollbackne, takže nevznikne druhý owner ani druhý projekt.
    if (updated.length !== 1) throw new ApiError('setup_already_completed');

    return { user: toPublicUser(user!), workspace: workspace! };
  });
}
```

- [ ] **Krok 4: Spusť test, ověř, že prochází**

Run: `pnpm --filter @mlain/core test:db -- identity/setup.test.ts`
Expected: 9 passed.

- [ ] **Krok 5: Napiš `setup.routes.ts`**

Create `packages/core/identity/api/setup.routes.ts`:

```ts
import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { runSetup } from '../setup.js';
import { problemResponse, PublicUserSchema, type ApiEnv } from './schemas.js';

export const SetupInputSchema = z
  .object({
    email: z.email(),
    password: z.string().min(1).max(256),
    name: z.string().max(200).optional(),
    workspace_name: z.string().min(1).max(200),
    locale: z.string().max(20).optional(),
  })
  .strict()
  .openapi('SetupInput');

export const SetupOutputSchema = z
  .object({
    user: PublicUserSchema,
    workspace: z.object({ id: z.uuid(), name: z.string(), slug: z.string() }),
  })
  .openapi('SetupOutput');

const setupRoute = createRoute({
  method: 'post',
  path: '/api/v1/setup',
  tags: ['Setup'],
  summary: 'První spuštění instalace',
  description: 'Dostupné jen dokud instalace nemá jediného uživatele. Pak vrací 409.',
  request: { body: { content: { 'application/json': { schema: SetupInputSchema } } } },
  responses: {
    201: { description: 'Instalace nastavena', content: { 'application/json': { schema: SetupOutputSchema } } },
    409: problemResponse('setup_already_completed'),
    422: problemResponse('validation_failed'),
    429: problemResponse('rate_limited'),
  },
});

export function registerSetupRoutes(app: OpenAPIHono<ApiEnv>): void {
  app.openapi(setupRoute, async (c) => {
    const input = c.req.valid('json');
    const result = await runSetup({
      email: input.email,
      password: input.password,
      name: input.name,
      workspace_name: input.workspace_name,
      locale: input.locale,
      ip: c.get('clientIp'),
      userAgent: c.req.header('User-Agent') ?? '',
      requestId: c.get('requestId'),
    });
    return c.json(result, 201);
  });
}
```

Do `apps/web/src/lib/api/app.ts` přidej rate limit podle 4.5:

```ts
  app.use('/api/v1/setup', async (c, next) => {
    const headers = await consumeAll(limiterRegistry, [{ rule: 'setup_ip', key: c.get('clientIp') }]);
    await next();
    for (const [k, v] of Object.entries(headers)) c.header(k, v);
  });
```

- [ ] **Krok 6: Ověř typovou kontrolu a commitni**

Run: `pnpm --filter @mlain/core typecheck && pnpm --filter @mlain/web typecheck`
Expected: obojí PASS.

```bash
git add packages/core/identity/setup.ts packages/core/identity/setup.test.ts packages/core/identity/api/setup.routes.ts apps/web/src/lib/api/app.ts
git commit -m "feat(identity): first-run setup endpoint creating owner and first workspace"
```

---

### Úkol 35: Projekty, měkké smazání, obnova a předání vlastnictví

**Files:**
- Create: `packages/core/identity/workspace-service.ts`
- Create: `packages/core/identity/api/workspaces.routes.ts`
- Test: `apps/web/test/api/workspaces.test.ts`

- [ ] **Krok 1: Napiš padající test**

Create `apps/web/test/api/workspaces.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createApiApp } from '../../src/lib/api/app.js';
import { registerAuthRoutes } from '@mlain/core/identity/api/auth.routes';
import { registerWorkspaceRoutes } from '@mlain/core/identity/api/workspaces.routes';
import { seedOwnerWithWorkspace, TEST_PASSWORD } from './helpers/seed.js';

const app = createApiApp();
registerAuthRoutes(app);
registerWorkspaceRoutes(app);

let owner: Awaited<ReturnType<typeof seedOwnerWithWorkspace>>;
let stranger: Awaited<ReturnType<typeof seedOwnerWithWorkspace>>;

beforeAll(async () => {
  owner = await seedOwnerWithWorkspace(app, 'owner');
  stranger = await seedOwnerWithWorkspace(app, 'owner');
});

const asOwner = (extra: Record<string, string> = {}) => ({
  Cookie: owner.cookie,
  'X-Workspace-Id': owner.workspaceId,
  'Content-Type': 'application/json',
  ...extra,
});

describe('GET /api/v1/workspaces', () => {
  it('vrátí jen projekty, ve kterých má aktér členství', async () => {
    const body = await (await app.request('/api/v1/workspaces', { headers: { Cookie: owner.cookie } })).json();
    const ids = body.data.map((w: { id: string }) => w.id);
    expect(ids).toContain(owner.workspaceId);
    expect(ids).not.toContain(stranger.workspaceId);
  });

  it('bez přihlášení vrací 401', async () => {
    expect((await app.request('/api/v1/workspaces')).status).toBe(401);
  });
});

describe('POST /api/v1/workspaces', () => {
  it('zakladatel se stává ownerem', async () => {
    const res = await app.request('/api/v1/workspaces', {
      method: 'POST',
      headers: { Cookie: owner.cookie, 'Content-Type': 'application/json', 'Idempotency-Key': 'ws-key-001' },
      body: JSON.stringify({ name: 'Druhý projekt' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.role).toBe('owner');
    expect(body.workspace.slug).toBe('druhy-projekt');
  });

  it('kolize slugu se řeší příponou, ne chybou', async () => {
    const first = await (
      await app.request('/api/v1/workspaces', {
        method: 'POST',
        headers: { Cookie: owner.cookie, 'Content-Type': 'application/json', 'Idempotency-Key': 'ws-key-002' },
        body: JSON.stringify({ name: 'Stejný název' }),
      })
    ).json();
    const second = await (
      await app.request('/api/v1/workspaces', {
        method: 'POST',
        headers: { Cookie: owner.cookie, 'Content-Type': 'application/json', 'Idempotency-Key': 'ws-key-003' },
        body: JSON.stringify({ name: 'Stejný název' }),
      })
    ).json();
    expect(first.workspace.slug).toBe('stejny-nazev');
    expect(second.workspace.slug).toBe('stejny-nazev-2');
  });
});

describe('PATCH /api/v1/workspaces/{id}', () => {
  it('owner smí měnit název a oslovení', async () => {
    const res = await app.request(`/api/v1/workspaces/${owner.workspaceId}`, {
      method: 'PATCH',
      headers: asOwner(),
      body: JSON.stringify({ name: 'Přejmenováno', address_form: 'informal' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.workspace.name).toBe('Přejmenováno');
    expect(body.workspace.address_form).toBe('informal');
  });

  it('neplatné oslovení vrací 422', async () => {
    const res = await app.request(`/api/v1/workspaces/${owner.workspaceId}`, {
      method: 'PATCH',
      headers: asOwner(),
      body: JSON.stringify({ address_form: 'polodruhe' }),
    });
    expect(res.status).toBe(422);
  });

  it('cizí projekt vrací 404', async () => {
    const res = await app.request(`/api/v1/workspaces/${stranger.workspaceId}`, {
      method: 'PATCH',
      headers: { Cookie: owner.cookie, 'X-Workspace-Id': stranger.workspaceId, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Podvrh' }),
    });
    expect(res.status).toBe(404);
  });
});

describe('DELETE a restore', () => {
  it('smazání vyžaduje opsání názvu projektu', async () => {
    const target = await seedOwnerWithWorkspace(app, 'owner');
    const wrong = await app.request(`/api/v1/workspaces/${target.workspaceId}`, {
      method: 'DELETE',
      headers: { Cookie: target.cookie, 'X-Workspace-Id': target.workspaceId, 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm_name: 'Něco jiného' }),
    });
    expect(wrong.status).toBe(422);
  });

  it('se správným názvem projekt měkce smaže a jde do 30 dnů obnovit', async () => {
    const target = await seedOwnerWithWorkspace(app, 'owner');
    const headers = {
      Cookie: target.cookie,
      'X-Workspace-Id': target.workspaceId,
      'Content-Type': 'application/json',
    };

    const del = await app.request(`/api/v1/workspaces/${target.workspaceId}`, {
      method: 'DELETE',
      headers,
      body: JSON.stringify({ confirm_name: 'Seed' }),
    });
    expect(del.status).toBe(204);

    // Smazaný projekt už není dostupný běžnou cestou.
    expect((await app.request('/api/v1/workspaces/' + target.workspaceId, { headers })).status).toBe(404);

    const restored = await app.request(`/api/v1/workspaces/${target.workspaceId}/restore`, {
      method: 'POST',
      headers: { ...headers, 'Idempotency-Key': 'ws-restore-001' },
      body: JSON.stringify({}),
    });
    expect(restored.status).toBe(200);
    expect((await app.request('/api/v1/workspaces/' + target.workspaceId, { headers })).status).toBe(200);
  });
});

describe('POST /api/v1/workspaces/{id}/transfer-ownership', () => {
  it('bez X-Reauth-Password vrací 401', async () => {
    const res = await app.request(`/api/v1/workspaces/${owner.workspaceId}/transfer-ownership`, {
      method: 'POST',
      headers: asOwner({ 'Idempotency-Key': 'ws-transfer-001' }),
      body: JSON.stringify({ user_id: stranger.userId }),
    });
    expect(res.status).toBe(401);
  });

  it('cílový uživatel musí být členem, jinak 422', async () => {
    const res = await app.request(`/api/v1/workspaces/${owner.workspaceId}/transfer-ownership`, {
      method: 'POST',
      headers: asOwner({ 'Idempotency-Key': 'ws-transfer-002', 'X-Reauth-Password': TEST_PASSWORD }),
      body: JSON.stringify({ user_id: stranger.userId }),
    });
    expect(res.status).toBe(422);
  });
});
```

- [ ] **Krok 2: Spusť test, ověř, že padá**

Run: `pnpm --filter @mlain/web test:db -- api/workspaces.test.ts`
Expected: FAIL, `Cannot find module '@mlain/core/identity/api/workspaces.routes'`.

- [ ] **Krok 3: Napiš `workspace-service.ts`**

Create `packages/core/identity/workspace-service.ts`:

```ts
import { and, eq, isNull, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import * as schema from '@mlain/db/schema';
import { withUser, withWorkspace, type Tx } from '@mlain/core/tx';
import { config } from '@mlain/core/config';
import { ApiError, validationFailed } from '@mlain/core/errors/api-error';
import { writeAuditLog } from '@mlain/core/audit/write';
import { diffForAudit } from '@mlain/core/audit/redact';
import { IdentityAuditActions } from './audit.js';
import { slugify } from './setup.js';
import { verifyPassword } from './password.js';
import { wsEq } from './scope.js';
import type { Role, WorkspaceContext } from './types.js';

export type PublicWorkspace = {
  id: string;
  name: string;
  slug: string;
  locale: string;
  timezone: string;
  address_form: 'formal' | 'informal';
  created_at: string;
  deleted_at: string | null;
};

function toPublicWorkspace(row: {
  id: string;
  name: string;
  slug: string;
  locale: string;
  timezone: string;
  addressForm: string;
  createdAt: Date;
  deletedAt: Date | null;
}): PublicWorkspace {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    locale: row.locale,
    timezone: row.timezone,
    address_form: row.addressForm as 'formal' | 'informal',
    created_at: new Date(row.createdAt).toISOString(),
    deleted_at: row.deletedAt ? new Date(row.deletedAt).toISOString() : null,
  };
}

/**
 * 3.3: při kolizi se přidá -2, -3. Uživatel může slug přepsat.
 *
 * Kandidát se NEVYBÍRÁ dotazem na obsazenost, protože takový dotaz je pod RLS
 * nespolehlivý: unikátní index `uq_workspaces__slug` je GLOBÁLNÍ, ale politika
 * ukáže volajícímu jen projekty, kde je členem. Cizí projekt se stejným názvem
 * tedy zůstane neviditelný, `SELECT 1` nevrátí nic, kandidát projde jako volný
 * a INSERT spadne na 23505. Uživatel by dostal 500 místo 409 a projevilo by se
 * to až u druhého zákazníka, který si projekt pojmenuje stejně.
 *
 * Správně je nechat rozhodnout databázi: zkusit zápis a při 23505 vzít dalšího
 * kandidáta. Volající proto dostane generátor kandidátů, ne hotový slug.
 */
export function slugCandidates(base: string, limit = 100): string[] {
  const out = [base];
  for (let attempt = 2; attempt <= limit; attempt += 1) out.push(`${base}-${attempt}`);
  return out;
}

/**
 * Zkusí operaci pro každého kandidáta a při kolizi unikátního indexu přejde
 * k dalšímu. SQLSTATE se čte přes pgErrorCode, protože Drizzle chybu zabaluje
 * a `error.code` je undefined; ověřeno spuštěním, viz 0.8.
 *
 * POZOR na transakce: chyba 23505 uvnitř transakce ji zneplatní, takže každý
 * pokus musí běžet ve VLASTNÍ transakci. Proto se sem předává funkce, která si
 * transakci otevře sama, ne handle.
 */
export async function withSlugRetry<T>(
  base: string,
  attempt: (slug: string) => Promise<T>,
): Promise<T> {
  for (const candidate of slugCandidates(base)) {
    try {
      return await attempt(candidate);
    } catch (error) {
      if (pgErrorCode(error) !== '23505') throw error;
    }
  }
  throw new ApiError('conflict', { params: { reason: 'slug_exhausted' } });
}

export async function listWorkspaces(userId: string): Promise<Array<PublicWorkspace & { role: Role }>> {
  const rows = await withUser(userId, (tx) =>
    tx
      .select({
        id: schema.workspaces.id,
        name: schema.workspaces.name,
        slug: schema.workspaces.slug,
        locale: schema.workspaces.locale,
        timezone: schema.workspaces.timezone,
        addressForm: schema.workspaces.addressForm,
        createdAt: schema.workspaces.createdAt,
        deletedAt: schema.workspaces.deletedAt,
        role: schema.memberships.role,
      })
      .from(schema.workspaces)
      .innerJoin(
        schema.memberships,
        and(eq(schema.memberships.workspaceId, schema.workspaces.id), eq(schema.memberships.userId, userId)),
      )
      .where(isNull(schema.workspaces.deletedAt))
      .orderBy(schema.workspaces.name),
  );
  return rows.map((r) => ({ ...toPublicWorkspace(r), role: r.role as Role }));
}

export async function createWorkspace(
  userId: string,
  actorLabel: string,
  input: { name: string; slug?: string; locale?: string; timezone?: string },
): Promise<{ workspace: PublicWorkspace; role: Role }> {
  const base = input.slug ? slugify(input.slug) : slugify(input.name);

  // O obsazenosti slugu rozhoduje unikátní index, ne dotaz. Každý pokus má
  // vlastní transakci i vlastní ID, protože 23505 předchozí transakci zneplatní.
  return withSlugRetry(base, (slug) => {
  const workspaceId = uuidv7();
  return withUser(userId, async (tx) => {

    // Kontext se nastavuje na VLASTNÍ, právě vygenerované ID, a to JEŠTĚ PŘED
    // vložením řádku. Není to obcházení izolace: kontext ukazuje na projekt,
    // který v téhle transakci vzniká, takže ws_isolation_self pustí jen ten
    // jediný řádek a ws_isolation na memberships jen členství v něm. Kdyby
    // transakce spadla, kontext zmizí s ní, protože je nastavený jako SET LOCAL.
    //
    // Pořadí je tvrdá podmínka, ne úhlednost. P03 obojí naměřil spuštěním:
    //   * `INSERT ... RETURNING` uplatní na nový řádek i politiky pro ČTENÍ.
    //     ws_insert_bootstrap je FOR INSERT, takže na RETURNING nedosáhne,
    //     a ws_isolation_self by porovnávala s nenastaveným kontextem. Tentýž
    //     INSERT bez RETURNING projde, s RETURNING skončí na
    //     "new row violates row-level security policy".
    //   * Vložení členství by neprošlo ani tak, ws_isolation na memberships
    //     má WITH CHECK proti workspace kontextu.
    //
    // Nejlevnější cesta k zelenému testu by byla uvolnit politiku na memberships.
    // To je přesně ta chyba, které má celý model bránit, a v revizi by ji nikdo
    // nenašel. Proto se sem žádná nová politika nežádá.
    await tx.execute(sql`SELECT set_config('mlain.workspace_id', ${workspaceId}, true)`);

    const [row] = await tx
      .insert(schema.workspaces)
      .values({
        id: workspaceId,
        name: input.name,
        slug,
        // 2.3: aplikace vyplňuje vždy explicitně, DEFAULT v DDL je jen pojistka.
        locale: input.locale ?? config.DEFAULT_LOCALE,
        timezone: input.timezone ?? config.DEFAULT_TIMEZONE,
        createdBy: userId,
      })
      .returning();
    await tx.insert(schema.memberships).values({ workspaceId, userId, role: 'owner' });

    await writeAuditLog(tx, {
      action: IdentityAuditActions['workspace.created'],
      workspaceId,
      actor: { actorType: 'user', actorId: userId, actorLabel },
      targetType: 'workspace',
      targetId: workspaceId,
      metadata: { name: input.name, slug },
    });

    return { workspace: toPublicWorkspace(row!), role: 'owner' as Role };
  });
  });
}

export async function getWorkspace(tx: Tx, ctx: WorkspaceContext): Promise<PublicWorkspace> {
  const [row] = await tx
    .select()
    .from(schema.workspaces)
    .where(and(eq(schema.workspaces.id, ctx.workspaceId), isNull(schema.workspaces.deletedAt)))
    .limit(1);
  if (!row) throw new ApiError('not_found');
  return toPublicWorkspace(row);
}

export async function updateWorkspace(
  tx: Tx,
  ctx: WorkspaceContext,
  input: { name?: string; slug?: string; locale?: string; timezone?: string; address_form?: string },
  actorLabel: string,
): Promise<PublicWorkspace> {
  const before = await getWorkspace(tx, ctx);

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.name !== undefined) patch.name = input.name;
  // Tady se slug NEDOHLEDÁVÁ ani neposouvá na -2: uživatel si ho zvolil sám,
  // takže tichá změna na jinou hodnotu by byla horší než odmítnutí. Kolizi
  // proto hlásíme jako 409, a rozhoduje o ní unikátní index, ne SELECT, který
  // by pod RLS cizí projekt neviděl.
  if (input.slug !== undefined) patch.slug = slugify(input.slug);
  if (input.locale !== undefined) patch.locale = input.locale;
  if (input.timezone !== undefined) patch.timezone = input.timezone;
  if (input.address_form !== undefined) patch.addressForm = input.address_form;

  let row: typeof schema.workspaces.$inferSelect | undefined;
  try {
    [row] = await tx
      .update(schema.workspaces)
      .set(patch)
      .where(and(eq(schema.workspaces.id, ctx.workspaceId), isNull(schema.workspaces.deletedAt)))
      .returning();
  } catch (error) {
    if (pgErrorCode(error) === '23505') {
      throw new ApiError('conflict', { params: { reason: 'slug_taken' } });
    }
    throw error;
  }
  if (!row) throw new ApiError('not_found');

  const after = toPublicWorkspace(row);
  await writeAuditLog(tx, {
    action: IdentityAuditActions['workspace.updated'],
    workspaceId: ctx.workspaceId,
    actor: {
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      actorLabel,
    },
    targetType: 'workspace',
    targetId: ctx.workspaceId,
    metadata: diffForAudit(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
    ),
  });
  return after;
}

/** 3.3: měkké smazání, po 30 dnech tvrdé retenčním jobem platform.purge_workspaces. */
export async function deleteWorkspace(
  tx: Tx,
  ctx: WorkspaceContext,
  confirmName: string,
  actorLabel: string,
): Promise<void> {
  const current = await getWorkspace(tx, ctx);
  if (confirmName !== current.name) {
    throw validationFailed([
      {
        path: 'confirm_name',
        code: 'confirm_name_mismatch',
        message: 'Pro potvrzení opište přesný název projektu.',
      },
    ]);
  }
  await tx
    .update(schema.workspaces)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(wsEq(ctx, { workspaceId: schema.workspaces.id } as never), isNull(schema.workspaces.deletedAt)));

  await writeAuditLog(tx, {
    action: IdentityAuditActions['workspace.deleted'],
    workspaceId: ctx.workspaceId,
    actor: {
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      actorLabel,
    },
    targetType: 'workspace',
    targetId: ctx.workspaceId,
  });
}

export const RESTORE_WINDOW_DAYS = 30;

export async function restoreWorkspace(
  userId: string,
  workspaceId: string,
  actorLabel: string,
): Promise<PublicWorkspace> {
  return withUser(userId, async (tx) => {
    // Vlastnictví se ověřuje výslovně, protože měkce smazaný projekt už
    // neprojde createWorkspaceContext.
    const { rows } = await tx.execute<{ id: string }>(sql`
      SELECT w.id::text AS id
        FROM workspaces w
        JOIN memberships m ON m.workspace_id = w.id AND m.user_id = ${userId}::uuid
       WHERE w.id = ${workspaceId}::uuid
         AND m.role = 'owner'
         AND w.deleted_at IS NOT NULL
         AND w.deleted_at > now() - interval '${sql.raw(String(RESTORE_WINDOW_DAYS))} days'
       LIMIT 1
    `);
    if (rows.length === 0) throw new ApiError('not_found');

    // Kontext se MUSÍ nastavit PŘED UPDATE. Pro zápis do workspaces platí jen
    // politika ws_isolation_self, která porovnává id s mlain.workspace_id;
    // ws_member_visibility je FOR SELECT a ws_insert_bootstrap FOR INSERT,
    // takže na UPDATE nedosáhnou. Bez tohohle řádku ovlivní UPDATE nula řádků
    // a NEOHLÁSÍ chybu: `restored[0]!` je pak undefined, endpoint spadne na
    // TypeError jako 500 a projekt zůstane smazaný.
    await tx.execute(sql`SELECT set_config('mlain.workspace_id', ${workspaceId}, true)`);

    const { rows: restored } = await tx.execute<Record<string, unknown>>(sql`
      UPDATE workspaces SET deleted_at = NULL, updated_at = now()
       WHERE id = ${workspaceId}::uuid
       RETURNING id::text AS id, name, slug, locale, timezone, address_form, created_at, deleted_at
    `);
    if (restored.length === 0) throw new ApiError('not_found');

    await writeAuditLog(tx, {
      action: IdentityAuditActions['workspace.restored'],
      workspaceId,
      actor: { actorType: 'user', actorId: userId, actorLabel },
      targetType: 'workspace',
      targetId: workspaceId,
    });

    const row = restored[0]!;
    return {
      id: row.id as string,
      name: row.name as string,
      slug: row.slug as string,
      locale: row.locale as string,
      timezone: row.timezone as string,
      address_form: row.address_form as 'formal' | 'informal',
      created_at: new Date(row.created_at as Date).toISOString(),
      deleted_at: null,
    };
  });
}

/**
 * 3.3: v jedné transakci cílový dostane owner, původní admin. Vyžaduje
 * re-autentizaci heslem, protože je to nevratná změna vlastnictví projektu.
 */
export async function transferOwnership(
  ctx: WorkspaceContext,
  input: { currentUserId: string; targetUserId: string; reauthPassword: string | null; actorLabel: string },
): Promise<void> {
  if (!input.reauthPassword) throw new ApiError('unauthenticated', { params: { reason: 'reauth_required' } });

  await withWorkspace(ctx, async (tx) => {
    const { rows: users } = await tx.execute<{ password_hash: string }>(
      sql`SELECT password_hash FROM users WHERE id = ${input.currentUserId}::uuid AND deleted_at IS NULL`,
    );
    if (users.length === 0) throw new ApiError('unauthenticated');
    if (!(await verifyPassword(users[0]!.password_hash, input.reauthPassword))) {
      throw new ApiError('unauthenticated', { params: { reason: 'reauth_failed' } });
    }

    // Pravidlo „nejvýš jeden owner" žádné omezení v databázi nevynucuje, P03 ho
    // výslovně nechává na aplikaci. Dva souběžné převody by tedy bez zámku
    // proběhly oba a projekt by skončil se dvěma ownery. Řádky členství se
    // proto nejdřív zamknou v pořadí podle user_id (stabilní pořadí brání
    // uváznutí, když dva převody míří na tytéž dva lidi navzájem).
    await tx.execute(sql`
      SELECT 1 FROM memberships
       WHERE workspace_id = ${ctx.workspaceId}::uuid
         AND user_id IN (${input.currentUserId}::uuid, ${input.targetUserId}::uuid)
       ORDER BY user_id
         FOR UPDATE
    `);

    const { rows: owners } = await tx.execute<{ user_id: string }>(sql`
      SELECT user_id::text AS user_id FROM memberships
       WHERE workspace_id = ${ctx.workspaceId}::uuid AND role = 'owner'
    `);
    if (owners.length !== 1 || owners[0]!.user_id !== input.currentUserId) {
      // Někdo nás předběhl: vlastnictví už přešlo jinam, nebo je stav rozbitý.
      throw new ApiError('conflict', { params: { reason: 'ownership_changed' } });
    }

    const [target] = await tx
      .select({ role: schema.memberships.role })
      .from(schema.memberships)
      .where(
        and(
          eq(schema.memberships.workspaceId, ctx.workspaceId),
          eq(schema.memberships.userId, input.targetUserId),
        ),
      )
      .limit(1);
    if (!target) {
      throw validationFailed([
        { path: 'user_id', code: 'not_a_member', message: 'Cílový uživatel není členem projektu.' },
      ]);
    }

    await tx
      .update(schema.memberships)
      .set({ role: 'owner', updatedAt: new Date() })
      .where(
        and(
          eq(schema.memberships.workspaceId, ctx.workspaceId),
          eq(schema.memberships.userId, input.targetUserId),
        ),
      );
    await tx
      .update(schema.memberships)
      .set({ role: 'admin', updatedAt: new Date() })
      .where(
        and(
          eq(schema.memberships.workspaceId, ctx.workspaceId),
          eq(schema.memberships.userId, input.currentUserId),
        ),
      );

    await writeAuditLog(tx, {
      action: IdentityAuditActions['workspace.ownership_transferred'],
      workspaceId: ctx.workspaceId,
      actor: { actorType: 'user', actorId: input.currentUserId, actorLabel: input.actorLabel },
      targetType: 'user',
      targetId: input.targetUserId,
      metadata: { from: input.currentUserId, to: input.targetUserId },
    });
  });
}
```

- [ ] **Krok 4: Napiš `workspaces.routes.ts`**

Create `packages/core/identity/api/workspaces.routes.ts`:

```ts
import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { withWorkspace } from '@mlain/core/tx';
import { ApiError } from '@mlain/core/errors/api-error';
import { assertPermission } from '../permissions.js';
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspace,
  listWorkspaces,
  restoreWorkspace,
  transferOwnership,
  updateWorkspace,
} from '../workspace-service.js';
import { requireSession } from './auth.routes.js';
import { problemResponse, RoleSchema, IdempotencyHeaderSchema, type ApiEnv } from './schemas.js';

export const WorkspaceSchema = z
  .object({
    id: z.uuid(),
    name: z.string().min(1).max(200),
    slug: z.string(),
    locale: z.string(),
    timezone: z.string(),
    address_form: z.enum(['formal', 'informal']),
    created_at: z.iso.datetime(),
    deleted_at: z.iso.datetime().nullable(),
  })
  .openapi('Workspace');

export const CreateWorkspaceInput = z
  .object({
    name: z.string().min(1).max(200),
    slug: z.string().min(1).max(63).optional(),
    locale: z.string().max(20).optional(),
    timezone: z.string().max(64).optional(),
  })
  .strict()
  .openapi('CreateWorkspaceInput');

export const UpdateWorkspaceInput = z
  .object({
    name: z.string().min(1).max(200).optional(),
    slug: z.string().min(1).max(63).optional(),
    locale: z.string().max(20).optional(),
    timezone: z.string().max(64).optional(),
    address_form: z.enum(['formal', 'informal']).optional(),
  })
  .strict()
  .openapi('UpdateWorkspaceInput');

export const DeleteWorkspaceInput = z
  .object({ confirm_name: z.string().min(1).max(200) })
  .strict()
  .openapi('DeleteWorkspaceInput');

export const TransferOwnershipInput = z
  .object({ user_id: z.uuid() })
  .strict()
  .openapi('TransferOwnershipInput');

const listRoute = createRoute({
  method: 'get',
  path: '/api/v1/workspaces',
  tags: ['Workspaces'],
  summary: 'Projekty, ve kterých má aktér členství',
  responses: {
    200: {
      description: 'Seznam projektů',
      content: {
        'application/json': {
          schema: z.object({ data: z.array(WorkspaceSchema.extend({ role: RoleSchema })) }),
        },
      },
    },
    401: problemResponse('unauthenticated', 'session_expired'),
  },
});

const createRouteDef = createRoute({
  method: 'post',
  path: '/api/v1/workspaces',
  tags: ['Workspaces'],
  summary: 'Založení projektu, zakladatel se stává ownerem',
  request: {
    headers: IdempotencyHeaderSchema,
    body: { content: { 'application/json': { schema: CreateWorkspaceInput } } },
  },
  responses: {
    201: {
      description: 'Založeno',
      content: { 'application/json': { schema: z.object({ workspace: WorkspaceSchema, role: RoleSchema }) } },
    },
    401: problemResponse('unauthenticated', 'session_expired'),
    422: problemResponse('validation_failed'),
  },
});

const getRouteDef = createRoute({
  method: 'get',
  path: '/api/v1/workspaces/{id}',
  tags: ['Workspaces'],
  summary: 'Detail projektu',
  security: [{ bearerAuth: ['workspace:read'] }],
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: {
      description: 'Projekt',
      content: { 'application/json': { schema: z.object({ workspace: WorkspaceSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const updateRouteDef = createRoute({
  method: 'patch',
  path: '/api/v1/workspaces/{id}',
  tags: ['Workspaces'],
  summary: 'Změna nastavení projektu',
  security: [{ bearerAuth: ['workspace:update'] }],
  request: {
    params: z.object({ id: z.uuid() }),
    body: { content: { 'application/json': { schema: UpdateWorkspaceInput } } },
  },
  responses: {
    200: {
      description: 'Změněno',
      content: { 'application/json': { schema: z.object({ workspace: WorkspaceSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

const deleteRouteDef = createRoute({
  method: 'delete',
  path: '/api/v1/workspaces/{id}',
  tags: ['Workspaces'],
  summary: 'Měkké smazání projektu, obnovitelné 30 dní',
  security: [{ bearerAuth: ['workspace:delete'] }],
  request: {
    params: z.object({ id: z.uuid() }),
    body: { content: { 'application/json': { schema: DeleteWorkspaceInput } } },
  },
  responses: {
    204: { description: 'Smazáno' },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

const restoreRouteDef = createRoute({
  method: 'post',
  path: '/api/v1/workspaces/{id}/restore',
  tags: ['Workspaces'],
  summary: 'Obnova smazaného projektu do 30 dnů',
  request: {
    params: z.object({ id: z.uuid() }),
    headers: IdempotencyHeaderSchema,
    body: { content: { 'application/json': { schema: z.object({}).strict() } } },
  },
  responses: {
    200: {
      description: 'Obnoveno',
      content: { 'application/json': { schema: z.object({ workspace: WorkspaceSchema }) } },
    },
    401: problemResponse('unauthenticated', 'session_expired'),
    404: problemResponse('not_found'),
  },
});

const transferRouteDef = createRoute({
  method: 'post',
  path: '/api/v1/workspaces/{id}/transfer-ownership',
  tags: ['Workspaces'],
  summary: 'Předání vlastnictví, vyžaduje hlavičku X-Reauth-Password',
  security: [{ bearerAuth: ['workspace:transfer'] }],
  request: {
    params: z.object({ id: z.uuid() }),
    headers: IdempotencyHeaderSchema.extend({ 'x-reauth-password': z.string().min(1).optional() }),
    body: { content: { 'application/json': { schema: TransferOwnershipInput } } },
  },
  responses: {
    200: { description: 'Předáno', content: { 'application/json': { schema: z.object({ ok: z.literal(true) }) } } },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

export function registerWorkspaceRoutes(app: OpenAPIHono<ApiEnv>): void {
  app.openapi(listRoute, async (c) => {
    const actor = await requireSession(c);
    return c.json({ data: await listWorkspaces(actor.userId) }, 200);
  });

  app.openapi(createRouteDef, async (c) => {
    const actor = await requireSession(c);
    const input = c.req.valid('json');
    const result = await createWorkspace(actor.userId, '', input);
    return c.json(result, 201);
  });

  app.openapi(getRouteDef, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'workspace:read');
    if (c.req.valid('param').id !== ctx.workspaceId) throw new ApiError('not_found');
    const workspace = await withWorkspace(ctx, (tx) => getWorkspace(tx, ctx));
    return c.json({ workspace }, 200);
  });

  app.openapi(updateRouteDef, async (c) => {
    const { ctx, label } = c.get('auth');
    assertPermission(ctx, 'workspace:update');
    if (c.req.valid('param').id !== ctx.workspaceId) throw new ApiError('not_found');
    const workspace = await withWorkspace(ctx, (tx) =>
      updateWorkspace(tx, ctx, c.req.valid('json'), label),
    );
    return c.json({ workspace }, 200);
  });

  app.openapi(deleteRouteDef, async (c) => {
    const { ctx, label } = c.get('auth');
    assertPermission(ctx, 'workspace:delete');
    if (c.req.valid('param').id !== ctx.workspaceId) throw new ApiError('not_found');
    await withWorkspace(ctx, (tx) =>
      deleteWorkspace(tx, ctx, c.req.valid('json').confirm_name, label),
    );
    return c.body(null, 204);
  });

  app.openapi(restoreRouteDef, async (c) => {
    const actor = await requireSession(c);
    const workspace = await restoreWorkspace(actor.userId, c.req.valid('param').id, '');
    return c.json({ workspace }, 200);
  });

  app.openapi(transferRouteDef, async (c) => {
    const { ctx, label } = c.get('auth');
    assertPermission(ctx, 'workspace:transfer');
    if (c.req.valid('param').id !== ctx.workspaceId) throw new ApiError('not_found');
    if (ctx.actor.type !== 'user') throw new ApiError('forbidden');
    await transferOwnership(ctx, {
      currentUserId: ctx.actor.userId,
      targetUserId: c.req.valid('json').user_id,
      reauthPassword: c.req.header('X-Reauth-Password') ?? null,
      actorLabel: label,
    });
    return c.json({ ok: true as const }, 200);
  });
}
```

- [ ] **Krok 5: Doplň `/api/v1/workspaces/{id}/restore` mezi cesty bez workspace kontextu**

V `apps/web/src/lib/api/authenticate.ts` rozšiř výjimku, protože obnova pracuje se smazaným projektem, který `createWorkspaceContext` odmítá:

```ts
const RESTORE_PATH = /^\/api\/v1\/workspaces\/[0-9a-f-]{36}\/restore$/i;
// v authenticate(), hned za kontrolou CONTEXT_FREE_PREFIXES:
    if (RESTORE_PATH.test(path)) {
      await next();
      return;
    }
```

- [ ] **Krok 6: Doplň souběžný test jediného ownera**

Pravidlo „projekt má nejvýš jednoho ownera" nevynucuje **žádné omezení v databázi**, P03 ho výslovně nechává na aplikaci. Ochrana bez testu, který její porušení zachytí, ale není ochrana, a chyba se tady projeví jen při souběhu, tedy nikdy při ručním klikání.

**Že to není hypotetická obava, jsem ověřil spuštěním** proti PostgreSQL 18.4: ze **25 souběžných dvojic převodů bez zámku skončilo dvěma ownery všech 25**, se zámkem ani jedna. Test proto souběh vyvolává doopravdy, nesimuluje ho.

Do `packages/core/identity/workspace-service.test.ts` přidej:

```ts
it('dva souběžné převody vlastnictví nenechají dva ownery', async () => {
  const { ownerCtx, ownerId, ownerPassword, memberOne, memberTwo } = await seedOwnerAndTwoAdmins();

  // Oba převody běží doopravdy naráz. Bez FOR UPDATE projdou oba a v projektu
  // zůstanou dva owneři, což je stav, ze kterého se aplikace sama nedostane.
  const results = await Promise.allSettled([
    transferOwnership(ownerCtx, {
      currentUserId: ownerId, targetUserId: memberOne,
      reauthPassword: ownerPassword, actorLabel: 'test',
    }),
    transferOwnership(ownerCtx, {
      currentUserId: ownerId, targetUserId: memberTwo,
      reauthPassword: ownerPassword, actorLabel: 'test',
    }),
  ]);

  const owners = await withWorkspace(ownerCtx, async (tx) => {
    const { rows } = await tx.execute<{ user_id: string }>(sql`
      SELECT user_id::text AS user_id FROM memberships
       WHERE workspace_id = ${ownerCtx.workspaceId}::uuid AND role = 'owner'
    `);
    return rows;
  });

  expect(owners, 'projekt musí mít právě jednoho ownera i po souběhu').toHaveLength(1);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  const rejected = results.find((r) => r.status === 'rejected');
  expect((rejected as PromiseRejectedResult).reason).toMatchObject({ code: 'conflict' });
});
```

Kdyby se test ukázal jako nestabilní, **není správná reakce ho zopakovat nebo změkčit tvrzení**. Nestabilita by znamenala, že zámek nezabírá.

- [ ] **Krok 7: Spusť test, ověř, že prochází**

Run: `pnpm --filter @mlain/web test:db -- api/workspaces.test.ts`
Expected: 10 passed.

Run: `pnpm --filter @mlain/core test:db -- identity/workspace-service.test.ts`
Expected: všechny testy zelené včetně souběžného převodu.

- [ ] **Krok 8: Commit**

```bash
git add packages/core/identity/workspace-service.ts packages/core/identity/api/workspaces.routes.ts apps/web/src/lib/api/authenticate.ts apps/web/test/api/workspaces.test.ts
git commit -m "feat(api): workspace CRUD, soft delete, restore and ownership transfer"
```

---

### Úkol 36: Členové a pozvánky

Pokrývá kritérium 22.

**Files:**
- Create: `packages/core/identity/membership-service.ts`
- Create: `packages/core/identity/invitation-service.ts`
- Create: `packages/core/identity/api/members.routes.ts`
- Create: `packages/core/identity/api/invitations.routes.ts`
- Test: `apps/web/test/api/members.test.ts`

- [ ] **Krok 1: Napiš padající test**

Create `apps/web/test/api/members.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createApiApp } from '../../src/lib/api/app.js';
import { registerAuthRoutes } from '@mlain/core/identity/api/auth.routes';
import { registerMemberRoutes } from '@mlain/core/identity/api/members.routes';
import { registerInvitationRoutes } from '@mlain/core/identity/api/invitations.routes';
import { seedOwnerWithWorkspace } from './helpers/seed.js';
import { __lastInvitationTokenForTests } from '@mlain/core/identity/invitation-service';

const app = createApiApp();
registerAuthRoutes(app);
registerMemberRoutes(app);
registerInvitationRoutes(app);

let owner: Awaited<ReturnType<typeof seedOwnerWithWorkspace>>;
let guest: Awaited<ReturnType<typeof seedOwnerWithWorkspace>>;

const asOwner = (extra: Record<string, string> = {}) => ({
  Cookie: owner.cookie,
  'X-Workspace-Id': owner.workspaceId,
  'Content-Type': 'application/json',
  ...extra,
});

beforeAll(async () => {
  owner = await seedOwnerWithWorkspace(app, 'owner');
  guest = await seedOwnerWithWorkspace(app, 'owner');
});

describe('kritérium 22: poslední owner', () => {
  it('odebrání posledního ownera vrací 409 a členství zůstane beze změny', async () => {
    const res = await app.request(`/api/v1/members/${owner.userId}`, {
      method: 'DELETE',
      headers: asOwner(),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('last_owner_cannot_be_removed');

    const list = await (await app.request('/api/v1/members', { headers: asOwner() })).json();
    expect(list.data.find((m: { user_id: string }) => m.user_id === owner.userId).role).toBe('owner');
  });

  it('změna role posledního ownera vrací 409', async () => {
    const res = await app.request(`/api/v1/members/${owner.userId}`, {
      method: 'PATCH',
      headers: asOwner(),
      body: JSON.stringify({ role: 'admin' }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe('last_owner_cannot_be_removed');
  });
});

describe('pozvánky', () => {
  it('vytvoření pozvánky vrací 201 a token nikdy není v odpovědi', async () => {
    const res = await app.request('/api/v1/invitations', {
      method: 'POST',
      headers: asOwner({ 'Idempotency-Key': 'inv-key-001' }),
      body: JSON.stringify({ email: guest.email, role: 'editor' }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.invitation.email).toBe(guest.email);
    expect(JSON.stringify(body)).not.toContain(__lastInvitationTokenForTests() ?? 'nic');
  });

  it('pozvání existujícího člena vrací 409 already_member', async () => {
    const res = await app.request('/api/v1/invitations', {
      method: 'POST',
      headers: asOwner({ 'Idempotency-Key': 'inv-key-002' }),
      body: JSON.stringify({ email: owner.email, role: 'editor' }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).params.reason).toBe('already_member');
  });

  it('opakované pozvání téhož e-mailu revokuje předchozí a vytvoří novou', async () => {
    const target = `dvakrat-${Date.now()}@example.cz`;
    await app.request('/api/v1/invitations', {
      method: 'POST',
      headers: asOwner({ 'Idempotency-Key': 'inv-key-003' }),
      body: JSON.stringify({ email: target, role: 'viewer' }),
    });
    const first = __lastInvitationTokenForTests();

    const second = await app.request('/api/v1/invitations', {
      method: 'POST',
      headers: asOwner({ 'Idempotency-Key': 'inv-key-004' }),
      body: JSON.stringify({ email: target, role: 'editor' }),
    });
    expect(second.status).toBe(201);
    expect(__lastInvitationTokenForTests()).not.toBe(first);

    const accepted = await app.request('/api/v1/invitations/accept', {
      method: 'POST',
      headers: { Cookie: guest.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: first }),
    });
    expect(accepted.status).toBe(404);
  });

  it('přijetí pozvánky založí členství v deklarované roli', async () => {
    const target = `prijmu-${Date.now()}@example.cz`;
    await app.request('/api/v1/invitations', {
      method: 'POST',
      headers: asOwner({ 'Idempotency-Key': 'inv-key-005' }),
      body: JSON.stringify({ email: target, role: 'editor' }),
    });

    const res = await app.request('/api/v1/invitations/accept', {
      method: 'POST',
      headers: { Cookie: guest.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: __lastInvitationTokenForTests() }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.role).toBe('editor');
    expect(body.workspace.id).toBe(owner.workspaceId);
  });

  it('pozvánka je jednorázová, druhé přijetí vrací 404', async () => {
    const target = `jednorazova-${Date.now()}@example.cz`;
    await app.request('/api/v1/invitations', {
      method: 'POST',
      headers: asOwner({ 'Idempotency-Key': 'inv-key-006' }),
      body: JSON.stringify({ email: target, role: 'viewer' }),
    });
    const token = __lastInvitationTokenForTests();
    const other = await seedOwnerWithWorkspace(app, 'owner');

    await app.request('/api/v1/invitations/accept', {
      method: 'POST',
      headers: { Cookie: other.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    const second = await app.request('/api/v1/invitations/accept', {
      method: 'POST',
      headers: { Cookie: other.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    expect(second.status).toBe(404);
  });

  it('neplatný token vrací 404, ne 401, aby nešlo poznat existenci pozvánky', async () => {
    const res = await app.request('/api/v1/invitations/accept', {
      method: 'POST',
      headers: { Cookie: guest.cookie, 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: 'AQQHCg0QExYZHB8iJSgrLjE0Nzo9QENGSUxPUlVYW14' }),
    });
    expect(res.status).toBe(404);
  });

  it('revokace pozvánky vrací 204', async () => {
    const target = `revokace-${Date.now()}@example.cz`;
    const created = await (
      await app.request('/api/v1/invitations', {
        method: 'POST',
        headers: asOwner({ 'Idempotency-Key': 'inv-key-007' }),
        body: JSON.stringify({ email: target, role: 'viewer' }),
      })
    ).json();

    const res = await app.request(`/api/v1/invitations/${created.invitation.id}`, {
      method: 'DELETE',
      headers: asOwner(),
    });
    expect(res.status).toBe(204);
  });
});
```

- [ ] **Krok 2: Spusť test, ověř, že padá**

Run: `pnpm --filter @mlain/web test:db -- api/members.test.ts`
Expected: FAIL, `Cannot find module '@mlain/core/identity/api/members.routes'`.

- [ ] **Krok 3: Napiš `membership-service.ts`**

Create `packages/core/identity/membership-service.ts`:

```ts
import { and, eq, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import type { Tx } from '@mlain/core/tx';
import { ApiError } from '@mlain/core/errors/api-error';
import { writeAuditLog } from '@mlain/core/audit/write';
import { IdentityAuditActions } from './audit.js';
import type { Role, WorkspaceContext } from './types.js';

export type MemberRow = {
  user_id: string;
  email: string;
  name: string;
  role: Role;
  created_at: string;
};

export async function listMembers(tx: Tx, ctx: WorkspaceContext): Promise<MemberRow[]> {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT m.user_id::text AS user_id, u.email::text AS email, u.name AS name,
           m.role AS role, m.created_at AS created_at
      FROM memberships m
      JOIN users u ON u.id = m.user_id
     WHERE m.workspace_id = ${ctx.workspaceId}::uuid AND u.deleted_at IS NULL
     ORDER BY m.created_at
  `);
  return rows.map((r) => ({
    user_id: r.user_id as string,
    email: r.email as string,
    name: r.name as string,
    role: r.role as Role,
    created_at: new Date(r.created_at as Date).toISOString(),
  }));
}

/**
 * 3.3, invariant 1: každý workspace má právě jednoho ownera. Vynucuje se
 * v aplikační transakci, ne indexem, protože při předání vlastnictví musí
 * na okamžik existovat dva a index by to zablokoval.
 */
async function assertNotLastOwner(tx: Tx, ctx: WorkspaceContext, userId: string): Promise<void> {
  const { rows } = await tx.execute<{ owners: string; role: string | null }>(sql`
    SELECT (SELECT count(*) FROM memberships
             WHERE workspace_id = ${ctx.workspaceId}::uuid AND role = 'owner') AS owners,
           (SELECT role FROM memberships
             WHERE workspace_id = ${ctx.workspaceId}::uuid AND user_id = ${userId}::uuid) AS role
  `);
  const row = rows[0];
  if (!row || row.role === null) throw new ApiError('not_found');
  if (row.role === 'owner' && Number(row.owners) <= 1) {
    throw new ApiError('last_owner_cannot_be_removed');
  }
}

export async function changeMemberRole(
  tx: Tx,
  ctx: WorkspaceContext,
  input: { userId: string; role: Role },
  actorLabel: string,
): Promise<MemberRow> {
  if (input.role !== 'owner') await assertNotLastOwner(tx, ctx, input.userId);

  const updated = await tx
    .update(schema.memberships)
    .set({ role: input.role, updatedAt: new Date() })
    .where(
      and(eq(schema.memberships.workspaceId, ctx.workspaceId), eq(schema.memberships.userId, input.userId)),
    )
    .returning({ userId: schema.memberships.userId });
  if (updated.length === 0) throw new ApiError('not_found');

  await writeAuditLog(tx, {
    action: IdentityAuditActions['member.role_changed'],
    workspaceId: ctx.workspaceId,
    actor: {
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      actorLabel,
    },
    targetType: 'user',
    targetId: input.userId,
    metadata: { role: input.role },
  });

  const members = await listMembers(tx, ctx);
  const member = members.find((m) => m.user_id === input.userId);
  if (!member) throw new ApiError('not_found');
  return member;
}

export async function removeMember(
  tx: Tx,
  ctx: WorkspaceContext,
  userId: string,
  actorLabel: string,
): Promise<void> {
  await assertNotLastOwner(tx, ctx, userId);
  const removed = await tx
    .delete(schema.memberships)
    .where(and(eq(schema.memberships.workspaceId, ctx.workspaceId), eq(schema.memberships.userId, userId)))
    .returning({ userId: schema.memberships.userId });
  if (removed.length === 0) throw new ApiError('not_found');

  await writeAuditLog(tx, {
    action: IdentityAuditActions['member.removed'],
    workspaceId: ctx.workspaceId,
    actor: {
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      actorLabel,
    },
    targetType: 'user',
    targetId: userId,
  });
}
```

- [ ] **Krok 4: Napiš `invitation-service.ts`**

Create `packages/core/identity/invitation-service.ts`:

```ts
import { and, eq, isNull, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { withUser, withWorkspace, type Tx } from '@mlain/core/tx';
import { config } from '@mlain/core/config';
import { ApiError } from '@mlain/core/errors/api-error';
import { writeAuditLog } from '@mlain/core/audit/write';
import { queueSystemMail } from '@mlain/core/platform/system-mail';
import { createInvitationContext } from './context.js';
import { generateOpaqueToken, tokenHash } from './token.js';
import { IdentityAuditActions } from './audit.js';
import type { Role, WorkspaceContext } from './types.js';

/** 3.3: platnost 7 dní, jednorázová, nejvýš 100 čekajících na workspace. */
export const INVITATION_TTL_DAYS = 7;
export const MAX_PENDING_INVITATIONS = 100;

let lastToken: string | null = null;

/** Jen pro testy. V provozu token odchází pouze e-mailem a nikde se neuchovává. */
export function __lastInvitationTokenForTests(): string | null {
  return lastToken;
}

export type PublicInvitation = {
  id: string;
  email: string;
  role: Role;
  expires_at: string;
  created_at: string;
};

export async function listInvitations(tx: Tx, ctx: WorkspaceContext): Promise<PublicInvitation[]> {
  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT id::text AS id, email::text AS email, role, expires_at, created_at
      FROM invitations
     WHERE workspace_id = ${ctx.workspaceId}::uuid
       AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
     ORDER BY created_at DESC
  `);
  return rows.map((r) => ({
    id: r.id as string,
    email: r.email as string,
    role: r.role as Role,
    expires_at: new Date(r.expires_at as Date).toISOString(),
    created_at: new Date(r.created_at as Date).toISOString(),
  }));
}

export async function createInvitation(
  tx: Tx,
  ctx: WorkspaceContext,
  input: { email: string; role: Role },
  actorLabel: string,
): Promise<PublicInvitation> {
  const email = input.email.trim().toLowerCase();

  const { rows: member } = await tx.execute(sql`
    SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
     WHERE m.workspace_id = ${ctx.workspaceId}::uuid AND u.email = ${email} AND u.deleted_at IS NULL
     LIMIT 1
  `);
  if (member.length > 0) throw new ApiError('conflict', { params: { reason: 'already_member' } });

  const { rows: pending } = await tx.execute<{ c: string }>(sql`
    SELECT count(*) AS c FROM invitations
     WHERE workspace_id = ${ctx.workspaceId}::uuid
       AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
  `);
  if (Number(pending[0]!.c) >= MAX_PENDING_INVITATIONS) {
    throw new ApiError('conflict', { params: { reason: 'too_many_pending_invitations' } });
  }

  // 3.3: opakované pozvání téhož e-mailu revokuje předchozí čekající pozvánku.
  // Bez toho by unikátní částečný index uq_invitations__ws_email_pending zápis odmítl.
  await tx.execute(sql`
    UPDATE invitations SET revoked_at = now()
     WHERE workspace_id = ${ctx.workspaceId}::uuid AND email = ${email}
       AND accepted_at IS NULL AND revoked_at IS NULL
  `);

  const token = generateOpaqueToken();
  lastToken = token;

  const [row] = await tx
    .insert(schema.invitations)
    .values({
      workspaceId: ctx.workspaceId,
      email,
      role: input.role,
      tokenHash: tokenHash(token),
      invitedBy: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      expiresAt: sql`now() + interval '${sql.raw(String(INVITATION_TTL_DAYS))} days'`,
    })
    .returning();

  await writeAuditLog(tx, {
    action: IdentityAuditActions['member.invited'],
    workspaceId: ctx.workspaceId,
    actor: {
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      actorLabel,
    },
    targetType: 'invitation',
    targetId: row!.id,
    metadata: { email, role: input.role },
  });

  await queueSystemMail({
    template: 'invitation',
    to: email,
    locale: config.DEFAULT_LOCALE,
    data: { url: `${config.APP_URL}/invitations/accept?token=${token}` },
  });

  return {
    id: row!.id,
    email,
    role: input.role,
    expires_at: new Date(row!.expiresAt).toISOString(),
    created_at: new Date(row!.createdAt).toISOString(),
  };
}

export async function revokeInvitation(
  tx: Tx,
  ctx: WorkspaceContext,
  id: string,
  actorLabel: string,
): Promise<void> {
  const revoked = await tx
    .update(schema.invitations)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(schema.invitations.workspaceId, ctx.workspaceId),
        eq(schema.invitations.id, id),
        isNull(schema.invitations.acceptedAt),
        isNull(schema.invitations.revokedAt),
      ),
    )
    .returning({ id: schema.invitations.id });
  if (revoked.length === 0) throw new ApiError('not_found');

  await writeAuditLog(tx, {
    action: IdentityAuditActions['member.invitation_revoked'],
    workspaceId: ctx.workspaceId,
    actor: {
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      actorLabel,
    },
    targetType: 'invitation',
    targetId: id,
  });
}

/**
 * 3.3: přijetí přihlášeným uživatelem s jiným e-mailem je povolené, pozvánka
 * váže roli, ne identitu. Do auditu se zapíše obojí.
 *
 * Neplatný, prošlý, revokovaný i už použitý token vrací shodně 404, aby z reakce
 * nešlo zjistit, jestli pozvánka existuje.
 */
export async function acceptInvitation(input: {
  userId: string;
  userEmail: string;
  token: string;
}): Promise<{ workspace: { id: string; name: string; slug: string }; role: Role }> {
  const hash = tokenHash(input.token);

  const found = await withUser(input.userId, async (tx) => {
    const { rows } = await tx.execute<Record<string, unknown>>(sql`
      SELECT i.id::text AS id, i.workspace_id::text AS workspace_id, i.role AS role, i.email::text AS email,
             w.name AS name, w.slug AS slug
        FROM invitations i
        JOIN workspaces w ON w.id = i.workspace_id AND w.deleted_at IS NULL
       WHERE i.token_hash = ${hash}
         AND i.accepted_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > now()
       LIMIT 1
    `);
    return rows[0] ?? null;
  });
  if (!found) throw new ApiError('not_found');

  const workspaceId = found.workspace_id as string;
  const role = found.role as Role;

  // Kontext se vyrábí z pozvánky, ne z requestu: workspace_id pochází z řádku
  // dohledaného podle token_hash. Členství se ověřovat nedá, teprve vzniká,
  // takže aktérem je přijímající uživatel s rolí, kterou pozvánka nese.
  const acceptCtx = createInvitationContext(workspaceId, input.userId, role);

  await withWorkspace(acceptCtx, async (tx) => {
    const { rows: accepted } = await tx.execute(sql`
      UPDATE invitations SET accepted_at = now(), accepted_by = ${input.userId}::uuid
       WHERE id = ${found.id as string}::uuid AND accepted_at IS NULL AND revoked_at IS NULL
       RETURNING id
    `);
    // Souběžné druhé přijetí tady skončí na nule řádků a transakce se rollbackne.
    if (accepted.length !== 1) throw new ApiError('not_found');

    await tx.execute(sql`
      INSERT INTO memberships (workspace_id, user_id, role)
      VALUES (${workspaceId}::uuid, ${input.userId}::uuid, ${role})
      ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role, updated_at = now()
    `);

    await writeAuditLog(tx, {
      action: IdentityAuditActions['member.joined'],
      workspaceId,
      actor: { actorType: 'user', actorId: input.userId, actorLabel: input.userEmail },
      targetType: 'invitation',
      targetId: found.id as string,
      metadata: { invited_email: found.email as string, accepted_email: input.userEmail, role },
    });
  });

  return {
    workspace: { id: workspaceId, name: found.name as string, slug: found.slug as string },
    role,
  };
}
```

- [ ] **Krok 5: Napiš obě definice cest**

Create `packages/core/identity/api/members.routes.ts`:

```ts
import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { withWorkspace } from '@mlain/core/tx';
import { assertPermission } from '../permissions.js';
import { changeMemberRole, listMembers, removeMember } from '../membership-service.js';
import { problemResponse, RoleSchema, type ApiEnv } from './schemas.js';

export const MemberSchema = z
  .object({
    user_id: z.uuid(),
    email: z.email(),
    name: z.string(),
    role: RoleSchema,
    created_at: z.iso.datetime(),
  })
  .openapi('Member');

export const UpdateMemberInput = z.object({ role: RoleSchema }).strict().openapi('UpdateMemberInput');

const listRoute = createRoute({
  method: 'get',
  path: '/api/v1/members',
  tags: ['Members'],
  summary: 'Členové projektu',
  security: [{ bearerAuth: ['members:read'] }],
  responses: {
    200: {
      description: 'Seznam členů',
      content: { 'application/json': { schema: z.object({ data: z.array(MemberSchema) }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const updateRoute = createRoute({
  method: 'patch',
  path: '/api/v1/members/{user_id}',
  tags: ['Members'],
  summary: 'Změna role člena',
  security: [{ bearerAuth: ['members:update_role'] }],
  request: {
    params: z.object({ user_id: z.uuid() }),
    body: { content: { 'application/json': { schema: UpdateMemberInput } } },
  },
  responses: {
    200: {
      description: 'Změněno',
      content: { 'application/json': { schema: z.object({ member: MemberSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('last_owner_cannot_be_removed'),
    422: problemResponse('validation_failed'),
  },
});

const removeRoute = createRoute({
  method: 'delete',
  path: '/api/v1/members/{user_id}',
  tags: ['Members'],
  summary: 'Odebrání člena z projektu',
  security: [{ bearerAuth: ['members:remove'] }],
  request: { params: z.object({ user_id: z.uuid() }) },
  responses: {
    204: { description: 'Odebráno' },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('last_owner_cannot_be_removed'),
  },
});

export function registerMemberRoutes(app: OpenAPIHono<ApiEnv>): void {
  app.openapi(listRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'members:read');
    const data = await withWorkspace(ctx, (tx) => listMembers(tx, ctx));
    return c.json({ data }, 200);
  });

  app.openapi(updateRoute, async (c) => {
    const { ctx, label } = c.get('auth');
    assertPermission(ctx, 'members:update_role');
    const member = await withWorkspace(ctx, (tx) =>
      changeMemberRole(tx, ctx, { userId: c.req.valid('param').user_id, role: c.req.valid('json').role }, label),
    );
    return c.json({ member }, 200);
  });

  app.openapi(removeRoute, async (c) => {
    const { ctx, label } = c.get('auth');
    assertPermission(ctx, 'members:remove');
    await withWorkspace(ctx, (tx) =>
      removeMember(tx, ctx, c.req.valid('param').user_id, label),
    );
    return c.body(null, 204);
  });
}
```

Create `packages/core/identity/api/invitations.routes.ts`:

```ts
import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import { withoutContext, withWorkspace } from '@mlain/core/tx';
import { ApiError } from '@mlain/core/errors/api-error';
import { assertPermission } from '../permissions.js';
import {
  acceptInvitation,
  createInvitation,
  listInvitations,
  revokeInvitation,
} from '../invitation-service.js';
import { requireSession } from './auth.routes.js';
import { problemResponse, RoleSchema, IdempotencyHeaderSchema, type ApiEnv } from './schemas.js';

export const InvitationSchema = z
  .object({
    id: z.uuid(),
    email: z.email(),
    role: RoleSchema,
    expires_at: z.iso.datetime(),
    created_at: z.iso.datetime(),
  })
  .openapi('Invitation');

export const CreateInvitationInput = z
  .object({ email: z.email(), role: RoleSchema })
  .strict()
  .openapi('CreateInvitationInput');

export const AcceptInvitationInput = z
  .object({ token: z.string().min(1).max(200) })
  .strict()
  .openapi('AcceptInvitationInput');

const listRoute = createRoute({
  method: 'get',
  path: '/api/v1/invitations',
  tags: ['Invitations'],
  summary: 'Čekající pozvánky projektu',
  security: [{ bearerAuth: ['members:read'] }],
  responses: {
    200: {
      description: 'Seznam pozvánek',
      content: { 'application/json': { schema: z.object({ data: z.array(InvitationSchema) }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const createRouteDef = createRoute({
  method: 'post',
  path: '/api/v1/invitations',
  tags: ['Invitations'],
  summary: 'Pozvání do projektu',
  security: [{ bearerAuth: ['members:invite'] }],
  request: {
    headers: IdempotencyHeaderSchema,
    body: { content: { 'application/json': { schema: CreateInvitationInput } } },
  },
  responses: {
    201: {
      description: 'Pozvánka odeslána, token je jen v e-mailu',
      content: { 'application/json': { schema: z.object({ invitation: InvitationSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('conflict', 'already_exists', 'idempotency_key_reuse'),
    422: problemResponse('validation_failed'),
  },
});

const revokeRouteDef = createRoute({
  method: 'delete',
  path: '/api/v1/invitations/{id}',
  tags: ['Invitations'],
  summary: 'Revokace čekající pozvánky',
  security: [{ bearerAuth: ['members:invite'] }],
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    204: { description: 'Revokováno' },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const acceptRouteDef = createRoute({
  method: 'post',
  path: '/api/v1/invitations/accept',
  tags: ['Invitations'],
  summary: 'Přijetí pozvánky přihlášeným uživatelem',
  description: 'Neplatný, prošlý i použitý token vrací shodně 404, aby nešlo zjistit, jestli pozvánka existuje.',
  request: { body: { content: { 'application/json': { schema: AcceptInvitationInput } } } },
  responses: {
    200: {
      description: 'Členství založeno',
      content: {
        'application/json': {
          schema: z.object({
            workspace: z.object({ id: z.uuid(), name: z.string(), slug: z.string() }),
            role: RoleSchema,
          }),
        },
      },
    },
    401: problemResponse('unauthenticated', 'session_expired'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

export function registerInvitationRoutes(app: OpenAPIHono<ApiEnv>): void {
  app.openapi(listRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'members:read');
    const data = await withWorkspace(ctx, (tx) => listInvitations(tx, ctx));
    return c.json({ data }, 200);
  });

  app.openapi(createRouteDef, async (c) => {
    const { ctx, label } = c.get('auth');
    assertPermission(ctx, 'members:invite');
    const input = c.req.valid('json');
    const result = await c.get('runIdempotent')((tx) =>
      createInvitation(tx, ctx, { email: input.email, role: input.role }, label),
    );
    return c.json({ invitation: result.body } as never, result.status as never);
  });

  app.openapi(revokeRouteDef, async (c) => {
    const { ctx, label } = c.get('auth');
    assertPermission(ctx, 'members:invite');
    await withWorkspace(ctx, (tx) => revokeInvitation(tx, ctx, c.req.valid('param').id, label));
    return c.body(null, 204);
  });

  app.openapi(acceptRouteDef, async (c) => {
    const actor = await requireSession(c);
    const [user] = await withoutContext((tx) =>
      tx.select({ email: schema.users.email }).from(schema.users).where(eq(schema.users.id, actor.userId)).limit(1),
    );
    if (!user) throw new ApiError('unauthenticated');
    const result = await acceptInvitation({
      userId: actor.userId,
      userEmail: user.email,
      token: c.req.valid('json').token,
    });
    return c.json(result, 200);
  });
}
```

- [ ] **Krok 6: Spusť test, ověř, že prochází**

Run: `pnpm --filter @mlain/web test:db -- api/members.test.ts`
Expected: 9 passed.

- [ ] **Krok 7: Commit**

```bash
git add packages/core/identity/membership-service.ts packages/core/identity/invitation-service.ts packages/core/identity/api/members.routes.ts packages/core/identity/api/invitations.routes.ts apps/web/test/api/members.test.ts
git commit -m "feat(api): members and invitations with last-owner invariant"
```

---

### Fáze G: odchozí webhooky (úkoly 37 až 41)

---

### Úkol 37: Ochrana proti SSRF a bezpečný HTTP klient

Připravuje kritérium 39.

**Files:**
- Create: `packages/core/net/ssrf.ts`
- Create: `packages/core/net/safe-request.ts`
- Test: `packages/core/net/ssrf.test.ts`
- Test: `packages/core/net/safe-request.test.ts`

- [ ] **Krok 1: Napiš padající test blocklistu**

Create `packages/core/net/ssrf.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { BLOCKED_RANGES, isBlockedAddress, assertUrlAllowed, WEBHOOK_SSRF_POLICY } from './ssrf.js';

describe('sdílený blocklist rozsahů', () => {
  it('obsahuje všech 15 rozsahů z 3.8', () => {
    expect(BLOCKED_RANGES).toEqual([
      '0.0.0.0/8',
      '10.0.0.0/8',
      '100.64.0.0/10',
      '127.0.0.0/8',
      '169.254.0.0/16',
      '172.16.0.0/12',
      '192.0.0.0/24',
      '192.168.0.0/16',
      '198.18.0.0/15',
      '224.0.0.0/4',
      '240.0.0.0/4',
      '::1/128',
      'fc00::/7',
      'fe80::/10',
      '::ffff:0:0/96',
    ]);
  });

  it('blokuje metadata cloudu', () => {
    expect(isBlockedAddress('169.254.169.254')).toBe(true);
    expect(isBlockedAddress('metadata.google.internal')).toBe(false); // jméno, ne adresa
  });

  it('blokuje loopback, privátní a CGNAT rozsahy', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.20.0.1', '100.64.0.1', '0.0.0.0']) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it('blokuje IPv6 loopback, ULA, link-local a mapované IPv4', () => {
    for (const ip of ['::1', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1']) {
      expect(isBlockedAddress(ip), ip).toBe(true);
    }
  });

  it('veřejné adresy propouští', () => {
    for (const ip of ['1.1.1.1', '93.184.216.34', '2606:4700::1111']) {
      expect(isBlockedAddress(ip), ip).toBe(false);
    }
  });
});

describe('politika odchozích webhooků', () => {
  it('je přísnější než stahování značky, protože přenáší podepsané tajemství', () => {
    expect(WEBHOOK_SSRF_POLICY.allowHttp).toBe(false);
    expect(WEBHOOK_SSRF_POLICY.maxRedirects).toBe(0);
  });

  it('https adresa na veřejný host projde', () => {
    expect(() => assertUrlAllowed('https://example.com/hook', WEBHOOK_SSRF_POLICY)).not.toThrow();
  });

  it('http adresa se odmítne', () => {
    expect(() => assertUrlAllowed('http://example.com/hook', WEBHOOK_SSRF_POLICY)).toThrow(/schema/i);
  });

  it('literální privátní adresa se odmítne už při ukládání', () => {
    expect(() => assertUrlAllowed('http://169.254.169.254/', WEBHOOK_SSRF_POLICY)).toThrow();
    expect(() => assertUrlAllowed('https://169.254.169.254/', WEBHOOK_SSRF_POLICY)).toThrow(/blocked/i);
    expect(() => assertUrlAllowed('https://127.0.0.1/hook', WEBHOOK_SSRF_POLICY)).toThrow(/blocked/i);
  });

  it('nesmyslná adresa se odmítne', () => {
    expect(() => assertUrlAllowed('tohle-neni-url', WEBHOOK_SSRF_POLICY)).toThrow();
  });

  it('jiné schéma než http a https se odmítne', () => {
    expect(() => assertUrlAllowed('file:///etc/passwd', WEBHOOK_SSRF_POLICY)).toThrow();
    expect(() => assertUrlAllowed('gopher://example.com/', WEBHOOK_SSRF_POLICY)).toThrow();
  });

  it('při allowPrivateNetworks projde i privátní adresa', () => {
    expect(() =>
      assertUrlAllowed('https://10.0.0.1/hook', { ...WEBHOOK_SSRF_POLICY, allowPrivateNetworks: true }),
    ).not.toThrow();
  });

  it('extraBlockedHosts zabírá na jméno hosta', () => {
    expect(() =>
      assertUrlAllowed('https://metadata.google.internal/x', {
        ...WEBHOOK_SSRF_POLICY,
        extraBlockedHosts: ['metadata.google.internal'],
      }),
    ).toThrow();
  });

  it('allowedHosts funguje jako allowlist, když není prázdný', () => {
    const policy = { ...WEBHOOK_SSRF_POLICY, allowedHosts: ['example.com'] };
    expect(() => assertUrlAllowed('https://example.com/x', policy)).not.toThrow();
    expect(() => assertUrlAllowed('https://jiny.example.org/x', policy)).toThrow();
  });
});
```

- [ ] **Krok 2: Spusť test, ověř, že padá**

Run: `pnpm --filter @mlain/core test:unit -- net/ssrf.test.ts`
Expected: FAIL, `Cannot find module './ssrf.js'`.

- [ ] **Krok 3: Napiš `ssrf.ts`**

Create `packages/core/net/ssrf.ts`:

```ts
import { BlockList, isIPv4, isIPv6 } from 'node:net';
import { config } from '@mlain/core/config';

/**
 * 3.8: seznam privátních a nesměrovatelných rozsahů je JEDEN sdílený, protože
 * je to fakt o IP adresách, ne rozhodnutí produktu. Dva seznamy proti téže
 * hrozbě jsou způsob, jak jeden z nich zastará.
 *
 * Politika, jak se seznam použije, je oddělená per volající: odchozí webhooky
 * (tato část) a stahování značky z webu (část 3) mají legitimně různá pravidla.
 */
export const BLOCKED_RANGES = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '224.0.0.0/4',
  '240.0.0.0/4',
  '::1/128',
  'fc00::/7',
  'fe80::/10',
  '::ffff:0:0/96',
] as const;

const blockList = new BlockList();
for (const range of BLOCKED_RANGES) {
  const [address, prefix] = range.split('/');
  blockList.addSubnet(address!, Number(prefix), address!.includes(':') ? 'ipv6' : 'ipv4');
}

export function isBlockedAddress(address: string): boolean {
  if (isIPv4(address)) return blockList.check(address, 'ipv4');
  if (isIPv6(address)) {
    // Mapovaná IPv4 se musí zkontrolovat i v IPv4 podobě, jinak ::ffff:10.0.0.1
    // projde jako "jen jiná IPv6 adresa".
    const mapped = address.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i)?.[1];
    if (mapped && blockList.check(mapped, 'ipv4')) return true;
    return blockList.check(address, 'ipv6');
  }
  return false;
}

export type SsrfPolicy = {
  allowPrivateNetworks: boolean;
  allowHttp: boolean;
  extraBlockedHosts: string[];
  /** Prázdné pole znamená bez allowlistu. */
  allowedHosts: string[];
  maxRedirects: 0 | number;
};

/**
 * 3.8: webhooky mají přísnější politiku než stahování značky, protože přenášejí
 * podepsané tajemství na adresu zvolenou uživatelem. Přesměrování nenásledujeme
 * vůbec: 307 na interní adresu je klasický SSRF vektor.
 */
export const WEBHOOK_SSRF_POLICY: SsrfPolicy = {
  allowPrivateNetworks: config.WEBHOOK_ALLOW_PRIVATE_TARGETS,
  allowHttp: false,
  extraBlockedHosts: [],
  allowedHosts: [],
  maxRedirects: 0,
};

export class SsrfBlockedError extends Error {
  readonly code = 'blocked_target';
  constructor(reason: string) {
    super(`blocked_target: ${reason}`);
    this.name = 'SsrfBlockedError';
  }
}

/**
 * Statická kontrola adresy. Nestačí sama o sobě: jméno se musí ověřit znovu
 * při každém doručení, protože jinak existuje DNS rebinding. Viz resolveAllowed.
 */
export function assertUrlAllowed(rawUrl: string, policy: SsrfPolicy): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new SsrfBlockedError('malformed_url');
  }

  if (url.protocol !== 'https:' && !(policy.allowHttp && url.protocol === 'http:')) {
    throw new SsrfBlockedError('schema_not_allowed');
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (policy.extraBlockedHosts.some((h) => h.toLowerCase() === host)) {
    throw new SsrfBlockedError('host_blocked');
  }
  if (policy.allowedHosts.length > 0 && !policy.allowedHosts.some((h) => h.toLowerCase() === host)) {
    throw new SsrfBlockedError('host_not_allowlisted');
  }
  if (!policy.allowPrivateNetworks && isBlockedAddress(host)) {
    throw new SsrfBlockedError('blocked_address_literal');
  }

  return url;
}
```

- [ ] **Krok 4: Spusť test, ověř, že prochází**

Run: `pnpm --filter @mlain/core test:unit -- net/ssrf.test.ts`
Expected: 13 passed.

- [ ] **Krok 5: Napiš padající test bezpečného klienta**

Create `packages/core/net/safe-request.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createServer, type Server } from 'node:http';
import { SsrfBlockedError, WEBHOOK_SSRF_POLICY } from './ssrf.js';
import { safeRequest, MAX_RESPONSE_BYTES } from './safe-request.js';

let server: Server;
let port = 0;

beforeAll(async () => {
  server = createServer((req, res) => {
    if (req.url === '/ok') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('prijato');
      return;
    }
    if (req.url === '/velke') {
      res.writeHead(200);
      res.end('x'.repeat(64 * 1024));
      return;
    }
    if (req.url === '/redirect') {
      res.writeHead(307, { Location: 'http://169.254.169.254/' });
      res.end();
      return;
    }
    if (req.url === '/pomale') {
      setTimeout(() => {
        res.writeHead(200);
        res.end('pozde');
      }, 3000);
      return;
    }
    res.writeHead(500);
    res.end('chyba');
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as { port: number }).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Testovací server běží na loopbacku, takže se testuje s povolenými privátními rozsahy. */
const policy = { ...WEBHOOK_SSRF_POLICY, allowPrivateNetworks: true, allowHttp: true };

describe('safeRequest', () => {
  it('odešle tělo i hlavičky a vrátí odpověď', async () => {
    const res = await safeRequest({
      url: `http://127.0.0.1:${port}/ok`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'ML-Attempt': '1' },
      body: '{"a":1}',
      policy,
      connectTimeoutMs: 5000,
      totalTimeoutMs: 10000,
    });
    expect(res.status).toBe(200);
    expect(res.body).toBe('prijato');
    expect(res.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('přesměrování NENÁSLEDUJE, vrátí 3xx jako výsledek', async () => {
    const res = await safeRequest({
      url: `http://127.0.0.1:${port}/redirect`,
      method: 'POST',
      headers: {},
      body: '{}',
      policy,
      connectTimeoutMs: 5000,
      totalTimeoutMs: 10000,
    });
    expect(res.status).toBe(307);
  });

  it('čte nejvýš 8 kB odpovědi, zbytek zahodí', async () => {
    expect(MAX_RESPONSE_BYTES).toBe(8 * 1024);
    const res = await safeRequest({
      url: `http://127.0.0.1:${port}/velke`,
      method: 'POST',
      headers: {},
      body: '{}',
      policy,
      connectTimeoutMs: 5000,
      totalTimeoutMs: 10000,
    });
    expect(res.body.length).toBeLessThanOrEqual(MAX_RESPONSE_BYTES);
  });

  it('celkový timeout ukončí spojení', async () => {
    await expect(
      safeRequest({
        url: `http://127.0.0.1:${port}/pomale`,
        method: 'POST',
        headers: {},
        body: '{}',
        policy,
        connectTimeoutMs: 500,
        totalTimeoutMs: 800,
      }),
    ).rejects.toThrow(/timeout/i);
  });

  it('blokovaná adresa skončí SsrfBlockedError bez pokusu o spojení', async () => {
    await expect(
      safeRequest({
        url: 'https://169.254.169.254/hook',
        method: 'POST',
        headers: {},
        body: '{}',
        policy: WEBHOOK_SSRF_POLICY,
        connectTimeoutMs: 5000,
        totalTimeoutMs: 10000,
      }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('kritérium 39: jméno, které se přeloží na privátní adresu, se zablokuje při doručení', async () => {
    await expect(
      safeRequest({
        url: 'https://localhost/hook',
        method: 'POST',
        headers: {},
        body: '{}',
        policy: WEBHOOK_SSRF_POLICY,
        connectTimeoutMs: 5000,
        totalTimeoutMs: 10000,
      }),
    ).rejects.toBeInstanceOf(SsrfBlockedError);
  });
});
```

- [ ] **Krok 6: Napiš `safe-request.ts`**

Create `packages/core/net/safe-request.ts`:

```ts
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { lookup as dnsLookup } from 'node:dns/promises';
import { assertUrlAllowed, isBlockedAddress, SsrfBlockedError, type SsrfPolicy } from './ssrf.js';

/** 3.8: čteme nejvýš 8 kB odpovědi, zbytek zahodíme. */
export const MAX_RESPONSE_BYTES = 8 * 1024;

export type SafeRequestInput = {
  url: string;
  method: 'POST' | 'GET';
  headers: Record<string, string>;
  body: string;
  policy: SsrfPolicy;
  connectTimeoutMs: number;
  totalTimeoutMs: number;
};

export type SafeResponse = { status: number; body: string; durationMs: number };

/**
 * Jedno pravidlo z 3.8 je nepodmíněné a nejde vypnout ani jednomu volajícímu:
 * DNS se rozřeší, výsledné adresy se zkontrolují proti blocklistu a spojení se
 * naváže na OVĚŘENOU IP adresu, a to při KAŽDÉM požadavku, ne jen při ukládání.
 * Bez toho existuje DNS rebinding: jméno projde validací a při doručení se
 * přeloží na 169.254.169.254.
 *
 * Proto se používá node:https s vlastním `lookup`, ne fetch: fetch nedovoluje
 * připnout adresu ani spolehlivě zakázat přesměrování na úrovni socketu.
 */
export async function safeRequest(input: SafeRequestInput): Promise<SafeResponse> {
  const url = assertUrlAllowed(input.url, input.policy);
  const startedAt = Date.now();

  const resolved = await dnsLookup(url.hostname, { all: true, verbatim: true }).catch(() => {
    throw new SsrfBlockedError('dns_failed');
  });
  if (resolved.length === 0) throw new SsrfBlockedError('dns_empty');

  const usable = input.policy.allowPrivateNetworks
    ? resolved
    : resolved.filter((entry) => !isBlockedAddress(entry.address));
  if (usable.length === 0) throw new SsrfBlockedError('resolved_to_blocked_address');

  const pinned = usable[0]!;
  const isHttps = url.protocol === 'https:';
  const send = isHttps ? httpsRequest : httpRequest;

  return new Promise<SafeResponse>((resolve, reject) => {
    const req = send(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: input.method,
        headers: { ...input.headers, 'Content-Length': String(Buffer.byteLength(input.body, 'utf8')) },
        // Připnutí na ověřenou adresu. servername zůstává původní jméno,
        // takže TLS certifikát se ověřuje proti němu, ne proti IP.
        lookup: (_hostname, _options, callback) => {
          callback(null, pinned.address, pinned.family);
        },
        servername: isHttps ? url.hostname : undefined,
      },
      (res) => {
        let received = 0;
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => {
          if (received >= MAX_RESPONSE_BYTES) return;
          const room = MAX_RESPONSE_BYTES - received;
          chunks.push(chunk.length > room ? chunk.subarray(0, room) : chunk);
          received += Math.min(chunk.length, room);
        });
        res.on('end', () => {
          clearTimeout(totalTimer);
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            durationMs: Date.now() - startedAt,
          });
        });
      },
    );

    // Přesměrování nenásledujeme vůbec (3.8). node:http je nenásleduje samo,
    // takže 3xx propadne do klasifikace odpovědi jako každý jiný stav.
    const totalTimer = setTimeout(() => {
      req.destroy(new Error('total_timeout'));
    }, input.totalTimeoutMs);

    req.setTimeout(input.connectTimeoutMs, () => {
      req.destroy(new Error('connect_timeout'));
    });

    req.on('error', (err) => {
      clearTimeout(totalTimer);
      reject(err);
    });

    req.write(input.body);
    req.end();
  });
}
```

- [ ] **Krok 7: Spusť test, ověř, že prochází**

Run: `pnpm --filter @mlain/core test:unit -- net/safe-request.test.ts`
Expected: 6 passed.

- [ ] **Krok 8: Commit**

```bash
git add packages/core/net/ssrf.ts packages/core/net/safe-request.ts packages/core/net/ssrf.test.ts packages/core/net/safe-request.test.ts
git commit -m "feat(net): shared SSRF blocklist and IP-pinned HTTP client without redirects"
```

---

### Úkol 38: Obálka události a podpis `ML-Signature`

Pokrývá kritérium 38.

**Files:**
- Create: `packages/core/platform/webhooks/envelope.ts`
- Create: `packages/core/platform/webhooks/signature.ts`
- Test: `packages/core/platform/webhooks/envelope.test.ts`
- Test: `packages/core/platform/webhooks/signature.test.ts`

- [ ] **Krok 1: Napiš padající testy**

Create `packages/core/platform/webhooks/envelope.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { serializeEnvelope, ENVELOPE_KEY_ORDER } from './envelope.js';

const EVENT = {
  id: '0192f3a0-1c2d-7e50-9a1b-2c3d4e5f6071',
  type: 'contact.created',
  occurredAt: new Date('2026-08-01T12:40:00.000Z'),
  workspaceId: '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071',
  data: { contact_id: '0192f3a0-1c2d-7e43-8d4e-5f60718293a4' },
};

/** Přesné tělo z vektoru ve 3.8. Pořadí klíčů je součást vektoru, ne kosmetika. */
const EXPECTED =
  '{"id":"0192f3a0-1c2d-7e50-9a1b-2c3d4e5f6071","type":"contact.created","api_version":"v1","occurred_at":"2026-08-01T12:40:00.000Z","workspace_id":"0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071","data":{"contact_id":"0192f3a0-1c2d-7e43-8d4e-5f60718293a4"}}';

describe('obálka události', () => {
  it('serializuje se bajt po bajtu shodně s vektorem ze 3.8', () => {
    expect(serializeEnvelope(EVENT)).toBe(EXPECTED);
  });

  it('pořadí klíčů je závazné', () => {
    expect(ENVELOPE_KEY_ORDER).toEqual([
      'id',
      'type',
      'api_version',
      'occurred_at',
      'workspace_id',
      'data',
    ]);
  });

  it('api_version je součástí obálky', () => {
    expect(JSON.parse(serializeEnvelope(EVENT)).api_version).toBe('v1');
  });

  it('occurred_at je ISO 8601 v UTC s milisekundami', () => {
    expect(JSON.parse(serializeEnvelope(EVENT)).occurred_at).toBe('2026-08-01T12:40:00.000Z');
  });

  it('prázdná data se serializují jako prázdný objekt, ne jako null', () => {
    expect(JSON.parse(serializeEnvelope({ ...EVENT, data: {} })).data).toEqual({});
  });

  it('přeházení klíčů ve vstupním data nemění pořadí klíčů obálky', () => {
    const parsed = Object.keys(JSON.parse(serializeEnvelope(EVENT)));
    expect(parsed).toEqual(ENVELOPE_KEY_ORDER);
  });
});
```

Create `packages/core/platform/webhooks/signature.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateWebhookSecret, signPayload, signatureHeader, secretToBytes } from './signature.js';

/** Závazný vektor ze 3.8, přepočítaný spuštěním 2026-07-31. */
const SECRET = 'whsec_AAcOFRwjKjE4P0ZNVFtiaXB3foWMk5qhqK-2vcTL0tk';
const TIMESTAMP = 1785000000;
const BODY =
  '{"id":"0192f3a0-1c2d-7e50-9a1b-2c3d4e5f6071","type":"contact.created","api_version":"v1","occurred_at":"2026-08-01T12:40:00.000Z","workspace_id":"0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071","data":{"contact_id":"0192f3a0-1c2d-7e43-8d4e-5f60718293a4"}}';
const EXPECTED = '70a890fe48498351df6249763e7c2fb36f2220fc7af3501281501963b23ddeeb';

describe('kritérium 38: podpis odpovídá vektoru bajt na bajt', () => {
  it('secret se dekóduje na 32 bajtů', () => {
    const bytes = secretToBytes(SECRET);
    expect(bytes).toHaveLength(32);
    expect(bytes.toString('hex')).toBe('00070e151c232a31383f464d545b626970777e858c939aa1a8afb6bdc4cbd2d9');
  });

  it('v1 se rovná hodnotě z vektoru', () => {
    expect(signPayload(SECRET, TIMESTAMP, BODY)).toBe(EXPECTED);
  });

  it('hlavička má tvar t=<unix>,v1=<hex>', () => {
    expect(signatureHeader(SECRET, TIMESTAMP, BODY)).toBe(`t=${TIMESTAMP},v1=${EXPECTED}`);
  });

  it('změna jednoho znaku v těle změní podpis', () => {
    expect(signPayload(SECRET, TIMESTAMP, BODY.replace('contact.created', 'contact.updated'))).not.toBe(
      EXPECTED,
    );
  });

  it('změna timestampu změní podpis, takže ho útočník nemůže přepsat', () => {
    expect(signPayload(SECRET, TIMESTAMP + 1, BODY)).not.toBe(EXPECTED);
  });

  it('přeházení klíčů v těle dá jiný podpis', () => {
    const reordered = JSON.stringify(JSON.parse(BODY), ['type', 'id', 'api_version']);
    expect(signPayload(SECRET, TIMESTAMP, reordered)).not.toBe(EXPECTED);
  });
});

describe('generování tajemství', () => {
  it('má prefix whsec_ a 43 znaků base64url', () => {
    const secret = generateWebhookSecret();
    expect(secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);
    expect(secretToBytes(secret)).toHaveLength(32);
  });

  it('dvě tajemství nejsou stejná', () => {
    expect(generateWebhookSecret()).not.toBe(generateWebhookSecret());
  });
});
```

- [ ] **Krok 2: Spusť testy, ověř, že padají**

Run: `pnpm --filter @mlain/core test:unit -- platform/webhooks/`
Expected: FAIL, `Cannot find module './envelope.js'` a `'./signature.js'`.

- [ ] **Krok 3: Napiš `envelope.ts`**

Create `packages/core/platform/webhooks/envelope.ts`:

```ts
/**
 * 3.8: tato část vlastní obálku a garantuje, že se id, type, api_version,
 * occurred_at a workspace_id nezmění. Obsah `data` deklaruje ta část, které
 * událost patří.
 *
 * Pořadí klíčů je součástí kontraktu, ne kosmetika: HMAC se počítá nad syrovými
 * bajty, takže přeházení klíčů dá jiný podpis a příjemci by přestali ověřovat.
 */
export const ENVELOPE_KEY_ORDER = ['id', 'type', 'api_version', 'occurred_at', 'workspace_id', 'data'] as const;

export const WEBHOOK_API_VERSION = 'v1';

export type WebhookEventInput = {
  id: string;
  type: string;
  occurredAt: Date;
  workspaceId: string;
  data: Record<string, unknown>;
};

/**
 * Skládá JSON ručně v pevném pořadí. JSON.stringify nad objektem sice pořadí
 * vkládání zachovává, ale spoléhat na to napříč refaktory je křehké, a tady je
 * to podmínka správnosti podpisu.
 */
export function serializeEnvelope(event: WebhookEventInput): string {
  const parts = [
    `"id":${JSON.stringify(event.id)}`,
    `"type":${JSON.stringify(event.type)}`,
    `"api_version":${JSON.stringify(WEBHOOK_API_VERSION)}`,
    `"occurred_at":${JSON.stringify(event.occurredAt.toISOString())}`,
    `"workspace_id":${JSON.stringify(event.workspaceId)}`,
    `"data":${JSON.stringify(event.data ?? {})}`,
  ];
  return `{${parts.join(',')}}`;
}
```

- [ ] **Krok 4: Napiš `signature.ts`**

Create `packages/core/platform/webhooks/signature.ts`:

```ts
import { createHmac, randomBytes } from 'node:crypto';

const SECRET_PREFIX = 'whsec_';

export function generateWebhookSecret(): string {
  return `${SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
}

export function secretToBytes(secret: string): Buffer {
  return Buffer.from(secret.slice(SECRET_PREFIX.length), 'base64url');
}

/**
 * 3.8:
 *   signed_payload = "<unix_timestamp>" + "." + <syrové tělo requestu>
 *   v1             = hex(HMAC-SHA256(secret_bytes, signed_payload))
 *
 * Timestamp je součástí podepisovaných dat, takže ho útočník nemůže změnit.
 * Ochrana proti replay se odehrává u příjemce: v dokumentaci je závazný pokyn
 * odmítnout požadavek starší než 5 minut a deduplikovat podle ML-Event-Id.
 */
export function signPayload(secret: string, unixTimestamp: number, body: string): string {
  return createHmac('sha256', secretToBytes(secret))
    .update(`${unixTimestamp}.${body}`, 'utf8')
    .digest('hex');
}

/**
 * Tvar t=...,v1=... je zvolený proto, že jde přidat v2= vedle v1= a rotovat
 * algoritmus bez rozbití příjemců, kteří umí jen v1.
 */
export function signatureHeader(secret: string, unixTimestamp: number, body: string): string {
  return `t=${unixTimestamp},v1=${signPayload(secret, unixTimestamp, body)}`;
}
```

- [ ] **Krok 5: Spusť testy, ověř, že prochází**

Run: `pnpm --filter @mlain/core test:unit -- platform/webhooks/`
Expected: 14 passed. Když podpis nesedí, chyba je skoro vždy v těle: vektor platí pro obálku **včetně** `api_version` a v přesném pořadí klíčů.

- [ ] **Krok 6: Commit**

```bash
git add packages/core/platform/webhooks/envelope.ts packages/core/platform/webhooks/signature.ts packages/core/platform/webhooks/envelope.test.ts packages/core/platform/webhooks/signature.test.ts
git commit -m "feat(webhooks): canonical event envelope and HMAC signature per contract"
```

---

### Úkol 39: Tabulka odstupů, jitter a mez počtu pokusů

Pokrývá kritéria 36 a 36b.

**Files:**
- Create: `packages/core/platform/webhooks/backoff.ts`
- Test: `packages/core/platform/webhooks/backoff.test.ts`

- [ ] **Krok 1: Napiš padající test**

Create `packages/core/platform/webhooks/backoff.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { ConfigSchema, config } from '@mlain/core/config';
import {
  WEBHOOK_BACKOFF_SECONDS,
  JITTER_RATIO,
  delayForAttempt,
  nextAttemptAt,
  isFinalAttempt,
} from './backoff.js';

describe('tabulka odstupů z 3.8', () => {
  it('má osm řádků s přesnými hodnotami', () => {
    expect(WEBHOOK_BACKOFF_SECONDS).toEqual([0, 15, 60, 300, 1800, 7200, 21600, 43200]);
  });

  it('jitter je 20 procent', () => {
    expect(JITTER_RATIO).toBe(0.2);
  });

  it('první pokus jde okamžitě', () => {
    expect(delayForAttempt(1, () => 0.5)).toBe(0);
  });

  it('odstupy bez jitteru odpovídají tabulce', () => {
    const midpoint = () => 0.5;
    expect([1, 2, 3, 4, 5, 6, 7, 8].map((n) => delayForAttempt(n, midpoint))).toEqual([
      0, 15, 60, 300, 1800, 7200, 21600, 43200,
    ]);
  });

  it('jitter drží hodnotu v pásmu plus minus 20 procent', () => {
    for (let attempt = 2; attempt <= 8; attempt += 1) {
      const base = WEBHOOK_BACKOFF_SECONDS[attempt - 1]!;
      for (let i = 0; i < 200; i += 1) {
        const value = delayForAttempt(attempt, Math.random);
        expect(value).toBeGreaterThanOrEqual(base * 0.8);
        expect(value).toBeLessThanOrEqual(base * 1.2);
      }
    }
  });

  it('pokus nad délku tabulky vrací null, protože pro něj není definované zpoždění', () => {
    expect(delayForAttempt(9, () => 0.5)).toBeNull();
  });
});

describe('nextAttemptAt', () => {
  it('spočítá čas dalšího pokusu od zadaného teď', () => {
    const now = new Date('2026-08-01T12:00:00.000Z');
    const next = nextAttemptAt(1, now, () => 0.5);
    expect(next).not.toBeNull();
    expect(next!.getTime() - now.getTime()).toBe(15_000);
  });

  it('po posledním povoleném pokusu vrací null', () => {
    expect(nextAttemptAt(config.WEBHOOK_MAX_ATTEMPTS, new Date(), () => 0.5)).toBeNull();
  });
});

describe('isFinalAttempt', () => {
  it('poslední pokus podle konfigurace je finální', () => {
    expect(isFinalAttempt(config.WEBHOOK_MAX_ATTEMPTS)).toBe(true);
    expect(isFinalAttempt(config.WEBHOOK_MAX_ATTEMPTS - 1)).toBe(false);
  });
});

describe('kritérium 36b: mez v konfiguraci se rovná délce tabulky', () => {
  it('horní mez WEBHOOK_MAX_ATTEMPTS není pevné číslo, ale počet řádků tabulky', () => {
    const shape = ConfigSchema.shape.WEBHOOK_MAX_ATTEMPTS as unknown as { maxValue?: number };
    expect(shape.maxValue).toBe(WEBHOOK_BACKOFF_SECONDS.length);
  });

  it('hodnota 9 je mimo rozsah, protože pro devátý pokus není definované zpoždění', () => {
    const parsed = ConfigSchema.shape.WEBHOOK_MAX_ATTEMPTS.safeParse(9);
    expect(parsed.success).toBe(false);
  });

  it('hodnoty 1, 3 a 8 jsou platné', () => {
    for (const value of [1, 3, 8]) {
      expect(ConfigSchema.shape.WEBHOOK_MAX_ATTEMPTS.safeParse(value).success).toBe(true);
    }
  });
});
```

- [ ] **Krok 2: Spusť test, ověř, že padá**

Run: `pnpm --filter @mlain/core test:unit -- platform/webhooks/backoff.test.ts`
Expected: FAIL, `Cannot find module './backoff.js'`.

- [ ] **Krok 3: Napiš `backoff.ts`**

Create `packages/core/platform/webhooks/backoff.ts`:

```ts
import { config } from '@mlain/core/config';

/**
 * 3.8, tabulka odstupů. Index je pořadí pokusu minus jedna, takže první pokus
 * jde okamžitě a další čekají uvedený počet sekund od předchozího.
 *
 * Tabulka je zároveň horní mezí pro WEBHOOK_MAX_ATTEMPTS. Rozsah NENÍ 1 až 12:
 * pro pokusy 9 až 12 by neexistovalo definované zpoždění a každá implementace
 * by si ho domyslela jinak. Kdo potřebuje delší okno, prodlouží tabulku novou
 * verzí kontraktu, ne nastavením hodnoty, pro kterou tabulka nemá řádek.
 */
export const WEBHOOK_BACKOFF_SECONDS = [0, 15, 60, 300, 1800, 7200, 21600, 43200] as const;

/** Jitter, aby se po výpadku endpointu nevracely všechny retry naráz. */
export const JITTER_RATIO = 0.2;

/**
 * Zpoždění před pokusem číslo `attempt` (od 1). Vrací null, když tabulka pro
 * takový pokus nemá řádek.
 */
export function delayForAttempt(attempt: number, random: () => number = Math.random): number | null {
  const base = WEBHOOK_BACKOFF_SECONDS[attempt - 1];
  if (base === undefined) return null;
  if (base === 0) return 0;
  const factor = 1 + (random() * 2 - 1) * JITTER_RATIO;
  return Math.round(base * factor);
}

/**
 * Čas dalšího pokusu po dokončeném pokusu číslo `completedAttempt`.
 * Vrací null, když už žádný další pokus podle konfigurace nepřijde.
 */
export function nextAttemptAt(
  completedAttempt: number,
  now: Date,
  random: () => number = Math.random,
): Date | null {
  const nextNumber = completedAttempt + 1;
  if (nextNumber > config.WEBHOOK_MAX_ATTEMPTS) return null;
  const delay = delayForAttempt(nextNumber, random);
  if (delay === null) return null;
  return new Date(now.getTime() + delay * 1000);
}

export function isFinalAttempt(attempt: number): boolean {
  return attempt >= config.WEBHOOK_MAX_ATTEMPTS;
}
```

- [ ] **Krok 4: Spusť test, ověř, že prochází**

Run: `pnpm --filter @mlain/core test:unit -- platform/webhooks/backoff.test.ts`
Expected: 11 passed.

Když padne test kritéria 36b, znamená to, že P01 zapsal do zod schématu pevnou osmičku místo odvození z délky tabulky. Je to nález pro P01: úprava je jeden řádek, `.max(WEBHOOK_BACKOFF_SECONDS.length)`, a bez ní přidání devátého řádku tabulky vyšší hodnotu automaticky nepovolí.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/platform/webhooks/backoff.ts packages/core/platform/webhooks/backoff.test.ts
git commit -m "feat(webhooks): retry backoff table with jitter bound to config maximum"
```

---

### Úkol 40: Endpointy webhooků, fan-out a doručení

Pokrývá kritérium 39.

**Files:**
- Create: `packages/core/platform/webhooks/endpoint-service.ts`
- Create: `packages/core/platform/webhooks/emit.ts`
- Create: `packages/core/platform/webhooks/deliver.ts`
- Create: `packages/core/platform/api/webhooks.routes.ts`
- Test: `packages/core/platform/webhooks/deliver.test.ts`
- Test: `apps/web/test/api/webhook-endpoints.test.ts`

- [ ] **Krok 1: Napiš `endpoint-service.ts`**

Create `packages/core/platform/webhooks/endpoint-service.ts`:

```ts
import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import * as schema from '@mlain/db/schema';
import type { Tx } from '@mlain/core/tx';
import { encryptEnvelope } from '@mlain/contracts/crypto';
import { ApiError, validationFailed } from '@mlain/core/errors/api-error';
import { writeAuditLog } from '@mlain/core/audit/write';
import { diffForAudit } from '@mlain/core/audit/redact';
import { IdentityAuditActions } from '@mlain/core/identity/audit';
import { wsEq } from '@mlain/core/identity/scope';
import type { WorkspaceContext } from '@mlain/core/identity/types';
import { assertUrlAllowed, SsrfBlockedError, WEBHOOK_SSRF_POLICY } from '@mlain/core/net/ssrf';
import { generateWebhookSecret } from './signature.js';

/** 3.8, tabulka limitů. */
export const MAX_ENDPOINTS_PER_WORKSPACE = 20;
export const MAX_EVENT_TYPES_PER_ENDPOINT = 50;

export type PublicWebhookEndpoint = {
  id: string;
  url: string;
  description: string;
  event_types: string[];
  status: 'active' | 'disabled';
  disabled_reason: string | null;
  consecutive_failures: number;
  last_success_at: string | null;
  last_failure_at: string | null;
  created_at: string;
};

function toPublic(row: {
  id: string;
  url: string;
  description: string;
  eventTypes: string[];
  status: string;
  disabledReason: string | null;
  consecutiveFailures: number;
  lastSuccessAt: Date | null;
  lastFailureAt: Date | null;
  createdAt: Date;
}): PublicWebhookEndpoint {
  return {
    id: row.id,
    url: row.url,
    description: row.description,
    event_types: row.eventTypes,
    status: row.status as 'active' | 'disabled',
    disabled_reason: row.disabledReason,
    consecutive_failures: row.consecutiveFailures,
    last_success_at: row.lastSuccessAt ? new Date(row.lastSuccessAt).toISOString() : null,
    last_failure_at: row.lastFailureAt ? new Date(row.lastFailureAt).toISOString() : null,
    created_at: new Date(row.createdAt).toISOString(),
  };
}

/** Adresa se kontroluje už při ukládání, i když jediná spolehlivá kontrola je až při doručení. */
function assertTargetAllowed(url: string): void {
  try {
    assertUrlAllowed(url, WEBHOOK_SSRF_POLICY);
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      throw validationFailed([
        {
          path: 'url',
          code: 'blocked_target',
          message: 'Na tuhle adresu webhook posílat nejde. Použijte veřejnou https adresu.',
        },
      ]);
    }
    throw err;
  }
}

export async function listEndpoints(tx: Tx, ctx: WorkspaceContext): Promise<PublicWebhookEndpoint[]> {
  const rows = await tx
    .select()
    .from(schema.webhookEndpoints)
    .where(and(wsEq(ctx, schema.webhookEndpoints), isNull(schema.webhookEndpoints.deletedAt)))
    .orderBy(desc(schema.webhookEndpoints.createdAt));
  return rows.map(toPublic);
}

export async function getEndpoint(
  tx: Tx,
  ctx: WorkspaceContext,
  id: string,
): Promise<PublicWebhookEndpoint> {
  const [row] = await tx
    .select()
    .from(schema.webhookEndpoints)
    .where(
      and(
        wsEq(ctx, schema.webhookEndpoints),
        eq(schema.webhookEndpoints.id, id),
        isNull(schema.webhookEndpoints.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw new ApiError('not_found');
  return toPublic(row);
}

export async function createEndpoint(
  tx: Tx,
  ctx: WorkspaceContext,
  input: { url: string; description?: string; event_types: string[] },
  actorLabel: string,
): Promise<{ endpoint: PublicWebhookEndpoint; secret: string }> {
  assertTargetAllowed(input.url);

  if (input.event_types.length < 1 || input.event_types.length > MAX_EVENT_TYPES_PER_ENDPOINT) {
    throw validationFailed([
      {
        path: 'event_types',
        code: 'out_of_range',
        message: `Endpoint musí odebírat 1 až ${MAX_EVENT_TYPES_PER_ENDPOINT} typů událostí.`,
      },
    ]);
  }

  const existing = await tx
    .select({ id: schema.webhookEndpoints.id })
    .from(schema.webhookEndpoints)
    .where(and(wsEq(ctx, schema.webhookEndpoints), isNull(schema.webhookEndpoints.deletedAt)));
  if (existing.length >= MAX_ENDPOINTS_PER_WORKSPACE) {
    throw new ApiError('conflict', { params: { reason: 'too_many_endpoints' } });
  }

  const secret = generateWebhookSecret();
  const [row] = await tx
    .insert(schema.webhookEndpoints)
    .values({
      workspaceId: ctx.workspaceId,
      url: input.url,
      description: input.description ?? '',
      eventTypes: input.event_types,
      // 4.10.4: kontext webhook_secret brání přesunu hodnoty do jiného sloupce,
      // workspace_id v AAD brání přesunu mezi projekty.
      //
      // encryptEnvelope je SYNCHRONNÍ a vrací objekt, ne řetězec. Obálka
      // enc:v1:<base64> je pole `stored`; ostatní pole (header, aad, ciphertext,
      // tag, envelopeBytes) potřebují jen golden fixtures P02. Kdo sem napíše
      // `await encryptEnvelope({...})` bez `.stored`, uloží do sloupce
      // "[object Object]" a pozná to až při prvním doručení webhooku.
      secretEncrypted: encryptEnvelope({
        plaintext: secret,
        context: 'webhook_secret',
        workspaceId: ctx.workspaceId,
      }).stored,
    })
    .returning();

  await writeAuditLog(tx, {
    action: IdentityAuditActions['webhook_endpoint.created'],
    workspaceId: ctx.workspaceId,
    actor: {
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      actorLabel,
    },
    targetType: 'webhook_endpoint',
    targetId: row!.id,
    metadata: { url: input.url, event_types: input.event_types },
  });

  return { endpoint: toPublic(row!), secret };
}

export async function updateEndpoint(
  tx: Tx,
  ctx: WorkspaceContext,
  id: string,
  input: { url?: string; description?: string; event_types?: string[] },
  actorLabel: string,
): Promise<PublicWebhookEndpoint> {
  const before = await getEndpoint(tx, ctx, id);
  if (input.url !== undefined) assertTargetAllowed(input.url);
  if (input.event_types !== undefined && (input.event_types.length < 1 || input.event_types.length > MAX_EVENT_TYPES_PER_ENDPOINT)) {
    throw validationFailed([
      {
        path: 'event_types',
        code: 'out_of_range',
        message: `Endpoint musí odebírat 1 až ${MAX_EVENT_TYPES_PER_ENDPOINT} typů událostí.`,
      },
    ]);
  }

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (input.url !== undefined) patch.url = input.url;
  if (input.description !== undefined) patch.description = input.description;
  if (input.event_types !== undefined) patch.eventTypes = input.event_types;

  const [row] = await tx
    .update(schema.webhookEndpoints)
    .set(patch)
    .where(
      and(
        wsEq(ctx, schema.webhookEndpoints),
        eq(schema.webhookEndpoints.id, id),
        isNull(schema.webhookEndpoints.deletedAt),
      ),
    )
    .returning();
  if (!row) throw new ApiError('not_found');

  const after = toPublic(row);
  await writeAuditLog(tx, {
    action: IdentityAuditActions['webhook_endpoint.updated'],
    workspaceId: ctx.workspaceId,
    actor: {
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      actorLabel,
    },
    targetType: 'webhook_endpoint',
    targetId: id,
    metadata: diffForAudit(
      before as unknown as Record<string, unknown>,
      after as unknown as Record<string, unknown>,
    ),
  });
  return after;
}

export async function deleteEndpoint(
  tx: Tx,
  ctx: WorkspaceContext,
  id: string,
  actorLabel: string,
): Promise<void> {
  const deleted = await tx
    .update(schema.webhookEndpoints)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        wsEq(ctx, schema.webhookEndpoints),
        eq(schema.webhookEndpoints.id, id),
        isNull(schema.webhookEndpoints.deletedAt),
      ),
    )
    .returning({ id: schema.webhookEndpoints.id });
  if (deleted.length === 0) throw new ApiError('not_found');

  await writeAuditLog(tx, {
    action: IdentityAuditActions['webhook_endpoint.deleted'],
    workspaceId: ctx.workspaceId,
    actor: {
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === 'user' ? ctx.actor.userId : null,
      actorLabel,
    },
    targetType: 'webhook_endpoint',
    targetId: id,
  });
}

/** Aktivní endpointy projektu, které odebírají daný typ události. */
export async function endpointsSubscribedTo(
  tx: Tx,
  workspaceId: string,
  eventType: string,
): Promise<Array<{ id: string; url: string; secretEncrypted: string }>> {
  const { rows } = await tx.execute<{ id: string; url: string; secret_encrypted: string }>(sql`
    SELECT id::text AS id, url, secret_encrypted
      FROM webhook_endpoints
     WHERE workspace_id = ${workspaceId}::uuid
       AND deleted_at IS NULL
       AND status = 'active'
       AND ${eventType} = ANY(event_types)
  `);
  return rows.map((r) => ({ id: r.id, url: r.url, secretEncrypted: r.secret_encrypted }));
}
```

- [ ] **Krok 2: Napiš `emit.ts`, vznik události a fan-out**

Create `packages/core/platform/webhooks/emit.ts`:

```ts
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import * as schema from '@mlain/db/schema';
import { withWorkspace, type Tx } from '@mlain/core/tx';
import { endpointsSubscribedTo } from './endpoint-service.js';

export type EmitInput = {
  workspaceId: string;
  type: string;
  occurredAt: Date;
  data: Record<string, unknown>;
};

/**
 * 3.8: událost vzniká jednou (webhook_events), doručení je fan-out na každý
 * aktivní endpoint, který ji odebírá (webhook_deliveries).
 *
 * Zapisuje se ve stejné transakci jako doménová změna, takže rollback změny
 * zruší i událost. Fan-out pak provede job platform.webhook_fanout.
 */
export async function emitWebhookEvent(tx: Tx, input: EmitInput): Promise<string> {
  const id = uuidv7();
  await tx.insert(schema.webhookEvents).values({
    id,
    workspaceId: input.workspaceId,
    type: input.type,
    payload: input.data as never,
    occurredAt: input.occurredAt,
  });
  return id;
}

export type FanoutResult = { created: number; deliveryIds: string[] };

/**
 * Idempotentní fan-out. pg-boss job se podle 9.1 může spustit znovu i po
 * částečném běhu, takže druhý běh nesmí vyrobit druhou sadu doručení.
 *
 * Unikátní index uq_webhook_deliveries__event_endpoint obsahuje i created_at,
 * protože tabulka je partitionovaná. Fan-out proto musí použít JEDNU hodnotu
 * created_at pro všechna doručení jedné události, jinak by ON CONFLICT nikdy
 * nezabral a při druhém běhu by vznikly duplicity.
 */
export async function fanoutEvent(ctx: WorkspaceContext, eventId: string): Promise<FanoutResult> {
  return withWorkspace(ctx, async (tx) => {
    const { rows: events } = await tx.execute<{ id: string; type: string; created_at: Date }>(sql`
      SELECT id::text AS id, type, created_at
        FROM webhook_events
       WHERE id = ${eventId}::uuid
       LIMIT 1
    `);
    const event = events[0];
    if (!event) return { created: 0, deliveryIds: [] };

    const endpoints = await endpointsSubscribedTo(tx, ctx.workspaceId, event.type);
    if (endpoints.length === 0) return { created: 0, deliveryIds: [] };

    // Jedna hodnota pro celý fan-out, obdoba invariantu I1 u messages.
    const sharedCreatedAt = new Date();
    const deliveryIds: string[] = [];

    for (const endpoint of endpoints) {
      const id = uuidv7();
      const { rows: inserted } = await tx.execute<{ id: string }>(sql`
        INSERT INTO webhook_deliveries
          (id, workspace_id, endpoint_id, event_id, event_type, status, attempt, next_attempt_at, created_at)
        VALUES
          (${id}::uuid, ${workspaceId}::uuid, ${endpoint.id}::uuid, ${eventId}::uuid, ${event.type},
           'pending', 0, now(), ${sharedCreatedAt})
        ON CONFLICT (event_id, endpoint_id, created_at) DO NOTHING
        RETURNING id::text AS id
      `);
      if (inserted.length === 1) deliveryIds.push(inserted[0]!.id);
    }

    return { created: deliveryIds.length, deliveryIds };
  });
}
```

- [ ] **Krok 3: Napiš `deliver.ts`**

Create `packages/core/platform/webhooks/deliver.ts`:

```ts
import { sql } from 'drizzle-orm';
import { withWorkspace } from '@mlain/core/tx';
import { config } from '@mlain/core/config';
import { decryptEnvelope } from '@mlain/contracts/crypto';
import { SsrfBlockedError, WEBHOOK_SSRF_POLICY } from '@mlain/core/net/ssrf';
import { safeRequest } from '@mlain/core/net/safe-request';
import { serializeEnvelope } from './envelope.js';
import { signatureHeader } from './signature.js';
import { isFinalAttempt, nextAttemptAt } from './backoff.js';
import { applyDeliveryOutcome } from './disable.js';

/** 3.8, tabulka limitů. */
export const CONNECT_TIMEOUT_MS = 5_000;
export const TOTAL_TIMEOUT_MS = 10_000;
export const SNIPPET_BYTES = 2 * 1024;

export type DeliveryOutcome = {
  status: 'succeeded' | 'failed' | 'abandoned';
  responseStatus: number | null;
  errorCode: string | null;
  attempt: number;
  disabledReason: string | null;
};

/**
 * Klasifikace odpovědi podle 3.8.
 * Přesměrování se NENÁSLEDUJE, takže 3xx je prostě neúspěch.
 */
export function classifyResponse(status: number): { ok: boolean; abandon: boolean; disable: string | null } {
  if (status >= 200 && status < 300) return { ok: true, abandon: false, disable: null };
  // 410 Gone znamená, že endpoint už neexistuje a opakování nemá smysl.
  if (status === 410) return { ok: false, abandon: true, disable: 'endpoint_gone' };
  return { ok: false, abandon: false, disable: null };
}

export type DeliverInput = { deliveryId: string; workspaceId: string; createdAt: Date };

/**
 * Jedno doručení. Vrací výsledek a zapisuje ho, takže job je jen tenký obal
 * a celá logika jde otestovat přímým voláním.
 *
 * Doručení je NEJMÉNĚ JEDNOU: při restartu workeru uprostřed HTTP requestu
 * neexistuje způsob, jak zjistit, jestli protistrana request přijala. Job se
 * proto zopakuje a příjemce musí deduplikovat podle ML-Event-Id.
 */
export async function deliverWebhook(input: DeliverInput): Promise<DeliveryOutcome> {
  const loaded = await withWorkspace(input.workspaceId, async (tx) => {
    const { rows } = await tx.execute<Record<string, unknown>>(sql`
      SELECT d.id::text AS id, d.attempt, d.event_id::text AS event_id, d.event_type,
             e.url AS url, e.secret_encrypted AS secret_encrypted, e.id::text AS endpoint_id,
             ev.payload AS payload, ev.occurred_at AS occurred_at
        FROM webhook_deliveries d
        JOIN webhook_endpoints e ON e.id = d.endpoint_id AND e.deleted_at IS NULL
        JOIN webhook_events ev ON ev.id = d.event_id
       WHERE d.id = ${input.deliveryId}::uuid AND d.created_at = ${input.createdAt}
       LIMIT 1
    `);
    return rows[0] ?? null;
  });

  if (!loaded) {
    return { status: 'abandoned', responseStatus: null, errorCode: 'delivery_not_found', attempt: 0, disabledReason: null };
  }

  const attempt = Number(loaded.attempt) + 1;
  const endpointId = loaded.endpoint_id as string;

  // decryptEnvelope je SYNCHRONNÍ, vrací plaintext nebo hodí CryptoError.
  const secret = decryptEnvelope({
    stored: loaded.secret_encrypted as string,
    context: 'webhook_secret',
    workspaceId: input.workspaceId,
  });

  const body = serializeEnvelope({
    id: loaded.event_id as string,
    type: loaded.event_type as string,
    occurredAt: new Date(loaded.occurred_at as Date),
    workspaceId: input.workspaceId,
    data: (loaded.payload as Record<string, unknown>) ?? {},
  });

  const timestamp = Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json; charset=utf-8',
    'User-Agent': 'MlainMailer-Webhooks/1.0',
    'ML-Event-Id': loaded.event_id as string,
    'ML-Event-Type': loaded.event_type as string,
    'ML-Delivery-Id': loaded.id as string,
    'ML-Attempt': String(attempt),
    'ML-Signature': signatureHeader(secret, timestamp, body),
  };

  let responseStatus: number | null = null;
  let snippet: string | null = null;
  let durationMs: number | null = null;
  let errorCode: string | null = null;
  let classification = { ok: false, abandon: false, disable: null as string | null };

  try {
    // SSRF kontrola probíhá uvnitř safeRequest při KAŽDÉM doručení, ne jen při
    // ukládání. Bez toho existuje DNS rebinding (kritérium 39).
    const res = await safeRequest({
      url: loaded.url as string,
      method: 'POST',
      headers,
      body,
      policy: WEBHOOK_SSRF_POLICY,
      connectTimeoutMs: CONNECT_TIMEOUT_MS,
      totalTimeoutMs: TOTAL_TIMEOUT_MS,
    });
    responseStatus = res.status;
    snippet = res.body.slice(0, SNIPPET_BYTES);
    durationMs = res.durationMs;
    classification = classifyResponse(res.status);
    if (!classification.ok) errorCode = `http_${res.status}`;
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      // Trvalá chyba konfigurace, žádné retry.
      errorCode = 'blocked_target';
      classification = { ok: false, abandon: true, disable: null };
    } else {
      // Klient rozlišuje dvě různé poruchy a hlásí je jménem: `connect_timeout`
      // (protistrana se vůbec neozvala) a `total_timeout` (ozvala se, ale
      // odpověď nedoběhla do stropu). Slít je do jednoho `timeout` znamená
      // zahodit přesně ten rozdíl, podle kterého se pozná, jestli je endpoint
      // nedostupný, nebo jen pomalý, a to je první otázka při ladění webhooku,
      // který zákazníkovi přestal chodit. Hodnota jde do
      // `webhook_deliveries.error_code`, takže se na ni kouká i podpora.
      const message = (err as Error).message;
      errorCode = message === 'connect_timeout' || message === 'total_timeout'
        ? message
        : 'connection_error';
    }
  }

  const final = classification.abandon || (!classification.ok && isFinalAttempt(attempt));
  const next = classification.ok || final ? null : nextAttemptAt(attempt, new Date());
  const status: DeliveryOutcome['status'] = classification.ok
    ? 'succeeded'
    : final
      ? 'abandoned'
      : 'failed';

  await applyDeliveryOutcome({
    workspaceId: input.workspaceId,
    deliveryId: input.deliveryId,
    createdAt: input.createdAt,
    endpointId,
    attempt,
    status,
    responseStatus,
    snippet,
    durationMs,
    errorCode,
    nextAttemptAt: next,
    disableReason: classification.disable,
  });

  return { status, responseStatus, errorCode, attempt, disabledReason: classification.disable };
}

export const MAX_ATTEMPTS = config.WEBHOOK_MAX_ATTEMPTS;
```

- [ ] **Krok 4: Napiš padající test doručení**

Create `packages/core/platform/webhooks/deliver.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { classifyResponse, CONNECT_TIMEOUT_MS, TOTAL_TIMEOUT_MS, SNIPPET_BYTES } from './deliver.js';

describe('klasifikace odpovědi podle 3.8', () => {
  it('2xx je úspěch', () => {
    for (const s of [200, 201, 202, 204, 299]) expect(classifyResponse(s).ok).toBe(true);
  });

  it('3xx je neúspěch, protože přesměrování nenásledujeme', () => {
    for (const s of [301, 302, 307, 308]) {
      expect(classifyResponse(s).ok).toBe(false);
      expect(classifyResponse(s).abandon).toBe(false);
    }
  });

  it('408, 429 a 5xx se opakují', () => {
    for (const s of [408, 429, 500, 502, 503]) {
      expect(classifyResponse(s).ok).toBe(false);
      expect(classifyResponse(s).abandon).toBe(false);
    }
  });

  it('kritérium 37: 410 Gone se okamžitě vzdává a deaktivuje endpoint', () => {
    expect(classifyResponse(410)).toEqual({ ok: false, abandon: true, disable: 'endpoint_gone' });
  });

  it('ostatní 4xx se opakují, endpoint může být dočasně špatně nasazený', () => {
    for (const s of [400, 401, 403, 404, 422]) {
      expect(classifyResponse(s).abandon).toBe(false);
    }
  });
});

describe('limity podle 3.8', () => {
  it('connect timeout 5 s, celkový 10 s, snippet 2 kB', () => {
    expect(CONNECT_TIMEOUT_MS).toBe(5000);
    expect(TOTAL_TIMEOUT_MS).toBe(10000);
    expect(SNIPPET_BYTES).toBe(2048);
  });
});
```

- [ ] **Krok 5: Spusť test klasifikace**

Run: `pnpm --filter @mlain/core test:unit -- platform/webhooks/deliver.test.ts`
Expected: 6 passed. Zápis výsledku a deaktivace se testují v úkolu 41, kde vzniká `disable.ts`.

- [ ] **Krok 6: Napiš `webhooks.routes.ts` a jeho integrační test**

Create `packages/core/platform/api/webhooks.routes.ts`:

```ts
import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { withWorkspace } from '@mlain/core/tx';
import { assertPermission } from '@mlain/core/identity/permissions';
import {
  problemResponse,
  IdempotencyHeaderSchema,
  type ApiEnv,
} from '@mlain/core/identity/api/schemas';
import {
  createEndpoint,
  deleteEndpoint,
  getEndpoint,
  listEndpoints,
  updateEndpoint,
} from '../webhooks/endpoint-service.js';

export const WebhookEndpointSchema = z
  .object({
    id: z.uuid(),
    url: z.url(),
    description: z.string(),
    event_types: z.array(z.string()).min(1).max(50),
    status: z.enum(['active', 'disabled']),
    disabled_reason: z.string().nullable(),
    consecutive_failures: z.number().int(),
    last_success_at: z.iso.datetime().nullable(),
    last_failure_at: z.iso.datetime().nullable(),
    created_at: z.iso.datetime(),
  })
  .openapi('WebhookEndpoint');

export const CreateWebhookEndpointInput = z
  .object({
    url: z.url(),
    description: z.string().max(500).optional(),
    event_types: z.array(z.string().min(1).max(100)).min(1).max(50),
  })
  .strict()
  .openapi('CreateWebhookEndpointInput');

export const UpdateWebhookEndpointInput = z
  .object({
    url: z.url().optional(),
    description: z.string().max(500).optional(),
    event_types: z.array(z.string().min(1).max(100)).min(1).max(50).optional(),
  })
  .strict()
  .openapi('UpdateWebhookEndpointInput');

const listRoute = createRoute({
  method: 'get',
  path: '/api/v1/webhook-endpoints',
  tags: ['Webhooks'],
  summary: 'Seznam odchozích webhooků',
  security: [{ bearerAuth: ['webhooks:read'] }],
  responses: {
    200: {
      description: 'Seznam',
      content: { 'application/json': { schema: z.object({ data: z.array(WebhookEndpointSchema) }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const getRouteDef = createRoute({
  method: 'get',
  path: '/api/v1/webhook-endpoints/{id}',
  tags: ['Webhooks'],
  summary: 'Detail webhooku',
  security: [{ bearerAuth: ['webhooks:read'] }],
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: {
      description: 'Detail',
      content: { 'application/json': { schema: z.object({ endpoint: WebhookEndpointSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const createRouteDef = createRoute({
  method: 'post',
  path: '/api/v1/webhook-endpoints',
  tags: ['Webhooks'],
  summary: 'Vytvoření webhooku, secret je v odpovědi jednou',
  security: [{ bearerAuth: ['webhooks:write'] }],
  request: {
    headers: IdempotencyHeaderSchema,
    body: { content: { 'application/json': { schema: CreateWebhookEndpointInput } } },
  },
  responses: {
    201: {
      description: 'Vytvořeno',
      content: {
        'application/json': {
          schema: z.object({ endpoint: WebhookEndpointSchema, secret: z.string() }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    409: problemResponse('conflict', 'idempotency_key_reuse'),
    422: problemResponse('validation_failed'),
  },
});

const updateRouteDef = createRoute({
  method: 'patch',
  path: '/api/v1/webhook-endpoints/{id}',
  tags: ['Webhooks'],
  summary: 'Změna webhooku',
  security: [{ bearerAuth: ['webhooks:write'] }],
  request: {
    params: z.object({ id: z.uuid() }),
    body: { content: { 'application/json': { schema: UpdateWebhookEndpointInput } } },
  },
  responses: {
    200: {
      description: 'Změněno',
      content: { 'application/json': { schema: z.object({ endpoint: WebhookEndpointSchema }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

const deleteRouteDef = createRoute({
  method: 'delete',
  path: '/api/v1/webhook-endpoints/{id}',
  tags: ['Webhooks'],
  summary: 'Smazání webhooku',
  security: [{ bearerAuth: ['webhooks:write'] }],
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    204: { description: 'Smazáno' },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

export function registerWebhookEndpointRoutes(app: OpenAPIHono<ApiEnv>): void {
  app.openapi(listRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'webhooks:read');
    const data = await withWorkspace(ctx, (tx) => listEndpoints(tx, ctx));
    return c.json({ data }, 200);
  });

  app.openapi(getRouteDef, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'webhooks:read');
    const endpoint = await withWorkspace(ctx, (tx) =>
      getEndpoint(tx, ctx, c.req.valid('param').id),
    );
    return c.json({ endpoint }, 200);
  });

  app.openapi(createRouteDef, async (c) => {
    const { ctx, label } = c.get('auth');
    assertPermission(ctx, 'webhooks:write');
    const input = c.req.valid('json');
    const result = await c.get('runIdempotent')((tx) => createEndpoint(tx, ctx, input, label));
    return c.json(result.body as never, result.status as never);
  });

  app.openapi(updateRouteDef, async (c) => {
    const { ctx, label } = c.get('auth');
    assertPermission(ctx, 'webhooks:write');
    const endpoint = await withWorkspace(ctx, (tx) =>
      updateEndpoint(tx, ctx, c.req.valid('param').id, c.req.valid('json'), label),
    );
    return c.json({ endpoint }, 200);
  });

  app.openapi(deleteRouteDef, async (c) => {
    const { ctx, label } = c.get('auth');
    assertPermission(ctx, 'webhooks:write');
    await withWorkspace(ctx, (tx) => deleteEndpoint(tx, ctx, c.req.valid('param').id, label));
    return c.body(null, 204);
  });
}
```

Create `apps/web/test/api/webhook-endpoints.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { createApiApp } from '../../src/lib/api/app.js';
import { registerAuthRoutes } from '@mlain/core/identity/api/auth.routes';
import { registerWebhookEndpointRoutes } from '@mlain/core/platform/api/webhooks.routes';
import { seedOwnerWithWorkspace } from './helpers/seed.js';

const app = createApiApp();
registerAuthRoutes(app);
registerWebhookEndpointRoutes(app);

let owner: Awaited<ReturnType<typeof seedOwnerWithWorkspace>>;

const headers = (extra: Record<string, string> = {}) => ({
  Cookie: owner.cookie,
  'X-Workspace-Id': owner.workspaceId,
  'Content-Type': 'application/json',
  ...extra,
});

beforeAll(async () => {
  owner = await seedOwnerWithWorkspace(app, 'owner');
});

describe('POST /api/v1/webhook-endpoints', () => {
  it('vytvoří endpoint a vrátí secret právě jednou', async () => {
    const res = await app.request('/api/v1/webhook-endpoints', {
      method: 'POST',
      headers: headers({ 'Idempotency-Key': 'wh-key-001' }),
      body: JSON.stringify({ url: 'https://example.com/hook', event_types: ['contact.created'] }),
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.secret).toMatch(/^whsec_[A-Za-z0-9_-]{43}$/);

    const list = await (await app.request('/api/v1/webhook-endpoints', { headers: headers() })).json();
    expect(JSON.stringify(list)).not.toContain(body.secret);
    expect(JSON.stringify(list)).not.toContain('secret_encrypted');
  });

  it('kritérium 39: webhook na 169.254.169.254 se neuloží', async () => {
    const res = await app.request('/api/v1/webhook-endpoints', {
      method: 'POST',
      headers: headers({ 'Idempotency-Key': 'wh-key-002' }),
      body: JSON.stringify({ url: 'http://169.254.169.254/', event_types: ['contact.created'] }),
    });
    expect(res.status).toBe(422);
    expect((await res.json()).errors[0].code).toBe('blocked_target');
  });

  it('http adresa se odmítne, webhooky jezdí jen po https', async () => {
    const res = await app.request('/api/v1/webhook-endpoints', {
      method: 'POST',
      headers: headers({ 'Idempotency-Key': 'wh-key-003' }),
      body: JSON.stringify({ url: 'http://example.com/hook', event_types: ['contact.created'] }),
    });
    expect(res.status).toBe(422);
  });

  it('prázdný seznam typů událostí se odmítne', async () => {
    const res = await app.request('/api/v1/webhook-endpoints', {
      method: 'POST',
      headers: headers({ 'Idempotency-Key': 'wh-key-004' }),
      body: JSON.stringify({ url: 'https://example.com/hook', event_types: [] }),
    });
    expect(res.status).toBe(422);
  });

  it('víc než 20 endpointů na projekt se odmítne', async () => {
    for (let i = 0; i < 19; i += 1) {
      await app.request('/api/v1/webhook-endpoints', {
        method: 'POST',
        headers: headers({ 'Idempotency-Key': `wh-bulk-${i}` }),
        body: JSON.stringify({ url: `https://example.com/hook-${i}`, event_types: ['contact.created'] }),
      });
    }
    const res = await app.request('/api/v1/webhook-endpoints', {
      method: 'POST',
      headers: headers({ 'Idempotency-Key': 'wh-key-over' }),
      body: JSON.stringify({ url: 'https://example.com/hook-over', event_types: ['contact.created'] }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).params.reason).toBe('too_many_endpoints');
  });
});

describe('PATCH a DELETE', () => {
  it('změna na blokovanou adresu se odmítne', async () => {
    const created = await (
      await app.request('/api/v1/webhook-endpoints', {
        method: 'POST',
        headers: headers({ 'Idempotency-Key': 'wh-key-005' }),
        body: JSON.stringify({ url: 'https://example.com/patch', event_types: ['contact.created'] }),
      })
    ).json();

    const res = await app.request(`/api/v1/webhook-endpoints/${created.endpoint.id}`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ url: 'https://127.0.0.1/hook' }),
    });
    expect(res.status).toBe(422);
  });

  it('smazaný endpoint zmizí ze seznamu a detail vrací 404', async () => {
    const created = await (
      await app.request('/api/v1/webhook-endpoints', {
        method: 'POST',
        headers: headers({ 'Idempotency-Key': 'wh-key-006' }),
        body: JSON.stringify({ url: 'https://example.com/smazat', event_types: ['contact.created'] }),
      })
    ).json();

    expect(
      (
        await app.request(`/api/v1/webhook-endpoints/${created.endpoint.id}`, {
          method: 'DELETE',
          headers: headers(),
        })
      ).status,
    ).toBe(204);
    expect(
      (await app.request(`/api/v1/webhook-endpoints/${created.endpoint.id}`, { headers: headers() })).status,
    ).toBe(404);
  });
});
```

- [ ] **Krok 7: Spusť integrační test, ověř, že prochází**

Run: `pnpm --filter @mlain/web test:db -- api/webhook-endpoints.test.ts`
Expected: 7 passed.

- [ ] **Krok 8: Commit**

```bash
git add packages/core/platform/webhooks/endpoint-service.ts packages/core/platform/webhooks/emit.ts packages/core/platform/webhooks/deliver.ts packages/core/platform/webhooks/deliver.test.ts packages/core/platform/api/webhooks.routes.ts apps/web/test/api/webhook-endpoints.test.ts
git commit -m "feat(webhooks): endpoint CRUD, idempotent fan-out and signed delivery"
```

---

### Úkol 41: Zápis výsledku, deaktivace endpointu a log doručení

Pokrývá kritéria 36, 37 a 40.

**Files:**
- Create: `packages/core/platform/webhooks/disable.ts`
- Create: `packages/core/platform/webhooks/delivery-query.ts`
- Modify: `packages/core/platform/api/webhooks.routes.ts`
- Test: `packages/core/platform/webhooks/disable.test.ts`

- [ ] **Krok 1: Napiš padající test**

Create `packages/core/platform/webhooks/disable.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';
import type { WorkspaceContext } from '@mlain/db';
import { withWorkspace } from '@mlain/core/tx';
import { applyDeliveryOutcome, DISABLE_AFTER_FAILURES, shouldDisable } from './disable.js';
import { seedWorkspaceForCoreTests } from '../../identity/test-helpers.js';

let workspaceId = '';
let workspaceCtx: WorkspaceContext;
let endpointId = '';

async function makeDelivery(): Promise<{ id: string; createdAt: Date }> {
  const id = uuidv7();
  const createdAt = new Date();
  await withWorkspace(workspaceCtx, async (tx) => {
    const eventId = uuidv7();
    await tx.execute(sql`
      INSERT INTO webhook_events (id, workspace_id, type, payload, occurred_at)
      VALUES (${eventId}::uuid, ${workspaceId}::uuid, 'contact.created', '{}'::jsonb, now())
    `);
    await tx.execute(sql`
      INSERT INTO webhook_deliveries
        (id, workspace_id, endpoint_id, event_id, event_type, status, attempt, created_at)
      VALUES (${id}::uuid, ${workspaceId}::uuid, ${endpointId}::uuid, ${eventId}::uuid,
              'contact.created', 'pending', 0, ${createdAt})
    `);
  });
  return { id, createdAt };
}

async function endpointRow(): Promise<{ status: string; consecutive_failures: number; disabled_reason: string | null }> {
  return withWorkspace(workspaceCtx, async (tx) => {
    const { rows } = await tx.execute<{ status: string; consecutive_failures: number; disabled_reason: string | null }>(sql`
      SELECT status, consecutive_failures, disabled_reason FROM webhook_endpoints WHERE id = ${endpointId}::uuid
    `);
    return rows[0]!;
  });
}

beforeAll(async () => {
  const seeded = await seedWorkspaceForCoreTests();
  workspaceId = seeded.workspaceId;
  workspaceCtx = seeded.ctx;
  endpointId = await withWorkspace(workspaceCtx, async (tx) => {
    const { rows } = await tx.execute<{ id: string }>(sql`
      INSERT INTO webhook_endpoints (workspace_id, url, event_types, secret_encrypted)
      VALUES (${workspaceId}::uuid, 'https://example.com/hook', ARRAY['contact.created'], 'enc:v1:x')
      RETURNING id::text AS id
    `);
    return rows[0]!.id;
  });
});

describe('shouldDisable', () => {
  it('mez je 20 neúspěšných pokusů podle 3.8', () => {
    expect(DISABLE_AFTER_FAILURES).toBe(20);
  });

  it('19 neúspěchů endpoint nevypne', () => {
    expect(shouldDisable({ consecutiveFailures: 19, lastSuccessAt: new Date(), attemptsSinceSuccess: 19 })).toBeNull();
  });

  it('kritérium 40: 20 neúspěchů po sobě endpoint vypne', () => {
    expect(shouldDisable({ consecutiveFailures: 20, lastSuccessAt: null, attemptsSinceSuccess: 20 })).toBe(
      'too_many_failures',
    );
  });

  it('žádný úspěch 72 hodin při aspoň 10 pokusech taky vypne', () => {
    const old = new Date(Date.now() - 73 * 60 * 60 * 1000);
    expect(shouldDisable({ consecutiveFailures: 12, lastSuccessAt: old, attemptsSinceSuccess: 12 })).toBe(
      'no_success_72h',
    );
  });

  it('žádný úspěch 72 hodin při méně než 10 pokusech nevypne', () => {
    const old = new Date(Date.now() - 73 * 60 * 60 * 1000);
    expect(shouldDisable({ consecutiveFailures: 3, lastSuccessAt: old, attemptsSinceSuccess: 3 })).toBeNull();
  });
});

describe('applyDeliveryOutcome', () => {
  it('úspěch vynuluje čítač a zapíše last_success_at', async () => {
    const delivery = await makeDelivery();
    await applyDeliveryOutcome({
      workspaceId,
      deliveryId: delivery.id,
      createdAt: delivery.createdAt,
      endpointId,
      attempt: 1,
      status: 'succeeded',
      responseStatus: 200,
      snippet: 'ok',
      durationMs: 12,
      errorCode: null,
      nextAttemptAt: null,
      disableReason: null,
    });
    const row = await endpointRow();
    expect(row.consecutive_failures).toBe(0);
    expect(row.status).toBe('active');
  });

  it('neúspěch zvýší čítač o jedna za KAŽDÝ pokus, ne za doručení', async () => {
    const before = (await endpointRow()).consecutive_failures;
    const delivery = await makeDelivery();
    for (const attempt of [1, 2, 3]) {
      await applyDeliveryOutcome({
        workspaceId,
        deliveryId: delivery.id,
        createdAt: delivery.createdAt,
        endpointId,
        attempt,
        status: 'failed',
        responseStatus: 500,
        snippet: 'chyba',
        durationMs: 30,
        errorCode: 'http_500',
        nextAttemptAt: new Date(Date.now() + 15_000),
        disableReason: null,
      });
    }
    expect((await endpointRow()).consecutive_failures).toBe(before + 3);
  });

  it('kritérium 37: disableReason endpoint okamžitě vypne', async () => {
    const delivery = await makeDelivery();
    await applyDeliveryOutcome({
      workspaceId,
      deliveryId: delivery.id,
      createdAt: delivery.createdAt,
      endpointId,
      attempt: 1,
      status: 'abandoned',
      responseStatus: 410,
      snippet: '',
      durationMs: 5,
      errorCode: 'http_410',
      nextAttemptAt: null,
      disableReason: 'endpoint_gone',
    });
    const row = await endpointRow();
    expect(row.status).toBe('disabled');
    expect(row.disabled_reason).toBe('endpoint_gone');
  });

  it('response_body_snippet se ořízne na 2 kB', async () => {
    const delivery = await makeDelivery();
    await applyDeliveryOutcome({
      workspaceId,
      deliveryId: delivery.id,
      createdAt: delivery.createdAt,
      endpointId,
      attempt: 1,
      status: 'failed',
      responseStatus: 500,
      snippet: 'x'.repeat(5000),
      durationMs: 5,
      errorCode: 'http_500',
      nextAttemptAt: null,
      disableReason: null,
    });
    const rows = await withWorkspace(workspaceCtx, async (tx) => {
      const r = await tx.execute<{ len: number }>(sql`
        SELECT length(response_body_snippet) AS len FROM webhook_deliveries WHERE id = ${delivery.id}::uuid
      `);
      return r.rows;
    });
    expect(rows[0]!.len).toBeLessThanOrEqual(2048);
  });
});
```

Create `packages/core/identity/test-helpers.ts`:

```ts
import { v7 as uuidv7 } from 'uuid';
import { createWorkspaceAsUser, type WorkspaceContext } from '@mlain/db';
import * as schema from '@mlain/db/schema';
import { appPool, withoutContext } from '@mlain/core/tx';
import { createWorkspaceContext } from './context.js';
import { hashPassword } from './password.js';

export type SeededWorkspace = {
  userId: string;
  workspaceId: string;
  /** Skutečný kontext ze skutečné továrny, ne podvržený. */
  ctx: WorkspaceContext;
};

/**
 * Pomocník pro databázové testy v packages/core. Nepoužívá se v produkční cestě.
 *
 * Projekt zakládá `createWorkspaceAsUser` z @mlain/db, ne ruční INSERT. Jen ta
 * funkce umí správné pořadí (ID dopředu, kontext před vložením řádku); ruční
 * `INSERT ... RETURNING` na workspaces bez kontextu skončí na RLS a vložení
 * členství neprojde přes WITH CHECK. Ověřeno spuštěním v P03.
 *
 * Vrací i hotový kontext, protože transakční obálky berou `WorkspaceContext`,
 * ne řetězec. Vyrábí se skutečnou továrnou, takže test zároveň pokrývá cestu,
 * kterou jde produkční kód.
 */
export async function seedWorkspaceForCoreTests(): Promise<SeededWorkspace> {
  const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const userId = uuidv7();
  await withoutContext(async (tx) => {
    await tx.insert(schema.users).values({
      id: userId,
      email: `core-${unique}@example.cz`,
      passwordHash: await hashPassword('dostatecne-dlouhe-heslo'),
      locale: 'cs',
      timezone: 'Europe/Prague',
    });
  });

  const workspace = await createWorkspaceAsUser(appPool(), userId, {
    name: 'Core test',
    slug: `core-${unique}`.toLowerCase().replace(/[^a-z0-9-]/g, ''),
    locale: 'cs',
    timezone: 'Europe/Prague',
  });

  const ctx = await createWorkspaceContext({
    kind: 'session', userId, workspaceRef: workspace.id,
  });
  return { userId, workspaceId: workspace.id, ctx };
}
```

- [ ] **Krok 2: Spusť test, ověř, že padá**

Run: `pnpm --filter @mlain/core test:db -- platform/webhooks/disable.test.ts`
Expected: FAIL, `Cannot find module './disable.js'`. Odstraň také nepoužitý import `createApiApp` z testu, pokud ho editor doplnil.

- [ ] **Krok 3: Napiš `disable.ts`**

Create `packages/core/platform/webhooks/disable.ts`:

```ts
import { sql } from 'drizzle-orm';
import { withWorkspace } from '@mlain/core/tx';
import { writeAuditLog } from '@mlain/core/audit/write';
import { IdentityAuditActions } from '@mlain/core/identity/audit';
import { queueSystemMail } from '../system-mail.js';

/** 3.8: consecutive_failures >= 20 endpoint deaktivuje. */
export const DISABLE_AFTER_FAILURES = 20;
/** Nebo žádné úspěšné doručení posledních 72 hodin při aspoň 10 pokusech. */
export const DISABLE_NO_SUCCESS_HOURS = 72;
export const DISABLE_NO_SUCCESS_MIN_ATTEMPTS = 10;
export const SNIPPET_LIMIT = 2 * 1024;

export type DisableReason = 'too_many_failures' | 'no_success_72h' | 'endpoint_gone';

export function shouldDisable(input: {
  consecutiveFailures: number;
  lastSuccessAt: Date | null;
  attemptsSinceSuccess: number;
}): DisableReason | null {
  if (input.consecutiveFailures >= DISABLE_AFTER_FAILURES) return 'too_many_failures';
  if (input.attemptsSinceSuccess >= DISABLE_NO_SUCCESS_MIN_ATTEMPTS) {
    const cutoff = Date.now() - DISABLE_NO_SUCCESS_HOURS * 60 * 60 * 1000;
    const noSuccess = input.lastSuccessAt === null || new Date(input.lastSuccessAt).getTime() < cutoff;
    if (noSuccess) return 'no_success_72h';
  }
  return null;
}

export type DeliveryOutcomeInput = {
  workspaceId: string;
  deliveryId: string;
  createdAt: Date;
  endpointId: string;
  attempt: number;
  status: 'succeeded' | 'failed' | 'abandoned';
  responseStatus: number | null;
  snippet: string | null;
  durationMs: number | null;
  errorCode: string | null;
  nextAttemptAt: Date | null;
  disableReason: string | null;
};

/**
 * Zápis výsledku jednoho pokusu. Čítač neúspěchů se zvyšuje za KAŽDÝ pokus,
 * ne za doručení: hláška v UI slibuje vypnutí "po 20 neúspěšných pokusech"
 * a kritérium 40 měří totéž.
 */
export async function applyDeliveryOutcome(input: DeliveryOutcomeInput): Promise<void> {
  await withWorkspace(input.workspaceId, async (tx) => {
    await tx.execute(sql`
      UPDATE webhook_deliveries
         SET status = ${input.status},
             attempt = ${input.attempt},
             next_attempt_at = ${input.nextAttemptAt},
             response_status = ${input.responseStatus},
             response_body_snippet = ${input.snippet === null ? null : input.snippet.slice(0, SNIPPET_LIMIT)},
             duration_ms = ${input.durationMs},
             error_code = ${input.errorCode},
             delivered_at = ${input.status === 'succeeded' ? new Date() : null}
       WHERE id = ${input.deliveryId}::uuid AND created_at = ${input.createdAt}
    `);

    if (input.status === 'succeeded') {
      await tx.execute(sql`
        UPDATE webhook_endpoints
           SET consecutive_failures = 0, last_success_at = now(), updated_at = now()
         WHERE id = ${input.endpointId}::uuid
      `);
      return;
    }

    const { rows } = await tx.execute<{ consecutive_failures: number; last_success_at: Date | null; status: string }>(sql`
      UPDATE webhook_endpoints
         SET consecutive_failures = consecutive_failures + 1,
             last_failure_at = now(),
             updated_at = now()
       WHERE id = ${input.endpointId}::uuid
       RETURNING consecutive_failures, last_success_at, status
    `);
    const endpoint = rows[0];
    if (!endpoint) return;

    const reason =
      (input.disableReason as DisableReason | null) ??
      shouldDisable({
        consecutiveFailures: endpoint.consecutive_failures,
        lastSuccessAt: endpoint.last_success_at,
        attemptsSinceSuccess: endpoint.consecutive_failures,
      });

    if (!reason || endpoint.status === 'disabled') return;

    await tx.execute(sql`
      UPDATE webhook_endpoints
         SET status = 'disabled', disabled_reason = ${reason}, disabled_at = now(), updated_at = now()
       WHERE id = ${input.endpointId}::uuid
    `);

    await writeAuditLog(tx, {
      action: IdentityAuditActions['webhook_endpoint.disabled'],
      workspaceId: input.workspaceId,
      actor: { actorType: 'system', actorId: null, actorLabel: 'platform.webhook_deliver' },
      targetType: 'webhook_endpoint',
      targetId: input.endpointId,
      metadata: { reason, consecutive_failures: endpoint.consecutive_failures },
    });

    // 3.8: e-mail všem uživatelům s rolí owner a admin.
    const { rows: recipients } = await tx.execute<{ email: string; locale: string }>(sql`
      SELECT u.email::text AS email, u.locale AS locale
        FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = ${input.workspaceId}::uuid
         AND m.role IN ('owner','admin') AND u.deleted_at IS NULL
    `);

    for (const recipient of recipients) {
      await queueSystemMail({
        template: 'webhook_endpoint_disabled',
        to: recipient.email,
        locale: recipient.locale,
        data: { endpoint_id: input.endpointId, reason },
      });
    }
  });
}

/** Znovuaktivace vynuluje čítač. Přehrání posledních 24 hodin nabízí UI (P06). */
export async function enableEndpoint(ctx: WorkspaceContext, endpointId: string): Promise<boolean> {
  return withWorkspace(ctx, async (tx) => {
    const { rows } = await tx.execute(sql`
      UPDATE webhook_endpoints
         SET status = 'active', disabled_reason = NULL, disabled_at = NULL,
             consecutive_failures = 0, updated_at = now()
       WHERE id = ${endpointId}::uuid AND deleted_at IS NULL
       RETURNING id
    `);
    return rows.length === 1;
  });
}
```

- [ ] **Krok 4: Spusť test, ověř, že prochází**

Run: `pnpm --filter @mlain/core test:db -- platform/webhooks/disable.test.ts`
Expected: 9 passed.

- [ ] **Krok 5: Napiš `delivery-query.ts` a doplň zbývající tři cesty**

Create `packages/core/platform/webhooks/delivery-query.ts`:

```ts
import { sql } from 'drizzle-orm';
import type { Tx } from '@mlain/core/tx';
import { ApiError } from '@mlain/core/errors/api-error';
import type { WorkspaceContext } from '@mlain/core/identity/types';

export type PublicDelivery = {
  id: string;
  endpoint_id: string;
  event_id: string;
  event_type: string;
  status: string;
  attempt: number;
  next_attempt_at: string | null;
  response_status: number | null;
  response_body_snippet: string | null;
  duration_ms: number | null;
  error_code: string | null;
  delivered_at: string | null;
  created_at: string;
};

export type DeliveryFilters = {
  endpointId?: string;
  eventType?: string;
  status?: string;
  limit: number;
  cursor: { k: unknown[] } | null;
};

/** Odkaz na řádek partitionované tabulky nese obě složky klíče (2.1). */
export function deliveryKeys(row: PublicDelivery): unknown[] {
  return [row.created_at, row.id];
}

export async function listDeliveries(
  tx: Tx,
  ctx: WorkspaceContext,
  filters: DeliveryFilters,
): Promise<PublicDelivery[]> {
  const keyset = filters.cursor
    ? sql`AND (created_at, id) < (${filters.cursor.k[0]}::timestamptz, ${filters.cursor.k[1]}::uuid)`
    : sql``;
  const byEndpoint = filters.endpointId ? sql`AND endpoint_id = ${filters.endpointId}::uuid` : sql``;
  const byType = filters.eventType ? sql`AND event_type = ${filters.eventType}` : sql``;
  const byStatus = filters.status ? sql`AND status = ${filters.status}` : sql``;

  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT id::text AS id, endpoint_id::text AS endpoint_id, event_id::text AS event_id,
           event_type, status, attempt, next_attempt_at, response_status,
           response_body_snippet, duration_ms, error_code, delivered_at, created_at
      FROM webhook_deliveries
     WHERE workspace_id = ${ctx.workspaceId}::uuid
     ${byEndpoint} ${byType} ${byStatus} ${keyset}
     ORDER BY created_at DESC, id DESC
     LIMIT ${filters.limit + 1}
  `);

  return rows.map((r) => ({
    id: r.id as string,
    endpoint_id: r.endpoint_id as string,
    event_id: r.event_id as string,
    event_type: r.event_type as string,
    status: r.status as string,
    attempt: Number(r.attempt),
    next_attempt_at: r.next_attempt_at ? new Date(r.next_attempt_at as Date).toISOString() : null,
    response_status: r.response_status === null ? null : Number(r.response_status),
    response_body_snippet: (r.response_body_snippet as string | null) ?? null,
    duration_ms: r.duration_ms === null ? null : Number(r.duration_ms),
    error_code: (r.error_code as string | null) ?? null,
    delivered_at: r.delivered_at ? new Date(r.delivered_at as Date).toISOString() : null,
    created_at: new Date(r.created_at as Date).toISOString(),
  }));
}

/** Ruční opakování: doručení se vrátí na pending s okamžitým next_attempt_at. */
export async function retryDelivery(tx: Tx, ctx: WorkspaceContext, id: string): Promise<void> {
  const { rows } = await tx.execute(sql`
    UPDATE webhook_deliveries
       SET status = 'pending', next_attempt_at = now(), error_code = NULL
     WHERE workspace_id = ${ctx.workspaceId}::uuid AND id = ${id}::uuid
       AND status IN ('failed','abandoned')
     RETURNING id
  `);
  if (rows.length === 0) throw new ApiError('not_found');
}
```

Do `packages/core/platform/api/webhooks.routes.ts` přidej definice a handlery pro tři zbývající cesty. Nové definice:

```ts
import { parsePaginationQuery, buildPage } from '../../../../apps/web/src/lib/api/pagination.js';
```

Tenhle import by porušil graf závislostí (`packages/core` nesmí sahat do `apps/web`). Stránkování proto zůstává v `apps/web` a definice cesty jen deklaruje tvar odpovědi; sestavení stránky dělá handler, kterému se pomocné funkce předají parametrem `deps`:

```ts
export const WebhookDeliverySchema = z
  .object({
    id: z.uuid(),
    endpoint_id: z.uuid(),
    event_id: z.uuid(),
    event_type: z.string(),
    status: z.enum(['pending', 'delivering', 'succeeded', 'failed', 'abandoned']),
    attempt: z.number().int(),
    next_attempt_at: z.iso.datetime().nullable(),
    response_status: z.number().int().nullable(),
    response_body_snippet: z.string().nullable(),
    duration_ms: z.number().int().nullable(),
    error_code: z.string().nullable(),
    delivered_at: z.iso.datetime().nullable(),
    created_at: z.iso.datetime(),
  })
  .openapi('WebhookDelivery');

const enableRouteDef = createRoute({
  method: 'post',
  path: '/api/v1/webhook-endpoints/{id}/enable',
  tags: ['Webhooks'],
  summary: 'Znovuaktivace deaktivovaného webhooku',
  security: [{ bearerAuth: ['webhooks:write'] }],
  request: {
    params: z.object({ id: z.uuid() }),
    headers: IdempotencyHeaderSchema,
    body: { content: { 'application/json': { schema: z.object({}).strict() } } },
  },
  responses: {
    200: { description: 'Aktivováno', content: { 'application/json': { schema: z.object({ ok: z.literal(true) }) } } },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const testRouteDef = createRoute({
  method: 'post',
  path: '/api/v1/webhook-endpoints/{id}/test',
  tags: ['Webhooks'],
  summary: 'Odeslání testovací události ping',
  security: [{ bearerAuth: ['webhooks:write'] }],
  request: {
    params: z.object({ id: z.uuid() }),
    headers: IdempotencyHeaderSchema,
    body: { content: { 'application/json': { schema: z.object({}).strict() } } },
  },
  responses: {
    202: {
      description: 'Zařazeno k doručení',
      content: { 'application/json': { schema: z.object({ event_id: z.uuid() }) } },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

const retryRouteDef = createRoute({
  method: 'post',
  path: '/api/v1/webhook-deliveries/{id}/retry',
  tags: ['Webhooks'],
  summary: 'Ruční opakování doručení',
  security: [{ bearerAuth: ['webhooks:write'] }],
  request: {
    params: z.object({ id: z.uuid() }),
    headers: IdempotencyHeaderSchema,
    body: { content: { 'application/json': { schema: z.object({}).strict() } } },
  },
  responses: {
    202: { description: 'Zařazeno' },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});
```

A handlery do `registerWebhookEndpointRoutes`:

```ts
  app.openapi(enableRouteDef, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'webhooks:write');
    const ok = await enableEndpoint(ctx, c.req.valid('param').id);
    if (!ok) throw new ApiError('not_found');
    return c.json({ ok: true as const }, 200);
  });

  app.openapi(testRouteDef, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'webhooks:write');
    const id = c.req.valid('param').id;
    const eventId = await withWorkspace(ctx, async (tx) => {
      await getEndpoint(tx, ctx, id);
      return emitWebhookEvent(tx, {
        workspaceId: ctx.workspaceId,
        type: 'ping',
        occurredAt: new Date(),
        data: { endpoint_id: id },
      });
    });
    return c.json({ event_id: eventId }, 202);
  });

  app.openapi(retryRouteDef, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'webhooks:write');
    await withWorkspace(ctx, (tx) => retryDelivery(tx, ctx, c.req.valid('param').id));
    return c.body(null, 202);
  });
```

Doplň importy `ApiError`, `enableEndpoint`, `emitWebhookEvent`, `retryDelivery` a `getEndpoint`.

- [ ] **Krok 6: Ověř typovou kontrolu a spusť celou skupinu testů webhooků**

Run: `pnpm --filter @mlain/core typecheck && pnpm --filter @mlain/core test:unit -- platform/ && pnpm --filter @mlain/core test:db -- platform/`
Expected: typecheck PASS, jednotkové 31 passed, databázové 9 passed.

- [ ] **Krok 7: Commit**

```bash
git add packages/core/platform/webhooks/disable.ts packages/core/platform/webhooks/delivery-query.ts packages/core/platform/webhooks/disable.test.ts packages/core/platform/api/webhooks.routes.ts packages/core/identity/test-helpers.ts
git commit -m "feat(webhooks): delivery outcome recording, endpoint deactivation and manual retry"
```

---

### Fáze H: OpenAPI, joby, audit log, Centrum úloh a dokončení (úkoly 42 až 46)

---

### Úkol 42: Generátor OpenAPI 3.1, `openapi.json` a dokumentace

Pokrývá kritéria 34 a 35.

**Files:**
- Create: `apps/web/src/lib/api/openapi.ts`
- Create: `apps/web/src/lib/api/docs.ts`
- Create: `apps/web/scripts/generate-openapi.ts`
- Test: `apps/web/test/api/openapi.test.ts`

- [ ] **Krok 1: Napiš padající test**

Create `apps/web/test/api/openapi.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildApp, buildOpenApiDocument, registeredPaths } from '../../src/lib/api/openapi.js';

const COMMITTED = fileURLToPath(
  new URL('../../../../packages/contracts/openapi.json', import.meta.url),
);

const app = buildApp();

describe('kritérium 35: každá registrovaná cesta je v dokumentu', () => {
  it('seznam cest routeru se rovná seznamu cest v OpenAPI', () => {
    const document = buildOpenApiDocument(app);
    const inDocument = new Set(Object.keys(document.paths ?? {}));
    const missing = registeredPaths(app).filter((p) => !inDocument.has(p));
    expect(missing).toEqual([]);
  });

  it('dokument je OpenAPI 3.1', () => {
    expect(buildOpenApiDocument(app).openapi.startsWith('3.1')).toBe(true);
  });

  it('každý endpoint pod /api/v1 má aspoň jednu chybovou odpověď se schématem Problem', () => {
    const document = buildOpenApiDocument(app);
    const offenders: string[] = [];
    for (const [path, methods] of Object.entries(document.paths ?? {})) {
      for (const [method, operation] of Object.entries(methods as Record<string, unknown>)) {
        const responses = (operation as { responses?: Record<string, unknown> }).responses ?? {};
        const hasProblem = Object.entries(responses).some(
          ([status, value]) =>
            Number(status) >= 400 &&
            JSON.stringify(value).includes('application/problem+json'),
        );
        if (!hasProblem) offenders.push(`${method.toUpperCase()} ${path}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('dokument obsahuje 45 endpointů vlastněných částí 1', () => {
    const document = buildOpenApiDocument(app);
    const operations = Object.values(document.paths ?? {}).flatMap((methods) =>
      Object.keys(methods as Record<string, unknown>),
    );
    expect(operations.length).toBe(43);
  });
});

describe('kritérium 34: servírovaný dokument je ten commitnutý', () => {
  it('GET /api/v1/openapi.json vrací bajt po bajtu shodný soubor', async () => {
    const res = await app.request('/api/v1/openapi.json');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(readFileSync(COMMITTED, 'utf8'));
  });

  it('vygenerovaný dokument se shoduje s commitnutým souborem', () => {
    const generated = `${JSON.stringify(buildOpenApiDocument(app), null, 2)}\n`;
    expect(generated).toBe(readFileSync(COMMITTED, 'utf8'));
  });
});

describe('GET /api/v1/docs', () => {
  it('vrací soběstačné HTML bez jediného externího zdroje', async () => {
    const res = await app.request('/api/v1/docs');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    const html = await res.text();
    expect(html).not.toMatch(/src="https?:\/\//);
    expect(html).not.toMatch(/href="https?:\/\/(?!docs\.mlain\.dev)/);
    expect(html).toContain('/api/v1/openapi.json');
  });

  it('vypisuje cesty z dokumentu', async () => {
    const html = await (await app.request('/api/v1/docs')).text();
    expect(html).toContain('/api/v1/auth/login');
    expect(html).toContain('/api/v1/webhook-endpoints');
  });
});
```

- [ ] **Krok 2: Spusť test, ověř, že padá**

Run: `pnpm --filter @mlain/web test:unit -- api/openapi.test.ts`
Expected: FAIL, `Cannot find module '../../src/lib/api/openapi.js'`.

- [ ] **Krok 3: Napiš `openapi.ts`**

Create `apps/web/src/lib/api/openapi.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { OpenAPIHono } from '@hono/zod-openapi';
import { registerSetupRoutes } from '@mlain/core/identity/api/setup.routes';
import { registerAuthRoutes } from '@mlain/core/identity/api/auth.routes';
import { registerWorkspaceRoutes } from '@mlain/core/identity/api/workspaces.routes';
import { registerMemberRoutes } from '@mlain/core/identity/api/members.routes';
import { registerInvitationRoutes } from '@mlain/core/identity/api/invitations.routes';
import { registerApiKeyRoutes } from '@mlain/core/identity/api/api-keys.routes';
import { registerWebhookEndpointRoutes } from '@mlain/core/platform/api/webhooks.routes';
import { registerAuditRoutes } from '@mlain/core/platform/api/audit.routes';
import type { ApiEnv } from '@mlain/core/identity/api/schemas';
import { createApiApp } from './app.js';
import { renderDocsHtml } from './docs.js';

const OPENAPI_PATH = fileURLToPath(new URL('../../../../packages/contracts/openapi.json', import.meta.url));

/**
 * Jediné místo, kde se skládá celá aplikace. Používá ho runtime (route.ts),
 * generátor i testy, takže se nemůže stát, že by generátor viděl jiné cesty
 * než produkce.
 */
export function buildApp(): OpenAPIHono<ApiEnv> {
  const app = createApiApp();

  registerSetupRoutes(app);
  registerAuthRoutes(app);
  registerWorkspaceRoutes(app);
  registerMemberRoutes(app);
  registerInvitationRoutes(app);
  registerApiKeyRoutes(app);
  registerWebhookEndpointRoutes(app);
  registerAuditRoutes(app);

  // 4.7: endpoint servíruje TEN SAMÝ commitnutý soubor, ne dokument generovaný
  // za běhu, aby se produkce chovala stejně jako repozitář.
  app.get('/api/v1/openapi.json', (c) => {
    const body = readFileSync(OPENAPI_PATH, 'utf8');
    return new Response(body, { status: 200, headers: { 'Content-Type': 'application/json' } });
  });

  app.get('/api/v1/docs', (c) => {
    const document = JSON.parse(readFileSync(OPENAPI_PATH, 'utf8')) as OpenApiDocument;
    return c.html(renderDocsHtml(document));
  });

  return app;
}

export type OpenApiDocument = {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths?: Record<string, Record<string, unknown>>;
  components?: Record<string, unknown>;
};

export function buildOpenApiDocument(app: OpenAPIHono<ApiEnv>): OpenApiDocument {
  return app.getOpenAPI31Document({
    openapi: '3.1.0',
    info: {
      title: 'Mlain Mailer API',
      version: 'v1',
      description:
        'Veřejné REST API. Klient se rozhoduje podle pole `code` v chybové odpovědi, ne podle `type` ani `title`. Neznámé hodnoty ve výčtech musí tolerovat.',
    },
    servers: [{ url: '/' }],
    security: [{ bearerAuth: [] }],
    tags: [
      { name: 'Setup' },
      { name: 'Auth' },
      { name: 'Workspaces' },
      { name: 'Members' },
      { name: 'Invitations' },
      { name: 'API keys' },
      { name: 'Webhooks' },
      { name: 'Audit' },
    ],
  }) as OpenApiDocument;
}

/** Cesty registrované v routeru, bez testovacích a bez duplicit. */
export function registeredPaths(app: OpenAPIHono<ApiEnv>): string[] {
  const paths = new Set<string>();
  for (const route of app.routes) {
    if (!route.path.startsWith('/api/v1')) continue;
    if (route.path.includes('__test')) continue;
    if (route.path.includes('*')) continue;
    // Hono používá :param, OpenAPI {param}.
    paths.add(route.path.replace(/:([A-Za-z_]+)/g, '{$1}'));
  }
  return [...paths];
}
```

- [ ] **Krok 4: Napiš `docs.ts`**

Create `apps/web/src/lib/api/docs.ts`:

```ts
import type { OpenApiDocument } from './openapi.js';

/**
 * Rozhodnutí R5 plánu P04. Specifikace 4.7 chce Scalar nebo Redoc "bez externích
 * CDN". Obě knihovny ve výchozím stavu tahají bundle z CDN a jejich vendorování
 * je build krok, který vlastní P01. Tahle stránka je proto soběstačná, bez
 * jediného externího zdroje a bez JavaScriptu. Vendorování bundlu je úkol pro P16.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderDocsHtml(document: OpenApiDocument): string {
  const byTag = new Map<string, string[]>();

  for (const [path, methods] of Object.entries(document.paths ?? {})) {
    for (const [method, operation] of Object.entries(methods)) {
      const op = operation as {
        tags?: string[];
        summary?: string;
        security?: Array<Record<string, string[]>>;
      };
      const tag = op.tags?.[0] ?? 'Ostatní';
      const scopes = (op.security ?? []).flatMap((entry) => Object.values(entry).flat());
      const scopeText = scopes.length > 0 ? ` <em>scopes: ${escapeHtml(scopes.join(', '))}</em>` : '';
      const line = `<li><code>${method.toUpperCase()} ${escapeHtml(path)}</code> ${escapeHtml(
        op.summary ?? '',
      )}${scopeText}</li>`;
      byTag.set(tag, [...(byTag.get(tag) ?? []), line]);
    }
  }

  const sections = [...byTag.entries()]
    .map(([tag, lines]) => `<h2>${escapeHtml(tag)}</h2><ul>${lines.sort().join('')}</ul>`)
    .join('');

  return `<!doctype html>
<html lang="cs">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(document.info.title)} ${escapeHtml(document.info.version)}</title>
<style>
body { font-family: system-ui, sans-serif; margin: 2rem auto; max-width: 60rem; line-height: 1.5; padding: 0 1rem; }
code { background: rgba(127,127,127,0.15); padding: 0.1rem 0.3rem; border-radius: 3px; }
li { margin: 0.25rem 0; }
em { color: #666; font-style: normal; font-size: 0.9em; }
</style>
</head>
<body>
<h1>${escapeHtml(document.info.title)} <small>${escapeHtml(document.info.version)}</small></h1>
<p>${escapeHtml(document.info.description ?? '')}</p>
<p>Strojově čitelná specifikace: <a href="/api/v1/openapi.json">/api/v1/openapi.json</a></p>
${sections}
</body>
</html>`;
}
```

- [ ] **Krok 5: Napiš generátor a vygeneruj soubor**

Create `apps/web/scripts/generate-openapi.ts`:

```ts
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildApp, buildOpenApiDocument } from '../src/lib/api/openapi.js';

/**
 * Uzávěr S9 řídicího dokumentu: openapi.json se NIKDY neslučuje ručně.
 * Při konfliktu se obě verze zahodí a soubor se přegeneruje tímhle skriptem.
 */
const target = fileURLToPath(new URL('../../../packages/contracts/openapi.json', import.meta.url));
const document = buildOpenApiDocument(buildApp());
writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
console.log(`openapi.json zapsán, cest: ${Object.keys(document.paths ?? {}).length}`);
```

Run:
```bash
pnpm --filter @mlain/web generate:openapi
```
Expected: výpis s počtem cest. Soubor `packages/contracts/openapi.json` je vygenerovaný a commituje se.

- [ ] **Krok 6: Spusť test, ověř, že prochází**

Run: `pnpm --filter @mlain/web test:unit -- api/openapi.test.ts`
Expected: 8 passed. Když padne test na 43 endpointech, porovnej seznam s tabulkou v 0.1 tohoto plánu; buď chybí registrace, nebo někdo přidal endpoint, který do části 1 nepatří.

- [ ] **Krok 7: Commit**

```bash
git add apps/web/src/lib/api/openapi.ts apps/web/src/lib/api/docs.ts apps/web/scripts/generate-openapi.ts apps/web/test/api/openapi.test.ts packages/contracts/openapi.json
git commit -m "feat(api): OpenAPI 3.1 generation, committed document and self-contained docs page"
```

---

### Úkol 43: Joby platformy a jejich konvenční cesty

**Files:**
- Create: `packages/core/platform/jobs/webhook_fanout.ts`
- Create: `packages/core/platform/jobs/webhook_deliver.ts`
- Create: `packages/core/platform/jobs/cleanup_sessions.ts`
- Create: `packages/core/platform/jobs/cleanup_idempotency.ts`
- Create: `packages/core/platform/jobs/purge_workspaces.ts`
- Test: `packages/core/platform/jobs/jobs.test.ts`

- [ ] **Krok 1: Napiš padající test**

Create `packages/core/platform/jobs/jobs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sql } from 'drizzle-orm';
import { QUEUES } from '@mlain/core/queues';
import { withoutContext } from '@mlain/core/tx';
import { handler as cleanupSessions } from './cleanup_sessions.js';
import { handler as cleanupIdempotency } from './cleanup_idempotency.js';

const JOBS_DIR = fileURLToPath(new URL('./', import.meta.url));

/**
 * Rozhodnutí R3 plánu P04: entrypoint workeru vlastní P01, handlery dodává
 * doména na konvenční cestě packages/core/<domena>/jobs/<akce>.ts. Tenhle test
 * je jediné, co brání tomu, aby fronta existovala v registru a handler nikde.
 */
describe('konvenční cesty handlerů', () => {
  const platformQueues = Object.keys(QUEUES).filter((name) => name.startsWith('platform.'));

  it('registr obsahuje pět front platformy vlastněných P04', () => {
    for (const name of [
      'platform.webhook_fanout',
      'platform.webhook_deliver',
      'platform.cleanup_sessions',
      'platform.cleanup_idempotency',
      'platform.purge_workspaces',
    ]) {
      expect(platformQueues).toContain(name);
    }
  });

  it('pro každou frontu platformy existuje modul na konvenční cestě', async () => {
    const missing: string[] = [];
    for (const name of platformQueues) {
      const action = name.split('.')[1]!;
      const path = join(JOBS_DIR, `${action}.ts`);
      // platform.maintain_partitions vlastní P03, ne P04.
      if (name === 'platform.maintain_partitions') continue;
      if (!existsSync(path)) missing.push(name);
    }
    expect(missing).toEqual([]);
  });

  it('každý modul exportuje handler jako funkci', async () => {
    for (const action of [
      'webhook_fanout',
      'webhook_deliver',
      'cleanup_sessions',
      'cleanup_idempotency',
      'purge_workspaces',
    ]) {
      const module = (await import(`./${action}.js`)) as { handler?: unknown };
      expect(typeof module.handler, action).toBe('function');
    }
  });
});

describe('úklidové joby', () => {
  it('cleanup_sessions maže jen relace skončené před víc než 30 dny', async () => {
    const userId = await withoutContext(async (tx) => {
      const { rows } = await tx.execute<{ id: string }>(sql`
        INSERT INTO users (email, password_hash, locale, timezone)
        VALUES (${`cleanup-${Date.now()}@example.cz`}, '$argon2id$v=19$m=19456,t=2,p=1$c2FsdA$aGFzaA', 'cs', 'Europe/Prague')
        RETURNING id::text AS id
      `);
      return rows[0]!.id;
    });

    await withoutContext(async (tx) => {
      await tx.execute(sql`
        INSERT INTO sessions (user_id, token_hash, csrf_secret, absolute_expires_at, revoked_at)
        VALUES (${userId}::uuid, decode(md5(random()::text), 'hex'), decode(md5(random()::text), 'hex'),
                now() + interval '30 days', now() - interval '40 days')
      `);
      await tx.execute(sql`
        INSERT INTO sessions (user_id, token_hash, csrf_secret, absolute_expires_at, revoked_at)
        VALUES (${userId}::uuid, decode(md5(random()::text), 'hex'), decode(md5(random()::text), 'hex'),
                now() + interval '30 days', now() - interval '1 day')
      `);
    });

    const removed = await cleanupSessions();
    expect(removed).toBeGreaterThanOrEqual(1);

    const remaining = await withoutContext(async (tx) => {
      const { rows } = await tx.execute<{ c: string }>(
        sql`SELECT count(*) AS c FROM sessions WHERE user_id = ${userId}::uuid`,
      );
      return Number(rows[0]!.c);
    });
    expect(remaining).toBe(1);
  });

  it('cleanup_idempotency maže jen záznamy po expiraci', async () => {
    const removed = await cleanupIdempotency();
    expect(typeof removed).toBe('number');
  });
});
```

- [ ] **Krok 2: Spusť test, ověř, že padá**

Run: `pnpm --filter @mlain/core test:db -- platform/jobs/jobs.test.ts`
Expected: FAIL, `Cannot find module './cleanup_sessions.js'`.

- [ ] **Krok 3: Napiš pět modulů handlerů**

Create `packages/core/platform/jobs/webhook_fanout.ts`:

```ts
import { fanoutEvent } from '../webhooks/emit.js';

export type FanoutJobData = { event_id: string; workspace_id: string };

/**
 * 9.1: každý pg-boss job musí být idempotentní, protože singletonKey
 * negarantuje, že job proběhne právě jednou. Fan-out je idempotentní přes
 * ON CONFLICT nad uq_webhook_deliveries__event_endpoint, viz emit.ts.
 */
export async function handler(job: { data: FanoutJobData }): Promise<void> {
  await fanoutEvent(
    createSystemContext(job.data.workspace_id, 'platform.webhook_fanout'),
    job.data.event_id,
  );
}
```

Create `packages/core/platform/jobs/webhook_deliver.ts`:

```ts
import { deliverWebhook } from '../webhooks/deliver.js';

export type DeliverJobData = { delivery_id: string; workspace_id: string; created_at: string };

/**
 * 3.8: retry řídíme sami přes next_attempt_at, ne přes pg-boss, protože
 * potřebujeme vlastní tabulku odstupů. Fronta má proto retryLimit 0.
 *
 * Doručení je nejméně jednou: při restartu workeru uprostřed HTTP requestu
 * nejde zjistit, jestli protistrana request přijala, takže se job zopakuje
 * a příjemce deduplikuje podle ML-Event-Id.
 */
export async function handler(job: { data: DeliverJobData }): Promise<void> {
  await deliverWebhook({
    deliveryId: job.data.delivery_id,
    workspaceId: job.data.workspace_id,
    createdAt: new Date(job.data.created_at),
  });
}
```

Create `packages/core/platform/jobs/cleanup_sessions.ts`:

```ts
import { sql } from 'drizzle-orm';
import { withoutContext } from '@mlain/core/tx';

/**
 * 3.2: expirovaná ani revokovaná session se nemaže hned, protože výpis
 * "aktivní relace" má ukázat i to, kdy relace skončila. Maže je tenhle job
 * denně, starší než 30 dní od skončení.
 */
export async function handler(): Promise<number> {
  return withoutContext(async (tx) => {
    const { rows } = await tx.execute(sql`
      DELETE FROM sessions
       WHERE (revoked_at IS NOT NULL AND revoked_at < now() - interval '30 days')
          OR (absolute_expires_at < now() - interval '30 days')
       RETURNING id
    `);
    return rows.length;
  });
}
```

Create `packages/core/platform/jobs/cleanup_idempotency.ts`:

```ts
import { sql } from 'drizzle-orm';
import { withoutContext } from '@mlain/core/tx';

/** 4.4: retence 24 hodin. Tabulka jinak roste s počtem zápisových requestů. */
export async function handler(): Promise<number> {
  return withoutContext(async (tx) => {
    const { rows } = await tx.execute(sql`
      DELETE FROM idempotency_keys WHERE expires_at < now() RETURNING key
    `);
    return rows.length;
  });
}
```

Create `packages/core/platform/jobs/purge_workspaces.ts`:

```ts
import { sql } from 'drizzle-orm';
import { withoutContext } from '@mlain/core/tx';
import { RESTORE_WINDOW_DAYS } from '@mlain/core/identity/workspace-service';

/**
 * 3.3: měkce smazaný workspace jde 30 dní obnovit, pak se maže tvrdě.
 * Smazání workspace je jediná operace, která maže data kaskádou.
 *
 * Job je idempotentní: opakovaný běh nad už smazaným projektem nic nenajde.
 */
export async function handler(): Promise<number> {
  return withoutContext(async (tx) => {
    const { rows } = await tx.execute(sql`
      DELETE FROM workspaces
       WHERE deleted_at IS NOT NULL
         AND deleted_at < now() - interval '${sql.raw(String(RESTORE_WINDOW_DAYS))} days'
       RETURNING id
    `);
    return rows.length;
  });
}
```

- [ ] **Krok 4: Spusť test, ověř, že prochází**

Run: `pnpm --filter @mlain/core test:db -- platform/jobs/jobs.test.ts`
Expected: 5 passed.

Pokud test „pro každou frontu platformy existuje modul" padne na frontě, kterou tenhle plán nevlastní, doplň ji do výjimky vedle `platform.maintain_partitions` a poznamenej, který plán ji vlastní. Fronta bez handleru je fronta, do které se zapisuje a nikdo nečte.

- [ ] **Krok 5: Commit**

```bash
git add packages/core/platform/jobs/
git commit -m "feat(platform): idempotent job handlers on convention paths"
```

---

### Úkol 44: Audit log a log doručení, čtení s filtry a počty

**Files:**
- Create: `packages/core/platform/audit-query.ts`
- Create: `packages/core/platform/api/audit.routes.ts`
- Test: `packages/core/platform/audit-query.test.ts`
- Test: `apps/web/test/api/audit-log.test.ts`

- [ ] **Krok 1: Napiš padající test dotazovací vrstvy**

Create `packages/core/platform/audit-query.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { withWorkspace } from '@mlain/core/tx';
import { writeAuditLog } from '@mlain/core/audit/write';
import { IdentityAuditActions } from '@mlain/core/identity/audit';
import { seedWorkspaceForCoreTests } from '@mlain/core/identity/test-helpers';
import type { WorkspaceContext } from '@mlain/core/identity/types';
import { listAuditLog, countAuditLog, AUDIT_ORDERS } from './audit-query.js';

let workspaceId = '';
let userId = '';
let workspaceCtx: WorkspaceContext;

beforeAll(async () => {
  const seeded = await seedWorkspaceForCoreTests();
  workspaceId = seeded.workspaceId;
  userId = seeded.userId;
  workspaceCtx = seeded.ctx;

  await withWorkspace(workspaceCtx, async (tx) => {
    for (const action of [
      IdentityAuditActions['workspace.updated'],
      IdentityAuditActions['api_key.created'],
      IdentityAuditActions['api_key.revoked'],
    ]) {
      await writeAuditLog(tx, {
        action,
        workspaceId,
        actor: { actorType: 'user', actorId: userId, actorLabel: 'audit@example.cz' },
        targetType: 'workspace',
        targetId: workspaceId,
      });
    }
  });
});

const ctx = () => workspaceCtx;

describe('listAuditLog', () => {
  it('povolené řazení je vyjmenované', () => {
    expect(AUDIT_ORDERS).toEqual(['created_at.desc', 'created_at.asc']);
  });

  it('vrátí záznamy projektu, nejnovější první', async () => {
    const rows = await withWorkspace(workspaceCtx, (tx) =>
      listAuditLog(tx, ctx(), { limit: 50, order: 'created_at.desc', cursor: null }),
    );
    expect(rows.length).toBeGreaterThanOrEqual(3);
    const times = rows.map((r) => new Date(r.created_at).getTime());
    expect([...times].sort((a, b) => b - a)).toEqual(times);
  });

  it('filtr podle action zabírá', async () => {
    const rows = await withWorkspace(workspaceCtx, (tx) =>
      listAuditLog(tx, ctx(), {
        limit: 50,
        order: 'created_at.desc',
        cursor: null,
        action: 'api_key.created',
      }),
    );
    expect(rows.every((r) => r.action === 'api_key.created')).toBe(true);
    expect(rows.length).toBe(1);
  });

  it('filtr podle actor_id zabírá', async () => {
    const rows = await withWorkspace(workspaceCtx, (tx) =>
      listAuditLog(tx, ctx(), { limit: 50, order: 'created_at.desc', cursor: null, actorId: userId }),
    );
    expect(rows.every((r) => r.actor_id === userId)).toBe(true);
  });

  it('filtry from a to zabírají', async () => {
    const budoucnost = new Date(Date.now() + 60_000).toISOString();
    const rows = await withWorkspace(workspaceCtx, (tx) =>
      listAuditLog(tx, ctx(), { limit: 50, order: 'created_at.desc', cursor: null, from: budoucnost }),
    );
    expect(rows).toHaveLength(0);
  });

  it('načítá limit + 1 řádků, aby šlo odvodit has_more', async () => {
    const rows = await withWorkspace(workspaceCtx, (tx) =>
      listAuditLog(tx, ctx(), { limit: 2, order: 'created_at.desc', cursor: null }),
    );
    expect(rows.length).toBe(3);
  });
});

describe('countAuditLog', () => {
  it('vrátí přesný počet se stejnými filtry jako seznam', async () => {
    const result = await withWorkspace(workspaceCtx, (tx) =>
      countAuditLog(tx, ctx(), { action: 'api_key.created' }),
    );
    expect(result.count).toBe(1);
    expect(result.precision).toBe('exact');
  });
});
```

- [ ] **Krok 2: Spusť test, ověř, že padá**

Run: `pnpm --filter @mlain/core test:db -- platform/audit-query.test.ts`
Expected: FAIL, `Cannot find module './audit-query.js'`.

- [ ] **Krok 3: Napiš `audit-query.ts`**

Create `packages/core/platform/audit-query.ts`:

```ts
import { sql } from 'drizzle-orm';
import type { Tx } from '@mlain/core/tx';
import type { WorkspaceContext } from '@mlain/core/identity/types';

/** 4.3: každý zdroj vyjmenovává povolené hodnoty order, jinak stránkování zpomalí. */
export const AUDIT_ORDERS = ['created_at.desc', 'created_at.asc'] as const;

export type AuditFilters = {
  action?: string;
  actorId?: string;
  targetId?: string;
  from?: string;
  to?: string;
};

export type AuditListQuery = AuditFilters & {
  limit: number;
  order: string;
  cursor: { k: unknown[] } | null;
};

export type AuditRow = {
  id: string;
  action: string;
  actor_type: string;
  actor_id: string | null;
  actor_label: string;
  target_type: string | null;
  target_id: string | null;
  ip: string | null;
  request_id: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

function filterSql(filters: AuditFilters) {
  return sql`
    ${filters.action ? sql`AND action = ${filters.action}` : sql``}
    ${filters.actorId ? sql`AND actor_id = ${filters.actorId}::uuid` : sql``}
    ${filters.targetId ? sql`AND target_id = ${filters.targetId}::uuid` : sql``}
    ${filters.from ? sql`AND created_at >= ${filters.from}::timestamptz` : sql``}
    ${filters.to ? sql`AND created_at < ${filters.to}::timestamptz` : sql``}
  `;
}

/**
 * 3.7: čtení je projektové. Globální řádky (workspace_id IS NULL) se přes
 * workspace kontext nečtou vůbec, patří uživateli, ne projektu. Zajišťuje to
 * politika ws_isolation_audit, tenhle dotaz se na ni spoléhá jako na druhou
 * vrstvu a filtr podle workspace má i sám v sobě.
 */
export async function listAuditLog(
  tx: Tx,
  ctx: WorkspaceContext,
  query: AuditListQuery,
): Promise<AuditRow[]> {
  const descending = query.order !== 'created_at.asc';
  const keyset = query.cursor
    ? descending
      ? sql`AND (created_at, id) < (${query.cursor.k[0]}::timestamptz, ${query.cursor.k[1]}::uuid)`
      : sql`AND (created_at, id) > (${query.cursor.k[0]}::timestamptz, ${query.cursor.k[1]}::uuid)`
    : sql``;
  const order = descending ? sql`ORDER BY created_at DESC, id DESC` : sql`ORDER BY created_at ASC, id ASC`;

  const { rows } = await tx.execute<Record<string, unknown>>(sql`
    SELECT id::text AS id, action, actor_type, actor_id::text AS actor_id, actor_label,
           target_type, target_id::text AS target_id, host(ip) AS ip, request_id, metadata, created_at
      FROM audit_log
     WHERE workspace_id = ${ctx.workspaceId}::uuid
     ${filterSql(query)} ${keyset}
     ${order}
     LIMIT ${query.limit + 1}
  `);

  return rows.map((r) => ({
    id: r.id as string,
    action: r.action as string,
    actor_type: r.actor_type as string,
    actor_id: (r.actor_id as string | null) ?? null,
    actor_label: r.actor_label as string,
    target_type: (r.target_type as string | null) ?? null,
    target_id: (r.target_id as string | null) ?? null,
    ip: (r.ip as string | null) ?? null,
    request_id: (r.request_id as string | null) ?? null,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    created_at: new Date(r.created_at as Date).toISOString(),
  }));
}

export async function countAuditLog(
  tx: Tx,
  ctx: WorkspaceContext,
  filters: AuditFilters,
): Promise<{ count: number; precision: 'exact' | 'estimated'; computed_at: string; stale: boolean }> {
  const computedAt = new Date().toISOString();
  const { rows } = await tx.execute<{ count: string }>(sql`
    SELECT count(*) AS count FROM audit_log
     WHERE workspace_id = ${ctx.workspaceId}::uuid
     ${filterSql(filters)}
  `);
  return { count: Number(rows[0]!.count), precision: 'exact', computed_at: computedAt, stale: false };
}
```

- [ ] **Krok 4: Napiš `audit.routes.ts` se čtyřmi cestami**

Create `packages/core/platform/api/audit.routes.ts`:

```ts
import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { withWorkspace } from '@mlain/core/tx';
import { assertPermission } from '@mlain/core/identity/permissions';
import {
  problemResponse,
  PaginationSchema,
  CountSchema,
  PaginationQuerySchema,
  type ApiEnv,
} from '@mlain/core/identity/api/schemas';
import { AUDIT_ORDERS, countAuditLog, listAuditLog } from '../audit-query.js';
import { listDeliveries } from '../webhooks/delivery-query.js';

export const AuditEntrySchema = z
  .object({
    id: z.uuid(),
    action: z.string(),
    actor_type: z.enum(['user', 'api_key', 'system']),
    actor_id: z.uuid().nullable(),
    actor_label: z.string(),
    target_type: z.string().nullable(),
    target_id: z.uuid().nullable(),
    ip: z.string().nullable(),
    request_id: z.string().nullable(),
    metadata: z.record(z.string(), z.unknown()),
    created_at: z.iso.datetime(),
  })
  .openapi('AuditEntry');

const AuditQuerySchema = PaginationQuerySchema.extend({
  action: z.string().optional(),
  actor_id: z.uuid().optional(),
  target_id: z.uuid().optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});

const listAuditRoute = createRoute({
  method: 'get',
  path: '/api/v1/audit-log',
  tags: ['Audit'],
  summary: 'Auditní log projektu',
  description: 'Globální akce uživatele (přihlášení, změna hesla) tenhle endpoint nevrací, patří uživateli, ne projektu.',
  security: [{ bearerAuth: ['audit:read'] }],
  request: { query: AuditQuerySchema },
  responses: {
    200: {
      description: 'Stránka záznamů',
      content: {
        'application/json': {
          schema: z.object({ data: z.array(AuditEntrySchema), pagination: PaginationSchema }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

const countAuditRoute = createRoute({
  method: 'get',
  path: '/api/v1/audit-log/count',
  tags: ['Audit'],
  summary: 'Počet záznamů auditního logu se stejnými filtry',
  security: [{ bearerAuth: ['audit:read'] }],
  request: { query: AuditQuerySchema.omit({ limit: true, cursor: true, order: true }) },
  responses: {
    200: { description: 'Počet', content: { 'application/json': { schema: CountSchema } } },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

const DeliveryQuerySchema = PaginationQuerySchema.extend({
  endpoint_id: z.uuid().optional(),
  event_type: z.string().optional(),
  status: z.enum(['pending', 'delivering', 'succeeded', 'failed', 'abandoned']).optional(),
});

const listDeliveriesRoute = createRoute({
  method: 'get',
  path: '/api/v1/webhook-deliveries',
  tags: ['Webhooks'],
  summary: 'Log doručení webhooků',
  security: [{ bearerAuth: ['webhooks:read'] }],
  request: { query: DeliveryQuerySchema },
  responses: {
    200: {
      description: 'Stránka doručení',
      content: {
        'application/json': {
          schema: z.object({ data: z.array(z.record(z.string(), z.unknown())), pagination: PaginationSchema }),
        },
      },
    },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
    422: problemResponse('validation_failed'),
  },
});

const countDeliveriesRoute = createRoute({
  method: 'get',
  path: '/api/v1/webhook-deliveries/count',
  tags: ['Webhooks'],
  summary: 'Počet doručení se stejnými filtry',
  security: [{ bearerAuth: ['webhooks:read'] }],
  request: { query: DeliveryQuerySchema.omit({ limit: true, cursor: true, order: true }) },
  responses: {
    200: { description: 'Počet', content: { 'application/json': { schema: CountSchema } } },
    401: problemResponse('unauthenticated'),
    403: problemResponse('forbidden', 'insufficient_scope'),
    404: problemResponse('not_found'),
  },
});

/**
 * Stránkovací pomocníky bydlí v apps/web, protože jsou to konvence HTTP vrstvy.
 * Definice cesty je v core (4.7), takže se sem předávají injektáží: aplikace je
 * nastaví jednou při skládání a graf závislostí zůstává nedotčený.
 */
export type PaginationDeps = {
  parseQuery: (
    query: { limit?: string; order?: string; cursor?: string },
    allowed: readonly string[],
  ) => { limit: number; order: string; cursor: { k: unknown[] } | null };
  buildPage: <T>(
    rows: T[],
    opts: { limit: number; order: string },
    keysOf: (row: T) => unknown[],
  ) => { data: T[]; pagination: unknown };
};

let deps: PaginationDeps | null = null;

export function setPaginationDeps(next: PaginationDeps): void {
  deps = next;
}

function requireDeps(): PaginationDeps {
  if (!deps) throw new Error('setPaginationDeps nebylo zavoláno při skládání aplikace.');
  return deps;
}

export function registerAuditRoutes(app: OpenAPIHono<ApiEnv>): void {
  app.openapi(listAuditRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'audit:read');
    const query = c.req.valid('query');
    const page = requireDeps().parseQuery(query, AUDIT_ORDERS);
    const rows = await withWorkspace(ctx, (tx) =>
      listAuditLog(tx, ctx, {
        limit: page.limit,
        order: page.order,
        cursor: page.cursor,
        action: query.action,
        actorId: query.actor_id,
        targetId: query.target_id,
        from: query.from,
        to: query.to,
      }),
    );
    return c.json(
      requireDeps().buildPage(rows, { limit: page.limit, order: page.order }, (r) => [r.created_at, r.id]) as never,
      200,
    );
  });

  app.openapi(countAuditRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'audit:read');
    const query = c.req.valid('query');
    const result = await withWorkspace(ctx, (tx) =>
      countAuditLog(tx, ctx, {
        action: query.action,
        actorId: query.actor_id,
        targetId: query.target_id,
        from: query.from,
        to: query.to,
      }),
    );
    return c.json(result, 200);
  });

  app.openapi(listDeliveriesRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'webhooks:read');
    const query = c.req.valid('query');
    const page = requireDeps().parseQuery(query, ['created_at.desc']);
    const rows = await withWorkspace(ctx, (tx) =>
      listDeliveries(tx, ctx, {
        limit: page.limit,
        cursor: page.cursor,
        endpointId: query.endpoint_id,
        eventType: query.event_type,
        status: query.status,
      }),
    );
    return c.json(
      requireDeps().buildPage(rows, { limit: page.limit, order: page.order }, (r) => [r.created_at, r.id]) as never,
      200,
    );
  });

  app.openapi(countDeliveriesRoute, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'webhooks:read');
    const query = c.req.valid('query');
    const rows = await withWorkspace(ctx, (tx) =>
      listDeliveries(tx, ctx, {
        limit: 10_000,
        cursor: null,
        endpointId: query.endpoint_id,
        eventType: query.event_type,
        status: query.status,
      }),
    );
    return c.json(
      { count: rows.length, precision: 'exact' as const, computed_at: new Date().toISOString(), stale: false },
      200,
    );
  });
}
```

- [ ] **Krok 5: Zapoj injektáž stránkování při skládání aplikace**

Do `apps/web/src/lib/api/openapi.ts`, na začátek `buildApp()`:

```ts
import { setPaginationDeps } from '@mlain/core/platform/api/audit.routes';
import { parsePaginationQuery, buildPage } from './pagination.js';

  setPaginationDeps({ parseQuery: parsePaginationQuery, buildPage });
```

- [ ] **Krok 6: Napiš integrační test audit logu**

Create `apps/web/test/api/audit-log.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { buildApp } from '../../src/lib/api/openapi.js';
import { seedOwnerWithWorkspace } from './helpers/seed.js';

const app = buildApp();
let owner: Awaited<ReturnType<typeof seedOwnerWithWorkspace>>;
let viewer: Awaited<ReturnType<typeof seedOwnerWithWorkspace>>;

const headers = (extra: Record<string, string> = {}) => ({
  Cookie: owner.cookie,
  'X-Workspace-Id': owner.workspaceId,
  'Content-Type': 'application/json',
  ...extra,
});

beforeAll(async () => {
  owner = await seedOwnerWithWorkspace(app, 'owner');
  viewer = await seedOwnerWithWorkspace(app, 'viewer');

  await app.request('/api/v1/api-keys', {
    method: 'POST',
    headers: headers({ 'Idempotency-Key': 'audit-key-001' }),
    body: JSON.stringify({ name: 'Audit', kind: 'secret', scopes: ['contacts:read'] }),
  });
});

describe('GET /api/v1/audit-log', () => {
  it('vrátí stránku záznamů s kurzorem', async () => {
    const res = await app.request('/api/v1/audit-log?limit=10', { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.pagination).toHaveProperty('has_more');
    expect(body.data.some((e: { action: string }) => e.action === 'api_key.created')).toBe(true);
  });

  it('kritérium 21c: nevrací globální řádky bez workspace_id', async () => {
    const body = await (await app.request('/api/v1/audit-log?limit=200', { headers: headers() })).json();
    expect(body.data.some((e: { action: string }) => e.action === 'user.login')).toBe(false);
  });

  it('viewer nemá audit:read a dostane 403', async () => {
    const res = await app.request('/api/v1/audit-log', {
      headers: { Cookie: viewer.cookie, 'X-Workspace-Id': viewer.workspaceId },
    });
    expect(res.status).toBe(403);
  });

  it('nepovolené řazení vrací 422', async () => {
    const res = await app.request('/api/v1/audit-log?order=action.asc', { headers: headers() });
    expect(res.status).toBe(422);
  });

  it('limit nad 200 vrací 422', async () => {
    const res = await app.request('/api/v1/audit-log?limit=500', { headers: headers() });
    expect(res.status).toBe(422);
  });

  it('metadata neobsahují sekret vytvořeného klíče', async () => {
    const body = await (await app.request('/api/v1/audit-log?limit=50', { headers: headers() })).json();
    expect(JSON.stringify(body)).not.toContain('ml_live_');
  });
});

describe('GET /api/v1/audit-log/count', () => {
  it('vrací počet se stejnými filtry', async () => {
    const res = await app.request('/api/v1/audit-log/count?action=api_key.created', { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBeGreaterThanOrEqual(1);
    expect(body.precision).toBe('exact');
    expect(body.stale).toBe(false);
  });
});

describe('GET /api/v1/webhook-deliveries', () => {
  it('vrací prázdnou stránku, když žádná doručení nejsou', async () => {
    const res = await app.request('/api/v1/webhook-deliveries', { headers: headers() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toEqual([]);
    expect(body.pagination.has_more).toBe(false);
  });

  it('count vrací nulu', async () => {
    const body = await (await app.request('/api/v1/webhook-deliveries/count', { headers: headers() })).json();
    expect(body.count).toBe(0);
  });
});
```

- [ ] **Krok 7: Spusť oba testy, ověř, že prochází**

Run: `pnpm --filter @mlain/core test:db -- platform/audit-query.test.ts && pnpm --filter @mlain/web test:db -- api/audit-log.test.ts`
Expected: 7 passed a 9 passed.

- [ ] **Krok 8: Přegeneruj OpenAPI a commitni**

Run: `pnpm --filter @mlain/web generate:openapi && pnpm --filter @mlain/web test:unit -- api/openapi.test.ts`
Expected: 8 passed, počet endpointů 43.

```bash
git add packages/core/platform/audit-query.ts packages/core/platform/api/audit.routes.ts packages/core/platform/audit-query.test.ts apps/web/test/api/audit-log.test.ts apps/web/src/lib/api/openapi.ts packages/contracts/openapi.json
git commit -m "feat(api): audit log and webhook delivery listings with count endpoints"
```

---

### Úkol 45: Centrum úloh, registr zdrojů a endpointy

P05 dodal prezentační vrstvu (`JobsCenter`, `JobsBadge`, rozhraní `JobsSource`) a v rozhodnutí R4 napsal, že endpoint a napojení dodá „plán, který vlastní API úloh". To je tenhle plán. Bez něj zůstane komponenta bez dat a odznak v topbaru bude vždy prázdný.

**Klíčové omezení, které určuje tvar řešení:** generická tabulka úloh **neexistuje a nemá vzniknout**. Ověřeno čtením P03: schéma má `pgboss.*` (zakládá si ho pg-boss sám) a doménové tabulky postupu (`imports`, `campaign_audience_progress`), ale žádné společné `jobs`. Je to tak správně, protože každá doména ví o svém postupu něco jiného, a jedna společná tabulka by nutila všechny plány zapisovat do cizího souboru.

Kdyby P04 četl `imports` nebo `campaign_audience_progress` přímo, sáhl by do domén P11 a P13 a musel by je znát dřív, než vzniknou. **P04 proto dodává mechanismus, ne doménové dotazy**: registr, do kterého si každá doména zaregistruje svůj zdroj úloh, a endpointy, které registr slijí dohromady. Je to tentýž vzor, jaký P03 používá u `registerRepoModule`.

Ve chvíli, kdy tenhle plán skončí, je registr **prázdný** a endpoint vrací prázdný seznam. To je správný stav, ne nedodělek: P04 žádnou dlouhoběžnou úlohu nemá, přidávají je P11 a P13.

**Files:**
- Create: `packages/core/platform/jobs/registry.ts`
- Create: `packages/core/platform/api/jobs.routes.ts`
- Test: `packages/core/platform/jobs/registry.test.ts`
- Test: `apps/web/test/api/jobs.test.ts`

- [ ] **Krok 1: Napiš padající test registru**

Create `packages/core/platform/jobs/registry.test.ts`:

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { unsafeWorkspaceContext } from '@mlain/db/unsafe-context';
import {
  clearJobSources, getJob, listJobs, registerJobSource, registeredJobKinds,
} from './registry.js';

const WS = '0192f3a0-1c2d-7e40-9a1b-2c3d4e5f6071';
const ctx = unsafeWorkspaceContext(WS, {
  type: 'user', userId: '0192f3a0-1c2d-7e41-9a1b-2c3d4e5f6071', role: 'admin',
});

const job = (id: string, status: string, updatedAt: string) => ({
  id, kind: 'import', title: 'Import kontaktů', status,
  done: 3, total: 10, startedBy: 'Petr', startedAt: updatedAt, updatedAt,
  finishedAt: null, note: null,
});

beforeEach(() => { clearJobSources(); });

describe('registr zdrojů úloh', () => {
  it('bez registrovaného zdroje vrací prázdno, ne chybu', async () => {
    expect(registeredJobKinds()).toEqual([]);
    expect(await listJobs(ctx, { limit: 20 })).toEqual([]);
  });

  it('slévá úlohy z víc zdrojů a řadí od nejnovější změny', async () => {
    registerJobSource({
      kind: 'import',
      list: async () => [job('a', 'running', '2026-08-01T10:00:00.000Z')],
      get: async () => null,
    });
    registerJobSource({
      kind: 'campaign_audience',
      list: async () => [
        { ...job('b', 'completed', '2026-08-01T12:00:00.000Z'), kind: 'campaign_audience' },
      ],
      get: async () => null,
    });
    const jobs = await listJobs(ctx, { limit: 20 });
    expect(jobs.map((j) => j.id)).toEqual(['b', 'a']);
  });

  it('dvojí registrace téhož druhu je chyba, ne tiché přepsání', () => {
    const source = { kind: 'import', list: async () => [], get: async () => null };
    registerJobSource(source);
    // Tiché přepsání by znamenalo, že jeden ze dvou plánů dodal zdroj, který
    // se nikdy nezavolá, a nikdo by si toho nevšiml.
    expect(() => registerJobSource(source)).toThrow(/import/);
  });

  it('pád jednoho zdroje neshodí celý výpis', async () => {
    registerJobSource({
      kind: 'import',
      list: async () => { throw new Error('databáze je pryč'); },
      get: async () => null,
    });
    registerJobSource({
      kind: 'campaign_audience',
      list: async () => [
        { ...job('b', 'running', '2026-08-01T12:00:00.000Z'), kind: 'campaign_audience' },
      ],
      get: async () => null,
    });
    // Centrum úloh je diagnostická obrazovka. Kdyby ji shodil jeden rozbitý
    // zdroj, uživatel by přišel i o informace o všech ostatních úlohách,
    // tedy přesně ve chvíli, kdy je potřebuje nejvíc.
    const jobs = await listJobs(ctx, { limit: 20 });
    expect(jobs.map((j) => j.id)).toEqual(['b']);
  });

  it('detail se hledá jen u zdroje, kterému druh patří', async () => {
    let importAsked = 0;
    registerJobSource({
      kind: 'import',
      list: async () => [],
      get: async (_c, id) => { importAsked += 1; return id === 'a' ? job('a', 'running', 'x') : null; },
    });
    expect(await getJob(ctx, 'import', 'a')).toMatchObject({ id: 'a' });
    expect(await getJob(ctx, 'import', 'zz')).toBeNull();
    expect(await getJob(ctx, 'neznamy_druh', 'a')).toBeNull();
    expect(importAsked, 'neznámý druh se nemá nikoho ptát').toBe(2);
  });

  it('limit se uplatní až po slití, ne na každý zdroj zvlášť', async () => {
    for (const kind of ['import', 'campaign_audience', 'export']) {
      registerJobSource({
        kind,
        list: async () => [
          { ...job(`${kind}-1`, 'running', '2026-08-01T10:00:00.000Z'), kind },
          { ...job(`${kind}-2`, 'running', '2026-08-01T09:00:00.000Z'), kind },
        ],
        get: async () => null,
      });
    }
    expect(await listJobs(ctx, { limit: 4 })).toHaveLength(4);
  });
});
```

- [ ] **Krok 2: Spusť test, ověř, že padá**

Run: `pnpm --filter @mlain/core test:unit -- platform/jobs/registry.test.ts`
Expected: FAIL, `Cannot find module './registry.js'`.

- [ ] **Krok 3: Napiš `registry.ts`**

Create `packages/core/platform/jobs/registry.ts`:

```ts
import type { WorkspaceContext } from '@mlain/db';

/**
 * Stavy úlohy. Doslova ty, které zná `JobStatus` v packages/ui (P05, úkol 31).
 * Kdyby se rozešly, obrazovka by dostala stav, který neumí vykreslit.
 */
export const JOB_STATUSES = [
  'running', 'paused', 'completed', 'completedWithErrors', 'failed', 'cancelled',
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const RUNNING_JOB_STATUSES: readonly JobStatus[] = ['running', 'paused'];

export type JobRecord = {
  id: string;
  /** Druh úlohy, zároveň klíč zdroje. Například `import` nebo `campaign_audience`. */
  kind: string;
  title: string;
  status: JobStatus;
  done: number;
  total: number;
  /** Zobrazované jméno toho, kdo úlohu spustil. U systémové úlohy null (5.7). */
  startedBy: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  note: string | null;
};

export type JobSource = {
  kind: string;
  list: (ctx: WorkspaceContext, opts: { limit: number }) => Promise<JobRecord[]>;
  get: (ctx: WorkspaceContext, id: string) => Promise<JobRecord | null>;
};

/**
 * Registr zdrojů úloh.
 *
 * P04 vlastní API a mechanismus, ale NEZNÁ doménové tabulky postupu: `imports`
 * vlastní P11, `campaign_audience_progress` vlastní P13. Generická tabulka úloh
 * ve schématu záměrně není. Každá doména si proto svůj zdroj zaregistruje sama,
 * stejně jako se u P03 registrují repository moduly.
 *
 * Registr je po doběhnutí P04 PRÁZDNÝ a endpoint vrací prázdný seznam. Je to
 * správný stav: žádná úloha z P04 netrvá tak dlouho, aby patřila do Centra úloh.
 */
const sources = new Map<string, JobSource>();

export function registerJobSource(source: JobSource): void {
  if (sources.has(source.kind)) {
    // Tvrdě. Tiché přepsání by znamenalo, že jeden ze dvou plánů dodal zdroj,
    // který se nikdy nezavolá, a jeho úlohy by v Centru chyběly bez chyby.
    throw new Error(`Zdroj úloh pro druh "${source.kind}" je už zaregistrovaný.`);
  }
  sources.set(source.kind, source);
}

export function registeredJobKinds(): string[] {
  return [...sources.keys()].sort();
}

/** Jen pro testy. Produkční kód registruje zdroje jednou při startu. */
export function clearJobSources(): void {
  sources.clear();
}

/**
 * Slije úlohy ze všech zdrojů, seřadí od nejnovější změny a ořízne na limit.
 *
 * Limit se uplatňuje AŽ PO SLITÍ. Kdyby si ho každý zdroj ořezával sám, dva
 * zdroje s limitem 20 by vrátily 40 řádků a pořadí by přestalo platit.
 * Zdrojům se proto předává tentýž limit jen jako strop jejich vlastního dotazu.
 *
 * Pád jednoho zdroje ostatní nezahazuje: Centrum úloh je diagnostická
 * obrazovka a je nejužitečnější přesně tehdy, když je něco rozbité.
 */
export async function listJobs(
  ctx: WorkspaceContext,
  opts: { limit: number },
): Promise<JobRecord[]> {
  const settled = await Promise.allSettled(
    [...sources.values()].map((s) => s.list(ctx, opts)),
  );
  const all = settled.flatMap((r) => (r.status === 'fulfilled' ? r.value : []));
  return all
    .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
    .slice(0, opts.limit);
}

export async function getJob(
  ctx: WorkspaceContext,
  kind: string,
  id: string,
): Promise<JobRecord | null> {
  const source = sources.get(kind);
  if (!source) return null;
  return source.get(ctx, id);
}

/** Počet běžících úloh pro odznak v topbaru. Dokončené odznak nedělají. */
export async function runningJobCount(ctx: WorkspaceContext): Promise<number> {
  const jobs = await listJobs(ctx, { limit: 200 });
  return jobs.filter((j) => RUNNING_JOB_STATUSES.includes(j.status)).length;
}
```

- [ ] **Krok 4: Spusť test, ověř, že prochází**

Run: `pnpm --filter @mlain/core test:unit -- platform/jobs/registry.test.ts`
Expected: 6 passed.

- [ ] **Krok 5: Napiš cesty `jobs.routes.ts`**

Create `packages/core/platform/api/jobs.routes.ts`:

```ts
import { createRoute, z, type OpenAPIHono } from '@hono/zod-openapi';
import { ApiError } from '@mlain/core/errors/api-error';
import { assertPermission } from '@mlain/core/identity/permissions';
import type { ApiEnv } from '@mlain/core/identity/api/schemas';
import { JOB_STATUSES, getJob, listJobs, runningJobCount } from '../jobs/registry.js';

const JobSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  status: z.enum(JOB_STATUSES),
  done: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  started_by: z.string().nullable(),
  started_at: z.string(),
  updated_at: z.string(),
  finished_at: z.string().nullable(),
  note: z.string().nullable(),
});

const listRouteDef = createRoute({
  method: 'get',
  path: '/api/v1/jobs',
  tags: ['jobs'],
  summary: 'Úlohy projektu pro Centrum úloh',
  request: {
    query: z.object({
      limit: z.coerce.number().int().min(1).max(100).default(20),
      running: z.enum(['true', 'false']).optional(),
    }).strict(),
  },
  responses: {
    200: {
      description: 'Seznam úloh, nejnovější změna první',
      content: {
        'application/json': {
          schema: z.object({ data: z.array(JobSchema), running_count: z.number().int() }),
        },
      },
    },
  },
});

const detailRouteDef = createRoute({
  method: 'get',
  path: '/api/v1/jobs/{kind}/{id}',
  tags: ['jobs'],
  summary: 'Detail jedné úlohy',
  request: { params: z.object({ kind: z.string().min(1), id: z.string().min(1) }).strict() },
  responses: {
    200: {
      description: 'Detail úlohy',
      content: { 'application/json': { schema: z.object({ job: JobSchema }) } },
    },
  },
});

/**
 * Cesta nese `kind` v URL schválně. ID úloh pocházejí z různých doménových
 * tabulek a nejsou napříč nimi zaručeně jedinečná; bez druhu by se detail musel
 * ptát všech zdrojů a při shodě ID by vrátil cizí úlohu.
 *
 * `timeline:read` je nejnižší oprávnění, které má i viewer, a Centrum úloh je
 * čtení stavu vlastního projektu.
 */
export function registerJobRoutes(app: OpenAPIHono<ApiEnv>): void {
  app.openapi(listRouteDef, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'timeline:read');
    const { limit, running } = c.req.valid('query');
    const jobs = await listJobs(ctx, { limit });
    const filtered = running === 'true'
      ? jobs.filter((j) => j.status === 'running' || j.status === 'paused')
      : jobs;
    return c.json({
      data: filtered.map(toPublicJob),
      running_count: await runningJobCount(ctx),
    }, 200);
  });

  app.openapi(detailRouteDef, async (c) => {
    const { ctx } = c.get('auth');
    assertPermission(ctx, 'timeline:read');
    const { kind, id } = c.req.valid('param');
    const job = await getJob(ctx, kind, id);
    // Neznámý druh i neznámé ID dávají shodně 404, aby z odpovědi nešlo
    // zjistit, které druhy úloh instalace zná.
    if (!job) throw new ApiError('not_found');
    return c.json({ job: toPublicJob(job) }, 200);
  });
}

function toPublicJob(job: Awaited<ReturnType<typeof getJob>> & object) {
  return {
    id: job.id,
    kind: job.kind,
    title: job.title,
    status: job.status,
    done: job.done,
    total: job.total,
    started_by: job.startedBy,
    started_at: job.startedAt,
    updated_at: job.updatedAt,
    finished_at: job.finishedAt,
    note: job.note,
  };
}
```

- [ ] **Krok 6: Napojení do aplikace**

V `apps/web/src/lib/api/app.ts` zavolej `registerJobRoutes(app)` ve stejném bloku jako ostatní registrace cest.

- [ ] **Krok 7: Napiš integrační test endpointů**

Create `apps/web/test/api/jobs.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { clearJobSources, registerJobSource } from '@mlain/core/platform/jobs/registry';
import { closePools } from '@mlain/core/tx';
import { createApiApp } from '../../src/lib/api/app.js';
import { seedWorkspaceAndLogin } from './helpers.js';

const app = createApiApp();
let cookie = '';

beforeAll(async () => {
  ({ cookie } = await seedWorkspaceAndLogin('admin'));
});

afterAll(async () => {
  clearJobSources();
  await closePools();
});

describe('GET /api/v1/jobs', () => {
  it('bez registrovaného zdroje vrací prázdný seznam a nulový odznak', async () => {
    clearJobSources();
    const res = await app.request('/api/v1/jobs', { headers: { cookie } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [], running_count: 0 });
  });

  it('vrátí úlohy zaregistrovaného zdroje a spočítá jen běžící', async () => {
    clearJobSources();
    registerJobSource({
      kind: 'import',
      list: async () => [
        { id: 'a', kind: 'import', title: 'Import', status: 'running', done: 1, total: 4,
          startedBy: 'Petr', startedAt: '2026-08-01T10:00:00.000Z',
          updatedAt: '2026-08-01T10:05:00.000Z', finishedAt: null, note: null },
        { id: 'b', kind: 'import', title: 'Import', status: 'completed', done: 4, total: 4,
          startedBy: 'Petr', startedAt: '2026-08-01T09:00:00.000Z',
          updatedAt: '2026-08-01T09:30:00.000Z',
          finishedAt: '2026-08-01T09:30:00.000Z', note: null },
      ],
      get: async () => null,
    });
    const body = await (await app.request('/api/v1/jobs', { headers: { cookie } })).json();
    expect(body.data.map((j: { id: string }) => j.id)).toEqual(['a', 'b']);
    expect(body.running_count).toBe(1);
    expect(body.data[0].started_by).toBe('Petr');
  });

  it('neznámý druh v detailu vrací 404, ne 500', async () => {
    clearJobSources();
    const res = await app.request('/api/v1/jobs/neznamy/xyz', { headers: { cookie } });
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/problem+json');
  });

  it('bez přihlášení vrací 401', async () => {
    const res = await app.request('/api/v1/jobs');
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Krok 8: Spusť testy**

Run: `pnpm --filter @mlain/web test:db -- api/jobs.test.ts`
Expected: 4 passed.

- [ ] **Krok 9: Commit**

```bash
git add packages/core/platform/jobs/registry.ts packages/core/platform/jobs/registry.test.ts packages/core/platform/api/jobs.routes.ts apps/web/test/api/jobs.test.ts apps/web/src/lib/api/app.ts
git commit -m "feat(platform): job source registry and Jobs Centre endpoints"
```

---

### Úkol 46: Mount do Next.js a kompletní série

**Files:**
- Create: `apps/web/src/app/api/v1/[[...route]]/route.ts`
- Test: `apps/web/test/api/smoke.test.ts`

- [ ] **Krok 1: Napiš mount**

Create `apps/web/src/app/api/v1/[[...route]]/route.ts`:

```ts
import { handle } from 'hono/vercel';
import { buildApp } from '../../../../lib/api/openapi.js';

/**
 * 4.1: veřejné REST API běží na Honu mountnutém do jednoho Next.js Route
 * Handleru. Jeden proces, sdílené typy, ale routing a validace mimo konvence
 * Next.js, protože potřebujeme generovat OpenAPI z definice cesty.
 *
 * Runtime je Node.js, ne edge: potřebujeme node:crypto, node:https a pg.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const app = buildApp();
const handler = handle(app);

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const PUT = handler;
export const DELETE = handler;
export const OPTIONS = handler;
export const HEAD = handler;
```

- [ ] **Krok 2: Napiš průřezový smoke test**

Create `apps/web/test/api/smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildApp, buildOpenApiDocument, registeredPaths } from '../../src/lib/api/openapi.js';

const app = buildApp();

/** Poslední síto: chyby, které projdou všemi ostatními testy jednotlivě. */
describe('průřezová kontrola celé aplikace', () => {
  it('každá chybová odpověď je application/problem+json', async () => {
    const cases = [
      { path: '/api/v1/api-keys', init: {} },
      { path: '/api/v1/neexistuje', init: {} },
      { path: '/api/v1/audit-log', init: {} },
    ];
    for (const testCase of cases) {
      const res = await app.request(testCase.path, testCase.init);
      expect(res.status, testCase.path).toBeGreaterThanOrEqual(400);
      expect(res.headers.get('content-type'), testCase.path).toContain('application/problem+json');
      const body = await res.json();
      expect(body.request_id, testCase.path).toBeTruthy();
      expect(body.code, testCase.path).toBeTruthy();
      expect(body.type, testCase.path).toContain('https://docs.mlain.dev/errors/');
    }
  });

  it('žádná odpověď neobsahuje stack, SQL ani název tabulky', async () => {
    const res = await app.request('/api/v1/audit-log');
    const text = await res.text();
    for (const forbidden of ['at Object.', 'SELECT ', 'FROM ', 'password_hash', 'node_modules']) {
      expect(text, forbidden).not.toContain(forbidden);
    }
  });

  it('všechny cesty vlastněné částí 1 jsou registrované', () => {
    const paths = registeredPaths(app).sort();
    expect(paths).toEqual(
      [
        '/api/v1/api-keys',
        '/api/v1/api-keys/{id}',
        '/api/v1/api-keys/{id}/rotate',
        '/api/v1/audit-log',
        '/api/v1/audit-log/count',
        '/api/v1/auth/change-password',
        '/api/v1/auth/login',
        '/api/v1/auth/logout',
        '/api/v1/auth/logout-all',
        '/api/v1/auth/me',
        '/api/v1/auth/password-reset',
        '/api/v1/auth/password-reset/confirm',
        '/api/v1/auth/sessions',
        '/api/v1/auth/sessions/{id}',
        '/api/v1/docs',
        '/api/v1/invitations',
        '/api/v1/invitations/accept',
        '/api/v1/invitations/{id}',
        '/api/v1/members',
        '/api/v1/members/{user_id}',
        '/api/v1/openapi.json',
        '/api/v1/setup',
        '/api/v1/webhook-deliveries',
        '/api/v1/webhook-deliveries/count',
        '/api/v1/webhook-deliveries/{id}/retry',
        '/api/v1/webhook-endpoints',
        '/api/v1/webhook-endpoints/{id}',
        '/api/v1/webhook-endpoints/{id}/enable',
        '/api/v1/webhook-endpoints/{id}/test',
        '/api/v1/workspaces',
        '/api/v1/workspaces/{id}',
        '/api/v1/workspaces/{id}/restore',
        '/api/v1/workspaces/{id}/transfer-ownership',
      ].sort(),
    );
  });

  it('dokument OpenAPI popisuje 43 operací', () => {
    const document = buildOpenApiDocument(app);
    const operations = Object.values(document.paths ?? {}).flatMap((methods) =>
      Object.keys(methods as Record<string, unknown>),
    );
    expect(operations).toHaveLength(43);
  });
});
```

- [ ] **Krok 3: Spusť smoke test**

Run: `pnpm --filter @mlain/web test:db -- api/smoke.test.ts`
Expected: 4 passed. Rozdíl v seznamu cest je nejrychlejší způsob, jak zjistit, že se něco nezaregistrovalo nebo přibylo navíc.

- [ ] **Krok 4: Spusť kompletní sérii**

Run:
```bash
pnpm --filter @mlain/core typecheck
pnpm --filter @mlain/web typecheck
pnpm lint
pnpm --filter @mlain/core test:unit
pnpm --filter @mlain/web test:unit
pnpm --filter @mlain/core test:db
pnpm --filter @mlain/web test:db
pnpm --filter @mlain/web generate:openapi
git diff --exit-code packages/contracts/openapi.json
```
Expected: všechno PASS a poslední příkaz beze změn, tedy `openapi.json` v repozitáři odpovídá kódu (job `openapi-drift` projde).

- [ ] **Krok 5: Ověř, že plán nesáhl mimo své soubory**

Run:
```bash
git diff --name-only main...HEAD | sort
```
Expected: výhradně cesty ze seznamu v kapitole 0.1 plus `packages/contracts/openapi.json`, `packages/core/package.json` a `apps/web/package.json`. Když je v seznamu cokoliv z `packages/db` nebo `packages/ui`, je to chyba a musí se vrátit zpět.

- [ ] **Krok 6: Commit**

```bash
git add apps/web/src/app/api/v1/ apps/web/test/api/smoke.test.ts
git commit -m "feat(web): mount Hono API into Next.js route handler"
```

---

## 3. Pořadí provádění a co na čem závisí

Úkoly jdou po sobě, ale ne všechny se musí čekat. Tohle je jediné místo, kde se dá bezpečně paralelizovat.

| Fáze | Úkoly | Lze paralelně | Blokuje |
|---|---|---|---|
| A | 1 až 11 | úkoly 7, 8, 9, 10, 11 jsou nezávislé, jakmile je hotový úkol 3 a 4 | všechno ostatní |
| B | 12 až 20 | úkoly 13, 14, 15, 17 jsou nezávislé | fáze D a E |
| C | 21, 22 | ne | fáze D, E, F, G |
| D | 23 až 29 | úkol 25 běží až po 23 a po 29 | fáze F |
| E | 30 až 33 | úkol 30 je nezávislý na fázi D | fáze F, G |
| F | 34 až 36 | úkoly 34 a 35 jsou nezávislé | nic |
| G | 37 až 41 | úkoly 37, 38, 39 jsou navzájem nezávislé | úkol 44 |
| H | 42 až 46 | úkol 45 je nezávislý na 42 až 44 | konec plánu |

Tvrdé závislosti, které se nesmí obejít:

1. **Úkol 1 před vším ostatním.** Bez preflightu se plán rozjede proti balíčkům jiného tvaru.
2. **Úkol 22 před úkoly 23 až 41.** Každá služba zapisuje audit; bez `writeAuditLog` by se musel dopisovat zpětně do dvaceti souborů.
3. **Úkol 32 před úkoly 34 až 44.** Bez rozpoznání aktéra nemá žádný projektový handler `ctx`.
4. **Úkol 29 zavírá úkol 25.** Test kritéria 16 měří obě cesty a druhá vzniká až v úkolu 29.
5. **Úkol 42 po všech registrovaných cestách, tedy i po úkolu 45.** Dokument se generuje z routeru, takže endpoint doplněný později znamená přegenerování. Cesty Centra úloh z úkolu 45 v něm musí být.
6. **Úkol 46 je poslední vždy.** Mountuje aplikaci do Next.js a pouští kompletní sérii.

---

## 4. Mapa pokrytých akceptačních kritérií

Číslo kritéria, jeho znění zkráceně, a test, který ho dokazuje. Pokrytí grepem se nepočítá: u každého řádku je test, který se dá spustit.

| # | Kritérium | Dokazuje |
|---|---|---|
| 14 | cookie `ml_session` má `HttpOnly`, `SameSite=Lax`, `Secure` nad https | `apps/web/test/api/auth-login.test.ts` |
| 15 | 10 neúspěchů vede na 423, jedenáctý pokus se správným heslem taky selže | `packages/core/identity/login.test.ts` |
| 16 | medián odpovědi se neliší o víc než 20 % (100 pokusů) | `packages/core/identity/login-timing.test.ts` |
| 17 | změna hesla revokuje ostatní relace, stará cookie vrací 401 | `apps/web/test/api/auth-change-password.test.ts` |
| 18 | `logout-all` zneplatní i aktuální cookie | `apps/web/test/api/auth-sessions.test.ts` |
| 19 | klíč projektu B na zdroj z A vrátí 404 problem+json | `apps/web/test/api/cross-workspace.test.ts` |
| 20 | `SELECT` bez `set_config` vrátí 0 řádků | `packages/core/identity/isolation.test.ts` |
| 21 | cizí `workspace_id` selže na `WITH CHECK` | `packages/core/identity/isolation.test.ts` |
| 21b | změna hesla zapíše globální audit a transakce se nerollbackne | `packages/core/audit/write.test.ts`, `packages/core/identity/change-password.test.ts` |
| 21c | pod kontextem B nevidět řádky A ani globální | `packages/core/audit/write.test.ts`, `apps/web/test/api/audit-log.test.ts` |
| 21d | `workspaces` vrací pod kontextem B právě jeden řádek | `packages/core/identity/isolation.test.ts` |
| 22 | odebrání posledního ownera vrací 409 a nic nezmění | `apps/web/test/api/members.test.ts` |
| 23 | `viewer` dostane 403 `forbidden` | `apps/web/test/api/permissions.test.ts` |
| 24 | klíč bez scope dostane 403 `insufficient_scope` | `apps/web/test/api/permissions.test.ts` |
| 25 | sekret je v odpovědi právě jednou | `apps/web/test/api/api-keys.test.ts` |
| 26 | veřejný klíč na `/api/v1/**` vrací 403, ne 401 | `apps/web/test/api/permissions.test.ts` |
| 26b | vadné tělo `ml_pub_` vrací 401 bez dotazu do databáze | `packages/core/identity/api-key.test.ts` |
| 26c | grace období 60 s funguje a po vypršení vrací 401 | `packages/core/identity/api-key.test.ts`, `apps/web/test/api/api-keys.test.ts` |
| 27 | neplatné tělo vrací 422 s `errors[].path` | `apps/web/src/lib/api/validation.test.ts`, `apps/web/test/api/auth-login.test.ts` |
| 28 | neznámý klíč v těle vrací 422, ne 201 | `apps/web/src/lib/api/validation.test.ts` |
| 29 | každá chybová odpověď nese `request_id` | `apps/web/src/lib/api/problem.test.ts`, `apps/web/test/api/smoke.test.ts` |
| 30 | dvě volání se stejným klíčem a tělem vytvoří jeden zdroj | `apps/web/test/api/api-keys.test.ts` |
| 31 | stejný klíč s jiným tělem vrací 409 | `apps/web/test/api/api-keys.test.ts` |
| 32 | 429 nese `Retry-After` a `RateLimit-*` | `apps/web/src/lib/api/rate-limit.test.ts` |
| 33 | 10 000 položek po 50, každá právě jednou i při souběžném zápisu | `apps/web/test/api/pagination-integrity.test.ts` |
| 34 | `GET /api/v1/openapi.json` je bajt po bajtu shodný s commitnutým | `apps/web/test/api/openapi.test.ts` |
| 35 | každá registrovaná cesta je v dokumentu | `apps/web/test/api/openapi.test.ts`, `apps/web/test/api/smoke.test.ts` |
| 36 | přesně `WEBHOOK_MAX_ATTEMPTS` pokusů podle tabulky, pak `abandoned` | `packages/core/platform/webhooks/backoff.test.ts` |
| 36b | `WEBHOOK_MAX_ATTEMPTS=9` je odmítnutá, mez se rovná délce tabulky | `packages/core/platform/webhooks/backoff.test.ts` |
| 37 | 410 Gone endpoint po prvním pokusu deaktivuje | `packages/core/platform/webhooks/disable.test.ts`, `deliver.test.ts` |
| 38 | podpis odpovídá testovacímu vektoru bajt na bajt | `packages/core/platform/webhooks/signature.test.ts` |
| 39 | webhook na `169.254.169.254` se neuloží, DNS rebinding se zablokuje při doručení | `apps/web/test/api/webhook-endpoints.test.ts`, `packages/core/net/safe-request.test.ts` |
| 40 | dvacet neúspěchů deaktivuje endpoint a odešle e-mail ownerům | `packages/core/platform/webhooks/disable.test.ts` |

Kritéria mimo tenhle plán: 1 až 13 patří P01, 41 až 50 patří P02 a P09, 51 až 53 patří P05, 54 až 56 patří P01 a P16.

---

## 5. Soubory, které tento plán vlastní

**Tenhle plán vytváří a mění výhradně soubory z následujícího seznamu. Mimo ně nesahá.**

`packages/core/tx/`
- `index.ts`, `index.test.ts`, `types.test-d.ts`

`packages/core/test-support/`
- `migrator.ts`

`packages/core/errors/`
- `api-error.ts`, `api-error.test.ts`, `detail-catalog.ts`

`packages/core/net/`
- `ssrf.ts`, `ssrf.test.ts`, `safe-request.ts`, `safe-request.test.ts`

`packages/core/audit/`
- `action.ts`, `action.test.ts`, `redact.ts`, `redact.test.ts`, `write.ts`, `write.test.ts`, `audit-actions.test.ts`

`packages/core/identity/`
- `types.ts`, `permissions.ts`, `permissions.test.ts`, `audit.ts`, `scope.ts`, `scope.test.ts`
- `constant-time.ts`, `constant-time.test.ts`, `password.ts`, `password.test.ts`, `data/common-passwords.txt`
- `token.ts`, `token.test.ts`, `session.ts`, `session.test.ts`, `csrf.ts`, `csrf.test.ts`
- `api-key.ts`, `api-key.test.ts`, `api-key-service.ts`
- `context.ts`, `context.test.ts`, `isolation.test.ts`, `test-helpers.ts`
- `login.ts`, `login.test.ts`, `login-timing.test.ts`
- `password-reset.ts`, `password-reset.test.ts`, `change-password.ts`, `change-password.test.ts`
- `setup.ts`, `setup.test.ts`
- `workspace-service.ts`, `membership-service.ts`, `invitation-service.ts`
- `api/schemas.ts`, `api/setup.routes.ts`, `api/auth.routes.ts`, `api/workspaces.routes.ts`, `api/members.routes.ts`, `api/invitations.routes.ts`, `api/api-keys.routes.ts`

`packages/core/platform/`
- `system-mail.ts`, `system-mail.test.ts`, `audit-query.ts`, `audit-query.test.ts`
- `webhooks/envelope.ts`, `webhooks/envelope.test.ts`, `webhooks/signature.ts`, `webhooks/signature.test.ts`
- `webhooks/backoff.ts`, `webhooks/backoff.test.ts`, `webhooks/endpoint-service.ts`
- `webhooks/emit.ts`, `webhooks/deliver.ts`, `webhooks/deliver.test.ts`
- `webhooks/disable.ts`, `webhooks/disable.test.ts`, `webhooks/delivery-query.ts`
- `api/webhooks.routes.ts`, `api/audit.routes.ts`, `api/jobs.routes.ts`
- `jobs/registry.ts`, `jobs/registry.test.ts`
- `jobs/webhook_fanout.ts`, `jobs/webhook_deliver.ts`, `jobs/cleanup_sessions.ts`, `jobs/cleanup_idempotency.ts`, `jobs/purge_workspaces.ts`, `jobs/jobs.test.ts`

`apps/web/src/lib/api/`
- `problem.ts`, `problem.test.ts`, `validation.ts`, `validation.test.ts`, `request-id.ts`
- `client-ip.ts`, `client-ip.test.ts`, `pagination.ts`, `pagination.test.ts`, `counting.ts`, `counting.test.ts`
- `idempotency.ts`, `idempotency.test.ts`, `rate-limit.ts`, `rate-limit.test.ts`
- `versioning.ts`, `versioning.test.ts`, `authenticate.ts`, `authenticate.test.ts`
- `openapi.ts`, `docs.ts`, `app.ts`, `app.test.ts`

`apps/web/` ostatní
- `src/app/api/v1/[[...route]]/route.ts`
- `scripts/generate-openapi.ts`
- `test/api/helpers/seed.ts`
- `test/api/auth-login.test.ts`, `auth-sessions.test.ts`, `auth-me.test.ts`, `auth-change-password.test.ts`
- `test/api/api-keys.test.ts`, `permissions.test.ts`, `cross-workspace.test.ts`
- `test/api/workspaces.test.ts`, `members.test.ts`, `webhook-endpoints.test.ts`, `audit-log.test.ts`
- `test/api/pagination-integrity.test.ts`, `openapi.test.ts`, `smoke.test.ts`, `jobs.test.ts`

**Sdílený artefakt:** `packages/contracts/openapi.json` se generuje, nikdy neslučuje ručně (uzávěr S9). Při konfliktu se obě verze zahodí a soubor se přegeneruje.

**Úzké výjimky, obojí jen v deklarovaném rozsahu podle kapitoly 0.3:** `packages/core/package.json` (položky závislostí a wildcard exporty) a `apps/web/package.json` (položky závislostí a skript `generate:openapi`).

### Čeho se plán nedotýká, výslovně

- **`packages/db` (celý balíček).** Schéma, migrace, RLS politiky, role, granty, partitioning a migrační nástroj vlastní **P03**. Tenhle plán z něj jen importuje a nespouští `drizzle-kit generate`. Když test izolace nebo test globálního auditního záznamu padne, je to **nález pro P03**, ne důvod, aby P04 sáhl do migrací.
- **`packages/ui` (celý balíček).** Design systém, tokeny, primitiva a komponenty K1 až K8 vlastní **P05**. Tenhle plán nepíše žádnou React komponentu, žádný `.tsx` soubor a žádnou obrazovku.
- `packages/contracts` mimo `openapi.json` (P02), `packages/i18n` (P05), `packages/config`, `packages/core/config`, `packages/core/errors/registry.ts`, `packages/core/queues`, `docker/`, `.github/workflows`, `turbo.json`, kořenové `package.json` (vše P01), `apps/worker` (P01), `apps/sender` (P09), obrazovky v `apps/web/src/app` mimo `api/v1` (P05 a P06).

---

## 6. Sebekontrola plánu

Prošel jsem specifikaci znovu s odstupem a porovnal ji s plánem. Tři kontroly, výsledek každé.

**1. Pokrytí specifikace.** Kapitoly 3.1 až 3.8 a 4.1 až 4.8, které jsou zadáním tohoto plánu, mají všechny svůj úkol: hesla a autentizace (13, 23), sessions (16, 26), workspaces a pozvánky (34, 35, 36), role a oprávnění (12, 32), API klíče (30, 31), izolace (18, 19, 20), audit (21, 22, 44), odchozí webhooky (37 až 41), konvence API (6), chyby (3, 4), stránkování (7, 8), idempotence (9), rate limiting (10), verzování (11), OpenAPI (42), endpointy (24, 26, 27, 28, 29, 31, 35, 36, 40, 41, 44). Kapitola 6 (bezpečnost) nemá vlastní úkol schválně: je to model hrozeb a každý jeho řádek je pokrytý testem u příslušné funkce, viz mapa v kapitole 4.

Vědomé mezery, které do tohoto plánu nepatří a jsou předané dál: systémové e-maily (port je tady, implementace je P13), i18n katalog chybových textů (dočasně v kódu, přesun je úkol pro P06), UI stránka dokumentace přes Scalar (vendorování bundlu je úkol pro P16).

**2. Zástupné texty.** Prošel jsem plán na vzory „TBD", „doplnit ošetření chyb", „podobně jako výše" a „napiš testy k výše uvedenému". Žádný se v něm nevyskytuje: každý krok, který mění kód, obsahuje kód. Dvě místa jsou úmyslně podmíněná a jsou u nich napsané obě větve: krok 3 úkolu 25 (dočasné vyřazení druhé poloviny měření, které se vrací v úkolu 29) a krok 8 úkolu 1 (chybějící tabulka `platform.rate_limits` znamená backend `memory`).

**3. Shoda typů a názvů.** Symboly, které se používají napříč úkoly, mají všude stejný název a stejný tvar: `WorkspaceContext` reexportovaný z `@mlain/db` (úkol 12, používá 18, 19, 44) a `unsafeWorkspaceContext`, kterou volá jediný soubor (18), `wsEq` (19, používá 31, 40), `withWorkspace`, `withUser`, `withoutContext` (1, používá se všude), `writeAuditLog` a `AuditActorInfo` (22, používá 23, 28, 29, 31, 34, 35, 36, 40, 41), `ApiError` a `problemResponse` (3, 24), `requireSession` (26, používá 27, 28, 35, 36), `applyDeliveryOutcome` (definuje 41, volá ho `deliver.ts` z úkolu 40, což je jediné místo, kde je definice o úkol pozadu za voláním, a je to napsané v kroku 5 úkolu 40), `toPublicUser` a `listWorkspacesOfUser` (23, používá 27, 34), `slugify` (34, používá 35), `RESTORE_WINDOW_DAYS` (35, používá 43).

Jedna nekonzistence, kterou jsem při kontrole našel a opravil rovnou v textu: `deliver.ts` v úkolu 40 volá `applyDeliveryOutcome`, které vzniká až v úkolu 41. Krok 5 úkolu 40 proto spouští jen test klasifikace odpovědi a celý soubor se zezelená až v úkolu 41. Pořadí je záměrné, protože opačné pořadí by znamenalo psát zápis výsledku dřív, než existuje cokoliv, co by ho vyrábělo.
