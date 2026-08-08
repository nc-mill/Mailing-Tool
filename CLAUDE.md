# Mlain Mailer

Samohostovaný nástroj na e-mailový marketing pro české firmy. Monorepo pnpm + turbo,
Next.js 16 + Go + PostgreSQL 18. Texty, komentáře a dokumentace česky, identifikátory anglicky.

**V tomhle projektu se commituje rovnou na `main`, feature větve se nedělají.** Vědomě to
přebíjí globální pravidlo branch-first. Commit a push jen na výslovný pokyn.

Předpoklady: Node `>=24.15 <25` (níž spadne CELÁ instalace, `.npmrc` má `engine-strict`),
pnpm 10.30.1, Go 1.26, **klient PostgreSQL přesně 18** (starší `pg_dump` shodí zálohy i testy).

## Architektura

- `apps/web` Next.js 16 App Router, obrazovky i veřejné API na Honu. Trasy
  `src/app/[locale]/w/[workspaceSlug]/…`, veřejné pod `(public)/`, doména v `src/features/*`.
- `apps/worker` fronty pg-boss, běží z bundlovaného `dist/main.js`.
- `apps/sender` odesílací služba v Go, jediná část mimo TypeScript i mimo pnpm a turbo,
  čte outbox a volá SES/SMTP.
- `apps/cli` příkaz `mlain`: migrace, zálohy, obnova, `doctor`, oddíly, rotace klíče.
- `packages/`: `core` (doménová logika), `db` (schéma, migrace, RLS), `contracts` (kontrakty
  a golden fixtures sdílené s Go), `ui`, `i18n`, `emails`, `config`, `sdk-*`.

Tři procesy, tři role v databázi: `DATABASE_URL` (`mlain_app`, podléhá RLS),
`DATABASE_URL_MIGRATOR` (migrace, zálohy, oddíly), `DATABASE_URL_SENDER`.
**Kampaň odešle jen web + worker + sender dohromady**, samotný `next dev` ji neodešle.

## Konvence

- **Import z `@mlain/*` jen přes `exports` mapu.** V `packages/core/package.json` mapuje
  `"./*": "./src/*/index.ts"`, tedy JEDNU úroveň. Hlubší podcesta přeloží, ale za běhu se
  nerozloží. Uvnitř domény se importuje relativně, nikdy přes vlastní barrel.
- **Z klientské komponenty nikdy barrel domény.** `@mlain/core/contacts` táhne přes pět
  souborů až na `@node-rs/argon2` a build spadne. Importuj cíleně na konkrétní čistý modul.
- Hranice balíčků hlídá `PACKAGE_GRAPH` v `packages/config/src/package-graph.ts`
  (`import/no-restricted-paths`). Nová hrana mezi balíčky patří nejdřív tam.
- Transakce jen přes obálky v `packages/db/src/repo/tx.ts`: `withWorkspace`, `withUser`,
  `withoutContext`, `withReadOnly`. Nikdy `drizzle(pool).transaction()`.
- **Izolace projektů stojí na RLS**, ne na `WHERE workspace_id`. Kontext nastavuje
  `set_config('mlain.workspace_id', …, true)` v transakci. Výjimky jsou vyjmenované
  v `packages/db/src/rls.ts`.
- Kód chyby Postgresu čti jen přes `pgErrorCode()`, Drizzle ho dává na `error.cause.code`.
- Migrace: hlavička `-- mlain:timeout=120` a komentářový blok CO BYLO ŠPATNĚ / CO SE ZAPÍŠE /
  PROČ. `now()` mimo `DEFAULT` je zakázané (hlídá `tools/ci/migration-lint.mjs`).
  Dělené tabulky se píšou ručně, `src/schema/partitioned.ts` NESMÍ být v `drizzle.config.ts`.
- Server action ve `features/*/actions.ts` je tenká proxy přes `apiFetch`/`apiMutate` na interní
  API. Validace (zod `.strict()`) žije v `packages/core/src/**/*.routes.ts`. `workspaceId` je
  povinný parametr, jinak RLS vrátí nic a UI ukáže 404 na existující záznam.
- Testy: `*.test.ts` jednotkový, `*.db.test.ts` chce běžící Postgres. Celý stroj sdílí JEDEN
  kontejner `mlain-test-pg`, každý soubor si bere vlastní databázi přes `CREATE DATABASE
  … TEMPLATE`. Soubor sahající na `apps/web/test/api/pg-harness.ts` musí mít na PRVNÍM řádku
  `// @vitest-environment node`.
- Zdroj pravdy pro i18n je `en`, ne `cs`. Čeština potřebuje u čísel kategorii `many`.
- `apps/worker/src/handlers.generated.ts` se needituje ručně, vyrábí ho `codegen.mjs` z modulů
  `packages/core/src/**/jobs/queue-handlers.ts`. Nová doména s frontou bez codegenu znamená
  chybějící handler a úlohu, která visí bez chyby.
- Kontrakty sdílené s Go: fixtures v `packages/contracts/fixtures`, obě strany je implementují
  nezávisle a `scripts/check-parity.ts` porovnává OBA reporty proti fixturám, ne proti sobě.
- Primární ani destruktivní akce nesmí být `disabled`, patří tam `unavailableReason`
  (vlastní pravidlo lintu). V `core/src/brand` a `core/src/templates` se ven chodí jen `safeFetch`.

## Postup práce

- Živý seznam úkolů je `docs/superpowers/STAV-UKOLU.md`, archiv hotového `docs/superpowers/HOTOVO.md`.
  **HOTOVO.md přečti dřív, než začneš něco opravovat**, je v něm, co se už jednou naměřilo.
- Plány patří do `docs/superpowers/plans/`.
- Vývojová databáze běží v kontejneru `mlain-dev-pg` na portu **55432**.
- Dev server webu poslouchá na `PORT`, Playwright si port odvozuje z `APP_URL`. Nesouhlas
  znamená dva servery nad jedním `.next`: stránky vracejí 200, ale React se nenamountuje.
- Roste-li počet kontejnerů, pusť `tools/dev/uklizec-kontejneru.sh`.

## Ověřování

`pnpm test` NEEXISTUJE, kořenový `package.json` ho nemá. Skutečné příkazy:

```sh
pnpm typecheck
pnpm lint                       # oxlint + eslint + prettier --check
pnpm test:unit
pnpm test:db                    # chce Docker
pnpm test:e2e
node tools/ci/migration-lint.mjs
cd apps/sender && go vet ./... && go test ./...   # Go je mimo turbo, pnpm ho nespustí
```

Celou sadu pouštěj s `--concurrency=1`, jinak úklid testů občas spadne na `57P01`.

**Po každé změně importů z `@mlain/*` v `apps/web` spusť `npx next build` v `apps/web`.**
Typecheck ani `test:unit` tuhle třídu vad nechytí ANI JEDNU (viz Pasti).
Build se pouští jako `NODE_ENV=production next build`, jinak se postaví rozbitá aplikace.

CI (`.github/workflows/ci.yml`) navíc pouští `go vet`/`go test` v `apps/sender`, paritu
kontraktů TS proti Go, drift OpenAPI, kontrolu i18n a migrací, licenční brány a build image.
Před commitem stojí za to projet aspoň `tools/ci/*.mjs`, které se týkají změněné oblasti.

## Odkazy k dočtení

- `README.md` je nejúplnější zdroj o rozjezdu, portech, rolích a provozních příkazech.
- `docs/operations/` provozní runbooky (zálohy, rotace klíče, upgrade, oddíly a retence).
- `docs/superpowers/plans/` implementační plány P01 až P17.
- Historické, NEplatné jako zadání: `docs/PRAMENY.md`,
  `docs/superpowers/plans/NALEZY-NAPRIC-PLANY.md` (snímek k 3. 8.),
  `docs/operations/p16-nalezy.md` (snímek k 2. 8.).

## Poučení

- **Nejčastější vada tohohle projektu je „napsané, otestované, nezapojené".** Když něco projde
  testy, ale za běhu se to neprojeví, podezřívej nejdřív zapojení, ne logiku.
- **Zelená sada není důkaz.** Pojistka bývá slepá ve stejném místě jako kód: pomocník, který
  umí jen jednu variantu vstupu, udělá celou sadu slepou. U existujícího testu porovnej JMÉNO
  s tím, co skutečně tvrdí, rozpor je nález.
- Odeslaná pošta se ověřuje na běžícím systému, ne testy. Dotazem do databáze po prokliku.
- Velikost práce popisuj věcně (co je potřeba změnit), ne v hodinách ani dnech.

## Pasti

- **Worker, Go sender i `.next` běží ze SESTAVENÝCH artefaktů.** Dev server webu čte
  `packages/core` ze zdrojů, fronty a odesílání ne. Než prohlásíš cokoli za ověřené na běžícím
  systému, zkontroluj stáří artefaktu (`ls -la` na `dist/main.js`, na binárce senderu,
  `BUILD_ID` v `.next`). Restart dělá hlavní agent, ne subagent.
- **Typecheck nechytí špatný import z `@mlain/*`.** Dvě pasti: hluboká podcesta mimo `exports`
  mapu a barrel v klientské komponentě. Chytí je až `npx next build`.
- **Středník uvnitř literálu v raw `sql` výrazu rozbije `drizzle-kit generate`.** Uřízne
  `CREATE TABLE` uprostřed a vyrobí nespustitelnou migraci, snapshot přitom vypadá v pořádku.
  Do literálu středník nepiš (např. `chr(59)`).
- **Registrace z `apps/web/src/instrumentation.ts` je pro obsluhu trasy neviditelná** (jiný
  modulový graf). Řeš líným sestavením při prvním použití, viz
  `packages/core/src/platform/system-mail-runtime.ts`.
- **Playwright: před každým úkonem `page.bringToFront()`.** Ve sdíleném prohlížeči dojdou
  kliknutí jen do aktivní záložky, jinak mlčky nedělají nic a vypadá to jako vada aplikace.
- **Systémová pošta umí jen SMTP.** Instalace s jediným účtem typu SES neodešle pozvánku ani
  obnovu hesla, i když kampaně chodí. Náhrada je `mlain reset-password`.
- Fronta s politikou `short` omezuje jen stav `created`, ne `active`. Dvě úlohy tak mohou
  běžet souběžně nad týmž klíčem.
- Zálohy se musí dělat pod rolí migrátora, pod aplikační rolí by RLS vyrobila tiše prázdné
  tabulky. `mlain partitions` si musíš sám zapsat do plánovače, jinak retence neběží.
