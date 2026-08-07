# Hotovo

Archiv dokončené práce. Vzniklo 7. 8. 2026 vydělením oddílu 6 ze `STAV-UKOLU.md`,
aby ten dokument držel jen to, co je potřeba udělat, zadat nebo rozhodnout.

**Nic se odsud nemaže.** Je to jediné místo, kde je vidět, PROČ se něco udělalo tak,
jak se udělalo, a co se přitom naměřilo. Bez toho se tytéž nálezy vracejí znovu.

Řazeno od nejnovějšího dne. Živý seznam úkolů je v `STAV-UKOLU.md`.

---

## Dokončená práce po dnech

### 2026-08-07

- [x] **RUŠENÍ ČEKAJÍCÍ POŠTY A RETENCE AUDITU** (agent `ruseni-zprav`, 7. 8. 2026).

  Zápis vznikl sloučením útržků, které agent odkládal do kořene repozitáře, protože
  měl zakázáno psát do tohohle souboru. Ten zákaz byl můj a byl špatný: informace
  by se ztratila při prvním úklidu pracovní kopie.


  ## ruseni-zprav

  - **Port `revokePendingMessages` zapojen.** Implementaci dodává doména kampaní
    (`packages/core/src/campaigns/outbox/contacts-port.ts`). Port si ji dohledá sám při
    prvním volání, aby ho nešlo obejít rozdělením modulového grafu.
  - **Zrušení běží v transakci volajícího.** `tx` se předává ze všech čtyř produkčních
    cest, takže odhlášení a zrušení pošty je jeden commit, ne dva.
  - **`outbox.reconcile` složena celá.** `systemReconcileDeps()`; chybějícím kusem byl
    `reconcileSuppressed`, ne nový návrh. Fronta přestala padat každou minutu.
  - **`ai.cleanup_conversations` zapojena.** `packages/core/src/ai/jobs/system-deps.ts`.
  - **`contacts.cleanup_import_files` opravena.** Byl to `perJob` nad cronem s prázdným
    nákladem, padalo to na `validation_failed`.

  ## ruseni-zprav, doplneni k outbox.reconcile

  - **`reconcilePending` (`campaigns/repo/outbox.ts`) pokrývá všech šest důvodů**, ne jen
    blokované adresy: `contact_anonymized`, `contact_deleted`, `processing_restricted`,
    `suppressed`, `unsubscribed`, `contact_status_changed`. Predikát je PŘEVRÁCENÁ obálka
    publika ze `segments/compile/envelope.ts`, ne vlastní pravidla.
  - Rozsah odhlášení drží i tady: odhlášení z jednoho seznamu ruší jen poštu kampaní
    s tím `unsubscribe_list_id`.
  - Idempotence ověřena třemi běhy za sebou, ne úvahou.
  - 16 databázových testů (`repo/__tests__/reconcile-pending.db.test.ts`), z toho 6 na to,
    co se zrušit NESMÍ.

  ## ruseni-zprav, overeni naostro a audit

  - **Odhlaseni pres trasu `/u/[token]` OVERENO NAOSTRO.** Vlastni izolovana databaze,
    skutecny token, telo podle RFC 8058, obsluha volana v grafu BEZ jakekoli registrace.
    Vysledek: `skipped / unsubscribed / revoked by application`. Kontrola vracenim:
    s puvodnim telem portu zustala zprava `pending`, tedy by odesla odhlasenemu cloveku.
  - **Retence auditu prenesena na zahozeni oddilu pod migratorem.** `audit_log` je ctvrty
    cil v `ops/partition-retention.ts`; `platform.cleanup_audit_log` zrusena cela
    (registr, modul, queue-handlers). Prava role `mlain_app` se NEVRACEJI.
  - Novy test `ops/partition-retention-audit.db.test.ts` hlida obe poloviny: ze aplikacni
    role mazat nesmi (42501) a ze migrator uklidem projde.

  **Otevřené k tomu:** nález o produkčním buildu z 3. 8. je vyřešený zápisem do
  paměti projektu (worker, sender i `.next` běží ze sestavených artefaktů).
  Počet 4 116 pádů `outbox.reconcile` se mazat nemusí: přehled úloh ukazuje OKNO
  POSLEDNÍCH 24 HODIN, takže číslo spadne samo, jakmile fronta přestane padat.

- [x] **PŘIHLÁŠENÍ PŘES FORMULÁŘ NEDOŠLO NIKDY: dvě příčiny, obě mimo dosah testů**
  (hlavní agent, nález zadavatele z 15:48).

  Zadavatel vyplnil veřejný formulář adresou ověřenou v SES a potvrzovací e-mail
  nedorazil. Kontakt vznikl, zpráva vznikla, neodešlo nic. **Příčiny byly dvě
  a stály na sobě**, takže oprava jedné by problém nevyřešila a vypadala by
  jako neúčinná.

  **1. Zprávu si zrušila naše vlastní úloha `outbox.reconcile`.** Ta ruší čekající
  poštu lidem, kteří ji už nesmí dostat, a mezi důvody má `c.status <> 'active'`
  → `contact_status_changed`. Jenže potvrzení dvojího souhlasu jde Z DEFINICE
  na kontakt ve stavu `unconfirmed`, protože právě tím se z něj `active` stane.
  Úloha tedy zabila každou registraci do minuty po vzniku. Naměřeno na dvou
  skutečných přihlášeních (15:46 a 15:48), obě `skipped`.

  Nevypadalo to jako chyba: řádek v `messages` existoval a nesl věrohodný důvod.

  Oprava je jeden řádek v `REVOKE_REASON_CASE` (`packages/core/src/campaigns/repo/outbox.ts`):
  `WHEN m.kind <> 'campaign' THEN NULL`. Dělí CASE na dvě poloviny. Nad ním jsou
  TVRDÉ překážky (vymazaný, anonymizovaný, omezené zpracování, blokovaná adresa)
  a platí na všechnu poštu včetně transakční. Pod ním jsou překážky odvozené ze
  SOUHLASU S MARKETINGEM a dávají smysl jen u kampaní, protože obálka publika,
  jejímž rubem ten CASE je, popisuje výhradně kampaňovou poštu.

  Je to TÁŽ záměna, kterou týž soubor už jednou udělal u `cancelPendingBatch`,
  kde chybějící `kind = 'campaign'` rušil testovací maily spolu s kampaní.

  Ověřeno vrácením: čtyři nové testy v `reconcile-pending.db.test.ts`, bez opravy
  padají dva (potvrzení kontaktu `unconfirmed` a transakční pošta odhlášenému).
  Zbylé dva hlídají druhý směr, tedy že tvrdé překážky platí i na transakční poštu.

  **PROČ TO POJISTKA NECHYTILA** (rozbor autora té úlohy, agenta `ruseni-zprav`):
  testů na to, co se zrušit NESMÍ, bylo šest, ale **ani jeden nepoužil zprávu s jiným
  `kind` než `campaign`**, protože všechny šly přes `seedMessages`, který zakládá
  výhradně kampaňové. **Díra v pojistce měla přesně tvar díry v kódu**, což je ta
  nejhůř viditelná varianta: pokrytí vypadá plně, měřítko a měřená věc sdílejí tentýž
  slepý úhel. Volba byla navíc VĚDOMÁ, filtr na `kind` autor zvažoval a zamítl kvůli
  souladu s okamžitou cestou, přestože platilo pravidlo, že nebezpečnější směr je
  zrušit poštu, která odejít měla.

  Poučení k zapamatování: **když pomocná funkce zakládá jen jednu variantu vstupu,
  je celá sada nad ní slepá vůči rozlišení podle té varianty.**

  **2. Sender běžel z binárky staré tři dny.** `/tmp/mlain-sender` byl ze 4. 8. 12:34,
  tedy BEZ opravy `sending_enabled` z téhož dne ráno, což je přesně ta oprava, kvůli
  které přes SMTP nic neodcházelo. Po překladu a restartu odešly obě zprávy přes SES
  s provider ID. Týž nález nahlásil nezávisle agent `ruseni-zprav` u produkčního
  buildu webu (`.next` ze 3. 8.).

- [x] **JMÉNO PROJEKTU SVÍTILO NA VEŘEJNÝCH STRÁNKÁCH** (hlavní agent, nález zadavatele:
  „to je moje osobní věc a ne že to budu zobrazovat na webu formuláře").

  `publicScope` bralo do brandingu `workspaces.name`, tedy interní popisek do postranního
  menu („Petr Osobní mail"). Zobrazovalo se na děkovací stránce formuláře, na odhlašovací
  stránce, v centru předvoleb i v titulku okna prohlížeče.

  Teď se bere `sender_identities.from_name` (výchozí předvolba, jinak nejstarší), tedy
  to, co příjemci UŽ VIDÍ v poli Od. Projekt bez předvolby zůstává PRÁZDNÝ a stránka
  jméno nekreslí vůbec; doplnit náhradu by znamenalo vrátit se k tomu, co se opravovalo.

  **Ten stav držel na místě vlastní test**: `public-pages.test.ts` sliboval v názvu
  „nese jméno odesílatele", ale ověřoval jméno projektu. Opraven a doplněn o tvrzení,
  že jméno projektu na stránce NENÍ. Nové `branding.db.test.ts` má tři případy.

- [x] **SOUHLAS U FORMULÁŘE: nepovinná volba a odkaz na obchodní podmínky**
  (hlavní agent, zadání zadavatele).

  `consent_text`, `consent_required` i vykreslení zaškrtávacího políčka v produktu
  UŽ BYLY. Chybělo dvojí: přepínač povinnosti (souhlas byl vždy povinný a nešlo to
  změnit) a odkaz, protože text se vykresloval jako holé znaky.

  **Syrové HTML se nepouští**, a je to rozhodnutí, ne opatrnost: text se vykresluje
  na veřejné stránce cizího webu a zapisuje ho kdokoli s právem upravit formulář.
  `packages/core/src/contacts/forms/consent-markup.ts` rozkládá text na SEGMENTY
  (text / odkaz), nikdy nevrací HTML. Rozpozná dva zápisy téhož, `[text](https://…)`
  i `<a href="…">text</a>`, protože ten druhý člověk zkusí nejdřív a jako holé znaky
  by vypadal jako vada. Adresa projde jen s `http`/`https`, ověřeno rozborem přes
  `new URL()`, ne hledáním podřetězce. Nepovolená adresa NEMIZÍ, zůstane textem:
  souhlas je právní doklad.

  Čtrnáct testů, z toho deset na to, co se vykreslit NESMÍ (`javascript:` ve čtyřech
  maskováních, `data:`, `vbscript:`, relativní cesta, `<script>`, únik z atributu).

  Vykreslení je na dvou místech (veřejná stránka a náhled v editoru) a obě jdou přes
  tutéž funkci, aby náhled ukazoval totéž co ostrý provoz.

- [x] **TŘI VADY NALEZENÉ ÚKLIDEM SADY, ne hlášením** (hlavní agent).

  - **Náhodně padající test rotace API klíčů.** Pomocník bral sekret jako kus za
    POSLEDNÍM podtržítkem, jenže sekret je base64url a ta abeceda podtržítko obsahuje.
    Test padal podle toho, co vylezlo z generátoru; v izolaci procházel. Po opravě
    šest běhů za sebou zeleně.
  - **Okno na vzetí odeslání zpět míchalo dvoje hodiny.** `release_at` píše databáze
    (`SET release_at = now()`), ale `undoRemainingSeconds` to porovnávalo s `new Date()`
    aplikačního procesu. Postgres běží v kontejneru a jeho hodiny se od hostitele
    odchylují (naměřeno 28 ms). Hned po „Odeslat teď" se proto ukázala zbývající
    sekunda, kterou už server odmítal (`campaign_undo_window_expired`). Nový
    `databaseNow()` v `live-progress.ts` jde v témž `Promise.all`, takže odezvu
    neprodlužuje.
  - **99,9 % chyb lintu bylo v cizím kódu.** Z 3943 chyb eslintu jich 3939 leželo
    v reportu Playwrightu, tedy v zabaleném prohlížeči trasování. Skutečné nálezy
    v našem kódu byly čtyři a ztrácely se v tom. Adresáře reportů doplněny mezi
    ignorované výstupy.

  Dále: kontrakt OpenAPI přegenerován (47 → 49 operací, `/jobs/worker`
  a `/jobs/{kind}/{id}/cancel`), doplněno 108 chybějících nulových tvarů množného
  čísla v obou jazycích, opraven test pokračování importu.

- [x] **Z INSTALACE, KTERÁ POSÍLÁ PŘES SMTP, ODEŠEL PRVNÍ E-MAIL** (agent
  `odesilani-nefunguje`, čtyři nálezy agenta `zlata-cesta` ze 7. 8.).

  **Doloženo na čisté instalaci z compose, ne testem.** Obraz postavený z aktuální
  pracovní kopie, vlastní compose projekt na vlastních portech, aby se nesrazil
  s testem zlaté cesty. Průvodce prvním spuštěním, připojení SMTP účtu, ověřená
  adresa zkušebního režimu, přihlášení do seznamu s dvojím potvrzením. Výsledek:

      messages: kind = transactional, status = sent, error_code prázdné
      sending_providers: type = smtp, sending_enabled IS NULL
      poštovní past: „Potvrďte prosím přihlášení k odběru"

  Druhým během přes ukázková data odešel i zkušební e-mail ze šablony
  (`kind = test`, `status = sent`).

  **1. Odesílač neuměl přečíst SMTP účet, takže neodešlo nic.**
  `sending_providers.sending_enabled` je nullable a u SMTP účtu je prázdné VŽDY:
  SMTP server takovou informaci nehlásí a `providers/api/service.ts` tam vědomě
  zapisuje NULL. Sender ho skenoval do `bool`, takže NULL shodil čtení CELÉHO
  řádku providera a zpráva zůstala navždy `pending`.

  **Opraveno na straně Go, ne migrací, a je to rozhodnutí, ne pohodlnost.**
  Sloupec je tříhodnotový schválně: nese to, co o účtu řekl provider, a `mapAccount`
  vrací `null`, když Amazon hodnotu neposlal. `NOT NULL DEFAULT true` by ten rozdíl
  mezi „provider potvrdil, že odesílání běží" a „nikdy jsme se neptali" smazal
  a zápis snímku účtu bez té hodnoty by nově skončil chybou. Sender proto čte
  do `*bool` a prázdno vyhodnocuje jako ZAPNUTO
  (`outbox.SendingEnabledFromColumn`), tedy stejně jako `?? true` na straně
  TypeScriptu. Jedna pravda o jednom sloupci.

  **1b. Chybová hláška lhala a už nelže.** Každé selhání načtení účtu dostávalo kód
  `credentials_undecryptable`, tedy „nesouhlasí SECRET_KEY". U dvou ze tří příčin to
  byla nepravda a stálo to vyšetřování u klíčů, které byly celou dobu v pořádku.
  Nový kód `provider_config_unreadable` (třída `fatal`, pauza `provider_unavailable`)
  popisuje selhání ČTENÍ z databáze, `contract_mismatch` si nově drží svůj vlastní
  kód místo cizího, a věta v `error_detail` i řádek v logu odpovídají kódu.
  Kód je v katalogu senderu i v `MESSAGE_CODES`, takže obě strany znají totéž.

  **2. a 3. Potvrzovací e-mail a zkušební e-mail se v čerstvém projektu nedaly
  poslat.** Odesílatele si hledala KAŽDÁ trasa sama a ty čtyři kopie se rozešly:
  `test-send.ts` a `delivery-email.ts` se `sender_identities` ani neptaly. Čerstvý
  projekt nemá ani předvolbu odesílatele (ta stojí na ověřené doméně, kterou zkušební
  režim z definice nemá), ani uloženou kampaň, takže potvrzovací e-mail se neodeslal
  vůbec a „Poslat test" skončilo na `test_sending_not_configured` — v pořadí kroků,
  které panel prvních kroků sám doporučuje (test je krok 4, kampaň krok 5).

  **Jedna funkce místo čtyř kopií:** `sender-identities/resolve.ts`. Pořadí je
  předvolba projektu, poslední kampaň s vyplněným odesílatelem, a NOVĚ připojený
  odesílací účet s OVĚŘENOU ADRESOU zkušebního režimu. Právě ta adresa: je to jediná
  adresa, o které instalace ví, že ji vlastník opravdu ovládá (potvrdil ji odkazem),
  a ve zkušebním režimu se stejně doručuje jedině na ověřené adresy. Vymyslet
  `no-reply@…` by znamenalo poslat e-mail z adresy, kterou nikdo nezaložil.
  Zablokovaný a vypnutý účet se přeskakuje. Hláška u zkušebního odeslání radila
  „nejdřív založte kampaň"; nově posílá tam, kam patří, tedy na připojení účtu
  a ověření adresy.

  **4. Projekt z průvodce prvním spuštěním neměl žádný seznam.** `createWorkspace`
  výchozí seznam „Odběratelé" zakládal, `identity/setup.ts` ne, takže první projekt
  instalace se choval jinak než každý další a import, který cílový seznam vyžaduje,
  narazil hned na prázdnou nabídku. Vloženo do JEDNÉ funkce
  (`contacts/lists/default-list.ts`), kterou volají obě cesty; dvě kopie by se zase
  rozešly. Doloženo na instalaci výše: `GET /lists` vrátil „Odběratelé",
  `opt_in = double`, `confirmation_mode = one_step`, `is_default = true`.

  **Ověřeno:** Go jednotkové i integrační testy (`internal/outbox`, `internal/app`,
  `internal/errcatalog`), nové testy v `packages/core` (setup, test-send,
  subscription-emails, resolve, registr kódů) a u KAŽDÉ opravy i to, že test vadu
  chytá: po dočasném vrácení opravy spadl a hlásil přesně původní chybu
  (`cannot scan NULL into *bool`).

- [x] **Seznam úloh je tabulka `DataTable`, ne karty, a selhání se počítají za den**
  (agent `centrum-uloh-2`, druhé kolo po pohledu zadavatele na mezistav).

  **ZADÁNÍ, doslova: „Co záznam, to jeden řádek, ať je to kompaktnější. Vzhled jako
  ostatní tabulky."** Do té chvíle kreslil seznam `JobsCenter`, vlastní prvek návrhového
  systému, kde každá úloha byla karta na čtyři řádky (název, čas dokončení, kdo spustil,
  dva odkazy). Tři úlohy zabraly celou obrazovku; deset úloh se teď vejde na jednu.

  **`JobsCenter` ZANIKL CELÝ**, ne že by se jen přestal používat. Aplikace kreslí seznamy
  `DataTable` na sedmi obrazovkách a druhý způsob, jak vypadá seznam, byla odchylka.
  S ním odešel jeho test, jeho export, typ `JobSummary` a DESET z dvanácti popisků
  v `JobsLabels`: zbyly dva, které potřebuje odznak v hlavičce. `toJobSummary` se scvrkl
  na `jobNote`, tedy na jedinou část, kterou nenese žádný sloupec (věta o dobíhající
  dávce a kód selhání).

  **SEDM SLOUPCŮ: Úloha, Druh, Stav, Postup, Spustil, Poslední změna, Akce.** Výchozí
  šestka `DataTable` by schovala ten poslední, tedy nabídku akcí, a obrazovka by přišla
  o jedinou cestu k zastavení úlohy, aniž by o to kdo požádal; proto `defaultVisibleColumns={7}`.
  Ověřeno vypnutím: se šestkou spadne SEDM testů.

  **ŘÁDKOVÉ AKCE JSOU V NABÍDCE POD TŘEMI TEČKAMI**, ne dva odkazy v řádku. Týž tvar jako
  u kontaktů, seznamů a vlastních polí, včetně `IconButton size="row"`, tedy 34px čtverce
  s neviditelným 44px překryvem; čtvrtý způsob řádkových akcí v produktu nevzniká.
  **Potvrzovací okno drží TABULKA, ne řádek**, a je to poučení, které projekt zná:
  obsah rozbalené nabídky se při volbě položky odpojí z DOM a odnesl by okno s sebou dřív,
  než by se ukázalo. `CancelJobButton` se proto rozpadl na `JobCancelDialog` (jen okno,
  otevření zvenčí) a tlačítko, které si okno drží samo a používá ho detail úlohy.

  **DVĚ SEKCE („Rozdělané" a „Dokončené") ZMIZELY, a je to správně.** Tabulka řadí podle
  poslední změny sestupně, takže běžící úloha je vždycky nahoře, a od dokončené ji odliší
  sloupec Stav. Dvě sekce by znamenaly dvě tabulky s dvěma patičkami a stránkovat by šlo
  jen jednu z nich.

  **STRÁNKOVÁNÍ PŘEŠLO Z „NAČÍST STARŠÍ" NA ŠIPKY**, protože je má patička `DataTable`.
  Kurzor `before` umí jen dopředu, takže cesta zpátky se pamatuje ZÁSOBNÍKEM KURZORŮ;
  bez něj by šipka zpátky musela zůstat trvale zašedlá. Patička potřebuje celek, jinak
  by psala „50 z 50" ve chvíli, kdy vedle svítí šipka dál: přibyl proto nepovinný `count`
  na `JobSource` a `total` v odpovědi seznamu (dva laciné `count(*)`).

  **HLAVNÍ ÚDAJ NA ÚZKÉ OBRAZOVCE JE NÁZEV, ne stav**, a role sloupců jsou určené ručně,
  ne ponechané na výchozím pravidle: `title` je `primary`, Stav, Postup a Poslední změna
  jsou `secondary`, Druh a Spustil se na kartě nekreslí. Ověřeno na 390 px: karty se
  kreslí, dokument nepřetéká (375 z 375 px).

  **POZNÁMKA ŘÁDKU NEOPAKUJE ODZNAK.** U zastavované úlohy hlásí odznak „Zastavuje se",
  takže věta z detailu („Zastavuje se: rozpracovaná dávka ještě doběhne, takže čísla se
  můžou o kousek posunout.") by na řádku stála podruhé a zabrala půl sloupce. Zbyl z ní
  nový klíč `jobs.stoppingRowNote`, tedy jen to, co odznak neříká.

  **NÁLEZ, KTERÝ SE TÍM POTVRDIL A JE ZAPSANÝ V `STAV-UKOLU.md`:** `DataTable` kreslí
  zaškrtávátka VŽDYCKY a `selectable={false}` v návrhovém systému NENÍ (ověřeno ve zdroji:
  `Checkbox` na řádcích 405, 479 a 607 nemá žádnou podmínku). Úlohy nemají jedinou
  hromadnou akci, takže tabulka dostala výběr, který nikam nevede. Je to nález napříč
  aplikací, ne vada téhle obrazovky; táž věta je i v `lists-table.tsx`.

  **DRUHÁ ČÁST ZADÁNÍ: PANEL POČÍTAL SELHÁNÍ OD ZAČÁTKU, TEĎ ZA DEN.** Zadavatel viděl
  „SELHALO 4 142" a vyděsilo ho to, přestože 4 116 z toho byla JEDNA fronta padající od
  3. srpna a od restartu v 15:58 nepřibyl ani jeden pád. Naměřeno v tutéž chvíli: za
  24 hodin 610 pádů, za poslední hodinu 15. Celkové číslo bez časového rámce je poplašná
  zpráva, ne informace.
  **Okno je den, ne hodina:** hodina by u fronty, která tiká po pěti minutách, ukázala
  nulu uprostřed poruchy trvající od rána.
  **Tenhle jediný údaj se nedá vzít z `pgboss.queue`:** tamní `failed_count` je momentka
  všech uchovávaných selhání, tedy sedmi dnů, a žádné okno v ní není. Počítá se proto
  z `pgboss.job`, a to je sekvenční sken (238 ms nad 71 000 řádky, `EXPLAIN ANALYZE`).
  Výsledek se drží 20 s v paměti procesu, aby ten sken NEPLATIL KAŽDÝ OTEVŘENÝ PANEL:
  panel se ptá po 30 s, takže každý dotaz dostane čerstvé číslo, ale deset záložek
  sdílí jeden sken. Zbylá tři čísla panelu se dál počítají z `pgboss.queue`, tedy zadarmo.

  **Ověřeno:** 49 zelených v `apps/web/src/features/jobs`, 26 v `apps/web/test/api/jobs.test.ts`
  proti skutečným tabulkám pg-bossu (nově i selhané úlohy s různým stářím a celkový počet
  přes zdroje), 67 v `packages/ui/src/patterns/{jobs,data-table}`, 12 v `registry.test.ts`,
  typová kontrola tří balíčků, eslint, prettier, `i18n-check` (4 892 klíčů).
  **Ověřeno vypnutím u obou hlavních rozhodnutí:** po rozšíření okna na 240 hodin hlásí
  test „expected 3 to be 2", po návratu na výchozích šest sloupců spadne sedm testů.
  **Vizuálně v prohlížeči:** tabulka se sloupci a odznaky, nabídka pod třemi tečkami,
  patička „Zobrazeno 10 z 10". Stránkování naostro s dočasnou stránkou po třech:
  3 → 3 → 3 → 1 dopředu i zpátky, celek „z 10" po celou dobu, šipka zpět zašedlá na první
  stránce a šipka dál na poslední. Na 390 px karty s názvem jako hlavním údajem.
  Panel po opravě ukazuje „SELHALO ZA 24 H: 604" místo 4 142.

- [x] **Centrum úloh ukazuje stav workeru a fronty, ne jen dvě doménové úlohy**
  (agent `centrum-uloh-2`). Zadání byly dvě věty z ostrého používání a je za nimi jeden
  problém: „potřebuju vidět, kolik úloh je ve frontě, jestli worker běží, nebo je
  zaseknutý" a „worker měl ve frontě desítky úloh, ale na stránce visely jen dvě".

  **NEJDŘÍV MĚŘENÍ, PAK OBRAZOVKA.** V `mlain_clean` za třicet minut prošlo frontou
  188 úloh `__pgboss__send-it`, po 25 ticích `campaign.scheduler`, `campaign.watchdog`,
  `outbox.stall_watch` a `tracking.refresh_campaign_progress`, k tomu 8 SELHANÝCH běhů
  `outbox.reconcile`. Uživatel z toho neviděl nic. Zadavatelovy „desítky úloh" tedy byly
  cronové tiky INSTALACE, ne úlohy jeho projektu, a to je i odpověď na otázku, co se má
  ukazovat: seznam zůstává projektový, přibyl nad ním souhrnný panel.

  **PANEL JE SOUHRN, NE ROZPIS PO FRONTÁCH, a je to rozhodnutí.** `outbox.stall_watch`
  ani `tracking.refresh_campaign_progress` majiteli projektu nic neříkají a jejich tik
  každou minutu by ze seznamu jeho vlastních úloh udělal nečitelný proud; kdo umí přečíst
  název fronty, dívá se do logu workeru nebo pouští `mlain doctor`. Ven jdou proto POUZE
  součty: čeká, zpracovává se, selhalo, odloženo stranou. **Žádné názvy front, žádná
  jednotlivá úloha.** `pgboss.job` navíc sloupec `workspace_id` nemá, takže se z fronty
  po projektech ani číst nedá; žádné obcházení izolace tu nevzniklo a vzniknout nemohlo.

  **MĚŘÍ SE Z `pgboss.queue`, NE Z `pgboss.job`, a je to rozdíl 240 ms proti jedné.**
  `pgboss.job` má čtvrtý den provozu 70 000 řádků a agregace přes stavy je nad ním
  paralelní sekvenční sken (`EXPLAIN ANALYZE`: 240 ms, poroste do stropu daného
  `deletion_seconds`, tedy sedmi dnů). `pgboss.queue` má 96 řádků a nese tytéž počty
  předpočítané: monitor pg-bossu je přepisuje po minutě příkazem `cacheQueueStats`.
  Významy jsou opsané z `plans.js` pg-bossu 12.26, ne odhadnuté: `queued_count` je
  `count(*) FILTER (WHERE state < 'active')`, `failed_count` je `state = 'failed'`,
  tedy MOMENTKY. `failed_count` proto po úklidu sám klesne a neukazuje navždy poruchu,
  která je dávno spravená. **`pgboss.queue_stats` se schválně nepoužívá:** vypadá jako
  správnější zdroj, ale je PRÁZDNÁ (ukládání snímků je volitelné a worker si ho nezapíná)
  a její oddíly končí dva dny zpátky, takže by hlásila nuly a tvářila se nejpřesněji.

  **ŽIVOST WORKERU SE NEMĚŘÍ NOVÝM MECHANISMEM.** Žádná nová tabulka, žádný heartbeat,
  žádné volání na health port. Bere se nejnovější ze tří značek, které posouvá sám
  pg-boss: `version.cron_on` (po 30 s), `version.flow_on` (jednotky sekund) a
  `queue.monitor_on` (po minutě). Health port workeru se schválně NEVOLÁ: potřeboval by
  novou konfigurační proměnnou, rozbil by se všude, kde web a worker nejsou na jedné
  síti, mlčel by o druhém workeru, a hlavně by nedostupný endpoint nešel odlišit od
  špatně nastaveného, tedy selhal by přesně v případě, kvůli kterému vznikl.

  **TŘI STAVY, NE DVA, A ČTVRTÝ JE JINÝ DRUH ODPOVĚDI.** `running` do dvou minut
  (dvojnásobek nejpomalejšího cyklu, kratší mez by blikala), `late` do deseti,
  `down` dál. **`unknown` NENÍ `down`:** znamená „nedalo se změřit nic" (chybějící
  schéma fronty, nedostupná databáze) a tvrdit v tu chvíli „worker neběží" by ukázalo
  prstem na nesprávnou součástku.

  **ODLOŽENÉ ÚLOHY JSOU SILNĚJŠÍ PŘÍZNAK NEŽ POČET SELHÁNÍ.** Panel se rozsvítí, i když
  worker běží, pokud v dead letter frontách něco leží: takové úlohy vyčerpaly všechny
  pokusy a nikdo je nevezme. Počet selhání naopak poplach NEDĚLÁ, protože po jedné
  špatné noci zůstane vysoký ještě týden.

  **OBNOVUJE SE JINAK NEŽ SEZNAM, a je to celý důvod, proč je to vlastní cesta v API.**
  Seznam se obnovuje jen dokud něco běží (rozhodnutí ze 7. 8. ráno, `refresh.ts`), což
  je u něj správně a u stavu workeru by bylo PŘESNĚ NAOPAK: zaseknutý worker se pozná
  v okamžiku, kdy neběží nic. Panel se proto ptá pořád, po 30 s, dokud je záložka vidět;
  perioda je delší než u seznamu, protože nejpomalejší měřená značka se hýbe po minutě.

  **LIMIT 50 UŽ NENÍ STROP, JE TO VELIKOST STRÁNKY.** Stránkuje se KURZOREM přes
  `updated_at`, ne offsetem: seznam se slévá ze dvou zdrojů a ořezává až po slití, takže
  `OFFSET 50` by v každém zdroji přeskočil padesátku jeho vlastních úloh, ne padesátku
  z výsledku. Obnovení nahrazuje první stránku a dolistovanou historii pod ní nechává;
  slévat by se nesmělo, protože slití nikdy nic neodebere a úloha, která z první stránky
  zmizela, by na obrazovce zůstala navždy. Věta pod seznamem tím přestala slibovat strop
  a říká, kolik je vidět teď.

  **Ověřeno:** 45 zelených v `apps/web/src/features/jobs` (z toho 8 nových na panelu,
  5 na stránkování, 2 na tlačítku „načíst starší"), 25 v `apps/web/test/api/jobs.test.ts`
  proti SKUTEČNÝM tabulkám pg-bossu (ne podvrženým: zakládá je `mlain migrate` a týž krok
  dává aplikační roli práva), 9 v `packages/ui/src/patterns/jobs`, typová kontrola obou
  balíčků, eslint, prettier, `i18n-check` (4 890 klíčů).
  **Ověřeno vypnutím u dvou nejdůležitějších rozhodnutí:** po odebrání filtru interní
  fronty hlásí test „expected 903 to be 3", po zdědění pravidla seznamu („obnovuj jen
  dokud něco běží") spadne test panelu na nezavolaném dotazu.
  **Vizuálně v prohlížeči** proti běžící aplikaci na `/w/petr-osobni-mail/jobs`: panel
  ukázal „Běží, naposledy se ozval v 16:28", 0 čekajících, 0 běžících, 4 142 selhání,
  1 odloženou úlohu, „Front v instalaci: 60, pravidelně tiká 22 z 30 cronových, 8 front
  nemá v téhle verzi obsluhu". Všechna ta čísla sedí na `pgboss` na řádek přesně.
  Stránkování prošlo naostro: s dočasně sníženou stránkou na 3 se seznam doklikal
  3 → 6 → 10 bez duplicit a bez děr, tlačítko na konci zmizelo a věta přešla
  z „Zobrazeno 3 úlohy, starší načtete tlačítkem dole" na „Zobrazeno 10 úloh".
  Kurzor ověřen i přímo proti API: 3 + 3 + 3 + 1 = 10, poslední stránka bez kurzoru.

- [x] **Úloha, která tvrdí „běží" a ve frontě k ní nic není, se od 7. 8. hlásí**
  (agent `ulohy-zbytky`). Naměřený případ z rána byl skutečný a v databázi pořád leží:
  import `3e78e4df` má v `imports` stav `importing` a v `pgboss.job` k němu není nic,
  takže Centrum úloh poctivě ukazuje ukazatel průběhu, který se nikdy nepohne (ověřeno
  v prohlížeči 7. 8. na `/w/petr-osobni-mail/jobs`).

  **Nový hlídač je `apps/worker/src/job-watch.ts`**, vedle `cron-watch.ts` a ze stejného
  materiálu: paměť hlášení (jednou za epizodu, návrat do pořádku jako `info`), chyba čtení
  hlídač neshodí, `unref()` na časovači, kontrola názvu schématu před vložením do dotazu.
  Kolo běží po pěti minutách a porovnává DVĚ STRANY: co si o sobě myslí doména
  (`listJobsClaimingToRun` v `platform/maintenance-scan.ts`, pod rolí `mlain_maintenance`)
  proti tomu, co doopravdy leží v `pgboss.job`.

  **MĚŘÍ SE STÁŘÍ, NE POUHÁ NEPŘÍTOMNOST**, a je to ta past, na kterou se hlídač dá napsat
  špatně: mezi zápisem doménového řádku a tím, než je úloha vidět, je vždycky okno, takže
  hlídač bez lhůty by hlásil každý čerstvě spuštěný import. Práh je dvojí podmínka: řádek
  se nehnul 15 minut A ZÁROVEŇ k němu ve frontě není nedokončená úloha. Patnáct minut je
  stejná dolní mez jako `CRON_SILENCE_FLOOR_SECONDS` a ze stejného důvodu: import píše
  checkpoint po tisíci řádcích, takže rozestupy v jednotkách minut jsou normální.

  **Hlídá se i stavba publika, protože ji dnešní hlídač kampaní NEVIDÍ.** `campaign.watchdog`
  má hned na začátku `if (!c.audienceBuiltAt) continue`, takže kampaň uvízlou ve stavu
  `queueing` PŘED postavením publika přeskočí. Plánovač ji přitom znovu nezařadí: zařazuje
  jen do doby, než kampaň opustí `scheduled`. Klíč fronty se skládá (`campaign.materialize:<id>`
  u kampaně, holé ID u importu) a shodu se šablonami v registru front měří test; kdyby se
  rozešly, hlídač by hlásil KAŽDOU běžící úlohu jako osiřelou.

  **SLEPÉ MÍSTO SE PŘIZNÁVÁ:** zabitý worker nechá svou úlohu ve stavu `active`, dokud ji
  nevyprší pg-boss (u importu šest hodin), takže do té doby hlídač mlčí. Chytit to jde
  jedině heartbeatem, který ani jedna z obou úloh nemá. Pokrytá je ta horší půlka: úloha,
  po které ve frontě NEZBYLO NIC.

  **`assertCrossWorkspaceVisibility` se u tohohle skenu ZÁMĚRNĚ nevolá.** Ten strážce patří
  ke skenu, který opravuje; tenhle jen hlásí a běží po pěti minutách, takže by na každé
  čerstvé instalaci (projekty jsou, importů nula) hlásil poruchu pořád dokola. Chybějící
  grant se projeví sám: dotaz skončí na `permission denied`, ne prázdnem.

  Ověřeno: 11 zelených v `apps/worker/test/job-watch.test.ts`, celá sada workeru 121 zelených,
  typová kontrola i eslint. **Ověřeno vypnutím**: bez porovnání s frontou spadnou 4 testy,
  po rozbití skládání klíče kampaně spadne test šablony.

- [x] **Odznak v hlavičce počítá jen to, na čem se PRÁVĚ TEĎ pracuje** (agent `ulohy-zbytky`).
  Rozpor byl mezi dvěma místy: `built-in-sources.ts` hlásí import čekající na člověka jako
  `paused` schválně, aby odznak neukazoval úlohu, která sama nikdy neskončí, jenže
  `RUNNING_STATUSES` v `packages/ui` i `RUNNING_JOB_STATUSES` v jádře braly `paused` jako
  běžící a rovnou to zase zrušily. Třetí kopie výčtu byla v `jobs.routes.ts` u filtru
  `running=true`.

  **Rozhodnutí: nejsou to dva výčty, jsou to DVA POJMY.** `UNFINISHED` je „úloha ještě
  neskončila" a dělí seznam na rozdělanou práci a historii; `paused` sem patří, protože
  rozdělaný import do historie nepatří. `RUNNING` je „právě teď se na tom pracuje" a jen
  podle něj svítí odznak. Obojí je v jádře i v návrhovém systému pod týmiž jmény, filtr
  API si výčet čte z registru a neopisuje ho.

  **Nadpis sekce se změnil z „Běží" na „Rozdělané"** (`In progress` v angličtině). Nadpis,
  který u pozastavené úlohy tvrdí „Běží", je přesně ten rozpor o patro níž.

  **Cestou druhá polovina téhož nálezu:** import ve stavu `pending`, tedy nahraný soubor
  s nedokončeným průvodcem, se hlásil jako `running`. Nahrání souboru přitom import
  NESPOUŠTÍ, do fronty se nezařazuje nic, dokud člověk neklikne na „Naimportovat"
  (`contacts/import/service.ts`). Nedokončený průvodce tedy rozsvěcel odznak „Běží 1 úloha"
  navždy, úplně stejně jako `previewing` před ním. Nově je `pending` taky `paused`.

  Ověřeno: 21 zelených v `apps/web/test/api/jobs.test.ts` proti skutečné databázi (nově
  i to, že `running=true` pozastavený import nevrací), 9 v `packages/ui/src/patterns/jobs`,
  30 v `apps/web/src/features/jobs`. **Ověřeno vypnutím**: s vráceným `paused` ve výčtu
  spadnou oba nové testy. Vizuálně v prohlížeči: sekce se jmenuje „Rozdělané".

- [x] **Testovací událost webhooku se doručuje CÍLENĚ, mimo fan-out** (agent `ulohy-zbytky`).
  Nález byl větší, než jak se popisoval. Cesta `POST /webhook-endpoints/{id}/test` totiž
  událost jen zapsala do `webhook_events` a **nikdy nezařadila `platform.webhook_fanout`**
  (na rozdíl od ostatních producentů, třeba `tracking/jobs/process-engagement.ts`). Řádek
  tedy jen ležel a doručení nevzniklo ANI JEDNO, ať endpoint odebíral co chtěl. Odpověď 202
  přitom tvrdila „zařazeno k doručení". Zaškrtnutí `ping` z 7. 8. tohle nespravilo, protože
  se nezařazovalo vůbec nic.

  **Vynechal se JEN výběr podle odběru.** Vzniklo `deliverEventToEndpoint` v `emit.ts`
  a vedle něj sdílené `enqueueDelivery`, které používá i fan-out: řádek ve `webhook_deliveries`
  (tedy log doručení i podklad pro ruční opakování), sdílené `created_at` kvůli idempotenci
  i oddílu tabulky, a zařazení `platform.webhook_deliver`, které podepisuje a opakuje. Kdyby
  si cílená cesta psala vlastní INSERT, měla by jinou obálku nebo by se neopakovala.

  **Na stav endpointu se nehledí, jen na to, že není smazaný.** Deaktivovaný endpoint je
  přesně ten, u kterého má člověk největší důvod tlačítko zmáčknout: chce zjistit, jestli
  jeho server zase odpovídá. Doručení samo stav nemění.

  Ověřeno: 2 nové testy v `packages/core/src/platform/webhooks/deliver-endtoend.test.ts`
  (doručí se i endpointu, který typ neodebírá, včetně PROTIDŮKAZU, že fan-out nad toutéž
  událostí vyrobí nula; a druhé kliknutí druhé doručení nevyrobí), 1 nový v
  `apps/web/test/api/webhook-endpoints.test.ts` proti skutečné databázi. 71 zelených
  v `platform/webhooks`, 12 v `webhook-endpoints.test.ts`, 37 v `features/webhooks`.
  **Ověřeno vypnutím**: bez cíleného doručení test hlásí „testovací událost nevyrobila
  žádné doručení".

- [x] **`ping` se přejmenoval na `webhook.ping` a z nabídky odběru zmizel** (agent
  `ulohy-zbytky`, rozhodnuto NARÁZ s cíleným doručením, jak si `katalog-udalosti` vyžádal).
  Jakmile testovací událost přestala chodit fan-outem, přestal mít odběr `ping` jakýkoli
  význam: zaškrtnutý by nic nezměnil a nezaškrtnutý by nic nebral. Popis u něj v nabídce
  („bez zaškrtnutí tlačítko nic nedoručí") by se navíc stal nepravdou.

  **Vznikla třetí kategorie katalogu, `TARGETED_WEBHOOK_EVENT_TYPES`.** Typ, který se
  VYDÁVÁ, ale NEODEBÍRÁ. Bez ní by hlídací test spadl na „vydává se něco, co katalog nezná"
  a jediná cesta ven by byla výjimka v testu; výjimka v hlídači je horší než pojmenovaná
  kategorie. Kontrola zápisu (`isAcceptedWebhookEventType`) cílený typ NEPŘIJÍMÁ, hlídač
  (`isKnownWebhookEventType`) ho zná.

  **Přejmenování bylo bezpečné a je doložené:** doručení s typem `ping` nemohlo existovat,
  protože se fan-out nikdy nezařadil. Starý tvar `ping` přesto zůstává v
  `RETIRED_WEBHOOK_EVENT_TYPES` i s důvodem, protože pár hodin 7. 8. šel zaškrtnout a kdo
  ho má uložený, musí svůj endpoint dál upravit. Tím zmizel jediný typ bez tečky a obchvat
  v katalogu i v hlídacím testu.

  Klíče `settings.webhooks.eventGroups.ping` a `events.ping` odstraněny z cs i en.
  Ověřeno: 17 zelených v `event-catalog.test.ts` (nově i test, že se cílený typ vydává,
  ale odebrat nedá, a že starý tvar zápisem projde), `i18n-check` 4 870 klíčů.
  **Pozor: mění se kontrakt** (nové `description` u cesty `/test`), `openapi.json` se musí
  přegenerovat.

- [x] **Pokračování zrušeného importu jde konečně spustit z rozhraní** (agent `ulohy-zbytky`).
  Nález byl o stupeň horší, než jak se zapisoval: tlačítko „Pokračovat od řádku N" na výsledku
  importu **existovalo od začátku a nemělo obsluhu**, takže kliknutí neudělalo vůbec nic.
  Nebyla to tedy schopnost, o které nikdo neví, ale mrtvé tlačítko, které slibovalo.

  **Rozhodnutí: zapojit, ne vypustit z API.** Pokračování zakládá nový import se stejným
  souborem, mapováním a checkpointem, tedy přesně to, co člověk po nechtěném zastavení nebo
  po pádu workeru chce; odstranit funkční a otestovanou schopnost by bylo dražší než
  doplnit obsluhu. Nový import je ve stavu `previewing` a sám se nerozjede, což je správně:
  mezi zrušením a pokračováním mohl uživatel změnit názor na volby. Rozhraní ho proto vezme
  do průvodce (`?import=<nové id>&step=mapping`) a spustí se až kliknutím na „Naimportovat".

  **Neúspěch se píše, ne mlčí.** Nejčastější příčinou je vypršelý soubor (nahrané CSV se
  po 30 dnech maže), takže hláška říká rovnou tohle a co s tím.

  **Potvrzovací okno zastavení přestalo lhát.** Věta „Znovu se pouští nahráním souboru
  odznova" (`common.jobs.cancelImportRest`) platila jen do dneška; nově slibuje tlačítko
  Pokračovat, které naváže od místa zastavení.

  Ověřeno: 2 nové testy v `import-result.test.tsx`, které měří ODESLANÝ POŽADAVEK a cíl
  přesměrování, ne existenci tlačítka. 32 zelených v `features/import`. **Ověřeno vypnutím**:
  bez obsluhy oba spadnou.

- [x] **Postup na detailu úlohy má oddělovač tisíců** (agent `ulohy-zbytky`). Klíč
  `common.jobs.progressOf` dostával holá čísla, takže na detailu stálo „1240 z 5000",
  zatímco potvrzovací okno zastavení hned vedle psalo „1 240 z 5 000". Opraveno u příčiny:
  `JobsLabels.progressOf` bere ČÍSLA, ne řetězce, a formátuje je aplikace přes
  `format.number`, protože locale zná jedině ona. Návrhový systém si je dřív vyráběl
  `String(job.done)`. Nový soubor `features/jobs/job-detail.test.tsx`, 3 zelené;
  test měří vykreslený text, ne to, čím se formátuje, a srovnává druhy mezer, aby neměřil
  verzi ICU. **Ověřeno vypnutím.**

- [x] **Mrtvý klíč `common.jobs.cancel` odstraněn** z cs i en (agent `ulohy-zbytky`).
  Ověřeno skenem všech klíčů `jobs.*` proti zdrojům: nepoužívá ho nic. Zastavení má vlastní
  klíče podle druhu úlohy (`cancelImport`, `cancelCampaign`), protože u kampaně je poctivější
  nadpis „Zrušit kampaň" než „Zrušit úlohu". **Týmž skenem vypadlo dalších sedm mrtvých
  klíčů, ty jsou jako nález v `STAV-UKOLU.md`.**

- [x] **Výběr řádků vede k akci i na dalších čtyřech obrazovkách, a pruh nad nimi přestal
  mluvit o kontaktech** (agent `hromadne-akce`). Zadání znělo projít všechny obrazovky se
  zaškrtávacím výběrem a u každé rozhodnout: akci doplnit, nebo výběr odebrat. Ověřeno 7. 8.
  testy (82 v pěti souborech, z toho 14 nových), typovou kontrolou, lintem, `i18n-check`
  a v prohlížeči.

  **MAPA, protože bez ní se opravují příznaky.** Zaškrtávátka má přesně těch devět míst,
  kde se vykresluje `DataTable`, a nikde jinde; Štítky, Segmenty i Šablony je nemají, protože
  ty obrazovky jsou karty, ne tabulka (u Štítků je to napsané rozhodnutí, ne náhoda).

  | Obrazovka | Výběr | Akce po 7. 8. |
  | --- | --- | --- |
  | Kontakty | ano | hotové dřív (`contacts/bulk-actions.tsx`) |
  | Blokované adresy | ano | hromadné odebrání, hotové dřív |
  | Kampaně | ano | **nově** hromadné smazání, viz položka níž |
  | Seznamy | ano | **nově** hromadná archivace |
  | Formuláře | ano | **nově** hromadné smazání |
  | Vlastní pole | ano | **nově** hromadná ARCHIVACE, mazání vědomě ne |
  | Přepisy jmen | ano | **nově** hromadné smazání |
  | Příjemci reportu | ano | **žádná a ani žádná nedává smysl**, viz `STAV-UKOLU.md` |
  | Galerie UI (dev) | ano | ukázka komponenty, ne obrazovka produktu |

  **Pravidla hromadného odstranění bydlí na JEDNOM místě** (`apps/web/src/lib/ui/bulk-removal.tsx`),
  ne v pěti kopiích. Jsou to čtyři věci, které se v kopiích rozejdou a pozná se to až
  v provozu: počet nese už tlačítko (ne až okno), při nule odstranitelných řádků stojí místo
  zašedlého tlačítka VĚTA proč, okno se po nezdaru nezavírá a řekne počet, a výběr se ruší
  jen po úspěchu. Znění dodává obrazovka, protože následek je u seznamu jiný než u pole.

  **U vlastních polí se hromadně ARCHIVUJE, nemaže, a je to vědomé rozhodnutí.** Mazání pole
  se u jednoho řádku ptá až poté, co si vyzvedne dopad (kolika kontaktů se to dotkne, nedrží
  ho naplánovaná kampaň?). Nad výběrem se ta věta říct nedá, u každého pole zní jinak, a
  vypsat dvanáct dopadů do jednoho okna znamená okno, které nikdo nepřečte. Hromadné mazání
  by tedy muselo dopad zamlčet. Okno archivace to říká nahlas větou, kde mazání hledat.

  **Přeskočené řádky se hlásí všude, kde vzniknout mohou:** archivovaný seznam ani archivované
  pole se archivovat podruhé nedá, takže se přeskočí a okno napíše kolik a proč.

  **Druhá polovina nálezu o slově „kontakty" ležela jinde, než se čekalo.** Zkrácení
  `common.table.selectedOnPage` na Seznamy, Formuláře, Vlastní pole, Přepisy jmen ani
  Blokované adresy nedosáhlo: těch pět obrazovek si bere popisky z `useContactsTableLabels`,
  který je čte z `contacts.selection.*`. Naměřeno v prohlížeči před opravou: nad tabulkou
  formulářů stálo „Vybrány 2 kontakty na této stránce." a hned vedle tlačítko „Smazat
  2 formuláře". Hook má proto nově volbu `selectionWording: 'generic'`, která ty tři věty
  vezme z `common.table`; Kontakty zůstávají beze změny. Po opravě naměřeno „Vybráno na této
  stránce: 1 | Smazat 1 formulář | Zrušit výběr".

- [x] **Multivýběr v Kampaních vede k akci: hromadné smazání rozepsaných** (agent `hromadne-akce`).
  Nález zadavatele doslova: „Multivýběr. Nemůžu s nimi nic dělat. Třeba je smazat, pokud jsou
  rozepsané. Jediné, co tam je, je vybrat všech 12, ale to mi je k prdu." Ověřeno 7. 8. testy
  (16 v `campaigns-screen.test.tsx`, z toho 6 nových), typovou kontrolou, lintem, kontrolou
  katalogů (`i18n-check`) a v prohlížeči na živých datech.

  **Zaškrtávátka kreslí `DataTable` VŽDYCKY a vypnout se nedají.** Není to volba obrazovky:
  sloupec se zaškrtávátkem je v tabulce natvrdo a žádná propa ho neruší. Kampaně si výběr
  nebraly ven (`selection` ani `bulkActions` nepředávaly), takže pruh nad tabulkou uměl
  jedině vybrat všechno a výběr zrušit. Totéž platí pro další obrazovky, viz nález
  v `STAV-UKOLU.md`.

  **Jediná hromadná akce je mazání, a je to záměr.** Přejmenování i úprava obsahu míří na
  jednu kampaň, duplikace deseti kampaní naráz je akce, kterou nikdo nechce, a pozastavení
  či zrušení rozesílky se dělá na obrazovce průběhu, kde je vidět, co se s kampaní děje.
  Ovládání, které slibuje víc, než co endpointy unesou, se nedodělávalo.

  **Tichý částečný úspěch se nemůže stát.** Výběr může obsahovat kampaně v jakémkoli stavu,
  ale smazat jde jen `draft` a `schedule_missed` (`campaign-state.ts`, týž výčet jako
  `DELETABLE_STATUSES` v jádru). Číslo proto nese už TLAČÍTKO („Smazat 1 kampaň", ne
  „Smazat"), potvrzovací okno navíc řekne, kolik jich zůstane a proč, a oznámení hlásí
  skutečný výsledek. Ověřeno v prohlížeči: při výběru rozepsané a odeslané kampaně stojí
  na pruhu „Vybráno na této stránce: 2" a vedle „Smazat 1 kampaň", okno má nadpis
  „Smazat 1 kampaň?" a větu „1 další označená kampaň zůstane, smazat ji nejde".

  **Hromadný endpoint v API není**, `DELETE /campaigns/{id}` je po jedné, takže se volá
  v cyklu. Nad seznamem kampaní to unese (desítky řádků), kdežto kontakty mají kvůli
  statisícům řádků vlastní úlohu na pozadí.

  **Výběr se ruší jen po úspěchu, a nikdy celý.** Kampaně, které se smazat nepodařily nebo
  se kvůli stavu ani nezkoušely, ve výběru ZŮSTÁVAJÍ: je to jediné, s čím se dá dál něco
  dělat. Ruší se přes `clearToken`, protože režim „vybráno všech N" bydlí uvnitř `DataTable`
  a vynulování pole `selectedIds` ho nezruší.

- [x] **Tvar karty srovnán podle zadavatele: identifikátor má první řádek sám pro sebe
  a nikdy se nezkracuje** (agent `mobil-skorapka`). Zadavatel odmítl mezistav slovy:
  „Začal zkracovat texty, aby tabulka byla kompaktnější, a tím pádem není vidět vůbec
  třeba e-mail. Nejdůležitější věc, ten se nesmí nikdy zkrátit."

  **Závazný tvar karty, platí ve všech seznamech:**

  1. **První řádek je identifikátor a nic vedle něj.** U kontaktů adresa, u kampaní
     a šablon název. Zalomí se přes víc řádků (`overflow-wrap: anywhere`, u adres nutné,
     protože nemají mezery), **nikdy se neuřízne třemi tečkami**. Zkrácená adresa je
     k nepoznání od jiné adresy téhož zákazníka.
  2. **Doplňkové údaje jdou pod něj** jako dvojice popisek a hodnota, ne jako sloupce.
  3. **Odznak stavu je až ZA identifikátorem**, ne vedle něj. Dřív ho vytlačoval.
  4. **Nabídka „…" je v pravém horním rohu karty**, mimo tok (`absolute`), aby byla
     vždycky na stejném místě a nepřetlačovala obsah. Řádek jí drží místo vnitřním
     okrajem, jinak by pod ni dlouhá adresa podtekla.
  5. **Prázdná hodnota se nekreslí vůbec**, ani jako popisek s prázdnem. Kontakt bez
     jména měl na kartě řádek „JMÉNO" a za ním nic, což vypadá jako chybějící data.
     Poznat to musí i CSS (`:has(>*:last-child:empty)`), protože buňka často vrací
     `<span>{row.name ?? ''}</span>`, tedy element, který se vykreslí naprázdno.

  **Zkracování si nese sama buňka od obrazovky** (`truncate` na odkazu v `contacts-table`),
  takže se ruší i uvnitř buňky, ne jen na jejím obalu. Bez toho by pravidlo platilo na
  prázdný obal a text by se pořád uřízl.

  **Ověřeno na DLOUHÉ adrese, ne na krátké.** Založen kontakt
  `petr.novak.dlouhy.testovaci@nejaka-hodne-dlouha-domena-na-test.example.cz` (73 znaků):
  na 390 px se vysází celý na tři řádky (buňka 290 × 68 px), `overflow` je `visible`,
  `white-space` `normal`, `overflow-wrap` `anywhere`, tři tečky se neuplatní. Prázdný
  řádek „JMÉNO" u něj zmizel, nabídka sedí v rohu, stránka nepřetéká (375 = 375).
  **Kontakt se nepodařilo uklidit**: hromadné mazání ve sdíleném prohlížeči třikrát
  nedoběhlo, protože záložku průběžně přebíral jiný agent. Je v seznamu k úklidu.

- [x] **Zmenšení písma u DAT odvoláno, zůstalo jen u nadpisů, mezer a ikon** (agent
  `mobil-skorapka`). Zadavatel: „Karta nese víc údajů než dnešní úzký sloupec, takže
  zmenšení písma ztrácí smysl a text má být zase čitelný."

  `--text-ui`, `--text-body`, `--text-meta` a `--text-label` se na úzkém displeji vrátily
  na desktopové hodnoty. Zmenšené zůstávají `--text-display`, `--text-h1` až `--text-h3`,
  `--text-callout`, `--text-lead`, kresba ikon a vnitřní okraje: tam jde o místo, ne o data.
  **Vedlejší dobrý následek:** zmizelo těch 32 řádkových odkazů, které se zmenšením
  stupnice ztratily 2 až 3 px klikací plochy.

- [x] **Tabulky se na telefonu kreslí jako KARTY, ne jako zúžená mřížka** (agent `mobil-skorapka`).
  Zadavatel označil tabulky za nepoužitelné: „Text přes sebe nesmí přetékat."

  **Naměřeno před opravou** (390 px, rám tabulky 343 px): obsah řádku Kontaktů 755 px
  (skryto 412), Šablon 900 px (skryto 557), Segmentů 720 px, Kampaní 677 px, Štítků 520 px,
  Seznamů 437 px, Formulářů 382 px. Z e-mailu kontaktu bylo vidět jedno písmeno.

  **Vybrány karty, ne vodorovný posuv s ukotveným prvním sloupcem**, a důvod je spočítaný:
  po odečtení zaškrtávátka a ukotveného e-mailu zbývá na osm sloupců 240 px, tedy 30 px na
  sloupec. Ukotvení řeší „podle čeho řádek poznám", neřeší „co se v něm dá přečíst". Cena je
  ztráta srovnávání sloupců mezi řádky; nad 768 px zůstává tabulka beze změny, takže se
  porovnává tam, kde na to je místo.

  **Role sloupců rozhoduje jedna čistá funkce** (`mobileRoles`), ne každá ze sedmi obrazovek:
  první sloupec je hlavní údaj, sloupec s `id` `actions` nebo `action` je nabídka řádku,
  další nejvýše tři jsou doplňkové a zbytek se na kartě nekreslí. Obrazovka to smí přebít
  hodnotou `mobile` u sloupce. Pro Kontakty to znamená e-mail, jméno, oslovení a stav;
  potvrzení, seznamy, štítky a datum jsou na kartě pryč a zůstávají v detailu kontaktu
  a v nastavení sloupců.

  **Tři věci, které karta musí ustát a které se snadno přehlédnou:**

  1. **Virtualizace se na kartách VYPÍNÁ.** Počítá s pevnou výškou řádku 44 px, kdežto karta
     má tři řádky textu: karty by se překryly a text by ležel přes text. Tohle je nejspíš
     přesně to „text přes sebe", co bylo vidět. Rozvržení dělá CSS (`max-md:`), tohle jediné
     musí vědět JavaScript, proto `useCardMode` s `matchMedia`.
  2. **Nabídka „…" zůstává** na prvním řádku karty vedle hlavního údaje. Je to jediná cesta
     k akcím řádku, takže se neschovává ani jako devátý sloupec.
  3. **Skrytý sloupec se odstraní, neschová `sr-only`.** V buňce může být tlačítko a `sr-only`
     prvek zůstává zaostřitelný: uživatel by tabuloval do ovládání, které není vidět.
     Hlavičky sloupců naopak `sr-only` JSOU, aby je čtečka v mřížce neztratila.

  **Segmenty a Šablony mají VLASTNÍ tabulku, ne `DataTable`**, takže dostaly totéž zvlášť.
  Segmenty: čtyři sloupce se pod 768 px lámou na dva řádky. Šablony: pět sloupců se láme na
  tři řádky, přičemž název a nabídka „…" mají první řádek určený natvrdo (`col-start`,
  `row-start`), jinak by nabídka spadla úplně dolů doleva, tedy nejdál od palce. U obou
  platí minimální šířka (`720px`, `900px`) až od `md` a hlavička sloupců se pod 768 px
  nekreslí: řádek se láme, takže by názvy nestály nad ničím a jen by zabraly dva řádky
  verzálek. Ani jedna z nich není mřížka s rolí `grid`, takže o hlavičky nepřijde čtečka.

  **Ověřeno v prohlížeči na 390 px:** vnitřní vodorovný posuv zmizel na Kontaktech, Kampaních,
  Formulářích, Seznamech, Segmentech i Šablonách (rám i obsah 343 px, dřív 343 proti 755
  na Kontaktech a 343 proti 900 na Šablonách). **Zbývají Štítky** (358 proti 520): mají také
  vlastní tabulku, ale soubor leží v `features/contacts`, kde v tu chvíli pracoval jiný agent,
  takže jsem do něj nesáhl. Je to jednořádková změna téhož tvaru, zapsaná v oddílu 2.8. Pruh
  hromadného výběru se na 390 px zalomí a nepřeteče (345 px obsahu v 345 px rámu), takže
  čerstvá práce agenta `filtr-kontaktu` zůstala celá. **Testy:** `mobile-roles.test.ts`
  (5 nových) a `data-table.cards.test.tsx` (7 nových), celkem 102 zelených v `packages/ui`.
  Do `packages/ui/vitest.setup.ts` přibyla podlaha pro `window.matchMedia`, kterou jsdom nemá;
  táž je v `apps/web` a ze stejného důvodu.

- [x] **Menší písmo, ikony a vnitřní okraje na úzkém displeji, řízené TOKENY** (agent
  `mobil-skorapka`). Zadání: „Texty, ikony a věci musí být celkově menší, jinak se to tam
  nikdy nevejde."

  Přepis proměnných v jedné media query v `tokens.css` (`max-width: 767px`). Utility Tailwindu
  sázejí `font-size: var(--text-h1)`, takže jedna změna platí všude naráz; dvacet obrazovek
  s vlastním `text-2xl md:text-4xl` by se do měsíce rozešlo. **Ověřeno odečtem z prohlížeče:**
  nadpis obrazovky má na 390 px 27 px a na 1024 px zase 36 px.

  Nadpisy dolů výrazně (36 → 27, 26 → 21, 40 → 30), rozhraní mírně (15 → 14), vnitřní okraje
  karet 30 → 18. **Písmo pod 12 px, mezery pod 15 px a VŠECHNY klikací plochy zůstaly.**

  **Změřeno, ne odhadnuto:** porovnáním rozměrů všech tlačítek, odkazů a zaškrtávátek na šesti
  obrazovkách proti témuž stavu s vrácenou desktopovou stupnicí. Ani jeden prvek s tokenem
  `min-h` se nezmenšil; 44 zůstalo 44, 40 zůstalo 40, 36 zůstalo 36. Zmenšilo se 32 prvků,
  všechny o 2 až 3 px, a všechny jsou to **řádkové odkazy a tlačítka bez vlastní výšky**,
  jejichž rámeček je výška řádku textu (kritérium 2.5.8 má pro odkazy v textu výjimku).
  U jednoho případu to nestačilo a je opravený: **hlavní údaj na kartě má klikací plochu
  44 px** (dřív 22 px), protože to je to, na co uživatel na telefonu míří.

- [x] **Mřížky s tvrdým minimem přepsané jedním průchodem, 25 výskytů** (agent `mobil-skorapka`,
  oddíl 2.5). `repeat(auto-fit,minmax(360px,1fr))` se nezúží pod 360 px, jen přeteče ven ze
  stránky; správně je `minmax(min(360px,100%),1fr)`, tedy minimum, které se umí vzdát.
  **Náhrada nebyla slepá:** vzor `repeat(auto-fit,…)` se nahradil, kdežto tři PEVNÉ mřížky
  editoru (`grid-cols-[220px_minmax(360px,1fr)_300px]`) zůstaly, protože u nich `min()`
  neřeší nic a rozbil by je. Zbylá dvě `minmax(360px, 1fr)` v repozitáři jsou text komentáře.

- [x] **Tři nálezy po změně barev potvrzení dořešeny: věta o nevratnosti u seznamu je
  pravdivá, tabulka 6.2 srovnána s aplikací, sedmnáct oken prošlo obrazovku po obrazovce**
  (agent `navrh-soulad`, oddíl 4). Navazuje na `potvrzeni-barva` z téhož dne.

  **1. Archivace seznamu je doopravdy nevratná, věta zůstává.** Ověřeno v kódu, ne odhadem:
  do tabulky `lists` píšou jen čtyři místa (`update`, `archive`, `setDefault`, `clearDefault`
  v `repo/lists.ts`) a ani jedno nevrací `deleted_at` na NULL; obnovovací trasa v
  `lists.routes.ts` neexistuje a `update` archivovaný seznam navíc odmítne přes `requireLive`,
  takže ho nespraví ani PATCH. **Šablony a kontakty obnovu mají** (`templates/repository.ts:610`,
  `contacts.ts:803`), seznamy ne, takže to není opomenutí v mém hledání. `irreversible`
  se proto píše VÝSLOVNĚ, ne výchozí hodnotou, i s tímhle dokladem v komentáři: dokud
  se pravda nerozhodne nahlas, vypadá k nerozeznání od zapomenutí, a přesně na tom nález stál.

  **2. Rozpor mezi 6.2 a aplikací srovnán ve prospěch APLIKACE, opravena tedy tabulka.**
  Pravidlo znělo „přísnější aplikace s důvodem = oprav dokument", a důvod tu je u obou řádků.
  *Smazání štítku:* tabulka mu dávala obnovitelnost 1, jenže `deleteTag` maže řádek natvrdo
  (`DELETE FROM tags`) a kaskádou s ním i všechna přiřazení, obnovovací trasa ani koš
  neexistují. N1 znamená „provést a nabídnout Vrátit zpět", takže by tlačítko slibovalo něco,
  co nemá čím splnit; dřív se to dělo a vrácení jen obnovilo stránku. Nově obnovitelnost 2,
  součet 2, N2. *Odebrání člena týmu:* tabulka mu dávala obnovitelnost 0 („plně vratné"),
  jenže členství se maže natvrdo a vrácení znamená projít znovu pozvánku nebo formulář
  založení člena, tedy ruční zopakování, u kterého si správce musí pamatovat i roli a druhá
  strana musí znovu potvrdit. Kolega přitom ztrácí přístup okamžitě, takže okno na vrácení
  nemá co vzít zpátky. Nově obnovitelnost 1, součet 2, N2; nevratné to ale NENÍ (účet ani
  jeho práce se nemažou), takže věta o nevratnosti v okně zůstává vypnutá, jak ji
  `potvrzeni-barva` nastavil. **Do obou poznámek pod tabulkou je zapsané i to, co se nesmí
  zaměnit:** „Odebrání štítku" v 6.6 je jiná akce (sundání štítku z kontaktů) a vratná zůstává.

  **3. Sedmnáct oken projito jedno po druhém, nic se neztrácí a nic se kliknutím mimo
  neprovede.** Prošel jsem všechna volání s `destructive={false}` a u každého obsluhu
  zavření: všude je to čistý ústup (`setOpen(false)`, `setPendingRemoval(null)`,
  `setPendingValue(null)`), nikde se na zavření nic neodesílá a hromadné akce nepřicházejí
  o výběr řádků. **Podezření na ztrátu rozdělané práce se u „změny oslovení" a „změny jazyka
  oslovení" NEPOTVRDILO:** obě okna jsou čisté potvrzení, vyplňuje se mimo ně (přepínač,
  respektive nic), takže zavřením nemizí žádný text. **Vyplňované pole nese z těch sedmnácti
  JEDINÉ okno,** omezení a uvolnění zpracování podle článku 18, kde je odůvodnění do auditu
  povinné. Ani tam se nic neztratí: text drží spouštěč (`useState` v
  `ProcessingRestrictionButton`), ne dialog, komponenta zůstává připojená i po zavření
  a po znovuotevření je odůvodnění zpátky. Kliknutí mimo se tím chová stejně jako Zrušit
  a Esc, které to uměly odjakživa, takže změna z 5.3 nepřinesla ztrátu nikde.

  **Ověřeno.** Nový test `processing-restriction-button.test.tsx` („kliknutí mimo okno
  rozepsané odůvodnění neztratí") píše text, zavře okno kliknutím mimo, ověří, že se
  nic neodeslalo, a po znovuotevření čeká text zpátky. **Ověřen dočasným rozbitím:**
  s vyprázdněním poznámky na zavření spadne na `toHaveValue`, po vrácení je zelený.
  Klikat se musí na kořenový prvek, ne na `body`: user-event si výsledek kontroly
  `pointer-events` pamatuje na prvku a `body` ho má z dřívějších testů v souboru
  zkažený z doby, kdy nad ním okno stálo. Dál 6 testů omezení zpracování, 42 v okruhu
  seznamů (`list-detail`, `lists-table`), 9 u členů, 25 v onboardingu, `tsc` v `apps/web`
  čistý, `i18n-check` v souladu (4830 klíčů) a `prettier` na dotčených souborech čistý.

  **Opraveno mimochodem, byla to nepravda v komentáři:** u okna ukázkových dat stálo
  „Ukázková data se zakládají, ne mažou", jenže to okno se ptá na jejich ODSTRANĚNÍ
  (nadpis „Odstranit ukázková data?", potvrzení volá `removeDemoDataAction`). Verdikt
  `destructive={false}` platí dál a je teď zdůvodněný pravdivě: sada se dá jedním kliknutím
  nahrát znovu a na adresy example.com nikdy nic neodešlo. **Zbylá díra je zapsaná
  do `STAV-UKOLU.md`:** okno neříká, že s ukázkovou sadou zmizí i to, co do ní uživatel dopsal.

- [x] **Dodávaná instalace uklízí oddíly SAMA; do teď to nedělala vůbec** (agent
  `provoz-nalezy`). `mlain partitions` uměl úklid odeslané pošty jedině z plánovače
  hostitele, jenže `docker/compose.yml` ani `compose.scale.yml` žádný plánovač nemají
  a na PaaS ho nejde ani doplnit. Retence tedy v dodávané instalaci **neběžela nikde**,
  `messages.render_data` s údaji příjemců v ní leželo navěky a po čtyřech měsících by
  přestaly procházet zápisy, protože se nezakládá další oddíl. Nález doktoru z 7. 8. tu
  vadu jen zviditelnil; každá instalace z našeho compose by ho hlásila napořád.

  **Řešení: vrátila se fronta `platform.maintain_partitions`** (cron `5 2 * * *`,
  politika `exclusive`, `deadLetter`), obsluha v
  `packages/core/src/ops/jobs/partition-jobs.ts`. Je to **jediná fronta, která se kdy
  vrátila ze seznamu zrušených**, takže je u ní v registru i v `RETIRED_QUEUES` napsaný
  celý příběh, ať to nikdo neotočí zpátky.

  **Proč ne kontejner s cronem v compose,** což byla první nabízející se možnost:
  pravidelnou práci v tomhle produktu dělá worker přes pg-boss a je to jediný mechanismus,
  který funguje na všech třech způsobech nasazení. Kontejner s cronem by byl čtvrtý způsob
  a na PaaS by stejně nepomohl.

  **Proč původní námitka („worker na DDL nemá práva") už neplatí.** Obsluha neběží pod
  aplikační rolí: `maintainPartitions()` si otevře vlastní spojení pod
  `DATABASE_URL_MIGRATOR`, takže `mlain_app` žádné právo na DDL nedostává. Není to nová
  výjimka, `platform.backup` ve workeru pod migrátorem běží od P16 (pod aplikační rolí by
  `pg_dump` narazil na row level security). Fronta a `mlain partitions` volají TÝŽ kód,
  liší se jen popiskem aktéra v auditu, aby se poznalo, která z nich běžela.

  **Vedlejší nález, na který se přišlo cestou a je vážnější než původní zadání:**
  `compose.scale.yml` dával workeru JEN `DATABASE_URL`. V rozděleném režimu tedy tiše
  nefungovaly tři věci naráz: noční záloha (chybí migrátor), plánovač kampaní a úklid
  projektů (chybí `DATABASE_URL_MAINTENANCE`, tedy **naplánovaná kampaň se neodešle**)
  a výmaz podle článku 17 (chybí `DATABASE_URL_GDPR`, žádost zůstane nevyřízená
  s běžící zákonnou lhůtou). V `MODE=all` se to neprojevilo, protože tam všechno běží
  v kontejneru `app`, který proměnné má. Doplněny všechny tři i s vysvětlením u každé.

  Ověřeno: `packages/core/test/ops/partition-job.test.ts` (4 testy, včetně kontroly, že
  bez migrátora úloha spadne NAHLAS místo tichého neuklizení), `test/queues` (67),
  `apps/worker` (110, z toho `handler-coverage` potvrzuje, že fronta obsluhu má).
  Každá oprava ověřena i obráceně, dočasným vrácením: bez záznamu v registru padnou dva
  testy, bez kontroly na chybějící migrátor dva.

- [x] **Doktor hlídá i ověřování záloh, tedy jedinou frontu, na kterou hlídač ticha
  nedosáhne** (agent `provoz-nalezy`). `platform.backup_verify` tiká TÝDNĚ a pg-boss maže
  dokončené úlohy po sedmi dnech, takže delší ticho než týden se z tabulky úloh doložit
  nedá; hlídač ve workeru si ho proto schválně netvrdí a je to v jeho hlavičce napsané
  jako přiznané slepé místo. Audit ten strop nemá, `backup.verified` v něm leží měsíce.

  **Tři nálezy, ne dva, a ten třetí je ten důležitý.** `no_backup_verify_yet`
  a `backup_verify_stale` kopírují dvojici u oddílů. Přibyl ale `backup_verify_failed`:
  úloha totiž zapisuje auditní záznam **i tehdy, když ověření neprošlo** (`ok: false`),
  takže instalace, které se ověření každou neděli nepovede, má záznam čerstvý a podle
  stáří by vypadala v pořádku. Klid odvozený z pravidelně nastávající poruchy je to
  nejhorší, co může diagnostika říct. Týká se to i **už zapsaného nálezu z 6. 8.**, že
  nedělní ověření v zabundlovaném obrazu nejspíš padá na chybějící cestě k migracím.

  **Čerstvá instalace mlčí.** Ověření tiká v neděli, takže „ještě nikdy" je šest dní po
  nasazení správný stav; nález se proto opírá o stáří PRVNÍ zálohy. Instalace, která
  nezálohuje vůbec, patří nálezu `no_backup_yet` z kontroly úložiště, ne sem.

  Ověřeno: `doctor-maintenance.test.ts` (11 rozhodovacích případů) a
  `doctor-maintenance.db.test.ts` (11 proti skutečné databázi, včetně čtení `ok`
  z metadat). Obráceně ověřeno odpojením kontroly: padnou čtyři testy.
  Katalog kódů srovnán z 26 na 29 s důvodem v testu.

- [x] **Chyba v plánu systémové pošty, krok 4 rozhodnutí R2, opravena v TEXTU PLÁNU**
  (agent `provoz-nalezy`). Plán předepisoval číst „nejstarší nesmazaný projekt instalace
  s použitelným účtem" přes `withoutContext`. To by **spadlo potichu**: `withoutContext`
  neznamená „bez row level security", jen „bez nastaveného `mlain.workspace_id`", a
  `workspaces` má politiku `ws_isolation_self`, `sending_providers` má `ws_isolation`.
  Oba dotazy by pod aplikační rolí vrátily nula řádků, což by nevypadalo jako chyba, ale
  jako správná odpověď „instalace nemá žádný projekt s použitelným účtem". Žádná výjimka,
  žádný log, jen uživatel, kterému nepřijde obnova hesla.

  Doplněno přímo do sekce R2, ne jen do hlavičky plánu: kdo si přečte R2, musí se to
  dozvědět tam. Napsané je i to, proč se to neopravilo migrátorskou rolí (držet ve
  webovém procesu spojení obcházející izolaci projektů kvůli jedné výjimečné situaci by
  bylo horší než ta chybějící zpráva) a co z toho zbývá otevřené (na instalaci, ze které
  ještě žádná systémová zpráva s projektem neodešla, je klíč `systemMail.workspace_id`
  prázdný).

- [x] **Retence pro `imports` a `campaign_audience_progress`: ROZHODNUTO NEDĚLAT**
  (agent `provoz-nalezy`), a je to rozhodnutí podložené schématem, ne odklad.

  `campaign_audience_progress` má `campaign_id` jako PRIMÁRNÍ KLÍČ, tedy **jeden řádek na
  kampaň**, a cizí klíč s `ON DELETE CASCADE` na kampaň i na projekt. Růst je shora
  omezený počtem kampaní a smazaná kampaň si svůj řádek odnese. Retence by tu byla
  aktivně škodlivá: smazala by průběh kampaně, která pořád existuje, a u rozestavěného
  publika i `cursor_contact_id`, tedy místo, od kterého se pokračuje.

  `imports` je řádek na jeden import, tedy jednotky až stovky za rok na projekt. Osobní
  data z něj **už dneska mizí**: nahraný soubor po 30 dnech (`import_files`) a chybové
  řádky po 90 (`import_errors`). Zbývá záznam o tom, co uživatel udělal, a ten má stejnou
  povahu jako audit.

  Kdyby to zadavatel přesto chtěl, správné místo je `RETENTION_DEFAULTS`
  (`contacts/retention/registry.ts`) jako nový cíl per projekt, **ne údržba oddílů**:
  `imports` není partitionovaná a partitionovat tabulku s desítkami řádků měsíčně by
  bylo drahé zbytečně. Zapsáno do `STAV-UKOLU.md` jako rozhodnutí, ne jako otevřený úkol.

- [x] **Typy odchozích událostí mají uzavřený katalog na jednom místě v jádře**
  (agent `katalog-udalosti`). Nabídka v rozhraní a to, co produkt doopravdy vydává, se
  prokazatelně rozešly a nic na to neupozornilo: formulář nabízel tři typy
  (`contact.created`, `contact.subscribed`, `contact.unsubscribed`), produkt jich vydává
  **patnáct**, a `contact.created` z té trojice **nevydával nikdo**. Odběr se navíc proti
  ničemu nevalidoval, takže prošel i překlep. Doručování porovnává typ prostým
  `= ANY(event_types)`, takže se to projevilo jediným způsobem: zaškrtnutý webhook mlčky
  nikdy nedorazil.

  **Katalog je `packages/core/src/platform/webhooks/event-catalog.ts`** a čte z něj kontrola
  zápisu (`endpoint-service.ts`) i nabídka na obou stránkách webhooků. `MVP0_EVENT_TYPES`
  v `apps/web` zrušen. Do nabídky přibylo dvanáct typů, které si zákazník dosud mohl
  zaškrtnout jedině přes API: `contact.suppressed`, `message.opened`, `message.clicked`,
  `campaign.sending_started`, `campaign.sent`, `campaign.paused`, `campaign.resumed`,
  `campaign.schedule_missed`, `campaign.schedule_delayed`, `provider.status_changed`,
  `domain.verification_changed`, `brand.extraction_completed` a `ping`.

  **`ping` v nabídce je vedlejší oprava mrtvého tlačítka.** „Poslat testovací událost" vydá
  událost typu `ping` a fan-out ji doručí jen odběratelům toho typu. Nabídka `ping` neměla,
  takže tlačítko u endpointu založeného přes rozhraní **nikdy nic nedoručilo**. Teď jde
  zaškrtnout a popis u něj říká, že bez zaškrtnutí tlačítko nic nepošle.

  **Kontroluje se JEN PŘI ZÁPISU, nikdy při doručování**, a důvod je zapsaný přímo v kódu:
  kontrola v doručování by po přejmenování nebo zrušení typu ze dne na den umlčela každý
  endpoint, který ho má uložený, a majitel by to poznal až tím, že mu přestaly chodit
  události. Druhá půlka téhož slibu: typ, který na endpointu **už leží**, projde vždycky,
  takže kontrola nemůže zamknout data, která sama pustila dovnitř.

  **`contact.created` se z nabídky odstranil, ne přidal do vydávaných.** Jediné místo, které
  ví o vzniku kontaktu (`contacts/repo/contacts.ts:546`), je společná cesta pro API,
  formulář i **import**, takže vydávat odtud událost by z importu sta tisíc kontaktů udělalo
  sto tisíc událostí a sto tisíc doručovacích úloh. Zůstává ale v seznamu vysloužilých typů,
  které zápis dál přijímá, aby endpoint založený v době MVP0 šel dál upravovat.

  **Odmítnutí nese SEZNAM platných typů, ne „neplatná hodnota".** Překlep
  `contact.subscribe` místo `contact.subscribed` se jinak nepozná. U blízkého tvaru se navíc
  navrhne konkrétní oprava (Levenshtein, práh třetina délky, nejvýš tři znaky), a to jak
  v textu hlášky, tak strojově v `params.suggestions`; `params.allowed_event_types` nese
  celý katalog.

  **Hlídací test neopisuje seznam, odvozuje ho z kódu:**
  `packages/core/src/platform/webhooks/event-catalog.test.ts` čte zdroje `packages/core/src`
  a hledá literály předané do `emitWebhookEvent` a do portů `emit`. Hlídá obě strany
  (vydávaný typ mimo katalog i katalogový typ, který nikdo nevydává) a má prázdný seznam
  výjimek s důvody, ve stejném duchu jako `apps/worker/test/handler-coverage.test.ts`.
  Mez metody je v hlavičce napsaná: skládané jméno události (`` `contact.${verb}` ``) je pro
  ni neviditelné, a proto zakázané.

  Ověřeno: 15 zelených v `event-catalog.test.ts`, 11 zelených v
  `apps/web/test/api/webhook-endpoints.test.ts` proti skutečnému Postgresu (včetně nových
  případů 422 na POST i PATCH a 201 pro vysloužilý typ), 37 zelených v
  `apps/web/src/features/webhooks`. Obě opravy ověřeny **dočasným vrácením**: bez zápisu do
  katalogu i bez volání kontroly příslušný test spadne. Vizuálně zkontrolováno v běžící
  aplikaci na `/settings/webhooks`: patnáct typů v sedmi pojmenovaných skupinách, u každého
  česky napsané, co znamená.

- [x] **Červená přestala být výchozí barvou potvrzení a stala se rozlišovacím znakem**
  (agent `potvrzeni-barva`). `ConfirmDialog` kreslil potvrzovací tlačítko VŽDYCKY
  `variant="destructive"` a `Dialog` dostával natvrdo `destructive`, takže „Archivovat pole"
  i „Archivovat seznam" vypadaly jako mazání. Nález šel přes celou aplikaci: 32 volání
  potvrzovacího okna, všechna červená.

  **Rozhodnutí: barva se neodvozuje z `level`, ale z nového POVINNÉHO propu `destructive`.**
  Stupnice N2/N3/N4 z 6.1 říká, kolik TŘENÍ akce dostane (okno, zaškrtávátko, opisování),
  ne jak dopadne. „Archivovat seznam" i „Odeslat kampaň" jsou obojí N2. Barva proto navazuje
  na osy téže kapitoly: červená patří akcím s obnovitelností 2 (něco z projektu zmizí
  a rozhraní ani API to nevrátí) nebo s vnějším dopadem 2 (odejde ven k lidem, pustí ven
  zablokovanou poštu). Druhá stupnice tím nevzniká, jen se z 6.1 čte i to, co se dosud nečetlo.

  **Prop je povinný, ne s výchozí hodnotou.** Výchozí „destruktivní" je přesně to, co tenhle
  nález způsobilo: zapomenutí je neviditelné a nakazí celou aplikaci. Výchozí „nedestruktivní"
  by zas u zapomenutého mazání sundalo červenou. Povinný prop znamená, že se rozhodnout MUSÍ,
  a hlídá to `tsc`, ne revize. Ochranu akce stejně nenese barva, ale úroveň a text: princip P4
  i 8.6.3 říkají, že nevratnost musí být napsaná doslova, „nikdy jen červené tlačítko".

  **Červená zůstala u 16 volání:** smazání formuláře, kontaktu, hromadné smazání kontaktů,
  smazání pole (jen když ho nedrží naplánovaná kampaň), sloučení štítků, smazání štítku,
  smazání projektu, rotace i zneplatnění klíče k API, smazání klíče k AI, smazání osiřelého
  účtu, odebrání adresy z blokovaných, odeslání kampaně, přepsání obsahu kampaně šablonou,
  odchod z rozepsaného nastavení kampaně, smazání šablony, odhlášení všech zařízení (kvůli
  následku „rozepsané formuláře na jiných zařízeních se ztratí").

  **Barvu primární akce dostalo 17 volání:** archivace pole, archivace seznamu, odebrání člena
  z projektu, vypnutí dvojího potvrzení u formuláře, smazání výjimky v oslovení, odebrání
  štítku z kontaktů, hromadné potvrzení čekajících, omezení a uvolnění zpracování, opětovné
  přihlášení k odběru, potvrzení kontaktu, odebrání ze seznamu, změna oslovení, změna jazyka
  oslovení, založení ukázkových dat, a větev smazání pole, kde je jedinou dopřednou akcí
  archivace.

  **Příznak `destructive` na `Dialog` prošel taky.** Nedělá nic vizuálního: žádnou ikonu,
  žádný červený rámeček, žádné zvláštní ohlášení čtečce. Jediné, co dělá, je zákaz zavření
  kliknutím mimo, což pravidlo 5.3 chce jen u destruktivních. Dosud to platilo pro všechna
  potvrzení, takže i „Archivovat seznam" se nedalo odklepnout kliknutím vedle; teď se zavírá.
  Chování je zdokumentované v hlavičce propu, aby jméno neslibovalo víc, než dělá.

  **Ověřeno.** Dva nové jednotkové testy v `confirm-dialog.test.tsx` (destruktivní potvrzení
  má `bg-danger`, nedestruktivní `bg-primary` a nikdy `bg-danger`) a jeden v `dialog.test.tsx`
  (nedestruktivní dialog se zavírá kliknutím mimo, protějšek existujícího testu pro
  destruktivní). Oprava dočasně vrácena zpět, test spadl přesně na barvě archivace, pak
  vrácena. Vizuálně na dev instalaci přes Playwright, měřena `getComputedStyle`:
  „Archivovat pole Firma?" má potvrzení `rgb(228, 194, 88)`, „Smazat pole Firma?" na TÉŽE
  obrazovce `rgb(164, 67, 44)`, „Archivovat seznam VIP?" `rgb(228, 194, 88)`. Dál typecheck
  `packages/ui` i `apps/web` (povinný prop dokazuje, že se nevynechalo žádné volání),
  `i18n-check` v souladu a devět dotčených testovacích souborů `apps/web` zeleně (196 testů).

  **Opraveno mimochodem:** okno „Odebrat člena z projektu" tvrdilo „Tuhle akci nejde vzít
  zpět" ze zapomenuté výchozí hodnoty, a přitom třetí následek ve stejném okně popisuje cestu
  zpět novou pozvánkou. Věta je pryč (`irreversible={false}`), texty se neměnily.

- [x] **Mobilní skořápka: pod 768 px se boční menu odstraní z rozvržení a otevírá se tlačítkem**
  (agent `mobil-skorapka`). Zadání znělo „nemáme absolutně mobilní verzi frontendu"; tohle je
  etapa skořápky, tedy toho, co je na každé obrazovce.

  **Co bylo naměřeno před opravou** (Chrome, 390 × 844, tedy `clientWidth` 375 px po odečtení
  posuvníku): hlavní sloupec měl 299 px, z toho 269 px obsahu, protože si zabalené boční menu
  bralo 76 px, tedy pětinu displeje. Přehled přetékal na `scrollWidth` 477 px, detail kontaktu
  na 431 px, Centrum úloh na 377 px. Kontakty, Kampaně, Šablony a Seznamy dokument nepřetáhly,
  ale jen proto, že jejich tabulka roluje ve vlastním rámu: v 343px rámu leželo 755 px obsahu
  (Kontakty, deset sloupců), takže z e-mailu bylo vidět jedno písmeno. Editor kampaně přetékal
  na 1231 px kvůli vlastnímu `min-w-[1140px]`.

  **Řešení.** Menu se pod 768 px nezmenšuje, ODEBÍRÁ SE (`hidden md:block` na obalu) a otevírá
  se tlačítkem v hlavičce do vysouvacího panelu (`packages/ui/src/patterns/shell/nav-drawer.tsx`).
  Panel stojí na `Dialog` z Radixu, který už v projektu je: dává past na fokus, Escape, zámek
  skrolování stránky pod panelem a návrat fokusu na spouštěcí tlačítko. **Menu se přitom kreslí
  z JEDNOHO místa**, funkce `renderNavigation` ve skořápce, takže se obě podoby nemůžou rozejít.
  Panel se zavírá při změně cesty, ne v obsluze kliknutí: cesta se změní i po tlačítku Zpět
  a po přesměrování ze serverové akce.

  **Dělící šířka je `md` (768 px), ne `sm`.** Na tabletu na výšku se 76px pruh ikon vejde
  a trvale viditelná navigace je lepší než tlačítko; pod 768 px se nevejde nic. Zabalení
  menu mezi 768 a 1023 px řídí dál `matchMedia`, jak to bylo.

  Cestou opraveny dvě věci, bez kterých by hlavička na telefonu nedávala smysl: jméno
  uživatele se pod 640 px skrývá (bralo si 160 px, zůstávají iniciály a `aria-label`)
  a karta posledních kampaní na Přehledu má pod 640 px dva sloupce místo čtyř (pevných
  90 + 90 + 130 px se dvěma mezerami je 340 px do 283 px místa; **tohle je jediný zásah
  do cizí obrazovky a patří k revizi Přehledu**).

  **Ověřeno v prohlížeči, 19 adres × 3 šířky.** Na 390, 768 i 1024 px platí
  `scrollWidth == clientWidth` na Přehledu, Kontaktech, detailu kontaktu, Kampaních,
  Nastavení, Šablonách, Seznamech, Segmentech, Štítcích, Formulářích, Knihovně médií,
  Statistikách, Centru úloh, Odesílání, Značce projektu, Importu, Reportu kampaně
  a Připravenosti k odeslání. **Jediná výjimka je editor kampaně**, který přetéká i na
  1024 px kvůli vlastnímu `min-w-[1140px]`; je to jeho vlastní rozhodnutí a samostatné zadání.
  Hlavní sloupec vzrostl z 299 na 375 px, tedy na celou šířku displeje. Hlavička se vejde
  i na 320 px (`scrollWidth` hlavičky se rovná její šířce), tlačítko menu měří 44 × 44 px
  a hranice funguje přesně: na 767 px je tlačítko, na 768 px pruh ikon.

  **Testy:** `nav-drawer.test.tsx` (5 nových, zavřený panel nevykreslí obsah, Escape i křížek
  zavírají, klikací cíl drží token `--size-target-min`) a dva nové ve `workspace-shell.test.tsx`
  (obal menu nese `hidden md:block` a v panelu je menu rozbalené; změna cesty panel zavře).
  **Obě opravy ověřeny dočasným vrácením zpět:** bez `hidden md:block` spadne první,
  bez zavírání na změnu cesty druhý. Celkem 11 zelených ve skořápce webu, 33 v `packages/ui`,
  143 v okruzích `features/shell` a `features/reports`. `tsc`, `oxlint`, `eslint`
  i `prettier` čisté.

- [x] **`exportContactsAction` už neexistuje, nález byl neaktuální** (agent `posledni-nalezy`,
  oddíl 4). Nález agenta `stitky` ze 6. 8. mluvil o akci, která byla opravená už 5. 8.
  v commitu `bab2967`. Dnešní tvar je `createContactExportAction`
  (`features/contacts/actions.ts:77`): posílá `filter: audience` z `export-audience.ts`
  a `columns: EXPORT_COLUMNS`, tedy přesně to, co `CreateExportRequest` žádá.
  Grep po `exportContactsAction` a `exportContactAction` v `apps` i `packages` vrací už jen
  odkazy v komentářích a v názvech testů, ani jedno volání.
  **Ověřeno:** `export-audience.test.ts` a `actions.test.ts` zelené (39 testů); mezi nimi
  „export posílá publikum a sloupce, ne ids ani filtry seznamu", který tvrdí o TĚLE
  požadavku, ne o návratové hodnotě podvrženého serveru.
  **Cestou opraven červený test, který nebyl můj:** `actions.test.ts` hlídá, že výčet `CALLS`
  pokrývá všechny exportované akce souboru, a po doplnění obrazovky přepisů jmen v něm
  chyběly `upsertNameOverrideAction` i `deleteNameOverrideAction`. Doplněny.

- [x] **`POST /api/v1/name-overrides` umí hodnotu VYMAZAT** (agent `posledni-nalezy`, oddíl 4).
  Zápis rozlišuje vynechané pole od `null`: **vynechané = „nech, jak bylo", `null` = „vymaž"**.
  Do dneška obojí splývalo, protože `ON CONFLICT` dosazoval
  `coalesce(excluded.x, name_overrides.x)`, a překlep v pátém pádu šel z přepisu dostat
  jedině smazáním celého řádku a jeho založením znovu.

  **Výsledné hodnoty se skládají v TypeScriptu, ne v SQL**, a je to vynucené: do dotazu
  přijde vynechání i `null` stejně, tedy jako `NULL`, takže je SQL rozlišit neumí. Stávající
  řádek se proto načte dopředu (`SELECT` ve stejné transakci) a `ON CONFLICT` zapisuje už
  hotový výsledek (`excluded.x`, bez `coalesce`).

  **Kontroluje se VÝSLEDEK, ne vstup.** `ck_name_overrides__has_value` žádá rod nebo vokativ.
  Vymazání poslední zbývající hodnoty by prošlo validací vstupu a spadlo až na 23514, tedy
  na 500. Teď vrací 422 s větou, co udělat místo toho.

  **Zpětná slučitelnost fronty kontroly oslovení ošetřena na volajícím**
  (`vocative-review/actions.ts:244`). `overrideValuesFor` vrací u akce `set_gender` vokativ
  vždycky `null` a u `confirm` ho vrací `null`, když fronta žádný nenavrhla. S novou
  sémantikou by to znamenalo mazání, takže by potvrzení rodu tiše zahodilo pátý pád, který
  si uživatel do slovníku uložil dřív. Null se proto na tomhle jediném místě převádí na
  vynechané pole.

  **Obrazovka přestala být výmluva.** Alert v dialogu říkal „prázdné pole hodnotu NEMAŽE",
  teď říká, že vymaže, a k tomu jediné, co zbylo z omezení: rod a pátý pád nesmí zmizet oba
  naráz. Texty v `packages/i18n/messages/{cs,en}/contacts.json`, klíč `clearHint`.

  **V OpenAPI je ten rozdíl popsaný**, protože z tvaru schématu ho nikdo nepozná: popis
  u `gender`, `vocative` i `note` a u celé operace. **Kontrakt se tím mění, `openapi.json`
  se musí přegenerovat** (je to už v oddílu 5 „Před commitem").

  **Ověřeno:** nový `test/repo/name-overrides.test.ts` proti PostgreSQL, 6 zelených
  (vynechané pole nechá hodnotu, `null` ji vymaže, diakritika ani velikost písmen nerozhodují,
  vymazání poslední hodnoty se odmítne a řádek zůstane celý, založení bez rodu i vokativu se
  odmítne, druh jména je součást klíče). Po dočasném vrácení `coalesce` **spadl test o mazání**.
  Nový `test/api/name-overrides.routes.test.ts`, 3 zelené: měří, CO PŘESNĚ dojde do
  repozitáře, protože rozdíl se dá ztratit už ve validaci těla (kdyby zod chybějící klíč
  doplnil na `null`, dopadlo by každé vynechání jako mazání). Zelené i `vocative-review`
  a celé `test/naming` (211 testů), `name-overrides-table.test.tsx` (8) a `actions.test.ts`.

- [x] **Vodorovné přetečení na 390 px: skořápka opravená, zbytek je v obsahu obrazovek**
  (agent `posledni-nalezy`, oddíl 4). **Nález mířil vedle.** Vinil boční menu a hledací pole
  `min-w-[280px]`, ale měření ukázalo, že hlavní sloupec má na 390 px šířku **139 px**, do
  kterých se nevejde ani nadpis stránky, takže přetéká skoro všechno, co v něm stojí.
  Doloženo na obrazovce BEZ tabulky i bez hledání: Nastavení mělo `scrollWidth` 636 px proti
  `clientWidth` 375 px.

  **Tři příčiny ve skořápce, všechny opravené.** (1) Boční menu se nesbalovalo: 236 px.
  Pod 1024 px se teď sbalí samo na 76 px (`workspace-shell.tsx`, `matchMedia`), uloženou
  volbu to nepřepisuje a po zvětšení okna se menu vrátí tam, kde ho uživatel měl. Tlačítko
  zabalení se v tom stavu nenabízí, protože by nic neudělalo. (2) Vnitřní okraj hlavního
  sloupce byl pevných 40 px na každé straně, tedy 80 px z 375. Pod 640 px je 15 px
  (`app-shell.tsx`). (3) Hlavička měla pevné mezery 30 px a nesmrštitelný název produktu
  145 px. Pod 640 px se název skrývá (značka zůstává), mezery jsou 15 px a přepínač projektů
  se zkracuje třemi tečkami (`topbar.tsx`, `workspace-switcher.tsx`).

  **Čtvrtá příčina je vzorec, ne jedno místo.** `grid-cols-[repeat(auto-fit,minmax(360px,1fr))]`
  je TVRDÉ minimum: když je sloupec užší, mřížka se nezúží, jen přeteče. V repozitáři je ten
  vzorec asi na třiceti místech s hodnotami 200 až 380 px. Opraveno na `minmax(min(360px,100%),1fr)`
  tam, kam agent směl sáhnout: `settings-page-shell.tsx` (pokrývá všechny obrazovky Nastavení)
  a `assets-library.tsx`. **Zbytek je mechanický přepis a patří do jednoho sedu, až bude strom
  klidný**, viz oddíl 2 v `STAV-UKOLU.md`.

  **Ověřeno v prohlížeči na 390 px, před opravou a po ní:** Kontakty 558 → **375**,
  Nastavení 636 → **375**, tedy nula přetečení. Regrese je unit test
  (`workspace-shell.test.tsx`): pod 1024 px je menu zabalené a tlačítko zabalení zmizí, nad
  1024 px je rozbalené a jde zabalit ručně. Po dočasném vrácení opravy test spadl. Šířku
  jsdom nespočítá, měří se proto rozhodnutí, ne pixely.
  **Cestou:** `window.matchMedia` v jsdom neexistuje, doplněna podlaha do `vitest.setup.ts`,
  aby se kvůli tomu nemusel měnit produkční kód.

- [x] **Šest HTTP volání na vlastní API rozebráno, přesunuto do oddílu 2.6** (agent
  `posledni-nalezy`, oddíl 4). Zadání znělo neopravovat, ale prozkoumat, jestli jde volat
  doménovou vrstvu přímo, a napsat odhad a rizika. **Doporučení: přímo NE, v procesu ANO.**

  **Proč ne přímo do `packages/core`.** HTTP vrstva neobstarává jen přenos: ověření relace,
  sestavení `WorkspaceContext`, `assertPermission` u každé cesty, validaci zod, převod chyb
  na RFC 9457 a presentery na DTO. Volající v Next.js by si to musel udělat sám, tedy zdvojit
  kontrolu oprávnění mimo místo, kde se dnes hlídá, a kontrakt OpenAPI by přestal popisovat,
  co se doopravdy děje. **Bezpečnostní riziko převažuje nad ziskem.**

  **Střední cesta:** `buildApp().request(...)` v procesu. Ušetří TCP kolo na loopback
  i parsování HTTP a NEOBEJDE nic z toho výš. `buildApp` je běžný export z `lib/api/openapi`,
  ze serverové komponenty dosažitelný; pozor jen na to, že se aplikace skládá líně a cachuje
  se v modulu route handleru (`app/api/v1/[[...route]]/route.ts:35`), takže si ji druhý
  volající nesmí postavit znovu.

  **Nejmenší první krok je jinde a je nejlevnější:** relace se dnes ověřuje u KAŽDÉHO
  z šesti volání zvlášť. Ověřit ji jednou za vykreslení (React `cache()`) je pár řádků
  a nesahá na architekturu. Odhady: měření a `cache()` půl dne, `app.request()` 1 až 2 dny,
  přímé volání domény se nedoporučuje. Zapsáno do oddílu 2.6 `STAV-UKOLU.md`.

- [x] **Chybějící webhooky doručení, odrazu a stížnosti rozebrány, přesunuto do oddílu 2.7**
  (agent `posledni-nalezy`, oddíl 4). Zadání znělo rozhodnout, jestli je to na dnešek, a
  zdůvodnit. **Není, a důvod je jiný, než nález tvrdil.**

  **Nález popisoval menší práci, než jaká to je.** Tvrdil, že infrastruktura je hotová
  a chybí jen vydání tří událostí. Chybí ale i jejich ZDROJ: `message_events` typu
  `delivered`, `bounced_hard`, `bounced_soft` a `complained` mají v repozitáři jen čtenáře
  (přehled kampaně, segmenty, časová osa) a ani jednoho zapisovatele. Příjem událostí od
  poskytovatele není zapojený, `setSnsWebhookDeps` nikdo nevolá a fronta
  `provider_event.process` nemá obsluhu; říká to přímo `providers/api/sns-webhook.ts:28`
  a `tracking/jobs/queue-handlers.ts:77`. Doručení a odraz se tedy dnes nikam nezaznamenají.

  **Dobrá zpráva k validaci odběru: katalog typů událostí neexistuje.** `event_types` je pole
  volných řetězců, jediné omezení je 1 až 50 položek (`platform/webhooks/endpoint-service.ts:118`),
  takže nové typy nemají čím neprojít. Samo vydání je pár řádek: `emitWebhookEvent` plus
  zařazení `platform.webhook_fanout`, přesně jak to dělá `tracking/jobs/process-engagement.ts:375`.

  Odhad: příjem a zpracování 2 až 3 dny, tři webhooky nad hotovým příjmem půl dne. Zapsány
  i dvě pasti, které jsou v kódu už popsané: událost ke zprávě bez řádku v `messages`
  (systémová pošta) se musí zahodit, ne shodit dávku, a opakované doručení téže události
  od poskytovatele nesmí vydat webhook třikrát.

- [x] **Návrhový systém má u klikací plochy JEDNO pravidlo** (agent `posledni-nalezy`,
  oddíl 4). `DESIGN-ZAKLAD.md` měl tři různá čísla: kapitola 5 „44 px, nikdy pod to", token
  `--size-control` 40 px s poznámkou „pole filtru" a kapitola 9 „32 px je jediná výjimka".
  Ani jedno nebylo celé pravdivé, takže se každá obrazovka rozhodovala sama.

  **Co v aplikaci doopravdy platí** (zjištěno z kódu, ne z příručky): `IconButton` má čtyři
  velikosti, 44 / 40 / 36 / 34 px, k tomu kotva na časové ose 32 px a zaškrtávátko 16 nebo
  18 px. Prvky na 40 px si klikací plochu roztahují **neviditelným překryvem** na 44 px
  (`filter-picker.tsx`), 36 a 34 px ji nemají.

  **Nová kapitola 1.12** říká jedno pravidlo (klikací plocha samostatného prvku 44 px,
  viditelná velikost může být menší), ukazuje ten překryv jako doporučený způsob, ne jako
  náplast, a **vyjmenovává výjimky v tabulce i s důvodem**. Opraveny obě místa, která si
  odporovala (kapitola „Co se nesmí" a bod 9 v pastech).

  **Opravena i nepravda o WCAG, kvůli které se rozhodovalo špatně.** Příručka brala 44 px
  jako povinnost. Kritérium 2.5.8 na úrovni AA žádá **24 px**; 44 px je 2.5.5 na úrovni AAA
  a naše domácí laťka. Proto se dají výjimky nad 24 px obhájit, ale musí být zapsané.

  **Zaškrtávátko jde na výjimku ODSTUPEM, ne velikostí**, a je to změřené: v tabulce kontaktů
  16 × 16 px a **63 px mezi středy** sousedních, tedy víc než dvakrát tolik, kolik kritérium
  žádá. Zapsáno včetně toho, kdy výjimka přestane platit (když se cíle přiblíží pod 24 px).
  **V kódu se kvůli tomu nic neměnilo**, protože srovnanému pravidlu nic neodporuje.

- [x] **Úklid oddílů po sobě nechává stopu a `mlain doctor` na ni kouká** (agent
  `hlidani-uklidu`, oddíl 2.2b). Ověřeno testy proti PostgreSQL i dočasným vrácením oprav.

  **Proč to bylo potřeba.** `mlain partitions` je jediné místo, kde se uklízí odeslaná pošta,
  a pouští ho plánovač hostitele. Po úspěšném běhu nezůstalo NIC: výpis spolkne plánovač,
  tabulky se jen zmenší. Provozovatel tedy neměl jak zjistit, že mu retence týden neběžela
  a `messages.render_data` s údaji příjemce leží přes lhůtu.

  **Zapisuje se i běh, který nic nezahodil.** Nula zahozených oddílů je běžný a správný
  výsledek, protože lhůta zatím nikomu neuplynula. Kdyby se zapisovaly jen běhy, které něco
  smazaly, vypadala by správně fungující instalace stejně jako ta, kde úklid vůbec neběží.
  Auditní akce je `partition.maintained`, záznam je globální (`workspace_id` NULL, aktér
  `system` s popiskem `mlain partitions`) a nese počty, ne jména oddílů.

  **Běh nanečisto se zapsat NESMÍ a odmítá se to v jádře, ne až v CLI.** Záznam o běhu,
  který schválně nic neudělal, by v doktoru vypadal jako doklad o úklidu, tedy by uklidnil
  přesně ve chvíli, kdy data leží přes lhůtu.

  **Nálezy v doktoru jsou dva, ne jeden**, a kopírují zálohu (`no_backup_yet` a `backup_stale`):
  `no_partition_maintenance_yet`, když v auditu není jediný záznam, a
  `partition_maintenance_stale`, když je poslední starší než dva dny. „Ještě nikdy" znamená
  nenastavený plánovač hostitele, „přestalo to běžet" znamená selhávající běhy, a to je jiná
  práce. **Hranice dvou dnů je záměr:** úklid má běžet denně a jeden vynechaný den je běžná věc
  (restart stroje, delší upgrade, posunuté okno plánovače); varování, které chodí planě, se
  přestane číst.

  **Nepovedený zápis do auditu příkaz neshodí a nekončí nenulovým kódem.** Úklid v tu chvíli
  UŽ proběhl a nenulový kód by o něm lhal, takže by provozovatel opakoval hotovou práci.
  Ztráta je vidět jinde: bez záznamu začne doctor do dvou dnů hlásit, že údržba neběží.

  Doloženo `test/ops/doctor-maintenance.db.test.ts` (5 zelených proti skutečné databázi, včetně
  toho, že rozhoduje NEJNOVĚJŠÍ záznam a že bez `DATABASE_URL_MIGRATOR` se hlásí „nezjištěno",
  ne „v pořádku"), `test/ops/doctor-maintenance.test.ts` (5, hrana dvou dnů) a rozšířeným
  `src/ops/partition-retention.test.ts` (12). Ověřeno vypnutím: bez odmítnutí běhu nanečisto
  a s dotazem seřazeným obráceně spadly právě ty testy, které to hlídají. Dokumentace:
  `docs/operations/partitions-retention.md`, nová kapitola 4.1 (a opravená věta „nic vás na to
  neupozorní", která od dneška neplatí).

- [x] **Hlídač ticha cronových front: hlásí i frontu, do které se netiká vůbec** (agent
  `hlidani-uklidu`, oddíl 2.2d). Ověřeno 21 testy v `apps/worker/test/cron-watch.test.ts`
  a dočasným vrácením každé ze tří klíčových částí.

  **Co chybělo.** Dosavadní hlídač chytal frontu, která DRŽÍ nedokončený tik. Opačný případ,
  tedy fronta, do které nepřišel tik žádný, po sobě v tabulce úloh nenechá nic, takže nebylo
  co měřit. Přitom je to horší porucha: zaseknutý tik je aspoň vidět, kdežto po zastaveném
  plánování se kampaně prostě přestanou odesílat.

  **Perioda se počítá z výrazu cronu** (`packages/core/src/queues/cron-period.ts`), protože
  jeden společný práh pro plánovač kampaní (tiká po patnácti sekundách) i pro týdenní ověření
  zálohy neexistuje: buď by u toho rychlého mlčel dva dny, nebo by u toho týdenního hlásil
  poruchu každý den. `cron-parser` se nepoužil schválně: je v `node_modules` jen jako
  tranzitivní závislost pg-bossu a vrací příští okamžiky, ne periodu. **Kde se odhaduje,
  odhaduje se vždy směrem k delší periodě**, tedy k delší toleranci: planý poplach je horší
  než pozdní. Test v jádře hlídá, že KAŽDÝ cron v registru má spočitatelnou periodu, protože
  fronta s nesrozumitelným výrazem by z hlídání vypadla tiše.

  **Past ze zadání pokrytá jinak, než zadání čekalo: výčet hlídaných front se čte
  z `pgboss.schedule`, ne z registru.** Cronové fronty bez obsluhy a fronty s nezapojenou
  obsluhou (`needsDependencies`) se od 7. 8. schválně neplánují a jejich plán se ruší, takže
  tabulka plánů JE přesně ten seznam, který z toho rozhodnutí vyšel. Opsat ten výběr podruhé
  do hlídače by znamenalo, že se obě strany při první změně rozejdou. Ověřeno vypnutím:
  s výčtem z registru spadlo 7 z 21 testů.

  **Čerstvá instalace není porucha.** Když fronta nemá ani jednu úlohu, měří se ticho od
  chvíle, kdy se NAPLÁNOVALA (`schedule.created_on`), ne od začátku času. Ta značka přežije
  restart workeru, na rozdíl od doby běhu procesu, takže se hlídač nevynuluje při každém
  nasazení. **Přiznané slepé místo:** pg-boss maže dokončené úlohy po sedmi dnech, takže delší
  ticho než týden se z tabulky doložit nedá a hlídač ho netvrdí. Prakticky to znamená, že
  týdenní `platform.backup_verify` (tolerance tři týdny) tímhle hlídačem hlídaný není; ten má
  vlastní stopu v tabulce `backups` a v auditu.

  **Zastavený plánovač se hlásí JEDNOU VĚTOU, ne dvaceti.** pg-boss si posouvá značku
  `pgboss.version.cron_on` po třiceti sekundách; když stojí ona, stojí všechny fronty a vypsat
  je jednu po druhé by znamenalo dvacet řádků o jediné příčině.

  **Každé hlášení chodí jednou za epizodu, ne každých pět minut.** Přímé použití poučení
  z `outbox.reconcile` (3 993 shodných selhání za čtyři dny, kterých si nikdo nevšiml): hlídač
  si drží paměť vydaných hlášení, hlásí při prvním nálezu a pak až po tom, co se fronta
  rozběhla a zastavila znovu. Návrat do provozu se hlásí taky, jednou a jako `info`, jinak by
  z logu nešlo poznat, jestli porucha trvá. Týká se to i staršího hlídače zaseknutých tiků
  a nepovedeného čtení tabulky, které se po pěti minutách taky nespraví.

- [x] **Systémová pošta odejde i účtem typu SES** (agent `systemova-posta`, plán
  `plans/2026-08-05-systemova-posta-ses.md`, body 1 až 5). Ověřeno vizuálně na dev instalaci,
  jednotkovými testy `system-mail-ses.test.ts` a `system-mail-headers.test.ts` (27 zelených)
  a databázovými testy `system-mail-delivery.db.test.ts` (7) a `doctor-runtime.db.test.ts` (14).
  Podrobnosti a co zbývá jsou v oddílu 2.2 `STAV-UKOLU.md`.

  **Co bylo špatně:** `SYSTEM_MAIL_CAPABLE_TYPES` byl `['smtp']` a komentáře u něj tvrdily,
  že klient SES existuje jen v odesílači napsaném v Go. To přestalo platit dřív, než si toho
  kdokoliv všiml: `@aws-sdk/client-sesv2` je v `packages/core` kvůli ověřování domén. Instalace
  po průvodci má typicky jediný účet typu SES, takže neodešla pozvánka, obnova hesla ani
  ověření adresy ve zkušebním režimu, a obrazovka Nastavení → Systémová pošta to hlásila jako
  známé omezení produktu. Přibylo jedno volání `SendEmailCommand` s hotovým MIME.

  **Pořadí účtů se otočilo.** Do teď mělo přednost SMTP před výchozím účtem, protože jen SMTP
  odeslalo. Nově rozhoduje `is_default`: když odešlou oba typy, je správná odpověď ta, kterou
  si uživatel zvolil jako výchozí, jinak by systémová pošta chodila z jiné domény, než jakou
  v nastavení vidí.

  **Uživatel bez projektu se dostane k obnově hesla.** Projekt systémové pošty instalace bydlí
  v `system_settings.settings.systemMail.workspace_id` a plní se sám při každém úspěšném výběru
  účtu. Dotaz „najdi nejstarší projekt instalace", který plán navrhoval, jde pod aplikační rolí
  do prázdna kvůli RLS; nález je v oddílu 4 `STAV-UKOLU.md`.

- [x] **Štítky nešlo hromadně odebrat a akce nad seznamy byly rozházené mezi rozbalovátko
  a dvě tlačítka** (agent `filtr-kontaktu`). Nález zadavatele: „Když vyberu nějaké kontakty
  a dám přidat štítek, tak už ho nejsem schopen hromadně u kontaktů zrušit. (…) Mělo by to
  být jako option v tom selectu. To samé přesunout do selectu: Přidat X kontaktů do seznamu,
  Odebrat X kontaktů ze seznamu." Ověřeno 7. 8. testy (21 v `bulk-actions.test.tsx`), typovou
  kontrolou, lintem a v prohlížeči včetně skutečného odebrání a vrácení štítku na živých datech.

  **Server odebírání uměl od začátku a katalog na něj měl i slova.** `POST /contacts/tags:bulk`
  bere `add` i `remove` a vrací `tagged` a `untagged`; serverová akce `bulkTagContactsAction`
  parametr `remove` přijímala. Používalo se ale JEDINĚ v nabídce „Vrátit zpět" po přidání, tedy
  na místě, kam se uživatel sám nedostal. V katalogu navíc ležely nepoužité klíče `bulk.removeTag`
  („Odebrat štítek") a `bulk.tagRemoved` („Štítek {tag} odebrán."). Nepsal se tedy žádný nový
  kód na serveru ani žádné nové znění, jen se zapojilo, co existovalo.

  **Z rozbalovátka se stala nabídka akcí, a to je změna vzorce.** Dřív rozbalovátko vybíralo CÍL
  a tlačítko vedle něj AKCI, takže nabídka bez tlačítka byla slepá a tlačítko bez nabídky nemělo
  kam mířit. Teď nese obojí jedna nabídka se dvěma skupinami. **Není to `Select`, ale
  `DropdownMenu`**: rozbalovátko, jehož volba rovnou provede nevratnou operaci, je past, protože
  ho čtečka ohlásí jako výběr hodnoty a klávesnice v něm mezi položkami přejíždí, takže by se
  odebrání spustilo i pouhým projetím šipkami. Vzhled spouštěče zůstal, aby to pro uživatele
  byl pořád „ten select".

  **Nebezpečí, že se „Brno" splete s „Brno", řeší tři nezávislé signály, ne text položky:**
  nadpis skupiny („Přidat štítek" versus „Odebrat štítek", u seznamů rovnou s počtem kontaktů),
  čára mezi skupinami a červená barva položek v odebírací skupině. Nad tím stojí čtvrtý: odebrání
  se ptá dialogem úrovně N2, který akci pojmenuje nahlas („Odebrat štítek Brno u 1 kontaktu?").
  Nadpis skupiny si kreslí `DropdownMenuGroup` sám z jediného `label`, takže se viditelný text
  nemůže rozejít s tím, co dostane čtečka.

  **Proč u odebrání štítku dialog, když přidání má jen nabídku vrácení.** Vrácení přidání je
  přesný opak. Vrácení ODEBRÁNÍ přesné není: přidalo by štítek všem označeným, tedy i těm, kdo
  ho nikdy neměli, protože rozsahem akce je výběr, ne množina kontaktů, kterých se změna doopravdy
  dotkla. Tlačítko „Vrátit zpět" by tedy slibovalo návrat do stavu, který neumí.

  **„Seznam musí kontakt nějaký mít" JÁDRO NEVYNUCUJE, ověřeno.** `lists` je
  v `ContactUpsertRequest` nepovinné (`schemas.ts:160`) a žádná podmínka minimálního počtu
  v repozitáři seznamů není. Akce se proto nezakazuje, ale okno odhlášení nově spočítá a řekne,
  kolik označených kontaktů zůstane bez jediného seznamu. Počítá se z dat, která už tabulka má
  (`subscribed_list_ids`), takže kvůli tomu neodchází další dotaz na server.

- [x] **Pruh výběru: zkrácený text a zrušení výběru přesunuté na konec** (agent `filtr-kontaktu`).
  Přání zadavatele: „Vybrat všech 7 kontaktů odpovídajících filtru změň na: Vybrat všech X
  kontaktů. Zrušit výběr přesuň na konec za poslední tlačítko Smazat." Ověřeno 7. 8. testy
  a měřením v prohlížeči.

  **Zkrácení se týkalo ČTYŘ klíčů, ne jednoho.** Vedle `contacts.selection.selectAllMatching`
  (plurál se čtyřmi větvemi) i věty PO výběru `contacts.selection.allMatching`, jinak by půlka
  pruhu zůstala zkrácená a půlka ne. A protože tytéž věty v obecné podobě používají Kampaně,
  Segmenty i Příjemci reportu, zkrátily se i `common.table.selectAllMatching`
  a `common.table.selectedAllMatching`. Ta druhá měla navíc v OBECNÉM popisku slovo „kontaktů",
  takže tabulka kampaní hlásila „Vybráno všech 12 kontaktů"; při zkrácení to zmizelo.

  **Bezpečnostní rozdíl z 6.5 zkrácením nezanikl.** Past („uživatel zaškrtne hlavičku, myslí si,
  že vybral 50 řádků, a smaže 50 000") drží dvojice „na této stránce" proti „všech", identitní
  barva pruhu a dialog mazání, který filtr pořád vypisuje slovy. Hlídá to test, který obě věty
  porovnává vedle sebe.

  **Přesun platí v OBOU režimech.** Zrušení stálo hned za textem, tedy před akcemi, a v režimu
  „vybráno na stránce" nebylo vůbec. Teď je až za slotem `actions`, což je jediný způsob, jak
  „za poslední tlačítko" zařídit, když akce dostává pruh zvenčí jako jeden celek. Pořadí v DOM
  se shoduje s viditelným pořadím, takže totéž platí pro průchod klávesnicí; hlídá to test, který
  porovnává index zrušení s indexem mazání a s délkou řady.

  **Vedle červeného mazání se to nesplete.** Změřeno v prohlížeči: mazání je vyplněné červené
  tlačítko vysoké 36 px, zrušení je tichý odkaz vysoký 24 px v tlumené barvě. Na úzkém okně
  (900 px) se pruh zalomí do tří řad, zrušení skončí vedle mazání na poslední řadě a nic
  nepřetéká (`scrollWidth` pruhu i stránky se rovná jejich šířce).

- [x] **Sloupec akcí na obrazovce vlastních polí zabíral víc místa než celý zbytek řádku**
  (agent `pole-akce`, nález zadavatele ze 7. 8.: „Tohle je strašně velké a zabírá moc místa.
  Ten text ‚Pole zmizí z nabídek…‘ dej někam jinam, ne do akcí. Ty tlačítka předělej jen na
  ikony s tooltipem."). Ověřeno `apps/web/src/features/contacts/fields-table.test.tsx`
  (17 zelených, 3 nové případy) a prohlídkou obrazovky v prohlížeči.

  **Co v buňce stálo:** tři tlačítka přes celou šířku pod sebou (Přejmenovat, Archivovat,
  Smazat) a mezi archivací a mazáním čtyřřádkové vysvětlení „Pole zmizí z nabídek, ale hodnoty
  zůstanou a segmenty dál fungují. Je to bezpečnější než smazání." Řádek pole měl přes 200 px,
  tedy víc než všechny čtyři datové sloupce dohromady, a vysvětlení se opakovalo u KAŽDÉHO
  řádku, takže ho nikdo nečetl.

  **Vybrala se nabídka pod třemi tečkami, ne řada ikon.** Akce jsou tři a dvě z nich,
  přejmenování a archivace, nemají ustálenou ikonu, kterou by šlo přečíst bez textu; řada ikon
  by tedy jméno akce odsunula do bubliny, kde ho ukazatel najde až po prodlevě a dotyk nikdy.
  Nabídka jméno ponechá jako viditelný text a je to týž tvar, jaký uživatel zná z kontaktů
  (`contacts-table.tsx`) a ze seznamů (`lists-table.tsx`), takže čtvrtý způsob řádkových akcí
  v produktu nevzniká. Spouštěč je `IconButton variant="ghost" size="row"`, tedy 34px čtverec
  s neviditelným 44px překryvem, přesně jako u obou zmíněných tabulek: pravidlo klikací plochy
  se drží a rytmus řádku se nemění. Ověřeno v prohlížeči přes `elementFromPoint` 21 px od
  středu ve všech čtyřech směrech, všude odpoví tentýž spouštěč.

  **Jméno akce je v `aria-label`, ne jen v bublině.** `IconButton` `label` povinně vyžaduje
  a dělá z něj i `title`, takže čtečka i hlasové ovládání mají „Další akce k poli Firma“
  a bublina vznikne sama. Ikona bez jména by byla krok zpět, i když je menší.

  **Mazání nezlevnilo.** V nabídce stojí za `DropdownMenuSeparator` a v červené (`tone="danger"`),
  stejně jako u kontaktů a štítků, a pořád za ním je okno úrovně N3 se zaškrtávátkem a s výčtem
  dopadu z `/contact-fields/{id}/impact`. Zmenšení spouštěče se tedy netýká ceny akce.

  **Vysvětlení archivace se přesunulo do okna archivace, ne do nápovědy obrazovky.** Není to
  popiska tlačítka, je to následek, a platí právě ve chvíli rozhodování. Archivace se do té
  doby prováděla ROVNOU z `onClick`, bez otázky a bez hlášky o neúspěchu (výsledek akce se
  zahazoval). Nově je to `ConfirmDialog` úrovně N2 podle os z 6.1: rozsah 0 (jedno pole),
  obnovitelnost 1 (hodnoty zůstávají, ale cesta zpět neexistuje ani v rozhraní, ani v API,
  protože `PATCH /contact-fields/{id}` je `strict` a archivaci odklepnout neumí), vnější dopad 1
  (pole zmizí z nabídek všem v projektu). Součet 2 je N2, tedy okno s výčtem následků, bez
  zaškrtávátka a bez opisování, což je táž úroveň jako u archivace seznamu.

  **Následky jsou ověřené v kódu, ne odhadnuté:** `archiveContactField` (`repo/contact-fields.ts`)
  nastaví jen `archived_at`, `listContactFields` bez `includeArchived` pole nevrátí, a
  `getFieldCatalog` (`fields/catalog.ts`) ho označí `deleted`, takže zmizí z nabídky značek
  v editoru, ale `toLiquidRoots` příznak ignoruje a hotové šablony dál projdou validací.
  Neúspěch archivace se nově HLÁSÍ oznámením, včetně obou cest z okna mazání.

  **Navíc odešel dvojitý nadpis.** `SettingsPageShell` trasy vypisuje „Vlastní pole" i úvodní
  větu a `FieldsTable` je vypisovala znovu, takže totéž stálo na obrazovce dvakrát pod sebou.
  S tím a s ikonovými akcemi se celá tabulka i s ovládáním vešla nad ohyb.

- [x] **Ikona řetězu u každé události na časové ose a mrtvá mapa ikon** (agent
  `kontakty-zbytky`, nález zadavatele ze 7. 8.). Ověřeno `packages/ui/src/patterns/timeline`
  (24 zelených, 3 nové případy) a `apps/web/src/features/reports` (128 zelených).

  **Vada byla horší, než jak vypadala.** Zadavatel viděl u každého záznamu ikonu řetězu a ptal
  se, co dělá. Řetěz je trvalá kotva a je správně, že tam je; problém byl, že IKONA UDÁLOSTI
  se nekreslila vůbec, takže řetěz byl jediné, co na řádku bylo. `contact-timeline.tsx` ji
  poctivě počítal přes `iconFor`, `report-timeline.tsx` ji ukládal do `payload.icon` a
  `Timeline` ji NIKDY nepřečetla. Mapa patnácti typů na osm ikon se nevykreslila ani jednou.

  **Proč to neshodilo typovou kontrolu, a co se s tím udělalo.** `TimelineEvent.payload` je
  `Record<string, unknown>`, tedy volný pytel: vložit do něj jde cokoli a na druhém konci
  nikdo nepozná, že to nikdo nevybírá. Ikona je proto teď POJMENOVANÉ pole `icon` na
  `TimelineEvent` s uzavřeným výčtem `TimelineIcon`, ne klíč v pytli, takže příští vynechání
  shodí překlad místo toho, aby zmizelo v tichu. Výčet vlastní `packages/ui`, protože ikony
  se v tomhle repozitáři berou z jediného místa; `group-sessions.ts` ho odtud importuje, aby
  nevznikla druhá kopie. Přibylo i pojmenované `title`, ze kterého se skládá jméno kotvy.

  **Kotva ZŮSTALA** (je to zapsaný požadavek P05 s vlastní výjimkou z pravidla 44 px
  v `DESIGN-ZAKLAD.md`), ale dostala dvě opravy: `aria-label` už není `#event-019fdb…`, tedy
  identifikátor, který čtečka hláskuje po znacích a hlasové ovládání nevysloví, ale věta
  z katalogu (`reports.timeline.eventAnchor` se sloty `what` a `when`); a klik má konečně
  viditelný následek, protože cílová událost se přes `:target` zvýrazní žlutou plochou,
  toutéž, jakou nese vybraný řádek tabulky. Odsazení `scroll-margin-block-start` platí vždy,
  jinak by řádek doskočil pod lepivý nadpis dne.

  **Kopírování adresy do schránky se ZAMÍTLO**, ačkoli bylo ve hře: přepisovat schránku po
  kliknutí na podtržený odkaz je překvapení, rozchází se s tím, co od odkazu člověk čeká, a
  zabilo by nativní „Kopírovat adresu odkazu" i otevření do nového panelu. Účel kotvy se
  projeví i tak, adresa naskočí do řádku prohlížeče.

  **Kontrola pokrytí našla TŘI další typy bez ikony**, všechny prokliky systémových odkazů
  z patičky (`message_clicked_unsubscribe_page`, `_preferences`, `_webview`). Padaly na
  neutrální ikonu, tedy do téhož tvaru vady. Doplněné jsou a hlídá je nová brána
  v `group-sessions.test.ts`, která seznam typů NEOPISUJE: bere ho z katalogu vět
  `reports.timeline.item`, který vzniká z týchž typů jako `TITLE_KEYS` v jádře. Proti stavu
  před opravou vypsala přesně ty tři chybějící.

- [x] **Pruh hromadných akcí zůstal po akci viset** (agent `filtr-kontaktu`). Nález zadavatele:
  „Vyberu nějaké kontakty, udělám nad nimi operaci. Ta proběhne, ale tohle tam zůstane viset
  a nejde se toho zbavit. Pokud kontakty například smažu, tak nemá co s tím dál dělat."
  Ověřeno 7. 8. testy (471 ve složce `features/contacts`, 52 v `patterns/data-table`) a v prohlížeči.

  **Byly to dvě samostatné vady, ne jedna.** Za prvé po akci nikdo výběr nerušil: `bulk-actions.tsx`
  volalo `router.refresh()`, takže se obnovila DATA, ale `selectedIds` v `contacts-table.tsx`
  zůstaly. Po smazání v nich ležely identifikátory kontaktů, které už neexistují. Za druhé
  v pruhu v režimu „vybráno na stránce" NEBYLO ŽÁDNÉ ZRUŠENÍ: `SelectionBar` kreslil tlačítko
  `clearSelection` jen v režimu „vybráno vše odpovídající filtru", takže z výběru na stránce
  se dalo ven jedině odškrtáním řádků. Slovo „nejde se toho zbavit" bylo doslova pravdivé.

  **Nestačilo vynulovat pole identifikátorů.** Režim výběru a spočítané „vše odpovídající filtru"
  bydlí uvnitř `useRowSelection` a řízený režim pouští ven jen `selectedIds`; v tom režimu se
  počet bere z celkového čísla, ne z délky pole. Hook proto dostal `clearToken`: změna hodnoty
  uklidí i režim. Stav se rovná při vykreslování, ne v efektu, aby pruh po smazání nebliknul.

  **Výběr se ruší JEN po úspěchu.** Všech šest míst se prošlo zvlášť: po chybě zůstává (jinak by
  člověk přišel o odklikanou práci), po exportu zůstává schválně (nic se nezměnilo, tytéž kontakty
  jsou pořád v tabulce a export bývá mezikrok). Doloženo testy pro obě větve.

- [x] **Filtr kontaktů: umístění, zrušení filtrů a měření rychlosti** (agent `filtr-kontaktu`),
  navazuje na položku o chybějícím filtru níž. Ověřeno 7. 8. testy, typovou kontrolou, lintem,
  `i18n-check` a měřením v prohlížeči.

  **Volba seznamu a štítku je na TÉMŽE řádku jako Všechny, Aktivní a Nepotvrzené.** Změřeno
  v prohlížeči: hledání, Seznam, Štítek, přepínač stavu i Zrušit filtry mají shodný horní okraj.

  **Zrušení celého filtru se přesunulo na konec té řady a z pruhu pod ní zmizelo.** Dvě tlačítka
  na jednu věc kousek od sebe by byla horší než jedno špatně umístěné. Pruh se tím nezrušil celý:
  popisuje UŽ JEN TO, CO Z LIŠTY NENÍ VIDĚT (segment, nejisté oslovení, rozsah data přidání
  a stavy mimo tři tlačítka, tedy odhlášený, nedoručitelný, stěžující si, smazaný). Kdyby zmizel
  úplně, odkaz na nedoručitelné kontakty by vypadal jako nefiltrovaný seznam. Rozhoduje o tom
  čistá funkce `filtersOffToolbar` s vlastními testy, včetně případu, kdy se nabídka seznamů
  vůbec nekreslí a filtr seznamu tedy v pruhu zůstat MUSÍ.

  **Klikací plocha: řádek je 40 px, cíl 44 px.** 40 px je `--size-control`, tedy „pole filtru"
  podle návrhu, a mají ho hledací pole i přepínač stavu, které v té řadě stály před tím vším.
  Nové prvky mají tutéž výšku a klikací plochu roztaženou neviditelným překryvem na 44 px, stejným
  postupem jako nabídka „…" v řádku tabulky. Ověřeno zásahovým testem v prohlížeči: bod nad i pod
  hranou tlačítka pořád trefí tlačítko.

  **Úzké okno: zalomí se, nepřeteče.** Změřeno na 1600, 1024, 768 a 390 px. Do 1600 se řada vejde
  na jeden řádek, na 1024 se zalomí na dva, na 768 na tři, na 390 je každý prvek na svém řádku.
  Vodorovný přerůst dokumentu na 390 px SICE JE, ale nezpůsobily ho nové prvky: `scrollWidth`
  je 556 px se všemi třemi i po jejich skrytí. Rozbor je v otevřených nálezech níž.

  **Měření rychlosti stránky, protože podezření znělo, že filtr sahá do databáze bez indexu.**
  Nesahá. Sedm měření od každého, střídavě, při zátěži stroje 5,2 (běželi ostatní agenti):
  bez filtru medián 282 ms (min 244, max 475), jen seznam 269 ms (240 až 443), seznam a štítek
  245 ms (232 až 295). **Filtrovaná stránka je stejně rychlá, spíš rychlejší**, protože vrací
  méně řádků. Dřívějších 6 až 14,5 s tedy nebyla vlastnost té stránky.

  **Databáze na tom nemá podíl žádný.** `EXPLAIN (ANALYZE, BUFFERS)` přímo na `mlain_clean`:
  nefiltrovaný dotaz 1,20 ms, filtrovaný podle seznamu i štítku 1,07 ms. Podmínky jsou `EXISTS`
  a mají krycí indexy z obou stran: `pk_list_subscriptions(contact_id, list_id)`,
  `idx_list_subscriptions__list_status(list_id, status, contact_id)`,
  `pk_contact_tags(contact_id, tag_id)` a `idx_contact_tags__ws_tag_contact(workspace_id, tag_id,
  contact_id)`. Na třinácti kontaktech volí plánovač seq scan nad tabulkami o 32 a 81 řádcích,
  což je správně, ne známka chybějícího indexu. **Samostatný nález k indexům tedy nevzniká.**

- [x] **Řádek akcí u ručního přidání kontaktů: čtyři prvky vedle sebe a dvě věty, které se četly
  jako popiska sousedního tlačítka** (agent `radek-akci`). Nález zadavatele: „Text ‚Kontakty
  zařadíme do seznamu Odběratelé' za tlačítkem Zrušit vypadá, že navazuje na to tlačítko,
  a přitom s ním vůbec nesouvisí."

  **Proč to tak vypadalo.** Věta o cílovém seznamu byla v TÉMŽE pružném řádku jako obě tlačítka,
  jako jeho třetí prvek. Druhá věta, důvod nedostupnosti uložení, se do řádku dostala bez
  vlastního přičinění obrazovky: `Button` vykresluje `unavailableReason` jako svého SOUROZENCE
  hned za `<button>`, takže se z ní v pružném řádku stal prvek MEZI „Uložit" a „Zrušit".
  Řádek pak podle stavu textového pole měl tři nebo čtyři prvky a ani jedna věta nestála u toho,
  co popisuje.

  **Oprava.** Věta o cíli je nad tlačítky, na vlastním řádku, jako v kroku Volby u importu ze
  souboru (`features/import/step-options.tsx`), a nese i cílový stav přihlášení. Důvod
  nedostupnosti zůstal (zašedlé tlačítko bez důvodu je vada, princip P5 a rozhodnutí R7), ale
  dostal vlastní řádek POD dvojicí tlačítek: `[&>span]:order-last [&>span]:basis-full` na
  řádku, což je jediné místo, kde jde s cizím sourozencem hnout bez zásahu do komponenty.
  Ústup je odkaz, ne druhé stejně velké tlačítko, stejně jako u založení kontaktu
  (`contact-form.tsx`) a seznamu (`list-create-form.tsx`); pořadí zůstalo hlavní akce vlevo.
  Důvod je navíc KONKRÉTNÍ: jedna věta o prázdném poli i o limitu naráz nutila člověka
  zjišťovat, která půlka se týká jeho textu. Klik na nedostupné uložení vrací fokus do
  textového pole, tedy tam, kde se to napravuje.

  **Věcná kontrola věty o seznamu, ne odhad.** Seznam se posílá jako `list_ids: [listId]`
  z rozbalovátka, takže věta jmenuje SKUTEČNÝ cíl, i když si ho uživatel přepne; výchozí seznam
  projektu je jen předvybraný. Stav přihlášení je pravdivý taky: `subscription_status` volby
  importu přijímá (`packages/core/src/contacts/import/options.ts`) a `assertOptionsConsistent`
  navíc u seznamu s dvojím potvrzením bez prohlášení uložení odmítne, takže slib „přihlášené
  k odběru" nemůže projít bez dokladu. Jediná nepřesnost, kterou věta má, je společná s
  importem ze souboru: blokované adresy se přeskakují (`skip_suppressed` má výchozí `true`),
  takže do seznamu se zařadí dávka mínus blokovaní a mínus vadné řádky. Vadné řádky souhrn
  „Než dávku uložíte" vypisuje, blokované ne, protože se poznají až na serveru. Znění jsem
  proto nechal shodné s importem, aby obě brány říkaly totéž.

  **Doloženo.** 20 testů v `paste-contacts.test.tsx` zelených, tři nové. Že chytají právě tuhle
  vadu, je ověřeno dočasným vrácením opravy: s větou zpátky v řádku spadl test rozvržení,
  s jednou společnou větou o nedostupnosti spadly testy důvodu. Rozvržení změřeno i v běžící
  aplikaci (`/w/petr-osobni-mail/contacts/paste`): věta o cíli `y 1104` přes celou šířku,
  tlačítko `y 1145`, odkaz Zrušit `y 1155` hned vedle, důvod `y 1204` na vlastním řádku pod nimi.
  `node tools/ci/i18n-check.mjs` hlásí soulad, `tsc --noEmit` v `apps/web` bez chyby.

- [x] **Čtyři zbytky kolem vlastních polí kontaktu a oslovení** (agent `kontakty-zbytky`).
  Ověřeno 7. 8. testy níže; u každé opravy je doloženo i to, že test vadu CHYTÁ, tedy
  dočasným vrácením opravy zpátky.

  **1. Slučování `contacts.recompute_greeting` už neztrácí směr změny jazyka.** Fronta má
  politiku `stately` a klíč projektu, takže dokud první úloha leží ve stavu `created`, druhá
  se zahodí a přežije ta STARŠÍ i se svým nákladem. Směr sjednocení přitom ležel výhradně
  v nákladu (`alignLocale.to` a `.from`), takže kdo přepnul projekt na angličtinu a hned
  zpátky na češtinu, skončil s projektem v češtině a kontakty v angličtině. Slučování se
  NERUŠILO (rozklikané nastavení by frontou protlačilo desítky běhů nad týmiž řádky); z nákladu
  se vystěhovalo to, co se nesmí ztratit:

  - **Cíl se z nákladu ZMIZEL úplně.** Čte se ze sloupce `workspaces.locale` až při zpracování
    (`loadGreetingSettings`), takže běh nikdy nesrovná kontakty na jazyk, který projekt nemá.
  - **Výchozí jazyky se zapisují do projektu**, do vlastní větve
    `workspaces.settings -> 'greeting_locale_align' -> 'pending'`, a to v TÉŽE transakci jako
    změna jazyka a zařazení úlohy (nový modul `packages/core/src/contacts/locale-align-pending.ts`).
    Zpracovaný běh odškrtne PRÁVĚ TY položky, které vzal, ne celou větev, takže požadavek, který
    přibude za běhu, se neztratí. Do větve `contacts` to nepatří: má schéma `.strict()`
    s `.catch()`, takže by neznámý klíč tiše shodil čtení celé větve na výchozí hodnoty.
  - **Migrace nebyla potřeba**: `workspaces.settings` je `jsonb` bez schématu a každá doména
    čte jen svou větev.

  Opraveny tím TŘI naměřené následky, ne jeden: (a) přepnutí tam a zpět, (b) kontakt založený
  mezi oběma přepnutími zdědil jazyk mezikroku a nepokryl ho ani jeden směr, (c) úloha zařazená
  změnou VYKÁNÍ o jazyku nevěděla nic, takže se změna jazyka, která se o ni sloučila, ztratila
  celá. Doloženo v `packages/core/src/contacts/test/jobs/producers.db.test.ts` (7 zelených,
  z toho dva nové případy) a `contacts/test/greeting-path.db.test.ts` (22 zelených s ním).
  Proti staré podobě kódu spadly 3 ze 3 nových tvrzení, mimo jiné přesně na „expected 'en' to
  be 'cs'". `discardNote` v registru front to teď popisuje pravdivě.

  **2. Vzorové oslovení v náhledu i na plátně zná nastavení projektu.** `sampleRenderData`
  a `sampleFor` (`packages/emails/src/preview-data.ts`) berou nepovinné
  `SampleGreetingSettings` (vykání a tykání, křestní jméno nebo příjmení, přísnost vokativu);
  bez něj platí tytéž výchozí hodnoty, jaké má nový projekt. Serverová cesta si je čte novou
  funkcí `readGreetingSettings` z `contacts/settings.ts` (`samplePreviewData`), klientská je
  dostane přes `loadEditorData` → `EditorShell` → `ViewProvider`. Projekt s tykáním tedy už
  neslibuje „Dobrý den, Jano" u e-mailu, který odejde s „Ahoj Jano". Ověřeno
  `packages/emails/test/preview-data.test.ts` (9 zelených),
  `packages/core/src/templates/api/routes.db.test.ts` (32 zelených, nový případ nad `/preview`)
  a `apps/web/.../view/view-controls.test.tsx` (22 zelených); všechny tři nové případy proti
  staré podobě spadly.

  **3. Pevná pole kontaktu se ve stavěči polí formuláře nabízejí česky.** Nový převod
  `apps/web/src/lib/ui/contact-target-label.tsx` bere popisky z katalogu `editor.field.*`,
  kde už bydlí kvůli paletce personalizace; přibyl v něm jediný klíč `fullName`, protože celé
  jméno není sloupec kontaktu. **Nešlo přitom jen o nabídku**: vybrané pole si syrové jméno
  bralo i jako POPISEK, takže `first_name` viděl i návštěvník na veřejné stránce formuláře.
  Ověřeno `apps/web/src/features/forms/field-builder.test.tsx` (16 zelených, nový případ);
  proti staré podobě spadly dva případy.

  Doplněno po snímku obrazovky od zadavatele: zmizelo i NEPROPORCIONÁLNÍ PÍSMO, kterým se ta
  jména sázela. Vypadala jako kus kódu, takže by „Jméno" v mono písmu působilo stejně cize
  jako `first_name`. A znění se srovnalo s ostatními obrazovkami místo doslovného překladu:
  `contacts.locale` se v mapování importu i ve stavěči segmentů jmenuje **„Jazyk komunikace"**,
  kdežto katalog editoru měl „Jazyk kontaktu". Srovnal se katalog editoru, protože byl
  v menšině (jedna obrazovka proti dvěma); zbytek už seděl. Položka v menu Nastavení se
  z „Vlastní pole" upřesnila na **„Vlastní pole kontaktů"**, aby bylo z názvu poznat, čí pole
  to jsou.

  **4. Vlastní pole kontaktu mají konečně obrazovku, a umí NUTNÉ MINIMUM.** Vznikla trasa
  `apps/web/src/app/[locale]/w/[workspaceSlug]/settings/fields/page.tsx`, tedy přesně ta,
  na kterou celou dobu mířil `revalidatePath` v serverových akcích. Položka navigace
  `settings-fields` je odkrytá (`mvp0: true`), což hlídá
  `packages/ui/src/patterns/navigation/registry-screens.test.ts`. **Dvě mrtvá tlačítka jsou
  pryč**: „Přidat pole" nemělo obsluhu vůbec a „Přidat první pole" v prázdném stavu volalo
  `router.refresh()`, tedy překreslovalo prázdnou obrazovku prázdnou obrazovkou. Obojí teď
  otevírá nový dialog `features/contacts/new-field-dialog.tsx` nad novou akcí
  `createFieldAction`.

  **Přejmenování přibylo po zpřesnění zadání** a je z té čtveřice to nejdůležitější: bez něj
  je každé omylem založené pole v projektu napořád (naměřeno na poli „boolen" ze 4. 8.).
  Mění se POUZE popisek, nikdy klíč a nikdy typ, a dialog to říká předem: klíč používá import
  i API a typ přetypovat nejde (`field_type_immutable`). Posílá se celá mapa jazyků
  s přepsaným jazykem rozhraní (`features/contacts/field-labels.ts`), takže česká úprava
  nezahodí anglický popisek nastavený přes API. Umístění zůstalo v Nastavení, kde položka
  `settings-fields` byla v registru navigace zaregistrovaná od začátku; nové místo mimo
  zavedené členění by se hledalo hůř než to, které už v návrhu je.

  Ověřeno `apps/web/src/features/contacts/fields-table.test.tsx` (15 zelených, 8 nových
  případů), `field-labels.test.ts` (4 zelené, chování mapy jazyků) a `actions.test.ts`
  (29 zelených, obě nové akce jsou pokryté bránou na `workspaceId`).

- [x] **Sedm merge tagů, které editor nabízí, odcházelo v kampani prázdných** (agent
  `merge-tagy-sloupce`). Ověřeno 7. 8. novým databázovým testem
  `packages/core/src/campaigns/repo/__tests__/render-columns.db.test.ts` (5 případů),
  rozšířeným `campaigns/audience/__tests__/render-data.test.ts` (celkem 19 zelených),
  celou složkou `campaigns/audience/__tests__` a `campaigns/repo/__tests__` (23 souborů,
  147 zelených), typovou kontrolou balíčku a **ostrým během nad vývojovou databází
  `mlain_clean`**: dočasná kampaň se skutečně zmaterializovala a `messages.render_data`
  obsahovala `middle_name`, `title_prefix`, `title_suffix`, `gender`, `last_name_vocative`,
  `locale` i `created_at`; dočasné řádky jsou po ověření smazané. Že testy vadu opravdu
  chytají, je ověřeno dočasným vrácením opravy (2 z 5 případů spadly).

  **Zdrojem pravdy je od teď šablona, ne pevný seznam.** `materializeBatch` skládá seznam
  sloupců přes `renderDataColumns(usedPaths)`, tedy přes funkci, která tu celou dobu ležela
  nevolaná. `email` se vybírá vždy (obálková adresa a brána zkušebního režimu), `id` taky.

  **Rozšíření výběru nesmí propašovat nic navíc, proto přibyla bezpečnostní hranice.**
  Názvy sloupců jdou do `SELECT` jako TEXT (parametrem se sloupec předat nedá), takže
  `renderDataColumns` napřed filtruje přes nový výčet `SNAPSHOTTABLE_CONTACT_COLUMNS`
  v `campaigns/audience/render-data.ts` a **cokoliv neznámého zahazuje**. Zahození, ne chyba:
  neexistující sloupec by shodil celý `SELECT` na 42703 a kampaň by se nezmaterializovala ani
  o řádek. `RENDER_DATA_EXCLUDED_FIELDS` platí beze změny, `contact.email`, `unsubscribe_url`
  ani `webview_url` se dál nesnapshotují a kořeny `campaign` a `workspace` taky ne.

  **Časová razítka se normalizují už v SQL** (`renderDataSelectItem`, výčet
  `ISO_DATE_CONTACT_COLUMNS`): `to_char(… AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`,
  ne `to_json` (jeho výstup závisí na `DateStyle` spojení). Bez toho by `contact.created_at`
  po opravě výběru dorazilo neprázdné, ale ve tvaru, který filtr `date` v senderu odmítá.

  **Proti opakování stojí dva testy na rozejití, ne dobrá vůle.** Katalog polí vyváží
  `FIRST_CLASS_CONTACT_FIELDS` a testy hlídají, že (1) výčet snapshotovatelných sloupců pokrývá
  všechna prvotřídní pole katalogu kromě `email` a (2) každé pole typu `datetime`/`date` je
  v `ISO_DATE_CONTACT_COLUMNS`. Kdo přidá pole do paletky a sem ne, dostane červený test
  místo tiché prázdné hodnoty v odeslané zprávě.

  **Strop `RENDER_DATA_MAX_BYTES` (8 kB) platí beze změny a chová se rozumně**: řádek vzniká
  jako `skipped` s `error_code = 'render_data_too_large'` a prázdnými daty, ověřeno testem
  i se všemi jedenácti poli naráz. Nárůst je zanedbatelný, celá prvotřídní sada s reálnými
  hodnotami měří 301 bajtů; strop v praxi překročí jedině patologická hodnota vlastního pole.

- [x] **Kontakty nešlo zúžit na seznam ani na štítek** (agent `filtr-kontaktu`).
  Ověřeno 7. 8. testy (48 v `contacts-table.test.tsx`, 21 ve `filters.test.ts`, celá složka
  `features/contacts` 440 zelených), typovou kontrolou, `i18n-check` a prohlížečem na
  běžící aplikaci.

  **Nález zadavatele: „Nemám jak filtrovat kontakty z konkrétního seznamu nebo s konkrétním
  štítkem."** API oba filtry umělo od začátku (`list_id`, `tag_id` v `contacts.routes.ts`),
  filtr žil v adrese a zapnutý filtr se nad tabulkou i vypisoval. Chyběl JEDINÝ kus: ovládací
  prvek, kterým se zapne. Zapnout se dal proklikem odjinud nebo dopsáním parametru do adresy.

  **Do lišty nad tabulkou přibyl výběr seznamu a výběr štítku** (`features/contacts/filter-picker.tsx`).
  Zapisují do TÉŽE adresy jako hledání a přepínač stavu, takže se výsledek dá poslat odkazem
  a zpětné tlačítko funguje. Ověřeno v prohlížeči: volba „Novinky" vede na
  `?list_id=…`, volba „Praha" k ní přidá `&tag_id=…`.

  **Hledání v nabídce je TÝŽ vzorec jako paletka personalizace v editoru** (`Popover` +
  `Command` nad `cmdk`), ne třetí způsob výběru. Prosté rozbalovátko by u desítek seznamů
  a stovek štítků nešlo přečíst. Seznamy se navíc načítají s `limit=200` místo výchozích
  padesáti, jinak by padesátý první ve výběru chyběl, aniž by to bylo poznat.

  **Je to jedna hodnota, ne víc, a je to podle toho, co endpoint unese.** `list_id` i `tag_id`
  jsou v API jediné UUID, takže vícenásobný výběr by rozhraní slíbilo něco, co server neumí.
  Na složené podmínky jsou segmenty; se stavitelem segmentů se to nepřekrývá.

  **Druhá vada, změřená: „7 kontaktů · 10 nepotvrzených".** Druhé číslo se ptalo na
  `status=unconfirmed` BEZ ostatních filtrů, tedy za celý projekt, kdežto první filtr
  respektovalo. Věta se přitom čte jako podíl z prvního čísla. Nově se počítá v rozsahu
  zapnutého filtru (`unconfirmedCountFilters` ve `filters.ts`) a se zapnutým filtrem stavu
  se neptá vůbec, protože by vyšla nula nebo totéž číslo podruhé. Doloženo v prohlížeči:
  bez filtru „7 kontaktů · 4 nepotvrzené", po zúžení na seznam Novinky „4 kontakty
  · 1 nepotvrzený", a tabulka opravdu ukazuje jeden nepotvrzený řádek. U prázdného výsledku
  se druhá půlka vynechává, jinak by za „Žádný kontakt" stálo „všechny potvrzené".

  **Prázdný výsledek filtru už nezahazuje celou obrazovku.** Dřív se místo všeho vykreslil
  prázdný stav, takže kdo si vybral seznam, ve kterém nikdo není, neměl jak přepnout na jiný.
  Lišta i hlavička zůstávají, prázdný stav nastupuje jen místo tabulky.

  **Ikona s posuvníky v hlavičce (nastavení sloupců) záměrně zůstala beze změny.** Vypadala
  jako filtr jen proto, že žádný filtr na obrazovce nebyl; s výběrem seznamu a štítku vedle
  ní ta záměna mizí.

- [x] **Náhled vkládaného formuláře ukazoval náš vzhled** (agent `formular-vzhled`).
  Ověřeno 7. 8. měřením živého výstupu, testy a prohlížečem.

  **Vkládaný formulář žádné CSS nenese, obava zadavatele se NEPOTVRDILA, a je to změřené,
  ne přečtené z komentáře.** Stažený skutečný výstup `/f/{ref}.js` z běžící aplikace
  (6 206 B, `content-type: application/javascript`, `access-control-allow-origin: *`)
  neobsahuje ani jeden výskyt `<style`, `style=`, `stylesheet`, `cssText` ani `custom_css`.
  Jediné dva zápisy do `.style` jsou `position: absolute` a `left: -9999px` časové pasti,
  tedy funkce, ne vzhled. Totéž vyšlo při volání obsluhy trasy mimo dev server, oba
  výstupy jsou bajt po bajtu shodné.

  **`forms.custom_css` neuniká NIKAM, a to ani na hostovanou stránku.** Změřeno tak, že
  se sloupci dočasně nastavila poznatelná hodnota a znovu se stáhl skript i stránka:
  nula výskytů v obou. Od migrace 0015 ten sloupec nečte žádný kód, hostovaná stránka má
  vlastní konstantu v `features/public/styles.ts`. **Komentáře v `form-pages.tsx`
  a `embed-script.ts` tvrdily opak** („sem se taky uplatní `forms.custom_css`"), byly
  zastaralé a jsou opravené. Hodnota v databázi zůstává jako uložená data uživatelů.

  **Skutečná vada byla v náhledu, a přesně toho druhu, jaký tenhle projekt řeší
  opakovaně: rozhraní ukazovalo něco jiného, než co se stane.** Náhled u stavitele polí
  byl v pořádku (rámeček s vlastním dokumentem, bez jediného našeho pravidla). Na
  obrazovce s kódem k vložení ale bylo jediné místo se slovem „náhled" odkaz „Otevřít
  náhled formuláře", který vedl na hostovanou stránku `/f/{ref}`. Ta naše styly MÁ, tedy
  bílá karta se stínem a modrým tlačítkem, přesně to, co zadavatel viděl. Uživatel z toho
  odkazu četl vzhled, který na svém webu nikdy nedostane.
  - Náhled bez stylů je teď JEDNA sdílená komponenta (`features/forms/unstyled-preview.tsx`)
    pro stavitele polí i pro obrazovku vložení. Dvě kopie by se rozešly a jedna z nich by
    zase slibovala nepravdu. Ukazuje i zaškrtávátko souhlasu, protože ho vkládaný formulář
    vykreslí; náhled bez něj by ukazoval kratší formulář, než jaký vznikne.
  - Odkaz na hostovanou stránku se u vkládaného formuláře jmenuje „Otevřít naši hostovanou
    stránku" a nese větu, že vzhled dá až cílový web. Jako zkouška odeslání platí dál.
    U volby „Použiju hotovou stránku" se jmenuje „náhled" dál, protože tam je to pravda.
  - Vysvětlující věta u náhledu je povinná část opravy: holý formulář vypadá jako rozbitá
    stránka, takže bez ní by se jedna záhada vyměnila za druhou.

  **Hostovaná stránka `/f/{ref}` styly nechává.** Zdůvodnění zadavatele („vzhled si uživatel
  styluje na webu, kam formulář vkládá") na ni nesedí: na cizí web nikam nejde, je naše
  a na naší adrese. Existující rozhodnutí ji stylovat zůstává, viz komentář v `render.tsx`
  o tom, že stránka pro příjemce nesmí vypadat jako cizí.

  **Ověření.** 13 testů v `embed-panel.test.tsx` (pět nových), 15 v `field-builder.test.tsx`,
  celkem 129 zelených ve `features/forms` a `test/public`. Nové testy jsou ověřené i obráceně:
  po dočasném vrácení opravy padly tři z nich. Vizuálně zkontrolováno v prohlížeči na
  formuláři „Patička webu": náhled ukazuje syrový formulář ve výchozím písmu prohlížeče
  a blok „Zkouška" nese poctivou větu.

- [x] **Čtyři nálezy k nastavení seznamů: protimluv u potvrzovacího e-mailu, rozsah odhlášení,
  vlastní stránka po odhlášení, vlastní stránka pro už přihlášeného** (agent `seznamy-nastaveni`).
  Ověřeno testy (viz níž), migrace 0027 nasazená i do vývojové databáze `mlain_clean`.

  **1. Protimluv (vada, opraveno).** Karta „E-maily seznamu" tvrdila u potvrzovacího e-mailu
  „nejde vypnout" i na seznamu s volbou „Přihlásit rovnou", kde se ten e-mail při běžném
  přihlášení vůbec neposílá. Zdrojem pravdy je nově `lists.opt_in` a karta ho dostává jako
  ŽIVÝ stav, takže přepnutí přepínače o kus výš je vidět hned, bez znovunačtení.
  - Jádro se kontrolovalo, ne odhadovalo: vypínač potvrzovacího e-mailu **v datech vůbec
    neexistuje** (na rozdíl od `send_welcome` a `send_goodbye`), takže ho nejde zapnout ani
    přes API mimo obrazovku. Rozhoduje výhradně stavový automat.
  - Pozor na past, kvůli které text NEŘÍKÁ „neposílá se nikdy": `lists/state-machine.ts` pošle
    potvrzení i na seznamu s jednoduchým přihlášením ve **dvou** případech, a oba už mají
    vlastní test (`test/lists/state-machine.test.ts`): vrací se někdo, kdo se dřív odhlásil,
    a vypršel dřív vydaný potvrzovací odkaz. Rozhraní to teď říká doslova místo zašedlé
    kolonky bez důvodu.

  **2. Rozsah odhlášení na úrovni seznamu (nová funkce).** Nový sloupec
  `lists.unsubscribe_scope` (`list` nebo `global`, výchozí `list`, tedy dnešní chování).
  Skutečný rozsah se počítá na JEDNOM místě (`readVerifiedToken` → `effectiveScope`), takže
  text stránky a skutečný zápis se nemají jak rozejít.
  - **Následek, který zadavatel nezmínil a rozhraní ho teď říká:** globální odhlášení navíc
    zapisuje adresu do `suppressions` pro celý projekt, tedy z ní neodejde nic ani z jiného
    seznamu. Je na to výstražný blok u volby a vlastní test.
  - Centrum předvoleb je z toho VYJMUTÉ schválně: odškrtnutí jednoho seznamu ze zaškrtávátek
    musí odhlásit jen ten seznam, jinak by stránka udělala pravý opak toho, co uživatel odeslal.
  - Změna rozsahu jde do auditu (`list.unsubscribe_scope_changed`), protože se projeví až
    poklesem doručených.

  **3. Vlastní stránka po odhlášení: funkce EXISTOVALA, jen ji nešlo najít.**
  `confirm_redirect_url` i `unsubscribe_redirect_url` byly zapojené celou cestou. Karta se ale
  jmenovala „Po potvrzení a po odhlášení", tedy bez slova „stránka", a stála v levém sloupci
  pod základními údaji. Přejmenovaná na **„Vlastní stránky místo našich"** s větou pod nadpisem.
  Cestou dvě opravené vady té karty:
  - **Neúspěch uložení se spolkl.** Obsluha měla jen větev pro úspěch, takže při chybě se
    obrazovka nezměnila a adresa vypadala uložená, i když nebyla.
  - **Adresa bez `https://` se uložila** a poslala se rovnou jako hlavička `Location`, takže
    „example.cz/dekuji" poslalo člověka na NAŠI neexistující stránku. Teď se to neuloží a řekne
    se proč.

  **4. Vlastní stránka pro už přihlášeného (nová funkce).** Nový sloupec
  `lists.already_subscribed_redirect_url`, výchozí `NULL` = dnešní chování. Použije se, když
  odesílatel formuláře je ve VŠECH seznamech toho formuláře už potvrzený; kdo se aspoň někam
  doopravdy přihlásil, dostane běžnou děkovací stránku.
  - **Vědomě prolamuje jednotnou odpověď formuláře (rozhodnutí R9):** jiná odpověď na známou
    adresu prozradí, že ta adresa v databázi je. Proto se to nezapíná samo a proto na to
    upozorňuje popisek u pole. Tělo odpovědi zůstává stejné pro všechny, liší se jen cíl
    přesměrování.
  - **Známé omezení:** platí pro odpověď 303, tedy hostovanou stránku a čistě HTML formulář.
    Vkládaný skript posílá JSON a vypíše svou hlášku, přesně jako u dnešního `redirect_url`
    formuláře. Doplnění pro skript je v oddílu 2.

  Migrace `0027_lists_unsubscribe_scope_pages.sql` (granty se nemění, `lists` má tabulkový
  grant z 0005, funkce `mlain_apply_grants()` se proto schválně neopisuje). Ověření:
  `packages/db test/migrations-check.test.ts` (0027 se aplikuje), tři nové db testy
  `test/public/unsubscribe-scope.db.test.ts`, tři v `test/repo/forms.submit.test.ts`, čtyři
  v `test/repo/lists.test.ts` a osm nových v `list-detail.test.tsx` (29 zelených).
  U oprav ověřeno i to, že bez nich testy padají (dočasné vrácení opravy: rozsah 2 pády,
  stránka pro přihlášeného 1 pád, protimluv 1 pád). `node tools/ci/i18n-check.mjs` OK
  (4 655 klíčů), `openapi.json` přegenerovaný a shodný s čerstvým výstupem generátoru.
  **Nedodělek:** vizuální kontrola v běžící instalaci na 3200 neproběhla, přihlášení do
  cizího účtu jsem neobcházel; UI je doložené jednotkovými testy nad skutečně vykresleným
  textem.

- [x] **Typy vlastních polí se uživateli ukazují česky, ne jmény z DDL** (agent `boolean-osloveni`).
  Zadavatel: „Další věc je boolean. Tohle pole nikde v češtině nepochopí a neví, co znamená.
  Je potřeba ho pojmenovat logičtěji." Prosakovaly **všechny** typy, ne jen `boolean`.
  Nalezená místa a co se stalo:
  - **Výběr typu při zakládání vlastního pole** (`forms/field-builder.tsx`, dialog „Nové vlastní
    pole kontaktu"). Tohle je místo, kde to zadavatel viděl: v nabídce stálo `text`, `long_text`,
    `number`, `boolean`, `date`, `url`, `phone`. Teď „Krátký text", „Dlouhý text", „Číslo",
    **„Ano/ne"**, „Datum", „Odkaz", „Telefon", a pod výběrem je řádek s `aria-live`, který říká,
    co se do pole zadává
  - **Sloupec „Typ" v tabulce vlastních polí** (`contacts/fields-table.tsx`) vypisoval `row.type`
    přímo z API
  - **Seznam polí ve stavěči formuláře a nabídka „Přidat pole"**: uložená definice nese značku
    vstupu (`checkbox`, `textarea`, `select`, `tel`), takže i po přeložení nabídky by u pole
    založeného jako „Ano/ne" stálo `checkbox`. Řeší to převod v novém
    `apps/web/src/lib/ui/field-type-label.ts`, který zná všechny tři slovníky typů, co v repozitáři
    jsou (typ v DDL, značka vstupu ve formuláři, hrubší typ v katalogu editoru)
  - **Hodnota `true` a `false` na detailu kontaktu** se vypisovala tak, jak leží v JSONB.
    U pole „VIP" tam stálo `false`. Teď „Ano" a „Ne", a **nevyplněno zůstává prázdné**, protože
    to není totéž co „ne"
  - **Pole typu ano/ne se v úpravě kontaktu zadávalo do řádku na text.** Uložilo se `true` jedině
    tehdy, když uživatel napsal doslova `true`, `on` nebo `1` (`edit-actions.ts`, `coerceAttribute`);
    česky napsané „ano" se uložilo jako NE, a to tiše. Teď je to výběr se třemi volbami
    („Nevyplněno", „Ano", „Ne"). Nativní `select`, ne `Select` z P05: ten stojí na Radixu, který
    prázdnou hodnotu položky zakazuje, a „nevyplněno" je tu plnohodnotná třetí volba
  - Klíče jsou sdílené v `common.fieldType` a `common.fieldTypeHint` (cs i en), protože typy se
    ukazují ve dvou doménách naráz. `node tools/ci/i18n-check.mjs` hlásí OK, 4 638 klíčů
  Ověřeno čtyřmi novými testy (`fields-table`, `field-builder` ×2, `contact-form`); oprava byla
  dočasně vrácena zpět a všechny čtyři spadly.

- [x] **V editoru je vidět, jakou VĚTU oslovení vyrobí, ne jen že se jmenuje „Oslovení"**
  (agent `boolean-osloveni`). Zadavatel: „Když tam vložím Oslovení, tak vlastně nevím, jak vypadá.
  Je tam v šabloně mailu napsáno jen ‚Oslovení'. Ale bude to vypadat jak? Dobrý den Honzo?
  Nebo Krásný den Honzo? Prostě to není jasné."
  - **Nejdřív se změřilo, co věta doopravdy vydá.** Skládá ji `buildGreeting`; česky formálně
    „Dobrý den, {5. pád}", neformálně „Ahoj {5. pád}", při oslovování příjmením „Vážená paní X,"
    a „Vážený pane X,", anglicky „Hello X" a „Hi X". Bez jména spadne na neutrální „Dobrý den"
    **bez čárky**. V jazyce bez vokativu se bere nominativ, ne uložený vokativ
  - **Skladatel se přestěhoval z `@mlain/core/contacts/naming/greeting` do
    `@mlain/emails/greeting`**, aby ho směl zavolat i prohlížeč (`@mlain/core` sahá na databázi).
    Původní cesta v jádře zůstala a jen reexportuje, takže všech šest volajících v jádře je
    beze změny. Týž postup, jakým se dřív stěhovala `preview-data.ts`
  - **Vzorová data přestala mít oslovení napsané natvrdo.** Do teď v `preview-data.ts` stál
    literál „Dobrý den, Přemyslave-Řehoři" a u varianty **„Kontakt bez jména" prázdný řetězec**.
    To druhé byla vyloženě nepravda: kontakt bez jména dostane „Dobrý den", takže náhled ukazoval
    díru u e-mailu, který ve skutečnosti pozdraví. Test `view-controls.test.tsx`, který tu díru
    vyžadoval, byl opravený i s vysvětlením proč
  - **Kde je věta vidět:** v paletce `{}` u položky Oslovení řádkem „Vyrobí: Dobrý den,
    Přemyslave-Řehoři"; na plátně v bublině po najetí a v `aria-label` štítku; a celá i s
    vysvětlením v bublině po kliknutí (`TokenInspector`), která se otevírá i klávesnicí, protože
    spouštěč je tlačítko. **Do štítku samotného věta nejde**, roztáhla by řádek jinak, než ho
    zalomí hotový e-mail
  - Věta se vždycky **bere, nevymýšlí**: u volby „Zobrazit jako → konkrétní kontakt" je to jeho
    skutečný `contacts.greeting`, jinak vzorová věta z téhož `buildGreeting`. Když není odkud
    ji vzít, neukáže se nic. Nese ji `greetingExample` ve `view-state.tsx`
  - Nápověda u značky **přestala citovat konkrétní větu** („například Dobrý den, Petře"), protože
    ta se s nastavením projektu rozejde; místo toho říká, čím se znění řídí
  Ověřeno pěti novými testy (`personalization-menu` ×2, `view-controls`, `greeting-guidance` ×2);
  u dvou z nich byla oprava dočasně vrácena zpět a testy spadly. Celé sady dotčených oblastí jsou
  zelené: `apps/web` forms + contacts + editor 868 testů, `packages/emails` 368 testů,
  `packages/core` naming 189 testů.

- [x] **Systémové odkazy v paletce `{}`: doplněný potvrzovací odkaz a hledání, které je najde.**
  Zadavatel: „chybí spousta systémových odkazů… URL adresa pro `{{ data.confirm_url }}` existuje,
  ale není to v té paletce". Nejdřív se dohledalo, **proč** v ní nenašel ani zobrazení
  v prohlížeči, které tam bylo: filtr `cmdk` porovnává hledaný text jen s popiskem, a
  „Zobrazení v prohlížeči" má na „odkaz" i „URL" skóre 0 (naměřeno na `defaultFilter`).
  Co se změnilo:
  - `CommandItem` v `packages/ui/src/components/command.tsx` umí volitelná `keywords`, takže
    položka jde najít podle toho, co to je, ne jen jak se jmenuje. Synonyma **nejsou v `value`**,
    to je identita položky pro výběr.
  - Popisky říkají, že jde o odkaz: „Odkaz na zobrazení v prohlížeči", „Odkaz na odhlášení
    z odběru", „Odkaz na nastavení odběru". Každý má pod sebou jednořádkovou nápovědu, kde
    funguje, stejným tvarem jako skupina Oslovení.
  - Přibyl **`data.confirm_url`** jako „Odkaz na potvrzení přihlášení".
  - Nabídka se řídí profilem šablony (nový kontext `richtext/template-profile.tsx`, hodnotu
    dodává `EditorShell`): v kampani tři adresy od odesílače, v transakční šabloně potvrzovací
    odkaz. Není to kosmetika — v kampani je kořen `data` zakázaný (`liquid_unknown_root`)
    a transakční zprávě odesílač `preferences_url` ani `webview_url` nedodává vůbec.
  - `one_click_unsubscribe_url` se **schválně nenabízí**: odesílač do něj dosazuje tutéž
    hodnotu jako do `unsubscribe_url` a slouží hlavičce `List-Unsubscribe-Post`.
  Ověřeno 17 testy v `personalization-menu.test.tsx`, které kliknou na skutečnou nabídku
  a píšou do skutečného hledání. Oprava byla dočasně vrácena zpět a testy hledání spadly,
  takže měří to, co mají. Každá nabídnutá značka navíc projde tímtéž `checkSemantics`,
  kterým se hlídá dokument, a tímtéž `buildRenderSchema`, ze kterého se plní `render_data`.

- [x] **Správce hesel cpal svoji nabídku do vyhledávacího pole paletky.** Zadavatel: „Když
  v editoru kliknu na `{}`, tak mi tam pořád Bitwarden cpe tuhle paletku. Nevidím, co je pod ní.
  Nejde se jí zbavit." Nabídka uložených přihlášení se vysunula nad hledáním v paletce
  personalizace, zakryla první tři pole seznamu a **nešla zavřít**: leží nad stránkou jako
  součást rozšíření a kliknutí mimo ni zavře i celou paletku. Příčina: správci hesel si sami
  všímají textových polí a hledání v `cmdk` jim jako přihlašovací pole vypadá.
  Opraveno **ve sdílené komponentě** `CommandInput` (`packages/ui/src/components/command.tsx`),
  ne náplastí v editoru, takže to platí i pro paletku `Ctrl/Cmd + K`
  (`patterns/shortcuts/command-palette.tsx`) — jiné použití `Command` v repozitáři není.
  Značky jsou v `packages/ui/src/lib/password-manager.ts` i s odůvodněním, proč jich musí být
  šest naráz: společná neexistuje a každý správce čte jen tu svoji (1Password `data-1p-ignore`
  a `data-op-ignore`, LastPass `data-lpignore`, Bitwarden `data-bwignore`,
  Dashlane `data-form-type="other"`, Proton Pass `data-protonpass-ignore`).
  Samotné `autocomplete="off"` nestačí, správci hesel ho běžně ignorují; `cmdk` si ho na svém
  poli i tak nastavuje samo. **Přihlášení, registrace a změny hesla zůstaly nedotčené**, tam je
  nabídka správce hesel žádoucí. Ověřeno v běžícím Chromiu na skutečně vykreslené komponentě
  (všech šest atributů na `input[cmdk-input]`) a testem `command.test.tsx`; test ověřen návratem
  opravy, bez ní padá.
  **Táž vada byla i jinde, nehlášená**, protože správci hesel si všímají každého textového
  pole. Prošel jsem všechna a značky dostalo šestnáct dalších ve třinácti souborech: čtyři
  hledání (`contacts-table.tsx`, `assets-library.tsx`, hledání v knihovně šablon
  v `content-step-chrome.tsx` a hledání kontaktu do náhledu v editoru
  `header/view-controls.tsx`, tam nabídka zakrývá nalezené položky úplně stejně jako v paletce)
  a adresy v administraci, kde vyplnit přihlašovací adresu uživatele je vždycky
  chyba: kontakt (`contact-form.tsx`, `change-email-form.tsx`), blokované adresy
  (`suppressions-table.tsx`), odesílatel (`sender-dialog.tsx` dvakrát,
  `campaigns/settings-form.tsx` dvakrát, `system-mail-screen.tsx`), ověření adresy a žádost
  u Amazonu (`identity-dialogs.tsx` dvakrát), zkušební odeslání (`trial-mode-panel.tsx`)
  a pozvánka člena (`invitations-section.tsx`).
  **Nedotčené zůstalo přihlášení, obnova hesla, první nastavení správce a založení člena i s heslem**
  (`auth/login-form.tsx`, `auth/forgot-password-form.tsx`, `auth/setup-form.tsx`,
  `members/create-member-section.tsx`) a klíče poskytovatelů: tam nabídka správce hesel patří
  a vypnout ji by byla škoda, ne oprava. Hlídá to i test hledání v `contacts-table.test.tsx`,
  taky ověřený návratem opravy. 698 testů dotčených oblastí zeleně
- **Nález mimo zadání:** `apps/web` neprojde `typecheck`, a to rozpracovanou prací jiných agentů,
  ne touhle opravou. Během hodiny to byly dvě různé chyby po sobě: nejdřív chybějící propa
  `signupAction` v `accept-invitation-panel.test.tsx:15` (mezitím spravená), pak
  `contacts/[id]/edit/page.tsx:7`, který importuje neexistující
  `@mlain/core/contacts/repo/consents`. Než se půjde commitovat, musí `typecheck` projít

- [x] **Tlačítko mělo v panelu vlastností nadpis „Rozvržení" dvakrát.** Zadavatel to nahlásil
  jako hlášku Reactu o shodných klíčích (`group.layout`) v `properties-panel.tsx:138`. Ta hláška
  byla **jen příznak**: `descriptors/button.ts` má vlastní skupinu `group.layout` a k tomu si
  přibírá společné `contentGroups()`, které tutéž skupinu nese taky. V panelu se tím vlastnosti
  téhož druhu rozpadly do dvou hromádek pod stejným jménem, v jedné zarovnání a šířka, ve druhé
  odsazení a pozadí, bez čehokoli, z čeho by uživatel poznal, proč tam ta hranice je.
  Kdyby se opravil jen klíč, hláška zmizí a **dvojí nadpis zůstane**, tedy vada se schová.
  Opraveno slučováním skupin podle jména v pořadí prvního výskytu. Ověřeno měřením přes všechny
  descriptory (jediný zasažený blok je tlačítko, klíče vlastností po sloučení nekolidují)
  a testem, který měří **nadpisy v panelu, ne klíče**, aby ho oprava klíče neošálila.
  Test ověřen návratem opravy: bez ní hlásí „expected length 1 but got 2“. 54 testů zeleně

- [x] **Úlohy v Centru úloh jde zastavit, a to jen ty, které se zastavit doopravdy dají**
  (agent `zruseni-uloh`). Zadání: „Úlohy, které běží v /jobs, by měly mít možnost zastavení."

  **Nejdřív se měřilo, co která úloha umí, teprve pak se dělalo tlačítko.** U OBOU zdrojů
  bod zastavení existuje, u obou je to SPOLUPRÁCE, ne zabití běhu:
  *Import* se ptá `isCancelled()` u každého řádku (`contacts/import/run-context.ts:153`),
  přechod `previewing|importing → cancelled` je povolený a doménová trasa
  `POST /contacts/imports/{id}/cancel` existovala už předtím (`imports.routes.ts:280`).
  *Stavba publika* čte stav kampaně po KAŽDÉ dávce (`campaigns/materialize/loop.ts:80`)
  a při `cancelled` navíc uklidí, co stihla vložit. Zastavit ji ale nejde jinak než
  zrušením CELÉ kampaně: publikum se staví jen v `queueing` a jediný odchod odtamtud,
  po kterém pošta neodejde, je `cancelled`.

  **Trasa je SPOLEČNÁ, `POST /api/v1/jobs/{kind}/{id}/cancel`.** Doménové trasy zůstávají
  a nová je volá skrz sebe, nenahrazuje je. Důvod: Centrum úloh zná o úloze jen dvojici
  `kind` + `id`; kdyby si vybíralo doménovou trasu samo, muselo by znát i doménové
  oprávnění, tvar těla a významy chyb každé z nich, a každý nový zdroj úloh by znamenal
  zásah do obrazovky. Zdroj si zaregistruje `cancel` u sebe (`platform/jobs/registry.ts`).
  **Oprávnění se NEZŘEĎUJE:** seznam se čte pod `timeline:read`, ale zastavení běží pod
  `contacts:import`, resp. `campaigns:control`, a ověřuje se DŘÍV, než se cokoli změní.

  **Zašedlé tlačítko nikde není.** Zdroj vrací `can_cancel` a obrazovka podle něj tlačítko
  buď vykreslí, nebo vůbec nezaloží. Doběhlá úloha ho nemá, import ve fázi počítání řádků
  taky ne (přechod `validating → cancelled` ve stavovém automatu neexistuje), stavba
  publika po dokončení taky ne (rozesílka se zastavuje na obrazovce kampaně, kde je vidět,
  kolika lidem už zpráva došla).

  **Potvrzení říká, CO ZŮSTANE, ne jen „opravdu?".** Import je N2 podle 6.1 a
  `destructive: false`, protože z projektu nic nezmizí: první následek je „Kontakty
  naimportované do teď zůstanou v projektu: 1 240 z 5 000 řádků", druhý „zbytek se
  nenaimportuje", třetí „rozpracovaná dávka ještě doběhne". Stavba publika je N3 se
  zaškrtávátkem a `destructive: true`, protože ruší celou kampaň a odebírá připravené
  zprávy z fronty; opisování názvu (N4) schválně ne, aby Centrum úloh nebylo přísnější
  než domovská obrazovka kampaně.

  **Rozhraní netvrdí „zastaveno", dokud se úloha nezastavila.** Přibyl příznak `stopping`:
  zrušení se zapíše hned, ale běh ho zaregistruje až u nejbližší kontroly, takže odznak
  hlásí ZASTAVUJE SE a řádek nese větu o dobíhající dávce. Počítá se z posledního zápisu
  (`updated_at` mladší dvou minut, u importu navíc `processed_rows > 0`, aby zrušený náhled,
  kde nikdy nic neběželo, nic nedobíhal). Chyba je vždy na stranu opatrnosti. Odpověď
  trasy je proto `outcome: cancelling`, ne „zrušeno", a seznam se kvůli dobíhající dávce
  obnovuje dál, i když je stav už koncový.

  **Dvě kliknutí ani závod nejsou chyba.** `outcome` má tři hodnoty a žádná není chybová:
  `cancelling`, `already_cancelled`, `already_finished`. Doběhlá úloha se doméně vůbec
  nepředá, a když se stav změní MEZI čtením a zápisem, přeloží se `conflict` z domény
  na výsledek. Konečný stav se nepřepíše nikdy.

  **Opraveno mimochodem, byla to tichá vada:** stav stavby publika se četl JEN z `phase`,
  jenže zrušená kampaň fázi na `done` nikdy nepřepne, takže úloha zůstávala v Centru
  navždy jako „běží" a odznak v hlavičce ukazoval práci, kterou nešlo vynulovat. Nově se
  čte fáze I stav kampaně.

  **Ověřeno:** 20 zelených v `apps/web/test/api/jobs.test.ts` proti skutečné databázi
  (zastavení importu i kampaně, druhé kliknutí, dvě zastavení naráz, změna stavu mezi
  čtením a zápisem, cizí projekt, zdroj bez zastavení), 12 v `registry.test.ts`,
  27 v `apps/web/src/features/jobs`, typová kontrola obou balíčků, eslint, prettier,
  `i18n-check` (4 830 klíčů). U čtyř oprav ověřeno i tím, že se dočasně vrátily zpátky
  a testy spadly. Vizuálně přes Playwright na běžící aplikaci: tlačítka na řádcích,
  potvrzovací okno se skutečnými čísly, odznak ZASTAVUJE SE na detailu. Zkušební řádky
  ve vývojové databázi po sobě smazány.

### 2026-08-06

Vedle integrace designu (samostatný dokument `DESIGN-INTEGRACE.md`) hlavně tohle:

- **Klávesnice v datové tabulce.** Tlačítko uvnitř řádku nešlo z klávesnice spustit vůbec:
  Enter odnavigoval jinam, mezerník zaškrtl řádek. **Šest tabulek**, nejhorší projev ve
  Formulářích, kde Enter na odkazu „Kód k vložení" vedl na detail formuláře. Opraveno u příčiny,
  výčet prvků v jedné konstantě pro klávesnici i myš
- **Pole pro adresu odkazu v editoru.** Nešlo do něj psát, protože plovoucí lišta plošně
  potlačovala výchozí chování prohlížeče. Napsaná adresa se **vlévala do e-mailu a přepisovala
  označený text.** Druhá vada za ní: `Backspace` při psaní mazal celý blok
- **Osiřelé pracovní kopie po smazané kampani.** Smazání kampaně se do jejího obsahu vůbec
  nepropisovalo. Migrace 0021 srovnala čtyři existující, kód opraven. **Závora `NOT EXISTS`**
  brání tomu, aby smazání kopie sebralo obsah předloze, se kterou ji sdílí
- **Barvy značky se nepromítaly do e-mailů.** Dostávaly se tam **jedinou cestou, přes AI asistenta.**
  Nová kampaň, šablona, formulář, ukázková data i systémové e-maily seznamu měly výchozí modrou
- **Panel vlastností v editoru:** zrušen rozbalovací výběr barev, zmizel vodorovný posuv (obsah si
  říkal o 297 px do 298 px širokého místa, takže to na macOS rolovalo a jinde ne)
- **Hlavička editoru** zúžena o 187 px, pak ještě o 276 px v levé skupině; drží jeden řádek do
  1400 px. Přepínače režimů mají 44 px místo 36
- **Nastavení sloupců** bez zadávání přesné šířky, vše na jednom řádku
- **Nabídka „…" v řádku kontaktů** s akcemi z detailu. Při tom se **vytáhlo odhlašování a mazání
  do sdílených souborů**, čímž padla tichá vada: selhání serveru se spolklo, okno se zavřelo
  a uživatel odešel s tím, že smazal
- **Převzetí obsahu ze šablony** z pěti kliknutí na tři, plus hledání nad limitem 100 a přiznaný
  ústřižek, když je knihovna větší
- **Podmenu o jedné položce** se nevykresluje, pokud vede tam co sekce (Kampaně, Šablony)
- **Profil má cestu zpět** a „Můj účet" zmizel z Nastavení, zůstal vpravo nahoře
- **Jazyk projektu**: nápověda lhala o systémových e-mailech a zamlčela, že určuje výchozí jazyk
  nových kontaktů. Opraveno, doplněn odkaz do profilu
- **Mrtvé tlačítko „Změnit"** v panelu AI asistenta odstraněno (obsluha se nikam nepředávala)
- **Ukazatel ukládání** říká „Ukládá se samo", protože produkt to jinak neřekl nikde, a stojí
  těsně vlevo od tlačítka Uložit. Tlačítko se mezi stavy **neposune ani o pixel**
- **Inline přejmenování kampaně** v hlavičce kroku 1. Ukázalo se přitom, že **přejmenovat
  doopravdy nešlo**: krok 2 pouští validaci celého formuláře, takže u čerstvé kampaně spadne na
  prázdném předmětu a jméno se neuloží. Zadavatel měl doslova pravdu
- **Duplikace kampaně sdílela obsah s předlohou**, takže úprava kopie přepsala originál.
  Doloženo vypnutím opravy, ne odvozeno. Klonuje se, a **test závory se musel přepsat**, protože
  by po opravě procházel naprázdno
- **Stránka kampaně a pět obrazovek nastavení vydávaly 404 na jakékoli selhání**, včetně vypršení
  desetisekundového limitu. Odtud hlášení „kampaň zmizela" na přetíženém stroji
- **Ukládání se po konfliktu zacyklilo** (14 pokusů), teď se zastaví a řekne, že práce není
  uložená a co s tím
- **Barvy značky se propisují i zpětně:** uložení značky převleče dokumenty, které barvu nemají
  autorovanou, po jednotlivých rolích, bez posunu `updated_at`. Plus příkaz `mlain redress-brand`
- **Pozadí plátna a obsahu v panelu Motiv byla mrtvá pole**, zapsala se a nikdo je nečetl.
  Teď píšou do rolí, které se skutečně kreslí
- **Jazyk rozhraní ověřen jako funkční**, nápověda u jazyka projektu opravena (lhala o systémových
  e-mailech) a doplněn odkaz do profilu
- **Návrat k panelu Motiv:** po výběru bloku se k nastavení motivu nedalo vrátit jinak než
  znovunačtením stránky. Teď je v hlavičce vlastností odkaz „‹ Motiv", klik mimo blok výběr zruší
  a `Escape` odznačí jako druhý krok. Přitom vyplavala **starší vada: po každém psaní padal fokus
  na `<body>`**, takže klávesová cesta k blokům tiše končila. Nikdo si toho nevšiml, protože do
  té doby nebylo co druhou klávesou udělat
- **Úvodní řádek zmizel z editoru kampaně** (dubloval se s předhlavičkou v kroku 2, která ho
  v generátoru přebíjí), u samostatné šablony zůstal, protože tam žádný krok 2 není

### 2026-08-05
- [x] **Import kontaktů nefungoval vůbec, teď projde celou cestou.** Průvodce byl kulisa: import se spouštěl sám hned po nahrání s výchozími volbami, takže se **vždycky importovalo bez seznamu, bez štítku a bez souhlasu**, ať uživatel naklikal cokoli. Odtud se braly kontakty, které nikam nepatří. Nahrání navíc padalo na **diakritice v názvu souboru** a padalo tiše. Dál opraveno: opakované nahrání končilo pětistovkou, dialog nad duplicitou byl nedosažitelný kód, „Spustit znovu" posílalo parametr, který API nečetlo, výsledková obrazovka padala po každém importu, sloupec Pohlaví zahazoval české hodnoty, krok „Kontrola souboru" se ptal na kódování a na odpověď nereagoval. Vkládání textem slibovalo „Potvrzené" a zapisovalo nepotvrzené bez dokladu o souhlasu. Zapojena dvě mrtvá tlačítka, přidána nápověda se vzorovým CSV, zařazení do seznamu povinné na obou branách
- [x] **Oznámení: vpravo dole a sama mizí.** Časovač v komponentě byl od začátku, jen ho **React ve StrictModu po prvním připojení natrvalo zabil** a druhé připojení ho nemělo jak vzkřísit, takže nikdy netikl. Doby: 6 s informace, 10 s u vratné akce (odvozeno z okna pro vrácení, ne naopak), chyba zůstane do zavření. Pod myší i při zaostřeném tlačítku se odpočet zastaví. Zrušeno šest obcházek s vnořeným providerem, takže strop tří viditelných oznámení konečně platí napříč obrazovkou
- [x] **Slučování duplicitních úloh ve frontách.** Sedm ručně opsaných vkládacích příkazů nahradil jediný sdílený a brána hlídá, aby osmá kopie nevznikla. Tři nálezy, které z toho vypadly: `ON CONFLICT DO NOTHING` by samo o sobě **vyplo existující ochranu kampaní** (try/catch kolem zařazení se spoléhá na vyhozenou chybu, kampaň by navždy zůstala v „připravuje se"), politika `short` **neomezuje běžící úlohy** a měřením se ukázalo, že správná je `stately`, a worker teď při neúspěšném srovnání politik raději nenaběhne, než aby tiše běžel bez slučování. Worker restartován 5. 8. ve 12:31, log potvrdil „politiky front souhlasí s registrem" nad 59 frontami
- [x] **Dodělávky měření:** zápis `verified_at` včetně opravy párování subdomén, audit vzniku veřejného klíče, ověřování podpisu `identify` (kanonizace RFC 8785), pojistka izolace u `identify.repo.ts` a nápověda s hotovým kódem v PHP i Pythonu na obrazovce měření
- [x] **Úklid po retenci:** smazána poslední fronta bez obsluhy (registr 62 → 59), opravena zastaralá fixture `09-materialize-insert.sql` i tentýž zastaralý dotaz opsaný v těle testu, spravena konfigurace testů `packages/db` (od vitest 4 je `maxWorkers` vlastnost skupiny, kvůli čemuž se nespustil ani jeden test)
- [x] **Izolace projektů v měřicí vrstvě.** Napojení kliknutí v e-mailu na chování na webu **nefungovalo nikdy**: cache povolených domén se plnila dotazem bez kontextu, vracela vždy prázdno, takže se identifikační token nikdy nepřipojil k prokliku
- [x] **Omezení zpracování podle článku 18** jde zapnout i zrušit, s povinným odůvodněním a auditem v obou směrech
- [x] **Přepočet segmentů po události** a `segments.mark_invalid`, obojí mělo producenta bez obsluhy
- [x] **Retence odeslané pošty**, příkaz `mlain partitions` pod migrátorskou rolí. Cestou opraveny tři vady, z toho jedna vážná: odklízení oddílů četlo hranici z názvu tabulky, ne z databáze
- [x] **Transakční e-maily přes API** včetně proměnné v odkazu tlačítka, bez odhlašovacího odkazu a bez měření, s úklidem citlivých dat po 24 hodinách
- [x] **Rozhodnutí do plánů zapsaná**: čtyři blokující otázky automatizací, šest otázek e-mailů seznamu

### 2026-08-04
- [x] Formuláře: API, obrazovky, stavitel polí, nulové CSS ve vkládaném kódu, samostatná položka v menu
- [x] Měřicí kód na web: SDK pod 4 kB, příjem událostí, obrazovka nastavení, upozornění na nedostupnou měřicí doménu
- [x] Statistiky: oprava „Otevřelo 185,7 %" na čtyřech místech, webová aktivita v reportu kampaně, obrazovka Web, doručitelnost bez lživých nul, segmenty z reportu
- [x] Editor: lišta formátování jen nad označeným textem, ovládání bloku schované při psaní, neproklikávatelné „+", prázdný náhled, přejmenování šablon, zrušení varování
- [x] Šablony: kategorie a filtr, pracovní kopie kampaní pryč z knihovny, zákaz smazání zapojené šablony
- [x] Kontakty: ruční vrácení odhlášeného, časová osa na detailu, oprava mrtvého odkazu na neexistující obrazovku
- [x] Kampaně: sloučený krok 1 s editorem, výběr odesílatele, rozsah odhlášení podle publika


## Přesunuto ze STAV-UKOLU.md 7. 8. 2026

Odškrtnuté položky z oddílů 1 až 4, vyňaté při zeštíhlení živého seznamu.

- [x] **Panel vlastností měl u tlačítka nadpis „Rozvržení" dvakrát.** Opraveno mnou,
  rozbor v oddílu 6
- [x] **„Otevřít formulář" vedlo na mrtvou adresu.** Nebylo to natvrdo v kódu:
  `apps/web/.env.local` mělo `APP_URL=http://localhost:3100`, kdežto aplikace
  poslouchá na 3200. Ověřeno `lsof` (na 3100 neposlouchá nic) a opraveno.
  Týká se JEN vývojového prostředí, `.env.example` je v pořádku
- [x] **Čtyři nálezy k seznamům** (protimluv u potvrzovacího e-mailu, rozsah odhlášení,
  vlastní stránka po odhlášení, stránka pro už přihlášeného). Hotové, rozbor v oddílu 6,
  migrace 0027. Bod 3 nebyla chybějící funkce, ale funkce, kterou nešlo najít
- [x] **Etapa 1 hotová a ověřená v běžící instalaci** (ověřil jsem důkaz sám dotazem do `mlain_clean`): ruční přidání kontaktu na seznam s dvojím potvrzením zařadí zprávu do outboxu s `confirm_url`. Cestou nález, který změnil řešení: **registrace portu z `instrumentation.ts` obsluha trasy nevidí**, běží v jiném modulovém grafu, takže první pokus vytvořil přihlášení i token, ale žádnou zprávu. Odesílatel se teď sestaví líně při prvním použití
- [x] **Etapa 2 hotová:** nastavení tří e-mailů na seznamu (potvrzovací, uvítací, rozloučení), obecné znění jako konstanta, vlastní znění zakládá předvyplněnou šablonu, závora na chybějící potvrzovací odkaz na dvou místech, migrace 0017 s chybějícími cizími klíči. Seznam do teď nešel ani přejmenovat. Zbývá třetí vrstva závory při ukládání šablony (`templates/service.ts`), zelenou jsem dal
- [x] **Etapa 3 hotová:** obrazovka „nový seznam", výchozí seznam „Odběratelé" ve všech projektech (migrace 0018 a 0019; agent správně **nepovýšil existující seznam**, protože `is_default` řídí, komu se co posílá), `redirect_url` a `success_message` v editoru formuláře, přesměrování po potvrzení i po odhlášení. Cestou zapojeno přepnutí výchozího seznamu (endpoint existoval bez volajícího) a opraveno, že **editor vůbec nezobrazoval hlášky ze serveru**, takže každá blokující chyba vypadala jako obecná záhada
- [x] **Protimluv vyřešen** (ověřeno v kódu 6. 8.): `precheck.ts:81` má dnes podmínku
  `input.unsubscribeRequired !== false`, takže odhlašovací odkaz už není vyžadovaný
  bezpodmínečně a u e-mailů seznamu se nevynucuje. Cesta ven existuje

- [x] **Tlačítko „Přepočítat" na kartě segmentu už funguje** (ověřeno v kódu 6. 8.):
  `segment-list.tsx:204` i položka v nabídce na řádku 246 volají `recount(row.id)`
- [x] **ROZHODNUTO 7. 8.: uvítací e-mail odhlašovací odkaz nemá a nesmí mít.** Zadavatel doslova:
  „U uvítacího e-mailu to nedává smysl. Je odeslán poté, co se člověk přihlásil." Tím padá
  i moje námitka, že do uvítacího e-mailu lidé dávají slevu a je to obchodní sdělení.
  **Dnešní stav je tedy správný a nic se nemění:** brána blokující uložení takové šablony
  zůstává, `worker.go:173` přepisuje `unsubscribe_url` u transakčních zpráv dál.
  Vlastní druh zprávy pro e-maily seznamu (migrace `messages.kind` a zásah do Go senderu)
  se **nedělá**, odpadl důvod
- [x] **ROZHODNUTO 7. 8.: miniatury šablon NECHCEME.** Zadavatel odpověděl „NE".
  Nic se tím nemění, v rozhraní žádná miniatura není a nic se nerozbíjí. Sloupec
  `thumbnail_asset_id` v databázi zůstává nenaplněný, `apps/web` ho nečte ani jednou
  a plán P08 to má za vědomé rozhodnutí, ne opomenutí. **Vyrábění obrázku ze šablony
  na serveru se nedělá.** Kdyby se někdy vrátila potřeba orientace v seznamu šablon,
  levnější cesta je ukázat předmět a první nadpis, což jsou data, která v dokumentu už jsou
- [x] **Uzavřeno 7. 8.: tlačítko „Změnit" v panelu AI asistenta už neexistuje, záznam byl zastaralý.**
  Zadavatel: „To tlačítko tam už není, informace je podle mě zastaralá." Ověřeno: v `features/ai`
  se v produkčním kódu nevyskytuje a `assistant-panel.test.tsx:46` jeho nepřítomnost přímo TVRDÍ
  (`expect(queryByRole('button', { name: 'Změnit' })).toBeNull()`), takže se nemůže vrátit.
  Nahradit ho odkazem na `/settings/brand` se **nebude**, zadavatel o to nestojí
- [x] **Uzavřeno 7. 8. jako nevada: „Upravit kontakt" v nové kartě se řeší jinou cestou.**
  Zadavatel: „Nevadí, ignorovat, není to chyba. Jde otevřít do nového panelu kliknutím na mail,
  Cmd a klik." Cesta k tomu tedy existuje a je to běžný odkaz, takže chování prohlížeče funguje.
  `DropdownMenuItem` v `packages/ui` dál neumí `asChild` a **nechává se to tak**
- [x] **Materializace kampaně vybírala z `contacts` pevných sedm sloupců, ačkoliv paletka
  personalizace nabízí celý katalog polí.** `SELECT_SQL` v
  `packages/core/src/campaigns/repo/outbox.ts` uměl `id`, `email`, `first_name`, `last_name`,
  `first_name_vocative`, `greeting` a `attributes`. Funkce `renderDataColumns`, která umí
  spočítat, co šablona doopravdy potřebuje, existovala od začátku a **nevolal ji nikdo**
  (měla jen vlastní jednotkový test). Sedm nabízených značek proto dorazilo do zprávy prázdných:
  `contact.middle_name`, `contact.title_prefix`, `contact.title_suffix`, `contact.gender`,
  `contact.last_name_vocative`, `contact.locale`, `contact.created_at`. Tiše, protože
  `buildRenderData` z chybějícího klíče udělá `null` a render nemá přísnou kontrolu proměnných.
  Stejně tiše vyšly nepravdivě i **podmíněné bloky** nad těmi poli (`_present` čte tutéž hodnotu),
  takže podmíněná část e-mailu zmizela všem. Je to táž třída vady jako
  `{{ workspace.sender_address }}`
- [x] **Druhá polovina téže vady: `contact.created_at` by dorazilo prázdné i po opravě výběru.**
  Ovladač vrací `timestamptz` řetězcem v postgresovém tvaru `2026-08-07 09:57:51.034352+00`,
  filtr `date` v senderu je pevně na RFC 3339 (`parseDateInput` v
  `apps/sender/internal/liquidx/datefilter.go`) a pro neplatný vstup **záměrně vrací prázdný
  řetězec místo chyby**. Náhled v editoru přitom tutéž hodnotu dodává přes `toISOString()`
  (`templates/api/preview-data.ts`), takže náhled ukazoval datum a odeslaná zpráva prázdno

- [x] **Obrazovka vlastních polí kontaktu nemá žádnou trasu, komponenta visí ve vzduchu.**
  `apps/web/src/features/contacts/fields-table.tsx` má vlastní testy, ale v `apps/web/src/app`
  ji nevolá nikdo (ověřeno grepem na `FieldsTable` po celém `apps/web`). Vlastní pole se tedy
  dají založit **jedině oklikou** ze stavitele formuláře („Nové vlastní pole kontaktu"), a
  archivovat, přejmenovat ani smazat je nejde nikde. Tlačítko „Přidat pole" v té komponentě
  navíc nemá obsluhu, takže i po zapojení trasy by nic nedělalo
- [x] **Vzorové oslovení nezná nastavení projektu.** `sampleRenderData` skládá větu s výchozím
  nastavením (vykání, oslovení křestním jménem, přísná politika vokativu), protože jí volající
  předává jen jazyk. V projektu s tykáním tedy plátno i náhled slibují „Dobrý den, Jano",
  přestože odejde „Ahoj Jano". Skutečný kontakt (volba „Zobrazit jako → konkrétní kontakt")
  správně je, protože se bere jeho uložený `contacts.greeting`. Oprava znamená protáhnout
  nastavení projektu do `sampleFor`, a ta se volá i ze serveru (`templates.routes.ts`)
- [x] **Ve stavěči polí formuláře se pevná pole kontaktu nabízejí syrovými jmény z API**
  (`email`, `first_name`, `last_name`, `full_name`, `locale`), v mono písmu, bez překladu
  (`field-builder.tsx`, `CONTACT_TARGETS`). Je to tatáž vada jako u `boolean`, jen u jmen polí
  místo typů; popisky pro ně už existují v `editor.field.*`

- [x] **Ikona řetězu u KAŽDÉ události v časové ose kontaktu.** Zadavatel: „Je tam u každého
  záznamu ikona řetězu. Co jako dělá?" Kotva je správně, chyběla ikona události: `Timeline`
  četla `payload.icon` nikdy a mapa patnácti typů na osm ikon byla mrtvý kód. Opraveno i to,
  že kotva měla místo jména identifikátor a klik na ni neměl viditelný následek

- [x] **Slučování u `contacts.recompute_greeting` zahodí SMĚR ZMĚNY JAZYKA, ne jen duplicitní
  práci. Patří doméně kontaktů, není to vada fronty.** OPRAVENO 7. 8. agentem `kontakty-zbytky`,
  viz oddíl 6. Fronta má politiku `stately` a klíč
  projektu, takže dokud první úloha leží ve stavu `created`, druhá se zahodí a přežije **ta
  starší i se svým nákladem**. `discardNote` v registru slibuje, že „čekající běh si nastavení
  načte, až začne, takže pokryje i tu změnu, kvůli které byl požadavek zahozen". **U textu
  oslovení to platí, u jazyka ne:** směr sjednocení (`alignLocale.from` → `.to`) leží VÝHRADNĚ
  v nákladu úlohy, nikde jinde. Kdo přepne projekt na angličtinu a hned zpátky na češtinu, může
  skončit s **projektem v češtině a kontakty v angličtině**, tedy přesně ve stavu, kvůli kterému
  ten producent vznikl (`identity/workspace-service.ts:348`). Doloženo testem proti databázi
  7. 8. (`contacts/test/jobs/producers.db.test.ts`), který do té doby tvrdil opak, protože testy
  neměřily provozní politiku. **Není to regrese, v provozu to platí od začátku**, jen to nebylo
  vidět. Levné řešení neznám: klíč se směrem v sobě by pustil dva souběžné přepočty nad týmiž
  kontakty, což je přesně to, čemu má klíč projektu bránit
- [x] **Přesunuto 7. 8. do oddílu 2.3 jako zadání, není to oprava.** Fronta `outbox.reconcile`
  nemá zapojené závislosti, takže srovnání outboxu s `campaign_stats` neběží vůbec. Tikání se
  7. 8. zastavilo (sypalo 1 440 stejných chyb denně, naměřeno 3 993 za čtyři dny), takže dnešní
  škoda je vyřešená. **Věcná díra zůstává, ale dopsat ji nejde bez návrhu**, a komentář
  v `campaigns/jobs/queue-handlers.ts:120-127` říká přesně proč: sken projektů hotový je
  (`systemReconcileScan`), ale `revokePending` pracuje nad KAMPANÍ, ne nad projektem, takže
  mezi „mám ID projektu" a „mám co odsouhlasit" zeje krok, který nikdo nenapsal. Doplnit ho
  znamená rozhodnout, které kampaně projektu se rekonciliují a v jakém pořadí. To je návrh,
  ne dopsání továrny, a v oddílu 4 by viselo donekonečna

- [x] **Návod na instalaci na externí Postgres napsaný 7. 8., a psaní ho rozbilo dvakrát.**
  Nový soubor `docs/operations/install-external-postgres.md`, odkazuje na něj README
  i `.env.example`. **Každý krok je odzkoušený proti běžícímu PostgreSQL 18.4**, ne opsaný
  z kódu, a to ve dvou variantách: spravovaná databáze (databázi vlastní cizí účet, instalace
  je běžná role s `CREATEROLE`, ne superuživatel) a přibalený Postgres podle `compose.yml`.
  **DVA SKUTEČNÉ BLOKÁTORY, oba našel až běh, ne čtení:**
  **1) Instalace na cizí Postgres byla NEPRŮCHODNÁ, ne jen nezdokumentovaná.** Schéma `pgboss`
  zakládala DVĚ místa a pokaždé s jiným vlastníkem: `docker/initdb/10-roles.sql` s vlastníkem
  `mlain_app`, migrace `0007_pgboss_schema` s vlastníkem `mlain_migrator`. U přibaleného
  Postgresu to nikdo nepoznal, protože tam je migrátor superuživatel a smí grantovat i na cizí
  schéma. Na externím je běžnou rolí, takže instalace spadla na sedmé migraci hláškou
  `permission denied for schema pgboss`. **Opraveno tak, že skript schéma nezakládá vůbec** a
  vlastní ho migrace, tedy jediný zdroj pravdy. Ověřeno oběma směry: před opravou 7 migrací
  a pád, po opravě prošlo všech 27 a `mlain_app` v `pgboss` zakládat smí. Přibalená varianta
  přeověřena zvlášť kontejnerem s `POSTGRES_USER=mlain_migrator`, protože právě ji šlo tou
  změnou rozbít. Kdo pouštěl starší znění skriptu, opraví to jedním `ALTER SCHEMA pgboss
  OWNER TO mlain_migrator`, a runbook to říká.
  **2) `sslmode=require` znamená u každé půlky aplikace NĚCO JINÉHO.** Naměřeno, ne odvozeno:
  node-postgres 8.22 hlásí ve varování, že `require` bere jako `verify-full`, kdežto pgx v5.10
  u téže hodnoty nastaví `InsecureSkipVerify=true`, tedy šifruje a certifikát NEOVĚŘUJE
  (ověřeno vypsáním `TLSConfig` a připojením). Bez `sslmode` pgx dokonce spadne zpátky na
  nešifrované spojení. Připojovací řetězec od poskytovatele přitom končívá na `?sslmode=require`,
  takže by web certifikát ověřoval a sender ne. Runbook proto předepisuje `verify-full`, jedinou
  hodnotu, u které obě strany dělají totéž.
  Ověřovací část runbooku (vlastníci schémat, rozšíření, že `mlain_app` nesmí do `public`
  a smí do `pgboss`, že sender nevidí kontakty, že souhlasy maže jen role pro GDPR, časová
  zóna) jsou doslova ty dotazy, které jsem pouštěl, i s výstupy. Popsané je i to, co běžný
  `CREATEROLE` účet neumí (`GRANT pg_read_all_data`, tedy role pro zálohy) a že skript zakládá
  role s heslem `mlain`, které se na cizí databázi MUSÍ změnit; ověřeno i to, že druhý běh
  skriptu změněné heslo nepřepíše.
  Původní znění: `docs/operations/`
  má sedm souborů (zálohy, rotace klíčů, oddíly a retence, upgrade, licence, demo runbook
  a rešerši hostingu) a **instalace mezi nimi není žádná**. Hlavička
  `docker/initdb/10-roles.sql` přitom říká „U externího Postgresu je to v dokumentaci jako
  ruční krok", takže odkazuje na dokument, který neexistuje. Skript sám je 7. 8. opravený
  a na cizí databázi projde, ale operátor se odjinud než ze zdrojáku nedozví, že ho má
  spustit, čím a kdy. **Týká se to přímo plánu rozjet testovací provoz na hostingu.**
  **Bez vlastníka**, patří k okruhu provozní dokumentace
- [x] **Rozhodnuto 7. 8.: hodnota `open` z enumu VYHOZENA, veřejná registrace se nedopisuje.**
  Zvažoval jsem obojí a rozhodlo tohle: `open` neslibovalo jen chybějící funkci, ale
  **konkrétní bezpečnostní stav, který neplatil**. Kdo si ji nastavil, žil v přesvědčení, že
  si lidé zakládají účty sami, a instalace mu to nijak nevyvrátila; přitom se chovala jako
  `invite`. U nastavení, které odpovídá na otázku „kdo si smí založit účet", je tichý nesoulad
  horší než chybějící volba, protože se na něj někdo spolehne. Dopsat veřejnou registraci by
  navíc nebyla dnešní práce: je to funkce s bezpečnostními dopady (ověření adresy před prvním
  přihlášením, brzdy proti zakládání účtů ve velkém, vyzrazení, že adresa je registrovaná,
  a vazba na dosud nerozhodnuté „kdo smí zakládat projekty"), takže by patřila do zadání.
  **Zbylé hodnoty jsou `closed` a `invite`, výchozí `invite`, chování se NEMĚNÍ.** Instalace
  s `SIGNUP_MODE=open` nově skončí hlasitou chybou konfigurace s hláškou, ať se napíše
  `invite`, a že se tím nic nemění. Hláška je vlastní, ne obecná zodí, právě proto, že jinak
  by z toho byla záhadná chyba při startu. Upraveno v `config/schema-platform.ts`,
  `identity/signup.ts`, `.env.example` i ve specifikaci (tabulka i vysvětlující odstavec).
  Testy: `SIGNUP_MODE=open` neprojde a hláška poradí `invite`, obě zbylé hodnoty projdou.
  Ověřeno vypnutím: s vrácenou hodnotou `open` do enumu test spadne.
  Původní znění: Enum tu hodnotu má
  a spec u ní slibuje ověření e-mailu před prvním přihlášením, ale žádná trasa, která by
  účet založila bez tokenu pozvánky, v repozitáři není. Od 7. 8. se `open` chová jako
  `invite` a `.env.example` i spec to říkají nahlas, takže to není tichá lež. **Rozhodnout
  se ale musí, jestli se dopíše, nebo se hodnota z enumu vyhodí**; enum s hodnotou, která
  nedělá to, co slibuje její jméno, je past na dalšího čtenáře
- [x] **Přesunuto 7. 8. do oddílu 3, je to byznys rozhodnutí, ne vada k opravě.** Trasa
  `POST /api/v1/workspaces` nekontroluje nic kromě relace, takže kdokoli přihlášený si smí
  založit projekt a stane se v něm vlastníkem. Není to nová vada (komentář v `no-workspace/page.tsx`
  na ni upozorňuje a `canCreate` v panelu na to čeká), ale od 7. 8. má ostřejší dopad, protože
  účet nově vzniká z pozvánky: pozvaný editor si vedle projektu, do kterého byl pozvaný, může
  založit libovolně mnoho vlastních. **Zadavateli předloženo 7. 8. i s návrhem** (omezit
  zakládání na správce instalace), odpověď zatím nepřišla. Opravit to naslepo nejde: obě
  varianty jsou obhajitelné a špatná volba buď zablokuje legitimní použití, nebo nechá díru

- [x] **`{{ campaign.name }}` a `{{ workspace.name }}` v odeslané kampani NIC nevypíšou,
  a jsou přitom v nabídce personalizace.** Naměřeno spuštěním skutečného řetězce
  `buildRenderSchema` → `buildRenderData` (7. 8.): sběrač obě cesty do `usedPaths` dá, ale
  `buildRenderData` (`packages/core/src/campaigns/audience/render-data.ts:49`) snapshotuje
  **výhradně cesty pod `contact.`**, takže z dokumentu s pěti značkami vyšlo
  `render_data = {"contact":{"first_name":"Petr"}}`. Kořeny `campaign` a `workspace` do
  `messages.render_data` nepíše nikdo a render běží s `strictVariables: false`, takže z toho
  je tiše prázdný řetězec. **Týkalo se to i `{{ workspace.sender_address }}` ve výchozí patičce**
  (`packages/emails/src/document/defaults.ts:137`), tedy poštovní adresy odesílatele, kterou
  má obchodní sdělení mít ze zákona.

  **Opraveno 7. 8. (agent `render-data`).** Kořeny dodává ODESÍLAČ z hlavičky kampaně, ne
  materializace ze snapshotu: jsou konstantní pro celou kampaň, kdežto `render_data` je na
  zprávu a má strop `RENDER_DATA_MAX_BYTES`, takže kopie do každého řádku by u milionové
  kampaně stála stovky megabajtů kvůli údaji, který se nemění. Je to tentýž důvod, proč
  odesílač staví odhlašovací odkaz. Navíc to spraví i kampaně, které se materializovaly
  před opravou, a pozdě doplněnou adresu dostanou i zbývající příjemci.
  - `StmtCampaignHeader` tahá `c.name`, `w.name` a `w.settings #>> '{campaigns,postal_address}'`
    (jednou na dvojici kampaň, revize), `setCampaignRoots` a `refreshPresence`
    v `apps/sender/internal/app/worker.go` je dosazují a přepočítávají mapu `_present`,
    kterou materializace plnila bez znalosti hodnot, takže podmíněný blok nad poštovní
    adresou se tiše skrýval.
  - `{{ campaign.subject }}` je VYRENDEROVANÝ předmět: předmět a preheader se proto renderují
    před tělem. Zdroj by do e-mailu dostal syrový Liquid výraz.
  - Web renderuje uloženou zprávu ještě na dvou místech, „Zobrazit v prohlížeči"
    a report „Co se doopravdy rozeslalo". Obě používají nový sdílený
    `packages/core/src/campaigns/render-roots.ts`, jinak by prohlížeč tvrdil, že patička
    odešla bez adresy, i když ji nesla.
  - Poštovní adresa má konečně kde vzniknout: `workspaces.settings.campaigns.postal_address`,
    zapisuje ji `PATCH /api/v1/workspaces/{id}` (`postal_address`) a pole v Nastavení →
    Projekt. Bydlí na projektu, ne na kampani: je to adresa firmy.
  - Chybějící adresa je v kontrole před odesláním **varování `workspace_postal_address_missing`,
    ne závora**, a jen tehdy, když šablona merge tag skutečně používá. Závora by zastavila
    každý projekt, který si nástroj teprve zkouší; kdo si adresu napsal do patičky ručně,
    nemá co řešit.
  - Náhled se přestal rozcházet s odesláním: `contactPreviewData` i nová `samplePreviewData`
    berou kořen `workspace` ze SKUTEČNÉHO projektu. Ukázkové „Demo s.r.o., Na Příkopě 1"
    přitom nešlo jen o náhled, transakční pošta a e-maily seznamu si tenhle vzorek ukládaly
    do `messages.render_data`, takže ukázková adresa odcházela skutečnému příjemci.
- [x] **Proč zadavatel nenašel odkaz na zobrazení v prohlížeči, ačkoli v nabídce byl.**
  Naměřeno na `defaultFilter` z `cmdk@1.1.1`, kterým nabídka filtruje: popisek „Zobrazení
  v prohlížeči" dostal na dotaz „odkaz" i „URL" skóre **0**, takže položka ze seznamu zmizela
  přesně ve chvíli, kdy ji někdo hledal. Dotaz „url" ani „adresa" nenašel v celé skupině nic.
  Opraveno 7. 8., viz oddíl 6.

- [x] **Výmaz podle článku 17 u web_events je hotový, ověřeno 7. 8. na živé databázi.**
  `mlain_app` má v `mlain_clean` `UPDATE` na `properties`, `context` i `page` (dotaz do
  `information_schema.column_privileges`) a job `gdpr.sever_links` všechny tři vyprazdňuje.
  Migrace 0026 je aplikovaná. **Odškrtnuto na základě vlastního měření, ne převzatého tvrzení.**
  **Nález navíc ze 7. 8., opraveno tamtéž: adresa zůstávala v `inbound_deliveries`.** Tabulka
  drží syrovou zprávu od poskytovatele (`payload`) a hlavičky volání (`headers`) a
  `markDelivery` jí při mapování doplní `contact_id`, takže po výmazu ležela v plaintextu
  adresa odrazu a vedla rovnou k vymazané osobě. **Retence to nezachraňuje:** cíl
  `inbound_deliveries` sice řádky po 30 dnech maže, jenže ta lhůta je nastavení projektu
  a dá se prodloužit i vypnout, a výmaz podle článku 17 se na cizí nastavení spoléhat nesmí.
  Řádek se nemaže, jen vyprazdňuje, takže diagnostika endpointu odpovídá dál.
  **Migrace k tomu nebyla potřeba** (ověřeno dotazem: aplikační role má `UPDATE` na všechny
  tři sloupce od 0005). Test ověřen vypnutím.
  Původní znění: výmazový job u událostí z prohlížeče vynuluje **jen `contact_id`
  a `erased_at`**, protože `0005_grants.sql:65` dává aplikaci `GRANT UPDATE` právě na tyhle
  sloupce. **Osobní údaje a IP adresa v `properties` a `context` tedy zůstanou navždy**
- [x] **Odchozí webhooky odcházejí od 6. 8. Doloženo skutečným během, ne jen testem.**
  Řetěz byl hotový až na poslední článek: fan-out vyrobil řádky, **vrátil jejich ID a obsluha je
  zahodila**. Opraveno ve dvou půlkách: zařazení **ve stejné transakci jako zápis řádku** (aby
  úloha nepřežila návrat transakce ani se po něm neztratila) a nová minutová fronta, která
  vyzvedne, co zůstalo ležet.
  **Agent přitom našel druhou vadu, kterou nikdo nehlásil: tlačítko „zkusit znovu" na obrazovce
  doručení nedělalo vůbec nic**, protože jen vrátilo řádek do čekání a nikdo ho nevyzvedl.
  Doloženo během proti skutečné databázi a vlastnímu příjemci na loopbacku: řádek prošel
  čekání → selhání → úspěch, druhý pokus zařadil sken, příjemce obě zprávy fyzicky dostal.
  Test je **záměrně oddělený od stávajících**, protože ty volají doručení napřímo, **a právě proto
  zůstala vada tak dlouho neviditelná.** Ověřeno vypnutím obou půlek zvlášť Řetěz je hotový až na
  poslední článek: `emit.ts:87` vyrobí řádky doručení a **vrátí jejich identifikátory**, ale
  obsluha `webhook_fanout.ts:14` je **zahodí** (návratový typ `Promise<void>`) a doručovací frontu
  nikdo nezařadí. Ověřeno v kódu 6. 8.
  **Doručení, podpis, opakování i obrazovka s výsledky přitom existují a mají testy.** V provozu
  se tedy řádky hromadí ve stavu „čeká" a **neodejde ani jeden webhook**, zatímco obrazovka
  doručení tvrdí, že se doručuje. Oprava jsou tři řádky plus periodický sken, protože opakování
  si podle popisu řídí aplikace, ne fronta
- [x] **Fronta `tracking.erase_contact` zrušena 6. 8.** i se stopami na dalších dvou místech,
  kde by po odstranění zůstala viset jako lež. Náhrobní komentář říká nejen proč zmizela, ale
  i **kam patří případné rozšíření** (do `gdpr.sever_links`, ne do nové fronty vedle), protože
  výmaz podle článku 17 musí mít jednu cestu, u které jde dokázat, že proběhla celá.
  Ověřeno vypnutím: po vrácení fronty do registru brána spadne a donutí přidat obsluhu nebo důvod.
  **Zajímavý detail:** v seznamu nedodaných obsluh u ní stál důvod, který byl ve skutečnosti
  důvodem, proč ta fronta **nemá existovat**, ne proč nemá mít obsluhu
- [x] **Osiřelé fronty se od 7. 8. uklidí samy, a nebyly čtyři, ale PĚT.** K vyjmenovaným
  čtyřem patří i `tracking.rebuild_engagement`; v databázi po nich leželo devět řádků včetně
  dead letter front. **Nález navíc, horší než původní zápis:** dvě z nich (`platform.maintain_partitions`,
  `retention.drop_message_partitions`) měly v `pgboss.schedule` pořád svůj denní výraz a v `pgboss.job`
  po čtyřech ticích ve stavu `created`. **Zrušená fronta tedy dál každý den tikala do prázdna.**
  Řešení: `RETIRED_QUEUES` v registru (jméno + povinný důvod) a krok `retireQueues` při startu
  workeru, který plán zruší a frontu smaže i s úlohami. Maže se v opačném pořadí než zakládá,
  protože `queue.dead_letter` i `job.dead_letter` mají ON DELETE RESTRICT. Selhání start workeru
  neshodí, na rozdíl od srovnání politik: je to úklid po sobě samém, ne podmínka správného chování.
  Ověřeno vypnutím: po vyjmutí položky ze seznamu spadne test, který hlídá, že každý náhrobní
  komentář v registru má protějšek v `RETIRED_QUEUES` (`packages/core/test/queues/retired.test.ts`)
- [x] **Fronta pro selhané úlohy funguje od 7. 8. Původní zápis měl pravdu ve všem kromě rady na konci.**
  „Neopravovat mimochodem, ten cizí klíč má nejspíš důvod" platilo pro KONSTANTU opsanou z registru;
  jenže hodnota se dá číst **poddotazem z `pgboss.queue`**, přesně jako se tam už četla `policy`,
  a pak cizí klíč porušit nejde: vyjde buď jméno, které v `queue` je, nebo NULL.
  **Doloženo skutečným kolečkem přes pg-boss** v dočasném schématu vývojové databáze, oběma směry:
  s `dead_letter` na NULL zůstane selhaná úloha ležet jako `failed` a dead letter fronta je prázdná,
  s poddotazem se do ní úloha přepošle. Směrování dělá CTE `dlq_jobs` v `plans.js` podle sloupce
  **na řádku úlohy** (`SELECT r.dead_letter`), ne podle fronty
- [x] **Testovací prostředí zakládá fronty stejně jako provoz, od 7. 8.** Obě strany berou
  předpis z jedné funkce `queueCreatePlan()` (co, s jakými volbami a v jakém pořadí), takže se
  nemůžou rozejít ani ve volbách, ani v pořadí dead letter front. **Druhá polovina opravy je otisk
  šablony:** `PGBOSS_RECIPE` nesl jen jména front, takže by se přepnutí politiky v registru
  do hotové testovací šablony nepromítlo (`create_queue` má `ON CONFLICT DO NOTHING`) a testy by
  dál běžely nad starou politikou. Nese teď i politiku a dead letter.
  Ověřeno vypnutím: po vrácení vlastního cyklu do `test-support/pgboss.ts` test spadne
- [x] **Izolace projektů se od 7. 8. kontroluje při každém startu.** Nový
  `packages/core/src/tx/isolation-guard.ts` volá `checkIsolationPrerequisites` ze tří míst,
  kde dřív nebylo ani jedno: instrumentace webu, start workeru a **readiness obou**
  (`/api/health/ready` a health port workeru). Výsledek se memoizuje, role se za života
  procesu nemění.
  **Hlásí se to hlasitě, ale start NEPADÁ, a je to rozhodnutí, ne opomenutí:** instalace
  s jediným projektem pod vlastníkem databáze dnes funguje a chybějící izolace jí nic
  neodnese, protože cizí projekt, ze kterého by data unikla, neexistuje. Odmítnutý start by
  jí sebral produkt kvůli riziku, které u ní nenastane. V readiness je proto `warn`, ne
  `fail`: sražená readiness by ji uvrhla do restartové smyčky.
  Ověřeno testem proti skutečné databázi s přepínáním role (`mlain_app` versus vlastník
  schématu) a **vypnutím**: po odebrání zápisu do logu padly 2 ze 4 testů.
  Původní znění: `checkIsolationPrerequisites` existuje a `mlain doctor` ji volá, ale
  **v `apps/web` ani `apps/worker` se nevolá ani jednou** (ověřeno greppem 6. 8.).
  **Následek:** samohostitel s jedinou databázovou rolí dostane funkční aplikaci **bez izolace
  mezi projekty** a dozví se to jen tehdy, když sám spustí kontrolu
- [x] **Centrum úloh vrací od 7. 8. skutečná data. Oprava mého popisu: `registerJobSource` se
  v produkčním kódu nevolal ANI JEDNOU**, jediné výskyty byly v testech, takže endpoint hlásil
  `running_count: 0` i uprostřed běžícího importu. Zapojeny dva zdroje (`import`
  nad tabulkou `imports`, `campaign_audience` nad `campaign_audience_progress`); cronové úklidy
  tam schválně nepatří, do Centra patří práce, která TRVÁ a kterou spustil člověk.
  **Zapojení je v `registerJobRoutes`, ne v `instrumentation.ts`, a je to vědomé:** Next.js
  vyhodnocuje instrumentaci v jiném modulovém grafu než obsluhu trasy, takže by obsluha četla
  vlastní kopii modulu s prázdným registrem. Odsud jsou registrace i obsluha tentýž modul.
  **Rozhodnutí, které stojí za zapsání:** import ve stavu `previewing` se hlásí jako `paused`,
  ne `running`. V té fázi nic neběží a čeká se na potvrzení mapování; jako `running` by odznak
  v topbaru ukazoval úlohu, která sama nikdy neskončí, a odznak, který nejde vynulovat, si
  člověk odvykne číst. Ověřeno testy proti databázi včetně izolace projektů (cizí úloha dá 404),
  a ověřeno vypnutím: bez `installJobSources()` oba nové testy spadnou.
  **Obrazovky pořád chybí, ale to je funkce, ne vada, a je nově v sekci 2.2c**
- [x] **Odmítnuté zprávy už se za doručené nepočítají. Opraveno a 7. 8. přeověřeno celou cestou.**
  Kontroloval jsem to jako možnou dvojí práci a oprava je **hotová a úplná**, ne rozdělaná:
  čítač je ve schématu (`db/src/schema/tracking.ts:249`) i v migraci
  (`0023_campaign_stats_rejected.sql`), plní ho **obě** cesty počítání, tedy přírůstková
  (`tracking/jobs/refresh-campaign-progress.ts:213`) i přepočet od nuly
  (`reports/campaign-stats/recompute.ts:70`), a čte se až po API (`reports/api/schemas.ts:16`).
  **Vzorec `sent - bounced_hard - bounced_soft - failed - rejected` sedí a větev
  `provider_events` odečítání SPRÁVNĚ nedělá**, což bylo to riskantní místo: kdyby odečítala,
  započetla by se odmítnutá zpráva dvakrát. Drží to jmenovaný test
  (`metrics/rates.test.ts`, „u provideru s událostmi doručení se odmítnuté NEODEČÍTAJÍ
  podruhé"), 16 tvrzení zelených. Vzorec je na JEDNOM místě, `deliveredEffective`, a berou
  si ho z něj i dlaždice přehledu a trendová řada ve webu, takže žádná druhá kopie nelže.
  **Jeden důsledek stojí za zapsání, protože sám o sobě vypadá jako další vada:**
  `counts.rejected` je dnes vždycky nula a nemůže být jiná. Událost typu `rejected` neumí
  vyrobit sender (odmítnutí při odesílání klasifikuje jako `ClassPermanent`, tedy
  `messages.status = 'failed'`, a to se odečítá zvlášť), takže jediným možným původcem je
  příjem událostí od SES. Ten je ale **hluchý**: `providers/api/sns-webhook.ts` bez
  registrovaného ověřovače podpisu vrací 503 a nezpracuje nic, a nikdo v repozitáři nezapisuje
  `message_events` se zdrojem `ses_sns`. **Oprava je tedy správná a předběhla svého
  producenta**; ožije s příjmem událostí od Amazonu, který je veden zvlášť.
  Původní znění: `campaign_stats`
  **nemá čítač `rejected`** (ověřeno greppem 6. 8., nula výskytů) a doručenost se počítá jako
  `sent - bouncedHard - bouncedSoft - failed` (`reports/metrics/rates.ts:26`). Zpráva, kterou
  poskytovatel odmítl (typicky kvůli seznamu blokovaných u SES), se tedy **od odeslaných
  neodečte**. Doručenost se nafoukne k sto procentům a **míra prokliku, kterou zadavatel označil
  za hlavní metriku, se podstřelí.** Nikde to nespadne a nikdo si toho nevšimne
- [x] **Zaseknutý import už projekt nezablokuje. Opraveno 6. 8.**
  **Oprava mého popisu:** nebyla to tichá nula, oba joby **padaly hlasitě každou hodinu**,
  protože strážce se ptal tabulky uživatelů, která pod izolací není. Dopad ale platil beze zbytku:
  sken neběžel, import zůstal viset a projekt byl bez importů napořád.
  **Granty jsou záměrně sloupcové, ne na celou tabulku:** shrnutí chyb importu nese ukázky
  z nahraného souboru (tedy e-maily a jména), jméno souboru bývá jméno člověka nebo firmy
  a definice segmentu je práce uživatele. Sken potřebuje identifikaci a čtyři řídicí sloupce.
  Ověřeno na datech oběma směry: role vidí napříč projekty, ale na citlivé sloupce dostane
  odmítnutí. A **doloženo shozením politiky**, takže je vidět rozdíl mezi „nemá právo" (hlasitá
  chyba) a „nemá politiku" (tichá nula). Test u segmentů **zpřísněn**: dřív připouštěl dvě
  odpovědi a ztráta politiky by jím prošla Obnova zaseknutých importů a hodinový
  přepočet segmentů jedou napříč projekty, ale `0009_maintenance_scan.sql` pokrývá **jen
  `workspaces`, `campaigns` a `sender_domains`**; `imports` ani `segments` v něm nejsou a oba joby
  navíc běží pod aplikační rolí, ne údržbovou. Dotaz tedy vrátí **tichou nulu**.
  **Následek:** zabitý worker nechá import ve stavu „probíhá", klíč projektu zůstane obsazený
  a v tom projektu **už nejde spustit žádný další import**. Oprava je malá: doplnit obě tabulky
  do politiky a grantu a přepnout joby na údržbovou roli
- [x] **NEPLATÍ, vyřešeno jinou prací 7. 8. Ověřeno 7. 8., ne převzato.** Sloupec vznikl
  migrací `0025_sending_providers_review_status.sql` a **obcházení přes `information_schema`
  je z kódu pryč**: `providers/repo/provider.ts:175` má `review_status` v `UPDATE` natvrdo,
  takže chybějící sloupec by nově spadl nahlas místo tichého zahození. Hodnota jde celou
  cestou od Amazonu (`ses/account.ts:32`, `Details.ReviewDetails.Status`) přes službu
  (`api/service.ts`) až na obrazovku (`features/sending/provider-review-status.tsx`), která
  rozlišuje všech pět stavů včetně „nikdy nežádali" a „odpověď nedorazila". Migrace záměrně
  NEMÁ `CHECK` na výčet, protože výčet vlastní Amazon a šestá hodnota by shodila celý zápis
  snímku účtu, a s ním i kvóty, na kterých stojí automatická pauza kampaně.
  Přeověřeno spuštěním: databázový test provideru 6 tvrzení zelených, včetně toho, že se
  `PENDING` opravdu uloží a přečte.
  Původní znění: Sloupec
  `sending_providers.review_status` **v žádné migraci není** (ověřeno greppem 6. 8.), a kód se
  na jeho existenci ptá za běhu (`providers/repo/provider.ts:130`, dotaz do `information_schema`)
  a při neexistenci ho z `UPDATE` vynechá. Aplikace tedy nespadne, ale **hodnotu tiše zahodí**,
  takže kontrola před odesláním neporadí, jestli je účet v pískovišti nebo zamítnutý.
  **Týká se to spuštění naostro:** rozdíl mezi „čeká na schválení" a „zamítnuto" je přesně to,
  co člověk potřebuje vědět, než začne rozesílat
- [x] **Na cizím Postgresu se schéma od 7. 8. založí.** `docker/initdb/10-roles.sql` uděluje
  migrátorovi `GRANT CREATE ON DATABASE`. **Ověřeno naostro proti běžícímu Postgresu 18, ne
  odvozeno, a to obojím směrem:** databáze vlastněná cizí rolí, migrátor jako běžná role, bez
  grantu padne `ERROR: permission denied to create extension "citext"` s hintem
  `Must have CREATE privilege on current database`, s grantem projdou všechna tři rozšíření.
  **Nález navíc, který by tu opravu zabil hned na dalším řádku:** skript měl jméno databáze
  `mlain` napsané natvrdo ve třech příkazech, ačkoli je zároveň ručním krokem pro externí
  Postgres, kde se databáze jmenuje `defaultdb`, `neondb` nebo podle projektu. Na takové
  instalaci spadl hned na prvním příkazu, tedy dřív, než se k rozšířením vůbec dostal. Teď
  se jméno bere z `current_database()` přes `format(%I)`. Ověřeno spuštěním proti databázi
  s jiným jménem, včetně druhého běhu (skript musí zůstat idempotentní).
  `.env.example` u externího Postgresu ten požadavek nově vysvětluje.
  **Provozní runbook pro externí Postgres v repozitáři pořád NENÍ** (`docs/operations/`
  má sedm souborů a instalace mezi nimi není), takže vlastní návod dál chybí; tohle
  opravilo artefakt, který operátor spouští, ne dokumentaci kolem něj
  Původní znění: `docker/initdb/10-roles.sql` nedává
  migrátorovi `GRANT CREATE ON DATABASE`, kdežto úplně první migrace zakládá rozšíření
  (`citext`, `pg_trgm`, `btree_gin`). V přibaleném Postgresu to projde, protože je migrátor
  vlastníkem databáze; **na externím Postgresu spadne první migrace** na `permission denied to
  create extension`. Testovací pomocníci si ten grant doplňují sami, provozní návod ne

- [x] **Za otevřeným dialogem už horní lišta nesvítí. Ověřeno 7. 8., opraveno bylo dřív.**
  Nález platil, jen ho mezitím zavřela jiná oprava stupnice: `--z-dialog` je dnes **55**,
  tedy nad `--z-topbar` (50), a `--z-flyout` 60 zůstává nad dialogem, aby šel rozbalit
  seznam uvnitř dialogu. Boční menu (40) tím přestalo záviset na pořadí v DOM.
  Hlídá to `packages/ui/src/lib/tokens.test.ts`, který tvrdí celé pořadí vrstev
  (`sidebar < topbar < dialog < flyout`), ne jen jedno číslo. Ověřeno spuštěním, 39 zelených
- [x] **Uzavřeno 6. 8. jako přijatý kompromis.** Editor si vrství po svém, ale **uvnitř plátna to
  drží** a zvednutí na sdílenou vrstvu by bylo horší: nástrojová lišta bloku by plavala přes horní
  lištu. Ověřeno agentem, který to našel a sám doporučil nesahat na to.
  Původní znění: editor si vrství po svém, mimo stupnici. `block-chrome.tsx` a `block-toolbar.tsx` mají
  `z-10`/`z-20`, `drop-slot.tsx` `zIndex: 40` a `inline-rich-text.tsx` dvakrát `zIndex: 30`
  psané přímo ve stylu. Poslední dvě se v komentářích samy nazývají vysouvací vrstvou a berou si
  její stín, ale vrstvu si vzaly číslem. **Uvnitř plátna to drží** a zvednout je na `--z-flyout`
  by bylo horší: nástrojová lišta bloku by plavala přes horní lištu

- [x] **Formulář úpravy kontaktu už neslibuje e-mail, který neodejde. Opraveno 6. 8.**
  Sliboval **potvrzovací** e-mail u každého seznamu, jenže u jednokrokového odejde **uvítací**,
  a to jen když ho seznam má zapnutý. Ověřeno i empiricky: se zapnutým uvítacím e-mailem zpráva
  vznikla, s vypnutým žádná.
  Použit tentýž přístup jako u zakládání, žádný druhý. **Agent přitom našel třetí případ, který
  jsem nezadal:** u kontaktu, který se dřív odhlásil, odejde i na jednokrokovém seznamu
  **potvrzovací** e-mail. Zaškrtávátko vypadá stejně, následek je jiný, takže se do formuláře
  posílá i tenhle příznak. Test ověřen vypnutím ve dvou krocích
- [x] **Oba zbytky u formuláře kontaktu vyřešeny 7. 8.**
  **„Formulář to nemá jak vědět" neplatilo**, a to je na tom to podstatné: souhlas se sice hledá
  na serveru, ale stránka je serverová komponenta a endpoint `GET /contacts/{id}/consents`
  existuje i s rozsahem (`scope_list_id`). Chyběl jen ten dotaz.
  **A není to okrajový případ, spíš naopak.** Import, veřejný formulář, zakládání přes API
  i ruční zápis souhlasu ukládají rozsah **CELÉHO PROJEKTU** (`scopeListId: null`, ověřeno u pěti
  volajících), takže doložený souhlas dosáhne i na seznam, ve kterém kontakt nikdy nebyl. Slib
  potvrzovacího e-mailu tam byl špatně v běžném případě, ne ve výjimce.
  **Pravidlo se neopsalo, vytáhlo se.** Vznikla čistá funkce `pickEffectiveConsent`
  a `findEffectiveConsent` ji používá, takže server i rozhraní čtou TÝŽ zdroj pravdy. Dotaz
  proto **záměrně nefiltruje rozsah ve WHERE**, přestože by to šlo: byla by to druhá kopie téhož
  pravidla a stačilo by opravit jen jednu. Ověřeno vypnutím, že to není kosmetika: po rozbití
  pravidla spadly **čtyři testy, z toho jeden databázový** nad skutečnými daty.
  **Druhý zbytek, rozloučení**, je zapojený stejně: formulář čte `send_goodbye` a odškrtnutí
  seznamu ohlásí odchozí e-mail jmenovitě. Podmínka na `selected` je podstatná, jinak by hláška
  slíbila rozloučení i po zaškrtnutí a odškrtnutí seznamu, ve kterém kontakt nebyl.
  **Trvalá věta nad seznamy se navíc přestala vázat na konkrétní e-mail.** Slibovala, že se
  u dvojího potvrzení kontakt přihlásí až po kliknutí, což je právě to, co s doloženým souhlasem
  neplatí. Teď o žádné konkrétní zprávě nemluví a odkazuje na hlášky pod seznamy, které se
  ukazují podle skutečného stavu. Test na ni zpřísněn, ať to znění nespadne zpátky.
  Ověřeno vypnutím obou půlek zvlášť (padly právě 2 nové testy)
- [x] **Průvodce importem a zakládáním kampaně kontrolují od 6. 8. oprávnění na vstupu.**
  Do té doby vpustily kohokoli a odmítly ho **až u uložení**, tedy po vyplnění celého průvodce.
  Zvoleno vysvětlení, ne obrazovka jen pro čtení a **ne 404**: obě stránky nejsou obsah, ale
  **akce**, takže „jen pro čtení" by znamenalo ukázat prázdný průvodce, ze kterého se nedá nic
  dozvědět, a „nenalezeno" by tvrdilo, že obrazovka neexistuje, takže by uživatel nevěděl,
  o co má požádat. Použit **existující** stav z obrazovek nastavení, žádné druhé místo ani nové
  texty. Vedlejší přínos: prohlížejícímu se už nenačítají číselníky. Test ověřen vypnutím. `contacts/import`
  a `campaigns/new` pustí dovnitř kohokoli, kdo si napíše adresu, a **odmítnou ho až u uložení**,
  tedy po vyplnění celého průvodce. Na Přehledu je to od 6. 8. ošetřené (akce vysvětlí, že na ni
  člověk nemá právo), ale **přímou adresou ta díra zůstává.** Zjištěno při té opravě
- [x] **Obrazovka `/segments/cleanup` odstraněna 6. 8.** Nebyla nedodělaná, byl to **nákres
  scénáře**: neznala ani id segmentu, takže úklid spustit nemohla, a **počet držela natvrdo na
  nule**. Z toho plynulo nejhorší: poslední krok bylo potvrzení nejvyšší úrovně nad prázdnou
  množinou, s ochranou „opište název", která nechránila nic.
  Odstraněno čistě: stránka, komponenta, testy i 24 klíčů v každém jazyce. Ověřeno v prohlížeči,
  že adresa vrací 404 s naší chybovou stránkou a výpis segmentů funguje dál.
  **Zbývá:** obrazovka je zmíněná ve specifikaci (`specs/parts/02-kontakty.md:3500`) a v plánu
  P11, takže specifikace slibuje cestu, která neexistuje Nevede na ni jediný
  odkaz v aplikaci a kromě odstraněného „Zmrazit" jsou na ní mrtvé i „Stáhnout těch N kontaktů",
  „Zkontrolovat", „Odložit o 14 dní" a „Zrušit úklid", plus výběr akce, který se nikam neukládá.
  Počet kontaktů drží natvrdo na nule. **Je to nákres scénáře, ne zapojená obrazovka:** buď
  dodělat, nebo odstranit
- [x] **„Spočítat přesně" u odhadu počtu segmentu ODSTRANĚNO 7. 8., ne zapojeno.**
  Nález platil, tlačítko bylo bez obsluhy. **Rozhodnuto ho odstranit, a jsou pro to dva důvody,
  z nichž druhý je silnější než ten původně zapsaný.** Zapojit ho nejde: `POST /segments/preview`
  nemá čím delší strop vyžádat a strop je nastavení instalace
  (`SEGMENT_PREVIEW_TIMEOUT_MS`, výchozí 3 s, nejvýš 30 s), tedy věc provozovatele.
  **A i kdyby endpoint `timeout_ms` přijímal, slib „přesně" by neplatil:** s delším stropem může
  počítání dopadnout stejně a uživatel by dostal podruhé odhad od tlačítka, které slíbilo přesné
  číslo. To je ta nejhorší varianta, ne jen mrtvý prvek.
  **Místo tlačítka stojí věta, PROČ je číslo přibližné**, a ta věta říká i cestu k přesnému číslu,
  která **doopravdy existuje**: po uložení se segment přepočítá na pozadí, a ten přepočet má
  **60 s** (`recountSegment`), tedy dvacetinásobek náhledu. Dohledáno, že se přepočet zařazuje
  při založení i při změně definice (`service.ts`), takže ta věta není slib naslepo.
  Klíč `countExactly` nahrazen `estimatedWhy` v obou jazycích, `i18n-check` v souladu

- [x] **Obnova zálohy: vyřešeno 6. 8., a byly to dvě vady, ne jedna.**
  **První** (chybějící cesta k migracím na třech místech) byla opravená už v pracovní kopii:
  `migrationsFolder` je dnes **povinný parametr** a cestu skládá **jediné místo**, které
  vystoupá ke kořeni místo pevného počtu úrovní. Obě pojistky naráz, silnější než jedna.
  Chybělo ale **krytí testem**, takže tu pojistku držel jen typ; doplněno 10 testů, ověřených
  vypnutím ve dvou různých bodech.
  **Druhá vada, kterou nikdo nezadal:** pád migrace sice tichý nebyl, ale **byl nepoužitelný**.
  Výjimka propadla až na vrchol, proces skončil kódem 1 se stackem místo rozlišených kódů, a
  provozovatel se **nedozvěděl to podstatné: že se přeskočilo přidělení oprávnění.** Nově to
  jedno místo v CLI přeloží na kód i hlášku a u obnovy výslovně řekne, že data v databázi jsou,
  oprávnění ne, aplikaci nespouštět a obnovu jde spustit znovu.
  **Detail, který stojí za zapamatování:** chyba se pozná podle tvaru, ne přes `instanceof`,
  protože runner se do procesu dostává dynamickým importem ze dvou míst a druhá kopie modulu
  by po zabundlování `instanceof` tiše shodila na `false`, tedy přesně zpátky do té vady
  `packages/core/src/ops/restore.ts:125` volá `runMigrations({ url })` **bez `migrationsFolder`**,
  kdežto `mlain migrate` a `mlain backup verify` ho předávají (`resolveMigrationsFolder`).
  V zabundlovaném CLI si runner cestu neodvodí, takže migrace spadne. **A hned za ní stojí krok,
  bez kterého je obnova nepoužitelná:** `mlain_apply_grants()`, protože `pg_dump --no-privileges`
  žádná oprávnění nepřenáší. Pád migrace ho tedy přeskočí a obnovená databáze odpoví
  `permission denied for table contacts`.
  Ověřeno čtením 6. 8., **spuštěním ne**, ověřit to jde jedině proti produkční image.
  Stejná chybějící cesta je v `ops/upgrade.ts` a `ops/jobs/backup-jobs.ts:87` (nedělní ověření
  zálohy). Ironií je, že `apps/cli/src/migrations-folder.ts` existuje právě proto, že se tahle
  vada už jednou opravovala
- [x] **Licenční hlídač hlídá od 6. 8. skutečnost, ne text.** Dockerfile dostal `ARG`/`ENV`
  ve fázi instalace závislostí a **před instalací**, s výchozí hodnotou 0 (chování beze změny).
  Test se **už neptá na dokument**: rozřeže Dockerfile na fáze, zahodí komentáře a ptá se
  na instrukce, včetně jejich **pořadí**.
  **Ověřeno vypnutím dvakrát**, a to druhé je to cenné: přesun `ARG` až za instalaci build
  nerozbije a výměnu přesto neprovede, a test to chytí. Při psaní navíc první běh spadl na
  komentáři obsahujícím hledaný řetězec, což je táž vada v malém, a proto ten filtr komentářů.
  Původní znění: test kontroloval, že dokumentace obsahuje řetězec `license-obligations.test.ts` kontroluje, že
  dokument obsahuje jméno proměnné `SHARP_FORCE_GLOBAL_LIBVIPS`. Proto svítil zeleně nad postupem
  výměny libvips, **který Dockerfile vůbec nečte** (žádný takový `ARG` tam není). U LGPL komponenty
  je ta výměna licenční povinnost, takže zelený test tvrdil splněnou povinnost, která splněná není
- [x] **Nezdokumentované přepínače CLI: vyřešeno 6. 8., a systémově.** `mlain doctor` měl v registru
  holé `usage`, přestože čte `--json` i `--strict`, a `--strict` přitom **mění návratový kód**,
  takže je to jediná cesta, jak varování v cronu něco udělá. Místo dopsání dvou řetězců **registr
  přepínače nově vlastní** a nápověda je vypisuje; popsáno u všech sedmi příkazů, které nějaké
  mají. **Pojistka je obousměrná:** test vyžaduje popis ke každému přepínači v `usage` a zároveň
  odmítne popis přepínače, který v `usage` není, takže nejde přidat jen do jedné poloviny
- [x] **`mlain upgrade` odchytává selhání migrace. Opraveno 6. 8.** Sjednoceno s `migrate` přes
  totéž jedno místo, které vzniklo u obnovy zálohy, protože je to táž vada
- [x] **`mlain genkey` už nemá výchozí `--id`. Opraveno 6. 8.** Stav se čte **z prostředí, ne
  z databáze**, a je to vědomá volba: příkaz se pouští právě tehdy, když je s klíči něco
  v nepořádku, tedy před instalací nebo při havárii, kdy databáze nemusí být dostupná.
  Tři pravidla: číslo se odvodí z prostředí a vypíše se z čeho; **když prostředí nezná nic,
  příkaz odmítne hádat** (protože „nevím" a „nová instalace" vypadají zvenčí stejně a chybný odhad
  je právě ta nevratná ztráta); a už použité číslo odmítne s návrhem nejbližšího volného.
  Jsou to **dvě nezávislé pojistky**, takže i kdyby někdo výchozí hodnotu vrátil, kolizní kontrola
  ten omyl zastaví. Ověřeno vypnutím, kde se to hezky ukázalo: se starou výchozí hodnotou spadly
  tři testy, ale ten na kolizi zůstal zelený, protože druhá pojistka drží
  Původní znění: kdo přepínač vynechal podruhé, Kdo přepínač vynechá podruhé,
  vyrobí druhý různý klíč se stejným `key_id` a **data zašifrovaná prvním klíčem se přestanou dát
  přečíst**
- [x] **Odeslaná ukázková kampaň má od 7. 8. archivovanou podobu.** Seed po vložení kampaně
  doplní `design` (vlastní kopii dokumentu, tak jak ji drží skutečná kampaň), `compiled_html`,
  `compiled_text` a `compiled_at`. Díra v předpokladu, na kterém stálo rozhodnutí o barvách,
  je tím zavřená: odeslaná kampaň drží hotové HTML **u všech sedmi**, ne u šesti.
  **Kompiluje se jako NÁHLED, ne jako odeslání, a je to vědomé.** `purpose: 'send'` přepisuje
  odkazy na měřicí adresy odvozené z `campaignId` a k nim patří řádky v `campaign_links`, které
  seed nezakládá. Vzniklo by HTML s odkazy bez protějšku, tedy proklik do prázdna. Test to tvrdí
  přímo: `campaign_links` musí zůstat na nule.
  **Vedlejší přínos, který jsem nečekal:** report ukázkové kampaně ukazoval místo e-mailu prázdný
  stav („kampaň zatím nemá uloženou podobu") přesně na obrazovce, která má ukázkou něco předvést.
  Seed dostal `ctx` (kompilace přes něj dohledá assety a nastavení projektu), volající ho má
  z `c.get('auth')`. Ověřeno **proti skutečné databázi**, ne jen typem, a ověřeno vypnutím:
  bez toho zápisu spadl právě ten nový test
- [x] **„Neznámé zařízení" byl náš vlastní výmysl. Opraveno 6. 8. u příčiny.**
  Přihlášení jde ze serverové akce a ta přeposílala relační cookie, jazyk i projekt, **ale ne
  označení prohlížeče**. Požadavek tedy odesílal Node a představil se jako `node`, což API
  poslušně uložilo. Odtud 263 relací se stejnou hodnotou.
  **Netýkalo se to jen té obrazovky:** tutéž hlavičku bere i auditní záznam o přihlášení
  a odhlášení, takže v auditu stálo `node` taky.
  Opraveno na jednom místě, platí pro všechna volání. **Staré relace se nepřepisují** a ukazují
  náhradní text, což je správně: prohlížečem opravdu nevznikly a syrový údaj se do rozhraní
  nepouští. Test ověřen vypnutím.
  Původní znění: obrazovka nikdy neukázala zařízení Všechny relace včetně zadavatelovy
  mají v databázi jako zařízení `node`, takže se vždy vypíše „Neznámé zařízení". Vypadá to, že se
  přihlášení zakládá zevnitř serveru a uloží se volající, ne prohlížeč. Tím ta obrazovka ztrácí
  smysl, protože má sloužit k poznání cizího přihlášení
- [x] **Tmavý režim jde od 7. 8. nastavit, ne jen strpět.** Šlo se doporučenou cestou: panel
  Motiv nabízí ve skupině „Tmavý režim" **plochy pro tmavý režim** (`theme.darkMode.colors`),
  tedy mechanismus, který existoval a nikdo ho nenabízel. Emitter se nemění, `!important`
  zůstává, jen teď vydá barvu, kterou uživatel zvolil.
  **Tři poloviny, každá zvlášť ověřená vypnutím:**
  pole se nabízejí **jen u strategie `auto`** (při `off` emitter tmavou paletu nevydá vůbec,
  takže by to byla pole, po kterých se v e-mailu nic nepozná);
  **vzorník kreslí TMAVÉ odstíny**, protože se světlými by uživatel klikl na téměř bílé plátno
  a příjemce dostal skoro černé, tedy vzorek by ukazoval jinou barvu, než jakou volba nastaví
  (přibyl `scheme` na deskriptoru barvy, `ColorControl` podle něj bere paletu);
  a zápis jde do tmavé mapy, ne do světlé.
  **O cíli zápisu rozhoduje jedno místo** (`colorTarget` v `theme-panel.tsx`), kterého se ptá
  čtení i obsluha. Se dvěma paletami by z původní podmínky u hodnoty a druhé u obsluhy byly
  čtyři kopie téhož rozhodnutí a stačilo by opravit tři z nich.
  Nápověda u pole říká, co se stane, a připomíná i druhou cestu ven, totiž tmavý režim vypnout.
  Ověřeno vypnutím dvakrát (vzorník i podmínka viditelnosti), pokaždé spadl právě ten test
- [x] **Volba role v panelu Motiv už barvu nezmrazí. Ověřeno 7. 8., opraveno bylo dřív.**
  **Do sekce 3 to přesouvat netřeba, závěr z 6. 8. („opravit dnes NEJDE") už neplatí:**
  vybrala se ta cesta, která se tehdy zamítla jako riskantní (odkaz přímo v barvách), a všechny
  tři změřené překážky padly. Kontrakt dokumentu se změnil: `$defs.colorRef` je dnes
  `oneOf [hexColor, jméno role]`, takže se dokument uloží. `resolveTheme` nepřímost rozvazuje
  (`resolveRole`) **s ochranou proti kruhu**, který končí výchozím odstínem místo chyby, takže
  do HTML odchází pořád hex a jméno role se v deklaraci objevit nemůže. Panel ukládá to, co
  uživatel zvolil.
  Hlídá to `theme-panel.test.tsx` testem na oba směry naráz: po změně značky se role přebarví
  a vlastní odstín zůstane. Ověřeno spuštěním.
  Původní znění: „Pozadí plátna = hlavní barva značky" uloží
  konkrétní odstín, ne vazbu, takže se po změně značky nezmění. Uživatel čeká vazbu
- [x] **Krok 2 kampaně uloží od 6. 8. jméno i u čerstvé kampaně.** Do té doby přejmenování
  **nešlo dokončit vůbec**, dokud se nevyplnil předmět a publikum.
  Agent to vyřešil líp, než jsem zadal: **nevyjmul jméno jen z validace, ale z formuláře úplně**
  a použil tutéž komponentu i akci jako hlavička kroku 1. **Míst, která jméno ukládají, tím ubylo
  ze dvou na jedno**, ne přibylo.
  Vyjmutí jen z validace by nestačilo: požadavek by jméno dál posílal v těle a **u naplánované
  kampaně by ten klíč shodil celý požadavek**. Test ověřen vypnutím ve dvou krocích
- [x] **Zamčená kampaň má od 6. 8. v kroku 2 pole pro jméno.** Agent to **málem odepsal jako už
  opravené** a byla by to chyba: formulář má dvě větve vykreslení a pole přibylo jen do té druhé,
  kdežto zamčená kampaň se do ní nikdy nedostane. **Rozhoduje stav, ne to, jestli jde upravit
  obsah:** naplánované kampani se jméno měnit smí, odesílající se dostane holý text.
  Odstraněn i opsaný řádek se jménem níž v kartě, protože by po přejmenování ukazoval starou
  hodnotu. Test ověřen vypnutím.
  Původní znění: u zamčené a naplánované kampaně zůstávalo jméno jen jako text, přestože
  přejmenovat ji lze a krok 1 pole nabízí. Nesrovnalost, ne regrese; zjištěno 6. 8. Uložení pouští validaci celého formuláře, takže
  u čerstvé kampaně spadne na prázdném předmětu a publiku. Inline pole v hlavičce to obchází,
  neopravuje
- [x] **Formulář „Přidat kontakt" se od 6. 8. přiznává k předvyplnění a hlásí odchozí e-mail.**
  Předvyplnění **zůstalo**, protože je to zapsané rozhodnutí zadavatele z 5. 8.; agent správně
  odmítl ho přebít a splnil druhou variantu. U předvyplněného seznamu je teď štítek „zaškrtli jsme
  ho za vás" (bez něj to vypadá jako volba uživatele, a přesně to dva lidi přehlédli) a **nad
  tlačítkem stojí výstraha se jmény seznamů**, ale **jen když e-mail opravdu odejde**. Dohledáno
  v kódu: odejde jedině u zaškrtnutého seznamu s dvojím potvrzením a volbou „Nepotvrzeného".
  **Slibovat e-mail, který neodejde, by bylo stejně špatné jako mlčet o tom, který odejde.**
  Test ověřen vypnutím. Původní znění: Odběratelé byli zaškrtnutí předem.
  Kdo si toho nevšimne, přihlásí člověka do seznamu, o kterém nevěděl, a **u dvojího potvrzení
  mu rovnou odejde e-mail.** Narazili na to dva agenti nezávisle, oba tím nechtěně vyrobili
  odchozí zprávu
- [x] **Prohlížející už na Přehledu ví, proč na akci nedosáhne. Opraveno 6. 8.**
  Akce zůstávají vidět (pravidlo 7.2b), pod každou stojí věta, koho požádat, ve stejné formě,
  jakou aplikace používá u omezení zpracování. **Odkaz se ale změnil na tlačítko**, protože cílové
  obrazovky oprávnění samy nekontrolují a prohlížející by doklikal průvodce až k odmítnutému
  uložení. Kliknutí přesune fokus na vysvětlení, takže ho dostane i klávesnice a odečítač.
  Když se roli nepodaří zjistit, akce se nabízejí jako dřív: **falešné „nemáte oprávnění" by bylo
  horší než odmítnutí ze serveru.** Test ověřen vypnutím (padly 4).
  Původní znění: prohlížející viděl „Naimportovat kontakty",
  „Založit kampaň", „Odstranit" u ukázkových dat), a **bez vysvětlení**. Pravidlo 2 ze 7.2b říká,
  že se akce nemají skrývat, ale vysvětlovat. Tyhle nejsou ani skryté, ani vysvětlené
- [x] **Potvrzení odběru přepínalo po kliknutí jazyk. Opraveno 6. 8., naměřeno v prohlížeči.**
  Před opravou: nabídka `lang=en`, výsledek po kliknutí `lang=cs`. Po opravě obojí `en`.
  `confirmByRef` si teď jazyk kontaktu dohledá **před** potvrzením, protože potvrzení token
  spotřebuje a potom už kontakt dohledat nejde. Test ověřen vypnutím opravy (2 failed → 2 passed).
  Původní znění nálezu: stránka „Potvrdit odběr" jela v jazyce
  kontaktu, ale výsledek po kliknutí v jazyce projektu (`confirmByRef`,
  `packages/core/src/contacts/public/confirm.ts:144`). **Pozor:** širší verze tohohle tvrzení
  („veřejné stránky ignorují jazyk kontaktu", „odhlašovací stránka chodí v jazyce projektu")
  je **vyvrácená měřením**, ne odhadem. Anglický kontakt v českém projektu dostal odhlašovací
  stránku anglicky
- [x] **Pozvánka chodí v jazyce PROJEKTU. Ověřeno 7. 8., opraveno bylo dřív.**
  `identity/invitation-service.ts:163` bere `readWorkspaceLocaleTx(tx, ctx)` a `DEFAULT_LOCALE`
  zůstal jen jako pojistka pro případ, že by řádek projektu nešel přečíst. Jazyk zvaného vzít
  nejde, ten účet v tu chvíli ještě nemá; z toho, co je k dispozici, je projekt správná volba,
  protože pozvánka zve DO NĚJ. Hlídá to `membership-service.test.ts:311` tvrzením
  `expect(sent[0].locale).toBe('en')` nad anglickým projektem, tedy měří ten rozdíl, ne jen
  přítomnost pole. Spuštěno, 14 zelených.
  **Druhá půlka nálezu byla nepravdivá:** žádný e-mail o konci zkušebního režimu v repozitáři
  neexistuje. „Zkušební režim" tu neznamená časově omezenou zkoušku, ale omezení odesílání
  na ověřené adresy, dokud projekt nemá ověřenou doménu. Jediný e-mail k němu je potvrzení
  jedné adresy (`trial_address_verification`)
- [x] **Uzavřeno 6. 8.: týká se jen vývojového režimu a jeho škodlivá půlka je opravená.**
  Ukládání se po konfliktu už nezacyklí a řekne, že práce není uložená. **Samotné přemontování
  editoru při přestavbě kódu je vlastnost nástroje, ne produktu**, a v provozu nenastane.
  Zůstává jako provozní poznámka: dokud pracují agenti, nelze v editoru věřit stavu ukládání.
  Původní znění: týká se jen vývoje, ale
  stálo to dnes hodiny hledání: dev server editor přemontuje, ten ztratí otisk dokumentu a další
  uložení server odmítne jako konflikt. Hlavička přitom hlásí „Ukládá se samo", takže to vypadá
  jako mrtvý editor. **Dokud pracují agenti, nelze v editoru věřit stavu ukládání**
- [x] **`Button size="lg"` obcházelo vlastní pravidlo. Opraveno 6. 8.** Rozměr byl správný
  (48 px podle příručky), jen napsaný špatným způsobem. Zaveden token `--size-control-lg`
  vedle `-sm` a `-xs`, doplněn do tabulky v příručce, test hlídá i to, že se `min-h-12` nevrátí.
  Původně: `packages/ui/src/components/button.tsx:67` `packages/ui/src/components/button.tsx:67`
  má `min-h-12`, tedy číslo z Tailwindu, kdežto `md` na řádku 66 správně používá
  `min-h-[var(--size-target-min)]`. Příručka `DESIGN-ZAKLAD.md` přitom v kapitole 5 tenhle přesně
  postup zakazuje: „`min-h-11` je náhodou 44 px, ale změna `--size-target-min` ho mine."
  **Základ porušuje pravidlo sám u sebe.** Ověřeno v kódu 6. 8.
- [x] **Dva mrtvé odkazy na reportu: vyřešeny 6. 8., každý jinak.**
  **„Duplikovat" napojeno** na hotovou akci, ověřeno v prohlížeči (kopie vznikla, agent ji hned
  smazal). **„Poslat znovu neotevřevším" odstraněno**, a to z důvodu, který jsem nečekal:
  napojit ho na duplikaci by **nebylo neúplné, ale nebezpečné.** Duplikace kopíruje **původní
  publikum**, takže by tlačítko s tím nápisem vyrobilo kampaň adresovanou znovu **všem**.
  Mrtvý odkaz neudělá nic; tenhle by poslal druhý e-mail celému seznamu a uživatel by si myslel,
  že píše jen těm, kdo neotevřeli.
  **Táž práce jde udělat dvěma akcemi vedle sebe:** vytvořit segment z neotevřevších (funguje)
  a duplikovat kampaň, pak v kopii přepnout publikum. Osiřelý klíč smazán.
  Původní znění nálezu:
  **„Duplikovat" napojit lze** a je to malá změna, protože nová `duplicateCampaignAction` vrací
  id kopie. Report je ale serverová komponenta a ta akce potřebuje `workspaceId`, který dnes
  dostává jen jako slug. **„Znovu neotevřeným" napojit nejde:** duplikace vyrobí kopii s původním
  publikem, ne se zúženým na neotevřené. Chce to segment z reportu nebo nový parametr endpointu.
  **Doporučení: ten druhý odkaz zatím spíš schovat, než ho nechat vést do prázdna.**
  Původní znění: „Duplikovat" a „Znovu neotevřeným"
  (`features/reports/report/follow-up-actions.tsx:39` a `:42`) vedou na `/campaigns/new` s
  parametrem, který **stránka `campaigns/new/page.tsx` vůbec nečte**. Otevře se prázdný průvodce,
  jako by se nekliklo. Zjištěno při průzkumu řádkových nabídek 6. 8.
- [x] **Řádkové nabídky napříč aplikací: HOTOVO 6. 8., všech šest seznamů.** Kampaně, Segmenty,
  Šablony, Formuláře, Seznamy, Štítky. Všude tentýž tvar, tentýž spouštěč (34 px viditelně,
  44 px klikací plocha), oddělovač před červenou položkou, **nic zašedlého**.
  **Zpřístupnily se tři funkce, které rozhraní nikdy nevolalo**, přestože v API byly: duplikace
  kampaně, duplikace šablony a mazání segmentu. Plus akce dosud schované jinde: pozastavení
  a zrušení rozesílky (byly na obrazovce průběhu), zrušení plánu (dvě kliknutí v nastavení),
  pozastavení formuláře (přepínač v editoru), nastavení výchozího seznamu a potvrzení čekajících.
  **Pět nových modulů se stavovou logikou**, každý bez Reactu, takže se dají zkoušet samostatně.
  Tím zmizely rozejité kopie stavů kampaně ze čtyř souborů a podmínka o zapojené šabloně z pátého.
  **Tři potvrzovací okna se osamostatnila**, aby je uměla otevřít i nabídka; jinak by vznikly
  druhé výčty následků, které se časem rozejdou.
  Mrtvý kód pryč: ikonový vzhled mazacího tlačítka a sloupec s kódem k vložení.
  **Každý seznam ověřen vypnutím opravy, celkem 12 testů spadlo přesně tam, kde mělo.**
  Ověřeno mnou: pět modulů existuje, typová kontrola webu čistá, katalogy v souladu (4604 klíčů)
- [x] **Kampaně: 1/6, podrobně.** Osm akcí podle stavu, mezi nimi
  **duplikace, ke které se přes rozhraní nedalo dostat vůbec** (endpoint existoval bez volajícího),
  a pozastavení, pokračování i zrušení rozesílky, dosud schované na obrazovce průběhu.
  **Rozejité kopie stavů zmizely ze čtyř souborů** do jednoho modulu, ověřeno greppem.
  Dvě vědomé odchylky od API: **zrušení rozesílky se u naplánované kampaně nenabízí** (správná
  cesta ven je zrušit plán, po němž je kampaň zase koncept), a **„Pokračovat" se vynechá u kampaně
  zastavené poskytovatelem**, protože to server stejně odmítne. Test ověřen vypnutím: po zrcadlení
  API spadly 3 testy. Zbývá pět seznamů.
- [x] **Segment jde od 6. 8. smazat z rozhraní** (2/6 seznamů hotovo). Endpoint existoval bez
  volajícího. Okno mazání má **každou větu ověřenou v kódu**, hlavně tu první: „kontakty se
  nemažou, segment je uložená podmínka, ne skupina lidí". Bez ní by si lidé mysleli, že mažou
  kontakty. Věta o ručním soupisu členů se ukazuje **jen u ručního segmentu**, u dynamického by
  to byla lež. Dialog je samostatný soubor, aby ho převzal i detail segmentu, kde mazání pořád
  chybí. Test ověřen vypnutím dvakrát.
  **Nález navíc:** přepočet segmentu si vyžádá právo zápisu, přestože vypadá jako čtení, takže
  se čtenáři do dneška nabízel a končil odmítnutím bez vysvětlení. Teď se mu nenabídne
- [x] **Pozvánka od 7. 8. funguje i pro člověka, který účet ještě nemá. A nález byl ve
  skutečnosti horší, než jak se popisoval.**
  **Oprava mého popisu, doložená výčtem tras a zápisů do `users`:** `SIGNUP_MODE` neřídil
  **NIC**. Neměl v produkčním kódu jediného konzumenta (poslední zmizel z obrazovky „nemáte
  přístup k žádnému projektu") a **cesta veřejné registrace v repozitáři vůbec neexistovala**:
  do `users` zapisovaly právě dva soubory, `setup.ts` (jednou za život instalace) a
  `member-create.ts` (správce rukou). Změna výchozí hodnoty by tedy sama o sobě nezměnila
  vůbec nic.
  **Skutečná slepá ulička:** pozvánka e-mailem odešla, pozvaný klikl na odkaz a obrazovka mu
  nabídla **jedině přihlášení k účtu, který nemá**. Text u ní přitom sliboval „Přihlaste se
  nebo si založte účet". Celá funkce pozvánek fungovala výhradně pro lidi, kteří v instalaci
  účet UŽ MĚLI, tedy pro ty, kdo ji nepotřebují.
  **Řešení:** nová trasa `POST /api/v1/invitations/signup` a služba
  `packages/core/src/identity/signup.ts`. Účet vznikne jedině s 32bajtovým tokenem pozvánky
  a **na adresu z pozvánky, ne z těla požadavku**, takže si držitel cizího odkazu nezaloží
  účet na svou ani smyšlenou adresu. Všechno v jedné transakci (účet, přijetí pozvánky,
  členství, relace), jinak by pád mezi kroky nechal účet bez jediného projektu. Existující
  účet se **nepřebírá a heslo se mu nemění**, jinak by správce jednoho projektu převzal účet
  člověka z projektu cizího pouhým pozváním jeho adresy.
  **Výchozí hodnota je teď `invite`** podle rozhodnutí z 31. 7. Registraci to neotvírá,
  bez tokenu se účet založit nedá. `closed` zůstává a nově má srozumitelný následek: pozvaný
  se dozví, že si účet založit nemůže, místo aby ho obrazovka poslala na přihlášení.
  `open` (veřejná registrace bez pozvánky) **zatím neimplementuje nic**, `.env.example`
  i spec to říkají nahlas.
  `.env.example` proměnnou nově vysvětluje, spec části 1 (3.1 a tabulka 4.9) je srovnaná
  se skutečností.
  Ověřeno pěti testy služby proti skutečné databázi a **třemi testy přes HTTP** (trasa projde
  bez relace, vrátí `Set-Cookie` s `HttpOnly`, neplatný token dá 404 a ne 401, pole `email`
  v těle požadavek shodí). Ověřeno vypnutím: bez nastavení workspace kontextu je projekt
  neviditelný a padnou 2 z 5 testů.
  Původní znění: `SIGNUP_MODE` má v `schema-platform.ts:88` výchozí hodnotu **`closed`**,
  kdežto rozhodnutí zadavatele z 31. 7. říká „invite: doporučený výchozí stav". **A
  v `.env.example` ta proměnná vůbec není**, takže provozovatel nemá jak zjistit, že existuje
- [x] **Archivace seznamu se od 6. 8. ptá.** Ikona otevírá potvrzení úrovně N2 (táž jako mazání
  kontaktu). **Následky jsou dohledané v kódu, ne vymyšlené:** seznam zmizí z nabídek, přestane
  přijímat nová přihlášení (`subscribe` na archivovaný seznam vrátí 404), ale **kontakty,
  přihlášení ani historie souhlasů se nemažou**. Čtvrtý následek „přestane být výchozí" se ukáže
  jen u výchozího seznamu, jinde by to byla lež. Neúspěch se nově hlásí, dřív se návratová hodnota
  vůbec nečetla. Test ověřen vypnutím (padlo všech 6).
  **Zbývá:** odarchivovat nejde z rozhraní ani z API, `PATCH` archivovaný seznam odmítne. V databázi
  by stačilo vynulovat `deleted_at`. Dokud endpoint není, je věta o nevratnosti pravdivá.
  Původní znění: ikona archivu na detailu seznamu
  (`list-detail.tsx:304`) volá akci rovnou v `onClick`, **žádný potvrzovací dialog**, a hned nato
  `router.push` pryč z obrazovky. Ověřeno v kódu 6. 8. Archivace je přitom u seznamu to, čemu se
  jinde říká smazání (mazání seznamu neexistuje), takže jedno kliknutí vedle znamená ztrátu
  přístupu k seznamu bez jediné otázky. Návrat na obrazovku, ze které se to dá vrátit, chybí
- [x] **Mrtvá tlačítka u segmentů: opraveno 6. 8., a nebyla tři, ale čtyři.** „Zkusit znovu"
  a „Přepočítat" zapojeny, plus **čtvrté, které se z kódu nepoznalo**: „Spočítat" mělo obsluhu,
  ale ta jen vyrobila nový objekt stavu, na kterém nic nezáviselo. **„Zmrazit" odstraněno**, ne
  zapojeno: endpoint chce id segmentu a jméno kopie, a ta obrazovka nemá ani jedno.
  Test ověřen vypnutím (padly právě 4 nové).
  **Agent přitom správně odmítl moje doporučení** použít `recountSegmentAction`: ta přepočítává
  **uloženou** definici podle id, kdežto v editoru má člověk rozepsanou podmínku, kterou ještě
  neuložil. Vrátila by číslo k něčemu jinému, než co má před sebou.
  Původní znění: tři `<Button>` bez `onClick`:
  `live-count.tsx:288` „Zkusit znovu" v chybové hlášce, `live-count.tsx:298` „Přepočítat"
  u zastaralého počtu, `cleanup-scenario.tsx:57` „Zmrazit". **První dvě jsou horší, než vypadají:**
  objeví se právě ve chvíli, kdy je člověk potřebuje, tedy po chybě a u zastaralého čísla
- [x] **`NALEZY-NAPRIC-PLANY.md` vytěžen 6. 8.** Výstup:
  **`docs/superpowers/plans/NALEZY-VYTEZENI-2026-08-06.md`**, původní soubor nedotčen.
  Ze 126 položek: **28 platí, 65 opraveno, 20 bezpředmětných** (řešení se změnilo, vada nemá kde
  být), 6 se týká textu specifikace a čtením kódu se rozhodnout nedá, 7 přeskočeno.
  **Nejtěžší bylo rozlišit „opraveno" od „bezpředmětné":** půlka nálezů se nezavřela opravou,
  ale tím, že se změnilo řešení. Kdyby je označil za platné, poslal by někoho dělat zbytečnou
  práci. Ty, které jdou rozhodnout jen podle textu specifikace, vede zvlášť místo aby je schoval
  mezi opravené.
  Pět nejzávažnějších je už rozepsaných výš v tomhle seznamu.
- [x] **Pravidlo `no-disabled-primary-action` se od 6. 8. spouští, a nálezů je nula.**
  Agent tomu nevěřil a ověřil si pokusným souborem, že pravidlo funguje. **Nemá co najít, protože
  ten zákaz je už v typech:** hlasité tlačítko má `disabled?: never` a místo něj povinné
  vysvětlení, takže kombinace neprojde přes typovou kontrolu a do lintu se nedostane.
  Prošel všech 29 míst s `disabled`, všechna jsou tichá tlačítka nebo formulářová pole.
  Užitek zůstává jako **druhá pojistka** pro syrová tlačítka mimo sdílenou knihovnu.
  Původní znění: pravidlo existovalo i s testem a nikdy neběželo Existuje v
  `packages/ui/eslint-rules/` včetně vlastního testu a seznamu výjimek, ale kořenový
  `eslint.config.js` ho **neregistruje** (ověřeno greppem 6. 8., nula výskytů), importuje jen
  pravidlo z `packages/core`. **Hlídá přitom právě to, na co jsme dnes naráželi**, totiž zašedlé
  hlavní akce místo vysvětlení Má zhruba 190 nálezů v oddílu „Otevřené", jenže
  uzavíralo se v něm **na místě slovem, ne přesunem**, takže nadpis o stavu položky nic neříká.
  Namátková kontrola ze 6. 8.: jeden nález opravený, jeden pořád platí. **Je to směs, ne seznam
  práce.** Projít ho proti kódu je samostatný úkol; co z něj přežije, patří sem, ne zpátky tam
- [x] **Přesunuto 7. 8. do sekce 2.2c jako nedodaná schopnost, ne vada.** Platí to pořád
  a rozšířilo se to: v `apps/web/src` chybí nejen detail úlohy, ale **celé Centrum úloh**.
  Komponenty `JobsCenter` i `JobsBadge` v `packages/ui` existují včetně testů a nikdo je nepoužívá
  (ověřeno greppem 7. 8., nula výskytů). Do nálezů to nepatří, protože chybějící obrazovka není
  rozbitá obrazovka. API pod ní od 7. 8. vrací skutečná data
- [x] **`.DS_Store`: vyřešeno 6. 8., a bylo to jinak, než jsem psal.** V gitu **žádný nebyl**
  (`git ls-files` nic nevrací) a `.gitignore` vzor už měl, takže doplňovat nebylo co. V pracovní
  kopii jich ale nebyly dva, ale **sedm**. Všechny smazané, kontrolní `find` vrací nulu
- [x] **Report vracel 200 i na neexistující kampaň. Opraveno 6. 8.** Stránka teď na serveru ověří
  přístup a načte kampaň: 404 z API vede na `notFound()`, **vypršení a výpadek na chybový blok**,
  ne na „stránka nenalezena". Použit hotový `CampaignLoadProblem`, žádný druhý vzor.
  Test ověřen vypnutím opravy (3 z 5 případů spadly). Původně: `notFound()` se nevolal, data
  tahá až klient, takže vymyšlená adresa dá rozbitou stránku místo 404
- [x] **Aplikace má od 6. 8. vlastní stránku pro 404.** Dva tenké soubory nad jedním tvarem:
  `[locale]/not-found.tsx` (obslouží i projektovou větev, protože `notFound()` hledá nejbližší
  soubor **nad** sebou, a ke svému vykreslení slug projektu nepotřebuje) a kořenový
  `app/not-found.tsx` pro adresy, které jazykovou předponu vůbec nedostanou (`/robots.txt`).
  Ověřeno v prohlížeči obojí. Původně: chyběl, takže každé 404 vykreslilo výchozí černobílou stránku
  Nextu. Kromě toho, že je to nedodělek, se podle vzhledu pozná, jestli šlo o chybějící stránku,
  nebo o chybu z našeho rozhraní. To se hodí při diagnostice
- [x] **`Escape` v poli pro adresu odkazu zavírá jen ten řádek. Ověřeno 7. 8., opraveno bylo dřív.**
  Zastavuje se to `stopPropagation` u toho řádku (`richtext/toolbar.tsx`), ne výjimkou na plátně,
  a v komentáři je i důvod: s výjimkou na plátně potřeboval odchod z psaní **tři stisky** místo
  jednoho, protože Tiptap prvním Escape jen odebere fokus z `contenteditable`. Dvoukrokový
  Escape na plátně tak zůstal celý. Odkaz se přitom ani nenastaví, ani neruší, a fokus se
  vrací do textu. Hlídá to `rich-text-field.test.tsx:82`, ověřeno spuštěním
- [x] **Uzavřeno 6. 8.: vědomé rozhodnutí z návrhu, ne vada.** Minimální šířka mřížky je
  popsaná v komentáři u kódu: tři panely vedle sebe pod tou šířkou přestanou být použitelné
  a zalomení pod sebe by z editoru udělalo dlouhý svitek. **Měnit to znamená měnit návrh editoru.**
  Původní znění: editor roluje vodorovně pod šířkou okna asi 1460 px kvůli `min-width: 1140px` na mřížce
  (`editor-shell.tsx:344`). Vědomé rozhodnutí z návrhu, popsané v komentáři na řádku 241.
  Nesouvisí s panelem vlastností, ten se opravil
- [x] **Klikací plocha spouštěče „Zobrazit jako" srovnána 6. 8.** na 44 px přes neviditelný
  překryv, viditelné tlačítko zůstalo 36 px. **Naměřeno klikáním po jednotlivých pixelech**
  nad i pod tlačítkem, protože jsdom rozměry nepočítá. Původní znění: 36 px, práh je 44 px.
  Přepínače režimů zobrazení už spravené jsou
- [x] **Osiřelé překladové klíče smazány 6. 8.** Všechny tři v obou jazycích. Ověřeno, že je nikdo
  nepoužívá, včetně dynamicky skládaných klíčů (`brand-theme-preview.tsx` skládá
  `value.color.${role}`, ale `paletteLabel` mezi role nepatří). `i18n-check` v souladu.
  Původně: `contacts.list.columnWidth`
  a `reports.table.columnWidth` v cs i en. Plus `editor.value.color.paletteLabel` po přestavbě
  panelu vlastností
- [x] **Náhledy šablon: přesunuto 7. 8. do oddílu 3, protože to není otevřený nález.**
  Prošetřeno: v rozhraní **není co opravit**. Knihovna šablon je seznam, žádnou miniaturu
  nevykresluje, `thumbnail_asset_id` se v `apps/web` nevyskytuje ani jednou, takže nikde není
  rozbitý obrázek ani prázdné okno. Chybějící funkce, ne vada. Rozvaha je v oddílu 3
- [x] **Sloučeno 6. 8. s položkou výš** („Tmavý režim přebíjí zvolené pozadí natvrdo"), byl to
  týž nález zapsaný dvakrát. Původní znění: dnes bez následku, protože
  volba pozadí nikam nevede. **Až ji `motiv-kampane` zprovozní, začne to vadit**: uživatel si
  zvolí barvu a v tmavém režimu ji stejně neuvidí

- [x] **Uzavřeno 6. 8. jako zapsaný poznatek, ne úkol.** Vzorec „obal polykající ovládací prvky
  uvnitř" je i s pravidly popsaný v `DESIGN-INTEGRACE.md`, kapitola 7, a všechna tři místa, kde
  se dnes projevil, jsou opravená. **Není co dělat, je to znalost k použití**, ne nedodělek.
  Původní znění: za jedno dopoledne třikrát, pokaždé jiný agent
  a jiná část aplikace: tlačítko v řádku tabulky nešlo spustit z klávesnice (šest tabulek), tatáž
  vada zrcadlově opravená jen pro myš, a plátno editoru bralo klávesy z pole pro odkaz jako
  operace nad bloky. **Podrobně i s pravidly v `docs/superpowers/DESIGN-INTEGRACE.md`, kapitola 7.**
  Stojí za to to cíleně hledat jinde
- [x] **Uzavřeno 6. 8. jako zapsaný poznatek, ne úkol.** Ověřování testu vypnutím opravy je
  popsané v `DESIGN-INTEGRACE.md`, kapitola 7, a dnes ho použilo dvanáct agentů. **Je to způsob
  práce, ne položka k odškrtnutí.**
  Původní znění: čtyři agenti
  to dnes udělali a pokaždé to něco odhalilo. `keyboard-parity.test.tsx` byl zelený roky a přitom
  netestoval ani jeden ovládací prvek uvnitř buňky

- [x] **Uzavřeno 6. 8.: vlastnost knihovny, ne vada, a nic z toho neplyne.** Obě dotčené fronty
  s tím předpokladem běží a fungují; zaseknutí navíc nově hlásí hlídač.
  Původní znění: pg-boss neumí cron po sekundách (minimum je minuta). Týká se dnešního `campaign.watchdog` a `campaign.scheduler`, které s tím předpokladem běží. Nález z prověrky plánu automatizací
- [x] **Kódy `precheck_*` doplněny do registru 6. 8.** Devět kódů, závažnosti opsané z kontroly.
  Komentář v katalogu tvrdil, že tam nepatří, protože to nejsou kořenové kódy; **první polovina
  byla omyl, druhá je přesně důvod, proč tam patří** (registr má vlastní druh pro položky nálezů).
  Test **nehlídá počet, ale skutečně vydané kódy**, protože počet by seděl dál, i kdyby přibyl
  desátý a na registr se zapomnělo. Ověřeno vypnutím.
  Původní znění: mají jen texty v katalogu. Zvednout uzavřený počet `FINDING_CODES` patří k práci na předodesílací kontrole
- [x] **Lint je od 6. 8. čistý na celém repozitáři** (`npx eslint .` vrací nulu, ověřeno).
  Rozhodnuto podle povahy souboru, žádné plošné vypnutí: stavební skript image patří mezi nástroje,
  kde jsou výpisy do konzole jediným dokladem o obsahu vrstvy; ukázková stránka v `docs/` dostala
  pravdu o tom, že běží v prohlížeči, místo aby se z lintu vyřadila. Původně 11 chyb ve dvou souborech
- [x] **Krátký strop u prokliku: DOMĚŘENO 7. 8. a podezření PLATILO. Opraveno.** Změřeno
  skutečnou cestou `lookupMessage` proti PostgreSQL 18 v kontejneru **na témže stroji**, tedy
  v nejpříznivější možné variantě: studené volání, které otevírá spojení, vyšlo ve třech bězích
  na **26, 33 a 42 ms**, takže strop 30 ms podstřeloval už na localhostu. Teplá trefa má medián
  2,4 ms, ale **minutí** (neexistující zpráva, kdy se pouštějí oba dotazy, rovnost i okno
  jedné sekundy) mělo p95 kolem 13 ms a maximum 42 ms. Podstatné je, PROČ: do stropu spadá
  nejen dotaz, ale i `SET LOCAL` kontext, dva dotazy při minutí a hlavně **vyzvednutí spojení
  z bazénu**, tedy u prázdného bazénu i navázání nového včetně TLS. Se skutečnou databází na
  síti by 30 ms neuspělo prakticky nikdy. **Hodnota je nově konfigurovatelná
  (`TRACKING_CONTACT_LOOKUP_TIMEOUT_MS`, výchozí 250 ms)** místo čísla napsaného natvrdo ve
  `tracking-runtime.ts`. Vyšší strop nikoho nezdržuje, je to mez, ne čekání. Test hlídá dolní
  mez 100 ms, ne přesné číslo; ověřeno vypnutím (s vrácenou třicítkou spadne)
- [x] **Rotace klíče u podpisu `identify`: ověřena 7. 8. SKUTEČNOU rotací proti databázi.**
  Nový test `tracking/identity/identify-rotation.db.test.ts` vede celou cestu: založí API klíč
  službou, podepíše starým sekretem, **zrotuje službou `rotateApiKey`** a teprve pak se ptá
  domény trasování, co vidí. Doloženo, že během odkladu podepisují oba sekrety, že po vypršení
  odkladu starý podpis sedět přestane a nový sedí dál, a že rotace **nemění prefix** (kdyby
  ho měnila, řádek by se podle něj nenašel a odklad by byl mrtvý slib). Zvlášť zapsané chování,
  které se dřív nikde neříkalo: **minutová cache klíčů drží po rotaci starý pohled**, takže se
  nový sekret projeví až do minuty. Ověřeno vypnutím: bez vracení dožívajícího otisku spadnou
  oba testy
- [x] **Anglická verze nápovědy k podpisu: PROHLÉDNUTA 7. 8. a byla ROZBITÁ. Opraveno.**
  Katalogy `cs` a `en` seděly klíč po klíči (69 ku 69, nic nechybí, nic není nepřeložené),
  a přesně proto to porovnání katalogů nemohlo najít: **vzorec a všechny tři bloky kódu byly
  napsané v komponentě natvrdo česky**, takže v katalogu vůbec nebyly. Anglicky mluvící
  zákazník viděl přeložené nadpisy a pod nimi české komentáře typu „Kanonizace podle RFC 8785"
  a `base64url_bez_vyplne`, tedy právě tu část, kvůli které na obrazovku chodí. Příklady jsou
  nově anglicky ve všech jazycích rozhraní, což odpovídá pravidlu projektu, že kód je anglicky,
  a hlavně to znamená, že **zkopírovaný blok je v obou jazycích znak po znaku týž**; jinak by
  zákazník podle zapnutého jazyka posílal do hlášení chyby jiný text. Do katalogů se bloky
  schválně nepřesouvaly ze stejného důvodu. Nový test komponentu **vykresluje** v obou jazycích
  a dívá se na vykreslený text: žádné české slovo v angličtině, shodné bloky kódu v obou
  jazycích, a navíc pojistka na dělení klíče podle třetího podtržítka (na tom návod jednou
  padl). Ověřeno vypnutím: s vráceným českým vzorcem test spadne
- [x] **Sloučeno 6. 8. s položkou „Sedm front nemá producenta"**, kde je to rozebrané po jedné
  i s verdiktem u každé. Původní znění: sedm front zůstává bez obsluhy vědomě (události od poskytovatele, kvóty, překontrolování domén, přepočty šablon). Zpracování událostí od Amazonu má smysl až s veřejnou adresou
- [x] **Zaseknutý cron se od 6. 8. hlásí, ale jinak, než nález navrhoval.** Zadal jsem nastavit
  mez velikosti fronty; agent doložil, že **by z principu nikdy nezareagovala**: cronové fronty
  mají výhradní politiku, takže v nedokončených stavech leží nejvýš jedna úloha, kdežto mez se
  spustí až od dvou. **Pojistka, která nemůže zareagovat, je horší než žádná**, protože se na ni
  někdo spolehne. Ověřeno v kódu pg-bossu, ne z paměti.
  Místo toho hlídač ve workeru, který hlásí tik ležící déle, než je expirace té fronty.
  **Práh je záměr:** uvnitř expirace je zahození tiku normální, teprve za ní je to porucha
- [x] **Šest cronových front bez obsluhy se od 7. 8. NEPLÁNUJE, a nález byl podstřelený.**
  Výčet front seděl, dopad byl větší: **naměřeno ve vývojové databázi 2 764 uvízlých tiků**
  u `domain.recheck`, tolikéž u `provider_event.rematch`, po 186 u `deliverability.rollup`
  a `provider.refresh_quota`. Řešení má tři části a všechny tři jsou potřeba: cron se plánuje
  jedině frontě, která má obsluhu; existující plán se ruší (`unschedule`), protože samotné
  přeskočení plánování by ten v databázi nezrušilo; a nakupené tiky se smažou.
  **Mazání je úzké schválně** (`state = 'created'`, prázdný náklad, klíč NULL, tedy přesně to,
  co vkládá plánovač), aby se nemohlo dotknout úlohy od producenta.
  **Důvod pro smazání není pořádek, ale to, co by se stalo po dodání obsluhy:** spustilo by se
  najednou všechno nasbírané, tedy u kontroly domén tisíce skenů DNS naráz.
  Podmínka platí oběma směry, takže se fronta naplánuje sama, jakmile obsluha vznikne.
  Ověřeno testy v `apps/worker/test/boss.test.ts`, včetně ověření vypnutím
- [x] **Nález navíc, který přišel z měření téhož: `outbox.reconcile` nasbírala 3 993 selhaných
  úloh se stejnou hláškou za čtyři dny.** Není bez obsluhy, má `needsDependencies` (chybí
  `ReconcileDeps.reconcile`), takže cron tiká každou minutu a každý tik skončí chybou. Totéž
  v malém `ai.cleanup_conversations` (čtyři selhání, tiká denně). **`needsDependencies` je dobrý
  nápad u fronty, kterou plní člověk**, protože chyba je připnutá ke konkrétní akci; u cronové
  fronty je z ní generátor selhání a hlášení, které přijde tisíckrát denně a pokaždé stejné,
  není hlasitější než ticho, jen dražší. Opraveno 7. 8. stejným krokem jako výš: cronová fronta
  s nezapojenou obsluhou se **neplánuje** a chybějící závislosti se řeknou **jednou při startu**.
  Obsluha se přesto registruje, takže ruční zařazení pořád spadne nahlas.
  **Zbývá věcná práce, která není moje:** dodat `ReconcileDeps.reconcile` (P13). Do té doby
  srovnání outboxu s `campaign_stats` neběží vůbec, jen se to nově pozná ze startu, ne z 1 440
  stejných chyb denně
- [x] **Přesunuto 7. 8. do sekce 2.2d jako vylepšení, ne díra**, přesně jak to říkal už původní
  zápis. Přibyla k tomu past, kterou zadání neznalo: cronové fronty bez obsluhy se od 7. 8.
  schválně neplánují, takže je nový hlídač musí vynechat, jinak bude hlásit záměr jako poruchu
- [x] **Rozpor u fronty `contacts.import`: vyřešen 6. 8. srovnáním popisu, chování zůstává.**
  „Jeden běžící import na projekt" **platí**, jen to nedělá fronta, ale doména o pár řádků výš
  (`service.ts:345`, odpověď `import_already_running` s ID blokujícího importu). Klíč projektu
  by byl horší ve třech ohledech, z nichž jeden nikdo nedomyslel: **zaseknutý import by zablokoval
  i vlastní obnovu**, protože ta se zařazuje se slučováním a splynula by s běžícím importem.
  Původní znění nálezu: popis slibuje „jeden běžící import na projekt", ale producent posílá klíč importu, ne projektu. Klíč projektu tam nikdy nikdo neposlal a `batch.ts` před ním varuje. Patří vlastníkovi importu
- [x] **Sedm front bez producenta: vyřešeno 6. 8., každá jinak.** `platform.webhook_deliver`
  **zapojena** (byla to nejzávažnější vada dne), `tracking.erase_contact` a
  `tracking.rebuild_engagement` **zrušeny** jako nadbytečné, `consents.rebuild_state` dostává
  příkaz v CLI, zbylé tři jsou **vědomě odložené funkce** s doloženým důvodem.
  U zrušení engagementu vyplavalo poučení: test vynucoval existenci té fronty s odůvodněním
  „volá ji CLI", **což nikdy neplatilo**, příkaz sahá na dávkovač přímo. Odstraněny i tři pomocné
  věci, které existovaly jen kvůli mrtvé obsluze, mimo jiné **kontrola, kterou CLI dělá samo
  a lépe** (vrací návratový kód místo výjimky). Ověřeno vypnutím u obou zrušení.
  Původní znění: sedm front nemá v repozitáři producenta (`platform.webhook_deliver`, `inbound.process`, `consents.rebuild_state`, `content.process_asset`, `provider_event.process`, `tracking.erase_contact`, `tracking.rebuild_engagement`). Obsluha existuje, do fronty nikdo nezařazuje
- [x] **Zastaralý komentář opraven 6. 8.** Oddíly zakládá `ensureUpcomingPartitions`, kterou volá
  migrační runner na konci každé migrace a příkaz `mlain partitions`. Ta fronta to **nikdy dělat
  nemohla**: zakládání oddílu je DDL a worker běží pod rolí, která schéma nevlastní. Proto
  z registru zmizela. Původně: komentář v `engagement-chain.db.test.ts:47` tvrdí, že oddíly zakládá smazaná fronta `platform.maintain_partitions`. Nic funkčního, ale lže
- [x] **Obnova kampaně po pauze má od 6. 8. návrat.** Stejný vzorec jako odesílání, plus jeden
  rozdíl vynucený tím, co obnova dělá: nuluje i čas a důvod pozastavení, takže kdyby se vracel
  **jen stav**, skončila by kampaň jako pozastavená **bez důvodu** a obrazovka by neměla co
  ukázat. Návrat proto obnovuje i ty dva údaje.
  Test vyrábí selhání tak, jak k němu dojde v provozu (souběžná úloha se stejným klíčem), a je
  ověřený vypnutím: bez opravy zůstane kampaň zaseknutá ve stavu, ze kterého ji hlídač nezvedne
  Původní znění: obnova kampaně po pauze neměla rollback. Odesílání kampaně má kolem zařazení úlohy try/catch, který vrátí stav zpátky a odpoví 503. Obnova po pauze ho nemá, takže neúspěšné zařazení propadne jako 500 a kampaň zůstane v `queueing`, odkud ji hlídač nezvedne. Je to pořád lepší než tiché zaseknutí, ale patří to vlastníkovi domény kampaní, není to vodovod zařazování úloh. Přiznaný nález od `politiky-front`
- [x] **Deset front s rozejitým nastavením: vyřešeno 6. 8.** Zjištěno, která hodnota platí
  (doménová, protože ji producent posílá do řádku úlohy). **Srovnáno deset expirací**, u kterých
  se nenašel důvod; rozdíly v počtu pokusů nechány, ty mění chování při selhání.
  Rozhodující argument: **registr má u každé fronty odkaz do plánu, doména neměla provenienci
  žádnou**, takže to nebyl záměr, ale drift. Nová brána s uzavřeným výčtem povolených rozdílů.
  Původní znění: (`CONTACTS_QUEUES` proti P01). Nejostřejší je `gdpr.erase`: doména dává **0 pokusů**, registr **3**. Dál se rozchází `contacts.bulk_delete`, `contacts.refingerprint`, `gdpr.export_subject`, `inbound.process` a pět dalších jen v expiraci. Nula pokusů u anonymizace **může být záměr** (opakovaný výmaz je nebezpečnější než neúspěšný), takže to musí posoudit vlastník domény, ne se to uklidit mimochodem. Nález od `politiky-front`, který to správně nechal být, aby nezměnil chování článku 17 pod hlavičkou úpravy o slučování
- [x] **Uzavřeno 6. 8.: trvalé omezení vývojového prostředí, ne vada.** Produkt to říká sám
  a zmizí to ve chvíli, kdy poběží na veřejné adrese. Není co opravovat.
  Původní znění: měření z Gmailu nebude fungovat, dokud aplikace běží na localhostu. Produkt to už říká nahlas, ale je to trvalé omezení vývojové instalace

- [x] **Obrazovka seznamu `/w/{slug}/jobs` nad `JobsCenter`. Hotovo 7. 8.**
  `apps/web/src/app/[locale]/w/[workspaceSlug]/jobs/page.tsx` a
  `apps/web/src/features/jobs/jobs-list.tsx`. Ověřeno v prohlížeči proti běžící
  aplikaci: seznam ukázal skutečná data z `mlain_clean` (běžící import
  `design-import.csv`, sedm dokončených úloh), každý řádek má odkaz na detail
  i na doménovou obrazovku. Plus 7 jednotkových testů
  (`features/jobs/jobs-list.test.tsx`), ověřené dočasným vrácením opravy
- [x] **Obrazovka detailu `/w/{slug}/jobs/{kind}/{jobId}`. Hotovo 7. 8.** (dřívější nález N30 z P06)
  `app/[locale]/w/[workspaceSlug]/jobs/[kind]/[jobId]/page.tsx` a
  `features/jobs/job-detail.tsx`. Ověřeno v prohlížeči na obou druzích úloh
  (import i stavba publika) a na neexistujícím ID, které vrátí 404 s běžnou
  stránkou „nenašli jsme". Odkaz „Otevřít" ze seznamu už není slepý
- [x] **Odznak `JobsBadge` v topbaru nad `running_count`. Hotovo 7. 8.**
  `features/jobs/jobs-badge-live.tsx`, zapojený ve `features/shell/workspace-shell.tsx`
  místo dřívějšího `jobsBadge={null}`. Ověřeno v prohlížeči: v hlavičce svítí
  „Běží 1 úloha" i na jiných obrazovkách (Kontakty) a kliknutí vede do Centra
  úloh. Plus 6 jednotkových testů (`features/jobs/jobs-badge-live.test.tsx`)
- [x] **Rozhodnuto 7. 8.: obnovovat, ale JEN dokud něco běží.** Zdůvodnění celé
  v `apps/web/src/features/jobs/refresh.ts`. Zkráceně: seznam i odznak se
  dotazují pouze `/api/v1/jobs` přímo z prohlížeče (jedno volání, ne šest, které
  stojí vykreslení stránky), seznam po 10 s, odznak po 30 s, a **jakmile neběží
  nic, žádný časovač netiká**. Skrytá záložka se neptá (`document.hidden`).
  Důvody: úlohy trvají minuty, takže kratší interval jen vyrábí požadavky;
  `runningJobCount` na serveru slévá až 200 úloh ze všech zdrojů, takže ani
  dotaz na počet není zadarmo; ale stojící ukazatel u běžící úlohy vypadá jako
  zaseknutá úloha, což je přesně ten omyl, kvůli kterému Centrum úloh vzniklo.
  Obojí je pokryté testem, který spadne, když se podmínka odstraní

- [x] **`asset_references` po smazané šabloně zůstávají. Opraveno 7. 8.** Poslední živé místo byl
  **tvrdý úklid ukázkových dat** (`demo/purge.ts`): mazal šablony i kampaně příkazem `DELETE`
  mimo mazací služby a odkazy po nich nechával. Druhé místo z nálezu, `deleteWorkingCopy`
  u kampaní, **už opravené bylo** (`campaigns/api/service.ts:397`, test
  `campaign-asset-refs.db.test.ts`); zbývala jen tahle třetí cesta.
  Vznikla sdílená `clearAssetReferences` (`templates/asset-references.ts`), která ruší odkazy
  několika vlastníků najednou a o stejnou deltu sníží `assets.reference_count`. **Verze šablon
  se dohledávají PŘED mazáním**, protože `template_versions` visí na `templates` kaskádou
  a po smazání už nejde zjistit, které existovaly.
  **Komentář nad `assetUsage` opraven**: tvrdil, že se reference na smazanou šablonu „maže
  kaskádou", což nebyla pravda a stálo přesně za tímhle odpadem. `ref_id` je polymorfní, cizí
  klíč na něm být nemůže. **Cestou druhý nález, taky opravený:** `assetUsage` uměla dohledat
  jméno jen u šablony a kampaně, takže u reference typu `template_version` (ta vzniká úplně
  běžně, smazání šablony odkazy verzí schválně nechává) stálo v rozhraní „použito v:" a za tím
  nic. Doplněn join na `template_versions` i `brand_profiles`.
  **Migrace `0028_asset_reference_orphans.sql`** uklidí, co vzniklo dřív: maže osiřelé odkazy
  a sníží čítač přesně o smazané řádky, ne slepým přepočtem (rozpory bez souvislosti s odpadem
  má hlásit noční `content.verify_asset_refcounts`, která schválně nic neopravuje). Granty se
  nemění, `mlain_apply_grants()` se proto neopisuje, ze stejného důvodu jako v 0027.
  **Ověřeno:** `migration-lint` prošel (29 migrací), migrace spuštěna proti `mlain_clean`
  a dotazem doloženo, že jediný osiřelý řádek (`dnd-ruzova.png` pod smazanou šablonou
  „Nová šablona 2") zmizel a `reference_count` klesl z 1 na 0, tedy obrázek už jde uklidit.
  Nový test `demo/purge-asset-refs.db.test.ts` (2 zelené) a po dočasném vrácení opravy **oba
  spadly**, takže měří opravu, ne přítomnost kódu. Zelené i `asset-references.db.test.ts`,
  `campaign-asset-refs.db.test.ts`, `templates/index.test.ts` a `assets/service.db.test.ts`
- [x] **Endpoint `GET /api/v1/transactional/{id}` doplněn 7. 8.** Dohledání v
  `packages/core/src/transactional/status.ts`, trasa v `transactional.routes.ts`, scope
  `transactional:send` (týž, jaký uvádí průzkum: klíč, který zprávu poslal, se musí umět
  zeptat, jak dopadla, a nové oprávnění by 403kovalo už vydané klíče). Vrací `status`,
  `sent_at`, `attempts`, `error_code` a `provider_message_id`.
  **Čte JEN `kind = 'transactional'`**, takže se z klíče aplikace zákazníka nedá číst stav
  rozesílky ani testovacích zpráv; cizí `id` vypadá jako neexistující. **`error_detail` ven
  nejde schválně:** `FormatErrorDetail` v senderovi do něj skládá jméno odesílací instance.
  Interní `claimed` se hlásí jako `queued`, tedy týmž slovem, jaké vrátilo odeslání.
  **V průzkumném dokumentu opravena nepravda**, kvůli které se rozhodovalo špatně: tvrdil, že
  webhooky `message.delivered`, `message.bounced` a `message.complained` „už existují".
  Neexistují, vydávají se jen `message.opened` a `message.clicked`
  (`tracking/jobs/process-engagement.ts:289` a `:302`). Opraveno na třech místech dokumentu.
  **Ověřeno:** `apps/web/test/api/transactional.test.ts` 12 zelených (5 nových nad HTTP:
  queued, sent s časem a identifikátorem providera, failed s kódem a bez `error_detail`,
  zpráva jiného druhu 404, neznámé id 404 a klíč bez scope 403). Po dočasném odpojení trasy
  **4 z nich spadly**. Přegenerován `packages/contracts/openapi.json`
  i `openapi.generated.json` (189 cest, 253 operací), `openapi.test.ts` zelený
- [x] **Přepisy jmen mají obrazovku. Doplněna 7. 8.** Nález sám měl chybu: mluvil o
  `PUT /api/v1/name-overrides`, **takové sloveso na téhle cestě neexistuje**. Skutečné trasy
  jsou `GET`, `POST` (upsert podle dvojice druh a klíč jména) a `DELETE /name-overrides/{id}`.
  Opraveno i v `specs/2026-08-05-osloveni-vypinac.md:191`; správně to odjakživa mělo
  `specs/parts/02-kontakty.md:3416`.
  **Rozhodnuto obrazovku dopsat, ne položku uzavřít.** Argument pro uzavření (slovník se plní
  z fronty kontroly oslovení, která obrazovku má) neobstojí právě proto, že fronta je JEDINÁ
  cesta dovnitř: jakmile přepis vznikne, jméno z fronty zmizí, takže se k němu už nikdo
  nedostane. Překlep v pátém pádu se pak tiše propisuje do oslovení každého dalšího kontaktu
  téhož jména a odchází v e-mailu ven. Je to táž vada jako u vlastních polí kontaktu, jen
  tišší, a u té zadavatel obrazovku výslovně chtěl.
  Obrazovka je `settings/name-overrides/page.tsx` ve stejném tvaru jako `settings/fields`
  (`SettingsPageShell`, `contacts:write`, `ForbiddenSection`), komponenty
  `features/contacts/name-overrides-table.tsx` a `name-override-dialog.tsx`, akce
  `upsertNameOverrideAction` a `deleteNameOverrideAction`. Položka navigace
  `settings-name-overrides` s `mvp0: true`. Texty v `packages/i18n/messages/{cs,en}/`.
  **Ověřeno:** nový `name-overrides-table.test.tsx` 6 zelených, po dočasném odstranění
  varování o `coalesce` test spadl. Zelené i `action-endpoints.test.ts` (hlídá, že cesty akcí
  v kontraktu existují), `fields-table.test.tsx`, `registry-screens.test.ts` (24) a
  `settings/load-problem.test.tsx` (8). `node tools/ci/i18n-check.mjs`: 4754 klíčů, katalogy
  v souladu. Typecheck `core`, `db`, `ui`, `web` čistý, eslint i prettier nad změněnými soubory

- [x] **`smoke.test.ts` srovnán 7. 8., byla to moje nedodělaná práce.** Přibyla cesta
  `POST /api/v1/invitations/signup`, ale výčet cest části 1 ani počet operací se
  neaktualizovaly. Ráno jsem srovnal jen sourozenecký `openapi.test.ts` a na tenhle
  zapomněl. Doplněna cesta i počet (46 → 47) a **k číslu i důvod**, proč se posunulo:
  bez toho ho za měsíc nikdo nedokáže zdůvodnit a jen ho přepíše. Ověřeno spuštěním
  obou souborů, 13 zelených


- [x] **Souhlas s měřením per kontakt zaveden 7. 8., agent `souhlas-mereni`.** Nález ze 6. 8.
  tvrdil „ani sloupec, ani zapínač". **Sloupec ani migrace nakonec nevznikly a je to správně:**
  účel `analytics` je v evidenci souhlasů od migrace 0001 (`ck_consents__purpose`), bere ho
  `POST /contacts/{id}/consents`, vrací ho `GET /contacts/{id}`, umí ho podmínka segmentu
  i obrazovka historie souhlasů. Chyběl jen zapínač a hlavně to, aby se měření kohokoli ptalo.
  **Výchozí hodnota: chybějící záznam měření NEZASTAVÍ**, veto je jen zapsané `withdrawn`.
  Důvod: souhlas návštěvníka se vybírá už dnes v prohlížeči (`ConsentGate` v `packages/sdk-web`,
  bez `Mlain.consent({analytics:true})` se neuloží ani `anonymous_id`) a nad tím stojí projektový
  `tracking.web_tracking_enabled`. Kdyby chybějící záznam znamenal zákaz, přestalo by měření po
  nasazení naráz všem kontaktům v každé instalaci: `contact_consent_state` nemá pro `analytics`
  dnes ani jeden řádek. Odvození od souhlasu se zasíláním zamítnuto, odhlášení z pošty není
  odmítnutí měření. Rozhraní proto ukazuje TŘI stavy, `not_recorded` se nevydává za souhlas.
  **Pět míst, kde se událost vázala na kontakt, teď respektuje souhlas:** vyřešení identity
  a kontakt přímo v payloadu (`tracking/ingest/event-process.ts`), vazba anonymního ID
  (`identity/bind.ts`, nový výsledek `measurement_withdrawn`), slučování historie
  (`identity/merge.ts`, nový stav `skipped_measurement_withdrawn`) a časová osa otevření
  a prokliků (`jobs/process-engagement.ts`). Pravidlo je JEDNO: `allowsMeasurement`
  v `contacts/repo/consents.ts`. `message_events` a statistika kampaně zůstávají nedotčené
  schválně: je to souhrn o zásilce, ne profil člověka, jinak by jedno odvolání měnilo čísla
  odeslané kampaně. Rozhraní: karta „Měření chování" v detailu kontaktu MIMO větev
  `showsPersonalData` (je to záznam rozhodnutí, ne údaj o člověku), akce skryté při `readOnly`.
  **Ověřeno:** 5 nových testů `contact-detail.test.tsx` (43 zelených), DB testy
  `event-process.db` (16), `bind.db` (13), `merge.db` (15), `engagement-chain.db` (7),
  pravidlo v `consent-precedence.test.ts` (12). Oprava dvakrát dočasně vrácena a testy spadly
  (2 v `event-process.db`, 1 v `engagement-chain.db`). Playwright proti běžící aplikaci: karta
  se vykreslí, vypnutí zapíše `analytics|withdrawn` do `consents` i `contact_consent_state`
  a karta se sama překreslí; zkušební data z dev databáze uklizena. Typecheck `core` i `web`,
  eslint nad změněnými soubory, `i18n-check` v souladu

- [x] Rozšířit `SYSTEM_MAIL_CAPABLE_TYPES` na `['smtp', 'ses']` a doplnit větev odeslání — 7. 8. 2026. Nový `packages/core/src/platform/system-mail-ses.ts` (`SendEmailCommand` s `Content.Raw`, jediný pokus, `ConfigurationSetName` jen když je vyplněný), větev podle `config.kind` v `DefaultSystemMailer.send`. **Ověřeno vizuálně na dev instalaci** (`/w/petr-osobni-mail/settings/system-mail`, projekt má JEN účet typu SES): obrazovka hlásí „Systémová pošta funguje, odesílá se účtem MlainMailer typu ses" z adresy `mlain@brevio.cz`, dřív hlásila, že nefunguje. Plus jednotkové testy `system-mail-ses.test.ts` (6) a přepsaný doktorský test
- [x] Výběr účtu, když příjemce nepatří do projektu — 7. 8. 2026. `system_settings.settings.systemMail.workspace_id` se čte přes `withoutContext` a **plní se sám** při každém úspěšném výběru účtu (`system-mail-installation.ts`). **Krok 4 plánu, „najít nejstarší projekt instalace s použitelným účtem přes `withoutContext`", NEJDE**, viz nález v oddílu 4. Ověřeno databázovým testem v `system-mail-delivery.db.test.ts`: uživatel bez jediného členství dostal obnovu hesla do poštovní pasti, a po dočasném odebrání pádu zpět test spadl s `system_mail_unavailable`
- [x] Podmínka: systémová pošta nesmí nést odhlašovací odkaz ani `List-Unsubscribe` — 7. 8. 2026. Nový `system-mail-headers.test.ts`: všech pět zpráv v `cs` i `en`, měří se složené MIME a vyrenderovaný text (žádné `List-Unsubscribe`, `List-Id`, `Precedence: bulk`, žádné cesty `/u/`, `/p/`, `/s/c/`, `/o/`, `/c/`) plus to, že `Auto-Submitted` a `X-Auto-Response-Suppress` zůstávají. U SES se navíc nenastavuje `ListManagementOptions`. Ověřeno tím, že po dočasném přidání hlavičky test spadl
- [x] Ověřit riziko RZ3 — 7. 8. 2026. **Dnes nemá jak nastat: příjem událostí od SNS není zapojený vůbec.** `setSnsWebhookDeps` nikdo nevolá (endpoint vrací 503 a nic nezpracuje) a fronta `provider_event.process` je vedená mezi frontami bez obsluhy. Zmírnění je hotové na straně odesílání: systémová pošta neposílá message tagy `ml_msg` ani `ml_mday` (test v `system-mail-ses.test.ts`), takže až se příjem dodělá, přijde odraz systémové zprávy jako neznámá zpráva. Požadavek „zahodit, ne spadnout" je zapsaný v hlavičce `providers/api/sns-webhook.ts`, aby ho ten, kdo příjem dodělá, našel. Endpoint sám už dnes chyby zpracování nevrací jako 500, hlídá to test `chyba zpracování NEVRACÍ 500`

- [x] Auditní akce a zápis počtů na konci běhu. Hotovo 7. 8. (`partition.maintained`, ověřeno db testem proti PostgreSQL i vypnutím opravy)
- [x] **Nález v `mlain doctor`**, který zežloutne, když je poslední záznam starší než dva dny. Hotovo 7. 8., nálezy jsou dva (`no_partition_maintenance_yet` a `partition_maintenance_stale`), ověřeno db testem

- [x] Perioda z výrazu cronu a hlášení fronty, jejíž poslední úloha je starší než trojnásobek periody. Hotovo 7. 8., ověřeno testy i vypnutím opravy
- [x] Obě pasti pokryté: výčet hlídaných front se bere z `pgboss.schedule`, ne z registru, a ticho bez úloh se počítá od naplánování fronty

## Přesunuto 7. 8. 2026 (rozhodnutí zadavatele a dokončené položky)

- [x] **ROZHODNUTO 7. 8.: dvojjazyčné popisky vlastních polí NEŘEŠÍME.** Přejmenování mění
  jen jazyk rozhraní a zbytek mapy nechává být (`features/contacts/field-labels.ts`), takže se
  nic neztratí, jen pole založené z českého rozhraní má českou hlášku i v anglickém.
  **Dnešní stav je tím správný a nic se nemění**
- [x] **ROZHODNUTO 7. 8.: vrácení z archivu NECHCEME, ani v rozhraní, ani v API.**
  Archivované pole tedy z obrazovky zmizí natrvalo. Důsledek, který z toho plyne a je dobrý:
  věta „Tuhle akci nejde vzít zpět", kterou 7. 8. přidal agent `pole-akce` do okna archivace,
  **zůstává pravdivá napořád** a nesmí se sundávat. Archivace dál dává smysl jako bezpečnější
  volba než mazání, protože **hodnoty u kontaktů zůstanou** a segmenty postavené na tom poli
  fungují dál; nevratné je jen schování pole z nabídek

- [x] **ROZHODNUTO 7. 8.: rozvržení meta údajů nad tabulkou vlastních polí NEŘEŠÍME**, není
  to problém. Tři samostatné odstavce a tlačítko přes celou šířku karty zůstávají

- [x] **Katalog problémů srovnán 7. 8., byla to nedodělaná práce po zastavených agentech.**
  Počty se rozešly o pět kódů z tří různých okruhů: `signup_closed` a `workspace_create_not_allowed`
  (účet z pozvánky a omezení zakládání projektů), `workspace_postal_address_missing` (chybějící
  poštovní adresa jako varování, ne závora) a dva kódy doktoru k údržbě oddílů. U každého posunu
  je v testu **napsaný důvod**, ne jen nové číslo: bez toho ho příště někdo přepíše na aktuální
  hodnotu a brána přestane hlídat. Ověřeno spuštěním, 22 zelených

- [x] **Zastaralý komentář v `subscription-emails.ts` opraven 7. 8.** Tvrdil, že e-maily seznamu
  nemůžou jít systémovou poštou, protože ta umí jedině SMTP a klient pro SES neexistuje.
  **Od 7. 8. to neplatí**, systémová pošta SES umí. Závěr ale platí dál, jen z jiného
  a trvalejšího důvodu, který je teď v komentáři napsaný: systémová pošta je provozní zpráva
  instalace a schválně nenese odhlašovací odkaz, kdežto e-maily seznamu jsou zprávy odběrateli,
  patří do outboxu, počítají se do statistik a mají vlastní závory. Poslat je systémovou poštou
  by je vyňalo z evidence i z těch závor

- [x] **Chyba v kroku R2/4 plánu systémové pošty OPRAVENA V TEXTU PLÁNU 7. 8.**, přímo
  v sekci R2, ne jen v hlavičce dokumentu. Kdo si přečte R2, dozví se tam, že
  `withoutContext` neznamená „bez row level security", a proč by původní postup vrátil
  nula řádků a vypadal jako správná odpověď „instalace nemá projekt". Zápis v `HOTOVO.md`.
  **Zbývá ROZHODNUTÍ zadavatele, ne oprava:** na instalaci, ze které neodešla ANI JEDNA
  systémová zpráva s projektem, je klíč `systemMail.workspace_id` prázdný, takže uživatel
  bez projektu obnovu hesla nedostane. Vyplnit ho může průvodce instalací
  (`identity/setup.ts` zakládá první projekt, takže tam je hodnota známá rovnou), nebo
  obrazovka z bodu 10 plánu. Průvodce je levnější a zavře to i pro instalace, které si
  obrazovku nikdy neotevřou
- [x] **Údržba oddílů se v dodávané instalaci VŮBEC NESPOUŠTĚLA, opraveno 7. 8.** Práci
  dělá vrácená cronová fronta `platform.maintain_partitions` ve workeru (obsluha si otvírá
  vlastní spojení pod migrátorem, takže `mlain_app` právo na DDL nedostává). Kontejner
  s cronem v compose se ZAMÍTL: byl by čtvrtý způsob, jak se v produktu spouští pravidelná
  práce, a na PaaS by nepomohl. Zápis i s vedlejším nálezem o `compose.scale.yml`
  je v `HOTOVO.md`
- [x] **Ověřování záloh doplněno do `mlain doctor` 7. 8.**, včetně třetího nálezu
  `backup_verify_failed`, na který se přišlo cestou: úloha zapisuje auditní záznam i u
  NEÚSPĚŠNÉHO ověření, takže instalace, které ověření pravidelně padá, má záznam čerstvý
  a podle stáří by vypadala v pořádku. Zápis v `HOTOVO.md`.
  **Pozor, premisa zadání byla vedle a stojí za zapamatování: tabulka `backups`
  NEEXISTUJE.** Zálohy jsou adresáře na disku a čtou se `readdir`em
  (`ops/backup.ts:189`); jediná trvalá stopa po běhu je audit, proto se nález opírá o něj

- [x] **Retence pro `imports` a `campaign_audience_progress`: ROZHODNUTO NEDĚLAT
  (7. 8.), a je to rozhodnutí podložené schématem, ne odklad.**
  `campaign_audience_progress` má `campaign_id` jako PRIMÁRNÍ KLÍČ, tedy jeden řádek na
  kampaň, s kaskádou na kampaň i projekt; retence by tam byla aktivně škodlivá, protože
  by smazala průběh existující kampaně i `cursor_contact_id`, od kterého se pokračuje.
  `imports` je jednotky až stovky řádků za rok na projekt a osobní data z něj už dneska
  mizí (soubor po 30 dnech, chybové řádky po 90); zbývá záznam o tom, co uživatel udělal,
  tedy věc povahy auditu. Kdyby to zadavatel přesto chtěl, patří to do `RETENTION_DEFAULTS`
  jako nový cíl per projekt, **ne do údržby oddílů**: `imports` partitionovaná není
  a partitionovat tabulku s desítkami řádků měsíčně by bylo drahé zbytečně. Rozbor
  v `HOTOVO.md`

- [x] **VYŘEŠENO TÝŽ DEN, ale nález stojí za zapsání: odkaz „Vybrat všech N" byl slepý
  na VŠECH obrazovkách.** Přepínal režim UVNITŘ `DataTable` (`use-row-selection.ts`), ale
  řízené pole `selectedIds` se jím neměnilo a režim ven netekl, takže pruh napsal
  „Vybráno všech 9", kdežto hromadná akce dál pracovala s tím, co bylo opravdu zaškrtnuté.
  Přesně to zadavatel hlásil u kampaní: „Jediné, co tam je, je vybrat všech 12, ale to
  mi je k prdu." Od 7. 8. odpoledne se odkaz kreslí JEN tehdy, když existuje další stránka
  A ZÁROVEŇ obrazovka umí režim převzít (`selection.onModeChange` v `data-table.tsx`);
  nad tabulkou, která se celá vejde na jednu stránku (kampaně, seznamy, formuláře, vlastní
  pole, přepisy jmen), se proto nenabízí vůbec. Hlídá to test v `campaigns-screen.test.tsx`.

- [x] **Obnova zaseknutých importů ZAPOJENA 7. 8., byla napsaná a nikdo ji nevolal.**
  `recoverStaleImportsJob` měl obsluhu, vlastní test i migraci 0024 s grantem a politikou
  pro sken napříč projekty. Chyběl JEDINÝ řádek: fronta nebyla v registru, takže ji nikdo
  nikdy nespustil. **Následek nebyl kosmetický:** `confirmImport` (`import/service.ts:341`)
  odmítne KAŽDÝ další import v projektu, dokud v něm leží řádek ve stavu `importing`
  (`import_already_running`). Zabitý worker uprostřed importu tedy projektu zamkl
  importování natrvalo a ven vedl jedině ruční zásah do databáze. Přesně to se 7. 8. stalo
  ve vývojové instalaci a zadavatel na to narazil.
  Zapojeno jako `contacts.recover_stale_imports`, cron po deseti minutách (ne v noci:
  zamčené importování je vidět hned), jeden pokus, `exclusive`. Obsluha záměrně BEZ `perJob`,
  protože cron posílá tik s prázdným nákladem a sken si projekty hledá sám pod rolí
  `mlain_maintenance`; obal by ho volal tolikrát, kolik tiků se nakupilo.
  Ověřeno: 67 testů registru front, 62 testů pokrytí obsluh ve workeru, typecheck jádra
  čistý. Počet front v uzavřeném registru srovnán 59 → 60 i s důvodem v testu

- [x] **HOTOVO 7. 8. (agent `odesilani-nefunguje`): projekt z průvodce prvním spuštěním
  má výchozí seznam „Odběratelé".** Vkládání je v jedné funkci
  (`contacts/lists/default-list.ts`), kterou volá `createWorkspace` i `runSetup`, aby se
  ty dvě cesty nemohly znovu rozejít. Doloženo na čisté instalaci: `GET /lists` vrátil
  „Odběratelé" s `opt_in = double`, `confirmation_mode = one_step`, `is_default = true`.
  Rozbor v `HOTOVO.md`

- [x] **HOTOVO 7. 8. (agent `odesilani-nefunguje`): odesílač SMTP účet přečte a e-mail
  z instalace ODEJDE.** Sender čte `sending_enabled` do `*bool` a prázdnou hodnotu bere
  jako ZAPNUTO, tedy stejně jako `?? true` v TypeScriptu; migrace na `NOT NULL DEFAULT true`
  se schválně NEDĚLALA, protože sloupec je tříhodnotový záměrně (rozbor v `HOTOVO.md`).
  Zavádějící hláška je pryč: chyba ČTENÍ řádku má nový kód `provider_config_unreadable`
  a `credentials_undecryptable` od teď znamená opravdu jen klíče.
  Doloženo na čisté instalaci z compose, ne testem: `messages.status = sent`
  a potvrzovací e-mail v poštovní pasti, při `sending_enabled IS NULL`

- [x] **HOTOVO 7. 8. (agent `odesilani-nefunguje`): potvrzovací e-mail dvojího potvrzení
  i zkušební e-mail odejdou i v čerstvém projektu.** Obě položky měly společnou příčinu
  a mají společné řešení: odesílatele hledá jedna funkce
  (`sender-identities/resolve.ts`) místo čtyř rozešlých kopií a umí i třetí krok, tedy
  připojený odesílací účet s OVĚŘENOU ADRESOU zkušebního režimu. Hláška u zkušebního
  odeslání už neradí „nejdřív založte kampaň". Doloženo na čisté instalaci
  (potvrzovací e-mail v pasti) a novými testy; rozbor v `HOTOVO.md`

