# Rozhodnutí pro zadavatele

Datum: 2026-07-31
Zdroj: sedm detailních specifikací v `parts/`, 25 700 řádků
Pro: člověka, který rozhoduje o produktu, ne pro vývojáře

## Jak tohle číst

Autoři sedmi částí specifikace narazili na otázky, které nemohli rozhodnout sami, protože nejsou technické, ale produktové, právní nebo obchodní. Tenhle dokument je sbírá na jedno místo.

**U každé otázky je doporučení.** Když s ním souhlasíte, stačí říct „ano" a jde se dál.

Dokument je řazený podle naléhavosti, ne podle částí.

---

## 1. Rozhodnutí, která blokovala start. Všechna padla.

Tahle kapitola je vyřízená. Zůstává tu proto, aby bylo dohledatelné, co se rozhodlo a proč.

### 1.1 Jazyk odesílacího enginu: **Go**

Aplikace je v TypeScriptu, ale komponenta, která fyzicky posílá maily, je samostatný program v kompilovaném jazyce. Ve hře byl Go a Rust.

**Rozhodnuto: Go.** Kompiluje se v sekundách místo minut, což na hackathonu rozhoduje, a základna lidí schopných přispět do open-source projektu v Go je výrazně větší. Výkonová výhoda Rustu se nemá o co opřít, protože strop určuje kvóta Amazonu, ne jazyk.

Volba je vratná: kontrakty jsou psané jazykově neutrálně, takže přepis senderu později nesáhne na nic jiného.

### 1.2 Verze databáze: **poslední produkční**

**Rozhodnuto jako pravidlo, ne jako číslo:** projekt cílí na poslední produkční verzi PostgreSQL, aktuálně 18. Číslo by za rok zestaralo, pravidlo ne.

Osmnáctka je podstatná proto, že generování identifikátorů je tam součástí jádra. Na sedmnáctce by je musela obcházet aplikace v každé migraci i v každém seedu.

### 1.3 Editor a renderer: **`react-email` plus vlastní tenké rozhraní**

Původní návrh byl použít `@usewaypoint/email-builder`. **Praktické ověření (nainstalováno a spuštěno, ne přečteno) ho vyřadilo:** balíček z npm editor vůbec neobsahuje, negeneruje hlavičku dokumentu, takže nemá responzivitu ani tmavý režim, a **neumí textovou variantu**, kterou specifikace vyžaduje.

**Rozhodnuto: `@react-email/components` jako renderer, editor vlastní.** MIT, 3,1 milionu stažení týdně proti 58 tisícům, oficiálně React 19, dává hlavičku dokumentu, preheader, tabulkový layout, konstrukce pro Outlook i textovou variantu. Že ta kombinace funguje není teorie, knihovna Maily je přesně ona.

Cena je **změřených zhruba 3 000 řádků** vlastního rozhraní, z toho polovina panel vlastností, což je mechanická formulářová práce.

Zamítnuté alternativy i s důvodem: **Maily** kvůli licenci (autor ji v roce 2025 vědomě změnil pryč od MIT, protože mu produkt přeprodávali, pak napsal, že je to „stoprocentně MIT", ale za patnáct měsíců to do balíčku nedoplnil). **GrapesJS** zůstává jako dokumentovaná náhradní cesta, zamítnut kvůli 400 kB v prohlížeči a nutnosti zamykat obecný stavitel webu.

### 1.4 Název produktu: **není blokátor**

Pracovní název byl OpenEngage a mění se. Nový zatím není určený.

**Neblokuje start vývoje, pokud se od prvního commitu píše jako jedna konstanta.** Cena změny je vysoká jen tehdy, když se jméno rozteče do desítek míst jako doslovný text. Když bude na jednom místě, přejmenování znamená změnit konstantu a přepočítat testovací vektory skriptem, což je práce na půl hodiny. Část 1 ty vektory přepočítala dvakrát za jeden den, takže víme, že to jde.

**Zapsat do implementačního plánu jako pravidlo.** Jméno se objevuje v odvození šifrovacích klíčů, v předponě API klíčů, v rezervované doméně pro trackovací odkazy, ve značce pro pixel, v prefixu CSS tříd a v názvu balíčků. Všude jako konstanta, nikde doslovně.

---

## 2. Produktová rozhodnutí

### 2.1 Kde je premisa „zvládne to i babička" nesplnitelná

Zadal jste laťku, aby nástroj obsloužil i netechnický člověk. Drtivá většina toho jde a specifikace to řeší. **Jedno místo ale zjednodušit nejde: nastavení DNS záznamů pro podpis odesílací domény.**

Bez nich pošta buď nedorazí, nebo skončí ve spamu. Vyžaduje to přístup ke správě domény a vložení tří až čtyř záznamů. Žádný nástroj na světě to za uživatele neudělá, protože k jeho doméně nemá přístup.

**Co s tím udělali autoři:** průvodce vygeneruje přesné hodnoty, ukáže je k zkopírování, sám ověří, jestli už jsou v DNS, a nabídne poslat návod e-mailem správci webu. Tedy: **odstínit nejde, delegovat ano.**

**Zajímavé zjištění z průzkumu:** self-hosted konkurence na tohle rezignovala úplně. Autor Listmonku to odmítá řešit se slovy „mimo rozsah projektu", Sendy odkazuje na dokumentaci Amazonu a Mautic nemá průvodce vůbec. Náš průvodce tedy není dohánění standardu, ale věc, kterou nikdo nemá.

**Doporučení:** přijmout, že tenhle jeden krok je technický, a soustředit se na to, aby byl co nejlépe vysvětlený a delegovatelný.

### 2.2 Má se kampaň při vysoké míře odrazů sama pozastavit?

**O co jde.** Když posíláte na hodně neplatných adres, Amazon vám nejdřív dá účet pod dohled a pak zablokuje odesílání. To je pro provozovatele existenční problém.

**Zjištění:** hlavní specifikace měla varovné prahy nastavené na hodnoty, **při kterých už Amazon jedná**. Varovat až tam je pozdě.

**Doporučení:** vícestupňově. Varování od 2 %, automatické pozastavení kampaně při 8 %. Uživatel dostane vysvětlení a kampaň může sám obnovit.

### 2.3 Co dělat, když nevíme, jestli zpráva odešla

**O co jde.** Občas se stane, že zavoláme Amazon a nedozvíme se výsledek (spadne spojení). Nevíme pak, jestli mail odešel, nebo ne. Buď to zkusíme znovu (riziko, že člověk dostane mail dvakrát), nebo ne (riziko, že ho nedostane vůbec).

**Rozhodnuto:** u Amazonu neopakovat, u obecného SMTP opakovat.

**Proč:** duplicitní mail příjemce vidí, štve ho a zvyšuje míru stížností, a právě míra stížností je to, kvůli čemu Amazon ruší účty. Nedoručený mail v padesátitisícové kampani je neviditelný a dá se doposlat.

**Autor senderu k tomu přidal lepší řešení:** ke každé zprávě se přiloží značka, kterou Amazon vrací ve svých hlášeních. Většina nejistých případů se tak rozřeší zpětně sama a bez duplikátu. Zbytek uvidí uživatel v reportu jako samostatnou kategorii „nejisté odeslání" a může je doposlat.

**K potvrzení:** souhlasíte s tou úvahou, že duplicita je horší než nedoručení?

### 2.4 Má nástroj sám zakládat věci v AWS účtu uživatele?

**O co jde.** Aby chodila hlášení o odrazech, musí v účtu uživatele vzniknout jistá konfigurace. Buď ji nástroj založí sám (potřebuje širší oprávnění), nebo ji uživatel vytvoří ručně podle návodu.

**Doporučení:** umět obojí. Výchozí je automatické založení, ruční režim jako alternativa pro ty, kdo nechtějí dávat širší oprávnění.

### 2.5 Role a oprávnění

Tři otázky, na které se dá odpovědět bez znalosti kódu:

- **Editor smí odeslat kampaň**, ale nesmí měnit nastavení odesílání ani exportovat kontakty. Sedí to? Alternativa je vyžadovat u odeslání schválení správcem, což ale znamená, že editor čeká u každé kampaně.
- **Prohlížeč nesmí exportovat kontakty**, protože export je jednorázový odnos celé databáze. Není to příliš přísné?
- **Registrace je po instalaci zavřená**, účty zakládá vlastník pozvánkou. Souhlasíte?

### 2.6 Marketingový slib „do pěti minut"

Instalace opravdu do pěti minut běží. **Odeslat první kampaň ale za pět minut nejde**, protože ověření domény v DNS trvá déle a nezávisí na nás.

**Doporučení:** říkat „do pěti minut běží", ne „do pěti minut máte hotovo".

### 2.7 Ukládání obrázků

**Doporučení:** pro první verzi lokální adresář. Zapsat do dokumentace, že běh na víc replikách vyžaduje sdílený svazek, ať to nikoho nepřekvapí.

---

## 3. Rizika, o kterých musíte vědět

**Otisky smazaných adres nejdou nikdy přepočítat.** Když někdo uplatní právo na výmaz, zůstane po něm jen zašifrovaný otisk adresy, aby mu omylem nepřišel další mail. Původní adresa je pryč. Důsledek: **bezpečnostní klíč se smí měnit, ale starý se nikdy nesmí zahodit**, jinak by se výmaz zneplatnil a smazaný člověk by se vrátil při nejbližším importu. Je to v dokumentaci ošetřené, ale provozovatel o tom musí vědět.

**Otisky nechrání proti úniku databáze i klíče zároveň.** E-mailové adresy jsou vyčíslitelná množina, takže kdo získá obojí, prolomí je hrubou silou bez ohledu na použité schéma. Chrání proti úniku samotné databáze. Patří to do dokumentace ke GDPR.

**Zálohy neobsahují bezpečnostní klíč** a obsahují osobní údaje. Chrání to zálohu při krádeži, ale provozovatel si klíč musí uložit zvlášť, jinak po havárii bude muset znovu zadat přístupy k rozesílání. **K potvrzení:** je to správný kompromis, nebo má být klíč v záloze a bezpečnost řešit šifrováním celé zálohy?

**Návrat na starší verzi jde jen obnovením ze zálohy.** Plnohodnotný návrat zpět je výrazně dražší a v praxi stejně málokdy funguje. **K potvrzení:** přijatelné?

**Čísla v reportech nebudou nikdy přesná.** Apple Mail předstírá otevření u všech mailů, adblockery blokují měření. Specifikace to řeší tím, že se to uživateli otevřeně řekne a jako spolehlivější ukazatel se nabízí prokliky. Konkurence to řeší různě, od zamlčení až po samostatný článek o tom, že míra otevření už nic neznamená.

---

## 3b. Dvě věci, které přišly na poslední chvíli a jsou vážné

### Trackovací pixel může vyžadovat souhlas, a produkt to dnes neumí

**Evropský sbor pro ochranu osobních údajů vydal v říjnu 2024 pokyny, které trackovací pixel v e-mailu výslovně řadí pod pravidla o souhlasu.** Autor části 5 z toho vyvozuje, že **nelze automaticky spoléhat na to, že souhlas se zasíláním obchodních sdělení pokrývá i měření otevření**, a že to je potřeba vyřešit s právníkem před spuštěním provozu.

**Konkrétní mezera:** kdyby právník řekl, že pixel souhlas vyžaduje, produkt by potřeboval umět **souhlas s měřením zvlášť u každého kontaktu** a schopnost u konkrétního příjemce pixel nevložit. Autor to napsal doslova: „Dnes to není v návrhu ani jedné části." **A nikdo to nevlastní.**

**Doporučení:** dát tuhle otázku právníkovi jako první z celého seznamu, protože z odpovědi plyne práce, kterou dnes nikdo nemá zadanou. Vypnout měření otevření per kampaň i globálně produkt umí, per kontakt ne.

### Nenastavená trackovací doména rozbije všechno a nikdo si toho nevšimne

Když provozovatel nenastaví doménu pro trackovací odkazy, sender vyrobí odkazy bez adresy serveru a **rozbije se každý pixel a každý proklik v kampani. Aplikace přitom nastartuje bez jediné chyby.**

Marketér uvidí kampaň s nulovou otevřeností a bude hledat příčinu v obsahu.

**Doporučení:** udělat tu proměnnou pro odesílací komponentu povinnou, aby se to projevilo pádem při startu, ne až u příjemce. Je to jednořádková změna a autoři ji navrhují.

---

## 3c. Rozhodnuto zadavatelem 2026-07-31

### Ukládání IP adres je volba provozovatele, ne naše

**Rozhodnuto: ukládání IP adres a země odvozené z IP bude nastavitelné na úrovni projektu.** Ve výchozím stavu vypnuté, zapínatelné.

Zdůvodnění zadavatele: provozovatel instalace je správcem osobních údajů. Existují provozovatelé, kteří mají GDPR vyřešené a IP adresy potřebují. **Je to jejich zodpovědnost a jejich rozhodnutí, ne naše.**

Původní návrh části 5 (IP se použije jen průběžně pro odvození země a pak se zahodí) zůstává jako **výchozí chování**, ne jako jediná možnost. Zapnutí musí být v UI doprovázené vysvětlením, co to znamená, aby to nikdo nezapnul omylem.

Otevřená otázka O6 části 5 je tím rozhodnutá.

### Neomezujeme, co si uživatel chce uložit

**Rozhodnuto: vlastní pole kontaktu jsou uživatelovo území.** Když si někdo zavede pole pro telefon, adresu nebo cokoliv jiného, protože to potřebuje, produkt mu do toho nemluví a neomezuje ho.

**Zůstává jedno rozlišení, na které původní zákaz ve specifikaci mířil.** Nejde o totéž a je dobré to nesloučit:

| Co | Chování |
|---|---|
| **Vlastní pole kontaktu** (telefon, adresa, cokoliv), naplněná importem, přes API nebo z formuláře | Bez omezení. Uživatel to vědomě zvolil a nese za to zodpovědnost. |
| **Automatický sběr obsahu formulářů** trackovacím skriptem na webu zákazníka | Zakázáno. Skript nesmí sám odesílat, co návštěvník napsal do políček, protože to nikdo nezvolil a návštěvník o tom neví. |

Princip: **co uživatel chce uložit, se neblokuje. Co by se sebralo samo, aniž to kdo zvolil, se neukládá.** Když zákazník chce z formuláře na webu poslat telefonní číslo, udělá to výslovným voláním s pojmenovanou hodnotou, a tím tu zodpovědnost přebírá.

Totéž platí pro hesla a přihlašovací tokeny: ty zůstávají zakázané bez výjimky, protože je nikdo do trackingu poslat nechce ani omylem.

### Odpovědi na otázky části 5 (tracking a reporty)

Rozhodnuto zadavatelem 2026-07-31.

| Otázka | Rozhodnutí |
|---|---|
| Hlavní metrika na dashboardu | **Proklik**, ne otevření |
| Falešná otevření od Apple | **Přepínač**, ne automatické odečítání |
| Ukládat zemi odvozenou z IP | **Ano** |
| Retence událostí | **37 měsíců** |
| Sledovat pozici konkrétního odkazu v mailu | **Ano** |
| Nabízet prediktivní otevření | **Ano** |
| Kdo je zodpovědný za souhlasy | **Zákazník.** Má vlastní řešení souhlasů a nese za ně zodpovědnost. |
| Platnost jednorázového klíče pro propojení prohlížeče s kontaktem | **15 minut** (konfigurovatelné 1 až 60) |

**Tři poznámky, které z toho plynou a patří do návrhu:**

**Přepínač u Apple otevření potřebuje rozumný výchozí stav.** Autor části 5 přepínač nedoporučoval s odůvodněním, že „přepínač znamená, že si každý vybere číslo, které se mu líbí". Rozhodnutí zadavatele je přepínač (stejně to má Mailchimp i Klaviyo). Aby ta námitka neplatila, musí být **výchozí poloha ta poctivější**, tedy s odečtenými automatickými otevřeními, a přepnutí do druhé polohy musí být viditelně označené v reportu, ne jen v nastavení. Jinak se stane, že si někdo přepne číslo nahoru a za měsíc už neví, že se dívá na jinou metriku.

**Prediktivní otevření je odhad, ne měření, a musí tak vypadat.** Jde o dopočet skutečných otevření z části publika, kterou Apple nezkresluje. Číslo je užitečné, ale je to model. V UI musí být odlišené od naměřených hodnot (jiný tvar, slovo „odhad", rozsah místo jednoho čísla) a nikdy nesmí stát vedle naměřených čísel jako rovnocenné. Jinak porušíme vlastní princip „nelžeme čísly", kvůli kterému jsme hlavní metrikou udělali proklik.

**Zodpovědnost zákazníka za souhlasy je obhajitelná, ale jednu díru nezavírá.** U self-hosted nástroje je správcem údajů provozovatel, takže je to správné rozdělení. Zůstává ale technická mezera pojmenovaná v části 5: kdyby právní posouzení došlo k tomu, že měření otevření vyžaduje souhlas, produkt dnes neumí **souhlas s měřením zvlášť u každého kontaktu** a nedokáže u konkrétního příjemce pixel vynechat. Zákazník tedy nese zodpovědnost, ale nemá jak ji naplnit jinak než vypnutím měření pro celou kampaň. Doplnit to je práce na půl dne a dnes ji nikdo nemá zadanou.

**Retence 37 měsíců** je nad původním návrhem 26 a je v povoleném rozsahu. Pokryje tři roky meziročního srovnání s rezervou. Cena je větší databáze a delší doba, po kterou držíme osobní údaje, což patří do dokumentace ke GDPR.

### Odpovědi na otázky části 6 (UI a UX)

Rozhodnuto zadavatelem 2026-07-31.

| Otázka | Rozhodnutí |
|---|---|
| Hlavní metrika v reportu | **Proklik**, ne otevření. Shodné s částí 5. |
| Okno na zrušení odeslání 60 s | **V pořádku**, ponechat |
| Zkušební režim hned při prvním spuštění | **Ano** |
| Ukázková data v produktu | **Ano**, ale **50 kontaktů, ne 200** |
| Vykání ve všech textech rozhraní | **Ano** |
| Český název pro merge tag | **„Personalizace"** |
| Jazyky od prvního dne | **Čeština a angličtina** |
| Smazání kontaktu nemaže historii v reportech | **Ano, přijatelné** |

**Nový požadavek k ukázkovým datům.** Ukázkové kontakty i ukázkové kampaně musí jít **hromadně označit a smazat**, aby si uživatel mohl projekt úplně vyčistit, až si nástroj osahá. Bez toho zůstane v čerstvé instalaci padesát smyšlených lidí, které bude mazat po jednom. Týká se to částí 2 (kontakty) a 4a (kampaně).

**K názvu „personalizace".** Autor části 6 navrhoval „doplňovaný údaj" s odůvodněním, že je srozumitelný na první pohled. Zadavatel rozhodl pro **„personalizaci"** a důvod je silnější: je to slovo, které česká cílovka **už zná z Ecomailu**, takže zákazník při přechodu nemusí přeučovat slovník. Srozumitelnost na první pohled se týká jen prvního setkání, shoda s trhem se týká každého dalšího dne.

Důsledek pro slovníček v části 6: „personalizace" se přesouvá ze seznamu **zakázaných** výrazů mezi **závazné**. Alternativy „doplňovaný údaj", „slučovací značka", „merge tag", „placeholder" a „proměnná" zůstávají v rozhraní zakázané, aby se pro jednu věc neobjevily tři názvy.

### Velikost dávky při odesílání

**Rozhodnuto: výchozí velikost dávky je 100 (místo původních 500) a je nastavitelná.**

Nastavitelnost patří na **úroveň instalace**, ne jako ovládací prvek v rozhraní kampaně. Je to technický parametr, u kterého uživatel nemá jak poznat, jestli má zvolit sto nebo tři sta, a špatná hodnota se projeví až za provozu.

**Dvě věci, které menší dávka zlepší:**

1. **Pauza zabere dřív.** Rozpracovaná dávka se vždy dokončí, takže po zmáčknutí pauzy odejde ještě nejvýš tolik zpráv, kolik je velikost dávky. Při stovce je to sto místo pěti set, což přímo vylepšuje scénář „uvědomím si chybu uprostřed rozesílky".
2. **Zmizí planý poplach v sandboxu Amazonu.** Sender hlídá, jestli se dávka nezasekla. Při limitu sandboxu jedné zprávy za sekundu trvá pětisetka přes osm minut a hlídač by na ni hlásil poplach pokaždé. Stovka trvá minutu a půl. Upozorňovala na to část 4b.

Cena je o něco víc dotazů do databáze, při těchto objemech zanedbatelná.

**K zastavení rozesílky uprostřed.** Zadavatel se ptal, jestli jde rozesílku zastavit a zbytek neposlat. **Ano, a je to funkce, kterou konkurence buď nemá vůbec, nebo ji dává jen v nejdražším tarifu.** Vyplývá z toho, že publikum se vypíše do fronty a odesílací komponenta si z ní bere dávky po pěti stech:

- **Pozastavit:** do pěti sekund přestane brát nové dávky, rozpracovanou dokončí (může odejít ještě až 500 zpráv), zbytek čeká ve frontě.
- **Zrušit zbytek rozesílky:** co ve frontě zbylo, se označí jako neodeslané a **už nikdy neodejde**.
- Co fyzicky odešlo, vzít zpět nejde.

Rozhraní to má rozdělené na dvě samostatná tlačítka, aby si nikdo nespletl pauzu se zrušením. Mailchimp totéž nabízí až v Premium a jen nad 10 000 příjemců, Ecomail, Sendy ani Listmonk to nemají.

### Odpovědi na otázky části 1 (platforma)

Rozhodnuto zadavatelem 2026-07-31. **Řada odpovědí návrh vylepšuje, nejen potvrzuje.**

**Zálohy: dva podporované režimy místo jednoho.**

| Režim | Obsah |
|---|---|
| **Nešifrovaná záloha** | Bez klíčů. Dokumentace musí jasně říct, že **obsahuje kompletní osobní data**. |
| **Šifrovaný recovery bundle** | Databáze, assety, aktuální `SECRET_KEY`, **všechny** `SECRET_KEY_PREVIOUS` a nutná konfigurace. Šifruje se veřejným recovery klíčem, soukromý klíč **není na serveru**. |

Tím padá argument „museli bychom hlídat druhé heslo na serveru". Dešifrovací klíč může být offline. Pouhé potvrzení „uložil jsem si klíč" je slabá pojistka a nahrazuje se tímhle.

**Blokující nález zadavatele, ROZHODNUTO:** otisky v suppression listu mají platit navždy, ale kontrola počítala otisk jen pro omezený počet předchozích klíčů. Po několika rotacích by se nejstarší záznamy přestaly dát ověřit a smazaný člověk by se vrátil prvním dalším importem. Nic by neselhalo a nic by se nezalogovalo.

**Rozhodnutí: strop se ruší, kontrola prochází všechna známá pokolení klíče.**

Ostatní cesty nejdou. Přepočítat staré otisky nelze, protože původní adresa je po výmazu pryč, což je celý smysl výmazu. Nerotovatelný klíč byl zamítnut dřív, protože klíč, který po incidentu nejde vyměnit, je trvalá zátěž.

Cena je zanedbatelná: jedna operace otisku trvá řádově mikrosekundu, takže při deseti pokoleních a importu sto tisíc kontaktů je to zhruba sekunda navíc na celý import. Přirozeným stropem je počet rotací provedených za životnost instalace, tedy jednociferné číslo.

**Dvě pravidla, která k tomu patří a musí zůstat tvrdá:** staré klíče nesmí jít nikdy vyhodit, a kontrola zdraví instalace to musí hlásit jako kritickou chybu, ne jako doporučení. Recovery bundle nese celý keyring, jinak by obnova ze zálohy rozbila totéž.

**Registrace: tři režimy místo dvou.**

- `closed`: po prvotním nastavení nelze vytvořit žádný další účet
- `invite`: účty jen přes pozvánku, **doporučený výchozí stav**
- `open`: veřejná registrace s ověřením e-mailu

**Retence záznamu o činnosti: rozdělená podle citlivosti.**

- **24 měsíců** pro významné auditní události: export kontaktů, změny rolí, API klíčů, nastavení rozesílání, odeslání kampaně, GDPR operace
- **90 dní jako výchozí** pro plnou IP adresu, user-agent a přihlašovací události včetně neúspěšných pokusů. Provozovatel nastavitelně, doporučený rozsah 30 až 365 dní.

**Ostatní:**

| Otázka | Rozhodnutí |
|---|---|
| Editor smí odeslat kampaň | **Ano**, a **schvalování se přidá jako volitelná funkce projektu** |
| Prohlížeč nesmí exportovat kontakty | **Ano, ponechat** |
| Návrat na starší verzi jen ze zálohy | **Ano, takto** |
| Slib „do pěti minut" | **Vynechat sliby úplně.** Neslibovat, že něco běží do pěti minut. |
| Název produktu | **Mění se.** Nový název zatím není určený, rozhodnutí zůstává blokující. |

---

### Odpovědi na otázky části 2 (kontakty)

**Vokativ a oslovení.** Při nízké jistotě **neutrální „Dobrý den"**. Jméno se skloňuje automaticky **jen tehdy, když je jazyk kontaktu `cs` nebo `sk` a pravidla nebo slovník dávají vysokou jistotu**. AI může být volitelný pomocník, který navrhne řešení do kontrolní fronty, ale **nesmí bez potvrzení rozhodnout, co skutečně odejde**. **Původ ani etnicitu podle jména neurčujeme.**

**Strop ruční práce.** Proklikávání stovek skupin není přijatelné. Když nejisté případy překročí **100 skupin nebo 10 % importu**, systém nabídne jako **doporučenou** volbu „u nejistých kontaktů použít neutrální oslovení". Kontrolní fronta zůstane dostupná dobrovolně a nejčastější skupiny půjde opravit hromadně.

**Odblokování tvrdých odrazů.** 30denní ochrana zůstává, ale absolutní zákaz hromadného odblokování je příliš přísný. **Owner nebo admin smí hromadně odblokovat tvrdé odrazy pro konkrétní doménu** po výrazném potvrzení, uvedení důvodu a zápisu do auditu. Nabídnout postupnou reaktivaci na malém vzorku. **Stížnosti na spam se hromadně odblokovat nesmějí nikdy.**

**Potvrzení přihlášení: varianta s vyšší konverzí**, tedy jedno kliknutí.

> **Podmínka, bez které to nedává smysl.** Dvě kliknutí nebyla kvůli opatrnosti, ale proto, že **firemní bezpečnostní skenery samy proklikávají odkazy v mailech**, stejně jako Apple předstírá otevření. Při prostém jednom kliknutí by skener potvrdil přihlášení za příjemce a double opt-in by ztratil důkazní hodnotu, což je jediné, kvůli čemu existuje.
>
> **Řešení: potvrzení se provede přes POST, ne přes GET.** Skenery dělají GET, prohlížeč po kliknutí na tlačítko udělá POST. Uživatel pořád klikne jednou, jen stránka odešle formulář za něj. Je to tentýž mechanismus, jaký už máme u odhlašování podle RFC 8058.

**Ostatní:**

| Otázka | Rozhodnutí |
|---|---|
| Výmaz podle GDPR | **Anonymizovat**, tvrdé smazání jen vlastníkovi |
| Otisk smazané adresy | **Zachovat**, jako HMAC s klíčem. V zásadách ochrany údajů výslovně popsat jako suppression list sloužící výhradně k zabránění opětovnému kontaktování, s odkazem na oprávněný zájem. |
| Antispam u formulářů | **Vlastní ochrana zapnutá ve výchozím stavu**: honeypot, časová past, rate limiting, double opt-in. Turnstile a hCaptcha vypnuté jako volitelná silnější ochrana s upozorněním na komunikaci se třetí stranou. |
| Limit vlastních polí | **100 polí, z toho 8 indexovaných.** UI musí ukazovat využití limitu a vysvětlit, že indexace zrychluje segmenty, ale zvětšuje databázi a zpomaluje import. |
| Presety čištění | Šest navržených **potvrzeno**. Presety smí počítat kandidáty, ale **nikdy nesmějí automaticky mazat.** Před akcí se vždy zobrazí počet, vzorek, možnost exportu a přesná podmínka. Výmaz potvrdí oprávněný uživatel. |
| Kdo smí spustit hromadný výmaz | **Vlastník projektu** |

**Opakované přihlášení přes formulář.** Rozhodnuto 2026-07-31 na základě otázky zadavatele. **Ve specifikaci to explicitně nebylo a je to místo, kde by to každý implementátor vyřešil jinak.**

Modelový případ: člověk si před půl rokem stáhl e-book výměnou za adresu, zapomněl na to, vrátí se na web a vyplní formulář znovu.

Rozděluje se to na dvě věci, které se snadno slijí do jedné:

| Co | Kdy se to stane |
|---|---|
| **Doručení toho, co si vyžádal** (odkaz na e-book) | **Vždycky.** Vyplnil formulář, o něco požádal, dostane to. I popáté. Je to reakce na jeho konkrétní akci, ne marketing. |
| **Potvrzovací a uvítací e-mail** | **Jen u skutečně nového nebo dříve odhlášeného kontaktu.** Kdo už je potvrzený, dostane jen ten e-book. |

Poslat „potvrďte prosím své přihlášení" člověku, který přihlášený je, vypadá jako rozbitý nástroj a část lidí na to klikne s pocitem, že je někdo přihlásil bez jejich vědomí.

**Odhlášený kontakt, který se přihlásí znovu**, projde celým potvrzením a tím se mu automaticky sundá blok. To už specifikace řeší: blok z odhlášení může sundat **jedině nové potvrzené přihlášení**, tedy uživatelův vlastní úkon. Nesundá ho admin ani import.

**Bezpečnostní podmínka: formulář musí odpovědět stejně, ať kontakt existuje, nebo ne.** Vždy „Poslali jsme vám e-mail s odkazem." Kdyby u známé adresy napsal „už jste přihlášen", stal by se z formuláře **nástroj na zjišťování, kdo je v databázi**. Kdokoli by mohl zkoušet adresy a zjišťovat, jestli je ten člověk zákazníkem. U citlivého oboru je to reálný problém.

Totéž platí pro adresu na suppression listu ze stížnosti nebo tvrdého odrazu: zobrazí se stejná hláška, e-mail se neodešle.

---

### Odpovědi na otázky části 3 (obsah a šablony)

| Otázka | Rozhodnutí |
|---|---|
| AI nikdy nevyrábí vlastní HTML | **Ano, souhlas** |
| Garantované poštovní klienty | Sedm navržených **plus Outlook for Mac a Samsung Mail**, tedy devět v první úrovni |
| Bez vlastního AI klíče asistent nefunguje | **Přijatelné** |
| Počet hotových šablon k vydání | **Jedna univerzální plus čtyři varianty**, rozšíříme později |
| Respektovat robots.txt cizího webu | **Ano ve výchozím stavu**, na vlastní instalaci vypnutelné. Odůvodnění: pokud je to váš vlastní web, můžete si robots.txt upravit sami. |
| Obrázek použitý v odeslané kampani nejde smazat | **Ano**, jen skrýt z knihovny |
| Kolik verzí šablony pamatovat | **50 pojmenovaných** plus neomezená historie u verzí použitých v kampani |
| Historie konverzace s AI v záloze | **Ano**, s mazáním po 90 dnech |

---

## 4. Co potřebuje právníka

Autoři to sami označili, není to jejich odbornost:

1. **Retence záznamu o činnosti 24 měsíců.** Obsahuje IP adresy, tedy osobní údaje. Je dva roky obhajitelné jako oprávněný zájem?
2. **Anonymizace versus mazání při výmazu podle GDPR.** Specifikace volí anonymizaci s odůvodněním, že report, jehož čísla se zpětně mění, je k ničemu. Obstojí to?
3. **Trackovací pixel a měření chování na webu** ve vztahu k pravidlům o soukromí v elektronických komunikacích.
4. **Fyzická adresa odesílatele v patičce.** U komerčního mailu je to právní požadavek, specifikace na to má pole, ale rozsah povinnosti se liší podle trhu.

---

## 5. Co je rozhodnuté a nepotřebuje vás

Pro úplnost, ať víte, co se rozhodlo bez vás:

- Licence **MIT**, jednotně, s automatickou kontrolou v CI. Pět knihoven s nevhodnou licencí bylo zachyceno a zamítnuto dřív, než se do projektu dostaly.
- **Kurzorové stránkování** s odhadovaným počtem místo čísel stránek, protože přesný součet nad miliony řádků je drahý.
- **Zrušení kampaně je možné** a je to funkce, kterou konkurence buď nemá vůbec, nebo ji dává jen v nejdražším tarifu. U nás vyplývá z architektury skoro zadarmo.
- **Vokativ** se počítá při uložení kontaktu, ne při odesílání, takže co uživatel vidí v náhledu, to se odešle, a nejisté případy může zkontrolovat předem.

---

## 6. Co zbývá otevřené

Stav k 2026-07-31 večer. **Produktová rozhodnutí jsou hotová a implementační plány se psát můžou.** Otevřené jsou tři skupiny věcí, z nichž ani jedna psaní plánů nebrání.

### 6.1 Právník, šest otázek

Kapitola 4. **Blokuje spuštění provozu, ne psaní plánů ani kódu.**

Jediná z nich, za kterou visí nezadaná práce, je ta o trackovacím pixelu: kdyby vyšlo, že vyžaduje souhlas, produkt dnes neumí souhlas s měřením zvlášť u každého kontaktu ani vynechat pixel u konkrétního příjemce. Je to práce na půl dne a **nikdo ji nemá zadanou**.

### 6.2 Šest empirických ověření, která nikdo nevlastní

Nejsou to rozhodnutí, jsou to testy na pár minut. **Dvě z nich mění návrh, když dopadnou špatně:**

| Co ověřit | Stav | Co se stane, když dopadne špatně |
|---|---|---|
| Podepisuje SES i hlavičky pro odhlášení? | **prozkoumáno, viz 6.2.1** | Musel by podepisovat sender a držet privátní klíč |
| Jak Apple pozná falešné otevření? | **prozkoumáno, viz 6.2.2** | Padá klasifikace falešných otevření |
| Jak dlouho trvá zpracování šablony? | otevřené | Výkonový rozpočet senderu stojí na odhadu, ne měření |
| Je Go knihovna na Liquid bezpečná při souběhu? | otevřené | Nutná jiná strategie sdílení šablon mezi vlákny |
| Umí `go-mail` sestavit zprávu do bufferu? | otevřené | MIME se musí sestavit vlastním kódem |
| Rozlišuje SES sekundovou a denní kvótu různými chybami? | otevřené | Sender by denní kvótu považoval za throttling a kampaň by se zasekla |

**Přidělit jmenovitě před začátkem implementace.** Většina je na pět minut.

#### 6.2.1 SES a hlavičky pro odhlášení: nic se nemění

**Sender si DKIM podepisovat nebude, bezpečnostní model zůstává.** AWS má vlastní článek, kde ručně vloženou hlavičku popisuje jako uznanou cestu ke splnění požadavků na hromadné odesílatele, a o podepisování tam neřeší nic.

Dvě pravidla, která z toho plynou:

1. Hlavičky vkládáme sami.
2. **Funkci SES pro správu odběratelů nepoužíváme**, protože když je zapnutá, SES naše hlavičky přepíše.

**Ověřeno na skutečných zprávách.** AWS to sice nikde nedokumentuje, ale v korpusech reálných e-mailů se našly čtyři vzorky a žádný protipříklad. Nejsilnější je zpráva nesoucí **jen podpis od SES**, která obě hlavičky v podepsaném seznamu má, takže je tam nemohl dát nikdo jiný. Seznam se navíc skládá z přítomných hlaviček, ne z pevného výčtu: v jednom vzorku hlavička chyběla ve zprávě a odpovídajícím způsobem chyběla i v podpisu.

Dokumentace AWS to potvrzuje z druhé strany, uvádí jako přepisované **jen `Date` a `Message-ID`**.

**Zbývá potvrdit před spuštěním, ne před vývojem:** poslat jednu zprávu na vlastní schránku na Gmailu a v „zobrazit originál" zkontrolovat podepsaný seznam. **Pozor na výklad:** jestli Gmail ukáže tlačítko „Odhlásit", nic nedokazuje, protože závisí i na reputaci a objemu. Rozhoduje jen ten seznam.

#### 6.2.2 Apple: pro MVP to zjednodušujeme

Ověření zjistilo, že **identifikátor prohlížeče nerozliší předstírané otevření od skutečného**, protože Apple posílá tentýž řetězec i s vypnutou ochranou. Řekne jen „tohle je Apple Mail".

**Pro MVP to ale stačí a nic dalšího nestavíme.** Hlavní metrikou je proklik a otevření se ukazuje níž s vysvětlením, že je nepřesné. Otázku „bylo tohle konkrétní otevření skutečné" v MVP nikdo nepokládá. Stačí označit otevření z Apple Mailu jako nespolehlivá, a na to identifikátor bohatě stačí.

**Odloženo na později, až se bude dopočítávat skutečná míra otevření:** rozlišování podle IP proti feedu, který Apple publikuje pro iCloud Private Relay. Že po něm jezdí i pošta, tvrdí SocketLabs, Apple to nepotvrzuje.

### 6.3 Dvě věci, na které nikdo nezapomněl, ale nikdo je nevlastní

- **Souhlas s měřením per kontakt** (viz 6.1)
- **Nenastavená trackovací doména** rozbije každý pixel a proklik v kampani, přičemž aplikace nastartuje bez chyby. Oprava je udělat tu proměnnou pro odesílací komponentu povinnou, aby to spadlo při startu. Jednořádková změna.

### 6.4 Kde hledat detail

Otevřené otázky jednotlivých částí jsou v jejich kapitolách „Otevřené otázky" v adresáři `parts/`. Většina je uzavřená s rozhodnutím a zdůvodněním přímo na místě, zbytek je označený jako „čeká na právníka".
