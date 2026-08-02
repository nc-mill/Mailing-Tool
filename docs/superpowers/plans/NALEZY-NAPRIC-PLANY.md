# Nálezy napříč plány

## Stav po fázi 2 (2026-08-01)

Recenze proběhly na deseti plánech, zbylých šest běží. Výsledek je jednoznačný a shodný:

> **Žádný doménový plán není proveditelný proti současnému schématu, a všechny mají tentýž kořen.**

Není to chyba autorů. Je to cena za rozhodnutí nechat celé schéma napsat jediný plán dopředu,
aby nevznikaly souběžné migrace. P03 psal schéma dřív, než doménové plány zjistily, co potřebují,
a obráceně to nešlo, protože ty potřebují schéma, aby proti němu mohly psát.

| Plán | Kritických | Nejzávažnější |
|---|---|---|
| P03 | 23 (pět recenzí) | uvnitř v pořádku, problémy jsou na hranicích |
| P04 | 7 | nespustí se bez sedmi zásahů do schématu |
| P07 | 6 | tři zastaví plán hned na začátku |
| P08 | 3 | 34 ze 43 úkolů v pořádku, vadí způsob přístupu k databázi |
| P09 | 3 | z 90 % v pořádku, ale všechny tři se projeví až v produkci |
| P10 | 5 | tři tvrdé chyby, dva tiché nulové výsledky |
| P11 | 9 | tři shodí kód hned, ale většina oprav je na straně P11 |
| P13 | 4 | žádná fáze se nezkompiluje, chybí primitivum |
| P14 | 4 | doména promyšlená, blokují první úkoly |
| P16 | 7 | tři třídy „projde testy, v provozu tiše nefunguje"; **opraveno 1. 8. 2026**, plus pět nových nálezů N72 až N76 |

### Jediná položka, která blokuje nejvíc

**Typ transakčního handle.** P03 exportuje syrové databázové spojení, ale P04 na něm volá
Drizzle API, a P04 ten adaptér dodává všem ostatním plánům. Objevuje se nezávisle v nálezech
P04, P11 i P13. **Datová vrstva by se nezkompilovala nikde.**

> **UZAVŘENO 2026-08-01 u vlastníka.** Doplňkový průchod schématu to vyřešil v P03, tedy tam,
> kam to patří. P03 má rozhodnutím **R34** `export type Tx = NodePgDatabase<typeof schema>`
> a handle vyrábí sám obalením jednoho vyhrazeného spojení; rozhodnutím **R35** navíc exportuje
> `pgErrorCode`. Přibyla i obálka `withoutContext(pool, fn)`, která dřív chyběla úplně.
>
> **P04 se srovnal, ne naopak.** Jeho adaptér `packages/core/tx` už nic nepřevádí ani
> nepřejmenovává. Zbyla mu jediná úloha: držet aplikační pool a doplnit ho do obálek P03,
> protože ty ho berou prvním argumentem a `packages/db` žádný singleton nedrží.
> Transakční logika (BEGIN, `set_config`, kontrola nezměněného kontextu, zahození rozbitého
> spojení přes `release(true)`) tak existuje v repozitáři **jednou**.
>
> Tři věci, na kterých se P04 musel srovnat a stojí za zapamatování pro ostatní plány:
> obálka se jmenuje **`withoutContext`**, ne `withoutWorkspace`; `withReadOnly` bere
> **`ReadOnlyOptions`**, tedy objekt `{ statementTimeoutMs, workMem? }`, ne holé číslo
> (`workMem` zavedl P03 kvůli náhledu segmentu v P11 a přes podpis s číslem by ho P11
> neměl kudy předat); a `pgErrorCode` **se nepíše znovu**, jeho verze pokrývá i chybu
> ze syrového `pool.query`, kde SQLSTATE leží přímo na `error.code`.
>
> Ověřeno spuštěním `tsc` proti podpisům opsaným z aktuálního P03, ne přečtením: adaptér
> i všechny vzory použití se přeloží (exit 0), a starý podpis `withReadOnly(ctx, 3000, fn)`
> správně neprojde (`Argument of type 'number' is not assignable to parameter of type 'ReadOnlyOptions'`).
>
> Při té práci vyšly najevo **dvě věci, které minuly všechny recenze**, protože se poznají jen spuštěním:
>
> 1. **`tx.execute()` na ovladači `node-postgres` vrací `QueryResult`, ne pole.** Řádky jsou pod `.rows`,
>    `result[0]` je `undefined`. Vzor `await tx.execute(...) as unknown as Row[]` projde typovou
>    kontrolou i code review a **za běhu vrátí `undefined`**. V P04 to bylo na 41 místech, opraveno
>    na `const { rows } = await tx.execute<Row>(...)`. **Ostatní plány mají tentýž vzor a musí ho opravit taky.**
> 2. **SQLSTATE je na `error.cause.code`, ne na `error.code`.** Drizzle chyby balí do `DrizzleQueryError`.
>    Kdo testuje `err.code === '23505'`, testuje `undefined` a jeho ošetření kolize se nikdy neprovede.

### Co z toho plyne pro postup

Nejdřív dokončit recenze všech šestnácti plánů, teprve pak **jeden** doplňkový průchod.
Kdyby se schéma opravilo dřív, nálezy zbylých plánů dorazí po něm a vyžádají si druhý průchod,
tedy přesně to, čemu se dělení vyhýbá.

Zadání průchodu je hotové v `docs/replan/p03-revize-soulad-napric-plany.md`, souhrnná tabulka
31 položek se sloupcem, na které straně se opravují.

---

Vzniká při psaní implementačních plánů (fáze 1). Autor plánu, který narazí na rozpor
mimo své vlastnictví, ho **neopravuje**, ale zapíše sem. Uzavírá se ve fázi 2
(`/replan:replan`) nebo rozhodnutím zadavatele.

Pravidlo: plán smí měnit jen soubory, které vlastní. Rozpor v cizím vlastnictví
je nález, ne úkol.

---

## Otevřené

### N60. Plánovač přepočtu nemá jak číst napříč projekty, a selže tiše

- **Našla:** kontrola faktů pro P11, 2026-08-01, ověřeno grepem přes všechny plány
- **Týká se:** P03 (role a politiky), P11 (segmenty), P07 (importy)
- **Závažnost:** vysoká, a je to **tichý** režim selhání

Schéma má dva indexy stavěné výslovně pro sken napříč projekty, tedy pro plánovač přepočtu
segmentů a pro obnovu zaseknutých importů. Ani jeden nemá projekt v čele klíče, protože se
podle něj nefiltruje.

**Chybí ale přístupová cesta.** Rolí je šest a žádná neumí ty tabulky číst napříč projekty.
Aplikační role bez nastaveného kontextu vrátí **nula řádků a nevrátí chybu**, což je přesně ten
tichý režim, kvůli kterému schéma zavedlo výjimky pro sender a pro údržbu.

Výsledek: plánovač by běžel, tvářil se zdravě a **nikdy by nic nepřepočítal**. Segmenty by
zůstaly se zastaralými počty a zaseknuté importy by nikdo neobnovil.

Rozhodnout: buď se doplní úzká výjimka jako u údržby, nebo plánovač poběží po projektech.
Druhá varianta je dražší, ale nezavádí další roli s širokým čtením.

### N61. Zápis stavu indexu nad vlastními poli nemá vlastníka

- **Našla:** tatáž kontrola
- **Týká se:** P03, P07, P11
- **Závažnost:** střední

Schéma má sloupce `indexed` a `index_state` a nově i utilitu, která index založí nebo zruší.
**Ale sloupce nikdo nezapisuje.** P03 to sám otevřeně přiznává: bez toho by `indexed` zůstal
navždy na nepravdě, aniž by to kdokoli nazval rozhodnutím.

Rozhodnout, jestli zápis patří P07 (vlastní pole) nebo P11 (segmenty, které index využívají).

### N41. Kdo zavolá přípravu dat pro render

- **Našla:** křížová kontrola vlny B, 2026-08-01
- **Týká se:** P13 (materializace), P09 (sender), P08 (renderer)
- **Závažnost:** vysoká, tichá ztráta obsahu v odeslaných e-mailech

**Pozor, původní znění tohohle nálezu bylo chybné a je opravené.** Tvrdilo, že sender plní jiný
kořen, než jaký šablona čte, a že jde o rozpor. Není. Jsou to **dva různé mechanismy**:

- **`_present` vyrábí TypeScript strana** funkcí `prepareRenderData` z kontraktu a putuje k senderu
  **uvnitř `render_data`**. Sender ho jen čte.
- **`_blank` je vlastní mechanismus senderu** na jiný problém: literály `blank` a `empty` jsou
  v gramatice povolené, ale Go lexer je nezná a vyhodnotí je na prázdnou hodnotu, takže porovnání
  vyjde opačně než v prohlížeči.

**Skutečná otázka, která zůstává:** funkci `prepareRenderData` definuje kontrakt, ale **volá ji až
aplikace při materializaci outboxu, tedy P13.** Kdyby ji nikdo nezavolal, kořen `_present`
v datech nebude, podmínky se vyhodnotí jako nepravda a **podmíněné bloky se v mailu skryjí,
aniž by cokoli spadlo**. Slevový kód, který se má ukázat jen některým, by se neukázal nikomu.

Zadáno: sender má mít **hlasitou kontrolu**, tedy když kompilovaná šablona odkazuje na `_present`
a v datech ten kořen chybí, zpráva se zastaví s chybou. A P13 musí tu funkci při materializaci
skutečně volat. Součástí je **golden fixture přes celý řetěz**, od bloku s podmínkou přes
kompilaci až po interpolovaný výstup.

**Stav 2026-08-01: půlka senderu je hotová.** P09 má kontrolu jako V6/V7 v kapitole 1.4
a jako `RequirePresence` v úkolu 21: chybějící kořen i chybějící jednotlivý klíč jsou tvrdá chyba
zprávy s kódem `render_data_missing_presence`, takže se z tiché ztráty obsahu stala hlasitá
porucha. Ověřeno spuštěním. Sender má zároveň Go protějšek sdílené funkce
(`liquidx.PrepareRenderData`) a jeho pravdivost sedí s TypeScriptem případ po případu.
**Zbývá:** volání `prepareRenderData` v materializaci P13 (zapsané jako požadavek R7 v kapitole
31 plánu P09) a golden fixture přes celý řetěz od P02 a P08.

### N42. Dva různé layouty téhož balíčku

- **Našla:** křížová kontrola vlny B
- **Týká se:** P07, P13, P01 (vlastní manifest a mapu exportů)
- **Závažnost:** vysoká, import by spadl

P07 má strom pod `packages/core/contacts/`, P13 pod `packages/core/src/campaigns/`.
Rozhoduje P01, protože balíček zakládá.

Není to kosmetika: **katalog polí vlastní P07** a importuje se cestou, která musí odpovídat mapě
exportů. Kdyby neodpovídala, import spadne u všech, kdo katalog používají, tedy u P08 i P12.

### N43. Port pro kompilaci nevrací to, co po něm volající vyžaduje

- **Našla:** křížová kontrola vlny B
- **Týká se:** P13 (kampaně), P08 (renderer)
- **Závažnost:** vysoká, vnitřní rozpor v P13

P13 správně přijal, že zdrojem pravdy je výstup kompilace, a **vynucuje to dvakrát**: vyhodí
chybu, když odkaz nemá identifikátor z metadat, i když pozice začíná od nuly.

Jenže **port, kterým kompilaci volá, identifikátor ani počet značek nevrací**. Volající tedy
požaduje něco, co mu dodavatel z definice nemůže dát. Navíc má ten port ve dvou místech plánu
dvě různá jména a dvě různé signatury, a nikde není řádek, kde by se skutečně volal.

Patří do vlny C, až přijde P13 na řadu.

### N1. `campaign_links.id`: dva neslučitelné způsoby generování

- **Našel:** P08 (šablony a renderer)
- **Týká se:** P03 (schéma, **už napsané**), P13 (kampaně), P14 (reporty)
- **Závažnost:** vysoká, tichá ztráta dat v reportech

Část 4a dává `campaign_links.id` výchozí hodnotu `uuidv7()` a pozice odkazů čísluje od nuly.
Kontrakt ale vyžaduje `UUIDv5` odvozené z `CompileMeta.links` a pozice od jedné.

Když se to nechá být, kompilace šablony vyrobí jiná ID, než jaká má v databázi kampaň,
a proklik se spáruje s neexistujícím odkazem. **Nic nespadne**, jen report kliků bude prázdný
nebo přiřadí kliky ke špatnému odkazu. Zadavatel přitom rozhodl, že hlavní metrika je proklik.

Rozhodnout: platí kontrakt (UUIDv5, pozice od jedné), nebo část 4a. Pak srovnat obě strany.

### N2. Část 5 necituje kontrakt značek a má vlastní znění náhrady pixelu

- **Našel:** P08
- **Týká se:** P10 (tracking), P02 (kontrakty)
- **Závažnost:** vysoká

Značky pro tracking jsou pátý kontrakt, dohodnutý mezi částmi 3 a 4b. Část 5 ho ale
necituje a popisuje náhradu pixelu vlastními slovy. Historicky přesně tohle vedlo k tomu,
že tracking nefungoval vůbec, protože části 3 a 4b měly nekompatibilní značky.

### N3. Kód pauzy `contract_mismatch` není v registru chybových kódů

- **Našel:** P08
- **Týká se:** P01 (registr kódů), P13 (kampaně)
- **Závažnost:** střední

Registr kódů vlastní P01 a předdeklaruje je všechny dopředu. Tenhle v něm chybí.

**UZAVŘENO 2026-08-01 opravou P01.** Kód v registru byl už dřív, ale jen ve jmenném
prostoru `message` (stav zprávy pro sender). P13 ho potřebuje i jako HTTP kód, takže
je nově i v `PROBLEM_CODES` se statusem 422. Rozhodnutí R5 to povoluje: kód smí být
ve víc prostorech, pokud má v každém význam, a musí být v každém, kde se používá.

### N4. Fixture `LQ-051` očekává jiný chybový kód, než jaký vrací katalog hlášek

- **Našel:** P08
- **Týká se:** P02 (kontrakty a fixtures)
- **Závažnost:** střední

Golden fixture a katalog hlášek si odporují. Jedna ze stran je špatně.

### N27. Rozhraní `packages/ui` se rozešlo stejně jako schéma (systémový nález)

- **Našla:** revize P05, P06 a P12
- **Týká se:** P05 a jedenácti plánů, které z něj importují
- **Závažnost:** vysoká, ale je to tentýž očekávaný důsledek jako N9

**Je to přesná obdoba N9, jen o vrstvu výš.** P05 psal design systém dřív, než navazující plány
zjistily, co potřebují, a obráceně to nešlo. Výsledek:

- **šest z osmi komponent má jiné jméno nebo jiné props**, než jakými je navazující plány volají
- **devět komponent, které jiné plány importují, v balíčku vůbec neexistuje**
  (`Alert`, `FileDrop`, `ErrorState`, `LimitReachedState` a další)
- P06 v prvním úkolu importuje sedm stavových komponent, které P05 neexportuje

A protože `packages/ui` smí měnit **jen P05**, žádný z jedenácti plánů si to nesmí opravit u sebe.

Čtrnáct z patnácti nálezů o rozhraní vzniklo jen tím, že se plány psaly souběžně a nikdo je
nepostavil vedle sebe.

**Postup: jeden sjednocující průchod přes rozhraní `packages/ui` před zahájením vlny 1**,
obdobný tomu, který evidence zavedla pro schéma pod N9. Zadání jsou recenze
`docs/replan/p05-revize.md`, `p06-revize.md` a `p12-revize.md`.

> **Průchod je hotový, 1. 8. 2026.** P05 sjednotil rozhraní u sebe a rozepsal, co zbývá
> jedenácti navazujícím plánům. Pokračování je **N30** níž a úplný seznam s čísly řádků
> v kapitole 8.1 plánu P05. Obě věcné vady z odstavce pod tímhle jsou opravené: K2 unese
> všech 40 operátorů a chybějící konfiguraci testovacího běhu vede **N28** jako požadavek
> na P01.

K tomu dvě věcné vady, které s rozhraním nesouvisí a musí se opravit také:

- **K2 query builder nesplňuje svůj tvrdý požadavek.** Pro každý ze 40 operátorů matice vykreslí
  jediné textové pole, takže rozsahové, seznamové a bezhodnotové operátory nejdou zadat vůbec.
- **Testy P06 a P12 leží mimo vzor, který hlídá konfigurace testovacího běhu.** Oba plány
  by proběhly se zdánlivě zelenými kroky, ve kterých se **nespustil ani jeden test**.
  To je nejtišší možné selhání celé fáze 2.

### N15. Knihovna na obrázky táhne LGPL závislost a shodí licenční bránu

- **Našel:** podagent recenze P15, **ověřeno skutečnou instalací a spuštěním brány**, ne čtením
- **Týká se:** P15, P01 (licenční brána), a je to **rozhodnutí zadavatele**, ne technické
- **Závažnost:** blokující pro CI, a je to právní otázka

`sharp` sám je Apache-2.0, ale nativní libvips se instaluje jako `@img/sharp-libvips-<platforma>`
pod **LGPL-3.0-or-later**. Ověřeno instalací a pak přesně tím nástrojem a whitelistem, který
předepisuje P01:

```
Package "@img/sharp-libvips-darwin-arm64@1.3.2" is licensed under "LGPL-3.0-or-later"
which is not permitted by the --onlyAllow flag. Exiting.
EXIT CODE = 1
```

Na Linuxu, tedy v cílové image, je to totéž. Na Windows je to horší, tam je libvips slinkovaný
staticky.

Plán P15 uvádí jen licenci vrchního balíčku, takže je v přímém rozporu s vlastní větou o tom,
že LGPL brána nepustí.

**ROZHODNUTO ZADAVATELEM 2026-08-01: cílená výjimka.** `sharp` zůstává. Do whitelistu
licenční brány se přidá výjimka **výhradně na `@img/sharp-libvips-*` a `@img/sharp-win32-*`**,
nikdy plošné povolení LGPL.

Co z toho plyne a musí se udělat:

1. **P01** doplní výjimku do konfigurace licenční brány, jmenovitě na ty balíčky, ne vzorem `LGPL`.
   **HOTOVO 2026-08-01.** V `licenses.allow.json` jsou tři jmenné výjimky
   (`@img/sharp-libvips-*`, `@img/sharp-win32-*` a `caniuse-lite` kvůli CC-BY-4.0,
   což je licence dat, ne kódu). Zároveň se opravila vada, kvůli které by výjimka
   stejně nefungovala: soubor se jen validoval a do `license-checker` se nikdy
   nepředával. Skript teď vzory rozvine na konkrétní `název@verze` (samotné jméno
   `--excludePackages` neuznává, ověřeno spuštěním) a předá je do kontroly.
   Navíc spadne, když se balíček pod existující výjimkou přelicencuje.
2. **P16** při sestavení image přiloží text licence LGPL-3.0 a zdokumentuje, jak knihovnu vyměnit.
   Bez toho není podmínka LGPL splněná a nejde o formalitu, je to podmínka distribuce.
3. **P15** opraví řádek, který uvádí jen licenci vrchního balíčku, a doplní skutečný stav.

Odmítnuté varianty: vypustit `sharp` (rovnocenná náhrada pod MIT nebo Apache neexistuje,
znamenalo by to osekat extrakci značky) a odložit AI extrakci mimo MVP 0 (zlatá cesta by přišla
o krok, kde AI vygeneruje šablonu ve firemních barvách).

### N16. Mock v plánu P15 patří k předchozí verzi knihovny

- **Našel:** tentýž podagent, ověřeno rozbalením balíčku
- **Týká se:** P15
- **Závažnost:** střední, hlasitá chyba

Plán předepisuje `MockLanguageModelV2`, ale ten export v uvedené verzi neexistuje, patřil
k předchozí hlavní verzi SDK. Balíček exportuje `MockLanguageModelV3` a `MockLanguageModelV4`.
Správně je `MockLanguageModelV4`.

Při ověření se zároveň potvrdilo, že **všechny ostatní uvedené verze existují a licence sedí**,
včetně tranzitivních. Žádná vymyšlená verze.

### N12. Tracking by nefungoval vůbec: zápis události chybí tři povinné sloupce

- **Našla:** revize P03, soulad napříč plány
- **Týká se:** P10 (tracking), P03 (schéma)
- **Závažnost:** nejvyšší, produkt by neměl žádná data o otevřeních ani proklicích

P10 vkládá do `message_events` jedenáct sloupců. P03 má v té tabulce navíc `recipient`,
`rank` a `source`, všechny `NOT NULL` a **žádný z nich nemá `DEFAULT`**. Každé otevření
i každý proklik by tedy skončily chybou 23502.

Schéma je přitom vnitřně konzistentní, P03 si všechny tři sloupce ve vlastním testu vyplňuje.
Chybí to na straně P10.

Navazuje druhá vada: P10 používá `ON CONFLICT (id, received_at) DO NOTHING` a tvrdí, že zápis
dávky je idempotentní. `received_at` ale mezi vkládanými sloupci není, takže se doplní `now()`
a je pokaždé jiné. **Konflikt tedy nikdy nenastane a opakovaný běh jobu vyrobí duplicity.**
Je to přesně ta past, kterou P03 sám popsal jinde a vyřešil explicitní podmínkou.

### N13. Tři sirotci ve schématu: nikdo je nezapisuje nebo nemá čím

- **Našla:** revize P03, soulad napříč plány
- **Týká se:** P03, P09, P10, P13, P14
- **Závažnost:** střední

1. **`message_events.rank` nemá nikde definovanou škálu.** P13 má katalog hodnot, P10 to slovo
   vůbec nezná, P03 sloupec jen zakládá. Navíc P13 používá klíč `opened`, zatímco `CHECK`
   v P03 povoluje `open`.
2. **Hodnotu `circuit_breaker_open` nezapisuje nikdo.** Vyskytuje se pouze v P03, v jeho
   rozhodnutí, omezení a vlastním testu. Sender ji podle P09 nezapisuje, P13 řeší totéž jinak.
3. **`campaign_render_warnings` je osiřelá tabulka.** P03 ji zakládá a tvrdí „zapisuje sender,
   čte report", ale P08, P09, P13 ani P14 ji nezmiňují ani jednou. A jako jediná z osmi tabulek
   se senderským grantem nemá politiku, která by senderovi zápis dovolila.

### N14. Sender si drží vlastní repliku schématu a už teď se rozchází

- **Našla:** revize P03, soulad napříč plány
- **Týká se:** P09 (sender), P03
- **Závažnost:** vysoká

P09 má v `apps/sender/internal/testsupport/schema.sql` vlastní kopii schématu pro testy.
Rozdíly proti P03 už teď:

| Věc | P09 replika | P03 |
|---|---|---|
| dělení `message_events` | podle `ts` | podle `received_at`, a P03 to výslovně označuje za tvrdou chybu |
| `messages.contact_id` | nullable | `NOT NULL` |
| rychlost odesílání | `double precision` | `numeric(10,2)` |
| `source` | výchozí `'sender'` | hodnota, kterou `CHECK` nedovolí |
| chybí úplně | `recipient`, `rank`, `campaign_id`, omezení na počet pokusů | |

Sender tedy testuje proti schématu, které v produkci neexistuje. Testy budou zelené a produkce
spadne. Replika musí být generovaná z pravdy, ne psaná ručně, jinak se rozchod bude opakovat.

### N10. Kontrakt žádá kontrolu, pro kterou sám nedodává vstup

- **Našel:** P09 (sender)
- **Týká se:** P02 (kontrakt), P13 (kampaně), P03 (schéma)
- **Závažnost:** střední, ale je to díra ve zmrazeném kontraktu

Kritérium AK-6.21 chce, aby sender porovnal počet nalezených značek odkazů proti
`clickMarkerCount`. Jenže `CompileMeta` je typ části 3, DDL `campaigns` v části 4a žádný
sloupec s kompilačními metadaty nemá a kontraktní podmnožina sloupců `campaigns` v 4.10.1
ho taky nevyjmenovává. **Sender tu hodnotu nemá odkud vzít.**

P09 to řeší degradací: čte nepovinný `campaigns.compile_meta`, při jeho nepřítomnosti vypne
jen tuhle jednu kontrolu a zaloguje `compile_meta_column_missing`. Ostatní čtyři kontroly
běží dál. Doplnění sloupce je zapsané jako požadavek na P13.

Patří k N9, tedy do jednoho doplňkového průchodu schématem.

### N11. Testovací vektory tokenů se mezi částí 1 a částí 4b liší

- **Našel:** P09
- **Týká se:** části 1 a 4b specifikace, P02
- **Závažnost:** střední

Obě části uvádějí testovací vektory trackovacích tokenů a **nesouhlasí**: jiný open token
i jiné plné HMAC. P09 ověřil, že vektor v části 1 je vnitřně konzistentní (prvních 16 bajtů
uvedeného HMAC sedí se závěrem base64 řetězce), a rozhodl, že platí část 1, protože vlastní
kontrakt. Vektory v části 4b pocházejí ze znění před poslední změnou payloadu.

Opravit v části 4b, ať nezůstanou dvě verze pravdy.

### N9. Doménové plány žádají sloupce, které P03 nemohl znát (systémový nález)

- **Našli:** P08, P10, P16, a pravděpodobně i plány, které se ještě píšou
- **Týká se:** P03 (schéma), P04
- **Závažnost:** vysoká, ale je to očekávaný důsledek dělení, ne chyba

Řídicí dokument záměrně nechává celé schéma napsat jediný plán dopředu, aby nevznikaly
souběžné migrace. Cena za to je tahle: **P03 psal schéma dřív, než doménové plány zjistily,
co doopravdy potřebují.** Nešlo to obrátit, protože doménové plány zase potřebují schéma,
aby proti němu mohly psát.

Zatím požadované doplňky:

| Co | Kdo žádá | Proč |
|---|---|---|
| `identities.shared` | P10 | Algoritmus převazby ho vyžaduje, specifikace ho v DDL nemá |
| `message_events.processed_at` | P10, P13 | Značka idempotence při zpracování událostí |
| `withWorkspaceTx`, `createSystemContext` | P10 (od P03 a P04) | Primitiva pro transakce v kontextu projektu |
| Příznak ukázkovosti | P16 | Viz N8, zatím obcházeno manifestem |
| `campaign_links.id` jako UUIDv5 | P08 | Viz N1, teď je `uuidv7()` |

**Postup:** až budou hotové všechny plány, projít nasbírané požadavky a udělat **jeden**
doplňkový průchod P03. Ne patnáct malých migrací od patnácti plánů, to je přesně to,
čemu se dělení vyhýbá. Průchod musí proběhnout **před** zahájením implementace,
jinak si první doménový plán sáhne do cizího balíčku.

**ZADÁNÍ PRŮCHODU JE HOTOVÉ:** `docs/replan/p03-revize-soulad-napric-plany.md`, kapitola
„Souhrnná tabulka". Obsahuje 31 položek roztříděných podle toho, kde se opravují:
17 v P03 samotném, 3 v P03 společně s jiným plánem, 7 jen v doménovém plánu,
4 jsou čistá rozhodnutí bez kódu.

**Změny typu a nullability musí do téže migrace hned**, dokud jsou tabulky prázdné.
Po vydání by to byly přepisy dat na živé instalaci, tedy přesně ta operace, kterou plán
sám označuje za nejrizikovější.

Z tabulky stojí za zvýraznění dvě věci, které nikdo nečekal:

- **Typ transakčního handle je neslučitelný mezi P03 a P04.** P03 předává syrový `PoolClient`,
  P04 a doménové plány počítají s Drizzle handle. Tohle by se projevilo hned prvním
  doménovým dotazem.
- **`message_events.rank` může být generovaný sloupec.** Hodnota je čistá funkce typu události,
  takže ji nemusí zapisovat ani P10, ani P13, a nemůže se rozejít. Řeší to zároveň nález
  o dvou různých názvech téže hodnoty ve dvou plánech.

### N7. Záloha pod rolí s RLS by vyrobila prázdný dump, a nic by neselhalo

- **Našel:** P16 (onboarding a provoz)
- **Týká se:** P03 (role a granty, **už napsané**), P16
- **Závažnost:** nejvyšší, tichá ztráta všech dat

Role `mlain_backup` má podle návrhu jen `pg_read_all_data`. To **není** `BYPASSRLS`.
Pod takovou rolí `pg_dump` doběhne bez chyby a vyrobí syntakticky bezvadný dump,
ve kterém má **každá chráněná tabulka nula řádků**.

Nic nespadne, exit kód je nula, soubor existuje a má rozumnou velikost kvůli schématu.
Chyba se pozná až ve chvíli, kdy někdo obnovuje po havárii, tedy v nejhorší možný okamžik.

P16 to řeší tím, že `mlain backup` odmítne běžet pod rolí, na kterou platí RLS. Ověřit,
že to sedí s rolemi, které založil P03, a že kontrola je test, ne jen věta v dokumentaci.

### N8. Ukázková data nemají ve schématu příznak ukázkovosti

- **Našel:** P16
- **Týká se:** P03 (schéma), P07 (kontakty), P13 (kampaně)
- **Závažnost:** střední

UI specifikace s příznakem počítá (požadavek U→2.9), ale schéma ho nemá a nový sloupec
by znamenal migraci, kterou vlastní P03. P16 to obchází třemi existujícími mechanismy
a maže podle manifestu v `workspaces.settings`, ne podle značky, protože uživatel může
ukázkový kontakt upravit a značku smazat. Rozhodnout, jestli se doplní sloupec, nebo
zůstane obchvat.

Souvisí s tím nezavřená mezera, kterou P16 přiznal: ochrana „ukázkové kontakty nejdou
do publika kampaně" leží v souborech P07 a P13, takže ji P16 napsat nemůže. Je z ní
rozhraní na P13 a E2E scénář, který spadne, pokud ji P13 nedodá.

### N5. Vzor pro rody v kapitole o lokalizaci nedává slíbený výstup

- **Našel:** P05 (design systém a i18n)
- **Týká se:** část 6 specifikace, kapitola 12.3
- **Závažnost:** nízká, ale je to chyba ve vzoru, který se bude kopírovat

Specifikace ukazuje `{gender, select, ...}} kampaň {campaign}` a slibuje, že u neznámého
rodu vznikne „Otevření kampaně". Nevznikne. Slovo „kampaň" je natvrdo mimo přepínací blok,
takže vyjde „Otevření kampaň". Vlastní příklad porušuje pravidlo „nikdy neskládáme věty
z fragmentů", které si tatáž kapitola stanovuje.

P05 to ve svém plánu řeší celou větou v každé větvi. Opravit i ve specifikaci, ať se
chybný vzor nekopíruje dál.

### N6. Kritéria 16 a 18 části 6 nejdou splnit obě doslovně

- **Našel:** P05
- **Týká se:** část 6, kapitola 15
- **Závažnost:** nízká

P05 to řeší tak, že nedostupná akce není `disabled`, ale vysvětlí, co chybí. Rozumné,
ale je to rozhodnutí, ne implementace zadání.

### N17. P01 zakládá čtyři role, model potřebuje šest

- **Našla:** revize P03, zapracování oprav
- **Týká se:** P01 (`docker/initdb/10-roles.sql`), P03
- **Závažnost:** vysoká, tichá ztráta dvou operací

P03 počítá se šesti rolemi, `docker/initdb/10-roles.sql` zakládá čtyři. `mlain_gdpr`
(výmaz podle čl. 17) a `mlain_maintenance` (retence osobních údajů) v P01 ani ve
specifikaci **nejsou vůbec**.

Dřív to bylo tiché dvakrát: granty pro obě role byly v migraci obalené do
`EXCEPTION WHEN undefined_object`, takže se v produkci přeskočily, a testovací harness
si všech šest rolí zakládal sám, takže test „role má právo mazat" byl zelený nad
prostředím, které u zákazníka neexistuje.

**P03 svou stranu opravil:** obalení výjimkou zmizelo (rozhodnutí R19), takže migrace
na databázi bez rolí hlasitě spadne, a `test/grants.test.ts` kontroluje počet i atributy
rolí proti `pg_roles`.

**UZAVŘENO 2026-08-01 opravou P01.** `docker/initdb/10-roles.sql` zakládá `mlain_gdpr`
i `mlain_maintenance`, obě dostávají `GRANT CONNECT` a `GRANT USAGE ON SCHEMA public`,
a test v P01 kontroluje všech šest rolí místo čtyř. Ověřeno spuštěním proti
PostgreSQL 18.4 včetně druhého běhu nad existující databází. Do téhož souboru přibyl
`ALTER DATABASE mlain SET timezone = 'UTC'`, tedy požadavek B z kapitoly 7 plánu P03,
který nešlo splnit z migrace, protože `ALTER DATABASE` smí jen vlastník databáze.

### N18. Blokující CI job zůstane po mergnutí červený a nikdo ho nesmí opravit

- **Našla:** revize P03 (proveditelnost)
- **Týká se:** P01 (`tools/ci`, `.github/workflows`), P03
- **Závažnost:** vysoká, blokuje merge všech dalších plánů

P01 dodává kontrolní skript, který **záměrně** selže, dokud mu někdo nedodá scénáře,
a předává to jako požadavek. P03 je píše, ale jinam (`packages/db/test/migrations-check.test.ts`),
a jeho vlastní pravidlo mu zakazuje sáhnout mimo `packages/db`. Vlastnictví té opravy
tedy nemá nikdo a job zůstane červený i po tom, co scénáře existují.

**UZAVŘENO 2026-08-01 opravou P01.** `tools/ci/migrations-check.mjs` už nekončí
bezpodmínečným `fail()`, ale deleguje na `pnpm --filter @mlain/db run test:migrations`.
Selže jen tehdy, když ten skript v `packages/db/package.json` chybí nebo sám selže,
tedy když je oprava proveditelná uvnitř `packages/db`, kde P03 pracovat smí. Požadavek
P01-4 se tím změnil z „doplň scénáře do tools/ci" na „drž skript test:migrations".
Stejným způsobem se opravily i tři joby kontraktů, které volaly vlastní kontrolu místo
té, kterou dodává P02.

### N19. Balíčkový skript `lint` neexistuje, plány ho přesto volají

- **Našla:** revize P03 (proveditelnost)
- **Týká se:** P01 (kořenový `package.json`, lint konfigurace)
- **Závažnost:** střední, poslední krok plánu skončí chybou

`pnpm --filter @mlain/db lint` není nikde definovaný. P01 lintuje výhradně z kořene
(`oxlint . && eslint . && prettier --check .`) a žádný balíček skript `lint` nemá.

P03 to na své straně opravil: finální brána volá `pnpm lint` z kořene. Zůstává ověřit,
že kořenový lint skutečně pokrývá i `packages/db`, a **je pravděpodobné, že totéž volají
i další plány**, protože ten tvar příkazu se mezi plány kopíroval.

### N20. Tři chybové kódy migračního runneru chybí v registru P01

- **Našla:** revize P03, zapracování oprav
- **Týká se:** P01 (registr chybových kódů), P16 (`mlain doctor`)
- **Závažnost:** střední

Registr kódů vlastní P01 a předdeklaruje je všechny dopředu. Runner P03 vrací:

| Kód | Exit | Kdy |
|---|---|---|
| `schema_version_ahead` | 5 | databáze je novější, než image umí |
| `migration_lock_timeout` | 75 | zámek drží jiná replika déle než strop |
| `migration_hash_mismatch` | 6 | **nový**, obsah už aplikované migrace se změnil |

Třetí kód je nový a zavádí ho oprava nálezu, že runner nekontroloval hash už aplikovaných
migrací: změna bílého znaku ve vydané migraci ji nechala přehrát nad hotovým schématem.
U `CREATE TABLE` by to spadlo hlasitě, u `GRANT` nebo `INSERT` tiše prošlo.

**UZAVŘENO 2026-08-01 opravou P01.** Všechny tři jsou v registru, ve **šestém jmenném
prostoru** `operational` (rozhodnutí R5), spolu s `migration_failed` (3),
`major_version_skipped` (4), `usage_error` (64), `command_not_implemented` (69)
a `config_invalid` (78). Tentýž prostor pojal i čtrnáct nálezů `mlain doctor` z P16
plus `isolation_prerequisites_missing` z nálezu N24. Prostor rozlišuje `scope`
`cli` a `doctor`, protože závažnost nálezu diagnostiky (`critical | warning | info`)
je jiná škála než u nálezů preflightu kampaně.

### N21. Materializace publika musí `created_at` nastavovat explicitně, nově to vynutí databáze

- **Našla:** revize P03 (čerstvý pohled, K4)
- **Týká se:** P13 (kampaně), P09 (sender)
- **Závažnost:** vysoká, ale nově je hlasitá místo tiché

Invariant I1 („všechny zprávy jednoho běhu mají `created_at` rovné
`campaigns.audience_built_at`") neměl v databázi žádné vynucení a `messages.created_at`
má `DEFAULT now()`. Kterákoli cesta, která zprávu vložila bez explicitního `created_at`,
tedy obešla unikátní index `uq_messages__campaign_contact` a **kontakt dostal e-mail dvakrát**,
aniž by cokoli selhalo.

P03 to opravil složeným cizím klíčem `messages (campaign_id, created_at) REFERENCES
campaigns (id, audience_built_at)`. Ověřeno spuštěním: zápis bez explicitního `created_at`
nově skončí chybou 23503.

**Co z toho plyne pro P13:**

1. Materializace musí `created_at` plnit hodnotou `campaigns.audience_built_at`, jinak
   dávka spadne. Dosud to bylo doporučení, teď je to podmínka zápisu.
2. Kampaň musí mít `audience_built_at` vyplněné **dřív**, než vznikne první zpráva.
3. Testovací odeslání (`kind = 'test'`) buď nese `campaign_id IS NULL` (pak se cizí klíč
   nekontroluje), nebo musí mít `created_at` shodné s `audience_built_at` kampaně.
   Rozhodnout na straně P13; index `idx_messages__test_claimable` je bez `campaign_id`,
   což první variantě odpovídá.

### N22. Dva zápisy musí nově nést druhou složku klíče partitionované tabulky

- **Našla:** revize P03 (schéma a migrace, D1)
- **Týká se:** P04 (webhooky), P07 nebo P11 (příchozí webhooky kontaktů)
- **Závažnost:** střední, jinak dohledání prochází všemi oddíly

Plán si sám stanovil, že každý odkaz na partitionovanou tabulku nese obě složky klíče,
ale u dvou míst to nedodržel a test to nezachytil, protože kontroloval jmenovitě jen
`message_events`. P03 doplnil sloupce i registr `PARTITIONED_REFERENCES`, podle kterého
se test nově řídí. Dopad na zapisující stranu:

1. **`webhook_deliveries.created_at` ztratil `DEFAULT now()`.** Plní se hodnotou
   `webhook_events.created_at`, takže doručení leží ve stejném měsíčním oddílu jako
   událost a dvojice `(event_id, created_at)` je úplný klíč události. Je to zároveň jediný
   způsob, jak unikátní index `uq_webhook_deliveries__event_endpoint` doopravdy chrání:
   s `now()` by dva fan-outy téže události prošly oba a příjemce by dostal webhook dvakrát.
2. **`inbound_dedup` má nový sloupec `delivery_created_at`** a `workspace_id` v primárním
   klíči.

### N23. Zpožděná událost z prohlížeče: server musí `occurred_at` oříznout, ne ji zahodit

- **Našla:** revize P03 (čerstvý pohled, D6)
- **Týká se:** P10 (tracking)
- **Závažnost:** střední

`ck_web_events__lag` dovoluje `occurred_at` v okně od sedmi dnů zpět do šedesáti sekund
dopředu. Počítač s posunutými hodinami tedy pošle událost, kterou databáze odmítne
chybou 23514. Plán neříkal, co se s ní má stát, a obě možné odpovědi jsou špatné:
tvrdá chyba shodí celou dávku, tiché zahození ztratí data.

P03 to uzavřel rozhodnutím R27: **server hodnotu ořízne do povoleného okna** a `CHECK`
zůstává jako pojistka. Událost z počítače s hodinami o den napřed tedy dorazí
s `occurred_at = received_at`. Implementace té části leží v P10.

### N24. `mlain doctor` má nově tři konkrétní kontroly, které mu P03 připravil

- **Našla:** revize P03, zapracování oprav
- **Týká se:** P16 (onboarding a provoz), navazuje na N7
- **Závažnost:** vysoká, všechny tři poruchy jsou tiché

P03 dodal tři věci, které samy o sobě nic nekontrolují, dokud je někdo nezavolá:

1. **`checkIsolationPrerequisites(pool)`** v `@mlain/db`. Vrátí seznam důvodů, proč se na
   aktuální roli nevztahuje RLS (superuživatel, `BYPASSRLS`, vlastnictví schématu).
   Samohostitel s managed PostgreSQL a jedinou rolí jinak dostane funkční aplikaci
   **bez izolace projektů** a nedozví se to. Patří do startu aplikace (P04) i do doctoru.
2. **`SELECT mlain_apply_grants()`**. `pg_dump --no-privileges` obsahuje politiky RLS,
   ale žádné granty, a ledger migrací se obnoví taky, takže migrace s granty je označená
   za aplikovanou a už ji nikdo nespustí. Postup obnovy musí funkci zavolat, jinak
   aplikace po havárii skončí na `permission denied`.
3. **Tabulka `secret_key_generations`** (`key_id`, otisk klíče, čas zavedení). Ze
   `SELECT DISTINCT fingerprint_key_id` se pozná, která pokolení se používají, ne jestli
   klíč pod tím číslem pořád existuje a jestli ho někdo neprohodil. Prohození `SECRET_KEY`
   a `SECRET_KEY_PREVIOUS` po obnově je u samohostitele reálné a projeví se tím, že
   **vymazaný člověk dostane e-mail**. Doctor má porovnávat otisk, ne existenci čísla;
   řádky do tabulky zapisuje setup a rotace klíče, ne migrace.

### N28. Dvě RLS politiky, bez kterých nejde přihlásit klíčem ani přijmout pozvánku

- **Našla:** revize P04, potvrzeno proti aktuálnímu znění P03 dne 2026-08-01
- **Týká se:** P03 (RLS politiky), P04 (fáze E a úkol 36)
- **Závažnost:** nejvyšší, a obojí selže **tiše**

Dvě operace musí dohledat řádek **dřív, než je znám projekt**, protože projekt se z toho
řádku teprve zjišťuje. Obě tabulky mají jen `ws_isolation`, takže pod rolí `mlain_app`
bez nastaveného `mlain.workspace_id` vrátí `SELECT` vždy nula řádků.

1. **`api_keys` podle prefixu.** Bez politiky skončí **každý** požadavek
   s `Authorization: Bearer ml_live_...` na `unauthenticated`, tedy jako „klíč neexistuje".
   Celá fáze E plánu P04 (úkoly 30 až 33, kritéria 19, 24, 25, 26, 26b, 26c) je neproveditelná.
   Navrhované znění: `CREATE POLICY api_key_lookup ON api_keys FOR SELECT USING
   (current_setting('mlain.workspace_id', true) IS NULL AND revoked_at IS NULL);`
   plus obdoba pro UPDATE kvůli `last_used_at`. Čistší varianta je `SECURITY DEFINER`
   funkce `lookup_api_key(prefix, kind)`, která vrátí jen sloupce potřebné k ověření.
2. **`invitations` podle `token_hash`.** Bez politiky vrací přijetí pozvánky vždy 404.
   Navrhované znění: `CREATE POLICY invitation_token_lookup ON invitations FOR SELECT USING
   (current_setting('mlain.workspace_id', true) IS NULL AND accepted_at IS NULL
   AND revoked_at IS NULL AND expires_at > now());`
   Únik dat je nulový: jediný filtr, který volající má, je `token_hash` s unikátním indexem.

**Proč se na to nepřijde z chybové hlášky:** obě cesty vracejí u neplatného vstupu 404 nebo
`unauthenticated` **schválně**, aby z odpovědi nešlo zjistit, jestli klíč či pozvánka existuje.
Chybějící politika se tedy projeví přesně tak, jako když uživatel zadá špatný token.

Zbývající tři požadavky P04 na P03 (`api_keys.previous_secret_hash`, `previous_expires_at`,
tabulka `platform.rate_limits`) už v souhrnné tabulce
`docs/replan/p03-revize-soulad-napric-plany.md` jsou a neopakují se tady.

**Naopak odpadá dřívější požadavek na politiku `member_bootstrap` pro `memberships`.**
Aktuální P03 ho řeší pořadím v `createWorkspaceAsUser` (ID projektu se generuje dopředu
a kontext se nastaví ještě před vložením řádku) a výslovně varuje, že uvolnění politiky
na `memberships` je „nejlevnější cesta k zelenému testu" a přesně ta chyba, které má model
bránit. P04 se srovnal a používá tentýž vzor.

### N29. Patnáct validačních kódů z P04 chybí v registru P01

- **Našla:** revize P04, ověřeno porovnáním se skutečným zněním registru, ne odhadem
- **Týká se:** P01 (`packages/core/src/errors/problem-codes.ts`, seznam `VALIDATION_CODES`)
- **Závažnost:** střední

Kořenové kódy (`PROBLEM_CODES`) sedí všechny, P04 nepoužívá ani jeden neregistrovaný.
V poli `errors[]` ale vydává patnáct kódů, které `VALIDATION_CODES` nezná:

`blocked_target`, `confirm_name_mismatch`, `cursor_order_mismatch`, `invalid_cursor`,
`invalid_idempotency_key`, `not_a_member`, `out_of_range`, `password_contains_email`,
`password_too_common`, `password_too_long`, `password_too_short`, `public_key_scopes_fixed`,
`scopes_required`, `unknown_scope`, `unsupported_order`.

Registr vlastní P01 a předdeklaruje kódy dopředu, takže je P04 doplnit nesmí.

### N30. Stránka detailu úlohy nemá vlastníka

- **Našla:** revize P04 při zapracování požadavků P05
- **Týká se:** P06 (obrazovky), navazuje na rozhodnutí R4 v P05
- **Závažnost:** nízká, ale bez rozhodnutí ji nenapíše nikdo

P05 dodal prezentační vrstvu Centra úloh a napsal, že „endpoint, napojení na pg-boss
a stránku `/w/{slug}/jobs/{jobId}` dodá plán, který vlastní API úloh". API úloh je P04
a ten **endpointy i registr zdrojů dodal** (úkol 45). **Obrazovky ale P04 nepíše žádné**,
má to ve svém výčtu vyloučení, takže stránka detailu úlohy patří P06.

Zároveň se ukázalo, že generická tabulka úloh ve schématu neexistuje a nemá vzniknout:
každá doména má vlastní tabulku postupu (`imports` u P11, `campaign_audience_progress`
u P13). P04 proto dodal **registr zdrojů**, do kterého si doména svůj zdroj zaregistruje.
**P11 a P13 musí registraci doplnit**, jinak zůstane Centrum úloh prázdné, aniž by cokoli
selhalo.

### N25. Sender nesmí adresovat měsíční oddíl jménem

- **Našla:** revize P03 (bezpečnost K2, čerstvý pohled K1, schéma K2)
- **Týká se:** P09 (sender), P13, P14, navazuje na N14
- **Závažnost:** vysoká

Rozhodnutí R20 v P03 zakazuje přímý přístup na oddíly: žádný oddíl nedostane grant,
takže `SELECT * FROM messages_y2026m08` pod kteroukoli rolí skončí na `permission denied`.
Důvod je, že oddíl nedědí `relrowsecurity` ani politiky, takže s granty šlo přes oddíl
číst řádky všech projektů a mazat cizí auditní záznamy.

Přístup **přes rodičovskou tabulku funguje beze změny** a RLS na něm platí. Kdokoli si
tedy psal dotaz s názvem oddílu (typicky kvůli výkonu), musí ho přepsat na rodiče
s podmínkou na partiční sloupec; prořezávání oddílů udělá plánovač sám.

Zároveň padá akceptační kritérium AK-20.2 části 4b („nová partition je pro sender
čitelná"), protože sender žádný oddíl jménem nečte. Nahrazuje ho opačné kritérium
a test nad `pg_class.relacl`.

### N26. Testy P03 čtou normativní SQL přímo ze souborů P02

- **Našla:** revize P03 (proveditelnost, D10)
- **Týká se:** P02 (kontrakty)
- **Závažnost:** nízká, ale je to nová vazba mezi balíčky

`packages/db/test/contract-sql.test.ts` dosud kontraktní dotazy **opisoval ručně**, takže
dokazoval, že projde opis, ne kontrakt. Nově je načítá ze souborů
`packages/contracts/fixtures/outbox/sql/*.sql` včetně hlaviček `-- role`, `-- params`
a `-- args`.

Je to čtení souboru z disku, ne import: nevzniká build závislost ani hrana v grafu
balíčků, což je tentýž postup, jakým P02 čte manifest konfigurace z P01. Přesto o tom
P02 má vědět, protože **přejmenování adresáře nebo změna tvaru hlavičky shodí testy P03**.
Test má proti tomu pojistku: kontroluje, že se načetlo právě jedenáct dotazů, aby prázdná
sada nevypadala jako úspěch.

### N28. Nálezy DNS kontrol v P13 mají jiná jména než tytéž kódy v registru

- **Našel:** zapracování oprav P01 (fáze 3)
- **Týká se:** P13 (kampaně, provideři), P01 (registr kódů)
- **Závažnost:** střední, ale je to volba jmenné konvence, ne opomenutí

Registr P01 vede nálezy domény jako `domain_spf_missing`, `domain_dkim_missing`
a `domain_dmarc_missing`. P13 ale v DNS kontrolách emituje **neprefixovanou** sadu
dvaceti šesti nálezů: `spf_missing`, `spf_multiple_records`, `spf_no_amazon`,
`spf_permissive_all`, `spf_too_many_lookups`, `spf_unknown`, `dkim_wrong_value`,
`dkim_name_duplicated`, `dkim_missing`, `dkim_unknown`, `dkim_partial`,
`dmarc_unknown`, `dmarc_missing`, `dmarc_multiple_records`, `dmarc_invalid_syntax`,
`dmarc_policy_none`, `dmarc_partial_pct`, `dmarc_spf_alignment_strict`,
`mail_from_mx_wrong`, `mail_from_mx_missing`, plus šest nálezů preflightu
(`campaign_audience_only_sample`, `campaign_audience_has_sample`,
`campaign_recompile_pending`, `campaign_trial_mode`, `deliverability_complaint_blocking`,
`deliverability_bounce_warning`).

**Do P01 se nedoplnily schválně.** Vlastní konformanční seznam P13
(`REQUIRED_ERROR_CODES`) je nezmiňuje, takže by šlo o dvacet šest kódů zavedených
bez toho, aby si je někdo vyžádal, a hlavně by v registru vznikly dvě soupravy
pro totéž. Rozhodnout je potřeba jedno: buď P13 přejde na prefixovaná jména
z registru, nebo se prefix z registru zruší a přejmenují se tři existující kódy.
Druhá varianta je dražší, protože `domain_*` používá i preflight kampaně.

Ve stejné vrstvě jsou i kódy, které P13 zapisuje do `messages.error_code`
a v registru chybí: `campaign_cancelled`, `unsubscribed`, `contact_deleted`,
`contact_anonymized`, `processing_restricted`, `contact_status_changed`
a `render_data_too_large`. Prvních šest je typ `RevokeReason`, který
`revokePending` zapisuje přímo do sloupce. Ty doplnit lze bez rozhodnutí,
jen se to má udělat jedním průchodem spolu s nálezy výše.

### N29. P13 a P11 se ptají registrů špatným tvarem

- **Našel:** zapracování oprav P01 (fáze 3)
- **Týká se:** P13, P11, P01
- **Závažnost:** střední, konformanční testy obou plánů by padaly z falešného důvodu

`ERROR_REGISTRY` v P01 je mapa **podle druhu** (`problem`, `validation`, `finding`,
`message`, `import_row`, `operational`), ne podle kódu. P13 na ni ale sahá jako
`expect(ERROR_REGISTRY[code]).toBeDefined()`, což bude vždy `undefined`.
Stejně tak `QUEUE_REGISTRY` je **pole**, ne objekt, a P13 dělá
`Object.keys(QUEUE_REGISTRY)`, což vrátí indexy `'0'`, `'1'` a tak dál.

P01 pro tenhle účel nově exportuje `isRegisteredCode(code)`, `ALL_REGISTERED_CODES`
a `queueNames()`; `ERROR_CODES` je plochá mapa, ale obsahuje jen druh `problem`,
protože jen ten má HTTP status. Opravit se to má na straně P13 a P11, ne změnou
tvaru registrů. Zapsáno i jako požadavek P01-10.

### N30. Fronta `stats.compact` a příkaz `mlain rebuild-campaign-stats` nemají vlastníka

- **Našel:** zapracování oprav P01 (fáze 3)
- **Týká se:** P14, P10, P16
- **Závažnost:** střední, obojí by prostě nevzniklo

P14 v rozhodnutí R2 uvádí, že slévání pětiminutových bloků `campaign_stats_buckets`
do hodinových (`stats.compact`) patří P10. **P10 tu frontu nemá**, jeho vlastní
seznam `TRACKING_QUEUES` má deset položek a tahle mezi nimi není. Do registru P01
se nedoplnila, protože fronta bez handleru by jen navždy hlásila varování
„fronta bez handleru v tomhle buildu".

Totéž u CLI: P14 v integračním bodu P14→P16.1 očekává, že P16 napojí
`recomputeCampaignCounts` a `compareWithStored` na příkaz `mlain rebuild-campaign-stats`.
**P16 o tom příkazu neví**, v jeho registru ani textu není. Rekonstrukce po havárii
by tedy šla spustit jen z testu.

Rozhodnout vlastníka; teprve pak se položka doplní do registru P01, protože
registry jsou uzavřené a doplňují se změnou P01.

### N31. `tracking.erase_contact` je v P01 fronta, v P10 synchronní volání

- **Našel:** zapracování oprav P01 (fáze 3)
- **Týká se:** P10, P01
- **Závažnost:** nízká, ale registry se rozcházejí oběma směry

P01 registruje `tracking.erase_contact` jako frontu s dead letter variantou.
P10 ji implementuje jako synchronní hook `eraseContact()` a ve svém seznamu deseti
trackovacích front ji nemá. Buď se z ní stane skutečná fronta (výmaz stopy kontaktu
může být dlouhý a přerušitelný, takže to dává smysl), nebo se z registru P01 vypustí.
Zatím tam zůstává, protože varování o chybějícím handleru je hlasitější než tichý
rozdíl mezi registry.

### N32. Druhá vrstva chybových kódů P06 a P11

- **Našel:** zapracování oprav P01 (fáze 3)
- **Týká se:** P06, P11, P01
- **Závažnost:** nízká

Konformanční seznamy obou plánů jsou po opravě P01 splněné. Nad jejich rámec ale
oba plány vyrábějí kódy, které v registru nejsou: P06 `out_of_range` a `blocked_target`,
P11 `duplicate_target` a `export_already_running`. Nejsou v žádném konformančním
seznamu, takže nic nespadne, ale při první odpovědi API by to byl neregistrovaný kód
a `problemCode()` by vyhodil. Doplnit jedním průchodem spolu s N28.

Sem patří i `campaigns.pause_reason` z P13: devítipoložkový výčet, který si P13
definuje sám a **výslovně ho drží otevřený**. Formálně je to porušení uzávěru S7,
věcně je to stejný typ mezery jako migrační kódy u P03, kterou P01 zavřel šestým
jmenným prostorem. Rozhodnout, jestli i pauzy patří do registru.

### N33. P03 zakládá barrel a přepisuje manifest, který mu P01 předává

- **Našel:** revize P01, nálezy K4 a D1
- **Týká se:** P03, P01
- **Závažnost:** vysoká u barrelu (blokující job), nízká u manifestu

Dvě věci na straně P03, které P01 opravit nemůže:

1. **`packages/db/src/index.ts`.** Test integrity workspace v P01 prochází všech
   devět balíčků a vynucuje uzávěr S11, tedy „barrely se nezakládají, importuje se
   podcesta". P03 v úkolu 30 ten soubor zakládá a commituje, takže by po merge
   trvale padal blokující job `test-unit`. Výchozí řešení je, že barrel v P03
   odpadne a `packages/db` se importuje podcestami (`@mlain/db/schema`,
   `@mlain/db/client`), jak to P03 sám v kapitole 8 předpokládá. Kdyby se rozhodlo
   jinak, musí výjimka jít do testu v P01, ne do prózy P03.
2. **`packages/db/package.json` a `tsconfig.json`.** P03 je uvádí jako `Create`,
   přestože je zakládá P01 a předává je (nově je to i v kapitole 1.2 P01). Změnit
   na `Modify` a doplnit větu, že manifest přebírá po P01 a musí v něm zachovat
   `name`, `license: MIT` a `private: true`. Jinak při přepsání vypadne licence
   a spadne test, u kterého nebude zřejmé proč. P02 to u `packages/contracts` dělá
   správně a přiznává to.

### N34. P08 neuvádí `@mlain/i18n` mezi závislostmi, přestože ho graf povoluje

- **Našel:** zapracování oprav P01 (fáze 3)
- **Týká se:** P08, P01
- **Závažnost:** nízká

Graf v P01 má `'@mlain/emails': ['@mlain/contracts', '@mlain/i18n']`, ale
`packages/emails/package.json` v P08 má z monorepa jedinou závislost,
`@mlain/contracts`, a `@mlain/i18n` se v celém P08 neimportuje. Buď je hrana
v grafu navíc, nebo P08 na i18n zapomněl. Nadbytečná povolená hrana nic nerozbíjí,
takže to není blokující; opravit při průchodu rozhraním.

### N28. Testy `apps/web` nemají jak běžet, a týká se to i P05

- **Našly:** revize P06 a P12, potvrdil autor P05 na vlastním plánu
- **Týká se:** **P01** (vlastník souboru), P05, P06, P12
- **Závažnost:** nejvyšší, protože selhání je tiché

`apps/web/vitest.config.ts` vlastní P01 a zní `{ environment: 'node', include: ['test/**/*.test.ts'] }`.

- **P06** má dvacet komponentních testů v `apps/web/src/features/**`
- **P12** má všechny své testy v `apps/web/src/features/editor/**`
- **P05** má `apps/web/src/proxy.test.ts` s osmi testy

Ani jeden z nich do vzoru `test/**` nespadne. Kroky „spusť test, musí spadnout" nevypíšou
červený test, ale hlášku, že žádné testy nejsou. **To vypadá jako úspěch a je to horší než
selhání.** Komponentní testy by navíc neprošly ani po opravě vzoru, protože `render()`
potřebuje `jsdom` a plugin React.

Že se to týká i P05, je při první četbě překvapivé: jeho testy komponent leží v `packages/ui`
a `packages/i18n`, jejichž konfiguraci si vlastní sám. Zapomnělo se na jediný soubor, který
zakládá v `apps/web`.

**Požadavek na P01** (shodně formulovaný v P05 kapitola 8.2, P06 a P12):

```ts
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
  },
});
```

**P12 si ten soubor nesmí nárokovat** ani s podmínkou „jen pokud ještě neexistuje". Podmínka se
nikdy nesplní, protože P01 běží dřív, a soubor se dvěma vlastníky podle pořadí je přesně ta
nejistota, které se dělení vyhýbá.

**UZAVŘENO 2026-08-01 opravou P01, společně s N55.** Viz tam: samotný tvar zapsaný výše
nestačil, chyběl obsah setup souboru.

### N29. Registrace ESLint pravidla P01 je kruhová

- **Našla:** revize P05
- **Týká se:** **P01**
- **Závažnost:** střední, ale shodí lint třem plánům

P01 má ve sdílené konfiguraci zaregistrovat pravidlo z `packages/ui/eslint-rules/`, jenže ten
soubor zakládá až P05. Mezi P01 a P05 běží P02, P03 a P04, kterým by `pnpm lint` spadl na
chybějícím souboru.

**Oprava v P01:** načítat pravidlo podmíněně, `try`/`catch` kolem `require`. P05 si to poznamenal
u předpokladu E7 jako „není to tvrdý import".

### N30. Rozhraní `packages/ui` je sjednocené, zbytek je na jedenácti plánech

- **Vyřešil:** P05, 1. 8. 2026. Je to dokončení N27.
- **Týká se:** P06, P07, P11, P12, P13, P14, P15, P16
- **Závažnost:** blokující pro vlnu 1 a 2, dokud se importy neopraví

P05 postavil vedle sebe seznam svých exportů a **všechna skutečná volání** z jedenácti plánů.
Rozhodovací pravidlo je v jeho kapitole 8.1 a znělo: kde tvar předepisuje specifikace, platí
specifikace; kde jméno používají dva a víc plánů nezávisle, platí jejich; jinak platí P05;
a komponenta, kterou nikdo nevykresluje, se nezakládá.

**Co P05 změnil u sebe** (hotovo, nic se po nikom nechce): AST query builderu je nově doslova
ten ze specifikace části 2, 4.11.1, komponenta je řízená a unese všech 40 operátorů v pěti
tvarech hodnoty; K4 bere `accept` jako řetězec s příponami i MIME typy, má skutečné tlačítko
místo popisku a sama volá nahrávání po částech; K6 má volitelně řízenou šířku a tmavý režim;
K3 dostal `useWizardStep`, takže krok v URL má konečně vlastníka; K1 má řízený výběr, zadrátované
nastavení sloupců a virtualizaci; `ConfirmDialog` přebral jména props od P07 a `confirmPhrase`
od P06 a dostal `extraAction`; registr navigace má `mvp0`; přibyly `Alert`, `FilteredEmptyState`
a `CopyButton`.

**Co se čeká od ostatních** (úplný seznam s čísly řádků je v P05, kapitola 8.1):

| Plán | Co opravit |
|---|---|
| P11 | pět importů z holého `@mlain/ui`; `FileDrop` → `FileUpload`; doplnit povinné `labels`; krok průvodce `{ id, label }` |
| P13 | osm importů z holého `@mlain/ui`; `Disclosure` → `Collapsible`; `Dot` → `Badge`; `Tile` složit u sebe |
| P16 | pět importů z holého `@mlain/ui`; `Table` → `DataTable` s jinými sloupci; `Note` a `Banner` → `Alert`; `Panel` složit u sebe |
| P06 | pět mrtvých jmen v kontraktu; `LimitReachedState` → `OverLimitState`; tvar registru navigace; volat `visibleNavigation`; nepsat vlastní `CopyButton` |
| P07 | dvě mrtvá jména v kontraktu; `ariaLabel` → `caption`; `ConfirmDialog` má `extraAction`, dialog se nemusí skládat z primitiv |
| P12 | `useAnnounce` → `useAnnouncer`; **stáhnout požadavek na `sandbox="allow-same-origin"`**; importovat na úroveň adresáře |
| P14, P15 | importovat na úroveň adresáře, ne souboru |

**Dvě věci stojí za zvláštní pozornost.**

Za prvé, **kořenový import `@mlain/ui` od teď neexistuje**. P05 odstranil klíč `"."` z `exports`,
takže osmnáct importních řádků v P11, P13 a P16 skončí chybou `ERR_PACKAGE_PATH_NOT_EXPORTED`
už při sestavení. Uzávěr S11 se tím z napsaného pravidla mění na chybu překladu, což je jediný
způsob, jak ho udržet.

Za druhé, **pět jmen se vědomě nezaložilo**: `ErrorState`, `LoadingSkeleton`, `StaleDataBanner`,
`PartialErrorBoundary` a `OfflineBanner`. Ověřeno grepem na `<Jméno` napříč všemi šestnácti
plány: **nula výskytů v JSX**. Jsou jen v typových deklaracích kontraktů P06 a P07. Zakládat
komponentu, kterou nikdo nevykresluje, znamená mít v balíčku dvě jména pro totéž.

### N31. Rozhodnutí o „Personalizaci" je zapracované na straně kontroly, chybí ve specifikaci

- **Rozhodl:** zadavatel 1. 8. 2026
- **Týká se:** **část 6, kapitola 9.2** (opravuje zadavatel), P05 (hotovo), P12 (hotovo)
- **Závažnost:** střední, ale dokud specifikace neplatí, tvrdí dva dokumenty opak

Merge tag se česky řekne **„Personalizace"**, kvůli návaznosti na slovník, který uživatelé znají
z Ecomailu, a část 3 ho v 5.4 už používá v klíči `liquid.tokenTooltip`. Slovník 9.2 části 6 měl
opačné znění: „Doplňovaný údaj" jako závazné a „personalizace" v zakázaném sloupci.

**P05 kontrolu opravil:** `BANNED_CS` nově zakazuje „doplňovaný údaj", „slučovací značka",
„merge tag" i „placeholder" a jako správný tvar nabízí „Personalizace". Slovo „personalizace"
v seznamu **není a být nesmí**, jinak by `i18n-check` shodil build na katalogu `editor`.
Přibyly dva testy, jeden na každou stranu rozhodnutí.

**Zbývá:** opravit kapitolu 9.2 části 6. Do té doby si dokumenty odporují.

Vedlejší nález ze stejného místa: P05 dřív tvrdil, že **kritérium 69 je plně pokryté**. Nebyla to
pravda, kontrola hlídá dvaadvacet výrazů z více než šedesáti. Doslovný přepis by hlásil chybu na
běžných slovech („účet", „test", „adresa", „skupina", „klik"). P05 kritérium přeřadil mezi
částečně pokrytá a napsal, co se vědomě nehlídá a proč.

### N32. Job `contracts-golden` porovnává adresář sám se sebou přes symlink

- **Našel:** oprava P02 ve fázi 3
- **Týká se:** **P01** (opravuje P01), P02 (hotovo na své straně)
- **Závažnost:** vysoká, brána vypadá funkčně a neměří nic

`tools/ci/contracts-golden.mjs` hledá Go fixtures v `apps/sender/testdata/fixtures`, jenže symlink
`testdata` míří **přímo** na `packages/contracts/fixtures`, takže ta cesta je
`packages/contracts/fixtures/fixtures` a neexistuje. Job proto hlásí u každé fixtury, že je jen
na TypeScript straně. Po opravě cesty na `apps/sender/testdata` by ale porovnával **tentýž adresář
sám se sebou**, což je vždy shoda: obě strany čtou jeden adresář, ne dvě kopie.

Porovnání jmen souborů je tedy slepá ulička. Skutečnou paritu měří `pnpm --filter @mlain/contracts
test:parity`, který porovnává **množiny id, které každá strana opravdu zpracovala**, proti fixtures
na disku, a navíc kontroluje otisk vstupů, aby neprošel report ze staršího běhu. P02 ho v tomhle
tvaru dodává.

**Zbývá v P01:** nahradit obsah jobu spuštěním `test:golden`, `test:fixtures-schema` a od vlny 1
i `test:parity` a `go test ./... -run TestGolden`. Dnes job nespouští **ani jeden** z pěti skriptů,
které P02 vyrábí.

### N33. `mlain_migrator` nemá právo zakládat rozšíření

- **Našel:** oprava P02 ve fázi 3, ověřeno spuštěním na PostgreSQL 18.4
- **Týká se:** **P01** (opravuje P01), P02 a P03 (dotčené)
- **Závažnost:** vysoká, bez toho se nezaloží ani bootstrap, ani produkční schéma

`docker/initdb/10-roles.sql` z P01 dává migrátorovi `ALTER SCHEMA public OWNER TO mlain_migrator`,
tedy právo na **schéma**. `CREATE EXTENSION` ale chce právo na **databázi**. Ověřeno spuštěním:

```
ERROR:  permission denied to create extension "citext"
HINT:  Must have CREATE privilege on current database to create this extension.
```

Po `GRANT CREATE ON DATABASE mlain TO mlain_migrator` příkaz projde. V přibaleném Postgresu a v CI
to dnes projde náhodou, protože `POSTGRES_USER` je superuser; na externím Postgresu, který má P01
v dokumentaci jako ruční krok, to spadne. Řetězec `CREATE EXTENSION` se přitom v celém P01
nevyskytuje ani jednou, takže nikdo nezakládá `citext` ani `pgcrypto`.

**Zbývá v P01:** doplnit grant do `10-roles.sql` a do dokumentace externího Postgresu.
P02 si tentýž grant doplnil ve svých testovacích pomocnících, takže jeho vlastní běh je zelený.

### N34. Job `test-go-integration` nedá integračním testům, co potřebují

- **Našel:** oprava P02 ve fázi 3
- **Týká se:** **P01** (opravuje P01), P02 a P09 (dotčené)
- **Závažnost:** střední

Job pouští `go test -tags=integration ./...` a nastavuje jedinou proměnnou `DATABASE_URL_SENDER`,
jejíž hodnota míří na uživatele `mlain_migrator`. Scénář `OB-00` z P02 potřebuje administrátorské
spojení, ze kterého si založí role a aplikuje kontraktní schéma. P02 to vyřešil tak, že test je
**samobootstrapovací** a chce jedinou proměnnou `DATABASE_URL_MIGRATOR`, kterou tři jiné joby už
nastavují.

**Zbývá v P01:** přidat `DATABASE_URL_MIGRATOR` do env jobu `test-go-integration`. Je to jeden
řádek. Bez něj `TestOB00` skončí `t.Fatal` a jediný scénář, který se podle kontraktu nesmí
přeskočit, se v CI nespustí.

### N35. Kód `liquid_literal_not_supported` chybí v registru P01

- **Našel:** oprava P02 ve fázi 3, ověřeno grepem
- **Týká se:** **P01** (opravuje P01), P02 (rozhodnutí D5), část 3 (potvrzení)
- **Závažnost:** střední

`VALIDATION_CODES` v P01 má 27 kódů s prefixem `liquid_` a tenhle mezi nimi není. Vzniká proto,
že gramatika kontraktu literály `blank` a `empty` povoluje, `osteele/liquid` je nezná, a část 3
říká, že je validátor odmítá, ale kód pro to v katalogu 3.7.4 nemá. Fixture `LQ-308` ho očekává.

Vedlejší pozorování ze stejného čtení: `liquid_escaped_entity_in_construct` není ve
`VALIDATION_CODES`, ale v `MESSAGE_CODES` jako `class: 'fatal'`. Kdo bude kódy párovat, musí
hledat v obou registrech.

### N36. Sender čtyři kontraktní operace nemá a fixtures s tím musí počítat

- **Našel:** oprava P02 ve fázi 3
- **Týká se:** P02 (hotovo), P09 (dotčené), část 1 a část 4b (na vědomí)
- **Závažnost:** střední, jinak by parita počítala jablka s hruškami

Sender tokeny jen **vyrábí** a neověřuje je (ověření dělá aplikace), nevydává **identity token**,
credentials jen **dešifruje** a validátor Liquidu nemá vůbec. Devět negativních tokenových vektorů,
jeden pozitivní a všechny validační fixtures tedy na Go straně nemají co spustit.

Dřívější znění P02 to řešilo tím, že Go runner udělal `t.Skip()`, což je neviditelné. P02 nově
zavádí ve fixtures pole `sides` s hodnotami `ts` a `go`: co která strana zpracuje, je **data pod
CODEOWNERS**, ne rozhodnutí runneru za běhu, a `check-parity` z něj počítá očekávanou množinu.
Tím se „nepoužitelné z principu" odliší od „někdo si to odpustil".

Praktický dopad na kritéria: **43** je splnitelné pro tři typy tokenů ze čtyř a **45** jen ve směru
TypeScript šifruje a Go dešifruje. Obojí je zapsané v tabulce akceptačních kritérií P02.

### N37. Fixtures kompilované šablony: tři plány, tři různé tvary a dvě různé cesty

- **Našel:** oprava P02 ve fázi 3
- **Týká se:** P02 (hotovo), **P08** (píše data), **P09** (opravuje cestu a tvar)
- **Závažnost:** střední

Rozhodnutí R3 určilo, že data píše P08 a P02 dodává schéma a runner. Při zápisu se ukázalo, že
tvar fixture si nezávisle definují tři plány: P02 čekal `document` a `context`, P09 čte `html`,
`text` a `meta`, a cesta je v P09 `testdata/compile`, kdežto v P02 a P08 `compiled`.

P02 sjednotil schéma tak, aby posloužilo oběma: `document` a `context` jsou vstup renderu P08,
nový klíč `compiled` s `html` a `text` je jeho výstup a čte ho Go strana, která blokový model
nezná a dostává hotové `compiled_html`. Platí cesta `compiled`.

**Zbývá v P09:** změnit `testdata/compile` na `testdata/compiled` a číst `compiled.html`,
`compiled.text` a `expect.clickMarkerCount` místo `html`, `text` a `meta`.

### N38. Go runnery golden fixtures existují dvakrát a v jiném tvaru

- **Našel:** oprava P02 ve fázi 3
- **Týká se:** P02 (hotovo), **P09** (vypouští své runnery)
- **Závažnost:** vysoká, jinak se balíček nepřeloží

Rozhodnutí R1 přiřklo runnery P02 a implementaci P09. P09 ale ve svém plánu zakládá v témže
adresáři `apps/sender/internal/contracts` čtyři vlastní runnery (`TestGoldenTokens`,
`TestGoldenCrypto`, `TestGoldenLiquid`, `TestGoldenCompileHandoff`) plus `writeGoldenReport`,
tedy přesně ty symboly, kvůli kterým R1 vzniklo.

P02 runnery přepsal tak, aby produkční kód dostávaly **jako hodnoty parametru**, ne importem.
Díky tomu se `internal/contracts` přeloží už ve vlně 0 a P09 k nim dodá jen tenká volání ve
svých balíčcích; ta jsou v P02 vypsaná doslova, aby si je P09 nevymýšlel.

**Zbývá v P09:** vypustit vlastní `golden_*_test.go` z `internal/contracts`, založit místo nich
tenká volání v `internal/token`, `internal/credentials`, `internal/mimebuild`, `internal/liquidx`,
`internal/markers` a `internal/outbox`, a doplnit tři chybějící kousky produkčního API:
`Builder` musí umět vrátit **plnou HMAC před zkrácením** (kontrakt ji uvádí jako závaznou),
`markers` potřebuje `PixelHTML` a `HasResidual` nad všemi čtyřmi vyhrazenými řetězci bez ohledu
na velikost písmen, a `outbox` potřebuje `CanTransition`. Navíc `ErrUnsupportedVersio` je překlep.

### N39. Formát reportu parity si každý plán psal jinak

- **Našel:** oprava P02 ve fázi 3
- **Týká se:** P02 (hotovo), **P09** (přebírá formát)
- **Závažnost:** střední

P09 zapisuje `{"lang","category","count"}` do adresáře z proměnné `MLAIN_GOLDEN_REPORT_DIR`,
a když proměnná není nastavená, **report se tiše nezapíše a test projde**. P02 čekal jiný tvar
v `packages/contracts/reports/`.

Podle R1 platí formát, který čte `check-parity.ts` z P02: `{ language, section, total, executed,
skipped, ids, groups, fixturesDigest }`, jeden soubor na sekci, cesta odvozená od zdrojového
souboru, ne z prostředí. Pole `ids` a `fixturesDigest` jsou nová a jsou důvodem, proč to nejde
jen přejmenovat: bez `ids` se nepozná, **které** fixture se zpracovaly, a bez otisku projde
zelená parita nad reportem ze staršího běhu, protože adresář `reports/` se nikde nemaže.

### N40. Chybové kódy tokenů se z Go chyb nedají přečíst

- **Našel:** oprava P02 ve fázi 3
- **Týká se:** P09 (na vědomí)
- **Závažnost:** nízká

`internal/token` v P09 vrací obyčejné `fmt.Errorf` bez kontraktního kódu, kdežto
`internal/credentials` má pro každý kód sentinel. Runner P02 to obchází tím, že překlad chyby na
kód dodává adaptér, takže se nic neblokuje. Za zvážení ale stojí, jestli má sender u tokenů
kódy vůbec potřebovat: tokeny jen vyrábí a chyba při stavbě znamená vadný vstup, ne odmítnutí.

### N45. Job `test-go-integration` posílá testy senderu pod migrátorem

- **Našel:** oprava P09 ve fázi 3, ověřeno čtením workflow v P01 a spuštěním pod oběma rolemi
- **Týká se:** **P01** (opravuje P01), P09 (srovnal se u sebe)
- **Závažnost:** vysoká, brána vypadá funkčně a negarantuje nic

Rozšiřuje N34. Job nastavuje jedinou proměnnou `DATABASE_URL_SENDER` a její hodnota je
`postgres://mlain_migrator:...`, tedy **migrátor pod jménem senderu**. Není to jen chybějící
proměnná, je to horší stav než žádná: `mlain_migrator` je vlastník schématu a RLS obchází, takže
by testy práv i politik `sender_bypass` byly **zelené, přestože by neověřovaly nic**. Přesně
tenhle druh selhání má přitom AK-20.5 vylučovat.

P09 si to u sebe zavřel: harness je nově samobootstrapovací, chce jedinou proměnnou
`DATABASE_URL_MIGRATOR`, roli `mlain_sender` **si založí sám**, připojení senderu si z ní
**odvodí** místo čtení z prostředí, a `TestScenariosRunAsSenderRole` ověří, že `current_user`
je `mlain_sender` a že role nemá `BYPASSRLS`. Prostředí tedy nemá jak testy poslat pod jinou rolí.

**Zbývá v P01:** v jobu `test-go-integration` nahradit `DATABASE_URL_SENDER` proměnnou
`DATABASE_URL_MIGRATOR`. Uživatel v `services.postgres` už `mlain_migrator` je, takže je to
změna jednoho řádku.

### N46. P01 přidává do `go.mod` senderu závislost, kterou P09 vědomě nepoužívá

- **Našel:** oprava P09 ve fázi 3
- **Týká se:** **P01**, P09 (ošetřeno)
- **Závažnost:** nízká

Úkol 15 v P01 pouští `go get github.com/caarlos0/env/v11 github.com/jackc/pgx/v5`. P09 ale
konfiguraci parsuje vlastním kódem (kapitola 1.6), protože `caarlos0/env` umí opačnou sémantiku
sufixu `_FILE`, než jakou předepisuje kontrakt 4.9, a neumí vypsat všechny problémy naráz.
Závislost by tedy zůstala v `go.mod` a v `go.sum` a licenční brána by kontrolovala strom, který
se do binárky nedostane.

P09 to řeší `go mod tidy` hned v úkolu 1. Za zvážení stojí, jestli ji má P01 vůbec přidávat.

### N47. Ukázkový adaptér pro P09 v P02 nepoužívá parametr `presence`

- **Našel:** oprava P09 ve fázi 3, ověřeno spuštěním proti `osteele/liquid` v1.8.1
- **Týká se:** **P02** (opravuje P02), P09 (srovnal se)
- **Závažnost:** střední, jinak by adaptér zmrazil tichou vadu

Runner `LiquidRunner.Render` má správnou signaturu včetně `presence []string`, ale **ukázkový
adaptér, který P02 vypisuje pro P09, ten parametr ignoruje**: volá
`liquidx.WithBlankBindings(data, prepared.BlankPaths)` a kořen `_present` nikde nenaplní.
Fixtures ho přitom potřebují, například `LQ-307` má `presence: ["contact.city","contact.zip"]`
a očekává výstup `A`.

Kdyby si P09 ten úryvek opsal doslova, `_present` by v datech nebyl, obě podmínky by se
vyhodnotily jako nepravda a fixture by spadla na prázdném výstupu. V provozu by se totéž
projevilo tím, že z mailu tiše zmizí podmíněné bloky.

P09 to má u sebe správně: adaptér volá `liquidx.PrepareRenderData(rawData,
liquidx.RenderSchema{Presence: presence})`, což je Go protějšek sdílené funkce
`prepareRenderData`, a jeho pravdivost je ověřená proti týmž případům, které má P02 v testu
(`"   "` není present, chybějící klíč není present, prázdné pole není present, prázdný objekt
**je** present).

**Zbývá v P02:** srovnat ukázkový úryvek s runnerem, ať si ho P09 může opsat doslova.
Zároveň je v něm `liquidx.New(liquidx.Options{})`, takže by se ztratila časová zóna
z `_context.timezone` a filtr `date` by u fixtur s jinou zónou vracel jiný čas.

### N48. Zápis času pozastavení kampaně senderem nemá kam jít

- **Našel:** revize P09 (D4), potvrzeno proti aktuálnímu P03
- **Týká se:** **P03** (granty), **P13** (čtení v UI), P09 (dotčené)
- **Závažnost:** střední

`campaigns` má `paused_at` i `updated_at`, ale sloupcový grant senderu je přesně
`GRANT UPDATE (status, pause_reason)`. Sender tedy po pozastavení nechá `paused_at` prázdné
a `updated_at` zastaralé. `paused_at` je přitom jediný indexovatelný čas pauzy, takže „kdy se to
zastavilo" jde zjistit jen parsováním `pause_reason ->> 'at'`, a každá cache nebo optimistický
zámek nad `updated_at` pauzu od senderu přehlédne.

Rozhodnout musí P03 s P13, protože jde o grant a o to, odkud UI čas čte. Buď rozšířit grant na
`GRANT UPDATE (status, pause_reason, paused_at, updated_at)` a doplnit oba sloupce do
`StmtPauseCampaign`, nebo do obou plánů výslovně napsat, že po pauze od senderu je `paused_at`
NULL a čas se čte z jsonb. P09 dnes dělá druhou variantu, protože první by znamenala psát do
sloupců, na které nemá právo.
### N-P03X. Nálezy z doplňkového průchodu schématem P03 (2026-08-01)

- **Našel:** doplňkový průchod P03 podle páté recenze (`docs/replan/p03-revize-soulad-napric-plany.md`)
- **Stav:** schéma na straně P03 doplněné a ověřené spuštěním; níže je to, co P03 udělat **nesmí**, protože to patří jiným plánům
- **Závažnost:** vysoká u prvních dvou, střední u zbytku

Souhrnná tabulka recenze má 31 řádků. P03 provedl svých sedmnáct plus tři sdílené a čtyři
rozhodnutí. Zbylých sedm patří doménovým plánům a P03 se jich záměrně nedotkl.

**Pro P10 (tracking).**

1. **`message_events.source` doplnit do zápisu.** Sloupec zůstává `NOT NULL` **bez `DEFAULT`**
   a je to úmysl: hodnota se liší podle zapisovatele (`delivered` může přijít z `ses_sns`,
   ze `smtp` i `internal`) a výchozí hodnota by mlčky označila událost od providera za vlastní.
   P10 doplní do `insertMessageEvents` konstantu `'tracking'`, kterou `CHECK` už povoluje.
   Bez toho skončí každé otevření i proklik chybou `23502`.
2. **`rank` ze zápisu naopak ODEBRAT.** Je to nově generovaný sloupec (rozhodnutí R32 v P03).
   Explicitní hodnota skončí chybou „cannot insert a non-DEFAULT value into column rank",
   ověřeno spuštěním. `recipient` P10 posílat nemusí: je nově nepovinný (R33) a podmíněný
   `CHECK` ho vyžaduje jen u doručovací rodiny, do které otevření ani proklik nepatří.
3. **Idempotence zápisu nefunguje.** `ON CONFLICT (id, received_at) DO NOTHING` nesepne
   **nikdy**, protože `received_at` není ve vkládaných sloupcích a doplní se `now()`, tedy
   pokaždé jiné. Opakovaný běh jobu vloží tytéž události znovu. Je to táž past, kterou P03
   popsal a vyřešil u `provider_event_receipts`: deduplikace patří do explicitního
   `WHERE NOT EXISTS` nad `(workspace_id, id)`.

**Pro P13 (kampaně).**

4. **`rankOf('opened')` opravit na `'open'`.** `ck_message_events__type` hodnotu `opened`
   nedovolí. Po R32 navíc katalog přestává být zdrojem hodnoty `rank`: škálu vlastní P03
   a P13 ji nemá zapisovat, jen číst.
5. **`countAudienceGates` přesunout mimo `packages/db`.** Požadavek R-P07.1 umisťuje cizí
   funkci do `packages/db/src/repo/segments.ts`, tedy do balíčku, který výhradně vlastní P03
   a jehož obsah kapitola 7 vyjmenovává. Patří do `packages/core/segments`.

**Pro P09 (sender).**

6. **Testovací replika schématu se rozchází na sedmi místech.** Nejzávažnější je partiční klíč:
   replika má `PARTITION BY RANGE (ts)` a PK `(id, ts)`, produkce `received_at`. `ts` je hodnota
   od providera, takže zpožděný bounce s časovou značkou mimo okno v produkci **tvrdě selže**,
   zatímco v testech projde. Dál se liší `source` (`DEFAULT 'sender'` bez `CHECK`),
   `messages.contact_id` (nullable místo `NOT NULL`), `quota_max_send_rate`
   (`double precision` místo `numeric(10,2)`), `suppressions.email` a `reason` (nullable),
   chybějící sloupce `message_events` a dvě omezení `messages`.
   **Nově přibývá osmý rozdíl:** `rank` je v produkci generovaný a `recipient` nepovinný,
   takže replika musí obojí převzít, jinak testy senderu projdou u zápisu, který v produkci
   spadne, a naopak.
7. **Job `contracts-schema` repliku nevynucuje** (společně s P01). Porovnává jen kontraktní
   podmnožinu sloupců `messages` ze 4.10.1, takže rozchod v `message_events`, `suppressions`
   ani v typech nezachytí. Buď se replika generuje ze skutečných migrací, nebo job musí
   porovnávat všechno, co replika obsahuje. Dokud ani jedno neplatí, je pravidlo
   „při rozporu platí P03" věta, kterou nic nevynucuje.

**Pro P11 (import a segmenty).**

8. **Jména sloupců `contact_engagement` srovnat podle P03.** Požadavek 10.1 mluví o
   `sent_count`, `delivered_count`, `opened_count`, `clicked_count`, `bounced_count`,
   ale schéma má `sent_total`, `delivered_total`, `opens_total`, `clicks_total`,
   `bounces_total`. Schéma se nemění: P10, který do rollupu skutečně zapisuje, už používá
   jména z P03, takže se odchyluje jen text požadavku v P11.

**Pro P04 (jádro).**

9. **Adaptér `packages/core/tx` nesmí transakční logiku opakovat.** P03 nově exportuje
   `Tx = NodePgDatabase<typeof schema>` a čtyři obálky (`withWorkspace`, `withUser`,
   `withReadOnly`, `withoutContext`) plus `pgErrorCode`. Adaptér má jen doplnit pool ze
   singletonu a delegovat sem, ne psát vlastní `BEGIN`/`COMMIT`: kontrola nezměněného
   kontextu a zahození rozbitého spojení přes `release(true)` musí existovat jednou.
   `Tx` v P04 má být **reexport** z `@mlain/db`, ne druhá definice téhož jména.
10. **`withReadOnly` má nově čtvrtý tvar argumentů:** `(pool, ctx, { statementTimeoutMs,
    workMem }, fn)` místo číselného timeoutu, kvůli požadavku P11 na `work_mem`.

**Co P03 naopak rozhodl a nikdo to nemá měnit.**

- **Trigger `trg_campaigns__immutable_while_sending` se NEZAVÁDÍ** (požadavek P13 R-P03.3).
  Konvence zákazu triggerů platí, protože sender `campaigns` mění a trigger by nečekaně sáhl
  do jeho transakce; Go strana o něm neví. Neměnnost kampaně za běhu vynucuje sloupcový grant
  plus `WITH CHECK (status = 'paused')` v politice `sender_bypass`. Test „žádná tabulka nemá
  trigger" zůstává v platnosti.
- **`campaign_render_warnings` zůstává** a sender je její zapisovatel. Politika `sender_bypass`
  i `GRANT SELECT` (nutný kvůli `ON CONFLICT DO UPDATE`) v P03 už jsou. **P09 tu funkci dnes
  neimplementuje**, takže je to otevřený požadavek na P09, ne důvod tabulku rušit.
- **`circuit_breaker_open` v `CHECK` zůstává.** `CHECK` říká „je povolená", ne „zapisuje se".
  Zapisovatele nemá; je to zamýšlené použití senderského `INSERT` do `message_events`.
- **Senderský `INSERT` na `message_events` se nezužuje**, protože je kontraktní (4.10.1)
  a `circuit_breaker_open` je jeho zamýšlené použití. Sender z tabulky číst nesmí a test to hlídá.
- **`schema` se z kořene `@mlain/db` NEREEXPORTUJE** (R37). Jde výhradně podcestou
  `@mlain/db/schema`. Druhá rovnocenná cesta by zrušila smysl „jednoho zjevného způsobu";
  hlídá to test kořenového exportu.


### N49. `RAW_SLOT_PATTERN` v kontraktech nesedí na žádný skutečný žeton

- **Našel:** oprava P08 ve vlně B, ověřeno spuštěním
- **Týká se:** P02 (vlastní `packages/contracts/src/markers.ts`)
- **Závažnost:** střední, ochrana existuje a nikdy se nespustí

P02 má `RAW_SLOT_PATTERN = /ML_RAW_(\d{4})/gi`, tedy `ML_RAW_` plus **čtyři číslice**.
P08 ale emituje `ML_RAW_<nonce>_0001`, kde nonce je deset hexadecimálních znaků,
protože bez náhodného nonce by si uživatelský text mohl odklonit cizí slot.

Ověřeno spuštěním: `/ML_RAW_(\d{4})/gi` proti `ML_RAW_ab12cd34ef_0001` **nemá ani jednu shodu**.
Sesterský `FILTER_SLOT_PATTERN = /ML_ARG_(\d{4})/gi` naopak sedí přesně, protože slot argumentu
filtru nonce nemá (`ML_ARG_0007`).

Nic to dnes nerozbíjí: zbytkové žetony se hledají přes `RESERVED_MARKERS`, kde je `ML_RAW_`
jako podřetězec a porovnává se bez ohledu na velikost písmen, takže detekce funguje.
`RAW_SLOT_PATTERN` je ale ochrana, která vypadá funkčně a **nenajde nikdy nic**.
Buď ji upravit na `/ML_RAW_[0-9a-f]{10}_(\d{4})/gi`, nebo ji zrušit.

### N50. Dvě neslučitelné věci pod jménem `RenderSchema`

- **Našel:** oprava P08 ve vlně B
- **Týká se:** P02 (`packages/contracts/src/liquid/prepare-render-data.ts`), P08 (obchází), P09, P13
- **Závažnost:** střední

Je to přesně tentýž tvar problému, který u `FieldCatalog` uzavřelo rozhodnutí R2.

`prepare-render-data.ts` exportuje `RenderSchema = { fields: readonly string[]; presence: readonly string[] }`.
Kontrakt 5, který vlastní P08, používá pod týmž jménem bohatý tvar
`{ version, fields: Array<{path,type,required}>, systemTags, presence, loops }`, a právě ten jde
do `compile_meta` a k Go senderu.

P08 to obchází funkcí `toPreparedSchema()` ve vlastním balíčku, takže **blokovaný není nikdo**.
Zůstává ale past: první, kdo si ta dvě jména splete, dostane buď chybu typu, nebo to protlačí
přetypováním a ztratí kontrolu úplně. Doporučení: přejmenovat úzký typ na `PreparedDataSchema`.
Zapsáno i jako požadavek R13 v P08.

### N51. Katalog polí mapuje typy, takže hodnota `string` je správně

- **Našel:** oprava P08 ve vlně B
- **Týká se:** nikoho, **uzavírá nález D5 z recenze P08**
- **Závažnost:** žádná, evidence proti opakovanému nálezu

Recenze P08 vytkla, že renderer vydává typ pole `"string"`, který slovník `contact_fields.type`
nezná (ten má `text`, `long_text`, `url`, `email`, `phone`, `enum`, `multi_enum`, …).

Není to vada. Katalog polí vlastní **P07** (rozhodnutí R2) a ten typy **mapuje**:
`TYPE_MAP` v `packages/core/contacts/fields/catalog.ts` převádí pět databázových typů na
`string` a `multi_enum` na `list`. `FieldCatalogType` je proto
`'string' | 'number' | 'boolean' | 'date' | 'datetime' | 'list'` a `"string"` je platná hodnota.

Kdo bude nález D5 „opravovat" změnou na `"text"`, rozbije jak P08, tak P07.

### N52. `content_snippets` nemá vlastníka

- **Našel:** recenze P08, potvrzeno při opravě
- **Týká se:** P12 (editor) nebo P03, rozhodnout
- **Závažnost:** střední, sdílené bloky dnes neimplementuje nikdo

P03 zrušil druh šablony `snippet` s odůvodněním „sdílené bloky mají jedno místo, `content_snippets`".
Tabulka existuje (`id`, `workspace_id`, `name`, `design jsonb`, `created_at`, `updated_at`),
ale **žádný plán do ní nečte ani nezapisuje**. P08 ji dřív uváděl mezi tabulkami, „které jen čte",
což nebyla pravda; při opravě se to z P08 vyškrtlo.

Navíc jí chybí `schema_version`. Její `design` je pole bloků z modelu, který P08 verzuje přes
`MIGRATIONS` a `loadDocument`, takže bez toho sloupce nejde u snippetu poznat, které migrace
pustit, a **první změna blokového modelu snippety tiše rozbije**. `templates` i `template_versions`
ten sloupec mají.

Rozhodnout vlastníka (nejspíš P12, protože sdílené bloky zakládá editor) a požádat P03
o `content_snippets.schema_version integer NOT NULL DEFAULT 1`.

### N53. `templates.design_hash` nemá kontrolu délky v databázi

- **Našel:** recenze P08, částečně ošetřeno v P08
- **Týká se:** P03
- **Závažnost:** nízká

`assets.sha256` má `check('ck_assets__sha256_len', octet_length(sha256) = 32)`.
`templates.design_hash` ani `template_versions.design_hash` obdobný CHECK nemají, přestože se
nad nimi porovnávají buffery přicházející z hlavičky requestu.

**P08 si to ošetřil u sebe**: délku hexu hlídá router (422 místo 412) a délku bufferu repository
(`precondition_malformed`), obojí má test. Poslední pojistka v databázi ale chybí, takže hash
o špatné délce se pořád dá zapsat jinou cestou. Doporučení: doplnit `octet_length(...) = 32`
na oba sloupce.

### N54. Komentář u `campaign_links.url` slibuje Liquid, který tam nikdy nebude

- **Našel:** recenze P08, potvrzeno při opravě
- **Týká se:** P03 (jen komentář), P13 (čte ho)
- **Závažnost:** nízká

P03 u sloupce píše „původní URL, může obsahovat Liquid". P08 v `CompiledLink.url` garantuje opak:
absolutní statickou URL bez Liquidu. Do `links[]` se dostanou jen odkazy, které projdou
`isTrackableTarget`, tedy žádné systémové značky, žádné `mailto:`, `tel:` ani `#`, a odkaz
s proměnnou v `href` se buď odmítne kódem `liquid_in_trackable_href`, nebo projde jako
netrackovatelný a do seznamu se nedostane vůbec.

Sjednotit komentář v P03, jinak si P13 přečte, že v tom sloupci má Liquid čekat, a bude ho ošetřovat.

---

### ~~N41 (druhý výskyt)~~. `rank` a `recipient`: UZAVŘENO, byl to souběh

> **POZOR, tenhle nález je neplatný a je uzavřený.** Vznikl tím, že oprava P10 a doplňkový
> průchod schématem běžely **souběžně**, takže P10 četl P03 ještě před doplněním a v dobré víře
> zapsal, že chybí.
>
> **Ověřeno v aktuálním P03 hlavním agentem 2026-08-01:** obojí je doplněné.
> `rank smallint NOT NULL GENERATED ALWAYS AS (CASE type ...)` je na třech místech včetně testu,
> který vynucuje, že sloupec **musí** být generovaný, aby ho volající nemohl uvést špatně.
> `recipient` je uvolněný na nepovinný s podmíněným omezením, rozhodnutí R33.
>
> **Práce P10 zůstává správná**, protože psal svou stranu podle rozhodnutí, ne podle toho,
> co v P03 zrovna viděl. Zápis události ty dva sloupce nevyjmenovává, což je přesně to,
> co má generovaný a podmíněný sloupec vyžadovat.
>
> Číslo `N41` je obsazené dvakrát, viz nález o přípravě dat pro render výš. Poučení pro další
> vlny: **při souběžných opravách se stav dodavatele musí ověřit až v okamžiku zápisu nálezu,
> ne na začátku práce.**

Původní znění pro doložení:

- **Našel:** oprava P10 ve fázi 3
- **Týká se:** **P03** (schéma), P10 (píše svou stranu proti rozhodnutí)
- **Závažnost:** nejvyšší, bez toho neprojde jediné otevření ani proklik

Rozhodnutí z revize schématu znělo: `rank` se změní na **generovaný sloupec** odvozený z `type`
(je to čistá funkce typu, každý zapisovatel by si škálu napsal jinak) a `recipient` se **uvolní
na nepovinný** s podmíněným omezením jen pro doručovací události (u otevření a prokliků je to
zbytečná kopie osobního údaje na každém řádku desetimilionové tabulky, kterou pak musí výmaz
podle GDPR procházet).

Opravený P03 ani jedno neudělal. Ověřeno grepem v jeho aktuální podobě:

```sql
recipient          text        NOT NULL,     -- řádek 4546, bez DEFAULT
rank               smallint    NOT NULL,     -- řádek 4550, bez DEFAULT, není generovaný
```

Důvod je znám a je organizační: pátá recenze schématu se do jeho opravy nedostala. Doplňkový
průchod schématem běží.

**P10 je napsaný proti rozhodnutí**, tedy zápisy události ani jeden z těch dvou sloupců
nevyjmenovávají. Dokud se schéma nesrovná, skončí každé otevření chybou `23502`. Ověřeno
spuštěním proti PostgreSQL 18.4: s `rank` jako generovaným sloupcem a `recipient` nepovinným
zápis projde, `rank` se dopočítá (u `type = 'open'` na 50) a `recipient` zůstane prázdný.

Třetí sloupec, `source`, **je opravený na straně P10** doplněním konstanty `'tracking'`. Povinnost
bez výchozí hodnoty je u něj správně: hodnota se skutečně liší podle zapisovatele a výchozí
hodnota by mlčky označila událost od providera za vlastní.

### N42. Pět zásahů do schématu, bez kterých je tracking částečně tichý

- **Našel:** oprava P10 ve fázi 3
- **Týká se:** **P03**, u jednoho bodu i P13
- **Závažnost:** vysoká, čtyři z pěti se projeví jako tichý nulový výsledek

Všech pět je zapsaných jako požadavek v sekci 2 plánu P10, takže se na ně nezapomene, ale opravit
je musí P03.

1. **`GRANT UPDATE (properties, context) ON web_events`.** Dnešní sloupcový grant má jen
   `contact_id, identity_merge_id, erased_at`. Hook `tracking.erase_contact` je přitom jediná cesta,
   jak z uložených událostí odstranit PII a IP adresu. Dnes skončí na `42501` a protože běží
   v jedné transakci, **výmaz podle čl. 17 neproběhne vůbec**. Plný `GRANT UPDATE` je zakázaný:
   kontrolní test P10 ověřuje, že `UPDATE web_events SET name` na oprávnění padá.
2. **`message_events.processed_at timestamptz NULL` plus rozšíření grantu** na
   `GRANT UPDATE (contact_id, erased_at, recipient, processed_at)`. Samotný sloupec je už
   v evidenci; bez grantu ho aplikace stejně nepřepíše a job by při každém běhu zpracoval tytéž
   události znovu, takže `campaign_stats.delivered` by rostlo donekonečna.
3. **Šest indexů pro retenci a výmaz.** Nejcitelnější je poslední: `idx_message_engagement__contact`
   je částečný `WHERE first_open_at IS NOT NULL`, takže výmaz kontaktu, který nikdy nic neotevřel,
   tedy většiny databáze, projde sekvenčně všech 37 měsíčních oddílů. Úplný seznam je v sekci 2 P10.
4. **Mechanismus systémového přístupu napříč projekty.** P03 má dnes `sender_bypass` pro
   `mlain_sender` a `maintenance_bypass` na `web_events` pro `mlain_maintenance`, obecný mechanismus
   pro systémové joby ale ne. Bez něj **nejde dohledat veřejný klíč** (workspace se dozvídáme
   teprve z řádku `api_keys`, takže ho nemáme čím nastavit předem) a retenční, přepočtové
   i rekonstrukční joby zpracují **nula řádků, aniž by vrátily chybu**. P10 má všechny takové
   dotazy soustředěné za jedinou funkcí `withCrossWorkspaceTx` a hlídá je test, takže po dodání
   mechanismu stačí projít jeden krátký seznam.
5. **`campaign_stats.materialized` a `.skipped` nemá kdo zapsat.** Z událostí je dopočítat nejde,
   vznikají při materializaci publika. Patří **P09**, nebo mají ze schématu zmizet. P10 si je
   nedopočítává, protože dopočet z událostí by dal jiná čísla než skutečnost.

`GRANT DELETE ON web_events` pro `mlain_maintenance` byl v recenzi taky, ale **opravený P03 už ho
má**, včetně `SELECT` a politiky `maintenance_bypass`. Není to tedy otevřený nález.

### N43. Akceptační kritérium 60 části 5 nejde splnit doslova

- **Našel:** oprava P10 ve fázi 3
- **Týká se:** **specifikace části 5** (3196), P10 (má opravený test)
- **Závažnost:** střední, jinak by na tom úkolu padala správná implementace

Kritérium 60 předepisuje test „dekódovaný payload `ml_token` neobsahuje `@`". Payload je
60 bajtů binárních UUID, osmibajtového nonce z CSPRNG a uint32. Bajt `0x40` je ASCII `@`
a v UUID verze 7 je zcela běžný, například v `...-7e40-...`.

Ověřeno spuštěním na 100 000 vydaných tokenech s vektory z plánu: bajt `0x40` obsahovalo
**100 000 ze 100 000**. Kritérium tedy není náhodně křehké, je nesplnitelné vždy.

Věcný záměr kritéria je v pořádku a P10 ho plní: test ověřuje, že se v payloadu neobjeví žádný
ze vstupů v textové podobě (s pomlčkami i bez nich), že má přesně 60 bajtů a že změna bitu
v `contact_id` vede na `token_signature_invalid`. Znění kritéria ve specifikaci je potřeba
srovnat, jinak si ho někdo přepíše zpátky.

---

### N55. Dohodnutá konfigurace testů `apps/web` nestačí, a P01 zatím nezměnil ani to původní

- **Našla:** oprava P06 ve fázi 3, **ověřeno spuštěním** na Vitest 4.1.10, ne přečtením
- **Týká se:** **P01** (vlastník souboru), P05, P06, P12
- **Závažnost:** nejvyšší, protože selhání je tiché. Doplňuje nález N28, který tím není vyřešený.

Dvě zjištění, obě z běhu, ne ze čtení.

**Za prvé, P01 opravu zatím neprovedl.** V opraveném P01 (řádek 5783) stojí dál
`{ environment: 'node', include: ['test/**/*.test.ts'] }`. Požadavek P05→P01.5 z jeho kapitoly 8.2
tedy zůstává nesplněný a P06 ani P12 na něj nemají jak čekat jinak než vlastní kontrolou.

Měřeno na projektu s jedním procházejícím testem v `test/` a jedním **záměrně padajícím** v `src/`:

```
 ✓ test/ok.test.ts (1 test) 1ms
 Test Files  1 passed (1)
      Tests  1 passed (1)
EXIT=0
```

Kompletní série skončí zeleně a s kódem 0, přestože padající test nikdo nespustil.
Jednotlivý běh na soubor mimo vzor skončí kódem 1 a hláškou `No test files found`,
což je červené, ale hlásí to něco jiného, než se stalo.

**Za druhé, tvar konfigurace zapsaný v N28 nestačí.** Se samotným `plugins: [react()]`,
`environment: 'jsdom'` a rozšířeným `include` běh dopadne takhle:

```
TestingLibraryElementError: Found multiple elements with the role "button"
 Test Files  1 failed | 1 passed (2)
```

Automatický úklid `@testing-library/react` se registruje jen tehdy, když existuje globální
`afterEach`, tedy při `globals: true`. Bez něj zůstane strom z předchozího testu v dokumentu.
**Postihlo by to všech 27 testů komponent P06 a všechny testy P12**, a vypadalo by to jako
chyba testu, ne konfigurace. Obsah `vitest.setup.ts` přitom v požadavku nikdo nenapsal, takže
soubor mohl vzniknout prázdný a chyba by přišla i tak.

**Doplněné znění požadavku na P01.** Ověřeno spuštěním na Vitest 4.1.10, `@vitejs/plugin-react`
6.0.5, `jsdom` 30.0.1 a `@testing-library/react` 16.3.2:

```ts
// apps/web/vitest.setup.ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
```

**Co udělal P06 u sebe, aby na tom nebyl závislý poslepu:** kontrola
`apps/web/test/p06/test-runner.test.ts` leží uvnitř **starého** vzoru, takže se spustí i tehdy,
když se nespustí nic jiného. Porovná seznam testovacích souborů pod `src/` proti `include`
z živé konfigurace, ověří `jsdom`, přítomnost pluginu a to, že `setupFiles` registruje úklid.
Plán se na ní zastaví dřív, než napíše první komponentu. **P12 si totéž může převzít.**

**UZAVŘENO 2026-08-01 opravou P01.** Obojí je zapracované v úkolu 13:

- `apps/web/vitest.config.ts` má `plugins: [react()]`, `environment: 'jsdom'`,
  `setupFiles: ['./vitest.setup.ts']` a `include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}']`.
- `apps/web/vitest.setup.ts` vzniká s obsahem, ne prázdný: importuje matchery jest-dom
  a registruje `afterEach(cleanup)`. Explicitní `afterEach` je zvolený místo `globals: true`,
  aby se testy nepsaly proti implicitním globálům.
- Čtyři závislosti (`@vitejs/plugin-react` 6.0.5, `jsdom` 30.0.1, `@testing-library/react`,
  `@testing-library/jest-dom`) zavádí manifest `apps/web`, který vlastní P01.
- Vlastní strážní test P01 (`konfigurace testů apps/web` v `apps/web/test/health-routes.test.ts`)
  leží uvnitř starého vzoru ze stejného důvodu jako kontrola P06, a čte **živou** konfiguraci:
  ověří `src/` ve vzoru, `.tsx` ve vzoru, `jsdom`, přítomnost pluginu, neprázdné `setupFiles`
  a to, že setup soubor obsahuje `cleanup` i `afterEach`. Kontrola P06 tím není nadbytečná,
  obě měří něco jiného a obě se spustí.

Doloženo spuštěním na Vitest 4.1.10 se záměrně padajícím testem v `src/`: s původní
konfigurací série skončila `Test Files 1 passed (1)` a **kódem 0**, s opravenou skončila
`FAIL src/...` a **kódem 1**. Prázdný setup soubor reprodukoval
`Found multiple elements with the role "button"`, s doplněným obsahem testy komponent prošly.

**Stejná past byla i jinde a opravila se zároveň:** `packages/core`, `apps/worker`, `apps/cli`
i sdílené presety `@mlain/config/vitest/{node,db}` měly vzor jen `test/**`, přestože do
`packages/core/src/<domena>/**` píše patnáct dalších plánů. Všechny nově berou i `src/**`.

### N56. Kontrola slovníku v P05 hledá zakázané výrazy i ve jménech slotů

- **Našla:** oprava P06 ve fázi 3, ověřeno spuštěním nad skutečnými katalogy
- **Týká se:** **P05** (`packages/i18n/src/checks/glossary.ts`)
- **Závažnost:** střední, ale je to past pro každý plán s obrazovkou

`findViolations` porovnává zakázaný výraz proti **celé zprávě**, tedy i proti jménům ICU slotů.
Zpráva `"Pozvánka do projektu {workspace}"` je česky správně a slovník 9.2 neporušuje, protože
slovo „workspace" se uživateli nikdy nezobrazí. Kontrola ji přesto označí a `ci:i18n-check` spadne.
V katalozích P06 to byly čtyři zprávy.

**Oprava na straně P06 je hotová:** slot se jmenuje `projectName`. Je to ale léčba příznaku.
Kterýkoli další plán, který pojmenuje slot `{workspace}`, `{sandbox}` nebo `{placeholder}`,
narazí znovu, a spadne mu build na správně napsaném textu.

**Oprava na straně P05:** před porovnáním odstranit obsah složených závorek, tedy hledat
v `value.replace(/\{[^}]*\}/g, ' ')`. Texty uvnitř větví `plural` se tím sice přeskočí taky,
což je vedlejší ztráta, ale menší než falešně padající brána. Přesnější řešení je číst ICU strom
a kontrolovat jen literály.

### N57. Položka „Projekt" v registru navigace chce oprávnění, které prohlížející nemá

- **Našla:** oprava P06 ve fázi 3, ověřeno proti skutečnému znění registru
- **Týká se:** **P05** (`packages/ui/src/patterns/navigation/registry.ts`)
- **Závažnost:** střední, dělá z jednoho povinného stavu mrtvý kód

Položka `settings-general` má v registru `permission: 'workspace:update'`. Obrazovku Projekt
ale podle kritéria 23 kapitoly 15.3 části 6 **vidí každý člen**, jen bez zápisu se vykreslí
jako stav S12 „jen pro čtení", tedy hodnoty jako text místo zašedlých polí. P06 tenhle stav
implementuje a testuje (úkol 22).

S dnešním registrem se k němu prohlížející z menu nedostane, protože položku vůbec neuvidí,
a jedinou cestou zůstane ručně napsaná URL. Stav S12 tím prakticky přestane existovat.

**Návrh:** `permission: 'workspace:read'` u `settings-general`. Zápis pak dál řídí obrazovka
podle `workspace:update`, což už dělá.

**P06 se mezitím řídí registrem, jak je**, a testy sub-navigace to popisují pravdivě:
prohlížejícímu zbude v sekci Nastavení jen „Můj účet".

### N58. `JobSummary` nemá `kind`, přestože detail úlohy je adresovaný druhem

- **Našla:** oprava P06 ve fázi 3
- **Týká se:** **P05** (`packages/ui/src/patterns/jobs/types.ts`)
- **Závažnost:** nízká, ale bez ní nejde složit odkaz

Endpoint detailu je `GET /api/v1/jobs/{kind}/{id}` a `kind` v cestě stojí schválně: ID pocházejí
z různých doménových tabulek a napříč nimi nejsou zaručeně jedinečná (P04, úkol 45). Typ
`JobSummary` v P05 nese `id` a hotový `href`, ale `kind` ne, takže ho ten, kdo `href` staví,
nemá odkud vzít. Odpověď endpointu `kind` obsahuje, chybí jen v typu komponenty.

**Stránka detailu je hotová v P06** (úkol 34) na cestě `/w/{slug}/jobs/{kind}/{jobId}`; tím se
uzavírá nález N30. Zbývá doplnit `kind` do `JobSummary` a v P05 i P04 opravit text, který cestu
uvádí jako `/w/{slug}/jobs/{jobId}`.

<!-- Nálezy z opravy P07 (fáze 3). Číslovány prefixem plánu, protože číselná řada Nxx
     se v tomhle souboru mezi vlnami opakuje a kolidovala by. -->

### P07-1. Layout `packages/core`: rozhodnuto, a hluboká podcesta navíc nefunguje (uzavírá N42 z vlny B)

- **Našla:** oprava P07 ve fázi 3, na podnět koordinátora. **Uzavírá otázku z N42 vlny B.**
- **Týká se:** **P04** (367 výskytů), **P10** (413), P08 a P11 (smíšeně), P07 (opraveno)
- **Závažnost:** nejvyšší, protože to není styl, ale chyba překladu

**Rozhodnuto: platí `packages/core/src/<domena>/`, tedy tvar P13.** P07 se opravil.

Manifest `packages/core/package.json` vlastní P01 a jeho mapa `exports` zní:

```json
"./*/jobs": "./src/*/jobs/queue-handlers.ts",
"./*": "./src/*/index.ts"
```

`packages/core/tsconfig.json` má `include: ["src/**/*.ts", "test/**/*.ts"]`. Soubor mimo `src/`
se tedy **ani nezkompiluje**, natož aby se dal naimportovat.

P13 to má správně (`packages/core/src/campaigns/`), P07 se opravil. **P04 zakládá
`packages/core/tx/index.ts`, `packages/core/errors/api-error.ts`, `packages/core/identity/**`
a dalších 367 cest bez `src/`; P10 má 413.** Import `@mlain/core/tx` je přitom v obou
případech správný, takže se rozdíl neprojeví na volajících, jen na tom, že cílový soubor
nikde nevznikne.

**Druhá půlka téhož nálezu: hluboká podcesta se nerozřeší na soubor.** Zástupný znak v mapě
`exports` pohlcuje i lomítka, takže `@mlain/core/contacts/fields/catalog` míří na
`src/contacts/fields/catalog/index.ts`, tedy na **adresář**. Ověřeno spuštěním pod Node 24.2:

```
FAIL @mlain/core                        -> ERR_PACKAGE_PATH_NOT_EXPORTED
OK   @mlain/core/contacts               -> src/contacts/index.js
OK   @mlain/core/contacts/jobs          -> src/contacts/jobs/queue-handlers.js
OK   @mlain/core/contacts/fields/catalog -> src/contacts/fields/catalog/index.js  (ADRESÁŘ)
```

Týká se to konkrétně:

| Plán | Import | Kam to ve skutečnosti míří |
|---|---|---|
| P08 | `@mlain/core/contacts/fields/catalog` (4 místa) | `src/contacts/fields/catalog/index.ts` |
| P12 | `@mlain/core/contacts/fields` | `src/contacts/fields/index.ts` |
| P04 | `@mlain/core/errors/api-error`, `@mlain/core/audit/write` | `src/errors/api-error/index.ts`, `src/audit/write/index.ts` |

**Platný tvar je `@mlain/core/<domena>`.** P07 proto zakládá `packages/core/src/contacts/index.ts`
jako veřejnou plochu domény a katalog polí z něj reexportuje; P08 a P12 mají importovat odtud.
Uvnitř balíčku se importuje relativně.

### P07-2. `@mlain/db` nemá podcestu k repository ani k testovacímu harnessu

- **Našla:** oprava P07 ve fázi 3
- **Týká se:** **P03** (vlastník manifestu), P07 (opraveno), a každý doménový plán s testy nad databází
- **Závažnost:** vysoká, dvě různé věci pod jedním nálezem

Mapa `exports` balíčku `@mlain/db` má pět klíčů (`.`, `./schema`, `./migrate`, `./partitions`,
`./rls`, `./unsafe-context`) a **žádný zástupný znak**.

1. **Doménová repository v `packages/db/src/repo/` nejsou dosažitelná.** P07 jich tam mělo
   třináct a importoval je jako `@mlain/db/repo/contacts`. Skončilo by to na
   `ERR_PACKAGE_PATH_NOT_EXPORTED`. P03 to sám v komentáři u `src/index.ts` říká jinak, než
   jak si to plány vyložily: „doménové repository si píše každý doménový plán do
   `packages/core/<domena>`". **P07 je přestěhoval do `packages/core/src/contacts/repo/`.**
   Stejnou chybu ať si ověří P10, P11, P13 a P14.
2. **Testovací harness není vystavený.** `startHarness()` a `seedTwoWorkspaces()` leží
   v `packages/db/test/helpers/`, což je mimo `exports`. **Žádný doménový plán tedy nemá jak
   spustit test proti reálné databázi**, a alternativa je, že si každý napíše vlastní
   kontejner. Požadavek na P03 je jeden řádek:
   `"./test-support": "./test/helpers/index.ts"` s reexportem `startHarness`,
   `seedTwoWorkspaces` a typu `Harness`.

### P07-3. `packages/core` nemá běh databázových testů

- **Našla:** oprava P07 ve fázi 3
- **Týká se:** **P01** (vlastník manifestu), P07, P10, P11, P13, P14
- **Závažnost:** vysoká, protože selhání je tiché

`packages/core/package.json` má jen `test:unit`. Jakmile se doménová datová vrstva přestěhuje
do `packages/core` (viz N42), nemají její databázové testy kde běžet. Konfigurace, která
nenajde žádný test, přitom **skončí zeleně**, takže by to vypadalo jako úspěch.

Požadavek na P01: skript `test:db` s vlastním vitest projektem a `@mlain/db` plus
`testcontainers` v `devDependencies` balíčku `packages/core`.

### P07-4. Výmaz podle článku 17 nemá jak přepnout roli, takže selže pokaždé

- **Našla:** revize P07, potvrzeno při opravě
- **Týká se:** **P03** (`PoolKind`), **P04** (adaptér `packages/core/tx`), P07
- **Závažnost:** nejvyšší, výchozí režim výmazu nefunguje

Migrace 0006 plánu P03 odebírá `mlain_app` práva `UPDATE` i `DELETE` na `consents`, migrace
0005 dává `DELETE` jedině roli `mlain_gdpr`. P03 ale vystavuje `PoolKind` jen jako
`'app' | 'readOnly'` a tu roli používá **pouze ve vlastních testech**. Produkční cesta k ní
neexistuje, takže `DELETE FROM consents` skončí na `42501` při každém výmazu v režimu
`anonymize`, což je výchozí režim.

Režim `purge` roli nepotřebuje, protože kaskáda `ON DELETE CASCADE` se provádí systémem.
Právě proto se vada neprojeví na testu fyzického smazání.

Požadavek: `PoolKind: 'app' | 'readOnly' | 'gdpr'` v P03 a obálka `withGdpr(ctx, fn)`
v adaptéru `packages/core/src/tx`. Zvážit `GRANT SELECT ON contacts TO mlain_gdpr`, protože
dnes ta role nemá právo si přečíst, co maže.

### P07-5. Šest symbolů, které doménové plány volají a vlna A je nemá

- **Našla:** oprava P07 ve fázi 3 srovnáním proti aktuální podobě P02 a P04
- **Týká se:** P07 (opraveno), a s velkou pravděpodobností P10, P11, P13, P14, P15
- **Závažnost:** vysoká, každý z nich je chyba překladu nebo tichý rozchod kontraktu

| Co plány volají | Co ve skutečnosti existuje | Kde |
|---|---|---|
| `DomainError(code, { fieldCode })` | `ApiError(code, { params, errors, findings })` | P04, `@mlain/core/errors` |
| `writeAudit(tx, ctx, entry)` | `writeAuditLog(tx, entry)` s plnou položkou a `actorInfo(actor, label)` | P04, `@mlain/core/audit` |
| `emitWebhookEvent(tx, ctx, type, data)` | `emitWebhookEvent(tx, { workspaceId, type, occurredAt, data })` | P04, `@mlain/core/platform` |
| `getKeyring()` vracející `{ current, all }` | `keyringFromEnv()` vracející **`Map<number, Uint8Array>`** | P02, `@mlain/contracts/keyring` |
| `encodeToken(type, payload)`, `decodeToken(raw)` vracející `{ ok }` | `buildToken({ type, keyId, fields, keyring })` a `verifyToken({...})`, které **hází `TokenError`** | P02, `@mlain/contracts/token` |
| `withTransaction(ctx, fn)` | `withWorkspace(ctx, fn)` z adaptéru P04, callback dostane Drizzle handle | P04, `@mlain/core/tx` |

Nejzáludnější je keyring: P07 si vedle kontraktu držel **vlastní** konstantu purpose, vlastní
HKDF sůl a vlastní typ `Keyring`. Byly by to dvě implementace téhož receptu a rozdíl mezi nimi
se nepozná ničím jiným než tím, že vymazaný člověk dostane mail, protože otisk smazané adresy
nejde přepočítat.

### P07-6. Dva nepovinné indexy, které by P07 využil

- **Našla:** oprava P07 ve fázi 3
- **Týká se:** **P03**, P07 (funguje i bez nich)
- **Závažnost:** nízká, je to výkon, ne správnost

1. GIN `gin_trgm_ops` nad `(workspace_id, first_name_key, last_name_key)`. Bezdiakritické
   hledání jde po opravě přes tyhle dva sloupce (P07 zrušil požadavek na nový sloupec
   `search_key`) a vlastní index nemá.
2. Druhý částečný index se stejným predikátem jako `idx_contacts__ws_vocative_review`, ale nad
   `last_name_key`. Fronta kontroly oslovení umí obě větve, indexovaná je jen ta podle
   křestního jména.

Ani jeden nemění zápis, takže se dají doplnit kdykoli později.

### N59. P06 nepoužívá komponentu K1, přestože ji řídicí dokument u tabulek předpokládá

- **Našla:** křížová kontrola opravy P06 proti hotovému P05, ověřeno grepem na `<DataTable`
- **Týká se:** **P06** (rozhodnutí zapsáno u něj), P05 jako vlastník komponenty
- **Závažnost:** střední, není to chyba překladu, ale rozpor v tom, co plán tvrdí

Všech pět seznamů P06 (členové, pozvánky, klíče, webhooky, log doručení, audit) kreslí
`<table>` ručně. `DataTable` z `@mlain/ui/patterns/data-table` **nevykresluje ani jednou**,
přestože dřívější znění jeho kapitoly 2.2 komponentu uvádělo mezi předpoklady a rozhodnutí R3
mluvilo o „datové tabulce K1".

Důvody, proč to tak vzniklo, jsou věcné: `DataTable` žádá `count` a `pagination` v tvaru,
který P06 nemá čím naplnit (kurzorové stránkování bez celkového počtu u čtyř z pěti seznamů),
a u dvou tabulek je řádek formulářem se Server Action, ne jen daty.

**P06 to má opravené na své straně:** tvrzení z 2.2 i z R3 jsou srovnaná s kódem a kontrakt
už `DataTable` neobsahuje. **Zbývá rozhodnout**, jestli se K1 má do P06 vrátit. Je to průchod
přes pět tabulek a dotýká se toho, jestli `DataTable` unese řádek s formulářem; to je otázka
na P05, ne na P06.

### P13-1. `campaigns.compile_meta` v P03 pořád není, a blokuje to fázi J i materializaci

- **Našel:** oprava P13, ověřeno grepem v P03 **v okamžiku zápisu** (2026-08-01, 13:36),
  a znovu po námitce koordinátora (13:45, soubor P03 se mezitím nezměnil, poslední zápis 12:13)
- **Týká se:** **P03** jako vlastník schématu, P09 jako druhý odběratel, P13 jako zapisovatel
- **Závažnost:** kritická, bez sloupce se fáze J nedá dokončit

Grep `compile_meta|compileMeta` v P03 vrací **jediný** výskyt: ř. 2845 `compileMeta: jsonb()`.
Ten řádek ale patří do tabulky **`template_versions`**, jejíž definice začíná na ř. 2835
(`export const templateVersions = pgTable('template_versions', {`). Tabulka `campaigns` je až
na ř. 3172 až 3230 a `compile_meta` v ní **není**; má `compiledHtml`, `compiledText`,
`compiledAt`, `compiledFields`, `compiledHash`, `audienceBreakdown` a `releaseAt`, ale
metadata kompilace ne.

**Metadata z `template_versions` ten sloupec nahradit nemůžou**, a to ze dvou nezávislých důvodů:

1. `campaigns` odkazuje na `templates.id` (`ON DELETE SET NULL`), **ne na konkrétní verzi**.
   Sloupec `template_version_id` neexistuje, takže z kampaně není jak dohledat, která verze
   šablony ji vyrobila. Navíc `campaigns.design` je samostatné jsonb: kampaň může mít obsah,
   který v žádné šabloně není.
2. I kdyby ten odkaz existoval, obsah by neseděl. `CompiledLink.id` je podle kontraktu 5
   plánu P08 **UUIDv5 odvozené z `campaignId`**, takže dvě kampaně ze stejné šablony mají
   různá ID odkazů. Metadata uložená u verze šablony by pro kampaň platila jen náhodou.

DDL: `ALTER TABLE campaigns ADD COLUMN compile_meta jsonb;`

Odběratelé jsou dva a oba tiší:

1. **Sender (P09)** má podle kritéria AK-6.21 porovnat počet nalezených značek odkazů proti
   `clickMarkerCount`. Dnes to obchází degradací s logem `compile_meta_column_missing`.
2. **Materializace (P13)** z něj bere `renderSchema` a `usedPaths` pro `prepareRenderData`.
   Bez nich se nenaplní kořen `_present` a **podmíněné bloky se v odeslaných mailech tiše skryjí**.

P13 to má u sebe zapsané jako požadavek R-P03.5 a celou cestu (`saveCompilation`, `readCompileMeta`,
`renderPlanForCampaign`) napsanou tak, aby fungovala v okamžiku, kdy sloupec vznikne.
DDL: `ALTER TABLE campaigns ADD COLUMN compile_meta jsonb;`

### P13-2. Cizí klíč invariantu I1 znemožňuje testovací odeslání z draftu

- **Našel:** oprava P13, **ověřeno spuštěním** proti PostgreSQL 18 (ne přečtením)
- **Týká se:** **P03** jako vlastník `fk_messages__campaign_audience`
- **Závažnost:** kritická, testovací mail z rozepsané kampaně nejde odeslat vůbec

P03 zavádí složený cizí klíč, který drží invariant I1:

```sql
FOREIGN KEY (campaign_id, created_at) REFERENCES campaigns (id, audience_built_at)
```

Kampaň v draftu má `audience_built_at = NULL`. Testovací odeslání ale zapisuje řádek do `messages`
s vyplněným `campaign_id`, takže dvojice `(campaign_id, created_at)` v `campaigns` neexistuje
a `INSERT` skončí chybou **23503**. Ověřeno spuštěním: `Key (campaign_id, created_at)=(...) is not
present in table "campaigns"`. Přitom právě z draftu si uživatel testovací mail posílá nejčastěji.

Řešení, které nechává invariant I1 nedotčený (ověřeno všemi čtyřmi scénáři: test z draftu projde,
kampaňová zpráva bez materializace pořád spadne, po materializaci projde, opakovaný test projde):

```sql
ALTER TABLE messages ADD COLUMN audience_campaign_id uuid
  GENERATED ALWAYS AS (CASE WHEN kind = 'campaign' THEN campaign_id END) STORED;
ALTER TABLE messages DROP CONSTRAINT fk_messages__campaign_audience,
  ADD CONSTRAINT fk_messages__campaign_audience
  FOREIGN KEY (audience_campaign_id, created_at) REFERENCES campaigns (id, audience_built_at);
```

Zapsáno u P13 jako požadavek R-P03.7.

### P13-3. `campaign_links.position` má v P03 komentář „od 0", kompilace vrací 1..N

- **Našel:** oprava P13, ověřeno v P03 ř. 3283 a v kontraktu 5 plánu P08
- **Týká se:** **P03** (komentář), P08 (zdroj hodnot), P13 a P14 (odběratelé)
- **Závažnost:** nízká, je to jen komentář, ale zavádí do omylu

P03 má u sloupce `position: integer().notNull()` komentář `// pořadí výskytu v HTML, od 0`.
Kontrakt 5 plánu P08 přitom u `CompiledLink.position` deklaruje `1..N, souvislá řada podle
prvního výskytu`, a P13 rozhodnutím D17 přebírá pozice z `CompileMeta` **doslova** a vyhazuje
`contract_mismatch`, když dorazí pozice menší než 1.

Nic nespadne, protože sloupec žádný `CHECK` nemá. Jen komentář tvrdí opak toho, co v tabulce
skutečně bude, a druhý čtenář podle něj může napsat dotaz s `position = 0`.

Stačí opravit komentář na `// pořadí výskytu v HTML, 1..N (viz kontrakt 5 plánu P08)`.

### P13-4. `sending_providers` nemá kam uložit stav žádosti o produkční přístup

- **Našel:** oprava P13
- **Týká se:** **P03** jako vlastník tabulky
- **Závažnost:** střední, preflight nemá uživateli co poradit

Hodnota z AWS `GetAccount → Details.ReviewDetails.Status` projde v P13 třemi vrstvami (čtení kvót,
signatura `updateAccountSnapshot`) a v samotném `UPDATE` tiše zmizí, protože sloupec neexistuje.
Preflight podle ní má rozlišit „žádost běží" (`PENDING`) od „žádost zamítnuta" (`DENIED`), což je
u zablokovaného odesílání pro uživatele zásadní rozdíl.

Bez `CHECK`, ze stejného důvodu jako u `enforcement_status`: uzavřený výčet by se rozbil při první
nové hodnotě od AWS a shodil by job `provider.refresh_quota`.
DDL: `ALTER TABLE sending_providers ADD COLUMN review_status text;`
Zapsáno u P13 jako požadavek R-P03.8.

### P13-5. Retenční job potřebuje migrátorské spojení, které mu nikdo nedodá

- **Našel:** oprava P13
- **Týká se:** **P01** (worker), P03 (`dropPartitionsBefore`)
- **Závažnost:** kritická pro fázi I, retence dnes nefunguje vůbec

`dropPartitionsBefore` z `@mlain/db/partitions` používá `DETACH PARTITION ... CONCURRENTLY`.
Ten příkaz **nesmí běžet v transakčním bloku** a DDL vyžaduje vlastníka relace, tedy
`mlain_migrator`. `@mlain/db` přitom vystavuje jen aplikační a read-only pool
(`createPool(url, 'app' | 'readOnly', max)`), takže doménový plán se k migrátorskému spojení
nemá jak dostat.

Původní podoba P13 to obcházela vlastním `DROP TABLE` pod `mlain_app`, což by skončilo chybou
**42501** `must be owner of table`. P13 to má opravené na volání `dropPartitionsBefore` s vlastním
veto predikátem, ale spojení musí přijít zvenčí. Worker (P01) stejnou cestou už pouští
`platform.maintain_partitions`, takže jde o zpřístupnění, ne o novou schopnost.
Zapsáno u P13 jako požadavek R-P01.6.

### P13-6. `packages/core` nemá `test:db`, a týká se to už tří plánů

- **Našel:** oprava P13; **shodné s P07-3**, tenhle záznam jen doplňuje třetího postiženého
- **Týká se:** **P01** jako vlastník manifestu `packages/core`
- **Závažnost:** vysoká, databázové testy tří plánů se nespustí

Po rozhodnutí P07-1 leží datové vrstvy domén v `packages/core/src/<domena>/repo/**`. P13 tam po
opravě přesunul `campaigns/repo/**` a `providers/repo/**` (dřív byly v `packages/db`, kam
nepatřily a odkud navíc nešly naimportovat, viz P07-2). `packages/core` má ale jen `test:unit`,
takže databázové testy P07, P11 a P13 nemá co spustit.
Zapsáno u P13 jako požadavek R-P01.7.

### P13-7. Barrel P07 exportuje `isMailable`, které v P07 neexistuje

- **Našel:** oprava P13 při hledání predikátu způsobilosti; ověřeno grepem v P07 (2026-08-01, 13:36)
- **Týká se:** **P07**
- **Závažnost:** vysoká, `packages/core/src/contacts/index.ts` se nezkompiluje

`packages/core/src/contacts/index.ts` na ř. 521 má
`export { isMailable, type MailableVerdict } from './mailable.js';`, ale úkol 18 téhož plánu
implementuje `evaluateMailability`, `MailabilityInput`, `MailabilityResult` a `MAILABLE_STATUS`.
Symboly `isMailable` ani `MailableVerdict` nejsou v P07 nikde definované; jediné dva výskyty jsou
ten export a test veřejné plochy na ř. 587, který je jmenovitě vypisuje jako „odběratele P13".

P13 ani jeden z těch symbolů nepoužívá (staví publikum výhradně přes `compileAudienceToSql`),
takže ho to neblokuje. Blokuje to ale P07 sám: barrel je vstupní bod celé domény.

### P13-8. P04 zakládá `packages/core/tx/` bez mezistupně `src/`

- **Našel:** oprava P13 při napojení na transakční vrstvu; ověřeno grepem v P04 (13 výskytů)
- **Týká se:** **P04**; totéž rozhodnutí jako P07-1
- **Závažnost:** střední, import `@mlain/core/tx` se nerozřeší

Mapa `exports` balíčku `@mlain/core` (vlastní P01) míří na `"./*": "./src/*/index.ts"`, takže
`@mlain/core/tx` se rozřeší na `packages/core/src/tx/index.ts`. P04 ale svůj adaptér zakládá jako
`packages/core/tx/index.ts`, tedy o jednu úroveň výš, a stejně tak `packages/core/errors/`,
`packages/core/identity/` a další.

Rozhodnutí P07-1 tuhle otázku uzavřelo obecně ve prospěch `src/` a P07 se podle něj opravil.
P13 používá **import cestu** `@mlain/core/tx`, která je správná v obou případech, takže ho to
neblokuje. P04 se ale musí srovnat, jinak žádný z těch souborů nebude na místě, kam ukazuje
jeho vlastní export.

<!-- Nálezy z opravy P12 (fáze 3). Číslovány prefixem plánu, protože číselná řada Nxx
     se v tomhle souboru mezi vlnami opakuje a N60 i N61 jsou už obsazené. -->

### P12-1. Šablona nemá endpoint pro testovací odeslání, přestože ho žádají kritéria 43 a 44

- **Našla:** oprava P12 ve fázi 3, ověřeno výpisem všech cest routeru, ne grepem na slovo
- **Týká se:** **P08** (vlastník `apps/web/src/server/routes/templates.router.ts`), P12, P13
- **Závažnost:** vysoká, dvě akceptační kritéria zůstanou nepokrytá
- **Stav dodavatele v okamžiku zápisu:** P08 ve verzi z 1. 8. 2026 12:27, **nula výskytů**
  řetězce `test-send` v celém plánu

Router `/api/v1/templates` má patnáct cest (`GET /`, `GET /field-usage`, `POST /import`,
`POST /`, `GET|PATCH|DELETE /:template_id`, `/duplicate`, `/validate`, `/compile`, `/preview`,
`/versions`, `/versions/:version/restore`, `/export`). **`POST /:template_id/test-send` mezi
nimi není.**

P12 ho volá v úkolu 26, protože kritéria 43 a 44 části 3 žádají testovací e-mail, který obejde
suppression list a nepočítá se do statistik. Funkce `sendTest` v P13
(`packages/core/src/campaigns/test-send/send-test.ts`) je pro **kampaň**, ne pro šablonu, takže
ji P12 nemá jak zavolat: šablona v tu chvíli žádnou kampaň nemá.

**Požadavek na P08:** `POST /api/v1/templates/{id}/test-send` se scope `templates:write`, tělem
`{ recipients: string[] (1 až 5), add_test_prefix: boolean, preview_data }` a chováním podle
kritérií 43 a 44. Editorová strana je hotová a otestovaná proti dvojníkovi portů, takže se P12
nezastaví, ale **kritéria zůstanou nepokrytá a nesmí se odškrtnout**.

### P12-2. Endpoint náhledu neumí variantu „kontakt bez jména", takže kritérium 55 nejde splnit

- **Našla:** oprava P12 ve fázi 3, ověřeno čtením těla obsluhy, ne průvodního textu
- **Týká se:** **P08** (`templates.router.ts`, `preview-data.ts`), P12
- **Závažnost:** vysoká, blokuje jedno z pouhých dvou tučně zvýrazněných kritérií P12
- **Stav dodavatele v okamžiku zápisu:** P08 z 1. 8. 2026 12:27, **nula výskytů** řetězce
  `preview_data`

Obsluha `POST /:template_id/preview` čte z těla **`render_data`**, tedy hotová data, a když
chybí, sáhne po `sampleRenderData(language)`. Jiná varianta vzorových dat neexistuje.

Kritérium 55 části 6 žádá tlačítko „Kontakt bez jména", které ukáže náhled s prázdnými osobními
údaji. Nejde ho nahradit výběrem konkrétního kontaktu, protože kontakt bez jména v projektu být
nemusí, a nejde ho ani obejít posláním vlastního `render_data`: klient by musel znát tvar
`renderSchema`, který vzniká až kompilací na serveru.

**Požadavek na P08:** přijmout `preview_data: { type: "sample", variant: "default" | "no_name" }`
a `{ type: "contact", contact_id }`, s tím, že `no_name` vyrobí vzorová data s prázdným
`first_name`, `last_name` i `greeting`. Je to vedené jako P08-R2 v kapitole 9.2 plánu P12.

### P12-3. `packages/core/identity` nemá veřejnou plochu, takže se z obrazovky nedá vyrobit kontext projektu

- **Našla:** oprava P12 ve fázi 3. **Je to konkrétní dopad nálezu P07-1**, ne nový problém.
- **Týká se:** **P04** (vlastník domény), P12, a každý další plán se serverovou komponentou
- **Závažnost:** vysoká, chyba překladu
- **Stav dodavatele v okamžiku zápisu:** P04 z 1. 8. 2026 13:04, `createWorkspaceContext` se
  importuje výhradně jako `@mlain/core/identity/context`, soubor `identity/index.ts` neexistuje

Mapa `exports` balíčku `@mlain/core` zní `"./*": "./src/*/index.ts"` a zástupný znak pohlcuje
lomítka, takže `@mlain/core/identity/context` míří na `src/identity/context/index.ts`, tedy na
adresář. P07-1 to popisuje obecně; tohle je místo, kde to zastaví konkrétní plán.

`createWorkspaceContext` je podle 3.6 části 1 **jediná legitimní továrna** kontextu projektu,
typ je branded schválně a jinou cestou vzniknout nemá. Serverová komponenta editoru ho potřebuje,
aby přečetla šablonu a katalog polí; obojí je čtení v procesu, protože endpoint vracející
sloučený katalog prvotřídních i vlastních polí neexistuje (`GET /api/v1/contact-fields` vrací
jen vlastní pole v jiném tvaru).

**Požadavek na P04:** založit `packages/core/src/identity/index.ts` jako veřejnou plochu domény
a reexportovat z ní aspoň `createWorkspaceContext`. Je to jeden soubor a uzavírá to i těch 367
hlubokých podcest, o kterých mluví P07-1.

### P12-4. Odhad rozsahu P12 v řídicím dokumentu je poloviční proti skutečnosti

- **Našla:** revize P12, potvrzeno měřením při opravě
- **Týká se:** **řídicí dokument** `2026-07-31-rozdeleni-implementacnich-planu.md`, kapitola 5
- **Závažnost:** nízká pro kód, střední pro plánování vlny 2

Kapitola 5 u P12 uvádí „zhruba 3000 řádků při 6 až 8 typech bloků". Blokový model P08 má typů
bloků **dvanáct** (`section`, `columns`, `column`, `repeat`, `heading`, `text`, `image`,
`button`, `divider`, `spacer`, `html`, `social`, `footer`, přičemž `repeat` se v paletě
nenabízí) a editor je musí obsloužit všechny.

Změřeno v opraveném plánu: **6 370 řádků TypeScriptu**, z toho 1 891 testů a 4 479 implementace.
Není to chyba P12, počet typů určuje P08. Architektura nárůst tlumí přesně tak, jak měla:
dvanáct typů bloků obsluhuje **dvanáct ovládacích prvků**, ne osmdesát, protože prvek zná druh
vlastnosti a ne blok.

P12 si odhad opravil u sebe v tabulce rizik. **Zbývá opravit řídicí dokument**, ať se podle něj
neplánuje vlna; ten patří koordinátorovi, ne doménovému plánu.

### P12-5. `packages/emails/src/paths.ts` importuje katalog polí hlubokou podcestou

- **Našla:** oprava P12 ve fázi 3 při ověřování, odkud brát `toMergePath`
- **Týká se:** **P08**, drobnost, ale zastaví typovou kontrolu balíčku
- **Závažnost:** nízká, běhu se nedotkne, protože jde o `import type`

`packages/emails/src/paths.ts` má
`import type { FieldCatalog } from "@mlain/core/contacts/fields/catalog"`.
Ta cesta se přes zástupný znak rozřeší na `src/contacts/fields/catalog/index.ts`, tedy na adresář
(nález P07-1). Za běhu se nic nestane, protože `import type` po překladu zmizí, ale
`tsc --noEmit` nad `packages/emails` na tom skončí.

Platný tvar je `@mlain/core/contacts`, odkud P07 katalog i jeho typy reexportuje. P12 z téhož
souboru bere `toCatalogPath`, `toMergePath` a `toLiquidRoots`, takže se ho to týká přímo.

### P12-6. Kontrola slovníku v P05 pořád porovnává jména ICU slotů, doplnění k N56

- **Našla:** oprava P12 ve fázi 3, ověřeno čtením `findViolations` v aktuálním P05
- **Týká se:** **P05**, a každý plán s obrazovkou
- **Závažnost:** střední. **N56 zatím opravený není**, tohle je jen potvrzení stavu.
- **Stav dodavatele v okamžiku zápisu:** P05 z 1. 8. 2026 11:14, `findViolations` má dál
  `const haystack = value.toLocaleLowerCase('cs')` bez odstranění obsahu složených závorek

Katalogy P12 se tomu vyhnuly tím, že žádný slot nepojmenovaly `{workspace}`, `{sandbox}` ani
`{placeholder}`. Test v úkolu 27 kontroluje slovník **stejně nepřesně jako P05 schválně**, tedy
proti celé zprávě včetně jmen slotů, aby porušení chytil při psaní katalogu a ne až v CI. Až se
N56 opraví, tenhle test začne být mírnější než brána, což nevadí; opačné pořadí by vadilo.

<!-- Nálezy z opravy P11 (fáze 3, vlna C). -->

### P11-1. `contacts.is_sample` neexistuje a jedna chybějící brána shodí celý rozpad publika

- **Našla:** oprava P11 ve fázi 3
- **Týká se:** **P03** (vlastník schématu), P16 (vlastník ukázkových dat), P13 (odběratel rozpadu)
- **Stav dodavatele v okamžiku zápisu:** P03 z 1. 8. 2026 12:13, `grep -n "is_sample"` vrací **nula** výskytů
- **Závažnost:** střední. P11 se zatím obešel, ale bez sloupce je funkce nesplnitelná.

Rozpad publika (část 6, 8.4.6) má sedm bran a skládá je do **jednoho** dotazu se sedmi
`count(*) FILTER`. Neexistující sloupec v kterékoli z nich tedy neshodí jednu bránu, ale celou
obrazovku chybou `42703`. P11 proto bránu `sample` zneškodnil natvrdo na `false` (rozhodnutí R20)
a přidal test, který obě neměřicí brány drží na nule, aby si je nikdo nespletl s naměřenými.

Až sloupec vznikne, je to v P11 změna jednoho řádku. Souvisí se zadáním „u importu nabídnout
50 ukázkových kontaktů a umět je hromadně smazat", které vlastní **P16**: bez příznaku na kontaktu
nemá P16 jak ukázkové kontakty najít, takže hromadné smazání by muselo jít přes štítek, což je
slabší (uživatel štítek smaže) a nejde to vynutit.

### P11-2. Sken napříč projekty nad `segments` a `imports` vrací tichou nulu

- **Našla:** oprava P11 ve fázi 3, **ověřeno spuštěním** nad PostgreSQL 18 s politikou `ws_isolation`
- **Týká se:** **P03**, a je to týž požadavek, jaký si už vyžádal P10 pro tracking
- **Stav dodavatele v okamžiku zápisu:** P03 z 1. 8. 2026 12:13; `mlain_scheduler`, `system_bypass`
  ani `list_stale_*` v něm nejsou, `workspaces` v `TABLES_WITHOUT_RLS` taky ne
- **Závažnost:** vysoká u importů, střední u segmentů

Ověřeno spuštěním pod rolí bez `BYPASSRLS` a bez `set_config`:

```
bez kontextu -> { users: 2, segments: 0 }
pocet radku skenu bez bypassu: 0   (a ZADNA chyba)
```

Dopad má dvě úrovně. U segmentů je hodinový přepočet pohodlí a `listSegments` ho zastoupí při
otevření seznamu. **U importů je to jediná cesta zpátky z uváznutí:** zabitý worker nechá import
ve stavu `importing`, `singletonKey` projektu zůstane obsazený a v projektu už nejde spustit
žádný další import. `imports.updated_at` je jediný signál živosti a P03 to sám v komentáři píše,
jen k tomu nedal přístupovou cestu.

Nabízí se řídit obnovu z mrtvé fronty pg-boss a sken zrušit. **Nejde to:** `retryLimit` je 0
schválně, aby se rozpracovaný import nespouštěl od začátku, a `SIGKILL` neposílá žádnou událost.

P11 to zatím řeší strážcem, který ticho odliší od prázdna a job shodí chybou
`cross_workspace_scan_blocked` místo hlášení `{ scheduled: 0 }`, plus databázovým testem nad
**dvěma** projekty. Hlasitá porucha je horší než funkční stav, ale nesrovnatelně lepší než
porucha, kterou nikdo nikdy nenajde. Rozsah požadavku na P03 je `segments` a `imports` navíc
k seznamu, který už uvedl P10.

### P11-3. `upsertContacts` si otevírá vlastní transakci, takže s ní nejde sdílet dávku

- **Našla:** oprava P11 ve fázi 3
- **Týká se:** **P07** (vlastník upsertu), P11 (jediný volající, který potřebuje atomicitu)
- **Stav dodavatele v okamžiku zápisu:** P07 z 1. 8. 2026 12:39, `upsertContacts(ctx, input)`
  volá uvnitř `withWorkspace(ctx, …)`; třetí argument nemá
- **Závažnost:** vysoká, ruší celou obnovitelnost importu

P07 označuje `upsertContacts` komentářem „P11 import" a je to správně: je to jediné místo
v produktu, kde kontakt vzniká hromadně, a P11 si vlastní `INSERT` psát nemá. Dřívější podoba
P11 si ho psala a přesně proto v ní chyběly `first_name_key` a `last_name_key`, takže by fronta
ke kontrole oslovení zůstala po importu prázdná.

Jenže import musí zapsat kontakty **a checkpoint v jedné transakci**. Na tom stojí kritéria 7
(„zabití workera uprostřed nezpůsobí duplicitu ani vynechání") a 14. Když si `upsertContacts`
otevře vlastní transakci, jsou to transakce dvě: pád mezi nimi znamená zapsané kontakty bez
posunutého checkpointu a po restartu se tytéž řádky zapíšou podruhé.

Požadavek je malý: `upsertContacts(ctx, input, tx?)`, kde se při zadaném `tx` transakce neotvírá.
Týká se to každého volajícího, který zapisuje kontakt spolu s něčím dalším, tedy i příchozích
webhooků v P07 samotném.

### P11-4. `actorUserId(ctx)` chybí a `actorInfo` ho nenahradí

- **Našla:** oprava P11 ve fázi 3
- **Týká se:** **P04** (vlastník identity), a každý plán, který zakládá řádek z jobu
- **Stav dodavatele v okamžiku zápisu:** P04 z 1. 8. 2026 13:04. `createSystemContext` **už má**
  a `withReadOnly` s objektem taky, tohle je jediné, co zbývá.
- **Závažnost:** střední, ale selhání je odložené do provozu

Sloupce `created_by` jsou `uuid REFERENCES users(id)` a hodnotu smí dostat **jen** aktér typu
`user`. P11 na ně sahá na čtyřech místech (`segments`, `imports`, `exports`, zmrazený segment).

Existující `actorInfo(actor, label)` to nenahrazuje a je to past: u aktéra typu `api_key` vrací
`actorId` **klíče**, tedy hodnotu, která do `created_by` nesmí a která projde jak typovou
kontrolou, tak vložením, dokud se nenarazí na cizí klíč. Potřebný pomocník je tříradkový:

```ts
export function actorUserId(ctx: WorkspaceContext): string | null {
  return ctx.actor.type === 'user' ? ctx.actor.userId : null;
}
```

Zrádné je, že se to přes obrazovku nikdy neprojeví: uživatel má platné UUID. Spadne to teprve
při prvním běhu jobu.

### P11-5. `users.preferences` chybí a odložení skupiny ve frontě oslovení nemá kam zapsat

- **Našla:** revize P11, přechází s agendou na P07 podle rozhodnutí U3
- **Týká se:** **P03** (schéma), **P07** (nový vlastník fronty)
- **Stav dodavatele v okamžiku zápisu:** P03 z 1. 8. 2026 12:13, `users` sloupec `preferences`
  ani `attributes` nemá
- **Závažnost:** střední, jedna z pěti operací nad skupinou nejde provést

Operace „odložit skupinu" zapisovala `UPDATE users SET attributes = jsonb_set(…)`. Tabulka
`users` ale žádný jsonb sloupec pro uživatelské předvolby nemá; nejbližší jsou
`workspaces.settings` a `system_settings.settings`, ani jedno není per uživatel.

Navrhovaný tvar je `preferences jsonb NOT NULL DEFAULT '{}'` s `CHECK` na `jsonb_typeof = 'object'`
a stropem `pg_column_size`, tedy po vzoru `contacts.attributes`. Jméno `preferences` je lepší než
`attributes`, aby se nepletlo s uživatelskými poli kontaktu.

Nález se sem zapisuje proto, že úkoly 37, 38 a 53 z P11 vypadly, ale problém s nimi nezmizel:
P07 na něj narazí u téže operace.

### P11-6. Testovací harness `@mlain/db` je pořád mimo mapu exportů

- **Našla:** oprava P11 ve fázi 3. **Je to potvrzení stavu nálezu P07-2, ne nový nález.**
- **Týká se:** **P03**
- **Stav dodavatele v okamžiku zápisu:** P03 z 1. 8. 2026 12:13, mapa `exports` má pět klíčů
  (`.`, `./schema`, `./migrate`, `./partitions`, `./rls`, `./unsafe-context`) a `./test-support`
  mezi nimi není; `startHarness` a `seedTwoWorkspaces` leží v `packages/db/test/helpers/`
- **Závažnost:** střední, důsledkem je duplikace, ne nefunkčnost

P11 si proto v `packages/core/test/segments/helpers/db.ts` spouští vlastní kontejner. Totéž
udělá P10, P13 a P14, takže vzniknou čtyři kopie téhož bootstrapu, které se rozejdou v tom, co
seedují. Požadavek je jeden řádek v manifestu plus reexport `startHarness`, `seedTwoWorkspaces`
a typu `Harness`.


### P13-9. Ochrana ukázkových kontaktů potřebuje manifest, ne jen značku (uzavírá N8 na straně P13)

- **Našel:** oprava P13 po námitce koordinátora, **ověřeno spuštěním** na 200 000 řádcích
- **Týká se:** **P13** (vynucení, opraveno), P16 jako vlastník konvence
- **Závažnost:** nálezu ubyla, tohle je záznam o tom, jak se uzavřel

Nález **N8** žádal sloupec `contacts.is_sample`. Rozhodnutí A1 plánu P16 ho zavírá jinak a lépe:
nový sloupec znamená migraci, kterou vlastní P03, a ukázkovost jde vyjádřit třemi existujícími
mechanismy. **Žádný sloupec se nezakládá.** P13 svůj požadavek R-P07.5 ruší.

Vynucení „ukázkové kontakty nejdou do publika kampaně" zůstává v P13 (P16 to potvrzuje ve své
kapitole o hranicích) a opírá se o **dva** mechanismy, ne o jeden:

- **manifest** `workspaces.settings -> 'demoData' -> 'contactIds'` je autoritativní pro rozsah sady,
- **značka** `contacts.source_ref = 'demo-data:v1'` je záchytná síť pro kontakty mimo manifest.

Obojí je nutné a je to ověřené spuštěním, ne úvahou. Na sadě 200 000 kontaktů s 50 ukázkovými,
u kterých deset mělo uživatelem přepsaný `source_ref`, propustil filtr jen podle značky
**deset ukázkových kontaktů do publika**; s manifestem prošly nula. Opačně platí, že kontakt
se značkou mimo manifest (starší pokolení sady, obnova ze zálohy) by prošel, kdyby se
filtrovalo jen podle manifestu.

P13 si konvenci **nepíše znovu**: `DEMO_SOURCE_REF` i `parseDemoManifest` importuje
z `@mlain/core/demo`, tedy od P16. Manifest se čte jednou před materializační smyčkou a předává
se jako pole; poddotaz nad `settings` přímo v kandidátském dotazu stojí 225 ms na 200 000 řádcích
proti 75 ms u předaného pole.

**Zbývá na P16:** aby `packages/core/src/demo/manifest.ts` byl importovatelný zvenčí, potřebuje
`@mlain/core` podcestný export `./demo`. Je to táž třída požadavku jako R-P01.3 pro `./campaigns`.

### N62. `baseSectionSpecSchema` v P08 neexistuje, a stojí na něm celý strukturovaný výstup P15

- **Našla:** oprava P15, ověřeno grepem v P08 k 2026-08-01 (`grep -c baseSectionSpecSchema` vrací **0**)
- **Týká se:** P08 (vlastník), P15 (odběratel)
- **Závažnost:** blokující, zastaví P15 na druhém úkolu ze čtyřiceti čtyř

P15 staví strukturovaný výstup na `import { baseSectionSpecSchema } from '@mlain/emails/base'`
a používá ho jako runtime schéma: `baseSectionSpecSchema.safeParse(...)` a
`z.array(baseSectionSpecSchema).min(1).max(12)`.

P08 ale exportuje **jen typ TypeScriptu**:

```ts
export type BaseSectionSpec =
  | { kind: "hero"; headline: string; ... }
  | ... osm variant celkem
```

Typ v runtime neexistuje, nemá `safeParse` a nedá se vložit do `z.array()`. Ostatní tři rozhraní,
která P15 od P08 čeká (`buildBaseTemplate`, `validateDocument`, `validateLiquid`), existují.

**Řeší se v P08**, ne v P15: druhý zdroj pravdy pro blokové schéma je přesně to, čemu se
rozhodnutí D8 plánu P15 vyhýbá, a P15 si proto vlastní kopii psát nesmí. Doplnit
`z.discriminatedUnion('kind', [...])` a typ z něj odvodit přes `z.infer`, aby nevznikly dvě
definice. Kontraktní test P15 od schématu navíc čeká refinement „odmítne HTML tam, kde má být
prostý text", což z typu odvodit nejde.

**Dobrá zpráva:** P15 to odhalí sám v úkolu 2, tedy dřív, než napíše cokoliv dalšího.

### N63. `ANTHROPIC_AUTH_TOKEN` projde vstupním skriptem, protože nekončí na `_API_KEY`

- **Našla:** oprava P15, ověřeno grepem v P01 k 2026-08-01
- **Týká se:** P01 (entrypoint a výčet výjimek)
- **Závažnost:** střední, je to díra v první vrstvě akceptačního kritéria 7b

`docker/entrypoint.sh` maže proměnné vzorem `*_API_KEY` plus výčtem
(`AWS_BEARER_TOKEN_BEDROCK`, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_GENAI_USE_VERTEXAI`,
`AZURE_OPENAI_ENDPOINT`, `OLLAMA_HOST`, `HF_TOKEN`). `ANTHROPIC_AUTH_TOKEN` **v seznamu není**
a vzoru neodpovídá, takže v prostředí zůstane.

Je to fallback proměnná Anthropicu, tedy přesně ta třída proměnných, kvůli které kritérium 7b
vzniklo: SDK po ní sáhne, když se klíč nepředá explicitně, a projekt bez nakonfigurovaného klíče
by utrácel peníze provozovatele.

**Oprava v P01:** doplnit do `AI_PROVIDER_ENV_EXCEPTIONS` a do výčtu `unset` v entrypointu.

P15 se na tu opravu nespoléhá a chytá proměnnou druhou vrstvou (`leakedProviderEnvVars` staví
na registru providerů, kde `ANTHROPIC_AUTH_TOKEN` je), ale spoléhat u bezpečnostní pojistky na
jednu vrstvu je málo.

### N64. Tři důvody na úrovni pole chybí v uzavřeném registru P01

- **Našla:** oprava P15, ověřeno diffem seznamů kódů obou plánů
- **Týká se:** P01 (registr `VALIDATION_CODES`), P15
- **Závažnost:** nízká, ale porušuje pravidlo o uzavřeném registru

P15 používá tři kódy jako `errors[].code` u `validation_failed`, a v `VALIDATION_CODES` nejsou:

| Kód | Kde v P15 |
|---|---|
| `ai_base_url_not_allowed` | routa credentials, `base_url` u providera, který ji nepovoluje |
| `ai_base_url_required` | `buildModel`, `openai_compatible` bez `base_url` |
| `ai_custom_base_url_disabled` | `buildModel`, `AI_ALLOW_CUSTOM_BASE_URL = false` |

Registr je podle architektury P01 „předdeklarovaný úplný, dopředu, pro všech sedm specifikací,
takže ho pozdější doménové plány jen čtou a nikdy nerozšiřují". Konvence P15 říká totéž.

Opačným směrem je stav v pořádku: P01 má `brand_extract_running`, který P15 nepoužívá, protože
souběh řeší obecným `conflict`, a to je s konvencí v souladu.


### N65. `ON CONFLICT` nad `campaign_stats_buckets` v P10 nesedí s primárním klíčem, který mu dal P03

- **Našla:** oprava P14, ověřeno porovnáním DDL v P03 s dotazy v P10
- **Týká se:** P10 (čtyři místa), P03 (zdroj klíče)
- **Závažnost:** vysoká, každý zápis do bloků skončí chybou

P03 má u `campaign_stats_buckets` primární klíč **třísloupcový**, s `workspace_id` v čele:

```
primaryKey({ name: 'pk_campaign_stats_buckets',
             columns: [t.workspaceId, t.campaignId, t.bucketAt] })
```

Důvod je v P03 vysvětlený: politika RLS se vyhodnocuje nad indexovaným sloupcem a upsert z jobu
nemůže omylem trefit cizí projekt. P10 ale ve čtyřech dotazech píše `ON CONFLICT (campaign_id, bucket_at)`.
Cíl `ON CONFLICT` musí odpovídat existujícímu unikátnímu omezení, jinak Postgres skončí chybou
`42P10 invalid_column_reference`. Dvojice `(campaign_id, bucket_at)` žádnému omezení neodpovídá.

Místa v P10: řádky 8400, 9028, 9455 a 9691.

Oprava je `ON CONFLICT (workspace_id, campaign_id, bucket_at)` na všech čtyřech místech.
`ON CONFLICT (campaign_id)` u `campaign_stats` je naopak v pořádku, tam je klíč jednosloupcový.

P14 tabulku jen čte, takže se ho to přímo netýká, ale bez opravy P10 zůstane graf průběhu
i dlaždice odesílání trvale prázdná a `bucketDrift()` z P14 bude hlásit rozdíl pokaždé.

### N66. Registr front P01 přisuzuje `tracking.refresh_campaign_progress` plánu P14, který ho odmítá

- **Našla:** oprava P14, ověřeno v registru P01 a v mapě souborů P10
- **Týká se:** P01 (registr front), P10, P14
- **Závažnost:** střední, fronta by neměla obsluhu nebo by ji měla dvakrát

`QUEUE_REGISTRY` v P01 má u `tracking.refresh_campaign_progress` `owner: 'P14'`. P14 si ale
rozhodnutím R2 job výslovně nebere a je čistě čtecí vrstva; hlídá to jeho test `ownership.test.ts`,
který v doméně zakazuje adresář `jobs`. P10 naopak handler má: `packages/core/src/tracking/jobs/refresh-campaign-progress.ts`.

Vlastníkem má být **P10**. Dokud je v registru P14, hrozí, že se handler nikam nezaregistruje
(P14 ho podle svého plánu nenapíše) a průběh odesílání se nikdy nepohne, aniž by cokoliv spadlo.

### N67. Kontext projektu v Honu: P04 ho ukládá pod `auth`, P07 a P13 čtou `ctx`

- **Našla:** oprava P14, ověřeno v obou plánech
- **Týká se:** P04 (vlastník middleware), P07, P13, P14
- **Závažnost:** vysoká, na produkčním běhu spadne každá cesta jednoho z obou tvarů

Autentizační middleware v P04 nastavuje `c.set('auth', { ctx, label })` a jeho `ApiVariables`
obsahuje `auth: AuthContext`. P07 i P13 ale ve všech svých cestách čtou `c.get('ctx')` a P07
si k tomu deklaruje vlastní `ContactsEnv = { Variables: { ctx: WorkspaceContext } }`.

Jeden z obou tvarů je špatně a projeví se to až za běhu: `c.get('ctx')` vrátí `undefined`
a cesta spadne na prvním použití kontextu. V testech obou plánů to neprojde ani neselže,
protože jejich harness si proměnnou nastavuje sám podle vlastní představy.

Rozsoudit to má **P04** jako vlastník middleware. P14 je psaný proti `auth.ctx`, tedy proti
tomu, co middleware skutečně nastavuje, a přístup má schovaný v jediném souboru
`packages/core/src/reports/api/context.ts`, takže je u něj oprava jednořádková.

### N68. `campaign_stats` nemá čítač pro `rejected` a odmítnutá zpráva se počítá jako doručená

- **Našla:** oprava P14
- **Týká se:** P03 (sloupec), P10 (plnění), P14 a P13 (zobrazení)
- **Závažnost:** střední, tichá chyba v hlavní metrice produktu

`ck_message_events__type` v P03 zná typ `rejected` a P10 ho v `message_events` očekává, ale
`campaign_stats` pro něj čítač nemá a agregační job P10 ho nikam nepřičítá.

Důsledek je v odvozeném jmenovateli. Kde provider události doručení neposílá (SMTP) nebo ještě
neposlal, počítá se doručení jako `sent - bounced_hard - bounced_soft - failed`. Zpráva, kterou
provider odmítl, se z tohohle vzorce neodečte, takže se počítá jako doručená. U kampaně,
kterou SES odmítne kvůli vlastnímu suppression listu, ukáže report míru doručení blízko sta
procent a míru prokliku podstřelí. Proklik je rozhodnutím zadavatele hlavní metrika produktu
a jmenovatel je právě tohle číslo.

Oprava: `ALTER TABLE campaign_stats ADD COLUMN rejected bigint NOT NULL DEFAULT 0` v P03,
plnění v P10 vedle `delivered` a `bounced_*`, odečet v `deliveredEffective` v P14.

### N69. Nad `campaigns.started_at` není index, přestože podle něj filtruje a řadí přehled

- **Našla:** oprava P14
- **Týká se:** P03
- **Závažnost:** nízká v MVP 0, rostoucí s počtem kampaní

`campaigns` má v P03 tři indexy: `idx_campaigns__workspace_status (workspace_id, status, updated_at DESC)`,
`idx_campaigns__scheduler (scheduled_at)` a `idx_campaigns__running (workspace_id)`. Nad
`started_at` žádný.

Přehled projektu podle něj filtruje období (`readTotals`) i řadí poslední kampaně
(`readRecentCampaigns`), a je to nejčastěji otevíraná stránka produktu. Návrh:

```
CREATE INDEX idx_campaigns__ws_started ON campaigns (workspace_id, started_at DESC)
  WHERE deleted_at IS NULL AND started_at IS NOT NULL;
```

### N70. Po slití bloků nejde poznat, jestli je řádek pětiminutový, nebo hodinový

- **Našla:** oprava P14
- **Týká se:** P03 (tabulka), P10 (slévání), P14 (čtení)
- **Závažnost:** nízká, ale vyrábí trvalý falešný poplach v kontrole driftu

`tracking.enforce_retention` v P10 slévá bloky starší třiceti dnů do hodinových: smaže
pětiminutové řádky a vloží hodinové do **téže** tabulky. `campaign_stats_buckets` ale nemá
sloupec, který by granularitu rozlišil, takže z dat samotných nejde poznat, co řádek znamená.

P14 to dnes obchází heuristikou „nejstarší bod je starší než 30 dní", což je dohad podle
téhož pravidla, ne údaj. Návrh: `granularity text NOT NULL DEFAULT '5m'` s pojmenovaným CHECK
a s rozšířeným primárním klíčem.

### N71. Doména P10 leží mimo `packages/core/src/`, kam míří konfigurace testů z P01

- **Našla:** oprava P14 při srovnávání cest s P07 a P13
- **Týká se:** P10
- **Závažnost:** vysoká, testy domény by se nespustily a série by prošla zeleně

`packages/core/vitest.config.ts` z P01 má `include: ['src/**/*.test.ts', 'test/**/*.test.ts']`
a mapa `exports` balíčku má jediné pravidlo `"./*": "./src/*/index.ts"`. P07 i P13 podle toho
píšou do `packages/core/src/<domena>/`. P10 píše do `packages/core/tracking/`, tedy o úroveň
výš: 506 výskytů cesty bez `src/`, nula s ním.

Kód mimo `src/` se nepřeloží pod `@mlain/core/tracking` a jeho testy se **vůbec nespustí**.
Prázdná sada projde zeleně, takže se to nepozná jinak než tímhle srovnáním.

### N72. Testovací harness `@mlain/db` má napříč plány tři různá jména

- **Našla:** oprava P16 při hledání, jak spustit databázový test
- **Týká se:** P03 (vlastník), P07, P10, P16
- **Závažnost:** vysoká, dva z těch tří importů se nikdy nerozřeší

Harness existuje jako `packages/db/test/helpers/container.ts` a vystavuje `startHarness()`,
`type Harness` a `seedTwoWorkspaces(migrator: Pool)`. V mapě `exports` balíčku `@mlain/db`
ale **není žádná podcesta, která by na něj mířila**; jsou tam jen `.`, `./schema`, `./migrate`,
`./partitions`, `./rls` a `./unsafe-context`.

Tři plány si o něj říkají třemi jmény:

| Plán | Import | API, které předpokládá |
|---|---|---|
| P07 | `@mlain/db/test-support` | `startHarness`, `seedTwoWorkspaces`, `Harness` (odpovídá skutečnosti) |
| P10 | `@mlain/db/testing` | `withTestDatabase`, `seedContact`, `seedMessage`, `seedCampaign`, `seedWebEvents` |
| P16 | dřív `@mlain/db/testing` | `startTestPostgres` s vlastními fixtures |

P16 se srovnal na `@mlain/db/test-support` a skutečné API P03 (`startHarness`), protože P07
si tuhle podcestu vyžádal první a jeho tvar sedí s tím, co harness opravdu má. Vlastní fixtures
si P16 postavil ve svém souboru `packages/core/test/support/db.ts` nad tím harnessem, takže
po P03 chce **jen dva řádky v `exports`**, ne nové API.

**P10 zůstává nesrovnaný.** Jeho `withTestDatabase` a čtyři `seed*` funkce v P03 neexistují
pod žádným jménem, takže jeho databázové testy se nenaimportují. Rozhodnout musí P03 jako
vlastník: buď podcestu `./test-support` s dnešním API (pak se srovná P10), nebo bohatší
`./testing` (pak se srovná P07 i P16).

### N73. Osm příkazů `mlain` od P16 nemá v dispatcheru P01 kam dosednout

- **Našla:** oprava P16 při srovnávání tvaru příkazů se skutečným CLI
- **Týká se:** P01 (vlastník `apps/cli/src/{registry,dispatch}.ts`), P16
- **Závažnost:** vysoká, jinak každý provozní příkaz skončí kódem 69

`apps/cli/src/dispatch.ts` z P01 obsluhuje příkazy `switch`em nad jménem a pro příkaz
s `implemented: false` vrací `EXIT_UNAVAILABLE`. Osm příkazů P16 (`genkey`, `backup`,
`restore`, `doctor`, `upgrade`, `rotate-credentials`, `reset-password`, `rebuild-engagement`)
je v registru správně, ale `implemented: false` a v `switch` větev nemají.

P16 do `registry.ts` ani `dispatch.ts` sáhnout nesmí (uzávěr S10). Dodává tedy soubory
v `apps/cli/src/commands/` ve tvaru, který P01 už používá u svých tří příkazů, tedy prostou
funkci `run<Jméno>(streams, argv, env)`, a nechává v `registration.test.ts` červený test,
který na chybějící zapojení ukáže. Po P01 se chce přepnout příznak a doplnit osm větví.

Vedlejší nález: P16 měl příkazy napsané jako objekt `CliCommand` s poli `name`, `implemented`,
`describe` a `run(argv)`. **Takový typ v P01 neexistuje**, registr je samostatný uzavřený výčet
s polem `summary`, ne `describe`. Opraveno na straně P16.

### N74. `jsonb_set` s `create_missing` nevytvoří mezilehlý objekt, a tiše nic neudělá

- **Našla:** oprava P16, ověřeno spuštěním proti PostgreSQL 18
- **Týká se:** každý plán, který zapisuje do vnořené cesty v jsonb sloupci
- **Závažnost:** střední, ale porucha je zcela tichá

Naměřeno:

```sql
SELECT jsonb_set('{}'::jsonb, '{onboarding,hidden}', to_jsonb(true), true);  -- {}
SELECT jsonb_set('{"onboarding":{}}'::jsonb, '{onboarding,hidden}', to_jsonb(true), true);
-- {"onboarding": {"hidden": true}}
```

Čtvrtý argument `create_missing` vytvoří **jen poslední klíč cesty**, ne mezilehlé objekty.
Na čerstvém projektu, kde je `settings` prázdný objekt, tedy UPDATE proběhne, ovlivní jeden
řádek, vrátí nulový kód a hodnotu neuloží. V P16 to bylo skrytí panelu onboardingu: uživatel
panel skryje, po načtení stránky se vrátí, nikde není chyba.

Správný tvar sloučí podobjekt operátorem `||` a chybějící mezistupeň nahradí prázdným objektem:

```sql
jsonb_set(settings, '{onboarding}',
          coalesce(settings -> 'onboarding', '{}'::jsonb) || '{"hidden":true}'::jsonb, true)
```

Ověřeno, že zachová sourozence i uvnitř `onboarding`. **Jednoúrovňová cesta problém nemá**,
takže `jsonb_set(settings, '{demoData}', ..., true)` je v pořádku. Opraveno na straně P16;
ostatní plány, které do vnořeného jsonb zapisují, si to mají zkontrolovat.

### N75. `pg_dump` pod rolí s RLS nevyrábí tichou prázdnou zálohu, ale padá; tichá je až „oprava"

- **Našla:** oprava P16, ověřeno spuštěním proti PostgreSQL 18
- **Týká se:** P16 (záloha), P01 (role `mlain_backup` v `docker/initdb`), doplňuje N7
- **Závažnost:** střední, mění to navrženou obranu, ne její potřebu

Nález N7 tvrdil, že `pg_dump` pod rolí, na kterou platí RLS, vyrobí bezvadný dump s nula
řádky. Naměřený stav je jiný:

| Role | Přepínač | Výsledek |
|---|---|---|
| `mlain_backup` (`pg_read_all_data`) | žádný | **exit 1**, `ERROR: query would be affected by row-level security policy` |
| `mlain_backup` | `--enable-row-security` | **exit 0, chráněné tabulky prázdné** |
| `mlain_migrator` (vlastní schéma) | žádný | exit 0, data kompletní |

`pg_dump` sám posílá `SET row_security = off` a server dotaz odmítne. Praktický dopad: pod
`mlain_backup` by noční záloha **padala každou noc** s hláškou, ze které provozovatel nepozná,
co dělat. Tichá prázdná záloha vznikne teprve tehdy, když někdo tu chybu „opraví" dopsáním
`--enable-row-security`, což je realistické, protože přepínač se tak jmenuje.

P16 kvůli tomu drží obojí: pojistku před během, která chybu nahradí návodem, a test, který
skutečně spustí `pg_dump` s tím přepínačem a ověří, že dump je prázdný. Zůstává otevřená
otázka pro P01: **role `mlain_backup` je po tomhle bez použití.** Buď jí `docker/initdb` dá
`BYPASSRLS` (vyžaduje superuživatele) a záloha pojede pod ní, což je bezpečnější než pod
migrátorem, nebo se role zruší, ať ve schématu neleží mrtvý objekt, který svádí k použití.

### N76. Rotace klíče musí znát projekt každého řádku, protože obálka je na něj vázaná

- **Našla:** oprava P16 při srovnávání s kontraktem P02
- **Týká se:** P16 (rotace), P13 a P15 (kdo obálky zapisuje)
- **Závažnost:** vysoká pro rotaci, jinak informativní

`encryptEnvelope` a `decryptEnvelope` z `@mlain/contracts/crypto` berou **povinné
`workspaceId`**, které vstupuje do AAD. Dešifrování s jiným projektem selže. `mlain
rotate-credentials` proto musí u každého řádku číst i `workspace_id`, ne jen primární klíč;
jinak by u prvního projektu uspěl a u zbytku hlásil poškozená data. Opraveno na straně P16
a doplněn test se dvěma projekty, protože nad jedním projektem ta chyba neprojde.

Dva vedlejší poznatky téhož srovnání, oba opravené v P16:
`parseKeyring` bere jeden objekt `{ secretKey, secretKeyPrevious }`, ne dva poziční argumenty,
a `secretKeyFingerprint(master)` si odvození klíče dělá sama. Zavolat ji s už odvozeným klíčem
se přeloží, nespadne a **vrátí tiše jiný otisk** (ověřeno: `VXGoNjoPSBY` proti `5P_j-3XY714`),
kterým by `mlain doctor` hlásil kritickou neshodu klíče u instalace, které nic není.

Kontext `inbound_secret` v `CREDENTIAL_CONTEXTS` **neexistuje**; výčet má čtyři hodnoty
(`sending_provider`, `ai_provider`, `webhook_secret`, `oauth_token`). P16 pro
`inbound_endpoints.secret_encrypted` používá `webhook_secret`. Pokud P07 jako vlastník té
tabulky šifruje jiným kontextem, je to nález proti P07, ne důvod zavádět pátý kontext.

### N77. Prefix `demo-data:` žije na dvou místech, přestože konvenci vlastní P16

- **Našla:** oprava P16 při ověřování napojení P13 na manifest
- **Týká se:** P13 (drobná změna), P16 (hotovo)
- **Závažnost:** nízká dnes, vysoká při první změně konvence

P13 správně importuje `DEMO_SOURCE_REF` a `parseDemoManifest` z `@mlain/core/demo`
a nic si neopisuje. Jednu konstantu ale má vlastní:

```ts
// packages/core/src/campaigns/audience/sample-guard.ts, P13
export const SAMPLE_SOURCE_REF_PATTERN = 'demo-data:%';
```

Prefix `demo-data:` tím existuje dvakrát: v `DEMO_SOURCE_REF = 'demo-data:v1'` u P16
a v tomhle vzoru u P13. Dokud se konvence nemění, funguje obojí. Při první změně
(třeba na `sample-data:`) by se rozešly a **ochrana by tiše přestala platit**: dotaz
by proběhl, nikoho nevyloučil a ukázkové kontakty by se dostaly do publika kampaně.
Je to táž třída chyby, kterou P13 sám u sebe zavřel u `DEMO_SOURCE_REF`.

**P16 to vyřešil na své straně** a vyváží z `@mlain/core/demo` obojí:

```ts
export const DEMO_SOURCE_REF_PREFIX = 'demo-data:';
export const DEMO_SOURCE_REF = `${DEMO_SOURCE_REF_PREFIX}v1`;
export const DEMO_SOURCE_REF_PATTERN = `${DEMO_SOURCE_REF_PREFIX}%`;
```

Po P13 se chce jediná změna: nahradit vlastní konstantu importem
`DEMO_SOURCE_REF_PATTERN` z `@mlain/core/demo`. Test v P16
(`dataset.test.ts`, blok „konvence source_ref") hlídá, že vzor chytí i budoucí
pokolení sady a nechytí cizí značky.

Ověřeno spuštěním proti PostgreSQL 18, že společná konvence dělá to, co P13 potřebuje:
vzor `demo-data:%` vyloučí `v1`, `v2` i `v10`; filtr jen podle značky propustí ukázkový
kontakt s přepsaným `source_ref` (reprodukce nálezu P13 v miniatuře); značka a manifest
dohromady ho zachytí; a `NOT (id = ANY(ARRAY[]::uuid[]))` nad prázdným manifestem
nespadne a nikoho nevyloučí.

## Uzavřené

### U4. Osiřelý balíček `packages/sdk-node`

- **Našel:** podagent recenze P05 při ověřování požadavků na P04
- **Uzavřeno:** 2026-08-01 rozhodnutím hlavního agenta
- **Rozhodnutí: `sdk-node` není v MVP 0. P01 nechá manifest, obsah nikdo nepíše.**

P01 balíček zakládá a v tabulce vlastnictví ho předává P04 jako „API klient". **P04 o něm nemá
ani řádek** a nemá ho ani v seznamu toho, čeho se nedotýká. Balíček by tedy zůstal prázdný
a nikdo by se k němu nehlásil.

Je to díra v řídicím dokumentu dělení, ne chyba autorů. V zadání P04 jsem `sdk-node` vůbec
neuvedl, ani jako vlastnictví, ani jako vyloučení.

Rozhodnutí: **nedoplňovat práci, ale rozsah.** Zlatá cesta MVP 0 klienta pro Node nepotřebuje,
je to materiál pro MVP 1 spolu s kompletním veřejným API. Prázdný manifest je v pořádku,
protože akceptační kritérium žádá jen to, aby všech devět balíčků existovalo.

Do řídicího dokumentu doplnit, že `sdk-node` je vědomě prázdný, a do P04 větu, že se ho
nedotýká. Bez toho by si to za měsíc někdo vyložil jako opomenutí a začal ho psát.

### Tři nálezy z téhož ověření, které patří do fáze 2 a nejsou moje

P05 očekává od P04 tři věci, které P04 nedodává. Nejsou tady rozepsané, protože je nese
recenze P05, až doběhne. Ve zkratce: endpoint a napojení Centra úloh na frontu jobů,
stránka detailu úlohy, a rozšířený tvar chyby `forbidden` o to, kdo oprávnění udělit může.
Poslední z nich je nejzajímavější: komentář v P04 slibuje, že „u `forbidden` má klient
požádat kolegu o vyšší roli", ale chyba nenese data, podle kterých by šlo kolegu najít.

### U3. Dvojí nárok na frontu ke kontrole oslovení

- **Našel:** P11 (import a segmenty), zapsáno i v jeho kapitole 13 jako rozpor 11
- **Uzavřeno:** 2026-08-01 rozhodnutím hlavního agenta
- **Rozhodnutí: frontu vlastní P07**, včetně modulu, jobu, obou rout a obrazovky.

Obě strany měly oporu v řídicím dokumentu, který u P07 uvádí „vokativ" a u P11 „fronta
ke kontrole oslovení je součást importu". Rozpor vznikl mou nepřesností, ne chybou agentů.

Rozhoduje tohle: **vokativ se počítá při zápisu kontaktu, ne při odeslání.** Nejisté případy
tedy vznikají u každého zápisu, ne jen při importu, konkrétně i přes API, z formuláře na webu
a z příchozího webhooku. Ty tři cesty vlastní P07. Kdyby frontu vlastnil import, neměly by do ní
čím zapsat a nejistá jména z nich by se tiše uhodla, což je přesně ten výsledek, kterému se
celý vokativ vyhýbá.

P11 to má napsané obranně: do rozhodnutí se neprovádějí úkoly 37, 38 a 53. **Tyhle tři úkoly
z P11 vypadávají**, zbylých 57 se nemění. P07 si frontu už nárokuje, takže na jeho straně
není co měnit.

Umístění adresáře je vedlejší. P11 argumentoval, že `import/vocative-review/` řekne čtenáři,
odkud fronta pochází. To je pravda jen pro jeden ze čtyř zdrojů, takže složka patří pod
`contacts/naming/`, kde už P07 vlastní `resolveName()` a výpočet vokativu.

### U1. `middleware.ts` versus `proxy.ts`

- **Našel:** P05
- **Uzavřeno:** 2026-08-01, opraveno v řídicím dokumentu, seam S6 i zadání P05

Next.js 16 přejmenoval `middleware.ts` na `proxy.ts` a exportovanou funkci na `proxy`.
Řídicí dokument dělení uváděl starý název. Specifikace to má správně na čtyřech místech,
chyba byla na straně řídicího dokumentu.

### U2. Zbytek starého názvu produktu v příkazu CLI

- **Našel:** hlavní agent při přípravě dělení
- **Uzavřeno:** 2026-07-31, opraveno na `mlain upgrade`

Kontrola v `STAV.md` hledala celé slovo starého názvu, takže minula **zkratku CLI**.
Na dvou místech zůstalo `oe upgrade`, zatímco všech deset ostatních příkazů má tvar
`mlain <příkaz>`. Poučení: u přejmenování se musí hledat i každá zkratka a odvozenina
(prefix env proměnných, scope balíčků, jméno CLI), ne jen název sám.

---

## Nálezy z implementace, vlna 0

### I1. ESLint v repu nikdy neběžel: `typescript-eslint` neumí TypeScript 7.0

- **Našel:** hlavní agent při ověřování P01
- **Uzavřeno:** 2026-08-01, TypeScript sjednocený na 5.9.3

P01 pinuje TypeScript 7.0.2. `typescript-eslint` 8.x ho odmítá s hláškou
„typescript-eslint does not support TS 7.0" a padá **dřív, než načte pravidla**.
`pnpm lint` přesto vracel nulu, protože chyba spadla mimo řetěz `oxlint && eslint && prettier`.

Je to nejhorší podoba problému, který se v tomhle projektu opakuje: ochrana existuje,
vypadá funkčně, a nespustí se. Po opravě lint napoprvé našel 46 skutečných chyb.

Oprava má dvě části a **obě jsou potřeba**:
1. `overrides: { typescript: 5.9.3 }` v `pnpm-workspace.yaml` (pnpm 10 už nečte `pnpm.overrides`
   z kořenového `package.json`).
2. `typescript` jako výslovná devDependency v `packages/config`. Bez ní si pnpm dotáhne
   pro peer závislost nejvyšší vydanou verzi, tedy zase 7.0.2, a lint spadne jen v tom
   jednom balíčku.

Verze 5.9.3 je fallback, se kterým P01 počítá v otevřené otázce O4.

### I2. `config.schema.json` neodpovídá tvaru manifestu konfigurace

- **Našel:** P02
- **Stav:** otevřené

Schéma z P02 popisuje pole `name`, `type`, `required`, `default`, `consumers`.
Skutečný `packages/core/src/config/config.manifest.json` od P01 má `name`, `optional`,
`hasDefault`. Dnes nic nepadá, protože `config.json` se proti schématu nevaliduje,
schéma se jen načte. Tedy zase brána, která existuje a nic neměří.

Rozhodnout, kdo soubor vlastní, a doplnit validaci, jinak se rozchod nikdy neprojeví.

### I3. Dvě skupiny testů čekají na cizí plán a jsou zaparkované pod `.pending`

- **Našel:** P02
- **Stav:** otevřené, k dokončení po P03 a P09

- `packages/contracts/test/db/*.test.ts.pending`: scénáře `OB-xx` a test kontraktních sloupců
  potřebují `test/db/helpers.ts` z úkolu 2 P02, který stojí na schématu z P03.
- Go runnery kontraktů čekají na produkční balíčky z P09 podle rozhodnutí R1.

Přípona `.pending` je mimo vzory vitestu i tsconfigu, takže typecheck zůstává zelený.
**Pozor:** zaparkovaný test je test, který neběží. Musí se přejmenovat zpět, jinak
zůstane napsaný a k ničemu, což je přesně vzor, před kterým plány varují.

### I4. P04 uvádí cesty v `packages/core` bez adresáře `src`

- **Našel:** hlavní agent při zahájení P04
- **Uzavřeno:** 2026-08-01, platí skutečný stav z P01

P04 vypisuje ve svém seznamu vlastnictví cesty tvaru `packages/core/identity/password.ts`
a `packages/core/tx/index.ts`. Balíček, který skutečně založil P01, má ale všechno pod
`packages/core/src/<domena>/` a jeho exports mapa zní `"./*": "./src/*/index.ts"`.

Doslovné provedení P04 by vyrobilo druhý strom vedle prvního, na který by exports mapa
nedosáhla, takže by `@mlain/core/identity` ukazoval na prázdno a nikdo by si toho nevšiml
až do prvního importu z cizího balíčku.

Platí skutečný stav: `packages/core/src/`. Týká se to i plánů, které po P04 čtou
(`P06`, `P07`, `P10`, `P13`, `P14`, `P15`), takže se stejná oprava musí zapracovat i tam.

### I5. Test RLS, který nikdy nechytí porušení

- **Našel:** P03 při psaní transakční vrstvy, naměřeno spuštěním
- **Uzavřeno:** 2026-08-01, opraveno ve všech testech P03

Plán P03 ověřuje porušení RLS přes `.rejects.toThrow(/row-level security/i)` nad `tx.execute`.
**Nikdy se to neshodne.** Chyba z Drizzle je `DrizzleQueryError`, jejíž `message` je jen
„Failed query: INSERT ...", zatímco text z databáze leží na `cause.message`. Naměřeno:

```
message="Failed query: INSERT INTO tags (workspace_id, name) VALUES ($1, 'bez-kontextu')..."
pgErrorCode=42501
cause.message="new row violates row-level security policy for table \"tags\""
```

Takový test projde i nad tabulkou, kterou RLS vůbec nechrání. Je to tatáž past jako
rozhodnutí R35, jen o úroveň vedle: R35 řeší čtení kódu chyby v produkčním kódu,
tohle je totéž v testech. Správný tvar je `pgErrorCode(error) === '42501'` plus kontrola
`cause.message`.

Platí pro každý plán, který testuje RLS nebo jakoukoli chybu z databáze skrz Drizzle.

### I6. `moduleResolution` se v repu rozcházel a shodil build webu

- **Našel:** P01 a P05 nezávisle
- **Uzavřeno:** 2026-08-01, workspace sjednocený na `Bundler`

Sdílený preset `tsconfig/base.json` měl `NodeNext`, takže relativní importy musely nést
příponu `.js`. Preset `tsconfig/next.json`, ze kterého dědí `apps/web`, měl ale `Bundler`,
kde Turbopack příponu `.js` na zdrojový `.ts` nepřekládá. `next build` padal na třinácti
chybách „Module not found" a s ním i `docker build`.

Rozhodnutí: celý workspace jede na `Bundler`. V tomhle repu se všechno bundluje, web přes
Turbopack, worker a CLI přes esbuild, testy přes vite. NodeNext by dával smysl u balíčku
publikovaného do registru, tady jen vynucoval přípony, které jeden ze čtyř nástrojů neumí.

### I7. `packages/db/src/index.ts` neměl vlastníka a blokoval P04

- **Našel:** P04 a P03 nezávisle
- **Uzavřeno:** 2026-08-01, dodělal Task 30 P03

Task 30 P03 zakládá vstupní bod balíčku, ale v rozpisu paralelních prací na něj nikdo
nedosáhl: agent od schématu ho měl zakázaný, agent od klienta taky. P04 na něm přitom stojí.
Poučení: soubor, který skládá práci víc agentů, potřebuje výslovného vlastníka i v rozpisu
paralelizace, ne jen v plánu.

### I8. Rozjeté `@types/pg` vyrobilo dvě instance Drizzle s nekompatibilními typy

- **Našel:** P04
- **Uzavřeno:** 2026-08-01, verze sjednocená na `8.15.6` ve všech čtyřech manifestech

`packages/core`, `packages/db` a `apps/web` pinovaly `@types/pg` na `8.15.6`,
`packages/contracts` měl `^8.15.0`, což se rozresolvovalo na `8.20.3`. Protože je
`@types/pg` peer závislost Drizzle, držel pnpm **dvě instance `drizzle-orm`**
s nekompatibilními typy a `tsc` padal na volání `eq()` v cizím balíčku.

Projev je zavádějící: chyba se ukáže v souboru, který s kontrakty nemá nic společného.
Poučení: u balíčku, který je peer závislostí něčeho dalšího, se verze pinuje přesně
a stejně ve všech manifestech. Caret rozsah u peer závislosti je tichý rozkol.

### I9. P04 předpokládá u P01 rozhraní, která P01 nemá

- **Našel:** P04
- **Uzavřeno:** 2026-08-01, platí skutečný stav z P01

Tři místa, kde plán P04 volá něco, co P01 nevystavuje:

| P04 volá | P01 skutečně má |
|---|---|
| `import { config } from '@mlain/core/config'` | jen `loadConfig()`, žádnou hotovou instanci |
| `QUEUES` z `@mlain/core/queues` | `QUEUE_REGISTRY` a funkci `queue(name)` |
| exports vzor `"./*/*": "./src/*/*.ts"` | Node umí jen JEDEN `*` na vzor, nahrazeno výčtem podcest |

Ten třetí je nejzrádnější: vzor se dvěma hvězdičkami se nerozresolvuje a import
`@mlain/core/identity/password` by tiše selhal až za běhu. Platí explicitní výčet
`./audit/*`, `./errors/*`, `./identity/*`, `./net/*`, `./platform/*`, `./test-support/*`, `./tx/*`.

### I10. Vitest přepisuje `MODE` a shodí tím `loadConfig()` v každém testu

- **Našel:** P04, naměřeno spuštěním, nezávisle přeměřeno hlavním agentem
- **Uzavřeno:** 2026-08-01, opraveno ve sdíleném presetu i v obou vlastních konfiguracích

`MODE` je ve Vite jméno režimu, takže si ho vitest zapisuje do `process.env.MODE`
s hodnotou `"test"`. Konfigurační schéma P01 ale `MODE` používá jako přepínač procesu
s výčtem `web`, `worker`, `sender`, `all`. Důsledek: `loadConfig()` spadne v každém testu,
který se konfigurace dotkne, **a to i když se `MODE` do prostředí výslovně předá.**

Naměřeno: `MODE=web pnpm exec vitest run` vidí uvnitř testu `MODE === "test"`.

Zrádné je, že se to tváří jako chyba v konfiguraci, ne v testovacím běhu, takže první
reakce je hledat vadu ve schématu. Obejít se to dá přiřazením za běhu uvnitř testu,
ale to musí udělat každý plán znovu a každý na to musí nejdřív přijít.

Oprava je jeden řádek `env: { MODE: process.env.MODE ?? 'web' }` v `packages/config/vitest/node.ts`,
`packages/core/vitest.config.ts` a `apps/web/vitest.config.ts`.

### I11. Turbopack si v monorepu odvodí špatný kořen a spadne panikou

- **Našel:** hlavní agent při spuštění aplikace
- **Uzavřeno:** 2026-08-01, `turbopack.root` nastavený výslovně

Dev server běžel, obsluhoval health endpointy, a v okamžiku, kdy pod `apps/web/src/app`
přibyl nový adresář, Turbopack si odvodil kořen workspace jako `apps/web/src/app`,
odkud `next/package.json` nedohledá. Neprojeví se to chybou v kódu ani hláškou u routy,
ale **panikou celého Turbopacku a pádem serveru**.

V monorepu se `turbopack.root` nastavuje výslovně, stejně jako `outputFileTracingRoot`,
který tam pro produkční build už byl.

### I12. `test:db` v `packages/core` a `apps/web` nemá kdo dodat

- **Našel:** P04
- **Stav:** obejito, systémové řešení otevřené

Plán P04 předepisuje `pnpm --filter @mlain/core test:db` i `--filter @mlain/web test:db`,
ale ani jeden balíček ten skript nemá a `vitest.config.ts` obou vlastní P01, který o něm neví.
P04 to obešel vlastním harnessem `packages/core/src/test-support/pg-harness.ts`, který
si nastartuje kontejner, založí role a pustí migrace, takže databázové testy běží
v obyčejném `vitest run`.

Funguje to, ale znamená to, že CI job `test-db` nad těmi dvěma balíčky **nic nespustí**,
protože turbo přeskočí balíček bez skriptu. Tedy zase brána, která existuje a neměří.

### I13. Regresi v RLS politice nezachytila sada, která ji měla hlídat

- **Našel:** P04 (vadu), P03 (díru v pokrytí)
- **Uzavřeno:** 2026-08-01, politika opravená, doplněný regresní test

Politice `ws_member_visibility` na `workspaces` chyběla stráž, že workspace kontext
není nastavený. Pod kontextem projektu B tak aktér viděl i projekt A.

Důležitější než ta vada je tohle: **proti verzi bez stráže prošlo všech 98 testů
`packages/db` zeleně.** Nebyla to náhoda. Všechny cesty k `workspaces` v té sadě vedly
přes `withUser`, tedy bez workspace kontextu, takže na chybnou větev nedosáhl ani jeden test.
Chybu odhalily až testy o vrstvu výš, v `packages/core`.

Přesně ten stav, před kterým plán varuje v kapitole 0: ochrana, jejíž porušení nic
nezachytí automaticky. Doplněný test byl ověřený tak, že proti politice bez stráže
**skutečně spadne**, ne jen že je zelený.

Poučení pro každý test izolace: musí existovat případ pro `withWorkspace` s aktérem,
který je členem víc projektů. Bez něj se testuje jen ta jednodušší polovina.

### I14. Chybí politiky RLS pro `api_keys` a `invitations`

- **Našel:** P04
- **Rozhodnuto:** 2026-08-01 hlavním agentem, politiky se doplňují

Migrace 0004 je nemá. Důsledek by byl tichý a zlý: každý požadavek
s `Authorization: Bearer ml_live_...` by vrátil `unauthenticated` a `acceptInvitation`
by vždy vrátilo 404. Ani jedno by nespadlo hlasitě, obojí by vypadalo jako správné
odmítnutí.

Námitka byla, že se tím počet politik zvedne nad 80, což je číslo zapsané v plánu
na několika místech. **Číslo v plánu ustupuje funkčnosti.** Politiky se doplní a počet
se přepočítá skriptem podle `pg_policies`, ne odhadem. Plán se opraví, ne obchází.

### I15. Uzávěr S11 zakazoval soubor, který jiný plán vyžaduje

- **Našel:** hlavní agent při ověřování série
- **Rozhodnuto:** 2026-08-01, úzká vyjmenovaná výjimka pro `@mlain/db`

Test integrity workspace z P01 vynucuje uzávěr S11 „žádný balíček nemá top level barrel".
Task 30 plánu P03 ale zakládá `packages/db/src/index.ts` jako vstupní bod balíčku a P04
z něj importuje. Dva plány si tedy protiřečily a série byla červená.

Rozhodnutí vychází z **důvodu** uzávěru, ne z jeho znění. S11 zakazuje barrely proto,
že barrel je sdílený soubor s jedním řádkem na doménu, tedy merge konflikt v každém plánu,
který doménu přidává. To sedí na `@mlain/core`, do kterého píše osm plánů. Nesedí na
`@mlain/db`, který celý vlastní jediný plán, jehož vstupní bod s doménami neroste
a je kurátorovaný, ne generovaný.

Výjimka je proto **úzká a doprovázená druhým testem**: vstupní bod `@mlain/db` nesmí
reexportovat `schema` (rozhodnutí R37, jinak vzniknou dvě rovnocenné cesty k témuž)
ani `unsafeWorkspaceContext` (obchází izolaci projektů a musí se importovat vědomě).
Kontrola odstraňuje komentáře, než hledá, jinak by si chytila vysvětlení v hlavičce souboru.

Test byl ověřený tak, že **skutečně diskriminuje**: po doplnění `export * as schema`
spadne, po vrácení projde. Výjimka bez takového testu by byla jen dírou v ochraně.

### I16. `\s` v regexu přeskočilo konec řádku a rozbilo dva kontraktní dotazy

- **Našel:** hlavní agent při ověřování brány `OB-00`
- **Uzavřeno:** 2026-08-01, `\s*` nahrazeno `[ \t]*`

Loader normativních dotazů četl hlavičku regexem `/^--\s*params:\s*(.*)$/m`.
Znak `\s` ale **zahrnuje konec řádku**, takže u prázdné hlavičky přeskočil na další
řádek a jako hodnotu sebral jeho obsah. Ze souboru

```
-- params:
-- args:
SELECT c.id
FROM campaigns c
```

vznikl příkaz `PREPARE jmeno (-- args:) AS SELECT c.id`, kde komentář sežral zbytek
řádku, a databáze ohlásila `syntax error at or near "FROM"`.

Dvě věci na tom stojí za zapamatování:

1. **Chyba ukazovala na SQL, přestože SQL bylo v pořádku.** Dotaz spuštěný ručně
   v psql prošel. Bez porovnání skutečně odeslaného příkazu by se hledalo v kontraktu.
2. **Devět z jedenácti dotazů vadu zamaskovalo**, protože mají parametry, takže se
   hlavička nikdy nečetla přes konec řádku. Selhaly právě ty dva bez parametrů.

Poučení: `\s*(.*)$` je při čtení řádkových hlaviček past. Správně je `[ \t]*`.

### I17. Přísná CSP zabila hydrataci a v dev režimu nefungovalo vůbec nic

- **Našel:** P05 (příznak), hlavní agent (příčinu)
- **Rozhodnuto:** 2026-08-01 zadavatelem, výjimka výhradně pro vývoj

Příznak byl nejhorší možný: stránka se vykreslila správně, se všemi styly
a správnou strukturou pro čtečku obrazovky, ale **žádné tlačítko nefungovalo**.
Klientská hydratace vůbec neproběhla, v DOM nebyl ani jeden React fiber.
Automatické testy přístupnosti nad statickou strukturou přitom prošly, protože
ty na interaktivitu nesahají.

První diagnóza mířila na nonce v CSP a byla mylná. Přeměřeno: nonce v hlavičce
a nonce na všech 34 skriptech se shodovaly.

Skutečná příčina byla v jediném řádku konzole, který o CSP vůbec nemluvil:

```
eval() is not supported in this environment.
React requires eval() in development mode for various debugging features.
React will never use eval() in production mode
```

Vývojový build Reactu vyhodnocuje kód za běhu kvůli ladicím funkcím.
`script-src 'self' 'nonce-...'` to zablokuje. Produkční build to nedělá.

Oprava je uvolnění **výhradně pro vývoj**, produkční CSP zůstává beze změny.
Varianta „v devu CSP vůbec neposílat" byla zamítnutá, protože zhoršuje paritu
mezi vývojem a produkcí: porušení pravidla by se poznalo až po nasazení.

Poučení: hlášku v konzoli je potřeba přečíst celou, i když nezmiňuje vrstvu,
ve které vada je. A test přístupnosti nad statickou strukturou není důkaz,
že stránka funguje.

### I18. Proxy odbavovala `/api/v1/**` přesměrováním na přihlašovací stránku

- **Našel:** hlavní agent při prvním volání namontovaného API
- **Uzavřeno:** 2026-08-01, `/api/v1/` doplněno mezi veřejné prefixy

`PUBLIC_PREFIXES` v `proxy.ts` obsahoval trackovací cesty, příchozí webhooky
a health, ale ne veřejné API. Nepřihlášený požadavek na `/api/v1/auth/me` proto
dostal **307 na `/login`**, tedy HTML stránku, místo 401 v obálce Problem Details.

Důsledky jsou dva a oba jsou tiché:
- `fetch` přesměrování mlčky následuje, takže klient dostane HTML a pokusí se ho
  zpracovat jako JSON. Projeví se to jako nesrozumitelná chyba parsování daleko
  od příčiny, ne jako „nejsi přihlášený".
- Přihlašovací formulář by neměl kam poslat požadavek, protože i
  `POST /api/v1/auth/login` je z definice nepřihlášený.

Přihlášení si veřejné API řeší samo, middlewarem `authenticate` z P04.

### I19. Vstupní bod `@mlain/db` tahal migrační runner do bundlu webu

- **Našel:** hlavní agent při prvním volání namontovaného API
- **Uzavřeno:** 2026-08-01, `migrate` se z kořene nereexportuje

`packages/db/src/index.ts` reexportoval `runMigrations`. Tím se runner dostal do
bundlu **každého** konzumenta `@mlain/db`, tedy i do Next.js aplikace přes řetěz
`route.ts -> openapi.ts -> *.routes.ts -> core/tx -> db`.

Runner si skládá cestu k adresáři s migracemi přes `new URL('../migrations', import.meta.url)`,
což bundler neumí přeložit, a celé `/api/v1/**` skončilo chybou
„Module not found: Can't resolve '../migrations'".

Nejdůležitější na tom je, **kdy se to projevilo**: až při prvním skutečném
požadavku z prohlížeče. Typecheck i všech 2 128 testů byly zelené, protože ty
runner načítají v Node, ne přes bundler. Rozdíl mezi „modul jde načíst v Node"
a „modul jde zabalit" žádný z testů neměří.

Migrační runner je nástroj CLI. Importuje se podcestou `@mlain/db/migrate`,
stejně jako se schéma importuje podcestou `@mlain/db/schema` (rozhodnutí R37).

### I20. Soubor na rozhraní dvou plánů opakovaně neměl vlastníka

- **Našel:** hlavní agent, třikrát během jednoho dne
- **Poučení pro každý další rozpis paralelizace**

Třikrát se stalo totéž a pokaždé to zastavilo práci:

| Soubor | Kdo ho čekal | Kdo si myslel, že ho nedělá |
|---|---|---|
| `packages/db/src/index.ts` | P04, stálo na něm celé jádro API | oba agenti P03, každý ho měl zakázaný |
| `apps/web/src/app/api/v1/[[...route]]/route.ts` | přihlašovací formulář | nikdo, mount byl poslední úkol P04 a nikdo ho nedostal |
| `apps/sender/internal/contracts/golden.go` | P09, Task 7 | P02, protože dostal jen úkol 1 |

Plán ten soubor pokaždé popisoval správně. Chyba byla v **rozpisu paralelních prací**:
když se plán rozřeže na agenty po úkolech, soubor, který skládá výsledky víc úkolů,
propadne mezi nimi. Každý agent má zakázáno sahat mimo své úkoly, takže se ho nedotkne
ani ten, komu je nejblíž.

Pravidlo do příště: **u každého rozřezání plánu se musí výslovně přidělit soubory,
které skládají výstup víc úkolů.** Vlastnictví v plánu nestačí, potřebuje ho i rozpis.
Poznat se to dá jednoduše: je to soubor, který jmenuje víc úkolů, ale nezakládá ho
ani jeden z nich.

### I21. Přihlášení se tvářilo úspěšně, ale relaci nepropsalo do prohlížeče

- **Našel:** hlavní agent při ručním průchodu přihlašovací obrazovkou
- **Předáno vlastníkovi P06**

Naměřeno v prohlížeči: po vyplnění formuláře a kliknutí se adresa změnila
na `/w/preflight-projekt`, tedy akce se tvářila úspěšně a přesměrovala.
Obsah stránky ale zůstal přihlašovací formulář a další navigace vyhodila
zpátky na `/login`. V prohlížeči byla jediná cookie `NEXT_LOCALE`.

Přes API přitom všechno funguje: `POST /api/v1/auth/login` vrátí 200
s uživatelem a projekty, `GET /api/v1/auth/me` vrátí členství se slugem.

Příčina: serverová akce ani `apiMutate` se cookies vůbec nedotýkají.
API relaci vytvoří a vrátí v hlavičce `Set-Cookie`, ale akce zahodí hlavičky
odpovědi. Uživatel je tedy „přihlášený" jen zdánlivě.

Dvě věci k zapamatování:
- **Screenshot ani unit test to nechytí.** Formulář vypadá správně, akce vrátí
  úspěch, přesměrování proběhne. Vada je viditelná až při DRUHÉM požadavku.
- Při propisování se musí použít `response.headers.getSetCookie()`, ne
  `get('set-cookie')`. Druhý slepí víc hlaviček do jednoho řetězce a atributy
  se rozpadnou.

### I22. Stráž hlásila jako porušení soubor, který plán předepisuje

- **Našel:** P02, ověřeno a opraveno hlavním agentem
- **Uzavřeno:** 2026-08-01

Go stráž měla podmínku `HasPrefix(name, "golden_") && HasSuffix(name, "_test.go")`,
která má chytat runnery P09 v cizím balíčku. Chytala ale i `golden_test.go`,
tedy soubor, který plán P02 přímo předepisuje.

Důvod je aritmetický a je snadné ho přehlédnout: prefix má 7 znaků, suffix 8,
dohromady 15, jenže `golden_test.go` má znaků jen 14. Obě podmínky proto platí
naráz nad **jedním podtržítkem, které si prefix se suffixem sdílejí**.

Poučení: u dvojice prefix a suffix nad krátkým jménem se musí ověřit, že se
nepřekrývají, jinak podmínka platí i tam, kde platit nemá.

### I23. Relační cookie měla dvě různá jména a nikdo to nemohl poznat

- **Našel:** hlavní agent při ručním průchodu přihlášením
- **Uzavřeno:** 2026-08-01, jméno má jedinou definici

Po opravě propisování cookie (nález I21) přihlášení pořád nefungovalo. Příčina:

| Kdo | Jméno |
|---|---|
| `packages/core/src/identity/session.ts` (P04, nastavuje cookie) | `ml_session` |
| `apps/web/src/proxy.ts` (P05, kontroluje ji) | `mlain_session` |

Obě strany měly jméno napsané **natvrdo**. API cookie správně vytvořilo, prohlížeč
ji správně uložil, a proxy ji přesto neviděla, takže každé kliknutí vyhodilo
uživatele zpátky na přihlašovací stránku. Nespadlo přitom vůbec nic: ani jedna
strana nemohla poznat, že se ptá na něco jiného, než co ta druhá zapisuje.

Zrádné je, že špatné jméno bylo i ve **třech testovacích souborech**, které si
falešnou cookie nastavují, aby obešly proxy: `playwright.config.ts`, `proxy.test.ts`
a jeden e2e scénář. Ty by tedy neměřily nic a chyba by se přes ně nikdy neprojevila.

Oprava není jen srovnání hodnoty. Jméno je teď v listovém modulu
`packages/core/src/identity/cookie.ts` bez jediného importu, protože `session.ts`
tahá drizzle, schéma i konfiguraci a jeho importem do proxy by se do bundlu vtáhla
celá datová vrstva. To je přesně chyba, kterou projekt zaplatil u migračního runneru
(nález I19), takže se neopakuje.

### I24. Kontrola slovníku hlásila deset planých porušení na jedno skutečné

- **Našel:** hlavní agent při ověřování série
- **Uzavřeno:** 2026-08-01, kontrola porovnává hranice slov

Kontrola zakázaných výrazů porovnávala čistý podřetězec a k tomu tolerovala
koncovku, protože čeština skloňuje a term „slučovací značka" musí najít
i tvar „slučovací značku".

Nad anglickým katalogem to ale znamenalo dvě věci naráz:

1. Term `subscribed` se chytal uvnitř slov `unsubscribed` a `resubscribe`,
   tedy uvnitř výrazů, které znamenají PRAVÝ OPAK zakázaného stavu.
2. Tolerance koncovky zkrátila term na `subscribe` a ten se chytil v každé větě
   typu „people subscribe to a list", tedy v úplně běžném slovese.

Naměřeno: 21 hlášených porušení, z toho **jedno skutečné**.

Kontrola, která hlásí dvacet planých poplachů na jeden nález, se buď vypne,
nebo se její hlášení začnou přehlížet. V obou případech přestane hlídat to,
kvůli čemu vznikla, a nikdo si toho nevšimne, protože pořád svítí.

Oprava má dvě části: hranice slova na začátku výrazu (skloňování mění konec,
ne začátek) a nepovinný příznak `exact` pro výrazy, kde se koncovka tolerovat
nesmí. Po opravě zbylo jediné porušení a bylo skutečné: anglický katalog měl
u data přihlášení hodnotu „Subscribed" místo „Confirmed".

Je to tatáž třída chyby jako překrývající se prefix a suffix nad krátkým jménem
souboru (I22) a jako `\s`, které přeskočilo konec řádku (I16). Pokaždé jde
o porovnání textu, které je o kousek volnější, než autor zamýšlel.

### I25. Prettier přeformátoval golden soubory a shodil šestnáct testů

- **Našel:** hlavní agent tím, že to sám způsobil
- **Uzavřeno:** 2026-08-01, golden soubory jsou mimo dosah formátovače

Golden snapshoty rendereru se ukládají jako `.html` a `.txt` do
`packages/emails/test/__fixtures__/expected/`. Prettier HTML umí formátovat,
a protože ten adresář nebyl v `.prettierignore`, jeden běh `prettier --write .`
přepsal očekávaný výstup a šestnáct golden testů zčervenalo.

Že testy spadly, je ta lepší varianta. Horší je tichá: kdyby si po takovém běhu
někdo snapshoty jen přegeneroval příkazem `vitest -u`, golden test by od té chvíle
porovnával přeformátovaný výstup sám se sebou. Zůstal by zelený a přestal by
hlídat cokoliv, protože očekávání i skutečnost by pocházely z téhož běhu.

Do `.prettierignore` proto patří `packages/emails/test/__fixtures__/expected/`
i `packages/contracts/fixtures/`. Obojí je očekávaný výstup bajt po bajtu,
ne zdrojový kód, takže se neformátuje.

Ověřeno tak, že jsem po opravě pustil `prettier --write .` znovu a všech
334 testů balíčku zůstalo zelených.

### I26. Barva projektu se počítala v JavaScriptu podle motivu a rozbíjela hydrataci

- **Našel:** hlavní agent v prohlížeči
- **Uzavřeno:** 2026-08-01, světlost přesunuta do CSS

`workspaceAccent(workspaceId, theme)` odvozovala odstín z `workspace_id`
a světlost vybírala podle motivu: 0.55 pro světlý, 0.72 pro tmavý.

Server ale motiv prohlížeče nezná. Vykreslil proto světlou variantu a klient
hydratoval tmavou. React na to hlásil nesoulad s poznámkou **„This won't be
patched up"**, tedy rozdíl, který sám neopraví: proužek projektu v topbaru
i levý okraj hlavní navigace zůstaly ve špatné barvě až do dalšího vykreslení.

Naměřeno v prohlížeči:
```
server:  background-color: oklch(0.55 0.16 88)
klient:  backgroundColor:  oklch(0.72 0.16 88)
```

Oprava nespočívá ve srovnání hodnoty, ale v tom, že se rozdíl nemá kde vzít.
Funkce vrací `oklch(var(--workspace-accent-l) 0.16 <odstín>)`. Odstín na motivu
nezávisí, takže vyjde na obou stranách stejně, a světlost nastavuje `tokens.css`
zvlášť pro světlý a tmavý režim, tedy vrstva, která o motivu ví.

Test to hlídá tím, že ověřuje **nezávislost na motivu**, ne konkrétní hodnotu:
funkce bere jediný argument a její výstup nesmí obsahovat číselnou světlost.

Poučení: cokoli, co závisí na motivu, uživatelově zóně nebo šířce okna, se nesmí
dopočítávat v JavaScriptu, který běží na obou stranách. Server ty vstupy nemá.

### I27. Druhý testovací harness zavedl znovu problém, který R31 už vyřešil

- **Našel:** zadavatel si všiml, že se nic neděje, hlavní agent to změřil
- **Uzavřeno:** 2026-08-01, harness sjednocený na jeden kontejner

Naměřeno: **74 běžících kontejnerů s PostgreSQL naráz**, zátěž stroje 29,
jeden běh série `packages/core` přes deset minut bez dokončení. Zvenčí to
vypadalo, že se zastavila práce. Agenti přitom běželi, jen čekali na databáze,
které se navzájem dusily.

Příčina: `startPgHarness()` v `packages/core/src/test-support/pg-harness.ts`
startuje vlastní kontejner při KAŽDÉM zavolání a volá ho 23 testovacích souborů.
Vitest je pouští paralelně, takže vznikne 23 databází na jeden běh balíčku,
a při víc souběžných bězích se to násobí.

Zajímavé je, **odkud se ten harness vzal**. Plán P03 tenhle problém vyřešil
rozhodnutím R31: jeden kontejner na běh, každý soubor dostane databázi
z předmigrované šablony. To řešení ale žije v `packages/db`. Když P04 zjistil,
že `packages/core` nemá skript `test:db` ani rozdělení vitestu na projekty
(nález I12), obešel to vlastním harnessem, a tím obnovil přesně ten stav,
proti kterému R31 vzniklo.

Poučení: obcházka, která vypadá jako lokální, umí obnovit už vyřešený problém
jinde. Když plán něco řeší rozhodnutím, patří to rozhodnutí do zadání každého
plánu, který na tutéž věc narazí, ne jen do plánu, kde vzniklo.

Praktický důsledek: kdyby to zůstalo, CI by na tomhle padalo a o produkční
verzi by se nedalo mluvit. Sada testů, kterou nejde dopočítat, nehlídá nic.

### I28. Souběžnost testů se neomezovala a stroj se dusil i po opravě kontejnerů

- **Našel:** hlavní agent po opravě I27
- **Uzavřeno:** 2026-08-02, strop `maxWorkers` ve sdíleném presetu i v obou vlastních konfiguracích

Po opravě harnessu (nález I27) přestaly kontejnery přetékat, ale zátěž stroje
znovu vyskočila, tentokrát na **60 na desetijádrovém stroji** při 24 procesech
vitestu. Samotný Docker žral 165 procent jednoho jádra.

Příčina je jiná než u I27 a je potřeba ji odlišit: vitest ve výchozím nastavení
bere skoro všechna jádra, což je správně, když na stroji běží **jedna** série.
Když jich běží deset naráz, každá si nárokuje devět vláken a stroj se rozpadne.
Testy pak padají na vypršených spojeních, tedy na vyčerpaném stroji, ne na kódu,
a hledá se chyba tam, kde žádná není.

Oprava je `maxWorkers: 3` ve `packages/config/vitest/node.ts`, `packages/core`
a `apps/web`. Série doběhne pomaleji, ale doběhne.

Souvislost s I27 je poučná: obě vady vypadaly stejně (nic se neděje, testy
neběží) a obě měly jinou příčinu. První byla v tom, KOLIK databází se zakládá,
druhá v tom, KOLIK vláken si každý běh vezme. Oprava první odhalila druhou.

### I29. Dva agenti si protiřečili v účtování spotřeby tokenů

- **Našel:** hlavní agent při porovnání dvou hlášení
- **Uzavřeno:** 2026-08-02, rozhodnuto podle typů nainstalované verze

Dva agenti nezávisle sáhli na tentýž řádek adaptéru AI SDK a každý tvrdil něco
jiného. Jeden psal, že se má účtovat přes `event.usage`, protože `totalUsage`
je zavržený alias. Druhý psal opak, že `usage` je spotřeba posledního kroku
a ve smyčce s nástroji by se uživateli naúčtoval zlomek.

U BYOK platí za tokeny uživatel, takže to není detail. Rozhodnuto přečtením
`.d.ts` nainstalované `ai@7.0.47`, ne dohodou ani hlasováním:

```
readonly usage: LanguageModelUsage;
    The total token usage of all steps.
    When there are multiple steps, the usage is the sum of all step usages.

readonly totalUsage: LanguageModelUsage;
    @deprecated Use `usage` instead.
```

Správně je `usage`. Na disku to naštěstí bylo správně, rozpor byl jen v hlášeních.

Zajímavější je, ODKUD se ta chyba vzala. Rozdíl „usage je poslední krok,
totalUsage je součet" v starších verzích SDK skutečně platil, jen na jiném typu
a v jiné verzi. Agent si pamatoval pravidlo, které kdysi platilo, a přenesl ho
na verzi, kde už neplatí. Přeměřil pak i druhý typ, který moje kontrola
nepokrývala, a ukázalo se, že rozdíl neplatí ani tam: obě pole jsou dnes
agregát a `totalUsage` je všude jen alias.

Poučení: u rychle se měnícího rozhraní nestačí ověřit jedno místo. Když se
ukáže, že zapamatované pravidlo neplatí, musí se přeměřit KAŽDÉ místo, kde
se podle něj rozhodovalo. A hlášení agenta není doklad ani tehdy, když zní
sebejistě, obzvlášť když si dva protiřečí.

### I30. Obecný vzor v `exports` přebil konkrétní a shodil build workeru

- **Našel:** P16 při stavbě produkční image
- **Uzavřeno:** 2026-08-02, doplněn explicitní vzor

`packages/core/package.json` měl v `exports` dva vzory, které si u jedné cesty
konkurují:

```json
"./*/jobs":     "./src/*/jobs/queue-handlers.ts",
"./platform/*": "./src/platform/*.ts",
```

Node i esbuild vybírají vzor s NEJDELŠÍ částí před hvězdičkou. Pro
`@mlain/core/platform/jobs` vyhraje `./platform/*` (základ `./platform/`)
nad `./*/jobs` (základ `./`), takže se rozvine na `./src/platform/jobs.ts`,
což je adresář, ne soubor. Build workeru spadl na „Could not resolve".

Zrádné je, že `@mlain/core/segments/jobs` fungovalo, protože pro `segments`
žádný konkurenční vzor neexistoval. Vada tedy tikala u každé domény, které by
někdo přidal vlastní `./<domena>/*`, a projevila se až u té jediné, kde se obě
pravidla potkala.

Opraveno explicitním vzorem `"./platform/jobs"` PŘED oběma obecnými.

### I31. Handlery front pod nekonvenčním jménem projdou testy a shodí bundle

- **Našel:** hlavní agent při opravě I30
- **Uzavřeno:** 2026-08-02, tři domény srovnány

Odblokování I30 odhalilo druhou vadu ve stejném řetězu. Codegen workeru generuje
`import { handlers as hN } from '@mlain/core/<domena>/jobs'`, ale tři domény
(`segments`, `contacts/import`, `contacts/export`) exportovaly `queueHandlers`.

Soubor se přitom normálně zkompiluje, typová kontrola projde a testy taky.
Selže až `esbuild` při stavbě bundle workeru hláškou „No matching export for
import handlers", tedy ve chvíli, kdy se staví produkční image.

Jméno `handlers` je tedy KONTRAKT s codegenem, ne stylová volba. Doplněno
do všech tří souborů i s vysvětlením, proč se nesmí přejmenovat.

### I32. Nativní binárka se nedá zabalit do bundlu

- **Našel:** hlavní agent při opravě I30
- **Uzavřeno:** 2026-08-02, `@node-rs/argon2` je externí

Třetí vada v témže řetězu. Po opravě rozlišení modulů spadl build workeru na
„No loader is configured for .node files" u `@node-rs/argon2`, tedy u knihovny
na hashování hesel.

Bundlovat nativní modul nejde z principu: je to zkompilovaná knihovna pro
konkrétní architekturu, ne JavaScript. Patří do `external`, aby se načetla
za běhu z `node_modules`.

Všechny tři nálezy I30 až I32 ležely za sebou v jednom řetězu a odhalily se
postupně: každá oprava odkryla další. Do té doby je zakrývala ta první, protože
build spadl dřív, než se k nim dostal.

### I33. Migrační runner shodil aplikaci podruhé, jinou cestou

- **Našel:** P14, když mu přestaly odpovídat obrazovky
- **Uzavřeno:** 2026-08-02, zálohy odpojené z veřejného API

Tatáž vada jako nález I19, jen jinou cestou. Poprvé se runner dostal do bundlu
webu přes reexport v kořeni `@mlain/db`, podruhé přes řetěz
`ops/api/backups.routes.ts` -> `openapi.ts` -> `route.ts`.

Příznak je nepříjemný: aplikace vrací 500 na KAŽDÉ stránce, ne jen na zálohách,
protože se rozbije kompilace celého API. Agent, který na obrazovkách pracoval,
hledal chybu u sebe.

Zkusil jsem dvě opravy a ani jedna nestačila:
1. Dynamický import (`await import('@mlain/db/migrate')`). Bundler prochází
   i dynamické importy, takže výraz stejně potkal.
2. Vytažení `new URL('../migrations', import.meta.url)` z modulové úrovně
   do funkce. Bundler ho našel i tam.

Platná oprava je věcná, ne technická: **zálohy do veřejného API nepatří.**
Zálohování je operace CLI (`mlain backup`, `restore`, `doctor`), kterou spouští
operátor na serveru, ne uživatel z prohlížeče. Registrace v `openapi.ts` byla
chyba v zadání, ne v provedení.

Poučení: když se stejná vada vrátí druhou cestou, je to signál, že se opravoval
příznak. Runner nemá v grafu modulů aplikace co dělat, a jediný spolehlivý
způsob, jak to zajistit, je nemít k němu z aplikace cestu.

### I34. Dva agenti pojmenovali tentýž parametr cesty různě

- **Našel:** hlavní agent v logu dev serveru
- **Uzavřeno:** 2026-08-02, sjednoceno na `[id]`

Souběžně vznikly `campaigns/[campaignId]/report` a `campaigns/[id]/{send,progress}`.
Next.js to odmítne: „You cannot use different slug names for the same dynamic
path", a shodí tím CELOU aplikaci, ne jen ty dvě cesty.

Horší je, co následuje: ta výjimka je neošetřená, takže Turbopack zůstane
zaseknutý i po opravě. Každý další požadavek vrací holé „Internal Server Error"
BEZ jediného řádku v logu, takže vypadá jako úplně jiná vada. Spraví to až
restart s vyčištěnou mezipamětí.

Sjednoceno na `[id]`, protože je to konvence zbytku repozitáře (pět výskytů)
a byl ve dvou ze tří cest.

### I35. Tatáž vada v `exports` vystřelila podruhé, na jiné doméně

- **Našel:** P16 při stavbě produkční image, podruhé
- **Uzavřeno:** 2026-08-02, obecný vzor zrušen a doplněn hlídač

Nález I30 jsem opravil doplněním explicitního klíče pro `platform`. O pár hodin
později přibyl vzor pro doménu `ai` a vada se vrátila přesně stejným způsobem:
`./ai/*` má delší základ než obecný vzor, takže ho přebije, a
`@mlain/core/ai/jobs` se rozvine na soubor, který neexistuje.

Byla to oprava příznaku. Vzor tikal dál a čekal na další doménu.

Platná oprava má dvě části:

1. **Obecný vzor zrušen úplně.** V mapě jsou teď vypsané všechny domény
   s frontami: `ai`, `contacts/export`, `contacts/import`, `platform`, `segments`.
   Pořadí klíčů nepomůže, Node ani esbuild ho neberou v potaz, rozhoduje délka
   základu vzoru. Jediné, co funguje, je explicitní zápis.

2. **Hlídač v `apps/worker/codegen.mjs`.** Codegen si stejně prochází domény
   s `jobs/queue-handlers.ts`, takže rovnou ověří, že pro každou existuje klíč
   v mapě. Chybějící zápis teď padne HLASITĚ při generování, ne tiše až
   při `docker build`, kde se hledá o dvě vrstvy dál od příčiny.

Ověřeno tak, že hlídač skutečně diskriminuje: po odebrání klíče `./ai/jobs`
spadne s hláškou, která rovnou napíše řádek k doplnění, po vrácení projde.

Poučení: když se vada vrátí druhou cestou, opravoval se příznak. A když je
řešením „nezapomenout na to příště", patří k němu mechanismus, který
zapomenutí zachytí.

### I36. Nedeklarovaná závislost projde lokálně a spadne až v produkční image

- **Našel:** P16 při stavbě image
- **Uzavřeno:** 2026-08-02, `@mlain/db` doplněno do manifestu CLI

Je to moje chyba: psal jsem `apps/cli/src/commands/migrate.ts`, který importuje
`@mlain/db/migrate`, ale nedoplnil jsem `@mlain/db` do `dependencies` manifestu.

Lokálně to prošlo úplně vším: build, typová kontrola i testy. Balíček se totiž
najde v hoistovaném `node_modules` v kořeni workspace, kam ho přitáhl někdo jiný.

Dockerfile ale staví přes `turbo prune --docker`, a ten do podstromu vezme
**jen deklarované závislosti**. V pruned stromu balíček není a esbuild ho nemá
kde vzít.

Je to tatáž třída vady jako chybějící `export const handlers` (nález I31):
všechno lokálně svítí zeleně a selže až produkční image. Rozdíl mezi
„modul jde načíst z kořene workspace" a „modul je deklarovaná závislost"
neměří ani jeden test.

Poučení: import z jiného workspace balíčku vyžaduje záznam v `dependencies`,
i když bez něj kód lokálně běží. Hoisting je pohodlí vývojáře, ne kontrakt.

### I37. Dočasná tolerance přežila důvod, kvůli kterému vznikla

- **Našel:** P16 při stavbě zlaté cesty
- **Uzavřeno:** 2026-08-02, `skip` změněno na `fail` a doplněno 14 testů

Kontrola schématu v `packages/core/src/health/readiness.ts` vracela při
chybějící tabulce `system_settings` stav `skip`, ne `fail`. Rozhodnutí D3
plánu P01 to zavedlo schválně: tabulku zakládá až P03 a bez té tolerance by
`/api/health/ready` nikdy nevrátil 200, takže by nešlo splnit akceptační
kritérium 1.

P03 dorazilo, migrace existují, tolerance zůstala. Z pomůcky se stala past:
kontejner s **prázdným schématem** hlásil 200 a tvářil se zdravě, zatímco
worker vedle něj padal na „permission denied for database mlain", protože
pg-boss neměl kde založit své schéma. Prohlížeč pak na `/setup` dostal
odmítnuté spojení. Readiness přitom celou dobu svítila zeleně.

Podstatné je, PROČ to nikdo nechytil: modul `health` neměl **jediný test**.
`vitest run src/health` vracelo „No test files found". Kontrola, která
rozhoduje o tom, jestli je instalace zdravá, nebyla ověřená ničím.

Nově chybějící `system_settings` při `expectedVersion > 0` znamená `fail`.
Stav `skip` zbyl jen pro build bez migrací (`expectedVersion === 0`), kde
dává smysl. Test je ověřený tím, že jsem dočasně vrátil `skip` a viděl, že
padnou přesně dva scénáře, ne že jich 14 svítí zeleně.

Poučení: dočasná výjimka potřebuje vlastní datum expirace a test, který ji
zabije, jakmile pomine důvod. Bez toho přežije projekt.

### I38. Externí nativní balíček musí být v manifestu každého, kdo ho spouští

- **Našel:** hlavní agent při zkoušení `mlain genkey`
- **Uzavřeno:** 2026-08-02, `@node-rs/argon2` doplněn do CLI i workeru

`@node-rs/argon2` je v buildu CLI i workeru označený jako `external`, tedy
se do svazku nezabalí a musí se za běhu najít v `node_modules`. Deklarovaný
byl ale jen v `packages/core`.

Build prošel, typová kontrola prošla, testy prošly. Spadlo to až na spuštění:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@node-rs/argon2'
imported from apps/cli/dist/main.js
```

To je stejná třída jako I36, jen o krok dál: tam chyběl balíček v pruned
stromu produkční image, tady chybí i lokálně, a přesto build svítí zeleně.
Označit závislost jako `external` znamená slíbit, že ji dodá někdo jiný.
Ten slib nikdo nevymáhá.

Dopad byl by tichý a pozdní: `mlain reset-password` a hashování hesel ve
workeru by spadly až ve chvíli, kdy je někdo potřebuje, tedy v provozu.

Poučení: `external` v konfiguraci bundleru a `dependencies` v manifestu jsou
dva různé seznamy a musí si odpovídat. Zkusit příkaz doopravdy spustit
stojí pár sekund a odhalí to, co build ani testy nevidí.

### I39. Dva dev servery nad jedním .next zabijí hydrataci a nic nespadne

- **Našel:** P14 při ověřování obrazovek reportu
- **Uzavřeno:** 2026-08-02, osiřelý proces ukončen

Nad `apps/web/.next` běžely dva procesy `next-server` současně, každý
puštěný jiným agentem. Jeden držel port 3100, druhý poslouchal na 3000.
Přepisovaly si build artefakty, takže prohlížeč dostal nesourodou sadu
chunků a klientský runtime se vůbec nerozjel.

Projev byl zákeřný, protože **nic nespadlo**. Server vracel 200, serverové
HTML se vykreslilo, žádný chunk nevracel 4xx, v konzoli nebyla výjimka.
Jen se nenamountoval React: `document.documentElement` byl bez jediného
klíče `__react*`, takže se nespustil žádný `useEffect` a neodešel ani jeden
požadavek na API. Stránky vypadaly jako prázdné placeholdery.

Testy, které kontrolují jen obsah, procházely. Padaly výhradně ty, které
potřebují reakci na klávesu nebo kliknutí, tedy živý React. To svádělo
hledat chybu v komponentě, která s tím neměla nic společného.

Poučení: hydrataci ověřuj přímo, ne přes odvozené příznaky. Dotaz
`Object.keys(document.documentElement).filter(k => k.startsWith('__react'))`
odpoví za sekundu. A dev server smí startovat jen jeden, hlavní agent;
subagenti si ho pouštět nesmějí.

### I40. Vývojářský .env.local se dostával do vrstev produkční image

- **Našel:** P16 při stavbě image
- **Uzavřeno:** 2026-08-02, `.dockerignore` doplněn a ověřen zkušební stavbou

`.dockerignore` vylučoval `node_modules`, `.turbo`, `.next`, `dist`, `coverage`,
`.git`, `.github`, `data`, `docs` a `*.md`. **`.env*` v něm nebylo.**

Projevilo se to jako nudná chyba stavby. Next si `.env.local` při buildu sám
načte, což ohlásí řádkem `- Environments: .env.local`, a `next build` spadl:

```
Error [ConfigError]: Konfigurace není platná, 1 problémů.
  variable: 'DATA_DIR',
  message: 'adresář /Users/petr/Projects/Mailing_Tool/.dev-data musí existovat'
  exitCode: 78
```

Cesta ze stolu vývojáře uvnitř kontejneru neexistuje. V CI se to neprojevilo,
protože čerstvý checkout `.env.local` nemá, takže úloha `build-image` svítila
zeleně a lokální build padal pořád. Rozdíl mezi CI a stolem se hledá špatně.

Vážnější je ale ten druhý směr: **cokoliv si vývojář do `.env.local` napíše,
skončí ve vrstvách image.** Dneska cesta, zítra `SECRET_KEY` nebo klíč
k poskytovateli. Vrstvy jdou rozbalit i po smazání souboru, takže smazat
tajemství z běžící image ho z historie vrstev neodstraní. Není to nepohodlí
při stavbě, je to únik přístupů, který by nikdo nezpozoroval.

Oprava vylučuje `**/.env` a `**/.env.*` a vrací zpět jen `.env.example`, kterou
`turbo.json` drží v `globalDependencies`; bez ní by se lišil hash úloh mezi
stolem a CI. Šablona je prázdná, ověřeno.

Ověření je empirické, ne z hlavy. Jednorázová alpine image, která kontext jen
vypíše, našla v kontextu jediný soubor:

```
ENVSOUBOR:/.env.example
KONEC
```

Poučení: `.dockerignore` je bezpečnostní hranice, ne jen zrychlovač stavby.
Co se do něj nedostane, dostane se do image i tehdy, když to není v gitu.
`.gitignore` a `.dockerignore` chrání dvě různé věci a jeden druhý nezastoupí.

### I41. Konfigurace se načítala při stavbě, ne za běhu

- **Našel:** P16 při stavbě image, po odstranění `.env.local` z kontextu
- **Uzavřeno:** 2026-08-02, runtime se skládá líně při prvním požadavku

Po opravě nálezu I40 vylezla vada, kterou `.env.local` maskoval tím, že hodnoty
dodával. `next build` padl ve fázi „Collecting page data":

```
Error [ConfigError]: Konfigurace není platná, 3 problémů.
  { variable: 'APP_URL',      message: 'je povinná (required) a chybí' }
  { variable: 'SECRET_KEY',   message: 'je povinná (required) a chybí' }
  { variable: 'DATABASE_URL', message: 'je povinná (required) a chybí' }
Failed to collect page data for /t/[[...path]]
```

`apps/web/src/app/t/tracking-runtime.ts` volal `loadConfig()` na úrovni modulu
a rovnou tam skládal keyring, cache i zapisovací buffer. Fáze sběru stránek
modul naimportuje, čímž se to všechno vyhodnotilo. Vedle konfigurace se tak
při stavbě spouštěl i časovač `domains.start()`, tedy obnovovací smyčka nad
databází, ke které se build nemá jak připojit.

Produkční image by tedy nešla postavit bez znalosti `SECRET_KEY`
a `DATABASE_URL`. To je špatně z obou stran. V CI úloha `build-image` žádná
tajemství nedostává, takže by padala. A kdyby je tam někdo „na opravu" dodal,
**zapekl by je do vrstev image**, čímž by vznikl obraz nesoucí podpisový klíč,
který se nedá distribuovat. Červená stavba je menší zlo.

Podstatná past: `export const dynamic = 'force-dynamic'` v route handleru na to
NESTAČÍ a v souboru byl celou dobu. Řídí, jestli se trasa předrenderuje, ne
jestli se naimportuje její modul. Import proběhne tak jako tak.

Runtime se teď skládá až při prvním požadavku a drží se v memoizované proměnné.

Poučení: konfigurace je běhová věc. Cokoli, co ji čte, musí být za funkcí, ne
na úrovni modulu. Rozdíl je vidět jedině skutečnou stavbou bez tajemství
v prostředí, což lokálně nikdo nedělá.

### I42. Playwright si pouštěl vlastní dev server, protože hlídal jiný port

- **Našel:** hlavní agent při reprodukci hlášení o mrtvé hydrataci
- **Uzavřeno:** 2026-08-02, port i hostname se odvozují z `APP_URL`

Tohle je kořenová příčina nálezu I39, tedy dvou dev serverů nad jedním `.next`.

`apps/web/playwright.config.ts` měl natvrdo `3000` na třech místech: v `baseURL`,
v `webServer.url` a nepřímo v příkazu `pnpm --filter @mlain/web dev`, který bez
přepínače bere výchozí port. Vývojový server přitom běží podle `APP_URL` na
`3100`.

`reuseExistingServer: !process.env.CI` tedy nikdy nezabral: hlídal port, na
kterém nikdo neposlouchá. Playwright proto pokaždé nastartoval DRUHÝ dev server
nad tímtéž adresářem `.next`. Každý agent, který pustil testy, vyrobil další.

Port i hostname se teď odvozují z `APP_URL` a port se předává do `next dev`
výslovně. Konfigurák si `.env.local` načítá sám přes `process.loadEnvFile()`,
protože běží ve vlastním procesu, kam se z Nextu nic nedostane.

Poučení: tatáž hodnota na třech místech se dřív nebo později rozejde. Když
`reuseExistingServer` mlčky nefunguje, není to nekonfliktní stav, ale tichá
výroba dalších procesů.

### I43. localhost a 127.0.0.1 nejsou pro Next 16 synonyma

- **Našel:** hlavní agent při hledání příčiny nenamountovaného Reactu
- **Uzavřeno:** 2026-08-02, doplněno `allowedDevOrigins`

Poslední ze tří příčin mrtvé hydratace, a nejzákeřnější.

Next 16 obsluhuje vývojové zdroje pod `_next` jen pro originy uvedené
v `allowedDevOrigins`. Nastavené nebylo, Playwright jezdil na `127.0.0.1`
a dostal místo websocket handshaku obyčejnou HTTP odpověď. Klientský runtime
se kvůli tomu vůbec nerozjel.

Naměřeno přímo, tatáž stránka ve stejnou chvíli:

```
127.0.0.1:3100/login  ->  reactNaHtml: []                  chyby: [ERR_INVALID_HTTP_RESPONSE]
localhost:3100/login  ->  reactNaHtml: ["__reactFiber$…"]  chyby: []
```

Projev byl matoucí: stránky vracely 200, serverové HTML se vykreslilo správně
včetně roving tabindexu, žádný chunk nevracel 4xx a nepadla výjimka. Procházely
testy, které kontrolují obsah, a padaly výhradně ty, které potřebují kliknutí
nebo klávesu. To svádělo hledat vadu v komponentách, které nikdy nedostaly
šanci se spustit.

Po opravě všech tří příčin dává sada `e2e/ui` 25 zelených a 3 červené, a ty tři
jsou konečně skutečné vady komponent.

Poučení: dvě jména téhož stroje nemusí být totéž jméno pro framework. A když
testy dělí čistě na „kontroluje obsah" versus „potřebuje interakci", nehledej
vadu v komponentách, ale v tom, jestli se vůbec spustil klientský runtime.
Dotaz na klíče `__react*` na `documentElement` to rozhodne za sekundu.

### I44. Sestavené CLI hledalo migrace vedle sebe, ne v packages/db

- **Našel:** P16 při zkoušení všech provozních příkazů
- **Uzavřeno:** 2026-08-02, cesta se počítá vůči sestavenému CLI

`mlain migrate` byl rozbitý dvěma nezávislými způsoby najednou a oba se
projevily až na spuštění sestaveného binárního souboru, ne v testech.

**Cesta k migracím.** `packages/db/src/migrate.ts` skládá výchozí cestu jako
`new URL('../migrations', import.meta.url)`. To platí, dokud modul běží ze
svého místa ve stromu. CLI se ale bundluje esbuildem do jediného souboru
`apps/cli/dist/main.js`, takže se `import.meta.url` vztahuje k němu a cesta
vyšla na `apps/cli/migrations`, kde nic není. V produkční image to bylo stejně
mimo: Dockerfile kopíruje migrace do `/app/packages/db/migrations`.

**Zápis do streamů.** Psal jsem `streams.err.write(...)` a `streams.out.write(...)`,
jenže `CliStreams` má metody `stdout(line)` a `stderr(line)`, žádné objekty
s `write`. Padalo to na `TypeError: Cannot read properties of undefined`,
tedy neodchycenou výjimkou bez exit kódu. `docker/entrypoint.sh` přitom při
každém nenulovém kódu jiném než 69 kontejner ukončí, takže by instalace
vůbec nenaběhla.

Obojí je moje chyba a obojí prošlo typovou kontrolou i testy. `streams.err`
je `undefined` až za běhu, protože `CliStreams` má `env?` a struktura se
kontroluje na přiřazení, ne na přístup k neexistujícímu poli.

Test na to existoval, ale měřil opak: „migrate hlásí, že ho dodá P03" zůstal
zelený i poté, co příkaz vznikl. Nahrazen testem, který ověřuje skutečné
chování včetně toho, že výstup neobsahuje `TypeError`.

Ověřeno spuštěním proti čisté databázi: 7 migrací, 111 tabulek, 84 RLS politik,
druhý běh je bez efektu.

Poučení: příkaz, který spouští entrypoint kontejneru, se musí zkusit spustit
ze SESTAVENÉ podoby. Zdrojová a zabalená verze nemají stejné `import.meta.url`
ani stejný strom kolem sebe.

### I45. Tichý catch v úklidu nechával osiřelé databáze

- **Našel:** P16 při běhu celé sady `test/ops`
- **Uzavřeno:** 2026-08-02, tři pokusy a hlášení do výsledku

`backup-verify.ts` uklízel dočasnou databázi voláním `dropdb --force` zabaleným
v `.catch(() => undefined)`. Pod zátěží úklid občas selhal, protože se ještě
zavírala spojení, a to selhání zmizelo beze stopy.

Projev je zákeřný v tom, že se nedá reprodukovat: v izolaci prošel test 3 ze 3,
a padl teprve při souběžném běhu celé sady, kdy zbyla databáze `ml_verify_*`.

Úklid se teď zkouší třikrát a poslední selhání se přidá mezi problémy ověření
včetně příkazu na ruční smazání. Výjimka se nevyhazuje schválně: `finally` by
přebilo skutečný výsledek ověření.

Poučení: `.catch(() => undefined)` je vhodné jen tam, kde je selhání opravdu
bez následku. U úklidu zdrojů následek má, jen se projeví jinde a později.

### I46. Prázdné tělo požadavku vracelo 415

- **Našel:** P15 při zprovozňování obrazovky nastavení AI
- **Uzavřeno:** 2026-08-02, detekce těla se řídí `Content-Length`

Middleware veřejného API považoval požadavek za nesoucí tělo podle
`c.req.raw.body !== null`. Undici, tedy `fetch` v Node, kterým serverové akce
volají vlastní API, ale u POST bez těla sám připojí `Content-Length: 0`
a Next vykreslí `raw.body` jako prázdný stream, ne jako `null`.

Detekce proto ohlásila tělo i u požadavku bez jediného bajtu. Klient žádný
`Content-Type` neposlal, protože nemá co deklarovat, a middleware to shodil na
`415 This Content-Type is not supported by this endpoint`.

Postihlo to celou třídu endpointů, které něco přepínají a nic neposílají.
Konkrétně `POST /ai/credentials/{id}/test` a `POST /ai/credentials/{id}/default`
nefungovaly v prohlížeči vůbec. Není to vada AI domény, jen se tam projevila
první, protože je to první doména s beztělovými akcemi.

Nově platí, že když je `Content-Length` deklarovaná, je jediným zdrojem pravdy
o počtu bajtů. `raw.body !== null` se použije jen bez ní, pro chunked přenos
bez předem známé délky.

Poučení: prázdný stream a chybějící stream nejsou totéž. Kontrola na `!== null`
vypadá jako kontrola „přišlo něco", ale ptá se na jinou věc.

### I47. Položka navigace vyžadovala oprávnění, které neexistuje

- **Našel:** P15 při zprovozňování obrazovky nastavení AI
- **Uzavřeno:** 2026-08-02, opraveno na `ai:configure` a `mvp0: true`

Registr navigace vázal položku `settings-ai` na oprávnění `ai:read`. Takové
oprávnění v systému není, skutečná jsou `ai:use` a `ai:configure`. Položka měla
navíc `mvp0: false`.

Neselhalo nic. Kontrola oprávnění na neexistující jméno prostě nikdy neprojde,
takže se položka jen nikdy nezobrazila a k nastavení AI se nedalo proklikat,
přestože obrazovka existovala a fungovala.

To je nejhorší tvar vady v přístupových právech: nevzniká chyba, jen tichý
zákaz. Opačná záměna, tedy kontrola na oprávnění, které má kdekdo, by se
projevila stejně tiše a byla by bezpečnostní dírou.

Poučení: jména oprávnění patří pod typovou kontrolu nebo pod test, který
porovná registr navigace se seznamem existujících oprávnění. Řetězec, který
se nikde neověřuje, se dřív nebo později rozejde.

### I48. Bootstrap testovacího harnessu nedorovnával heslo rolí

- **Našel:** P13 při běhu databázových testů
- **Uzavřeno:** 2026-08-02, doplněno `ALTER ROLE ... PASSWORD`

Bootstrap zakládal role příkazem `CREATE ROLE` v `DO` bloku s odchycením
`duplicate_object`. Nad existující rolí tedy neudělal nic, včetně hesla.
Jakmile kontejner přežil změnu očekávaného hesla, padal každý soubor už
v bootstrapu:

```
error: password authentication failed for user "mlain_app"
 Test Files  3 failed (3)
      Tests  16 skipped (16)
```

Podstatné je slovo `skipped`. Testy se nepokazily, ony se vůbec nespustily,
takže série vypadala jako „nic nepadá". A netýkalo se to jednoho balíčku:
přes tenhle harness jdou testy kampaní, providerů, kontaktů, identity,
trackingu i platformy, takže to zastavilo úplně každého.

Bootstrap byl idempotentní vůči EXISTENCI role, ne vůči jejímu STAVU. To je
rozdíl, který se pozná jedině tak, že se prostředí jednou rozejde.

Smazat kontejner by pomohlo taky, ale jen do příštího nesouladu.

Poučení: idempotentní příprava prostředí musí dorovnávat stav, ne jen ověřit,
že objekt existuje. A hlášení o přeskočených testech je varování, ne informace.

### I49. Seznamy v aplikaci nešlo otevřít myší

- **Našel:** P13 při psaní e2e testu obrazovek kampaní
- **Uzavřeno:** 2026-08-02, doplněn `onClick` a čtyři testy

`DataTable` z návrhového systému měl na řádku `onKeyDown` s obsluhou `Enter`,
ale žádný `onClick`. Kliknutí myší tedy nedělalo vůbec nic.

Tuhle tabulku používají všechny seznamy v aplikaci, takže se to netýkalo jedné
obrazovky: myší nešel otevřít jediný záznam nikde.

Vzniklo to obráceným pořadím práce, které je jinak správné. Přístupnost
z klávesnice se dělala první a pořádně, prošla testy i kontrolou axe, a protože
klávesová cesta fungovala, nikoho nenapadlo zkusit myš. Testy měřily to, co
kdo psal, tedy klávesnici.

Doplněný handler ignoruje kliknutí na ovládací prvky uvnitř řádku (políčko,
tlačítko, odkaz). Bez toho by zaškrtnutí položky zároveň otevřelo detail
a nešlo by vybrat víc záznamů najednou.

Čtyři nové testy ověřeny tím, že po odebrání `onClick` padnou přesně dva.

Poučení: hotová a otestovaná klávesová cesta je důkaz o klávesnici, ne o myši.
Když se nová interakce staví od přístupnosti, patří k ní i test na tu obvyklou
cestu, kterou používá většina lidí.

### I50. Neomezený dotaz v testu měřil cizí komponentu

- **Našel:** P05 při opravě přístupnosti
- **Uzavřeno:** 2026-08-02, dotaz omezen na sekci

Scénář K8 ověřoval, že se rozbalení shluku na ose ohlásí čtečce. Všechny jeho
asserce byly omezené na `#section-k8` až na poslední řádek, kde stálo
`page.getByRole('status')`.

Galerie je záměrně jedna stránka se všemi vzory pohromadě a průvodce v sekci K3
má vlastní `role="status"` s čítačem kroku. Test proto padal na

```
strict mode violation: getByRole('status') resolved to 2 elements
```

Vypadalo to jako vada osy. Ve skutečnosti byla komponenta v pořádku, jen dotaz
sahal mimo měřenou sekci. V provozu se průvodce a osa nikdy nepotkají, takže
tenhle konflikt nemohl nastat nikde jinde než v galerii.

Oprava je zúžení dotazu, ne změkčení asserce. Celá sada `e2e/ui` je po ní
zelená, 26 z 26.

Poučení: jedno neomezené `page.getBy…` mezi omezenými je podezřelé samo o sobě.
A test, který padá kvůli sousední komponentě, hlásí vadu měření, ne vadu kódu.

### I51. Deklarovaná verze Node byla nižší, než závislosti dovolují

- **Našel:** P15 při doinstalaci závislostí modulu značky
- **Uzavřeno:** 2026-08-02, spodní hranice zvednuta na 24.15.0

Kořenový `package.json` deklaroval `"node": ">=24.2.0 <25"`. `jsdom@30` ale
požaduje `^22.22.2 || ^24.15.0 || >=26.0.0`, a protože `.npmrc` má
`engine-strict=true`, na starším Node spadne CELÁ instalace, ne jen ten balíček.

Deklarovaný rozsah tedy povoloval verzi, na které `pnpm install` neprojde.
CI to nezachytilo, protože běží na 24.18.1, tedy uvnitř skutečně funkčního
rozsahu. Projeví se to jen tomu, kdo má Node mezi 24.2.0 a 24.15.0, a ten
uvidí selhání instalace bez zjevné souvislosti s tím, co dělal.

Poučení: `engines` je slib, ne přání. Když je širší než průnik požadavků
závislostí, je to nepravdivý údaj, který někoho jednou stojí hodinu hledání.

### I52. Dokument OpenAPI se hledal na disku, kde v produkci nebyl

- **Našel:** P16 při stavbě image, dohledáno hlavním agentem
- **Uzavřeno:** 2026-08-02, dokument se importuje do svazku

`apps/web/src/lib/api/openapi.ts` hledal `packages/contracts/openapi.json` mezi
třemi kandidátskými cestami a bral první existující. Při vývoji to fungovalo.
V produkci ne, ze dvou nezávislých důvodů.

**Soubor tam vůbec není.** Runtime vrstva image kopíruje `.next/standalone`,
`.next/static`, `public`, `worker/dist`, `cli/dist` a migrace. `packages/contracts`
mezi nimi nefiguruje, takže by neexistoval žádný ze tří kandidátů a `/api/v1/docs`
i `/api/v1/openapi.json` by v běžící instalaci padaly. Nikdo to nezjistil, protože
se ty dvě trasy nikdy neprošly v kontejneru.

**Hledání souboru za běhu shodilo analýzu závislostí.** Next nemá jak vědět,
který kandidát platí, takže vystopoval celý projekt a hlásil to varováním
„Encountered unexpected file in NFT list". Zbytečně to nafukovalo image, která
je zrovna 2,4 MB nad limitem.

Statický import obojí ruší a zachovává vlastnost, kvůli které se čtení ze
souboru zavádělo: servíruje se TENTÝŽ commitnutý dokument, ne generovaný.

Cesta musí být RELATIVNÍ, ne přes jméno balíčku. Turbopack podcestu
`@mlain/contracts/openapi.json` nerozřeší ani tehdy, když ji `exports` mapa
vystavuje. Ověřeno spuštěním: s klíčem v mapě, po `pnpm install` i po restartu
serveru vracelo celé `/api/v1` pětistovku, bez ohledu na atribut
`with { type: 'json' }`. Klíč v mapě jsem přesto nechal, pro Node a vitest platí.

Poučení: „funguje to při vývoji" u čehokoli, co sahá na disk, neříká nic
o produkci. Cesty, obsah image a chování bundleru se liší všechny tři najednou.

### I53. Job integračních testů v CI dostával jinou proměnnou, než čte

- **Našel:** P09 při opravě testovacího harnessu
- **Uzavřeno:** 2026-08-02, opraveno na `DATABASE_URL_MIGRATOR`

Job `test-go-integration` předával `DATABASE_URL_SENDER`, ale `testsupport.New(t)`
čte výhradně `DATABASE_URL_MIGRATOR` a bez ní volá `t.Fatal`. Job byl tedy
červený hned na prvním integračním testu.

Plán P09 tuhle regresi předvídal jmenovitě jako R8 v kapitole 31.2 včetně věty
„dnešní tvar je horší než chybějící proměnná". Přesto se do CI dostala, protože
jméno proměnné vypadá věrohodně a nikdo ten job nespustil.

Poučení: konfigurace CI se neověřuje čtením. Proměnná se správným jménem
v nesprávné roli je nerozeznatelná od správné, dokud to někdo nepustí.

### I54. Konfigurace v literálu na úrovni modulu, projev na třech různých trasách

- **Našel:** P16 při stavbě image, po dvou nesprávně mířených opravách
- **Uzavřeno:** 2026-08-02, katalog limitů je líná funkce plus nová brána

Nález I41 byl opravený špatně, i když ta oprava sama byla správná. Odstranil
totiž jeden projev, ne příčinu. Stavba pak padala dál, jen pokaždé jinde:

```
Failed to collect page data for /t/[[...path]]
Failed to collect page data for /api/v1/[[...route]]
Failed to collect page data for /api/internal/ai/chat
```

Skutečná příčina byla v `apps/web/src/lib/api/rate-limit.ts`, kde
`RATE_LIMIT_RULES` volal `getConfig()` uvnitř literálu objektu na úrovni modulu.
Ten soubor importuje `authenticate.ts` a ten importuje kdekoli. Každá z těch
tří tras se dala složit líně a stavba pak spadla na další. Byla to hra na krtky.

Samotné `getConfig()` je napsané správně a memoizuje. Vada nebyla v něm, ale
v tom, KDY se poprvé zavolá.

Poučení o diagnostice: když se táž chyba objeví na třetím různém místě, přestaň
opravovat místa. Hlášení jmenovalo trasu, protože tam se import uzavřel, ne
protože tam byla chyba.

Aby se to nevrátilo počtvrté, vznikla brána
`apps/web/test/ci/config-at-module-level.test.ts`, která projde `apps/web/src`
a zakáže `loadConfig()` a `getConfig()` mimo tělo funkce.

Brána si při prvním běhu vysloužila vlastní poučení: nahlásila dvě stránky,
ve kterých je volání SPRÁVNĚ. Detektor nepoznal `export default async function`,
tedy tvar každé stránky App Routeru, a považoval jejich vnitřek za úroveň
modulu. Falešně červená brána je nebezpečnější než děravá, protože se obvykle
„opraví" tím, že se vypne. Ten tvar je proto teď v testech natvrdo, spolu
s testem, že detektor chytí přesně ten vzor, který vadu vyrobil.

### I55. Klient PostgreSQL o čtyři verze starší shodil osmnáct testů

- **Našel:** hlavní agent při kompletní sérii
- **Uzavřeno:** 2026-08-02, doinstalován klient 18 a zapsán do README

Osmnáct testů v `packages/core` padalo na jediné příčině:

```
pg_dump: error: server version: 18.4; pg_dump version: 14.18 (Homebrew)
pg_dump: error: aborting because of server version mismatch
```

Není to vada kódu ani prostředí projektu. Databáze běží na 18, na stroji byl
klient 14, a `pg_dump` odmítá pracovat proti novějšímu serveru, než je sám.
V produkční image se to projevit nemůže, `Dockerfile` instaluje
`postgresql18-client`.

Zákeřné na tom je, co ta hláška způsobí u toho, kdo ji nečeká. Osmnáct
červených testů kolem záloh vypadá jako rozbité zálohování, ne jako chybějící
nástroj. Jeden z nich navíc padal na porovnání textu:

```
expected 'pg_dump: error: server version…' to contain 'row-level security'
```

což vede k domněnce, že se rozbila pojistka proti tichým prázdným zálohám.

`mlain doctor` tuhle neshodu poznal a pojmenoval ji `backup_binary_version_mismatch`.
Nikdo ho ale nespustil, protože se hledala příčina v kódu.

Zapsáno do README včetně příkazu a včetně upozornění, že `export PATH` patří
do `.zshrc`, jinak se to vrátí po prvním restartu terminálu.

Poučení: než začneš hledat vadu v osmnácti testech naráz, ověř verze nástrojů,
na kterých stojí. A když má projekt diagnostický příkaz, spusť ho dřív než
debugger.

### I56. Kontrola v mezivrstvě dokládá jen tu mezivrstvu

- **Našel:** P16 při ověřování hotové image
- **Uzavřeno:** 2026-08-02, doplněn `COPY` a kontrola v runtime vrstvě

Oprava nálezu I38 byla udělaná z poloviny. Fáze `node-builder` připravila
`@node-rs/argon2` do `/runtime-deps`, ověřila ho tím, že modul načetla
a zavolala `hashSync`, a tím to skončilo: runtime vrstva ten adresář nikdy
nezkopírovala. Modul se připravil, ověřil a zahodil spolu s mezivrstvou.

Build byl zelený, kontrola v něm proběhla úspěšně, a kontejner přesto skončil
v restartové smyčce `Restarting (78)`:

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find package '@node-rs/argon2'
  imported from /app/apps/cli/dist/main.js
```

Padlo to hned na `mlain migrate` z entrypointu, takže instalace nenaběhla vůbec.

Podstatné je, PROČ ta kontrola nepomohla, přestože byla napsaná dobře a modul
opravdu volala. **Ověřovala ho na místě, kde se nepoužívá.** Doklad o tom, že
mezivrstva byla v pořádku, neříká nic o tom, jestli se její obsah dostal dál.

Runtime vrstva teď má vlastní kontrolu, která načte modul z `/app/node_modules`
a udělá `hashSync` i `verifySync`. Ta by tuhle vadu chytila při stavbě.

Druhá past, na kterou upozornil P16 a která stojí za zapsání: `COPY` toho
adresáře musí přijít AŽ ZA `.next/standalone`. Standalone si nese vlastní
`node_modules` a v opačném pořadí by ho přepsal. V tomhle pořadí Docker obsah
sloučí a `@node-rs` se přidá vedle.

Poučení: kontrolu umísti tam, kde se věc používá, ne tam, kde ji připravuješ.
A když ověřuješ výsledek stavby, ověřuj HOTOVOU image, ne mezistupeň.

### I57. Generátor OpenAPI vyžadoval prostředí, které v CI není

- **Našel:** hlavní agent při přegenerování dokumentu
- **Uzavřeno:** 2026-08-02, generátor si chybějící hodnoty doplní sám

`pnpm --filter @mlain/web generate:openapi` spadl bez proměnných prostředí:

```
ConfigError: Konfigurace není platná, 3 problémů.
  at createApiApp (apps/web/src/lib/api/app.ts:360:7)
  at buildApp (apps/web/src/lib/api/openapi.ts:71:15)
  at generate-openapi.ts:25:39
```

`buildApp()` volá `createApiApp()` a ten sáhne na `getConfig()`. Volání je
uvnitř funkce, tedy formálně v pořádku a brána z nálezu I54 ho nechytí, jenže
generátor tu funkci zavolat musí.

Selhalo by to právě tam, kde na tom nejvíc záleží: na čerstvém checkoutu a v CI
žádné `.env.local` není, takže by nikdo nemohl přegenerovat dokument ani ověřit
odchylku proti commitnuté verzi.

Generátor si teď chybějící hodnoty doplní sám a jen ty chybějící, takže skutečné
prostředí má přednost. Dvě z nich stály za pozornost:

- `DATA_DIR` musí být adresář, který SKUTEČNĚ existuje a jde do něj zapsat,
  protože to validace ověřuje voláním na disk. Výchozí `/data` je cesta uvnitř
  kontejneru a jinde neexistuje. Bere se `tmpdir()`.
- `MIGRATE_ON_START` musí být `false`, jinak validace trvá na roli migrátora.
  Generátor nemigruje, jen čte definice cest.

Ověřeno s `env -u` na všech pěti proměnných: 136 cest, 180 operací, obě
varianty výstupu, brána `openapi-drift` zelená.

Poučení: nástroj, který vyrábí artefakt do repozitáře, musí běžet na čistém
stroji. Když potřebuje prostředí, dodá si atrapy sám, jinak funguje jen
u toho, kdo ho zrovna napsal.

### I58. Fronta úloh neměla kde vzniknout, worker padal na oprávnění

- **Našel:** P16 při startu kontejneru
- **Uzavřeno:** 2026-08-02, migrace 0007 zakládá schéma `pgboss`

Worker se připojuje pod `DATABASE_URL`, tedy jako `mlain_app`, a pg-boss si při
startu zakládá vlastní schéma a tabulky. Aplikační role ale nemá `CREATE` na
databázi, takže padal hned:

```
error: permission denied for database mlain   (SQLSTATE 42501)
  at Contractor.create ... PgBoss.start ... main
```

Migrace 0005 rozdává práva ve schématu `public`, což `CREATE` na úrovni
DATABÁZE není. Zvenčí to vypadá jako chyba oprávnění, přitom šlo o objekt,
který nikdy nikdo nezaložil.

Nabízely se dvě cesty. Pustit workera pod rolí migrátora je rychlejší, ale
dalo by mu vlastníka celého schématu, tedy právo měnit i tabulky, do kterých
nemá co zasahovat. Zvolená cesta drží pravidlo, že schéma vlastní jedině
migrátor: schéma vzniká migrací a aplikační role v NĚM smí zakládat objekty,
protože tvar tabulek pg-boss patří knihovně, ne našim migracím.

Vedlejší nález, který odhalila chyba při psaní té migrace: přidal jsem do ní
`ALTER DEFAULT PRIVILEGES FOR ROLE mlain_app`, aby na tabulky dosáhl sender,
a migrace spadla na `permission denied to change default privileges`. Měnit
výchozí oprávnění cizí role smí jen její člen nebo superuživatel. Při opravě
se ukázalo, že **sender pg-boss nepoužívá vůbec** a má vlastní outbox
v `public`. Rozdával jsem práva, která nikdo nechce.

Poučení: chyba oprávnění nemusí znamenat chybějící `GRANT`. Někdy znamená
chybějící objekt. A když databáze odmítne příkaz, který se zdá rozumný, stojí
za to nejdřív ověřit, jestli ten příkaz vůbec potřebujeme.

### I59. Výchozí instalace nespustila sender, chyběla jedna proměnná

- **Našel:** P16 při startu kontejneru
- **Uzavřeno:** 2026-08-02, entrypoint ji odvozuje z `APP_URL`

`docker/compose.yml` nenastavoval `TRACKING_DOMAIN`. Konfigurace v Node si ji
umí odvodit z `APP_URL`, jenže sender je binárka v Go a `APP_URL` nedostává
(nález K7 plánu P09), takže je pro něj povinná:

```
konfigurace je neplatná:
  - TRACKING_DOMAIN: chybí. Sender z ní staví odkazy /t/o/, /t/c/ a /u/.
```

Ve výchozím `MODE=all` to znamená, že celý kontejner skončí v restartové
smyčce, přestože web i worker naběhly. Tedy: čerstvá instalace podle návodu
nenaběhne.

Odvození nešlo dát do Compose. Zkoušel jsem `${TRACKING_DOMAIN:-${APP_URL#*://}}`
a končí to na `invalid interpolation format`: Compose umí jen
`${VAR:-výchozí}`, ne úpravu řetězce. Patří to proto do `entrypoint.sh`, kde
je skutečný shell, a před validaci konfigurace.

Ověřeno skutečným během v kontejneru, ne úvahou nad zápisem:

```
https://mail.firma.cz            -> mail.firma.cz
http://localhost:3000            -> localhost
https://mail.firma.cz:8443/app   -> mail.firma.cz
```

Výslovně nastavená hodnota se nepřepisuje, což potřebuje každý, kdo má odkazy
na jiné doméně kvůli doručitelnosti.

Poučení: proměnná s rozumnou výchozí hodnotou v jednom jazyce nemá výchozí
hodnotu v druhém. Hranice mezi TypeScriptem a Go je i hranicí platnosti všeho,
co se „odvodí automaticky".

### I60. Postgres kontroluje oprávnění dřív než existenci

- **Našel:** P16 při startu kontejneru, podruhé po opravě I58
- **Uzavřeno:** 2026-08-02, pg-boss si schéma staví pod migrátorem

Oprava nálezu I58 nestačila. Schéma `pgboss` migrace založila, a worker přesto
padal na tomtéž:

```
error: permission denied for database mlain   (SQLSTATE 42501)
  at Contractor.create ... PgBoss.start ... main
  file: 'aclchk.c', line: '2793', routine: 'aclcheck_error'
```

`PgBoss.start()` volá `Contractor.create()` a ten pouští
`CREATE SCHEMA IF NOT EXISTS`. Klíčové je, že **`IF NOT EXISTS` pád neodvrátí**:
Postgres kontroluje oprávnění DŘÍV než existenci, takže role bez `CREATE` na
databázi dostane 42501, i když schéma dávno existuje. Je to vidět na tom, že
chyba přichází z `aclchk.c`, tedy z kontroly práv, ne z „už existuje".

První pokus o řešení byl vlepit vygenerované SQL knihovny do migrace přes
`getConstructionPlans()`. Zavrženo po vyzkoušení, protože není idempotentní:

```
pokus 1: OK
pokus 2: ERROR: type "job_state" already exists
```

Druhá instalace by tedy spadla.

Použité řešení: schéma si pg-boss postaví a zmigruje sám, ale v `mlain migrate`
pod rolí MIGRÁTORA, a worker pak jede s `migrate: false` a jen kontroluje.
Knihovna si existující instalaci pozná a dopočítá jen chybějící, takže je to
idempotentní. Tvar tabulek zůstává věcí knihovny, což je správně: mění se s její
verzí a do našich migrací nepatří.

Ověřeno oběma směry: dvojí běh `mlain migrate` nic nerozbije a pg-boss pod
`mlain_app` s `migrate: false` nastartuje a zařadí úlohu.

Poučení: `IF NOT EXISTS` chrání před konfliktem, ne před chybějícím oprávněním.
A když knihovna nabízí „vygeneruj mi SQL", stojí za to ho spustit dvakrát dřív,
než ho někam vlepíš.

### I61. Táž proměnná měla v TypeScriptu a v Go neslučitelný tvar

- **Našel:** P16 při startu senderu
- **Uzavřeno:** 2026-08-02, sjednoceno na absolutní URL

`TRACKING_DOMAIN` se v každém jazyce chápala jinak:

- `packages/core/src/config/load.ts` odvozovala výchozí hodnotu jako
  `new URL(APP_URL).host`, tedy holý host.
- `apps/sender/internal/config/load.go` vyžadovala absolutní URL se schématem.

Výchozí hodnota vyrobená TypeScriptem tedy neprošla validací v Go:

```
konfigurace je neplatná:
  - TRACKING_DOMAIN: "localhost:4600" není absolutní URL se schématem
```

Kdo proměnnou nenastavil ručně, dostal buď „chybí" (sender `APP_URL` nevidí,
nález K7), nebo po odvození „není absolutní URL". **Obě větve končily tím, že
sender nenastartoval.** Zod to nechytil, měl jen `z.string().min(1).optional()`,
takže propouštěl cokoli neprázdného.

Rozhodnuto podle toho, co s hodnotou sender DĚLÁ: skládá odkazy prostým
spojením, `base() + "/t/o/" + token`. Z holého hostu vznikne řetězec, který
v e-mailu není odkaz, takže věcně má pravdu Go a TypeScript se srovnal na něj.
Jméno proměnné je matoucí, ale přejmenování by rozbilo existující instalace.

Srovnáno na čtyřech místech: odvození, schéma zod, entrypoint a compose.
Původní test čekal holý host a po změně správně spadl; nahradily ho tři, které
měří nové pravidlo včetně odmítnutí hodnoty bez schématu.

Poučení: sdílená proměnná napříč dvěma jazyky potřebuje jeden zdroj pravdy
o svém TVARU, ne jen o jménu. Validace, které si každá strana napíše sama,
se rozejdou a projeví se to až tam, kde se obě strany potkají, tedy v provozu.

### I62. Pořadí zakládání front bylo neškodné, dokud si je pg-boss dělal sám

- **Našel:** P16 při startu kontejneru, potřetí v téže oblasti
- **Uzavřeno:** 2026-08-02, prohozeny dva bloky v `registerQueues`

Po opravě nálezu I60 kontejner spadl znovu, tentokrát jinak:

```
Error: Queue platform.webhook_fanout.dlq does not exist
RestartCount 9
```

V databázi byla JEDNA fronta, a to ještě interní `__pgboss__send-it`, přestože
registr jich deklaruje 63.

Zajímavé je, že `registerQueues()` volalo `createQueue()` celou dobu, pro fronty
i pro jejich DLQ. Vadilo POŘADÍ: zakládala se napřed hlavní fronta s volbou
`deadLetter: <jméno>.dlq` a teprve po ní ta DLQ. pg-boss trvá na tom, aby cílová
fronta v tu chvíli existovala.

Podstatné je, PROČ to nikdy dřív nevadilo. Dokud si pg-boss migroval schéma sám,
zakládal si chybějící fronty mimoděk při prvním `send`, takže na pořadí
nezáleželo. Oprava nálezu I60, tedy `migrate: false`, tu shovívavost odstranila
a z neškodného pořadí se stal blokátor. Jedna správná oprava tak odhalila vadu,
která tam ležela od začátku.

Ověřeno spuštěním skutečného workera proti čisté databázi: 61 front, 37 DLQ,
99 řádků v `pgboss.queue`, nula chyb v logu.

Poučení: „funguje to" může znamenat „funguje to díky shovívavosti někoho
jiného". Když se ta shovívavost odstraní, vypadne ven pořadí, na kterém dosud
nezáleželo.

### I63. Sender si sám vypínal kontrolu, protože sloupec chyběl

- **Našel:** P16 v logu kontejneru
- **Uzavřeno:** 2026-08-02, migrace 0008 sloupec doplňuje

```
{"level":"WARN","msg":"compile_meta_column_missing",
 "detail":"campaigns.compile_meta ve schématu není, kontrola počtu značek se vypíná"}
```

Sender čte z `campaigns.compile_meta` hodnotu `clickMarkerCount` a porovnává ji
s počtem značek prokliku, které v těle skutečně našel. Sloupec ve schématu
nebyl, takže sender kontrolu sám vypnul a napsal o tom jedinou řádku do logu.

Nic nespadlo. Odesílání běželo dál, jen bez ochrany proti rozbité kompilaci
šablony. Je to táž třída vady jako readiness vracející 200 nad prázdným
schématem (nález I37): měřidlo se samo odpojí a ohlásí to způsobem, který nikdo
nečte.

Shovívavost v senderu zůstává schválně, protože musí umět běžet i proti starší
databázi během postupného upgradu. Nová instalace ten sloupec má.

Při té příležitosti byl zvážen i `messages.audience_campaign_id`, hlášený jako
chybějící požadavek. NEPŘIDÁN: prohledáním kódu se ukázalo, že ho nečte nikdo,
ani TypeScript, ani Go. Sloupec bez spotřebitele je jen další věc, kterou bude
někdo za rok udržovat a nebude vědět proč.

Poučení: hlídej varování, po kterých se něco VYPNE. Chyba se opraví, protože
bolí; tiché vypnutí kontroly nebolí nikoho, dokud se neprojeví to, proti čemu
ta kontrola stála.

### I64. CSP nonce šel do odpovědi místo do požadavku, v produkci nefungovalo NIC

- **Našel:** P16 při průchodu zlatou cestou v produkční image
- **Uzavřeno:** 2026-08-02, CSP se předává i v hlavičkách požadavku

Nejvážnější nález celého dne. `applySecurityHeaders()` skládal politiku
s nonce a zapisoval ji do hlaviček ODPOVĚDI. Next.js si ale nonce bere
z hlaviček POŽADAVKU, které mu middleware podstrčí přes
`NextResponse.next({ request: { headers } })`, a razítkuje jím své bootstrapové
inline skripty.

Prohlížeč tedy dostal přísnou politiku a skripty bez nonce, takže je zablokoval:

```
Executing inline script violates the following Content Security Policy directive
'script-src 'self' 'nonce-069ECiHwJXjyRUy2+mUsvA=='. The action has been blocked.
```

Devětkrát na stránku. **Následek: React se vůbec nenamountoval a v celé
aplikaci nefungovalo nic.** Stránka se vykreslila ze serveru, vypadala hotově,
a žádné tlačítko, formulář ani navigace nereagovaly. Doloženo na výběru jazyka
v průvodci prvním spuštěním: klik proběhl, `data-state` zůstal `closed`,
nabídka měla nula položek.

Dvě věci dělají tenhle nález obzvlášť zákeřným.

**Vada je výhradně produkční.** V dev režimu politika obsahuje `'unsafe-eval'`
a inline bootstrap má jiný tvar, takže se nic neprojeví. Lokálně tedy všechno
funguje a rozbité je jen to, co dostane zákazník.

**Test na to existoval a procházel.** Jmenoval se „nonce předá dál v hlavičce
požadavku", ale kontroloval `x-nonce` na ODPOVĚDI, tedy hlavičku, kterou nikdo
nečte: `grep -rn "x-nonce" apps/web/src` mimo `proxy.ts` najde jediný výskyt,
a to právě v tom testu. Ochrana nefungovala ani jedním směrem a měřidlo tvrdilo,
že je vše v pořádku.

Test je přepsaný na shodu, ne na existenci: nonce v CSP se musí rovnat tomu
v `x-middleware-request-x-nonce`. Ověřeno tím, že po vrácení staré podoby proxy
padne jmenovitě.

Poučení: hlavička nastavená na odpovědi a hlavička předaná dál do požadavku
jsou dvě různé věci a framework čte jen jednu z nich. A test, který ověřuje
„hodnota je neprázdná", neměří nic; musí ověřovat, že se ta hodnota dostala
tam, kde ji někdo použije.

### I65. Stránky závislé na relaci se předrenderovávaly

- **Našel:** hlavní agent při produkčním buildu
- **Uzavřeno:** 2026-08-02, 27 stránek dostalo `force-dynamic`

`next build` padal na předrenderu stránky nastavení profilu:

```
TypeError: Cannot read properties of null (reading 'useContext')
Error occurred prerendering page "/cs/settings/profile"
```

Sedmadvacet stránek volá `requireUser()` nebo `apiFetch()`, tedy závisí na
přihlášeném uživateli, a ani jedna to Nextu neříkala. V době sestavení žádná
relace neexistuje, takže se to muselo rozbít.

Chyba přitom na příčinu vůbec neukazuje a svádí hledat vadu v komponentách.

Opraveno hromadně, ne stránku po stránce, protože po zkušenosti s nálezem I54
je jasné, že opravovat projevy jeden po druhém je hra na krtky. Statická podoba
takové stránky stejně neexistuje: obsah je pro každého jiný.

### I66. Per-request nonce a předrenderovaná stránka se vylučují z principu

- **Našel:** P16 po opravě nálezu I64, která nestačila
- **Uzavřeno:** 2026-08-02, jedenáct stránek dostalo `force-dynamic` plus brána

Oprava nálezu I64 byla nutná, ale ne dostatečná. Nonce se sice dostal do
hlaviček požadavku, a `/setup` byl přesto mrtvý: devět blokovaných inline
skriptů, React nenamountovaný.

Příčina je logická, ne technická. Proxy vyrábí nonce PRO KAŽDÝ POŽADAVEK.
Předrenderované HTML vzniká PŘI STAVBĚ, kdy žádný požadavek neexistuje, takže
do něj nonce nemá jak vstoupit. Za běhu pak prohlížeč dostane přísnou politiku
a skripty bez nonce a zablokuje je. **Ty dvě věci se vylučují vždycky**, ne
shodou okolností.

V tabulce tras z `next build` to bylo vidět jako značka `●`:

```
├ ● /[locale]/setup          <- SSG, prerendered as static HTML
├ ● /[locale]/forgot-password
├ ƒ /[locale]/login          <- Dynamic, server-rendered on demand
```

Postiženy byly dvě stránky přes `generateStaticParams` nad locale a dalších
devět, které o sobě Nextu neříkaly nic a nechaly ho rozhodnout: přehled
projektu, nastavení, statistiky kampaní, report kampaně, časová osa kontaktu,
značka a kořenová stránka.

Zvlášť zlé je, že `/setup` je úplně první obrazovka po instalaci. Nový zákazník
by viděl formulář, do kterého nejde nic vyplnit.

Vznikla brána `apps/web/test/ci/no-static-pages.test.ts`. Dvě rozhodnutí v ní
stojí za zaznamenání:

Čte ZDROJ, ne výstup `next build`. Tabulka tras je čitelnější, ale existuje až
po stavbě, tedy pozdě a jen tam, kde někdo stavěl.

Dovoluje výslovné `force-static`. Vada nebyla statičnost, ale CHYBĚJÍCÍ
ROZHODNUTÍ: `/setup` neměl ani jedno. `/t/expired` má `force-static` vědomě
a je to správně, protože nemá jediný interaktivní prvek. Brána proto vyžaduje
rozhodnutí, ne konkrétní volbu.

Poučení: když oprava odstraní příznak jen zčásti, zbytek většinou není další
vada téhož druhu, ale předpoklad, který nikde nestojí napsaný. Tady zněl
„každá stránka se vykresluje na požadavek", a nikdo ho nevymáhal.

### I67. NODE_ENV z .env.local vyrobilo dvě instance Reactu v jednom procesu

- **Našel:** hlavní agent zadáním, dohledal agent na plný úvazek
- **Uzavřeno:** 2026-08-02, skript `build` vynucuje `NODE_ENV=production`

`next build` padal na hlášce, která mířila úplně jinam, než byla příčina:

```
TypeError: Cannot read properties of null (reading 'useContext')
Export encountered an error on /_global-error/page, exiting the build.
```

Null nebyl modul Reactu, jak to svádí číst, ale **dispatcher uvnitř něj**.
V jednom procesu vznikly DVĚ instance Reactu:

- chunky se zkompilovaly natvrdo proti produkčnímu runtime, protože se to
  rozhoduje v čase kompilace,
- renderer si Next vybral za běhu podle `NODE_ENV`, tedy vývojový.

`OuterLayoutRouter` pak volal `useContext` z produkční instance, zatímco
rendrovala vývojová, a `ReactSharedInternals.H` produkční instance byl `null`.
Next navíc rámce z `next-server` v zásobníku skrývá, takže bylo vidět jen
`OuterLayoutRouter`.

Kde se vzalo špatné `NODE_ENV`: v `apps/web/.env.local` je `NODE_ENV=development`
a doporučený postup „před buildem si načti prostředí přes `set -a && . .env.local`"
ho vyexportuje do shellu. `next build` si `NODE_ENV` doplní jen tehdy, když
NENÍ nastavené, takže ho nepřepsal, a `turbo.json` ho má v `globalEnv`, takže
prošlo i přes turbo.

Vysvětluje to i nedeterminismus (podle rozdělení tras mezi devět prerender
workerů padala pokaždé jiná stránka) a to, proč nepomohla vlastní
`global-error.tsx`: s tou komponentou to nikdy nesouviselo.

Potvrzeno nezávisle: vercel/next.js#95119, kde reportér dospěl k témuž.
Oprava v Nextu žádná není.

Skript `build` teď `NODE_ENV=production` vynucuje a `next.config.ts` má hlídač,
který build shodí s čitelnou hláškou, kdyby ho někdo pustil ručně mimo skript.

Poučení: chybová hláška ukazuje na místo, kde se to projevilo, ne kde to
vzniklo. A soubor s vývojovým prostředím načtený do shellu ovlivní i nástroje,
o kterých se to nečeká.

### I68. Server volal vlastní API přes veřejnou adresu

- **Našel:** P16 při průchodu instalací v produkční image
- **Uzavřeno:** 2026-08-02, na serveru loopback, v prohlížeči relativní cesta

`getApiBaseUrl()` vracelo `APP_URL` pro server i pro prohlížeč. `APP_URL` je
ale adresa, na kterou chodí PROHLÍŽEČ. Serverová akce běží uvnitř kontejneru,
kde ta adresa neplatí: aplikace tam poslouchá na `PORT`, kdežto `APP_URL` nese
port namapovaný na hostiteli, nebo rovnou veřejnou doménu za reverzní proxy.

Dokončení průvodce prvním spuštěním proto skončilo takhle:

```
1:{"status":"error","problem":{"status":503,"instance":"/api/v1/setup",
   "code":"service_unavailable"}}
```

a uživatel viděl „Server neodpovídá. Nepodařilo se nám spojit se serverem."

Podstatné je, PROČ to nikdo nezachytil dřív. Lokálně i ve většině testů se
vnější a vnitřní port shodou okolností SHODUJÍ, takže volání projde náhodou.
Odhalilo to teprve prostředí, kde je zvenčí 4600 a uvnitř 3000. V běžném
produkčním nasazení, tedy na HTTPS doméně za reverzní proxy, by se **žádná
serverová akce nedovolala do vlastního API** a instalace by vypadala živě,
ale první obrazovka by nešla dokončit.

Nově se na serveru míří na `http://127.0.0.1:${PORT}`, což nejde ven
z kontejneru a nedotýká se DNS, TLS ani reverzní proxy. V prohlížeči se vrací
prázdný základ, tedy relativní cesta na tentýž původ: ta se nemůže rozejít
s tím, co uživatel vidí v adresním řádku.

Pět nových testů, ověřeno tím, že se starým chováním padnou čtyři. Jeden z nich
hlídá opačný směr, tedy že se v prohlížeči nesáhne na loopback, protože ten by
vedl na počítač uživatele.

Poučení: prostředí, kde se vnější a vnitřní port shodují, je pohodlné a lživé.
Testovat proti kontejneru s JINÝM vnějším portem je levné a chytá celou třídu
vad, které se jinak projeví až u zákazníka.

### I69. Docker nastavuje HOSTNAME a Next se na něj váže

- **Našel:** P16 po opravě nálezu I68, která bez tohohle nemohla zabrat
- **Uzavřeno:** 2026-08-02, `HOSTNAME=0.0.0.0` v Dockerfile

Oprava nálezu I68 přesměrovala volání ze serveru na loopback. Nefungovalo to,
protože **Next uvnitř kontejneru na loopbacku vůbec neposlouchá.**

`server.js` z Next standalone má na řádku 15:

```js
const hostname = process.env.HOSTNAME || '0.0.0.0'
```

a Docker do KAŽDÉHO kontejneru nastavuje `HOSTNAME` sám, na jeho ID. Next si to
vezme jako adresu k navázání a poslouchá jedině na IP kontejneru:

```
HOSTNAME=12fdfa58ad13
pres hostname kontejneru:  HTTP 200
pres loopback:             ECONNREFUSED
```

Zvenčí se to neprojeví nijak, protože mapování portu míří přesně na tu IP.
Jediná stopa je řádek ve startovacím logu, kde místo `http://localhost:3000`
stojí `http://<id kontejneru>:3000`, a toho si nikdo nevšimne.

Je to proměnná, kterou nikdo nehledá, protože ji nikdo nezapsal. U řádku
v Dockerfile je proto komentář začínající větou, že se nesmí smazat, i když
vypadá zbytečně; bez ní ho někdo při úklidu vyhodí.

Ověřeno obojí zvlášť: `docker run --rm alpine sh -c 'echo $HOSTNAME'` vrátí ID
kontejneru, s `-e HOSTNAME=0.0.0.0` vrátí nulovou adresu.

Poučení, a je to poučení o postupu, ne o Dockeru: **když oprava nezabere,
neopravuj znovu jinak, ale ověř předpoklad, na kterém stála.** Ten zdejší zněl
„aplikace poslouchá na loopbacku" a nikdo ho nikdy neověřil. Bez toho by se
došlo k závěru „loopback nefunguje" a hledala by se chyba v adrese.

### I70. Průvodce uživatele založil a nepřihlásil

- **Našel:** P16 při průchodu zlatou cestou
- **Uzavřeno:** 2026-08-02, `runSetup` zakládá relaci v téže transakci

Po dokončení průvodce prvním spuštěním proběhlo všechno: správce vznikl,
projekt vznikl, přesměrování na `/w/{slug}` proběhlo. Prohlížeč ale neměl
jedinou cookie a proxy poslala uživatele na přihlašovací formulář, hned po tom,
co si nastavil heslo.

Nabízelo se hledat vadu v přeposílání `Set-Cookie` ze serverové akce do
prohlížeče, protože akce volá API po HTTP a odpověď API není odpovědí pro
prohlížeč. Ten mechanismus ale v repu je a funguje: `apiMutate` volá
`forwardSetCookies()`, která hlavičky zapíše přes `cookies()` z `next/headers`.

Skutečná příčina byla o krok dřív: **`POST /api/v1/setup` žádnou cookie
nevracel**, protože `runSetup()` relaci nikdy nezakládal. Vracel jen
`{ user, workspace }`, kdežto `login` vedle toho zakládá relaci a cookie posílá.
Nebylo tedy co přeposlat.

Relace se nově zakládá UVNITŘ TÉŽE TRANSAKCE jako uživatel a projekt, takže
nemůže vzniknout správce bez relace ani relace bez správce. Token se do těla
odpovědi schválně neposílá, patří výhradně do cookie s `HttpOnly`.

Poučení: než začneš hledat, kde se hodnota ztrácí, ověř, jestli vůbec vzniká.
Chybějící krok se snadno splete s rozbitým přenosem, protože projev je stejný.

### I71. Komponenty existovaly, měly testy, a nikdo je nevykresloval

- **Našel:** P16 při průchodu zlatou cestou
- **Uzavřeno:** 2026-08-02, oba panely zapojeny do Přehledu

Na Přehledu projektu nebyl jediný `role="region"`. `OnboardingPanel`
a `DemoDataBanner` přitom v repu existovaly, měly vlastní jednotkové testy
a ty procházely. Jen je nikdo nezapojil do stránky (rozhraní I→P14.1).

Nový uživatel tedy po instalaci nedostal žádnou pobídku, co dělat dál, a to na
obrazovce, která je k tomu určená.

Podstatné je, PROČ to jednotkové testy nechytily: měřily komponenty izolovaně
a o tom, jestli je někdo vykresluje, nevěděly nic. Zelený test komponenty je
důkaz, že komponenta funguje, ne že je v aplikaci vidět.

Poučení: mezi „komponenta je hotová" a „uživatel ji uvidí" je krok, který
neměří žádný jednotkový test. Chytne ho jedině průchod celou cestou.

### I72. Podmíněné vykreslení skrylo chybu, protože ji nikdo nelogoval

- **Našel:** P16 při průchodu zlatou cestou
- **Uzavřeno:** 2026-08-02, doplněn kontext projektu a logování selhání

Panel prvních kroků se nevykresloval ani po zapojení do Přehledu (nález I71).
Volání `GET /api/v1/onboarding` ze serverové komponenty vracelo 404:

```
route:"/api/v1/onboarding", status:404, workspace_id:null, actor_type:null
route:"/api/v1/onboarding", status:200, workspace_id:"019fc06f-…"   <- s hlavičkou
```

Autentizace skládá projekt z hlavičky `X-Workspace-Id`, nebo ze segmentu
`/w/{slug}` v cestě. Volání ze serveru míří na `/api/v1/onboarding`, kde žádný
takový segment není, a hlavičku nikdo nenastavil. `apiFetch` přitom parametr
`workspaceId` umí, jen mu ho volající nedal.

Podstatnější než ta oprava je ale to, PROČ se vada schovala. Kód zněl:

```tsx
{onboarding.ok && <OnboardingPanel state={…} />}
```

To je **tichý přeskok**: když čtení vždycky selže, komponenta se nikdy
nevykreslí a nikde se to neukáže. Výsledek vypadá, jako by tam ta komponenta
nikdy neměla být, ne jako porucha. Selhání se teď zapisuje do serverového logu
i s celým Problem objektem.

Za pozornost stojí, kolik vrstev ta jediná chybějící věc měla. Komponenta
existovala a byla otestovaná, ale nikdo ji nevykresloval (I71). Pak byla
zapojená, ale její data vždycky selhala. A to selhání se nikde neukázalo.
Každá z těch tří vrstev sama o sobě vypadala jako hotovo.

Poučení: podmíněné vykreslení podle úspěchu čtení potřebuje větev pro neúspěch,
aspoň do logu. Bez ní je rozdíl mezi „nic tu není" a „nepodařilo se to načíst"
neviditelný, a to i tomu, kdo se na stránku dívá zblízka.

### I73. Skořápka nemontovala providery, šest domén to obcházelo

- **Našel:** P16 poté, co zapojení panelu shodilo celý Přehled
- **Uzavřeno:** 2026-08-02, providery ve skořápce plus brána

`useToast` mimo `ToastProvider` a `Tooltip` mimo `TooltipProvider` vyhodí
výjimku. Skořápka projektu ani jednoho nemontovala.

Projev je horší, než by čekal ten, kdo přidává komponentu: **chyba v klientské
komponentě neshodí komponentu, ale celý strom po nejbližší error boundary.**
Zapojení jednoho panelu na Přehled tedy nejen nepřidalo panel, ono rozbilo
i dlaždice, které předtím fungovaly. Uživatel místo obrazovky viděl:

```
heading "Aplikace se neočekávaně zastavila"
⨯ Error: useToast se smí volat jen uvnitř ToastProvider.  digest: '1464532984'
```

Do té doby to obcházely domény samy: `contacts/layout.tsx`, `lists/layout.tsx`,
`tags/layout.tsx`, `suppressions/layout.tsx` a `settings-toasts.tsx`, každá
s poznámkou „až je skořápka dostane, tenhle soubor zmizí". Pět obchází, a šestou
právě přidávala další doména. Sedmá obrazovka by spadla stejně.

Jednotkové testy to nechytnou z principu: montují si providery samy, takže měří
komponentu, ne její zasazení. Obě komponenty měly 17 zelených testů.

Providery jsou teď ve skořápce a obalují `AppShell`, ne naopak; uvnitř by
nedosáhly na topbar ani na boční menu a tooltip v navigaci by spadl dál.
Hlídá to `apps/web/test/ci/shell-providers.test.ts`. Vnořené providery nevadí,
takže staré obcházky můžou mizet postupně.

Poučení, a je to poučení o mém postupu: zapojil jsem komponentu do stránky
a neověřil, že se ta stránka pořád vykreslí. Build byl zelený a testy taky,
jenže ani jedno neměří, jestli obrazovka opravdu naběhne. Když se přidává
klientská komponenta do cizí stránky, je potřeba tu stránku otevřít.

### I74. Šest klientských volání neposílalo projekt, chyba se hlásila jako prázdno

- **Našel:** P16 na Přehledu, dohledáno agentem
- **Uzavřeno:** 2026-08-02, projekt se odvozuje z adresy prohlížeče

Na čerstvé instalaci hlásily čtyři ze šesti dlaždic Přehledu chybu:

```
region "Odesláno":          alert: Tuhle dlaždici se nepodařilo načíst.
region "Problémy":          alert: Tuhle dlaždici se nepodařilo načíst.
region "Na webu právě teď": alert: Tuhle dlaždici se nepodařilo načíst.
region "Poslední kampaně":  alert: Tuhle dlaždici se nepodařilo načíst.
```

Zbylé dvě se přitom chovaly správně a hlásily „Zatím žádná odeslaná kampaň".

Backend byl v pořádku. Ověřeno přímým voláním `readDashboard()` proti čerstvě
zmigrované databázi bez kampaní: všech šest dlaždic vrátilo `status: 'ok'`
s prázdnými daty. Dotazy používají `coalesce()` a `LEFT JOIN` správně.

Vada byla v tom, že klientská volání neposílala hlavičku `X-Workspace-Id`.
Autentizace skládá projekt z té hlavičky, nebo ze segmentu `/w/{slug}` v CESTĚ
POŽADAVKU. `/api/v1/dashboard` žádný takový segment nemá, takže je hlavička
povinná. Bez ní vrací API 404 a klient si celý přehled uloží jako prázdný.

Rozdíl 4 versus 2 vysvětluje jediná věc: čtyři dlaždice mají dvoucestnou
podmínku (`ok` versus chyba), kdežto zbylé dvě trojcestnou, kde chybějící data
padnou do vlídné hlášky. Obě skupiny přitom dostaly totéž, tedy nic.

Netýkalo se to dvou míst, ale šesti: přehled, trend kampaní, report kampaně,
panel příjemců, časová osa kontaktu a živé statistiky.

Opraveno JEDNÍM místem, ne šesti: klient si projekt odvodí z `location.pathname`,
kde je slug vždycky, protože ten kód běží výhradně v prohlížeči. Výslovně
předaná hodnota má přednost. Protahovat parametr přes komponenty by znamenalo
čekat, až na to někdo u sedmého volání zapomene.

Poučení: když se táž chybějící hodnota objeví na šesti místech, není to šest
chyb, ale jedno špatně položené rozhraní. A obrazovka, která hlásí chybu jako
prázdno, je horší než ta, co spadne: uživatel nepozná, jestli tam nic není,
nebo se to nepovedlo načíst.

### I75. Hotové obrazovky zůstaly skryté příznakem pro nedodané

- **Našel:** P16, když zlatá cesta potřebovala obrazovku odesílání
- **Uzavřeno:** 2026-08-02, příznaky srovnány se skutečností plus brána

Položky navigace mají příznak `mvp0`, kterým se skrývají, dokud jejich obrazovka
neexistuje. To dává smysl. Nikdo ho ale nepřepnul zpátky ve chvíli, kdy
obrazovka vznikla, takže byly hotové a funkční obrazovky dostupné jedině přímou
adresou:

```
/settings/sending   odesílací účty a domény
/settings/backups   zálohy
```

Nic nespadlo, jen tam ta položka nebyla. Uživatel nemá jak zjistit, že obrazovka
existuje, a autor nemá jak zjistit, že ji nikdo nevidí. U odesílání to zastavilo
sedm kroků zlaté cesty, protože bez připojeného účtu se nedá poslat nic.

Vznikla brána `packages/ui/src/patterns/navigation/registry-screens.test.ts`,
která porovná příznak se skutečností: skrytá položka nesmí mít hotovou
`page.tsx`.

Při prvním běhu našla druhou polovinu téže vady, kterou nikdo nehlásil:
`settings-consent` vyžadoval `gdpr:read` a `settings-tracking` vyžadoval
`tracking:read`. **Ani jedno oprávnění neexistuje.** Kontrola by nikdy neprošla
a položku by neuviděl nikdo, aniž by cokoli selhalo. Je to týž tvar jako nález
I47 u nastavení AI, tedy už potřetí.

Opraveno na `gdpr:export` (kdo smí exportovat data subjektu, smí vidět souhlasy)
a `workspace:update` (nastavení měření mění chování celého projektu).

Poučení: příznak „ještě to není hotové" musí mít protějšek, který kontroluje,
jestli to pořád platí. Bez něj zůstane napořád, protože jeho odstranění není
ničí úkol a nikomu nic nepadá.

### I76. Tlačítko volalo obsluhu, kterou nikdo nedodal

- **Našel:** P16 při průchodu zlatou cestou
- **Uzavřeno:** 2026-08-02 (zadáno), dialog pro přidání účtu

Tlačítko „Přidat odesílací účet" nedělalo nic. `sending-settings.tsx` volá
`onAddProvider?.()`, jenže ten prop je volitelný a nikdo ho nepředává; `grep`
najde tři výskyty a všechny v tomtéž souboru.

Volitelný callback s otazníkem je tichý přeskok stejného druhu jako
`{x.ok && <Component/>}` z nálezu I72: chybějící obsluha se neprojeví ničím,
tlačítko je vidět, je aktivní, a po kliknutí se prostě nic nestane. Uživatel
nepozná, jestli to nefunguje, nebo jestli něco dělá špatně.

Zastavilo to sedm kroků zlaté cesty: bez odesílacího účtu se nedá poslat
kampaň, ověřit adresa ani zapnout zkušební režim.

Poučení: nepovinný callback dává smysl u komponenty, která má bez něj smysl.
U jediné akce prázdného stavu je povinný, protože prázdný stav bez cesty ven
není stav, ale slepá ulička.

### I77. Vypnuté měření se zobrazovalo jako nula

- **Našel:** hlavní agent hledáním nezapojených modulů
- **Uzavřeno:** 2026-08-02, `metricDisplay()` zapojena do modelu reportu

`packages/core/src/reports/metrics/display.ts` rozlišuje čtyři stavy metriky:
míru, absolutní číslo u malého vzorku, pomlčku a „neměří se". V jeho hlavičce
stojí přímo:

> Vypnutý tracking nikdy nesmí vypadat jako nula (3.16 části 5).
> Nula znamená „nikdo neotevřel", což je úplně jiná informace.

Funkci ale **nikdo nevolal**. `headlineTiles()` počítalo pole
`disabled: !payload.track_clicks`, které žádná komponenta nečetla, a dlaždice
vykreslovala `format.number(tile.count)` vždycky. Kampaň s vypnutým měřením
prokliků tedy hlásila velkou **nulu**. `small_sample` se v dlaždicích
neuplatňoval vůbec.

Vedle toho existovala druhá, částečná implementace téhož rozhodnutí
v `opensView()`. Byla věcně správná, ale byla to druhá kopie, takže se obě
mohly rozejít.

Je to nejzávažnější z nálezů o nezapojených modulech, protože se neprojeví
chybou: číslo tam je, vypadá věrohodně a znamená něco jiného. Uživatel podle
něj může usoudit, že kampaň nikoho nezaujala, přestože se prokliky vůbec
neměřily.

Nalezeno skriptem, který prošel všechny doménové moduly s testy a ověřil, jestli
je někdo volá. Za tentýž den to byl už čtvrtý případ tohohle tvaru (I71, I72,
zkušební režim, tenhle), proto to hledání vzniklo.

Poučení: zelený jednotkový test říká, že funkce počítá správně. O tom, jestli
ji někdo volá, neříká nic. Vyplatí se to hledat strojově, protože ručně se to
nepozná: v kódu nic nechybí, jen se nic neděje.

### I78. Asistent nabídl skládání šablony a nedodal nic

- **Našel:** hlavní agent hledáním nezapojených modulů
- **Uzavřeno:** 2026-08-02, nástroj `compose_template` zapojen

`composeTemplateDraft()` skládá návrh šablony ze zadání. Obrazovka asistenta
byla přitom celá hotová: formulář se zadáním, tónem, jazykem a délkou, kroky
generování i rozhodnutí nad návrhem se zálohou dokumentu.

Chyběl jediný článek. Trasa chatu měla
`composeTemplate: async () => unavailableTool('compose_template')`
s komentářem, že čeká na barrel `@mlain/core/templates`. Ten barrel mezitím
vznikl a nikdo se k tomu řádku nevrátil.

Uživatel tedy vyplnil zadání, viděl kroky generování a nedostal nic.

Poučení: zástupná implementace s poznámkou „čeká na X" potřebuje test, který
zčervená, jakmile X existuje. Jinak čeká dál i potom, co dorazilo, a nikdo se
to nedozví, protože to nikde nespadne.

### I79. Funkce, kterou je správné smazat, ne zapojit

- **Našel:** hlavní agent hledáním nezapojených modulů
- **Uzavřeno:** 2026-08-02, `nextSeq` smazána i s testem

Mezi nezapojenými funkcemi byla i `nextSeq` z `conversation-service.ts`, která
počítá pořadové číslo zprávy v konverzaci.

Nebylo to zapomenuté zapojení. Produkce ji vědomě nahradila lepším řešením:
`repo.appendMessage` dosazuje pořadí poddotazem uvnitř téhož `INSERT`, protože
dva dotazy za sebou by při souběžných zprávách spadly na porušení unikátního
indexu. **Zapojit ji zpátky by znamenalo vrátit souběhovou vadu.**

Smazána i s testem, na jejím místě je komentář, proč se nemá vracet.

Poučení stojí vedle nálezu I77, ne proti němu: nezapojený modul je podezřelý,
ne automaticky vadný. U každého je potřeba rozhodnout, jestli chybí zapojení,
nebo jestli ho něco lepšího nahradilo. Mrtvý kód s testem vypadá jako hotová
funkce a svádí k tomu ho někam připojit.

### I80. Codegen hledal obsluhy jen o patro níž, import kontaktů nefungoval

- **Našel:** agent při zapojování systémové pošty, dohledáno hlavním agentem
- **Uzavřeno:** 2026-08-02, codegen prochází i druhou úroveň

`apps/worker/codegen.mjs` procházel jen přímé podadresáře
`packages/core/src/<domena>/jobs/`. Domény `contacts/export` a `contacts/import`
jsou ale o úroveň hlouběji, takže je codegen **nikdy neviděl**, přestože obě
měly `queue-handlers.ts` i explicitní klíč v `exports` mapě.

Fronty importu a exportu kontaktů se tedy registrovaly BEZ OBSLUHY: úloha se
zařadila, nikdo si ji nevyzvedl a import prostě nikdy neskončil. Uživatel vidí
import, který se tváří, že běží.

Nic nespadlo. Worker při startu vypisuje počet front a z nich těch s obsluhou
(`queues: 61, with_handler: 10`), ale ten rozdíl nikoho netrkne, protože část
front obsluhu opravdu mít nemá.

Po opravě je `with_handler: 13`.

Hloubka je omezená na dvě úrovně schválně. Dál by se hledaly adresáře `jobs`
i tam, kde nemají co dělat, a jméno domény by přestalo odpovídat prefixu jména
fronty, podle kterého se odvozuje.

Poučení: automatické objevování souborů podle konvence je pohodlné a tiché.
Když konvenci někdo poruší o jednu úroveň, nic nespadne, jen se něco přestane
dít. Patří k němu kontrola, že každá deklarovaná fronta má obsluhu.

### I81. Sedm hotových obsluh kampaní nikdo neregistroval

- **Našel:** agent při zapojování systémové pošty
- **Uzavřeno:** 2026-08-02 (zadáno), chybí `campaigns/jobs/queue-handlers.ts`

`packages/core/src/campaigns/jobs/` obsahuje sedm hotových a otestovaných
obsluh: materializace, plánovač, hlídač, obnova po kvótě, rekontrola domény,
obnova kvóty a rekonciliace. Registr front na ně má jména.

Chybí ale soubor `queue-handlers.ts`, který codegen hledá, takže o nich neví
a fronty se registrují bez obsluhy. **Kampaň se tedy nikdy neodešle**: úloha
`campaign.materialize` se zařadí a nikdo si ji nevyzvedne.

Je to už pátý případ téže třídy za jediný den (I71, I72, I77, I80, tenhle):
kód napsaný, otestovaný, nezapojený. Tady navíc v nejdražším možném místě,
protože odeslání kampaně je hlavní funkce produktu.

Komplikace, kterou to má: všech sedm obsluh bere injektované závislosti a žádná
továrna na ně v repu není. Je to tatáž překážka jako u `content.brand_extract`
a `ai.cleanup_conversations`, které jsou proto zaregistrované přes
`needsDependencies()`, tedy jako obsluha, která při první úloze hlasitě řekne,
co chybí.

Poučení: mezi „logika je hotová a otestovaná" a „produkt to umí" je krok, který
neměří žádný jednotkový test. V tomhle repu se na něm dnes zaseklo pětkrát,
pokaždé v jiné doméně, takže to není nedbalost jednoho člověka, ale chybějící
kontrola. Test, že každá deklarovaná fronta má obsluhu, je levný.

### I82. Worker nemá čím číst napříč projekty, pět úloh proto nemůže fungovat

- **Našel:** agent při zapojování obsluh front kampaní
- **Stav:** OTEVŘENO, vyžaduje rozhodnutí o modelu oprávnění

Pět systémových úloh potřebuje výčet NAPŘÍČ projekty: plánovač kampaní
(`listWorkspaces`), hlídač běžících (`listRunning`), obnova po kvótě
(`listPaused`), rekonciliace outboxu a rekontrola domén (`listDue`).

Worker běží pod `DATABASE_URL`, tedy jako `mlain_app`, a ta bez nastaveného
`mlain.workspace_id` nevidí nic. Ověřeno spuštěním proti čerstvě zmigrované
databázi: `SELECT count(*) FROM workspaces` i `FROM campaigns` vrátí **nulu**,
přestože řádky existují.

Není to chybějící továrna, ale chybějící rozhodnutí. Migrace 0004 dává
`workspaces` jen politiky vázané na kontext, a cross-workspace čtení má
výhradně `mlain_sender` přes `sender_bypass`, který je pro ten účel napsaný
vědomě a dobře zdokumentovaný.

**Dopad:** naplánovaná kampaň se nikdy nespustí, protože ji plánovač nenajde.
Okamžité odeslání funguje, materializace je zapojená a ověřená.

Táž příčina stojí i za tím, že `platform.purge_workspaces` je zapojený, ale
nemaže nic: `DELETE FROM workspaces` pod `withoutContext` zasáhne nula řádků.
Ověřeno s projektem smazaným před 60 dny, vrátilo `DELETE 0`. Retence tedy
běží a tváří se, že uklízí.

**Doporučené řešení, až na to dojde:** vlastní role pro systémové skeny, tvarem
podle `sender_bypass`, tedy politika `USING (true)` na jmenovaný seznam tabulek
pro roli s vlastním připojením (`DATABASE_URL_MAINTENANCE`). Role
`mlain_maintenance` už existuje, ale má bypass jen na `web_events`.

`ALTER ROLE ... BYPASSRLS` se nepoužívá ze stejného důvodu jako u senderu: je
hrubší, platí na všechno včetně tabulek, kam worker nemá co sahat, a vyžaduje
superuživatele.

Do zapojení té role jsou dotčené úlohy zaregistrované přes `needsDependencies`,
takže při první úloze hlasitě řeknou, co chybí, místo aby tiše ležely ve frontě.
Rozdíl je vidět: `retry` s vysvětlením proti `created`, kterého si nikdo
nevšimne.

### I83. Dopočítávání cest nafukovalo image o 4 MB

- **Našel:** hlavní agent, změřeno P16 v hotové image
- **Uzavřeno:** 2026-08-02, schéma vyžaduje absolutní cesty

`packages/core/src/config/load.ts` dopočítával datové adresáře přes
`path.resolve()`. Turbopack ten výraz neumí vyhodnotit a hlásil:

```
Encountered unexpected file in NFT list
A file was traced that indicates that the whole project was traced
unintentionally.
```

Vystopoval tedy do serverového výstupu celý projekt. Řetěz vedl přes trasu
pro potvrzení adresy a službu zkušebního režimu, tedy přes nový kód; do té doby
se ten výraz do grafu žádné trasy nedostal.

Změřeno v hotové image, ne v builderu:

```
                   před        po        rozdíl
image celkem      246,0 MB   242,0 MB   −4,0 MB
/app/apps          33,6 MB    28,8 MB   −4,8 MB
  .next/server     21,0 MB    19,0 MB   −2,0 MB
varování NFT       2x         0x
```

Rezerva proti limitu 250 MB je tím dvojnásobná, 8 MB místo 4.

Za pozornost stojí, že se úspora nerozdělila rovnoměrně: `.next/server` ubral
2 MB, ale celý `/app/apps` 4,8 MB. Ten zbytek byly soubory, které vystopování
zatáhlo mimo `.next`, tedy přesně to „vystopoval celý projekt".

Oprava je věcná, ne obcházka: schéma konfigurace vyžaduje u `DATA_DIR`,
`UPLOADS_DIR` a `BACKUP_DIR` absolutní cestu, takže není co dopočítávat.
Relativní cesta u datového adresáře navíc znamená, že obsah instalace závisí
na tom, odkud se proces spustil, což je past sama o sobě.

Kontrola je `value.startsWith('/')`, ne `path.isAbsolute()`: ten by do modulu
vrátil `node:path` a s ním přesně to, kvůli čemu se zavádí.

Poučení k měření, ne k Turbopacku: úsporu ohlásil až `du` uvnitř hotové image.
Předchozí pokus u `sharp` vycházel na 122 MB měřeno na výstupu buildu a v image
neušetřil nic, protože se tam ty soubory nikdy nedostaly (nález o měření
v mezivrstvě, viz I56). Měřit se musí tam, o čem je řeč.
