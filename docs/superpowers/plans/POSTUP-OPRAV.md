# Postup oprav plánů po recenzích

Datum: 2026-08-01

Recenzi má všech šestnáct plánů. Opravy se ale **nesmí pouštět najednou**, protože plány na sobě
stojí: kdyby se doménový plán srovnával proti rozhraní, které se pod ním ještě mění, srovnal by
se proti nesprávné podobě a musel by se opravovat podruhé.

Pořadí je dané závislostmi, tedy tím, **kdo komu co dodává**.

## Pravidlo, podle kterého jsou vlny seřazené

> Plán se opravuje teprve tehdy, když je hotové všechno, z čeho čte.

Dodavatel se ustálí první, odběratel se srovná proti jeho **hotové** podobě.

---

## Vlna A: dodavatelé (běží)

Pět plánů, na kterých stojí všechno ostatní. Nedodávají doménu, dodávají nástroje.

| Plán | Co dodává ostatním | Stav |
|---|---|---|
| P03 | databázové schéma, RLS, role, transakční primitiva | **hotovo** |
| P01 | kostra repa, Docker, CI brány, registr chyb a front | opravuje se |
| P02 | pět kontraktů mezi TypeScriptem a Go, golden fixtures | opravuje se |
| P04 | konvence API, tvar chyb, transakční vrstva, identita | opravuje se |
| P05 | design systém, osm komponent, i18n, skořápka | opravuje se |

**Proč zrovna tyhle první.** P04 dodává transakční vrstvu a tvar chyb **všem** doménovým plánům.
P05 dodává komponenty **jedenácti** plánům a jako jediný smí měnit `packages/ui`, takže si to
u sebe nikdo nesmí opravit. P02 a P01 drží brány, které mají rozchod zachytit.

---

## Vlna B: doménové plány, které čtou jen z vlny A

Čtyři plány. Mezi sebou se nedotýkají, takže mohou běžet naráz.

| Plán | Čte z | Hlavní úkol opravy |
|---|---|---|
| P06 nastavení a přístupy | P04, P05 | srovnat importy komponent, doplnit chybějící stavy |
| P07 kontakty, souhlasy, vokativ | P03, P04, P05 | šest kritických nálezů, tři zastaví plán hned na začátku |
| P08 šablony a renderer | P02, P03 | přestat importovat z kořene kontraktů, napsat data testů kompilace |
| P09 sender (Go) | P02, P03 | **přebírá Go implementaci kontraktů**, sjednotit cestu modulu |
| P10 tracking a SDK | P02, P03, P04 | doplnit tři povinné sloupce, opravit idempotenci, srovnat jména z kontraktu |

**Pozor u P09.** Podle rozhodnutí R1 přebírá Go implementaci všech kontraktů, kterou dosud dělal
P02 dvakrát. Musí tedy počkat, až P02 svou Go část odstraní, jinak by se balíček nepřeložil.

---

## Vlna C: plány, které čtou z vlny B

| Plán | Čte z | Hlavní úkol opravy |
|---|---|---|
| P11 import, export, segmenty | P07 (model kontaktu), P05 (query builder) | devět kritických, většina na vlastní straně |
| P12 editor šablon | P08 (blokový model), P05 (náhled) | testy mimo hlídaný vzor, srovnat komponenty |
| P13 kampaně a provideři | P07, P08, P03 | čtyři kritické, žádná fáze se dnes nezkompiluje |

**Pozor u P11.** Jeho query builder závisí na tom, jak P05 opraví komponentu pro segmenty.
Dnes unese šest ze čtyřiceti operátorů, takže se rozsah opravy může posunout.

---

## Vlna D: plány, které čtou ze všeho ostatního

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
