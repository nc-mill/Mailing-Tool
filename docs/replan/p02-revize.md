# Revize plánu P02: kontrakty a golden fixtures

<!-- puvod-dokumentu -->
> **Historický záznam, ne platné zadání.** Revize plánu P02 (kontrakty a fixtures) z prověrky plánů
> (31. 7. až 1. 8. 2026), tedy kontrola **textu plánu před stavbou**, ne kontrola kódu.
> **Verdikt typu „plán není proveditelný" se týkal tehdejšího plánu, ne dnešního produktu.** Ten stojí a funguje.
> Opravy se prováděly podle `docs/superpowers/plans/POSTUP-OPRAV.md`; **stav jednotlivých nálezů neověřen**.
> **Dnešní stav:** `docs/superpowers/STAV-UKOLU.md` (živý dokument), design `docs/superpowers/DESIGN-INTEGRACE.md`.

Recenzovaný soubor: `docs/superpowers/plans/2026-07-31-p02-kontrakty-golden-fixtures.md` (7898 řádků, 21 úkolů)
Datum: 2026-08-01
Metoda: čtení plánu plus nezávislé ověření spuštěním proti PostgreSQL 18.4 v Dockeru a přepočet krypto vektorů v Node

## Verdikt

**VÝHRADY.**

Hlavní otázka zněla, jestli je zmrazený kontrakt skutečně proveditelný. **Je.** Ověřil jsem to spuštěním, ne čtením, a plán obstál v každém bodě, který jsem stihl přepočítat. Scénář `OB-00` existuje, skutečně spouští SQL proti reálné databázi, na obou stranách, a výslovně odmítá se přeskočit. Normativní SQL leží v souborech `.sql`, které čte TypeScript i Go, takže se neopisuje. Krypto vektory jsem přepočítal nezávisle a sedí bajt na bajt. Počet Liquid fixtures sedí na 54. Fixture `LQ-051` už rozporná není, plán ji vyřešil.

Plán navíc dělá něco, co jsem u ostatních neviděl: v kapitole 6 vede seznam toho, co při psaní **ověřil spuštěním**, a v kapitole 10 seznam osmi míst, kde zmrazený kontrakt nejde realizovat doslova, i s tím, jak se zachoval. Obojí jsem namátkově přezkoušel a nenašel jsem přikrášlení.

Výhrady jsou tři a žádná z nich není v jádru kontraktu. Dvě jsou drobné: ověřovací běh při psaní proběhl proti PostgreSQL 14 místo 18, a plán mění `apps/sender/go.mod`, který nevlastní. Třetí je vážnější a je to jediná věc, která musí být zavřená **před koncem vlny 0**: ze šesti věcí, které po P02 žádá plán P08, jsou dvě nedodané a dvě existují pod jiným jménem. Protože se kontrakt po vlně 0 zmrazuje a P08 do něj sáhnout nesmí, po zmrazení už to nepůjde opravit levně.

---

## Odpověď na hlavní otázku: `OB-00` a proveditelnost kontraktu

### `OB-00` skutečně spouští, nekontroluje přítomnost řetězce

**Kde:** úkol 2 (TypeScript, řádky 569 až 1152), úkol 3 (Go, řádky 1153 až 1401).

Plán scénář má a zachází s ním přesně tak, jak řídicí dokument žádá:

- Je **druhý úkol v pořadí, ne poslední**, a plán to zdůvodňuje větou „kontrakt bez spustitelného testu není kontrakt" (řádek 571).
- Bere každý z jedenácti normativních dotazů, spouští ho proti čerstvě založené databázi a ověřuje jedinou věc, totiž že neskončí chybou. Prázdný výsledek je úspěch.
- Používá `PREPARE` s **explicitními typy parametrů** a `EXPLAIN (COSTS OFF) EXECUTE` (rozhodnutí D2, řádek 57). Zdůvodnění je věcně správné: samotné `PREPARE` projde jen parserem a analyzátorem, plánovač se spustí až při `EXECUTE`, a `EXPLAIN` bez `ANALYZE` plán sestaví, aniž by cokoliv vykonal. Bez explicitních typů by `WHEN $1 = 'retry'` skončilo chybou `could not determine data type of parameter $1`.
- **Nesmí se přeskočit.** Go strana to vynucuje tvrdě (řádek 1191): `t.Fatal("DATABASE_URL_SENDER a DATABASE_URL_APP musí být nastavené; OB-00 se nesmí přeskočit")`. To je přesně ta vlastnost, jejíž absence je jinde v projektu opakovaným zdrojem falešně zelených testů.
- Běží v CI jako první, skript `test:schema` spojuje projekty operátorem `&&`, takže při pádu `OB-00` se zbytek nespustí a delší výpis jeho selhání nezamaskuje (řádek 442).

### Normativní SQL se importuje, neopisuje

Tohle byla druhá klíčová otázka a odpověď je uspokojivá. SQL leží v jedenácti souborech `packages/contracts/fixtures/outbox/sql/01-claim-running-campaigns.sql` až `11-campaign-pause.sql`. Testy je čtou přes `readFile` (řádky 2090 a 2098), Go strana přes symlink `apps/sender/testdata`. Plán to sám pojmenovává na řádku 2105:

> Testy pouští **tentýž soubor SQL**, který ověřuje `OB-00`. Kdyby si test SQL opsal, testoval by opis, ne kontrakt.

Jeden zdroj pravdy pro obě strany, tedy přesně to, co má být. Nenašel jsem místo, kde by se normativní dotaz opisoval do TS nebo Go zdrojáku.

### Ověřeno spuštěním proti PostgreSQL 18.4

Postavil jsem kontraktní bootstrap schéma z úkolu 2 doslova podle plánu, včetně všech čtyř indexů, obou partition, sloupcových grantů, RLS a politik `sender_bypass`, a pustil na něj **všech jedenáct** normativních dotazů:

| Co | Výsledek |
|---|---|
| `fixtures/outbox/schema.sql` na PG 18.4 | zakládá se bez chyby, včetně `citext`, `PARTITION BY RANGE (created_at)`, složeného klíče `(id, created_at)`, `uq_messages__campaign_contact` a úložných parametrů na obou partition |
| `01-claim-running-campaigns.sql` | `PREPARE` i `EXPLAIN` projdou |
| `02-claim-batch.sql` | `PREPARE` i `EXPLAIN` projdou; plán jde přes `LockRows` se `SKIP LOCKED`, **prořezává partition** (dotkne se jen `messages_y2026m08`) a páruje obě složky klíče |
| `03-heartbeat.sql` | `PREPARE` i `EXPLAIN` projdou, `unnest` dvou polí se páruje na `(id, created_at)` |
| `04` až `11` (reaper, shutdown, dispatch begin a result, materializace, suppression, pauza) | **všech osm** projde `PREPARE` i `EXPLAIN`, žádná chyba |
| zakázaný tvar claimu s `JOIN ... ON` | selže **přesně** předpovězenou hláškou |

Zvlášť stojí za zmínku `09-materialize-insert.sql` s `ON CONFLICT (campaign_id, contact_id, created_at) DO NOTHING`. Tenhle tvar vyžaduje unikátní index přesně nad těmi třemi sloupci a bootstrap schéma ho má (`uq_messages__campaign_contact`). Kdyby chyběl, skončilo by to tvrdou chybou, což je přesně ta past, kterou revize P03 popisuje u materializace. Tady je zavřená.

Ověřil jsem i **sloupcové granty pod skutečnou rolí `mlain_sender`**, tedy čtyři tvrzení z kapitoly 6 plánu. Všechna sedí:

```
DELETE FROM messages                      -> ERROR: permission denied for table messages
UPDATE messages SET created_at = now()    -> ERROR: permission denied for table messages
UPDATE messages SET status = 'pending'    -> UPDATE 0   (sender to smí)
UPDATE campaigns SET audience_built_at    -> ERROR: permission denied for table campaigns
```

Druhý řádek je ten důležitý: sloupec `created_at` ve výčtu grantu **schválně není**, čímž je invariant I1 vynucený databází, ne kázní implementátora. Třetí řádek dokládá, že zákaz není příliš široký a sender skutečně může dělat svoji práci.

Poslední řádek stojí za doslovný výpis, protože plán tu hlášku v kapitole 6 předpovídá slovo od slova:

```
ERROR:  invalid reference to FROM-clause entry for table "m"
DETAIL:  There is an entry for table "m", but it cannot be referenced from this part of the query.
```

Sedí. To je silný doklad, že autor plánu ten dotaz skutečně pouštěl a neopsal ho z hlavy.

Ověřil jsem také, že **`uuidv7()` je v PostgreSQL 18 nativní funkce**, takže náhrada za `gen_random_uuid()` při ověřovacím běhu proti PG 14 byla bezpečná a bootstrap schéma na cílové verzi funguje bez úprav.

---

## Výhrady

### V1. Ověřovací běh při psaní plánu proběhl proti PostgreSQL 14, produkt cílí na 18

**Kde:** kapitola 6, poslední odstavec (řádek 237).

Plán to sám přiznává a zdůvodňuje: PG 14 byla jediná verze dostupná na stroji, `uuidv7()` se nahradila funkcí vracející `gen_random_uuid()`, a autor tvrdí, že „žádný z dotazů nepoužívá syntaxi zavedenou po 14".

Tvrzení je pravdivé, ověřil jsem ho spuštěním na 18.4 u tří dotazů a bootstrap schématu. Přesto je to výhrada, ne poznámka, protože kapitola 6 je uvozená větou „implementátor to nemusí ověřovat znovu, jen to nesmí rozbít". U ověření provedeného na jiné major verzi, než na jakou produkt cílí, ta věta neplatí v plné síle.

**Kde opravit: v P02**, formulačně. Buď ověřovací běh zopakovat na PG 18 a tabulku aktualizovat, nebo z věty „nemusí ověřovat znovu" vyjmout řádky, které se běhu proti databázi týkají. Implementace sama pak `OB-00` proti 18 pouští, takže riziko je malé, ale slib v kapitole 6 je momentálně silnější než důkaz pod ním.

### V2. Plán mění `apps/sender/go.mod`, který nevlastní ani nepřebírá

**Kde:** kapitola 9.2 (řádek 7855).

P02 přidává do `go.mod` dvě závislosti (`github.com/osteele/liquid@v1.8.1` a `github.com/google/uuid@v1.6.0`) a poctivě to přiznává v tabulce „soubory, které plán mění, ale nevlastní", včetně omezení, že to smí jen příkazem `go get`, nikdy ruční editací.

Vlastnictví je ale rozdělené jinak: podle P01 kapitoly 1.2 zakládá `go.mod` plán P01 a **přebírá ho P09**, tedy plán z vlny 1. P02 tedy zapisuje do souboru, jehož budoucí vlastník ještě neexistuje a který si ho po sobě celý přepíše.

Prakticky to nejspíš projde, protože `go get` je aditivní a P09 bude `go.mod` rozšiřovat, ne přepisovat. Ale je to jediné místo v P02, kde plán sáhne mimo svoje hranice, a je to přesně ta třída předání, která jinde v projektu selhala tiše.

**Kde opravit: v P01**, doplněním. Nejčistší je přidat obě závislosti rovnou do kostry `go.mod` v úkolu 15 P01 (kde už pět závislostí je) a v P02 změnit kapitolu 9.2 na konstatování, že závislosti přebírá hotové. Tím zůstane `go.mod` u jediného vlastníka po celou vlnu 0.

---

### V3. Ze šesti věcí, které po P02 žádá P08, jsou dvě zcela nedodané a dvě pod jiným jménem

**Kde:** P02 úkoly 12 až 14 a 17. Protistrana: P08 (`2026-07-31-p08-sablony-model-renderer.md`), požadavek R5 na řádku 11887.

P08 vznáší na P02 šestidílný požadavek. Prošel jsem všech šest položek a porovnal je s tím, co P02 skutečně vystavuje:

| # | Co P08 žádá | Stav v P02 |
|---|---|---|
| 1 | doplnit `ML_RAW_` do `RESERVED_MARKERS` | **NEDODÁNO.** `RESERVED_MARKERS` (řádek 6461) obsahuje `['mlain.invalid', 'ML_OPEN_PIXEL', 'ML_ARG_']`, řetězec `ML_RAW_` se v celém P02 nevyskytuje ani jednou |
| 2 | opravit fixture `LQ-051` na `liquid_vocative_filter` | **DODÁNO**, jako `LQ-510` |
| 3 | doplnit kořen `_present` do jmenného prostoru | **DODÁNO**, přes `COMPILED_ONLY_ROOTS` |
| 4 | vystavit `validateCompiledLiquid` | **funkčně ano, jménem ne.** P02 vystavuje `validateLiquid(source, ctx)`, kde `ctx.level` nabývá hodnot `authored` nebo `compiled` (řádky 4751, 4773) |
| 5 | vystavit `createPreviewLiquid()` podle 3.11.1 | **nedodáno pod tímhle jménem.** P02 vystavuje `createHtmlEngine()` a `createTextEngine()` (řádky 5352, 5353) |
| 6 | vystavit `FieldCatalog`, `RenderSchema`, `toMergePath`, `toCatalogPath`, `prepareRenderData` | **částečně.** `FieldCatalog`, `RenderSchema` a `prepareRenderData` ano. `toMergePath` a `toCatalogPath` se v P02 nevyskytují vůbec |

Položky 4 a 5 jsou jen rozdíl v pojmenování, ale i ten stačí: P08 by import `validateCompiledLiquid` nepřeložil. Položky 1 a část 6 jsou skutečně chybějící funkčnost.

Váha nálezu je vyšší, než se zdá, kvůli pořadí vln. **P02 je ve vlně 0 a po jejím smergování je kontrakt zmrazený**, kdežto P08 je ve vlně 1 a do `packages/contracts` sáhnout nesmí. P08 navíc u položky 4 sám píše, že bez ní **nejde implementovat invariant I1**, protože autorská gramatika argumenty filtrů zakazuje a kompilovaná je má. Kdyby se to nedořešilo ve vlně 0, P08 buď zůstane stát, nebo poruší uzávěr S2.

Systémově je to tentýž jev, který evidence popisuje jako nález N9 u schématu: doménový plán zjistil, co potřebuje, až poté, co byl základ napsaný. Rozdíl je v tom, že N9 se týká `packages/db`, kde se počítá s doplňkovým průchodem, kdežto tady jde o **zmrazený kontrakt**, kde se doplňkový průchod nepředpokládá.

**Kde opravit: v P02**, ještě před uzavřením vlny 0. Doplnit `ML_RAW_` do `RESERVED_MARKERS`, doplnit `toMergePath` a `toCatalogPath`, a u položek 4 a 5 sjednotit názvy s P08. Sjednocení je rozhodnutí pro obě strany, ale zapsat ho musí P02, protože soubor vlastní. **V P08** pak zbývá jen aktualizovat R5 (viz níže u `LQ-051`) a odškrtnout splněné body.

---

## Ověřené hypotézy ze zadání recenze

### Počet Liquid fixtures sedí na 54

**Přepočítáno skriptem**, ne odhadem. Číslování je po stovkách podle rozhodnutí D7:

| Skupina | Rozsah | Počet |
|---|---|---|
| výstup a cesty | `LQ-001` až `LQ-008` | 8 |
| | `LQ-101` až `LQ-110` | 10 |
| | `LQ-201` až `LQ-206` | 6 |
| | `LQ-301` až `LQ-308` | 8 |
| | `LQ-401` až `LQ-404` | 4 |
| odmítnutí validátorem | `LQ-501` až `LQ-510` | 10 |
| | `LQ-601` až `LQ-604` | 4 |
| | `LQ-700` až `LQ-703` | 4 |
| **celkem** | | **54** |

Žádné číslo v rámci skupiny nechybí a žádné není dvakrát. V textu se navíc vyskytují dva identifikátory, které fixtures nejsou: `LQ-999` je umělý vzorek v testu JSON schématu (řádek 6846) a `LQ-051` se objevuje jen v próze rozhodnutí D7 a nálezu N3. Ani jeden do počtu nepatří, takže 54 sedí.

### Fixture `LQ-051` už rozporná není, nález N4 z evidence lze uzavřít

Zadání recenze i `NALEZY-NAPRIC-PLANY.md` (nález N4) uvádějí, že `LQ-051` očekává jiný chybový kód, než jaký vrací katalog hlášek. **P02 to už vyřešil** a je to doložené na třech místech:

- Rozhodnutí D7 (řádek 67) fixture přečísluje na `LQ-510`, protože trojmístné id začínající nulou do skupiny `LQ-5xx` nepatří a skupina `LQ-0xx` je obsazená.
- Fixture `LQ-510` (řádek 5903) očekává kód `liquid_vocative_filter`.
- Nález N3 v kapitole 10 dodává, že kontrakt sám mezitím `code` v tom příkladu opravil, takže požadavek R20 části 3 je splněný.

Ověřil jsem třetí stranu, o které plán nemluví: kód **`liquid_vocative_filter` je v registru chybových kódů P01** (`2026-07-31-p01-kostra-provoz-ci.md`, řádek 2068). Všechny tři strany tedy sedí.

**Zbývá jedna nitka, a je mimo P02:** plán P08 ve svém požadavku R5 (`2026-07-31-p08-sablony-model-renderer.md`, řádek 11887) pořád žádá „opravit fixture `LQ-051` na `liquid_vocative_filter`". Cituje staré id, které už neexistuje. **Kde opravit: v P08**, změnit `LQ-051` na `LQ-510` a požadavek označit za splněný.

### Testovací vektory tokenů: platí část 1 a plán se jí řídí

Zadání upozorňovalo, že části 1 a 4b uvádějí různé vektory a platí část 1. P02 to má vyřešené a doložené:

- Nález N4 v kapitole 10 rozdíl pojmenovává: část 4b uvádí open token končící `CerDYAWCif7x3s` a HMAC `cc1d94f6…`, zatímco 4.10.3 části 1 má `9cpqmSPs4g` a `d48e6713…`.
- Plán rozhoduje **ve prospěch části 1** a zdůvodňuje to tím, že záznam v části 4b pochází z verze před nahrazením `issued_at` polem `message_created_at`.
- Vektor `TK-P1` v plánu (řádek 3095) končí na `9cpqmSPs4g`, tedy skutečně variantou z části 1. Rozhodnutí a data se neliší.

To je shodné se závěrem, ke kterému nezávisle došel P09 (evidovaný nález N11), takže obě strany kontraktu dospěly ke stejnému výsledku.

### Šifrovací obálky a odvození klíčů: přepočítáno nezávisle, sedí

Nespoléhal jsem na tvrzení kapitoly 6 a spočítal jsem si vektory sám v Node:

```
délka: 32 bajtů
hex  : 000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f
SEDÍ: true

otisk klíče vypočtený : VXGoNjoPSBY
plán tvrdí            : VXGoNjoPSBY
SEDÍ: true
```

Konkrétně jsem ověřil, že `SECRET_KEY` z testovacího vektoru dekóduje base64url na **přesně 32 bajtů** o hodnotě `000102…1e1f`, a že otisk klíče vzniklý postupem HKDF(SHA-256, ikm = MASTER, salt `mailer/v1`, info `mailer/v1/secret-key-fingerprint`, L = 32), pak HMAC-SHA256 nad řetězcem `fingerprint` a base64url prvních osmi bajtů dává **přesně `VXGoNjoPSBY`**.

Za pozornost stojí i to, co plán u odvození klíčů napsal jako komentář (řádek 2665): salt ani purposes neobsahují jméno produktu a **nesmí se při přejmenování měnit**, protože otisky v suppression listu nejdou přepočítat (plaintext je po výmazu podle GDPR pryč) a změna řetězce by tiše vzkřísila smazané lidi. To je přesně ten druh pojistky, který jinde v projektu chyběl.

---

## Poznámky

- **Kapitola 10 je poctivá, ne odkládání práce.** Osm nálezů proti zmrazenému kontraktu jsem prošel a všechny jsou skutečně mimo vlastnictví P02: číslování fixtur, chybějící kód pro literály `blank` a `empty`, nedosažitelný kód u negativního krypto vektoru `CR-N7`, rozpor v počtu fixtur kontraktu 5 mezi částí 3 (18) a 4b (16). U každého plán říká, co udělal a čí potvrzení potřebuje. Zvlášť dobrý je nález N5: plán odmítl ohnout normativní pořadí kroků dešifrování jen proto, aby fixture vyšla, a místo toho zapsal hodnotu, kterou implementace skutečně vrací.

- **Nález N7 řeší past „test projde ze špatného důvodu".** Scénář `OB-09` čte tabulku `contacts`, která v kontraktní podmnožině neexistuje, takže by místo `permission denied` dostal `does not exist`. Plán test píše tak, aby přijal obě hlášky, a v komentáři vysvětluje proč. Po merge P03 poběží tentýž test proti plnému schématu, kde je správnou odpovědí `permission denied`. Rozumné, ale je to místo, kde se test dočasně nedívá na to, co má měřit. Stojí za to si ho po merge P03 zkontrolovat.

- **Otevřená otázka operátorů `>` a `<` je vyřešená, a obě strany sedí.** Řídicí dokument u P08 uvádí, že validátor je „do rozhodnutí odmítá". P02 rozhodl: `SUPPORTED_COMPARISON_OPERATORS = ['==', '!=']` (řádek 4691), ostatní čtyři operátory jsou blokující chyba `liquid_comparison_operator_not_supported` s fixture `LQ-509`. P08 na to navazuje konzistentně: podmínku počítá **mimo Liquid** do mapy `_present` a emituje `{% if _present.contact__city %}`, ve které není uvozovka ani operátor porovnání. Žádná ze stran tedy nečeká na druhou a důvod je u obou stejný, totiž že React renderer escapuje uvozovky a `>` na entity.

- **Rozhodnutí D1 o bootstrap schématu je správné.** `OB-00` musí být spustitelný ve vlně 0, migrace vznikají až v P03. Plán proto opíše DDL kontraktní podmnožiny z kontraktu, soubor výslovně označí za testovací fixture a riziko rozchodu s produkčním schématem zavře **strojově** jobem `contracts-schema`, který tentýž manifest sloupců pouští proti databázi zmigrované z `packages/db`. Konvence „jediný vlastník schématu je `packages/db`" tím porušená není.

---

## Co jsem ověřil jako v pořádku

**Ověřeno spuštěním proti PostgreSQL 18.4:**

- Bootstrap schéma kontraktu se zakládá bez chyby, včetně partitionované tabulky `messages` se složeným primárním klíčem, obou `CHECK` omezení, čtyř indexů, sloupcových grantů, RLS a politik `sender_bypass`.
- **Všech jedenáct** normativních dotazů projde `PREPARE` i `EXPLAIN (COSTS OFF) EXECUTE`. Kontrakt je tedy skutečně proveditelný, ne jen syntakticky pravděpodobný.
- Claim dotaz prořezává partition a používá `LockRows` se `SKIP LOCKED`, tedy chová se tak, jak plán popisuje.
- `ON CONFLICT` u materializace má v bootstrapu odpovídající unikátní index, takže neskončí tvrdou chybou.
- Sloupcové granty pod rolí `mlain_sender` drží: `DELETE` i zápis do `created_at` jsou odmítnuté, zápis do `status` projde. Invariant I1 je vynucený databází.
- Zakázaný tvar claimu selže přesně předpovězenou hláškou.
- `uuidv7()` je na PG 18 nativní.

**Ověřeno přepočtem v Node:**

- Dekódování `SECRET_KEY` na 32 bajtů.
- Odvození klíčů přes HKDF a otisk klíče `VXGoNjoPSBY`.
- Počet Liquid fixtures 54, bez mezer a duplicit v rámci skupin.

- **Žádné zástupné texty.** Prohledal jsem plán na `TODO`, `FIXME`, `doplnit ošetření`, `obdobně`, `analogicky`, `a tak dále`, `zbytek stejně` a osamocené výpustky. **Nula nálezů**, ani u míst, kde by to bylo lákavé, tedy u pěti vlastních filtrů, u 54 fixtures a u registru scénářů. Kroky, které mění kód, ten kód obsahují celý.

**Ověřeno čtením:**

- **Licence.** Kapitoly 5.1 až 5.3 uvádějí licenci u každé závislosti a všechny jsou přípustné: `liquidjs` a `pg` MIT, `github.com/osteele/liquid` MIT, `github.com/google/uuid` BSD-3-Clause, `github.com/jackc/pgx/v5` MIT, standardní knihovna Go BSD-3-Clause. Žádná GPL, LGPL ani AGPL. Plán navíc vede seznam „vědomě nepoužité" s důvodem a zavádí pravidlo, že se licence před přidáním závislosti ověří **příkazem, ne pamětí**, včetně konkrétních příkazů pro Node i Go. To je nad rámec toho, co zadání žádá.
- **Odmítnutí `golang.org/x/crypto/hkdf`** ve prospěch `crypto/hkdf` ze standardní knihovny Go je správné a plán to váže na konkrétní kapitolu specifikace.
- **Symlink místo kopie** u `apps/sender/testdata`, s Go testem, který ověřuje, že to je skutečně symlink a ne kopie (řádek 528). Kopie by se rozešla a nikdo by si toho nevšiml. Adresář jménem `testdata` je navíc pro Go toolchain neviditelný, takže se do buildu nedostane.
- **Hranice plánu** jsou v kapitole 9 vymezené úplně, včetně věty, co plán nedělá, a včetně přiznání, že `packages/contracts/package.json` přebírá po P01 a přepisuje celý. Tohle přiznání v P03 u `packages/db` chybí a je z toho samostatný nález v revizi P01.
