# Část 6: UI a UX

Vlastník: part6-uxui
Datum: 2026-07-31
Rozvíjí kapitoly hlavní specifikace: průřezově 6.1 až 6.8, 7, 8 (zejména demo skript v kapitole 8)
Stav: koncept

---

## 0. Pro netechnického recenzenta

Tuhle sekci čtěte, i když nedělám do kódu ani do designu. Zbytek dokumentu je pro implementátory.

### 0.1 Zadání a jak jsem ho vzal

Zadání znělo: *"Potřebujeme, aby to bylo uživatelsky naprosto dokonalé, pochopitelné, každá akce, co se stane, byla uživateli řádně vysvětlena a věděl, že se něco stalo. Prostě dokonalé tak, aby to dokázala obsluhovat i babička."*

Beru to vážně a je to správná laťka. Zároveň to není splnitelné doslova a předstírat opak by byl nejrychlejší způsob, jak postavit nástroj, který lže. Rozhodovací pravidlo, které jsem použil na každou obrazovku, zní:

> **Uživatel nemusí rozumět tomu, jak e-mail funguje. Musí vždycky vědět, co se právě stalo, co se stane teď a co má udělat dál. Když je něco z podstaty technické, buď to uděláme za něj, nebo mu pomůžeme to předat někomu, kdo to umí. Nikdy ho s tím nenecháme samotného a nikdy nepředstíráme, že je to jednoduché, když není.**

Z toho plynou čtyři strategie, které používám opakovaně a které stojí za to si zapamatovat, protože se objevují v celém dokumentu:

| Strategie | Kdy ji použít | Příklad v produktu |
|---|---|---|
| **Zjednodušit** | Úloha je složitá jen kvůli tomu, jak se historicky dělá | Segment se skládá z vět, ne z operátorů AND a OR |
| **Odstínit** | Uživatel nepotřebuje vědět, že úloha existuje | Suppression list se plní sám, uživatel se o něj nemusí starat |
| **Delegovat** | Úloha patří někomu jinému a uživatel na ni nemá přístup ani znalosti | DNS záznamy se pošlou správci webu jedním odkazem |
| **Poctivě vysvětlit** | Nejde ani jedno z předchozího a špatné rozhodnutí bolí | Proč jsou otevření nepřesná, proč Amazon zablokuje účet |

Pátá možnost, **"nedělat nic a doufat"**, není v tomhle dokumentu použitá ani jednou.

### 0.2 Co uživatel uvidí

Aplikace má šest hlavních míst a nic víc. To je vědomé, protože každá další položka v menu je další rozhodnutí, které musí uživatel udělat, než se dostane k práci.

| Kde | Co tam dělá |
|---|---|
| **Přehled** | Co se děje teď. Běžící rozesílky, poslední kampaně, upozornění na problémy. Do první kampaně tady stojí seznam kroků, který uživatele provede. |
| **Kontakty** | Lidé, seznamy, štítky, segmenty, import. Vypadá to jako tabulka, protože každý ví, co je tabulka. |
| **Kampaně** | Rozepsané, naplánované, odeslané. U každé odeslané její report. |
| **Šablony** | Vzhledy e-mailů, editor, AI asistent. |
| **Statistiky** | Doručitelnost a vývoj v čase napříč kampaněmi. |
| **Nastavení** | Odesílání a domény, uživatelé, klíče k API, jazyk, zálohy. |

Nahoře je vždycky přepínač projektu (jeden projekt bývá jeden klient nebo jedna značka), vyhledávání a ikona **Úloh**, kde se dá kdykoliv podívat, co běží na pozadí.

### 0.3 Čím se to bude lišit od konkurence

**Upozornění na míru jistoty.** Průzkum konkurence, který jsem si zadal, se do uzávěrky nevrátil s ověřenými nálezy. Srovnání níž vychází z mé znalosti těchto nástrojů, **není ověřené proti jejich aktuálním verzím** a je potřeba ho před finalizací potvrdit. Věty, které tvrdí něco o konkurenci, jsou označené jako **[neověřeno]**. Návrh sám na tom nestojí: každý bod obstojí jako rozhodnutí i tehdy, kdyby se ukázalo, že to někdo jiný dělá stejně.

Vycházel jsem z Ecomailu jako české reference a z Mailchimpu, Klaviya, Brevo, Customer.io, Loops a Listmonku jako srovnání. Rozdíly, na které sázím:

1. **Kampaň se odesílá z jedné stránky s kontrolním seznamem, ne z vícekrokového průvodce.** [neověřeno: předpokládám, že Ecomail i Mailchimp vedou uživatele průvodcem.] Průvodce vypadá vlídně, ale uživatel v něm ztratí přehled o celku a každá pozdější změna znamená projít kroky znovu. Kontrolní seznam ukáže všechno najednou, u každé položky je zeleně nebo červeně vidět, jestli je hotová, a dá se skočit rovnou tam, kde je problém.

2. **Po odeslání je šedesát sekund na zrušení.** Není to originální nápad, Gmail má "Vrátit odeslání" léta. [neověřeno: nakolik je to v e-mailingových nástrojích běžné.] Je to jediná ochrana proti nevratné akci, která nikoho neotravuje, protože nic nestojí. Všechny ostatní ochrany (potvrzovací dialogy, opisování názvu kampaně) daň platí každý den.

3. **Číslo je na tlačítku.** Nepíšeme "Odeslat kampaň", píšeme **"Odeslat 12 480 e-mailů"**. Kdo se chystá poslat mail na dvanáct tisíc lidí, ale myslel si, že jde o testovací skupinu padesáti, to uvidí v poslední vteřině. Stojí to nula úsilí navíc.

4. **DNS záznamy se dají poslat správci webu jedním odkazem.** Tohle je moje hlavní odpověď na "zvládne to babička". Nezvládne, ale nemusí. Vygenerujeme odkaz, který otevře jen tu jednu stránku se záznamy, bez přihlášení do nástroje, a k tomu předepsaný e-mail, který stačí odeslat. Když se záznamy objeví, přijde uživateli zpráva, že je hotovo. [neověřeno: nakolik je delegace DNS na třetí osobu v těchto nástrojích běžná. I kdyby ji někdo měl, je to správné řešení.]

5. **Nikdy neukazujeme otevření jako hlavní číslo.** [Toto rozhodnutí je potvrzené v tom smyslu, že ke stejnému závěru došla nezávisle i část 5, viz její kapitola 0.4.] Od roku 2021 si Apple Mail obrázky v e-mailech stahuje sám, takže vyrábí otevření, která se nikdy nestala. Kdo staví rozhodnutí na míře otevření, staví na písku. Hlavní čísla v reportu jsou proto **doručeno, kliklo, odhlásilo se**. Otevření je vidět taky, ale o patro níž a vždycky s vysvětlením.

6. **Segment se skládá z vět a ověřuje se na jménech.** Nad každým segmentem je česká věta ("Kontakty, které splňují všechny tyto podmínky") a pod ním živý počet **plus pět konkrétních lidí, kteří do něj patří**. Netechnický člověk neumí ověřit logický výraz, ale okamžitě pozná, jestli mezi pěti jmény sedí ti, koho měl na mysli. Tohle považuju za nejlevnější a nejúčinnější prvek celého návrhu.

7. **Prázdná obrazovka učí.** Prázdný seznam kontaktů neříká "Zatím tu nic není". Vysvětlí, co jsou kontakty, jak se sem dostanou, a nabídne import, formulář i ukázková data.

### 0.4 Kde je premisa "zvládne to babička" nesplnitelná a jak jsem to obešel

Tohle je nejdůležitější část mého výstupu a čekal bych, že se o ní budeme bavit nejvíc.

| # | Nesplnitelné místo | Proč to nejde zjednodušit | Co jsem s tím udělal |
|---|---|---|---|
| 1 | **DNS záznamy pro DKIM, SPF a DMARC** | Doména bývá v cizí správě, nástroj do ní nevidí, změna se projeví za minuty až hodiny a chyba je neviditelná. Není to naše rozhraní ani naše data. | **Delegace.** Odkaz pro správce webu bez přihlášení, předepsaný e-mail, návod pojmenovaný podle skutečného poskytovatele (Wedos, Forpsi, Cloudflare, Active24), automatická kontrola na pozadí a zpráva, až to projde. Plus **zkušební režim**, kde se celý nástroj používá bez DNS, jen s odesíláním na vlastní ověřené adresy. Bez DNS se produkt nezasekne. |
| 2 | **Založení účtu u Amazonu a klíčů k SES** | Cizí konzole, cizí registrace, platební karta, IAM oprávnění. Nemáme na to vliv a nesmíme to obejít. | **Nabídnout snazší cestu jako výchozí.** SMTP od hostingu, který většina českých firem už má, je první volba a je označená jako doporučená pro objemy do zhruba dvou tisíc e-mailů denně. SES je druhá volba pro ty, kdo rostou, s poctivým odhadem "zabere to asi 30 minut a potřebujete přístup k firemnímu účtu AWS". Plus hotová šablona pro AWS CloudFormation, která vyrobí správně omezeného uživatele a vypíše dva údaje ke zkopírování. |
| 3 | **Proč Amazon zablokuje účet při stížnostech na spam** | Je to skutečné riziko s finančním dopadem a nedá se odstínit, protože reakce musí přijít od uživatele (přestat posílat na starou databázi). | **Odstínit, co jde, a vysvětlit až v okamžiku, kdy na tom záleží.** Suppression list se plní automaticky, takže uživatel je v bezpečí, i když netuší, že existuje. Vysvětlení se ukáže teprve tehdy, když čísla zčervenají, a to konkrétní větou "z posledních 5 000 e-mailů si 8 lidí stěžovalo na spam, to je čtyřikrát víc, než Amazon toleruje" plus tři konkrétní kroky. Ne kurz doručitelnosti na uvítanou. |
| 4 | **Logika AND a OR v segmentech** | Lidé si "a" v běžné řeči vykládají opačně, než jak funguje v logice ("zákazníci z Prahy a z Brna" znamená v řeči sjednocení, v logice prázdnou množinu). | **Zjednodušit a ověřit na datech.** Žádné AND a OR v rozhraní, místo toho výběr "splňují všechny podmínky / splňují alespoň jednu". Nad tím česká věta, pod tím počet a **pět skutečných jmen**. Když segment vyjde prázdný, nástroj řekne, která konkrétní podmínka ho vyprázdnila. |
| 5 | **Míra otevření je z principu nepravdivá** | Apple Mail Privacy Protection generuje falešná otevření a my je nikdy nespočítáme přesně. | **Poctivě vysvětlit a změnit hierarchii.** Hlavní metrikou je kliknutí. Otevření je uvedené o patro níž, rozdělené na "pravděpodobně automatická" a "potvrzená kliknutím", s vysvětlením na jedno kliknutí. Nikdy neukážeme jedno velké číslo, o kterém víme, že je nafouknuté. |
| 6 | **Vizuální editor e-mailu ovládaný myší** | Skládání bloků tažením myši je pro část uživatelů (motorika, čtečka obrazovky, jen klávesnice) nepoužitelné a e-mailový layout má tvrdé technické limity. | **Klávesová alternativa jako povinnost, ne jako doplněk.** Každý blok má v nabídce "Posunout nahoru", "Posunout dolů", "Duplikovat", "Smazat". Tažení myší je zrychlení pro toho, kdo ho zvládne, ne jediná cesta. Je to zároveň požadavek přístupnosti (WCAG 2.2, kritérium Dragging Movements). |
| 7 | **Docker compose a příkazová řádka při instalaci** | První obrazovka produktu je terminál a s tím nic neuděláme, protože je to self-hosted nástroj. | **Nechat to na tom, kdo instaluje, a nezatěžovat tím toho, kdo pak pracuje.** Instalaci dělá jednou technický člověk. Požadavek na část 1 je, aby kontejner vypsal čitelný rámeček s adresou a aby dvě nejčastější chyby (obsazený port, nedostupná databáze) měly srozumitelnou hlášku s návodem. Od okamžiku otevření prohlížeče už příkazová řádka nikde není potřeba. |

**Shrnutí jednou větou:** babička nenastaví DKIM. Ale babička může v tomhle nástroji vytvořit kampaň, poslat ji na segment, který si sama poskládala, a rozumět reportu, který dostane, aniž by kdy věděla, co DKIM je. To považuju za splnitelnou a poctivou verzi zadání.

### 0.5 Na co jsem narazil a nevyřešil

- **Zkušební režim je pohodlný a je to riziko.** Uživatel v něm může strávit týden, postavit si kampaň na 20 000 lidí a teprve pak zjistit, že bez DNS ji neodešle. Řeším to tím, že zkušební režim je vidět v hlavičce pořád a na obrazovce kampaně je nepřehlédnutelný pruh. Jestli to stačí, ukáže až testování s lidmi.
- **Šedesát sekund na zrušení je kompromis.** Delší okno je bezpečnější, ale zdržuje a při naplánovaném odeslání nedává smysl. Navrhuju 60 s jako výchozí a nastavitelné 0 až 300 s na úrovni projektu.
- **Neumím zaručit, že uživatel pochopí rozdíl mezi seznamem a segmentem.** Je to rozdíl, na kterém stojí celý datový model (seznam je ruční, segment se počítá sám), ale v hlavě netechnického člověka to splývá. Zmírňuju to pojmenováním a ikonami, ale je to místo, kde bych chtěl vidět reálné testování.
- **Dvě věci jsem nestihl ověřit a je to v dokumentu poctivě označené.** První je srovnání s konkurencí (viz upozornění v 0.3), druhá je evropská legislativa o přístupnosti (viz 11.2). Ani jedno nemění návrh, obojí by mělo být doplněné před finalizací. Naopak ověřené je všechno o knihovnách (kapitola 16) a o normě WCAG (11.1), a to ověřování přineslo dva konkrétní licenční nálezy.

### 0.6 Otázky pro recenzenta

Všechny jdou zodpovědět bez znalosti kódu.

1. **Souhlasíte s tím, že hlavní metrikou v reportu bude kliknutí, a ne otevření?** Je to poctivější, ale je to proti zvyku. Klient, který je zvyklý na Ecomail, se zeptá, kde je míra otevření. Bude o patro níž a s vysvětlením. Nebo ji máme dát nahoru a jen ohvězdičkovat?
2. **Je šedesát sekund na zrušení odeslání dost, málo, nebo zbytečné?** Alternativa je klasické potvrzení opsáním názvu kampaně, které je otravnější a chrání hůř.
3. **Má se zkušební režim (odesílání jen na vlastní ověřené adresy bez nastavení DNS) nabízet hned při prvním spuštění?** Zrychlí to první zážitek z nástroje, ale odloží nastavení, které stejně dřív nebo později přijít musí.
4. **Chceme do produktu ukázková data** (dvě stě smyšlených kontaktů, jedna odeslaná kampaň s reportem), aby si člověk mohl prohlédnout report dřív, než něco odešle? Je to velká pomoc při prvním seznámení a malé riziko zmatení.
5. **Vykání ve všech textech rozhraní, i v tlačítkách a chybách. Souhlas?** Tykání by bylo modernější a mladší nástroje jako Loops nebo Resend by v češtině nejspíš tykaly, ale cílový zákazník je česká firma a agentura, a tam je vykání bezpečnější. Pozor, tón oslovení v odesílaných e-mailech je něco jiného a nastavuje se zvlášť.
6. **Jak pojmenovat "merge tag" česky?** Navrhuju **doplňovaný údaj** a v editoru tlačítko "Vložit údaj o příjemci". Ecomail používá "personalizace", Mailchimp "slučovací značky". Chci jeden název a už ho nikdy neměnit.
7. **Kolik jazyků od prvního dne?** Návrh je čeština a angličtina kompletně, se strukturou připravenou na další. Slovenština by byla levná (vokativ i skloňování už řešíme), ale je to práce navíc při každé změně textu.
8. **Je přijatelné, že smazání kontaktu nesmaže jeho historii v reportech odeslaných kampaní?** Report kampaně z minulého měsíce by se jinak zpětně měnil. Navrhuju kontakt anonymizovat a v reportech nechat jen počty. Pro GDPR je to obhajitelné, ale je potřeba to umět vysvětlit zákazníkovi.

---

## 1. Rozsah

### 1.1 Co tato část vlastní

| Oblast | Konkrétně |
|---|---|
| Interakční principy | Osm vynutitelných principů s příklady správného a špatného provedení |
| Informační architektura | Mapa aplikace, navigace, schéma URL, rozložení stránky, přepínání projektů |
| Zpětná vazba na akce | Taxonomie akcí, rozhodovací tabulka kanálů, pravidla pro toast, inline, dialog, celostránkový stav |
| Dlouhé operace | Centrum úloh, chování při zavření karty, živý průběh, notifikace o dokončení |
| Nevratné akce | Škála rizika a odstupňovaná ochrana, okno na zrušení, hromadné destruktivní akce |
| Stavy obrazovek | Katalog patnácti stavů a matice, které obrazovky který stav mají |
| Klíčové obrazovky | Detailní návrh osmi nejtěžších obrazovek produktu, plus čtyři doplněné po revizi části 2 (blokované adresy, formuláře, souhlasy a GDPR, příchozí webhooky) |
| Mikrotexty a tón | Pravidla psaní, závazný slovníček cs a en, pravidla pro tlačítka a dialogy |
| Chybové hlášky | Anatomie hlášky a katalog pětadvaceti konkrétních hlášek cs a en |
| Přístupnost | Cílová úroveň, konkrétní požadavky, způsob ověření, brána v CI |
| Lokalizace | Pravidla pro češtinu a angličtinu, pluralizace, formáty, řazení, vyhledávání |
| Požadavky na design systém | Co musí umět komponentová knihovna, kterou vybere část 1 |

### 1.2 Co vědomě nevlastní

| Oblast | Vlastník |
|---|---|
| Technická implementace design systému, volba a integrace knihovny, tokeny, build | Část 1. Tato část dodává **požadavky** v kapitole 13. |
| Datový model, DDL, API, endpointy | Části 1 až 5 podle domény |
| Blokový model šablony, katalog bloků, renderer, Liquid subset | Část 3 |
| Konkrétní obsah šablon a e-mailových textů (potvrzovací mail, odhlašovací stránka) | Části 2 a 3. Tato část dodává **pravidla tónu** a slovníček, kterými se musí řídit. |
| Metriky a jejich výpočet | Část 5. Tato část vlastní **jak se podávají**. |
| Stavový diagram kampaně, importu, double opt-in | Části 2 a 4a. Tato část vlastní **jak se stavy pojmenují a zobrazí**. |
| Autentizace, role a oprávnění | Část 1. Tato část vlastní **co uživatel uvidí, když nemá oprávnění**. |

### 1.3 Sladění s částí 1

Dokument je sladěný s `01-platforma.md` ve verzi z 2026-07-31 (3 344 řádků). Tabulka níž je výsledek porovnání mých původních předpokladů se skutečným textem. Kde se lišíme a kde si myslím, že je část 1 špatně, je to v kapitole 18.

| # | Původní předpoklad | Skutečnost v části 1 | Co jsem udělal |
|---|---|---|---|
| U1 | Next.js App Router, mutace přes server actions nebo interní API | potvrzeno, plus `middleware.ts` se v Next.js 16 jmenuje `proxy.ts` a runtime je vždy Node.js | beze změny |
| U2 | `packages/ui` jako design systém, vlastní ho část 1 | potvrzeno, Tailwind 4 plus shadcn/ui zkopírovaný do `packages/ui/src/components`, `lucide-react`, sémantické tokeny v `tokens.css` | potvrzuju volbu, viz 13.2 |
| U3 | i18n `next-intl`, ICU MessageFormat | potvrzeno, ale **klíče jsou vnořený JSON v `camelCase`, ne ploché s tečkami**, zdrojem pravdy je `en.json`, používá se kategorie `=0` | **opravil jsem 12.8 a 12.3** |
| U4 | `{ error: { type, code, message, details, request_id } }`, text skládá rozhraní | **RFC 9457 Problem Details**, `application/problem+json`. `code` je pole, podle kterého se klient rozhoduje. `detail` je lokalizovaný na serveru přes `Accept-Language`. Část 1 výslovně píše: *"Klient, který chce vlastní texty, se řídí `code` a `errors[].code`, ne textem."* | **Můj původní rozpor byl z velké části neopodstatněný a stahuju ho.** Zbývá jediná, mnohem menší potřeba: rozšiřující člen `params`. Viz U→1.1 a R6. |
| U5 | Mechanismus dlouhých úloh nad pg-boss s `progress` a `total` | v části 1 jsem nenašel | zůstává jako požadavek U→1.3 |
| U6 | Živý průběh přes SSE | potvrzeno, infrastrukturu vlastní část 5, část 1 dodává jen prvek indikátoru spojení a pravidlo, že žádná obrazovka nesmí být na živém spojení závislá | souhlasím a přebírám, viz 5.9 |
| U7 | Role `owner`, `admin`, `editor`, `viewer` | potvrzeno, plus **úplná matice 45 oprávnění** tvaru `resource:action` | **použil jsem skutečné názvy oprávnění** v 7.1 (stav S11) a našel jsem v matici jeden problém, viz R18 |
| U8 | Editor je EmailBuilder.js za adaptérem | potvrzeno částí 3 | beze změny |
| U9 | (nový) Cesty | `/{locale?}/w/{workspace_slug}/{sekce}`, `localePrefix: 'as-needed'` | **přepsal jsem kapitolu 4.3** na jejich tvar |
| U10 | (nový) Stránkování | **cursor, ne offset.** `limit` 1 až 200, výchozí 50. **Celkový počet se v seznamech nevrací.** | **přepsal jsem 4.2 a 14.2.** Číslované stránkování jsem musel opustit, viz R19. |
| U11 | (nový) Časové zóny | UI podle `users.timezone`, reporty a exporty podle `workspaces.timezone`, API vždy UTC | **opravil jsem 12.4** |
| U12 | (nový) Chyby v UI | část 1 píše, že uživatel nikdy nevidí `code`, ten je v `data-error-code` kvůli testům | souhlasím pro běžné hlášky. Trvám na tom, že u chyby bez jasného řešení musí být `code` **vidět ve sbalených podrobnostech**, aby ho uživatel mohl poslat podpoře. Viz R20. |

**Část 1 v kapitole 10 nemá žádný požadavek adresovaný části 6.** Buď na ni při psaní nemyslela, nebo ode mě nic nepotřebuje. Já od ní potřebuju čtrnáct věcí, viz 17.

---

## 2. Uživatelé, úlohy a rozhodovací rámec

Návrh rozhraní bez toho, aby bylo řečeno, pro koho je, je jen názor. Tři persony níž rozhodují o každém sporu v tomhle dokumentu.

### 2.1 Tři persony

| | **Jana, marketérka** | **Petr, správce webu** | **Klára, majitelka e-shopu** |
|---|---|---|---|
| Podíl uživatelů | 70 % | 10 % | 20 % |
| Četnost použití | Denně až týdně | Dvakrát za život instalace | Jednou za měsíc |
| Umí | Excel, Facebook Ads, Canva | DNS, Docker, AWS, SQL | Objednávky, fakturaci |
| Neumí | DNS, SQL, HTML | Psát texty, vybírat segmenty | Nic z toho |
| Chce | Poslat hezký e-mail správným lidem a vidět, jestli to fungovalo | Nainstalovat to a už o tom neslyšet | Poslat jednou za čas akci a nerozbít to |
| Bojí se | Že pošle e-mail se špatným jménem nebo špatné skupině | Že to bude něco žrát a on to bude řešit | Že udělá něco nevratného |
| Rozhoduje o | Denní ergonomii, editoru, segmentech, reportu | Instalaci, DNS, zálohách, klíčích | Prvních patnácti minutách |

**Kdo vyhrává spor.** Když je konflikt mezi pohodlím Jany a pohodlím Petra, vyhrává Jana, protože nástroj používá stokrát častěji. Když je konflikt mezi rychlostí Jany a bezpečím Kláry, vyhrává Kláry bezpečí, ale jen u nevratných akcí. Jinde vyhrává rychlost, protože otravný nástroj se přestane používat a to je horší než občasná chyba, která jde vzít zpět.

### 2.2 Kompetenční matice

Co která persona zvládne sama, s návodem, nebo vůbec ne. Tohle je vstup do rozhodování, kde je potřeba delegace.

| Úloha | Jana | Petr | Klára | Řešení pro toho, kdo nezvládne |
|---|---|---|---|---|
| Instalace přes docker compose | ne | ano | ne | Petr, jednorázově |
| Vytvoření účtu a projektu | ano | ano | ano | |
| Připojení SMTP z hostingu | s návodem | ano | s návodem | Návod podle poskytovatele, test připojení jedním tlačítkem |
| Připojení Amazon SES | ne | ano | ne | Šablona CloudFormation, jinak delegace na Petra |
| Přidání DNS záznamů | ne | ano | ne | **Delegační odkaz**, viz 8.2 |
| Import CSV z Excelu | ano | ano | s návodem | Náhled s kontrolou diakritiky, viz 8.3 |
| Rozdělení jména a kontrola vokativu | ano | ano | ano | Fronta ke kontrole s návrhy |
| Postavení segmentu ze tří podmínek | s návodem | ano | ne | Hotové segmenty jako výchozí cesta, viz 8.4 |
| Úprava hotové šablony | ano | s návodem | ano | |
| Postavení šablony od nuly | ano | ne | s návodem | AI asistent, hotové šablony |
| Odeslání kampaně | ano | ano | ano | Kontrolní seznam připravenosti |
| Pochopení reportu | ano | ano | s návodem | Hierarchie metrik, vysvětlivky na kliknutí |
| Reakce na vysokou míru stížností | s návodem | s návodem | ne | Konkrétní kroky v upozornění, ne odkaz na dokumentaci |
| Obnova ze zálohy | ne | ano | ne | Petr |

Řádky, kde je "ne" u Jany i u Kláry, jsou přesně ta místa, kde musí nastoupit odstínění nebo delegace. Jsou čtyři a všechny jsou v kapitole 8.

### 2.3 Klíčové úlohy podle četnosti

Frekvence rozhoduje o tom, kolik tření si můžeme dovolit. Časté úlohy musí být bez tření, vzácné úlohy si mohou dovolit průvodce a potvrzení.

| Úloha | Četnost | Povolené tření | Cílový čas |
|---|---|---|---|
| Podívat se na report poslední kampaně | denně | žádné | do 5 s od otevření aplikace |
| Najít konkrétní kontakt | denně | žádné | do 10 s, přes globální vyhledávání |
| Odeslat kampaň | týdně | kontrolní seznam a jedno potvrzení | do 15 min od nápadu |
| Postavit nebo upravit šablonu | týdně | žádné | do 10 min s AI, do 30 min bez |
| Vytvořit segment | měsíčně | průvodce nebo preset | do 3 min |
| Naimportovat kontakty | měsíčně | průvodce s náhledem | do 5 min pro 10 000 řádků |
| Přidat člena týmu | čtvrtletně | průvodce | do 2 min |
| Nastavit odesílací doménu | jednou za instalaci | plný průvodce, delegace | do 15 min aktivní práce, plus čekání na DNS |
| Obnovit ze zálohy | téměř nikdy | cokoliv, hlavně ať to nejde udělat omylem | |

---
## 3. Principy

Deset principů. Každý je formulovaný tak, aby se dal použít jako argument v code review a aby se dal porušit rozpoznatelně. Plakátové věty typu "buďme uživatelsky přívětiví" tady nejsou, protože podle nich nejde nic rozhodnout.

### P1. Žádná akce neskončí potichu

Každá akce vyvolaná uživatelem má právě jeden **primární** kanál zpětné vazby, vybraný podle tabulky v 5.2. Nikdy nula, nikdy tři.

> **Dobře.** Uživatel odebere kontakt ze seznamu. Řádek zmizí a v levém dolním rohu se objeví "Kontakt odebrán ze seznamu Zákazníci" s tlačítkem "Vrátit zpět" na deset sekund.
>
> **Špatně.** Uživatel odebere kontakt ze seznamu. Řádek zmizí. Nic víc. Uživatel neví, jestli se to uložilo, jestli to jde vrátit, ani jestli náhodou nesmazal celý kontakt.
>
> **Taky špatně.** Řádek zmizí, objeví se toast, nahoře se objeví banner a v centru úloh přibude záznam. Tři oznámení jedné triviální akce znamenají, že uživatel přestane číst všechna.

### P2. Zpětná vazba je tam, kam se uživatel dívá

Výsledek akce se zobrazuje co nejblíž místu, kde akce vznikla. Toast v rohu obrazovky je nejslabší kanál, protože je nejdál od pozornosti.

> **Dobře.** Uživatel klikne na "Zkontrolovat" u DNS záznamu. Stav se změní přímo v řádku toho záznamu: z "Zatím nevidíme" na "Hotovo" se zelenou fajfkou.
>
> **Špatně.** Uživatel klikne na "Zkontrolovat" u DNS záznamu a v pravém horním rohu se na tři sekundy objeví "Kontrola dokončena". Uživatel se dívá na tabulku záznamů, toast si nevšimne a neví, který ze tří záznamů se zkontroloval ani jak to dopadlo.

### P3. Číslo, kterého se akce týká, je vidět v okamžiku rozhodnutí

Rozsah dopadu se nesmí dohledávat. Musí být na tlačítku, v nadpisu dialogu nebo přímo vedle nich.

> **Dobře.** `[Odeslat 12 480 e-mailů]`, `[Smazat 3 402 kontaktů]`, "Do segmentu Neaktivní patří 1 204 lidí."
>
> **Špatně.** `[Odeslat]`, `[Smazat vybrané]`, "Opravdu chcete pokračovat?"
>
> **Hraniční případ.** Když se počet ještě počítá, tlačítko říká "Odeslat kampaň" a je ve stavu čekání s poznámkou "Počítáme příjemce…". Nikdy nezobrazíme zastaralé číslo z minula.

### P4. Nevratnost se pozná dřív, než nastane

Uživatel musí vědět, že akce nejde vzít zpět, **předtím** než ji potvrdí, a musí to být napsané doslova, ne naznačené barvou tlačítka.

> **Dobře.** "Po odeslání budete mít 60 sekund na zrušení. Potom už e-maily zpátky vzít nejde."
>
> **Dobře.** "Zrušit zbytek rozesílky? Zbývajícím 9 266 příjemcům se e-mail nikdy neodešle. Už odeslaných 3 214 e-mailů se vrátit nedá."
>
> **Špatně.** Červené tlačítko "Odeslat" bez jakéhokoliv textu. Červená barva je pro barvoslepého uživatele a pro člověka ve spěchu jen barva.

### P5. Nikdy neukazujeme mrtvé tlačítko

Zakázaná akce musí říct, proč je zakázaná, a nabídnout cestu k odemčení. Zašedlé tlačítko bez vysvětlení je nejhorší možný stav, protože není ani použitelné, ani fokusovatelné čtečkou obrazovky, ani vysvětlené.

> **Dobře.** Na obrazovce kampaně je tlačítko "Odeslat 12 480 e-mailů" aktivní. Kliknutí otevře dialog, který místo souhrnu ukáže: "Kampaň zatím nejde odeslat. Chybí ověřená odesílací doména." s tlačítkem "Nastavit doménu".
>
> **Dobře, jednodušší varianta.** Tlačítko je aktivní, kliknutí přesune fokus na první blokující položku kontrolního seznamu a ta se ohlásí čtečce obrazovky.
>
> **Špatně.** Tlačítko "Odeslat" je zašedlé a nic se neděje. Uživatel klikne pětkrát a odejde.

### P6. Prázdná obrazovka učí

Prázdný stav je nejnavštěvovanější obrazovka nového uživatele. Je to příležitost vysvětlit koncept, ne omluva.

> **Dobře.** Prázdné segmenty: "**Segment je skupina kontaktů, která se sama udržuje.** Nastavíte podmínku, třeba 'nakoupili za posledních 90 dní', a nástroj do segmentu sám přidává a odebírá lidi, jak se mění jejich chování. Na rozdíl od seznamu ho nemusíte ručně aktualizovat." plus tři hotové segmenty k okamžitému použití a tlačítko "Postavit vlastní".
>
> **Špatně.** "Zatím tu nejsou žádné segmenty." plus tlačítko "Nový segment".

### P7. Nelžeme čísly

Když je číslo nepřesné, přiznáme to na místě, kde stojí, a řekneme proč a co s tím. Nikdy ne v nápovědě, do které se nikdo nepodívá.

> **Dobře.** V reportu je u otevření trvale viditelná poznámka "Část otevření vyrábějí poštovní programy automaticky" s odkazem na vysvětlení a rozpad na "pravděpodobně automatická" a "potvrzená kliknutím".
>
> **Špatně.** Velké číslo "73 % otevřelo" jako hlavní metrika reportu, protože vypadá dobře.
>
> **Taky špatně.** Otevření úplně skrýt, protože je nepřesné. Uživatel ho zná odjinud, bude ho hledat, a když ho nenajde, přestane nástroji věřit.

### P8. Jeden pojem, jeden název, žádný žargon

Slovníček v kapitole 9.2 je závazný. Když se pro tutéž věc objeví v aplikaci dvě jména, je to chyba stejné závažnosti jako špatně spočítané číslo.

> **Dobře.** Všude "Seznam blokovaných adres". V nastavení, v reportu, v hlášce importu, v API dokumentaci jako "suppression list" s poznámkou, že jde o totéž.
>
> **Špatně.** "Suppression list" v nastavení, "blacklist" v hlášce importu, "zablokované" ve filtru tabulky. Uživatel má dojem, že jsou to tři různé věci, a hledá tři různé obrazovky.

### P9. Klávesnice zvládne všechno, co myš

Není to jen požadavek přístupnosti, je to i požadavek rychlosti pro toho, kdo nástroj používá denně.

> **Dobře.** Blok v editoru se dá přesunout tažením myší i položkou nabídky "Posunout nahoru" s klávesovou zkratkou. Tabulka kontaktů se dá procházet šipkami, vybírat mezerníkem a hromadná akce se spustí z klávesnice.
>
> **Špatně.** Bloky se řadí jen tažením. Uživatel s třesem rukou, s trackpadem v vlaku nebo se čtečkou obrazovky editor nepoužije vůbec.

### P10. Rozdělaná práce se neztratí

Nedokončený obsah se ukládá automaticky. Uživatel nikdy nepřijde o práci kvůli vypršené relaci, zavřené kartě ani chybě sítě.

> **Dobře.** Editor kampaně ukládá koncept po dvou sekundách nečinnosti a v hlavičce drží stav "Uloženo v 14:32". Při ztrátě spojení se přepne na "Nepodařilo se uložit, zkoušíme to znovu" a drží změny v paměti prohlížeče, dokud se spojení nevrátí.
>
> **Špatně.** Uživatel píše dvacet minut text kampaně, vyprší mu relace a po přihlášení je stránka prázdná.

### Jak se principy vynucují

| Princip | Jak se pozná porušení | Kde se kontroluje |
|---|---|---|
| P1 | Mutace v kódu bez navázaného kanálu zpětné vazby | Code review, kontrolní seznam pull requestu |
| P2 | Toast použitý pro výsledek akce, která má viditelné místo na stránce | Code review |
| P3 | Destruktivní nebo hromadné tlačítko bez čísla v popisku | Code review |
| P4 | Potvrzovací dialog bez věty o nevratnosti | Code review |
| P5 | Atribut `disabled` na tlačítku primární akce | Lint pravidlo plus code review |
| P6 | Prázdný stav kratší než dvě věty | Kontrolní seznam obrazovky |
| P7 | Metrika s neurčitostí bez trvalé poznámky | Revize části 5 a 6 |
| P8 | Řetězec, který není ve slovníku | Skript nad katalogy překladů, viz 9.2 |
| P9 | Interaktivní prvek bez klávesové obsluhy | Automatický test a11y a ruční průchod |
| P10 | Formulář delší než tři pole bez automatického ukládání | Code review |

---

## 4. Informační architektura

### 4.1 Mapa aplikace

Šest hlavních míst, hloubka nejvýš tři úrovně. Vše, co je hlouběji, se otevírá jako panel nebo dialog nad kontextem, ne jako další stránka.

```
Přehled
Kontakty
├── Všechny kontakty          tabulka, filtry, hromadné akce
│   └── Detail kontaktu       profil + časová osa + souhlasy
├── Seznamy
│   └── Detail seznamu        členové, přihlašovací formulář, nastavení opt-in
├── Segmenty
│   └── Detail segmentu       builder, náhled, historie počtu
├── Štítky
├── Import                    průvodce + historie importů
├── Formuláře                 přihlašovací formuláře na web
│   └── Detail formuláře      pole, texty, kód k vložení, přihlášení
├── Blokované adresy          suppression list
└── Kontrola oslovení         fronta vokativu po skupinách
Kampaně
├── Přehled kampaní           filtry podle stavu
├── Detail kampaně
│   ├── Příprava              kontrolní seznam připravenosti
│   ├── Obsah                 editor
│   ├── Publikum              výběr seznamů, segmentů, vyloučení
│   └── Report                po odeslání
└── Naplánované
Šablony
├── Knihovna šablon
├── Editor šablony
└── Značka projektu           logo, barvy, písma
Statistiky
├── Doručitelnost             bounce, stížnosti, prahy
├── Vývoj v čase              napříč kampaněmi
└── Vývoj kontaktů            přírůstky, odhlášení
Nastavení
├── Projekt                   název, jazyk, časová zóna, tón oslovení
├── Odesílání                 provider, odesílací adresy, domény
├── Vlastní pole
├── Tým                       členové, role, pozvánky
├── Klíče k API
├── Webhooky                  odchozí i příchozí, s logem požadavků
├── Souhlasy a soukromí       účely souhlasu, žádosti podle GDPR, retence
├── Zálohy
└── Můj účet                  jméno, heslo, jazyk rozhraní, relace
```

**Co tady vědomě není.** Žádná položka "Nástroje", "Ostatní" ani "Pokročilé". Když se něco nedá zařadit, znamená to, že je špatně pojmenované nebo že tam nepatří.

### 4.2 Rozložení stránky

```
┌────────────────────────────────────────────────────────────────────┐
│ ⬤ Mlain Mailer  │ Projekt: E-shop Kolo ▾ │  🔍 Hledat…  │ ⚙ 3 ▾ │ JN ▾│
├──────────────┬─────────────────────────────────────────────────────┤
│              │  Kontakty                          [Import] [Nový]  │
│  Přehled     │  ┌───────────────────────────────────────────────┐  │
│  Kontakty  ▸ │  │ Filtry: Seznam ▾  Štítek ▾  Stav ▾   🔍       │  │
│  Kampaně     │  ├───────────────────────────────────────────────┤  │
│  Šablony     │  │ ☐ │ E-mail          │ Jméno    │ Stav   │ ... │  │
│  Statistiky  │  │ ☐ │ jana@firma.cz   │ Jana N.  │ Aktivní│     │  │
│  Nastavení   │  │ ☐ │ petr@firma.cz   │ Petr S.  │ Aktivní│     │  │
│              │  └───────────────────────────────────────────────┘  │
│              │  Zobrazeno 50 z 1 000+       ‹ Předchozí   Další › │
├──────────────┴─────────────────────────────────────────────────────┤
│  Zkušební režim: e-maily se odešlou jen na ověřené adresy. Nastavit │
└────────────────────────────────────────────────────────────────────┘
```

| Prvek | Chování |
|---|---|
| Přepínač projektu | Vždy vlevo nahoře. Barevný proužek projektu se propíše do levého okraje bočního menu, aby bylo poznat na první pohled, kde uživatel je. Přepnutí projektu vede vždy na Přehled toho projektu, nikdy na stejnou stránku v cizím projektu. |
| Globální vyhledávání | `Ctrl/Cmd + K`. Hledá kontakty podle e-mailu a jména, kampaně, šablony, segmenty, a nabízí akce ("Nová kampaň", "Importovat kontakty"). Vyhledávání kontaktu bez diakritiky musí najít kontakt s diakritikou, viz 12.5. |
| Ikona úloh (⚙ 3) | Počet běžících úloh na pozadí. Kliknutím se otevře Centrum úloh, viz 5.7. Když neběží nic, ikona je bez odznaku, ale zůstává, aby se dala najít historie. |
| Systémový pruh dole | Celoaplikační stavy: zkušební režim, ztráta spojení, běžící rozesílka, blížící se konec zálohy. Nejvýš jeden najednou, priorita v 7.4. |
| Boční menu | Sbalitelné na ikony. Stav sbalení se pamatuje na uživatele, ne na prohlížeč. |

**Mobilní rozložení.** Nástroj se na mobilu primárně **čte**, nepracuje se v něm. Plná podpora je pro: Přehled, report kampaně, detail kontaktu, časová osa, centrum úloh, pozastavení a zrušení rozesílky. Editor šablony, segment builder a import mobil nepodporují a řeknou to větou "Tuhle obrazovku otevřete na počítači, potřebuje víc místa" místo toho, aby se rozsypaly. Pozastavení rozesílky na mobilu je **povinné**, protože přesně to člověk potřebuje udělat, když zjistí problém a není u počítače.

### 4.3 Schéma URL

**Přebírám tvar z části 1:** `/{locale?}/w/{workspace_slug}/{sekce}`, s `localePrefix: 'as-needed'`, takže výchozí jazyk je bez prefixu. Můj původní `/p/{ws}/…` jsem opustil, jedna konvence je lepší než dvě.

Pravidlo, které k tomu doplňuju: **co si uživatel může chtít uložit do záložek nebo poslat kolegovi, musí mít URL.**

```
/                                          přesměrování na poslední projekt
/w/{slug}                                  přehled
/w/{slug}/contacts?q=&list=&segment=&order=&cursor=
/w/{slug}/contacts/{id}                    detail, záložka profil
/w/{slug}/contacts/{id}/timeline
/w/{slug}/contacts/import                  průvodce, krok v query: ?step=mapping
/w/{slug}/contacts/import/{importId}       výsledek konkrétního importu
/w/{slug}/segments/{id}
/w/{slug}/campaigns/{id}                   příprava
/w/{slug}/campaigns/{id}/content
/w/{slug}/campaigns/{id}/audience
/w/{slug}/campaigns/{id}/report
/w/{slug}/templates/{id}/edit
/w/{slug}/settings/sending
/w/{slug}/settings/sending/domains/{domain}   průvodce DNS
/w/{slug}/jobs/{jobId}                     detail úlohy, funguje i po zavření karty
/cs/w/{slug}/…                             totéž s explicitním jazykem
/d/{token}                                 delegovaná stránka DNS bez přihlášení, viz 8.2
```

**Stav filtrů, řazení a kurzoru je v query parametrech.** Důvod: uživatel si vyfiltruje "kontakty z Brna, které nikdy neotevřely", pošle odkaz kolegovi a ten uvidí totéž. Bez toho je jediná cesta popsat filtry slovy.

**Kurzor v URL má jednu vadu**, kterou je potřeba znát: odkaz na druhou stránku výsledků je platný jen do doby, než se data změní. Není to důvod kurzor opustit (offset by nad miliony řádků nefungoval vůbec), ale je to důvod, proč odkazy na tabulky vždycky nesou i filtry: když kurzor přestane dávat smysl, uživateli se ukáže první stránka **stejného filtru**, ne prázdno. Bez filtru v URL by přistál na nefiltrovaném seznamu a nevěděl proč.

### 4.4 Navigační pravidla

| Situace | Chování |
|---|---|
| Uživatel není přihlášený | Přesměrování na přihlášení s `?next=` původní adresou. Po přihlášení jde tam, kam mířil. |
| Uživatel nemá přístup do projektu v URL | Stav "Bez oprávnění" s nabídkou přepnout na projekt, do kterého přístup má. Nikdy prázdná stránka ani přesměrování bez vysvětlení. |
| Entita neexistuje nebo byla smazána | Stav "Nenalezeno" s vysvětlením, co se mohlo stát, a odkazem na seznam. U smazaných entit s auditem: "Kampaň Letní výprodej smazal Petr Svoboda 12. 6. 2026." |
| Odchod ze stránky s neuloženými změnami | Dialog "Máte neuložené změny" se třemi tlačítky: Uložit a odejít, Zahodit změny, Zůstat. Jen tam, kde automatické ukládání není možné. |
| Odchod ze stránky s běžící úlohou na pozadí | **Žádný dialog.** Úloha běží na serveru. Místo dialogu se do systémového pruhu vloží "Import běží, 4 300 z 12 000". |

Poslední řádek je důležitý a je to vědomé rozhodnutí proti zvyku. Varování "opravdu chcete odejít?" u operace, která na odchodu nezávisí, je lež a naučí uživatele zavírat všechna varování bez čtení, včetně toho jednoho, které mu jednou zachrání práci.

### 4.5 Klávesové zkratky

| Zkratka | Akce |
|---|---|
| `Ctrl/Cmd + K` | Globální vyhledávání a příkazy |
| `g` pak `p` | Přejít na Přehled |
| `g` pak `k` | Přejít na Kontakty |
| `g` pak `c` | Přejít na Kampaně |
| `g` pak `s` | Přejít na Šablony |
| `/` | Fokus do vyhledávacího pole na aktuální stránce |
| `Ctrl/Cmd + S` | Uložit (tam, kde je ruční uložení) |
| `Ctrl/Cmd + Enter` | Potvrdit hlavní akci ve formuláři nebo dialogu |
| `Esc` | Zavřít dialog, panel nebo zrušit rozdělanou akci |
| `?` | Přehled zkratek |
| `j` / `k` nebo šipky | Pohyb po řádcích tabulky |
| `x` nebo mezerník | Označit řádek |
| `Shift + klik` | Označit rozsah řádků |

Zkratky s jedním písmenem se ignorují, když je fokus v textovém poli. Přehled zkratek je dostupný přes `?` i z nabídky uživatele, protože zkratka na zobrazení zkratek je vtip, ne funkce.

---
## 5. Zpětná vazba na akce

Tohle je jádro zadání. Cíl: **uživatel po každé akci ví, co se stalo, jestli to dopadlo, a co s tím může dělat dál.** Kapitola to řeší systematicky, ne případ od případu, aby nová funkce nemusela zpětnou vazbu vymýšlet znovu.

### 5.1 Taxonomie akcí

Každá akce v aplikaci patří právě do jedné ze sedmi tříd. Třída se určí podle dvou otázek: **jak dlouho to trvá** a **jak moc to bolí, když se to pokazí.**

| Třída | Popis | Doba | Vratnost | Příklady z produktu |
|---|---|---|---|---|
| **A0** | Navigace a čtení | okamžitě | neaplikuje se | otevření detailu kontaktu, změna filtru, listování |
| **A1** | Okamžitá vratná | < 1 s | plně vratná úpravou | přejmenování segmentu, změna předmětu, přidání štítku, uložení konceptu |
| **A2** | Okamžitá nevratná drobná | < 1 s | vratná do 10 s přes Vrátit zpět | odebrání kontaktu ze seznamu, smazání štítku, archivace šablony |
| **A3** | Pomalá interaktivní | 1 s až 60 s | vratná nebo bez následku | náhled počtu segmentu, generování šablony AI, test SMTP připojení, kontrola DNS |
| **A4** | Dlouhá na pozadí | minuty až hodiny | částečně, dá se zastavit | import CSV, export, přepočet segmentu, rozesílka kampaně |
| **A5** | Nevratná zásadní | různě | nevratná | odeslání kampaně, hromadné smazání kontaktů, smazání projektu, rotace klíče k API |
| **A6** | Hromadná | podle počtu | podle obsahu | akce nad výběrem v tabulce, může spadat i do A2, A4 nebo A5 |

A6 není samostatná třída doby trvání, je to **modifikátor**: hromadná akce nad více než 20 položkami se vždycky povyšuje na A4 (běží na pozadí, má report) a hromadná destruktivní akce se vždycky povyšuje na A5.

### 5.2 Rozhodovací tabulka: co uživatel vidí před, během a po

Toto je závazná tabulka. Implementátor si nemá co vybírat.

| Třída | **Před** | **Během** | **Po (úspěch)** | **Po (selhání)** |
|---|---|---|---|---|
| **A0** | nic | skeleton nebo indikátor v obsahové oblasti po 300 ms | obsah | inline stav chyby v obsahové oblasti s tlačítkem "Zkusit znovu" |
| **A1** | nic | prvek je ve stavu čekání, zůstává čitelný | **inline**: stav "Uloženo" u prvku nebo v hlavičce formuláře, mizí po 3 s | **inline** u prvku, hodnota se vrátí na původní, hláška zůstane do opravy |
| **A2** | nic | optimisticky provedeno hned | **toast s Vrátit zpět**, 10 s | toast s chybou (bez auto-zavření) plus vrácení stavu zpět |
| **A3** | popis, co se stane, u tlačítka | **inline průběh v místě akce**, tlačítko ve stavu čekání s textem ("Kontrolujeme…"), po 10 s doplněné o odhad nebo o "Trvá to déle, než jsme čekali" | **inline výsledek v místě akce**, zůstává, dokud ho uživatel nepřepíše | **inline** v místě akce, s důvodem a další akcí |
| **A4** | dialog nebo obrazovka s **rozsahem, odhadem doby a větou, že se dá odejít** | **celostránkový nebo panelový průběh** s počty, plus záznam v Centru úloh, plus systémový pruh při odchodu | **stránka s výsledkem** (co prošlo, co ne, co stáhnout) plus záznam v Centru úloh, plus notifikace, když trvala > 5 min | stránka s výsledkem, důvod, co se stihlo, jak pokračovat |
| **A5** | **kontrolní seznam a potvrzovací dialog se souhrnem, počtem a větou o nevratnosti** | podle délky jako A3 nebo A4 | podle váhy: u odeslání kampaně **celostránkový stav s oknem na zrušení**, jinak jako A2 nebo A4 | celostránkový nebo dialogový stav s tím, co se stalo a co se nestalo |
| **A6** | vždy **přesný počet vybraných položek** v tlačítku i v dialogu | jako A4 | **report** "X hotovo, Y přeskočeno, Z selhalo" s možností stáhnout selhané | totéž, report je stejný ať dopadne jakkoliv |

**Proč zrovna takhle.** Tři odůvodnění, která stojí za to znát, protože se z nich odvozují rozhodnutí i pro věci, které v tabulce nejsou:

1. **Toast je vyhrazený pro akce, jejichž výsledek na obrazovce není vidět.** U A1 je výsledek vidět (pole má novou hodnotu), takže toast by byl šum. U A2 výsledek na obrazovce zmizel a s ním i možnost to vrátit, takže toast nese informaci, kterou jinde nedostane.
2. **Vše, co trvá déle než zhruba 10 sekund, musí přestat blokovat uživatele.** Proto je hranice mezi A3 a A4 vedená tam, kde přestává dávat smysl čekat. A3 uživatel může čekat a je informovaný, A4 nemusí čekat vůbec.
3. **Zpětná vazba u A4 a A5 nesmí existovat jen v uzavíratelném prvku.** Musí zůstat dohledatelná, protože uživatel může být pryč. Proto Centrum úloh, proto vlastní URL úlohy, proto notifikace.

### 5.3 Kanály zpětné vazby

Šest kanálů. Každý má přesně vymezené použití a je zakázáno ho použít jinde.

| Kanál | Kde | Kdy použít | Kdy nikdy nepoužít | Zavírání |
|---|---|---|---|---|
| **Inline stav u prvku** | přímo u pole nebo tlačítka | A1, A3, validace formuláře | pro věc, která se týká celé stránky | zmizí při další interakci, chyba až po opravě |
| **Inline blok v obsahu** | v obsahové oblasti | výsledek A3, prázdné stavy, chyby načtení | pro potvrzení triviální akce | zůstává |
| **Toast** | levý dolní roh | A2, potvrzení akce bez viditelného výsledku, dokončení A4 na pozadí | pro chybu, která vyžaduje akci; pro informaci, která nikde jinde není; pro víc než jednu věc naráz | 6 s u informace, **nikdy automaticky u chyby**, vždy tlačítko zavřít |
| **Dialog** | přes obsah | potvrzení A5, průvodce vyžadující rozhodnutí | pro oznámení, které nevyžaduje rozhodnutí | tlačítkem, `Esc`, kliknutím mimo (jen u nedestruktivních) |
| **Systémový pruh** | dole přes celou šířku | celoaplikační stav: zkušební režim, offline, běžící rozesílka | pro výsledek jedné akce | podle stavu, ne uživatelem |
| **Celostránkový stav** | místo obsahu | A4 a A5 s vysokou váhou: průběh rozesílky, výsledek importu | pro cokoliv, co uživatel může chtít mít vedle jiné práce | přechodem jinam |

**Toast v levém dolním rohu, ne v pravém horním.** Důvod: pravý horní roh je v této aplikaci obsazený ikonou úloh a nabídkou uživatele, a v celé řadě rozhraní je to místo, kde bydlí reklama a upozornění, takže ho lidé přeskakují (bannerová slepota). Levý dolní roh je blízko primárnímu směru čtení a nezakrývá obsah tabulek.

### 5.4 Pravidla pro toast

**Nejdůležitější věta téhle kapitoly: toast sám o sobě zadání nesplní.** Požadavek zněl "každá akce, co se stane, byla uživateli řádně vysvětlena a věděl, že se něco stalo". Automaticky mizející oznámení v rohu obrazovky tenhle požadavek **nesplňuje** ze tří důvodů:

1. **Uživatel se v tu chvíli dívá jinam.** Toast v rohu je nejdál od místa, kde akce vznikla, a po pár sekundách je nenávratně pryč.
2. **Automatické zmizení je časový limit nastavený obsahem.** Průzkum k tomu uvádí konflikt s WCAG 2.2.1 Timing Adjustable, které vyžaduje, aby šel časový limit vypnout, prodloužit nebo upravit. *(Tento konkrétní právní závěr jsem sám neověřil, dostal jsem ho z průzkumu. Praktický dopad je ale zřejmý bez ohledu na formální výklad: kdo čte pomalu, používá lupu nebo čtečku obrazovky, oznámení nestihne.)*
3. **Nejde ho zobrazit znovu.** Uživatel, kterému toast uteče, nemá kam se podívat.

Proto je toast v tomhle produktu **vždycky jen zrychlení, nikdy jediný nositel informace**. Každá zpráva, kterou toast nese, existuje současně na trvalém místě: buď přímo na stránce, nebo v Centru úloh (5.7), nebo v e-mailu. Když se pro nějakou informaci nenajde trvalé místo, znamená to, že toast není správný kanál, ne že se má výjimečně použít.

Zbytek kapitoly je o tom, jak má toast vypadat, když už se použije správně. Toast je nejzneužívanější prvek v moderních aplikacích a bez pravidel se z něj stane odpadkový koš na oznámení.

| Pravidlo | Odůvodnění |
|---|---|
| Nejvýš **tři** toasty naráz, další se řadí do fronty | Víc než tři se nedá přečíst |
| Stejná zpráva se **neopakuje**, jen se u ní zvýší počet ("Kontakt odebrán ×4") | Osm identických toastů po hromadné akci je šum |
| Informační toast mizí po **6 sekundách**, chybový **nikdy** sám | Chybu musí uživatel vidět, i když se zrovna nedíval |
| Toast s tlačítkem "Vrátit zpět" žije **10 sekund** a odpočet je vidět | Uživatel musí vědět, kolik času má |
| Toast **nikdy nenese jedinou kopii informace**. Vše, co je v toastu, je i v Centru úloh nebo na stránce | Toast může uživateli uniknout, může být pryč, může mít vypnuté animace |
| Toast se **pozastaví při najetí myší a při fokusu klávesnicí** | Jinak nejde stihnout kliknout na "Vrátit zpět" |
| Toast je dostupný z klávesnice: `Esc` zavře nejnovější, `Alt + Z` vrátí zpět poslední vratnou akci | Bez toho je "Vrátit zpět" jen pro myš |
| Toast je oznámený čtečce obrazovky přes `role="status"` (informace) nebo `role="alert"` (chyba) | Viz 11.4 |
| Toast **nikdy nepřekrývá** hlavní akční tlačítko stránky | Klasická chyba: toast po uložení zakryje tlačítko "Odeslat" |

**Zakázané použití toastu v tomto produktu:**

- Chyba, kterou musí uživatel opravit (chybějící pole, neplatný soubor). Patří inline.
- Výsledek kontroly DNS. Patří k záznamu.
- Dokončení importu s chybnými řádky. Patří na stránku výsledku.
- Cokoliv, co obsahuje odkaz, na který má uživatel kliknout později. Toast zmizí, odkaz s ním.

### 5.5 Inline zpětná vazba a validace formulářů

| Situace | Kdy se ověřuje | Co uživatel vidí |
|---|---|---|
| Formát pole (e-mail, URL, číslo) | **při opuštění pole**, nikdy při psaní | Text pod polem, ikona v poli, červený rámeček. Text říká, co je špatně a jaký tvar se čeká. |
| Chyba opravená | při psaní, okamžitě | Chyba zmizí hned, jakmile je hodnota platná. Nečeká se na opuštění pole. |
| Povinné pole | při odeslání formuláře | Fokus skočí na první chybné pole, chyba se ohlásí čtečce, souhrn nad formulářem u formulářů delších než šest polí |
| Jedinečnost (název segmentu, e-mail kontaktu) | po 500 ms nečinnosti | "Segment s tímto názvem už existuje" plus návrh "Aktivní za 90 dní (2)" |
| Automatické uložení | 2 s po poslední změně | "Uloženo v 14:32" v hlavičce, při chybě "Nepodařilo se uložit, zkoušíme to znovu" |
| Pole závislé na jiném | při změně zdrojového pole | Cílové pole se přepne do stavu čekání s textem, ne se vyprázdní bez varování |

**Nikdy nevalidujeme při psaní.** Uživatel, který napsal "j" ze slova "jana@firma.cz", nepotřebuje vědět, že "j" není platný e-mail. Je to nejčastější chyba ve formulářích a působí jako by aplikace uživatele opravovala v půlce slova.

### 5.6 Optimistická aktualizace

Optimistická aktualizace znamená, že rozhraní ukáže výsledek dřív, než ho server potvrdí. Zrychluje to práci, ale je to lež, dokud se nepotvrdí, takže má tvrdé hranice.

| Kdy ano | Kdy nikdy |
|---|---|
| Akce téměř vždy uspěje (nad 99 %) | Akce může selhat z důvodů mimo rozhraní (kvóta, oprávnění, souběh) |
| Selhání je bez následků a jde vrátit | Uživatel by na základě falešného výsledku udělal další rozhodnutí |
| Uživatel by jinak čekal na síť | Jde o peníze, odeslání nebo nevratnou změnu |
| Rozsah je malý a lokální | Změna ovlivňuje čísla jinde na obrazovce |

**Konkrétně v tomto produktu:**

| Akce | Optimisticky? | Proč |
|---|---|---|
| Přidání a odebrání štítku | **ano** | Triviální, lokální, vratné |
| Odebrání kontaktu ze seznamu | **ano** | Vratné do 10 s |
| Přejmenování segmentu, šablony, kampaně | **ano** | Vratné úpravou |
| Změna pořadí bloků v editoru | **ano** | Editor drží stav lokálně |
| Uložení konceptu kampaně | **ano** s indikací "Ukládáme…" a pak "Uloženo" | Bez toho by se psalo se sekundovou latencí |
| Změna publika kampaně | **ne** | Mění se počet příjemců, což je číslo, podle kterého se rozhoduje |
| Přidání kontaktu na blokované adresy | **ne** | Bezpečnostní dopad, musí být potvrzené serverem |
| Odeslání testovacího mailu | **ne** | Uživatel by čekal mail, který se neodeslal |
| Cokoliv v A5 | **ne** | Z definice |

**Selhání optimistické akce.** Postup je vždy stejný a je závazný:

1. Stav rozhraní se vrátí přesně do podoby před akcí, včetně pozice ve výpisu a označení řádků.
2. Objeví se chybový toast, který se nezavírá sám: "Kontakt se nepodařilo odebrat ze seznamu. Zkuste to prosím znovu." plus tlačítko "Zkusit znovu".
3. Změna se **nikdy** nezopakuje automaticky. Automatický opakovaný pokus u akce, u které uživatel viděl selhání, vede k tomu, že se provede dvakrát.

### 5.7 Centrum úloh

Jediné místo, kde uživatel najde všechno, co běží nebo běželo na pozadí. Bez něj by dlouhé operace existovaly jen v okně, ve kterém byly spuštěné, a to je nejčastější zdroj pocitu "nevím, co se stalo".

```
┌── Úlohy ──────────────────────────────────── × ─┐
│                                                   │
│ ● Běží                                            │
│ ┌───────────────────────────────────────────────┐ │
│ │ Rozesílka kampaně Letní výprodej              │ │
│ │ ████████░░░░░░░░░░  3 214 z 12 480   (28 %)   │ │
│ │ Zbývá asi 11 minut      [Otevřít] [Pozastavit] │ │
│ ├───────────────────────────────────────────────┤ │
│ │ Import kontakty-cerven.csv                    │ │
│ │ ██████████████░░░░  8 400 z 12 000  (70 %)    │ │
│ │ Zbývá asi 40 sekund      [Otevřít] [Zrušit]   │ │
│ └───────────────────────────────────────────────┘ │
│                                                   │
│ ✓ Dokončené                                       │
│ ┌───────────────────────────────────────────────┐ │
│ │ ✓ Export kontaktů        před 12 min [Stáhnout]│ │
│ │ ⚠ Import kveten.csv      včera      [Zobrazit] │ │
│ │   4 987 z 5 000, 13 řádků se nepodařilo       │ │
│ │ ✓ Přepočet segmentu      včera                 │ │
│ └───────────────────────────────────────────────┘ │
│                                                   │
│ Historie za posledních 30 dní     Zobrazit vše →  │
└───────────────────────────────────────────────────┘
```

| Vlastnost | Rozhodnutí |
|---|---|
| Co sem patří | Vše třídy A4: import, export, rozesílka, přepočet segmentu, hromadné akce nad 20 položkami, generování zálohy, hromadné ověření vokativu |
| Co sem nepatří | A1 až A3. Ukládání konceptu ani kontrola DNS tady nemá co dělat. |
| Odznak na ikoně | Počet **běžících** úloh. Dokončené úlohy odznak nedělají, aby se nedalo dostat do stavu trvale svítící ikony. |
| Nová dokončená úloha | Toast s odkazem "Zobrazit", plus změna ikony. Toast **jen tehdy**, když uživatel není zrovna na stránce té úlohy. |
| Historie | 30 dní, pak se čistí. Chybové soubory ke stažení 7 dní. |
| URL | Každá úloha má `/jobs/{jobId}`. Odkaz se dá poslat kolegovi, funguje po přihlášení a po opětovném otevření prohlížeče. |
| Rozsah | Úlohy jsou vždy v rámci projektu. Přepnutí projektu mění obsah panelu, ale běžící úloha v jiném projektu je vidět v položce "Ostatní projekty (1)". |
| Oprávnění | Uživatel vidí úlohy, které spustil sám, a role `owner` a `admin` vidí všechny v projektu. U cizí úlohy je vidět, kdo ji spustil. |

**Notifikace o dokončení.** Tři úrovně, nastavitelné na uživatele:

| Kdy | Kanál | Výchozí |
|---|---|---|
| Úloha kratší než 30 s | jen panel, žádný toast | zapnuto |
| Úloha 30 s až 5 min | toast, když je uživatel v aplikaci jinde | zapnuto |
| Úloha delší než 5 min | toast plus **e-mail**, když uživatel v aplikaci není | zapnuto |
| Rozesílka kampaně dokončena | e-mail vždy, s odkazem na report | zapnuto |
| Rozesílka kampaně selhala nebo se zastavila | e-mail vždy | nelze vypnout |

Web Push vědomě nezavádíme. Vyžaduje souhlas prohlížeče, funguje nespolehlivě přes prohlížeče a operační systémy a u self-hosted nasazení bez HTTPS nefunguje vůbec. E-mail je pro tenhle produkt ironicky ten nejspolehlivější kanál a máme ho po ruce.

### 5.8 Zavření karty a odchod uprostřed operace

Nejčastější obava uživatele u dlouhé operace zní "když to zavřu, zkazím to?". Odpověď musí být na obrazovce **předem**, ne v dokumentaci.

| Situace | Co se skutečně stane | Co uživatel vidí |
|---|---|---|
| Zavře kartu během **importu** | Import běží dál na serveru, nic se neztratí | Před spuštěním: "Import běží na serveru. Okno můžete zavřít, po návratu uvidíte výsledek." Při odchodu na jinou stránku: systémový pruh s průběhem. **Žádný dialog.** |
| Zavře kartu během **rozesílky** | Rozesílka běží dál, sender si bere práci z outboxu | Na obrazovce průběhu trvale: "Rozesílka běží na serveru. Okno můžete zavřít." Plus e-mail po dokončení. |
| Zavře kartu během **generování AI** | Požadavek doběhne, výsledek se uloží ke konceptu | "Necháme to doběhnout, výsledek najdete v šabloně." |
| Zavře kartu s **rozdělaným e-mailem v editoru** | Poslední automaticky uložený stav zůstává | Editor ukládá po 2 s. Dialog `beforeunload` **jen** tehdy, když poslední uložení selhalo nebo od poslední změny neuplynuly 2 s. |
| Zavře kartu s **rozdělaným průvodcem importem** (nahraný soubor, nedokončené mapování) | Rozpracované mapování se drží 24 hodin | Po návratu: "Máte rozdělaný import souboru kontakty.csv. Pokračovat, nebo začít znovu?" |
| **Ztratí spojení** během práce | Změny se drží v paměti prohlížeče | Systémový pruh "Ztratili jsme spojení, zkoušíme se připojit". Formuláře zůstávají vyplněné a odesílatelné, odeslání se zopakuje po obnovení. |
| **Vyprší relace** | | Dialog "Byli jste odhlášeni" s možností se přihlásit **v dialogu**, bez odchodu ze stránky, a pokračovat. Nikdy přesměrování na přihlášení se ztrátou rozepsaného obsahu. |

**Pravidlo pro `beforeunload`:** používá se **jen tehdy, když opravdu hrozí ztráta dat v prohlížeči**. Nikdy pro operace, které běží na serveru. Text dialogu si prohlížeč stejně určuje sám, takže jediné, co ovlivníme, je to, jestli se vůbec objeví. Falešný poplach je horší než žádný, protože naučí uživatele klikat "Odejít" bez čtení.

### 5.9 Živý průběh a aktualizace v reálném čase

| Co | Mechanismus | Frekvence | Chování při odpojení |
|---|---|---|---|
| Průběh rozesílky | SSE | server posílá při změně, nejvýš **jednou za sekundu** | Automatické znovupřipojení s exponenciálním odstupem (1, 2, 4, 8, max 30 s). Po 3 neúspěších přechod na dotazování jednou za 15 s a pruh "Živé aktualizace se nedaří, čísla obnovujeme každých 15 sekund". |
| Průběh importu | SSE, stejný kanál | jednou za sekundu | totéž |
| Počty v Centru úloh | SSE | jednou za 2 s | totéž |
| Report kampaně, která ještě běží | SSE | jednou za **5 s** | totéž |
| Report dokončené kampaně | bez živých aktualizací, ruční tlačítko "Obnovit" plus automatické obnovení při návratu na kartu | | |
| Počet v segment builderu | běžný požadavek s debounce a `AbortController` | **500 ms** po poslední změně (hodnota části 2) | inline chyba s tlačítkem |

**Proč nejvýš jednou za sekundu.** Číslo, které se mění desetkrát za sekundu, je nečitelné a působí nervózně. Číslo, které se mění jednou za sekundu, se dá číst a působí živě. U reportu je 5 sekund dost, protože nikdo nesleduje jednotlivá otevření.

**Čísla se nikdy neanimují skokem dolů.** Když se počet doručených po dopočtu sníží (například kvůli pozdě doručenému nedoručení), změna se ukáže, ale doprovodí se poznámkou "Údaje se upřesnily". Číslo, které samo od sebe klesne, vypadá jako chyba.

**Zastaralá data.** Když poslední aktualizace přišla před více než 60 sekundami a měla přijít dřív, čísla zešednou a nad nimi se objeví "Naposledy aktualizováno před 2 minutami". Zobrazovat čerstvě vypadající zastaralé číslo je horší než přiznat stáří.

### 5.10 Oznamování čtečkám obrazovky

Zpětná vazba, kterou nevidí čtečka obrazovky, pro část uživatelů neexistuje. Mapování je závazné.

| Situace | Technika | Poznámka |
|---|---|---|
| Toast informační, dokončení úlohy | `role="status"` (implicitně `aria-live="polite"`) | Nepřerušuje čtení. Kontejner musí být v DOM **před** vložením textu, jinak se hlášení neodešle. |
| Toast chybový | `role="alert"` (implicitně `aria-live="assertive"`) | Přeruší čtení. Vyhrazeno pro skutečné chyby, ne pro potvrzení. |
| Chyba ve formulářovém poli | `aria-invalid="true"` plus `aria-describedby` na text chyby | Hlášku čte při fokusu na poli, ne asertivně. |
| Souhrn chyb po odeslání formuláře | `role="alert"` na souhrnu plus přesun fokusu na souhrn | |
| Průběh dlouhé operace | `role="progressbar"` s `aria-valuenow`, `aria-valuemin`, `aria-valuemax`, `aria-valuetext` ("3 214 z 12 480") | Průběžné hodnoty se **neoznamují každou sekundu**. Oznamuje se při 25, 50, 75 a 100 %, a při změně stavu. |
| Neurčitý průběh | `role="progressbar"` bez `aria-valuenow` plus `aria-busy="true"` na oblasti | |
| Změna počtu ve výsledcích (segment, filtr) | `aria-live="polite"` na prvku s počtem | Debounce, jinak čtečka mluví při každém stisku klávesy. |
| Otevření dialogu | fokus na dialog, `aria-modal="true"`, zachycení fokusu, `Esc` zavírá, po zavření fokus zpět na spouštěč | |
| Načítání obsahu | `aria-busy="true"` na oblasti, po načtení `false` plus oznámení "Načteno 50 kontaktů" přes `role="status"` | |

**Nikdy neoznamujeme každou změnu počtu při psaní.** Živý počet v segment builderu se do `aria-live` propíše až po ustálení (500 ms) a jednou. Bez toho je oblast s živým počtem pro uživatele čtečky obrazovky nepoužitelná.

---

## 6. Nevratné akce

Odeslání kampaně na 50 000 lidí nejde vzít zpět. Smazání kontaktů taky ne. Zároveň platí, že ochrana, která otravuje při každodenním používání, se obchází a přestane chránit. Kapitola staví ochranu odstupňovaně podle skutečného rizika, ne plošně.

### 6.1 Škála rizika

Riziko akce se určí ze tří os. Součet rozhoduje o úrovni ochrany.

| Osa | 0 bodů | 1 bod | 2 body |
|---|---|---|---|
| **Rozsah** | jedna položka | do 100 položek | nad 100 položek |
| **Obnovitelnost** | plně vratné | obnovitelné ze zálohy nebo z exportu | nenávratné |
| **Vnější dopad** | nikdo mimo nástroj to nepozná | ovlivní kolegy v projektu | **odejde ven ke koncovým lidem** nebo se ztratí data třetích osob |

| Součet | Úroveň | Ochrana |
|---|---|---|
| 0 až 1 | **N1** | Žádná. Provést a nabídnout Vrátit zpět. |
| 2 až 3 | **N2** | Potvrzovací dialog se souhrnem a počtem. |
| 4 | **N3** | Potvrzovací dialog se souhrnem, počtem, výčtem následků a **zaškrtnutím** jedné konkrétní věty. |
| 5 až 6 | **N4** | Dialog jako N3 plus **opsání identifikátoru** (název projektu, název kampaně). |

### 6.2 Klasifikace konkrétních akcí

| Akce | Rozsah | Obnovitelnost | Vnější dopad | Součet | Úroveň |
|---|---|---|---|---|---|
| Odebrání kontaktu ze seznamu | 0 | 0 | 0 | 0 | N1 |
| Smazání štítku | 0 | 1 | 0 | 1 | N1 |
| Archivace šablony | 0 | 0 | 0 | 0 | N1 |
| Smazání jednoho kontaktu | 0 | 2 | 0 | 2 | N2 |
| Smazání segmentu | 0 | 1 | 1 | 2 | N2 |
| Odebrání člena týmu | 0 | 0 | 1 | 1 | N1 |
| Hromadné smazání 500 kontaktů | 2 | 2 | 0 | 4 | N3 |
| Hromadné smazání 50 000 kontaktů | 2 | 2 | 0 | 4 | N3 |
| **Odeslání kampaně** | 2 | 2 | 2 | 6 | **zvláštní režim, viz 6.3** |
| Odeslání testovacího mailu | 0 | 0 | 1 | 1 | N1 |
| Pozastavení běžící rozesílky | 0 | 0 | 0 | 0 | N1, bez potvrzení, viz 6.4 |
| Zrušení zbytku běžící rozesílky | 2 | 2 | 1 | 5 | N4 bez opisování, viz 6.4 |
| Rotace klíče k API | 0 | 2 | 2 | 4 | N3 |
| Smazání odesílací domény | 0 | 1 | 2 | 3 | N2 |
| Smazání projektu | 2 | 2 | 2 | 6 | N4 |
| Odstranění adresy z blokovaných | 0 | 1 | 2 | 3 | N2 |
| Hromadné odhlášení segmentu (čištění databáze) | 2 | 2 | 2 | 6 | N4 |
| Obnova ze zálohy | 2 | 2 | 2 | 6 | N4 |

**Odeslání kampaně nemá N4 s opisováním názvu, ačkoliv na to podle bodů vychází.** Je to nejčastější důležitá akce v produktu, dělá se každý týden a opisování názvu by se po třetí kampani stalo automatickým pohybem, který nic nechrání. Místo toho má vlastní, silnější a méně otravný režim.

**Opisování textu (typ-to-confirm) používáme co nejméně.** Průzkum uvádí, že Nielsen Norman Group kritizuje Mailchimpovo "napiš DELETE" jako přehnané tření a doporučuje místo něj možnost akci vrátit. *(Konkrétní zdroj jsem sám neověřil, přebírám ho z průzkumu. Argument sedí na to, co v dokumentu tvrdím nezávisle: ochrana, kterou uživatel dělá každý týden, se stane automatickým pohybem a přestane chránit.)*

Z toho plyne pravidlo, které používám v celé kapitole 6:

> **Když akci jde nabídnout jako vratnou, je vratnost vždycky lepší než potvrzování.** Opisování textu zbývá jen tam, kde vratnost technicky neexistuje a kde je akce natolik vzácná, že si tření může dovolit: smazání projektu, obnova ze zálohy, hromadné odhlášení segmentu.

Proto má odeslání kampaně okno na zrušení místo opisování a proto má hromadné smazání kontaktů export místo opisování.

### 6.3 Odeslání kampaně: čtyři vrstvy ochrany

| Vrstva | Kdy | Co dělá | Cena pro uživatele |
|---|---|---|---|
| **1. Kontrolní seznam připravenosti** | trvale na obrazovce kampaně | Blokuje odeslání při chybějícím předmětu, prázdném publiku, neověřené doméně, chybějícím odhlašovacím odkazu, neplatném doplňovaném údaji. Varuje u chybějícího testu, dlouhého předmětu, kvóty. | nulová, je to informace, kterou uživatel stejně chce |
| **2. Počet na tlačítku** | trvale | "Odeslat 12 480 e-mailů". Poslední šance všimnout si špatného publika. | nulová |
| **3. Souhrnný dialog** | při kliknutí | Komu, od koho, předmět, odhad doby, věta o nevratnosti a o okně na zrušení. Žádný checkbox, žádné opisování. | jedno kliknutí navíc |
| **4. Okno na zrušení, 60 sekund** | po potvrzení | Kampaň jde do stavu `scheduled` s časem odeslání za 60 s. Celostránkový odpočet s tlačítkem "Zrušit odeslání". Zrušení vrátí kampaň do konceptu, nic se neodeslalo. | nulová, uživatel může mezitím odejít |

Vrstva 4 je jádro. Zachytí přesně ten typ chyby, který ostatní vrstvy nechytí: uživatel si až ve chvíli po potvrzení uvědomí, že v předmětu má překlep nebo že vybral špatný segment. Klasické potvrzení tenhle případ nepokryje, protože v okamžiku potvrzování o chybě ještě neví.

#### Proč to můžeme nabídnout, když konkurence ne

Podle průzkumu konkurence tuhle možnost běžné e-mailingové nástroje nemají. *(Sám jsem to neověřil, přebírám z průzkumu.)* Důvod, proč ji můžeme mít my, je architektura z kapitoly 4.2 hlavní specifikace a nestojí to skoro nic:

```
Aplikace materializuje publikum do tabulky messages (status = pending)
       ↓
Sender si teprve postupně odebírá dávky po 500 přes SELECT ... FOR UPDATE SKIP LOCKED
```

Mezi "uživatel klikl na Odeslat" a "e-mail je u Amazonu" je tedy **tabulka řádků ve stavu `pending`**, kterých se sender ještě nedotkl. Zrušení odeslání je změna stavu těch řádků, ne pokus vzít zpět něco, co už odešlo.

Z toho plynou **dvě různé schopnosti**, které se nesmějí splést, a odpovídají dvěma tlačítkům z 6.4:

| | Před tím, než sender začne | Poté, co sender začne |
|---|---|---|
| Kolik řádků je `pending` | všechny | ty, které sender ještě nezabral |
| Co se dá udělat | **zrušit celé odeslání**, nikomu nic nedojde | **zrušit zbytek**, už odeslané zůstávají odeslané |
| Jak se to jmenuje v UI | "Zrušit odeslání" | "Zrušit zbytek rozesílky" |
| Stav kampaně | zpět na `draft` | `cancelled` |

Šedesátisekundové okno je tedy jen **záměrné oddálení okamžiku, kdy sender začne**, aby první sloupec vůbec nějakou dobu existoval. Technicky je to kampaň ve stavu `scheduled` se `scheduled_at = now() + 60 s`, tedy mechanika, kterou část 4a už má kvůli plánovanému odesílání. **Nepřidáváme tím žádnou novou architekturu, jen využíváme tu, která už existuje.** To je důvod, proč doporučuju vrstvu 4 do MVP 0: je to náš nejviditelnější rozdíl proti konkurenci za nejnižší cenu v celém dokumentu.

```
┌──────────────────────────────────────────────────────────────┐
│                                                                │
│                    Kampaň se odešle za 47 s                    │
│                                                                │
│         Letní výprodej · 12 480 příjemců · od jana@firma.cz    │
│                                                                │
│                     [ Zrušit odeslání ]                        │
│                                                                │
│         Okno můžete zavřít, odeslání se tím nezmění.           │
└──────────────────────────────────────────────────────────────┘
```

**Nastavitelnost.** Délka okna je nastavení projektu, 0 až 300 s, výchozí 60. Nula znamená vypnuto a nastavení to říká větou "Kampaň se odešle okamžitě a nepůjde zrušit". U naplánované kampaně se okno neuplatňuje, protože zrušení je možné až do naplánovaného času.

**Po vypršení okna už "Zrušit odeslání" neexistuje.** Existují "Pozastavit" a "Zrušit zbytek rozesílky" a jsou to jiné akce s jinými názvy, dialogy a výsledky. Nikdy nepoužijeme stejné slovo pro "nic se nestalo" a pro "polovina už je venku".

**Vazba na stavy části 4a:** okno na zrušení je stav `scheduled` se `scheduled_at = now() + 60 s`. Tlačítko "Zrušit odeslání" je přechod `unschedule` do `draft`. Nejde tedy o novou mechaniku, jen o velmi krátký plán.

### 6.4 Pozastavení a zrušení běžící rozesílky

Část 4a definuje dva různé přechody z `sending` a **jsou opravdu různé**. Rozhraní je nesmí splést, protože jeden se dá vzít zpět a druhý ne.

| | **Pozastavit** (`pause`) | **Zrušit zbytek rozesílky** (`cancel`) |
|---|---|---|
| Stav kampaně | `paused` | `cancelled` |
| Co se stane se zbytkem | Zprávy zůstanou v outboxu a čekají | Zbylé zprávy dostanou `skipped` a **zaniknou** |
| Dá se pokračovat | ano, tlačítkem "Pokračovat" | **ne, nikdy** |
| Vzhled tlačítka | běžné | destruktivní |
| Potvrzení | žádné | dialog níž, úroveň N4 bez opisování |
| Kdy použít | "musím se podívat, jestli je něco v pořádku" | "je v tom chyba, tohle už nikdy odesílat nechci" |

**Pozastavení bez potvrzení** je vědomé. Je to vratná akce a v okamžiku, kdy uživatel vidí, že se něco děje špatně, potřebuje zastavit dřív, než bude číst dialog. Každá sekunda navíc jsou stovky odeslaných e-mailů.

```
┌──────────────────────────────────────────────────────────────┐
│  Zrušit zbytek rozesílky kampaně Letní výprodej?              │
│                                                                │
│  Zbývajícím 9 266 příjemcům se e-mail nikdy neodešle.         │
│  Už odeslaných 3 214 e-mailů se vrátit nedá.                  │
│                                                                │
│  Zrušenou kampaň nejde znovu spustit. Když budete chtít        │
│  zbývajícím lidem poslat později, budete muset udělat novou    │
│  kampaň.                                                       │
│                                                                │
│  Chcete jen na chvíli zastavit a pak pokračovat?               │
│  [ Radši pozastavit ]                                          │
│                                                                │
│         [ Nechat běžet ]     [ Zrušit zbytek rozesílky ]       │
└──────────────────────────────────────────────────────────────┘
```

Nabídka "Radši pozastavit" přímo v dialogu je tam, protože **většina lidí, kteří sáhnou po zrušení, ve skutečnosti chtějí pauzu.** Sáhnou po tom, co je nejvýraznější, a bez téhle nabídky by nevratně zabili kampaň, kterou chtěli jen na minutu zastavit. Je to nejdůležitější prvek celého dialogu.

**Pozastavená kampaň** má vlastní stav obrazovky, ne jen jinou barvu tlačítka:

```
┌────────────────────────────────────────────────────────────────────┐
│  Letní výprodej                                    ⏸ POZASTAVENO   │
│                                                                      │
│  ██████████████░░░░░░░░░░░░░░░░░░░░░░░░  428 z 1 153        (37 %)  │
│                                                                      │
│  Pozastavili jste rozesílku ve 14:41. Zbývá 725 příjemců.           │
│  Zprávy čekají a odešlou se, jakmile budete chtít.                   │
│                                                                      │
│         [ Pokračovat v rozesílce ]      [ Zrušit zbytek ]           │
└────────────────────────────────────────────────────────────────────┘
```

Věta "Zprávy čekají a odešlou se, jakmile budete chtít" je nutná, protože jinak uživatel neví, jestli se pauza po hodině sama zruší, nebo jestli kampaň zůstane viset navždy.

**Automatické pozastavení** (kvóta, brzda při vysoké míře nedoručení, chyba provideru) používá stejný stav, ale s uvedeným důvodem místo času a jména:

```
⏸ POZASTAVENO AUTOMATICKY
Rozesílku jsme pozastavili ve 14:41. Z prvních 200 e-mailů se
34 nedoručilo, to je nezvykle hodně a může to znamenat problém
se seznamem.
[ Zobrazit nedoručené ] [ Pokračovat i tak ] [ Zrušit zbytek ]
```

**Zmeškaný plán** (`schedule_missed`, když byl v okamžiku plánu výpadek) je vlastní stav a musí mít vlastní obrazovku, protože je to situace, kde uživatel čekal odeslání a nedostal ho:

```
┌────────────────────────────────────────────────────────────────────┐
│  ⚠ Kampaň se v naplánovaný čas neodeslala                          │
│                                                                      │
│  Letní výprodej měla odejít 31. 7. 2026 v 8:00, ale nástroj v tu    │
│  dobu neběžel. Kampaň zůstala připravená a neodeslala se nikomu.    │
│                                                                      │
│  Je 14:38, tedy o 6 hodin a 38 minut později.                       │
│                                                                      │
│  [ Odeslat teď 1 153 lidem ]  [ Naplánovat jinak ]  [ Nechat být ]  │
└────────────────────────────────────────────────────────────────────┘
```

Uvedení, o kolik je to později, je podstatné: kampaň s předmětem "Dnes od 8 ráno" se v 14:38 posílat nemá a uživatel se musí rozhodnout informovaně.

### 6.5 Hromadné destruktivní akce

Vzor pro "smazat 3 402 vybraných kontaktů" (úroveň N3):

```
┌──────────────────────────────────────────────────────────────┐
│  Smazat 3 402 kontaktů?                                       │
│                                                                │
│  Co se stane:                                                  │
│  • Kontakty zmizí ze všech seznamů a segmentů                  │
│  • Jejich historie otevření a kliknutí se smaže                │
│  • V reportech odeslaných kampaní zůstanou jen počty           │
│  • Kontakty, které se odhlásily, zůstanou na blokovaných       │
│    adresách, aby se jim omylem neposlalo znovu                 │
│                                                                │
│  Tohle nejde vzít zpět. Před smazáním doporučujeme export.     │
│  [ Stáhnout těchto 3 402 kontaktů jako CSV ]                   │
│                                                                │
│  ☐ Rozumím, že smazané kontakty nepůjde obnovit                │
│                                                                │
│              [ Zrušit ]              [ Smazat 3 402 kontaktů ] │
└──────────────────────────────────────────────────────────────┘
```

| Prvek | Proč tam je |
|---|---|
| Počet v nadpisu i na tlačítku | Uživatel často vybere víc, než si myslí, hlavně po "vybrat vše na všech stránkách" |
| Výčet následků, ne obecná věta | "Kontakty budou smazány" neříká nic. Věta o blokovaných adresách odpovídá na otázku, kterou by uživatel jinak řešil až za měsíc. |
| **Nabídka exportu přímo v dialogu** | Jediná ochrana, která skutečně data zachrání. Export běží jako A4, dialog na něj počká a nabídne "Stáhnout a pak smazat". |
| Jeden checkbox s konkrétní větou | Ne "Souhlasím", ale věta popisující následek. Zaškrtnutí bez přečtení je pořád možné, ale text je krátký a stojí přesně nad tlačítkem. |
| Žádné opisování | Při této úrovni by to bylo tření navíc bez přidané ochrany, protože export je silnější pojistka |

**Rozlišení "vybráno na stránce" a "vybráno vše".** Klasická past: uživatel zaškrtne hlavičku tabulky, myslí si, že vybral 50 řádků na obrazovce, a smaže 50 000. Řešení:

```
☑ Vybráno 50 kontaktů na této stránce.  Vybrat všech 12 480 →
```

Po kliknutí na "Vybrat všech 12 480" se pruh změní na výrazný a zůstává, dokud výběr trvá:

```
☑ Vybráno všech 12 480 kontaktů odpovídajících filtru.  Zrušit výběr
```

Hromadná akce nad "vše odpovídající filtru" navíc v dialogu zopakuje **použitý filtr slovy**: "Filtr: seznam Zákazníci, štítek Brno, stav Aktivní."

### 6.6 Vrátit zpět: kde ano a kde ne

| Akce | Vrátit zpět | Okno | Jak je implementované |
|---|---|---|---|
| Odebrání kontaktu ze seznamu | ano | 10 s | Skutečné vrácení, členství se obnoví včetně data přihlášení |
| Odebrání štítku | ano | 10 s | totéž |
| Archivace šablony nebo kampaně | ano | 10 s | Archivace je logická, vrácení je změna příznaku |
| Smazání segmentu | ano | 10 s | Definice se drží 30 dní v koši |
| Smazání kontaktu | **ne** | | Nabízí se export před smazáním |
| Odeslání kampaně | zvláštní, viz 6.3 | 60 s | Kampaň čeká ve stavu `scheduled` |
| Odhlášení kontaktu ručně | ano | 10 s | |
| Import | **ne**, ale ano jako "vrátit celý import" | 24 h | Zvláštní akce v detailu importu: "Vrátit tento import" odebere kontakty, které vznikly jen tímto importem, a u aktualizovaných vrátí předchozí hodnoty. Vyžaduje potvrzení N3. |

**Poslední řádek ušetří hodně bolesti.** Špatně namapovaný import 20 000 kontaktů je běžná chyba a bez možnosti ho vrátit znamená ruční čištění databáze. [neověřeno: nakolik to konkurence má.]

### 6.7 Co nikdy neděláme

| Zákaz | Důvod |
|---|---|
| Dialog s textem "Opravdu?" nebo "Jste si jistý?" | Neptá se na nic užitečného. Vždy se píše, co se stane. |
| Tlačítka "Ano" a "Ne" | Uživatel čte tlačítko, ne otázku. Tlačítka jsou slovesa: "Smazat 12 kontaktů", "Zpět k úpravám". |
| Destruktivní tlačítko na místě, kde je jinde potvrzovací | Pozice tlačítek je v celé aplikaci stejná: vlevo ústup, vpravo potvrzení. |
| Potvrzovací dialog u vratné akce | Znehodnocuje dialogy, které chrání něco skutečného. |
| Automatické opakování akce, u které uživatel viděl chybu | Vede k dvojímu provedení. |
| Ztráta výběru řádků po neúspěšné hromadné akci | Uživatel by musel vybírat znovu. |
| Skrytí destruktivní akce do nabídky "…" bez jiného vysvětlení | Skrývání není ochrana, jen prodlužuje hledání. Destruktivní akce je vidět a je barevně odlišená. |

---
## 7. Stavy obrazovek

Obrazovka není jen "obsah". Je to patnáct stavů a když se na některý zapomene, uživatel narazí na bílou plochu a neví, jestli je chyba v něm, v datech, nebo v nástroji.

### 7.1 Katalog stavů

| # | Stav | Kdy nastane | Povinné prvky |
|---|---|---|---|
| S1 | **Prázdný poprvé** | Uživatel sem přišel a nikdy tu nic nebylo | Vysvětlení konceptu (2 až 4 věty), primární akce, sekundární cesta, odkaz na vysvětlení |
| S2 | **Prázdný po filtrování** | Filtr nebo hledání nic nenašlo | Připomenutí použitého filtru slovy, tlačítko "Zrušit filtry", návrh úpravy hledání |
| S3 | **Prázdný po vyprázdnění** | Uživatel smazal všechno | Jiný text než S1: "Všechny kontakty jste smazali." plus cesta zpět (import, obnova) |
| S4 | **Načítání první** | Data se načítají poprvé | Skeleton ve tvaru budoucího obsahu, ne spinner. Po 300 ms, ne hned. |
| S5 | **Načítání dalšího** | Stránkování, doskrolování | Indikátor **pod** stávajícím obsahem, obsah zůstává čitelný a nehýbe se |
| S6 | **Obnovování na pozadí** | Data jsou, aktualizují se | Nenápadný indikátor, stará data zůstávají viditelná a použitelná |
| S7 | **Zastaralá data** | Aktualizace se nepodařila, ale data jsou | Data zůstanou, ztlumí se, nad nimi "Naposledy aktualizováno před 4 minutami" a "Zkusit znovu" |
| S8 | **Částečná data** | Část stránky se načetla, část ne | Načtená část funguje. Selhaná část má vlastní chybový blok na svém místě, ne přes celou stránku. |
| S9 | **Chyba načtení** | Nepodařilo se načíst nic | Co se nepovedlo, proč (pokud víme), tlačítko "Zkusit znovu", kód chyby a `request_id` pod odkazem "Podrobnosti" |
| S10 | **Offline** | Prohlížeč hlásí ztrátu spojení | Systémový pruh, tabulky a formuláře zůstanou použitelné pro čtení, akce se ukládají a odešlou po obnovení |
| S11 | **Bez oprávnění** | Role nestačí (`forbidden`) nebo API klíč nemá scope (`insufficient_scope`) | Co konkrétně chybí, pojmenované **oprávněním z matice části 1** ("K odeslání kampaně je potřeba `campaigns:send`, které má role Editor a výš. Vy máte roli Prohlížející."), kdo to může změnit (konkrétní jméno člena s `members:update_role`), a **žádné mizející tlačítko uvnitř obrazovky** |
| S12 | **Jen pro čtení** | Role `viewer`, nebo entita je uzamčená (odeslaná kampaň) | Formuláře se zobrazí jako text, ne jako zašedlá pole. Nahoře pruh s důvodem. |
| S13 | **Nenalezeno** | Entita neexistuje nebo byla smazána | Vysvětlení, co se mohlo stát, odkaz na seznam, u smazaných z auditu kdo a kdy |
| S14 | **Zablokováno předpokladem** | Funkce vyžaduje něco, co ještě není | Co chybí, proč to je potřeba, tlačítko "Nastavit". Nikdy jen zašedlá obrazovka. |
| S15 | **Přes limit** | Kvóta, velikost souboru, počet | Aktuální hodnota, limit, co se s tím dá dělat, kdy se limit obnoví |

### 7.2 Matice: který typ obrazovky má který stav

| Typ obrazovky | S1 | S2 | S3 | S4 | S5 | S6 | S7 | S8 | S9 | S10 | S11 | S12 | S13 | S14 | S15 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Tabulka (kontakty, kampaně, šablony) | ● | ● | ● | ● | ● | ● | ● | ○ | ● | ● | ● | ● | ○ | ○ | ● |
| Detail entity (kontakt, kampaň) | ○ | ○ | ○ | ● | ○ | ● | ● | ● | ● | ● | ● | ● | ● | ○ | ○ |
| Průvodce (import, DNS) | ○ | ○ | ○ | ● | ○ | ● | ● | ● | ● | ● | ● | ○ | ● | ● | ● |
| Editor | ○ | ○ | ○ | ● | ○ | ● | ● | ● | ● | ● | ● | ● | ● | ○ | ● |
| Report a statistiky | ● | ● | ○ | ● | ○ | ● | ● | ● | ● | ● | ● | ● | ● | ● | ○ |
| Nastavení | ○ | ○ | ○ | ● | ○ | ● | ● | ● | ● | ● | ● | ● | ○ | ○ | ○ |
| Přehled (dashboard) | ● | ○ | ○ | ● | ○ | ● | ● | ● | ● | ● | ○ | ● | ○ | ● | ○ |

● povinné ○ neaplikuje se

**S8 (částečná data) je na dashboardu a v reportu povinné a je to důležité.** Dashboard skládá data z pěti zdrojů. Když jeden selže (třeba dotaz na kvótu SES, protože AWS nedopovědělo), nesmí to zabít celou obrazovku. Dlaždice s kvótou ukáže vlastní chybu, zbytek funguje.

### 7.2b Oprávnění: co která role neuvidí

Matici 45 oprávnění vlastní část 1 (její 3.4). Tady je jen to, co z ní plyne pro rozhraní, protože jinak by se stav S11 psal u každé obrazovky znovu.

| Role | Co v rozhraní chybí a jak se to podá |
|---|---|
| **viewer** | Nevidí sekci Nastavení kromě profilu (nemá `providers:read`, `api_keys:read`, `webhooks:read`, `audit:read`). Kontakty, kampaně, šablony a reporty vidí v režimu **jen pro čtení** (S12), ne zašedle. Nemá `contacts:export`, takže tlačítko Export je vidět s vysvětlením, ne skryté. |
| **editor** | Nevidí Zálohy, Audit log, API klíče, Webhooky, Členy (má `members:read`, ale ne `members:invite`). Nemůže měnit odesílací službu (`providers:write`), ale vidí její stav. **Nemá `contacts:export` ani `gdpr:*`**, což má nepříjemný důsledek popsaný v R18. |
| **admin** | Nevidí Zálohy (`backups:*` má jen owner) a nemůže smazat ani předat projekt. |
| **owner** | Vidí vše. |

**Dvě pravidla, která z toho plynou a platí bez výjimky:**

1. **Celá sekce navigace se smí skrýt.** Když uživatel nemá `backups:read`, položka Zálohy v menu není. Souhlasím s částí 1: nabízet cestu, která vždy skončí na 403, je horší než ji nenabízet.
2. **Akce uvnitř obrazovky, kterou uživatel vidí, se skrývat nesmí.** Prohlížející, který se dívá na kampaň, musí vidět, že tlačítko Odeslat existuje a proč ho nemůže použít. Jinak nemá jak zjistit, o co má požádat. Viz R8 a hláška 22.

Rozdíl mezi jedničkou a dvojkou je v tom, jestli uživatel o existenci té možnosti už ví. Kdo se dívá na kampaň, ví, že se kampaně odesílají. Kdo nikdy neviděl Zálohy, o ně nepřijde.

### 7.3 Prázdné stavy: konkrétní texty

Prázdný stav je nejnavštěvovanější obrazovka nového uživatele. Tady jsou závazné texty pro nejdůležitější případy. Anglické varianty jsou v katalogu 9.2 a 10.2.

**Kontakty, S1**

> ### Zatím tu nejsou žádné kontakty
>
> Kontakt je jeden člověk, kterému budete posílat e-maily. U každého si nástroj pamatuje jméno, e-mail, odkud přišel a co s vašimi e-maily dělal.
>
> Dostat je sem jde třemi způsoby:
>
> **[Naimportovat ze souboru]** Máte je v Excelu nebo v jiném nástroji? Nahrajte soubor, zbytek uděláme.
> **[Vytvořit přihlašovací formulář]** Formulář vložíte na web a lidé se přihlásí sami.
> **[Přidat jeden kontakt ručně]** Na vyzkoušení.
>
> *Nebo si nejdřív prohlédněte, jak to celé vypadá: [Nahrát ukázková data]*

**Segmenty, S1**

> ### Segment je skupina, která se udržuje sama
>
> Nastavíte podmínku, třeba "nakoupili za posledních 90 dní", a nástroj do segmentu sám přidává a odebírá lidi, jak se mění jejich chování. Nemusíte ho ručně aktualizovat. To je rozdíl oproti seznamu, do kterého lidi zařazujete vy.
>
> **Můžete začít hotovým segmentem:**
>
> | Nikdy neotevřel (dostali aspoň 3 e-maily) | 890 kontaktů | [Použít] |
> | Neaktivní 90+ dní | 1 204 kontaktů | [Použít] |
> | Nepotvrzené přihlášení starší 30 dní | 312 kontaktů | [Použít] |
>
> *Šest hotových segmentů celkem, viz 8.4.1.*
>
> **[Postavit vlastní segment]**

**Kampaně, S1**

> ### Zatím jste neposlali žádnou kampaň
>
> Kampaň je jeden e-mail poslaný najednou skupině lidí. Vyberete, komu, napíšete co, a nástroj to rozešle a spočítá, jak to dopadlo.
>
> **[Vytvořit kampaň]**
>
> Než začnete, budete potřebovat kontakty a nastavené odesílání.
> ✓ Kontakty máte (12 480)
> ⚠ Odesílání zatím nastavené není. [Nastavit]

**Tabulka po filtrování, S2**

> ### Žádný kontakt neodpovídá
>
> Filtr: seznam **Zákazníci**, štítek **Brno**, stav **Aktivní**, hledání **"novák"**
>
> **[Zrušit všechny filtry]** **[Zrušit jen hledání]**
>
> *Tip: hledání funguje i bez diakritiky, "novak" najde i "Novák".*

**Report kampaně před prvním otevřením, S1**

> ### Kampaň se odeslala před chvílí, čísla teprve přicházejí
>
> Doručení, otevření a kliknutí se sbírají průběžně. První čísla obvykle uvidíte do pěti minut, většina otevření dorazí během prvních dvou hodin a doplňují se ještě několik dní.
>
> Stránka se aktualizuje sama, nemusíte ji obnovovat.

### 7.4 Chyby, offline a priorita systémových stavů

**Systémový pruh dole** ukazuje nejvýš jeden stav. Když jich nastane víc, vyhrává ten s nižším číslem.

| Priorita | Stav | Text | Barva |
|---|---|---|---|
| 1 | Odesílání zablokováno kvůli doručitelnosti | "Odesílání je zastavené: příliš mnoho stížností na spam. [Co s tím]" | chyba |
| 2 | Offline | "Ztratili jsme spojení. Zkoušíme se připojit… Vaše změny se uloží, jakmile se to podaří." | varování |
| 3 | Běžící rozesílka | "Rozesílka Letní výprodej: 3 214 z 12 480. [Zobrazit]" | neutrální |
| 4 | Běžící import nebo jiná úloha | "Import kontakty.csv: 8 400 z 12 000. [Zobrazit]" | neutrální |
| 5 | Zkušební režim | "Zkušební režim: e-maily se odešlou jen na ověřené adresy. [Nastavit doménu]" | informace |
| 6 | Dostupná aktualizace aplikace | "Je k dispozici nová verze nástroje. [Co je nového]" | informace |

**Anatomie chybového bloku (S9).**

```
┌─────────────────────────────────────────────────────┐
│  ⚠  Kontakty se nepodařilo načíst                    │
│                                                       │
│  Databáze neodpověděla včas. Většinou je to           │
│  přechodné a druhý pokus projde.                      │
│                                                       │
│  [ Zkusit znovu ]                                     │
│                                                       │
│  ▸ Podrobnosti pro technickou podporu                 │
│    Kód: db_timeout                                    │
│    Číslo požadavku: req_01J8XK2M9P                    │
│    Čas: 31. 7. 2026 14:32:07                          │
│    [Zkopírovat]                                       │
└─────────────────────────────────────────────────────┘
```

Sbalené "Podrobnosti pro technickou podporu" jsou povinné u každé chyby S9. Důvod: uživatel neumí popsat, co se stalo, ale umí zkopírovat blok a poslat ho. `request_id` je jediná cesta, jak to dohledat v logu.

**Offline chování podle typu stránky:**

| Stránka | Co funguje offline |
|---|---|
| Tabulky a detaily | Naposledy načtená data zůstávají a jdou číst. Filtrování a stránkování nefunguje a řekne to. |
| Editor šablony | **Funguje.** Změny se drží v paměti prohlížeče a uloží se po obnovení spojení. |
| Průvodce importem | Nahrání souboru nefunguje. Vyplněné mapování zůstává. |
| Průběh rozesílky | Čísla zamrznou a ztlumí se, nad nimi "Ztratili jsme spojení. Rozesílka běží dál na serveru." |
| Odeslání kampaně | Zablokované, s vysvětlením. Nikdy neodesíláme naslepo do fronty prohlížeče. |

Poslední řádek je vědomé rozhodnutí. Odeslání kampaně nikdy nepatří do fronty offline akcí, protože uživatel by nevěděl, kdy se to stalo, a mohlo by to proběhnout hodiny po tom, co na to zapomněl.

---
## 8. Klíčové obrazovky

Osm obrazovek, které rozhodují o tom, jestli produkt obstojí. U každé: co uživatel vidí, co může udělat, co se stane potom, jaké jsou stavy a chyby.

### 8.1 První spuštění a onboarding

Cesta od `docker compose up` k první odeslané kampani. Cílový čas pro člověka, který ví, co dělá: **12 minut aktivní práce plus čekání na DNS.** Pro člověka, který to vidí poprvé: 30 minut.

#### 8.1.1 Krok 0: terminál

První rozhraní produktu není webová stránka, ale výpis kontejneru. Nemůžeme to obejít, takže to musí být dobré. Požadavek na část 1:

```
  ╭──────────────────────────────────────────────╮
  │  Mlain Mailer je připravený                    │
  │                                              │
  │  Otevřete v prohlížeči:                      │
  │    http://localhost:3000                     │
  │                                              │
  │  Účet správce si založíte na první obrazovce.│
  ╰──────────────────────────────────────────────╯
```

A pro dvě nejčastější selhání konkrétní, jednající hlášky:

| Situace | Hláška |
|---|---|
| Obsazený port | `Port 3000 už používá jiný program. Změňte port proměnnou APP_PORT, například: APP_PORT=3100 docker compose up` |
| Nedostupná databáze | `Nepřipojili jsme se k databázi na adrese postgres:5432. Zkontrolujte, že služba postgres běží: docker compose ps` |
| Chybí SECRET_KEY | `Chybí povinná proměnná SECRET_KEY. Vygenerujte ji příkazem: openssl rand -base64 32` |

**Bezpečnost prvního spuštění.** Aplikace přijímá registraci **jen dokud neexistuje první uživatel**. Poté je registrace uzavřená a nové uživatele zve správce. Když je `APP_URL` veřejná adresa a první uživatel ještě neexistuje, do logu i na registrační stránku se vypíše upozornění, že instalace je zatím otevřená a je vhodné účet založit hned. Tohle je jednodušší a méně chybové než jednorázový token v logu, který uživatelé stejně kopírují špatně.

#### 8.1.2 Krok 1 a 2: účet a projekt

Dvě obrazovky, dohromady sedm polí. Nic víc.

```
Účet správce                             Váš první projekt
─────────────────                        ──────────────────
Jméno         [Jana Nováková    ]        Název projektu  [E-shop Kolo     ]
E-mail        [jana@firma.cz    ]        Jazyk e-mailů   [Čeština       ▾]
Heslo         [••••••••••••     ]        Časová zóna     [Europe/Prague ▾]
              Aspoň 10 znaků.            Oslovujeme      (•) Vykáním
Jazyk         [Čeština        ▾]                         ( ) Tykáním

[Pokračovat]                             [Vytvořit projekt]
```

| Pole | Poznámky k UX |
|---|---|
| Heslo | Indikátor síly, ale **žádné povinné speciální znaky**. Požadavek je délka. Tlačítko "zobrazit heslo". Kontrola proti seznamu prolomených hesel se dělá lokálně, bez volání ven, protože slibujeme nulovou komunikaci s cizím cloudem. |
| Jazyk uživatele | Jazyk rozhraní. Předvyplní se z hlavičky prohlížeče. |
| Jazyk e-mailů | **Jiná věc než jazyk rozhraní.** Ovlivňuje výchozí šablony, potvrzovací a odhlašovací stránky a `contact.greeting`. Vysvětleno pod polem jednou větou. |
| Oslovujeme | Nastavuje tón `contact.greeting`. Vykáním: "Dobrý den, Jano". Tykáním: "Ahoj Jano". Ukázka se mění živě podle výběru. |
| Časová zóna | Předvyplní se z prohlížeče. Ovlivňuje plánované odesílání a všechna zobrazená data. |

**Co tu vědomě není:** otázky na velikost firmy, obor podnikání, odkud se o nás dozvěděli. Nepotřebujeme to a je to tření na místě, kde má být nadšení.

#### 8.1.3 Krok 3: cesta k první kampani

Po vytvoření projektu **žádná prohlídka s bublinami**. Místo toho trvalý panel na Přehledu:

```
┌── Vaše první kampaň ──────────────────────── skrýt ─┐
│                                                       │
│  ○ 1. Nastavte odesílání              asi 10 min      │
│     Aby e-maily někam odcházely a nekončily ve spamu. │
│                                       [Nastavit →]    │
│                                                       │
│  ○ 2. Přidejte kontakty               asi 3 min       │
│     Nahrajte soubor, nebo si nejdřív zkuste ukázková  │
│     data.                    [Importovat] [Ukázková]  │
│                                                       │
│  ○ 3. Připravte e-mail                asi 5 min       │
│     Vyberte hotovou šablonu, nebo ji nechte napsat AI.│
│                                       [Vytvořit →]    │
│                                                       │
│  ○ 4. Pošlete si test                 asi 1 min       │
│     Podívejte se, jak e-mail vypadá ve vaší schránce. │
│                                                       │
│  ○ 5. Odešlete první kampaň                           │
│                                                       │
└───────────────────────────────────────────────────────┘
```

| Rozhodnutí | Odůvodnění |
|---|---|
| **Seznam, ne prohlídka s bublinami** | Prohlídku uživatel zavře a už ji nikdy neuvidí. Seznam zůstane, dá se k němu vrátit, dá se dělat v libovolném pořadí a je vidět, co zbývá. |
| **Odhad času u každého kroku** | Nejčastější důvod, proč lidé nedokončí nastavení, je nejistota, jak dlouho to potrvá. Deset minut je přijatelných, neznámo není. |
| **Kroky jde dělat v libovolném pořadí** | Kdo chce nejdřív vidět editor, ať vidí editor. Krok 5 je jediný, který má tvrdé předpoklady, a ty jsou vidět na kontrolním seznamu kampaně. |
| **Panel jde skrýt, ne zavřít** | Po skrytí zůstane na Přehledu řádek "Nastavení: 2 z 5 hotovo. [Zobrazit]". Zmizí až po dokončení, kdy se změní na jednorázové "Hotovo, první kampaň odeslána" a to už se zavře nadobro. |
| **Ukázková data jako rovnocenná nabídka** | Umožní projít celý produkt včetně reportu dřív, než uživatel cokoliv odešle. Viz níž. |

#### 8.1.4 Ukázková data

Jedno tlačítko, které do projektu nahraje: 200 kontaktů, 3 seznamy, 4 štítky, 2 segmenty, 2 šablony a **1 odeslanou kampaň s hotovým reportem** včetně otevření, kliknutí, dvou nedoručení a jedné stížnosti.

| Vlastnost | Rozhodnutí |
|---|---|
| Adresy | Výhradně na doméně `example.com` (rezervovaná RFC 2606), takže se na ně fyzicky nedá nic doručit |
| Ochrana | Ukázkové kontakty jsou označené a **nedají se zařadit do publika kampaně**. Když je uživatel vybere, kontrolní seznam řekne: "Publikum obsahuje jen ukázkové kontakty. Těm se nic neodešle." |
| Viditelnost | Trvalý pruh na Přehledu: "V projektu jsou ukázková data. [Odstranit]" |
| Odstranění | Jedno tlačítko, N2 potvrzení, odstraní všechno včetně kampaně a reportu, nesáhne na nic ostatního |
| Jména | Skutečně vypadající česká jména včetně těch, na kterých je vidět vokativ a rod: Jana Nováková, Ondřej Dvořák, Ing. Petr Svoboda, Lucie Černá |

**Proč je to důležité.** Report kampaně je obrazovka, která rozhoduje o tom, jestli si někdo nástroj koupí, a je to zároveň jediná obrazovka, kterou nejde ukázat dřív, než uživatel něco odešle. Ukázková data tenhle problém odstraní za jeden den práce.

#### 8.1.5 Stavy a chyby onboardingu

| Stav | Chování |
|---|---|
| Uživatel opustí onboarding uprostřed | Nic se neztratí. Seznam kroků drží stav a je na Přehledu. |
| Uživatel přeskočí nastavení odesílání | Funguje všechno kromě odeslání. Kampaň se dá napsat, uložit i naplánovat, jen se neodešle a kontrolní seznam říká proč. |
| Uživatel vytvoří kampaň dřív než kontakty | Publikum je prázdné, kontrolní seznam blokuje a nabízí "Naimportovat kontakty". |
| Chyba při vytváření projektu | Inline u formuláře, data zůstanou vyplněná. |
| Zapomenuté heslo při první instalaci | Obnova hesla vyžaduje odesílání, které ještě není nastavené. Řešení: příkaz v kontejneru `mlain reset-password jana@firma.cz` a na přihlašovací stránce odkaz "Odesílání ještě není nastavené? Jak obnovit heslo z příkazové řádky". **Toto je požadavek na část 1.** |

---

### 8.2 Nastavení odesílání a DNS záznamů

**Nejtěžší obrazovka produktu.** Technický úkol, který má udělat netechnický člověk v cizím systému, na který často nemá ani přístup, s výsledkem, který se projeví za neurčitou dobu a jehož selhání je neviditelné.

**Proč je to příležitost, ne jen problém.** Podle průzkumu na tuhle obrazovku self-hosted konkurence rezignovala: Listmonk ji odmítá řešit, Sendy odkazuje na dokumentaci AWS a Mautic nemá nic. *(Sám jsem to neověřil, přebírám z průzkumu.)* Jestli to platí, znamená to, že tahle kapitola není doplněk k produktu, ale jeden ze dvou hlavních důvodů, proč by si někdo vybral nás místo Listmonku. Ten druhý je okno na zrušení odeslání (6.3). Podle toho je taky dimenzovaná: je to nejdelší kapitola dokumentu.

Návrh stojí na čtyřech pilířích: **snazší cesta jako výchozí, zkušební režim, delegace a konkrétní návod podle poskytovatele.**

#### 8.2.1 Krok 1: jak chcete odesílat

```
┌───────────────────────────────────────────────────────────────┐
│  Jak budete e-maily odesílat?                                  │
│                                                                 │
│  ┌───────────────────────────┐  ┌───────────────────────────┐  │
│  │ ✉ Přes svůj hosting       │  │ ☁ Přes Amazon SES         │  │
│  │   (SMTP)                  │  │                           │  │
│  │                           │  │                           │  │
│  │ DOPORUČENO NA ZAČÁTEK     │  │ PRO VĚTŠÍ OBJEMY          │  │
│  │                           │  │                           │  │
│  │ Použijete přístupy, které │  │ Levnější při velkých      │  │
│  │ už nejspíš máte od svého  │  │ objemech a přesně vidíte, │  │
│  │ poskytovatele webu.       │  │ komu se e-mail nedoručil. │  │
│  │                           │  │                           │  │
│  │ ✓ Nastavíte za 5 minut    │  │ ⚠ Potřebujete účet u AWS  │  │
│  │ ✓ Funguje hned            │  │ ⚠ Nastavení asi 30 minut  │  │
│  │ ⚠ Do zhruba 2 000 e-mailů │  │ ✓ Statisíce e-mailů denně │  │
│  │   denně                   │  │                           │  │
│  │ ⚠ Hůř poznáme, komu se    │  │                           │  │
│  │   e-mail nedoručil        │  │                           │  │
│  │                           │  │                           │  │
│  │      [ Vybrat ]           │  │      [ Vybrat ]           │  │
│  └───────────────────────────┘  └───────────────────────────┘  │
│                                                                 │
│  Nevíte, co vybrat?  [ Poradit mi → ]                          │
└───────────────────────────────────────────────────────────────┘
```

**"Poradit mi"** je čtyřotázkový průvodce:

| Otázka | Odpovědi | Vliv |
|---|---|---|
| Kolik e-mailů měsíčně plánujete poslat? | do 5 000 / 5 000 až 50 000 / víc / nevím | nad 50 000 doporučí SES |
| Máte účet u Amazon Web Services? | ano / ne / nevím co to je | "nevím co to je" znamená SMTP |
| Kdo spravuje váš web a doménu? | já / kolega ve firmě / externí firma / nevím | ovlivní nabídku delegace |
| Chcete přesně vědět, komu se e-mail nedoručil? | ano, je to důležité / stačí přibližně | "ano" naklání k SES |

Výsledek je věta s odůvodněním, ne jen výběr: *"Doporučujeme začít přes hosting (SMTP). Posíláte do 5 000 e-mailů měsíčně, na to SMTP bohatě stačí a nastavíte ho za pět minut. Na Amazon SES můžete přejít kdykoliv později, kontakty ani kampaně se tím neztratí."*

Poslední věta je klíčová: odstraňuje strach z nevratného rozhodnutí na začátku.

#### 8.2.2 Krok 2: přístupové údaje

**SMTP.** Pět polí a jeden test. Nad formulářem je nabídka známých českých poskytovatelů (Wedos, Forpsi, Active24, Webglobe, Seznam, Google Workspace, Microsoft 365), po výběru se předvyplní server, port a šifrování a zůstane jen jméno a heslo.

```
Poskytovatel   [Wedos                    ▾]   nebo [Vyplnit ručně]

Server         [smtp.wedos.net             ]  předvyplněno
Port           [587                        ]  předvyplněno
Šifrování      [STARTTLS                 ▾]  předvyplněno
Přihlašovací jméno [jana@firma.cz         ]
Heslo          [••••••••••••              ]

[ Otestovat připojení ]
```

Test připojení je akce třídy A3 a jeho výsledek je **inline pod tlačítkem**, ne toast:

| Výsledek | Text |
|---|---|
| Úspěch | ✓ **Připojení funguje.** Přihlásili jsme se k serveru smtp.wedos.net. |
| Špatné heslo | ⚠ **Server odmítl přihlášení.** Zkontrolujte jméno a heslo. U některých poskytovatelů je přihlašovací jméno celá e-mailová adresa, u jiných jen část před zavináčem. |
| Špatný port | ⚠ **Server na portu 465 neodpovídá.** Zkuste port 587 se šifrováním STARTTLS, to je dnes nejběžnější. [Zkusit 587] |
| Nedostupný server | ⚠ **Server smtp.wedos.cz jsme nenašli.** Zkontrolujte adresu, jestli tam není překlep. Měli jste na mysli **smtp.wedos.net**? [Použít] |
| Timeout | ⚠ **Server neodpověděl do 10 sekund.** Může to být dočasné, nebo server blokuje odchozí spojení z tohoto serveru. [Zkusit znovu] |

**Amazon SES.** Tři cesty, seřazené podle náročnosti:

1. **Hotová šablona pro AWS.** Tlačítko "Otevřít v AWS konzoli" s předpřipraveným CloudFormation stackem, který vytvoří uživatele s minimálními právy (`ses:SendEmail`, `ses:SendRawEmail`, `ses:GetSendQuota`, `ses:GetAccount`) a vypíše dva údaje ke zkopírování. Šablona je součástí repozitáře, ne cizí služba.
2. **Ruční zadání klíčů** s návodem v deseti očíslovaných krocích a se screenshoty.
3. **Poslat to někomu jinému.** Stejný delegační mechanismus jako u DNS, viz 8.2.4.

Po připojení SES se **vždycky** zobrazí stav sandboxu, protože to je nejčastější a nejbolestivější překvapení:

```
┌──────────────────────────────────────────────────────────────┐
│  ⚠ Váš účet u Amazonu je v testovacím režimu                  │
│                                                                │
│  Amazon nové účty omezuje, dokud nepožádáte o uvolnění:        │
│                                                                │
│  • Odeslat jde jen na adresy, které si u Amazonu ověříte      │
│  • Nejvýš 200 e-mailů za 24 hodin                             │
│  • Nejvýš 1 e-mail za sekundu                                  │
│                                                                │
│  Kampaň na 12 480 lidí takhle poslat nepůjde.                 │
│                                                                │
│  Uvolnění se žádá formulářem přímo u Amazonu, schválení trvá  │
│  obvykle jeden pracovní den.                                   │
│                                                                │
│  [ Otevřít formulář u Amazonu ]  [ Co do formuláře napsat ]   │
└──────────────────────────────────────────────────────────────┘
```

"Co do formuláře napsat" otevře panel s předepsaným textem žádosti v angličtině, který si uživatel zkopíruje a upraví. Tohle je konkrétní příklad delegace znalosti: neumíme za uživatele žádost podat, ale umíme mu ji napsat.

#### 8.2.3 Krok 3: odesílací adresa

```
Odesílatel se lidem zobrazí takhle:

┌──────────────────────────────────────────┐
│  Jana z Kolo Shopu                       │
│  jana@kolo-shop.cz                       │
│  Letní výprodej začíná                   │
└──────────────────────────────────────────┘
        ↑ živý náhled, mění se při psaní

Jméno odesílatele  [Jana z Kolo Shopu     ]
E-mailová adresa   [jana@kolo-shop.cz     ]
Adresa pro odpovědi[                      ]  nepovinné
                   Když ji nevyplníte, odpovědi chodí na adresu výše.
```

**Tvrdé varování u veřejných domén.** Když uživatel zadá adresu na `gmail.com`, `seznam.cz`, `email.cz`, `centrum.cz`, `outlook.com`, `yahoo.com`, `icloud.com` nebo `volny.cz`:

> ⚠ **Z adresy na Gmailu hromadné e-maily posílat nejde.**
>
> Gmail od roku 2024 nedovoluje, aby jeho adresy používaly k hromadnému rozesílání jiné systémy. E-maily by se z velké části vůbec nedoručily nebo by skončily ve spamu.
>
> Použijte adresu na vlastní doméně, například `jana@kolo-shop.cz`. Doménu už nejspíš máte, protože na ní běží váš web.
>
> Odpovědi vám můžou chodit na Gmail dál. Stačí ho vyplnit do pole "Adresa pro odpovědi".

Toto je varování, ne blokace. Když uživatel trvá na svém, může pokračovat, ale kontrolní seznam kampaně to bude hlásit jako varování trvale.

#### 8.2.4 Krok 4: ověření domény, nejtěžší část

```
┌────────────────────────────────────────────────────────────────┐
│  Ověření domény kolo-shop.cz                          Krok 4/4  │
│                                                                  │
│  Poštovní servery jako Gmail nebo Seznam musí poznat, že        │
│  e-maily posíláte opravdu vy, a ne někdo, kdo se za vás vydává. │
│  Potvrdíte jim to tím, že do nastavení své domény přidáte tři   │
│  krátké záznamy.                                                 │
│                                                                  │
│  Bez toho velká část e-mailů skončí ve spamu.                   │
│                                                                  │
│  Záznamy přidává ten, kdo spravuje vaši doménu.                 │
│  Zabere to asi 10 minut a pak se čeká, až se změna rozšíří.     │
│                                                                  │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ ○ Nastavím to sám                                        │   │
│  │   Mám přístup do správy domény.                          │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ ● Pošlu to člověku, který spravuje náš web    DOPORUČENO │   │
│  │   Připravíme odkaz a e-mail. Ten člověk se nemusí        │   │
│  │   do nástroje přihlašovat a uvidí jen ty tři záznamy.    │   │
│  ├──────────────────────────────────────────────────────────┤   │
│  │ ○ Zatím ne, chci si nástroj vyzkoušet                    │   │
│  │   Zapneme zkušební režim. Můžete si posílat e-maily      │   │
│  │   na vlastní ověřené adresy a všechno ostatní vyzkoušet. │   │
│  └──────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────┘
```

**Tohle je moje hlavní odpověď na "zvládne to babička".** Nezvládne. Ale zvládne vybrat prostřední možnost a přeposlat e-mail.

#### 8.2.5 Delegační odkaz

Volba "Pošlu to člověku, který spravuje náš web" vygeneruje:

| Prvek | Vlastnost |
|---|---|
| Odkaz | `/d/{token}`, platný 14 dní, jednoúčelový, bez přihlášení, jen ke čtení plus tlačítko "Zkontrolovat" |
| Co odkaz ukazuje | Jen tři záznamy pro tuhle jednu doménu, návod podle poskytovatele, stav ověření. **Nic z nástroje.** Žádné kontakty, žádné kampaně, žádný název projektu kromě jména firmy. |
| Předepsaný e-mail | Vygenerovaný text cs a en, uživatel ho může odeslat přímo z nástroje, nebo zkopírovat |
| Zpětná vazba | Když se záznamy objeví, iniciátorovi přijde e-mail "Doména kolo-shop.cz je ověřená, můžete odesílat" a na Přehledu se rozsvítí krok |
| Zrušení | Odkaz jde kdykoliv zneplatnit v nastavení domény |
| Zabezpečení | Token je náhodný, 32 bajtů, uložený jako hash. Stránka má `noindex`. Nedá se z ní nic změnit kromě spuštění kontroly. |

Předepsaný e-mail, česky:

> **Předmět:** Prosba o přidání tří DNS záznamů pro doménu kolo-shop.cz
>
> Dobrý den,
>
> začínáme používat nástroj na rozesílání newsletterů a potřebujeme k tomu do DNS domény kolo-shop.cz přidat tři záznamy. Bez nich by naše e-maily končily ve spamu.
>
> Všechno potřebné je na téhle stránce, včetně hodnot ke zkopírování a návodu:
>
> https://marketing.kolo-shop.cz/d/xxxxxxxxxxxx
>
> Odkaz je platný 14 dní a nevede nikam do našeho nástroje, jen na tu jednu stránku se záznamy. Na stránce je i tlačítko, kterým si ověříte, že se záznamy propsaly správně.
>
> Díky moc,
> Jana Nováková

English version:

> **Subject:** Request to add three DNS records for kolo-shop.cz
>
> Hello,
>
> we are setting up a newsletter tool and need three DNS records added to the kolo-shop.cz zone. Without them our emails would land in spam.
>
> Everything you need, including the values to copy and step-by-step instructions, is on this page:
>
> https://marketing.kolo-shop.cz/d/xxxxxxxxxxxx
>
> The link is valid for 14 days and only shows that single page, nothing else from our system. There is a button on the page to verify the records once you have added them.
>
> Thanks a lot,
> Jana Nováková

#### 8.2.6 Obrazovka se záznamy

Jádro celé kapitoly. Vidí ji buď uživatel, nebo správce přes delegační odkaz. Obsah je stejný.

```
┌─────────────────────────────────────────────────────────────────────┐
│  DNS záznamy pro kolo-shop.cz                                        │
│                                                                       │
│  Vaše doména je podle všeho u poskytovatele WEDOS.                   │
│  [ Návod krok za krokem pro Wedos ]    [ Je to jinde ▾ ]            │
│                                                                       │
│  Tvar názvu:  (•) Krátký      ( ) Celý                               │
│               Většina systémů chce krátký tvar. Když si systém       │
│               stěžuje, přepněte na celý.                              │
│                                                                       │
│  ┌───────────────────────────────────────────────────────────────┐   │
│  │ 1. Podpis DKIM (1 ze 3)                          ⏳ Čekáme     │   │
│  │                                                                 │   │
│  │ Typ     CNAME                                                   │   │
│  │ Název   x7k2m._domainkey                            [Kopírovat] │   │
│  │ Hodnota x7k2m.dkim.amazonses.com                    [Kopírovat] │   │
│  │ TTL     3600 (nebo nechte výchozí)                              │   │
│  │                                                                 │   │
│  │ ℹ Tenhle záznam je jako podpis. Poštovní server podle něj       │   │
│  │   pozná, že e-mail nikdo cestou nezměnil.                       │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  ┌───────────────────────────────────────────────────────────────┐   │
│  │ 4. SPF                                            ⚠ Problém    │   │
│  │                                                                 │   │
│  │ Našli jsme dva SPF záznamy. Poštovní servery v takovém         │   │
│  │ případě obě ignorují a e-maily označí jako nedůvěryhodné.      │   │
│  │ Doména smí mít jen jeden.                                       │   │
│  │                                                                 │   │
│  │ Máte:                                                           │   │
│  │   v=spf1 include:_spf.google.com ~all                           │   │
│  │   v=spf1 include:amazonses.com ~all                             │   │
│  │                                                                 │   │
│  │ Nahraďte je jedním záznamem:                                    │   │
│  │   v=spf1 include:_spf.google.com include:amazonses.com ~all     │   │
│  │                                                     [Kopírovat] │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  [ Zkontrolovat záznamy ]      Kontrolujeme automaticky každou minutu│
│                                                                       │
│  Změny v DNS se obvykle projeví do 15 minut, výjimečně až za 24      │
│  hodin. Stránku můžete zavřít, kontrolujeme dál a dáme vědět.        │
└─────────────────────────────────────────────────────────────────────┘
```

**Detekce poskytovatele.** Nástroj se zeptá na `NS` záznamy domény a podle nich určí poskytovatele. Tabulka pokrývá české i světové:

| NS obsahuje | Poskytovatel | Návod |
|---|---|---|
| `wedos.net`, `wedos.cz` | WEDOS | Zákaznický portál → Domény → DNS → Přidat záznam |
| `forpsi.net`, `forpsi.com` | FORPSI | Administrace → Domény → DNS zóna |
| `active24.com`, `active24.cz` | ACTIVE 24 | Klientské centrum → Domény → DNS |
| `webglobe.cz` | Webglobe | |
| `subreg.cz`, `gransy.com` | Gransy / Subreg | |
| `ns.banan.cz` | Banán | |
| `cloudflare.com` | Cloudflare | **Zvláštní pozor:** u CNAME musí být oranžový mráček vypnutý (DNS only) |
| `domaincontrol.com` | GoDaddy | |
| `awsdns` | AWS Route 53 | |
| `vercel-dns.com` | Vercel | |
| `registrar-servers.com` | Namecheap | |
| `ui-dns`, `ionos` | IONOS | |
| `googledomains.com`, `squarespacedns.com` | Squarespace | |
| neznámé | obecný návod | "Doménu spravuje server ns1.neco.cz. Nevíme, kdo to je. Zeptejte se tam, kde máte doménu registrovanou." |

Návod pro známého poskytovatele je konkrétní posloupnost kliknutí pojmenovaná jejich slovy, ne obecné "přidejte CNAME záznam". Rozdíl mezi tím, jestli uživatel uspěje, nebo ne, je často přesně tady.

**Přepínač krátký/celý tvar názvu.** Nejčastější důvod, proč záznam nefunguje: v jednom panelu se zadává `x7k2m._domainkey`, v jiném `x7k2m._domainkey.kolo-shop.cz`, a když se to plete, vznikne `x7k2m._domainkey.kolo-shop.cz.kolo-shop.cz`. Nástroj tuhle konkrétní chybu **detekuje** a hlásí ji jmenovitě, viz níž.

**Stavy jednotlivého záznamu:**

| Stav | Ikona | Text |
|---|---|---|
| Čekáme | ⏳ | "Zatím ho nevidíme. Změny se obvykle projeví do 15 minut." |
| Hotovo | ✓ | "Hotovo." |
| Jiná hodnota | ⚠ | "Záznam existuje, ale má jinou hodnotu." plus porovnání znak po znaku s vyznačením místa, kde se liší |
| Zdvojený název | ⚠ | "Vypadá to, že se název zadal i s doménou. Našli jsme `x7k2m._domainkey.kolo-shop.cz.kolo-shop.cz`. Opravte název na `x7k2m._domainkey`." |
| Chybí koncová část | ⚠ | "Hodnota je zkrácená. Některé systémy delší hodnoty ořezávají. Zkuste ji vložit znovu a zkontrolujte, že se uložila celá." |
| Cloudflare proxy | ⚠ | "Záznam je u Cloudflare zapnutý přes proxy (oranžový mráček). Pro DKIM musí být vypnutý, přepněte ho na DNS only." |
| Nelze zjistit | ⚠ | "Nepodařilo se zeptat DNS serveru. Zkusíme to za minutu znovu." |

**Porovnání znak po znaku** u stavu "jiná hodnota" je drobnost, která šetří hodiny. DKIM hodnota má přes 200 znaků a chybějící poslední tři znaky nebo mezera navíc jsou pouhým okem neviditelné.

**Automatická kontrola.** Chování je odstupňované, aby uživatel nemusel čekat u obrazovky:

| Kdy | Frekvence |
|---|---|
| Stránka je otevřená, prvních 5 minut | každých 15 s |
| Stránka je otevřená, 5 až 30 minut | každou minutu |
| Stránka je otevřená, přes 30 minut | každých 5 minut |
| Stránka je zavřená | úloha na pozadí každou hodinu, 7 dní |
| Po úspěchu | e-mail iniciátorovi i tomu, kdo záznamy přidal (pokud přišel přes delegační odkaz a zadal svou adresu) |
| Po 7 dnech neúspěchu | e-mail "Doména kolo-shop.cz se zatím nepodařilo ověřit" s odkazem a nabídkou pomoci |

#### 8.2.7 DMARC: co doporučit začátečníkovi

DMARC je jediný ze tří záznamů, který může uškodit, když se nastaví špatně. Přísná politika může zablokovat firemní e-maily z jiných systémů (fakturační, CRM, formuláře na webu).

```
┌───────────────────────────────────────────────────────────────┐
│  3. DMARC                                        ⏳ Čekáme     │
│                                                                 │
│  Typ     TXT                                                    │
│  Název   _dmarc                                    [Kopírovat] │
│  Hodnota v=DMARC1; p=none; rua=mailto:dmarc@kolo-shop.cz       │
│                                                    [Kopírovat] │
│                                                                 │
│  ℹ Tenhle záznam říká poštovním serverům, co dělat s e-maily,  │
│    které se tváří jako od vás, ale nemají váš podpis.          │
│                                                                 │
│    Nastavujeme p=none, což znamená "zatím nic neblokuj, jen    │
│    mi posílej hlášení". Je to bezpečná první volba: nemůže     │
│    rozbít e-maily, které vám odcházejí z jiných systémů,       │
│    třeba z fakturačního programu.                              │
│                                                                 │
│    Až budete mít jistotu, že všechny vaše e-maily jsou správně │
│    podepsané, dá se politika zpřísnit. Připomeneme se za měsíc.│
└───────────────────────────────────────────────────────────────┘
```

Nikdy nedoporučujeme `p=reject` nováčkovi. Je to technicky lepší, ale je to nastavení, které při chybě zastaví firmě fakturační e-maily, a to je škoda, kterou náš nástroj způsobil a nemá jak napravit.

#### 8.2.8 Zkušební režim

| Vlastnost | Chování |
|---|---|
| Kdy se zapne | Uživatel zvolí "Zatím ne, chci si nástroj vyzkoušet", nebo je doména neověřená a uživatel chce odeslat |
| Co jde | Všechno: import, segmenty, editor, AI, plánování, statistiky |
| Co nejde | Odeslat na adresu, která není mezi ověřenými |
| Ověřené adresy | Uživatel přidá adresu, přijde na ni potvrzovací e-mail s odkazem, po kliknutí je ověřená. Nejvýš 10 adres. |
| Limit | 50 e-mailů za 24 hodin |
| Viditelnost | Systémový pruh trvale, plus položka v kontrolním seznamu kampaně, plus pruh na obrazovce publika kampaně |
| Kampaň v zkušebním režimu | Statistiky se počítají normálně, ale report má trvalý pruh "Kampaň proběhla ve zkušebním režimu, odešla jen na ověřené adresy" |
| Přechod ven | Jakmile se doména ověří, pruh se změní na "Doména je ověřená. [Vypnout zkušební režim]" a je to jedno kliknutí |

**Riziko, které jsem nevyřešil:** uživatel si postaví kampaň na 20 000 lidí a teprve při odeslání zjistí, že je ve zkušebním režimu. Zmírňuju to tím, že na obrazovce publika je pruh: "Zkušební režim: z vybraných 12 480 příjemců se e-mail odešle jen 2 ověřeným adresám." Číslo v pruhu je ta nejsrozumitelnější forma varování, jakou umím vymyslet.

---
### 8.3 Import kontaktů

Šest kroků, každý s možností vrátit se o krok zpět bez ztráty práce. Průvodce je tady na místě (na rozdíl od odeslání kampaně), protože kroky mají tvrdé pořadí: bez mapování není náhled, bez náhledu není co potvrzovat.

```
Nahrání → Kontrola souboru → Mapování → Náhled → Volby → Import běží → Výsledek
```

#### 8.3.1 Krok 1: nahrání

```
┌──────────────────────────────────────────────────────────┐
│                                                            │
│                       ⬆                                    │
│         Přetáhněte sem soubor s kontakty                   │
│              nebo [ vyberte ze složky ]                    │
│                                                            │
│      Přijímáme CSV a Excel (.xlsx). Nejvýš 200 MB.        │
│                                                            │
│  ▸ Jak dostat kontakty z Excelu, Ecomailu nebo Mailchimpu │
└──────────────────────────────────────────────────────────┘
```

Rozbalovací návod obsahuje konkrétní kroky pro Excel ("Soubor → Uložit jako → CSV UTF-8"), Ecomail, Mailchimp a Sendy, protože odtud přichází většina prvních importů.

| Chyba | Hláška |
|---|---|
| Nepodporovaný formát | "Soubor `kontakty.pdf` neumíme přečíst. Potřebujeme CSV nebo Excel. Když máte kontakty v PDF, zkopírujte je do Excelu a uložte jako CSV." |
| Prázdný soubor | "Soubor je prázdný, nenašli jsme v něm žádné řádky." |
| Přes limit | "Soubor má 340 MB, zvládneme 200 MB. Rozdělte ho na díly, nebo z něj odeberte sloupce, které nepotřebujete." |
| Poškozený archiv Excelu | "Soubor `.xlsx` se nepodařilo otevřít, vypadá poškozeně. Zkuste ho v Excelu otevřít a uložit jako CSV UTF-8." |

#### 8.3.2 Krok 2: kontrola souboru

Nejdůležitější krok, o kterém většina nástrojů mlčí. Tady se chytí poškozená diakritika, což je v českém prostředí nejčastější problém vůbec.

```
┌──────────────────────────────────────────────────────────┐
│  Zkontrolujte, jestli soubor čteme správně                │
│                                                            │
│  Rozpoznali jsme:                                          │
│  Kódování   Windows-1250 (čeština z Excelu)   [Změnit ▾]  │
│  Oddělovač  středník ;                        [Změnit ▾]  │
│  Řádků      12 480, z toho 1 hlavička                     │
│                                                            │
│  ┌──────────────────────────────────────────────────────┐ │
│  │ Email            │ Jmeno a prijmeni │ Mesto          │ │
│  │ jana@firma.cz    │ Jana Nováková    │ Břeclav        │ │
│  │ petr@firma.cz    │ Ing. Petr Svoboda│ Žďár nad Sáz.  │ │
│  │ lucie@firma.cz   │ Lucie Černá      │ Ústí n. Labem  │ │
│  └──────────────────────────────────────────────────────┘ │
│                                                            │
│  ❓ Vypadají jména a města správně?                        │
│     Máte tam "Nováková" a "Břeclav", nebo něco jako       │
│     "NovĂˇkovĂˇ"?                                          │
│                                                            │
│         [ Ano, je to správně ]   [ Ne, je to rozsypané ]  │
└──────────────────────────────────────────────────────────┘
```

**Otázka místo nastavení.** Netechnický člověk neví, co je Windows-1250, ale okamžitě pozná, jestli je jeho město napsané správně. Tlačítko "Ne, je to rozsypané" nabídne tři nejpravděpodobnější alternativy kódování s okamžitým náhledem a nechá vybrat podle toho, které vypadá dobře.

#### 8.3.3 Krok 3: mapování sloupců

```
┌────────────────────────────────────────────────────────────────┐
│  Co je v jednotlivých sloupcích?                                │
│                                                                  │
│  Sloupec ze souboru        Ukázka          Uložit jako          │
│  ──────────────────────────────────────────────────────────────│
│  Email                     jana@firma.cz   [E-mail          ▾] ✓│
│  Jmeno a prijmeni          Jana Nováková   [Jméno a příjmení ▾] ✓│
│                                            ⓘ Rozdělíme na jméno │
│                                              a příjmení          │
│  Mesto                     Břeclav         [Město (vlastní) ▾] ✓│
│  Poznamka                  VIP klient      [Nepoužívat       ▾]  │
│  Datum registrace          15.3.2024       [Přihlášen dne    ▾] ✓│
│                                                                  │
│  ⚠ Sloupec "Poznamka" zatím nemáte jako vlastní pole.          │
│    [ Vytvořit pole "Poznámka" ]                                 │
│                                                                  │
│                                    [ Zpět ]  [ Zobrazit náhled ]│
└────────────────────────────────────────────────────────────────┘
```

| Rozhodnutí | Odůvodnění |
|---|---|
| **Ukázková hodnota u každého sloupce** | Uživatel mapuje podle obsahu, ne podle názvu hlavičky. Sloupec "Pole1" se dá zařadit, jen když je vidět, co v něm je. |
| **Automatický návrh podle názvu hlavičky** | Slovník synonym cs a en: e-mail / email / mail / e-mailová adresa / address; jméno / křestní / first name / given name; příjmení / surname / last name; telefon / phone / mobil; firma / společnost / company. Návrh se dá kdykoliv přepsat. |
| **Nabídka vytvořit vlastní pole rovnou** | Bez toho by uživatel musel import opustit, jít do nastavení, vytvořit pole a začít znovu. |
| **"Nepoužívat" je platná a viditelná volba** | Ne skrytá v seznamu dole. Většina souborů má sloupce, které nikoho nezajímají. |
| **Návrat z náhledu do mapování zakládá nový import** | Stavový diagram části 2 (4.6.10) přechod `previewing → validating` **zakazuje**, protože `idempotency_key` obsahuje mapování. Můj původní návrh sliboval bezešvý návrat o krok zpět, který systém neumí. Tlačítko "Zpět" v kroku 4 proto říká: **"Změnou mapování začneme import znovu. Nic se neztratí, soubor máme nahraný."** Nahraný soubor se použije znovu, uživatel nic nenahrává podruhé, jen se založí nový záznam importu. |
| **Rozpracovaný náhled má životnost 24 hodin** | Pod tabulkou náhledu: "Rozpracovaný import si pamatujeme 24 hodin. Potom bude potřeba soubor nahrát znovu." Bez toho se uživatel druhý den vrátí na prázdno a nepochopí proč. |
| Povinný je **jen e-mail** | Vše ostatní nepovinné. Import bez jména je legitimní. |

**Chyby mapování:**

| Situace | Hláška |
|---|---|
| Nezvolen e-mail | "Nevybrali jste, ve kterém sloupci je e-mailová adresa. Bez ní kontakt nemá kam přijít." Tlačítko "Zobrazit náhled" nechá aktivní, kliknutí přesune fokus na výběr. |
| Dva sloupce na totéž pole | "Do pole Jméno míří dva sloupce: `Jmeno` a `Krestni`. Vyberte jeden." |
| Datum v nerozpoznaném formátu | "V sloupci `Datum registrace` jsme nerozpoznali formát u 320 řádků, například `15/3/24`. [Nastavit formát ▾] nebo tyhle řádky necháme bez data." |

#### 8.3.4 Krok 4: náhled, včetně vokativu

Tady se prodává jedna z hlavních funkcí produktu. Náhled ukazuje **výsledek**, ne vstup.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Takhle to bude vypadat                                              │
│                                                                        │
│  ┌─────────────┬────────┬───────────┬──────┬──────────┬────────────┐ │
│  │ E-mail      │ Titul  │ Jméno     │ Rod  │ Příjmení │ Oslovení   │ │
│  ├─────────────┼────────┼───────────┼──────┼──────────┼────────────┤ │
│  │ jana@…      │        │ Jana      │ žena │ Nováková │ Dobrý den, │ │
│  │             │        │           │      │          │ Jano       │ │
│  │ petr@…      │ Ing.   │ Petr      │ muž  │ Svoboda  │ Dobrý den, │ │
│  │             │        │           │      │          │ Petře      │ │
│  │ lucie@…     │        │ Lucie     │ žena │ Černá    │ Dobrý den, │ │
│  │             │        │           │      │          │ Lucie      │ │
│  │ n.kim@…     │        │ Nguyen    │  ?   │ Kim      │ Dobrý den  │ │
│  └─────────────┴────────┴───────────┴──────┴──────────┴────────────┘ │
│                                                                        │
│  Prvních 20 z 12 480 řádků.        [ Zobrazit dalších 20 ]           │
│                                                                        │
│  ℹ U 143 kontaktů si nejsme jistí oslovením. Po importu vám je       │
│    ukážeme a necháme rozhodnout. Do té doby je oslovíme neutrálně    │
│    "Dobrý den" bez jména, nikdy ne špatně.                            │
│                                                                        │
│  ⚠ 6 řádků nemá e-mail a přeskočíme je. [Zobrazit]                   │
│  ⚠ 12 e-mailů se v souboru opakuje. Necháme poslední výskyt.         │
│                                        [ Zpět ]  [ Pokračovat ]      │
└─────────────────────────────────────────────────────────────────────┘
```

**Sloupec "Oslovení" je nejdůležitější sloupec náhledu.** Ukazuje přesně to, co uživatel uvidí v e-mailu. Řádek "Nguyen Kim" bez určeného rodu ukazuje fallback a je tam v ukázce schválně, protože uživatel musí vidět, že nástroj v nejistotě nehádá.

**Rozdělení jednoho sloupce se jménem** se dá doladit, když automatika selže:

```
▸ Jméno se dělí špatně?
  Pořadí ve zdroji:  (•) Jméno Příjmení    ( ) Příjmení Jméno
  Tituly:            ☑ Oddělit tituly před jménem (Ing., Mgr., MUDr.)
                     ☑ Oddělit tituly za jménem (Ph.D., CSc., DiS.)
  Dvojitá příjmení:  ☑ Zachovat celé (Nováková Svobodová)
```

#### 8.3.5 Krok 5: volby importu

```
┌────────────────────────────────────────────────────────────────┐
│  Poslední dvě otázky                                            │
│                                                                  │
│  Zařadit do seznamu                                             │
│  [ Zákazníci                                              ▾ ]   │
│  [ + Vytvořit nový seznam ]                                     │
│                                                                  │
│  Přidat štítek (nepovinné)                                      │
│  [ import-cerven-2026                                     ]     │
│  Tip: štítek se hodí, kdybyste chtěli tuhle skupinu později     │
│  najít nebo import vrátit zpět.                                 │
│                                                                  │
│  Co když už kontakt v databázi máme?                            │
│  ( ) Přeskočit         Necháme, co máme, ze souboru nic         │
│  (•) Doplnit           Přidáme, co chybí. Co už máme vyplněné,  │
│                        nepřepíšeme.                              │
│  ( ) Přepsat           Data ze souboru vyhrají.                 │
│                                                                  │
│  ─────────────────────────────────────────────────────────────  │
│                                                                  │
│  ☐ Potvrzuji, že tito lidé souhlasili se zasíláním obchodních   │
│    sdělení, nebo že k tomu mám jiný právní důvod.               │
│    [Co to znamená]                                              │
│                                                                  │
│                       [ Zpět ]  [ Naimportovat 12 462 kontaktů ]│
└────────────────────────────────────────────────────────────────┘
```

| Prvek | Odůvodnění |
|---|---|
| **Volby kolize popsané větou, ne názvem** | "Doplnit" a pod tím vysvětlení. "Update" nebo "Merge" nikomu nic neřekne. |
| **Výchozí je Doplnit** | Nejméně destruktivní volba, která zároveň dělá to, co uživatel obvykle chce. |
| **Souhlas jako checkbox, ne skryté ujednání** | Není to temný vzorec, je to jediné místo, kde se dá netechnickému člověku vysvětlit, že nakoupená databáze je nelegální. Odkaz "Co to znamená" otevře tři odstavce česky, bez právnických frází. |
| **Číslo na tlačítku** | 12 462, ne 12 480. Šest řádků bez e-mailu a dvanáct duplicit je už odečtených. Uživatel vidí skutečný výsledek. |

#### 8.3.6 Krok 6: průběh a výsledek

Průběh je akce třídy A4:

```
┌──────────────────────────────────────────────────────────┐
│  Importujeme kontakty                                     │
│                                                            │
│  ████████████████░░░░░░░░  8 400 z 12 462  (67 %)         │
│  Zbývá asi 40 sekund                                       │
│                                                            │
│  Import běží na serveru. Okno můžete zavřít, po návratu   │
│  uvidíte výsledek. Dáme vám vědět e-mailem.               │
│                                                            │
│                                    [ Zrušit import ]      │
└──────────────────────────────────────────────────────────┘
```

Zrušení importu je N2: "Zrušit import? Zpracovaných 8 400 kontaktů v databázi zůstane. Zbylých 4 062 se nenaimportuje. Půjde pokračovat od místa, kde jsme skončili."

**Pokračování od místa zrušení.** Část 2 (4.6.10) má `resume_from_import_id` a `checkpoint_byte`, takže zrušený import jde dokončit bez toho, aby se prvních 8 400 řádků procházelo znovu. Uživatel to musí vidět, jinak zrušený import znamená "začínám od nuly" a nikdo ho nezruší, ani když ví, že je špatně:

```
┌──────────────────────────────────────────────────────────┐
│  Import jste zrušili na řádku 8 400 z 12 462              │
│                                                            │
│  Zpracované kontakty v databázi zůstaly.                  │
│                                                            │
│  [ Pokračovat od řádku 8 401 ]  [ Vrátit celý import ]    │
└──────────────────────────────────────────────────────────┘
```

**Čtyři různé konce, ne jeden.** Můj původní návrh měl jednu obrazovku výsledku a byla vždycky úspěšná. Stavy z 4.6.10 části 2 jsou ale čtyři a každý znamená pro uživatele něco jiného:

| Stav | Nadpis obrazovky | Co uživatel může dělat |
|---|---|---|
| `completed` | ✓ Naimportováno 12 462 kontaktů | zobrazit kontakty, vrátit import |
| `completed_with_errors` | ⚠ Naimportováno 12 397 z 12 462 | totéž plus stáhnout chybné řádky |
| `cancelled` | ⏸ Import jste zrušili na řádku 8 400 | pokračovat, nebo vrátit |
| `failed` | ✕ Import se nepodařilo dokončit | **nic se nenaimportovalo**, plus důvod a co s tím |

Stav `failed` je nejdůležitější rozlišit, protože znamená, že se **nezapsalo nic**, kdežto `completed_with_errors` znamená, že se zapsala většina. Uživatel, který si to splete, buď zbytečně importuje podruhé, nebo si myslí, že má data, a nemá.

**Výsledek `completed_with_errors`:**

```
┌───────────────────────────────────────────────────────────────┐
│  ⚠ Naimportováno 12 397 z 12 462 kontaktů                      │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │ Nových kontaktů                                    9 812 │  │
│  │ Doplněných u existujících                          2 585 │  │
│  │ Přeskočeno, protože jsou na blokovaných adresách       9 │  │
│  │ Nepodařilo se                                         56 │  │
│  └──────────────────────────────────────────────────────────┘  │
│                                                                 │
│  ── Co jsme museli odhadnout ────────────────────────────────  │
│  U 213 řádků jsme si nebyli jistí a rozhodli jsme za vás.      │
│                                                                 │
│  ⚠ 84 dat vypadalo jako číslo z Excelu, brali jsme je jako     │
│    datum (například 45 231 → 30. 11. 2023).      [Zobrazit]    │
│  ⚠ 41 čísel šlo přečíst dvěma způsoby: 1,234 může být 1,234    │
│    i 1234. Brali jsme je jako 1,234.             [Zobrazit]    │
│  ⚠ 62 kontaktů nemá určený rod, oslovíme je neutrálně.         │
│  ⚠ 18 jmen se nepodařilo spolehlivě rozdělit.    [Zobrazit]    │
│  ⚠ 8 hodnot bylo delších, než pole dovoluje, zkrátili jsme je. │
│                                                                 │
│  ⚠ 9 adres jsme nepřidali, protože se v minulosti odhlásily    │
│    nebo se jim e-maily nedoručovaly.  [Zobrazit] [Co to je]    │
│                                                                 │
│  ── Co se nepodařilo ────────────────────────────────────────  │
│    ┌───────┬──────────────────────┬───────────────────────┐    │
│    │ Řádek │ Obsah                │ Proč                  │    │
│    ├───────┼──────────────────────┼───────────────────────┤    │
│    │ 4312  │ jana@@firma.cz       │ E-mail má dva zavináče│    │
│    │ 4520  │ petr.novak           │ Chybí část za zavináčem│   │
│    │ 5001  │ (prázdné)            │ Prázdný e-mail        │    │
│    └───────┴──────────────────────┴───────────────────────┘    │
│    Prvních 20 z 56.                                            │
│    [ Stáhnout 56 chybných řádků jako CSV ]                     │
│                                                                 │
│  ℹ U 143 kontaktů si nejsme jistí oslovením. [ Zkontrolovat ]  │
│                                                                 │
│  [ Zobrazit naimportované kontakty ]     ▸ Vrátit tento import │
└───────────────────────────────────────────────────────────────┘
```

**Sekce "Co jsme museli odhadnout" je nová a je to nejdůležitější změna oproti mému původnímu návrhu.** Část 2 má jedenáct kódů varování, u kterých se řádek naimportuje, ale nástroj něco odhadl. Zrovna `excel_serial_date_assumed` a `number_format_ambiguous` jsou tiché chyby, které se projeví až za měsíc, když někdo pošle kampaň s datem narození o tři roky vedle. **Varování, které nemá kam se zobrazit, je stejné jako žádné varování.**

Úplné mapování jedenácti varování části 2 na texty v rozhraní:

| Kód | Text v rozhraní |
|---|---|
| `excel_serial_date_assumed` | {n} dat vypadalo jako číslo z Excelu, brali jsme je jako datum (například 45 231 → 30. 11. 2023). |
| `number_format_ambiguous` | {n} čísel šlo přečíst dvěma způsoby: 1,234 může být 1,234 i 1234. Brali jsme je jako {výklad}. |
| `value_truncated` | {n} hodnot bylo delších, než pole dovoluje, zkrátili jsme je. |
| `name_split_low_confidence` | {n} jmen se nepodařilo spolehlivě rozdělit na jméno a příjmení. |
| `vietnamese_order_assumed` | U {n} jmen jsme použili vietnamské pořadí (příjmení první). |
| `gender_unknown` | {n} kontaktů nemá určený rod, oslovíme je neutrálně. |
| `gender_conflict` | U {n} kontaktů si jméno a příjmení odporují v rodu. |
| `vocative_low_confidence` | U {n} kontaktů si nejsme jistí oslovením. |
| `non_latin_script` | {n} jmen není v latince, oslovení jsme nepočítali. |
| `suppressed_skipped` | {n} adres jsme nepřidali, protože se v minulosti odhlásily nebo se jim e-maily nedoručovaly. |
| `trailing_fields_padded` | {n} řádků mělo míň sloupců než hlavička, chybějící jsme nechali prázdné. |

Varování se **shlukují po kódu**, nikdy se nevypisuje 84 řádků. U každého je odkaz na výpis dotčených řádků. Když je varování nula, řádek se nezobrazí vůbec, aby sekce nezplaněla.

**Chyby na úrovni řádku** používají kódy části 2 (4.6.11) a rozhraní k nim dodává český text. Úplný převod pro šestnáct kódů:

| Kód | Text ve sloupci "Proč" |
|---|---|
| `row_field_count_mismatch` | Jiný počet sloupců než v hlavičce |
| `email_missing` | Prázdný e-mail |
| `email_invalid` | Neplatná e-mailová adresa |
| `email_too_long` | E-mail je delší než 254 znaků |
| `email_domain_invalid` | Doména za zavináčem není platná |
| `email_disposable` | Jednorázová e-mailová adresa |
| `duplicate_in_file` | Stejná adresa je v souboru víckrát |
| `invalid_number` | Není to číslo |
| `invalid_boolean` | Není to ano ani ne |
| `invalid_date` | Není to datum |
| `invalid_datetime` | Není to datum a čas |
| `invalid_enum_value` | Hodnota není mezi povolenými |
| `invalid_url` | Není to webová adresa |
| `invalid_phone` | Není to telefonní číslo |
| `value_too_long` | Hodnota je delší, než pole dovoluje |
| `required_field_missing` | Povinné pole je prázdné |
| `unknown_field_key` | Mapování ukazuje na pole, které neexistuje |
| `encoding_error` | Znaky nedávají v tomhle kódování smysl |
| `name_empty` | Jméno je prázdné |
| `list_not_found` | Seznam z mapování neexistuje |

**Stažení chybných řádků.** Formát vlastní část 2 (4.6.11) a je závazný:

| Vlastnost | Hodnota |
|---|---|
| Hlavička | **stejná jako v původním souboru** |
| Přidané sloupce | **dva**: `_error_code` a `_error_detail` |
| Kódování | **stejné jako v původním souboru**, ne UTF-8 |
| Oddělovač | **stejný jako v původním souboru** |
| Účel | uživatel opraví a nahraje zpátky **bez přemapování** |

Můj původní návrh měl jeden sloupec `chyba` a to by ten kolotoč rozbilo. **Sloupce v `errors.csv` se nikdy nepřekládají podle jazyka uživatele**, na rozdíl od běžného exportu, viz oprava v 12.6. Kdyby se přeložily, automapování při opětovném nahrání by selhalo a smysl celé funkce by zmizel.

**Výsledek `failed`:**

```
┌───────────────────────────────────────────────────────────────┐
│  ✕ Import se nepodařilo dokončit                               │
│                                                                 │
│  Do databáze se nezapsal žádný kontakt.                        │
│                                                                 │
│  Kódování souboru neumíme přečíst. Uložte ho v Excelu přes     │
│  Soubor → Uložit jako → CSV UTF-8 a zkuste to znovu.           │
│                                                                 │
│  [ Nahrát jiný soubor ]                                        │
│  ▸ Podrobnosti pro technickou podporu                          │
└───────────────────────────────────────────────────────────────┘
```

Deset kódů chyb na úrovni souboru z 4.6.11 části 2 (`file_too_large`, `too_many_rows`, `too_many_columns`, `empty_file`, `unsupported_encoding`, `delimiter_not_detected`, `malformed_csv`, `no_email_column_mapped`, `storage_unavailable`, `contact_limit_reached`) má každý vlastní druhý odstavec s konkrétním krokem. Texty pro pět z nich jsou v katalogu 10.3.

#### 8.3.7 Kontrola oslovení

**Fronta se nikdy nezobrazuje po kontaktech, vždy po skupinách.** Část 2 to v 4.5.2 zakazuje výslovně a má pravdu: 143 nejistých kontaktů typicky dá 30 až 60 skupin podle klíče jméno plus rod plus vokativ. To je rozdíl mezi "proklikám to za dvě minuty" a "na to nemám čas". Můj původní návrh měl 143 řádků na osmi stránkách a byl špatně.

```
┌─────────────────────────────────────────────────────────────────┐
│  Zkontrolujte oslovení                                           │
│                                                                    │
│  U 143 kontaktů si nejsme jistí oslovením. Rozdělili jsme je      │
│  do 34 skupin podle jména. Do doby, než rozhodnete, jim píšeme    │
│  "Dobrý den" bez jména.                                            │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │ Nikola                                    18 kontaktů    │    │
│  │ Horák, Nováková, Svobodová, +15                          │    │
│  │                                                            │    │
│  │ Jméno Nikola může patřit muži i ženě.                     │    │
│  │ Jak ho máme oslovovat?                                     │    │
│  │                                                            │    │
│  │ Pohlaví  ( ) muž → Nikolo   (•) žena → Nikolo   ( ) nevím │    │
│  │ Oslovení [ Nikolo                                ]        │    │
│  │                                                            │    │
│  │ ☑ Zapamatovat i pro budoucí kontakty se jménem Nikola     │    │
│  │                                                            │    │
│  │ [ Potvrdit pro 18 kontaktů ]  [ Neoslovovat jménem ]      │    │
│  │                                          [ Odložit ]      │    │
│  ├──────────────────────────────────────────────────────────┤    │
│  │ René                                       9 kontaktů    │    │
│  │ …                                                          │    │
│  └──────────────────────────────────────────────────────────┘    │
│                                                                    │
│  Zbývá 34 skupin                          ‹ Předchozí   Další ›   │
└─────────────────────────────────────────────────────────────────┘
```

| Prvek | Rozhodnutí a odůvodnění |
|---|---|
| **Skupina, ne kontakt** | Klíč skupiny je `(lower(unaccent(first_name)), gender, first_name_vocative)` podle 4.5.2 části 2. Nadpis je jméno, pod ním počet a **vzorek příjmení**, aby uživatel viděl, o koho jde. |
| **Text otázky** | Klíč `contacts.vocative.groupHint` z části 2 doslova: "Jméno {name} může patřit muži i ženě. Jak ho máme oslovovat?" |
| **Pět operací, ne dvě** | Část 2 v 4.5.3 definuje: potvrdit návrh, opravit vokativ, nastavit rod, nepoužívat jméno, odložit. Všechny musí být dostupné. Můj původní návrh měl jen "Ano" a "Upravit". |
| **"Zapamatovat i pro budoucí" je předzaškrtnuté** | Přebírám z části 2 včetně odůvodnění: bez toho fronta konverguje k nule jen náhodou. Po potvrzení se objeví `contacts.vocative.savedOverride`: "Zapamatujeme si to i pro budoucí kontakty se jménem Nikola." |
| **"Odložit"** | Skupina zmizí z výchozího pohledu, ale zůstane `low`. Ukládá se na uživatele, ne na kontakt. Bez toho uživatel u sporné skupiny uvízne a frontu opustí celou. |
| **Změna pohlaví přepočítá návrh živě** | Rod je nejčastější příčina špatného tvaru, takže musí být první ovládací prvek a musí být vidět jeho dopad. |
| **Žádný řádek s neurčeným rodem** | Kontakt, kde je rod `unknown` a použije se neutrální oslovení, ve frontě **není**, protože není co potvrzovat. Do fronty patří jen `vocative_confidence = 'low'` a `vocative_locked = false`. Můj původní návrh tam takový řádek měl a byl to šum. |
| **Hromadné operace nad 5 000 kontaktů** | Běží jako úloha na pozadí (třída A4) s průběhem, podle 4.5.3 části 2. Do 5 000 synchronně. |
| **Zamčení** | Poznámka pod frontou: "Co jednou potvrdíte nebo opravíte, už nikdy sami nezměníme." Uživatel se bojí, že mu nástroj opravu přepíše. |

**Dvě hromadné akce nad celou frontou** zůstávají nahoře, protože 95 % uživatelů udělá jedno kliknutí a odejde a oba výsledky jsou bezpečné:

```
[ Potvrdit všechny návrhy (34 skupin) ]  [ Neoslovovat jménem u všech ]
```

**Fronta je dostupná i mimo import**: Kontakty → Zkontrolovat oslovení, s odznakem s počtem **skupin**, ne kontaktů.

#### 8.3.8 Kontrola oslovení před odesláním kampaně

Část 2 v 4.5.4 předepisuje upozornění na obrazovce kampaně. Zařazuju ho do kontrolního seznamu připravenosti (8.6.2) jako **varování**, ne blokující položku:

> ⚠ **Oslovení** U 143 kontaktů z 3 214 si nejsme jistí oslovením.
> [ Zkontrolovat teď ] [ Poslat s neutrálním oslovením ] [ Poslat tak, jak je ]

Prostřední volba je nejzajímavější: nastaví neutrální oslovení **jen pro tuhle kampaň**, přes příznak v materializaci publika, nikoliv zápisem do kontaktů. Uživatel tedy může odeslat bezpečně, aniž by musel frontu projít, a aniž by tím nevratně zahodil odvedenou práci nástroje. V rozhraní to musí být napsané: "Změní se jen tahle kampaň, kontakty zůstanou beze změny."

### 8.4 Segment builder

Skládání podmínek pro člověka, který nikdy neviděl dotazovací jazyk. Nejtěžší obrazovka po DNS, protože tady se sráží mocnost s pochopitelností.

#### 8.4.1 Dvě cesty na jedné obrazovce

```
┌────────────────────────────────────────────────────────────────┐
│  Nový segment                                                    │
│                                                                  │
│  ── Začněte hotovým ─────────────────────────────────────────   │
│  ┌────────────────────────────┐ ┌────────────────────────────┐  │
│  │ Nikdy neotevřel            │ │ Nikdy neklikl              │  │
│  │ 890 kontaktů               │ │ 1 340 kontaktů             │  │
│  │ aktualizováno před 20 min  │ │ aktualizováno před 8 h  ⚠  │  │
│  │ Dostali aspoň 3 e-maily    │ │ Dostali aspoň 5 e-mailů    │  │
│  │ a žádný neotevřeli         │ │ a v žádném neklikli        │  │
│  │               [ Použít ]   │ │  [Přepočítat] [ Použít ]   │  │
│  └────────────────────────────┘ └────────────────────────────┘  │
│  ┌────────────────────────────┐ ┌────────────────────────────┐  │
│  │ Neaktivní 90+ dní          │ │ Neotevřel posledních 5     │  │
│  │ 1 204 kontaktů             │ │ 640 kontaktů               │  │
│  │               [ Použít ]   │ │               [ Použít ]   │  │
│  └────────────────────────────┘ └────────────────────────────┘  │
│  ┌────────────────────────────┐ ┌────────────────────────────┐  │
│  │ Nepotvrzené přihlášení     │ │ Opakované měkké odrazy     │  │
│  │ starší 30 dní              │ │ 87 kontaktů                │  │
│  │ 312 kontaktů               │ │ Aspoň 3× se e-mail dočasně │  │
│  │               [ Použít ]   │ │ nedoručil  [ Použít ]      │  │
│  └────────────────────────────┘ └────────────────────────────┘  │
│                                                                  │
│  ── Nebo si postavte vlastní ────────────────────────────────   │
│                        [ Postavit vlastní segment ]             │
└────────────────────────────────────────────────────────────────┘
```

**Šest presetů, ne moje vymyšlené čtyři.** Definice vlastní část 2 (její 4.12), já vlastním jen jejich podání. Klíč `preset_key` je závazný.

| `preset_key` | Název v rozhraní | Vysvětlující věta na kartě |
|---|---|---|
| `never_opened` | Nikdy neotevřel | Dostali aspoň 3 e-maily a žádný neotevřeli. |
| `never_clicked` | Nikdy neklikl | Dostali aspoň 5 e-mailů a v žádném neklikli. |
| `inactive_90d` | Neaktivní 90+ dní | Za poslední 3 měsíce nic neudělali a máme je déle než 3 měsíce. |
| `no_open_last_n` | Neotevřel posledních 5 kampaní | Dostali posledních 5 kampaní a žádnou neotevřeli. |
| `unconfirmed_30d` | Nepotvrzené přihlášení starší 30 dní | Přihlásili se, ale nikdy nepotvrdili odkaz v e-mailu. |
| `repeated_soft_bounces` | Opakované měkké odrazy | Aspoň 3× se jim e-mail dočasně nedoručil. |

**Věta "Dostali aspoň 3 e-maily" na kartě není dekorace.** Část 2 upozorňuje, že bez téhle podmínky by do "nikdy neotevřel" spadli i lidé, kterým jsme nikdy nic neposlali, a že je to nejčastější chyba konkurenčních nástrojů. Uživatel tomu musí rozumět **předtím**, než na segment pošle reaktivační kampaň, takže to patří na kartu, ne do nápovědy.

**Karta vždycky ukazuje stáří počtu**, viz 8.4.4. Karta s číslem starším 6 hodin má tlačítko "Přepočítat" a číslo je šedé. Preset bez počtu (nikdy nepočítaný) ukáže "Spočítat" místo čísla, nikdy nulu.

**Hotové segmenty jsou hlavní cesta, ne doplněk.** Většina uživatelů nikdy nepůjde dál. "Použít" vytvoří **kopii** s vyplněným `preset_key`, kterou lze dál upravovat, ne odkaz na cizí definici.

#### 8.4.1b Reaktivační scénář

Šestikrokový scénář vlastní část 2 (4.12). Poslední krok je **hromadné odhlášení, tedy nevratná akce nad daty, která uživatel roky sbíral**, a to je moje území. Rozepisuju proto celý průběh z pohledu obrazovek.

```
1. Vyber segment  →  2. Zmrazit  →  3. Kampaň  →  4. Nastav úklid
                                                          ↓
                       6. Potvrzení před úklidem  ←  5. Čekání N dní
```

| Krok | Co uživatel vidí | Co se stane |
|---|---|---|
| 1 | Karta presetu s počtem a vzorkem pěti jmen | nic, jen náhled |
| 2 | "Seznam zmrazíme, aby se během kampaně neměnil. Kdo se mezitím sám ozve, z úklidu vypadne." | vznikne statický segment |
| 3 | Editor s předvyplněnou šablonou "Chceme vědět, jestli vás to ještě zajímá" a jedním tlačítkem | kampaň jako každá jiná, včetně kontrolního seznamu z 8.6.2 |
| 4 | Formulář: za kolik dní (7 až 60, výchozí 14) a co pak udělat | naplánuje se úklidový job |
| 5 | Na Přehledu odpočet: "Za 12 dní se rozhodne o 1 842 kontaktech. [Zobrazit]" | čeká se |
| 6 | **Dialog a e-mail 3 dny předem**, viz níž | uživatel má poslední slovo |

**Krok 4, volba akce.** Tři možnosti, formulované následkem, ne názvem:

```
Co uděláme s těmi, kdo se neozvou?

(•) Odhlásit je z odběru            Zůstanou v databázi, ale
                                     kampaně jim už neposíláme.
( ) Jen je označit štítkem           Nic se nezmění, jen si je
                                     odložíme na později.
( ) Smazat je                        Nenávratně. Může jen vlastník
                                     projektu.
```

**Krok 6, poslední potvrzení.** Přichází 3 dny předem v aplikaci i e-mailem, protože uživatel v aplikaci týdny být nemusí. Text vychází z klíče `segments.cleanup.warning` části 2:

```
┌──────────────────────────────────────────────────────────────┐
│  Za 3 dny odhlásíme 1 842 kontaktů                            │
│                                                                │
│  Reaktivační kampaň Chceme vědět, jestli vás to zajímá        │
│  odešla 18. 7. na 2 480 lidí. Do dneška se ozvalo 638.        │
│                                                                │
│  Zbývajících 1 842 odhlásíme 3. 8. v 8:00.                    │
│  Odhlášení nejde vzít zpět. Kdo se bude chtít vrátit,         │
│  musí se přihlásit znovu sám.                                  │
│                                                                │
│  [ Stáhnout těch 1 842 kontaktů ]                             │
│                                                                │
│  [ Zkontrolovat ]  [ Odložit o 14 dní ]  [ Zrušit úklid ]     │
└──────────────────────────────────────────────────────────────┘
```

Tři tlačítka odpovídají tomu, co část 2 předepisuje ("Zkontrolovat · Odložit · Zrušit"). Nabídka stažení je stejná pojistka jako u hromadného mazání v 6.5 a naráží na stejný problém s oprávněními, viz R18.

**Úroveň ochrany je N4** podle 6.1: rozsah nad 100, nenávratné, dopad ven ke koncovým lidem. Opisování názvu je tady na místě, protože scénář se spouští jednou za rok, ne každý týden.

#### 8.4.2 Builder

```
┌─────────────────────────────────────────────────────────────────────┐
│  Název segmentu  [ Aktivní zákazníci z Brna                    ]     │
│                                                                       │
│  Kontakty, které [ splňují ▾ ] [ všechny podmínky ▾ ]                │
│                                                                       │
│  ┌───────────────────────────────────────────────────────────────┐   │
│  │ [Město            ▾] [je              ▾] [Brno            ]  ✕ │   │
│  ├───────────────────────────────────────────────────────────────┤   │
│  │ [Poslední aktivita▾] [je za posledních▾] [90 ] dní           ✕ │   │
│  ├───────────────────────────────────────────────────────────────┤   │
│  │ [Seznam Zákazníci ▾] [má potvrzené přihlášení ▾]             ✕ │   │
│  ├───────────────────────────────────────────────────────────────┤   │
│  │ [Souhlas s newsl. ▾] [má udělený      ▾]                     ✕ │   │
│  ├───────────────────────────────────────────────────────────────┤   │
│  │ [Blokované adresy ▾] [není mezi nimi  ▾]                     ✕ │   │
│  └───────────────────────────────────────────────────────────────┘   │
│                                                                       │
│  [ + Přidat podmínku ]              [ + Přidat skupinu podmínek ]    │
│                                                                       │
│  ─────────────────────────────────────────────────────────────────   │
│  Do segmentu patří 1 208 kontaktů        aktualizováno před chvílí    │
│                                                                       │
│  Například:                                                           │
│    Jana Nováková    jana@firma.cz     naposledy aktivní před 3 dny   │
│    Petr Svoboda     petr@firma.cz     naposledy aktivní před 12 dny  │
│    Lucie Černá      lucie@firma.cz    naposledy aktivní před 1 dnem  │
│    Martin Kučera    martin@firma.cz   naposledy aktivní před 30 dny  │
│    Eva Pokorná      eva@firma.cz      naposledy aktivní před 8 dny   │
│                                       [ Zobrazit všech 1 208 ]        │
│                                                                       │
│  ▸ Zobrazit definici jako JSON                                        │
│                                     [ Zrušit ]  [ Uložit segment ]   │
└─────────────────────────────────────────────────────────────────────┘
```

| Rozhodnutí | Odůvodnění |
|---|---|
| **Žádné AND a OR v rozhraní** | Nahrazeno větou "Kontakty, které splňují **všechny / alespoň jednu** podmínku". Lidé si "a" v běžné řeči vykládají jako sjednocení, takže operátor AND způsobuje systematické nedorozumění. Část 2 v 6.4 navrhuje "A zároveň / Nebo", což je lepší než AND a OR, ale pořád to je operátor. Sémantika je identická, mění se jen formulace, takže to nemá dopad na AST. |
| **Věta nahoře je součást builderu, ne popisek** | Rozbalovací seznamy v ní jsou skutečné ovládací prvky. Uživatel čte větu a mění ji, ne "nastavuje operátor". |
| **Pět skutečných lidí pod počtem** | Nejúčinnější prvek celé obrazovky. Netechnický člověk neumí ověřit logický výraz, ale okamžitě pozná, jestli mezi jmény sedí ti, koho měl na mysli. Náhled části 2 vrací vzorek 20, zobrazujeme z něj 5 náhodných a zbytek na rozbalení. |
| **Třetí sloupec ukazuje hodnotu relevantní k podmínkám** | Když je v segmentu podmínka na poslední aktivitu, ukáže se poslední aktivita. Uživatel tak vidí, proč tam ten člověk patří. |
| **"Přidat skupinu podmínek" je vizuálně slabší** | Vnořování je pokročilá funkce, kterou většina uživatelů nepotřebuje. Nesmí být na stejné úrovni jako přidání podmínky. |
| **Zobrazení JSON pod rozbalením** | Přebírám z 6.4 části 2. Žádám jen, aby nebylo nikdy výchozí, protože pro cílového uživatele je to šum. |

#### 8.4.2b Negace skupiny

`GroupNode` má v AST pole `not`. Bez ovládacího prvku by 
byla celá jedna třída segmentů nedostupná, takže první rozbalovací seznam ve větě má dvě hodnoty:

```
Kontakty, které [ splňují   ▾ ] [ všechny podmínky ▾ ]
                [ nesplňují ▾ ]   [ alespoň jednu podmínku ▾ ]
```

Čtyři kombinace a jejich význam v AST:

| Věta v rozhraní | `op` | `not` |
|---|---|---|
| Kontakty, které **splňují všechny** podmínky | `and` | `false` |
| Kontakty, které **splňují alespoň jednu** podmínku | `or` | `false` |
| Kontakty, které **nesplňují všechny** podmínky (tedy aspoň jednu porušují) | `and` | `true` |
| Kontakty, které **nesplňují ani jednu** podmínku | `or` | `true` |

Třetí řádek je jazykově zrádný, protože "nesplňují všechny" si část lidí přečte jako "nesplňují žádnou". Proto se pod větou s aktivní negací zobrazuje **vysvětlující řádek**:

> ℹ Do segmentu spadnou kontakty, u kterých **neplatí aspoň jedna** z podmínek níž.

Negace na vnořené skupině se ovládá stejně, jen ve větě té skupiny.

#### 8.4.2c Prázdné hodnoty a tříhodnotová logika

Nejzrádnější místo celého builderu. Kontakt, který pole vůbec nemá vyplněné, **nespadne ani do "město je Praha", ani do "město není Praha"**. Netechnický člověk to nečeká a bez upozornění tiše ztratí část databáze.

Opatření jsou tři:

1. **Operátory "je prázdné" a "není prázdné"** jsou v nabídce u každého pole, které je smí mít (podle typové matice v 4.11.2 části 2), a nejsou schované na konci seznamu.
2. **Nápověda u negujících operátorů.** Kdykoliv uživatel zvolí `neq`, `not_contains`, `not_in`, `has_none` nebo `not_in_last_days`, objeví se pod podmínkou text `segments.notNullHint` z části 2:
   > Kontakty, které pole vůbec nemají, sem nespadnou. Použijte podmínku „je prázdné".
   
   Použil jsem klíč z části 2 doslova, protože ten text tam už je připravený a dva různé texty pro totéž by byly horší než jeden.
3. **Nabídka opravy.** Vedle nápovědy je tlačítko **[ Přidat i kontakty bez vyplněného pole ]**, které samo vytvoří skupinu `alespoň jednu` s původní podmínkou a s `je prázdné`. Uživatel tak nemusí pochopit tříhodnotovou logiku, stačí mu odpovědět na otázku "chcete je tam taky?".

#### 8.4.3 Výběr pole a operátorů

Rozbalovací seznam s vyhledáváním. Skupiny odpovídají `FieldRef.kind` z AST části 2 jedna ku jedné, jen jsou pojmenované lidsky.

```
┌────────────────────────────────────────┐
│ 🔍 [ hledat pole…                  ]   │
├────────────────────────────────────────┤
│ O ČLOVĚKU                (kind: contact)│
│   Jméno                                 │
│   Příjmení                              │
│   E-mail                                │
│   Doména e-mailu                        │
│   Pohlaví                               │
│   Jazyk komunikace                      │
│   Stav kontaktu                         │
│   Odkud přišel                          │
│   Jistota oslovení                      │
│   Omezené zpracování (GDPR)             │
├────────────────────────────────────────┤
│ VLASTNÍ POLE           (kind: attribute)│
│   Město                                 │
│   Telefon              ⚠ neindexované  │
│   Poznámka             ⚠ neindexované  │
├────────────────────────────────────────┤
│ ŠTÍTKY                     (kind: tag)  │
│   Má štítek                             │
├────────────────────────────────────────┤
│ SEZNAMY                   (kind: list)  │
│   Seznam Zákazníci                      │
│   Seznam Newsletter                     │
├────────────────────────────────────────┤
│ SOUHLASY               (kind: consent)  │
│   Souhlas s newsletterem                │
│   Souhlas s měřením návštěvnosti        │
│   Souhlas s personalizací               │
│   Souhlas s profilováním                │
│   Souhlas s předáním třetí straně       │
├────────────────────────────────────────┤
│ BLOKOVANÉ ADRESY   (kind: suppression)  │
│   Je mezi blokovanými                   │
├────────────────────────────────────────┤
│ AKTIVITA V KAMPANÍCH (kind: engagement) │
│   Dostal kampaň                         │
│   Doručilo se mu                        │
│   Otevřel kampaň                        │
│   Klikl v kampani                       │
│   E-mail se nedoručil                   │
├────────────────────────────────────────┤
│ CHOVÁNÍ NA WEBU          (kind: event)  │
│   Provedl akci                          │
├────────────────────────────────────────┤
│ ČASY                   (kind: contact)  │
│   Poslední aktivita                     │
│   Datum vytvoření                       │
│   Datum poslední změny                  │
├────────────────────────────────────────┤
│ JINÝ SEGMENT           (kind: segment)  │
│   Je v segmentu                         │
└────────────────────────────────────────┘
```

**Nabídka operátorů se řídí typovou maticí z 4.11.2 části 2** a nekompatibilní se vůbec nezobrazují, takže uživatel nemůže sestavit neplatný AST. Následující tabulka je **jediná normativní věc, kterou tady vlastním**: český překlad každého operátoru. Sloupec s kódem je vlastnictví části 2 a nesmím ho měnit.

| Třída pole | Operátor v AST | Česky v rozhraní | English |
|---|---|---|---|
| text a spol. | `eq` | je | is |
| | `neq` | není | is not |
| | `contains` | obsahuje | contains |
| | `not_contains` | neobsahuje | does not contain |
| | `starts_with` | začíná na | starts with |
| | `ends_with` | končí na | ends with |
| | `in` | je jedno z | is any of |
| | `not_in` | není žádné z | is none of |
| | `is_empty` | je prázdné | is empty |
| | `is_not_empty` | je vyplněné | is not empty |
| číslo | `gt` / `gte` | je větší než / je aspoň | is greater than / is at least |
| | `lt` / `lte` | je menší než / je nejvýš | is less than / is at most |
| | `between` | je mezi | is between |
| ano/ne | `is_true` / `is_false` | je zaškrtnuté / není zaškrtnuté | is checked / is not checked |
| datum | `on` | je přesně | is on |
| | `before` / `after` | je před / je po | is before / is after |
| | `in_last_days` | je za posledních | is within the last |
| | `not_in_last_days` | není za posledních | is not within the last |
| | `in_next_days` | je v příštích | is within the next |
| výběr z více | `has_any` | má aspoň jeden z | has any of |
| | `has_all` | má všechny z | has all of |
| | `has_none` | nemá žádný z | has none of |
| **seznam** | `is_member` | je v něm | is a member |
| | `is_not_member` | není v něm | is not a member |
| | `is_confirmed` | má potvrzené přihlášení | is confirmed |
| | `is_pending` | čeká na potvrzení | is pending confirmation |
| | `is_unsubscribed` | odhlásil se z něj | has unsubscribed |
| **souhlas** | `is_granted` | má udělený | is granted |
| | `is_withdrawn` | odvolal | is withdrawn |
| | `is_missing` | nikdy nedal | was never given |
| **blokované** | `is_suppressed` | je mezi blokovanými | is suppressed |
| | `is_not_suppressed` | není mezi blokovanými | is not suppressed |
| aktivita | `did` | ano | did |
| | `did_not` | ne | did not |
| | `count_gte` | aspoň Nkrát | at least N times |
| | `count_lte` | nejvýš Nkrát | at most N times |
| segment | `in` / `not_in` | je v něm / není v něm | is in / is not in |

**Čtyři poznámky, které z toho plynou:**

1. **Souhlasy jsou nejcitlivější pole v segmentaci** a rozlišení `is_withdrawn` (aktivně odvolal) od `is_missing` (nikdy nedal) je právně podstatné. V rozhraní jsou proto pojmenované různě a u obou je nápověda vysvětlující rozdíl. Bez toho by uživatel použil "nemá souhlas" a nevěděl, koho tím zahrnul.
2. **Pět operátorů u seznamu, ne dva.** Bez `is_pending` nejde postavit preset "nepotvrzená přihlášení starší 30 dní", který část 2 v 4.12 má.
3. **`is_confirmed` je to, co uživatel obvykle myslí**, když řekne "je v seznamu". Proto je v nabídce **první** a `is_member` až za ním, s nápovědou "včetně těch, kdo přihlášení zatím nepotvrdili".
4. **Ikona u neindexovaného pole** přebírá pravidlo z 6.4 části 2. Text nápovědy: "Podle tohohle pole se hledá pomaleji. U velké databáze může výpočet trvat déle."

#### 8.4.3b Limity a jak se podávají

**Hodnoty limitů vlastní část 2** (její 4.11.4), já vlastním jen to, jak se o nich uživatel dozví. Můj původní návrh měl vnoření 2 a strop 24 podmínek, což bylo z mé hlavy a dělalo z většiny povoleného AST mrtvý kód. Opravuju to na skutečné hodnoty:

| Limit | Hodnota | Kód chyby | Kdy a jak se uživatel dozví |
|---|---|---|---|
| Podmínek celkem | 100 | `segment_too_complex` | Od 80 podmínek se pod builderem objeví nenápadné "80 ze 100 podmínek". Při pokusu přidat 101. je tlačítko "Přidat podmínku" nahrazeno hláškou s odkazem na rozdělení segmentu. |
| Hloubka zanoření | 5 | `segment_too_deep` | Tlačítko "Přidat skupinu podmínek" se v páté úrovni nahradí textem "Hlouběji už zanořovat nejde." Uživatel na limit nenarazí chybou, ale absencí tlačítka, což je u strukturálního limitu správně. |
| Potomků ve skupině | 50 | `segment_too_complex` | Stejný vzor jako u celkového počtu. |
| Podmínek na aktivitu v kampaních | 5 | `segment_too_many_engagement` | Šestá položka z téhle skupiny je v nabídce polí zašedlá s vysvětlením "Podmínek na aktivitu v kampaních může být nejvýš 5, protože každá z nich prohledává historii odeslaných zpráv." |
| Podmínek na chování na webu | 3 | `segment_too_many_event` | Totéž. |
| Hloubka odkazů na segmenty | 2 | `segment_nesting_too_deep` | V nabídce "Je v segmentu" se nezobrazí segmenty, které by limit překročily, s vysvětlením u seznamu. |
| Cyklus mezi segmenty | zakázán | `segment_cycle` | Blokuje uložení, hláška jmenuje oba segmenty. |
| Položek v "je jedno z" | 1 000 | `segment_list_too_long` | Počítadlo u pole a odmítnutí vložení přes schránku s uvedením, kolik položek bylo zahozeno. |

**Vnoření 5 je hodně a v rozhraní to je vidět.** Od třetí úrovně se skupiny odsazují méně a dostávají číslo ("Skupina 3.1"), aby se strom nerozjel do šířky. Zároveň se od třetí úrovně nabízí odkaz "Tenhle segment je složitý. Nechcete ho rozdělit na dva?", protože složitý strom je téměř vždy snazší vyjádřit dvěma segmenty a podmínkou "je v segmentu". Je to nabídka, ne blokace.

#### 8.4.4 Živý počet: stavy a varování

Náhled části 2 (`POST /api/v1/segments/preview`, její 4.11.5) vrací `{ count, exact, duration_ms, warnings, sample }`. Rozhraní z toho skládá:

| Stav | Podklad | Zobrazení |
|---|---|---|
| Počítá se | probíhá požadavek | "Počítáme…" s nenápadnou animací. **Předchozí číslo zůstává ztlumené, nemizí** (pravidlo z 6.4 části 2). |
| Hotovo, přesné | `exact: true` | "Do segmentu patří **1 208 kontaktů**" plus vzorek plus stáří |
| Hotovo, odhad | `exact: false`, varování `segment_count_estimated` | Text `segments.estimated` z části 2: "**Přibližně 1 200 kontaktů.** [Spočítat přesně]". Přesný výpočet zařadí job `segments.recount` a běží jako úloha na pozadí (třída A4), takže uživatel nečeká. |
| Prázdný výsledek | `count: 0` | Zvláštní stav s diagnostikou, viz níž |
| Chyba | | "Počet se nepodařilo spočítat. [Zkusit znovu]" plus sbalené podrobnosti |
| Přes limit | `segment_too_complex` a spol. | Viz 8.4.3b, hlášky jmenují konkrétní limit |

**Stáří počtu je vidět vždycky.** Část 2 v 4.11.6 předepisuje "aktualizováno před 3 hodinami" a u hodnot starších než 6 hodin šedý text s ikonou. Přebírám to beze změny včetně klíče `segments.stale`, protože **bez toho by karty presetů i seznam segmentů porušovaly můj vlastní princip P7 "Nelžeme čísly"**. Číslo z včerejška vypadá stejně jako číslo z této vteřiny a uživatel podle něj plánuje rozesílku.

| Stáří | Zobrazení |
|---|---|
| do 15 minut | "aktualizováno před chvílí", běžná barva |
| 15 minut až 6 hodin | "aktualizováno před 3 hodinami", běžná barva |
| přes 6 hodin | "aktualizováno před 8 hodinami" **šedě s ikonou**, plus tlačítko "Přepočítat" |
| nikdy (`cached_at IS NULL`) | "ještě jsme nepočítali", plus tlačítko "Spočítat" |

**Varování z náhledu se zobrazují pod počtem**, ne místo něj. Kódy vrací část 2, český text vlastním já:

| Kód varování | Text v rozhraní |
|---|---|
| `segment_count_estimated` | "Číslo je odhad, přesný výpočet by trval příliš dlouho. [Spočítat přesně]" |
| `segment_unindexed_field` | "Podmínka na pole *Poznámka* se počítá pomalu, protože podle něj databáze nemá rejstřík. U velké databáze to může trvat déle." |
| `segment_slow_engagement` | "Podmínky na aktivitu v kampaních prohledávají historii všech odeslaných zpráv. U velké databáze počítejte s několika sekundami." |

**Prázdný výsledek s diagnostikou.** Nejcennější drobnost celé obrazovky:

```
┌─────────────────────────────────────────────────────────────┐
│  Do segmentu nepatří nikdo                                   │
│                                                               │
│  Nejvíc omezuje tahle podmínka:                              │
│                                                               │
│    Město je Brno                     → 0 kontaktů            │
│                                                               │
│  Ostatní podmínky samostatně:                                │
│    Poslední aktivita za posledních 90 dní → 3 412 kontaktů   │
│    Seznam Zákazníci má potvrzené přihlášení → 8 200 kontaktů │
│                                                               │
│  ℹ Pole "Město" má vyplněné jen 340 kontaktů z 12 480 a      │
│    žádný z nich nemá hodnotu "Brno". Nejčastější hodnoty:    │
│    Praha (120), brno (88), Ostrava (44)                       │
│                                                               │
│    Nechtěli jste "brno" s malým b? [Použít]                  │
│    Chcete zahrnout i kontakty bez vyplněného města? [Přidat] │
└─────────────────────────────────────────────────────────────┘
```

Nabídka opravy velikosti písmen a nabídka zahrnout prázdné hodnoty jsou konkrétní ukázka toho, jak nástroj pomáhá místo aby jen hlásil nulu. Diagnostika běží **jen při prázdném výsledku**, takže dodatečné dotazy nikoho nezpomalují.

#### 8.4.5 Pasti, na které se upozorňuje předem

| Past | Upozornění |
|---|---|
| Podmínka "Neotevřel žádnou kampaň" v projektu bez odeslaných kampaní | "Zatím jste neposlali žádnou kampaň, takže tuhle podmínku splňuje úplně každý kontakt." |
| Dvě podmínky na stejné pole s "všechny podmínky" | "Podmínky `Město je Brno` a `Město je Praha` nemůže splnit nikdo najednou. Nechtěli jste nahoře přepnout na *alespoň jednu podmínku*?" |
| Podmínka na pole, které je skoro vždy prázdné | "Pole `Poznámka` má vyplněných jen 12 kontaktů z 12 480." |
| Segment obsahuje odhlášené kontakty | Informace pod počtem: "Z 1 208 kontaktů je 43 odhlášených, těm se kampaň neodešle." |
| Kruhová závislost segmentů | "Segment A se odkazuje na segment B a ten zpátky na A. To nejde spočítat." Blokuje uložení. |
| Podmínka s negací nad polem, které bývá prázdné | Text `segments.notNullHint` plus tlačítko na doplnění, viz 8.4.2c |
| Segment bez jediné podmínky | Text z 6.4 části 2: "Segment zatím nemá žádnou podmínku, obsahuje tedy všechny kontakty ({count})." Není to chyba, ale uživatel to musí vědět, protože prázdný segment vypadá jako nedodělaný a přitom míří na celou databázi. |
| Segment obsahuje kontakty s omezeným zpracováním | "Z 1 208 kontaktů má 3 omezené zpracování podle GDPR, těm se kampaň neodešle." Bez toho uživatel nikdy nezjistí, proč se čísla nesejdou. |
| Podmínka "souhlas nikdy nedal" versus "souhlas odvolal" | Nápověda u obou: "*Nikdy nedal* jsou lidé, u kterých souhlas nemáme zaznamenaný. *Odvolal* jsou ti, kdo ho aktivně vzali zpět. Právně to nejsou totéž." |

#### 8.4.6 Segment v kontextu kampaně

Když se segment vybírá jako publikum kampaně, ukazuje se navíc **rozpad publika**, protože finální počet příjemců bývá jiný než počet v segmentu a to uživatele mate:

```
Publikum kampaně
  Segment Aktivní zákazníci z Brna              1 208
  − na blokovaných adresách                        12
  − odhlášení                                      43
  − nepotvrzené přihlášení k seznamu               17
  − pozastavená komunikace na vlastní žádost        4
  − omezené zpracování podle GDPR                   3
  − duplicitní e-maily                              0
  − ukázkové kontakty                               0
  ─────────────────────────────────────────────────────
  Kampaň se odešle                              1 129 lidem
```

Bez tohohle rozpadu vzniká otázka „proč mi to poslalo jen 1 129, když v segmentu je 1 208", na kterou nejde nikde najít odpověď.

**Pořadí řádků odpovídá pořadí bran ze 4.1.6 části 2**, ne abecedě: nejdřív blokované adresy (autoritativní vrstva), pak stav kontaktu, pak členství v seznamu. Je to jediné pořadí, ve kterém dává součet smysl, protože brány se vyhodnocují postupně a jeden kontakt může padnout na víc z nich.

**Každý odečtový řádek je odkaz** na seznam těch konkrétních lidí. Uživatel, který vidí „omezené zpracování podle GDPR 3", se musí umět podívat, o koho jde, jinak je to jen záhadné číslo.

---
### 8.5 Editor šablony a AI asistent

Část 3 vlastní blokový model, renderer a schémata AI nástrojů. Tato kapitola vlastní **interakci**: co uživatel vidí, jak se s tím pracuje a co se stane, když to selže.

#### 8.5.1 Rozložení editoru

```
┌────────────────────────────────────────────────────────────────────────┐
│ ← Letní výprodej          Uloženo v 14:32     [Náhled] [Poslat test]  │
├──────────────┬────────────────────────────────────┬────────────────────┤
│              │  ┌──────────────────────────────┐  │  Vybraný blok      │
│  BLOKY       │  │                              │  │  ─────────────     │
│              │  │        [ LOGO ]              │  │  Nadpis            │
│  ▭ Nadpis    │  │                              │  │                    │
│  ▤ Text      │  ├──────────────────────────────┤  │  Text              │
│  ▣ Obrázek   │  │                          ⋮⋮ │  │  [Letní výprodej ] │
│  ▭ Tlačítko  │  │  Letní výprodej začíná    ↑↓ │  │                    │
│  ─ Oddělovač │  │                          🗑 │  │  Velikost  [24 ▾] │
│  ⬚ Mezera    │  ├──────────────────────────────┤  │  Barva     [■   ] │
│  ▥ Dva sloupce│  │  Dobrý den, {Oslovení},     │  │  Zarovnání [≡  ▾] │
│  ▦ Tři sloupce│  │  máme pro vás…              │  │                    │
│              │  ├──────────────────────────────┤  │                    │
│  ─────────   │  │       [ Zobrazit nabídku ]   │  │                    │
│  ✨ AI       │  ├──────────────────────────────┤  │                    │
│              │  │  Odhlásit se | Zobrazit v    │  │                    │
│              │  │  prohlížeči                  │  │                    │
│              │  └──────────────────────────────┘  │                    │
└──────────────┴────────────────────────────────────┴────────────────────┘
```

| Prvek | Chování |
|---|---|
| **Stav uložení v hlavičce** | "Uloženo v 14:32" / "Ukládáme…" / "Nepodařilo se uložit, zkoušíme to znovu". Nikdy toast, protože ukládání je nepřetržité a toast by se objevoval každé dvě sekundy. |
| **Ovládání bloku při najetí** | ⋮⋮ táhnout, ↑↓ posunout, 🗑 smazat, plus nabídka "…" s duplikováním a uložením jako znovupoužitelný blok |
| **Klávesová obsluha** | Blok se dá vybrat `Tab`em, posunout `Alt + ↑/↓`, duplikovat `Ctrl+D`, smazat `Delete` s možností vrátit. Toto je **povinnost daná normou**, ne doplněk: WCAG 2.2, kritérium 2.5.7 Dragging Movements (úroveň AA) vyžaduje alternativu bez tažení u každé akce, která jde provést tažením. EmailBuilder.js ji podle všeho nemá, takže ji musí dodat adaptér části 3. Viz U→3.1 a 11.3. |
| **Panel vlastností vpravo** | Mění se podle vybraného bloku. Když není vybraný žádný, ukazuje vlastnosti celého e-mailu (šířka, barva pozadí, písmo). |
| **Vkládání údajů o příjemci** | Tlačítko "Vložit údaj o příjemci" v panelu textu, ne psaní `{{ }}` ručně. Vložený údaj se v editoru zobrazí jako **žeton** `{Oslovení}`, ne jako Liquid kód. |

**Žeton místo kódu** je zásadní rozhodnutí. `{{ contact.first_name_vocative }}` je pro netechnického člověka nečitelný řetězec, který navíc svádí k ručním úpravám a rozbití. Žeton se dá vybrat, smazat a přesunout jako jeden znak a při najetí ukáže "5. pád jména, například Jano. Když jméno neznáme, vynechá se."

#### 8.5.2 Náhled

Tři režimy v jednom panelu:

| Režim | Co ukazuje |
|---|---|
| Počítač | Šířka 700 px |
| Mobil | Šířka 375 px |
| Prostý text | Textová verze, kterou dostanou klienti bez HTML. **Vidět ji musí být možné**, protože je součástí každé odeslané zprávy a nikdo ji nikdy nekontroluje. |
| Tmavý režim | Přepínač napříč všemi třemi |

**Náhled s konkrétním kontaktem.** Nad náhledem je pole "Zobrazit jako: [Jana Nováková ▾]" s vyhledáváním. Náhled dosadí skutečná data:

```
Zobrazit jako:  [🔍 Jana Nováková              ▾]
                [ Náhodný kontakt ] [ Kontakt bez jména ]
```

Dvě tlačítka vedle jsou důležitější, než vypadají:

- **Náhodný kontakt** ukáže, jak vypadá e-mail pro někoho jiného než pro toho jednoho, na kterém uživatel ladil.
- **Kontakt bez jména** ukáže **fallback**. Tohle je nejčastější a nejtrapnější chyba mailingu: "Dobrý den, ," nebo "Dobrý den, {{first_name}},". Nástroj musí uživatele donutit se na to podívat, a proto je tohle tlačítko vidět, ne schované.

Kontrolní seznam kampaně obsahuje položku "Zkontrolovali jste, jak e-mail vypadá pro kontakt bez jména?" jako varování, dokud uživatel na tlačítko aspoň jednou neklikne.

#### 8.5.3 AI asistent

Panel, ne modální okno. Uživatel musí vidět, co se v e-mailu mění.

```
┌──── ✨ AI asistent ────────────────────────┐
│                                              │
│  Co má e-mail obsahovat?                     │
│  ┌────────────────────────────────────────┐  │
│  │ Pozvánka na letní výprodej kol,        │  │
│  │ sleva 20 %, platí do konce srpna       │  │
│  └────────────────────────────────────────┘  │
│                                              │
│  Tón     [ Přátelský        ▾ ]              │
│  Jazyk   [ Čeština          ▾ ]              │
│  Délka   [ Střední          ▾ ]              │
│                                              │
│  Značka: Kolo Shop (barvy a logo z webu)     │
│  [ Změnit ]                                  │
│                                              │
│           [ Vytvořit návrh ]                 │
│                                              │
│  ────────────────────────────────────────    │
│  Za posledních 30 dní jste na AI utratili    │
│  asi 84 Kč. [Podrobnosti]                    │
└──────────────────────────────────────────────┘
```

**Průběh generování (třída A3, 10 až 60 s):**

```
┌──── ✨ AI asistent ────────────────────────┐
│                                              │
│  Píšeme návrh…                               │
│                                              │
│  ✓ Rozumíme zadání                           │
│  ✓ Máme barvy a logo                         │
│  ● Skládáme e-mail                           │
│  ○ Kontrolujeme, že se dá odeslat            │
│                                              │
│  Obvykle to trvá 20 až 40 sekund.            │
│                                              │
│              [ Zrušit ]                      │
└──────────────────────────────────────────────┘
```

Krokový průběh místo neurčitého spinneru. U operace, která trvá půl minuty, je spinner nesnesitelný, protože nedává žádnou informaci o tom, jestli se něco děje. Čtyři kroky s odškrtáváním dávají pocit postupu a zároveň neslibují procenta, která neumíme spočítat.

**Po vygenerování: náhled s možností odmítnout.**

```
│  Hotovo. Návrh je vlevo v editoru.           │
│                                              │
│  [ Nechat si ho ]   [ Zkusit jinak ]         │
│                                              │
│  ℹ Váš původní obsah jsme uložili. Když se  │
│    vám návrh nelíbí, vrátíme ho zpátky.      │
```

Vygenerovaný obsah **nikdy nepřepíše rozdělanou práci nevratně**. Předchozí verze se uloží jako pojmenovaná verze "Před AI návrhem" a jde se na ni vrátit ještě týden.

**Dílčí použití AI.** Kromě celé šablony musí jít použít AI na jednotlivostech, protože to je ve skutečnosti nejčastější použití:

| Kde | Akce |
|---|---|
| Textový blok, nabídka při výběru textu | "Zkrátit", "Prodloužit", "Změnit tón", "Opravit překlepy", "Přeložit do angličtiny" |
| Pole předmětu | "Navrhnout 5 variant" s ukázkou, jak se předmět zobrazí v Gmailu a na mobilu |
| Preheader | "Doplnit podle předmětu" |
| Obrázek bez alt textu | "Popsat obrázek" |

Poslední řádek je zajímavý: AI, která doplní alternativní popis obrázku, zvedne přístupnost odeslaných e-mailů víc než jakákoliv edukace uživatelů. Návrh se vždycky ukáže k odsouhlasení, nikdy se nevloží sám.

**Chyby AI:**

| Situace | Hláška |
|---|---|
| Není klíč | "Abyste mohli používat AI asistenta, potřebujete vlastní klíč od OpenAI, Anthropicu, Googlu nebo OpenRouteru. Platíte přímo jim, obvykle jednotky korun za jeden e-mail. [Jak klíč získat] [Nastavit klíč]" |
| Neplatný klíč | "Klíč k OpenAI odmítli jako neplatný. Zkontrolujte, jestli je zkopírovaný celý a jestli u něj nevypršela platnost. [Nastavení]" |
| Došel kredit | "Na vašem účtu u OpenAI došel kredit. Doplňte ho v jejich konzoli, nebo přepněte na jiného poskytovatele. [Nastavení]" |
| Rate limit | "Poskytovatel nás požádal, abychom chvíli počkali. Zkusíme to za 20 sekund automaticky." plus odpočet. Toto je **jediná** automatická opakovaná akce v produktu, protože nemá vedlejší efekt. |
| Odpověď neodpovídá schématu | "Model vrátil něco, čemu jsme nerozuměli. Zkusíme to ještě jednou." Po druhém selhání: "Nepodařilo se to dvakrát po sobě. Zkuste zadání zjednodušit, nebo použijte jiný model. [Nastavení]" |
| Timeout | "Model neodpověděl do 90 sekund. Někdy pomůže kratší zadání. [Zkusit znovu]" |
| Výpadek providera | "Služba OpenAI má výpadek. [Stav jejich služby] Můžete zatím přepnout na jiného poskytovatele." |

Všechny hlášky pojmenovávají providera jménem. "Chyba AI" by uživatele nechala hledat problém u nás, přitom problém je u něj na účtu u někoho jiného.

#### 8.5.4 Extrakce značky

```
┌──── Značka projektu ─────────────────────────────────────┐
│                                                            │
│  Stáhneme barvy a logo z vašeho webu                       │
│  [ https://kolo-shop.cz                    ] [ Stáhnout ] │
│                                                            │
│  ─────────────────────────────────────────────────────    │
│  ✓ Hotovo. Zkontrolujte, jestli to sedí.                  │
│                                                            │
│  Logo      [ obrázek ]   [ Nahradit ] [ Odebrat ]         │
│  Hlavní barva    ■ #C41E3A   [ Změnit ]                   │
│  Doplňková barva ■ #1A1A1A   [ Změnit ]                   │
│  Barva tlačítek  ■ #C41E3A   [ Změnit ]                   │
│  Písmo     Nadpisy: Arial, Text: Arial                     │
│            ℹ V e-mailech používáme jen písma, která má     │
│              každý v počítači. Vaše firemní písmo se       │
│              v e-mailu spolehlivě nezobrazí.               │
│                                                            │
│  [ Použít na všechny šablony ]                            │
└────────────────────────────────────────────────────────────┘
```

Poznámka o písmech je tam proto, že uživatel s brand manuálem bude čekat své firemní písmo a bez vysvětlení to bude vnímat jako chybu nástroje.

| Chyba | Hláška |
|---|---|
| Web neodpovídá | "Na adresu `https://kolo-shop.cz` jsme se nedostali. Zkontrolujte, jestli tam není překlep, a jestli web funguje." |
| Vnitřní adresa (ochrana SSRF) | "Tuhle adresu stahovat neumíme. Zadejte veřejnou adresu vašeho webu, například `https://kolo-shop.cz`." Nikdy nevysvětlujeme, že jde o ochranu proti přístupu do vnitřní sítě, protože to je informace pro útočníka. |
| Nenašli jsme logo | "Logo jsme na webu nenašli. Nahrajte ho prosím ručně. [Nahrát logo]" plus barvy, které se najít podařilo. |
| Web zakazuje stahování | "Web `kolo-shop.cz` má nastavené, že si ho automaty nemají stahovat. Barvy a logo prosím nastavte ručně." |
| Trvá dlouho | Po 10 s: "Web je pomalý, ještě chvíli počkáme." Po 30 s: chyba s možností zkusit znovu. |

---

### 8.6 Odeslání kampaně

#### 8.6.1 Struktura obrazovky kampaně

Čtyři záložky nad jedním obsahem, ne pětikrokový průvodce:

```
┌────────────────────────────────────────────────────────────────────┐
│  ← Kampaně   Letní výprodej    KONCEPT      [Náhled] [Odeslat…]   │
│  ┌──────────┬────────┬──────────┬────────┐                        │
│  │ Příprava │ Obsah  │ Publikum │ Report │                        │
│  └──────────┴────────┴──────────┴────────┘                        │
```

**Proč záložky a ne průvodce:**

| | Vícekrokový průvodce [neověřeno: předpokládaný vzor u Ecomailu a Mailchimpu] | Kontrolní seznam se záložkami (náš návrh) |
|---|---|---|
| První kampaň | vede za ruku, těžko se ztratíte | vyžaduje jednu orientaci navíc |
| Druhá a další kampaň | musíte projít kroky, které měnit nechcete | jdete rovnou tam, kde měníte |
| Změna po chybě | zpátky přes kroky | jedno kliknutí |
| Přehled o celku | nemáte, vidíte vždy jeden krok | máte, kontrolní seznam ukazuje všechno |
| Ukládání | typicky až na konci kroku | průběžné |

Kompromis: **kontrolní seznam na záložce Příprava plní roli průvodce.** Ukazuje, co chybí, v pořadí, v jakém to má smysl dělat, a odkazuje rovnou na místo. Nový uživatel tak dostane vedení, zkušený nedostane překážku.

#### 8.6.2 Kontrolní seznam připravenosti

```
┌────────────────────────────────────────────────────────────────────┐
│  Připravenost k odeslání                                            │
│                                                                      │
│  ✓  Předmět              Letní výprodej začíná, slevy až 20 %       │
│  ✓  Odesílatel           Jana z Kolo Shopu <jana@kolo-shop.cz>      │
│  ✓  Obsah                6 bloků, poslední úprava před 4 minutami   │
│  ✓  Publikum             1 153 příjemců                              │
│  ✓  Odesílací doména     kolo-shop.cz ověřená                        │
│  ✓  Odhlašovací odkaz    v patičce                                   │
│  ✓  Doplňované údaje     3 použité, všechny existují                 │
│                                                                      │
│  ⚠  Testovací e-mail     Zatím jste si e-mail neposlali             │
│                          [ Poslat test na jana@firma.cz ]           │
│  ⚠  Kontakt bez jména    Nezkontrolovali jste, jak e-mail vypadá,   │
│                          když jméno neznáme  [ Podívat se ]         │
│  ⚠  Prostý text          Textová verze je krátká (18 slov)          │
│                          [ Zobrazit ]                                │
│                                                                      │
│  ℹ  Odhad doby           Rozesílka potrvá asi 4 minuty              │
│  ℹ  Vyloučeno            55 kontaktů (43 odhlášených, 12 blokovaných)│
│                                                                      │
│                                          [ Odeslat 1 153 e-mailů ]  │
└────────────────────────────────────────────────────────────────────┘
```

**Tři úrovně položek:**

| Úroveň | Význam | Chování tlačítka Odeslat |
|---|---|---|
| ✕ **Blokující** (červená) | Odeslat nejde | Tlačítko zůstává aktivní, kliknutí přesune fokus na první blokující položku a ohlásí ji čtečce |
| ⚠ **Varování** (žlutá) | Odeslat jde, ale nejspíš to nechcete | Objeví se v potvrzovacím dialogu jako samostatná sekce |
| ℹ **Informace** (šedá) | Jen k vědomí | Neobjeví se v dialogu |

**Úplný katalog položek:**

| Položka | Úroveň | Podmínka |
|---|---|---|
| Předmět | blokující | prázdný |
| Předmět | varování | delší než 60 znaků (na mobilu se ořízne) nebo obsahuje neplatný doplňovaný údaj |
| Odesílatel | blokující | prázdný, nebo doména neověřená a nejsme ve zkušebním režimu |
| Odesílatel | varování | veřejná doména (gmail.com a spol.) |
| Obsah | blokující | prázdný, nebo se nepodařila kompilace šablony |
| Publikum | blokující | 0 příjemců |
| Publikum | varování | víc příjemců než denní kvóta provideru |
| Odhlašovací odkaz | blokující | šablona neobsahuje `unsubscribe_url` |
| Doplňované údaje | blokující | odkaz na pole, které v projektu neexistuje |
| Testovací e-mail | varování | žádný test od poslední změny obsahu |
| Kontakt bez jména | varování | uživatel se nepodíval na náhled s prázdným jménem |
| Prostý text | varování | textová verze kratší než 30 slov nebo prázdná |
| Obrázky bez popisu | varování | aspoň jeden obrázek bez alternativního textu |
| Míra stížností | **blokující** | přes 0,3 % za posledních 30 dní |
| Míra stížností | varování | mezi 0,1 % a 0,3 % |
| Míra nedoručení | varování | přes 5 % za posledních 30 dní |
| Zkušební režim | varování | zapnutý, s uvedením, kolika lidem to reálně odejde |
| Ukázková data v publiku | varování | publikum obsahuje ukázkové kontakty |

**Míra stížností jako blokující položka je zásadní produktové rozhodnutí.** Amazon při překročení prahu účet zablokuje a to je pro uživatele mnohem větší škoda než nemožnost odeslat jednu kampaň. Blokace se dá obejít v nastavení, ale vyžaduje vědomé rozhodnutí a přečtení vysvětlení:

```
┌──────────────────────────────────────────────────────────────┐
│  ✕ Odesílání je zastavené kvůli stížnostem na spam            │
│                                                                │
│  Z posledních 5 000 e-mailů si 17 lidí stěžovalo, že je to    │
│  spam. To je 0,34 %.                                           │
│                                                                │
│  Amazon toleruje 0,1 %. Když práh dlouhodobě překračujete,    │
│  zablokuje vám celý účet a přijdete o možnost odesílat        │
│  odkudkoliv, ne jen z tohohle nástroje.                        │
│                                                                │
│  Co s tím:                                                     │
│  1. Posílejte jen lidem, kteří byli aktivní za poslední rok.  │
│     [ Vytvořit segment "Aktivní za 365 dní" ]                 │
│  2. Zkontrolujte, odkud kontakty pocházejí. Nakoupené         │
│     databáze jsou nejčastější příčina.                         │
│  3. Dejte odhlašovací odkaz nahoru, ne jen do patičky.        │
│     Lidé, kteří ho nenajdou, klikají na "spam".               │
│                                                                │
│  [ Zobrazit, kdo si stěžoval ]     ▸ Přesto odeslat           │
└──────────────────────────────────────────────────────────────┘
```

Tři konkrétní kroky, ne odkaz na dokumentaci. První z nich je proveditelný jedním kliknutím rovnou odsud.

#### 8.6.3 Potvrzovací dialog

```
┌──────────────────────────────────────────────────────────────┐
│  Odeslat kampaň Letní výprodej?                               │
│                                                                │
│  Komu        1 153 příjemcům                                   │
│              segment Aktivní zákazníci z Brna                  │
│  Od          Jana z Kolo Shopu <jana@kolo-shop.cz>             │
│  Předmět     Letní výprodej začíná, slevy až 20 %              │
│  Odhlášení   odkaz v patičce                                   │
│  Odhad       rozesílka potrvá asi 4 minuty                     │
│                                                                │
│  ⚠ Na co bychom rádi upozornili                                │
│    • Zatím jste si e-mail neposlali na zkoušku                 │
│    • Jeden obrázek nemá popis pro nevidomé                     │
│                                                                │
│  Po odeslání budete mít 60 sekund na zrušení.                  │
│  Potom už e-maily zpátky vzít nejde.                           │
│                                                                │
│         [ Zpět k úpravám ]      [ Odeslat 1 153 e-mailů ]      │
└──────────────────────────────────────────────────────────────┘
```

| Rozhodnutí | Odůvodnění |
|---|---|
| **Souhrn místo checkboxu** | Uživatel má přečíst pět řádků, které mu ukážou skutečný stav. Checkbox "rozumím" nic neověřuje. |
| **Varování v dialogu, ne jen v seznamu** | Poslední místo, kde se dají zachytit. Uživatel je mohl na obrazovce přehlédnout. |
| **Věta o nevratnosti doslova** | Nikdy jen červené tlačítko. |
| **Číslo na tlačítku** | Poslední pojistka proti špatnému publiku. |
| **Fokus po otevření je na "Zpět k úpravám"** | Bezpečnější výchozí volba. `Enter` bez čtení nic neodešle. |
| **Žádné opisování názvu** | Týdenní akce, návyk by ochranu zrušil. |

#### 8.6.4 Okno na zrušení a průběh

Po potvrzení nastupuje celostránkový stav popsaný v 6.3, po jeho vypršení průběh rozesílky:

```
┌────────────────────────────────────────────────────────────────────┐
│  Letní výprodej                                      ● ODESÍLÁME    │
│                                                                      │
│  ██████████████░░░░░░░░░░░░░░░░░░░░░░░░  428 z 1 153        (37 %)  │
│                                                                      │
│  Rychlost        14 e-mailů za sekundu                              │
│  Zbývá           asi 1 minuta                                        │
│  Začalo          v 14:38                                             │
│                                                                      │
│  ┌────────────┬────────────┬────────────┬────────────┐              │
│  │ Odesláno   │ Doručeno   │ Nedoručeno │ Chyby      │              │
│  │    428     │    421     │      6     │     1      │              │
│  └────────────┴────────────┴────────────┴────────────┘              │
│                                                                      │
│  Rozesílka běží na serveru. Okno můžete zavřít, dáme vám vědět      │
│  e-mailem, až bude hotovo.                                           │
│                                                                      │
│              [ Pozastavit ]           [ Zrušit zbytek rozesílky ]   │
└────────────────────────────────────────────────────────────────────┘
```

**Chování při problémech během rozesílky:**

| Situace | Co uživatel vidí |
|---|---|
| Provider zpomalil (rate limit) | Stav se změní na "● ZPOMALUJEME" a pod ním "Amazon nás požádal, abychom posílali pomaleji. Rozesílka pokračuje, jen potrvá déle. Nový odhad: asi 12 minut." Kampaň se nezastavuje. |
| Provider odmítá vše | "⏸ POZASTAVENO AUTOMATICKY. Amazon odmítá naše e-maily: `Sending paused for this account`. Rozesílka se zastavila po 428 e-mailech. [Co s tím]" plus e-mail uživateli. Kampaň je ve stavu `paused`, ne `cancelled`, takže se dá po nápravě pokračovat. |
| Vysoká míra nedoručení během rozesílky | Po 200 zprávách s mírou nedoručení nad 10 %: **automatické pozastavení** a hláška "Rozesílku jsme pozastavili. Z prvních 200 e-mailů se 34 nedoručilo, to je nezvykle hodně a může to znamenat problém se seznamem. [Zobrazit nedoručené] [Pokračovat i tak] [Zrušit zbytek]" |
| Sender spadl a restartoval se | Uživatel nevidí nic, průběh krátce stojí a pokračuje. Kdyby stál déle než 60 s: "Rozesílka na chvíli stojí, řešíme to. Nic se neztratí." |
| Ztráta spojení v prohlížeči | Čísla ztmavnou, nad nimi "Ztratili jsme spojení. Rozesílka běží dál na serveru." |

Automatické pozastavení při vysoké míře nedoručení ochrání uživatele před tím, aby rozeslal 50 000 e-mailů na starou databázi a přišel o účet u Amazonu. [neověřeno: nakolik to konkurence má. Na správnosti rozhodnutí to nic nemění.]

**Dokončení:**

```
┌────────────────────────────────────────────────────────────────────┐
│  ✓ Kampaň Letní výprodej je odeslaná                                │
│                                                                      │
│  1 153 e-mailů odesláno za 4 minuty a 12 sekund.                    │
│  Doručeno 1 141, nedoručeno 12.                                      │
│                                                                      │
│  Otevření a kliknutí začnou přicházet během několika minut.         │
│                                                                      │
│                             [ Zobrazit report ]                     │
└────────────────────────────────────────────────────────────────────┘
```

Plus e-mail uživateli se stejnými čísly a odkazem. Plus u první odeslané kampaně v projektu jednorázová gratulace, protože to je jediné místo v produktu, kde je nadšení na místě.

---

### 8.7 Report kampaně

Obrazovka, která musí podat čísla, o kterých víme, že jsou z principu nepřesná, aniž bychom uživatele oklamali nebo zahltili.

#### 8.7.1 Problém

Apple Mail Privacy Protection (od roku 2021) předem stahuje obrázky v e-mailech, včetně sledovacího pixelu, bez ohledu na to, jestli si e-mail někdo přečetl. Podobně se chová Gmail s ukládáním obrázků do své mezipaměti a řada firemních bezpečnostních bran, které odkazy a obrázky testují.

Důsledky, se kterými se musí návrh vyrovnat:

1. Míra otevření je nadhodnocená a **neumíme přesně říct o kolik**.
2. Odhlédnutí od otevření vůči času je nesmyslné, protože předstahování proběhne hned po doručení.
3. Automatické kliknutí od bezpečnostních bran zkresluje i kliknutí, i když výrazně méně.
4. Porovnávání kampaní v čase je zkreslené, pokud se mění podíl příjemců s Apple Mailem.

#### 8.7.2 Návrh: tři patra

```
┌──────────────────────────────────────────────────────────────────────┐
│  ← Kampaně   Letní výprodej                              ODESLÁNO     │
│  odesláno 31. 7. 2026 v 14:38 · 1 153 příjemcům · Jana Nováková      │
│                                                                        │
│  ┌────────────────┬────────────────┬────────────────┐                 │
│  │  DORUČENO      │  KLIKLO        │  ODHLÁSILO SE  │                 │
│  │  1 141         │  187           │  4             │                 │
│  │  99,0 %        │  16,4 %        │  0,35 %        │                 │
│  │  z odeslaných  │  z doručených  │  z doručených  │                 │
│  └────────────────┴────────────────┴────────────────┘                 │
│                                                                        │
│  ── Otevření ──────────────────────────────────────────────────────   │
│  832 kontaktů (72,9 %)                                    ⓘ Vysvětlit │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │ ████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░         │   │
│  │ 187 potvrzeno kliknutím  ·  411 pravděpodobně automatické      │   │
│  │ ·  234 nejisté                                                  │   │
│  └────────────────────────────────────────────────────────────────┘   │
│  ⚠ Část otevření vyrábějí poštovní programy samy, bez toho aby        │
│    e-mail někdo četl. Spolehlivé číslo je kliknutí.                   │
│                                                                        │
│  ── Problémy ──────────────────────────────────────────────────────   │
│  Nedoručeno    12   (1,0 %)   ✓ v normě        [Zobrazit komu]        │
│  Spam          1    (0,09 %)  ✓ v normě        [Zobrazit komu]        │
│  Chyby         0                                                       │
│                                                                        │
│  ── Na co lidé klikali ────────────────────────────────────────────   │
│  Zobrazit nabídku          142 kliknutí   112 lidí   [Zobrazit koho]  │
│  Kola do 20 000 Kč          48 kliknutí    41 lidí   [Zobrazit koho]  │
│  Odhlásit se                 4 kliknutí     4 lidé                     │
│                                                                        │
│  ── V čase ────────────────────────────────────────────────────────   │
│  [graf kliknutí po hodinách za prvních 48 h]                          │
│                                                                        │
│  [ Stáhnout report ]  [ Poslat znovu neotevřevším ]  [ Duplikovat ]   │
└──────────────────────────────────────────────────────────────────────┘
```

| Rozhodnutí | Odůvodnění |
|---|---|
| **Doručeno, kliklo, odhlásilo se jako tři hlavní dlaždice** | Všechna tři čísla jsou obhajitelná. Kliknutí je jediná spolehlivá míra zájmu. |
| **Otevření o patro níž, ale výrazně** | Skrýt je nemůžeme, uživatel je zná a hledal by je. Ale nesmí být hlavní. |
| **Rozpad otevření na tři skupiny** | Nejpoctivější, co umíme. Nepředstíráme, že známe přesné číslo, ale dáváme uživateli spodní a horní mez. |
| **Trvalá poznámka pod otevřením** | Ne v nápovědě, kam se nikdo nepodívá. Přímo pod číslem, vždycky. |
| **Jmenovatel u každého procenta** | "16,4 % z doručených", ne jen "16,4 %". Různé nástroje počítají z různých jmenovatelů a bez uvedení se čísla nedají porovnat. |
| **"✓ v normě" u nedoručení a spamu** | Uživatel neví, jestli je 1 % moc. Nástroj to ví a řekne to. Při překročení se změní na "⚠ vysoké" s vysvětlením a kroky. |
| **Kliknutí na odkazy s počtem lidí i kliknutí** | 142 kliknutí od 112 lidí je jiná informace než 142 kliknutí od 5 lidí. |

#### 8.7.3 Klasifikace otevření

| Skupina | Definice | Jistota |
|---|---|---|
| **Potvrzeno kliknutím** | Kontakt v kampani klikl na odkaz. Klik od člověka je téměř jistý. | Spodní mez skutečných otevření |
| **Pravděpodobně automatické** | Otevření přišlo z rozsahu IP adres nebo s user agentem, který odpovídá známým předstahovacím službám (Apple MPP, Gmail Image Proxy), nebo přišlo do 10 sekund od doručení | Vysoká, ale ne stoprocentní |
| **Nejisté** | Zbytek | Někde mezi |

Detekci vlastní část 5. Tato kapitola vlastní jen **jak se to podá**, a podává se to tak, že uživatel dostane rozsah, ne falešnou přesnost.

**Vysvětlení pod ⓘ:**

> **Proč jsou otevření nepřesná**
>
> Když někdo otevře váš e-mail, pozná se to podle toho, že si jeho poštovní program stáhne malý neviditelný obrázek. Fungovalo to dobře do roku 2021.
>
> Od té doby si Apple Mail a některé další programy stahují obrázky **předem, samy od sebe**, ještě než si e-mail někdo přečte. Nástroj to nemá jak odlišit a započítá to jako otevření. Týká se to zhruba poloviny všech schránek.
>
> **Co to znamená pro vás:**
>
> - Míra otevření je nadhodnocená a nejde říct přesně o kolik.
> - Nemá smysl podle ní posuzovat, kdy lidé e-maily čtou.
> - Porovnávat míru otevření mezi kampaněmi jde jen orientačně.
>
> **Co dělat místo toho:** dívejte se na kliknutí. Kliknout musí člověk. Když chcete vědět, jestli byl e-mail zajímavý, míra prokliku vám to řekne poctivě.
>
> Otevření se pořád hodí na jednu věc: kontakt, který za rok neotevřel ani jeden e-mail, je téměř jistě neaktivní. K tomu je to spolehlivé i s tím zkreslením.

Poslední odstavec je důležitý, aby uživatel nezavrhl otevření úplně. Na čištění databáze se používat dá, na měření úspěchu ne.

#### 8.7.4 Stavy reportu

| Stav | Zobrazení |
|---|---|
| Kampaň se odesílá | Report je dostupný a živý, dlaždice se aktualizují každých 5 s, nahoře pruh "Kampaň se ještě odesílá, 428 z 1 153" |
| Do 15 minut po odeslání | Pruh "Čísla se ještě dopočítávají. Většina otevření a kliknutí dorazí během první hodiny." |
| Do 72 hodin | Bez pruhu, ale u exportu poznámka "Čísla se ještě mohou mírně změnit" |
| Po 72 hodinách | Report je považovaný za konečný |
| Tracking vypnutý | Dlaždice otevření a kliknutí se **nezobrazí vůbec** a místo nich je blok "Sledování otevření a kliknutí bylo pro tuhle kampaň vypnuté, proto tu čísla nejsou." Nikdy neukazujeme nuly, které vypadají jako neúspěch. |
| Tracking kliknutí zapnutý, otevření vypnuté | Otevření se nezobrazí, kliknutí ano, s poznámkou |
| Kampaň zastavená | "Rozesílka byla zastavena po 428 z 1 153 e-mailů. Procenta níž se počítají z odeslaných, ne z původního publika." |
| Kampaň ve zkušebním režimu | Trvalý pruh, viz 8.2.8 |
| Report starší kampaně po smazání kontaktů | "Část kontaktů z téhle kampaně byla smazána. Souhrnná čísla platí, ale u jednotlivých lidí se nedostanete dál." |

#### 8.7.5 Návazné akce

Report není konec cesty, je to místo, odkud se pokračuje. Akce dole na stránce:

| Akce | Co dělá |
|---|---|
| **Poslat znovu neotevřevším** | Vytvoří kopii kampaně s publikem "ti, kterým se doručilo a neotevřeli". Nabídne změnu předmětu. **Varování**: "Otevření jsou nepřesná, takže mezi příjemci budou i lidé, kteří e-mail četli. Zvažte jinou formulaci než 'nestihli jste'." |
| **Duplikovat kampaň** | Kopie obsahu i publika jako nový koncept |
| **Stáhnout report** | CSV s čísly plus PDF se stejným rozvržením jako na obrazovce, včetně poznámky o otevřeních. PDF se posílá klientovi a poznámka tam musí být taky. |
| **Vytvořit segment z těch, kdo klikli** | Jedním kliknutím, protože je to nejčastější následující krok |
| **Zobrazit, komu se nedoručilo** | Tabulka s důvody v lidské řeči, viz 10.2 |

---

### 8.8 Přehled kontaktu a jeho časová osa

Obrazovka, která má odpovědět na otázku "kdo to je a co s námi dělal", a v pozdějších fázích na "proč se mu spustila tahle automatizace".

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← Kontakty                                                          │
│  ┌───────────────────────────────┬─────────────────────────────────┐│
│  │ Jana Nováková                 │  Časová osa                     ││
│  │ jana@firma.cz                 │  [Vše ▾] [Posledních 30 dní ▾]  ││
│  │ ● Aktivní                     │                                  ││
│  │ ⏸ Pozastaveno do 30. 9.       │                                  ││
│  │                               │  ── dnes ──                      ││
│  │ Oslovujeme  Jano  🔒 [Změnit] │  14:42  🖱 Klikla na Zobrazit    ││
│  │ Rod         žena              │         nabídku v kampani        ││
│  │                               │         Letní výprodej           ││
│  │ ── Zařazení ──                │                                  ││
│  │ Seznamy   Zákazníci           │  14:41  ✉ Otevřela kampaň        ││
│  │           Newsletter          │         Letní výprodej           ││
│  │ Štítky    Brno, VIP           │         ⓘ mohlo být automatické ││
│  │ Segmenty  Aktivní zákazníci   │                                  ││
│  │           z Brna              │  14:38  📨 Dostala kampaň        ││
│  │                               │         Letní výprodej           ││
│  │ ── Údaje ──                   │                                  ││
│  │ Město     Brno                │  ── včera ──                     ││
│  │ Telefon   +420 777 123 456    │  18:20  🌐 6 zobrazení stránky   ││
│  │ Firma     Kolo Servis s.r.o.  │         během 4 minut  [Rozbalit]││
│  │                               │                                  ││
│  │ ── Odkud přišla ──            │  18:14  🛒 Přidala do košíku     ││
│  │ Zdroj     Import 12. 6. 2026  │         Kolo Author Traction     ││
│  │ Přihlášena 12. 6. 2026        │         2 kusy, 24 980 Kč        ││
│  │ Souhlas   formulář na webu,   │                                  ││
│  │           12. 6. 2026 14:20   │  ── 12. 6. 2026 ──               ││
│  │           [Historie souhlasů] │  14:20  ✅ Přihlásila se přes     ││
│  │                               │         formulář Newsletter      ││
│  │ ── Čísla ──                   │         a potvrdila e-mailem     ││
│  │ Dostala   12 kampaní          │                                  ││
│  │ Otevřela  9                   │             [ Načíst starší ]    ││
│  │ Klikla    4                   │                                  ││
│  │ Naposledy aktivní před 3 dny  │                                  ││
│  │                               │                                  ││
│  │ [Poslat jednorázový e-mail]   │                                  ││
│  │ [Odhlásit] [Smazat] [Exportovat]                                 ││
│  └───────────────────────────────┴─────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────┘
```

| Rozhodnutí | Odůvodnění |
|---|---|
| **Věty, ne názvy událostí** | "Klikla na Zobrazit nabídku v kampani Letní výprodej", ne "click_event: campaign_id=42, link_id=7". Časová osa je pro marketérku, ne pro vývojáře. |
| **Rod ve větách podle údaje kontaktu** | "Klikla" u ženy, "Klikl" u muže, "Kliknutí na…" u neznámého rodu. Máme rod uložený kvůli vokativu, takže to nic nestojí a je to znát. |
| **Poznámka u otevření** | Stejná poctivost jako v reportu. Otevření, které vypadá automaticky, je označené. |
| **Shlukování sérií událostí** | Šest zobrazení stránky během čtyř minut je jeden řádek s možností rozbalit. Bez toho časovou osu zaplaví web tracking a e-mailové události v ní zmizí. |
| **Zámek u oslovení** | Ikona 🔒 znamená, že hodnotu potvrdil člověk a nástroj ji nepřepíše. Při najetí se to vysvětlí. |
| **Historie souhlasů jako samostatný panel** | Kdy, odkud, jaká IP adresa, jaké znění. Je to doklad pro případ sporu a musí být dohledatelný. Pět účelů se třemi stavy, viz 8.10.3. |
| **Stav kontaktu se nikdy nezobrazuje jen barvou** | Šest hodnot `contacts.status` plus tři samostatné příznaky, viz slovníček v 9.2. Odznak nese barvu i slovo. |
| **Načítání po dávkách, nejnovější první** | Kontakt se stovkami tisíc událostí nesmí obrazovku zabít. |

#### 8.8.1 Stavy kontaktu na obrazovce

Můj původní návrh znal jediný stav, „Aktivní". Model části 2 (4.1.6) jich má šest a k tomu tři nezávislé příznaky, které mění chování. **Každý z nich mění, co uživatel na obrazovce vidí a co může udělat**, takže je to devět různých podob detailu, ne jedna.

| Stav nebo příznak | Odznak | Doplňující věta pod hlavičkou | Co zmizí nebo přibude |
|---|---|---|---|
| `active` | ● Aktivní (zelená) | žádná | plná obrazovka |
| `unconfirmed` | ● Nepotvrzený (žlutá) | „Přihlásil se 12. 6., ale nepotvrdil odkaz v e-mailu. Proto mu kampaně neposíláme." | tlačítko „Poslat potvrzovací e-mail znovu" |
| `unsubscribed` | ● Odhlášený (šedá) | „Odhlásil se 3. 7. ze stránky s nastavením odběru." | tlačítko „Odhlásit" zmizí, přibude „Přihlásit zpět" s poznámkou, že to vyžaduje jeho vlastní potvrzení |
| `bounced` | ● Nedoručitelný (červená) | „Adresa neexistuje. E-maily se od 2. 7. vracely jako trvale nedoručitelné." | odkaz na blokované adresy |
| `complained` | ● Nahlásil spam (červená) | „Označil naši poštu jako spam 12. 6. Tenhle stav nejde zrušit a adresa zůstane blokovaná." | žádná akce, která by ho vrátila |
| `deleted` | ● Smazaný (šedá) | „Smazán 20. 7. Údaje byly odstraněny." | celá obrazovka je jen pro čtení (stav S12) |
| **`processing_restricted`** | ⚠ **Omezené zpracování** (oranžová, **navíc** k stavu) | viz níž | vysvětlující blok, viz níž |
| **`snooze_until`** | ⏸ Pozastaveno do 30. 9. | „Sám si vyžádal pauzu do 30. 9. 2026. Potom se vrátí automaticky." | tlačítko „Zrušit pauzu" |
| **`anonymized_at`** | ● Anonymizovaný | „Údaje byly na žádost smazány 20. 7. Zůstal jen záznam, že tenhle člověk existoval." | žádné osobní údaje, jen počty |

**Omezené zpracování podle článku 18 GDPR je nejdůležitější z nich**, protože takový kontakt **vypadne ze všech segmentů a ze všech kampaní** a uživatel by jinak nikdy nezjistil proč. Nepatří tedy jen odznak, ale vysvětlující blok nad údaji:

```
┌──────────────────────────────────────────────────────────────┐
│  ⚠ Tenhle kontakt má omezené zpracování                       │
│                                                                │
│  Jana Nováková 18. 7. požádala o omezení zpracování svých     │
│  údajů (článek 18 GDPR). Do vyřízení žádosti jí nesmíme nic   │
│  posílat.                                                       │
│                                                                │
│  Prakticky to znamená, že vypadla ze všech segmentů a         │
│  nedostane žádnou kampaň, i kdyby v publiku byla.             │
│                                                                │
│  [ Zobrazit žádost ]                                           │
└──────────────────────────────────────────────────────────────┘
```

Věta „vypadla ze všech segmentů" je tam schválně. Uživatel jinak vidí kontakt v seznamu, vidí, že splňuje podmínky segmentu, a nechápe, proč se počet nesejde. Stejné vysvětlení se proto objevuje i v rozpadu publika kampaně (8.4.6) jako samostatný odečtový řádek, ne schované v „ostatní".

**Filtry časové osy:**

| Filtr | Volby |
|---|---|
| Typ | Vše, E-maily, Web, Změny kontaktu, Souhlasy, Automatizace (MVP 2) |
| Období | Posledních 7 / 30 / 90 dní, Vše, vlastní rozsah |
| Kampaň | konkrétní kampaň |

**Prázdné stavy časové osy:**

| Situace | Text |
|---|---|
| Kontakt je nový, nic se nestalo | "Zatím se nic nestalo. Až Janě pošlete e-mail nebo až navštíví váš web, uvidíte to tady." |
| Tracking vypnutý v projektu | "Sledování chování je v projektu vypnuté, proto tu vidíte jen e-maily." plus odkaz do nastavení |
| Filtr nic nenašel | "V období posledních 7 dní se nic nestalo. [Zobrazit posledních 90 dní]" |
| Kontakt bez souhlasu s trackingem | "Jana nedala souhlas se sledováním chování na webu, proto tu web nevidíte. E-maily ano, ty jsou součástí souhlasu s newsletterem." |

Poslední řádek je důležitý pro GDPR i pro pochopení: uživatel jinak nechápe, proč u jednoho kontaktu web vidí a u druhého ne.

**Akce a jejich ochrana:**

| Akce | Úroveň | Poznámka |
|---|---|---|
| Poslat jednorázový e-mail | N1 | Otevře jednoduchý editor, obchází kampaně |
| Odhlásit | N1 | S vrácením zpět, protože ruční odhlášení bývá omyl |
| Smazat | N2 | Dialog vysvětlí, co se stane s historií a se statistikami kampaní |
| Exportovat | N1 | JSON plus CSV, je to podklad pro žádost subjektu údajů podle GDPR |

**Dialog smazání kontaktu:**

> **Smazat kontakt Jana Nováková?**
>
> Co se stane:
> - Kontakt zmizí ze všech seznamů, segmentů a z databáze
> - Jeho časová osa a historie chování na webu se smažou
> - V reportech odeslaných kampaní zůstanou jen souhrnná čísla, jméno ani adresa už tam nebudou
> - Adresa zůstane na blokovaných adresách, aby se jí omylem neposlalo znovu
>
> Tohle nejde vzít zpět.
>
> [ Stáhnout data kontaktu ]
>
> [ Zrušit ]  [ Smazat kontakt ]

---
### 8.9 Veřejné stránky, které vidí příjemci

Součástí produktu jsou stránky, které vidí koncoví příjemci, ne uživatelé nástroje. Mají jiná pravidla a je snadné na ně zapomenout.

| Stránka | Vlastník obsahu | Pravidla |
|---|---|---|
| Potvrzení přihlášení (double opt-in) | část 2 | **Funguje bez JavaScriptu.** Otevírá se z poštovního klienta, často v prohlížeči s přísným blokováním. |
| Odhlášení z odběru | část 2 | Bez JavaScriptu. Jednokrokové: odkaz z e-mailu odhlásí a stránka to jen potvrdí. Nikdy nevyžadovat přihlášení ani vyplnění formuláře k odhlášení. |
| Nastavení odběru | část 2 | Bez JavaScriptu jako záloha, s JavaScriptem plynulejší |
| Zobrazení e-mailu v prohlížeči (webview) | část 3 | Statické, bez sledování nad rámec kampaně |
| Vložený přihlašovací formulář | část 2 | Vkládá se na cizí web, takže styly musí být izolované a nesmí nic rozbít |
| Delegovaná stránka DNS | část 4a, návrh v 8.2.6 | Bez přihlášení, jen ke čtení, `noindex` |

**Společná pravidla pro veřejné stránky:**

| Pravidlo | Odůvodnění |
|---|---|
| Fungují bez JavaScriptu (obyčejný formulář, `POST`, přesměrování `303`) | Otevírají se z poštovních klientů a z prostředí s blokováním skriptů |
| Načítají se pod 100 kB celkem | Otevírají se na mobilu a často na pomalém připojení |
| Jazyk podle projektu nebo kontaktu, ne podle prohlížeče | Příjemce dostal e-mail v češtině, tak čeká českou stránku |
| Neobsahují navigaci do aplikace ani nic o projektu kromě jména odesílatele | Vidí je cizí lidé |
| Nesou logo a barvy projektu, aby vypadaly důvěryhodně | Odhlašovací stránka, která vypadá jako cizí, budí podezření na podvod |
| Kontrast a velikost písma stejné jako v aplikaci | Viz 11 |
| Odhlašovací stránka nikdy neztěžuje odhlášení | Kdo nenajde odhlášení, klikne na "spam", a to poškodí doručitelnost celého projektu. Ztěžování je proti vlastnímu zájmu, ne jen neetické. |

**Odhlašovací stránka: rozsah rozhoduje o textu.**

Původně jsem tady měl jeden „závazný" text, který tvrdil, že už z projektu nepřijde nic. **To je při odhlášení z jednoho seznamu nepravda** a část 2 (4.9.2) rozlišuje dva rozsahy podle toho, jestli token nese `list_id`. Znění vlastní část 2, která má klíče `public.unsubscribe.listScope`, `public.unsubscribe.global` a `public.unsubscribe.done`. **Já vlastním pravidla tónu a strukturu stránky, ne text.**

| Rozsah | Kdy nastane | Co stránka říká |
|---|---|---|
| **Ze seznamu** | token nese `list_id`, tedy běžná kampaň na seznam | `public.unsubscribe.listScope`: „Odhlašujete se ze seznamu {list}. Ostatní e-maily od nás vám budou chodit dál." plus výrazné tlačítko `public.unsubscribe.global`: „Nechci od vás už nic" |
| **Globální** | token bez `list_id`, transakční e-mail, kampaň na segment, nebo uživatel klikl na „Nechci od vás už nic" | `public.unsubscribe.done`: „Hotovo, už vám nic nepošleme." |

Struktura stránky, kterou vlastním já:

```
┌──────────────────────────────────────────────────┐
│  [logo projektu]                                  │
│                                                    │
│  Odhlásili jsme vás ze seznamu Newsletter          │
│                                                    │
│  Ostatní e-maily od nás vám budou chodit dál.      │
│                                                    │
│  Odhlášení platí od teď. Kdyby vám ještě dorazil   │
│  e-mail, který byl odeslaný před chvílí, už bude   │
│  poslední.                                          │
│                                                    │
│  [ Nechci od vás už nic ]                          │
│                                                    │
│  Nebo si nastavte, co má chodit:                   │
│  [ Nastavit odběr ]  ·  [ Přihlásit se zpátky ]   │
└──────────────────────────────────────────────────┘
```

**Třetí odstavec je moje doplnění a trvám na něm.** Část 2 v 4.9.4 přiznává, že v okně mezi vyzvednutím dávky senderem a odesláním může odhlášenému člověku ještě odejít jedna zpráva. Bez vysvětlení to vypadá, že odhlášení nefunguje, a příjemce sáhne po tlačítku „spam", což poškodí doručitelnost celého projektu. Je to jedna věta, která brání nejdražší možné reakci. Žádám část 2, aby ji přidala jako `public.unsubscribe.inFlightNotice`, viz U→2.11.

**Stránka s nastavením odběru** (`/p/{token}`) vlastní část 2 (4.9.5) včetně obsahu sedmi bloků. Přidávám k ní jen pravidla:

| Pravidlo | Odůvodnění |
|---|---|
| Adresa je maskovaná (`j***@example.cz`, klíč `public.preferences.masked`) | Odkaz bez expirace může najít kdokoliv |
| „Odhlásit ze všeho" je vidět bez rolování | Kdo hledá odhlášení a nenajde ho, klikne na spam |
| „Pozastavit na 30 / 60 / 90 dní" je nabídnuté **před** odhlášením | Je to měkčí volba, kterou většina lidí uvítá, a projekt o kontakt nepřijde |
| Neplatný token vede na generickou stránku | Nikdy neprozradit, jestli kontakt existuje |
| Bez JavaScriptu funguje všechno | `POST` a `303` |

### 8.10 Obrazovky, které v mém návrhu chyběly

Doplňuju je na úrovni struktury a stavů. Recenze části 2 našla čtyři místa, kde jsem obrazovku uvedl v mapě aplikace, ale nenavrhl ji, nebo na ni odkazoval z prázdného stavu, aniž by měla kam vést. **Doménový obsah a texty vlastní část 2**, já dodávám rozvržení, stavy a ochranu nevratných akcí.

#### 8.10.1 Blokované adresy (suppression list)

Nejchoulostivější z nich, protože odebrání položky je nevratné rozhodnutí s dopadem na reputaci celého projektu.

```
┌────────────────────────────────────────────────────────────────────┐
│  Blokované adresy                              [Přidat] [Exportovat]│
│                                                                      │
│  Na tyhle adresy nic neposíláme. Chrání vás to před tím, abyste     │
│  omylem napsali někomu, kdo si to nepřeje nebo komu se e-maily      │
│  vracejí.                                          [Jak to funguje] │
│                                                                      │
│  Filtr: Důvod ▾   Přidáno ▾   🔍                                    │
│  ┌──────────────────┬────────────────────┬───────────┬───────────┐  │
│  │ Adresa           │ Důvod              │ Přidáno   │           │  │
│  ├──────────────────┼────────────────────┼───────────┼───────────┤  │
│  │ a***@seznam.cz   │ Nahlásil spam      │ 12. 6.    │ 🔒        │  │
│  │ b***@firma.cz    │ Adresa neexistuje  │ 2. 7.     │ za 12 dní │  │
│  │ c***@gmail.com   │ Opakovaně se       │ 20. 7.    │ [Odebrat] │  │
│  │                  │ nedoručilo         │           │           │  │
│  │ d***@firma.cz    │ Ruční přidání      │ 25. 7.    │ [Odebrat] │  │
│  │ e***@firma.cz    │ Odhlásil se        │ 28. 7.    │ ℹ         │  │
│  └──────────────────┴────────────────────┴───────────┴───────────┘  │
└────────────────────────────────────────────────────────────────────┘
```

**Matice odebrání z 4.10.2 části 2 se promítá do posledního sloupce**, ne do skryté chyby po kliknutí. Uživatel musí vidět, co jde, ještě než na to sáhne:

| Důvod | Česky v rozhraní | Sloupec akce | Text při najetí |
|---|---|---|---|
| `complaint` | Nahlásil spam | 🔒 zámek | `suppressions.complaintLocked`: „Adresu, která nahlásila spam, nelze odblokovat." |
| `gdpr_erasure` | Výmaz podle GDPR | 🔒 zámek | „Poslední stopa po smazaném člověku. Odebrat nejde." |
| `hard_bounce` | Adresa neexistuje | „za 12 dní" nebo [Odebrat] | `suppressions.bounceTooRecent`: „Tvrdý odraz jde odblokovat nejdřív po 30 dnech. Zbývá 12 dní." Po 30 dnech tlačítko, **jen pro vlastníka a správce, jen po jedné**. |
| `soft_bounce_threshold`, `manual`, `import`, `invalid` | Opakovaně se nedoručilo / Ruční přidání / Z importu / Neplatná adresa | [Odebrat] | dostupné i hromadně, pro editora a výš |
| `global_unsubscribe`, `one_click_unsubscribe` | Odhlásil se | ℹ | „Odebere se samo, až se ten člověk znovu přihlásí a potvrdí to e-mailem. Ručně to udělat nejde, protože návrat musí být jeho rozhodnutí." |

**Zámek místo zašedlého tlačítka.** Princip P5 zakazuje mrtvé tlačítko, takže tam, kde odebrání nejde, není zašedlá akce, ale ikona s vysvětlením. Uživatel se dozví **proč**, ne jen že nemůže.

**Hromadné odebrání** je dostupné jen pro poslední řádek tabulky (`soft_bounce_threshold`, `manual`, `import`, `invalid`). U ostatních se hromadný výběr **nenabízí vůbec**, protože část 2 hromadné odebrání tvrdých odrazů výslovně zakazuje. Když uživatel vybere řádky napříč důvody, tlačítko říká: „Odebrat 12 z 40 vybraných" a pod ním „28 adres odebrat nejde, viz důvody v tabulce."

**Adresy jsou maskované** (`a***@seznam.cz`) se zobrazením celé adresy po kliknutí a se zápisem do auditu. Je to seznam lidí, kteří si nepřáli komunikaci, takže není důvod ho mít na obrazovce celý.

#### 8.10.2 Formuláře

Prázdný stav kontaktů nabízí „Vytvořit přihlašovací formulář" a to tlačítko musí mít kam vést.

| Obrazovka | Obsah |
|---|---|
| Seznam formulářů | název, seznam, kam zapisuje, počet přihlášení za 30 dní, stav |
| Editor formuláře | pole (výběr z kontaktních a vlastních polí), texty, cílový seznam, chování po odeslání |
| **Kód k vložení** | tři varianty z 4.13.1 části 2, každá s tlačítkem zkopírovat |

Obrazovka s kódem k vložení je jediná, kde netechnický uživatel narazí na kód, takže se řídí stejnou strategií jako DNS v 8.2: **delegovat**.

```
┌──────────────────────────────────────────────────────────────┐
│  Vložení formuláře na web                                     │
│                                                                │
│  ( ) Vložím to sám                                            │
│  (•) Pošlu to člověku, který spravuje náš web    DOPORUČENO   │
│  ( ) Použiju hotovou stránku (zatím nemáme web)               │
│                                                                │
│  ── Jak to vložit ────────────────────────────────────────    │
│  Váš web vypadá jako WordPress.  [Návod pro WordPress]        │
│                                                                │
│  Nejjednodušší varianta:                                       │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ <script async src="https://…/f/newsletter.js"></script>│   │
│  │ <div data-ml-form="newsletter"></div>                 │    │
│  └──────────────────────────────────  [ Zkopírovat ]────┘    │
│                                                                │
│  ▸ Nejde vložit skript? Máme i variantu s rámečkem a čistě    │
│    HTML formulář, který funguje i bez JavaScriptu.            │
│                                                                │
│  ── Zkouška ──────────────────────────────────────────────    │
│  Zatím jsme přes tenhle formulář nedostali žádné přihlášení.  │
│  [ Otevřít náhled formuláře ]                                 │
└──────────────────────────────────────────────────────────────┘
```

Řádek „Zkouška" dole je důležitý: uživatel jinak neví, jestli vložení fungovalo, dokud se někdo nepřihlásí. Po prvním přihlášení se změní na „✓ První přihlášení dorazilo 31. 7. v 14:20."

#### 8.10.3 Souhlasy a žádosti podle GDPR

Dvě různé věci na jedné obrazovce by byly chyba, takže jsou oddělené.

**Souhlasy** jsou v detailu kontaktu jako panel (viz 8.8) a v nastavení projektu jako přehled účelů. Kontakt má pět účelů (`email_marketing`, `analytics`, `personalization`, `profiling`, `third_party`) a u každého tři možné stavy. Rozlišení **„odvolal"** od **„nikdy nedal"** musí být viditelné, protože právně to není totéž:

```
Souhlasy                                        [Historie]
  Zasílání newsletteru      ✓ Udělen 12. 6. 2026, formulář na webu
  Měření návštěvnosti       ✕ Odvolán 3. 7. 2026, stránka preferencí
  Personalizace             ·  Nikdy nedal
  Profilování               ·  Nikdy nedal
  Předání třetí straně      ·  Nikdy nedal
```

**Žádosti podle GDPR** mají vlastní obrazovku, protože mají lhůty a stav:

| Sloupec | Obsah |
|---|---|
| Kontakt | maskovaná adresa |
| Typ | Přístup k údajům / Přenositelnost / Oprava / Omezení / Výmaz / Námitka |
| Podáno | datum |
| **Lhůta** | „zbývá 18 dní", pod 5 dní červeně |
| Stav | Čeká na ověření totožnosti / Zpracovává se / Hotovo / Zamítnuto |

Sloupec se lhůtou je celý smysl obrazovky. Bez něj je to jen seznam a lhůta uteče.

**Výmaz je nevratná akce úrovně N4** a jeho dialog musí vysvětlit, co se stane s tím, co po člověku zůstane:

> **Smazat všechny údaje kontaktu Jana Nováková?**
>
> Co se stane:
> - Jméno, adresa a všechny údaje se nenávratně smažou
> - Časová osa a historie chování se smaže
> - V reportech odeslaných kampaní zůstanou **jen souhrnná čísla**, bez jména a adresy
> - Adresa zůstane na blokovaných adresách, aby ji nikdo omylem nenaimportoval zpátky
>
> Poslední bod je záměrný: je to jediná ochrana proti tomu, aby se smazaný člověk vrátil příštím importem.
>
> Tohle nejde vzít zpět.
>
> [ Zrušit ]  [ Smazat údaje ]

#### 8.10.4 Příchozí webhooky

Obrazovka pro „objednávka v e-shopu založí a přihlásí kontakt bez psaní kódu". Netechnický uživatel ji sám nenastaví, ale **musí na ní vidět, jestli to funguje**, protože právě to bude řešit s dodavatelem e-shopu.

| Blok | Obsah |
|---|---|
| Adresa a tajemství | URL k vložení do e-shopu, tlačítko zkopírovat, tajemství zobrazené jednou |
| **Mapování** | vizuální přiřazení polí z cizího payloadu na naše, s náhledem na skutečném posledním požadavku |
| **Poslední požadavky** | dvacet posledních s časem, stavem (`accepted`, `rejected`, `dropped`) a rozbalitelným tělem |
| Zkouška | „Zatím nedorazil žádný požadavek" nebo „✓ Poslední dorazil před 4 minutami" |

**Mapování na skutečném posledním požadavku** je klíčová věc. Mapovat pole naslepo podle dokumentace e-shopu nejde. Postup je: e-shop pošle jednu objednávku, my ji zachytíme i bez namapování (stav `dropped` s uloženým tělem), a uživatel pak klikáním přiřadí `customer.email` na E-mail. To je rozdíl mezi „zavolám programátora" a „udělám to sám za pět minut".

Stav `dropped` proto **není chyba** a nesmí se tak zobrazovat: „Požadavek jsme uložili, ale zatím nevíme, co s ním. [Namapovat pole]".

---

## 9. Mikrotexty a tón

Texty v rozhraní nejsou dekorace, jsou to instrukce. Píše je vývojář v okamžiku, kdy komponentu staví, takže pravidla musí být krátká a použitelná bez konzultace.

### 9.1 Deset pravidel

| # | Pravidlo | Špatně | Dobře |
|---|---|---|---|
| 1 | **Vykáme.** V celém rozhraní, včetně tlačítek, chyb a prázdných stavů. Nikdy netykáme. | "Nahraj si kontakty" | "Nahrajte si kontakty" |
| 2 | **Píšeme, co se stane, ne jak se jmenuje funkce.** | "Spustit synchronizaci publika" | "Spočítat, komu se e-mail odešle" |
| 3 | **Tlačítko je sloveso a předmět.** Nikdy "OK", "Ano", "Potvrdit". | "OK" | "Smazat 12 kontaktů" |
| 4 | **Vždy uvádíme číslo, když je akce hromadná.** | "Odeslat kampaň" | "Odeslat 1 153 e-mailů" |
| 5 | **Aktivní rod a druhá osoba množného čísla.** Kdo co udělal. | "Kontakty byly naimportovány" | "Naimportovali jsme 12 397 kontaktů" |
| 6 | **Chyba říká, co se stalo, proč a co s tím.** Tři části, v tomhle pořadí. | "Nastala chyba" | viz 10.1 |
| 7 | **Žádné omluvy, žádné "ups".** Nástroj se neomlouvá, nástroj řeší. | "Ups! Něco se pokazilo 😔" | "Kontakty se nepodařilo načíst." |
| 8 | **Nejvýš jeden vykřičník na obrazovku a jen u skutečné radosti.** | "Uloženo!" | "Uloženo" |
| 9 | **Nepoužíváme závorky pro důležitou informaci.** Co je důležité, patří do věty. | "Kampaň odešla (kromě 43 odhlášených)" | "Kampaň odešla 1 153 lidem. 43 odhlášeným jsme ji neposlali." |
| 10 | **Nikdy neříkáme "jednoduše", "stačí" a "prostě".** Když to bylo jednoduché, uživatel by tu nebyl. | "Stačí přidat DNS záznam" | "Přidejte DNS záznam. Zabere to asi 10 minut." |

**Doplňková pravidla pro angličtinu:**

| # | Pravidlo | Špatně | Dobře |
|---|---|---|---|
| 11 | Sentence case v nadpisech a tlačítkách, ne Title Case | "Send Test Email" | "Send test email" |
| 12 | Oxford comma se používá | "contacts, lists and segments" | "contacts, lists, and segments" |
| 13 | Žádné zkratky typu "info", "config", "sync" v textu pro uživatele | "Sync config" | "Update settings" |
| 14 | Kontrakce ano ("you'll", "won't"), působí přirozeně a zkracují | "You will not be able to" | "You won't be able to" |

### 9.2 Slovníček: závazné překlady

Sloupec "Nikdy nepoužívat" je stejně závazný jako sloupec s překladem. Kontroluje se skriptem nad katalogy překladů (viz 9.6).

#### Základní entity

| Koncept | Česky (závazně) | English | Nikdy nepoužívat česky |
|---|---|---|---|
| workspace | **Projekt** | Project | pracovní prostor, workspace, účet, klient |
| contact | **Kontakt** | Contact | odběratel, člen, uživatel, lead, adresa |
| list | **Seznam** | List | skupina, databáze, publikum |
| segment | **Segment** | Segment | filtr, dynamická skupina, chytrý seznam |
| tag | **Štítek** | Tag | tag, značka, kategorie |
| custom field | **Vlastní pole** | Custom field | atribut, property, metadata |
| campaign | **Kampaň** | Campaign | newsletter, mailing, rozeslání |
| template | **Šablona** | Template | vzor, design, layout |
| block | **Blok** | Block | prvek, komponenta, modul |
| audience | **Publikum** | Audience | cílová skupina, příjemci |
| recipient | **Příjemce** | Recipient | adresát |
| form | **Formulář** | Form | přihlašovací box, widget |
| member | **Člen projektu** | Member | uživatel, účet |

#### Odesílání a doručitelnost

| Koncept | Česky (závazně) | English | Nikdy nepoužívat česky |
|---|---|---|---|
| sending provider | **Odesílací služba** | Sending provider | provider, poskytovatel, brána |
| sender domain | **Odesílací doména** | Sender domain | doména odesílatele, from doména |
| from address | **Adresa odesílatele** | From address | zpáteční adresa |
| reply-to | **Adresa pro odpovědi** | Reply-to address | reply-to |
| domain verification | **Ověření domény** | Domain verification | autentizace domény, validace |
| suppression list | **Blokované adresy** | Suppression list | blacklist, černá listina, seznam vyloučených |
| bounce (jev) | **Nedoručení** | Bounce | odraz, bounce, vrácený e-mail |
| bounced (stav) | **Nedoručeno** | Bounced | |
| hard bounce | **Trvalé nedoručení** | Hard bounce | tvrdý bounce |
| soft bounce | **Dočasné nedoručení** | Soft bounce | měkký bounce |
| complaint | **Stížnost na spam** | Spam complaint | stížnost, complaint, spam report |
| complaint rate | **Míra stížností** | Complaint rate | |
| deliverability | **Doručitelnost** | Deliverability | |
| quota | **Denní limit** | Sending quota | kvóta, limit odesílání |
| sandbox | **Testovací režim u Amazonu** | Amazon sandbox | sandbox, pískoviště |

#### Přihlášení a odhlášení

| Koncept | Česky (závazně) | English | Nikdy nepoužívat česky |
|---|---|---|---|
| subscribe | **Přihlásit k odběru** | Subscribe | zaregistrovat, přidat |
| unsubscribe | **Odhlásit z odběru** | Unsubscribe | odregistrovat, zrušit odběr |
| double opt-in | **Potvrzení přihlášení e-mailem** | Double opt-in | dvojité přihlášení, double opt-in |
| confirmation email | **Potvrzovací e-mail** | Confirmation email | verifikační e-mail |
| preference center | **Nastavení odběru** | Preference center | preference centrum |
| consent | **Souhlas** | Consent | |
| `confirmed` (stav přihlášení k seznamu) | **Potvrzeno** | Confirmed | přihlášen, subscribed |
| `pending` (stav přihlášení k seznamu) | **Čeká na potvrzení** | Pending confirmation | nepotvrzený |
| `unsubscribed` (stav přihlášení k seznamu) | **Odhlášeno** | Unsubscribed | neaktivní |

**Hodnota `subscribed` neexistuje.** Část 2 to v 4.1.6 uvádí výslovně a je to past, do které je snadné spadnout: v rozhraní se přihlášený kontakt jmenuje **Potvrzeno**, protože stav v modelu je `confirmed`.

#### Stavy kontaktu (`contacts.status`, závazné podle části 2, kapitola 4.1.6)

| Hodnota | Česky (závazně) | English | Smí dostat kampaň | Jak to podat uživateli |
|---|---|---|---|---|
| `active` | **Aktivní** | Active | ano, jako jediný | zelený odznak |
| `unconfirmed` | **Nepotvrzený** | Unconfirmed | ne | žlutý odznak plus "Nepotvrdil přihlášení, proto mu kampaně neposíláme." s tlačítkem "Poslat potvrzovací e-mail znovu" |
| `unsubscribed` | **Odhlášený** | Unsubscribed | ne | šedý odznak plus datum a důvod odhlášení |
| `bounced` | **Nedoručitelný** | Bounced | ne | červený odznak plus "Adresa neexistuje. E-maily se vracely jako trvale nedoručitelné." |
| `complained` | **Nahlásil spam** | Reported spam | ne, nikdy | červený odznak plus "Označil naši poštu jako spam. Tenhle stav nejde zrušit." |
| `deleted` | **Smazaný** | Deleted | ne | detail je jen pro čtení, viz 8.8.1 |

#### Další příznaky, které mění chování a musí být vidět

| Příznak | Česky | Co znamená pro uživatele |
|---|---|---|
| `processing_restricted` | **Omezené zpracování** | Kontakt uplatnil článek 18 GDPR. **Vypadne ze všech segmentů a ze všech kampaní.** Bez vysvětlení by uživatel nikdy nezjistil proč. |
| `snooze_until` | **Pozastaveno do {datum}** | Sám si vyžádal pauzu. Po datu se automaticky vrátí. |
| `anonymized_at` | **Anonymizovaný** | Data byla vymazána podle článku 17. Zůstal jen záznam, že člověk existoval. |

#### Sledování a čísla

| Koncept | Česky (závazně) | English | Nikdy nepoužívat česky |
|---|---|---|---|
| open | **Otevření** | Open | přečtení, zobrazení |
| click | **Kliknutí** | Click | proklik, klik |
| unique open | **Otevřelo lidí** | Unique opens | unikátní otevření |
| click rate | **Míra prokliku** | Click rate | CTR, prokliková míra |
| delivered | **Doručeno** | Delivered | |
| tracking | **Sledování** | Tracking | trackování, měření |
| web tracking | **Sledování chování na webu** | Web tracking | |
| event | **Událost** | Event | event |
| timeline | **Časová osa** | Timeline | historie, aktivita |

#### Obsah a personalizace

| Koncept | Česky (závazně) | English | Nikdy nepoužívat česky |
|---|---|---|---|
| merge tag | **Doplňovaný údaj** | Merge tag | personalizace, proměnná, placeholder, slučovací značka, merge tag |
| personalization | **Osobní oslovení** | Personalization | |
| vocative | **5. pád** | Vocative | vokativ (v dokumentaci ano, v UI ne) |
| greeting | **Oslovení** | Greeting | pozdrav |
| subject | **Předmět** | Subject | subject |
| preheader | **Úvodní řádek** | Preheader | preheader, náhledový text |
| plain text version | **Textová verze** | Plain text version | plain text |
| preview | **Náhled** | Preview | |
| test email | **Testovací e-mail** | Test email | test |
| brand | **Značka** | Brand | branding |

#### Systém a operace

| Koncept | Česky (závazně) | English | Nikdy nepoužívat česky |
|---|---|---|---|
| job | **Úloha** | Job | task, proces, joba |
| import | **Import** | Import | nahrání, načtení |
| export | **Export** | Export | stažení, výpis |
| API key | **Klíč k API** | API key | token, přístupový klíč |
| webhook | **Webhook** | Webhook | háček |
| backup | **Záloha** | Backup | zálohování (to je činnost) |
| role owner | **Vlastník** | Owner | majitel |
| role admin | **Správce** | Admin | administrátor |
| role editor | **Editor** | Editor | redaktor |
| role viewer | **Prohlížející** | Viewer | čtenář, pozorovatel |

### 9.3 Vzory pro tlačítka

| Situace | Česky | English |
|---|---|---|
| Uložení | Uložit | Save |
| Uložení a odchod | Uložit a zavřít | Save and close |
| Zrušení dialogu (nedestruktivní) | Zrušit | Cancel |
| Ústup od destruktivní akce | Zpět k úpravám / Nechat běžet / Nemazat | Back to editing / Keep running / Keep |
| Potvrzení destruktivní akce | Smazat 12 kontaktů | Delete 12 contacts |
| Vytvoření | Vytvořit kampaň | Create campaign |
| Přidání do existujícího | Přidat kontakt | Add contact |
| Odeslání | Odeslat 1 153 e-mailů | Send 1,153 emails |
| Zopakování po chybě | Zkusit znovu | Try again |
| Další krok průvodce | Pokračovat | Continue |
| Poslední krok průvodce | název konkrétní akce, ne "Dokončit" | |
| Zavření informace | Rozumím | Got it |
| Odložení | Později | Later |

**Nikdy:** OK, Ano, Ne, Potvrdit, Odeslat formulář, Submit, Done, Next, Finish.

### 9.4 Vzory pro potvrzovací dialogy

Struktura je vždy stejná, čtyři části:

```
[Nadpis: otázka s konkrétním předmětem a číslem]

[Co se stane: odrážky nebo dvě věty. Konkrétní následky, ne obecnosti.]

[Věta o nevratnosti, pokud je nevratná]

[Tlačítko ústupu]    [Tlačítko akce se slovesem a číslem]
```

| Chyba, které se vyhýbáme | Proč |
|---|---|
| "Opravdu chcete pokračovat?" | Neptá se na nic. Uživatel neví, co potvrzuje. |
| "Jste si jistý?" | Totéž, plus je to v češtině rodově problematické. |
| "Tato akce je nevratná." bez uvedení, co se stane | Vyvolá strach bez informace. |
| Nadpis "Potvrzení" | Nadpis má nést informaci, ne pojmenovat typ okna. |
| Destruktivní tlačítko jako výchozí fokus | `Enter` bez čtení pak smaže data. |

### 9.5 Čísla, data a formáty v textu

| Typ | Česky | English |
|---|---|---|
| Tisíce | 12 480 (úzká pevná mezera U+202F) | 12,480 |
| Desetinná čísla | 0,34 % (čárka) | 0.34% |
| Procenta | 16,4 % (s mezerou) | 16.4% (bez mezery) |
| Peníze | 24 980 Kč | CZK 24,980 |
| Datum plné | 31. 7. 2026 | July 31, 2026 |
| Datum krátké | 31. 7. | Jul 31 |
| Datum s časem | 31. 7. 2026 v 14:38 | July 31, 2026 at 2:38 PM |
| Čas | 14:38 | 2:38 PM |
| Relativní, do 1 minuty | před chvílí | just now |
| Relativní, minuty | před 4 minutami | 4 minutes ago |
| Relativní, hodiny | před 3 hodinami | 3 hours ago |
| Relativní, dnes | dnes v 14:38 | today at 2:38 PM |
| Relativní, včera | včera v 18:20 | yesterday at 6:20 PM |
| Relativní, starší | 12. 6. 2026 | June 12, 2026 |
| Trvání | 4 minuty a 12 sekund | 4 minutes 12 seconds |
| Odhad trvání | asi 4 minuty | about 4 minutes |
| Velikost souboru | 12,4 MB | 12.4 MB |

**Pravidla pro relativní čas:** relativní tvar se používá do 7 dnů, pak absolutní datum. Vždy je k dispozici přesný čas při najetí myší (`title` a `<time datetime>`). Relativní čas se sám aktualizuje nejvýš jednou za minutu.

**Zaokrouhlování procent:** vždy na jedno desetinné místo. Nikdy nezaokrouhlujeme na celá procenta, protože u malých čísel (míra stížností 0,34 %) by se ztratila celá informace.

### 9.6 Vynucení slovníku

Skript v CI kontroluje katalogy `cs.json` a `en.json` proti zakázaným výrazům ze slovníku:

| Kontrola | Chování |
|---|---|
| Zakázaný výraz v hodnotě řetězce | Build padá s uvedením klíče a návrhem správného výrazu |
| Řetězec obsahuje znak U+2014 (dlouhá pomlčka) | Build padá |
| Řetězec obsahuje hodnotu `subscribed` jako stav | Build padá, správně je `confirmed` |
| Anglický řetězec v Title Case delší než 3 slova | Varování |
| Řetězec s vykřičníkem | Varování, výjimky se zapisují do allowlistu |
| Chybí protějšek v druhém jazyce | Build padá |
| Řetězec obsahuje tykání (heuristika na koncovky "-eš", "-íš", "si jistý") | Varování |

---

## 10. Chybové hlášky

### 10.1 Anatomie

Každá hláška má tři části, vždy ve stejném pořadí:

```
1. CO SE STALO      Fakticky, v aktivním rodu, bez omluv.
2. PROČ             Když to víme. Když ne, tuhle část vynecháme, nevymýšlíme si.
3. CO S TÍM         Konkrétní krok. Ideálně tlačítko, které ho udělá.
```

Volitelná čtvrtá část: **sbalené technické podrobnosti** s kódem chyby, `request_id` a časem, pro zkopírování do podpory. Povinná u všech chyb, které nemají jasné řešení.

```
Špatně:  "Nastala chyba při zpracování požadavku."
         Chybí všechny tři části.

Špatně:  "Chyba: SMTP_AUTH_FAILED (code 535)"
         Je tam jen technická příčina, žádné "co s tím".

Špatně:  "Ups! Něco se nepovedlo 😔 Zkuste to prosím později."
         Omluva místo informace, "později" není krok.

Dobře:   "Server odmítl přihlášení.
          U některých poskytovatelů je přihlašovací jméno celá
          e-mailová adresa, u jiných jen část před zavináčem.
          [Zkontrolovat údaje]"
```

**Kdo hlášku skládá.** Část 1 zavádí RFC 9457 Problem Details a výslovně říká, že *"klient, který chce vlastní texty, se řídí `code` a `errors[].code`, ne textem"*. To je přesně to, co potřebuju, takže dělba práce je:

| Vrstva | Co dodává | Kdo |
|---|---|---|
| `code` | strojově čitelný identifikátor, podle kterého se rozhraní rozhoduje | část 1 a doménové části |
| `params` | hodnoty k dosazení do textu (`{ used: 8400, limit: 10000 }`) | **chybí, viz U→1.1** |
| `detail` | lokalizovaný text pro klienty API a pro případy, na které rozhraní nemá vlastní text | část 1 |
| text na obrazovce | plná hláška podle katalogu 10.3, s kontextovými tlačítky | rozhraní |
| `request_id` | pro dohledání v logu | část 1 |

Jediné, co k tomu od části 1 potřebuju navíc, je rozšiřující člen **`params`**. RFC 9457 rozšiřující členy povoluje. Bez nich nejde napsat hláška 16, protože "Váš denní limit je 10 000 a dnes jste už poslali 8 400" jsou dvě čísla, která rozhraní nemá odkud vzít.

### 10.2 Mapování na katalogy kódů částí 1 a 2

Část 1 má obecné kódy, doménové části registrují vlastní tvarem `<domena>_<problem>` v `packages/core/errors/registry.ts`. Tabulka říká, které z mých hlášek jsou jen **jiné podání obecného kódu** a které patří konkrétní doméně.

| # | Hláška | `code` | Kdo ho vlastní | `params`, které potřebuju |
|---|---|---|---|---|
| 1 | Rozsypaná diakritika v CSV | `unsupported_encoding` | část 2 | `detected`, `alternatives[]`, `sampleBefore`, `sampleAfter` |
| 2 | Nevybraný sloupec s e-mailem | `no_email_column_mapped` | část 2 | `suggestedColumn` |
| 3 | Stejný soubor už dnes nahraný | `import_duplicate` (409) | část 2 | `import_id`, `status`, `created_at`, `created_rows` |
| 4 | Soubor je moc velký | `file_too_large` | část 2 | `actualBytes`, `limitBytes` |
| 5 | SMTP odmítl přihlášení | `smtp_auth_failed` | část 4a | `host`, `username` |
| 6 | Amazon odmítl klíče | `ses_invalid_credentials` | část 4a | `keyIdMasked` |
| 7 | Účet v testovacím režimu | `ses_sandbox_restricted` | část 4a | `verifiedCount`, `recipientCount`, `dailyLimit` |
| 8 | DNS záznam zatím nevidíme | `dns_record_not_found` | část 4a | `recordType`, `recordName` |
| 9 | Dva SPF záznamy | `dns_spf_multiple_records` | část 4a | `found[]`, `mergedValue` |
| 10 | Název obsahuje doménu dvakrát | `dns_record_name_duplicated` | část 4a | `foundName`, `expectedName` |
| 11 | Záznam má jinou hodnotu | `dns_record_value_mismatch` | část 4a | `expected`, `found`, `diffIndex` |
| 12 | Doména není ověřená | `campaign_domain_not_verified` | část 4a | `domain` |
| 13 | Prázdné publikum | `campaign_empty_audience` | část 4a | `segmentId`, `segmentName` |
| 14 | Neexistující doplňovaný údaj | `campaign_merge_tag_unknown` | část 3 | `tagPath`, `tagLabel` |
| 15 | Vysoká míra stížností | `campaign_complaint_rate_too_high` | část 4a | `complaints`, `sample`, `rate`, `threshold` |
| 16 | Kvóta na dnes | `quota_exceeded` (obecný) | část 1, doplňuje 4a | `used`, `limit`, `remaining`, `recipients`, `resetsAt` |
| 17 | Příliš složitý segment | `segment_too_complex` | část 2 | `conditionCount`, `limit` |
| 18 | Počet se nespočítal včas | `segment_count_estimated` | část 2 | `estimate`, `totalContacts` |
| 19 | Chybí klíč k AI | `ai_no_api_key` | část 3 | žádné |
| 20 | Došel kredit u providera | `ai_provider_out_of_credit` | část 3 | `provider` |
| 21 | Web není dostupný | `brand_url_unreachable` | část 3 | `url`, `timeoutSeconds` |
| 22 | Nemáte oprávnění odeslat | `forbidden` (obecný) | část 1 | **`requiredPermission`, `currentRole`, `grantedByRoles[]`, `contactableMembers[]`** |
| 23 | Vypršela relace | `session_expired` (obecný) | část 1 | žádné |
| 24 | Kontakt je v běžící kampani | `contact_in_running_campaign` | **nepřidělené** | `campaignId`, `campaignName`, `etaSeconds` |
| 25 | Webhook vypnutý po 20 selháních | `webhook_endpoint_disabled` | část 1 | `url`, `failures`, `since`, `lastStatus` |

**Katalog v 10.3 není úplný a vědomě.** Část 2 sama má 41 kódů importu (10 na úrovni souboru, 20 na úrovni řádku, 11 varování) a část 4a jich přidá další. Psát pro každý z nich čtyřodstavcovou hlášku by dokument nafouklo a nepřineslo nic: **hlášky na úrovni řádku a varování nejsou celoobrazovkové chyby, jsou to buňky v tabulce a řádky v souhrnu.** Proto jsou jejich texty tam, kde se používají, tedy v tabulkách v 8.3.6, a v katalogu 10.3 jsou jen ty, které zabírají celou obrazovku a vyžadují rozhodnutí. Rozdělení je:

| Kde | Co tam je | Kolik |
|---|---|---|
| 10.3 Katalog hlášek | chyby, které zastaví práci a vyžadují rozhodnutí | 25 |
| 8.3.6, tabulka varování | jedenáct varování importu, shluknutých po kódu | 11 |
| 8.3.6, tabulka chyb řádku | dvacet kódů jako text ve sloupci "Proč" | 20 |
| 8.3.6, výsledek `failed` | deset kódů na úrovni souboru, každý s vlastním krokem | 10 |
| 8.4.4, varování náhledu segmentu | `segment_unindexed_field`, `segment_slow_engagement`, `segment_count_estimated` | 3 |
| 8.4.3b, limity segmentu | devět limitů, každý s vlastním podáním | 9 |
| 8.10.1, blokované adresy | `suppressions.complaintLocked`, `suppressions.bounceTooRecent` | 2 |

**Čtyři nálezy z toho mapování**, které patří do požadavků:

1. **Hláška 22 potřebuje od `forbidden` mnohem víc, než dnes nese.** Věta "Nemáte oprávnění" je k ničemu. Použitelná hláška musí říct, které oprávnění chybí, kdo ho má a koho konkrétně oslovit. Viz U→1.1.
2. **Hláška 24 nemá vlastníka.** Smazání kontaktu, který je právě v běžící rozesílce, spadá mezi část 2 (maže) a část 4a (rozesílá). Viz U→2.10.
3. **Kódy `ses_*`, `smtp_*` a `dns_*` v části 4a jsem nenašel**, ale doména je jednoznačně její. Viz U→4a.13.
4. **Několik mých hlášek jsou obecné kódy s bohatším podáním.** To je v pořádku a je to přesně to, k čemu je oddělení `code` od textu dobré: `quota_exceeded` je pro API klienta dost, pro člověka ne.

### 10.3 Katalog hlášek

Pětadvacet hlášek pro reálné situace.

---

**1. `unsupported_encoding`** (Import, krok 2)

> **cs** Vypadá to, že soubor čteme špatně
> Ve jménech a městech jsou divné znaky, například "NovĂˇkovĂˇ" místo "Nováková". Soubor je nejspíš uložený v jiném kódování, než jaké jsme odhadli.
> [ Zkusit Windows-1250 ] [ Zkusit UTF-8 ] [ Zkusit ISO-8859-2 ]

> **en** The file doesn't look right
> Names and cities contain strange characters, for example "NovĂˇkovĂˇ" instead of "Nováková". The file is probably saved in a different encoding than we guessed.
> [ Try Windows-1250 ] [ Try UTF-8 ] [ Try ISO-8859-2 ]

---

**2. `no_email_column_mapped`** (Import, krok 3)

> **cs** Nevybrali jste sloupec s e-mailovou adresou
> Bez e-mailu nemá kontakt kam přijít, takže je to jediné povinné pole. Ve vašem souboru vypadá jako e-mail sloupec **Email** (`jana@firma.cz`).
> [ Použít sloupec Email ]

> **en** No email column selected
> Without an email address there is nowhere to send to, so it's the only required field. In your file, the column **Email** (`jana@firma.cz`) looks like the right one.
> [ Use the Email column ]

---

**3. `import_duplicate`** (Import, krok 1)

> **cs** Tenhle soubor jste už dnes nahrávali
> Před 3 hodinami jste naimportovali soubor se stejným obsahem a se stejným mapováním a přibylo z něj 9 812 kontaktů. Když ho nahrajete znovu, nic se nezkazí, jen se u existujících kontaktů znovu projdou údaje.
> [ Zobrazit původní import ] [ Naimportovat znovu ]

> **en** You already uploaded this file today
> Three hours ago you imported a file with identical contents and mapping, and it added 9,812 contacts. Importing it again won't break anything, it will just refresh the data on existing contacts.
> [ Show the original import ] [ Import again ]

---

**4. `file_too_large`** (Import, krok 1)

> **cs** Soubor je moc velký
> Má 340 MB, zvládneme 200 MB. Zkuste z něj odebrat sloupce, které nepotřebujete, nebo ho rozdělit na dva.
> [ Jak soubor rozdělit ]

> **en** The file is too large
> It's 340 MB, our limit is 200 MB. Try removing columns you don't need, or split it into two files.
> [ How to split a file ]

---

**5. `smtp_auth_failed`** (Nastavení odesílání)

> **cs** Server odmítl přihlášení
> Server `smtp.wedos.net` nepřijal zadané jméno a heslo. U některých poskytovatelů je přihlašovací jméno celá e-mailová adresa (`jana@kolo-shop.cz`), u jiných jen část před zavináčem (`jana`).
> [ Zkusit s celou adresou ] [ Zkontrolovat údaje ]

> **en** The server rejected the login
> The server `smtp.wedos.net` didn't accept the username and password. Some providers expect the full email address as the username (`jana@kolo-shop.cz`), others only the part before the at sign (`jana`).
> [ Try the full address ] [ Check the details ]

---

**6. `ses_invalid_credentials`** (Nastavení odesílání)

> **cs** Amazon odmítl přístupové klíče
> Klíč `AKIA...7B2Q` u Amazonu neexistuje, nebo byl zrušený. Klíče se dají znovu vytvořit v konzoli AWS v sekci IAM.
> [ Jak vytvořit nové klíče ] [ Zadat znovu ]

> **en** Amazon rejected the access keys
> The key `AKIA...7B2Q` doesn't exist at Amazon, or has been deactivated. You can create new keys in the AWS console under IAM.
> [ How to create new keys ] [ Enter again ]

---

**7. `ses_sandbox_restricted`** (Odeslání)

> **cs** Váš účet u Amazonu je zatím v testovacím režimu
> V něm smíte posílat jen na adresy, které si u Amazonu ověříte, a nejvýš 200 e-mailů denně. Z vašich 1 153 příjemců je ověřený 1. Uvolnění se žádá formulářem u Amazonu, schválení trvá obvykle jeden pracovní den.
> [ Otevřít formulář u Amazonu ] [ Co do formuláře napsat ]

> **en** Your Amazon account is still in test mode
> In test mode you can only send to addresses verified with Amazon, and no more than 200 emails per day. Of your 1,153 recipients, 1 is verified. You request production access through a form at Amazon, approval usually takes one business day.
> [ Open the form at Amazon ] [ What to write in the form ]

---

**8. `dns_record_not_found`** (Ověření domény)

> **cs** Záznam zatím nevidíme
> Změny v nastavení domény se obvykle projeví do 15 minut, výjimečně to trvá až 24 hodin. Kontrolujeme dál sami, stránku můžete zavřít. Až to projde, dáme vám vědět e-mailem.
> [ Zkontrolovat teď ]

> **en** We can't see the record yet
> DNS changes usually take effect within 15 minutes, occasionally up to 24 hours. We keep checking in the background, so you can close this page. We'll email you once it goes through.
> [ Check now ]

---

**9. `dns_spf_multiple_records`** (Ověření domény)

> **cs** Doména má dva SPF záznamy, to nefunguje
> Poštovní servery při dvou SPF záznamech obě ignorují a e-maily označí jako nedůvěryhodné. Doména smí mít jen jeden, ve kterém jsou všechny služby vypsané za sebou.
> Nahraďte oba tímhle jedním:
> `v=spf1 include:_spf.google.com include:amazonses.com ~all`
> [ Zkopírovat ]

> **en** Your domain has two SPF records, which doesn't work
> When there are two SPF records, mail servers ignore both and treat your emails as untrusted. A domain may only have one record, listing all services in it.
> Replace both with this single record:
> `v=spf1 include:_spf.google.com include:amazonses.com ~all`
> [ Copy ]

---

**10. `dns_record_name_duplicated`** (Ověření domény)

> **cs** Název záznamu obsahuje doménu dvakrát
> Našli jsme `x7k2m._domainkey.kolo-shop.cz.kolo-shop.cz`. Váš správce domény si doménu doplňuje sám, takže do pole s názvem patří jen `x7k2m._domainkey`.
> [ Zkopírovat správný název ]

> **en** The record name contains the domain twice
> We found `x7k2m._domainkey.kolo-shop.cz.kolo-shop.cz`. Your DNS panel appends the domain automatically, so the name field should contain only `x7k2m._domainkey`.
> [ Copy the correct name ]

---

**11. `dns_record_value_mismatch`** (Ověření domény)

> **cs** Záznam existuje, ale má jinou hodnotu
> Čekáme: `x7k2m.dkim.amazonses.com`
> Našli jsme: `x7k2m.dkim.amazonses.co`
> Liší se to na konci. Některé systémy delší hodnoty ořezávají, zkuste ji vložit znovu a zkontrolujte, že se uložila celá.
> [ Zkopírovat správnou hodnotu ]

> **en** The record exists but the value is different
> Expected: `x7k2m.dkim.amazonses.com`
> Found: `x7k2m.dkim.amazonses.co`
> The difference is at the end. Some systems truncate long values, so paste it again and check that it saved in full.
> [ Copy the correct value ]

---

**12. `campaign_domain_not_verified`** (Kampaň, kontrolní seznam)

> **cs** Kampaň zatím nejde odeslat, doména není ověřená
> Bez ověření domény by velká část e-mailů skončila ve spamu, takže odeslání blokujeme. Ověření zabere asi 10 minut a záznamy může přidat i váš správce webu.
> [ Ověřit doménu ] [ Poslat to správci webu ] [ Zapnout zkušební režim ]

> **en** This campaign can't be sent yet, the domain isn't verified
> Without domain verification a large share of your emails would land in spam, so we block sending. Verification takes about 10 minutes and your web administrator can add the records for you.
> [ Verify domain ] [ Send it to your web admin ] [ Turn on test mode ]

---

**13. `campaign_empty_audience`** (Kampaň, kontrolní seznam)

> **cs** Kampaň nemá žádné příjemce
> Vybraný segment **Aktivní zákazníci z Brna** je momentálně prázdný. Zkontrolujte jeho podmínky, nebo vyberte jiný seznam.
> [ Zobrazit segment ] [ Vybrat publikum ]

> **en** This campaign has no recipients
> The selected segment **Active customers in Brno** is currently empty. Check its conditions, or pick a different list.
> [ Show segment ] [ Choose audience ]

---

**14. `campaign_merge_tag_unknown`** (Kampaň, kontrolní seznam)

> **cs** E-mail používá údaj, který v projektu neexistuje
> V textu je doplňovaný údaj **Věrnostní body**, ale takové pole v projektu není. Nejspíš ho někdo smazal nebo přejmenoval. Bez opravy by v e-mailu zůstalo prázdné místo.
> [ Zobrazit v editoru ] [ Vytvořit pole Věrnostní body ]

> **en** The email uses a field that doesn't exist in this project
> The content contains the merge tag **Loyalty points**, but there is no such field in this project. It was probably deleted or renamed. Without a fix, the email would contain an empty gap.
> [ Show in editor ] [ Create the Loyalty points field ]

---

**15. `campaign_complaint_rate_too_high`** (Kampaň, blokující)

> **cs** Odesílání je zastavené kvůli stížnostem na spam
> Z posledních 5 000 e-mailů si 17 lidí stěžovalo, že je to spam. To je 0,34 %, Amazon toleruje 0,1 %. Při dlouhodobém překračování zablokuje celý účet a přijdete o možnost odesílat odkudkoliv.
> Nejrychlejší náprava je posílat jen lidem, kteří byli za poslední rok aktivní.
> [ Vytvořit segment Aktivní za 365 dní ] [ Zobrazit, kdo si stěžoval ]

> **en** Sending is paused because of spam complaints
> Out of your last 5,000 emails, 17 people marked them as spam. That's 0.34%, and Amazon's threshold is 0.1%. If you stay above it, Amazon will suspend your whole account and you'll lose the ability to send from anywhere, not just this tool.
> The fastest fix is to send only to people who were active in the past year.
> [ Create an "Active in 365 days" segment ] [ See who complained ]

---

**16. `quota_exceeded`** (Odeslání)

> **cs** Kampaň je větší, než kolik smíte dnes odeslat
> Váš denní limit u Amazonu je 10 000 e-mailů a dnes jste už poslali 8 400. Zbývá 1 600, kampaň má 12 480 příjemců.
> Můžete kampaň naplánovat na zítra, nebo požádat Amazon o zvýšení limitu.
> [ Naplánovat na zítra 8:00 ] [ Jak zvýšit limit ]

> **en** This campaign is larger than today's remaining allowance
> Your daily limit at Amazon is 10,000 emails and you've already sent 8,400 today. That leaves 1,600, and this campaign has 12,480 recipients.
> You can schedule it for tomorrow, or ask Amazon to raise your limit.
> [ Schedule for tomorrow 8:00 AM ] [ How to raise the limit ]

---

**17. `segment_too_complex`** (Segment builder)

> **cs** Segment má příliš mnoho podmínek
> Je jich 101 a víc než 100 jich zvládnout neumíme. Zkuste ho rozdělit na dva jednodušší a druhý postavit podmínkou "je v segmentu".
> [ Jak segment rozdělit ]

> **en** This segment has too many conditions
> It has 101 and our limit is 100. Try splitting it into two simpler segments and use the "is in segment" condition to combine them.
> [ How to split a segment ]

---

**18. `segment_count_estimated`** (Segment builder)

> **cs** Přesný počet se nepodařilo spočítat včas
> Databáze má 4,8 milionu kontaktů a tenhle dotaz je na ni náročný. **Přibližně 12 400 kontaktů**, spočítáno z odhadu databáze.
> [ Spočítat přesně ] (poběží na pozadí, dáme vědět)

> **en** We couldn't count exactly in time
> Your database has 4.8 million contacts and this query is demanding. **Approximately 12,400 contacts**, based on a database estimate.
> [ Count exactly ] (runs in the background, we'll let you know)

---

**19. `ai_no_api_key`** (AI asistent)

> **cs** AI asistent potřebuje váš vlastní klíč
> Nástroj neposílá nic do cizího cloudu, takže si musíte přinést vlastní přístup k jednomu z modelů. Klíč získáte u OpenAI, Anthropicu, Googlu nebo OpenRouteru a platíte přímo jim, obvykle jednotky korun za jeden vygenerovaný e-mail.
> [ Jak klíč získat ] [ Nastavit klíč ]

> **en** The AI assistant needs your own key
> This tool never sends anything to a cloud of ours, so you bring your own model access. You can get a key from OpenAI, Anthropic, Google, or OpenRouter and you pay them directly, typically a few cents per generated email.
> [ How to get a key ] [ Add a key ]

---

**20. `ai_provider_out_of_credit`** (AI asistent)

> **cs** Na vašem účtu u OpenAI došel kredit
> OpenAI odmítlo požadavek s tím, že účet nemá dostatek prostředků. Doplňte kredit v jejich konzoli, nebo přepněte na jiného poskytovatele.
> [ Otevřít fakturaci u OpenAI ] [ Přepnout poskytovatele ]

> **en** Your OpenAI account is out of credit
> OpenAI rejected the request because the account has insufficient funds. Add credit in their console, or switch to a different provider.
> [ Open billing at OpenAI ] [ Switch provider ]

---

**21. `brand_url_unreachable`** (Značka projektu)

> **cs** Na web jsme se nedostali
> Adresa `https://kolo-shop.cz` neodpověděla do 15 sekund. Zkontrolujte, jestli tam není překlep a jestli web funguje. Barvy a logo se dají nastavit i ručně.
> [ Zkusit znovu ] [ Nastavit ručně ]

> **en** We couldn't reach the website
> The address `https://kolo-shop.cz` didn't respond within 15 seconds. Check for typos and make sure the site is up. You can also set colors and logo manually.
> [ Try again ] [ Set manually ]

---

**22. `forbidden`**, chybí `campaigns:send` (Kampaň, role viewer)

> **cs** Na odeslání kampaně nemáte oprávnění
> Odeslání vyžaduje oprávnění `campaigns:send`, které mají role Editor, Správce a Vlastník. Vy máte roli **Prohlížející**, ta kampaně jen zobrazuje.
> Roli vám může změnit **Petr Svoboda** (Vlastník).
> [ Poslat Petrovi žádost ]

> **en** You don't have permission to send campaigns
> Sending requires the `campaigns:send` permission, which the Editor, Admin, and Owner roles have. Your role is **Viewer**, which can only view campaigns.
> **Petr Svoboda** (Owner) can change your role.
> [ Send Petr a request ]

---

**23. `session_expired`** (kdekoliv)

> **cs** Byli jste odhlášeni
> Kvůli neaktivitě jsme vás z bezpečnostních důvodů odhlásili. Přihlaste se prosím znovu, o rozdělanou práci nepřijdete.
> Heslo [ ................ ]  [ Přihlásit se ]

> **en** You've been signed out
> We signed you out after a period of inactivity for security reasons. Sign in again, your work in progress is safe.
> Password [ ................ ]  [ Sign in ]

---

**24. `contact_in_running_campaign`** (Detail kontaktu)

> **cs** Kontakt zrovna dostává e-mail
> Jana Nováková je mezi příjemci právě probíhající kampaně **Letní výprodej**. Smazat ji můžete až po dokončení rozesílky, jinak by kampaň skončila chybou.
> Rozesílka má hotovo asi za 2 minuty.
> [ Zobrazit rozesílku ] [ Odhlásit z odběru místo smazání ]

> **en** This contact is currently receiving an email
> Jana Nováková is among the recipients of the campaign **Summer Sale**, which is sending right now. You can delete her once the send finishes, otherwise the campaign would error out.
> The send should finish in about 2 minutes.
> [ Show the send ] [ Unsubscribe instead of deleting ]

---

**25. `webhook_endpoint_disabled`** (Nastavení, webhooky)

> **cs** Webhook jsme vypnuli, protože 20krát po sobě selhal
> Adresa `https://eshop.cz/hooks/mlain` od 29. 7. odpovídá chybou 500. Po dvaceti neúspěšných pokusech jsme posílání zastavili, aby se fronta nezaplnila.
> Až problém na vaší straně vyřešíte, webhook znovu zapněte. Události z doby výpadku se neposílají zpětně.
> [ Zobrazit poslední chyby ] [ Zapnout znovu ]

> **en** We disabled this webhook after 20 consecutive failures
> The endpoint `https://eshop.cz/hooks/mlain` has been returning HTTP 500 since July 29. After twenty failed attempts we stopped delivering to avoid filling the queue.
> Once you've fixed the problem on your side, re-enable it. Events from the outage period are not replayed.
> [ Show recent errors ] [ Re-enable ]

---

### 10.4 Chyby, které se uživateli nikdy neukazují surové

| Technická chyba | Co uživatel uvidí |
|---|---|
| `ECONNREFUSED`, `ETIMEDOUT` | "Nepodařilo se spojit se serverem X." plus kontext |
| SQL chyba jakéhokoliv druhu | "Něco se nepodařilo uložit." plus `request_id` a "Zkusit znovu" |
| Stack trace | nikdy, ani ve sbalených podrobnostech |
| Chyba validace ze Zodu v surové podobě | přeložená na pole a lidskou hlášku |
| Jméno interní služby, tabulky nebo sloupce | nikdy |
| Chyba SSRF ochrany s uvedením důvodu | jen "Tuhle adresu stahovat neumíme", nikdy "cílí na privátní rozsah" |

Poslední řádek je bezpečnostní: podrobná hláška by z nástroje udělala skener vnitřní sítě.

**Dvě technická pravidla, která plynou z konvencí části 1:**

1. **Klíč překladu se nesmí skládat za běhu.** Část 1 zakazuje dynamické klíče, aby šly staticky ověřit. Chybové hlášky se proto **nesmějí** adresovat jako `t('errors.' + code + '.detail')`. Místo toho je explicitní mapa `code → překladová funkce`, kterou lint zkontroluje a která u neznámého kódu spadne na `detail` ze serveru. Neznámý kód tedy nikdy neskončí prázdnou obrazovkou.
2. **Kód chyby je vidět ve sbalených podrobnostech.** Část 1 píše, že uživatel `code` nikdy nevidí a že je jen v `data-error-code`. Souhlasím pro běžný text hlášky, ale u chyby bez jasného řešení (stav S9) musí být kód **čitelně** ve sbaleném bloku vedle `request_id`, protože jinak nemá uživatel co poslat podpoře a podpora nemá podle čeho hledat. Viz R20 a vzor bloku v 7.4.

---

## 11. Přístupnost

### 11.1 Která norma platí

**Ověřeno k 2026-07-31** přímo na `w3.org/WAI/standards-guidelines/wcag/`:

| Zjištění | Stav |
|---|---|
| **WCAG 2.2 je aktuální W3C Recommendation.** Vydaná 5. října 2023, aktualizovaná 12. prosince 2024. | ověřeno |
| WCAG 2.2 **nenahrazuje ani neruší** WCAG 2.1, obě verze platí souběžně. W3C doporučuje používat nejnovější. | ověřeno |
| **WCAG 3.0 je stále jen raný pracovní návrh**, ne doporučení. Do produktu se s ní nepočítá. | ověřeno |

**Závěr: cílíme na WCAG 2.2, úroveň AA.** Shoduje se to s volbou části 1 v její kapitole 5.1 a potvrzuju ji.

**Co WCAG 2.2 přidalo oproti 2.1** a co z toho pro nás plyne prakticky:

| Kritérium | Co znamená | Kde nás to pálí |
|---|---|---|
| 2.4.11 Focus Not Obscured (Minimum), AA | Fokusovaný prvek nesmí být úplně zakrytý jiným obsahem | Sticky hlavička tabulky, systémový pruh dole, toast v levém dolním rohu. Všechny tři mohou zakrýt fokusovaný řádek nebo tlačítko. |
| 2.4.12 Focus Not Obscured (Enhanced), AAA | Nesmí být zakrytý ani částečně | Necílíme, ale je to argument pro dostatečné odsazení |
| 2.4.13 Focus Appearance, AAA | Minimální plocha a kontrast indikátoru fokusu | Necílíme, ale výchozí indikátor v design systému by měl vyhovět |
| **2.5.7 Dragging Movements, AA** | Vše, co jde tažením, musí jít i bez tažení | **Nejrizikovější kritérium pro tenhle produkt.** Editor šablon, nahrání souboru přetažením, změna šířky sloupců. Viz U→3.1. |
| 2.5.8 Target Size (Minimum), AA | Minimální velikost cílové plochy s výjimkami | Ikony akcí v řádcích tabulky, zavření toastu, ovládání bloků |
| 3.2.6 Consistent Help, A | Nápověda je na všech stránkách na stejném místě | Máme ji v hlavičce, musí tam být všude včetně průvodců |
| 3.3.7 Redundant Entry, A | Nevyžadovat podruhé to, co uživatel už zadal | Průvodce importem a nastavením odesílání, adresa odesílatele |
| 3.3.8 Accessible Authentication (Minimum), AA | Přihlášení nesmí vyžadovat kognitivní test bez alternativy, musí jít použít správce hesel | Zákaz blokování vložení do pole s heslem. Pokud bychom kdy zaváděli CAPTCHA na veřejné formuláře, musí mít alternativu. |
| 3.3.9 Accessible Authentication (Enhanced), AAA | Přísnější varianta | Necílíme |
| Odstraněno: 4.1.1 Parsing | Kritérium bylo ve 2.2 vypuštěno jako obsolete | Nic neděláme, jen to nemá být v kontrolních seznamech |

### 11.2 Legislativní kontext

Tohle není právní posouzení. Stejně jako u GDPR v kapitole 9 hlavní specifikace platí, že finální posouzení patří odborníkovi. Uvádím, co jsem ověřil, a výslovně označuju, co jsem ověřit nedokázal.

| Předpis | Co o něm vím | Stav ověření |
|---|---|---|
| **Směrnice (EU) 2019/882, European Accessibility Act** | Zavádí požadavky na přístupnost vybraných výrobků a služeb v EU. Pro tenhle produkt je podstatné, že dopadá spíš na **provozovatele instalace** než na nás jako na autory open-source softwaru, a že rozhoduje, komu ten provozovatel své služby poskytuje. | **NEOVĚŘENO.** Text směrnice se mi nepodařilo z EUR-Lexu načíst. Přesné datum účinnosti, rozsah dopadu na B2B software a výjimku pro mikropodniky je nutné ověřit s právníkem. |
| **EN 301 549** | Evropská harmonizovaná norma pro přístupnost ICT, která v praxi odkazuje na WCAG. | **NEOVĚŘENO** (aktuální verze a přesná vazba na úroveň WCAG). |
| **Směrnice (EU) 2016/2102** a její česká implementace | Týká se webů a aplikací veřejného sektoru. Relevantní pro nás nepřímo: pokud si nástroj nasadí státní instituce, dopadne na ni. | **NEOVĚŘENO** (aktuální znění českého zákona). |
| **Prohlášení o přístupnosti** | Dokument popisující, nakolik je aplikace přístupná, co není a jak nahlásit problém. | **NEOVĚŘENO**, zda je povinné pro tenhle typ produktu. |

**Praktický závěr, který nezávisí na tom, jak dopadne právní posouzení:**

1. **Cílíme na WCAG 2.2 AA v celé aplikaci.** Je to obhajitelná laťka bez ohledu na to, která směrnice nakonec dopadne, a je to zároveň to, co dělá aplikaci použitelnou.
2. **Veřejné stránky** (odhlášení, nastavení odběru, potvrzení přihlášení, vložené formuláře) drží stejnou laťku a navíc fungují bez JavaScriptu. Ty vidí koncoví lidé, takže je u nich riziko největší.
3. **Prohlášení o přístupnosti** dodáme jako šablonu stránky v aplikaci, kterou si provozovatel doplní. Stojí to hodinu práce a provozovateli, na kterého povinnost dopadne, to ušetří starost. Viz U→1.11.
4. **Do dokumentace napíšeme, na jakou úroveň cílíme a co víme, že nesplňujeme.** Poctivé prohlášení je pro provozovatele cennější než mlčení, protože si podle něj může udělat vlastní posouzení.

Otázka O15 v kapitole 19 tohle nechává na zadavateli, protože rozsah práce se liší podle toho, jestli je cílem "použitelné pro každého" nebo "doložitelně v souladu s normou".

### 11.3 Konkrétní požadavky na tento produkt

Obecné požadavky jsou v normě. Tady jsou ty, které se týkají přesně toho, co stavíme, a které se dají porušit, aniž si toho někdo všimne.

#### Klávesnice

| Požadavek | Kde je to nejrizikovější |
|---|---|
| Každá akce dostupná myší je dostupná i z klávesnice | **Editor šablon.** Přesun bloku tažením myší musí mít protějšek v nabídce bloku. Bez toho je editor pro část uživatelů nepoužitelný. Viz U→3.1. |
| Nikde nevzniká past na fokus (dá se dostat dovnitř i ven) | Editor, náhled v iframe, vložený formulář |
| Pořadí fokusu odpovídá vizuálnímu pořadí | Vícesloupcové rozvržení editoru a segment builderu |
| Fokus je vždy viditelný a není zakrytý | Sticky hlavička tabulky, systémový pruh dole, toast v levém dolním rohu |
| Fokus se po zavření dialogu vrací na spouštěč | Všechny potvrzovací dialogy |
| Fokus se po přechodu kroku průvodce přesune na nadpis kroku | Import, nastavení odesílání |
| Fokus po odeslání formuláře s chybou skočí na první chybné pole | Všechny formuláře |
| Tažení má vždy alternativu | Editor (bloky), tabulka (šířky sloupců), nahrání souboru |

#### Barva a kontrast

| Požadavek | Kde je to nejrizikovější |
|---|---|
| Stav se nikdy nesděluje jen barvou | Stavy DNS záznamů, stavy kampaně, **šest stavů kontaktu plus tři příznaky**, položky kontrolního seznamu, prahy v reportu. Všude je k barvě ikona **a slovo**. |
| Grafy jsou čitelné bez rozlišení barev | Report kampaně. Řešení: vzory nebo popisky přímo u dat, plus tabulka s hodnotami pod grafem. |
| Kontrast textu a interaktivních prvků splňuje normu | Ztlumené texty ("aktualizováno před 8 hodinami" u zastaralého počtu segmentu) jsou nejčastější porušení. Ztlumený neznamená nečitelný. |
| Tmavý režim splňuje kontrast stejně jako světlý | Kontroluje se zvlášť, protože se často opomíjí |
| Barevný proužek projektu není jediný rozlišovací znak | Vedle proužku je vždy název projektu textem |

#### Dynamický obsah

| Požadavek | Realizace |
|---|---|
| Změna stavu se oznámí čtečce | Mapování v 5.10 |
| Živě se měnící čísla neruší | Průběh se oznamuje po čtvrtinách, ne každou sekundu |
| Automatické obnovování jde zastavit | Na obrazovce průběhu je přepínač "Pozastavit živé aktualizace" |
| Animace respektují `prefers-reduced-motion` | Odpočet u toastu se změní na statické číslo, průběhové pruhy neanimují, přechody se vypnou |
| Toast se nezavírá tak rychle, aby ho nešlo přečíst | 6 s u informace, chyba nikdy, "Vrátit zpět" 10 s s viditelným odpočtem a pozastavením při fokusu |

#### Formuláře

| Požadavek | Poznámka |
|---|---|
| Každé pole má viditelný popisek | Placeholder místo popisku je zakázaný, protože po začátku psaní zmizí |
| Popisek je svázaný s polem | `label for` nebo obalení |
| Chyba je svázaná s polem | `aria-describedby` a `aria-invalid` |
| Povinnost je uvedená textem, ne jen hvězdičkou | "(povinné)" nebo označit nepovinná pole, což je u našich formulářů lepší, protože povinných je většina |
| Údaje se po chybě neztrácejí | Viz P10 |
| Údaje, které uživatel už jednou zadal, se nevyžadují znovu | Například adresa odesílatele se předvyplní z nastavení projektu |
| Přihlášení funguje se správcem hesel a s vložením ze schránky | Zákaz vkládání do pole s heslem je zakázaný |

#### Cílové plochy

| Požadavek | Poznámka |
|---|---|
| Interaktivní prvky mají dostatečnou klikací plochu | Nejrizikovější místa: ikony akcí v řádku tabulky, tlačítko zavření toastu, ovládání bloku v editoru, ✕ u podmínky segmentu |
| Prvky blízko sebe mají mezeru | Řádek tabulky s pěti ikonami vedle sebe |
| Destruktivní akce není bezprostředně vedle běžné | "Smazat" není hned vedle "Duplikovat" |

#### Obsah odesílaných e-mailů

Přístupnost e-mailu, který nástroj vyrobí, je zodpovědnost nástroje, ne uživatele. Uživatel o tom nic neví a vědět nemusí.

| Požadavek | Jak to zařídíme |
|---|---|
| Layoutové tabulky jsou označené jako dekorativní | Renderer (část 3) vkládá `role="presentation"` automaticky |
| E-mail má uvedený jazyk | `lang` podle jazyka projektu nebo kontaktu, doplňuje renderer |
| Obrázky mají alternativní popis | Editor upozorní, kontrolní seznam kampaně varuje, AI umí popis navrhnout. Dekorativní obrázek se označí zaškrtávátkem "Jen ozdoba". |
| Text má dostatečnou velikost a kontrast | Výchozí šablona to má nastavené. Editor varuje, když uživatel zvolí kombinaci s nízkým kontrastem, a nabídne nejbližší vyhovující odstín. |
| Textová verze není prázdná ani nesmyslná | Kontrolní seznam kampaně varuje u verze kratší než 30 slov |
| Odkazy mají smysluplný text | Varování u odkazu s textem "zde", "klikněte sem", "více" |
| E-mail se dá číst i bez obrázků | Výchozí šablona nemá text v obrázcích |

Varování na kombinaci barev s nízkým kontrastem přímo v editoru je jediný způsob, jak to skutečně ovlivnit. Edukací uživatele to nepůjde.

### 11.4 Jak se to ověřuje

Tři vrstvy. Žádná z nich sama nestačí a je důležité vědět, co která nezachytí.

#### Vrstva 1: automatické testy v CI

| Nástroj | Verze | Licence | Poslední aktualizace | Stažení týdně | Role |
|---|---|---|---|---|---|
| `axe-core` | 4.12.1 | **MPL-2.0** | 2026-07-30 | 63 050 596 | Jádro kontroly |
| `@axe-core/playwright` | 4.12.1 | **MPL-2.0** | 2026-07-27 | 7 514 061 | Napojení na E2E testy |
| `eslint-plugin-jsx-a11y` | 6.10.2 | MIT | 2024-10-26 | 44 122 360 | Statická kontrola při psaní |
| `lighthouse` | 13.4.1 | Apache-2.0 | 2026-07-29 | 4 058 066 | Volitelně, spíš na výkon |

Vše ověřeno k 2026-07-31 přes `npm view` a `api.npmjs.org`.

**Licenční nález, který je potřeba rozhodnout: `axe-core` je pod MPL-2.0**, což není na seznamu povolených licencí (MIT, Apache-2.0, BSD, ISC). MPL-2.0 je slabý copyleft na úrovni souboru, ne na úrovni celého díla, a `axe-core` je **vývojová závislost**, která se nedistribuuje s produktem. Licenční konflikt s MIT distribucí tedy nevzniká. **Ale licenční brána v CI, jak ji popisuje kapitola 9 hlavní specifikace, na tom spadne.** Požadavek na část 1: brána musí rozlišovat `dependencies` a `devDependencies` a pro vývojové závislosti mít vlastní, širší seznam s výslovným zdůvodněním u každé výjimky.

**`pa11y` nepoužíváme.** Ověřeno: verze 9.1.1, licence **LGPL-3.0-only**. LGPL je v tomhle projektu výslovně zakázaná a náhrada za něj (`axe-core` v Playwrightu) pokrývá totéž.

**Co automat zachytí a co ne.** Automatické kontroly spolehlivě najdou chybějící `alt`, chybějící popisky formulářů, nedostatečný kontrast, chybějící `lang`, duplicitní `id` a špatné role. **Nezachytí** právě to, co je v tomhle produktu nejrizikovější: jestli se dá editor ovládat z klávesnice, jestli má tažení alternativu, jestli je pořadí fokusu smysluplné, jestli je hláška srozumitelná a jestli obrázek s `alt="obrázek"` má užitečný popis. Podíl problémů, které automat najde, se běžně uvádí jako menšinový, ale konkrétní číslo neuvádím, protože jsem ho neověřil z primárního zdroje.

**Praktický důsledek:** zelený automatický test **není doklad přístupnosti**. Je to doklad, že nejsou hrubé chyby. Proto vrstvy 2 a 3.

#### Vrstva 2: ruční průchod

Kontrolní seznam v 11.5 vyplňuje autor u každé nové obrazovky. Je krátký schválně, protože dlouhý se nevyplňuje.

Nad rámec toho jednou za vydání ruční průchod klíčových obrazovek z kapitoly 8, celý bez myši. Odhad 45 minut.

#### Vrstva 3: čtečka obrazovky

| Kombinace | Kdy |
|---|---|
| VoiceOver a Safari na macOS | Při každém vydání, protože ji máme po ruce |
| NVDA a Firefox na Windows | Při každém vydání s významnou změnou rozhraní |
| VoiceOver a Safari na iOS | U mobilně podporovaných obrazovek (report, detail kontaktu, průběh rozesílky) |

**NEOVĚŘENO:** podíly jednotlivých čteček podle průzkumu WebAIM. Uvedený výběr je odhad podle běžné praxe, ne doložený fakt. Před finalizací dohledat aktuální edici průzkumu.

**Minimální scénář se čtečkou**, který musí projít vždy:

1. Přihlásit se.
2. Najít kontakt přes globální vyhledávání a otevřít jeho detail.
3. Vytvořit kampaň, vybrat šablonu, vybrat publikum.
4. Projít kontrolní seznam připravenosti a slyšet, co blokuje.
5. Odeslat kampaň a slyšet, že se odeslala.
6. Otevřít report a přečíst tři hlavní čísla včetně jmenovatelů.

Když tenhle scénář projde, produkt je použitelný. Když neprojde, žádný počet zelených automatických testů to nezachrání.

### 11.5 Kontrolní seznam obrazovky

Vyplňuje se u každé nové obrazovky před sloučením. Je krátký schválně, aby se skutečně vyplňoval.

- [ ] Projdu obrazovku celou jen klávesnicí a dostanu se ke každé akci
- [ ] Fokus je vždy vidět a nic ho nezakrývá
- [ ] Zoom na 200 % nerozbije rozvržení a nic se neztratí
- [ ] Vypnu barvy (režim odstínů šedi) a stavy jsou pořád rozeznatelné
- [ ] Každá informace nesená barvou má i ikonu nebo slovo
- [ ] Každé pole formuláře má viditelný popisek
- [ ] Chybová hláška je svázaná s polem a jde z ní jednat
- [ ] Změna stavu se ohlásí čtečce (`role="status"` nebo `role="alert"`)
- [ ] Dialog má správu fokusu a zavírá se `Esc`
- [ ] Prázdný stav, načítání a chyba jsou implementované
- [ ] Texty jsou v obou jazycích a používají ICU `plural` včetně kategorie `=0`
- [ ] Automatický test a11y na téhle obrazovce je zelený

---

## 12. Lokalizace

Čeština a angličtina od prvního dne, ne jako dodatečná vrstva. Nástroj se dodává do českého prostředí a zároveň má být použitelný jako mezinárodní open-source projekt, takže druhý jazyk není luxus, je to podmínka přijetí.

### 12.1 Tři nezávislé jazykové osy

Nejčastější chyba v lokalizovaných marketingových nástrojích je slepení tří různých věcí do jednoho nastavení. Tady jsou oddělené:

| Osa | Kde se nastavuje | Co ovlivňuje | Příklad |
|---|---|---|---|
| **Jazyk rozhraní** | profil uživatele (`users.locale`) | Menu, tlačítka, chyby, nápovědu | Petr má rozhraní anglicky, Jana česky, oba v jednom projektu |
| **Jazyk odesílaných e-mailů** | nastavení projektu (`workspaces.locale`) | Výchozí šablony, potvrzovací a odhlašovací e-maily a stránky, `contact.greeting` | Projekt posílá česky, i když v něm pracuje Angličan |
| **Jazyk kontaktu** | pole kontaktu (`contacts.locale`, nepovinné) | Který jazyk se použije pro tenhle konkrétní e-mail | Slovenský zákazník v české databázi |

Jazyk rozhraní se předvyplní z hlavičky `Accept-Language` (jen při registraci, podle 3.9 části 1), dá se změnit v profilu a je v cestě jako prefix `/{locale}/` s `localePrefix: 'as-needed'`.

**Výběr jazyka systémových e-mailů** se řídí kaskádou z části 1: `contacts.locale` nebo `users.locale` → `workspaces.locale` → `DEFAULT_LOCALE` → `en`.

### 12.2 Délka textů

České texty jsou obvykle o 10 až 30 % delší než anglické, u tlačítek často víc ("Save" versus "Uložit změny"). Důsledky jsou konstrukční, ne překladatelské:

| Pravidlo | Vysvětlení |
|---|---|
| Žádné pevné šířky na popisky a tlačítka | Layout se řídí obsahem, ne pixely |
| Žádný text v obrázcích | Nejde přeložit |
| Tlačítka se nezalamují uprostřed slova, ale zalomit se smějí | Dvouřádkové tlačítko je lepší než oříznuté |
| Hlavičky tabulek smějí být kratší než plný název, s plným názvem v `title` | "Míra prokl." není přijatelné, "Prokliky" ano |
| Nikdy neskládáme věty z fragmentů | "Smazat" + " " + počet + " " + "kontaktů" nefunguje v jazycích s jinou skladbou. Vždy celá zpráva s parametry. |
| Pro čísla v textu vždy ICU `plural` | Viz níž |

### 12.3 Pluralizace

Čeština má čtyři formy, angličtina dvě. Ruční `if (n === 1)` je zaručená chyba.

```
cs: "{count, plural, =0 {Žádné kontakty} one {# kontakt} few {# kontakty} many {# kontaktu} other {# kontaktů}}"
    0 → Žádné kontakty · 1 kontakt · 2 kontakty · 5 kontaktů · 1,5 kontaktu

en: "{count, plural, =0 {No contacts} one {# contact} other {# contacts}}"
    0 → No contacts · 1 contact · 2 contacts · 5 contacts
```

**Kategorie `=0` je povinná** všude, kde se počet objevuje v prázdném stavu. Přebírám to z konvence části 1 a souhlasím s jejím odůvodněním: "0 kontaktů" a "Žádné kontakty" nejsou totéž. První je údaj, druhé je věta. Bez toho vzniknou texty jako "0 kontaktů se nepodařilo naimportovat" místo "Všechny řádky se naimportovaly".

**Kategorie `many` je v češtině pro desetinná čísla** (1,5 kontaktu), ne pro velké počty. Musí být vyplněná, jinak desetinné hodnoty spadnou na `other`. V tomhle produktu se desetinná čísla u počtů objeví jen výjimečně (průměry v reportu), ale objeví se.

**Časté případy, které se v tomhle produktu vyskytnou:**

| Situace | cs |
|---|---|
| Počet kontaktů | Žádné kontakty / 1 kontakt / 2 kontakty / 5 kontaktů |
| Počet e-mailů | 1 e-mail / 2 e-maily / 5 e-mailů |
| Počet dní | 1 den / 2 dny / 5 dní |
| Počet minut | 1 minuta / 2 minuty / 5 minut |
| Počet kampaní | 1 kampaň / 2 kampaně / 5 kampaní |
| Počet řádků | 1 řádek / 2 řádky / 5 řádků |
| Počet skupin ve frontě oslovení | 1 skupina / 2 skupiny / 5 skupin |
| Sloveso v minulém čase s počtem | "Otevřel 1 člověk" / "Otevřeli 2 lidé" / "Otevřelo 5 lidí" |

Poslední řádek je past, na kterou se často zapomíná: v češtině se s číslem mění nejen podstatné jméno, ale i sloveso. Řešení je `plural` nad celou větou, ne jen nad podstatným jménem.

**Rody ve větách o kontaktu.** Časová osa a hlášky o konkrétním kontaktu používají rod z pole `gender`:

```
cs: "{gender, select, female {Otevřela} male {Otevřel} other {Otevření}} kampaň {campaign}"
    female → "Otevřela kampaň Letní výprodej"
    male   → "Otevřel kampaň Letní výprodej"
    other  → "Otevření kampaně Letní výprodej"
```

Neutrální varianta je podstatné jméno, ne mužský rod. "Otevřel" u kontaktu s neznámým rodem je chyba, protože polovina kontaktů jsou ženy.

### 12.4 Formáty

Formátování se **nikdy** neskládá ručně, vždy přes `Intl` zprostředkované `next-intl` (`useFormatter`), podle konvence 3.9 části 1. Nikdy ruční `toLocaleString` s natvrdo zadaným locale.

| Co | API | cs | en |
|---|---|---|---|
| Číslo | `Intl.NumberFormat` | 12 480 | 12,480 |
| Procento | `Intl.NumberFormat` se `style: 'percent'` | 16,4 % | 16.4% |
| Měna | `Intl.NumberFormat` se `style: 'currency'` | 24 980 Kč | CZK 24,980 |
| Datum | `Intl.DateTimeFormat` | 31. 7. 2026 | July 31, 2026 |
| Relativní čas | `Intl.RelativeTimeFormat` | před 4 minutami | 4 minutes ago |
| Seznam | `Intl.ListFormat` | Praha, Brno a Ostrava | Prague, Brno, and Ostrava |
| Trvání | `Intl.DurationFormat` s fallbackem | 4 min 12 s | 4 min 12 sec |

**Časové zóny přebírám z části 1** (její 3.9) a doplňuju k nim jedno pravidlo pro rozhraní:

| Kontext | Zóna | Zdroj |
|---|---|---|
| Běžné časy v UI (kdy byl kontakt naposledy aktivní, kdy proběhl import) | `users.timezone` | část 1 |
| Reporty a exporty vázané k projektu | `workspaces.timezone` | část 1 |
| Hodnoty v `render_data` pro sender | `workspaces.timezone`, převedeno už při materializaci | část 1 |
| API a databáze | vždy UTC, ISO 8601 se `Z` | část 1 |
| **Naplánované odeslání kampaně** | **vždy `workspaces.timezone`** | doplňuju já |

Poslední řádek je nutné doplnění. Kampaň naplánovaná na 8:00 musí znamenat 8:00 v zóně projektu, ať ji plánuje kdokoliv odkudkoliv, jinak dva kolegové v různých zemích naplánují dvě různé věci. Když se `users.timezone` liší od `workspaces.timezone`, u času je poznámka: "8:00 v zóně projektu (Europe/Prague), u vás 2:00". Totéž platí pro okno na zrušení a pro čas odeslání v reportu.

### 12.5 Řazení a vyhledávání s diakritikou

Dvě různé věci, které se často pletou.

**Řazení** musí respektovat českou abecedu. Klíčové je, že `ch` je v češtině samostatné písmeno řazené za `h`, takže "Chalupa" patří za "Hruška" a před "Ilona". Standardní bajtové řazení to nezvládne.

| Vrstva | Řešení |
|---|---|
| PostgreSQL | Sloupce s texty ke třídění mají `COLLATE "cs-CZ-x-icu"` (ICU kolace) |
| JavaScript | `Intl.Collator('cs')` pro řazení v prohlížeči |
| Ověření | Test s posloupností: Cimrman, Čapek, Dvořák, Havel, Chalupa, Ilona, Řezník, Sova, Šimek, Žák. Správné pořadí musí sedět přesně. |

**Vyhledávání** musí naopak diakritiku ignorovat, a to v obou směrech:

| Uživatel napíše | Musí najít |
|---|---|
| `novak` | Novák, Nováková, novak |
| `Novák` | Novak, novák |
| `zizkov` | Žižkov |
| `SVOBODA` | Svoboda |
| `jana@` | jana@firma.cz |

Realizace: rozšíření `unaccent` v Postgresu plus trigramový index nad `unaccent(lower(...))`. Vlastní tato část jen požadavek, implementaci vlastní část 2. Pozor na konfigurační proměnnou `CONTACT_SEARCH_INDEX_ENABLED` z části 2: při `false` umí hledání jen prefix, což musí být v rozhraní vidět jako poznámka u vyhledávacího pole, ne jako tiché zhoršení.

**Řazení není totéž co hledání.** Řazení musí rozlišovat (Čapek za Cimrmanem), hledání nesmí (`capek` najde Čapka). Použití stejné funkce na obojí je chyba, která se projeví až v provozu.

### 12.6 Co se nepřekládá

| Prvek | Zůstává v originále | Důvod |
|---|---|---|
| Názvy DNS záznamů (CNAME, TXT, `_domainkey`) | ano | Uživatel je opisuje do cizího systému |
| Hodnoty SPF a DMARC | ano | Musí sedět znak po znaku |
| Názvy poskytovatelů (Amazon SES, WEDOS, Cloudflare) | ano | Vlastní jména |
| Kódy chyb (`smtp_auth_failed`) | ano | Strojově čitelné |
| Názvy polí v běžném exportním CSV | **ne**, překládají se podle jazyka uživatele | Uživatel otevírá CSV v Excelu |
| **Hlavička v `errors.csv` u importu** | **ano, nepřekládá se nikdy** | Soubor má **stejnou hlavičku, kódování i oddělovač jako původní vstup**, aby ho uživatel opravil a nahrál zpátky bez přemapování (část 2, 4.6.11). Kdyby se hlavička přeložila, automapování by při opětovném nahrání selhalo a smysl funkce by zmizel. Přidané sloupce `_error_code` a `_error_detail` zůstávají anglicky, protože `_error_code` je strojový a `_error_detail` je text, který uživatel jen čte. |
| Názvy vlastních polí | ne, jsou to data uživatele | |
| Merge tagy v šabloně | technicky ne, ale v editoru se zobrazují jako přeložené žetony | Viz 8.5.1 |

Poslední řádek je zajímavý: v uloženém dokumentu je `{{ contact.first_name_vocative }}`, v editoru se to uživateli zobrazuje jako `{5. pád jména}` a v anglickém rozhraní jako `{First name, vocative}`. Šablona se tím nemění, mění se jen zobrazení.

### 12.7 Překlad e-mailů odesílaných systémem

Systémové e-maily mají dvě různé cílové skupiny a řídí se různými jazyky:

| E-mail | Jazyk podle |
|---|---|
| Potvrzovací e-mail k přihlášení (double opt-in) | `contacts.locale` → `workspaces.locale` |
| Odhlašovací stránka a stránka s nastavením odběru | `contacts.locale` → `workspaces.locale` |
| Upozornění "kampaň je odeslaná" | `users.locale` toho, komu se posílá |
| Upozornění "odesílání zablokováno" | `users.locale` |
| Upozornění "za 3 dny odhlásíme 1 842 kontaktů" | `users.locale` |
| Pozvánka do projektu | `users.locale` zvoucího, s odkazem na přepnutí |

Systémové e-maily jsou podle 3.9 části 1 uložené jako **blokové šablony** s klíčem `system.<name>` a `locale`, ne jako řetězce v katalozích. Je to jiný mechanismus než rozhraní a nesmí se to splést.

### 12.8 Příprava na další jazyky

| Vlastnost | Rozhodnutí |
|---|---|
| Formát katalogů | **Vnořený JSON, klíče `camelCase`, jmenné prostory podle domény**, ICU MessageFormat v hodnotách. Umístění `packages/i18n/messages/{locale}.json`. Přebírám z části 1, můj původní návrh plochých klíčů s tečkami jsem opustil. |
| Zdroj pravdy | `en.json`. `cs.json` musí mít stejnou množinu klíčů, hlídá CI job `i18n-check`. Přebírám z části 1. |
| Skládání klíčů za běhu | **Zakázané.** Klíč se v kódu píše plnou cestou, aby ho šlo staticky ověřit a extrahovat. Přebírám z části 1. Má to jeden důsledek pro mě: chybové hlášky se nesmějí adresovat jako `t('errors.' + code + '.detail')`, viz 10.4. |
| Chybějící překlad | Fallback na `en`, v produkci poslední segment klíče plus log `i18n_missing_key`, v dev a v testech výjimka. Přebírám z části 1. |
| Přidání jazyka | Soubor `messages/xx.json` a záznam do `SUPPORTED_LOCALES`. Žádná změna kódu. Jazyky bez vokativu řeší část 2. |
| Kandidáti na další jazyky | Slovenština (levná, vokativ i skloňování už řešíme), polština, němčina |
| RTL jazyky | Zatím ne. Vyžadovalo by logické vlastnosti v CSS napříč celou aplikací. Zapsáno jako vědomé odložení, ne opomenutí. |
| Překlad komunitou | Katalogy jsou obyčejný JSON v repozitáři, pull request s novým jazykem je vítaný. Jazyk se považuje za podporovaný teprve při 100 % pokrytí klíčů. |

---

## 13. Požadavky na design systém a komponenty

Volbu knihovny vlastní část 1. Tato kapitola říká, **co ta volba musí unést**, a doplňuje mé doporučení s ověřenými fakty.

### 13.1 Sedm komponent, na kterých se to láme

Devadesát procent aplikace postaví jakákoliv rozumná knihovna. Rozhodují tyhle:

| # | Komponenta | Kde ji potřebujeme | Tvrdé požadavky |
|---|---|---|---|
| K1 | **Datová tabulka** | kontakty, kampaně, události, blokované adresy | 200 řádků na stránce plynule; výběr řádků včetně rozsahu `Shift + klik`; výběr přežije přestránkování a je vidět jeho velikost; nastavitelné a ukládané sloupce; **kurzorové** stránkování bez čísel stránek; serverové řazení jen podle povolených `order` hodnot; klávesová navigace po řádcích; korektní role a `aria-rowcount` i při virtualizaci; sticky hlavička |
| K2 | **Query builder** | segmenty | Vnořené skupiny **do hloubky 5** a 50 potomků; přepínač všechny/alespoň jednu **plus negace** na každé skupině; operátory podle typu pole z matice části 2; plná klávesová obsluha včetně přidání a odebrání podmínky; volitelné zobrazení podkladového JSON |
| K3 | **Vícekrokový průvodce** | import, nastavení odesílání, ověření domény | Krok v URL; **návrat, který smí být destruktivní a musí to říct**; správa fokusu při přechodu; ohlášení změny kroku čtečce; stav "rozdělaný průvodce" po návratu s vypršením po 24 hodinách |
| K4 | **Nahrání souboru** | import, obrázky, logo | Přetažení i výběr; průběh nahrávání; velké soubory (200 MB) po částech; zrušení; klávesová alternativa k přetažení (**povinná**) |
| K5 | **Toast a oznámení** | celá aplikace | Fronta a nejvýš tři naráz; slučování duplicit; odpočet u akce "Vrátit zpět"; pozastavení při hoveru i fokusu; `role="status"` versus `role="alert"`; zavření z klávesnice; nezavírání chyb samo |
| K6 | **Náhled e-mailu** | editor, kampaň | Izolace stylů e-mailu od stylů aplikace (iframe se `sandbox`); přepínání šířky; tmavý režim; bez odchozích požadavků na cizí zdroje |
| K7 | **Grafy** | report, dashboard doručitelnosti | Textová alternativa k datům (tabulka pod grafem); čitelnost bez rozlišení barev; klávesová dostupnost hodnot; tooltip dostupný i z klávesnice |

Dvě z nich (K4 a K1) mají v požadavcích slovo "povinná" u klávesové alternativy. Není to zdvořilost, je to podmínka souladu s WCAG 2.2, viz 11.3.

**Část 2 si v 11.5 vyžádala čtyři komponenty** a všechny jsou pokryté: vícekrokový průvodce (K3), tabulka s hromadným výběrem přežívajícím přestránkování (K1), vizuální query builder s vnořenými skupinami (K2) a veřejné stránky mimo layout aplikace fungující bez JavaScriptu (8.9).

### 13.2 Doporučení

**Potvrzuji volbu Tailwind CSS 4 plus shadcn/ui** z hlavní specifikace i z části 1. Ověřená fakta a odůvodnění:

| Ověřeno k 2026-07-31 | Zjištění |
|---|---|
| `tailwindcss` | 4.3.3, MIT, aktualizováno 2026-07-31, 117 285 467 stažení týdně |
| `shadcn` (CLI) | 4.16.0, MIT, aktualizováno 2026-07-27, 7 275 196 stažení týdně |
| `radix-ui` (základ shadcn/ui) | 1.6.7, MIT, aktualizováno **2026-07-30**, 11 443 028 stažení týdně |
| `lucide-react` | 1.28.0, ISC, aktualizováno 2026-07-30, 82 475 475 stažení týdně |

**Tři důvody pro:**

1. **shadcn/ui není závislost, je to zdrojový kód v našem repozitáři.** CLI komponentu zkopíruje, my ji vlastníme a můžeme ji upravit. Pro produkt, jehož požadavky na zpětnou vazbu (kapitola 5.4) přesahují to, co dává jakákoliv knihovna z krabice, je to výhoda, ne kompromis.
2. **Radix je živý.** Byly obavy o jeho údržbu, ale ověřený stav k dnešku je vydání ze včerejška a jedenáct milionů stažení týdně. Riziko opuštěného projektu se nepotvrdilo.
3. **Tailwind 4 je stabilní a shadcn na něm běží.** Není potřeba čekat ani zůstávat na v3.

**Zvážené alternativy a proč jsem je nedoporučil:**

| Alternativa | Ověřený stav | Verdikt |
|---|---|---|
| **Base UI** (`@base-ui-components/react`) | 1.0.0-**rc.0**, MIT, 2026-07-15, 407 692 stažení týdně | **Ne pro MVP 0.** Je to release candidate, ne stabilní vydání. Na produkt, který se staví na hackathonu, se nesází na knihovnu, která ještě nevydala jedničku. |
| **React Aria Components** (`react-aria-components`) | 1.19.0, Apache-2.0, 2026-07-31, 3 695 499 stažení týdně | **Ne, i když je to z hlediska přístupnosti nejsilnější kandidát.** Cena je jiný stylovací model, strmější křivka učení a menší ekosystém hotových vzorů. **Ponechávám jako doporučení pro jednotlivé komponenty**, u kterých se ukáže, že Radix nestačí, protože obojí jde v jedné aplikaci kombinovat. |
| `@mantine/core`, `@chakra-ui/react`, `@heroui/react`, `antd`, `@mui/material` | neověřoval jsem podrobně | Ne. Všechny přinášejí vlastní stylovací systém, který se s Tailwindem tluče. |

**Konkrétní volby pro sedm rizikových komponent:**

| # | Volba | Ověřeno | Poznámka |
|---|---|---|---|
| K1 tabulka | `@tanstack/react-table` 8.21.3 (MIT, 2026-07-31, 17 676 279/týden) plus `@tanstack/react-virtual` 3.14.9 (MIT, 2026-07-28, 20 734 158/týden) | ano | Headless, takže si vykreslení a tím i přístupnost píšeme sami. To je u tabulky výhoda: hotové gridy mají přístupnost, kterou nejde opravit. Headless zároveň znamená, že kurzorové stránkování bez čísel stránek není problém, kdežto hotový grid s číslovanou paginací by se musel přemlouvat. **Odmítnuto:** `ag-grid-community` 36.0.2 (MIT, ověřeno) a `@mui/x-data-grid` 9.10.1 (MIT, ověřeno). |
| K2 query builder | `react-querybuilder` 8.21.2 (MIT, 2026-07-27, 391 251/týden) **s povinnými přepisy** | ano | Použitelné, ale jeho výchozí vzhled je přesně to, čemu se v 8.4.2 vyhýbám. Povinné přepsat: přepínač skupiny na větu, odstranit popisky AND a OR, přidat ovládání negace, vlastní výběr pole se skupinami, vlastní patička s počtem a vzorkem. **Kritérium pro odchod:** knihovna musí zvládnout hloubku 5 a všech 40 operátorů z matice části 2. Když ne, postavit vlastní nad AST. Rozpočet: den s knihovnou, půldruhého dne bez ní. |
| K3 průvodce | vlastní nad `shadcn/ui` | | Naše požadavky (krok v URL, destruktivní návrat, 24hodinová životnost rozpracovaného stavu) jsou specifické. |
| K4 nahrání souboru | `react-dropzone` 19.1.1 (MIT, 2026-07-19, 12 604 495/týden) | ano | Zvládá přetažení i výběr přes klávesnici. Nahrávání po částech si píšeme sami. |
| K5 toast | `sonner` 2.0.7 (MIT, 2025-08-02, 43 829 989/týden) **jako základ, s vlastní vrstvou** | ano | **Riziko: poslední vydání je skoro rok staré.** Naše požadavky z 5.4 žádná knihovna z krabice nemá, takže tak jako tak píšeme vlastní obal. Záložní plán: postavit toast na Radix Toast. |
| K6 náhled e-mailu | **žádná knihovna**, obyčejný `<iframe sandbox srcdoc>` | | `react-frame-component` 5.3.2 (MIT, ověřeno) je pro náhled statického HTML zbytečný. Iframe se `sandbox` je zároveň bezpečnostní opatření. |
| K7 grafy | `recharts` 3.10.1 (MIT, 2026-07-25, 49 405 294/týden) | ano | Deklarativní, dobře se do něj doplňuje textová alternativa. |

**Riziko stárnutí několika balíčků.** Tři z doporučených (`sonner`, `cmdk`, `@dnd-kit/core`) mají poslední vydání staré rok nebo víc. U všech tří jde o malé, funkčně hotové knihovny s miliony stažení, takže to samo o sobě není důvod k odmítnutí. Je to ale důvod je držet za vlastním rozhraním. U `@dnd-kit` navíc platí, že tažení bloků v editoru přichází s EmailBuilder.js (část 3), takže ho v MVP 0 nejspíš nepotřebujeme vůbec.

---

## 14. Výkon rozhraní

Rozhraní, které je pomalé, není přístupné ani pochopitelné, protože uživatel ztratí souvislost mezi akcí a následkem.

### 14.1 Rozpočty odezvy

| Interakce | Cíl | Nejhorší přijatelné | Co se stane při překročení |
|---|---|---|---|
| Reakce na stisk klávesy, přepnutí záložky | do 100 ms | 200 ms | Bez indikace se to jeví jako zaseknutí |
| Otevření stránky se seznamem (první obsah) | do 1 s | 2,5 s | Skeleton po 300 ms |
| Filtrování tabulky | do 500 ms | 1,5 s | Indikátor v hlavičce tabulky, obsah zůstává |
| Živý počet segmentu | do 1,5 s | **3 s** (`SEGMENT_PREVIEW_TIMEOUT_MS` části 2) | Po timeoutu odhad z `EXPLAIN` a tlačítko "Spočítat přesně", viz 8.4.4 |
| Uložení konceptu | do 500 ms | 3 s | Stav "Ukládáme…" |
| Náhled e-mailu | do 1 s | 3 s | Skeleton uvnitř náhledu |
| Vygenerování šablony AI | 20 až 40 s | 90 s | Krokový průběh, pak timeout s vysvětlením |
| Kontrola jednoho DNS záznamu | do 3 s | 10 s | Stav u záznamu, ne blokace obrazovky |
| Otevření reportu kampaně s milionem zpráv | do 2 s | 5 s | Předpočítané agregace, viz část 5 |

### 14.2 Datové tabulky

Tabulka kontaktů je nejnáročnější obrazovka produktu.

| Požadavek | Hodnota |
|---|---|
| Stránkování | **Kurzorové** podle konvence části 1 (její 4.3). 50 řádků výchozí, volitelně 100 a 200 (nad 200 vrací API 422). Ovládání "Předchozí" a "Další", žádná čísla stránek. |
| Virtualizace | Zapíná se od 100 řádků na stránce |
| Nekonečné rolování | **Ne.** Ztěžuje klávesovou obsluhu, znemožňuje odkázat na konkrétní místo a v tabulce s hromadnými akcemi je nebezpečné, protože nejde říct, co je vlastně vybráno. Kurzorové stránkování s tlačítky je při stejné datové vrstvě lepší volba. |
| Celkový počet | Část 1 ho v seznamech **nevrací** (`COUNT(*)` nad pěti miliony řádků zablokuje odpověď) a souhlasím s tím. Rozhraní ukazuje **odhad s vlnovkou**, "Zobrazeno 50 z ~12 000", a přesný počet jen na vyžádání. **Výjimka:** tam, kde počet nese rozhodnutí (velikost segmentu, publikum kampaně, počet vybraných řádků před hromadnou akcí), existuje samostatný počítací endpoint a číslo se ukazuje přesné. Viz U→1.15 a R19. |
| Řazení | Serverové, jen podle `order` hodnot, které daný zdroj vyjmenovává (konvence části 1). Sloupce mimo ten výčet **nenabízejí** řazení vůbec, místo zašedlé šipky bez vysvětlení. |
| Šířka sloupců | Nastavitelná, uložená na uživatele a tabulku |
| Viditelnost sloupců | Nastavitelná, uložená, výchozí sada 6 sloupců |
| Zachování stavu | Filtry, řazení a kurzor jsou v URL, výběr řádků se při stránkování zachovává a je vidět jako "Vybráno 143 kontaktů" |
| Neplatný kurzor | Když kurzor přestane platit (data se změnila, změnilo se `order`), rozhraní **nespadne ani nevyprázdní tabulku**. Vrátí se na první stránku stejného filtru a nad tabulkou se objeví "Seznam se mezitím změnil, jste zpátky na začátku." |

**Odhad s vlnovkou místo přesného čísla je vědomý ústupek** a je v souladu s principem P7. Vlnovka je viditelné přiznání nepřesnosti. Přesné číslo, které by bylo o vteřinu starší a stálo by pět sekund dotazu, by bylo horší.

### 14.3 Velikost a načítání

| Požadavek | Hodnota |
|---|---|
| První načtení aplikace | JS pod 250 kB gzip pro skořápku plus první obrazovku |
| Editor šablon | Načítá se líně, jen když se otevře. Není součástí základního balíku. |
| Grafy | Načítají se líně, jen na obrazovkách se statistikami |
| Query builder | Načítá se líně, jen na obrazovce segmentu |
| Ikony | Jen použité, žádný celý balík |
| Písma | Systémový stack, žádné stahování (rozhodnutí části 1, souhlasím, protože slib nulové komunikace s cizím cloudem platí i pro Google Fonts) |
| Obrázky v rozhraní | Vlastní, žádné externí zdroje |
| Skript vloženého formuláře | pod 12 kB gzip (limit části 2), oddělený od trackovacího SDK |

### 14.4 Vnímaná rychlost

| Technika | Kde |
|---|---|
| Skeleton ve tvaru budoucího obsahu | Tabulky, detaily, dashboard. Ne obecný obdélník, ale obrys řádků a sloupců. |
| Předsunuté načítání při najetí na odkaz | Detail kontaktu, detail kampaně |
| Zachování rozvržení při načítání | Skeleton má stejné rozměry jako výsledek, aby obsah neposkakoval |
| Optimistická aktualizace | Podle 5.6 |
| Prodleva před zobrazením indikátoru | 300 ms. Operace, která trvá 150 ms, nemá blikat spinnerem. |
| Minimální doba zobrazení indikátoru | 400 ms, jakmile se zobrazí. Bliknutí je horší než krátké počkání. |
| Zachování předchozí hodnoty při přepočtu | Živý počet segmentu drží starou hodnotu zešedlou, nemizí (pravidlo části 2) |

---

## 15. Akceptační kritéria

Testovatelné věty. Z každé musí jít napsat test, aniž se člověk ptá.

### 15.1 Zpětná vazba

1. Každá mutační akce v aplikaci má v kódu navázaný právě jeden primární kanál zpětné vazby podle tabulky 5.2. Automatický test projde seznam server actions a ověří, že každá má odpovídající zpracování výsledku.
2. Po odebrání kontaktu ze seznamu se do 300 ms objeví toast s tlačítkem "Vrátit zpět", kliknutí na něj do 10 sekund vrátí členství včetně původního data přihlášení.
3. Chybový toast se sám nezavře. Test čeká 30 sekund a ověří, že je pořád v DOM.
4. Toast se pozastaví při najetí myší a při přesunu fokusu klávesnicí na tlačítko "Vrátit zpět".
5. Při optimistické aktualizaci, která selže, se stav rozhraní vrátí přesně do podoby před akcí, včetně pozice ve výpisu a označení řádků.
6. Zavření karty během importu import nezastaví. Test: spustit import 10 000 řádků, zavřít kartu, po 30 sekundách otevřít znovu a ověřit, že import doběhl.
7. Během importu se nezobrazí dialog `beforeunload`. Během editace šablony s neuloženou změnou mladší než 2 sekundy se zobrazí.
8. Průběh dlouhé operace se čtečce obrazovky ohlásí při 25, 50, 75 a 100 %, ne častěji.
9. Živý počet v segment builderu se do `aria-live` propíše až po 500 ms ustálení, a to jednou.
10. Při výpadku SSE se po třech neúspěšných pokusech přejde na dotazování po 15 sekundách a zobrazí se o tom informace.

### 15.2 Nevratné akce

11. Tlačítko odeslání kampaně obsahuje počet příjemců. Test kontroluje, že text tlačítka odpovídá regulárnímu výrazu s číslem.
12. Potvrzovací dialog odeslání obsahuje větu o nevratnosti a o okně na zrušení. Výchozí fokus je na tlačítku ústupu.
13. Po potvrzení odeslání se kampaň nachází ve stavu `scheduled` s časem odeslání za 60 sekund a tlačítko "Zrušit odeslání" ji vrátí do `draft`, aniž by odešel jediný e-mail.
14. Po vypršení okna na zrušení se tlačítko "Zrušit odeslání" v rozhraní už nevyskytuje. Místo něj jsou "Pozastavit" a "Zrušit zbytek rozesílky" s jinými dialogy.
15. Dialog zrušení zbytku rozesílky obsahuje počet už odeslaných i zbývajících zpráv, větu, že už odeslané nejdou vzít zpět, větu, že kampaň nepůjde znovu spustit, a nabídku "Radši pozastavit".
16. Dialog hromadného smazání kontaktů obsahuje počet v nadpisu i na tlačítku, výčet následků, nabídku exportu a jeden checkbox. Bez zaškrtnutí je akce nedostupná.
17. Po výběru "vybrat vše odpovídající filtru" obsahuje potvrzovací dialog slovní popis použitého filtru.
18. Žádné tlačítko primární akce v aplikaci nemá atribut `disabled`. Lint pravidlo to hlídá, výjimky jsou v allowlistu s odůvodněním.

### 15.3 Stavy obrazovek

19. Každá obrazovka ze seznamu v 7.2 má implementované všechny stavy označené ●. Kontroluje se sadou testů, které simulují prázdnou odpověď, chybu, 403, 404 a offline.
20. Prázdný stav obsahuje aspoň dvě věty vysvětlení a aspoň jednu akci. Kontroluje se testem nad snapshoty prázdných stavů.
21. Prázdný stav po filtrování se liší od prázdného stavu bez dat a obsahuje slovní popis použitého filtru a tlačítko na jeho zrušení.
22. Chybový stav načtení obsahuje sbalitelné podrobnosti s kódem chyby a `request_id` a tlačítko na zkopírování.
23. Uživatel s rolí `viewer` na obrazovce kampaně vidí obsah jako text, ne jako zašedlá formulářová pole, a nahoře pruh s vysvětlením.
24. Dashboard, jehož jedna dlaždice selže, zobrazí zbylé dlaždice funkční a v selhané dlaždici vlastní chybu s možností opakování.

### 15.4 Klíčové obrazovky

25. Od `docker compose up` k obrazovce vytvoření účtu neuplyne víc než 5 minut na běžném notebooku, a to bez otevírání dokumentace.
26. Delegační odkaz na DNS otevřený v anonymním okně zobrazí záznamy a stav ověření, a nezobrazí žádný název kampaně, kontakt ani jinou položku z projektu.
27. Delegační odkaz po 14 dnech nebo po zneplatnění vrací stránku s vysvětlením, ne chybu 404 bez kontextu.
28. Nástroj detekuje SPF se dvěma záznamy a nabídne konkrétní sloučený záznam ke zkopírování.
29. Nástroj detekuje záznam, jehož název obsahuje doménu dvakrát, a hlásí to jmenovitě.
30. Import CSV z Excelu v kódování Windows-1250 se středníkem zobrazí v kroku 2 náhled s neporušenou diakritikou a otázkou na potvrzení.
31. Náhled importu ukazuje sloupec s výsledným oslovením včetně řádku s neurčeným rodem, u kterého je fallback bez jména.
32. Výsledek importu ukazuje rozpad na nové, doplněné, přeskočené s uvedením důvodu a selhané, a součet sedí s počtem řádků v souboru.
33. Výsledek importu má samostatnou sekci s varováními, shluknutou po kódu, a pokrývá všech jedenáct kódů varování ze 4.6.11 části 2. Import se 84 řádky `excel_serial_date_assumed` zobrazí jeden řádek s počtem 84 a odkazem na výpis.
34. Import ve stavu `failed` zobrazí jiný nadpis než `completed_with_errors` a výslovně říká, že se nezapsal žádný kontakt.
35. Zrušený import nabízí pokračování od místa zrušení, ne jen opakování od začátku.
36. Tlačítko "Zpět" v kroku náhledu upozorní, že změna mapování založí nový import.
37. Stažené `errors.csv` má stejnou hlavičku, kódování a oddělovač jako vstupní soubor plus sloupce `_error_code` a `_error_detail`. Nahrání tohohle souboru zpět projde automapováním bez ručního zásahu.
38. Rozpracovaný import zmizí po 24 hodinách a rozhraní na to upozorní předem.
39. Fronta kontroly oslovení zobrazuje skupiny, ne jednotlivé kontakty. Import se 143 nejistými kontakty a 34 skupinami zobrazí 34 položek.
40. Fronta oslovení nabízí všech pět operací ze 4.5.3 části 2: potvrdit, opravit vokativ, nastavit rod, nepoužívat jméno, odložit.
41. Volba "zapamatovat i pro budoucí kontakty" je ve výchozím stavu zaškrtnutá.
42. Ve frontě oslovení se nezobrazují kontakty s neurčeným rodem a neutrálním oslovením.
43. Segment builder nikde nezobrazuje slova "AND", "OR", "NOT" ani "operátor".
44. Segment builder nabízí všech pět operátorů seznamu, všechny tři operátory souhlasu a oba operátory blokovaných adres z typové matice 4.11.2 části 2. Test projde matici a ověří, že pro každou dvojici pole a operátor existuje český i anglický popisek.
45. Negace skupiny jde nastavit z rozhraní a při zapnuté negaci se zobrazí vysvětlující řádek.
46. Volba negujícího operátoru (`neq`, `not_contains`, `not_in`, `has_none`, `not_in_last_days`) zobrazí text `segments.notNullHint` a tlačítko, které přidá podmínku "je prázdné".
47. Builder dovolí zanoření do hloubky 5 a 100 podmínek. Pokus o šestou úroveň nezobrazí chybu, ale schová tlačítko na přidání skupiny s vysvětlením.
48. Segment builder ukazuje pod počtem pět konkrétních kontaktů, které do segmentu patří.
49. Prázdný výsledek segmentu zobrazí, které konkrétní podmínky samostatně vracejí nula kontaktů.
50. Karta presetu i seznam segmentů zobrazují stáří počtu. Hodnota starší 6 hodin je šedá a má tlačítko "Přepočítat".
51. Preset, který nebyl nikdy počítaný, zobrazí "Spočítat", nikdy nulu.
52. Šest presetů čištění má `preset_key` shodný s 4.12 části 2 a karta u prvních dvou uvádí podmínku "dostali aspoň N e-mailů".
53. Poslední krok reaktivačního scénáře zobrazí potvrzení 3 dny předem v aplikaci i e-mailem, s možností odložit i zrušit.
54. Editor šablony umožňuje přesunout blok nahoru a dolů výhradně z klávesnice, bez použití myši.
55. Náhled šablony má tlačítko "Kontakt bez jména", které zobrazí náhled s prázdnými osobními údaji a použitým fallbackem.
56. Kontrolní seznam kampaně obsahuje všechny položky z katalogu v 8.6.2 a blokující položky brání odeslání.
57. Report kampaně nezobrazuje míru otevření jako hlavní metriku. Hlavní tři dlaždice jsou doručeno, kliklo, odhlásilo se.
58. U míry otevření je trvale viditelná poznámka o nepřesnosti a rozpad na potvrzené kliknutím, pravděpodobně automatické a nejisté.
59. U každého procenta v reportu je uvedený jmenovatel.
60. Report kampaně s vypnutým sledováním nezobrazuje nuly, ale vysvětlení, že se nesledovalo.
61. Časová osa kontaktu používá tvary sloves podle rodu kontaktu a u neznámého rodu neutrální podstatné jméno.
62. Detail kontaktu s `processing_restricted = true` zobrazí vysvětlující blok s větou, že kontakt vypadl ze všech segmentů.
63. Detail kontaktu zobrazí odlišný odznak a doplňující větu pro každou z šesti hodnot `contacts.status` a pro každý ze tří příznaků.
64. Rozpad publika kampaně obsahuje samostatné odečtové řádky pro odhlášené, blokované, nepotvrzené, pozastavené a s omezeným zpracováním, a každý je odkaz na seznam.
65. Blokované adresy zobrazují u důvodu `complaint` zámek s vysvětlením, ne zašedlé tlačítko. Hromadný výběr nenabízí odebrání u důvodů, které to nedovolují.
66. Odhlašovací stránka při odhlášení ze seznamu zobrazí text `public.unsubscribe.listScope`, ne tvrzení, že už nepřijde nic.
67. Obrazovka příchozího webhooku zobrazí poslední požadavek se stavem `dropped` jako nabídku k namapování, ne jako chybu.

### 15.5 Texty a jazyk

68. V žádném katalogu překladů se nevyskytuje znak U+2014 (dlouhá pomlčka). Kontroluje se v CI.
69. V žádném katalogu se nevyskytuje výraz ze sloupce "Nikdy nepoužívat" ve slovníku 9.2, včetně hodnoty `subscribed` jako stavu. Kontroluje se v CI.
70. Každý klíč v `cs.json` má protějšek v `en.json` a naopak. Kontroluje se v CI, chybějící klíč shodí build.
71. Žádný řetězec se neskládá zřetězením fragmentů ani dynamickým klíčem. Kontroluje se lint pravidlem.
72. Všechny počty v textech používají ICU `plural` včetně kategorie `=0`. Kontroluje se testem s hodnotami 0, 1, 2, 5, 21, 100 a 1,5.
73. Řazení kontaktů podle příjmení vrací pořadí Cimrman, Čapek, Dvořák, Havel, Chalupa, Ilona, Řezník, Sova, Šimek, Žák.
74. Vyhledávání výrazu `novak` najde kontakt s příjmením Novák a naopak `Novák` najde `novak`.
75. Čas naplánované kampaně se zobrazuje v časové zóně projektu a při odlišné zóně uživatele je u něj poznámka s převodem.
76. Neznámý chybový kód, na který rozhraní nemá vlastní text, zobrazí `detail` ze serveru a `request_id`, nikdy prázdnou obrazovku.

### 15.6 Výkon

77. Tabulka s 200 řádky na stránce se vykreslí a je použitelná do 1 sekundy na běžném notebooku.
78. Tabulka nikde nezobrazuje čísla stránek a stav stránkování je v URL jako `cursor`, takže odkaz otevře stejnou stránku výsledků.
79. Odkaz s neplatným kurzorem zobrazí první stránku stejného filtru a hlášku o tom, ne prázdnou tabulku ani chybu.
80. Indikátor načítání se nezobrazí u operace kratší než 300 ms a jakmile se zobrazí, zůstane aspoň 400 ms.
81. Základní balík JavaScriptu pro skořápku a první obrazovku nepřesahuje 250 kB gzip. Kontroluje se v CI.
82. Editor šablon, grafy ani query builder nejsou součástí základního balíku. Kontroluje se analýzou balíků v CI.

---

## 16. Závislosti

Vše ověřeno **2026-07-31** příkazy `npm view <balíček> license version time.modified` a `curl -s https://api.npmjs.org/downloads/point/last-week/<balíček>`. Povolené licence pro produkční závislosti: MIT, Apache-2.0, BSD, ISC.

### 16.1 Doporučené produkční závislosti

| Balíček | Verze | Licence | Poslední aktualizace | Stažení týdně | K čemu | Verdikt |
|---|---|---|---|---|---|---|
| `tailwindcss` | 4.3.3 | MIT | 2026-07-31 | 117 285 467 | Stylování | doporučit |
| `shadcn` (CLI) | 4.16.0 | MIT | 2026-07-27 | 7 275 196 | Generování komponent | doporučit |
| `radix-ui` | 1.6.7 | MIT | 2026-07-30 | 11 443 028 | Primitiva pod shadcn/ui | doporučit |
| `lucide-react` | 1.28.0 | ISC | 2026-07-30 | 82 475 475 | Ikony | doporučit |
| `@tanstack/react-table` | 8.21.3 | MIT | 2026-07-31 | 17 676 279 | Datová tabulka | doporučit |
| `@tanstack/react-virtual` | 3.14.9 | MIT | 2026-07-28 | 20 734 158 | Virtualizace řádků | doporučit |
| `react-querybuilder` | 8.21.2 | MIT | 2026-07-27 | 391 251 | Segment builder | doporučit s výhradou, viz 13.2 |
| `sonner` | 2.0.7 | MIT | 2025-08-02 | 43 829 989 | Toast | doporučit s výhradou (rok bez vydání) |
| `cmdk` | 1.1.1 | MIT | 2025-08-27 | 42 044 013 | Globální vyhledávání a příkazy | doporučit s výhradou (rok bez vydání) |
| `react-hook-form` | 7.83.0 | MIT | 2026-07-25 | 57 521 292 | Formuláře | doporučit |
| `zod` | 4.4.3 | MIT | 2026-05-04 | 246 441 398 | Validace, sdílená s částí 1 | doporučit |
| `recharts` | 3.10.1 | MIT | 2026-07-25 | 49 405 294 | Grafy v reportech | doporučit |
| `react-dropzone` | 19.1.1 | MIT | 2026-07-19 | 12 604 495 | Nahrání souboru | doporučit |
| `react-day-picker` | 10.0.1 | MIT | 2026-05-15 | 43 131 577 | Výběr data a rozsahu | doporučit |
| `date-fns` | 4.4.0 | MIT | 2026-05-29 | 95 521 134 | Práce s daty | doporučit |
| `next-intl` | 4.13.4 | MIT | 2026-07-23 | 4 849 831 | i18n, volba části 1 | potvrzuji |
| `@formatjs/intl-durationformat` | 0.10.18 | MIT | 2026-07-16 | 379 561 | Polyfill `Intl.DurationFormat` | doporučit, jen pokud nativní podpora nestačí |

### 16.2 Vývojové závislosti

| Balíček | Verze | Licence | Poslední aktualizace | Stažení týdně | Verdikt |
|---|---|---|---|---|---|
| `axe-core` | 4.12.1 | **MPL-2.0** | 2026-07-30 | 63 050 596 | **doporučit, ale vyžaduje výjimku v licenční bráně**, viz 11.4 |
| `@axe-core/playwright` | 4.12.1 | **MPL-2.0** | 2026-07-27 | 7 514 061 | totéž |
| `eslint-plugin-jsx-a11y` | 6.10.2 | MIT | 2024-10-26 | 44 122 360 | doporučit, i když se dva roky nehnul, protože pravidla se nemění |
| `lighthouse` | 13.4.1 | Apache-2.0 | 2026-07-29 | 4 058 066 | volitelně, spíš na výkon než na přístupnost |

### 16.3 Odmítnuté

| Balíček | Verze | Licence | Důvod odmítnutí |
|---|---|---|---|
| `pa11y` | 9.1.1 | **LGPL-3.0-only** | **Licence.** LGPL je v projektu výslovně zakázaná. Náhrada: `axe-core` v Playwrightu. |
| `@base-ui-components/react` | 1.0.0-rc.0 | MIT | Ještě nevydalo stabilní verzi. Přehodnotit za rok. |
| `react-aria-components` | 1.19.0 | Apache-2.0 | Licenčně v pořádku a z hlediska přístupnosti nejsilnější. Odmítnuto jen kvůli křivce učení a jinému stylovacímu modelu. Ponecháno jako záloha pro jednotlivé komponenty. |
| `ag-grid-community` | 36.0.2 | MIT | Licenčně v pořádku. Odmítnuto pro váhu, uzavřenost vykreslení a tah k placené Enterprise verzi. |
| `@mui/x-data-grid` | 9.10.1 | MIT | Licenčně v pořádku. Odmítnuto, protože táhne celý stylovací systém MUI proti Tailwindu. |
| `@react-awesome-query-builder/ui` | 6.7.0-alpha.0 | MIT | V alfě, poslední vydání 2025-05-23. |
| `@nivo/core` | 0.99.0 | MIT | Poslední vydání 2025-05-23, `recharts` je živější a stačí. |
| `echarts` | 6.1.0 | Apache-2.0 | Licenčně v pořádku, ale příliš těžké na pět grafů. |
| `@uppy/core` | 5.2.0 | MIT | Licenčně v pořádku, ale velké a půlku funkcí nepotřebujeme. |
| `react-frame-component` | 5.3.2 | MIT | Zbytečné, `<iframe sandbox srcdoc>` stačí. |
| `@dnd-kit/core` | 6.3.1 | MIT | Nezavádět v MVP 0. Tažení bloků přichází s EmailBuilder.js z části 3. Poslední vydání 2024-12-05. |

### 16.4 Poznámka k licenční bráně

Ověřování odhalilo dva případy, které kapitola 9 hlavní specifikace nepokrývá:

1. **`pa11y` je LGPL-3.0-only.** Přesně ten typ nálezu, kvůli kterému licenční brána existuje. Zachyceno před zavedením, náhrada existuje.
2. **`axe-core` a `@axe-core/playwright` jsou MPL-2.0.** MPL-2.0 není na seznamu povolených, ale jde o vývojové závislosti, které se nedistribuují. **Brána musí rozlišovat `dependencies` a `devDependencies`**, jinak nepůjde použít nejrozšířenější nástroj pro testování přístupnosti na světě. Požadavek na část 1, viz U→1.12.

---

## 17. Požadavky na ostatní části

Konkrétní požadavky. Každý má číslo, adresáta, tvar a odůvodnění.

### Na část 1 (platforma)

| # | Požadavek | V jakém tvaru | Proč |
|---|---|---|---|
| U→1.1 | **Rozšiřující člen `params` v chybové odpovědi.** RFC 9457 rozšiřující členy povoluje a část 1 už dvě má (`errors`, `retry_after`). Potřebuju třetí: hodnoty k dosazení do textu. Konkrétní tvary jsou v tabulce 10.2. **Zvlášť u `forbidden`** potřebuju `requiredPermission`, `currentRole`, `grantedByRoles[]` a `contactableMembers[]`. | `params: Record<string, string \| number \| string[]>` jako rozšiřující člen, typovaný per `code` v `packages/core/errors/registry.ts` | Bez toho nejde napsat hláška 16 ani 22. Zbytek mého původního rozporu o chybách jsem po přečtení skutečného textu stáhl, viz R6. |
| U→1.2 | **Komponentní základ pro šest kanálů zpětné vazby** z 5.3, včetně toastu s odpočtem, s pozastavením při hoveru a fokusu, s frontou a se slučováním duplicit. | Komponenty v `packages/ui` plus dokumentovaný hook | Bez sdílené komponenty si každá obrazovka vyrobí vlastní a pravidla z kapitoly 5 se nedají vynutit. |
| U→1.3 | **Centrum úloh** jako součást skořápky: panel v hlavičce, odznak s počtem běžících úloh, stránka `/w/{slug}/jobs/{jobId}`, historie 30 dní. Napojení na pg-boss včetně `progress` a `total`. | Komponenta plus interní API | Vlastní ho skořápka, protože přesahuje domény. Části 2 a 4a do něj jen zapisují své úlohy. |
| U→1.4 | **Lint pravidlo zakazující `disabled` na tlačítku primární akce**, s allowlistem. | ESLint pravidlo ve sdílené konfiguraci | Vynucení principu P5. |
| U→1.5 | **Kontrola katalogů překladů v CI**: chybějící protějšek, zakázané výrazy ze slovníku 9.2 včetně `subscribed`, dlouhá pomlčka, dynamické klíče. Blokující job. | Rozšíření jobu `i18n-check` | Vynucení kapitol 9 a 12. |
| U→1.6 | **Kolace `cs-CZ-x-icu`** na textových sloupcích, podle kterých se řadí. | Součást DB konvencí | Bez toho se "Chalupa" seřadí špatně a je to vidět na první obrazovce. |
| U→1.7 | **Formát URL projektu.** Přijímám tvar `/{locale?}/w/{slug}/…`. Žádám jen doplnění konvence: **filtr, řazení i kurzor patří do query parametrů**, a **neplatný kurzor nesmí vrátit chybu**, ale první stránku stejného filtru s vysvětlením. | Doplnění konvence 4.3 části 1 | Viz 4.3 a R19. |
| U→1.8 | **Obnova hesla bez nastaveného odesílání.** Příkaz v kontejneru a odkaz na něj z přihlašovací stránky. | Příkaz plus text na `/login` | První instalace nemá nastavené odesílání. Bez toho se dá zamknout ven z čerstvé instalace. |
| U→1.9 | **Čitelný výpis kontejneru při startu** a jednající hlášky pro obsazený port, nedostupnou databázi a chybějící `SECRET_KEY`. | Texty v 8.1.1 | První rozhraní produktu je terminál. |
| U→1.10 | **Skryté sekce navigace versus vysvětlené.** Souhlasím se skrytím celých sekcí podle role. Žádám, aby **akce uvnitř obrazovky**, na které uživatel nemá právo, byly vidět a vysvětlené. | Doplnění pravidla do 5.2 části 1 | Skryté tlačítko znamená, že uživatel neví, o co má požádat. Viz 7.2b a hláška 22. |
| U→1.11 | **Prohlášení o přístupnosti** jako statická stránka v aplikaci. | Šablona stránky | Viz 11.2. |
| U→1.12 | **Licenční brána musí rozlišovat `dependencies` a `devDependencies`** a povolit MPL-2.0 pro `axe-core` a `@axe-core/playwright`. | Konfigurace plus dokumentovaný seznam výjimek | Bez toho nepůjde použít nejrozšířenější nástroj pro testování přístupnosti. Viz 16.4. |
| U→1.13 | **Zákaz `beforeunload` u operací běžících na serveru.** | Pravidlo plus sdílený hook | Falešný poplach naučí uživatele zavírat všechna varování bez čtení. Viz 5.8. |
| U→1.14 | **Obnovení relace v dialogu**, bez odchodu ze stránky a bez ztráty rozepsaného obsahu. | Komponenta plus endpoint | Viz 5.8 a hláška 23. |
| U→1.15 | **Počítací endpoint tam, kde počet nese rozhodnutí.** Souhlasím s tím, že seznamy počet nevracejí. Ale u segmentu, publika kampaně a hromadného výběru je počet ta informace, podle které se uživatel rozhoduje. | Samostatný endpoint s cachováním, jak ho část 1 v 4.3 už předpokládá | Tlačítko „Smazat více než 1 000 kontaktů" je nepoužitelné. Viz R19 a princip P3. |

### Na část 2 (kontakty)

| # | Požadavek | V jakém tvaru | Proč |
|---|---|---|---|
| U→2.1 | **Vzorek konkrétních kontaktů** k náhledu segmentu, ne jen počet, včetně hodnoty pole, na které je podmínka. | Náhled už vrací 20 kontaktů, potřebuju k nim relevantní hodnotu pole | Nejúčinnější prvek segment builderu, viz 8.4.2. |
| U→2.2 | **Diagnostika prázdného segmentu**: při nulovém výsledku vyhodnotit každou podmínku samostatně a vrátit počty. | `diagnostics: { conditionCounts }`, počítá se **jen** při `count === 0` | Viz 8.4.4. Bez toho je prázdný segment slepá ulička. |
| U→2.12 | **Diagnostika vrací i nejčastější hodnoty pole** a příznak, jestli existuje hodnota lišící se jen velikostí písmen. | `diagnostics.topValues`, `diagnostics.caseInsensitiveMatch` | Nabídka „Nechtěli jste *brno* s malým b?" odliší pomáhající nástroj od hlásiče nuly. |
| U→2.3 | **Rozpad publika kampaně** na vstupní počet, odečty a výsledek. | Struktura s pojmenovanými odečty | Viz 8.4.6. |
| U→2.13 | **Rozpad publika obsahuje samostatné řádky pro `processing_restricted`, `snooze_until` a nepotvrzené přihlášení**, ne souhrnné „ostatní", a každý řádek umí vrátit seznam dotčených kontaktů. | Rozšíření struktury z U→2.3 | Kontakt s omezeným zpracováním vypadne ze všech segmentů a uživatel by jinak nikdy nezjistil proč. Viz 8.8.1. |
| U→2.4 | **Vrácení celého importu** jako podporovaná operace do 24 hodin od dokončení. | Endpoint plus úloha | Viz 6.6. |
| U→2.5 | **Stažení chybných řádků** ve stejné struktuře, kódování a s oddělovačem jako vstup, plus `_error_code` a `_error_detail`. | Už máte v 4.6.11, jen potvrzuju, že se na to spoléhám | Viz 8.3.6 a 12.6. |
| U→2.6 | **Detekce kódování musí vracet i alternativy**, ne jen nejlepší odhad. | `{ detected, alternatives: string[] }` | Viz 8.3.2 a hláška 1. |
| U→2.14 | **Náhled a výsledek importu vracejí počty varování po kódech**, ne jen celkový počet, plus endpoint na výpis řádků daného kódu. | `warnings: Record<WarningCode, number>` | Viz 8.3.6. Vaše varování `excel_serial_date_assumed` a `number_format_ambiguous` jsou tiché chyby, které nemají kam se zobrazit, pokud rozhraní nezná jejich počty. |
| U→2.7 | **Vyhledávání kontaktů bez ohledu na diakritiku v obou směrech.** | `unaccent` plus trigramový index | Viz 12.5. Plus potřebuju vědět, jestli je `CONTACT_SEARCH_INDEX_ENABLED` vypnuté, abych to uvedl u vyhledávacího pole. |
| U→2.15 | **Fronta vokativu vrací skupiny včetně vzorku příjmení a počtu**, a odznak v navigaci nese počet **skupin**, ne kontaktů. | `{ nameKey, gender, vocative, contactCount, sampleSurnames[] }` | Viz 8.3.7. Přebírám vaše seskupení z 4.5.2 beze změny. |
| U→2.8 | **Fronta ke kontrole vokativu dostupná i mimo import.** | Endpoint plus obrazovka | Viz 8.3.7. |
| U→2.11 | **Text `public.unsubscribe.inFlightNotice`**: „Odhlášení platí od teď. Kdyby vám ještě dorazil e-mail, který byl odeslaný před chvílí, už bude poslední." | Klíč v katalogu, cs a en | Vaše 4.9.4 přiznává okno, ve kterém odhlášenému ještě odejde jedna zpráva. Bez vysvětlení to vypadá jako nefunkční odhlášení a příjemce klikne na spam. Viz 8.9. |
| U→2.10 | **Kód `contact_in_running_campaign`** a kontrola před smazáním kontaktu, který je v běžící rozesílce. Padá to mezi vás a část 4a a zatím to nemá vlastníka. | Kód plus `params: { campaignId, campaignName, etaSeconds }` | Viz hláška 24. |
| U→2.9 | **Ukázková data** jako podporovaná funkce: 200 kontaktů na `example.com`, plus příznak, který brání zařazení do publika kampaně. | Příkaz plus tlačítko v UI | Viz 8.1.4. |

### Na část 3 (obsah)

| # | Požadavek | V jakém tvaru | Proč |
|---|---|---|---|
| U→3.1 | **Klávesová alternativa k tažení bloků myší.** Každý blok má akce "Posunout nahoru", "Posunout dolů", "Duplikovat", "Smazat" dostupné z klávesnice. | Součást adaptéru nad editorem | WCAG 2.2, SC 2.5.7 Dragging Movements. Podmínka souladu, ne vylepšení. |
| U→3.2 | **Merge tagy se v editoru zobrazují jako přeložené žetony**, ne jako Liquid kód. | Mapování `tag → zobrazený název` v katalogu překladů | Viz 8.5.1. |
| U→3.3 | **Náhled s prázdnými osobními údaji** jako pojmenovaná funkce ("Kontakt bez jména"). | Tlačítko plus API pro náhled s prázdným kontextem | Nejčastější chyba v odeslaných e-mailech, viz 8.5.2. |
| U→3.4 | **Náhled textové verze** jako rovnocenný třetí režim. | Součást náhledu | Textovou verzi nikdo nekontroluje a odchází s každou zprávou. |
| U→3.5 | **Chybové kódy AI pojmenovávají providera.** | Rozšíření kódů o `params: { provider }` | Viz hlášky 19 a 20. |
| U→3.6 | **Krokový průběh generování AI** (čtyři fáze), ne neurčitý spinner. | Streamování stavů z jobu | Viz 8.5.3. |
| U→3.7 | **AI návrh alt textu k obrázku** jako nabídka, nikdy automatické vložení. | Nástroj asistenta plus UI | Zvedne přístupnost odeslaných e-mailů víc než edukace. |
| U→3.8 | **Před AI přepisem se uloží pojmenovaná verze** "Před AI návrhem" s možností návratu 7 dní. | Součást verzování šablon | Viz 8.5.3. |
| U→3.9 | **Chyba SSRF ochrany nesmí uživateli sdělit důvod.** | Kód bez podrobností | Podrobná hláška by udělala z nástroje skener vnitřní sítě. |

### Na část 4a (kampaně)

| # | Požadavek | V jakém tvaru | Proč |
|---|---|---|---|
| U→4a.1 | **Okno na zrušení odeslání.** Kampaň po potvrzení jde do `scheduled` se `scheduled_at = now() + delay`, kde `delay` je nastavení projektu 0 až 300 s, výchozí 60. `unschedule` ji vrací do `draft`. | Nastavení projektu plus využití existujících přechodů | Jádro ochrany nevratné akce, viz 6.3. Nepřidává novou architekturu. |
| U→4a.2 | **Pozastavení a zrušení jsou v rozhraní důsledně oddělené.** Potřebuju u `paused` i `pause_reason` a u automatické brzdy podkladová čísla. | `{ status, pauseReason, pauseParams }` | Viz 6.4. Uživatel musí vidět, jestli kampaň pozastavil sám, nebo brzda, a proč. |
| U→4a.3 | **Rozšířit `preflight` o úrovně `warning` a `info`**, ne jen blokující kontroly, a o `params` pro složení textu. | `{ items: [{ key, level, params }] }` | Katalog položek je v 8.6.2. Dnes vracíte jen blokující kontroly, takže varování nemá kde vzniknout. |
| U→4a.4 | **Automatické pozastavení při vysoké míře nedoručení** během rozesílky. | Přechod na `paused` s důvodem | Viz 8.6.4. Ochrání uživatele před ztrátou účtu u Amazonu. |
| U→4a.5 | **Míra stížností nad 0,3 % blokuje odeslání**, mezi 0,1 % a 0,3 % varuje. | Položka preflightu plus nastavení | Viz 8.6.2 a R1. |
| U→4a.6 | **Odhad doby rozesílky** ze současné kvóty a rychlosti. | Pole v preflightu a v průběhu | Uživatel se rozhoduje, jestli může odejít. |
| U→4a.7 | **Zkušební režim** jako stav projektu. | Nastavení projektu plus kontrola při materializaci | Viz 8.2.8. Bez toho se produkt bez DNS nedá vyzkoušet. |
| U→4a.8 | **Detekce poskytovatele DNS z NS záznamů** a tabulka návodů. | Součást ověřování domény | Viz 8.2.6. |
| U→4a.9 | **Diagnostika DNS nad rámec ano/ne:** dva SPF záznamy, zdvojený název, oříznutá hodnota, zapnutá proxy u Cloudflare. | Strukturovaný výsledek s kódem problému | Viz 8.2.6 a hlášky 9, 10, 11. |
| U→4a.10 | **Delegační odkaz na DNS**: token, 14 dní, jen ke čtení plus spuštění kontroly, bez přihlášení. | Endpoint plus stránka `/d/{token}` | Hlavní odpověď na "zvládne to babička", viz 8.2.5. |
| U→4a.11 | **Varování u odesílací adresy na veřejné doméně** jako varování, ne blokace. | Validace plus položka preflightu | Viz 8.2.3. |
| U→4a.12 | **Ukázková odeslaná kampaň s reportem** jako součást ukázkových dat. | Součást seedu | Report je obrazovka, která prodává, a jinak ji nejde ukázat před prvním odesláním. |
| U→4a.13 | **Registrace doménových kódů `ses_*`, `smtp_*` a `dns_*`** do registru podle konvence části 1, včetně `params` z 10.2. | Zápis do registru plus tvary `params` | Devět z mých pětadvaceti hlášek je vaše doména. |

### Na část 5 (tracking a reporty)

| # | Požadavek | V jakém tvaru | Proč |
|---|---|---|---|
| U→5.1 | **Sladit pojmenování tří čísel otevření.** Navrhuju tři **vzájemně se vylučující** skupiny, jejichž součet dá celek. | Sladit v revizi | Skupiny, které se nesčítají do celku, čtenáře matou. Rozhodnutí je na vás. |
| U→5.2 | **Souhlasím s tím, že hlavní metrikou je proklik.** Nejde o požadavek, ale o potvrzení, ke kterému jsme došli nezávisle. | | |
| U→5.3 | **Jmenovatel u každého procenta** v API i v UI. | `{ value, total, basis }` | Bez jmenovatele se čísla nedají porovnat s jiným nástrojem. |
| U→5.4 | **Prahové hodnocení metrik** ("v normě", "vysoké") dodává server, ne rozhraní. | `{ value, status, threshold }` | Uživatel neví, jestli je 1 % moc. Prahy patří k doméně doručitelnosti. |
| U→5.5 | **Kampaň s vypnutým sledováním nevrací nuly**, ale příznak. | `tracking: { opens: false, clicks: true }` | Nuly vypadají jako neúspěch, viz 8.7.4. |
| U→5.6 | **SSE s definovaným chováním při odpojení.** | Klientská knihovna plus komponenta indikátoru | Viz 5.9. |
| U→5.7 | **Frekvence aktualizací shora omezená serverem**: průběh nejvýš 1×/s, report běžící kampaně 1×/5 s. | Škrcení na straně serveru | Rozhraní to nesmí řešit samo. |
| U→5.8 | **Shlukování sérií událostí v časové ose.** | Součást odpovědi časové osy | Bez toho web tracking časovou osu zaplaví. |
| U→5.9 | **Časová osa vrací věty ve strojově čitelné podobě**, ne hotový text. | `{ type, params, actorGender }` | Viz 12.3, tvary sloves podle rodu. |
| U→5.10 | **Varování u segmentu "neotevřel N kampaní"** jako údaj o podílu příjemců s Apple Mailem v daném publiku. | Pole v náhledu segmentu | Sami to navrhujete, jen potřebuju vědět, v jakém tvaru to přijde do UI. |

---

## 18. Rozpory s hlavní specifikací a s ostatními částmi

### 18.1 S hlavní specifikací

| # | Místo | Rozpor | Návrh |
|---|---|---|---|
| R1 | Kapitola 6.6, prahy doručitelnosti | Hlavní specifikace mluví jen o **varování**. Navrhuju, aby míra stížností nad 0,3 % odeslání **blokovala**, s možností vědomého přebití. | Amazon při dlouhodobém překročení účet zablokuje. Nemožnost odeslat jednu kampaň je mnohem menší škoda než ztráta účtu. |
| R2 | Kapitola 8, demo skript, bod 2 | Demo předpokládá ověření domény během dema. DNS propagace trvá minuty až hodiny, takže to v živém demu nejde spolehlivě předvést. | Doplnit do demo skriptu **zkušební režim**. Zároveň je to argument pro to, aby byl v MVP 0. |
| R3 | Kapitola 2.1, "Plně reaktivní UI" | Reaktivita je uvedená jako vlastnost, ale bez pravidel se z ní stane blikající rozhraní. | Kapitola 5.9 zavádí horní meze frekvence a pravidlo, že čísla se neanimují skokem dolů. |
| R4 | Kapitola 6.3, tón na úrovni projektu | Nerozlišuje **jazyk rozhraní**, **jazyk odesílaných e-mailů** a **jazyk kontaktu**. | Kapitola 12.1 je rozděluje. Bez toho Angličan přepnutím rozhraní rozbije oslovení v šablonách. |
| R5 | Kapitola 7, MVP 0 | Demo skript neobsahuje ukázková data ani zkušební režim, ale obojí považuju za podmínku použitelného golden path. | Zvážit zařazení do MVP 0. Odhad jeden den práce na obojí. |

### 18.2 S částí 1 (platforma)

| # | Místo | Rozpor | Návrh |
|---|---|---|---|
| R6 | Část 1, 4.2: chybový formát | **Původně jsem to psal jako zásadní rozpor. Po přečtení skutečného textu ho z velké části stahuju.** Část 1 zavádí RFC 9457, kde `code` je pole, podle kterého se klient rozhoduje, a výslovně počítá s tím, že klient si text složí sám. | Zbývá jediná menší věc: **rozšiřující člen `params`**. Viz U→1.1 a mapování v 10.2. |
| R7 | Část 1, 5.2: struktura postranního menu (osm položek) | Segmenty a Formuláře patří pod Kontakty a Reporty jsou vlastnost kampaně, ne samostatné místo. | Šest položek podle kapitoly 4.1. Rozhodnutí patří na synchronizaci. |
| R8 | Část 1, 5.2: "Sekce, na kterou uživatel nemá oprávnění, se v navigaci nezobrazuje." | Souhlasím pro celé sekce. Nesouhlasím pro **akce uvnitř obrazovky**. | Viz 7.2b a U→1.10. |
| R9 | Část 1, 5.1: přístupnost testuje `axe-core` v Playwrightu | Automat zachytí jen část problémů a nezachytí právě ty nejrizikovější: klávesová obsluha editoru, drag and drop, správa fokusu v průvodcích. | Kapitola 11.4 doplňuje ruční kontrolní seznam a scénář se čtečkou. |
| R10 | Část 1, 5.3: texty prázdných stavů a hlášek | Texty jsou v pořádku, ale jinak formulované než v mém katalogu. | Slovníček 9.2 je závazný pro celou aplikaci. Konkrétně "API klíč" versus "Klíč k API". |
| R18 | Část 1, 3.4: role **editor** má `contacts:delete`, ale **nemá** `contacts:export` | **Považuju to za obrácené z hlediska rizika a rozbíjí mi to hlavní pojistku u hromadného mazání.** Dialog v 6.5 nabízí stažení kontaktů jako jedinou ochranu, která data zachrání. Editor, který jako jediný smí hromadně mazat, si je zálohovat nesmí. Totéž platí pro reaktivační scénář v 8.4.1b. | Tři možnosti, doporučuju první: **(a)** `contacts:export_before_delete` omezené na mazanou množinu, s auditem; **(b)** dát editorovi `contacts:export` celé; **(c)** vzít editorovi `contacts:delete`. Když se nevybere nic, musí dialog říct "Zálohu si stáhnout nemůžete, požádejte správce", a to je špatný výsledek. |
| R19 | Část 1, 4.3: kurzorové stránkování bez celkového počtu | **Nejde o rozpor, přijímám to.** Ale **číslované stránky nejsou možné** a nejde ukázat přesný počet bez zvláštního dotazu. Můj původní návrh jsem přepsal. | Odhad s vlnovkou, přesný počet na vyžádání, počítací endpoint tam, kde počet nese rozhodnutí. Viz 14.2 a U→1.15. |
| R20 | Část 1, 5.3: "uživatel nikdy nevidí `code`" | Souhlasím pro běžný text hlášky. Nesouhlasím pro chybu bez jasného řešení (stav S9). | Ve sbalených podrobnostech je `code` i `request_id`. Vedoucí to už schválil k zapracování do konvence. |

### 18.3 S částí 2 (kontakty)

| # | Místo | Rozpor | Návrh |
|---|---|---|---|
| R11 | Část 2, 6.4: přepínač `A zároveň` / `Nebo` | Je to lepší než AND a OR, ale pořád je to operátor, ne věta. | Přepínač ve větě: "Kontakty, které **splňují všechny podmínky** / **alespoň jednu podmínku**". Sémantika je totožná, nemá to dopad na AST. Viz 8.4.2. |
| R12 | Debounce náhledu 500 ms versus mých 600 ms | Triviální neshoda. | Přijímám 500 ms z části 2, opraveno v 5.9 i v kritériu 9. |
| R13 | Část 2, 6.4: přepínač na zobrazení JSON | Nemám s tím problém. Žádám jen, aby byl **schovaný pod rozbalením** a nikdy výchozí. | Doplnit do 6.4 části 2. |
| R21 | Moje původní limity segmentu (vnoření 2, strop 24 podmínek) | **Byla to moje chyba, ne rozpor.** Čísla jsem si vymyslel a dělal jsem tím z velké části povoleného AST mrtvý kód. Vlastním prezentaci limitu, ne jeho hodnotu. | Převzal jsem všech devět limitů z 4.11.4 beze změny a v 8.4.3b popisuju, jak se o nich uživatel dozví. Nežádám snížení žádného z nich. |
| R22 | Moje původní kódy chyb importu | **Byla to moje chyba.** Vlastním text hlášky, ne klíč. | Přejmenováno na `unsupported_encoding`, `no_email_column_mapped`, `import_duplicate`, `file_too_large`. Pokrytí zbylých kódů je vysvětlené v 10.2. |
| R23 | Můj původní "závazný text" odhlašovací stránky | **Byla to moje chyba a text navíc lhal**, protože při odhlášení z jednoho seznamu tvrdil, že už nepřijde nic. | Znění vlastní část 2, já vlastním strukturu stránky a pravidla tónu. Viz 8.9. Přidávám jeden nový požadavek na text, U→2.11. |
| R24 | Můj původní návrh fronty vokativu po kontaktech | **Byla to moje chyba**, část 2 to ve 4.5.2 zakazuje výslovně a má pravdu. | Přepsáno na skupiny včetně všech pěti operací ze 4.5.3, předzaškrtnuté volby a odstranění řádku s neurčeným rodem. Viz 8.3.7. |
| R25 | Můj původní příslib návratu o krok zpět v průvodci importem | **Byla to moje chyba**, přechod `previewing → validating` je ve 4.6.10 zakázaný. | Tlačítko "Zpět" nyní říká, že změnou mapování začne import znovu. Doplnil jsem pokračování od místa zrušení, 24hodinovou životnost náhledu a rozlišení `failed` od `completed_with_errors`. |
| R26 | Moje kapitola 12.6 překládala hlavičky exportních CSV | **U `errors.csv` by to rozbilo celý kolotoč oprav.** | `errors.csv` si drží původní hlavičku, kódování i oddělovač. Běžný export se překládá dál. Viz 12.6. |

### 18.4 S částí 4a (kampaně)

| # | Místo | Rozpor | Návrh |
|---|---|---|---|
| R14 | Část 4a: "tlačítko Odeslat je zašedlé se srozumitelným důvodem" | **Přímý rozpor s principem P5.** Zašedlé tlačítko není fokusovatelné, čtečka ho oznámí jako nedostupné bez důvodu a uživatel nemá kam kliknout. | Tlačítko zůstává aktivní. Kliknutí s blokující položkou přesune fokus na první blokující položku a ohlásí ji. Rozhodnutí patří mně, jde o interakci, ne o doménu. |
| R15 | Část 4a: `preflight` vrací jen blokující kontroly | Kontrolní seznam z 8.6.2 má tři úrovně. Varování nemá kde vzniknout. | Rozšířit o `level`. Viz U→4a.3. |
| R16 | Část 4a: stav `cancelled` je terminální | Souhlasím s modelem. Musel jsem kvůli němu opravit vlastní dialog, který dřív sliboval možnost pokračovat. | Rozhraní odděluje "Pozastavit" a "Zrušit zbytek rozesílky" a v dialogu zrušení nabízí pozastavení jako alternativu. Viz 6.4. |

### 18.5 S částí 5 (tracking)

| # | Místo | Rozpor | Návrh |
|---|---|---|---|
| R17 | Část 5, 0.4: tři čísla otevření | Skupiny se překrývají a nesčítají do celku, což čtenáře mate. | Viz U→5.1. Není to zásadní rozpor, je to sladění pojmenování. |

---

## 19. Otevřené otázky

| # | Otázka | Moje doporučení | Kdo rozhodne |
|---|---|---|---|
| O1 | **Hlavní metrika reportu: proklik, nebo otevření?** | Proklik. Shodli jsme se s částí 5 nezávisle. | Zadavatel, je to produktové rozhodnutí proti zvyklostem oboru |
| O2 | **Délka okna na zrušení odeslání.** | 60 s výchozí, nastavitelné 0 až 300 s. | Zadavatel |
| O3 | **Zkušební režim v MVP 0, nebo později?** | V MVP 0. Bez něj se produkt bez DNS nedá vyzkoušet. Odhad půl dne. | Zadavatel |
| O4 | **Ukázková data v MVP 0, nebo později?** | V MVP 0. Odhad půl dne. | Zadavatel |
| O5 | **Vykání ve všech textech rozhraní.** | Ano. | Zadavatel |
| O6 | **Český název pro merge tag.** | "Doplňovaný údaj", v editoru "Vložit údaj o příjemci". | Zadavatel, nejde to později levně změnit |
| O7 | **Blokuje vysoká míra stížností odeslání, nebo jen varuje?** | Blokuje nad 0,3 %, s možností vědomého přebití a auditem. Viz R1. | Zadavatel spolu s částí 4a |
| O8 | **Struktura postranního menu: šest položek, nebo osm?** | Šest, viz R7. | Synchronizace s částí 1 |
| O9 | **Rozšiřující člen `params` v chybové odpovědi.** | Zavést. Bez toho nejde napsat polovina katalogu 10.3. Viz R6. | Synchronizace s částí 1 |
| O10 | **Web Push notifikace o dokončení dlouhých úloh.** | Nezavádět. E-mail je pro tenhle produkt spolehlivější. | Zadavatel |
| O11 | **Mobilní podpora editoru a segment builderu.** | Nepodporovat, říct to větou. Podporovat čtení, report a pozastavení rozesílky. | Zadavatel |
| O12 | **Nekonečné rolování v tabulkách.** | Ne, kurzorové stránkování s tlačítky. Viz 14.2. | Rozhodl jsem sám, uvádím pro případ nesouhlasu |
| O13 | **Kolik jazyků od prvního dne.** | Čeština a angličtina kompletně, slovenština jako první kandidát. | Zadavatel |
| O14 | **Slouží delegační odkaz i k jiným úkolům než DNS?** | V MVP 0 jen DNS. Předání klíčů je citlivější a chce vlastní návrh. | Zadavatel spolu s částí 1 |
| O15 | **Cílová úroveň přístupnosti a rozsah.** | WCAG 2.2 AA v celé aplikaci i na veřejných stránkách. Viz kapitola 11. | Zadavatel, má to dopad na rozsah práce |
| O16 | **Dopadá na produkt European Accessibility Act a v jakém rozsahu?** | Nedokázal jsem to ověřit, viz 11.2. Bez ohledu na výsledek cílíme na WCAG 2.2 AA. | Právník, ne technický tým |
| O17 | **Doplnit ověřené srovnání s konkurencí**, hlavně s Ecomailem. | Zadat znovu jako samostatný úkol. Nebrání to postupu, ale sekce 0.3 a 8.6.1 by si to zasloužily. | Orchestrátor |
| O18 | **Povolit MPL-2.0 pro vývojové závislosti v licenční bráně?** | Ano, s výslovným seznamem výjimek. Jinak nejde použít `axe-core`. Viz 16.4. | Zadavatel spolu s částí 1 |
| O19 | **Smí editor exportovat kontakty, které smí smazat?** | Zavést `contacts:export_before_delete` omezené na mazanou množinu, s auditem. Viz R18. | Zadavatel, je to kompromis mezi ochranou PII a ochranou před ztrátou dat |
| O20 | **Má rozhraní ukazovat přesný počet řádků v tabulce kontaktů?** | Ne pro obecnou tabulku (odhad s vlnovkou stačí), ano pro segment a publikum kampaně. Viz R19. | Zadavatel |
| O21 | **Kolik z devíti podob detailu kontaktu je v MVP 0?** | Všechny odznaky a věty ano (je to jen text podle stavu), vysvětlující blok jen u `processing_restricted`, protože jen ten mění chování neviditelně. Viz 8.8.1. | Zadavatel |
| O22 | **Zobrazovat na blokovaných adresách maskované adresy?** | Maskovat, s odkrytím na kliknutí a zápisem do auditu. Viz 8.10.1. | Zadavatel |
