---
skill: replan
version: 1.3.1
timestamp: 2026-08-05T00:00:00Z
model: opus
plan_hash: f0ef937
plan_ref:
  kind: path
  value: docs/superpowers/plans/2026-08-05-p17-automatizace.md
security_guidance:
  detected: true
  reason: dir-glob
autonomous_mode: true
lessons_injected_bytes: 0
lessons_truncated: false
---

## Plan summary (first 200 chars)

P17: Automatizace, implementační plán. Automatizační engine Mlain Maileru: vizuální scénář s neměnnými verzemi, běh kontaktu přežívající restart a čekání dlouhé měsíce, spouštěče, uzly čekání, podmínky.

## Agents dispatched

| Agent | Verdikt | Kritické | Důležité | Drobné |
|---|---|---|---|---|
| Soulad s kódem | NÁLEZY | 9 | 12 | 14 |
| Datový model a migrace | NÁLEZY | 8 | 8 | 4 |
| Proveditelnost a rizika | NÁLEZY | 13 | 10 | 6 |
| Čerstvý pohled | NÁLEZY | 14 | 10 | 6 |
| Bezpečnost a GDPR | NÁLEZY | 13 | 7 | 5 |
| Konvence projektu | NÁLEZY | 6 | 9 | 8 |

## Per-agent findings (výběr kritických)

### Soulad s kódem
- chybí klíč v `exports` mapě `packages/core/package.json`, codegen workeru padne na `assertExportsMapCovers()`
- chybí `GRANT SELECT ... TO mlain_maintenance`, sken skončí na `permission denied`
- `insertWebEvents` má `source` jako literál `'email'`, nejde použít beze změny
- pět vs. šest tabulek, rozpor uvnitř dokumentu
- chybí `EXTRA_POLICIES` v `packages/db/src/rls.ts`
- `QueueEntry.domain` je uzavřený `ErrorDomain` bez hodnoty `automations`
- devět existujících testů s pevnými počty se rozbije
- `Rotation.Set()` bere `[]ActiveCampaign`, druhá instance podle projektu není jednoduchá

### Datový model a migrace
- index splatných kroků bez `workspace_id`: naměřeno 166 ms proti 1,4 ms a 45 000 proti 400 bufferům
- totéž u claim indexu na `messages`
- chybí cyklický FK `automations.current_version_id`, a `ON DELETE SET NULL` na něm porušuje vlastní `CHECK` (ověřeno na PG 18.4)
- `ck_messages__kind` bez `NOT VALID` bere `AccessExclusiveLock` na všech oddílech
- `CREATE INDEX CONCURRENTLY` je na partitionované tabulce zakázané, odůvodnění v plánu bylo nepravdivé
- kroky nemají `version_id`, reporty z D19 nejdou postavit
- `maintenance_scan` bez `FOR SELECT` je `FOR ALL`
- retence `automation_run_steps` chybí úplně

### Proveditelnost
- hlavičková kampaň nemá provider, odesílatele ani `unsubscribe_list_id`
- `deleteProvider` maže systémové kampaně natvrdo, `RESTRICT` mazání účtu rozbije
- zkušební režim se obejde, je výchozím stavem nového projektu
- claim s TTL a dávkou 200 může poslat e-mail dvakrát
- `singletonKey` v této instalaci nededuplikuje (fronty bez `policy`)
- šablona uzlu není v modelu definovaná
- náhled a testovací odeslání v plánu nejsou
- čas v testech nejde posunout, žádný `Clock` port neexistuje

### Čerstvý pohled
- pg-boss sekundový cron netiká rychleji než 1x za minutu (`singletonSeconds: 60`, `prevDiff < 60`)
- publikování obchází celý preflight, chybějící odhlašovací odkaz projde
- trigger předchozí verze nikdo nedeaktivuje
- spouštěč otevřením e-mailu se zacyklí přes vlastní výstup
- na otázku „proč nevstoupil" nejde odpovědět
- tvar grafu, hlavní datový model funkce, není v plánu ukázaný
- odhad podstřelený zhruba na polovinu

### Bezpečnost a GDPR
- D16 není „týž predikát jako materializace", chybí čtyři vrstvy
- ukázkové kontakty dostanou ostrou poštu
- potvrzené členství a snooze se nekontrolují vůbec
- `POST /lists/{id}/subscribe:bulk` obejde pojistku proti hromadnému spuštění
- test pojistky hlídá špatný řetězec
- `mlain_maintenance` by viděla per-kontaktní data napříč projekty
- ruční vstup nemá audit, strop ani idempotenci
- tvrzení „v `outcome` nejsou osobní údaje" je nevynutitelné

### Konvence projektu
- plán nemá úkoly s kódem, `subagent-driven-development` na něm nejde spustit
- chybí kapitoly o licencích, akceptačních kritériích a vlastnictví
- seznam cizích souborů je neúplný nejméně o 15 položek
- ICU klíče `timeline.item.*` patří do `reports.json`, ne do `automations.json`
- `TypeScript 7.0.2` v hlavičce je nepravda, repozitář má 5.9.3
- `apps/web/src/server/routes/**` v repozitáři neexistuje
- typografie čistá, 0 výskytů dlouhé pomlčky

## Changes applied to plan

Plán přepsán do verze 2 (1 299 řádků, z 880). Podstatné změny:

- nová kapitola 0 o stavu dokumentu, nové kapitoly 4 (tvar grafu), 6 (způsobilost), 12 (licence), 13 (akceptační kritéria), 16 (vypořádání prověrky)
- kapitola 3 s požadavky na cizí plány zrušena, sloučena do úplného seznamu 1.4 (zhruba 45 souborů včetně devíti testů s pevnými počty), doplněna uzavírací věta o vlastnictví
- rozhodnutí rozšířena z D22 na D31: přibyly D19 (odesílací konfigurace uzlu), D21 (náhled a testovací odeslání), D22 (kopie a stavový stroj), D23 (umístění API), D24 (doména front), D25 (registr odkazů na partitionovanou tabulku), D26 (port do domény kampaní), D27 (mazání provideru), D28 (strop hromadného přihlášení), D29 (měkce smazaný projekt), D30 (osiřelé běhy)
- DDL přepsáno: šest tabulek, `workspace_id` jako první sloupec claim indexů, `version_id` v krocích, cyklický FK s `RESTRICT`, `CASCADE` u hlavičkových kampaní, sloupcový grant, `FOR SELECT`, `NOT VALID` plus `VALIDATE`, chybějící indexy pod cizími klíči, chybějící `CHECK` na výčtech
- D2 opraveno o skutečnou granularitu cronu, D4 o podmíněné dokončení na vlastní claim, D14 o zákaz volného textu v `outcome`, D7 zbaveno rotace podle projektu
- odhad zvýšen z 12 až 16 na 22 až 28 dnů plus 2 dny na rozepsání
- otevřené otázky rozšířeny ze sedmi na deset (O8 segmenty a automatizační e-maily, O9 souhlas s marketingem, O10 retence kroků)
- zamítnuty čtyři nálezy s odůvodněním, zapsané v kapitole 16
