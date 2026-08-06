# Stav úkolů

Živý dokument. Vede ho hlavní agent, prochází ho po každém dokončeném úkolu
a po každém novém zadání. **Nic se nesmí ztratit tím, že to zapadne v konverzaci.**

Poslední aktualizace: 2026-08-05, 14:45

Pravidla vedení:

- Hotové se **neškrtá pryč**, přesune se do „Hotové" s datem. Historie je součástí ceny.
- Co přibude v konverzaci, se sem zapíše **hned**, ne až se to začne dělat.
- U každé položky musí být vidět, **kdo ji drží** a **co brání dokončení**.
- Úkol bez vlastníka patří do „Čeká na zadání", ne do „Probíhá".

---

## 1. Probíhá (běžící subagenti)

### 1.1 `emaily-seznamu` — implementace plánu (9 až 10 dní, po etapách)
Plán: `docs/superpowers/plans/2026-08-05-emaily-seznamu.md`, rozhodnutí zadavatele v kapitole 7.

- [x] **Etapa 1 hotová a ověřená v běžící instalaci** (ověřil jsem důkaz sám dotazem do `mlain_clean`): ruční přidání kontaktu na seznam s dvojím potvrzením zařadí zprávu do outboxu s `confirm_url`. Cestou nález, který změnil řešení: **registrace portu z `instrumentation.ts` obsluha trasy nevidí**, běží v jiném modulovém grafu, takže první pokus vytvořil přihlášení i token, ale žádnou zprávu. Odesílatel se teď sestaví líně při prvním použití
- [x] **Etapa 2 hotová:** nastavení tří e-mailů na seznamu (potvrzovací, uvítací, rozloučení), obecné znění jako konstanta, vlastní znění zakládá předvyplněnou šablonu, závora na chybějící potvrzovací odkaz na dvou místech, migrace 0017 s chybějícími cizími klíči. Seznam do teď nešel ani přejmenovat. Zbývá třetí vrstva závory při ukládání šablony (`templates/service.ts`), zelenou jsem dal
- [x] **Etapa 3 hotová:** obrazovka „nový seznam", výchozí seznam „Odběratelé" ve všech projektech (migrace 0018 a 0019; agent správně **nepovýšil existující seznam**, protože `is_default` řídí, komu se co posílá), `redirect_url` a `success_message` v editoru formuláře, přesměrování po potvrzení i po odhlášení. Cestou zapojeno přepnutí výchozího seznamu (endpoint existoval bez volajícího) a opraveno, že **editor vůbec nezobrazoval hlášky ze serveru**, takže každá blokující chyba vypadala jako obecná záhada
- [ ] **Protimluv, ze kterého nevede cesta ven:** `templates/precheck.ts:54` vyžaduje odhlašovací odkaz **bezpodmínečně**, kdežto nová závora ho u e-mailů seznamu zakazuje. Uživatel nemůže vyhovět obojímu. Ověřeno na snímku obrazovky z editoru

### 1.5 `osloveni-vypinac` — oslovení a pátý pád musí jít celé vypnout
Zadání zadavatele 5. 8.: v angličtině se pátý pád neřeší, musí jít vypnout jedním
přepínačem a pak se nesmí objevit nikde. Mapa: `docs/superpowers/specs/2026-08-05-osloveni-vypinac.md`.
Dotčeno 102 souborů mimo testy.

- [ ] Etapa 2, implementace. Přepínač `workspaces.greeting_enabled` (migrace 0020, nasazená)
- [ ] **Nejnebezpečnější místo:** šablona s oslovením by se po vypnutí **nedala odeslat vůbec**, protože neznámé pole je chyba, ne varování. Řeší se příznakem vyřazeného pole v katalogu, který už existuje
- [ ] Na obrazovku kontroly pátého pádu vede **pět cest**, ne jedna, všechny musí zmizet
- [ ] Tykání a vykání vypíná týž přepínač (má v repozitáři jediného konzumenta, samostatný přepínač by byl bez následku)

### 1.3 `stitky` — obrazovka štítků přepsaná od základu, běží pokračování
Tabulka zmizela celá. Agent došel k tomu, že **tabulka byla vada tvaru, ne kódu**: štítek má
dva údaje a `DataTable` k nim přidávala výběr, trvale zašedlé stránkování a nastavení sloupců,
tedy tři ovládací prvky, které by nezmizely tím, že jim dopíšu obsluhu. Teď je to seznam karet
ve tvaru převzatém ze segmentů (segment a štítek jsou dvojčata), akce v nabídce pod třemi tečkami,
a akce, které nedávají smysl, se vůbec nenabízejí. Výběr zrušen celý i s popisky, které lhaly.

Zapojeno založení, přejmenování, sloučení, export kontaktů podle štítku, mazání s dialogem,
který říká následek číslem. Cestou opraveny dvě vady v exportu (stahování odkazem nefungovalo,
**server posílal gzip pojmenovaný `.csv`**) a chyba v konzoli u zavřených dialogů.

- [ ] `exportContactsAction` (hromadný export ze seznamu kontaktů) skončí na 422 vždycky, posílá filtry seznamu místo publika a neposílá sloupce
- [ ] Filtrovaný seznam kontaktů nikde neřekne, že je filtrovaný, ani jak filtr zrušit
- [ ] **Mrtvé tlačítko „Přepočítat" na kartě segmentu** (`segment-list.tsx:109`, `<Button>` bez `onClick`). Objeví se právě když je počet zastaralý, tedy když ho člověk potřebuje. Ověřeno
- [ ] Hledání ve štítcích: zadavatel zatím nechce, seznam bere prvních 200 a o dalších jen řekne větou. Půl dne, až bude potřeba

---

## 2. Čeká na zadání (rozhodnuté, nezačaté)

### 2.2 SYSTÉMOVÁ POŠTA PŘES SES — plán hotový, čeká na pokyn
Plán: `docs/superpowers/plans/2026-08-05-systemova-posta-ses.md`.
**Odhad se scvrkl na jeden den plus den doladění**, protože klient SES už v `packages/core`
je (`@aws-sdk/client-sesv2`, `providers/ses/client.ts`), jen se nepoužívá na odesílání.
Ověřeno. Bez migrace, bez zásahu do Go senderu, bez nové závislosti.

- [ ] Rozšířit `SYSTEM_MAIL_CAPABLE_TYPES` na `['smtp', 'ses']` a doplnit větev odeslání
- [ ] Výběr účtu, když příjemce nepatří do projektu: projekt systémové pošty instalace v `system_settings`, jinak nejstarší projekt s použitelným účtem
- [ ] Podmínka: systémová pošta nesmí nést odhlašovací odkaz ani `List-Unsubscribe`
- [ ] Ověřit riziko RZ3: události od SNS se nespárují s žádnou zprávou, protože žádná nevznikne. Příjem to musí zahodit a nespadnout

### 2.2b Hlídání, že úklid oddílů opravdu běží (půl dne)
Dnes si `mlain partitions` nikam nezapisuje, že proběhl, takže provozovatel nepozná,
že týden neběžel a data leží přes lhůtu. Migrace není potřeba: `audit_log.workspace_id`
je nullable a `actor_type = 'system'` je povolený.

- [ ] Auditní akce a zápis počtů na konci běhu
- [ ] **Nález v `mlain doctor`**, který zežloutne, když je poslední záznam starší než dva dny. Bez tohohle třetího kroku je to jen řádek v tabulce, do které se nikdo nedívá

### 2.3 Automatizace (P17) — plán hotový, čtyři blokující otázky zodpovězené
Plán: `docs/superpowers/plans/2026-08-05-p17-automatizace.md`. Odhad 22 až 28 dní
plus 2 dny na rozepsání do úkolů. **Zadavatel zatím nedal pokyn začít.**

- [ ] Rozepsat plán do úkolů (bez toho fáze A nezačne)
- [ ] O2 z plánu: pozastavení skryté kampaně ve stavu `draft`. Samostatná oprava **před vydáním**, zavírá tutéž díru i u e-mailů z formulářů

---

## 3. Čeká na rozhodnutí zadavatele

- [ ] **Kde rozjet testovací provoz na internetu.** Rešerše hotová: `docs/operations/2026-08-05-hosting-pro-testovani.md`. Zdarma Oracle Always Free (ARM, 12 GB) s rizikem, že si Oracle stroj vezme zpátky, nebo Hetzner za ~150 Kč měsíčně. **Hostované databáze zdarma nepoužívat**, Neon obchází RLS u rolí založených přes konzoli. Obraz si musíme sestavit sami, CI ho nepublikuje
- [ ] Kdy začít automatizace (22 až 28 dní)
- [ ] Úklid zkušebních dat v `mlain_clean` (nově i segmenty „ZK Neotevrel poslednich 5", „ZK Nikdy neklikl", „ZK Neaktivni 90"): kampaně „Odesilatel test A", „Kroky kampane test", „Slouceny krok 1", šablona „Slouceny krok 1 sablona", předvolba odesílatele „Fakturace", segment „Klikli v kampani Slouceny krok 1", kontakt `identify-dukaz@example.cz`
- [ ] **Uvítací e-mail neumí nést odhlašovací odkaz.** Sender u druhu `transactional` přepisuje `unsubscribe_url` prázdným řetězcem (`worker.go:173`), takže vlastní uvítací šablona s patičkou by odkazovala do prázdna. Rozloučení a potvrzení odkaz mít nemají (příjemce se právě odhlásil, respektive ještě odběratelem není), ale do uvítacího e-mailu lidé dávají slevu, a to už je obchodní sdělení. Zatím řešeno **branou blokující uložení** takové šablony. Trvalé řešení znamená vlastní druh zprávy pro e-maily seznamu, tedy migraci `messages.kind` a zásah do Go senderu
- [ ] Strojově čitelné datum žádosti u omezení zpracování (dnes se bere z auditu, sloupec v `contacts` neexistuje)

---

## 4. Otevřené nálezy bez vlastníka

Věci, na které se přišlo a nikdo je nedělá. **Tohle je seznam, který nejvíc hrozí, že zapadne.**

- [ ] **pg-boss neumí cron po sekundách** (minimum je minuta). Týká se dnešního `campaign.watchdog` a `campaign.scheduler`, které s tím předpokladem běží. Nález z prověrky plánu automatizací
- [ ] **Kódy `precheck_*` nejsou v registru chybových kódů**, mají jen texty v katalogu. Zvednout uzavřený počet `FINDING_CODES` patří k práci na předodesílací kontrole
- [ ] **Lint padá na dvou cizích souborech**: `docker/collect-runtime-deps.mjs` (no-console) a `docs/design/script.js` (no-undef)
- [ ] **Podezření na krátký strop u prokliku:** `contactLookupTimeoutMs: 30` může uříznout studený dotaz, takže první proklik po vypršení cache přijde bez identifikace. Naměřeno jednou, netestováno
- [ ] **Rotace klíče u podpisu `identify`** ověřena jen jednotkovým testem, ne skutečnou rotací
- [ ] **Anglická verze nápovědy k podpisu** není vizuálně zkontrolovaná (katalog je v souladu, obrazovka v angličtině se nezobrazovala)
- [ ] **Sedm front zůstává bez obsluhy** vědomě (události od poskytovatele, kvóty, překontrolování domén, přepočty šablon). Zpracování událostí od Amazonu má smysl až s veřejnou adresou
- [ ] **Tiše zahazované tiky z cronu se nikde nehlásí.** Když se zasekne třeba `campaign.scheduler` ve stavu `active`, začne se každý tik zahazovat a v logu nebude nic. `warningQueueSize` nikde nenastavujeme. Kandidát na alarm
- [ ] **Rozpor u fronty `contacts.import`:** popis slibuje „jeden běžící import na projekt", ale producent posílá klíč importu, ne projektu. Klíč projektu tam nikdy nikdo neposlal a `batch.ts` před ním varuje. Patří vlastníkovi importu
- [ ] **Sedm front nemá v repozitáři producenta** (`platform.webhook_deliver`, `inbound.process`, `consents.rebuild_state`, `content.process_asset`, `provider_event.process`, `tracking.erase_contact`, `tracking.rebuild_engagement`). Obsluha existuje, do fronty nikdo nezařazuje
- [ ] **Zastaralý komentář** v `packages/core/src/tracking/jobs/engagement-chain.db.test.ts:47` tvrdí, že oddíly zakládá smazaná fronta `platform.maintain_partitions`. Nic funkčního, ale lže
- [ ] **Obnova kampaně po pauze nemá rollback.** Odesílání kampaně má kolem zařazení úlohy try/catch, který vrátí stav zpátky a odpoví 503. Obnova po pauze ho nemá, takže neúspěšné zařazení propadne jako 500 a kampaň zůstane v `queueing`, odkud ji hlídač nezvedne. Je to pořád lepší než tiché zaseknutí, ale patří to vlastníkovi domény kampaní, není to vodovod zařazování úloh. Přiznaný nález od `politiky-front`
- [ ] **Deset front má jinak nastavené opakování v doméně kontaktů než ve sdíleném registru** (`CONTACTS_QUEUES` proti P01). Nejostřejší je `gdpr.erase`: doména dává **0 pokusů**, registr **3**. Dál se rozchází `contacts.bulk_delete`, `contacts.refingerprint`, `gdpr.export_subject`, `inbound.process` a pět dalších jen v expiraci. Nula pokusů u anonymizace **může být záměr** (opakovaný výmaz je nebezpečnější než neúspěšný), takže to musí posoudit vlastník domény, ne se to uklidit mimochodem. Nález od `politiky-front`, který to správně nechal být, aby nezměnil chování článku 17 pod hlavičkou úpravy o slučování
- [ ] **Měření z Gmailu** nebude fungovat, dokud aplikace běží na localhostu. Produkt to už říká nahlas, ale je to trvalé omezení vývojové instalace

---

## 5. Před commitem

- [ ] Přegenerovat `packages/contracts/openapi.json`, až bude strom klidný
- [ ] Ověřit, že `pnpm test:unit`, `pnpm typecheck` a `pnpm lint` jsou zelené
- [ ] Zkontrolovat, že v pracovním stromu nejsou zkušební data ani snímky, které tam nepatří

---

## 6. Hotové

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
