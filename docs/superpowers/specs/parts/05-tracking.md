# Část 5: Tracking, timeline a reporty

Vlastník: subagent part5-tracking
Datum: 2026-07-31
Rozvíjí kapitoly hlavní specifikace: 4.3, 4.4, 6.7 (a části 5, 9 v rozsahu eventů a soukromí)
Stav: koncept

---

## 0. Pro netechnického recenzenta

Tahle kapitola je psaná pro člověka, který nepíše kód, ale rozhoduje o produktu. Odborné termíny vysvětluju v závorce, když se poprvé objeví.

### 0.1 Co tahle část dělá, na konkrétním příkladu

Jana dostane od e-shopu newsletter. Otevře ho v mobilu, klikne na tlačítko „Letní výprodej", přistane na e-shopu, prohlédne si dvě boty a jedny hodí do košíku. Pak zavře prohlížeč a nic nekoupí.

Tahle část nástroje má za úkol, aby marketér e-shopu druhý den viděl na jedné obrazovce tohle:

```
Jana Nováková  jana@example.cz
14:02  dostala kampaň "Letní výprodej"
14:07  otevřela e-mail
14:07  klikla na "Zobrazit výprodej"
14:07  navštívila /vyprodej
14:09  prohlédla si produkt "Tenisky Alpha 42"
14:11  přidala do košíku (1 490 Kč)
14:12  odešla
```

A aby se na tuhle posloupnost dalo navázat („komu se ukázal košík a do 24 hodin nenakoupil, tomu pošli připomínku"). Bez propojení kliku v mailu s chováním na webu je nástroj jen o něco modernější rozesílač mailů. Tohle propojení je to, čím se produkt liší.

Kromě toho tahle část počítá čísla do reportů (kolik lidí kampaň dostalo, otevřelo, prokliklo) a stará se o to, aby report u kampaně na milion adres otevřel do vteřiny.

### 0.2 Jak to technicky funguje, jednou větou na krok

1. **Otevření.** Do e-mailu se vloží obrázek velký jeden bod (v oboru se mu říká „trackovací pixel"), který je průhledný a nejde ho vidět. Když si poštovní program obrázek stáhne z našeho serveru, zaznamenáme otevření.
2. **Kliknutí.** Odkazy v e-mailu se přepíšou tak, aby vedly nejdřív na náš server. Ten klik zapíše a hned přesměruje na skutečný cíl. Uživatel to nepozná, zdrží ho to o zlomek vteřiny.
3. **Propojení s webem.** Při tom přesměrování přidáme do adresy jednorázový klíč, který platí patnáct minut. Náš skript na e-shopu ho sebere, ověří u nás, a od té chvíle ví, že tenhle anonymní návštěvník je Jana. Klíč z adresy hned odstraníme, aby se nikam nekopíroval.
4. **Chování na webu.** Malý skript na e-shopu (do 5 kB, tedy zhruba jako jedna malá fotka) posílá události typu „zobrazil stránku", „prohlédl produkt", „přidal do košíku".
5. **Časová osa.** Všechno výše se slije do jedné časové osy u kontaktu.

### 0.3 Klíčová rozhodnutí a co znamenají pro uživatele

| Rozhodnutí | Co to znamená pro uživatele produktu |
|---|---|
| Odkaz v e-mailu neobsahuje e-mailovou adresu, jen podepsaný kód | Když se e-mail přepošle dál, příjemce z odkazu nevyčte, komu byl původně poslaný |
| Přesměrování vede jen na adresy, které byly v šabloně v době odeslání | Nikdo nemůže náš odkaz zneužít k tomu, aby posílal lidi na podvodný web pod naší doménou |
| Jednorázový klíč pro propojení se přidá jen na domény, které si zákazník sám povolí | Identita nikdy neuteče na cizí web, na který v mailu odkazujete (třeba na Facebook) |
| Skript se bez souhlasu nespustí vůbec | Nesbíráme nic, dokud návštěvník nesouhlasí. Není to filtr až po sběru |
| Reporty ukazují otevření ve třech číslech místo jednoho | Uživatel vidí, kolik z otevření je pravděpodobně falešných. Podrobně v 0.4 |
| Hlavní číslo na dashboardu je proklik, ne otevření | Proklik se dá měřit spolehlivě, otevření ne. Vedeme uživatele k číslu, kterému může věřit |
| Časová osa se drží 26 měsíců, pak se maže | Databáze nenaroste do nekonečna. Doba jde nastavit od 3 do 120 měsíců |

### 0.4 Proč čísla v reportech nejsou přesná

Tohle je nejdůležitější odstavec celého dokumentu pro netechnického čtenáře. **Míra otevření e-mailu je od roku 2021 nespolehlivá metrika a žádný nástroj na světě to neumí spravit.** Kdo tvrdí opak, buď lže, nebo tomu nerozumí.

Důvody, seřazené podle velikosti dopadu:

**1. Apple Mail předstírá otevření u úplně všech e-mailů.** Apple v roce 2021 zavedl funkci Mail Privacy Protection. Poštovní aplikace Apple si po doručení sama a bez vědomí uživatele stáhne všechny obrázky ze zprávy, včetně našeho trackovacího pixelu, a to přes svoje servery. Stáhne je i tehdy, když uživatel zprávu nikdy neotevře a rovnou ji smaže. Z našeho pohledu to vypadá jako otevření. Uživatel s iPhonem tedy „otevře" 100 % e-mailů, které mu pošlete. Apple navíc skryje jeho IP adresu, takže nevíme ani, ze které země se díval, a stáhne obrázky v náhodnou dobu, takže nesedí ani hodina otevření.

Jaký je to podíl? Podle měření velkých poskytovatelů se to pohybuje mezi třetinou a dvěma třetinami všech příjemců podle typu publika. U české spotřebitelské databáze počítejte s vysokými desítkami procent, u B2B databáze méně.

**2. Gmail si obrázky také stahuje přes svoje servery.** Google to dělá od roku 2013. Na rozdíl od Applu ale obvykle až v okamžiku, kdy uživatel zprávu skutečně otevře, takže tahle otevření jsou většinou pravá. Nespolehlivá je u nich jen IP adresa a typ zařízení. Vedlejší efekt: jedno otevření se občas započítá dvakrát nebo třikrát, protože se obrázek stahuje znovu.

**3. Bezpečnostní filtry firem proklikají všechny odkazy.** Firemní antispam (Proofpoint, Mimecast, Barracuda a další) po doručení navštíví každý odkaz v mailu, aby ověřil, že nevede na malware. Z našeho pohledu to vypadá jako kliknutí, které přijde pár vteřin po doručení a často na všechny odkazy najednou. Tohle nafukuje **kliknutí**, což je jinak naše nejspolehlivější metrika. Umíme to většinou rozpoznat podle toho, že přijde příliš brzy, ze serverovny a najednou na víc odkazů.

**4. Blokátory reklam a poštovní programy s vypnutými obrázky.** Kdo má vypnuté stahování obrázků, ten se do otevření nezapočítá nikdy, ani kdyby mail četl desetkrát. To čísla naopak podstřeluje.

**5. Blokátory na webu.** Náš skript na e-shopu blokátory blokovat mohou. Proto ho jde provozovat na vlastní subdoméně zákazníka (`events.mujeshop.cz` místo cizí domény), což většinu blokování obejde. I tak počítejte s tím, že 5 až 20 % návštěv se do webové části timeline nedostane.

**Praktický důsledek, který musí produktové rozhodování unést:** absolutní míra otevření nemá téměř žádnou informační hodnotu, srovnávat ji mezi kampaněmi má smysl jen v rámci jedné databáze a jednoho období. **Proklik, odhlášení, stížnost a nákup jsou tvrdá čísla.** Otevření je měkký odhad.

#### Jak to podat v UI, aby uživatel nedělal špatná rozhodnutí

Návrh, o kterém potřebuju rozhodnutí recenzenta:

1. **Otevření se v reportu neukazuje jako jedno číslo.** Ukazují se tři, vedle sebe:
   - **Otevření celkem** 68,4 % (všechno, co jsme viděli)
   - **Z toho pravděpodobně automatická** 41,1 % (Apple a spol.)
   - **Ověřená otevření** 27,3 % s poznámkou „z těch, u kterých to jde měřit"
2. **Vedle čísla otevření je vždycky ikonka s vysvětlením.** Jedna věta plus odkaz na delší text. Nikdy jen holé číslo.
3. **Hlavní, největší číslo v reportu i na dashboardu je míra prokliku, ne otevření.** Tohle je vědomé vychýlení pozornosti k metrice, které jde věřit.
4. **Když kampaň nemá dost dat**, například pod 200 doručených, čísla se ukazují jako počty, ne jako procenta, a s poznámkou „malý vzorek".
5. **Segmenty typu „neotevřel posledních 5 kampaní" varují**, že u Apple uživatelů toto pravidlo nefunguje, protože ti otevřou vždycky. Doporučí se místo toho „neklikl".

Alternativa, kterou nedoporučuju: skrýt otevření úplně. Uživatelé je znají z Ecomailu a Mailchimpu, absence by vypadala jako chybějící funkce, ne jako poctivost.

### 0.5 Soukromí: co přesně o lidech sbíráme

**Co ukládáme u otevření e-mailu**

| Údaj | Ukládáme? | Poznámka |
|---|---|---|
| Které zprávě otevření patří | ano | Tím pádem i kterému kontaktu |
| Čas | ano | |
| Označení poštovního programu | ano, hrubě | Například „Apple Mail", „Gmail", „ostatní" |
| IP adresa | **ne** | Ukládá se jen země odvozená z IP a to jen pokud je to zapnuté. Samotná IP se zahodí |
| Přesná poloha | ne | Nikdy |

**Co ukládáme u kliknutí:** totéž plus na který odkaz se kliklo.

**Co ukládáme u chování na webu**

| Údaj | Ukládáme? | Poznámka |
|---|---|---|
| Adresa navštívené stránky | ano | Ale bez citlivých parametrů, viz níže |
| Titulek stránky, odkud přišel | ano | |
| Anonymní identifikátor prohlížeče | ano | Náhodné číslo v prohlížeči, samo o sobě neříká, kdo to je |
| Vlastní události, které si zákazník nastaví | ano | Například „přidal do košíku" a cena |
| Rozlišení obrazovky, jazyk, typ zařízení | ano, hrubě | Kvůli segmentaci na mobil versus desktop |
| IP adresa | **ne** | Použije se jen pro odvození země a pak se zahodí, do databáze se nezapisuje |
| Obsah formulářů, hesla, čísla karet | **nikdy** | Skript je z principu nesbírá, neposlouchá psaní do políček |
| Pohyby myší, nahrávání obrazovky | **nikdy** | Je to explicitní ne-cíl produktu |
| Otisk prohlížeče (fingerprint) | **nikdy** | Explicitní ne-cíl |
| Chování na cizích webech | **nikdy** | Skript funguje jen na doménách, které si zákazník sám zaregistruje |

**Automatické čištění adres.** Z adresy stránky se před uložením smažou parametry, které bývají citlivé: `token`, `password`, `email`, `phone`, `otp`, `code`, `session`, `key`, `signature`, `access_token` a několik dalších. Seznam je konfigurovatelný a jde ho rozšířit. Když adresa vypadá jako obnova hesla nebo přihlášení, uloží se jen cesta bez parametrů.

**Souhlas jako vstupní podmínka.** Skript se bez souhlasu nespustí, neuloží si do prohlížeče vůbec nic a neodešle ani jedinou událost. Není to tak, že bychom sbírali a pak filtrovali. Když návštěvník souhlas odvolá, identifikátor v prohlížeči se smaže a sběr okamžitě skončí.

**Co se stane, když někdo požádá o výmaz.** Smaže se propojení mezi anonymním identifikátorem a kontaktem, události se buď smažou, nebo se z nich odstraní vazba na osobu podle volby správce (statistiky kampaní pak zůstanou správné, jen anonymní).

**Riziko, na které recenzenta výslovně upozorňuju.** Jednorázový klíč, který propojuje klik v mailu s webem, cestuje v adrese webové stránky. Kdyby se přidával i na cizí domény, mohl by cizí web zjistit, že jeho návštěvník je konkrétní příjemce naší kampaně. Proto se přidává jen na domény, které si zákazník výslovně zaregistroval, platí patnáct minut a jde použít jen jednou. Tohle omezení hlavní specifikace neobsahuje a považuju ho za nutné.

### 0.6 Kompromisy a co znamenají pro provoz

| Kompromis | Přínos | Cena |
|---|---|---|
| Klik se zapisuje do databáze až po přesměrování uživatele | Přesměrování je rychlé, uživatel nečeká | Při tvrdém pádu serveru se ztratí posledních maximálně 250 ms kliků |
| Statistiky se předpočítávají průběžně, ne až při otevření reportu | Report na milion zpráv se otevře do vteřiny | Čísla mohou být o pár vteřin pozadu, což je u živého odesílání viditelné a je to v pořádku |
| Události se ukládají do měsíčních oddílů | Mazání starých dat je okamžité místo hodinového | O jeden údržbový úkol navíc, běží automaticky každou noc |
| Neukládáme IP adresy | Podstatně menší riziko podle GDPR | Nemáme přesnou geolokaci a hůř se dohledávají zneužití |
| Vlastní minimalistický skript místo hotové knihovny | Velikost do 5 kB, žádná cizí závislost v prohlížeči zákazníka | Musíme ho napsat a testovat sami |

Provozní dopad na velikost dat: při 100 000 kontaktech a průměrné aktivitě to vychází zhruba na 20 až 60 milionů událostí za rok, tedy jednotky až desítky GB. Retence 26 měsíců drží databázi ve velikosti, kterou zvládne jeden běžný server.

### 0.7 Otázky pro recenzenta

Tyhle otázky jdou zodpovědět bez znalosti kódu a potřebuju na ně odpověď, než se začne stavět.

1. **Souhlasí recenzent s tím, že hlavní metrikou na dashboardu bude proklik, a ne otevření?** Je to proti zvyklostem oboru a proti tomu, na co jsou uživatelé z Ecomailu zvyklí.
2. **Mají se falešná Apple otevření z čísel odečítat automaticky, nebo má být přepínač?** Klaviyo a Mailchimp mají přepínač. Návrh je odečítat vždy a zobrazovat oboje. Přepínač znamená, že si každý vybere číslo, které se mu líbí.
3. **Má se ukládat země odvozená z IP adresy?** Zapnuto to znamená lepší reporty, vypnuto to znamená menší riziko podle GDPR. Návrh: vypnuto ve výchozím stavu, zapínatelné na úrovni projektu.
4. **Jak dlouho se mají držet události?** Návrh 26 měsíců, protože to pokryje meziroční srovnání plus rezervu. Delší doba znamená větší databázi a větší riziko.
5. **Má se sledovat i to, na kterou konkrétní pozici odkazu v mailu se kliklo** (dva odkazy na stejnou adresu, jeden v obrázku a jeden v textu)? Je to informace navíc pro optimalizaci šablon, ale zvětší to tabulku odkazů.
6. **Má nástroj nabízet takzvané „prediktivní otevření"**, tedy dopočítání pravděpodobných otevření u Apple uživatelů podle chování zbytku? Některé nástroje to dělají. Je to statistický odhad, který vypadá jako fakt. Návrh: nedělat.
7. **Kdo je v cílovém zákazníkovi zodpovědný za souhlasy?** Náš skript souhlas konzumuje, ale nezobrazuje cookie lištu. Předpokládáme, že zákazník má vlastní řešení (Cookiebot a podobně) a jen nám souhlas předá. Je to správný předpoklad, nebo máme lištu dodávat?
8. **Je 15 minut správná platnost jednorázového klíče** pro propojení kliku s webem? Kratší je bezpečnější, ale rozbije to případ „kliknu v mobilu, dočtu si to a za půl hodiny se vrátím".

---

## 1. Rozsah

### 1.1 Co tato část vlastní

- Formát podepsaných trackovacích tokenů (`t1`), odvození klíče, rotace, testovací vektory
- Endpoint pro otevření (open pixel) a jeho chování
- Endpoint pro kliknutí (click redirect), ochrana proti open redirectu
- Klasifikace otevření a kliknutí (Apple MPP, obrazové proxy, boti, bezpečnostní skenery)
- Web SDK (`sdk-web`): veřejné API, velikost, dávkování, souhlas, session
- Ingestion API pro události z prohlížeče i ze serveru
- Identity resolution: vazba `anonymous_id` na `contact_id`, slučování a jeho vracení
- Předání identity z kliku v mailu na web (`oe_token`)
- Datový model událostí, partitioning, retence
- Customer timeline: dotazy, stránkování, výkon
- Reporty kampaní, katalog metrik, agregace, dashboard
- Realtime aktualizace v UI (SSE)

### 1.2 Co tato část vědomě nevlastní

| Oblast | Vlastník | Naše vazba |
|---|---|---|
| Generování tokenů při odesílání, vkládání pixelu, přepis odkazů | část 4b (sender) | Vlastníme formát, sender ho implementuje. Viz 12.1 |
| Tabulka `messages`, `campaign_links`, životní cyklus kampaně | část 4a | Čteme, nezapisujeme |
| Události od providera (delivered, bounce, complaint) | část 4a | Konzumujeme je do reportů |
| Datový model kontaktu | část 2 | Zapisujeme `contacts.last_activity_at` a čteme identitu |
| Souhlasy a jejich model | část 2 | SDK je konzumuje, nezakládá |
| Segmentační engine | část 2 | Dodáváme mu vstupní data o engagementu |
| Kompilace šablony, registrace odkazů | část 3 | Konzumujeme `campaign_links` |
| Autentizace, API klíče, rate limiter, formát chyb | část 1 | Používáme jejich infrastrukturu |

### 1.3 Ne-cíle této části

Session replay, heatmapy, autocapture celého DOM, fingerprinting, pravděpodobnostní cross-device spojování, cross-site atribuce, ukládání surových IP adres, prediktivní dopočet otevření. Přebírá se z kapitoly 2.2 hlavní specifikace a rozšiřuje se o poslední bod.

### 1.4 Sladění s konvencemi z části 1

Tato část byla původně psaná proti předpokladům, protože `parts/01-platforma.md` v tu chvíli neexistoval. Po jeho dokončení je celý dokument sladěný. Tabulka je zápis toho, co se změnilo, aby recenzent nemusel porovnávat dvě verze.

**Závazné sekce části 1, kterými se tato část řídí:** 2.1 (konvence databáze), 3.10 (rotace `SECRET_KEY`), 4.1 (konvence API), 4.2 (chyby), 4.3 (stránkování), 4.5 (rate limiting), 4.9 (konfigurace), 4.10.3 (kontrakt trackovacích tokenů), 6 (bezpečnostní hlavičky a CORS).

| Původní předpoklad | Skutečnost v části 1 | Dopad na tuto část |
|---|---|---|
| `SECRET_KEY` se používá jako UTF-8 bajty řetězce | 3.10: `SECRET_KEY` je base64url bez paddingu, dekóduje se na přesně 32 B, `MASTER = base64url_decode(SECRET_KEY)` | **Formát tokenů kompletně přepsán**, viz 3.1 |
| HKDF `salt = "openengage.tracking.v1"`, `info` s epochou | 3.10: `salt = "openengage/v1"`, `info = "openengage/v1/tracking-token"`, bez epochy | Přepsáno, klíč se nevěže na `key_id` |
| Vlastní tvar tokenu `t1.<payload>.<tag>`, MAC nad ASCII | 4.10.3: `"t1" || base64url(type ‖ key_id ‖ payload ‖ mac)`, MAC nad binárním vstupem s prefixem `"openengage/token/v1"` | Přepsáno |
| `kind` jako `uint8` 1/2/3, generace klíče jako `key_epoch` 0 až 255 | 4.10.3: `type` jako ASCII znak `o`/`c`/`i`/`u`, `key_id` 1 až 255 | Přepsáno |
| `link_id` je `uint32` odpovídající `campaign_links.position` | 4.10.3: `link_id` je UUID (16 B), tedy `campaign_links.id` | Přepsáno, viz 3.4.1. Je to lepší, redirect nepotřebuje `campaign_id` |
| Token nese `campaign_id`, aby redirect nemusel do databáze | 4.10.3: open a click token nesou `workspace_id` a `message_id`, click navíc `link_id` | Horká cesta přepsána, viz 3.4.4 a 3.2.3 |
| Identifikační token nese `message_id` a `host_hash`, nikdy `contact_id` | 4.10.3: identity token nese `workspace_id`, `contact_id`, `campaign_id`, `nonce`, `expires_at` | Přepsáno. **Bezpečnostní výhrada v 13.8** |
| Chyby jako `{ "error": { ... } }` | 4.2: RFC 9457 Problem Details, `application/problem+json`, rozhoduje pole `code` | Katalog chyb přepsán, viz 4.4 |
| Ingestion na `POST /e/v1/batch` | 4.1 a 6: povrch `/e/**`, konkrétně `POST /e/track` s CORS `*` | Cesty sjednoceny, viz 4.1 |
| JSON klíče `camelCase` | 4.1: JSON klíče jsou `snake_case` | Všechny payloady přepsány |
| `web_events` partitionované podle `ts`, PK `(ts, workspace_id, id)` | 2.1: partiční klíč je vždy náš čas (`received_at`), PK `(id, received_at)`, čas události je samostatný sloupec | DDL přepsáno, viz 2.2 |
| Vlastní job `db.maintain_partitions` | 2.1: `platform.maintain_partitions` vlastní část 1, pomocné funkce v `packages/db` | Job zrušen, viz 3.14 |
| Vlastní odhad, že `pg_partman` nepoužijeme | 2.1: totéž rozhodnutí, vlastní údržba | Shoda, jen se odkazuju |
| Index bez jmenné konvence | 2.1: `idx_<tabulka>__<sloupce>`, `uq_<tabulka>__<sloupce>` | Všechny indexy přejmenovány |
| Konfigurace `TRACKING_URL` | 4.9: `TRACKING_DOMAIN` | Přejmenováno, viz kapitola 8 |
| Rate limiting token bucket, vlastní čísla | 4.5: posuvné okno s pevnými sloty, `rate-limiter-flexible`, konkrétní limity | Převzato, viz 3.7.4 a výhrada v 13.10 |
| PostgreSQL 17 | 2.1: PostgreSQL 18 kvůli `uuidv7()` | Bez dopadu na tuto část, jen využívám `uuidv7()` v DDL |

**Co z části 1 přebírám beze změny a nekopíruju sem:** formát a ověřování API klíčů (3.5), veřejný klíč `oe_pub_` (3.5), izolaci workspace a RLS (3.6), stránkování kurzorem (4.3), idempotenci zápisů (4.4), i18n katalogy (3.9), bezpečnostní hlavičky a CSP (6), audit log (3.7), infrastrukturu odchozích webhooků (3.8).

---

## 2. Datový model

### 2.1 Přehled tabulek

| Tabulka | Vlastník | Partitioning | Charakter |
|---|---|---|---|
| `web_events` | část 5 | RANGE (`received_at`), měsíčně | obsah neměnný, atribuční sloupce měnitelné, největší objem |
| `web_event_months` | část 5 | ne | pomocná, řídká, zrychluje timeline |
| `identities` | část 5 | ne | aktuální vazba anonymního ID na kontakt |
| `identity_bindings` | část 5 | ne | historie vazeb, append only |
| `identity_merges` | část 5 | ne | záznam o slučování historie, umožňuje vrácení |
| `identity_token_uses` | část 5 | ne | jednorázovost `oe_token` |
| `tracking_domains` | část 5 | ne | povolené domény pro SDK a pro `oe_token` |
| `message_engagement` | část 5 | RANGE (`created_at`), měsíčně | jeden řádek na zprávu, derivovaný stav |
| `contact_engagement` | část 5 | ne | jeden řádek na kontakt, rollup pro segmentaci a presety čištění |
| `campaign_stats` | část 5 | ne | předpočítané souhrny kampaně |
| `campaign_stats_buckets` | část 5 | ne | průběh v čase pro graf |
| `campaign_link_stats` | část 5 | ne | statistika na odkaz |
| `proxy_ranges` | část 5 | ne | cache IP rozsahů obrazových proxy |
| `message_events` | **část 4a** | RANGE (`created_at`), měsíčně | zapisujeme do ní open a click, viz 12.2 |
| `messages`, `campaign_links` | **část 4a** | | jen čteme |

**Izolace projektů: RLS na každé tabulce této části.** Konvence 3.6 části 1 vyžaduje nad každou tabulkou s `workspace_id` politiku `ws_isolation`. Původní verze tohoto dokumentu spoléhala jen na repository vrstvu, což je aplikační pojistka, ne databázová.

```sql
ALTER TABLE web_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE web_event_months     ENABLE ROW LEVEL SECURITY;
ALTER TABLE identities           ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_bindings    ENABLE ROW LEVEL SECURITY;
ALTER TABLE identity_merges      ENABLE ROW LEVEL SECURITY;
ALTER TABLE tracking_domains     ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_engagement   ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_engagement   ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_stats       ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_stats_buckets ENABLE ROW LEVEL SECURITY;
ALTER TABLE campaign_link_stats  ENABLE ROW LEVEL SECURITY;
-- politika ws_isolation podle vzoru z 3.6 části 1, pro každou z nich
```

Bez RLS je nejděravější místo přesně tam, kde **segmentační dotaz části 2 joinuje přes hranici domény**, tedy `contacts` na `contact_engagement` a `web_events`. Repository vrstva hlídá dotazy, které sama staví; segmentační engine si SQL skládá sám z AST, takže je to jediná vrstva, která ho zachytí.

**Dvě tabulky RLS nemají a je to schválně:** `identity_token_uses` (nemá `workspace_id`, klíčem je náhodný `nonce` a řádek žije 15 minut) a `proxy_ranges` (globální provozní data, žádný obsah zákazníka).

Otevřená otázka na část 1 je v požadavku 12.5.15: potvrdit, že RLS funguje nad **partitionovanými** tabulkami a že politika neruší partition pruning. U `web_events` je to zásadní, protože na pruningu stojí celý výkonový rozpočet timeline.

### 2.2 `web_events`

**Partiční klíč je `received_at`, ne čas události.** Konvence 2.1 části 1 to vyžaduje a má pravdu, kterou jsem v předchozí verzi neviděl: čas události přichází od klienta, tedy od třetí strany, a offline fronta v SDK ho může doručit až sedm dní po vzniku. Kdyby byl partičním klíčem, zápis události s časem mimo existující okno by **tvrdě selhal**, protože výchozí partition nezakládáme. `received_at` je vždy `now()`, tedy monotónní a vždy uvnitř okna.

Tabulka proto nese dva časy a rozdíl mezi nimi je podstatný pro každý dotaz:

| Sloupec | Význam | Role |
|---|---|---|
| `occurred_at` | Kdy se událost stala, po korekci hodin podle 3.7.2 | Řadí se podle něj timeline, indexovaný |
| `received_at` | Kdy dorazila k nám, vždy `now()` | **Partiční klíč**, součást primárního klíče |

```sql
CREATE TABLE web_events (
  id                uuid        NOT NULL,              -- UUIDv7, generuje klient nebo server
  received_at       timestamptz NOT NULL DEFAULT now(),-- partiční klíč, vždy náš čas
  occurred_at       timestamptz NOT NULL,              -- čas UDÁLOSTI, viz výše
  workspace_id      uuid        NOT NULL,
  name              text        NOT NULL,              -- např. 'page_view', 'product_viewed'
  anonymous_id      uuid        NULL,
  contact_id        uuid        NULL,
  session_id        uuid        NULL,
  source            text        NOT NULL DEFAULT 'web',-- web | server | email | import
  page              jsonb       NOT NULL DEFAULT '{}'::jsonb,
  properties        jsonb       NOT NULL DEFAULT '{}'::jsonb,
  context           jsonb       NOT NULL DEFAULT '{}'::jsonb,
  identity_merge_id uuid        NULL,                  -- vyplněno, když contact_id doplnilo slučování
  erased_at         timestamptz NULL,                  -- GDPR výmaz odstřihl vazbu, viz 3.15.3
  PRIMARY KEY (id, received_at),
  CONSTRAINT ck_web_events__source  CHECK (source IN ('web','server','email','import')),
  CONSTRAINT ck_web_events__name    CHECK (name ~ '^[a-z][a-z0-9_]{0,63}$'),
  CONSTRAINT ck_web_events__subject CHECK (
    anonymous_id IS NOT NULL OR contact_id IS NOT NULL OR erased_at IS NOT NULL),
  -- Okno mezi vznikem a doručením. Ohraničuje, o kolik partition zpět musí
  -- timeline sáhnout, když řadí podle occurred_at. Vynucuje 3.7.2.
  CONSTRAINT ck_web_events__lag CHECK (
    occurred_at >  received_at - interval '7 days' AND
    occurred_at <= received_at + interval '60 seconds')
) PARTITION BY RANGE (received_at);
```

`ingested_at` z předchozí verze zaniká, `received_at` je totéž a je to konvenční název.

**Proč je `erased_at` v `CHECK`.** Původní verze constraintu zněla `anonymous_id IS NOT NULL OR contact_id IS NOT NULL` a byla **chyba, která by GDPR výmaz úplně rozbila**. Serverová událost (`source = 'server'`) má vyplněné jen `contact_id`. Výmaz podle 3.15.3 ho nastavuje na `NULL`, takže by u každé takové události skončil chybou `23514` a **výchozí režim výmazu by nikdy neproběhl**. Nález části 1, oprava přijata.

Řešení není constraint zrušit, protože ten hlídá reálnou datovou vadu při zápisu (událost bez subjektu). Řešení je připustit **třetí legitimní stav**: řádek po výmazu, který subjekt nemá schválně a je to na něm vidět. `erased_at` navíc slouží jako filtr, který brání tomu, aby se vymazané události znovu připojily k jinému kontaktu, viz 3.8.4.

Sloupec `erased_at` musí být v sloupcovém grantu (12.5.1), jinak výmaz narazí na oprávnění místo na constraint.

Cizí klíče na `contacts` a `workspaces` **nejsou**, což konvence 2.1 části 1 u partitionovaných tabulek stejně nedovoluje. Referenční integrita se řeší při čtení (LEFT JOIN) a při mazání kontaktu explicitním jobem (viz 3.15.3).

`PRIMARY KEY (id, received_at)` je konvence části 1.

**Deduplikace se tím ale rozbíjí a musí se řešit jinak.** `received_at` je čas přijetí, takže opakované odeslání téže události má jinou hodnotu a `ON CONFLICT (id, received_at)` by duplicitu nezachytil. To je přímý důsledek změny partičního klíče a v předchozí verzi to fungovalo právě proto, že klíč obsahoval čas od klienta.

Řešení: **`received_at` se u vkládané události neodvozuje z `now()`, ale z deduplikačního okna.** Konkrétně se zaokrouhlí dolů na celý den (`date_trunc('day', now())`) a uloží se do samostatného sloupce, který je součástí klíče:

```sql
  received_day date NOT NULL DEFAULT (date_trunc('day', now()))::date,
  ...
  PRIMARY KEY (id, received_day)
) PARTITION BY RANGE (received_day);
```

Tuhle variantu **zamítám**, uvádím ji jen proto, aby bylo vidět, že jsem ji zvážil: denní granularita partition znamená při retenci 26 měsíců 790 partition, což měřitelně zpomaluje plánování dotazů (3.14.2).

**Zvolené řešení: samostatný unikátní index bez partičního klíče nejde, takže deduplikace jde do aplikace.** Vkládá se přes `INSERT ... ON CONFLICT (id, received_at) DO NOTHING`, což zachytí opakování v rámci jednoho zpracování dávky, a navíc se před vložením dávka profiltruje proti `EXISTS` dotazu nad indexem `idx_web_events__dedup` v okně posledních 7 dní. Okno 7 dní odpovídá životnosti offline fronty v SDK (3.6.6), takže pokrývá každý reálný případ opakovaného odeslání.

```sql
-- Dedup: existuje už tahle událost? Okno 7 dní stačí, delší retry SDK nedělá.
CREATE INDEX idx_web_events__dedup ON web_events (workspace_id, id);
```

Zbytkové riziko: událost odeslaná znovu po víc než 7 dnech se uloží dvakrát. SDK to nedělá, protože po 7 dnech frontu zahazuje. Kdyby to udělal cizí klient, projeví se to jako dvě identické položky v timeline, ne jako poškozená data. Přijatelné, zapsané.

**Zbytkové riziko, které tím vzniká:** klíč neobsahuje `workspace_id`, takže klient, který by uhodl `id` cizí události, by mohl svým zápisem způsobit, že se cizí událost zahodí jako duplicita. `id` je UUIDv7 a útočník by musel uhodnout 74 náhodných bitů, takže jde o teoretickou možnost. Zapisuju ji, aby se na ni při případném přechodu na kratší ID nezapomnělo. Alternativa `PRIMARY KEY (id, created_at, workspace_id)` by konvenci neporušila, jen ji rozšířila; nechávám rozhodnutí na části 1.

Indexy podle jmenné konvence `idx_<tabulka>__<sloupce>` z 2.1 části 1 (zakládají se na rodiči, Postgres je propaguje na partition):

```sql
-- 1. Timeline kontaktu. Nejčastější dotaz produktu. Řadí se podle occurred_at,
--    ne podle partičního klíče, protože uživatele zajímá, kdy se to stalo.
CREATE INDEX idx_web_events__contact_occurred
  ON web_events (workspace_id, contact_id, occurred_at DESC)
  WHERE contact_id IS NOT NULL;

-- 2. Anonymní timeline a hlavně vyhledání událostí k doplnění při slučování identit.
CREATE INDEX idx_web_events__anon_occurred
  ON web_events (workspace_id, anonymous_id, occurred_at DESC)
  WHERE anonymous_id IS NOT NULL;

-- 3. Analytika a segmentace typu "kdo udělal X za posledních N dní".
CREATE INDEX idx_web_events__name_occurred ON web_events (workspace_id, name, occurred_at DESC);

-- 4. Vrácení slučování identit. Řídký, malý.
CREATE INDEX idx_web_events__merge ON web_events (identity_merge_id)
  WHERE identity_merge_id IS NOT NULL;

-- 5. Session detail v timeline (rozbalení "co dělal v téhle návštěvě").
CREATE INDEX idx_web_events__session ON web_events (workspace_id, session_id, occurred_at)
  WHERE session_id IS NOT NULL;
```

**Důsledek rozdílu mezi `occurred_at` a `received_at`, který musí znát každý, kdo nad tabulkou píše dotaz.** Partition se prořezávají podle `received_at`, ale timeline řadí podle `occurred_at`. Ty dvě hodnoty se rozcházejí až o 7 dní (constraint `ck_web_events__lag`). Dotaz na časové okno podle `occurred_at` proto **musí rozšířit okno partition o 7 dní dopředu**:

```sql
WHERE occurred_at >= $from AND occurred_at < $to
  AND received_at >= $from AND received_at < $to + interval '7 days'
```

Druhý řádek je jediné, co prořezává partition. Bez něj se prohledají všechny. Je to přesně ta chyba, před kterou konvence 2.1 části 1 varuje u dvousložkových klíčů, jen o úroveň výš. V praxi to řeší pomocná tabulka `web_event_months` (2.3), která rovnou drží seznam měsíců podle `received_at`.

**Granty: `web_events` nemůže být čistě append-only.** Konvence 2.1 části 1 řadí `web_events` mezi append-only tabulky s `REVOKE UPDATE, DELETE` pro aplikační roli. To by znemožnilo doplnění identity (3.8.4), GDPR anonymizaci (3.15.3) i vrácení sloučení (3.8.5). Řešením je **sloupcový grant**, který zachová záměr konvence (obsah události je neměnný) a povolí jen atribuční sloupce:

```sql
REVOKE UPDATE, DELETE ON web_events FROM openengage_app;
GRANT  UPDATE (contact_id, identity_merge_id, erased_at) ON web_events TO openengage_app;
GRANT  DELETE ON web_events TO openengage_maintenance;   -- jen retenční job (odpojení partition)
```

Sloupcové granty jsou v PostgreSQL standardní a pokus o `UPDATE` jiného sloupce skončí chybou oprávnění, tedy hlasitě a v testu. Viz požadavek 12.5.1 a rozpor 13.7.

Index na `properties` (GIN) se v MVP 0 **nezakládá**. Důvod: GIN index nad jsonb u tabulky s desítkami milionů řádků výrazně zpomaluje zápis a zvětšuje tabulku o desítky procent, a v MVP 0 žádný dotaz nad `properties` nefiltruje. Zavede se až se segmentací nad vlastnostmi událostí (MVP 2) a to jako `GIN (properties jsonb_path_ops)` jen na aktivních partition.

Očekávané tvary jsonb sloupců:

Klíče uvnitř `jsonb` jsou `snake_case` stejně jako klíče v API podle konvence 4.1 části 1. TypeScript typy je proto deklarují také v `snake_case`, aby nebylo potřeba mapování mezi tím, co je v databázi, a tím, co jde ven z API.

```ts
type EventPage = {
  url: string;        // očištěná, max 2048 znaků
  path: string;       // max 1024
  title?: string;     // max 512
  referrer?: string;  // očištěná, max 2048
  search?: string;    // očištěné query, max 1024
};
type EventContext = {
  locale?: string;          // 'cs-CZ'
  timezone?: string;        // 'Europe/Prague'
  screen?: { w: number; h: number };
  viewport?: { w: number; h: number };
  device?: 'mobile' | 'tablet' | 'desktop' | 'unknown';
  os?: string;              // hrubě: 'ios' | 'android' | 'macos' | 'windows' | 'linux' | 'other'
  browser?: string;         // hrubě: 'chrome' | 'safari' | 'firefox' | 'edge' | 'other'
  country?: string;         // ISO 3166-1 alpha-2, jen když je zapnutá geolokace
  sdk?: { name: 'oe-web'; version: string };
  campaign?: { source?: string; medium?: string; campaign?: string; content?: string; term?: string };
  clock_skew_ms?: number;   // zjištěný posun hodin klienta, viz 3.7.2
};
```

`context.ip` neexistuje. IP adresa se použije pro rate limiting a pro odvození `country`, do databáze se nikdy nezapisuje.

### 2.3 `web_event_months`

```sql
-- Řídká mapa "v kterých měsících má tento subjekt vůbec nějaká data".
-- Bez ní musí timeline prohledat všechny měsíční partition pozpátku,
-- i když kontakt existuje tři měsíce a partition je jich 26.
CREATE TABLE web_event_months (
  workspace_id uuid NOT NULL,
  subject_kind text NOT NULL,      -- 'contact' | 'anonymous'
  subject_id   uuid NOT NULL,
  month        date NOT NULL,      -- první den měsíce podle received_at, ne occurred_at
  PRIMARY KEY (workspace_id, subject_kind, subject_id, month),
  CONSTRAINT ck_web_event_months__kind CHECK (subject_kind IN ('contact','anonymous'))
);
```

Zapisuje se při zpracování dávky událostí přes `INSERT ... ON CONFLICT DO NOTHING`. Jedna dávka typicky přidá nula řádků, protože už existují. Velikost: počet subjektů krát počet aktivních měsíců, tedy u 100 000 kontaktů a 26 měsíců maximálně 2,6 milionu řádků, reálně řádově méně.

### 2.4 Identity

```sql
-- Aktuální vazba. Právě jeden řádek na (workspace_id, anonymous_id).
CREATE TABLE identities (
  workspace_id  uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  anonymous_id  uuid        NOT NULL,
  contact_id    uuid        NULL REFERENCES contacts(id) ON DELETE SET NULL,
  bound_at      timestamptz NULL,          -- kdy vznikla aktuální vazba
  bind_count    int         NOT NULL DEFAULT 0,  -- kolikrát se vazba změnila
  first_seen    timestamptz NOT NULL DEFAULT now(),
  last_seen     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, anonymous_id)
);

-- Reverzní pohled: která anonymní ID patří kontaktu. Kontakt jich může mít víc
-- (jiný prohlížeč, jiné zařízení). Index, ne tabulka.
CREATE INDEX idx_identities__contact ON identities (workspace_id, contact_id)
  WHERE contact_id IS NOT NULL;

-- Historie vazeb, append only. Umožňuje odpovědět "komu patřila návštěva v 14:07",
-- i když se vazba později změnila (sdílený počítač).
CREATE TABLE identity_bindings (
  id           uuid        PRIMARY KEY,
  workspace_id uuid        NOT NULL,
  anonymous_id uuid        NOT NULL,
  contact_id   uuid        NULL,           -- NULL = odvázání (reset)
  valid_from   timestamptz NOT NULL,
  source       text        NOT NULL,       -- 'email_click' | 'sdk_identify' | 'server_api' | 'form' | 'reset'
  evidence     jsonb       NOT NULL DEFAULT '{}'::jsonb, -- message_id, campaign_id, ip_hash apod.
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_identity_bindings__lookup
  ON identity_bindings (workspace_id, anonymous_id, valid_from DESC);
```

```sql
-- Záznam o doplnění historie ke kontaktu. Bez něj nejde slučování vrátit.
CREATE TABLE identity_merges (
  id            uuid        PRIMARY KEY,
  workspace_id  uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  anonymous_id  uuid        NOT NULL,
  contact_id    uuid        NOT NULL,
  binding_id    uuid        NOT NULL REFERENCES identity_bindings(id),
  window_from   timestamptz NOT NULL,      -- od kdy se historie doplňovala
  window_to     timestamptz NOT NULL,
  events_total  int         NOT NULL DEFAULT 0,
  status        text        NOT NULL DEFAULT 'pending',
  -- pending | running | completed | truncated | reverted | failed
  reverted_at   timestamptz NULL,
  reverted_by   uuid        NULL,          -- users(id)
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_identity_merges__status CHECK (
    status IN ('pending','running','completed','truncated','reverted','failed'))
);
CREATE INDEX idx_identity_merges__contact ON identity_merges (workspace_id, contact_id, created_at DESC);
```

```sql
-- Jednorázovost identifikačního tokenu. Token je bezstavově podepsaný,
-- jednorázovost vynucuje unikátní klíč nonce. Řádky se mažou po expiraci.
CREATE TABLE identity_token_uses (
  nonce      bytea       PRIMARY KEY,      -- přesně 8 bajtů
  used_at    timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE INDEX idx_identity_token_uses__expiry ON identity_token_uses (expires_at);
```

### 2.5 `tracking_domains`

```sql
-- Domény, na kterých smí běžet SDK a na které se smí přidat oe_token.
-- Bez zápisu v této tabulce SDK odmítne startovat a redirect token nepřidá.
CREATE TABLE tracking_domains (
  id           uuid        PRIMARY KEY,
  workspace_id uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  host         text        NOT NULL,       -- lowercase, bez schématu a portu, např. 'shop.example.cz'
  include_subdomains boolean NOT NULL DEFAULT false,
  verified_at  timestamptz NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_tracking_domains__host CHECK (host ~ '^[a-z0-9.-]{1,253}$')
);
CREATE UNIQUE INDEX uq_tracking_domains__workspace_host ON tracking_domains (workspace_id, host);
-- Redirect potřebuje odpovědět "je tenhle host povolený" bez znalosti workspace_id
-- dřív, než sáhne do DB. Proto se celá tabulka drží v paměti (viz 3.4.4).
```

Ověření domény (`verified_at`) není v MVP 0 podmínkou funkčnosti, jen se zobrazuje jako varování. Ověřuje se tak, že SDK při prvním úspěšném běhu na dané doméně pošle `Origin`, který se s hostem shoduje.

### 2.6 `message_engagement`

Derivovaný stav jedné zprávy. Existuje proto, aby se unikátní otevření a prokliky daly počítat bez agregace přes miliony řádků `message_events`.

Partitionuje se podle `created_at`, které je **kopií `messages.created_at`** téže zprávy. Díky tomu leží řádek engagementu ve stejném měsíčním okně jako zpráva, retence obou tabulek se odpojuje společně a dotaz, který zná zprávu, zná i partition.

```sql
CREATE TABLE message_engagement (
  message_id     uuid        NOT NULL,     -- = messages.id
  created_at     timestamptz NOT NULL,     -- = messages.created_at, partiční klíč
  workspace_id   uuid        NOT NULL,
  campaign_id    uuid        NOT NULL,
  contact_id     uuid        NOT NULL,

  first_open_at      timestamptz NULL,
  last_open_at       timestamptz NULL,
  open_count         int         NOT NULL DEFAULT 0,
  first_human_open_at timestamptz NULL,    -- první otevření klasifikované jako 'human'
  human_open_count   int         NOT NULL DEFAULT 0,
  open_class_mask    int         NOT NULL DEFAULT 0,  -- bitová maska viděných tříd, viz 3.3.5

  first_click_at     timestamptz NULL,
  last_click_at      timestamptz NULL,
  click_count        int         NOT NULL DEFAULT 0,
  first_human_click_at timestamptz NULL,
  human_click_count  int         NOT NULL DEFAULT 0,
  clicked_links      int         NOT NULL DEFAULT 0,  -- počet různých link_id

  PRIMARY KEY (message_id, created_at)
) PARTITION BY RANGE (created_at);

CREATE INDEX idx_message_engagement__campaign
  ON message_engagement (workspace_id, campaign_id)
  INCLUDE (first_open_at, first_click_at);
-- Důvod: rekonstrukce campaign_stats po havárii a exporty "kdo otevřel".

CREATE INDEX idx_message_engagement__contact
  ON message_engagement (workspace_id, contact_id, first_open_at DESC)
  WHERE first_open_at IS NOT NULL;
-- Důvod: segmenty "otevřel libovolnou kampaň za posledních N dní" (část 2).
```

`open_class_mask` bity: 1 = human, 2 = proxy_apple, 4 = proxy_image, 8 = bot, 16 = unknown.

### 2.7 `contact_engagement` (rollup na kontakt)

Tuhle tabulku jsem původně neměl a byla to **díra, která znefunkčňuje celou segmentaci podle engagementu a všech šest presetů čištění databáze** (požadavek 5.3 z části 2). Odkazoval jsem segmentaci na `message_engagement`, což je špatně ze dvou důvodů: je to jeden řádek na **zprávu**, ne na kontakt, a její kontaktový index je částečný (`WHERE first_open_at IS NOT NULL`), takže z definice neumí odpovědět na dotaz „neotevřel". A právě „neotevřel" je preset `never_opened` i `no_open_last_n`.

Přebírám návrh z části 2, sekce 11.4, s pěti úpravami, které jsou vysvětlené pod DDL.

```sql
CREATE TABLE contact_engagement (
  contact_id            uuid        NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  workspace_id          uuid        NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,

  last_sent_at          timestamptz,
  last_delivered_at     timestamptz,
  last_open_at          timestamptz,
  last_click_at         timestamptz,
  last_bounce_at        timestamptz,

  sent_total            int NOT NULL DEFAULT 0,
  delivered_total       int NOT NULL DEFAULT 0,
  opens_total           int NOT NULL DEFAULT 0,
  clicks_total          int NOT NULL DEFAULT 0,
  bounces_total         int NOT NULL DEFAULT 0,

  sent_7d               int NOT NULL DEFAULT 0,
  sent_30d              int NOT NULL DEFAULT 0,
  sent_90d              int NOT NULL DEFAULT 0,
  opens_7d              int NOT NULL DEFAULT 0,
  opens_30d             int NOT NULL DEFAULT 0,
  opens_90d             int NOT NULL DEFAULT 0,
  clicks_7d             int NOT NULL DEFAULT 0,
  clicks_30d            int NOT NULL DEFAULT 0,
  clicks_90d            int NOT NULL DEFAULT 0,

  consecutive_no_open   int NOT NULL DEFAULT 0,   -- pro "neotevřel posledních N kampaní"
  consecutive_no_click  int NOT NULL DEFAULT 0,

  windows_recomputed_at timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (workspace_id, contact_id)
);

-- Preset "neaktivní 90+ dní" a "nikdy neotevřel". NULLS FIRST je podstatné:
-- kontakt, který nikdy neotevřel, má NULL a musí v tomhle dotazu vyjít.
CREATE INDEX idx_contact_engagement__ws_last_open
  ON contact_engagement (workspace_id, last_open_at NULLS FIRST);

-- Preset "neotevřel posledních N kampaní".
CREATE INDEX idx_contact_engagement__ws_no_open
  ON contact_engagement (workspace_id, consecutive_no_open DESC);

-- Preset "nikdy neklikl" a reaktivační kampaň.
CREATE INDEX idx_contact_engagement__ws_last_click
  ON contact_engagement (workspace_id, last_click_at NULLS FIRST);

-- Fronta pro přepočet klouzavých oken, viz 3.9.4. Bez něj by se muselo
-- projít všech 5 milionů kontaktů denně.
CREATE INDEX idx_contact_engagement__stale_windows
  ON contact_engagement (windows_recomputed_at)
  WHERE sent_90d > 0 OR opens_90d > 0 OR clicks_90d > 0;
```

Pět úprav oproti návrhu části 2:

1. **Primární klíč je `(workspace_id, contact_id)`, ne jen `contact_id`.** Konvence 2.1 části 1 vyžaduje `workspace_id` v každé tabulce a izolace se vynucuje i v RLS. Se samotným `contact_id` jako klíčem by každý dotaz musel `workspace_id` dohledávat joinem.
2. **`delivered_total` a `last_delivered_at` doplněny.** Bez nich nejde spočítat míra otevření na úrovni kontaktu a preset „doručili jsme mu 20 mailů a ani jeden neotevřel" by musel dělit odeslanými, což u kontaktu s odrazy dá špatné číslo.
3. **`consecutive_no_click`** doplněn kvůli presetu „nikdy neklikl" v kombinaci s „ale otevírá", což je nejcennější segment pro reaktivaci.
4. **`windows_recomputed_at`** doplněn. Návrh části 2 s tím nepočítá, ale klouzavá okna 7, 30 a 90 dní **se nedají udržovat jen přičítáním**. Podrobně v 3.9.4, je to nejdůležitější změna z celé pětice.
5. **`NULLS FIRST` v indexech nad `last_open_at` a `last_click_at`.** Kontakt, který nikdy neotevřel, má `NULL`. Bez explicitního pořadí by dotaz `WHERE last_open_at IS NULL OR last_open_at < now() - interval '90 days'` index nevyužil pro obě větve.

Řádek se zakládá **líně**: při první události kontaktu, ne při vytvoření kontaktu. Kontakt, kterému se nikdy nic neposlalo, řádek nemá a segmentační dotazy části 2 s tím musí počítat (`LEFT JOIN` a `COALESCE`, ne `INNER JOIN`). Je to požadavek 12.4.5.

Velikost: jeden řádek na kontakt, který někdy dostal e-mail. Při 5 milionech kontaktů zhruba 700 MB včetně čtyř indexů.

### 2.8 Agregace kampaně

```sql
-- Jeden řádek na kampaň. Aktualizuje se dávkově, nikdy per event.
CREATE TABLE campaign_stats (
  workspace_id uuid NOT NULL,
  campaign_id  uuid PRIMARY KEY,

  materialized   bigint NOT NULL DEFAULT 0,  -- kolik zpráv vzniklo v outboxu
  sent           bigint NOT NULL DEFAULT 0,
  failed         bigint NOT NULL DEFAULT 0,
  skipped        bigint NOT NULL DEFAULT 0,
  delivered      bigint NOT NULL DEFAULT 0,
  bounced_hard   bigint NOT NULL DEFAULT 0,
  bounced_soft   bigint NOT NULL DEFAULT 0,
  complained     bigint NOT NULL DEFAULT 0,
  unsubscribed   bigint NOT NULL DEFAULT 0,

  opens_total          bigint NOT NULL DEFAULT 0,
  opens_unique         bigint NOT NULL DEFAULT 0,
  opens_unique_human   bigint NOT NULL DEFAULT 0,
  opens_unique_apple   bigint NOT NULL DEFAULT 0,  -- zpráva, kde jediné otevření je Apple proxy
  clicks_total         bigint NOT NULL DEFAULT 0,
  clicks_unique        bigint NOT NULL DEFAULT 0,
  clicks_unique_human  bigint NOT NULL DEFAULT 0,
  clicks_scanner       bigint NOT NULL DEFAULT 0,

  first_event_at timestamptz NULL,
  last_event_at  timestamptz NULL,
  updated_at     timestamptz NOT NULL DEFAULT now(),
  version        bigint NOT NULL DEFAULT 0   -- inkrementuje se při každé změně, používá SSE
);
CREATE INDEX idx_campaign_stats__workspace ON campaign_stats (workspace_id, updated_at DESC);
```

```sql
-- Průběh v čase pro graf v reportu a pro živé sledování odesílání.
CREATE TABLE campaign_stats_buckets (
  campaign_id  uuid        NOT NULL,
  workspace_id uuid        NOT NULL,
  bucket_at    timestamptz NOT NULL,   -- zaokrouhleno dolů na 5 minut
  sent         int NOT NULL DEFAULT 0,
  delivered    int NOT NULL DEFAULT 0,
  opens_unique int NOT NULL DEFAULT 0,
  clicks_unique int NOT NULL DEFAULT 0,
  bounced      int NOT NULL DEFAULT 0,
  PRIMARY KEY (campaign_id, bucket_at)
);
-- Retence: 5minutové bloky se po 30 dnech slévají do hodinových (job stats.compact).
```

```sql
CREATE TABLE campaign_link_stats (
  campaign_id   uuid   NOT NULL,
  workspace_id  uuid   NOT NULL,
  link_id       int    NOT NULL,
  clicks_total  bigint NOT NULL DEFAULT 0,
  clicks_unique bigint NOT NULL DEFAULT 0,
  clicks_human  bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (campaign_id, link_id)
);
```

### 2.9 `proxy_ranges`

```sql
-- Cache stažených IP rozsahů obrazových proxy. Zdroj a čas se drží kvůli auditu.
CREATE TABLE proxy_ranges (
  id          uuid   PRIMARY KEY DEFAULT uuidv7(),
  provider    text   NOT NULL,       -- 'apple_private_relay' | 'google' | 'manual'
  cidr        cidr   NOT NULL,
  fetched_at  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ck_proxy_ranges__provider
    CHECK (provider IN ('apple_private_relay','google','manual'))
);
CREATE INDEX idx_proxy_ranges__provider ON proxy_ranges (provider);
CREATE INDEX idx_proxy_ranges__cidr ON proxy_ranges USING gist (cidr inet_ops);
```

V MVP 0 se tabulka plní jen ručně vloženými rozsahy a pevným `17.0.0.0/8`. Stažení Apple seznamu je vypnuté ve výchozím stavu, viz 3.3.3.

---

## 3. Doménová logika

### 3.1 Trackovací tokeny: co přebírám a co vlastním

#### 3.1.1 Vlastnictví po sladění s částí 1

**Bajtový formát tokenů vlastní část 1**, sekce 4.10.3, a je **zmrazený**. Nekopíruju ho sem, protože dva popisy téhož jsou horší než jeden odkaz. Tato část vlastní **sémantiku**: který typ tokenu smí projít na kterém endpointu, co se s ním stane, jak dlouho platí identifikační token a jak se vynucuje jeho jednorázovost.

Původní návrh v této části měl vlastní layout (`t1.<payload>.<tag>`, `kind` jako číslo, `link_id` jako `uint32`, `campaign_id` v tokenu). Byl nahrazen. Rozdíly jsou vypsané v 1.4, výhrady, které si po sladění ponechávám, v 13.8 a 13.9.

#### 3.1.2 Shrnutí formátu pro čtenáře této části

Jen tolik, aby se dal číst zbytek dokumentu. Normativní znění je v části 1, 4.10.3.

```
token     = "t1" || base64url_nopad( type(1) || key_id(1) || payload || mac(16) )
mac       = HMAC-SHA256( K_tracking, "openengage/token/v1" || type || key_id || payload )[0..16]
K_tracking= HKDF(SHA-256, ikm = base64url_decode(SECRET_KEY), salt = "openengage/v1",
                 info = "openengage/v1/tracking-token", L = 32)
```

| Typ | Znak | Payload | Délka tokenu | Vyrábí | Ověřuje |
|---|---|---|---|---|---|
| open | `o` | `workspace_id`(16) `message_id`(16) `message_created_at`(u32) | 74 | sender | část 5 |
| click | `c` | `workspace_id`(16) `message_id`(16) `link_id`(16) `message_created_at`(u32) | 96 | sender | část 5 |
| identity | `i` | `workspace_id`(16) `contact_id`(16) `campaign_id`(16) `nonce`(8) `expires_at`(u32) | 106 | část 5 | část 5 |
| unsubscribe | `u` | `workspace_id`(16) `message_id`(16) `contact_id`(16) `list_id`(16) `message_created_at`(u32) | 117 | sender | **část 2** |

`link_id` je UUID (`campaign_links.id`), ne pořadové číslo. Zkrácení na `position` je v kontraktu výslovně zamítnuté a souhlasím s odůvodněním: `position` se překompilováním šablony přečísluje a zneplatnila by se tím tiše všechna už odeslaná tokeny.

#### 3.1.2.1 Vlastnictví tokenu typu `u` (unsubscribe)

Původně jsem ho odsunul na „vlastní mechanismus jinde" bez jmenovaného vlastníka. To byla mezera: kontrakt ho definuje jako součást formátu, ale žádná část se k němu nehlásila.

**Vlastní ho tato část, stejně jako ostatní tři typy.** Konkrétně:

| Odpovědnost | Kdo |
|---|---|
| Bajtový formát | část 1, 4.10.3 |
| Ověřovací funkce `verifyTrackingToken(token, allowedTypes)` včetně typu `u` | **část 5** |
| Vyrobení tokenu při odesílání | část 4b (sender), stejně jako `o` a `c` |
| Endpoint `/u/**`, stránka preferencí, stavový diagram odhlášení, zápis do `list_subscriptions` | **část 2** |
| Zápis události `unsubscribe` do `message_events` a promítnutí do `campaign_stats.unsubscribed` | část 2 zapíše, část 5 agreguje |

Dělicí čára: **já vlastním ověření tokenu, část 2 vlastní to, co se po ověření stane.** Důvod je, že ověřovací kód je jeden a společný pro všechny čtyři typy, a rozdělit ho podle typu by znamenalo dvě implementace téhož s rizikem, že jedna zapomene na kontrolu typu proti endpointu. Část 2 zavolá `verifyTrackingToken(token, ['u'])` a dostane rozparsovaná pole nebo chybu z katalogu 4.4.

`list_id` samých nul znamená globální odhlášení, ne odhlášení ze seznamu. Tohle pravidlo je z kontraktu a musí ho respektovat obě strany.

Viz požadavek 12.3.7.

#### 3.1.2.2 Změna `issued_at` na `message_created_at` je provedená

Kontrakt je zmrazený s polem `message_created_at` (uint32, celé sekundy) na pozici, kde bylo `issued_at`. **Délka tokenu se nezměnila ani o znak.** Vektory jsem přepočítal, viz 3.1.3.

Co to znamená pro tuhle část, shrnuto na jednom místě:

| | Před | Po |
|---|---|---|
| Dohledání zprávy z tokenu | Heuristika: čas vyříznutý z UUIDv7, okno ±1 hodina, nejvýš dvě partition | `WHERE id = $1 AND created_at = to_timestamp($2)`, přímý zásah do PK jedné partition |
| Funkce `uuidv7_timestamp` | Nutná pro každé otevření a klik | **Nepotřebná**, požadavek na část 1 stažen |
| Invariant o čase v `messages.id` | Nutný, křehký (12.2.10) | **Nepotřebný**, nahrazen invariantem I1 z 4.10.1, který je silnější a vlastní ho část 4a |
| `issued_at` v `message_events` | Ukládal jsem ho | Zaniká, stáří kliku se posuzuje z `messages.sent_at`, což je přesnější |

Ztráta je nulová: pravidlo 5 klasifikace skenerů (3.5) porovnává s `messages.sent_at`, ne s tokenem, a v timeline se stáří kliku bere odtamtud také.

**Jediná nová chybová cesta, kterou to zavádí.** Rovnostní dohledání selže, když se `messages.created_at` neshoduje s hodnotou v tokenu na sekundu přesně. To může nastat jen porušením invariantu I1, tedy chybou v materializaci. Chování je proto definované takhle a nikdy se nesmí zvrhnout v prohledání všech partition:

```
1. WHERE id = $1 AND created_at = to_timestamp($2)          -- přesně
2. nenalezeno -> WHERE id = $1
                   AND created_at >= to_timestamp($2) - interval '1 second'
                   AND created_at <  to_timestamp($2) + interval '2 seconds'
   (pokrývá zaokrouhlení na hranici sekundy, pořád nejvýš dvě partition)
3. nenalezeno -> událost se uloží bez atribuce na kampaň,
                 čítač tracking_message_lookup_miss_total, log warn
4. NIKDY se nedělá dotaz bez podmínky na created_at
```

Krok 3 znamená, že se událost neztratí, jen se nezapočítá do reportu kampaně. Růst toho čítače je alert, protože znamená porušený invariant I1 a je to jediné místo, kde se to projeví.

#### 3.1.3 Kontrola vektorů z části 1 (výsledek)

Vektory ze **zmrazené** verze kontraktu (4.10.3, s polem `message_created_at`) jsem přepočítal nezávislou implementací: ruční HKDF podle RFC 5869 a HMAC v Pythonu, žádný kód části 1 ani sdílená knihovna. Postup: `MASTER = base64url_decode("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8")`, odvození `K_tracking`, sestavení payloadu, HMAC nad `"openengage/token/v1" ‖ type ‖ key_id ‖ payload`, zkrácení na 16 bajtů, base64url bez paddingu celého `type ‖ key_id ‖ payload ‖ mac`.

| Kontrola | Výsledek |
|---|---|
| `K_tracking-token` = `4a60b2...5bf6ca` | **sedí** |
| open token, celý řetězec a plný HMAC | **sedí**, payload 36 B, délka 74 |
| click token | **sedí**, payload 52 B, délka 96 |
| identity token | **sedí**, payload 60 B, délka 106 |
| unsubscribe token | **sedí**, payload 68 B, délka 117 |
| unsubscribe s nulovým `list_id` | **sedí**, délka 117 |
| `message_created_at = 1784995200` odpovídá `2026-07-25T16:00:00Z` | **sedí**, celá sekunda, nulová sub-sekundová složka |

Kontrakt je jednoznačný a implementovatelný nezávisle. **Identity token se oproti předchozí verzi nezměnil**, protože `message_created_at` nenese; ostatní tři ano a starý open token by na prvním vektoru spadl.

**Moje výhrada k přesnosti `uint32` je vyřešená, a lépe, než jsem navrhoval.** Namítal jsem, že `uint32` v sekundách nemůže reprodukovat `timestamptz` s mikrosekundovou přesností, takže dohledání zprávy nesmí být rovnost, ale rozsah. Část 1 to vyřešila u zdroje: invariant I1 v 4.10.1 ukládá `campaigns.audience_built_at` přes `date_trunc('second', now())` a materializace ho nastavuje explicitně všem řádkům kampaně. `created_at` tedy **nemá sub-sekundovou složku vůbec** a `uint32` je přesná hodnota, ne aproximace. Rovnost je správně a je rychlejší než rozsah.

Zbývají čtyři mezery ve vektorech, které jsem hlásil dřív a které trvají. Nejsou blokující, ale jsou levné a zavírají reálné riziko rozchodu implementací (požadavky 12.5.5 a 12.5.6):

1. **Chybí `payload_hex` u každého vektoru.** Pořadí bajtů UUID je popsané slovně. Kdo ho udělá obráceně, dostane konzistentně jiný, ale sám o sobě platný token, a existující vektory to neodhalí, protože porovnávají až výsledný řetězec. Část 4b to nezávisle označila za nejcennější doplněk a souhlasím.
2. **Chybí případ implicitního versus explicitního `key_id = 1`** (`SECRET_KEY` bez prefixu proti `1:<klíč>`).
3. **Chybí negativní vektor pro `key_id = 0`.** Rozsah je 1 až 255, takže 0 je neplatná hodnota, ne „neuvedeno".
4. **Chybí hraniční hodnoty**: `message_created_at = 4294967295` (přetečení v roce 2106) a UUID samých `ff`.

#### 3.1.4 Ověření: co dělá tato část

Normativní pořadí kroků je v části 1, 4.10.3. Tato část k němu přidává **vazbu typu na endpoint**, protože ta je součástí kroku 4 a je to bezpečnostní kontrola:

| Endpoint | Povolený `type` | Co při jiném typu |
|---|---|---|
| `GET /t/o/{token}` | pouze `o` | `token_type_mismatch`, vrátí se GIF, nic se nezapíše |
| `GET /t/c/{token}` | pouze `c` | `token_type_mismatch`, 302 na `/t/expired` |
| `POST /e/identify` | pouze `i` | `token_type_mismatch`, 400 |
| `/u/**` (část 2) | pouze `u` | vlastní část 2 |

Bez této kontroly by šel token pro otevření podstrčit jako token pro odhlášení a jedno zobrazení obrázku by odhlásilo příjemce z odběru. Test na to je povinný, viz akceptační kritérium 3.

Chybové kódy jsou z části 1: `token_malformed`, `token_signature_invalid`, `token_type_mismatch`, `token_unknown_key`, `token_expired`, `token_already_used`. Vlastní kódy pro tokeny nezavádím.

#### 3.1.5 Platnost a rotace

Přebírám z části 1, 3.10 a 4.10.3:

| Typ | Platnost | Co po rotaci `SECRET_KEY` |
|---|---|---|
| open, click | **neomezená** | Ověřují se starým klíčem podle `key_id`. `SECRET_KEY_PREVIOUS` se u trackovacích klíčů nesmí odebrat nikdy, dokud nám záleží na starých kampaních |
| identity | 15 minut, jednorázově | Stačí počkat 15 minut a starý klíč jde odebrat |

`message_created_at` se **nikdy nekontroluje proti expiraci**, je to lokátor partition, ne časové omezení platnosti. Stáří kliku i klasifikace skenerů (3.5, pravidlo 5) se posuzují z `messages.sent_at` na dohledaném řádku, což je přesnější zdroj než cokoliv v tokenu.

Když je `key_id` neznámý (`token_unknown_key`), uživatel to nesmí poznat jako rozbitý odkaz: pixel vrátí normální GIF, klik jde na `/t/expired` s neutrálním textem. Metrika `tracking_token_invalid_total{code="token_unknown_key"}` je alertovaná, protože její růst znamená špatně provedenou rotaci.

#### 3.1.6 Jednorázovost identifikačního tokenu (požadavek P5-2 z části 1)

Formát dává `nonce` (8 bajtů z CSPRNG), úložiště je moje. Tabulka `identity_token_uses` v 2.4, úklidový job v 3.10.3.

Vynucení je **unikátní primární klíč nad `nonce`**, ne kontrola „existuje, tak odmítni". Rozdíl je v souběhu: dva požadavky s týmž tokenem ve stejný okamžik projdou kontrolou oba, ale `INSERT` uspěje právě jednomu. Druhý dostane `token_already_used`.

Kolize `nonce` mezi dvěma různými tokeny: 8 bajtů je 2^64 hodnot, při 100 000 vydaných tokenech za 15 minut je pravděpodobnost kolize v okně řádu 10^-10. Kolize se projeví jako `token_already_used` u legitimního uživatele, tedy jako tichý přechod na anonymní sledování. Přijatelné.

#### 3.1.7 Dohledání zprávy z tokenu

Token nese `message_id` i `message_created_at`, tedy **obě složky primárního klíče** `messages (id, created_at)`. Dohledání je proto přímý zásah do jedné partition:

```sql
SELECT id, created_at, campaign_id, contact_id, workspace_id, sent_at
  FROM messages
 WHERE id = $1 AND created_at = to_timestamp($2);
```

Stojí to na invariantu I1 z 4.10.1 části 1: všechny řádky jedné kampaně mají `created_at` rovné `campaigns.audience_built_at`, které se ukládá přes `date_trunc('second', now())`. Sub-sekundová složka je tedy vždy nulová a `uint32` v tokenu je přesná hodnota. Chování při neshodě je v 3.1.2.2.

**Konvence dvousložkového odkazu.** Podle 2.1 části 1 nese každý odkaz na řádek partitionované tabulky obě složky a druhá se jmenuje `<entita>_<partitioning_sloupec>`. V této části to znamená:

| Odkaz na | Sloupce |
|---|---|
| `messages` | `message_id` + `message_created_at` |
| `web_events` | `web_event_id` + `web_event_received_at` |
| `message_events` | `message_event_id` + `message_event_received_at` |

Platí to i pro payloady odchozích webhooků (4.3) a pro GDPR export, ne jen pro sloupce v databázi. Příjemce webhooku, který dostane jen `message_id`, by musel prohledat všechny partition úplně stejně jako my.

Kde se dohledání zprávy skutečně děje:

| Místo | Kdy | Poznámka |
|---|---|---|
| Zpracování dávky otevření (3.9.2) | vždy | Asynchronně, ne v horké cestě |
| Zpracování dávky kliků (3.9.2) | vždy | Doplní `contact_id` a klasifikaci skenerů |
| Click redirect (3.4.6, krok 7) | jen u odkazů na registrovanou doménu | Kvůli `contact_id` do identity tokenu |
| Identity token | nikdy | Nese `contact_id` přímo, zprávu nepotřebuje |

#### 3.1.8 Adresy trackovacích endpointů

Povrch `/t/**` a `/e/**` podle konvence 4.1 části 1: bez autentizace session, bez CSRF, ověření podepsaným tokenem nebo veřejným klíčem, mimo `/api/v1/**`.

```
GET  {TRACKING_DOMAIN}/t/o/{token}      open pixel
GET  {TRACKING_DOMAIN}/t/c/{token}      click redirect
GET  {TRACKING_DOMAIN}/t/expired        informační stránka pro neplatné tokeny
POST {TRACKING_DOMAIN}/e/track          ingestion událostí
POST {TRACKING_DOMAIN}/e/identify       konzumace oe_token
GET  {TRACKING_DOMAIN}/e/oe.js          web SDK
```

`TRACKING_DOMAIN` je konfigurační proměnná z tabulky 4.9 části 1, ve výchozím stavu odvozená z `APP_URL`. Nastavuje se na vlastní subdoménu zákazníka (`https://events.shop.cz`), aby SDK i pixely přežily blokátory. Sender ji musí znát, aby tvořil správné odkazy (je v jeho sloupci „Kdo" v tabulce 4.9).

Cesty jsou bez verze v segmentu. Verzi nese samotný token (`t1`) a u ingestion pole `v` v payloadu. Je to odchylka od `/api/v1/**`, ale záměrná: adresa `/t/o/...` je zapečená v odeslaných e-mailech napořád a nesmí se nikdy měnit.

### 3.2 Open pixel

#### 3.2.1 Vložení do zprávy

Sender vloží těsně před `</body>` (a když `</body>` chybí, na konec HTML těla):

```html
<img src="https://events.example.cz/t/o/t1bwEBkvOgHC1-QJobLD1OX2BxAZLzoBwtfkGLLD1OX2Bxgmpk3YCVNgR__t5nFa1z5_Wn6r8V" width="1" height="1" border="0"
     alt="" style="display:block;width:1px;height:1px;border:0;outline:none;text-decoration:none">
```

Do plain textové varianty se pixel nevkládá nikdy. Když je `campaigns.track_opens = false`, pixel se nevloží vůbec a token typu 1 se pro danou kampaň negeneruje.

#### 3.2.2 Odpověď

| Vlastnost | Hodnota |
|---|---|
| HTTP status | vždy `200`, i pro neplatný token |
| `Content-Type` | `image/gif` |
| `Content-Length` | `42` |
| `Cache-Control` | `no-store, no-cache, must-revalidate, max-age=0, private` |
| `Pragma` | `no-cache` |
| `Expires` | `0` |
| `Referrer-Policy` | `no-referrer` |
| `X-Content-Type-Options` | `nosniff` |
| Tělo | 42 bajtů, průhledný GIF 1x1 |

Tělo, hex (konstanta v kódu, ne generované za běhu):

```
47494638396101000100800000000000ffffff21f90401000000002c000000000100010000020144003b
```

Totéž v base64: `R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7`

Proč vždy 200 a vždy stejné tělo: odlišná odpověď pro neplatný token by z endpointu udělala orákulum, ze kterého jde uhádnout platnost tokenu, a v některých poštovních klientech by se místo neviditelného pixelu ukázal křížek rozbitého obrázku.

Proč `no-store`: aby Gmail proxy a poštovní klienty nekešovaly a případné opakované otevření se dalo zaznamenat. Proxy si stejně obrázek uloží, ale explicitní hlavičky jsou to jediné, co s tím můžeme udělat.

#### 3.2.3 Zpracování požadavku

```
1. verify(token, allowedTypes=['o'], now)          // viz část 1, 4.10.3
   - neplatný -> čítač tracking_token_invalid_total{code}, vrátit GIF, konec
2. classify_open(headers, ip)  (viz 3.3), výsledek open_class
3. pokud open_class = 'bot' a bot je na seznamu crawlerů -> vrátit GIF, konec (nezapisuje se)
4. vložit do bufferu zapisovače:
      { workspace_id, message_id, message_created_at, occurred_at = now,
        open_class, client_hint, country? }
5. vrátit GIF
```

Token typu `o` nese `workspace_id` a `message_id`, ale **ne `campaign_id`**. Kampaň se dohledává až v asynchronním zpracování dávky (3.9.2) dotazem na `messages` s časovým oknem odvozeným z UUIDv7 podle 3.1.7. V horké cestě se do databáze nesahá vůbec.

Zápis do databáze je **asynchronní**, viz 3.9.1. Odpověď neblokuje na databázi.

Limity a ochrana:

| Limit | Hodnota | Chování při překročení |
|---|---|---|
| Otevření jedné zprávy za den | 100 | Další se zahodí, čítač `tracking.open.capped` |
| Požadavků na `/t/o/` z jedné IP | 300/min | HTTP 200 s GIFem, ale bez zápisu |
| Délka URL | 512 znaků | 404 |
| Timeout zpracování | 50 ms | Vrátí GIF, událost se zahodí |

#### 3.2.4 Souhlas a otevření

Otevření e-mailu **není** vázané na souhlas s webovým trackingem. Vychází to z toho, že příjemce je identifikovaný kontakt, který dal souhlas s e-mailovým marketingem, a měření doručení a otevření je součástí té služby. Formálně jde podle EDPB Guidelines 2/2023 k čl. 5(3) ePrivacy směrnice o čtení informací z koncového zařízení, takže **právní posouzení pro cílové trhy je nutné** (viz kapitola 14). Technicky nabízíme dvě páky:

1. `campaigns.track_opens` per kampaň.
2. Workspace nastavení `tracking.default_track_opens`, které řídí výchozí hodnotu.

Pro trhy, kde by se ukázalo, že je nutný souhlas i pro pixel, je potřeba per kontakt: to řeší část 2 přes souhlas `analytics`, my jen musíme umět materializaci obejít. Viz požadavek 12.3.

### 3.3 Klasifikace otevření

#### 3.3.1 Třídy

```ts
type OpenClass =
  | 'human'        // pravděpodobně skutečné otevření člověkem
  | 'proxy_apple'  // Apple Mail Privacy Protection, prakticky jistě předstírané
  | 'proxy_image'  // Gmail a jiné obrazové proxy, obvykle skutečné, ale nespolehlivý čas
  | 'bot'          // známý crawler, bezpečnostní skener, prefetch
  | 'unknown';     // nestačí signály
```

#### 3.3.2 Pravidla, vyhodnocují se v tomto pořadí, první shoda vyhrává

| # | Podmínka | Výsledek |
|---|---|---|
| 1 | `User-Agent` odpovídá seznamu crawlerů (`crawler-user-agents`) | `bot` |
| 2 | Hlavička `Purpose: prefetch`, `X-Purpose: preview`, `X-Moz: prefetch` nebo `Sec-Purpose` obsahuje `prefetch` | `bot` |
| 3 | Metoda je `HEAD` | `bot` |
| 4 | `User-Agent` je **přesně** `Mozilla/5.0` (bez dalších tokenů, po ořezu bílých znaků) | `proxy_apple` |
| 5 | IP je v `17.0.0.0/8` | `proxy_apple` |
| 6 | IP je v seznamu Apple egress rozsahů **a** je zapnuté `tracking.use_apple_relay_ranges` | `proxy_apple` |
| 7 | `User-Agent` obsahuje `GoogleImageProxy` nebo `via ggpht.com` | `proxy_image` |
| 8 | `User-Agent` obsahuje `YahooMailProxy` nebo `Barracuda` nebo `ProofPoint` | `bot` |
| 9 | `User-Agent` odpovídá známému poštovnímu klientu (Outlook, Thunderbird, Apple Mail s plným UA, mobilní klienti) | `human` |
| 10 | `User-Agent` odpovídá běžnému prohlížeči (webmail s otevřenými obrázky) | `human` |
| 11 | jinak | `unknown` |

Pravidlo 4 je klíčové a stojí na empirickém zjištění, které dokumentují Postmark, SocketLabs i Litmus: Apple proxy posílá doslova `Mozilla/5.0` bez dalších tokenů, což žádný skutečný klient nedělá. **Apple to může kdykoliv změnit bez ohlášení.** Proto:

- Pravidlo je v konfiguraci jako datová tabulka, ne zadrátované v kódu.
- Metrika `tracking.open.class_share` se vystavuje na `/api/v1/admin/metrics`, aby šel poznat skokový posun.
- Do dokumentace se píše, že jde o heuristiku, ne o jistotu.

Pravidlo 9 a 10: seznam asi dvaceti regulárních výrazů udržovaných v `packages/core/tracking/ua-rules.ts`. Nepoužíváme knihovnu na parsování UA, viz kapitola 11.

#### 3.3.3 Apple egress rozsahy

Apple publikuje seznam výstupních IP rozsahů iCloud Private Relay na `https://mask-api.icloud.com/egress-ip-ranges.csv`. Ověřeno 2026-07-31: soubor má **286 949 řádků**, formát je `cidr,country,region,city,` (poslední pole prázdné), například:

```
172.224.226.0/27,GB,GB-EN,London,
172.224.226.32/31,GB,GB-SC,Aberdeen,
```

Velikost je zhruba 10 MB. **Ve výchozím stavu se nestahuje.** Důvody:

1. Tytéž rozsahy používá Private Relay pro **běžné surfování v Safari**. Kdyby se použily i pro klasifikaci webových událostí, označili bychom skutečné návštěvníky za proxy. Seznam se proto smí použít **jen** pro klasifikaci otevření e-mailu, nikdy pro web SDK.
2. 287 tisíc CIDR bloků v paměti je několik MB a nutnost prefixového stromu. Pro self-hoster je to zbytečná zátěž, když pravidlo 4 pokryje drtivou většinu případů.

Když se zapne (`TRACKING_APPLE_RELAY_RANGES=true`), stahuje se jobem `tracking.refresh_proxy_ranges` jednou za 24 hodin, ukládá do `proxy_ranges` a drží se v paměti v prefixovém stromu. Selhání stažení není chyba, jen se použije poslední známý stav a zaloguje se varování. Když stažení selhává déle než 7 dní, zobrazí se administrátorovi upozornění.

#### 3.3.4 Co se s klasifikací dělá

**Nikdy se nemaže.** Otevření se uloží se svou třídou a v reportech se z něj počítají tři různá čísla. Uživatel může přepnout pohled, ale nikdy nemůže původní data ztratit.

Definice pro report (přesně, viz katalog metrik v 3.11):

- **Otevření celkem** počítá všechna otevření tříd `human`, `proxy_apple`, `proxy_image`, `unknown`. Třída `bot` se nepočítá nikdy a do `message_events` se ani neukládá.
- **Automatická otevření** je počet zpráv, kde je `open_class_mask` roven pouze bitu `proxy_apple` (tedy zpráva byla otevřena jen Apple proxy a ničím jiným).
- **Ověřená otevření** je počet zpráv s `first_human_open_at IS NOT NULL`, tedy zpráv s alespoň jedním otevřením třídy `human` nebo `proxy_image`.

Třída `proxy_image` (Gmail) se počítá do ověřených, protože Gmail obvykle stahuje obrázky až při skutečném otevření. `unknown` se počítá do celkových, ale ne do ověřených.

#### 3.3.5 Deduplikace opakovaných stažení

Gmail proxy může tentýž pixel stáhnout několikrát během jednoho čtení. Pravidlo: **dvě otevření téže zprávy stejné třídy do 180 sekund od sebe se počítají jako jedno**. Implementace: při zpracování dávky se porovná s `message_engagement.last_open_at`. Uloží se obě události do `message_events` (data se nezahazují), ale `open_count` se zvýší jen jednou.

### 3.4 Click redirect

#### 3.4.1 Přepis odkazů

Při kompilaci šablony (část 3) se každý odkaz zaregistruje do `campaign_links(id, campaign_id, url, position)`. **`link_id` v tokenu je `campaign_links.id`, tedy UUID**, jak určuje kontrakt 4.10.3 části 1. `position` zůstává jako pořadí pro zobrazení v reportu, do tokenu nejde.

Je to lepší, než původní návrh s pořadovým číslem: `campaign_links` není partitionovaná, takže je to hledání podle primárního klíče, a redirect nepotřebuje znát ani kampaň, ani zprávu.

Sender při interpolaci nahradí `href` odkazem `{TRACKING_DOMAIN}/t/c/{token}`.

**Které odkazy se nepřepisují nikdy:**

| Typ | Důvod |
|---|---|
| `mailto:`, `tel:`, `sms:` | Nejde o web |
| Kotvy `#...` | Nejde o web |
| `{{ unsubscribe_url }}` a `{{ webview_url }}` | Vlastní mechanismus, jinde ověřený token |
| Odkaz obsahující Liquid placeholder v `href` | Cílová adresa není v době kompilace známá, viz 3.4.2 |
| Odkaz, který se při kompilaci nepodařilo zparsovat jako absolutní `http(s)` URL | Bezpečnost |

#### 3.4.2 Odkazy s proměnnou v adrese

Šablona může obsahovat `<a href="{{ contact.attributes.portal_url }}">`. Taková adresa není při kompilaci známá, takže ji nejde zaregistrovat do `campaign_links` a nejde ji ověřit proti allowlistu.

**Rozhodnutí pro MVP 0: takové odkazy se netrackují.** Projdou do mailu tak, jak jsou. Validátor v editoru (část 3) zobrazí varování „Tento odkaz nepůjde měřit, protože obsahuje proměnnou." Alternativa (ukládat interpolovanou adresu na každou zprávu) by znamenala další sloupec s adresou u každé z milionu zpráv a otevřela by přesně tu díru, kterou 3.4.3 zavírá.

#### 3.4.3 Ochrana proti open redirectu

Tohle je nejdůležitější bezpečnostní vlastnost celé části. Otevřené přesměrování na naší doméně by se dalo použít k phishingu na účet zákazníka a poškodilo by reputaci odesílací domény.

**Základní princip: cílová adresa se nikdy nebere ze vstupu. Bere se z databáze podle `link_id`.**

Konkrétně:

1. Token obsahuje jen identifikátory (`workspace_id`, `message_id`, `link_id`). Neobsahuje URL ani její část.
2. Cíl se čte z `campaign_links` podle primárního klíče `id = link_id`. Když řádek neexistuje, jde se na chybovou cestu. Navíc se ověří, že `campaign_links.workspace_id` (nebo workspace jeho kampaně) souhlasí s `workspace_id` z tokenu; neshoda znamená pokus o záměnu a jde na chybovou cestu.
3. Adresa v `campaign_links.url` byla při kompilaci validována: musí být absolutní, schéma `http` nebo `https`, host musí být platné doménové jméno nebo veřejná IP, maximální délka 2048 znaků. Adresy se schématem `javascript:`, `data:`, `vbscript:`, `file:` a s hostem v privátních rozsazích jsou odmítnuty už v editoru.
4. **Query parametry z příchozího požadavku se do cíle nepřenášejí.** Cíl se skládá výhradně z uložené adresy plus případného `oe_token`.
5. Do cílové adresy se nikdy nevkládá nic, co přišlo od klienta.

Chování při chybě:

| Situace | Odpověď |
|---|---|
| Token neplatný (jakýkoliv kód z 3.1.4) | `302` na `{APP_URL}/t/expired`, žádný zápis |
| `link_id` neexistuje v `campaign_links` | `302` na `{APP_URL}/t/expired` |
| Kampaň smazaná | `302` na `{APP_URL}/t/expired` |
| Neznámá generace klíče | `302` na `{APP_URL}/t/expired` |
| Cíl v databázi je z nějakého důvodu nevalidní | `500`, alert do logu, žádné přesměrování |

Stránka `/t/expired` je statická, na naší doméně, bez parametrů, s textem „Tento odkaz už neplatí" a odkazem na domovskou stránku instance. Nikdy nepřesměrovává dál.

Použije se HTTP `302 Found` s hlavičkami:

```
Location: <uložená adresa>
Cache-Control: no-store, no-cache, must-revalidate, private
Referrer-Policy: no-referrer
X-Robots-Tag: noindex, nofollow
```

`Referrer-Policy: no-referrer` je důležitá: bez ní by cílový web viděl v `Referer` celý náš tracking odkaz včetně tokenu.

#### 3.4.4 Cache povolených domén a odkazů

Redirect musí být rychlý, takže v horké cestě nesmí být čtení z databáze:

| Data | Kde je | Obnova | Velikost |
|---|---|---|---|
| `campaign_links` | LRU cache v procesu, klíč `link_id`, hodnota `{url, campaign_id, workspace_id}` | Miss načte **celou kampaň** jedním dotazem a naplní všechny její odkazy, TTL 15 minut | 50 000 položek, cca 8 MB |
| `tracking_domains` celé | Mapa v paměti, obnova každých 60 sekund jobem | Plná | Řádově tisíce řádků |
| `K_tracking[key_id]` | Paměť, načteno při startu | Nikdy | 32 B na generaci |

Cache se plní po kampaních, i když se čte po `link_id`: první klik v kampani načte `SELECT id, url, campaign_id FROM campaign_links WHERE campaign_id = (SELECT campaign_id FROM campaign_links WHERE id = $1)`, tedy dva indexované přístupy, a naplní všechny odkazy kampaně naráz. Další kliky v téže kampani jsou pak z paměti. Cold start prvního kliku je řádově 2 ms.

Souběžné požadavky na tutéž kampaň čekají na jedno naplnění (single flight), aby se při startu rozesílky neudělalo tisíc stejných dotazů.

#### 3.4.5 Latence

| Případ | p50 | p99 | Čím je zaručeno |
|---|---|---|---|
| Klik na cizí doménu (bez `oe_token`) | ≤ 3 ms | ≤ 30 ms | Žádný dotaz do DB, žádný zápis v horké cestě |
| Klik na vlastní doménu, `message_id` v cache | ≤ 4 ms | ≤ 35 ms | Cache zásah |
| Klik na vlastní doménu, cache miss | ≤ 8 ms | ≤ 60 ms | Jedno hledání podle PK ve dvou partition |
| Nejhorší přijatelná hodnota | | 200 ms | Nad ní se zaloguje varování a metrika `tracking_redirect_duration_seconds` |
| Tvrdý strop na dohledání kontaktu | | 30 ms | Po překročení se `oe_token` nepřidá a přesměruje se bez něj |

Zápis kliku jde do bufferu v paměti a odpověď se odesílá okamžitě. Buffer se vyprazdňuje každých 250 ms nebo po 500 událostech, podle toho, co nastane dřív. Při `SIGTERM` se buffer vyprázdní před ukončením (součást graceful shutdown, timeout 5 s).

**Přiznaný kompromis:** tvrdý pád procesu (SIGKILL, OOM, výpadek napájení) ztratí až 250 ms kliků. Při rozesílce 100 zpráv za sekundu a 3% okamžité prokliknutosti je to řádově jednotky událostí. Alternativa (synchronní zápis) by ztrojnásobila latenci přesměrování pro každého uživatele. Kompromis je vědomý a je uvedený v dokumentaci.

#### 3.4.6 Zpracování požadavku

```
1. verify(token, allowedTypes=['c'], now); neplatný -> /t/expired
2. link = linkCache.get(link_id)               (single flight, plní se po kampani)
3. chybí, nebo link.workspace_id != token.workspace_id -> /t/expired
4. click_class = classify_click(headers, ip)   (pravidla 1 až 4 a 7 z 3.5)
5. buffer.push({ workspace_id, message_id, link_id, campaign_id = link.campaign_id,
                 message_created_at, occurred_at = now, click_class })
6. host = lowercase(hostname z link.url)
7. pokud click_class = 'human'
      a workspace má web tracking zapnutý
      a host odpovídá tracking_domains (přesná shoda nebo subdoména při include_subdomains):
        oe = mintIdentityToken(workspace_id, contact_id, campaign_id, ttl=15 min)
        target = appendQueryParam(link.url, 'oe_token', oe)
8. 302 Location: target
```

Krok 6 a 7 jsou to, co brání úniku identity na cizí web. Když odkaz vede na `facebook.com`, token se nepřidá.

**Krok 7 potřebuje `contact_id`, které v click tokenu není.** Identity token podle kontraktu 4.10.3 nese `contact_id`, takže ho redirect musí odněkud vzít, a jediný zdroj je `messages`. To vrací jedno čtení do horké cesty, kterému se původní návrh vyhýbal. Zmírnění:

- Čte se dotazem s časovým oknem z UUIDv7 podle 3.1.7, tedy nejvýš dvě partition a hledání podle primárního klíče.
- Čte se **jen tehdy**, když jsou splněné obě podmínky kroku 7, tedy jen u kliků na vlastní doménu zákazníka. U odkazů ven (sociální sítě, partnerské weby) se nečte nic.
- Výsledek se cachuje na 15 minut pod klíčem `message_id`, protože tentýž člověk obvykle klikne v jednom mailu vícekrát.
- Když čtení selže nebo trvá přes 30 ms, `oe_token` se **nepřidá** a přesměrování proběhne bez něj. Ztratí se propojení identity u jednoho kliku, což je nesrovnatelně menší škoda než pomalé přesměrování.

Dopad na latenci je v 3.4.5. Kdyby identity token nesl `message_id` místo `contact_id` (návrh v 13.8), tohle čtení by odpadlo úplně.

`appendQueryParam` respektuje existující query i fragment: `https://x.cz/a?b=1#c` se změní na `https://x.cz/a?b=1&oe_token=...#c`. Fragment zůstává na konci. Když už parametr `oe_token` v adrese je (nemělo by nastat), přepíše se.

### 3.5 Klasifikace kliknutí

Bezpečnostní filtry firemní pošty (Proofpoint, Mimecast, Barracuda, Microsoft Safe Links) po doručení navštíví každý odkaz. To nafukuje prokliky, tedy metriku, na které stavíme reporty. Musíme to umět odfiltrovat.

```ts
type ClickClass = 'human' | 'scanner' | 'bot' | 'prefetch';
```

Pravidla, první shoda vyhrává:

| # | Podmínka | Výsledek |
|---|---|---|
| 1 | `User-Agent` odpovídá seznamu crawlerů | `bot` |
| 2 | Prefetch hlavičky (jako u otevření) | `prefetch` |
| 3 | Metoda `HEAD` | `scanner` |
| 4 | `User-Agent` obsahuje známý řetězec skeneru (`Safelinks`, `ProofPoint`, `Mimecast`, `Barracuda`, `urldefense`, `Symantec`, `FireEye`) | `scanner` |
| 5 | Klik přišel **dřív než 5 sekund** po zápisu `messages.sent_at` | `scanner` |
| 6 | Ze stejné IP přišly během 60 sekund kliky na **3 a více různých `link_id` téže zprávy** | `scanner` (přeznačí se i ty předchozí v téže dávce) |
| 7 | `User-Agent` chybí nebo je prázdný | `bot` |
| 8 | jinak | `human` |

Pravidlo 5 potřebuje `messages.sent_at`, což je čtení z databáze. Nedělá se v horké cestě, ale až v asynchronním zpracování dávky (3.9.2), kde se čte jeden řádek na zprávu.

Pravidlo 6 se vyhodnocuje také v asynchronním zpracování, v rámci jedné dávky plus okna 60 sekund zpět. Protože se dávky zpracovávají po sekundách, okno se drží v pomocné mapě v paměti workeru. Při restartu workeru se okno ztratí, což vede k několika falešným `human` klikům. Přijatelné.

Klasifikace `scanner`, `bot` a `prefetch` **se ukládá** (na rozdíl od `bot` u otevření), protože se z ní počítá diagnostická dlaždice „odfiltrované strojové prokliky". Do metrik prokliku se nepočítají.

Důsledek pro identity resolution: `oe_token` se přidává jen u `click_class = 'human'`, ale klasifikace v horké cestě má k dispozici jen pravidla 1 až 4 a 7. Pravidla 5 a 6 se dopočítají později. To znamená, že skener může dostat `oe_token`. Není to problém: token je vázaný na cílový host, platí 15 minut, je jednorázový a skener ho nespotřebuje, protože nespouští JavaScript. Kdyby ho spotřeboval, vznikla by vazba anonymního ID skeneru na kontakt, což je neškodné a projeví se to jen jako jedna zbytečná anonymní identita.

### 3.6 Web SDK (`packages/sdk-web`)

#### 3.6.1 Rozpočet velikosti a build

| Položka | Hodnota |
|---|---|
| Cíl | ≤ 4 200 B gzip |
| Tvrdý limit, CI padá | 5 120 B gzip |
| Formát | IIFE, ES2019, žádné závislosti, žádný polyfill |
| Distribuce | `{TRACKING_DOMAIN}/e/oe.js`, `Cache-Control: public, max-age=3600, stale-while-revalidate=86400` |
| Verzování | Obsah odpovídá verzi instance. Při upgradu instance se změní `ETag` |

Žádná runtime závislost. Bundluje se esbuildem, který je součástí buildu z části 1.

#### 3.6.2 Instalace

```html
<script>
  window.OpenEngage = window.OpenEngage || function(){ (OpenEngage.q = OpenEngage.q || []).push(arguments) };
  OpenEngage('init', { key: 'oe_pub_aebagbafaydqqcik', host: 'https://events.shop.cz' });
</script>
<script async src="https://events.shop.cz/e/oe.js"></script>
```

Fronta `OpenEngage.q` umožňuje volat API dřív, než se skript načte. Po načtení se fronta přehraje.

Alternativně npm balíček `@openengage/sdk-web` se stejným veřejným API pro projekty s vlastním bundlerem.

#### 3.6.3 Veřejné API

```ts
type ConsentState = {
  analytics: boolean;         // podmínka pro jakýkoliv sběr
  personalization: boolean;   // podmínka pro vazbu na kontakt
  emailMarketing?: boolean;   // SDK jen předává dál, sám ho nepoužívá
};

interface OpenEngageSDK {
  init(options: {
    key: string;                 // veřejný klíč, tvar oe_pub_<16 znaků base32> podle 3.5 části 1
    host: string;                // TRACKING_DOMAIN
    autoPageView?: boolean;      // výchozí true
    consent?: ConsentState;      // když se předá, nečeká se na consent()
    sessionTimeoutMinutes?: number; // výchozí 30, rozsah 1 až 1440
    debug?: boolean;             // výchozí false, loguje do console
  }): void;

  consent(state: ConsentState): void;

  track(name: string, properties?: Record<string, unknown>): void;

  page(properties?: { title?: string; path?: string; url?: string;
                      referrer?: string; [k: string]: unknown }): void;

  identify(externalId: string,
           traits?: Record<string, unknown>,
           options?: { signature?: string }): void;

  reset(): void;

  getAnonymousId(): string | null;

  flush(): Promise<void>;

  on(event: 'ready' | 'identified' | 'error' | 'blocked',
     handler: (payload: unknown) => void): () => void;
}
```

Chování jednotlivých metod:

**`init`** nesmí nic uložit do prohlížeče, dokud není souhlas. Když `consent` v options chybí, SDK se přepne do stavu `waiting_consent`: události volané přes `track` a `page` se drží v paměti (maximálně 20, pak se nejstarší zahazují), nic se neodesílá a neexistuje ani `anonymous_id`.

**`consent`** je jediný přepínač. Při `analytics: true` se vytvoří nebo načte `anonymous_id`, přehraje se paměťová fronta a spustí se odesílání. Při `analytics: false` (nebo odvolání) se okamžitě zastaví odesílání, vyprázdní se fronty, smaže se cookie `oe_aid`, položky v `localStorage` a `sessionStorage`. Volání `consent({analytics:false})` je idempotentní.

**`track`** validuje jméno proti `^[a-z][a-z0-9_]{0,63}$`. Neplatné jméno se zahodí a zaloguje se do konzole jen v `debug` režimu. Nikdy nevyhodí výjimku do stránky zákazníka. Vlastnosti se ořežou podle limitů v 3.7.3.

**`page`** je zkratka pro `track('page_view', ...)` s automaticky doplněnou stránkou. Při `autoPageView: true` se volá jednou po `consent` a pak při každé změně `history.pushState`, `history.replaceState` a při `popstate`. Deduplikace: dvě `page_view` na tutéž `path` do 1 sekundy se počítají jednou (SPA routery často volají `replaceState` vícekrát).

**`identify`** má dva režimy:

| Režim | Co se předá | Co server udělá |
|---|---|---|
| Nepodepsaný | `externalId` a traits **bez** polí `email`, `phone` | Vytvoří nebo najde vazbu podle `contacts.external_id`. Nikdy nezakládá nový kontakt a nikdy nemění e-mail |
| Podepsaný | `externalId`, traits včetně `email`, plus `options.signature` | Ověří podpis a povolí i zápis e-mailu a založení kontaktu |

Podpis vyrábí server zákazníka svým **privátním** API klíčem:
`signature = base64url(HMAC-SHA256(secret_key_bytes, externalId + "\n" + canonicalJson(traits)))`.
Bez podpisu server odmítne payload s e-mailem chybou `tracking_identify_unsigned_pii` (HTTP 422) a událost zahodí. Tím se plní požadavek z kapitoly 6.1 hlavní specifikace, že web SDK nesmí podvrhnout cizí e-mail.

**`reset`** vygeneruje nové `anonymous_id`, zapíše `identity_bindings` se `source = 'reset'` a `contact_id = NULL`, ukončí session. Používá se při odhlášení uživatele z e-shopu. Předchozí historie zůstává navázaná na kontakt, nová se od kontaktu odpojí.

**`flush`** vrátí Promise, která se vyřeší po odeslání aktuální fronty. Používá se před přesměrováním na platební bránu.

#### 3.6.4 Uložení identifikátoru

| Klíč | Kde | Platnost | Obsah |
|---|---|---|---|
| `oe_aid` | cookie, `SameSite=Lax; Secure; Path=/` | 400 dní (`Max-Age=34560000`) | UUIDv4 |
| `oe_aid` | `localStorage` | bez expirace | totéž, záloha |
| `oe_sid` | `sessionStorage` | do zavření karty | UUIDv4 session |
| `oe_last` | `localStorage` | 30 dní | timestamp poslední události, řídí timeout session |
| `oe_q` | `localStorage` | 7 dní | neodeslané události, viz 3.6.6 |

Cookie se nastavuje JavaScriptem (`document.cookie`), protože ingestion běží na jiném hostu než web zákazníka. Safari ITP takové cookie zkracuje na 7 dní. **Proto je `localStorage` primární zdroj a cookie jen doplněk.** Při načtení: přečte se cookie, když chybí, přečte se `localStorage`, když chybí obojí, vygeneruje se nové ID. Vždy se pak zapíšou obě místa.

Doména cookie se **nenastavuje** (žádné `Domain=`), takže platí jen pro přesný host. Pro sdílení mezi `www.shop.cz` a `shop.cz` musí zákazník použít stejný host, nebo se ID vytvoří dvě. To je vědomé zjednodušení MVP 0.

**`anonymous_id` je UUIDv4, ne UUIDv7. Je to vědomá a odsouhlasená výjimka z konvence 2.1 části 1**, ne opomenutí.

Konvence žádá UUIDv7 u primárních klíčů, protože ID cestují do URL a webhooků a náhodné klíče roztrhají B-tree při zápisu. `anonymous_id` ale primární klíč není a hlavně je **trvale viditelný v cookii na cizím počítači**. UUIDv7 nese v prvních 48 bitech čas vzniku s přesností na milisekundy, takže by komukoli s přístupem k prohlížeči (a každému skriptu na stránce zákazníka) prozradil přesný čas první návštěvy. To je informace navíc, kterou k ničemu nepotřebujeme.

Zápisový argument tu neplatí: `anonymous_id` je v `identities` součástí složeného klíče `(workspace_id, anonymous_id)` a v `web_events` jen indexovaný sloupec, ne klíč, který by určoval fyzické pořadí.

#### 3.6.5 Session

- Session končí po **30 minutách nečinnosti** (konfigurovatelné 1 až 1440 minut) nebo po **24 hodinách** od začátku, podle toho, co nastane dřív.
- Nečinnost se měří od poslední odeslané události, uložené v `oe_last`.
- Při začátku nové session se odešle událost `session_started` s vlastnostmi `{ referrer, entry_path, utm_* }`.
- Událost `session_ended` se neposílá. Konec session se dopočítá při čtení jako poslední událost session. Důvod: spolehlivé odeslání při zavření karty neexistuje, viz 3.6.6.
- Session ID se nezachovává mezi kartami. Dvě otevřené karty téhož webu jsou dvě session. To je vědomé zjednodušení, sjednocení přes `BroadcastChannel` by stálo místo v rozpočtu velikosti.

#### 3.6.6 Dávkování a odeslání

Fronta se vyprazdňuje, když nastane cokoliv z toho:

| Podmínka | Hodnota |
|---|---|
| Počet událostí ve frontě | 20 |
| Uplynulý čas od prvního zařazení | 5 sekund |
| Velikost serializované dávky | 24 kB |
| Volání `flush()` | okamžitě |
| `visibilitychange` na `hidden` | okamžitě přes `sendBeacon` |
| `pagehide` | okamžitě přes `sendBeacon` |

Chování při odchodu ze stránky se řídí ověřeným stavem prohlížečů: `beforeunload` a `unload` se na mobilech často nespustí vůbec, `visibilitychange` na `hidden` se spouští spolehlivě při přepnutí karty i při zamknutí telefonu, `pagehide` doplňuje případy bfcache. Proto se používají **oba** a odesílá se přes `navigator.sendBeacon`, protože běžný `fetch` se při zavírání karty ruší. `fetch` s `keepalive: true` je alternativa, ale má limit 64 kB na celý dokument, sdílený mezi všemi požadavky, takže je méně spolehlivý.

Aby `sendBeacon` nevyvolal CORS preflight, posílá se **řetězec**, tedy `Content-Type: text/plain;charset=UTF-8`. To je jeden ze tří typů, které patří mezi jednoduché požadavky. Server proto **musí** přijmout JSON i s tímto typem obsahu. Při běžném odeslání (ne při odchodu) se používá `fetch` s `Content-Type: application/json`, což preflight vyvolá, ale ten se cachuje podle `Access-Control-Max-Age`.

Nutná ochrana: protože `text/plain` obchází preflight, není endpoint chráněný CORS. Zabezpečení stojí na tom, že se v odpovědi nevrací žádná data (viz 3.7.5) a že je vstup vždy ověřený veřejným klíčem a omezený rate limiterem.

Když odeslání selže:

1. `sendBeacon` vrátí `false` (fronta prohlížeče je plná) nebo `fetch` skončí chybou. Události se vrátí do fronty.
2. Fronta se uloží do `localStorage` pod `oe_q`, maximálně 100 událostí, 256 kB, 7 dní.
3. Opakuje se s exponenciálním backoffem 1 s, 2 s, 4 s, 8 s, 16 s, 30 s (strop), maximálně 8 pokusů na dávku.
4. Odpověď `4xx` kromě `408` a `429` znamená trvalou chybu, dávka se zahodí a vyvolá se `error` handler.
5. Odpověď `429` respektuje `Retry-After`.
6. Při načtení stránky se `oe_q` přehraje jako první, ale jen události mladší než 7 dní. Starší se zahodí.

Když je SDK zablokované (blokátor přepíše `navigator.sendBeacon` nebo zablokuje síť), vyvolá se událost `blocked`. Zákazník na ni může navázat serverové měření. Nesnažíme se blokátor obejít.

#### 3.6.7 Bezpečnost SDK

- SDK nikdy nečte hodnoty z formulářových polí ani z `input`, `textarea`, `select`.
- SDK nikdy neposílá `document.cookie`, `localStorage` ani obsah stránky.
- SDK běží jen na hostu, který je v `tracking_domains`. Server odmítne událost s hlavičkou `Origin`, která neodpovídá, chybou `origin_not_allowed`. SDK to zobrazí v `debug` režimu jako srozumitelnou hlášku.
- Veřejný klíč je určený k tomu, aby byl vidět. Umožňuje jen zápis událostí. Nedá se s ním nic přečíst.
- Ochrana proti zaplavení cizími daty stojí na rate limitech (3.7.4) a na tom, že podvržená událost nikdy nemůže změnit e-mail kontaktu (3.6.3).
- SDK nikdy nevyhodí neodchycenou výjimku do stránky zákazníka. Celé veřejné API je obalené a chyby jdou do `error` handleru.

### 3.7 Ingestion API

#### 3.7.1 Payload

`POST {TRACKING_DOMAIN}/e/track`

Cesta je z konvence 4.1 a 6 části 1, která `/e/track` jmenovitě uvádí jako jednu ze tří výjimek s CORS `*`. Klíče v JSONu jsou `snake_case` podle 4.1.

```ts
type IngestBatch = {
  v: 1;                     // verze payloadu, viz 3.1.8
  key: string;              // oe_pub_<16 znaků base32>, viz 3.5 části 1
  sent_at: string;          // ISO 8601 UTC s Z, čas klienta, slouží ke korekci hodin
  anonymous_id?: string;    // UUID, povinné pro source 'web'
  events: IngestEvent[];    // 1 až 50
};

type IngestEvent = {
  id: string;               // UUIDv7, generuje klient, slouží k deduplikaci
  name: string;             // ^[a-z][a-z0-9_]{0,63}$
  occurred_at: string;      // ISO 8601 UTC s Z, čas klienta
  session_id?: string;      // UUID
  page?: EventPage;
  properties?: Record<string, unknown>;
  context?: EventContext;
};
```

Pole se jmenuje `occurred_at`, ne `ts` ani `created_at`: `created_at` je až serverem přepočítaná hodnota, která jde do sloupce, a rozlišení obojího je nutné, protože 3.7.2 mezi nimi počítá korekci hodin.

Serverová varianta `POST /api/v1/events` má stejný tvar událostí, ale místo `key` v těle používá privátní API klíč v hlavičce `Authorization: Bearer oe_live_...` a smí navíc uvést `contact_id` nebo `email` přímo na události. Ta varianta patří do veřejného API a řídí se konvencemi části 1 včetně formátu chyb a idempotence podle 4.4.

#### 3.7.2 Korekce času

Hodiny v prohlížeči nejsou spolehlivé. Server proto:

```
skew        = server_now - sent_at
occurred_at = clamp(occurred_at_klienta + skew, server_now - 7 dní, server_now + 60 s)
received_at = server_now
```

Když je `|skew|` větší než 24 hodin, `skew` se nepoužije a `occurred_at = server_now`, protože hodiny klienta jsou zjevně mimo. Do `context.clock_skew_ms` se uloží zjištěný posun kvůli diagnostice.

Obě hranice jsou zároveň vynucené constraintem `ck_web_events__lag` (2.2) a ohraničují, o kolik partition musí timeline sáhnout zpět. Dolní hranice 7 dní odpovídá životnosti offline fronty v SDK, horní pokrývá hodiny klienta napřed.

#### 3.7.3 Validace a limity

| Limit | Hodnota | Chování při překročení |
|---|---|---|
| Velikost těla | 64 kB | `413`, kód `payload_too_large`. Konvence 4.1 části 1 dává obecný limit 1 MiB, pro `/e/track` ho zpřísňuju |
| Počet událostí v dávce | 50 | `422`, kód `too_many_items` |
| Velikost jedné události po serializaci | 8 kB | Událost se zahodí, dávka projde, v odpovědi `rejected` s kódem `tracking_event_too_large` |
| Počet vlastností v `properties` | 32 | Přebytečné klíče se zahodí (abecedně od konce) |
| Délka klíče vlastnosti | 64 znaků | Klíč se zahodí |
| Délka řetězcové hodnoty | 1 024 znaků | Ořeže se |
| Hloubka vnoření v `properties` | 3 | Hlubší úrovně se nahradí `null` |
| Délka `name` | 64 znaků | Událost se zahodí, kód `tracking_invalid_event_name` |
| Délka URL v `page` | 2 048 znaků | Ořeže se |
| Počet `tracking_domains` na workspace | 20 | `422` při zakládání, kód `tracking_domain_limit_reached` |

Neplatná dávka jako celek (chybí `key`, není JSON, chybí `events`) vrací `400`. Neplatná **jednotlivá** událost dávku nezastaví, projdou ostatní.

#### 3.7.3.1 Čištění URL

Před uložením se z `page.url`, `page.referrer` a `page.search`:

1. Odstraní se `username:password@` z URL.
2. Odstraní se fragment (`#...`).
3. Odstraní se parametry, jejichž jméno (case-insensitive) je v seznamu: `token`, `access_token`, `refresh_token`, `id_token`, `password`, `passwd`, `pwd`, `secret`, `api_key`, `apikey`, `key`, `signature`, `sig`, `auth`, `session`, `sessionid`, `otp`, `code`, `email`, `e-mail`, `phone`, `tel`, `ssn`, `rc`, `oe_token`. Seznam je konfigurovatelný přes `TRACKING_STRIP_QUERY_PARAMS` a jde jen rozšiřovat, ne zkracovat pod výchozí sadu.
4. Když cesta odpovídá vzorům `/(reset|obnova)-?hesla`, `/login`, `/prihlaseni`, `/verify`, `/overeni`, zahodí se celý query řetězec.
5. Parametry `utm_*`, `gclid`, `fbclid` se **zachovávají** a navíc se rozparsují do `context.campaign`.

Odstranění `oe_token` v bodě 3 je důležité: SDK ho sice z adresy maže přes `history.replaceState`, ale první `page_view` může proběhnout dřív.

#### 3.7.4 Rate limiting

**Limity, algoritmus i knihovnu vlastní část 1, sekce 4.5.** Přebírám je beze změny a neduplikuju. Relevantní řádky:

| Klíč | Endpoint | Limit | Okno |
|---|---|---|---|
| veřejný klíč (`oe_pub_`) | `POST /e/track` | 6 000 | 1 min |
| veřejný klíč + IP | `POST /e/track` | 120 | 1 min |
| IP | `/t/o/**`, `/t/c/**` | 600 | 1 min |

Algoritmus je posuvné okno s pevnými sloty (`rate-limiter-flexible`), ne token bucket, protože u ingestion se chráníme právě před výbuchem.

Doplňuji dva limity, které v tabulce části 1 nejsou a které potřebuju (viz požadavek 12.5.11):

| Klíč | Endpoint | Limit | Okno | Proč |
|---|---|---|---|---|
| IP | `POST /e/identify` | 30 | 1 min | Endpoint spotřebovává jednorázové tokeny; opakované volání znamená buď chybu, nebo pokus o hádání |
| `anonymous_id` | `POST /e/track` | 600 událostí | 1 min | Jeden prohlížeč nemá důvod poslat víc; chrání před skriptem, který zaplaví jeden profil |

Při překročení: `429`, `application/problem+json` s `code = "rate_limited"` a polem `retry_after`, hlavičky `RateLimit-*` a `Retry-After` podle 4.5 části 1.

**Výjimka pro `/t/o/` a `/t/c/`:** při překročení se **nevrací 429**. Pixel vrátí normální GIF, klik normálně přesměruje, jen se událost nezapíše a zvýší se čítač. Uživatel nesmí kvůli našemu limitu vidět rozbitý obrázek nebo nefunkční odkaz.

**Výhrada k limitu 120 za minutu na dvojici klíč a IP** je v 13.10. Za korporátním NATem je to při běžném dávkování v SDK asi 10 souběžných uživatelů, což je málo.

Bez Redisu (rozhodnutí hlavní specifikace, potvrzené v části 1) je limiter při `RATE_LIMIT_BACKEND=memory` per proces. Při běhu N replik je efektivní limit N násobek. Přijatelné, protože jde o ochranu před nehodou, ne před cíleným útokem; skutečnou ochranu má dělat reverzní proxy.

#### 3.7.5 Odpověď a CORS

Úspěch: `202 Accepted`.

```json
{ "accepted": 18, "rejected": 2,
  "errors": [ { "index": 3, "code": "tracking_event_too_large" } ] }
```

Odpověď **nikdy neobsahuje žádná data o kontaktu**. Nevrací `contact_id`, e-mail, ani informaci o tom, jestli je anonymní ID navázané. Kdyby to dělala, stal by se z endpointu nástroj na zjišťování, kdo je návštěvník.

Chyby celé dávky se vrací jako `application/problem+json` podle 4.2 části 1.

Částečné odmítnutí v rámci `202` používá **`findings`**, ne vlastní tvar. Rozšíření obálky `Problem` o `findings` se `severity` mezitím doplnila část 1 (4.2) a moje původní vlastní struktura s polem `index` tím padá. Pravidlo z 4.2, že „operace smí vrátit 4xx s `findings` jen tehdy, když obsahuje alespoň jeden nález se `severity: error`", tady sedí přesně naopak a je to v pořádku: samotná varování se vracejí s úspěšnou odpovědí, což je právě tenhle případ.

```json
{ "accepted": 18, "rejected": 2,
  "findings": [
    { "severity": "warning", "code": "tracking_event_too_large",
      "params": { "index": 3, "size_bytes": 9412 } },
    { "severity": "warning", "code": "tracking_invalid_event_name",
      "params": { "index": 11, "name": "Product Viewed" } }
  ] }
```

Pozice v dávce jde do `params.index`, protože `path` v `findings` znamená cestu v JSONu, a index položky v dávce jí není.

CORS hlavičky. Část 1, sekce 6, uvádí pro `/e/track` CORS `*` a cachování preflightu na 24 hodin:

```
Access-Control-Allow-Origin: *
Access-Control-Allow-Methods: POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
Access-Control-Max-Age: 86400
```

`Access-Control-Allow-Credentials` se **nenastavuje** a nastavit ho ani nejde: v kombinaci s `*` je to podle specifikace neplatné. To je v pořádku, protože cookie se na ingestion neposílají a autentizace je výhradně veřejným klíčem v těle.

**CORS `*` neznamená, že se přijme cokoliv.** Kontrola `Origin` proti `tracking_domains` se dělá **v aplikační logice**, ne přes CORS hlavičku, a nevyhovující požadavek dostane `403` s `code = "origin_not_allowed"`. Rozdíl je podstatný: CORS chrání prohlížeč před čtením odpovědi, naše kontrola chrání data před zápisem. Kdybychom se spoléhali jen na CORS, prošel by jakýkoliv požadavek z curlu.

Když `Origin` neodpovídá žádné registrované doméně, požadavek se odmítne s `403` a kódem `origin_not_allowed`. Požadavek **bez** hlavičky `Origin` (serverové volání, curl) se posuzuje podle typu klíče: veřejný klíč bez `Origin` se přijme jen tehdy, když má workspace nastaveno `tracking.allow_serverside_public_key = true` (výchozí `false`).

#### 3.7.6 Deduplikace

Klient generuje `id` každé události. Server vkládá přes `INSERT ... ON CONFLICT (id, created_at) DO NOTHING`. Duplicita se v odpovědi projeví jako `accepted`, protože klient nemá důvod ji řešit.

Okno deduplikace je efektivně nekonečné v rámci retence, protože klíč obsahuje `created_at`. Když klient pošle tutéž událost s jiným `occurred_at` (což by znamenalo, že si ji přepsal), vznikne duplicita. SDK `occurred_at` po zařazení do fronty nemění.

### 3.8 Identity resolution

Tohle je nejchoulostivější algoritmus v celé části. Chyba v něm znamená, že se historie jednoho člověka přiřadí jinému.

#### 3.8.1 Pojmy

| Pojem | Význam |
|---|---|
| `anonymous_id` | UUIDv4 v prohlížeči. Identifikuje **prohlížeč**, ne osobu |
| `contact_id` | Kontakt v databázi. Identifikuje **osobu** |
| vazba | Tvrzení „tenhle prohlížeč právě používá tenhle kontakt", platné od určitého času |
| slučování | Jednorázové doplnění `contact_id` do už uložených anonymních událostí |

#### 3.8.2 Zdroje vazby a jejich důvěryhodnost

| Zdroj | `source` | Důvěryhodnost | Smí sloučit historii |
|---|---|---|---|
| Klik v e-mailu přes `oe_token` | `email_click` | vysoká | ano |
| Serverové API s privátním klíčem | `server_api` | vysoká | ano |
| `identify` s podpisem | `sdk_identify` | vysoká | ano |
| `identify` bez podpisu, jen `external_id` | `sdk_identify` | střední | ano, když `external_id` odpovídá právě jednomu kontaktu |
| Odeslání formuláře (část 2) | `form` | vysoká | ano |
| `reset()` | `reset` | vysoká | ne, odvazuje |

#### 3.8.3 Základní algoritmus

```
bind(workspace_id, anonymous_id, contact_id, source, evidence, now):

  0. GDPR čl. 18: načíst contacts.processing_restricted a deleted_at
     pokud processing_restricted = true NEBO deleted_at IS NOT NULL:
        NEVYTVÁŘET vazbu, NESPOUŠTĚT slučování,
        NEAKTUALIZOVAT contacts.last_activity_at
        zvýšit metriku tracking_identity_bind_total{result="restricted"}
        vrátit 'restricted'                       -- událost se uloží anonymně

  1. načíst identities pro (workspace_id, anonymous_id) FOR UPDATE
     (řádek nemusí existovat)

  2. pokud řádek neexistuje:
        vložit identities(contact_id, bound_at=now, bind_count=1,
                          first_seen=now, last_seen=now)
        vložit identity_bindings(valid_from=now, contact_id, source, evidence)
        naplánovat merge(anonymous_id -> contact_id)      // PRVNÍ vazba, slučuje se
        vrátit 'created'

  3. pokud identities.contact_id IS NULL:
        UPDATE contact_id, bound_at=now, bind_count=bind_count+1
        vložit identity_bindings(...)
        naplánovat merge(anonymous_id -> contact_id)      // PRVNÍ vazba, slučuje se
        vrátit 'bound'

  4. pokud identities.contact_id = contact_id:
        UPDATE last_seen=now
        vrátit 'unchanged'                                 // nic se neslučuje

  5. identities.contact_id != contact_id  -> KONFLIKT:
        UPDATE contact_id=nový, bound_at=now, bind_count=bind_count+1
        vložit identity_bindings(valid_from=now, contact_id=nový, source, evidence)
        NESLUČOVAT historii
        zvýšit metriku tracking.identity.rebind
        pokud bind_count > 5 v posledních 24 h -> označit identities jako 'shared'
        vrátit 'rebound'
```

**Krok 0 je omezení zpracování podle článku 18 GDPR** a v původní verzi tohoto dokumentu chyběl úplně. Kontakt s uplatněným omezením se nemaže, ale nesmí se **zpracovávat**. Vytvořit mu vazbu na prohlížeč, doplnit mu `contact_id` do historických událostí a přepsat mu `last_activity_at` je zpracování osobních údajů v přímém rozporu s uplatněným omezením. Pravidlo části 2 je tvrdé a bez výjimek, takže ho přebírám v témže tvaru.

Tracking se u takového kontaktu nezastaví úplně: události se dál ukládají, ale **anonymně**, tedy jen s `anonymous_id`. Je to vědomé: zastavit i anonymní sběr by znamenalo, že omezení uplatněné jedním člověkem ovlivní měření návštěvnosti webu jako celku, a anonymní událost bez vazby na osobu není zpracováním jeho osobních údajů. Kdyby právní posouzení došlo k opaku, stačí v kroku 0 událost zahodit; je to jeden řádek a je to označené v otevřených otázkách.

Kontrola se dělá při každém volání `bind`, ne jednou při startu, protože omezení může být uplatněné kdykoliv. Je to jedno čtení řádku kontaktu, který stejně potřebujeme kvůli ověření existence.

**Krok 5 je jádro celého návrhu a je záměrně konzervativní.** Když jeden `anonymous_id` postupně odpovídá dvěma různým kontaktům, znamená to jednu ze tří věcí: sdílený počítač (rodina, firemní recepce, veřejný terminál), přeposlaný e-mail otevřený někým jiným, nebo záměrné zneužití. Ve všech třech případech je špatně přiřadit dosavadní historii nové osobě.

Proto: **historie se doplňuje výhradně při první vazbě anonymního ID.** Při převazbě se mění jen to, komu se budou přiřazovat **budoucí** události. Předchozí události zůstanou u předchozího kontaktu.

Označení `shared` (víc než 5 převazeb za 24 hodin) zastaví slučování pro tento `anonymous_id` úplně a v UI se u kontaktu zobrazí poznámka „Zařízení je sdílené více lidmi, část historie může být nepřesná."

#### 3.8.4 Slučování historie (merge)

Spouští se pg-boss jobem `identity.merge` s parametry `(workspace_id, anonymous_id, contact_id, binding_id)`.

```
merge:
  0. ověřit, že contacts.processing_restricted = false a deleted_at IS NULL;
     jinak job skončí bez práce se stavem 'skipped_restricted'
  1. vložit identity_merges(status='running', window_from = now - 30 dní, window_to = now)
  2. cyklus po dávkách 1 000 řádků:
        UPDATE web_events
           SET contact_id = :contact_id, identity_merge_id = :merge_id
         WHERE workspace_id = :ws
           AND anonymous_id = :anon
           AND contact_id IS NULL
           AND erased_at IS NULL                    -- viz 3.15.3, nikdy nekřísit vymazané
           AND occurred_at >= :window_from AND occurred_at < :window_to
           AND received_at >= :window_from                    -- prořezání partition
           AND received_at <  :window_to + interval '7 days'
           AND (id, received_at) IN (
                 SELECT id, received_at FROM web_events
                  WHERE workspace_id = :ws AND anonymous_id = :anon
                    AND contact_id IS NULL AND erased_at IS NULL
                    AND occurred_at >= :window_from AND occurred_at < :window_to
                    AND received_at >= :window_from
                    AND received_at <  :window_to + interval '7 days'
                  ORDER BY occurred_at DESC LIMIT 1000 )
     dokud se něco mění a dokud celkem < 10 000 řádků
  3. vložit řádky do web_event_months pro (contact, měsíc) ze zpracovaných dat
  4. aktualizovat contacts.last_activity_at = max(existující, poslední occurred_at)
  5. status = 'completed' (nebo 'truncated', když se narazilo na strop 10 000)
```

Limity a jejich důvod:

| Limit | Hodnota | Důvod |
|---|---|---|
| Okno zpět | 30 dní | Starší anonymní chování už nemá pro marketing hodnotu a riziko chybného přiřazení roste |
| Maximum řádků | 10 000 | Ochrana proti tomu, aby jeden merge zablokoval tabulku na minuty |
| Velikost dávky | 1 000 | Krátká transakce, žádné dlouhé zámky |
| Souběžnost jobu | 2 workery, klíč `workspace_id` | Nedeterministické překryvy |

Obě hodnoty jsou konfigurovatelné (`TRACKING_MERGE_WINDOW_DAYS`, `TRACKING_MERGE_MAX_EVENTS`). Při `truncated` se v timeline zobrazí poznámka „Starší anonymní historie nebyla připojena, protože jí bylo příliš mnoho."

Idempotence: job běží pod `identity_merges.id`. Opakované spuštění téhož jobu po restartu pokračuje tam, kde skončil, protože podmínka `contact_id IS NULL` už zpracované řádky vyloučí. Dvakrát spuštěný job tedy nezpůsobí duplicity ani chybný stav.

#### 3.8.5 Vrácení slučování

```
POST /api/v1/contacts/{contactId}/identity-merges/{mergeId}/revert
```

```
revert:
  1. identity_merges musí být ve stavu 'completed' nebo 'truncated'
  2. UPDATE web_events SET contact_id = NULL, identity_merge_id = NULL
      WHERE identity_merge_id = :merge_id           (po dávkách 1 000)
  3. status = 'reverted', reverted_at, reverted_by
  4. zápis do audit_log
```

Vrácení je úplné, protože `identity_merge_id` přesně označuje řádky, které merge změnil. Události, které přišly už s vyplněným `contact_id` (tedy po vazbě), se nevrací, protože ty k tomu kontaktu skutečně patří.

Vrátit nejde: samotnou vazbu (`identities.contact_id`). Na to slouží samostatná akce „odpojit zařízení od kontaktu", která nastaví `contact_id = NULL` a zapíše `identity_bindings` se `source = 'reset'`.

#### 3.8.6 Hraniční případy

| Situace | Chování |
|---|---|
| Prohlížeč nemá `anonymous_id`, přijde `identify` | Vytvoří se nové `anonymous_id`, vazba se založí, slučovat není co |
| `contact_id` neexistuje (smazaný kontakt) | Vazba se neuloží, událost se uloží jako anonymní, kód `contact_not_found` v logu |
| Dva různé `anonymous_id` ukazují na týž kontakt | Zcela normální (mobil a desktop). Timeline sjednocuje přes `identities_contact_idx` |
| Kontakt se sloučí s jiným kontaktem (část 2) | Část 2 musí zavolat hook `tracking.reassign_contact(from, to)`, který přepíše `identities.contact_id` a `web_events.contact_id`. Viz požadavek 12.3 |
| Odhlášení z odběru e-mailů | **Nemá vliv na identitu.** Kontakt existuje dál, jen se mu neposílá. Vazba zůstává |
| Odvolání souhlasu `analytics` | SDK přestane posílat a smaže `anonymous_id`. Řádek v `identities` zůstane, ale už se nepoužije |
| Odvolání souhlasu `personalization` | Vazba se zruší (`contact_id = NULL`), události se dál sbírají anonymně |
| Smazání kontaktu (GDPR) | Viz 3.15.3 |
| `identify` na kontakt, který je na suppression listu | Vazba se založí normálně. Suppression řídí odesílání, ne měření |
| **Kontakt má `processing_restricted = true` (GDPR čl. 18)** | **Vazba se nezaloží, slučování neproběhne, `last_activity_at` se nemění, událost se uloží anonymně.** Krok 0 v 3.8.3 |
| Kontakt má `processing_restricted = true` a vazba už existovala z dřívějška | Existující vazba se **nemaže**, ale přestane se používat: nové události se ukládají anonymně. Po zrušení omezení se vazba zase začne používat, aniž se cokoliv obnovuje |
| Kontakt je měkce smazaný (`deleted_at IS NOT NULL`) | Stejně jako u čl. 18: vazba se nepoužije, událost anonymně |
| Událost má `erased_at IS NOT NULL` a přijde nové slučování | Řádek se přeskočí. Bez toho by se historie vymazaného člověka připojila k novému kontaktu, který dostal totéž `anonymous_id` |
| Souběžné `bind` pro tentýž `anonymous_id` | Řeší `SELECT ... FOR UPDATE` v kroku 1. Druhý čeká a uvidí výsledek prvního |
| `anonymous_id` není platné UUID | Událost se odmítne s kódem `tracking_invalid_anonymous_id` |
| Někdo pošle cizí `anonymous_id` | Může tím zapsat události cizímu prohlížeči. Zmírnění: rate limit per `anonymous_id`, a hlavně to nedává útočníkovi nic přečíst |

### 3.9 Zpracování událostí

**Idempotence všech jobů této části.** Konvence části 1 říká, že `singletonKey` negarantuje, že job nepoběží znovu po pádu, takže každý job musí být idempotentní sám o sobě. Platí to pro všech pět jobů, které tahle část zavádí, a u každého je mechanismus jmenovitě uvedený:

| Job | Čím je idempotentní |
|---|---|
| `tracking.process_engagement` | Přírůstky do `campaign_stats` se počítají z přechodů `NULL` na hodnotu v `message_engagement`, ne z délky vstupu (3.9.2) |
| `event.process` | `ON CONFLICT DO NOTHING` plus dedup okno 7 dní (2.2) |
| `identity.merge` | Podmínka `contact_id IS NULL` vyloučí už zpracované řádky (3.8.4) |
| `tracking.recompute_engagement_windows` | Přepočet je čistá funkce zdrojových dat, opakování dá tentýž výsledek (3.9.4) |
| `tracking.cleanup_token_uses` | `DELETE ... WHERE expires_at < now()` (3.10.3) |

#### 3.9.1 Zapisovač pro otevření a kliknutí

Endpointy `/t/o/` a `/t/c/` nepíšou do databáze synchronně. Zapisují do bufferu v procesu.

| Vlastnost | Hodnota |
|---|---|
| Kapacita bufferu | 20 000 položek |
| Vyprázdnění | po 250 ms nebo po 500 položkách |
| Zápis | `INSERT INTO message_events` s `unnest`, jeden příkaz na dávku |
| Při plném bufferu | Nejstarší se zahodí, čítač `tracking.writer.dropped` |
| Při chybě zápisu | 3 pokusy s odstupem 100, 300, 900 ms, pak zahodit a zalogovat |
| Graceful shutdown | Vyprázdnit před ukončením, timeout 5 s |

Po zápisu do `message_events` se do pg-boss zařadí job `tracking.process_engagement` s polem ID zapsaných událostí. Job běží se souběžností 4.

#### 3.9.2 Job `tracking.process_engagement`

```
1. načíst dávku message_events podle ID
2. dohledat messages (id, campaign_id, contact_id, workspace_id, sent_at) jedním dotazem
3. doklasifikovat kliky pravidly 5 a 6 z kapitoly 3.5
4. seskupit podle message_id, spočítat přírůstky
5. UPSERT do message_engagement, RETURNING xmax = 0 a předchozí hodnoty
   (aby se poznalo, které zprávy poprvé přešly do stavu "otevřeno" nebo "prokliknuto")
6. z těch přechodů složit přírůstky do campaign_stats a campaign_link_stats
   a aplikovat je JEDNÍM UPDATE na kampaň
7. UPSERT campaign_stats_buckets pro pětiminutový blok
8. u kliků: vložit odpovídající web_events záznam s name='email_clicked',
   source='email', contact_id vyplněné (kvůli sjednocené timeline)
9. u otevření: totéž s name='email_opened', ale jen pro třídy human a proxy_image
10. aktualizovat contacts.last_activity_at
11. vypustit odchozí webhooky message.opened, message.clicked (jen třída human)
```

Krok 5 je klíčový pro správnost unikátních počtů. Přírůstek do `campaign_stats.opens_unique` se udělá **jen tehdy**, když `message_engagement.first_open_at` přešlo z `NULL` na hodnotu. To zaručí, že se jedna zpráva započítá jako unikátní otevření právě jednou, i když job poběží dvakrát.

Idempotence celého jobu: opakované spuštění s toutéž dávkou ID nezmění `campaign_stats`, protože `first_open_at` už není `NULL` a žádný přechod nevznikne. `opens_total` se ale zvýší znovu, proto se přírůstky do `*_total` počítají z **počtu skutečně vložených řádků** v kroku 1, ne z délky vstupního pole. Řádky do `message_events` se vkládají s `ON CONFLICT DO NOTHING` a `RETURNING id`.

Kontence na jednom řádku `campaign_stats`: při 500 zprávách za sekundu a dávkách po 500 událostech jde o zhruba 1 až 4 UPDATE téhož řádku za sekundu. To Postgres zvládá bez problémů. Kdyby se ukázalo jinak, řešením je shardovaný čítač (`campaign_stats_shards(campaign_id, shard, ...)` s 8 shardy a součtem při čtení). Do MVP 0 se to nedělá, ale je to připravená cesta.

#### 3.9.3 Job `event.process` pro webové události

```
1. přijmout dávku IngestEvent po validaci (dávka je jeden HTTP požadavek)
2. vyřešit identitu:
     SELECT i.contact_id, c.processing_restricted, c.deleted_at
       FROM identities i LEFT JOIN contacts c ON c.id = i.contact_id
      WHERE i.workspace_id = :ws AND i.anonymous_id = :anon
   - nalezeno a processing_restricted = false a deleted_at IS NULL
       -> doplnit contact_id na události
   - nalezeno, ale processing_restricted = true nebo kontakt smazaný
       -> contact_id se NEdoplní, událost se uloží anonymně (GDPR čl. 18)
   - nenalezeno -> vložit identities řádek s contact_id NULL
3. deduplikace proti idx_web_events__dedup v okně 7 dní, pak
   INSERT INTO web_events ... ON CONFLICT (id, received_at) DO NOTHING
4. INSERT INTO web_event_months ... ON CONFLICT DO NOTHING
5. UPDATE identities SET last_seen
6. UPDATE contacts.last_activity_at (jen když je contact_id, jen když se liší o víc než 60 s,
   a nikdy u kontaktu s processing_restricted = true)
7. zařadit job segments.recalc_for_contact (část 2), když je contact_id
8. (MVP 2) vyhodnotit triggery automatizací
```

Kroky 2 až 6 běží v jedné transakci. Ingestion endpoint na ně **nečeká**, vrací `202` hned po validaci a po zařazení jobu. Cílová latence endpointu je p99 ≤ 40 ms.

Krok 6 s prahem 60 sekund brání tomu, aby aktivní návštěvník generoval desítky UPDATE na jeden řádek kontaktu.

#### 3.9.4 Údržba `contact_engagement`

Dvě části, protože jedna se nedá dělat tak jako druhá.

**a) Přírůstková část, běží v `tracking.process_engagement` a v `tracking.process_provider_events`.**

Pro každou dotčenou zprávu se spočítá, co se změnilo, a aplikuje se jedním upsertem na kontakt:

```
při delivered:  delivered_total += 1, last_delivered_at = max(...)
                sent_total += 1, last_sent_at = max(...)
                consecutive_no_open  += 1      -- optimisticky, viz níž
                consecutive_no_click += 1
při open (třída human nebo proxy_image, jen první na zprávu):
                opens_total += 1, last_open_at = max(...)
                consecutive_no_open = 0
při click (třída human, jen první na zprávu):
                clicks_total += 1, last_click_at = max(...)
                consecutive_no_click = 0
při bounce:     bounces_total += 1, last_bounce_at = max(...)
```

**`consecutive_no_open` se zvyšuje při doručení a nuluje při otevření.** Pořadí událostí je proto podstatné a nedá se zaručit: otevření dorazí typicky minuty až hodiny po doručení, ale u Apple proxy dorazí často **dřív**, než SNS doručí `delivered`. Kdyby se čítač nuloval a pak zvýšil, kontakt, který otevřel, by vypadal jako neotvírající.

Řešení: nulování má přednost před zvýšením a rozhoduje se podle času, ne podle pořadí zpracování. Konkrétně se `consecutive_no_open` zvýší jen tehdy, když u dané zprávy **neexistuje** řádek `message_engagement` s `first_human_open_at IS NOT NULL`. Protože obojí zpracovává tentýž job nad `message_engagement`, je ta informace po ruce a nestojí další dotaz.

Zbývá případ, kdy otevření dorazí až po zpracování doručení. Ten řeší nulování: jakmile otevření přijde, čítač jde na nulu bez ohledu na to, kolik byl. Preset „neotevřel posledních 5 kampaní" tedy může být na pár minut nepřesný směrem nahoru a pak se sám opraví. To je přijatelné, protože presety čištění nikdo nespouští v reálném čase.

**b) Přepočet klouzavých oken, job `tracking.recompute_engagement_windows`.**

Tohle je ta část, kterou návrh části 2 neřeší a bez které by čísla byla trvale špatná. Okna 7, 30 a 90 dní **nejde udržovat přičítáním**, protože hodnota klesá i tehdy, když se nic neděje: kontakt s pěti otevřeními před 91 dny musí mít `opens_90d = 0`, aniž přišla jakákoliv událost.

```
běží každý den ve 04:15 UTC, po retenci
1. vybrat kandidáty:
     SELECT workspace_id, contact_id FROM contact_engagement
      WHERE windows_recomputed_at < now() - interval '20 hours'
        AND (sent_90d > 0 OR opens_90d > 0 OR clicks_90d > 0)
      ORDER BY windows_recomputed_at
      LIMIT 5000
2. pro dávku spočítat okna jedním dotazem nad message_engagement
   s omezením created_at >= now() - interval '90 days'  (partition pruning)
3. UPDATE contact_engagement ... windows_recomputed_at = now()
4. opakovat, dokud kandidáti jsou, nejvýš 200 dávek za běh
```

Částečný index `idx_contact_engagement__stale_windows` je tu klíčový: kontakt, který za 90 dní nedostal nic, má všechna okna na nule, do indexu nepatří a job se ho nedotkne. Přepočítávají se jen aktivní kontakty.

| Limit | Hodnota | Důvod |
|---|---|---|
| Velikost dávky | 5 000 kontaktů | Krátká transakce, žádné dlouhé zámky |
| Dávek na jeden běh | 200, tedy milion kontaktů | Strop doby běhu |
| Práh čerstvosti | 20 hodin | Aby denní běh nepřeskočil kontakt kvůli posunu času startu |
| Maximální stáří hodnoty v okně | 24 hodin | Zobrazuje se v UI u presetů jako „data k dnešní 4:15" |

**Nepřesnost, kterou to znamená a která musí být v UI vidět:** okna jsou aktuální k poslednímu nočnímu běhu, ne k této vteřině. Preset „neaktivní 90+ dní" tedy může obsahovat kontakt, který se ozval dnes ráno. Absolutní hodnoty (`last_open_at`, `consecutive_no_open`, `*_total`) jsou naopak vždy aktuální, protože se udržují přírůstkově. Presety proto stavím **primárně na absolutních hodnotách** a okna používám jen tam, kde jinak nejde (například „otevřel aspoň 3 z posledních 30 dní"). Požadavek 12.4.6.

**Rekonstrukce po havárii.** Když se `contact_engagement` rozejde s realitou (chyba v jobu, obnovená záloha), je zdrojem pravdy `message_engagement` a `message_events`. Existuje příkaz `oe rebuild-engagement --workspace <id>`, který tabulku přepočítá od nuly po dávkách. Při 5 milionech kontaktů běží řádově desítky minut a nezastavuje provoz, protože píše jen do `contact_engagement`.

### 3.10 Předání identity z kliku v mailu

#### 3.10.1 Sekvence

```
1. Prohlížeč    GET /t/c/<token type='c'>
2. Aplikace     ověří token, najde cíl podle link_id, zapíše klik do bufferu
3. Aplikace     host cíle je v tracking_domains a click_class='human'
                -> dohledá contact_id (3.4.6 krok 7)
                -> vyrobí token type='i' (workspace_id, contact_id, campaign_id,
                                          nonce z CSPRNG, expires_at = now + 15 min)
4. Aplikace     302 -> https://shop.cz/vyprodej?oe_token=t1aQEB...
5. Prohlížeč    načte stránku, načte SDK
6. SDK          souhlas analytics i personalization udělený? ne -> token se zahodí, konec
7. SDK          přečte oe_token z location.search
8. SDK          history.replaceState s adresou bez oe_token   (HNED, před odesláním)
9. SDK          POST /e/identify { key, anonymous_id, token }
10. Aplikace    ověří token type='i' včetně expires_at
11. Aplikace    Origin hlavička odpovídá některé tracking_domains daného workspace?
12. Aplikace    INSERT INTO identity_token_uses (nonce) -> konflikt znamená použitý token
13. Aplikace    bind(workspace_id, anonymous_id, contact_id, 'email_click',
                     evidence = { campaign_id }) podle 3.8.3, případně naplánuje merge
14. Aplikace    202 { "ok": true }
15. SDK         vyvolá událost 'identified' (bez jakýchkoliv dat o kontaktu)
```

Krok 8 se dělá **před** krokem 9 schválně: kdyby uživatel stránku sdílel nebo kdyby se adresa dostala do analytiky třetí strany, token už tam nebude. `replaceState` nevytváří položku v historii, takže tlačítko zpět funguje normálně.

**Krok 11 je slabší, než by měl být.** Token podle kontraktu 4.10.3 neváže cílový host, takže se nedá ověřit, že se spotřebovává přesně na té doméně, na kterou byl vydaný. Ověřuje se jen to, že `Origin` je **některá** z registrovaných domén daného workspace. Když má zákazník registrované `shop.cz` i `blog.shop.cz`, token vydaný pro první jde spotřebovat na druhé. Praktický dopad je malý, protože obě domény patří témuž zákazníkovi. Návrh na doplnění vazby na host je v 13.8.

Krok 12 zajišťuje jednorázovost. Unikátní primární klíč na `nonce` znamená, že souběžné pokusy o spotřebování skončí právě jedním úspěchem.

Krok 13: `contact_id` je přímo v tokenu, takže se nikam nesahá. Cenou je, že `contact_id` prošlo adresním řádkem prohlížeče, viz 13.8. Odpověď v kroku 14 o kontaktu neprozradí nic.

**Evidence vazby je `campaign_id`, ne `message_id`**, protože token nese kampaň. V timeline se proto u položky „identifikováno z kliku" zobrazí kampaň, ne konkrétní zpráva. Je to malá ztráta oproti původnímu návrhu a stojí za zmínku jen proto, aby ji někdo nehledal jako chybu.

#### 3.10.2 Platnost a chybové stavy

Kódy jsou z katalogu části 1, 4.10.3 a 4.2. Nové nezavádím.

| Situace | HTTP | `code` | Co udělá SDK |
|---|---|---|---|
| Token vypršel | 410 | `token_expired` | Tiše pokračuje anonymně, vyvolá `error` v debug režimu |
| Token už byl použit | 409 | `token_already_used` | Tiše pokračuje |
| `Origin` není registrovaná doména workspace | 403 | `origin_not_allowed` | Tiše pokračuje |
| Neplatný podpis nebo tvar | 400 | `token_signature_invalid`, `token_malformed` | Tiše pokračuje |
| Token jiného typu než `i` | 400 | `token_type_mismatch` | Tiše pokračuje |
| Neznámý `key_id` | 400 | `token_unknown_key` | Tiše pokračuje |
| Kontakt mezitím smazaný | 202 | žádný, `{"ok": false, "reason": "contact_not_found"}` | Tiše pokračuje |
| Souhlas není udělený | token se ani neodešle | | |

Ve všech chybových případech uživatel na webu nic nepozná. Tracking pokračuje anonymně.

**Platnost 15 minut** pokrývá scénář „kliknu, načte se stránka". Nepokrývá „kliknu, odložím telefon, za hodinu se vrátím" (pak se stránka načítá znovu z historie a token je pryč). Delší platnost by znamenala větší okno pro zneužití adresy s tokenem, například z historie prohlížeče na sdíleném počítači. Hodnota je konfigurovatelná `TRACKING_IDENTITY_TOKEN_TTL_SECONDS` v rozsahu 60 až 3600.

#### 3.10.3 Úklid `identity_token_uses`

Job `tracking.cleanup_token_uses` běží každou hodinu a maže řádky s `expires_at < now()`. Tabulka tak zůstane malá: při 100 000 kliků za hodinu má maximálně 25 000 řádků (15 minut platnosti).

### 3.11 Katalog metrik

#### 3.11.1 Základní počty

Všechny se čtou z `campaign_stats`, tedy z předpočítaných čísel.

| Metrika | Klíč | Definice | Zdroj |
|---|---|---|---|
| Publikum | `materialized` | Počet řádků vytvořených v outboxu při materializaci | část 4a |
| Odesláno | `sent` | Zprávy, které provider přijal (`messages.status = 'sent'`) | část 4a |
| Nedoručitelné před odesláním | `skipped` | Vyloučeno suppression listem nebo odhlášením při odesílání | část 4a |
| Selhalo | `failed` | Provider zprávu trvale odmítl | část 4a |
| Doručeno | `delivered` | Počet zpráv s událostí `delivered`. U SMTP bez zpětné vazby se rovná `sent` | část 4a |
| Tvrdé odmítnutí | `bounced_hard` | Zprávy s událostí typu hard bounce | část 4a |
| Měkké odmítnutí | `bounced_soft` | Zprávy s událostí typu soft bounce | část 4a |
| Stížnost | `complained` | Zprávy s událostí complaint | část 4a |
| Odhlášení | `unsubscribed` | Kontakty, které se odhlásily s atribucí na tuto kampaň | část 2 |

**Definice doručení pro výpočty:** `delivered_effective = max(sent - bounced_hard - bounced_soft - failed, 0)` když provider události o doručení neposílá, jinak `delivered`. Který ze dvou způsobů se použil, se ukazuje v UI jako poznámka pod tabulkou, aby uživatel věděl, odkud číslo je.

#### 3.11.2 Otevření

| Metrika | Klíč | Přesná definice |
|---|---|---|
| Otevření celkem | `opens_total` | Počet **událostí** typu open s třídou `human`, `proxy_apple`, `proxy_image` nebo `unknown`, po deduplikaci opakovaných stažení do 180 s (viz 3.3.5) |
| Unikátní otevření | `opens_unique` | Počet **zpráv**, u kterých existuje alespoň jedna taková událost. Tedy `count(message_engagement WHERE first_open_at IS NOT NULL)` |
| Ověřená otevření | `opens_unique_human` | Počet zpráv s `first_human_open_at IS NOT NULL`, tedy alespoň jedno otevření třídy `human` nebo `proxy_image` |
| Automatická otevření | `opens_unique_apple` | Počet zpráv, kde `open_class_mask` obsahuje bit `proxy_apple` a **neobsahuje** bity `human` ani `proxy_image` |

Vztah: `opens_unique >= opens_unique_human + opens_unique_apple`. Rozdíl tvoří zprávy otevřené jen se třídou `unknown`.

| Míra | Vzorec | Poznámka pro UI |
|---|---|---|
| Míra otevření | `opens_unique / delivered_effective` | Zobrazuje se jako „Otevření celkem", vždy s vysvětlivkou |
| Podíl automatických | `opens_unique_apple / opens_unique` | Zobrazuje se jako „z toho pravděpodobně automatická" |
| Ověřená míra otevření | `opens_unique_human / (delivered_effective - opens_unique_apple)` | Jmenovatel vylučuje příjemce, u kterých měření prokazatelně nefunguje |

Ověřená míra otevření má **jiný jmenovatel** a to je nutné v UI napsat. Kdyby se počítala z `delivered_effective`, systematicky by podstřelovala, protože Apple uživatelé by byli ve jmenovateli, ale nikdy v čitateli.

Když `delivered_effective - opens_unique_apple < 50`, ověřená míra se **nezobrazuje** a místo ní je text „málo dat pro ověřený odhad".

#### 3.11.3 Prokliky

| Metrika | Klíč | Přesná definice |
|---|---|---|
| Prokliky celkem | `clicks_total` | Počet událostí click s třídou `human` |
| Unikátní prokliky | `clicks_unique` | Počet zpráv s `first_click_at IS NOT NULL` (jakákoliv třída) |
| Ověřené prokliky | `clicks_unique_human` | Počet zpráv s `first_human_click_at IS NOT NULL` |
| Strojové prokliky | `clicks_scanner` | Počet událostí click s třídou `scanner`, `bot` nebo `prefetch` |

| Míra | Vzorec |
|---|---|
| Míra prokliku (CTR) | `clicks_unique_human / delivered_effective` |
| Míra prokliku z otevření (CTOR) | `clicks_unique_human / opens_unique_human` |
| Míra odhlášení | `unsubscribed / delivered_effective` |
| Míra odmítnutí | `(bounced_hard + bounced_soft) / sent` |
| Míra stížností | `complained / delivered_effective` |

**Rozhodnutí o jmenovateli:** míra prokliku se počítá z **doručených**, ne z odeslaných a ne z otevřených. Doručené je nejstabilnější jmenovatel, protože se nemění s tím, jak se chovají poštovní klienti. Je to i to, co dělá Campaign Monitor, Mailchimp a většina oboru, takže se čísla dají srovnávat s benchmarky.

**CTOR se počítá z ověřených otevření, ne ze všech.** Kdyby se počítal ze všech, Apple by ho uměle stlačil dolů (jmenovatel nafouknutý, čitatel ne) a uživatel by si myslel, že má špatný obsah. Toto je jedno z míst, kde nesprávná definice metriky přímo vede k chybnému produktovému rozhodnutí.

Míra odmítnutí se počítá z `sent`, ne z `delivered_effective`, protože odmítnuté zprávy z definice doručené nejsou.

#### 3.11.4 Zaokrouhlení a zobrazení

| Pravidlo | Hodnota |
|---|---|
| Procenta | Jedno desetinné místo, `cs-CZ` používá desetinnou čárku |
| Jmenovatel nula | Zobrazí se pomlčka, ne `0 %` a ne `NaN` |
| Jmenovatel pod 200 | Zobrazí se absolutní počty, procenta jsou v našeptávači s poznámkou „malý vzorek" |
| Počty | Oddělovač tisíců podle locale |
| Neúplná data (kampaň se odesílá) | U všech čísel se zobrazí indikátor „průběžné" |

#### 3.11.5 Statistika odkazů

`campaign_link_stats` plus `campaign_links.url`. V UI se seřadí sestupně podle `clicks_human`. Když má kampaň dva různé odkazy se stejnou URL (obrázek a text pod ním), zobrazují se jako dva řádky s poznámkou, protože se tím dá poznat, co lidé klikají.

Metrika `link_share = clicks_human / suma clicks_human všech odkazů`.

### 3.12 Customer timeline

#### 3.12.1 Co timeline obsahuje

Jedna sjednocená časová osa. Zdroje:

| Zdroj | Typy položek | Tabulka |
|---|---|---|
| E-mail | `message_sent`, `message_delivered`, `message_opened`, `message_clicked`, `message_bounced`, `message_complained` | `message_events` |
| Web | `page_view`, `session_started` a vlastní události zákazníka | `web_events` |
| Kontakt | `contact_created`, `list_subscribed`, `list_unsubscribed`, `consent_changed` | část 2 |
| Automatizace (MVP 2) | `automation_entered`, `automation_step`, `automation_exited` | část 4 |

Do timeline se **nezobrazuje** třída `bot`, `scanner` ani `prefetch`. Automatická otevření (`proxy_apple`) se zobrazují, ale s ikonou a popiskem „automatické stažení poštovním klientem, nemusí znamenat skutečné otevření". Toto je hlavní místo, kde uživatel pochopí, proč jsou čísla nespolehlivá, protože to vidí na konkrétním člověku.

#### 3.12.2 Dotaz a stránkování

Stránkování je **keyset**, ne offset, podle konvence 4.3 části 1. Kurzor je neprůhledný base64url řetězec nesoucí dvojici `(occurred_at, id)`.

```sql
-- Webová část, jedna z větví UNION ALL.
SELECT occurred_at, id, 'web' AS src, name, page, properties, session_id
  FROM web_events
 WHERE workspace_id = $1
   AND contact_id  = $2
   AND occurred_at >= $3 AND occurred_at < $4              -- okno, které chce uživatel
   AND received_at >= $3                                    -- prořezání partition
   AND received_at <  $4 + interval '7 days'                -- zpoždění offline fronty
   AND (occurred_at, id) < ($5, $6)                         -- kurzor
 ORDER BY occurred_at DESC, id DESC
 LIMIT 51;                                                  -- o jednu víc kvůli has_more
```

Dvojice podmínek na `occurred_at` a `received_at` je povinná. První říká, co uživatel chce vidět, druhá je jediná, která prořezává partition. Test v CI kontroluje na `EXPLAIN`, že se u timeline dotazu neobjeví víc prohledaných partition, než kolik jich vrátí `web_event_months`.

Totéž pro `message_events` a pro události kontaktu. Výsledky se slijí a seřadí v aplikaci, protože každá větev je už seřazená a stačí trojcestné slévání. `UNION ALL` s `ORDER BY` v jednom SQL by Postgres přinutil seřadit celý mezivýsledek.

Parametry `$3` a `$4` (okno) se určují takto:

1. Přečte se `web_event_months` pro `(workspace_id, 'contact', contact_id)` a vezme se seznam měsíců s daty. Dotaz je index-only scan nad malou tabulkou, řádově desítky mikrosekund.
2. Timeline načítá po **měsících sestupně**, jen ty, které v seznamu jsou.
3. Když jeden měsíc nedá dost položek, přejde se na další v seznamu.

Bez kroku 1 by dotaz na kontakt se třemi měsíci historie musel projít 26 měsíčních partition, každou s jedním index scanem, tedy 26 zbytečných přístupů. S ním jsou to 3.

| Parametr | Hodnota |
|---|---|
| Velikost stránky | 50, maximum 200 |
| Výchozí okno | Posledních 12 měsíců, tlačítko „načíst starší" |
| Maximum měsíců na jeden požadavek | 3 |
| Timeout dotazu | 3 s, pak `504` s kódem `dependency_timeout` |

#### 3.12.3 Výkon při sto milionech událostí

Předpoklad: 100 000 000 řádků `web_events`, 26 měsíčních partition, tedy zhruba 4 miliony řádků na partition.

| Dotaz | Plán | Odhad |
|---|---|---|
| Timeline kontaktu, první stránka | 1 až 3 index scany nad `web_events_contact_ts_idx` v 1 až 3 partition, každý vrátí ≤ 51 řádků | < 10 ms |
| Timeline kontaktu, hluboká stránka (rok zpět) | Totéž, protože keyset kurzor se přeloží na `occurred_at` a okno partition na `received_at` | < 10 ms |
| `web_event_months` pro kontakt | Index-only scan, ≤ 26 řádků | < 1 ms |
| Anonymní timeline před spojením | `web_events_anon_ts_idx` | < 10 ms |
| Report kampaně | Jeden řádek `campaign_stats` podle PK | < 1 ms |
| Graf průběhu kampaně | ≤ 288 řádků `campaign_stats_buckets` | < 5 ms |
| Statistika odkazů | ≤ 200 řádků `campaign_link_stats` | < 5 ms |

Co je z toho nutné ověřit měřením, ne odhadem: chování při 100+ partition (retence 120 měsíců), kde už samotné plánování dotazu stojí měřitelný čas. Proto je maximum retence 120 měsíců a doporučená hodnota 26.

**Kde to praskne dřív:** ne u čtení timeline, ale u zápisu. Při 2 000 událostech za sekundu je to 2 000 řádků do `web_events` plus indexy, tedy zhruba 5 zápisových operací na událost. To je horní hranice pro jeden běžný server. Nad ní je potřeba buď zvětšit dávkování (přidat frontu s agregací), nebo přijmout vzorkování `page_view` událostí.

### 3.13 Realtime aktualizace

#### 3.13.1 Problém: SSE proti limitu šesti spojení v HTTP/1.1

Původní návrh (a hlavní specifikace, kapitola 8, track D) počítal s SSE. Při revizi části 1 vyplynula překážka, která SSE jako výchozí řešení vylučuje.

Prohlížeče drží v HTTP/1.1 nejvýše **6 souběžných TCP spojení na jeden původ**. SSE spojení se z principu nikdy neuzavře, takže trvale obsadí jeden slot. Uživatel se třemi otevřenými kartami reportu obsadí tři z šesti slotů a zbytek aplikace (načítání stránek, API volání, obrázky) se tísní ve třech. Se šesti kartami se aplikace v té doméně **zastaví úplně**, protože žádný další požadavek nemá kudy odejít. Není to teoretický problém, je to klasická past SSE a projeví se přesně u toho typu uživatele, kterého chceme, tedy u marketéra, který si otevře několik kampaní vedle sebe.

HTTP/2 to řeší multiplexem: jedno TCP spojení nese stovky souběžných streamů a limit šesti neplatí. Jenže **tohle je self-hosted produkt**. Výchozí instalace podle kapitoly 9 hlavní specifikace je `docker compose up` s Next.js serverem, který mluví HTTP/1.1. Jestli před ním stojí reverzní proxy s TLS a HTTP/2, závisí na uživateli a my to nemůžeme předpokládat ani vynutit.

Zvažované varianty:

| Varianta | Proč ne, nebo proč ano |
|---|---|
| HTTP/2 jako tvrdý požadavek na nasazení | **Ne.** Rozporuje slib „docker compose up a do pěti minut běží použitelný nástroj". Znamenalo by to vyžadovat TLS a reverzní proxy jako podmínku funkčnosti, ne jako doporučení |
| Jen polling, SSE vůbec | Funguje všude, ale při 100 uživatelích a intervalu 2 s je to 50 požadavků za sekundu jen na obnovu čísel |
| SSE s detekcí protokolu, jinak polling | **Ano**, viz níže |
| WebSocket | Limit šesti spojení sice neplatí, ale je to další protokol, další konfigurace proxy a obousměrný kanál, který nepotřebujeme |
| Jedno sdílené spojení přes `SharedWorker` | Sníží počet spojení na jedno na prohlížeč, ale `SharedWorker` nepodporuje Safari na iOS a je to netriviální kód |

#### 3.13.2 Rozhodnutí

**Živé aktualizace mají dva režimy a přepínají se automaticky. Výchozí a vždy funkční je polling. SSE se použije jen tam, kde je prokazatelně bezpečné.**

```
1. Klient zjistí protokol spojení:
     performance.getEntriesByType('navigation')[0].nextHopProtocol
   Hodnoty 'h2' a 'h3' znamenají multiplexované spojení.
2. Je to h2 nebo h3?  ANO -> režim SSE
                      NE  -> režim polling
3. Nezávisle na režimu: v rámci jednoho prohlížeče drží spojení jen JEDNA karta
   (volba vůdce přes BroadcastChannel) a ostatním karty přeposílá výsledek.
```

Krok 3 je levný (asi 40 řádků) a řeší i zbytek problému: i v režimu SSE nad HTTP/2 drží deset otevřených karet jedno spojení, ne deset. `BroadcastChannel` podporují všechny cílové prohlížeče včetně Safari. Když není k dispozici, karta si prostě otevře vlastní spojení.

`nextHopProtocol` je součástí Resource Timing a pro navigační záznam na vlastním původu je vždy vyplněný (omezení `Timing-Allow-Origin` se týká cizích původů). Prázdná hodnota se vyhodnocuje jako „ne", tedy bezpečně směrem k pollingu.

| Vlastnost | Režim polling | Režim SSE |
|---|---|---|
| Endpoint | `GET /api/v1/campaigns/{id}/stats` | `GET /api/v1/campaigns/{id}/stream` |
| Interval při `status = 'sending'` | 3 s | průběžně, kontrola změny po 2 s |
| Interval jinak | 30 s | totéž |
| Zastavení | Karta skrytá (`visibilitychange`) nebo kampaň dokončená 5 minut | Totéž plus strop 30 minut |
| Levný „beze změny" | `ETag` z `campaign_stats.version`, odpověď `304` bez těla | Server prostě nic nepošle |
| Spojení na prohlížeč | 0 trvalých | nejvýše 1 |

Polling s `ETag` je podstatně levnější, než se zdá: odpověď `304` nemá tělo a serverová práce je jedno čtení řádku podle primárního klíče. Při 100 uživatelích a intervalu 3 s je to 33 dotazů za sekundu na indexovaný jednořádkový select, což je zanedbatelné.

**Kde se živé aktualizace používají:** výhradně na obrazovce průběhu odesílání a na reportu kampaně ve stavu `sending`. Nikdy na dashboardu, nikdy na seznamech, nikdy na obrazovce, kterou uživatel jen prohlíží. Toto omezení je stejně důležité jako volba protokolu, protože bez něj by i polling zatěžoval server zbytečně.

Pravidlo z části 1, sekce 5.4, platí beze změny: **žádná obrazovka nesmí být závislá na živém spojení pro základní funkci.** Když obojí selže, stránka funguje a jen se neaktualizuje sama; uživatel má tlačítko Obnovit.

#### 3.13.3 Endpoint SSE

```
GET /api/v1/campaigns/{id}/stream          Accept: text/event-stream
```

Hlavičky odpovědi:

```
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-store, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

`X-Accel-Buffering: no` je nutné, aby nginx nebufferoval odpověď a události chodily hned.

Zprávy:

```
event: stats
id: 4711
data: {"version":4711,"sent":12043,"delivered":11890,"opens_unique":3120}

: heartbeat
```

| Parametr | Hodnota |
|---|---|
| Interval kontroly změny | 2 s |
| Heartbeat (komentářový řádek) | 15 s |
| Maximální doba spojení | 30 minut, pak `event: end` a uzavření |
| Maximum spojení na session | 2 |
| Maximum spojení na instanci | `TRACKING_SSE_MAX_CONNECTIONS`, výchozí 500; nad limit `503` a klient přejde na polling |
| Reconnect | Prohlížeč sám, `Last-Event-ID` obsahuje `version` |

Server neposílá zprávu, když se `campaign_stats.version` nezměnila. Při 100 souběžných uživatelích na jedné kampani se dělá **jeden** dotaz za 2 sekundy, ne 100: v procesu běží jeden poller na kampaň a připojení se na něj přihlašují. Poller se ukončí, když nemá odběratele.

Po `campaign.status = 'sent'` a 5 minutách bez změny se stream ukončí zprávou `event: end`.

**Endpoint je pod `/api/v1/**`, takže podléhá autentizaci session nebo API klíčem a rate limitům z 4.5 části 1.** Streamovaná odpověď v Next.js vyžaduje Node.js runtime, což je podle části 1, 3.9 a R6, jediný podporovaný runtime.

#### 3.13.4 Chování při odpojení

`EventSource` se automaticky připojí znovu s `Last-Event-ID`. Server odpoví aktuálním stavem, protože stav je vždy úplný snapshot, ne přírůstek. Historie se nedohání, není co dohánět.

Když se nepodaří připojit třikrát po sobě, klient **trvale** (do reloadu stránky) přejde na polling a zobrazí indikátor stavu z části 1, sekce 5.2, ve stavu „obnovuje se". Do UI se nepíše žádná chybová hláška, protože z pohledu uživatele se nic nerozbilo.

Indikátor spojení je sdílená komponenta z části 1 (5.4) a má tři stavy: připojeno, obnovuje se, odpojeno. V režimu polling se zobrazuje jako „připojeno", protože z pohledu uživatele se čísla aktualizují.

---

### 3.14 Partitioning

#### 3.14.1 Infrastrukturu vlastní část 1

Partitioning je konvence z části 1, sekce 2.1, a údržbu dělá její job `platform.maintain_partitions`. Tato část nezakládá vlastní mechanismus a neopakuje pravidla. Shrnutí toho, co z části 1 platí a co z toho pro tracking plyne:

| Pravidlo části 1 (2.1) | Důsledek pro tuto část |
|---|---|
| Partiční klíč je čas, který generujeme my (`received_at`), ne hodnota od třetí strany | `web_events` má `received_at` jako klíč a `occurred_at` jako řadicí sloupec, viz 2.2 |
| PK musí obsahovat partiční klíč, tedy `(id, received_at)` | Deduplikace se proto dělá aplikačně v okně 7 dní, viz 2.2 |
| Pojmenování `<tabulka>_yYYYYmMM` | `web_events_y2026m08` |
| Job `platform.maintain_partitions` denně ve 02:00 UTC, tři měsíce dopředu | Vlastní job `db.maintain_partitions` z původního návrhu **zrušen** |
| Stejná logika synchronně při startu aplikace | Čerstvá instalace má partition ihned |
| Výchozí partition (`DEFAULT`) se nezakládá | Čas události se v 3.7.2 ořezává tak, aby partition vždy existovala |
| Odpojení a smazání staré partition dělá retenční job vlastníka tabulky | Retenční politiku dodávám v 3.15, je to požadavek P5-4 z části 1 |
| DDL partition generuje výhradně `createMonthlyPartitions` v `packages/db` | Nepíšu vlastní generátor |

Rozhodnutí **nepoužívat `pg_partman`** je společné a část 1 ho zdůvodňuje stejně: je to rozšíření databáze, jeho instalace vyžaduje superuživatele a rozporovalo by to slib „připoj si vlastní Postgres".

#### 3.14.2 Partitionované tabulky této části

| Tabulka | Partiční klíč | Granularita | Retence |
|---|---|---|---|
| `web_events` | `received_at` (náš čas přijetí) | měsíc | `TRACKING_RETENTION_MONTHS`, výchozí 26 |
| `message_engagement` | `created_at` (= `messages.created_at`) | měsíc | totéž |
| `message_events` (vlastní část 4a) | `created_at` | měsíc | totéž, viz požadavek 12.2.11 |

Měsíční granularita, ne denní. Denní by při retenci 26 měsíců znamenalo 790 partition, což už měřitelně zpomaluje plánování dotazů. Měsíční dává 26 partition, tedy bezpečně v pásmu, kde je režie zanedbatelná.

**Odpovědi na P5-4 z části 1:** výchozí retence je **26 měsíců** pro `web_events` i `message_events`, konfigurační proměnná je `TRACKING_RETENTION_MONTHS`, povolený rozsah 3 až 120. Odůvodnění čísla je v 3.15.1.

`message_engagement` a `message_events` musí mít **stejnou** retenci jako `messages` (část 4a), jinak zůstanou statistiky bez zpráv nebo naopak. Viz požadavek 12.2.11.

### 3.15 Retence a GDPR operace

#### 3.15.1 Nastavení retence

Per workspace, v `workspaces.settings`:

```ts
type TrackingRetention = {
  web_events_months: number;        // výchozí 26, rozsah 3 až 120
  message_events_months: number;    // výchozí 26, rozsah 3 až 120
  anonymous_identities_days: number; // výchozí 400, rozsah 30 až 1095
};
```

Retence je **per instance, ne per workspace**, protože partition jsou společné pro celou databázi. Efektivní retence je maximum přes všechny workspace. Nastavení per workspace se realizuje **mazáním řádků** v rámci partition, ne dropem partition. To je pomalejší, ale běží to v noci po dávkách.

Pro MVP 0 se nabízí jen globální nastavení `TRACKING_RETENTION_MONTHS`. Per workspace retence je poznamenaná jako otevřená otázka, viz 14.

#### 3.15.2 Job `tracking.enforce_retention`

Běží denně ve 03:45 UTC, po `platform.maintain_partitions` (část 1) a před `tracking.recompute_engagement_windows`.

```
1. smazat identities bez contact_id, kde last_seen < now - anonymousIdentitiesDays
2. smazat identity_bindings starší než retence webových událostí
3. smazat web_event_months pro měsíce, které už nemají partition
4. smazat identity_merges ve stavu completed starší než 12 měsíců
5. slít campaign_stats_buckets starší než 30 dní z 5minutových do hodinových
6. smazat contact_engagement kontaktů, které už neexistují (pojistka, běžně to řeší ON DELETE CASCADE)
```

Anonymní identity bez vazby na kontakt se mažou po 400 dnech, což odpovídá životnosti cookie. Nemá smysl držet záznam o prohlížeči, který se za víc než rok neozval.

#### 3.15.3 Smazání kontaktu

Vlastní to část 2 (její 4.14.4) a volá hook `tracking.erase_contact(contact_id, mode)` z jobu `gdpr.sever_links`.

**Režimy jsou `anonymize` a `purge`, ne `anonymize` a `delete`.** Původní verze měla `delete`, který události mazal. To bylo špatně dvakrát: část 2 hodnotu `delete` nikdy nepošle, takže by hook dostal argument, který nezná, a hlavně **události se v žádném režimu nemažou**. Rozhodnutí části 2 přebírám i s odůvodněním: report, jehož čísla se zpětně mění, je k ničemu, a událost bez vazby na osobu je statistický údaj, ne osobní údaj.

**V obou režimech dělá tracking totéž.** Rozdíl mezi `anonymize` a `purge` je výhradně v tabulkách části 2 (`purge` navíc fyzicky maže řádek `contacts`). Píšu to nahlas, aby nikdo neimplementoval rozdíl, který tam být nemá.

| Objekt | `anonymize` | `purge` |
|---|---|---|
| `web_events.contact_id` | `NULL`, zároveň `erased_at = now()` | totéž |
| `web_events.anonymous_id` | **zůstává** | zůstává |
| `web_events.page`, `properties`, `context` | pročistí se klíče z `TRACKING_PII_PROPERTY_KEYS` | totéž |
| `message_engagement.contact_id` | `NULL` | totéž |
| `identities` | smazáno | smazáno |
| `identity_bindings` | smazáno | smazáno |
| `identity_merges` | smazáno | smazáno |
| `web_event_months` pro kontakt | smazáno | smazáno |
| `contact_engagement` | smazáno | smazáno |
| `campaign_stats` a `campaign_stats_buckets` | **nemění se** | nemění se |

**Proč `erased_at` a ne jen `contact_id = NULL`.** Dva důvody, oba nutné:

1. **`CHECK` constraint.** Serverová událost má vyplněné jen `contact_id`. Bez `erased_at` by po jeho vynulování porušila `ck_web_events__subject` a `UPDATE` by skončil chybou `23514`. Podrobně v 2.2.
2. **Ochrana proti vzkříšení.** `anonymous_id` v události zůstává (část 2 jeho odstranění nežádá a je to identifikátor prohlížeče, ne osoby). Kdyby se týž prohlížeč později navázal na **jiný** kontakt, slučování historie podle 3.8.4 by mu vymazané události připsalo. `erased_at IS NULL` je v podmínce slučování právě proto.

**Proč `anonymous_id` zůstává.** Vazba na osobu je přeťatá, protože `identities` je smazané a `erased_at` brání novému navázání. Samotné `anonymous_id` je náhodné UUIDv4 bez časové složky (2.2 a 3.6.4), takže po smazání `identities` neukazuje na nic. Jestli to stačí jako anonymizace podle GDPR, je právní otázka, ne technická, a je v kapitole 14 jako otázka 2.

**Průběh.** Job běží po dávkách 1 000 řádků, je idempotentní (opakované spuštění nic nezmění, protože `erased_at` už je vyplněné) a po restartu jde spustit znovu. Postupuje po měsících pozpátku podle `web_event_months`, takže se nedotkne partition, ve kterých kontakt data nemá.

**Co tracking při výmazu nedělá:** nemaže `message_events`. Ty vlastní část 4a a odstřižení vazby v nich je na ní (`messages.contact_id = NULL` podle její tabulky). Já z nich jen čtu.

#### 3.15.4 Export dat subjektu

Část 2 vlastní formát exportu a volá `tracking.export_contact(contact_id)`, které vrátí:

```ts
type TrackingExport = {
  identities: { anonymous_id: string; first_seen: string; last_seen: string }[];
  web_events: { occurred_at: string; name: string; page?: EventPage;
                properties?: Record<string, unknown> }[];   // stránkovaně, po 10 000
  email_events: { occurred_at: string; type: string; campaign_name: string;
                  link_url?: string; open_class?: OpenClass }[];
};
```

Export **neobsahuje** interní identifikátory zpráv ani tokeny.

### 3.16 Chování při vypnutém trackingu

| Nastavení | Co se nestane | Co uvidí uživatel v reportu |
|---|---|---|
| `campaigns.track_opens = false` | Pixel se nevloží, token typu 1 nevznikne | Místo čísel otevření text „Měření otevření bylo pro tuto kampaň vypnuté" |
| `campaigns.track_clicks = false` | Odkazy se nepřepíšou, token typu 2 nevznikne, `campaign_links` se plní jen kvůli náhledu | Místo čísel prokliku text „Měření prokliků bylo vypnuté". Statistika odkazů se nezobrazí vůbec |
| Obojí vypnuté | Zpráva se odešle beze změn v HTML | Report ukazuje jen doručení, odmítnutí, stížnosti a odhlášení |
| Workspace nemá `tracking_domains` | SDK se nespustí, `oe_token` se nepřidává | Timeline obsahuje jen e-mailové položky |
| Souhlas `analytics` odvolaný | Žádné webové události | Timeline má mezeru, u kontaktu je poznámka „od 14. 5. 2026 nesouhlasí se sledováním" |

Zásada pro UI: **vypnutý tracking nikdy nesmí vypadat jako nula.** Nula znamená „nikdo neotevřel", což je úplně jiná informace. Rozdíl mezi „nezměřeno" a „nula" je jeden z nejčastějších zdrojů špatných rozhodnutí v marketingových nástrojích.

Segmenty založené na engagementu (část 2) musí umět rozlišit totéž. Kampaň s vypnutým měřením otevření se do podmínky „neotevřel poslední 3 kampaně" **nezapočítává** ani jako otevřená, ani jako neotevřená, prostě se přeskočí. Viz požadavek 12.4.

---

## 4. Rozhraní

### 4.1 Veřejné trackovací endpointy (bez autentizace)

| Metoda | Cesta | Účel | Odpověď |
|---|---|---|---|
| `GET` | `/t/o/{token}` | Open pixel | `200 image/gif`, 42 B, vždy |
| `GET`, `HEAD` | `/t/c/{token}` | Click redirect | `302` na cíl, nebo `302` na `/t/expired` |
| `GET` | `/t/expired` | Informační stránka | `200 text/html` |
| `GET` | `/e/oe.js` | Web SDK | `200 application/javascript` |
| `OPTIONS` | `/e/*` | CORS preflight | `204` |
| `POST` | `/e/track` | Příjem událostí | `202` |
| `POST` | `/e/identify` | Konzumace `oe_token` | `202` |

`HEAD` na `/t/c/` se chová jako `GET`, ale klasifikuje se jako `scanner` a přesměrování se vrátí bez těla.

#### `POST /e/identify`

```ts
// request
{ v: 1; key: string; anonymous_id: string; token: string }
// response 202
{ ok: true }
```

Chybové kódy podle 4.4: `token_malformed`, `token_signature_invalid`, `token_type_mismatch`, `token_unknown_key`, `token_expired` (410), `token_already_used` (409), `origin_not_allowed` (403), `rate_limited` (429).

### 4.2 API pro aplikaci (session nebo API klíč)

| Metoda | Cesta | Scope | Účel |
|---|---|---|---|
| `GET` | `/api/v1/campaigns/{id}/stats` | `campaigns:read` | Souhrn kampaně |
| `GET` | `/api/v1/campaigns/{id}/stats/timeline` | `campaigns:read` | Průběh v čase pro graf |
| `GET` | `/api/v1/campaigns/{id}/links` | `campaigns:read` | Statistika odkazů |
| `GET` | `/api/v1/campaigns/{id}/recipients` | `campaigns:read` | Seznam příjemců s jejich engagementem |
| `GET` | `/api/v1/campaigns/{id}/stream` | `campaigns:read` | SSE |
| `GET` | `/api/v1/contacts/{id}/timeline` | `contacts:read` | Sjednocená timeline |
| `GET` | `/api/v1/contacts/{id}/identities` | `contacts:read` | Zařízení navázaná na kontakt |
| `DELETE` | `/api/v1/contacts/{id}/identities/{anonymousId}` | `contacts:write` | Odpojit zařízení |
| `POST` | `/api/v1/contacts/{id}/identity-merges/{mergeId}/revert` | `contacts:write` | Vrátit sloučení historie |
| `GET` | `/api/v1/dashboard` | `campaigns:read` | Dlaždice dashboardu |
| `GET` | `/api/v1/tracking/domains` | `settings:read` | Seznam domén |
| `POST` | `/api/v1/tracking/domains` | `settings:write` | Přidat doménu |
| `DELETE` | `/api/v1/tracking/domains/{id}` | `settings:write` | Odebrat doménu |
| `POST` | `/api/v1/events` | `events:write` | Serverové události |

#### `GET /api/v1/campaigns/{id}/stats`

Klíče v odpovědi jsou `snake_case` podle konvence 4.1 části 1. Konverzi na `camelCase` dělá až TypeScript klient v `sdk-node`.

```ts
type CampaignStatsResponse = {
  campaign_id: string;
  status: 'draft'|'scheduled'|'sending'|'paused'|'sent'|'cancelled'|'failed';
  track_opens: boolean;
  track_clicks: boolean;
  delivered_source: 'provider_events' | 'derived_from_sent';
  counts: {
    materialized: number; sent: number; skipped: number; failed: number;
    delivered: number; delivered_effective: number;
    bounced_hard: number; bounced_soft: number; complained: number; unsubscribed: number;
    opens_total: number; opens_unique: number;
    opens_unique_human: number; opens_unique_apple: number;
    clicks_total: number; clicks_unique: number;
    clicks_unique_human: number; clicks_scanner: number;
  };
  rates: {
    // null, když je jmenovatel nula nebo pod prahem důvěryhodnosti
    open_rate: number | null;
    machine_open_share: number | null;
    verified_open_rate: number | null;
    click_rate: number | null;
    click_to_open_rate: number | null;
    bounce_rate: number | null;
    complaint_rate: number | null;
    unsubscribe_rate: number | null;
  };
  small_sample: boolean;        // delivered_effective < 200
  first_event_at: string | null;
  last_event_at: string | null;
  version: number;
  updated_at: string;
};
```

Chybové stavy podle katalogu části 1: `404 not_found` (neexistuje nebo jiný workspace, 404 místo 403 kvůli enumeraci), `403 insufficient_scope`, `401 unauthenticated`.

`ETag` odpovědi je `W/"<version>"`. Klient v režimu polling posílá `If-None-Match` a při nezměněné hodnotě dostane `304` bez těla, viz 3.13.2.

#### `GET /api/v1/contacts/{id}/timeline`

Query: `cursor?`, `limit?` (výchozí 50, max 200), `types?` (čárkou oddělené), `from?`, `to?`.

Tvar odpovědi je `Paginated<TimelineItem>` podle 4.3 části 1, doplněný o `meta`.

```ts
type TimelineResponse = {
  data: TimelineItem[];
  pagination: {
    next_cursor: string | null;
    prev_cursor: string | null;
    has_more: boolean;
    limit: number;
  };
  meta?: { truncated_merge?: { merge_id: string; reason: 'max_events' } };
};

type TimelineItem = {
  id: string;
  occurred_at: string;
  source: 'email' | 'web' | 'contact' | 'automation';
  type: string;                        // 'message_opened', 'page_view', ...
  title: string;                       // už lokalizovaný text pro zobrazení
  detail?: Record<string, unknown>;
  campaign?: { id: string; name: string };
  session_id?: string;
  reliability?: 'confirmed' | 'machine';  // 'machine' u proxy_apple otevření
};
```

`title` se skládá na serveru, aby se stejný text nemusel implementovat v každém klientovi API. Lokalizuje se podle `Accept-Language` nebo podle jazyka uživatele.

#### `GET /api/v1/campaigns/{id}/recipients`

Query: `filter` z množiny `all | opened | clicked | not_opened | not_clicked | bounced | complained | unsubscribed | machine_open_only`, `cursor`, `limit`.

Odpověď obsahuje kontakt (id, e-mail, jméno) a jeho `firstOpenAt`, `firstClickAt`, `openCount`, `clickCount`, `openReliability`. Slouží mimo jiné k tomu, aby si uživatel mohl z reportu udělat segment.

### 4.3 Události pro odchozí webhooky

Deklarujeme tyto typy, doručovací infrastruktura je z části 1.

| Typ | Kdy | Payload |
|---|---|---|
| `message.opened` | Otevření třídy `human` nebo `proxy_image`, jen první na zprávu | `{ message_id, message_created_at, campaign_id, contact_id, occurred_at, open_class }` |
| `message.clicked` | Klik třídy `human`, každý | `{ message_id, message_created_at, campaign_id, contact_id, link_id, url, occurred_at }` |
| `contact.identified` | Nová vazba `anonymous_id` na kontakt | `{ contact_id, anonymous_id, source, campaign_id?, occurred_at }` |
| `web.event` | Vlastní webová událost, když je zapnuté (výchozí vypnuto kvůli objemu) | `{ contact_id?, anonymous_id, name, properties, occurred_at }` |

`message.opened` se posílá jen jednou na zprávu schválně: jinak by Apple proxy zaplavila zákazníkův endpoint. `web.event` je ve výchozím stavu vypnutý a v UI je u něj varování o objemu.

### 4.4 Katalog chybových kódů této části

Formát odpovědi je RFC 9457 Problem Details podle 4.2 části 1, `Content-Type: application/problem+json`. Klient se rozhoduje podle pole `code`. Konvence pro doménové kódy je `<domena>_<problem>` a každý kód se registruje v `packages/core/errors/registry.ts`.

**Kódy přebírané z části 1**, tato část nezavádí vlastní varianty:

| `code` | HTTP | Kdy u nás |
|---|---|---|
| `token_malformed` | 400 | Token nemá správný tvar, špatné base64url, padding, špatná délka payloadu |
| `token_signature_invalid` | 400 | Neplatný MAC |
| `token_type_mismatch` | 400 | Typ tokenu neodpovídá endpointu (viz 3.1.4) |
| `token_unknown_key` | 400 | `key_id` není v konfiguraci |
| `token_expired` | 410 | Identity token po `expires_at` |
| `token_already_used` | 409 | `nonce` už je v `identity_token_uses` |
| `origin_not_allowed` | 403 | `Origin` neodpovídá žádné `tracking_domains` workspace |
| `payload_too_large` | 413 | Tělo nad 64 kB |
| `validation_failed` | 422 | Dávka neprošla schématem |
| `too_many_items` | 422 | Nad 50 událostí v dávce |
| `rate_limited` | 429 | Překročený limit podle 3.7.4 |
| `not_found` | 404 | Kampaň nebo kontakt neexistuje, nebo na něj aktér nemá vidět |
| `forbidden` | 403 | Role nemá oprávnění |
| `dependency_timeout` | 504 | Dotaz timeline přes 3 s |

Poznámka k `too_many_items`: část 1 dává limit dávkového endpointu 1 000 položek, tato část ho pro `/e/track` zpřísňuje na 50 (3.7.3). Přísnější limit v rámci téhož kódu je v pořádku, kód se nemění.

**Nové kódy zaváděné touto částí** (k registraci v `registry.ts`):

| `code` | HTTP | Opakovat? | Kdy | Text pro uživatele (cs) |
|---|---|---|---|---|
| `tracking_event_too_large` | 422 | ne | Jedna událost nad 8 kB | „Událost je příliš velká." |
| `tracking_invalid_event_name` | 422 | ne | Jméno neodpovídá `^[a-z][a-z0-9_]{0,63}$` | „Jméno události smí obsahovat jen malá písmena, číslice a podtržítko." |
| `tracking_invalid_anonymous_id` | 422 | ne | Není platné UUID | interní, nezobrazuje se |
| `tracking_identify_unsigned_pii` | 422 | ne | E-mail nebo telefon v `identify` bez serverového podpisu | „E-mail nelze nastavit z prohlížeče bez serverového podpisu." |
| `tracking_domain_limit_reached` | 422 | ne | Přes 20 domén na workspace | „Můžete mít nejvýše 20 domén pro měření." |
| `tracking_domain_invalid` | 422 | ne | Host neprojde validací | „Zadejte doménu bez protokolu a bez cesty, například shop.example.cz." |
| `tracking_merge_not_revertible` | 409 | ne | Sloučení není ve stavu `completed` ani `truncated` | „Toto sloučení už nejde vrátit." |
| `tracking_disabled` | 409 | ne | Operace nad kampaní s vypnutým měřením | „Měření bylo pro tuto kampaň vypnuté." |
| `tracking_timeline_window_too_large` | 422 | ne | Požadavek na víc než 3 měsíce naráz | „Zvolte kratší období." |

Kódy z první tabulky označené jako „interní" se koncovému uživateli nikdy nezobrazují: projeví se buď tiše (tracking pokračuje anonymně), nebo obecnou hláškou. V odpovědi API a v logu jsou kvůli ladění.

**Chyby na `/t/**` se nevrací jako problem+json**, jak stanoví 4.2 části 1. Pixel vrací vždy `200` s GIFem, klik vždy `302` na `/t/expired`. Kód chyby jde jen do metriky `tracking_token_invalid_total{code}` a do logu s `request_id`.

---

## 5. UI

### 5.1 Report kampaně

Cesta: `/[workspace]/campaigns/[id]/report`

Rozvržení shora dolů:

1. **Hlavička**: název kampaně, předmět, stav, čas odeslání, počet příjemců.
2. **Řada hlavních čísel.** Pořadí je záměrné a řídí pozornost:

   | Pozice | Metrika | Velikost |
   |---|---|---|
   | 1 | Míra prokliku | největší |
   | 2 | Doručeno | střední |
   | 3 | Otevření celkem | střední, s ikonou vysvětlivky |
   | 4 | Odhlášení | malá |
   | 5 | Odmítnuto | malá |
   | 6 | Stížnosti | malá, červeně při překročení 0,1 % |

3. **Panel „Jak číst otevření"**, sbalitelný, ve výchozím stavu **rozbalený u první kampaně uživatele** a pak sbalený. Obsahuje tři čísla vedle sebe a vysvětlení.
4. **Graf průběhu** z `campaign_stats_buckets`, přepínač 5 minut / hodina / den.
5. **Tabulka odkazů** seřazená podle prokliků, se sloupci URL, prokliky, unikátní prokliky, podíl.
6. **Segmenty z reportu**: tlačítka „Vytvořit segment z těch, kdo klikli", „...kdo neotevřel". Vede do části 2 s předvyplněnou definicí.
7. **Diagnostika**, sbalená: odfiltrované strojové prokliky, počet událostí podle třídy, kdy dorazila poslední událost.

### 5.2 Stavy obrazovky reportu

| Stav | Kdy | Co se zobrazí |
|---|---|---|
| Načítání | Před první odpovědí | Skeleton s obrysem dlaždic, ne spinner |
| Prázdný, kampaň je koncept | `status = 'draft'` | „Report bude dostupný po odeslání kampaně." plus tlačítko na editaci |
| Prázdný, právě se odeslalo | `sent = 0` | „Odesílání právě začalo, první data se objeví během několika sekund." plus živý indikátor |
| Průběžný | `status = 'sending'` | Všechna čísla plus pruh „Odesílání probíhá, čísla se průběžně mění" a živý indikátor |
| Kompletní | `status = 'sent'` a 24 h bez nové události | Normální zobrazení bez indikátoru |
| Tracking vypnutý | `track_opens = false` | Místo dlaždice otevření text, ne nula |
| Chyba | API vrátí 5xx | „Report se nepodařilo načíst." plus tlačítko Zkusit znovu plus `request_id` malým písmem |
| Živé aktualizace nedostupné | SSE selhalo 3x | Nenápadný pruh nahoře, čísla se dál obnovují po 15 s |

### 5.3 Timeline kontaktu

Cesta: `/[workspace]/contacts/[id]` (záložka Aktivita)

- Svislá osa, položky seskupené po dnech s hlavičkou „Dnes", „Včera", „14. července 2026".
- Webové události jedné session jsou vizuálně seskupené do bloku s hlavičkou „Návštěva webu, 5 stránek, 4 minuty".
- Každá položka má ikonu podle typu, čas, název a rozbalitelný detail.
- Otevření třídy `proxy_apple` má šedou ikonu a popisek „automatické stažení".
- Filtr nahoře: všechno / e-maily / web / změny kontaktu.
- Nekonečné načítání s tlačítkem „Načíst starší", ne automatické (aby uživatel neztratil pozici).

| Stav | Co se zobrazí |
|---|---|
| Načítání | Skeleton tří položek |
| Prázdný | „U tohoto kontaktu zatím nemáme žádnou aktivitu." plus vysvětlení, že web tracking vyžaduje vložení skriptu, s odkazem do nastavení |
| Jen e-mailové položky | Nenápadná poznámka „Chování na webu se neměří. Nastavit" |
| Sloučená historie useknutá | Poznámka „Starší anonymní historie nebyla připojena" s odkazem na vysvětlení |
| Sdílené zařízení | Žlutá poznámka „Toto zařízení používá víc lidí, část historie může patřit někomu jinému" |
| Chyba nebo timeout | „Historie se nenačetla. Zkuste zúžit období." |

### 5.4 Nastavení trackingu

Cesta: `/[workspace]/settings/tracking`

Obsahuje:

1. **Domény pro měření.** Tabulka, přidání, přepínač „včetně subdomén", stav ověření. Prázdný stav vysvětluje, že bez domény se nic neměří.
2. **Kód pro vložení.** Připravený `<script>` s tlačítkem Kopírovat, plus varianta pro Google Tag Manager a odkaz na npm balíček.
3. **Souhlasy.** Vysvětlení, že skript čeká na `OpenEngage('consent', ...)`, a příklad napojení na běžné cookie lišty.
4. **Diagnostika.** Počet událostí za posledních 24 hodin, čas poslední události, počet odmítnutých a proč. Když je nula, zobrazí se checklist „Skript není vidět, zkontrolujte: doména, souhlas, blokátor".
5. **Soukromí.** Přepínač ukládání země z IP (výchozí vypnuto), seznam parametrů odstraňovaných z URL, retence.

### 5.5 Dashboard

Cesta: `/[workspace]`

| Dlaždice | Období | Zdroj | Cache |
|---|---|---|---|
| Odeslané zprávy | 7 / 30 / 90 dní | součet `campaign_stats.sent` | 60 s |
| Míra prokliku, trend | totéž | vážený průměr přes kampaně | 60 s |
| Míra otevření s podílem automatických | totéž | vážený průměr | 60 s |
| Míra odmítnutí a stížností | totéž | s prahovými barvami (bounce > 5 %, complaints > 0,1 %) | 60 s |
| Aktivní kontakty na webu | 24 h | `count(distinct contact_id)` z `web_events` | 5 min |
| Poslední kampaně | posledních 5 | `campaign_stats` | 60 s |

Zastaralost hodnoty se pozná podle toho, že odpověď obsahuje `computedAt`. Když je starší než dvojnásobek cache TTL, UI zobrazí u dlaždice čas výpočtu malým písmem. Nikdy se nezobrazuje zastaralá hodnota bez označení.

Dotaz „aktivní kontakty na webu" je jediný dashboardový dotaz, který sahá do `web_events` a agreguje. Proto má delší cache a je omezený na jednu partition (posledních 24 hodin).

### 5.6 Texty, cs a en

| Klíč | cs | en |
|---|---|---|
| `tracking.report.openRate.label` | Otevření celkem | Total opens |
| `tracking.report.openRate.hint` | Část otevření je automatická. Poštovní programy, hlavně Apple Mail, si stahují obrázky samy, i když člověk zprávu neotevřel. | Some opens are automatic. Mail apps, mainly Apple Mail, download images on their own even when nobody opened the message. |
| `tracking.report.machineOpens.label` | Z toho pravděpodobně automatická | Likely machine opens |
| `tracking.report.verifiedOpenRate.label` | Ověřená otevření | Verified opens |
| `tracking.report.verifiedOpenRate.hint` | Počítá se jen z příjemců, u kterých měření funguje. | Calculated only from recipients where measurement works. |
| `tracking.report.clickRate.label` | Míra prokliku | Click rate |
| `tracking.report.clickRate.hint` | Podíl doručených zpráv, u kterých někdo klikl na odkaz. Nejspolehlivější číslo v reportu. | Share of delivered messages where somebody clicked a link. The most reliable number in this report. |
| `tracking.report.ctor.label` | Prokliky z otevření | Click to open rate |
| `tracking.report.scannerClicks.label` | Odfiltrované strojové prokliky | Filtered machine clicks |
| `tracking.report.scannerClicks.hint` | Firemní antispam navštíví každý odkaz, aby ho prověřil. Tyhle prokliky do čísel nepočítáme. | Corporate spam filters visit every link to check it. We do not count those clicks. |
| `tracking.report.smallSample` | Malý vzorek, procenta nemusí nic znamenat | Small sample, percentages may be misleading |
| `tracking.report.trackingOff.opens` | Měření otevření bylo pro tuto kampaň vypnuté | Open tracking was disabled for this campaign |
| `tracking.report.trackingOff.clicks` | Měření prokliků bylo pro tuto kampaň vypnuté | Click tracking was disabled for this campaign |
| `tracking.report.sending` | Odesílání probíhá, čísla se průběžně mění | Sending in progress, numbers keep changing |
| `tracking.timeline.empty` | U tohoto kontaktu zatím nemáme žádnou aktivitu. | No activity recorded for this contact yet. |
| `tracking.timeline.machineOpen` | Automatické stažení poštovním klientem | Automatic download by the mail client |
| `tracking.timeline.sharedDevice` | Toto zařízení používá víc lidí, část historie může patřit někomu jinému | This device is shared, some history may belong to somebody else |
| `tracking.timeline.mergeTruncated` | Starší anonymní historie nebyla připojena, protože jí bylo příliš mnoho | Older anonymous history was not attached because there was too much of it |
| `tracking.settings.domains.empty` | Zatím nemáte žádnou doménu pro měření. Bez ní se chování na webu nesleduje. | No measurement domain yet. Without one, web behaviour is not tracked. |
| `tracking.settings.diagnostics.zero` | Za posledních 24 hodin nedorazila žádná událost. | No events received in the last 24 hours. |
| `tracking.expired.title` | Tento odkaz už neplatí | This link is no longer valid |
| `tracking.expired.body` | Odkaz z e-mailu vypršel nebo byl poškozený. Zkuste otevřít e-mail znovu. | The link from the e-mail expired or was damaged. Try opening the e-mail again. |

---

## 6. Bezpečnost a soukromí

### 6.1 Přehled hrozeb a opatření

| Hrozba | Dopad | Opatření |
|---|---|---|
| Open redirect na naší doméně | Phishing pod cizí značkou, poškození reputace domény | Cíl výhradně z `campaign_links` podle `link_id`, nikdy ze vstupu (3.4.3) |
| Podvržení otevření nebo kliku | Zkreslené reporty | HMAC podpis tokenu, bez klíče nejde token vyrobit |
| Odečtení e-mailu z odkazu v mailu | Únik osobního údaje při přeposlání | Token neobsahuje e-mail ani `contact_id` |
| Únik identity na cizí web | Cizí web zjistí, kdo je jeho návštěvník | `oe_token` jen na registrované domény, vázaný na host, jednorázový, 15 minut |
| Odečtení tokenu z `Referer` | Cizí web získá platný token | `Referrer-Policy: no-referrer` na redirectu |
| Token zůstane v adresním řádku a v analytice | Únik do cizích systémů | `history.replaceState` hned po přečtení, plus `oe_token` v seznamu odstraňovaných parametrů |
| Zaplavení ingestion falešnými událostmi | Nafouknutá databáze | Rate limity, kontrola `Origin`, limity velikosti |
| Podvržení e-mailu z prohlížeče | Únos cizího kontaktu | `identify` s e-mailem vyžaduje serverový podpis |
| Přečtení cizích dat přes veřejný klíč | Únik | Ingestion nikdy nevrací data, jen počty |
| Timing útok na porovnání podpisu | Uhádnutí tagu | Porovnání v konstantním čase |
| Únik mezi projekty | Kritický | `workspace_id` v každém dotazu, vynuceno repository vrstvou |
| Zneužití `/t/o/` k mapování, kdo existuje | Menší | Odpověď je vždy stejná bez ohledu na platnost |
| Skener spotřebuje `oe_token` | Zbytečná anonymní identita | Neškodné, nespouští JavaScript |

### 6.2 Co se nikdy nesmí zalogovat

| Údaj | Poznámka |
|---|---|
| `SECRET_KEY`, `K_track` | Ani při `debug` úrovni |
| Celý token | V logu jen prvních 8 znaků payloadu a `kind` |
| E-mailová adresa | Do logu jen `contact_id` |
| Surová IP adresa | Do logu jen `/24` prefix u IPv4 a `/48` u IPv6, a jen na úrovni `warn` a výš |
| Obsah `properties` | Při chybě se loguje jen seznam klíčů, ne hodnoty |

### 6.3 Souhlasy a jejich mapování

| Souhlas (část 2) | Co odemyká |
|---|---|
| `analytics` | Jakýkoliv sběr webových událostí. Bez něj SDK nestartuje a neuloží nic do prohlížeče |
| `personalization` | Vazba `anonymous_id` na `contact_id`, tedy neanonymní timeline. Bez něj se události sbírají jen anonymně |
| `email_marketing` | Řídí odesílání (část 2 a 4), na tracking nemá přímý vliv |

Odvolání `analytics` je okamžité: SDK při dalším volání `consent` smaže úložiště a přestane odesílat. Serverově se nic nemaže automaticky, na to je GDPR výmaz.

Odvolání `personalization` zruší vazbu v `identities` a zapíše `identity_bindings` se `source = 'reset'`. Historické události si `contact_id` **ponechají**, protože byly zaznamenány v době platného souhlasu. Že je to správný výklad, je právní otázka, viz kapitola 14.

### 6.4 Právní kontext

Nejde o právní posouzení, jen o soupis toho, co jsme dohledali, aby to posuzovatel měl po ruce.

- **ePrivacy směrnice, čl. 5(3)** vyžaduje souhlas před uložením nebo čtením informací v koncovém zařízení, s výjimkou toho, co je nezbytně nutné pro poskytnutí služby výslovně vyžádané uživatelem.
- **EDPB Guidelines 2/2023 o technickém rozsahu čl. 5(3)** (finální verze přijatá 16. října 2024) výslovně řeší **trackovací pixely a trackovací odkazy**. Konstatuje, že trackovací pixel je odkaz na zdroj vložený do obsahu, jehož jediným účelem je vyvolat komunikaci klienta se serverem, a že uložení v koncovém zařízení přes mechanismus cache spadá pod čl. 5(3). Dokument pokrývá i sledování podle URL, lokální zpracování a unikátní identifikátory.
- Praktický důsledek: **pixel v e-mailu i přepsaný odkaz spadají pod čl. 5(3)** a nelze automaticky spoléhat na to, že souhlas s e-mailovým marketingem pokrývá i měření. Tuto otázku je nutné vyřešit s právníkem před uvedením do provozu.
- **GDPR** se pak vztahuje na následné zpracování získaných dat, tedy na profil, timeline a segmentaci.

Technické páky, které produkt nabízí, aby výsledek posouzení šlo naplnit:

1. Vypnutí měření otevření per kampaň i globálně.
2. Vypnutí měření prokliků per kampaň i globálně.
3. Souhlas jako vstupní podmínka pro web SDK.
4. Neukládání IP adres.
5. Konfigurovatelná retence.
6. Anonymizace a výmaz na požádání.
7. Export dat subjektu.

Co produkt **neumí** a co by mohl posuzovatel chtít: měření otevření podmíněné souhlasem **per kontakt**. Viz požadavek 12.3.

---

## 7. Výkon

### 7.1 Očekávané objemy

Referenční instalace, ze které se počítají všechny limity:

| Veličina | Hodnota |
|---|---|
| Kontaktů v projektu | 100 000 |
| Kampaní za měsíc | 8 |
| Zpráv za měsíc | 500 000 |
| Špičková rychlost odesílání | 200 zpráv/s (kvóta SES) |
| Otevření za měsíc | 300 000 (včetně automatických) |
| Prokliků za měsíc | 30 000 |
| Webových událostí za měsíc | 2 000 000 |
| Špička webových událostí | 200/s, krátkodobě 1 000/s |
| Řádků `web_events` po 26 měsících | 52 000 000 |

Horní hranice, pro kterou návrh ještě platí: 5 milionů kontaktů, 100 milionů řádků `web_events`, 2 000 událostí/s trvale.

### 7.2 Rozpočet latence

| Operace | p50 | p99 | Tvrdý limit |
|---|---|---|---|
| `/t/o/` | 3 ms | 20 ms | 50 ms, pak se událost zahodí |
| `/t/c/` | 5 ms | 50 ms | 200 ms, pak varování |
| `POST /e/track` | 12 ms | 40 ms | 1 s, pak 503 |
| `POST /e/identify` | 10 ms | 60 ms | 1 s |
| `GET /campaigns/{id}/stats` | 5 ms | 30 ms | 2 s |
| `GET /contacts/{id}/timeline` | 15 ms | 120 ms | 3 s, pak `dependency_timeout` |
| SSE zpráva od změny v DB | 1 s | 2,5 s | 5 s |

### 7.3 Kritické dotazy

Dotazy, na kterých stojí výkon a které musí mít v CI test s `EXPLAIN` kontrolou plánu (nesmí se objevit `Seq Scan` nad `web_events`):

1. Timeline kontaktu, jeden měsíc, keyset.
2. `web_event_months` pro kontakt.
3. Merge: výběr 1 000 anonymních událostí k doplnění.
4. `campaign_stats` podle PK.
5. `campaign_stats_buckets` pro rozsah.
6. Dashboard: aktivní kontakty za 24 h.
7. Recipients s filtrem `opened`.

### 7.4 Kde to praskne dřív

Seřazeno podle toho, co narazí jako první:

1. **Zápis `web_events`.** Pět zápisových operací na událost (tabulka plus čtyři indexy). Nad 2 000 událostí/s je potřeba buď zvětšit dávky, nebo vzorkovat `page_view`.
2. **Kontence na `campaign_stats`.** Při víc než 20 UPDATE téhož řádku za sekundu se objeví čekání na zámek. Řešení je shardovaný čítač, popsané v 3.9.2.
3. **Počet partition.** Nad 100 partition roste čas plánování dotazů. Proto je doporučená retence 26 měsíců.
4. **`identity_token_uses`.** Při extrémní špičce kliků roste rychle. Úklidový job běží hodinově, což při 15minutové platnosti stačí s velkou rezervou.
5. **Paměť LRU cache odkazů.** 10 000 kampaní po 50 odkazech s průměrnou délkou 80 znaků je zhruba 40 MB. Při větším počtu souběžně aktivních kampaní se sníží kapacita cache.
6. **SSE spojení.** 500 na instanci. Nad to se přepíná na polling.

### 7.5 Co se měří v zátěžovém testu

Součást akceptace, ne volitelné:

| Test | Vstup | Kritérium |
|---|---|---|
| Ingestion | 1 000 událostí/s po 10 minut | p99 < 40 ms, nula ztracených, nula chyb 5xx |
| Redirect | 2 000 požadavků/s po 2 minuty | p99 < 50 ms, nula chyb |
| Timeline | Kontakt se 100 000 událostmi, 20 stránek | Každá stránka p99 < 120 ms |
| Report | Kampaň s 1 000 000 zpráv | První načtení < 200 ms |
| Merge | 10 000 anonymních událostí | Doběhne do 30 s, neblokuje zápis nových |
| Retence | Smazání partition se 4 miliony řádků | < 5 s, žádný dopad na latenci ostatních dotazů |

---

## 8. Konfigurace

**Zdroj pravdy je tabulka 4.9 části 1.** Proměnné níže jsou **návrh na její doplnění**, ne paralelní seznam. Zapisují se do téhož zod schématu v `packages/core/config` a podléhají téže validaci při startu (všechny chyby naráz, exit code 78). Viz požadavek 12.5.12.

Z tabulky části 1 používá tato část beze změny: `APP_URL`, `TRACKING_DOMAIN`, `SECRET_KEY`, `SECRET_KEY_PREVIOUS`, `RATE_LIMIT_BACKEND`, `WORKER_CONCURRENCY`, `SHUTDOWN_GRACE_SECONDS`, `METRICS_ENABLED`, `TRUST_PROXY`.

Zvlášť `TRUST_PROXY` je pro tuto část kritická: bez správného nastavení se klasifikace otevření podle IP (3.3) a rate limiting dělají nad adresou reverzní proxy, tedy nad jednou adresou pro všechny. V dokumentaci pro provoz to musí být napsané u nastavení trackingu, ne jen u rate limitingu.

Navrhované doplnění:

| Proměnná | Typ | Povinná | Výchozí | Kdo | Validace při startu |
|---|---|---|---|---|---|
| `TRACKING_IDENTITY_TOKEN_TTL_SECONDS` | int | ne | `900` | W | 60 až 3600 |
| `TRACKING_MERGE_WINDOW_DAYS` | int | ne | `30` | K | 1 až 365 |
| `TRACKING_MERGE_MAX_EVENTS` | int | ne | `10000` | K | 100 až 1000000 |
| `TRACKING_RETENTION_MONTHS` | int | ne | `26` | K | 3 až 120, odpověď na P5-4 části 1 |
| `TRACKING_APPLE_RELAY_RANGES` | bool | ne | `false` | W K | |
| `TRACKING_STORE_COUNTRY` | bool | ne | `false` | W | Když `true`, musí být k dispozici GeoIP databáze |
| `TRACKING_GEOIP_DB_PATH` | cesta | ne | prázdné | W | Soubor musí existovat, když je `TRACKING_STORE_COUNTRY=true` |
| `TRACKING_STRIP_QUERY_PARAMS` | seznam | ne | viz 3.7.3.1 | W | Jen rozšiřuje výchozí sadu, nikdy nezkracuje |
| `TRACKING_PII_PROPERTY_KEYS` | seznam | ne | viz 3.15.3 | K | Jen rozšiřuje |
| `TRACKING_WRITER_FLUSH_MS` | int | ne | `250` | W | 50 až 5000 |
| `TRACKING_WRITER_BATCH` | int | ne | `500` | W | 50 až 5000 |
| `TRACKING_SSE_MAX_CONNECTIONS` | int | ne | `500` | W | 10 až 10000 |
| `TRACKING_ALLOW_SERVERSIDE_PUBLIC_KEY` | bool | ne | `false` | W | |

`TRACKING_PARTITION_PREMAKE_MONTHS` z původního návrhu **zrušena**, předstih partition řídí část 1 (tři měsíce, sekce 2.1). `TRACKING_KEY_EPOCH` **zrušena**, generaci klíče nese `SECRET_KEY` ve tvaru `<key_id>:<base64url>` podle 3.10 části 1.

Když se `TRACKING_DOMAIN` liší od `APP_URL`, musí být obojí obsloužené stejnou instancí. Kontroluje se při startu jen formát, ne dosažitelnost. Legenda sloupce „Kdo" je z části 1: W = web, K = worker, S = sender. Sender žádnou z těchto proměnných nepotřebuje, protože tokeny vyrábí z dat, která má, a `TRACKING_DOMAIN` už v jeho seznamu je.

---

## 9. Provoz, metriky a monitoring

### 9.1 Metriky vystavené instancí

Prefix `tracking_`, formát Prometheus na `/api/v1/admin/metrics` (chráněno podle části 1).

| Metrika | Typ | Popis |
|---|---|---|
| `tracking_open_total{class}` | counter | Otevření podle třídy |
| `tracking_click_total{class}` | counter | Prokliky podle třídy |
| `tracking_token_invalid_total{code}` | counter | Neplatné tokeny podle kódu |
| `tracking_writer_buffer_size` | gauge | Aktuální velikost bufferu |
| `tracking_writer_dropped_total` | counter | Zahozené položky |
| `tracking_writer_flush_duration_seconds` | histogram | Doba zápisu dávky |
| `tracking_ingest_events_total{result}` | counter | accepted / rejected |
| `tracking_ingest_duration_seconds` | histogram | Latence ingestion |
| `tracking_identity_bind_total{result}` | counter | created / bound / unchanged / rebound |
| `tracking_identity_merge_events_total` | counter | Doplněných událostí |
| `tracking_sse_connections` | gauge | Otevřená spojení |
| `tracking_partition_missing` | gauge | 1, když chybí partition pro aktuální měsíc |
| `tracking_redirect_duration_seconds` | histogram | Latence přesměrování |

### 9.2 Alerty, které se mají nastavit

| Podmínka | Závažnost | Proč |
|---|---|---|
| `tracking_partition_missing > 0` | kritická | Zápis událostí přestane fungovat |
| `tracking_writer_dropped_total` roste | vysoká | Ztrácejí se prokliky |
| `tracking_token_invalid_total{code="token_unknown_key"}` roste | vysoká | Špatně nastavená rotace, rozbité odkazy |
| Podíl `proxy_apple` skokově klesne o víc než 20 bodů | střední | Apple pravděpodobně změnil `User-Agent`, heuristika přestala fungovat |
| `tracking_redirect_duration_seconds` p99 > 200 ms | střední | Cache nefunguje |
| Nula událostí za 24 h u workspace, který dřív měl | nízká | Zákazník si nejspíš rozbil web, zobrazí se mu to v diagnostice |

### 9.3 Runbook, tři nejčastější situace

**Reporty ukazují nula otevření.** Postup: zkontrolovat `campaigns.track_opens`, pak `TRACKING_DOMAIN` (musí být dosažitelná zvenku), pak `tracking_open_total`. Když čítač roste a report je nula, problém je ve zpracování dávky, ne v příjmu.

**Odkazy v mailu vedou na stránku „Tento odkaz už neplatí".** Skoro vždy chybí generace klíče po rotaci `SECRET_KEY`. Zkontrolovat `SECRET_KEY_PREVIOUS` a metriku `tracking_token_invalid_total{code="token_unknown_key"}`.

**Web SDK nic neposílá.** Postup v diagnostice v UI: doména v `tracking_domains`, souhlas udělený, `Origin` odpovídá, blokátor. Debug režim vypíše důvod do konzole.

---

## 10. Akceptační kritéria

Testovatelné věty. Z každé jde napsat test, aniž se člověk ptá.

### 10.1 Tokeny

Vektory vlastní část 1 (`fixtures/token/vectors.json`), tato část je jen konzumuje. Kritéria se týkají chování, které vlastním já.

1. Implementace v TypeScriptu i v Go vyrobí pro vstupy z vektoru „open" v části 1 přesně řetězec `t1bwEBkvOgHC1-QJobLD1OX2BxAZLzoBwtfkGLLD1OX2Bxgmpk3YCVNgR__t5nFa1z5_Wn6r8V`.
2. Ověřovací funkce v aplikaci projde všech pět pozitivních a všech devět negativních vektorů z části 1 se shodnými kódy.
3. **Token typu `o` poslaný na `/t/c/` skončí kódem `token_type_mismatch` a přesměrováním na `/t/expired`. Token typu `u` poslaný na `/t/o/` také.** Bez této kontroly by šlo zobrazením obrázku odhlásit příjemce z odběru.
4. Token typu open má vždy 74 znaků, click 96, identity 106, unsubscribe 117.
5. 10 000 náhodných round-tripů v obou jazycích projde, včetně `message_created_at` = 0 a 4294967295 a UUID samých nul a samých `ff`.
6. Změna jednoho bitu v payloadu vede k `token_signature_invalid`.
7. Token vyrobený s `key_id = 1` se ověří i po přesunu klíče do `SECRET_KEY_PREVIOUS` a nastavení `SECRET_KEY=2:...`.
8. Po odstranění `key_id = 1` z konfigurace vrátí ověření takového tokenu kód `token_unknown_key`, pixel vrátí normální GIF a redirect skončí na `/t/expired`, ne chybou 500.
9. Dohledání zprávy z open tokenu je jediný `Index Scan` nad jednou partition `messages`; `EXPLAIN` neukáže žádnou další.
10. Když `messages.created_at` neodpovídá hodnotě v tokenu (porušený invariant I1), událost se uloží bez atribuce na kampaň, zvýší se `tracking_message_lookup_miss_total` a **neproběhne** žádný dotaz bez podmínky na `created_at`.

### 10.2 Open pixel

11. `GET /t/o/<platný token>` vrátí 200, `Content-Type: image/gif`, přesně 42 bajtů a hlavičku `Cache-Control` s `no-store`.
12. `GET /t/o/<neplatný token>` vrátí bajt po bajtu stejnou odpověď jako platný token.
13. Požadavek s `User-Agent: Mozilla/5.0` se uloží s třídou `proxy_apple`.
14. Požadavek s `User-Agent` obsahujícím `GoogleImageProxy` se uloží s třídou `proxy_image`.
15. Požadavek s `User-Agent: Googlebot/2.1` se neuloží vůbec a `opens_total` se nezmění.
16. Dvě otevření téže zprávy 10 sekund po sobě zvýší `opens_total` o jedna, ne o dvě.
17. Dvě otevření téže zprávy 200 sekund po sobě zvýší `opens_total` o dva.
18. Kampaň s `track_opens = false` nemá v odeslaném HTML žádný `img` odkazující na `/t/o/`.

### 10.3 Click redirect

19. `GET /t/c/<platný token>` vrátí 302 s `Location` přesně rovným hodnotě z `campaign_links.url` dohledané podle `link_id`.
20. Přidání `?next=https://evil.example` k adrese `/t/c/<token>` nezmění `Location`.
21. Token s `link_id`, který neexistuje, vede na `/t/expired`. Token s `link_id` patřícím jinému workspace, než je v tokenu, také.
22. `Location` nikdy neobsahuje žádnou hodnotu z query stringu příchozího požadavku.
23. Odpověď obsahuje `Referrer-Policy: no-referrer`.
24. Cíl `https://x.cz/a?b=1#c` se s tokenem změní na `https://x.cz/a?b=1&oe_token=...#c`.
25. Cíl na doméně, která není v `tracking_domains`, dostane `Location` bez `oe_token` a redirect přitom vůbec nesáhne na `messages`.
26. Klik do 5 sekund od `messages.sent_at` se klasifikuje jako `scanner` a nezvýší `clicks_unique_human`.
27. Pět kliků z jedné IP na tři různé odkazy téže zprávy do 60 sekund se klasifikuje jako `scanner`.
28. Při 2 000 požadavcích za sekundu po dvě minuty na odkaz mimo `tracking_domains` je p99 serverového času pod 30 ms.
29. Když dohledání kontaktu pro `oe_token` trvá přes 30 ms, přesměrování proběhne bez `oe_token` a v limitu.

### 10.4 Web SDK a ingestion

30. Sestavený `oe.js` má gzip velikost pod 5 120 B, jinak CI padá.
31. Bez volání `consent` SDK nezapíše do `document.cookie`, `localStorage` ani `sessionStorage` nic a neodešle žádný požadavek.
32. Po `consent({analytics:true})` se odešle `session_started` a `page_view` v jedné dávce.
33. Po `consent({analytics:false})` zmizí `oe_aid` z cookie i `localStorage` do 100 ms.
34. Přepnutí karty (`visibilitychange` na `hidden`) odešle frontu přes `sendBeacon` s `Content-Type: text/plain;charset=UTF-8` a bez preflightu.
35. Požadavek s `Origin` mimo `tracking_domains` dostane 403 a kód `origin_not_allowed`.
36. Dávka s 51 událostmi vrátí 422 a kód `too_many_items`.
37. Dávka, ve které je jedna událost přes 8 kB a 19 platných, vrátí 202 s `accepted: 19, rejected: 1`.
38. Odeslání téže události dvakrát (stejné `id` a `occurred_at`) vytvoří v `web_events` jeden řádek.
39. `page_view` s adresou `https://x.cz/a?token=abc&utm_source=news` se uloží s `page.url` bez `token` a s `context.campaign.source = 'news'`.
40. `identify('u1', { email: 'a@b.cz' })` bez podpisu vrátí 422 a kód `tracking_identify_unsigned_pii` a e-mail kontaktu se nezmění.
41. Vypnutí sítě, 30 událostí, zapnutí sítě: všech 30 dorazí po obnovení, žádná se neztratí a žádná nedorazí dvakrát.
42. Odpověď ingestion neobsahuje `contactId` ani e-mail v žádném poli.

### 10.5 Identity resolution

43. Anonymní návštěva, pak klik v mailu, pak `identify`: události z posledních 30 dní dostanou `contact_id` a v timeline kontaktu se objeví.
44. Anonymní ID navázané na kontakt A, pak `identify` na kontakt B: události před druhou vazbou zůstanou u A, nové jdou k B.
45. Scénář ze 41 nevytvoří žádný `identity_merges` řádek.
46. Šestá převazba téhož anonymního ID během 24 hodin nastaví příznak `shared` a další slučování se neprovede.
47. `revert` sloučení vrátí `contact_id` na `NULL` u přesně těch událostí, které merge změnil, a u žádné jiné.
48. Merge s 15 000 kandidátními událostmi skončí ve stavu `truncated` a doplní přesně 10 000.
49. Zabití workeru uprostřed merge a restart nezpůsobí duplicity ani přeskočené řádky.
50. `reset()` vytvoří nové `anonymous_id` a zapíše `identity_bindings` s `contact_id = NULL`.
51. Kontakt s `processing_restricted = true`: `identify` nezaloží vazbu, `identities.contact_id` zůstane `NULL`, událost se uloží jen s `anonymous_id` a `contacts.last_activity_at` se nezmění.
52. Zrušení `processing_restricted` obnoví normální chování bez jakéhokoli dodatečného kroku.
53. Slučování historie se u kontaktu s `processing_restricted = true` nespustí vůbec.
54. Slučování přeskočí události s `erased_at IS NOT NULL`.

### 10.6 Předání identity z kliku

55. Kompletní tok od kliku po vazbu proběhne a `oe_token` zmizí z adresního řádku dřív, než se odešle první `page_view`.
56. Druhé použití téhož `oe_token` vrátí 409 a kód `token_already_used`.
57. Použití `oe_token` 16 minut po vydání vrátí 410 a kód `token_expired`.
58. Použití `oe_token` z jiné domény, než pro kterou byl vydaný, vrátí 403.
59. Ve všech třech chybových případech pokračuje tracking anonymně a uživatel na webu nic nepozná.
60. `oe_token` neobsahuje `contact_id` ani e-mail: dekódovaný payload má přesně 54 bajtů a žádný z nich neodpovídá identifikátoru kontaktu.

### 10.7 Reporty a timeline

61. Kampaň na 1 000 příjemců, z toho 300 otevření třídy `proxy_apple` a 200 třídy `human`: `opens_unique` = 500, `opens_unique_apple` = 300, `opens_unique_human` = 200.
62. Ověřená míra otevření v předchozím případě je 200 / (1000 − 300) = 28,6 %, ne 20 %.
63. CTOR se počítá z `opens_unique_human`, ne z `opens_unique`.
64. Report kampaně s milionem zpráv se načte pod 200 ms.
65. Kampaň s `track_opens = false` zobrazí v reportu text, ne nulu, a `openRate` v API je `null`.
66. Kampaň s méně než 200 doručenými zobrazí absolutní počty a příznak `smallSample: true`.
67. Timeline kontaktu se 100 000 událostmi vrátí první stránku pod 120 ms a dvacátou stránku také pod 120 ms.
68. Timeline zobrazí otevření třídy `proxy_apple` s `reliability: 'machine'`.
69. Timeline nezobrazí položky tříd `bot`, `scanner` ani `prefetch`.
70. Dvojí spuštění jobu `tracking.process_engagement` se stejnou dávkou nezmění `opens_unique`.
71. Doručení kampaně zvýší `contact_engagement.consecutive_no_open` o 1; následné ověřené otevření ho nastaví na 0.
72. Otevření, které dorazí dřív než událost `delivered` (běžné u Apple proxy), nezpůsobí, že se čítač zvýší po vynulování.
73. Kontakt, který otevřel naposledy před 91 dny, má po nočním běhu `opens_90d = 0`, i když od té doby nepřišla žádná událost.
74. Job `tracking.recompute_engagement_windows` se nedotkne kontaktu, který má všechna okna na nule.
75. `contact_engagement.opens_total` počítá jen ověřená otevření: kampaň otevřená výhradně Apple proxy ho nezvýší.
76. Kontakt bez jediné odeslané zprávy nemá řádek v `contact_engagement` a preset „nikdy neotevřel" ho přesto vrátí.
77. `oe rebuild-engagement` přepočítá tabulku od nuly a výsledek se rovná stavu udržovanému přírůstkově.
78. Segmentační dotaz nad `contact_engagement` z jiného workspace vrátí nula řádků i při obejití repository vrstvy (RLS).

### 10.8 Partitioning, retence a GDPR

79. Job `platform.maintain_partitions` vytvoří partition `web_events` pro aktuální měsíc a tři následující.
80. Při retenci 3 měsíce se čtvrtá nejstarší partition odpojí a smaže, a operace trvá pod 5 sekund pro 4 miliony řádků.
81. Zápis události s časem mimo existující partition selže hlasitě, ne tiše.
82. `erase_contact(id, 'anonymize')` odstraní `contact_id` ze všech událostí kontaktu, nastaví `erased_at` a nezmění `campaign_stats`.
83. `erase_contact(id, 'purge')` udělá v trackingu přesně totéž co `anonymize` a `campaign_stats` se nezmění ani v jednom režimu.
84. Výmaz serverové události, která má vyplněné jen `contact_id`, proběhne bez chyby `23514`.
85. Po výmazu se týž `anonymous_id` naváže na jiný kontakt: vymazané události se k němu **nepřipojí**.
86. Export dat subjektu obsahuje všechny webové i e-mailové události kontaktu a neobsahuje žádný token.

### 10.9 Realtime

87. Při odesílání kampaně dorazí do UI aktualizace do 2,5 sekundy (SSE) nebo do 3,5 sekundy (polling) od změny v databázi.
88. **Nad HTTP/1.1 se neotevře žádné SSE spojení.** Test: server bez TLS a bez HTTP/2, otevřít šest karet reportu, sedmý požadavek na API musí projít bez čekání.
89. Nad HTTP/2 se otevře nejvýše jedno SSE spojení na prohlížeč bez ohledu na počet karet (volba vůdce přes `BroadcastChannel`).
90. Prohlížeč bez `BroadcastChannel` funguje dál, jen si každá karta otevře vlastní spojení.
91. Sto souběžných SSE spojení na tutéž kampaň generuje jeden dotaz do databáze za 2 sekundy, ne sto.
92. Odpojení a připojení `EventSource` obnoví aktuální stav bez duplicit v UI.
93. Po překročení `TRACKING_SSE_MAX_CONNECTIONS` vrátí server 503 a klient přejde na polling.
94. V režimu polling vrátí druhý požadavek bez změny dat `304` bez těla.
95. Po třech neúspěšných pokusech o SSE klient přejde na polling a už se do konce života stránky nepokouší připojit.
96. Když živé aktualizace nefungují vůbec, report se dá načíst a obnovit tlačítkem, tedy obrazovka není na spojení závislá.

---

## 11. Závislosti

### 11.1 Nové knihovny navržené touto částí

Ověřeno z registru npm 2026-07-31 příkazem `npm view <balíček> license version time.modified`.

| Balíček | Verze | Licence | Poslední úprava | Účel | Kde běží |
|---|---|---|---|---|---|
| `crawler-user-agents` | 1.56.0 | MIT | 2026-07-02 | Seznam regulárních výrazů známých crawlerů pro bot detekci | server |
| `ipaddr.js` | 2.4.0 | MIT | 2026-06-29 | Parsování IP a test příslušnosti do CIDR | server |
| `eventsource-parser` | 3.1.0 | MIT | 2026-05-27 | Parsování SSE v testech a v Node klientovi | testy |
| `bowser` | 2.14.1 | MIT | 2026-02-08 | Volitelné, hrubé určení prohlížeče pro zobrazení v timeline | server |

Nic z toho neběží v prohlížeči. Web SDK má **nula závislostí**, což je podmínka rozpočtu 5 kB.

### 11.2 Knihovny, které jsme zamítli, a proč

| Balíček | Verze | Licence | Důvod zamítnutí |
|---|---|---|---|
| `ua-parser-js` | 2.0.10 | **AGPL-3.0-or-later** | Copyleft. Přímý konflikt s MIT distribucí. Toto je druhý konkrétní úlovek licenční brány po `czech-inflection`. Pozor: verze 1.0.40 je ještě MIT, takže povrchní kontrola „ua-parser-js je MIT" projde a stejně to bude špatně |
| `device-detector-js` | 3.0.3 | **LGPL-3.0** | LGPL je podle pravidel z kapitoly 3 zadání zakázaná, v JavaScriptu se knihovna bundluje |
| `isbot` | 5.2.1 | Unlicense | Není na povoleném seznamu (MIT, Apache-2.0, BSD, ISC). Unlicense je veřejné vlastnictví a je prakticky bezpečná, ale rozšíření seznamu je rozhodnutí, které nepatří do této části. Používáme `crawler-user-agents` |
| `lru-cache` | 11.5.2 | BlueOak-1.0.0 | Totéž, není na seznamu. Cache odkazů je 40 řádků kódu, knihovna není potřeba |
| `pg_partman` | | PostgreSQL | Licence je v pořádku, ale je to rozšíření databáze a vyžaduje superuživatele. Rozporuje slib „připoj si vlastní Postgres". Viz 3.14.1 |
| `maxmind` a GeoLite2 databáze | | data pod vlastní licencí MaxMind | Ukládání země je ve výchozím stavu vypnuté. Když si ho uživatel zapne, dodá si databázi sám a přijme její podmínky. Do image se nebalí |

### 11.3 Go strana (sender)

| Balíček | Licence | Účel |
|---|---|---|
| `crypto/hkdf` (standardní knihovna, od Go 1.24) | BSD-3-Clause | Odvození `K_tracking` |
| `crypto/hmac`, `crypto/sha256`, `encoding/base64` | BSD-3-Clause | Podpis a kódování tokenu |
| `github.com/google/uuid` | BSD-3-Clause | Práce s binární podobou UUID |

Sender nepotřebuje pro tokeny **žádnou** závislost mimo standardní knihovnu (kromě UUID, které používá i jinde). Je to jeden z důvodů, proč je formát navržený takhle a ne jako JWT. Původní návrh uváděl `golang.org/x/crypto/hkdf`; část 1 správně upozorňuje, že HKDF je ve standardní knihovně od Go 1.24, takže externí balíček není potřeba.

### 11.4 Co si nevybírám, protože to vybrala část 1

`rate-limiter-flexible` (ISC) pro rate limiting, `hono` (MIT) pro routing veřejných endpointů, `pino` (MIT) pro logování, `next-intl` (MIT) pro i18n, `uuid` (MIT) pro UUIDv7. Používám je, ale volbu ani ověření licence si nepřivlastňuju.

---

## 12. Požadavky na ostatní části

### 12.1 Část 4b (sender, Go)

Nejtěsnější vazba v projektu. Odpověď na dotazy z tvé zprávy je v 3.1: **formát je zmrazený v části 1, sekce 4.10.3, a je jiný, než jsi předpokládal.** Konkrétně: žádný JSON (souhlas s tvou obavou, `encoding/json` a `JSON.stringify` se rozejdou), pevný binární layout, ale `type` je ASCII znak, ne číslo, celý blok včetně MAC je v jednom base64url, MAC se počítá nad **binárním** vstupem s prefixem `"openengage/token/v1"`, ne nad textovou podobou.

Tvoje předpoklady, které **platí**: token neobsahuje čitelný e-mail; HMAC se zkracuje na 16 bajtů; prefix `t1` a jeho kontrola před vším ostatním; base64url bez paddingu; open a click token **neexpirují**. Tvoje předpoklady, které **neplatí**: `salt` je `"openengage/v1"` a `info` je `"openengage/v1/tracking-token"` (ne `"tracking-token"`), a `SECRET_KEY` se před HKDF **dekóduje z base64url na 32 bajtů**, nepoužívá se jako řetězec.

1. **Implementovat formát podle 4.10.3 části 1** a projít testem proti `packages/contracts/fixtures/token/vectors.json`. Vektory jsem přepočítal nezávisle a sedí, viz 3.1.3.
2. **Token typu `o`** pro každou zprávu, když `campaigns.track_opens = true`, plus pixel podle 3.2.1 těsně před `</body>`. Do plain textu nikdy.
3. **Token typu `c`** pro každý zaregistrovaný odkaz, když `campaigns.track_clicks = true`. **`link_id` je `campaign_links.id` (UUID), ne pořadové číslo.** Podle něj se dohledává cíl přesměrování, takže musí sedět přesně.
4. **Nepřepisovat** odkazy uvedené v 3.4.1: `mailto:`, `tel:`, `sms:`, kotvy, `{{ unsubscribe_url }}`, `{{ webview_url }}`, odkazy s Liquid placeholderem v `href` a odkazy, které nejsou absolutní `http(s)`.
5. **Tvůj postup s nepřepsanými odkazy je správný a je to i moje rozhodnutí.** Odkaz, který v `campaign_links` není, se nechá být. Doplňuju k tomu jednu věc: část 3 na to musí v editoru upozornit, jinak uživatel nepochopí, proč se odkaz neměří (požadavek 12.6.3).
6. **Přepisuješ odkazy i v plain textu.** To původní návrh nepředpokládal a je to správně, jinak by prokliky z textové části chyběly. Potvrzuju.
7. **`message_created_at`** je hodnota `messages.created_at` převedená na unixové sekundy, `uint32` big endian. Nesmí se dopočítávat z času odeslání ani ze `now()`, bere se z řádku, který sender claimnul. Claim dotaz v 4.10.1 ho vrací.
8. **`message_id` musí být UUIDv7** a totožné s `messages.id`. Není to kosmetika: z časové složky v UUIDv7 se odvozuje partition při dohledání zprávy (3.1.7). Bez toho každé otevření prohledá všechny partition.
9. **`workspace_id` v tokenu** musí být totožné s `messages.workspace_id`.
10. **Základ URL je `TRACKING_DOMAIN`**, ne `APP_URL`. Je to už v tabulce 4.9 části 1 ve tvém sloupci. Odkazy jsou `{TRACKING_DOMAIN}/t/o/{token}` a `{TRACKING_DOMAIN}/t/c/{token}`.
11. Sender **nesmí** logovat vyrobené tokeny v plné podobě. Do logu nejvýš prvních 8 znaků a typ.
12. K tvému návrhu **generovat tokeny v aplikaci a předávat je senderu**: zamítám, ale s vysvětlením. Znamenalo by to uložit dva tokeny ke každé zprávě v outboxu (open plus jeden na každý odkaz), tedy u kampaně s deseti odkazy asi 900 bajtů navíc na řádek a při milionu zpráv skoro gigabajt v `messages`. Token je funkce dat, která už v řádku jsou, takže ho stačí spočítat. Tvoje obava o čas v tokenu je oprávněná a mezitím ji kontrakt vyřešil úplně: pole je `message_created_at`, tedy hodnota z řádku, a je stejná při každém pokusu o odeslání.
13. Sender má podle grantů v 4.10.1 části 1 `INSERT` do `message_events`. **Tuhle možnost pro open a click nepoužívej.** Události typu `open` a `click` zapisuje výhradně aplikace z trackovacích endpointů. Kdyby je zapisoval i sender, vznikly by duplicity v unikátních počtech.

### 12.2 Část 4a (kampaně, aplikační strana)

1. **DDL tabulky `message_events`** musí sedět na konvenci 2.1 části 1 (partition podle `created_at`, PK `(id, created_at)`) a musí nést `workspace_id`, `campaign_id`, `contact_id` a odkaz na zprávu **včetně obou složek jejího klíče**. Navrhované minimum:

   ```sql
   CREATE TABLE message_events (
     id                 uuid        NOT NULL DEFAULT uuidv7(),
     received_at        timestamptz NOT NULL DEFAULT now(),  -- partiční klíč, náš čas
     ts                 timestamptz NOT NULL,                -- kdy událost nastala
     workspace_id       uuid        NOT NULL,
     message_id         uuid        NOT NULL,
     message_created_at timestamptz NOT NULL,   -- druhá složka PK zprávy, viz R5 části 1
     campaign_id        uuid        NOT NULL,
     contact_id         uuid        NOT NULL,
     type               text        NOT NULL,
     -- 'sent','delivered','open','click','bounce','complaint','unsubscribe','failed'
     subtype            text        NULL,   -- 'hard','soft','transient'; u open a click třída
     link_id            uuid        NULL,   -- campaign_links.id
     -- (issued_at zaniká, čas z tokenu je message_created_at a je to složka klíče výš)
     metadata           jsonb       NOT NULL DEFAULT '{}'::jsonb,
     PRIMARY KEY (id, received_at),
     CONSTRAINT ck_message_events__type CHECK (type IN (...))
   ) PARTITION BY RANGE (received_at);

   CREATE INDEX idx_message_events__campaign_type
     ON message_events (workspace_id, campaign_id, type, ts DESC);
   CREATE INDEX idx_message_events__message
     ON message_events (message_id, message_created_at);
   CREATE INDEX idx_message_events__contact
     ON message_events (workspace_id, contact_id, ts DESC);
   ```

   `message_created_at` je přímý důsledek rozporu R5 z části 1. Bez něj nejde ze žádné události dohledat zpráva jinak než prohledáním všech partition. Já si ho při zápisu open a click spočítám z UUIDv7 podle 3.1.7 a uložím, takže při čtení už se nic dopočítávat nemusí.

2. **Uzavřený výčet, kdo do `message_events` zapisuje který typ** (odpověď na P5.14 od části 4b, která správně chtěla výčet povolení místo výčtu zákazů):

   | `type` | Zapisuje | Poznámka |
   |---|---|---|
   | `delivered`, `bounce`, `complaint` | část 4a | Z událostí providera |
   | `open`, `click` | **část 5** | Z trackovacích endpointů |
   | `unsubscribe` | část 2 | Z odhlašovacího endpointu |
   | `circuit_breaker_open` | část 4b | Pozastavení kampaně senderem, řádově jednotky na kampaň |

   Cokoliv mimo tenhle výčet je chyba a `ck_message_events__type` to musí odmítnout.

   **Typy `sent` a `failed` v tomhle výčtu nejsou a je to změna oproti mé předchozí verzi.** Nález části 4b (P5.15) je správný: `sent` znamená jeden `INSERT` navíc na každou odeslanou zprávu, tedy dva miliony zápisů místo jednoho u milionové kampaně, a stav přitom už je na řádku `messages`. Prošel jsem, co z toho v této části skutečně čtu, a je to jen `campaign_stats.sent`, `campaign_stats.failed` a graf průběhu. Všechno tři jde odvodit z `messages` a je to popsané v 3.9.5.

   **Praktický důsledek pro sender:** v běžném provozu nezapisuje do `message_events` **nic**. Když se `render_warning` přesune do vlastní tabulky (bod 3), zbude mu jediný typ `circuit_breaker_open`, což je řádově jednotky řádků na kampaň. Stojí pak za zvážení, jestli mu grant `INSERT ON message_events` nechat vůbec, nebo to udělat přes samostatnou tabulku a hranici ještě zúžit. Rozhodnutí je části 1, z mého pohledu je užší lepší.

3. **`render_warning` se agreguje, nezapisuje se po jednom.** Návrh části 4b beru i s odůvodněním: kampaň na 50 000 příjemců, kde šablona sahá na pole, které polovina kontaktů nemá, vyrobí 25 000 řádků nesoucích tutéž informaci. Nese to nulovou informaci navíc oproti jednomu řádku s počítadlem a přitom to zdvojnásobí objem `message_events` u té kampaně.

   Tvar: jeden řádek na trojici (kampaň, kód varování, cesta), `message_id` je `NULL`, počet v `metadata`:

   ```
   type = 'render_warning'
   message_id = NULL, message_created_at = NULL
   metadata = { "code": "missing_value", "path": "contact.attributes.city",
                "count": 24187, "first_message_id": "...", "sample": ["...", "..."] }
   ```

   Sender ho drží v paměti a zapisuje jednou za 10 sekund a na konci kampaně přes `INSERT ... ON CONFLICT (campaign_id, code, path) DO UPDATE SET count = count + excluded.count`. To vyžaduje unikátní index a tedy `UPDATE` právo na `message_events` pro senderovu roli, které dnes nemá (má jen `INSERT`). Rozhodnutí, jestli se rozšíří grant, nebo se agregace udělá jinam, patří části 4a a 1; z mého pohledu je čistší varianta samostatná tabulka `campaign_render_warnings`, protože `message_events` je jinak append-only a řádek s počítadlem tam koncepčně nepatří. **Doporučuju samostatnou tabulku.**

   Do reportu kampaně (5.1, panel Diagnostika) se z toho zobrazí „U 24 187 příjemců chyběla hodnota `contact.attributes.city`" s odkazem na šablonu. Je to jedna z nejužitečnějších diagnostik, jaké nástroj může dát, a bez agregace by se v ní nedalo číst.

4. **Typy `open` a `click` nezapisuje nikdo jiný než část 5.** Sender má sice `INSERT` grant, ale tuhle možnost pro ně nepoužívá (12.1.13), jinak by vznikly duplicity v unikátních počtech.
5. **Po zápisu událostí od providera zařadit job `tracking.process_provider_events`** s ID zapsaných událostí, aby se z nich daly aktualizovat `campaign_stats`. Alternativa (polling) by znamenala další dotaz každou sekundu navždy.
6. **`messages.sent_at`** musí být vyplněné, potřebuju ho pro klasifikaci skenerů (pravidlo 5 v 3.5).
7. **Idempotence příjmu SNS**: garance, že jedna událost providera se do `message_events` zapíše nejvýše jednou. Jinak budou čísla v reportech nafouknutá a `campaign_stats` se rozejde s `message_engagement`.
8. **Kampaň musí mít `track_opens` a `track_clicks`** a musí být čitelná i po dokončení, protože report se dívá zpět.
9. **Při materializaci publika naplnit `campaign_stats.materialized`**, ať report něco ukazuje ještě před odesláním.
10. **`campaign_links.id` musí být stabilní** od kompilace do konce života kampaně. Změna po odeslání by přesměrovala staré odkazy na jiné cíle. `campaign_links` **nesmí být partitionovaná**, protože redirect ji čte podle primárního klíče v horké cestě.
11. **Atribuce odhlášení ke kampani**: `unsubscribed` v `campaign_stats` potřebuje vědět, ze které kampaně odhlášení přišlo. Token typu `u` nese `message_id`, takže to jde, ale potřebuju, aby se ta informace do `message_events` zapsala.
12. **Invariant I1 z 4.10.1: všechny řádky kampaně mají `created_at` rovné `campaigns.audience_built_at` s nulovou sub-sekundovou složkou.** Nahrazuje můj původní požadavek na blízkost `created_at` a času v UUIDv7, který tímhle padá. Je to teď **jediná** věc, na které stojí dohledání zprávy z každého otevření a kliku. Scénář `OB-13` z části 1 ho testuje a to mi stačí, jen potřebuju vědět, že platí i pro zprávy přidané do kampaně dodatečně (opakovaná materializace, doslání). Když by pro ně platit nemohl, chci to vědět teď, ne až podle růstu čítače `tracking_message_lookup_miss_total`.
13. **Retence `messages` musí být stejná jako retence `message_events` a `message_engagement`**, tedy `TRACKING_RETENTION_MONTHS`. Jinak zůstanou statistiky bez zpráv nebo zprávy bez statistik.

### 12.3 Část 2 (kontakty a souhlasy)

1. **Hook `tracking.reassign_contact(from_contact_id, to_contact_id)`** při sloučení dvou kontaktů. Přepíšu `identities.contact_id`, `web_events.contact_id`, `message_engagement.contact_id`.
2. **Hook `tracking.erase_contact(contact_id, mode)`** při GDPR výmazu, režimy `anonymize` a `purge` podle 3.15.3. Vaše názvosloví přebírám, `delete` jsem měl špatně. V obou režimech dělá tracking totéž, rozdíl je jen ve vašich tabulkách.
3. **`contacts.last_activity_at`** aktualizuju já z webových událostí. Potřebuju `timestamptz NULL` a žádný trigger nad ním.
4. **`contacts.external_id`** pro nepodepsané `identify` z prohlížeče. Unikátní v rámci workspace, indexovaný, měkce mazané kontakty vyloučené částečným indexem podle 2.1 části 1.
5. **Čtecí API souhlasů** `getConsents(contact_id): { analytics, personalization, email_marketing }` s časem poslední změny.
6. **Souhlas per kontakt pro měření otevření.** Kdyby právní posouzení (6.4) došlo k tomu, že pixel vyžaduje souhlas, potřebuju příznak na kontaktu a od části 4a schopnost nevložit pixel u konkrétního příjemce. **Dnes to není v návrhu ani jedné části.**
7. **Token typu `u` (unsubscribe): ověřovací funkci dodávám já, zbytek je váš.** Zavoláte `verifyTrackingToken(token, ['u'])` z `packages/core/tracking` a dostanete rozparsovaná pole nebo chybu z katalogu 4.4. Nepište vlastní ověření, kontrola typu proti endpointu je bezpečnostní a musí být na jednom místě (3.1.2.1). Vaše je endpoint `/u/**`, stránka preferencí, stavový diagram odhlášení a zápis do `list_subscriptions`. Potřebuju od vás, abyste po odhlášení zapsali událost do `message_events` s `type = 'unsubscribe'` a `campaign_id` ze zprávy, jinak nemám z čeho spočítat `campaign_stats.unsubscribed`.
8. **Import a formuláře** by měly umět zapsat `identity_bindings` se `source = 'form'`, když formulář běží na doméně s SDK. Nemusí být v MVP 0.

### 12.4 Část 2 (segmentace nad engagementem)

1. **`contact_engagement` zakládám a udržuju já** (2.7 a 3.9.4), odpověď na váš požadavek 5.3. Přebírám váš návrh DDL s pěti úpravami, které jsou vysvětlené u tabulky; nejdůležitější je `windows_recomputed_at`, protože klouzavá okna nejdou udržovat přičítáním.
2. Operátory `otevřel`, `neotevřel`, `klikl`, `neklikl` čtou z `contact_engagement`, ne z `message_engagement` a ne z `message_events`. `message_engagement` je jeden řádek na **zprávu** a její kontaktový index je částečný, takže na „neotevřel" odpovědět neumí.
3. Varianta „otevřel" musí nabízet volbu **ověřená otevření** versus **všechna otevření**, s výchozí hodnotou „ověřená". Jinak segment „neotevřel" u Apple uživatelů nikdy nezabere a čištění databáze nebude fungovat. `contact_engagement.opens_*` počítá **jen ověřená** otevření (třída `human` a `proxy_image`), aby výchozí chování bylo správné bez další konfigurace.
4. Kampaně s vypnutým měřením se do podmínek „posledních N kampaní" nezapočítávají (3.16). Do `consecutive_no_open` se proto nezvyšují.
5. **Řádek v `contact_engagement` se zakládá líně**, až při první události kontaktu. Kontakt, kterému se nikdy nic neposlalo, řádek nemá. Segmentační dotaz proto musí být `LEFT JOIN` s `COALESCE`, ne `INNER JOIN`, jinak z presetu „nikdy neotevřel" vypadnou právě ti nejnovější kontakti.
6. **Klouzavá okna (`*_7d`, `*_30d`, `*_90d`) jsou aktuální k poslednímu nočnímu běhu**, ne k této vteřině. Absolutní hodnoty (`last_open_at`, `consecutive_no_open`, `*_total`) jsou aktuální vždy. Doporučuju presety stavět na absolutních hodnotách a okna používat jen tam, kde jinak nejde. V UI u presetu, který okna používá, patří poznámka „data k dnešní 4:15".
7. **GDPR čl. 18 respektuju** (3.8.3, krok 0): u kontaktu s `processing_restricted = true` nezakládám vazbu, nespouštím slučování a neaktualizuju `last_activity_at`. Události se ukládají anonymně. Potřebuju od vás potvrdit, že anonymní sběr je v pořádku; kdyby ne, zahodím událost úplně, je to jeden řádek.
8. **Režimy výmazu `anonymize` a `purge`** přebírám ve vašem názvosloví, viz 3.15.3. V trackingu dělají obojí totéž.
9. Operátory nad webovými událostmi („navštívil stránku X", „udělal událost Y") čtou z `web_events` přes `idx_web_events__name_created`. Potřebuju vědět dopředu, jestli budou v MVP 0, protože z toho plyne, jestli je nutný GIN index nad `properties` (2.2).

### 12.5 Část 1 (platforma)

Kontrakt 4.10.3 přebírám beze změny, jak žádá P5-1. Odpovědi na tvoje požadavky a moje protipožadavky:

**Odpovědi na P5-1 až P5-4**

| ID | Odpověď |
|---|---|
| P5-1 | Formát tokenů převzat beze změny. Sémantiku a expiraci `identity` tokenu vlastním já a je v 3.1.5 a 3.10.2: 15 minut, jednorázově, konfigurovatelné `TRACKING_IDENTITY_TOKEN_TTL_SECONDS` v rozsahu 60 až 3600. Dvě výhrady k obsahu payloadu jsou v 13.8, nejsou blokující. |
| P5-2 | Mechanismus jednorázovosti `nonce`: tabulka `identity_token_uses` (2.4), unikátní primární klíč nad `nonce`, úklidový job `tracking.cleanup_token_uses` hodinově, retence = TTL tokenu. Popis v 3.1.6 a 3.10.3. |
| P5-3 | SSE infrastruktura je v 3.13 a **rozhodnutí se změnilo**: SSE se použije jen nad HTTP/2 a HTTP/3, jinak polling. Důvod je limit šesti spojení v HTTP/1.1, podrobně v 3.13.1 a v rozporu 13.11. Indikátor stavu z 5.4 části 1 používám a v režimu polling ho držím ve stavu „připojeno". |
| P5-4 | Retence `web_events` i `message_events` je **26 měsíců**, proměnná `TRACKING_RETENTION_MONTHS`, rozsah 3 až 120. Odůvodnění v 3.15.1. Retence `messages` musí být stejná, viz 12.2.11. |

**Co potřebuju od části 1**

1. **Sloupcový grant na `web_events`.** Konvence 2.1 řadí `web_events` mezi append-only s `REVOKE UPDATE, DELETE`. To znemožňuje doplnění identity, GDPR anonymizaci i vrácení sloučení. Navrhuju `GRANT UPDATE (contact_id, identity_merge_id, erased_at) ON web_events TO openengage_app` a `GRANT DELETE ON web_events TO openengage_maintenance`. Zachová to záměr konvence (obsah události je neměnný) a pokus o `UPDATE` jiného sloupce selže hlasitě. Viz 2.2 a rozpor 13.7.
2. ~~**Pomocná funkce `uuidv7_timestamp(uuid)`**~~ **Požadavek stažen.** Po zavedení `message_created_at` do tokenu ji nepotřebuje žádná cesta v této části. Nechávám to tu přeškrtnuté, aby bylo dohledatelné, že se tím nikdo nemusí zabývat.
3. **`platform.maintain_partitions` musí obsluhovat i `web_events` a `message_engagement`.** Obojí je v seznamu partitionovaných tabulek v 2.1, takže předpokládám, že ano; potřebuju to potvrdit, protože chybějící partition znamená zastavený zápis událostí.
4. **Healthcheck musí zahrnout kontrolu existence partition pro aktuální měsíc**, jinak se chybějící partition projeví až tím, že se přestanou ukládat události, a nikdo si toho nevšimne.
5. **Doplnění pěti testovacích vektorů** do `fixtures/token/vectors.json` podle 3.1.3: implicitní versus explicitní `key_id = 1`, maximální `message_created_at` (4294967295), UUID samých `ff`, `key_id = 0` jako negativní, nadbytečné bajty na konci payloadu jako negativní.
6. **Doplnění `payload_hex` do každého vektoru.** Dnes je pořadí bajtů UUID popsané slovně. Strojově ověřitelný hex odstraní poslední místo, kde se dvě implementace můžou rozejít.
7. **Deduplikace `web_events` po přechodu na `received_at`.** Klíč `(id, received_at)` neumí zachytit opakované odeslání téže události, protože `received_at` se pokaždé liší. Řeším to aplikačně v okně 7 dní přes `idx_web_events__dedup` (2.2). Je to funkční, ale je to jediné místo v celé části, kde se na správnost spoléhá na aplikaci místo na databázový constraint. Když má část 1 lepší vzor pro tenhle případ, vezmu ho.
8. **Metriky.** Tato část vystavuje čítače v 9.1 pod prefixem `tracking_`. Potřebuju potvrdit, že `/metrics` s `METRICS_TOKEN` je to správné místo a že prefix nekoliduje.
9. **Vyloučení `/t/**` z CSRF a ze session middleware.** Jsou to veřejné bezstavové endpointy volané poštovním klientem. Předpokládám, že to plyne z rozdělení povrchů v 4.1, ale je to bezpečnostně důležité dost na to, aby to bylo napsané.
10. **`/e/track` a `/e/identify` nesmí vyžadovat `Origin` shodný s `APP_URL`.** Kód `origin_not_allowed` má v katalogu 4.2 popis „`Origin` neodpovídá `APP_URL`". U mých endpointů se porovnává proti `tracking_domains` workspace, což jsou cizí domény zákazníka. Potřebuju, aby to obecná kontrola v middleware nezablokovala dřív, než se dostane ke mně.
11. **Dva rate limity navíc** do tabulky 4.5: `POST /e/identify` 30 za minutu na IP a `POST /e/track` 600 událostí za minutu na `anonymous_id`. Zdůvodnění v 3.7.4.
12. **Doplnění konfiguračních proměnných** z kapitoly 8 do tabulky 4.9, aby existoval jeden seznam a jedno zod schéma.
13. **`TRUST_PROXY` je pro tracking kritická.** Bez správného nastavení se klasifikace otevření podle IP i rate limiting dělají nad adresou reverzní proxy. Prosím zmínku v dokumentaci u nastavení trackingu, ne jen u rate limitingu.
15. **Potvrdit, že RLS funguje nad partitionovanými tabulkami a neruší partition pruning.** `web_events` má RLS politiku `ws_isolation` a zároveň je partitionovaná podle `received_at`. Potřebuju vědět, že plánovač po aplikaci politiky pořád prořezává partition, protože na tom stojí celý výkonový rozpočet timeline (7.2 a 7.3). Když by pruning padal, je to zásadní zjištění pro celý projekt, ne jen pro mě.
16. **Sloupec `erased_at` do sloupcového grantu** z bodu 1, jinak GDPR výmaz narazí na oprávnění.
17. **`TRACKING_DOMAIN` se odvozuje z `APP_URL`, ale sender `APP_URL` v tabulce 4.9 nemá.** Nález K7 části 4b, potvrzuju ho a je to moje závislost: sender staví moje odkazy. Když operátor `TRACKING_DOMAIN` nenastaví a sender nemá z čeho odvodit výchozí hodnotu, vyrobí odkazy bez hostu a **rozbije se každý pixel a každý klik v kampani**, přitom aplikace nastartuje bez chyby. Řešení podle mě: buď `APP_URL` přidat senderu do sloupce „Kdo", nebo `TRACKING_DOMAIN` udělat pro sender povinnou. Druhá varianta je bezpečnější, protože selže při startu, ne až u příjemce.
18. **Registrace mých chybových kódů** z 4.4 v `packages/core/errors/registry.ts` a auditních akcí `tracking.merge_reverted`, `tracking.domain_added`, `tracking.domain_removed`, `tracking.identity_detached`.

### 12.6 Část 3 (obsah)

1. **Registrace odkazů do `campaign_links`** při kompilaci šablony, s pořadovým číslem `position`, které se už nikdy nezmění.
2. **Validace adres při kompilaci**: absolutní `http(s)`, maximálně 2048 znaků, žádné `javascript:`, `data:`, `vbscript:`, `file:`, žádné privátní IP rozsahy. Tohle je vstupní kontrola pro celou ochranu proti open redirectu.
3. **Varování v editoru u odkazu s Liquid placeholderem**: „Tento odkaz nepůjde měřit." Text patří do části 3, ale důvod je z 3.4.2.
4. **`{{ webview_url }}`** potřebuju pro chybovou stránku `/t/expired`, kde nabízíme webovou verzi kampaně. Když neexistuje, stránka jen odkáže na domovskou.
5. **Náhled šablony nesmí nikdy generovat trackovací tokeny.** Náhled i testovací odeslání buď tracking vypnou, nebo použijí zvláštní `message_id`, které se nepočítá do statistik. Rozhodnutí patří části 3 a 4, já jen potřebuju, aby se testovací otevření neobjevila v reportu.

---

## 13. Rozpory s hlavní specifikací a s částí 1

Kapitola obsahuje rozpory s hlavní specifikací (13.1 až 13.6) i s částí 1 (13.7 až 13.11). Části 1 jsem se v souboru přizpůsobil ve všech bodech; body níž jsou návrhy na společnou synchronizaci, ne jednostranné odchylky.

### 13.1 „Eventy jsou neměnné" versus doplnění identity

Hlavní specifikace, kapitola 5: „Eventy jsou neměnné. Nikdy se nepřepisují, jen se agregují." Část 1, konvence 2.1, to zpřísňuje na `REVOKE UPDATE, DELETE` pro `web_events`. Praktický důsledek je v 13.7.

Identity resolution ale musí do už uložených anonymních událostí doplnit `contact_id` (3.8.4), jinak by celý diferenciátor „napojení kliku na chování na webu" nefungoval zpětně a v timeline by chybělo všechno, co se stalo před identifikací.

**Návrh upřesnění, ne změny:** obsah události (`name`, `created_at`, `page`, `properties`, `context`) je neměnný. Sloupce `contact_id` a `identity_merge_id` jsou **atribuční**, ne obsahové, a smí se změnit ve dvou přesně definovaných operacích: doplnění při prvním navázání identity a jeho vrácení. Obojí je zaznamenané v `identity_merges` a auditovatelné.

Alternativa, kterou jsem zvážil a zamítl: nepsat `contact_id` do událostí vůbec a řešit atribuci až při čtení přes `identity_bindings`. Je čistší, ale timeline by pak byla spojením přes intervalové podmínky, což u sta milionů řádků znamená plán, který se nedá spolehlivě udržet pod 120 ms.

### 13.2 Identifikační token: „podepsaný" versus jednorázový

Hlavní specifikace, kapitola 4.4: „Identifikační token: krátkodobý (minuty), jednorázový, podepsaný."

Čistě podepsaný token **nemůže být jednorázový**, protože podpis neobsahuje informaci o tom, jestli už byl použit. Musí existovat serverový stav.

Řešení v 3.10: token zůstává podepsaný a bezstavově ověřitelný (což drží redirect rychlý, protože se při vydávání nic nezapisuje), a jednorázovost vynucuje unikátní primární klíč nad `nonce` v `identity_token_uses` až při spotřebování. Není to rozpor s duchem specifikace, ale je to detail, který v ní chybí a bez kterého by dva implementátoři postavili dvě různé věci.

**Vyřešeno po sladění:** část 1 dala do payloadu `nonce` právě na tohle a v P5-2 přenechává úložiště mně. Zůstává tu jen jako záznam, proč tam ten `nonce` je.

### 13.3 Web SDK a `identify` s e-mailem

Hlavní specifikace, kapitola 6.7, uvádí jako příklad:

```js
OpenEngage.identify("customer_8472", { email: "...", first_name: "Jan" });
```

Kapitola 6.1 přitom říká: „Web SDK **nesmí** podvrhnout cizí e-mail."

To si přímo odporuje. Kód z prohlížeče vidí každý a kdokoliv ho může zavolat s libovolným e-mailem.

Řešení v 3.6.3: `identify` bez podpisu smí předat jen `external_id` a neidentifikující traits. E-mail vyžaduje `options.signature` vyrobený serverem zákazníka. Ukázka v dokumentaci musí být přepsaná, jinak si první implementátor postaví díru.

### 13.4 `identities` bez historie

Hlavní specifikace, kapitola 5: `identities(workspace_id, anonymous_id, contact_id, first_seen, last_seen)`.

Tento tvar neumožňuje odpovědět na otázku „komu patřila návštěva v 14:07", když se vazba později změnila, ani auditovat, odkud vazba vznikla. Doplňuju `identity_bindings` a `identity_merges` (2.4). Není to změna rozhodnutí, je to doplnění, které si vyžádal algoritmus.

### 13.5 `message_events` bez `workspace_id`

Hlavní specifikace, kapitola 5: `message_events(id, message_id, type, ts, metadata jsonb)`.

Chybí `workspace_id`, což je v rozporu se zásadou o dva odstavce níž ve stejné kapitole („Každá tabulka nese `workspace_id`"), a chybí `campaign_id`, bez kterého musí každý report joinovat na `messages`. Tabulku vlastní část 4a, takže to jen hlásím jako požadavek (12.2.1) a jako rozpor uvnitř hlavní specifikace.

### 13.6 Bot filtr jako součást bezpečnosti

Hlavní specifikace, kapitola 9, řadí „Bot filtr na trackingu (známí crawleři, Apple Mail Privacy Protection u otevření)" mezi bezpečnostní požadavky.

Apple MPP **není bezpečnostní problém a nedá se odfiltrovat.** Je to vlastnost, se kterou se musí počítat v definici metrik. Zařazení mezi bezpečnostní opatření by svádělo k tomu, že se to „vyřeší filtrem" a čísla budou správná. Nebudou. Proto je v této části MPP řešená jako klasifikace a jako produktová otázka, ne jako filtr.

### 13.7 `web_events` nemůže být čistě append-only (rozpor s částí 1)

Část 1, konvence 2.1: „Append-only tabulky (`audit_log`, `consents`, `message_events`, `web_events`) `updated_at` nemají a mají `REVOKE UPDATE, DELETE` pro aplikační roli."

U `web_events` to nejde splnit doslova. Tři operace, které jsou v zadání této části, potřebují měnit existující řádky:

1. **Doplnění identity** (3.8.4). Anonymní návštěva před kliknutím v mailu musí po identifikaci dostat `contact_id`, jinak v timeline chybí přesně ta část, kvůli které se produkt staví.
2. **GDPR výmaz** (3.15.3). Nastavuje `contact_id = NULL` a `erased_at`.
3. **Vrácení sloučení** (3.8.5).

**Návrh: sloupcový grant místo úplného zákazu.**

```sql
REVOKE UPDATE, DELETE ON web_events FROM openengage_app;
GRANT  UPDATE (contact_id, identity_merge_id, erased_at) ON web_events TO openengage_app;
GRANT  DELETE ON web_events TO openengage_maintenance;
```

Zachovává to záměr konvence (obsah události je neměnný a nikdo ho nepřepíše) a zároveň to dělá hranici tvrdší, ne měkčí: dnes by `REVOKE UPDATE` znamenal, že se doplnění identity buď udělá pod rolí s plnými právy, nebo se neudělá vůbec. Sloupcový grant je standardní PostgreSQL a pokus o `UPDATE` jiného sloupce skončí chybou oprávnění, tedy v testu.

Alternativa, kterou jsem zvážil a zamítl: neukládat `contact_id` do událostí a řešit atribuci až při čtení přes intervaly v `identity_bindings`. Je formálně čistší, ale timeline by se z indexovaného dotazu stala spojením přes intervalové podmínky a slib „pod 120 ms při sta milionech událostí" by nešlo dodržet.

### 13.8 Identity token nese `contact_id` a neváže cílový host (rozpor s částí 1)

Kontrakt 4.10.3 části 1 definuje payload identity tokenu jako `workspace_id`(16) `contact_id`(16) `campaign_id`(16) `nonce`(8) `expires_at`(u32). Tento token se přidává do adresy stránky na webu zákazníka jako `?oe_token=...`. Mám k tomu dvě výhrady, obě řešitelné, ani jedna blokující.

**a) `contact_id` cestuje adresním řádkem prohlížeče.**

SDK ho odstraní přes `history.replaceState` co nejdřív, ale mezi načtením stránky a tím okamžikem je adresa čitelná pro každý skript na stránce, tedy i pro cizí analytiku, chatovací widget nebo reklamní pixel zákazníka. Ty si můžou odnést stabilní pseudonymní identifikátor návštěvníka. `contact_id` je navíc UUIDv7, takže prozrazuje i čas založení kontaktu.

Dopad je omezený: identifikátor platí jen v rámci jednoho workspace a sám o sobě nevede k e-mailu. Přesto je to informace, kterou tam nepotřebujeme.

**b) Token nejde svázat s cílovou doménou.**

Payload nemá místo pro cílový host, takže se při spotřebování dá ověřit jen to, že `Origin` je **některá** z registrovaných domén workspace (3.10.1, krok 11). Token vydaný pro `shop.cz` tedy jde spotřebovat i na `blog.shop.cz`. Obě domény patří témuž zákazníkovi, takže dopad je malý, ale kontrola je slabší, než měla být.

**c) Vedlejší cena: čtení v horké cestě.**

Protože token nese `contact_id` a ne `message_id`, musí ho redirect někde vzít, a jediný zdroj je `messages`. Tím se do horké cesty přesměrování vrací databázové čtení, kterému se návrh vyhýbal (3.4.6, krok 7).

**Návrh na `t2`, až se bude formát verzovat.** Payload identity tokenu:

```
workspace_id(16) message_id(16) host_hash(8) nonce(8) expires_at(u32)   = 52 bajtů
host_hash = prvních 8 bajtů SHA-256 z cílového hostu v malých písmenech
```

Je o 8 bajtů kratší než dnešní, řeší všechny tři body naráz (kontakt se dohledá serverově až při spotřebování, mimo horkou cestu) a `campaign_id` se dopočítá ze zprávy. **Nenavrhuju to měnit teď**, kontrakt je zmrazený a cena zmrazení je nižší než cena změny v hodině 3 hackathonu. Patří to na synchronizaci a do seznamu pro `t2`.

**Co dělám mezitím, bez změny formátu:** token se přidává **jen** na hosty registrované v `tracking_domains` (3.4.6, krok 7), platí 15 minut, je jednorázový, a `Origin` se při spotřebování kontroluje proti doménám workspace. To pokrývá hlavní hrozbu, tedy únik identity na cizí web.

### 13.9 Chybějící `campaign_id` v open a click tokenu

Kontrakt dává open a click tokenu `workspace_id` a `message_id`. Report ale potřebuje vědět, ke které kampani událost patří, a to znamená dohledat zprávu.

**U kliku to problém není:** cíl se dohledá podle `link_id`, což je `campaign_links.id`, a z toho řádku je `campaign_id` rovnou k dispozici. Horká cesta se `messages` nedotkne.

**U otevření to problém je**, ale řeší se tím, že se kampaň dohledá až v asynchronním zpracování dávky (3.9.2), ne v horké cestě. Dotaz je díky UUIDv7 oknu (3.1.7) hledání podle primárního klíče nejvýš ve dvou partition.

Nenavrhuju změnu. Zapisuju to proto, aby bylo dohledatelné, proč open pixel nepíše `campaign_id` rovnou a proč na tom závisí invariant z 12.2.10.

### 13.10 Limit 120 požadavků za minutu na dvojici veřejný klíč a IP je nízký

Část 1, tabulka 4.5: `veřejný klíč + IP` na `POST /e/track` je 120 za minutu.

Web SDK dávkuje po 20 událostech nebo po 5 sekundách (3.6.6), takže jeden aktivní uživatel udělá zhruba 12 požadavků za minutu. Za jednou veřejnou IP (firemní NAT, škola, mobilní operátor s CGNAT) se tedy vejde **asi deset souběžných návštěvníků**, pak začnou dostávat 429 a jejich chování se do timeline nedostane.

To je málo. Návrh: **1 200 za minutu** na dvojici klíč a IP, případně limit počítat v událostech (`6 000 událostí za minutu na klíč a IP`) místo v požadavcích, aby dávkování nebylo penalizované.

Limit na samotný klíč (6 000 za minutu) považuju za rozumný a neměnil bych ho.

Není to blokující, ale projeví se to až v provozu u zákazníka s firemním publikem a bude se to hledat těžko, protože z pohledu marketéra prostě „chybí data".

### 13.11 SSE nad HTTP/1.1: změna oproti hlavní specifikaci i oproti P5-3

Hlavní specifikace, kapitola 8, track D: „SSE pro živý průběh odesílání." Část 1, P5-3, ode mě chce „SSE infrastrukturu včetně chování při odpojení a limitu souběžných spojení".

**Dodávám ji, ale SSE není výchozí režim.** Prohlížeč drží v HTTP/1.1 nejvýš 6 spojení na původ a SSE spojení se nikdy neuzavře, takže šest otevřených karet reportu aplikaci zastaví. Self-hosted instalace podle kapitoly 9 hlavní specifikace běží ve výchozím stavu na HTTP/1.1 a HTTP/2 nemůžeme vyžadovat, aniž bychom porušili slib „docker compose up a za pět minut to běží".

Rozhodnutí a odůvodnění je v 3.13: detekce protokolu přes `nextHopProtocol`, SSE jen nad `h2` a `h3`, jinak polling s `ETag`, a v obou režimech jedno spojení na prohlížeč přes volbu vůdce v `BroadcastChannel`.

Praktický důsledek pro uživatele je nulový (čísla se aktualizují tak jako tak), ale pro formulaci v hlavní specifikaci a v části 1 to znamená, že „SSE" je implementační detail jednoho ze dvou režimů, ne slib.
### 13.12 Rozsah MVP 0

Hlavní specifikace, kapitola 8, track D: „Web SDK v základní verzi (page_view, identify, consent)".

Tahle část specifikuje SDK podstatně bohatší (session, dávkování, offline fronta, `reset`, `flush`). Na hackathon se dá řezat v tomto pořadí, aniž se rozbije demo skript: offline fronta v `localStorage`, `reset`, `flush`, session timeout (natvrdo 30 minut), dávkování (posílat po jedné události). **Neřezatelné** je: souhlas jako vstupní podmínka, `sendBeacon` při odchodu ze stránky, kontrola `Origin`.


---

## 14. Otevřené otázky

| # | Otázka | Kdo rozhoduje | Proč to nejde rozhodnout tady |
|---|---|---|---|
| 1 | Je pixel v e-mailu podle čl. 5(3) ePrivacy podmíněný souhlasem, nebo ho pokrývá souhlas s e-mailovým marketingem? | právník, ne technik | EDPB Guidelines 2/2023 to výslovně řeší, ale závěr závisí na výkladu a na trhu. Z odpovědi plyne požadavek 12.3.6, který dnes nikdo nevlastní |
| 2 | Je `anonymize` (odstranění `contact_id` z událostí) dostatečná anonymizace podle GDPR, nebo je nutné mazat? | právník | Ovlivňuje výchozí hodnotu v 3.15.3 a to, jestli výmaz rozbije historické reporty |
| 3 | Je odvolání souhlasu `personalization` důvod odstranit `contact_id` i ze **starých** událostí? | právník | Návrh je nechat je, protože vznikly za platného souhlasu. Opačný výklad je obhajitelný |
| 4 | Hlavní metrika na dashboardu: proklik, nebo otevření? | produkt (Petr) | Je to proti zvyklostem oboru a proti očekávání uživatelů z Ecomailu. Viz 0.7 otázka 1 |
| 5 | Odečítat automatická otevření vždy, nebo přepínačem? | produkt | Návrh: vždy zobrazovat oboje, bez přepínače. Klaviyo a Mailchimp mají přepínač |
| 6 | Ukládat zemi z IP adresy? | produkt plus právník | Výchozí návrh je vypnuto |
| 7 | Retence per workspace, nebo jen globální? | produkt | Per workspace znamená mazání řádků místo dropu partition, tedy podstatně dražší údržbu. Návrh: MVP 0 globální |
| 8 | Sledovat pozici odkazu (dva odkazy na stejnou URL zvlášť)? | produkt | Návrh: ano. Po sladění s částí 1 je `link_id` samostatné UUID na každý odkaz, takže se to děje samo. Otázka je jen, jestli to zobrazovat |
| 9 | Rozšířit povolený seznam licencí o Unlicense, CC0 a BlueOak-1.0.0? | část 1 | Odblokovalo by to `isbot` a `lru-cache`. Bez toho si píšeme obojí sami, což je pár desítek řádků |
| 10 | Je 15 minut správná platnost `oe_token`? | produkt | Kompromis mezi bezpečností a scénářem „vrátím se k tomu později" |
| 11 | Kdy se ověří, že Apple stále posílá `User-Agent: Mozilla/5.0`? | tým, empiricky | Celá klasifikace MPP na tom stojí. Nutné ověřit na skutečném Apple Mail účtu **před** hackathonem a pak průběžně sledovat metriku |
| 12 | Bude segmentace nad `properties` webových událostí v MVP 0? | produkt plus část 2 | Z odpovědi plyne, jestli je potřeba GIN index (2.2), což mění výkonový rozpočet zápisu |
| 13 | Kdo vlastní `message_events`, když do ní zapisují dvě části? | synchronizace 4a a 5 | Návrh: DDL vlastní 4a, typy `open` a `click` zapisuje 5 |
| 14 | Bude sender číst `campaign_links` z databáze, nebo je dostane v `render_data`? | část 4 | **Zodpovězeno částí 1:** granty v 4.10.1 dávají senderu `SELECT` na `campaign_links`, takže čte z databáze. Zůstává jen požadavek na stabilitu `campaign_links.id` (12.2.8) |
| 15 | Přijmout návrh na sloupcový grant u `web_events`, nebo trvat na úplném `REVOKE UPDATE`? | část 1 | Bez jedné z těch dvou možností nejde postavit doplnění identity ani GDPR anonymizace. Podrobně 13.7 |
| 16 | Zvýšit limit `veřejný klíč + IP` na `/e/track` ze 120 na 1 200 za minutu? | část 1 | Za firemním NATem se dnes vejde asi deset souběžných návštěvníků. Podrobně 13.10 |
| 17 | Doplnit do payloadu identity tokenu vazbu na cílový host a nahradit `contact_id` za `message_id`? | synchronizace 1 a 5 | Kontrakt je zmrazený, takže **ne teď**. Patří to do seznamu pro `t2`. Podrobně 13.8 |
| 18 | Je aplikační deduplikace `web_events` v okně 7 dní přijatelná? | část 1 | Klíč `(id, received_at)` duplicitu nezachytí, protože `received_at` se při opakování mění. Podrobně 2.2 a požadavek 12.5.7 |
| 19 | Je detekce protokolu přes `nextHopProtocol` dostatečná, nebo má být SSE zapínatelné konfigurací? | tým | Návrh: automatická detekce bez přepínače. Přepínač znamená, že si ho někdo zapne na HTTP/1.1 a bude hlásit, že se mu aplikace zasekává. Podrobně 3.13.2 |

