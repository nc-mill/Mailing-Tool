# Integrace designu do aplikace

Živý koordinační dokument. Vede ho hlavní agent. **Každý agent si ho přečte, než začne.**

Zadání zadavatele 5. 8. 2026: „Potřebuji design detailně a velice přesně implementovat.
Musí to vypadat naprosto identicky co se designu týče, sedět na pixel, potřebuji aby nic
nebylo hardcoded a vše krásně v komponentách a na každé stránce samostatně. Stejným
způsobem jako jsou nadesignované tyto stránky udělej všechny ostatní."

---

## 1. Kde je zdroj designu

Projekt Claude Design, `projectId = 32a4061b-448b-4327-b258-7fe51878cf72`.

Čte se nástrojem `DesignSync` (načti si ho přes `ToolSearch(query: "select:DesignSync")`),
metodou `get_file`. **Nikdy nic do toho projektu nezapisuj**, je to jen ke čtení.

### Navržené obrazovky (7)

| Soubor | Obrazovka v aplikaci |
|---|---|
| `Mlain Mailer - Přehled.dc.html` | `/w/{slug}` |
| `Mlain Mailer - Kontakty.dc.html` | `/w/{slug}/contacts` |
| `Mlain Mailer - Detail kontaktu.dc.html` | `/w/{slug}/contacts/{id}` |
| `Mlain Mailer - Úprava kontaktu.dc.html` | `/w/{slug}/contacts/{id}/edit` a `/contacts/new` |
| `Mlain Mailer - Seznamy.dc.html` | `/w/{slug}/lists` a detail seznamu (dvě obrazovky v jednom souboru) |
| `Mlain Mailer - Kampaně.dc.html` | `/w/{slug}/campaigns`, editor kampaně a report |
| `Mlain Mailer - Segmenty.dc.html` | `/w/{slug}/segments` a editor segmentu |

### Ještě nenavržené (5), dělají se ve stejném rytmu

Formuláře, Šablony, Knihovna médií, Statistiky, Nastavení (dvanáct sekcí).

Rozcestník k tomu říká: „Chybějící obrazovky navrhneme ve stejném rytmu: hlavička,
filtry, karta s obsahem."

---

## 2. Pravidla designu, která drží všechny stránky

Přepsáno z rozcestníku, je to závazné:

- **Tmavý sidebar** se dá zabalit na ikony, submenu je pak ve vysouvacím panelu.
- **Papírové plochy** (`#FAF7EE`, `#F2ECDB`), jediná identitní barva je **obilná žlutá** (`#E4C258`).
- **Žádné stíny ani gradienty.** Karty odděluje **hairline rámeček** (`#E1D9C4`).
- **Ikony Lucide**, vložené přímo jako SVG.
- **Meta údaje, čísla a štítky nese IBM Plex Mono**, zbytek IBM Plex Sans.

Barvy zachycené z rozcestníku (další si vytáhni z jednotlivých obrazovek):

| Účel | Hodnota |
|---|---|
| Pozadí papíru | `#FAF7EE` |
| Pozadí papíru tlumené | `#F2ECDB` |
| Text | `#26221A` |
| Text tlumený | `#6C6453` |
| Hairline rámeček | `#E1D9C4` |
| Identitní žlutá | `#E4C258` |
| Žlutá plocha | `#F5E8BC` |
| Žlutá na tmavém | `#6E5716`, `#77621B` |
| Tmavá plocha | `#26221A` |
| Text na tmavé | `#F5EFDF`, `#C9BFA8`, `#9A907B` |
| Zelená plocha (stav) | `#E3EAD3` / `#4A5A2A` |

**Písmo:** IBM Plex Sans (400, 600) a IBM Plex Mono (400), podmnožina `latin-ext`
kvůli češtině.

---

## 3. Železná pravidla implementace

1. **Nic natvrdo.** Žádná barva, velikost ani mezera přímo v komponentě. Všechno
   přes tokeny. Návrhové soubory mají styly inline, protože je to náhled; **v aplikaci
   to inline být nesmí.**
2. **Vše v komponentách.** Opakující se prvek je komponenta v `packages/ui`, ne
   zkopírovaný kus rozvržení na pěti obrazovkách.
3. **Každá stránka zvlášť.** Obrazovky se neslučují do jedné univerzální šablony.
4. **Sedět na pixel.** Rozestupy, velikosti písma, tloušťky rámečků a barvy se berou
   z návrhu, ne od oka.
5. **Funkčnost se nesmí ztratit.** Obrazovky dnes něco umí a je to výsledek celého dne
   oprav. Design mění vzhled, ne chování. Když návrh nějakou funkci nezachycuje,
   **funkce zůstává**, jen dostane vzhled podle systému.
6. **Texty se berou z katalogu** (`packages/i18n/messages/`), ne z návrhu. Návrh je
   v češtině, ale aplikace je dvojjazyčná. Nové klíče do cs i en.
7. **Přístupnost se nesmí zhoršit.** Viditelný focus, sémantické landmarky, kontrast.

---

## 4. Rozdělení práce

Pořadí je dané závislostmi: **základ musí být hotový dřív, než začnou stránky.**

### Etapa 0: základ (jeden agent, ostatní čekají)
- Tokeny (barvy, typografie, mezery, rádiusy) v `packages/ui`.
- Písmo IBM Plex, samohostované, s `latin-ext`.
- Ikony Lucide jako komponenty.
- Skořápka aplikace: tmavý sidebar se zabalením, hlavička, rozvržení.
- Základní prvky: tlačítko, odznak, štítek, karta, tabulka, formulářové prvky.
- **Výstup navíc: `docs/superpowers/DESIGN-ZAKLAD.md`** s výčtem tokenů a komponent,
  aby na to ostatní agenti navazovali a nevymýšleli si vlastní.

### Etapa 1: navržené obrazovky (paralelně)
Jeden agent na obrazovku, viz tabulka v kapitole 1.

### Etapa 2: nenavržené obrazovky (paralelně)
Formuláře, Šablony, Knihovna médií, Statistiky, Nastavení.

---

## 5. Stav

Aktualizováno 5. 8. 2026, 21:10.

| Obrazovka | Stav |
|---|---|
| Základ (tokeny, písmo, ikony, skořápka, prvky) | **hotovo**, `DESIGN-ZAKLAD.md` (704+ řádků). Dobíhá fronta sdílených změn |
| Přehled | **hotovo** včetně seznamu lidí na webu a pruhu ukázkových dat |
| Kontakty | **hotovo** |
| Detail kontaktu | **hotovo** |
| Úprava kontaktu | **hotovo**, včetně vkládání textem |
| Seznamy (přehled i detail) | **hotovo** |
| Kampaně (seznam, editor, report) | **hotovo**, plus čtyři okolní obrazovky navíc |
| Segmenty (seznam, editor, stavitel podmínek) | **hotovo** |
| Formuláře | **hotovo** |
| Šablony | **hotovo** |
| Knihovna médií | **hotovo** |
| Statistiky (vývoj v čase, web, doručitelnost) | **hotovo** |
| Blokované adresy | **hotovo** |
| Štítky | **hotovo** |
| Nastavení, rámec a sekce Projekt | **hotovo** |
| Nastavení, obsah zbylých 11 sekcí | **hotovo** |
| Editor e-mailu | **hotovo**, plus celý den doladění hlavičky a panelů 6. 8. |
| Průvodce importem | **hotovo** |

> **Poznámka k těm třem posledním řádkům, 6. 8. 2026:** stály tu jako „běží" ještě dlouho poté,
> co ti agenti skončili, protože jsem tabulku neaktualizoval. Stav jsem ověřil zpětně, ale
> **strukturálně, ne vizuálně**: všechny sekce nastavení i všechny kroky průvodce importem
> stavějí na designovém systému a jsou v commitu `e594ee2`. Vizuální kontrolu proti návrhu
> u nich nikdo nedělal, takže „hotovo" tu znamená „integrované", ne „proměřené".

### Co se opravilo mimochodem, protože si toho někdo všiml

- **Odkazové tlačítko mělo rozměry běžného tlačítka**, protože výchozí velikost přebíjela variantu. Týkalo se to celé aplikace.
- **Obrys zaostření byl na tmavém panelu neviditelný**, kontrast 1 : 1 (barva obrysu = barva panelu). Většina toho, co člověk projde tabulátorem hned po načtení.
- **Slučovač tříd tiše zahazoval vlastní velikosti písma**, protože je podle tvaru názvu bral za barvu textu.
- **Editor přetékal přesně o výšku horní lišty** (`h-dvh` uvnitř oblasti, která začíná pod ní).
- **Filtr blokovaných adres neměl ovládání**, přestože prázdný stav odkazoval na „zrušit filtr".
- **Údaj o nespárovaných událostech byl natvrdo nula**, přestože pro něj neexistuje zdroj.
- **Nadpisem stránky průvodce importem je jméno kroku**, takže na obrazovce nikde nestojí, že jde o import.
- **Kontrola překladů spuštěná z podadresáře mlčky projde**, aniž cokoli zkontroluje.

### Rozpory přímo v návrzích (podklad pro zadavatele, ne naše odchylky)

Návrhy si mezi sebou v drobnostech odporují. Kde to nastalo, sjednotili jsme to a tady
je seznam, ať je vidět, že to nebylo od oka.

| Co | Návrh A | Návrh B | Co jsme zvolili |
|---|---|---|---|
| Mezera mezi sekcemi | Segmenty 40 px (ř. 217) | Seznamy, Kontakty, Detail kontaktu 25 px, Úprava kontaktu 30 px | **25 px** všude. Jedna obrazovka s jiným rytmem by vypadala jako nedodělek |
| Svislý okraj řádku tabulky | Kontakty 14 px | Seznamy 16 px | každá obrazovka si drží svůj, rozdíl 2 px nestojí za přepisování hotové práce |
| Odznak oslovení | Kontakty 11 px | Detail kontaktu 12 px | **11 px**, jeden údaj nemůže mít dvě velikosti |
| Nastavení sloupců | Seznamy: ikonový čtverec 44×44 v hlavičce | Kontakty: tlačítko se slovem „Sloupce" 40 px v řádku filtrů | **ikonový čtverec v hlavičce** na obou, jedno ovládání nemá mít dva tvary |

**Nabídka „…" v řádku seznamu:** návrh Seznamů ten sloupec kreslí, ale neříká, co v něm je,
a aplikace nad řádkem seznamu žádnou akci nemá. **Neudělali jsme ji**, vymýšlet funkce není
oblékání. Čeká to na rozhodnutí zadavatele.

---

## 6. Provozní poznámky pro agenty

- Node na výchozí cestě je starý: `export PATH=/opt/homebrew/opt/node@24/bin:$PATH`.
- Dev server běží na http://localhost:3200 nad databází `mlain_clean`
  (kontejner `mlain-dev-pg`, port 55432, role `mlain_migrator`, heslo `mlain`).
  **Nerestartovat.**
- Prohlížeč si každý agent pouští **vlastní** (`chromium.launch()`), sdílený ne:
  ve sdíleném chodí kliknutí jen do záložky v popředí a jinak mlčky nedělají nic.
- Úlohy na pozadí běží ze sestaveného kódu v `apps/worker/dist`. Kdo potřebuje
  přestavět workera, napíše to hlavnímu agentovi.
- `exactOptionalPropertyTypes` je zapnuté: volitelnou propu s `undefined` nepředávat,
  prostě ji vynechat.
- Git je jen pro hlavního agenta. Subagent nikdy necommituje.

---

## 7. Vzorec, který se má cíleně hledat: obal polykající ovládací prvky uvnitř

**6. 8. 2026 jsme na tuhle past narazili třikrát za jedno dopoledne**, pokaždé jiný agent,
pokaždé jiná část aplikace. Není to náhoda a je to cennější než ty tři opravy dohromady.

Pravidlo, které z toho plyne, je jednou větou:
**co si klávesnici nebo myš obsluhuje samo, tomu do ní obal nesmí mluvit.**

| Kde | Co obal dělal | Jak se to projevilo |
|---|---|---|
| `data-table.tsx`, klávesnice | obsluha řádku se vyjímala jen z `INPUT` a `TEXTAREA` | tlačítko v řádku **nešlo z klávesnice spustit vůbec**. Enter odnavigoval jinam, mezerník zaškrtl řádek. Týkalo se šesti tabulek |
| `data-table.tsx`, myš | výjimka pro prvky v buňce **existovala, ale jen pro klik** | tatáž vada zrcadlově. Opravila se jedna cesta a nezrcadlilo se to do druhé |
| `canvas.tsx` + `inline-rich-text.tsx` | plátno bralo klávesy z pole jako operace nad bloky; lišta plošně potlačovala výchozí chování | do pole pro odkaz **nešlo psát**, adresa se vlévala do e-mailu a přepisovala označený text. `Backspace` mazal celý blok |

### Proč to testy nechytily

Protože **dostat se na prvek a spustit ho jsou dvě různá tvrzení**. Soubor
`keyboard-parity.test.tsx` se jmenuje „klávesová rovnocennost", měl testy na výběr, řazení,
stránkování i otevření řádku, a přesto byl zelený: netestoval **ani jeden ovládací prvek
uvnitř buňky**.

### Co s tím

- Kdo píše obsluhu událostí na obalu (řádek, plátno, karta, plovoucí vrstva), **musí napsat
  i výjimku pro ovládací prvky uvnitř**, a to pro obě cesty naráz, klávesnici i myš.
- Výčet prvků držet **v jedné konstantě**, ze které čtou obě obsluhy. Dva opsané řetězce se
  časem rozejdou, což je přesně to, co se stalo v `data-table.tsx`.
- **Test se ověřuje tak, že se oprava dočasně vrátí a zkontroluje se, že spadne.** Oba agenti,
  kteří to udělali, měli pravdu; kdo to neudělá, dodá zelenou dekoraci vedle opravy.

---

## 8. Nálezy, které nikdo nezadal a nikdo je zatím neopravil

Věci, kterých si agenti všimli mimo své zadání. **Nejsou opravené**, jsou zapsané, aby
se neztratily. Pořadí je podle toho, co může nejvíc bolet.

### Značka projektu se do e-mailů nepromítá (řeší se)

Barvy z Nastavení → Značka projektu se dnes dostanou do e-mailu **jedinou cestou, a to přes
AI asistenta**. Nová kampaň, nová šablona, nový formulář, ukázková data i **systémové e-maily
seznamu** (potvrzení odběru, uvítání, rozloučení) dostávají výchozí modrou.

Dokument přitom **žádné barvy nenese**, má prázdný objekt a modrá vzniká až při dopočítávání.
Díky tomu jde spolehlivě poznat „tuhle barvu nikdo nesahal" od „tuhle si někdo nastavil ručně".

### Potvrzení odběru přepne po kliknutí jazyk

**Úzká, ale skutečná vada.** Stránka „Potvrdit odběr" se ukáže v jazyce kontaktu, ale výsledek
po kliknutí přijde v jazyce projektu (`confirmByRef`, `packages/core/src/contacts/public/confirm.ts:144`,
který jako jediný jazyk kontaktu nepřepisuje).

**Pozor na širší verzi tohoto tvrzení, ta je vyvrácená.** Během dne padlo, že „veřejné stránky
ignorují jazyk kontaktu" a že anglicky mluvící příjemce dostane českou odhlašovací stránku.
**Není to pravda a je to naměřené**, ne odvozené: anglický kontakt v českém projektu dostal
odhlašovací stránku anglicky (`<html lang="en">`, tlačítko „Unsubscribe"), a to i v českém
prohlížeči. Přes `readVerifiedToken`, který jazyk kontaktu dosazuje, jdou `/u/`, `/p/`, `/r/`
i `/v/`.

Mrtvý parametr `contactLocale` u `publicScope` a zavádějící komentář nad ním zůstávají, ale je
to kosmetika.

### Pozvánka do projektu chodí v jazyce instalace

Ne v jazyce projektu ani zvaného (`identity/invitation-service.ts:149`). Totéž e-mail o konci
zkušebního režimu. Pro instalaci s vícejazyčnými projekty je to špatně.

### `Escape` v poli pro adresu odkazu ukončí psaní celého textu

Místo aby zavřel jen řádek s odkazem. Plyne to z toho, že se `Escape` na plátně obsluhuje
ještě před pojistkami a bez ohledu na cíl. **Spíš otázka návrhu než vada**, čeká na rozhodnutí.

### Předvyplněný seznam ve formuláři „Přidat kontakt"

Seznam Odběratelé je zaškrtnutý předem. Kdo si toho nevšimne, přihlásí člověka do seznamu,
o kterém nevěděl, a **u dvojího potvrzení mu rovnou odejde e-mail**. Narazili na to dva agenti
nezávisle, oba tím nechtěně vyrobili odchozí zprávu.

### Dva konflikty (409) v konzoli editoru: VYVRÁCENO, není to vada

Zapsal jsem sem, že jde o překryv automatického ukládání a že se kvůli tomu může ztratit
úprava. **Není to pravda a je to doložené.**

Ty dva 409 nepatří ukládání, ale volání `POST /templates/{id}/validate`, kde je 409
**záměrný smluvní kód** se významem „mezi nálezy je aspoň jeden blokující"
(`packages/core/src/templates/api/templates.routes.ts:1001`). Klient ho výslovně toleruje
(`http-ports.ts:152` vyjímá 409 i 422) a nálezy vykreslí do lišty. Nová prázdná kampaň
blokující nálezy má, takže 409 je **správná odpověď**.

Konflikt ukládání by byl 412 `precondition_failed`, ne 409. Dvojí volání je dvojí spuštění
efektu ve vývojovém režimu.

**Zbývá jen kosmetika:** červený řádek v konzoli, který vypadá jako porucha, ačkoli není.

### Klikací plocha 36 px u přepínačů v hlavičce editoru

Spouštěč „Zobrazit jako" a tlačítka režimů zobrazení mají 36 px, náš práh je 44 px.
Stav před integrací designu, nikdo na to nesahal. Bije se to s pravidlem, které jinde
v aplikaci držíme, a v hlavičce editoru je to zrovna hodně používané místo.

### Žlutá primární akce u samostatné šablony

Tlačítko „Poslat test" bylo v editoru samostatné šablony primární (žluté). Po převodu
na ikonu je tmavé, protože **ikonové tlačítko žlutou variantu nemá**.

Rozhodnutí zadavatele: **necháváme tmavé.** Zavádět žlutou do ikonového tlačítka kvůli
jednomu místu by znamenalo, že žlutá přestane znamenat „hlavní akce obrazovky" a začne
se objevovat v řadě ikon. V editoru uvnitř kampaně se navíc nic neztrácí, primární akce
tam zůstává „Uložit a zpět do kampaně".

### Čtyři osiřelé překladové klíče po zrušení šířky sloupců

`contacts.list.columnWidth` a `reports.table.columnWidth`, v češtině i angličtině.
Ovládání zmizelo, klíče zůstaly. Smazat.

### Náhledy šablon

Chtějí změnu na straně serveru, samotným designem se to nespraví.

**Upřesněno 7. 8. 2026:** v rozhraní není co spravit ani designem, ani jinak. Knihovna šablon
je seznam bez miniatur a `thumbnail_asset_id` se v `apps/web` nevyskytuje, takže není rozbitý
obrázek ani prázdné okno. Je to chybějící funkce, ne vada, a rozvaha o ní je v oddílu 3
`STAV-UKOLU.md`.

### Zbytky zkušebních dat v `mlain_clean`

Mimo jiné kampaň „Zkouška toku e-mailů", třicetibloková „Nová šablona" a segmenty
začínající na „ZK". K úklidu, až přestanou být potřeba.

### Kontrola kódu hlásí 11 chyb, které s designem nesouvisí

Všechny v `docker/collect-runtime-deps.mjs` a `docs/design/script.js`. Starší stav,
nikdo z agentů na tyhle soubory nesahal.
