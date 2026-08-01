# @mlain/ui

Design systém Mlain Maileru. **Tenhle balíček zakládá jediný plán (P05).**
Ostatní plány z něj importují a nic do něj nepřidávají.

## Jak se importuje

Vždy podcestou, nikdy z kořene:

```ts
import { Button } from '@mlain/ui/components/button';
import { DataTable } from '@mlain/ui/patterns/data-table';
import { LineChart } from '@mlain/ui/patterns/charts/lazy';
```

Kořenový import **neexistuje**. Balíček nemá v `exports` klíč `"."`, takže
`import { Button } from '@mlain/ui'` skončí chybou `ERR_PACKAGE_PATH_NOT_EXPORTED`.
Barrel by se totiž rozrostl o jeden řádek na doménu a byl by konfliktním
souborem v každém plánu, který balíček používá.

Podcesta je vždy na **úroveň adresáře**, nikdy na úroveň souboru.

## Co tu je

| Komponenta         | Cesta                    | Tvrdé požadavky                                                                              |
| ------------------ | ------------------------ | -------------------------------------------------------------------------------------------- |
| K1 Datová tabulka  | `patterns/data-table`    | kurzorové stránkování, výběr přes stránky, nastavitelné sloupce, klávesnice, `aria-rowcount` |
| K2 Query builder   | `patterns/query-builder` | hloubka 5, 50 potomků, negace, věta ze slotů, **všech 40 operátorů**                         |
| K3 Průvodce        | `patterns/wizard`        | krok v URL (`useWizardStep`), destruktivní návrat, fokus, 24hodinový koncept                 |
| K4 Nahrání souboru | `patterns/file-upload`   | přetažení i klávesnice, průběh, části, zrušení                                               |
| K5 Toast           | `patterns/toast`         | fronta o třech, slučování, odpočet, pozastavení, klávesnice                                  |
| K6 Náhled e-mailu  | `patterns/email-preview` | iframe se sandboxem, šířky, tmavý režim, bez cizích zdrojů                                   |
| K7 Grafy           | `patterns/charts`        | tabulka pod grafem, vzory, klávesnice                                                        |
| K8 Časová osa      | `patterns/timeline`      | shluky, oddělovače dnů v zóně uživatele, rod, dávky, kotvy                                   |

Dále: stavy obrazovek (`patterns/states`, včetně `Alert` a `FilteredEmptyState`),
zpětná vazba a potvrzení (`patterns/feedback`), skořápka (`patterns/shell`),
navigace (`patterns/navigation`), zkratky (`patterns/shortcuts`), úlohy
(`patterns/jobs`) a primitiva (`components/*`, včetně `CopyButton`).

**Co tu vědomě není:** `ErrorState`, `LoadingSkeleton`, `StaleDataBanner`,
`PartialErrorBoundary`, `OfflineBanner`, `FileDrop`, `Disclosure`, `Dot`,
`Tile`, `Table`, `Note`, `Panel`, `Banner`. Buď to jsou jiná jména pro něco,
co tu je, nebo rozvržení jedné obrazovky. Seznam náhrad je v kapitole 8.1
plánu P05.

## Pravidla, která hlídají testy

1. **Jen tokeny.** `bg-blue-500` neprojde, hlídá `src/patterns/index.test.ts`.
2. **Žádný text natvrdo.** Texty jdou dovnitř přes props z katalogů `@mlain/i18n`.
3. **Kontrast.** Světlý i tmavý režim splňují WCAG 2.2 AA, hlídá `src/lib/tokens.test.ts`.
4. **Žádné mrtvé tlačítko.** Primární a destruktivní varianta `disabled` nepřijímá.
   Místo toho `unavailableReason`, které vysvětlí, proč akce teď nejde.
5. **Žádná dlouhá pomlčka** (U+2014) nikde ve zdrojích.
6. **Kořenový import neexistuje.** V `exports` není klíč `"."`, hlídá
   `src/patterns/index.test.ts`.

## Když komponenta nestačí

Nepiš vlastní vedle ní. Rozšiř tu existující o prop a doplň test.
Dvě podobné komponenty ve sdíleném balíčku jsou horší než jedna obecnější.
