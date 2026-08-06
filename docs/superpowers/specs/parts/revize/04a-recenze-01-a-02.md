# Křížová revize: části 1 a 2 očima části 4a

<!-- puvod-dokumentu -->
> **Historický záznam, ne platné zadání.** Křížová revize specifikací z 31. 7. 2026: křížová recenze částí 1 a 2 očima části 4a.
> Nálezy se **zapracovaly zpátky do částí v `parts/`** ještě před psaním plánů, takže dokument popisuje
> tehdejší podobu textů, ne dnešní. Platné znění specifikace je vždycky v `parts/`, ne tady.
> **Stav jednotlivých nálezů neověřen.**
> **Dnešní stav:** `docs/superpowers/STAV-UKOLU.md` (živý dokument), design `docs/superpowers/DESIGN-INTEGRACE.md`.

Recenzent: subagent part4a-kampane (autor části 4a: kampaně, providery, doručitelnost)
Datum: 2026-07-31
Recenzované dokumenty:
- `/Users/petr/Projects/Mailing_Tool/docs/superpowers/specs/parts/01-platforma.md`
- `/Users/petr/Projects/Mailing_Tool/docs/superpowers/specs/parts/02-kontakty.md`

Metoda: dva paralelní recenzenti, jeden na dokument, plus vlastní nezávislé ověření nejrizikovějších míst. Nálezy označené **(vlastní ověření)** jsem dohledal sám v textu obou dokumentů, ne převzal od recenzentů.

Hledal jsem tři věci podle zadání: **mezeru** (nevlastní nikdo), **překryv** (dvě části popisují totéž jinak), **nesplnitelný předpoklad** (část 4a počítá s něčím, co druhá část nedodává v tom tvaru).

---

## Shrnutí

| Závažnost | Část 1 | Část 2 | Celkem |
|---|---|---|---|
| Blokující | 1 | 3 | **4** |
| Vážné | 3 | 3 | **6** |
| Drobné | 1 | 2 | **3** |
| Poznámka (bez nálezu) | 1 | 2 | 3 |
| **Celkem** | **6** | **10** | **16** |

Tři nejzávažnější, seřazené podle toho, jak draze se projeví:

1. **B2: segment s relativním časem se během materializace mění pod rukama.** Neviditelné, projeví se jako „občas nám v kampani někdo chybí" a nikdo to nedohledá.
2. **A1 a B5: `messages.contact_id NOT NULL` versus GDPR job, který ho nuluje.** Spadne až ve chvíli, kdy někdo uplatní právo na výmaz.
3. **B1: část 2 zapisuje do outboxu přímým SQL a používá sloupec `error`, který v kontraktu neexistuje.** Spadne při prvním odhlášení během běžící kampaně.

---

## A. Nálezy k části 1 (platforma)

### A1. `messages.contact_id NOT NULL` versus GDPR job, který ho nuluje (BLOKUJÍCÍ, vlastní ověření)

**Místo:** část 1, kontrakt 4.10.1, ř. 2253 (`contact_id uuid NOT NULL`). Protistrana: část 2, tabulka GDPR akcí, ř. 2537 a příloha ř. 3356.

**Problém:** Kontrakt outboxu deklaruje `contact_id uuid NOT NULL`. Část 2 v jobu `gdpr.sever_links` předepisuje `messages.contact_id = NULL`. **Ten `UPDATE` skončí chybou `null value in column "contact_id" violates not-null constraint`.** Není to teoretický spor o návrh, je to příkaz, který v produkci spadne, a spadne až ve chvíli, kdy někdo uplatní právo na výmaz.

Zároveň je to jediné místo, kde se GDPR výmaz potkává s outboxem, takže se na to nepřijde dřív než v ostrém provozu.

**Jak by to mělo být:** Zvolit jednu ze dvou variant a zapsat ji do kontraktu:

- **Varianta A (doporučuju):** `contact_id` zůstane `NOT NULL` a výmaz se řeší **anonymizací adresy a `render_data`**, ne odstřižením vazby. Statistiky per kampaň zůstávají a `contact_id` ukazuje na kontakt, který už neexistuje (cizí klíč tam podle konvence není, protože do partitionované tabulky nejde). Cena: `contact_id` je pseudonymní identifikátor, což při smazaném kontaktu není osobní údaj.
- **Varianta B:** změnit kontrakt na `contact_id uuid` (nullable) a všechny dotazy části 4a i 4b připravit na `NULL`. Dražší, protože `contact_id` je v claim dotazu i v párování událostí.

Rozhodnout musí část 1, protože vlastní kontrakt, ale **nemůže to zůstat, jak to je**.

---

### A2. Kontrakt povoluje senderu `claimed → skipped` po kontrole suppression, ale granty mu to neumožňují (VÁŽNÉ, vlastní ověření)

**Místo:** část 1, 4.10.1, tabulka přechodů (řádek `claimed → skipped`, důvod „kontrola suppression těsně před odesláním selhala") versus tentýž dokument, blok `GRANT` pro `mlain_sender` (ř. 2461 až 2478).

**Problém:** Přechod předpokládá, že sender umí zjistit, že je adresa na suppression listu. Granty ale dávají senderu `SELECT` jen na `messages`, `campaigns`, `sending_providers`, `campaign_links` a `workspaces`. **Na `suppressions` nemá nic.** Komentář v grantech to dokonce potvrzuje („Žádná práva na contacts…"). Přechod je tedy v kontraktu popsaný, ale neproveditelný.

Je to vnitřní rozpor jednoho dokumentu, ne spor mezi částmi.

**Jak by to mělo být:** Buď doplnit `GRANT SELECT ON suppressions TO mlain_sender` a v kontraktu popsat, že kontrola musí být dávková (`WHERE email = ANY($1)`, ne dotaz na zprávu), nebo řádek `claimed → skipped` z tabulky přechodů odstranit a napsat, že kontrola suppression je výhradně na aplikaci.

Pro část 4a to je rozdíl mezi oknem „desítky sekund" a „jednotky sekund", ve kterém může odejít mail právě odhlášenému člověku (moje kapitola 3.4.3). Preferuju první variantu, ale funguje to i bez ní.

---

### A3. Sender dostal `INSERT` do `message_events`, aniž o tom ví vlastník té tabulky (VÁŽNÉ, vlastní ověření)

**Místo:** část 1, ř. 2471: `GRANT INSERT ON message_events TO mlain_sender;`

**Problém:** `message_events` vlastní část 4a. Grant znamená, že do ní zapisuje i sender, pravděpodobně událost `sent`. Jenže část 4a k té tabulce v mezičase doplnila tři **`NOT NULL` sloupce**, o kterých kontrakt mlčí: `message_created_at`, `recipient` a `rank`. Sender, který je nevyplní, dostane chybu při vložení.

Navíc: pokud sender vkládá `sent`, překrývá se to s událostí `Send` ze SES, kterou zpracovává část 4a. Vznikly by dvě události téhož významu z různých zdrojů.

**Jak by to mělo být:** Rozhodnout, jestli sender do `message_events` zapisuje vůbec. Moje stanovisko: **nemá**. Zapisuje `messages.status = 'sent'` a `provider_message_id`, a událost `sent` v `message_events` vytváří část 4a při zpracování SES eventu `Send`. Tím je jeden zdroj pravdy a sender zůstává hloupý. Pokud se rozhodne opačně, musí kontrakt vyjmenovat všechny povinné sloupce `message_events` a část 4a je nesmí rozšiřovat bez dohody.

---

### A4. Konvence „vždy `PARTITION BY RANGE (created_at)`" je správná a část 4a ji porušovala (VÁŽNÉ, vlastní ověření, už opraveno u mě)

**Místo:** část 1, sekce 2.1, ř. 282: „Vždy `PARTITION BY RANGE (created_at)`, měsíční okna, hranice v UTC." Výčet partitionovaných tabulek na ř. 280.

**Problém:** Nález směřuje hlavně proti mně, ale patří sem, protože ukazuje, že konvence má chybějící zdůvodnění a chybí v ní dvě tabulky.

Část 4a partitionovala `message_events` podle `ts` (čas události u providera) a `provider_event_receipts` podle `received_at`. To je chyba: `ts` je **nemonotónní**, událost od SES může dorazit se zpožděním a nést `ts` z minulého měsíce. Zápis by mířil do partition, kterou už retenční job odpojil, a protože část 1 vědomě nezakládá `DEFAULT` partition (ř. 287), **selhal by**. Opravil jsem to u sebe na `created_at`.

**Jak by to mělo být:** Konvence je správná, ale zaslouží si jednu větu s tímhle zdůvodněním, protože jinak vypadá jako libovolné pravidlo a každý autor si ji poruší tam, kde má „přirozenější" časový sloupec. Zároveň doplnit do výčtu na ř. 280 tabulky `provider_event_receipts` (část 4a) a zkontrolovat, jestli tam nechybí i tabulky ostatních částí.

---

### A5. Rotace `SECRET_KEY` a běžící sender (DROBNÉ, vlastní ověření)

**Místo:** část 1, sekce 3.10, postup rotace, ř. 1179 až 1190.

**Problém:** Postup je promyšlený (`key_id` v obálce, `SECRET_KEY_PREVIOUS`, `mlain rotate-credentials`) a pro aplikaci sedí. Pro sender je krok 3 „`docker compose up -d` restart" jediné místo, které ho zmiňuje, a to jen implicitně. Když sender z jakéhokoliv důvodu nepřevezme nové prostředí (samostatné škálování, `MODE=sender` v jiném compose souboru, ruční restart jen aplikace), poběží dál se starým `SECRET_KEY`, a **jakmile `mlain rotate-credentials` přešifruje `sending_providers` na `key_id = 2`, sender přestane umět dešifrovat konfiguraci uprostřed běžící kampaně**. Chyba bude `crypto_unknown_key` u každé zprávy.

**Jak by to mělo být:** Doplnit do postupu rotace explicitní větu, že krok 3 musí restartovat **i všechny instance senderu**, a doporučit pořadí: nejdřív rozdat `SECRET_KEY_PREVIOUS` všem procesům, teprve potom pustit `rotate-credentials`. Ideálně přidat do sekce test nebo kontrolu, která před `rotate-credentials` ověří, že žádný běžící sender nemá starý otisk klíče.

---

### A6. Test `OB-11` už zapracoval podmínku, kterou jsem posílal jako požadavek (POZNÁMKA, ne nález)

**Místo:** část 1, testovací scénáře outboxu, `OB-11`: „`Message-ID` u dvou pokusů téže zprávy → identický řetězec."

Zaznamenávám to jako pozitivní zjištění, protože to je přesně podmínka, kterou jsem podmiňoval souhlas s výchozí hodnotou `AMBIGUOUS_DISPATCH_POLICY = retry`. Bez identického `Message-ID` by `retry` znamenal zaručený duplikát; s ním většina přijímajících serverů druhou kopii zahodí. Souhlas s `retry` tedy platí.

---

## B. Nálezy k části 2 (kontakty)

### B1. Část 2 zapisuje přímým SQL do `messages` a používá sloupec, který v kontraktu neexistuje (BLOKUJÍCÍ, vlastní ověření)

**Místo:** část 2, sekce o odhlášení během rozesílky, ř. 1989 až 1997.

**Problém:** Dvě věci najednou.

1. **Sloupec `error` v `messages` neexistuje.** Část 2 předepisuje `UPDATE messages SET status = 'skipped', error = 'unsubscribed', updated_at = now()`. Kontrakt 4.10.1 má `error_code text` a `error_detail text`, žádný `error`. Dotaz spadne na `column "error" does not exist`.
2. **Je to překryv s částí 4a.** Moje kapitola 3.4.1 definuje doménovou funkci `revokePendingMessages({ workspaceId, emails, contactIds, reason })` právě proto, aby cizí část nesahala přímým SQL do outboxu. Část 2 o té funkci neví a píše si vlastní `UPDATE`. Teď se ty dvě implementace liší ve sloupci; zítra se budou lišit v podmínce.

Věcně se ale shodujeme: obě části říkají „výhradně `pending → skipped`, `claimed` se nedotýkat" a část 2 to má i v akceptačním kritériu 44. To je dobrá zpráva, spor je jen o mechanismus.

**Jak by to mělo být:** Část 2 volá `campaigns.revokePendingMessages(...)` a nepíše SQL nad `messages`. Funkce je v části 4a specifikovaná včetně chování a je pokrytá mými akceptačními kritérii 15 až 17. Kdyby část 2 trvala na přímém SQL, musí minimálně použít `error_code = 'unsubscribed'` místo `error`.

---

### B2. Segment s relativním časem se během materializace mění pod rukama (BLOKUJÍCÍ, potvrzeno vlastním grepem, detaily od recenzenta)

**Místo:** část 2, segmentační engine. Vlastním hledáním jsem v dokumentu **nenašel žádný parametr `as_of`** ani jiné zmrazení referenčního času.

**Problém:** Materializace publika v části 4a běží po dávkách 5000 kurzorem přes `contacts.id` a u milionu kontaktů trvá jednotky minut. Když segment obsahuje podmínku typu „poslední aktivita za posledních 30 dní" nebo „neotevřel posledních N kampaní", vyhodnocuje se relativně k `now()`. **Dávka 1 a dávka 200 pak vidí jiné publikum.** Důsledky:

- Kontakt na hranici okna vypadne nebo přibude podle toho, kdy na něj přišla řada. Publikum tedy není deterministické a nejde ho reprodukovat.
- Horší: hlavní specifikace slibuje, že se publikum v okamžiku odeslání **zmrazí**. Tenhle slib se tiše nedodrží a nikdo si toho nevšimne, protože rozdíl je v jednotkách kontaktů.

**Jak by to mělo být:** Kompilace segmentu musí přijímat **referenční čas** a všechny relativní podmínky ho použít místo `now()`:

```ts
compileSegmentToSql(segmentId: string, alias: string, opts: { asOf: Date }): { sql: string; params: unknown[] }
```

Část 4a předá `campaigns.audience_built_at`, tedy tentýž okamžik, který je i `created_at` všech zpráv. Tím je publikum reprodukovatelné a slib o zmrazení skutečně platí. Pro náhled počtu se předá `now()`.

Tohle je podle mě nejdůležitější nález celé revize, protože je neviditelný a projeví se jako „občas nám někdo v kampani chybí".

---

### B3. Chybí index pro kurzorový průchod materializace (VÁŽNÉ, vlastní ověření)

**Místo:** část 2, seznam indexů nad `contacts`, ř. 347 až 390.

**Problém:** Indexy jsou `(workspace_id, email)`, `(workspace_id, created_at DESC, id DESC)`, `(workspace_id, status, created_at DESC)`, `(workspace_id, last_activity_at)`, trigram, GIN nad `attributes` a další. **Žádný z nich neobsluhuje `WHERE workspace_id = $1 AND id > $2 ORDER BY id LIMIT 5000`**, což je přesně tvar mého materializačního kurzoru (moje 3.3.3).

Bez něj Postgres buď projde primární klíč a filtruje `workspace_id` až po (funguje, ale u instalace s víc projekty čte cizí řádky), nebo použije jiný index a řadí. U milionu kontaktů se to projeví jako několikanásobně delší materializace.

**Jak by to mělo být:** Doplnit `CREATE INDEX idx_contacts__ws_id ON contacts (workspace_id, id);`. Je to malý index a používá ho i export dat a jakýkoliv jiný dávkový průchod. Alternativně potvrdit, že se má kurzor stavět nad `(workspace_id, created_at, id)`, což už index má, a já materializaci přepíšu na ten tvar; funguje to stejně dobře, jen to musí být rozhodnuté.

---

### B4. Řízení izolace přes RLS má důsledek pro materializaci, který nikde není napsaný (VÁŽNÉ, vlastní ověření)

**Místo:** část 2, ř. 333 až 336 (`ALTER TABLE contacts ENABLE ROW LEVEL SECURITY`, politika `ws_isolation`). Souvisí s částí 1, sekce 3.x, ř. 893 až 908.

**Problém:** Izolace je dvouvrstvá a RLS čte `current_setting('mlain.workspace_id')`, nastavené přes `set_config(..., true)` na začátku transakce, tedy `SET LOCAL`. Moje materializace běží **po dávkách, každá dávka ve vlastní transakci** (3.3.3). Každá z těch dvou set transakcí tedy musí session proměnnou nastavit znovu. Pokud to worker udělá jednou na začátku jobu, druhá a další dávka vrátí nula řádků a **materializace tiše skončí s prázdným publikem**.

Část 1 to má popsané správně („repository vrstva vždy otevírá transakci"), ale ani jedna část neupozorňuje na dávkové joby, kde je transakcí mnoho a job je jeden. To je přesně případ importu (část 2), materializace (část 4a) a retenčních jobů.

**Jak by to mělo být:** Doplnit do konvence jednu větu: **každá transakce dávkového jobu musí nastavit `mlain.workspace_id` znovu**, a poskytnout na to helper (`withWorkspaceTx(workspaceId, fn)`), aby se na to nedalo zapomenout. Ideálně přidat test, který pustí dvoudávkový job a ověří, že druhá dávka vrátí řádky.

---

### B5. GDPR výmaz odstřihává `contact_id`, což je věcně správně, ale technicky nemožné (BLOKUJÍCÍ, viz A1)

**Místo:** část 2, ř. 2537 a 3356.

Je to druhá strana nálezu A1, uvádím ho i tady, aby ho autor části 2 viděl.

Zdůvodnění v části 2 je mimochodem velmi dobré a souhlasím s ním: události se nemažou, jen se odstřihne vazba na osobu, takže se agregované statistiky kampaní výmazem nemění. Přesně to jsem chtěl. Problém je jen v tom, že `messages.contact_id` je v kontraktu `NOT NULL`.

**Jak by to mělo být:** Viz A1. Doporučuju variantu A (anonymizovat adresu a `render_data`, `contact_id` nechat), protože `contact_id` po smazání kontaktu neukazuje na žádný osobní údaj a je to levnější než měnit kontrakt.

---

### B6. Práh měkkých bounců: dvě různá čísla ve dvou dokumentech (VÁŽNÉ, vlastní ověření)

**Místo:** část 2, ř. 2032 („5 měkkých odrazů ve 14 dnech (práh vlastní část 4)") a ř. 3355 („tato část předpokládá 5 odrazů ve 14 dnech | k potvrzení"). Proti tomu část 4a, kapitola 3.10.2: **3 odrazy ve 30 dnech**.

**Problém:** Obě části se shodují, že práh vlastní část 4, ale část 2 si mezitím zapsala jiné číslo a staví na něm text v UI i akceptační kritérium. Vznikly by dvě různé hodnoty ve dvou dokumentech, což je přesně ta situace, kdy dva implementátoři postaví každý něco jiného.

Část 2 to poctivě označila „k potvrzení", takže to není chyba, jen otevřený bod. Potvrzuju ho tímto.

**Jak by to mělo být:** Platí **3 měkké odrazy v okně 30 dní** (`SOFT_BOUNCE_THRESHOLD = 3`, `SOFT_BOUNCE_WINDOW_DAYS = 30`). Zdůvodnění proti variantě 5/14: typický mrtvý účet („mailbox full") generuje jeden odraz na kampaň, a kdo posílá newsletter jednou týdně, nasbírá ve 14 dnech nejvýš dva. Práh 5/14 by se tedy u běžné frekvence odesílání **nikdy neuplatnil** a měkké odrazy by se hromadily donekonečna. Okno 30 dní s prahem 3 odpovídá dvěma až čtyřem kampaním, což je hranice, kde se z dočasného problému stává mrtvá adresa.

Část 2 prosím ať přepíše obě místa. Hodnoty jsou konfigurovatelné, takže kdo chce 5/14, si to nastaví.

---

### B7. Chybí `reason = 'ses_suppressed'` ve výčtu suppression důvodů (DROBNÉ, vlastní ověření)

**Místo:** část 2, ř. 612 až 614, `CHECK (reason IN (...))`.

**Problém:** Výčet obsahuje `hard_bounce`, `soft_bounce_threshold`, `complaint`, `manual`, `global_unsubscribe`, `one_click_unsubscribe`, `invalid`, `import`, `gdpr_erasure`. Chybí v něm hodnota, kterou část 4a zapisuje (moje 3.10.4): **`ses_suppressed`**, tedy případ, kdy SES odmítl zprávu proto, že adresa je na jeho vlastním účtovém nebo tenant seznamu (`bounceSubType` = `Suppressed`, `OnAccountSuppressionList`, `OnTenantSuppressionList`, `EmailValidationSuppressed`). `CHECK` by ten zápis odmítl.

Je to jiný případ než `hard_bounce`: adresa se vůbec neodeslala, do naší bounce rate se nepočítá a uživateli se má vysvětlit jinak („Amazon tuhle adresu blokuje kvůli historii z jiných odesílatelů").

**Jak by to mělo být:** Doplnit `'ses_suppressed'` do `CHECK` a do tabulky odebratelnosti na ř. 2047 s pravidlem `removable = true` (na rozdíl od `hard_bounce`), protože adresa mohla být zablokovaná cizí vinou.

---

### B8. `suppressions.email citext` versus `messages.email text` (DROBNÉ, vlastní ověření)

**Místo:** část 2, ř. 610 (`email citext NOT NULL`) proti kontraktu 4.10.1 (`email text NOT NULL`).

**Problém:** Můj záchytný job `outbox.reconcile` (moje 3.4.2) joinuje obě tabulky přes `m.email = s.email`. Porovnání `text = citext` Postgres provede v `citext` sémantice, tedy případ od případu s implicitním snížením velikosti písmen. Můj index nad `messages` je funkcionální `(workspace_id, lower(email))`, takže se **na takový join nemusí použít** a job by u velké kampaně dělal sekvenční průchod.

Není to chyba části 2, `citext` u kontaktů a suppression listu je správná volba. Je to hraniční efekt dvou správných rozhodnutí.

**Jak by to mělo být:** Dvě možnosti, stačí jedna. Buď část 2 doplní generovaný sloupec nebo index `suppressions ((email::text))`, nebo (jednodušší) můj job bude joinovat explicitně `lower(m.email) = lower(s.email::text)`. Zvolím druhou variantu u sebe, pokud část 2 neřekne jinak. Uvádím to hlavně proto, aby o tom autor části 2 věděl, protože stejný efekt potká každého, kdo bude joinovat `contacts` na `messages`.

---

### B9. Odebratelnost ze suppression listu je vyřešená lépe, než jsem navrhoval (POZNÁMKA, ne nález)

**Místo:** část 2, ř. 618 (`removable boolean`), ř. 2047 a 2048, akceptační kritérium 47.

Moje otevřená otázka O2 zněla, jestli smí uživatel odebrat adresu ze suppression listu. Část 2 na to má hotovou odpověď: `hard_bounce` jen owner nebo admin, jen po 30 dnech, jen po jedné, s potvrzením a auditem; `soft_bounce_threshold`, `manual`, `import` a `invalid` kdykoliv i hromadně; `409 suppression_too_recent` na předčasný pokus.

Je to jemnější než moje binární „tvrdé ne", a přitom to drží ochranu. **Přebírám to a zavírám tím svoji otázku O2.** Uvádím to sem, aby bylo vidět, že se rozhodnutí nemá řešit dvakrát.

---

### B10. `greeting` je skutečný sloupec, na který se dá spolehnout (POZNÁMKA, ne nález)

**Místo:** část 2, ř. 301 (`greeting text NOT NULL DEFAULT ''`) a 1418 („`greeting` je hotový řetězec uložený ve sloupci, ne funkce v šabloně").

Ověřoval jsem to jako riziko (funkce volaná milionkrát při materializaci) a je to v pořádku. Navíc je popsáno, kdy se přepočítává, a přepočet celého projektu je vlastní job s dávkami po 10 000. Pro materializaci to znamená obyčejný `SELECT` sloupce. Bez nálezu.

---

## C. Návrhy na změnu zmrazených kontraktů

Kontrakty v sekci 4.10 části 1 jsou zmrazené. Níže je jediné, co podle téhle revize **musí** projít změnou, a jedno, co je volitelné. Nic z toho neprovádím, je to podklad k rozhodnutí.

| # | Kontrakt | Změna | Nutnost |
|---|---|---|---|
| K1 | 4.10.1 outbox | Vyřešit `contact_id NOT NULL` versus GDPR (nález A1). Buď zůstane `NOT NULL` a část 2 změní postup výmazu, nebo se sloupec uvolní na nullable. | **Nutné**, jinak GDPR výmaz spadne |
| K2 | 4.10.1 outbox | Doplnit invariant: všechny řádky jedné kampaně mají identické `created_at` (= `campaigns.audience_built_at`), sender ho nikdy nepřepisuje. Bez toho `uq_messages__campaign_contact` duplicity nezachytí, protože `created_at` je jeho součástí. | **Nutné**, jinak index dává falešnou jistotu |
| K3 | 4.10.1 outbox | Doplnit větu, že každý odkaz na zprávu z jiné tabulky musí nést obě složky klíče `(id, created_at)`. Prosakuje to do částí 4a i 5. | Silně doporučené |
| K4 | 4.10.1 granty | Vyřešit rozpor mezi přechodem `claimed → skipped` a chybějícím `GRANT SELECT ON suppressions` (nález A2). | Nutné, jinak je přechod mrtvá litera |
| K5 | 4.10.1 granty | Rozhodnout, jestli sender skutečně zapisuje do `message_events` (nález A3), a pokud ano, vyjmenovat povinné sloupce. | Nutné, jinak `INSERT` spadne na `NOT NULL` |
| K6 | 4.10.3 tokeny | Zvážit přidání `created_at` zprávy do payloadu open a click tokenu (+4 bajty). Bez něj musí část 5 partition odhadovat z `issued_at`. Obejít se to dá, takže to samo o sobě otevření kontraktu neospravedlňuje, ale **kdyby se kontrakt otevíral kvůli K1 až K5, stojí za to to přibalit**. | Volitelné |

---

## D. Co jsem prověřoval a nic nenašel

Uvádím to, aby bylo vidět rozsah, ne jen výsledek.

**Část 1:**

- **Idempotence příjmu SNS.** Konvence `Idempotency-Key` z 4.4 je pro HTTP zápisy od našich klientů a na SNS se nehodí, protože SNS hlavičku neposílá. Můj vlastní mechanismus (`provider_event_receipts.dedup_key`) je legitimní rozdíl, ne překryv. Konvence pro idempotenci jobů přes pg-boss `singletonKey` v části 1 je a stačí mi.
- **Katalog chyb.** Obecné kódy pokrývají všechno, co jsem potřeboval, a po revizi jsem pět vlastních kódů zrušil ve prospěch obecných. Nic mi tam nechybí.
- **Obálka odchozích webhooků.** Unese doručení mimo pořadí, protože si sekvenci můžu nést v `data`. Limit velikosti payloadu je dostatečný i pro `message.bounced` s diagnostickým kódem od poštovního serveru.
- **Šifrování credentials.** Kontext `sending_provider`, AAD s `workspace_id`, `key_id` v obálce a `SECRET_KEY_PREVIOUS` pokrývají i rotaci za běhu. Jediná výhrada je A5 a je drobná.
- **Databázová práva senderu.** Granty jsou explicitní, testované scénáři `OB-08` a `OB-09`, a řeší i to, že sender nepodléhá RLS na `messages`. To je přesně ta odpověď, kterou jsem potřeboval a sám bych ji nevymyslel.
- **Konfigurační proměnné.** Tvar tabulky, validace při startu, `exit code 78` a varianta `_FILE` pro Docker secrets jsou popsané dostatečně.

**Část 2:**

- **Vokativ a `greeting`.** Sloupec, ne funkce, s popsaným přepočtem i frontou ke kontrole. Pro materializaci ideální stav.
- **Double opt-in.** Stavový diagram je jednoznačný a kontakt čekající na potvrzení kampaň nedostane, protože brána je `list_subscriptions.status = 'confirmed'`.
- **Validace e-mailu.** Popsaná jednoznačně a sdílená s importem, což je přesně to, co jsem chtěl v R2.8.
- **Odhlašovací stránka a one-click.** RFC 8058 je respektované včetně `POST` bez potvrzovací stránky. Vlastnictví šablony je vyjasněné.
- **GDPR obecně.** Rozhodnutí nemazat události, jen odstřihnout vazbu na osobu, je správné a lépe zdůvodněné než moje původní formulace. Přebírám ho.

---

## E. Co jsem po revizi opravil ve vlastní části

Revize odhalila stejné množství chyb u mě jako u ostatních. Uvádím je, protože recenzent, který najde chyby jen u druhých, revizi neudělal pořádně.

| # | Co bylo špatně | Jak jsem to opravil |
|---|---|---|
| 1 | Partitionoval jsem `message_events` podle `ts`, tedy času události u providera. Ten je nemonotónní: událost se zpožděním by mířila do partition, kterou už mohl retenční job odpojit, a protože se nezakládá `DEFAULT` partition, zápis by selhal. | Partition key je `created_at`, čas našeho zápisu. `ts` zůstává obyčejným sloupcem. |
| 2 | Rank-based přepočet stavu přepisoval `sent` na `failed` při pozdním tvrdém odrazu. Kontrakt to zakazuje a čísla v uzavřeném reportu by se zpětně měnila. | `sent`, `failed` a `skipped` jsou koncové. Příchozí událost stav nemění nikdy, jde jen do `message_events`. |
| 3 | Filtroval jsem publikum na `c.status = 'subscribed'`, ale část 2 má hodnotu `active`. Dotaz by vrátil nula řádků a kampaň by neodešla nikomu. | Opraveno na `active`, autoritativní branou je `list_subscriptions.status = 'confirmed'`. |
| 4 | Používal jsem prefix `contact.custom.<key>`, katalog části 2 má `contact.attr.<key>`. Validátor by propustil `attr`, já bych vyrobil `custom` a každé vlastní pole by se vyrenderovalo prázdné. | Opraveno na `attr` v celém dokumentu. |
| 5 | Materializace neaplikovala `deleted_at IS NULL`, `processing_restricted = false` ani `snooze_until`. Poslal bych poštu člověku s omezeným zpracováním podle článku 18 GDPR. | Celý filtr způsobilosti je uvnitř `compileAudienceToSql` části 2, nepíšu si ho ručně. |
| 6 | `revokePendingMessages` neměla `listId`, takže odhlášení z jednoho newsletteru by zrušilo veškerou čekající poštu kontaktu. Tichá ztráta. | Doplněn `listId`, větev přes `contact_id`, zrušeno sedmidenní okno, které míjelo dlouho pozastavené kampaně. |
| 7 | Kontrola suppression nerespektovala měkké odebrání. Adresa odblokovaná po 30 dnech by zůstala vyloučená navždy. | Doplněno `s.removed_at IS NULL`. |
| 8 | Retenční job mohl odpojit partition s rozpracovanou kampaní, protože celá kampaň leží v jedné partition podle `audience_built_at`. Pozastavená kampaň by po obnovení vypadala jako doběhlá, přestože neodeslala nic. | Dvě blokující kontroly před odpojením partition. |
| 9 | `Message-ID` jsem měl ve vlastním tvaru, kontrakt má deterministický `<ml.{base32}@domain>`. | Sladěno odkazem na kontrakt. |
| 10 | Seznam polí pro `render_data` byl užší než katalog merge tagů (chyběly tituly, `gender`, `locale`). | Nahrazeno odkazem na `CONTACT_MERGE_FIELDS`. |

Šest z těch deseti chyb má stejnou příčinu: **napsal jsem si hodnotu, kterou vlastní jiná část, místo abych na ni odkázal.** Je to nejčastější zdroj rozporů v celém projektu a doporučuju to jako pravidlo do konsolidace: kdykoliv se v dokumentu objeví konkrétní hodnota z cizí domény (název stavu, prefix, práh, tvar identifikátoru), musí být odkazem, ne kopií.
