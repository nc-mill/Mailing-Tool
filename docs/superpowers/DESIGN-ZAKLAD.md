# Základ designu Mlain Maileru

Zadání pro agenty, kteří staví jednotlivé obrazovky. **Přečti si to celé, než
napíšeš první řádek.** Je to psané pro někoho, kdo návrhy neviděl.

Etapa 0 je hotová: tokeny, písmo, ikony, skořápka a základní prvky. Tvoje
obrazovka z toho skládá, nezakládá si vlastní.

---

## 0. Než začneš

### Kde vezmeš návrh

**Nástroj `DesignSync` subagentům dostupný není.** `ToolSearch(query:
"select:DesignSync")` ti vrátí „No matching deferred tools found". Nezdržuj se
tím, návrhy jsou vyexportované na disku:

```
/Users/petr/Projects/Mailing_Tool/.dev-design-src/
```

Když tam tvoje obrazovka chybí, napiš si o export hlavnímu agentovi. On
`DesignSync` má.

### Jak návrhy číst

Jsou to soubory `.dc.html`, náhledy s **inline styly**. Vypadají takhle:

```html
<section style="padding: 25px; border: 1px solid #E1D9C4; border-radius: 10px;">
```

Ty hodnoty **neopisuj do kódu**. Najdi si je v tabulkách níž a použij token:
`#E1D9C4` je `border-border`, `25px` je `--spacing-card-tight`, `10px` je
`--radius-surface`. Když hodnotu v tabulkách nenajdeš, **napiš hlavnímu
agentovi**, ať se doplní token. Nepiš ji natvrdo, zadavatel to kontroluje
grepem.

V souborech potkáš značky `<sc-if>`, `<sc-for>`, `{{ promenna }}` a na konci
`<script type="text/x-dc">` s ukázkovými daty. To je jazyk náhledu, do aplikace
se nepřenáší. Data v návrhu jsou vymyšlená, skutečná berou obrazovky odjinud.

### Co se nesmí

1. **Nic natvrdo.** Ani jedna barva, mezera, velikost písma ani rádius přímo
   v komponentě. Všechno přes token.
2. **Funkčnost se nesmí ztratit.** Obrazovky dneska něco umí. Měníš vzhled,
   ne chování. Když návrh nějakou funkci nezachycuje, funkce **zůstává**
   a dostane vzhled podle systému.
3. **Texty z katalogu** (`packages/i18n/messages/cs/*.json` a `en/*.json`),
   ne z návrhu. Návrh je česky, aplikace je dvojjazyčná. Nový klíč do obou.
4. **Přístupnost se nesmí zhoršit.** Viditelný focus, sémantické landmarky,
   kontrast, klikací plocha aspoň 44 px.

---

## 1. Tokeny

Všechny jsou v `packages/ui/src/tokens.css`. Utility v `packages/ui/src/globals.css`.
Používají se přes třídy Tailwindu (`bg-surface`, `text-h1`) nebo přes
`var(--…)` v hranatých závorkách (`p-[var(--spacing-card)]`).

### 1.1 Barvy ploch a textu

| Token | Světle | Tmavě | K čemu |
|---|---|---|---|
| `--color-surface` | `#FAF7EE` | `#1D1A13` | Papír. Pozadí stránky i běžné karty. |
| `--color-surface-muted` | `#F2ECDB` | `#252115` | Klidnější plocha: hlavička tabulky, vysvětlivka, najetí myší na řádek. |
| `--color-surface-raised` | `#FAF7EE` | `#252115` | Plocha, která má ve tmavém režimu vystoupit. Ve světlém je to papír. |
| `--color-surface-overlay` | `#FDFBF4` | `#2B2617` | Rozbalená nabídka, dialog. |
| `--color-border` | `#E1D9C4` | `#393426` | **Hairline rámeček.** Karty, linky mezi řádky, oddělovače. |
| `--color-border-strong` | `#94896C` | `#6F6550` | Rámeček formulářového pole a všeho, do čeho se dá psát. |
| `--color-text` | `#26221A` | `#EDE7D6` | Text. |
| `--color-text-muted` | `#6C6453` | `#A89D85` | Druhořadý text: popisky, meta údaje, nápověda pod polem. |
| `--color-field` | `#FDFBF4` | `#211D14` | Pozadí formulářového pole. Světlejší než papír, aby bylo poznat, kam se píše. |

### 1.2 Identita a stavy

| Token | Světle | Tmavě | K čemu |
|---|---|---|---|
| `--color-primary` | `#E4C258` | `#E4C258` | **Obilná žlutá. Jediná identitní barva.** Hlavní tlačítko, značka, zvýraznění. |
| `--color-primary-hover` | `#CFAC38` | `#CFAC38` | Najetí na hlavní tlačítko, rámeček zvýrazněné karty. |
| `--color-primary-foreground` | `#26221A` | `#26221A` | Text na žluté. |
| `--color-accent-text` | `#77621B` | `#D9BC66` | Odkaz. |
| `--color-accent-surface` | `#F5E8BC` | `#3E361D` | Žlutá plocha: zvýrazněná karta, štítek, iniciály. |
| `--color-success` / `-text` | `#4A5A2A` | `#A9C285` | Hotovo, potvrzeno, doručeno. |
| `--color-success-surface` | `#E3EAD3` | `#2B331E` | Plocha zeleného stavu. |
| `--color-warning` / `-text` | `#6E5716` | `#E8CC72` | Upozornění. **Text na žluté ploše.** |
| `--color-warning-surface` | `#F5E8BC` | `#3E361D` | Plocha upozornění (stejná žlutá jako `accent-surface`). |
| `--color-danger` / `-text` | `#A4432C` | `#E08A70` | Chyba, mazání, odmítnutí. |
| `--color-danger-surface` | `#F7E6E0` | `#3A211A` | Plocha chyby. |
| `--color-*-foreground` | | | Text NA plné barvě (tlačítko `destructive`). |
| `--color-focus-ring` | `#26221A` | `#E4C258` | Obrys zaostřeného prvku. |
| `--color-scrim` | tmavá průhledná | | Zástěna pod dialogem. |

Kontrast všech dvojic hlídá `packages/ui/src/lib/tokens.test.ts`. Když si
přidáš barevný token, přidej ho do OBOU tmavých bloků, jinak test spadne.

### 1.3 Tmavý panel

**V obou režimech stejný.** Tmavý panel je prvek identity, ne důsledek motivu:
boční menu je tmavé i ve světlé aplikaci.

| Token | Hodnota | K čemu |
|---|---|---|
| `--color-panel` | `#26221A` | Plocha panelu: boční menu, pruh výběru, bublina nápovědy. |
| `--color-panel-foreground` | `#F5EFDF` | Hlavní text na panelu. |
| `--color-panel-soft` | `#C9BFA8` | Běžný text na panelu, nezvýrazněná položka menu. |
| `--color-panel-muted` | `#9A907B` | Nejtišší text na panelu: počet, nadpis skupiny. |
| `--color-panel-line` | `#3D372B` | Linky a plocha při najetí na panelu. |
| `--color-panel-active` | `#33301F` | **Plocha otevřené podpoložky menu.** Nesmí to být `--color-panel-line`: ta je zároveň barvou při najetí, takže by otevřená podpoložka splynula s tou pod myší. |
| `--color-focus-ring-panel` | `#F5EFDF` | **Obrys focusu na tmavém panelu.** Běžný `--color-focus-ring` je ve světlém motivu tmavý inkoust, na panelu má kontrast 1:1 a je neviditelný. |

Na tmavou plochu se dává třída **`on-panel`**, která barvu obrysu přepne na
světlou pro celý podstrom. `Sidebar`, `SelectionBar` i `Card tone="panel"`
ji už mají; když stavíš vlastní tmavou plochu, přidej ji.

### 1.4 Hrany tlačítek

| Token | Hodnota | K čemu |
|---|---|---|
| `--color-edge` | `#26221A` | Spodní hrana běžného tlačítka. |
| `--color-edge-primary` | `#8A6F1D` | Spodní hrana žlutého tlačítka. |
| `--edge-raised` | `3px` | Výška hrany, když tlačítko „stojí". |
| `--edge-pressed` | `1px` | Výška hrany, když tlačítko „dosedne". |
| `--edge-travel` | `2px` | O kolik se tlačítko posune dolů. |

### 1.5 Rádiusy

| Token | Hodnota | K čemu |
|---|---|---|
| `--radius-control` | `4px` | Tlačítka, pole, odznaky, štítky, ikonové čtverečky. |
| `--radius-surface` | `10px` | Karty, panely, vysouvací menu. |
| `--border-accent` | `3px` | **Silná linka na hraně prvku:** žlutý pruh u aktivní položky menu, levý okraj hlášky. Není to rámeček ani hrana tlačítka (`--edge-raised`), je to ukazatel. |

**Třetí hodnota v systému není.** Když je něco kulaté, je to buď 4, nebo 10.
Výjimka: kolečko (`rounded-full`) u přepínače, tečky a tlačítka zabalení menu.

### 1.6 Mezery

Návrh počítá v násobcích 5 px. Tokeny mají názvy podle role, ne podle čísla:
číselné názvy by se srazily s výchozí škálou Tailwindu (`p-20` je v ní 80 px)
a tiše by přepsaly rozestupy v celé aplikaci.

| Token | Hodnota | K čemu |
|---|---|---|
| `--spacing-page` | `40px` | Vnitřní okraj hlavního sloupce. Dodává `AppShell`, sám ho nepiš. |
| `--spacing-card` | `30px` | Velká karta: graf, formulářová sekce, seznam. |
| `--spacing-card-tight` | `25px` | Dlaždice s číslem, užší karta. Taky odstup hlavičky obrazovky od obsahu. |
| `--spacing-gutter` | `20px` | Mezera mezi kartami v mřížce. |
| `--spacing-stack` | `15px` | Svislá mezera uvnitř karty. |
| `--spacing-inline` | `10px` | Mezera mezi drobnými prvky vedle sebe. |
| `--spacing-hairline` | `5px` | Popisek a hodnota těsně pod sebou. |
| `--spacing-row-x` | `20px` | Vodorovný okraj řádku tabulky. |
| `--spacing-row-y` | `14px` | Svislý okraj řádku tabulky. |
| `--spacing-badge-y` | `3px` | Svislý okraj odznaku. |
| `--spacing-section` | `25px` | **Mezera mezi sekcemi obrazovky.** Hlavička → obsah, tabulka → další karta. |
| `--spacing-title-sm` | `5px` | Nadpis obrazovky → mono meta řádek. |
| `--spacing-title-md` | `8px` | Nadpis obrazovky → vysvětlující věta. |
| `--spacing-title-lg` | `10px` | Nadpis obrazovky → meta řádek, který nese odznak. |

Pro mezery, které v tabulce nejsou (2 px, 6 px, 12 px), používej běžnou škálu
Tailwindu: `gap-0.5`, `gap-1.5`, `gap-3`. Je to čtyřkový krok, ne pětkový,
ale u těchhle drobností to nikdo nepozná a je to čitelnější než token na
každou hodnotu.

### 1.7 Rozměry

| Token | Hodnota | K čemu |
|---|---|---|
| `--size-topbar` | `70px` | Výška hlavičky. |
| `--size-sidebar` | `236px` | Rozbalené boční menu. |
| `--size-sidebar-collapsed` | `76px` | Zabalené boční menu. |
| `--size-target-min` | `44px` | **Nejmenší klikací plocha.** Nikdy pod to. |
| `--size-control` | `40px` | Pole filtru, ikonové tlačítko v hlavičce. |
| `--size-control-sm` | `36px` | Tlačítko v liště, stránkování, ikonový čtverec na dlaždici. |
| `--size-control-xs` | `34px` | Ikonové tlačítko v řádku tabulky. |
| `--size-avatar` | `32px` | Iniciály v hlavičce. |
| `--size-switch-width` / `-height` / `-knob` | `52` / `30` / `22px` | Přepínač a jeho kolečko. |
| `--size-choice` | `18px` | Zaškrtávátko a přepínací tečka **ve formuláři**. |
| `--size-choice-dense` | `16px` | Totéž **v řádku tabulky**, kde jich je padesát pod sebou. |
| `--size-choice-column` | `20px` | Sloupec, ve kterém zaškrtávátko sedí. |
| `--size-mark` | `30px` | Značka v hlavičce, iniciály v řádku tabulky. |
| `--size-icon-box` | `44px` | Velký barevný čtverec s ikonou. |
| `--size-control-2xs` | `32px` | Kotva události na časové ose. |
| `--size-text-column` | `640px` | **Sloupec souvislého textu:** věta v hlavičce, formulář. Starší název `--container-prose` na něj odkazuje a funguje, ale nový kód piš s tímhle. |
| `--size-field-number` | `200px` | Krátké číselné pole: platnost odkazu, strop odeslání. |
| `--size-field-narrow` | `96px` | Nejužší číselné pole: šířka sloupce tabulky. |
| `--container-screen` | `1320px` | Strop šířky běžné obrazovky. |
| `--container-screen-wide` | `1560px` | Strop obrazovky se širokou tabulkou. |

### 1.8 Velikosti ikon

Pět velikostí, nic mezi nimi. Používají se jako třídy: `icon-sm` a podobně.

| Třída | Token | Hodnota | Kde |
|---|---|---|---|
| `icon-2xs` | `--size-icon-2xs` | `12px` | Ikona uvnitř odznaku a štítku. |
| `icon-xs` | `--size-icon-xs` | `14px` | Drobečky, šipka u podpoložky. |
| `icon-sm` | `--size-icon-sm` | `16px` | Tlačítko v liště, řádek tabulky, odznak. |
| `icon-md` | `--size-icon-md` | `18px` | Ikonové tlačítko, dlaždice, hláška. |
| `icon-lg` | `--size-icon-lg` | `20px` | Položka bočního menu, nápověda v hlavičce. |
| `icon-xl` | `--size-icon-xl` | `22px` | Velká ikona na kartě. |

**Nikdy `size-4`.** 16 px z výchozí škály Tailwindu je náhoda, `icon-sm` je
rozhodnutí návrhu.

### 1.9 Písmo a velikosti

#### Kořenová velikost písma zůstává 16 px

Zdrojový designový systém počítá s `html { font-size: 62.5% }`, tedy 1 rem =
10 px, a jeho tokeny jsou proto v `rem` (`--wm-font-size__base: 1.7rem` je
17 px). **Aplikace to NEPŘEVZALA a nepřebírej to ani ty.**

Důvod: `62.5%` je celoaplikační přepínač, který by se propsal do všech
velikostí Tailwindu naráz. Odstupy, ikony i výšky prvků, které se počítají
z výchozí škály, by se zmenšily o 37,5 procenta a nešlo by to vrátit jinak
než ručně na každém místě. Přepočet by navíc rozbil `--size-target-min`,
tedy minimální klikací plochu.

Místo toho jsou **naše tokeny rovnou v pixelech**. Kořen zůstává na 16 px,
takže se dá porovnat s návrhem přímo: `--text-body: 17px` je totéž co
`--wm-font-size__base: 1.7rem` v návrhu, jen zapsané tak, aby to nezáviselo
na kořeni.

**Nikdy nesahej na `html { font-size }`.** Když v návrhu vidíš `1.5rem`,
je to 15 px, ne 24.

Samohostované **IBM Plex Sans** (400, 600) a **IBM Plex Mono** (400),
podmnožiny `latin` a `latin-ext`. Soubory jsou v `apps/web/public/fonts`,
deklarace v `apps/web/src/app/globals.css`. Z cizí domény se nenačítá nic.

| Třída | Token | Hodnota | Kde |
|---|---|---|---|
| `text-display` | `--text-display` | `40px` | Velké číslo na dlaždici. |
| `text-h1` | `--text-h1` | `36px` | Název obrazovky. |
| `text-h2` | `--text-h2` | `26px` | Mezinadpis na dlouhé stránce. |
| `text-h3` | `--text-h3` | `19px` | **Nadpis karty.** |
| `text-callout` | `--text-callout` | `28px` | Vysazený údaj: náhled oslovení, „zatím nevíme". |
| `text-lead` | `--text-lead` | `20px` | Úvodní odstavec. |
| `text-body` | `--text-body` | `17px` | Běžný text. Výchozí pro `<body>`. |
| `text-base` | `--text-base` | `16px` | Text v hlavním tlačítku. |
| `text-ui` | `--text-ui` | `15px` | **Výchozí velikost rozhraní.** Buňka tabulky, popisek, běžné tlačítko. |
| `text-sm` | `--text-sm` | `14px` | Druhořadý text, podpoložka menu, popisek pole. |
| `text-meta` | `--text-meta` | `13px` | Mono údaje, nápověda pod polem. |
| `text-label` | `--text-label` | `12px` | Mono verzálky: hlavička sloupce, odznak. |
| `text-micro` | `--text-micro` | `11px` | Štítek, iniciály v malém kolečku. |

Prostrkání a proklad: `--leading-heading` (1.12), `--leading-number` (1),
`--leading-body` (1.6), `--tracking-heading` (−0.01em),
`--tracking-number` (−0.02em), `--tracking-label` (0.05em).

**Nadpisy mají `tracking-[var(--tracking-heading)]`.** Bez toho vypadají
o kus širší než v návrhu.

### 1.10 Kdy mono

Mono (`font-mono`) nese **meta údaje, čísla a štítky**. Konkrétně:

- řádek pod názvem obrazovky („58 kontaktů · aktualizováno 15:31"),
- hlavičky sloupců v tabulce,
- odznaky a štítky,
- čas, datum, počet, procento, e-mailová adresa v tabulce,
- název projektu v přepínači,
- popisky v patičce.

Zbytek je IBM Plex Sans. Když si nejsi jistý: **čte se to po znacích?**
Pak mono.

Na verzálky je hotová utilita **`meta-caps`**: mono, 12 px, prostrkání 0.05em,
`text-transform: uppercase`. Píše se jednou, ne čtyřmi třídami.

```tsx
<span className="meta-caps text-text-muted">Odesláno</span>
```

### 1.11 Vrstvy a časování

`--z-sticky` 10, `--z-systembar` 20, `--z-toast` 30, `--z-dialog` 40,
`--z-sidebar` 40, `--z-topbar` 50, `--z-flyout` 60.

`--duration-fast` 120 ms (barvy), `--duration-normal` 200 ms (rozbalení),
`--duration-nav` 280 ms (zabalení menu).

---

## 2. Komponenty

Importují se z `@mlain/ui/components/<jméno>` a `@mlain/ui/patterns/<jméno>`.

### 2.1 `Button`

```tsx
import { Button } from '@mlain/ui/components/button';

<Button variant="primary" onClick={save}>Uložit změny</Button>
<Button variant="secondary" size="sm">Zrušit</Button>
<Button variant="destructive" pending={mazani} pendingLabel="Mažeme…">Smazat</Button>
```

Varianty: `primary` (žluté, jedno na obrazovku), `secondary` (výchozí,
průhledné s hranou), `destructive` (plná červená plocha),
`destructiveOutline` (rámeček, hrana i text v barvě nebezpečí, plocha
průhledná; návrh takhle kreslí mazání položky na jejím vlastním detailu),
`ghost` (bez hrany), `link`.
Velikosti: `sm` (36 px), `md` (44 px, výchozí), `lg` (48 px).

Vzhled: obdélník s rámečkem a plnou spodní hranou 3 px. Při najetí myší
tlačítko dosedne o 2 px níž a hrana se zkrátí na 1 px.

#### Tlačítko, které je ve skutečnosti odkaz

Akce, která se má dát otevřít na novém panelu, zkopírovat jako adresa nebo
poslat kolegovi, **musí zůstat odkazem**. `onClick` s `router.push` to
nespraví: prostřední tlačítko myši ani Cmd+klik na `<button>` nefungují.

```tsx
<Button asChild variant="primary">
  <Link href={`/w/${slug}/forms/new`}>Nový formulář</Link>
</Button>
```

`asChild` nevykreslí `<button>`, jen předá vzhled svému jedinému potomkovi.
Potomek musí být právě jeden prvek. `pending` ani `unavailableReason` se
s `asChild` nekombinují, obojí řídí chování tlačítka, které tam žádné není.

**Neopisuj si třídy variant do vlastní komponenty.** Když ti `Button` na něco
nestačí, řekni to hlavnímu agentovi.

**`primary` a `destructive` nepřijímají `disabled`.** Když akci nejde
provést, předává se `unavailableReason` a `onUnavailable`: tlačítko zůstane
funkční a vysvětlí důvod. Je to záměr, neobcházej to.

### 2.2 `Badge` a `Tag`

```tsx
import { Badge } from '@mlain/ui/components/badge';
import { Tag } from '@mlain/ui/components/tag';

<Badge tone="success">Odesláno</Badge>
<Badge tone="strong">Jádro</Badge>
<Tag tone="accent">ze slovníku</Tag>
```

`Badge` nese **stav** položky, stojí ve vlastním sloupci, 12 px mono verzálky.
Tóny: `neutral`, `accent`, `warning`, `success`, `danger`, `strong` (tmavá
plocha, žlutý text).

`Tag` nese **doplněk** k údaji vedle sebe, 11 px, tišší, může jich být v řádku
víc. Tóny: `neutral`, `accent`, `success`, `danger`. Ikonu bere nepovinně
stejně jako `Badge`, kreslí se v `icon-2xs` (12 px); mezeru drží `gap`,
nedoplňuj ji ručně.

Nejsi si jistý? Ptá se stránka „v jakém je to stavu?" → `Badge`. Ptá se
„co ještě o tom víme?" → `Tag`.

**Odznak stavu ikonu NEMÁ.** `icon` je nepovinný a v návrzích ho nemá ani
jeden odznak: rozlišovacím znakem je slovo, ne obrázek. S ikonou je odznak
o 22 px širší a v úzkém sloupci tabulky se pak láme. Když ji přesto někde
potřebuješ, musí to být rozhodnutí, ne zvyk.

### 2.3 `Card`

```tsx
import { Card, CardHeader, CardTitle, CardFooter } from '@mlain/ui/components/card';

<Card>
  <CardHeader title="Poslední kampaně" action={<Link href="…">Všechny kampaně</Link>} />
  …obsah…
  <CardFooter><span className="font-mono text-meta text-text-muted">15:31</span></CardFooter>
</Card>

<Card tone="highlight" padding="md">…</Card>
<Card padding="none">…tabulka až k rámečku…</Card>
```

Tóny: `plain` (výchozí), `muted`, `highlight` (žlutá, pro to jediné číslo,
kterému věříme), `panel` (tmavá).
Značka: `as` bere `section`, `div`, `article`, `aside` a **`li`**. Seznam
karet piš jako skutečný `<ul>` s `<Card as="li">`, ne přes `role="list"`.
Okraje: `lg` (30 px, výchozí), `md` (25 px), `sm` (20 px), `none`.
Mezery: `gap="stack"` (15 px, výchozí), `gutter` (20 px), `none`.

**Karta nemá stín ani gradient.** Odděluje ji hairline rámeček. Je to výslovné
pravidlo návrhu.

`CardFooter` se lepí ke dnu (`mt-auto`), takže několik karet vedle sebe má
patičku na stejné výšce. Ve zvýrazněné kartě mu přidej
`className="border-primary-hover"`, aby linka seděla na žlutou.

### 2.4 `PageHeader`

```tsx
import { PageHeader } from '@mlain/ui/components/page-header';

// obrazovka s číselným souhrnem
<PageHeader
  title={t('contacts.title')}
  meta={t('contacts.countLine', { count })}
  actions={<><IconButton … /><Button variant="primary">Přidat kontakt</Button></>}
>
  <RangeSwitch />
</PageHeader>

// obrazovka s vysvětlující větou
<PageHeader title={t('lists.title')} description={t('lists.description')} actions={…} />
```

| Propa | Co je zač |
|---|---|
| `title` | Název obrazovky, 36 px. |
| `eyebrow` | **Mono verzálky NAD nadpisem**, které říkají, co je to za obrazovku: „Report kampaně" nad názvem kampaně. Nezaměňuj s drobečky, ty vedou jinam. |
| `meta` | **Mono** řádek s čísly: počet, období, stav. |
| `description` | **Sans 17 px, tlumená věta**, nejvýš 640 px na šířku. |
| `titleGap` | `sm` 5 px, `md` 8 px, `lg` 10 px. Bez zadání `sm`, a `md`, když je vyplněný `description` nebo `eyebrow`. `lg` patří tam, kde meta řádek nese odznak, protože odznak je vyšší než text. |
| `breadcrumbs` | Drobečková navigace nad názvem. |
| `actions` | Tlačítka vpravo. **Hlavní akce je poslední**, tedy nejblíž kraji. |
| `children` | Filtry a přepínače mezi názvem a akcemi. |

**`meta` a `description` jsou alternativy, ne dvojice.** Žádná obrazovka
v návrhu nemá obojí: mono meta řádek je souhrn čísel, věta je vysvětlení.
Když předáš obojí, vykreslí se pod sebou a nic nespadne, ale je to znamení,
že jedno z toho patří jinam.

Celý blok je zarovnaný na **spodní** hranu, takže u obrazovky s popisem
klesnou akce pod větu. Návrh to tak má.

Spodní mezera je `--spacing-section` (25 px) a **píše ji `PageHeader` sám**.
Nepřidávej pod něj další `mb-*`.

### 2.5 Formulářové prvky

```tsx
import { Field } from '@mlain/ui/components/field';
import { Input } from '@mlain/ui/components/input';
import { Textarea } from '@mlain/ui/components/textarea';
import { Select, SelectItem } from '@mlain/ui/components/select';
import { Checkbox } from '@mlain/ui/components/checkbox';
import { Switch } from '@mlain/ui/components/switch';
import { RadioGroup, RadioGroupItem } from '@mlain/ui/components/radio-group';

<Field label={t('contacts.firstName')} hint={t('contacts.firstNameHint')} error={chyba}>
  <Input name="firstName" defaultValue={kontakt.firstName} />
</Field>
```

`Field` dodá popisek, propojí `id`, `aria-describedby` i `aria-invalid`
a vypíše nápovědu a chybu. **Pole se nikdy nepíše bez `Field`**, jinak přijde
o vazbu na popisek.

**Platí to i pro `Select`.** Ten dnes `id` přijímá, takže patří dovnitř
`Field` stejně jako `Input`. Nekresli si k němu vlastní `<span aria-hidden>`
vedle `aria-label`; byly by to dva popisky na totéž, které se můžou rozejít.
Mimo `Field` (filtr v liště, výběr v řádku tabulky) se dá `aria-label`.

**Typ to nevynucuje a je to vědomé.** Zkoušel jsem sjednocený typ „buď `id`,
nebo `aria-label`" a je to slepá ulička: `Field` dosazuje `id` až za běhu
přes `cloneElement`, takže překladač u správně napsaného výběru uvnitř
`Field` žádné `id` nevidí a svítí červená na kódu, který je v pořádku.

Vzhled: popisek 14 px polotučně, mezera 6 px, pole 44 px vysoké, vnitřní okraj
10/14, rámeček `border-strong`, pozadí `field`, text 15 px, nápověda 13 px.

Povinnost se **neznačí hvězdičkou**. Většina polí je povinná, takže se popisují
ta nepovinná (`optionalLabel`).

**Přepínač: zapnutý je žlutý, kolečko světlé.** Ne naopak. Rozměr 52 × 30
s kolečkem 22. Dřív to bylo obráceně a menší, takže zapnutý stav vypadal
jako vypnutý s ozdobou.

**Zaškrtávátko má dvě velikosti.** Ve formuláři 18 px, v řádku tabulky
`dense` (16 px). `DataTable` si `dense` nastavuje sám, ty na to nesahej.

### 2.6 Tabulka

```tsx
import { DataTable } from '@mlain/ui/patterns/data-table';
```

Karta tabulky je JEDNA plocha: rámeček, hlavička, řádky i **stránkování
uvnitř**. Patička se pod kartu nedává, vznikly by pod sebou dva rámečky.

Hlavička: plocha `surface-muted`, `meta-caps` v `text-muted`, okraj 12/20.
Řádek: okraj 14/20, spodní linka `border`, při najetí `surface-muted`,
vybraný řádek `accent-surface`. Patička se stránkováním: mono 13 px.
Pruh hromadného výběru (`SelectionBar`) je **tmavý panel**. Stránkování:
mono 13 px vlevo, vpravo dvě ikonové šipky 36×36 bez viditelného textu.

Sloupce, řazení, výběr, virtualizace a uložené šířky už komponenta umí.
Nepředělávej je, jen jí dodej data.

**Nastavení sloupců patří do hlavičky obrazovky**, ne nad tabulku: ikonový
čtverec 44×44 vedle hlavní akce, s ikonou `SlidersHorizontal`.

Pozor, **návrhy si v tomhle odporují**: Seznamy to mají jako ikonový čtverec
44×44 v hlavičce, Kontakty jako tlačítko se slovem „Sloupce" 40 px v řádku
filtrů. Platí varianta ze Seznamů, protože stejný ovládací prvek má na všech
obrazovkách vypadat stejně. Rozhodl to hlavní agent, je to čtvrtý rozpor
mezi návrhy a sbírají se v `DESIGN-INTEGRACE.md`. Obrazovka si proto může vzít stav panelu k sobě:

```tsx
const [sloupce, setSloupce] = useState(false);

<PageHeader
  actions={
    <IconButton
      label={t('table.columnSettings')}
      icon={<Settings2 aria-hidden className="icon-md" />}
      aria-expanded={sloupce}
      onClick={() => setSloupce((o) => !o)}
    />
  }
/>
<DataTable
  columnSettings={{ open: sloupce, onOpenChange: setSloupce }}
  labels={{ …, closeColumnSettings: t('common.actions.close') }}
/>
```

Když `columnSettings` nepředáš, tabulka si stav i tlačítko řídí sama, jako
dosud. **Předáváš-li ho, dodej i `labels.closeColumnSettings`**, jinak panel
nemá jak zavřít.

### 2.7 Časová osa

`@mlain/ui/patterns/timeline`. Řádek události vypadá takhle a je to **jediné
místo, kde se to rozhoduje**: osu používá detail kontaktu, report kampaně
i webová aktivita, takže ji nepředělávej u sebe.

- Mřížka `62px minmax(0,1fr) 36px`, mezera 15 px, okraj 14 px svisle.
- **Linka je NAHOŘE** (`border-top`), ne dole. První řádek pod nadpisem dne
  tedy linku má, poslední v den ji nemá.
- Čas: mono 13 px tlumeně.
- Střed: věta 15 px, pod ní volitelný mono řádek 12 px tlumeně
  (`renderMeta`, bez něj je řádek jednořádkový).
- Kotva vpravo: 32 px, rámeček naskočí až při najetí. Ikona `Link`.
- Nadpis dne: `meta-caps` tlumeně, okraj 10 px svisle, drží se nahoře
  při skrolování.

### 2.8 Ikony

```tsx
import { Users, Send, TriangleAlert } from '@mlain/ui/icons';

<Send aria-hidden className="icon-sm" />
```

**Jediné místo, odkud se ikona bere, je `@mlain/ui/icons`.** Jsou to ikony
Lucide, tedy přesně to, co je v návrhu.

- V `apps/web` **nesmí být `lucide-react`** v `package.json`. Nepřidávej ho.
  `@mlain/ui` ho má a přeposílá, to stačí.
- Sada má **122 ikon**: všechny, které jsou v návrzích (vytaženy strojově
  porovnáním cest SVG proti datům Lucide), plus zásoba pro Nastavení,
  tabulku a editor. Než si o novou napíšeš, podívej se, jestli tam není.
- **Ikonu nikdy nekresli ručně.** Když chybí, **napiš hlavnímu agentovi**;
  do `packages/ui` smí sahat jen agent základu. Chybějící export je navíc
  nebezpečný: Turbopack na jedné chybějící vazbě zabalí celý build, takže
  nespadne jen tvoje obrazovka, ale **celá aplikace včetně přihlášení**.
- Velikost vždycky `icon-*`, nikdy `size-*`.
- Ikona nikdy nenese význam sama: buď má vedle sebe slovo, nebo má nadřazený
  prvek `aria-label`. Proto `aria-hidden`.

Ikony sekcí bočního menu má na starost `sectionIcon(id)` v
`packages/ui/src/patterns/navigation/section-icons.ts`. Registr navigace
(`registry.ts`) ikony **neobsahuje a obsahovat nebude**.

### 2.9 `SegmentedControl`

```tsx
import { SegmentedControl } from '@mlain/ui/components/segmented-control';

<SegmentedControl
  label={t('reports.period')}
  options={[{ value: 7, label: t('reports.days7') }, …]}
  value={obdobi}
  onChange={setObdobi}
/>
```

Několik voleb v jednom rámečku: `role="group"`, uvnitř tlačítka bez vlastního
rámečku oddělená svislou linkou, zvolená na tmavé ploše. Hodnota smí být
řetězec i číslo. Zvolená volba nese `aria-pressed`, takže se stav nesděluje
jen barvou.

Skupina schválně **neořezává přetečení**: `overflow-hidden` by sice zaoblilo
rohy zvolenému tlačítku, ale ukrojilo by obrys toho zaostřeného, který se
kreslí 2 px vně.

### 2.10 `IconButton`

```tsx
import { IconButton } from '@mlain/ui/components/icon-button';
import { Upload, Trash2 } from '@mlain/ui/icons';

<IconButton label={t('contacts.import')} icon={<Upload aria-hidden className="icon-md" />} />
<IconButton variant="solid" label={t('lists.archive')} icon={…} />
<IconButton variant="danger" label={t('contacts.delete')} icon={<Trash2 aria-hidden className="icon-md" />} />
```

Čtverec s ikonou a bez viditelného textu. `label` je **povinný**: bez něj by
čtečka přečetla jen „tlačítko" a hlasové ovládání by tlačítko nenašlo.
Používá se zároveň jako `title`.

| Varianta | Vzhled | Kde v návrhu |
|---|---|---|
| `quiet` (výchozí) | Hairline rámeček, tlumená ikona | Import, export, nastavení sloupců v hlavičce |
| `solid` | Tmavý rámeček s hranou 3 px | Archivace seznamu |
| `danger` | Rámeček, hrana i ikona v barvě nebezpečí | Smazání kontaktu |
| `ghost` | Bez rámečku, naskočí až při najetí | Ikonová akce v řádku tabulky |

Velikosti: `md` 44 px (hlavička obrazovky), `sm` 40 px (lišta filtrů),
`xs` 36 px (stránkování), `row` 34 px (řádek tabulky).

Bublinu s popisem si komponenta nekreslí, obal ji `Tooltip`em, když ji akce
potřebuje.

### 2.11 Grafy

Dva, a je rozdíl, který si kdy vezmeš.

```tsx
import { TrendChart } from '@mlain/ui/patterns/charts';
import { LineChart } from '@mlain/ui/patterns/charts/lazy';
```

- **`TrendChart`** je úsporná křivka z návrhu Přehledu: tři vodorovné linky,
  jedna čára, tečky, mono popisky pod nimi. **Bez os a bez legendy.** Patří
  na kartu, kde graf není hlavní obsah, ale doplněk k číslům vedle něj.
  Kreslí se ručním SVG, takže **nenačítá `recharts`** a importuje se přímo,
  ne přes `lazy`. Umí jednu řadu; víc jich schválně neumí, protože pro ně
  návrh nemá barvy.
- **`LineChart`** a **`BarChart`** jsou pro obrazovku, kde je graf tím
  hlavním a je v něm víc řad. Mají osy, mřížku i legendu s rozlišením vzorem
  čáry. Načítají se **líně přes `patterns/charts/lazy`**, `recharts` je
  největší závislost balíčku.

Oběma je společný `ChartFrame`: SVG je pro čtečku skryté a hodnoty nese
rozbalovací **tabulka**. Barva nikdy není jediným nositelem informace.
Tabulku neodstraňuj ani u úsporné varianty.

**Čtyři řady, čtyři vzory čáry** (`solid`, `dashed`, `dotted`, `dashDot`)
a čtyři barvy. Pátá řada patří do tabulky, ne do grafu: pátý vzor už se
spolehlivě nerozliší a barva sama nositelem informace být nesmí.

**`formatValue` platí i na osu Y**, ne jen v tabulce a bublině. U měr by osa
jinak kreslila 0 až 1 a „1" by vypadalo jako jeden kus místo sta procent.

**Graf uvnitř karty s nadpisem dostane `hideTitle`.** Jinak je nadpis na
obrazovce dvakrát: jednou z karty, jednou z grafu. Mizí ten grafový, protože
nadpis karty je systémový prvek a vypadá všude stejně. Nadpis se přitom
**nemaže, jen se schová do `sr-only`**, aby graf i tabulka měly dál
přístupné jméno.

### 2.12 Hláška s akcí

`Alert` z `@mlain/ui/patterns/states` bere `action`. Tlačítko se vykreslí
**pod textem, zarovnané na svou vlastní šířku**, ne přes celou hlášku:
uvnitř svislého flexu by se `Button` roztáhl a „Vrátit zpět" by vypadalo
jako pruh přes půl obrazovky. Akcí smí být víc, zalomí se.

Hláška má vlevo silnou linku 3 px v barvě tónu a zbytek rámečku hairline.

### 2.13 Průvodce

`@mlain/ui/patterns/wizard`. Hlavičku kreslí **`PageHeader`**, tedy tatáž
komponenta jako u ostatních obrazovek.

```tsx
<Wizard
  title={t('import.title')}
  description={t('import.description')}
  steps={steps}
  current={step}
  onNavigate={goTo}
  labels={{ stepOf: (a, b) => t('wizard.stepOf', { current: a, total: b }), … }}
>
  {obsahKroku}
</Wizard>
```

**`title` vyplň vždycky.** Bez něj je nadpisem jméno kroku a na obrazovce pak
nikde nestojí, co se na ní vlastně dělá; kdo se na ni vrátí po přepnutí
panelu, nemá jak poznat, kde je. S `title` je krok mono řádkem nad nadpisem
(„Krok 2 ze 3 · Náhled"), tedy stejný tvar jako `eyebrow`.

Patičku s tlačítky odděluje linka. Vlastní `<h1>` do obsahu kroku nedávej,
měl bys na stránce dva nadpisy první úrovně.

#### Krok, který musí něco uložit, než se pokročí

**Nekresli si vlastní tlačítko „Pokračovat".** Průvodce jedno dodává sám
a byla by pod sebou dvě stejně vypadající tlačítka, z nichž každé dělá něco
jiného. Takhle vznikla past v kroku „Kontrola souboru": to spodní přeskočilo
uložení kódování, takže kdo klikl na ně, přišel o svou volbu a import běžel
se špatně přečteným souborem.

Místo toho se předá obsluha, která smí přechod zamítnout:

```tsx
<Wizard
  onBeforeNext={async () => {
    const ok = await ulozNastaveni();
    return ok; // false = zůstaneme v kroku
  }}
>
```

Tlačítko po dobu běhu obsluhy ukazuje `pending`, takže se nedá zmáčknout
dvakrát. `hideNext` existuje jen pro krok, který pokračuje **jinou akcí**,
například odesláním formuláře. Nikdy ne proto, aby sis vedle něj nakreslil
vlastní.

Nadpis dostává po přechodu kroku fokus, aby uživatel čtečky věděl, kde je.
Obrys se u něj **nekreslí** (`outline-none`) a je to správně: nadpis není
klikací cíl, tabulátorem se na něj nedá dostat a rámeček kolem něj vypadá
jako zaostřené textové pole.

### 2.14 Stavy obrazovky

Prázdno, chyba, načítání, zákaz, limit: `@mlain/ui/patterns/states`.
Používej je, nepiš si vlastní prázdné stavy. Základ jim už sedí na tokenech.

---

## 3. Jak se skládá stránka

Skořápku montuje `apps/web/src/features/shell/workspace-shell.tsx`. Tvoje
obrazovka je **to, co je uvnitř `<main>`**. Hlavičku, boční menu ani vnitřní
okraj 40 px nepiš, dostaneš je.

```tsx
export default function ContactsPage() {
  return (
    <>
      <PageHeader title={…} meta={…} actions={…}>
        {/* filtry */}
      </PageHeader>

      {/* volitelná hláška nahoře */}
      <Card tone="muted" padding="sm" className="mb-[var(--spacing-gutter)]">…</Card>

      {/* mřížka karet */}
      <div className="grid grid-cols-[repeat(auto-fit,minmax(230px,1fr))] gap-[var(--spacing-gutter)]">
        <Card padding="md">…</Card>
      </div>
    </>
  );
}
```

Rytmus, který drží všechny obrazovky: **hlavička, filtry, karta s obsahem.**
Chybějící návrhy (Formuláře, Šablony, Knihovna médií, Statistiky, Nastavení)
se dělají přesně v tomhle rytmu.

### Šířku obsahu neřeš

Rozhoduje ji skořápka podle cesty a **tvoje obrazovka s tím nemá co dělat**.
Široká (1560 px) je výchozí, protože ji má šest ze sedmi návrhů; úzká
(1320 px) je jen Přehled. Nenastavuj si `max-width` na svém obsahu, sebral
bys tabulce místo, kvůli kterému to takhle je.

### Mřížky z návrhu

- Dlaždice s čísly: `grid-cols-[repeat(auto-fit,minmax(230px,1fr))]`, mezera `gutter`.
- Graf a postranní panel: `grid-cols-12`, graf `col-span-8`, panel `col-span-4`.
- Formulář ve dvou sloupcích: `grid-cols-[repeat(auto-fit,minmax(360px,1fr))]`,
  uvnitř sekce dvojice polí `grid-cols-[repeat(auto-fit,minmax(200px,1fr))]`.

---

## 4. Co záměrně NENÍ komponenta

Nezakládej je. Buď to komponenta být nemá, nebo je to práce někoho jiného.

| Věc | Proč ne |
|---|---|
| **Dlaždice s číslem (StatCard)** | Každá obrazovka ji má jinak: jedna nese deltu, druhá slovo za číslem, třetí místo čísla větu „zatím nevíme". Skládá se z `Card` + `meta-caps` + `text-display`. Komponenta s osmi nepovinnými propy by byla horší než pět řádků na místě. |
| ~~Přepínač období~~ | **UŽ KOMPONENTA JE**, `SegmentedControl`. Původně tu stálo „až ho budou potřebovat tři obrazovky"; potřebují ho tři (Přehled, Vývoj v čase, Web), tak vznikl. Bere řetězce i čísla. |
| ~~Ikonové tlačítko~~ | **UŽ KOMPONENTA JE**, viz 2.9 `IconButton`. Původně tu stálo, že se píše na místě; návrhy ho ale mají na pěti místech ve třech shodných podobách, takže se z něj komponenta stala. Nepiš si vlastní. |
| **Drobečková navigace** | Tři odkazy a dvě šipky. Předává se do `PageHeader` jako `breadcrumbs`. |
| **Ikona v barevném čtverci** | Dva `<span>`y. Barva se pokaždé liší podle významu dlaždice. |
| **Časová osa** | Už existuje: `@mlain/ui/patterns/timeline`. |
| **Graf** | Už existuje: `@mlain/ui/patterns/charts`, a jsou dva, viz níž. |
| **Nová položka v menu** | `registry.ts` je celý dopředu a **nerozšiřuje se**. Nová položka je rozhodnutí zadavatele. |

---

## 5. Čeho se vyvarovat

Věci, na kterých jsem se zdržel a které bys zopakoval.

1. **`DesignSync` nemáš.** Viz kapitola 0. Neztrácej tím čas.

2. **Podtržení odkazu jde skrz potomky.** Globální styl podtrhává každé `<a>`.
   Když dáš `no-underline` na `<span>` uvnitř odkazu, **nepomůže to**:
   podtržení kreslí předek. Musí být na samotném `<a>`, nebo na obalu
   (`[&_a]:no-underline`). Takhle je vyřešené boční menu.

3. **Nový token `--text-*` musí přibýt i do `packages/ui/src/lib/cn.ts`.**
   Tohle je nejzákeřnější věc, na kterou jsem narazil. `tailwind-merge`
   (uvnitř `cn`) nezná naši konfiguraci a třídu `text-ui` si podle tvaru
   přebere jako **barvu** textu. Pak ji považuje za konflikt s `text-text`
   a **tiše ji zahodí**:

   ```
   cn('text-ui', 'text-text')  →  'text-text'
   ```

   Nikde se to neohlásí, prvek jen dostane zděděnou velikost. Naměřil jsem to
   na hlášce, která místo 15 px vyšla 17 px, přestože `text-ui` v kódu bylo.
   Seznam v `cn.ts` je proto povinný a hlídá ho `cn.test.ts`. Když si přidáš
   velikost, přidej ji do obou míst.

   Totéž platí pro `icon-*`.

4. **Čísla ve třídách Tailwindu nejsou tokeny.** `min-h-11` je náhodou 44 px,
   ale změna `--size-target-min` ho mine. Piš
   `min-h-[var(--size-target-min)]`. Test tlačítka na to přímo dohlíží.

5. **Číselné názvy mezer se srazí s Tailwindem.** `--spacing-20` by přepsalo
   `p-20` z 80 px na 20 px v celé aplikaci. Proto mají tokeny názvy podle role.

6. **Nový barevný token patří do všech tří bloků.** `@tokens light`,
   `@tokens dark` i `@tokens dark-media`. Test porovnává množiny klíčů
   i hodnoty a spadne.

7. **Značky `sc-if`, `sc-for` a `{{ … }}` z návrhu se nepřenášejí.** Je to
   jazyk náhledu. Data taky ne, jsou vymyšlená.

8. **Návrh má na dvou místech stín, ale karty ne.** Tlačítko má plnou hranu
   (`--edge-*`) a vysouvací panel menu má měkký stín (`--shadow-flyout`).
   To je celé. Karta stín nemá.

9. **Klikací plocha: 44 px je pravidlo, 32 px je jediná výjimka.** Podpoložky
   menu jsou v návrhu 34 px vysoké, v aplikaci mají 44 a zůstane to tak;
   přístupnost má přednost. Jediná schválená výjimka je **kotva události na
   časové ose** (32 px), protože je to druhotný odkaz vedle věty, návrh ho má
   výslovně takhle a 32 px pořád splňuje WCAG 2.5.8 na úrovni AA (minimum je
   24 px). Další výjimky si nezaváděj, tuhle se mnou projednej.

10. **Aktivní sekce menu se pozná jinak než předponou cesty.** Přehled leží na
   `/w/{slug}`, což je předpona úplně všeho. Sidebar to už řeší
   (`isSectionActive`), ale kdybys podobnou logiku psal jinde, počítej s tím.

11. **Pevná šířka, do které se sází text, se rozbije v angličtině.** Sloupec
    času na časové ose měl z návrhu pevných 62 px, jenže návrh vznikl
    v češtině a počítal s „10:47". Anglické „10:47 AM" je delší a v úzkém
    okně se zalomilo na dva řádky. Je to teď `minmax(62px, auto)` plus
    `whitespace-nowrap`, tedy 62 px jako **nejmenší** šířka, ne jediná.

    Projdi si podle toho každou pevnou šířku, do které sázíš text.
    U `--size-timeline-time`, `--size-field-number` a `--size-field-narrow`
    ber hodnotu jako minimum. Rozměry prvků bez textu
    (`--size-target-min`, `--size-icon-*`, `--size-avatar`) jsou pevné
    správně, tam se nic nesází.

12. **`cva` skládá varianty PŘED velikostmi.** Když varianta a velikost sahají
    na tutéž vlastnost, vyhraje velikost, i když to nikdo nechtěl. Tak vznikla
    vada, kdy `<Button variant="link">` uprostřed věty dostal výšku 44 px
    a vodorovný okraj 20 px a dělal v textu díru. Řeší se `compoundVariants`,
    které se vyhodnocují až po velikostech. Kdybys sahal na varianty tlačítka,
    počítej s tím.

13. **`exactOptionalPropertyTypes` je zapnuté.** Volitelnou propu s `undefined`
    nepředávej, prostě ji vynech.

14. **Barvu s přechodem neměř hned po zaostření.** `transition-colors`
    z Tailwindu zahrnuje i `outline-color`, takže obrys focusu se do své
    barvy 120 ms **přebarvuje** z předchozí hodnoty. Kdo změří v nule,
    naměří tu předchozí, a to je výchozí `currentColor`, tedy barva textu.
    Takhle tři lidé nezávisle nahlásili vadu, která nebyla tam, kde ji
    hledali. Základ teď nastavuje výchozí `outline-color` z tokenu, takže
    přechod nemá odkud kam jít, ale **pravidlo platí obecně**: u vlastnosti
    s přechodem měř až po jeho doběhnutí, nebo si přechod na dobu měření
    vypni.

15. **Ověřuj v prohlížeči a měř.** Zadavatel chce, aby to sedělo na pixel.
    Rozestupy a velikosti si v prohlížeči změř přes `getComputedStyle`,
    neodhaduj je z obrázku. Vlastní prohlížeč (`chromium.launch()` z
    `@playwright/test`), ne sdílený.

---

## 6. Provoz

- Node: `export PATH=/opt/homebrew/opt/node@24/bin:$PATH`
- Dev server: http://localhost:3200 nad databází `mlain_clean`. **Nerestartuj ho.**
- Přihlášení: `petr.novak@gmail.com` / `DaEndrocks969598`, projekt „Petr Osobní mail".
  Účet má nastavenou angličtinu, česky je aplikace na `/cs/…`.
- Na konci: testy dotčených balíčků, `pnpm typecheck`, `pnpm lint`,
  `node tools/ci/i18n-check.mjs`.
- **Git je jen pro hlavního agenta.** Necommituj.
- Lint hlásí 11 chyb v `docker/collect-runtime-deps.mjs` a `docs/design/script.js`.
  Jsou **starší než tahle práce**, nejsou tvoje, neopravuj je.
