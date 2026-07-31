# Část 4a: Kampaně, providery a doručitelnost

Vlastník: subagent part4a-kampane
Datum: 2026-07-31
Rozvíjí kapitoly hlavní specifikace: 4.2, 6.6, částečně 5 (tabulky kampaní a outboxu)
Stav: koncept

Tato část je aplikační (TypeScript) polovina původní části 4. Druhou polovinu, samotnou sender binárku v Go, vlastní část 4b. Já jsem **producent** outboxu, část 4b je jeho **konzument**.

---

## 0. Pro netechnického recenzenta

Tuhle kapitolu čtěte, i když nerozumíte kódu. Zbytek dokumentu je pro implementátory, tahle kapitola je pro rozhodování o produktu.

### 0.1 Co tahle část dělá, na konkrétním příkladu

Marketérka Jana má v nástroji 50 000 kontaktů a hotový newsletter. Klikne na tlačítko **Odeslat**. Od té chvíle se stane tohle:

1. **Nástroj se zeptá: opravdu?** Ukáže shrnutí: komu se to pošle, kolik lidí to je, z jaké adresy, jestli je odesílací doména v pořádku a jestli má účet u Amazonu dost velký denní limit. Když něco nesedí, tlačítko je zašedlé a je vidět proč.

2. **Nástroj si udělá seznam příjemců a zmrazí ho.** Tomu se říká materializace publika. Je to důležité: kdyby se seznam počítal průběžně, tak by kontakt, který se přihlásí uprostřed rozesílky, dostal mail, a kontakt, který se odhlásí, by ho možná dostal taky. Zmrazený seznam znamená, že po zmáčknutí Odeslat je definitivně jasné, kdo mail dostane. Zároveň se u každého příjemce uloží kopie jeho jména a dalších dat, která šablona používá, přesně tak, jak vypadala v okamžiku odeslání.

3. **Ze seznamu se stane fronta.** Fronta je obyčejná databázová tabulka, které říkáme outbox. Odesílací program (samostatná malá aplikace, kterou popisuje část 4b) si z ní bere práci po dávkách a maily rozesílá.

4. **Marketérka vidí živý průběh.** Odesláno 12 340 z 50 000, doručeno, otevřeno, chyby.

5. **Zpátky se sypou zprávy od Amazonu.** Tenhle mail se doručil. Tenhle se nedoručil, protože adresa neexistuje. Tenhle příjemce zmáčkl tlačítko „Tohle je spam". Každou takovou zprávu nástroj zpracuje a podle ní upraví stav.

**Co když se v půlce něco pokazí?**

- **Vypadne odesílací program nebo celý server.** Nic se neztratí. Fronta je v databázi, ne v paměti. Po nastartování se pokračuje přesně tam, kde se přestalo. Zprávy, které byly rozpracované, se po dvou minutách automaticky uvolní a zkusí znovu. Riziko je, že hrstka lidí dostane mail dvakrát, a proto je popsané, jak se tomu bráníme (kapitola 3.9).
- **Marketérka si to rozmyslí.** Může kampaň **pozastavit** a pak zase spustit. Pozastavení zabere do několika sekund, ale maily, které už odešly, se vrátit nedají. Nástroj to říká narovinu: „Pozastaveno. Odesláno 12 340 z 50 000, ty už zpátky nevezmeme."
- **Marketérka kampaň zruší.** Zbytek fronty se zahodí. Kampaň skončí ve stavu „zrušeno" a v reportu je vidět, že šla jen části publika.
- **Amazon přestane přijímat maily.** Odesílání se samo zpomalí a zkusí to znovu později. Když je problém trvalý (například zablokovaný účet), kampaň se sama pozastaví a marketérka dostane srozumitelné hlášení, ne technickou hlášku od Amazonu.
- **Někdo se uprostřed rozesílky odhlásí.** Nástroj mu do půl minuty vyškrtne ještě neodeslanou zprávu z fronty. Není to okamžité a nemůže být: půlminutové okno je vysvětlené v kapitole 3.4.

### 0.2 Klíčová rozhodnutí a co znamenají pro uživatele

| Rozhodnutí | Co to znamená pro uživatele |
|---|---|
| Publikum se zmrazí v okamžiku odeslání | Seznam příjemců se v průběhu nemění. Kdo se přihlásí o minutu později, tuhle kampaň nedostane. Je to předvídatelné a dá se to vysvětlit klientovi. |
| Data pro personalizaci se zkopírují k okamžiku odeslání | Když někdo změní jméno kontaktu uprostřed rozesílky, už rozeslané i nerozeslané maily budou mít jméno tak, jak vypadalo při zmáčknutí Odeslat. Konzistentní kampaň má přednost před aktuálností. |
| Kampaň jde pozastavit a obnovit, ale ne „vzít zpátky" | Odeslaný mail je odeslaný. Nástroj nikdy nebude předstírat, že to jde zrušit. |
| Odhlášení a stížnosti se propisují do fronty do 60 sekund | Malé okno, kdy může odejít mail někomu, kdo se právě odhlásil. Alternativa (kontrolovat každou zprávu těsně před odesláním) by odesílání výrazně zpomalila. |
| Odesílací účet je vlastní pro každý projekt | Když jeden klient pošle špatnou kampaň, nepokazí to reputaci ostatním klientům. |
| Nástroj sám blokuje odeslání, když nesedí DNS nastavení | Nepříjemné při prvním použití, ale zachrání to uživatele před tím, aby si během jednoho dne zničil odesílací účet. |
| Plánované odesílání max. rok dopředu, s hlídáním výpadku | Když server v okamžiku plánu neběžel, kampaň se do 6 hodin dožene sama. Po 6 hodinách se neodešle a čeká na rozhodnutí, protože pozvánka na akci, která už byla, nemá odejít. |

### 0.3 Doručitelnost vysvětlená laicky

Tohle je nejdůležitější část kapitoly. Pro netechnického člověka je doručitelnost neviditelná, dokud se nepokazí, a když se pokazí, je to nejdražší problém celého produktu.

**Proč vůbec řešíme, komu se mail nedoručil**

Když pošlete mail na adresu, která neexistuje, poštovní server příjemce ho odmítne. Tomu se říká **bounce** (odražený mail). Existují dva druhy:

- **Tvrdý bounce (hard bounce):** adresa neexistuje, doména neexistuje, schránka byla zrušena. Tohle se nikdy nezlepší. Na takovou adresu se už nesmí nikdy poslat.
- **Měkký bounce (soft bounce):** schránka je plná, server příjemce má dočasně výpadek, mail byl moc velký. Za týden to může fungovat.

Vedle toho existuje **stížnost (complaint)**: příjemce dostane mail a zmáčkne v Gmailu nebo Seznamu tlačítko „Nahlásit spam". Poskytovatel pošty to nahlásí zpátky Amazonu a Amazon nám.

**Co se stane, když se to zanedbá**

Amazon (a stejně tak každý jiný odesílatel) sleduje dvě čísla u vašeho účtu:

- **Bounce rate:** kolik procent vašich mailů se odrazilo natvrdo.
- **Complaint rate:** kolik procent příjemců vás nahlásilo jako spam.

Amazon má na to zveřejněné hranice, ověřené v oficiální dokumentaci k 31. 7. 2026:

| Ukazatel | Doporučená hodnota | Účet jde „pod dohled" | Amazon může odesílání zastavit |
|---|---|---|---|
| Bounce rate | pod 2 % | od 5 % | od 10 % |
| Complaint rate | pod 0,1 % | od 0,1 % | od 0,5 % |

Všimněte si těch čísel u stížností. **0,1 % znamená jednoho stěžujícího si člověka na tisíc odeslaných mailů.** To je velmi málo. Když Jana pošle kampaň na 50 000 lidí a 50 z nich zmáčkne „spam", je na hranici, kdy Amazon otevře její účet k přezkoumání.

„Účet pod dohledem" znamená, že vám Amazon pošle mail, dá vám lhůtu na nápravu a vy můžete dál posílat. „Zastavení odesílání" znamená, že vám **přestanou odcházet všechny maily, včetně těch, které s marketingem nesouvisí**. Když má firma na stejném účtu i potvrzení objednávek a reset hesla, přestane fungovat i to. Odblokování je e-mailová komunikace s podporou Amazonu, která trvá dny a nemusí dopadnout.

Proto v hlavní specifikaci stojí věta „Bez toho AWS účet zablokuje". Není to opatrnost, je to popis toho, co se stane.

**Co s tím tenhle nástroj dělá**

1. **Suppression list** (česky zhruba „seznam zakázaných adres"). Jakmile přijde tvrdý bounce nebo stížnost, adresa jde okamžitě na tenhle seznam a nástroj na ni už nikdy nic nepošle. Ani omylem, ani přes jiný seznam, ani při dalším importu. Tohle není nastavení, které by šlo vypnout.
2. **Měkké bouncy se počítají.** Tři měkké bouncy během 30 dní na tutéž adresu znamenají, že adresa jde na suppression list taky. Trvale plná schránka je v praxi mrtvá adresa.
3. **Nástroj sleduje vaše vlastní čísla** a ukazuje je na dashboardu doručitelnosti. Když se blíží hranici, řekne to dřív, než to řekne Amazon.
4. **Nástroj sám zabrzdí.** Když bounce rate kampaně překročí 8 % nebo complaint rate 0,3 %, kampaň se automaticky pozastaví a čeká na člověka. Radši nedoručená kampaň než zablokovaný účet.

**Co je sandbox**

Když si u Amazonu založíte nový odesílací účet, dostanete ho v režimu, kterému se říká **sandbox** (pískoviště). V něm platí:

- můžete poslat mail **jen na adresy, které jste si sami předem ověřili**,
- maximálně **200 mailů za 24 hodin**,
- maximálně **1 mail za sekundu**.

To je pro zkoušení, ne pro provoz. Přechod do ostrého režimu je žádost přes formulář, kde popíšete, co budete posílat a jak řešíte bouncy. Amazon obvykle odpovídá do 24 hodin.

Proč to zmiňuju tak nahlas: bez tohohle varování si uživatel naimportuje 10 000 kontaktů, zmáčkne Odeslat a diví se, že mu 9 800 mailů selhalo. Nástroj proto stav účtu čte přímo z Amazonu, ukazuje ho na viditelném místě a **při pokusu odeslat kampaň větší než zbývající denní limit odeslání nepustí**.

**Proč potřebujeme DNS záznamy**

DNS je telefonní seznam internetu. Kromě toho, kde běží web, se do něj zapisuje i to, kdo smí posílat maily za vaši doménu. Bez těch záznamů skončí vaše maily ve spamu, i když je všechno ostatní správně. Gmail a Yahoo od roku 2024 vyžadují u hromadných odesílatelů všechny tři.

Vysvětleno bez žargonu:

- **SPF** je seznam, kdo smí za vaši doménu posílat maily. Je to jako říct poště: „dopisy s mým razítkem smí podávat jen tahle firma."
- **DKIM** je elektronický podpis každého mailu. Příjemce si podle veřejného klíče v DNS ověří, že mail cestou nikdo nezměnil a že opravdu odešel od vás. Amazon vygeneruje tři záznamy, které se vloží do DNS, a od té chvíle podepisuje automaticky.
- **DMARC** říká, co má příjemce udělat s mailem, který SPF ani DKIM neprojde: nic (jen mi to nahlas), dej ho do spamu, nebo ho zahoď. Zároveň si můžete nechat posílat souhrnné reporty o tom, kdo se za vás vydává.

Nástroj má průvodce, který vygeneruje přesné hodnoty k vložení, ukáže je i s tlačítkem „zkopírovat" a pak sám kontroluje, jestli už jsou v DNS vidět. Než jsou zelené, kampaň se odeslat nedá. Propagace DNS změn může trvat až 72 hodin, obvykle jde ale o minuty až jednotky hodin.

### 0.4 Kompromisy a co znamenají pro provoz a náklady

| Kompromis | Cena | Přínos |
|---|---|---|
| Kopírujeme personalizační data ke každé zprávě | Databáze naroste. Odhad: 50 000 zpráv po zhruba 250 bajtech dat je asi 12 MB na kampaň, tedy zanedbatelné. Při milionu příjemců zhruba 250 MB na kampaň. | Odesílací program vůbec nemusí vidět do tabulky kontaktů. Když v něm bude chyba, nemůže poškodit ani přečíst kontakty. |
| Zprávy si držíme i po odeslání | Roste databáze. Řešíme automatickým mazáním po 90 dnech (nastavitelné). | Uživatel vidí u konkrétního člověka, co přesně mu bylo posláno a jak to dopadlo. |
| Automatická brzda při vysokém bounce rate | Kampaň se může zastavit uprostřed a někdo ji musí ručně pustit dál. | Ochrana účtu. Zablokovaný účet stojí dny provozu, přerušená kampaň minuty. |
| Vlastní odesílací účet na projekt | Víc nastavování při zakládání projektu. | Reputace se mezi klienty nemíchá. Jde přeúčtovat skutečné náklady. |
| Kontrolujeme DNS sami dotazy do internetu | Nástroj musí mít odchozí přístup na DNS. | Uživatel nemusí umět `dig` a nemusí věřit tomu, co mu řekl kolega. |

Provozní náklad samotného Amazonu je při psaní tohoto dokumentu v řádu jednotek dolarů za 100 000 odeslaných mailů. Dominantní náklad není odeslání, ale zablokovaný účet.

### 0.5 Otázky pro recenzenta

Na tyhle otázky nepotřebujete znát kód. Odpovědi mění produkt.

1. **Automatická brzda:** má se kampaň sama pozastavit při 8 % bounce rate, nebo má jen varovat a nechat rozhodnutí na člověku? Navrhuju pozastavit. Souhlasíte?
   **Rozhodnuto:** pozastavit při 8 %, žluté varování už při 4 %. Práh varování se posunul z původních 5 % dolů, aby zbyl prostor zasáhnout dřív, než účet přebere pod dohled Amazon. Obojí se vyhodnocuje až po `DELIVERABILITY_GUARD_MIN_SENT` předaných zprávách, viz 3.15.2.
2. **Kolik měkkých bounců znamená vyřazení adresy?** Navrhuju 3 během 30 dní. Konzervativnější je 5, agresivnější 2.
3. **Smí uživatel vzít adresu ze suppression listu ručně zpátky?** Navrhuju: u měkkých bounců a ručně přidaných ano (s potvrzením a zápisem do auditu), u tvrdých bounců a stížností ne. Tohle je hranice mezi „nástroj chrání uživatele" a „nástroj uživateli poroučí".
   **Rozhodnuto:** protinávrh části 4a se stahuje, platí verze části 2. Tvrdý odraz jde odblokovat nejdřív po 30 dnech od zápisu a vždy jen po jedné adrese, stížnost nikdy, hromadné odblokování neexistuje. Suppression list vlastní **část 2** a tato část ho nespecifikuje znovu, jen ho používá.
4. **Testovací odeslání a suppression list:** má test na vlastní adresu obejít suppression list? Navrhuju ano pro adresy vlastníka účtu, protože jinak si vývojář nezkusí nic poté, co si sám omylem nahlásil spam.
5. **Zmeškaný plán:** kampaň měla odejít v 9:00, server běžel až v 16:00. Odeslat, nebo počkat na člověka? Navrhuju hranici 6 hodin: do 6 hodin odeslat, po 6 hodinách se zeptat.
6. **Co s kampaní, u které se uprostřed ukáže, že provider je zablokovaný?** Navrhuju automatické pozastavení a jasné hlášení. Alternativa je zkoušet dál a plnit frontu chyb.
7. **Kolik dní držíme jednotlivé odeslané zprávy?** Navrhuju 90 dní pro detail zprávy, statistiky kampaně napořád. Delší retence znamená větší databázi a delší zálohy.
8. **Máme podporovat i obyčejné SMTP hned v MVP 0?** Amazon SES dává zpětnou vazbu o bouncích a stížnostech, obyčejné SMTP typicky ne. U SMTP tedy nejde suppression list plnit automaticky a uživatel má výrazně horší ochranu. Navrhuju SMTP podporovat, ale v UI výslovně varovat.

---

## 1. Rozsah

### 1.1 Co tato část vlastní

- **Kampaně:** datový model, úplný životní cyklus a stavový stroj, plánování, pauza, obnovení, zrušení, částečné odeslání.
- **Publikum:** sestavení ze seznamů a segmentů, vyloučení, deduplikace, vyloučení suppression listu, materializace do outboxu, snapshot `render_data`.
- **Outbox jako producent:** zápis řádků, jejich stavy z pohledu aplikace, dozor nad zaseknutými řádky, rušení nedoručených zpráv.
- **Providery:** `sending_providers` pro SES a SMTP, jejich konfigurace, šifrované uložení, test připojení, ověření, čtení kvót a stavu účtu.
- **Odesílací domény:** `sender_domains`, generování DKIM přes SES API, kontrola SPF, DKIM, DMARC a custom MAIL FROM dotazy do DNS, cache výsledků.
- **Příjem událostí od providera:** endpoint pro SNS, ověření podpisu, obsluha `SubscriptionConfirmation`, normalizace do `message_events`, idempotence a řešení pořadí.
- **Klasifikace bounců a stížností** a z ní plynoucí zápisy do suppression listu.
- **Doručitelnost:** výpočet bounce a complaint rate, prahy, automatické brzdy, dashboard, detekce sandboxu.
- **Politika hlaviček pro odhlášení:** co musí být v mailu, proč a odkud se to bere. Sestavení hlaviček provádí sender (část 4b), ale politiku a hodnoty určuje tato část.

### 1.2 Co vědomě nevlastní

| Oblast | Vlastník |
|---|---|
| Sender binárka: claim, Liquid interpolace, MIME, dispatch, throttling, retry, graceful shutdown | část 4b |
| Definice segmentů a jejich kompilace do SQL | část 2 |
| Kontakty, suppression list jako datová struktura, odhlášení a preference | část 2 |
| Kompilace šablony do HTML a plain textu, katalog merge tagů, validace Liquidu | část 3 |
| Trackovací tokeny, open pixel, click redirect, reporty a agregace | část 5 |
| Konvence monorepa, migrace, autentizace, API framework, chyby, webhooková infrastruktura, Docker | část 1 |

### 1.3 Kontrolní otázky ze zadání

Zodpovídám otázky **1, 2, 3, 11, 12, 14, 15, 16, 17, 18** z kapitoly „Část 4" zadání. Otázky 4 až 10, 13, 19 a 20 patří části 4b, moje stanovisko k nim je v kapitole 10.

| Otázka | Kde je odpověď |
|---|---|
| 1. Stavový diagram kampaně | 3.1 |
| 2. Materializace publika | 3.3 |
| 3. Odhlášení během odesílání | 3.4 |
| 11. Idempotence a pořadí SNS událostí | 3.9 |
| 12. Ověření podpisu SNS a SubscriptionConfirmation | 3.8 |
| 14. Klasifikace bounců | 3.10 |
| 15. Kontrola SPF, DKIM, DMARC | 3.13 |
| 16. Generování DKIM přes SES API | 3.12 |
| 17. Sandbox a kvóty | 3.14 |
| 18. Plánované odesílání | 3.5 |

### 1.4 Slovníček

| Termín | Význam v tomto dokumentu |
|---|---|
| outbox | tabulka `messages`, jediné rozhraní mezi aplikací a senderem |
| materializace | jednorázový zápis řádků do outboxu podle zmrazeného publika |
| suppression | zákaz odesílání na adresu, tabulka `suppressions` (vlastní část 2) |
| provider | konkrétní odesílací účet, řádek `sending_providers` |
| Configuration Set | pojmenovaná sada nastavení v SES, přes kterou se publikují události |
| hard bounce | `bounceType = Permanent` |
| soft bounce | `bounceType = Transient` nebo `Undetermined` |

### 1.5 Předpoklady o konvencích z části 1 a jejich sladění

Tuhle část jsem psal proti dvanácti vlastním předpokladům, protože `parts/01-platforma.md` v okamžiku začátku psaní neexistoval. **Během psaní byl publikován** a níže je vyhodnocení. Kde se dokumenty rozcházejí, **platí část 1** a moje formulace jsou opravené v příslušných kapitolách. Zbylé rozdíly jsou v kapitole 11.

| # | Můj předpoklad | Stav proti vydané části 1 |
|---|---|---|
| P1 | `uuid` s hodnotou UUIDv7 | **Potvrzeno**, ale s upřesněním: Postgres **18** a `DEFAULT uuidv7()` přímo v DB. Materializační SQL v 3.3.3 proto nemusí generovat ID v aplikaci a spoléhá na `DEFAULT`. |
| P2 | `timestamptz` všude, aplikace v UTC | **Potvrzeno.** |
| P3 | `text` + `CHECK` místo `ENUM` | **Potvrzeno.** Pojmenování je `ck_`, `idx_`, `uq_`, `fk_` a oddělovač jsou **dvě podtržítka** (`idx_campaigns__scheduler`). Přejmenoval jsem všech 21 indexů a constraintů v kapitole 2. |
| P3b | Neuvažoval jsem měkké mazání | **Doplněno.** Z mé domény je měkce mazaná **jen `campaigns`**, ostatní tabulky ne. Unikátní i běžné indexy nad ní jsou částečné s `WHERE deleted_at IS NULL`. `messages` a `message_events` se nemažou vůbec, jen jim vyprší partition. |
| P4 | `workspace_id` všude | **Potvrzeno.** |
| P5 | Vlastní tvar chybové odpovědi | **Neplatí.** Část 1 používá **RFC 9457 Problem Details**, rozhodovací pole je `code`, korelační `request_id`. Navíc jsem po revizi **zrušil pět vlastních kódů** (`campaign_not_found`, `campaign_invalid_transition`, `domain_check_rate_limited`, `test_rate_limited`, vlastní `quota_exceeded`) ve prospěch obecných z katalogu části 1. Zbylé vlastní kódy mají v 4.1.2 sloupec „proč nestačí obecný", protože kód, podle kterého UI nedělá nic jiného, být nemá. |
| P6 | Prefix `` u konfiguračních proměnných | **Neplatí.** Část 1 používá proměnné **bez prefixu** (`APP_URL`, `MODE`, `SENDER_BATCH_SIZE`, `DATABASE_POOL_MAX`). Tabulku v 4.6 jsem přepsal bez prefixu. |
| P7 | AES-256-GCM s HKDF | **Potvrzeno v principu, upřesněno v detailu.** Část 1: `K_<purpose> = HKDF(SHA-256, ikm = MASTER, salt = ASCII "mailer/v1", info = <purpose>, L = 32)`, pro credentials `info = "mailer/v1/credential-encryption"`. Podporuje se rotace přes `SECRET_KEY_PREVIOUS` s `key_id`. |
| P8 | Webhooková infrastruktura patří části 1 | **Potvrzeno.** |
| P9 | pg-boss se `singletonKey` | **Potvrzeno.** |
| P10 | Audit log jako služba | **Potvrzeno.** |
| P11 | SNS endpoint vyjmutý z rate limitingu a CSRF | **K potvrzení**, viz požadavek R1.6. |
| P12 | Partitioning zajišťuje část 1 | **Potvrzeno.** |

**Nejdůležitější sladění: outbox.** Část 1 vydala kontrakt 1 v normativní podobě (sekce 4.10.1). Rozdíly proti mému původnímu návrhu a jak je řeším:

| Věc | Můj původní návrh | Část 1 (platí) | Co jsem změnil |
|---|---|---|---|
| Chybová pole | `error jsonb` | `error_code text`, `error_detail text` | Používám `error_code` a `error_detail`. Strukturovaná data, která jsem chtěl v `error`, jdou do `error_detail` jako text. |
| Vypršení claimu | `claimed_at` + timeout v aplikaci | `claim_expires_at` počítaný senderem z `SENDER_CLAIM_TTL_SECONDS` (300 s) | Zrušil jsem vlastní `OUTBOX_CLAIM_TIMEOUT_SECONDS`. |
| Reaper | job v aplikaci (`outbox.reap`) | **běží v senderu**, podmíněný `dispatch_started_at IS NULL` | Job `outbox.reap` z aplikace **odstraněn**, viz 3.7.3. |
| Typ `email` | `citext` | `text` | Používám `text`, porovnání dělám přes `lower()`. |
| Unikátní index | `(campaign_id, contact_id)` na partition | `uq_messages__campaign_contact (campaign_id, contact_id, created_at)` na partitionované tabulce | Moje pravidlo „jedno `created_at` na celou kampaň" (2.4) je s tímhle indexem **plně kompatibilní** a je nutné k tomu, aby index skutečně bránil duplicitám. |
| Zrušení kampaně | `pending → skipped` | **dnes také `pending → skipped`**, řádek `pending → failed` pro zrušení kampaně z kontraktu zmizel a přibyl scénář `OB-14` | Nic neměním, rozpor 11.6 je **uzavřený**. |
| Kontrola suppression před odesláním | dělá jen aplikace | část 1 povoluje i `claimed → skipped` senderem | Vítám. Zmenšuje to okno z 3.4.3. Zapsáno jako požadavek R4b.13. |
| Sloupce navíc | – | `dispatch_started_at`, `updated_at` | Přebírám beze změny, jsou senderovy. |
| `attempts` | `int` | **`smallint`** | Opraveno. Při milionu řádků na kampaň se dva bajty počítají. |
| Opis DDL | plné DDL v mé kapitole 2.4 | část 1 žádá **odkaz, ne kopii** | Kapitolu 2.4 jsem zkrátil na shrnující tabulku toho, co z kontraktu potřebuju, plus dva vlastní indexy. Dva popisy outboxu jsou horší než jeden. |

---

## 2. Datový model

Veškeré DDL je psané pro poslední produkční verzi PostgreSQL, dnes **18** (rozhodnutí zadavatele, pravidlo viz část 1, kapitola 2.1). Dřívější znění tady uvádělo 17, což neodpovídalo ani rozhodnutí, ani vlastní kapitole 11.7 téhle části. Zdrojem pravdy je Drizzle schéma v `packages/db`, tohle je jeho čitelný zápis.

### 2.1 `sending_providers`

Odesílací účet. Právě jeden je v projektu výchozí.

```sql
CREATE TABLE sending_providers (
  id                  uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id        uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name                text NOT NULL,
  -- 'ses' | 'smtp'. Uzavřený výčet schválně, ale ne navždy: MVP 2 slibuje
  -- pluginové providery a rozšíření je jednořádková migrace. Aplikační kód proto
  -- nesmí s vyčerpaností výčtu počítat, viz 3.11.
  type                text NOT NULL,
  config_encrypted    text NOT NULL,                     -- viz P7, obálka AES-256-GCM
  config_public       jsonb NOT NULL DEFAULT '{}'::jsonb,-- necitlivá část, viz 2.1.1
  is_default          boolean NOT NULL DEFAULT false,
  status              text NOT NULL DEFAULT 'unverified',-- viz 3.11
  status_detail       jsonb,                             -- poslední chyba nebo výsledek testu
  verified_at         timestamptz,
  -- zrcadlo stavu účtu, plněné jobem provider.refresh_quota
  quota_max_24h       integer,
  quota_max_send_rate numeric(10,2),
  quota_sent_24h      integer,
  production_access   boolean,
  enforcement_status  text,                              -- HEALTHY | PROBATION | SHUTDOWN
  sending_enabled     boolean,
  quota_checked_at    timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_sending_providers__type
    CHECK (type IN ('ses','smtp')),
  CONSTRAINT ck_sending_providers__status
    CHECK (status IN ('unverified','verifying','ready','degraded','blocked','disabled'))
);

-- Právě jeden výchozí provider na projekt. Částečný unikátní index je levnější než trigger.
CREATE UNIQUE INDEX uq_sending_providers__one_default
  ON sending_providers (workspace_id) WHERE is_default;

-- Výpis providerů v nastavení projektu.
CREATE INDEX idx_sending_providers__workspace
  ON sending_providers (workspace_id, created_at DESC);

-- Job provider.refresh_quota hledá providery s nejstarší kontrolou kvóty.
CREATE INDEX idx_sending_providers__quota_stale
  ON sending_providers (quota_checked_at NULLS FIRST)
  WHERE status IN ('ready','degraded');
```

#### 2.1.1 Obsah `config_encrypted` a `config_public`

`config_encrypted` je `text` ve tvaru `enc:v1:<base64>` podle kontraktu 4 části 1, s kontextem `sending_provider` a `workspace_id` v AAD. Šifruje aplikace, dešifruje aplikace i sender.

**Šifrovaný obsah je kompletní konfigurace, ne jen tajemství.** Původně jsem chtěl mít necitlivá pole zvlášť, ale sender by je pak musel skládat ze dvou zdrojů a hrozilo by, že se rozejdou. `config_public` je proto **odvozená kopie pro UI a preflight**, kterou aplikace přepisuje při každém zápisu ze stejného vstupu. Zdrojem pravdy je šifrovaná obálka.

Klíče jsou `snake_case`, protože JSON čte TypeScript i Go a `snake_case` je jediný tvar, který se v Go nemusí anotovat.

```ts
// Dešifrovaný obsah config_encrypted. Pole "kind" je rozlišovač.
type SesConfig = {
  kind: 'ses';
  region: string;                    // 'eu-central-1'
  access_key_id: string;
  secret_access_key: string;
  configuration_set_name: string;    // 'mlain-<workspace_slug>'
  sns_topic_arn: string | null;
  max_send_rate: number;             // zrcadlo kvóty, viz níže
  max_24h_send: number | null;
};

type SmtpConfig = {
  kind: 'smtp';
  host: string;
  port: number;                      // 587 | 465 | 25 | 2525
  username: string;
  password: string;
  encryption: 'starttls' | 'tls' | 'none';
  max_send_rate: number;             // výchozí 10, rozsah 1 až 500
  max_connections: number;           // výchozí 5, rozsah 1 až 50
  max_messages_per_connection: number; // výchozí 100, rozsah 1 až 10000
};

// Odvozená necitlivá kopie, sender ji nečte.
type ProviderPublicConfig =
  | { kind: 'ses'; region: string; configuration_set_name: string;
      sns_topic_arn: string | null; access_key_id_masked: string }  // 'AKIA****ABCD'
  | { kind: 'smtp'; host: string; port: number; encryption: string; username_masked: string };
```

**Poznámka k `max_send_rate`.** Uvnitř šifrované konfigurace je jen **výchozí a záložní hodnota**. Pro SES je závazným zdrojem sloupec `sending_providers.quota_max_send_rate`, který aktualizuji každých 15 minut z `GetAccount` (3.14.2). Sender čte sloupec, ne obálku; obálku použije jen tehdy, když je sloupec `NULL` (provider ještě nebyl ověřen). Kvůli tomu, aby se rate měnil bez přešifrovávání.

### 2.2 `sender_domains`

```sql
CREATE TABLE sender_domains (
  id                 uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id       uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider_id        uuid NOT NULL REFERENCES sending_providers(id) ON DELETE CASCADE,
  domain             text NOT NULL,             -- lowercase, bez trailing tečky, bez "www."
  -- DKIM
  dkim_tokens        text[] NOT NULL DEFAULT '{}',   -- 3 tokeny z SES CreateEmailIdentity
  dkim_hosted_zone   text,                           -- DkimAttributes.SigningHostedZone
  dkim_key_length    text NOT NULL DEFAULT 'RSA_2048_BIT',
  dkim_status        text NOT NULL DEFAULT 'not_started',
  -- custom MAIL FROM (nepovinné, ale doporučené kvůli SPF alignmentu)
  mail_from_subdomain text,                          -- např. 'mail' -> mail.example.com
  mail_from_status    text NOT NULL DEFAULT 'not_configured',
  -- výsledky vlastních DNS kontrol
  spf_ok             boolean,
  dkim_ok            boolean,
  dmarc_ok           boolean,
  mx_ok              boolean,
  checks             jsonb NOT NULL DEFAULT '{}'::jsonb,  -- detaily, viz 3.13.5
  checked_at         timestamptz,
  next_check_at      timestamptz,
  ses_verification_status text,                      -- PENDING|SUCCESS|FAILED|TEMPORARY_FAILURE|NOT_STARTED
  verified_at        timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_sender_domains__dkim_status
    CHECK (dkim_status IN ('not_started','pending','success','failed','temporary_failure')),
  CONSTRAINT ck_sender_domains__mail_from_status
    CHECK (mail_from_status IN ('not_configured','pending','success','failed'))
);

-- Doména je v projektu jen jednou. Dva providery se stejnou doménou dávají smysl jen v migraci,
-- a tu řešíme smazáním a založením, ne souběhem.
CREATE UNIQUE INDEX uq_sender_domains__workspace_domain
  ON sender_domains (workspace_id, lower(domain));

-- Job domain.recheck bere domény, kterým vypršel next_check_at.
CREATE INDEX idx_sender_domains__next_check
  ON sender_domains (next_check_at) WHERE next_check_at IS NOT NULL;
```

### 2.3 `campaigns`

```sql
CREATE TABLE campaigns (
  id                uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id      uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name              text NOT NULL,
  status            text NOT NULL DEFAULT 'draft',
  -- obsah a odesílatel
  subject           text NOT NULL DEFAULT '',
  preheader         text NOT NULL DEFAULT '',
  from_name         text NOT NULL DEFAULT '',
  from_email        text NOT NULL DEFAULT '',   -- normalizováno na lowercase při zápisu
  reply_to          text,
  template_id       uuid REFERENCES templates(id) ON DELETE SET NULL,
  design            jsonb,                    -- kopie blokového JSON z části 3
  compiled_html     text,                     -- výstup fáze 1 renderu
  compiled_text     text,
  compiled_at       timestamptz,
  compiled_fields   text[] NOT NULL DEFAULT '{}',  -- merge tagy, které šablona používá
  compiled_hash     text,                     -- sha256 z (design, subject, preheader), viz 3.2
  -- publikum
  audience          jsonb NOT NULL DEFAULT '{"include":{"lists":[],"segments":[]},"exclude":{"lists":[],"segments":[]}}'::jsonb,
  audience_size     integer,                  -- výsledek posledního náhledu
  audience_built_at timestamptz,              -- okamžik zmrazení, je i created_at všech messages
  -- odesílání
  provider_id       uuid REFERENCES sending_providers(id) ON DELETE RESTRICT,
  sender_domain_id  uuid REFERENCES sender_domains(id) ON DELETE RESTRICT,
  track_opens       boolean NOT NULL DEFAULT true,
  track_clicks      boolean NOT NULL DEFAULT true,
  unsubscribe_list_id uuid REFERENCES lists(id) ON DELETE SET NULL, -- pro token, NULL = globální odhlášení
  revision          integer NOT NULL DEFAULT 1,   -- klíč cache senderu, viz 3.7.4
  release_at        timestamptz,                  -- undo okno, viz 3.6.4
  -- plánování
  scheduled_at      timestamptz,
  schedule_timezone text,                     -- IANA, např. 'Europe/Prague'
  -- průběh, denormalizované čítače, viz 3.7
  total_count       integer NOT NULL DEFAULT 0,
  sent_count        integer NOT NULL DEFAULT 0,
  failed_count      integer NOT NULL DEFAULT 0,
  skipped_count     integer NOT NULL DEFAULT 0,
  bounce_count      integer NOT NULL DEFAULT 0,
  complaint_count   integer NOT NULL DEFAULT 0,
  delivered_count   integer NOT NULL DEFAULT 0,
  -- stavové značky
  started_at        timestamptz,
  finished_at       timestamptz,
  paused_at         timestamptz,
  -- KONTRAKTNÍ SLOUPEC (část 1, 4.10.1). Typ je jsonb, ne text, protože do něj
  -- zapisuje i sender a potřebuje vedle kódu předat i zdroj, čas a svoje ID.
  -- Závazný tvar objektu a registr kódů jsou v 3.6.1.
  pause_reason      jsonb,
  cancel_reason     text,
  last_error        jsonb,
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  deleted_at        timestamptz,          -- měkké mazání, viz níže
  CONSTRAINT ck_campaigns__status CHECK (status IN (
    'draft','scheduled','queueing','sending','paused',
    'sent','partially_sent','cancelled','failed','schedule_missed'
  )),
  CONSTRAINT ck_campaigns__schedule CHECK (
    (status <> 'scheduled') OR (scheduled_at IS NOT NULL AND schedule_timezone IS NOT NULL)
  )
);

-- Seznam kampaní v projektu, řazený podle poslední změny. Smazané se nezobrazují.
CREATE INDEX idx_campaigns__workspace_status
  ON campaigns (workspace_id, status, updated_at DESC) WHERE deleted_at IS NULL;

-- Plánovač: hledá jen kampaně čekající na svůj čas. Částečný index drží skenování v jednotkách řádků.
CREATE INDEX idx_campaigns__scheduler
  ON campaigns (scheduled_at) WHERE status = 'scheduled' AND deleted_at IS NULL;

-- Dozorce běžících kampaní (job campaign.watchdog).
CREATE INDEX idx_campaigns__running
  ON campaigns (workspace_id) WHERE status IN ('queueing','sending') AND deleted_at IS NULL;

-- `campaigns` je podle konvence části 1 měkce mazaná, ostatní tabulky této části ne.
-- Zdůvodnění: smazání kampaně nesmí zahodit historii toho, co komu bylo posláno.
-- `messages` a `message_events` se nemažou vůbec, jen jim vyprší partition (3.18).
-- Claim dotaz z kontraktu 1 měkce smazané kampaně nefiltruje, proto smazání kampaně
-- ve stavu `sending` musí nejdřív projít `cancel`. Vynucuje to API, viz 3.6.3.
```

#### 2.3.1 Rezerva pro varianty obsahu (MVP 1, DDL kvůli dopředné kompatibilitě)

Obsah kampaně je dnes v pěti skalárních sloupcích přímo na `campaigns` (`subject`, `preheader`, `from_name`, `from_email`, `reply_to`, plus `design` a `compiled_*`). Jedna kampaň má tedy právě jednu verzi obsahu a **A/B test z MVP 1 se do toho modelu nevejde**: potřebuje dvě znění předmětu nebo dvě šablony u téže kampaně a u každé zprávy záznam, které znění dostala.

**Rozhodnutí zadavatele: rezerva se zakládá teď a zůstane prázdná.** Důvody jsou dva a oba jsou precedenční, ne teoretické. Projekt už jednou rozhodl stejně u tabulky `content_snippets` v části 3 (2.5: „V MVP 0 se tabulka založí, ale UI ji nepoužívá. Je tu proto, aby se pak nemuselo migrovat `design`."). A migrace je podle vlastní specifikace tohohle projektu nejrizikovější operace u self-hosted instalací, kde aktualizuje zákazník, kdy chce, a rollback neexistuje. Přidat prázdný nepovinný sloupec dnes stojí jeden `ALTER TABLE` bez přepisu dat; přidat ho za rok do tabulky s desítkami milionů řádků je něco jiného.

```sql
-- MVP 1. V MVP 0 se tabulka založí a zůstane prázdná, UI ji nepoužívá.
CREATE TABLE campaign_content_variants (
  id            uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id  uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id   uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  label         text NOT NULL,              -- 'A', 'B', ... pro report
  weight        smallint NOT NULL DEFAULT 1,-- poměr rozdělení publika
  -- Přepisy obsahu. NULL znamená "ber hodnotu ze sloupce kampaně".
  subject       text,
  preheader     text,
  from_name     text,
  design        jsonb,
  compiled_html text,
  compiled_text text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX uq_campaign_content_variants__campaign_label
  ON campaign_content_variants (campaign_id, label);
```

`messages` k tomu dostane **nepovinný odkaz na variantu** (`content_variant_id`, DDL v 2.4) a platí jediné pravidlo:

> **Prázdná hodnota `messages.content_variant_id` znamená „ber obsah ze sloupců kampaně".**

V MVP 0 je prázdný vždy, protože varianty nikdo nezakládá. Materializační `INSERT` v 3.3.3 sloupec vůbec neuvádí a nechává na něm `DEFAULT NULL`. **Chování se tedy nemění a Go strana se nemění taky:** sender čte hlavičku kampaně přesně jako dnes a větev „zpráva má variantu" v MVP 0 nikdy nenastane. Až přijde MVP 1, přibude senderu jedna podmínka a jeden `COALESCE`, ne migrace outboxu.

Pravidlo musí být v kontraktu, ne jen tady, protože ho čte Go strana a bez něj by si dvě implementace vyložily prázdnou hodnotu každá jinak. **Vyžádáno jako R1.16 na část 1**, sám do kontraktu nesahám.

### 2.4 `messages`, outbox

**Kontraktní podmnožinu (sloupce, stavy, přechody, claim dotaz, heartbeat, reaper) vlastní část 1, sekce 4.10.1, a tento dokument ji vědomě neopisuje.** Dva různé popisy outboxu jsou horší než jeden, a kdyby se rozešly, rozejdou se i implementace. Tabulku jako celek vlastním já, takže tady je jen to, co k ní přidávám.

Z kontraktu je pro tuto část podstatné, a proto to shrnuju jednou větou na položku:

| Věc | Hodnota z kontraktu | Proč mě zajímá |
|---|---|---|
| Stavy | `pending | claimed | sent | failed | skipped` | mapuju je na čítače a UI |
| Primární klíč | `(id, created_at)` | **každý můj `UPDATE` a každý odkaz na zprávu musí nést i `created_at`**, jinak se prohledají všechny partition |
| Partitioning | `RANGE (created_at)`, měsíčně, partition zakládá část 1 tři měsíce dopředu | nestarám se o ně, jen o mazání starých (3.18) |
| Chybová pole | `error_code text`, `error_detail text` | podle `error_code` filtruju a agreguju v reportu |
| Unikátnost publika | `uq_messages__campaign_contact (campaign_id, contact_id, created_at)` | idempotence materializace, viz invariant níže |
| Přechody, které dělám já | `(vznik) → pending`, `pending → skipped` | vše ostatní dělá sender |

Sloupce ani jejich sémantiku neměním. Přidávám **jeden vlastní sloupec** a dva indexy, které kontrakt nemá a aplikační strana bez nich nefunguje.

```sql
-- Rezerva pro varianty obsahu (A/B test, MVP 1). Viz 2.3.1.
-- V MVP 0 je vždy NULL, materializace ho v INSERTu vůbec neuvádí.
-- Prázdná hodnota znamená "ber obsah ze sloupců kampaně".
ALTER TABLE messages
  ADD COLUMN content_variant_id uuid REFERENCES campaign_content_variants(id) ON DELETE SET NULL;
```

Kontrakt přidávání sloupců výslovně dovoluje („Část 4 smí přidávat sloupce a indexy"), takže tenhle sloupec sám o sobě změnu kontraktu nevyžaduje. **Vyžaduje ji ale pravidlo o prázdné hodnotě**, protože podle něj se rozhoduje Go strana. Zapsáno jako R1.16.

```sql
-- Párování příchozích událostí od providera na zprávu (3.9.4).
-- Bez něj je zpracování každé SNS události sekvenční sken partition.
CREATE INDEX idx_messages__provider_message_id
  ON messages (provider_message_id) WHERE provider_message_id IS NOT NULL;

-- Vyškrtnutí pending zpráv při odhlášení nebo suppression konkrétní adresy (3.4.1).
-- Bez něj by odhlášení jednoho člověka skenovalo celou kampaň.
CREATE INDEX idx_messages__ws_email_pending
  ON messages (workspace_id, lower(email)) WHERE status = 'pending';
```

**Poznámka k `email text` místo `citext`.** Kontrakt používá `text`, protože Go strana nemá pro `citext` nativní typ. Aplikace proto při porovnávání adres vždy používá `lower(email)` a index výše je funkcionální. Normalizaci na malá písmena provádí materializace, takže hodnoty v tabulce jsou už normalizované a `lower()` je jen pojistka.

**Proč je `created_at` v primárním klíči a v unikátním indexu.** Postgres vyžaduje, aby unikátní index na partitionované tabulce obsahoval partition key. Bez `created_at` v `uq_messages__campaign_contact` by index nešel vytvořit, a bez něj by materializace nebyla idempotentní.

**Invariant I1, bez kterého ten index nefunguje.** Protože `created_at` je součástí klíče, dva řádky se stejnou dvojicí `(campaign_id, contact_id)`, ale různým `created_at`, index **nezachytí**. Proto platí tvrdé pravidlo:

> **Všechny řádky, které vytvoří jeden materializační běh jedné dávkové (batch) kampaně, mají `created_at` nastavené na jednu jedinou hodnotu, a to `campaigns.audience_built_at` té kampaně.**

Materializace tedy nikdy nepřeteče přes hranici měsíce ani nevygeneruje dva různé časy, i kdyby běžela hodinu nebo se restartovala. `audience_built_at` se nastavuje jednou při přechodu do `queueing` (`COALESCE`, takže opakování ho nezmění) a nikdy se nemění. Sender `created_at` nikdy nepřepisuje.

**Formulace je úzká schválně a dřív úzká nebyla.** Předchozí znění mluvilo o „všech řádcích jedné kampaně" a působilo jako obecná vlastnost tabulky `messages`. Kdyby se v té podobě dostalo do zmrazeného kontraktu, změnilo by se lokální rozhodnutí o dávkových kampaních v celoproduktové pravidlo, které **zakazuje opakované a průběžné kampaně**: automatizace, drip sekvence a transakční proud jsou přesně ty případy, kde jedna logická kampaň produkuje zprávy průběžně po měsíce a jedno `created_at` na ně dát nejde ani teoreticky. Invariant je vlastnost **jednoho materializačního běhu batch kampaně**, ne tabulky.

**Jak se série a opakování řeší, až přijdou.** Ne rozvolněním invariantu, ale novými řádky v `campaigns`: každé spuštění nebo každý běh série je vlastní řádek `campaigns` s odkazem na rodiče (například `parent_campaign_id`, sloupec dnes neexistuje a zavede ho ta funkce, která ho bude potřebovat). Každý takový řádek má vlastní `audience_built_at` a invariant pro něj platí beze změny, jen se týká jeho vlastních zpráv. Report série je pak agregace přes rodiče. Tahle cesta je navíc nutná i z jiného důvodu: čítače, `revision` a neměnnost obsahu během odesílání jsou v 3.7 definované na řádku kampaně, takže dvě spuštění pod jedním řádkem by si je přepisovala navzájem.

Invariant je v kontraktu části 1 (4.10.1) už zapsaný, viz R1.11.

**Sender nikdy nemaže řádky.** Mazání dělá retenční job aplikace (3.18) odpojením partition.

### 2.5 `message_events`

```sql
CREATE TABLE message_events (
  id                 uuid NOT NULL DEFAULT uuidv7(),
  workspace_id       uuid NOT NULL,
  message_id         uuid NOT NULL,
  message_created_at timestamptz NOT NULL,  -- druhá složka PK zprávy, viz níže
  campaign_id        uuid NOT NULL,
  contact_id         uuid NOT NULL,
  recipient          text NOT NULL,         -- adresa v okamžiku odeslání, denormalizovaná
  type               text NOT NULL,         -- viz katalog 3.9.2
  rank               smallint NOT NULL,     -- rank z 3.9.2, řeší pořadí bez lookupu
  ts                 timestamptz NOT NULL,  -- čas události u providera, běžný sloupec
  received_at        timestamptz NOT NULL DEFAULT now(),  -- partition key, viz níže
  source             text NOT NULL,         -- 'ses_sns' | 'smtp' | 'internal' | 'tracking'
  metadata           jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (id, received_at)
) PARTITION BY RANGE (received_at);

-- Timeline jedné zprávy. Obě složky klíče zprávy, aby šlo z události skočit na zprávu
-- jedním přístupem do jedné partition.
CREATE INDEX idx_message_events__message
  ON message_events (message_id, message_created_at, ts);
-- Report kampaně.
CREATE INDEX idx_message_events__campaign_type ON message_events (campaign_id, type, ts);
-- Timeline kontaktu (konzumuje část 5).
CREATE INDEX idx_message_events__contact ON message_events (contact_id, ts DESC);
-- Rozhodování o suppression podle historie adresy (3.10.2). Bez tohoto indexu
-- by se počítání soft bounců muselo joinovat na messages přes obě partition.
CREATE INDEX idx_message_events__recipient_bounce
  ON message_events (workspace_id, lower(recipient), ts)
  WHERE type IN ('bounced_soft','bounced_hard','complained');
```

Tabulka je **append only**. Stav zprávy se z ní odvozuje, ale zpětně se nikdy nepřepisuje.

**Partition key je `received_at`, ne `ts`.** Tabulka nese dva časy a rozdíl mezi nimi je zásadní: `ts` je okamžik, kdy událost nastala u providera, `received_at` okamžik, kdy dorazila k nám. Partitionuje se **jen podle `received_at`**, jak předepisuje konvence části 1.

Původně jsem partitionoval podle `ts` a byla to chyba: `ts` je hodnota od třetí strany, nad kterou nemáme kontrolu. SES pošle zpožděný bounce s časovou značkou mimo existující okno, nebo dorazí událost ze serveru se špatně nastavenými hodinami, a protože se výchozí partition vědomě nezakládá, **zápis tvrdě selže a informace o doručení se ztratí**. `received_at` je vždy `now()`, tedy monotónní a vždy uvnitř existujícího okna.

`ts` zůstává běžným indexovaným sloupcem a řadí se podle něj timeline, protože reporty zajímá čas události, ne čas zápisu.

**Proč je tu `message_created_at` a `recipient`.** Primární klíč `messages` je `(id, created_at)`, takže odkaz jen přes `message_id` je neúplný a každý skok z události na zprávu by prohledal všechny partition. Obě denormalizovaná pole se zapisují při vzniku události, jsou neměnná a stojí 24 bajtů na řádek. Alternativa (dohledávat je pokaždé) by u desítek milionů událostí byla řádově dražší.

`recipient` je adresa v okamžiku odeslání, ne aktuální adresa kontaktu. Když si kontakt změní e-mail, historická událost dál ukazuje, kam skutečně odešla. Při GDPR výmazu se anonymizuje spolu s `messages.email` (R2.5). **Anonymizace místo smazání řádku je návrhové řešení, které podléhá právnímu posouzení**: otevřená otázka O11 ho vede jako čekající na právníka a ten může rozhodnout, že se řádky musí mazat. Do té doby platí tenhle návrh, ale nesmí se citovat jako uzavřené pravidlo.

#### 2.5.1 Úplný soupis dvousložkových odkazů v této části

Konvence části 1 zní: **každý odkaz na řádek partitionované tabulky nese obě složky klíče**, ať jde o sloupec v jiné tabulce, pole v API odpovědi, payload webhooku nebo argument jobu. Pojmenování je `<entita>_<partitioning_sloupec>`.

Je to nejsnáz přehlédnutelná konvence z celého balíku, protože `WHERE id = $1` vypadá jako správný dotaz a projeví se to až na objemu dat. Uvádím proto úplný soupis, aby šlo zkontrolovat jedním pohledem. Pozor na past: **partitioning sloupec se u každé tabulky jmenuje jinak**, takže i denormalizovaný odkaz má pokaždé jiný název.

| Cílová tabulka | Partitioning sloupec | Odkaz se jmenuje | Kde všude ho nesu |
|---|---|---|---|
| `messages` | `created_at` | `message_created_at` | `message_events`, `provider_event_receipts`, payload webhooků `message.*`, odpověď `GET /campaigns/{id}/messages`, argument jobu `provider_event.process` |
| `message_events` | `received_at` | `message_event_received_at` | zatím nikde, tabulka nemá příchozí odkazy. Kdyby část 5 potřebovala odkázat na konkrétní událost, musí nést tenhle sloupec, ne `ts`. |
| `provider_event_receipts` | `received_at` | `provider_event_received_at` | zatím nikde, používá se jen interně |

Dvě věci, které z toho plynou a snadno se přehlédnou:

- U `message_events` je partitioning sloupec `received_at`, **ne `ts`**. Odkaz se tedy jmenuje `message_event_received_at`, i když by se podle sémantiky nabízelo `ts`. Kdo by odkazoval přes `ts`, minul by partition.
- V payloadu webhooku je to `data.message.created_at` a v odpovědi API `messages[].created_at`, tedy struktura místo plochého sloupce. Konvenci to splňuje, protože obě složky jsou přítomné; plochý název `message_created_at` se používá jen tam, kde jde o sloupec v tabulce.

### 2.6 `provider_event_receipts`

Deduplikační tabulka pro příchozí události. Její jedinou funkcí je zaručit, že se tatáž událost nezpracuje dvakrát.

```sql
CREATE TABLE provider_event_receipts (
  id             uuid NOT NULL DEFAULT uuidv7(),
  workspace_id   uuid NOT NULL,
  provider_id    uuid NOT NULL,
  dedup_key      text NOT NULL,        -- viz 3.9.1
  sns_message_id text,
  event_type     text NOT NULL,
  message_id         uuid,             -- vyplní se po spárování (3.9.4)
  message_created_at timestamptz,      -- druhá složka PK zprávy, bez ní je odkaz k ničemu
  received_at    timestamptz NOT NULL DEFAULT now(),  -- partition key
  processed_at   timestamptz,
  status         text NOT NULL DEFAULT 'received',  -- received | processed | unmatched | invalid
  raw            jsonb NOT NULL,       -- celé tělo pro dohledání, mazané retencí
  PRIMARY KEY (id, received_at)
) PARTITION BY RANGE (received_at);

-- Dedup. POZOR: received_at v indexu je vynucené, ne volba. Unikátní index na
-- partitionované tabulce MUSÍ obsahovat partiční klíč, jinak ho Postgres odmítne
-- vytvořit. Totéž pravidlo tenhle dokument správně uvádí u uq_messages__campaign_contact
-- (2.4) a u uq_message_events__once_per_message (3.9.1); tady chybělo a index by
-- migraci položil. Navazující ON CONFLICT (workspace_id, dedup_key) by navíc na
-- rodičovské tabulce skončil chybou "there is no unique or exclusion constraint
-- matching the ON CONFLICT specification".
CREATE UNIQUE INDEX uq_provider_event_receipts__dedup
  ON provider_event_receipts (workspace_id, dedup_key, received_at);

-- Fronta nespárovaných událostí (událost dorazila dřív, než sender zapsal provider_message_id).
CREATE INDEX idx_provider_event_receipts__unmatched
  ON provider_event_receipts (received_at)
  WHERE status = 'unmatched';
```

**Co z `received_at` v unikátním indexu plyne pro dedup.** `received_at` je `now()`, tedy u každého doručení jiné. Samotný `ON CONFLICT` by proto **nikdy nesepnul** a dedup by fyzicky neexistoval. Skutečnou deduplikaci dělá explicitní `WHERE NOT EXISTS` nad prefixem indexu `(workspace_id, dedup_key)`, omezený na aktuální oddíl, a `ON CONFLICT` zůstává jen jako pojistka proti dvěma workerům ve stejné mikrosekundě. Dotaz je v 3.9.1.

**Dedup tedy platí uvnitř oddílu**, tedy v rámci kalendářního měsíce. Pro SNS to stačí: okno opakovaných doručení téže publikované zprávy je řádově minuty až hodiny, takže obě kopie skoro vždy padnou do stejného měsíce. **Přes hranici měsíce zajišťuje dedup druhá vrstva**, `content_key` z 3.9.1, která se vyhodnocuje uvnitř jobu `provider_event.process` a na oddíly se neváže vůbec. Je to stejná konstrukce jako u `uq_message_events__once_per_message` a stejné zdůvodnění.

### 2.7 `campaign_links`

Odkazy vytažené z kompilované šablony. Sender je používá při přepisu odkazů, část 5 je používá v reportech.

```sql
CREATE TABLE campaign_links (
  id           uuid PRIMARY KEY DEFAULT uuidv7(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  campaign_id  uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  url          text NOT NULL,          -- původní URL, může obsahovat Liquid
  position     integer NOT NULL,       -- pořadí výskytu v HTML, od 0
  label        text,                   -- text odkazu, pro čitelnost reportu
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Sender načte všechny odkazy kampaně jednou na začátku dávky.
CREATE UNIQUE INDEX uq_campaign_links__campaign_position
  ON campaign_links (campaign_id, position);
```

### 2.8 `deliverability_snapshots`

Denní zrcadlo doručitelnosti pro dashboard a pro varování. Bez něj by dashboard počítal agregace přes `message_events` při každém načtení.

```sql
CREATE TABLE deliverability_snapshots (
  workspace_id     uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider_id      uuid NOT NULL REFERENCES sending_providers(id) ON DELETE CASCADE,
  day              date NOT NULL,
  sent             integer NOT NULL DEFAULT 0,
  delivered        integer NOT NULL DEFAULT 0,
  hard_bounces     integer NOT NULL DEFAULT 0,
  soft_bounces     integer NOT NULL DEFAULT 0,
  complaints       integer NOT NULL DEFAULT 0,
  rejects          integer NOT NULL DEFAULT 0,
  delivery_delays  integer NOT NULL DEFAULT 0,
  computed_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, provider_id, day)
);
```

Plní ho job `deliverability.rollup` každých 15 minut pro dnešní a včerejší den, protože události dobíhají zpožděně.

Sloupec `sent` se počítá z `messages` (kolik jsme jich předali provideru), **všechny ostatní sloupce z `message_events`**. Rollup tedy sahá do dvou tabulek a nikdy neodvozuje doručení ze `status`:

```sql
-- sent: kolik zpráv jsme v daný den předali provideru
SELECT count(*) FROM messages
 WHERE workspace_id = $ws AND sent_at::date = $day AND status = 'sent';

-- zbytek: co se s nimi stalo, podle událostí
SELECT type, count(DISTINCT message_id) FROM message_events
 WHERE workspace_id = $ws AND received_at::date = $day
   AND type IN ('delivered','bounced_hard','bounced_soft','complained','rejected','delivery_delayed')
 GROUP BY type;
```

Den se u `sent` bere podle `sent_at`, u událostí podle `received_at`. Tím pádem se bounce z pondělní kampaně, který dorazí ve středu, započítá do středy. Je to záměrné: dashboard má ukazovat, kdy jsme se o problému dozvěděli, ne kdy vznikl, protože podle toho se rozhoduje o zásahu. Pro report konkrétní kampaně se naopak počítá podle `campaign_id` bez ohledu na den.

### 2.9 `campaign_audience_progress`

Stav materializace, aby šla po restartu workeru bezpečně dokončit.

```sql
CREATE TABLE campaign_audience_progress (
  campaign_id     uuid PRIMARY KEY REFERENCES campaigns(id) ON DELETE CASCADE,
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  phase           text NOT NULL DEFAULT 'collecting',  -- collecting | materializing | done
  cursor_contact_id uuid,                -- poslední zpracovaný kontakt, kurzor přes ORDER BY id
  inserted_rows   integer NOT NULL DEFAULT 0,
  skipped_suppressed integer NOT NULL DEFAULT 0,
  skipped_unsubscribed integer NOT NULL DEFAULT 0,
  skipped_invalid integer NOT NULL DEFAULT 0,
  started_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);
```

---

## 3. Doménová logika

### 3.1 Životní cyklus kampaně (kontrolní otázka 1)

#### 3.1.1 Stavy

| Stav | Význam | Kdo do něj přepíná |
|---|---|---|
| `draft` | Rozepsaná kampaň. Vše se dá měnit. | uživatel |
| `scheduled` | Naplánovaná na `scheduled_at`. Obsah zamčený. | uživatel |
| `queueing` | Šablona se kompiluje a publikum se materializuje do outboxu. | job `campaign.materialize` |
| `sending` | Outbox je naplněný, sender odbavuje. | job `campaign.materialize` po dokončení |
| `paused` | Odesílání zastaveno, outbox zůstává. | uživatel nebo automatická brzda |
| `sent` | Všechny zprávy skončily a alespoň jedna je `sent`, žádná nezůstala `pending`. | job `campaign.watchdog` |
| `partially_sent` | Odesílání skončilo, ale část zpráv je `failed` nebo `skipped` nad prahem 1 %. | job `campaign.watchdog` |
| `cancelled` | Uživatel zrušil. Zbylé `pending` zprávy jsou `skipped`. | uživatel |
| `failed` | Kampaň nešla vůbec spustit (kompilace, materializace, provider). Nic neodešlo. | job |
| `schedule_missed` | Naplánovaný čas uplynul o víc než `CAMPAIGN_SCHEDULE_CATCHUP_HOURS` (výchozí 6). | plánovač |

#### 3.1.2 Diagram přechodů

```
                    ┌──────────────────────────────────────────────┐
                    │                                              │
                 ┌──▼───┐  schedule   ┌───────────┐   čas nastal   │
      vytvoření →│draft │────────────►│ scheduled │────────────────┤
                 └──┬───┘◄────────────└─────┬─────┘                │
                    │    unschedule         │ čas + catchup uplynul│
                    │                       ▼                      │
                    │                ┌─────────────────┐           │
                    │                │ schedule_missed │───────────┘
                    │                └────────┬────────┘  reschedule
                    │ send                    │ send_now
                    ▼                         ▼
                 ┌──────────┐  chyba   ┌────────┐
                 │ queueing │─────────►│ failed │
                 └────┬─────┘          └────────┘
                      │ materializace hotová
                      ▼
        ┌────────►┌─────────┐  pause / auto-brzda  ┌────────┐
        │         │ sending │─────────────────────►│ paused │
        │         └────┬────┘◄─────────────────────└───┬────┘
        │              │          resume               │
        └──────────────┤                               │ cancel
           (resume)    │ outbox prázdný                │
                       ▼                               ▼
      ┌──────┐  ┌────────────────┐              ┌───────────┐
      │ sent │◄─┤ vyhodnocení    ├─►│partially_sent│         │
      └──────┘  │ watchdogem     │  └──────────────┘  │cancelled│
                └───────┬────────┘                    └───────────┘
                        │ cancel (uživatel během sending)
                        └──────────────────────────────────────►
```

#### 3.1.3 Tabulka přechodů, včetně zakázaných

| Z \ Do | draft | scheduled | queueing | sending | paused | sent | partially_sent | cancelled | failed | schedule_missed |
|---|---|---|---|---|---|---|---|---|---|---|
| **draft** | – | ✅ `schedule` | ✅ `send` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |
| **scheduled** | ✅ `unschedule` | ✅ `reschedule` | ✅ plánovač | ❌ | ❌ | ❌ | ❌ | ✅ `cancel` | ❌ | ✅ plánovač |
| **queueing** | ❌ | ❌ | – | ✅ job | ✅ `pause`, brzda, `materialize_timeout` | ❌ | ❌ | ✅ `cancel` | ✅ job | ❌ |
| **sending** | ❌ | ❌ | ❌ | – | ✅ `pause` | ✅ watchdog | ✅ watchdog | ✅ `cancel` | ❌ | ❌ |
| **paused** | ❌ | ❌ | ✅ `resume` při nedokončené materializaci | ✅ `resume` | – | ❌ | ❌ | ✅ `cancel` | ❌ | ❌ |
| **sent** | ❌ | ❌ | ❌ | ❌ | ❌ | – | ❌ | ❌ | ❌ | ❌ |
| **partially_sent** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | – | ❌ | ❌ | ❌ |
| **cancelled** | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | – | ❌ | ❌ |
| **failed** | ✅ `reset_to_draft` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | – | ❌ |
| **schedule_missed** | ✅ `unschedule` | ✅ `reschedule` | ✅ `send_now` | ❌ | ❌ | ❌ | ❌ | ✅ `cancel` | ❌ | – |

**Zakázané přechody, které stojí za vysvětlení, protože je někdo bude chtít:**

- `sent → sending` (znovuodeslání). Zakázáno. Odeslání kampaně dvakrát je nejčastější příčina toho, že se lidé odhlašují. Kdo chce poslat znovu, udělá **duplikát kampaně**, což je jiná akce s vlastním ID (endpoint `POST /campaigns/{id}/duplicate`).
- `cancelled → sending`. Zakázáno ze stejného důvodu, plus proto, že outbox už je vyprázdněný.
- `paused → sent`. Zakázáno. Pozastavená kampaň musí projít buď `resume`, nebo `cancel`. Jinak by uživatel nevěděl, jestli zbytek odešel.
- `queueing → paused`. **Povoleno, změna oproti dřívějšímu znění.** Dřív tu stálo „zakázáno, materializace je krátká a přerušovat ji uprostřed by komplikovalo kurzor". Obojí bylo mylné a dokument si to sám protiřečil: strop materializace je `CAMPAIGN_MATERIALIZE_MAX_MINUTES` s výchozí hodnotou **60 minut**, takže krátká není, kurzor je trvanlivý v `campaign_audience_progress` a 3.3.6 přechod `queueing → paused` sama předepisovala pro `materialize_timeout`. Zakázaný přechod v tabulce znamenal, že by ten `UPDATE` zasáhl nula řádků a kampaň by po překročení stropu visela v `queueing` navždy.

  Kontrakt části 1 to mezitím ujasnil ze své strany (4.10.1, poznámka „Pozor na rozsah omezení"): omezení, že se pozastavuje jen z `queueing` a `sending`, platí pro **sender**. **Aplikaci neomezuje** a `materialize_timeout` je uveden jako legitimní případ.

  Přechod tedy smí provést uživatel tlačítkem Pozastavit i aplikace (ochranná brzda, `materialize_timeout`, `provider_blocked`, vyčerpaná kvóta). `resume` vrátí kampaň do `queueing`, ne do `sending`, a materializace pokračuje od kurzoru, viz 3.6.2.

  **Pozor: zrušení i pozastavení během `queueing` už nemusí být bez následků.** Claim dotaz v kontraktu bere kampaně ve stavu `queueing` **i** `sending`, takže sender odebírá práci už během materializace. To je záměrné a je to výhoda (uživatel vidí první odeslané zprávy do několika sekund i u milionového publika, viz 3.3.6), ale znamená to, že `cancel` během `queueing` může zastihnout kampaň, ze které už část zpráv odešla. UI proto nesmí u zrušení během `queueing` tvrdit „nic neodešlo"; musí ukázat skutečný `sent_count` stejně jako u zrušení během `sending`. Jediný stav, kde je zaručeno, že neodešlo nic, je undo okno podle 3.6.4, protože tam brání odeslání `next_attempt_at` v budoucnosti, ne stav kampaně.
- `sending → draft`. Zakázáno. Kampaň, ze které něco odešlo, se už nikdy nesmí stát draftem, jinak by se v reportech objevil obsah, který nikdo nedostal.

#### 3.1.4 Vynucení přechodů

Každý přechod se dělá jediným dotazem s podmínkou na výchozí stav, takže dva souběžné požadavky nemůžou provést tentýž přechod dvakrát:

```sql
UPDATE campaigns
   SET status = $new_status, updated_at = now() /* + specifické sloupce */
 WHERE id = $id AND workspace_id = $ws AND status = ANY($allowed_from)
RETURNING id, status;
```

Když dotaz nevrátí řádek, API vrací `409` s obecným kódem `invalid_state_transition` z katalogu části 1. Aktuální stav a seznam povolených akcí jsou v poli `errors[]`. UI stav překreslí.

Přechody se zapisují do auditu (`campaign.status_changed`) s `from`, `to`, `actor` a důvodem.

### 3.2 Předodeslací kontrola (preflight)

Než se kampaň dostane z `draft` nebo `scheduled` do `queueing`, projde sadou kontrol. Endpoint `GET /campaigns/{id}/preflight` je vrací i pro UI, takže tlačítko Odeslat je zašedlé se srozumitelným důvodem.

| # | Kontrola | Závažnost | Chybový kód |
|---|---|---|---|
| 1 | `subject` není prázdný, délka 1 až 255 znaků | blokuje | `campaign_subject_missing` |
| 2 | Existuje `compiled_html` a `compiled_hash` sedí na aktuální `design` | blokuje | `campaign_not_compiled` |
| 3 | `provider_id` je vyplněný a provider má `status IN ('ready','degraded')` | blokuje | `provider_not_ready` |
| 4 | `sender_domain_id` odpovídá doméně z `from_email` a má `dkim_ok = true` | blokuje | `domain_dkim_missing` |
| 5 | `spf_ok = true` | blokuje | `domain_spf_missing` |
| 6 | `dmarc_ok = true` | varuje | `domain_dmarc_missing` |
| 7 | `enforcement_status <> 'SHUTDOWN'` a `sending_enabled = true` | blokuje | `provider_sending_paused` |
| 8 | Publikum je neprázdné (odhad > 0) | blokuje | `campaign_audience_empty` |
| 9 | Odhad publika ≤ `quota_max_24h - quota_sent_24h` | blokuje | `provider_quota_exceeded` |
| 10 | `production_access = true`, jinak se ověří, že všichni příjemci jsou ověřené identity | blokuje | `provider_sandbox` |
| 11 | Šablona obsahuje `{{ unsubscribe_url }}` nebo je zapnuté automatické vkládání patičky | blokuje | `campaign_no_unsubscribe` |
| 12 | Všechna pole v `compiled_fields` existují v projektu | blokuje | `campaign_unknown_merge_field` |
| 13 | Odhad publika ≤ `CAMPAIGN_MAX_RECIPIENTS` (výchozí 2 000 000) | blokuje | `campaign_audience_too_large` |
| 14 | Bounce rate providera za 30 dní < 8 % a complaint rate < 0,3 % | varuje | `deliverability_degraded` |

**`GET /campaigns/{id}/preflight` vrací vždy `200`** s vyplněným `findings`, i když jsou mezi nimi blokující. Je to dotaz na stav, ne pokus o akci, a UI z něj kreslí seznam.

**`POST /campaigns/{id}/send` vrací při blokujícím nálezu `422`** s obálkou `Problem` podle konvence 4.2 části 1, kde `code` je `campaign_not_sendable` a `findings[]` nese **všechny** nálezy najednou, ne první chybu. Uživatel má vidět celý seznam.

Platí přitom pravidlo proti odpadkovému koši z části 1: **4xx s `findings` smí vzniknout jen tehdy, když je mezi nimi alespoň jeden se `severity: "error"`.** Samotná varování odeslání neblokují, takže požadavek se samými varováními projde a vrátí `202`. Varování se v takovém případě předají v odpovědi na úspěch, ne v chybě.

Kontrola 9 je záměrně tvrdá. Kdo chce poslat víc, než má denní limit, musí kampaň rozdělit nebo si zvýšit limit u Amazonu. Nebudeme uživateli generovat 40 000 chyb.

Kontrola 2 srovnává `compiled_hash` s čerstvě spočítaným hashem `design`, `subject` a `preheader`. Když se šablona změnila po kompilaci, kampaň se překompiluje automaticky v rámci `queueing`, ale preflight to uživateli oznámí jako informaci.

### 3.3 Sestavení a materializace publika (kontrolní otázka 2)

#### 3.3.1 Definice publika

```ts
type CampaignAudience = {
  include: { lists: string[]; segments: string[] };
  exclude: { lists: string[]; segments: string[] };
};
```

Sémantika, v tomto pořadí:

```
publikum = (⋃ include.lists  ∪  ⋃ include.segments)
         − (⋃ exclude.lists  ∪  ⋃ exclude.segments)
         − kontakty se statusem jiným než 'active'
         − kontakty bez potvrzeného členství (`list_subscriptions.status <> 'confirmed'`)
         − kontakty s neplatnou nebo prázdnou adresou
         − suppression list projektu
         − duplicity (podle contact_id)
```

`include` je sjednocení, ne průnik. Průnik se dělá segmentem, protože segment už umí AND. Tohle je vědomé zjednodušení UI.

#### 3.3.2 Náhled počtu

`POST /campaigns/{id}/audience/preview` vrací odhad **bez** materializace:

```ts
type AudiencePreview = {
  total: number;              // po všech vyloučeních
  breakdown: {
    from_lists: number;
    from_segments: number;
    excluded_by_lists: number;
    excluded_by_segments: number;
    excluded_unsubscribed: number;
    excluded_suppressed: number;
    excluded_invalid_email: number;
    duplicates_removed: number;
  };
  sample: Array<{ contact_id: string; email: string; first_name: string | null }>; // max 20
  computed_at: string;
  exact: boolean;             // false, když se použil odhad, viz níže
};
```

Náhled běží se `SET LOCAL statement_timeout = '5s'`. Když spadne na timeout, vrátí se `exact: false` a odhad z `EXPLAIN (FORMAT JSON)` nad tímtéž dotazem, plus text „Přesný počet spočítáme při odeslání." Uživatel nikdy nečeká na náhled déle než 5 sekund.

#### 3.3.3 Materializační SQL

Materializace běží v jobu `campaign.materialize` po dávkách, kurzorem přes `contacts.id`. Nikdy neběží v jedné transakci přes celé publikum: transakce nad milionem řádků drží zámky, blokuje `VACUUM` a při pádu se celá vrací zpět.

Krok 1, jednou na kampaň, atomicky:

```sql
UPDATE campaigns
   SET status = 'queueing',
       audience_built_at = COALESCE(audience_built_at, date_trunc('second', now())),
       started_at = COALESCE(started_at, now())
 WHERE id = $campaign_id AND workspace_id = $ws AND status IN ('draft','scheduled','schedule_missed')
RETURNING audience_built_at;

INSERT INTO campaign_audience_progress (campaign_id, workspace_id, phase)
VALUES ($campaign_id, $ws, 'materializing')
ON CONFLICT (campaign_id) DO NOTHING;
```

Krok 2, opakovaně, dokud vrací řádky. `$audience_sql` dodává část 2 (viz kapitola 10, požadavek R2.1) a je to `SELECT id FROM contacts ...` bez `ORDER BY` a bez `LIMIT`:

```sql
WITH candidates AS (
  SELECT c.id,
         c.email,
         c.first_name, c.last_name, c.first_name_vocative, c.greeting,
         c.attributes
    FROM contacts c
   WHERE c.workspace_id = $ws
     AND c.id > $cursor                       -- kurzor, na začátku '00000000-...-000000000000'
     AND c.status = 'active'                  -- hodnota z části 2, ne 'subscribed'
     AND c.email IS NOT NULL AND c.email <> ''
     AND c.id IN ( /* $audience_include_sql, viz níže */ )
     AND c.id NOT IN ( /* $audience_exclude_sql */ )
     AND NOT EXISTS (
           SELECT 1 FROM suppressions s
            WHERE s.workspace_id = c.workspace_id
              AND s.removed_at IS NULL          -- měkce odebraná suppression neplatí
              AND (   lower(s.email::text) = lower(c.email::text)
                   OR s.fingerprint = ANY(c.email_fingerprints) )   -- viz 3.3.5
         )
   ORDER BY c.id
   LIMIT $batch_size                          -- CAMPAIGN_MATERIALIZE_BATCH_SIZE, výchozí 5000
),
inserted AS (
  INSERT INTO messages (
    workspace_id, campaign_id, contact_id, email,
    render_data, status, next_attempt_at, created_at
  )
  SELECT
    -- `id` se v seznamu sloupců nevyskytuje schválně: doplní ho DEFAULT uuidv7()
    -- přímo v Postgresu 18 (předpoklad P1). Aplikace UUID negeneruje.
    $ws, $campaign_id, cand.id, cand.email,
    /* $render_data_expr, viz 3.3.4 */         jsonb_build_object(...),
    'pending',
    COALESCE($release_at, $audience_built_at),  -- undo okno, viz 3.6.4
    $audience_built_at                         -- invariant I1: explicitně, nikdy DEFAULT now()
  FROM candidates cand
  ON CONFLICT (campaign_id, contact_id, created_at) DO NOTHING
  RETURNING contact_id
)
SELECT
  (SELECT count(*) FROM candidates)             AS scanned,
  (SELECT count(*) FROM inserted)               AS inserted,
  (SELECT max(id) FROM candidates)              AS next_cursor;
```

Po každé dávce se v téže transakci posune kurzor:

```sql
UPDATE campaign_audience_progress
   SET cursor_contact_id = $next_cursor,
       inserted_rows = inserted_rows + $inserted,
       updated_at = now()
 WHERE campaign_id = $campaign_id;
```

**Po každé dávce se navíc kontroluje stav kampaně a smyčka se podle něj ukončuje.** Není to optimalizace, je to jediná ochrana proti závodu popsanému v 3.6.3: bez ní běžící dávka po úklidu zrušené kampaně vloží další `pending` řádky, které už nikdo neclaimne a které navěky brání odpojení oddílu (3.18.2).

```sql
-- Běží ve stejné transakci jako posun kurzoru, hned po něm.
SELECT status FROM campaigns WHERE id = $campaign_id AND workspace_id = $ws;
```

| Zjištěný stav | Co smyčka udělá |
|---|---|
| `queueing` | pokračuje další dávkou |
| `sending` | pokračuje (materializace mohla doběhnout krok 3 v jiném běhu) |
| `paused` | zastaví se, kurzor zůstane, `resume` naváže |
| `cancelled` | zastaví se **a znovu spustí úklid z 3.6.3** nad tím, co stihla vložit |
| cokoliv jiného | zastaví se a zaloguje `warn` |

Krok 3, po vyčerpání kurzoru:

```sql
UPDATE campaigns
   SET status = 'sending',
       total_count = (SELECT count(*) FROM messages
                       WHERE campaign_id = $campaign_id AND created_at = $audience_built_at),
       audience_size = (SELECT inserted_rows FROM campaign_audience_progress WHERE campaign_id = $campaign_id),
       updated_at = now()
 WHERE id = $campaign_id AND status = 'queueing';

UPDATE campaign_audience_progress
   SET phase = 'done', finished_at = now()
 WHERE campaign_id = $campaign_id;
```

**Podmínky způsobilosti kontaktu nepíšu ručně, dodává je kompilátor části 2.** V dotazu výše jsou z nich explicitně jen `c.status = 'active'` a suppression, protože jsou to hrubé filtry, které chci mít vidět. Všechno ostatní, co rozhoduje o tom, jestli kontakt smí dostat poštu, je uvnitř `$audience_include_sql`, tedy uvnitř obálky, kterou vrací `compileAudienceToSql` z části 2 (požadavek R2.1). Patří tam minimálně:

| Podmínka | Proč nesmí být v mém ručním SQL |
|---|---|
| `c.deleted_at IS NULL` | měkce smazaný kontakt |
| `c.processing_restricted = false` | omezené zpracování podle článku 18 GDPR. Poslat poštu takovému člověku je porušení nařízení, ne kosmetická chyba. |
| `list_subscriptions.status = 'confirmed'` | autoritativní brána členství, viz níže |
| `list_subscriptions.snooze_until IS NULL OR snooze_until < now()` | uživatel si dal pauzu |

Důvod je procesní, ne technický: kdybych si ty čtyři podmínky opsal do materializace, existovaly by na dvou místech a **za půl roku se rozejdou**. Část 2 přidá pátou podmínku (třeba nový typ souhlasu), doplní ji do kompilátoru a do svého UI, a moje materializace o ní nebude vědět. Proto je celý filtr způsobilosti jediná funkce, kterou vlastní část 2, a já ji jen volám.

**Členství v seznamu je autoritativní brána, ne `contacts.status`.** `contacts.status = 'active'` znamená „kontakt jako takový je v pořádku", ale o tom, jestli smí dostat konkrétní kampaň, rozhoduje `list_subscriptions.status = 'confirmed'` pro seznamy z publika. U publika sestaveného ze segmentů to zajišťuje kompilátor, u publika ze seznamů je to přímo v `$audience_include_sql`.

**Tvar poddotazu.** Kompilátor vrací `SELECT contact_id FROM ...` bez `ORDER BY` a `LIMIT`, použitelný uvnitř `IN`. Materializace se na vnitřní strukturu nesmí spoléhat, proto je signatura fixovaná v R2.1.

#### 3.3.4 `render_data`, snapshot personalizace

Do `render_data` jde **jen to, co kompilovaná šablona skutečně používá**, tedy `campaigns.compiled_fields`.

**Tvar je vnořený, ne plochý.** Kořenové klíče odpovídají kořenům merge tagů, takže `{{ contact.first_name }}` čte `render_data.contact.first_name`. Plochá mapa s klíčem `"contact.first_name"` by v Liquidu **nefungovala**, protože obě implementace (LiquidJS i `osteele/liquid`) překládají tečku na přístup k vlastnosti vnořeného objektu, ne na klíč obsahující tečku. Tohle je oprava po připomínce části 4b a je věcně správná.

```json
{
  "contact": {
    "first_name": "Jana",
    "first_name_vocative": "Jano",
    "greeting": "Dobrý den, Jano",
    "attr": { "city": "Brno", "orders_count": 3 }
  }
}
```

```ts
type RenderData = {
  contact: {
    [field: string]: string | number | boolean | null;
    attr?: Record<string, string | number | boolean | null>;
  };
  _test?: true;
};
```

| Merge tag v šabloně | Zdroj | Cesta v `render_data` |
|---|---|---|
| `{{ contact.first_name }}` | `contacts.first_name` | `contact.first_name` |
| `{{ contact.first_name_vocative }}` | `contacts.first_name_vocative` | `contact.first_name_vocative` |
| `{{ contact.greeting }}` | vypočtený sloupec z části 2 | `contact.greeting` |
| `{{ contact.attr.city }}` | `contacts.attributes ->> 'city'` | `contact.attr.city` |
| `{{ unsubscribe_url }}` | **nevkládá se**, staví sender z tokenu | – |
| `{{ webview_url }}` | **nevkládá se**, staví sender z tokenu | – |

Pravidla:

- Vnoření je nejvýš **dvě úrovně** (`contact.attr.<key>`). Hlubší struktury ani pole se nesnapshotují, protože Liquid subset z hlavní specifikace neumí vnořené cykly a nebylo by je jak vyrenderovat.
- Hodnota, která je `NULL`, se **zapíše jako `null`**, ne vynechá. Sender pak rozliší „pole neexistuje" (chyba šablony) od „pole je prázdné" (normální stav, řeší `| default:`).
- Tvrdý strop **8 kB na zprávu**. Při překročení se zpráva založí rovnou ve stavu `skipped` (kontraktní přechod `(vznik) → skipped`) s `error_code = 'render_data_too_large'` a s popisem v `error_detail`, a započítá se do `skipped_invalid`. Dřívější znění tu mělo `invalid_recipient` s poznámkou, že vlastní kód nezavádím, protože výčet je uzavřený. **Část 1 mezitím `render_data_too_large` do registru doplnila** (4.10.1, ověřeno čtením) právě proto, že `invalid_recipient` je sémanticky lživý: jde o chybu šablony, ne o vadnou adresu, a report si to vykládal jako neplatný kontakt. Osm kilobajtů je asi 30krát víc, než potřebuje běžná šablona, takže překročení znamená chybu v šabloně, ne v datech.
- **Nikdy neobsahuje e-mailovou adresu.** Ta je v samostatném sloupci `messages.email`, protože ji sender potřebuje jako obálkovou adresu vždy a nesmí se stát, že se dvě kopie rozejdou.

**Proč `unsubscribe_url` a `webview_url` v `render_data` nejsou.** Část 4b je tam chtěla, ale kontrakt 3 části 1 to rozhoduje jinak a má pravdu: unsubscribe token má payload `workspace_id(16) message_id(16) contact_id(16) list_id(16) issued_at(u32)` a **sender ho vyrábí**. Kdyby ho stavěla aplikace, znamenalo by to zhruba 117 znaků URL navíc u každé zprávy v databázi (u milionové kampaně přes 100 MB) a druhou implementaci téhož podpisu na straně, která ho podle kontraktu vyrábět nemá. Sender má všechny vstupy k dispozici:

| Vstup tokenu | Odkud ho sender vezme |
|---|---|
| `workspace_id` | `messages.workspace_id`, vrací ho claim dotaz |
| `message_id` | `messages.id`, vrací ho claim dotaz |
| `contact_id` | `messages.contact_id`, vrací ho claim dotaz |
| `list_id` | `campaigns.unsubscribe_list_id`, načtený jednou na kampaň. Když je `NULL`, použije se nulové UUID, což podle kontraktu 3 znamená globální odhlášení. |
| `issued_at` | čas odeslání |
| základ URL | `APP_URL` z konfigurace |

Sloupec `campaigns.unsubscribe_list_id` je kvůli tomu doplněný do 2.3. Vyplňuje se automaticky, když publikum kampaně tvoří právě jeden seznam; jinak zůstává `NULL` a odhlášení je globální.

#### 3.3.5 Otisk adresy jako druhá větev kontroly suppression

Suppression list se kontroluje **dvěma způsoby najednou**, ne jedním:

| Větev | Kdy zabere |
|---|---|
| `lower(s.email) = lower(c.email)` | běžný případ, adresa je na seznamu v čitelné podobě |
| `s.fingerprint = ANY(c.email_fingerprints)` | adresa byla anonymizovaná po výmazu podle GDPR, čitelná verze už neexistuje |

Druhá větev je jediné, co po výmazu zbude. Scénář, který bez ní selže: člověk uplatní právo na výmaz, část 2 mu smaže kontakt a do `suppressions` zapíše řádek s placeholderem místo adresy a s otiskem. O měsíc později přijde nový import se stejnou adresou, vznikne nový kontakt, a protože plaintextová větev nemá co porovnat, materializace ho pustí do publika. **Poslali bychom poštu člověku, jehož výmaz jsme provedli správně**, což je horší než výmaz neprovést, protože o tom máme důkaz v auditu.

**Rotace klíče je vyřešená a materializace klíč nepotřebuje.** Kontrakt části 1 (3.10) předepisuje, že se otisk počítá **pro všechna známá pokolení klíče, bez horního omezení**, a hledá se `WHERE fingerprint = ANY($1)`. Část 2 z toho udělala tvar, který se dá použít i v dávce: `suppressions` nese **jeden** otisk plus `fingerprint_key_id` (plaintext je po výmazu pryč, přepočítat ho nejde), kdežto `contacts` nese **pole otisků pod všemi pokoleními** ve sloupci `email_fingerprints bytea[]` s GIN indexem, protože u kontaktu plaintext adresy máme a otisk umíme kdykoliv dopočítat.

Materializace proto píše `s.fingerprint = ANY(c.email_fingerprints)`. Je to jeden indexovaný průchod, splňuje to kontraktní pravidlo „hledej přes všechna pokolení" a **`SECRET_KEY` ani odvozený klíč `mailer/v1/suppression-fingerprint` materializace nepotřebuje znát ani jednou**. Milionové publikum tedy neznamená miliony HMAC operací navíc; ty se udělaly jednou při zápisu kontaktu.

Rozdíl proti dřívějšímu znění tohoto dokumentu: dřív se joinovaly dva skalární sloupce `email_hash` a vlastní kapitola 11.12 přiznávala, že po rotaci klíče join **tiše přestane nacházet shody**. To už neplatí, pole otisků na straně kontaktu tu díru zavírá. Zbývající povinnost je provozní, ne návrhová: po rotaci musí job přepočítat `contacts.email_fingerprints`, aby v poli bylo i nové pokolení. Viz R2.13 a 11.12.

#### 3.3.6 Chování při milionu kontaktů

| Veličina | Očekávání |
|---|---|
| Velikost dávky | 5 000 kontaktů |
| Počet dávek na milion | 200 |
| Doba jedné dávky (Postgres 18, SSD, index na `contacts(workspace_id, id)`) | 150 až 600 ms podle složitosti segmentu |
| Celková doba pro milion | 1 až 4 minuty |
| Přírůstek dat | zhruba 300 B na zprávu při typickém `render_data`, tedy asi 300 MB na milion |
| Zámky | žádný dlouhý zámek, každá dávka je vlastní transakce |

Sender může začít odebírat práci **už během materializace**, protože zprávy jsou zapisované po dávkách se stavem `pending`. Proto přechod do `sending` není podmínkou pro odesílání, je to jen značka pro UI. Tohle je záměrné: uživatel vidí první odeslané zprávy do několika sekund po zmáčknutí Odeslat i u velkého publika.

Ochrana proti nekonečné materializaci: job má strop `CAMPAIGN_MATERIALIZE_MAX_MINUTES` (výchozí 60). Po překročení se kampaň převede z `queueing` do `paused` s `pause_reason.code = 'materialize_timeout'`, kurzor zůstane a `resume` pokračuje od něj.

**Přechod `queueing → paused` je pro aplikaci povolený**, viz 3.1.3 a 3.6.1. Dřívější znění ho zakazovalo v tabulce přechodů a zároveň ho tady předepisovalo, což byl vnitřní rozpor: job by strop překročil, `UPDATE` by zasáhl nula řádků a kampaň by v `queueing` visela dál bez jakéhokoliv projevu poruchy.

#### 3.3.7 Idempotence materializace

Materializace může běžet vícekrát: worker spadne, pg-boss job se opakuje, uživatel dvakrát klikne. Ochrany jsou tři, každá sama o sobě dostačující:

1. **Přechod stavu.** `draft → queueing` proběhne jen jednou. **No-op je ale jen samotné převzetí přechodu, ne celý job.** Tohle je oprava dřívějšího znění, které říkalo „druhý pokus nevrátí řádek a job skončí", a bylo to nebezpečně špatně: po pádu workeru je kampaň už ve stavu `queueing`, druhý pokus o přechod tedy nikdy řádek nevrátí, job by skončil a **kampaň by v `queueing` zůstala trčet navždy**. Akceptační kritérium 10 (restart workeru uprostřed materializace milionu kontaktů) by nešlo splnit.

   Job proto po neúspěšném přechodu zjistí, v jakém stavu kampaň je, a rozhodne se podle toho:

   ```sql
   -- Krok 1 nevrátil řádek. Zjisti proč.
   SELECT status, audience_built_at
     FROM campaigns
    WHERE id = $campaign_id AND workspace_id = $ws;
   ```

   | Zjištěný stav | Co job udělá |
   |---|---|
   | `queueing` nebo `sending` | **Pokračuje.** Načte `audience_built_at` z tohohle `SELECT`u (krok 1 ho vrátit nemohl), načte kurzor z `campaign_audience_progress` a jede od něj dál. Když je `phase = 'done'`, jen dopočítá krok 3. |
   | `paused` | Skončí. Materializaci znovu pošle až `resume` (3.6.2). |
   | `cancelled`, `failed`, `sent`, `partially_sent` | Skončí jako no-op, je to opožděný duplikát jobu. |
   | `draft`, `scheduled`, `schedule_missed` | Skončí a zaloguje `warn`. Znamená to, že mezitím někdo kampaň vrátil zpátky, což by neměl umět. |

   Načtení `audience_built_at` SELECTem je nutné, ne kosmetické: bez něj by druhý běh neznal hodnotu invariantu I1 a musel by ji generovat znovu, čímž by vznikla druhá sada `created_at` a unikátní index by duplicity přestal zachytávat.
2. **pg-boss `singletonKey`.** Job se posílá s `singletonKey = 'campaign.materialize:' + campaign_id`, takže dvě instance stejného jobu nemůžou běžet souběžně.
3. **Unikátní index `uq_messages__campaign_contact (campaign_id, contact_id, created_at)`** s `ON CONFLICT` nad **všemi třemi** sloupci. I kdyby první dvě selhaly, duplicitní řádek nevznikne. `ON CONFLICT` jen nad dvěma sloupci je tvrdý error (`there is no unique or exclusion constraint matching the ON CONFLICT specification`) a materializace by neproběhla vůbec; funguje to jen díky invariantu I1, tedy že `created_at` je pro celou kampaň jedna hodnota.

Kurzor v `campaign_audience_progress` zajišťuje, že se po restartu nezačíná od nuly. Kdyby se kurzor ztratil, materializace projde celé publikum znovu, ale `ON CONFLICT` zabrání duplicitám. Ztráta kurzoru tedy stojí čas, ne správnost.

### 3.4 Změny publika během odesílání (kontrolní otázka 3)

Publikum je zmrazené, ale **souhlas není**. Když se člověk odhlásí, nesmí mu už nic odejít, a je jedno, že kampaň běží.

#### 3.4.1 Okamžitá cesta

Část 2 při odhlášení, zápisu do suppression listu nebo změně stavu kontaktu na jiný než `active` zavolá doménovou funkci, kterou poskytuje tato část:

```ts
// packages/core/campaigns
export async function revokePendingMessages(
  ctx: WorkspaceContext,          // projekt se bere odsud, ne z těla, sjednoceno s částí 2
  input: {
    contactId?: string;           // jeden kontakt, tvar, kterým volá část 2
    contactIds?: string[];        // dávka, preferovaná větev uvnitř této části
    emails?: string[];            // pro případy, kdy známe jen adresu (SES event)
    listId: string | null;        // POVINNÝ, omezení rozsahu, viz níže
    reason:
      | 'unsubscribed'
      | 'suppressed'
      | 'contact_deleted'
      | 'contact_anonymized'
      | 'processing_restricted'
      | 'contact_status_changed';
  },
): Promise<{ revoked: number }>;
```

**Signatura je sjednocená s částí 2, která funkci volá.** Dřívější znění mělo `workspaceId` v těle, chybělo mu `contactId` v jednotném čísle a mělo užší výčet `reason`, takže volání z části 2 (`revokePendingMessages(ctx, { contactId, listId, reason })`, viz její 4.9.4) by se do něj netrefilo ani typem, ani hodnotou. Platí tvar výše: `ctx` jako první argument, `listId` povinný, `contactId` i `contactIds` přijatelné, a výčet `reason` je sjednocení obou stran, tedy všech šest míst, ze kterých část 2 funkci volá.

**Hodnota `reason` jde přímo do `messages.error_code` a všech šest je v kontraktním registru.** Registr `messages.error_code` vlastní část 1 (4.10.1) a `contact_deleted` i `contact_status_changed` v něm dřív chyběly. **Byly doplněny 2026-07-31**, ověřeno čtením části 1, takže dřívější poznámka „je potřeba je zaregistrovat" je uzavřená a nezbývá z ní žádná akce. Registr má dnes i `contact_anonymized` a `processing_restricted`, které používá část 2, a `render_data_too_large`, který používám v 3.3.4.

**Parametr `listId` je povinný v tom smyslu, že volající musí vědomě rozhodnout.** Bez něj vzniká tichá ztráta pošty: člověk se odhlásí z jednoho newsletteru a přijde i o čekající zprávy z kampaní na úplně jiné seznamy, na které přihlášený zůstal. Nikdo si toho nevšimne, protože zprávy skončí jako `skipped` s věrohodným důvodem.

| `listId` | Rozsah rušení | Kdy se používá |
|---|---|---|
| konkrétní UUID | jen kampaně, jejichž `unsubscribe_list_id` odpovídá | odhlášení z jednoho seznamu |
| `null` | **všechny** čekající zprávy kontaktu v projektu | globální odhlášení, suppression, smazání kontaktu, změna stavu kontaktu |

Dotaz, větev přes `contact_id`:

```sql
UPDATE messages m
   SET status = 'skipped',
       error_code = $reason,
       error_detail = 'revoked by application',
       updated_at = now()
 WHERE m.workspace_id = $ws
   AND m.status = 'pending'
   AND m.contact_id = ANY($contact_ids)
   AND ($list_id IS NULL OR EXISTS (
         SELECT 1 FROM campaigns c
          WHERE c.id = m.campaign_id AND c.unsubscribe_list_id = $list_id));
```

Větev přes `emails` je stejná s `lower(m.email) = ANY($emails_lower)` a používá se tam, kde `contact_id` nemáme, typicky při zpracování SES události.

**Žádné časové omezení na `created_at`.** Původně jsem tu měl `created_at >= now() - interval '7 days'` kvůli partition pruningu a byla to chyba: kampaň může být pozastavená měsíce a její `pending` zprávy leží ve staré partition. Sedmidenní okno by je minulo a po obnovení kampaně by odešly člověku, který se dávno odhlásil. Rozsah je tedy **všechny partition, ve kterých existuje `pending`**, což je díky částečnému indexu `idx_messages__ws_email_pending` levné, protože v uzavřených kampaních žádné `pending` nezbývá.

Podmínka na `status = 'pending'` je zásadní: zpráva ve stavu `claimed` se **neruší**, protože ji sender může mít právě v ruce a mohla by odejít. Rušení claimnuté zprávy by vytvořilo stav, kdy je v databázi `skipped`, ale u příjemce ve schránce.

#### 3.4.2 Záchytná cesta

Job `outbox.reconcile` běží každých **60 sekund** a chytá případy, kdy okamžitá cesta selhala (pád workeru, změna přes přímý zápis do DB, import, který přidal adresu na suppression):

```sql
UPDATE messages m
   SET status = 'skipped',
       error_code = 'suppressed',
       updated_at = now()
 WHERE m.status = 'pending'
   AND (
     EXISTS (                                        -- větev 1: čitelná adresa
       SELECT 1
         FROM suppressions s
        WHERE s.workspace_id = m.workspace_id
          AND s.removed_at IS NULL
          AND lower(s.email::text) = lower(m.email)  -- citext versus text, viz R2.9
     )
     OR EXISTS (                                     -- větev 2: otisk, viz níže
       SELECT 1
         FROM contacts c
         JOIN suppressions s
           ON s.workspace_id = c.workspace_id
          AND s.fingerprint  = ANY(c.email_fingerprints)
        WHERE c.id = m.contact_id
          AND s.removed_at IS NULL
     )
   );
```

**Tenhle dotaz byl dřív napsaný tak, že by neproběhl.** Znění před opravou mělo tvar `UPDATE messages m ... FROM suppressions s LEFT JOIN contacts c ON c.id = m.contact_id`, tedy odkaz na cílovou tabulku `UPDATE`u uvnitř `ON` ve `FROM`. PostgreSQL to odmítá chybou `invalid reference to FROM-clause entry for table "m"`, protože cílová tabulka je do dotazu přidaná mimo strom spojení a ve `FROM` na ni jde odkazovat jen ve `WHERE`. Kontrakt části 1 to popisuje u vlastního claim dotazu (4.10.1, „Proč spojovací podmínky ve `WHERE` a ne v `ON`") a **kvůli přesně téhle třídě chyb zavedl scénář `OB-00`**, který každý normativní dotaz spustí proti čerstvě zmigrované databázi a ověří, že projde parserem a plánovačem.

**Dotaz výše proto patří do sady `OB-00`**, stejně jako materializační SQL z 3.3.3, claim v kontraktu a úklid při zrušení kampaně z 3.6.3. Prázdný výsledek je úspěch, testuje se jen to, že dotaz vůbec běží. Bez toho by se chyba tohohle typu projevila až na produkci, protože záchytná cesta nemá koho zaujmout, když neběží.

Oprava má tvar dvou nezávislých `EXISTS`, ne jednoho joinu, a to ze dvou důvodů. Korelace na `m` je v obou případech ve `WHERE` poddotazu, takže dotaz je platný. A obě větve se dají naplánovat každá přes svůj index, což u jedné disjunkce se `LEFT JOIN` nešlo.

Tři podmínky, všechny nutné:

`s.removed_at IS NULL`, protože část 2 umožňuje suppression měkce odebrat (u měkkých odrazů kdykoliv, u tvrdých po 30 dnech se schválením admina). Bez toho by legitimně odblokovaná adresa zůstala vyloučená navždy a nikdo by nepřišel na to proč.

Větev přes otisk, protože **plaintextová větev mine adresy anonymizované po výmazu podle GDPR**. U nich se `suppressions.email` nahradí placeholderem a jediné, co z původní adresy zbude, je otisk. Bez druhé větve by se vymazaný člověk po novém importu dostal zpátky do publika, přestože jeho výmaz proběhl správně. Tvar `s.fingerprint = ANY(c.email_fingerprints)` je sladěný s kontraktem části 1 (3.10) a s DDL části 2, popsáno v 3.3.5.

`m.status = 'pending'` v hlavním `WHERE`, aby se dotaz opřel o částečný index `idx_messages__ws_email_pending` a nesahal na zprávy, které má sender v ruce.

#### 3.4.3 Okno, ve kterém může mail odejít i tak

| Případ | Velikost okna |
|---|---|
| Zpráva už je `claimed` | do dokončení dávky senderu. Sender navíc smí provést `claimed → skipped` po vlastní kontrole suppression těsně před odesláním (kontrakt 1), čímž se okno smrskne na jednotky sekund. Viz R4b.13. |
| Zpráva je `pending`, okamžitá cesta funguje | jednotky až stovky milisekund |
| Zpráva je `pending`, okamžitá cesta selhala | do 60 s |

Tohle **musí být napsané v dokumentaci produktu**, protože je to jediné místo, kde nástroj nesplní naivní očekávání „odhlásil jsem se, tak už mi nic nepřijde". Odhlašovací stránka proto říká: „Odhlásili jsme vás. Zpráva, která je právě odesílaná, k vám ještě může dorazit."

#### 3.4.4 Co se nekontroluje znovu

Vědomě **nekontrolujeme** znovu při odeslání:

- členství v seznamu nebo segmentu (publikum je zmrazené, to je celý smysl),
- personalizační data (snapshot je zmrazený),
- existenci kontaktu (smazání kontaktu spustí `revokePendingMessages` s `reason: 'contact_deleted'`).

### 3.5 Plánování (kontrolní otázka 18)

#### 3.5.1 Model

`scheduled_at timestamptz` je absolutní okamžik v UTC. `schedule_timezone text` je IANA zóna, ve které uživatel čas zadal. Obojí se ukládá, protože:

- pro spuštění stačí `scheduled_at`,
- pro zobrazení a pro opakovanou editaci je potřeba vědět, v jaké zóně uživatel myslel „v 9 ráno". Bez toho by se při změně letního času posunul čas, který uživatel viděl.

Výchozí zóna je `workspaces.settings.campaigns.timezone`, uživatel ji může u kampaně přepsat. Jmenný prostor domény je konvence části 1, ploché klíče v `settings` se nepoužívají.

#### 3.5.2 Meze

| Mez | Hodnota | Konfigurovatelná | Chování při překročení |
|---|---|---|---|
| Minimum do budoucnosti | 5 minut | **ne, konstanta** | `422 campaign_schedule_too_soon` |
| Maximum do budoucnosti | 365 dní | **ne, konstanta** | `422 campaign_schedule_too_far` |
| Granularita | 1 minuta, sekundy se ořežou na 0 | ne, konstanta | tiše |
| Catch-up okno | `CAMPAIGN_SCHEDULE_CATCHUP_HOURS`, výchozí 6 | ano | po překročení `schedule_missed` |

**Proč jsou 5 minut a 365 dní konstanty, a ne konfigurační proměnné.** Obojí je **validace vstupu veřejného API**, ne provozní parametr. Zpřísnění validace existujícího pole je podle definice části 1 (4.6) breaking change, a rozvolnění zase mění, co API přijme; kdyby to byla proměnná prostředí, choval by se `POST /campaigns/{id}/schedule` na dvou instalacích jinak a klient by to nemohl vědět předem. Obě čísla navíc nemají provozní obsah, který by se lišil instalace od instalace: pět minut je dolní mez, pod kterou plánovač s cyklem 30 sekund a preflightem nedává smysl, a 365 dní je hranice, za kterou naplánovaná kampaň přestává být plán a stává se zapomenutým řádkem. Konstanty jsou v `packages/core/campaigns/constants.ts`, ne rozeseté v kódu.

#### 3.5.3 Plánovač

Job `campaign.scheduler` běží **každých 30 sekund** (pg-boss cron). Postup:

```sql
-- 1. kampaně, jejichž čas nastal a jsou v catch-up okně
SELECT id FROM campaigns
 WHERE status = 'scheduled'
   AND scheduled_at <= now()
   AND scheduled_at > now() - ($catchup_hours || ' hours')::interval
 ORDER BY scheduled_at
 LIMIT 100
 FOR UPDATE SKIP LOCKED;

-- 2. kampaně, které catch-up okno propásly
UPDATE campaigns
   SET status = 'schedule_missed', updated_at = now()
 WHERE status = 'scheduled'
   AND scheduled_at <= now() - ($catchup_hours || ' hours')::interval;
```

Pro každou kampaň z kroku 1 se pošle job `campaign.materialize` se `singletonKey`. Kdyby plánovač běžel dvakrát, druhý job je zahozen a i kdyby prošel, přechod stavu ho zastaví.

#### 3.5.4 Výpadek v okamžiku plánu

| Délka výpadku | Chování |
|---|---|
| do 30 s | nikdo si nevšimne, plánovač zabere při dalším běhu |
| do 6 hodin | kampaň odejde se zpožděním, do auditu se zapíše `campaign.schedule_delayed` s délkou zpoždění, uživatel dostane odchozí webhook `campaign.schedule_delayed` |
| nad 6 hodin | `schedule_missed`, kampaň **neodejde**, v UI je červená karta „Naplánovaný čas 12. 8. 9:00 uplynul před 9 hodinami. Odeslat teď, přeplánovat, nebo zrušit?" |

Zdůvodnění hranice: kampaň typu „dnešní polední menu" nebo „výprodej končí za hodinu" nemá odejít večer. Kampaň typu „srpnový newsletter" ano. Šest hodin je kompromis, který je konfigurovatelný.

#### 3.5.5 Změny obsahu naplánované kampaně

Ve stavu `scheduled` je obsah **zamčený**. `PATCH /campaigns/{id}` na pole `subject`, `design`, `audience`, `from_email` vrací `409 campaign_locked`. Uživatel musí nejdřív `unschedule`, upravit a naplánovat znovu. Důvod: jinak by se stalo, že kampaň odešla s obsahem, který nikdo nikdy neviděl v náhledu.

Změna povolená ve `scheduled`: `name`, `scheduled_at` (přeplánování), `schedule_timezone`.

### 3.6 Pauza, obnovení, zrušení

#### 3.6.1 Pauza

Pauza musí být rychlá a nesmí nic ztratit. Mechanismus: sender **neptá se aplikace**, ale claim dotaz obsahuje join na `campaigns.status`. Proto stačí změnit stav kampaně a sender přestane brát novou práci.

```sql
UPDATE campaigns
   SET status = 'paused', paused_at = now(), pause_reason = $reason::jsonb, updated_at = now()
 WHERE id = $id AND workspace_id = $ws AND status IN ('queueing','sending')
RETURNING id;
```

**Proč `IN ('queueing','sending')` a ne jen `sending`.** Dřívější znění filtrovalo na `sending` a zároveň v 3.3.6 předepisovalo pauzu z `queueing` při `materialize_timeout`. Dvě věty proti sobě, a ta v SQL by vyhrála: `UPDATE` by zasáhl nula řádků, job by považoval pauzu za provedenou a kampaň by v `queueing` visela navždy. Kontrakt části 1 to ujasnil (4.10.1): omezení na `queueing` a `sending` platí pro **sender**, aplikaci neomezuje vůbec. Aplikace tedy pozastavuje z obou odesílacích stavů, což je nadmnožina toho, co smí sender, a menší množina než cokoliv jiného.

Latence pauzy = doba, než sender dokončí rozpracovanou dávku. Při dávce 500 zpráv a 14 zprávách za sekundu (typická SES kvóta) je to do 36 sekund. UI proto říká „Pozastavuje se…" a přepne na „Pozastaveno", až `sent_count` přestane růst po dobu 5 sekund.

Zprávy ve stavu `claimed` doběhnou. Zprávy ve stavu `pending` zůstanou `pending` a čekají.

#### 3.6.1.1 `pause_reason` je `jsonb` s jedním závazným tvarem

**`campaigns.pause_reason` je kontraktní sloupec typu `jsonb`** (část 1, 4.10.1). Dřívější znění tohoto dokumentu ho mělo jako `text` s plochým výčtem hodnot, což by neprošlo: do sloupce zapisuje i sender přes sloupcový `GRANT UPDATE (status, pause_reason)` a potřebuje vedle kódu předat i to, kdo pauzu udělal, kdy a která instance senderu to byla. Textový sloupec by ty tři údaje neunesl a Go strana by do něj zapsala JSON jako řetězec.

Existuje **jeden** závazný tvar objektu, ne dva:

```jsonc
{
  "code":      "provider_quota_exhausted",  // povinné, z registru níže
  "source":    "sender",                    // povinné: "sender" | "app" | "user"
  "detail":    "SES daily quota reached",   // nepovinné, technický text pro log
  "sender_id": "mlain-ws-7f3a",             // nepovinné, jen když source = "sender"
  "at":        "2026-07-31T14:22:31Z"       // povinné, ISO 8601 v UTC
}
```

Registr kódů je rozdělený podle toho, kdo zápis provádí. **Sender smí zapsat jen svoje čtyři**, ostatní jsou aplikační:

| `code` | Kdo zapisuje | Kdy | Automatické obnovení |
|---|---|---|---|
| `render_failure_rate` | **sender** | podíl selhání renderu překročil práh | ne |
| `credentials_undecryptable` | **sender** | credentials providera nejdou dešifrovat | ne |
| `provider_quota_exhausted` | **sender**, a viz níže i aplikace | provider hlásí vyčerpanou kvótu | **ano**, job `campaign.resume_on_quota` (3.14.4) |
| `provider_unavailable` | **sender** | provider je nedostupný, circuit breaker sepnul | ne |
| `user` | aplikace | člověk zmáčkl Pozastavit | ne |
| `bounce_guard` | aplikace | ochranná brzda na míru odrazů (3.15.2) | ne |
| `complaint_guard` | aplikace | ochranná brzda na míru stížností (3.15.2) | ne |
| `provider_blocked` | aplikace | provider je `blocked` (`SHUTDOWN` nebo `sending_enabled = false`) | ne |
| `materialize_timeout` | aplikace | materializace překročila `CAMPAIGN_MATERIALIZE_MAX_MINUTES` | ne, ale `resume` pokračuje od kurzoru |

**Hodnota `quota` z dřívějšího znění zaniká.** V registru není a nikdy nebyla; správný kód pro vyčerpanou kvótu je `provider_quota_exhausted`. Aplikace ho zapisuje se `source: "app"`, když vyčerpání zjistí sama z `GetAccount` (3.14.4), sender se `source: "sender"`, když ho zjistí z odpovědi provideru. **Kód popisuje příčinu, `source` říká, kdo zápis provedl**, a rozhodování se dělá podle `code`. Registr části 1 má u tohohle kódu ve sloupci „kdo zapisuje" jen sender, takže žádám o rozšíření na obě strany, viz R1.17. Do té doby platí, že aplikace zapisuje tentýž kód s jiným `source`, což registr neporušuje v ničem, co by šlo otestovat.

#### 3.6.1.2 Obsluha senderových kódů

Sender pozastaví kampaň sám, bez toho, aby se aplikace ptal. Aplikace se o tom dozví až tím, že vidí změněný řádek. Z toho plynou **tři povinnosti, které dřívější znění nemělo**, protože o senderových kódech nevědělo vůbec.

**1. UI musí umět zobrazit všech devět kódů, ne pět.** Kampaň pozastavená senderem s kódem `credentials_undecryptable` by se v dřívějším návrhu zobrazila jako pauza bez důvodu, protože katalog hlášek ten kód neznal. Texty:

| `code` | cs | en |
|---|---|---|
| `render_failure_rate` | „Šablona selhává při renderu u velké části příjemců. Kampaň jsme zastavili, než se to opraví." | „The template is failing to render for a large share of recipients. We stopped the campaign until it's fixed." |
| `credentials_undecryptable` | „Nepodařilo se rozšifrovat přístupové údaje odesílacího účtu. Nejspíš probíhá rotace klíče." | „We couldn't decrypt the sending account credentials. A key rotation is probably in progress." |
| `provider_quota_exhausted` | „Vyčerpali jste denní limit Amazonu. Kampaň bude automaticky pokračovat, jakmile se limit uvolní." | „You've used up today's Amazon quota. The campaign will resume automatically once the quota resets." |
| `provider_unavailable` | „Odesílací služba neodpovídá. Zkusíme to znovu, kampaň zatím stojí." | „The sending service is not responding. The campaign is on hold while we retry." |

**2. Job `campaign.resume_on_quota` musí rozhodovat podle `code`, ne podle staré textové hodnoty.** Tohle je konkrétní chyba, kterou by dřívější znění vyrobilo: job obnovoval kampaně s `pause_reason = 'quota'`, kdežto sender zapisuje `provider_quota_exhausted`. Kampaň pozastavenou senderem kvůli vyčerpané kvótě by tedy **nikdy nerozjel**, i kdyby kvóta byla dávno volná, a nic by neselhalo ani se nezalogovalo. Uživatel by viděl kampaň, která stojí a tvrdí, že bude pokračovat sama. Dotaz jobu je proto:

```sql
SELECT id FROM campaigns
 WHERE status = 'paused'
   AND pause_reason ->> 'code' = 'provider_quota_exhausted'
   AND deleted_at IS NULL;
```

Bez ohledu na `source`. Kdo pauzu zapsal, na rozhodnutí „kvóta je zase volná, jeď dál" nic nemění.

**3. Audit `campaign.auto_paused` zapisuje aplikace, i když pauzu provedl sender.** Předepisuje to kontrakt (4.10.1: „každé automatické pozastavení zapisuje aplikace do `audit_log` jako `campaign.auto_paused` s důvodem, jakmile změnu uvidí"). Sender do `audit_log` nemá granty a mít je nemá, takže bez toho by pauzy provedené senderem v auditu **vůbec nebyly**. Zajišťuje to job `campaign.watchdog`: při každém běhu porovná stav kampaně s posledním zapsaným auditem a na nově pozastavené kampaně zapíše `campaign.auto_paused` s celým objektem `pause_reason` v detailu a s `actor = 'system'`. Pauzy vyvolané uživatelem (`code = 'user'`) se do `campaign.auto_paused` nezapisují, ty už pokrývá `campaign.status_changed` se skutečným aktérem.

#### 3.6.2 Obnovení

```sql
UPDATE campaigns
   SET status = CASE
                  WHEN EXISTS (SELECT 1 FROM campaign_audience_progress p
                                WHERE p.campaign_id = campaigns.id AND p.phase <> 'done')
                  THEN 'queueing'
                  ELSE 'sending'
                END,
       paused_at = NULL, pause_reason = NULL, updated_at = now()
 WHERE id = $id AND workspace_id = $ws AND status = 'paused'
RETURNING id, status;
```

Před tím proběhne zkrácený preflight (kontroly 3, 7, 9, 10 z 3.2). Když provider mezitím přestal být použitelný, `resume` vrátí `422` a kampaň zůstane `paused`.

**Cílový stav není vždy `sending`.** Když byla kampaň pozastavena během materializace (`campaign_audience_progress.phase <> 'done'`), vrací se do `queueing` a `resume` znovu pošle job `campaign.materialize`, který pokračuje od kurzoru. Dřívější znění posílalo kampaň vždy do `sending` a zároveň slibovalo pokračování materializace, což by nefungovalo: krok 3 materializace (dopočet `total_count` a `audience_size`) má podmínku `WHERE status = 'queueing'`, takže by zasáhl nula řádků a kampaň by navždy zůstala s nulovým `total_count`, tedy s nesmyslným ukazatelem průběhu a nefunkčním uzavíracím pravidlem z 3.7.2. Sender rozdíl mezi `queueing` a `sending` nevnímá, claim dotaz bere oba stavy.

#### 3.6.3 Zrušení

Zrušení je nevratné a v UI má potvrzovací dialog s počtem už odeslaných zpráv.

```sql
-- 1. stav kampaně
UPDATE campaigns
   SET status = 'cancelled', cancel_reason = $reason, finished_at = now(), updated_at = now()
 WHERE id = $id AND workspace_id = $ws AND status IN ('scheduled','queueing','sending','paused','schedule_missed');

-- 2. vyprázdnění outboxu, po dávkách po 10 000 řádcích, aby transakce nebyla dlouhá
UPDATE messages
   SET status = 'skipped',
       error_code = 'campaign_cancelled',
       updated_at = now()
 WHERE campaign_id = $id
   AND created_at = $audience_built_at
   AND status = 'pending'
   AND id IN (
     SELECT id FROM messages
      WHERE campaign_id = $id AND created_at = $audience_built_at AND status = 'pending'
      LIMIT 10000
   );
```

Zprávy ve stavu `claimed` se neruší, doběhnou. Po doběhnutí watchdog dopočítá čítače.

#### 3.6.3.1 Zrušení během materializace: závod, který se musí ošetřit výslovně

Text v 3.1.3 slibuje, že `cancel` během `queueing` „materializaci ukončí a nasadí `skipped` na to, co už vzniklo". **Samo o sobě to není pravda** a je to nejzrádnější druh chyby, protože všechny tři kroky výše proběhnou úspěšně:

1. Krok 1 přepne kampaň na `cancelled`.
2. Krok 2 označí jako `skipped` všechny `pending` řádky, které v tu chvíli existují.
3. Materializační smyčka o tom neví, protože stav kampaně mezi dávkami nekontrolovala, a **vloží další dávku `pending` řádků po úklidu**.

Výsledek: zrušená kampaň s několika tisíci `pending` zpráv, které nikdo neclaimne (claim dotaz bere jen `queueing` a `sending`), které nikdo znovu neuklidí (úklid proběhl jednorázově) a které **navěky brání odpojení oddílu**, protože veto retenčního jobu z 3.18.2 hledá přesně takové řádky. Za rok se to projeví jako neubývající databáze, jejíž příčina je v kampani zrušené loni.

Ošetření má dvě části a obě jsou povinné:

**A. Materializační smyčka kontroluje stav kampaně po každé dávce** a při `cancelled` se zastaví. Předepsáno v 3.3.3.

**B. Úklid se po zastavení smyčky zopakuje.** Kontrola stavu i zastavení smyčky jsou samy o sobě závod: mezi kontrolou a koncem dávky se dá stihnout další `INSERT`. Job proto po zjištění `cancelled` provede krok 2 z 3.6.3 ještě jednou nad vlastní kampaní a teprve pak skončí. Druhé opakování je levné, protože po zastavení smyčky už nikdo nic nevkládá, a jeho výsledek je nula nebo jednotky tisíc řádků.

Symetricky totéž platí pro `cancel` doručený ve chvíli, kdy job zrovna neběží: úklid v 3.6.3 běží po dávkách po 10 000 řádcích, dokud `UPDATE` vrací nenulový počet, ne jedním průchodem.

**Kontrolní dotaz, který na tenhle stav ukazuje**, patří do `outbox.stall_watch` (3.7.4) vedle stávajících dvou:

```sql
SELECT m.campaign_id, count(*) AS orphaned_pending
  FROM messages m
  JOIN campaigns c ON c.id = m.campaign_id
 WHERE m.status = 'pending'
   AND c.status IN ('cancelled','sent','partially_sent','failed')
 GROUP BY m.campaign_id;
```

Nenulový výsledek znamená, že selhalo A i B, a je to porucha, ne provozní stav. Hlásí se jako `error`, ne jako varování.

`cancelled` kampaň má v reportu jasně napsané „Zrušeno. Odesláno 12 340 z 50 000 příjemců." Statistiky pro odeslanou část zůstávají platné a dál se aktualizují příchozími událostmi.

#### 3.6.4 Vrácení kampaně a undo okno

Konkurence (Mailchimp, Customer.io, Ecomail, Sendy, Listmonk, Mautic) odeslanou kampaň vzít zpět neumí, Mailchimp to nabízí jen v Premium a jen nad 10 000 příjemců. Naše architektura to zvládá skoro zadarmo, protože zrušení je změna stavu řádků, které si sender ještě neodebral. Stojí za to z toho udělat výslovnou funkci, ne vedlejší efekt.

Jsou to **dvě různé věci** a je důležité je nezaměňovat:

**1. Odložený start (skutečné undo, nic neodejde).** Kampaň se materializuje ihned, ale sender ji nezačne odbavovat dřív než v `campaigns.release_at`. Realizuje se jedním sloupcem v outboxu, žádná nová logika:

```sql
-- při materializaci
next_attempt_at = COALESCE(campaigns.release_at, campaigns.audience_built_at)
```

Claim dotaz z kontraktu už podmínku `m.next_attempt_at <= now()` obsahuje, takže sender se nemusí měnit vůbec.

| Parametr | Hodnota |
|---|---|
| Výchozí délka okna | 60 sekund |
| Kde se nastavuje | `workspaces.settings.campaigns.undo_window_seconds`, tedy **na úrovni projektu** |
| Odkud se bere výchozí hodnota a strop | `CAMPAIGN_UNDO_WINDOW_SECONDS` (env instalace, výchozí 60, rozsah 0 až 900) |
| Rozsah pro projekt | 0 až hodnota z env, tedy projekt smí okno **zkrátit nebo vypnout, ne prodloužit** |
| Chování při 0 | funkce je vypnutá, odesílá se okamžitě |
| Co uživatel vidí | Odpočet „Odesíláme za 47 s" s velkým tlačítkem **Vzít zpět** / **Undo** |
| Co dělá Vzít zpět | `sending → cancelled`, všechny zprávy `pending → skipped`. **Neodešel ani jeden mail.** |
| Po vypršení | Tlačítko se změní na Pozastavit a platí 3.6.1 |

Zdůvodnění výchozí minuty: nejčastější chyba není špatné publikum (to uživatel vidí v preflightu), ale překlep v předmětu, který si přečte až v okamžiku, kdy zmáčkne Odeslat. Šedesát sekund tuhle chybu zachytí a zpozdí kampaň zanedbatelně.

**Sjednocení dvou míst, která si dřív protiřečila.** Undo okno bylo v tomhle dokumentu na jednom místě popsané jako „nastavitelné v projektu" a na druhém (tabulka 4.6) jako proměnná prostředí celé instalace. To jsou dvě různá nastavení a implementátor by podle toho, kterou kapitolu čte, postavil buď jedno, nebo druhé. **Platí obojí ve vztahu nadřízenosti**, stejným mechanismem jako u prahů ochranných brzd v 3.15.2: env je výchozí hodnota **a zároveň strop**, projekt se smí pohybovat jen pod ní.

Směr stropu je tady opačný než u brzd a je to schválně. U brzd je nebezpečná volba volnější práh, tady je nebezpečná volba **delší** okno: uživatel zmáčkne Odeslat, čeká, že se odesílá, a ono se pět minut nic neděje. Provozovatel instalace tedy určuje, jak dlouhé zdržení je ještě přijatelné, a projekt si smí okno zkrátit nebo vypnout, protože tím škodí nejvýš sám sobě a zkrácení nikoho nepřekvapí.

**2. Zastavení rozjeté kampaně (část už odešla).** To je `pause` nebo `cancel` podle 3.6.1 a 3.6.3. UI o tom **nikdy nemluví jako o vrácení**, protože odeslaný mail vrátit nejde. Text je „Zastaveno. Odesláno 12 340 z 50 000, ty už zpátky nevezmeme." / „Stopped. 12,340 of 50,000 sent, those can't be recalled."

Do stavového diagramu 3.1.2 to nepřidává nový stav. `release_at` je jen značka uvnitř `sending`, kterou UI zobrazuje jinak.

### 3.7 Sledování průběhu a uzavření kampaně

#### 3.7.1 Čítače

Čítače v `campaigns` jsou denormalizované, protože report kampaně s milionem zpráv nemůže při každém načtení agregovat outbox.

**Dělí se na dvě skupiny, které mají různý zdroj pravdy a nesmí se plést.** Je to nejdůležitější věta téhle kapitoly a plyne přímo z toho, že `sent` je koncový stav.

| Skupina | Čítače | Zdroj pravdy | Význam |
|---|---|---|---|
| **Předání provideru** | `total_count`, `sent_count`, `failed_count`, `skipped_count` | `messages.status` | podařilo se nám zprávu předat SES nebo SMTP serveru? |
| **Doručení** | `delivered_count`, `bounce_count`, `complaint_count` | `message_events` | co se se zprávou stalo potom u příjemce? |

`failed_count` tedy znamená **„nepodařilo se předat provideru"**, ne „nedorazilo". Zpráva, kterou SES přijal a která se pak odrazila, má `status = 'sent'`, započítá se do `sent_count` a do `bounce_count`, a do `failed_count` **nikdy**.

Obě skupiny se aktualizují dvěma cestami:

1. **Inkrementálně.** Skupina „doručení" při zpracování události, skupina „předání" po zápisu senderu, obojí přes `UPDATE campaigns SET <sloupec> = <sloupec> + $n`.
2. **Rekoncilací** v jobu `campaign.watchdog` každých 15 sekund, ale **dvěma samostatnými dotazy nad dvěma tabulkami**:

```sql
-- A. skupina "předání provideru", zdroj messages
SELECT status, count(*) FROM messages
 WHERE campaign_id = $id AND created_at = $audience_built_at
 GROUP BY status;

-- B. skupina "doručení", zdroj message_events. Počítá se DISTINCT přes message_id,
--    protože tatáž zpráva může mít víc událostí téhož typu (opakovaný bounce).
SELECT type, count(DISTINCT message_id) FROM message_events
 WHERE campaign_id = $id
   AND type IN ('delivered','bounced_hard','bounced_soft','complained')
   AND received_at >= $audience_built_at
 GROUP BY type;
```

**Dotaz A nesmí nikdy plnit `delivered_count`, `bounce_count` ani `complaint_count`, a dotaz B nesmí plnit `sent_count` ani `failed_count`.** Zní to samozřejmě, ale je to přesně ta záměna, která projde code review, protože `COUNT(status = 'failed')` vypadá jako nedoručitelnost a chová se správně až do prvního bouncu.

Inkrementální cesta je rychlá a může se rozejít, rekoncilace je pomalejší a je zdrojem pravdy. Rozdíl nad 1 % se loguje jako varování.

Sender čítače **neaktualizuje sám**, jen mění `messages.status`. Důvod: jinak by potřeboval zapisovat do `campaigns` a musel by řešit soupeření o řádek kampaně při vysoké propustnosti. Toto je požadavek na část 4b (R4b.3).

#### 3.7.2 Uzavření kampaně

Watchdog uzavírá kampaň, když platí obojí:

- v outboxu není žádná zpráva ve stavu `pending` ani `claimed`,
- od poslední změny čítačů uplynulo alespoň 10 sekund (ochrana proti závodu s doběhem dávky).

Výsledný stav se počítá **výhradně ze skupiny „předání provideru"**, protože uzavření kampaně je otázka „doposlali jsme to?", ne „dorazilo to?":

```
failed_count + skipped_count == total_count                  → 'failed'    (nepředali jsme nic)
(failed_count + skipped_count) / total_count > 0.01           → 'partially_sent'
jinak                                                          → 'sent'
```

**Kampaň, ze které se všechno předalo a všechno se pak odrazilo, se uzavře jako `sent`.** Je to správně: odeslali jsme ji celou. Že byla nedoručitelná, řekne report a dashboard doručitelnosti, a s vysokou pravděpodobností ji ještě před koncem zastaví automatická brzda z 3.15.2. Kdyby uzavírací pravidlo koukalo na bouncy, čekalo by na dobíhající události a kampaň by se neuzavřela hodiny po skutečném konci.

Práh 1 % je konfigurovatelný přes `CAMPAIGN_PARTIAL_THRESHOLD`. Zdůvodnění: u kampaně na 50 000 lidí je 200 přeskočených adres normální provoz (mezitím se odhlásili), 5 000 je signál, že něco nesedí, a nemá se to schovat pod zelenou fajfku.

Při uzavření se odešle odchozí webhook `campaign.sent` (viz 4.4) a zapíše se `finished_at`.

#### 3.7.3 Neměnnost kampaně během odesílání a cache senderu

Sender si načte hlavičku kampaně jednou a drží ji v cache po celou dobu odbavování. **Garantuju, že se po přechodu do `sending` nezmění** tyhle sloupce:

```
subject, preheader, from_name, from_email, reply_to,
compiled_html, compiled_text, compiled_fields,
provider_id, sender_domain_id, track_opens, track_clicks,
unsubscribe_list_id, audience_built_at
```

Vynucuje to trojice opatření:

1. **API.** `PATCH /campaigns/{id}` na kterýkoliv z těch sloupců vrací `409 campaign_locked`, jakmile je stav mimo `draft` a `schedule_missed`.
2. **Databáze.** Trigger `trg_campaigns__immutable_while_sending` vyhodí výjimku při pokusu změnit ta pole ve stavech `queueing`, `sending`, `paused`. Je to pojistka proti přímému zápisu a proti chybě v aplikaci, ne náhrada bodu 1.
3. **Revize.** Sloupec `campaigns.revision` se inkrementuje při každé změně kterékoliv z těch hodnot, tedy prakticky jen ve stavu `draft`.

**Klíč cache senderu je `(campaign_id, revision)`.** Když se hodnoty přece jen změní (například po `cancel` a novém odeslání duplikátu, nebo kdyby někdo v budoucnu neměnnost změkčil), sender pozná zastaralost porovnáním `revision` a načte hlavičku znovu. Doporučuju načítat `revision` v claim dotazu, protože ho stejně joinuje na `campaigns`, a znovu načíst hlavičku jen při změně čísla. Cache tak nemá TTL a nemůže zastarat. Zapsáno jako R4b.15.

**`subject` je Liquid šablona.** Interpoluje se stejným subsetem a stejnou implementací jako tělo, takže `Předmět pro {{ contact.first_name | default: "vás" }}` funguje. Důsledky, na které je nutné myslet:

- Předmět prochází stejnou validací Liquid subsetu jako tělo (část 3).
- Merge tagy z předmětu **patří do `compiled_fields`**, jinak by jejich hodnoty nebyly v `render_data`. Je to požadavek R3.7 na část 3.
- V předmětu se **neescapuje HTML**, na rozdíl od těla. Automatické escapování z kontraktu 2 platí pro HTML kontext; předmět HTML kontext není a `&amp;` v předmětu je viditelná chyba. Sender proto musí předmět renderovat v textovém režimu. Zapsáno jako R4b.16.
- Preheader se chová stejně jako předmět.

#### 3.7.4 Dozor nad zaseknutými zprávami

**Uvolňování zaseknutých claimů vlastní sender, ne aplikace.** Část 1 to v kontraktu 1 určuje jednoznačně: reaper běží v senderu každých 30 sekund, uvolňuje zprávy s `claim_expires_at < now()` a **jen ty, u kterých ještě nezačalo odesílání** (`dispatch_started_at IS NULL`). Claim se udržuje heartbeatem každých `SENDER_CLAIM_TTL_SECONDS / 3` sekund. Původní job `outbox.reap` v aplikaci jsem proto zrušil, byla by to duplicitní a nebezpečná logika: aplikace nemá informaci, jestli zpráva právě letí do SES.

Co v aplikaci zůstává, je **dohled nad tím, že se to děje**. Job `outbox.stall_watch` běží každých 60 sekund a hlásí anomálie, ale nic neopravuje:

```sql
SELECT campaign_id,
       count(*) FILTER (WHERE claim_expires_at < now() - interval '5 minutes'
                          AND dispatch_started_at IS NULL)        AS reaper_backlog,
       count(*) FILTER (WHERE dispatch_started_at IS NOT NULL
                          AND dispatch_started_at < now() - interval '15 minutes') AS ambiguous
  FROM messages
 WHERE status = 'claimed'
   AND created_at >= now() - interval '7 days'
 GROUP BY campaign_id
HAVING count(*) > 0;
```

| Nález | Význam | Reakce |
|---|---|---|
| `reaper_backlog > 0` | claim vypršel před víc než 5 minutami a nikdo ho neuvolnil | žádný sender neběží. Kampaň se **nepozastavuje**, ale v UI se objeví „Odesílání stojí. Zkontrolujte, jestli běží odesílací proces." |
| `orphaned_pending > 0` | `pending` zprávy v kampani, která je v koncovém stavu (druhý dotaz v 3.6.3.1) | **porucha, ne provozní stav.** Znamená, že selhal závod zrušení s materializací a ty řádky navěky brání odpojení oddílu (3.18.2). Hlásí se jako `error`, ne varování, a řeší se doběhnutím úklidu z 3.6.3 nad dotčenou kampaní. |
| `ambiguous > 0` | odesílání začalo před víc než 15 minutami a nedoběhlo | pravděpodobný pád senderu mezi voláním provideru a zápisem výsledku. Číslo se ukazuje v dashboardu jako „nejasně odeslané zprávy". Rozhodnutí, co s nimi, vlastní část 4b (viz R4b.12). |

Zprávy, které cyklí (`attempts` vysoké, stále `pending`), řeší retry politika senderu, ne aplikace.

### 3.8 Providery: konfigurace, ověření, příjem událostí

#### 3.8.1 Nastavení SES provideru

Průvodce má čtyři kroky a každý je samostatně opakovatelný.

**Krok 1: přístupové údaje.** Uživatel zadá `region`, `accessKeyId`, `secretAccessKey`. Nástroj ověří klíč voláním `GetAccount` (SES v2). Výsledky:

| Výsledek | Stav provideru | Co uvidí uživatel |
|---|---|---|
| 200 | `verifying` | „Připojeno. Účet je v produkčním režimu, limit 50 000 zpráv za den." nebo varování o sandboxu |
| `InvalidClientTokenId`, `SignatureDoesNotMatch` | `unverified` | „Přístupové údaje nejsou platné." |
| `AccessDeniedException` | `unverified` | „Klíč nemá oprávnění. Potřebujeme tyhle akce: …" plus seznam z 6.2 |
| síťová chyba, timeout 10 s | `unverified` | „Nepodařilo se spojit s Amazonem. Zkusit znovu." |

**Krok 2: Configuration Set.** Nástroj vytvoří (nebo najde) Configuration Set jménem `mlain-<workspace_slug>`:

1. `GetConfigurationSet` na jméno. Když existuje a je náš (má tag `mlain:workspace = <id>`), použije se.
2. Jinak `CreateConfigurationSet` s `ReputationOptions.ReputationMetricsEnabled = true` a `TrackingOptions` **nenastaveným**, protože open a click tracking řešíme vlastními tokeny, ne SESem. Dvojí tracking by přepisoval odkazy dvakrát.
3. `PutConfigurationSetSuppressionOptions` se `SuppressedReasons = ['BOUNCE','COMPLAINT']`. Účtová suppression u Amazonu je druhá pojistka vedle naší vlastní.

**Krok 3: SNS topic a odběr.** Nástroj:

1. `CreateTopic` jménem `mlain-<workspace_slug>-events` (idempotentní, vrátí existující ARN).
2. `CreateConfigurationSetEventDestination` s `SnsDestination.TopicArn` a `MatchingEventTypes`:
   `SEND, REJECT, BOUNCE, COMPLAINT, DELIVERY, DELIVERY_DELAY, RENDERING_FAILURE`.
   **`OPEN` ani `CLICK` nezapínáme**, ty vlastní část 5 přes vlastní tokeny.
3. `Subscribe` s `Protocol = 'https'` a `Endpoint = <APP_URL>/api/webhooks/ses/<provider_id>`. Nastaví se `RawMessageDelivery = false`, protože potřebujeme podepsanou obálku SNS.
4. Uloží `snsTopicArn` do `config_public` a stav nastaví na `verifying`, dokud nedorazí a nepotvrdí se `SubscriptionConfirmation`.

Když uživatel nechce, aby nástroj sahal na jeho AWS, existuje **ruční režim**: nástroj vypíše přesné hodnoty (jméno Configuration Setu, seznam typů událostí, URL endpointu) a uživatel je nastaví sám. Stav provideru se pak zvedne na `ready` až po přijetí první potvrzené SNS zprávy.

**Krok 4: doména.** Viz 3.12.

#### 3.8.2 Nastavení SMTP provideru

Test připojení: otevře se spojení na `host:port`, provede se STARTTLS nebo přímé TLS podle `encryption`, přihlášení, `NOOP`, `QUIT`. Timeout 10 sekund. Neposílá se testovací mail, protože uživatel na to v tomhle kroku nečeká.

| Chyba | Kód | Text pro uživatele (cs) |
|---|---|---|
| DNS nenajde host | `provider_smtp_host_unknown` | „Server {host} se nepodařilo najít." |
| Odmítnuté spojení | `provider_smtp_connection_refused` | „Server odmítl spojení na portu {port}." |
| Neplatný certifikát | `provider_smtp_tls_invalid` | „Certifikát serveru není platný. Zkontrolujte název serveru." |
| 535 auth failed | `provider_smtp_auth_failed` | „Uživatelské jméno nebo heslo nesedí." |
| timeout | `provider_smtp_timeout` | „Server neodpověděl do 10 sekund." |

U SMTP se v UI zobrazí trvalé upozornění: **„Obyčejný SMTP server nám neumí hlásit nedoručené maily a stížnosti. Seznam zakázaných adres proto musíte udržovat ručně."** Tohle je věcné a nesmí se to schovávat.

Zpětná vazba u SMTP se v MVP 0 řeší jen tím, co vrátí samotný SMTP dialog při odeslání: kód 5xx při `RCPT TO` je hard bounce, 4xx je soft. Asynchronní bounce maily do schránky (fáze 2) tato část nespecifikuje, patří to do samostatné funkce „bounce mailbox" v MVP 1.

#### 3.8.3 Endpoint pro příjem SNS

```
POST /api/webhooks/ses/{provider_id}
Content-Type: text/plain; charset=UTF-8    (SNS posílá text/plain, ne application/json)
```

Endpoint je veřejný, bez autentizace. Ochranu dělá ověření podpisu, ne autentizace, protože SNS žádnou nemá.

Odpověď je vždy `200 OK` s prázdným tělem, **s výjimkou** neúspěšného ověření podpisu, které vrací `403`. Zdůvodnění: SNS opakuje doručení při každém non-2xx a exponenciálně, takže vracet 500 na naši vlastní chybu zpracování by znamenalo zesílení provozu. Chyby zpracování proto řešíme uložením do `provider_event_receipts` se stavem `unmatched` nebo `invalid` a vlastním retry, ne odmítnutím zprávy.

Limit velikosti těla: 256 kB (SNS má strop 256 kB). Nad to `413`.

#### 3.8.4 Ověření podpisu SNS (kontrolní otázka 12)

Postup, přesně podle dokumentace AWS ověřené 31. 7. 2026:

1. **Naparsovat tělo jako JSON.** Když to není JSON, `400`, zapsat `invalid`.
2. **Zkontrolovat `Type`.** Povolené hodnoty: `Notification`, `SubscriptionConfirmation`, `UnsubscribeConfirmation`. Jiná hodnota → `400`.
3. **Zkontrolovat `TopicArn`** proti `config_public.snsTopicArn` uloženému u `provider_id` z cesty. Nesouhlas → `401 signature_invalid` s `params.reason = "topic_mismatch"`. Tohle je obrana proti tomu, aby někdo přihlásil náš endpoint ke svému topicu a podstrčil nám události.
4. **Zkontrolovat `SigningCertURL`.** Musí platit současně:
   - schéma `https`,
   - host odpovídá regulárnímu výrazu `^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$`,
   - cesta končí `.pem`.
   Jinak `401 signature_invalid` s `params.reason = "cert_url_not_allowed"`. Bez téhle kontroly je celé ověření k ničemu, protože útočník by podstrčil vlastní certifikát.
5. **Stáhnout certifikát** přes HTTPS s timeoutem 5 s a limitem 32 kB. Výsledek se cachuje v paměti procesu podle URL na 24 hodin, protože AWS certifikát mění zřídka a stahovat ho u každé zprávy by přidalo latenci i závislost na dostupnosti.
6. **Sestavit string to sign.** Pole se řadí abecedně podle názvu, každé pole je `název\nhodnota`, oddělené `\n`. Zahrnují se pouze tato pole a jen pokud jsou v těle přítomná:

   | `Type` | Pole, v tomto pořadí |
   |---|---|
   | `Notification` | `Message`, `MessageId`, `Subject` (jen pokud je), `Timestamp`, `TopicArn`, `Type` |
   | `SubscriptionConfirmation`, `UnsubscribeConfirmation` | `Message`, `MessageId`, `SubscribeURL`, `Timestamp`, `Token`, `TopicArn`, `Type` |

   Poznámka: dokumentace AWS uvádí, že se za poslední pole newline **nepřidává**, ale referenční implementace AWS a knihovna `sns-validator` závěrečný newline přidávají. **Ověřovací poznámka:** implementace musí obě varianty ověřit proti reálné zachycené zprávě a golden fixture s ní se uloží do `packages/contracts/fixtures/sns/`. Doporučené řešení je nepsat vlastní implementaci a použít `sns-validator` (viz kapitola 9).

7. **Vybrat algoritmus** podle `SignatureVersion`: `1` znamená SHA1, `2` znamená SHA256. Zprávy se `SignatureVersion` mimo `{1,2}` se odmítají. Doporučené nastavení topicu je verze 2, průvodce ji nastavuje přes `SetTopicAttributes` s `SignatureVersion = 2`.
8. **Ověřit podpis** `Signature` (base64) veřejným klíčem z certifikátu proti stringu z kroku 6. Neplatný → `401 signature_invalid` s `params.reason = "bad_signature"`, zápis do auditu jako bezpečnostní událost.
9. **Zkontrolovat stáří.** `Timestamp` starší než 1 hodina → zpráva se přijme (200), ale zaznamená se jako `invalid` s `reason = "stale_timestamp"`. Nezpracovává se, protože pořadí u tak staré zprávy už nedává smysl a je to spíš útok replayem.

#### 3.8.5 Obsluha `SubscriptionConfirmation`

Když `Type = 'SubscriptionConfirmation'` a podpis je platný:

1. Ověří se, že `TopicArn` odpovídá očekávanému topicu provideru (krok 3 výše). Tohle je nejdůležitější kontrola celého toku, protože potvrzení odběru je jediný okamžik, kdy útočník může napojit náš endpoint na cizí topic.
2. Ověří se, že `SubscribeURL` má host odpovídající `^sns\.[a-z0-9-]+\.amazonaws\.com(\.cn)?$`. Bez toho by nás podepsaná zpráva mohla poslat na cizí URL.
3. Provede se `GET` na `SubscribeURL` s timeoutem 10 s. Alternativně (a preferovaně, když máme AWS credentials daného provideru) `ConfirmSubscription` přes SDK s `Token` z těla, protože pak nemusíme dělat slepý HTTP request.
4. Do `sending_providers.status_detail` se zapíše `{ sns_subscription_confirmed_at }` a stav provideru se posune z `verifying` na `ready`, pokud jsou splněné i ostatní podmínky z 3.11.
5. Zapíše se audit `provider.sns_subscription_confirmed`.

`UnsubscribeConfirmation` se ověří stejně a zaznamená se do auditu jako varování, protože znamená, že někdo odběr zrušil a přestanou nám chodit události. Provider přejde do `degraded` a v UI se objeví „Přestali jsme dostávat informace o doručení. Zkontrolujte nastavení SNS."

### 3.9 Normalizace událostí, idempotence a pořadí (kontrolní otázka 11)

#### 3.9.1 Idempotence

SNS garantuje doručení **nejméně jednou**. Tatáž zpráva tedy může dorazit dvakrát, třikrát, i s odstupem hodin.

Dedup klíč se počítá takto, v tomto pořadí priorit:

```
dedup_key = 'sns:' || SNS.MessageId
```

`SNS.MessageId` je stabilní napříč opakovanými pokusy o doručení téže publikované zprávy, takže je to správný a nejlevnější klíč.

Druhá vrstva, pro případ, že by SES tutéž událost publikoval jako dvě různé SNS zprávy (pozorováno u `Delivery` při vícenásobných příjemcích):

```
content_key = 'ses:' || sha256(
    ses_message_id || '|' || event_type || '|' || recipient_email || '|' || event_timestamp_iso
)
```

Zpracování je tedy:

```sql
INSERT INTO provider_event_receipts (workspace_id, provider_id, dedup_key, sns_message_id,
                                     event_type, raw, received_at, status)
SELECT $ws, $provider, $dedup_key, $sns_id, $type, $raw, $now, 'received'
 WHERE NOT EXISTS (
   SELECT 1 FROM provider_event_receipts
    WHERE workspace_id = $ws
      AND dedup_key    = $dedup_key
      AND received_at >= date_trunc('month', $now)   -- jen aktuální oddíl, viz 2.6
 )
ON CONFLICT (workspace_id, dedup_key, received_at) DO NOTHING
RETURNING id;
```

Když `RETURNING` nevrátí nic, zpráva už byla přijata a zpracování končí. Endpoint vrátí `200` a nic dalšího nedělá.

**Proč `NOT EXISTS` a ne jen `ON CONFLICT`.** Unikátní index musí obsahovat partiční klíč `received_at` (2.6), a ten je `now()`, tedy pokaždé jiný. `ON CONFLICT (workspace_id, dedup_key, received_at)` by proto nikdy nesepnul a dedup by neexistoval. Skutečnou práci dělá `NOT EXISTS`, které jede po prefixu téhož indexu `(workspace_id, dedup_key)` a je omezené na aktuální oddíl, takže se neprohledávají všechny měsíce zpětně. `ON CONFLICT` zůstává jako pojistka proti závodu dvou workerů ve stejné mikrosekundě.

`id` v seznamu sloupců není: doplní ho `DEFAULT uuidv7()`, stejně jako v materializaci.

Totéž se zopakuje s `content_key` uvnitř jobu `provider_event.process`, než se událost zapíše do `message_events`.

Třetí vrstva, nejtvrdší: pro typy, které se nemají opakovat (`sent`, `delivered`, `bounced_hard`, `bounced_soft`, `complained`), je unikátní dvojice `(message_id, type)`. Vkládá se přes `ON CONFLICT DO NOTHING`:

```sql
CREATE UNIQUE INDEX uq_message_events__once_per_message
  ON message_events (message_id, type, received_at)
  WHERE type IN ('sent','delivered','bounced_hard','bounced_soft','complained');
```

`received_at` v indexu je jen proto, že jde o partition key a Postgres ho v unikátním indexu vyžaduje. Sémanticky tedy tenhle index brání duplicitě **jen uvnitř jedné měsíční partition**, stejně jako `uq_messages__campaign_contact` u outboxu. Pro události to stačí: duplicitní doručení SNS přichází v řádu minut až hodin, takže obě kopie padnou do stejné partition. Hraniční případ na přelomu měsíce zachytí první dvě vrstvy dedupu (`sns_message_id` a `content_key`), které partition neřeší vůbec.

Typy, které se opakovat mohou (`delivery_delayed`, `opened`, `clicked`), tímto indexem pokryté nejsou.

#### 3.9.2 Mapování událostí providera na interní model

| SES `eventType` | Interní `message_events.type` | Rank | Mění `messages.status`? | Poznámka |
|---|---|---|---|---|
| `Send` | `sent` | 20 | ne, sender už nastavil `sent` | Potvrzení, že SES zprávu přijal |
| `Reject` | `rejected` | 90 | ano, `failed`, ale **jen ze stavu `sent` nikdy** | Vždy `Bad content` (virus). SES zprávu odmítl, takže do `sent` se ani nedostala. |
| `Delivery` | `delivered` | 30 | ne | Zpráva dorazila na server příjemce |
| `DeliveryDelay` | `delivery_delayed` | 25 | ne | Opakovatelná událost |
| `Bounce` + `Permanent` | `bounced_hard` | 80 | **ne** | Suppression ano, ale stav zprávy zůstává `sent`, viz níže |
| `Bounce` + `Transient` | `bounced_soft` | 60 | ne | Čítač soft bounců |
| `Bounce` + `Undetermined` | `bounced_soft` | 60 | ne | Čítač soft bounců |
| `Complaint` | `complained` | 85 | ne | Suppression, ale zpráva byla doručena |
| `Rendering Failure` | `render_failed` | 90 | **ne** | Nemělo by nastat, my šablony SESu neposíláme |
| `Subscription` | ignoruje se | – | ne | Týká se SES contact listů, které nepoužíváme |
| `Open`, `Click` | ignoruje se | – | ne | Vlastníme sami, viz část 5 |

#### 3.9.3 Řešení pořadí

SNS **negarantuje pořadí**. `Delivery` může dorazit po `Bounce`, `Send` po `Delivery`.

Řešení stojí na **čtyřech** pravidlech. Dřívější znění tvrdilo, že na dvou, a pak jich vyjmenovalo čtyři, přičemž dvě z nich měla shodně očíslovaná jako „Pravidlo 3". Přečíslováno:

**Pravidlo 1: `message_events` je append only a přijímá cokoliv.** Každá platná událost se uloží se svým vlastním `ts` od providera. Reporty (část 5) počítají výhradně z téhle tabulky, takže pořadí příjmu je pro ně irelevantní.

**Pravidlo 2: `sent`, `failed` a `skipped` jsou koncové stavy a příchozí událost je už nikdy nemění.**

Tohle je rozhodnutí orchestrátora a je správné, moje původní verze ho porušovala. `messages.status` popisuje **náš výsledek odeslání**, tedy jestli jsme zprávu předali provideru. Co se s ní stalo potom, patří výhradně do `message_events`.

Konkrétně: tvrdý bounce, který dorazí po úspěšném předání do SES, **nechá stav `sent`** a zapíše se jen jako událost. Report ho pozná z `message_events`, ne ze stavu zprávy. Suppression proběhne nezávisle na stavu.

Praktický důvod je stejně silný jako ten sémantický: kdyby pozdní bounce přepisoval `sent` na `failed`, čítač `failed_count` by po uzavření kampaně dál rostl, kampaň už uzavřená jako `sent` by se musela přepočítat na `partially_sent`, a report, na který se uživatel díval ráno, by odpoledne ukazoval jiná čísla. Report, jehož čísla se zpětně mění, je k ničemu.

Stav tedy mění **jen sender** (`pending → claimed → sent | failed`) a **jen aplikace** u `pending → skipped`. Příchozí událost od providera nemění stav nikdy.

**Pravidlo 3: pro pořadí událostí slouží rank, ne stav zprávy.** Rank je sloupec v tabulce v 3.9.2 a ukládá se do `message_events.rank`. Konzument (report, webhook) podle něj pozná, že událost s nižším rankem, která dorazila později, je starší informace. Aktualizace stavu, která z toho plyne, je tedy jen tahle jediná a týká se výhradně senderu:

```sql
-- Jediná změna stavu, kterou dělá zpracování události: žádná.
-- Zapisuje se pouze událost, stav zprávy zůstává tak, jak ho nastavil sender.
INSERT INTO message_events (id, workspace_id, message_id, message_created_at,
                            campaign_id, contact_id, recipient, type, rank, ts, source, metadata)
VALUES (...)
ON CONFLICT DO NOTHING;
```

Důsledky, které jsou správné:

- `Bounce Permanent` po `sent`: stav zůstává **`sent`**, protože jsme zprávu opravdu odeslali. V `message_events` je `bounced_hard`, adresa jde na suppression list a report ukáže „doručeno 0, odraženo 1".
- `Delivery` dorazí po `Bounce Permanent`: obě události jsou v `message_events`, stav se nemění ani jednou. Konzument pozná podle ranku (30 versus 80), že bounce je novější informace. Je to konzistentní i se skutečností: SES předal zprávu serveru příjemce, ten ji přijal a až potom vygeneroval bounce.
- `Send` (rank 20) po `Delivery`: nic se nemění, `sent` už nastavil sender.
- `Complaint` (rank 85) po `Delivery`: stav zůstává `sent`, stížnost neznamená nedoručení. Suppression proběhne nezávisle.

Jediné dvě události, které by stav změnit chtěly (`Reject` a `Rendering Failure`), nastávají **před** předáním zprávy, takže zpráva v tu chvíli není `sent` a sender ji označí jako `failed` sám z odpovědi API. Do zpracování událostí to tedy nezasahuje.

**Pravidlo 4: události pro dosud neznámou zprávu.** Když sender ještě nestihl zapsat `provider_message_id`, událost nemá kam patřit. Uloží se do `provider_event_receipts` se stavem `unmatched`. Job `provider_event.rematch` běží každých 30 sekund a zkusí spárovat všechny `unmatched` mladší než 24 hodin. Po 24 hodinách se zaznamená jako `invalid` s kódem `unmatched_expired` a v dashboardu doručitelnosti se objeví číslo „nespárovaných událostí", protože trvale rostoucí hodnota znamená chybu v párování.

#### 3.9.4 Párování události na zprávu

```sql
SELECT id, created_at, workspace_id, campaign_id, contact_id, email
  FROM messages
 WHERE provider_message_id = $ses_message_id
   AND workspace_id = $ws
   AND created_at >= now() - interval '30 days'
 LIMIT 2;
```

Podmínka `created_at >= now() - interval '30 days'` tam není kvůli logice, ale kvůli **partition pruningu**: bez ní by lookup projel `idx_messages__provider_message_id` na všech existujících partition, tedy při roční historii dvanáct indexů místo jednoho nebo dvou. Třicet dní je zvolených tak, aby pokryly i nejpozdější reálné události (SES posílá `DeliveryDelay` s `expirationTime` typicky do 8 hodin, bounce od pomalých serverů do jednotek dnů), a zároveň skoro vždy znamenaly jednu nebo dvě partition.

Když vrátí 0 řádků → `unmatched`. Když vrátí 2 a víc → `invalid` s kódem `ambiguous_provider_message_id` a zápis do logu, protože to znamená chybu senderu (dva řádky se stejným SES MessageId).

U událostí, které nesou seznam příjemců (`bouncedRecipients`, `complainedRecipients`, `delayedRecipients`), se pro každou adresu ověří, že odpovídá `messages.email`. U vícepříjemcových zpráv to není relevantní, protože každou zprávu posíláme právě jednomu příjemci. Tohle je požadavek na část 4b (R4b.4).

#### 3.9.5 Párování přes značku `ml_msg` a rozřešení nejednoznačného odeslání

Část 4b přikládá ke každé zprávě message tag **`ml_msg`** s identifikátorem zprávy a SES ho vrací **v každé události** v poli `mail.tags`. Je to lepší párovací cesta než `provider_message_id` a mění mi dvě věci k lepšímu.

**1. Párování je spolehlivější.** Dosud jsem pároval přes `provider_message_id`, který zapisuje sender až po odpovědi od SES. Když událost dorazila dřív, skončila jako `unmatched` a čekala na `provider_event.rematch`. Se značkou mám identifikátor rovnou z těla události, takže **kategorie `unmatched` z drtivé většiny zmizí**. Pořadí párování je tedy:

```
1. mail.tags.ml_msg  → přímý lookup podle messages.id      (preferované)
2. provider_message_id → lookup podle indexu               (fallback, starší zprávy)
3. ani jedno         → unmatched, retry 24 h
```

**2. Nejednoznačné odeslání se rozřeší samo.** Když sender spadne mezi voláním SES a zápisem výsledku, zpráva zůstane s `error_code = 'ambiguous_dispatch'` a nikdo neví, jestli odešla. Značka přežije, i kdyby `Message-ID` nepřežilo, takže **příchod jakékoliv události pro takovou zprávu je důkaz, že odeslána byla**. Aplikace ji proto opraví:

```sql
UPDATE messages
   SET status = 'sent',
       provider_message_id = COALESCE(provider_message_id, $ses_message_id),
       sent_at = COALESCE(sent_at, $event_ts),
       error_code = NULL,
       error_detail = NULL,
       updated_at = now()
 WHERE id = $message_id
   AND created_at = $message_created_at
   AND error_code = 'ambiguous_dispatch';   -- úzká podmínka, viz rozpor 11.13
```

**Je to jediná výjimka z pravidla, že příchozí událost nemění stav zprávy** (3.9.3), a je oprávněná: nemění realitu, opravuje naši neznalost. Stav `ambiguous_dispatch` znamená „nevíme, jestli jsme předali", a událost od providera je přímý důkaz, že ano. Všechny ostatní události stav nadále nemění.

**Pozor, výjimka je v rozporu s kontraktem**, který přechod `failed → sent` zakazuje. Podrobně v 11.13, čeká na rozhodnutí.

**Co potřebuju od části 4b navíc: druhou značku pro partition.** Samotné `ml_msg` mi dá jen `messages.id`, ale primární klíč je dvousložkový, takže lookup podle samotného ID projde všechny partition. Prosím tedy o `ml_mday` s hodnotou `created_at` ve tvaru `YYYYMMDD`:

| Značka | Hodnota | K čemu |
|---|---|---|
| `ml_msg` | `messages.id` (UUID s pomlčkami) | přímé párování |
| `ml_mday` | `to_char(messages.created_at, 'YYYYMMDD')` | určení partition |
| `ml_campaign` | `campaign_id` | dohledání v CloudWatch |
| `ml_workspace` | `workspace_id` | totéž |

Omezení SES na hodnoty značek (jen `A-Za-z0-9_-`, max 256 znaků) splňuje UUID s pomlčkami i osmimístné datum. Bez `ml_mday` bych musel partition odhadovat z časové složky UUIDv7, což je křehké: `messages.id` se generuje při materializaci, ale `created_at` je `audience_built_at`, a ty se u dlouhé materializace liší.

### 3.10 Klasifikace bounců a plnění suppression listu (kontrolní otázka 14)

#### 3.10.1 Klasifikační tabulka

Kompletní mapování všech kombinací, které SES posílá, ověřeno proti dokumentaci 31. 7. 2026:

| `bounceType` | `bounceSubType` | Naše třída | Suppression | Počítá se do naší bounce rate | Poznámka |
|---|---|---|---|---|---|
| `Permanent` | `General` | hard | ano, okamžitě | ano | Obecné trvalé odmítnutí |
| `Permanent` | `NoEmail` | hard | ano, okamžitě | ano | Adresa neexistuje |
| `Permanent` | `Suppressed` | hard | ano, okamžitě | ne | Adresa je na globálním SES seznamu |
| `Permanent` | `OnAccountSuppressionList` | hard | ano, okamžitě | ne | Náš vlastní SES účtový seznam |
| `Permanent` | `OnTenantSuppressionList` | hard | ano, okamžitě | ne | Tenant seznam |
| `Permanent` | `EmailValidationSuppressed` | hard | ano, okamžitě | ne | SES email validation |
| `Transient` | `General` | soft | čítač | ne | |
| `Transient` | `MailboxFull` | soft | čítač | ne | Klasický případ mrtvé schránky |
| `Transient` | `MessageTooLarge` | **content** | ne | ne | Chyba naší šablony, ne kontaktu |
| `Transient` | `ContentRejected` | **content** | ne | ne | Chyba obsahu |
| `Transient` | `AttachmentRejected` | **content** | ne | ne | Chyba obsahu |
| `Transient` | `CustomTimeoutExceeded` | soft | čítač | ne | |
| `Undetermined` | `Undetermined` | soft | čítač | ne | |

Třída **content** je vlastní vynález a je důležitá: `MessageTooLarge` není chyba příjemce a bylo by nesprávné za ni penalizovat kontakt. Místo toho se počítá na úrovni kampaně a při překročení prahu `DELIVERABILITY_CONTENT_BOUNCE_LIMIT` (výchozí **100** výskytů) se kampaň pozastaví s `pause_reason.code = 'bounce_guard'` a hlášením „Zpráva je pro řadu příjemců příliš velká. Zmenšete obrázky v šabloně."

Práh je konfigurační proměnná, ne konstanta v próze (4.6). Sto výskytů je hodnota, u které se u kampaně na 50 000 lidí ještě dá říct „ojedinělá vada u přísných serverů", a nad kterou už jde o vadu šablony. Instalace, které posílají výrazně větší kampaně, si ho legitimně posunou.

#### 3.10.2 Prahy soft bounců

Adresa jde na suppression list, když nastane **3 soft bounce v klouzavém okně 30 dní**, počítáno napříč kampaněmi.

| Parametr | Proměnná | Výchozí |
|---|---|---|
| Počet soft bounců | `SOFT_BOUNCE_THRESHOLD` | 3 |
| Délka okna | `SOFT_BOUNCE_WINDOW_DAYS` | 30 |

Dotaz, který rozhoduje (běží v jobu po zápisu události, ne v HTTP requestu):

```sql
SELECT count(*) AS soft_count
  FROM message_events
 WHERE workspace_id = $ws
   AND lower(recipient) = lower($email)
   AND type = 'bounced_soft'
   AND ts >= now() - ($window || ' days')::interval;
```

**Žádný join na `messages`.** Původně jsem tu měl join přes `message_id`, ale ten je kvůli dvousložkovému klíči a různým partition key obou tabulek (`messages` po `created_at`, `message_events` po `ts`) drahý a v jedné verzi tohoto dokumentu byl dokonce napsaný špatně. Denormalizovaný sloupec `message_events.recipient` s indexem `idx_message_events__recipient_bounce` (2.5) to řeší jedním přístupem do indexu.

Když je práh dosažen, zapíše se suppression s `reason = 'soft_bounce_threshold'` a `metadata = { count, window_days, last_bounce_at }`.

#### 3.10.3 Stížnosti

Každá stížnost znamená **okamžitou suppression**, bez ohledu na `complaintFeedbackType`. Jediná výjimka je `complaintFeedbackType = 'not-spam'`, což je oprava předchozího chybného zařazení, a ta suppression **neprovádí** ani neruší.

`complaintSubType = 'OnAccountSuppressionList'` nebo `'OnTenantSuppressionList'` znamená, že zpráva vůbec nebyla odeslána, protože adresa byla na seznamu u Amazonu. Zaznamená se jako `complained` s příznakem `not_sent: true`, suppression se provede, ale do complaint rate se nepočítá.

Poznámka pro implementátora: `complainedRecipients` obsahuje **všechny příjemce z domény, která stížnost nahlásila**, ne nutně toho, kdo si stěžoval. U nás je zpráva vždy jednomu příjemci, takže je to jednoznačné.

#### 3.10.4 Zápis do suppression listu

Suppression list vlastní část 2. Tato část do něj zapisuje přes doménovou funkci (požadavek R2.2):

```ts
await suppressions.add({
  workspaceId,
  email,
  reason: 'hard_bounce' | 'complaint' | 'soft_bounce_threshold' | 'ses_suppressed',
  source: 'ses_event',
  metadata: { messageId, campaignId, bounceType, bounceSubType, diagnosticCode, feedbackId },
});
```

Funkce musí být idempotentní (`ON CONFLICT (workspace_id, email) DO UPDATE` na `metadata` a `updated_at`), protože tatáž adresa může bouncovat opakovaně.

Bezprostředně po zápisu se volá `revokePendingMessages` z 3.4.1, takže adresa okamžitě vypadne ze všech běžících kampaní.

#### 3.10.5 Chování při zpracování události, tabulka chybových cest

| Situace | Co se stane | Co uvidí uživatel |
|---|---|---|
| Neznámý `eventType` | Zapíše se do `provider_event_receipts` jako `invalid`, kód `unknown_event_type`, loguje se na úrovni warn | nic, je to interní |
| Zpráva nenalezena | `unmatched`, retry po 30 s po dobu 24 h | v dashboardu číslo „nespárované události" |
| Job spadne uprostřed | pg-boss ho zopakuje, dedup vrstvy zabrání dvojímu efektu | nic |
| Suppression zápis selže | job se opakuje s backoffem, událost zůstane `received` | nic, pokud se to vyřeší; jinak alarm |
| Událost pro smazaný kontakt | `message_events` se zapíše, suppression se zapíše, `contact_id` zůstane historicky | nic |

### 3.11 Stavový stroj provideru

| Stav | Podmínka | Lze odeslat kampaň? |
|---|---|---|
| `unverified` | credentials neověřené nebo neplatné | ne |
| `verifying` | credentials platné, ale chybí potvrzený SNS odběr nebo ověřená doména | ne |
| `ready` | vše v pořádku | ano |
| `degraded` | odesílat lze, ale něco nesedí: chybí DMARC, `enforcement_status = PROBATION`, přestaly chodit události | ano, s varováním |
| `blocked` | `enforcement_status = SHUTDOWN` nebo `sending_enabled = false` nebo klíč přestal platit | ne |
| `disabled` | uživatel provider ručně vypnul | ne |

Přechody `ready ↔ degraded ↔ blocked` provádí job `provider.refresh_quota` (3.14) automaticky. Přechod do `blocked` navíc pozastaví všechny běžící kampaně toho provideru s `pause_reason.code = 'provider_blocked'` a `source: "app"`.

**`CHECK (type IN ('ses','smtp'))` v 2.1 je uzavřený výčet a MVP 2 slibuje pluginové providery.** Není to chyba, ale je to místo, které se bude rozšiřovat, a musí být napsané jak. Rozšíření je jednořádková migrace (`ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT`), takže omezení zůstává, protože v MVP 0 chrání před překlepem. **Aplikační kód ale nesmí s vyčerpaností toho výčtu počítat**: žádný `switch` nad `sending_providers.type` nesmí být bez větve `default`, která neznámý typ ohlásí jako nepodporovaný provider a nechá zbytek systému běžet. Totéž platí pro `status` výše.

### 3.12 Ověření domény a generování DKIM přes SES (kontrolní otázka 16)

#### 3.12.1 Postup

1. Uživatel zadá doménu (například `example.cz`). Nástroj ji normalizuje: lowercase, odstraní `http(s)://`, odstraní `www.`, odstraní koncovou tečku, ověří, že jde o registrovatelnou doménu (ne veřejný sufix) pomocí `psl`.
2. `CreateEmailIdentity` (SES v2) s:
   ```
   EmailIdentity: "example.cz"
   DkimSigningAttributes: { NextSigningKeyLength: "RSA_2048_BIT" }
   ConfigurationSetName: "mlain-<workspace_slug>"
   Tags: [{ Key: "mlain:workspace", Value: <workspace_id> }]
   ```
   Když identita existuje, SES vrátí `AlreadyExistsException`. To není chyba, pokračuje se rovnou na `GetEmailIdentity`.
3. `GetEmailIdentity` vrátí `DkimAttributes` s poli `Tokens` (tři tokeny), `SigningHostedZone`, `Status` a `SigningAttributesOrigin`. Uloží se do `sender_domains`.
4. Nástroj vygeneruje **tři CNAME záznamy** k vložení do DNS:

   | Typ | Název | Hodnota |
   |---|---|---|
   | CNAME | `<token1>._domainkey.example.cz` | `<token1>.<SigningHostedZone>` |
   | CNAME | `<token2>._domainkey.example.cz` | `<token2>.<SigningHostedZone>` |
   | CNAME | `<token3>._domainkey.example.cz` | `<token3>.<SigningHostedZone>` |

   `SigningHostedZone` je typicky `dkim.amazonses.com`, ale v některých regionech a celách má tvar `<cell>.dkim.<region>.amazonses.com`. **Hodnotu nikdy neskládáme natvrdo, vždy ji bereme z API odpovědi.** Tohle je častá chyba a v novějších regionech vede k doméně, která se nikdy neověří.

   Do UI patří varování, které AWS explicitně uvádí: název záznamu se **nesmí** doplňovat o další podtržítko na začátku a některé DNS providery samy připojují doménu, takže je potřeba zkontrolovat výsledek.

5. Volitelně **custom MAIL FROM**. Doporučené, protože bez něj je SPF zarovnané na `amazonses.com` a DMARC pak projde jen díky DKIM. `PutEmailIdentityMailFromAttributes` s `MailFromDomain = "mail.example.cz"` a `BehaviorOnMxFailure = "USE_DEFAULT_VALUE"`. Vygenerují se dva záznamy:

   | Typ | Název | Hodnota |
   |---|---|---|
   | MX | `mail.example.cz` | `10 feedback-smtp.<region>.amazonses.com` |
   | TXT | `mail.example.cz` | `"v=spf1 include:amazonses.com ~all"` |

6. Nástroj vygeneruje **doporučený DMARC záznam**, který uživatel vloží sám, protože se týká celé domény, ne jen našeho odesílání:

   | Typ | Název | Hodnota |
   |---|---|---|
   | TXT | `_dmarc.example.cz` | `"v=DMARC1; p=none; rua=mailto:dmarc@example.cz; pct=100; adkim=r; aspf=r"` |

   UI vysvětlí, že `p=none` je bezpečný začátek a doporučí přechod na `p=quarantine` po dvou týdnech bez problémů v reportech. Nikdy nedoporučujeme rovnou `p=reject`, protože to může zastavit i legitimní poštu z jiných systémů zákazníka.

7. Do stavu `verified` se doména dostane, když platí obojí:
   - `GetEmailIdentity.VerificationStatus = 'SUCCESS'` a `DkimAttributes.Status = 'SUCCESS'`,
   - naše vlastní DNS kontrola (3.13) hlásí `dkim_ok = true` a `spf_ok = true`.

   Dvojí kontrola je záměrná: SES kontroluje ze své strany a se svou cache, my kontrolujeme aktuální stav z pohledu resolveru. Rozdíl mezi nimi je cenná informace („Amazon vidí záznamy, my ne, počkejte na propagaci DNS").

#### 3.12.2 Frekvence dotazů na stav ověření

| Fáze | Interval `next_check_at` |
|---|---|
| prvních 15 minut po založení | 30 s |
| 15 minut až 2 hodiny | 5 min |
| 2 až 72 hodin | 30 min |
| po 72 hodinách bez úspěchu | 6 h, plus v UI „Ověření trvá déle než obvykle" s odkazem na návod |
| ověřená doména | 24 h (hlídá se, že záznamy nezmizely) |

Ruční tlačítko „Zkontrolovat teď" má rate limit 1 za 30 sekund na doménu, jinak `429 rate_limited` s polem `retry_after`.

#### 3.12.3 Když záznamy zmizí

Když u ověřené domény přestane platit DKIM (SES pošle `VerificationStatus = FAILED` nebo naše kontrola nenajde CNAME), doména přejde na `dkim_ok = false`, provider na `degraded` a v UI se objeví červený pruh. **Běžící kampaň se nepozastaví**, protože SES podepisuje z klíče, který má, a přerušení by uškodilo víc. Nová kampaň se ale spustit nedá (preflight kontrola 4).

### 3.13 Kontrola SPF, DKIM a DMARC (kontrolní otázka 15)

Vlastní DNS kontroly, nezávislé na SES. Používá se vestavěný resolver Node (`node:dns/promises`), bez další závislosti.

#### 3.13.1 SPF

- **Dotaz:** `resolveTxt(<mail_from_domain>)`, kde `mail_from_domain` je `mail.example.cz` při custom MAIL FROM, jinak `example.cz`.
- **Zpracování:** TXT záznamy jsou pole polí řetězců, jednotlivé části se spojí bez oddělovače. Hledá se záznam začínající `v=spf1` (case insensitive).

| Nález | `spf_ok` | Text pro uživatele (cs) |
|---|---|---|
| žádný `v=spf1` záznam | false | „Chybí SPF záznam. Vložte do DNS: …" |
| dva a víc `v=spf1` záznamů | false | „Máte dva SPF záznamy. Podle pravidel smí být jen jeden, jinak kontrola selže u všech příjemců. Sloučte je do jednoho." |
| záznam je, ale neobsahuje `include:amazonses.com` ani `ip4`/`ip6` odpovídající SES | false | „SPF záznam neopravňuje Amazon posílat za vaši doménu. Přidejte `include:amazonses.com`." |
| záznam je a obsahuje `include:amazonses.com` | true | „SPF v pořádku." |
| záznam končí `+all` | true, ale varování | „SPF končí `+all`, což povoluje odesílání komukoliv. Doporučujeme `~all` nebo `-all`." |
| víc než 10 mechanismů vyžadujících DNS dotaz | true, ale varování | „SPF záznam překračuje limit 10 DNS dotazů, u některých příjemců selže. Zjednodušte ho." |

Počítání limitu 10 lookupů: sčítají se mechanismy `include`, `a`, `mx`, `ptr`, `exists` a modifikátor `redirect`, rekurzivně do hloubky 3. Rekurze má strop 20 dotazů a timeout 3 sekundy pro celou kontrolu; při překročení se vrátí varování „Nepodařilo se ověřit limit dotazů".

#### 3.13.2 DKIM

- **Dotaz:** pro každý ze tří tokenů `resolveCname('<token>._domainkey.<domain>')`.
- **Očekávaná hodnota:** `<token>.<dkim_hosted_zone>`. Porovnává se case insensitive, s ořezanou koncovou tečkou.

| Nález | `dkim_ok` | Text |
|---|---|---|
| všechny tři CNAME sedí | true | „DKIM v pořádku, všechny tři záznamy jsou vidět." |
| část záznamů chybí | false | „Vidíme 2 ze 3 DKIM záznamů. Zkontrolujte třetí a počkejte na propagaci DNS." |
| CNAME existuje, ale míří jinam | false | „DKIM záznam `abc._domainkey` míří na jinou hodnotu, než má. Nejspíš ho přepsal jiný nástroj." |
| `ENOTFOUND` nebo `ENODATA` | false | „DKIM záznamy zatím nejsou vidět. Změny v DNS se projeví do 72 hodin, obvykle do hodiny." |
| resolver hlásí `SERVFAIL` | null (neznámo) | „DNS server vaší domény neodpovídá. Zkusíme to znovu." |

Rozlišení mezi `false` a `null` je důležité: `null` znamená, že nevíme, a takový stav nesmí blokovat odeslání kampaně, která už jednou ověřená byla.

#### 3.13.3 DMARC

- **Dotaz:** `resolveTxt('_dmarc.<organizational_domain>')`, kde organizational domain se určí přes `psl` (u `mail.example.cz` je to `example.cz`).
- **Parsování:** středníkem oddělené dvojice `tag=value`. Povinný je `v=DMARC1` na začátku a `p=`.

| Nález | `dmarc_ok` | Barva v UI | Text |
|---|---|---|---|
| žádný záznam | false | červená | „Chybí DMARC záznam. Gmail a Yahoo ho u hromadných odesílatelů vyžadují. Vložte: …" |
| `p=none` | true | žlutá | „DMARC je nastavený na `p=none`, což jen sbírá reporty. Po dvou týdnech doporučujeme `p=quarantine`." |
| `p=quarantine` | true | zelená | „DMARC v pořádku." |
| `p=reject` | true | zelená | „DMARC v pořádku, nejpřísnější nastavení." |
| `pct` < 100 | true | žlutá | „DMARC se uplatňuje jen na {pct} % zpráv." |
| neplatná syntaxe | false | červená | „DMARC záznam má chybnou syntaxi u `{tag}`." |
| dva a víc DMARC záznamů | false | červená | „Máte víc DMARC záznamů, kontrola selže. Nechte jeden." |

Zarovnání (`adkim`, `aspf`): když je `adkim=s` (strict) a odesílá se z `example.cz` s DKIM doménou `example.cz`, je to v pořádku. Když je `aspf=s` a nemáme custom MAIL FROM, SPF zarovnání **selže**, což se v UI hlásí jako „Kvůli přísnému SPF zarovnání musíte nastavit vlastní MAIL FROM doménu."

#### 3.13.4 MX pro custom MAIL FROM

- **Dotaz:** `resolveMx('<mail_from_domain>')`.
- **Očekávání:** existuje záznam s `exchange = 'feedback-smtp.<region>.amazonses.com'`.
- Když chybí a `BehaviorOnMxFailure = USE_DEFAULT_VALUE`, hlásí se varování, ne chyba, protože SES v tom případě použije vlastní doménu a maily odejdou.

#### 3.13.5 Cache a tvar výsledku

- Výsledek se ukládá do `sender_domains.checks` a `checked_at`.
- Cache: výsledek platí `min(nejnižší TTL z odpovědí, 900 s)`, nejméně 60 s. UI zobrazuje čas poslední kontroly a tlačítko „Zkontrolovat teď".
- Timeout jednoho DNS dotazu: 3 s. Timeout celé kontroly domény: 15 s. Při překročení se nedokončené kontroly zapíší jako `null`.

```ts
type DomainChecks = {
  spf:   { ok: boolean | null; record: string | null; findings: Finding[]; checked_at: string };
  dkim:  { ok: boolean | null; found: number; expected: 3; findings: Finding[]; checked_at: string };
  dmarc: { ok: boolean | null; record: string | null; policy: 'none'|'quarantine'|'reject'|null;
           pct: number | null; findings: Finding[]; checked_at: string };
  mx:    { ok: boolean | null; records: string[]; findings: Finding[]; checked_at: string };
};
type Finding = {
  code: string;                          // např. 'spf_multiple_records'
  severity: 'error' | 'warning' | 'info';
  params?: Record<string, string | number>;  // pro i18n interpolaci
};
```

Texty jsou v katalogu zpráv (`next-intl`), ne v datech. Do `findings` jde jen kód a parametry.

### 3.14 Kvóty a detekce sandboxu (kontrolní otázka 17)

#### 3.14.1 Zdroj dat

SES v2 `GetAccount`. Používaná pole, ověřená proti API referenci 31. 7. 2026:

| Pole | Použití u nás |
|---|---|
| `SendQuota.Max24HourSend` | `quota_max_24h`, denní strop |
| `SendQuota.MaxSendRate` | `quota_max_send_rate`, zpráv za sekundu, čte sender pro throttling |
| `SendQuota.SentLast24Hours` | `quota_sent_24h`, spotřeba |
| `ProductionAccessEnabled` | `production_access`, `false` znamená sandbox |
| `EnforcementStatus` | `HEALTHY`, `PROBATION`, `SHUTDOWN` |
| `SendingEnabled` | `sending_enabled` |
| `Details.ReviewDetails.Status` | zobrazí se v UI, když probíhá schvalování produkčního přístupu |

Sandboxové hodnoty jsou podle dokumentace `Max24HourSend = 200` a `MaxSendRate = 1`, ale **nikdy je nepředpokládáme**, vždy čteme z API.

#### 3.14.2 Frekvence volání

| Kdy | Proč |
|---|---|
| při uložení nebo změně provideru | okamžitá zpětná vazba uživateli |
| job `provider.refresh_quota` každých 15 minut | udržuje dashboard aktuální |
| **vždy před přechodem kampaně do `queueing`** | preflight musí rozhodovat z čerstvých dat, ne z 15 minut staré kopie |
| každých 60 s během `sending` u kampaní nad 10 000 příjemců | hlídání vyčerpání denní kvóty za běhu |

Volání má timeout 5 s. Když selže, použije se poslední známá hodnota a přidá se varování „Stav odesílacího účtu se nepodařilo ověřit, pracujeme s údaji z {čas}." Selhání **neblokuje** běžící kampaň, ale **blokuje** spuštění nové (preflight kontrola 3).

Sender kvótu **nečte z API**, čte ji z `sending_providers`. Důvod: kdyby ji četlo pět senderů zvlášť, narazíme na rate limit SES API. Aktualizaci vlastní aplikace. Toto je požadavek R4b.5.

#### 3.14.3 Chování v sandboxu

Když `production_access = false`:

1. V UI trvale svítí oranžový pruh: **„Váš odesílací účet je v testovacím režimu. Můžete poslat 200 zpráv za den a jen na adresy, které máte u Amazonu ověřené."** s tlačítkem odkazujícím na konzoli AWS a stručným návodem, co do žádosti napsat.
2. Preflight kontrola 10 navíc ověří, že **každý** příjemce kampaně je ověřená identita. Ověřuje se přes `ListEmailIdentities` (stránkovaně, cache 5 minut) a porovnáním. Když je publikum větší než 200, kontrola se neprovádí a rovnou vrací `provider_sandbox` s textem „V testovacím režimu můžete odeslat nejvýš 200 zpráv."
3. Testovací odeslání (3.17) na neověřenou adresu vrací srozumitelnou chybu, ne surové `MessageRejected: Email address is not verified`.

#### 3.14.4 Překročení kvóty za běhu

Když během odesílání klesne `quota_max_24h - quota_sent_24h` pod `CAMPAIGN_QUOTA_PAUSE_REMAINING` (výchozí **100**):

1. Kampaň přejde do `paused` s `pause_reason = {"code":"provider_quota_exhausted","source":"app","at":…}`.
2. Uživatel dostane hlášení „Vyčerpali jste denní limit Amazonu. Kampaň bude automaticky pokračovat, jakmile se limit uvolní."
3. Job `campaign.resume_on_quota` běží každých 10 minut a obnoví kampaně, u kterých `pause_reason ->> 'code' = 'provider_quota_exhausted'` a dostupná kvóta je zase nad `CAMPAIGN_QUOTA_RESUME_REMAINING` (výchozí **1 000**).

**Job vybírá podle `code`, ne podle `source`.** Kdyby vybíral podle staré textové hodnoty `'quota'`, jak stálo v dřívějším znění, minul by každou kampaň pozastavenou senderem, protože ten zapisuje `provider_quota_exhausted`. Kampaň by stála donekonečna a tvrdila uživateli, že bude pokračovat sama. Rozbor v 3.6.1.2.

**Prahy 100 a 1 000 jsou konfigurační proměnné, ne konstanty v próze** (4.6). Mezera mezi nimi je hystereze a musí zůstat: kdyby se pauzovalo i obnovovalo na stejném čísle, kampaň by u vyčerpané kvóty cyklila mezi `paused` a `sending` každých deset minut.

Když SES vrátí `TooManyRequestsException` (429), řeší to sender backoffem a do aplikace to nejde. Když vrátí `AccountSuspendedException` nebo `SendingPausedException`, sender to musí označit jako trvalou chybu a aplikace na to reaguje přechodem provideru do `blocked` (požadavek R4b.6).

### 3.15 Dashboard doručitelnosti a automatické brzdy

#### 3.15.1 Metriky

Počítají se z `deliverability_snapshots` za zvolené období (7, 30, 90 dní):

```
bounce_rate    = hard_bounces / sent                 -- jen hard, stejně jako to počítá AWS
soft_rate      = soft_bounces / sent
complaint_rate = complaints / delivered              -- jmenovatel je doručeno, ne odesláno
delivery_rate  = delivered / sent
```

**Čitatel se počítá výhradně z `message_events`, nikdy z `messages.status`.** Je to normativní pravidlo kontraktu a plyne přímo z toho, že `sent` je koncový stav: `messages.status` popisuje, jestli jsme zprávu **předali provideru**, kdežto `message_events` popisuje, co se s ní stalo **potom**. Zpráva, která se odrazila natvrdo, má `status = 'sent'` a událost `bounced_hard`. Kdo by počítal `count(*) WHERE status = 'failed'`, dostal by nulovou nedoručitelnost u kampaně, která se celá odrazila, a brzda z 3.15.2 by nikdy nesepnula.

Jmenovatel `sent` naopak z `messages` pochází, protože je to počet skutečně předaných zpráv.

Jmenovatel u stížností je `delivered`, protože stěžovat si může jen ten, komu zpráva došla. AWS to počítá jinak (jen vůči doménám s feedback loopem), takže naše číslo je odhad. **Tohle musí být v UI napsané:** „Naše číslo je odhad. Závazná je hodnota v konzoli Amazonu."

**Dashboardová metrika a brzda mají u stížností různý jmenovatel a je to schválně.** Dřívější znění to mělo na dvou místech proti sobě: vzorec výše dělí `complaints / delivered`, kdežto 3.15.2 říkala, že jmenovatel obou brzd je `sent_count`. Obojí je správně, každé k něčemu jinému:

| Kde | Metrika | Jmenovatel | Proč právě ten |
|---|---|---|---|
| Dashboard doručitelnosti (3.15.1) | `complaint_rate` | `delivered` z `deliverability_snapshots` | Je to zpětný pohled na uzavřené období a odpovídá tomu, co měří provider. Stěžovat si může jen ten, komu zpráva došla. |
| Automatická brzda kampaně (3.15.2) | `complaint_rate` kampaně | `sent_count` kampaně | Brzda rozhoduje **za běhu**, kdy `delivered` teprve dobíhá a je systematicky podhodnocené. Poměr proti `delivered` by uprostřed kampaně skákal a v prvních minutách by dělil skoro nulou. |
| Obojí | `bounce_rate` | `sent` respektive `sent_count` | Stejně jako to počítá AWS. |

Praktický důsledek: **brzda sepne o něco později než dashboard**, protože `sent_count >= delivered`. Je to bezpečný směr, protože brzda zastavuje kampaň a falešný poplach uprostřed rozesílky je dražší než o minutu opožděný zásah. Musí to být napsané tady, protože jinak si někdo při čtení dvou kapitol vedle sebe vyloží rozdíl jako chybu a „opraví" ho.

#### 3.15.2 Prahy a co se při nich děje

| Metrika | Práh | Akce | Zdroj prahu |
|---|---|---|---|
| bounce_rate | 2 % | informace v dashboardu | doporučení AWS |
| bounce_rate | 4 % | žluté varování, mail vlastníkovi projektu | pod hranicí 5 %, od které Amazon dává účet pod dohled |
| bounce_rate | 8 % | **automatická pauza běžících kampaní** (`bounce_guard`) | naše brzda pod AWS hranicí 10 % |
| bounce_rate | 10 % | červené hlášení, provider `degraded` | AWS: může zastavit odesílání |
| complaint_rate | 0,05 % | informace | polovina AWS hranice |
| complaint_rate | 0,1 % | žluté varování, mail vlastníkovi | AWS: účet jde pod dohled |
| complaint_rate | 0,3 % | **automatická pauza** (`complaint_guard`) | naše brzda pod AWS hranicí 0,5 % |
| `enforcement_status` | `PROBATION` | provider `degraded`, červené hlášení | AWS |
| `enforcement_status` | `SHUTDOWN` | provider `blocked`, pauza všech kampaní | AWS |

Brzda čte **z `message_events`**, ne ze `status`. Jmenovatel je u obou brzd `sent_count` kampaně (kolik jsme předali provideru), čitatel je počet událostí `bounced_hard` nebo `complained` pro danou kampaň. Rozdíl proti dashboardovému `complaint_rate`, který dělí `delivered`, je vysvětlený v 3.15.1 a je záměrný. Kdyby čitatel vycházel ze `status`, byl by po zavedení koncového `sent` **vždy nula** a brzda by nesepnula nikdy, i kdyby se odrazila celá kampaň. Je to nejtišší možná porucha: nic neselže, jen ochrana přestane existovat.

**Rozhodnuto (práh varování 4 %):** varování od 2 % by se ozývalo prakticky pořád a nikdo by ho po pár týdnech nečetl, varování až od 5 % by přišlo ve chvíli, kdy Amazon už sám jedná. Čtyři procenta jsou poslední místo, kde se to dá ještě v klidu vyřešit.

Brzda se vyhodnocuje jen tehdy, když má kampaň předaných alespoň **500 zpráv** (`DELIVERABILITY_GUARD_MIN_SENT`). Bez toho by tři bouncy z prvních deseti zastavily kampaň.

**Stejná podlaha platí i pro žluté varování.** Prahy 4 % a 0,1 % se vyhodnocují až po `DELIVERABILITY_GUARD_MIN_SENT` předaných zprávách, stejně jako automatická pauza. Bez podlahy by kampaň na 25 lidí s jediným odrazem měla 4 % a spustila varování, které o doručitelnosti nevypovídá nic. Podlaha se tedy vztahuje na celou tabulku prahů, ne jen na řádky s pauzou.

#### 3.15.2.1 Prahy jdou nastavit per projekt, ale jen směrem k přísnosti

**Rozhodnutí zadavatele.** Dřívější návrh měl prahy jen jako proměnné prostředí celé instalace, k tomu jedinou možnost „v nastavení projektu jde brzdu vypnout". To je přesně obráceně, než by mělo být: **umožňovalo to tu nebezpečnou volbu (vypnout ochranu úplně) a neumožňovalo tu bezpečnou (nastavit si přísnější práh).**

Platí tedy:

> Hodnota z konfigurace instalace je zároveň **výchozí hodnota i strop**. Projekt smí nastavit práh **přísnější** (nižší), nikdy volnější. Kdo má instalační `DELIVERABILITY_BOUNCE_GUARD_RATE = 0.08`, smí si v projektu dát 5 %, ale ne 12 %.

Tři důvody, každý sám o sobě dostačující:

1. **Čísla jsou odvozená z hranic Amazonu**, ne z našeho odhadu. Osm procent je práh pod hranicí 10 %, od které Amazon může zastavit odesílání, 0,3 % je pod hranicí 0,5 %. Volnější práh proto nemá legitimní důvod: existuje jen jako způsob, jak si zničit odesílací účet. Přísnější práh naproti tomu **je normální opatrnost**, kterou agentura uplatní u nového klienta, jehož databázi zatím nezná.
2. **Brzda chrání odesílací účet a odesílací účet je v tomhle produktu per projekt** (0.2, 3.11). Nastavení, které chrání per-projektový zdroj, patří na úroveň projektu. Kdyby zůstalo jen na instalaci, jeden klient s vyčištěnou databází a druhý s deset let starým exportem by museli sdílet jedno číslo.
3. **Vypnutí brzdy zůstává možné jen změnou instalační proměnné na 0**, tedy rozhodnutím provozovatele, ne uživatele projektu. Vyžaduje explicitní potvrzení s textem, co to znamená, a zápis do auditu.

Uložení a rozsahy:

| Klíč v `workspaces.settings.deliverability` | Odpovídá env proměnné | Výchozí a strop | Rozsah pro projekt |
|---|---|---|---|
| `bounce_guard_rate` | `DELIVERABILITY_BOUNCE_GUARD_RATE` | 0.08 | 0 (vypnuto) až hodnota env |
| `complaint_guard_rate` | `DELIVERABILITY_COMPLAINT_GUARD_RATE` | 0.003 | 0 (vypnuto) až hodnota env |
| `bounce_warn_rate` | `DELIVERABILITY_BOUNCE_WARN_RATE` | 0.04 | 0 až hodnota env |
| `complaint_warn_rate` | `DELIVERABILITY_COMPLAINT_WARN_RATE` | 0.001 | 0 až hodnota env |
| `guard_min_sent` | `DELIVERABILITY_GUARD_MIN_SENT` | 500 | 1 až hodnota env |

**Prahy varování dostávají konfiguraci nově.** Dosud byly 4 % a 0,1 % zadané jen v próze v tabulce výše, přestože se podle nich posílá mail vlastníkovi projektu. U nich navíc nehrozí nic: varování nikdy nic nezastaví, takže je nebylo proč držet jako konstanty.

**U `guard_min_sent` znamená „přísnější" také nižší číslo**, i když je to podlaha a ne sazba. Nižší podlaha totiž znamená, že brzda zabere dřív, tedy s menším počtem odeslaných zpráv. Projekt ji proto smí jen snižovat a env hodnota je horní mez, stejně jako u sazeb. Cena za snížení je vyšší riziko planého poplachu na malé kampani, a to je riziko, které nese projekt sám.

Validaci provádí zod schéma `workspaces.settings.deliverability` exportované z `packages/core/campaigns` (konvence části 1, 2.5). Pokus zapsat volnější hodnotu vrací `422 validation_failed` s `path` na konkrétní klíč, ne tiché oříznutí, protože tiché oříznutí by uživateli tvrdilo, že nastavil něco, co nenastavil.

#### 3.15.3 Dlaždice dashboardu

| Dlaždice | Obsah |
|---|---|
| Stav účtu | `HEALTHY` / `PROBATION` / `SHUTDOWN`, produkční nebo testovací režim |
| Denní limit | `sent_24h / max_24h` s pruhem a časem, kdy se okno posune |
| Rychlost | `max_send_rate` zpráv za sekundu |
| Bounce rate | číslo, trend za 30 dní, barevná zóna podle 3.15.2 |
| Complaint rate | totéž |
| Doručeno | procento a absolutní číslo |
| Stav domén | seznam domén se čtyřmi kolečky (SPF, DKIM, DMARC, MX) |
| Nespárované události | číslo, žluté, když roste |

### 3.16 Politika hlaviček pro odhlášení

Sestavení MIME vlastní část 4b. **Politiku, tedy co tam má být a proč, vlastní tato část.** Hodnoty se předávají senderu přes `campaigns` a přes kontrakt trackovacích tokenů.

#### 3.16.1 Povinné hlavičky každé kampaňové zprávy

| Hlavička | Hodnota | Proč |
|---|---|---|
| `List-Unsubscribe` | `<https://<APP_URL>/u/<token>>, <mailto:unsubscribe@<mail_from_domain>?subject=<token>>` | RFC 2369. Gmail a Yahoo vyžadují u hromadných odesílatelů. Pořadí je záměrné: HTTPS první. |
| `List-Unsubscribe-Post` | `List-Unsubscribe=One-Click` | RFC 8058. Bez ní poštovní klient odkaz jen otevře, s ní odhlásí na jedno kliknutí. |
| `List-Id` | `<campaign-list.<workspace_slug>.<APP_HOST>>` | Umožní příjemci filtrovat, snižuje pravděpodobnost stížnosti |
| `Precedence` | `bulk` | Zabrání automatickým odpovědím typu „jsem na dovolené" |
| `Auto-Submitted` | `auto-generated` | RFC 3834, totéž |
| `Message-ID` | `<ml.{base32_lower(uuid_bytes(messages.id))}@{sending_domain}>` | Přesný tvar vlastní kontrakt 4.10.1 části 1, nevymýšlím ho. Je **deterministicky odvozený z `messages.id` a nikdy neobsahuje číslo pokusu ani čas**, takže opakovaný pokus po nejasném odeslání pošle identickou hlavičku. **Pozor: u SES se k příjemci nedostane**, SES `Message-ID` vždy přepisuje vlastní hodnotou. Pojistka „přijímající server duplikát zahodí" proto platí jen u obecného SMTP, viz 4.6. |
| `X-Entity-Ref-ID` | `<message_id>` | Zabrání Gmailu shlukovat různé zprávy do jednoho vlákna |

#### 3.16.2 Klíčové pravidlo pro one-click

`List-Unsubscribe-Post` znamená, že poštovní klient pošle **`POST` bez interakce uživatele**. Z toho plyne:

- Endpoint `/u/<token>` **musí** přijímat `POST` s `Content-Type: application/x-www-form-urlencoded` a tělem `List-Unsubscribe=One-Click`, a na něj odhlásit **okamžitě, bez potvrzovací stránky**. Potvrzovací stránka na `POST` je porušení RFC 8058 a Gmail to trestá.
- Tentýž endpoint na `GET` zobrazí normální stránku s preferencemi, protože `GET` znamená, že uživatel klikl na odkaz v patičce.
- Endpoint nesmí vyžadovat přihlášení, cookies ani CSRF token. Ochranou je podepsaný token.
- Endpoint musí odpovědět do 2 sekund a vrátit `200`, i když už byl kontakt odhlášený (idempotence).

Stránku s preferencemi a samotné odhlášení vlastní část 2. Tato část na ní specifikuje jen požadavek R2.3.

#### 3.16.3 Co v mailu být musí kromě hlaviček

- Viditelný odkaz na odhlášení v patičce, `{{ unsubscribe_url }}`. Preflight kontrola 11 to vynucuje.
- Fyzická adresa odesílatele. Je to požadavek CAN-SPAM a v EU pomáhá důvěryhodnosti. Bere se z `workspaces.settings.campaigns.postal_address` a v základní šabloně je v patičce. Když chybí, preflight to hlásí jako **varování**, ne blokaci, protože právní posouzení není naše role.
- Odkaz na webovou verzi, `{{ webview_url }}`. Nepovinné.

### 3.17 Testovací odeslání

`POST /campaigns/{id}/test`

```ts
type SendTestRequest = {
  recipients: string[];              // 1 až 5 adres
  contact_id?: string;               // z koho vzít data pro merge tagy
};
```

Chování:

| Vlastnost | Rozhodnutí |
|---|---|
| Jde do outboxu? | Ano, ale s `campaign_id` nastaveným na kampaň a příznakem `render_data['_test'] = true`. Důvod: testovací mail musí projít úplně stejnou cestou jako ostrý, jinak test nic netestuje. |
| Počítá se do statistik? | **Ne.** Zprávy s `_test` se vylučují z `total_count` i z `deliverability_snapshots`. Rozpoznávají se dnes podle `messages.render_data ? '_test'`, viz varování níže. |
| Obchází suppression list? | **Ano**, ale jen pro adresy, které jsou e-mailem některého člena projektu (`memberships` join `users.email`). Cizí adresa na suppression listu vrátí `422 test_recipient_suppressed`. |
| Odkud data pro merge tagy? | Když je `contact_id`, ze skutečného kontaktu. Když není, z prvních 20 kontaktů publika se vybere náhodný. Když je publikum prázdné, použijí se ukázková data (`Jana`, `Nováková`, `Jano`, `Dobrý den, Jano`). |
| Předmět | Prefixuje se `[TEST] `, aby se v schránce nepletl s ostrým odeslením. |
| Limit | `CAMPAIGN_TEST_SEND_PER_HOUR` testů na kampaň za hodinu (výchozí **20**), `429 rate_limited` s polem `retry_after`. Je to konfigurační proměnná (4.6), ne konstanta v próze: u ladění šablony s obrázky je dvacet testů za hodinu málo a je to čistě otázka zátěže instalace, ne správnosti. |
| Kdy lze | Ve stavech `draft`, `scheduled`, `schedule_missed`, `paused`. Ne během `queueing` a `sending`. |
| Stav kampaně | Nemění se. |

Testovací zprávy se z outboxu mažou po 7 dnech (retence v 3.18).

#### 3.17.1 Příznak `_test` je dočasná realizace, ne rozhraní

`render_data['_test'] = true` supluje dimenzi, která v datovém modelu chybí: **druh zprávy**. `messages` dnes neumí říct, jestli je řádek kampaňová zpráva, testovací odeslání, nebo (v budoucnu) transakční e-mail. Příznak schovaný v personalizačních datech to zastupuje a má to tři konkrétní důsledky, z nichž ani jeden není v pořádku:

1. **Statistiky se filtrují dotazem do JSONB.** Každý report, každý rollup a každá agregace musí nést `NOT (render_data ? '_test')`. Kdo na to zapomene v jednom dotazu z deseti, dostane čísla, která se liší od zbytku aplikace, a nikdo nepozná proč.
2. **`render_data` má být snapshot personalizace**, tedy data pro šablonu. Řídicí příznak v něm je cizí těleso: kompilace ho nezná, `compiled_fields` ho neobsahují a šablona s `{{ _test }}` by ho omylem vyrenderovala.
3. **Anonymizace při výmazu `render_data` vyprazdňuje** (6.5), takže by z testovací zprávy po výmazu kontaktu zmizelo i to, že byla testovací, a připočetla by se do statistik zpětně.

**Správné řešení je kontraktní sloupec `messages.kind`** s hodnotami `campaign` a `test` (a s prostorem pro `transactional`), podle kterého se filtruje indexem, ne funkcí nad JSONB. Sloupec je v outboxu, tedy v kontraktní podmnožině, takže si ho nesmím zavést sám. **Vyžádáno jako R1.18 na část 1.**

Do doby, než ho kontrakt dostane, platí `_test`. **Není to ale rozhraní pro část 5** a nesmí se tak dokumentovat: R5.6 žádá „vyloučit testovací zprávy ze všech reportů", ne „filtrovat podle `render_data ? '_test'`". Až přijde `messages.kind`, změní se jedno místo v této části a část 5 nemusí měnit nic.

### 3.18 Retence

| Data | Doba | Job |
|---|---|---|
| `messages` (partition) | `MESSAGE_RETENTION_DAYS`, výchozí 90 | `retention.drop_message_partitions`, `DROP TABLE` celé partition |
| `message_events` (partition) | `MESSAGE_EVENT_RETENTION_DAYS`, výchozí 365 | totéž |
| `provider_event_receipts.raw` | 30 dní | `UPDATE ... SET raw = '{}'::jsonb`, řádek zůstane kvůli dedupu |
| `provider_event_receipts` (partition) | 90 dní | `DROP TABLE` |
| `deliverability_snapshots` | neomezeně | – |
| `campaigns` a čítače | neomezeně | – |

Mazání partition místo `DELETE` je zásadní: `DELETE` nad desítkami milionů řádků generuje obrovské množství mrtvých řádků a `VACUUM` pak běží hodiny. `DROP TABLE` partition je okamžitý.

#### 3.18.1 Granularita retence je měsíc, ne den

Protože se retence dělá odpojením partition a partition jsou měsíční, hodnota `MESSAGE_RETENTION_DAYS = 90` **neznamená, že se zpráva smaže 90. den**. Znamená „odpoj partition, jejíž **celý rozsah** je starší než 90 dní". Reálně tedy data žijí 90 až 120 dní podle toho, kde v měsíci vznikla.

Musí to být napsané v UI i v dokumentaci, protože „nastavil jsem 90 dní a po 100 dnech tam data pořád jsou" vypadá jako chyba. Kdo potřebuje přesné mazání na den, musí použít `DELETE`, a to je vědomě nenabízíme.

#### 3.18.2 Retence nesmí odpojit partition s rozpracovanou kampaní

Tohle je důsledek invariantu z 2.4, který je snadné přehlédnout. Všechny zprávy jedné kampaně mají `created_at = campaigns.audience_built_at`, takže **celá kampaň leží v jedné partition, vybrané v okamžiku materializace**. Kampaň materializovaná 31. srpna má všechny zprávy v srpnové partition, i když se dorozesílá v září, pauzuje se a doběhne až v říjnu.

Retenční job proto **nesmí** rozhodovat jen podle stáří partition. Před odpojením ověří, že v ní neleží nic živého:

```sql
-- Blokuje odpojení partition, jejíž rozsah je [$from, $to).
SELECT 1
  FROM campaigns
 WHERE audience_built_at >= $from AND audience_built_at < $to
   AND status IN ('queueing','sending','paused')
 LIMIT 1;
```

Když dotaz vrátí řádek, partition se **neodpojí**, zaloguje se to na úrovni `warn` a zkusí se znovu příští den. Kampaň, která je `paused` déle než retenční okno, je provozní problém a má se objevit v dashboardu, ne zmizet i s daty.

Druhá pojistka na úrovni řádků, pro případ zaseknuté zprávy mimo běžící kampaň:

```sql
SELECT 1 FROM messages
 WHERE created_at >= $from AND created_at < $to
   AND status IN ('pending','claimed')
 LIMIT 1;
```

Bez těchto dvou kontrol by dost dlouhá pauza kampaně vedla k tomu, že jí retenční job odmaže outbox pod rukama a po obnovení by se tvářila jako hotová, přestože nikdy nedoběhla. Je to nízká pravděpodobnost a vysoký dopad, tedy přesně to, co patří do specifikace.

Důsledek pro uživatele: po 90 dnech přestane být vidět detail jednotlivé odeslané zprávy, ale statistiky kampaně zůstanou. To musí být v UI napsané u detailu zprávy.

---

## 4. Rozhraní

### 4.1 REST API kampaní

Všechny cesty jsou pod `/api/v1`, autentizace a formát chyb podle konvence části 1 (předpoklad P5). Všechny zápisy přijímají hlavičku `Idempotency-Key`.

| Metoda | Cesta | Scope | Popis |
|---|---|---|---|
| `GET` | `/campaigns` | `campaigns:read` | Seznam, filtr `status`, cursor stránkování |
| `POST` | `/campaigns` | `campaigns:write` | Vytvoření draftu |
| `GET` | `/campaigns/{id}` | `campaigns:read` | Detail včetně čítačů |
| `PATCH` | `/campaigns/{id}` | `campaigns:write` | Úprava, ve `scheduled` omezená (3.5.5) |
| `DELETE` | `/campaigns/{id}` | `campaigns:write` | Jen ve stavu `draft`, jinak `409` |
| `POST` | `/campaigns/{id}/duplicate` | `campaigns:write` | Kopie do `draft` |
| `POST` | `/campaigns/{id}/audience/preview` | `campaigns:read` | Náhled počtu (3.3.2) |
| `GET` | `/campaigns/{id}/preflight` | `campaigns:read` | Sada kontrol (3.2) |
| `POST` | `/campaigns/{id}/send` | `campaigns:send` | Okamžité odeslání |
| `POST` | `/campaigns/{id}/schedule` | `campaigns:send` | Naplánování |
| `POST` | `/campaigns/{id}/unschedule` | `campaigns:send` | Zrušení plánu, zpět do `draft` |
| `POST` | `/campaigns/{id}/pause` | `campaigns:send` | Pauza |
| `POST` | `/campaigns/{id}/resume` | `campaigns:send` | Obnovení |
| `POST` | `/campaigns/{id}/cancel` | `campaigns:send` | Zrušení |
| `POST` | `/campaigns/{id}/undo` | `campaigns:send` | Vzít zpět během undo okna (3.6.4). Vrací `409 campaign_undo_window_expired`, když už první zpráva odešla. |
| `POST` | `/campaigns/{id}/test` | `campaigns:send` | Testovací odeslání |
| `GET` | `/campaigns/{id}/progress` | `campaigns:read` | Živý průběh, viz 4.2 |
| `GET` | `/campaigns/{id}/messages` | `campaigns:read` | Zprávy kampaně, filtr `status`, cursor. **Vrací `id` i `created_at`**, protože samotné `id` zprávu jednoznačně nezadresuje. |

#### 4.1.1 Typy

**Výčty ve veřejném API jsou otevřené, ne uzavřené.** Platí pravidlo části 1 (4.6): přidání hodnoty do výčtu **v odpovědi** není breaking change a smí přijít kdykoliv v rámci `v1`. Klient proto musí neznámou hodnotu tolerovat, nikdy nesmí mít `switch` bez větve `default` a nikdy nesmí odpověď zahodit jen proto, že hodnotu nezná. Aby to typový systém nesváděl k opaku, jsou výčty v `sdk-node` typované vzorem `'a' | 'b' | (string & {})`, který napovídá známé hodnoty a přitom nezakazuje neznámé.

**Pravidlo platí na všechny výčty, které tahle část posílá ven**, ne jen na ty, u kterých je rozšiřitelný tvar níž vypsaný: `CampaignStatus` (4.1.1), `PauseReasonCode` (4.1.1), typ události v payloadu `message.*` (4.4), `bounce_class`, `ses_verification_status`, `dkim_status` a `DnsRecord.purpose` (4.3) i `severity` ve `Finding`. U `severity` je rozšíření nejméně pravděpodobné, ale i tam platí, že klient nesmí odpověď zahodit kvůli neznámé hodnotě; ať ji zobrazí jako neutrální.

```ts
type KnownCampaignStatus =
  | 'draft' | 'scheduled' | 'queueing' | 'sending' | 'paused'
  | 'sent' | 'partially_sent' | 'cancelled' | 'failed' | 'schedule_missed';

// Otevřený výčet: nové stavy smí přibýt v rámci v1, klient je musí tolerovat.
type CampaignStatus = KnownCampaignStatus | (string & {});

type Campaign = {
  id: string;
  workspace_id: string;
  name: string;
  status: CampaignStatus;
  subject: string;
  preheader: string;
  from_name: string;
  from_email: string;
  reply_to: string | null;
  template_id: string | null;
  audience: CampaignAudience;
  audience_size: number | null;
  provider_id: string | null;
  sender_domain_id: string | null;
  track_opens: boolean;
  track_clicks: boolean;
  scheduled_at: string | null;        // ISO 8601 UTC
  schedule_timezone: string | null;   // IANA
  counters: CampaignCounters;
  started_at: string | null;
  finished_at: string | null;
  paused_at: string | null;
  pause_reason: PauseReason | null;
  created_at: string;
  updated_at: string;
};

type CampaignCounters = {
  total: number; sent: number; failed: number; skipped: number;
  delivered: number; bounced: number; complained: number;
  pending: number;                    // dopočítané: total - sent - failed - skipped
};

// pause_reason je jsonb s jedním závazným tvarem, viz 3.6.1.1. Ne řetězec.
type PauseReasonCode =
  // zapisuje sender
  | 'render_failure_rate' | 'credentials_undecryptable'
  | 'provider_quota_exhausted' | 'provider_unavailable'
  // zapisuje aplikace
  | 'user' | 'bounce_guard' | 'complaint_guard'
  | 'provider_blocked' | 'materialize_timeout';

type PauseReason = {
  code: PauseReasonCode | (string & {});   // otevřený výčet, viz úvod 4.1.1
  source: 'sender' | 'app' | 'user';
  detail?: string;
  sender_id?: string;                      // jen když source = 'sender'
  at: string;                              // ISO 8601 UTC
};

type SendCampaignRequest = { confirm_recipient_count: number };
```

`confirm_recipient_count` je povinný a musí se rovnat aktuálnímu odhadu publika s tolerancí 1 %. Když nesedí, vrátí se `409 campaign_audience_changed` s aktuálním číslem. Chrání to před tím, aby uživatel odeslal na výrazně jiné publikum, než viděl na obrazovce, protože mezitím doběhl import.

```ts
type ScheduleCampaignRequest = {
  scheduled_at: string;               // ISO 8601, musí být v budoucnosti
  timezone: string;                   // IANA, validuje se proti Intl.supportedValuesOf('timeZone')
  confirm_recipient_count: number;
};

type PreflightResult = {
  can_send: boolean;
  findings: Finding[];          // stejný tvar jako v obálce Problem, viz níže
  audience_estimate: number;
  quota_remaining: number | null;
  checked_at: string;
};

type Finding = {
  code: string;                 // registrovaný kód ze stejného jmenného prostoru jako `code`
  severity: 'error' | 'warning';
  message: string;              // lokalizovaný podle Accept-Language
  path?: string;                // kde v kampani problém je, např. 'design.blocks.7'
  params?: Record<string, string | number>;
};
```

#### 4.1.2 Chybové kódy této části

Formát odpovědi je RFC 9457 (část 1, sekce 4.2), rozhodovací pole je `code`. Všechny kódy níže se registrují v `packages/core/errors/registry.ts` spolu s HTTP statusem a příznakem opakovatelnosti; test na duplicitu kódů napříč API je součástí CI.

**Nejdřív obecné kódy z katalogu části 1, které používám a nevymýšlím pro ně vlastní:**

| Obecný kód | Kde ho v této části používám |
|---|---|
| `not_found` | kampaň, provider ani doména neexistuje nebo patří jinému projektu. **Nemám vlastní `campaign_not_found`**, protože rozlišovat entitu podle kódu není k ničemu, entita je zřejmá z cesty. |
| `invalid_state_transition` | zakázaný přechod stavu kampaně. Důvod je v `detail`, aktuální stav v `errors[]`. |
| `validation_failed` | vadné tělo požadavku |
| `forbidden`, `insufficient_scope` | chybějící scope `campaigns:send` |
| `conflict` | souběžná změna |
| `rate_limited` | ruční kontrola domény a testovací odeslání |
| `quota_exceeded` | **nepoužívám**, viz zdůvodnění u `provider_quota_exceeded` níže |
| `idempotency_key_reuse` | opakované použití `Idempotency-Key` s jiným tělem |

**Vlastní kódy této části.** Každý existuje jen proto, že podle něj UI dělá něco jiného než jen zobrazení hlášky (nabízí konkrétní tlačítko, odkaz na opravu nebo jiný postup).

| Kód | HTTP | Kdy | Proč nestačí obecný kód |
|---|---|---|---|
| `campaign_locked` | 409 | editace ve `scheduled` nebo `sending` | UI nabízí „Zrušit plán a upravit", což je jiná akce než u obecného konfliktu |
| `campaign_audience_changed` | 409 | `confirm_recipient_count` nesedí | UI musí překreslit počet a vyžádat nové potvrzení |
| `campaign_audience_empty` | 422 | publikum je prázdné | odkaz na výběr publika |
| `campaign_audience_too_large` | 422 | nad `CAMPAIGN_MAX_RECIPIENTS` | nabídka rozdělit kampaň |
| `campaign_not_compiled` | 422 | chybí `compiled_html` | UI spustí kompilaci sama |
| `campaign_subject_missing` | 422 | prázdný předmět | fokus do pole předmětu |
| `campaign_no_unsubscribe` | 422 | šablona nemá odhlašovací odkaz | odkaz do editoru na vložení patičky |
| `campaign_unknown_merge_field` | 422 | šablona odkazuje na neexistující pole | seznam chybějících polí v `errors[]` |
| `campaign_schedule_too_soon` | 422 | méně než 5 minut do budoucnosti | nabídka „Odeslat teď" |
| `campaign_schedule_too_far` | 422 | víc než 365 dní | |
| `campaign_undo_window_expired` | 409 | undo okno vypršelo, část zpráv už odešla | UI přepne tlačítko na Pozastavit |
| `provider_not_ready` | 422 | provider není `ready` ani `degraded` | odkaz do nastavení provideru |
| `provider_sending_paused` | 422 | `SHUTDOWN` nebo `sending_enabled = false` | jiný text a odkaz na podporu AWS |
| `provider_quota_exceeded` | 422 | publikum je větší než zbývající kvóta | **nepoužívám obecný `quota_exceeded`**, protože ten znamená naši kvótu, kdežto tohle je kvóta cizí služby a uživatel s tím naloží úplně jinak (žádost u Amazonu, ne upgrade u nás). Nese **rozšiřující pole `remaining` a `reset_at` na kořeni problem objektu**, vedle `retry_after`, ne uvnitř `errors[]`. `errors[]` je podle konvence části 1 pole validačních chyb s `path`, `code` a `message`, a tohle validační chyba není. |
| `provider_sandbox` | 422 | účet v sandboxu a publikum to nesplňuje | odkaz na žádost o produkční přístup |
| `provider_credentials_invalid` | 422 | klíč neplatný | fokus do pole klíče |
| `provider_smtp_*` | 422 | viz 3.8.2, sedm kódů | každý má jinou nápovědu k opravě |
| `domain_dkim_missing` | 422 | DKIM neověřený | zobrazí DNS záznamy k vložení |
| `domain_spf_missing` | 422 | SPF chybí nebo je špatně | zobrazí SPF záznam k vložení |
| `domain_dmarc_missing` | 422 | jen jako varování v preflightu | zobrazí DMARC záznam |
| `test_recipient_suppressed` | 422 | testovací adresa je na suppression listu a není členská | |
| ~~`sns_topic_mismatch`~~, ~~`sns_cert_url_invalid`~~, ~~`sns_signature_invalid`~~ | – | **zrušeno, nahrazeno obecným `signature_invalid` (401)** | Katalog části 1 má jediný kód pro neplatný podpis jakéhokoliv příchozího webhooku. Konkrétní příčina jde do `params.reason` s hodnotami `bad_signature`, `cert_url_not_allowed`, `topic_mismatch`, `stale_timestamp`. Vlastní kódy per provider by byly jmenný prostor, který poroste s každým dalším providerem. |
| ~~`outbox_stuck`~~ | – | **zrušeno.** `messages.error_code` je podle kontraktu 4.10.1 oddělený uzavřený výčet, do kterého tenhle kód nepatří. Zaseknuté zprávy řeší sender a označuje je `provider_unavailable` nebo `ambiguous_dispatch`. | |

Pro rate limiting ruční kontroly domény a testovacího odeslání používám **obecný `rate_limited`** s hlavičkou `Retry-After` a polem `retry_after`, ne vlastní `domain_check_rate_limited` a `test_rate_limited`. Klient s nimi nakládá stejně, takže vlastní kódy by byly zbytečné.

### 4.2 Živý průběh

`GET /campaigns/{id}/progress` vrací aktuální stav. Realtime mechanismus (SSE) vlastní část 5, tato část dodává datový tvar a zdroj:

```ts
type CampaignProgress = {
  campaign_id: string;
  status: CampaignStatus;
  counters: CampaignCounters;
  rate_per_second: number | null;     // klouzavý průměr za posledních 60 s
  eta_seconds: number | null;         // (total - sent - failed - skipped) / rate
  quota_remaining: number | null;
  updated_at: string;
};
```

`rate_per_second` se počítá z rozdílu `sent_count` mezi dvěma běhy watchdogu. Když je kampaň `paused`, `eta_seconds` je `null`, ne nekonečno.

Doporučená frekvence aktualizace pro část 5: 1 sekunda během `sending`, 5 sekund jinak.

### 4.3 REST API providerů a domén

| Metoda | Cesta | Popis |
|---|---|---|
| `GET` | `/providers` | Seznam providerů projektu, bez tajemství |
| `POST` | `/providers` | Založení, tělo `SesProviderInput` nebo `SmtpProviderInput` |
| `PATCH` | `/providers/{id}` | Úprava, tajemství jen když se pošlou |
| `DELETE` | `/providers/{id}` | Jen když nemá běžící kampaň, jinak `409` |
| `POST` | `/providers/{id}/test` | Test připojení |
| `POST` | `/providers/{id}/setup-events` | Vytvoření Configuration Setu, topicu a odběru (3.8.1) |
| `GET` | `/providers/{id}/quota` | Čerstvé volání `GetAccount` |
| `POST` | `/providers/{id}/default` | Nastavení jako výchozí |
| `GET` | `/domains` | Seznam domén |
| `POST` | `/domains` | Přidání domény, vrátí DNS záznamy |
| `GET` | `/domains/{id}` | Detail včetně `DomainChecks` |
| `POST` | `/domains/{id}/check` | Ruční kontrola |
| `POST` | `/domains/{id}/mail-from` | Nastavení custom MAIL FROM |
| `DELETE` | `/domains/{id}` | Odstranění (volá `DeleteEmailIdentity`) |

```ts
type DnsRecord = {
  type: 'CNAME' | 'TXT' | 'MX';
  name: string;                 // plně kvalifikované
  value: string;
  ttl: number;                  // doporučená hodnota, 1800
  purpose: 'dkim' | 'spf' | 'dmarc' | 'mail_from_mx';
  required: boolean;
};

type SenderDomain = {
  id: string;
  domain: string;
  provider_id: string;
  records: DnsRecord[];
  checks: DomainChecks;
  ses_verification_status: 'PENDING'|'SUCCESS'|'FAILED'|'TEMPORARY_FAILURE'|'NOT_STARTED' | null;
  dkim_status: 'not_started'|'pending'|'success'|'failed'|'temporary_failure';
  mail_from: { subdomain: string | null; status: string } | null;
  verified_at: string | null;
  checked_at: string | null;
};
```

### 4.4 Odchozí webhookové události deklarované touto částí

Doručování vlastní část 1 (P8), tato část deklaruje typy a payloady.

| Událost | Kdy |
|---|---|
| `campaign.sending_started` | přechod do `sending` |
| `campaign.paused` | přechod do `paused`, včetně celého objektu `pause_reason` (3.6.1.1), tedy i u pauz provedených senderem |
| `campaign.resumed` | přechod zpět do `sending` |
| `campaign.cancelled` | zrušení |
| `campaign.sent` | uzavření jako `sent` nebo `partially_sent` |
| `campaign.schedule_delayed` | odeslání se zpožděním nad 5 minut |
| `campaign.schedule_missed` | propásnuté catch-up okno |
| `message.delivered` | událost `Delivery` |
| `message.bounced` | `bounced_hard` i `bounced_soft`, rozlišené polem `bounce_class` |
| `message.complained` | stížnost |
| `message.failed` | zpráva skončila jako `failed` |
| `provider.status_changed` | změna stavu provideru, hlavně do `blocked` |
| `domain.verification_changed` | doména se ověřila nebo přestala být ověřená |
| `deliverability.threshold_exceeded` | překročení prahu z 3.15.2 |

Obálku vlastní část 1 a nezměním ji. Já deklaruju **jen obsah pole `data`**:

```json
{ "id": "...", "type": "message.bounced", "api_version": "v1",
  "occurred_at": "2026-08-01T12:40:00.000Z", "workspace_id": "...", "data": { } }
```

`occurred_at` v obálce plním **časem skutečné události u providera** (`bounce.timestamp` ze SNS), ne časem našeho zpracování. Je to důsledek toho, že SNS doručuje mimo pořadí a s prodlevou; kdybych tam dal čas zpracování, příjemce by z něj nemohl rekonstruovat sled událostí.

```ts
// data u campaign.* událostí
type CampaignEventData = {
  campaign: { id: string; name: string; status: CampaignStatus };
  counters: CampaignCounters;
  pause_reason?: PauseReason;
  scheduled_at?: string;          // u schedule_delayed a schedule_missed
  delay_seconds?: number;         // u schedule_delayed
};

// data u message.* událostí
type MessageEventData = {
  message: { id: string; created_at: string; email: string;
             provider_message_id: string | null };
  campaign: { id: string; name: string };
  contact: { id: string };
  event: {
    // Otevřený výčet stejně jako CampaignStatus: část 5 k němu přidává `opened`
    // a `clicked` a další typy smí přibýt v rámci v1. Klient musí neznámý typ
    // tolerovat, typicky ho zaznamenat a jinak ignorovat.
    type: 'delivered' | 'bounced_hard' | 'bounced_soft' | 'complained' | 'failed'
        | (string & {});
    bounce_class?: 'hard' | 'soft' | 'content';
    bounce_type?: string;          // SES bounceType
    bounce_sub_type?: string;      // SES bounceSubType
    diagnostic_code?: string;
    complaint_feedback_type?: string;
    suppressed: boolean;           // vedla akce k zápisu na suppression list?
  };
  message_state_after: 'sent' | 'failed' | 'skipped';
  sequence: number;                // rank z 3.9.2, viz níže
};
```

Dvě pole existují výhradně proto, že **doručení webhooků je nejméně jednou a bez záruky pořadí** (upozornění z části 1). Bez nich by si příjemce nemohl poradit:

- **`sequence`** je rank z tabulky v 3.9.2 (`delivered` 30, `bounced_soft` 60, `bounced_hard` 80, `complained` 85, `failed` 90). Příjemce, který dostane `message.delivered` po `message.bounced`, podle něj pozná, že starší událost přišla později, a nemusí přepisovat svůj stav. Obálka sekvenci napříč typy nemá, takže si ji podle doporučení části 1 nesu v `data`.
- **`message_state_after`** je náš stav zprávy po zpracování téhle události. Příjemce, který chce jen zrcadlit stav a neřešit pořadí, si vezme tohle a hotovo.

`message.created_at` je v payloadu proto, že primární klíč zprávy je `(id, created_at)`. Bez druhé složky by příjemce, který by si chtěl zprávu u nás dohledat přes API, musel prohledávat všechny partition.

**Zásada:** payload nikdy neobsahuje `render_data` ani obsah zprávy. Odchozí webhook jde na cizí server a osobní data se do něj nedávají nad rámec e-mailu, který je nutný k identifikaci. JSON schémata všech osmi typů dodám do `packages/contracts/webhooks/`.

### 4.5 Joby (pg-boss)

| Job | Frekvence nebo spouštěč | `singletonKey` | Retry |
|---|---|---|---|
| `campaign.materialize` | na požádání při `send` | `campaign.materialize:<id>` | 5×, backoff 5 s, 30 s, 2 min, 10 min, 30 min |
| `campaign.scheduler` | cron každých 30 s | globální | 3× |
| `campaign.watchdog` | cron každých 15 s | globální | 3× |
| `campaign.resume_on_quota` | cron každých 10 min | globální | 3× |
| `outbox.stall_watch` | cron každých 60 s | globální | 3× |
| `outbox.reconcile` | cron každých 60 s | globální | 3× |
| `provider_event.process` | na požádání z webhooku | `event:<dedup_key>` | 10×, exponenciální backoff do 1 h |
| `provider_event.rematch` | cron každých 30 s | globální | 3× |
| `provider.refresh_quota` | cron každých 15 min | `provider.quota:<id>` | 3× |
| `domain.recheck` | cron každou minutu, vybírá podle `next_check_at` | `domain.check:<id>` | 3× |
| `deliverability.rollup` | cron každých 15 min | globální | 3× |
| `retention.drop_message_partitions` | cron denně ve 3:30 UTC | globální | 1× |

### 4.6 Konfigurační proměnné této části

Pojmenování bez prefixu, podle konvence části 1. Sloupec „Proces" používá značky části 1: **W** = web, **K** = worker, **S** = sender.

| Proměnná | Typ | Povinná | Výchozí | Proces | Validace |
|---|---|---|---|---|---|
| `CAMPAIGN_MATERIALIZE_BATCH_SIZE` | int | ne | 5000 | K | 100 až 50000 |
| `CAMPAIGN_MATERIALIZE_MAX_MINUTES` | int | ne | 60 | K | 1 až 1440 |
| `CAMPAIGN_MAX_RECIPIENTS` | int | ne | 2000000 | W K | 1 až 50000000 |
| `CAMPAIGN_PARTIAL_THRESHOLD` | float | ne | 0.01 | K | 0 až 1 |
| `CAMPAIGN_SCHEDULE_CATCHUP_HOURS` | int | ne | 6 | K | 0 až 168 |
| `CAMPAIGN_UNDO_WINDOW_SECONDS` | int | ne | 60 | W K | 0 až 900, hodnota 0 undo okno vypíná (3.6.4). **Výchozí hodnota i strop pro `settings.campaigns.undo_window_seconds`** |
| `CAMPAIGN_QUOTA_PAUSE_REMAINING` | int | ne | 100 | K | 0 až 1000000, pauza při poklesu zbývající kvóty pod tuhle hodnotu (3.14.4) |
| `CAMPAIGN_QUOTA_RESUME_REMAINING` | int | ne | 1000 | K | 0 až 1000000, musí být **větší** než `CAMPAIGN_QUOTA_PAUSE_REMAINING`, jinak kampaň cykluje (3.14.4) |
| `CAMPAIGN_TEST_SEND_PER_HOUR` | int | ne | 20 | W | 1 až 1000, limit testovacích odeslání na kampaň za hodinu (3.17) |
| `SOFT_BOUNCE_THRESHOLD` | int | ne | 3 | K | 1 až 20 |
| `SOFT_BOUNCE_WINDOW_DAYS` | int | ne | 30 | K | 1 až 365 |
| `DELIVERABILITY_BOUNCE_GUARD_RATE` | float | ne | 0.08 | K | 0 až 1, hodnota 0 brzdu vypíná. **Výchozí hodnota i strop pro projekt** (3.15.2.1) |
| `DELIVERABILITY_COMPLAINT_GUARD_RATE` | float | ne | 0.003 | K | 0 až 1, hodnota 0 brzdu vypíná. **Výchozí hodnota i strop pro projekt** |
| `DELIVERABILITY_BOUNCE_WARN_RATE` | float | ne | 0.04 | K | 0 až 1. **Výchozí hodnota i strop pro projekt** |
| `DELIVERABILITY_COMPLAINT_WARN_RATE` | float | ne | 0.001 | K | 0 až 1. **Výchozí hodnota i strop pro projekt** |
| `DELIVERABILITY_GUARD_MIN_SENT` | int | ne | 500 | K | 1 až 1000000. **Výchozí hodnota i strop pro projekt** |
| `DELIVERABILITY_CONTENT_BOUNCE_LIMIT` | int | ne | 100 | K | 1 až 1000000, práh brzdy pro třídu **content** (3.10.1) |
| `MESSAGE_RETENTION_DAYS` | int | ne | 90 | K | 7 až 3650 |
| `MESSAGE_EVENT_RETENTION_DAYS` | int | ne | 365 | K | 7 až 3650 |
| `SNS_CERT_CACHE_SECONDS` | int | ne | 86400 | W | 60 až 604800 |
| `SNS_STORE_RAW_EVENTS` | bool | ne | `true` | W K | při `false` se neukládá `provider_event_receipts.raw`, viz 7.3. **U přepínače v UI musí stát, co se tím ztrácí: přestane být dohledatelné, proč se konkrétní událost nespárovala.** Je to jediný způsob, jak takový problém vyšetřit zpětně. |
| `DNS_CHECK_TIMEOUT_MS` | int | ne | 3000 | K | 500 až 30000 |
| `DNS_CHECK_CONCURRENCY` | int | ne | 10 | K | 1 až 50 |
| `AWS_API_TIMEOUT_MS` | int | ne | 5000 | W K | 1000 až 60000 |

Navíc **politika nejednoznačného odeslání**, jejíž výchozí hodnoty podle části 1 (požadavek P4-2) vlastním já, i když mechanismus popisuje kontrakt 1. **Jsou to dvě proměnné, ne jedna:**

| Proměnná | Typ | Povinná | Výchozí | Proces | Validace |
|---|---|---|---|---|---|
| `AMBIGUOUS_DISPATCH_POLICY_SES` | enum | ne | **`fail`** | S | `retry` nebo `fail` |
| `AMBIGUOUS_DISPATCH_POLICY_SMTP` | enum | ne | **`retry`** | S | `retry` nebo `fail` |

**Oprava proti dřívějšímu znění.** Tenhle dokument měl jedinou proměnnou `AMBIGUOUS_DISPATCH_POLICY` s výchozí hodnotou `retry` a zdůvodňoval ji tím, že opakovaný pokus má identický deterministický `Message-ID`, takže přijímající server duplikát zahodí. **Ten předpoklad je vyvrácený: Amazon SES `Message-ID` vždy přepisuje vlastní hodnotou**, takže na hlavním provideru naše deterministická hlavička k příjemci nikdy nedorazí a pojistka tam neexistuje. Duplikát by dorazil jako dva různé e-maily. Zjištění pochází z nálezu K3 části 4b a část 1 podle něj kontrakt upravila.

Rozdělení tedy zní:

| Provider | Proměnná | Výchozí | Proč |
|---|---|---|---|
| SES | `AMBIGUOUS_DISPATCH_POLICY_SES` | **`fail`** | SES `Message-ID` přepisuje, duplikát by nikdo nezachytil. Radši jedna nedoručená zpráva, kterou uživatel vidí jako „nejisté odeslání" a může ji doposlat, než dva doručené e-maily. |
| obecné SMTP | `AMBIGUOUS_DISPATCH_POLICY_SMTP` | **`retry`** | Naše hlavička projde beze změny a přijímající servery duplikát podle `Message-ID` běžně odchytí, takže pojistka funguje. |

**Věta „přijímající server duplikát podle `Message-ID` zahodí" tedy platí u SMTP a neplatí u SES.** Kdekoliv se v tomhle dokumentu objevovala bez rozlišení, je opravená; hlavičková tabulka v 3.16.1 to má taky.

Rozhodnutí `fail` u SES má cenu, kterou je nutné unést v UI: nejednoznačné zprávy musí být v reportu **rozeznatelné**, ne schované mezi běžnými selháními. Mají `error_code = 'ambiguous_dispatch'`, zobrazují se jako samostatná kategorie „nejisté odeslání" a jde z nich udělat publikum pro doposlání. Bez toho by `fail` znamenalo tiše zahozené zprávy. Počet nejednoznačných případů navíc ukazuju v dashboardu (3.7.4), aby šla odhalit systematická chyba.

Vlastní kapitola 11.13 s tímhle rozdělením už počítá: mechanismus se značkou `ml_msg` (3.9.5) opravuje `failed → sent`, jakmile pro nejednoznačnou zprávu dorazí událost, a to je právě větev, do které se zprávy dostanou při politice `fail`.

Zrušené proti dřívějšímu návrhu: `OUTBOX_CLAIM_TIMEOUT_SECONDS` a `OUTBOX_MAX_REAPS`. Vypršení claimu a jeho uvolňování vlastní sender přes `SENDER_CLAIM_TTL_SECONDS` (část 1, výchozí 300 s), aplikace do toho nesahá.

Všechny proměnné patří do společné tabulky v sekci 4.9 části 1, ne do samostatného schématu této části. Platí pro ně konvence odtamtud: `SCREAMING_SNAKE_CASE` bez prefixu, jedno zod schéma validované při startu, výpis **všech** chyb naráz a `exit code 78`, a automatická podpora varianty `<NÁZEV>_FILE` kvůli Docker secrets. Poslal jsem je autorovi části 1 k zapracování.

---

## 5. UI

Texty jsou uvedené česky a anglicky. Klíče katalogu mají prefix `campaigns.`, `providers.` a `deliverability.`.

### 5.1 Seznam kampaní

| Stav obrazovky | Obsah |
|---|---|
| Prázdný | Ilustrace, „Zatím žádné kampaně" / „No campaigns yet", tlačítko „Vytvořit kampaň" / „Create campaign" |
| Načítání | Kostra 5 řádků tabulky |
| Chyba | „Kampaně se nepodařilo načíst." / „We couldn't load your campaigns." plus tlačítko „Zkusit znovu" / „Try again" |
| Data | Tabulka: název, stav (barevný štítek), publikum, odesláno, otevřeno, datum |

Štítky stavů:

| Stav | cs | en | Barva |
|---|---|---|---|
| `draft` | Rozepsaná | Draft | šedá |
| `scheduled` | Naplánovaná | Scheduled | modrá |
| `queueing` | Připravuje se | Preparing | modrá, animovaná |
| `sending` | Odesílá se | Sending | modrá, animovaná |
| `paused` | Pozastavená | Paused | oranžová |
| `sent` | Odeslaná | Sent | zelená |
| `partially_sent` | Odeslaná částečně | Partially sent | žlutá |
| `cancelled` | Zrušená | Cancelled | šedá |
| `failed` | Nepodařilo se | Failed | červená |
| `schedule_missed` | Plán propásnut | Schedule missed | červená |

### 5.2 Obrazovka odeslání

Poslední krok průvodce kampaní. Obsahuje:

1. **Shrnutí:** komu (počet + rozpis vyloučení), z jaké adresy, předmět, náhled.
2. **Výsledek preflightu.** Chyby červeně s vysvětlením a odkazem na místo, kde se to opraví. Varování žlutě, nezastavují.
3. **Stav odesílacího účtu:** zbývající denní kvóta, sandbox varování, stav domény.
4. **Volba:** Odeslat teď / Naplánovat.
5. **Tlačítko** je zašedlé, dokud `can_send = false`, a tooltip říká proč.

Příklad textů preflightu:

| Kód | cs | en |
|---|---|---|
| `campaign_audience_empty` | „Publikum je prázdné. Vyberte alespoň jeden seznam nebo segment." | „The audience is empty. Pick at least one list or segment." |
| `provider_quota_exceeded` | „Chcete odeslat {count} zpráv, ale u Amazonu vám dnes zbývá {remaining}. Rozdělte kampaň nebo počkejte do {reset_time}." | „You're sending {count} messages but only {remaining} remain in today's Amazon quota. Split the campaign or wait until {reset_time}." |
| `domain_dkim_missing` | „Doména {domain} nemá ověřený DKIM podpis. Bez něj skončí vaše maily ve spamu." | „Domain {domain} has no verified DKIM signature. Without it your emails will land in spam." |
| `provider_sandbox` | „Účet je v testovacím režimu Amazonu. Můžete odeslat nejvýš 200 zpráv denně a jen na ověřené adresy." | „Your Amazon account is in sandbox mode. You can send at most 200 messages per day, only to verified addresses." |
| `campaign_no_unsubscribe` | „V šabloně chybí odkaz na odhlášení. Bez něj kampaň odeslat nelze." | „The template has no unsubscribe link. The campaign can't be sent without it." |

### 5.3 Obrazovka průběhu

- Velký pruh: **odesláno** / celkem, procenta. „Odesláno" znamená předáno poštovnímu serveru, ne doručeno do schránky.
- Řada čísel: doručeno, otevřeno, prokliknuto, nedoručeno, stížnosti.

**Odesláno a doručeno se skoro nikdy nerovnají a uživatel musí vědět proč.** Typicky uvidí „Odesláno 50 000, doručeno 48 200" a bez vysvětlení to vypadá, že se 1 800 zpráv ztratilo. UI proto u obou čísel nese vysvětlení, buď jako popisek, nebo jako tooltip:

| Číslo | cs | en |
|---|---|---|
| Odesláno | „Předáno poštovnímu serveru. Neznamená to, že zpráva dorazila do schránky." | „Handed over to the mail server. This does not mean it reached the inbox." |
| Doručeno | „Server příjemce zprávu přijal. Potvrzení chodí se zpožděním, číslo ještě poroste." | „The recipient's server accepted the message. Confirmations arrive with a delay, so this number will still grow." |
| Nedoručeno | „Server příjemce zprávu odmítl. Tyhle adresy jsme vyřadili." | „The recipient's server rejected the message. We have removed these addresses." |

Rozdíl mezi „odesláno" a součtem „doručeno + nedoručeno" je počet zpráv, u kterých ještě nemáme zpětnou vazbu. Během rozesílky je velký a postupně klesá, což UI musí unést bez toho, aby to vypadalo jako chyba.
- Odhad zbývajícího času, aktuální rychlost.
- Tlačítka Pozastavit a Zrušit.
- Při `paused` velký oranžový box s důvodem a tlačítkem Pokračovat. Text se vybírá podle `pause_reason ->> 'code'` a katalog musí pokrývat **všech devět kódů z 3.6.1.1, včetně čtyř, které zapisuje sender**. Kdyby pokrýval jen aplikační, kampaň zastavená senderem kvůli nedešifrovatelným credentials by se zobrazila jako pauza bez důvodu. U kódu `provider_quota_exhausted` box navíc říká, že kampaň pokračuje sama, a tlačítko Pokračovat je vedle toho jako ruční zkratka.
- Při automatické brzdě červený box: „Kampaň jsme sami pozastavili. Nedoručitelnost je {rate} %, což ohrožuje váš odesílací účet. Než budete pokračovat, projděte si adresy, které selhaly." plus tlačítko „Zobrazit chyby".

Stavy: načítání = kostra, chyba = „Průběh se nepodařilo načíst, zkoušíme dál", prázdný stav neexistuje.

### 5.4 Průvodce doménou

Čtyři kroky s viditelným postupem. U DNS záznamů:

- tabulka Typ / Název / Hodnota s tlačítkem kopírovat u každé hodnoty,
- tlačítko „Stáhnout jako CSV",
- pod tabulkou stav každé kontroly s kolečkem: zelené, žluté, červené, šedé (nezkontrolováno),
- text „Změny v DNS bývají vidět do hodiny, výjimečně to trvá až 72 hodin.",
- tlačítko „Zkontrolovat teď" s odpočtem, když je rate limit aktivní.

### 5.5 Dashboard doručitelnosti

Dlaždice z 3.15.3. U každé metriky:

- hodnota velkým písmem,
- barevná zóna,
- pod tím jednou větou, co to znamená a co s tím („Nedoručitelnost 6,2 %. Amazon vás při 5 % dává pod dohled. Vyčistěte databázi presetem Nikdy neotevřel.").

Prázdný stav (žádná odeslaná kampaň): „Až odešlete první kampaň, uvidíte tu, jak se vaše maily doručují."

---

## 6. Bezpečnost a soukromí

### 6.1 SNS endpoint

- Ověření podpisu je **jediná** ochrana, proto nesmí být volitelné ani vypnutelné konfigurací.
- Kontrola `TopicArn` proti uloženému ARN provideru brání připojení cizího topicu.
- Kontrola hostu `SigningCertURL` a `SubscribeURL` proti regulárnímu výrazu AWS domén brání podstrčení certifikátu a SSRF.
- Stahování certifikátu má timeout 5 s, limit 32 kB, žádné následování přesměrování mimo AWS domény.
- Odmítnuté zprávy se logují s `TopicArn`, IP a důvodem a jdou do auditu jako bezpečnostní událost.
- Endpoint nesmí do odpovědi vrátit nic z těla požadavku (žádné echo), aby neposloužil jako reflektor.

### 6.2 Přístupová práva k AWS

Doporučená IAM politika, kterou nástroj vypíše uživateli. Sender potřebuje jen `ses:SendEmail`, aplikace zbytek.

```
ses:GetAccount
ses:GetEmailIdentity, ses:CreateEmailIdentity, ses:DeleteEmailIdentity
ses:ListEmailIdentities
ses:PutEmailIdentityMailFromAttributes, ses:PutEmailIdentityDkimSigningAttributes
ses:GetConfigurationSet, ses:CreateConfigurationSet
ses:CreateConfigurationSetEventDestination, ses:UpdateConfigurationSetEventDestination
ses:PutConfigurationSetSuppressionOptions
ses:SendEmail                        (potřebuje sender)
sns:CreateTopic, sns:Subscribe, sns:ConfirmSubscription, sns:SetTopicAttributes
```

V UI je varianta „minimální oprávnění", kde uživatel dá jen `ses:SendEmail`, `ses:GetAccount` a `ses:GetEmailIdentity` a zbytek nastaví ručně. Nástroj to musí umět, protože řada firem nedá aplikaci právo zakládat SNS topicy.

### 6.3 Credentials

- `config_encrypted` se dešifruje jen v okamžiku volání AWS nebo SMTP, nikdy se nedrží v paměti déle než po dobu requestu.
- API nikdy nevrací tajemství, ani zkrácené. Vrací jen `has_credentials: true` a maskovaný `accessKeyId` ve tvaru `AKIA****ABCD` (první 4 a poslední 4 znaky).
- `PATCH /providers/{id}` bez pole tajemství tajemství nemění.
- Změna credentials se zapisuje do auditu, hodnoty ne.
- Při rotaci `SECRET_KEY` (mechanismus vlastní část 1) se všechny `config_encrypted` musí přešifrovat. Tato část poskytuje funkci `reencryptProviderCredentials(oldKey, newKey)` pro migrační skript.

### 6.4 Izolace projektů

- Každý dotaz této části filtruje na `workspace_id`. Repository vrstva to vynucuje (část 1).
- Webhook endpoint bere `provider_id` z cesty a `workspace_id` z něj, ne z těla požadavku. Nikdy se nesmí důvěřovat tomu, co je v SNS zprávě.
- Testovací odeslání kontroluje členství adresáta v projektu, ne globálně.

### 6.5 Osobní údaje

| Kde | Co se ukládá | Jak dlouho |
|---|---|---|
| `messages.email` | e-mailová adresa | 90 dní (retence) |
| `messages.render_data` | jméno, vokativ a další personalizační pole | 90 dní |
| `message_events.metadata` | adresa, diagnostický kód od poštovního serveru, IP se **neukládá** | 365 dní |
| `provider_event_receipts.raw` | celé tělo SNS zprávy včetně hlaviček původního mailu | 30 dní |

`provider_event_receipts.raw` je nejcitlivější, protože SES do `mail.headers` vkládá i hlavičky původní zprávy. Proto se maže nejdřív. Do exportu dat subjektu (část 2) patří `messages` a `message_events` daného kontaktu, `provider_event_receipts` ne, protože jde o technický log.

Při výmazu kontaktu (GDPR) se v `messages` a `message_events` **anonymizuje adresa** na `erased+{contact_id}@erased.invalid` a `render_data` se vyprázdní, ale řádky zůstávají, aby nezmizely statistiky kampaní. Tvar placeholderu je sjednocený s částí 2, dřív jsem používal vlastní. Doména `.invalid` je rezervovaná RFC 2606, takže na ni nikdy nic neodejde.

**Tohle je návrhové řešení podléhající právnímu posouzení, ne uzavřené pravidlo.** Otevřená otázka O11 („anonymizace versus mazání zpráv při GDPR výmazu") je vedená jako čekající na právníka. Kapitola je psaná normativně, protože implementace potřebuje z čeho vyjít, ale kdyby posouzení dopadlo opačně, mění se tři místa v tomhle dokumentu (tady, 2.5 a R2.5) a funkce `anonymizeMessages` se změní na `deleteMessages`. Nikde jinde na tom nic nestojí.

---

## 7. Výkon

### 7.1 Kritické dotazy

| Dotaz | Kde | Očekávaná doba | Index |
|---|---|---|---|
| Materializační dávka 5 000 kontaktů | `campaign.materialize` | 150 až 600 ms | závisí na segmentu (část 2) + `messages` unique index |
| Claim dávky 500 zpráv | sender | pod 10 ms | `idx_messages__claimable` |
| Párování události na zprávu | `provider_event.process` | pod 5 ms | `idx_messages__provider_message_id` |
| Rušení pending zpráv při odhlášení | `revokePendingMessages` | pod 20 ms | `idx_messages__ws_email_pending` |
| Rekoncilace čítačů kampaně (1 M zpráv) | `campaign.watchdog` | 200 až 800 ms | `idx_messages__campaign_status`, index-only scan |
| Počítání soft bounců pro adresu | suppression rozhodnutí | pod 10 ms | `idx_message_events__recipient_bounce` |
| Denní rollup doručitelnosti | `deliverability.rollup` | 1 až 5 s na projekt | `idx_message_events__campaign_type` |

### 7.2 Očekávané objemy

| Veličina | MVP 0 | Cíl |
|---|---|---|
| Kontaktů v projektu | 100 tisíc | 5 milionů |
| Příjemců na kampaň | 50 tisíc | 2 miliony |
| Zpráv za den | 200 tisíc | 5 milionů |
| Událostí za den | 400 tisíc | 10 milionů |
| Příchozích SNS požadavků za sekundu (špička) | 50 | 500 |

### 7.3 Kde to praskne dřív

1. **Rekoncilace čítačů u kampaně nad 5 milionů zpráv.** Agregace přes celou partition každých 15 sekund je neúnosná. Řešení, až to nastane: rekoncilovat jen kampaně, kde se čítače od poslední rekoncilace hnuly, a snížit frekvenci na 60 s po prvních 5 minutách kampaně.
2. **Zpracování SNS ve špičce.** Endpoint jen zapíše řádek a pošle job, takže samotný zápis vydrží hodně. Úzké hrdlo je `provider_event.process`, který dělá párování a případný zápis suppression. Řešení: dávkové zpracování po 100 událostech v jednom jobu místo jedné události na job. Do MVP 0 to nedávám, protože komplikuje idempotenci.
3. **DNS kontroly u stovek domén.** Job `domain.recheck` je sériový. Při stovkách domén to bude trvat. Řešení: souběžnost 10 domén najednou s `p-limit`.
4. **Materializace u segmentu, který se kompiluje do drahého SQL.** Tohle je riziko na hranici s částí 2. Ochrana: `statement_timeout` 30 s na materializační dávku, po třech timeoutech kampaň do `failed` s kódem `campaign_audience_query_too_slow` a odkazem na segment.
5. **`provider_event_receipts.raw`** roste rychle (typicky 3 až 8 kB na událost). Při 10 milionech událostí denně je to 30 až 80 GB denně. Retence 30 dní je pak neúnosná. Řešení pro velké instalace: `SNS_STORE_RAW_EVENTS=false`, kdy se ukládá jen hash a klíčová pole.

---

## 8. Akceptační kritéria

### 8.1 Životní cyklus kampaně

1. Kampaň ve stavu `draft` s vyplněným předmětem, zkompilovanou šablonou, ověřenou doménou a neprázdným publikem má `preflight.can_send = true`.
2. Volání `POST /campaigns/{id}/send` na kampaň ve stavu `sent` vrátí `409` s `Content-Type: application/problem+json` a `code = "invalid_state_transition"`, stav kampaně se nezmění.
3. Dvě souběžná volání `POST /campaigns/{id}/send` skončí tak, že právě jedno vrátí `202` a druhé `409`. V outboxu je právě `audience_size` řádků.
4. `PATCH /campaigns/{id}` s novým předmětem na kampaň ve stavu `scheduled` vrátí `409 campaign_locked`.
5. Po `POST /campaigns/{id}/pause` během `sending` přestane `sent_count` růst nejpozději do doby zpracování jedné dávky senderu plus 5 sekund. Zajistí to podmínka `c.status IN ('queueing','sending')` v claim dotazu, aplikace senderu nic neposílá. Totéž platí pro pauzu během `queueing`, protože claim bere oba stavy a pauza je vyvádí z obou.
6. Po `POST /campaigns/{id}/cancel` na kampaň s 50 000 zprávami, z nichž 12 000 je `sent`, platí: `status = 'cancelled'`, počet `sent` zůstane 12 000, počet `skipped` je 38 000 minus zprávy, které byly `claimed`.
7. `POST /campaigns/{id}/resume` na kampaň pozastavenou kvůli `provider_blocked` vrátí `422 provider_sending_paused`, dokud se stav provideru nezmění.
7a. `POST /campaigns/{id}/pause` na kampaň ve stavu `queueing` uspěje, kampaň přejde do `paused` a materializační smyčka se zastaví nejpozději po dokončení rozpracované dávky. Kurzor v `campaign_audience_progress` zůstane.
7b. `POST /campaigns/{id}/resume` na kampaň pozastavenou během materializace ji vrátí do **`queueing`**, ne `sending`, materializace doběhne od kurzoru a `total_count` i `audience_size` se nakonec vyplní. Kampaň pozastavená po dokončení materializace se vrací do `sending`.
7c. Materializace, která překročí `CAMPAIGN_MATERIALIZE_MAX_MINUTES`, převede kampaň z `queueing` do `paused` s `pause_reason ->> 'code' = 'materialize_timeout'` a `source = 'app'`. `UPDATE` musí zasáhnout **jeden** řádek; nula řádků je selhání testu, protože přesně tak se projevoval zakázaný přechod.
7d. `campaigns.pause_reason` je typu `jsonb` (dotaz do `information_schema.columns`), zapsaná hodnota je neprázdný objekt s klíči `code`, `source` a `at`, a `code` je hodnota z registru v 3.6.1.1.
7e. Kampaň pozastavená senderem s `code = 'provider_quota_exhausted'` a `source = 'sender'` se po uvolnění kvóty nad `CAMPAIGN_QUOTA_RESUME_REMAINING` **obnoví jobem `campaign.resume_on_quota`**, stejně jako kampaň pozastavená aplikací s týmž kódem. Test běží pro obě hodnoty `source` zvlášť.
7f. Každé automatické pozastavení, včetně provedeného senderem, má do 15 sekund záznam `campaign.auto_paused` v `audit_log` s celým objektem `pause_reason` v detailu. Pauza s `code = 'user'` takový záznam **nemá**.

### 8.2 Materializace publika

8. Kampaň se dvěma seznamy, které mají 300 společných kontaktů, vytvoří v outboxu právě tolik řádků, kolik je unikátních kontaktů, tedy bez těch 300 duplicit.
9. Kontakt, jehož adresa je na suppression listu, není v outboxu vůbec, a `campaign_audience_progress.skipped_suppressed` se o něj zvýší.
10. Zabití workeru uprostřed materializace 1 000 000 kontaktů a jeho restart vede k tomu, že v outboxu je právě `audience_size` řádků, žádný duplicitní, žádný chybějící.
11. Dvojí spuštění jobu `campaign.materialize` na tutéž kampaň nevytvoří žádný duplicitní řádek (ověřeno dotazem `SELECT campaign_id, contact_id, count(*) ... HAVING count(*) > 1`, který vrátí nula řádků).
12. Všechny řádky jedné kampaně mají identickou hodnotu `created_at` rovnou `campaigns.audience_built_at`.
13. `render_data` obsahuje právě klíče odvozené z `campaigns.compiled_fields`, nic navíc, a neobsahuje klíč `email`.
14. Materializace 1 000 000 kontaktů doběhne do 5 minut na referenčním hardwaru (4 vCPU, 8 GB RAM, NVMe).
14a. **Závod zrušení s materializací.** `POST /campaigns/{id}/cancel` odeslaný uprostřed materializace 1 000 000 kontaktů (typicky po zhruba 100 z 200 dávek) vede k tomu, že po doběhnutí jobu **neexistuje ani jedna zpráva té kampaně ve stavu `pending`**. Ověřuje se dotazem `SELECT count(*) FROM messages WHERE campaign_id = $1 AND status = 'pending'`, který musí vrátit nulu. Test se opakuje aspoň dvacetkrát s náhodným okamžikem zrušení, protože jde o závod a jeden průchod nic nedokazuje.
14b. Tentýž scénář s vypnutou kontrolou stavu po dávce **musí selhat**. Bez toho by kritérium 14a prošlo i u implementace, která závod neošetřuje, protože zrušení by se náhodou trefilo mezi dávky.
14c. Po 14a se partition, ve které kampaň leží, dá odpojit retenčním jobem, jakmile vyprší retenční okno. Veto z 3.18.2 ji nesmí blokovat, protože žádná `pending` ani `claimed` zpráva v ní nezbyla.
14d. Restart workeru uprostřed materializace nevede k tomu, že by kampaň zůstala v `queueing` bez dalšího postupu: druhý běh jobu načte `audience_built_at` SELECTem, naváže na kurzor a dokončí i krok 3. Ověřuje se tím, že po restartu má kampaň nakonec `status = 'sending'` a nenulový `total_count`.

### 8.3 Změny publika během odesílání

15. Odhlášení kontaktu během `sending` způsobí, že jeho `pending` zpráva má do 1 sekundy `status = 'skipped'` a `error_code = 'unsubscribed'`.
16. Zpráva ve stavu `claimed` se odhlášením **nezmění** a zůstane `claimed`.
17. Přidání adresy na suppression list přímým zápisem do DB (bez volání doménové funkce) vede k tomu, že job `outbox.reconcile` zprávu do 60 sekund označí jako `skipped` s kódem `suppressed`.

### 8.4 Příjem a normalizace událostí

18. `POST /api/webhooks/ses/{id}` s tělem, jehož `Signature` nesedí, vrátí `401` s `code = "signature_invalid"` a `params.reason = "bad_signature"`, a nezapíše nic do `provider_event_receipts`.
19. Tělo s `SigningCertURL` na hostu `evil.example.com` vrátí `401` s `code = "signature_invalid"` a `params.reason = "cert_url_not_allowed"`, aniž se URL stáhne.
20. Tělo s `TopicArn` cizího topicu vrátí `401` s `params.reason = "topic_mismatch"`.
21. Platná zpráva typu `SubscriptionConfirmation` vede k potvrzení odběru a stav provideru se posune z `verifying` na `ready` (za předpokladu splnění ostatních podmínek).
22. Tatáž `Notification` doručená třikrát vytvoří právě jeden řádek v `provider_event_receipts` a právě jeden řádek v `message_events`.
23. `Delivery` doručená po `Bounce Permanent` pro tutéž zprávu: v `message_events` jsou obě události, `messages.status` zůstane **`sent`**. Dřívější znění tu mělo `failed`, což si protiřečilo s pravidlem 2 v 3.9.3 (`sent` je koncový stav), s kritérii 24 a 27, s vlastním výkladem v 3.9.3 („obě události jsou v `message_events`, stav se nemění ani jednou") i s kontraktním scénářem `OB-15`, který u pozdního bouncu k už `sent` zprávě očekává, že stav zůstane `sent`.
24. `Send` doručená po `Delivery`: `messages.status` zůstane `sent`, obě události jsou v `message_events`.
25. Událost pro `provider_message_id`, který ještě není v `messages`, se uloží jako `unmatched` a po zápisu `provider_message_id` senderem se do 30 sekund spáruje.
26. Zpráva se `Timestamp` starším než 1 hodina se přijme s `200`, ale nezpracuje a označí jako `invalid` s `params.reason = "stale_timestamp"`.

### 8.5 Bounce a suppression

27. `Bounce` s `bounceType = Permanent` a `bounceSubType = NoEmail` vede k okamžitému zápisu adresy do `suppressions` s `reason = 'hard_bounce'` a k události `bounced_hard` v `message_events`. **`messages.status` zůstane `sent`**, protože zprávu jsem provideru předal.
28. `Bounce` s `bounceType = Permanent` a `bounceSubType = OnAccountSuppressionList` vede k suppression, ale **nezvýší** `deliverability_snapshots.hard_bounces`.
29. Tři `Bounce` s `bounceType = Transient` a `bounceSubType = MailboxFull` na tutéž adresu během 30 dní vedou k suppression s `reason = 'soft_bounce_threshold'`. Dva bouncy k suppression nevedou.
30. Dva soft bouncy s odstupem 40 dní k suppression nevedou.
31. `Bounce` s `bounceSubType = MessageTooLarge` **nevede** k suppression ani ke zvýšení soft čítače kontaktu.
32. `Complaint` s libovolným `complaintFeedbackType` kromě `not-spam` vede k okamžité suppression. `not-spam` k ničemu nevede.
33. Zápis do suppression listu okamžitě vyškrtne všechny `pending` zprávy dané adresy ze všech běžících kampaní.

### 8.6 Doručitelnost a kvóty

34. Kampaň na 300 příjemců proti provideru v sandboxu (`Max24HourSend = 200`) vrátí v preflightu chybu `provider_sandbox` a nelze ji odeslat.
35. Kampaň na 60 000 příjemců proti provideru, kterému zbývá 50 000 zpráv, vrátí `provider_quota_exceeded`.
36. Když bounce rate kampaně překročí 8 % při alespoň 500 odeslaných zprávách, kampaň se do 15 sekund pozastaví s `pause_reason ->> 'code' = 'bounce_guard'` a `source = 'app'`.
36a. Projekt, který má v `settings.deliverability.bounce_guard_rate` hodnotu 0.05, se pozastaví už při 5 %. Pokus zapsat do téhož klíče 0.12 při instalační hodnotě 0.08 vrátí `422 validation_failed` s `path` na ten klíč, ne tiché oříznutí na 0.08.
37. Když bounce rate překročí 8 % při 200 odeslaných zprávách, kampaň se **nepozastaví**.
38. Změna `EnforcementStatus` na `SHUTDOWN` pozastaví všechny běžící kampaně daného provideru a nastaví ho na `blocked`.

### 8.7 Domény a DNS

39. Doména s validními třemi DKIM CNAME záznamy má po kontrole `dkim_ok = true` a `checks.dkim.found = 3`.
40. Doména se dvěma SPF TXT záznamy má `spf_ok = false` s nálezem `spf_multiple_records`.
41. Doména bez DMARC záznamu má `dmarc_ok = false`, ale preflight to hlásí jen jako varování a kampaň jde odeslat.
42. Doména s `_dmarc` záznamem `v=DMARC1; p=quarantine` má `dmarc_ok = true` a v UI zelené kolečko.
43. Když DNS server vrátí `SERVFAIL`, `dkim_ok` je `null`, ne `false`, a už ověřená doména zůstane použitelná.
44. CNAME hodnota se skládá z `SigningHostedZone` z API odpovědi, ne z natvrdo napsaného `dkim.amazonses.com`. Ověří to test s podvrženou odpovědí obsahující `a31d.dkim.us-west-2.amazonses.com`.

### 8.8 Plánování

45. Naplánování na čas o 3 minuty v budoucnosti vrátí `422 campaign_schedule_too_soon`.
46. Naplánování na 400 dní dopředu vrátí `422 campaign_schedule_too_far`.
47. Kampaň naplánovaná na 9:00 v zóně `Europe/Prague` se v létě spustí v 07:00 UTC, v zimě v 08:00 UTC.
48. Kampaň, jejíž `scheduled_at` uplynul před 3 hodinami a systém byl mimo provoz, se po startu spustí a odešle se webhook `campaign.schedule_delayed`.
49. Kampaň, jejíž `scheduled_at` uplynul před 9 hodinami, přejde do `schedule_missed` a **neodešle se**.

### 8.9 Neměnnost, undo okno a render_data

54. `PATCH /campaigns/{id}` na `subject` u kampaně ve stavu `sending` vrátí `409 campaign_locked` a přímý `UPDATE` v databázi selže na triggeru.
55. `render_data` má vnořený tvar: `render_data->'contact'->>'first_name'` vrátí jméno. Klíč `"contact.first_name"` na kořeni **neexistuje**.
56. Šablona s `{{ contact.attr.city }}` vede k tomu, že `render_data->'contact'->'attr'->>'city'` obsahuje hodnotu z `contacts.attributes->>'city'`.
57. `render_data` neobsahuje klíče `unsubscribe_url` ani `webview_url` ani `email`.
58. Kampaň s předmětem `Ahoj {{ contact.first_name }}` má `first_name` v `compiled_fields` a v `render_data`.
59. Při `CAMPAIGN_UNDO_WINDOW_SECONDS = 60` mají všechny zprávy `next_attempt_at = audience_built_at + 60 s` a sender po dobu okna neodešle ani jednu.
60. `POST /campaigns/{id}/undo` během okna vede k `cancelled`, `sent_count = 0` a všem zprávám ve stavu `skipped`.
61. `POST /campaigns/{id}/undo` po vypršení okna vrátí `409 campaign_undo_window_expired`.
62. Změna `subject` ve stavu `draft` inkrementuje `campaigns.revision`.

### 8.10 Testovací odeslání

50. Testovací odeslání na 3 adresy vytvoří 3 zprávy s `render_data._test = true`, které se nezapočítají do `campaigns.total_count`.
51. Testovací odeslání na cizí adresu, která je na suppression listu, vrátí `422 test_recipient_suppressed`.
52. Testovací odeslání na adresu vlastníka projektu, která je na suppression listu, projde.
53. Dvacátý první test na tutéž kampaň během hodiny vrátí `429 rate_limited` s hlavičkou `Retry-After`.

### 8.11 Dvousložkový klíč zprávy

63. `message_events` má u každého řádku vyplněné `message_created_at` a `recipient` a obě hodnoty odpovídají zdrojové zprávě.
64. `EXPLAIN` dotazu na timeline zprávy (`WHERE message_id = $1 AND message_created_at = $2`) ukazuje přístup **do jediné partition**, ne do všech.
65. `EXPLAIN` párovacího dotazu z 3.9.4 ukazuje nejvýš dvě prohledávané partition.
66. Rozhodnutí o suppression podle soft bounců **nedělá join na `messages`** a `EXPLAIN` ukazuje index scan nad `idx_message_events__recipient_bounce`.
67. Odpověď `GET /campaigns/{id}/messages` obsahuje u každé zprávy `id` i `created_at`.
68. Payload webhooku `message.bounced` obsahuje `data.message.created_at`.

### 8.12 Suppression přes otisk adresy

73. Kontakt, jehož adresa je na suppression listu v čitelné podobě, se do publika nedostane.
74. Kontakt, jehož adresa byla anonymizovaná po výmazu podle GDPR (v `suppressions` je placeholder a otisk), se po novém importu **do publika nedostane** a v `campaign_audience_progress.skipped_suppressed` se započítá.
75. Suppression s vyplněným `removed_at` kontakt z publika **nevylučuje**.
76. Suppression řádek s otiskem zapsaným **starším pokolením klíče** vyloučí kontakt z publika i po rotaci klíče, protože `contacts.email_fingerprints` nese otisky pod všemi známými pokoleními a dotaz je `s.fingerprint = ANY(c.email_fingerprints)`. Test: zapiš suppression pod pokolením 1, zrotuj klíč, přepočítej `email_fingerprints`, materializuj a ověř, že kontakt v outboxu není. **Druhá polovina téhož testu:** tentýž scénář **bez** přepočtu `email_fingerprints` musí selhat, ne projít. Jinak kritérium netestuje nic a provozní krok z R2.13 by šlo vynechat.
77. Job `outbox.reconcile` zruší `pending` zprávy i tehdy, když se shoda najde jen přes otisk, ne přes čitelnou adresu.

### 8.13 Oddělení předání a doručení

78. Zpráva, kterou SES přijal a která se pak tvrdě odrazila, má `status = 'sent'`, je v `sent_count`, v `bounce_count`, a **není** ve `failed_count`.
79. Kampaň, u níž se všechny zprávy předaly provideru a všechny se pak odrazily, se uzavře jako **`sent`**, ne `failed` ani `partially_sent`.
80. Bounce rate spočítaný dashboardem je u takové kampaně 100 %, ne 0 %.
81. Automatická brzda sepne u kampaně, kde `status` všech zpráv je `sent` a bounce rate z událostí překročí 8 %.
82. Rekoncilace čítačů provede dva samostatné dotazy, jeden nad `messages`, druhý nad `message_events`; dotaz nad `messages` nezmění `bounce_count` a dotaz nad `message_events` nezmění `sent_count`.
83. `deliverability.rollup` bere `sent` z `messages` podle `sent_at` a ostatní sloupce z `message_events` podle `received_at`.
84. Dvě události `bounced_soft` pro tutéž zprávu zvýší `bounce_count` o jedna, ne o dvě (počítá se `count(DISTINCT message_id)`).

### 8.14 Značka `ml_msg` a nejednoznačné odeslání

85. Událost nesoucí `mail.tags.ml_msg` se spáruje na zprávu i tehdy, když `provider_message_id` ještě není zapsaný, a **nevznikne** řádek se stavem `unmatched`.
86. Zpráva s `error_code = 'ambiguous_dispatch'`, pro kterou dorazí jakákoliv událost od providera, se opraví na `status = 'sent'` s doplněným `provider_message_id`, a `error_code` se vyprázdní.
87. Zpráva se `status = 'failed'` a jiným `error_code` než `ambiguous_dispatch` se příchodem události **neopraví** a zůstane `failed`.
88. Lookup podle `ml_msg` a `ml_mday` sáhne do jediné partition, ověřeno přes `EXPLAIN`.

### 8.15 Retence

69. `MESSAGE_RETENTION_DAYS = 90` neodpojí partition, jejíž rozsah zasahuje do posledních 90 dní, i kdyby nejstarší řádek v ní byl starší.
70. Partition, ve které leží kampaň ve stavu `paused`, se **neodpojí**, i když je starší než retenční okno, a zaloguje se varování.
71. Partition, ve které leží zpráva ve stavu `pending` nebo `claimed`, se neodpojí.
72. Kampaň materializovaná 31. 8. má i po dorozeslání v září všechny zprávy v srpnové partition.

### 8.16 Testovací vektory

V `packages/contracts/fixtures/` musí být:

| Fixture | Obsah |
|---|---|
| `sns/notification-bounce-permanent.json` | reálná zachycená SNS zpráva včetně platného podpisu a certifikátu, pro test ověření |
| `sns/notification-bounce-transient-mailboxfull.json` | totéž pro soft bounce |
| `sns/notification-complaint-abuse.json` | stížnost s `complaintFeedbackType: "abuse"` |
| `sns/notification-delivery.json` | doručení |
| `sns/notification-delivery-delay.json` | zpoždění |
| `sns/subscription-confirmation.json` | potvrzení odběru |
| `sns/invalid-cert-url.json` | podvržená `SigningCertURL` |
| `sns/string-to-sign-cases.json` | pole dvojic (zpráva, očekávaný string to sign) pro fixaci kanonizace |
| `ses/get-account-sandbox.json` | odpověď `GetAccount` v sandboxu |
| `ses/get-account-shutdown.json` | odpověď s `EnforcementStatus: "SHUTDOWN"` |
| `ses/get-email-identity-custom-hosted-zone.json` | odpověď s nestandardním `SigningHostedZone` |
| `bounce-classification.csv` | tabulka z 3.10.1 jako strojově čitelný testovací vstup |

`bounce-classification.csv` má sloupce `bounce_type,bounce_sub_type,expected_class,expected_suppression,counts_to_bounce_rate` a test iteruje přes všechny řádky. Tím se zaručí, že se klasifikace nerozejde s dokumentací.

---

## 9. Závislosti

Ověřeno k 2026-07-31 přes `npm view <balíček> license version time.modified` a `api.npmjs.org/downloads/point/last-week`.

| Balíček | Verze | Licence | Poslední změna | Stažení za týden | K čemu |
|---|---|---|---|---|---|
| `@aws-sdk/client-sesv2` | 3.1100.0 | Apache-2.0 | 2026-07-31 | 3 062 390 | SES v2: `GetAccount`, identity, Configuration Set |
| `@aws-sdk/client-sns` | 3.1100.0 | Apache-2.0 | 2026-07-31 | (součást AWS SDK v3) | vytvoření topicu, odběr, `ConfirmSubscription` |
| `sns-validator` | 0.3.5 | Apache-2.0 | 2025-03-27 | 344 868 | ověření podpisu SNS zpráv |
| `psl` | 1.15.0 | MIT | 2024-12-02 | (široce používaný) | určení registrovatelné domény pro DMARC |
| `luxon` | 3.7.2 | MIT | 2025-09-05 | 36 255 963 | práce s IANA zónami při plánování |
| `p-limit` | 7.3.1 | MIT | 2026-07-20 | (široce používaný) | omezení souběžnosti DNS kontrol |

**Pro test SMTP připojení (3.8.2) nezavádím knihovnu.** Test otevře spojení, provede STARTTLS nebo přímé TLS, přihlásí se, pošle `NOOP` a `QUIT`. Na to stačí `node:net` a `node:tls` ze standardní knihovny, dohromady zhruba 80 řádků, a je to jediné místo, kde aplikace mluví SMTP protokolem. Zvažoval jsem `nodemailer` (MIT-0, 9.0.3, aktualizovaný 2026-06-30), který to umí přes `transport.verify()`, ale přidával by 600 kB závislostí kvůli jednomu tlačítku v nastavení. Skutečné odesílání přes SMTP dělá sender v Go přes `wneessen/go-mail`, takže aplikace SMTP klienta nepotřebuje k ničemu jinému.

Všechny licence jsou v povolené sadě (MIT, Apache-2.0, BSD, ISC). Žádná GPL, LGPL ani AGPL.

**Poznámky k volbám:**

- `sns-validator` je udržovaný AWS Labs, ale poslední změna je z března 2025. Není mrtvý, jen stabilní, protože formát SNS podpisu se nemění. **Riziko:** kdyby přestal být udržovaný, je pod Apache-2.0 a jde forknout. Alternativa je vlastní implementace podle 3.8.4, což je asi 60 řádků. Doporučuju knihovnu, protože kanonizace stringu to sign je přesně to místo, kde se dělá chyba, kterou nikdo nenajde, dokud nepřijde útok.
- **Pro DNS kontroly nezavádím knihovnu.** `node:dns/promises` má `resolveTxt`, `resolveCname` i `resolveMx` a nic víc nepotřebujeme. Parsování SPF a DMARC je pár desítek řádků a knihovny na to (`spf-parse`, `dmarc-parser`) jsou buď neudržované, nebo malé natolik, že se nevyplatí. `mailauth` (MIT, 4.13.3, 110 029 stažení týdně) umí SPF, DKIM i DMARC validaci kompletně, ale je určený k **ověřování přijatých zpráv**, ne ke kontrole DNS konfigurace, takže bychom z něj použili zlomek. Zvážit ho stojí za to ve fázi, kdy budeme dělat bounce mailbox.
- **Nezavádím `cron-parser`.** Plánování kampaní je jednorázové na konkrétní čas, ne cronové. Cron pro joby řeší pg-boss.

---

## 10. Požadavky na ostatní části

### 10.1 Na část 1 (platforma)

| # | Požadavek |
|---|---|
| R1.1 | Potvrdit nebo opravit dvanáct předpokladů z kapitoly 1.5. |
| R1.2 | Vlastnit finální DDL `messages` a claim dotaz (kontrakt 1). Můj návrh je v 2.4. Potřebuju v něm zachovat: `created_at` v primárním klíči, unikátní index `(campaign_id, contact_id)` na partition, sloupce `render_data`, `email`, `attempts`, `next_attempt_at`, `claimed_by`, `claimed_at`. |
| R1.3 | **Vyřízeno kontraktem, zbývá upřesnění.** Invariant I1 o jednotném `created_at` je v 4.10.1 zapsaný. Zbývá zúžit jeho formulaci, viz R1.11. |
| R1.4 | Přesný formát obálky šifrování credentials (kontrakt 4) včetně HKDF `info` řetězce, protože ho musí umět i Go. |
| R1.5 | Mechanismus zakládání partition pro `messages`, `message_events` a `provider_event_receipts` včetně zakládání indexů uvedených v kapitole 2. |
| R1.6 | Vyjmout `/api/webhooks/ses/*` z globálního rate limitingu a z CSRF ochrany. |
| R1.7 | Vyjmout `/u/*` (odhlašovací endpoint) z CSRF ochrany a povolit na něm `POST` bez session, jinak nebude fungovat one-click odhlášení podle RFC 8058. |
| R1.8 | **Opraveno podle skutečného stavu části 1.** Granty pro `mlain_sender` jsou `SELECT, UPDATE` na `messages`, `SELECT` na `campaigns`, `sending_providers`, `campaign_links`, `workspaces` a **`INSERT` na `message_events`**. Poslední jmenované jsem měl v dokumentu popřené a bylo to špatně. Otevřená otázka z toho plynoucí je v nálezu A3 revize: pokud sender do `message_events` skutečně zapisuje, musí vyplnit i `message_created_at`, `recipient` a `rank`, které jsou `NOT NULL`. Moje preference je, aby nezapisoval a událost `sent` vytvářela aplikace ze SES eventu `Send`. |
| R1.9 | Infrastruktura odchozích webhooků, do které deklaruju události z 4.4. |
| R1.10 | Katalog chybových kódů, do kterého přidávám kódy z 4.1.2 jako hodnoty pole `code` v RFC 9457 odpovědi. Potřebuju k nim doplnit `type` URI a anglické `title`. |
| R1.11 | **Invariant I1 je v kontraktu, žádám o zúžení jeho formulace.** Dnes v 4.10.1 zní „Všechny řádky jedné kampaně mají `created_at` rovné `campaigns.audience_built_at`", tedy jako obecná vlastnost tabulky `messages`. V té podobě je to celoproduktové pravidlo, které **zakazuje opakované a průběžné kampaně**: automatizace, drip sekvence a transakční proud produkují zprávy průběžně po měsíce a jedno `created_at` na ně dát nejde. Žádám o formulaci **„všechny řádky, které vytvoří jeden materializační běh jedné dávkové (batch) kampaně"**, plus větu, že série a opakování se řeší novými řádky `campaigns` s odkazem na rodiče, ne rozvolněním invariantu. Vlastnost, kterou index potřebuje, tím neslábne ani o kus: unikátnost se vyhodnocuje v rámci `campaign_id`, takže rozsah „jeden běh jedné kampaně" je přesně ten, na kterém index stojí. Rozbor v mé 2.4. |
| R1.12 | Potvrdit, že smím na `messages` přidat indexy `idx_messages__provider_message_id` a `idx_messages__ws_email_pending` (2.4). Kontrakt to dovoluje, ale mají dopad na rychlost zápisu, takže to má vědět i část 4b. |
| R1.13 | **Zapracovat mé konfigurační proměnné do tabulky 4.9.** Základ (18 položek) tam už je, ověřeno čtením, včetně dvojice `AMBIGUOUS_DISPATCH_POLICY_SES` = `fail` a `AMBIGUOUS_DISPATCH_POLICY_SMTP` = `retry`, kterou podle P4-2 vlastním já a kterou jsem si opravil ve své 4.6. **Nově prosím o šest dalších**, které dosud byly zadané prózou uvnitř mých kapitol a katalog je nezná: `CAMPAIGN_QUOTA_PAUSE_REMAINING` (100), `CAMPAIGN_QUOTA_RESUME_REMAINING` (1000), `CAMPAIGN_TEST_SEND_PER_HOUR` (20), `DELIVERABILITY_BOUNCE_WARN_RATE` (0.04), `DELIVERABILITY_COMPLAINT_WARN_RATE` (0.001), `DELIVERABILITY_CONTENT_BOUNCE_LIMIT` (100). Typy a rozsahy jsou v mé 4.6. U pěti proměnných z rodiny `DELIVERABILITY_*` a u `CAMPAIGN_UNDO_WINDOW_SECONDS` navíc patří do popisu věta, že jsou to **současně výchozí hodnota i strop pro nastavení projektu** (3.15.2.1 a 3.6.4), protože jinak si je někdo vyloží jako pevnou hodnotu instalace. |
| R1.14 | **Zaregistrovat mé chybové kódy** do `packages/core/errors/registry.ts` (14 vlastních po revizi, seznam v 4.1.2), každý s HTTP statusem a příznakem opakovatelnosti, plus `type` URI a anglický `title`. |
| R1.15 | **Vyřízeno.** Claim dotaz v kontraktu 1 dnes filtruje `c.deleted_at IS NULL` i `w.deleted_at IS NULL`, ověřeno čtením 4.10.1. Blokace na úrovni API (3.6.3) zůstává jako druhá vrstva, ne jako jediná. |
| R1.16 | **Zanést do kontraktu 1 pravidlo o variantě obsahu.** Zavádím na `messages` nepovinný sloupec `content_variant_id uuid` jako rezervu pro A/B test z MVP 1 (moje 2.3.1 a 2.4). Přidání sloupce kontrakt dovoluje a o to nežádám. Žádám o **jednu větu v kontraktu**: *prázdná hodnota `messages.content_variant_id` znamená, že se obsah bere ze sloupců kampaně*. Musí to být v kontraktu, protože podle toho se rozhoduje Go strana, a bez toho by si TS a Go vyložily prázdnou hodnotu každý jinak. V MVP 0 je sloupec vždy prázdný, materializace ho v `INSERT`u neuvádí, takže **dnes se nemění chování ani jeden řádek kódu senderu**. Zakládám to teď, protože přidat prázdný sloupec dnes stojí jeden `ALTER TABLE`, kdežto za rok do partitionované tabulky s desítkami milionů řádků na self-hosted instalacích je to ta nejrizikovější operace, jakou tenhle produkt zná. Stejné rozhodnutí projekt už jednou udělal u `content_snippets` v části 3. |
| R1.17 | **Rozšířit registr kódů `pause_reason`** (4.10.1) tak, aby `provider_quota_exhausted` směla zapisovat **i aplikace**, ne jen sender. Vyčerpanou kvótu zjistí obojí: sender z odpovědi provideru, aplikace z `GetAccount` v jobu `provider.refresh_quota` (moje 3.14.4). Registr má dnes u toho kódu jen sender, takže aplikace nemá co zapsat, a zavést pro totéž druhý kód by znamenalo, že obnovovací job musí hlídat dva a při přidání třetího pisatele tři. **Kód popisuje příčinu, `source` říká, kdo zápis provedl.** Prosím tedy o změnu sloupce „kdo zapisuje" na „sender nebo aplikace" u tohohle jediného kódu; ostatní osm ať zůstane rozdělených, jak jsou. |
| R1.18 | **Doplnit do kontraktu 1 sloupec `messages.kind`** s hodnotami `campaign` a `test` (a s prostorem pro `transactional`), `NOT NULL DEFAULT 'campaign'`. Dnes tuhle dimenzi supluje příznak `render_data['_test']` a statistiky se filtrují dotazem do JSONB (moje 3.17.1). Tři důvody, proč to nestačí: filtr `NOT (render_data ? '_test')` musí být v každém reportu, rollupu i agregaci a stačí ho v jednom z deseti dotazů vynechat; `render_data` má být snapshot personalizace pro šablonu, ne nosič řídicích příznaků; a anonymizace při výmazu `render_data` vyprazdňuje, takže by testovací zpráva po výmazu kontaktu přestala být rozeznatelná a připočetla by se do statistik zpětně. Sloupec je v outboxu, tedy v kontraktní podmnožině, proto si ho nesmím zavést sám. Do té doby platí `_test` jako **dočasná realizace**, ne jako rozhraní pro část 5. |

### 10.2 Na část 2 (kontakty a segmenty)

| # | Požadavek |
|---|---|
| R2.1 | **Funkce pro kompilaci publika do SQL**, ne jen segmentu:<br>`compileAudienceToSql(audience: CampaignAudience, opts: { workspaceId, asOf: Date, paramOffset: number }): { sql: string; params: unknown[] }`<br>Vrácené `sql` je **poddotaz vracející jeden sloupec `contact_id`**, použitelný uvnitř `WHERE c.id IN (<sql>)`, bez `ORDER BY` a `LIMIT`, s pozicovými parametry od `paramOffset`.<br><br>Musí uvnitř sebe aplikovat **všechny podmínky způsobilosti**: `deleted_at IS NULL`, `processing_restricted = false`, `list_subscriptions.status = 'confirmed'`, `snooze_until IS NULL OR snooze_until < now()`, plus cokoliv, co přibude později. Nechci si je psát do vlastního SQL, protože dvě kopie se rozejdou.<br><br>**`asOf` je povinný.** Všechny relativní podmínky (`za posledních N dní`, `poslední aktivita`) se musí vyhodnotit proti němu, ne proti `now()`. Předám `campaigns.audience_built_at`. Bez toho vidí první a poslední dávka materializace jiné publikum a slib hlavní specifikace o zmrazeném publiku tiše neplatí. |
| R2.2 | **Funkce `suppressions.add(...)`** podle 3.10.4, idempotentní, s podporou `reason` z mého výčtu (`hard_bounce`, `complaint`, `soft_bounce_threshold`, `ses_suppressed`) a `source = 'ses_event'`. |
| R2.3 | **Odhlašovací endpoint `/u/<token>`** musí přijímat `POST` s tělem `List-Unsubscribe=One-Click` a odhlásit okamžitě bez potvrzovací stránky (RFC 8058). Na `GET` zobrazí preference. Bez session, bez CSRF, odpověď do 2 sekund, idempotentní. Formát tokenu vlastní část 5. |
| R2.4 | Při odhlášení, změně stavu kontaktu a zápisu na suppression list **volat `campaigns.revokePendingMessages`** podle 3.4.1, **ne psát vlastní `UPDATE` nad `messages`**. Ve vaší sekci o odhlášení máte přímý `UPDATE messages SET ... error = 'unsubscribed'`, který navíc použije sloupec `error`, jaký v kontraktu neexistuje (je tam `error_code` a `error_detail`), takže by spadl.<br><br>Při odhlášení z jednoho seznamu předejte `listId`. Bez něj zrušíte i čekající zprávy z kampaní na jiné seznamy, na kterých je kontakt dál přihlášený, a je to tichá ztráta pošty. |
| R2.5 | Při výmazu kontaktu (GDPR) volat `campaigns.anonymizeMessages(contactId)`, který přepíše `messages.email` a vyprázdní `render_data`, ale řádky zachová. Potvrdit, že to odpovídá vašemu výkladu výmazu. **Pozor: je to návrh podléhající právnímu posouzení**, otevřená otázka O11. Nespoléhejte se na něj jako na hotové rozhodnutí; kdyby právník rozhodl pro mazání řádků, změní se název i chování téhle funkce. |
| R2.6 | Materializace snapshotuje **všechna pole z katalogu `CONTACT_MERGE_FIELDS`**, který vlastní část 2, ne z mého vlastního výčtu. Původně jsem tu měl deset sloupců a byl to užší seznam než katalog: chyběly `middle_name`, `title_prefix`, `title_suffix`, `gender`, `locale` a `created_at`. Uživatel by dal do šablony `{{ contact.title_prefix }}`, validátor by to propustil a příjemce by dostal prázdno. Potřebuju tedy katalog jako **exportovanou konstantu s mapováním merge tag → sloupec**, ne jako text v dokumentu.<br><br>**Výjimka `contact.email`:** ten merge tag se do `render_data` **nesnapshotuje**, sender ho bere z `messages.email`. Kdyby se snapshotoval, byla by adresa v databázi dvakrát a mohla by se rozejít. Katalog ho musí obsahovat (aby ho validátor propustil), ale s příznakem, že jeho zdrojem je outbox, ne `render_data`.<br><br>Potvrdit, že `greeting` je skutečný sloupec, ne funkce za běhu. **Ověřeno vlastní revizí, je to sloupec** (`02-kontakty.md` ř. 301), takže tenhle bod je uzavřený. |
| R2.7 | Index na `contacts (workspace_id, id)` nebo takový, který umožní kurzorový průchod `WHERE workspace_id = $1 AND id > $2 ORDER BY id LIMIT 5000` bez seřazení celé tabulky. |
| R2.8 | Definovat, co znamená „platná e-mailová adresa" pro účely materializace, a poskytnout tutéž validaci, jakou používá import. Nechci mít dvě různá pravidla. |
| R2.9 | `suppressions.email` je `citext`, `messages.email` je podle kontraktu `text`. Join mezi nimi se vyhodnotí v citext sémantice a nemusí použít můj funkcionální index `(workspace_id, lower(email))`. Řeším to u sebe explicitním `lower(m.email) = lower(s.email::text)`, ale dejte prosím vědět, jestli nechcete raději doplnit index `suppressions ((email::text))`. Stejný efekt potká každého, kdo bude joinovat `contacts` na `messages`. |
| R2.10 | **UZAVŘENO.** `'ses_suppressed'` v `CHECK (reason IN (...))` u `suppressions` už je, ověřeno čtením `02-kontakty.md`. Část 2 ho navíc správně odlišuje od `hard_bounce` (odebírá se v konzoli SES, ne u nás) a má k němu poznámku, že až přibude druhý provider, přidá se `provider_suppressed` a tahle hodnota zůstane historická. S tím souhlasím, nic dalšího nežádám. |
| R2.11 | **UZAVŘENO.** Ověřeno čtením `02-kontakty.md`: část 2 dnes uvádí, že práh měkkých odrazů **vlastní část 4a** (3 odrazy ve 30 dnech), hodnotu nedefinuje ani nekopíruje a jen konzumuje volání `suppressions.add` s `reason = 'soft_bounce_threshold'`. To je přesně to, oč jsem žádal. Hodnoty zůstávají v `SOFT_BOUNCE_THRESHOLD` a `SOFT_BOUNCE_WINDOW_DAYS`. |
| R2.12 | Katalog `CONTACT_MERGE_FIELDS` exportovat jako konstantu s mapováním merge tag → sloupec, viz R2.6. |
| R2.13 | **Otisky adres pro kontrolu suppression. Návrhová část vyřešena, zbývá provozní.** Ověřeno čtením `02-kontakty.md`: `contacts.email_fingerprints bytea[]` nese otisky pod **všemi známými pokoleními** klíče a má GIN index, `suppressions.fingerprint bytea` plus `fingerprint_key_id` nese jeden otisk pod pokolením, kterým byl zapsaný. To je správné rozdělení: u kontaktu plaintext máme a otisk umíme dopočítat, u suppression řádku po výmazu ne. Materializace i rekoncilace proto píšou `s.fingerprint = ANY(c.email_fingerprints)` (moje 3.3.3, 3.3.5 a 3.4.2), což splňuje kontraktní pravidlo „hledej přes všechna pokolení" a **nepotřebuje znát klíč**. Dřívější znění tohohle požadavku mluvilo o joinu dvou skalárních `email_hash`, což bylo zastaralé.<br><br>**Co od vás potřebuju:** po rotaci `SECRET_KEY` musí běžet job, který doplní nové pokolení do `contacts.email_fingerprints` u všech kontaktů. Dokud neproběhne, kontakty nesou jen stará pokolení a suppression řádky zapsané po rotaci se s nimi netrefí. Je to jediná zbývající tichá porucha v tomhle mechanismu a musí na ni být test, viz mé kritérium 76. |

### 10.3 Na část 3 (obsah a šablony)

| # | Požadavek |
|---|---|
| R3.1 | **Funkce kompilace** se signaturou:<br>`compileTemplate(design: BlockDocument, ctx): { html: string; text: string; usedFields: string[]; links: Array<{ url: string; position: number; label?: string }> }`<br>`usedFields` jsou merge tagy v kanonické tečkové notaci (`contact.first_name`, `contact.attr.city`), protože z nich odvozuju `render_data`. `links` plním do `campaign_links`. |
| R3.2 | `compiled_html` musí obsahovat Liquid placeholdery **nedotčené** a nesmí obsahovat žádný Liquid, který není v povoleném subsetu z kapitoly 4.5 hlavní specifikace. Validace je na vaší straně, já se na ni spoléhám a nekontroluju ji znovu. |
| R3.3 | Kompilace musí být **deterministická**: stejný vstup dá bajtově stejný výstup. Počítám z něj `compiled_hash` a podle něj poznávám, že se šablona změnila. |
| R3.4 | `usedFields` **nesmí obsahovat** `unsubscribe_url` ani `webview_url`. Ty generuje sender z tokenu, ne z `render_data`. Když je vrátíte, budu je ignorovat, ale radši je nevracejte. |
| R3.5 | Odpovědět, **co se má stát při chybě interpolace za běhu** (kontrolní otázka 7 vaší části). Můj požadavek: nikdy nezastavovat kampaň. Buď dosadit prázdný řetězec, nebo označit zprávu jako `failed` s kódem `render_error`. Preferuju prázdný řetězec, protože jedna chybějící hodnota nemá zabít doručení. |
| R3.6 | Poskytnout ukázková data pro testovací odeslání, když je publikum prázdné (3.17). |
| R3.7 | **`usedFields` musí zahrnovat i merge tagy z předmětu a preheaderu**, ne jen z těla. Předmět je Liquid šablona (3.7.3) a bez toho by jeho hodnoty chyběly v `render_data` a příjemce by dostal prázdný předmět. |
| R3.8 | Potvrdit, že kompilace vrací `usedFields` v kanonické tečkové notaci s nejvýše dvěma úrovněmi (`contact.first_name`, `contact.attr.city`). Hlubší cesty neumím snapshotovat, viz 3.3.4. |
| R3.9 | Prefix vlastních polí je **`contact.attr.<key>`**, ne `contact.custom.<key>`. Katalog merge tagů vlastní část 2 a rozhodla takhle; opravil jsem se na `attr`. Kdyby validátor propustil `attr` a já vyráběl `custom`, vyrenderovalo by se prázdno u každého vlastního pole v každé kampani, a je to chyba, kterou nikdo neodhalí v náhledu, protože ten používá jiná data. |

### 10.4 Na část 4b (sender)

Tohle je nejdůležitější blok, protože jsme dvě poloviny jednoho toku.

| # | Požadavek |
|---|---|
| R4b.1 | Potřebuju **číslo, ne princip**: jaká je nejdelší doba mezi claimem a zápisem výsledku dávky? Podle ní kalibruju prahy v `outbox.stall_watch` (3.7.4), aby nehlásil planý poplach. Kontraktní `SENDER_CLAIM_TTL_SECONDS` je 300 s, moje prahy jsou 5 a 15 minut. |
| R4b.2 | Sender **nikdy nemaže řádky** z `messages`. Povolené přechody má v kontraktu 4.10.1 a patří mezi ně i `claimed → skipped` (kontrola suppression těsně před odesláním), takže ten přechod **není výhradně můj**, jak jsem původně napsal. Dělba je: `pending → skipped` dělá aplikace, `claimed → skipped` sender. Ostatní přechody ze stavu `claimed` jsou senderovy. |
| R4b.3 | Sender **neaktualizuje čítače v `campaigns`**. Dělám to já z outboxu. Kdybyste to dělali vy, budeme se prát o řádek kampaně. |
| R4b.4 | Sender zapisuje `provider_message_id` **do stejné transakce**, ve které nastavuje `status = 'sent'`. Bez toho mi události od SES nebudou mít co spárovat. |
| R4b.5 | Sender čte kvótu a rychlost z `sending_providers.quota_max_send_rate`, **nevolá `GetAccount` sám**. Aktualizaci sloupce dělám já každých 15 minut. |
| R4b.6 | Sender rozlišuje trvalé chyby providera a zapisuje je do `messages.error` s kódem, který umím rozpoznat. Potřebuju minimálně: `account_suspended` (SES `AccountSuspendedException`), `sending_paused` (`SendingPausedException`), `mail_from_not_verified` (`MailFromDomainNotVerifiedException`), `message_rejected` (`MessageRejected`), `rate_limited` (`TooManyRequestsException`). Na první dva reaguju přechodem provideru do `blocked`. |
| R4b.7 | **Vyřízeno kontraktem.** Claim dotaz v části 1 obsahuje podmínku `c.status IN ('queueing','sending')`, ne `c.status = 'sending'`, jak jsem dřív citoval. Rozdíl je podstatný: sender odebírá práci **už během materializace**, což je záměr (uživatel vidí první odeslané zprávy do několika sekund), a pauza z toho důvodu musí fungovat z obou stavů, viz moje 3.6.1. Odpauzování bez komunikace se mnou funguje v obou případech. Otevřená věc kolem měkce smazané kampaně je uzavřená, viz R1.15. |
| R4b.8 | Sender vkládá hlavičky podle politiky v 3.16. Hodnoty `List-Unsubscribe` staví z trackovacího tokenu (kontrakt 3, vlastní část 5) a z `mail_from_domain`, který mu předám v `campaigns` nebo `sending_providers`. Potvrďte, odkud je chcete číst. |
| R4b.9 | Sender posílá přes SES **`SendEmail` s `Content.Raw`**, ne `Content.Simple`. Zdůvodnění: potřebujeme plnou kontrolu nad hlavičkami `List-Unsubscribe`, `List-Unsubscribe-Post`, `Precedence` a `Message-ID`, a `Simple` je v tomhle omezené. `ConfigurationSetName` bere z `config_public.configurationSetName`. |
| R4b.10 | Sender přidává `EmailTags` s klíči `ml_msg` (hodnota `messages.id`), **`ml_mday`** (hodnota `to_char(created_at,'YYYYMMDD')`, viz 3.9.5), `ml_campaign` a `ml_workspace`. Bez `ml_mday` mi samotné `ml_msg` nestačí, protože primární klíč zprávy je dvousložkový a lookup podle samotného ID projde všechny partition. Používám je pro dohledání v CloudWatch a pro fine-grained feedback. Pozor na omezení SES: název i hodnota jen ASCII písmena, číslice, podtržítko a pomlčka, max 256 znaků. UUID s pomlčkami projde. |
| R4b.11 | Graceful shutdown: rozpracovanou dávku buď dokončit, nebo vrátit `claimed → pending` s `claimed_by = NULL`. Nikdy ji nenechat viset, protože pak se čeká 120 s na reaper. |
| R4b.12 | Vaše rozhodnutí k otázce 5 zadání (jak se zaručí, že se zpráva neodešle dvakrát při pádu mezi odesláním a zápisem stavu) potřebuju znát, protože podle něj napíšu text u čísla nejasně odeslaných zpráv v dashboardu (3.7.4). Můj názor: nulová duplicita není dosažitelná bez idempotency klíče na straně SES, který SES nemá. Realistický cíl je „nejvýš jednou za normálního provozu, nejvýš dvakrát při pádu", a to se má napsat do dokumentace. |
| R4b.13 | K přechodu `claimed → skipped`, který vám kontrakt povoluje: **pokud ho implementujete**, zmenší to okno z 3.4.3 z desítek sekund na jednotky a uvítám to. Podmínky: sender potřebuje `SELECT` na `suppressions`, což mu granty v části 1 zatím nedávají (hlásím to jako nález A2 revize), kontrola musí být dávková (`WHERE lower(email) = ANY($1)`), ne dotaz na zprávu, a musí respektovat `removed_at IS NULL`. Kdyby to bylo drahé nebo kdyby granty nedostal, funguje to i bez toho, jen s větším oknem. Není to blokující požadavek. |
| R4b.14 | Potvrďte, že do `error_code` píšete hodnoty z uzavřeného výčtu, ne volný text. Rozhoduju se podle nich (R4b.6) a zobrazuju je uživateli přeložené. Volný text bych musel ukazovat syrový. |
| R4b.15 | Načítejte `campaigns.revision` v claim dotazu a použijte `(campaign_id, revision)` jako klíč cache hlavičky kampaně (3.7.3). Cache pak nepotřebuje TTL a nemůže zastarat. |
| R4b.16 | `subject` a `preheader` jsou Liquid šablony, ale renderují se v **textovém režimu bez HTML escapování**. Tělo se renderuje s escapováním podle kontraktu 2. Jsou to tedy dva různé režimy volání téhož enginu. `&amp;` v předmětu je viditelná chyba, kterou uvidí každý příjemce. |
| R4b.17 | **Vaše navržené DDL `messages` je v rozporu s kontraktem 1 části 1.** Konkrétně: `error jsonb` versus kontraktní `error_code text` + `error_detail text`; chybí `claim_expires_at` a `updated_at`; váš `idempotency_key` v kontraktu není. Kontrakt vlastní část 1, takže platí její verze. `dispatch_started_at`, který navrhujete, tam **je** a řeší přesně ten problém, kvůli kterému jste chtěli `idempotency_key`. Když trváte na `idempotency_key`, je to změna kontraktu a musí projít částí 1, ne dohodou mezi námi dvěma. |
| R4b.18 | **Opraveno podle kontraktu, moje dřívější verze byla špatně.** Nejsou to jedna proměnná a jedna výchozí hodnota, ale dvě: `AMBIGUOUS_DISPATCH_POLICY_SES` = **`fail`** a `AMBIGUOUS_DISPATCH_POLICY_SMTP` = **`retry`**. Vaše zjištění K3 bylo správné: **SES `Message-ID` vždy přepisuje**, takže deterministická hlavička se k příjemci nedostane a pojistka „server duplikát zahodí" na hlavním provideru neexistuje. Scénář `OB-11` ověřuje, že hlavičku posíláme identickou, ne že ji příjemce uvidí.<br><br>Z toho pro vás plyne: politiku čtete z prostředí per typ provideru, ne jednu globální, a stav `ambiguous_dispatch` je u SES **běžný důsledek pádu, ne anomálie**. Počet takových zpráv ukazuju v dashboardu (3.7.4) a v reportu jsou jako samostatná kategorie „nejisté odeslání", ne mezi selháními. |

### 10.5 Na část 5 (tracking a reporty)

| # | Požadavek |
|---|---|
| R5.1 | **Formát trackovacích tokenů** (kontrakt 3) včetně varianty pro odhlášení (`/u/<token>`), protože ji potřebuju v politice hlaviček (3.16). Token musí být vázaný na `message_id` a `workspace_id` a nesmí obsahovat čitelnou adresu. |
| R5.2 | Reporty počítat z `message_events`, ne z `messages.status`. Stav zprávy je zjednodušení, které kvůli pořadí událostí nemusí odpovídat realitě (3.9.3). |
| R5.3 | Katalog typů událostí z 3.9.2 je můj, vy k němu přidáváte `opened` a `clicked`. Potvrďte, že se nepřekrýváme a že používáte tutéž tabulku `message_events`. |
| R5.4 | SSE kanál pro živý průběh kampaně konzumující `CampaignProgress` z 4.2. |
| R5.5 | Metrika „nespárované události" na dashboardu doručitelnosti (počet `provider_event_receipts` se stavem `unmatched`). |
| R5.6 | **Testovací zprávy vyloučit ze všech reportů a statistik.** Nepište si prosím do kódu podmínku `render_data ? '_test'`. Ten příznak je **dočasná realizace**, ne rozhraní: supluje chybějící dimenzi „druh zprávy" a žádám část 1 o kontraktní sloupec `messages.kind` (R1.18), po jehož zavedení `_test` zmizí. Konzumujte proto pomocnou funkci nebo pohled, který dodám z `packages/core/campaigns`, ať se změna odehraje na jednom místě a vaše reporty se neopraví až tím, že jim začnou sedět čísla. Podrobně v mé 3.17.1. |
| R5.7 | **Pozor na dvousložkový klíč zprávy.** Trackovací token nese podle kontraktu 3 jen `message_id`, ne `created_at`. Když z open nebo click endpointu potřebujete dohledat zprávu (kvůli `campaign_id` a `contact_id`), samotné `message_id` vede na sken všech partition. Doporučený postup: omezte rozsah pomocí `issued_at` z tokenu, který máte, výrazem `created_at BETWEEN to_timestamp($issued_at) - interval '30 days' AND to_timestamp($issued_at)`. `issued_at` je vždy větší nebo rovno `created_at` zprávy, protože zpráva vzniká při materializaci a token se vyrábí až při odeslání; rozdíl je nejvýš doba běhu kampaně. Tím se dostanete na jednu až dvě partition. |
| R5.8 | Když do `message_events` zapisujete `opened` a `clicked`, **vyplňte i `message_created_at`, `recipient` a `rank`** (2.5). Pro `opened` a `clicked` použijte rank 40 a 50, aby zapadly mezi `delivered` (30) a `bounced_soft` (60). Bez `message_created_at` bude timeline zprávy skenovat všechny partition. |

---

## 11. Rozpory s hlavní specifikací

### 11.1 `messages` nemůže mít globálně unikátní `(campaign_id, contact_id)`

**Kde:** kapitola 5 hlavní specifikace, tabulka `messages` s poznámkou `-- partition by month`.

**Rozpor:** Postgres nedovolí unikátní index na partitionované tabulce, pokud neobsahuje partition key. Bez takového indexu ale materializace není idempotentní.

**Stav: vyřešeno částí 1**, která do kontraktu dala `uq_messages__campaign_contact (campaign_id, contact_id, created_at)`. Zbývá doplnit invariant o jednotném `created_at` na kampaň (R1.11), bez kterého ten index duplicity nezachytí. Hlavní specifikace by při konsolidaci měla poznámku upřesnit.

### 11.2 Index `(status, next_attempt_at) WHERE status IN ('pending','claimed')` je pro claim horší než dva samostatné

**Kde:** kapitola 5 hlavní specifikace, poznámka pod tabulkou `messages`.

**Rozpor:** claim dotaz filtruje výhradně `status = 'pending'`, reaper výhradně `status = 'claimed'`. Společný index obsahuje obojí a je při vysoké propustnosti zbytečně široký.

**Stav: vyřešeno částí 1**, která má `idx_messages__claimable (next_attempt_at, id) WHERE status='pending'` a `idx_messages__stuck (claim_expires_at) WHERE status='claimed'`. Doporučuju opravit i hlavní specifikaci při konsolidaci.

### 11.3 „Bounce > 5 %, complaints > 0,1 %" jako prahy varování je nepřesné

**Kde:** kapitola 6.6 hlavní specifikace: „varování při překročení prahů (bounce > 5 %, complaints > 0,1 %)".

**Rozpor:** ta čísla nejsou prahy pro varování, jsou to prahy, **při kterých AWS už jedná** a dává účet pod dohled. Varovat až v okamžiku, kdy je účet pod dohledem, je pozdě.

**Ověřená čísla (AWS dokumentace, 31. 7. 2026):** bounce rate 5 % znamená účet pod dohledem, 10 % možné zastavení odesílání; complaint rate 0,1 % pod dohledem, 0,5 % možné zastavení. Doporučená hodnota je bounce pod 2 %.

**Moje řešení:** vícestupňové prahy v 3.15.2 s varováním už při 2 % a 0,05 % a automatickou brzdou při 8 % a 0,3 %.

**Dopad:** produktově významné. Doporučuju opravit i v hlavní specifikaci.

### 11.4 SES „SendEmail s Configuration Set" nestačí, potřebujeme `Content.Raw`

**Kde:** kapitola 4.2 a 6.6 hlavní specifikace.

**Rozpor:** není to rozpor v operaci (`SendEmail` je správně, `SendRawEmail` je API v1), ale v obsahu. `SendEmail` v API v2 má tři varianty obsahu a `Simple` neumožňuje plnou kontrolu nad hlavičkami, kterou potřebujeme kvůli `List-Unsubscribe-Post` a `Message-ID`.

**Moje řešení:** `SendEmail` s `Content.Raw`, viz R4b.9.

**Dopad:** jen upřesnění, žádná změna architektury.

### 11.5 „SES → SNS → /webhooks/ses" bez identifikace projektu

**Kde:** kapitola 4.2 hlavní specifikace, diagram toku.

**Rozpor:** jeden společný endpoint pro všechny projekty by musel projekt určovat z obsahu SNS zprávy, čemuž se nedá věřit. Multi-projekt s vlastním SES účtem na projekt znamená vlastní topic na projekt.

**Moje řešení:** endpoint `/api/webhooks/ses/{provider_id}` a kontrola `TopicArn` proti uloženému ARN (3.8.4).

**Dopad:** žádný, jen upřesnění cesty.

### 11.6 Zrušení kampaně: `skipped`, ne `failed`. UZAVŘENO

**Kde:** část 1, kontrakt 1, tabulka přechodů, dřívější řádek `pending → failed` s podmínkou „zrušení kampaně".

**Byl to rozpor:** `failed` znamená „pokusili jsme se odeslat a nepovedlo se". Zrušená kampaň se o odeslání nepokusila. Kdyby zrušení psalo `failed`, započítalo by se do `failed_count`, kampaň by podle pravidla v 3.7.2 vypadala jako `partially_sent` a dashboard doručitelnosti by ukazoval desítky tisíc selhání, která žádná selhání nejsou.

**Stav: uzavřeno, ověřeno čtením části 1.** Kontraktní tabulka přechodů dnes vede zrušení kampaně na řádku `pending → skipped` („kontakt se mezitím odhlásil, dostal se na suppression list, **nebo byla kampaň zrušena**") a řádek `pending → failed` pro tenhle případ zmizel. Navíc přibyl scénář `OB-14`, který u zrušení kampaně s 500 `pending` a 50 `claimed` očekává, že 500 přejde na `skipped` a **žádný na `failed`**.

Moje 3.6.3 tedy s kontraktem souhlasí beze zbytku a z tohohle rozporu nezbývá žádná akce.

### 11.7 Postgres 18 místo 17. UZAVŘENO

**Kde:** hlavní specifikace uváděla PostgreSQL 17, část 1 navrhovala 18 kvůli vestavěné `uuidv7()`.

**Uzavřeno rozhodnutím zadavatele:** projekt cílí na **poslední produkční verzi PostgreSQL**, dnes 18. Závazné je pravidlo, ne číslo. Hlavní specifikace je opravená.

**Nebyl to můj rozpor**, jen jsem ho zaznamenal, protože se ho drží i moje DDL: sloupce `id` mají `DEFAULT uuidv7()` a materializační SQL v 3.3.3 se na to spoléhá. Záložní varianta pro 17 (generovat ID v aplikaci a předávat je v `INSERT`) se nepoužije.

### 11.8 Sender nečte kontakty, ale musí číst `campaigns`

**Kde:** kapitola 5 hlavní specifikace: „sender může běžet s databázovým uživatelem, který má práva jen na `messages`, `campaigns` a `sending_providers`".

**Není to rozpor, jen doplnění:** sender potřebuje ještě `SELECT` na `campaign_links` kvůli přepisu odkazů. Doplněno v R1.8.

### 11.9 Dvousložkový klíč zprávy prosakuje do všech konzumentů

**Kde:** rozpor R5 části 1. `messages` má `PRIMARY KEY (id, created_at)`, protože partitionovaná tabulka musí mít partition key v klíči.

**Není to rozpor, se kterým bych nesouhlasil**, ale zaznamenávám jeho rozsah, protože je větší, než se na první pohled zdá, a dotýká se tří částí najednou:

- **Moje strana:** `message_events` jsem doplnil o `message_created_at` a `recipient`, jinak by každý skok z události na zprávu skenoval všechny partition. `provider_event_receipts` dostalo totéž. Párovací dotaz i webhookový payload nesou obě složky. Prošel jsem všech deset dotazů nad `messages` a `message_events`.
- **Část 5:** trackovací token podle kontraktu 3 nese jen `message_id`, takže **z tokenu samotného nejde určit partition**. Řešitelné odvozením rozsahu z `issued_at` (požadavek R5.7), ale je to obcházení, ne čisté řešení.
- **Čisté řešení, které nenavrhuju:** přidat `created_at` do payloadu tokenů. Zvětšilo by to open token ze 74 na 78 znaků a click z 96 na 100. Je to levné, ale kontrakt 3 je uzavřený a měnit ho kvůli optimalizaci, kterou lze obejít, se nevyplatí. **Kdyby se ale kontrakty ještě otevíraly z jiného důvodu, tohle je věc, kterou stojí za to přibalit.**

Doporučuju do kontraktu 1 doplnit větu, že **každý odkaz na zprávu z jiné tabulky musí nést obě složky klíče**. Teď to tam není a je to přesně ten typ věci, kterou každý implementátor vyřeší jinak.

### 11.12 Otisk adresy: kontrakt počítá, materializace joinuje (HLÁSÍM NAHLAS)

**Kde:** kontrakt části 1, sekce 3.10, bod 3: „Kontrola, jestli je adresa na suppression listu, spočítá otisk **pro všechna známá pokolení klíče, bez horního omezení**, a hledá `WHERE fingerprint = ANY($1)`." Proti tomu moje dřívější materializace, která joinovala dva skalární sloupce `email_hash` bez `key_id`.

**Stav: vyřešeno, kapitolu nechávám jako záznam.** Obojí se mezitím posunulo a rozpor zmizel. Níže je původní rozbor a pod ním, co z něj zbývá.

**Není to chyba kontraktu, je to neúplnost, která se projeví až po první rotaci klíče.** Popisuju obojí, protože orchestrátor chtěl slyšet nahlas i to, co vypadá jen jako detail.

**Problém 1 (vyřešený): dva různé postupy pro dvě různé úlohy.** Postup z kontraktu (spočítat otisk pro každé pokolení, hledat `ANY`) je správný, když ověřuješ **jednu adresu**. Pro materializaci milionového publika by znamenal miliony HMAC operací navíc a přístup materializace ke klíči, který nemá důvod mít.

**Řešení, které mezitím zavedla část 2, je lepší než obě varianty, které jsem zvažoval:** předpočítat otisky **na straně kontaktu, pod všemi pokoleními**, do sloupce `contacts.email_fingerprints bytea[]` s GIN indexem. Materializace pak píše `s.fingerprint = ANY(c.email_fingerprints)`, což je jeden indexovaný průchod, splňuje kontraktní pravidlo „hledej přes všechna pokolení" doslova, a klíč nepotřebuje znát. HMAC operace se udělají jednou při zápisu kontaktu, ne při každé materializaci.

**Problém 2 (zmenšený z návrhového na provozní): po rotaci klíče přestane join sedět.** V původním návrhu se dvou skalárních `email_hash` to byla tichá porucha bez jakéhokoliv projevu: `suppressions` by nesly pokolení 2, `contacts` pokolení 1, join by přestal nacházet shody a lidé, kteří uplatnili právo na výmaz, by dostali poštu.

Pole otisků na straně kontaktu tu díru zavírá **za předpokladu, že se pole po rotaci doplní**. Zbývá tedy provozní povinnost, ne návrhová vada: po rotaci `SECRET_KEY` musí běžet job, který nové pokolení dopočítá do `contacts.email_fingerprints` u všech kontaktů. Dokud neproběhne, netrefí se s kontaktem suppression řádky zapsané **po** rotaci, což je menší a dočasné okno než původní stav, ale pořád okno. Proto na to mám dvoudílné akceptační kritérium 76.

**Co z toho zbývá:**

1. ~~Do kontraktu doplnit větu o rovnocenném postupu pro dávkové úlohy.~~ **Odpadá.** Tvar `= ANY(pole)` je přímo ten postup, který kontrakt předepisuje, jen s otisky spočítanými předem. Žádná výjimka pro dávkové úlohy není potřeba.
2. ~~Část 2 doplní `contacts.email_hash_key_id`.~~ **Vyřešeno jinak a líp:** `contacts.email_fingerprints bytea[]` místo skaláru s `key_id`.
3. **Zůstává:** job, který po rotaci klíče doplní nové pokolení do `contacts.email_fingerprints`, a testovací scénář „rotace klíče a poté materializace". Bez toho testu se tenhle stav neodhalí, protože se neprojeví žádnou chybou.

Zapsáno jako požadavek R2.13.

### 11.13 Rozřešení nejednoznačného odeslání vyžaduje zakázaný přechod (HLÁSÍM NAHLAS)

**Kde:** kontrakt 4.10.1, ř. 2761: „Zakázané přechody, které musí odmítnout aplikační kód a musí mít test: `sent → pending`, `sent → claimed`, **`sent → failed`**, `failed → sent`, `skipped → cokoliv`, `pending → sent` (bez claimu)."

**Problém:** Schválený mechanismus se značkou `ml_msg` (3.9.5) stojí na tom, že aplikace opraví nejednoznačnou zprávu na `sent`, jakmile pro ni dorazí událost. U SES je politika `fail`, takže taková zpráva má stav **`failed`**. Oprava je tedy přechod `failed → sent`, který kontrakt výslovně zakazuje a vyžaduje na něj test.

Mechanismus je přitom dobrý a chci ho: bez něj zůstane každá nejednoznačná zpráva navždy jako selhání, přestože máme přímý důkaz od providera, že odešla. Uživatel by ji viděl v kategorii „nejisté odeslání" a mohl by ji doposlat, čímž by vznikl přesně ten duplikát, kterému se politikou `fail` vyhýbáme.

**Tři možná řešení, rozhodnutí není moje:**

| # | Řešení | Cena |
|---|---|---|
| A | Rozšířit kontrakt o **úzkou výjimku**: `failed → sent` je povolený **výhradně** tehdy, když `error_code = 'ambiguous_dispatch'` a děje se to při zpracování události od providera. | Jedna věta v kontraktu a jeden test navíc. Výjimka je auditovatelná, protože je vázaná na konkrétní hodnotu `error_code`. |
| B | Nechat stav `failed` a opravu neprovádět, jen doplnit `provider_message_id` a zapsat událost. | Nula změn v kontraktu, ale kampaň napořád vykazuje selhání, která selháními nebyla, a `sent_count` je trvale podhodnocený. |
| C | Zavést stav `dispatched_unknown` mimo trojici koncových stavů. | Nový stav v kontraktu, dopad na sender, na claim dotaz i na UI. Nejdražší. |

**Doporučuju A.** Je to nejmenší možná změna a dobře se hájí: přechod nemění realitu, opravuje naši neznalost o ní. Stav `ambiguous_dispatch` doslova znamená „nevíme, jestli jsme předali", a událost od providera je důkaz, že ano. Zákaz `failed → sent` má chránit před tím, aby se selhání tiše přepsalo na úspěch; tady se nepřepisuje selhání, ale nejistota.

**ROZHODNUTO: varianta A.** Kontrakt 4.10.1 dostává úzkou výjimku, která povoluje přechod `failed → sent` **výhradně** tehdy, když `error_code = 'ambiguous_dispatch'` a přechod provádí aplikace při zpracování události od providera. Vázanost na konkrétní hodnotu `error_code` dělá výjimku auditovatelnou. Zdůvodnění je to výše: nepřepisuje se selhání, ale nejistota.

**Varianta B zamítnuta:** kampaň by napořád vykazovala selhání, která selháními nebyla, a `sent_count` by byl trvale podhodnocený. **Varianta C zamítnuta** jako nejdražší, nový stav by zasáhl kontrakt, sender, claim dotaz i UI.

Změna kontraktu je zanesená v části 1, sekce 4.10.1, včetně testovacího scénáře, který ověřuje, že s jiným `error_code` přechod selže.

### 11.10 Plochý versus vnořený tvar `render_data` (moje vlastní chyba, opravená)

**Kde:** moje původní znění 3.3.4, které předepisovalo plochou mapu s klíči v tečkové notaci.

**Chyba:** Liquid v obou implementacích překládá `{{ contact.first_name }}` na přístup k vlastnosti vnořeného objektu. Plochý klíč `"contact.first_name"` by se nevyhodnotil a všechna personalizace by byla prázdná. Upozornila na to část 4b a má pravdu.

**Opraveno** na vnořený tvar v 3.3.4. Zaznamenávám to sem, protože je to přesně ten druh chyby, kterou by dva nezávislí implementátoři postavili každý jinak, a je poučné, že ji odhalila až křížová kontrola s konzumentem.

### 11.11 Návrh DDL `messages` v části 4b se rozchází s kontraktem části 1

**Kde:** část 4b navrhuje vlastní úplné DDL `messages` s `error jsonb` a `idempotency_key text`.

**Rozpor:** kontrakt 1 (část 1, sekce 4.10.1) má `error_code text` a `error_detail text` a `idempotency_key` neobsahuje. Kontraktní podmnožinu vlastní část 1 a explicitně říká, že se názvy, typy ani sémantika kontraktních sloupců nesmí měnit.

**Moje stanovisko:** platí verze části 1 a moje kapitola 2.4 ji přebírá. Problém, kvůli kterému 4b chtěla `idempotency_key`, řeší kontraktní `dispatch_started_at` a `ambiguous_count` v kombinaci s dvojicí `AMBIGUOUS_DISPATCH_POLICY_SES` a `AMBIGUOUS_DISPATCH_POLICY_SMTP`. Pokud by se ukázalo, že to nestačí, je to změna kontraktu a patří na společnou synchronizaci, ne do dvoustranné dohody mezi částmi 4a a 4b. Zapsáno jako R4b.17.

---

## 12. Otevřené otázky

| # | Otázka | Kdo rozhoduje | Můj návrh |
|---|---|---|---|
| O1 | ~~Má se kampaň při 8 % bounce rate sama pozastavit, nebo jen varovat?~~ | **uzavřeno** | Obojí: žluté varování při **4 %**, automatická pauza při **8 %**. Práh varování se posunul z 5 % dolů, aby zbyl prostor zasáhnout dřív, než účet vezme pod dohled Amazon. Obě hranice se vyhodnocují až po `DELIVERABILITY_GUARD_MIN_SENT`, viz 3.15.2. |
| O2 | ~~Smí uživatel odebrat adresu ze suppression listu?~~ | **uzavřeno** | Platí verze **části 2**, protinávrh 4a se stahuje: tvrdý odraz jde odblokovat nejdřív po 30 dnech a jen po jedné adrese, stížnost nikdy, hromadné odblokování neexistuje. Suppression list vlastní část 2. |
| O3 | ~~Kolik soft bounců znamená suppression?~~ | **uzavřeno** | 3 měkké odrazy v okně 30 dní. |
| O4 | ~~Catch-up okno pro zmeškaný plán: 6 hodin?~~ | **uzavřeno** | Ano, 6 hodin, konfigurovatelné. |
| O5 | ~~Má nástroj sám zakládat SNS topic a odběr v účtu uživatele?~~ | **uzavřeno** | Automatické založení konfigurace v AWS účtu je výchozí režim, ruční režim zůstává jako alternativa. |
| O6 | ~~Retence `messages` 90 dní?~~ | **uzavřeno** | Ano, 90 dní pro detail zprávy. Agregované statistiky kampaně zůstávají. |
| O7 | Kanonizace SNS string to sign: závěrečný newline ano, nebo ne? | technické, empiricky | Ověřit proti reálné zprávě a použít `sns-validator`. Zapsat do golden fixture. |
| O8 | ~~SMTP bez zpětné vazby: podporovat v MVP 0?~~ | **uzavřeno** | Obecné SMTP podporovat, ale s výslovným varováním v UI, že se suppression list u tohohle provideru neplní sám. |
| O9 | ~~Kdo generuje `Message-ID` a v jaké doméně?~~ | **uzavřeno** | Vyřešeno kontraktem 4.10.1: sender, tvar `<ml.{base32_lower(uuid_bytes(id))}@{sending_domain}>`, deterministicky z `messages.id`. |
| O10 | ~~Má se odeslání blokovat při chybějícím DMARC?~~ | **uzavřeno** | Chybějící DMARC jen varovat, neblokovat. Gmail a Yahoo ho sice vyžadují, ale blokovat kvůli tomu první kampaň nového uživatele je moc tvrdé. |
| O11 | Anonymizace versus mazání zpráv při GDPR výmazu kontaktu | **čeká na právníka** | Návrh zůstává: anonymizovat, aby nezmizely statistiky kampaní. Rozhodnutí je odložené do posouzení právníkem, produkt ho nezavírá. |
| O12 | Sdílení kvóty mezi víc běžícími sendery | část 4b | Nemám názor na algoritmus, ale potřebuju vědět, jestli se dělí staticky (kvóta / počet senderů), nebo dynamicky. Ovlivňuje to, jak počítám `eta_seconds`. |
