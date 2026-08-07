# Designovatelné veřejné stránky přes Builder

Stav: **SCHVÁLENO 7. 8. 2026, implementuje se.**

Datum: 2026-08-07

## 0. Rozhodnutí zadavatele k oddílu 8

1. **Dokument nahradí celou bílou kartu.** Autor má plnou kontrolu nad vzhledem.
2. **Odhlašovací stránka a „už jste přihlášeni" jsou v rozsahu HNED**, ne ve druhé
   fázi. Oddíl 3 je podle toho přepsaný: povrchy jsou čtyři, ne dva.
3. **Stránky jsou KNIHOVNA, ne jedna globální stránka.** Sdílet jde, ale každý
   formulář si musí umět vybrat jinou. Tohle je tvrdý požadavek a promítá se do
   oddílu 5: výběr je odkaz na šablonu u KAŽDÉHO formuláře zvlášť, nikde není
   „ta jedna stránka projektu".

## 1. Co je dnes špatně

Zadavatel ukázal dvě obrazovky, které vidí návštěvník jeho webu, a zeptal se, kde
se dají navrhnout:

1. Po odeslání formuláře: „Poslali jsme vám e-mail s odkazem."
2. Po kliknutí na potvrzovací odkaz: „Hotovo, přihlášení je potvrzené."

**Odpověď je, že nikde.** Obě věty jsou napevno v překladovém katalogu
(`packages/i18n/messages/cs/contacts.json`) a vykresluje je React komponenta
(`apps/web/src/features/public/pages.tsx`, `form-pages.tsx`). Uživatel může dnes:

- přepsat text děkovací stránky JEDNÍM řetězcem (`forms.success_message`), bez
  formátování, bez obrázku, bez tlačítka,
- nebo přesměrovat na vlastní web (`confirm_redirect_url`, `redirect_url`), čímž
  se problému zbaví tak, že si stránku napíše jinde.

Chybí ta prostřední, nejčastější možnost: **zůstat na naší stránce a mít ji
podle svého.** Přitom nástroj na to už má hotový editor, kterým se skládají e-maily.

## 2. Jak to bude vypadat a chovat se

### 2.1 V editoru formuláře

Přibude karta **„Stránky pro návštěvníka"** se dvěma řádky. Každý řádek má tutéž
trojici voleb, aby se to chovalo předvídatelně:

| Volba | Co udělá |
|---|---|
| **Výchozí text** (dnešní stav, výchozí) | Vykreslí se vestavěná věta, jako dnes |
| **Vlastní stránka** | Vykreslí se dokument z Builderu; vedle je tlačítko „Upravit" |
| **Přesměrovat na web** | Návštěvník skončí na cizí adrese (dnešní `redirect_url`) |

Ty dva řádky jsou:

- **Po odeslání formuláře** (děkovací stránka)
- **Po potvrzení přihlášení** (stránka po kliknutí na odkaz v e-mailu)

Kliknutí na „Vytvořit stránku" založí novou stránku v knihovně **předvyplněnou
dnešním textem** a rovnou otevře Builder. Nikdo nezačíná na prázdné ploše a nikdo
nepřijde o dnešní znění.

### 2.2 V Builderu

Je to **týž editor jako pro e-maily**, ne druhý nástroj. Rozdíly jsou tři a všechny
plynou z toho, že web není e-mail:

1. **Užší paleta bloků.** Nadpis, text, tlačítko, obrázek, oddělovač, mezera,
   sekce, sloupce a sociální sítě zůstávají. Odchází **patička s odhlašovacím
   odkazem** (na veřejné stránce nedává smysl, odhlášení tam řeší jiná stránka)
   a **blok syrového HTML** (zdůvodnění v 4.4).
2. **Náhled v rámu prohlížeče**, ne v rámu e-mailového klienta. Přepínač
   mobil/desktop zůstává.
3. **Paletka proměnných zná POVRCH.** Na děkovací stránce se `{{ contact.* }}`
   vůbec nenabídne, protože tam žádný kontakt není (viz 4.3).

### 2.3 Co uvidí návštěvník

Stránka zůstane tím, čím je dnes: bez JavaScriptu, do sta kilobajtů, `noindex`,
jazyk podle projektu. Dokument z Builderu nahradí **obsah bílé karty** na
snímcích. Jméno odesílatele („Petr Odesílatel") přestane být součástí obalu
a stane se **obyčejným textovým blokem ve výchozí předloze**, takže si ho autor
může upravit, přesunout i smazat.

## 3. Rozsah: ČTYŘI POVRCHY

| Povrch | Trasa | Kdo ho vlastní |
|---|---|---|
| `form_thanks` po odeslání formuláře | `/f/{slug}/thanks` | **formulář** |
| `confirmed` po potvrzení přihlášení | `/s/c/{token}` | formulář, jinak seznam |
| `already_subscribed` už jste přihlášeni | `/f/{slug}/thanks` (větev) | formulář, jinak seznam |
| `unsubscribed` po odhlášení | `/u/{token}` | **seznam** |

Rozdělení kopíruje to, kde už dnes bydlí odpovídající přesměrování: formulář má
`redirect_url`, seznam má `confirm_redirect_url`, `unsubscribe_redirect_url`
a `already_subscribed_redirect_url`. Nové nastavení jde vedle nich, ne někam jinam.

**Odhlášení zůstává jen na seznamu**, protože se na něj chodí z odkazu v e-mailu,
ne z formuláře. Nemá se tedy podle čeho rozhodnout, který formulář by ho vlastnil.

### Vědomě mimo rozsah

Centrum předvoleb a stránka po reaktivaci. Obojí je vlastní obrazovka s ovládacími
prvky, ne stránka se sdělením, takže „nahradit obsah dokumentem" na ně nesedí.

### Vědomě NEDĚLÁM

- **Vlastní CSS ke stránce.** Editor motivů umí barvy a písma; volné CSS na
  veřejné stránce je vektor na podvržení cizí značky a nejde rozumně validovat.
- **Vlastní doménu pro veřejné stránky.** Samostatné téma (certifikáty, DNS).
- **Verzování s náhledem historie.** Šablony verze mají, obrazovka na jejich
  procházení je vlastní úkol.

## 4. Rozhodnutí a jejich důvody

### 4.1 Stránka je ŠABLONA, ne pole ve formuláři

Přibude `templates.kind = 'page'` vedle `campaign`, `transactional` a `system`.

Alternativa byla uložit dokument přímo do `forms.definition`. Zamítám ji: šablony
už mají verzování, knihovnu, náhledy, hlídání odkazů na obrázky
(`asset_references`), převalidaci po smazání kontaktního pole a audit. Dokument
schovaný v definici formuláře by tohle všechno postrádal a druhá kopie té
mašinerie je horší než nový `kind`.

Vedlejší přínos: **jedna stránka může sloužit víc formulářům.** Kdo má pět
formulářů a jednu značku, navrhne stránku jednou.

### 4.2 Vykreslování POUŽIJE EMAILOVÝ EMITOR

`packages/emails` už umí z dokumentu udělat samostatné HTML s vloženými styly.
To se pro veřejnou stránku hodí přesně tak, jak je: **žádný externí CSS soubor**,
což je podmínka přísné politiky obsahu, a shodný výsledek s náhledem v editoru.

Přibude jen jiný **obal** (`PageShell` vedle `EmailShell`): bez preheaderu, bez
meta pro tmavý režim e-mailových klientů, bez tabulkové obálky na šířku okna.
Je to jeden nový soubor v emitoru, ne druhá vykreslovací cesta.

Tabulkové rozvržení uvnitř bloků zůstává. Prohlížeč ho zvládá a psát druhý
emitor jen kvůli čistotě značek by znamenalo dvě místa, která se rozejdou.

### 4.3 PROMĚNNÉ SE LIŠÍ PODLE POVRCHU A JE TO TVRDÉ PRAVIDLO

| Povrch | Co je k dispozici | Co NENÍ |
|---|---|---|
| `form_thanks` | odesílatel, název formuláře, název seznamu | **kontakt** |
| `already_subscribed` | odesílatel, název formuláře, název seznamu | **kontakt** |
| `confirmed` | odesílatel, seznam, **kontakt** (jméno, e-mail) | název formuláře |
| `unsubscribed` | odesílatel, seznam, **kontakt** | název formuláře |

Rozhoduje TOKEN, ne jméno povrchu. První dva jsou cíl přesměrování 303 po odeslání
formuláře, tedy táž trasa `/f/{slug}/thanks` **bez tokenu**, takže o návštěvníkovi
nevědí nic. Druhé dva se otevírají z odkazu v e-mailu, token mají a kontakt znají.

> **OPRAVA PLÁNU, 7. 8. 2026.** Původně tu `already_subscribed` mělo kontakt,
> protože jsem ho omylem zařadil mezi stránky otevírané z e-mailu. Fyzicky tam
> žádný kontakt není, takže by `{{ contact.greeting }}` prošlo validací a u
> návštěvníka se vykreslilo jako PRÁZDNO, tedy přesně ta vada, kvůli které tenhle
> katalog vznikl. Našel to agent `stranky-trasy` při zapojování tras.
>
> Zvažovalo se místo toho dát té stránce token. **Zamítnuto:** token identifikující
> člověka by se dostal do adresního řádku, do historie prohlížeče a do hlavičky
> odkazující stránky, a to všechno kvůli větě „už jste přihlášeni".

**Nedostupná proměnná bude CHYBA VALIDACE, ne prázdný výstup.** Přesně tahle
třída vady se dnes projevila dvakrát: `{{ workspace.sender_address }}` se
vykreslil jako prázdno v patičce a textová verze potvrzovacího e-mailu neměla
adresu. Tichý prázdný řetězec je horší než odmítnuté uložení.

### 4.4 BLOK SYROVÉHO HTML SE NA STRÁNKU NEPOUŠTÍ

V kampani je HTML povolené, protože e-mail čte příjemce ve svém klientu, který
skripty stejně nespustí. Veřejná stránka běží **na naší doméně**, takže vložený
obsah může předstírat cokoli: přihlašovací pole, cizí značku, jinou cenu.
Přísná politika obsahu zastaví skript, ale ne podvodný text ani `javascript:`
v odkazu. Autorem přitom nemusí být majitel projektu, stačí člen s právem
upravovat formuláře.

Je to totéž rozhodnutí, jaké dnes padlo u textu souhlasu u zaškrtávacího políčka.

### 4.5 Pořadí, ve kterém se stránka hledá

Pro potvrzovací stránku:

1. stránka nastavená na **formuláři**, ze kterého přihlášení přišlo
   (`list_subscriptions.source_ref` nese ID formuláře, ověřeno v datech),
2. jinak stránka nastavená na **seznamu** (fáze 2),
3. jinak **vestavěný text**.

Pro děkovací stránku odpadá krok 2, formulář ji vlastní sám.

**Smazaná nebo neplatná šablona spadne na vestavěný text a zaloguje se to.**
Nikdy se nesmí stát, že přihlášení skončí chybovou stránkou, protože si někdo
smazal návrh: v tu chvíli už je člověk v databázi a e-mail odeslaný.

## 5. Změny v datech

```
templates.kind        … přibude hodnota 'page' do CHECK

forms.design.pages    … tři volitelné klíče (jsonb, ne sloupce):
                        thanks_template_id             uuid | null
                        confirmed_template_id          uuid | null
                        already_subscribed_template_id uuid | null

lists                 … tři nové sloupce vedle stávajících *_redirect_url:
                        confirmed_template_id          uuid | null
                        already_subscribed_template_id uuid | null
                        unsubscribed_template_id       uuid | null
```

**Výběr je u KAŽDÉHO formuláře zvlášť** (požadavek zadavatele z oddílu 0.3).
Šablona je sdílená, odkaz na ni ne: dva formuláře můžou ukazovat na tutéž stránku
i na dvě různé, a přehození u jednoho se druhého nedotkne.

Migrace nemění žádný existující řádek. `null` znamená „vestavěný text", což je
dnešní chování, takže se stávajícím formulářům ani seznamům nic nestane.

Sloupce v `lists` mají cizí klíč `ON DELETE SET NULL`: smazání šablony nesmí
shodit seznam. Klíče v `forms.design` cizí klíč mít nemůžou (je to jsonb),
proto je platnost ověřuje doména při čtení, viz 4.5.

> **OPRAVA PLÁNU, 7. 8. 2026.** Původně tu stálo `forms.definition`. Takový sloupec
> NEEXISTUJE: definice formuláře je rozepsaná do skutečných sloupců. Jediné volné
> jsonb, které k formuláři patří, je `forms.design`, a to byl do teď mrtvý sloupec
> (zapisoval se při založení a nikdy nečetl). Odkazy na stránky proto bydlí v něm
> pod vyhrazeným podklíčem `pages`, aby je budoucí vzhled formuláře nepřepsal.
> Našel to agent `stranky-data` při implementaci, ne kontrola plánu.

## 6. Testy

Testy jsou součástí zadání, ne dodatek. Rozděleny podle toho, co chrání.

### 6.1 `packages/emails` (bez databáze)

1. Profil `page` **zakáže** blok patičky a blok syrového HTML, u obou s vlastním
   kódem chyby.
2. Profil `page` **povolí** nadpis, text, tlačítko, obrázek, oddělovač, mezeru,
   sekci, sloupce a sociální sítě.
3. `PageShell` nevykreslí preheader ani meta pro tmavý režim e-mailových klientů.
4. Výstup neobsahuje **žádný odkaz na externí soubor** (`<link rel=stylesheet>`,
   `<script src>`), protože politika obsahu je zablokuje a stránka by se rozsypala.
5. Kontrola vrácením: bez zákazu v profilu první dva testy padají.

### 6.2 Katalog proměnných

6. `{{ contact.first_name }}` na děkovací stránce je **chyba validace**
   s kódem, který řekne proč, ne prázdný výstup.
7. Tatáž proměnná na potvrzovací stránce **projde**.
8. Paletka proměnných v editoru nabízí na každém povrchu jen to, co tam je.

### 6.3 Doména (`packages/core`, s databází)

9. Formulář s nastavenou stránkou ji vrátí; bez nastavení vrátí `null`.
10. **Smazaná šablona** spadne na vestavěný text a přihlášení proběhne.
11. **Neplatná šablona** (`validation_state = 'invalid'`) spadne na vestavěný text.
12. Potvrzení z formuláře A nevezme stránku formuláře B (izolace přes `source_ref`).
13. Šablona `kind = 'page'` se **nenabízí** jako obsah kampaně ani jako
    transakční e-mail a naopak.

### 6.4 Veřejné trasy (`apps/web`, s databází)

14. Děkovací stránka s návrhem vykreslí obsah dokumentu.
15. Tatáž stránka **drží všechna dnešní pravidla**: `noindex`, žádný JavaScript,
    pod 100 kB, jazyk podle projektu.
16. **Jméno projektu se na stránce neobjeví** (dnešní nález, ať se nevrátí).
17. Stránka po potvrzení vykreslí návrh a přihlášení se opravdu potvrdí, tedy
    návrh nesmí zastínit vedlejší účinek.
18. Bez návrhu se vykreslí dnešní věta, znak po znaku.

### 6.5 Zlatá cesta (end to end)

19. Návrh stránky → vložení formuláře → odeslání → **designovaná děkovací
    stránka** → e-mail → potvrzovací odkaz → **designovaná stránka po potvrzení**
    → kontakt je v seznamu jako potvrzený.

Tenhle jediný test je ten, který dokazuje, že to funguje. Zbylých osmnáct chrání
před tím, aby se rozbil po částech.

## 7. Rizika

| Riziko | Co s tím |
|---|---|
| Autor navrhne stránku, která na mobilu přeteče | Náhled má mobilní režim; emitor už mobilní šířky řeší |
| Obrázek v návrhu zpomalí stránku | Rozpočet 100 kB se hlídá testem, obrázky jdou přes naše úložiště s převodem |
| Autor smaže jméno odesílatele a stránka bude vypadat cizí | Je to jeho volba; ve výchozí předloze je a nápověda u ní řekne proč tam je |
| Dvě místa, kde se dá nastavit totéž (stránka i přesměrování) | Volba je trojice, ne dvě nezávislá pole, takže si nemůžou odporovat |

## 8. Co potřebuju od zadavatele rozhodnout

1. **Má dokument nahradit celou bílou kartu** (návrh výše), nebo zůstat uvnitř ní
   a autor upravuje jen obsah? Návrh: nahradit celou, plná kontrola.
2. **Fáze 2 hned, nebo až po odsouhlasení fáze 1?** Návrh: až potom.
3. **Sdílení stránky mezi formuláři** je v návrhu povolené. Souhlas?
