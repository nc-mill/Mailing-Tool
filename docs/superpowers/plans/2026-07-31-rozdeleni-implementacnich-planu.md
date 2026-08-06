# Rozdělení implementace na plány

<!-- puvod-dokumentu -->
> **Historický záznam, ne platné zadání.** Zápis z 31. 7. 2026 o tom, proč se práce rozřezala
> na šestnáct plánů podle vlastnictví souborů. Popisuje rozhodnutí té doby, ne dnešní organizaci práce:
> dnes se pracuje z jednoho adresáře, bez worktree, a přibyly plány, které tady nejsou (P17 a dál).
> **Vlny 0 až 3 proběhly**, kód všech šestnácti plánů v repozitáři je.
> **Dnešní stav:** `docs/superpowers/STAV-UKOLU.md` (živý dokument), design `docs/superpowers/DESIGN-INTEGRACE.md`.

Datum: 2026-07-31
Vstup: sedm specifikací v `docs/superpowers/specs/parts/` (32 tisíc řádků) a hlavní specifikace
Výstup: 16 implementačních plánů v `docs/superpowers/plans/`, které jdou provádět paralelně ve worktree

---

## 1. Podle čeho je to rozřezané

Specifikace jsou rozdělené na sedm částí podle **domén**, protože je psalo sedm lidí a každý potřeboval ucelené téma. Implementace se ale nedělí podle domén, ale podle **vlastnictví souborů**, a to je jiné dělení.

Důvod je jednoduchý. Dva agenti ve dvou worktree jsou dva paralelní zápisy do jednoho repozitáře. Když oba potřebují změnit `packages/db/src/schema/contacts.ts`, není to úkol pro dva agenty, ať se to nakrájí jakkoliv chytře. Merge konflikt v migraci navíc není běžný konflikt: obě strany jsou syntakticky v pořádku a git je spojí do schématu, které nikdy nikdo nenavrhl.

Proto platí jediné řídicí pravidlo:

> **Každý soubor v repozitáři má právě jeden plán, který ho smí vytvořit a měnit. Ostatní plány ho jen čtou.**

Z toho plyne všechno ostatní, včetně toho, proč je vlna 0 tak velká a proč se dělá sekvenčně.

### 1.1 Co z toho vyplývá pro UI

Část 6 (UI a UX, 5144 řádků) **není pracovní balík a nesmí se stát jedním plánem.** Je to průřezový referenční dokument: popisuje obrazovky napříč všemi doménami, mikrotexty, chybové hlášky, přístupnost a lokalizaci. Kdyby jeden agent dělal "všechno UI", byl by úzkým hrdlem celé implementace a zároveň by musel sáhnout do každé domény.

Rozpouští se proto takto:

| Kapitola části 6 | Kam patří |
|---|---|
| 4. Informační architektura | vlna 0, plán P05 (registr navigace celý dopředu) |
| 5. Zpětná vazba na akce | vlna 0, plán P05 (jeden mechanismus, ne sedm) |
| 6. Nevratné akce | vlna 0, plán P05 |
| 7. Stavy obrazovek | vlna 0, plán P05 |
| 10. Chybové hlášky | vlna 0, P05 (vzhled) a P01 (registr kódů) |
| 11. Přístupnost | vlna 0, P05 (základ) a každý plán u svých obrazovek |
| 12. Lokalizace | vlna 0, P05 (infrastruktura a `common`), jinak každý plán svůj namespace |
| 13. Design systém, komponenty K1 až K8 | vlna 0, plán P05 |
| 8. Klíčové obrazovky | rozpuštěno do doménových plánů, viz tabulka v kapitole 4 |

Obrazovka jde tedy vždy do stejného plánu jako API, které ji obsluhuje. Je to vertikální řez: plán končí funkční, prokliknutelnou věcí, ne polotovarem, který čeká na někoho jiného.

---

## 2. Seznam sdílených míst a jak se každé uzavírá

Tohle je jádro celého návrhu. Prošel jsem specifikace a vypsal každé místo, kam by přirozeně chtělo psát víc plánů. Ke každému je uzávěr, tedy pravidlo, které konflikt odstraní ještě předtím, než vznikne.

| # | Sdílené místo | Kdo by tam psal | Uzávěr |
|---|---|---|---|
| S1 | `packages/db` schéma, migrace, `meta/_journal.json` | všechny domény | **Celé schéma všech domén píše jediný plán P03, dopředu.** Doménové plány schéma jen importují. Nikdo jiný nespustí `drizzle-kit generate`. |
| S2 | `packages/contracts` | části 1, 3, 4a, 4b, 5 | Jediný plán P02. Kontrakt je zmrazený, mění se jen formálním rozmrazením, ne v rámci implementace. |
| S3 | `packages/ui` | každá obrazovka | Jediný plán P05, a musí dodat **všech osm komponent K1 až K8** plus primitiva kompletně. Neúplný design systém je nejhorší možný výsledek: agenti si začnou dopisovat vlastní komponenty do sdíleného balíčku. |
| S4 | Katalogy i18n | všechny domény | Rozdělené na **namespace po doménách**: `packages/i18n/messages/{cs,en}/<domena>.json`. P05 dodá strukturu, `common`, ICU pravidla a CI job `i18n-check`. Každý plán pak vlastní právě svůj soubor. |
| S5 | Registr navigace | všechny domény | P05 zapíše **celý strom dopředu** podle části 6, kapitola 4, včetně sedmé položky rezervované pro Automatizace, která se v MVP 0 nezobrazuje. Doménový plán navigaci nerozšiřuje, jen naplní cestu. |
| S6 | `apps/web/src/proxy.ts` | auth, i18n, tracking | Jeden soubor, píše ho P05 jednou a se všemi matchery. Pozor na název: Next.js 16 přejmenoval `middleware.ts` na `proxy.ts` a exportovanou funkci na `proxy`. Dřívější verze tohohle dokumentu uváděla starý název, viz část 1, kapitola 3.9 a rozpor R6. |
| S7 | Registr chybových kódů | všechny | P01 předdeklaruje **všechny kódy ze všech sedmi specifikací** naráz. Doménový plán kód používá, nezakládá. |
| S8 | Registr front pg-boss | všechny | P01 předdeklaruje všechny fronty ve tvaru `<domena>.<akce>`. Handler si každá doména píše do svého souboru, entrypoint workeru je jen složí. |
| S9 | `openapi.json` (commitnutý, hlídá ho job `openapi-drift`) | každý plán s endpointem | Soubor se **nikdy neslučuje ručně**. Při konfliktu se zahodí obě verze a přegeneruje se. Zapsat do plánů jako pravidlo, jinak to někdo bude mergovat po řádcích. |
| S10 | `docker/`, `turbo.json`, CI workflow | teoreticky každý | Výhradně P01. Kdo potřebuje nový CI job nebo build krok, dostane ho do P01 dopředu, ne za běhu. |
| S11 | Barrel exporty `packages/core/index.ts` | všechny | **Barrely se nezakládají.** Importuje se podcesta, `@mlain/core/contacts`. Barrel je sdílený soubor s jedním řádkem na doménu, tedy konflikt v každém plánu. |
| S12 | Konfigurační zod schéma | všechny | P01 zapíše **všechny proměnné ze všech částí** naráz (část 1, kapitola 4.9 má úplnou tabulku). |
| S13 | Seed a ukázková data | kontakty, kampaně, šablony | Jediný plán P16, až nakonec, kdy existuje všechno, co se má naplnit. |

Když se některý uzávěr poruší, projeví se to jako merge konflikt, což je ještě ta lepší varianta. Horší je tichá varianta: dvě migrace se spojí do schématu, které nikdo nenavrhl, a spadne to až u zákazníka.

---

## 3. Vlny a jejich pořadí

```
VLNA 0 (základ, převážně sekvenčně)
  P01 kostra, provoz, konfigurace, CI
       │
       ├──────────────┬───────────────────────────┐
       ▼              ▼                           ▼
  P02 kontrakty   P05 design systém,        (P05 nečeká na DB)
       │              i18n, skořápka
       ▼
  P03 databáze
       │
       ▼
  P04 jádro API a identita (backend)

VLNA 1 (paralelně, pět plánů)
  P06 nastavení a přístupy (UI k P04)
  P07 kontakty, souhlasy, vokativ, suppression
  P08 šablony: blokový model, renderer, kompilace
  P09 sender (Go)
  P10 tracking: tokeny, sběr událostí, web SDK

VLNA 2 (paralelně, tři plány)
  P11 import, export, segmenty        [po P07]
  P12 editor šablon                   [po P08, P05]
  P13 kampaně, provideři, outbox      [po P07, P08]

VLNA 3 (paralelně, tři plány)
  P14 reporty, dashboard, časová osa  [po P10, P13]
  P15 AI asistent                     [po P08, P12]
  P16 onboarding, provoz, zálohy, ukázková data, E2E zlaté cesty  [po všech]
```

**Proč je vlna 0 sekvenční.** Kopíruje graf závislostí balíčků, který je závazný z části 1: `contracts → nic`, `db → contracts`, `core → db, contracts, i18n`. Pokusit se to paralelizovat znamená psát proti balíčku, který ještě nemá tvar. Jediná legitimní paralela ve vlně 0 je P05, protože design systém na databázi nesahá.

**Proč sender může do vlny 1.** Sender je v Go a podle části 1 nesmí importovat nic z Node světa, jen `packages/contracts/fixtures` jako testovací data. Jakmile existuje zmrazený kontrakt (P02) a schéma (P03), je sender úplně nezávislý na zbytku produktu. Je to nejlépe izolovaný plán ze všech a měl by startovat co nejdřív, protože je zároveň nejrizikovější.

**Proč P08 (renderer) a P12 (editor) nejsou jeden plán.** Blokový model a renderer jsou čistá logika bez UI, testovatelná bez prohlížeče, a závisí na nich kampaně (P13). Editor je 3000 řádků UI a nezávisí na něm nic. Kdyby byly spolu, blokovaly by kampaně o dobu psaní editoru.

---

## 4. Kam se rozpustily obrazovky z části 6, kapitoly 8

| Obrazovka | Kapitola | Plán |
|---|---|---|
| 8.1 První spuštění a onboarding | 8.1.1 až 8.1.5 | P16 |
| 8.1.4 Ukázková data | | P16 |
| 8.2 Nastavení odesílání a DNS záznamy | 8.2.1 až 8.2.10 | P13 |
| 8.3 Import kontaktů, včetně kontroly oslovení | 8.3.1 až 8.3.8 | P11 |
| 8.4 Segment builder | 8.4.1 až 8.4.6 | P11 |
| 8.5 Editor šablony | 8.5.1, 8.5.2 | P12 |
| 8.5.3 AI asistent, 8.5.4 Extrakce značky | | P15 |
| 8.6 Odeslání kampaně | 8.6.1 až 8.6.4 | P13 |
| 8.7 Report kampaně | 8.7.1 až 8.7.5 | P14 |
| 8.8 Přehled kontaktu a časová osa | 8.8.1 | P07 (přehled), P14 (osa) |
| 8.9 Veřejné stránky pro příjemce | | P07 |
| 8.10.1 Blokované adresy | | P07 |
| 8.10.2 Formuláře | | P07 |
| 8.10.3 Souhlasy a žádosti podle GDPR | | P07 |
| 8.10.4 Příchozí webhooky | | P07 |
| 8.11 Přehled a Statistiky | 8.11.1, 8.11.2 | P14 |
| Přihlášení, setup, profil, členové, klíče, webhooky, audit | část 1, kap. 5.3 | P06 |

Časová osa (K8) je komponenta, ne obrazovka, a používá se třikrát (kontakt, kampaň, audit log). Vlastní ji P05, plní ji P14.

---

## 5. Zadání jednotlivých plánů

U každého plánu je uvedeno, co vlastní, co jen čte, ze kterých kapitol čerpá a která akceptační kritéria musí pokrýt. Plán, který sáhne mimo své vlastnictví, je chybný plán.

### VLNA 0

#### P01 Kostra, provoz, konfigurace a CI
- **Vlastní:** kořen repa (`package.json`, `pnpm-workspace.yaml`, `turbo.json`), `packages/config`, `docker/` (Dockerfile, entrypoint, compose), `.github/workflows`, registr chybových kódů, registr front pg-boss, zod schéma konfigurace, kostra CLI `mlain`, health endpointy, graceful shutdown, přepínač `MODE`.
- **Čte:** všech sedm specifikací kvůli úplnému výčtu chybových kódů, front a konfiguračních proměnných.
- **Zdroje:** část 1, kapitoly 3.11, 3.12, 3.15, 4.9; hlavní specifikace 4.1.
- **Kritéria:** část 1, kapitola 8, body 1 až 8e (instalace a provoz).
- **Pozor:** patnáct CI jobů z 3.15 musí existovat od začátku, i když zatím nemají co kontrolovat. Job doplněný později znamená, že se do té doby mergovalo bez brány.

#### P02 Kontrakty a golden fixtures
- **Vlastní:** `packages/contracts` celý, `apps/sender/internal/contracts`, `apps/sender/testdata` (symlink), runnery fixtures na obou stranách, CI joby `contracts-golden`, `contracts-fixtures-schema`.
- **Čte:** část 1, kapitola 4.10 celá (4.10.1 až 4.10.5).
- **Obsah:** pět kontraktů (outbox protokol, Liquid subset, formát trackovacích tokenů, šifrování credentials, značky pro tracking), 54 Liquid fixtures, scénáře `OB-xx` včetně `OB-00`, testovací vektory tokenů a krypto obálek.
- **Pozor:** `OB-00` je scénář, který **jen spustí claim dotaz proti reálné databázi.** Je tam proto, že dřívější verze kontraktu obsahovala SQL, které se nedalo vykonat, a kontrola grepem to nezachytila. Kontrakt bez spustitelného testu není kontrakt.

#### P03 Databáze: schéma, migrace, RLS
- **Vlastní:** `packages/db` celý. Schéma **všech** domén naráz, migrace, RLS politiky, role a granty včetně `sender_bypass` a sloupcových grantů, partitioning, repository základ, migrační nástroj a jeho zamykání.
- **Čte:** datové modely ze všech sedmi částí (kapitoly 2 nebo 3 podle části).
- **Kritéria:** část 1, body 20, 21, 21b; scénáře migrací z 3.13.
- **Pozor:** u partitionovaných tabulek je primární klíč složený (`id, created_at`) a **každý odkaz musí nést obě složky.** Sender čte pod vlastní rolí, takže ke každé politice musí existovat test, který ověří, že sender skutečně vidí řádky. Ochrana, jejíž jediné vynucení je "implementátor si to přečte", není ochrana.

#### P04 Jádro API a identita (backend)
- **Vlastní:** `packages/core/identity`, `apps/web/src/lib/api` (obálka chyb, stránkování, idempotence, rate limit, verzování, generátor OpenAPI), auth a sessions, workspaces, členství, pozvánky, role a oprávnění, API klíče, vynucení izolace v repository vrstvě, audit log, infrastruktura odchozích webhooků. Endpointy `/api/v1/auth/*`, `/workspaces`, `/members`, `/invitations`, `/api-keys`, `/webhook-endpoints`, `/webhook-deliveries`, `/audit-log`, `/api/v1/setup`.
- **Bez obrazovek.** Ty jsou v P06.
- **Nedotýká se `packages/sdk-node`.** Ten balíček je vědomě prázdný, viz níž.
- **Zdroje:** část 1, kapitoly 3.1 až 3.8, 4.1 až 4.8.
- **Kritéria:** část 1, body 14 až 21b a dál v kapitole 8.

**Poznámka k `packages/sdk-node`.** P01 balíček zakládá a jeho tabulka vlastnictví ho předává
P04. **To je chyba tohohle dokumentu**, protože v zadání P04 jsem `sdk-node` nikdy neuvedl.
Platí: klient pro Node **není v MVP 0**, zlatá cesta ho nepotřebuje a patří k MVP 1 spolu
s kompletním veřejným API. P01 nechá prázdný manifest, což akceptačnímu kritériu na devět
balíčků stačí, a **obsah v MVP 0 nepíše nikdo**.

#### P05 Design systém, i18n a skořápka
- **Vlastní:** `packages/ui` celý (tokeny, primitiva shadcn, **komponenty K1 až K8**), `packages/i18n` (infrastruktura, `common`, ICU, kontrola klíčů), skořápka aplikace (topbar, sidebar, přepínač projektů), **registr navigace celý**, `apps/web/src/proxy.ts` (v Next.js 16 náhrada za `middleware.ts`), `apps/web/playwright.config.ts`, mechanismus zpětné vazby (toast, potvrzení, vrácení akce), stavy obrazovek, vzhled chybového bloku, základ přístupnosti a jeho testy.
- **Zdroje:** část 6, kapitoly 4, 5, 6, 7, 10, 11, 12, 13; část 1, kapitola 5.
- **Kritéria:** část 6, kapitola 15, ta část, která se týká komponent a průřezových mechanismů.
- **Pozor:** tenhle plán je jediný, který smí zakládat soubory v `packages/ui`. Když dodá K1 až K8 neúplně, poznají to všechny další plány naráz a začnou si psát vlastní. Tvrdé požadavky u K1 až K8 v 13.1 jsou normativní, konkrétní balíčky jsou jen doporučení k datu.

### VLNA 1

#### P06 Nastavení projektu a přístupy (UI k P04)
- **Vlastní:** obrazovky `/setup`, `/login`, `/forgot-password`, `/reset-password`, `/invitations/accept`, `/no-workspace`, `/settings/profile`, `/w/{slug}/settings/*` (obecné, členové, API klíče, webhooky, audit), namespace i18n `settings` a `auth`.
- **Čte:** P04 (API), P05 (komponenty).
- **Zdroje:** část 1, kapitola 5.3; část 6 pro stavy, mikrotexty a chyby.

#### P07 Kontakty, souhlasy, vokativ a suppression
- **Vlastní:** `packages/core/contacts`, endpointy `/api/v1/contacts/*`, `/contact-fields`, `/tags`, `/gdpr-requests`, `/inbound/*`, veřejné stránky `/u/{token}`, `/p/{token}`, `/s/c/{token}`, `/r/{token}`, `/f/{slug}`; obrazovky kontaktů, blokovaných adres, formulářů, souhlasů, příchozích webhooků; namespace i18n `contacts`.
- **Bez importu a segmentů.** Ty jsou v P11.
- **Zdroje:** část 2, kapitoly 3, 4, 5, 6; část 6, kapitoly 8.8, 8.9, 8.10.
- **Pozor:** vokativ se počítá **při zápisu**, ne při odeslání. Kontrola otisků v suppression listu prochází **všechna** známá pokolení klíče bez horního stropu; se stropem by se smazaný člověk vrátil prvním dalším importem a nic by neselhalo.

#### P08 Šablony: blokový model, renderer, kompilace
- **Vlastní:** `packages/emails` celý, `packages/core/templates`, blokové JSON schéma, validátor, emitter do HTML přes `@react-email/components`, emitter textové varianty, kompilace do Liquidu, endpointy `/api/v1/templates/*`.
- **Bez editoru.** Ten je v P12.
- **Zdroje:** část 3, kapitoly 2, 3.1 až 3.7, 4.
- **Pozor:** v autorské šabloně **nejsou povolené řetězcové literály**, protože každý React renderer escapuje uvozovky a `{{ x | default: "y" }}` se rozpadne na entity. Náhradní hodnota a formát data se berou z atributů uzlu a doplňují se až po renderu. Otázka operátorů `>` a `<` v podmínkách je otevřená a validátor je do rozhodnutí odmítá.

#### P09 Sender (Go)
- **Vlastní:** `apps/sender` celý.
- **Čte:** jen `packages/contracts/fixtures` a databázové schéma.
- **Zdroje:** část 4b celá; část 1, kapitola 4.10.
- **Kritéria:** scénáře `OB-xx`, kapitola 8 části 4b.
- **Pozor:** nejlépe izolovaný a zároveň nejrizikovější plán. Zápis výsledku musí hlídat `claimed_by`, jinak si dva sendeři přepíšou výsledek. Claim musí výslovnou podmínkou vyloučit nekampáňové zprávy, nestačí spoléhat na vnitřní spojení. Dialekt `osteele/liquid` se od LiquidJS liší, rozdíly jsou v kontraktu.

#### P10 Tracking: tokeny, sběr událostí, web SDK
- **Vlastní:** `packages/core/tracking`, `packages/sdk-web`, endpointy `/t/o/{token}`, `/t/c/{token}`, `/e/track`, `/e/identify`, `/e/v1/batch`, `/api/v1/events`, joby na zpracování událostí, identity resolution.
- **Bez reportů a dashboardu.** Ty jsou v P14.
- **Zdroje:** část 5, kapitoly 3.1 až 3.10.
- **Pozor:** jednorázový identifikační token platí 15 minut a je jednorázový. Ukládání IP a odvozené země je **volba provozovatele**, ne pevné chování. Falešná otevření od Apple se odečítají přepínačem, ne automaticky.

### VLNA 2

#### P11 Import, export a segmenty
- **Vlastní:** `packages/core/segments`, importní pipeline v `packages/core/contacts/import`, export, endpointy `/api/v1/contacts/imports/*`, `/exports`, `/segments/*`, obrazovky průvodce importem (8.3) a segment builderu (8.4), namespace i18n `import` a `segments`.
- **Závisí na:** P07 (model kontaktu), P05 (K2 query builder, K3 průvodce, K4 nahrání souboru).
- **Zdroje:** část 2, kapitoly 4 a 5; část 6, kapitoly 8.3 a 8.4.
- **Pozor:** fronta ke kontrole oslovení je součást importu, ne samostatná funkce. Query builder musí unést hloubku 5, 50 potomků a všech 40 operátorů z matice části 2.

#### P12 Editor šablon
- **Vlastní:** `apps/web` obrazovky editoru, panel vlastností generovaný z descriptorů, přetahování bloků, náhled, namespace i18n `editor`.
- **Závisí na:** P08 (blokový model), P05 (komponenta K6 náhled).
- **Zdroje:** část 3, kapitola 3.3; část 6, kapitoly 8.5.1 a 8.5.2.
- **Rozsah je změřený:** zhruba 3000 řádků při 6 až 8 typech bloků, z toho polovina je panel vlastností, který se generuje z popisu. Rozsah MVP 0 je výslovně omezený tabulkou v části 3 (svislý seznam sekcí ano, volné plátno ne).
- **Pozor:** k přetahování musí existovat rovnocenná klávesová cesta. Nedědí se po knihovně, navrhuje se od nuly.

#### P13 Kampaně, provideři a outbox
- **Vlastní:** `packages/core/campaigns`, `packages/core/providers`, endpointy `/api/v1/campaigns/*`, `/providers/*`, `/api/webhooks/ses/{id}`, materializace publika do outboxu, pojistky doručitelnosti, ovládání kampaně, obrazovky kampaní a nastavení odesílání včetně DNS (8.2), namespace i18n `campaigns`.
- **Závisí na:** P07 (publikum, suppression), P08 (kompilace šablony), P03 (tabulka `messages`).
- **Zdroje:** část 4a celá; část 6, kapitoly 8.2 a 8.6.
- **Pozor:** kontraktní sloupce `messages` vlastní kontrakt, tenhle plán je nesmí měnit, smí jen přidávat sloupce a indexy. Prahy doručitelnosti jdou nastavit **jen směrem k přísnosti**: hodnota z instalace je zároveň výchozí i strop. Výchozí velikost dávky je 100 a je nastavitelná uživatelem.

### VLNA 3

#### P14 Reporty, dashboard a časová osa
- **Vlastní:** agregace pro reporty, `/api/v1/campaigns/{id}/stats`, `/recipients`, `/stream` (SSE), `/api/v1/contacts/{id}/timeline`, `/api/v1/dashboard`, obrazovky reportu kampaně (8.7), přehledu a statistik (8.11), naplnění časové osy (8.8), namespace i18n `reports`.
- **Závisí na:** P10 (události), P13 (kampaně), P05 (K7 grafy, K8 časová osa).
- **Zdroje:** část 5, kapitoly 3.11 až 3.13, 4, 5.
- **Pozor:** hlavní metrika je **proklik, ne otevření.** Klasifikace otevření má tři patra a odečítání falešných otevření je přepínač.

#### P15 AI asistent
- **Vlastní:** `packages/core/ai`, BYOK konfigurace, `extract_brand`, `compose_template` proti blokovému schématu, endpointy `/api/v1/ai/*`, `/brand/extractions`, obrazovky 8.5.3 a 8.5.4, namespace i18n `ai`.
- **Závisí na:** P08 (blokové schéma pro structured output), P12 (kam se výsledek vloží).
- **Zdroje:** část 3, kapitola o AI.
- **Pozor:** kontejner nesmí odeslat požadavek na cizí AI endpoint, dokud projekt nemá vlastní nakonfigurovaný klíč. Je na to akceptační kritérium 7b v části 1 a proměnná nesmí končit na `_API_KEY`, jinak ji entrypoint vymaže.

#### P16 Onboarding, provoz, zálohy, ukázková data a E2E
- **Vlastní:** průvodce prvním spuštěním (8.1), ukázková data (50 kontaktů, hromadně označitelná a smazatelná, totéž u testovacích kampaní), `mlain backup`, `restore`, `doctor`, `upgrade`, `rotate-credentials`, `genkey`, Playwright test zlaté cesty, namespace i18n `onboarding`.
- **Závisí na:** všech ostatních.
- **Zdroje:** část 1, kapitoly 3.14, 3.15; část 6, kapitola 8.1.
- **Pozor:** `mlain doctor` musí hlásit chybějící stará pokolení klíče jako **kritickou** chybu, protože bez nich přestanou platit otisky smazaných adres. Recovery bundle nese celý keyring.

---

## 6. Jak se to provádí ve worktree

Každý plán jedna větev a jeden worktree, založený z `HEAD`, ne ze zastaralého `origin/main`. Do worktree se zkopírují soubory `.env*` a nainstalují závislosti, jinak build spadne.

Pořadí je dané vlnami. Vlna se otevře teprve tehdy, když je předchozí vlna **smergovaná do `main`**, ne jen hotová ve svém worktree. Důvod: plány vlny 1 čtou schéma z P03. Kdyby četly rozpracovanou verzi, každý si přečte jinou.

Po dokončení plánu: merge zpět, smazat worktree i větev, ověřit čistý stav (`git worktree list`, `git branch --merged`). Osiřelé složky vedle projektu se nenechávají.

**Poznámka k pravidlu o práci na `main`.** V tomhle repozitáři se dosud commitovalo přímo na `main`, protože v něm byly jen dokumenty. Paralelní worktree ale bez větví nejdou, takže od začátku implementace platí větev na plán. Je to přesně ta podmínka, se kterou původní rozhodnutí počítalo.

**Git dělá jen hlavní agent.** Subagenti píšou soubory, necommitují, nemergují a nepushují.

---

## 7. Jak vznikají samotné plány

Každý plán má dvě fáze a druhá není volitelná.

1. **Tvorba.** Agent podle dovednosti `superpowers:writing-plans` přečte přidělené kapitoly specifikace a napíše plán do `docs/superpowers/plans/`. Kroky jsou po 2 až 5 minutách, u každého je skutečný kód, ne popis kódu. Bez zástupných textů typu "doplnit ošetření chyb".
2. **Revize.** Na hotový plán se pustí `/replan:replan`, který ho nechá zkontrolovat paralelními recenzenty z několika úhlů a plán podle nálezů upraví.

Plán, který prošel jen fází 1, se nepovažuje za hotový.

### Co musí být v každém plánu

- Přesné cesty souborů, nikdy "někde v core".
- Úplný kód v každém kroku, který kód mění.
- Přesné příkazy a očekávaný výstup, včetně toho, že test má nejdřív spadnout.
- Odkaz na akceptační kritéria ze specifikace, která plán pokrývá, číslem.
- **Výslovný seznam souborů, které plán vlastní**, a věta, že mimo ně nesahá.
- Časté commity.

### Čemu se v plánech vyhnout

Poučení z psaní specifikací, ať se neopakuje v implementaci:

- **Ověřování grepem nestačí.** Kontrola "řetězec je v souboru" neodhalí, že SQL je nespustitelné. Ke každému tvrzení, které jde ověřit spuštěním, patří spuštění.
- **Ke každé ochraně musí existovat mechanismus, který její porušení zachytí automaticky.** Ochrana, jejíž jediné vynucení je "implementátor si to přečte", je přání, ne ochrana.
- **Hlášení agenta není doklad hotové práce.** Ověřuje se skutečný stav souborů a zelené testy.
