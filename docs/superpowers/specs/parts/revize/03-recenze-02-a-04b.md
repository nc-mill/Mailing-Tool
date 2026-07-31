# Křížová revize: části 2 a 4b očima části 3

Recenzent: part3-obsah (vlastník blokového modelu, kompilace šablony, Liquid validátoru, merge tagů a AI)
Datum: 2026-07-31
Recenzované soubory: `parts/04b-sender.md` (1847 řádků), `parts/02-kontakty.md` (3475 řádků)
Referenční: `parts/01-platforma.md` sekce 4.10.2 (kontrakt Liquid subsetu), `parts/03-obsah.md`

---

## Souhrn

| Závažnost | 04b sender | 02 kontakty | Celkem |
|---|---|---|---|
| Blokující | 3 | 0 | 3 |
| Vážné | 5 | 4 | 9 |
| Drobné | 4 | 3 | 7 |
| **Celkem** | **12** | **7** | **19** |

**Oba dokumenty jsou kvalitní** a v obou případech je většina nálezů typu "dvě části popisují totéž jinak", ne "je to špatně". Autor části 4b sám našel 21 vlastních rozporů (K1 až K21) a několik z nich se přímo dotýká části 3; ty potvrzuji a doplňuju o dopad, který ze své strany vidím.

**Nejdůležitější věta celé revize:** dnes **nelze** zaručit, že náhled v editoru a odeslaný e-mail budou shodné. Chybí k tomu čtyři konkrétní věci, jsou vyjmenované v kapitole 4. Tři z nich jsou levné, jedna vyžaduje změnu zmrazeného kontraktu.

**Vlastní chyby, které jsem revizí našel u sebe:** části 3 se týkají nálezy S1, S6, S8, S9, K1, K8. U všech se hýbe část 3, ne recenzovaný dokument. Vypsal jsem je sem schválně, aby bylo vidět, kdo co opravuje.

---

## 1. Část 4b: sender

Tohle je nejdůležitější šev v projektu. Část 3 dělá fázi 1 (blokový JSON na HTML s nedotčenými Liquid placeholdery), sender fázi 2 (interpolace per příjemce, přepis odkazů, MIME).

### S1. BLOKUJÍCÍ: části 3 a 4b popisují tři různé značky pro totéž

**Kde:** `04b-sender.md`, sekce 3.7.1 (ř. 832 až 835) a požadavek P3.1 (ř. 1728).

Sender doslova očekává:

> | `__OE_CLICK_<n>__` | místo hodnoty `href` u každého odkazu; `<n>` je `campaign_links.position` |
> | `__OE_OPEN_PIXEL__` | těsně před `</body>` |

Část 3 (`03-obsah.md`, sekce 4.1, body 3, 4 a 6) slibuje něco jiného:

- open pixel jako **komentář** `<!--OE_OPEN_PIXEL-->`,
- trackovatelné odkazy označené **atributem** `data-oe-link="<id>"` s ponechanou původní URL v `href`,
- odkazy v prostém textu jako `[[oe:link:<id>]]`.

Tři různé tvary pro tři různá místa. Kdyby se to nesladilo, sender by v `compiled_html` nenašel ani jednu značku, poslal by e-maily **bez trackovacího pixelu a bez přepsaných odkazů**, a nikde by to nespadlo. Report kampaně by ukazoval nulová otevření a nulové prokliky a hledalo by se to dlouho.

**Kdo se hýbe: část 3.** Návrh senderu je věcně lepší a přijímám ho beze zbytku:

1. Sender **neparsuje HTML**, což je správně. Kdyby ho parsoval a znovu serializoval, poškodil by podmíněné komentáře `<!--[if mso]>`, na kterých stojí zobrazení v Outlooku. Můj `data-oe-link` by parsování vyžadoval.
2. Značka na místě `href` řeší problém, kterého jsem se bál: **tlačítko má odkaz dvakrát**, jednou ve VML variantě uvnitř `<!--[if mso]><v:roundrect href="…">` a jednou v tabulkové variantě mimo podmíněný komentář. Prostá záměna řetězce nahradí obě stejnou hodnotou, takže tlačítko povede v Outlooku i jinde na totéž. S atributovým přístupem by sender musel rozumět VML, což je nesmysl.
3. `TRACKING_DOMAIN` nezůstává ve zkompilované kampani, takže změna adresy instalace nezneplatní zkompilované kampaně.

**Co část 3 změní:**

| Bylo v 03-obsah.md | Bude |
|---|---|
| `<!--OE_OPEN_PIXEL-->` | `__OE_OPEN_PIXEL__` |
| `data-oe-link="<id>"` plus původní URL v `href` | `href="__OE_CLICK_<n>__"` |
| `[[oe:link:<id>]]` v prostém textu | `__OE_CLICK_<n>__` v prostém textu |
| invariant I2 hlídá jeden výskyt `<!--OE_OPEN_PIXEL-->` | hlídá jeden výskyt `__OE_OPEN_PIXEL__` |
| invariant I3 počítá `data-oe-link` | počítá `__OE_CLICK_` |

Přijímám i **P3.2** (při `track_clicks = false` značky negenerovat a nechat původní URL). Je to lepší než varianta, kde sender čte `campaign_links`, a ušetří mu to jednu závislost.

**Přijímám i P3.5 a P3.6**, obojí se shoduje s tím, co už mám v 3.7.7: běhová Liquid chyba znamená `failed` u jednoho příjemce a kampaň se nezastaví; neexistující proměnná je prázdný řetězec bez strict mode.

---

### S2. BLOKUJÍCÍ: `blank` a `empty` rozbíjejí shodu náhledu a odeslání

**Kde:** `04b-sender.md`, nález K4 (ř. 1854 až 1891). **Potvrzuji ho a zvyšuju závažnost z "vážný" na "blokující"**, protože jako jediný z celého seznamu láme hlavní slib produktu.

Autor 4b ověřil ve zdrojovém kódu `osteele/liquid` v1.8.1 (`expressions/scanner.rl`), že lexer zná jen `true`, `false` a `nil`. Kontraktní gramatika v části 1 (4.10.2) ale povoluje i `blank` a `empty` a normativní pravidlo 4 na nich staví.

Jeho tabulka dopadu je přesná a stojí za zopakování:

> `{% if contact.first_name == blank %}Dobrý den{% else %}Dobrý den, {{ contact.first_name_vocative }}{% endif %}` s `first_name = ""`
> LiquidJS (náhled): první větev. `osteele/liquid` (odeslání): **druhá větev.**

Uživatel by v náhledu viděl "Dobrý den" a odeslalo by se "Dobrý den, " s visící čárkou. To je doslova ta chyba, kterou hlavní specifikace v kapitole 6.3 označuje za amatérskou a kvůli které se do produktu dával vokativ.

**Proč to zhoršuju na blokující, ačkoliv to CI zachytí.** Autor 4b správně píše, že fixtures `LQ-3xx` to chytí. Chytí to ale jako **neopravitelný červený test**, protože oprava vyžaduje změnu zmrazeného kontraktu. Do té doby je build červený a nikdo neví, jestli je to ta známá věc, nebo něco nového. Červený test, který se má ignorovat, je horší než žádný test.

**Druhý dopad, který 4b vidět nemůže:** můj validátor je psaný **proti kontraktu**, takže dnes `blank` a `empty` **přijímá**. Uživatel tedy může uložit šablonu, která projde validací, vypadá správně v náhledu a rozbije se až u příjemce. Validátor je poslední místo, kde se to dá zachytit levně.

**Doporučuju řešení 3 z K4** (vyřadit `blank` a `empty` z gramatiky a nahradit je vlastním filtrem), s jedním upřesněním: **místo filtru `is_blank` doporučuju povolit prosté porovnání `!= ""`** a nic nepřidávat.

| Varianta | Pro | Proti |
|---|---|---|
| Vlastní filtr `is_blank` | Pokryje i řetězec ze samých mezer | Šestý filtr, další věc v kontraktu, další fixtures, a filtr v podmínce kontrakt jinak nepovoluje (`liquid_filter_in_condition`) |
| **Porovnání `!= ""`** | Nic se nepřidává, funguje v obou knihovnách, gramatika už to umí | Nepokryje `"   "` |

Řetězec ze samých mezer je v kontaktní databázi okrajový případ a dá se ošetřit trimem při zápisu kontaktu (část 2), což je stejně správnější místo. Navrhuju tedy: **z gramatiky vyřadit `blank` a `empty`, nic nepřidávat, a část 2 ať při zápisu ořezává bílé znaky na krajích textových polí.**

**Do rozhodnutí** (kontrakt je zmrazený, mění ho jen team lead) **můj validátor `blank` a `empty` odmítne** s hláškou "zatím nepodporováno, použijte `!= \"\"`". Vědomě se tím odchyluju od kontraktu směrem k přísnějšímu, což je bezpečné: šablona, kterou pustím, projde i podle kontraktu.

---

### S3. BLOKUJÍCÍ: 4b si uvnitř sebe protiřečí ohledně Liquidu v `href`

**Kde:** `04b-sender.md`, sekce 3.7.1 bod 4 (ř. 842) proti požadavku P3.4 (ř. 1731).

Sekce 3.7.1 uvádí jako výhodu značkového návrhu:

> 4. Nemůže se stát, že by se přepsal odkaz, který přepsat nemá (například `{{ unsubscribe_url }}`), protože fáze 1 rozhoduje, co značkou je.

Tedy: Liquid v `href` **existuje a je v pořádku**, jen se z něj nedělá značka.

O 900 řádků dál P3.4 požaduje pravý opak:

> | P3.4 | Validátor odmítne Liquid tag **uvnitř hodnoty `href`** | Dynamická URL se nedá zaznamenat do `campaign_links` a nešla by trackovat. |

Obojí nemůže platit. Kdybych P3.4 implementoval doslova, **odmítnu odhlašovací odkaz**, tedy jedinou věc, která v e-mailu být musí, a rozbiju blok patičky i pravidlo S4 z části 3 ("dokument musí obsahovat odkaz na odhlášení").

**Návrh řešení**, který smiřuje obojí a je implementovatelný:

| Tvar `href` | Chování fáze 1 | Trackuje se? |
|---|---|---|
| Statická URL (`https://shop.cz/akce`) | nahradí se značkou `__OE_CLICK_<n>__`, URL jde do `campaign_links` | ano |
| Celý `href` je jeden systémový merge tag (`{{ unsubscribe_url }}`, `{{ preferences_url }}`, `{{ webview_url }}`) | ponechá se jako Liquid výraz, značka se negeneruje | ne, a je to správně |
| Statická URL s Liquidem uvnitř (`https://shop.cz/?utm={{ campaign.name }}`) | **validátor odmítne**, kód `liquid_in_trackable_href` | neaplikovatelné |
| Liquid v `href` u kontaktního pole (`{{ contact.attr.moje_url }}`) | **validátor odmítne** | neaplikovatelné |

Tedy: P3.4 platí, ale s výjimkou pro **uzavřený seznam tří systémových URL tagů**, které se stejně netrackují. Formuluju to takto, protože "odmítni Liquid v href" a "odhlašovací odkaz je Liquid v href" jsou obojí pravda a rozdíl je v tom, o který tag jde.

Třetí řádek tabulky (statická URL s Liquidem uvnitř) je vědomé omezení produktu, které je potřeba přiznat: **do trackovaného odkazu nejde vložit personalizaci**. UTM parametry s názvem kampaně tedy musí doplnit kompilace jako konstantu, ne Liquid. To je splnitelné, protože kompilace běží jednou na kampaň a název kampaně v tu chvíli zná.

---

### S4. VÁŽNÉ: pořadí operací dovolí datům kontaktu podstrčit trackovací odkaz

**Kde:** `04b-sender.md`, sekce 3.7.1, "Pořadí operací je závazné" (ř. 850 až 858).

> ```
> 1. Liquid interpolace (3.6)
> 2. náhrada značek __OE_CLICK_n__ a __OE_OPEN_PIXEL__
> 3. sestavení MIME (3.8)
> ```
> Náhrada značek běží **po** interpolaci. Kdyby běžela před ní, mohla by interpolovaná data rozbít token uvnitř URL. Zároveň to znamená, že když si uživatel do textu napíše doslova `__OE_CLICK_3__`, nahradí se mu to. Validátor v části 3 má tenhle literál v uživatelském textu odmítnout.

Dva problémy.

**a) Zdůvodnění nesedí.** Značka je celá hodnota `href`, tedy statický řetězec ve zkompilované šabloně. Nahradí se plnou trackovací URL, která žádný Liquid neobsahuje. Následná interpolace tedy nemá co rozbít. Obrácené pořadí (náhrada, pak interpolace) je bezpečné.

**b) Validátor části 3 tu díru zavřít nemůže.** P3.3 chce, abych literál `__OE_CLICK_` odmítl v uživatelském textu. To umím a udělám. Jenže riziko není v textu šablony, ale v **datech kontaktu**, na která validátor nevidí. Kontakt, jehož vlastní pole `poznamka` obsahuje řetězec `__OE_CLICK_3__`, dostane po interpolaci do textu funkční trackovací odkaz na cizí cíl. Import CSV od zákazníka je přesně to místo, odkud se takový řetězec vezme.

Není to zneužitelné ve velkém (útočník by musel umět zapsat hodnotu do kontaktu a znát čísla odkazů), ale je to tichá manipulace se statistikou kampaně a nulová cena za opravu.

**Návrh:** obrátit pořadí na `náhrada značek → Liquid interpolace → MIME`. Pak žádná interpolovaná hodnota nemůže značku vyrobit, protože v tu chvíli už žádné značky neexistují. Požadavek P3.3 pak stačí jako **varování** v editoru, ne jako tvrdé odmítnutí.

Jediné, co je při obráceném pořadí potřeba ohlídat: náhrada nesmí proběhnout uvnitř Liquid výrazu. Protože značka je vždy celá hodnota `href` a nikdy nesousedí s `{{`, je to splněné konstrukcí.

---

### S5. VÁŽNÉ: `<n>` ve značce je třístranný kontrakt, který nikdo nevlastní

**Kde:** `04b-sender.md`, ř. 834 (`<n>` je `campaign_links.position`) a P5.8 (ř. 1747).

Značka `__OE_CLICK_<n>__` váže dohromady tři části:

- **část 3** čísluje odkazy při kompilaci a vloží značku do HTML,
- **část 4a** zapisuje řádky do `campaign_links` s `position`,
- **část 4b** z `<n>` staví trackovací token a **část 5** ho ověřuje.

Nikde není napsáno, **kdo `position` přiděluje a podle jakého pravidla**. Moje `CompileMeta.links[]` má dnes `id` ve tvaru `l1`, `l2` a zvlášť pole `position`, což je o jedno pojmenování víc, než je zdrávo.

Kdyby si číslování určila část 4a nezávisle (například pořadím `INSERT`), rozešlo by se to s pořadím ve značkách a **kliknutí na "Koupit" by se v reportu započítalo odkazu "Odhlásit se"**. Nespadlo by nic.

**Návrh, jednou větou do všech tří dokumentů:** `position` přiděluje **kompilace v části 3**, je to pořadové číslo od 1 v pořadí prvního výskytu odkazu v dokumentu (HTML část, průchod stromem shora dolů, prostý text ho dědí), stejný cíl použitý dvakrát dostane **stejné** číslo, a část 4a `campaign_links` plní **z `CompileMeta.links`**, ne vlastním průchodem. Zruším své `links[].id` a nechám jen `position`.

---

### S6. VÁŽNÉ: zalomení prostého textu rozbije nahrazený odkaz

**Kde:** `04b-sender.md` ř. 830 (značky jsou i v `compiled_text`) proti `03-obsah.md`, sekce 3.5 (prostý text se zalamuje na 78 znaků).

Část 3 zalamuje prostý text na 78 znaků **při kompilaci**. Sender pak nahradí `__OE_CLICK_3__` (14 znaků) trackovací URL, která má reálně 80 až 120 znaků. Značka umístěná uprostřed odstavce vyrobí po náhradě řádek dlouhý přes 150 znaků, a hlavně: pokud jsem při zalamování rozdělil řádek **těsně za značkou**, výsledná URL bude končit na konci řádku a mnoho poštovních klientů ji uřízne nebo z ní udělá nefunkční odkaz.

**Kdo se hýbe: část 3.** Doplním do pravidel generování prostého textu (3.5):

- řádek obsahující `__OE_CLICK_<n>__` se **nezalamuje**,
- značka stojí vždy **na samostatném řádku**, obklopená prázdnými řádky, ne uprostřed věty,
- odkaz v prostém textu má tedy vždy tvar `Zjistit více:` na jednom řádku a značka na dalším.

Bez toho by prostý text vypadal dobře v mém náhledu a rozbitě ve skutečné zprávě, což je zase ta samá třída chyby.

---

### S7. VÁŽNÉ: preheader se může vyrenderovat dvakrát

**Kde:** `04b-sender.md`, sekce 3.6 ř. 734 (vstupem senderu je i `preheader`) a P3.7 (ř. 1734).

> | P3.7 | Preheader je součástí HTML (skrytý blok), ne samostatná hlavička | Sender ho interpoluje jako samostatnou šablonu jen kvůli náhledu a `render_data`. Potřebuji vědět, kam ho v HTML vkládáte. |

**Odpověď části 3:** preheader je v `compiled_html` **už zapečený**, jako první sekce dokumentu, ve skrytém `<div>` s `display:none; mso-hide:all` a výplňovými znaky (`03-obsah.md`, sekce 3.9.2). Vkládá ho generátor základní šablony při kompilaci, hodnotu bere z pole kampaně.

**Z toho plyne varování pro sender:** `campaigns.preheader` **nesmí sender vkládat do těla znovu**. Kdyby ho vložil, objeví se v e-mailu dvakrát, jednou skrytě a jednou viditelně. Ze sekce 3.6 se dá číst, že preheader je čtvrtá šablona, kterou sender interpoluje, ale není napsané, co s výsledkem dělá.

**Návrh:** doplnit do 3.6 jednu větu, že výsledek interpolace `preheader` se používá **výhradně** pro `render_data` a diagnostiku a do žádné části MIME zprávy se nezapisuje.

Zároveň je tím zodpovězená druhá polovina P3.7: v HTML je preheader jako první element `<body>`, před vším ostatním obsahem.

---

### S8. STŘEDNÍ: oříznutí polí na 200 prvků se musí dít i v náhledu

**Kde:** `04b-sender.md`, sekce 3.6 ř. 793 a nález K15 (ř. 2086).

> **200 iterací:** knihovna přerušit vestavěný `for` neumí. Řeší se **oříznutím polí v `render_data` před renderem**. Musí to obě strany dělat identicky, jinak se výstup rozejde u 201. prvku.

Souhlasím s návrhem i s tím, že kontraktní formulace ("cyklus se ukončí") je nepřesná a má se přeformulovat na "pole se zkrátí".

**Co 4b nemůže vidět:** "obě strany" nejsou jen sender a fixtures, ale i **náhled v editoru**. Náhled si data staví sám (`03-obsah.md`, 3.11.3: vzorová data, konkrétní kontakt, náhodný vzorek publika) a dnes nic neořezává. Kontakt s 250 položkami v poli `multi_enum` by se v náhledu zobrazil celý a odeslal by se zkrácený.

**Kdo se hýbe: část 3.** Oříznutí na 200 prvků patří do sdílené funkce v `packages/contracts`, kterou volá **materializace (4a), sender (4b) i náhled (3)**. Ne tři nezávislé implementace téhož `slice(0, 200)`.

---

### S9. STŘEDNÍ: `upcase` nad `ß` a co z toho plyne pro TypeScript

**Kde:** `04b-sender.md`, nález K19 (ř. 2151 až 2166). Potvrzuji.

Go `strings.ToUpper("ß")` vrací `ß` (simple mapping, což kontrakt předepisuje), JavaScript `"ß".toUpperCase()` vrací `SS` (full mapping). České znaky jsou v pořádku, ověřeno na obou stranách.

**Přijímám důsledek pro svou stranu:** implementace filtru `upcase` v TypeScriptu **nesmí** být prosté `toUpperCase()`. Musí to být simple mapping, tedy s výjimkou pro `ß` a další znaky s vícepísmenným full mappingem (`ﬁ`, `ŉ`, `ǰ`, řecké `ΐ`). Zapíšu to do popisu filtru v části 3 a doplním fixture.

Německé příjmení v české databázi kontaktů opravdu není nic zvláštního, takže to není akademický případ.

---

### S10. STŘEDNÍ: čísla nad 2^53 v `render_data`

**Kde:** `04b-sender.md`, nález K20 (ř. 2170). Potvrzuji a doplňuju.

Reálný případ, který autor 4b uvádí (variabilní symbol nebo číslo objednávky uložené jako číslo), je v českém e-shopovém prostředí běžný: variabilní symbol má často 10 číslic, což se ještě vejde, ale číslo faktury s časovým razítkem už ne.

**Doplnění z mé strany:** rozhodnutí se musí promítnout i do **náhledu**, jinak uvidí uživatel v editoru `9007199254740993` a v e-mailu `9007199254740992`. Doporučuju variantu "část 2 serializuje číselná vlastní pole do `render_data` jako řetězec, když jejich absolutní hodnota přesáhne 2^53", protože je to jedno místo a nevyžaduje to zásah do dekodérů na třech stranách.

---

### S11. DROBNÉ: filtr `safe` je pokrytý, K11 se dá snížit

**Kde:** `04b-sender.md`, nález K11 (ř. 2010) a shrnutí na ř. 815.

> **Filtr `safe` se registruje automaticky a nejde odregistrovat.** `SetAutoEscapeReplacer` volá interně `AddSafeFilter()` a `Engine` nemá `UnregisterFilter`. Šablona s `{{ x | safe }}` obejde automatické escapování, které kontrakt označuje za nevypnutelné.

Nález je správný, ale **v praxi je uzavřený dvakrát ze strany části 3** a autor 4b to vědět nemůže:

1. Můj validátor propouští jen pět filtrů z kontraktu. `safe` mezi nimi není, takže šablona s `{{ x | safe }}` se **neuloží** a kampaň se z ní nezkompiluje.
2. Renderer navíc po vygenerování HTML kontroluje **invariant I1** (`03-obsah.md`, 3.4.6): každý výskyt `{{ ... }}` a `{% ... %}` ve výstupu se znovu naparsuje mým validátorem a při neúspěchu kompilace **selže**. Takže ani chyba v rendereru nedokáže `safe` do `compiled_html` dostat.

Do `compiled_html` se tedy `safe` nemůže dostat žádnou cestou, která nevede přes ruční zápis do databáze. **Navrhuju snížit K11 na drobné** a doplnit v senderu jen levnou pojistku: při načtení kampaně do cache prohledat `compiled_html` na `| safe` nebo `|safe` a při nálezu kampaň odmítnout s `template_invalid`. Je to jeden `strings.Contains` na kampaň, ne na zprávu.

---

### S12. DROBNÉ: dva enginy jsou správně, ale předmět potřebuje výslovné pravidlo

**Kde:** `04b-sender.md`, sekce 3.6 ř. 753.

> Sender proto drží **dva engine**: jeden s replacerem pro HTML, druhý bez pro plain text a pro `subject`. Ne jeden přepínaný za běhu.

Rozhodnutí je správné a chci ho podpořit, protože je snadné ho při implementaci "zjednodušit" na jeden engine. Předmět e-mailu **není HTML** a escapovat ho by znamenalo, že příjemce uvidí ve schránce `Slevy &amp; výprodej`.

**Doplnění, které v dokumentu chybí:** totéž pravidlo platí pro **část 3**. Náhled předmětu v editoru musí použít neescapující instanci LiquidJS. Doplním to do své sekce 3.11 a zmiňuju to sem, aby to bylo vidět z obou stran.

---

### S13. DROBNÉ: `unsubscribe_url` v hlavičce a v těle je stejný zdroj, dobře

**Kde:** `04b-sender.md`, sekce 3.7.2 (ř. 860 až 864).

> `{{ unsubscribe_url }}` přichází hotový v `render_data`. Sender ho **nevyrábí**, jen dosazuje. Používá se na dvou místech: v těle zprávy (přes merge tag) a v hlavičce `List-Unsubscribe` (3.8.2), kam ho sender bere přímo z `render_data.unsubscribe_url`.

Tohle je přesně ta odpověď, kterou jsem hledal, a je správná: jeden zdroj, dvě použití, takže hlavička a odkaz v těle nemůžou vést jinam. Bez nálezu.

Stejně tak souhlasím s tvrdým pravidlem, že chybějící `unsubscribe_url` je trvalá chyba a zpráva neodejde.

---

### S14. DROBNÉ: agregace `render_warning` se dotýká i předodesílací kontroly

**Kde:** `04b-sender.md`, ř. 796 a P5.11.

Autor 4b správně upozorňuje, že kampaň na 50 000 příjemců s jedním nevyplněným polem u poloviny z nich vyrobí 25 000 identických řádků v `message_events`, a doporučuje agregaci na dvojici (kampaň, cesta).

**Podporuju to a přidávám argument:** část 3 už tutéž informaci počítá **před odesláním** (`03-obsah.md`, 3.11.4, kontrola `precheck_empty_field_ratio`: "U 412 z 5 000 příjemců je pole Jméno prázdné"). Agregát po odeslání a agregát před odesláním by měly mít **stejný tvar a stejný výpočet**, jinak uživatel uvidí dvě různá čísla o téže věci. Doporučuju, aby obojí vlastnila jedna funkce v části 4a nad publikem kampaně.

---

## 2. Část 2: kontakty

### K1. VÁŽNÉ: vlastní pole se adresují `contact.attr.<key>`, část 3 čeká `contact.<key>`

**Kde:** `02-kontakty.md`, sekce 2.4, ř. 231.

> Vlastní pole se adresují **výhradně** přes prefix `attr`: `{{ contact.attr.<key> }}`, kde `<key>` musí existovat v `contact_fields` daného projektu a nesmí být archivované.

Část 3 (`03-obsah.md`, 3.8.2) říká: "Tag je `contact.<key>`, typ podle definice pole."

**Kdo se hýbe: část 3.** Prefix `attr` je lepší a důvod uvedený v části 2 je pádný: bez něj by uživatel založením pole s klíčem `greeting` zastínil systémové pole a rozbil si oslovení ve všech šablonách. Přepíšu katalog i příklady.

**Dva důsledky, které v části 2 nejsou napsané a měly by být:**

1. **`contact.attr.<key>` spotřebuje celý limit tří segmentů cesty** (kontrakt 4.10.2, pravidlo `path` má nejvýš 3 segmenty). Vlastní pole tedy nikdy nemůže mít vnořenou hodnotu a `{% for x in contact.attr.polozky %}{{ x.nazev }}{% endfor %}` **neprojde**, protože `x.nazev` je sice dvousegmentové, ale iterovatelné `contact.attr.polozky` je na hranici. Iterace nad polem skalárů funguje, nad polem objektů ne. Patří to do dokumentace obou částí, protože uživatel to zkusí.
2. Nabídka merge tagů v editoru musí systémová a vlastní pole viditelně oddělit, jinak bude prefix `attr` působit jako překlep.

---

### K2. VÁŽNÉ: smazání vlastního pole neřeší šablony, jen segmenty

**Kde:** `02-kontakty.md`, ř. 1145.

> Archivace pole (`archived_at`) skryje pole z UI a z nabídky merge tagů, ale data v `attributes` zůstanou. Segment, který archivované pole používá, dál funguje a v UI se u něj zobrazí varování. Smazání pole (`DELETE`) spustí job `contacts.strip_attribute`, který klíč po dávkách 10 000 odstraní z `attributes`, a všechny segmenty, které na něj odkazují, se označí jako `recompute_state = 'error'` s kódem `segment_field_missing`.

**Šablony se nezmiňují ani jednou.** Grep přes celý soubor: `findTemplatesUsingField` nula výskytů, `revalidate_templates` nula výskytů.

Část 3 přitom ve svém dokumentu (3.8.4, bod B) tvrdí, že část 2 před smazáním zavolá `findTemplatesUsingField(workspaceId, fieldPath)`, zobrazí dopad a po smazání zařadí job `content.revalidate_templates`. **Ani jedna strana to tedy nemá pořádně: já to slibuju za druhého, on o tom neví.** Klasická mezera z kapitoly 6 zadání.

**Co se dnes stane:** uživatel smaže pole `mesto`, hodnoty se odstraní z `attributes`, segmenty se označí červeně, a **šablona s `{{ contact.attr.mesto }}` vypadá dál v pořádku**. Odeslání kampaně by pak spadlo na mé validaci (3.8.4, bod C, tvrdá brána před materializací publika), takže rozbitá kampaň neodejde. Ale uživatel se to dozví až ve chvíli, kdy klikne na Odeslat, což je nejhorší možný okamžik.

**Návrh, symetricky se segmenty:**

1. Před smazáním i před archivací zobrazit dopad na **šablony i kampaně**, ne jen na segmenty. Část 3 na to dodá funkci `findTemplatesUsingField(workspaceId, path)` nad indexem `idx_templates__used_fields` (GIN nad `templates.used_fields`), který už mám.
2. Po smazání zařadit `content.revalidate_templates`, obdobu toho, co se dělá se segmenty.
3. Dialog má mít stejný tvar jako u segmentů: "Pole Město používají 3 segmenty, 2 šablony a 1 rozpracovaná kampaň."

---

### K3. VÁŽNÉ: archivace pole je prezentovaná jako bezpečná, ale rozbíjí šablony

**Kde:** `02-kontakty.md`, ř. 439 a 1145 proti ř. 231.

Ř. 439 popisuje archivaci jako neškodnou:

> Archivované pole je živý záznam: jeho hodnoty v `attributes` zůstávají, segmenty na něj dál fungují a merge tagy se jen přestanou nabízet.

Formulace "merge tagy se jen přestanou **nabízet**" zní jako změna v UI. Ř. 231 ale říká, že klíč **"nesmí být archivované"**, aby byl merge tag platný.

Ty dvě věty spolu nesedí. Když je archivované pole pro validátor neplatné, pak archivace **existující šablony okamžitě zneplatní** a kampaň s nimi nepůjde odeslat, přestože data v `attributes` pořád jsou a segment nad nimi dál funguje. Uživatel dostane dvě různá chování pro jednu operaci, přičemž to horší (šablony) je popsané slovem "jen".

**Návrh, sladit na chování segmentů:** archivované pole zůstává pro **existující** šablony platné (data existují, není důvod render odmítnout), jen se nenabízí pro **nové** použití a v editoru se u něj zobrazí varovný štítek. Neplatný je merge tag až po skutečném `DELETE`.

To je zároveň jediná varianta, která z archivace dělá to, co slibuje: bezpečný krok před smazáním.

---

### K4. VÁŽNÉ: katalog polí je dodaný ve dvou tvarech, ani jeden nesedí na validaci při psaní

**Kde:** `02-kontakty.md`, sekce 2.4 (ř. 205 až 233), P2-1 (ř. 170) a požadavek 3.4 (ř. 3339).

Část 2 dodává:

- **systémová pole** jako statický typovaný union `CONTACT_MERGE_FIELDS` v `packages/contracts/src/liquid/contact-fields.ts`,
- **vlastní pole** implicitně přes endpoint `GET /api/v1/contact-fields` (ř. 3339).

Část 3 předpokládala jedinou funkci `getFieldCatalog(workspaceId): Promise<FieldCatalog>` s poli `path`, `type`, `label`, `group`, `itemType`, `deleted`.

Statický union je pro systémová pole **lepší** než moje řešení, přebírám ho. Problém je druhá polovina:

**Validace běží při každém úhozu v editoru** (`03-obsah.md`, 7.2: cíl pod 20 ms). HTTP dotaz na `/api/v1/contact-fields` na každý úhoz nepřipadá v úvahu, a i s cache je REST endpoint špatný tvar pro věc, kterou volá server-side kompilace uvnitř téhož procesu.

**Návrh:** část 2 vystaví vedle endpointu i **funkci v `packages/core/contacts`**:

```ts
type CustomFieldDescriptor = {
  key: string;
  type: 'text'|'long_text'|'number'|'boolean'|'date'|'datetime'|'enum'|'multi_enum'|'url'|'email'|'phone';
  label: string;
  archived: boolean;
  options?: { values: string[] };
};
function getCustomFields(workspaceId: string): Promise<CustomFieldDescriptor[]>;
```

Část 3 si ji cachuje v paměti procesu na 60 sekund a v prohlížeči ji dostane jednou při otevření editoru. Endpoint zůstává pro veřejné API, ale není to cesta, kterou chodí validace.

---

### K5. STŘEDNÍ: `long_text` nemá jak vyrobit odstavce

**Kde:** `02-kontakty.md`, ř. 418, typ `long_text`.

Typ `long_text` existuje, ale v e-mailu je nepoužitelný pro to, k čemu svádí. Řetězec s odřádkováním se v HTML části **automaticky escapuje** (kontrakt 4.10.2) a znaky `\n` se v HTML nezobrazí. Subset nemá filtr `newline_to_br` a mít ho nebude. Výsledkem je jeden slepený odstavec.

Uživatel si tedy založí pole "Poznámka k objednávce" typu `long_text`, vloží ho do šablony, v náhledu i v mailu dostane text bez odřádkování a nebude vědět proč.

**Návrh, tři varianty podle chuti:**

1. Editor u merge tagu typu `long_text` zobrazí varování "Odřádkování se v e-mailu nezobrazí" (levné, dělá část 3).
2. Materializace do `render_data` převede `\n` na mezeru, aby aspoň nevznikaly slepená slova (dělá část 2).
3. Typ z nabídky vypustit, pokud pro něj neexistuje jiné použití než segmentace.

Doporučuju kombinaci 1 a 2. Rozhodnutí patří části 2, protože typ vlastní ona.

---

### K6. STŘEDNÍ: serializace `multi_enum` a `date` do `render_data` není popsaná

**Kde:** `02-kontakty.md`, ř. 233 (jediná zmínka) a typy na ř. 418.

> Seznam je zároveň zdrojem pro extrakci polí do `messages.render_data` (kontrakt 4.10.1 části 1).

To je věta o **systémových** polích. Pro vlastní pole a jejich typy chybí odpověď na tři věci, které rozhodují o tom, jestli šablona funguje:

| Otázka | Proč na tom záleží |
|---|---|
| Jak se serializuje `multi_enum`? Jako pole řetězců? | Je to jediný typ, přes který jde `{% for %}`. Když se serializuje jako spojený řetězec, cyklus nefunguje a validátor to nemá jak poznat. |
| Nese `enum` a `multi_enum` do `render_data` **klíč**, nebo **popisek**? | Rozhoduje o tom, co uvidí příjemce v e-mailu. `plan_pro` versus `Profesionál` je rozdíl, který nejde opravit filtrem. |
| Jak se serializuje `date` a `datetime`? | Filtr `date` v Go potřebuje jednoznačný tvar. Kontrakt 4.10.2 uvádí "řetězec RFC 3339 s explicitní zónou, celé číslo (unix), nebo `now`". Část 2 to nepotvrzuje ani nevyvrací. `date` bez času musí být taky RFC 3339, ne `2026-08-01`. |

Doplňuju k tomu i **prázdné hodnoty**: filtr `default` nahradí při `nil`, `false`, `""` a prázdném poli. Aby to fungovalo předvídatelně, musí být jasné, jestli nevyplněné pole typu `number` je v `render_data` `null`, nebo `0`. Rozdíl je v tom, že u `0` se `default` neuplatní.

---

### K7. STŘEDNÍ: typ `url` naráží na zákaz Liquidu v `href`

**Kde:** `02-kontakty.md`, ř. 418 (typ `url`) proti `04b-sender.md` P3.4.

Typ `url` existuje zjevně proto, aby se dal vložit do odkazu. Sender ale požaduje, aby validátor Liquid uvnitř `href` odmítl (nález S3 výše).

Po zavedení pravidla z S3 bude `<a href="{{ contact.attr.moje_url }}">` **neplatné**, takže typ `url` půjde použít jen jako viditelný text, ne jako cíl odkazu. To je použitelné (personalizovaný odkaz jde napsat i jako text), ale je to překvapivé a patří to do dokumentace obou částí i do hlášky validátoru.

Alternativa, kdyby to bylo pro produkt důležité: zavést blok "personalizovaný odkaz", který se do `campaign_links` zapíše jako "dynamický" a **netrackuje se**. To je rozhodnutí pro team leada, ne pro mě.

---

### K8. DROBNÉ: `contact.status` a `contact.last_activity_at` v mém katalogu chybně

**Kde:** `02-kontakty.md`, sekce 2.4, ř. 226 až 231, proti `03-obsah.md`, 3.8.2.

Část 2 vyjmenovává povolený kořen `contact.*` a záměrně z něj vynechává `status`, `source`, `vocative_confidence` a všechny sloupce s `_at` kromě `created_at`:

> Jsou to interní údaje, které nemají co dělat v těle e-mailu.

Můj katalog v 3.8.2 uvádí `contact.status` a `contact.last_activity_at`. **Hýbe se část 3**, argument části 2 je správný, u `status` obzvlášť.

**Jedna prosba na zvážení:** `last_activity_at` má legitimní použití v reaktivační kampani ("naposledy jste se u nás rozhlíželi v březnu"), což je preset, který hlavní specifikace přímo jmenuje v kapitole 6.2. Buď ho do seznamu doplnit, nebo do dokumentace napsat, že se do reaktivační šablony dosazuje jinak. Nechávám rozhodnutí na části 2.

---

### K9. DROBNÉ: předodesílací upozornění na vokativ existuje dvakrát

**Kde:** `02-kontakty.md`, ř. 1531 proti `03-obsah.md`, 3.11.4.

Část 2:

> Kampaň, jejíž šablona používá `{{ contact.greeting }}` nebo `{{ contact.first_name_vocative }}`, zobrazí před odesláním upozornění

Část 3 má vlastní předodesílací kontrolu se seznamem nálezů (`precheck_*`), včetně `precheck_empty_field_ratio`.

Není to rozpor, ale **překryv**: dvě části popisují jednu obrazovku. Hrozí, že vzniknou dvě upozornění nad sebou, každé z jiného kódu a s jiným vzhledem.

**Návrh:** obrazovku a její seznam nálezů vlastní **část 3** (mám ji jako 3.11.4), část 2 do ní **přispívá nálezem** `precheck_vocative_low_confidence` přes registr kontrol. Detekce "kolik kontaktů má nejistý vokativ" zůstává v části 2, kam patří.

---

### K10. DROBNÉ: `greeting` je vyřešený dobře, bez nálezu

Ověřoval jsem to jako první, protože na `{{ contact.greeting }}` stojí moje výchozí šablona. Část 2 to má v pořádku:

- je to **uložený sloupec** `greeting text NOT NULL DEFAULT ''` (ř. 301), ne funkce v šabloně, což odpovídá kapitole 6.3 hlavní specifikace i požadavku části 3,
- přepočítává se při změně `first_name`, `last_name`, `gender`, vokativů nebo `locale` (ř. 1455),
- změna nastavení projektu spouští `contacts.recompute_greeting` po dávkách 10 000, u 5 milionů kontaktů jednotky minut, což je přijatelné,
- `first_name_vocative` i `last_name_vocative` jsou v `CONTACT_MERGE_FIELDS`,
- při "Nepoužívat jméno" spadne `greeting` na neutrální tvar (ř. 1521), takže visící čárka nevznikne.

Bez nálezu. `NOT NULL DEFAULT ''` navíc znamená, že `greeting` v `render_data` nikdy nechybí, jen může být prázdný, což je pro filtr `default` předvídatelné.

---

## 3. Nálezy proti vlastní části 3

Aby bylo jasné, kdo co opravuje. Všechno níž mění `03-obsah.md`, ne recenzovaný dokument.

| Nález | Co změním |
|---|---|
| S1 | Značky na `__OE_CLICK_<n>__` a `__OE_OPEN_PIXEL__`, včetně invariantů I2 a I3 a kontraktu v 4.1 |
| S2 | Validátor dočasně odmítne `blank` a `empty`, dokud se nerozhodne o kontraktu |
| S3 | Pravidlo o Liquidu v `href`: povolený jen uzavřený seznam tří systémových URL tagů |
| S5 | Zruším `links[].id`, nechám jen `position`, a určím pravidlo jeho přidělování |
| S6 | Prostý text: řádek se značkou se nezalamuje, značka stojí na samostatném řádku |
| S8 | Oříznutí polí na 200 prvků přesunu do sdílené funkce, kterou volá i náhled |
| S9 | `upcase` v TypeScriptu jako simple mapping, ne `toUpperCase()` |
| S12 | Náhled předmětu neescapující instancí LiquidJS |
| K1 | Vlastní pole jako `contact.attr.<key>` v celém katalogu i příkladech |
| K8 | Vyřadím `contact.status` a `contact.last_activity_at` z katalogu |

---

## 4. Odpověď na otázku: dá se zaručit shoda náhledu a odeslání?

**Dnes ne.** Ale dá se, a chybí k tomu čtyři konkrétní věci, ne obecné úsilí.

Shoda náhledu a odeslání znamená, že pro **stejný dokument a stejná data** platí: co uživatel vidí v editoru, to příjemce dostane. Rozloženo na podmínky, které musí platit všechny naráz:

| # | Podmínka | Stav | Co chybí |
|---|---|---|---|
| 1 | **Jeden renderer fáze 1.** Náhled i odeslání používají tentýž kód `Document → HTML`. | **splněno** | Náhled v části 3 volá `compileDocument()`, ne vlastní vykreslení. Rozdíl je z definice nulový. |
| 2 | **Shodná gramatika.** Validátor propouští jen to, co obě knihovny umí. | **nesplněno** | `blank` a `empty` (nález S2). Kontrakt je povoluje, Go je neumí. **Jediná položka, která vyžaduje změnu zmrazeného kontraktu.** |
| 3 | **Shodné filtry.** Pět vlastních implementací na obou stranách, bajtově stejný výstup. | **skoro** | Rozhodnutí kontraktu je správné a sender ho implementuje (4b, ř. 747). Chybí simple mapping u `upcase` v TypeScriptu (S9) a rozhodnutí o číslech nad 2^53 (S10). |
| 4 | **Shodná data.** Náhled a materializace staví `render_data` stejně. | **nesplněno** | Oříznutí polí na 200 prvků dnes dělá jen sender (S8). Serializace `multi_enum`, `enum`, `date` a prázdných hodnot není popsaná (K6). |
| 5 | **Zásahy senderu do HTML jsou předvídatelné.** | **nesplněno** | Značky se neshodují (S1). Po sladění je to splněné z definice, protože sender dělá jen záměnu řetězců a HTML neparsuje. |
| 6 | **Shoda se testuje, ne předpokládá.** | **splněno** | Golden fixtures `LQ-*` běží v CI proti oběma implementacím a job `contracts-golden` je blokující. Bod 4 té definice ("obě strany musí zpracovat stejný počet souborů") je to, co skutečně brání tichému rozchodu. |

**Závěr pro rozhodnutí:** po vyřešení S1, S2, S8 a S9 **shodu zaručit lze**, a to nikoliv slibem, ale konstrukcí. Návrh senderu (žádné parsování HTML, jen záměna značek) je jediný důvod, proč to jde: kdyby sender HTML parsoval a znovu serializoval, shoda by byla neověřitelná a tuhle odpověď bych napsat nemohl.

**Jedna výhrada, kterou je potřeba přiznat i po vyřešení všeho výše.** Shoda je zaručená na úrovni **bajtů odeslaného těla**, ne na úrovni toho, jak to vypadá ve schránce. Náhled se vykresluje v Chromiu nebo WebKitu v `<iframe>`, e-mail se zobrazuje ve Wordu, v Gmailu se sanitizovaným CSS nebo na Seznamu, který zahazuje `url()`. Zaručit umíme, že se odešle to, co uživatel schválil. Zaručit, že to všude vypadá stejně, neumí nikdo a stojí na tom celá kapitola 3.6 části 3 (matice klientů a ruční kontrolní seznam).

To je rozdíl, který by měl znát i netechnický recenzent, protože "náhled odpovídá odeslanému" a "e-mail vypadá všude stejně" jsou dvě různé věci a jen jednu z nich umíme slíbit.
