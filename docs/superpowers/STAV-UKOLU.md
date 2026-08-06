# Stav úkolů

Živý dokument. Vede ho hlavní agent, prochází ho po každém dokončeném úkolu
a po každém novém zadání. **Nic se nesmí ztratit tím, že to zapadne v konverzaci.**

Poslední aktualizace: 2026-08-06, 12:35

Pravidla vedení:

- Hotové se **neškrtá pryč**, přesune se do „Hotové" s datem. Historie je součástí ceny.
- Co přibude v konverzaci, se sem zapíše **hned**, ne až se to začne dělat.
- U každé položky musí být vidět, **kdo ji drží** a **co brání dokončení**.
- Úkol bez vlastníka patří do „Čeká na zadání", ne do „Probíhá".

---

## 1. Probíhá (běžící subagenti)

### 1.0 Běží k 6. 8. 2026, 12:30

- `motiv-kampane` — **návrat k panelu Motiv.** Po výběru bloku se k nastavení motivu nedá vrátit,
  chybí odznačení. Plus odebrání pole „Úvodní řádek" z editoru, protože se dubluje
  s „Předhlavičkou" v kroku 2 a ta ho v generátoru přebíjí

**Ostatních osm agentů z dneška skončilo**, jejich práce je v oddílu 6.

### 1.1 `emaily-seznamu` — implementace plánu (9 až 10 dní, po etapách)
Plán: `docs/superpowers/plans/2026-08-05-emaily-seznamu.md`, rozhodnutí zadavatele v kapitole 7.

- [x] **Etapa 1 hotová a ověřená v běžící instalaci** (ověřil jsem důkaz sám dotazem do `mlain_clean`): ruční přidání kontaktu na seznam s dvojím potvrzením zařadí zprávu do outboxu s `confirm_url`. Cestou nález, který změnil řešení: **registrace portu z `instrumentation.ts` obsluha trasy nevidí**, běží v jiném modulovém grafu, takže první pokus vytvořil přihlášení i token, ale žádnou zprávu. Odesílatel se teď sestaví líně při prvním použití
- [x] **Etapa 2 hotová:** nastavení tří e-mailů na seznamu (potvrzovací, uvítací, rozloučení), obecné znění jako konstanta, vlastní znění zakládá předvyplněnou šablonu, závora na chybějící potvrzovací odkaz na dvou místech, migrace 0017 s chybějícími cizími klíči. Seznam do teď nešel ani přejmenovat. Zbývá třetí vrstva závory při ukládání šablony (`templates/service.ts`), zelenou jsem dal
- [x] **Etapa 3 hotová:** obrazovka „nový seznam", výchozí seznam „Odběratelé" ve všech projektech (migrace 0018 a 0019; agent správně **nepovýšil existující seznam**, protože `is_default` řídí, komu se co posílá), `redirect_url` a `success_message` v editoru formuláře, přesměrování po potvrzení i po odhlášení. Cestou zapojeno přepnutí výchozího seznamu (endpoint existoval bez volajícího) a opraveno, že **editor vůbec nezobrazoval hlášky ze serveru**, takže každá blokující chyba vypadala jako obecná záhada
- [x] **Protimluv vyřešen** (ověřeno v kódu 6. 8.): `precheck.ts:81` má dnes podmínku
  `input.unsubscribeRequired !== false`, takže odhlašovací odkaz už není vyžadovaný
  bezpodmínečně a u e-mailů seznamu se nevynucuje. Cesta ven existuje

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
- [x] **Tlačítko „Přepočítat" na kartě segmentu už funguje** (ověřeno v kódu 6. 8.):
  `segment-list.tsx:204` i položka v nabídce na řádku 246 volají `recount(row.id)`
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
- [ ] **Čtyři plány z 4. a 5. 8. neprošly recenzním procesem** podle `POSTUP-OPRAV.md`:
  editor WYSIWYG, e-maily seznamu, automatizace P17 a systémová pošta přes SES. Není to vada
  dokumentace, je to otázka, jestli u nich recenzi chceme, nebo jestli ten proces doběhl
- [ ] **Souhlas s měřením per kontakt nikdo nevlastní.** Po pěti dnech implementace v kódu není
  ani sloupec, ani zapínač. Ověřeno širokým grepem 6. 8.
- [x] **`.env.local` ukazoval na jinou databázi, než nad kterou běží server. Spraveno 6. 8.**
  Všechny tři `DATABASE_URL*` v `apps/web/.env.local` míří na **`mlain_clean`**, tedy na databázi,
  nad kterou běžící server jede a kde jsou skutečná data. Do té doby tam stálo `mlain`, takže
  **každý restart dev serveru by aplikaci přepnul na jiná data a vypadalo by to jako ztráta všeho.**
  Záloha původního souboru je `apps/web/.env.local.bak-20260806`. Jiný `.env.local` v repozitáři
  není a žádný další soubor na starou databázi neodkazuje (ověřeno grepem)
- [ ] Strojově čitelné datum žádosti u omezení zpracování (dnes se bere z auditu, sloupec v `contacts` neexistuje)
- [ ] **Místo mrtvého tlačítka „Změnit" v panelu AI asistenta může být funkční odkaz** na
  `/settings/brand`. Tlačítko je odstraněné podle pokynu („je tam zbytečné, vyhodit"), cíl ale
  existuje. Práce na jedno slovo, kdyby ho tam zadavatel chtěl
- [ ] **„Upravit kontakt" v nabídce řádku nejde otevřít do nového panelu** (Cmd+klik ani prostřední
  tlačítko). `DropdownMenuItem` v `packages/ui` neumí `asChild`. Týká se i Štítků
- [ ] **Žlutá primární akce u samostatné šablony.** „Poslat test" tam bývalo žluté, po převodu na
  ikonu je tmavé, protože ikonové tlačítko žlutou variantu nemá. **Rozhodnuto nechat tmavé**
  (žlutá má znamenat hlavní akci obrazovky, ne se objevovat v řadě ikon). Zapsáno jako rozhodnutí,
  ne nedodělek
- [ ] **Hlavička editoru se pod 1400 px pořád láme do dvou řádků.** Nad tou šířkou drží jeden.
  Editor stejně roluje vodorovně kvůli vlastní minimální šířce, takže to nikdo neřešil

---

## 4. Otevřené nálezy bez vlastníka

Věci, na které se přišlo a nikdo je nedělá. **Tohle je seznam, který nejvíc hrozí, že zapadne.**

### Nálezy z 6. 8. 2026

Seřazeno podle toho, co může nejvíc bolet. Co se stihlo opravit, je v oddílu 6.

> **Hranice ověření u provozních oprav z 6. 8.** Čtyři věci jdou ověřit jen proti sestavenému
> produkčnímu obrazu nebo živé instalaci, takže jsou pokryté testy nad toutéž funkcí, ne během:
> chování cesty k migracím v zabundlovaném CLI, že `SHARP_FORCE_GLOBAL_LIBVIPS=1` opravdu přelinkuje
> knihovnu (to je vlastnost cizího balíčku), běh `genkey` a `upgrade` v kontejneru, a skutečný pád
> migrace uprostřed obnovy. **Ověřené je to, co vlastníme.** Stojí za to je projet, až se bude
> stavět obraz.

- [ ] **Za otevřeným dialogem zůstává horní lišta v plné sytosti.** Zatmívací plocha má
  `--z-dialog` (40), lišta `--z-topbar` (50), takže logo, přepínač projektů i jméno uživatele
  svítí, jako by šly použít, kdežto zbytek obrazovky ztmavne. **Kliknout na ně nejde** (Radix
  drží zásahy na zatmívací ploše), takže je to vada vzhledu, ne díra v ovládání.
  **Boční menu překryté je, ale jen náhodou:** má tutéž čtyřicítku a rozhoduje pořadí v DOM.
  Náprava chce nové číslo mezi 50 a 60, tedy zásah do stupnice. Naměřeno 6. 8.
- [ ] **Editor si vrství po svém, mimo stupnici.** `block-chrome.tsx` a `block-toolbar.tsx` mají
  `z-10`/`z-20`, `drop-slot.tsx` `zIndex: 40` a `inline-rich-text.tsx` dvakrát `zIndex: 30`
  psané přímo ve stylu. Poslední dvě se v komentářích samy nazývají vysouvací vrstvou a berou si
  její stín, ale vrstvu si vzaly číslem. **Uvnitř plátna to drží** a zvednout je na `--z-flyout`
  by bylo horší: nástrojová lišta bloku by plavala přes horní lištu

- [ ] **Formulář ÚPRAVY kontaktu slibuje u seznamu špatný e-mail.** Zaškrtnutí seznamu tam
  slibuje potvrzovací e-mail, jenže **u seznamu s jedním krokem se kontakt přihlásí rovnou
  a odejde mu uvítací e-mail**, pokud ho seznam má zapnutý. To ta věta neříká. Zjištěno 6. 8.
  při opravě formuláře zakládání. Chce to poslat příznak uvítacího e-mailu ze stránky do formuláře
- [ ] **Průvodce importem a zakládáním kampaně nekontrolují oprávnění.** `contacts/import`
  a `campaigns/new` pustí dovnitř kohokoli, kdo si napíše adresu, a **odmítnou ho až u uložení**,
  tedy po vyplnění celého průvodce. Na Přehledu je to od 6. 8. ošetřené (akce vysvětlí, že na ni
  člověk nemá právo), ale **přímou adresou ta díra zůstává.** Zjištěno při té opravě
- [ ] **Obrazovka `/segments/cleanup` je osiřelá a plná mrtvých tlačítek.** Nevede na ni jediný
  odkaz v aplikaci a kromě odstraněného „Zmrazit" jsou na ní mrtvé i „Stáhnout těch N kontaktů",
  „Zkontrolovat", „Odložit o 14 dní" a „Zrušit úklid", plus výběr akce, který se nikam neukládá.
  Počet kontaktů drží natvrdo na nule. **Je to nákres scénáře, ne zapojená obrazovka:** buď
  dodělat, nebo odstranit
- [ ] **„Spočítat přesně" u odhadu počtu segmentu je mrtvé a zapojit ho nejde bez změny API.**
  Odhad vzniká, když časový strop zabije přesné počítání, a `POST /segments/preview` neumí přijmout
  delší strop. Buď se do těla přidá něco jako `timeout_ms`, nebo tlačítko musí pryč

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
- [ ] **Odeslaná ukázková kampaň nemá archivovanou podobu.** Ukázková data zakládají kampaň
  přímým SQL a nevyplní `campaigns.design` ani `compiled_html`. **Je to díra v předpokladu,
  na kterém dnes stálo rozhodnutí o barvách:** argument zněl, že zapékání je bezpečné, protože
  odeslaná kampaň drží hotové HTML. U šesti kampaní to platí, u téhle ne
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
- [ ] **Tmavý režim přebíjí zvolené pozadí natvrdo.** Emitter u výchozí strategie `auto` vydá
  `@media (prefers-color-scheme:dark){.ml-canvas{background-color:#0b0f19!important}}`, takže
  `!important` přebije i barvu z panelu. **Do 6. 8. to bylo bez následku, protože volba nikam
  nevedla; teď už vede.** Uživatel si zvolí pozadí a v tmavém režimu ho neuvidí. Editor u toho
  aspoň nelže, ukáže totéž co příjemci. Doporučení agenta, se kterým souhlasím: nabídnout
  v panelu tmavou variantu ploch (`theme.darkMode.colors`, mechanismus existuje a nikdo ho
  nenabízí). Druhá cesta je tmavý režim vypínat, když si uživatel zvolí vlastní plochu
- [ ] **Volba role v panelu Motiv barvu zmrazí.** „Pozadí plátna = hlavní barva značky" uloží
  konkrétní odstín, ne vazbu, takže se po změně značky nezmění. Uživatel čeká vazbu
- [ ] **Krok 2 kampaně neumí uložit jen jméno.** Uložení pouští validaci celého formuláře, takže
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
- [ ] **Pozvánka do projektu chodí v jazyce instalace**, ne projektu ani zvaného
  (`identity/invitation-service.ts:149`). Totéž e-mail o konci zkušebního režimu
- [ ] **`asset_references` po smazané šabloně zůstávají.** Knihovna médií hlásí u obrázku použití
  v šabloně, kterou nikdo nevidí. Platí i pro ručně smazanou knihovní šablonu, není to regrese
- [ ] **Editor otevřený během přestavby kódu tiše přestane ukládat.** Týká se jen vývoje, ale
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
- [ ] **Endpoint `GET /api/v1/transactional/{id}` neexistuje**, router má jen POST. Zákazník
  tedy nemá jak zjistit stav odeslané transakční zprávy jinak než odchozím webhookem, přestože
  to průzkum popisuje jako součást nejmenší užitečné verze
- [ ] **`PUT /api/v1/name-overrides` nemá v aplikaci obrazovku.** Nález z 5. 8. platí dál,
  `name-overrides` se v `apps/web` nevyskytuje ani jednou
- [ ] **Dva mrtvé odkazy na reportu kampaně, a každý chce jiné řešení** (rozebráno 6. 8.):
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
- [ ] **Po instalaci nejde nikoho pozvat, aniž se sáhne do konfigurace.** `SIGNUP_MODE` má
  v `schema-platform.ts:88` výchozí hodnotu **`closed`**, kdežto rozhodnutí zadavatele z 31. 7.
  říká „invite: doporučený výchozí stav". **A v `.env.example` ta proměnná vůbec není**, takže
  provozovatel nemá jak zjistit, že existuje. U self-hosted produktu to znamená, že po instalaci
  je uživatel sám a neví proč. Ověřeno v kódu 6. 8. Buď je to vědomá změna, kterou nikdo nezapsal,
  nebo přehlédnutí; rozhodne zadavatel
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
- [ ] **Vytěžit `NALEZY-NAPRIC-PLANY.md`.** Má zhruba 190 nálezů v oddílu „Otevřené", jenže
  uzavíralo se v něm **na místě slovem, ne přesunem**, takže nadpis o stavu položky nic neříká.
  Namátková kontrola ze 6. 8.: jeden nález opravený, jeden pořád platí. **Je to směs, ne seznam
  práce.** Projít ho proti kódu je samostatný úkol; co z něj přežije, patří sem, ne zpátky tam
- [ ] **Obrazovka detailu úlohy neexistuje.** `/w/{slug}/jobs/{kind}/{jobId}` (nález N30 z P06),
  adresář `jobs` v repozitáři není. Doloženo při úklidu dokumentace 6. 8.
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
- [ ] **`Escape` v poli pro adresu odkazu ukončí psaní celého textu**, místo aby zavřel jen ten
  řádek. Spíš otázka návrhu než vada
- [ ] **Editor roluje vodorovně pod šířkou okna asi 1460 px** kvůli `min-width: 1140px` na mřížce
  (`editor-shell.tsx:344`). Vědomé rozhodnutí z návrhu, popsané v komentáři na řádku 241.
  Nesouvisí s panelem vlastností, ten se opravil
- [ ] **Klikací plocha 36 px** u spouštěče „Zobrazit jako" v hlavičce editoru, práh je 44 px.
  Přepínače režimů zobrazení už spravené jsou
- [x] **Osiřelé překladové klíče smazány 6. 8.** Všechny tři v obou jazycích. Ověřeno, že je nikdo
  nepoužívá, včetně dynamicky skládaných klíčů (`brand-theme-preview.tsx` skládá
  `value.color.${role}`, ale `paletteLabel` mezi role nepatří). `i18n-check` v souladu.
  Původně: `contacts.list.columnWidth`
  a `reports.table.columnWidth` v cs i en. Plus `editor.value.color.paletteLabel` po přestavbě
  panelu vlastností
- [ ] **Náhledy šablon** chtějí změnu na straně serveru, designem se to nespraví
- [ ] **Tmavý režim přebíjí pozadí plátna natvrdo** na `#0b0f19`. Dnes bez následku, protože
  volba pozadí nikam nevede. **Až ji `motiv-kampane` zprovozní, začne to vadit**: uživatel si
  zvolí barvu a v tmavém režimu ji stejně neuvidí

### Poučení, které stojí za víc než jednotlivé opravy

- [ ] **Obal, který polyká ovládací prvky uvnitř.** Za jedno dopoledne třikrát, pokaždé jiný agent
  a jiná část aplikace: tlačítko v řádku tabulky nešlo spustit z klávesnice (šest tabulek), tatáž
  vada zrcadlově opravená jen pro myš, a plátno editoru bralo klávesy z pole pro odkaz jako
  operace nad bloky. **Podrobně i s pravidly v `docs/superpowers/DESIGN-INTEGRACE.md`, kapitola 7.**
  Stojí za to to cíleně hledat jinde
- [ ] **Test se ověřuje tím, že se oprava dočasně vrátí a zkontroluje se, že spadne.** Čtyři agenti
  to dnes udělali a pokaždé to něco odhalilo. `keyboard-parity.test.tsx` byl zelený roky a přitom
  netestoval ani jeden ovládací prvek uvnitř buňky

- [ ] **pg-boss neumí cron po sekundách** (minimum je minuta). Týká se dnešního `campaign.watchdog` a `campaign.scheduler`, které s tím předpokladem běží. Nález z prověrky plánu automatizací
- [ ] **Kódy `precheck_*` nejsou v registru chybových kódů**, mají jen texty v katalogu. Zvednout uzavřený počet `FINDING_CODES` patří k práci na předodesílací kontrole
- [x] **Lint je od 6. 8. čistý na celém repozitáři** (`npx eslint .` vrací nulu, ověřeno).
  Rozhodnuto podle povahy souboru, žádné plošné vypnutí: stavební skript image patří mezi nástroje,
  kde jsou výpisy do konzole jediným dokladem o obsahu vrstvy; ukázková stránka v `docs/` dostala
  pravdu o tom, že běží v prohlížeči, místo aby se z lintu vyřadila. Původně 11 chyb ve dvou souborech
- [ ] **Podezření na krátký strop u prokliku:** `contactLookupTimeoutMs: 30` může uříznout studený dotaz, takže první proklik po vypršení cache přijde bez identifikace. Naměřeno jednou, netestováno
- [ ] **Rotace klíče u podpisu `identify`** ověřena jen jednotkovým testem, ne skutečnou rotací
- [ ] **Anglická verze nápovědy k podpisu** není vizuálně zkontrolovaná (katalog je v souladu, obrazovka v angličtině se nezobrazovala)
- [ ] **Sedm front zůstává bez obsluhy** vědomě (události od poskytovatele, kvóty, překontrolování domén, přepočty šablon). Zpracování událostí od Amazonu má smysl až s veřejnou adresou
- [ ] **Tiše zahazované tiky z cronu se nikde nehlásí.** Když se zasekne třeba `campaign.scheduler` ve stavu `active`, začne se každý tik zahazovat a v logu nebude nic. `warningQueueSize` nikde nenastavujeme. Kandidát na alarm
- [ ] **Rozpor u fronty `contacts.import`:** popis slibuje „jeden běžící import na projekt", ale producent posílá klíč importu, ne projektu. Klíč projektu tam nikdy nikdo neposlal a `batch.ts` před ním varuje. Patří vlastníkovi importu
- [ ] **Sedm front nemá v repozitáři producenta** (`platform.webhook_deliver`, `inbound.process`, `consents.rebuild_state`, `content.process_asset`, `provider_event.process`, `tracking.erase_contact`, `tracking.rebuild_engagement`). Obsluha existuje, do fronty nikdo nezařazuje
- [x] **Zastaralý komentář opraven 6. 8.** Oddíly zakládá `ensureUpcomingPartitions`, kterou volá
  migrační runner na konci každé migrace a příkaz `mlain partitions`. Ta fronta to **nikdy dělat
  nemohla**: zakládání oddílu je DDL a worker běží pod rolí, která schéma nevlastní. Proto
  z registru zmizela. Původně: komentář v `engagement-chain.db.test.ts:47` tvrdí, že oddíly zakládá smazaná fronta `platform.maintain_partitions`. Nic funkčního, ale lže
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
