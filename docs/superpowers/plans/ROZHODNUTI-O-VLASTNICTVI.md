# Rozhodnutí o vlastnictví, doplněná po fázi 2

Datum: 2026-08-01. Rozhodl: hlavní agent.

Recenze fáze 2 našly čtyři místa, kde si dva plány nárokují totéž, nebo kde si oba myslí,
že to dělá ten druhý. Všechna vznikla nepřesností v řídicím dokumentu dělení, ne chybou autorů.
Tady jsou rozhodnutá.

---

## R1. Go strana kontraktů: P02 dodává runnery, P09 dodává implementaci

**Problém.** Oba plány zakládají soubory v `apps/sender/internal/contracts/` a v jednom balíčku
Go se srazí stejné symboly (`TestGoldenCrypto`, `TestGoldenLiquid`, `tokenVectors`,
`loadTokenVectors`, `writeGoldenReport`). **Balíček by se nepřeložil.**

Hlubší vada je ale jinde: P02 dodává Go implementaci každého kontraktu a P09 dělá tytéž věci
znovu v produkčních balíčcích. **P09 `internal/contracts` nikde neimportuje**, ověřeno grepem.
Vznikly by dvě Go implementace každého kontraktu, obě testované nad týmiž fixtures, ale binárka
by používala jen jednu. Ta druhá by se mohla rozejít a nikdo by to nepoznal.

**Rozhodnutí:**

| Kdo | Co vlastní na Go straně |
|---|---|
| **P02** | **jen runnery golden fixtures** plus pomocníky na čtení fixtures (`FixturesDir`, `ReadFixture`) a symlink `testdata` |
| **P09** | **implementace všech kontraktů** v produkčních balíčcích `internal/token`, `internal/credentials`, `internal/keyring`, `internal/markers`, `internal/liquidx` |

Runnery P02 pouští fixtures **proti produkčnímu kódu P09**, ne proti vlastní kopii.
Tím je zaručeno, že testuje se to, co se opravdu odesílá.

Formát reportu sjednotit na ten, který čte `check-parity.ts` z P02. Dnes každý plán píše jiný.

**Navíc opravit:** `go mod init` dělají oba plány s **jiným module path**, a druhý běh nad
existujícím souborem selže. Platí cesta z P01, protože P01 modul zakládá. P09 svůj `go mod init`
i vlastní `internal/version/version.go` vypustí, obojí už P01 má.

---

## R2. Katalog polí vlastní P07

**Problém.** `FieldCatalog` je pod jedním jménem **dva neslučitelné typy**. P02 jím myslí úzký
seznam povolených kořenů, P08 bohatý katalog s cestami a typy. Tentýž bohatý tvar si nezávisle
definuje i P07 a P12.

**Rozhodnutí:** katalog polí vlastní **P07**, protože vlastní model kontaktu a vlastní pole,
tedy jediný zdroj, ze kterého se dá sestavit. P08 a P12 ho importují z P07.

**P02 svůj úzký seznam přejmenuje** (například na `LiquidRoots`), aby jméno nekolidovalo.
Ponechat dvě různé věci pod jedním jménem je horší než obojí duplikovat.

---

## R3. Fixtures kompilované šablony píše P08

**Problém.** P02 píše, že `CT-001` až `CT-018` doplní P08. P08 píše, že je vlastní P02
a výslovně si zakazuje je psát, protože je to soubor cizího plánu. **Obě strany si myslí,
že je píše ta druhá, a obě to mají jako závazné pravidlo.** Nenapsal by je nikdo.

**Rozhodnutí:** **data píše P08**, protože jako jediné má blokový model a renderer, tedy jediné
je umí vyrobit. **P02 dodá schéma a runner.** Obě věty v obou plánech se opraví.

Sjednotit i cestu: P09 hledá `testdata/compile`, P02 a P08 mají `compiled`. Platí `compiled`.

---

## R4. Fixtures událostí od providera vlastní P13

**Problém.** P13 čte jedenáct souborů se vzorky událostí od Amazonu, které P02 nezná
a nezakládá, a P13 si je zakázal psát sám.

**Rozhodnutí:** vlastní je **P13**. Nejsou to kontrakty mezi TypeScriptem a Go, jsou to vzorky
cizích payloadů, tedy běžná testovací data domény. Do `packages/contracts` nepatří.

---

## R5. Šestý jmenný prostor chybových kódů

**Problém.** Kód `contract_mismatch` v registru je, ale ve jmenném prostoru pro stav zprávy,
zatímco P13 ho potřebuje jako HTTP kód. `schema_version_ahead` a `migration_lock_timeout`
chybí úplně a P01 první z nich používá jen jako volný text.

**Rozhodnutí:** P01 zavede **šestý jmenný prostor pro provozní a migrační kódy** CLI a pro nálezy
diagnostiky. Kód smí být ve víc prostorech, pokud to má význam, ale musí být v každém, kde se
používá.

---

## R6. Kontrakt šifrování má mít jedno jméno

**Problém.** Kontrakt 4 má napříč šesti plány **tři jména a čtyři signatury**:
`encryptEnvelope` s objektem, `encryptSecret` poziční, `encryptCredential`, a P16 chce navíc
pole, které vlastník nemá.

**Rozhodnutí:** platí jméno a signatura vlastníka, tedy **P02**: `encryptEnvelope({...})`
a `decryptEnvelope({...})` s pojmenovanými argumenty. Všech pět ostatních plánů se srovná.
Pole, která chybí, se do kontraktu doplní tam, kde jsou doložená potřebou, ne obcházená
vlastní obálkou.

---

## R7. Porovnávací operátory v podmínkách zůstávají v MVP 0 zakázané

**Rozhodnuto zadavatelem 2026-08-01.** Poslední otevřená podotázka z fáze specifikací je uzavřená.

Operátory `>`, `<`, `>=`, `<=` se v podmínkách šablony **nepovolují**. Důvod je tentýž jako
u uvozovek: renderer je při převodu do HTML nahradí entitami a podmínka přestane být platná.

Kdo potřebuje porovnávat, použije **segment**, který to umí a navíc ukáže počet zasažených lidí
předem.

**Pro plány to neznamená žádnou změnu.** P02 i P08 se tak už chovají: validátor takovou podmínku
odmítá jako blokující chybu s vlastním kódem, existuje na to golden fixture a kód je v povinném
seznamu kontroly parity. Rozhodnutí jen ruší poznámku „čeká na rozhodnutí", aby to nikdo
nepovažoval za nedodělek.

Zařazeno do MVP 1.

---

## Nejzávažnější nález, který není otázkou vlastnictví

**Žádná ze čtyř bran, kvůli kterým P02 existuje, v CI neběží.** Ověřeno čtením obou plánů:

- job pro golden fixtures hledá Go fixtures ve špatné cestě, takže hlásí u **každé** fixtury,
  že je jen na jedné straně. I po opravě cesty by porovnával adresář sám se sebou přes symlink.
- **žádný job nespouští ani jeden z pěti skriptů, které P02 vyrábí**, protože definice testovacích
  příkazů v P02 golden projekt výslovně vylučuje
- job pro schémata skládá jména souborů jinak, než jak je P02 pojmenoval, **neshoduje se ani jedno**
- job pro kontraktní sloupce čte soubor, který nikdy nevznikne, takže tiše přeskočí

Výsledek: 54 golden fixtures, kontrola parity ani scénáře outboxu by na TypeScript straně
**nikdy neběžely**. Go strana by prošla jen náhodou, protože její job pouští testy bez filtru.

Je to nejhorší možná podoba problému, který se v tomhle projektu opakuje: **ochrana existuje,
vypadá funkčně, a nespustí se.** Opravit v P01 (dvě položky) a v P02 (dvě položky) **před**
zahájením implementace.
