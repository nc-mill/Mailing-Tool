# Křížová revize částí 5 a 6 z pohledu části 2

<!-- puvod-dokumentu -->
> **Historický záznam, ne platné zadání.** Křížová revize specifikací z 31. 7. 2026: křížová recenze částí 5 a 6 očima části 2.
> Nálezy se **zapracovaly zpátky do částí v `parts/`** ještě před psaním plánů, takže dokument popisuje
> tehdejší podobu textů, ne dnešní. Platné znění specifikace je vždycky v `parts/`, ne tady.
> **Stav jednotlivých nálezů neověřen.**
> **Dnešní stav:** `docs/superpowers/STAV-UKOLU.md` (živý dokument), design `docs/superpowers/DESIGN-INTEGRACE.md`.

Recenzent: subagent part2-kontakty (vlastník části 2: kontakty, souhlasy, segmenty, import, vokativ, GDPR)
Datum: 2026-07-31
Recenzované soubory: `parts/05-tracking.md` (2 749 řádků), `parts/06-ui-ux.md` (3 996 řádků)
Referenční dokument: `parts/02-kontakty.md`

Hledal jsem tři věci podle kapitoly 6 zadání: **mezeru** (nevlastní to nikdo), **překryv** (dvě části popisují totéž jinak) a **nesplnitelný předpoklad** (část A počítá s něčím, co část B nedodává v tom tvaru). Nehodnotil jsem estetiku, obecnou použitelnost ani nic, co nesouvisí s doménou části 2.

Poznámka k rozsahu: zadání uvádělo, že části 5 chybí sekce 10 až 12. V okamžiku revize už dopsané byly (soubor má 2 749 řádků, ne 2 301), takže je hodnotím jako plnohodnotné. Část 6 měla 3 996 řádků, ne 3 794.

Všechny nálezy níže jsem ověřil vlastním čtením zdrojů, ne jen souhrnem.

---

## Souhrn

| Část | Blokující | Vážné | Drobné | Celkem |
|---|---|---|---|---|
| 5 (tracking) | 2 | 4 | 3 | 9 |
| 6 (UI a UX) | 3 | 5 | 4 | 12 |
| **Celkem** | **5** | **9** | **7** | **21** |

Tři nejzávažnější nálezy:

1. **`contact_engagement` neexistuje** (část 5). Bez per-contact rollupu jsou engagement podmínky v segmentech a všech šest presetů čištění databáze nepoužitelných.
2. **Fronta ke kontrole vokativu je navržená po kontaktech, ne po skupinách** (část 6). Ruší to hlavní úsporu práce a chybí jí mechanismus, kterým se fronta vyprazdňuje natrvalo.
3. **Režim výmazu `delete` přepočítává statistiky kampaní směrem dolů** (část 5). Přímý rozpor s principem části 2, že se agregáty výmazem nemění.

---

## Část 5: tracking

### [BLOKUJÍCÍ] 5-1. `contact_engagement` neexistuje, `message_engagement` ho nenahradí

- **Místo:** `05-tracking.md`, sekce 2.6, ř. 419 až 459; sekce 12.4, ř. 2639 až 2641. Grep na `contact_engagement` vrací nula výskytů.
- **Co je špatně:** Část 2 v sekci 11.4, požadavku 5.3, vyžaduje rollup **na kontakt**: `contact_engagement(contact_id PK, workspace_id, last_open_at, last_click_at, opens_30d, clicks_30d, consecutive_no_open, ...)`. Část 5 místo toho dodává `message_engagement`, což je „jeden řádek na zprávu, derivovaný stav" (ř. 224), partitionovaný `RANGE (created_month)`. V sekci 12.4 pak píše: „Operátory `otevřel`, `neotevřel`, `klikl`, `neklikl` čtou z `message_engagement`, ne z `message_events`. Dotaz je pak indexovaný a rychlý."
- **Proč to nestačí:** Tvrzení „indexovaný a rychlý" platí pro dotaz na jednu zprávu, ne pro dotaz na kontakt. Tři konkrétní důvody:
  1. Tabulka je partitionovaná po měsících. Dotaz „otevřel tento kontakt cokoliv za posledních 90 dní" sáhne do tří až čtyř partition, dotaz na celkové součty do **všech**. Při 26měsíční výchozí retenci (ř. 2383) je to 26 partition na jeden kontakt, a to pro každý z pěti milionů kontaktů v segmentu.
  2. Preset `no_open_last_n` („neotevřel posledních 5 kampaní") potřebuje okénkovou funkci přes zprávy seřazené na kontakt. Nad partitionovanou tabulkou s desítkami milionů řádků je to plný průchod, ne indexovaný dotaz. Pole `consecutive_no_open` existuje právě proto, aby se to spočítalo jednou při zápisu události, ne při každém přepočtu segmentu.
  3. Index `idx_message_engagement__contact` je `(workspace_id, contact_id, first_open_at DESC)`, tedy per partition. Nekryje agregaci přes partition.
- **Jak by to mělo být:** Doplnit `contact_engagement` jako **nepartitionovanou** tabulku s primárním klíčem `contact_id`, aktualizovanou stejným jobem `tracking.process_engagement`, který už dnes v kroku 5 dělá UPSERT do `message_engagement`. Přírůstek práce je jeden UPSERT navíc na dávku. Sloupce a dva indexy jsou vypsané v části 2, sekci 11.4. `message_engagement` má zůstat, obě tabulky mají různý účel: jedna odpovídá „co se stalo s touhle zprávou", druhá „jak je na tom tenhle člověk".
- **Kategorie:** nesplnitelný předpoklad
- **Nedopsaná sekce:** ne, část 5 má sekci 12.4 dopsanou a explicitně tam navrhuje jiné řešení

### [BLOKUJÍCÍ] 5-2. Režim výmazu `delete` mění historické statistiky kampaní

- **Místo:** `05-tracking.md`, sekce 3.15.3, ř. 1921; akceptační kritérium 68, ř. 2538
- **Co je špatně:** Tabulka režimů uvádí u `delete`: „Řádky se smažou | Řádky se smažou | Přepočítají se z `message_engagement`, **čísla klesnou**". Akceptační kritérium 68 to potvrzuje: „`erase_contact(id, 'delete')` smaže události a přepočítá `campaign_stats` tak, aby seděly s `message_engagement`."
- **Proč to vadí:** Část 2 v sekci 4.14.4 stanoví opak jako závazný princip: „**agregované statistiky kampaní se výmazem nemění.** Kampaň, která včera vykazovala 4 812 otevření, jich vykazuje 4 812 i po výmazu." Zdůvodnění je tam taky: report, jehož čísla se zpětně mění, je k ničemu, a událost bez vazby na osobu je statistický, ne osobní údaj.
- **Dvě části tedy slibují uživateli protichůdnou věc.** Provozovatel, který v pondělí exportoval report s 4 812 otevřeními a v úterý vyřídil jednu žádost o výmaz, dostane ve středu 4 811 a nebude mít jak zjistit proč.
- **Jak by to mělo být:** Buď režim `delete` zrušit úplně a nechat jen `anonymize` (moje preference, protože `anonymize` už je výchozí a `delete` řeší právní obavu, kterou obě části shodně označují za otázku na právníka), nebo ho nechat, ale **explicitně u něj napsat, že mění historické reporty**, a v UI to uživateli říct před potvrzením. Ticho je ta nejhorší varianta. Rozhodnutí patří na synchronizaci, ne do jedné z částí.
- **Vedlejší nález:** Režimy se navíc jmenují různě. Část 2 má `anonymize` a **`purge`**, část 5 má `anonymize` a **`delete`**. Hook `tracking.erase_contact(contactId, mode)` tedy dostane hodnotu, kterou nezná.
- **Kategorie:** překryv plus nesplnitelný předpoklad
- **Nedopsaná sekce:** ne

### [VÁŽNÉ] 5-3. Slučování kontaktů, které část 2 nemá

- **Místo:** `05-tracking.md`, sekce 12.2, ř. 2631
- **Co je špatně:** „**Hook `tracking.reassign_contact(fromContactId, toContactId)`** se musí zavolat při sloučení dvou kontaktů. Přepíšu `identities.contact_id`, `web_events.contact_id`, `message_engagement.contact_id`."
- **Proč to vadí:** **Část 2 slučování kontaktů vůbec neimplementuje.** Nikde v ní není operace merge, endpoint, job ani stav. E-mail je jediný klíč a je neměnný (4.1.2, pravidlo 1), takže dva kontakty se stejnou osobou vzniknou jen tehdy, když má člověk dvě adresy, a to část 2 vědomě neřeší. Část 5 tedy čeká na volání, které nikdy nepřijde, a její návrh na tom tiše stojí.
- **Jak by to mělo být:** Rozhodnout na synchronizaci jednu ze tří variant: (a) slučování do MVP 0 nepatří a část 5 požadavek stáhne, (b) část 2 ho doplní jako plnohodnotnou funkci včetně toho, co se stane se souhlasy, seznamy a suppression listem dvou slučovaných kontaktů, což není triviální, (c) odloží se do MVP 2 a obě části to tak označí. Moje preference je (a) pro MVP 0 a (c) pro plán, protože slučování se souhlasy je samostatná úloha na několik dní.
- **Kategorie:** nesplnitelný předpoklad
- **Nedopsaná sekce:** ne

### [VÁŽNÉ] 5-4. Retence je per instance, moje per workspace

- **Místo:** `05-tracking.md`, sekce 3.15.1, ř. 1896 až 1898; konfigurace ř. 2383
- **Co je špatně:** „Retence je **per instance, ne per workspace**, protože partition jsou společné pro celou databázi. Efektivní retence je maximum přes všechny workspace. (…) Pro MVP 0 se nabízí jen globální nastavení `TRACKING_RETENTION_MONTHS`."
- **Proč to vadí:** Část 2 má v sekci 4.15 retenci **per workspace** v tabulce `retention_policies(workspace_id, target, retain_days, action, enabled)` s běhy v `retention_runs` a s UI pro vlastníka projektu. Uživatel tedy v jedné obrazovce nastaví retenci formulářových odeslání na 180 dní a hned vedle uvidí, že retenci událostí nastavit nemůže, protože je globální. To je pro víceprojektovou instalaci matoucí a pro poskytovatele hostingu problém, protože jeden zákazník s požadavkem na 60měsíční retenci ji vnutí všem ostatním.
- **Technicky má část 5 pravdu**, že partition jsou společné, a sama nabízí řešení: „Nastavení per workspace se realizuje **mazáním řádků** v rámci partition, ne dropem partition." To je správná cesta, jen není dotažená do společného modelu.
- **Jak by to mělo být:** Zavést `retention_policies` s cíli `web_events` a `message_events`, které vlastní část 5, ale spravují se stejným UI a stejným mechanismem jako ostatní cíle části 2. `TRACKING_RETENTION_MONTHS` zůstane jako **globální horní mez** (drop partition), per workspace politika smí být jen kratší a realizuje se mazáním řádků. Uživatel pak má jedno místo a jeden mentální model.
- **Kategorie:** překryv
- **Nedopsaná sekce:** ne

### [VÁŽNÉ] 5-5. Odhlašovací a preferenční tokeny nepokrývá nikdo

- **Místo:** `05-tracking.md`, sekce 3.4 (formát tokenů), ř. 601 až 720; ř. 983
- **Co je špatně:** Část 5 má propracovaný formát tokenů s generacemi klíčů (`K_track[epoch]`), pevnou délkou payloadu a povinným `expires_at`. Na řádku 983 ale u `{{ unsubscribe_url }}` a `{{ webview_url }}` píše: „Vlastní mechanismus, jinde ověřený token", a dál se jimi nezabývá.
- **Proč to vadí:** Část 2 v sekci 4.9.3 potřebuje podepsaný token s payloadem `{ v, k, w, c, m, ca, l, exp }` a s **`exp = 0`, tedy bez expirace**. Zdůvodnění je tam: odhlašovací odkaz musí fungovat i za pět let, jinak člověk, který si e-mail nechal ve schránce, nemá jak odvolat souhlas, což je porušení čl. 7 odst. 3 GDPR a přímá cesta ke stížnosti na spam. Část 5 formát vlastní (kontrakt 4.10.3 části 1 vlastní bajtovou podobu), ale odmítá ho pro tenhle případ použít, a část 2 si vlastní formát vymýšlet nemá.
- **Dobrá zpráva:** Část 5 už má na řádku 808 přesně to pravidlo, které je potřeba: „**Staré generace se nesmí nikdy odstranit**, dokud existují odeslané e-maily s jejich tokeny. Prakticky to znamená navždy." Chybí jen krok, kdy se to vztáhne i na odhlašovací tokeny.
- **Jak by to mělo být:** Rozšířit formát části 5 o `kind` pro `unsubscribe` a `preferences` a povolit `expires_at = 0` s významem „bez expirace", nebo explicitně napsat, že tyhle dva tokeny vlastní část 1 v kontraktu 4.10.3, a nechat to tam dořešit. Nesmí zůstat věta „vlastní mechanismus", protože ta neurčuje vlastníka.
- **Kategorie:** mezera
- **Nedopsaná sekce:** ne

### [VÁŽNÉ] 5-6. Odvolání souhlasu s personalizací ponechá historickým událostem vazbu na osobu

- **Místo:** `05-tracking.md`, sekce 13, ř. 2278
- **Co je špatně:** „Odvolání `personalization` zruší vazbu v `identities` a zapíše `identity_bindings` se `source = 'reset'`. Historické události si `contact_id` **ponechají**, protože byly zaznamenány v době platného souhlasu."
- **Proč to vadí:** Část 5 sama dodává, že jde o právní otázku. Věcně to znamená, že po odvolání souhlasu zůstane u kontaktu plná historie chování na webu a timeline ji dál zobrazí. Uživatel nástroje, který v UI klikne „odvolat souhlas", velmi pravděpodobně čeká opak. Část 2 v sekci 4.14.5 řeší odvolání souhlasu s `email_marketing` jako okamžité a úplné zastavení, takže dvě odvolání souhlasu se v produktu chovají různě, aniž by to bylo někde vysvětlené.
- **Jak by to mělo být:** Není to nutně chyba, výklad je obhajitelný. Ale musí být viditelný: v UI u tlačítka odvolání a v dokumentaci. Navrhuju doplnit do části 5 explicitní větu a do části 6 mikrotext „Nové chování už zaznamenávat nebudeme. Co jsme zaznamenali dřív, zůstane v historii kontaktu." plus samostatnou akci „smazat i dosavadní historii", která zavolá `erase_contact`.
- **Kategorie:** mezera
- **Nedopsaná sekce:** ne

### [DROBNÉ] 5-7. Čtecí API souhlasů má jiné názvy účelů

- **Místo:** `05-tracking.md`, sekce 12.3, ř. 2635
- **Co je špatně:** „**Čtecí API souhlasů** ve tvaru `getConsents(contactId): { analytics, personalization, emailMarketing }`."
- **Proč to vadí:** Účel se v části 2 jmenuje `email_marketing` (hodnota v `consents.purpose` a v `contact_consent_state.purpose`, viz DDL 3.4). `emailMarketing` je jiný řetězec a při naivní implementaci se nikdy netrefí.
- **Jak by to mělo být:** Buď `email_marketing` všude, nebo explicitně napsat, že jde o TypeScript objekt s `camelCase` klíči, který se mapuje na `snake_case` hodnoty v databázi. Doplním funkci na svou stranu se signaturou `getConsentState(ctx, contactId): Promise<Record<ConsentPurpose, ConsentState>>`, kde `ConsentPurpose` je můj union.
- **Kategorie:** překryv
- **Nedopsaná sekce:** ne

### [DROBNÉ] 5-8. Souhlas s webovým trackingem není vázaný na kontakt

- **Místo:** `05-tracking.md`, sekce 5.2 a 5.3, ř. 1175 až 1177; ř. 2276
- **Co je špatně, spíš co je nedořečené:** SDK řeší souhlas výhradně v prohlížeči („Bez volání `consent` SDK nezapíše do `document.cookie`, `localStorage` ani `sessionStorage` nic"). To je správně a je to přesně to, co požaduje kapitola 6.7 hlavní specifikace. Není ale nikde napsané, jestli se souhlas předaný do SDK **propisuje do `consents`** v části 2.
- **Proč na tom záleží:** Souhlas je podle kapitoly 5 hlavní specifikace prvotřídní datový objekt s historií. Když SDK přijme `consent({analytics:true})` od identifikovaného kontaktu a nikam se to nezapíše, nemá provozovatel jak doložit, kdy souhlas vznikl. Zároveň se na `contact_consent_state` váže segmentace.
- **Jak by to mělo být:** Doplnit do části 5 větu, že po identity resolution se souhlas předaný do SDK zapíše přes doménovou funkci části 2 (`consents.record`), s `source = 'web_sdk'` a s důkazem v `evidence`. Část 5 do `consents` nesmí zapisovat sama, je to tabulka části 2 a je append-only s odebranými právy pro aplikační roli.
- **Kategorie:** mezera
- **Nedopsaná sekce:** ne

### [DROBNÉ] 5-9. `processing_restricted` se nikde neuplatňuje

- **Místo:** `05-tracking.md`, grep na `processing_restricted` vrací nula výskytů
- **Co chybí:** Část 2 zavádí `contacts.processing_restricted` pro čl. 18 GDPR a v kompilátoru segmentů ho vždy vylučuje. Část 5 ho nezná, takže u kontaktu s omezeným zpracováním se dál sbírají a přiřazují webové události a timeline ho dál zobrazuje.
- **Jak by to mělo být:** Job `tracking.process_events` má při identity resolution ověřit `processing_restricted` a při `true` událost uložit **bez** `contact_id`. Alternativa (událost zahodit) je horší, protože omezení zpracování se dá zrušit a data by chyběla.
- **Kategorie:** mezera
- **Nedopsaná sekce:** ne

### Co v části 5 sedí a nemá se měnit

`contacts.last_activity_at` je explicitně přiřazený části 5 (ř. 178 a požadavek 12.3 bod 3) a shoduje se s tím, co část 2 očekává. Vlastnictví tabulek `identities`, `identity_bindings`, `identity_merges` a `web_events` je jasně deklarované v přehledu 2.1. Účely souhlasu `analytics` a `personalization` odpovídají mému výčtu. Chování SDK bez souhlasu (nic neuloží, nic neodešle, drží 20 událostí v paměti) je přesně to, co požaduje hlavní specifikace, a je lepší popsané než v ní. Anonymizační průchod `properties` a `page` přes `TRACKING_PII_PROPERTY_KEYS` (ř. 1925) je nad rámec toho, co část 2 žádala, a je to dobrý nápad.

---

## Část 6: UI a UX

### [BLOKUJÍCÍ] 6-1. Fronta ke kontrole vokativu je po kontaktech, ne po skupinách

- **Místo:** `06-ui-ux.md`, sekce 8.3.7, ř. 1789 až 1821
- **Co je špatně:** Návrh obrazovky ukazuje tabulku jednotlivých lidí: řádky `Nikola Horák`, `René Dvořák`, `Nguyen Van Anh`, `Kim Novotná`, a pod nimi stránkování „1 až 20 ze 143 ‹ 1 2 3 4 5 6 7 8 ›".
- **Proč to vadí:** Část 2 v sekci 4.5.2 stanoví opak jako závazný: „Fronta se **nikdy nezobrazuje po kontaktech, vždy po skupinách**", s klíčem `(lower(unaccent(first_name)), gender, first_name_vocative)`. Důvod je uvedený tamtéž: „Import 3 000 kontaktů se 143 nejistými typicky vyrobí 30 až 60 skupin, ne 143 řádků. To je rozdíl mezi 'proklikám to za dvě minuty' a 'na to nemám čas'." Návrh části 6 dělá z dvouminutové úlohy osm stránek klikání, a u importu s převahou cizích jmen (kde část 2 počítá s 20 až 40 procenty ve frontě) je nepoužitelný úplně.
- **Jak by to mělo být:** Řádek je skupina: `Nikola  ·  47 kontaktů  ·  [muž ▾]  ·  Nikolo  ·  [✓ Ano] [Upravit]`, s rozbalením na jednotlivce, kdyby je uživatel chtěl vidět. Dvě hromadná tlačítka nahoře můžou zůstat, jsou dobrý nápad.
- **Kategorie:** nesplnitelný předpoklad

### [BLOKUJÍCÍ] 6-2. Chybí „uložit i pro budoucí kontakty", tedy jediný mechanismus, kterým fronta konverguje

- **Místo:** `06-ui-ux.md`, sekce 8.3.7, celá. Grep na `name_overrides` v části 6 vrací nula výskytů.
- **Co chybí:** Část 2 v sekci 4.5.3 zavádí volbu „uložit i pro budoucí kontakty" (zápis do `name_overrides`), která je **ve výchozím stavu zaškrtnutá**, a v tabulce 3.7 k tomu píše: „Tohle je jediný mechanismus, kterým se fronta ke kontrole vokativu časem vyprázdní místo toho, aby při každém importu narostla znovu."
- **Proč to vadí:** Bez něj marketér, který v pondělí rozhodl, že „Nikola" je v jeho databázi žena, rozhoduje totéž ve středu při dalším importu, a pak zase. Fronta se stává běžeckým pásem a uživatel ji po druhém importu přestane používat. Poznámka v návrhu „Co jednou potvrdíte nebo opravíte, už nikdy sami nezměníme" popisuje jen zámek na jednom kontaktu (`vocative_locked`), ne přepis na úrovni projektu, což jsou dvě různé věci.
- **Jak by to mělo být:** Zaškrtávátko u hromadných tlačítek i u řádku skupiny, ve výchozím stavu zapnuté, s textem „Zapamatovat pro všechny budoucí kontakty se jménem Nikola". Plus obrazovka pro správu přepisů v nastavení projektu, aby se dal omyl vzít zpět.
- **Kategorie:** mezera

### [BLOKUJÍCÍ] 6-3. Mikrotexty chyb importu používají čtyři vymyšlené kódy

- **Místo:** `06-ui-ux.md`, sekce 10.2, ř. 2867 až 2914
- **Co je špatně:** Katalog obsahuje `import_encoding_broken`, `import_no_email_column`, `import_duplicate_file` a `import_file_too_large`. **Ani jeden z nich v části 2 neexistuje.** Skutečné kódy jsou `unsupported_encoding` a `encoding_error`, `no_email_column_mapped`, `import_duplicate` a `file_too_large`.
- **Proč to vadí:** Není to kosmetika. Část 6 sama na řádku 2866 píše: „Sloupec 'Kód' je vazba na katalog chyb části 1", a na ř. 2860: „Server vrací **kód**, rozhraní z něj složí text v jazyce uživatele." Jsou to tedy míněné jako skutečné identifikátory, ne popisky. Při implementaci se text prostě nezobrazí, protože se klíč netrefí, a uživatel uvidí buď holý kód, nebo prázdno.
- **Jak by to mělo být:** Přejmenovat na skutečné kódy z části 2, sekce 4.6.11.
- **Vedlejší nález:** Katalog pokrývá 4 z 10 chyb na úrovni souboru a **0 z 20** chyb na úrovni řádku a 0 z 11 varování. Chápu, že katalog mikrotextů je ukázka, ne úplný výčet, ale právě řádkové chyby a varování (`gender_conflict`, `vietnamese_order_assumed`, `excel_serial_date_assumed`, `number_format_ambiguous`) jsou ty, kde je dobrý text nejcennější, protože uživatel netuší, co se stalo.
- **Kategorie:** nesplnitelný předpoklad

### [VÁŽNÉ] 6-4. „Vrátit tento import" vyžaduje data, která nikdo neukládá

- **Místo:** `06-ui-ux.md`, sekce 8.3.6, ř. 1741 („Celý import půjde potom vrátit zpět") a ř. 1778 („▸ Vrátit tento import")
- **Co je špatně:** Návrh slibuje vrácení celého importu, včetně dialogu při zrušení uprostřed.
- **Proč to vadí:** Import v části 2 (4.1.2) běží v režimu `update`, kde se u existujících kontaktů přepisují jen neprázdné hodnoty, a `attributes` se slučují po klíčích. V ukázce samotné části 6 je „Doplněných u existujících 2 585". **Vrátit to zpět znamená mít before-image každého dotčeného pole u 2 585 kontaktů**, a část 2 je neukládá. Vrácení nových kontaktů (9 812 řádků smazat) je triviální, vrácení aktualizací není.
- **Jak by to mělo být:** Buď zúžit slib na to, co jde: „Vrátit tento import" smaže jen kontakty, které importem **vznikly**, a v dialogu se doslova napíše, že změny u 2 585 existujících kontaktů zůstanou. Nebo část 2 doplní tabulku `import_row_snapshots` s before-image, což je při pěti milionech řádků významná cena za funkci, kterou použije zlomek uživatelů. **Moje preference je první varianta**, protože druhá zdraží každý import kvůli scénáři „nahrál jsem špatný soubor", který se řeší i tím, že se nahraje správný.
- **Kategorie:** nesplnitelný předpoklad

### [VÁŽNÉ] 6-5. Blokování smazání kontaktu během rozesílky stojí na chybném předpokladu

- **Místo:** `06-ui-ux.md`, sekce 10.2, hláška 24, ř. 3157 až 3167
- **Co je špatně:** „Jana Nováková je mezi příjemci právě probíhající kampaně **Letní výprodej**. Smazat ji můžete až po dokončení rozesílky, **jinak by kampaň skončila chybou**."
- **Proč to vadí:** Ten předpoklad není pravdivý. Podle kapitoly 5 hlavní specifikace a části 2 sender **nečte tabulku kontaktů** a pracuje výhradně se snapshotem v `messages.render_data`. Smazání kontaktu tedy kampaň nerozbije. Část 2 v sekci 4.9.4 popisuje, co se skutečně stane: čekající zprávy (`pending`) se přepnou na `skipped`, zprávy ve stavu `claimed` doběhnou, a v nejhorším případě odejde ještě jedna zpráva.
- **Proč to vadí prakticky:** Blokace brání uživateli udělat legitimní věc (smazat kontakt na jeho žádost) a odůvodňuje ji neexistujícím rizikem. Nabízená alternativa „Odhlásit z odběru místo smazání" navíc neřeší žádost podle čl. 17 GDPR.
- **Jak by to mělo být:** Smazání povolit a hlášku změnit na informativní: „Jana Nováková je mezi příjemci právě probíhající kampaně *Letní výprodej*. Zrušíme jí zbývající zprávy, ale jedna zpráva už mohla odejít. Smazat?" Je to pravdivé, nebrání to uživateli a přesně to odpovídá chování popsanému ve 4.9.4.
- **Kategorie:** nesplnitelný předpoklad

### [VÁŽNÉ] 6-6. Segment builder neumí vyjádřit tři z devíti druhů podmínek

- **Místo:** `06-ui-ux.md`, sekce 8.4.3, ř. 1893 až 1930 (výběr pole)
- **Co chybí:** Nabídka polí má skupiny O ČLOVĚKU, ZAŘAZENÍ, CO DĚLAL S E-MAILY, CO DĚLAL NA WEBU a ČASY. Proti `FieldRef` z části 2 (4.11.1) chybí:
  - **`consent`** (operátory `is_granted`, `is_withdrawn`, `is_missing`). Část 2 kvůli tomu postavila celou tabulku `contact_consent_state` a index `idx_contact_consent_state__ws_purpose_status`. Bez UI se k nim uživatel nedostane.
  - **`suppression`** (`is_suppressed`, `is_not_suppressed`).
  - Z `contact` chybí `gender`, `locale`, `email_domain` a `vocative_confidence`. Poslední dvě jsou drobnost, ale `gender` je pro segmentaci v marketingu běžný požadavek a část 2 ho jako první třídu ukládá.
- **Proč to vadí:** „Komu smím poslat obchodní sdělení" je otázka, kterou si česká firma položí hned. Segment „má souhlas s e-mail marketingem a není na blokovaných adresách" musí jít postavit, jinak je celý model souhlasů jen datový sklad bez přístupu.
- **Jak by to mělo být:** Přidat skupinu SOUHLASY A BLOKACE se dvěma položkami a doplnit `gender` a `locale` do skupiny O ČLOVĚKU. Pojmenovat lidsky: „Souhlasí s posíláním novinek", „Je na blokovaných adresách".
- **Kategorie:** mezera

### [VÁŽNÉ] 6-7. Limity a chování náhledu počtu si odporují s částí 2 ve čtyřech číslech

- **Místo:** `06-ui-ux.md`, sekce 8.4.4, ř. 1966 až 1975; sekce 8.4.2, ř. 1888
- **Co je špatně:**

  | Věc | Část 6 | Část 2 |
  |---|---|---|
  | Limit počtu podmínek | „Segment má **24 podmínek** a to je nad naše síly" (ř. 1974) | 100 (4.11.4) |
  | Práh pro odhad místo přesného počtu | nad **15 s** (ř. 1971) | `SEGMENT_PREVIEW_TIMEOUT_MS = 3000`, tedy 3 s (4.11.5) |
  | Metoda odhadu | „Odhad se dělá **vzorkováním**" | `EXPLAIN (FORMAT JSON)` a `Plan Rows` |
  | Maximální vnoření | 2 úrovně (ř. 1888) | 5 (4.11.4) |

- **Proč to vadí:** Práh 15 s znamená, že uživatel u velké databáze čeká patnáct sekund na každou změnu podmínky, což z živého náhledu dělá nepoužitelnou funkci. Vzorkování je jiná implementace než `EXPLAIN` a dá jiná čísla. Limit 24 je zbytečně přísný a uživatel narazí na hlášku, kterou server nevydá. Hloubka 2 je legitimní zjednodušení UI, ale **nikde není napsané, co se stane se segmentem hloubky 3 až 5 vytvořeným přes API**, a ten builderem otevřít nepůjde.
- **Jak by to mělo být:** Převzít čísla z části 2 (3 s, 100 podmínek, `EXPLAIN`). Hloubku 2 v UI ponechat jako vědomé zjednodušení, ale doplnit stav „Tenhle segment je složitější, než co umí editor zobrazit. Můžete ho použít, upravit ho jde přes API." Bez toho vznikne segment, který v UI vypadá poškozeně.
- **Kategorie:** překryv

### [VÁŽNÉ] 6-8. Diagnostika prázdného segmentu spustí neomezený počet dotazů

- **Místo:** `06-ui-ux.md`, sekce 8.4.4, ř. 1978 až 1996
- **Co je navržené:** Při prázdném výsledku se pro **každou** podmínku spočítá samostatný počet, plus se dopočítá vyplněnost pole a jeho tři nejčastější hodnoty.
- **Proč to vadí:** Je to nejlepší nápad na celé obrazovce a chci ho zachovat, ale u segmentu se 100 podmínkami to je 100 plných průchodů nad pěti miliony kontaktů, spuštěných přesně ve chvíli, kdy hlavní dotaz už trval déle než timeout. Část 2 s tím nepočítá a nemá na to limit.
- **Jak by to mělo být:** Omezit diagnostiku na prvních 10 podmínek, každou s vlastním `statement_timeout` 1 s, a spouštět ji **až na vyžádání** tlačítkem „Proč je prázdný?", ne automaticky. Dopočet nejčastějších hodnot jen u polí označených `indexed`. Doplním na svou stranu endpoint `POST /api/v1/segments/diagnose` s těmito limity.
- **Kategorie:** nesplnitelný předpoklad

### [DROBNÉ] 6-9. Negace skupiny podmínek nejde vyjádřit

- **Místo:** `06-ui-ux.md`, sekce 8.4.2
- **Co chybí:** `GroupNode` v části 2 má `not?: boolean`. UI má jen „splňují všechny / alespoň jednu" a jednotlivé podmínky mají negativní operátory (`neq`, `not_contains`, `did_not`), takže většina případů je pokrytá. Nejde ale vyjádřit `NOT (A OR B)`.
- **Jak by to mělo být:** Buď doplnit do UI třetí volbu „nesplňují ani jednu", což je srozumitelná česká věta a přesně to `NOT (A OR B)` znamená, nebo `not` z AST vypustit. **Preferuju první**, je to jeden řádek v rozbalovacím seznamu.
- **Kategorie:** mezera

### [DROBNÉ] 6-10. Sloupec s chybou v `errors.csv` se jmenuje jinak

- **Místo:** `06-ui-ux.md`, sekce 8.3.6, tabulka odůvodnění: „CSV má původní sloupce plus sloupec `chyba`."
- **Co je špatně:** Část 2 (4.6.11) definuje **dva** sloupce, `_error_code` a `_error_detail`, a to anglicky, protože jsou to identifikátory, ne text pro člověka. Podtržítko na začátku je tam schválně, aby nekolidovaly se sloupcem, který se v souboru jmenuje `chyba`.
- **Jak by to mělo být:** Převzít názvy z části 2 a v UI zmínit, že soubor obsahuje strojový kód i lidský popis.
- **Kategorie:** překryv

### [DROBNÉ] 6-11. Rozpad výsledku importu nesedí na moje čítače

- **Místo:** `06-ui-ux.md`, sekce 8.3.6, tabulka výsledku
- **Co je špatně:** „Přeskočeno, protože nemají e-mail 6" je zařazené mezi přeskočené. Část 2 počítá `email_missing` jako **chybu** (`error_rows`), ne jako `skipped_rows`, protože takový řádek se dá opravit a nahrát znovu, a proto patří do `errors.csv`.
- **Jak by to mělo být:** Sladit s čítači z DDL `imports`: `created_rows`, `updated_rows`, `skipped_rows`, `suppressed_rows`, `error_rows`, `warning_rows`, `review_rows`. Návrh části 6 je jinak dobrý a `review_rows` (kontakty, které šly do fronty ke kontrole vokativu) tam dokonce má jako samostatnou informaci.
- **Kategorie:** překryv

### [DROBNÉ] 6-12. Nepotvrzené přihlášení a pozastavení odběru nemají v seznamu kontaktů reprezentaci

- **Místo:** `06-ui-ux.md`, sekce 8.3 a dále; grep na `snooze` vrací nula výskytů, `pending` se v souvislosti se seznamem neobjevuje
- **Co chybí:** Část 2 má `list_subscriptions.status = 'pending'` (nepotvrzený double opt-in) a `snooze_until` (pozastavení odběru ze stránky preferencí). Ani jedno se v návrhu seznamu kontaktů ani detailu kontaktu neobjevuje.
- **Proč to vadí:** „Proč tenhle člověk nedostal kampaň?" je nejčastější dotaz na podporu u každého mailingového nástroje. Bez zobrazení `pending` a `snooze_until` na to uživatel nemá jak odpovědět. Segment builder má hezký prvek „Z 1 208 kontaktů je 43 odhlášených, těm se kampaň neodešle", který by se dal rozšířit o obě kategorie.
- **Jak by to mělo být:** V detailu kontaktu u každého seznamu zobrazit stav slovy („Čeká na potvrzení od 28. 7.", „Pozastaveno do 15. 9."), a v rozpadu publika kampaně je přidat jako samostatné řádky.
- **Kategorie:** mezera

### Co v části 6 sedí a nemá se měnit

Prvek „pět skutečných jmen pod počtem segmentu" je nejlepší nápad v obou recenzovaných dokumentech a řeší reálný problém, který část 2 nijak neřešila: netechnický člověk neumí ověřit logický výraz, ale pozná, jestli mezi jmény sedí ti, koho měl na mysli. Diagnostika prázdného segmentu s nabídkou „Nechtěli jste 'brno' s malým b?" je stejné ražení, jen potřebuje limity (6-8). Nahrazení AND a OR větou „splňují všechny / alespoň jednu" je správné rozhodnutí a nekoliduje s AST, protože mapování na `group.op` je jednoznačné. Krok 4 průvodce importem (náhled včetně vokativu a hotového oslovení před potvrzením) přesně odpovídá tomu, co požaduje část 2 v sekci 4.6.6, a je popsaný lépe. Vysvětlení suppression listu přímo ve výsledku importu, kde na něj uživatel narazí poprvé, je dobrý postřeh.

---

## Kde si části protiřečí v tom, kdo co vlastní

| # | Předmět | Část 2 tvrdí | Protistrana tvrdí | Návrh |
|---|---|---|---|---|
| V1 | Rollup engagementu pro segmentaci | část 5 dodá `contact_engagement` (per kontakt) | část 5: stačí `message_engagement` (per zpráva), sekce 12.4 | Doplnit `contact_engagement`. Obě tabulky mají různý účel, viz 5-1 |
| V2 | Chování statistik při výmazu | agregáty se **nemění**, 4.14.4 | režim `delete` je **přepočítá dolů**, 3.15.3 | Rozhodnout na synchronizaci, viz 5-2. Ticho je nejhorší varianta |
| V3 | Názvy režimů výmazu | `anonymize` a **`purge`** | `anonymize` a **`delete`** | Sjednotit. Hook `erase_contact(id, mode)` dnes dostane neznámou hodnotu |
| V4 | Retence událostí | per workspace přes `retention_policies` | per instance přes `TRACKING_RETENTION_MONTHS`, 3.15.1 | Globální mez plus per workspace zkrácení mazáním řádků, viz 5-4 |
| V5 | Slučování kontaktů | **neexistuje** | část 5 na něj čeká hookem `tracking.reassign_contact`, 12.2 | Rozhodnout, jestli je v MVP 0. Viz 5-3 |
| V6 | Odhlašovací a preferenční tokeny | formát vlastní část 5, potřebuju `exp = 0` | „vlastní mechanismus, jinde ověřený token", ř. 983 | Určit vlastníka. Nikdo je dnes nevlastní, viz 5-5 |
| V7 | Zápis souhlasu z web SDK | `consents` vlastní část 2, je append-only s odebranými právy | část 5 nespecifikuje, kam souhlas z SDK zapíše | Přes doménovou funkci části 2, viz 5-8 |
| V8 | Limity segmentu | 100 podmínek, hloubka 5, timeout 3 s, odhad z `EXPLAIN` | 24 podmínek, hloubka 2, práh 15 s, odhad vzorkováním | Čísla vlastní část 2, UI smí být přísnější jen vědomě a s vysvětlením, viz 6-7 |
| V9 | Kódy chyb importu | 10 souborových a 20 řádkových kódů, 4.6.11 | čtyři vlastní vymyšlené kódy, 10.2 | Kódy vlastní část 2, texty vlastní část 6, viz 6-3 |
| V10 | Vrácení importu | nepodporuje, before-images se neukládají | slibuje „Vrátit tento import" | Zúžit slib, nebo doplnit snapshoty. Viz 6-4 |
| V11 | Chování při smazání kontaktu během rozesílky | povoleno, `pending` na `skipped`, 4.9.4 | zablokováno s odůvodněním, že by kampaň spadla | Odůvodnění je věcně mimo, sender nečte kontakty. Viz 6-5 |
| V12 | Zobrazení fronty vokativu | vždy po skupinách, 4.5.2 | po jednotlivých kontaktech, 8.3.7 | Skupiny, viz 6-1 |

---

## Co z toho plyne pro část 2

Nálezy, které si beru k sobě a zapracuju bez další diskuse:

1. Doplnit funkci `getConsentState(ctx, contactId)` pro část 5 (nález 5-7) a `consents.record` pro zápis souhlasu z web SDK (5-8).
2. Doplnit endpoint `POST /api/v1/segments/diagnose` s limity pro diagnostiku prázdného segmentu (6-8).
3. Zapsat do dokumentu, že `processing_restricted` musí respektovat i tracking (5-9), jako požadavek na část 5.
4. Doplnit do požadavků na část 5 explicitní bod o tokenech s `exp = 0` (5-5).

Nálezy, které potřebují rozhodnutí orchestrátora, protože mění rozsah: V2, V3, V5, V10.
