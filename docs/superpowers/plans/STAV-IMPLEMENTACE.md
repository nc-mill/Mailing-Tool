# Stav implementace MVP

**Poslední revize: 2026-08-06.** Co je tenhle dokument: popis prostředí, ve kterém MVP
běží teď, a seznam toho, co v implementaci zbývá. Hledej v něm porty, databáze, přihlašovací
údaje pro ruční ověřování a odškrtnutý seznam nedodělků. Průběžný seznam úkolů dne je jinde,
v `docs/superpowers/STAV-UKOLU.md`.

Zahájeno: 2026-08-01. Řídí hlavní agent, subagenti nesahají na git.

Cíl: funkční MVP, na které jde kliknout.

## Pravidla provedení

- Pracuje se v hlavním adresáři `/Users/petr/Projects/Mailing_Tool` na větvi `main`.
  Worktree nejsou potřeba, protože všechny paralelní agenty řídí jeden orchestrátor
  a vlastnictví souborů je disjunktní.
- Subagent nesahá na git, nespouští `pnpm install` na kořeni a nepíše mimo svůj adresář.
- Hlášení subagenta není doklad. Ověřuje se stav souborů a zelené testy.
- Nálezy, které přesahují jeden plán, se zapisují do `NALEZY-NAPRIC-PLANY.md`.

## Prostředí

Ověřeno 2026-08-06 spuštěním.

- Node: výchozí `node` z Homebrew je **24.2.0**, ale v kegu `node@24` i v `$HOME/.n` je
  **24.18.1**, kterou vyžaduje jsdom. Proto se pracuje s
  `export PATH=/opt/homebrew/opt/node@24/bin:$PATH`.
- pnpm 10.30.1, Go 1.26.5 (darwin/arm64).
- TypeScript je v celém workspace 5.9.3.
- Docker běží. Kontejnery: `mlain-dev-pg` (postgres:18-alpine, port **55432**),
  `mlain-test-pg` (port 32768) a `mlain-syscheck-mailpit` (SMTP 2525, UI 8225).
- **Dev server: `apps/web` na portu 3200**, `curl http://localhost:3200/api/health` vrací 200.
  Na portu 3100 neposlouchá nic.

### Dvě databáze na jednom kontejneru, a je to past

Na `mlain-dev-pg` jsou **dvě databáze, `mlain` a `mlain_clean`**. Rozdíl je podstatný, protože
v každé jsou jiní uživatelé i jiné projekty.

| | `mlain` | `mlain_clean` |
|---|---|---|
| Projektů | 1 | 3 |
| Účty | `dev@mlain.test` | tři jiné účty, mezi nimi vlastníkův osobní |
| Používá běžící server | **ne** | **ano** |

**Běžící dev server jede nad `mlain_clean`.** Ověřeno 2026-08-06 přes `pg_stat_activity`:
deset spojení role `mlain_app`, dvě role `mlain_sender` a jedno migrátorské, všechna do
`mlain_clean`, žádné do `mlain`.

**Past, na které uvízli dva agenti za jeden den:** `apps/web/.env.local` má ve všech třech
`DATABASE_URL*` databázi `mlain`. **Podle env souboru se tedy nedá poznat, nad čím server
opravdu jede**, protože běžící proces byl nastartovaný dřív a s jiným nastavením. Jediné
spolehlivé ověření je podívat se do `pg_stat_activity`, nebo si vložit relaci a zkusit
`/api/v1/auth/me`.

## Vývojový účet pro ruční ověřování

```
e-mail:  dev@mlain.test
heslo:   Vyvojove-Heslo-2026-Mlain
projekt: preflight-projekt (owner)
```

> **Tenhle účet je v databázi `mlain`, ne v `mlain_clean`, takže na běžícím serveru
> nefunguje.** Přihlášení vrátí „E-mail nebo heslo nesedí", ačkoli heslo je správné, jen
> do jiné databáze. Ověřeno 2026-08-06: `mlain` obsahuje právě jeden účet, `dev@mlain.test`,
> a v `mlain_clean` není.
>
> Kdo potřebuje projít aplikaci ručně nad běžícím serverem, ať si vyžádá přihlášení
> od hlavního agenta. Ať nezakládá další účty a hlavně nemění hesla:
> `mlain reset-password` ruší všechny relace uživatele a vyhodí z prohlížeče ostatní,
> kdo zrovna pracují.

Účet je oddělený schválně. Uživatel `p06-preflight@example.com` patří preflight
testu P06 a jeho heslo se mění podle toho, co ten test očekává, takže se na něj
u ručního zkoušení nedá spolehnout.

Přihlášení funguje koncem na konec přes prohlížeč, ověřeno 2026-08-02. Když nejde, zkontroluj
nejdřív rate limiter (hláška „Zkoušíte to příliš často"), je v paměti a vynuluje
se restartem dev serveru.

## Jak aplikaci rozjet znovu

```
docker start mlain-dev-pg
export PATH=/opt/homebrew/opt/node@24/bin:$PATH
cd apps/web && pnpm exec next dev --port 3200
curl http://localhost:3200/api/health
```

**Pozor na databázi.** Bez zásahu si server vezme `DATABASE_URL` z `apps/web/.env.local`,
tedy databázi `mlain`, ne `mlain_clean`, nad kterou jede dnes běžící proces. Kdo chce
navázat na dnešní stav dat, musí `DATABASE_URL*` přesměrovat na `mlain_clean`.

## Historický snímek: stav k 2026-08-02, druhá vlna oprav

Následující dvě sekce popisují stav ke **2. 8. 2026** a od té doby se neaktualizovaly.
Nechávají se kvůli dohledatelnosti, ne jako popis současnosti.

**Neplatí od 2026-08-06: „Práce NENÍ zacommitovaná, poslední commit je `11e0b10`."**
Od té doby přibyly čtyři commity, poslední je `e594ee2` („Paper design across every screen,
and eight bugs the measuring found"). V pracovním stromu leželo 2026-08-06 ráno
123 rozpracovaných souborů.

### Kompletní série byla 2026-08-02 celá zelená

**Čísla níž jsou snímek z 2026-08-02 a od té doby se neověřovala.** Padly na ně čtyři commity,
takže se braly jako doklad dnešního stavu jen po novém běhu. Na tomhle stroji se celá série
nespouštěla schválně, protože je vytížený.

```
typecheck            15 z 15 balíčků
test:unit            13 z 13 balíčků, 6278 testů

  @mlain/core        3902 (+1 přeskočený)
  @mlain/web         1297 (+10 přeskočených)
  @mlain/ui           366
  @mlain/emails       342
  @mlain/contracts    107
  tools/ci             85
  @mlain/worker        58
  @mlain/i18n          46
  apps/cli             37
  @mlain/config        24
  @mlain/db            14

brány                8 z 8 (i18n-check, openapi-drift, contracts-golden,
                     contracts-fixtures-schema, contracts-schema,
                     migration-lint, migrations-check, licenses-node)
eslint, prettier     čisté
```

K číslu balíčků: 2026-08-06 má skript `typecheck` čtrnáct balíčků a `test:unit` třináct.
Rozdíl proti „15 z 15" se nedohledal a není za ním nic ověřeného, jen se to nesmí číst
jako dnešní počet.

`contracts-schema` a `migrations-check` se odmítají spustit bez databáze a je to
tak správně navržené. Ověřeny proti vlastní zahozené databázi, ne přeskočeny.

### Co se v téhle vlně dodělalo

- **Suppression list se vymáhá** na všech zápisových cestách, ne jen na jedné.
  Podle pravidla 4.1.2 se požadavek neodmítá, přeskok nese varování v odpovědi
  a zápis do auditu. Odvolání souhlasu prochází vždy, blokuje se jen udělení.
- **Výmaz podle článku 17 doběhne.** Přibylo `DATABASE_URL_GDPR` a produkční
  kompoziční kořen; test hlídá SKUTEČNÉ VOLÁNÍ `installConsentEraser()`.
- **Denní retence maže.** Cronový tik rozešle úlohu po projektech s rozprostřením
  do tří hodin. Jedna úloha na projekt, aby pád jednoho nesebral retenci ostatním.
- **Extrakce značky funguje.** Doména dostala zápisovou část, továrnu závislostí
  i kompoziční kořen. Záměrně červený `ai/wiring.test.ts` zezelenal SÁM, jeho
  tvrzení se nezmírňovala (ověřeno diffem: mimo komentáře beze změny).
- **Všechny fronty domény kontaktů mají obsluhu.**
- **Chybějící projekt v serverových akcích** je uzavřený jako třída, hlídá to
  test s meta-tvrzením, že jeho výčet pokrývá všechny exportované akce.
- **Vypínač brzd přihlašování pro vývoj**, viz níž.
- Obě dřív červené brány spraveny (I93).

### Vývojářský vypínač brzd přihlašování

```
LOGIN_THROTTLING_DISABLED=true
```

Do `apps/web/.env.local`, pak restart dev serveru. Vypíná TŘI mechanismy:
limity přihlašovacích cest, zamykání účtu po neúspěších a časovou podlahu
odpovědi. Ověřování hesla se NEDOTÝKÁ.

Pojistky: výchozí hodnota je vypnuto, v produkčním režimu se aplikace se
zapnutým vypínačem NESPUSTÍ (chyba konfigurace, exit 78, ověřeno měřením)
a při každém startu se o něm píše varování do logu.

Ověřeno 2026-08-06, že přepínač v kódu i v `.env.example` pořád je
(`packages/core/test/config/cross-checks.test.ts` hlídá obě polohy). V dnešním
`apps/web/.env.local` **nastavený není**.

## Hotovo z dřívějšího seznamu nedodělků

- **I95, brána proti driftu OpenAPI, HOTOVO** (ověřeno 2026-08-06 čtením
  `tools/ci/openapi-drift.mjs`). Brána si dokument vyrábí sama: volá
  `pnpm --filter @mlain/web run contracts:generate` napřímo, mimo turbo (turbo úloha měla
  špatné `outputs` a při zásahu cache se nespustila vůbec), a teprve čerstvý výstup porovná
  s commitnutým souborem. Chybějící generátor je FAIL, ne tiché přeskočení.
- **I96, krok brány spouštěl neexistující test, HOTOVO** (ověřeno 2026-08-06 čtením
  `tools/ci/contracts-golden.mjs`). Filtr už nemíří na `./internal/contracts/...`, ale na
  `./internal/...`, kde testy `TestGolden*` opravdu žijí (`internal/token`,
  `internal/credentials`, `internal/liquidx`, `internal/markers`, `internal/mimebuild`,
  `internal/outbox`). Reporty se před během smažou a po každém kroku se ověřuje, že
  skutečně vznikly, takže se úspěch neposuzuje podle návratového kódu.
- **Fronty segmentů (P11) a většina front trackingu (P10) obsluhu MAJÍ.** Ověřeno
  2026-08-06 v `apps/worker/test/handler-coverage.test.ts`: `segments.mark_invalid`,
  `segments.recalc_for_contact`, `event.process` i `tracking.enforce_retention`
  ze seznamu nedodaných zmizely.
- **Produkční image se postavila.** V lokálním registru je `ghcr.io/nc-mill/mlain:1.0.0`,
  281 MB, vytvořená 2026-08-03. Dockerfile je v `docker/Dockerfile`. Že se image staví
  neznamená, že se změřila; měření po poslední vlně doloženo není.

## Co zbývá dodělat

1. **Tvar fixtures se možná rozchází s generátorem** (I96). `packages/contracts/fixtures/`
   je v `.prettierignore` (ověřeno 2026-08-06, i s odůvodněním, že golden soubory se
   neformátují). Původní tvrzení bylo, že commitnutý tvar se od výstupu generátoru
   `packages/contracts` → `contracts:generate` liší jen formátováním, takže každé spuštění
   generátoru rozbije paritu. **Neověřeno**, protože ověřit to znamená spustit generátor,
   který přepisuje soubory v pracovním stromu, a ten je dnes rozpracovaný.
2. **`outbox.reconcile` zůstává bez obsluhy**, potvrzeno 2026-08-06 v
   `packages/core/src/campaigns/jobs/queue-handlers.ts`. **Důvod se ale posunul:** výčet
   projektů už chybějící není, `systemReconcileScan()` ho pod rolí `mlain_maintenance` umí.
   Chybí druhá polovina, `reconcile(workspaceId)`, protože `revokePending` pracuje nad
   kampaní, ne nad projektem. Doplnit znamená rozhodnout, které kampaně projektu se
   rekonciliují a v jakém pořadí. Fronta je vedená přes `needsDependencies`, takže
   o ní je nahlas vidět.
3. **Fronty bez modulu jobu.** Ověřený seznam k 2026-08-06 podle
   `apps/worker/test/handler-coverage.test.ts`:
   - P08 obsah a šablony: `content.revalidate_templates`, `content.cleanup_versions`
   - P13 outbox a provideři: `provider_event.process`, `provider_event.rematch`,
     `deliverability.rollup`
   - Obsluha existuje, ale nejdou složit závislosti: `provider.refresh_quota`
     (repozitář má zdroj jen pro dva z osmi `ProviderSignals`), `domain.recheck`
     (výčet domén napříč projekty pod rolí `mlain_app` RLS nepustí)
   - Vědomě bez obsluhy s důvodem: `tracking.refresh_proxy_ranges`, `tracking.erase_contact`
   - **P09 sender v tomhle seznamu nikdy nebyl** a dřívější znění ho tam uvádělo omylem.
4. **Zlatá cesta v prohlížeči** (P16 E2E). **Neověřeno**, jestli po posledních změnách
   projde celá. Specifikace existují v `apps/web/e2e/golden/specs/`: `golden-path.spec.ts`,
   `first-run.spec.ts`, `backup-restore.spec.ts`, `demo-data.spec.ts`, `trial-mode.spec.ts`.
   Ověřit znamená spustit Playwright, což se na vytíženém stroji nedělalo.
5. **Změření produkční image po poslední vlně.** Image existuje z 2026-08-03, ale doklad
   o měření velikosti a startu po commitech `bab2967` a `e594ee2` není.

## Dev data, na která pozor

Kontakty `petr.novy@example.cz` a `jana.test2b@example.cz` vznikly při testování ještě před
opravou I91.

**Upřesněno 2026-08-06 dotazem do databáze:** oba jsou **jen v databázi `mlain`**, tedy v té,
nad kterou běžící dev server nejede, takže dnes nikoho netrápí. `greeting` mají vyplněné
na neutrální „Dobrý den", prázdný je `first_name_vocative`. Původní znění mluvilo o „prázdném
oslovení", což bylo nepřesné. Kdo bude na `mlain` pracovat, stačí je otevřít a uložit.
