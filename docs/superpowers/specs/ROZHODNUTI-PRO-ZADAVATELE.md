# Rozhodnutí pro zadavatele

Datum: 2026-07-31
Zdroj: sedm detailních specifikací v `parts/`, 25 700 řádků
Pro: člověka, který rozhoduje o produktu, ne pro vývojáře

## Jak tohle číst

Autoři sedmi částí specifikace narazili na otázky, které nemohli rozhodnout sami, protože nejsou technické, ale produktové, právní nebo obchodní. Tenhle dokument je sbírá na jedno místo.

**U každé otázky je doporučení.** Když s ním souhlasíte, stačí říct „ano" a jde se dál.

Dokument je řazený podle naléhavosti, ne podle částí.

---

## 1. Rozhodnout před první řádkou kódu

### 1.1 Název produktu

**O co jde.** Pracovně se používá OpenEngage. Název ale není jen nápis na webu, je zapečený v technických identifikátorech: v názvech balíčků, v názvu Docker image, v předponě API klíčů (`oe_live_`), v předponě trackovacích odkazů, v rezervované doméně pro odkazy v mailech, a hlavně **ve výpočtu šifrovacích klíčů a podpisů**.

**Co se stane, když se rozhodne pozdě.** Změna názvu po začátku implementace znamená přepis všech podepsaných formátů a všech testovacích vzorků ve čtyřech zmrazených kontraktech mezi dvěma jazyky. Dnes je cena nulová, po týdnu je to den práce, po měsíci víc.

**Doporučení:** rozhodnout jako úplně první bod, dřív než kdokoli otevře editor.

### 1.2 Jazyk odesílacího enginu: Go, nebo Rust

**O co jde.** Aplikace je v TypeScriptu, ale komponenta, která fyzicky posílá maily, je samostatný program v kompilovaném jazyce. Vy jste zmínil obojí.

**Doporučení: Go.** Kompiluje se v sekundách místo minut, což na hackathonu rozhoduje, a základna lidí schopných přispět do open-source projektu v Go je výrazně větší. Výkonová výhoda Rustu se tady nemá o co opřít, protože rychlost stejně určuje limit Amazonu, ne jazyk.

**Volba je vratná.** Kontrakty jsou napsané jazykově neutrálně, takže přepis senderu později nesáhne na nic jiného.

### 1.3 Verze databáze: PostgreSQL 18 místo 17

**O co jde.** Hlavní specifikace uvádí 17. Autor části 1 doporučuje 18, protože funkce pro generování identifikátorů je součástí jádra až od osmnáctky. Na sedmnáctce by ji musela obcházet aplikace na každém místě.

**Doporučení: 18.** Je to aktuální stabilní verze, oficiální image existuje a cena změny je dnes nulová, protože nikde nic neběží.

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

**Tři poznámky, které z toho plynou a patří do návrhu:**

**Přepínač u Apple otevření potřebuje rozumný výchozí stav.** Autor části 5 přepínač nedoporučoval s odůvodněním, že „přepínač znamená, že si každý vybere číslo, které se mu líbí". Rozhodnutí zadavatele je přepínač (stejně to má Mailchimp i Klaviyo). Aby ta námitka neplatila, musí být **výchozí poloha ta poctivější**, tedy s odečtenými automatickými otevřeními, a přepnutí do druhé polohy musí být viditelně označené v reportu, ne jen v nastavení. Jinak se stane, že si někdo přepne číslo nahoru a za měsíc už neví, že se dívá na jinou metriku.

**Prediktivní otevření je odhad, ne měření, a musí tak vypadat.** Jde o dopočet skutečných otevření z části publika, kterou Apple nezkresluje. Číslo je užitečné, ale je to model. V UI musí být odlišené od naměřených hodnot (jiný tvar, slovo „odhad", rozsah místo jednoho čísla) a nikdy nesmí stát vedle naměřených čísel jako rovnocenné. Jinak porušíme vlastní princip „nelžeme čísly", kvůli kterému jsme hlavní metrikou udělali proklik.

**Zodpovědnost zákazníka za souhlasy je obhajitelná, ale jednu díru nezavírá.** U self-hosted nástroje je správcem údajů provozovatel, takže je to správné rozdělení. Zůstává ale technická mezera pojmenovaná v části 5: kdyby právní posouzení došlo k tomu, že měření otevření vyžaduje souhlas, produkt dnes neumí **souhlas s měřením zvlášť u každého kontaktu** a nedokáže u konkrétního příjemce pixel vynechat. Zákazník tedy nese zodpovědnost, ale nemá jak ji naplnit jinak než vypnutím měření pro celou kampaň. Doplnit to je práce na půl dne a dnes ji nikdo nemá zadanou.

**Retence 37 měsíců** je nad původním návrhem 26 a je v povoleném rozsahu. Pokryje tři roky meziročního srovnání s rezervou. Cena je větší databáze a delší doba, po kterou držíme osobní údaje, což patří do dokumentace ke GDPR.

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

## 6. Přehled podle částí

| Část | Otevřených otázek | Nejdůležitější |
|---|---|---|
| 1 Platforma | 8 | Název produktu, Go versus Rust, verze databáze, retence auditu |
| 2 Kontakty | viz souhrn | GDPR operace, chování importu při konfliktech |
| 3 Obsah | viz souhrn | Volba editoru, testování v poštovních klientech |
| 4a Kampaně | 12 | Automatické pozastavení, zakládání v AWS účtu, anonymizace versus mazání |
| 4b Sender | viz souhrn | Chování při nejistém odeslání |
| 5 Tracking | viz souhrn | Živé aktualizace v prohlížeči, právní posouzení pixelu |
| 6 UI a UX | viz souhrn | Kde je premisa se zvládnutelností nesplnitelná |

Souhrny několika částí ještě dobíhaly v okamžiku sestavení tohoto dokumentu. Chybějící položky jsou dohledatelné v kapitolách „Otevřené otázky" jednotlivých souborů v `parts/`.
