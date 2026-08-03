# Stav implementace MVP

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

- Node v24.2.0 (pro jsdom je v `$HOME/.n` verze 24.18.1), pnpm 10.30.1, Go 1.26.5.
- Docker běží, `postgres:18-alpine` stažená.
- Vývojová databáze: kontejner `mlain-dev-pg`, port 55432, zmigrovaná.
- Dev server: `apps/web` na portu 3100, konfigurace v `apps/web/.env.local` (mimo git).
- TypeScript je v celém workspace 5.9.3, `moduleResolution` je `Bundler`.

## Vývojový účet pro ruční ověřování

```
e-mail:  dev@mlain.test
heslo:   Vyvojove-Heslo-2026-Mlain
projekt: preflight-projekt (owner)
```

Účet je oddělený schválně. Uživatel `p06-preflight@example.com` patří preflight
testu P06 a jeho heslo se mění podle toho, co ten test očekává, takže se na něj
u ručního zkoušení nedá spolehnout.

Přihlášení funguje koncem na konec přes prohlížeč, ověřeno. Když nejde, zkontroluj
nejdřív rate limiter (hláška „Zkoušíte to příliš často"), je v paměti a vynuluje
se restartem dev serveru.

## Jak aplikaci rozjet znovu

```
docker start mlain-dev-pg
cd apps/web && pnpm exec next dev --port 3100
curl http://localhost:3100/api/health
```

## Stav k 2026-08-02, druhá vlna oprav

**Práce NENÍ zacommitovaná.** Poslední commit je `11e0b10`, v pracovním stromu
leží kolem 185 souborů.

### Kompletní série je celá zelená

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

## Co zbývá dodělat

1. **Brána proti driftu OpenAPI negarantuje nic** (I95). Porovnává dva soubory
   na disku a sama negeneruje, takže při zapomenutém generování jsou zastaralé
   oba a brána hlásí OK. Zuby má jen `apps/web/test/api/openapi.test.ts`, který
   sahá na živě sloužený dokument. Brána má generovat sama, nebo to musí CI
   udělat před ní.
2. **Krok brány spouští neexistující test** (I96). `contracts-golden` volá
   `go test -run TestGolden`, jenže žádný test se tak nejmenuje, takže vždycky
   projde s „no tests to run" a Go reporty se NEGENERUJÍ. Ty v repozitáři jsou
   zmrazené artefakty.
3. **Tvar fixtures se rozchází s generátorem** (I96). `packages/contracts/fixtures/`
   je v `.prettierignore`, takže kanonický tvar má určovat generátor, jenže
   commitnutý tvar se od jeho výstupu liší jen formátováním. Každé spuštění
   generátoru proto rozbije paritu.
4. **`outbox.reconcile` zůstává bez obsluhy.** Sken projektů existuje, ale
   `revokePending` pracuje nad kampaní, ne nad projektem. Doplnit znamená
   rozhodnout, které kampaně projektu se rekonciliují a v jakém pořadí.
5. **Fronty jiných domén** bez modulu jobu: P08 obsah a šablony, P10 tracking,
   P11 segmenty, P13 outbox a provideři, P09 sender. Vedou se i s důvodem
   v `apps/worker/test/handler-coverage.test.ts`.
6. **Zlatá cesta v prohlížeči** (P16 E2E) nebyla po těchhle změnách dojetá celá.
7. **Produkční image** se po téhle vlně nestavěla ani neměřila.

## Dev data, na která pozor

Kontakty `petr.novy@example.cz` a `jana.test2b@example.cz` ve vývojové databázi
mají prázdné oslovení. Vznikly při testování ještě před opravou I91. Stačí je
otevřít a uložit.
