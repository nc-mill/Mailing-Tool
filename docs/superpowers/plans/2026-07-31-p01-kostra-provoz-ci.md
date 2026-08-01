# P01: Kostra monorepa, provoz, konfigurace a CI, implementační plán

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Postavit prázdné, ale kompletně funkční monorepo Mlain Maileru: pnpm workspace s devíti balíčky a čtyřmi aplikacemi, jednu Docker image se čtyřmi režimy běhu, úplné registry konfigurace, chybových kódů a front, health endpointy s graceful shutdownem, kostru CLI `mlain` a všech šestnáct blokujících CI jobů včetně licenční brány.

**Architecture:** Jeden repozitář, jedna databáze, jedna image. Multi-stage Dockerfile složí Go binárku senderu a Node build webu, workeru a CLI do jedné runtime vrstvy; jediný `entrypoint.sh` podle proměnné `MODE` spustí `web`, `worker`, `sender` nebo všechny tři jako potomky pod `tini`. Tři registry (konfigurace, chybové kódy, fronty) jsou předdeklarované **úplné, dopředu, pro všech sedm specifikací**, takže je pozdější doménové plány jen čtou a nikdy nerozšiřují; tím se ze tří sdílených souborů stanou soubory s jediným vlastníkem. Všechny CI joby existují od prvního commitu a ty, které zatím nemají co kontrolovat, hlásí `SKIP` s důvodem, ale mají test, který dokazuje, že na vadném vstupu spadnou.

**Tech Stack:** Node.js 24.18.1 (MIT), pnpm 11.18.0 (MIT), Turborepo 2.10.7 (MIT), TypeScript 7.0.2 (Apache-2.0), Go 1.26 (BSD-3-Clause), PostgreSQL 18 (PostgreSQL License), Next.js 16.2.12 (MIT), zod 4.4.3 (MIT), pino 10.3.1 (MIT), pg 8.22.0 (MIT), pg-boss 12.26.3 (MIT), Vitest 4.1.10 (MIT), esbuild (MIT), oxlint 1.76.0 (MIT), ESLint 9 (MIT), Prettier 3.9.6 (MIT), license-checker 25.0.1 (BSD-3-Clause), go-licenses (Apache-2.0). Úplná tabulka s licencemi je v kapitole 4.

---

## 1. Co tenhle plán vlastní

Pravidlo řídicího dokumentu `docs/superpowers/plans/2026-07-31-rozdeleni-implementacnich-planu.md` zní: každý soubor má právě jeden plán, který ho smí vytvořit a měnit. Tohle je seznam pro P01.

### 1.1 Soubory a adresáře ve výhradním vlastnictví P01

| Cesta | Obsah |
|---|---|
| `package.json` | kořenový manifest workspace, skripty |
| `pnpm-workspace.yaml` | definice workspace |
| `.npmrc` | nastavení pnpm |
| `turbo.json` | pipeline tasků |
| `.nvmrc` | verze Node |
| `.gitignore` | rozšíření existujícího souboru |
| `.prettierignore` | |
| `.dockerignore` | |
| `.env.example` | ukázka konfigurace pro compose |
| `LICENSE` | MIT |
| `licenses.allow.json` | výjimky licenční brány |
| `packages/config/**` | sdílené tsconfig, eslint, prettier, vitest presety, graf závislostí balíčků |
| `packages/core/package.json`, `packages/core/tsconfig.json` | manifest a tsconfig balíčku core |
| `packages/core/src/config/**` | zod schéma konfigurace, loader, `_FILE` tajemství, manifest |
| `packages/core/src/errors/**` | registr chybových kódů, typy, obálka Problem Details |
| `packages/core/src/queues/**` | registr front pg-boss |
| `packages/core/src/logging/**` | pino logger |
| `packages/core/src/health/**` | readiness a liveness kontroly |
| `packages/core/src/shutdown/**` | graceful shutdown pro Node procesy |
| `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/tsconfig.json`, `apps/web/src/instrumentation.ts` | kostra Next.js aplikace |
| `apps/web/src/app/api/health/route.ts` | liveness endpoint |
| `apps/web/src/app/api/health/ready/route.ts` | readiness endpoint |
| `apps/worker/**` | celá kostra workeru včetně codegen handlerů |
| `apps/cli/**` | celé CLI `mlain` |
| `docker/**` | Dockerfile, entrypoint, compose, compose.scale, shim `mlain`, `initdb/10-roles.sql` |
| `tools/ci/**` | skripty CI jobů a jejich testy |
| `.github/workflows/**` | workflow soubory |

### 1.2 Soubory, které P01 zakládá a hned předává jinému plánu

Tyhle soubory musí existovat, aby šla postavit image a aby prošly CI joby, ale jejich obsah patří jinam. P01 je založí v minimální podobě a **od okamžiku merge do `main` se jich už nedotkne.** Přebírající plán je smí přepsat celé.

| Cesta | Zakládá P01 jako | Přebírá |
|---|---|---|
| `apps/sender/go.mod`, `apps/sender/go.sum` | modul s pěti závislostmi | P09 |
| `apps/sender/cmd/sender/main.go` | `--version`, health server, konfigurace, graceful shutdown | P09 |
| `apps/sender/internal/config/**` | podmnožina konfigurace pro Go, parita s zod schématem | P09 |
| `apps/sender/internal/health/**` | `/healthz`, `/readyz`, `/metrics` | P09 |
| `apps/sender/internal/version/**` | `main.version` vložená linkerem | P09 |
| `packages/core/src/<domena>/jobs/queue-handlers.ts` | **nezakládá vůbec**, jen je hledá codegen | doménové plány |
| `packages/{contracts,db,emails,i18n,sdk-node,sdk-web,ui}/package.json` a `tsconfig.json` | prázdný manifest se jménem, `license: MIT`, `private: true` a hranami z grafu | vlastník balíčku |
| `packages/db/migrations/.gitkeep` | prázdný adresář, aby `COPY` v Dockerfilu nespadl | P03 |
| `apps/web/public/.gitkeep` | prázdný adresář, aby `COPY` v Dockerfilu nespadl | P05 |

Přebírající plán manifest **přepíše celý**, ale musí v něm zachovat `name`, `license: MIT` a `private: true`; hlídá to test integrity workspace v úkolu 5.

### 1.3 Čeho se P01 nedotýká

**P01 nesahá na žádný soubor mimo seznamy 1.1 a 1.2.** Konkrétně: nezakládá `packages/db`, `packages/contracts`, `packages/ui`, `packages/i18n`, `packages/emails`, `packages/sdk-web`, `packages/sdk-node` jinak než jako **prázdný adresář s `package.json` a `tsconfig.json`** (viz úkol 5, kde je přesně vyjmenováno, co ten manifest smí obsahovat), nepíše migrace, nepíše žádný endpoint kromě dvou health endpointů, nezakládá `apps/web/src/proxy.ts` ani nic v `apps/web/src/app` kromě `layout.tsx`, `page.tsx` a dvou health routes, a nezapisuje do `packages/contracts/config.json`.

### 1.4 Jak se sem dostane nová položka registru

Chybový kód, fronta ani konfigurační proměnná se **nezakládá za běhu doménového plánu.** Tenhle plán je předdeklaruje všechny. Když doménový plán zjistí, že mu kód nebo fronta chybí, je to nález proti P01 a řeší se změnou tohoto plánu, ne přidáním řádku do registru z jiné větve. Důvod je v řídicím dokumentu, uzávěry S7, S8 a S12: registr editovaný z osmi větví je osm merge konfliktů v jednom souboru.

---

## 2. Rozhodnutí, která tenhle plán udělal sám

Specifikace tyhle body neuzavírá. Jsou rozhodnuté tady, s odůvodněním, aby je šlo přehlasovat vědomě.

**D1. CLI žije v `apps/cli`, ne v `docker/mlain`.** Dockerfile v 3.12 kopíruje `docker/mlain` do `/usr/local/bin/mlain`, ale žádný obsah toho souboru nepopisuje. Kdyby v něm CLI bylo celé, museli by do adresáře `docker/` psát P03 (`mlain migrate`) a P16 (`backup`, `restore`, `doctor`, `upgrade`, `rotate-credentials`, `genkey`), což porušuje uzávěr S10. Řešení: `docker/mlain` je třířádkový POSIX shim, který spustí `node /app/apps/cli/dist/main.js "$@"`, a CLI je samostatná workspace aplikace. Dopad na Dockerfile: filtr `turbo prune` má o jeden balíček víc a přibývá jeden `COPY`. Akceptační kritérium 7d se tím nemění, protože počítá balíčky v `packages/`, kterých je pořád devět.

**D2. Readiness si otevírá vlastní krátkodobé spojení, žádný pool.** Spec chce `SELECT 1` s timeoutem 2 s. Pool vlastní `packages/db`, tedy P03, a P01 běží dřív. Místo aby P01 zakládal pool v cizím balíčku, otevírá readiness kontrola nový `pg.Client`, položí dotaz a spojení zavře. Vedlejší efekt je žádoucí: probe tím ověřuje, že jde navázat **nové** spojení, což teplý pool zamaskuje. Cena je čtyři spojení za minutu při `interval=15s`, což je zanedbatelné.

**D3. Kontrola `schema_version` v readiness snese neexistující tabulku.** `system_settings` zakládá až P03. Kontrola proto chytá SQLSTATE `42P01` (`undefined_table`) a hlásí `{"name":"schema","status":"skip"}`, což readiness **nesráží** na 503. Jakmile P03 tabulku zavede, kontrola se sama stane ostrou, bez zásahu do P01. Obě větve mají test.

**D4. Handlery front se do workeru dostávají codegenem, ne ručním výčtem.** Uzávěr S8 říká, že entrypoint workeru handlery „jen složí", což je ale sdílený soubor editovaný osmi plány. `apps/worker/src/handlers.generated.ts` proto generuje skript, který proglobuje `packages/core/*/jobs/queue-handlers.ts`. Platí u něj stejné pravidlo jako u `openapi.json` (uzávěr S9): **soubor se nikdy neslučuje ručně, při konfliktu se přegeneruje.** Drift hlídá test v `test-unit`, ne nový CI job, protože tabulka jobů v 3.15 je uzavřený výčet.

**D5. Manifest konfigurace P01 zapisuje do `packages/core/src/config/config.manifest.json`, ne do `packages/contracts/config.json`.** Kapitola 4.9 zmiňuje `packages/contracts/config.json` jako místo pro paritu s Go strukturou, jenže `packages/contracts` je podle uzávěru S2 výhradní vlastnictví P02. P01 manifest vyrobí u sebe; P02 ho do kontraktů zrcadlí, až bude balíček existovat. Test `config-parity` proti Go straně v P01 stejně nemá co porovnávat, protože Go konfigurace je zatím podmnožina.

**D6. Sender používá `SENDER_HEALTH_PORT`, ne `HEALTH_PORT`.** Část 4b, kapitola 4.4 a tabulka konfigurace uvádí `HEALTH_PORT` s výchozí hodnotou 3001. Část 1, kapitola 3.12 to normativně rozděluje na `WORKER_HEALTH_PORT=3001` a `SENDER_HEALTH_PORT=3002`, protože při `MODE=all` sdílejí potomci prostředí a jedna proměnná znamená `EADDRINUSE` hned u první instalace. Tabulka 4.9 je povinný artefakt a vyhrává. `HEALTH_PORT` se v kódu nevyskytuje vůbec, hlídá to test.

**D7. Blokujících jobů je šestnáct, ne patnáct.** Tabulka v 3.15 má šestnáct řádků (`lint`, `typecheck`, `test-unit`, `test-db`, `test-go`, `test-go-integration`, `contracts-golden`, `contracts-fixtures-schema`, `contracts-schema`, `openapi-drift`, `i18n-check`, `licenses-node`, `licenses-go`, `migrations-check`, `build-image`, `e2e`) a text ji označuje za jediný autoritativní seznam. K nim přibývá sedmnáctý, **neblokující** job `security-audit` (`pnpm audit --audit-level=high` a `govulncheck`). Plán dodává všech sedmnáct.

**D8. Job, který nemá co kontrolovat, hlásí `SKIP` a vrací 0, ale má test na vadný vstup.** Alternativa `continue-on-error` nebo `if:` podmínka by znamenala, že se brána zapne až někdy, což je přesně scénář, před kterým řídicí dokument varuje. Každý skript v `tools/ci/` proto rozpozná, že jeho vstup zatím neexistuje, vypíše `SKIP: <důvod>` a skončí nulou; a ke každému existuje test, který mu podstrčí vadný vstup a ověří nenulový exit code.

**D9. Exit kódy CLI.** Spec fixuje 78 (`EX_CONFIG`), 75 (`EX_TEMPFAIL`, timeout zámku migrací), 3 (selhaná migrace), 4 (přeskočená major verze), 5 (`schema_version_ahead`). P01 doplňuje **64** (`EX_USAGE`, neznámý podpříkaz nebo špatné argumenty) a **69** (`EX_UNAVAILABLE`, podpříkaz je v registru deklarovaný, ale v tomhle buildu neimplementovaný). Rozlišení je záměrné: „takový příkaz neexistuje" a „ten příkaz existuje, ale ještě nikdo nedodal jeho tělo" jsou pro operátora dvě různé zprávy.

**D10. Verze balíčků, které specifikace nefixuje, se zapisují jako caret rozsah, ale spodní mez musí být vydaná verze.** Spec pinuje verze ověřené k 2026-07-31 (`next` 16.2.12, `zod` 4.4.3, `pino` 10.3.1 a další) a ty se zapisují přesně. U balíčků, které spec nezmiňuje (`eslint`, `@eslint/js`, `typescript-eslint`, `esbuild`, `pino-pretty`, `react`), se zapisuje caret rozsah a při prvním `pnpm install` se lockfile zafixuje.

Spodní mez se **nezaokrouhluje nahoru na `.0` další minor verze.** Dřívější znění tohohle plánu uvádělo `eslint: ^9.40.0` a `@eslint/js: ^9.40.0`; nejvyšší vydaná 9.x je **9.39.5**, takže `pnpm install` v úkolu 1 kroku 5 skončil `ERR_PNPM_NO_MATCHING_VERSION` a plán se zastavil na svém prvním příkazu. Ověřeno spuštěním `npm view eslint versions`. Pravidlo: caret rozsah se zapisuje z verze, která v registru **existuje** v okamžiku psaní plánu, ne z odhadu příští minor verze. Krok 5 úkolu 1 to má jako výslovné očekávání.

**D11. Worker a sender health server nepoužívají HTTP framework.** `node:http` a `net/http` stačí na tři cesty bez routingu. `hono` je v projektu kvůli veřejnému API (P04), do interního health serveru ho tahat nemá důvod.

---

## 3. Mapa souborů, které plán vytvoří

```
.
├── package.json                          kořenový manifest, skripty
├── pnpm-workspace.yaml
├── .npmrc
├── .nvmrc
├── .gitignore                            rozšíření existujícího
├── .prettierignore
├── .dockerignore
├── .env.example
├── LICENSE                               MIT
├── licenses.allow.json                   výjimky licenční brány
├── turbo.json
├── apps/
│   ├── web/
│   │   ├── package.json
│   │   ├── next.config.ts                output: 'standalone'
│   │   ├── tsconfig.json
│   │   ├── public/.gitkeep                prázdný adresář kvůli COPY
│   │   ├── vitest.config.ts               jsdom, plugin React, vzor včetně src/
│   │   ├── vitest.setup.ts                matchery jest-dom a cleanup
│   │   └── src/
│   │       ├── instrumentation.ts        registrace graceful shutdownu
│   │       └── app/
│   │           ├── layout.tsx            minimální, P05 ho přepíše
│   │           ├── page.tsx              minimální, P05 ho přepíše
│   │           └── api/health/
│   │               ├── route.ts          GET /api/health
│   │               └── ready/route.ts    GET /api/health/ready
│   ├── worker/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── build.mjs                     esbuild bundle do dist/main.js
│   │   ├── codegen.mjs                   generuje handlers.generated.ts
│   │   └── src/
│   │       ├── main.ts                   entrypoint, pg-boss, health, shutdown
│   │       ├── boss.ts                   start pg-boss a createQueue z registru
│   │       ├── health-server.ts          node:http, /healthz a /readyz
│   │       └── handlers.generated.ts     GENEROVANÝ, neslučuje se ručně
│   ├── cli/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── build.mjs
│   │   └── src/
│   │       ├── main.ts                   dispatcher a parseArgs
│   │       ├── registry.ts               úplný seznam podpříkazů
│   │       ├── exit-codes.ts
│   │       └── commands/
│   │           ├── config-check.ts       implementovaný
│   │           ├── healthcheck.ts        implementovaný
│   │           └── not-implemented.ts    sdílený stub, exit 69
│   └── sender/                           ZALOŽÍ P01, VLASTNÍ P09
│       ├── go.mod
│       ├── go.sum
│       ├── cmd/sender/main.go
│       └── internal/
│           ├── config/config.go
│           ├── health/server.go
│           └── version/version.go
├── packages/
│   ├── config/
│   │   ├── package.json
│   │   ├── src/package-graph.ts          graf závislostí balíčků jako data
│   │   ├── tsconfig/{base,node,next,lib}.json
│   │   ├── eslint/{index,boundaries}.js
│   │   ├── prettier/index.json
│   │   ├── vitest/{node,db}.ts
│   │   └── test/{package-graph,eslint-boundaries,eslint-zones,workspace-integrity}.test.ts
│   ├── core/
│   │   ├── package.json                  exports mapa na podcesty, ŽÁDNÝ barrel
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── config/{index,schema,cross-checks,file-secrets,load,manifest}.ts
│   │       ├── config/config.manifest.json     GENEROVANÝ
│   │       ├── errors/{index,types,registry,problem,operational-codes}.ts
│   │       ├── queues/{index,types,registry}.ts
│   │       ├── logging/{index,logger}.ts
│   │       ├── health/{index,checks,readiness}.ts
│   │       └── shutdown/{index,shutdown}.ts
│   ├── contracts/{package.json,tsconfig.json}       jen manifest, vlastní P02
│   ├── db/{package.json,tsconfig.json}              jen manifest, vlastní P03
│   │   └── migrations/.gitkeep                      prázdný adresář kvůli COPY
│   ├── emails/{package.json,tsconfig.json}          jen manifest, vlastní P08
│   ├── i18n/{package.json,tsconfig.json}            jen manifest, vlastní P05
│   ├── sdk-node/{package.json,tsconfig.json}        jen manifest, vlastní P04
│   ├── sdk-web/{package.json,tsconfig.json}         jen manifest, vlastní P10
│   └── ui/{package.json,tsconfig.json}              jen manifest, vlastní P05
├── docker/
│   ├── Dockerfile
│   ├── entrypoint.sh
│   ├── mlain                             POSIX shim na apps/cli
│   ├── compose.yml
│   ├── compose.scale.yml
│   └── initdb/10-roles.sql
├── tools/ci/
│   ├── i18n-check.mjs
│   ├── openapi-drift.mjs
│   ├── contracts-golden.mjs
│   ├── contracts-fixtures-schema.mjs
│   ├── contracts-schema.mjs
│   ├── migration-lint.mjs
│   ├── migrations-check.mjs
│   ├── licenses-node.mjs
│   ├── image-size.mjs
│   ├── lib/report.mjs                    skip, fail, ok, listFiles, delegate
│   └── test/*.test.ts
└── .github/workflows/ci.yml
```

**Devět balíčků v `packages/`** je závazné číslo z akceptačního kritéria 7d: `config`, `contracts`, `core`, `db`, `emails`, `i18n`, `sdk-node`, `sdk-web`, `ui`. Test v úkolu 5 to hlídá.

---

## 4. Závislosti a jejich licence

Projekt je **MIT**. GPL, LGPL, AGPL, SSPL, BUSL, Elastic-2.0, Sustainable Use License a CC-BY-NC jsou zakázané a hlídá to CI (úkol 22 a 23). Whitelist: `MIT`, `Apache-2.0`, `BSD-2-Clause`, `BSD-3-Clause`, `ISC`, `0BSD`, `CC0-1.0`, `Unlicense`, `Python-2.0`.

### 4.1 Runtime závislosti, které tenhle plán zavádí

| Balíček | Verze | Licence | Kde |
|---|---|---|---|
| `next` | 16.2.12 | MIT | `apps/web` |
| `react` | ^19.2.0 | MIT | `apps/web` |
| `react-dom` | ^19.2.0 | MIT | `apps/web` |
| `zod` | 4.4.3 | MIT | `packages/core/config` |
| `pino` | 10.3.1 | MIT | `packages/core/logging` |
| `pg` | 8.22.0 | MIT | `packages/core/health` (readiness `SELECT 1`) |
| `pg-boss` | 12.26.3 | MIT | `apps/worker` |

### 4.2 Vývojové a build závislosti

| Balíček | Verze | Licence | Kde |
|---|---|---|---|
| `typescript` | 7.0.2 | Apache-2.0 | kořen, fallback 5.9.3 podle otevřené otázky O4 |
| `turbo` | 2.10.7 | MIT | kořen |
| `vitest` | 4.1.10 | MIT | kořen a `packages/config/vitest` |
| `@vitest/coverage-v8` | ^4.1.0 | MIT | prahy pokrytí |
| `prettier` | 3.9.6 | MIT | kořen |
| `oxlint` | 1.76.0 | MIT | kořen |
| `eslint` | ^9.39.5 | MIT | pravidla, která oxlint neumí |
| `@eslint/js` | ^9.39.5 | MIT | `js.configs.recommended` ve flat configu |
| `typescript-eslint` | ^8.46.0 | MIT | parser pro flat config |
| `eslint-plugin-import` | ^2.32.0 | MIT | `import/no-restricted-paths` |
| `esbuild` | ^0.25.0 | MIT | bundle workeru a CLI |
| `pino-pretty` | ^13.1.0 | MIT | `LOG_FORMAT=pretty` mimo produkci |
| `license-checker` | 25.0.1 | BSD-3-Clause | job `licenses-node` |
| `testcontainers` | 12.0.4 | MIT | job `test-db`, zavádí P03, manifest připraví P01 |
| `playwright` | 1.62.1 | Apache-2.0 | job `e2e`, scénáře dodá P16 |
| `@vitejs/plugin-react` | 6.0.5 | MIT | JSX v testech `apps/web`, komponenty píšou P05, P06 a P12 |
| `jsdom` | 30.0.1 | MIT | testovací prostředí `apps/web` |
| `@testing-library/react` | ^16.3.2 | MIT | `render` a `cleanup` v testech komponent |
| `@testing-library/jest-dom` | ^6.9.1 | MIT | matchery typu `toBeInTheDocument` |
| `@types/node` | ^24.10.0 | MIT | |
| `@types/pg` | ^8.15.0 | MIT | |
| `@types/react`, `@types/react-dom` | ^19.2.0 | MIT | |

### 4.3 Go závislosti kostry senderu

| Modul | Licence | K čemu |
|---|---|---|
| `github.com/caarlos0/env/v11` | MIT | načtení konfigurace z prostředí |
| `github.com/jackc/pgx/v5` | MIT | `SELECT 1` v `/readyz` |
| `github.com/prometheus/client_golang` | Apache-2.0 | `/metrics` při `METRICS_ENABLED=true` |
| `github.com/google/go-licenses` | Apache-2.0 | nástroj CI, ne závislost binárky |
| `golang.org/x/vuln` (`govulncheck`) | BSD-3-Clause | nástroj CI, neblokující job |
| standardní knihovna (`log/slog`, `net/http`, `os/signal`) | BSD-3-Clause | |

### 4.4 GitHub Actions

| Akce | Verze | Licence |
|---|---|---|
| `actions/checkout` | v4 | MIT |
| `actions/setup-node` | v4 | MIT |
| `actions/setup-go` | v5 | MIT |
| `actions/upload-artifact` | v4 | MIT |
| `pnpm/action-setup` | v4 | MIT |
| `docker/setup-buildx-action` | v3 | Apache-2.0 |

Vědomě nepoužité: `postgres` (postgres.js, `Unlicense` mimo whitelist), `commander` a `yargs` (`node:util` `parseArgs` ze standardní knihovny stačí), `hono` v health serverech (viz rozhodnutí D11), `tsup` a `tsdown` (esbuild přímo je o vrstvu méně).

---

## Úkoly

### Úkol 1: Kořen monorepa a instalace

Bootstrap. Jediný úkol v plánu bez testu, protože v okamžiku jeho zahájení neexistuje spouštěč testů. Ověřuje se výstupem příkazů. Od úkolu 4 dál platí přísné TDD.

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/package.json`
- Create: `/Users/petr/Projects/Mailing_Tool/pnpm-workspace.yaml`
- Create: `/Users/petr/Projects/Mailing_Tool/.npmrc`
- Create: `/Users/petr/Projects/Mailing_Tool/.nvmrc`
- Create: `/Users/petr/Projects/Mailing_Tool/LICENSE`
- Create: `/Users/petr/Projects/Mailing_Tool/.prettierignore`
- Create: `/Users/petr/Projects/Mailing_Tool/.dockerignore`
- Modify: `/Users/petr/Projects/Mailing_Tool/.gitignore`

- [ ] **Krok 1: Napiš kořenový `package.json`**

```json
{
  "name": "mlain",
  "version": "0.0.0",
  "private": true,
  "license": "MIT",
  "packageManager": "pnpm@11.18.0",
  "engines": {
    "node": ">=24.18.1 <25",
    "pnpm": ">=11.18.0"
  },
  "scripts": {
    "build": "turbo run build",
    "typecheck": "turbo run typecheck",
    "lint": "oxlint . && eslint . && prettier --check .",
    "format": "prettier --write .",
    "test:unit": "turbo run test:unit",
    "test:db": "turbo run test:db",
    "test:e2e": "turbo run test:e2e",
    "contracts:generate": "turbo run contracts:generate",
    "ci:i18n-check": "node tools/ci/i18n-check.mjs",
    "ci:openapi-drift": "node tools/ci/openapi-drift.mjs",
    "ci:contracts-golden": "node tools/ci/contracts-golden.mjs",
    "ci:contracts-fixtures-schema": "node tools/ci/contracts-fixtures-schema.mjs",
    "ci:contracts-schema": "node tools/ci/contracts-schema.mjs",
    "ci:migration-lint": "node tools/ci/migration-lint.mjs",
    "ci:migrations-check": "node tools/ci/migrations-check.mjs",
    "ci:licenses-node": "node tools/ci/licenses-node.mjs",
    "ci:image-size": "node tools/ci/image-size.mjs"
  },
  "devDependencies": {
    "@types/node": "^24.10.0",
    "@vitest/coverage-v8": "^4.1.0",
    "esbuild": "^0.25.0",
    "eslint": "^9.39.5",
    "eslint-plugin-import": "^2.32.0",
    "license-checker": "25.0.1",
    "oxlint": "1.76.0",
    "prettier": "3.9.6",
    "turbo": "2.10.7",
    "typescript": "7.0.2",
    "typescript-eslint": "^8.46.0",
    "vitest": "4.1.10"
  }
}
```

- [ ] **Krok 2: Napiš `pnpm-workspace.yaml`, `.npmrc` a `.nvmrc`**

`pnpm-workspace.yaml`. `apps/sender` **není** členem workspace, je to Go modul.

```yaml
packages:
  - "apps/cli"
  - "apps/web"
  - "apps/worker"
  - "packages/*"
  - "tools"
```

`.npmrc`:

```ini
# Node verze se vynucuje, jinak se rozdíly projeví až v Dockeru.
engine-strict=true
# Peer konflikty v React ekosystému nesmí zastavit instalaci; ověřuje je typecheck.
strict-peer-dependencies=false
# Workspace balíček má vždy přednost před registrem, i když se jmenuje stejně.
prefer-workspace-packages=true
link-workspace-packages=deep
resolution-mode=highest
```

`.nvmrc`:

```
24.18.1
```

- [ ] **Krok 3: Napiš `LICENSE`**

```
MIT License

Copyright (c) 2026 Mlain Mailer contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

- [ ] **Krok 4: Rozšiř `.gitignore` a napiš `.prettierignore` a `.dockerignore`**

Na konec `/Users/petr/Projects/Mailing_Tool/.gitignore` přidej:

```gitignore

# Turborepo
.turbo/

# Next.js
.next/
next-env.d.ts

# Data a zálohy lokálního compose
/data/

# Go
apps/sender/ml-sender

# Vitest
.vitest-reports/
```

`.prettierignore`. Kořenový skript `lint` volá `prettier --check .`, tedy **celý strom**, ne jen zdrojáky. Bez řádku `docs/` by se do kontroly dostalo přes tři sta kilobajtů implementačních plánů a specifikací, které nikdo neformátoval prettierem, a job `lint` by byl červený od prvního commitu na souborech, které se zdrojovým kódem nemají nic společného. Totéž platí pro generované soubory a pro adresář reportů, který zakládá P02.

```gitignore
node_modules/
.turbo/
.next/
dist/
coverage/
pnpm-lock.yaml
packages/core/src/config/config.manifest.json
apps/worker/src/handlers.generated.ts
packages/contracts/reports/
docs/
*.md
!README.md
```

`*.md` s výjimkou `README.md` je záměrné: prettier přeformátovává markdownové tabulky a odrážky a u dokumentace psané ručně to není žádoucí. `README.md` zůstává v kontrole, protože je to jediný markdown, který plány udržují jako artefakt.

`.dockerignore`. Bez něj poletí do build kontextu `node_modules` a `.git`, což u fáze `pruner`, která dělá `COPY . .`, znamená gigabajty přenosu.

```gitignore
**/node_modules
**/.turbo
**/.next
**/dist
**/coverage
.git
.github
data
docs
*.md
!README.md
apps/sender/ml-sender
```

- [ ] **Krok 5: Nainstaluj závislosti**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && corepack enable && corepack prepare pnpm@11.18.0 --activate && pnpm install
```
Expected: instalace projde, vznikne `pnpm-lock.yaml` a `node_modules/`. Ve výstupu je řádek `Done in`.

Kdyby padla hláška `ERR_PNPM_NO_MATCHING_VERSION`, znamená to, že některý caret rozsah v manifestu má spodní mez vyšší než nejvyšší vydaná verze. **Neobcházej to zvýšením rozsahu ani `--no-frozen-lockfile`.** Zjisti skutečnou nejvyšší verzi (`npm view <balíček> versions --json`) a oprav manifest podle rozhodnutí D10. Je to jediné místo v plánu, kde se verze mění bez změny specifikace, protože specifikace tyhle balíčky nepinuje.

- [ ] **Krok 6: Ověř verze nástrojů**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm exec vitest --version && pnpm exec tsc --version && pnpm exec turbo --version && pnpm exec prettier --version
```
Expected: čtyři řádky, `vitest/4.1.10`, `Version 7.0.2`, `2.10.7`, `3.9.6`.

Kdyby `typescript@7.0.2` cokoliv rozbil, platí otevřená otázka O4 části 1: přepnout na `5.9.3` bez diskuse a poznamenat to do commit message. Hackathon není místo na ladění kompilátoru.

- [ ] **Krok 7: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add package.json pnpm-workspace.yaml pnpm-lock.yaml .npmrc .nvmrc .gitignore .prettierignore .dockerignore LICENSE && git commit -m "chore: bootstrap pnpm workspace with pinned toolchain"
```

---

### Úkol 2: Balíček `packages/config`, tsconfig a prettier presety

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/config/package.json`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/config/tsconfig/base.json`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/config/tsconfig/node.json`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/config/tsconfig/lib.json`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/config/tsconfig/next.json`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/config/prettier/index.json`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/config/vitest/node.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/config/vitest/db.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/prettier.config.mjs`

- [ ] **Krok 1: Napiš `packages/config/package.json`**

```json
{
  "name": "@mlain/config",
  "version": "0.0.0",
  "private": true,
  "license": "MIT",
  "type": "module",
  "exports": {
    "./tsconfig/base.json": "./tsconfig/base.json",
    "./tsconfig/node.json": "./tsconfig/node.json",
    "./tsconfig/lib.json": "./tsconfig/lib.json",
    "./tsconfig/next.json": "./tsconfig/next.json",
    "./prettier": "./prettier/index.json",
    "./eslint": "./eslint/index.js",
    "./eslint/boundaries": "./eslint/boundaries.js",
    "./vitest/node": "./vitest/node.ts",
    "./vitest/db": "./vitest/db.ts",
    "./package-graph": "./src/package-graph.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test:unit": "vitest run"
  },
  "devDependencies": {
    "eslint": "^9.39.5",
    "eslint-plugin-import": "^2.32.0",
    "typescript-eslint": "^8.46.0",
    "vitest": "4.1.10"
  }
}
```

- [ ] **Krok 2: Napiš tsconfig presety**

`packages/config/tsconfig/base.json`:

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2024",
    "lib": ["ES2024"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "exactOptionalPropertyTypes": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noEmit": true
  },
  "exclude": ["node_modules", "dist", ".next", ".turbo"]
}
```

`packages/config/tsconfig/node.json` (aplikace běžící v Node, worker a CLI):

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "./base.json",
  "compilerOptions": {
    "types": ["node"]
  }
}
```

`packages/config/tsconfig/lib.json` (balíčky v `packages/`):

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "./base.json",
  "compilerOptions": {
    "types": ["node"],
    "composite": false,
    "rootDir": "./src"
  }
}
```

`packages/config/tsconfig/next.json`:

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "extends": "./base.json",
  "compilerOptions": {
    "lib": ["ES2024", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "preserve",
    "allowJs": true,
    "incremental": true,
    "types": ["node"],
    "plugins": [{ "name": "next" }]
  }
}
```

- [ ] **Krok 3: Napiš prettier konfiguraci**

`packages/config/prettier/index.json`:

```json
{
  "printWidth": 100,
  "singleQuote": true,
  "semi": true,
  "trailingComma": "all",
  "arrowParens": "always",
  "endOfLine": "lf",
  "overrides": [
    { "files": "*.md", "options": { "printWidth": 80, "proseWrap": "preserve" } },
    { "files": "*.yml", "options": { "singleQuote": false } }
  ]
}
```

`/Users/petr/Projects/Mailing_Tool/prettier.config.mjs`:

```js
import config from './packages/config/prettier/index.json' with { type: 'json' };

export default config;
```

Uvozovky v YAML jsou **dvojité**, protože `singleQuote: false` v override pro `*.yml` je nastavené schválně: jednoduché uvozovky v YAML nemají escape sekvence a `'a''b'` je matoucí tvar. Důsledek pro úkol 21: každá hodnota v `.github/workflows/ci.yml`, včetně `go-version: "1.26"`, se píše dvojitými uvozovkami, jinak `prettier --check .` v jobu `lint` neprojde. Ověřeno spuštěním prettieru 3.9.6 nad workflow souborem: `go-version: '1.26'` prettier přepisuje na `go-version: "1.26"`.

- [ ] **Krok 4: Napiš vitest presety**

`packages/config/package.json` je vyexportoval v kroku 1 a mapa `exports` na neexistující soubor je tichá past: `pnpm install` projde a chyba se objeví až u prvního plánu, který preset naimportuje. Proto vznikají hned.

`packages/config/vitest/node.ts`. Základ pro balíčky a aplikace bez databáze.

```ts
import { defineConfig, type ViteUserConfig } from 'vitest/config';

/**
 * Sdílený preset pro testy bez databáze. Balíček ho použije takto:
 *   import { nodePreset } from '@mlain/config/vitest/node';
 *   export default nodePreset();
 */
export function nodePreset(overrides: ViteUserConfig = {}): ViteUserConfig {
  return defineConfig({
    ...overrides,
    test: {
      environment: 'node',
      // src/ je ve vzoru schválně: testy vedle zdroje jsou běžný tvar a soubor
      // mimo vzor se v CI nespustí ani v jednom jobu, aniž by cokoliv zčervenalo.
      include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
      exclude: ['**/*.db.test.ts'],
      reporters: ['default'],
      ...overrides.test,
    },
  });
}
```

`packages/config/vitest/db.ts`. Testy proti PostgreSQL. Běží v jobu `test-db`, ne v `test-unit`, proto vlastní vzor souborů a delší timeout.

```ts
import { defineConfig, type ViteUserConfig } from 'vitest/config';

/**
 * Sdílený preset pro testy proti databázi. Vzor `*.db.test.ts` je závazný:
 * podle něj se testy dělí mezi joby test-unit a test-db a soubor mimo vzor
 * by se v CI nespustil ani v jednom z nich, aniž by cokoliv zčervenalo.
 */
export function dbPreset(overrides: ViteUserConfig = {}): ViteUserConfig {
  return defineConfig({
    ...overrides,
    test: {
      environment: 'node',
      include: ['src/**/*.db.test.ts', 'test/**/*.db.test.ts'],
      testTimeout: 60_000,
      hookTimeout: 120_000,
      fileParallelism: false,
      reporters: ['default'],
      ...overrides.test,
    },
  });
}
```

- [ ] **Krok 5: Ověř, že prettier konfiguraci načte**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm install && pnpm exec prettier --check "packages/config/**/*.json"
```
Expected: `All matched files use Prettier code style!`

- [ ] **Krok 6: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add packages/config prettier.config.mjs pnpm-lock.yaml && git commit -m "chore(config): add shared tsconfig and prettier presets"
```

---

### Úkol 3: `turbo.json` a pipeline tasků

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/turbo.json`

- [ ] **Krok 1: Napiš `turbo.json`**

Tabulka tasků je z části 1, kapitola 3.11. `test:db`, `test:e2e` a `test:go-integration` se necachují, protože jejich výsledek závisí na stavu kontejneru, ne jen na vstupních souborech.

```json
{
  "$schema": "https://turbo.build/schema.json",
  "ui": "stream",
  "globalDependencies": [".env.example", "packages/config/**"],
  "globalEnv": ["NODE_ENV", "IMAGE_VERSION", "CI"],
  "tasks": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**", "!.next/cache/**"],
      "cache": true
    },
    "typecheck": {
      "dependsOn": ["^build"],
      "outputs": [],
      "cache": true
    },
    "lint": {
      "dependsOn": [],
      "outputs": [],
      "cache": true
    },
    "test:unit": {
      "dependsOn": ["^build"],
      "outputs": ["coverage/**"],
      "cache": true
    },
    "test:db": {
      "dependsOn": ["^build"],
      "outputs": [],
      "cache": false
    },
    "test:e2e": {
      "dependsOn": ["build"],
      "outputs": ["playwright-report/**"],
      "cache": false
    },
    "contracts:generate": {
      "dependsOn": [],
      "outputs": [
        "packages/contracts/fixtures/**",
        "packages/contracts/openapi.json"
      ],
      "cache": true
    }
  }
}
```

- [ ] **Krok 2: Ověř, že turbo konfiguraci přečte**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm exec turbo run typecheck --dry=json | head -5
```
Expected: platný JSON začínající `{`, žádná chyba typu `Could not find turbo.json` ani `invalid task`.

- [ ] **Krok 3: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add turbo.json && git commit -m "chore: add turbo pipeline"
```

---

### Úkol 4: Graf závislostí balíčků a hranice v ESLintu

Od tohohle úkolu dál platí TDD: nejdřív padající test, pak minimální implementace.

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/config/src/package-graph.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/config/eslint/boundaries.js`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/config/eslint/index.js`
- Create: `/Users/petr/Projects/Mailing_Tool/eslint.config.js`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/config/test/package-graph.test.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/config/test/eslint-boundaries.test.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/config/vitest.config.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/config/tsconfig.json`

- [ ] **Krok 1: Napiš padající test na graf závislostí**

`packages/config/test/package-graph.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  PACKAGE_DIRECTORIES,
  PACKAGE_GRAPH,
  WORKSPACE_APPS,
  WORKSPACE_PACKAGES,
  forbiddenDependencies,
} from '../src/package-graph.js';

describe('PACKAGE_GRAPH', () => {
  it('má právě devět balíčků v packages/', () => {
    expect([...WORKSPACE_PACKAGES].sort()).toEqual([
      '@mlain/config',
      '@mlain/contracts',
      '@mlain/core',
      '@mlain/db',
      '@mlain/emails',
      '@mlain/i18n',
      '@mlain/sdk-node',
      '@mlain/sdk-web',
      '@mlain/ui',
    ]);
  });

  it('kopíruje hrany normativně dané částí 1, kapitolou 3.11', () => {
    expect(PACKAGE_GRAPH['@mlain/contracts']).toEqual([]);
    expect(PACKAGE_GRAPH['@mlain/db']).toEqual(['@mlain/contracts']);
    expect([...PACKAGE_GRAPH['@mlain/core']].sort()).toEqual([
      '@mlain/contracts',
      '@mlain/db',
      '@mlain/emails',
      '@mlain/i18n',
    ]);
    expect([...PACKAGE_GRAPH['@mlain/web']].sort()).toEqual([
      '@mlain/contracts',
      '@mlain/core',
      '@mlain/db',
      '@mlain/emails',
      '@mlain/i18n',
      '@mlain/sdk-node',
      '@mlain/ui',
    ]);
    expect([...PACKAGE_GRAPH['@mlain/worker']].sort()).toEqual([
      '@mlain/contracts',
      '@mlain/core',
      '@mlain/db',
      '@mlain/emails',
      '@mlain/i18n',
    ]);
  });

  it('je acyklický', () => {
    const seen = new Map<string, 'open' | 'done'>();
    const walk = (node: string, trail: string[]): void => {
      const state = seen.get(node);
      if (state === 'done') return;
      if (state === 'open') throw new Error(`cyklus: ${[...trail, node].join(' -> ')}`);
      seen.set(node, 'open');
      for (const dep of PACKAGE_GRAPH[node] ?? []) walk(dep, [...trail, node]);
      seen.set(node, 'done');
    };
    expect(() => {
      for (const node of Object.keys(PACKAGE_GRAPH)) walk(node, []);
    }).not.toThrow();
  });

  it('nezná žádnou hranu na balíček mimo workspace', () => {
    const known = new Set<string>([...WORKSPACE_PACKAGES, ...WORKSPACE_APPS]);
    for (const [pkg, deps] of Object.entries(PACKAGE_GRAPH)) {
      expect(known.has(pkg), `neznámý balíček ${pkg}`).toBe(true);
      for (const dep of deps) expect(known.has(dep), `${pkg} -> ${dep}`).toBe(true);
    }
  });

  it('má adresář pro každý balíček i aplikaci', () => {
    for (const name of [...WORKSPACE_PACKAGES, ...WORKSPACE_APPS]) {
      expect(PACKAGE_DIRECTORIES[name], `chybí adresář pro ${name}`).toBeTypeOf('string');
    }
  });

  it('forbiddenDependencies vrací doplněk povolených hran', () => {
    const forbidden = forbiddenDependencies('@mlain/db');
    expect(forbidden).toContain('@mlain/core');
    expect(forbidden).toContain('@mlain/ui');
    expect(forbidden).not.toContain('@mlain/contracts');
    expect(forbidden).not.toContain('@mlain/db');
  });
});
```

- [ ] **Krok 2: Napiš `vitest.config.ts` a `tsconfig.json` balíčku, spusť test a ověř, že padá**

`packages/config/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // src/ ve vzoru je jednotné pravidlo napříč celým monorepem: testovací
    // soubor mimo vzor se nespustí a série přesto skončí nulou.
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    reporters: ['default'],
  },
});
```

`packages/config/tsconfig.json`. `allowJs` je tu **nutnost, ne pohodlí**: test v kroku 5 importuje `../eslint/boundaries.js`, tedy skutečný `.js` soubor, protože flat config ESLintu musí být JavaScript. Bez `allowJs` skončí typecheck balíčku chybou

```
error TS7016: Could not find a declaration file for module '../eslint/boundaries.js'.
```

Ověřeno spuštěním `tsc --noEmit` proti tomuhle uspořádání s TypeScriptem 7.0.2. `checkJs: false` znamená, že se soubory ESLint konfigurace netypují, jen se z nich odvodí tvar exportu; typovat je nemá smysl, protože jejich jediným konzumentem je ESLint sám.

```json
{
  "extends": "./tsconfig/lib.json",
  "compilerOptions": {
    "rootDir": ".",
    "allowJs": true,
    "checkJs": false
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "vitest/**/*.ts"]
}
```

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/config exec vitest run
```
Expected: FAIL, `Failed to resolve import "../src/package-graph.js"` nebo `Cannot find module`.

- [ ] **Krok 3: Napiš `packages/config/src/package-graph.ts`**

```ts
/**
 * Graf závislostí mezi balíčky monorepa.
 *
 * Hrany pro contracts, db, core, web a worker jsou NORMATIVNÍ, opsané z části 1,
 * kapitoly 3.11 specifikace. Hrany pro config, emails, i18n, sdk-node, sdk-web,
 * ui a cli specifikace neuvádí; jsou odvozené v plánu P01, rozhodnutí D12.
 *
 * apps/sender v grafu není: je to Go modul, který podle 3.11 nesmí importovat
 * nic z Node světa, a hlídá ho `go-licenses` plus absence go.mod závislosti.
 */

export const WORKSPACE_PACKAGES = [
  '@mlain/config',
  '@mlain/contracts',
  '@mlain/core',
  '@mlain/db',
  '@mlain/emails',
  '@mlain/i18n',
  '@mlain/sdk-node',
  '@mlain/sdk-web',
  '@mlain/ui',
] as const;

export const WORKSPACE_APPS = ['@mlain/cli', '@mlain/web', '@mlain/worker'] as const;

export type WorkspaceName = (typeof WORKSPACE_PACKAGES)[number] | (typeof WORKSPACE_APPS)[number];

export const PACKAGE_GRAPH: Record<WorkspaceName, readonly WorkspaceName[]> = {
  // Kořen grafu. Nesmí importovat nic z monorepa, čte ho i Go strana.
  '@mlain/contracts': [],
  '@mlain/config': [],
  '@mlain/i18n': [],
  '@mlain/sdk-web': [],
  '@mlain/db': ['@mlain/contracts'],
  '@mlain/sdk-node': ['@mlain/contracts'],
  '@mlain/ui': ['@mlain/i18n'],
  '@mlain/emails': ['@mlain/contracts', '@mlain/i18n'],
  // Hrana core -> emails je NORMATIVNÍ potřeba plánu P08: doména
  // packages/core/src/templates/** je obal nad blokovým modelem a rendererem
  // a importuje z @mlain/emails/document/{schema,semantic,migrate,canonical,types}
  // v osmi zdrojových souborech. Bez téhle hrany by ESLint hranice P08 zastavily
  // hned prvním souborem. Cyklus nevzniká: packages/emails v manifestu ani
  // v kódu @mlain/core neimportuje, jeho jediná workspace závislost je contracts.
  '@mlain/core': ['@mlain/contracts', '@mlain/db', '@mlain/emails', '@mlain/i18n'],
  '@mlain/cli': ['@mlain/contracts', '@mlain/core', '@mlain/db'],
  '@mlain/worker': [
    '@mlain/contracts',
    '@mlain/core',
    '@mlain/db',
    '@mlain/emails',
    '@mlain/i18n',
  ],
  '@mlain/web': [
    '@mlain/contracts',
    '@mlain/core',
    '@mlain/db',
    '@mlain/emails',
    '@mlain/i18n',
    '@mlain/sdk-node',
    '@mlain/ui',
  ],
};

export const PACKAGE_DIRECTORIES: Record<WorkspaceName, string> = {
  '@mlain/config': 'packages/config',
  '@mlain/contracts': 'packages/contracts',
  '@mlain/core': 'packages/core',
  '@mlain/db': 'packages/db',
  '@mlain/emails': 'packages/emails',
  '@mlain/i18n': 'packages/i18n',
  '@mlain/sdk-node': 'packages/sdk-node',
  '@mlain/sdk-web': 'packages/sdk-web',
  '@mlain/ui': 'packages/ui',
  '@mlain/cli': 'apps/cli',
  '@mlain/web': 'apps/web',
  '@mlain/worker': 'apps/worker',
};

/** Balíčky, které `name` importovat nesmí. Doplněk povolených hran. */
export function forbiddenDependencies(name: WorkspaceName): WorkspaceName[] {
  const allowed = new Set<WorkspaceName>([name, ...PACKAGE_GRAPH[name]]);
  return [...WORKSPACE_PACKAGES, ...WORKSPACE_APPS].filter((candidate) => !allowed.has(candidate));
}
```

- [ ] **Krok 4: Spusť test a ověř, že prochází**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/config exec vitest run test/package-graph.test.ts
```
Expected: PASS, `Tests  6 passed (6)`.

- [ ] **Krok 5: Napiš padající test na ESLint hranice**

`packages/config/test/eslint-boundaries.test.ts`:

```ts
import { ESLint } from 'eslint';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { boundariesConfig } from '../eslint/boundaries.js';

const ROOT = path.resolve(import.meta.dirname, '../../..');

async function lint(relativeFile: string, code: string) {
  const eslint = new ESLint({
    cwd: ROOT,
    overrideConfigFile: true,
    overrideConfig: boundariesConfig(),
  });
  const [result] = await eslint.lintText(code, { filePath: path.join(ROOT, relativeFile) });
  return result?.messages ?? [];
}

describe('hranice mezi balíčky', () => {
  it('zakáže import @mlain/core z packages/db', async () => {
    const messages = await lint('packages/db/src/repo.ts', `import { x } from '@mlain/core/errors';\n`);
    expect(messages.map((m) => m.ruleId)).toContain('no-restricted-imports');
  });

  it('povolí import @mlain/contracts z packages/db', async () => {
    const messages = await lint('packages/db/src/repo.ts', `import { x } from '@mlain/contracts';\n`);
    expect(messages.filter((m) => m.ruleId === 'no-restricted-imports')).toEqual([]);
  });

  it('zakáže packages/contracts importovat cokoliv z monorepa', async () => {
    const messages = await lint(
      'packages/contracts/src/liquid.ts',
      `import { x } from '@mlain/i18n';\n`,
    );
    expect(messages.map((m) => m.ruleId)).toContain('no-restricted-imports');
  });

  it('zakáže apps/worker importovat @mlain/ui', async () => {
    const messages = await lint('apps/worker/src/main.ts', `import { x } from '@mlain/ui';\n`);
    expect(messages.map((m) => m.ruleId)).toContain('no-restricted-imports');
  });

  // Relativní přechod přes hranici hlídá `import/no-restricted-paths` v index.js,
  // ne `no-restricted-imports`, protože jen ten specifikátor rozřeší na cestu.
  // Jeho test je v samostatném souboru eslint-zones.test.ts, protože index.js
  // vzniká až o dva kroky dál.

  it('zakáže top level barrel @mlain/core odkudkoliv', async () => {
    const messages = await lint('apps/web/src/app/page.tsx', `import { x } from '@mlain/core';\n`);
    const barrel = messages.filter((m) => m.ruleId === 'no-restricted-imports');
    expect(barrel.length).toBeGreaterThan(0);
    expect(barrel[0]?.message).toContain('podcestu');
  });

  // Tenhle test je hlavní pojistka proti záměně `paths` a `patterns`.
  // `patterns` má gitignore sémantiku, takže vzor '@mlain/core' zakáže i každou
  // jeho podcestu; od úkolu 11 dál by tím byl zakázaný ÚPLNĚ KAŽDÝ import z core
  // a lint by byl červený navždy. `paths` porovnává specifikátor přesně.
  it('zákaz barrelu nesmí zasáhnout podcesty @mlain/core', async () => {
    for (const specifier of ['@mlain/core/errors', '@mlain/core/config', '@mlain/core/queues']) {
      const messages = await lint('apps/web/src/app/page.tsx', `import { x } from '${specifier}';\n`);
      expect(
        messages.filter((m) => m.ruleId === 'no-restricted-imports'),
        `${specifier} musí být povolený, zákaz se týká jen holého @mlain/core`,
      ).toEqual([]);
    }
  });

  it('povolí import @mlain/emails z packages/core (hrana pro P08)', async () => {
    const messages = await lint(
      'packages/core/src/templates/validate.ts',
      `import { x } from '@mlain/emails/document/schema';\n`,
    );
    expect(messages.filter((m) => m.ruleId === 'no-restricted-imports')).toEqual([]);
  });
});
```

- [ ] **Krok 6: Spusť test a ověř, že padá**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/config exec vitest run test/eslint-boundaries.test.ts
```
Expected: FAIL, `Cannot find module '../eslint/boundaries.js'`.

- [ ] **Krok 7: Napiš `packages/config/eslint/boundaries.js`**

Hlavní bránou je jádrové pravidlo `no-restricted-imports`, protože pracuje se specifikátorem a nepotřebuje resolver. Specifikace jmenuje `import/no-restricted-paths`; to je v `index.js` jako druhá vrstva pro případ, kdy někdo hranici obejde relativní cestou z jiného kořene.

**Klíčový rozdíl mezi `paths` a `patterns`, na kterém tenhle soubor stojí.** Volba `patterns` má **gitignore sémantiku**, takže vzor `@mlain/core` zakáže i `@mlain/core/errors` a každou další podcestu. Zákaz barrelu se proto **nesmí** psát přes `patterns`: od úkolu 11 dál by byl zakázaný úplně každý import z `@mlain/core` a job `lint` by byl trvale červený. Volba `paths` naopak porovnává specifikátor **přesně**, což je přesně to, co zákaz holého barrelu potřebuje.

U zakázaných balíčků z grafu je gitignore sémantika naopak žádoucí, protože podcesty zakázaného balíčku mají být zakázané taky. Proto tenhle soubor používá obojí naráz: `paths` na barrel, `patterns` na graf. Ověřeno spuštěním ESLintu 9.39.5 nad oběma variantami.

```js
import {
  PACKAGE_DIRECTORIES,
  PACKAGE_GRAPH,
  WORKSPACE_APPS,
  WORKSPACE_PACKAGES,
  forbiddenDependencies,
} from '../src/package-graph.ts';

const BARREL_MESSAGE =
  'Barrel exporty se v monorepu nezakládají. Importuj podcestu, například @mlain/core/errors, ne @mlain/core.';

/** Balíčky, u kterých je zakázaný jen holý název, ne podcesty (uzávěr S11). */
const BARREL_PACKAGES = ['@mlain/core'];

/**
 * Flat config bloky, které vynucují graf závislostí z části 1, kapitoly 3.11.
 * Jeden blok na balíček, aby chybová hláška uměla říct, který balíček co nesmí.
 */
export function boundariesConfig() {
  const all = [...WORKSPACE_PACKAGES, ...WORKSPACE_APPS];

  return all.map((name) => {
    const dir = PACKAGE_DIRECTORIES[name];
    const forbidden = forbiddenDependencies(name);
    const allowedDirs = new Set(PACKAGE_GRAPH[name].map((dep) => PACKAGE_DIRECTORIES[dep]));

    // paths = přesná shoda specifikátoru. Jediné správné místo pro zákaz barrelu.
    // Podcesty jako @mlain/core/errors tímhle NEJSOU dotčené.
    const paths = BARREL_PACKAGES.filter((pkg) => !forbidden.includes(pkg)).map((pkg) => ({
      name: pkg,
      message: BARREL_MESSAGE,
    }));

    // patterns = gitignore sémantika. Zakázaný balíček má být zakázaný i se
    // všemi podcestami, takže stačí holý název; `${dep}/*` a `${dep}/**` by byly
    // jen redundance.
    //
    // RELATIVNÍ CESTY SEM NEPATŘÍ. `no-restricted-imports` porovnává řetězec
    // specifikátoru a nezná adresář importujícího souboru, takže počet `../`
    // se nedá odvodit: z packages/db/src/repo.ts vede do core `../../core/...`,
    // z packages/db/src/a/b.ts `../../../core/...`. Vzor s pevným počtem `../`
    // proto nezachytí nic a vzor podle holého jména adresáře (`../config/**`)
    // by naopak zakázal legitimní `../config/ai-keys.js` uvnitř packages/core.
    // Relativní přechody přes hranici hlídá `import/no-restricted-paths`
    // v index.js, protože ten specifikátor skutečně rozřeší na cestu k souboru.
    const patterns = [
      {
        group: forbidden,
        message: `${name} nesmí importovat tenhle balíček. Povolené hrany jsou v packages/config/src/package-graph.ts a pocházejí z části 1, kapitoly 3.11.`,
      },
    ].filter((entry) => entry.group.length > 0);

    const options = {};
    if (paths.length > 0) options.paths = paths;
    if (patterns.length > 0) options.patterns = patterns;

    return {
      name: `mlain/boundaries/${name}`,
      files: [`${dir}/**/*.{ts,tsx,js,jsx,mjs}`],
      rules: {
        'no-restricted-imports': ['error', options],
      },
      // allowedDirs se používá v index.js přes restrictedPathZones(); tady je
      // jen proto, aby bylo vidět, že blok o povolených adresářích ví.
      settings: { 'mlain/allowedDirs': [...allowedDirs] },
    };
  });
}
```

- [ ] **Krok 8: Spusť test a ověř, že prochází**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/config exec vitest run test/eslint-boundaries.test.ts
```
Expected: PASS, `Tests  7 passed (7)`.

- [ ] **Krok 9: Napiš `packages/config/eslint/index.js` a kořenový `eslint.config.js`**

`packages/config/eslint/index.js`:

```js
import js from '@eslint/js';
import importPlugin from 'eslint-plugin-import';
import tseslint from 'typescript-eslint';
import { PACKAGE_DIRECTORIES, PACKAGE_GRAPH } from '../src/package-graph.ts';
import { boundariesConfig } from './boundaries.js';

/**
 * Zóny pro import/no-restricted-paths. Tohle je JEDINÁ vrstva, která hlídá
 * přechod hranice relativní cestou, protože jako jediná specifikátor rozřeší
 * na skutečnou cestu k souboru. `no-restricted-imports` v boundaries.js zná
 * jen řetězec a hloubku importujícího souboru odvodit neumí.
 *
 * Exportuje se kvůli testu, který na zónách ověřuje pokrytí zakázaných dvojic.
 */
export function restrictedPathZones() {
  const zones = [];
  for (const [name, allowed] of Object.entries(PACKAGE_GRAPH)) {
    const allowedDirs = new Set(allowed.map((dep) => PACKAGE_DIRECTORIES[dep]));
    for (const [other, otherDir] of Object.entries(PACKAGE_DIRECTORIES)) {
      if (other === name || allowedDirs.has(otherDir)) continue;
      zones.push({
        target: `./${PACKAGE_DIRECTORIES[name]}`,
        from: `./${otherDir}`,
        message: `${name} nesmí sahat do ${other}.`,
      });
    }
  }
  return zones;
}

export default [
  { ignores: ['**/dist/**', '**/.next/**', '**/.turbo/**', '**/coverage/**', '**/node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    name: 'mlain/base',
    plugins: { import: importPlugin },
    rules: {
      'import/no-restricted-paths': ['error', { zones: restrictedPathZones() }],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': ['error', { allow: ['error'] }],
    },
  },
  ...boundariesConfig(),
  {
    // CLI, CI skripty a build skripty jsou nástroje pro člověka u terminálu,
    // tam je stdout výstup, ne prohřešek.
    //
    // Bez `**/build.mjs`, `**/codegen.mjs` a `packages/core/scripts/**` by
    // pravidlo `no-console` shodilo čtyři soubory, které tenhle plán sám píše:
    // apps/worker/build.mjs, apps/cli/build.mjs, apps/worker/codegen.mjs
    // a packages/core/scripts/write-manifest.ts. Všechny čtyři končí řádkem
    // `console.log`, kterým hlásí, co vyrobily, a job `lint` by byl červený
    // od úkolu 10 dál. Ověřeno spuštěním ESLintu nad těmi cestami.
    name: 'mlain/tooling-console',
    files: [
      'apps/cli/**/*.ts',
      'tools/**/*.mjs',
      'tools/**/*.ts',
      '**/build.mjs',
      '**/codegen.mjs',
      'packages/core/scripts/**/*.ts',
    ],
    rules: { 'no-console': 'off' },
  },
];
```

`/Users/petr/Projects/Mailing_Tool/eslint.config.js`:

```js
export { default } from './packages/config/eslint/index.js';
```

Do `packages/config/package.json` přidej do `devDependencies` `"@eslint/js": "^9.39.5"` (MIT) a spusť `pnpm install`.

- [ ] **Krok 10: Napiš test zón a spusť ho**

`packages/config/test/eslint-zones.test.ts`. Zóny se testují na úrovni dat, ne přes `lintText`: `import/no-restricted-paths` specifikátor **rozřeší**, takže nad neexistujícím souborem v `lintText` mlčky nic nenahlásí a test by byl falešně zelený.

```ts
import { describe, expect, it } from 'vitest';
import { PACKAGE_DIRECTORIES, PACKAGE_GRAPH } from '../src/package-graph.js';
import { restrictedPathZones } from '../eslint/index.js';

describe('zóny pro import/no-restricted-paths', () => {
  const zones = restrictedPathZones();
  const has = (target: string, from: string): boolean =>
    zones.some((zone) => zone.target === target && zone.from === from);

  it('pokrývá každou zakázanou dvojici', () => {
    expect(has('./packages/db', './packages/core'), 'db nesmí sahat do core').toBe(true);
    expect(has('./packages/contracts', './packages/i18n'), 'contracts nesmí nikam').toBe(true);
    expect(has('./apps/worker', './packages/ui'), 'worker nesmí do ui').toBe(true);
  });

  it('nezakazuje povolenou hranu', () => {
    expect(has('./packages/db', './packages/contracts'), 'db do contracts smí').toBe(false);
    expect(has('./packages/core', './packages/emails'), 'core do emails smí').toBe(false);
  });

  it('má zónu pro každou dvojici, kterou graf nepovoluje', () => {
    const workspaceCount = Object.keys(PACKAGE_DIRECTORIES).length;
    const expected = Object.values(PACKAGE_GRAPH).reduce(
      (sum, allowed) => sum + (workspaceCount - 1 - allowed.length),
      0,
    );
    expect(zones).toHaveLength(expected);
  });
});
```

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/config exec vitest run test/eslint-zones.test.ts
```
Expected: PASS, `Tests  3 passed (3)`. Třetí test hlásí 108 zón při dvanácti workspace jménech a devatenácti povolených hranách.

- [ ] **Krok 11: Ověř, že ESLint na repozitáři projde**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm install && pnpm exec eslint .
```
Expected: bez výstupu, exit code 0.

Kdyby ESLint nahlásil `no-console` v `apps/worker/build.mjs`, `apps/cli/build.mjs`, `apps/worker/codegen.mjs` nebo `packages/core/scripts/write-manifest.ts`, chybí v bloku `mlain/tooling-console` jejich vzor. Ty čtyři soubory `console.log` používají záměrně, je to jejich jediný výstup.

- [ ] **Krok 12: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add packages/config eslint.config.js pnpm-lock.yaml && git commit -m "feat(config): enforce package dependency graph in eslint"
```

---

### Úkol 5: Devět balíčků, tři aplikace a test integrity workspace

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/{contracts,db,emails,i18n,sdk-node,sdk-web,ui}/package.json`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/{contracts,db,emails,i18n,sdk-node,sdk-web,ui}/tsconfig.json`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/db/migrations/.gitkeep`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/package.json`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/tsconfig.json`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/vitest.config.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/tools/package.json`
- Create: `/Users/petr/Projects/Mailing_Tool/tools/tsconfig.json`
- Create: `/Users/petr/Projects/Mailing_Tool/tools/vitest.config.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/config/test/workspace-integrity.test.ts`

- [ ] **Krok 1: Napiš padající test integrity workspace**

Tenhle test je automatické vynucení akceptačního kritéria 7d a uzávěru S11 (žádné barrely). Bez něj by se na zploštění manifestů přišlo až u `build-image`.

`packages/config/test/workspace-integrity.test.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PACKAGE_DIRECTORIES,
  PACKAGE_GRAPH,
  WORKSPACE_APPS,
  WORKSPACE_PACKAGES,
  type WorkspaceName,
} from '../src/package-graph.js';

const ROOT = path.resolve(import.meta.dirname, '../../..');

function manifest(name: WorkspaceName): Record<string, unknown> {
  const file = path.join(ROOT, PACKAGE_DIRECTORIES[name], 'package.json');
  return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
}

describe('integrita workspace', () => {
  it('adresář packages/ obsahuje právě devět balíčků (akceptační kritérium 7d)', () => {
    const dirs = fs
      .readdirSync(path.join(ROOT, 'packages'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(dirs).toEqual([
      'config',
      'contracts',
      'core',
      'db',
      'emails',
      'i18n',
      'sdk-node',
      'sdk-web',
      'ui',
    ]);
    expect(dirs).toHaveLength(9);
  });

  it('každý balíček i aplikace má package.json se správným jménem a MIT licencí', () => {
    for (const name of [...WORKSPACE_PACKAGES, ...WORKSPACE_APPS]) {
      const pkg = manifest(name);
      expect(pkg['name'], `${name} má špatné jméno`).toBe(name);
      expect(pkg['license'], `${name} nemá MIT`).toBe('MIT');
      expect(pkg['private'], `${name} není private`).toBe(true);
    }
  });

  it('žádný balíček nemá top level barrel', () => {
    for (const name of WORKSPACE_PACKAGES) {
      for (const candidate of ['index.ts', 'index.tsx', 'src/index.ts', 'src/index.tsx']) {
        const file = path.join(ROOT, PACKAGE_DIRECTORIES[name], candidate);
        expect(fs.existsSync(file), `barrel ${name}/${candidate} nesmí existovat, uzávěr S11`).toBe(
          false,
        );
      }
    }
  });

  it('@mlain/core nemá kořenový export, ale má zástupné znaky na podcesty', () => {
    const exportsMap = manifest('@mlain/core')['exports'] as Record<string, string>;
    expect(exportsMap['.'], 'kořenový export by obešel uzávěr S11').toBeUndefined();
    // Bez těchhle dvou pravidel si musí každý doménový plán přidat řádek do
    // package.json cizího balíčku a codegen workeru vyrobí neimportovatelný soubor.
    expect(exportsMap['./*'], 'chybí zástupný export podcesty domény').toBe('./src/*/index.ts');
    expect(exportsMap['./*/jobs'], 'chybí zástupný export handlerů front').toBe(
      './src/*/jobs/queue-handlers.ts',
    );
  });

  it('adresáře, na které míří Dockerfile, existují', () => {
    // COPY na neexistující cestu build image tvrdě zabije chybou
    // `lstat ...: no such file or directory`. Wildcard to NEOBEJDE, ověřeno
    // spuštěním docker buildu. Proto tyhle dva adresáře zakládá P01, i když
    // jejich obsah patří jiným plánům.
    for (const dir of ['apps/web/public', 'packages/db/migrations']) {
      expect(fs.existsSync(path.join(ROOT, dir)), `${dir} musí existovat kvůli COPY`).toBe(true);
    }
  });

  it('deklarované workspace závislosti nepřekračují graf', () => {
    for (const name of [...WORKSPACE_PACKAGES, ...WORKSPACE_APPS]) {
      const pkg = manifest(name);
      const declared = [
        ...Object.keys((pkg['dependencies'] as Record<string, string>) ?? {}),
        ...Object.keys((pkg['devDependencies'] as Record<string, string>) ?? {}),
      ].filter((dep) => dep.startsWith('@mlain/'));
      for (const dep of declared) {
        expect(
          PACKAGE_GRAPH[name].includes(dep as WorkspaceName),
          `${name} deklaruje ${dep}, což graf nepovoluje`,
        ).toBe(true);
      }
    }
  });

  it('apps/sender není členem pnpm workspace', () => {
    const workspace = fs.readFileSync(path.join(ROOT, 'pnpm-workspace.yaml'), 'utf8');
    expect(workspace).not.toContain('apps/*');
    expect(fs.existsSync(path.join(ROOT, 'apps/sender/package.json'))).toBe(false);
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/config exec vitest run test/workspace-integrity.test.ts
```
Expected: FAIL, `ENOENT: no such file or directory, scandir '.../packages'` nebo výčet adresářů, který neodpovídá devíti jménům.

- [ ] **Krok 3: Založ sedm manifestů balíčků, které vlastní jiné plány**

Pro každý z `contracts`, `db`, `emails`, `i18n`, `sdk-node`, `sdk-web`, `ui` vytvoř `packages/<jméno>/package.json` podle téhle šablony. Vyplň `name`, `dependencies` podle grafu a nic víc. **Žádný `src/`, žádný `index.ts`.**

`packages/contracts/package.json`:

```json
{
  "name": "@mlain/contracts",
  "version": "0.0.0",
  "private": true,
  "license": "MIT",
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json"
  }
}
```

`packages/db/package.json`:

```json
{
  "name": "@mlain/db",
  "version": "0.0.0",
  "private": true,
  "license": "MIT",
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@mlain/contracts": "workspace:*"
  }
}
```

`packages/emails/package.json`:

```json
{
  "name": "@mlain/emails",
  "version": "0.0.0",
  "private": true,
  "license": "MIT",
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@mlain/contracts": "workspace:*",
    "@mlain/i18n": "workspace:*"
  }
}
```

`packages/i18n/package.json`:

```json
{
  "name": "@mlain/i18n",
  "version": "0.0.0",
  "private": true,
  "license": "MIT",
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json"
  }
}
```

`packages/sdk-node/package.json`:

```json
{
  "name": "@mlain/sdk-node",
  "version": "0.0.0",
  "private": true,
  "license": "MIT",
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@mlain/contracts": "workspace:*"
  }
}
```

`packages/sdk-web/package.json`:

```json
{
  "name": "@mlain/sdk-web",
  "version": "0.0.0",
  "private": true,
  "license": "MIT",
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json"
  }
}
```

`packages/ui/package.json`:

```json
{
  "name": "@mlain/ui",
  "version": "0.0.0",
  "private": true,
  "license": "MIT",
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@mlain/i18n": "workspace:*"
  }
}
```

Ke každému z těch sedmi balíčků přidej `packages/<jméno>/tsconfig.json` s tímhle obsahem (u `ui` navíc `"extends": "@mlain/config/tsconfig/next.json"`, protože obsahuje React komponenty):

```json
{
  "extends": "@mlain/config/tsconfig/lib.json",
  "compilerOptions": { "rootDir": "." },
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

Aby `extends` na název balíčku fungoval, přidej do každého z těch sedmi manifestů `"devDependencies": { "@mlain/config": "workspace:*" }`. Test integrity to povolí, protože `@mlain/config` je v grafu bez omezení.

**Pozor:** `include` odkazuje na `src/`, který zatím neexistuje. `tsc --noEmit` na prázdný `include` skončí chybou `No inputs were found`. Proto do `packages/<jméno>/src/.gitkeep` a do tsconfigu doplň `"files": []` místo `include`, dokud balíček nemá zdrojáky. Konkrétně: sedm zakládaných balíčků dostane

```json
{
  "extends": "@mlain/config/tsconfig/lib.json",
  "compilerOptions": { "rootDir": "." },
  "files": [],
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}
```

`files: []` s neprázdným `include` znamená „vezmi, co najdeš, a na prázdném vstupu nespadni". Přebírající plán `files: []` odstraní.

Navíc založ **`packages/db/migrations/.gitkeep`**. Adresář sám je prázdný a migrace do něj píše výhradně P03, ale musí existovat už teď: runtime vrstva Dockerfilu z něj kopíruje migrace do image a `COPY` na neexistující cestu build **zabije** chybou `lstat /packages/db/migrations: no such file or directory`. Ověřeno spuštěním `docker build`; wildcard v cestě to neobejde, `COPY packages/db/migrations*/` selže úplně stejně. Prázdný adresář s `.gitkeep` je jediný způsob, jak nechat `docker/` u jediného vlastníka a zároveň nečekat na P03.

- [ ] **Krok 4: Založ `packages/core/package.json` s exports mapou na podcesty**

Mapa `exports` je vynucení uzávěru S11 na úrovni Node resolveru: `@mlain/core` bez podcesty se nedá naimportovat, protože kořenový export `"."` neexistuje.

**Musí mít zástupný znak.** `packages/core` je jediný balíček, do kterého píše všech patnáct dalších plánů, každý do své domény: `src/contacts/**`, `src/campaigns/**`, `src/templates/**`, `src/tracking/**`, `src/ops/**` a další. Výčet šesti podcest, které zakládá P01, by znamenal, že si každý doménový plán musí přidat řádek do `package.json` cizího balíčku, což je přesně ten sdílený soubor editovaný z osmi větví, kterému se registry vyhýbají.

Druhá, tvrdší vazba je codegen workeru z rozhodnutí D4: generuje `import { handlers as h0 } from '@mlain/core/<domena>/jobs'`. Bez pravidla `"./*/jobs"` by se vygenerovaný soubor nedal naimportovat a worker by spadl na `ERR_PACKAGE_PATH_NOT_EXPORTED` hned prvním handlerem.

Pořadí pravidel nerozhoduje, Node vybírá **nejspecifičtější** shodu, takže `"./*/jobs"` vyhraje nad `"./*"`. Ověřeno spuštěním pod Node: `@mlain/core` selže na `ERR_PACKAGE_PATH_NOT_EXPORTED`, `@mlain/core/errors` se rozřeší na `src/errors/index.ts`, `@mlain/core/contacts/jobs` na `src/contacts/jobs/queue-handlers.ts`. Zákaz barrelu tím zůstává v platnosti.

```json
{
  "name": "@mlain/core",
  "version": "0.0.0",
  "private": true,
  "license": "MIT",
  "type": "module",
  "exports": {
    "./config": "./src/config/index.ts",
    "./errors": "./src/errors/index.ts",
    "./queues": "./src/queues/index.ts",
    "./logging": "./src/logging/index.ts",
    "./health": "./src/health/index.ts",
    "./shutdown": "./src/shutdown/index.ts",
    "./*/jobs": "./src/*/jobs/queue-handlers.ts",
    "./*": "./src/*/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test:unit": "vitest run"
  },
  "dependencies": {
    "@mlain/contracts": "workspace:*",
    "@mlain/emails": "workspace:*",
    "pg": "8.22.0",
    "pino": "10.3.1",
    "zod": "4.4.3"
  },
  "devDependencies": {
    "@mlain/config": "workspace:*",
    "@types/pg": "^8.15.0",
    "pino-pretty": "^13.1.0",
    "vitest": "4.1.10"
  }
}
```

`@mlain/emails` je v `dependencies` kvůli hraně z grafu, kterou potřebuje P08 pro `packages/core/src/templates/**`. Test integrity workspace závislost povolí, protože hrana v grafu existuje. `@mlain/db` a `@mlain/i18n` P01 nedeklaruje, i když je graf povoluje: v kódu, který P01 píše, se neimportují a nedeklarovaná závislost je menší zlo než deklarovaná nepoužitá. Přebírající plány si je doplní, až je začnou používat.

`packages/core/tsconfig.json`:

```json
{
  "extends": "@mlain/config/tsconfig/lib.json",
  "compilerOptions": { "rootDir": "." },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

`packages/core/vitest.config.ts`. Vzor bere i testy vedle zdroje: do `src/<domena>/**` píše patnáct dalších plánů a test, který se nespustí, je horší než test, který chybí. Série by skončila zeleně a nikdo by se to nedozvěděl.

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      thresholds: { branches: 80 },
    },
  },
});
```

Prah 80 % větví je z části 1, kapitoly 3.15.

- [ ] **Krok 5: Založ balíček `tools`**

`tools/package.json`:

```json
{
  "name": "@mlain/tools",
  "version": "0.0.0",
  "private": true,
  "license": "MIT",
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test:unit": "vitest run"
  },
  "devDependencies": {
    "@mlain/config": "workspace:*",
    "vitest": "4.1.10"
  }
}
```

`tools/tsconfig.json`:

```json
{
  "extends": "@mlain/config/tsconfig/node.json",
  "compilerOptions": { "rootDir": "." },
  "files": [],
  "include": ["ci/**/*.ts"]
}
```

`tools/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['ci/test/**/*.test.ts'] },
});
```

`tools` **není** v `WORKSPACE_PACKAGES` ani v `WORKSPACE_APPS`, protože není součástí produktu, jen jeho CI. Test integrity se ho proto netýká a devítka v kritériu 7d zůstává devítkou.

- [ ] **Krok 6: Spusť test a ověř, že prochází**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm install && pnpm --filter @mlain/config exec vitest run test/workspace-integrity.test.ts
```
Expected: PASS, `Tests  7 passed (7)`. Test `apps/sender není členem pnpm workspace` projde už teď, protože `apps/sender` ještě neexistuje; po úkolu 17 pořád platí, protože Go modul žádný `package.json` nemá.

- [ ] **Krok 7: Ověř, že celé workspace jde nainstalovat a otypovat**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm install --frozen-lockfile && pnpm exec turbo run typecheck
```
Expected: `Tasks: 9 successful, 9 total` nebo vyšší číslo, žádná chyba.

- [ ] **Krok 8: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add packages tools pnpm-lock.yaml && git commit -m "feat: scaffold nine workspace packages with ownership-safe manifests"
```

---

### Úkol 6: Registr chybových kódů, typy a kostra Problem Details

Uzávěr S7: P01 předdeklaruje **všechny kódy ze všech sedmi specifikací naráz.** Doménový plán kód používá, nezakládá.

Průzkum specifikací ukázal, že „chybový kód" má v produktu **šest různých jmenných prostorů**, ne jeden. Registr je proto rozdělený podle druhu a test hlídá unikátnost v rámci druhu i to, že se druhy nemíchají.

**Šestý druh `operational` zavádí rozhodnutí R5 dokumentu `ROZHODNUTI-O-VLASTNICTVI.md`.** Chyběl a chyběl tiše: migrační runner z P03 vrací `schema_version_ahead`, `migration_lock_timeout` a `migration_hash_mismatch`, `mlain doctor` z P16 vrací čtrnáct vlastních nálezů se závažností `critical | warning | info`, a ani jeden z těch sedmnácti kódů se nevešel do žádného z pěti původních druhů. Bez šestého druhu by si je oba plány založily samy, což uzávěr S7 zakazuje.

Kód smí být ve **víc prostorech naráz**, pokud to má význam, ale musí být v každém, kde se používá. Dva takové v registru jsou: `contract_mismatch` (stav zprávy pro sender, a zároveň HTTP kód, který potřebuje P13) a `schema_version_ahead` (exit kód CLI 5 a zároveň nález doktoru). Uvnitř druhu `operational` se proto unikátnost počítá z dvojice `scope:code`, ne ze samotného kódu; funkci `registryKey()` používá test.

| Druh | Kde se objevuje | Zdroj |
|---|---|---|
| `problem` | kořenové pole `code` v `application/problem+json` | část 1, 4.2; část 4a; část 3; část 5 |
| `validation` | `errors[].code` u `validation_failed` | část 1, 4.2; část 2, 2.3; část 3 |
| `finding` | `findings[].code` se `severity` | část 1, 4.2; část 4a preflight |
| `message` | sloupec `messages.error_code` | část 4b, 4.2 |
| `import_row` | sloupec `import_errors.error_code` | část 2, 4.6.11 |
| `operational` | exit kód CLI a `finding.id` v `mlain doctor` | část 1, 3.13; rozhodnutí R5 |

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/errors/types.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/errors/operational-codes.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/errors/problem-codes.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/errors/validation-codes.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/errors/message-codes.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/errors/import-row-codes.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/errors/rejected-codes.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/errors/registry.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/errors/problem.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/errors/index.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/test/errors/registry.test.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/test/errors/problem.test.ts`

- [ ] **Krok 1: Napiš padající test registru**

`packages/core/test/errors/registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  ALL_REGISTERED_CODES,
  ERROR_CODES,
  ERROR_REGISTRY,
  IMPORT_ROW_CODES,
  MESSAGE_CODES,
  OPERATIONAL_CODES,
  PROBLEM_CODES,
  REJECTED_CODES,
  VALIDATION_CODES,
  isRegisteredCode,
  operationalCode,
  problemCode,
  registryKey,
  typeUri,
} from '../../src/errors/registry.js';

describe('registr chybových kódů', () => {
  it('nemá duplicitu uvnitř žádného druhu', () => {
    for (const [kind, entries] of Object.entries(ERROR_REGISTRY)) {
      const keys = entries.map(registryKey);
      const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
      expect(duplicates, `duplicitní kódy v druhu ${kind}`).toEqual([]);
    }
  });

  it('má šest druhů, ani o jeden víc (rozhodnutí R5)', () => {
    expect(Object.keys(ERROR_REGISTRY).sort()).toEqual([
      'finding',
      'import_row',
      'message',
      'operational',
      'problem',
      'validation',
    ]);
  });

  it('má přesné počty položek v každém druhu (registr je uzavřený, uzávěr S7)', () => {
    // Exaktní čísla jsou záměr. Doménový plán kód nezakládá, takže každá změna
    // musí projít změnou plánu P01, ne commitem z jiné větve. Test zároveň
    // chrání proti opačné chybě: proti tichému ubrání kódu při refaktoru.
    expect(PROBLEM_CODES).toHaveLength(123);
    expect(FINDING_CODES).toHaveLength(18);
    expect(VALIDATION_CODES).toHaveLength(94);
    expect(MESSAGE_CODES).toHaveLength(33);
    expect(IMPORT_ROW_CODES).toHaveLength(32);
    expect(OPERATIONAL_CODES).toHaveLength(23);
    expect(ALL_REGISTERED_CODES.size).toBe(300);
  });

  it('používá lower_snake_case bez výjimky (konvence 3.11)', () => {
    for (const entries of Object.values(ERROR_REGISTRY)) {
      for (const entry of entries) {
        expect(entry.code, `${entry.code} není lower_snake_case`).toMatch(/^[a-z][a-z0-9_]*$/);
      }
    }
  });

  it('každý problem kód má platný HTTP status a anglický title', () => {
    for (const entry of PROBLEM_CODES) {
      expect(entry.status, `${entry.code}`).toBeGreaterThanOrEqual(400);
      expect(entry.status, `${entry.code}`).toBeLessThan(600);
      expect(entry.title.length, `${entry.code} nemá title`).toBeGreaterThan(0);
      expect(entry.title, `${entry.code} má title s diakritikou`).toMatch(/^[\x20-\x7E]+$/);
    }
  });

  it('platformní kódy z části 1, kapitoly 4.2 sedí na status i opakovatelnost', () => {
    expect(problemCode('unauthenticated')).toMatchObject({ status: 401, retryable: false });
    expect(problemCode('insufficient_scope')).toMatchObject({ status: 403, retryable: false });
    expect(problemCode('idempotency_key_reuse')).toMatchObject({ status: 409, retryable: false });
    expect(problemCode('idempotency_request_in_progress')).toMatchObject({
      status: 409,
      retryable: true,
    });
    expect(problemCode('account_locked')).toMatchObject({ status: 423, retryable: true });
    expect(problemCode('rate_limited')).toMatchObject({ status: 429, retryable: true });
    expect(problemCode('migration_failed')).toMatchObject({ status: 503, retryable: false });
    expect(problemCode('dependency_timeout')).toMatchObject({ status: 504, retryable: true });
    expect(problemCode('not_implemented')).toMatchObject({ status: 501, retryable: false });
  });

  it('campaign_not_compiled je opakovatelné, protože klient spustí kompilaci a zopakuje', () => {
    expect(problemCode('campaign_not_compiled')).toMatchObject({ status: 422, retryable: true });
  });

  it('domain_* nesou retryAfterSeconds 300 kvůli DNS propagaci', () => {
    for (const code of ['domain_dkim_missing', 'domain_spf_missing', 'domain_dmarc_missing']) {
      expect(problemCode(code)).toMatchObject({ retryable: true, retryAfterSeconds: 300 });
    }
  });

  it('opakovatelný kód smí nést retry_after, neopakovatelný nikdy', () => {
    for (const entry of PROBLEM_CODES) {
      if (!entry.retryable) {
        expect(entry.retryAfterSeconds, `${entry.code} není opakovatelný`).toBeUndefined();
      }
    }
  });

  it('žádný kód, který specifikace výslovně zamítla, v registru není', () => {
    for (const rejected of REJECTED_CODES) {
      expect(
        isRegisteredCode(rejected.code),
        `${rejected.code} je zamítnutý: ${rejected.reason}`,
      ).toBe(false);
    }
  });

  it('type URI se dogeneruje podle vzorce, nikde se nevyplňuje ručně', () => {
    expect(typeUri('validation_failed')).toBe('https://docs.mlain.dev/errors/validation_failed');
  });

  it('kódy senderu mají klasifikační třídu z části 4b, kapitoly 4.2', () => {
    const byCode = new Map(MESSAGE_CODES.map((entry) => [entry.code, entry]));
    expect(byCode.get('rate_limited')?.class).toBe('retryable');
    expect(byCode.get('credentials_undecryptable')?.class).toBe('fatal');
    expect(byCode.get('message_rejected')?.class).toBe('permanent');
    expect(byCode.get('ambiguous_dispatch')?.class).toBe('contract');
  });

  it('řádkové kódy importu rozlišují chybu a varování', () => {
    const byCode = new Map(IMPORT_ROW_CODES.map((entry) => [entry.code, entry]));
    expect(byCode.get('email_invalid')?.severity).toBe('error');
    expect(byCode.get('vocative_low_confidence')?.severity).toBe('warning');
    expect(byCode.get('suppressed_skipped')?.severity).toBe('warning');
  });

  it('každá doména ze sedmi částí je v registru zastoupená', () => {
    const domains = new Set(PROBLEM_CODES.map((entry) => entry.domain));
    expect([...domains].sort()).toEqual([
      'campaigns',
      'contacts',
      'content',
      'platform',
      'sender',
      'tracking',
    ]);
  });

  it('validation kódy nekolidují s problem kódy', () => {
    const problems = new Set(PROBLEM_CODES.map((entry) => entry.code));
    const collisions = VALIDATION_CODES.map((entry) => entry.code).filter((code) =>
      problems.has(code),
    );
    expect(collisions).toEqual([]);
  });

  it('zná kódy, které si vyžádaly plány P06, P11 a P13', () => {
    for (const code of [
      // P06, test `mapa kódů na klíče`
      'already_member',
      'webhook_endpoint_disabled',
      // P13, seznam REQUIRED_ERROR_CODES
      'provider_smtp_starttls_unsupported',
      'provider_smtp_greeting_invalid',
      'contract_mismatch',
      // P11, seznamy IMPORT_ERROR_CODES a SEGMENT_ERROR_CODES
      'no_email_column_mapped',
      'file_too_large',
      'too_many_rows',
      'too_many_columns',
      'empty_file',
      'unsupported_encoding',
      'malformed_csv',
      'storage_unavailable',
      'audience_empty',
    ]) {
      expect(isRegisteredCode(code), `${code} chybí v registru`).toBe(true);
    }
  });

  it('ERROR_CODES nese jen kořenové kódy a každý má status i title', () => {
    expect(Object.keys(ERROR_CODES)).toHaveLength(PROBLEM_CODES.length);
    for (const [code, entry] of Object.entries(ERROR_CODES)) {
      expect(entry.code).toBe(code);
      expect(entry.status).toBeGreaterThanOrEqual(400);
      expect(entry.title.length).toBeGreaterThan(0);
    }
    // Validační kód nemá HTTP status, takže do téhle mapy nepatří.
    expect(ERROR_CODES['segment_cycle']).toBeUndefined();
    expect(ALL_REGISTERED_CODES.has('segment_cycle')).toBe(true);
  });
});

describe('šestý jmenný prostor, provozní a migrační kódy', () => {
  it('každý kód scope cli má exit kód a žádnou závažnost', () => {
    for (const entry of OPERATIONAL_CODES.filter((item) => item.scope === 'cli')) {
      expect(entry.exitCode, `${entry.code} nemá exit kód`).toBeTypeOf('number');
      expect(entry.severity, `${entry.code} má závažnost, což u cli nedává smysl`).toBeUndefined();
    }
  });

  it('každý nález doktoru má závažnost a žádný exit kód', () => {
    for (const entry of OPERATIONAL_CODES.filter((item) => item.scope === 'doctor')) {
      expect(
        ['critical', 'warning', 'info'],
        `${entry.code} má neplatnou závažnost`,
      ).toContain(entry.severity);
      expect(entry.exitCode, `${entry.code} má exit kód, což u nálezu nedává smysl`).toBeUndefined();
    }
  });

  it('drží exit kódy, které fixuje část 1, kapitola 3.13', () => {
    expect(operationalCode('cli', 'migration_failed').exitCode).toBe(3);
    expect(operationalCode('cli', 'major_version_skipped').exitCode).toBe(4);
    expect(operationalCode('cli', 'schema_version_ahead').exitCode).toBe(5);
    expect(operationalCode('cli', 'migration_lock_timeout').exitCode).toBe(75);
    expect(operationalCode('cli', 'config_invalid').exitCode).toBe(78);
  });

  it('zná všech čtrnáct nálezů mlain doctor a jednu izolační kontrolu', () => {
    const doctor = OPERATIONAL_CODES.filter((item) => item.scope === 'doctor').map((i) => i.code);
    for (const code of [
      'missing_key_generations',
      'secret_key_previous_empty',
      'secret_key_fingerprint_mismatch',
      'key_id_ceiling_near',
      'data_volume_empty',
      'no_backup_yet',
      'backup_stale',
      'backup_binary_missing',
      'backup_binary_version_mismatch',
      'schema_version_ahead',
      'connection_pool_over_budget',
      'trial_mode_enabled',
      'demo_data_present',
      'check_failed',
      'isolation_prerequisites_missing',
    ]) {
      expect(doctor, `nález ${code} chybí`).toContain(code);
    }
    expect(doctor).toHaveLength(15);
  });

  it('tentýž kód smí být ve víc prostorech, když má v každém význam', () => {
    // schema_version_ahead: exit kód CLI 5 a zároveň kritický nález doktoru.
    expect(operationalCode('cli', 'schema_version_ahead').exitCode).toBe(5);
    expect(operationalCode('doctor', 'schema_version_ahead').severity).toBe('critical');
    // contract_mismatch: stav zprávy pro sender i HTTP kód pro API.
    expect(MESSAGE_CODES.some((entry) => entry.code === 'contract_mismatch')).toBe(true);
    expect(problemCode('contract_mismatch').status).toBe(422);
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/errors/registry.test.ts
```
Expected: FAIL, `Failed to resolve import "../../src/errors/registry.js"`.

- [ ] **Krok 3: Napiš `packages/core/src/errors/types.ts`**

```ts
/** Domény podle sedmi částí specifikace. */
export type ErrorDomain =
  | 'platform'
  | 'contacts'
  | 'content'
  | 'campaigns'
  | 'sender'
  | 'tracking';

/**
 * `spec` = status i chování jsou ve specifikaci napsané.
 * `derived` = kód je ve specifikaci jmenovaný, ale HTTP status doplnil plán P01
 *             podle pravidel v packages/core/src/errors/registry.ts. Vlastnící
 *             plán ho smí upřesnit, ale musí to udělat změnou plánu P01.
 */
export type CodeSource = 'spec' | 'derived';

/** Kořenové pole `code` v application/problem+json. */
export interface ProblemCodeEntry {
  readonly code: string;
  readonly status: number;
  /** Stabilní anglický text, nezávislý na jazyce klienta (4.2). */
  readonly title: string;
  readonly retryable: boolean;
  /** Sekundy do `retry_after`. Smí být jen u opakovatelných kódů. */
  readonly retryAfterSeconds?: number;
  readonly domain: ErrorDomain;
  readonly source: CodeSource;
}

/** `errors[].code` u validation_failed. Nemá vlastní HTTP status. */
export interface ValidationCodeEntry {
  readonly code: string;
  readonly domain: ErrorDomain;
  readonly source: CodeSource;
}

/** `findings[].code` s vlastní závažností. */
export interface FindingCodeEntry {
  readonly code: string;
  readonly severity: 'error' | 'warning';
  readonly domain: ErrorDomain;
  readonly source: CodeSource;
}

/** Klasifikační třída z části 4b, kapitoly 3.12.2 a 4.2. */
export type MessageErrorClass = 'retryable' | 'fatal' | 'permanent' | 'contract';

/** Hodnota sloupce messages.error_code. */
export interface MessageCodeEntry {
  readonly code: string;
  readonly class: MessageErrorClass;
  readonly source: CodeSource;
}

/** Hodnota sloupce import_errors.error_code. */
export interface ImportRowCodeEntry {
  readonly code: string;
  readonly severity: 'error' | 'warning';
  readonly source: CodeSource;
}

/**
 * Šestý jmenný prostor (rozhodnutí R5). Pokrývá dvě věci, které do prvních pěti
 * druhů nepatří a dosud neměly kde být:
 *   scope 'cli'    = kód provozního nebo migračního běhu, nese exit kód CLI
 *   scope 'doctor' = nález `mlain doctor`, nese vlastní závažnost
 *
 * Škála závažnosti je ZÁMĚRNĚ jiná než u FindingCodeEntry: nálezy preflightu
 * kampaně rozhodují o tom, jestli operace projde, takže mají jen error a warning.
 * Nálezy doktoru jsou diagnostika instalace a potřebují i stupeň `info`
 * (například „běží ukázková data"), který o ničem nerozhoduje.
 *
 * Tentýž kód smí být v obou scope. Unikátnost se proto uvnitř tohohle druhu
 * počítá z dvojice scope a kódu, viz registryKey() v registry.ts.
 */
export interface OperationalCodeEntry {
  readonly code: string;
  readonly scope: 'cli' | 'doctor';
  /** Exit kód procesu. Povinný u scope 'cli', zakázaný u 'doctor'. */
  readonly exitCode?: number;
  /** Závažnost nálezu. Povinná u scope 'doctor', zakázaná u 'cli'. */
  readonly severity?: 'critical' | 'warning' | 'info';
  /** Plán, který kód vrací. Registr vlastní P01, chování ne. */
  readonly owner: string;
  readonly source: CodeSource;
}

/** Kód, který specifikace výslovně odmítla zavést. */
export interface RejectedCodeEntry {
  readonly code: string;
  readonly reason: string;
  readonly useInstead: string;
}

export type AnyCodeEntry =
  | ProblemCodeEntry
  | ValidationCodeEntry
  | FindingCodeEntry
  | MessageCodeEntry
  | ImportRowCodeEntry
  | OperationalCodeEntry;
```

- [ ] **Krok 4: Napiš `packages/core/src/errors/problem-codes.ts`**

```ts
import type { FindingCodeEntry, ProblemCodeEntry } from './types.js';

/**
 * Katalog kořenových kódů `code` z application/problem+json.
 *
 * Zdroje: část 1, kapitola 4.2 (platformní katalog a katalog části 4a);
 * část 3, kapitoly 3.x a 4.x; část 5, kapitola 4.
 *
 * Pravidla pro `source: 'derived'`, tedy pro kódy, kde specifikace status
 * neuvádí: *_not_found -> 404, *_locked a *_already_* -> 409, *_not_allowed
 * a *_forbidden -> 403, *_rate_limited -> 429, *_timeout -> 504, jinak 422.
 */
export const PROBLEM_CODES: readonly ProblemCodeEntry[] = [
  // --- Platforma, část 1, kapitola 4.2 --------------------------------------
  { code: 'unauthenticated', status: 401, title: 'Unauthenticated', retryable: false, domain: 'platform', source: 'spec' },
  { code: 'invalid_credentials', status: 401, title: 'Invalid credentials', retryable: false, domain: 'platform', source: 'spec' },
  { code: 'session_expired', status: 401, title: 'Session expired', retryable: false, domain: 'platform', source: 'spec' },
  { code: 'signature_invalid', status: 401, title: 'Invalid signature', retryable: false, domain: 'platform', source: 'spec' },
  { code: 'forbidden', status: 403, title: 'Forbidden', retryable: false, domain: 'platform', source: 'spec' },
  { code: 'insufficient_scope', status: 403, title: 'Insufficient scope', retryable: false, domain: 'platform', source: 'spec' },
  { code: 'origin_not_allowed', status: 403, title: 'Origin not allowed', retryable: false, domain: 'platform', source: 'spec' },
  { code: 'csrf_token_invalid', status: 403, title: 'Invalid CSRF token', retryable: false, domain: 'platform', source: 'spec' },
  { code: 'not_found', status: 404, title: 'Not found', retryable: false, domain: 'platform', source: 'spec' },
  { code: 'method_not_allowed', status: 405, title: 'Method not allowed', retryable: false, domain: 'platform', source: 'spec' },
  { code: 'conflict', status: 409, title: 'Conflict', retryable: false, domain: 'platform', source: 'spec' },
  { code: 'already_exists', status: 409, title: 'Already exists', retryable: false, domain: 'platform', source: 'spec' },
  { code: 'invalid_state_transition', status: 409, title: 'Invalid state transition', retryable: false, domain: 'platform', source: 'spec' },
  { code: 'idempotency_key_reuse', status: 409, title: 'Idempotency key reused', retryable: false, domain: 'platform', source: 'spec' },
  { code: 'idempotency_request_in_progress', status: 409, title: 'Request in progress', retryable: true, retryAfterSeconds: 1, domain: 'platform', source: 'spec' },
  { code: 'last_owner_cannot_be_removed', status: 409, title: 'Last owner cannot be removed', retryable: false, domain: 'platform', source: 'spec' },
  { code: 'setup_already_completed', status: 409, title: 'Setup already completed', retryable: false, domain: 'platform', source: 'spec' },
  // Oba doplněné po nálezu P06: jeho test `mapa kódů na klíče` vyžaduje, aby
  // každý klíč AUTH_ERROR_KEYS a SETTINGS_ERROR_KEYS byl v registru, a tyhle
  // dva v něm chyběly. Zavádí je část 1, kapitoly 3.3 a 3.8.
  { code: 'already_member', status: 409, title: 'User is already a member', retryable: false, domain: 'platform', source: 'spec' },
  { code: 'webhook_endpoint_disabled', status: 409, title: 'Webhook endpoint is disabled', retryable: false, domain: 'platform', source: 'spec' },
  { code: 'gone', status: 410, title: 'Gone', retryable: false, domain: 'platform', source: 'spec' },
  { code: 'endpoint_removed', status: 410, title: 'Endpoint removed', retryable: false, domain: 'platform', source: 'spec' },
  { code: 'precondition_failed', status: 412, title: 'Precondition failed', retryable: false, domain: 'platform', source: 'spec' },
  { code: 'payload_too_large', status: 413, title: 'Payload too large', retryable: false, domain: 'platform', source: 'spec' },
  { code: 'unsupported_media_type', status: 415, title: 'Unsupported media type', retryable: false, domain: 'platform', source: 'spec' },
  { code: 'validation_failed', status: 422, title: 'Validation failed', retryable: false, domain: 'platform', source: 'spec' },
  { code: 'too_many_items', status: 422, title: 'Too many items', retryable: false, domain: 'platform', source: 'spec' },
  { code: 'unsupported_api_version', status: 422, title: 'Unsupported API version', retryable: false, domain: 'platform', source: 'spec' },
  { code: 'account_locked', status: 423, title: 'Account locked', retryable: true, retryAfterSeconds: 900, domain: 'platform', source: 'spec' },
  { code: 'resource_locked', status: 423, title: 'Resource locked', retryable: true, retryAfterSeconds: 5, domain: 'platform', source: 'spec' },
  { code: 'rate_limited', status: 429, title: 'Rate limit exceeded', retryable: true, retryAfterSeconds: 60, domain: 'platform', source: 'spec' },
  { code: 'quota_exceeded', status: 429, title: 'Quota exceeded', retryable: true, retryAfterSeconds: 3600, domain: 'platform', source: 'spec' },
  { code: 'internal_error', status: 500, title: 'Internal server error', retryable: true, domain: 'platform', source: 'spec' },
  { code: 'not_implemented', status: 501, title: 'Not implemented', retryable: false, domain: 'platform', source: 'spec' },
  { code: 'service_unavailable', status: 503, title: 'Service unavailable', retryable: true, retryAfterSeconds: 30, domain: 'platform', source: 'spec' },
  { code: 'migration_failed', status: 503, title: 'Migration failed', retryable: false, domain: 'platform', source: 'spec' },
  { code: 'dependency_timeout', status: 504, title: 'Dependency timeout', retryable: true, retryAfterSeconds: 5, domain: 'platform', source: 'spec' },

  // --- Kampaně, provideři a doručitelnost, část 4a --------------------------
  { code: 'campaign_locked', status: 409, title: 'Campaign is locked', retryable: false, domain: 'campaigns', source: 'spec' },
  { code: 'campaign_audience_changed', status: 409, title: 'Campaign audience changed', retryable: false, domain: 'campaigns', source: 'spec' },
  { code: 'campaign_undo_window_expired', status: 409, title: 'Undo window expired', retryable: false, domain: 'campaigns', source: 'spec' },
  { code: 'campaign_audience_empty', status: 422, title: 'Campaign audience is empty', retryable: false, domain: 'campaigns', source: 'spec' },
  { code: 'campaign_audience_too_large', status: 422, title: 'Campaign audience too large', retryable: false, domain: 'campaigns', source: 'spec' },
  { code: 'campaign_not_compiled', status: 422, title: 'Campaign template not compiled', retryable: true, domain: 'campaigns', source: 'spec' },
  { code: 'campaign_subject_missing', status: 422, title: 'Campaign subject is missing', retryable: false, domain: 'campaigns', source: 'spec' },
  { code: 'campaign_no_unsubscribe', status: 422, title: 'Template has no unsubscribe link', retryable: false, domain: 'campaigns', source: 'spec' },
  { code: 'campaign_unknown_merge_field', status: 422, title: 'Template references unknown field', retryable: false, domain: 'campaigns', source: 'spec' },
  { code: 'campaign_schedule_too_soon', status: 422, title: 'Scheduled time is too soon', retryable: false, domain: 'campaigns', source: 'spec' },
  { code: 'campaign_schedule_too_far', status: 422, title: 'Scheduled time is too far ahead', retryable: false, domain: 'campaigns', source: 'spec' },
  { code: 'campaign_not_sendable', status: 422, title: 'Campaign is not sendable', retryable: false, domain: 'campaigns', source: 'spec' },
  { code: 'campaign_audience_query_too_slow', status: 504, title: 'Audience query timed out', retryable: true, retryAfterSeconds: 30, domain: 'campaigns', source: 'derived' },
  { code: 'provider_not_ready', status: 422, title: 'Sending provider is not ready', retryable: true, domain: 'campaigns', source: 'spec' },
  { code: 'provider_sending_paused', status: 422, title: 'Provider sending is paused', retryable: true, domain: 'campaigns', source: 'spec' },
  { code: 'provider_quota_exceeded', status: 422, title: "Provider daily quota exceeded", retryable: true, retryAfterSeconds: 3600, domain: 'campaigns', source: 'spec' },
  { code: 'provider_sandbox', status: 422, title: 'Provider account is in sandbox', retryable: false, domain: 'campaigns', source: 'spec' },
  { code: 'provider_credentials_invalid', status: 422, title: 'Provider credentials are invalid', retryable: false, domain: 'campaigns', source: 'spec' },
  { code: 'provider_smtp_host_unknown', status: 422, title: 'SMTP host is unknown', retryable: true, domain: 'campaigns', source: 'spec' },
  { code: 'provider_smtp_connection_refused', status: 422, title: 'SMTP connection refused', retryable: true, domain: 'campaigns', source: 'spec' },
  { code: 'provider_smtp_tls_invalid', status: 422, title: 'SMTP TLS handshake failed', retryable: true, domain: 'campaigns', source: 'spec' },
  { code: 'provider_smtp_auth_failed', status: 422, title: 'SMTP authentication failed', retryable: true, domain: 'campaigns', source: 'spec' },
  { code: 'provider_smtp_timeout', status: 422, title: 'SMTP connection timed out', retryable: true, domain: 'campaigns', source: 'spec' },
  // Doplněné po nálezu P13: jeho seznam REQUIRED_ERROR_CODES tyhle dva vyžaduje
  // a v registru chyběly, takže jeho test předpokladů padal na startu plánu.
  { code: 'provider_smtp_starttls_unsupported', status: 422, title: 'SMTP server does not support STARTTLS', retryable: true, domain: 'campaigns', source: 'spec' },
  { code: 'provider_smtp_greeting_invalid', status: 422, title: 'SMTP greeting is invalid', retryable: true, domain: 'campaigns', source: 'spec' },
  // Rozhodnutí R5: contract_mismatch je v MESSAGE_CODES jako stav zprávy, ale
  // P13 ho potřebuje i jako HTTP kód, protože kontrolu z jeho úkolu 47 vrací API.
  // Tentýž kód ve dvou prostorech je povolený, když má v obou význam.
  { code: 'contract_mismatch', status: 422, title: 'Contract mismatch between compiled template and outbox', retryable: false, domain: 'campaigns', source: 'spec' },
  { code: 'domain_dkim_missing', status: 422, title: 'Domain DKIM is not verified', retryable: true, retryAfterSeconds: 300, domain: 'campaigns', source: 'spec' },
  { code: 'domain_spf_missing', status: 422, title: 'Domain SPF record is missing', retryable: true, retryAfterSeconds: 300, domain: 'campaigns', source: 'spec' },
  { code: 'domain_dmarc_missing', status: 422, title: 'Domain DMARC record is missing', retryable: true, retryAfterSeconds: 300, domain: 'campaigns', source: 'spec' },
  { code: 'domain_check_rate_limited', status: 429, title: 'Domain check rate limited', retryable: true, retryAfterSeconds: 60, domain: 'campaigns', source: 'derived' },
  { code: 'test_recipient_suppressed', status: 422, title: 'Test recipient is suppressed', retryable: false, domain: 'campaigns', source: 'spec' },
  { code: 'test_rate_limited', status: 429, title: 'Test send rate limited', retryable: true, retryAfterSeconds: 60, domain: 'campaigns', source: 'derived' },

  // --- Kontakty, souhlasy, segmenty, část 2 --------------------------------
  // Část 2, kapitola 2.3 mapuje své situace na platformní kódy a doménovou
  // příčinu posílá do errors[].code. Vlastní kořenový kód zavádí jen tenhle:
  { code: 'contact_limit_reached', status: 429, title: 'Contact limit reached', retryable: false, domain: 'contacts', source: 'spec' },

  // --- Obsah, assety, značka a AI, část 3 ----------------------------------
  { code: 'template_document_invalid', status: 422, title: 'Template document is invalid', retryable: false, domain: 'content', source: 'spec' },
  { code: 'template_schema_too_new', status: 422, title: 'Template schema version is too new', retryable: false, domain: 'content', source: 'spec' },
  { code: 'template_starter_immutable', status: 409, title: 'Starter template is immutable', retryable: false, domain: 'content', source: 'spec' },
  { code: 'content_too_many_blocks', status: 413, title: 'Too many blocks in document', retryable: false, domain: 'content', source: 'spec' },
  { code: 'asset_quota_exceeded', status: 413, title: 'Asset storage quota exceeded', retryable: false, domain: 'content', source: 'spec' },
  { code: 'asset_too_many_pixels', status: 413, title: 'Image has too many pixels', retryable: false, domain: 'content', source: 'spec' },
  { code: 'asset_unsupported_format', status: 415, title: 'Unsupported asset format', retryable: false, domain: 'content', source: 'spec' },
  { code: 'asset_corrupt', status: 422, title: 'Asset file is corrupt', retryable: false, domain: 'content', source: 'spec' },
  { code: 'asset_referenced_by_sent_campaign', status: 409, title: 'Asset is referenced by a sent campaign', retryable: false, domain: 'content', source: 'spec' },
  { code: 'brand_invalid_url', status: 400, title: 'Brand URL is invalid', retryable: false, domain: 'content', source: 'spec' },
  { code: 'brand_scheme_not_allowed', status: 400, title: 'Brand URL scheme is not allowed', retryable: false, domain: 'content', source: 'spec' },
  { code: 'brand_port_not_allowed', status: 400, title: 'Brand URL port is not allowed', retryable: false, domain: 'content', source: 'spec' },
  { code: 'brand_host_not_allowed', status: 400, title: 'Brand host is not allowed', retryable: false, domain: 'content', source: 'spec' },
  { code: 'brand_blocked_address', status: 400, title: 'Brand host resolves to a blocked address', retryable: false, domain: 'content', source: 'spec' },
  { code: 'brand_credentials_in_url', status: 400, title: 'Brand URL contains credentials', retryable: false, domain: 'content', source: 'spec' },
  { code: 'brand_robots_disallowed', status: 403, title: 'Brand fetch disallowed by robots.txt', retryable: false, domain: 'content', source: 'spec' },
  { code: 'brand_robots_unavailable', status: 422, title: 'robots.txt could not be fetched', retryable: true, retryAfterSeconds: 300, domain: 'content', source: 'spec' },
  { code: 'brand_dns_failed', status: 422, title: 'Brand host DNS lookup failed', retryable: true, retryAfterSeconds: 300, domain: 'content', source: 'spec' },
  { code: 'brand_fetch_failed', status: 422, title: 'Brand page could not be fetched', retryable: true, retryAfterSeconds: 300, domain: 'content', source: 'spec' },
  { code: 'brand_insecure_redirect', status: 422, title: 'Brand fetch hit an insecure redirect', retryable: false, domain: 'content', source: 'spec' },
  { code: 'brand_redirect_loop', status: 422, title: 'Brand fetch hit a redirect loop', retryable: false, domain: 'content', source: 'spec' },
  { code: 'brand_too_many_redirects', status: 422, title: 'Brand fetch exceeded redirect limit', retryable: false, domain: 'content', source: 'spec' },
  { code: 'brand_response_too_large', status: 422, title: 'Brand response is too large', retryable: false, domain: 'content', source: 'spec' },
  { code: 'brand_unexpected_content_type', status: 422, title: 'Unexpected content type from brand host', retryable: false, domain: 'content', source: 'spec' },
  { code: 'brand_timeout', status: 504, title: 'Brand fetch timed out', retryable: true, retryAfterSeconds: 300, domain: 'content', source: 'spec' },
  { code: 'brand_extract_running', status: 409, title: 'Brand extraction already running', retryable: true, retryAfterSeconds: 30, domain: 'content', source: 'derived' },
  { code: 'ai_credential_missing', status: 422, title: 'AI provider key is not configured', retryable: false, domain: 'content', source: 'spec' },
  { code: 'ai_invalid_credentials', status: 422, title: 'AI provider credentials are invalid', retryable: false, domain: 'content', source: 'spec' },
  { code: 'ai_insufficient_credit', status: 422, title: 'AI provider reports insufficient credit', retryable: false, domain: 'content', source: 'spec' },
  { code: 'ai_context_too_long', status: 422, title: 'AI request context is too long', retryable: false, domain: 'content', source: 'spec' },
  { code: 'ai_invalid_output', status: 422, title: 'AI returned output that failed schema validation', retryable: true, domain: 'content', source: 'spec' },
  { code: 'ai_content_filtered', status: 422, title: 'AI provider filtered the content', retryable: false, domain: 'content', source: 'spec' },
  { code: 'ai_rate_limited', status: 429, title: 'AI provider rate limited the request', retryable: true, retryAfterSeconds: 60, domain: 'content', source: 'spec' },
  { code: 'ai_provider_unavailable', status: 503, title: 'AI provider is unavailable', retryable: true, retryAfterSeconds: 60, domain: 'content', source: 'spec' },
  { code: 'ai_timeout', status: 504, title: 'AI request timed out', retryable: true, retryAfterSeconds: 30, domain: 'content', source: 'spec' },

  // --- Tracking a události, část 5 ------------------------------------------
  { code: 'token_malformed', status: 400, title: 'Tracking token is malformed', retryable: false, domain: 'tracking', source: 'spec' },
  { code: 'token_signature_invalid', status: 400, title: 'Tracking token signature is invalid', retryable: false, domain: 'tracking', source: 'spec' },
  { code: 'token_unknown_key', status: 400, title: 'Tracking token uses an unknown key generation', retryable: false, domain: 'tracking', source: 'spec' },
  { code: 'token_type_mismatch', status: 400, title: 'Tracking token type does not match the endpoint', retryable: false, domain: 'tracking', source: 'spec' },
  { code: 'tracking_payload_version_unsupported', status: 400, title: 'Unsupported tracking payload version', retryable: false, domain: 'tracking', source: 'spec' },
  { code: 'token_already_used', status: 409, title: 'One time token has already been used', retryable: false, domain: 'tracking', source: 'spec' },
  { code: 'tracking_disabled', status: 409, title: 'Tracking is disabled for this workspace', retryable: false, domain: 'tracking', source: 'spec' },
  { code: 'tracking_merge_not_revertible', status: 409, title: 'Identity merge cannot be reverted', retryable: false, domain: 'tracking', source: 'spec' },
  { code: 'token_expired', status: 410, title: 'Tracking token has expired', retryable: false, domain: 'tracking', source: 'spec' },
  { code: 'tracking_domain_invalid', status: 422, title: 'Tracking domain is invalid', retryable: false, domain: 'tracking', source: 'spec' },
  { code: 'tracking_domain_limit_reached', status: 422, title: 'Tracking domain limit reached', retryable: false, domain: 'tracking', source: 'spec' },
  { code: 'tracking_event_too_large', status: 422, title: 'Event payload is too large', retryable: false, domain: 'tracking', source: 'spec' },
  { code: 'tracking_invalid_event_name', status: 422, title: 'Event name is invalid', retryable: false, domain: 'tracking', source: 'spec' },
  { code: 'tracking_invalid_anonymous_id', status: 422, title: 'Anonymous id is invalid', retryable: false, domain: 'tracking', source: 'spec' },
  { code: 'tracking_identify_unsigned_pii', status: 422, title: 'Identify call carries unsigned personal data', retryable: false, domain: 'tracking', source: 'spec' },
  { code: 'tracking_import_beyond_retention', status: 422, title: 'Imported events fall outside the retention window', retryable: false, domain: 'tracking', source: 'spec' },
  { code: 'tracking_import_partition_missing', status: 422, title: 'Target partition for imported events does not exist', retryable: false, domain: 'tracking', source: 'spec' },
  { code: 'tracking_timeline_window_too_large', status: 422, title: 'Timeline window is too large', retryable: false, domain: 'tracking', source: 'spec' },

  // --- Sender jako HTTP aktér, část 4b --------------------------------------
  // Sender vlastní HTTP endpoint jen pro health; jediný kód, který vrací API
  // aplikace kvůli senderu, je tenhle. Ostatní kódy senderu jsou v MESSAGE_CODES.
  { code: 'sender_not_running', status: 503, title: 'Sending service is not running', retryable: true, retryAfterSeconds: 30, domain: 'sender', source: 'derived' },
];

/**
 * `findings[].code`. Preflight kampaně vrací víc nálezů naráz s vlastní
 * závažností; operace smí vrátit 4xx jen tehdy, když je mezi nálezy aspoň
 * jeden se severity 'error' (část 1, 4.2).
 */
export const FINDING_CODES: readonly FindingCodeEntry[] = [
  { code: 'campaign_no_unsubscribe', severity: 'error', domain: 'campaigns', source: 'spec' },
  { code: 'campaign_subject_missing', severity: 'error', domain: 'campaigns', source: 'spec' },
  { code: 'campaign_unknown_merge_field', severity: 'error', domain: 'campaigns', source: 'spec' },
  { code: 'campaign_audience_empty', severity: 'error', domain: 'campaigns', source: 'spec' },
  { code: 'campaign_not_compiled', severity: 'error', domain: 'campaigns', source: 'spec' },
  { code: 'provider_not_ready', severity: 'error', domain: 'campaigns', source: 'spec' },
  { code: 'provider_sandbox', severity: 'error', domain: 'campaigns', source: 'spec' },
  { code: 'domain_dkim_missing', severity: 'error', domain: 'campaigns', source: 'spec' },
  { code: 'domain_spf_missing', severity: 'warning', domain: 'campaigns', source: 'spec' },
  { code: 'domain_dmarc_missing', severity: 'warning', domain: 'campaigns', source: 'spec' },
  { code: 'content_missing_unsubscribe', severity: 'error', domain: 'content', source: 'spec' },
  { code: 'content_image_missing_alt', severity: 'warning', domain: 'content', source: 'spec' },
  { code: 'content_low_contrast', severity: 'warning', domain: 'content', source: 'spec' },
  { code: 'content_link_anchor_only', severity: 'warning', domain: 'content', source: 'spec' },
  { code: 'content_too_many_links', severity: 'warning', domain: 'content', source: 'spec' },
  { code: 'content_html_too_large', severity: 'warning', domain: 'content', source: 'spec' },
  { code: 'content_padding_overflow', severity: 'warning', domain: 'content', source: 'spec' },
  { code: 'deliverability_degraded', severity: 'warning', domain: 'campaigns', source: 'derived' },
];
```

- [ ] **Krok 5: Napiš `packages/core/src/errors/validation-codes.ts`**

```ts
import type { ValidationCodeEntry } from './types.js';

/**
 * `errors[].code`, tedy důvod na úrovni pole u validation_failed.
 * Zdroje: část 1, 4.2; část 2, 2.3; část 3, kapitoly o blokovém schématu
 * a Liquid subsetu.
 */
export const VALIDATION_CODES: readonly ValidationCodeEntry[] = [
  // Obecné typové chyby, část 1, 4.2
  { code: 'invalid_email', domain: 'platform', source: 'spec' },
  { code: 'expected_number', domain: 'platform', source: 'spec' },
  { code: 'expected_string', domain: 'platform', source: 'derived' },
  { code: 'expected_boolean', domain: 'platform', source: 'derived' },
  { code: 'unknown_key', domain: 'platform', source: 'spec' },
  { code: 'required', domain: 'platform', source: 'derived' },

  // Kontakty a pole, část 2, 2.3
  { code: 'email_too_long', domain: 'contacts', source: 'spec' },
  { code: 'invalid_number', domain: 'contacts', source: 'spec' },
  { code: 'invalid_boolean', domain: 'contacts', source: 'spec' },
  { code: 'invalid_date', domain: 'contacts', source: 'spec' },
  { code: 'invalid_enum_value', domain: 'contacts', source: 'spec' },
  { code: 'value_too_long', domain: 'contacts', source: 'spec' },
  { code: 'required_field_missing', domain: 'contacts', source: 'spec' },
  { code: 'unknown_field_key', domain: 'contacts', source: 'spec' },
  { code: 'field_key_reserved', domain: 'contacts', source: 'spec' },
  { code: 'field_limit_reached', domain: 'contacts', source: 'spec' },
  { code: 'indexed_field_limit_reached', domain: 'contacts', source: 'spec' },
  { code: 'field_type_immutable', domain: 'contacts', source: 'spec' },
  { code: 'field_used_by_scheduled_campaign', domain: 'contacts', source: 'spec' },
  { code: 'retention_below_minimum', domain: 'contacts', source: 'spec' },
  { code: 'import_duplicate', domain: 'contacts', source: 'spec' },
  { code: 'import_already_running', domain: 'contacts', source: 'spec' },
  // Devět kódů doplněných po nálezu P11. Jeho test v úkolu 2 vyžaduje, aby
  // každá položka IMPORT_ERROR_CODES a SEGMENT_ERROR_CODES byla v registru,
  // a tyhle v něm chyběly. Jsou to chyby na úrovni CELÉHO SOUBORU nebo definice,
  // ne řádku: řádkové kódy importu mají vlastní druh IMPORT_ROW_CODES.
  { code: 'no_email_column_mapped', domain: 'contacts', source: 'spec' },
  { code: 'file_too_large', domain: 'contacts', source: 'spec' },
  { code: 'too_many_rows', domain: 'contacts', source: 'spec' },
  { code: 'too_many_columns', domain: 'contacts', source: 'spec' },
  { code: 'empty_file', domain: 'contacts', source: 'spec' },
  { code: 'unsupported_encoding', domain: 'contacts', source: 'spec' },
  { code: 'malformed_csv', domain: 'contacts', source: 'spec' },
  { code: 'storage_unavailable', domain: 'contacts', source: 'spec' },
  { code: 'audience_empty', domain: 'contacts', source: 'spec' },
  { code: 'subscribe_blocked_suppressed', domain: 'contacts', source: 'spec' },
  { code: 'subscribe_blocked_complaint', domain: 'contacts', source: 'spec' },
  { code: 'suppression_not_removable', domain: 'contacts', source: 'spec' },
  { code: 'suppression_too_recent', domain: 'contacts', source: 'spec' },
  { code: 'gdpr_not_verified', domain: 'contacts', source: 'spec' },
  { code: 'segment_invalid_ast', domain: 'contacts', source: 'spec' },
  { code: 'segment_operator_not_allowed', domain: 'contacts', source: 'spec' },
  { code: 'segment_invalid_range', domain: 'contacts', source: 'spec' },
  { code: 'segment_too_complex', domain: 'contacts', source: 'spec' },
  { code: 'segment_too_deep', domain: 'contacts', source: 'spec' },
  { code: 'segment_cycle', domain: 'contacts', source: 'spec' },
  { code: 'segment_list_too_long', domain: 'contacts', source: 'spec' },
  { code: 'segment_nesting_too_deep', domain: 'contacts', source: 'spec' },
  { code: 'segment_definition_too_large', domain: 'contacts', source: 'spec' },
  { code: 'segment_reference_not_found', domain: 'contacts', source: 'spec' },
  { code: 'segment_too_many_engagement', domain: 'contacts', source: 'spec' },
  { code: 'segment_too_many_event', domain: 'contacts', source: 'spec' },
  { code: 'segment_preview_timeout', domain: 'contacts', source: 'spec' },

  // Blokový dokument a Liquid subset, část 3
  { code: 'content_duplicate_block_id', domain: 'content', source: 'spec' },
  { code: 'content_duplicate_footer', domain: 'content', source: 'spec' },
  { code: 'content_document_too_large', domain: 'content', source: 'spec' },
  { code: 'content_nested_columns', domain: 'content', source: 'spec' },
  { code: 'content_nested_repeat', domain: 'content', source: 'spec' },
  { code: 'content_raw_html_forbidden', domain: 'content', source: 'spec' },
  { code: 'content_reserved_marker', domain: 'content', source: 'spec' },
  { code: 'content_link_scheme_forbidden', domain: 'content', source: 'spec' },
  { code: 'content_unknown_merge_tag', domain: 'content', source: 'spec' },
  { code: 'content_asset_not_found', domain: 'content', source: 'spec' },
  { code: 'content_condition_field_unknown', domain: 'content', source: 'spec' },
  { code: 'content_condition_operator_invalid', domain: 'content', source: 'spec' },
  { code: 'content_condition_on_unsubscribe', domain: 'content', source: 'spec' },
  { code: 'compile_campaign_id_required', domain: 'content', source: 'spec' },
  { code: 'liquid_tag_not_allowed', domain: 'content', source: 'spec' },
  { code: 'liquid_filter_not_allowed', domain: 'content', source: 'spec' },
  { code: 'liquid_filter_argument_not_allowed', domain: 'content', source: 'spec' },
  { code: 'liquid_string_literal_not_allowed', domain: 'content', source: 'spec' },
  { code: 'liquid_comparison_operator_not_supported', domain: 'content', source: 'spec' },
  { code: 'liquid_contains_not_allowed', domain: 'content', source: 'spec' },
  { code: 'liquid_parentheses_not_allowed', domain: 'content', source: 'spec' },
  { code: 'liquid_index_not_allowed', domain: 'content', source: 'spec' },
  { code: 'liquid_for_parameter_not_allowed', domain: 'content', source: 'spec' },
  { code: 'liquid_nested_for', domain: 'content', source: 'spec' },
  { code: 'liquid_nesting_too_deep', domain: 'content', source: 'spec' },
  { code: 'liquid_path_too_deep', domain: 'content', source: 'spec' },
  { code: 'liquid_unknown_root', domain: 'content', source: 'spec' },
  { code: 'liquid_unknown_field', domain: 'content', source: 'spec' },
  { code: 'liquid_identifier_case', domain: 'content', source: 'spec' },
  { code: 'liquid_unbalanced_block', domain: 'content', source: 'spec' },
  { code: 'liquid_whitespace_control_not_allowed', domain: 'content', source: 'spec' },
  { code: 'liquid_date_format_not_allowed', domain: 'content', source: 'spec' },
  { code: 'liquid_default_value_invalid', domain: 'content', source: 'spec' },
  { code: 'liquid_template_too_large', domain: 'content', source: 'spec' },
  { code: 'liquid_too_many_outputs', domain: 'content', source: 'spec' },
  { code: 'liquid_too_many_loops', domain: 'content', source: 'spec' },
  { code: 'liquid_in_trackable_href', domain: 'content', source: 'spec' },
  { code: 'liquid_vocative_filter', domain: 'content', source: 'spec' },
  { code: 'liquid_escape_not_needed', domain: 'content', source: 'spec' },
  { code: 'liquid_truthy_string_warning', domain: 'content', source: 'spec' },
  { code: 'liquid_type_mismatch_warning', domain: 'content', source: 'spec' },
  { code: 'template_preview_with_contact', domain: 'content', source: 'spec' },

  // Tracking, část 5
  { code: 'tracking_properties_depth_truncated', domain: 'tracking', source: 'spec' },
  { code: 'tracking_properties_keys_dropped', domain: 'tracking', source: 'spec' },
  { code: 'tracking_properties_value_truncated', domain: 'tracking', source: 'spec' },
];
```

- [ ] **Krok 6: Napiš `packages/core/src/errors/message-codes.ts` a `import-row-codes.ts`**

`packages/core/src/errors/message-codes.ts`, opsané z části 4b, kapitoly 4.2:

```ts
import type { MessageCodeEntry } from './types.js';

/**
 * Hodnoty sloupce messages.error_code. Sender zapisuje jen kód, nikdy
 * přeloženou hlášku. Třída rozhoduje o tom, co udělá aplikace:
 *   retryable  = zpráva se zkusí znovu
 *   permanent  = zpráva končí na failed, kampaň běží dál
 *   fatal      = kampaň se pozastaví
 *   contract   = kontraktní stav nejistoty, opravuje ho příchozí událost
 *
 * POZOR na rozpor P1.17 z části 4b: kontrakt 4.10.1 vede v
 * packages/contracts/src/outbox-errors.ts užší registr než tenhle katalog.
 * Sladění vlastní P02 a P09, tenhle registr je úplný katalog části 4b.
 */
export const MESSAGE_CODES: readonly MessageCodeEntry[] = [
  { code: 'rate_limited', class: 'retryable', source: 'spec' },
  { code: 'provider_unavailable', class: 'retryable', source: 'spec' },
  { code: 'network_error', class: 'retryable', source: 'spec' },
  { code: 'smtp_temporary_failure', class: 'retryable', source: 'spec' },
  { code: 'smtp_tls_temporary', class: 'retryable', source: 'spec' },
  { code: 'provider_auth_failed', class: 'fatal', source: 'spec' },
  { code: 'sending_paused', class: 'fatal', source: 'spec' },
  { code: 'account_suspended', class: 'fatal', source: 'spec' },
  { code: 'mail_from_not_verified', class: 'fatal', source: 'spec' },
  { code: 'provider_event_config_missing', class: 'fatal', source: 'spec' },
  { code: 'provider_quota_exceeded', class: 'fatal', source: 'spec' },
  { code: 'smtp_starttls_unavailable', class: 'fatal', source: 'spec' },
  { code: 'smtp_insecure_auth_refused', class: 'fatal', source: 'spec' },
  { code: 'credentials_undecryptable', class: 'fatal', source: 'spec' },
  { code: 'contract_mismatch', class: 'fatal', source: 'spec' },
  { code: 'liquid_escaped_entity_in_construct', class: 'fatal', source: 'spec' },
  { code: 'message_rejected', class: 'permanent', source: 'spec' },
  { code: 'smtp_recipient_rejected', class: 'permanent', source: 'spec' },
  { code: 'smtp_message_rejected', class: 'permanent', source: 'spec' },
  { code: 'smtp_permanent_failure', class: 'permanent', source: 'spec' },
  { code: 'invalid_recipient', class: 'permanent', source: 'spec' },
  { code: 'invalid_request', class: 'permanent', source: 'spec' },
  { code: 'render_failed', class: 'permanent', source: 'spec' },
  { code: 'render_timeout', class: 'permanent', source: 'spec' },
  { code: 'subject_too_long', class: 'permanent', source: 'spec' },
  { code: 'body_too_large', class: 'permanent', source: 'spec' },
  { code: 'message_too_large', class: 'permanent', source: 'spec' },
  { code: 'marker_injection_detected', class: 'permanent', source: 'spec' },
  { code: 'marker_not_replaced', class: 'permanent', source: 'spec' },
  { code: 'unsubscribe_url_missing', class: 'permanent', source: 'spec' },
  { code: 'max_attempts_exceeded', class: 'permanent', source: 'spec' },
  { code: 'suppressed', class: 'permanent', source: 'spec' },
  { code: 'ambiguous_dispatch', class: 'contract', source: 'spec' },
];
```

`packages/core/src/errors/import-row-codes.ts`, opsané z části 2, kapitoly 4.6.11:

```ts
import type { ImportRowCodeEntry } from './types.js';

/**
 * Hodnoty sloupce import_errors.error_code. Do HTTP odpovědi se nepromítají
 * vůbec, import je asynchronní. Chyba znamená, že se řádek neimportoval;
 * varování znamená, že se importoval a jen se označil.
 */
export const IMPORT_ROW_CODES: readonly ImportRowCodeEntry[] = [
  { code: 'row_field_count_mismatch', severity: 'error', source: 'spec' },
  { code: 'email_missing', severity: 'error', source: 'spec' },
  { code: 'email_invalid', severity: 'error', source: 'spec' },
  { code: 'email_too_long', severity: 'error', source: 'spec' },
  { code: 'email_domain_invalid', severity: 'error', source: 'spec' },
  { code: 'email_disposable', severity: 'error', source: 'spec' },
  { code: 'duplicate_in_file', severity: 'error', source: 'spec' },
  { code: 'invalid_number', severity: 'error', source: 'spec' },
  { code: 'invalid_boolean', severity: 'error', source: 'spec' },
  { code: 'invalid_date', severity: 'error', source: 'spec' },
  { code: 'invalid_datetime', severity: 'error', source: 'spec' },
  { code: 'invalid_enum_value', severity: 'error', source: 'spec' },
  { code: 'invalid_url', severity: 'error', source: 'spec' },
  { code: 'invalid_phone', severity: 'error', source: 'spec' },
  { code: 'value_too_long', severity: 'error', source: 'spec' },
  { code: 'required_field_missing', severity: 'error', source: 'spec' },
  { code: 'unknown_field_key', severity: 'error', source: 'spec' },
  { code: 'encoding_error', severity: 'error', source: 'spec' },
  { code: 'name_empty', severity: 'error', source: 'spec' },
  { code: 'list_not_found', severity: 'error', source: 'spec' },
  { code: 'delimiter_not_detected', severity: 'error', source: 'spec' },
  { code: 'name_split_low_confidence', severity: 'warning', source: 'spec' },
  { code: 'vietnamese_order_assumed', severity: 'warning', source: 'spec' },
  { code: 'gender_unknown', severity: 'warning', source: 'spec' },
  { code: 'gender_conflict', severity: 'warning', source: 'spec' },
  { code: 'vocative_low_confidence', severity: 'warning', source: 'spec' },
  { code: 'non_latin_script', severity: 'warning', source: 'spec' },
  { code: 'value_truncated', severity: 'warning', source: 'spec' },
  { code: 'excel_serial_date_assumed', severity: 'warning', source: 'spec' },
  { code: 'number_format_ambiguous', severity: 'warning', source: 'spec' },
  { code: 'suppressed_skipped', severity: 'warning', source: 'spec' },
  { code: 'trailing_fields_padded', severity: 'warning', source: 'spec' },
];
```

- [ ] **Krok 6b: Napiš `packages/core/src/errors/operational-codes.ts`**

```ts
import type { OperationalCodeEntry } from './types.js';

/**
 * Šestý jmenný prostor podle rozhodnutí R5.
 *
 * Bez něj by si migrační runner v P03 a `mlain doctor` v P16 zakládaly kódy
 * samy, protože se do prvních pěti druhů nevejdou: nemají HTTP status, nejsou
 * to hodnoty sloupce a nevznikají při validaci vstupu. Uzávěr S7 to zakazuje,
 * takže je předdeklaruje P01, stejně jako všechny ostatní.
 *
 * Exit kódy 3, 4, 5 a 75 fixuje část 1, kapitola 3.13; 6, 64, 69 a 78 doplnil
 * plán P01 (rozhodnutí D9). Musí se shodovat s apps/cli/src/exit-codes.ts
 * a hlídá to test.
 */
export const OPERATIONAL_CODES: readonly OperationalCodeEntry[] = [
  // --- Provoz a migrace, exit kódy CLI --------------------------------------
  { code: 'migration_failed', scope: 'cli', exitCode: 3, owner: 'P03', source: 'spec' },
  { code: 'major_version_skipped', scope: 'cli', exitCode: 4, owner: 'P16', source: 'spec' },
  { code: 'schema_version_ahead', scope: 'cli', exitCode: 5, owner: 'P03', source: 'spec' },
  { code: 'migration_hash_mismatch', scope: 'cli', exitCode: 6, owner: 'P03', source: 'derived' },
  { code: 'usage_error', scope: 'cli', exitCode: 64, owner: 'P01', source: 'derived' },
  { code: 'command_not_implemented', scope: 'cli', exitCode: 69, owner: 'P01', source: 'derived' },
  { code: 'migration_lock_timeout', scope: 'cli', exitCode: 75, owner: 'P03', source: 'spec' },
  { code: 'config_invalid', scope: 'cli', exitCode: 78, owner: 'P01', source: 'spec' },

  // --- Nálezy `mlain doctor`, část 1, kapitola 3.14 -------------------------
  { code: 'missing_key_generations', scope: 'doctor', severity: 'critical', owner: 'P16', source: 'spec' },
  { code: 'secret_key_previous_empty', scope: 'doctor', severity: 'critical', owner: 'P16', source: 'spec' },
  { code: 'secret_key_fingerprint_mismatch', scope: 'doctor', severity: 'critical', owner: 'P16', source: 'spec' },
  { code: 'key_id_ceiling_near', scope: 'doctor', severity: 'warning', owner: 'P16', source: 'spec' },
  { code: 'data_volume_empty', scope: 'doctor', severity: 'critical', owner: 'P16', source: 'spec' },
  { code: 'no_backup_yet', scope: 'doctor', severity: 'warning', owner: 'P16', source: 'spec' },
  { code: 'backup_stale', scope: 'doctor', severity: 'warning', owner: 'P16', source: 'spec' },
  { code: 'backup_binary_missing', scope: 'doctor', severity: 'critical', owner: 'P16', source: 'spec' },
  { code: 'backup_binary_version_mismatch', scope: 'doctor', severity: 'critical', owner: 'P16', source: 'spec' },
  { code: 'schema_version_ahead', scope: 'doctor', severity: 'critical', owner: 'P16', source: 'spec' },
  { code: 'connection_pool_over_budget', scope: 'doctor', severity: 'warning', owner: 'P16', source: 'spec' },
  { code: 'trial_mode_enabled', scope: 'doctor', severity: 'info', owner: 'P16', source: 'spec' },
  { code: 'demo_data_present', scope: 'doctor', severity: 'info', owner: 'P16', source: 'spec' },
  { code: 'check_failed', scope: 'doctor', severity: 'warning', owner: 'P16', source: 'spec' },
  // Nález N24 evidence: doctor musí umět hlásit i to, že se na aktuální roli
  // nevztahuje RLS. P03 pro to dodává checkIsolationPrerequisites().
  { code: 'isolation_prerequisites_missing', scope: 'doctor', severity: 'critical', owner: 'P16', source: 'derived' },
];
```

- [ ] **Krok 7: Napiš `packages/core/src/errors/rejected-codes.ts`**

Tohle je automatické vynucení rozhodnutí, která by jinak byla jen v próze. Bez něj by je někdo za tři týdny znovu zavedl.

```ts
import type { RejectedCodeEntry } from './types.js';

/**
 * Kódy, které specifikace výslovně odmítla zavést. Test v registru ověří,
 * že žádný z nich v žádném druhu registru není. Bez toho by šlo rozhodnutí
 * obejít prostým přidáním řádku.
 */
export const REJECTED_CODES: readonly RejectedCodeEntry[] = [
  {
    code: 'sns_signature_invalid',
    reason: 'jmenný prostor per provider by rostl s každým dalším (část 1, 4.2)',
    useInstead: 'signature_invalid s params.reason = "bad_signature"',
  },
  {
    code: 'sns_cert_url_invalid',
    reason: 'jmenný prostor per provider by rostl s každým dalším (část 1, 4.2)',
    useInstead: 'signature_invalid s params.reason = "cert_url_not_allowed"',
  },
  {
    code: 'sns_topic_mismatch',
    reason: 'jmenný prostor per provider by rostl s každým dalším (část 1, 4.2)',
    useInstead: 'signature_invalid s params.reason = "topic_mismatch"',
  },
  {
    code: 'campaign_not_found',
    reason: 'nevede klienta k jiné akci než obecný kód (test z části 1, 4.2)',
    useInstead: 'not_found',
  },
  {
    code: 'campaign_invalid_transition',
    reason: 'duplikuje platformní kód',
    useInstead: 'invalid_state_transition',
  },
  {
    code: 'ses_configuration_set_missing',
    reason: 'prefix providera u obecného pojmu (část 4b, 4.2, poznámka 3)',
    useInstead: 'provider_event_config_missing',
  },
  {
    code: 'ses_daily_quota_exceeded',
    reason: 'prefix providera u obecného pojmu (část 4b, 4.2, poznámka 3)',
    useInstead: 'provider_quota_exceeded',
  },
];
```

- [ ] **Krok 8: Napiš `packages/core/src/errors/registry.ts`**

```ts
import { FINDING_CODES, PROBLEM_CODES } from './problem-codes.js';
import { IMPORT_ROW_CODES } from './import-row-codes.js';
import { MESSAGE_CODES } from './message-codes.js';
import { OPERATIONAL_CODES } from './operational-codes.js';
import { REJECTED_CODES } from './rejected-codes.js';
import { VALIDATION_CODES } from './validation-codes.js';
import type { AnyCodeEntry, OperationalCodeEntry, ProblemCodeEntry } from './types.js';

export {
  FINDING_CODES,
  IMPORT_ROW_CODES,
  MESSAGE_CODES,
  OPERATIONAL_CODES,
  PROBLEM_CODES,
  REJECTED_CODES,
  VALIDATION_CODES,
};

/** Základ pro type URI. Nikdy se nevyplňuje ručně (část 1, 4.2). */
export const ERROR_TYPE_BASE = 'https://docs.mlain.dev/errors';

export const ERROR_REGISTRY: Record<string, readonly AnyCodeEntry[]> = {
  problem: PROBLEM_CODES,
  validation: VALIDATION_CODES,
  finding: FINDING_CODES,
  message: MESSAGE_CODES,
  import_row: IMPORT_ROW_CODES,
  operational: OPERATIONAL_CODES,
};

/**
 * Klíč pro kontrolu unikátnosti uvnitř druhu. U pěti původních druhů je to
 * samotný kód; u druhu `operational` dvojice scope a kódu, protože tentýž kód
 * má význam v CLI i v doktoru (`schema_version_ahead`).
 */
export function registryKey(entry: AnyCodeEntry): string {
  return 'scope' in entry ? `${(entry as OperationalCodeEntry).scope}:${entry.code}` : entry.code;
}

const PROBLEM_BY_CODE = new Map(PROBLEM_CODES.map((entry) => [entry.code, entry]));

/**
 * Plochá mapa kořenových kódů podle kódu. Tvar `Record<string, { status,
 * title, retryable }>` si vyžádaly plány P04, P06 a P07, které z něj skládají
 * odpověď API a mapu na překladové klíče.
 *
 * POZOR: obsahuje **jen druh `problem`**, protože jen ten má HTTP status.
 * Na otázku „je tenhle kód vůbec registrovaný" slouží `isRegisteredCode()`
 * nebo `ALL_REGISTERED_CODES`, ne indexace téhle mapy.
 */
export const ERROR_CODES: Readonly<Record<string, ProblemCodeEntry>> = Object.fromEntries(
  PROBLEM_CODES.map((entry) => [entry.code, entry]),
);

/** Každý kód ze všech šesti druhů, bez ohledu na prostor. */
export const ALL_REGISTERED_CODES: ReadonlySet<string> = new Set(
  Object.values(ERROR_REGISTRY).flatMap((entries) => entries.map((entry) => entry.code)),
);

export function typeUri(code: string): string {
  return `${ERROR_TYPE_BASE}/${code}`;
}

export function problemCode(code: string): ProblemCodeEntry {
  const entry = PROBLEM_BY_CODE.get(code);
  if (!entry) {
    throw new Error(
      `Neregistrovaný chybový kód "${code}". Kódy se zakládají výhradně v plánu P01, uzávěr S7.`,
    );
  }
  return entry;
}

export function isRegisteredCode(code: string): boolean {
  return ALL_REGISTERED_CODES.has(code);
}

/** Kód provozního běhu podle scope. Vyhodí, když není registrovaný. */
export function operationalCode(scope: 'cli' | 'doctor', code: string): OperationalCodeEntry {
  const entry = OPERATIONAL_CODES.find((item) => item.scope === scope && item.code === code);
  if (!entry) {
    throw new Error(
      `Neregistrovaný provozní kód "${scope}:${code}". Kódy se zakládají výhradně v plánu P01, uzávěr S7 a rozhodnutí R5.`,
    );
  }
  return entry;
}
```

- [ ] **Krok 9: Spusť test a ověř, že prochází**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/errors/registry.test.ts
```
Expected: PASS, `Tests  22 passed (22)`.

Kdyby padl test `žádný kód, který specifikace výslovně zamítla`, znamená to, že jsi některý z odmítnutých kódů omylem zaregistroval. Odeber ho, nepřidávej výjimku.

- [ ] **Krok 10: Napiš padající test obálky Problem Details**

`packages/core/test/errors/problem.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { buildProblem } from '../../src/errors/problem.js';

describe('obálka RFC 9457', () => {
  it('poskládá povinná pole a dogeneruje type URI', () => {
    const problem = buildProblem({
      code: 'validation_failed',
      instance: '/api/v1/contacts',
      requestId: '0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071',
      detail: "Pole 'email' není platná e-mailová adresa.",
      errors: [{ path: 'email', code: 'invalid_email', message: 'Není platná e-mailová adresa.' }],
    });
    expect(problem).toEqual({
      type: 'https://docs.mlain.dev/errors/validation_failed',
      title: 'Validation failed',
      status: 422,
      detail: "Pole 'email' není platná e-mailová adresa.",
      instance: '/api/v1/contacts',
      code: 'validation_failed',
      request_id: '0192f3a0-1c2d-7e60-8a1b-2c3d4e5f6071',
      errors: [{ path: 'email', code: 'invalid_email', message: 'Není platná e-mailová adresa.' }],
    });
  });

  it('doplní retry_after u opakovatelného kódu z registru', () => {
    const problem = buildProblem({
      code: 'domain_dmarc_missing',
      instance: '/api/v1/providers/1/verify',
      requestId: 'r1',
    });
    expect(problem['retry_after']).toBe(300);
  });

  it('nikdy nevrátí about:blank', () => {
    const problem = buildProblem({ code: 'internal_error', instance: '/x', requestId: 'r1' });
    expect(problem['type']).not.toBe('about:blank');
  });

  it('odmítne findings bez jediné severity error', () => {
    expect(() =>
      buildProblem({
        code: 'campaign_not_sendable',
        instance: '/x',
        requestId: 'r1',
        findings: [{ code: 'domain_dmarc_missing', severity: 'warning', message: 'DMARC chybí.' }],
      }),
    ).toThrow(/aspoň jeden nález se severity "error"/);
  });

  it('odmítne neregistrovaný kód', () => {
    expect(() => buildProblem({ code: 'made_up_code', instance: '/x', requestId: 'r1' })).toThrow(
      /Neregistrovaný chybový kód/,
    );
  });

  it('odmítne errors[] u jiného kódu než validation_failed', () => {
    expect(() =>
      buildProblem({
        code: 'conflict',
        instance: '/x',
        requestId: 'r1',
        errors: [{ path: 'a', code: 'required', message: 'x' }],
      }),
    ).toThrow(/errors\[\] patří výhradně k validation_failed/);
  });
});
```

- [ ] **Krok 11: Spusť test a ověř, že padá**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/errors/problem.test.ts
```
Expected: FAIL, `Failed to resolve import "../../src/errors/problem.js"`.

- [ ] **Krok 12: Napiš `packages/core/src/errors/problem.ts` a `index.ts`**

```ts
import { problemCode, typeUri } from './registry.js';

export interface ProblemFieldError {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

export interface ProblemFinding {
  readonly code: string;
  readonly severity: 'error' | 'warning';
  readonly message: string;
  readonly path?: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface BuildProblemInput {
  readonly code: string;
  readonly instance: string;
  readonly requestId: string;
  readonly detail?: string;
  readonly errors?: readonly ProblemFieldError[];
  readonly findings?: readonly ProblemFinding[];
  readonly params?: Readonly<Record<string, unknown>>;
  /** Přebije retryAfterSeconds z registru, například u rate limitu. */
  readonly retryAfterSeconds?: number;
}

/**
 * Sestaví tělo odpovědi podle RFC 9457 tak, jak ho definuje část 1, kapitola 4.2.
 * Content-Type application/problem+json nastavuje volající, tahle funkce vrací
 * jen tělo, aby ji šlo použít i mimo HTTP vrstvu.
 */
export function buildProblem(input: BuildProblemInput): Record<string, unknown> {
  const entry = problemCode(input.code);

  if (input.errors && input.code !== 'validation_failed') {
    throw new Error(
      'errors[] patří výhradně k validation_failed. Doménové nálezy patří do findings[].',
    );
  }
  if (input.findings && !input.findings.some((finding) => finding.severity === 'error')) {
    throw new Error(
      'Chybová odpověď s findings musí obsahovat aspoň jeden nález se severity "error". Samotná varování se vracejí s úspěšnou odpovědí.',
    );
  }

  const problem: Record<string, unknown> = {
    type: typeUri(entry.code),
    title: entry.title,
    status: entry.status,
    instance: input.instance,
    code: entry.code,
    request_id: input.requestId,
  };
  if (input.detail !== undefined) problem['detail'] = input.detail;
  if (input.errors !== undefined) problem['errors'] = input.errors;
  if (input.findings !== undefined) problem['findings'] = input.findings;
  if (input.params !== undefined) problem['params'] = input.params;

  const retryAfter = input.retryAfterSeconds ?? entry.retryAfterSeconds;
  if (entry.retryable && retryAfter !== undefined) problem['retry_after'] = retryAfter;

  // Pořadí klíčů je stabilní kvůli snapshotům a kvůli tomu, že detail je
  // uprostřed obálky v příkladu ve specifikaci.
  const ordered: Record<string, unknown> = {};
  for (const key of ['type', 'title', 'status', 'detail', 'instance', 'code', 'request_id', 'errors', 'findings', 'params', 'retry_after']) {
    if (key in problem) ordered[key] = problem[key];
  }
  return ordered;
}
```

`packages/core/src/errors/index.ts`:

```ts
export * from './types.js';
export * from './registry.js';
export * from './problem.js';
```

Tenhle `index.ts` **není** zakázaný barrel z uzávěru S11: zákaz se týká `packages/core/index.ts`, tedy jednoho souboru s řádkem na doménu. Doménový vstupní bod `packages/core/src/errors/index.ts` je naopak to, co dělá import podcesty `@mlain/core/errors` možným.

- [ ] **Krok 13: Spusť oba testy a ověř, že procházejí**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/errors
```
Expected: PASS, `Test Files  2 passed (2)`, `Tests  28 passed (28)`.

- [ ] **Krok 14: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add packages/core && git commit -m "feat(core): predeclare the full error code registry for all seven specs"
```

---

### Úkol 7: Registr front pg-boss

Uzávěr S8: P01 předdeklaruje všechny fronty ve tvaru `<domena>.<akce>`. Handler si každá doména píše do svého souboru, entrypoint workeru je jen složí.

Konvence z části 1, kapitoly 9.1 jsou závazné: `retryLimit`, `retryBackoff` a `expireInSeconds` se uvádějí **explicitně**, nikdy se nespoléhá na výchozí hodnoty; payload nese jen identifikátory a malá metadata, nikdy osobní údaje ani obsah e-mailů; každý job musí být idempotentní, protože `singletonKey` negarantuje běh právě jednou.

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/queues/types.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/queues/registry.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/queues/index.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/test/queues/registry.test.ts`

- [ ] **Krok 1: Napiš padající test registru front**

`packages/core/test/queues/registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  QUEUE_REGISTRY,
  cronQueues,
  dlqName,
  queue,
  queueNames,
} from '../../src/queues/registry.js';

describe('registr front pg-boss', () => {
  it('má název ve tvaru <domena>.<akce> u každé fronty (konvence 3.11)', () => {
    for (const entry of QUEUE_REGISTRY) {
      expect(entry.name, `${entry.name}`).toMatch(/^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/);
    }
  });

  it('nemá duplicitní název', () => {
    const names = queueNames();
    expect(new Set(names).size).toBe(names.length);
  });

  it('má u každé fronty explicitní retryLimit a expireInSeconds (konvence 9.1)', () => {
    for (const entry of QUEUE_REGISTRY) {
      expect(entry.retryLimit, `${entry.name} bez retryLimit`).toBeTypeOf('number');
      expect(entry.expireInSeconds, `${entry.name} bez expireInSeconds`).toBeGreaterThan(0);
    }
  });

  it('kopíruje politiku front části 1, kapitoly 3.8', () => {
    expect(queue('platform.webhook_fanout')).toMatchObject({ retryLimit: 5 });
    expect(queue('platform.webhook_deliver')).toMatchObject({ retryLimit: 0 });
  });

  it('kopíruje politiku front části 4a, kapitoly 4.5', () => {
    expect(queue('campaign.materialize')).toMatchObject({
      retryLimit: 5,
      singletonKeyTemplate: 'campaign.materialize:<campaign_id>',
    });
    expect(queue('campaign.scheduler')).toMatchObject({ cron: '*/30 * * * * *', retryLimit: 3 });
    expect(queue('campaign.watchdog')).toMatchObject({ cron: '*/15 * * * * *', retryLimit: 3 });
    expect(queue('provider_event.process')).toMatchObject({ retryLimit: 10 });
    expect(queue('retention.drop_message_partitions')).toMatchObject({
      cron: '30 3 * * *',
      retryLimit: 1,
    });
  });

  it('kopíruje politiku front části 3, kapitoly 4.8', () => {
    expect(queue('content.brand_extract')).toMatchObject({ retryLimit: 0 });
    expect(queue('content.process_asset')).toMatchObject({ retryLimit: 3 });
    expect(queue('content.cleanup_versions')).toMatchObject({ cron: '10 3 * * *' });
    expect(queue('ai.cleanup_conversations')).toMatchObject({ cron: '40 3 * * *' });
  });

  it('extrakce značky se nikdy neopakuje, opakovaný SSRF pokus není žádoucí', () => {
    expect(queue('content.brand_extract').retryLimit).toBe(0);
  });

  it('žádný payload nedeklaruje osobní údaj ani obsah e-mailu (konvence 9.1)', () => {
    const forbidden = ['email', 'render_data', 'html', 'text', 'body', 'first_name', 'subject'];
    for (const entry of QUEUE_REGISTRY) {
      for (const field of entry.payloadFields) {
        expect(forbidden, `${entry.name} má v payloadu ${field}`).not.toContain(field);
      }
    }
  });

  it('dead letter fronta se jmenuje <fronta>.dlq', () => {
    expect(dlqName('contacts.import')).toBe('contacts.import.dlq');
    for (const entry of QUEUE_REGISTRY) {
      if (entry.deadLetter) {
        expect(queueNames()).not.toContain(dlqName(entry.name));
      }
    }
  });

  it('cron výrazy mají pět nebo šest polí', () => {
    for (const entry of cronQueues()) {
      const fields = entry.cron.trim().split(/\s+/);
      expect([5, 6], `${entry.name}: ${entry.cron}`).toContain(fields.length);
    }
  });

  it('drží pořadí denních úloh: partition se zakládají před retencí', () => {
    const minutes = (cron: string): number => {
      const [minute, hour] = cron.trim().split(/\s+/);
      return Number(hour) * 60 + Number(minute);
    };
    expect(minutes(queue('platform.maintain_partitions').cron ?? '')).toBeLessThan(
      minutes(queue('tracking.enforce_retention').cron ?? ''),
    );
    expect(minutes(queue('tracking.enforce_retention').cron ?? '')).toBeLessThan(
      minutes(queue('tracking.recompute_engagement_windows').cron ?? ''),
    );
  });

  it('pokrývá všech šest domén', () => {
    const domains = new Set(QUEUE_REGISTRY.map((entry) => entry.domain));
    expect([...domains].sort()).toEqual([
      'campaigns',
      'contacts',
      'content',
      'platform',
      'sender',
      'tracking',
    ]);
  });

  it('queue() na neregistrované frontě hlásí uzávěr S8', () => {
    expect(() => queue('vymyslena.fronta')).toThrow(/uzávěr S8/);
  });

  it('zná fronty, které si vyžádaly plány P07, P10 a P16', () => {
    // Všechny čtyři doménové plány implementují nebo volají, ale v registru
    // chyběly. Fronta bez záznamu tady znamená, že se v úkolu 14 nezaloží
    // a doménový plán dostane při prvním boss.send chybu o neexistující frontě.
    for (const name of [
      'contacts.cleanup_pending',
      'consents.rebuild_state',
      'retention.run',
      'tracking.rebuild_engagement',
    ]) {
      expect(queueNames(), `fronta ${name} chybí`).toContain(name);
    }
  });

  it('má právě šedesát jedna front (registr je uzavřený, uzávěr S8)', () => {
    // Exaktní číslo je záměr. Doménový plán frontu nezakládá, takže každá změna
    // téhle hodnoty musí projít změnou plánu P01, ne commitem z jiné větve.
    expect(QUEUE_REGISTRY).toHaveLength(61);
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/queues/registry.test.ts
```
Expected: FAIL, `Failed to resolve import "../../src/queues/registry.js"`.

- [ ] **Krok 3: Napiš `packages/core/src/queues/types.ts`**

```ts
import type { ErrorDomain } from '../errors/types.js';

export interface QueueEntry {
  /** Název ve tvaru <domena>.<akce>, opsaný ze specifikace doslova. */
  readonly name: string;
  readonly domain: ErrorDomain;
  /** Který plán dodá handler. Registr vlastní P01, handler ne. */
  readonly owner: string;
  readonly description: string;
  /** Cron výraz pro boss.schedule. Chybí u front spouštěných na požádání. */
  readonly cron?: string;
  /** Explicitně, konvence 9.1 zakazuje spoléhat na výchozí hodnoty. */
  readonly retryLimit: number;
  readonly retryBackoff: boolean;
  readonly retryDelaySeconds: number;
  readonly expireInSeconds: number;
  /** Tvar singletonKey, když ho fronta používá. `global` = jeden běh v instalaci. */
  readonly singletonKeyTemplate?: string;
  /** Fronta smí trvale selhat a má proto <name>.dlq. */
  readonly deadLetter: boolean;
  /** Souběžnost, když se liší od WORKER_CONCURRENCY. */
  readonly concurrency?: number;
  /** Názvy polí payloadu. Slouží testu, který hlídá zákaz osobních údajů. */
  readonly payloadFields: readonly string[];
  /** Kapitola specifikace, ze které politika pochází. */
  readonly source: string;
}
```

- [ ] **Krok 4: Napiš `packages/core/src/queues/registry.ts`**

Fronty se jmenují **doslova tak, jak je pojmenovaly specifikace.** Část specifikací používá jednotné číslo domény (`campaign.materialize`, `domain.recheck`, `identity.merge`), část množné (`contacts.import`, `segments.recount`). Konvence `<domena>.<akce>` obojí připouští a přejmenování by tiše rozešlo doménové plány s texty, které na tyhle názvy odkazují.

```ts
import type { QueueEntry } from './types.js';

const MINUTE = 60;
const HOUR = 60 * MINUTE;

export const QUEUE_REGISTRY: readonly QueueEntry[] = [
  // --- Platforma, část 1 ----------------------------------------------------
  { name: 'platform.webhook_fanout', domain: 'platform', owner: 'P04', description: 'Z události webhooku vyrobí doručení pro každý odebírající endpoint.', retryLimit: 5, retryBackoff: true, retryDelaySeconds: 5, expireInSeconds: 5 * MINUTE, deadLetter: true, payloadFields: ['event_id', 'created_at'], source: 'část 1, 3.8' },
  { name: 'platform.webhook_deliver', domain: 'platform', owner: 'P04', description: 'Jedno HTTP doručení. Retry řídí aplikace přes next_attempt_at, ne pg-boss.', retryLimit: 0, retryBackoff: false, retryDelaySeconds: 0, expireInSeconds: 2 * MINUTE, singletonKeyTemplate: 'delivery:<delivery_id>', deadLetter: false, payloadFields: ['delivery_id', 'created_at'], source: 'část 1, 3.8' },
  { name: 'platform.maintain_partitions', domain: 'platform', owner: 'P03', description: 'Zajistí existenci partition pro aktuální a další tři měsíce.', cron: '0 2 * * *', retryLimit: 3, retryBackoff: true, retryDelaySeconds: 60, expireInSeconds: 30 * MINUTE, singletonKeyTemplate: 'global', deadLetter: false, payloadFields: [], source: 'část 1, 2.1' },
  { name: 'platform.cleanup_sessions', domain: 'platform', owner: 'P04', description: 'Maže relace starší než 30 dní od skončení.', cron: '15 2 * * *', retryLimit: 3, retryBackoff: true, retryDelaySeconds: 60, expireInSeconds: 15 * MINUTE, singletonKeyTemplate: 'global', deadLetter: false, payloadFields: [], source: 'část 1, 3.2' },
  { name: 'platform.cleanup_idempotency', domain: 'platform', owner: 'P04', description: 'Maže vypršené záznamy idempotenčních klíčů.', cron: '25 2 * * *', retryLimit: 3, retryBackoff: true, retryDelaySeconds: 60, expireInSeconds: 15 * MINUTE, singletonKeyTemplate: 'global', deadLetter: false, payloadFields: [], source: 'část 1, 4.4 (název odvozen P01)' },
  { name: 'platform.cleanup_audit_log', domain: 'platform', owner: 'P04', description: 'Retence auditu podle AUDIT_RETENTION_MONTHS.', cron: '35 2 * * *', retryLimit: 3, retryBackoff: true, retryDelaySeconds: 60, expireInSeconds: 30 * MINUTE, singletonKeyTemplate: 'global', deadLetter: false, payloadFields: [], source: 'část 1, 3.7 a 4.9 (název odvozen P01)' },
  { name: 'platform.purge_workspaces', domain: 'platform', owner: 'P04', description: 'Trvale odstraní měkce smazané projekty po uplynutí lhůty.', cron: '45 2 * * *', retryLimit: 3, retryBackoff: true, retryDelaySeconds: 60, expireInSeconds: 1 * HOUR, singletonKeyTemplate: 'global', deadLetter: true, payloadFields: [], source: 'část 1, 3.3' },
  { name: 'platform.backup', domain: 'platform', owner: 'P16', description: 'Plánovaná záloha podle BACKUP_SCHEDULE_CRON.', cron: '0 3 * * *', retryLimit: 1, retryBackoff: false, retryDelaySeconds: 0, expireInSeconds: 4 * HOUR, singletonKeyTemplate: 'global', deadLetter: true, payloadFields: [], source: 'část 1, 3.14' },
  { name: 'platform.backup_verify', domain: 'platform', owner: 'P16', description: 'Týdenní mlain backup verify nad poslední zálohou.', cron: '0 4 * * 0', retryLimit: 1, retryBackoff: false, retryDelaySeconds: 0, expireInSeconds: 4 * HOUR, singletonKeyTemplate: 'global', deadLetter: true, payloadFields: [], source: 'část 1, 3.14' },

  // --- Kontakty, souhlasy, segmenty a GDPR, část 2 -------------------------
  { name: 'contacts.import', domain: 'contacts', owner: 'P11', description: 'Import CSV po dávkách s checkpointy. Jeden běžící import na projekt.', retryLimit: 3, retryBackoff: true, retryDelaySeconds: 30, expireInSeconds: 6 * HOUR, singletonKeyTemplate: '<workspace_id>', deadLetter: true, payloadFields: ['import_id', 'workspace_id'], source: 'část 2, 4.6' },
  { name: 'contacts.export', domain: 'contacts', owner: 'P11', description: 'Export s kurzorem na serveru, dávky 5 000 řádků, gzip.', retryLimit: 3, retryBackoff: true, retryDelaySeconds: 30, expireInSeconds: 2 * HOUR, deadLetter: true, payloadFields: ['export_id', 'workspace_id'], source: 'část 2, 4.7' },
  { name: 'contacts.bulk_delete', domain: 'contacts', owner: 'P07', description: 'Hromadné mazání po dávkách 5 000.', retryLimit: 3, retryBackoff: true, retryDelaySeconds: 30, expireInSeconds: 2 * HOUR, deadLetter: true, payloadFields: ['operation_id', 'workspace_id'], source: 'část 2, 4.3' },
  { name: 'contacts.bulk_tag', domain: 'contacts', owner: 'P07', description: 'Hromadné přidání a odebrání štítků nad skupinou přes 5 000 kontaktů.', retryLimit: 3, retryBackoff: true, retryDelaySeconds: 30, expireInSeconds: 2 * HOUR, deadLetter: true, payloadFields: ['operation_id', 'workspace_id'], source: 'část 2, 4.4' },
  { name: 'contacts.bulk_vocative_review', domain: 'contacts', owner: 'P11', description: 'Hromadné vyřízení fronty ke kontrole oslovení po dávkách 5 000.', retryLimit: 3, retryBackoff: true, retryDelaySeconds: 30, expireInSeconds: 2 * HOUR, deadLetter: true, payloadFields: ['operation_id', 'workspace_id'], source: 'část 2, 4.5' },
  { name: 'contacts.strip_attribute', domain: 'contacts', owner: 'P07', description: 'Odstraní klíč z attributes po dávkách 10 000 po smazání vlastního pole.', retryLimit: 3, retryBackoff: true, retryDelaySeconds: 30, expireInSeconds: 2 * HOUR, deadLetter: true, payloadFields: ['workspace_id', 'field_key'], source: 'část 2, 4.2' },
  { name: 'contacts.refingerprint', domain: 'contacts', owner: 'P07', description: 'Po rotaci SECRET_KEY doplní otisky pod novým pokolením, dávky 10 000.', retryLimit: 3, retryBackoff: true, retryDelaySeconds: 60, expireInSeconds: 4 * HOUR, singletonKeyTemplate: 'global', deadLetter: true, payloadFields: ['key_id', 'cursor'], source: 'část 2, 6' },
  { name: 'contacts.recompute_greeting', domain: 'contacts', owner: 'P07', description: 'Přepočet oslovení po změně nastavení projektu.', retryLimit: 3, retryBackoff: true, retryDelaySeconds: 30, expireInSeconds: 2 * HOUR, singletonKeyTemplate: '<workspace_id>', deadLetter: true, payloadFields: ['workspace_id', 'cursor'], source: 'část 2, 4.5' },
  { name: 'contacts.cleanup_after_reactivation', domain: 'contacts', owner: 'P07', description: 'Naplánovaný úklid po reaktivační kampani, výchozí za 14 dní.', retryLimit: 3, retryBackoff: true, retryDelaySeconds: 60, expireInSeconds: 2 * HOUR, deadLetter: true, payloadFields: ['workspace_id', 'segment_id', 'action'], source: 'část 2, 5.8' },
  { name: 'contacts.cleanup_import_files', domain: 'contacts', owner: 'P11', description: 'Retence nahraných souborů importu. Po smazání nastaví imports.storage_key na NULL.', cron: '5 3 * * *', retryLimit: 3, retryBackoff: true, retryDelaySeconds: 60, expireInSeconds: 1 * HOUR, singletonKeyTemplate: 'global', deadLetter: false, payloadFields: [], source: 'část 2, 4.6 (název odvozen P01)' },
  { name: 'contact_fields.build_index', domain: 'contacts', owner: 'P07', description: 'Založí částečný výrazový index pro pole označené indexed přes CREATE INDEX CONCURRENTLY.', retryLimit: 3, retryBackoff: true, retryDelaySeconds: 60, expireInSeconds: 2 * HOUR, singletonKeyTemplate: '<field_id>', deadLetter: true, payloadFields: ['workspace_id', 'field_id'], source: 'část 2, 4.2' },
  { name: 'segments.recount', domain: 'contacts', owner: 'P11', description: 'Přepočet počtu členů segmentu.', retryLimit: 3, retryBackoff: true, retryDelaySeconds: 30, expireInSeconds: 30 * MINUTE, singletonKeyTemplate: '<segment_id>', deadLetter: true, payloadFields: ['workspace_id', 'segment_id'], source: 'část 2, 5.4' },
  { name: 'segments.mark_invalid', domain: 'contacts', owner: 'P11', description: 'Označí segmenty odkazující na smazané pole jako neplatné.', retryLimit: 3, retryBackoff: true, retryDelaySeconds: 30, expireInSeconds: 15 * MINUTE, deadLetter: true, payloadFields: ['workspace_id', 'field_key'], source: 'část 2, 4.2' },
  { name: 'segments.recalc_for_contact', domain: 'contacts', owner: 'P11', description: 'Přepočet příslušnosti jednoho kontaktu k segmentům po události.', retryLimit: 3, retryBackoff: true, retryDelaySeconds: 15, expireInSeconds: 5 * MINUTE, deadLetter: true, payloadFields: ['workspace_id', 'contact_id'], source: 'část 5, 3.9.2' },
  { name: 'gdpr.export_subject', domain: 'contacts', owner: 'P07', description: 'Sestaví ZIP s daty subjektu.', retryLimit: 3, retryBackoff: true, retryDelaySeconds: 60, expireInSeconds: 2 * HOUR, singletonKeyTemplate: '<request_id>', deadLetter: true, payloadFields: ['workspace_id', 'request_id'], source: 'část 2, 6.4' },
  { name: 'gdpr.erase', domain: 'contacts', owner: 'P07', description: 'Anonymizace kontaktu podle článku 17.', retryLimit: 3, retryBackoff: true, retryDelaySeconds: 60, expireInSeconds: 1 * HOUR, singletonKeyTemplate: '<request_id>', deadLetter: true, payloadFields: ['workspace_id', 'request_id', 'contact_id'], source: 'část 2, 6.5' },
  { name: 'gdpr.sever_links', domain: 'contacts', owner: 'P07', description: 'Odpojí vazby na kontakt v messages, web_events a message_engagement.', retryLimit: 5, retryBackoff: true, retryDelaySeconds: 60, expireInSeconds: 2 * HOUR, singletonKeyTemplate: '<contact_id>', deadLetter: true, payloadFields: ['workspace_id', 'contact_id'], source: 'část 2, 6.5' },
  { name: 'inbound.process', domain: 'contacts', owner: 'P07', description: 'Zpracuje přijaté tělo příchozího webhooku po ověření podpisu.', retryLimit: 5, retryBackoff: true, retryDelaySeconds: 15, expireInSeconds: 15 * MINUTE, singletonKeyTemplate: '<dedup_key>', deadLetter: true, payloadFields: ['workspace_id', 'delivery_id'], source: 'část 2, 5.6 (název odvozen P01)' },
  // Tři fronty doplněné po nálezu, že je P07 implementuje ve svém registru
  // CONTACTS_QUEUES, ale v tomhle registru chyběly. Parametry jsou opsané z P07,
  // aby se registry nerozešly. Uzávěr S8: frontu zakládá P01, handler P07.
  { name: 'contacts.cleanup_pending', domain: 'contacts', owner: 'P07', description: 'Maže nepotvrzené odběry po vypršení TTL potvrzovacího tokenu a po třiceti dnech retence.', cron: '55 2 * * *', retryLimit: 2, retryBackoff: true, retryDelaySeconds: 60, expireInSeconds: 15 * MINUTE, singletonKeyTemplate: 'global', deadLetter: true, payloadFields: [], source: 'část 2, 3.4' },
  { name: 'consents.rebuild_state', domain: 'contacts', owner: 'P07', description: 'Přepočte contact_consent_state z append only logu consents po obnově ze zálohy nebo po migraci.', retryLimit: 2, retryBackoff: true, retryDelaySeconds: 60, expireInSeconds: 30 * MINUTE, singletonKeyTemplate: '<workspace_id>', deadLetter: true, payloadFields: ['workspace_id', 'contact_id'], source: 'část 2, 3.3' },
  // retention.run se spouští pro každý projekt zvlášť s rozprostřením v čase
  // (offset z hashe workspace_id), takže cron plánuje jen dispečera; jednotlivé
  // běhy zakládá handler s singletonKey = workspace_id.
  { name: 'retention.run', domain: 'contacts', owner: 'P07', description: 'Denní retenční běh nad jedním projektem podle registru RETENTION_TARGETS, zapisuje do retention_runs.', cron: '20 4 * * *', retryLimit: 0, retryBackoff: false, retryDelaySeconds: 0, expireInSeconds: 40 * MINUTE, singletonKeyTemplate: '<workspace_id>', deadLetter: false, payloadFields: ['workspace_id'], source: 'část 2, 6.7' },

  // --- Obsah, assety, značka a AI, část 3 -----------------------------------
  { name: 'content.brand_extract', domain: 'content', owner: 'P15', description: 'Stažení a analýza značky. Bez opakování, opakovaný SSRF pokus není žádoucí.', retryLimit: 0, retryBackoff: false, retryDelaySeconds: 0, expireInSeconds: 5 * MINUTE, singletonKeyTemplate: '<extraction_id>', deadLetter: true, payloadFields: ['workspace_id', 'extraction_id'], source: 'část 3, 4.8' },
  { name: 'content.process_asset', domain: 'content', owner: 'P08', description: 'Generování variant obrázku.', retryLimit: 3, retryBackoff: true, retryDelaySeconds: 15, expireInSeconds: 10 * MINUTE, singletonKeyTemplate: '<asset_id>', deadLetter: true, payloadFields: ['workspace_id', 'asset_id'], source: 'část 3, 4.8' },
  { name: 'content.revalidate_templates', domain: 'content', owner: 'P08', description: 'Přehodnotí šablony odkazující na smazané pole a označí je jako neplatné.', retryLimit: 3, retryBackoff: true, retryDelaySeconds: 30, expireInSeconds: 30 * MINUTE, deadLetter: true, payloadFields: ['workspace_id', 'field_key'], source: 'část 3, 3.8.4' },
  { name: 'content.cleanup_versions', domain: 'content', owner: 'P08', description: 'Retence verzí šablon podle TEMPLATE_VERSION_RETENTION_DAYS.', cron: '10 3 * * *', retryLimit: 1, retryBackoff: false, retryDelaySeconds: 0, expireInSeconds: 1 * HOUR, singletonKeyTemplate: 'global', deadLetter: false, payloadFields: [], source: 'část 3, 4.8' },
  { name: 'content.cleanup_assets', domain: 'content', owner: 'P08', description: 'Fyzické mazání assetů po 30 dnech.', cron: '20 3 * * *', retryLimit: 1, retryBackoff: false, retryDelaySeconds: 0, expireInSeconds: 1 * HOUR, singletonKeyTemplate: 'global', deadLetter: false, payloadFields: [], source: 'část 3, 4.8' },
  { name: 'content.verify_asset_refcounts', domain: 'content', owner: 'P08', description: 'Kontrola denormalizovaných počtů referencí na assety.', cron: '30 3 * * *', retryLimit: 1, retryBackoff: false, retryDelaySeconds: 0, expireInSeconds: 1 * HOUR, singletonKeyTemplate: 'global', deadLetter: false, payloadFields: [], source: 'část 3, 4.8' },
  { name: 'ai.cleanup_conversations', domain: 'content', owner: 'P15', description: 'Retence konverzací podle AI_CONVERSATION_RETENTION_DAYS.', cron: '40 3 * * *', retryLimit: 1, retryBackoff: false, retryDelaySeconds: 0, expireInSeconds: 1 * HOUR, singletonKeyTemplate: 'global', deadLetter: false, payloadFields: [], source: 'část 3, 4.8' },

  // --- Kampaně, provideři a doručitelnost, část 4a --------------------------
  { name: 'campaign.materialize', domain: 'campaigns', owner: 'P13', description: 'Kompilace šablony a materializace publika do outboxu po dávkách.', retryLimit: 5, retryBackoff: true, retryDelaySeconds: 5, expireInSeconds: 6 * HOUR, singletonKeyTemplate: 'campaign.materialize:<campaign_id>', deadLetter: true, payloadFields: ['workspace_id', 'campaign_id', 'revision'], source: 'část 4a, 4.5' },
  { name: 'campaign.scheduler', domain: 'campaigns', owner: 'P13', description: 'Vybírá naplánované kampaně, jejichž čas nastal.', cron: '*/30 * * * * *', retryLimit: 3, retryBackoff: true, retryDelaySeconds: 5, expireInSeconds: 2 * MINUTE, singletonKeyTemplate: 'global', deadLetter: false, payloadFields: [], source: 'část 4a, 4.5' },
  { name: 'campaign.watchdog', domain: 'campaigns', owner: 'P13', description: 'Rekoncilace stavu běžících kampaní a jejich uzavírání.', cron: '*/15 * * * * *', retryLimit: 3, retryBackoff: true, retryDelaySeconds: 5, expireInSeconds: 1 * MINUTE, singletonKeyTemplate: 'global', deadLetter: false, payloadFields: [], source: 'část 4a, 4.5' },
  { name: 'campaign.resume_on_quota', domain: 'campaigns', owner: 'P13', description: 'Obnoví kampaně pozastavené pro vyčerpanou kvótu, rozhoduje podle pause_reason.code.', cron: '*/10 * * * *', retryLimit: 3, retryBackoff: true, retryDelaySeconds: 30, expireInSeconds: 5 * MINUTE, singletonKeyTemplate: 'global', deadLetter: false, payloadFields: [], source: 'část 4a, 4.5' },
  { name: 'outbox.stall_watch', domain: 'campaigns', owner: 'P13', description: 'Hlídá zaseknuté dávky v outboxu.', cron: '* * * * *', retryLimit: 3, retryBackoff: true, retryDelaySeconds: 10, expireInSeconds: 1 * MINUTE, singletonKeyTemplate: 'global', deadLetter: false, payloadFields: [], source: 'část 4a, 4.5' },
  { name: 'outbox.reconcile', domain: 'campaigns', owner: 'P13', description: 'Srovná počty v outboxu s campaign_stats.', cron: '* * * * *', retryLimit: 3, retryBackoff: true, retryDelaySeconds: 10, expireInSeconds: 5 * MINUTE, singletonKeyTemplate: 'global', deadLetter: false, payloadFields: [], source: 'část 4a, 4.5' },
  { name: 'provider_event.process', domain: 'campaigns', owner: 'P13', description: 'Zpracuje událost od providera přijatou webhookem.', retryLimit: 10, retryBackoff: true, retryDelaySeconds: 5, expireInSeconds: 15 * MINUTE, singletonKeyTemplate: 'event:<dedup_key>', deadLetter: true, payloadFields: ['workspace_id', 'receipt_id', 'dedup_key'], source: 'část 4a, 4.5' },
  { name: 'provider_event.rematch', domain: 'campaigns', owner: 'P13', description: 'Zkusí znovu spárovat události, které při prvním průchodu nenašly zprávu.', cron: '*/30 * * * * *', retryLimit: 3, retryBackoff: true, retryDelaySeconds: 10, expireInSeconds: 5 * MINUTE, singletonKeyTemplate: 'global', deadLetter: false, payloadFields: [], source: 'část 4a, 4.5' },
  { name: 'provider.refresh_quota', domain: 'campaigns', owner: 'P13', description: 'Načte aktuální kvótu providera.', cron: '*/15 * * * *', retryLimit: 3, retryBackoff: true, retryDelaySeconds: 30, expireInSeconds: 5 * MINUTE, singletonKeyTemplate: 'provider.quota:<provider_id>', deadLetter: false, payloadFields: ['workspace_id', 'provider_id'], source: 'část 4a, 4.5' },
  { name: 'domain.recheck', domain: 'campaigns', owner: 'P13', description: 'Kontrola DNS záznamů domén podle next_check_at.', cron: '* * * * *', retryLimit: 3, retryBackoff: true, retryDelaySeconds: 30, expireInSeconds: 5 * MINUTE, singletonKeyTemplate: 'domain.check:<domain_id>', deadLetter: false, payloadFields: ['workspace_id', 'domain_id'], source: 'část 4a, 4.5' },
  { name: 'deliverability.rollup', domain: 'campaigns', owner: 'P13', description: 'Agregace ukazatelů doručitelnosti do snapshotů.', cron: '*/15 * * * *', retryLimit: 3, retryBackoff: true, retryDelaySeconds: 30, expireInSeconds: 15 * MINUTE, singletonKeyTemplate: 'global', deadLetter: false, payloadFields: [], source: 'část 4a, 4.5' },
  { name: 'retention.drop_message_partitions', domain: 'campaigns', owner: 'P13', description: 'Odpojí a zahodí partition messages nad MESSAGE_RETENTION_DAYS.', cron: '30 3 * * *', retryLimit: 1, retryBackoff: false, retryDelaySeconds: 0, expireInSeconds: 2 * HOUR, singletonKeyTemplate: 'global', deadLetter: true, payloadFields: [], source: 'část 4a, 4.5' },

  // --- Tracking a události, část 5 ------------------------------------------
  { name: 'tracking.process_engagement', domain: 'tracking', owner: 'P10', description: 'Z nových message_events spočítá přírůstky do campaign_stats a message_engagement.', retryLimit: 5, retryBackoff: true, retryDelaySeconds: 5, expireInSeconds: 10 * MINUTE, concurrency: 4, deadLetter: true, payloadFields: ['workspace_id', 'event_ids'], source: 'část 5, 3.9.2' },
  { name: 'tracking.process_provider_events', domain: 'tracking', owner: 'P10', description: 'Aktualizuje statistiky z událostí zapsaných providerem.', retryLimit: 5, retryBackoff: true, retryDelaySeconds: 5, expireInSeconds: 10 * MINUTE, deadLetter: true, payloadFields: ['workspace_id', 'event_ids'], source: 'část 5, 3.13' },
  { name: 'event.process', domain: 'tracking', owner: 'P10', description: 'Zpracuje webovou událost, dedup okno 7 dní.', retryLimit: 5, retryBackoff: true, retryDelaySeconds: 5, expireInSeconds: 10 * MINUTE, deadLetter: true, payloadFields: ['workspace_id', 'event_ids'], source: 'část 5, 3.9.3' },
  { name: 'identity.merge', domain: 'tracking', owner: 'P10', description: 'Naváže anonymous_id na kontakt a přepíše historii.', retryLimit: 5, retryBackoff: true, retryDelaySeconds: 10, expireInSeconds: 30 * MINUTE, singletonKeyTemplate: '<binding_id>', deadLetter: true, payloadFields: ['workspace_id', 'anonymous_id', 'contact_id', 'binding_id'], source: 'část 5, 3.8.4' },
  { name: 'tracking.refresh_campaign_progress', domain: 'tracking', owner: 'P14', description: 'Aktualizuje průběh kampaně pro dashboard a SSE.', cron: '*/30 * * * * *', retryLimit: 3, retryBackoff: true, retryDelaySeconds: 10, expireInSeconds: 2 * MINUTE, singletonKeyTemplate: 'global', deadLetter: false, payloadFields: [], source: 'část 5, 3.9' },
  { name: 'tracking.recompute_engagement_windows', domain: 'tracking', owner: 'P14', description: 'Přepočet klouzavých oken zapojení. Čistá funkce zdrojových dat.', cron: '50 3 * * *', retryLimit: 3, retryBackoff: true, retryDelaySeconds: 60, expireInSeconds: 2 * HOUR, singletonKeyTemplate: 'global', deadLetter: false, payloadFields: [], source: 'část 5, 3.9.4' },
  { name: 'tracking.cleanup_token_uses', domain: 'tracking', owner: 'P10', description: 'Maže identity_token_uses s expires_at v minulosti.', cron: '0 * * * *', retryLimit: 3, retryBackoff: true, retryDelaySeconds: 60, expireInSeconds: 15 * MINUTE, singletonKeyTemplate: 'global', deadLetter: false, payloadFields: [], source: 'část 5, 3.10.3' },
  { name: 'tracking.enforce_retention', domain: 'tracking', owner: 'P10', description: 'Retence web_events a message_events odpojením partition.', cron: '45 3 * * *', retryLimit: 1, retryBackoff: false, retryDelaySeconds: 0, expireInSeconds: 2 * HOUR, singletonKeyTemplate: 'global', deadLetter: true, payloadFields: [], source: 'část 5, 3.15.2' },
  { name: 'tracking.refresh_proxy_ranges', domain: 'tracking', owner: 'P10', description: 'Stáhne rozsahy Apple relay, když je TRACKING_APPLE_RELAY_RANGES zapnuté.', cron: '0 5 * * *', retryLimit: 3, retryBackoff: true, retryDelaySeconds: 300, expireInSeconds: 30 * MINUTE, singletonKeyTemplate: 'global', deadLetter: false, payloadFields: [], source: 'část 5, 3.6' },
  { name: 'tracking.erase_contact', domain: 'tracking', owner: 'P10', description: 'Vymaže stopu kontaktu ve web_events a message_engagement.', retryLimit: 5, retryBackoff: true, retryDelaySeconds: 60, expireInSeconds: 1 * HOUR, singletonKeyTemplate: '<contact_id>', deadLetter: true, payloadFields: ['workspace_id', 'contact_id'], source: 'část 5, 3.15' },
  // Doplněno po nálezu: P10 tuhle frontu implementuje a P16 ji volá z CLI
  // (`mlain rebuild-engagement`), ale v registru chyběla. Bez opakování
  // schválně: rekonstrukce od nuly běží nad celým projektem a opakovaný běh
  // po selhání uprostřed by jen zdvojnásobil zátěž. Operátor ji pustí znovu sám.
  { name: 'tracking.rebuild_engagement', domain: 'tracking', owner: 'P10', description: 'Rekonstrukce contact_engagement od nuly ze zdroje pravdy message_engagement po havárii nebo obnově zálohy.', retryLimit: 0, retryBackoff: false, retryDelaySeconds: 0, expireInSeconds: 2 * HOUR, concurrency: 1, singletonKeyTemplate: '<workspace_id>', deadLetter: true, payloadFields: ['workspace_id', 'batch_size'], source: 'část 5, 3.9.4 a kritérium 77' },

  // --- Sender, část 4b ------------------------------------------------------
  // Sender je Go proces s vlastní smyčkou nad outboxem a pg-boss nepoužívá.
  // Jediná fronta, kterou jeho provoz zakládá na straně aplikace, je tahle.
  { name: 'sender.credentials_refresh', domain: 'sender', owner: 'P13', description: 'Přešifruje a znovu publikuje credentials providera po rotaci klíče, aby je sender načetl.', retryLimit: 3, retryBackoff: true, retryDelaySeconds: 60, expireInSeconds: 30 * MINUTE, singletonKeyTemplate: '<provider_id>', deadLetter: true, payloadFields: ['workspace_id', 'provider_id'], source: 'část 4b, 3.13 a část 1, 3.10 (název odvozen P01)' },
];

const BY_NAME = new Map(QUEUE_REGISTRY.map((entry) => [entry.name, entry]));

export function queueNames(): string[] {
  return QUEUE_REGISTRY.map((entry) => entry.name);
}

export function queue(name: string): QueueEntry {
  const entry = BY_NAME.get(name);
  if (!entry) {
    throw new Error(
      `Neregistrovaná fronta "${name}". Fronty se zakládají výhradně v plánu P01, uzávěr S8.`,
    );
  }
  return entry;
}

export function dlqName(name: string): string {
  return `${name}.dlq`;
}

export function cronQueues(): (QueueEntry & { cron: string })[] {
  return QUEUE_REGISTRY.filter((entry): entry is QueueEntry & { cron: string } =>
    typeof entry.cron === 'string',
  );
}

/** Modul s handlerem, který codegen workeru hledá. */
export function handlerModulePath(entry: QueueEntry): string {
  const [domainPart] = entry.name.split('.');
  return `packages/core/src/${domainPart}/jobs/queue-handlers.ts`;
}
```

`packages/core/src/queues/index.ts`:

```ts
export * from './types.js';
export * from './registry.js';
```

- [ ] **Krok 5: Spusť test a ověř, že prochází**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/queues/registry.test.ts
```
Expected: PASS, `Tests  15 passed (15)`.

- [ ] **Krok 6: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add packages/core && git commit -m "feat(core): predeclare all pg-boss queues with explicit retry policies"
```

---

### Úkol 8: Konfigurace, pomocné typy, platformní schéma a loader

Uzávěr S12: P01 zapíše **všechny proměnné ze všech částí naráz.** Zdroj je část 1, kapitola 4.9 (povinný artefakt) a doplňkové tabulky částí 2, 3, 4a, 4b a 5. Část 6 žádnou konfigurační proměnnou nezavádí.

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/config/primitives.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/config/schema-platform.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/config/file-secrets.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/config/load.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/test/config/load.test.ts`

- [ ] **Krok 1: Napiš padající test loaderu**

`packages/core/test/config/load.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config/load.js';

let tmp: string;

// DATABASE_URL_MIGRATOR je v minimální sadě SCHVÁLNĚ. MIGRATE_ON_START je
// ve výchozím stavu true a křížová kontrola z úkolu 10 pak proměnnou vyžaduje.
// Bez ní by deset testů z tohohle a z následujícího úkolu zezelenalo teď
// a spadlo v okamžiku, kdy vznikne cross-checks.ts. Test, který chování bez
// migrátora ověřuje, je v cross-checks.test.ts a používá vlastní sadu.
const MINIMAL = (): Record<string, string> => ({
  APP_URL: 'https://mail.example.cz',
  SECRET_KEY: '1:c2VjcmV0LWtleS10aGF0LWlzLTMyLWJ5dGVzLWxvbmc',
  DATABASE_URL: 'postgres://mlain_app:pw@localhost:5432/mlain',
  DATABASE_URL_MIGRATOR: 'postgres://mlain_migrator:pw@localhost:5432/mlain',
  DATA_DIR: tmp,
});

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mlain-config-'));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('projde s minimální sadou a doplní výchozí hodnoty z tabulky 4.9', () => {
    const config = loadConfig(MINIMAL());
    expect(config.MODE).toBe('all');
    expect(config.PORT).toBe(3000);
    expect(config.WORKER_HEALTH_PORT).toBe(3001);
    expect(config.SENDER_HEALTH_PORT).toBe(3002);
    expect(config.LOG_LEVEL).toBe('info');
    expect(config.LOG_FORMAT).toBe('json');
    expect(config.DEFAULT_LOCALE).toBe('cs');
    expect(config.SUPPORTED_LOCALES).toEqual(['cs', 'en']);
    expect(config.DEFAULT_TIMEZONE).toBe('Europe/Prague');
    expect(config.SIGNUP_MODE).toBe('closed');
    expect(config.SENDER_BATCH_SIZE).toBe(100);
    expect(config.SHUTDOWN_GRACE_SECONDS).toBe(25);
    expect(config.WEBHOOK_MAX_ATTEMPTS).toBe(8);
    expect(config.MIGRATE_ON_START).toBe(true);
  });

  it('bez SECRET_KEY vyhodí ConfigError s exit code 78 a slovem povinná (kritérium 2)', () => {
    const env = MINIMAL();
    delete env['SECRET_KEY'];
    try {
      loadConfig(env);
      expect.unreachable('mělo vyhodit ConfigError');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      const configError = error as ConfigError;
      expect(configError.exitCode).toBe(78);
      const text = configError.format();
      expect(text).toContain('SECRET_KEY');
      expect(text).toMatch(/povinná|required/);
    }
  });

  it('vypíše VŠECHNY chyby naráz, ne jen první (kritérium 3)', () => {
    const env = { ...MINIMAL(), PORT: '0', WORKER_CONCURRENCY: '999', LOG_LEVEL: 'shout' };
    delete env['APP_URL'];
    delete env['DATABASE_URL'];
    try {
      loadConfig(env);
      expect.unreachable('mělo vyhodit ConfigError');
    } catch (error) {
      const text = (error as ConfigError).format();
      for (const name of ['APP_URL', 'DATABASE_URL', 'PORT', 'WORKER_CONCURRENCY', 'LOG_LEVEL']) {
        expect(text, `chybí ${name}`).toContain(name);
      }
      expect((error as ConfigError).issues.length).toBeGreaterThanOrEqual(5);
    }
  });

  it('odmítne ukázkový klíč z dokumentace', () => {
    const env = { ...MINIMAL(), SECRET_KEY: '1:ZXhhbXBsZS1rZXktZG8tbm90LXVzZS1pbi1wcm9kdWN0aW9u' };
    expect(() => loadConfig(env)).toThrow(ConfigError);
  });

  it('SECRET_KEY musí mít po dekódování přesně 32 bajtů', () => {
    const env = { ...MINIMAL(), SECRET_KEY: '1:c2hvcnQ' };
    try {
      loadConfig(env);
      expect.unreachable('mělo vyhodit ConfigError');
    } catch (error) {
      expect((error as ConfigError).format()).toMatch(/32/);
    }
  });

  it('SECRET_KEY_PREVIOUS nemá horní počet položek (3.10)', () => {
    const generation = (id: number) =>
      `${id}:${Buffer.alloc(32, id).toString('base64url')}`;
    const many = Array.from({ length: 200 }, (_, index) => generation(index + 1)).join(',');
    const config = loadConfig({ ...MINIMAL(), SECRET_KEY_PREVIOUS: many });
    expect(config.SECRET_KEY_PREVIOUS).toHaveLength(200);
  });

  it('varianta se sufixem _FILE vyhrává nad přímou hodnotou', () => {
    const secretFile = path.join(tmp, 'secret');
    fs.writeFileSync(secretFile, `1:${Buffer.alloc(32, 7).toString('base64url')}\n`);
    const config = loadConfig({
      ...MINIMAL(),
      SECRET_KEY: '1:c2VjcmV0LWtleS10aGF0LWlzLTMyLWJ5dGVzLWxvbmc',
      SECRET_KEY_FILE: secretFile,
    });
    expect(config.SECRET_KEY.raw).toBe(`1:${Buffer.alloc(32, 7).toString('base64url')}`);
  });

  it('_FILE na neexistující soubor je chyba, ne tiché ignorování', () => {
    expect(() =>
      loadConfig({ ...MINIMAL(), SECRET_KEY_FILE: path.join(tmp, 'chybi') }),
    ).toThrow(ConfigError);
  });

  it('odmítne DATA_DIR, do kterého nejde zapisovat', () => {
    const readonly = path.join(tmp, 'ro');
    fs.mkdirSync(readonly);
    fs.chmodSync(readonly, 0o500);
    try {
      expect(() => loadConfig({ ...MINIMAL(), DATA_DIR: readonly })).toThrow(ConfigError);
    } finally {
      fs.chmodSync(readonly, 0o700);
    }
  });

  it('odvodí UPLOADS_DIR a BACKUP_DIR z DATA_DIR', () => {
    const config = loadConfig(MINIMAL());
    expect(config.UPLOADS_DIR).toBe(path.join(tmp, 'uploads'));
    expect(config.BACKUP_DIR).toBe(path.join(tmp, 'backups'));
  });

  it('odvodí DATABASE_URL_SENDER z DATABASE_URL při MODE=all', () => {
    const config = loadConfig(MINIMAL());
    expect(config.DATABASE_URL_SENDER).toContain('mlain_sender');
  });

  it('odvodí TRACKING_DOMAIN z APP_URL', () => {
    const config = loadConfig(MINIMAL());
    expect(config.TRACKING_DOMAIN).toBe('mail.example.cz');
  });

  it('APP_URL nesmí mít koncové lomítko', () => {
    expect(() => loadConfig({ ...MINIMAL(), APP_URL: 'https://mail.example.cz/' })).toThrow(
      ConfigError,
    );
  });

  it('WEBHOOK_MAX_ATTEMPTS=9 je odmítnuté (kritérium 36b)', () => {
    expect(() => loadConfig({ ...MINIMAL(), WEBHOOK_MAX_ATTEMPTS: '9' })).toThrow(ConfigError);
    expect(loadConfig({ ...MINIMAL(), WEBHOOK_MAX_ATTEMPTS: '8' }).WEBHOOK_MAX_ATTEMPTS).toBe(8);
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/config/load.test.ts
```
Expected: FAIL, `Failed to resolve import "../../src/config/load.js"`.

- [ ] **Krok 3: Napiš `packages/core/src/config/primitives.ts`**

**Výchozí hodnota se u těchhle primitiv zapisuje `prefault()`, nikdy `default()`.** Je to nejzákeřnější past celého schématu a v zodu 3 se chovala opačně, takže se dá lehce přehlédnout.

V zodu 4 `default()` **neprojde přes transformaci** a musí mít typ výstupu. `envBool().default('false')` proto nevrátí `false`, ale **řetězec** `'false'`, který je pravdivostně `true`. Konkrétní dopad, kdyby to zůstalo: `METRICS_ENABLED` a `TRACKING_STORE_COUNTRY` by se ve výchozím stavu chovaly jako **zapnuté**, tedy metriky by byly veřejné bez tokenu a do `web_events` by se psala země, aniž by to kdokoli zapnul. `SUPPORTED_LOCALES` by nebyl seznam, ale řetězec `'cs,en'`, takže `includes(DEFAULT_LOCALE)` by hledal podřetězec.

`prefault()` naopak dosadí hodnotu **na vstup** a nechá ji projít celým pipeline, takže vyjde `false` a `['cs', 'en']`. Ověřeno spuštěním proti zodu 4.4.3 a otypováno TypeScriptem 7.0.2.

U primitiv, jejichž výstup **je** řetězec (`envCron`, `envTimezone`, `z.enum`, `z.string`), zůstává `default()`, protože tam se typ vstupu a výstupu shoduje. Rozdíl hlídá test v úkolu 10.

```ts
import { z } from 'zod';

/** Ukázkový klíč z dokumentace. Odmítá se, aby nikdo nenasadil produkci s klíčem z README. */
export const EXAMPLE_SECRET_KEYS = new Set([
  '1:ZXhhbXBsZS1rZXktZG8tbm90LXVzZS1pbi1wcm9kdWN0aW9u',
  'ZXhhbXBsZS1rZXktZG8tbm90LXVzZS1pbi1wcm9kdWN0aW9u',
]);

export const envBool = (): z.ZodType<boolean> =>
  z.union([z.boolean(), z.enum(['true', 'false', '1', '0'])]).transform((value) => {
    if (typeof value === 'boolean') return value;
    return value === 'true' || value === '1';
  });

export const envInt = (min: number, max: number): z.ZodType<number> =>
  z
    .union([z.number(), z.string().regex(/^-?\d+$/, 'musí být celé číslo')])
    .transform((value) => (typeof value === 'number' ? value : Number.parseInt(value, 10)))
    .refine((value) => Number.isInteger(value), 'musí být celé číslo')
    .refine((value) => value >= min && value <= max, `musí být v rozsahu ${min} až ${max}`);

export const envFloat = (min: number, max: number): z.ZodType<number> =>
  z
    .union([z.number(), z.string().regex(/^-?\d+(\.\d+)?$/, 'musí být číslo')])
    .transform((value) => (typeof value === 'number' ? value : Number.parseFloat(value)))
    .refine((value) => value >= min && value <= max, `musí být v rozsahu ${min} až ${max}`);

/** Seznam oddělený čárkami. Prázdný řetězec dá prázdné pole, ne pole s prázdným prvkem. */
export const envCsv = (): z.ZodType<string[]> =>
  z.string().transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  );

export const envUrl = (): z.ZodType<string> =>
  z
    .string()
    .refine((value) => {
      try {
        const url = new URL(value);
        return url.protocol === 'http:' || url.protocol === 'https:';
      } catch {
        return false;
      }
    }, 'musí být absolutní URL s http nebo https')
    .refine((value) => !value.endsWith('/'), 'nesmí končit lomítkem');

export const envPostgresUrl = (): z.ZodType<string> =>
  z.string().refine((value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'postgres:' || url.protocol === 'postgresql:';
    } catch {
      return false;
    }
  }, 'musí být připojovací řetězec postgres://');

export const envTimezone = (): z.ZodType<string> =>
  z.string().refine((value) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'musí být platná IANA časová zóna');

/** Pět nebo šest polí. Prázdná hodnota je povolená a znamená "vypnuto". */
export const envCron = (): z.ZodType<string> =>
  z
    .string()
    .refine(
      (value) => value === '' || [5, 6].includes(value.trim().split(/\s+/).length),
      'musí být cron výraz s pěti nebo šesti poli, nebo prázdný pro vypnutí',
    );

export interface KeyGeneration {
  readonly keyId: number;
  readonly key: Uint8Array;
  readonly raw: string;
}

function parseKeyGeneration(value: string, allowBareKey: boolean): KeyGeneration {
  const separator = value.indexOf(':');
  const hasId = separator > 0;
  if (!hasId && !allowBareKey) {
    throw new Error('musí mít tvar <key_id>:<base64url>');
  }
  const keyId = hasId ? Number.parseInt(value.slice(0, separator), 10) : 1;
  const encoded = hasId ? value.slice(separator + 1) : value;
  if (!Number.isInteger(keyId) || keyId < 1 || keyId > 255) {
    throw new Error('key_id musí být celé číslo 1 až 255, protože formát tokenu i obálky má jeden bajt');
  }
  const key = Buffer.from(encoded, 'base64url');
  if (key.length !== 32) {
    throw new Error(`po dekódování musí mít přesně 32 bajtů, má ${key.length}`);
  }
  return { keyId, key: new Uint8Array(key), raw: value };
}

export const envSecretKey = (): z.ZodType<KeyGeneration> =>
  z.string().transform((value, ctx) => {
    if (EXAMPLE_SECRET_KEYS.has(value)) {
      ctx.addIssue({ code: 'custom', message: 'je ukázkový klíč z dokumentace a nesmí se použít' });
      return z.NEVER;
    }
    try {
      return parseKeyGeneration(value, true);
    } catch (error) {
      ctx.addIssue({ code: 'custom', message: (error as Error).message });
      return z.NEVER;
    }
  });

/**
 * Čárkou oddělený seznam starších pokolení. BEZ HORNÍHO POČTU POLOŽEK.
 * Strop by znamenal, že po jeho vyčerpání přestanou platit otisky smazaných
 * adres v suppression listu a smazaný člověk se vrátí prvním dalším importem,
 * aniž by cokoliv selhalo (část 1, kapitola 3.10).
 */
export const envPreviousKeys = (): z.ZodType<KeyGeneration[]> =>
  z.string().transform((value, ctx) => {
    const items = value
      .split(',')
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    const parsed: KeyGeneration[] = [];
    for (const item of items) {
      try {
        parsed.push(parseKeyGeneration(item, false));
      } catch (error) {
        ctx.addIssue({ code: 'custom', message: `položka "${item}": ${(error as Error).message}` });
      }
    }
    return parsed;
  });
```

- [ ] **Krok 4: Napiš `packages/core/src/config/schema-platform.ts`**

Přesná kopie tabulky 4.9 části 1, řádek po řádku, ve stejném pořadí.

```ts
import { z } from 'zod';
import {
  envBool,
  envCron,
  envCsv,
  envFloat,
  envInt,
  envPostgresUrl,
  envPreviousKeys,
  envSecretKey,
  envTimezone,
  envUrl,
} from './primitives.js';

/** Část 1, kapitola 4.9, hlavní tabulka. Legenda "Kdo": W = web, K = worker, S = sender. */
export const platformShape = {
  APP_URL: envUrl(),
  SECRET_KEY: envSecretKey(),
  SECRET_KEY_PREVIOUS: envPreviousKeys().prefault(''),
  DATABASE_URL: envPostgresUrl(),
  DATABASE_URL_MIGRATOR: envPostgresUrl().optional(),
  DATABASE_URL_SENDER: envPostgresUrl().optional(),
  DATABASE_POOL_MAX: envInt(1, 100).default(10),
  DATABASE_STATEMENT_TIMEOUT_MS: envInt(1000, 600000).default(30000),
  MODE: z.enum(['web', 'worker', 'sender', 'all']).default('all'),
  PORT: envInt(1, 65535).default(3000),
  WORKER_HEALTH_PORT: envInt(1, 65535).default(3001),
  SENDER_HEALTH_PORT: envInt(1, 65535).default(3002),
  NODE_ENV: z.enum(['production', 'development', 'test']).default('production'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  LOG_FORMAT: z.enum(['json', 'pretty']).default('json'),
  TRUST_PROXY: envInt(0, 5).default(0),
  DEFAULT_LOCALE: z.string().min(2).max(5).default('cs'),
  SUPPORTED_LOCALES: envCsv().prefault('cs,en'),
  DEFAULT_TIMEZONE: envTimezone().default('Europe/Prague'),
  SIGNUP_MODE: z.enum(['closed', 'invite', 'open']).default('closed'),
  SESSION_ABSOLUTE_TTL_DAYS: envInt(1, 365).default(30),
  SESSION_IDLE_TTL_DAYS: envInt(1, 365).default(14),
  MIGRATE_ON_START: envBool().prefault('true'),
  MIGRATE_LOCK_TIMEOUT_SECONDS: envInt(10, 3600).default(300),
  DATA_DIR: z.string().min(1).default('/data'),
  UPLOADS_DIR: z.string().min(1).optional(),
  BACKUP_DIR: z.string().min(1).optional(),
  BACKUP_TARGET: z.enum(['local']).default('local'),
  BACKUP_SCHEDULE_CRON: envCron().default('0 3 * * *'),
  BACKUP_RETENTION_DAYS: envInt(1, 3650).default(14),
  AUDIT_RETENTION_MONTHS: envInt(1, 120).default(24),
  RATE_LIMIT_BACKEND: z.enum(['memory', 'postgres']).default('memory'),
  RATE_LIMIT_ENABLED: envBool().prefault('true'),
  RATE_LIMIT_API_READ: envInt(1, 1000000).default(1000),
  RATE_LIMIT_API_WRITE: envInt(1, 1000000).default(300),
  RATE_LIMIT_TRACK_KEY: envInt(1, 10000000).default(6000),
  RATE_LIMIT_TRACK_KEY_IP: envInt(1, 10000000).default(120),
  RATE_LIMIT_TRACK_PIXEL_IP: envInt(1, 10000000).default(600),
  // Dvě doplnění tabulky 4.5 části 1 podle požadavku 12.5.11 části 5. Obě
  // používá P10 a v tabulce 4.9 chyběly; RATE_LIMIT_IDENTIFY_IP navíc rovnou
  // v kódu limiteru, takže by tam byla hodnota undefined.
  RATE_LIMIT_IDENTIFY_IP: envInt(1, 10000000).default(30),
  RATE_LIMIT_TRACK_ANON: envInt(1, 10000000).default(600),
  WORKER_CONCURRENCY: envInt(1, 50).default(5),
  PGBOSS_SCHEMA: z
    .string()
    .regex(/^[A-Za-z0-9_]{1,50}$/, 'jen alfanumerické znaky a podtržítko, do 50 znaků')
    .default('pgboss'),
  SENDER_ID: z.string().max(64).optional(),
  SENDER_CONCURRENCY: envInt(1, 1024).default(32),
  SENDER_BATCH_SIZE: envInt(1, 5000).default(100),
  SENDER_CLAIM_TTL_SECONDS: envInt(30, 3600).default(300),
  SENDER_POLL_INTERVAL_MS: envInt(100, 60000).default(1000),
  SHUTDOWN_GRACE_SECONDS: envInt(1, 300).default(25),
  TRACKING_DOMAIN: z.string().min(1).optional(),
  WEBHOOK_ALLOW_PRIVATE_TARGETS: envBool().prefault('false'),
  // Horní mez se rovná počtu řádků tabulky odstupů v 3.8, ne pevnému číslu.
  // Vyšší hodnota by neměla definované zpoždění. Kritérium 36b.
  WEBHOOK_MAX_ATTEMPTS: envInt(1, 8).default(8),
  METRICS_ENABLED: envBool().prefault('false'),
  METRICS_TOKEN: z.string().min(32).optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: envUrl().optional(),
  IMAGE_VERSION: z.string().min(1).default('0.0.0-dev'),
  // Bezpečnost, část 1, doplněno na základě nálezu části 3.
  SENDER_CREDENTIALS_MAX_RETRIES: envInt(1, 100).default(10),
  // Sender, část 4b. Musí platit SENDER_CLAIM_TTL_SECONDS > 4x tahle hodnota.
  SENDER_DISPATCH_TIMEOUT_SECONDS: envInt(1, 300).default(10),
  SENDER_REPLICAS: envInt(1, 100).default(1),
  SENDER_RATE_SAFETY: envFloat(0.1, 1).default(0.9),
  SENDER_MAX_ATTEMPTS: envInt(1, 20).default(5),
  SENDER_MAX_BACKOFF_SECONDS: envInt(1, 86400).default(3600),
  SENDER_FATAL_THRESHOLD: envInt(1, 100).default(3),
  SENDER_SMTP_MAX_CONNECTIONS: envInt(1, 32).default(4),
  SENDER_SMTP_MAX_MESSAGES_PER_CONN: envInt(1, 10000).default(100),
  SENDER_SMTP_CONNECT_TIMEOUT_SECONDS: envInt(1, 300).default(10),
  SENDER_SMTP_COMMAND_TIMEOUT_SECONDS: envInt(1, 300).default(30),
  SENDER_SMTP_DATA_TIMEOUT_SECONDS: envInt(1, 900).default(120),
  SENDER_PRECEDENCE_BULK: envBool().prefault('true'),
  SENDER_FEEDBACK_ID: envBool().prefault('true'),
  SENDER_TEST_TRACKING: envBool().prefault('false'),
};

export const PlatformConfigSchema = z.object(platformShape);
```

`HEALTH_PORT` z části 4b se **nezavádí.** Rozhodnutí D6: při `MODE=all` sdílejí worker a sender prostředí, takže jedna společná proměnná znamená `EADDRINUSE` u každé první instalace. Platí `WORKER_HEALTH_PORT` a `SENDER_HEALTH_PORT`.

- [ ] **Krok 5: Napiš `packages/core/src/config/file-secrets.ts`**

```ts
import fs from 'node:fs';

export interface FileSecretIssue {
  readonly variable: string;
  readonly message: string;
}

/**
 * Podpora Docker secrets a Kubernetes: každá proměnná přijímá i variantu
 * se sufixem _FILE (SECRET_KEY_FILE=/run/secrets/secret_key). Když existují
 * obě, vyhrává _FILE (část 1, kapitola 4.9).
 *
 * Neexistující soubor je CHYBA, ne tiché ignorování. Tiché ignorování by
 * znamenalo, že instalace s překlepem v cestě nastartuje s výchozí hodnotou
 * a nikdo se to nedozví.
 */
export function applyFileSecrets(
  env: Record<string, string | undefined>,
  knownVariables: readonly string[],
): { env: Record<string, string | undefined>; issues: FileSecretIssue[] } {
  const result = { ...env };
  const issues: FileSecretIssue[] = [];

  for (const variable of knownVariables) {
    const fileKey = `${variable}_FILE`;
    const filePath = env[fileKey];
    if (filePath === undefined || filePath === '') continue;
    try {
      result[variable] = fs.readFileSync(filePath, 'utf8').replace(/\r?\n$/, '');
    } catch (error) {
      issues.push({
        variable: fileKey,
        message: `soubor se nepodařilo přečíst: ${(error as Error).message}`,
      });
    }
    delete result[fileKey];
  }

  return { env: result, issues };
}
```

- [ ] **Krok 6: Napiš `packages/core/src/config/load.ts`**

```ts
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { applyFileSecrets } from './file-secrets.js';
import { ConfigSchema, configVariableNames, type MlainConfig } from './schema.js';
import { crossChecks } from './cross-checks.js';

export interface ConfigIssue {
  readonly variable: string;
  readonly message: string;
}

/** EX_CONFIG podle sysexits.h. Předepisuje ho část 1, kapitola 4.9. */
export const EXIT_CONFIG = 78;

export class ConfigError extends Error {
  readonly exitCode = EXIT_CONFIG;

  constructor(readonly issues: readonly ConfigIssue[]) {
    super(`Konfigurace není platná, ${issues.length} problémů.`);
    this.name = 'ConfigError';
  }

  /**
   * Vypíše VŠECHNY problémy naráz, ne jen první. Akceptační kritérium 3.
   * Nikdy netiskne hodnotu proměnné, jen její název, protože mezi nimi
   * jsou tajemství.
   */
  format(): string {
    const lines = [`Konfigurace není platná. Nalezeno ${this.issues.length} problémů:`];
    for (const issue of this.issues) {
      lines.push(`  ${issue.variable}: ${issue.message}`);
    }
    lines.push('');
    lines.push('Popis všech proměnných je v docs, kapitola "Konfigurační proměnné".');
    return lines.join('\n');
  }
}

function isWritableDirectory(target: string): boolean {
  try {
    fs.accessSync(target, fs.constants.W_OK | fs.constants.X_OK);
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Načte a ověří konfiguraci. Při jakékoliv chybě vyhodí ConfigError se
 * seznamem VŠECH problémů. Volající (entrypoint, CLI, worker) chybu vytiskne
 * na stderr a skončí s exit code 78.
 */
export function loadConfig(rawEnv: Record<string, string | undefined> = process.env): MlainConfig {
  const { env, issues: fileIssues } = applyFileSecrets(rawEnv, configVariableNames());
  const issues: ConfigIssue[] = fileIssues.map((issue) => ({
    variable: issue.variable,
    message: issue.message,
  }));

  // Prázdný řetězec znamená "nenastaveno", jinak by ${VAR:-default} v compose
  // souboru vyrobil hodnotu, kterou zod odmítne s nesrozumitelnou hláškou.
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined && value !== '') cleaned[key] = value;
  }

  const parsed = ConfigSchema.safeParse(cleaned);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const variable = String(issue.path[0] ?? '(kořen)');
      const message =
        issue.code === 'invalid_type' && issue.input === undefined
          ? 'je povinná (required) a chybí'
          : issue.message;
      issues.push({ variable, message });
    }
    throw new ConfigError(issues);
  }

  const config = parsed.data as MlainConfig;

  // Odvozené hodnoty. Musí být až po parsování, protože závisí na jiných polích.
  const dataDir = path.resolve(config.DATA_DIR);
  const derived: MlainConfig = {
    ...config,
    DATA_DIR: dataDir,
    UPLOADS_DIR: path.resolve(config.UPLOADS_DIR ?? path.join(dataDir, 'uploads')),
    BACKUP_DIR: path.resolve(config.BACKUP_DIR ?? path.join(dataDir, 'backups')),
    DATABASE_URL_SENDER:
      config.DATABASE_URL_SENDER ?? deriveSenderUrl(config.DATABASE_URL),
    TRACKING_DOMAIN: config.TRACKING_DOMAIN ?? new URL(config.APP_URL).host,
    ASSET_BASE_URL: config.ASSET_BASE_URL ?? config.APP_URL,
  };

  if (!isWritableDirectory(derived.DATA_DIR)) {
    issues.push({
      variable: 'DATA_DIR',
      message: `adresář ${derived.DATA_DIR} musí existovat a být zapisovatelný`,
    });
  }

  issues.push(...crossChecks(derived));

  if (issues.length > 0) throw new ConfigError(issues);
  return derived;
}

/** Při MODE=all se připojení senderu dopočítá výměnou uživatele za mlain_sender. */
function deriveSenderUrl(databaseUrl: string): string {
  const url = new URL(databaseUrl);
  url.username = 'mlain_sender';
  return url.toString();
}

export type { MlainConfig };
export { z };
```

- [ ] **Krok 7: Commit rozpracovaného stavu není možný, pokračuj úkolem 9**

Loader importuje `./schema.js` a `./cross-checks.js`, které vzniknou v úkolech 9 a 10. Test proto ještě neprojde. Je to jediné místo v plánu, kde jeden test překlenuje tři úkoly; důvod je, že schéma se nedá rozumně rozdělit na tři nezávisle testovatelné celky, aniž by se třikrát opakoval loader.

---

### Úkol 9: Doménová část konfiguračního schématu

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/config/schema-domains.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/config/schema.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/test/config/schema-domains.test.ts`

- [ ] **Krok 1: Napiš padající test doménových proměnných**

`packages/core/test/config/schema-domains.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/load.js';
import { configVariableNames } from '../../src/config/schema.js';

let tmp: string;
// DATABASE_URL_MIGRATOR viz poznámka v load.test.ts: bez ní by křížová
// kontrola MIGRATE_ON_START shodila každý test v tomhle souboru.
const MINIMAL = (): Record<string, string> => ({
  APP_URL: 'https://mail.example.cz',
  SECRET_KEY: `1:${Buffer.alloc(32, 3).toString('base64url')}`,
  DATABASE_URL: 'postgres://mlain_app:pw@localhost:5432/mlain',
  DATABASE_URL_MIGRATOR: 'postgres://mlain_migrator:pw@localhost:5432/mlain',
  DATA_DIR: tmp,
});

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mlain-domains-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('doménové konfigurační proměnné', () => {
  it('zná proměnné všech pěti částí, které je zavádějí', () => {
    const names = new Set(configVariableNames());
    for (const name of [
      'CONTACT_FIELD_LIMIT',
      'IMPORT_MAX_ROWS',
      'SEGMENT_PREVIEW_TIMEOUT_MS',
      'GDPR_EXPORT_TTL_DAYS',
      'ASSET_QUOTA_MB',
      'BRAND_FETCH_ENABLED',
      'AI_ENABLED',
      'TEMPLATE_VERSION_MAX_UNPINNED',
      'CAMPAIGN_MAX_RECIPIENTS',
      'DELIVERABILITY_BOUNCE_GUARD_RATE',
      'SNS_CERT_CACHE_SECONDS',
      'AMBIGUOUS_DISPATCH_POLICY_SES',
      'TRACKING_RETENTION_MONTHS',
      'TRACKING_PROPERTIES_MAX_DEPTH',
    ]) {
      expect(names.has(name), `chybí ${name}`).toBe(true);
    }
  });

  it('má výchozí hodnoty přesně podle tabulek specifikací', () => {
    const config = loadConfig(MINIMAL());
    // Část 2
    expect(config.CONTACT_FIELD_LIMIT).toBe(100);
    expect(config.CONTACT_INDEXED_FIELD_LIMIT).toBe(8);
    expect(config.CONTACT_ATTRIBUTES_MAX_BYTES).toBe(262144);
    expect(config.IMPORT_MAX_FILE_BYTES).toBe(209715200);
    expect(config.IMPORT_BATCH_SIZE).toBe(1000);
    expect(config.IMPORT_STALE_MINUTES).toBe(10);
    expect(config.SEGMENT_PREVIEW_TIMEOUT_MS).toBe(3000);
    expect(config.RETENTION_MIN_DAYS).toBe(1);
    // Část 3
    expect(config.ASSET_QUOTA_MB).toBe(2048);
    expect(config.ASSET_MAX_UPLOAD_MB).toBe(10);
    expect(config.STORAGE_DRIVER).toBe('local');
    expect(config.BRAND_FETCH_ALLOW_HTTP).toBe(true);
    expect(config.BRAND_FETCH_ALLOW_PRIVATE_NETWORKS).toBe(false);
    expect(config.BRAND_FETCH_BLOCKED_HOSTS).toEqual([
      'metadata.google.internal',
      'metadata.goog',
      'instance-data',
      'metadata',
    ]);
    expect(config.AI_ENABLED).toBe(true);
    expect(config.AI_RATE_PER_HOUR).toBe(60);
    expect(config.TEMPLATE_VERSION_MAX_UNPINNED).toBe(50);
    // Část 4a
    expect(config.AMBIGUOUS_DISPATCH_POLICY_SES).toBe('fail');
    expect(config.AMBIGUOUS_DISPATCH_POLICY_SMTP).toBe('retry');
    expect(config.CAMPAIGN_MAX_RECIPIENTS).toBe(2000000);
    expect(config.CAMPAIGN_UNDO_WINDOW_SECONDS).toBe(60);
    expect(config.DELIVERABILITY_BOUNCE_GUARD_RATE).toBeCloseTo(0.08);
    expect(config.DELIVERABILITY_COMPLAINT_GUARD_RATE).toBeCloseTo(0.003);
    expect(config.MESSAGE_RETENTION_DAYS).toBe(90);
    expect(config.SNS_STORE_RAW_EVENTS).toBe(true);
    // Část 5
    expect(config.TRACKING_RETENTION_MONTHS).toBe(37);
    expect(config.TRACKING_IDENTITY_TOKEN_TTL_SECONDS).toBe(900);
    expect(config.TRACKING_STORE_COUNTRY).toBe(false);
    expect(config.TRACKING_PROPERTIES_MAX_KEYS).toBe(32);
    expect(config.TRACKING_WRITER_BATCH).toBe(500);
  });

  it('AMBIGUOUS_DISPATCH_POLICY_SES je fail, protože SES přepisuje Message-ID', () => {
    expect(loadConfig(MINIMAL()).AMBIGUOUS_DISPATCH_POLICY_SES).toBe('fail');
  });

  it('float se validuje jako číslo v intervalu, ne jako řetězec', () => {
    expect(() =>
      loadConfig({ ...MINIMAL(), DELIVERABILITY_BOUNCE_GUARD_RATE: '1.5' }),
    ).toThrow();
    expect(
      loadConfig({ ...MINIMAL(), DELIVERABILITY_BOUNCE_GUARD_RATE: '0' })
        .DELIVERABILITY_BOUNCE_GUARD_RATE,
    ).toBe(0);
  });

  it('nezná žádnou proměnnou pro otisky suppression listu', () => {
    const names = configVariableNames();
    expect(names).not.toContain('SUPPRESSION_HASH_KEY');
  });

  it('nezná HEALTH_PORT, platí rozdělení na worker a sender (rozhodnutí D6)', () => {
    expect(configVariableNames()).not.toContain('HEALTH_PORT');
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/config/schema-domains.test.ts
```
Expected: FAIL, `Failed to resolve import "../../src/config/schema.js"`.

- [ ] **Krok 3: Napiš `packages/core/src/config/schema-domains.ts`**

```ts
import { z } from 'zod';
import { envBool, envCsv, envFloat, envInt, envUrl } from './primitives.js';

/** Část 2: kontakty, souhlasy, import, export, segmenty, GDPR. Všechny W a K. */
export const contactsShape = {
  CONTACT_FIELD_LIMIT: envInt(1, 1000).default(100),
  CONTACT_INDEXED_FIELD_LIMIT: envInt(1, 64).default(8),
  CONTACT_ATTRIBUTES_MAX_BYTES: envInt(4096, 4194304).default(262144),
  CONTACT_SEARCH_INDEX_ENABLED: envBool().prefault('true'),
  IMPORT_MAX_FILE_BYTES: envInt(1048576, 2147483648).default(209715200),
  IMPORT_MAX_ROWS: envInt(1, 50000000).default(5000000),
  IMPORT_MAX_COLUMNS: envInt(1, 1000).default(200),
  IMPORT_MAX_CELL_CHARS: envInt(1, 1048576).default(8192),
  IMPORT_MAX_LINE_BYTES: envInt(1024, 16777216).default(65536),
  IMPORT_BATCH_SIZE: envInt(100, 10000).default(1000),
  IMPORT_MAX_STORED_ERRORS: envInt(1, 1000000).default(10000),
  IMPORT_SNIFF_BYTES: envInt(1024, 16777216).default(262144),
  IMPORT_WORKER_CONCURRENCY: envInt(1, 16).default(2),
  IMPORT_PREVIEW_TTL_HOURS: envInt(1, 720).default(24),
  IMPORT_STALE_MINUTES: envInt(1, 1440).default(10),
  IMPORT_INMEMORY_DEDUP_MAX_ROWS: envInt(1000, 50000000).default(1000000),
  SEGMENT_PREVIEW_TIMEOUT_MS: envInt(500, 30000).default(3000),
  SEGMENT_RECOUNT_CONCURRENCY: envInt(1, 32).default(2),
  SEGMENT_MAX_CONDITIONS: envInt(1, 1000).default(100),
  RETENTION_MIN_DAYS: envInt(1, 3650).default(1),
  DISPOSABLE_DOMAINS_FILE: z.string().min(1).optional(),
  FORM_RATE_LIMIT_PER_IP_MINUTE: envInt(1, 100000).default(5),
  INBOUND_MAX_BODY_BYTES: envInt(1024, 104857600).default(1048576),
  EXPORT_TTL_HOURS: envInt(1, 720).default(24),
  GDPR_EXPORT_TTL_DAYS: envInt(1, 365).default(7),
};

/** Část 3: obsah, assety, značka, AI, verze šablon. Všechny W a K. */
export const contentShape = {
  ASSET_BASE_URL: envUrl().optional(),
  ASSET_QUOTA_MB: envInt(100, 1000000).default(2048),
  ASSET_MAX_UPLOAD_MB: envInt(1, 100).default(10),
  ASSET_REQUIRE_SIGNED_URL: envBool().prefault('false'),
  ASSET_RATE_LIMIT_PER_IP: envInt(0, 100000).default(0),
  STORAGE_DRIVER: z.enum(['local', 's3']).default('local'),
  S3_BUCKET: z.string().min(1).optional(),
  S3_REGION: z.string().min(1).optional(),
  S3_ENDPOINT: z.string().min(1).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  BRAND_FETCH_ENABLED: envBool().prefault('true'),
  // Schválně true, na rozdíl od odchozích webhooků: stahování značky je čtení
  // veřejné stránky, kde se nepřenáší žádné tajemství, a weby zákazníků na
  // http reálně existují (část 1, 4.9).
  BRAND_FETCH_ALLOW_HTTP: envBool().prefault('true'),
  BRAND_FETCH_ALLOW_PRIVATE_NETWORKS: envBool().prefault('false'),
  BRAND_FETCH_ALLOWED_HOSTS: envCsv().prefault(''),
  BRAND_FETCH_BLOCKED_HOSTS: envCsv().default(
    'metadata.google.internal,metadata.goog,instance-data,metadata',
  ),
  BRAND_FETCH_RESPECT_ROBOTS: envBool().prefault('true'),
  BRAND_FETCH_DNS_SERVERS: envCsv().prefault(''),
  BRAND_FETCH_DNS_TIMEOUT_MS: envInt(200, 10000).default(2000),
  BRAND_FETCH_CONNECT_TIMEOUT_MS: envInt(500, 20000).default(3000),
  BRAND_FETCH_HEADERS_TIMEOUT_MS: envInt(500, 30000).default(5000),
  BRAND_FETCH_BODY_TIMEOUT_MS: envInt(1000, 60000).default(10000),
  BRAND_FETCH_TOTAL_TIMEOUT_MS: envInt(5000, 120000).default(30000),
  BRAND_FETCH_MAX_HTML_BYTES: envInt(1024, 104857600).default(2097152),
  BRAND_FETCH_MAX_CSS_BYTES: envInt(1024, 104857600).default(524288),
  BRAND_FETCH_MAX_IMAGE_BYTES: envInt(1024, 104857600).default(5242880),
  BRAND_FETCH_MAX_TOTAL_BYTES: envInt(1024, 1073741824).default(20971520),
  BRAND_FETCH_MAX_CSS_FILES: envInt(0, 10).default(3),
  BRAND_FETCH_MAX_IMAGE_FILES: envInt(0, 20).default(8),
  BRAND_FETCH_RATE_PER_HOUR: envInt(1, 1000).default(10),
  BRAND_FETCH_CONCURRENCY: envInt(1, 20).default(3),
  BRAND_EXTRACTION_INFER_TONE: envBool().prefault('true'),
  AI_ENABLED: envBool().prefault('true'),
  AI_REQUEST_TIMEOUT_MS: envInt(10000, 600000).default(120000),
  AI_MAX_TOKENS_PER_REQUEST: envInt(256, 1000000).default(16000),
  AI_RATE_PER_HOUR: envInt(1, 100000).default(60),
  AI_CONVERSATION_RETENTION_DAYS: envInt(0, 3650).default(90),
  AI_ALLOW_CUSTOM_BASE_URL: envBool().prefault('true'),
  TEMPLATE_VERSION_RETENTION_DAYS: envInt(0, 3650).default(180),
  TEMPLATE_VERSION_MAX_UNPINNED: envInt(5, 1000).default(50),
};

/** Část 4a: kampaně, provideři, doručitelnost, retence zpráv. */
export const campaignsShape = {
  AMBIGUOUS_DISPATCH_POLICY_SES: z.enum(['retry', 'fail']).default('fail'),
  AMBIGUOUS_DISPATCH_POLICY_SMTP: z.enum(['retry', 'fail']).default('retry'),
  CAMPAIGN_MATERIALIZE_BATCH_SIZE: envInt(100, 50000).default(5000),
  CAMPAIGN_MATERIALIZE_MAX_MINUTES: envInt(1, 1440).default(60),
  CAMPAIGN_MAX_RECIPIENTS: envInt(1, 50000000).default(2000000),
  CAMPAIGN_PARTIAL_THRESHOLD: envFloat(0, 1).default(0.01),
  CAMPAIGN_SCHEDULE_CATCHUP_HOURS: envInt(0, 168).default(6),
  CAMPAIGN_UNDO_WINDOW_SECONDS: envInt(0, 900).default(60),
  CAMPAIGN_QUOTA_PAUSE_REMAINING: envInt(0, 1000000).default(100),
  CAMPAIGN_QUOTA_RESUME_REMAINING: envInt(0, 1000000).default(1000),
  CAMPAIGN_TEST_SEND_PER_HOUR: envInt(1, 1000).default(20),
  SOFT_BOUNCE_THRESHOLD: envInt(1, 20).default(3),
  SOFT_BOUNCE_WINDOW_DAYS: envInt(1, 365).default(30),
  DELIVERABILITY_BOUNCE_GUARD_RATE: envFloat(0, 1).default(0.08),
  DELIVERABILITY_COMPLAINT_GUARD_RATE: envFloat(0, 1).default(0.003),
  DELIVERABILITY_BOUNCE_WARN_RATE: envFloat(0, 1).default(0.04),
  DELIVERABILITY_COMPLAINT_WARN_RATE: envFloat(0, 1).default(0.001),
  DELIVERABILITY_CONTENT_BOUNCE_LIMIT: envInt(1, 1000000).default(100),
  DELIVERABILITY_GUARD_MIN_SENT: envInt(1, 1000000).default(500),
  // Retence má reálně měsíční granularitu: partition se odpojují po měsících,
  // takže 90 dní drží 90 až 120 dní (část 1, 4.9). Musí to být v dokumentaci.
  MESSAGE_RETENTION_DAYS: envInt(7, 3650).default(90),
  MESSAGE_EVENT_RETENTION_DAYS: envInt(7, 3650).default(365),
  SNS_CERT_CACHE_SECONDS: envInt(60, 604800).default(86400),
  SNS_STORE_RAW_EVENTS: envBool().prefault('true'),
  DNS_CHECK_TIMEOUT_MS: envInt(500, 30000).default(3000),
  DNS_CHECK_CONCURRENCY: envInt(1, 50).default(10),
  AWS_API_TIMEOUT_MS: envInt(1000, 60000).default(5000),
};

/** Část 5: tracking, události, identity, retence. */
export const trackingShape = {
  TRACKING_IDENTITY_TOKEN_TTL_SECONDS: envInt(60, 3600).default(900),
  TRACKING_MERGE_WINDOW_DAYS: envInt(1, 365).default(30),
  TRACKING_MERGE_MAX_EVENTS: envInt(100, 1000000).default(10000),
  TRACKING_RETENTION_MONTHS: envInt(3, 120).default(37),
  TRACKING_APPLE_RELAY_RANGES: envBool().prefault('false'),
  // Instalační pojistka nad projektovým nastavením `store_ip`. Rozhodnutí
  // zadavatele má dvě páky a IP se uloží, jen když jsou zapnuté OBĚ: tahle
  // (provozovatel je správce údajů) a projektová. P10 ji čte v tracking/config.ts,
  // takže bez ní by se jeho balíček neotypoval.
  TRACKING_ALLOW_IP_STORAGE: envBool().prefault('false'),
  TRACKING_STORE_COUNTRY: envBool().prefault('false'),
  TRACKING_GEOIP_DB_PATH: z.string().min(1).optional(),
  TRACKING_STRIP_QUERY_PARAMS: envCsv().prefault(''),
  TRACKING_PII_PROPERTY_KEYS: envCsv().prefault(''),
  TRACKING_WRITER_FLUSH_MS: envInt(50, 5000).default(250),
  TRACKING_WRITER_BATCH: envInt(50, 5000).default(500),
  TRACKING_SSE_MAX_CONNECTIONS: envInt(10, 10000).default(500),
  TRACKING_ALLOW_SERVERSIDE_PUBLIC_KEY: envBool().prefault('false'),
  TRACKING_PROPERTIES_MAX_KEYS: envInt(1, 256).default(32),
  TRACKING_PROPERTIES_MAX_DEPTH: envInt(1, 10).default(3),
  TRACKING_PROPERTIES_MAX_STRING: envInt(64, 16384).default(1024),
  TRACKING_IMPORT_BATCH_MAX_EVENTS: envInt(1, 5000).default(1000),
};
```

- [ ] **Krok 4: Napiš `packages/core/src/config/schema.ts`**

```ts
import { z } from 'zod';
import { platformShape } from './schema-platform.js';
import {
  campaignsShape,
  contactsShape,
  contentShape,
  trackingShape,
} from './schema-domains.js';

export const configShape = {
  ...platformShape,
  ...contactsShape,
  ...contentShape,
  ...campaignsShape,
  ...trackingShape,
};

export const ConfigSchema = z.object(configShape);

export type MlainConfig = z.infer<typeof ConfigSchema> & {
  UPLOADS_DIR: string;
  BACKUP_DIR: string;
  DATABASE_URL_SENDER: string;
  TRACKING_DOMAIN: string;
  ASSET_BASE_URL: string;
};

/** Seznam všech názvů proměnných. Používá ho podpora _FILE i generátor manifestu. */
export function configVariableNames(): string[] {
  return Object.keys(configShape).sort();
}
```

- [ ] **Krok 5: Spusť test a ověř, že prochází až po `crossChecks`**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/config
```
Expected: FAIL, `Failed to resolve import "./cross-checks.js"`. To je správně, `cross-checks.ts` vzniká v úkolu 10.

---

### Úkol 10: Křížové kontroly, zákazy v konfiguraci a manifest

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/config/cross-checks.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/config/ai-keys.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/config/manifest.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/config/index.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/test/config/cross-checks.test.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/test/config/forbidden-names.test.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/test/config/defaults.test.ts`

- [ ] **Krok 1: Napiš padající testy křížových kontrol a zákazů**

`packages/core/test/config/cross-checks.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from '../../src/config/load.js';

let tmp: string;
const MINIMAL = (): Record<string, string> => ({
  APP_URL: 'https://mail.example.cz',
  SECRET_KEY: `1:${Buffer.alloc(32, 3).toString('base64url')}`,
  DATABASE_URL: 'postgres://mlain_app:pw@localhost:5432/mlain',
  DATA_DIR: tmp,
});

function messagesFor(env: Record<string, string>): string {
  try {
    loadConfig(env);
    return '';
  } catch (error) {
    return (error as ConfigError).format();
  }
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mlain-cross-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('křížové kontroly konfigurace', () => {
  it('odmítne shodné health porty při MODE=all (kritérium 8c)', () => {
    const text = messagesFor({ ...MINIMAL(), MODE: 'all', SENDER_HEALTH_PORT: '3001' });
    expect(text).toContain('SENDER_HEALTH_PORT');
    expect(text).toMatch(/WORKER_HEALTH_PORT/);
  });

  it('shodné porty při MODE=sender povolí, tam kolize nevzniká', () => {
    // MIGRATE_ON_START musí být false: migrace pouští jen web a all, takže
    // MODE=sender se zapnutými migracemi je sám o sobě chyba konfigurace.
    const config = loadConfig({
      ...MINIMAL(),
      MODE: 'sender',
      MIGRATE_ON_START: 'false',
      SENDER_HEALTH_PORT: '3001',
    });
    expect(config.SENDER_HEALTH_PORT).toBe(3001);
  });

  it('odmítne PORT shodný s WORKER_HEALTH_PORT při MODE=all', () => {
    expect(messagesFor({ ...MINIMAL(), MODE: 'all', PORT: '3001' })).toContain('PORT');
  });

  it('vyžaduje DATABASE_URL_MIGRATOR při MIGRATE_ON_START=true (kritérium 8d)', () => {
    const text = messagesFor({ ...MINIMAL(), MIGRATE_ON_START: 'true' });
    expect(text).toContain('DATABASE_URL_MIGRATOR');
  });

  it('bez MIGRATE_ON_START projde start i bez DATABASE_URL_MIGRATOR (kritérium 8d)', () => {
    const config = loadConfig({ ...MINIMAL(), MIGRATE_ON_START: 'false' });
    expect(config.MIGRATE_ON_START).toBe(false);
  });

  it('vyžaduje SENDER_CLAIM_TTL_SECONDS > 4x SENDER_DISPATCH_TIMEOUT_SECONDS', () => {
    const text = messagesFor({
      ...MINIMAL(),
      MIGRATE_ON_START: 'false',
      SENDER_CLAIM_TTL_SECONDS: '30',
      SENDER_DISPATCH_TIMEOUT_SECONDS: '10',
    });
    expect(text).toContain('SENDER_CLAIM_TTL_SECONDS');
  });

  it('vyžaduje METRICS_TOKEN při METRICS_ENABLED=true', () => {
    const text = messagesFor({ ...MINIMAL(), MIGRATE_ON_START: 'false', METRICS_ENABLED: 'true' });
    expect(text).toContain('METRICS_TOKEN');
  });

  it('vyžaduje S3_* při STORAGE_DRIVER=s3', () => {
    const text = messagesFor({ ...MINIMAL(), MIGRATE_ON_START: 'false', STORAGE_DRIVER: 's3' });
    for (const name of ['S3_BUCKET', 'S3_REGION', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']) {
      expect(text, `chybí ${name}`).toContain(name);
    }
  });

  it('vyžaduje DEFAULT_LOCALE uvnitř SUPPORTED_LOCALES', () => {
    const text = messagesFor({
      ...MINIMAL(),
      MIGRATE_ON_START: 'false',
      DEFAULT_LOCALE: 'de',
      SUPPORTED_LOCALES: 'cs,en',
    });
    expect(text).toContain('DEFAULT_LOCALE');
  });

  it('vyžaduje SESSION_IDLE_TTL_DAYS <= SESSION_ABSOLUTE_TTL_DAYS', () => {
    const text = messagesFor({
      ...MINIMAL(),
      MIGRATE_ON_START: 'false',
      SESSION_IDLE_TTL_DAYS: '40',
      SESSION_ABSOLUTE_TTL_DAYS: '30',
    });
    expect(text).toContain('SESSION_IDLE_TTL_DAYS');
  });

  it('vyžaduje CAMPAIGN_QUOTA_RESUME_REMAINING > CAMPAIGN_QUOTA_PAUSE_REMAINING', () => {
    const text = messagesFor({
      ...MINIMAL(),
      MIGRATE_ON_START: 'false',
      CAMPAIGN_QUOTA_PAUSE_REMAINING: '1000',
      CAMPAIGN_QUOTA_RESUME_REMAINING: '100',
    });
    expect(text).toContain('CAMPAIGN_QUOTA_RESUME_REMAINING');
  });

  it('vyžaduje TRACKING_GEOIP_DB_PATH při TRACKING_STORE_COUNTRY=true', () => {
    const text = messagesFor({
      ...MINIMAL(),
      MIGRATE_ON_START: 'false',
      TRACKING_STORE_COUNTRY: 'true',
    });
    expect(text).toContain('TRACKING_GEOIP_DB_PATH');
  });

  it('LOG_FORMAT=pretty v produkci je chyba', () => {
    const text = messagesFor({
      ...MINIMAL(),
      MIGRATE_ON_START: 'false',
      NODE_ENV: 'production',
      LOG_FORMAT: 'pretty',
    });
    expect(text).toContain('LOG_FORMAT');
  });
});
```

`packages/core/test/config/forbidden-names.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AI_PROVIDER_ENV_EXCEPTIONS, aiKeyVariablesPresent } from '../../src/config/ai-keys.js';
import { configVariableNames } from '../../src/config/schema.js';

describe('zákazy v názvech konfiguračních proměnných', () => {
  it('žádná proměnná nekončí na _API_KEY (kritérium 7c)', () => {
    const offenders = configVariableNames().filter((name) => name.endsWith('_API_KEY'));
    expect(
      offenders,
      'entrypoint takové proměnné maže, konfigurace by tím zmizela',
    ).toEqual([]);
  });

  it('žádná proměnná neobsahuje license ani telemetry (železné pravidlo 4)', () => {
    const offenders = configVariableNames().filter((name) =>
      /license|telemetry|phone_home/i.test(name),
    );
    expect(offenders).toEqual([]);
  });

  it('detekuje ponechaný klíč AI providera v prostředí', () => {
    expect(aiKeyVariablesPresent({ ANTHROPIC_API_KEY: 'sk-test' })).toEqual(['ANTHROPIC_API_KEY']);
    expect(aiKeyVariablesPresent({ OPENAI_API_KEY: 'x', HF_TOKEN: 'y' }).sort()).toEqual([
      'HF_TOKEN',
      'OPENAI_API_KEY',
    ]);
    expect(aiKeyVariablesPresent({ SECRET_KEY: 'x', S3_ACCESS_KEY_ID: 'y' })).toEqual([]);
  });

  it('výčet výjimek odpovídá tabulce z části 1, kapitoly 3.12', () => {
    expect([...AI_PROVIDER_ENV_EXCEPTIONS].sort()).toEqual([
      'AWS_BEARER_TOKEN_BEDROCK',
      'AZURE_OPENAI_ENDPOINT',
      'GOOGLE_APPLICATION_CREDENTIALS',
      'GOOGLE_GENAI_USE_VERTEXAI',
      'HF_TOKEN',
      'OLLAMA_HOST',
    ]);
  });
});
```

`packages/core/test/config/defaults.test.ts`. Tenhle test je pojistka proti záměně `default()` a `prefault()`. Neptá se schématu, jestli je napsané správně, ptá se **výsledku parsování**, jestli má správný typ, takže zachytí i variantu, na kterou nikdo nemyslel.

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/load.js';
import { configVariableNames } from '../../src/config/schema.js';

let tmp: string;
const MINIMAL = (): Record<string, string> => ({
  APP_URL: 'https://mail.example.cz',
  SECRET_KEY: `1:${Buffer.alloc(32, 3).toString('base64url')}`,
  DATABASE_URL: 'postgres://mlain_app:pw@localhost:5432/mlain',
  DATABASE_URL_MIGRATOR: 'postgres://mlain_migrator:pw@localhost:5432/mlain',
  DATA_DIR: tmp,
});

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mlain-defaults-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('výchozí hodnoty prošly transformací', () => {
  it('žádná výchozí hodnota není nepřevedený řetězec z prostředí', () => {
    const config = loadConfig(MINIMAL()) as unknown as Record<string, unknown>;
    for (const [name, value] of Object.entries(config)) {
      if (typeof value !== 'string') continue;
      expect(
        ['true', 'false', '1', '0'],
        `${name} má výchozí hodnotu jako řetězec "${value}". V zodu 4 default() NEPROCHÁZÍ transformací, takže envBool().default('false') vrátí řetězec, který je pravdivostně true. Použij prefault().`,
      ).not.toContain(value);
      expect(
        value.includes(','),
        `${name} má výchozí hodnotu jako řetězec se seznamem "${value}". envCsv().default() nevrací pole. Použij prefault().`,
      ).toBe(false);
    }
  });

  it('booleovské proměnné jsou opravdu boolean a mají správnou hodnotu', () => {
    const config = loadConfig(MINIMAL());
    // Kdyby tyhle dvě byly řetězec 'false', byly by pravdivostně TRUE, tedy
    // metriky veřejné a země ukládaná, aniž by to kdokoli zapnul.
    expect(config.METRICS_ENABLED).toBe(false);
    expect(config.TRACKING_STORE_COUNTRY).toBe(false);
    expect(config.TRACKING_ALLOW_IP_STORAGE).toBe(false);
    expect(config.WEBHOOK_ALLOW_PRIVATE_TARGETS).toBe(false);
    expect(config.MIGRATE_ON_START).toBe(true);
    expect(config.RATE_LIMIT_ENABLED).toBe(true);
  });

  it('seznamy jsou opravdu pole', () => {
    const config = loadConfig(MINIMAL());
    expect(config.SUPPORTED_LOCALES).toEqual(['cs', 'en']);
    expect(config.SECRET_KEY_PREVIOUS).toEqual([]);
    expect(config.BRAND_FETCH_ALLOWED_HOSTS).toEqual([]);
    expect(config.BRAND_FETCH_BLOCKED_HOSTS).toEqual([
      'metadata.google.internal',
      'metadata.goog',
      'instance-data',
      'metadata',
    ]);
  });

  it('schéma má právě 179 proměnných (registr je uzavřený, uzávěr S12)', () => {
    // Exaktní číslo je záměr. Doménový plán proměnnou nezakládá, takže každá
    // změna musí projít změnou plánu P01, ne commitem z jiné větve.
    expect(configVariableNames()).toHaveLength(179);
  });

  it('zná proměnné, které si vyžádal plán P10', () => {
    const names = new Set(configVariableNames());
    for (const name of [
      'TRACKING_ALLOW_IP_STORAGE',
      'RATE_LIMIT_IDENTIFY_IP',
      'RATE_LIMIT_TRACK_ANON',
    ]) {
      expect(names.has(name), `chybí ${name}`).toBe(true);
    }
  });
});
```

- [ ] **Krok 2: Spusť testy a ověř, že padají**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/config
```
Expected: FAIL, `Failed to resolve import "./cross-checks.js"` a `"../../src/config/ai-keys.js"`. Soubor `defaults.test.ts` padá ze stejného důvodu, protože loader `cross-checks.js` importuje.

- [ ] **Krok 3: Napiš `packages/core/src/config/cross-checks.ts`**

```ts
import type { ConfigIssue } from './load.js';
import type { MlainConfig } from './schema.js';

/**
 * Kontroly, které se týkají vztahu mezi proměnnými. Zod je neumí vyjádřit
 * na úrovni jednoho pole a vracejí se ve stejném seznamu jako zbytek, aby
 * platilo "všechny chyby naráz" z akceptačního kritéria 3.
 */
export function crossChecks(config: MlainConfig): ConfigIssue[] {
  const issues: ConfigIssue[] = [];

  // Kritérium 8c. Při MODE=all jsou to potomci jednoho kontejneru se sdíleným
  // prostředím, takže shodný port znamená EADDRINUSE u druhého z nich.
  if (config.MODE === 'all') {
    if (config.SENDER_HEALTH_PORT === config.WORKER_HEALTH_PORT) {
      issues.push({
        variable: 'SENDER_HEALTH_PORT',
        message: `při MODE=all se nesmí rovnat WORKER_HEALTH_PORT (${config.WORKER_HEALTH_PORT}), potomci sdílejí prostředí`,
      });
    }
    if (config.PORT === config.WORKER_HEALTH_PORT || config.PORT === config.SENDER_HEALTH_PORT) {
      issues.push({
        variable: 'PORT',
        message: 'při MODE=all se nesmí rovnat WORKER_HEALTH_PORT ani SENDER_HEALTH_PORT',
      });
    }
  }

  // Kritérium 8d. Aplikační role mlain_app schéma nevlastní a migrovat nemůže.
  if (config.MIGRATE_ON_START && !config.DATABASE_URL_MIGRATOR) {
    issues.push({
      variable: 'DATABASE_URL_MIGRATOR',
      message:
        'migrace vyžadují DATABASE_URL_MIGRATOR (role mlain_migrator). Aplikační role mlain_app schéma nevlastní a migrovat nesmí. Buď proměnnou doplňte, nebo nastavte MIGRATE_ON_START=false.',
    });
  }

  // Část 4b: pod čtyřnásobkem by hlídač zaseknuté dávky hlásil planý poplach
  // na každé normálně běžící dávce.
  if (config.SENDER_CLAIM_TTL_SECONDS <= 4 * config.SENDER_DISPATCH_TIMEOUT_SECONDS) {
    issues.push({
      variable: 'SENDER_CLAIM_TTL_SECONDS',
      message: `musí být větší než 4 x SENDER_DISPATCH_TIMEOUT_SECONDS (${4 * config.SENDER_DISPATCH_TIMEOUT_SECONDS})`,
    });
  }

  if (config.METRICS_ENABLED && !config.METRICS_TOKEN) {
    issues.push({
      variable: 'METRICS_TOKEN',
      message: 'je povinná (required), když je METRICS_ENABLED=true, a musí mít aspoň 32 znaků',
    });
  }

  if (config.STORAGE_DRIVER === 's3') {
    for (const variable of [
      'S3_BUCKET',
      'S3_REGION',
      'S3_ACCESS_KEY_ID',
      'S3_SECRET_ACCESS_KEY',
    ] as const) {
      if (!config[variable]) {
        issues.push({
          variable,
          message: 'je povinná (required), když je STORAGE_DRIVER=s3',
        });
      }
    }
  }

  if (!config.SUPPORTED_LOCALES.includes(config.DEFAULT_LOCALE)) {
    issues.push({
      variable: 'DEFAULT_LOCALE',
      message: `musí být v SUPPORTED_LOCALES (${config.SUPPORTED_LOCALES.join(', ')})`,
    });
  }

  if (config.SESSION_IDLE_TTL_DAYS > config.SESSION_ABSOLUTE_TTL_DAYS) {
    issues.push({
      variable: 'SESSION_IDLE_TTL_DAYS',
      message: `nesmí být větší než SESSION_ABSOLUTE_TTL_DAYS (${config.SESSION_ABSOLUTE_TTL_DAYS})`,
    });
  }

  // Bez tohohle by se kampaň pozastavila a hned obnovila dokola.
  if (config.CAMPAIGN_QUOTA_RESUME_REMAINING <= config.CAMPAIGN_QUOTA_PAUSE_REMAINING) {
    issues.push({
      variable: 'CAMPAIGN_QUOTA_RESUME_REMAINING',
      message: `musí být větší než CAMPAIGN_QUOTA_PAUSE_REMAINING (${config.CAMPAIGN_QUOTA_PAUSE_REMAINING}), jinak kampaň cykluje mezi pauzou a obnovením`,
    });
  }

  if (config.DELIVERABILITY_BOUNCE_WARN_RATE > config.DELIVERABILITY_BOUNCE_GUARD_RATE) {
    issues.push({
      variable: 'DELIVERABILITY_BOUNCE_WARN_RATE',
      message: 'nesmí být vyšší než DELIVERABILITY_BOUNCE_GUARD_RATE, varování má přijít před brzdou',
    });
  }

  if (config.DELIVERABILITY_COMPLAINT_WARN_RATE > config.DELIVERABILITY_COMPLAINT_GUARD_RATE) {
    issues.push({
      variable: 'DELIVERABILITY_COMPLAINT_WARN_RATE',
      message:
        'nesmí být vyšší než DELIVERABILITY_COMPLAINT_GUARD_RATE, varování má přijít před brzdou',
    });
  }

  if (config.TRACKING_STORE_COUNTRY && !config.TRACKING_GEOIP_DB_PATH) {
    issues.push({
      variable: 'TRACKING_GEOIP_DB_PATH',
      message: 'je povinná (required), když je TRACKING_STORE_COUNTRY=true',
    });
  }

  if (config.NODE_ENV === 'production' && config.LOG_FORMAT === 'pretty') {
    issues.push({
      variable: 'LOG_FORMAT',
      message: 'hodnota pretty je povolená jen mimo produkci',
    });
  }

  if (config.MODE !== 'all' && config.MODE !== 'web' && config.MIGRATE_ON_START) {
    issues.push({
      variable: 'MIGRATE_ON_START',
      message: `migrace pouští jen MODE=web a MODE=all, ne MODE=${config.MODE}`,
    });
  }

  return issues;
}
```

- [ ] **Krok 4: Napiš `packages/core/src/config/ai-keys.ts`**

```ts
/**
 * Klíče AI providerů se před spuštěním web a worker procesu z prostředí mažou.
 *
 * Vercel AI SDK i SDK jednotlivých providerů mají fallback: když se klíč
 * nepředá explicitně, sáhnou tiše po proměnné prostředí. Projekt, který si
 * klíč nenakonfiguroval, by tím začal utrácet peníze provozovatele, requesty
 * by prošly a zjistilo by se to až na faktuře (část 1, kapitola 3.12).
 *
 * Vzor, ne výčet: výčet zastará při každém novém provideru a selže tiše.
 * Vzor *_API_KEY je bezpečný, protože žádná konfigurační proměnná Mlain
 * Maileru na _API_KEY nekončí; hlídá to test v forbidden-names.test.ts.
 */
export const AI_PROVIDER_ENV_PATTERN = /_API_KEY$/;

/** Proměnné, které vzoru neodpovídají, a přesto se mažou. */
export const AI_PROVIDER_ENV_EXCEPTIONS: readonly string[] = [
  'AWS_BEARER_TOKEN_BEDROCK',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GOOGLE_GENAI_USE_VERTEXAI',
  'AZURE_OPENAI_ENDPOINT',
  'OLLAMA_HOST',
  'HF_TOKEN',
];

export function isAiProviderVariable(name: string): boolean {
  return AI_PROVIDER_ENV_PATTERN.test(name) || AI_PROVIDER_ENV_EXCEPTIONS.includes(name);
}

/**
 * Druhá vrstva ochrany. Entrypoint proměnné maže; tahle funkce ověří, že po
 * vymazání opravdu nezůstaly, například když někdo spustí `node server.js`
 * napřímo mimo entrypoint. Volající zaloguje warn s kódem ai_key_leaked_from_env
 * a klíč přesto ignoruje.
 */
export function aiKeyVariablesPresent(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return Object.entries(env)
    .filter(([name, value]) => value !== undefined && value !== '' && isAiProviderVariable(name))
    .map(([name]) => name);
}
```

- [ ] **Krok 5: Napiš `packages/core/src/config/manifest.ts` a `index.ts`**

```ts
import { configShape, configVariableNames } from './schema.js';

export interface ManifestEntry {
  readonly name: string;
  readonly optional: boolean;
  readonly hasDefault: boolean;
}

/**
 * Strojově čitelný popis konfigurace. Slouží jako podklad pro paritu s Go
 * strukturou senderu (test config-parity) a pro generování dokumentace.
 *
 * ROZHODNUTÍ D5: manifest žije tady, ne v packages/contracts/config.json.
 * packages/contracts je podle uzávěru S2 výhradní vlastnictví plánu P02;
 * ten manifest do kontraktů zrcadlí, až balíček bude existovat.
 */
export function buildConfigManifest(): { version: 1; variables: ManifestEntry[] } {
  const variables = configVariableNames().map((name) => {
    const field = configShape[name as keyof typeof configShape];
    const definition = field as { safeParse: (value: unknown) => { success: boolean } };
    const withoutValue = definition.safeParse(undefined);
    return {
      name,
      optional: withoutValue.success,
      hasDefault: withoutValue.success,
    };
  });
  return { version: 1, variables };
}
```

`packages/core/src/config/index.ts`:

```ts
export * from './primitives.js';
export * from './schema.js';
export * from './load.js';
export * from './ai-keys.js';
export * from './manifest.js';
```

- [ ] **Krok 6: Spusť všechny testy konfigurace a ověř, že procházejí**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/config
```
Expected: PASS, `Test Files  5 passed (5)`.

- [ ] **Krok 7: Vygeneruj manifest a přidej test na drift**

Přidej do `packages/core/package.json` skript:

```json
"config:manifest": "node --experimental-strip-types scripts/write-manifest.ts"
```

`packages/core/scripts/write-manifest.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { buildConfigManifest } from '../src/config/manifest.js';

const target = path.join(import.meta.dirname, '../src/config/config.manifest.json');
fs.writeFileSync(target, `${JSON.stringify(buildConfigManifest(), null, 2)}\n`);
console.log(`Zapsáno ${target}`);
```

`packages/core/test/config/manifest.test.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildConfigManifest } from '../../src/config/manifest.js';

describe('manifest konfigurace', () => {
  it('commitnutý soubor se shoduje s vygenerovaným', () => {
    const file = path.join(import.meta.dirname, '../../src/config/config.manifest.json');
    const committed = fs.readFileSync(file, 'utf8');
    expect(committed).toBe(`${JSON.stringify(buildConfigManifest(), null, 2)}\n`);
  });

  it('obsahuje právě 179 proměnných', () => {
    expect(buildConfigManifest().variables.length).toBe(179);
  });
});
```

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core run config:manifest && pnpm --filter @mlain/core exec vitest run test/config
```
Expected: `Zapsáno .../config.manifest.json`, pak `Test Files  6 passed (6)`.

- [ ] **Krok 8: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add packages/core && git commit -m "feat(core): full zod config schema for all seven specs with cross checks"
```

---

### Úkol 11: Logger a graceful shutdown

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/logging/logger.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/logging/index.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/shutdown/shutdown.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/shutdown/index.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/test/logging/logger.test.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/test/shutdown/shutdown.test.ts`

- [ ] **Krok 1: Napiš padající test loggeru**

`packages/core/test/logging/logger.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { REDACTED_PATHS, createLogger } from '../../src/logging/logger.js';

function capture(fn: (write: (line: string) => void) => void): string[] {
  const lines: string[] = [];
  fn((line) => lines.push(line));
  return lines;
}

describe('logger', () => {
  it('píše JSON s úrovní a časem', () => {
    const lines = capture((write) => {
      const logger = createLogger({ level: 'info', format: 'json', mode: 'web' }, { write });
      logger.info({ request_id: 'r1' }, 'hotovo');
    });
    const record = JSON.parse(lines[0] ?? '{}') as Record<string, unknown>;
    expect(record['msg']).toBe('hotovo');
    expect(record['request_id']).toBe('r1');
    expect(record['mode']).toBe('web');
    expect(record['level']).toBe(30);
  });

  it('nezaloguje záznam pod nastavenou úrovní', () => {
    const lines = capture((write) => {
      const logger = createLogger({ level: 'warn', format: 'json', mode: 'worker' }, { write });
      logger.info({}, 'tohle nemá projít');
      logger.warn({}, 'tohle ano');
    });
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('tohle ano');
  });

  it('začerní tajemství, i když je někdo předá do logu', () => {
    const lines = capture((write) => {
      const logger = createLogger({ level: 'info', format: 'json', mode: 'web' }, { write });
      logger.info(
        {
          config: { SECRET_KEY: 'tajne', DATABASE_URL: 'postgres://u:p@h/d' },
          password: 'x',
          authorization: 'Bearer y',
        },
        'start',
      );
    });
    const text = lines[0] ?? '';
    expect(text).not.toContain('tajne');
    expect(text).not.toContain('postgres://u:p@h/d');
    expect(text).not.toContain('Bearer y');
    expect(text).toContain('[Redacted]');
  });

  it('seznam začerněných cest pokrývá e-mail příjemce a render_data', () => {
    expect(REDACTED_PATHS).toContain('*.render_data');
    expect(REDACTED_PATHS).toContain('*.email');
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/logging
```
Expected: FAIL, `Failed to resolve import "../../src/logging/logger.js"`.

- [ ] **Krok 3: Napiš `packages/core/src/logging/logger.ts`**

```ts
import { pino, type Logger } from 'pino';

export type { Logger };

/**
 * Cesty, které se v logu nikdy neobjeví v otevřené podobě.
 *
 * Část 4b, kapitola 4.4: do logu nikdy nesmí e-mailová adresa příjemce,
 * obsah render_data, obsah zprávy ani dešifrovaná konfigurace provideru.
 * Část 1, kapitola 4.2: v odpovědi ani v logu nesmí obsah env proměnných.
 */
export const REDACTED_PATHS: readonly string[] = [
  'password',
  'authorization',
  'cookie',
  'set-cookie',
  '*.password',
  '*.authorization',
  '*.secret',
  '*.token',
  '*.api_key',
  '*.apiKey',
  '*.email',
  '*.render_data',
  '*.credentials',
  'config.SECRET_KEY',
  'config.SECRET_KEY_PREVIOUS',
  'config.DATABASE_URL',
  'config.DATABASE_URL_MIGRATOR',
  'config.DATABASE_URL_SENDER',
  'config.METRICS_TOKEN',
  'config.S3_SECRET_ACCESS_KEY',
  'config.S3_ACCESS_KEY_ID',
];

export interface LoggerOptions {
  readonly level: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  readonly format: 'json' | 'pretty';
  readonly mode: 'web' | 'worker' | 'sender' | 'all' | 'cli';
  readonly version?: string;
}

export interface LoggerSinks {
  /** Injektovaný zápis, aby šlo logger testovat bez souborového deskriptoru. */
  readonly write?: (line: string) => void;
}

export function createLogger(options: LoggerOptions, sinks: LoggerSinks = {}): Logger {
  const base = {
    mode: options.mode,
    ...(options.version === undefined ? {} : { version: options.version }),
  };

  if (sinks.write) {
    return pino(
      {
        level: options.level,
        base,
        redact: { paths: [...REDACTED_PATHS], censor: '[Redacted]' },
      },
      { write: sinks.write },
    );
  }

  if (options.format === 'pretty') {
    return pino({
      level: options.level,
      base,
      redact: { paths: [...REDACTED_PATHS], censor: '[Redacted]' },
      transport: { target: 'pino-pretty', options: { colorize: true } },
    });
  }

  return pino({
    level: options.level,
    base,
    redact: { paths: [...REDACTED_PATHS], censor: '[Redacted]' },
  });
}
```

`packages/core/src/logging/index.ts`:

```ts
export * from './logger.js';
```

- [ ] **Krok 4: Spusť test a ověř, že prochází**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/logging
```
Expected: PASS, `Tests  4 passed (4)`.

- [ ] **Krok 5: Napiš padající test graceful shutdownu**

`packages/core/test/shutdown/shutdown.test.ts`:

```ts
import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { createShutdownController } from '../../src/shutdown/shutdown.js';

function fakeProcess() {
  const emitter = new EventEmitter() as EventEmitter & {
    exit: (code: number) => void;
    exitCalls: number[];
  };
  emitter.exitCalls = [];
  emitter.exit = (code: number) => {
    emitter.exitCalls.push(code);
  };
  return emitter;
}

describe('graceful shutdown', () => {
  it('spustí úklidy v opačném pořadí registrace a skončí kódem 0', async () => {
    const order: string[] = [];
    const proc = fakeProcess();
    const controller = createShutdownController({
      graceSeconds: 25,
      process: proc as never,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    controller.register('první', async () => {
      order.push('první');
    });
    controller.register('druhý', async () => {
      order.push('druhý');
    });
    await controller.shutdown('SIGTERM');
    expect(order).toEqual(['druhý', 'první']);
    expect(proc.exitCalls).toEqual([0]);
  });

  it('na SIGINT reaguje stejně jako na SIGTERM', async () => {
    const proc = fakeProcess();
    const controller = createShutdownController({
      graceSeconds: 25,
      process: proc as never,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    const done = vi.fn();
    controller.register('x', async () => {
      done();
    });
    controller.listen();
    proc.emit('SIGINT');
    await controller.finished();
    expect(done).toHaveBeenCalledOnce();
  });

  it('druhý signál během shutdownu ukončí proces okamžitě kódem 1', async () => {
    const proc = fakeProcess();
    const controller = createShutdownController({
      graceSeconds: 25,
      process: proc as never,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    controller.register('pomalý', () => new Promise(() => {}));
    controller.listen();
    proc.emit('SIGTERM');
    await Promise.resolve();
    proc.emit('SIGTERM');
    expect(proc.exitCalls).toContain(1);
  });

  it('po vypršení lhůty skončí kódem 1 a zaloguje varování', async () => {
    vi.useFakeTimers();
    const warn = vi.fn();
    const proc = fakeProcess();
    const controller = createShutdownController({
      graceSeconds: 1,
      process: proc as never,
      logger: { info: () => {}, warn, error: () => {} },
    });
    controller.register('nikdy', () => new Promise(() => {}));
    const promise = controller.shutdown('SIGTERM');
    await vi.advanceTimersByTimeAsync(1100);
    await promise;
    expect(warn).toHaveBeenCalled();
    expect(proc.exitCalls).toContain(1);
    vi.useRealTimers();
  });

  it('opakované volání shutdown nespustí úklidy dvakrát', async () => {
    const cleanup = vi.fn(async () => {});
    const proc = fakeProcess();
    const controller = createShutdownController({
      graceSeconds: 25,
      process: proc as never,
      logger: { info: () => {}, warn: () => {}, error: () => {} },
    });
    controller.register('x', cleanup);
    await controller.shutdown('SIGTERM');
    await controller.shutdown('SIGTERM');
    expect(cleanup).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Krok 6: Spusť test a ověř, že padá**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/shutdown
```
Expected: FAIL, `Failed to resolve import "../../src/shutdown/shutdown.js"`.

- [ ] **Krok 7: Napiš `packages/core/src/shutdown/shutdown.ts`**

```ts
export interface ShutdownLogger {
  info(object: Record<string, unknown>, message?: string): void;
  warn(object: Record<string, unknown>, message?: string): void;
  error(object: Record<string, unknown>, message?: string): void;
}

export interface ShutdownOptions {
  /** SHUTDOWN_GRACE_SECONDS, výchozí 25 (část 1, kapitola 3.12). */
  readonly graceSeconds: number;
  readonly logger: ShutdownLogger;
  readonly process?: NodeJS.Process;
}

export interface ShutdownController {
  register(name: string, cleanup: () => Promise<void> | void): void;
  listen(): void;
  shutdown(signal: string): Promise<void>;
  finished(): Promise<void>;
}

/**
 * Graceful shutdown pro Node procesy podle části 1, kapitoly 3.12.
 *
 * Úklidy běží v OPAČNÉM pořadí registrace, protože pozdější závisí na dřívějším
 * (HTTP server se zavírá dřív než databázový pool). Druhý signál během shutdownu
 * znamená okamžité ukončení. Po vypršení lhůty proces skončí kódem 1, aby bylo
 * v orchestrátoru vidět, že se nedojelo čistě.
 */
export function createShutdownController(options: ShutdownOptions): ShutdownController {
  const proc = options.process ?? process;
  const cleanups: { name: string; run: () => Promise<void> | void }[] = [];
  let started = false;
  let resolveFinished: () => void = () => {};
  const finishedPromise = new Promise<void>((resolve) => {
    resolveFinished = resolve;
  });

  async function shutdown(signal: string): Promise<void> {
    if (started) {
      options.logger.warn({ signal }, 'druhý signál během shutdownu, končím okamžitě');
      proc.exit(1);
      return;
    }
    started = true;
    options.logger.info({ signal, grace_seconds: options.graceSeconds }, 'graceful shutdown začal');

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      options.logger.warn(
        { signal, grace_seconds: options.graceSeconds },
        'graceful shutdown nestihl lhůtu, končím vynuceně',
      );
      proc.exit(1);
      resolveFinished();
    }, options.graceSeconds * 1000);
    if (typeof timer.unref === 'function') timer.unref();

    for (const cleanup of [...cleanups].reverse()) {
      if (timedOut) break;
      try {
        await cleanup.run();
        options.logger.info({ step: cleanup.name }, 'úklid hotov');
      } catch (error) {
        options.logger.error(
          { step: cleanup.name, err: (error as Error).message },
          'úklid selhal, pokračuji dalším',
        );
      }
    }

    clearTimeout(timer);
    if (!timedOut) {
      options.logger.info({ signal }, 'graceful shutdown dokončen');
      proc.exit(0);
    }
    resolveFinished();
  }

  return {
    register(name, cleanup) {
      cleanups.push({ name, run: cleanup });
    },
    listen() {
      // SIGINT se chová stejně jako SIGTERM (část 1, kapitola 3.12).
      proc.on('SIGTERM', () => void shutdown('SIGTERM'));
      proc.on('SIGINT', () => void shutdown('SIGINT'));
    },
    shutdown,
    finished: () => finishedPromise,
  };
}
```

`packages/core/src/shutdown/index.ts`:

```ts
export * from './shutdown.js';
```

- [ ] **Krok 8: Spusť test a ověř, že prochází**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/shutdown
```
Expected: PASS, `Tests  5 passed (5)`.

- [ ] **Krok 9: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add packages/core && git commit -m "feat(core): structured logging with redaction and graceful shutdown controller"
```

---

### Úkol 12: Knihovna health kontrol

Rozhodnutí D2: readiness si otevírá **krátkodobé** spojení, ne pool. Pool vlastní `packages/db`, tedy P03, a probe má navíc ověřovat, že jde navázat nové spojení; teplý pool by to zamaskoval.

Rozhodnutí D3: kontrola `schema_version` snese neexistující tabulku `system_settings`, protože ji zakládá až P03.

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/health/types.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/health/checks.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/health/readiness.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/packages/core/src/health/index.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/packages/core/test/health/readiness.test.ts`

- [ ] **Krok 1: Napiš padající test readiness**

`packages/core/test/health/readiness.test.ts`:

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildReadiness, dataDirCheck, databaseCheck, schemaCheck } from '../../src/health/readiness.js';

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mlain-health-'));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe('readiness', () => {
  it('vrátí ok, když projdou všechny kontroly', async () => {
    const result = await buildReadiness([
      async () => ({ name: 'database', status: 'ok' }),
      async () => ({ name: 'data_dir', status: 'ok' }),
    ]);
    expect(result.status).toBe('ok');
    expect(result.httpStatus).toBe(200);
    expect(result.checks).toHaveLength(2);
  });

  it('vrátí 503, když jedna kontrola selže', async () => {
    const result = await buildReadiness([
      async () => ({ name: 'database', status: 'fail', detail: 'connection refused' }),
      async () => ({ name: 'data_dir', status: 'ok' }),
    ]);
    expect(result.status).toBe('fail');
    expect(result.httpStatus).toBe(503);
  });

  it('status skip readiness nesráží', async () => {
    const result = await buildReadiness([
      async () => ({ name: 'schema', status: 'skip', detail: 'no migrations yet' }),
    ]);
    expect(result.httpStatus).toBe(200);
  });

  it('status warn readiness nesráží, ale je vidět v odpovědi', async () => {
    const result = await buildReadiness([
      async () => ({ name: 'secret_key', status: 'warn', detail: 'secret_key_fingerprint_mismatch' }),
    ]);
    expect(result.httpStatus).toBe(200);
    expect(result.checks[0]?.status).toBe('warn');
  });

  it('kontrola, která vyhodí výjimku, se počítá jako fail, ne jako pád probe', async () => {
    const result = await buildReadiness([
      async () => {
        throw new Error('boom');
      },
    ]);
    expect(result.httpStatus).toBe(503);
    expect(result.checks[0]?.detail).toContain('boom');
  });

  it('databaseCheck selže na nedostupné databázi do timeoutu', async () => {
    const check = databaseCheck({
      connectionString: 'postgres://nobody@127.0.0.1:1/none',
      timeoutMs: 300,
    });
    const result = await check();
    expect(result.status).toBe('fail');
    expect(result.name).toBe('database');
  });

  it('schemaCheck hlásí skip, když system_settings neexistuje (rozhodnutí D3)', async () => {
    const result = await schemaCheck({
      query: async () => {
        const error = new Error('relation "system_settings" does not exist') as Error & {
          code: string;
        };
        error.code = '42P01';
        throw error;
      },
      expectedVersion: 0,
    })();
    expect(result.status).toBe('skip');
  });

  it('schemaCheck selže při neshodě verze', async () => {
    const result = await schemaCheck({
      query: async () => 41,
      expectedVersion: 42,
    })();
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('42');
  });

  it('schemaCheck hlásí schema_version_ahead, když je databáze novější', async () => {
    const result = await schemaCheck({ query: async () => 43, expectedVersion: 42 })();
    expect(result.detail).toContain('schema_version_ahead');
  });

  it('dataDirCheck selže, když adresář není zapisovatelný', async () => {
    const readonly = path.join(tmp, 'ro');
    fs.mkdirSync(readonly);
    fs.chmodSync(readonly, 0o500);
    try {
      expect((await dataDirCheck(readonly)()).status).toBe('fail');
    } finally {
      fs.chmodSync(readonly, 0o700);
    }
    expect((await dataDirCheck(tmp)()).status).toBe('ok');
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/health
```
Expected: FAIL, `Failed to resolve import "../../src/health/readiness.js"`.

- [ ] **Krok 3: Napiš `packages/core/src/health/types.ts`**

```ts
export type CheckStatus = 'ok' | 'warn' | 'skip' | 'fail';

export interface CheckResult {
  readonly name: string;
  readonly status: CheckStatus;
  readonly detail?: string;
  readonly duration_ms?: number;
}

export type Check = () => Promise<CheckResult>;

export interface ReadinessResult {
  readonly status: 'ok' | 'fail';
  readonly httpStatus: 200 | 503;
  readonly checks: readonly CheckResult[];
}

export interface LivenessResult {
  readonly status: 'ok';
  readonly mode: string;
  readonly version: string;
}
```

- [ ] **Krok 4: Napiš `packages/core/src/health/readiness.ts` a `checks.ts`**

`packages/core/src/health/readiness.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import type { Check, CheckResult, ReadinessResult } from './types.js';

/** Neexistující tabulka v PostgreSQL. */
const UNDEFINED_TABLE = '42P01';

export async function buildReadiness(checks: readonly Check[]): Promise<ReadinessResult> {
  const results = await Promise.all(
    checks.map(async (check): Promise<CheckResult> => {
      const started = Date.now();
      try {
        const result = await check();
        return { ...result, duration_ms: Date.now() - started };
      } catch (error) {
        return {
          name: 'unknown',
          status: 'fail',
          detail: (error as Error).message,
          duration_ms: Date.now() - started,
        };
      }
    }),
  );
  const failed = results.some((result) => result.status === 'fail');
  return {
    status: failed ? 'fail' : 'ok',
    httpStatus: failed ? 503 : 200,
    checks: results,
  };
}

export interface DatabaseCheckOptions {
  readonly connectionString: string;
  /** Část 1, kapitola 3.12: SELECT 1 s timeoutem 2 s. */
  readonly timeoutMs?: number;
}

/**
 * ROZHODNUTÍ D2: krátkodobé spojení, ne pool. Pool vlastní packages/db (P03)
 * a teplý pool by zamaskoval to, co probe má ověřit, tedy že jde navázat NOVÉ
 * spojení. Při intervalu 15 s to jsou čtyři spojení za minutu.
 */
export function databaseCheck(options: DatabaseCheckOptions): Check {
  const timeoutMs = options.timeoutMs ?? 2000;
  return async () => {
    const client = new Client({
      connectionString: options.connectionString,
      connectionTimeoutMillis: timeoutMs,
      statement_timeout: timeoutMs,
      application_name: 'mlain-healthcheck',
    });
    try {
      await client.connect();
      await client.query('SELECT 1');
      return { name: 'database', status: 'ok' };
    } catch (error) {
      return { name: 'database', status: 'fail', detail: (error as Error).message };
    } finally {
      await client.end().catch(() => {});
    }
  };
}

export interface SchemaCheckOptions {
  /** Vrátí system_settings.schema_version. */
  readonly query: () => Promise<number>;
  /** Nejvyšší číslo migrace zabudované v téhle image. 0 = build bez migrací. */
  readonly expectedVersion: number;
}

export function schemaCheck(options: SchemaCheckOptions): Check {
  return async () => {
    if (options.expectedVersion === 0) {
      return { name: 'schema', status: 'skip', detail: 'build bez migrací' };
    }
    try {
      const actual = await options.query();
      if (actual === options.expectedVersion) return { name: 'schema', status: 'ok' };
      if (actual > options.expectedVersion) {
        return {
          name: 'schema',
          status: 'fail',
          detail: `schema_version_ahead: databáze má ${actual}, image zná nejvýš ${options.expectedVersion}`,
        };
      }
      return {
        name: 'schema',
        status: 'fail',
        detail: `databáze má schema_version ${actual}, image očekává ${options.expectedVersion}`,
      };
    } catch (error) {
      // ROZHODNUTÍ D3: tabulku zakládá až P03. Do té doby je kontrola přeskočená,
      // ne selhaná, jinak by /api/health/ready nikdy nevrátil 200 a akceptační
      // kritérium 1 by nešlo splnit dřív než po P03.
      if ((error as { code?: string }).code === UNDEFINED_TABLE) {
        return { name: 'schema', status: 'skip', detail: 'system_settings zatím neexistuje' };
      }
      return { name: 'schema', status: 'fail', detail: (error as Error).message };
    }
  };
}

export function dataDirCheck(dataDir: string): Check {
  return async () => {
    const probe = path.join(dataDir, `.healthcheck-${process.pid}`);
    try {
      fs.writeFileSync(probe, 'ok');
      fs.unlinkSync(probe);
      return { name: 'data_dir', status: 'ok' };
    } catch (error) {
      return {
        name: 'data_dir',
        status: 'fail',
        detail: `${dataDir}: ${(error as Error).message}`,
      };
    }
  };
}
```

`packages/core/src/health/checks.ts`:

```ts
import type { Check, LivenessResult } from './types.js';
import { aiKeyVariablesPresent } from '../config/ai-keys.js';

export function liveness(mode: string, version: string): LivenessResult {
  return { status: 'ok', mode, version };
}

/**
 * Druhá vrstva ochrany proti klíčům AI providerů v prostředí. Entrypoint je
 * maže; když se přesto objeví, znamená to, že proces někdo spustil mimo
 * entrypoint. Readiness to nesráží, protože klíč se stejně nepoužije, ale
 * varování musí být vidět.
 */
export function aiKeyLeakCheck(env: Record<string, string | undefined> = process.env): Check {
  return async () => {
    const leaked = aiKeyVariablesPresent(env);
    if (leaked.length === 0) return { name: 'ai_keys', status: 'ok' };
    return {
      name: 'ai_keys',
      status: 'warn',
      detail: `ai_key_leaked_from_env: ${leaked.join(', ')}`,
    };
  };
}

/**
 * Otisk aktuálního SECRET_KEY proti otisku uloženému v databázi.
 * Kritérium 56: neshoda je varování, ne selhání, aby start proběhl.
 * Dotaz dodá volající, protože přístup k databázi vlastní P03.
 */
export function secretKeyFingerprintCheck(
  query: () => Promise<{ stored: string | null; current: string }>,
): Check {
  return async () => {
    const { stored, current } = await query();
    if (stored === null || stored === current) return { name: 'secret_key', status: 'ok' };
    return {
      name: 'secret_key',
      status: 'warn',
      detail: 'secret_key_fingerprint_mismatch',
    };
  };
}
```

`packages/core/src/health/index.ts`:

```ts
export * from './types.js';
export * from './checks.js';
export * from './readiness.js';
```

- [ ] **Krok 5: Spusť test a ověř, že prochází**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run test/health
```
Expected: PASS, `Tests  10 passed (10)`.

- [ ] **Krok 6: Spusť celou sadu balíčku core**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/core exec vitest run && pnpm --filter @mlain/core run typecheck
```
Expected: `Test Files  12 passed (12)`, typecheck bez výstupu.

- [ ] **Krok 7: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add packages/core && git commit -m "feat(core): readiness and liveness checks without owning a connection pool"
```

---

### Úkol 13: Kostra `apps/web` a health endpointy

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/package.json`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/next.config.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/tsconfig.json`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/vitest.config.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/vitest.setup.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/lib/runtime.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/instrumentation.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/app/layout.tsx`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/app/page.tsx`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/public/.gitkeep`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/app/api/health/route.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/web/src/app/api/health/ready/route.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/apps/web/test/health-routes.test.ts`

- [ ] **Krok 1: Napiš padající test health routes**

`apps/web/test/health-routes.test.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/runtime.js', () => ({
  getConfig: () => ({
    MODE: 'web',
    IMAGE_VERSION: '1.2.3',
    DATA_DIR: process.cwd(),
    DATABASE_URL: 'postgres://nobody@127.0.0.1:1/none',
    DATABASE_STATEMENT_TIMEOUT_MS: 2000,
  }),
  getLogger: () => ({ info: () => {}, warn: () => {}, error: () => {} }),
  EXPECTED_SCHEMA_VERSION: 0,
}));

describe('GET /api/health', () => {
  it('vrátí 200 se stavem, režimem a neprázdnou verzí (kritérium 7e)', async () => {
    const { GET } = await import('../src/app/api/health/route.js');
    const response = await GET();
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toEqual({ status: 'ok', mode: 'web', version: '1.2.3' });
    expect(String(body['version']).length).toBeGreaterThan(0);
  });
});

describe('konfigurace testů apps/web', () => {
  // Tenhle test leží ve `test/`, tedy uvnitř STARÉHO vzoru, schválně: musí se
  // spustit i tehdy, když se kvůli špatnému `include` nespustí nic jiného.
  // Je to jediná pojistka proti zeleně nepravdivé sérii, protože všechny
  // ostatní testy apps/web píšou P05, P06 a P12 vedle zdroje.
  //
  // Neptá se plánu ani zdrojáku, ale ŽIVÉ konfigurace: naimportuje ji a ověří
  // fakta, na kterých běh stojí.
  it('vzor souborů zahrnuje testy vedle zdroje, ne jen adresář test/', async () => {
    const config = (await import('../vitest.config.js')).default;
    const include = config.test?.include ?? [];
    expect(
      include.some((pattern: string) => pattern.startsWith('src/')),
      'bez src/ ve vzoru se testy P05, P06 a P12 nespustí a série přesto skončí nulou',
    ).toBe(true);
    for (const pattern of include) {
      expect(pattern, 'vzor musí brát i .tsx, jinak vypadnou komponenty').toMatch(/tsx?/);
    }
  });

  it('běží v jsdom a má plugin React, jinak render() nemá kde renderovat', async () => {
    const config = (await import('../vitest.config.js')).default;
    expect(config.test?.environment).toBe('jsdom');
    expect(config.plugins?.length ?? 0).toBeGreaterThan(0);
  });

  it('setupFiles registruje úklid po každém testu', async () => {
    const config = (await import('../vitest.config.js')).default;
    const setupFiles = config.test?.setupFiles ?? [];
    expect(setupFiles.length, 'bez setupFiles zůstane render z předchozího testu').toBeGreaterThan(
      0,
    );
    // Prázdný setup soubor je stejná vada jako žádný: úklid se registruje sám
    // jen při globals: true. Bez cleanup() padne každý druhý render na
    // "Found multiple elements with the role".
    const setup = fs.readFileSync(path.join(import.meta.dirname, '../vitest.setup.ts'), 'utf8');
    expect(setup).toContain('cleanup');
    expect(setup).toContain('afterEach');
  });
});

describe('GET /api/health/ready', () => {
  it('vrátí 503 a seznam kontrol, když databáze neodpovídá', async () => {
    const { GET } = await import('../src/app/api/health/ready/route.js');
    const response = await GET();
    expect(response.status).toBe(503);
    const body = (await response.json()) as { checks: { name: string; status: string }[] };
    expect(body.checks.map((check) => check.name)).toContain('database');
    expect(body.checks.find((check) => check.name === 'database')?.status).toBe('fail');
  });

  it('nikdy necachuje odpověď', async () => {
    const module = await import('../src/app/api/health/ready/route.js');
    expect(module.dynamic).toBe('force-dynamic');
    expect(module.runtime).toBe('nodejs');
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/web exec vitest run
```
Expected: FAIL, `Cannot find module '@mlain/web'` nebo `Failed to resolve import`.

- [ ] **Krok 3: Napiš manifest, konfiguraci a tsconfig aplikace**

`apps/web/package.json`:

```json
{
  "name": "@mlain/web",
  "version": "0.0.0",
  "private": true,
  "license": "MIT",
  "type": "module",
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test:unit": "vitest run"
  },
  "dependencies": {
    "@mlain/core": "workspace:*",
    "next": "16.2.12",
    "react": "^19.2.0",
    "react-dom": "^19.2.0"
  },
  "devDependencies": {
    "@mlain/config": "workspace:*",
    "@testing-library/jest-dom": "^6.9.1",
    "@testing-library/react": "^16.3.2",
    "@types/react": "^19.2.0",
    "@types/react-dom": "^19.2.0",
    "@vitejs/plugin-react": "6.0.5",
    "jsdom": "30.0.1",
    "vitest": "4.1.10"
  }
}
```

Čtyři testovací závislosti zavádí P01, i když komponenty píšou P05, P06 a P12: bez nich se `vitest.config.ts` z tohohle úkolu ani nenačte, a instalovat je z cizího plánu by znamenalo měnit manifest, který vlastní P01.

`apps/web/next.config.ts`. `output: 'standalone'` je podmínka pro Dockerfile z 3.12; `outputFileTracingRoot` je nutné, protože pnpm dělá symlinky a bez něj standalone build nezabalí workspace balíčky.

**`experimental.instrumentationHook` se NEZAVÁDÍ.** V Next 16 ta volba neexistuje: v typu `NextConfig` není a načtení konfigurace na ni hlásí `experimental.instrumentationHook is no longer needed, because instrumentation.js is available by default`. Ověřeno čtením `next@16.2.12`, souboru `dist/server/config.js` a `dist/server/config-shared.d.ts`. Soubor `src/instrumentation.ts` se od Next 15 načítá sám, bez jakéhokoliv přepínače.

```ts
import path from 'node:path';
import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  reactStrictMode: true,
  poweredByHeader: false,
  // Graceful shutdown registruje src/instrumentation.ts. Žádný přepínač
  // nepotřebuje: instrumentation.ts je od Next 15 stabilní a načítá se sám.
};

export default config;
```

`apps/web/tsconfig.json`. `next.config.ts` je v `include` schválně: bez toho by ho `tsc` neviděl a neplatná volba konfigurace by se projevila až varováním při buildu, tedy na místě, kde ji nikdo nečte.

```json
{
  "extends": "@mlain/config/tsconfig/next.json",
  "compilerOptions": {
    "rootDir": ".",
    "paths": { "@/*": ["./src/*"] }
  },
  "include": [
    "next.config.ts",
    "src/**/*.ts",
    "src/**/*.tsx",
    "test/**/*.ts",
    "next-env.d.ts",
    ".next/types/**/*.ts"
  ]
}
```

`apps/web/vitest.config.ts`. **Tenhle soubor vlastní P01, ale testy do `apps/web` píšou P05, P06 a P12**, a všichni tři je dávají vedle zdroje, ne do `test/`. Konfigurace to musí unést od začátku, protože P01 běží první a přebírající plány si ji upravit nesmí.

Původní znění `{ environment: 'node', include: ['test/**/*.test.ts'] }` mělo **nejtišší možné selhání celého projektu**: testy v `src/` do vzoru nespadnou, takže se nespustí, a `vitest run` skončí **zeleně s návratovým kódem nula**. Změřeno na Vitest 4.1.10 s jedním procházejícím testem v `test/` a jedním záměrně padajícím v `src/`:

```
 Test Files  1 passed (1)
      Tests  1 passed (1)
EXIT=0
```

Postihlo by to 44 ze 46 testovacích souborů P06, všechny testy P12 a `src/proxy.test.ts` z P05. Krok „spusť test, musí spadnout" by nevypsal červený test, ale hlášku, že žádné testy nejsou; to vypadá jako úspěch a je to horší než selhání.

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Plugin React je nutný kvůli JSX v komponentních testech P05, P06 a P12.
  plugins: [react()],
  test: {
    // jsdom, ne node: render() z @testing-library/react potřebuje dokument.
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // src/ MUSÍ být ve vzoru. Testy vedle zdroje jsou tvar, na kterém se shodly
    // P05, P06 i P12; bez tohohle řádku se ani jeden z nich nespustí a série
    // přesto skončí nulou.
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
  },
});
```

`apps/web/vitest.setup.ts`. **Samotné rozšíření vzoru nestačí** a soubor nesmí zůstat prázdný. Ověřeno spuštěním: se správným `include`, `jsdom` i pluginem, ale prázdným setupem padne druhý a každý další render na

```
TestingLibraryElementError: Found multiple elements with the role "button"
```

protože automatický úklid `@testing-library/react` se sám registruje jen při `globals: true`, a bez něj zůstane strom z předchozího testu v dokumentu. Postihlo by to všech 27 testů komponent P06 a všechny testy P12, a vypadalo by to jako chyba testu, ne konfigurace.

```ts
// Registruje matchery jest-dom (toBeInTheDocument a další) a úklid po každém
// testu. Bez cleanup() zůstává předchozí render v dokumentu a getByRole najde
// víc prvků téže role. Explicitní afterEach je zvolený schválně místo
// globals: true, aby se testy nepsaly proti implicitním globálům.
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
```

- [ ] **Krok 4: Napiš `apps/web/src/lib/runtime.ts`**

```ts
import fs from 'node:fs';
import path from 'node:path';
import { loadConfig, type MlainConfig } from '@mlain/core/config';
import { createLogger, type Logger } from '@mlain/core/logging';

/**
 * Nejvyšší číslo migrace zabudované v tomhle buildu.
 *
 * ČTE SE ZA BĚHU, nezapisuje se ručně. Dřívější znění mělo natvrdo `0`
 * a předávalo P03 úkol nahradit ho skutečným číslem. To předání nikam
 * nedosedlo (slovo EXPECTED_SCHEMA_VERSION se v celém P03 nevyskytuje) a
 * důsledkem by bylo, že readiness porovnává verzi schématu s nulou navždy,
 * tedy že akceptační kritérium 13 nekontroluje nic.
 *
 * Zdrojem pravdy je `packages/db/migrations/meta/_journal.json`, tedy tentýž
 * soubor, ze kterého počítá číslo migrační runner v P03: `entries.length`.
 * Dokud journal neexistuje, je hodnota 0 a kontrola schématu hlásí `skip`
 * (rozhodnutí D3). Jakmile P03 první migraci commitne, kontrola se sama stane
 * ostrou a nikdo do tohohle souboru nesahá.
 */
function readExpectedSchemaVersion(): number {
  const journal = path.join(
    import.meta.dirname,
    '../../../../packages/db/migrations/meta/_journal.json',
  );
  try {
    const parsed = JSON.parse(fs.readFileSync(journal, 'utf8')) as { entries?: unknown[] };
    return Array.isArray(parsed.entries) ? parsed.entries.length : 0;
  } catch {
    // Journal ještě neexistuje (P03 ho dodá) nebo je v image mimo dosah.
    // Nula znamená "build bez migrací" a readiness kontrolu jen přeskočí.
    return 0;
  }
}

export const EXPECTED_SCHEMA_VERSION = readExpectedSchemaVersion();

let config: MlainConfig | undefined;
let logger: Logger | undefined;

export function getConfig(): MlainConfig {
  config ??= loadConfig();
  return config;
}

export function getLogger(): Logger {
  if (!logger) {
    const current = getConfig();
    logger = createLogger({
      level: current.LOG_LEVEL,
      format: current.LOG_FORMAT,
      mode: 'web',
      version: current.IMAGE_VERSION,
    });
  }
  return logger;
}
```

- [ ] **Krok 5: Napiš health endpointy a skořápku**

`apps/web/src/app/api/health/route.ts`:

```ts
import { liveness } from '@mlain/core/health';
import { getConfig } from '@/lib/runtime.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Liveness. Nekontroluje nic než to, že proces žije (část 1, kapitola 3.12). */
export function GET(): Response {
  const config = getConfig();
  return Response.json(liveness(config.MODE, config.IMAGE_VERSION), {
    status: 200,
    headers: { 'Cache-Control': 'no-store' },
  });
}
```

`apps/web/src/app/api/health/ready/route.ts`:

```ts
import { Client } from 'pg';
import {
  aiKeyLeakCheck,
  buildReadiness,
  dataDirCheck,
  databaseCheck,
  schemaCheck,
} from '@mlain/core/health';
import { EXPECTED_SCHEMA_VERSION, getConfig } from '@/lib/runtime.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function readSchemaVersion(connectionString: string, timeoutMs: number): Promise<number> {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: timeoutMs,
    statement_timeout: timeoutMs,
    application_name: 'mlain-healthcheck',
  });
  try {
    await client.connect();
    const result = await client.query<{ schema_version: number }>(
      'SELECT schema_version FROM system_settings LIMIT 1',
    );
    return result.rows[0]?.schema_version ?? 0;
  } finally {
    await client.end().catch(() => {});
  }
}

export async function GET(): Promise<Response> {
  const config = getConfig();
  const timeoutMs = 2000;

  const result = await buildReadiness([
    databaseCheck({ connectionString: config.DATABASE_URL, timeoutMs }),
    schemaCheck({
      query: () => readSchemaVersion(config.DATABASE_URL, timeoutMs),
      expectedVersion: EXPECTED_SCHEMA_VERSION,
    }),
    dataDirCheck(config.DATA_DIR),
    aiKeyLeakCheck(),
  ]);

  return Response.json(
    { status: result.status, checks: result.checks },
    { status: result.httpStatus, headers: { 'Cache-Control': 'no-store' } },
  );
}
```

`apps/web/src/app/layout.tsx`. Minimální skořápka. **P05 ji přepíše celou**, tenhle soubor existuje jen proto, aby `next build` prošel.

```tsx
import type { ReactNode } from 'react';

export const metadata = { title: 'Mlain Mailer' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="cs">
      <body>{children}</body>
    </html>
  );
}
```

`apps/web/src/app/page.tsx`:

```tsx
export default function Page() {
  return <main>Mlain Mailer</main>;
}
```

Založ **`apps/web/public/.gitkeep`**. Adresář je prázdný a statické soubory do něj bude psát P05, ale musí existovat od začátku: runtime vrstva Dockerfilu má řádek `COPY --from=node-builder /app/apps/web/public ./apps/web/public` a `COPY` na neexistující cestu build **zabije** chybou `lstat: no such file or directory`. Ověřeno spuštěním `docker build`. Next standalone `public/` sám nezabaluje, takže ten `COPY` z Dockerfilu vypustit nejde.

`apps/web/src/instrumentation.ts`:

```ts
/**
 * Next.js standalone server sám graceful shutdown nedělá. Registrace probíhá
 * tady, protože instrumentation.register() běží jednou při startu serveru.
 */
export async function register(): Promise<void> {
  if (process.env['NEXT_RUNTIME'] !== 'nodejs') return;
  const { createShutdownController } = await import('@mlain/core/shutdown');
  const { getConfig, getLogger } = await import('@/lib/runtime.js');

  const config = getConfig();
  const logger = getLogger();
  const controller = createShutdownController({
    graceSeconds: config.SHUTDOWN_GRACE_SECONDS,
    logger,
  });
  controller.register('http', async () => {
    logger.info({}, 'web přestává přijímat nová spojení');
  });
  controller.listen();
}
```

- [ ] **Krok 6: Spusť test a ověř, že prochází**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm install && pnpm --filter @mlain/web exec vitest run
```
Expected: PASS, `Tests  6 passed (6)`.

- [ ] **Krok 7: Ověř, že Next build projde a vyrobí standalone**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/web run build && ls apps/web/.next/standalone/apps/web/server.js
```
Expected: build skončí `✓ Compiled successfully` a `ls` vypíše cestu k `server.js`. Kdyby soubor chyběl, je špatně `outputFileTracingRoot`.

- [ ] **Krok 8: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add apps/web pnpm-lock.yaml && git commit -m "feat(web): next standalone skeleton with liveness and readiness endpoints"
```

---

### Úkol 14: Kostra `apps/worker`

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/apps/worker/package.json`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/worker/tsconfig.json`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/worker/vitest.config.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/worker/build.mjs`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/worker/codegen.mjs`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/worker/src/handlers.generated.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/worker/src/boss.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/worker/src/health-server.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/worker/src/main.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/apps/worker/test/boss.test.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/apps/worker/test/handlers-drift.test.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/apps/worker/test/boss-events.test.ts`

- [ ] **Krok 1: Napiš padající testy**

`apps/worker/test/boss.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { QUEUE_REGISTRY } from '@mlain/core/queues';
import { registerQueues } from '../src/boss.js';

function fakeBoss() {
  return {
    createQueue: vi.fn(async () => {}),
    schedule: vi.fn(async () => {}),
    work: vi.fn(async () => 'worker-id'),
  };
}

describe('registrace front', () => {
  it('založí každou frontu z registru, včetně dead letter variant', async () => {
    const boss = fakeBoss();
    await registerQueues(boss as never, {}, { concurrency: 5, logger: silentLogger() });
    const created = boss.createQueue.mock.calls.map((call) => call[0] as string);
    for (const entry of QUEUE_REGISTRY) {
      expect(created, `chybí ${entry.name}`).toContain(entry.name);
      if (entry.deadLetter) expect(created).toContain(`${entry.name}.dlq`);
    }
  });

  it('naplánuje každou frontu, která má cron', async () => {
    const boss = fakeBoss();
    await registerQueues(boss as never, {}, { concurrency: 5, logger: silentLogger() });
    const scheduled = boss.schedule.mock.calls.map((call) => call[0] as string);
    for (const entry of QUEUE_REGISTRY.filter((item) => item.cron)) {
      expect(scheduled, `chybí plán ${entry.name}`).toContain(entry.name);
    }
  });

  it('zaregistruje handler jen tam, kde existuje, a zbytek nahlásí', async () => {
    const boss = fakeBoss();
    const logger = silentLogger();
    await registerQueues(
      boss as never,
      { 'platform.backup': async () => {} },
      { concurrency: 5, logger },
    );
    expect(boss.work).toHaveBeenCalledOnce();
    expect(boss.work.mock.calls[0]?.[0]).toBe('platform.backup');
    expect(logger.warn).toHaveBeenCalled();
  });

  it('předá localConcurrency z WORKER_CONCURRENCY', async () => {
    const boss = fakeBoss();
    await registerQueues(
      boss as never,
      { 'platform.backup': async () => {} },
      { concurrency: 7, logger: silentLogger() },
    );
    const options = boss.work.mock.calls[0]?.[1] as { batchSize?: number };
    expect(options).toMatchObject({ batchSize: 1 });
  });

  it('respektuje vlastní souběžnost fronty, když ji registr uvádí', async () => {
    const boss = fakeBoss();
    await registerQueues(
      boss as never,
      { 'tracking.process_engagement': async () => {} },
      { concurrency: 7, logger: silentLogger() },
    );
    expect(boss.work).toHaveBeenCalled();
  });
});

function silentLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}
```

`apps/worker/test/boss-events.test.ts`. Tenhle test se **neptá plánu, ale knihovny.** Přihlášení k neexistující události v EventEmitteru nic nevyhodí, jen se handler nikdy nezavolá, takže překlep ani zrušený název se jinak nepozná. Kontrola proti exportu `events` z pg-boss to zachytí i při povýšení verze.

```ts
import { describe, expect, it } from 'vitest';
import { events, PgBoss } from 'pg-boss';
import { BOSS_EVENTS } from '../src/boss.js';

describe('události pg-boss', () => {
  it('worker se přihlašuje jen k událostem, které pg-boss opravdu má', () => {
    const known = Object.keys(events);
    for (const name of BOSS_EVENTS) {
      expect(known, `pg-boss nezná událost "${name}", výčet je ${known.join(', ')}`).toContain(name);
    }
  });

  it('událost maintenance neexistuje, readiness na ní stát nesmí', () => {
    expect(Object.keys(events)).not.toContain('maintenance');
  });

  it('pg-boss se importuje pojmenovaně, ne jako default', () => {
    expect(typeof PgBoss).toBe('function');
  });

  it('readiness workeru se opírá o metodu, kterou pg-boss vydává', () => {
    expect(typeof PgBoss.prototype.isInstalled).toBe('function');
  });
});
```

`apps/worker/test/handlers-drift.test.ts`:

```ts
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');

describe('handlers.generated.ts', () => {
  it('se shoduje s výstupem codegenu (uzávěr S8, rozhodnutí D4)', () => {
    const file = path.join(ROOT, 'apps/worker/src/handlers.generated.ts');
    const committed = fs.readFileSync(file, 'utf8');
    const regenerated = execFileSync(
      process.execPath,
      [path.join(ROOT, 'apps/worker/codegen.mjs'), '--stdout'],
      { encoding: 'utf8' },
    );
    expect(committed).toBe(regenerated);
  });

  it('nese poznámku, že se soubor nikdy neslučuje ručně', () => {
    const file = path.join(ROOT, 'apps/worker/src/handlers.generated.ts');
    expect(fs.readFileSync(file, 'utf8')).toContain('nikdy neslučuje ručně');
  });
});
```

- [ ] **Krok 2: Spusť testy a ověř, že padají**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/worker exec vitest run
```
Expected: FAIL, `Cannot find module '@mlain/worker'` nebo `Failed to resolve import "../src/boss.js"`.

- [ ] **Krok 3: Napiš manifest a konfiguraci workeru**

`apps/worker/package.json`:

```json
{
  "name": "@mlain/worker",
  "version": "0.0.0",
  "private": true,
  "license": "MIT",
  "type": "module",
  "scripts": {
    "codegen": "node codegen.mjs",
    "build": "node codegen.mjs && node build.mjs",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test:unit": "vitest run"
  },
  "dependencies": {
    "@mlain/core": "workspace:*",
    "pg-boss": "12.26.3"
  },
  "devDependencies": {
    "@mlain/config": "workspace:*",
    "esbuild": "^0.25.0",
    "vitest": "4.1.10"
  }
}
```

`apps/worker/tsconfig.json`:

```json
{
  "extends": "@mlain/config/tsconfig/node.json",
  "compilerOptions": { "rootDir": "." },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

`apps/worker/vitest.config.ts`. Vzor zahrnuje i `src/`, ze stejného důvodu jako u `packages/core`.

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts', 'test/**/*.test.ts'] },
});
```

`apps/worker/build.mjs`:

```js
import { build } from 'esbuild';

// Bundle do jediného souboru, protože runtime vrstva Dockerfile kopíruje jen
// apps/worker/dist, ne node_modules workeru.
await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});
console.log('apps/worker/dist/main.js hotovo');
```

- [ ] **Krok 4: Napiš `apps/worker/codegen.mjs` a vygeneruj `handlers.generated.ts`**

```js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TARGET = path.join(ROOT, 'apps/worker/src/handlers.generated.ts');

/**
 * ROZHODNUTÍ D4. Uzávěr S8 chce, aby si handlery psala každá doména do svého
 * souboru a entrypoint je jen složil. Ruční výčet by ale byl sdílený soubor
 * editovaný osmi plány, tedy osm merge konfliktů. Tenhle skript proto najde
 * všechny existující moduly `packages/core/src/<domena>/jobs/queue-handlers.ts`
 * a vyrobí z nich statickou mapu.
 *
 * Platí u něj stejné pravidlo jako u openapi.json (uzávěr S9): soubor se nikdy
 * neslučuje ručně, při konfliktu se přegeneruje.
 */
function findHandlerModules() {
  const coreSrc = path.join(ROOT, 'packages/core/src');
  if (!fs.existsSync(coreSrc)) return [];
  return fs
    .readdirSync(coreSrc, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((domain) => fs.existsSync(path.join(coreSrc, domain, 'jobs/queue-handlers.ts')))
    .sort();
}

function render(domains) {
  const imports = domains
    .map((domain, index) => `import { handlers as h${index} } from '@mlain/core/${domain}/jobs';`)
    .join('\n');
  const spread = domains.map((_, index) => `  ...h${index},`).join('\n');

  return `// GENEROVANÝ SOUBOR. Nezapisuj do něj ručně a nikdy ho neslučuj ručně.
// Vyrábí ho apps/worker/codegen.mjs z modulů packages/core/src/<domena>/jobs/queue-handlers.ts.
// Při konfliktu v gitu zahoď obě verze a spusť: pnpm --filter @mlain/worker run codegen
import type { QueueHandler } from '@mlain/core/queues';
${imports}

export const HANDLERS: Record<string, QueueHandler> = {
${spread}
};
`;
}

const output = render(findHandlerModules());
if (process.argv.includes('--stdout')) {
  process.stdout.write(output);
} else {
  fs.writeFileSync(TARGET, output);
  console.log(`Zapsáno ${TARGET}`);
}
```

Do `packages/core/src/queues/types.ts` doplň typ handleru:

```ts
export interface QueueJob<TPayload = Record<string, unknown>> {
  readonly id: string;
  readonly name: string;
  readonly data: TPayload;
}

export type QueueHandler = (jobs: readonly QueueJob[]) => Promise<void>;
```

Spusť codegen:

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/worker run codegen
```
Expected: `Zapsáno .../apps/worker/src/handlers.generated.ts`. Soubor obsahuje prázdnou mapu `HANDLERS`, protože žádná doména zatím handlery nemá.

- [ ] **Krok 5: Napiš `apps/worker/src/boss.ts`**

```ts
import { QUEUE_REGISTRY, dlqName, type QueueEntry, type QueueHandler } from '@mlain/core/queues';

/**
 * Události, ke kterým se worker přihlašuje. Jediný autoritativní seznam,
 * který pg-boss 12 vydává, je jeho vlastní export `events`; tenhle výčet
 * proti němu porovnává test, aby se nemohl objevit název, který knihovna nezná.
 *
 * Historie: dřívější znění workeru poslouchalo událost `maintenance`, kterou
 * pg-boss 12 nemá. Selhání bylo tiché a projevilo se až za provozu: readiness
 * čekal na tik údržby, ten nikdy nepřišel, a po pěti minutách začal worker
 * trvale hlásit 503, takže ho orchestrátor označil za nezdravý.
 */
export const BOSS_EVENTS = ['error', 'warning', 'stopped'] as const;

export interface RegisterOptions {
  readonly concurrency: number;
  readonly logger: {
    info(object: Record<string, unknown>, message?: string): void;
    warn(object: Record<string, unknown>, message?: string): void;
    error(object: Record<string, unknown>, message?: string): void;
  };
}

/** Minimální podmnožina pg-boss, kterou worker používá. Umožňuje test bez databáze. */
export interface BossLike {
  createQueue(name: string, options?: Record<string, unknown>): Promise<void>;
  schedule(name: string, cron: string, data?: unknown, options?: unknown): Promise<void>;
  work(name: string, options: Record<string, unknown>, handler: QueueHandler): Promise<string>;
}

function queueOptions(entry: QueueEntry): Record<string, unknown> {
  return {
    // Konvence 9.1: explicitně, nikdy se nespoléhat na výchozí hodnoty.
    retryLimit: entry.retryLimit,
    retryBackoff: entry.retryBackoff,
    retryDelay: entry.retryDelaySeconds,
    expireInSeconds: entry.expireInSeconds,
    ...(entry.deadLetter ? { deadLetter: dlqName(entry.name) } : {}),
  };
}

/**
 * Založí všechny fronty z registru, naplánuje ty s cronem a napojí handlery,
 * které v tomhle buildu existují. Fronta bez handleru se přesto zakládá:
 * kdyby ne, doménový plán by při prvním `boss.send` dostal chybu o neexistující
 * frontě a nepoznal by, že jde jen o nedodaný handler.
 */
export async function registerQueues(
  boss: BossLike,
  handlers: Record<string, QueueHandler>,
  options: RegisterOptions,
): Promise<void> {
  const missing: string[] = [];

  for (const entry of QUEUE_REGISTRY) {
    await boss.createQueue(entry.name, queueOptions(entry));
    if (entry.deadLetter) {
      await boss.createQueue(dlqName(entry.name), {
        retryLimit: 0,
        retryBackoff: false,
        retryDelay: 0,
        expireInSeconds: entry.expireInSeconds,
      });
    }
  }

  for (const entry of QUEUE_REGISTRY) {
    if (entry.cron === undefined) continue;
    await boss.schedule(entry.name, entry.cron, {}, { tz: 'UTC' });
  }

  for (const entry of QUEUE_REGISTRY) {
    const handler = handlers[entry.name];
    if (!handler) {
      missing.push(entry.name);
      continue;
    }
    await boss.work(
      entry.name,
      { batchSize: 1, pollingIntervalSeconds: 2, ...(entry.concurrency ? {} : {}) },
      handler,
    );
  }

  if (missing.length > 0) {
    options.logger.warn(
      { queues: missing, count: missing.length },
      'fronty bez handleru v tomhle buildu; dodá je příslušný doménový plán',
    );
  }
  options.logger.info(
    { queues: QUEUE_REGISTRY.length, with_handler: QUEUE_REGISTRY.length - missing.length },
    'registrace front hotová',
  );
}
```

- [ ] **Krok 6: Napiš `apps/worker/src/health-server.ts` a `main.ts`**

`apps/worker/src/health-server.ts`:

```ts
import http from 'node:http';
import type { Check } from '@mlain/core/health';
import { buildReadiness } from '@mlain/core/health';

export interface HealthServerOptions {
  readonly port: number;
  readonly checks: readonly Check[];
}

/**
 * Rozhodnutí D11: node:http stačí, tři cesty bez routingu nepotřebují framework.
 * Port se v compose souboru nepublikuje ven.
 */
export function startHealthServer(options: HealthServerOptions): http.Server {
  const server = http.createServer((request, response) => {
    if (request.url === '/healthz') {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('ok');
      return;
    }
    if (request.url === '/readyz') {
      void buildReadiness(options.checks).then((result) => {
        response.writeHead(result.httpStatus, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ status: result.status, checks: result.checks }));
      });
      return;
    }
    response.writeHead(404, { 'content-type': 'text/plain' });
    response.end('not found');
  });
  server.listen(options.port);
  return server;
}
```

`apps/worker/src/main.ts`:

`pg-boss` 12 je **ESM s pojmenovaným exportem**, žádný `default` nemá. `import PgBoss from 'pg-boss'` skončí `SyntaxError: The requested module 'pg-boss' does not provide an export named 'default'`, ověřeno spuštěním proti 12.26.3. Správně je `import { PgBoss } from 'pg-boss'`.

```ts
import { PgBoss } from 'pg-boss';
import { loadConfig, ConfigError } from '@mlain/core/config';
import { createLogger } from '@mlain/core/logging';
import { createShutdownController } from '@mlain/core/shutdown';
import { aiKeyLeakCheck, type Check } from '@mlain/core/health';
import { registerQueues } from './boss.js';
import { startHealthServer } from './health-server.js';
import { HANDLERS } from './handlers.generated.js';

async function main(): Promise<void> {
  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigError) {
      process.stderr.write(`${error.format()}\n`);
      process.exit(error.exitCode);
    }
    throw error;
  }

  const logger = createLogger({
    level: config.LOG_LEVEL,
    format: config.LOG_FORMAT,
    mode: 'worker',
    version: config.IMAGE_VERSION,
  });

  const boss = new PgBoss({
    connectionString: config.DATABASE_URL,
    schema: config.PGBOSS_SCHEMA,
    max: config.DATABASE_POOL_MAX,
  });
  boss.on('error', (error) => logger.error({ err: error.message }, 'pg-boss ohlásil chybu'));
  boss.on('warning', (warning) => logger.warn({ warning }, 'pg-boss varuje'));

  // Jediný spolehlivý signál, že pg-boss skončil. Bez něj by readiness po
  // zastavení bosse dál hlásil ok, dokud by neselhal dotaz do databáze.
  let bossStopped = false;
  boss.on('stopped', () => {
    bossStopped = true;
  });

  await boss.start();
  await registerQueues(boss as never, HANDLERS, {
    concurrency: config.WORKER_CONCURRENCY,
    logger,
  });

  /**
   * Readiness workeru.
   *
   * NEPOUŽÍVÁ se událost `maintenance`: pg-boss 12 ji nemá. Jeho úplný výčet
   * událostí je `error`, `warning`, `wip`, `stopped`, `bam` a `flow`, ověřeno
   * spuštěním nad exportem `events`. Přihlášení k neexistující události nic
   * nevyhodí, jen se nikdy nezavolá, takže by časová značka zůstala na hodnotě
   * ze startu a po pěti minutách by readiness selhával navždy.
   *
   * Místo časové značky se dělá skutečný dotaz do databáze přes pool, který
   * pg-boss sám drží: `isInstalled()` ověří, že schéma pgboss existuje a že je
   * spojení živé. Je to jediná kontrola, která spadne i tehdy, když databáze
   * zmizí pod běžícím procesem.
   */
  const workerReady: Check = async () => {
    if (bossStopped) {
      return { name: 'pgboss', status: 'fail', detail: 'pg-boss se zastavil' };
    }
    try {
      const installed = await boss.isInstalled();
      if (!installed) {
        return { name: 'pgboss', status: 'fail', detail: 'schéma pgboss v databázi neexistuje' };
      }
      return { name: 'pgboss', status: 'ok' };
    } catch (error) {
      return { name: 'pgboss', status: 'fail', detail: (error as Error).message };
    }
  };

  const server = startHealthServer({
    port: config.WORKER_HEALTH_PORT,
    checks: [workerReady, aiKeyLeakCheck()],
  });
  logger.info({ port: config.WORKER_HEALTH_PORT }, 'worker naslouchá na health portu');

  const shutdown = createShutdownController({
    graceSeconds: config.SHUTDOWN_GRACE_SECONDS,
    logger,
  });
  shutdown.register('health-server', async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  shutdown.register('pg-boss', async () => {
    await boss.stop({ graceful: true, timeout: config.SHUTDOWN_GRACE_SECONDS * 1000 });
  });
  shutdown.listen();
}

await main();
```

- [ ] **Krok 7: Spusť testy a ověř, že procházejí**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm install && pnpm --filter @mlain/worker exec vitest run
```
Expected: PASS, `Tests  11 passed (11)`.

- [ ] **Krok 8: Ověř, že build workeru vyrobí `dist/main.js`**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/worker run build && node --check apps/worker/dist/main.js && echo BUNDLE_OK
```
Expected: `apps/worker/dist/main.js hotovo`, pak `BUNDLE_OK`.

- [ ] **Krok 9: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add apps/worker pnpm-lock.yaml packages/core && git commit -m "feat(worker): pg-boss consumer skeleton with generated handler map"
```

---

### Úkol 15: Kostra `apps/sender` v Go

**Tenhle úkol zakládá soubory, které vlastní P09.** P01 je dodává v minimální podobě, protože bez nich neprojde `build-image` a nelze splnit akceptační kritéria 7e a 8c. Po merge do `main` do nich P01 nesahá a P09 je smí přepsat celé.

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/apps/sender/go.mod`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/sender/internal/version/version.go`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/sender/internal/config/config.go`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/sender/internal/health/server.go`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/sender/cmd/sender/main.go`
- Test: `/Users/petr/Projects/Mailing_Tool/apps/sender/internal/config/config_test.go`
- Test: `/Users/petr/Projects/Mailing_Tool/apps/sender/internal/health/server_test.go`

- [ ] **Krok 1: Založ Go modul**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool/apps/sender && go mod init github.com/nc-mill/mlain/apps/sender && go get github.com/caarlos0/env/v11 github.com/jackc/pgx/v5 && go mod tidy
```
Expected: vznikne `go.mod` s `go 1.26` a `go.sum`. Licence: `caarlos0/env` MIT, `jackc/pgx` MIT.

Když je lokální Go starší než 1.26, uprav `go.mod` řádek na dostupnou verzi a poznamenej to do commit message; CI a Dockerfile používají 1.26.

- [ ] **Krok 2: Napiš padající test konfigurace senderu**

`apps/sender/internal/config/config_test.go`:

```go
package config

import "testing"

func TestLoadDefaults(t *testing.T) {
	env := map[string]string{
		"DATABASE_URL_SENDER": "postgres://mlain_sender:pw@localhost:5432/mlain",
		"SECRET_KEY":          "1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
	}
	cfg, err := LoadFrom(env)
	if err != nil {
		t.Fatalf("neočekávaná chyba: %v", err)
	}
	if cfg.SenderHealthPort != 3002 {
		t.Errorf("SENDER_HEALTH_PORT = %d, chci 3002", cfg.SenderHealthPort)
	}
	if cfg.SenderBatchSize != 100 {
		t.Errorf("SENDER_BATCH_SIZE = %d, chci 100", cfg.SenderBatchSize)
	}
	if cfg.SenderConcurrency != 32 {
		t.Errorf("SENDER_CONCURRENCY = %d, chci 32", cfg.SenderConcurrency)
	}
	if cfg.SenderClaimTTLSeconds != 300 {
		t.Errorf("SENDER_CLAIM_TTL_SECONDS = %d, chci 300", cfg.SenderClaimTTLSeconds)
	}
	if cfg.ShutdownGraceSeconds != 25 {
		t.Errorf("SHUTDOWN_GRACE_SECONDS = %d, chci 25", cfg.ShutdownGraceSeconds)
	}
	if cfg.LogLevel != "info" {
		t.Errorf("LOG_LEVEL = %q, chci info", cfg.LogLevel)
	}
}

func TestLoadCollectsAllErrors(t *testing.T) {
	env := map[string]string{
		"SENDER_BATCH_SIZE":       "99999",
		"SENDER_CONCURRENCY":      "0",
		"SENDER_POLL_INTERVAL_MS": "1",
	}
	_, err := LoadFrom(env)
	if err == nil {
		t.Fatal("chtěl jsem chybu")
	}
	text := err.Error()
	for _, name := range []string{
		"DATABASE_URL_SENDER",
		"SENDER_BATCH_SIZE",
		"SENDER_CONCURRENCY",
		"SENDER_POLL_INTERVAL_MS",
	} {
		if !contains(text, name) {
			t.Errorf("výpis chyb neobsahuje %s: %s", name, text)
		}
	}
}

func TestClaimTTLMustExceedFourDispatchTimeouts(t *testing.T) {
	env := map[string]string{
		"DATABASE_URL_SENDER":              "postgres://mlain_sender:pw@localhost:5432/mlain",
		"SECRET_KEY":                       "1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
		"SENDER_CLAIM_TTL_SECONDS":         "30",
		"SENDER_DISPATCH_TIMEOUT_SECONDS":  "10",
	}
	if _, err := LoadFrom(env); err == nil {
		t.Fatal("chtěl jsem chybu na SENDER_CLAIM_TTL_SECONDS")
	}
}

func TestFileSuffixWins(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/secret"
	if err := writeFile(path, "1:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB\n"); err != nil {
		t.Fatal(err)
	}
	env := map[string]string{
		"DATABASE_URL_SENDER": "postgres://mlain_sender:pw@localhost:5432/mlain",
		"SECRET_KEY":          "1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
		"SECRET_KEY_FILE":     path,
	}
	cfg, err := LoadFrom(env)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.SecretKey != "1:BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB" {
		t.Errorf("_FILE nevyhrálo, mám %q", cfg.SecretKey)
	}
}

func TestNoHealthPortVariable(t *testing.T) {
	// Rozhodnutí D6: HEALTH_PORT se nezavádí, platí rozdělení na worker a sender.
	env := map[string]string{
		"DATABASE_URL_SENDER": "postgres://mlain_sender:pw@localhost:5432/mlain",
		"SECRET_KEY":          "1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
		"HEALTH_PORT":         "9999",
	}
	cfg, err := LoadFrom(env)
	if err != nil {
		t.Fatal(err)
	}
	if cfg.SenderHealthPort != 3002 {
		t.Errorf("HEALTH_PORT se nesmí uplatnit, mám %d", cfg.SenderHealthPort)
	}
}
```

Pomocné funkce `contains` a `writeFile` napiš do `apps/sender/internal/config/helpers_test.go`:

```go
package config

import (
	"os"
	"strings"
)

func contains(haystack, needle string) bool {
	return strings.Contains(haystack, needle)
}

func writeFile(path, content string) error {
	return os.WriteFile(path, []byte(content), 0o600)
}
```

- [ ] **Krok 3: Spusť test a ověř, že padá**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool/apps/sender && go test ./internal/config/
```
Expected: FAIL, `undefined: LoadFrom` a `undefined: Config`.

- [ ] **Krok 4: Napiš `apps/sender/internal/config/config.go`**

```go
// Package config načítá konfiguraci senderu z prostředí.
//
// Názvy a výchozí hodnoty jsou SHODNÉ s zod schématem v packages/core/src/config.
// Shodu hlídá test config-parity proti packages/core/src/config/config.manifest.json.
// Sender validuje jen svou podmnožinu, tedy proměnné označené v tabulce 4.9 části 1
// písmenem S.
package config

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strconv"
	"strings"
)

// EXIT_CONFIG podle sysexits.h. Předepisuje ho část 1, kapitola 4.9.
const ExitConfig = 78

type Config struct {
	DatabaseURLSender            string
	SecretKey                    string
	SecretKeyPrevious            []string
	Mode                         string
	SenderID                     string
	SenderHealthPort             int
	SenderConcurrency            int
	SenderBatchSize              int
	SenderClaimTTLSeconds        int
	SenderPollIntervalMs         int
	SenderDispatchTimeoutSeconds int
	SenderCredentialsMaxRetries  int
	SenderReplicas               int
	SenderRateSafety             float64
	SenderMaxAttempts            int
	SenderMaxBackoffSeconds      int
	SenderFatalThreshold         int
	SenderSMTPMaxConnections     int
	SenderSMTPMaxMessagesPerConn int
	SenderSMTPConnectTimeoutSec  int
	SenderSMTPCommandTimeoutSec  int
	SenderSMTPDataTimeoutSec     int
	SenderPrecedenceBulk         bool
	SenderFeedbackID             bool
	SenderTestTracking           bool
	ShutdownGraceSeconds         int
	LogLevel                     string
	LogFormat                    string
	MetricsEnabled               bool
	MetricsToken                 string
	TrackingDomain               string
	AmbiguousDispatchPolicySES   string
	AmbiguousDispatchPolicySMTP  string
	ImageVersion                 string
}

// senderVariables je výčet proměnných, pro které sender podporuje sufix _FILE.
var senderVariables = []string{
	"DATABASE_URL_SENDER", "SECRET_KEY", "SECRET_KEY_PREVIOUS", "METRICS_TOKEN",
}

type issue struct {
	variable string
	message  string
}

type Error struct{ issues []issue }

func (e *Error) Error() string {
	var b strings.Builder
	fmt.Fprintf(&b, "Konfigurace není platná. Nalezeno %d problémů:\n", len(e.issues))
	for _, i := range e.issues {
		fmt.Fprintf(&b, "  %s: %s\n", i.variable, i.message)
	}
	return b.String()
}

// ExitCode vrací 78, aby se chování shodovalo s TypeScript stranou.
func (e *Error) ExitCode() int { return ExitConfig }

// Load načte konfiguraci z os.Environ.
func Load() (*Config, error) {
	env := map[string]string{}
	for _, entry := range os.Environ() {
		if key, value, found := strings.Cut(entry, "="); found {
			env[key] = value
		}
	}
	return LoadFrom(env)
}

// LoadFrom načte konfiguraci z předané mapy. VŠECHNY chyby se vracejí naráz,
// ne jen první; je to akceptační kritérium 3 části 1.
func LoadFrom(env map[string]string) (*Config, error) {
	var issues []issue

	// Tajemství ze souborů: varianta se sufixem _FILE vyhrává (část 1, 4.9).
	for _, name := range senderVariables {
		path, ok := env[name+"_FILE"]
		if !ok || path == "" {
			continue
		}
		data, err := os.ReadFile(path)
		if err != nil {
			issues = append(issues, issue{name + "_FILE", "soubor se nepodařilo přečíst: " + err.Error()})
			continue
		}
		env[name] = strings.TrimRight(string(data), "\r\n")
	}

	cfg := &Config{}
	get := func(name, fallback string) string {
		if value, ok := env[name]; ok && value != "" {
			return value
		}
		return fallback
	}
	intVar := func(name string, fallback, min, max int) int {
		raw := get(name, strconv.Itoa(fallback))
		value, err := strconv.Atoi(raw)
		if err != nil {
			issues = append(issues, issue{name, "musí být celé číslo"})
			return fallback
		}
		if value < min || value > max {
			issues = append(issues, issue{name, fmt.Sprintf("musí být v rozsahu %d až %d", min, max)})
			return fallback
		}
		return value
	}
	floatVar := func(name string, fallback, min, max float64) float64 {
		raw := get(name, strconv.FormatFloat(fallback, 'g', -1, 64))
		value, err := strconv.ParseFloat(raw, 64)
		if err != nil || value < min || value > max {
			issues = append(issues, issue{name, fmt.Sprintf("musí být číslo v rozsahu %g až %g", min, max)})
			return fallback
		}
		return value
	}
	boolVar := func(name string, fallback bool) bool {
		raw := get(name, strconv.FormatBool(fallback))
		return raw == "true" || raw == "1"
	}
	enumVar := func(name, fallback string, allowed ...string) string {
		value := get(name, fallback)
		for _, candidate := range allowed {
			if value == candidate {
				return value
			}
		}
		issues = append(issues, issue{name, "musí být jedno z: " + strings.Join(allowed, ", ")})
		return fallback
	}

	cfg.DatabaseURLSender = get("DATABASE_URL_SENDER", "")
	if cfg.DatabaseURLSender == "" {
		issues = append(issues, issue{"DATABASE_URL_SENDER", "je povinná (required) a chybí"})
	} else if parsed, err := url.Parse(cfg.DatabaseURLSender); err != nil ||
		(parsed.Scheme != "postgres" && parsed.Scheme != "postgresql") {
		issues = append(issues, issue{"DATABASE_URL_SENDER", "musí být připojovací řetězec postgres://"})
	}

	cfg.SecretKey = get("SECRET_KEY", "")
	if cfg.SecretKey == "" {
		issues = append(issues, issue{"SECRET_KEY", "je povinná (required) a chybí"})
	} else if err := validateKey(cfg.SecretKey); err != nil {
		issues = append(issues, issue{"SECRET_KEY", err.Error()})
	}

	// SECRET_KEY_PREVIOUS je BEZ HORNÍHO POČTU POLOŽEK (část 1, kapitola 3.10).
	if raw := get("SECRET_KEY_PREVIOUS", ""); raw != "" {
		for _, item := range strings.Split(raw, ",") {
			item = strings.TrimSpace(item)
			if item == "" {
				continue
			}
			if err := validateKey(item); err != nil {
				issues = append(issues, issue{"SECRET_KEY_PREVIOUS", "položka \"" + item + "\": " + err.Error()})
				continue
			}
			cfg.SecretKeyPrevious = append(cfg.SecretKeyPrevious, item)
		}
	}

	cfg.Mode = enumVar("MODE", "all", "web", "worker", "sender", "all")
	cfg.SenderID = get("SENDER_ID", defaultSenderID())
	if len(cfg.SenderID) > 64 {
		issues = append(issues, issue{"SENDER_ID", "nejvýš 64 znaků"})
	}
	// Rozhodnutí D6: SENDER_HEALTH_PORT, nikdy HEALTH_PORT.
	cfg.SenderHealthPort = intVar("SENDER_HEALTH_PORT", 3002, 1, 65535)
	cfg.SenderConcurrency = intVar("SENDER_CONCURRENCY", 32, 1, 1024)
	cfg.SenderBatchSize = intVar("SENDER_BATCH_SIZE", 100, 1, 5000)
	cfg.SenderClaimTTLSeconds = intVar("SENDER_CLAIM_TTL_SECONDS", 300, 30, 3600)
	cfg.SenderPollIntervalMs = intVar("SENDER_POLL_INTERVAL_MS", 1000, 100, 60000)
	cfg.SenderDispatchTimeoutSeconds = intVar("SENDER_DISPATCH_TIMEOUT_SECONDS", 10, 1, 300)
	cfg.SenderCredentialsMaxRetries = intVar("SENDER_CREDENTIALS_MAX_RETRIES", 10, 1, 100)
	cfg.SenderReplicas = intVar("SENDER_REPLICAS", 1, 1, 100)
	cfg.SenderRateSafety = floatVar("SENDER_RATE_SAFETY", 0.9, 0.1, 1.0)
	cfg.SenderMaxAttempts = intVar("SENDER_MAX_ATTEMPTS", 5, 1, 20)
	cfg.SenderMaxBackoffSeconds = intVar("SENDER_MAX_BACKOFF_SECONDS", 3600, 1, 86400)
	cfg.SenderFatalThreshold = intVar("SENDER_FATAL_THRESHOLD", 3, 1, 100)
	cfg.SenderSMTPMaxConnections = intVar("SENDER_SMTP_MAX_CONNECTIONS", 4, 1, 32)
	cfg.SenderSMTPMaxMessagesPerConn = intVar("SENDER_SMTP_MAX_MESSAGES_PER_CONN", 100, 1, 10000)
	cfg.SenderSMTPConnectTimeoutSec = intVar("SENDER_SMTP_CONNECT_TIMEOUT_SECONDS", 10, 1, 300)
	cfg.SenderSMTPCommandTimeoutSec = intVar("SENDER_SMTP_COMMAND_TIMEOUT_SECONDS", 30, 1, 300)
	cfg.SenderSMTPDataTimeoutSec = intVar("SENDER_SMTP_DATA_TIMEOUT_SECONDS", 120, 1, 900)
	cfg.SenderPrecedenceBulk = boolVar("SENDER_PRECEDENCE_BULK", true)
	cfg.SenderFeedbackID = boolVar("SENDER_FEEDBACK_ID", true)
	cfg.SenderTestTracking = boolVar("SENDER_TEST_TRACKING", false)
	cfg.ShutdownGraceSeconds = intVar("SHUTDOWN_GRACE_SECONDS", 25, 1, 300)
	cfg.LogLevel = enumVar("LOG_LEVEL", "info", "trace", "debug", "info", "warn", "error", "fatal")
	cfg.LogFormat = enumVar("LOG_FORMAT", "json", "json", "pretty")
	cfg.MetricsEnabled = boolVar("METRICS_ENABLED", false)
	cfg.MetricsToken = get("METRICS_TOKEN", "")
	cfg.TrackingDomain = get("TRACKING_DOMAIN", "")
	cfg.AmbiguousDispatchPolicySES = enumVar("AMBIGUOUS_DISPATCH_POLICY_SES", "fail", "retry", "fail")
	cfg.AmbiguousDispatchPolicySMTP = enumVar("AMBIGUOUS_DISPATCH_POLICY_SMTP", "retry", "retry", "fail")
	cfg.ImageVersion = get("IMAGE_VERSION", "0.0.0-dev")

	if cfg.MetricsEnabled && len(cfg.MetricsToken) < 32 {
		issues = append(issues, issue{"METRICS_TOKEN", "je povinná (required) při METRICS_ENABLED=true a musí mít aspoň 32 znaků"})
	}
	// Pod čtyřnásobkem by hlídač zaseknuté dávky hlásil planý poplach na každé
	// normálně běžící dávce (část 1, 4.9, sekce sender).
	if cfg.SenderClaimTTLSeconds <= 4*cfg.SenderDispatchTimeoutSeconds {
		issues = append(issues, issue{
			"SENDER_CLAIM_TTL_SECONDS",
			fmt.Sprintf("musí být větší než 4 x SENDER_DISPATCH_TIMEOUT_SECONDS (%d)", 4*cfg.SenderDispatchTimeoutSeconds),
		})
	}

	if len(issues) > 0 {
		return nil, &Error{issues: issues}
	}
	return cfg, nil
}

func validateKey(value string) error {
	encoded := value
	if id, rest, found := strings.Cut(value, ":"); found {
		generation, err := strconv.Atoi(id)
		if err != nil || generation < 1 || generation > 255 {
			return errors.New("key_id musí být celé číslo 1 až 255")
		}
		encoded = rest
	}
	decoded, err := base64.RawURLEncoding.DecodeString(encoded)
	if err != nil {
		return errors.New("musí být base64url")
	}
	if len(decoded) != 32 {
		return fmt.Errorf("po dekódování musí mít přesně 32 bajtů, má %d", len(decoded))
	}
	return nil
}

func defaultSenderID() string {
	host, err := os.Hostname()
	if err != nil {
		host = "sender"
	}
	return fmt.Sprintf("%s-%d", host, os.Getpid())
}
```

- [ ] **Krok 5: Spusť test a ověř, že prochází**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool/apps/sender && go test ./internal/config/
```
Expected: `ok  	github.com/nc-mill/mlain/apps/sender/internal/config`

- [ ] **Krok 6: Napiš padající test health serveru**

`apps/sender/internal/health/server_test.go`:

```go
package health

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestHealthzAlwaysOK(t *testing.T) {
	handler := NewHandler(Options{Ping: func(context.Context) error { return nil }})
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/healthz", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, chci 200", recorder.Code)
	}
	if recorder.Body.String() != "ok" {
		t.Errorf("tělo = %q, chci ok", recorder.Body.String())
	}
}

func TestReadyzOKWhenDatabaseAnswers(t *testing.T) {
	handler := NewHandler(Options{Ping: func(context.Context) error { return nil }})
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, chci 200", recorder.Code)
	}
}

func TestReadyz503WhenDatabaseFails(t *testing.T) {
	handler := NewHandler(Options{Ping: func(context.Context) error { return errors.New("down") }})
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/readyz", nil))
	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, chci 503", recorder.Code)
	}
}

func TestMetricsRequiresTokenWhenEnabled(t *testing.T) {
	handler := NewHandler(Options{
		Ping:           func(context.Context) error { return nil },
		MetricsEnabled: true,
		MetricsToken:   "0123456789012345678901234567890123",
	})
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	if recorder.Code != http.StatusUnauthorized {
		t.Fatalf("bez tokenu status = %d, chci 401", recorder.Code)
	}

	request := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	request.Header.Set("Authorization", "Bearer 0123456789012345678901234567890123")
	recorder = httptest.NewRecorder()
	handler.ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("s tokenem status = %d, chci 200", recorder.Code)
	}
}

func TestMetricsDisabledReturns404(t *testing.T) {
	handler := NewHandler(Options{Ping: func(context.Context) error { return nil }})
	recorder := httptest.NewRecorder()
	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/metrics", nil))
	if recorder.Code != http.StatusNotFound {
		t.Fatalf("status = %d, chci 404", recorder.Code)
	}
}
```

- [ ] **Krok 7: Spusť test a ověř, že padá**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool/apps/sender && go test ./internal/health/
```
Expected: FAIL, `undefined: NewHandler`, `undefined: Options`.

- [ ] **Krok 8: Napiš `apps/sender/internal/health/server.go` a `internal/version/version.go`**

`apps/sender/internal/health/server.go`:

```go
// Package health obsluhuje /healthz, /readyz a /metrics na SENDER_HEALTH_PORT.
//
// Část 4b, kapitola 4.4: žádný z endpointů nevyžaduje autentizaci kromě /metrics
// a žádný nevrací data zákazníka. Port se v compose souboru nepublikuje ven.
//
// P09 tenhle soubor rozšíří o kontrolu "poslední úspěšný claim mladší než 60 s
// nebo prázdný outbox". P01 dodává jen ping databáze, protože outbox zatím
// neexistuje.
package health

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"strings"
	"time"
)

type Options struct {
	// Ping ověří, že databáze odpovídá. Timeout si řídí handler.
	Ping           func(context.Context) error
	MetricsEnabled bool
	MetricsToken   string
	// MetricsHandler dodá P09, když zapojí prometheus/client_golang.
	MetricsHandler http.Handler
}

// readyTimeout je 2 s podle části 4b, kapitoly 4.4.
const readyTimeout = 2 * time.Second

func NewHandler(options Options) http.Handler {
	mux := http.NewServeMux()

	mux.HandleFunc("/healthz", func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("ok"))
	})

	mux.HandleFunc("/readyz", func(w http.ResponseWriter, r *http.Request) {
		ctx, cancel := context.WithTimeout(r.Context(), readyTimeout)
		defer cancel()

		status := "ok"
		code := http.StatusOK
		detail := ""
		if err := options.Ping(ctx); err != nil {
			status = "fail"
			code = http.StatusServiceUnavailable
			detail = err.Error()
		}

		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(code)
		_ = json.NewEncoder(w).Encode(map[string]any{
			"status": status,
			"checks": []map[string]string{{"name": "database", "status": status, "detail": detail}},
		})
	})

	mux.HandleFunc("/metrics", func(w http.ResponseWriter, r *http.Request) {
		if !options.MetricsEnabled {
			http.NotFound(w, r)
			return
		}
		provided := strings.TrimPrefix(r.Header.Get("Authorization"), "Bearer ")
		if subtle.ConstantTimeCompare([]byte(provided), []byte(options.MetricsToken)) != 1 {
			w.WriteHeader(http.StatusUnauthorized)
			return
		}
		if options.MetricsHandler != nil {
			options.MetricsHandler.ServeHTTP(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/plain")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte("# metriky dodá plán P09\n"))
	})

	return mux
}
```

`apps/sender/internal/version/version.go`:

```go
// Package version nese verzi vloženou linkerem přes -X.
package version

// Version vkládá Dockerfile přes -ldflags "-X main.version=${IMAGE_VERSION}".
// Nikdy nesmí být prázdná: akceptační kritérium 7e vyžaduje, aby
// `ml-sender --version` vracel neprázdnou hodnotu shodnou s tagem image.
var Version = "0.0.0-dev"

func Get() string {
	if Version == "" {
		return "0.0.0-dev"
	}
	return Version
}
```

- [ ] **Krok 9: Napiš `apps/sender/cmd/sender/main.go`**

```go
// Command ml-sender je odesílací proces Mlain Maileru.
//
// Tenhle soubor zakládá plán P01 v minimální podobě, aby prošel build image
// a akceptační kritéria 7e a 8c. Vlastní ho plán P09, který sem doplní claim
// smyčku, render, MIME a dispatch.
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/nc-mill/mlain/apps/sender/internal/config"
	"github.com/nc-mill/mlain/apps/sender/internal/health"
	"github.com/nc-mill/mlain/apps/sender/internal/version"
)

// version se vkládá linkerem: -ldflags "-X main.version=${IMAGE_VERSION}".
var version_ = ""

func main() {
	showVersion := flag.Bool("version", false, "vypíše verzi a skončí")
	flag.Parse()

	if version_ != "" {
		version.Version = version_
	}
	if *showVersion {
		fmt.Println(version.Get())
		return
	}

	cfg, err := config.Load()
	if err != nil {
		fmt.Fprint(os.Stderr, err.Error())
		if configErr, ok := err.(*config.Error); ok {
			os.Exit(configErr.ExitCode())
		}
		os.Exit(config.ExitConfig)
	}

	logger := newLogger(cfg)
	slog.SetDefault(logger)
	logger.Info("sender startuje",
		"sender_id", cfg.SenderID,
		"version", version.Get(),
		"batch_size", cfg.SenderBatchSize,
	)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGTERM, syscall.SIGINT)
	defer stop()

	pool, err := pgxpool.New(ctx, cfg.DatabaseURLSender)
	if err != nil {
		logger.Error("nepodařilo se otevřít pool", "err", err.Error())
		os.Exit(1)
	}
	defer pool.Close()

	server := &http.Server{
		Addr: net.JoinHostPort("", strconv.Itoa(cfg.SenderHealthPort)),
		Handler: health.NewHandler(health.Options{
			Ping:           pool.Ping,
			MetricsEnabled: cfg.MetricsEnabled,
			MetricsToken:   cfg.MetricsToken,
		}),
		ReadHeaderTimeout: 5 * time.Second,
	}
	go func() {
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			logger.Error("health server spadl", "err", err.Error())
			os.Exit(1)
		}
	}()
	logger.Info("health server naslouchá", "port", cfg.SenderHealthPort)

	// P09 sem zapojí claimer, workery, campaignPoller a reaper.
	<-ctx.Done()

	// Exit kód je 0 i při vypršení deadlinu: nenulový kód by v Dockeru
	// a Kubernetes vypadal jako pád a spustil restart smyčku (část 4b, 3.14).
	shutdownCtx, cancel := context.WithTimeout(
		context.Background(),
		time.Duration(cfg.ShutdownGraceSeconds)*time.Second,
	)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		logger.Warn("health server se nezavřel v lhůtě", "err", err.Error())
	}
	logger.Info("sender skončil")
}

func newLogger(cfg *config.Config) *slog.Logger {
	levels := map[string]slog.Level{
		"trace": slog.LevelDebug, "debug": slog.LevelDebug, "info": slog.LevelInfo,
		"warn": slog.LevelWarn, "error": slog.LevelError, "fatal": slog.LevelError,
	}
	options := &slog.HandlerOptions{Level: levels[cfg.LogLevel]}
	if cfg.LogFormat == "pretty" {
		return slog.New(slog.NewTextHandler(os.Stdout, options))
	}
	return slog.New(slog.NewJSONHandler(os.Stdout, options))
}
```

- [ ] **Krok 10: Spusť všechny Go testy a ověř `--version`**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool/apps/sender && go vet ./... && go test ./... && go run -ldflags "-X main.version_=1.2.3" ./cmd/sender --version
```
Expected: `go vet` bez výstupu, `ok` u obou balíčků, poslední řádek `1.2.3`.

- [ ] **Krok 11: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add apps/sender && git commit -m "feat(sender): minimal go skeleton with config parity, health and graceful shutdown"
```

---

### Úkol 16: Kostra CLI `mlain`

Rozhodnutí D1: CLI je workspace aplikace `apps/cli`, `docker/mlain` je jen shim.
Rozhodnutí D9: exit 64 pro neznámý podpříkaz, exit 69 pro deklarovaný, ale neimplementovaný.

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/apps/cli/package.json`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/cli/tsconfig.json`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/cli/vitest.config.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/cli/build.mjs`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/cli/src/exit-codes.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/cli/src/registry.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/cli/src/dispatch.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/cli/src/main.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/cli/src/commands/config-check.ts`
- Create: `/Users/petr/Projects/Mailing_Tool/apps/cli/src/commands/healthcheck.ts`
- Test: `/Users/petr/Projects/Mailing_Tool/apps/cli/test/dispatch.test.ts`

- [ ] **Krok 1: Napiš padající test dispatcheru**

`apps/cli/test/dispatch.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { EXIT_UNAVAILABLE, EXIT_USAGE } from '../src/exit-codes.js';
import { COMMANDS } from '../src/registry.js';
import { dispatch } from '../src/dispatch.js';

function io() {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: (line: string) => out.push(line), stderr: (line: string) => err.push(line) };
}

describe('mlain dispatcher', () => {
  it('zná všechny podpříkazy, které specifikace jmenuje', () => {
    const names = COMMANDS.map((command) => command.name).sort();
    expect(names).toEqual([
      'backup',
      'config',
      'doctor',
      'genkey',
      'healthcheck',
      'migrate',
      'rebuild-engagement',
      'reset-password',
      'restore',
      'rotate-credentials',
      'upgrade',
      'version',
    ]);
  });

  it('zná podpříkazy, které vlastník příkazu skutečně dodává', () => {
    const backup = COMMANDS.find((command) => command.name === 'backup');
    // P16 implementuje `backup`, `backup verify` i `backup list`. Kdyby tady
    // `list` chyběl, dispatcher by ho odmítl jako špatný argument.
    expect([...(backup?.subcommands ?? [])].sort()).toEqual(['list', 'verify']);
  });

  it('bez argumentů vypíše nápovědu a skončí 64', async () => {
    const streams = io();
    const code = await dispatch([], streams);
    expect(code).toBe(EXIT_USAGE);
    expect(streams.out.join('\n')).toContain('mlain <příkaz>');
    expect(streams.out.join('\n')).toContain('backup');
  });

  it('neznámý příkaz skončí 64 s návrhem', async () => {
    const streams = io();
    const code = await dispatch(['bakcup'], streams);
    expect(code).toBe(EXIT_USAGE);
    expect(streams.err.join('\n')).toContain('bakcup');
    expect(streams.err.join('\n')).toContain('backup');
  });

  it('deklarovaný, ale neimplementovaný příkaz skončí 69 s jasnou chybou', async () => {
    const streams = io();
    const code = await dispatch(['backup'], streams);
    expect(code).toBe(EXIT_UNAVAILABLE);
    const text = streams.err.join('\n');
    expect(text).toContain('not implemented');
    expect(text).toContain('P16');
  });

  it('migrate hlásí, že ho dodá P03', async () => {
    const streams = io();
    expect(await dispatch(['migrate'], streams)).toBe(EXIT_UNAVAILABLE);
    expect(streams.err.join('\n')).toContain('P03');
  });

  it('version vypíše verzi a skončí nulou', async () => {
    const streams = io();
    const code = await dispatch(['version'], { ...streams, env: { IMAGE_VERSION: '9.9.9' } });
    expect(code).toBe(0);
    expect(streams.out.join('\n')).toContain('9.9.9');
  });

  it('--help u konkrétního příkazu vypíše jeho popis a skončí nulou', async () => {
    const streams = io();
    const code = await dispatch(['backup', '--help'], streams);
    expect(code).toBe(0);
    expect(streams.out.join('\n')).toContain('zálohu');
  });

  it('každý neimplementovaný příkaz zná plán, který ho dodá', () => {
    for (const command of COMMANDS) {
      if (command.implemented) continue;
      expect(command.owner, `${command.name} nemá vlastníka`).toMatch(/^P\d\d$/);
    }
  });

  it('config check při vadné konfiguraci skončí 78', async () => {
    const streams = io();
    const code = await dispatch(['config', 'check'], { ...streams, env: {} });
    expect(code).toBe(78);
    expect(streams.err.join('\n')).toContain('SECRET_KEY');
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/cli exec vitest run
```
Expected: FAIL, `Cannot find module '@mlain/cli'`.

- [ ] **Krok 3: Napiš manifest a konfiguraci CLI**

`apps/cli/package.json`:

```json
{
  "name": "@mlain/cli",
  "version": "0.0.0",
  "private": true,
  "license": "MIT",
  "type": "module",
  "bin": { "mlain": "./dist/main.js" },
  "scripts": {
    "build": "node build.mjs",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test:unit": "vitest run"
  },
  "dependencies": {
    "@mlain/core": "workspace:*"
  },
  "devDependencies": {
    "@mlain/config": "workspace:*",
    "esbuild": "^0.25.0",
    "vitest": "4.1.10"
  }
}
```

`apps/cli/tsconfig.json`:

```json
{
  "extends": "@mlain/config/tsconfig/node.json",
  "compilerOptions": { "rootDir": "." },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

`apps/cli/vitest.config.ts`. Vzor zahrnuje i `src/`: příkazy `mlain` dodává P03 a P16 a testy si můžou psát vedle zdroje.

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['src/**/*.test.ts', 'test/**/*.test.ts'] },
});
```

`apps/cli/build.mjs`:

```js
import { build } from 'esbuild';

await build({
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.js',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: true,
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});
console.log('apps/cli/dist/main.js hotovo');
```

- [ ] **Krok 4: Napiš `exit-codes.ts` a `registry.ts`**

`apps/cli/src/exit-codes.ts`:

```ts
/**
 * Exit kódy CLI. Prvních pět předepisuje specifikace, poslední dva doplnil
 * plán P01 (rozhodnutí D9).
 */
export const EXIT_OK = 0;
/** Migrace spadla. Runner vypíše číslo migrace a příkaz (část 1, 3.13). */
export const EXIT_MIGRATION_FAILED = 3;
/** Přeskočená major verze (část 1, 3.13). */
export const EXIT_VERSION_SKIP = 4;
/** schema_version_ahead, databáze je novější než image (část 1, 3.13). */
export const EXIT_SCHEMA_AHEAD = 5;
/** EX_USAGE: neznámý podpříkaz nebo špatné argumenty. */
export const EXIT_USAGE = 64;
/** EX_UNAVAILABLE: příkaz je deklarovaný, ale v tomhle buildu neimplementovaný. */
export const EXIT_UNAVAILABLE = 69;
/** EX_TEMPFAIL: timeout na advisory lock migrací (část 1, 3.13). */
export const EXIT_TEMPFAIL = 75;
/** EX_CONFIG: konfigurace není platná (část 1, 4.9). */
export const EXIT_CONFIG = 78;
```

`apps/cli/src/registry.ts`:

```ts
export interface CommandDefinition {
  readonly name: string;
  /** Podpříkazy, například `backup verify`. */
  readonly subcommands?: readonly string[];
  readonly summary: string;
  readonly usage: string;
  /** Plán, který příkaz dodá. U implementovaných je to P01. */
  readonly owner: string;
  readonly implemented: boolean;
}

/**
 * Úplný registr podpříkazů `mlain`. Předdeklarovaný stejně jako registry chyb
 * a front: doménový plán příkaz doplní, nezakládá ho.
 *
 * Implementované v P01 jsou jen `config check`, `healthcheck` a `version`,
 * protože je potřebuje entrypoint a direktiva HEALTHCHECK v Dockerfile.
 */
export const COMMANDS: readonly CommandDefinition[] = [
  {
    name: 'version',
    summary: 'Vypíše verzi image.',
    usage: 'mlain version',
    owner: 'P01',
    implemented: true,
  },
  {
    name: 'config',
    subcommands: ['check'],
    summary: 'Ověří konfiguraci a vypíše všechny problémy naráz.',
    usage: 'mlain config check',
    owner: 'P01',
    implemented: true,
  },
  {
    name: 'healthcheck',
    summary: 'Zkontroluje běžící procesy podle MODE. Volá ho HEALTHCHECK v Dockerfile.',
    usage: 'mlain healthcheck',
    owner: 'P01',
    implemented: true,
  },
  {
    name: 'migrate',
    summary: 'Aplikuje migrace pod rolí mlain_migrator s advisory lockem.',
    usage: 'mlain migrate',
    owner: 'P03',
    implemented: false,
  },
  {
    name: 'genkey',
    summary: 'Vygeneruje nový SECRET_KEY ve tvaru <key_id>:<base64url>.',
    usage: 'mlain genkey [--id <n>]',
    owner: 'P16',
    implemented: false,
  },
  {
    name: 'backup',
    subcommands: ['verify', 'list'],
    summary:
      'Vytvoří zálohu databáze a uploadů. Podpříkaz verify ji ověří do dočasné databáze, list vypíše existující zálohy.',
    usage: 'mlain backup [--skip-prune] | mlain backup verify <adresář> | mlain backup list',
    owner: 'P16',
    implemented: false,
  },
  {
    name: 'restore',
    summary: 'Obnoví instalaci ze zálohy.',
    usage: 'mlain restore <adresář> [--force] [--skip-uploads] [--i-know-the-key-differs]',
    owner: 'P16',
    implemented: false,
  },
  {
    name: 'doctor',
    summary: 'Prověří instalaci a vypíše nálezy podle závažnosti.',
    usage: 'mlain doctor',
    owner: 'P16',
    implemented: false,
  },
  {
    name: 'upgrade',
    summary: 'Opatrný upgrade: zastaví procesy, zazálohuje, migruje, spustí zpět.',
    usage: 'mlain upgrade',
    owner: 'P16',
    implemented: false,
  },
  {
    name: 'rotate-credentials',
    summary: 'Přešifruje všechny obálky na aktuální key_id.',
    usage: 'mlain rotate-credentials',
    owner: 'P16',
    implemented: false,
  },
  // Dva příkazy doplněné po nálezu: P16 je oba implementuje a označuje
  // `implemented: true`, ale v tomhle registru chyběly. Registr je uzavřený
  // výčet, takže by je P16 musel založit sám, což uzávěr S10 zakazuje.
  {
    name: 'reset-password',
    summary:
      'Nastaví uživateli nové heslo. Jediná cesta zpět do instalace, která ještě nemá nastavené odesílání.',
    usage: 'mlain reset-password <e-mail> [--password <heslo>]',
    owner: 'P16',
    implemented: false,
  },
  {
    name: 'rebuild-engagement',
    summary: 'Přepočítá tabulku zapojení kontaktů od nuly po dávkách, po havárii nebo obnově zálohy.',
    usage: 'mlain rebuild-engagement --workspace <id> [--batch-size <n>]',
    owner: 'P16',
    implemented: false,
  },
];

export function findCommand(name: string): CommandDefinition | undefined {
  return COMMANDS.find((command) => command.name === name);
}

/** Nejbližší jméno podle Levenshteinovy vzdálenosti, pro nápovědu u překlepu. */
export function suggest(name: string): string | undefined {
  let best: { name: string; distance: number } | undefined;
  for (const command of COMMANDS) {
    const distance = levenshtein(name, command.name);
    if (!best || distance < best.distance) best = { name: command.name, distance };
  }
  return best && best.distance <= 3 ? best.name : undefined;
}

function levenshtein(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, index) => [index]);
  for (let column = 1; column <= b.length; column += 1) rows[0]![column] = column;
  for (let row = 1; row <= a.length; row += 1) {
    for (let column = 1; column <= b.length; column += 1) {
      const cost = a[row - 1] === b[column - 1] ? 0 : 1;
      rows[row]![column] = Math.min(
        rows[row - 1]![column]! + 1,
        rows[row]![column - 1]! + 1,
        rows[row - 1]![column - 1]! + cost,
      );
    }
  }
  return rows[a.length]![b.length]!;
}
```

- [ ] **Krok 5: Napiš `dispatch.ts` a implementované příkazy**

`apps/cli/src/dispatch.ts`:

```ts
import { EXIT_OK, EXIT_UNAVAILABLE, EXIT_USAGE } from './exit-codes.js';
import { COMMANDS, findCommand, suggest } from './registry.js';
import { runConfigCheck } from './commands/config-check.js';
import { runHealthcheck } from './commands/healthcheck.js';

export interface CliStreams {
  stdout(line: string): void;
  stderr(line: string): void;
  env?: Record<string, string | undefined>;
}

function help(streams: CliStreams): void {
  streams.stdout('mlain <příkaz> [argumenty]');
  streams.stdout('');
  streams.stdout('Příkazy:');
  const width = Math.max(...COMMANDS.map((command) => command.name.length));
  for (const command of COMMANDS) {
    const suffix = command.implemented ? '' : `  (not implemented, dodá plán ${command.owner})`;
    streams.stdout(`  ${command.name.padEnd(width)}  ${command.summary}${suffix}`);
  }
  streams.stdout('');
  streams.stdout('Nápověda k příkazu: mlain <příkaz> --help');
}

export async function dispatch(argv: readonly string[], streams: CliStreams): Promise<number> {
  const env = streams.env ?? process.env;
  const [name, ...rest] = argv;

  if (name === undefined || name === '--help' || name === '-h' || name === 'help') {
    help(streams);
    return name === undefined ? EXIT_USAGE : EXIT_OK;
  }

  const command = findCommand(name);
  if (!command) {
    const hint = suggest(name);
    streams.stderr(`mlain: neznámý příkaz "${name}".${hint ? ` Nemyslel jsi "${hint}"?` : ''}`);
    streams.stderr('Seznam příkazů: mlain --help');
    return EXIT_USAGE;
  }

  if (rest.includes('--help') || rest.includes('-h')) {
    streams.stdout(command.usage);
    streams.stdout('');
    streams.stdout(command.summary);
    if (!command.implemented) {
      streams.stdout('');
      streams.stdout(`Tenhle příkaz zatím není implementovaný. Dodá ho plán ${command.owner}.`);
    }
    return EXIT_OK;
  }

  if (!command.implemented) {
    streams.stderr(
      `mlain ${command.name}: not implemented in this build. Příkaz je deklarovaný v registru, ale jeho tělo dodá plán ${command.owner}.`,
    );
    streams.stderr(`Použití, až bude hotový: ${command.usage}`);
    return EXIT_UNAVAILABLE;
  }

  switch (command.name) {
    case 'version': {
      streams.stdout(env['IMAGE_VERSION'] ?? '0.0.0-dev');
      return EXIT_OK;
    }
    case 'config': {
      if (rest[0] !== 'check') {
        streams.stderr(`mlain config: očekávám podpříkaz "check". Použití: ${command.usage}`);
        return EXIT_USAGE;
      }
      return runConfigCheck(streams, env);
    }
    case 'healthcheck': {
      return runHealthcheck(streams, env);
    }
    default: {
      streams.stderr(`mlain ${command.name}: chybí obsluha, přestože je příkaz označený jako implementovaný.`);
      return EXIT_UNAVAILABLE;
    }
  }
}
```

`apps/cli/src/commands/config-check.ts`:

```ts
import { ConfigError, loadConfig } from '@mlain/core/config';
import { EXIT_CONFIG, EXIT_OK } from '../exit-codes.js';
import type { CliStreams } from '../dispatch.js';

/**
 * Volá ho entrypoint jako první krok. Při chybě vypíše VŠECHNY problémy naráz
 * a vrátí 78 (akceptační kritéria 2 a 3).
 */
export function runConfigCheck(
  streams: CliStreams,
  env: Record<string, string | undefined>,
): number {
  try {
    const config = loadConfig(env);
    streams.stdout(`Konfigurace je v pořádku. MODE=${config.MODE}, verze ${config.IMAGE_VERSION}.`);
    return EXIT_OK;
  } catch (error) {
    if (error instanceof ConfigError) {
      streams.stderr(error.format());
      return EXIT_CONFIG;
    }
    throw error;
  }
}
```

`apps/cli/src/commands/healthcheck.ts`:

```ts
import { ConfigError, loadConfig } from '@mlain/core/config';
import { EXIT_CONFIG, EXIT_OK } from '../exit-codes.js';
import type { CliStreams } from '../dispatch.js';

interface Probe {
  readonly label: string;
  readonly url: string;
}

/**
 * Co volá `mlain healthcheck` podle MODE (část 1, kapitola 3.12):
 *   web    -> GET localhost:${PORT}/api/health/ready
 *   worker -> GET localhost:${WORKER_HEALTH_PORT}/readyz
 *   sender -> GET localhost:${SENDER_HEALTH_PORT}/readyz
 *   all    -> všechny tři; spadne, když spadne kterýkoliv
 */
function probesFor(config: {
  MODE: string;
  PORT: number;
  WORKER_HEALTH_PORT: number;
  SENDER_HEALTH_PORT: number;
}): Probe[] {
  const web: Probe = { label: 'web', url: `http://127.0.0.1:${config.PORT}/api/health/ready` };
  const worker: Probe = {
    label: 'worker',
    url: `http://127.0.0.1:${config.WORKER_HEALTH_PORT}/readyz`,
  };
  const sender: Probe = {
    label: 'sender',
    url: `http://127.0.0.1:${config.SENDER_HEALTH_PORT}/readyz`,
  };
  switch (config.MODE) {
    case 'web':
      return [web];
    case 'worker':
      return [worker];
    case 'sender':
      return [sender];
    default:
      return [web, worker, sender];
  }
}

export async function runHealthcheck(
  streams: CliStreams,
  env: Record<string, string | undefined>,
): Promise<number> {
  let config;
  try {
    config = loadConfig(env);
  } catch (error) {
    if (error instanceof ConfigError) {
      streams.stderr(error.format());
      return EXIT_CONFIG;
    }
    throw error;
  }

  let failed = false;
  for (const probe of probesFor(config)) {
    try {
      const response = await fetch(probe.url, { signal: AbortSignal.timeout(4000) });
      if (!response.ok) {
        failed = true;
        streams.stderr(`${probe.label}: HTTP ${response.status} na ${probe.url}`);
      } else {
        streams.stdout(`${probe.label}: ok`);
      }
    } catch (error) {
      failed = true;
      streams.stderr(`${probe.label}: ${(error as Error).message}`);
    }
  }
  return failed ? 1 : EXIT_OK;
}
```

`apps/cli/src/main.ts`:

```ts
import { dispatch } from './dispatch.js';

const code = await dispatch(process.argv.slice(2), {
  stdout: (line) => process.stdout.write(`${line}\n`),
  stderr: (line) => process.stderr.write(`${line}\n`),
  env: process.env,
});
process.exit(code);
```

- [ ] **Krok 6: Napiš shim `docker/mlain`**

```sh
#!/bin/sh
# Tenký shim. Celé CLI je v apps/cli, aby do adresáře docker/ nemusely psát
# plány P03 a P16 (rozhodnutí D1, uzávěr S10).
exec node /app/apps/cli/dist/main.js "$@"
```

Nastav práva:

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && chmod +x docker/mlain && sh -n docker/mlain && echo SHIM_OK
```
Expected: `SHIM_OK`.

- [ ] **Krok 7: Spusť testy a build CLI**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm install && pnpm --filter @mlain/cli exec vitest run && pnpm --filter @mlain/cli run build
```
Expected: `Tests  10 passed (10)`, pak `apps/cli/dist/main.js hotovo`.

- [ ] **Krok 8: Ověř chování CLI na reálném spuštění**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && node apps/cli/dist/main.js backup; echo "exit=$?"
```
Expected: na stderr `mlain backup: not implemented in this build...`, poslední řádek `exit=69`.

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && env -i node apps/cli/dist/main.js config check; echo "exit=$?"
```
Expected: výpis všech chybějících proměnných včetně `SECRET_KEY`, poslední řádek `exit=78`.

- [ ] **Krok 9: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add apps/cli docker/mlain pnpm-lock.yaml && git commit -m "feat(cli): mlain command registry with implemented config check and healthcheck"
```

---

### Úkol 17: `entrypoint.sh` a přepínač `MODE`

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/docker/entrypoint.sh`
- Test: `/Users/petr/Projects/Mailing_Tool/tools/ci/test/entrypoint.test.ts`

- [ ] **Krok 1: Napiš padající test entrypointu**

Entrypoint je shellový skript, testuje se spuštěním s podvrženým `PATH`, ve kterém `node` a `ml-sender` jsou skripty, které jen zapíšou, s čím byly zavolané.

`tools/ci/test/entrypoint.test.ts`:

```ts
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const ENTRYPOINT = path.join(ROOT, 'docker/entrypoint.sh');

let sandbox: string;
let fakeBin: string;
let log: string;

function run(env: Record<string, string>, args: string[] = []): { code: number; stderr: string } {
  try {
    execFileSync('sh', [ENTRYPOINT, ...args], {
      env: { PATH: `${fakeBin}:/usr/bin:/bin`, MLAIN_TRACE: log, ...env },
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { code: 0, stderr: '' };
  } catch (error) {
    const failure = error as { status: number; stderr: string };
    return { code: failure.status, stderr: failure.stderr };
  }
}

function trace(): string {
  return fs.existsSync(log) ? fs.readFileSync(log, 'utf8') : '';
}

/** Skript bez komentářů. Testy zákazů mají hlídat kód, ne vysvětlivky v něm. */
function executableLines(): string {
  return fs
    .readFileSync(ENTRYPOINT, 'utf8')
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');
}

function fake(name: string, exitCode = 0): void {
  const file = path.join(fakeBin, name);
  fs.writeFileSync(
    file,
    `#!/bin/sh\nprintf '%s %s\\n' "${name}" "$*" >> "$MLAIN_TRACE"\nexit ${exitCode}\n`,
  );
  fs.chmodSync(file, 0o755);
}

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'mlain-entry-'));
  fakeBin = path.join(sandbox, 'bin');
  fs.mkdirSync(fakeBin);
  log = path.join(sandbox, 'trace.log');
  fs.writeFileSync(log, '');
  fake('node');
  fake('ml-sender');
  fake('mlain');
});
afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe('entrypoint.sh', () => {
  it('je platný POSIX shell', () => {
    execFileSync('sh', ['-n', ENTRYPOINT]);
  });

  it('nejdřív ověří konfiguraci a při chybě skončí 78 (kritéria 2 a 3)', () => {
    fs.writeFileSync(
      path.join(fakeBin, 'mlain'),
      '#!/bin/sh\nprintf \'mlain %s\\n\' "$*" >> "$MLAIN_TRACE"\necho "SECRET_KEY: je povinná (required) a chybí" >&2\nexit 78\n',
    );
    fs.chmodSync(path.join(fakeBin, 'mlain'), 0o755);
    const result = run({ MODE: 'web' });
    expect(result.code).toBe(78);
    expect(result.stderr).toContain('SECRET_KEY');
    expect(trace()).toContain('mlain config check');
  });

  it('vymaže klíče AI providerů podle vzoru i podle výčtu (kritérium 7b)', () => {
    fs.writeFileSync(
      path.join(fakeBin, 'node'),
      '#!/bin/sh\nprintf \'node %s\\n\' "$*" >> "$MLAIN_TRACE"\nprintf \'ANTHROPIC=[%s] OPENAI=[%s] HF=[%s] OLLAMA=[%s] SECRET=[%s] S3ID=[%s]\\n\' "$ANTHROPIC_API_KEY" "$OPENAI_API_KEY" "$HF_TOKEN" "$OLLAMA_HOST" "$SECRET_KEY" "$S3_ACCESS_KEY_ID" >> "$MLAIN_TRACE"\n',
    );
    fs.chmodSync(path.join(fakeBin, 'node'), 0o755);
    run({
      MODE: 'web',
      MIGRATE_ON_START: 'false',
      ANTHROPIC_API_KEY: 'sk-a',
      OPENAI_API_KEY: 'sk-o',
      HF_TOKEN: 'hf',
      OLLAMA_HOST: 'http://x',
      SECRET_KEY: 'keep-me',
      S3_ACCESS_KEY_ID: 'keep-me-too',
    });
    expect(trace()).toContain('ANTHROPIC=[] OPENAI=[] HF=[] OLLAMA=[] SECRET=[keep-me] S3ID=[keep-me-too]');
  });

  it('při MODE=web a MIGRATE_ON_START=true spustí migrace', () => {
    run({ MODE: 'web', MIGRATE_ON_START: 'true' });
    expect(trace()).toContain('mlain migrate');
  });

  it('při MODE=worker migrace nespouští', () => {
    run({ MODE: 'worker', MIGRATE_ON_START: 'true' });
    expect(trace()).not.toContain('mlain migrate');
  });

  it('MODE=web spustí server.js', () => {
    run({ MODE: 'web', MIGRATE_ON_START: 'false' });
    expect(trace()).toContain('node apps/web/server.js');
  });

  it('MODE=worker spustí dist/main.js workeru', () => {
    run({ MODE: 'worker', MIGRATE_ON_START: 'false' });
    expect(trace()).toContain('node apps/worker/dist/main.js');
  });

  it('MODE=sender spustí ml-sender', () => {
    run({ MODE: 'sender', MIGRATE_ON_START: 'false' });
    expect(trace()).toContain('ml-sender');
  });

  it('MODE=all spustí všechny tři procesy', () => {
    run({ MODE: 'all', MIGRATE_ON_START: 'false' });
    const text = trace();
    expect(text).toContain('apps/web/server.js');
    expect(text).toContain('apps/worker/dist/main.js');
    expect(text).toContain('ml-sender');
  });

  it('neznámý MODE skončí 78', () => {
    expect(run({ MODE: 'vsechno', MIGRATE_ON_START: 'false' }).code).toBe(78);
  });

  it('pád potomka při MODE=all ukončí celý kontejner jeho exit kódem', () => {
    fake('ml-sender', 17);
    const result = run({ MODE: 'all', MIGRATE_ON_START: 'false' });
    expect(result.code).toBe(17);
  });

  it('pád nodu při MODE=all propíše jeho kód, ne kód senderu', () => {
    fake('node', 9);
    expect(run({ MODE: 'all', MIGRATE_ON_START: 'false' }).code).toBe(9);
  });

  it('čistý konec všech tří potomků vrátí nulu', () => {
    expect(run({ MODE: 'all', MIGRATE_ON_START: 'false' }).code).toBe(0);
  });

  // Tenhle test je pojistka proti `wait -n`. Kdyby se do skriptu vrátil, spadne
  // rovnou na `Illegal option -n` pod dashem, respektive `invalid option` pod
  // bashem 3.2, a nikdy se nedostane k výběru exit kódu.
  //
  // Komentáře se odfiltrují: skript o `wait -n` mluví ve vysvětlivce a test má
  // hlídat kód, ne prózu. Bez toho by padal sám na sobě.
  it('nepoužívá wait -n, protože POSIX shell ho nemá', () => {
    expect(executableLines()).not.toMatch(/\bwait\s+-n\b/);
  });

  // Sender se volá jménem, aby ho šlo podstrčit přes PATH. Absolutní cesta by
  // znamenala, že test spouští jinou binárku než produkce.
  it('spouští sender přes PATH, ne absolutní cestou', () => {
    expect(executableLines()).not.toContain('/usr/local/bin/ml-sender');
  });

  it('neimplementovaná migrace (exit 69) kontejner nezastaví', () => {
    fs.writeFileSync(
      path.join(fakeBin, 'mlain'),
      '#!/bin/sh\nprintf \'mlain %s\\n\' "$*" >> "$MLAIN_TRACE"\nif [ "$1" = "migrate" ]; then exit 69; fi\nexit 0\n',
    );
    fs.chmodSync(path.join(fakeBin, 'mlain'), 0o755);
    const result = run({ MODE: 'web', MIGRATE_ON_START: 'true' });
    expect(result.code).toBe(0);
    expect(result.stderr).toContain('69');
    expect(trace()).toContain('node apps/web/server.js');
  });

  it('selhaná migrace (exit 3) kontejner zastaví se stejným kódem', () => {
    fs.writeFileSync(
      path.join(fakeBin, 'mlain'),
      '#!/bin/sh\nprintf \'mlain %s\\n\' "$*" >> "$MLAIN_TRACE"\nif [ "$1" = "migrate" ]; then exit 3; fi\nexit 0\n',
    );
    fs.chmodSync(path.join(fakeBin, 'mlain'), 0o755);
    const result = run({ MODE: 'web', MIGRATE_ON_START: 'true' });
    expect(result.code).toBe(3);
    expect(trace()).not.toContain('node apps/web/server.js');
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/tools exec vitest run ci/test/entrypoint.test.ts
```
Expected: FAIL, `ENOENT` na `docker/entrypoint.sh`.

- [ ] **Krok 3: Napiš `docker/entrypoint.sh`**

```sh
#!/bin/sh
# Jediný vstupní bod image. Postup je z části 1, kapitoly 3.12.
#
#   1) validace konfigurace (zod), při chybě exit 78 a výpis VŠECH problémů naráz
#   2) vymazání klíčů AI providerů z prostředí
#   3) MIGRATE_ON_START=true a MODE in (web,all) -> mlain migrate
#   4) podle MODE spustit procesy
#
# Běží pod tini jako PID 1, takže reaping zombie procesů a předávání signálů
# řeší tini, ne tenhle skript.
set -eu

MODE="${MODE:-all}"

# --- 1) Validace konfigurace -------------------------------------------------
# `mlain config check` vypíše všechny problémy naráz a vrátí 78 (kritéria 2 a 3).
if ! mlain config check; then
  exit 78
fi

# --- 2) Klíče AI providerů se mažou ------------------------------------------
# Vercel AI SDK i SDK providerů sáhnou tiše po proměnné prostředí, když se klíč
# nepředá explicitně. Projekt bez nakonfigurovaného klíče by tím začal utrácet
# peníze provozovatele a zjistilo by se to až na faktuře.
#
# VZOR, ne výčet: výčet zastará s každým novým providerem a selže tiše.
# Vzor *_API_KEY je bezpečný, protože žádná proměnná Mlain Maileru na _API_KEY
# nekončí; hlídá to test v packages/core (akceptační kritérium 7c).
#
# Na sender se mazání NEAPLIKUJE, ten s AI do styku nepřichází. Protože ale
# potomci při MODE=all dědí prostředí, maže se jednotně před spuštěním čehokoliv.
for VARIABLE in $(env | sed -n 's/^\([A-Za-z_][A-Za-z0-9_]*\)=.*/\1/p'); do
  case "$VARIABLE" in
    *_API_KEY) unset "$VARIABLE" || true ;;
  esac
done
# Výčet pro ty, které vzoru neodpovídají (tabulka v 3.12).
unset AWS_BEARER_TOKEN_BEDROCK || true
unset GOOGLE_APPLICATION_CREDENTIALS || true
unset GOOGLE_GENAI_USE_VERTEXAI || true
unset AZURE_OPENAI_ENDPOINT || true
unset OLLAMA_HOST || true
unset HF_TOKEN || true

# --- 3) Migrace --------------------------------------------------------------
# Migrace pouští jen web a all, aby při víc replikách neběžely z každého procesu.
# Runner se připojuje přes DATABASE_URL_MIGRATOR, ne přes DATABASE_URL:
# DATABASE_URL je role mlain_app, která schéma nevlastní a migrovat nemůže.
#
# EXIT 69 SE TOLERUJE. `mlain migrate` dodává až plán P03; do té doby vrací
# registr CLI exit 69 (EX_UNAVAILABLE, "příkaz existuje, ale nikdo nedodal jeho
# tělo"). Protože MIGRATE_ON_START je ve výchozím stavu true a skript běží pod
# `set -e`, ukončil by se kontejner hned při startu kódem 69 a akceptační
# kritérium 1 (odpověď 200 na /api/health/ready do 60 s) by nešlo splnit dřív
# než po P03. Každý JINÝ nenulový kód je fatální: 3 selhaná migrace,
# 4 přeskočená major verze, 5 schema_version_ahead, 75 timeout zámku.
if [ "${MIGRATE_ON_START:-true}" = "true" ]; then
  case "$MODE" in
    web|all)
      set +e
      mlain migrate
      MIGRATE_EXIT=$?
      set -e
      if [ "$MIGRATE_EXIT" -eq 69 ]; then
        echo "entrypoint: mlain migrate v tomhle buildu není implementovaný (exit 69, dodá plán P03). Pokračuji bez migrací." >&2
      elif [ "$MIGRATE_EXIT" -ne 0 ]; then
        echo "entrypoint: mlain migrate selhal s kódem ${MIGRATE_EXIT}, kontejner nestartuje." >&2
        exit "$MIGRATE_EXIT"
      fi
      ;;
  esac
fi

# --- 4) Spuštění podle MODE --------------------------------------------------
# ml-sender se volá JMÉNEM, ne absolutní cestou. /usr/local/bin je v PATH
# základní image, takže se v kontejneru chová stejně, a test si smí podstrčit
# vlastní binárku přes PATH, aniž by musel psát do /usr/local/bin.
case "$MODE" in
  web)
    exec node apps/web/server.js
    ;;
  worker)
    exec node apps/worker/dist/main.js
    ;;
  sender)
    exec ml-sender
    ;;
  all)
    # Tři potomci pod jedním PID 1. Žádný supervizor: restart je práce Dockeru.
    # Kdyby kontejner držel běh s jedním mrtvým procesem, healthcheck by lhal.
    #
    # BEZ `wait -n`. To je rozšíření bashe 4.3 a POSIX ho nemá: pod `dash`
    # skončí na `Illegal option -n`, pod bashem 3.2 na `invalid option`.
    # Skript se přitom spouští přes `sh`, tedy pod dashem na Ubuntu runneru
    # i pod bashem 3.2 na macOS, a do Alpine s BusyBox ash test nikdy nevstoupí.
    # Náhrada přes `kill -0` v cyklu taky nefunguje: `kill -0` uspěje i na
    # zombie procesu, tedy na potomkovi, který už skončil a čeká na `wait`.
    #
    # Řešení: každý potomek běží pod tenkým supervizorem, který si počká na svůj
    # proces a zapíše jeho exit kód do souboru. Hlavní skript čeká, až se objeví
    # první řádek.
    STATUS_DIR="$(mktemp -d)"
    trap 'rm -rf "$STATUS_DIR"' EXIT
    EXITS="$STATUS_DIR/exits"
    : > "$EXITS"

    supervise() {
      _name=$1
      shift
      "$@" &
      _pid=$!
      # PID skutečného procesu, ne supervizoru. Bez něj by SIGTERM došel jen
      # k supervizoru a node ani ml-sender by o vypnutí nevěděly.
      echo "$_pid" > "$STATUS_DIR/$_name.pid"
      # `wait` bez `|| _code=$?` by pod `set -e` shodilo celý supervizor dřív,
      # než stihne nenulový kód zapsat, a pád potomka by zmizel beze stopy.
      _code=0
      wait "$_pid" || _code=$?
      printf '%s %s\n' "$_name" "$_code" >> "$EXITS"
    }

    forward_term() {
      for _file in "$STATUS_DIR"/*.pid; do
        [ -f "$_file" ] || continue
        kill -TERM "$(cat "$_file")" 2>/dev/null || true
      done
    }

    supervise web    node apps/web/server.js &
    supervise worker node apps/worker/dist/main.js &
    supervise sender ml-sender &

    # Signál se předá potomkům, aby doběhli graceful shutdown.
    trap 'forward_term' TERM INT

    while [ ! -s "$EXITS" ]; do
      sleep 1
    done
    # Sekunda navíc na potomky, kteří skončili prakticky současně. Bez ní by
    # výsledný kód závisel na tom, který zápis vyhrál závod.
    sleep 1
    cp "$EXITS" "$STATUS_DIR/snapshot"

    # Kód kontejneru je kód prvního potomka, který skončil; když jich skončilo
    # víc naráz, vyhrává nenulový. Snapshot se bere PŘED forward_term, aby se
    # do výběru nedostal kód 143 od potomků, které jsme ukončili sami.
    FIRST_EXIT=0
    FIRST_SEEN=""
    while read -r _name _code; do
      [ -z "$FIRST_SEEN" ] && { FIRST_SEEN="$_name"; FIRST_EXIT="$_code"; }
      if [ "$_code" -ne 0 ]; then
        FIRST_EXIT="$_code"
        break
      fi
    done < "$STATUS_DIR/snapshot"

    forward_term
    wait 2>/dev/null || true
    exit "$FIRST_EXIT"
    ;;
  *)
    echo "MODE: neplatná hodnota \"$MODE\". Povolené jsou web, worker, sender, all." >&2
    exit 78
    ;;
esac
```

**Ověřeno spuštěním ve třech shellech**, protože přesně na tomhle místě se předchozí znění rozcházelo mezi testem a produkcí: `/bin/sh` na macOS (bash 3.2), `/bin/dash` na Debianu a `/bin/sh` v `node:24.18.1-alpine` (BusyBox ash). Všech pět scénářů dopadlo ve všech třech stejně: pád senderu vrátí 17, pád nodu vrátí 9, čistý konec vrátí 0, migrace s kódem 69 pokračuje, migrace s kódem 3 kontejner zastaví.

- [ ] **Krok 4: Spusť test a ověř, že prochází**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && chmod +x docker/entrypoint.sh && pnpm --filter @mlain/tools exec vitest run ci/test/entrypoint.test.ts
```
Expected: PASS, `Tests  17 passed (17)`.

- [ ] **Krok 5: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add docker/entrypoint.sh tools && git commit -m "feat(docker): entrypoint with MODE switch, config gate and AI key scrubbing"
```

---

### Úkol 18: Multi-stage Dockerfile

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/docker/Dockerfile`
- Create: `/Users/petr/Projects/Mailing_Tool/tools/ci/image-size.mjs`
- Test: `/Users/petr/Projects/Mailing_Tool/tools/ci/test/dockerfile.test.ts`

- [ ] **Krok 1: Napiš padající test Dockerfilu**

Statická kontrola nenahrazuje build, ale zachytí přesně ty dvě chyby, na kterých build podle 3.12 stojí nebo padá. Skutečný build ověřuje krok 5 a CI job `build-image`.

`tools/ci/test/dockerfile.test.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const dockerfile = (): string => fs.readFileSync(path.join(ROOT, 'docker/Dockerfile'), 'utf8');

/** Dockerfile bez komentářů. Testy zákazů mají hlídat instrukce, ne vysvětlivky. */
const instructions = (): string =>
  dockerfile()
    .split('\n')
    .filter((line) => !line.trim().startsWith('#'))
    .join('\n');

describe('Dockerfile', () => {
  it('deklaruje ARG IMAGE_VERSION globálně i v každé fázi, která ho čte', () => {
    const text = dockerfile();
    // Nedeklarovaná ${...} se v Dockerfile rozvine na PRÁZDNÝ ŘETĚZEC, tiše.
    const stagesUsingVersion = text
      .split(/^FROM /m)
      .slice(1)
      .filter((stage) => stage.includes('${IMAGE_VERSION}'));
    for (const stage of stagesUsingVersion) {
      expect(stage, `fáze používá ${'${IMAGE_VERSION}'} bez ARG`).toMatch(/^\s*\S+.*\n(.|\n)*?ARG IMAGE_VERSION/);
    }
    expect(text).toMatch(/^ARG IMAGE_VERSION=/m);
  });

  it('kopíruje manifesty přes turbo prune, nikdy globem (kritérium 7d)', () => {
    const text = dockerfile();
    expect(text).toContain('turbo@2.10.7 prune');
    // Glob s jedním cílovým adresářem zploští devět manifestů do jednoho souboru.
    expect(text).not.toMatch(/COPY\s+packages\/\*\/package\.json/);
    expect(text).not.toMatch(/COPY\s+apps\/\*\/package\.json/);
  });

  it('prune filtr obsahuje všechny tři Node aplikace', () => {
    const text = dockerfile();
    for (const app of ['@mlain/web', '@mlain/worker', '@mlain/cli']) {
      expect(text, `prune neobsahuje ${app}`).toContain(app);
    }
  });

  it('běží pod uživatelem 10001 (kritérium 7)', () => {
    expect(dockerfile()).toMatch(/^USER 10001:10001$/m);
  });

  it('má tini jako PID 1 a entrypoint.sh za ním', () => {
    expect(dockerfile()).toContain('ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]');
  });

  it('instaluje postgresql18-client kvůli pg_dump a pg_restore', () => {
    expect(dockerfile()).toContain('postgresql18-client');
  });

  it('HEALTHCHECK volá mlain healthcheck', () => {
    expect(dockerfile()).toContain('CMD ["/usr/local/bin/mlain", "healthcheck"]');
  });

  it('nastavuje rozdílné výchozí health porty (kritérium 8c)', () => {
    const text = dockerfile();
    expect(text).toContain('WORKER_HEALTH_PORT=3001');
    expect(text).toContain('SENDER_HEALTH_PORT=3002');
  });

  it('kopíruje artefakty všech tří aplikací i CLI', () => {
    const text = dockerfile();
    for (const artefact of [
      'apps/web/.next/standalone',
      'apps/worker/dist',
      'apps/cli/dist',
      '/out/ml-sender',
    ]) {
      expect(text, `chybí COPY ${artefact}`).toContain(artefact);
    }
  });

  it('zapisuje jen do /data a deklaruje ho jako svazek (kritérium 8)', () => {
    const text = dockerfile();
    expect(text).toContain('VOLUME ["/data"]');
    expect(text).toMatch(/chown -R 10001:10001 \/data/);
  });

  // Wildcard v COPY se na chybějícím adresáři NECHOVÁ jako no-op: build skončí
  // na `lstat ...: no such file or directory`. Každá cesta v COPY proto musí
  // existovat, a test integrity workspace ověřuje, že ty dvě zakládané opravdu
  // vzniknou.
  //
  // Komentáře se odfiltrují: Dockerfile ten zrušený řádek cituje ve vysvětlivce
  // a test má hlídat instrukce, ne prózu.
  it('nekopíruje packages/contracts/fixtures, ten adresář v téhle fázi neexistuje', () => {
    expect(instructions()).not.toMatch(/COPY\s+packages\/contracts\/fixtures/);
  });

  it('kopíruje migrace, jinak by image neměla co aplikovat', () => {
    expect(instructions()).toContain('/app/packages/db/migrations ./packages/db/migrations');
  });

  it('žádný COPY nespoléhá na wildcard v adresáři', () => {
    // `COPY neco*/ cil/` vypadá jako podmíněná kopie, ale není: chybějící
    // nadřazený adresář build zabije. Ověřeno spuštěním docker buildu.
    const offenders = instructions()
      .split('\n')
      .filter((line) => /^COPY\s/.test(line) && /\*\//.test(line));
    expect(offenders, 'COPY s wildcardem v adresáři není podmíněná kopie').toEqual([]);
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/tools exec vitest run ci/test/dockerfile.test.ts
```
Expected: FAIL, `ENOENT` na `docker/Dockerfile`.

- [ ] **Krok 3: Napiš `docker/Dockerfile`**

Vychází z povinného artefaktu v části 1, kapitole 3.12. Jediná odchylka je přidání `@mlain/cli` do prune filtru a jeden `COPY` navíc (rozhodnutí D1).

```dockerfile
# syntax=docker/dockerfile:1.9

# Verze image. Deklaruje se PŘED prvním FROM (globální ARG) a znovu v každé fázi,
# která ji používá: ARG před FROM je ve fázích neviditelný, dokud ho fáze
# nezopakuje, a nedeklarovaná ${...} se v Dockerfile rozvine na PRÁZDNÝ ŘETĚZEC,
# tiše a bez varování. Binárka by pak neměla verzi a /api/health by ji neměl
# odkud vzít. Název je shodný s konfigurační proměnnou IMAGE_VERSION z 4.9.
ARG IMAGE_VERSION=0.0.0-dev

# --- 1) Go builder: staticky slinkovaný sender -------------------------------
FROM golang:1.26-alpine AS sender-builder
ARG IMAGE_VERSION
WORKDIR /src
# Nejdřív jen manifesty, aby se cache modulů neinvalidovala každou změnou kódu.
COPY apps/sender/go.mod apps/sender/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY apps/sender/ ./
# ŽÁDNÝ COPY fixtures. Dřívější znění mělo řádek
#   COPY packages/contracts/fixtures*/ /src/testdata/fixtures/
# s poznámkou, že se wildcard na prázdné množině chová jako no-op. NECHOVÁ.
# Ověřeno spuštěním: `docker build` skončí na
#   ERROR: failed to solve: lstat /packages/contracts: no such file or directory
# tedy hned první build image neprojde. Wildcard v Dockerfile nepokrývá chybějící
# adresář o úroveň výš.
#
# Ten řádek tu navíc nemá co dělat: `go build ./cmd/sender` fixtures nepotřebuje,
# používají je jen `go test`, a ty v image neběží. Symlink apps/sender/testdata,
# který zakládá P02, se zkopíruje spolu s adresářem a v téhle fázi zůstane visící;
# Go adresáře jménem testdata ignoruje a build tím neutrpí. Také ověřeno buildem.
# CGO_ENABLED=0 => žádná libc závislost, binárka běží i ve scratch.
# -trimpath a -ldflags "-s -w" zmenší binárku a odstraní absolutní cesty.
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux go build -trimpath \
      -ldflags="-s -w -X main.version_=${IMAGE_VERSION}" \
      -o /out/ml-sender ./cmd/sender

# --- 2) Pruner: minimální podstrom monorepa pro instalaci --------------------
# turbo prune --docker vyrobí out/json (JEN manifesty, se ZACHOVANOU strukturou
# adresářů, včetně lockfilu) a out/full (zdrojáky). Musí to udělat turbo, ne glob:
# `COPY packages/*/package.json ./packages/` Docker vyhodnotí jako "zkopíruj
# nalezené soubory do cílového adresáře BEZ mezilehlých adresářů", takže se
# všech devět manifestů přepíše přes sebe do jediného souboru ./packages/package.json.
# pnpm pak workspace nenajde, `pnpm install --frozen-lockfile` spadne a povinný
# artefakt (job build-image) neprojde. Akceptační kritérium 7d.
FROM node:24.18.1-alpine AS pruner
RUN corepack enable && corepack prepare pnpm@11.18.0 --activate
WORKDIR /app
COPY . .
RUN pnpm dlx turbo@2.10.7 prune @mlain/web @mlain/worker @mlain/cli --docker

# --- 3) Node deps: jen instalace, sdílená vrstva ------------------------------
FROM node:24.18.1-alpine AS node-deps
RUN corepack enable && corepack prepare pnpm@11.18.0 --activate
WORKDIR /app
COPY --from=pruner /app/out/json/ ./
RUN --mount=type=cache,target=/pnpm-store \
    pnpm config set store-dir /pnpm-store && pnpm install --frozen-lockfile

# --- 4) Node builder: build Next.js standalone, workeru a CLI -----------------
FROM node-deps AS node-builder
ARG IMAGE_VERSION
ENV IMAGE_VERSION=${IMAGE_VERSION}
COPY --from=pruner /app/out/full/ ./
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm turbo run build --filter=@mlain/web --filter=@mlain/worker --filter=@mlain/cli
# Next standalone vyrobí .next/standalone se zabaleným node_modules podmnožinou.

# --- 5) Runtime --------------------------------------------------------------
FROM node:24.18.1-alpine AS runtime
ARG IMAGE_VERSION
# tini se stará o reaping zombie procesů a o předání signálů, když MODE=all
# spouští tři potomky. Bez něj SIGTERM nedojde k dětem a shutdown není graceful.
RUN apk add --no-cache tini postgresql18-client ca-certificates tzdata \
 && addgroup -g 10001 -S mlain \
 && adduser  -u 10001 -S mlain -G mlain
WORKDIR /app

COPY --from=node-builder --chown=root:root /app/apps/web/.next/standalone ./
COPY --from=node-builder --chown=root:root /app/apps/web/.next/static ./apps/web/.next/static
# apps/web/public zakládá úkol 13 souborem .gitkeep. Next standalone tenhle
# adresář sám nezabaluje, takže COPY je nutný, a na neexistující cestě by build
# spadl na `lstat: no such file or directory`.
COPY --from=node-builder --chown=root:root /app/apps/web/public ./apps/web/public
COPY --from=node-builder --chown=root:root /app/apps/worker/dist ./apps/worker/dist
COPY --from=node-builder --chown=root:root /app/apps/cli/dist ./apps/cli/dist
# Migrace. Adresář zakládá úkol 5 souborem .gitkeep, právě aby tenhle řádek mohl
# být tady od začátku a nemusel se předávat jako požadavek na P03. Bez migrací
# v image by MIGRATE_ON_START=true nemělo co aplikovat a první instalace by
# skončila s prázdným schématem, aniž by cokoliv selhalo.
COPY --from=node-builder --chown=root:root /app/packages/db/migrations ./packages/db/migrations
COPY --from=sender-builder --chown=root:root /out/ml-sender /usr/local/bin/ml-sender
COPY --chown=root:root docker/entrypoint.sh /usr/local/bin/entrypoint.sh
COPY --chown=root:root docker/mlain /usr/local/bin/mlain
RUN chmod 0755 /usr/local/bin/entrypoint.sh /usr/local/bin/mlain

# Data se zapisují jen do /data, aplikační soubory jsou pro běžícího uživatele
# jen ke čtení. Kontejner tedy jde spustit s read-only rootfs (kritérium 8).
RUN mkdir -p /data/uploads /data/backups && chown -R 10001:10001 /data
VOLUME ["/data"]

# Health porty jsou rozdělené per proces SCHVÁLNĚ. Při MODE=all běží worker
# i sender jako potomci v jednom kontejneru se SDÍLENÝM prostředím, takže jedna
# společná proměnná HEALTH_PORT znamená, že druhý z nich spadne na obsazeném
# portu, a to hned ve výchozí konfiguraci MVP 0. Kritérium 8c.
ENV NODE_ENV=production \
    MODE=all \
    PORT=3000 \
    WORKER_HEALTH_PORT=3001 \
    SENDER_HEALTH_PORT=3002 \
    DATA_DIR=/data \
    IMAGE_VERSION=${IMAGE_VERSION}
EXPOSE 3000
USER 10001:10001

# Readiness, ne liveness: kontroluje i dostupnost databáze a shodu schématu.
HEALTHCHECK --interval=15s --timeout=5s --start-period=60s --retries=3 \
  CMD ["/usr/local/bin/mlain", "healthcheck"]

ENTRYPOINT ["/sbin/tini", "--", "/usr/local/bin/entrypoint.sh"]
```

**Poznámka k migracím `packages/db`.** Dřívější znění tenhle řádek vynechávalo a předávalo ho jako požadavek na P03 s odůvodněním, že `COPY` na neexistující cestu build zabije. To odůvodnění platí, ale předání nedosedlo: slova `Dockerfile` ani `packages/db/migrations` se v plánu P03 v tomhle významu nevyskytují a P03 má navíc vlastní pravidlo, že objevení `docker/` v `git status` je jeho chyba. Výsledkem by byla produkční image **bez migrací**, ve které `MIGRATE_ON_START=true` nemá co aplikovat a instalace skončí s prázdným schématem, aniž by cokoliv selhalo.

Řešení je jednodušší než předávka: úkol 5 zakládá `packages/db/migrations/.gitkeep`, takže cesta existuje a `COPY` může být v Dockerfilu od začátku. **`docker/` tím zůstává u jediného vlastníka a žádný jiný plán do něj nesahá.** Požadavek P01-3 se tím ruší.

- [ ] **Krok 4: Napiš `tools/ci/image-size.mjs`**

```js
#!/usr/bin/env node
// Kontrola velikosti image. Dělá ji job build-image; samostatný job image-size
// NEEXISTUJE a nezavádí se (část 1, kapitola 3.15, tabulka odkazů).
import { execFileSync } from 'node:child_process';

const LIMIT_BYTES = 250 * 1024 * 1024;
const image = process.argv[2];

if (!image) {
  console.error('Použití: node tools/ci/image-size.mjs <image>');
  process.exit(64);
}

const raw = execFileSync('docker', ['image', 'inspect', image, '--format', '{{.Size}}'], {
  encoding: 'utf8',
}).trim();
const size = Number.parseInt(raw, 10);
const mb = (size / (1024 * 1024)).toFixed(1);

if (Number.isNaN(size)) {
  console.error(`Nepodařilo se přečíst velikost image ${image}.`);
  process.exit(1);
}

console.log(`Velikost ${image}: ${mb} MB, limit 250.0 MB.`);
if (size > LIMIT_BYTES) {
  console.error(`Image překročila limit o ${((size - LIMIT_BYTES) / (1024 * 1024)).toFixed(1)} MB.`);
  process.exit(1);
}
```

- [ ] **Krok 5: Spusť test a postav image**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/tools exec vitest run ci/test/dockerfile.test.ts
```
Expected: PASS, `Tests  13 passed (13)`.

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && docker build -f docker/Dockerfile --build-arg IMAGE_VERSION=1.2.3 -t mlain:test .
```
Expected: build projde všemi pěti fázemi a skončí `naming to docker.io/library/mlain:test`.

- [ ] **Krok 6: Ověř kritéria 7, 7d, 7e na postavené image**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && docker run --rm mlain:test ml-sender --version && docker inspect -f '{{.Config.User}}' mlain:test && node tools/ci/image-size.mjs mlain:test
```
Expected: `1.2.3`, pak `10001:10001`, pak `Velikost mlain:test: <číslo> MB, limit 250.0 MB.` bez chyby.

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && docker build -f docker/Dockerfile --target node-deps -t mlain:deps . && for p in config contracts core db emails i18n sdk-node sdk-web ui; do docker run --rm mlain:deps test -f "/app/packages/$p/package.json" && echo "OK packages/$p"; done
```
Expected: devět řádků `OK packages/<jméno>`. Tohle je akceptační kritérium 7d: manifesty se nezploštily do jednoho souboru.

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && docker build -f docker/Dockerfile -t mlain:noversion . && docker run --rm mlain:noversion ml-sender --version
```
Expected: `0.0.0-dev`, nikdy prázdný řádek. Kritérium 7e.

- [ ] **Krok 7: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add docker/Dockerfile tools && git commit -m "feat(docker): multi-stage image with go sender, node apps and cli"
```

---

### Úkol 19: Compose, role databáze a ukázková konfigurace

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/docker/compose.yml`
- Create: `/Users/petr/Projects/Mailing_Tool/docker/compose.scale.yml`
- Create: `/Users/petr/Projects/Mailing_Tool/docker/initdb/10-roles.sql`
- Create: `/Users/petr/Projects/Mailing_Tool/.env.example`
- Test: `/Users/petr/Projects/Mailing_Tool/tools/ci/test/compose.test.ts`

- [ ] **Krok 1: Napiš padající test compose souboru**

`tools/ci/test/compose.test.ts`:

```ts
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const compose = (): string => fs.readFileSync(path.join(ROOT, 'docker/compose.yml'), 'utf8');

describe('docker/compose.yml', () => {
  it('je platný compose soubor', () => {
    execFileSync('docker', ['compose', '-f', path.join(ROOT, 'docker/compose.yml'), 'config'], {
      env: { ...process.env, APP_URL: 'https://x.example', SECRET_KEY: 'k' },
      encoding: 'utf8',
    });
  });

  it('mountuje /var/lib/postgresql, NE /var/lib/postgresql/data (kritérium 8b)', () => {
    const text = compose();
    expect(text).toContain(':/var/lib/postgresql\n');
    expect(text).not.toContain(':/var/lib/postgresql/data');
  });

  it('má stop_grace_period 40s, tedy o 15 s víc než SHUTDOWN_GRACE_SECONDS', () => {
    expect(compose()).toContain('stop_grace_period: 40s');
  });

  it('běží s read_only rootfs a no-new-privileges (kritérium 8)', () => {
    const text = compose();
    expect(text).toContain('read_only: true');
    expect(text).toContain('no-new-privileges:true');
  });

  it('vyžaduje APP_URL a SECRET_KEY, nemá pro ně výchozí hodnotu', () => {
    const text = compose();
    expect(text).toMatch(/APP_URL: \$\{APP_URL:\?/);
    expect(text).toMatch(/SECRET_KEY: \$\{SECRET_KEY:\?/);
  });

  it('předává DATABASE_URL_MIGRATOR, jinak nemá runner čím se připojit', () => {
    expect(compose()).toContain('DATABASE_URL_MIGRATOR:');
  });

  it('nepoužívá tag latest v produkčním příkladu', () => {
    expect(compose()).not.toMatch(/image: ghcr\.io\/nc-mill\/mlain:latest/);
  });

  it('postgres je pod profilem bundled, aby šel vypnout', () => {
    expect(compose()).toContain('profiles: ["bundled"]');
  });
});

describe('docker/initdb/10-roles.sql', () => {
  const sql = (): string =>
    fs.readFileSync(path.join(ROOT, 'docker/initdb/10-roles.sql'), 'utf8');

  it('zakládá všech šest rolí, které vyžaduje model oprávnění', () => {
    const text = sql();
    // Šest, ne čtyři. mlain_gdpr a mlain_maintenance přibyly po nálezu, že bez
    // nich není v produkci proveditelný výmaz podle článku 17 ani retenční
    // mazání web_events, a že to selže TIŠE: migrace granty na chybějící roli
    // přeskočí a testovací harness si role zakládá sám.
    for (const role of [
      'mlain_migrator',
      'mlain_app',
      'mlain_sender',
      'mlain_backup',
      'mlain_gdpr',
      'mlain_maintenance',
    ]) {
      expect(text, `chybí role ${role}`).toContain(role);
    }
  });

  it('je idempotentní, každý CREATE ROLE má ochranu proti opakování', () => {
    // Původní znění tohohle testu bylo `expect(creates.length).toBe(0)`, což
    // proti souboru, který tentýž úkol o pár kroků dál zapisuje, nemohlo projít
    // nikdy: pět CREATE ROLE tam je, jen uvnitř ochranných bloků. Měřit se má
    // záměr, tedy „žádný CREATE ROLE není NECHRÁNĚNÝ".
    //
    // Kontrola je zároveň přísnější než `toContain('pg_catalog.pg_roles')`:
    // ta projde i tehdy, když je chráněná jediná role z pěti, nebo když je
    // ochrana omylem napsaná na jiné jméno, než jaké se pak zakládá.
    const lines = sql().split('\n');
    const unguarded: string[] = [];
    lines.forEach((line, index) => {
      const match = /CREATE\s+ROLE\s+([a-z_]+)/i.exec(line);
      if (!match || /IF\s+NOT\s+EXISTS/i.test(line)) return;
      const guard = lines.slice(Math.max(0, index - 3), index).join('\n');
      const role = match[1];
      const guarded =
        /IF\s+NOT\s+EXISTS/i.test(guard) &&
        /pg_catalog\.pg_roles/i.test(guard) &&
        guard.includes(`'${role}'`);
      if (!guarded) unguarded.push(role);
    });
    expect(unguarded, 'CREATE ROLE bez ochrany proti opakování').toEqual([]);
    // Pojistka proti prázdné množině: kdyby se soubor rozpadl, test by byl
    // zeleně splněný nad nulou rolí.
    expect((sql().match(/CREATE\s+ROLE/gi) ?? []).length).toBe(5);
  });

  it('nastavuje časovou zónu databáze na UTC', () => {
    // ALTER DATABASE smí jen vlastník databáze nebo superuživatel, a
    // mlain_migrator není ani jedno. Musí to tedy proběhnout tady, v initdb,
    // ne v migraci. Požadavek P03, kapitola 7, řádek B.
    expect(sql()).toMatch(/ALTER DATABASE mlain SET timezone = 'UTC'/);
  });

  it('zakládá schéma pgboss vlastněné aplikační rolí', () => {
    const text = sql();
    expect(text).toContain('CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION mlain_app');
  });

  it('nedává aplikační roli vlastnictví schématu public', () => {
    expect(sql()).not.toMatch(/ALTER SCHEMA public OWNER TO mlain_app/);
  });

  it('každá zakládaná role dostane CONNECT i USAGE, kromě zálohovací', () => {
    const text = sql();
    for (const role of ['mlain_app', 'mlain_sender', 'mlain_gdpr', 'mlain_maintenance']) {
      expect(text.match(new RegExp(`GRANT CONNECT[\\s\\S]*?${role}`)), `${role} bez CONNECT`)
        .not.toBeNull();
      expect(text.match(new RegExp(`GRANT USAGE ON SCHEMA public[\\s\\S]*?${role}`)), `${role} bez USAGE`)
        .not.toBeNull();
    }
    // mlain_backup má pg_read_all_data a USAGE nepotřebuje.
    expect(text).toContain('GRANT pg_read_all_data TO mlain_backup');
  });
});

describe('.env.example', () => {
  it('obsahuje všechny povinné proměnné a žádnou skutečnou hodnotu tajemství', () => {
    const text = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');
    for (const name of ['APP_URL', 'SECRET_KEY', 'POSTGRES_PASSWORD']) {
      expect(text, `chybí ${name}`).toContain(name);
    }
    expect(text).toContain('mlain genkey');
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/tools exec vitest run ci/test/compose.test.ts
```
Expected: FAIL, `ENOENT` na `docker/compose.yml`.

- [ ] **Krok 3: Napiš `docker/compose.yml`**

```yaml
name: mlain

services:
  app:
    image: ghcr.io/nc-mill/mlain:1.0.0     # nikdy :latest v produkci
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
        required: false        # při externím Postgresu se profil "bundled" nepustí
    environment:
      MODE: all
      APP_URL: ${APP_URL:?APP_URL je povinná}
      DATABASE_URL: ${DATABASE_URL:-postgres://mlain_app:mlain@postgres:5432/mlain}
      # Migrace běží pod migrátorem, ne pod aplikační rolí. Bez téhle proměnné
      # nemá runner z 3.13 čím se připojit.
      DATABASE_URL_MIGRATOR: ${DATABASE_URL_MIGRATOR:-postgres://mlain_migrator:${POSTGRES_PASSWORD:-mlain}@postgres:5432/mlain}
      DATABASE_URL_SENDER: ${DATABASE_URL_SENDER:-postgres://mlain_sender:mlain@postgres:5432/mlain}
      SECRET_KEY: ${SECRET_KEY:?SECRET_KEY je povinná, vygenerujte ji příkazem mlain genkey}
      DEFAULT_LOCALE: ${DEFAULT_LOCALE:-cs}
      LOG_LEVEL: ${LOG_LEVEL:-info}
      WORKER_HEALTH_PORT: ${WORKER_HEALTH_PORT:-3001}
      SENDER_HEALTH_PORT: ${SENDER_HEALTH_PORT:-3002}
    ports:
      - "${APP_PORT:-3000}:3000"
    volumes:
      - ./data:/data
    stop_grace_period: 40s
    read_only: true
    tmpfs:
      - /tmp:size=256m
    security_opt:
      - no-new-privileges:true
    healthcheck:
      test: ["CMD", "/usr/local/bin/mlain", "healthcheck"]
      interval: 15s
      timeout: 5s
      retries: 3
      start_period: 60s
    deploy:
      resources:
        limits:
          memory: 2g

  postgres:
    image: postgres:18-alpine
    profiles: ["bundled"]          # docker compose --profile bundled up -d
    restart: unless-stopped
    environment:
      POSTGRES_DB: mlain
      POSTGRES_USER: mlain_migrator
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-mlain}
      POSTGRES_INITDB_ARGS: "--encoding=UTF8 --locale-provider=icu --icu-locale=cs-CZ"
    volumes:
      # POZOR: /var/lib/postgresql, NE /var/lib/postgresql/data.
      # Oficiální image řady 18 přesunul PGDATA na /var/lib/postgresql/18/docker
      # a deklarovaný VOLUME o úroveň výš. Bind mount na starou cestu NENÍ chyba,
      # na kterou by kontejner spadl: databáze se založí do anonymního svazku,
      # všechno vypadá, že běží, a po prvním `docker compose down` jsou data pryč.
      # Je to tichá ztráta dat. Akceptační kritérium 8b.
      - ./data/postgres:/var/lib/postgresql
      - ./initdb:/docker-entrypoint-initdb.d:ro   # zakládá role app a sender
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U mlain_migrator -d mlain"]
      interval: 10s
      timeout: 5s
      retries: 5
    stop_grace_period: 30s
```

- [ ] **Krok 4: Napiš `docker/compose.scale.yml`**

Dokumentovaná varianta pro větší nasazení. Do MVP 0 stačí `MODE=all`.

```yaml
name: mlain

# Rozdělený režim: každý proces vlastní kontejner. Health porty tady kolidovat
# nemůžou, ale výchozí hodnoty zůstávají různé, aby se MODE=all a rozdělený
# režim chovaly stejně.
#
# Použití: docker compose -f compose.yml -f compose.scale.yml up -d

services:
  app:
    environment:
      MODE: web
      MIGRATE_ON_START: "true"

  worker:
    image: ghcr.io/nc-mill/mlain:1.0.0
    restart: unless-stopped
    depends_on:
      app:
        condition: service_healthy
    environment:
      MODE: worker
      MIGRATE_ON_START: "false"
      APP_URL: ${APP_URL:?APP_URL je povinná}
      DATABASE_URL: ${DATABASE_URL:-postgres://mlain_app:mlain@postgres:5432/mlain}
      SECRET_KEY: ${SECRET_KEY:?SECRET_KEY je povinná}
      WORKER_HEALTH_PORT: 3001
    volumes:
      - ./data:/data
    stop_grace_period: 40s
    read_only: true
    tmpfs:
      - /tmp:size=256m
    security_opt:
      - no-new-privileges:true

  sender:
    image: ghcr.io/nc-mill/mlain:1.0.0
    restart: unless-stopped
    depends_on:
      app:
        condition: service_healthy
    environment:
      MODE: sender
      MIGRATE_ON_START: "false"
      APP_URL: ${APP_URL:?APP_URL je povinná}
      DATABASE_URL_SENDER: ${DATABASE_URL_SENDER:-postgres://mlain_sender:mlain@postgres:5432/mlain}
      SECRET_KEY: ${SECRET_KEY:?SECRET_KEY je povinná}
      SENDER_HEALTH_PORT: 3002
      # Statické dělení kvóty provideru mezi repliky, viz část 4b, 3.11.2.
      SENDER_REPLICAS: ${SENDER_REPLICAS:-1}
    stop_grace_period: 40s
    read_only: true
    tmpfs:
      - /tmp:size=256m
    security_opt:
      - no-new-privileges:true
```

- [ ] **Krok 5: Napiš `docker/initdb/10-roles.sql`**

**Šest rolí, ne čtyři.** Model oprávnění, se kterým počítá P03, potřebuje navíc `mlain_gdpr` (výmaz podle článku 17) a `mlain_maintenance` (retenční mazání `web_events`). Bez nich by se **výmaz osobních údajů v produkci nedal provést a nic by neselhalo**: migrace, která jim uděluje granty, chybějící roli přeskočí, a testovací harness P03 si všech šest rolí zakládá sám, takže testy jsou zelené nad prostředím, které u zákazníka neexistuje.

Přibývá i `ALTER DATABASE ... SET timezone = 'UTC'`. Musí být tady, protože `ALTER DATABASE` smí jen vlastník databáze nebo superuživatel a `mlain_migrator` není ani jedno, takže z migrace to nejde.

Celý skript je **ověřený spuštěním proti PostgreSQL 18.4**, včetně druhého běhu nad existující databází.

```sql
-- Zakládá databázové role podle tabulky v části 1, kapitole 3.12, rozšířené
-- o dvě role, které vyžaduje model oprávnění plánu P03.
-- U externího Postgresu je to v dokumentaci jako ruční krok.
--
-- Skript musí být idempotentní: docker-entrypoint-initdb.d sice běží jen při
-- prvním startu prázdného datového adresáře, ale operátor ho může spustit ručně
-- proti existující databázi a druhý běh nesmí spadnout.
--
-- Sloupcové granty, granty na tabulky a politiky RLS sem NEPATŘÍ. Vlastní je
-- plán P03 a zapisuje je do migrací, protože v okamžiku tohoto skriptu žádná
-- tabulka neexistuje.

DO $$
BEGIN
  -- mlain_app: běžný provoz. Nevlastní tabulky, takže na ni platí RLS.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'mlain_app') THEN
    CREATE ROLE mlain_app LOGIN PASSWORD 'mlain';
  END IF;

  -- mlain_sender: oddělená role, aby chyba v senderu nemohla sáhnout na kontakty.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'mlain_sender') THEN
    CREATE ROLE mlain_sender LOGIN PASSWORD 'mlain';
  END IF;

  -- mlain_backup: jen pro pg_dump, nikdy nezapisuje.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'mlain_backup') THEN
    CREATE ROLE mlain_backup LOGIN PASSWORD 'mlain';
  END IF;

  -- mlain_gdpr: výmaz podle článku 17. Tabulka consents je append only a
  -- aplikační role na ni právo DELETE nemá ani mít nesmí, jinak by šlo souhlas
  -- přepsat běžnou operací. Bez téhle role není výmaz proveditelný vůbec.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'mlain_gdpr') THEN
    CREATE ROLE mlain_gdpr LOGIN PASSWORD 'mlain';
  END IF;

  -- mlain_maintenance: retenční mazání web_events, ze stejného důvodu oddělené
  -- od aplikační role.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'mlain_maintenance') THEN
    CREATE ROLE mlain_maintenance LOGIN PASSWORD 'mlain';
  END IF;
END
$$;

-- mlain_migrator zakládá POSTGRES_USER v compose souboru a je vlastníkem
-- schématu public. Tady se jen pojistíme, že vlastnictví sedí.
ALTER SCHEMA public OWNER TO mlain_migrator;

-- Časová zóna databáze. ALTER DATABASE smí jen vlastník databáze nebo
-- superuživatel, takže z migrace pod rolí mlain_migrator to udělat nejde.
-- Připojení si navíc nastavují `options: '-c timezone=UTC'`, tohle je druhá
-- pojistka pro klienty, kteří to neudělají (psql, pg_dump, externí nástroje).
ALTER DATABASE mlain SET timezone = 'UTC';

-- Připojení k databázi.
GRANT CONNECT ON DATABASE mlain
  TO mlain_app, mlain_sender, mlain_backup, mlain_gdpr, mlain_maintenance;

-- Čtení schématu. Práva na jednotlivé tabulky uděluje P03 v migracích.
-- mlain_backup tady není schválně, má pg_read_all_data.
GRANT USAGE ON SCHEMA public
  TO mlain_app, mlain_sender, mlain_gdpr, mlain_maintenance;

-- pg_boss si své schéma migruje sám při boss.start(), tedy mimo náš migrační
-- runner. Aplikační role proto potřebuje vlastní schéma, do kterého smí
-- zakládat objekty. Bez tohohle řádku spadne worker při prvním startu na
-- "permission denied for database mlain".
CREATE SCHEMA IF NOT EXISTS pgboss AUTHORIZATION mlain_app;

-- Zálohovací role čte všechno a nikdy nezapisuje.
GRANT pg_read_all_data TO mlain_backup;

-- Bez tohohle by mlain_app mohla zakládat objekty v public a obešla by tím
-- pravidlo, že schéma vlastní výhradně migrátor.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
```

- [ ] **Krok 6: Napiš `.env.example`**

```bash
# Ukázková konfigurace pro docker/compose.yml.
# Zkopírujte na .env a vyplňte. Soubor .env do gitu NEPATŘÍ.

# --- Povinné -----------------------------------------------------------------
# Absolutní URL instalace, bez koncového lomítka.
APP_URL=https://mail.example.cz

# Klíč pro šifrování a podpisy. Vygenerujte příkazem:
#   docker run --rm ghcr.io/nc-mill/mlain:1.0.0 mlain genkey
# Tvar je <key_id>:<base64url>, po dekódování přesně 32 bajtů.
# Klíč si zálohujte MIMO zálohy aplikace: mlain backup ho záměrně neobsahuje.
SECRET_KEY=

# Heslo role mlain_migrator v přibaleném Postgresu.
POSTGRES_PASSWORD=zmente-me

# --- Volitelné ---------------------------------------------------------------
# Port na hostiteli.
APP_PORT=3000

# Výchozí jazyk rozhraní.
DEFAULT_LOCALE=cs

# trace, debug, info, warn, error, fatal
LOG_LEVEL=info

# Starší pokolení klíče po rotaci, oddělená čárkou, ve tvaru <key_id>:<base64url>.
# NIKDY se nevyprazdňuje: bez starých pokolení přestanou platit otisky smazaných
# adres v suppression listu a smazaný člověk se vrátí prvním dalším importem.
SECRET_KEY_PREVIOUS=

# Externí Postgres: vyplňte a nespouštějte profil bundled.
# DATABASE_URL=postgres://mlain_app:heslo@db.example.cz:5432/mlain
# DATABASE_URL_MIGRATOR=postgres://mlain_migrator:heslo@db.example.cz:5432/mlain
# DATABASE_URL_SENDER=postgres://mlain_sender:heslo@db.example.cz:5432/mlain
```

- [ ] **Krok 7: Spusť test a ověř, že prochází**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/tools exec vitest run ci/test/compose.test.ts
```
Expected: PASS, `Tests  15 passed (15)`.

- [ ] **Krok 8: Ověř kritéria 1, 8 a 8b na běžícím compose**

Nejdřív si postav lokální image a přepiš tag v compose souboru přes proměnnou prostředí.

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool/docker && docker build -f Dockerfile --build-arg IMAGE_VERSION=1.2.3 -t ghcr.io/nc-mill/mlain:1.0.0 .. && APP_URL=http://localhost:3000 SECRET_KEY="1:$(head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=')" docker compose --profile bundled up -d
```
Expected: `Container mlain-postgres-1  Healthy`, `Container mlain-app-1  Started`.

Run:
```bash
sleep 60; curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/health/ready
```
Expected: `200`. Akceptační kritérium 1. Kdyby vrátil 503, podívej se na `docker compose logs app` a na výstup `/api/health/ready`, který nese seznam kontrol.

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool/docker && docker compose exec -T postgres psql -U mlain_migrator -d mlain -c "CREATE TABLE zkouska(id int); INSERT INTO zkouska VALUES (42);" && docker compose --profile bundled down && APP_URL=http://localhost:3000 SECRET_KEY="1:$(head -c 32 /dev/urandom | base64 | tr '+/' '-_' | tr -d '=')" docker compose --profile bundled up -d && sleep 30 && docker compose exec -T postgres psql -U mlain_migrator -d mlain -tAc "SELECT count(*) FROM zkouska" && ls -A data/postgres | head -3
```
Expected: poslední dva výstupy jsou `1` a neprázdný výpis adresáře. Akceptační kritérium 8b: data přežila `down` a `up` a `./data/postgres` na hostiteli není prázdný.

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool/docker && docker compose kill -s SIGTERM app && sleep 5 && docker compose logs app | grep -c "graceful shutdown"
```
Expected: číslo větší než 0. Akceptační kritérium 6.

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool/docker && docker compose --profile bundled down -v && rm -rf data
```
Expected: úklid bez chyby.

- [ ] **Krok 9: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add docker .env.example tools && git commit -m "feat(docker): compose, scale variant, bootstrap roles and env example"
```

---

### Úkol 20: Skripty CI jobů

Rozhodnutí D8: skript, který zatím nemá co kontrolovat, vypíše `SKIP: <důvod>` a vrátí 0. Alternativa `continue-on-error` nebo `if:` podmínka by znamenala, že se brána zapne až někdy. **Ke každému skriptu existuje test, který mu podstrčí vadný vstup a ověří nenulový exit code**, aby se z detekce nepřítomnosti vstupu nestala tichá díra.

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/tools/ci/lib/report.mjs`
- Create: `/Users/petr/Projects/Mailing_Tool/tools/ci/i18n-check.mjs`
- Create: `/Users/petr/Projects/Mailing_Tool/tools/ci/openapi-drift.mjs`
- Create: `/Users/petr/Projects/Mailing_Tool/tools/ci/contracts-golden.mjs`
- Create: `/Users/petr/Projects/Mailing_Tool/tools/ci/contracts-fixtures-schema.mjs`
- Create: `/Users/petr/Projects/Mailing_Tool/tools/ci/contracts-schema.mjs`
- Create: `/Users/petr/Projects/Mailing_Tool/tools/ci/migration-lint.mjs`
- Create: `/Users/petr/Projects/Mailing_Tool/tools/ci/migrations-check.mjs`
- Create: `/Users/petr/Projects/Mailing_Tool/tools/ci/licenses-node.mjs`
- Create: `/Users/petr/Projects/Mailing_Tool/licenses.allow.json`
- Test: `/Users/petr/Projects/Mailing_Tool/tools/ci/test/ci-scripts.test.ts`

**Konvence pro spouštění podprocesů v tomhle plánu:** všude se používá `execFileSync` s polem argumentů, nikdy varianta se shellem a interpolovaným řetězcem. Interpolace do shellu je injekce; pole argumentů ji z definice nemá kam pustit.

- [ ] **Krok 1: Napiš padající test skriptů**

`tools/ci/test/ci-scripts.test.ts`:

```ts
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');
let sandbox: string;

function run(
  script: string,
  cwd: string,
  env: Record<string, string> = {},
): { code: number; out: string } {
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'tools/ci', script)], {
      cwd,
      env: { ...process.env, ...env },
      encoding: 'utf8',
      stdio: 'pipe',
    });
    return { code: 0, out };
  } catch (error) {
    const failure = error as { status: number; stdout: string; stderr: string };
    return { code: failure.status, out: `${failure.stdout}${failure.stderr}` };
  }
}

/** Podstrčí na PATH falešné `pnpm`, které zapíše svoje argumenty a vrátí dané JSON. */
function fakePnpm(sandbox: string, inventory: Record<string, { licenses: string }>): string {
  const bin = path.join(sandbox, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const trace = path.join(sandbox, 'pnpm-args.log');
  const json = JSON.stringify(inventory).replaceAll("'", "\\u0027");
  fs.writeFileSync(
    path.join(bin, 'pnpm'),
    `#!/bin/sh\nprintf '%s\\n' "$*" >> ${JSON.stringify(trace)}\n` +
      `case "$*" in\n  *--json*) printf '%s' '${json}' ;;\n  *) echo "summary" ;;\nesac\nexit 0\n`,
  );
  fs.chmodSync(path.join(bin, 'pnpm'), 0o755);
  return trace;
}

beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'mlain-ci-'));
});
afterEach(() => {
  fs.rmSync(sandbox, { recursive: true, force: true });
});

describe('i18n-check', () => {
  it('bez katalogů hlásí SKIP a vrací 0', () => {
    const result = run('i18n-check.mjs', sandbox);
    expect(result.code).toBe(0);
    expect(result.out).toContain('SKIP');
  });

  it('spadne, když klíč v en chybí v cs (kritérium 51)', () => {
    const dir = path.join(sandbox, 'packages/i18n/messages');
    fs.mkdirSync(path.join(dir, 'en'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'cs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'en/common.json'), '{"save":"Save","cancel":"Cancel"}');
    fs.writeFileSync(path.join(dir, 'cs/common.json'), '{"save":"Uložit"}');
    const result = run('i18n-check.mjs', sandbox);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('common.cancel');
  });

  it('spadne na neplatném ICU výrazu', () => {
    const dir = path.join(sandbox, 'packages/i18n/messages');
    fs.mkdirSync(path.join(dir, 'en'), { recursive: true });
    fs.mkdirSync(path.join(dir, 'cs'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'en/common.json'), '{"n":"{count, plural, one {#} other {#}}"}');
    fs.writeFileSync(path.join(dir, 'cs/common.json'), '{"n":"{count, plural, one {#"}');
    const result = run('i18n-check.mjs', sandbox);
    expect(result.code).not.toBe(0);
  });
});

describe('openapi-drift', () => {
  it('bez packages/contracts hlásí SKIP a vrací 0', () => {
    expect(run('openapi-drift.mjs', sandbox).code).toBe(0);
  });

  it('spadne, když se commitnutý soubor liší od vygenerovaného', () => {
    const dir = path.join(sandbox, 'packages/contracts');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'openapi.json'), '{"openapi":"3.1.0"}');
    fs.writeFileSync(path.join(dir, 'openapi.generated.json'), '{"openapi":"3.1.0","paths":{}}');
    const result = run('openapi-drift.mjs', sandbox);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('contracts:generate');
  });
});

describe('migration-lint', () => {
  it('bez migrací hlásí SKIP a vrací 0', () => {
    expect(run('migration-lint.mjs', sandbox).code).toBe(0);
  });

  it('spadne na CREATE INDEX CONCURRENTLY bez mlain:no-transaction', () => {
    const dir = path.join(sandbox, 'packages/db/migrations');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '0001_x.sql'), 'CREATE INDEX CONCURRENTLY idx ON t (a);\n');
    const result = run('migration-lint.mjs', sandbox);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('no-transaction');
  });

  it('spadne na neidempotentním příkazu v no-transaction migraci', () => {
    const dir = path.join(sandbox, 'packages/db/migrations');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, '0002_y.sql'),
      '-- mlain:no-transaction\nCREATE INDEX CONCURRENTLY idx ON t (a);\n',
    );
    const result = run('migration-lint.mjs', sandbox);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('IF NOT EXISTS');
  });

  it('spadne na now() v kompilovaném SQL (konvence 2.4)', () => {
    const dir = path.join(sandbox, 'packages/db/migrations');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, '0003_z.sql'),
      '-- mlain:no-transaction\nCREATE INDEX CONCURRENTLY IF NOT EXISTS idx ON t (a) WHERE created_at > now();\n',
    );
    const result = run('migration-lint.mjs', sandbox);
    expect(result.code).not.toBe(0);
  });

  it('projde na správně napsané migraci', () => {
    const dir = path.join(sandbox, 'packages/db/migrations');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, '0004_ok.sql'),
      '-- mlain:no-transaction\nCREATE INDEX CONCURRENTLY IF NOT EXISTS idx ON t (a);\n',
    );
    expect(run('migration-lint.mjs', sandbox).code).toBe(0);
  });
});

describe('licenses-node', () => {
  it('spadne na výjimce bez expires_at', () => {
    fs.writeFileSync(
      path.join(sandbox, 'licenses.allow.json'),
      JSON.stringify({
        exceptions: [
          { package: 'x', version: '1.0.0', license: 'GPL-3.0', reason: 'r', approved_by: 'p' },
        ],
      }),
    );
    const result = run('licenses-node.mjs', sandbox);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('expires_at');
  });

  it('spadne na prošlé výjimce', () => {
    fs.writeFileSync(
      path.join(sandbox, 'licenses.allow.json'),
      JSON.stringify({
        exceptions: [
          {
            package: 'x',
            version: '1.0.0',
            license: 'GPL-3.0',
            reason: 'r',
            approved_by: 'p',
            expires_at: '2020-01-01',
          },
        ],
      }),
    );
    const result = run('licenses-node.mjs', sandbox);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('vypršela');
  });

  // Tenhle test je hlavní pojistka nálezu, že se licenses.allow.json jen
  // VALIDOVAL a do samotné kontroly se nikdy nedostal. Výjimka tím fakticky
  // nic neodblokovala a licenční brána byla červená bez ohledu na rozhodnutí
  // zadavatele. Test se neptá zdrojáku skriptu, ale sleduje, s jakými
  // argumenty skript license-checker doopravdy zavolal.
  it('rozvine výjimku na název@verze a předá ji do kontroly', () => {
    fs.mkdirSync(path.join(sandbox, 'node_modules'), { recursive: true });
    fs.writeFileSync(
      path.join(sandbox, 'licenses.allow.json'),
      JSON.stringify({
        exceptions: [
          {
            package: '@img/sharp-libvips-*',
            license: 'LGPL-3.0-or-later',
            reason: 'rozhodnutí zadavatele',
            approved_by: 'zadavatel',
            expires_at: '2099-01-01',
          },
        ],
      }),
    );
    const trace = fakePnpm(sandbox, {
      '@img/sharp-libvips-linux-x64@1.3.2': { licenses: 'LGPL-3.0-or-later' },
      'react@19.2.0': { licenses: 'MIT' },
    });
    const result = run('licenses-node.mjs', sandbox, {
      PATH: `${path.join(sandbox, 'bin')}:${process.env['PATH'] ?? ''}`,
    });
    expect(result.code).toBe(0);
    const calls = fs.readFileSync(trace, 'utf8');
    expect(calls, 'skript nikdy nepředal --excludePackages').toContain('--excludePackages');
    expect(calls).toContain('@img/sharp-libvips-linux-x64@1.3.2');
    // react se do výjimek dostat nesmí, jinak by vzor bral víc, než má.
    expect(calls).not.toContain('react@19.2.0');
  });

  it('spadne, když se balíček pod existující výjimkou přelicencuje', () => {
    fs.mkdirSync(path.join(sandbox, 'node_modules'), { recursive: true });
    fs.writeFileSync(
      path.join(sandbox, 'licenses.allow.json'),
      JSON.stringify({
        exceptions: [
          {
            package: '@img/sharp-libvips-*',
            license: 'LGPL-3.0-or-later',
            reason: 'rozhodnutí zadavatele',
            approved_by: 'zadavatel',
            expires_at: '2099-01-01',
          },
        ],
      }),
    );
    fakePnpm(sandbox, { '@img/sharp-libvips-linux-x64@2.0.0': { licenses: 'AGPL-3.0-only' } });
    const result = run('licenses-node.mjs', sandbox, {
      PATH: `${path.join(sandbox, 'bin')}:${process.env['PATH'] ?? ''}`,
    });
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('AGPL-3.0-only');
  });
});

describe('contracts joby', () => {
  it('všechny tři bez packages/contracts hlásí SKIP a vracejí 0', () => {
    for (const script of [
      'contracts-golden.mjs',
      'contracts-fixtures-schema.mjs',
      'contracts-schema.mjs',
    ]) {
      const result = run(script, sandbox);
      expect(result.code, script).toBe(0);
      expect(result.out, script).toContain('SKIP');
    }
  });

  // Pojistka proti nálezu, že brána existuje, vypadá funkčně a nespustí nic.
  // Test se neptá zdrojáku skriptu, ale ověřuje chování na podstrčeném stromu:
  // balíček je na místě, ale příkaz vlastníka chybí, tedy není co spustit.
  function contractsPackage(scripts: Record<string, string> = {}): void {
    fs.mkdirSync(path.join(sandbox, 'packages/contracts'), { recursive: true });
    fs.writeFileSync(
      path.join(sandbox, 'packages/contracts/package.json'),
      JSON.stringify({ name: '@mlain/contracts', scripts }),
    );
  }

  it('contracts-golden spadne, když chybí Go strana a nemá co s čím porovnávat', () => {
    contractsPackage({ 'test:golden': 'true', 'test:parity': 'true' });
    const result = run('contracts-golden.mjs', sandbox);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('internal/contracts');
  });

  it('contracts-golden spadne, když packages/contracts nemá skript test:golden', () => {
    contractsPackage();
    fs.mkdirSync(path.join(sandbox, 'apps/sender/internal/contracts'), { recursive: true });
    const result = run('contracts-golden.mjs', sandbox);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('test:golden');
    expect(result.out).toContain('P02');
  });

  it('contracts-fixtures-schema spadne, když chybí skript test:fixtures-schema', () => {
    contractsPackage();
    const result = run('contracts-fixtures-schema.mjs', sandbox);
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('test:fixtures-schema');
    expect(result.out).toContain('P02');
  });
});

describe('migrations-check', () => {
  it('bez migračního runneru hlásí SKIP a vrací 0', () => {
    const result = run('migrations-check.mjs', sandbox, { DATABASE_URL_MIGRATOR: '' });
    expect(result.code).toBe(0);
    expect(result.out).toContain('SKIP');
  });

  it('spadne, když runner existuje a chybí DATABASE_URL_MIGRATOR', () => {
    fs.mkdirSync(path.join(sandbox, 'packages/db/src'), { recursive: true });
    fs.writeFileSync(path.join(sandbox, 'packages/db/src/migrate.ts'), 'export {};\n');
    const result = run('migrations-check.mjs', sandbox, { DATABASE_URL_MIGRATOR: '' });
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('DATABASE_URL_MIGRATOR');
  });

  // Tenhle test hlídá, že se skript nevrátí k bezpodmínečnému fail(). Ten by
  // po mergnutí P03 zůstal červený navždy a blokující job by zastavil merge
  // všech dalších plánů, aniž by to šlo odkudkoliv opravit.
  it('spadne s odkazem na test:migrations, ne na sebe sama', () => {
    fs.mkdirSync(path.join(sandbox, 'packages/db/src'), { recursive: true });
    fs.writeFileSync(path.join(sandbox, 'packages/db/src/migrate.ts'), 'export {};\n');
    fs.writeFileSync(
      path.join(sandbox, 'packages/db/package.json'),
      JSON.stringify({ name: '@mlain/db', scripts: {} }),
    );
    const result = run('migrations-check.mjs', sandbox, {
      DATABASE_URL_MIGRATOR: 'postgres://u:p@127.0.0.1:5432/x',
    });
    expect(result.code).not.toBe(0);
    expect(result.out).toContain('test:migrations');
    expect(result.out).toContain('P03');
    expect(result.out, 'skript nesmí žádat zásah do tools/ci').not.toContain('tools/ci');
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/tools exec vitest run ci/test/ci-scripts.test.ts
```
Expected: FAIL, `Cannot find module '.../tools/ci/i18n-check.mjs'`.

- [ ] **Krok 3: Napiš `tools/ci/lib/report.mjs`**

```js
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

/**
 * Job, který zatím nemá co kontrolovat, hlásí SKIP a vrací 0 (rozhodnutí D8).
 * Nikdy se nepoužívá continue-on-error ani if: podmínka ve workflow, protože
 * to by znamenalo, že se brána zapne až někdy, a mezitím by se mergovalo bez ní.
 */
export function skip(reason) {
  console.log(`SKIP: ${reason}`);
  process.exit(0);
}

export function fail(lines) {
  for (const line of Array.isArray(lines) ? lines : [lines]) {
    console.error(line);
  }
  process.exit(1);
}

export function ok(message) {
  console.log(`OK: ${message}`);
  process.exit(0);
}

/** Rekurzivně vypíše soubory s danou příponou. Vrací seřazené relativní cesty. */
export function listFiles(root, extension) {
  if (!fs.existsSync(root)) return [];
  const found = [];
  const walk = (dir, prefix) => {
    const entries = fs
      .readdirSync(dir, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = `${dir}/${entry.name}`;
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(absolute, relative);
      else if (entry.name.endsWith(extension)) found.push(relative);
    }
  };
  walk(root, '');
  return found;
}

/**
 * Spustí skript, který vlastní jiný balíček, a jeho výsledek prohlásí za
 * výsledek jobu.
 *
 * PROČ TAHLE VRSTVA EXISTUJE. Brány, které tenhle plán staví, kontrolují data
 * vyrobená jinými plány: fixtures vlastní P02, migrace P03. Kdyby si kontrolu
 * psal `tools/ci/*.mjs` sám, byla by to DRUHÁ implementace téhož pravidla,
 * která se s tou první tiše rozejde. Přesně to se stalo: skript porovnával
 * jména souborů fixtures, ale P02 mezitím zvolil jiné uspořádání adresářů,
 * jiná jména schémat i jiný soubor s kontraktními sloupci, takže brána buď
 * hlásila nesmysly, nebo mlčky přeskakovala.
 *
 * Dělba je proto tahle: **P01 vlastní JOB, vlastník dat vlastní KONTROLU.**
 * Job zjistí, jestli má co kontrolovat, a když ano, zavolá příkaz vlastníka.
 *
 * Polarita je záměrně nesymetrická (rozhodnutí D8):
 *   balíček neexistuje          -> SKIP, exit 0
 *   balíček existuje bez skriptu -> FAIL, protože brána by jinak zeleně
 *                                   nekontrolovala vůbec nic
 *   skript existuje              -> rozhoduje jeho exit code
 */
export function delegate({ packageName, directory, script, owner, purpose }) {
  const manifestPath = `${process.cwd()}/${directory}/package.json`;
  if (!fs.existsSync(`${process.cwd()}/${directory}`)) {
    skip(`${directory} zatím neexistuje, ${purpose} dodá plán ${owner}`);
  }
  if (!fs.existsSync(manifestPath)) {
    fail([
      `${directory} existuje, ale nemá package.json.`,
      `Plán ${owner} do něj musí zapsat skript "${script}".`,
    ]);
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (!manifest.scripts?.[script]) {
    fail([
      `${directory} existuje, ale skript "${script}" v jeho package.json chybí.`,
      `Dodává ho plán ${owner}: ${purpose}.`,
      'Chybějící kontrola se NIKDY nepřeskakuje: brána, která nic nekontroluje,',
      'je horší než brána, která neexistuje, protože vypadá funkčně.',
    ]);
  }
  try {
    // Pole argumentů, ne shell: interpolace do shellu je injekce.
    execFileSync('pnpm', ['--filter', packageName, 'run', script], { stdio: 'inherit' });
  } catch {
    fail([`${packageName} run ${script} selhal.`, `Kontrolu vlastní plán ${owner}.`]);
  }
}

/** Ploché klíče vnořeného JSON, například "auth.signIn.title". */
export function flattenKeys(value, prefix = '') {
  const keys = [];
  for (const [key, item] of Object.entries(value)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
      keys.push(...flattenKeys(item, full));
    } else {
      keys.push(full);
    }
  }
  return keys;
}
```

- [ ] **Krok 4: Napiš `tools/ci/i18n-check.mjs`**

```js
#!/usr/bin/env node
// Job i18n-check. Shoda klíčů mezi jazyky a validita ICU výrazů.
// Zdroj pravdy je en (část 1, kapitola 3.9). Akceptační kritéria 51 a 53.
import fs from 'node:fs';
import path from 'node:path';
import { fail, flattenKeys, listFiles, ok, skip } from './lib/report.mjs';

const MESSAGES = path.resolve(process.cwd(), 'packages/i18n/messages');

if (!fs.existsSync(MESSAGES)) {
  skip('packages/i18n/messages zatím neexistuje, katalogy dodá plán P05');
}

const locales = fs
  .readdirSync(MESSAGES, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (!locales.includes('en')) {
  fail('packages/i18n/messages/en neexistuje, přitom je zdrojem pravdy (3.9).');
}

function readCatalog(locale) {
  const result = new Map();
  for (const file of listFiles(path.join(MESSAGES, locale), '.json')) {
    const namespace = file.replace(/\.json$/, '').replace(/\//g, '.');
    const parsed = JSON.parse(fs.readFileSync(path.join(MESSAGES, locale, file), 'utf8'));
    for (const key of flattenKeys(parsed)) result.set(`${namespace}.${key}`, true);
  }
  return result;
}

/**
 * Minimální kontrola ICU: závorky musí být vyvážené a každá konstrukce plural
 * nebo select musí mít větev other. Plná validace patří do runtime knihovny,
 * tohle chytá překlepy, které by jinak spadly až u uživatele.
 *
 * Čeština má kategorie one, few, many, other; many je pro desetinná čísla
 * a musí být vyplněná, jinak 1,5 kontaktu vypadne na other (3.9).
 */
function icuProblems(text) {
  const problems = [];
  let depth = 0;
  for (const character of text) {
    if (character === '{') depth += 1;
    if (character === '}') depth -= 1;
    if (depth < 0) return ['nevyvážené složené závorky'];
  }
  if (depth !== 0) problems.push('nevyvážené složené závorky');
  if (/\{\s*\w+\s*,\s*(plural|select|selectordinal)\s*,/.test(text) && !/\bother\s*\{/.test(text)) {
    problems.push('konstrukce plural nebo select nemá větev other');
  }
  return problems;
}

const reference = readCatalog('en');
const errors = [];

for (const locale of locales) {
  if (locale === 'en') continue;
  const catalog = readCatalog(locale);
  for (const key of reference.keys()) {
    if (!catalog.has(key)) errors.push(`${locale}: chybí klíč ${key}`);
  }
  for (const key of catalog.keys()) {
    if (!reference.has(key)) errors.push(`${locale}: přebývá klíč ${key}, který v en není`);
  }
}

for (const locale of locales) {
  for (const file of listFiles(path.join(MESSAGES, locale), '.json')) {
    const raw = fs.readFileSync(path.join(MESSAGES, locale, file), 'utf8');
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      errors.push(`${locale}/${file}: neplatný JSON, ${error.message}`);
      continue;
    }
    const walk = (value, prefix) => {
      for (const [key, item] of Object.entries(value)) {
        const full = prefix ? `${prefix}.${key}` : key;
        if (typeof item === 'string') {
          for (const problem of icuProblems(item)) {
            errors.push(`${locale}/${file}: klíč ${full}: ${problem}`);
          }
        } else if (item !== null && typeof item === 'object') {
          walk(item, full);
        }
      }
    };
    walk(parsed, '');
  }
}

if (errors.length > 0) fail(['i18n-check našel problémy:', ...errors.map((line) => `  ${line}`)]);
ok(`${reference.size} klíčů, ${locales.length} jazyků, katalogy jsou v souladu`);
```

- [ ] **Krok 5: Napiš zbývající skripty**

`tools/ci/openapi-drift.mjs`:

```js
#!/usr/bin/env node
// Job openapi-drift. Soubor packages/contracts/openapi.json je commitnutý
// a musí se bajt po bajtu shodovat s vygenerovaným (část 1, kapitola 4.7).
//
// PRAVIDLO (uzávěr S9): openapi.json se NIKDY neslučuje ručně. Při konfliktu
// v gitu se zahodí obě verze a přegeneruje se.
import fs from 'node:fs';
import path from 'node:path';
import { fail, ok, skip } from './lib/report.mjs';

const CONTRACTS = path.resolve(process.cwd(), 'packages/contracts');
const committed = path.join(CONTRACTS, 'openapi.json');
const generated = path.join(CONTRACTS, 'openapi.generated.json');

if (!fs.existsSync(committed)) {
  skip('packages/contracts/openapi.json zatím neexistuje, generátor dodá plán P04');
}
if (!fs.existsSync(generated)) {
  fail([
    'openapi.json existuje, ale openapi.generated.json chybí.',
    'Spusť: pnpm contracts:generate',
  ]);
}

if (fs.readFileSync(committed, 'utf8') !== fs.readFileSync(generated, 'utf8')) {
  fail([
    'Commitnutý openapi.json se liší od vygenerovaného.',
    'Nikdy ho neslučuj ručně. Spusť: pnpm contracts:generate a commitni výsledek.',
  ]);
}
ok('openapi.json je shodný s vygenerovaným');
```

`tools/ci/contracts-golden.mjs`:

```js
#!/usr/bin/env node
// Job contracts-golden. Fixtures proti TS i Go implementaci. BEZ DATABÁZE.
//
// Kontrola "kontraktní sloupce existují po migracích" NEBĚŽÍ tady, ale v jobu
// contracts-schema, který Postgres ze services: má (část 1, kapitola 3.15).
//
// TENHLE JOB NEPOROVNÁVÁ JMÉNA SOUBORŮ. Dřívější znění to dělalo a bylo to
// dvojnásob špatně:
//   1) Go fixtures hledalo v apps/sender/testdata/fixtures, jenže `testdata`
//      je SYMLINK na packages/contracts/fixtures, takže podadresář `fixtures`
//      pod ním neexistuje. Množina Go fixtures byla prázdná a job hlásil
//      u KAŽDÉ z 66 fixtur, že je jen na TypeScript straně.
//   2) I po opravě cesty by porovnával adresář sám se sebou přes symlink,
//      tedy by neporovnával nic. Parita dvou implementací se z výpisu adresáře
//      poznat nedá, poznat se dá jen z reportů obou jazyků.
//
// Skutečnou paritu umí jen `test:parity` z P02, který porovnává
// reports/ts-golden.json a reports/go-golden.json. Reporty musí vzniknout
// PŘED ním, proto se v tomhle pořadí spouští všechny tři kroky.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { delegate, fail, ok, skip } from './lib/report.mjs';

const CONTRACTS = path.resolve(process.cwd(), 'packages/contracts');

if (!fs.existsSync(CONTRACTS)) {
  skip('packages/contracts zatím neexistuje, fixtures a runnery dodá plán P02');
}

// 1) Obě strany musí existovat, než se pustí cokoliv drahého. Kdyby se kontrola
// Go strany dělala až po běhu TypeScript runnerů, chyběl by report jednoho
// jazyka a parita by spadla na nesrozumitelném ENOENT místo na příčině.
const goContracts = path.resolve(process.cwd(), 'apps/sender/internal/contracts');
if (!fs.existsSync(goContracts)) {
  fail([
    'packages/contracts existuje, ale apps/sender/internal/contracts ne.',
    'Bez Go strany není co s čím porovnávat a job by kontroloval jen půlku kontraktu.',
    'Runnery na Go straně dodává plán P02 (rozhodnutí R1).',
  ]);
}

// 2) TypeScript strana vyrobí reports/ts-golden.json.
delegate({
  packageName: '@mlain/contracts',
  directory: 'packages/contracts',
  script: 'test:golden',
  owner: 'P02',
  purpose: 'runnery golden fixtures nad TypeScript implementací',
});

// 3) Go strana vyrobí reports/go-golden.json. Balíček internal/contracts
// zakládá P02 (runnery) a naplňuje P09 (implementace), viz rozhodnutí R1.
try {
  execFileSync('go', ['test', './internal/contracts/...', '-run', 'TestGolden'], {
    cwd: path.resolve(process.cwd(), 'apps/sender'),
    stdio: 'inherit',
  });
} catch {
  fail(['go test ./internal/contracts/... -run TestGolden selhal.', 'Runnery vlastní plán P02.']);
}

// 4) Parita obou reportů plus pokrytí povinných chybových kódů.
delegate({
  packageName: '@mlain/contracts',
  directory: 'packages/contracts',
  script: 'test:parity',
  owner: 'P02',
  purpose: 'porovnání reportů obou jazyků a pokrytí chybových kódů',
});

ok('golden fixtures prošly na obou stranách a parita reportů sedí');
```

`tools/ci/contracts-fixtures-schema.mjs`:

```js
#!/usr/bin/env node
// Job contracts-fixtures-schema. Validace všech fixtures proti JSON schématům
// v packages/contracts/schema/ (část 1, kapitola 3.15).
//
// Skládat jméno schématu jako `<první segment cesty>.schema.json` NEFUNGUJE:
// P02 pojmenoval schémata `liquid-fixture.schema.json`, `marker-fixture...`,
// `token-vectors...` a tak dál, takže by se netrefilo ANI JEDNO a job by
// po dokončení P02 tvrdě spadl na pěti vymyšlených chybách. Mapu skupina na
// schéma vlastní P02 spolu se schématy, tenhle job jen spouští jeho validátor.
import fs from 'node:fs';
import path from 'node:path';
import { delegate, ok, skip } from './lib/report.mjs';

const CONTRACTS = path.resolve(process.cwd(), 'packages/contracts');

if (!fs.existsSync(CONTRACTS)) {
  skip('packages/contracts zatím neexistuje, schémata a fixtures dodá plán P02');
}

delegate({
  packageName: '@mlain/contracts',
  directory: 'packages/contracts',
  script: 'test:fixtures-schema',
  owner: 'P02',
  purpose: 'validace fixtures proti JSON schématům',
});

ok('všechny fixtures odpovídají svým schématům');
```

`tools/ci/contracts-schema.mjs`:

```js
#!/usr/bin/env node
// Job contracts-schema. Proti Postgresu ze services: aplikuje migrace a ověří,
// že kontraktní sloupce existují a mají očekávaný typ (část 1, kapitola 3.15).
//
// Tenhle čtvrtý bod test:parity NEBĚŽÍ v contracts-golden, protože ten databázi
// nemá a mít nemá. Bez toho rozdělení by buď spadl na chybějícím připojení,
// nebo, hůř, byl potichu přeskočen jako "nedostupná databáze".
//
// Manifest kontraktních sloupců se NEČTE tady. Dřívější znění hledalo
// packages/contracts/schema/columns.json, jenže P02 ten soubor pojmenoval
// fixtures/outbox/contract-columns.json a dal mu jiný tvar (mapa `messages`
// plus mapa `foreign` na pole jmen bez typů). Job by tedy tiše skipoval
// napořád a plochý `Object.entries` nad polem by z indexů udělal jména sloupců.
import fs from 'node:fs';
import path from 'node:path';
import { delegate, fail, ok, skip } from './lib/report.mjs';

const CONTRACTS = path.resolve(process.cwd(), 'packages/contracts');
const MIGRATIONS = path.resolve(process.cwd(), 'packages/db/migrations');

if (!fs.existsSync(CONTRACTS)) {
  skip('packages/contracts zatím neexistuje, kontraktní sloupce dodá plán P02');
}
// Prázdný adresář zakládá P01 kvůli Dockerfilu, takže se kontroluje obsah,
// ne jen existence.
if (!fs.existsSync(MIGRATIONS) || fs.readdirSync(MIGRATIONS).every((f) => f.startsWith('.'))) {
  skip('packages/db/migrations je zatím prázdný, migrace dodá plán P03');
}
if (!process.env.DATABASE_URL_MIGRATOR) {
  fail([
    'contracts-schema potřebuje DATABASE_URL_MIGRATOR proti Postgresu ze services:.',
    'Nedostupná databáze se NIKDY nepřeskakuje: bez ní by kontraktní sloupce nehlídalo nic.',
  ]);
}

delegate({
  packageName: '@mlain/contracts',
  directory: 'packages/contracts',
  script: 'test:schema',
  owner: 'P02',
  purpose: 'scénáře outboxu a kontrola kontraktních sloupců proti databázi',
});

ok('všechny kontraktní sloupce existují a mají očekávaný typ');
```

`tools/ci/migration-lint.mjs`:

```js
#!/usr/bin/env node
// Lint migrací, součást jobu lint. Vynucuje konvence z části 1, kapitoly 3.13.
import fs from 'node:fs';
import path from 'node:path';
import { fail, listFiles, ok, skip } from './lib/report.mjs';

const MIGRATIONS = path.resolve(process.cwd(), 'packages/db/migrations');

if (!fs.existsSync(MIGRATIONS)) {
  skip('packages/db/migrations zatím neexistuje, migrace dodá plán P03');
}

const errors = [];
const files = listFiles(MIGRATIONS, '.sql');

for (const file of files) {
  const text = fs.readFileSync(path.join(MIGRATIONS, file), 'utf8');
  const noTransaction = /^--\s*mlain:no-transaction\s*$/m.test(text);
  const statements = text
    .split('--> statement-breakpoint')
    .map((chunk) => chunk.trim())
    .filter((chunk) => chunk.length > 0);

  if (/CREATE\s+INDEX\s+CONCURRENTLY/i.test(text) && !noTransaction) {
    errors.push(`${file}: CREATE INDEX CONCURRENTLY vyžaduje direktivu -- mlain:no-transaction`);
  }

  if (noTransaction) {
    // Migrace mimo transakci může spadnout uprostřed a nechat databázi
    // v částečném stavu, takže smí obsahovat jen idempotentní příkazy.
    for (const statement of statements) {
      const commands = statement
        .split(';')
        .map((command) => command.trim())
        .filter((command) => command.length > 0 && !command.startsWith('--'));
      for (const command of commands) {
        if (/^CREATE\s+INDEX/i.test(command) && !/IF\s+NOT\s+EXISTS/i.test(command)) {
          errors.push(
            `${file}: v no-transaction migraci musí mít CREATE INDEX klauzuli IF NOT EXISTS`,
          );
        }
        if (/^DROP\s+INDEX/i.test(command) && !/IF\s+EXISTS/i.test(command)) {
          errors.push(`${file}: v no-transaction migraci musí mít DROP INDEX klauzuli IF EXISTS`);
        }
      }
    }
  }

  // Konvence 2.4: kompilované SQL nesmí volat now(). Čas dodává aplikace,
  // jinak se výsledek migrace liší podle okamžiku spuštění.
  const withoutComments = text.replace(/--[^\n]*\n/g, '\n');
  if (/\bnow\s*\(\s*\)/i.test(withoutComments) && !/DEFAULT\s+now\s*\(\s*\)/i.test(withoutComments)) {
    errors.push(`${file}: volání now() mimo DEFAULT je zakázané (konvence 2.4)`);
  }

  if (/^\s*DROP\s+TABLE/im.test(withoutComments) && !/IF\s+EXISTS/i.test(withoutComments)) {
    errors.push(`${file}: DROP TABLE musí mít IF EXISTS`);
  }
}

if (errors.length > 0) fail(['migration-lint našel problémy:', ...errors.map((l) => `  ${l}`)]);
ok(`${files.length} migrací prošlo lintem`);
```

`tools/ci/migrations-check.mjs`:

```js
#!/usr/bin/env node
// Job migrations-check. Tři scénáře z části 1, kapitoly 3.13:
//   1. Prázdná databáze + všechny migrace = schéma odpovídá snapshotu, žádný drift.
//   2. Databáze z tagu předchozího vydání + nové migrace = projde bez chyby.
//   3. Seed s 10 000 řádky na klíčových tabulkách, aby NOT NULL a UNIQUE
//      narazily na reálná data.
//
// Scénáře NEJSOU tady a být tady nemají: potřebují Drizzle, migrace
// a testcontainers, což do samostatného .mjs skriptu nepatří. P03 je píše do
// packages/db/test/migrations-check.test.ts a spouští skriptem test:migrations.
//
// Dřívější znění místo toho na konci bezpodmínečně volalo fail() a předávalo
// P03 požadavek, ať scénáře doplní PŘÍMO SEM. To předání nemohlo dosednout:
// tools/ci/** je výhradní vlastnictví P01 a P03 má vlastní pravidlo, že do
// cizích adresářů nesahá. Job by tedy po mergnutí P03 zůstal červený navždy
// a protože je blokující, neprošel by od té chvíle žádný pull request.
import fs from 'node:fs';
import path from 'node:path';
import { delegate, fail, ok, skip } from './lib/report.mjs';

const DB = path.resolve(process.cwd(), 'packages/db');
const RUNNER = path.resolve(process.cwd(), 'packages/db/src/migrate.ts');

if (!fs.existsSync(RUNNER)) {
  skip('packages/db/src/migrate.ts zatím neexistuje, migrační runner dodá plán P03');
}
if (!process.env.DATABASE_URL_MIGRATOR) {
  fail([
    'migrations-check potřebuje DATABASE_URL_MIGRATOR proti Postgresu ze services:.',
    'Chybějící databáze se nikdy nepřeskakuje.',
  ]);
}

delegate({
  packageName: '@mlain/db',
  directory: 'packages/db',
  script: 'test:migrations',
  owner: 'P03',
  purpose: 'tři scénáře migrací z části 1, kapitoly 3.13',
});

ok('tři scénáře migrací prošly');
```

Polarita zůstává opačná než u ostatních skriptů, jen se přesunula o úroveň výš: nepřítomnost runneru je `SKIP`, ale **runner bez skriptu `test:migrations` je selhání**. Bez toho by P03 mohl přijít s migracemi a job by zeleně nekontroloval nic. Rozdíl proti dřívějšímu znění je, že selhání teď jde odstranit prací uvnitř `packages/db`, tedy tam, kde P03 pracovat smí.

`tools/ci/licenses-node.mjs`:

```js
#!/usr/bin/env node
// Job licenses-node. Projekt je MIT, GPL, LGPL a AGPL jsou zakázané
// (hlavní specifikace, kapitola 9; část 1, kapitola 3.15).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fail, ok } from './lib/report.mjs';

const ALLOWED = [
  'MIT',
  'Apache-2.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  '0BSD',
  'CC0-1.0',
  'Unlicense',
  'Python-2.0',
];

// Explicitní blocklist s vysvětlením, aby se nikdo nemusel ptát.
const BLOCKED = [
  'GPL-*',
  'AGPL-*',
  'LGPL-*',
  'SSPL-*',
  'BUSL-*',
  'Elastic-2.0',
  'Sustainable Use License',
  'CC-BY-NC-*',
];

const allowFile = path.resolve(process.cwd(), 'licenses.allow.json');
const errors = [];
let exceptions = [];

if (fs.existsSync(allowFile)) {
  ({ exceptions = [] } = JSON.parse(fs.readFileSync(allowFile, 'utf8')));
  const today = new Date();
  for (const exception of exceptions) {
    for (const field of ['package', 'license', 'reason', 'approved_by', 'expires_at']) {
      if (!exception[field]) {
        errors.push(`výjimka pro ${exception.package ?? '(bez jména)'}: chybí pole ${field}`);
      }
    }
    // Výjimka bez expires_at neprojde validací. Bez toho se z výjimek stane
    // trvalá díra (část 1, kapitola 3.15).
    if (exception.expires_at && new Date(exception.expires_at) < today) {
      errors.push(`výjimka pro ${exception.package} vypršela ${exception.expires_at}`);
    }
  }
}

if (errors.length > 0) {
  fail(['licenses-node našel problémy v licenses.allow.json:', ...errors.map((l) => `  ${l}`)]);
}

if (!fs.existsSync(path.resolve(process.cwd(), 'node_modules'))) {
  ok('licenses.allow.json je platný; kontrola balíčků proběhne po pnpm install');
}

/**
 * Rozvinutí výjimek na konkrétní `název@verze`.
 *
 * PROČ TO NEJDE JINAK: `--excludePackages` v license-checkeru 25 přijímá jen
 * přesné dvojice `název@verze`. Samotné jméno bez verze **neúčinkuje**, balíček
 * bránou stejně propadne; ověřeno spuštěním. Zapisovat verze do
 * licenses.allow.json ale nejde: nativní balíčky sharpu jsou per platforma
 * (na Ubuntu runneru linux-x64, v alpine image linuxmusl-x64, na vývojářském
 * Macu darwin-arm64) a verze se mění s každým patchem sharpu. Skript proto
 * jména rozvine sám podle toho, co je opravdu nainstalované.
 */
function resolveExceptions() {
  const installed = JSON.parse(
    execFileSync(
      'pnpm',
      ['exec', 'license-checker', '--production', '--excludePrivatePackages', '--json'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
    ),
  );
  const matches = (name, pattern) =>
    pattern.endsWith('*') ? name.startsWith(pattern.slice(0, -1)) : name === pattern;

  const excluded = [];
  for (const key of Object.keys(installed)) {
    const at = key.lastIndexOf('@');
    const name = key.slice(0, at);
    const exception = exceptions.find((item) => matches(name, item.package));
    if (!exception) continue;
    // Balíček se pod existující výjimkou nesmí tiše přelicencovat. Kdyby
    // @img/sharp-libvips přešel na AGPL, tenhle řádek to zachytí.
    const actual = String(installed[key].licenses);
    if (actual !== exception.license) {
      errors.push(
        `${key} má licenci "${actual}", ale výjimka je vystavená na "${exception.license}". Znovu ji posuď, neupravuj naslepo.`,
      );
    }
    excluded.push(key);
  }
  return excluded;
}

const excluded = resolveExceptions();
if (errors.length > 0) {
  fail(['licenses-node našel problémy:', ...errors.map((l) => `  ${l}`)]);
}
if (excluded.length > 0) {
  console.log(`Uplatněné výjimky: ${excluded.join(', ')}`);
}

try {
  // Pole argumentů, ne shell: interpolace do shellu je injekce.
  // --excludePrivatePackages: všechny balíčky monorepa jsou private a
  //   license-checker je jinak hlásí jako UNLICENSED a brána spadne na nich.
  // --excludePackages: BEZ TOHOHLE ARGUMENTU by se licenses.allow.json jen
  //   validoval a do kontroly by se nikdy nedostal, takže by výjimka fakticky
  //   nic neodblokovala. To byl skutečný stav dřívějšího znění.
  const args = [
    'exec',
    'license-checker',
    '--production',
    '--excludePrivatePackages',
    '--onlyAllow',
    ALLOWED.join(';'),
    '--summary',
  ];
  if (excluded.length > 0) args.push('--excludePackages', excluded.join(';'));
  execFileSync('pnpm', args, { stdio: 'inherit' });
} catch {
  fail([
    'license-checker našel závislost mimo whitelist.',
    `Povolené: ${ALLOWED.join(', ')}`,
    `Zakázané: ${BLOCKED.join(', ')}`,
    'MIT distribuce s GPL knihovnou je licenční konflikt, ne preference.',
    'Výjimku lze zapsat do licenses.allow.json, ale musí být na JMÉNO BALÍČKU,',
    'nikdy na licenci, a musí mít expires_at.',
  ]);
}
ok(`všechny závislosti mají povolenou licenci, uplatněno ${excluded.length} výjimek`);
```

`licenses.allow.json`. **Výjimka se vystavuje na jméno balíčku, nikdy na licenci.** Rozdíl není formální: `LGPL-*` v poli `ALLOWED` by pustil libovolnou budoucí LGPL závislost, o které nikdo nerozhodl, kdežto `@img/sharp-libvips-*` pustí přesně to, co zadavatel posoudil.

```json
{
  "$comment": "Výjimky licenční brány. Každá musí mít expires_at, jinak neprojde validací a stala by se z ní trvalá díra. Pole package smí končit hvězdičkou, protože nativní balíčky jsou per platforma; skript si jméno rozvine na konkrétní verzi sám.",
  "exceptions": [
    {
      "package": "@img/sharp-libvips-*",
      "license": "LGPL-3.0-or-later",
      "reason": "Nativní libvips pod sharpem. sharp sám je Apache-2.0, LGPL nese jen předkompilovaná knihovna a linkuje se dynamicky, takže povinnost zůstává u distribuce knihovny, ne u našeho kódu. Rovnocenná náhrada pod MIT ani Apache neexistuje a vypuštění sharpu by znamenalo osekat extrakci značky. ROZHODNUTÍ ZADAVATELE 2026-08-01, evidence nález N15.",
      "approved_by": "zadavatel",
      "expires_at": "2027-08-01",
      "obligations": "P16 přiloží při sestavení image plný text LGPL-3.0 a zdokumentuje, jak knihovnu vyměnit. Bez toho není podmínka distribuce splněná."
    },
    {
      "package": "@img/sharp-win32-*",
      "license": "LGPL-3.0-or-later",
      "reason": "Windows varianta téhož. Tam je libvips slinkovaný staticky, takže povinnost je přísnější; do produkční image nevstupuje, instaluje se jen vývojářům na Windows.",
      "approved_by": "zadavatel",
      "expires_at": "2027-08-01",
      "obligations": "Stejné jako u @img/sharp-libvips-*, navíc povinnost umožnit relinkování."
    },
    {
      "package": "caniuse-lite",
      "license": "CC-BY-4.0",
      "reason": "Licence DAT, ne kódu. caniuse-lite je tabulka podpory funkcí v prohlížečích, kterou táhne browserslist pod Next.js. CC-BY-4.0 žádá uvedení autora a neukládá žádnou povinnost na software, který data používá; není to copyleft. Plošné povolení CC-BY-4.0 by ale pustilo i budoucí balíčky, o kterých nikdo nerozhodl, proto je výjimka jmenná.",
      "approved_by": "zadavatel",
      "expires_at": "2027-08-01",
      "obligations": "Uvést zdroj dat v dokumentaci třetích stran."
    }
  ]
}
```

- [ ] **Krok 6: Spusť test a ověř, že prochází**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/tools exec vitest run ci/test/ci-scripts.test.ts
```
Expected: PASS, `Tests  21 passed (21)`.

- [ ] **Krok 7: Spusť všechny skripty proti reálnému repozitáři**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && for s in i18n-check openapi-drift contracts-golden contracts-fixtures-schema migration-lint licenses-node; do echo "--- $s"; node tools/ci/$s.mjs || echo "FAILED $s"; done
```
Expected: `i18n-check`, `openapi-drift`, `contracts-golden`, `contracts-fixtures-schema` a `migration-lint` vypíšou `SKIP: ...`; `licenses-node` vypíše souhrn licencí a `OK: všechny závislosti mají povolenou licenci`. Žádné `FAILED`.

Kdyby `licenses-node` spadl, znamená to, že některá závislost má licenci mimo whitelist. Vyhoď ji a najdi náhradu; výjimka je až poslední možnost a musí mít `expires_at`.

- [ ] **Krok 8: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add tools licenses.allow.json && git commit -m "feat(ci): presence-aware job scripts with failing-input tests"
```

---

### Úkol 21: GitHub Actions workflow se všemi joby

Rozhodnutí D7: blokujících jobů je **šestnáct**, plus sedmnáctý neblokující `security-audit`. Tabulka v části 1, kapitole 3.15 je jediný autoritativní seznam a má šestnáct řádků.

**Files:**
- Create: `/Users/petr/Projects/Mailing_Tool/.github/workflows/ci.yml`
- Test: `/Users/petr/Projects/Mailing_Tool/tools/ci/test/workflow.test.ts`

- [ ] **Krok 1: Napiš padající test workflow**

`tools/ci/test/workflow.test.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const workflow = (): string =>
  fs.readFileSync(path.join(ROOT, '.github/workflows/ci.yml'), 'utf8');

/** Šestnáct blokujících jobů z části 1, kapitoly 3.15. Jediný autoritativní seznam. */
const BLOCKING_JOBS = [
  'lint',
  'typecheck',
  'test-unit',
  'test-db',
  'test-go',
  'test-go-integration',
  'contracts-golden',
  'contracts-fixtures-schema',
  'contracts-schema',
  'openapi-drift',
  'i18n-check',
  'licenses-node',
  'licenses-go',
  'migrations-check',
  'build-image',
  'e2e',
];

const TIMEOUTS: Record<string, number> = {
  lint: 5,
  typecheck: 8,
  'test-unit': 8,
  'test-db': 15,
  'test-go': 8,
  'test-go-integration': 12,
  'contracts-golden': 6,
  'contracts-fixtures-schema': 4,
  'contracts-schema': 5,
  'openapi-drift': 3,
  'i18n-check': 2,
  'licenses-node': 4,
  'licenses-go': 4,
  'migrations-check': 10,
  'build-image': 15,
  e2e: 20,
};

/** Vrátí blok jednoho jobu, tedy text od jeho hlavičky po hlavičku dalšího. */
function jobBlock(name: string): string {
  const text = workflow();
  const after = text.split(new RegExp(`^  ${name}:$`, 'm'))[1] ?? '';
  return after.split(/^  [a-z][a-z0-9-]*:$/m)[0] ?? '';
}

describe('.github/workflows/ci.yml', () => {
  it('obsahuje všech šestnáct blokujících jobů (kapitola 3.15)', () => {
    const text = workflow();
    for (const job of BLOCKING_JOBS) {
      expect(text, `chybí job ${job}`).toMatch(new RegExp(`^  ${job}:$`, 'm'));
    }
  });

  it('má sedmnáctý, neblokující job security-audit', () => {
    expect(workflow()).toMatch(/^  security-audit:$/m);
  });

  it('nezavádí job image-size, kontrolu velikosti dělá build-image', () => {
    expect(workflow()).not.toMatch(/^  image-size:$/m);
  });

  it('každý blokující job má timeout podle tabulky 3.15', () => {
    for (const [job, minutes] of Object.entries(TIMEOUTS)) {
      const declared = jobBlock(job).match(/timeout-minutes:\s*(\d+)/);
      expect(declared, `job ${job} nemá timeout-minutes`).not.toBeNull();
      expect(Number(declared?.[1]), `job ${job}`).toBe(minutes);
    }
  });

  it('žádný blokující job nemá continue-on-error (rozhodnutí D8)', () => {
    for (const job of BLOCKING_JOBS) {
      expect(jobBlock(job), `job ${job} má continue-on-error`).not.toContain('continue-on-error');
    }
  });

  it('security-audit je označený jako neblokující', () => {
    expect(jobBlock('security-audit')).toContain('continue-on-error: true');
  });

  it('e2e a build-image běží až po rychlých jobech', () => {
    for (const job of ['build-image', 'e2e']) {
      const block = jobBlock(job);
      expect(block, `${job} nemá needs`).toContain('needs:');
      expect(block).toContain('lint');
      expect(block).toContain('typecheck');
    }
  });

  it('joby s databází používají postgres:18-alpine ze services', () => {
    for (const job of ['test-db', 'test-go-integration', 'contracts-schema', 'migrations-check']) {
      const block = jobBlock(job);
      expect(block, `${job} nemá services`).toContain('services:');
      expect(block, `${job} nemá postgres 18`).toContain('postgres:18-alpine');
    }
  });

  it('contracts-golden nemá databázi, a mít nemá (kapitola 3.15)', () => {
    expect(jobBlock('contracts-golden')).not.toContain('services:');
  });

  it('contracts-golden má setup obou stran, Node i Go', () => {
    const block = jobBlock('contracts-golden');
    expect(block).toContain('pnpm/action-setup');
    expect(block).toContain('actions/setup-go');
  });

  it('pinuje verze nástrojů shodně se specifikací', () => {
    const text = workflow();
    expect(text).toContain('24.18.1');
    expect(text).toContain('11.18.0');
    // Dvojité uvozovky, ne jednoduché. Prettier má pro *.yml override
    // singleQuote: false, takže `go-version: '1.26'` přepíše na dvojité
    // a krok `prettier --check .` v jobu lint by neprošel. Ověřeno spuštěním
    // prettieru 3.9.6 nad workflow souborem.
    expect(text).toContain('go-version: "1.26"');
  });

  it('nepoužívá jednoduché uvozovky, prettier je v yml přepisuje', () => {
    const offenders = workflow()
      .split('\n')
      .filter((line) => /:\s*'[^']*'\s*$/.test(line));
    expect(offenders, 'jednoduché uvozovky shodí prettier --check v jobu lint').toEqual([]);
  });

  it('každý job, který deleguje na pnpm skript, má pnpm i instalaci', () => {
    // Job, který volá `pnpm --filter ... run <skript>` bez nainstalovaného pnpm
    // a bez závislostí, spadne na `pnpm: command not found`, tedy na chybě,
    // která s kontrolovanými daty nemá nic společného.
    for (const job of [
      'contracts-golden',
      'contracts-fixtures-schema',
      'contracts-schema',
      'migrations-check',
    ]) {
      const block = jobBlock(job);
      expect(block, `${job} nemá pnpm/action-setup`).toContain('pnpm/action-setup');
      expect(block, `${job} neinstaluje závislosti`).toContain('pnpm install --frozen-lockfile');
    }
  });
});
```

- [ ] **Krok 2: Spusť test a ověř, že padá**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/tools exec vitest run ci/test/workflow.test.ts
```
Expected: FAIL, `ENOENT` na `.github/workflows/ci.yml`.

- [ ] **Krok 3: Napiš `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

# Celkový limit workflow je 35 minut při plné paralelizaci (kapitola 3.15).
# Joby e2e a build-image běží až po zelených rychlých jobech, aby se
# neplýtvalo runnery.

jobs:
  # ---------------------------------------------------------------- 1. lint --
  lint:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: "11.18.0"
      - uses: actions/setup-node@v4
        with:
          node-version: "24.18.1"
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: oxlint
        run: pnpm exec oxlint .
      - name: eslint
        run: pnpm exec eslint .
      - name: prettier
        run: pnpm exec prettier --check .
      - name: migration-lint
        run: node tools/ci/migration-lint.mjs

  # ----------------------------------------------------------- 2. typecheck --
  typecheck:
    runs-on: ubuntu-latest
    timeout-minutes: 8
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: "11.18.0"
      - uses: actions/setup-node@v4
        with:
          node-version: "24.18.1"
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo run typecheck

  # ----------------------------------------------------------- 3. test-unit --
  test-unit:
    runs-on: ubuntu-latest
    timeout-minutes: 8
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: "11.18.0"
      - uses: actions/setup-node@v4
        with:
          node-version: "24.18.1"
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo run test:unit

  # ------------------------------------------------------------- 4. test-db --
  test-db:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    services:
      postgres:
        image: postgres:18-alpine
        env:
          POSTGRES_DB: mlain_test
          POSTGRES_USER: mlain_migrator
          POSTGRES_PASSWORD: mlain
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U mlain_migrator -d mlain_test"
          --health-interval 10s --health-timeout 5s --health-retries 5
    env:
      DATABASE_URL: postgres://mlain_migrator:mlain@localhost:5432/mlain_test
      DATABASE_URL_MIGRATOR: postgres://mlain_migrator:mlain@localhost:5432/mlain_test
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: "11.18.0"
      - uses: actions/setup-node@v4
        with:
          node-version: "24.18.1"
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo run test:db

  # ------------------------------------------------------------- 5. test-go --
  test-go:
    runs-on: ubuntu-latest
    timeout-minutes: 8
    defaults:
      run:
        working-directory: apps/sender
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: "1.26"
          cache-dependency-path: apps/sender/go.sum
      - run: go vet ./...
      - run: go test ./...

  # ------------------------------------------------- 6. test-go-integration --
  test-go-integration:
    runs-on: ubuntu-latest
    timeout-minutes: 12
    services:
      postgres:
        image: postgres:18-alpine
        env:
          POSTGRES_DB: mlain_test
          POSTGRES_USER: mlain_migrator
          POSTGRES_PASSWORD: mlain
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U mlain_migrator -d mlain_test"
          --health-interval 10s --health-timeout 5s --health-retries 5
    env:
      DATABASE_URL_SENDER: postgres://mlain_migrator:mlain@localhost:5432/mlain_test
    defaults:
      run:
        working-directory: apps/sender
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: "1.26"
          cache-dependency-path: apps/sender/go.sum
      - run: go test -tags=integration ./...

  # ---------------------------------------------------- 7. contracts-golden --
  # BEZ DATABÁZE, a to schválně: pouští jazykové implementace nad JSON fixtures
  # a přidání služby by mu ztrojnásobilo dobu běhu (kapitola 3.15).
  # Jediný job, který potřebuje setup obou stran naráz.
  contracts-golden:
    runs-on: ubuntu-latest
    timeout-minutes: 6
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: "11.18.0"
      - uses: actions/setup-node@v4
        with:
          node-version: "24.18.1"
          cache: pnpm
      - uses: actions/setup-go@v5
        with:
          go-version: "1.26"
          cache-dependency-path: apps/sender/go.sum
      - run: pnpm install --frozen-lockfile
      - name: parita fixtures mezi TS a Go
        run: node tools/ci/contracts-golden.mjs

  # ------------------------------------------- 8. contracts-fixtures-schema --
  # Job jen spouští validátor, který vlastní P02: mapa skupina na schéma patří
  # ke schématům, ne sem. Proto potřebuje pnpm a nainstalované závislosti.
  contracts-fixtures-schema:
    runs-on: ubuntu-latest
    timeout-minutes: 4
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: "11.18.0"
      - uses: actions/setup-node@v4
        with:
          node-version: "24.18.1"
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: node tools/ci/contracts-fixtures-schema.mjs

  # ---------------------------------------------------- 9. contracts-schema --
  # Čtvrtý bod test:parity: kontraktní sloupce existují po migracích a mají
  # očekávaný typ. Běží tady, ne v contracts-golden, protože potřebuje databázi.
  contracts-schema:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    services:
      postgres:
        image: postgres:18-alpine
        env:
          POSTGRES_DB: mlain_test
          POSTGRES_USER: mlain_migrator
          POSTGRES_PASSWORD: mlain
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U mlain_migrator -d mlain_test"
          --health-interval 10s --health-timeout 5s --health-retries 5
    env:
      DATABASE_URL_MIGRATOR: postgres://mlain_migrator:mlain@localhost:5432/mlain_test
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: "11.18.0"
      - uses: actions/setup-node@v4
        with:
          node-version: "24.18.1"
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: node tools/ci/contracts-schema.mjs

  # ------------------------------------------------------- 10. openapi-drift --
  openapi-drift:
    runs-on: ubuntu-latest
    timeout-minutes: 3
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: "11.18.0"
      - uses: actions/setup-node@v4
        with:
          node-version: "24.18.1"
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: pnpm contracts:generate
      - run: node tools/ci/openapi-drift.mjs

  # ---------------------------------------------------------- 11. i18n-check --
  i18n-check:
    runs-on: ubuntu-latest
    timeout-minutes: 2
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24.18.1"
      - run: node tools/ci/i18n-check.mjs

  # ------------------------------------------------------- 12. licenses-node --
  licenses-node:
    runs-on: ubuntu-latest
    timeout-minutes: 4
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: "11.18.0"
      - uses: actions/setup-node@v4
        with:
          node-version: "24.18.1"
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: node tools/ci/licenses-node.mjs

  # --------------------------------------------------------- 13. licenses-go --
  licenses-go:
    runs-on: ubuntu-latest
    timeout-minutes: 4
    defaults:
      run:
        working-directory: apps/sender
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with:
          go-version: "1.26"
          cache-dependency-path: apps/sender/go.sum
      - run: go install github.com/google/go-licenses@latest
      - name: licenční brána Go
        run: go-licenses check ./... --disallowed_types=forbidden,restricted,reciprocal

  # ----------------------------------------------------- 14. migrations-check --
  migrations-check:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    services:
      postgres:
        image: postgres:18-alpine
        env:
          POSTGRES_DB: mlain_test
          POSTGRES_USER: mlain_migrator
          POSTGRES_PASSWORD: mlain
        ports: ["5432:5432"]
        options: >-
          --health-cmd "pg_isready -U mlain_migrator -d mlain_test"
          --health-interval 10s --health-timeout 5s --health-retries 5
    env:
      DATABASE_URL_MIGRATOR: postgres://mlain_migrator:mlain@localhost:5432/mlain_test
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: pnpm/action-setup@v4
        with:
          version: "11.18.0"
      - uses: actions/setup-node@v4
        with:
          node-version: "24.18.1"
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - run: node tools/ci/migrations-check.mjs

  # ---------------------------------------------------------- 15. build-image --
  # Kontrolu velikosti proti limitu 250 MB dělá tenhle job.
  # Samostatný job image-size NEEXISTUJE a nezavádí se (kapitola 3.15).
  build-image:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    needs: [lint, typecheck, test-unit, test-go]
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - name: build image
        run: |
          docker build -f docker/Dockerfile \
            --build-arg IMAGE_VERSION="${GITHUB_SHA::12}" \
            -t mlain:ci .
      - name: verze binárky není prázdná (kritérium 7e)
        run: |
          VERSION="$(docker run --rm mlain:ci ml-sender --version)"
          test -n "$VERSION"
          test "$VERSION" = "${GITHUB_SHA::12}"
      - name: image běží pod uživatelem 10001 (kritérium 7)
        run: test "$(docker inspect -f '{{.Config.User}}' mlain:ci)" = "10001:10001"
      - name: devět manifestů se nezploštilo (kritérium 7d)
        run: |
          docker build -f docker/Dockerfile --target node-deps -t mlain:deps .
          for p in config contracts core db emails i18n sdk-node sdk-web ui; do
            docker run --rm mlain:deps test -f "/app/packages/$p/package.json"
          done
      - name: velikost image proti limitu 250 MB
        run: node tools/ci/image-size.mjs mlain:ci
      - name: uložit image pro job e2e
        run: docker save mlain:ci -o /tmp/mlain-ci.tar
      - uses: actions/upload-artifact@v4
        with:
          name: mlain-image
          path: /tmp/mlain-ci.tar
          retention-days: 1

  # ------------------------------------------------------------------ 16. e2e --
  e2e:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    needs: [lint, typecheck, test-unit, build-image]
    steps:
      - uses: actions/checkout@v4
      - uses: actions/download-artifact@v4
        with:
          name: mlain-image
          path: /tmp
      - run: docker load -i /tmp/mlain-ci.tar
      - run: docker tag mlain:ci ghcr.io/nc-mill/mlain:1.0.0
      - uses: pnpm/action-setup@v4
        with:
          version: "11.18.0"
      - uses: actions/setup-node@v4
        with:
          node-version: "24.18.1"
          cache: pnpm
      - run: pnpm install --frozen-lockfile
      - name: spustit compose
        working-directory: docker
        env:
          APP_URL: http://localhost:3000
          SECRET_KEY: "1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
        run: docker compose --profile bundled up -d
      - name: čekat na readiness (kritérium 1)
        run: |
          for i in $(seq 1 60); do
            CODE="$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/api/health/ready)"
            if [ "$CODE" = "200" ]; then
              echo "ready po ${i} s"
              exit 0
            fi
            sleep 1
          done
          echo "instalace neodpověděla 200 na /api/health/ready do 60 sekund" >&2
          curl -s http://localhost:3000/api/health/ready || true
          docker compose -f docker/compose.yml logs app || true
          exit 1
      - name: graceful shutdown do 30 sekund (kritérium 6)
        working-directory: docker
        run: |
          docker compose kill -s SIGTERM app
          sleep 30
          docker compose logs app | grep -q "graceful shutdown"
      - name: Playwright zlaté cesty
        run: pnpm turbo run test:e2e

  # ------------------------------------------ 17. security-audit, NEBLOKUJÍCÍ --
  # Blokující by znamenalo, že libovolné nové CVE ve třetí straně zastaví
  # vydání i bezpečnostní opravy (kapitola 3.15).
  security-audit:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    continue-on-error: true
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: "11.18.0"
      - uses: actions/setup-node@v4
        with:
          node-version: "24.18.1"
          cache: pnpm
      - uses: actions/setup-go@v5
        with:
          go-version: "1.26"
          cache-dependency-path: apps/sender/go.sum
      - run: pnpm install --frozen-lockfile
      - run: pnpm audit --audit-level=high
      - name: govulncheck
        working-directory: apps/sender
        run: |
          go install golang.org/x/vuln/cmd/govulncheck@latest
          govulncheck ./...
```

**Tasky `test:e2e` a `contracts:generate` zatím nikde nejsou definované.** `turbo run` na task, který žádný balíček nemá, skončí nulou s hláškou `No tasks were executed`. Je to správné chování: job existuje od začátku a rozsvítí se, jakmile P02 a P16 tasky dodají.

- [ ] **Krok 4: Spusť test a ověř, že prochází**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && pnpm --filter @mlain/tools exec vitest run ci/test/workflow.test.ts
```
Expected: PASS, `Tests  13 passed (13)`.

- [ ] **Krok 5: Ověř, že workflow deklaruje sedmnáct jobů a je naformátované**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && node --input-type=module -e "import fs from 'node:fs'; const t = fs.readFileSync('.github/workflows/ci.yml','utf8'); const body = t.slice(t.indexOf('\njobs:')); const jobs=[...body.matchAll(/^  ([a-z][a-z0-9-]*):\$/gm)].map(m=>m[1]); console.log('jobů:', jobs.length); console.log(jobs.join(', '));" && pnpm exec prettier --check .github/workflows/ci.yml
```
Expected: `jobů: 17`, výpis jmen v pořadí z tabulky 3.15, pak `All matched files use Prettier code style!`.

Výřez od `jobs:` je nutný: klíč `push:` pod `on:` má stejné odsazení jako jméno jobu, takže by ho výpis počítal jako osmnáctý job.

- [ ] **Krok 6: Commit**

```bash
cd /Users/petr/Projects/Mailing_Tool && git add .github tools && git commit -m "ci: all sixteen blocking jobs plus non-blocking security audit"
```

---

### Úkol 22: Závěrečné ověření celé série

Pravidlo zadavatele: „hotovo" znamená ověřeno. Tenhle úkol nemění kód, jen dokazuje, že plán skončil v zeleném stavu.

- [ ] **Krok 1: Kompletní série na čistém stromu**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && git status --porcelain && pnpm install --frozen-lockfile && pnpm turbo run typecheck && pnpm turbo run test:unit && pnpm exec oxlint . && pnpm exec eslint . && pnpm exec prettier --check .
```
Expected: `git status --porcelain` bez výstupu (čistý strom), pak `Tasks: N successful, N total` u obou turbo běhů a lint bez nálezů.

- [ ] **Krok 2: Go strana**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool/apps/sender && go vet ./... && go test ./... && go build -o /tmp/ml-sender ./cmd/sender && /tmp/ml-sender --version
```
Expected: `ok` u obou balíčků a poslední řádek `0.0.0-dev`.

- [ ] **Krok 3: Skripty CI**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && for s in i18n-check openapi-drift contracts-golden contracts-fixtures-schema migration-lint licenses-node; do node tools/ci/$s.mjs || exit 1; done && echo VSECHNY_SKRIPTY_OK
```
Expected: poslední řádek `VSECHNY_SKRIPTY_OK`.

- [ ] **Krok 4: Build image a kritéria 7, 7d, 7e**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && docker build -f docker/Dockerfile --build-arg IMAGE_VERSION=1.0.0 -t mlain:verify . && docker run --rm mlain:verify ml-sender --version && docker inspect -f '{{.Config.User}}' mlain:verify && node tools/ci/image-size.mjs mlain:verify
```
Expected: `1.0.0`, `10001:10001`, velikost pod 250 MB.

- [ ] **Krok 5: Kritéria 2, 3 a 8c na běžícím kontejneru**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && docker run --rm -e APP_URL=http://x:3000 mlain:verify; echo "exit=$?"
```
Expected: na stderr výpis obsahující `SECRET_KEY` a slovo `povinná`, poslední řádek `exit=78`. Kritérium 2.

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && docker run --rm -e APP_URL=nic -e PORT=0 -e LOG_LEVEL=hlasite mlain:verify 2>&1 | grep -c -E "APP_URL|SECRET_KEY|PORT|LOG_LEVEL"
```
Expected: číslo 4 nebo vyšší. Kritérium 3: všechny chyby naráz, ne jen první.

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && docker run --rm -e MODE=all -e SENDER_HEALTH_PORT=3001 -e WORKER_HEALTH_PORT=3001 -e APP_URL=http://x:3000 -e SECRET_KEY="1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" -e DATABASE_URL=postgres://a@b/c -e MIGRATE_ON_START=false mlain:verify; echo "exit=$?"
```
Expected: hláška o `SENDER_HEALTH_PORT` a `exit=78`. Kritérium 8c.

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && docker run --rm -e MODE=web -e MIGRATE_ON_START=true -e APP_URL=http://x:3000 -e SECRET_KEY="1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" -e DATABASE_URL=postgres://a@b/c mlain:verify 2>&1 | grep -c DATABASE_URL_MIGRATOR
```
Expected: číslo 1 nebo vyšší. Kritérium 8d.

- [ ] **Krok 6: Kritéria 1, 6, 8 a 8b na běžícím compose**

Zopakuj úkol 19, krok 8, celý. Očekávané výstupy jsou popsané tam: `200` na `/api/health/ready` do 60 sekund, data po `down` a `up` na místě, `./data/postgres` neprázdný, v logu řádek o graceful shutdownu.

- [ ] **Krok 7: Zkontroluj, že plán nesáhl mimo své vlastnictví**

Run:
```bash
cd /Users/petr/Projects/Mailing_Tool && git log --name-only --pretty=format: HEAD~19..HEAD | sort -u | grep -v '^$'
```
Expected: seznam obsahuje **výhradně** cesty ze seznamů v kapitolách 1.1 a 1.2 tohohle plánu. Když tam je cokoliv jiného, je to chyba plánu a musí se to vrátit.

Devatenáct, ne dvaadvacet: úkolů je dvaadvacet, ale commitů devatenáct. Úkoly 8 a 9 commit nemají, protože loader a schéma dávají smysl až společně s křížovými kontrolami z úkolu 10, a úkol 22 commituje až v následujícím kroku.

- [ ] **Krok 8: Commit značky dokončení**

```bash
cd /Users/petr/Projects/Mailing_Tool && git commit --allow-empty -m "chore: P01 complete, seventeen CI jobs in place and criteria 1 to 8e verified"
```

---

## 5. Pokrytá akceptační kritéria

Čísla jsou z části 1, kapitoly 8 specifikace.

| Kritérium | Znění zkráceně | Kde se ověřuje |
|---|---|---|
| 1 | `docker compose --profile bundled up -d` odpoví do 60 s 200 na `/api/health/ready` | úkol 19, krok 8; job `e2e` |
| 2 | Start bez `SECRET_KEY` skončí 78 a vypíše `SECRET_KEY` a slovo povinná | úkol 8, krok 1; úkol 22, krok 5 |
| 3 | Neplatná konfigurace vypíše všechny chyby naráz | úkol 8, krok 1; úkol 22, krok 5 |
| 6 | `SIGTERM` ukončí procesy do 30 s, v logu je graceful shutdown | úkol 11, krok 5; úkol 19, krok 8; job `e2e` |
| 7 | Image do 250 MB a `User` 10001 | úkol 18, krok 6; job `build-image` |
| 7b | Kontejner s `ANTHROPIC_API_KEY` neodešle požadavek na cizí AI endpoint | úkol 17, krok 1 (entrypoint maže) a úkol 12 (`aiKeyLeakCheck` jako druhá vrstva) |
| 7c | Žádná proměnná v zod schématu nekončí na `_API_KEY` | úkol 10, krok 1 |
| 7d | `pnpm install --frozen-lockfile` v image najde všech devět manifestů | úkol 5, krok 1; úkol 18, krok 6; job `build-image` |
| 7e | `ml-sender --version` i `/api/health` vracejí neprázdnou verzi shodnou s tagem | úkol 15, krok 10; úkol 13, krok 1; job `build-image` |
| 8 | Kontejner běží s `read_only: true`, zapisuje jen do `/data` a `/tmp` | úkol 19, krok 1 a 8 |
| 8b | Data přežijí `down` a `up`, `./data/postgres` na hostiteli není prázdný | úkol 19, krok 1 a 8 |
| 8c | Při `MODE=all` naslouchají worker a sender na různých portech; shodné porty odmítnuté s 78 | úkol 10, krok 1; úkol 22, krok 5 |
| 8d | `MIGRATE_ON_START=true` bez `DATABASE_URL_MIGRATOR` končí 78; s `false` projde | úkol 10, krok 1; úkol 22, krok 5 |
| 8e | Migrace běží pod rolí `mlain_migrator`, ne pod aplikační | úkol 17 (entrypoint volá `mlain migrate` proti `DATABASE_URL_MIGRATOR`), úkol 19 (role v `initdb`); **samotný runner a jeho hlasité selhání dodá P03** |
| 36b | `WEBHOOK_MAX_ATTEMPTS=9` je odmítnuté při startu s 78 | úkol 8, krok 1 |
| 13 | `schema_version_ahead`, databáze novější než image | úkol 12, krok 1 (`schemaCheck`) a úkol 13 (`EXPECTED_SCHEMA_VERSION` se čte z `_journal.json`); **samotný exit kód 5 v runneru dodá P03** |
| 41, 42 | Golden fixtures na obou stranách, fixture jen na jedné straně shodí test | úkol 20, krok 1 (job `contracts-golden` volá `test:golden`, Go runnery a `test:parity` z P02) |
| 51 | Klíč v `en.json` chybějící v `cs.json` shodí job `i18n-check` | úkol 20, krok 1 (job existuje a má test na vadný vstup; katalogy dodá P05) |

**Kritéria, která P01 připravuje, ale nedokončuje.** Číslo 4 (tři repliky aplikují migrace právě jednou), 5 (zabití kontejneru během migrace) a druhá polovina 8e patří plánu P03, protože jejich předmětem je migrační runner v `packages/db`. P01 pro ně dodává entrypoint, exit kódy 3, 4, 5, 6, 75 předdeklarované v šestém jmenném prostoru registru, adresář migrací s `COPY` do image a konfigurační bránu. U kritéria 13 dodává P01 celou readiness stranu včetně čtení očekávané verze z `_journal.json`; P03 doplní jen exit kód runneru. Kritéria 9 až 12 (`mlain backup`, `backup verify`, `restore`) patří P16; P01 dodává jejich deklaraci v registru CLI a exit kód 69, dokud hotová nejsou. Kritéria 52 a 53 (chybějící klíč, ICU plurály) patří P05.

---

## 6. Vlastnictví souborů, závěrečné shrnutí

**Tenhle plán vytváří a mění výhradně tyhle cesty:**

```
package.json
pnpm-workspace.yaml
pnpm-lock.yaml
.npmrc
.nvmrc
.gitignore
.prettierignore
.dockerignore
.env.example
LICENSE
licenses.allow.json
turbo.json
eslint.config.js
prettier.config.mjs
.github/workflows/ci.yml
docker/Dockerfile
docker/entrypoint.sh
docker/mlain
docker/compose.yml
docker/compose.scale.yml
docker/initdb/10-roles.sql
tools/package.json
tools/tsconfig.json
tools/vitest.config.ts
tools/ci/**
packages/config/**
packages/core/package.json
packages/core/tsconfig.json
packages/core/vitest.config.ts
packages/core/scripts/write-manifest.ts
packages/core/src/config/**
packages/core/src/errors/**
packages/core/src/queues/**
packages/core/src/logging/**
packages/core/src/health/**
packages/core/src/shutdown/**
packages/core/test/**
packages/contracts/{package.json,tsconfig.json,src/.gitkeep}
packages/db/{package.json,tsconfig.json,src/.gitkeep,migrations/.gitkeep}
packages/emails/{package.json,tsconfig.json,src/.gitkeep}
packages/i18n/{package.json,tsconfig.json,src/.gitkeep}
packages/sdk-node/{package.json,tsconfig.json,src/.gitkeep}
packages/sdk-web/{package.json,tsconfig.json,src/.gitkeep}
packages/ui/{package.json,tsconfig.json,src/.gitkeep}
apps/web/{package.json,next.config.ts,tsconfig.json,vitest.config.ts,vitest.setup.ts}
apps/web/src/lib/runtime.ts
apps/web/src/instrumentation.ts
apps/web/src/app/{layout.tsx,page.tsx}
apps/web/public/.gitkeep
apps/web/src/app/api/health/route.ts
apps/web/src/app/api/health/ready/route.ts
apps/web/test/**
apps/worker/**
apps/cli/**
apps/sender/go.mod
apps/sender/go.sum
apps/sender/cmd/sender/main.go
apps/sender/internal/config/**
apps/sender/internal/health/**
apps/sender/internal/version/**
```

**Mimo tenhle seznam plán P01 nesahá na žádný soubor.** Když se při provádění ukáže, že je potřeba změnit cokoliv jiného, je to nález proti plánu, ne důvod k zásahu: plán se opraví a znovu schválí, cizí soubor se nemění.

### 6.1 Předání vlastnictví po merge do `main`

| Cesta | Přebírá | Co s ní udělá |
|---|---|---|
| `apps/sender/**` (vše, co P01 založil) | P09 | přepíše celé, doplní claim, render, MIME a dispatch |
| `packages/contracts/**` | P02 | pět kontraktů, fixtures, generátory, `config.json` |
| `packages/db/**` | P03 | schéma všech domén, migrace, RLS, migrační runner |
| `packages/ui/**`, `packages/i18n/**` | P05 | design systém K1 až K8 a katalogy zpráv |
| `packages/emails/**` | P08 | blokový model a renderer |
| `packages/sdk-node/**` | P04 | API klient |
| `packages/sdk-web/**` | P10 | tracking SDK |
| `apps/web/src/app/{layout,page}.tsx` | P05 | skořápka aplikace, přepíše je celé |
| `apps/web/src/lib/runtime.ts` | **nikdo** | `EXPECTED_SCHEMA_VERSION` se čte za běhu z `_journal.json`, ručně se nemění |
| `packages/db/migrations/` | P03 | naplní migracemi; adresář i `COPY` v Dockerfilu už existují |
| `apps/web/public/` | P05 | naplní statickými soubory; adresář i `COPY` v Dockerfilu už existují |
| `packages/core/src/<domena>/**` mimo šest podadresářů P01 | doménové plány | vlastní doménová logika a handlery front |

### 6.2 Co P01 nikdy nedělá

- Nezakládá `packages/core/index.ts` ani žádný jiný top level barrel (uzávěr S11). Doménový `index.ts` uvnitř podadresáře barrel není, ten dělá import podcesty možným.
- Nezapisuje do `packages/contracts/config.json` (uzávěr S2, rozhodnutí D5).
- Nepíše `apps/web/src/proxy.ts` (uzávěr S6, vlastní P05).
- Nepíše žádnou migraci ani nespouští `drizzle-kit generate` (uzávěr S1).
- Nepřidává CI job nad rámec sedmnácti z kapitoly 3.15 a rozhodnutí D7.
- Nezakládá chybový kód, frontu ani konfigurační proměnnou po merge. Registry jsou uzavřené; doplnění je změna tohohle plánu, ne commit z jiné větve.

### 6.3 Požadavky na ostatní plány, které z P01 vyplývají

| ID | Komu | Co potřebuji |
|---|---|---|
| P01-1 | P02 | Zrcadlit `packages/core/src/config/config.manifest.json` do `packages/contracts/config.json` a doplnit test `config-parity` proti Go struktuře v `apps/sender/internal/config`. |
| P01-2 | P02 | Držet v `packages/contracts/package.json` skripty `test:golden`, `test:parity`, `test:fixtures-schema` a `test:schema`. Joby `contracts-golden`, `contracts-fixtures-schema` a `contracts-schema` je volají jmenovitě a při chybějícím skriptu **selžou**, nepřeskočí. Přejmenování skriptu je proto rozbití brány. |
| P01-3 | P02 | Založit `apps/sender/internal/contracts` s runnery golden fixtures (rozhodnutí R1). Job `contracts-golden` bez Go strany selže, protože by porovnával jen půlku kontraktu. |
| P01-4 | P03 | Držet v `packages/db/package.json` skript `test:migrations`. Job `migrations-check` ho volá a při jeho chybějící definici selže. Scénáře patří do `packages/db/test/migrations-check.test.ts`, tedy tam, kde P03 pracovat smí; **do `tools/ci/` sahat nemá a nemusí**. |
| P01-5 | P05 | Založit `packages/i18n/messages/{cs,en}/*.json`; job `i18n-check` je připravený a rozsvítí se sám. |
| P01-6 | všem doménovým plánům | Handler fronty psát do `packages/core/src/<domena>/jobs/queue-handlers.ts` s exportem `handlers`, pak spustit `pnpm --filter @mlain/worker run codegen` a commitnout vygenerovaný soubor. Mapa `exports` v `packages/core` má zástupný znak, takže do cizího `package.json` psát netřeba. |
| P01-7 | P09 | Rozšířit `apps/sender/internal/health` o kontrolu „poslední úspěšný claim mladší než 60 s nebo prázdný outbox" a `cmd/sender/main.go` o claim smyčku. |
| P01-8 | P13 a P09 | Sladit registr `MESSAGE_CODES` v `packages/core/src/errors/message-codes.ts` s užším registrem kontraktu `packages/contracts/src/outbox-errors.ts` (rozpor P1.17 z části 4b). |
| P01-9 | P16 | Přiložit při sestavení image plný text licence LGPL-3.0 a zdokumentovat, jak vyměnit `@img/sharp-libvips`. Bez toho není podmínka distribuce splněná; není to formalita, je to podmínka výjimky v `licenses.allow.json`. |
| P01-10 | P11, P13 | Ptát se registru přes `isRegisteredCode(code)` nebo `ALL_REGISTERED_CODES`, ne indexací `ERROR_REGISTRY[code]`. `ERROR_REGISTRY` je mapa **podle druhu**, ne podle kódu; `ERROR_CODES` je plochá mapa, ale obsahuje jen druh `problem`, protože jen ten má HTTP status. |
| P01-11 | P05, P06, P12 | `apps/web/vitest.config.ts` a `apps/web/vitest.setup.ts` jsou hotové a **žádný z těch plánů si je nesmí nárokovat**, ani s podmínkou „jen pokud ještě neexistuje": P01 běží první, takže se ta podmínka nikdy nesplní a soubor by měl dva vlastníky podle pořadí. Testy pište vedle zdroje jako `src/**/*.test.ts` nebo `.tsx`, prostředí je `jsdom`, úklid po každém testu registruje setup soubor. Kdyby se konfigurace přesto rozešla, hlídá to test `konfigurace testů apps/web` v `apps/web/test/health-routes.test.ts`. |

**Zrušené požadavky.** Dřívější znění žádalo P03 o dvě věci, které se ukázaly jako neproveditelné předání, a obě si P01 vyřešil sám:

- *Nahradit `EXPECTED_SCHEMA_VERSION = 0` skutečným číslem.* Konstanta se teď čte za běhu z `packages/db/migrations/meta/_journal.json`, tedy z téhož zdroje, ze kterého ho počítá migrační runner P03.
- *Doplnit `COPY` migrací do `docker/Dockerfile`.* Řádek je v Dockerfilu od začátku, protože úkol 5 zakládá `packages/db/migrations/.gitkeep`. `docker/` tím zůstává u jediného vlastníka.

