# Postup oprav plánů po recenzích

**Poslední revize: 2026-08-06.** Co je tenhle dokument: **dokončený** rozvrh, v jakém pořadí
se v srpnu 2026 opravovalo šestnáct implementačních plánů po recenzích. Hledej v něm, proč
plány stály v tomhle pořadí a jaká pravidla u oprav platila. **Není to seznam práce, která
čeká**, ta je v `STAV-IMPLEMENTACE.md`.

> **HOTOVO, vlny A až D proběhly.** Ověřeno 2026-08-06 podle časů souborů: všech šestnáct
> plánů `2026-07-31-p01` až `p16` bylo naposledy upraveno 1. nebo 2. 8. 2026, tedy po tomhle
> rozvrhu. Od té doby se implementuje a všechna rozhodnutí z `ROZHODNUTI-O-VLASTNICTVI.md`
> jsou v kódu doložená.
>
> Stavy „běží" a „opravuje se" v tabulkách níž jsou proto **zmrazený zápis z 1. 8. 2026**,
> ne dnešní stav. Nechávají se, aby bylo dohledatelné, čím to procházelo.
>
> **Na co si dát pozor:** čtyři plány vznikly až po tomhle rozvrhu a tímhle procesem
> **neprošly**: `2026-08-04-editor-wysiwyg.md`, `2026-08-05-emaily-seznamu.md`,
> `2026-08-05-p17-automatizace.md` a `2026-08-05-systemova-posta-ses.md`.

Datum původního rozvrhu: 2026-08-01

Recenzi má všech šestnáct plánů. Opravy se ale **nesmí pouštět najednou**, protože plány na sobě
stojí: kdyby se doménový plán srovnával proti rozhraní, které se pod ním ještě mění, srovnal by
se proti nesprávné podobě a musel by se opravovat podruhé.

Pořadí je dané závislostmi, tedy tím, **kdo komu co dodává**.

## Pravidlo, podle kterého jsou vlny seřazené

> Plán se opravuje teprve tehdy, když je hotové všechno, z čeho čte.

Dodavatel se ustálí první, odběratel se srovná proti jeho **hotové** podobě.

---

## Vlna A: dodavatelé (dokončeno 2026-08-02)

Pět plánů, na kterých stojí všechno ostatní. Nedodávají doménu, dodávají nástroje.

Sloupec „stav 1. 8." je původní zápis. Sloupec vpravo je ověření z 2026-08-06.

| Plán | Co dodává ostatním | Stav 1. 8. | Ověřeno 6. 8. |
|---|---|---|---|
| P03 | databázové schéma, RLS, role, transakční primitiva | **hotovo** | soubor upraven 1. 8. 17:56 |
| P01 | kostra repa, Docker, CI brány, registr chyb a front | opravuje se | soubor upraven 2. 8. 09:39 |
| P02 | pět kontraktů mezi TypeScriptem a Go, golden fixtures | opravuje se | soubor upraven 1. 8. 12:31 |
| P04 | konvence API, tvar chyb, transakční vrstva, identita | opravuje se | soubor upraven 1. 8. 13:04 |
| P05 | design systém, osm komponent, i18n, skořápka | opravuje se | soubor upraven 1. 8. 11:14 |

**Proč zrovna tyhle první.** P04 dodává transakční vrstvu a tvar chyb **všem** doménovým plánům.
P05 dodává komponenty **jedenácti** plánům a jako jediný smí měnit `packages/ui`, takže si to
u sebe nikdo nesmí opravit. P02 a P01 drží brány, které mají rozchod zachytit.

---

## Vlna B: doménové plány, které čtou jen z vlny A (dokončeno 2026-08-02)

**Pět** plánů. Mezi sebou se nedotýkají, takže mohou běžet naráz. Dřívější znění tady psalo
„čtyři plány", ale tabulka jich vždycky měla pět; opraveno 2026-08-06.

| Plán | Čte z | Hlavní úkol opravy |
|---|---|---|
| P06 nastavení a přístupy | P04, P05 | srovnat importy komponent, doplnit chybějící stavy |
| P07 kontakty, souhlasy, vokativ | P03, P04, P05 | šest kritických nálezů, tři zastaví plán hned na začátku |
| P08 šablony a renderer | P02, P03 | přestat importovat z kořene kontraktů, napsat data testů kompilace |
| P09 sender (Go) | P02, P03 | **přebírá Go implementaci kontraktů**, sjednotit cestu modulu |
| P10 tracking a SDK | P02, P03, P04 | doplnit tři povinné sloupce, opravit idempotenci, srovnat jména z kontraktu |

**Pozor u P09.** Podle rozhodnutí R1 přebírá Go implementaci všech kontraktů, kterou dosud dělal
P02 dvakrát. Musí tedy počkat, až P02 svou Go část odstraní, jinak by se balíček nepřeložil.

> **Vyřešeno, ověřeno 2026-08-06 v kódu.** Dělba podle R1 v repozitáři platí: testy
> `TestGolden*` žijí v produkčních balíčcích P09 (`internal/token`, `internal/credentials`,
> `internal/liquidx`, `internal/markers`, `internal/mimebuild`, `internal/outbox`)
> a `apps/sender/internal/contracts` drží jen runnery. Že se to nesmí rozejít, hlídá
> `apps/sender/internal/version/version_test.go` testem `TestGoldenRunnersFromP02Exist`.

---

## Vlna C: plány, které čtou z vlny B (dokončeno 2026-08-02)

| Plán | Čte z | Hlavní úkol opravy |
|---|---|---|
| P11 import, export, segmenty | P07 (model kontaktu), P05 (query builder) | devět kritických, většina na vlastní straně |
| P12 editor šablon | P08 (blokový model), P05 (náhled) | testy mimo hlídaný vzor, srovnat komponenty |
| P13 kampaně a provideři | P07, P08, P03 | čtyři kritické, žádná fáze se dnes nezkompiluje |

**Pozor u P11.** Jeho query builder závisí na tom, jak P05 opraví komponentu pro segmenty.
Tehdy unesl šest ze čtyřiceti operátorů, takže se rozsah opravy mohl posunout.

> **Vyřešeno, ověřeno 2026-08-06 v kódu.** `packages/core/src/segments/ast.ts` má v `OPERATORS`
> čtyřicet operátorů a `FIELD_CLASS_OPERATORS` je mapuje na třídy polí.
> `packages/ui/src/patterns/query-builder/query-builder.tsx` si žádný seznam nedrží, bere
> `field.operators` jako data, takže strop šesti operátorů v komponentě už není.

---

## Vlna D: plány, které čtou ze všeho ostatního (dokončeno 2026-08-02)

| Plán | Čte z | Hlavní úkol opravy |
|---|---|---|
| P14 reporty a dashboard | P10, P13, P05 | čtyři kritické, doména je promyšlená |
| P15 AI asistent | P08, P12, P02 | jedenáct kritických, ochrana proti odchozím spojením nic neměří |
| P16 onboarding, provoz, zálohy, E2E | **všech patnáct** | sedm kritických, tři třídy „projde testy, v provozu tiše nefunguje" |

**P16 je poslední schválně.** Skládá se nad vším a jeho koncový test zlaté cesty ověřuje,
že celek drží pohromadě. Opravovat ho dřív by znamenalo srovnávat ho proti pohyblivému cíli.

---

## Co platí pro každou opravu

1. **Nálezy se opravují, ne zapisují.** Plán má být po opravě proveditelný, ne opatřený seznamem výhrad.
2. **Ověřuje se spuštěním, ne přečtením.** V tomhle projektu to opakovaně odhalilo věci, které
   čtení minulo: nespustitelné SQL, prázdnou zálohu, funkci, která tiše nic nedělá, i překlep
   v očekávané hodnotě testu, kvůli kterému by správná implementace neprošla.
3. **Cizí nálezy se neopravují**, ale zapisují do `NALEZY-NAPRIC-PLANY.md`.
4. **Čísla se přepočítávají skriptem**, ne odhadem. Po opravách se mění a plán je uvádí na víc místech.
5. **Ke každé opravené ochraně patří test, který její porušení zachytí automaticky**, a ten test
   se nesmí ptát téhož zdroje, ze kterého ochrana vznikla.
6. Žádná dlouhá pomlčka, git nechat být.

## Průběžná kontrola mezi vlnami

Po každé vlně ověřit na disku, ne z hlášení agentů:

- soubor plánu je novější než jeho recenze
- počet úkolů a kroků sedí s tím, co plán sám tvrdí
- nula dlouhých pomlček, nula zástupných textů, nula značek pokračování
- nové cizí nálezy jsou v evidenci
