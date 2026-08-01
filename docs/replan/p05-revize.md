# Revize P05: dodává design systém všechno, co po něm jedenáct navazujících plánů chce?

**Recenzovaný plán:** `/Users/petr/Projects/Mailing_Tool/docs/superpowers/plans/2026-07-31-p05-design-system-i18n-skorapka.md` (13 125 řádků, 34 úkolů)
**Normativní zdroj:** `/Users/petr/Projects/Mailing_Tool/docs/superpowers/specs/parts/06-ui-ux.md`, část 6, kapitola 13.1 (tvrdé požadavky K1 až K8), kapitoly 11, 12, 15, 16
**Řídicí dokument:** `2026-07-31-rozdeleni-implementacnich-planu.md`, uzávěry S3, S4, S5, S6, S11
**Datum:** 2026-08-01

Recenze se ptá na jedinou věc: **je design systém úplný natolik, aby si po něm jedenáct paralelních plánů nezačalo dopisovat vlastní komponenty do `packages/ui`?** Všechny nálezy jsou ověřené proti skutečnému kódu v plánu, ne proti jeho průvodnímu textu. U každého je číslo řádku.

---

## Verdikt

**NALEZENY PROBLÉMY.**

Vnitřní kvalita plánu je vysoká. Všech osm komponent K1 až K8 v `packages/ui` **skutečně existuje**, každá má vlastní úkol, padající test před implementací a úplný kód. Tokeny mají test na kontrast, i18n má tři blokující kontroly, licenční rozvaha je vlastní a `pa11y` je správně odmítnutý. Plán navíc sám našel a opravil chybu ve vzoru specifikace pro rody.

Problém není uvnitř P05, ale **na jeho hranici**. Plán nikdy nekonfrontoval rozhraní svých komponent s tím, jak je navazující plány doopravdy volají. Osm z nich se rozchází v názvu, v props nebo v datovém tvaru. Protože P05 je jediný vlastník `packages/ui`, žádný z jedenácti navazujících plánů to nemůže opravit u sebe, aniž poruší uzávěr S3. Tohle je přesně ten výsledek, kterému se dělení vyhýbalo.

Druhý problém je věcný: **K2 query builder nesplňuje svůj tvrdý požadavek.** Umí vykreslit jen operátory se skalární hodnotou, což je menšina matice části 2.

| Závažnost | Počet |
|---|---|
| KRITICKÉ | 7 |
| DŮLEŽITÉ | 5 |
| POZNÁMKA | 4 |

### Pokrytí osmi komponent, souhrn

| # | Komponenta | Existuje | Tvrdé požadavky 13.1 | Rozhraní sedí konzumentům |
|---|---|---|---|---|
| K1 | Datová tabulka | ano, úkoly 19 a 20 | splněné | **ne**, viz K7 (název v barrelu) |
| K2 | Query builder | ano, úkol 21 | **nesplněné**, viz K1 | **ne**, viz K2 |
| K3 | Průvodce | ano, úkol 22 | splněné | neověřitelné, P11 ho volá z barrelu |
| K4 | Nahrání souboru | ano, úkol 23 | splněné | **ne**, P11 volá `FileDrop` |
| K5 | Toast | ano, úkol 13 | splněné | ano |
| K6 | Náhled e-mailu | ano, úkol 24 | splněné, i „bez odchozích požadavků" | **ne**, viz K3 |
| K7 | Grafy | ano, úkol 25 | splněné | ano |
| K8 | Časová osa | ano, úkoly 26 a 27 | splněné, včetně rodů | ano |

Odpověď na hlavní otázku zní tedy: **komponenty jsou dodané všechny, ale jako sdílený balíček nejsou použitelné bez sladění rozhraní.**

---

## KRITICKÉ

### K1. K2 query builder neunese matici operátorů: pro každý ze 40 operátorů vykreslí jediné textové pole

**Kde:** úkol 21, typ `Rule` na ř. 8021 až 8027, vykreslení hodnoty na ř. 8552 až 8560.

Typ pravidla má jedinou hodnotu:

```ts
export type Rule = {
  id: string;
  kind: 'rule';
  field: string | null;
  op: string | null;
  value: unknown;
};
```

a vykreslení hodnoty nezávisí na operátoru vůbec:

```tsx
{operator ? (
  <input
    aria-label={labels.value}
    value={String(rule.value ?? '')}
    onChange={(event) => change(() => builder.updateRule(rule.id, { value: event.target.value }))}
  />
) : null}
```

**Co žádá norma.** Tvrdý požadavek K2 v 13.1 zní „operátory podle typu pole z matice části 2". Matice v části 2, kapitola 4.11.2 (ř. 2583 až 2612 souboru `02-kontakty.md`), obsahuje **přesně 40 různých operátorů** (ověřeno vypsáním všech třinácti tříd polí a odečtením duplicit) a k nim tabulku typové kompatibility se **čtyřmi různými tvary hodnoty**:

| Tvar hodnoty | Operátory | Kolik jich je | Umí to K2 |
|---|---|---|---|
| `value`, skalár | `eq`, `neq`, `contains`, `starts_with`, `on`, `before`, … | 13 | ano |
| `values`, seznam 1 až 1 000 položek | `in`, `not_in`, `has_any`, `has_all`, `has_none` | 5 | **ne** |
| `values`, právě 2 položky | `between` | 1 | **ne** |
| celé číslo v rozsahu | `in_last_days`, `not_in_last_days`, `in_next_days`, `count_gte`, `count_lte` | 5 | **ne**, chybí typ i mez |
| **žádná hodnota** | `is_empty`, `is_not_empty`, `is_true`, `is_false`, `did`, `did_not`, `is_suppressed`, `is_not_suppressed`, `is_granted`, `is_withdrawn`, `is_missing`, `is_member`, `is_not_member`, `is_confirmed`, `is_pending`, `is_unsubscribed` | 16 | **ne**, pole se stejně zobrazí |

Šestnáct operátorů, tedy skoro polovina matice, žádnou hodnotu nepřijímá a část 2 to říká výslovně: „přítomnost `value` nebo `values` je chyba". K2 u nich přesto nabídne vstupní pole, takže rozhraní aktivně vede uživatele k tomu, aby vyrobil neplatný segment.

`between` a pětice seznamových operátorů nejdou zadat vůbec, protože v typu `Rule` neexistuje pole `values`.

**Navržená oprava:** doplnit do `FieldDefinition.operators` tvar hodnoty a do `Rule` druhou hodnotu, například:

```ts
type OperatorValueShape = 'none' | 'scalar' | 'list' | 'range' | 'integer';
operators: Array<{ id: string; label: string; negating?: boolean; shape: OperatorValueShape; min?: number; max?: number }>;
type Rule = { …; value: unknown; values?: unknown[] };
```

a ve vykreslení větvit podle `shape`: nic, jeden vstup, dva vstupy pro rozsah, žetonový vstup pro seznam, číselný vstup s mezemi.

**Kde se opravuje:** v **P05, úkol 21**. Matici dat vlastní P11, ale tvar hodnoty je vlastnost komponenty, ne dat. Bez toho nemá P11 kam matici předat.

**Proč to vadí:** kritérium 44 části 6 žádá, aby builder nabídl „všech pět operátorů seznamu, všechny tři operátory souhlasu a oba operátory blokovaných adres". Všech deset patří do skupiny „bez hodnoty" nebo „seznam". Segment builder by tedy neuměl postavit ani jeden z šesti presetů čištění z kritéria 52.

---

### K2. Rozhraní K2 se neshoduje s tím, jak ho P11 volá: jiný název importu, jiné props, jiný AST

**Kde v P05:** úkol 21, `QueryBuilder` na ř. 8478, props `initial`, `fields`, `labels`, `renderGroupSentence`, `showJsonToggle`, `onChange`, `footer`.
**Kde v P11:** úkol 54 „Konformanční test K2 a náhradní cesta", ř. 9276 a dál.

P11 píše:

```tsx
import { QueryBuilder } from '@mlain/ui';
…
render(<QueryBuilder value={{ version: 1, root: nested(5) }} onChange={vi.fn()} fields={allFields()} />);
```

kde uzly mají tvar `{ type: 'group', op: 'and', children: [...] }` a `{ type: 'condition', field: { kind: 'contact', key: 'status' }, operator: 'eq', value: 'active' }`.

Rozdílů je pět a každý sám o sobě shodí typovou kontrolu:

| Věc | P05 | P11 |
|---|---|---|
| Import | podcesta `@mlain/ui/patterns/query-builder` | holý barrel `@mlain/ui` |
| Prop se stromem | `initial` | `value` |
| Obálka stromu | žádná, rovnou `RuleGroup` | `{ version: 1, root: … }` |
| Diskriminátor uzlu | `kind: 'rule' \| 'group'` | `type: 'condition' \| 'group'` |
| Operátor a pole | `op: string`, `field: string` | `operator: string`, `field: { kind, key }` |

Navíc P05 vyžaduje povinné props `labels` a `renderGroupSentence`, které P11 vůbec nepředává, takže i po srovnání názvů by volání nebylo úplné.

**Navržená oprava:** dohodnout jeden tvar AST dřív, než oba plány poběží. Doporučuji převzít tvar P11, protože ten odpovídá segmentovému AST z části 2, kapitola 4.11.1, který stejně musí jít uložit do databáze. P05 pak přidá adaptér, ne P11.

**Kde se opravuje:** **v P05, úkol 21** (typy a props) a **v P11, úkol 54** (import podcestou). Poslední slovo má P05, protože vlastní `packages/ui`.

---

### K3. Rozhraní K6 se neshoduje s tím, jak ho P12 volá, a P12 navíc žádá slabší izolaci, než norma dovoluje

**Kde v P05:** úkol 24, `EmailPreview({ html, labels, className })` na ř. 9569 a dál. Přepínače šířky a tmavého režimu jsou **uvnitř** komponenty, řízené jejím vlastním `useState` (ř. 9578 a 9579).
**Kde v P12:** předpoklad E2 na ř. 40, požadavek P05-R1 na ř. 7509, volání v úkolu 25 na ř. 6193:

```tsx
<EmailPreview html={result.html} width={width} dark={dark} title={t('preview.frameTitle')} />
```

Dva nezávislé problémy:

1. **Props se neshodují.** P05 nemá `width`, `dark` ani `title` a naopak vyžaduje povinný objekt `labels`. Volání v P12 se nezkompiluje. Věcně jde o spor o to, kdo drží stav: P05 ho drží uvnitř, P12 ho chce řídit zvenčí, protože přepínače má ve své vlastní liště nástrojů (úkol 25 se jmenuje „Náhled pro počítač, mobil, tmavý režim, text a zdroj"). Kdyby se to nechalo být, uživatel by v editoru viděl dvě sady stejných přepínačů.

2. **P12 žádá `sandbox="allow-same-origin"`** (ř. 40 a 7509). To je proti tvrdému požadavku K6 na izolaci. P05 má správně `sandbox=""` bez jediné výjimky (ř. 9600) a k tomu CSP uvnitř `srcdoc`:

   ```
   default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'none'; script-src 'none'
   ```

   Tohle je jediné místo, které skutečně plní požadavek **„bez odchozích požadavků na cizí zdroje"**, a P05 na to má test (ř. 9498 až 9504). Samotný atribut `sandbox` by odchozí požadavky neblokoval, obrázek z cizí domény by se načetl. P05 to má promyšlené správně.

**Navržená oprava:** P05 doplní volitelné řízené props `width`, `dark` a `title`, aby šly přepínače nechat na obrazovce; `labels` zůstane, ale s výchozí hodnotou. P12 stáhne požadavek na `allow-same-origin` bez náhrady.

**Kde se opravuje:** props **v P05, úkol 24**; požadavek na `allow-same-origin` **v P12**, předpoklad E2 a požadavek P05-R1.

---

### K4. Stavové komponenty: P06 žádá sedm názvů, které P05 neexportuje

**Kde v P05:** barrel `packages/ui/src/patterns/states/index.ts`, úkol 17. Exportuje přesně dvanáct jmen: `EmptyState`, `ErrorBlock`, `ForbiddenState`, `NotFoundState`, `OverLimitState`, `PrerequisiteState`, `ReadOnlyBanner`, `ReadOnlyValue`, `StaleBanner`, `StaleContent`, `DetailSkeleton`, `TableSkeleton`.
**Kde v P06:** kapitola 2.2, předpoklad U4 na ř. 144.

| P06 žádá | P05 má | Stav |
|---|---|---|
| `EmptyState` | `EmptyState` | sedí |
| `ForbiddenState` | `ForbiddenState` | sedí |
| `NotFoundState` | `NotFoundState` | sedí |
| `ReadOnlyBanner` | `ReadOnlyBanner` | sedí |
| `FilteredEmptyState` | jen `EmptyStateVariant` jako typ | **chybí jméno** |
| `LoadingSkeleton` | `TableSkeleton`, `DetailSkeleton` | **chybí jméno** |
| `StaleDataBanner` | `StaleBanner` | **jiné jméno** |
| `ErrorState` | `ErrorBlock` | **jiné jméno** |
| `LimitReachedState` | `OverLimitState` | **jiné jméno** |
| `PartialErrorBoundary` | nic | **chybí úplně** |
| `OfflineBanner` | `SystemBar` s `kind: 'offline'` v `patterns/shell` | **jinde a jinak** |

Sedm z jedenácti neodpovídá. Preflight v úkolu 1 plánu P06 má tyhle předpoklady ověřovat spuštěním, takže P06 se zastaví hned na prvním úkolu.

Věcně je pokryto všechno: `PartialErrorBoundary` obsluhuje `ErrorBlock` v dlaždici (P05 to tak sám uvádí u kritéria 24 na ř. 13011) a offline řeší `SystemBar`. Je to spor o jména, ne o funkci. To ho ale nedělá méně blokujícím.

**Navržená oprava:** sjednotit v jednom seznamu. Doporučuji ponechat jména P05 a opravit P06, s jedinou výjimkou: `OfflineBanner` by se měl z `patterns/shell` re-exportovat i pod `patterns/states`, protože offline je stav obrazovky podle katalogu 7.1, ne prvek skořápky.

**Kde se opravuje:** převážně **v P06, kapitola 2.2, předpoklad U4**; re-export offline **v P05, úkol 17**.

---

### K5. Registr navigace má jiný tvar, než na jaký P06 staví, a chybí v něm příznak `mvp0`

**Kde v P05:** úkol 28, `NavigationItem` na ř. 10860 a dál, `NAVIGATION` na ř. 10874.
**Kde v P06:** kapitola 2.2, předpoklad U6 na ř. 146 a vysvětlení na ř. 151.

P06 očekává:

```ts
export const NAVIGATION: readonly NavItem[]
NavItem = { id: string; section: 'main' | 'settings'; labelKey: string; permission?: string; mvp0: boolean; href(params: { workspaceSlug: string }): string }
```

P05 dodává strom se sedmi kořeny, kde položka má `id`, `labelKey`, `path`, nepovinné `permission`, nepovinné `reservedFor?: 'MVP2'` a `children`. Vlastnost `href` na položce **vůbec není**: vzniká až jako `VisibleNavigationItem` po zavolání `visibleNavigation({ permissions, workspaceSlug })` (ř. 10961), a je to **řetězec, ne funkce**.

Rozdíly:

- pole `section` neexistuje, hierarchii nese vnoření do `children`
- pole `mvp0` neexistuje vůbec, P05 zná jen `reservedFor` a používá ho na jediné položce `automations`
- `href` je řetězec dopočítaný funkcí, ne metoda na položce
- `NAVIGATION` je strom o délce 7, ne plochý seznam

Nejvážnější je `mvp0`. P06 na ř. 151 popisuje postup, jak pozdější plány svou obrazovku zveřejní: „Pozdější plán, který svou obrazovku nastavení dodá, **přehodí jeden boolean** v souboru P05 jako deklarovanou úzkou výjimku." **Ten boolean neexistuje.** P05 má dvanáct položek Nastavení (ověřeno, `settings-general` až `settings-account`) a žádná z nich nenese příznak, že se v MVP 0 nezobrazuje. Všech dvanáct se tedy zobrazí od začátku a šest z nich povede na cestu, kterou v MVP 0 nikdo nenaplní.

**Navržená oprava:** doplnit do `NavigationItem` pole `mvp0: boolean` a nastavit `false` u `settings-sending`, `settings-fields`, `settings-consent`, `settings-tracking`, `settings-ai`, `settings-backups`. Funkce `visibleNavigation` je pak vyfiltruje stejně jako `reservedFor`. Zbytek neshody (`section`, `href` jako funkce) opravit v P06.

**Kde se opravuje:** příznak `mvp0` **v P05, úkol 28**, protože registr vlastní P05 a uzávěr S5 zakazuje, aby ho rozšiřoval někdo jiný. Zbytek **v P06, kapitola 2.2**.

---

### K6. `useAnnounce` proti `useAnnouncer`: jiné jméno i jiný návratový typ

**Kde v P05:** úkol 18, `export function useAnnouncer(): Announcer` na ř. 6831. Vrací objekt s metodami (`polite` a další), což je vidět na ř. 6839: `const { polite } = useAnnouncer();`
**Kde v P12:** předpoklad E3 na ř. 41 a požadavek P05-R3 na ř. 7511, obojí žádá `useAnnounce()` vracející `(message: string) => void`.

Liší se jméno i tvar. P12 potřebuje oznamovat novou pozici bloku po přesunu z klávesnice (kritérium 54), takže na tom stojí jedno z jeho akceptačních kritérií.

**Navržená oprava:** ponechat `useAnnouncer()` a opravit P12, protože objekt s `polite` a `assertive` je věcně správnější: kritérium 54 potřebuje zdvořilé oznámení, chybová hláška potřebuje důrazné.

**Kde se opravuje:** **v P12**, předpoklad E3 a požadavek P05-R3.

---

### K7. Devět komponent, které navazující plány importují, v `packages/ui` neexistuje

Ověřeno grepem přes všech šestnáct plánů.

| Komponenta | Kdo ji importuje | Co P05 má |
|---|---|---|
| `Alert` | P12 (P05-R3, ř. 7511), P13 (třikrát) | nic |
| `FileDrop` | P11 (dvakrát) | `FileUpload` |
| `Disclosure` | P13 | `Collapsible` |
| `CopyButton` | P13 | nic, kopírování je uvnitř `ErrorBlock` |
| `Dot` | P13 | nic |
| `Tile` | P13 | nic |
| `Table` | P16 | `DataTable`, `TableSkeleton` |
| `Note` | P16 | nic |
| `Panel` | P16 | nic |
| `Banner` | P16 | `StaleBanner`, `ReadOnlyBanner` |

`Alert` je nejzávažnější, protože ho žádají dva plány nezávisle na sobě a jde o obecný informační blok, který v katalogu stavů 7.1 skutečně chybí.

**Navržená oprava:** doplnit do P05 komponentu `Alert` s variantami `info`, `warning`, `danger` a `success` (potřebují ji P12 i P13) a přejmenování `FileDrop` na `FileUpload` řešit v P11. Zbytek jsou jednoduché náhrady existujícími komponentami, které si každý konzumující plán opraví u sebe.

**Kde se opravuje:** `Alert` **v P05, úkol 17**. Ostatní v plánech, které je importují (P11, P13, P16), protože pro ně existuje náhrada.

---

## DŮLEŽITÉ

### D1. Devatenáct importů z holého barrelu `@mlain/ui`, který P05 vědomě nemá

**Kde v P05:** kapitola 4, ř. 248: „Vždy podcesta. **Barrel `index.ts` se nerozšiřuje o komponenty**, uzávěr S11 to zakazuje." Mapa souborů to potvrzuje na ř. 152: `index.ts` je „jen re-export typů".

Přesto P11, P13 a P16 importují komponenty z holého `@mlain/ui` celkem devatenáctkrát, například `import { DataTable, QueryBuilder, Wizard, FileDrop, useToast } from '@mlain/ui';` v P11.

Žádný z těch importů se nevyřeší. Je to systémový nález: pravidlo je zapsané jen v P05 a tři plány o něm nevědí.

**Navržená oprava:** doplnit pravidlo do kapitoly „Požadavky na jiné plány" v P05 (kapitola 8 už tři podobná pravidla obsahuje, tohle mezi ně patří) a opravit importy v P11, P13 a P16.
**Kde se opravuje:** pravidlo **v P05, kapitola 8**; importy v P11, P13 a P16.

---

### D2. Slovník 9.2 je do kontroly přepsaný jen zčásti, a chybí právě ta trojice, na které stojí spor s P12

**Kde:** úkol 9, `BANNED_CS` na ř. 3582 až 3603, dvacet položek.

Sloupec „Nikdy nepoužívat" ve slovníku 9.2 části 6 (ř. 3617 až 3733) obsahuje napříč šesti podtabulkami **přes šedesát výrazů**. `BANNED_CS` jich hlídá dvacet. Kritérium 69 přitom žádá, aby se v katalozích nevyskytl **žádný** výraz z toho sloupce, a P05 v kapitole 6 na ř. 12985 tvrdí, že kritérium 69 je **plně pokryté**.

Chybí mimo jiné: `účet`, `klient`, `lead`, `skupina`, `publikum`, `filtr`, `chytrý seznam`, `atribut`, `newsletter`, `mailing`, `layout`, `komponenta`, `adresát`, `widget`, `poskytovatel`, `brána`, `reply-to`, `bounce`, `complaint`, `spam report`, `double opt-in`, `nepotvrzený`, `neaktivní`, `proklik`, `CTR`, `event`, `subject`, `preheader`, `plain text`, `branding`, `task`, `proces`, `token`, `redaktor`, `pozorovatel`.

Zvlášť stojí za pozornost, že chybí **`personalizace`, `proměnná` a `merge tag`**. Slovník 9.2 je má na ř. 3708 v jednom řádku s `placeholder` a `slučovací značka`, které P05 přepsal. Právě na téhle trojici stojí požadavek P05-R2 z plánu P12 (ř. 7510), kde P12 tvrdí, že jeho katalog `editor` shodí job `i18n-check`. **Jak je P05 napsaný teď, neshodí**, protože `personalizace` v zakázaném seznamu není. Spor se tím neřeší, jen zůstane skrytý.

Uznávám, že doslovný přepis celého sloupce by vyrobil planá hlášení: `účet`, `test`, `adresa`, `skupina` nebo `klik` jsou běžná slova. Právě proto má `BannedTerm` pole `except`, které je zatím u všech dvaceti položek prázdné.

**Navržená oprava:** buď doplnit seznam a využít `except` na oborová omezení klíčů, nebo v kapitole 6 přeřadit kritérium 69 z „plně pokrytá" do „částečně pokrytá" a napsat, které výrazy se vědomě nehlídají a proč. Druhá varianta je poctivější a levnější. Trojici `personalizace`, `proměnná`, `merge tag` doplnit tak jako tak, protože o ní běží spor.

**Kde se opravuje:** **v P05, úkol 9** (seznam) a **kapitola 6** (tvrzení o pokrytí).

---

### D3. Kritérium 47 žádá sto podmínek, plán měří padesát potomků a na sto nemá test

**Kde:** úkol 21, `MAX_DEPTH = 5` a `MAX_CHILDREN = 50` na ř. 8040 a 8041. Test „nedovolí víc než 50 potomků jedné skupiny" na ř. 7957.

Zdroje se liší:

| Zdroj | Znění |
|---|---|
| 13.1 části 6 | „do hloubky 5 a 50 potomků" |
| Kritérium 47 části 6 | „Builder dovolí zanoření do hloubky 5 a **100 podmínek**" |
| Řídicí dokument, P11 | „hloubka 5, 50 potomků a všech 40 operátorů" |

Rozpor to není: padesát potomků na skupinu ve stromu hloubky 5 unese sto podmínek s velkou rezervou. P05 ale v kapitole 6 na ř. 12982 uvádí kritérium 47 jako plně pokryté, a **test na sto podmínek v plánu není**. Kontrola hloubky ano, kontrola sta podmínek ne.

Ověřil jsem přitom, že mez hloubky je spočítaná správně: `depthOf(parentId) < MAX_DEPTH - 1` na ř. 8105 povolí skupiny na úrovních 0 až 4, tedy pět úrovní, a `depth >= MAX_DEPTH - 1` na ř. 8645 na šesté úrovni tlačítko schová místo chyby, přesně jak kritérium 47 žádá.

**Navržená oprava:** doplnit do testu z úkolu 21 případ se stem podmínek rozložených do stromu a ověřit, že se vykreslí a že je rozhraní použitelné.
**Kde se opravuje:** **v P05, úkol 21, krok 1.**

---

### D4. Virtualizace tabulky je jediné místo v plánu, kde místo kódu stojí pokyn, a nemá test

**Kde:** úkol 20, krok 6 na ř. 7866 až 7888.

Krok dodá kód pro `useVirtualizer` a výpočet `visibleRows`, ale změnu vykreslovací smyčky popisuje větou: „Ve výpisu pak iteruj `visibleRows` a `aria-rowindex` počítej z `index + 2`." Řídicí dokument v kapitole 7 žádá „úplný kód v každém kroku, který kód mění".

Chybí navíc test, který ověří, že se virtualizace zapne od sta řádků. Spec 14.2 to má jako tvrdou hodnotu („Virtualizace se zapíná od 100 řádků"). P05 sám v kapitole 6 na ř. 13018 uvádí kritérium 77 jako částečně pokryté s poznámkou „měření na reálných datech", takže si toho je vědom, ale mez sta řádků je testovatelná i bez měření výkonu.

Za správné považuji, že `aria-rowcount` a `aria-rowindex` se počítají z dat, ne z vykreslených uzlů (ř. 7866). To je přesně ten požadavek 13.1 „korektní role a `aria-rowcount` i při virtualizaci" a plán ho má ošetřený.

**Navržená oprava:** vypsat celý soubor `data-table.tsx` po zapnutí virtualizace a doplnit test, který při 150 řádcích ověří, že v DOM je řádků méně než `aria-rowcount`.
**Kde se opravuje:** **v P05, úkol 20, krok 6.**

---

### D5. Předpoklad E7 je kruhový: P01 má registrovat ESLint pravidlo ze souboru, který zakládá až P05

**Kde:** kapitola 0.3, předpoklad E7 na ř. 44: „Registrace ESLint pravidla z `packages/ui/eslint-rules` ve sdílené konfiguraci" v `packages/config`, a požadavek P05→P01.2 na ř. 13043.

P01 běží první a `packages/ui` v té chvíli existuje jen jako prázdná kostra (předpoklad E4b, ř. 41). Soubor `packages/ui/eslint-rules/no-disabled-primary-action.cjs` zakládá až P05 v úkolu 6. Kdyby sdílená konfigurace P01 pravidlo načítala rovnou, spadla by na chybějícím souboru každému, kdo mezi P01 a P05 spustí lint, tedy i plánům P02, P03 a P04.

**Navržená oprava:** načítat pravidlo podmíněně (`try`/`catch` kolem `require`, nebo registrace až v konfiguraci `apps/web`, kterou stejně přebírá P05), případně přesunout `eslint-rules` do `packages/config`, který vlastní P01. První varianta je nejlevnější.

**Kde se opravuje:** **v P01** (podmíněné načtení) a poznámkou **v P05, kapitola 0.3, předpoklad E7**, aby bylo jasné, že se nejedná o tvrdý import.

---

## POZNÁMKY

### P1. Oprava vzoru pro rody je správná a je jediná v celém repozitáři

P05 na ř. 2766 až 2769 (úkol 8) pojmenoval chybu ve vzoru specifikace přesně: `{gender, select, female {Otevřela} male {Otevřel} other {Otevření}} kampaň {campaign}` u neznámého rodu vyrobí „Otevření kampaň", protože slovo „kampaň" stojí mimo přepínací blok. Náprava je celá věta v každé větvi:

```
"{gender, select, female {Otevřela kampaň {campaign}} male {Otevřel kampaň {campaign}} other {Otevření kampaně {campaign}}}"
```

Ověřeno napříč plány: **P14 vzor přebírá správně** ve všech čtrnácti zprávách časové osy (ř. 6785 až 6799), včetně anglických protějšků. **P06 a P12 žádnou zprávu s `gender, select` nemají**, takže se jich nález netýká; není to opomenutí, ani jeden nezobrazuje větu o konkrétním kontaktu.

Nález N5 v evidenci zůstává otevřený jen na straně specifikace.

### P2. Plurály v `common` splňují české pravidlo o slovese

Ověřeno v úkolu 8. České zprávy mají všechny čtyři kategorie plus `=0` a sloveso se s číslem skutečně mění, například `table.selectedOnPage` na ř. 2909:

```
"{count, plural, =0 {Nevybráno nic} one {Vybrán # kontakt na této stránce} few {Vybrány # kontakty na této stránce} many {Vybráno # kontaktu na této stránce} other {Vybráno # kontaktů na této stránce}}"
```

Tvary „Vybrán, Vybrány, Vybráno" jsou správně. Kategorie `many` je vyplněná pro desetinná čísla. Anglické zprávy mají jen `one` a `other`, což je pro angličtinu správně.

### P3. Licence jsou ověřené vlastním průzkumem a `pa11y` je odmítnutý jmenovitě

Kapitola 2 (ř. 74 až 137) neopisuje doporučení specifikace, ale ověřuje ho. Na ř. 133: „`pa11y` se v tomhle projektu nepoužije. Ověřeno 31. 7. 2026: verze 9.1.1, licence **LGPL-3.0-only**." Grep potvrdil, že `pa11y` se v celém plánu nevyskytuje nikde jinde.

`axe-core` a `@axe-core/playwright` jsou MPL-2.0, správně vedené jako vývojové závislosti se záznamem v `licenses.allow.json` a s `expires_at`. `class-variance-authority` je Apache-2.0, `lucide-react` ISC, `@playwright/test` Apache-2.0, všechno v povoleném seznamu. Žádná GPL, LGPL ani AGPL.

Plán navíc odmítl tři doporučené balíčky (`sonner`, `react-querybuilder`, `react-dropzone`) s věcným, ne licenčním zdůvodněním, což je v souladu s 13.2, kde jsou konkrétní balíčky výslovně nenormativní.

### P4. Co dál je ověřené jako v pořádku

- **Počet úkolů sedí:** 34 nadpisů `### Úkol N`, číslování souvislé, bez duplicit.
- **Žádné zástupné texty:** grep na `TODO`, `FIXME`, `doplnit později`, `zde bude`, `analogicky`, `obdobně` nevrátil v P05 ani jeden zásah. Jediná výjimka je prozaický krok popsaný v nálezu D4.
- **Žádná dlouhá pomlčka:** znak U+2014 se v P05 nevyskytuje ani jednou.
- **Rozdělení i18n katalogů drží.** Ověřeno napříč všemi šestnácti plány: dvanáct namespace (`ai`, `auth`, `campaigns`, `common`, `contacts`, `editor`, `import`, `onboarding`, `reports`, `segments`, `settings`, `tracking`) a **každý z nich zakládá právě jeden plán**. `common` jen P05. Uzávěr S4 je dodržený beze zbytku.
- **K6 skutečně blokuje odchozí požadavky.** `sandbox=""` bez výjimek plus CSP `default-src 'none'; img-src data:` v `srcdoc`, a je na to test. Tohle je jediné správné řešení a mnoho implementací se spokojí se samotným atributem `sandbox`, který by obrázek z cizí domény načetl.
- **K3 splňuje všechny tvrdé požadavky:** krok v URL, `TTL_MS = 24 * 60 * 60 * 1000` s testem „po 24 hodinách rozdělaný stav zmizí", destruktivní návrat se ptá a říká, co se ztratí, změna kroku se ohlašuje přes `aria-live`.
- **K4 splňuje povinnou klávesovou alternativu:** vstup jde projít tabulátorem a otevřít Enterem nebo mezerníkem (ř. 9382), nahrávání po částech má `chunkSize` a přerušení přes `AbortSignal` s testem „zrušení zastaví další části". Soubor 200 MB se pošle po 40 kusech.
- **K1 má Shift + klik, sticky hlavičku i klávesovou navigaci**, `aria-rowcount` počítané z dat a kurzorové stránkování bez čísel stránek.
- **Zákaz `disabled` na primární akci má dvojí pojistku:** typovou (varianta `primary` prop `disabled` nepřijímá) a lintovou s allowlistem, rozhodnutí R5. Spor kritérií 16 a 18 plán řeší propem `unavailableReason` místo mrtvého tlačítka, rozhodnutí R7. To je rozumné a odpovídá otevřenému nálezu N6.
- **Registr navigace je celý dopředu**, sedm kořenů včetně rezervované položky `automations` s `reservedFor: 'MVP2'`, a test ověřuje, že se v MVP 0 nezobrazuje. Uzávěr S5 je splněný, až na chybějící `mvp0` z nálezu K5.
- **`proxy.ts` je jeden soubor se všemi matchery** (úkol 12) a rozhodnutí R1 správně odmítá zastaralý název `middleware.ts` z řídicího dokumentu. Odpovídá uzavřenému nálezu U1.

---

## Shrnutí pro rozhodnutí

Sedm kritických nálezů se dělí na dvě skupiny a každá se řeší jinak.

**Jeden je věcný a patří jen do P05:** K2 query builder neumí vykreslit tvary hodnot, které matice části 2 vyžaduje (nález K1). To je práce na půl dne uvnitř úkolu 21 a bez ní nefunguje segment builder.

**Šest je o dohodě na rozhraní** (nálezy K2 až K7). Žádný z nich nevznikl chybou v úvaze, všechny vznikly tím, že se P05 a navazující plány psaly souběžně a nikdo je nepostavil vedle sebe. Právě proto doporučuji **jeden krátký sjednocující průchod přes rozhraní `packages/ui`**, obdobný tomu, co evidence nálezů zavedla pro schéma pod položkou N9: vzít seznam exportů P05, seznam volání z jedenácti navazujících plánů a srovnat je v jedné tabulce **před** zahájením vlny 1.

Bez toho průchodu se stane přesně to, před čím uzávěr S3 varuje. Jedenáct plánů narazí na neexistující jméno naráz, každý si komponentu dopíše sám a `packages/ui` se rozpadne na jedenáct verzí téhož.
