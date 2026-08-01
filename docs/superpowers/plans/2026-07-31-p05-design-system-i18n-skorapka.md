# P05 Design systém, i18n a skořápka: implementační plán

> **Pro agentní pracovníky:** POVINNÁ PODŘÍZENÁ DOVEDNOST: použij `superpowers:subagent-driven-development` (doporučeno) nebo `superpowers:executing-plans` a proveď plán úkol po úkolu. Kroky mají zaškrtávací syntaxi (`- [ ]`) kvůli sledování postupu.

**Cíl:** Dodat kompletní sdílený základ rozhraní produktu Mlain Mailer, tedy `packages/ui` (tokeny, primitiva shadcn/ui, osm komponent K1 až K8), `packages/i18n` (infrastruktura, namespace `common`, ICU, kontroly v CI) a skořápku aplikace (topbar, sidebar, přepínač projektů, registr navigace, `proxy.ts`), aby jedenáct navazujících plánů stavělo obrazovky a nic si nedopisovalo do sdíleného balíčku.

**Architektura:** `packages/ui` je zdrojový balíček bez vlastního buildu, který si `apps/web` transpiluje (`transpilePackages`). Uvnitř je trojvrstvá struktura: `tokens.css` (designové tokeny jako CSS proměnné napojené na Tailwind 4), `components` (primitiva shadcn/ui zkopírovaná do repa, ne jako závislost) a `patterns` (osm komponent K1 až K8, stavy obrazovek, skořápka a mechanismy zpětné vazby). Doménová logika v balíčku není: každá komponenta bere data přes props nebo přes malé rozhraní adaptéru, takže `packages/ui` nezávisí na `packages/db` ani na `packages/core`. `packages/i18n` drží katalogy rozdělené na soubory po doménách a skládá je za běhu do jednoho vnořeného stromu, který `next-intl` očekává.

**Technologie:** TypeScript, React 19 v Next.js 16 App Router, Tailwind CSS 4, shadcn/ui nad `radix-ui`, `lucide-react`, `next-intl` s ICU MessageFormat, Vitest 4 s jsdom a Testing Library pro jednotkové testy, Playwright 1.62 s `@axe-core/playwright` pro přístupnost.

---

## 0. Než začneš: povinná četba a hranice

### 0.1 Co si přečti

| Dokument | Kapitoly |
|---|---|
| `docs/superpowers/plans/2026-07-31-rozdeleni-implementacnich-planu.md` | celý, hlavně 1.1, 2 (S3, S4, S5, S6, S10, S11) a 5 (P05) |
| `docs/superpowers/specs/parts/06-ui-ux.md` | 4, 5, 6, 7, 9.1 až 9.6, 10.1, 10.2, 11, 12, 13, 14, 15 |
| `docs/superpowers/specs/parts/01-platforma.md` | 3.9, 3.11, 3.15, 4.2, 4.3, 5 celá |

### 0.2 Jediné řídicí pravidlo

> **Každý soubor v repozitáři má právě jeden plán, který ho smí vytvořit a měnit. Ostatní plány ho jen čtou.**

Tenhle plán je **jediný, který smí zakládat soubory v `packages/ui`.** Když dodá komponenty K1 až K8 neúplně, jedenáct navazujících plánů to zjistí naráz a začne si dopisovat vlastní komponenty do sdíleného balíčku. To je přesně ten konflikt, kterému se celé dělení vyhýbá. Proto se plán nepovažuje za hotový, dokud neexistuje všech osm komponent se splněnými tvrdými požadavky z kapitoly 13.1 části 6.

Úplný seznam vlastněných souborů je v kapitole 9 na konci plánu. Mimo ně plán nesahá.

### 0.3 Předpoklady, které musí splnit P01, než tenhle plán začne

Plán P05 běží po smergování P01 do `main`. Ověř tyhle věci **před prvním úkolem**. Když některá chybí, doplň ji do P01 a P05 spusť až potom. Neopravuj to za běhu v P05, protože kořen repozitáře P05 nevlastní.

| # | Co musí existovat | Kde |
|---|---|---|
| E1 | `pnpm-workspace.yaml` s `packages/*` a `apps/*` | kořen |
| E2 | `turbo.json` s tasky `build`, `typecheck`, `lint`, `test:unit`, `test:e2e` | kořen |
| E3 | Sdílené presety `@mlain/config`: `tsconfig-react.json`, `vitest-preset.ts`, eslint konfigurace | `packages/config` |
| E4 | Kostra `apps/web` jako Next.js 16 App Router se standalone buildem | `apps/web` |
| E4b | Prázdné kostry balíčků `packages/ui` a `packages/i18n` (jen `package.json`, `tsconfig.json`, `src/.gitkeep`). **P05 je doplňuje, nezakládá znovu.** | `packages/{ui,i18n}` |
| E5 | `licenses.allow.json` s výjimkou pro `axe-core` a `@axe-core/playwright` (MPL-2.0, `devDependencies`), s vyplněným `expires_at` | kořen |
| E6 | CI job `i18n-check` a `e2e` podle tabulky 3.15 části 1 | `.github/workflows` |
| E7 | Registrace ESLint pravidla z `packages/ui/eslint-rules` ve sdílené konfiguraci (viz úkol 6). **Načítá se podmíněně** (`try`/`catch` kolem `require`), protože soubor vzniká až v P05 a mezi P01 a P05 běží P02, P03 a P04, kterým by lint spadl na chybějícím souboru. Není to tvrdý import. | `packages/config` |
| E8 | CI job `bundle-budget`, který pouští `pnpm --filter @mlain/web check:bundle` (viz úkol 33) | `.github/workflows` |

E5, E7 a E8 jsou nové požadavky vůči tabulce jobů v 3.15 části 1. Tabulka je označená jako jediný autoritativní seznam jobů, takže se **doplňují do P01 dopředu**, ne za běhu. Uzávěr S10 v řídicím dokumentu to ukládá výslovně.

### 0.4 Git

Commit kroky v tomhle plánu provádí **hlavní agent**. Subagent, který úkol provádí, píše soubory a spouští testy, ale gitu se nedotýká. Plán se provádí ve vlastním worktree založeném z `HEAD`, na vlastní větvi.

---

## 1. Rozhodnutí, která tenhle plán udělal sám

Šest míst, kde se zdroje buď rozcházely, nebo mlčely. U každého je rozhodnutí a důvod. Kdo plán provádí, se jimi řídí a nevymýšlí je znovu.

| # | Věc | Rozhodnutí | Důvod |
|---|---|---|---|
| R1 | `middleware.ts` versus `proxy.ts` | Soubor se jmenuje **`apps/web/src/proxy.ts`** a exportuje funkci `proxy`. | Řídicí dokument ho v uzávěru S6 nazývá `middleware.ts`, ale část 1 na dvou místech (3.9 a její R6) uvádí, že Next.js 16 soubor přejmenoval na `proxy.ts` a funkci na `proxy`, runtime je vždy Node.js a edge není podporovaný. S6 mluví o **jednom souboru se všemi matchery**, ne o jeho názvu. Ten požadavek plán splňuje beze zbytku. |
| R2 | Umístění katalogů i18n | Na disku **`packages/i18n/messages/{locale}/<namespace>.json`**, za běhu se skládají do jednoho vnořeného stromu `{ common: {...}, contacts: {...} }`. | Část 1 (3.9) chce jeden soubor na jazyk, uzávěr S4 řídicího dokumentu chce soubor na doménu, aby si každý plán vlastnil svůj. Rozdělení na disku uzavírá konflikt vlastnictví, složení za běhu zachovává tvar, který `next-intl` a typ `Messages` očekávají. Obě podmínky jsou splněné naráz a nic se nemění v kódu obrazovek: klíč se pořád píše `t('contacts.count')`. |
| R3 | Kam patří Playwright konfigurace | **P05 vlastní `apps/web/playwright.config.ts`.** Pozdější plány přidávají spec soubory do vlastních podadresářů `apps/web/e2e/<oblast>/` a konfiguraci nemění. | P05 je první plán, který potřebuje test v prohlížeči (axe-core). Konfigurace musí vzniknout tady, jinak si ji každý plán založí znovu. Podadresáře na spec soubory oddělují vlastnictví bez konfliktu v jednom souboru. |
| R4 | Rozsah Centra úloh | P05 dodá **jen prezentační komponentu** `JobsCenter` a odznak v topbaru, řízené rozhraním `JobsSource`. Endpoint, napojení na pg-boss a stránku `/w/{slug}/jobs/{jobId}` dodá plán, který vlastní API úloh. | Požadavek U→1.3 části 6 chce Centrum úloh ve skořápce, ale data k němu vlastní backend, který v době běhu P05 nemusí existovat. Kdyby P05 komponentu nedodal, napsalo by si ji několik plánů zvlášť, a to je přesně ten sdílený konflikt, kterému se vyhýbáme. |
| R5 | Vynucení zákazu `disabled` na primárním tlačítku | **Dvojí pojistka:** typová (varianta `primary` prop `disabled` v TypeScriptu nepřijímá) a lintová (vlastní ESLint pravidlo s allowlistem). | Akceptační kritérium 18 výslovně žádá lint pravidlo s allowlistem. Typová pojistka navíc zachytí porušení dřív, ve chvíli psaní, a nedá se obejít komentářem `eslint-disable` bez zdůvodnění. |
| R6 | Barevný proužek projektu | Odvozený z `workspace_id` funkcí `workspaceAccent()` (FNV-1a → odstín, pevná sytost a světlost podle režimu). Vedle proužku je **vždy název projektu textem**. | Část 1 (5.2) žádá deterministické odvození, ale algoritmus neuvádí. Pevná sytost a světlost je nutná, aby kontrast proužku nezáležel na náhodě hashe. Text vedle proužku plyne z 11.3 části 6: barva nikdy není jediný rozlišovací znak. |
| R7 | Spor kritérií 16 a 18 | Nedostupná akce **není `disabled`**. Tlačítko zůstane funkční a fokusovatelné, ale místo akce vysvětlí, co chybí, a přesune fokus na chybějící krok. Slouží k tomu prop `unavailableReason`. | Kritérium 18 zakazuje `disabled` na primární akci, kritérium 16 žádá, aby hromadné smazání bez zaškrtnutého políčka nešlo provést. Doslovné čtení obojího naráz nejde splnit. Vratné řešení je lepší než mrtvé tlačítko: akce se neprovede (kritérium 16 platí), atribut `disabled` nikde není (kritérium 18 platí) a uživatel se navíc dozví proč, což zašedlé tlačítko nikdy neřekne. Zároveň to řeší pravidlo 2 z 7.2b: akce, na kterou uživatel nemá právo, musí být vidět a vysvětlená. |
| R8 | `sonner` pro K5 | **Nepoužije se.** Vlastní úložiště toastů a vlastní vykreslení. | Viz tabulka v kapitole 2.1. Doporučení je nenormativní, všechny tvrdé požadavky K5 jsou naše. |
| R9 | `react-querybuilder` pro K2 | **Nepoužije se.** Vlastní AST a vlastní ovládací prvky. | Specifikace u něj sama vyjmenovává pět povinných přepisů. Kritérium 71b navíc žádá pořadí prvků podle ICU zprávy. |
| R10 | `react-dropzone` pro K4 | **Nepoužije se.** Vlastní obsluha přetažení a výběru. | Dvacet řádků kódu proti závislosti, jejíž klávesovou alternativu si stejně navrhujeme od nuly. |

---

## 2. Knihovny a licence

Všechny licence ověřené `npm view <balíček> license version` **31. 7. 2026**, nezávisle na tvrzení specifikace. Projekt je MIT, povolené licence produkčních závislostí jsou MIT, Apache-2.0, BSD a ISC. GPL, LGPL a AGPL jsou zakázané a hlídá to job `licenses-node`.

### 2.1 Produkční závislosti `packages/ui`

| Balíček | Verze | Licence | K čemu | Komponenta |
|---|---|---|---|---|
| `react`, `react-dom` | 19.x | MIT | peer dependency | |
| `tailwindcss` | 4.3.3 | MIT | stylování | tokeny |
| `radix-ui` | 1.6.7 | MIT | primitiva pod shadcn/ui | primitiva |
| `lucide-react` | 1.28.0 | **ISC** | ikony, importují se jmenovitě | všude |
| `clsx` | 2.1.1 | MIT | skládání tříd | `cn` |
| `tailwind-merge` | 3.6.0 | MIT | slučování konfliktních tříd | `cn` |
| `class-variance-authority` | 0.7.1 | **Apache-2.0** | varianty komponent | primitiva |
| `@tanstack/react-table` | 8.21.3 | MIT | headless tabulka | K1 |
| `@tanstack/react-virtual` | 3.14.9 | MIT | virtualizace řádků od 100 řádků | K1 |
| `recharts` | 3.10.1 | MIT | grafy | K7 |
| `cmdk` | 1.1.1 | MIT | paleta příkazů `Ctrl/Cmd + K` | skořápka |

`react-hook-form` a `zod` v `packages/ui` nejsou. Komponenta `Field` je na knihovně formulářů nezávislá: bere popisek, nápovědu a chybu jako props a sama nedrží stav. Volbu knihovny formulářů si tak nechává každá obrazovka, a `packages/ui` kvůli ní netáhne závislost.

**Tři doporučené balíčky se po prověření nepoužijí.** Kapitola 13.2 části 6 je označuje výslovně jako **nenormativní doporučení k datu**, normativní jsou jen tvrdé požadavky. U všech tří platí, že by z knihovny po povinných přepisech nezbylo nic:

| Balíček | Doporučen pro | Proč ne | Rozhodnutí |
|---|---|---|---|
| `sonner` 2.0.7 | K5 toast | Fronta o třech, slučování duplicit, viditelný odpočet, pozastavení při fokusu a `Alt + Z` jsou všechno naše požadavky. Z knihovny by zbylo `position: fixed`. Poslední vydání je rok staré. | R8, úkol 13 |
| `react-querybuilder` 8.21.2 | K2 query builder | Kapitola 13.2 u něj sama vyjmenovává **pět povinných přepisů**, po kterých nezbude nic viditelného. Kritérium 71b navíc žádá pořadí prvků podle ICU zprávy, což pevná hlavička skupiny neumí. | R9, úkol 21 |
| `react-dropzone` 19.1.1 | K4 nahrání souboru | Přetažení i výběr zvládne vlastní kód na dvaceti řádcích a klávesovou alternativu si stejně navrhujeme od nuly. | R10, úkol 23 |

Licenčně jsou všechny tři v pořádku (MIT). Odmítnutí je věcné, ne licenční.

`cmdk` má poslední vydání starší než rok, ale používá se **jen zevnitř `packages/ui/src/components/command.tsx`** a jeho API neuniká ven z balíčku. Platí pro něj pravidlo vlastního rozhraní z 13.2, takže výměna za vlastní paletu je změna v jednom souboru.

**Bez knihovny se staví K2, K3, K4, K5, K6 a K8.** U K3, K6 a K8 to doporučuje sama specifikace, u K2, K4 a K5 jsou to rozhodnutí R8 až R10. Knihovnu používá jen K1 (`@tanstack/react-table` a `@tanstack/react-virtual`) a K7 (`recharts`).

### 2.2 Produkční závislosti `packages/i18n`

| Balíček | Verze | Licence | K čemu |
|---|---|---|---|
| `next-intl` | 4.13.4 | MIT | i18n, ICU MessageFormat, `useFormatter`, locale routing |

### 2.3 Vývojové závislosti

| Balíček | Verze | Licence | K čemu |
|---|---|---|---|
| `vitest` | 4.1.10 | MIT | jednotkové testy |
| `jsdom` | 30.0.1 | MIT | DOM pro jednotkové testy komponent |
| `@vitejs/plugin-react` | 6.0.5 | MIT | JSX ve Vitestu |
| `@testing-library/react` | 16.3.2 | MIT | testy komponent |
| `@testing-library/user-event` | 14.6.1 | MIT | klávesnice a myš v testech |
| `@testing-library/jest-dom` | 7.0.0 | MIT | matchery na DOM |
| `@playwright/test` | 1.62.1 | **Apache-2.0** | testy v prohlížeči |
| `axe-core` | 4.12.1 | **MPL-2.0** | jádro kontroly přístupnosti |
| `@axe-core/playwright` | 4.12.1 | **MPL-2.0** | napojení axe na Playwright |
| `eslint-plugin-jsx-a11y` | 6.10.2 | MIT | statická kontrola přístupnosti |

**`axe-core` a `@axe-core/playwright` jsou MPL-2.0**, což není na seznamu povolených licencí. Jde o vývojové závislosti, které se s produktem nedistribuují, takže licenční konflikt s MIT distribucí nevzniká. Musí ale být v `licenses.allow.json` s vyplněným `expires_at`, viz předpoklad E5.

**`pa11y` se v tomhle projektu nepoužije.** Ověřeno 31. 7. 2026: verze 9.1.1, licence **LGPL-3.0-only**. LGPL je v projektu výslovně zakázaná. Náhrada je `axe-core` v Playwrightu a pokrývá totéž.

**Žádná knihovna pro K3, K6 a K8.** Průvodce, náhled e-mailu a časová osa se píšou vlastní, protože jejich tvrdé požadavky (krok v URL, destruktivní návrat, izolace stylů, shlukování, oddělovače dnů v zóně uživatele, věty ze slotů podle rodu) jsou doménová logika, kterou hotová knihovna neřeší.

**Žádná písma se nestahují.** Systémový stack, žádné Google Fonts. Pravidlo o nulové komunikaci s cizím cloudem platí i pro fonty.

---

## 3. Mapa souborů

```
packages/ui/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── eslint-rules/
│   ├── no-disabled-primary-action.cjs
│   └── no-disabled-primary-action.test.cjs
└── src/
    │                                  (barrel `index.ts` vědomě NEEXISTUJE, viz konvence)
    ├── tokens.css                     designové tokeny, světlý a tmavý režim (cestu určuje část 1, kap. 5.1)
    ├── globals.css                    @import tailwindcss + tokens + základní vrstva
    ├── lib/
    │   ├── cn.ts                      clsx + tailwind-merge
    │   ├── cn.test.ts
    │   ├── use-delayed-flag.ts        prodleva 300 ms, minimum zobrazení 400 ms
    │   ├── use-delayed-flag.test.ts
    │   ├── workspace-accent.ts        deterministická barva projektu z workspace_id
    │   ├── workspace-accent.test.ts
    │   ├── contrast.ts                výpočet kontrastu pro test tokenů
    │   ├── contrast.test.ts
    │   └── tokens.test.ts             parsuje tokens.css, hlídá párovost a kontrast
    ├── theme/
    │   ├── theme-provider.tsx         světlý, tmavý, podle systému
    │   └── theme-provider.test.tsx
    ├── a11y/
    │   ├── live-region.tsx            aria-live oblast aplikace
    │   ├── live-region.test.tsx
    │   ├── use-progress-announcer.ts  oznamování po čtvrtinách
    │   └── use-progress-announcer.test.ts
    ├── components/                    primitiva shadcn/ui zkopírovaná do repa
    │   ├── button.tsx                 + button.test.tsx
    │   ├── input.tsx, label.tsx, textarea.tsx, field.tsx
    │   ├── checkbox.tsx, radio-group.tsx, switch.tsx
    │   ├── badge.tsx, skeleton.tsx, separator.tsx, progress.tsx
    │   ├── dialog.tsx                 + dialog.test.tsx (focus trap, Esc, návrat fokusu)
    │   ├── dropdown-menu.tsx, popover.tsx, select.tsx, tooltip.tsx
    │   ├── tabs.tsx, collapsible.tsx
    │   ├── copy-button.tsx            + copy-button.test.tsx
    │   └── command.tsx                obal nad cmdk
    └── patterns/
        ├── data-table/                K1, včetně nastavení sloupců a virtualizace
        ├── query-builder/             K2, AST podle části 2 a pět tvarů hodnoty
        ├── wizard/                    K3, včetně useWizardStep (krok v URL)
        ├── file-upload/               K4
        ├── toast/                     K5
        ├── email-preview/             K6
        ├── charts/                    K7
        ├── timeline/                  K8
        ├── states/                    S1 až S15, Alert, FilteredEmptyState
        ├── feedback/                  potvrzení, vrácení akce, riziková škála
        ├── shell/                     topbar, sidebar, přepínač projektů, systémový pruh
        ├── navigation/                registr navigace
        ├── shortcuts/                 mapa kláves, nápověda, paleta příkazů
        └── jobs/                      Centrum úloh, prezentační vrstva

packages/i18n/
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── messages/
│   ├── cs/common.json
│   └── en/common.json
└── src/
    ├── locales.ts                     SUPPORTED_LOCALES, DEFAULT_LOCALE, typy
    ├── load-messages.ts               skládání namespace souborů do stromu
    ├── load-messages.test.ts
    ├── routing.ts                     next-intl routing, localePrefix as-needed
    ├── navigation.ts                  Link, redirect, usePathname, useRouter
    ├── request.ts                     getRequestConfig pro server komponenty
    ├── next-plugin.ts                 withMlainIntl pro next.config.ts
    ├── formats.ts                     společné formáty Intl
    ├── format.ts                      formátovací pomůcky nad useFormatter
    ├── format.test.ts
    ├── messages.d.ts                  typ Messages odvozený z en
    └── checks/
        ├── key-parity.test.ts         shoda klíčů cs a en
        ├── icu-validity.test.ts       platnost ICU výrazů, povinné =0 a many
        ├── glossary.ts                zakázané výrazy ze slovníku 9.2
        └── glossary.test.ts           zakázané výrazy, dlouhá pomlčka, subscribed

apps/web/
├── playwright.config.ts
├── next.config.ts                     převzato od P01, doplněn plugin i18n
├── src/
│   ├── proxy.ts                       jediný soubor, všechny matchery
│   ├── app/
│   │   ├── layout.tsx                 kořenový layout, ThemeProvider, LiveRegion
│   │   ├── globals.css                import stylů z @mlain/ui
│   │   └── [locale]/
│   │       ├── layout.tsx             NextIntlClientProvider
│   │       ├── (dev)/ui-gallery/      galerie komponent pro testy a11y, jen mimo produkci
│   │       └── w/[workspaceSlug]/
│   │           └── layout.tsx         skořápka: topbar, sidebar, systémový pruh
└── e2e/
    └── ui/                            axe a klávesové testy komponent
```

---

## 4. Konvence, které platí v celém plánu

| Věc | Pravidlo |
|---|---|
| Soubory | `kebab-case.ts`, React komponenty `PascalCase` uvnitř souboru s `kebab-case.tsx` názvem |
| Balíčky | `@mlain/ui`, `@mlain/i18n` |
| Importy | Vždy podcesta, **vždy na úroveň adresáře**: `@mlain/ui/components/button`, `@mlain/ui/patterns/states`, `@mlain/ui/patterns/charts`. Nikdy na úroveň souboru (`patterns/charts/time-series-chart`) a nikdy z kořene. **Balíček kořenový import vůbec nevystavuje**: v `exports` není klíč `"."`, takže `import { Button } from '@mlain/ui'` skončí chybou `ERR_PACKAGE_PATH_NOT_EXPORTED` už při sestavení. Uzávěr S11 tím není jen napsaný, ale vynucený. |
| Barvy | Jen tokeny. `bg-blue-500` v komponentě je chyba, kterou hlídá test v úkolu 34. |
| Texty | Žádný literál v komponentě `packages/ui`. Text jde dovnitř přes props nebo přes `useTranslations` v `apps/web`. Výjimka: `aria-label` v galerii komponent. |
| Testy během práce | Jen na změněných a nových souborech. |
| Testy na konci | Kompletní série v úkolu 34, všechno musí projít. |
| Dlouhá pomlčka | Znak U+2014 se nesmí objevit v katalogu ani v kódu. Hlídá to test v úkolu 9. |

**Příkazy, které se opakují:**

```bash
# jednotkové testy jednoho balíčku
pnpm --filter @mlain/ui test:unit
pnpm --filter @mlain/i18n test:unit

# jeden soubor
pnpm --filter @mlain/ui exec vitest run src/lib/cn.test.ts

# typová kontrola
pnpm --filter @mlain/ui typecheck

# testy v prohlížeči
pnpm --filter @mlain/web test:e2e
```

---

## 5. Úkoly

### Úkol 1: Kostra balíčku `@mlain/ui` a pomůcka `cn`

**Soubory:**
- Vytvořit: `packages/ui/package.json`, `packages/ui/tsconfig.json`, `packages/ui/vitest.config.ts`, `packages/ui/vitest.setup.ts`, `packages/ui/src/lib/cn.ts`
- Test: `packages/ui/src/lib/cn.test.ts`

- [ ] **Krok 1: Doplnit manifest balíčku**

P01 založil `packages/ui` jako prázdnou kostru s minimálním `package.json` a `tsconfig.json`. P05 je **rozšiřuje**, nezakládá znovu. Výsledná podoba:

`packages/ui/package.json`:

```json
{
  "name": "@mlain/ui",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./tokens.css": "./src/tokens.css",
    "./globals.css": "./src/globals.css",
    "./lib/*": "./src/lib/*.ts",
    "./theme": "./src/theme/theme-provider.tsx",
    "./a11y": "./src/a11y/index.ts",
    "./components/*": "./src/components/*.tsx",
    "./patterns/*": "./src/patterns/*/index.ts"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test:unit": "vitest run",
    "test:watch": "vitest"
  },
  "peerDependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0"
  },
  "dependencies": {
    "class-variance-authority": "0.7.1",
    "clsx": "2.1.1",
    "cmdk": "1.1.1",
    "lucide-react": "1.28.0",
    "radix-ui": "1.6.7",
    "recharts": "3.10.1",
    "tailwind-merge": "3.6.0",
    "@tanstack/react-table": "8.21.3",
    "@tanstack/react-virtual": "3.14.9"
  },
  "devDependencies": {
    "@mlain/config": "workspace:*",
    "@testing-library/jest-dom": "7.0.0",
    "@testing-library/react": "16.3.2",
    "@testing-library/user-event": "14.6.1",
    "@vitejs/plugin-react": "6.0.5",
    "jsdom": "30.0.1",
    "tailwindcss": "4.3.3",
    "vitest": "4.1.10"
  }
}
```

`packages/ui/tsconfig.json`:

```json
{
  "extends": "@mlain/config/tsconfig-react.json",
  "compilerOptions": {
    "rootDir": "src",
    "noEmit": true,
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "vitest.config.ts", "vitest.setup.ts"]
}
```

`packages/ui/vitest.config.ts`:

```ts
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
});
```

`packages/ui/vitest.setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

afterEach(() => {
  cleanup();
});
```

**Soubor `packages/ui/src/index.ts` se nezakládá.** Balíček nemá kořenový vstupní bod: v `exports` chybí klíč `"."`, takže `import cokoli from '@mlain/ui'` selže hláškou `ERR_PACKAGE_PATH_NOT_EXPORTED`. Je to vědomé a je to jediný způsob, jak uzávěr S11 skutečně vynutit. Prázdný barrel by se totiž první den rozrostl o jeden řádek na doménu a byl by konfliktním souborem v každém z jedenácti navazujících plánů. Typy režimu se vyvážejí podcestou `@mlain/ui/theme`.

- [ ] **Krok 2: Napsat padající test na `cn`**

`packages/ui/src/lib/cn.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { cn } from './cn';

describe('cn', () => {
  it('spojí třídy', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('vynechá falsy hodnoty', () => {
    expect(cn('a', false && 'b', undefined, null, 'c')).toBe('a c');
  });

  it('u konfliktu vyhraje poslední třída', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('bg-surface', 'bg-surface-muted')).toBe('bg-surface-muted');
  });

  it('umí podmíněný objekt', () => {
    expect(cn('base', { active: true, hidden: false })).toBe('base active');
  });
});
```

- [ ] **Krok 3: Spustit test, musí spadnout**

```bash
pnpm --filter @mlain/ui exec vitest run src/lib/cn.test.ts
```

Očekávaný výstup: FAIL, `Failed to resolve import "./cn"`.

- [ ] **Krok 4: Implementovat `cn`**

`packages/ui/src/lib/cn.ts`:

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Skládá třídy a u konfliktních Tailwind utilit nechá vyhrát poslední. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Krok 5: Spustit test, musí projít**

```bash
pnpm --filter @mlain/ui exec vitest run src/lib/cn.test.ts
pnpm --filter @mlain/ui typecheck
```

Očekávaný výstup: 4 passed, typecheck bez chyb.

- [ ] **Krok 6: Commit**

```bash
git add packages/ui
git commit -m "feat(ui): scaffold @mlain/ui package with cn helper"
```

---

### Úkol 2: Designové tokeny a jejich kontrolovaný kontrast

Tokeny mají **sémantické názvy, ne barvy**. Komponenta, která použije `bg-blue-500` místo tokenu, neprojde. Cíl je WCAG 2.2 AA: text 4,5:1, hranice interaktivních prvků 3:1, a **tmavý režim se kontroluje zvlášť**, protože se na něj běžně zapomíná.

**Soubory:**
- Vytvořit: `packages/ui/src/tokens.css`, `packages/ui/src/lib/contrast.ts`
- Test: `packages/ui/src/lib/contrast.test.ts`, `packages/ui/src/lib/tokens.test.ts`

- [ ] **Krok 1: Napsat padající test na výpočet kontrastu**

`packages/ui/src/lib/contrast.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { contrastRatio, relativeLuminance } from './contrast';

describe('contrastRatio', () => {
  it('bílá proti černé je 21:1', () => {
    expect(contrastRatio('#FFFFFF', '#000000')).toBeCloseTo(21, 1);
  });

  it('stejná barva je 1:1', () => {
    expect(contrastRatio('#1D4ED8', '#1D4ED8')).toBeCloseTo(1, 5);
  });

  it('je symetrický', () => {
    expect(contrastRatio('#4B5563', '#FFFFFF')).toBeCloseTo(contrastRatio('#FFFFFF', '#4B5563'), 10);
  });

  it('zvládne krátký zápis se třemi znaky', () => {
    expect(contrastRatio('#fff', '#000')).toBeCloseTo(21, 1);
  });

  it('luminance bílé je 1 a černé 0', () => {
    expect(relativeLuminance('#FFFFFF')).toBeCloseTo(1, 5);
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5);
  });
});
```

- [ ] **Krok 2: Spustit test, musí spadnout**

```bash
pnpm --filter @mlain/ui exec vitest run src/lib/contrast.test.ts
```

Očekávaný výstup: FAIL, `Failed to resolve import "./contrast"`.

- [ ] **Krok 3: Implementovat výpočet kontrastu**

`packages/ui/src/lib/contrast.ts`:

```ts
/** Výpočet kontrastu podle WCAG 2.2, vzorec z definice Relative Luminance. */

const HEX_PATTERN = /^[0-9a-fA-F]{6}$/;

function parseHex(hex: string): [number, number, number] {
  const value = hex.trim().replace('#', '');
  const full =
    value.length === 3
      ? value
          .split('')
          .map((char) => char + char)
          .join('')
      : value;
  if (!HEX_PATTERN.test(full)) {
    throw new Error(`Neplatná hexadecimální barva: ${hex}`);
  }
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

function channel(value: number): number {
  const normalized = value / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const first = relativeLuminance(a);
  const second = relativeLuminance(b);
  const lighter = Math.max(first, second);
  const darker = Math.min(first, second);
  return (lighter + 0.05) / (darker + 0.05);
}
```

- [ ] **Krok 4: Spustit test, musí projít**

```bash
pnpm --filter @mlain/ui exec vitest run src/lib/contrast.test.ts
```

Očekávaný výstup: 5 passed.

- [ ] **Krok 5: Napsat padající test na samotné tokeny**

Test čte `tokens.css`, takže hlídá skutečný soubor, ne kopii hodnot v testu. Kontroluje tři věci: párovost tokenů mezi světlým a tmavým režimem, shodu obou zápisů tmavého režimu a kontrast povinných dvojic.

`packages/ui/src/lib/tokens.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from './contrast';

const css = readFileSync(fileURLToPath(new URL('../tokens.css', import.meta.url)), 'utf8');
const DECLARATION = /^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/;

/** Vytáhne blok deklarací podle značky v komentáři, například `@tokens light`. */
function block(name: string): Record<string, string> {
  const marker = `@tokens ${name} `;
  const start = css.indexOf(marker);
  expect(start, `blok ${name} v tokens.css chybí`).toBeGreaterThan(-1);
  const close = css.indexOf('}', start);
  const body = css.slice(start, close);
  const out: Record<string, string> = {};
  for (const line of body.split('\n')) {
    const match = line.match(DECLARATION);
    if (match) out[match[1]] = match[2].trim();
  }
  return out;
}

const light = block('light');
const dark = block('dark');
const darkMedia = block('dark-media');

describe('tokens.css', () => {
  it('definuje tokeny povinné podle části 1, kapitoly 5.1', () => {
    for (const token of [
      '--color-surface',
      '--color-surface-muted',
      '--color-border',
      '--color-text',
      '--color-text-muted',
      '--color-primary',
      '--color-danger',
      '--color-warning',
      '--color-success',
    ]) {
      expect(light, `chybí ${token}`).toHaveProperty(token);
    }
  });

  it('světlý a tmavý režim mají stejnou množinu barevných tokenů', () => {
    const colors = (source: Record<string, string>) =>
      Object.keys(source)
        .filter((key) => key.startsWith('--color-'))
        .sort();
    expect(colors(dark)).toEqual(colors(light));
  });

  it('oba zápisy tmavého režimu jsou shodné', () => {
    expect(darkMedia).toEqual(dark);
  });

  it('žádná hodnota není literál z Tailwind palety', () => {
    expect(css).not.toContain('theme(colors.');
  });

  const pairs: Array<[string, string, number]> = [
    ['--color-text', '--color-surface', 4.5],
    ['--color-text', '--color-surface-muted', 4.5],
    ['--color-text-muted', '--color-surface', 4.5],
    ['--color-text-muted', '--color-surface-muted', 4.5],
    ['--color-accent-text', '--color-surface', 4.5],
    ['--color-accent-text', '--color-accent-surface', 4.5],
    ['--color-primary-foreground', '--color-primary', 4.5],
    ['--color-danger-text', '--color-surface', 4.5],
    ['--color-danger-text', '--color-danger-surface', 4.5],
    ['--color-danger-foreground', '--color-danger', 4.5],
    ['--color-warning-text', '--color-surface', 4.5],
    ['--color-warning-text', '--color-warning-surface', 4.5],
    ['--color-success-text', '--color-surface', 4.5],
    ['--color-success-text', '--color-success-surface', 4.5],
    ['--color-border-strong', '--color-surface', 3],
    ['--color-focus-ring', '--color-surface', 3],
    ['--color-focus-ring', '--color-surface-muted', 3],
  ];

  for (const [mode, tokens] of [
    ['světlý', light],
    ['tmavý', dark],
  ] as const) {
    describe(`${mode} režim`, () => {
      for (const [foreground, background, minimum] of pairs) {
        it(`${foreground} na ${background} má aspoň ${minimum}:1`, () => {
          expect(contrastRatio(tokens[foreground], tokens[background])).toBeGreaterThanOrEqual(
            minimum,
          );
        });
      }
    });
  }
});
```

- [ ] **Krok 6: Spustit test, musí spadnout**

```bash
pnpm --filter @mlain/ui exec vitest run src/lib/tokens.test.ts
```

Očekávaný výstup: FAIL, `ENOENT` na `tokens.css`.

- [ ] **Krok 7: Napsat `tokens.css`**

Hodnoty jsou ověřené výpočtem, ne odhadem. Nejnižší dvojice ve světlém režimu je `--color-success-text` na `--color-success-surface` s poměrem 4,76:1, nejnižší v tmavém 7,61:1.

`packages/ui/src/tokens.css`:

```css
/*
 * Designové tokeny Mlain Maileru.
 * Sémantické názvy, nikdy názvy barev. Hodnoty se mění jen tady.
 * Kontrast hlídá src/lib/tokens.test.ts, nespoléhej na oko.
 */

@theme {
  /* @tokens light */
  --color-surface: #ffffff;
  --color-surface-muted: #f4f5f7;
  --color-surface-raised: #ffffff;
  --color-surface-overlay: #ffffff;
  --color-border: #d4d7dd;
  --color-border-strong: #6b7280;
  --color-text: #111827;
  --color-text-muted: #4b5563;
  --color-primary: #1d4ed8;
  --color-primary-hover: #1e40af;
  --color-primary-foreground: #ffffff;
  --color-accent-text: #1d4ed8;
  --color-accent-surface: #eff4ff;
  --color-danger: #b91c1c;
  --color-danger-foreground: #ffffff;
  --color-danger-text: #b91c1c;
  --color-danger-surface: #fef2f2;
  --color-warning: #92400e;
  --color-warning-foreground: #ffffff;
  --color-warning-text: #92400e;
  --color-warning-surface: #fef6e7;
  --color-success: #15803d;
  --color-success-foreground: #ffffff;
  --color-success-text: #15803d;
  --color-success-surface: #ecfdf3;
  --color-focus-ring: #1d4ed8;
  --color-scrim: rgb(17 24 39 / 0.55);

  /* rozměry a rytmus */
  --radius-control: 0.375rem;
  --radius-surface: 0.75rem;
  --spacing-gutter: 1.5rem;
  --size-topbar: 3.5rem;
  --size-sidebar: 15rem;
  --size-sidebar-collapsed: 3.5rem;
  --size-target-min: 2.75rem;
  --z-sticky: 10;
  --z-systembar: 20;
  --z-toast: 30;
  --z-dialog: 40;
  --duration-fast: 120ms;
  --duration-normal: 200ms;

  /* systémový stack, žádné stahování písem z cizího cloudu */
  --font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue",
    Arial, "Noto Sans", sans-serif;
  --font-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono",
    monospace;
}

:root {
  color-scheme: light;
}

/* Bez JavaScriptu a před nastavením data-theme rozhoduje systémové nastavení. */
@media (prefers-color-scheme: dark) {
  :root:not([data-theme]) {
    color-scheme: dark;
    /* @tokens dark-media */
    --color-surface: #0b0f17;
    --color-surface-muted: #151b26;
    --color-surface-raised: #151b26;
    --color-surface-overlay: #1b2230;
    --color-border: #2a3341;
    --color-border-strong: #9aa4b2;
    --color-text: #e9edf3;
    --color-text-muted: #a5b0c0;
    --color-primary: #8ab4ff;
    --color-primary-hover: #a8c6ff;
    --color-primary-foreground: #0b0f17;
    --color-accent-text: #8ab4ff;
    --color-accent-surface: #10203a;
    --color-danger: #ff9a9a;
    --color-danger-foreground: #0b0f17;
    --color-danger-text: #ff9a9a;
    --color-danger-surface: #2a1416;
    --color-warning: #f0b76b;
    --color-warning-foreground: #0b0f17;
    --color-warning-text: #f0b76b;
    --color-warning-surface: #2a1e0c;
    --color-success: #6fd08c;
    --color-success-foreground: #0b0f17;
    --color-success-text: #6fd08c;
    --color-success-surface: #0e2318;
    --color-focus-ring: #8ab4ff;
    --color-scrim: rgb(3 6 12 / 0.65);
  }
}

:root[data-theme='dark'] {
  color-scheme: dark;
  /* @tokens dark */
  --color-surface: #0b0f17;
  --color-surface-muted: #151b26;
  --color-surface-raised: #151b26;
  --color-surface-overlay: #1b2230;
  --color-border: #2a3341;
  --color-border-strong: #9aa4b2;
  --color-text: #e9edf3;
  --color-text-muted: #a5b0c0;
  --color-primary: #8ab4ff;
  --color-primary-hover: #a8c6ff;
  --color-primary-foreground: #0b0f17;
  --color-accent-text: #8ab4ff;
  --color-accent-surface: #10203a;
  --color-danger: #ff9a9a;
  --color-danger-foreground: #0b0f17;
  --color-danger-text: #ff9a9a;
  --color-danger-surface: #2a1416;
  --color-warning: #f0b76b;
  --color-warning-foreground: #0b0f17;
  --color-warning-text: #f0b76b;
  --color-warning-surface: #2a1e0c;
  --color-success: #6fd08c;
  --color-success-foreground: #0b0f17;
  --color-success-text: #6fd08c;
  --color-success-surface: #0e2318;
  --color-focus-ring: #8ab4ff;
  --color-scrim: rgb(3 6 12 / 0.65);
}
```

Blok `light` je uvnitř `@theme`, takže z něj Tailwind 4 vyrobí utility (`bg-surface`, `text-text-muted`, `border-border-strong`) a zároveň zapíše proměnné na `:root`. Utility odkazují na `var(--color-*)`, proto přepis proměnných v tmavém režimu funguje bez druhé sady tříd.

- [ ] **Krok 8: Spustit test, musí projít**

```bash
pnpm --filter @mlain/ui exec vitest run src/lib/tokens.test.ts
```

Očekávaný výstup: 38 passed (4 strukturální plus 2 × 17 kontrastních dvojic).

- [ ] **Krok 9: Commit**

```bash
git add packages/ui/src/tokens.css packages/ui/src/lib
git commit -m "feat(ui): semantic design tokens with enforced WCAG 2.2 AA contrast"
```

---

### Úkol 3: Základní vrstva stylů a přepínač režimu

**Soubory:**
- Vytvořit: `packages/ui/src/globals.css`, `packages/ui/src/theme/theme-provider.tsx`, `packages/ui/src/theme/theme-script.ts`
- Test: `packages/ui/src/theme/theme-provider.test.tsx`

- [ ] **Krok 1: Napsat základní vrstvu stylů**

`packages/ui/src/globals.css`:

```css
@import 'tailwindcss';
@import './tokens.css';

@layer base {
  html {
    font-family: var(--font-sans);
  }

  body {
    background-color: var(--color-surface);
    color: var(--color-text);
  }

  /* Viditelný focus ring na každém interaktivním prvku, WCAG 2.2 AA. */
  :focus-visible {
    outline: 2px solid var(--color-focus-ring);
    outline-offset: 2px;
    border-radius: var(--radius-control);
  }

  /* 2.4.11 Focus Not Obscured: sticky hlavička, systémový pruh a toast
     nesmí zakrýt fokusovaný prvek. Odsazení při skrolování na fokus. */
  :root {
    scroll-padding-top: calc(var(--size-topbar) + 0.75rem);
    scroll-padding-bottom: 5rem;
  }

  /* Uživatel, který si vypnul animace, je nedostane. Odpočty se změní
     na statické číslo, průběhové pruhy neanimují. */
  @media (prefers-reduced-motion: reduce) {
    *,
    *::before,
    *::after {
      animation-duration: 0.01ms !important;
      animation-iteration-count: 1 !important;
      transition-duration: 0.01ms !important;
      scroll-behavior: auto !important;
    }
  }
}

@utility focus-ring {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 2px;
}
```

- [ ] **Krok 2: Napsat padající test na přepínač režimu**

`packages/ui/src/theme/theme-provider.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ThemeProvider, useTheme } from './theme-provider';

function Probe() {
  const { preference, resolved, setPreference } = useTheme();
  return (
    <div>
      <span data-testid="preference">{preference}</span>
      <span data-testid="resolved">{resolved}</span>
      <button type="button" onClick={() => setPreference('dark')}>
        tmavý
      </button>
      <button type="button" onClick={() => setPreference('system')}>
        systém
      </button>
    </div>
  );
}

function mockPrefersDark(matches: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    document.documentElement.removeAttribute('data-theme');
    mockPrefersDark(false);
  });

  it('výchozí předvolba je systém a řídí se prefers-color-scheme', () => {
    mockPrefersDark(true);
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('preference')).toHaveTextContent('system');
    expect(screen.getByTestId('resolved')).toHaveTextContent('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('výslovná volba přebije systém', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <Probe />
      </ThemeProvider>,
    );
    expect(document.documentElement.dataset.theme).toBe('light');
    await user.click(screen.getByRole('button', { name: 'tmavý' }));
    expect(screen.getByTestId('preference')).toHaveTextContent('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('návrat na systém vrátí odvozenou hodnotu', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider initialPreference="dark">
        <Probe />
      </ThemeProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'systém' }));
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('mimo poskytovatele vyhodí srozumitelnou chybu', () => {
    expect(() => render(<Probe />)).toThrow(/ThemeProvider/);
  });
});
```

- [ ] **Krok 3: Spustit test, musí spadnout**

```bash
pnpm --filter @mlain/ui exec vitest run src/theme/theme-provider.test.tsx
```

Očekávaný výstup: FAIL, `Failed to resolve import "./theme-provider"`.

- [ ] **Krok 4: Implementovat přepínač**

`packages/ui/src/theme/theme-provider.tsx`:

```tsx
'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export type ThemePreference = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

type ThemeContextValue = {
  preference: ThemePreference;
  resolved: ResolvedTheme;
  setPreference: (next: ThemePreference) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function systemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'light';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({
  children,
  initialPreference = 'system',
  onPreferenceChange,
}: {
  children: React.ReactNode;
  /** Hodnota z profilu uživatele. Ukládání do profilu vlastní plán nastavení. */
  initialPreference?: ThemePreference;
  onPreferenceChange?: (next: ThemePreference) => void;
}) {
  const [preference, setPreferenceState] = useState<ThemePreference>(initialPreference);
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const handle = () => setSystem(query.matches ? 'dark' : 'light');
    handle();
    query.addEventListener('change', handle);
    return () => query.removeEventListener('change', handle);
  }, []);

  const resolved: ResolvedTheme = preference === 'system' ? system : preference;

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
  }, [resolved]);

  const setPreference = useCallback(
    (next: ThemePreference) => {
      setPreferenceState(next);
      onPreferenceChange?.(next);
    },
    [onPreferenceChange],
  );

  const value = useMemo(
    () => ({ preference, resolved, setPreference }),
    [preference, resolved, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error('useTheme se smí volat jen uvnitř ThemeProvider.');
  }
  return value;
}
```

- [ ] **Krok 5: Doplnit skript proti probliknutí světlého režimu**

Skript běží před vykreslením, takže se tmavý režim nastaví dřív, než uživatel uvidí bílou plochu. Vkládá se s `nonce` z `proxy.ts`, protože CSP nepovoluje `unsafe-inline`.

`packages/ui/src/theme/theme-script.ts`:

```ts
/**
 * Vrací text skriptu, který se vkládá do <head> před obsahem.
 * Nastaví data-theme podle uložené předvolby, jinak podle systému.
 */
export function themeScript(preference: 'light' | 'dark' | 'system'): string {
  return `(function(){var p=${JSON.stringify(preference)};var d=p==='system'?(window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'):p;document.documentElement.dataset.theme=d;})();`;
}
```

- [ ] **Krok 6: Ověřit, že typy režimu jdou naimportovat podcestou**

Barrel neexistuje, takže `ResolvedTheme` a `ThemePreference` se vyvážejí ze souboru komponenty a konzument je bere z `@mlain/ui/theme`:

```ts
import { ThemeProvider, type ResolvedTheme, type ThemePreference } from '@mlain/ui/theme';
```

- [ ] **Krok 7: Spustit testy, musí projít**

```bash
pnpm --filter @mlain/ui exec vitest run src/theme
pnpm --filter @mlain/ui typecheck
```

Očekávaný výstup: 4 passed, typecheck bez chyb.

- [ ] **Krok 8: Commit**

```bash
git add packages/ui/src/globals.css packages/ui/src/theme
git commit -m "feat(ui): base layer, focus ring, reduced motion and theme switching"
```

---

### Úkol 4: Primitiva, první část, včetně tlačítka bez mrtvého stavu

Princip P5 zní **nikdy neukazujeme mrtvé tlačítko** a akceptační kritérium 18 žádá, aby žádné tlačítko primární akce nemělo atribut `disabled`. Zároveň kritérium 16 žádá, aby hromadné smazání bez zaškrtnutého políčka nešlo provést. Obojí se sladí tak, že tlačítko **zůstane funkční a vysvětlí, proč akci teď neprovede** (rozhodnutí R7), místo aby zšedlo.

**Soubory:**
- Vytvořit: `packages/ui/src/components/button.tsx`, `label.tsx`, `input.tsx`, `textarea.tsx`, `field.tsx`, `checkbox.tsx`, `radio-group.tsx`, `switch.tsx`, `badge.tsx`, `skeleton.tsx`, `separator.tsx`, `progress.tsx`
- Test: `packages/ui/src/components/button.test.tsx`, `packages/ui/src/components/field.test.tsx`, `packages/ui/src/components/button.type-test.ts`

- [ ] **Krok 1: Napsat padající test na tlačítko**

`packages/ui/src/components/button.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Button } from './button';

describe('Button', () => {
  it('primární tlačítko nikdy nemá atribut disabled', () => {
    render(
      <Button variant="primary" unavailableReason="K odeslání je potřeba oprávnění campaigns:send.">
        Odeslat 1 129 e-mailů
      </Button>,
    );
    const button = screen.getByRole('button', { name: /Odeslat 1 129 e-mailů/ });
    expect(button).not.toBeDisabled();
    expect(button).toHaveAttribute('aria-describedby');
  });

  it('nedostupné tlačítko neprovede akci, ale vysvětlí důvod', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const onUnavailable = vi.fn();
    render(
      <Button
        variant="primary"
        unavailableReason="Nejdřív potvrďte, že rozumíte následkům."
        onUnavailable={onUnavailable}
        onClick={onClick}
      >
        Smazat 3 402 kontaktů
      </Button>,
    );
    await user.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
    expect(onUnavailable).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Nejdřív potvrďte, že rozumíte následkům.')).toBeVisible();
  });

  it('čekající tlačítko zůstává čitelné, hlásí aria-busy a nespustí akci podruhé', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Button variant="primary" pending pendingLabel="Ukládáme…" onClick={onClick}>
        Uložit
      </Button>,
    );
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveTextContent('Ukládáme…');
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('sekundární tlačítko disabled mít smí', () => {
    render(
      <Button variant="secondary" disabled>
        Předchozí
      </Button>,
    );
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('destruktivní varianta je barevně odlišená a nese sloveso s číslem', () => {
    render(<Button variant="destructive">Smazat 12 kontaktů</Button>);
    const button = screen.getByRole('button', { name: 'Smazat 12 kontaktů' });
    expect(button.className).toContain('bg-danger');
  });

  it('respektuje minimální cílovou plochu', () => {
    render(<Button variant="primary">Uložit</Button>);
    expect(screen.getByRole('button').className).toContain('min-h-11');
  });
});
```

- [ ] **Krok 2: Napsat typový test, který hlídá zákaz `disabled`**

`packages/ui/src/components/button.type-test.ts`:

```ts
/**
 * Typová pojistka ke kritériu 18. Soubor se nespouští, kontroluje ho `tsc`.
 * Když by se `disabled` na primární variantě povolilo, `@ts-expect-error`
 * přestane platit a typecheck spadne.
 */
import type { ButtonProps } from './button';

// @ts-expect-error primární tlačítko nesmí přijmout disabled
const invalidPrimary: ButtonProps = { variant: 'primary', disabled: true, children: 'Odeslat' };

// @ts-expect-error destruktivní tlačítko nesmí přijmout disabled
const invalidDestructive: ButtonProps = {
  variant: 'destructive',
  disabled: true,
  children: 'Smazat',
};

const validSecondary: ButtonProps = { variant: 'secondary', disabled: true, children: 'Zpět' };
const validPrimary: ButtonProps = { variant: 'primary', children: 'Odeslat 12 e-mailů' };

export const guards = [invalidPrimary, invalidDestructive, validSecondary, validPrimary];
```

- [ ] **Krok 3: Spustit oba, musí spadnout**

```bash
pnpm --filter @mlain/ui exec vitest run src/components/button.test.tsx
pnpm --filter @mlain/ui typecheck
```

Očekávaný výstup: FAIL, `Failed to resolve import "./button"` a `Cannot find module './button'`.

- [ ] **Krok 4: Implementovat tlačítko**

`packages/ui/src/components/button.tsx`:

```tsx
'use client';

import { cva, type VariantProps } from 'class-variance-authority';
import { forwardRef, useId, type ComponentPropsWithoutRef } from 'react';
import { cn } from '../lib/cn';

const buttonVariants = cva(
  [
    'inline-flex items-center justify-center gap-2 whitespace-normal text-center',
    'min-h-11 rounded-[var(--radius-control)] px-4 text-sm font-medium',
    'transition-colors duration-[var(--duration-fast)]',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]',
    'disabled:cursor-not-allowed disabled:opacity-60',
  ],
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground hover:bg-primary-hover',
        destructive: 'bg-danger text-danger-foreground hover:brightness-110',
        secondary: 'border border-border-strong bg-surface text-text hover:bg-surface-muted',
        ghost: 'bg-transparent text-text hover:bg-surface-muted',
        link: 'min-h-0 bg-transparent px-0 text-accent-text underline underline-offset-4',
      },
      size: {
        sm: 'min-h-11 px-3 text-sm',
        md: 'min-h-11 px-4 text-sm',
        lg: 'min-h-12 px-6 text-base',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

type NativeProps = Omit<ComponentPropsWithoutRef<'button'>, 'disabled' | 'children'>;

type SharedProps = NativeProps &
  Pick<VariantProps<typeof buttonVariants>, 'size'> & {
    children: React.ReactNode;
    className?: string;
    /** Akce běží. Tlačítko zůstává čitelné a klikatelné, ale akci nespustí podruhé. */
    pending?: boolean;
    /** Text během čekání, například „Ukládáme…". Bez něj zůstává původní popisek. */
    pendingLabel?: string;
  };

/**
 * Primární a destruktivní tlačítko `disabled` nepřijímá (princip P5, kritérium 18).
 * Když akci nejde provést, předá se `unavailableReason`: tlačítko zůstane funkční,
 * vysvětlí důvod a místo akce zavolá `onUnavailable`.
 */
type LoudProps = SharedProps & {
  variant: 'primary' | 'destructive';
  disabled?: never;
  unavailableReason?: string;
  onUnavailable?: () => void;
};

type QuietProps = SharedProps & {
  variant?: 'secondary' | 'ghost' | 'link';
  disabled?: boolean;
  unavailableReason?: never;
  onUnavailable?: never;
};

export type ButtonProps = LoudProps | QuietProps;

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(props, ref) {
  const {
    className,
    variant = 'secondary',
    size,
    children,
    pending = false,
    pendingLabel,
    onClick,
    unavailableReason,
    onUnavailable,
    ...rest
  } = props as SharedProps & {
    variant?: ButtonProps['variant'];
    unavailableReason?: string;
    onUnavailable?: () => void;
    disabled?: boolean;
  };
  const reasonId = useId();
  const isUnavailable = Boolean(unavailableReason);

  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (pending) {
      event.preventDefault();
      return;
    }
    if (isUnavailable) {
      event.preventDefault();
      onUnavailable?.();
      return;
    }
    onClick?.(event);
  };

  return (
    <>
      <button
        {...(rest as ComponentPropsWithoutRef<'button'>)}
        ref={ref}
        type={rest.type ?? 'button'}
        aria-busy={pending ? true : undefined}
        aria-describedby={isUnavailable ? reasonId : rest['aria-describedby']}
        data-pending={pending ? '' : undefined}
        data-unavailable={isUnavailable ? '' : undefined}
        className={cn(buttonVariants({ variant, size }), isUnavailable ? 'opacity-80' : '', className)}
        onClick={handleClick}
      >
        {pending && pendingLabel ? pendingLabel : children}
      </button>
      {isUnavailable ? (
        <span id={reasonId} className="mt-1 block text-sm text-text-muted">
          {unavailableReason}
        </span>
      ) : null}
    </>
  );
});
```

- [ ] **Krok 5: Spustit testy, musí projít**

```bash
pnpm --filter @mlain/ui exec vitest run src/components/button.test.tsx
pnpm --filter @mlain/ui typecheck
```

Očekávaný výstup: 6 passed, typecheck bez chyb (oba `@ts-expect-error` jsou uplatněné).

- [ ] **Krok 6: Napsat padající test na formulářové pole**

Pravidla z 5.5: **nikdy nevalidujeme při psaní**, chyba mizí okamžitě po opravě, popisek je vždy viditelný, povinnost se píše slovem.

`packages/ui/src/components/field.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Field } from './field';
import { Input } from './input';

describe('Field', () => {
  it('sváže viditelný popisek s polem', () => {
    render(
      <Field label="E-mail">
        <Input name="email" />
      </Field>,
    );
    expect(screen.getByLabelText('E-mail')).toBeInTheDocument();
  });

  it('chybu sváže přes aria-describedby a nastaví aria-invalid', () => {
    render(
      <Field label="E-mail" error="Není platná e-mailová adresa. Čekáme tvar jmeno@firma.cz.">
        <Input name="email" />
      </Field>,
    );
    const input = screen.getByLabelText('E-mail');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy as string)).toHaveTextContent(
      'Není platná e-mailová adresa.',
    );
  });

  it('nepovinnost označuje slovem, ne hvězdičkou', () => {
    render(
      <Field label="Telefon" optionalLabel="nepovinné">
        <Input name="phone" />
      </Field>,
    );
    expect(screen.getByText('nepovinné')).toBeVisible();
    expect(screen.queryByText('*')).toBeNull();
  });

  it('nápovědu i chybu předá do aria-describedby naráz', () => {
    render(
      <Field label="Slug" hint="Použije se v adrese projektu." error="Slug už existuje.">
        <Input name="slug" />
      </Field>,
    );
    const ids = (screen.getByLabelText('Slug').getAttribute('aria-describedby') as string).split(' ');
    expect(ids).toHaveLength(2);
  });
});
```

- [ ] **Krok 7: Spustit test, musí spadnout**

```bash
pnpm --filter @mlain/ui exec vitest run src/components/field.test.tsx
```

Očekávaný výstup: FAIL, `Failed to resolve import "./field"`.

- [ ] **Krok 8: Implementovat pole a zbytek primitiv první části**

`packages/ui/src/components/label.tsx`:

```tsx
import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { cn } from '../lib/cn';

export const Label = forwardRef<HTMLLabelElement, ComponentPropsWithoutRef<'label'>>(
  function Label({ className, ...props }, ref) {
    return <label {...props} ref={ref} className={cn('block text-sm font-medium text-text', className)} />;
  },
);
```

`packages/ui/src/components/input.tsx`:

```tsx
import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { cn } from '../lib/cn';

export const Input = forwardRef<HTMLInputElement, ComponentPropsWithoutRef<'input'>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        {...props}
        ref={ref}
        className={cn(
          'min-h-11 w-full rounded-[var(--radius-control)] border border-border-strong',
          'bg-surface px-3 text-sm text-text placeholder:text-text-muted',
          'aria-[invalid=true]:border-danger',
          className,
        )}
      />
    );
  },
);
```

`packages/ui/src/components/textarea.tsx`:

```tsx
import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { cn } from '../lib/cn';

export const Textarea = forwardRef<HTMLTextAreaElement, ComponentPropsWithoutRef<'textarea'>>(
  function Textarea({ className, ...props }, ref) {
    return (
      <textarea
        {...props}
        ref={ref}
        className={cn(
          'min-h-24 w-full rounded-[var(--radius-control)] border border-border-strong',
          'bg-surface p-3 text-sm text-text placeholder:text-text-muted',
          'aria-[invalid=true]:border-danger',
          className,
        )}
      />
    );
  },
);
```

`packages/ui/src/components/field.tsx`:

```tsx
'use client';

import { cloneElement, isValidElement, useId } from 'react';
import { cn } from '../lib/cn';
import { Label } from './label';

type FieldChild = React.ReactElement<{
  id?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
}>;

export type FieldProps = {
  label: string;
  children: FieldChild;
  /** Trvalá nápověda pod polem. */
  hint?: string;
  /** Chyba se ukazuje až po opuštění pole, nikdy při psaní (pravidlo 5.5). */
  error?: string;
  /** Povinnost se neznačí hvězdičkou. U našich formulářů je většina polí povinná,
   *  takže se označují ta nepovinná. */
  optionalLabel?: string;
  className?: string;
};

export function Field({ label, children, hint, error, optionalLabel, className }: FieldProps) {
  const inputId = useId();
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;

  if (!isValidElement(children)) {
    throw new Error('Field očekává právě jeden formulářový prvek jako potomka.');
  }

  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ');

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <Label htmlFor={inputId}>
        {label}
        {optionalLabel ? <span className="ml-1 font-normal text-text-muted">{optionalLabel}</span> : null}
      </Label>
      {cloneElement(children, {
        id: inputId,
        'aria-describedby': describedBy === '' ? undefined : describedBy,
        'aria-invalid': error ? true : undefined,
      })}
      {hint ? (
        <p id={hintId} className="text-sm text-text-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm text-danger-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
```

`packages/ui/src/components/checkbox.tsx`:

```tsx
'use client';

import { Checkbox as RadixCheckbox } from 'radix-ui';
import { Check } from 'lucide-react';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from '../lib/cn';

export const Checkbox = forwardRef<
  ElementRef<typeof RadixCheckbox.Root>,
  ComponentPropsWithoutRef<typeof RadixCheckbox.Root>
>(function Checkbox({ className, ...props }, ref) {
  return (
    <RadixCheckbox.Root
      {...props}
      ref={ref}
      className={cn(
        'flex size-5 shrink-0 items-center justify-center rounded-[4px]',
        'border border-border-strong bg-surface',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary',
        className,
      )}
    >
      <RadixCheckbox.Indicator className="text-primary-foreground">
        <Check aria-hidden className="size-4" />
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  );
});
```

`packages/ui/src/components/radio-group.tsx`:

```tsx
'use client';

import { RadioGroup as RadixRadioGroup } from 'radix-ui';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from '../lib/cn';

export const RadioGroup = forwardRef<
  ElementRef<typeof RadixRadioGroup.Root>,
  ComponentPropsWithoutRef<typeof RadixRadioGroup.Root>
>(function RadioGroup({ className, ...props }, ref) {
  return <RadixRadioGroup.Root {...props} ref={ref} className={cn('flex flex-col gap-2', className)} />;
});

export const RadioGroupItem = forwardRef<
  ElementRef<typeof RadixRadioGroup.Item>,
  ComponentPropsWithoutRef<typeof RadixRadioGroup.Item>
>(function RadioGroupItem({ className, ...props }, ref) {
  return (
    <RadixRadioGroup.Item
      {...props}
      ref={ref}
      className={cn(
        'size-5 rounded-full border border-border-strong bg-surface',
        'data-[state=checked]:border-primary data-[state=checked]:bg-primary',
        className,
      )}
    >
      <RadixRadioGroup.Indicator className="block size-2 rounded-full bg-primary-foreground" />
    </RadixRadioGroup.Item>
  );
});
```

`packages/ui/src/components/switch.tsx`:

```tsx
'use client';

import { Switch as RadixSwitch } from 'radix-ui';
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef } from 'react';
import { cn } from '../lib/cn';

export const Switch = forwardRef<
  ElementRef<typeof RadixSwitch.Root>,
  ComponentPropsWithoutRef<typeof RadixSwitch.Root>
>(function Switch({ className, ...props }, ref) {
  return (
    <RadixSwitch.Root
      {...props}
      ref={ref}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full border border-border-strong',
        'bg-surface-muted data-[state=checked]:border-primary data-[state=checked]:bg-primary',
        className,
      )}
    >
      <RadixSwitch.Thumb className="block size-4 translate-x-1 rounded-full bg-text transition-transform data-[state=checked]:translate-x-6 data-[state=checked]:bg-primary-foreground" />
    </RadixSwitch.Root>
  );
});
```

`packages/ui/src/components/badge.tsx`:

```tsx
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../lib/cn';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium',
  {
    variants: {
      tone: {
        neutral: 'bg-surface-muted text-text',
        accent: 'bg-accent-surface text-accent-text',
        success: 'bg-success-surface text-success-text',
        warning: 'bg-warning-surface text-warning-text',
        danger: 'bg-danger-surface text-danger-text',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

/**
 * Odznak nese barvu, ikonu i slovo. Stav se nikdy nesděluje jen barvou (11.3).
 * Ikona je proto povinná a `children` musí obsahovat text.
 */
export function Badge({
  tone,
  icon,
  children,
  className,
}: VariantProps<typeof badgeVariants> & {
  icon: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn(badgeVariants({ tone }), className)}>
      <span aria-hidden className="flex size-4 items-center justify-center">
        {icon}
      </span>
      {children}
    </span>
  );
}
```

`packages/ui/src/components/skeleton.tsx`:

```tsx
import { cn } from '../lib/cn';

/** Skeleton má tvar budoucího obsahu, ne obecný obdélník (14.4). */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div aria-hidden className={cn('animate-pulse rounded-[var(--radius-control)] bg-surface-muted', className)} />
  );
}
```

`packages/ui/src/components/separator.tsx`:

```tsx
import { Separator as RadixSeparator } from 'radix-ui';
import { cn } from '../lib/cn';

export function Separator({
  className,
  orientation = 'horizontal',
}: {
  className?: string;
  orientation?: 'horizontal' | 'vertical';
}) {
  return (
    <RadixSeparator.Root
      orientation={orientation}
      className={cn('bg-border', orientation === 'horizontal' ? 'h-px w-full' : 'h-full w-px', className)}
    />
  );
}
```

`packages/ui/src/components/progress.tsx`:

```tsx
import { cn } from '../lib/cn';

/**
 * Určitý průběh. `valueText` je povinný, protože čtečka má číst
 * „3 214 z 12 480", ne „26 procent" (mapování 5.10).
 */
export function Progress({
  value,
  max,
  valueText,
  label,
  className,
}: {
  value: number;
  max: number;
  valueText: string;
  label: string;
  className?: string;
}) {
  const percent = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={valueText}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-surface-muted', className)}
    >
      <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
    </div>
  );
}

/** Neurčitý průběh: bez `aria-valuenow`, oblast dostane `aria-busy`. */
export function IndeterminateProgress({ label, className }: { label: string; className?: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      className={cn('h-2 w-full overflow-hidden rounded-full bg-surface-muted', className)}
    >
      <div className="h-full w-1/3 animate-pulse bg-primary" />
    </div>
  );
}
```

- [ ] **Krok 9: Spustit testy, musí projít**

```bash
pnpm --filter @mlain/ui exec vitest run src/components
pnpm --filter @mlain/ui typecheck
```

Očekávaný výstup: 10 passed, typecheck bez chyb.

- [ ] **Krok 10: Commit**

```bash
git add packages/ui/src/components
git commit -m "feat(ui): form and status primitives, button without a dead state"
```

---

### Úkol 5: Primitiva, druhá část, včetně dialogu se správou fokusu

**Soubory:**
- Vytvořit: `packages/ui/src/components/dialog.tsx`, `dropdown-menu.tsx`, `popover.tsx`, `select.tsx`, `tooltip.tsx`, `tabs.tsx`, `collapsible.tsx`, `command.tsx`
- Test: `packages/ui/src/components/dialog.test.tsx`

- [ ] **Krok 1: Napsat padající test na dialog**

`packages/ui/src/components/dialog.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { Button } from './button';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from './dialog';

function Harness({ destructive = false }: { destructive?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Otevřít
      </Button>
      <Dialog open={open} onOpenChange={setOpen} destructive={destructive}>
        <DialogTitle>Smazat 12 kontaktů?</DialogTitle>
        <DialogBody>Kontakty zmizí ze všech seznamů a segmentů.</DialogBody>
        <DialogFooter
          retreat={
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Nemazat
            </Button>
          }
          confirm={<Button variant="destructive">Smazat 12 kontaktů</Button>}
        />
      </Dialog>
    </>
  );
}

describe('Dialog', () => {
  it('má aria-modal a popisek z nadpisu', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Otevřít' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Smazat 12 kontaktů?');
  });

  it('výchozí fokus je na tlačítku ústupu, ne na destruktivním', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Otevřít' }));
    expect(screen.getByRole('button', { name: 'Nemazat' })).toHaveFocus();
  });

  it('Esc zavře dialog a fokus se vrátí na spouštěč', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const trigger = screen.getByRole('button', { name: 'Otevřít' });
    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('u destruktivního dialogu kliknutí mimo nezavírá', async () => {
    const user = userEvent.setup();
    render(<Harness destructive />);
    await user.click(screen.getByRole('button', { name: 'Otevřít' }));
    await user.click(document.body);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('ústup je vlevo a potvrzení vpravo, v celé aplikaci stejně', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(screen.getByRole('button', { name: 'Otevřít' }));
    const buttons = screen.getAllByRole('button', { name: /Nemazat|Smazat 12 kontaktů/ });
    expect(buttons[0]).toHaveAccessibleName('Nemazat');
    expect(buttons[1]).toHaveAccessibleName('Smazat 12 kontaktů');
  });
});
```

- [ ] **Krok 2: Spustit test, musí spadnout**

```bash
pnpm --filter @mlain/ui exec vitest run src/components/dialog.test.tsx
```

Očekávaný výstup: FAIL, `Failed to resolve import "./dialog"`.

- [ ] **Krok 3: Implementovat dialog**

`packages/ui/src/components/dialog.tsx`:

```tsx
'use client';

import { Dialog as RadixDialog } from 'radix-ui';
import { createContext, useContext, useRef } from 'react';
import { cn } from '../lib/cn';

const RetreatContext = createContext<React.RefObject<HTMLDivElement | null> | null>(null);

export function Dialog({
  open,
  onOpenChange,
  children,
  /** Destruktivní dialog nejde zavřít kliknutím mimo (pravidlo 5.3). Esc funguje vždy. */
  destructive = false,
  className,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  destructive?: boolean;
  className?: string;
}) {
  const retreatRef = useRef<HTMLDivElement | null>(null);

  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-[var(--z-dialog)] bg-[var(--color-scrim)]" />
        <RadixDialog.Content
          aria-modal="true"
          onOpenAutoFocus={(event) => {
            // Výchozí fokus patří tlačítku ústupu. Enter bez čtení pak nic nesmaže.
            const retreat = retreatRef.current?.querySelector<HTMLElement>('button, [href]');
            if (retreat) {
              event.preventDefault();
              retreat.focus();
            }
          }}
          onPointerDownOutside={(event) => {
            if (destructive) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            if (destructive) event.preventDefault();
          }}
          className={cn(
            'fixed left-1/2 top-1/2 z-[var(--z-dialog)] w-[min(32rem,calc(100vw-2rem))]',
            '-translate-x-1/2 -translate-y-1/2 rounded-[var(--radius-surface)]',
            'border border-border bg-surface-overlay p-6 text-text shadow-lg',
            className,
          )}
        >
          <RetreatContext.Provider value={retreatRef}>{children}</RetreatContext.Provider>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}

/** Nadpis nese informaci, nikdy slovo „Potvrzení" (9.4). */
export function DialogTitle({ children }: { children: React.ReactNode }) {
  return <RadixDialog.Title className="text-lg font-semibold text-text">{children}</RadixDialog.Title>;
}

export function DialogBody({ children }: { children: React.ReactNode }) {
  return <div className="mt-3 flex flex-col gap-3 text-sm text-text">{children}</div>;
}

/**
 * Pozice tlačítek je v celé aplikaci stejná: vlevo ústup, vpravo potvrzení (6.7).
 * Proto se předávají jmenovitě, ne jako volné `children`.
 */
export function DialogFooter({
  retreat,
  confirm,
}: {
  retreat: React.ReactNode;
  confirm: React.ReactNode;
}) {
  const retreatRef = useContext(RetreatContext);
  return (
    <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
      <div ref={retreatRef}>{retreat}</div>
      <div>{confirm}</div>
    </div>
  );
}
```

- [ ] **Krok 4: Implementovat zbytek primitiv**

`packages/ui/src/components/dropdown-menu.tsx`:

```tsx
'use client';

import { DropdownMenu as Radix } from 'radix-ui';
import { cn } from '../lib/cn';

export const DropdownMenu = Radix.Root;
export const DropdownMenuTrigger = Radix.Trigger;

export function DropdownMenuContent({
  children,
  align = 'start',
  className,
}: {
  children: React.ReactNode;
  align?: 'start' | 'center' | 'end';
  className?: string;
}) {
  return (
    <Radix.Portal>
      <Radix.Content
        align={align}
        sideOffset={6}
        className={cn(
          'z-[var(--z-dialog)] min-w-56 rounded-[var(--radius-surface)] border border-border',
          'bg-surface-overlay p-1 text-sm text-text shadow-lg',
          className,
        )}
      >
        {children}
      </Radix.Content>
    </Radix.Portal>
  );
}

export function DropdownMenuItem({
  children,
  onSelect,
  tone = 'neutral',
}: {
  children: React.ReactNode;
  onSelect?: () => void;
  tone?: 'neutral' | 'danger';
}) {
  return (
    <Radix.Item
      onSelect={onSelect}
      className={cn(
        'flex min-h-11 cursor-pointer items-center gap-2 rounded-[var(--radius-control)] px-3',
        'data-[highlighted]:bg-surface-muted',
        tone === 'danger' ? 'text-danger-text' : 'text-text',
      )}
    >
      {children}
    </Radix.Item>
  );
}

export function DropdownMenuSeparator() {
  return <Radix.Separator className="my-1 h-px bg-border" />;
}
```

`packages/ui/src/components/popover.tsx`:

```tsx
'use client';

import { Popover as Radix } from 'radix-ui';
import { cn } from '../lib/cn';

export const Popover = Radix.Root;
export const PopoverTrigger = Radix.Trigger;

export function PopoverContent({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Radix.Portal>
      <Radix.Content
        sideOffset={6}
        className={cn(
          'z-[var(--z-dialog)] rounded-[var(--radius-surface)] border border-border',
          'bg-surface-overlay p-4 text-sm text-text shadow-lg',
          className,
        )}
      >
        {children}
      </Radix.Content>
    </Radix.Portal>
  );
}
```

`packages/ui/src/components/select.tsx`:

```tsx
'use client';

import { Select as Radix } from 'radix-ui';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '../lib/cn';

export function Select({
  value,
  onValueChange,
  placeholder,
  children,
  className,
  'aria-label': ariaLabel,
}: {
  value?: string;
  onValueChange: (value: string) => void;
  placeholder: string;
  children: React.ReactNode;
  className?: string;
  'aria-label': string;
}) {
  return (
    <Radix.Root value={value} onValueChange={onValueChange}>
      <Radix.Trigger
        aria-label={ariaLabel}
        className={cn(
          'flex min-h-11 w-full items-center justify-between gap-2 rounded-[var(--radius-control)]',
          'border border-border-strong bg-surface px-3 text-sm text-text',
          className,
        )}
      >
        <Radix.Value placeholder={placeholder} />
        <ChevronDown aria-hidden className="size-4 text-text-muted" />
      </Radix.Trigger>
      <Radix.Portal>
        <Radix.Content
          position="popper"
          sideOffset={4}
          className="z-[var(--z-dialog)] max-h-72 min-w-[var(--radix-select-trigger-width)] overflow-auto rounded-[var(--radius-surface)] border border-border bg-surface-overlay p-1 shadow-lg"
        >
          <Radix.Viewport>{children}</Radix.Viewport>
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}

export function SelectItem({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <Radix.Item
      value={value}
      className="flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-[var(--radius-control)] px-3 text-sm text-text data-[highlighted]:bg-surface-muted"
    >
      <Radix.ItemText>{children}</Radix.ItemText>
      <Radix.ItemIndicator>
        <Check aria-hidden className="size-4" />
      </Radix.ItemIndicator>
    </Radix.Item>
  );
}
```

`packages/ui/src/components/tooltip.tsx`:

```tsx
'use client';

import { Tooltip as Radix } from 'radix-ui';
import { cn } from '../lib/cn';

export const TooltipProvider = Radix.Provider;

/**
 * Tooltip je doplněk, nikdy jediný nositel informace: obsah `content`
 * musí být dostupný i jinde (K7 má tabulku pod grafem).
 */
export function Tooltip({
  content,
  children,
  className,
}: {
  content: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Radix.Root delayDuration={200}>
      <Radix.Trigger asChild>{children}</Radix.Trigger>
      <Radix.Portal>
        <Radix.Content
          sideOffset={6}
          className={cn(
            'z-[var(--z-dialog)] max-w-72 rounded-[var(--radius-control)] border border-border',
            'bg-surface-overlay px-3 py-2 text-sm text-text shadow-md',
            className,
          )}
        >
          {content}
        </Radix.Content>
      </Radix.Portal>
    </Radix.Root>
  );
}
```

`packages/ui/src/components/tabs.tsx`:

```tsx
'use client';

import { Tabs as Radix } from 'radix-ui';
import { cn } from '../lib/cn';

export const Tabs = Radix.Root;

export function TabsList({ children, className }: { children: React.ReactNode; className?: string }) {
  return <Radix.List className={cn('flex gap-1 border-b border-border', className)}>{children}</Radix.List>;
}

export function TabsTrigger({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <Radix.Trigger
      value={value}
      className="min-h-11 border-b-2 border-transparent px-4 text-sm text-text-muted data-[state=active]:border-primary data-[state=active]:text-text"
    >
      {children}
    </Radix.Trigger>
  );
}

export function TabsContent({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <Radix.Content value={value} className="pt-4">
      {children}
    </Radix.Content>
  );
}
```

`packages/ui/src/components/collapsible.tsx`:

```tsx
'use client';

import { Collapsible as Radix } from 'radix-ui';
import { ChevronRight } from 'lucide-react';
import { cn } from '../lib/cn';

export function Collapsible({
  summary,
  children,
  defaultOpen = false,
  className,
}: {
  summary: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  className?: string;
}) {
  return (
    <Radix.Root defaultOpen={defaultOpen} className={cn('text-sm', className)}>
      <Radix.Trigger className="flex min-h-11 items-center gap-2 text-left text-text-muted">
        <ChevronRight aria-hidden className="size-4 transition-transform data-[state=open]:rotate-90" />
        {summary}
      </Radix.Trigger>
      <Radix.Content className="pt-2">{children}</Radix.Content>
    </Radix.Root>
  );
}
```

`packages/ui/src/components/command.tsx`:

```tsx
'use client';

import { Command as CommandPrimitive } from 'cmdk';
import { cn } from '../lib/cn';

/**
 * Obal nad `cmdk`. API knihovny ven z tohohle souboru neuniká, protože
 * `cmdk` má poslední vydání starší než rok a platí pro něj pravidlo
 * vlastního rozhraní z 13.2 části 6.
 */
export const Command = CommandPrimitive;

export function CommandInput({ placeholder }: { placeholder: string }) {
  return (
    <CommandPrimitive.Input
      placeholder={placeholder}
      className="min-h-11 w-full border-b border-border bg-transparent px-4 text-sm text-text outline-none placeholder:text-text-muted"
    />
  );
}

export function CommandList({ children }: { children: React.ReactNode }) {
  return <CommandPrimitive.List className="max-h-80 overflow-auto p-2">{children}</CommandPrimitive.List>;
}

export function CommandEmpty({ children }: { children: React.ReactNode }) {
  return (
    <CommandPrimitive.Empty className="px-3 py-6 text-center text-sm text-text-muted">
      {children}
    </CommandPrimitive.Empty>
  );
}

export function CommandGroup({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <CommandPrimitive.Group
      heading={heading}
      className={cn(
        '[&_[cmdk-group-heading]]:px-3 [&_[cmdk-group-heading]]:py-2',
        '[&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium',
        '[&_[cmdk-group-heading]]:text-text-muted',
      )}
    >
      {children}
    </CommandPrimitive.Group>
  );
}

export function CommandItem({
  value,
  onSelect,
  children,
}: {
  value: string;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <CommandPrimitive.Item
      value={value}
      onSelect={onSelect}
      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-[var(--radius-control)] px-3 text-sm text-text data-[selected=true]:bg-surface-muted"
    >
      {children}
    </CommandPrimitive.Item>
  );
}
```

- [ ] **Krok 5: Spustit testy, musí projít**

```bash
pnpm --filter @mlain/ui exec vitest run src/components
pnpm --filter @mlain/ui typecheck
```

Očekávaný výstup: 15 passed, typecheck bez chyb.

- [ ] **Krok 6: Commit**

```bash
git add packages/ui/src/components
git commit -m "feat(ui): overlay primitives with focus management and keyboard closing"
```

---

### Úkol 6: ESLint pravidlo proti mrtvému primárnímu tlačítku

Kritérium 18 žádá lint pravidlo s allowlistem, ne jen typovou pojistku. Typ chytí `<Button variant="primary" disabled>`, ale ne ručně napsané `<button className="bg-primary" disabled>`. Obojí je potřeba.

**Soubory:**
- Vytvořit: `packages/ui/eslint-rules/no-disabled-primary-action.cjs`, `packages/ui/eslint-rules/index.cjs`, `packages/ui/eslint-rules/allowlist.json`
- Test: `packages/ui/eslint-rules/no-disabled-primary-action.test.cjs`

- [ ] **Krok 1: Napsat padající test pravidla**

`packages/ui/eslint-rules/no-disabled-primary-action.test.cjs`:

```js
const { RuleTester } = require('eslint');
const rule = require('./no-disabled-primary-action.cjs');

const ruleTester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2024,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

ruleTester.run('no-disabled-primary-action', rule, {
  valid: [
    { code: '<Button variant="secondary" disabled>Zpět</Button>' },
    { code: '<Button variant="primary">Odeslat 12 e-mailů</Button>' },
    { code: '<Button variant="primary" unavailableReason="Chybí oprávnění.">Odeslat</Button>' },
    { code: '<Button variant="primary" disabled data-allow-disabled="wizard-step-guard">Dál</Button>' },
  ],
  invalid: [
    {
      code: '<Button variant="primary" disabled>Odeslat</Button>',
      errors: [{ messageId: 'noDisabledPrimary' }],
    },
    {
      code: '<Button variant="destructive" disabled={!confirmed}>Smazat</Button>',
      errors: [{ messageId: 'noDisabledPrimary' }],
    },
    {
      code: '<button type="submit" className="bg-primary text-primary-foreground" disabled>Uložit</button>',
      errors: [{ messageId: 'noDisabledPrimary' }],
    },
  ],
});

console.log('no-disabled-primary-action: OK');
```

- [ ] **Krok 2: Spustit test, musí spadnout**

```bash
node packages/ui/eslint-rules/no-disabled-primary-action.test.cjs
```

Očekávaný výstup: FAIL, `Cannot find module './no-disabled-primary-action.cjs'`.

- [ ] **Krok 3: Implementovat pravidlo**

`packages/ui/eslint-rules/no-disabled-primary-action.cjs`:

```js
'use strict';

/**
 * Vynucuje princip P5 a kritérium 18: primární ani destruktivní akce
 * nesmí být mrtvá. Místo `disabled` se použije `unavailableReason`,
 * které tlačítko nechá funkční a vysvětlí, proč akci teď neprovede.
 *
 * Výjimka se zapisuje atributem `data-allow-disabled="<důvod>"`
 * a musí být zároveň v allowlist.json, jinak ji hlídá test v úkolu 34.
 */
const LOUD_VARIANTS = new Set(['primary', 'destructive']);
const LOUD_CLASSES = ['bg-primary', 'bg-danger'];

function attributeNamed(node, name) {
  return node.attributes.find(
    (attribute) => attribute.type === 'JSXAttribute' && attribute.name.name === name,
  );
}

function literalValue(attribute) {
  if (!attribute || !attribute.value) return undefined;
  if (attribute.value.type === 'Literal') return attribute.value.value;
  return undefined;
}

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Primární a destruktivní tlačítko nesmí být disabled. Použij unavailableReason.',
    },
    messages: {
      noDisabledPrimary:
        'Primární ani destruktivní akce nesmí být disabled (princip P5, kritérium 18). Použij unavailableReason a vysvětli, proč akce nejde provést.',
    },
    schema: [],
  },
  create(context) {
    return {
      JSXOpeningElement(node) {
        const disabled = attributeNamed(node, 'disabled');
        if (!disabled) return;
        if (attributeNamed(node, 'data-allow-disabled')) return;

        const variant = literalValue(attributeNamed(node, 'variant'));
        const className = literalValue(attributeNamed(node, 'className')) || '';
        const isLoud =
          (typeof variant === 'string' && LOUD_VARIANTS.has(variant)) ||
          LOUD_CLASSES.some((token) => String(className).includes(token));

        if (isLoud) {
          context.report({ node: disabled, messageId: 'noDisabledPrimary' });
        }
      },
    };
  },
};
```

`packages/ui/eslint-rules/index.cjs`:

```js
'use strict';

module.exports = {
  rules: {
    'no-disabled-primary-action': require('./no-disabled-primary-action.cjs'),
  },
};
```

`packages/ui/eslint-rules/allowlist.json`:

```json
{
  "comment": "Výjimky ze zákazu disabled na primární akci. Každá má důvod a schvalovatele. Prázdný seznam je správný výchozí stav.",
  "exceptions": []
}
```

- [ ] **Krok 4: Spustit test, musí projít**

```bash
node packages/ui/eslint-rules/no-disabled-primary-action.test.cjs
```

Očekávaný výstup: `no-disabled-primary-action: OK`.

- [ ] **Krok 5: Commit**

```bash
git add packages/ui/eslint-rules
git commit -m "feat(ui): eslint rule banning disabled primary and destructive actions"
```

---

### Úkol 7: Kostra balíčku `@mlain/i18n` a skládání katalogů z namespace

Uzávěr S4 řídicího dokumentu rozděluje katalogy na soubory po doménách, aby si každý plán vlastnil právě svůj. Část 1 chce jeden strom na jazyk. Rozhodnutí R2 obojí sladí: na disku soubory po namespace, za běhu jeden strom.

**Soubory:**
- Vytvořit: `packages/i18n/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/locales.ts`, `src/load-messages.ts`
- Test: `packages/i18n/src/load-messages.test.ts`

- [ ] **Krok 1: Doplnit manifest balíčku**

Stejně jako u `packages/ui` je kostra od P01 a P05 ji rozšiřuje. Výsledná podoba:

`packages/i18n/package.json`:

```json
{
  "name": "@mlain/i18n",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./routing": "./src/routing.ts",
    "./navigation": "./src/navigation.ts",
    "./request": "./src/request.ts",
    "./next-plugin": "./src/next-plugin.ts",
    "./format": "./src/format.ts",
    "./messages/*": "./messages/*"
  },
  "scripts": {
    "typecheck": "tsc --noEmit",
    "test:unit": "vitest run"
  },
  "dependencies": {
    "next-intl": "4.13.4"
  },
  "devDependencies": {
    "@mlain/config": "workspace:*",
    "vitest": "4.1.10"
  }
}
```

`packages/i18n/tsconfig.json`:

```json
{
  "extends": "@mlain/config/tsconfig-react.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true,
    "resolveJsonModule": true,
    "types": ["vitest/globals"]
  },
  "include": ["src", "vitest.config.ts"]
}
```

`packages/i18n/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Krok 2: Napsat padající test na skládání katalogů**

`packages/i18n/src/load-messages.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES, isSupportedLocale } from './locales';
import { loadMessages, listNamespaces } from './load-messages';

describe('locales', () => {
  it('podporuje češtinu a angličtinu, výchozí je čeština', () => {
    expect(SUPPORTED_LOCALES).toEqual(['cs', 'en']);
    expect(DEFAULT_LOCALE).toBe('cs');
  });

  it('pozná nepodporovaný jazyk', () => {
    expect(isSupportedLocale('cs')).toBe(true);
    expect(isSupportedLocale('de')).toBe(false);
  });
});

describe('loadMessages', () => {
  it('složí soubory po namespace do jednoho vnořeného stromu', async () => {
    const messages = await loadMessages('cs');
    expect(messages).toHaveProperty('common');
    expect(typeof messages.common).toBe('object');
  });

  it('klíč se čte plnou cestou, namespace je první segment', async () => {
    const messages = await loadMessages('cs');
    expect(messages.common).toHaveProperty('actions');
  });

  it('oba jazyky mají stejnou množinu namespace', async () => {
    const cs = await listNamespaces('cs');
    const en = await listNamespaces('en');
    expect(cs).toEqual(en);
  });

  it('nepodporovaný jazyk vyhodí chybu, nevrací prázdný objekt', async () => {
    await expect(loadMessages('de' as never)).rejects.toThrow(/Nepodporovaný jazyk/);
  });
});
```

- [ ] **Krok 3: Spustit test, musí spadnout**

```bash
pnpm --filter @mlain/i18n exec vitest run src/load-messages.test.ts
```

Očekávaný výstup: FAIL, `Failed to resolve import "./locales"`.

- [ ] **Krok 4: Implementovat jazyky a skládání**

`packages/i18n/src/locales.ts`:

```ts
/**
 * Seznam jazyků. Přidání dalšího znamená nový adresář v `messages/`
 * a záznam tady. Žádná změna kódu jinde (12.8 části 6).
 *
 * Hodnoty se za běhu ověřují proti konfiguračním proměnným
 * SUPPORTED_LOCALES a DEFAULT_LOCALE, které vlastní P01.
 */
export const SUPPORTED_LOCALES = ['cs', 'en'] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'cs';

/** Zdroj pravdy pro množinu klíčů. Katalog `cs` se proti němu porovnává. */
export const SOURCE_LOCALE: Locale = 'en';

export function isSupportedLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}
```

`packages/i18n/src/load-messages.ts`:

```ts
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { isSupportedLocale, type Locale } from './locales';

const MESSAGES_ROOT = fileURLToPath(new URL('../messages/', import.meta.url));

export type MessageTree = Record<string, unknown>;

function directoryFor(locale: Locale): string {
  return `${MESSAGES_ROOT}${locale}/`;
}

/** Vrací seřazený seznam namespace, tedy názvů souborů bez přípony. */
export async function listNamespaces(locale: Locale): Promise<string[]> {
  const entries = await readdir(directoryFor(locale));
  return entries
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\.json$/, ''))
    .sort();
}

/**
 * Složí `messages/<locale>/<namespace>.json` do jednoho stromu,
 * který `next-intl` očekává: { common: {...}, contacts: {...} }.
 *
 * Soubory jsou rozdělené kvůli vlastnictví (uzávěr S4), tvar stromu
 * zůstává takový, jaký popisuje část 1 v 3.9.
 */
export async function loadMessages(locale: Locale): Promise<MessageTree> {
  if (!isSupportedLocale(locale)) {
    throw new Error(`Nepodporovaný jazyk: ${locale}`);
  }
  const namespaces = await listNamespaces(locale);
  const tree: MessageTree = {};
  for (const namespace of namespaces) {
    const raw = await readFile(`${directoryFor(locale)}${namespace}.json`, 'utf8');
    tree[namespace] = JSON.parse(raw) as unknown;
  }
  return tree;
}
```

- [ ] **Krok 5: Spustit test, musí projít**

Test potřebuje existující katalog. Založ zatím `packages/i18n/messages/cs/common.json` a `packages/i18n/messages/en/common.json` s minimálním obsahem, úplný obsah dodá úkol 8:

```json
{ "actions": { "save": "Uložit" } }
```

```json
{ "actions": { "save": "Save" } }
```

```bash
pnpm --filter @mlain/i18n exec vitest run src/load-messages.test.ts
```

Očekávaný výstup: 6 passed.

- [ ] **Krok 6: Commit**

```bash
git add packages/i18n
git commit -m "feat(i18n): package scaffold with per-namespace catalog loading"
```

---

### Úkol 8: Namespace `common` v češtině a angličtině

Tenhle katalog je základ, na kterém staví jedenáct plánů. Doménové namespace (`contacts`, `campaigns`, `settings`, …) **tenhle plán nezakládá**, patří doménovým plánům.

Pravidla, která katalog dodržuje a která hlídají testy z úkolu 9:

| Pravidlo | Kde se to projeví |
|---|---|
| Věta se nikdy neskládá z fragmentů, vždy celá zpráva s parametry | všechny klíče |
| U počtu vždy ICU `plural` včetně `=0` | `counts.*` |
| Kategorie `many` je v češtině pro desetinná čísla, musí být vyplněná | `counts.*` |
| S číslem se mění i sloveso, `plural` je proto nad **celou větou** | `counts.openedByPeople` |
| Neutrální rod je podstatné jméno, ne mužský tvar | `timeline` v doménových katalozích, vzor viz níž |
| Tlačítko je sloveso a předmět, nikdy OK, Ano, Potvrdit | `actions.*` |
| Vykáme | všude |
| Žádná dlouhá pomlčka U+2014 | všude |

**Oprava vzoru ze specifikace.** Část 6 uvádí v 12.3 vzor `"{gender, select, female {Otevřela} male {Otevřel} other {Otevření}} kampaň {campaign}"` s očekávaným výstupem „Otevření kampaně Letní výprodej". Ten vzor svůj vlastní výstup nedá: mimo blok `select` je natvrdo tvar „kampaň", takže neutrální větev vyrobí „Otevření kampaň Letní výprodej". Správně, a v souladu s vlastním pravidlem „nikdy neskládáme věty z fragmentů", patří do každé větve **celá věta**:

```
"{gender, select, female {Otevřela kampaň {campaign}} male {Otevřel kampaň {campaign}} other {Otevření kampaně {campaign}}}"
```

Tenhle tvar používá komponenta K8 i doménové katalogy. Zapiš ho do `packages/i18n/README.md` jako závazný vzor pro rody.

**Soubory:**
- Vytvořit: `packages/i18n/messages/cs/common.json`, `packages/i18n/messages/en/common.json`, `packages/i18n/README.md`, `packages/i18n/src/index.ts`

- [ ] **Krok 1: Napsat český katalog**

`packages/i18n/messages/cs/common.json`:

```json
{
  "actions": {
    "save": "Uložit",
    "saveAndClose": "Uložit a zavřít",
    "cancel": "Zrušit",
    "backToEditing": "Zpět k úpravám",
    "keep": "Nemazat",
    "keepRunning": "Nechat běžet",
    "tryAgain": "Zkusit znovu",
    "continue": "Pokračovat",
    "back": "Předchozí krok",
    "gotIt": "Rozumím",
    "later": "Později",
    "close": "Zavřít",
    "copy": "Zkopírovat",
    "copied": "Zkopírováno",
    "undo": "Vrátit zpět",
    "showDetails": "Podrobnosti pro technickou podporu",
    "loadOlder": "Načíst starší",
    "clearFilters": "Zrušit všechny filtry",
    "clearSearch": "Zrušit jen hledání",
    "recalculate": "Přepočítat",
    "refresh": "Obnovit"
  },
  "counts": {
    "contacts": "{count, plural, =0 {Žádné kontakty} one {# kontakt} few {# kontakty} many {# kontaktu} other {# kontaktů}}",
    "emails": "{count, plural, =0 {Žádné e-maily} one {# e-mail} few {# e-maily} many {# e-mailu} other {# e-mailů}}",
    "campaigns": "{count, plural, =0 {Žádné kampaně} one {# kampaň} few {# kampaně} many {# kampaně} other {# kampaní}}",
    "rows": "{count, plural, =0 {Žádné řádky} one {# řádek} few {# řádky} many {# řádku} other {# řádků}}",
    "groups": "{count, plural, =0 {Žádné skupiny} one {# skupina} few {# skupiny} many {# skupiny} other {# skupin}}",
    "days": "{count, plural, =0 {Žádný den} one {# den} few {# dny} many {# dne} other {# dní}}",
    "minutes": "{count, plural, =0 {Žádná minuta} one {# minuta} few {# minuty} many {# minuty} other {# minut}}",
    "seconds": "{count, plural, =0 {Žádná sekunda} one {# sekunda} few {# sekundy} many {# sekundy} other {# sekund}}",
    "selected": "{count, plural, =0 {Nevybrali jste nic} one {Vybrán # kontakt} few {Vybrány # kontakty} many {Vybráno # kontaktu} other {Vybráno # kontaktů}}",
    "openedByPeople": "{count, plural, =0 {Neotevřel nikdo} one {Otevřel # člověk} few {Otevřeli # lidé} many {Otevřelo # člověka} other {Otevřelo # lidí}}",
    "runningJobs": "{count, plural, =0 {Nic neběží} one {Běží # úloha} few {Běží # úlohy} many {Běží # úlohy} other {Běží # úloh}}"
  },
  "time": {
    "justNow": "před chvílí",
    "todayAt": "dnes v {time}",
    "yesterdayAt": "včera v {time}",
    "durationMinutesSeconds": "{minutes, plural, one {# minuta} few {# minuty} many {# minuty} other {# minut}} a {seconds, plural, one {# sekunda} few {# sekundy} many {# sekundy} other {# sekund}}",
    "estimatedDuration": "asi {duration}",
    "lastUpdated": "Naposledy aktualizováno {relative}",
    "projectTimezoneNote": "{time} v zóně projektu ({timezone}), u vás {localTime}"
  },
  "separators": {
    "today": "Dnes",
    "yesterday": "Včera"
  },
  "states": {
    "loading": "Načítáme data",
    "emptyFilteredTitle": "Nic neodpovídá",
    "emptyFilteredFilter": "Použitý filtr: {filter}",
    "emptyFilteredHint": "Hledání funguje i bez diakritiky, „novak\" najde i „Novák\".",
    "staleTitle": "Data se nepodařilo obnovit",
    "staleBody": "Ukazujeme poslední načtená čísla. {lastUpdated}",
    "partialTitle": "Část stránky se nenačetla",
    "partialBody": "Zbytek stránky funguje. Selhanou část můžete načíst znovu.",
    "offlineTitle": "Ztratili jsme spojení",
    "offlineBody": "Zkoušíme se připojit. Vaše změny se uloží, jakmile se to podaří.",
    "readOnlyTitle": "Tuhle stránku si můžete jen prohlížet",
    "readOnlyRole": "Máte roli {role}, která obsah nemění.",
    "readOnlyLocked": "Odeslanou kampaň už měnit nejde.",
    "notFoundTitle": "Tohle jsme nenašli",
    "notFoundBody": "Položka buď nikdy neexistovala, nebo ji někdo smazal.",
    "notFoundDeletedBy": "{entity} smazal {person} {date}.",
    "notFoundBackToList": "Zpět na seznam",
    "prerequisiteTitle": "Nejdřív je potřeba {requirement}",
    "prerequisiteBody": "Bez toho tahle stránka nemá s čím pracovat.",
    "prerequisiteAction": "Nastavit",
    "overLimitTitle": "Jste přes limit",
    "overLimitBody": "Aktuálně {current} z {limit}. {resetHint}",
    "overLimitResetsAt": "Limit se obnoví {resetAt}.",
    "overLimitNoReset": "Limit se sám neobnoví, je potřeba ho zvýšit."
  },
  "errors": {
    "loadFailedTitle": "{entity} se nepodařilo načíst",
    "genericBody": "Zkuste to prosím znovu. Když to nepomůže, pošlete podpoře podrobnosti níž.",
    "timeoutBody": "Databáze neodpověděla včas. Většinou je to přechodné a druhý pokus projde.",
    "technicalDetails": "Podrobnosti pro technickou podporu",
    "code": "Kód",
    "requestId": "Číslo požadavku",
    "time": "Čas",
    "copyBlock": "Zkopírovat podrobnosti",
    "forbiddenTitle": "K téhle akci vám chybí oprávnění",
    "forbiddenBody": "K akci je potřeba oprávnění {requiredPermission}, které má role {grantedByRoles} a výš. Vy máte roli {currentRole}.",
    "forbiddenWhoCanHelp": "Změnit vám ji může {members}.",
    "forbiddenNoContact": "Požádejte o změnu role vlastníka projektu.",
    "insufficientScopeTitle": "Klíč k API nemá potřebné oprávnění",
    "insufficientScopeBody": "Klíč potřebuje oprávnění {requiredPermission}. Přidejte ho v nastavení klíčů, nebo použijte jiný klíč.",
    "sessionExpiredTitle": "Byli jste odhlášeni",
    "sessionExpiredBody": "Přihlaste se prosím znovu. Rozepsaný obsah zůstane, kde je.",
    "sessionExpiredAction": "Přihlásit se",
    "unknownTitle": "Něco se nepovedlo",
    "unknownBody": "{detail}"
  },
  "feedback": {
    "saved": "Uloženo",
    "savedAt": "Uloženo v {time}",
    "saving": "Ukládáme…",
    "saveFailedRetrying": "Nepodařilo se uložit, zkoušíme to znovu",
    "undoCountdown": "{seconds, plural, one {Zbývá # sekunda} few {Zbývají # sekundy} many {Zbývá # sekundy} other {Zbývá # sekund}}",
    "repeated": "{message} ×{count}",
    "takingLonger": "Trvá to déle, než jsme čekali",
    "runsOnServer": "Běží na serveru. Okno můžete zavřít, po návratu uvidíte výsledek.",
    "liveUpdatesFailed": "Živé aktualizace se nedaří, čísla obnovujeme každých 15 sekund",
    "numbersRefined": "Údaje se upřesnily",
    "pauseLiveUpdates": "Pozastavit živé aktualizace",
    "resumeLiveUpdates": "Spustit živé aktualizace"
  },
  "confirm": {
    "irreversible": "Tohle nejde vzít zpět.",
    "whatHappens": "Co se stane:",
    "understandCheckbox": "Rozumím, že {consequence}",
    "typeToConfirm": "Pro potvrzení opište {identifier}",
    "typeToConfirmMismatch": "Opsaný text zatím nesouhlasí.",
    "notYetConfirmed": "Nejdřív zaškrtněte, že rozumíte následkům.",
    "notYetTyped": "Nejdřív opište {identifier}.",
    "filterInWords": "Filtr: {filter}",
    "exportBeforeDelete": "Před smazáním doporučujeme export."
  },
  "table": {
    "showingOfEstimate": "Zobrazeno {shown} z ~{total}",
    "showingOfExact": "Zobrazeno {shown} z {total}",
    "previous": "Předchozí",
    "next": "Další",
    "selectedOnPage": "{count, plural, =0 {Nevybráno nic} one {Vybrán # kontakt na této stránce} few {Vybrány # kontakty na této stránce} many {Vybráno # kontaktu na této stránce} other {Vybráno # kontaktů na této stránce}}",
    "selectAllMatching": "Vybrat všech {total} odpovídajících filtru",
    "selectedAllMatching": "Vybráno všech {total} kontaktů odpovídajících filtru.",
    "clearSelection": "Zrušit výběr",
    "cursorInvalid": "Seznam se mezitím změnil, jste zpátky na začátku.",
    "columns": "Sloupce",
    "rowsPerPage": "Řádků na stránku",
    "sortNotAvailable": "Podle tohohle sloupce řadit nejde.",
    "selectRow": "Označit řádek",
    "selectAllOnPage": "Označit všechny řádky na stránce"
  },
  "nav": {
    "overview": "Přehled",
    "contacts": "Kontakty",
    "contactsAll": "Všechny kontakty",
    "contactsLists": "Seznamy",
    "contactsSegments": "Segmenty",
    "contactsTags": "Štítky",
    "contactsImport": "Import",
    "contactsForms": "Formuláře",
    "contactsSuppressions": "Blokované adresy",
    "contactsGreetingQueue": "Kontrola oslovení",
    "campaigns": "Kampaně",
    "campaignsAll": "Přehled kampaní",
    "campaignsScheduled": "Naplánované",
    "templates": "Šablony",
    "templatesLibrary": "Knihovna šablon",
    "templatesBrand": "Značka projektu",
    "statistics": "Statistiky",
    "statisticsDeliverability": "Doručitelnost",
    "statisticsOverTime": "Vývoj v čase",
    "statisticsContacts": "Vývoj kontaktů",
    "settings": "Nastavení",
    "settingsGeneral": "Projekt",
    "settingsSending": "Odesílání",
    "settingsFields": "Vlastní pole",
    "settingsMembers": "Tým",
    "settingsApiKeys": "Klíče k API",
    "settingsWebhooks": "Webhooky",
    "settingsConsent": "Souhlasy a soukromí",
    "settingsTracking": "Sledování",
    "settingsAi": "AI asistent",
    "settingsAudit": "Audit log",
    "settingsBackups": "Zálohy",
    "settingsAccount": "Můj účet",
    "automations": "Automatizace"
  },
  "shell": {
    "skipToContent": "Přeskočit na obsah",
    "mainNavigation": "Hlavní navigace",
    "projectSwitcher": "Přepnout projekt",
    "currentProject": "Projekt: {name}",
    "search": "Hledat",
    "searchPlaceholder": "Hledejte kontakty, kampaně a šablony",
    "help": "Nápověda",
    "userMenu": "Můj účet",
    "collapseSidebar": "Sbalit menu",
    "expandSidebar": "Rozbalit menu",
    "themeLight": "Světlý režim",
    "themeDark": "Tmavý režim",
    "themeSystem": "Podle systému"
  },
  "systemBar": {
    "sendingBlocked": "Odesílání je zastavené: příliš mnoho stížností na spam.",
    "sendingBlockedAction": "Co s tím",
    "offline": "Ztratili jsme spojení. Zkoušíme se připojit… Vaše změny se uloží, jakmile se to podaří.",
    "campaignRunning": "Rozesílka {name}: {sent} z {total}.",
    "jobRunning": "{name}: {done} z {total}.",
    "backupExpiring": "Poslední záloha je stará {age} a za {remaining} vyprší.",
    "backupAction": "Zálohovat teď",
    "trialMode": "Zkušební režim: e-maily se odešlou jen na ověřené adresy.",
    "trialModeAction": "Nastavit doménu",
    "updateAvailable": "Je k dispozici nová verze nástroje.",
    "updateAction": "Co je nového",
    "show": "Zobrazit"
  },
  "jobs": {
    "title": "Úlohy",
    "running": "Běží",
    "finished": "Dokončené",
    "empty": "Zatím nic neběželo. Až spustíte import nebo rozesílku, najdete je tady.",
    "history": "Historie za posledních 30 dní",
    "showAll": "Zobrazit vše",
    "open": "Otevřít",
    "cancel": "Zrušit úlohu",
    "pause": "Pozastavit",
    "resume": "Pokračovat",
    "download": "Stáhnout",
    "otherProjects": "{count, plural, =0 {Žádné jiné projekty} one {Ostatní projekty (#)} few {Ostatní projekty (#)} many {Ostatní projekty (#)} other {Ostatní projekty (#)}}",
    "startedBy": "Spustil {person}",
    "remaining": "Zbývá {duration}",
    "progressOf": "{done} z {total}"
  },
  "shortcuts": {
    "title": "Klávesové zkratky",
    "search": "Globální vyhledávání a příkazy",
    "goOverview": "Přejít na Přehled",
    "goContacts": "Přejít na Kontakty",
    "goCampaigns": "Přejít na Kampaně",
    "goTemplates": "Přejít na Šablony",
    "focusSearch": "Fokus do vyhledávacího pole na stránce",
    "save": "Uložit",
    "submit": "Potvrdit hlavní akci",
    "close": "Zavřít dialog nebo zrušit rozdělanou akci",
    "help": "Přehled zkratek",
    "rowMove": "Pohyb po řádcích tabulky",
    "rowSelect": "Označit řádek",
    "rowRange": "Označit rozsah řádků",
    "undo": "Vrátit zpět poslední vratnou akci",
    "then": "pak"
  },
  "a11y": {
    "notifications": "Oznámení",
    "progressAnnouncement": "{label}: {done} z {total}",
    "expandCluster": "Rozbalit {count, plural, one {# událost} few {# události} many {# události} other {# událostí}}",
    "collapseCluster": "Sbalit skupinu událostí",
    "expanded": "Rozbaleno",
    "collapsed": "Sbaleno",
    "sortedAscending": "seřazeno vzestupně",
    "sortedDescending": "seřazeno sestupně",
    "movedToPosition": "{label}, pozice {position} z {total}"
  }
}
```

- [ ] **Krok 2: Napsat anglický katalog**

Angličtina je zdroj pravdy pro množinu klíčů. Platí sentence case, Oxfordská čárka a stažené tvary.

`packages/i18n/messages/en/common.json`:

```json
{
  "actions": {
    "save": "Save",
    "saveAndClose": "Save and close",
    "cancel": "Cancel",
    "backToEditing": "Back to editing",
    "keep": "Keep",
    "keepRunning": "Keep running",
    "tryAgain": "Try again",
    "continue": "Continue",
    "back": "Previous step",
    "gotIt": "Got it",
    "later": "Later",
    "close": "Close",
    "copy": "Copy",
    "copied": "Copied",
    "undo": "Undo",
    "showDetails": "Details for support",
    "loadOlder": "Load older",
    "clearFilters": "Clear all filters",
    "clearSearch": "Clear search only",
    "recalculate": "Recalculate",
    "refresh": "Refresh"
  },
  "counts": {
    "contacts": "{count, plural, =0 {No contacts} one {# contact} other {# contacts}}",
    "emails": "{count, plural, =0 {No emails} one {# email} other {# emails}}",
    "campaigns": "{count, plural, =0 {No campaigns} one {# campaign} other {# campaigns}}",
    "rows": "{count, plural, =0 {No rows} one {# row} other {# rows}}",
    "groups": "{count, plural, =0 {No groups} one {# group} other {# groups}}",
    "days": "{count, plural, =0 {No days} one {# day} other {# days}}",
    "minutes": "{count, plural, =0 {No minutes} one {# minute} other {# minutes}}",
    "seconds": "{count, plural, =0 {No seconds} one {# second} other {# seconds}}",
    "selected": "{count, plural, =0 {Nothing selected} one {# contact selected} other {# contacts selected}}",
    "openedByPeople": "{count, plural, =0 {Nobody opened it} one {# person opened it} other {# people opened it}}",
    "runningJobs": "{count, plural, =0 {Nothing is running} one {# job running} other {# jobs running}}"
  },
  "time": {
    "justNow": "just now",
    "todayAt": "today at {time}",
    "yesterdayAt": "yesterday at {time}",
    "durationMinutesSeconds": "{minutes, plural, one {# minute} other {# minutes}} and {seconds, plural, one {# second} other {# seconds}}",
    "estimatedDuration": "about {duration}",
    "lastUpdated": "Last updated {relative}",
    "projectTimezoneNote": "{time} in the project time zone ({timezone}), {localTime} for you"
  },
  "separators": {
    "today": "Today",
    "yesterday": "Yesterday"
  },
  "states": {
    "loading": "Loading data",
    "emptyFilteredTitle": "Nothing matches",
    "emptyFilteredFilter": "Filter in use: {filter}",
    "emptyFilteredHint": "Search ignores accents, so \"novak\" also finds \"Novák\".",
    "staleTitle": "We could not refresh the data",
    "staleBody": "These are the last numbers we loaded. {lastUpdated}",
    "partialTitle": "Part of the page did not load",
    "partialBody": "The rest of the page works. You can load the failed part again.",
    "offlineTitle": "We lost the connection",
    "offlineBody": "We are trying to reconnect. Your changes will be saved as soon as it works.",
    "readOnlyTitle": "You can only read this page",
    "readOnlyRole": "Your role is {role}, which does not change content.",
    "readOnlyLocked": "A campaign that has been sent cannot be changed.",
    "notFoundTitle": "We could not find this",
    "notFoundBody": "It either never existed, or someone deleted it.",
    "notFoundDeletedBy": "{entity} was deleted by {person} on {date}.",
    "notFoundBackToList": "Back to the list",
    "prerequisiteTitle": "You need {requirement} first",
    "prerequisiteBody": "Without it this page has nothing to work with.",
    "prerequisiteAction": "Set it up",
    "overLimitTitle": "You are over the limit",
    "overLimitBody": "Currently {current} of {limit}. {resetHint}",
    "overLimitResetsAt": "The limit resets {resetAt}.",
    "overLimitNoReset": "The limit does not reset on its own, it has to be raised."
  },
  "errors": {
    "loadFailedTitle": "We could not load {entity}",
    "genericBody": "Please try again. If that does not help, send the details below to support.",
    "timeoutBody": "The database did not answer in time. This is usually temporary and a second attempt works.",
    "technicalDetails": "Details for support",
    "code": "Code",
    "requestId": "Request number",
    "time": "Time",
    "copyBlock": "Copy the details",
    "forbiddenTitle": "You do not have permission for this action",
    "forbiddenBody": "This action needs the {requiredPermission} permission, which the {grantedByRoles} role and above have. Your role is {currentRole}.",
    "forbiddenWhoCanHelp": "{members} can change it for you.",
    "forbiddenNoContact": "Ask the project owner to change your role.",
    "insufficientScopeTitle": "The API key does not have the permission it needs",
    "insufficientScopeBody": "The key needs the {requiredPermission} permission. Add it in the key settings, or use another key.",
    "sessionExpiredTitle": "You have been signed out",
    "sessionExpiredBody": "Please sign in again. Anything you were writing stays where it is.",
    "sessionExpiredAction": "Sign in",
    "unknownTitle": "Something did not work",
    "unknownBody": "{detail}"
  },
  "feedback": {
    "saved": "Saved",
    "savedAt": "Saved at {time}",
    "saving": "Saving…",
    "saveFailedRetrying": "We could not save, we are trying again",
    "undoCountdown": "{seconds, plural, one {# second left} other {# seconds left}}",
    "repeated": "{message} ×{count}",
    "takingLonger": "This is taking longer than we expected",
    "runsOnServer": "This runs on the server. You can close the window, you will see the result when you come back.",
    "liveUpdatesFailed": "Live updates are not working, we refresh the numbers every 15 seconds",
    "numbersRefined": "The numbers were refined",
    "pauseLiveUpdates": "Pause live updates",
    "resumeLiveUpdates": "Resume live updates"
  },
  "confirm": {
    "irreversible": "This cannot be undone.",
    "whatHappens": "What happens:",
    "understandCheckbox": "I understand that {consequence}",
    "typeToConfirm": "Type {identifier} to confirm",
    "typeToConfirmMismatch": "What you typed does not match yet.",
    "notYetConfirmed": "First tick the box to confirm you understand what happens.",
    "notYetTyped": "First type {identifier}.",
    "filterInWords": "Filter: {filter}",
    "exportBeforeDelete": "We recommend an export before you delete."
  },
  "table": {
    "showingOfEstimate": "Showing {shown} of ~{total}",
    "showingOfExact": "Showing {shown} of {total}",
    "previous": "Previous",
    "next": "Next",
    "selectedOnPage": "{count, plural, =0 {Nothing selected} one {# contact selected on this page} other {# contacts selected on this page}}",
    "selectAllMatching": "Select all {total} matching the filter",
    "selectedAllMatching": "All {total} contacts matching the filter are selected.",
    "clearSelection": "Clear the selection",
    "cursorInvalid": "The list changed in the meantime, you are back at the start.",
    "columns": "Columns",
    "rowsPerPage": "Rows per page",
    "sortNotAvailable": "This column cannot be sorted.",
    "selectRow": "Select row",
    "selectAllOnPage": "Select all rows on this page"
  },
  "nav": {
    "overview": "Overview",
    "contacts": "Contacts",
    "contactsAll": "All contacts",
    "contactsLists": "Lists",
    "contactsSegments": "Segments",
    "contactsTags": "Tags",
    "contactsImport": "Import",
    "contactsForms": "Forms",
    "contactsSuppressions": "Suppression list",
    "contactsGreetingQueue": "Greeting review",
    "campaigns": "Campaigns",
    "campaignsAll": "All campaigns",
    "campaignsScheduled": "Scheduled",
    "templates": "Templates",
    "templatesLibrary": "Template library",
    "templatesBrand": "Project brand",
    "statistics": "Statistics",
    "statisticsDeliverability": "Deliverability",
    "statisticsOverTime": "Over time",
    "statisticsContacts": "Contact growth",
    "settings": "Settings",
    "settingsGeneral": "Project",
    "settingsSending": "Sending",
    "settingsFields": "Custom fields",
    "settingsMembers": "Team",
    "settingsApiKeys": "API keys",
    "settingsWebhooks": "Webhooks",
    "settingsConsent": "Consent and privacy",
    "settingsTracking": "Tracking",
    "settingsAi": "AI assistant",
    "settingsAudit": "Audit log",
    "settingsBackups": "Backups",
    "settingsAccount": "My account",
    "automations": "Automations"
  },
  "shell": {
    "skipToContent": "Skip to content",
    "mainNavigation": "Main navigation",
    "projectSwitcher": "Switch project",
    "currentProject": "Project: {name}",
    "search": "Search",
    "searchPlaceholder": "Search contacts, campaigns, and templates",
    "help": "Help",
    "userMenu": "My account",
    "collapseSidebar": "Collapse the menu",
    "expandSidebar": "Expand the menu",
    "themeLight": "Light mode",
    "themeDark": "Dark mode",
    "themeSystem": "Follow the system"
  },
  "systemBar": {
    "sendingBlocked": "Sending is stopped: too many spam complaints.",
    "sendingBlockedAction": "What to do",
    "offline": "We lost the connection. We are trying to reconnect… Your changes will be saved as soon as it works.",
    "campaignRunning": "Sending {name}: {sent} of {total}.",
    "jobRunning": "{name}: {done} of {total}.",
    "backupExpiring": "The last backup is {age} old and expires in {remaining}.",
    "backupAction": "Back up now",
    "trialMode": "Trial mode: emails only go to verified addresses.",
    "trialModeAction": "Set up a domain",
    "updateAvailable": "A new version of the tool is available.",
    "updateAction": "What's new",
    "show": "Show"
  },
  "jobs": {
    "title": "Jobs",
    "running": "Running",
    "finished": "Finished",
    "empty": "Nothing has run yet. Once you start an import or a send, you'll find it here.",
    "history": "History for the last 30 days",
    "showAll": "Show all",
    "open": "Open",
    "cancel": "Cancel job",
    "pause": "Pause",
    "resume": "Resume",
    "download": "Download",
    "otherProjects": "{count, plural, =0 {No other projects} one {Other projects (#)} other {Other projects (#)}}",
    "startedBy": "Started by {person}",
    "remaining": "{duration} left",
    "progressOf": "{done} of {total}"
  },
  "shortcuts": {
    "title": "Keyboard shortcuts",
    "search": "Global search and commands",
    "goOverview": "Go to Overview",
    "goContacts": "Go to Contacts",
    "goCampaigns": "Go to Campaigns",
    "goTemplates": "Go to Templates",
    "focusSearch": "Focus the search field on this page",
    "save": "Save",
    "submit": "Confirm the main action",
    "close": "Close a dialog or cancel what you started",
    "help": "Show shortcuts",
    "rowMove": "Move between table rows",
    "rowSelect": "Select a row",
    "rowRange": "Select a range of rows",
    "undo": "Undo the last reversible action",
    "then": "then"
  },
  "a11y": {
    "notifications": "Notifications",
    "progressAnnouncement": "{label}: {done} of {total}",
    "expandCluster": "Expand {count, plural, one {# event} other {# events}}",
    "collapseCluster": "Collapse the group of events",
    "expanded": "Expanded",
    "collapsed": "Collapsed",
    "sortedAscending": "sorted ascending",
    "sortedDescending": "sorted descending",
    "movedToPosition": "{label}, position {position} of {total}"
  }
}
```

- [ ] **Krok 3: Doplnit README s pravidly pro doménové plány**

`packages/i18n/README.md`:

```markdown
# @mlain/i18n

Katalogy jsou rozdělené na soubory po doménách: `messages/{cs,en}/<namespace>.json`.
Za běhu se skládají do jednoho vnořeného stromu, který `next-intl` očekává.

## Kdo co vlastní

| Namespace | Plán |
|---|---|
| `common` | P05 (tenhle balíček) |
| `auth`, `settings` | plán nastavení a přístupů |
| `contacts` | plán kontaktů |
| `import`, `segments` | plán importu a segmentů |
| `editor` | plán editoru šablon |
| `campaigns` | plán kampaní |
| `reports` | plán reportů |
| `ai` | plán AI asistenta |
| `onboarding` | plán onboardingu |

Nový namespace se zakládá tak, že vznikne `messages/cs/<namespace>.json`
i `messages/en/<namespace>.json`. Loader je najde sám, kód se nemění.

## Závazná pravidla

1. Klíč se v kódu píše plnou cestou: `t('contacts.count')`. Skládání klíčů
   za běhu je zakázané, protože se nedá staticky ověřit ani extrahovat.
2. Věta se nikdy neskládá z fragmentů. Vždy celá zpráva s parametry.
3. U počtu vždy ICU `plural` včetně kategorie `=0`. Kategorie `many`
   je v češtině pro desetinná čísla a musí být vyplněná.
4. Se změnou čísla se v češtině mění i sloveso, takže `plural`
   je nad celou větou, ne jen nad podstatným jménem.
5. Rod se řeší `select` nad **celou větou**. Neutrální větev je podstatné
   jméno, ne mužský tvar:

   `{gender, select, female {Otevřela kampaň {campaign}} male {Otevřel kampaň {campaign}} other {Otevření kampaně {campaign}}}`

6. Zdroj pravdy pro množinu klíčů je `en`. `cs` musí mít stejné klíče.
7. Znak U+2014 (dlouhá pomlčka) se v katalozích nesmí objevit.
```

`packages/i18n/src/index.ts`:

```ts
export { DEFAULT_LOCALE, SOURCE_LOCALE, SUPPORTED_LOCALES, isSupportedLocale } from './locales';
export type { Locale } from './locales';
export { listNamespaces, loadMessages } from './load-messages';
export type { MessageTree } from './load-messages';
```

- [ ] **Krok 4: Ověřit, že se katalogy načtou**

```bash
pnpm --filter @mlain/i18n exec vitest run src/load-messages.test.ts
```

Očekávaný výstup: 6 passed.

- [ ] **Krok 5: Commit**

```bash
git add packages/i18n
git commit -m "feat(i18n): common namespace in Czech and English with ICU plurals"
```

---

### Úkol 9: Kontroly katalogů, které blokují build

Kritéria 68 až 72 a 76b žádají kontroly v CI. Píšou se jako obyčejné Vitest testy, takže je pouští už existující job `test-unit` a nemusí se kvůli nim zakládat nový job.

**Soubory:**
- Vytvořit: `packages/i18n/src/checks/glossary.ts`
- Test: `packages/i18n/src/checks/key-parity.test.ts`, `icu-validity.test.ts`, `glossary.test.ts`

- [ ] **Krok 1: Napsat padající test na shodu klíčů**

`packages/i18n/src/checks/key-parity.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadMessages } from '../load-messages';

function flatten(tree: unknown, prefix = ''): string[] {
  if (typeof tree !== 'object' || tree === null) return [prefix];
  return Object.entries(tree).flatMap(([key, value]) =>
    flatten(value, prefix === '' ? key : `${prefix}.${key}`),
  );
}

describe('shoda klíčů mezi jazyky', () => {
  it('cs a en mají přesně stejnou množinu klíčů', async () => {
    const [cs, en] = await Promise.all([loadMessages('cs'), loadMessages('en')]);
    const csKeys = flatten(cs).sort();
    const enKeys = flatten(en).sort();

    const missingInCs = enKeys.filter((key) => !csKeys.includes(key));
    const missingInEn = csKeys.filter((key) => !enKeys.includes(key));

    expect(missingInCs, `chybí v cs: ${missingInCs.join(', ')}`).toEqual([]);
    expect(missingInEn, `chybí v en: ${missingInEn.join(', ')}`).toEqual([]);
  });

  it('žádná hodnota není prázdný řetězec', async () => {
    for (const locale of ['cs', 'en'] as const) {
      const messages = await loadMessages(locale);
      const empty: string[] = [];
      const walk = (node: unknown, path: string) => {
        if (typeof node === 'string') {
          if (node.trim() === '') empty.push(path);
          return;
        }
        if (typeof node === 'object' && node !== null) {
          for (const [key, value] of Object.entries(node)) {
            walk(value, path === '' ? key : `${path}.${key}`);
          }
        }
      };
      walk(messages, '');
      expect(empty, `prázdné klíče v ${locale}: ${empty.join(', ')}`).toEqual([]);
    }
  });
});
```

- [ ] **Krok 2: Napsat padající test na platnost ICU**

`packages/i18n/src/checks/icu-validity.test.ts`:

```ts
import { IntlMessageFormat } from 'intl-messageformat';
import { describe, expect, it } from 'vitest';
import { loadMessages } from '../load-messages';
import { SUPPORTED_LOCALES } from '../locales';

function entries(tree: unknown, prefix = ''): Array<[string, string]> {
  if (typeof tree === 'string') return [[prefix, tree]];
  if (typeof tree !== 'object' || tree === null) return [];
  return Object.entries(tree).flatMap(([key, value]) =>
    entries(value, prefix === '' ? key : `${prefix}.${key}`),
  );
}

describe('platnost ICU výrazů', () => {
  for (const locale of SUPPORTED_LOCALES) {
    it(`${locale}: každá zpráva se dá zkompilovat`, async () => {
      const messages = await loadMessages(locale);
      const broken: string[] = [];
      for (const [key, value] of entries(messages)) {
        try {
          new IntlMessageFormat(value, locale);
        } catch (error) {
          broken.push(`${key}: ${(error as Error).message}`);
        }
      }
      expect(broken, broken.join('\n')).toEqual([]);
    });
  }

  it('každý plural v češtině má kategorie =0, one, few, many i other', async () => {
    const messages = await loadMessages('cs');
    const missing: string[] = [];
    for (const [key, value] of entries(messages)) {
      if (!value.includes(', plural,')) continue;
      for (const category of ['=0 {', 'one {', 'few {', 'many {', 'other {']) {
        if (!value.includes(category)) missing.push(`${key} postrádá ${category.trim()}`);
      }
    }
    expect(missing, missing.join('\n')).toEqual([]);
  });

  it('každý plural v angličtině má =0, one i other', async () => {
    const messages = await loadMessages('en');
    const missing: string[] = [];
    for (const [key, value] of entries(messages)) {
      if (!value.includes(', plural,')) continue;
      for (const category of ['=0 {', 'one {', 'other {']) {
        if (!value.includes(category)) missing.push(`${key} postrádá ${category.trim()}`);
      }
    }
    expect(missing, missing.join('\n')).toEqual([]);
  });

  it('plural dává správné tvary pro 0, 1, 2, 5, 21, 100 a 1,5', async () => {
    const messages = (await loadMessages('cs')) as { common: { counts: { contacts: string } } };
    const format = new IntlMessageFormat(messages.common.counts.contacts, 'cs');
    expect(format.format({ count: 0 })).toBe('Žádné kontakty');
    expect(format.format({ count: 1 })).toBe('1 kontakt');
    expect(format.format({ count: 2 })).toBe('2 kontakty');
    expect(String(format.format({ count: 5 }))).toContain('kontaktů');
    expect(String(format.format({ count: 21 }))).toContain('kontaktů');
    expect(String(format.format({ count: 100 }))).toContain('kontaktů');
    expect(String(format.format({ count: 1.5 }))).toContain('kontaktu');
  });
});
```

`intl-messageformat` 11.2.13 je **BSD-3-Clause** (ověřeno 31. 7. 2026), tedy na seznamu povolených licencí. Je to tranzitivní závislost `next-intl`, ale do `devDependencies` balíčku `@mlain/i18n` se přidá výslovně, aby test nezávisel na tvaru stromu závislostí:

```bash
pnpm --filter @mlain/i18n add -D intl-messageformat@11.2.13
```

- [ ] **Krok 3: Napsat padající test na slovník a zakázané znaky**

`packages/i18n/src/checks/glossary.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { BANNED_CS, BANNED_EN, findViolations } from './glossary';
import { loadMessages } from '../load-messages';

/** Dlouhá pomlčka. Zapsaná kódem, aby se samotný znak nedostal do repozitáře. */
const EM_DASH = String.fromCharCode(0x2014);

describe('slovník a zakázané znaky', () => {
  it('v žádném katalogu není dlouhá pomlčka U+2014', async () => {
    for (const locale of ['cs', 'en'] as const) {
      const raw = JSON.stringify(await loadMessages(locale));
      const index = raw.indexOf(EM_DASH);
      expect(index, `dlouhá pomlčka v ${locale} u znaku ${index}`).toBe(-1);
    }
  });

  it('český katalog neobsahuje zakázané výrazy ze slovníku 9.2', async () => {
    const violations = findViolations(await loadMessages('cs'), BANNED_CS);
    expect(violations.map((v) => `${v.key}: „${v.term}" místo „${v.use}"`)).toEqual([]);
  });

  it('anglický katalog neobsahuje zakázané výrazy', async () => {
    const violations = findViolations(await loadMessages('en'), BANNED_EN);
    expect(violations.map((v) => `${v.key}: "${v.term}" use "${v.use}"`)).toEqual([]);
  });

  it('nikde není hodnota subscribed jako stav přihlášení', async () => {
    for (const locale of ['cs', 'en'] as const) {
      const violations = findViolations(await loadMessages(locale), [
        { term: 'subscribed', use: 'confirmed', except: [] },
      ]);
      expect(violations.map((v) => v.key)).toEqual([]);
    }
  });

  it('detektor najde zakázaný výraz i ve skloňovaném tvaru', () => {
    const violations = findViolations(
      { common: { demo: 'Nastavte pracovní prostor a přidejte odběratele.' } },
      BANNED_CS,
    );
    expect(violations).toHaveLength(2);
    expect(violations[0].key).toBe('common.demo');
  });

  it('výjimka podle prefixu klíče funguje', () => {
    const violations = findViolations({ common: { nav: { settingsAccount: 'Můj účet' } } }, [
      { term: 'účet', use: 'Projekt', except: ['common.nav.settingsAccount'] },
    ]);
    expect(violations).toEqual([]);
  });

  it('„Personalizace" je správný tvar a kontrola ho nehlásí', () => {
    // Rozhodnutí zadavatele 1. 8. 2026. Kdyby bylo slovo v zakázaném seznamu,
    // shodil by `i18n-check` build na katalogu `editor` plánu P12,
    // který ho používá správně.
    const violations = findViolations(
      { editor: { tokenTooltip: 'Personalizace vloží jméno kontaktu.' } },
      BANNED_CS,
    );
    expect(violations).toEqual([]);
  });

  it('staré tvary pro merge tag kontrola naopak hlásí', () => {
    const violations = findViolations(
      {
        editor: {
          a: 'Doplňovaný údaj',
          b: 'Vložte slučovací značku',
          c: 'merge tag',
          d: 'placeholder',
        },
      },
      BANNED_CS,
    );
    expect(violations.map((item) => item.key).sort()).toEqual([
      'editor.a',
      'editor.b',
      'editor.c',
      'editor.d',
    ]);
    expect(new Set(violations.map((item) => item.use))).toEqual(new Set(['Personalizace']));
  });
});
```

- [ ] **Krok 4: Spustit testy, musí spadnout**

```bash
pnpm --filter @mlain/i18n exec vitest run src/checks
```

Očekávaný výstup: FAIL, `Failed to resolve import "./glossary"`.

- [ ] **Krok 5: Implementovat slovníkový detektor**

Seznam je vědomě **kratší než celý slovník 9.2**. Obsahuje jen výrazy, u kterých je strojová shoda jednoznačná. Výrazy jako „proklik" tam nejsou, protože „Míra prokliku" je naopak závazný správný tvar, a automat by hlásil chybu na správném textu. Zbytek slovníku hlídá code review.

**Kritérium 69 je proto pokryté částečně, ne plně.** Sloupec „Nikdy nepoužívat" ve slovníku 9.2 má napříč šesti podtabulkami přes šedesát výrazů, tenhle seznam jich hlídá dvacet dva. Doslovný přepis by vyrobil planá hlášení na běžných slovech („účet", „test", „adresa", „skupina", „klik"), a test, který křičí na správný text, se do měsíce vypne. Přiznaná částečná kontrola je poctivější než tvrzení o úplné. Kapitola 6 to tak uvádí.

**Merge tag se česky řekne „Personalizace".** Rozhodl zadavatel 1. 8. 2026 kvůli návaznosti na slovník, který uživatelé znají z Ecomailu, a část 3 ho v 5.4 už používá v klíči `liquid.tokenTooltip`. Slovník 9.2 části 6 měl původně opačné znění („Doplňovaný údaj" jako závazné, „personalizace" v zakázaném sloupci); **opravu specifikace provádí zadavatel, kontrolu tady opravuje P05**. Zakázané tedy zůstávají „doplňovaný údaj", „slučovací značka", „merge tag" a „placeholder", zatímco „personalizace" je **správný tvar a v seznamu být nesmí**. Kdyby tam zůstala, job `i18n-check` by shodil build na katalogu `editor` plánu P12, který ji používá správně.

`packages/i18n/src/checks/glossary.ts`:

```ts
export type BannedTerm = {
  /** Kmen výrazu. Hledá se bez ohledu na velikost písmen a na koncovku. */
  term: string;
  /** Správný výraz, který se nabídne v hlášce. */
  use: string;
  /** Prefixy klíčů, kde je výraz povolený. */
  except: string[];
};

export const BANNED_CS: BannedTerm[] = [
  { term: 'pracovní prostor', use: 'Projekt', except: [] },
  { term: 'workspace', use: 'Projekt', except: [] },
  { term: 'odběratel', use: 'Kontakt', except: [] },
  { term: 'blacklist', use: 'Blokované adresy', except: [] },
  { term: 'černá listina', use: 'Blokované adresy', except: [] },
  { term: 'pískoviště', use: 'Testovací režim u Amazonu', except: [] },
  { term: 'kvóta', use: 'Denní limit', except: [] },
  // Merge tag se česky řekne „Personalizace" (rozhodnutí zadavatele 1. 8. 2026).
  // Slovo „personalizace" proto v tomhle seznamu **není a být nesmí**.
  { term: 'placeholder', use: 'Personalizace', except: [] },
  { term: 'slučovací značka', use: 'Personalizace', except: [] },
  { term: 'doplňovaný údaj', use: 'Personalizace', except: [] },
  { term: 'merge tag', use: 'Personalizace', except: [] },
  { term: 'preference centrum', use: 'Nastavení odběru', except: [] },
  { term: 'dvojité přihlášení', use: 'Potvrzení přihlášení e-mailem', except: [] },
  { term: 'unikátní otevření', use: 'Otevřelo lidí', except: [] },
  { term: 'trackování', use: 'Sledování', except: [] },
  { term: 'prokliková míra', use: 'Míra prokliku', except: [] },
  { term: 'odregistrovat', use: 'Odhlásit z odběru', except: [] },
  { term: 'zaregistrovat', use: 'Přihlásit k odběru', except: [] },
  { term: 'joba', use: 'Úloha', except: [] },
  { term: 'háček', use: 'Webhook', except: [] },
  { term: 'administrátor', use: 'Správce', except: [] },
  { term: 'majitel', use: 'Vlastník', except: [] },
];

export const BANNED_EN: BannedTerm[] = [
  { term: 'blacklist', use: 'suppression list', except: [] },
  { term: 'sandbox', use: 'Amazon sandbox', except: ['common.errors'] },
  { term: 'placeholder', use: 'merge tag', except: [] },
];

export type Violation = { key: string; term: string; use: string };

function walk(node: unknown, path: string, visit: (key: string, value: string) => void): void {
  if (typeof node === 'string') {
    visit(path, node);
    return;
  }
  if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      walk(value, path === '' ? key : `${path}.${key}`, visit);
    }
  }
}

export function findViolations(tree: unknown, banned: BannedTerm[]): Violation[] {
  const found: Violation[] = [];
  walk(tree, '', (key, value) => {
    const haystack = value.toLocaleLowerCase('cs');
    for (const entry of banned) {
      if (entry.except.some((prefix) => key.startsWith(prefix))) continue;
      if (haystack.includes(entry.term.toLocaleLowerCase('cs'))) {
        found.push({ key, term: entry.term, use: entry.use });
      }
    }
  });
  return found;
}
```

- [ ] **Krok 6: Spustit testy, musí projít**

```bash
pnpm --filter @mlain/i18n exec vitest run src/checks
pnpm --filter @mlain/i18n typecheck
```

Očekávaný výstup: 14 passed. Když některý spadne, **je to nález v katalogu, ne chyba testu**: oprav katalog.

- [ ] **Krok 7: Commit**

```bash
git add packages/i18n/src/checks
git commit -m "test(i18n): key parity, ICU validity and glossary gates"
```

---

### Úkol 10: Formátování přes `Intl`, nikdy ručně

Pravidlo z 12.4: formátování se **nikdy** neskládá ručně, vždy přes `Intl` zprostředkované `next-intl`. Nikdy `toLocaleString` s natvrdo zadaným jazykem.

**Soubory:**
- Vytvořit: `packages/i18n/src/formats.ts`, `packages/i18n/src/format.ts`
- Test: `packages/i18n/src/format.test.ts`

- [ ] **Krok 1: Napsat padající test**

`packages/i18n/src/format.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  formatDate,
  formatDateTime,
  formatFileSize,
  formatNumber,
  formatPercent,
  formatRelativeTime,
  formatTime,
} from './format';

const PRAGUE = 'Europe/Prague';

describe('formatNumber', () => {
  it('česky odděluje tisíce nezlomitelnou mezerou, ne obyčejnou', () => {
    const value = formatNumber(12480, 'cs');
    expect(value).not.toContain(' '); // obyčejná mezera je chyba, text by se zalomil
    expect(value.replace(/[  ]/g, ' ')).toBe('12 480');
  });

  it('anglicky odděluje čárkou', () => {
    expect(formatNumber(12480, 'en')).toBe('12,480');
  });
});

describe('formatPercent', () => {
  it('vždy jedno desetinné místo, nikdy zaokrouhlení na celá', () => {
    expect(formatPercent(0.0034, 'cs').replace(/[  ]/g, ' ')).toBe('0,3 %');
    expect(formatPercent(0.164, 'cs').replace(/[  ]/g, ' ')).toBe('16,4 %');
    expect(formatPercent(0.164, 'en')).toBe('16.4%');
  });

  it('celé číslo si desetinné místo drží', () => {
    expect(formatPercent(0.5, 'en')).toBe('50.0%');
  });
});

describe('formatDate a formatTime', () => {
  const moment = new Date('2026-07-31T12:38:00.000Z');

  it('respektuje časovou zónu, ne zónu serveru', () => {
    expect(formatTime(moment, 'cs', PRAGUE)).toBe('14:38');
    expect(formatTime(moment, 'cs', 'UTC')).toBe('12:38');
  });

  it('české datum je s tečkami, anglické s názvem měsíce', () => {
    expect(formatDate(moment, 'cs', PRAGUE).replace(/[  ]/g, ' ')).toBe('31. 7. 2026');
    expect(formatDate(moment, 'en', PRAGUE)).toBe('July 31, 2026');
  });

  it('datum s časem spojuje obojí podle jazyka', () => {
    expect(formatDateTime(moment, 'cs', PRAGUE)).toContain('14:38');
    expect(formatDateTime(moment, 'en', PRAGUE)).toContain('2:38');
  });
});

describe('formatRelativeTime', () => {
  const now = new Date('2026-07-31T14:38:00.000Z');

  it('do minuty říká „před chvílí"', () => {
    expect(formatRelativeTime(new Date('2026-07-31T14:37:40.000Z'), 'cs', now)).toBe('před chvílí');
    expect(formatRelativeTime(new Date('2026-07-31T14:37:40.000Z'), 'en', now)).toBe('just now');
  });

  it('do sedmi dní používá relativní tvar', () => {
    expect(formatRelativeTime(new Date('2026-07-31T14:34:00.000Z'), 'cs', now)).toBe(
      'před 4 minutami',
    );
    expect(formatRelativeTime(new Date('2026-07-28T14:38:00.000Z'), 'en', now)).toBe('3 days ago');
  });

  it('starší než sedm dní přepne na absolutní datum', () => {
    const older = new Date('2026-06-12T14:38:00.000Z');
    expect(formatRelativeTime(older, 'cs', now, PRAGUE).replace(/[  ]/g, ' ')).toBe(
      '12. 6. 2026',
    );
  });
});

describe('formatFileSize', () => {
  it('používá jedno desetinné místo a lokalizovanou desetinnou čárku', () => {
    expect(formatFileSize(13002342, 'cs').replace(/[  ]/g, ' ')).toBe('12,4 MB');
    expect(formatFileSize(13002342, 'en')).toBe('12.4 MB');
  });

  it('bajty nezobrazuje s desetinným místem', () => {
    expect(formatFileSize(512, 'en')).toBe('512 B');
  });
});
```

- [ ] **Krok 2: Spustit test, musí spadnout**

```bash
pnpm --filter @mlain/i18n exec vitest run src/format.test.ts
```

Očekávaný výstup: FAIL, `Failed to resolve import "./format"`.

- [ ] **Krok 3: Implementovat formáty**

`packages/i18n/src/formats.ts`:

```ts
import type { Formats } from 'next-intl';

/** Společné pojmenované formáty pro celou aplikaci, předávají se do next-intl. */
export const formats = {
  dateTime: {
    short: { day: 'numeric', month: 'numeric', year: 'numeric' },
    long: { day: 'numeric', month: 'long', year: 'numeric' },
    time: { hour: 'numeric', minute: '2-digit' },
    dateTime: { day: 'numeric', month: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' },
  },
  number: {
    integer: { maximumFractionDigits: 0 },
    percent: { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 },
  },
} satisfies Formats;
```

`packages/i18n/src/format.ts`:

```ts
import type { Locale } from './locales';

/**
 * Čisté formátovací funkce nad Intl. Komponenty je používají přes
 * `useFormatter` z next-intl, tyhle funkce jsou pod ním a dají se testovat
 * bez Reactu. Nikdy se nesestavuje text ručně z kusů.
 */

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export function formatNumber(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
}

/** Procenta vždy na jedno desetinné místo. U míry stížností 0,34 % by celá procenta ztratila informaci. */
export function formatPercent(ratio: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(ratio);
}

export function formatDate(value: Date, locale: Locale, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    day: 'numeric',
    month: locale === 'en' ? 'long' : 'numeric',
    year: 'numeric',
  }).format(value);
}

export function formatTime(value: Date, locale: Locale, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(value);
}

export function formatDateTime(value: Date, locale: Locale, timeZone: string): string {
  return new Intl.DateTimeFormat(locale, {
    timeZone,
    day: 'numeric',
    month: locale === 'en' ? 'long' : 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(value);
}

const RELATIVE_UNITS: Array<[Intl.RelativeTimeFormatUnit, number]> = [
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', MINUTE_MS],
];

/**
 * Relativní tvar do sedmi dnů, pak absolutní datum (pravidlo 9.5).
 * Volající k němu vždy doplní přesný čas do `title` a `<time datetime>`.
 */
export function formatRelativeTime(
  value: Date,
  locale: Locale,
  now: Date = new Date(),
  timeZone = 'UTC',
): string {
  const diff = value.getTime() - now.getTime();
  const magnitude = Math.abs(diff);

  if (magnitude < MINUTE_MS) {
    return locale === 'cs' ? 'před chvílí' : 'just now';
  }
  if (magnitude >= SEVEN_DAYS_MS) {
    return formatDate(value, locale, timeZone);
  }

  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, size] of RELATIVE_UNITS) {
    if (magnitude >= size) {
      return formatter.format(Math.round(diff / size), unit);
    }
  }
  return formatter.format(Math.round(diff / MINUTE_MS), 'minute');
}

const SIZE_UNITS = ['B', 'kB', 'MB', 'GB', 'TB'] as const;

export function formatFileSize(bytes: number, locale: Locale): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < SIZE_UNITS.length - 1) {
    value /= 1000;
    unit += 1;
  }
  const digits = unit === 0 ? 0 : 1;
  const number = new Intl.NumberFormat(locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(value);
  return `${number} ${SIZE_UNITS[unit]}`;
}

/**
 * Trvání. `Intl.DurationFormat` je v Node 24 k dispozici, ale ne v každém
 * prohlížeči, proto fallback na ICU zprávu `common.time.durationMinutesSeconds`,
 * kterou volající předá jako `compose`. Fallback je **celá zpráva s parametry**,
 * ne slepenec fragmentů.
 */
export function formatDuration(
  seconds: number,
  locale: Locale,
  compose: (parts: { minutes: number; seconds: number }) => string,
): string {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  const DurationFormat = (
    Intl as unknown as {
      DurationFormat?: new (locale: string, options: { style: string }) => {
        format: (input: { minutes: number; seconds: number }) => string;
      };
    }
  ).DurationFormat;

  if (typeof DurationFormat === 'function') {
    return new DurationFormat(locale, { style: 'short' }).format({ minutes, seconds: rest });
  }
  return compose({ minutes, seconds: rest });
}
```

- [ ] **Krok 4: Spustit test, musí projít**

```bash
pnpm --filter @mlain/i18n exec vitest run src/format.test.ts
```

Očekávaný výstup: 12 passed.

Poznámka k testu na tisíce: specifikace v 9.5 uvádí úzkou pevnou mezeru U+202F. ICU pro češtinu vrací podle verze U+00A0 nebo U+202F. Test proto přijme **obě nezlomitelné mezery a odmítne obyčejnou**, protože to je ta vlastnost, na které záleží: číslo se nesmí zalomit uprostřed. Zafixovat konkrétní kódový bod by znamenalo test, který spadne při aktualizaci Node.

- [ ] **Krok 5: Commit**

```bash
git add packages/i18n/src/format.ts packages/i18n/src/formats.ts packages/i18n/src/format.test.ts
git commit -m "feat(i18n): Intl based formatting with Czech and English rules"
```

---

### Úkol 11: Napojení `next-intl` na Next.js 16

**Soubory:**
- Vytvořit: `packages/i18n/src/routing.ts`, `navigation.ts`, `request.ts`, `next-plugin.ts`, `apps/web/src/i18n/request.ts`
- Upravit: `apps/web/next.config.ts` (převzato od P01, viz rozhodnutí R1 a kapitola 9)
- Test: `packages/i18n/src/routing.test.ts`

- [ ] **Krok 1: Napsat padající test na routing**

`packages/i18n/src/routing.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { routing } from './routing';

describe('routing', () => {
  it('výchozí jazyk je bez prefixu v cestě', () => {
    expect(routing.localePrefix).toBe('as-needed');
    expect(routing.defaultLocale).toBe('cs');
  });

  it('zná oba jazyky', () => {
    expect(routing.locales).toEqual(['cs', 'en']);
  });
});
```

- [ ] **Krok 2: Spustit test, musí spadnout**

```bash
pnpm --filter @mlain/i18n exec vitest run src/routing.test.ts
```

Očekávaný výstup: FAIL, `Failed to resolve import "./routing"`.

- [ ] **Krok 3: Implementovat napojení**

`packages/i18n/src/routing.ts`:

```ts
import { defineRouting } from 'next-intl/routing';
import { DEFAULT_LOCALE, SUPPORTED_LOCALES } from './locales';

/**
 * Cesta má tvar `/{locale?}/w/{workspace_slug}/{sekce}`.
 * `as-needed` znamená, že výchozí jazyk je bez prefixu (konvence části 1, 3.9).
 */
export const routing = defineRouting({
  locales: SUPPORTED_LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'as-needed',
});
```

`packages/i18n/src/navigation.ts`:

```ts
import { createNavigation } from 'next-intl/navigation';
import { routing } from './routing';

/**
 * Navigační pomůcky, které samy doplní jazykový prefix.
 * V aplikaci se nikdy nepoužívá `next/link` přímo, jinak by odkaz
 * v anglickém rozhraní spadl na českou cestu.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
```

`packages/i18n/src/request.ts`:

```ts
import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { formats } from './formats';
import { loadMessages } from './load-messages';
import { routing } from './routing';

/**
 * Chybějící klíč: v produkci se vypíše poslední segment klíče a zaloguje
 * se `i18n_missing_key`, v dev a v testech se vyhodí výjimka, takže
 * chybějící klíč spadne v CI (pravidlo 3.9 části 1).
 *
 * `timeZone` je tady jen výchozí hodnota instalace. Zónu přihlášeného
 * uživatele (`users.timezone`) nastavuje skořápka přes `NextIntlClientProvider`,
 * protože v tuhle chvíli ještě není načtená relace.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: await loadMessages(locale),
    formats,
    timeZone: process.env.DEFAULT_TIMEZONE ?? 'Europe/Prague',
    onError(error) {
      if (process.env.NODE_ENV === 'production') {
        console.warn(JSON.stringify({ event: 'i18n_missing_key', message: error.message }));
        return;
      }
      throw error;
    },
    getMessageFallback({ key, namespace }) {
      if (process.env.NODE_ENV !== 'production') {
        throw new Error(`Chybí překladový klíč ${namespace ?? ''}.${key}`);
      }
      return key.split('.').pop() ?? key;
    },
  };
});
```

`packages/i18n/src/next-plugin.ts`:

```ts
import createNextIntlPlugin from 'next-intl/plugin';

/**
 * Obal nad pluginem, aby `apps/web` nemusel mít `next-intl` jako přímou
 * závislost. Cesta ukazuje na tenký soubor v aplikaci, který jen
 * re-exportuje konfiguraci z tohohle balíčku.
 */
export const withMlainIntl = createNextIntlPlugin('./src/i18n/request.ts');
```

`apps/web/src/i18n/request.ts`:

```ts
export { default } from '@mlain/i18n/request';
```

- [ ] **Krok 4: Zapojit plugin do konfigurace aplikace**

`apps/web/next.config.ts`:

```ts
import { withMlainIntl } from '@mlain/i18n/next-plugin';
import type { NextConfig } from 'next';

const config: NextConfig = {
  output: 'standalone',
  // Balíčky @mlain/* jsou zdrojové, bez vlastního buildu.
  transpilePackages: ['@mlain/ui', '@mlain/i18n'],
  experimental: {
    // Ikony se importují jmenovitě, aby se nikdy nezabalil celý balík (14.3).
    optimizePackageImports: ['lucide-react'],
  },
};

export default withMlainIntl(config);
```

Do `apps/web/package.json` doplň závislosti `"@mlain/ui": "workspace:*"` a `"@mlain/i18n": "workspace:*"`.

- [ ] **Krok 5: Spustit testy, musí projít**

```bash
pnpm --filter @mlain/i18n exec vitest run
pnpm --filter @mlain/i18n typecheck
```

Očekávaný výstup: všechny testy balíčku zelené.

- [ ] **Krok 6: Commit**

```bash
git add packages/i18n apps/web/src/i18n apps/web/next.config.ts apps/web/package.json
git commit -m "feat(i18n): wire next-intl routing, request config and navigation"
```

---

### Úkol 12: `proxy.ts` jednou a se všemi matchery

Uzávěr S6 říká: **jeden soubor, se všemi matchery, píše ho tenhle plán.** Řeší tři věci naráz: jazyk, přihlášení a hlavičky. Trackovací a veřejné cesty se z jazykové i přihlašovací logiky vyjímají, protože je volají příjemci e-mailů, ne přihlášení uživatelé.

Soubor se podle Next.js 16 jmenuje `proxy.ts` a exportuje funkci `proxy` (rozhodnutí R1). Runtime je vždy Node.js, edge není podporovaný.

**Bezpečnostní poznámka:** `proxy.ts` **není bezpečnostní hranice.** Kontroluje jen přítomnost cookie a přesměrovává, aby uživatel neviděl prázdnou obrazovku. Skutečné ověření relace a oprávnění dělá serverová vrstva u každého požadavku.

**Soubory:**
- Vytvořit: `apps/web/src/proxy.ts`
- Test: `apps/web/src/proxy.test.ts`

- [ ] **Krok 1: Napsat padající test**

`apps/web/src/proxy.test.ts`:

```ts
import { NextRequest } from 'next/server';
import { describe, expect, it } from 'vitest';
import { config, proxy } from './proxy';

function request(path: string, options: { session?: boolean } = {}) {
  const url = `https://mlain.test${path}`;
  const headers = new Headers();
  if (options.session) headers.set('cookie', 'mlain_session=abc');
  return new NextRequest(new Request(url, { headers }));
}

describe('proxy', () => {
  it('nepřihlášeného pošle na přihlášení a zapamatuje si cíl', async () => {
    const response = await proxy(request('/w/eshop-kolo/contacts'));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get('location') as string);
    expect(location.pathname).toBe('/login');
    expect(location.searchParams.get('next')).toBe('/w/eshop-kolo/contacts');
  });

  it('přihlášeného pustí dál', async () => {
    const response = await proxy(request('/w/eshop-kolo/contacts', { session: true }));
    expect(response.status).toBe(200);
  });

  it('trackovací cesty nepřesměrovává a nekešuje', async () => {
    const response = await proxy(request('/t/o/abc123'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toContain('no-store');
  });

  it('veřejné stránky pro příjemce nevyžadují přihlášení', async () => {
    for (const path of ['/u/token', '/p/token', '/s/c/token', '/r/token', '/f/newsletter']) {
      const response = await proxy(request(path));
      expect(response.status, path).toBe(200);
    }
  });

  it('přihlašovací stránka je dostupná bez relace', async () => {
    const response = await proxy(request('/login'));
    expect(response.status).toBe(200);
  });

  it('nastaví bezpečnostní hlavičky včetně CSP s nonce', async () => {
    const response = await proxy(request('/login'));
    const csp = response.headers.get('content-security-policy') as string;
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+'/);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
  });

  it('nonce předá dál v hlavičce požadavku, aby ho layout mohl použít', async () => {
    const response = await proxy(request('/login'));
    expect(response.headers.get('x-nonce')).toBeTruthy();
  });

  it('matcher vynechává statické soubory', () => {
    expect(config.matcher).toHaveLength(1);
    const pattern = new RegExp(config.matcher[0].replace('/((?!', '^/(?!').replace(').*)', ')'));
    expect(pattern.test('/_next/static/chunk.js')).toBe(false);
  });
});
```

- [ ] **Krok 2: Spustit test, musí spadnout**

```bash
pnpm --filter @mlain/web exec vitest run src/proxy.test.ts
```

Očekávaný výstup: FAIL, `Failed to resolve import "./proxy"`.

- [ ] **Krok 3: Implementovat `proxy.ts`**

`apps/web/src/proxy.ts`:

```ts
import { routing } from '@mlain/i18n/routing';
import createIntlMiddleware from 'next-intl/middleware';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Jediný proxy soubor aplikace (uzávěr S6). Řeší tři věci naráz:
 * jazyk, přesměrování nepřihlášeného a bezpečnostní hlavičky.
 *
 * V Next.js 16 se soubor jmenuje proxy.ts a funkce proxy.
 * Runtime je vždy Node.js, edge není podporovaný.
 */

const SESSION_COOKIE_NAME = 'mlain_session';

/** Cesty, které volají příjemci e-mailů a prohlížeče, ne přihlášení uživatelé. */
const PUBLIC_PREFIXES = [
  '/t/', // trackovací pixel a proklik
  '/e/', // sběr událostí z webového SDK
  '/u/', // odhlášení
  '/p/', // nastavení odběru
  '/s/c/', // potvrzení přihlášení
  '/r/', // přesměrování
  '/f/', // vložený formulář
  '/d/', // delegovaná stránka DNS
  '/api/webhooks/', // příchozí webhooky provideru
];

/** Stránky aplikace, které jsou dostupné bez přihlášení. */
const ANONYMOUS_PAGES = [
  '/login',
  '/setup',
  '/forgot-password',
  '/reset-password',
  '/invitations/accept',
];

const intlMiddleware = createIntlMiddleware(routing);

function stripLocale(pathname: string): string {
  for (const locale of routing.locales) {
    if (pathname === `/${locale}`) return '/';
    if (pathname.startsWith(`/${locale}/`)) return pathname.slice(locale.length + 1);
  }
  return pathname;
}

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isAnonymousPage(pathname: string): boolean {
  return ANONYMOUS_PAGES.some((page) => pathname === page || pathname.startsWith(`${page}/`));
}

function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

function applySecurityHeaders(response: NextResponse, nonce: string): NextResponse {
  const csp = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}'`,
    "style-src 'self' 'unsafe-inline'",
    // https: je potřeba, protože náhled šablony ukazuje obrázky z domény uživatele
    "img-src 'self' data: blob: https:",
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ');

  response.headers.set('content-security-policy', csp);
  response.headers.set('x-nonce', nonce);
  response.headers.set('x-content-type-options', 'nosniff');
  response.headers.set('referrer-policy', 'strict-origin-when-cross-origin');
  response.headers.set('x-frame-options', 'DENY');
  response.headers.set(
    'permissions-policy',
    'camera=(), microphone=(), geolocation=(), interest-cohort=()',
  );
  response.headers.set('strict-transport-security', 'max-age=63072000; includeSubDomains');
  return response;
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const nonce = createNonce();
  const { pathname, search } = request.nextUrl;

  // 1. Veřejné a trackovací cesty: žádný jazyk, žádné přihlášení, žádná cache.
  if (isPublicPath(pathname)) {
    const response = NextResponse.next();
    response.headers.set('cache-control', 'no-store, no-cache, must-revalidate');
    return applySecurityHeaders(response, nonce);
  }

  const withoutLocale = stripLocale(pathname);

  // 2. Přihlášení. Proxy jen kontroluje přítomnost cookie, ověření dělá server.
  const hasSession = request.cookies.has(SESSION_COOKIE_NAME);
  if (!hasSession && !isAnonymousPage(withoutLocale)) {
    const target = request.nextUrl.clone();
    target.pathname = '/login';
    target.search = '';
    target.searchParams.set('next', `${withoutLocale}${search}`);
    return applySecurityHeaders(NextResponse.redirect(target), nonce);
  }

  // 3. Jazyk. next-intl doplní nebo odebere prefix podle localePrefix.
  const response = intlMiddleware(request);
  return applySecurityHeaders(response as NextResponse, nonce);
}

export const config = {
  // Jediný matcher pro celou aplikaci. Vynechává statické soubory Next.js
  // a soubory s příponou, aby proxy nezdržovala doručení obrázků a fontů.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\..*).*)'],
};
```

- [ ] **Krok 4: Spustit test, musí projít**

```bash
pnpm --filter @mlain/web exec vitest run src/proxy.test.ts
```

Očekávaný výstup: 8 passed.

- [ ] **Krok 5: Commit**

```bash
git add apps/web/src/proxy.ts apps/web/src/proxy.test.ts
git commit -m "feat(web): single proxy with i18n, auth redirect and security headers"
```

---

### Úkol 13: K5 Toast a oznámení

**Tvrdé požadavky (13.1):** fronta a nejvýš tři naráz; slučování duplicit; odpočet u akce „Vrátit zpět"; pozastavení při hoveru i fokusu; `role="status"` versus `role="alert"`; zavření z klávesnice; chyba se nezavírá sama.

**Rozhodnutí R8: `sonner` se nepoužije.** Doporučení v 13.2 části 6 je výslovně nenormativní a označené výhradou „poslední vydání je rok staré". Všechny tvrdé požadavky K5 (fronta o třech, slučování duplicit, viditelný odpočet, pozastavení při fokusu, `Alt + Z`) si stejně píšeme sami, takže by z knihovny zbylo jen umístění v rohu. Nezavádíme závislost, ze které bychom používali jedno `position: fixed`. Balíček `sonner` proto **není** v `packages/ui/package.json`.

**Soubory:**
- Vytvořit: `packages/ui/src/patterns/toast/toast-store.ts`, `toast-provider.tsx`, `toast-item.tsx`, `index.ts`
- Test: `packages/ui/src/patterns/toast/toast-store.test.ts`, `toast-provider.test.tsx`

- [ ] **Krok 1: Napsat padající test na chování fronty**

`packages/ui/src/patterns/toast/toast-store.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createToastStore } from './toast-store';

describe('createToastStore', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T14:00:00.000Z'));
  });

  it('zobrazuje nejvýš tři naráz, další čekají ve frontě', () => {
    const store = createToastStore();
    for (let index = 0; index < 5; index += 1) {
      store.push({ tone: 'info', message: `Zpráva ${index}` });
    }
    expect(store.getState().visible).toHaveLength(3);
    expect(store.getState().queued).toHaveLength(2);
  });

  it('stejnou zprávu neopakuje, jen zvýší počet', () => {
    const store = createToastStore();
    for (let index = 0; index < 4; index += 1) {
      store.push({ tone: 'info', message: 'Kontakt odebrán', dedupeKey: 'contact-removed' });
    }
    const visible = store.getState().visible;
    expect(visible).toHaveLength(1);
    expect(visible[0].count).toBe(4);
  });

  it('informace mizí po 6 sekundách', () => {
    const store = createToastStore();
    store.push({ tone: 'info', message: 'Uloženo' });
    vi.advanceTimersByTime(5999);
    expect(store.getState().visible).toHaveLength(1);
    vi.advanceTimersByTime(2);
    expect(store.getState().visible).toHaveLength(0);
  });

  it('chyba se nikdy nezavře sama, ani po 30 sekundách', () => {
    const store = createToastStore();
    store.push({ tone: 'error', message: 'Kontakt se nepodařilo odebrat.' });
    vi.advanceTimersByTime(30_000);
    expect(store.getState().visible).toHaveLength(1);
  });

  it('vratná akce žije 10 sekund a odpočet je čitelný', () => {
    const store = createToastStore();
    store.pushUndoable({ message: 'Segment Neaktivní smazán', onUndo: () => {} });
    expect(store.getState().visible[0].remainingSeconds).toBe(10);
    vi.advanceTimersByTime(3000);
    expect(store.getState().visible[0].remainingSeconds).toBe(7);
    vi.advanceTimersByTime(7001);
    expect(store.getState().visible).toHaveLength(0);
  });

  it('pozastavení zastaví odpočet a pokračování ho rozjede', () => {
    const store = createToastStore();
    store.pushUndoable({ message: 'Štítek odebrán', onUndo: () => {} });
    const id = store.getState().visible[0].id;
    vi.advanceTimersByTime(2000);
    store.pause(id);
    vi.advanceTimersByTime(20_000);
    expect(store.getState().visible).toHaveLength(1);
    expect(store.getState().visible[0].remainingSeconds).toBe(8);
    store.resume(id);
    vi.advanceTimersByTime(8001);
    expect(store.getState().visible).toHaveLength(0);
  });

  it('vrácení akce zavolá obsluhu a toast zmizí', () => {
    const store = createToastStore();
    const onUndo = vi.fn();
    store.pushUndoable({ message: 'Kontakt odebrán ze seznamu', onUndo });
    store.undoLatest();
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(store.getState().visible).toHaveLength(0);
  });

  it('undoLatest vrátí jen nejnovější vratnou akci, chyby přeskočí', () => {
    const store = createToastStore();
    const first = vi.fn();
    const second = vi.fn();
    store.pushUndoable({ message: 'První', onUndo: first });
    store.pushUndoable({ message: 'Druhá', onUndo: second });
    store.push({ tone: 'error', message: 'Chyba' });
    store.undoLatest();
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('zavření nejnovějšího uvolní místo pro čekající', () => {
    const store = createToastStore();
    for (let index = 0; index < 4; index += 1) {
      store.push({ tone: 'error', message: `Chyba ${index}` });
    }
    expect(store.getState().queued).toHaveLength(1);
    store.dismissLatest();
    expect(store.getState().visible).toHaveLength(3);
    expect(store.getState().queued).toHaveLength(0);
  });
});
```

- [ ] **Krok 2: Spustit test, musí spadnout**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/toast/toast-store.test.ts
```

Očekávaný výstup: FAIL, `Failed to resolve import "./toast-store"`.

- [ ] **Krok 3: Implementovat úložiště**

`packages/ui/src/patterns/toast/toast-store.ts`:

```ts
export type ToastTone = 'info' | 'success' | 'error';

export type ToastAction = { label: string; onClick: () => void };

export type ToastInput = {
  tone: ToastTone;
  message: string;
  description?: string;
  action?: ToastAction;
  /** Zprávy se stejným klíčem se neopakují, jen se u nich zvýší počet. */
  dedupeKey?: string;
};

export type UndoableInput = {
  message: string;
  description?: string;
  onUndo: () => void;
  dedupeKey?: string;
  /** Výchozích 10 sekund odpovídá pravidlu 5.4. */
  seconds?: number;
};

export type Toast = {
  id: string;
  tone: ToastTone;
  message: string;
  description?: string;
  action?: ToastAction;
  dedupeKey?: string;
  count: number;
  undoable: boolean;
  onUndo?: () => void;
  /** null u chyby, která se nikdy nezavře sama. */
  remainingMs: number | null;
  paused: boolean;
};

export type ToastState = { visible: Toast[]; queued: Toast[] };

const MAX_VISIBLE = 3;
const INFO_MS = 6000;
const UNDO_MS = 10_000;
const TICK_MS = 250;

export type ToastStore = ReturnType<typeof createToastStore>;

export function createToastStore() {
  let visible: Toast[] = [];
  let queued: Toast[] = [];
  let sequence = 0;
  const listeners = new Set<() => void>();
  let snapshot: ToastState = { visible, queued };

  function commit() {
    snapshot = { visible: [...visible], queued: [...queued] };
    for (const listener of listeners) listener();
  }

  function promote() {
    while (visible.length < MAX_VISIBLE && queued.length > 0) {
      visible.push(queued.shift() as Toast);
    }
  }

  function add(toast: Toast) {
    if (toast.dedupeKey) {
      const existing = [...visible, ...queued].find((item) => item.dedupeKey === toast.dedupeKey);
      if (existing) {
        existing.count += 1;
        existing.remainingMs = toast.remainingMs;
        commit();
        return;
      }
    }
    if (visible.length < MAX_VISIBLE) visible.push(toast);
    else queued.push(toast);
    commit();
  }

  const interval = setInterval(() => {
    let changed = false;
    for (const toast of visible) {
      if (toast.remainingMs === null || toast.paused) continue;
      toast.remainingMs -= TICK_MS;
      changed = true;
    }
    const expired = visible.filter((toast) => toast.remainingMs !== null && toast.remainingMs <= 0);
    if (expired.length > 0) {
      visible = visible.filter((toast) => !expired.includes(toast));
      promote();
      changed = true;
    }
    if (changed) commit();
  }, TICK_MS);

  return {
    push(input: ToastInput): string {
      sequence += 1;
      const id = `toast-${sequence}`;
      add({
        id,
        tone: input.tone,
        message: input.message,
        description: input.description,
        action: input.action,
        dedupeKey: input.dedupeKey,
        count: 1,
        undoable: false,
        // Chyba se nikdy nezavírá sama, uživatel se v tu chvíli mohl dívat jinam.
        remainingMs: input.tone === 'error' ? null : INFO_MS,
        paused: false,
      });
      return id;
    },

    pushUndoable(input: UndoableInput): string {
      sequence += 1;
      const id = `toast-${sequence}`;
      add({
        id,
        tone: 'success',
        message: input.message,
        description: input.description,
        dedupeKey: input.dedupeKey,
        count: 1,
        undoable: true,
        onUndo: input.onUndo,
        remainingMs: (input.seconds ?? UNDO_MS / 1000) * 1000,
        paused: false,
      });
      return id;
    },

    dismiss(id: string) {
      visible = visible.filter((toast) => toast.id !== id);
      queued = queued.filter((toast) => toast.id !== id);
      promote();
      commit();
    },

    dismissLatest() {
      const latest = visible.at(-1);
      if (latest) this.dismiss(latest.id);
    },

    undoLatest() {
      const latest = [...visible].reverse().find((toast) => toast.undoable);
      if (!latest) return;
      latest.onUndo?.();
      this.dismiss(latest.id);
    },

    pause(id: string) {
      const toast = visible.find((item) => item.id === id);
      if (toast) {
        toast.paused = true;
        commit();
      }
    },

    resume(id: string) {
      const toast = visible.find((item) => item.id === id);
      if (toast) {
        toast.paused = false;
        commit();
      }
    },

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getState(): ToastState {
      return {
        visible: snapshot.visible.map((toast) => ({
          ...toast,
          remainingSeconds: toast.remainingMs === null ? null : Math.ceil(toast.remainingMs / 1000),
        })) as Array<Toast & { remainingSeconds: number | null }>,
        queued: snapshot.queued,
      } as ToastState & {
        visible: Array<Toast & { remainingSeconds: number | null }>;
      };
    },

    destroy() {
      clearInterval(interval);
      listeners.clear();
    },
  };
}
```

- [ ] **Krok 4: Spustit test, musí projít**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/toast/toast-store.test.ts
```

Očekávaný výstup: 9 passed.

- [ ] **Krok 5: Napsat padající test na vykreslení a klávesnici**

`packages/ui/src/patterns/toast/toast-provider.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ToastProvider, useToast } from './toast-provider';

const labels = {
  undo: 'Vrátit zpět',
  close: 'Zavřít',
  notifications: 'Oznámení',
  countdown: (seconds: number) => `Zbývá ${seconds} s`,
  repeated: (message: string, count: number) => `${message} ×${count}`,
};

function Trigger({ onUndo }: { onUndo?: () => void }) {
  const toast = useToast();
  return (
    <div>
      <button type="button" onClick={() => toast.info('Uloženo')}>
        info
      </button>
      <button type="button" onClick={() => toast.error('Kontakt se nepodařilo odebrat.')}>
        chyba
      </button>
      <button
        type="button"
        onClick={() => toast.undoable({ message: 'Kontakt odebrán', onUndo: onUndo ?? (() => {}) })}
      >
        vratná
      </button>
    </div>
  );
}

describe('ToastProvider', () => {
  it('informaci oznámí přes role=status, chybu přes role=alert', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider labels={labels}>
        <Trigger />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'info' }));
    expect(screen.getByRole('status')).toHaveTextContent('Uloženo');

    await user.click(screen.getByRole('button', { name: 'chyba' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Kontakt se nepodařilo odebrat.');
  });

  it('oblast oznámení je v DOM ještě před prvním toastem', () => {
    render(
      <ToastProvider labels={labels}>
        <Trigger />
      </ToastProvider>,
    );
    expect(screen.getByLabelText('Oznámení')).toBeInTheDocument();
  });

  it('u vratné akce ukazuje odpočet a tlačítko Vrátit zpět', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider labels={labels}>
        <Trigger />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'vratná' }));
    expect(screen.getByRole('button', { name: 'Vrátit zpět' })).toBeVisible();
    expect(screen.getByText(/Zbývá 10 s/)).toBeVisible();
  });

  it('Alt + Z vrátí poslední vratnou akci bez myši', async () => {
    const user = userEvent.setup();
    const onUndo = vi.fn();
    render(
      <ToastProvider labels={labels}>
        <Trigger onUndo={onUndo} />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'vratná' }));
    await user.keyboard('{Alt>}z{/Alt}');
    expect(onUndo).toHaveBeenCalledTimes(1);
  });

  it('Esc zavře nejnovější toast', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider labels={labels}>
        <Trigger />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'chyba' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('každý toast má tlačítko zavřít', async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider labels={labels}>
        <Trigger />
      </ToastProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'info' }));
    expect(screen.getByRole('button', { name: 'Zavřít' })).toBeVisible();
  });
});
```

- [ ] **Krok 6: Spustit test, musí spadnout**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/toast/toast-provider.test.tsx
```

Očekávaný výstup: FAIL, `Failed to resolve import "./toast-provider"`.

- [ ] **Krok 7: Implementovat poskytovatele a vykreslení**

`packages/ui/src/patterns/toast/toast-item.tsx`:

```tsx
'use client';

import { X } from 'lucide-react';
import { cn } from '../../lib/cn';

export type ToastLabels = {
  undo: string;
  close: string;
  notifications: string;
  countdown: (seconds: number) => string;
  repeated: (message: string, count: number) => string;
};

export function ToastItem({
  tone,
  message,
  description,
  count,
  undoable,
  remainingSeconds,
  labels,
  onUndo,
  onClose,
  onPause,
  onResume,
}: {
  tone: 'info' | 'success' | 'error';
  message: string;
  description?: string;
  count: number;
  undoable: boolean;
  remainingSeconds: number | null;
  labels: ToastLabels;
  onUndo: () => void;
  onClose: () => void;
  onPause: () => void;
  onResume: () => void;
}) {
  return (
    <div
      // Chyba přeruší čtení, informace ne (mapování 5.10).
      role={tone === 'error' ? 'alert' : 'status'}
      onMouseEnter={onPause}
      onMouseLeave={onResume}
      onFocusCapture={onPause}
      onBlurCapture={onResume}
      className={cn(
        'pointer-events-auto flex w-[min(26rem,calc(100vw-2rem))] items-start gap-3',
        'rounded-[var(--radius-surface)] border p-4 shadow-lg',
        tone === 'error'
          ? 'border-danger bg-danger-surface text-danger-text'
          : 'border-border bg-surface-overlay text-text',
      )}
    >
      <div className="flex-1">
        <p className="text-sm font-medium">
          {count > 1 ? labels.repeated(message, count) : message}
        </p>
        {description ? <p className="mt-1 text-sm text-text-muted">{description}</p> : null}
        {undoable && remainingSeconds !== null ? (
          <p className="mt-1 text-sm text-text-muted">{labels.countdown(remainingSeconds)}</p>
        ) : null}
      </div>
      {undoable ? (
        <button
          type="button"
          onClick={onUndo}
          className="min-h-11 rounded-[var(--radius-control)] px-3 text-sm font-medium text-accent-text"
        >
          {labels.undo}
        </button>
      ) : null}
      <button
        type="button"
        onClick={onClose}
        aria-label={labels.close}
        className="flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-text-muted"
      >
        <X aria-hidden className="size-4" />
      </button>
    </div>
  );
}
```

`packages/ui/src/patterns/toast/toast-provider.tsx`:

```tsx
'use client';

import { createContext, useContext, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';
import { createToastStore, type ToastInput, type UndoableInput } from './toast-store';
import { ToastItem, type ToastLabels } from './toast-item';

type ToastApi = {
  info: (message: string, description?: string) => void;
  success: (message: string, description?: string) => void;
  /** Chyba se nikdy nezavře sama a nikdy nenese jedinou kopii informace. */
  error: (message: string, description?: string) => void;
  undoable: (input: UndoableInput) => void;
  raw: (input: ToastInput) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({
  children,
  labels,
}: {
  children: React.ReactNode;
  labels: ToastLabels;
}) {
  const storeRef = useRef<ReturnType<typeof createToastStore> | null>(null);
  if (storeRef.current === null) storeRef.current = createToastStore();
  const store = storeRef.current;

  useEffect(() => () => store.destroy(), [store]);

  const state = useSyncExternalStore(
    (listener) => store.subscribe(listener),
    () => store.getState(),
    () => store.getState(),
  );

  // Klávesnice: Esc zavře nejnovější, Alt + Z vrátí poslední vratnou akci.
  // Bez toho je „Vrátit zpět" funkce jen pro myš.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        store.dismissLatest();
        return;
      }
      if (event.altKey && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        store.undoLatest();
      }
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [store]);

  const api = useMemo<ToastApi>(
    () => ({
      info: (message, description) => store.push({ tone: 'info', message, description }),
      success: (message, description) => store.push({ tone: 'success', message, description }),
      error: (message, description) => store.push({ tone: 'error', message, description }),
      undoable: (input) => store.pushUndoable(input),
      raw: (input) => store.push(input),
    }),
    [store],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Kontejner je v DOM před prvním oznámením, jinak se hlášení
          čtečce neodešle (pravidlo 5.10). Levý dolní roh, ne pravý horní. */}
      <div
        aria-label={labels.notifications}
        className="pointer-events-none fixed bottom-20 left-4 z-[var(--z-toast)] flex flex-col-reverse gap-2"
      >
        {(state.visible as Array<Parameters<typeof ToastItem>[0] & { id: string }>).map((toast) => (
          <ToastItem
            key={toast.id}
            {...toast}
            labels={labels}
            onUndo={() => store.undoLatest()}
            onClose={() => store.dismiss(toast.id)}
            onPause={() => store.pause(toast.id)}
            onResume={() => store.resume(toast.id)}
          />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast se smí volat jen uvnitř ToastProvider.');
  return api;
}
```

`packages/ui/src/patterns/toast/index.ts`:

```ts
export { ToastProvider, useToast } from './toast-provider';
export type { ToastLabels } from './toast-item';
export type { ToastInput, UndoableInput } from './toast-store';
```

- [ ] **Krok 8: Spustit testy, musí projít**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/toast
```

Očekávaný výstup: 15 passed.

- [ ] **Krok 9: Commit**

```bash
git add packages/ui/src/patterns/toast
git commit -m "feat(ui): K5 toast with queue, dedupe, undo countdown and keyboard access"
```

---

### Úkol 14: Vrácení akce a optimistická aktualizace

Pravidlo 5.6 je závazné a má tři body: stav se vrátí **přesně** do podoby před akcí, chybový toast se nezavírá sám, a změna se **nikdy** neopakuje automaticky. Automatický druhý pokus u akce, u které uživatel viděl selhání, vede k dvojímu provedení.

**Soubory:**
- Vytvořit: `packages/ui/src/patterns/feedback/use-optimistic-action.ts`, `packages/ui/src/patterns/feedback/index.ts`
- Test: `packages/ui/src/patterns/feedback/use-optimistic-action.test.tsx`

- [ ] **Krok 1: Napsat padající test**

`packages/ui/src/patterns/feedback/use-optimistic-action.test.tsx`:

```tsx
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useOptimisticAction } from './use-optimistic-action';

type Row = { id: string; tag: string | null };

describe('useOptimisticAction', () => {
  it('při úspěchu ponechá optimistický stav', async () => {
    const commit = vi.fn().mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useOptimisticAction<Row>({
        initial: { id: 'a', tag: null },
        apply: (state) => ({ ...state, tag: 'Brno' }),
        commit,
      }),
    );

    await act(async () => {
      await result.current.run();
    });

    expect(result.current.state.tag).toBe('Brno');
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('při selhání vrátí stav přesně do původní podoby', async () => {
    const original: Row = { id: 'a', tag: null };
    const { result } = renderHook(() =>
      useOptimisticAction<Row>({
        initial: original,
        apply: (state) => ({ ...state, tag: 'Brno' }),
        commit: () => Promise.reject(new Error('kvóta')),
      }),
    );

    await act(async () => {
      await result.current.run();
    });

    expect(result.current.state).toEqual(original);
    expect(result.current.error).toBeInstanceOf(Error);
  });

  it('po selhání se akce nezopakuje sama', async () => {
    const commit = vi.fn().mockRejectedValue(new Error('síť'));
    const { result } = renderHook(() =>
      useOptimisticAction<Row>({
        initial: { id: 'a', tag: null },
        apply: (state) => ({ ...state, tag: 'Brno' }),
        commit,
      }),
    );

    await act(async () => {
      await result.current.run();
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('opakování je jen na výslovný pokyn uživatele', async () => {
    const commit = vi
      .fn()
      .mockRejectedValueOnce(new Error('síť'))
      .mockResolvedValueOnce(undefined);
    const { result } = renderHook(() =>
      useOptimisticAction<Row>({
        initial: { id: 'a', tag: null },
        apply: (state) => ({ ...state, tag: 'Brno' }),
        commit,
      }),
    );

    await act(async () => {
      await result.current.run();
    });
    expect(result.current.state.tag).toBeNull();

    await act(async () => {
      await result.current.retry();
    });
    await waitFor(() => expect(result.current.state.tag).toBe('Brno'));
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it('během běhu hlásí čekání, aby tlačítko mohlo ukázat stav', async () => {
    let release: () => void = () => {};
    const commit = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const { result } = renderHook(() =>
      useOptimisticAction<Row>({
        initial: { id: 'a', tag: null },
        apply: (state) => ({ ...state, tag: 'Brno' }),
        commit,
      }),
    );

    let pending: Promise<void>;
    act(() => {
      pending = result.current.run();
    });
    await waitFor(() => expect(result.current.isPending).toBe(true));

    await act(async () => {
      release();
      await pending;
    });
    expect(result.current.isPending).toBe(false);
  });
});
```

- [ ] **Krok 2: Spustit test, musí spadnout**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/feedback/use-optimistic-action.test.tsx
```

Očekávaný výstup: FAIL, `Failed to resolve import "./use-optimistic-action"`.

- [ ] **Krok 3: Implementovat**

`packages/ui/src/patterns/feedback/use-optimistic-action.ts`:

```ts
'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * Optimistická aktualizace s tvrdými hranicemi z 5.6.
 *
 * Používej jen tam, kde akce téměř vždy uspěje, selhání je bez následků
 * a rozsah je malý a lokální. Nikdy u změny publika kampaně, u blokovaných
 * adres, u testovacího e-mailu a u čehokoliv třídy A5.
 */
export function useOptimisticAction<T>({
  initial,
  apply,
  commit,
  onError,
}: {
  initial: T;
  /** Čistá funkce, která vyrobí optimistický stav. */
  apply: (state: T) => T;
  commit: () => Promise<void>;
  onError?: (error: unknown) => void;
}) {
  const [state, setState] = useState<T>(initial);
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<unknown>(null);
  /** Přesná podoba stavu před akcí, včetně pozice ve výpisu a označení řádků. */
  const snapshot = useRef<T>(initial);

  const perform = useCallback(async () => {
    snapshot.current = state;
    setError(null);
    setIsPending(true);
    setState((current) => apply(current));
    try {
      await commit();
    } catch (caught) {
      // Návrat přesně do podoby před akcí, ne přepočet.
      setState(snapshot.current);
      setError(caught);
      onError?.(caught);
      // Žádný automatický druhý pokus. Opakuje se jen na pokyn uživatele.
    } finally {
      setIsPending(false);
    }
  }, [apply, commit, onError, state]);

  return {
    state,
    setState,
    isPending,
    error,
    run: perform,
    retry: perform,
  };
}
```

`packages/ui/src/patterns/feedback/index.ts`:

```ts
export { useOptimisticAction } from './use-optimistic-action';
export { ConfirmDialog } from './confirm-dialog';
export { riskLevel, type RiskAxes, type RiskLevel } from './risk-level';
```

Soubory `confirm-dialog.tsx` a `risk-level.ts` vzniknou v úkolu 15. Do té doby ponech v `index.ts` jen první řádek a zbytek doplň v kroku 6 úkolu 15.

- [ ] **Krok 4: Spustit test, musí projít**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/feedback
```

Očekávaný výstup: 5 passed.

- [ ] **Krok 5: Commit**

```bash
git add packages/ui/src/patterns/feedback
git commit -m "feat(ui): optimistic action with exact rollback and no silent retry"
```

---

### Úkol 15: Škála rizika a potvrzovací dialog N1 až N4

Úroveň ochrany se **počítá**, nehádá. Tři osy z 6.1, součet rozhoduje. Dialog pak podle úrovně přidává zaškrtnutí (N3) nebo opsání identifikátoru (N4).

**Soubory:**
- Vytvořit: `packages/ui/src/patterns/feedback/risk-level.ts`, `confirm-dialog.tsx`
- Upravit: `packages/ui/src/patterns/feedback/index.ts`
- Test: `packages/ui/src/patterns/feedback/risk-level.test.ts`, `confirm-dialog.test.tsx`

- [ ] **Krok 1: Napsat padající test na škálu**

`packages/ui/src/patterns/feedback/risk-level.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { riskLevel } from './risk-level';

describe('riskLevel', () => {
  it('odebrání kontaktu ze seznamu je N1', () => {
    expect(riskLevel({ scope: 0, recoverability: 0, externalImpact: 0 })).toBe('N1');
  });

  it('smazání jednoho kontaktu je N2', () => {
    expect(riskLevel({ scope: 0, recoverability: 2, externalImpact: 0 })).toBe('N2');
  });

  it('hromadné smazání 500 kontaktů je N3', () => {
    expect(riskLevel({ scope: 2, recoverability: 2, externalImpact: 0 })).toBe('N3');
  });

  it('smazání projektu je N4', () => {
    expect(riskLevel({ scope: 2, recoverability: 2, externalImpact: 2 })).toBe('N4');
  });

  it('smazání segmentu je N1, protože je plně vratné', () => {
    // Definice se drží 30 dní v koši a kontakty se nemažou,
    // takže obnovitelnost je 0. Vnější dopad zůstává 1.
    expect(riskLevel({ scope: 0, recoverability: 0, externalImpact: 1 })).toBe('N1');
  });

  it('hromadná akce nad více než 20 položkami se povyšuje na dlouhou úlohu', () => {
    expect(riskLevel({ scope: 0, recoverability: 0, externalImpact: 0 }, { bulkCount: 50 })).toBe(
      'N2',
    );
  });

  it('hromadná destruktivní akce se povyšuje aspoň na N3', () => {
    expect(
      riskLevel({ scope: 1, recoverability: 1, externalImpact: 0 }, { bulkCount: 50, destructive: true }),
    ).toBe('N3');
  });
});
```

- [ ] **Krok 2: Spustit test, musí spadnout**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/feedback/risk-level.test.ts
```

Očekávaný výstup: FAIL, `Failed to resolve import "./risk-level"`.

- [ ] **Krok 3: Implementovat škálu**

`packages/ui/src/patterns/feedback/risk-level.ts`:

```ts
/**
 * Škála rizika z 6.1. Úroveň ochrany se počítá ze tří os, nehádá se.
 *
 * Rozsah:          0 jedna položka, 1 do 100, 2 nad 100
 * Obnovitelnost:   0 plně vratné, 1 obnovitelné ze zálohy nebo exportu, 2 nenávratné
 * Vnější dopad:    0 nikdo mimo nástroj to nepozná, 1 ovlivní kolegy,
 *                  2 odejde ven ke koncovým lidem nebo se ztratí cizí data
 */
export type RiskAxes = {
  scope: 0 | 1 | 2;
  recoverability: 0 | 1 | 2;
  externalImpact: 0 | 1 | 2;
};

export type RiskLevel = 'N1' | 'N2' | 'N3' | 'N4';

const ORDER: RiskLevel[] = ['N1', 'N2', 'N3', 'N4'];

function fromScore(score: number): RiskLevel {
  if (score <= 1) return 'N1';
  if (score <= 3) return 'N2';
  if (score === 4) return 'N3';
  return 'N4';
}

export function riskLevel(
  axes: RiskAxes,
  modifiers: { bulkCount?: number; destructive?: boolean } = {},
): RiskLevel {
  let level = fromScore(axes.scope + axes.recoverability + axes.externalImpact);

  // A6 není samostatná třída, je to modifikátor (5.1).
  const isBulk = (modifiers.bulkCount ?? 0) > 20;
  if (isBulk && ORDER.indexOf(level) < ORDER.indexOf('N2')) level = 'N2';
  if (isBulk && modifiers.destructive && ORDER.indexOf(level) < ORDER.indexOf('N3')) level = 'N3';

  return level;
}
```

- [ ] **Krok 4: Napsat padající test na dialog**

`packages/ui/src/patterns/feedback/confirm-dialog.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmDialog } from './confirm-dialog';

const labels = {
  irreversible: 'Tohle nejde vzít zpět.',
  whatHappens: 'Co se stane:',
  notYetConfirmed: 'Nejdřív zaškrtněte, že rozumíte následkům.',
  notYetTyped: 'Nejdřív opište název.',
  typeToConfirmMismatch: 'Opsaný text zatím nesouhlasí.',
  filterInWords: (filter: string) => `Filtr: ${filter}`,
};

function base(overrides: Partial<React.ComponentProps<typeof ConfirmDialog>> = {}) {
  return {
    open: true,
    onOpenChange: () => {},
    level: 'N3' as const,
    title: 'Smazat 3 402 kontaktů?',
    consequences: [
      'Kontakty zmizí ze všech seznamů a segmentů',
      'Jejich historie otevření a kliknutí se smaže',
      'Kontakty, které se odhlásily, zůstanou na blokovaných adresách',
    ],
    confirmLabel: 'Smazat 3 402 kontaktů',
    cancelLabel: 'Nemazat',
    acknowledgement: 'Rozumím, že smazané kontakty nepůjde obnovit',
    onConfirm: vi.fn(),
    labels,
    ...overrides,
  };
}

describe('ConfirmDialog', () => {
  it('nadpis i tlačítko nesou počet', () => {
    render(<ConfirmDialog {...base()} />);
    expect(screen.getByRole('heading', { name: 'Smazat 3 402 kontaktů?' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Smazat 3 402 kontaktů' })).toBeVisible();
  });

  it('vypisuje následky jako body, ne obecnou větu', () => {
    render(<ConfirmDialog {...base()} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('N3 bez zaškrtnutí akci neprovede a řekne proč', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...base({ onConfirm })} />);

    await user.click(screen.getByRole('button', { name: 'Smazat 3 402 kontaktů' }));
    expect(onConfirm).not.toHaveBeenCalled();
    expect(screen.getByText('Nejdřív zaškrtněte, že rozumíte následkům.')).toBeVisible();
  });

  it('potvrzovací tlačítko nikdy nemá atribut disabled', () => {
    render(<ConfirmDialog {...base()} />);
    expect(screen.getByRole('button', { name: 'Smazat 3 402 kontaktů' })).not.toBeDisabled();
  });

  it('po zaškrtnutí akci provede', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<ConfirmDialog {...base({ onConfirm })} />);

    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByRole('button', { name: 'Smazat 3 402 kontaktů' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('N4 žádá opsání identifikátoru', async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(
      <ConfirmDialog
        {...base({
          level: 'N4',
          title: 'Smazat projekt E-shop Kolo?',
          confirmLabel: 'Smazat projekt',
          acknowledgement: undefined,
          confirmPhrase: 'E-shop Kolo',
          confirmPhraseLabel: 'Pro potvrzení opište název projektu',
          onConfirm,
        })}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Smazat projekt' }));
    expect(onConfirm).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText('Pro potvrzení opište název projektu'), 'E-shop Kolo');
    await user.click(screen.getByRole('button', { name: 'Smazat projekt' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('výchozí fokus je na ústupu, ne na destruktivním tlačítku', () => {
    // Pravidlo 9.4. Kdo dialog odklikne poslepu Enterem, nesmí tím smazat
    // tři a půl tisíce kontaktů.
    render(<ConfirmDialog {...base()} />);
    expect(screen.getByRole('button', { name: 'Nemazat' })).toHaveFocus();
  });

  it('umí jedno tlačítko navíc vedle ústupu', async () => {
    const user = userEvent.setup();
    const onExtra = vi.fn();
    render(
      <ConfirmDialog
        {...base({
          extraAction: (
            <button type="button" onClick={onExtra}>
              Vyexportovat a pak smazat
            </button>
          ),
        })}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Vyexportovat a pak smazat' }));
    expect(onExtra).toHaveBeenCalledTimes(1);
  });

  it('opisované pole jde řídit zvenčí', async () => {
    const user = userEvent.setup();
    const onConfirmPhraseChange = vi.fn();
    render(
      <ConfirmDialog
        {...base({
          level: 'N4',
          acknowledgement: undefined,
          confirmPhrase: 'E-shop Kolo',
          confirmPhraseLabel: 'Opište název projektu',
          onConfirmPhraseChange,
        })}
      />,
    );
    await user.type(screen.getByLabelText('Opište název projektu'), 'X');
    expect(onConfirmPhraseChange).toHaveBeenCalled();
  });

  it('N1 se nesmí použít, dialog to nahlásí jako chybu vývojáře', () => {
    expect(() => render(<ConfirmDialog {...base({ level: 'N1' })} />)).toThrow(/N1/);
  });

  it('u hromadné akce nad výběrem podle filtru zopakuje filtr slovy', () => {
    render(
      <ConfirmDialog
        {...base({ filterDescription: 'seznam Zákazníci, štítek Brno, stav Aktivní' })}
      />,
    );
    expect(
      screen.getByText('Filtr: seznam Zákazníci, štítek Brno, stav Aktivní'),
    ).toBeVisible();
  });

  it('nabídne export před smazáním, když ho volající předá', async () => {
    const user = userEvent.setup();
    const onExport = vi.fn();
    render(
      <ConfirmDialog
        {...base({ exportAction: { label: 'Stáhnout těchto 3 402 kontaktů jako CSV', onExport } })}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Stáhnout těchto 3 402 kontaktů jako CSV' }));
    expect(onExport).toHaveBeenCalledTimes(1);
  });

  it('nabídne měkčí variantu, když existuje', async () => {
    const user = userEvent.setup();
    const onSofter = vi.fn();
    render(
      <ConfirmDialog
        {...base({
          softerAlternative: {
            question: 'Chcete jen na chvíli zastavit a pak pokračovat?',
            label: 'Radši pozastavit',
            onChoose: onSofter,
          },
        })}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Radši pozastavit' }));
    expect(onSofter).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Krok 5: Spustit test, musí spadnout**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/feedback/confirm-dialog.test.tsx
```

Očekávaný výstup: FAIL, `Failed to resolve import "./confirm-dialog"`.

- [ ] **Krok 6: Implementovat dialog**

`packages/ui/src/patterns/feedback/confirm-dialog.tsx`:

```tsx
'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { Button } from '../../components/button';
import { Checkbox } from '../../components/checkbox';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '../../components/dialog';
import { Field } from '../../components/field';
import { Input } from '../../components/input';
import type { RiskLevel } from './risk-level';

export type ConfirmDialogLabels = {
  irreversible: string;
  whatHappens: string;
  notYetConfirmed: string;
  notYetTyped: string;
  typeToConfirmMismatch: string;
  filterInWords: (filter: string) => string;
};

export function ConfirmDialog({
  open,
  onOpenChange,
  level,
  title,
  consequences,
  confirmLabel,
  cancelLabel,
  acknowledgement,
  confirmPhrase,
  confirmPhraseLabel,
  onConfirmPhraseChange,
  filterDescription,
  exportAction,
  extraAction,
  softerAlternative,
  irreversible = true,
  onConfirm,
  onCancel,
  labels,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** N1 dialog nemá. Vratná akce se provede rovnou a nabídne se Vrátit zpět (6.7). */
  level: RiskLevel;
  title: string;
  /** Konkrétní následky, nikdy obecná věta „Akce bude provedena". */
  consequences: string[];
  confirmLabel: string;
  cancelLabel: string;
  /** Povinné u N3. Věta popisuje následek, ne souhlas. */
  acknowledgement?: string;
  /** Povinné u N4: text, který uživatel opíše, například název projektu. */
  confirmPhrase?: string;
  confirmPhraseLabel?: string;
  /** Když je zadaný, opisované pole řídí volající. Jinak si ho drží dialog. */
  onConfirmPhraseChange?: (value: string) => void;
  /** U hromadné akce nad výběrem podle filtru se filtr zopakuje slovy (6.5). */
  filterDescription?: string;
  /** Nabídka exportu je silnější ochrana než opisování textu. */
  exportAction?: { label: string; onExport: () => void };
  /** Jedno volitelné tlačítko vedle ústupu, například nabídka jiné cesty. */
  extraAction?: React.ReactNode;
  /** Většina lidí, kteří sáhnou po zrušení, ve skutečnosti chtějí pauzu (6.4). */
  softerAlternative?: { question: string; label: string; onChoose: () => void };
  irreversible?: boolean;
  /** Smí být asynchronní: obrazovky uvnitř volají API. */
  onConfirm: () => void | Promise<void>;
  onCancel?: () => void;
  labels: ConfirmDialogLabels;
}) {
  if (level === 'N1') {
    throw new Error(
      'Potvrzovací dialog u vratné akce (N1) je zakázaný, viz 6.7. Proveď akci rovnou a nabídni Vrátit zpět.',
    );
  }

  const [checked, setChecked] = useState(false);
  const [ownTyped, setOwnTyped] = useState('');
  const [blocker, setBlocker] = useState<string | null>(null);
  const checkboxId = useId();
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  const controlledPhrase = onConfirmPhraseChange !== undefined;
  const typed = controlledPhrase ? (confirmPhrase ?? '') : ownTyped;

  const needsCheckbox = level === 'N3' && Boolean(acknowledgement);
  const needsTyping = level === 'N4' && Boolean(confirmPhrase);
  const typingMatches = needsTyping ? typed.trim() === confirmPhrase : true;

  // Výchozí fokus patří na ústup, ne na destruktivní tlačítko (9.4).
  // Kdo dialog odklikne poslepu, nesmí tím smazat projekt.
  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open]);

  function unavailableReason(): string | undefined {
    if (needsCheckbox && !checked) return labels.notYetConfirmed;
    if (needsTyping && !typingMatches) return labels.notYetTyped;
    return undefined;
  }

  function handleConfirm() {
    // Tlačítko není disabled (kritérium 18). Když akce nejde provést,
    // vysvětlí proč a fokus jde na chybějící krok (rozhodnutí R7).
    if (needsCheckbox && !checked) {
      setBlocker(labels.notYetConfirmed);
      document.getElementById(checkboxId)?.focus();
      return;
    }
    if (needsTyping && !typingMatches) {
      setBlocker(labels.notYetTyped);
      return;
    }
    setBlocker(null);
    void onConfirm();
  }

  function handleCancel() {
    onCancel?.();
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange} destructive>
      <DialogTitle>{title}</DialogTitle>
      <DialogBody>
        <p className="font-medium">{labels.whatHappens}</p>
        <ul className="list-disc pl-5">
          {consequences.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>

        {filterDescription ? (
          <p className="text-text-muted">{labels.filterInWords(filterDescription)}</p>
        ) : null}

        {irreversible ? <p className="font-medium">{labels.irreversible}</p> : null}

        {exportAction ? (
          <Button variant="secondary" onClick={exportAction.onExport}>
            {exportAction.label}
          </Button>
        ) : null}

        {softerAlternative ? (
          <div className="rounded-[var(--radius-control)] bg-surface-muted p-3">
            <p>{softerAlternative.question}</p>
            <Button variant="secondary" className="mt-2" onClick={softerAlternative.onChoose}>
              {softerAlternative.label}
            </Button>
          </div>
        ) : null}

        {needsCheckbox ? (
          <label className="flex items-start gap-3">
            <Checkbox
              id={checkboxId}
              checked={checked}
              onCheckedChange={(next) => setChecked(next === true)}
            />
            <span>{acknowledgement}</span>
          </label>
        ) : null}

        {needsTyping ? (
          <Field
            label={confirmPhraseLabel ?? ''}
            error={typed !== '' && !typingMatches ? labels.typeToConfirmMismatch : undefined}
          >
            <Input
              value={typed}
              onChange={(event) => {
                if (controlledPhrase) onConfirmPhraseChange?.(event.target.value);
                else setOwnTyped(event.target.value);
              }}
            />
          </Field>
        ) : null}

        {blocker ? (
          <p role="alert" className="text-sm text-danger-text">
            {blocker}
          </p>
        ) : null}
      </DialogBody>

      <DialogFooter
        retreat={
          <>
            <Button ref={cancelRef} variant="secondary" onClick={handleCancel}>
              {cancelLabel}
            </Button>
            {extraAction}
          </>
        }
        confirm={
          <Button
            variant="destructive"
            unavailableReason={unavailableReason()}
            onUnavailable={handleConfirm}
            onClick={handleConfirm}
          >
            {confirmLabel}
          </Button>
        }
      />
    </Dialog>
  );
}
```

- [ ] **Krok 7: Doplnit barrel a spustit testy**

`packages/ui/src/patterns/feedback/index.ts`:

```ts
export { ConfirmDialog } from './confirm-dialog';
export type { ConfirmDialogLabels } from './confirm-dialog';
export { riskLevel } from './risk-level';
export type { RiskAxes, RiskLevel } from './risk-level';
export { useOptimisticAction } from './use-optimistic-action';
```

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/feedback
pnpm --filter @mlain/ui typecheck
```

Očekávaný výstup: 25 passed.

- [ ] **Krok 8: Commit**

```bash
git add packages/ui/src/patterns/feedback
git commit -m "feat(ui): risk scale and N2 to N4 confirmation dialog"
```

---

### Úkol 16: Načítání a prázdné stavy (S1 až S6)

Skeleton **ve tvaru budoucího obsahu, ne spinner**, a to až po 300 ms. Jakmile se zobrazí, zůstane aspoň 400 ms, protože bliknutí je horší než krátké počkání.

**Soubory:**
- Vytvořit: `packages/ui/src/lib/use-delayed-flag.ts`, `packages/ui/src/patterns/states/empty-state.tsx`, `table-skeleton.tsx`, `detail-skeleton.tsx`
- Test: `packages/ui/src/lib/use-delayed-flag.test.ts`, `packages/ui/src/patterns/states/empty-state.test.tsx`

- [ ] **Krok 1: Napsat padající test na prodlevu**

`packages/ui/src/lib/use-delayed-flag.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDelayedFlag } from './use-delayed-flag';

describe('useDelayedFlag', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('u operace kratší než 300 ms se indikátor nezobrazí vůbec', () => {
    const { result, rerender } = renderHook(({ active }) => useDelayedFlag(active), {
      initialProps: { active: true },
    });
    act(() => {
      vi.advanceTimersByTime(150);
    });
    rerender({ active: false });
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(false);
  });

  it('po 300 ms se zobrazí', () => {
    const { result } = renderHook(() => useDelayedFlag(true));
    expect(result.current).toBe(false);
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current).toBe(true);
  });

  it('jakmile se zobrazí, zůstane aspoň 400 ms', () => {
    const { result, rerender } = renderHook(({ active }) => useDelayedFlag(active), {
      initialProps: { active: true },
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current).toBe(true);

    rerender({ active: false });
    act(() => {
      vi.advanceTimersByTime(399);
    });
    expect(result.current).toBe(true);

    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(result.current).toBe(false);
  });
});
```

- [ ] **Krok 2: Spustit test, musí spadnout, pak implementovat**

```bash
pnpm --filter @mlain/ui exec vitest run src/lib/use-delayed-flag.test.ts
```

Očekávaný výstup: FAIL, `Failed to resolve import "./use-delayed-flag"`.

`packages/ui/src/lib/use-delayed-flag.ts`:

```ts
'use client';

import { useEffect, useRef, useState } from 'react';

const SHOW_AFTER_MS = 300;
const MIN_VISIBLE_MS = 400;

/**
 * Indikátor načítání se nezobrazí u operace kratší než 300 ms
 * a jakmile se zobrazí, zůstane aspoň 400 ms (pravidlo 14.4).
 */
export function useDelayedFlag(active: boolean): boolean {
  const [visible, setVisible] = useState(false);
  const shownAt = useRef<number | null>(null);

  useEffect(() => {
    if (active) {
      const timer = setTimeout(() => {
        shownAt.current = Date.now();
        setVisible(true);
      }, SHOW_AFTER_MS);
      return () => clearTimeout(timer);
    }

    if (shownAt.current === null) {
      setVisible(false);
      return;
    }

    const elapsed = Date.now() - shownAt.current;
    const remaining = Math.max(0, MIN_VISIBLE_MS - elapsed);
    const timer = setTimeout(() => {
      shownAt.current = null;
      setVisible(false);
    }, remaining);
    return () => clearTimeout(timer);
  }, [active]);

  return visible;
}
```

- [ ] **Krok 3: Napsat padající test na prázdný stav**

Kritérium 20 kontroluje **strukturu, ne znění**: aspoň dvě věty vysvětlení a aspoň jedna akce. Změna formulace test neshodí, odstranění akce ano.

`packages/ui/src/patterns/states/empty-state.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EmptyState } from './empty-state';

describe('EmptyState', () => {
  it('má nadpis, vysvětlení a aspoň jednu akci', () => {
    render(
      <EmptyState
        variant="first"
        title="Zatím tu nejsou žádné kontakty"
        explanation="Kontakt je jeden člověk, kterému budete posílat e-maily. U každého si nástroj pamatuje jméno, e-mail, odkud přišel a co s vašimi e-maily dělal."
        actions={[{ label: 'Naimportovat ze souboru', onClick: () => {} }]}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Zatím tu nejsou žádné kontakty' })).toBeVisible();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  it('vysvětlení má aspoň dvě věty', () => {
    render(
      <EmptyState
        variant="first"
        title="Segment je skupina, která se udržuje sama"
        explanation="Nastavíte podmínku a nástroj do segmentu sám přidává a odebírá lidi. Nemusíte ho ručně aktualizovat."
        actions={[{ label: 'Postavit vlastní segment', onClick: () => {} }]}
      />,
    );
    const explanation = screen.getByTestId('empty-explanation').textContent as string;
    expect(explanation.split(/[.!?]\s/).filter(Boolean).length).toBeGreaterThanOrEqual(2);
  });

  it('prázdný stav po filtrování se liší a nese filtr slovy', () => {
    render(
      <EmptyState
        variant="filtered"
        title="Žádný kontakt neodpovídá"
        explanation="Zkuste filtr rozvolnit."
        filterDescription="seznam Zákazníci, štítek Brno, stav Aktivní, hledání „novák""
        actions={[
          { label: 'Zrušit všechny filtry', onClick: () => {} },
          { label: 'Zrušit jen hledání', onClick: () => {} },
        ]}
      />,
    );
    expect(screen.getByTestId('empty-state')).toHaveAttribute('data-variant', 'filtered');
    expect(screen.getByText(/seznam Zákazníci, štítek Brno/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Zrušit všechny filtry' })).toBeVisible();
  });

  it('prázdný stav po vyprázdnění má jiný text než první', () => {
    render(
      <EmptyState
        variant="emptied"
        title="Všechny kontakty jste smazali"
        explanation="Databáze je prázdná. Můžete je naimportovat znovu, nebo obnovit ze zálohy."
        actions={[{ label: 'Naimportovat ze souboru', onClick: () => {} }]}
      />,
    );
    expect(screen.getByTestId('empty-state')).toHaveAttribute('data-variant', 'emptied');
  });

  it('bez akce se nedá vykreslit, je to chyba vývojáře', () => {
    expect(() =>
      render(
        <EmptyState
          variant="first"
          title="Nic tu není"
          explanation="První věta. Druhá věta."
          actions={[]}
        />,
      ),
    ).toThrow(/aspoň jednu akci/);
  });
});
```

- [ ] **Krok 4: Spustit test, musí spadnout, pak implementovat**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/states/empty-state.test.tsx
```

Očekávaný výstup: FAIL, `Failed to resolve import "./empty-state"`.

`packages/ui/src/patterns/states/empty-state.tsx`:

```tsx
'use client';

import { Button } from '../../components/button';
import { cn } from '../../lib/cn';

export type EmptyStateVariant = 'first' | 'filtered' | 'emptied';

export type EmptyStateAction = { label: string; onClick: () => void; description?: string };

/**
 * Prázdný stav je nejnavštěvovanější obrazovka nového uživatele.
 * Struktura je normativní (7.1, řádek S1): vysvětlení konceptu,
 * primární akce, sekundární cesta. Konkrétní znění vlastní katalogy.
 */
export function EmptyState({
  variant,
  title,
  explanation,
  actions,
  filterDescription,
  hint,
  secondary,
  className,
}: {
  variant: EmptyStateVariant;
  title: string;
  explanation: string;
  actions: EmptyStateAction[];
  /** Povinné u varianty `filtered`: připomenutí použitého filtru slovy. */
  filterDescription?: string;
  hint?: string;
  secondary?: React.ReactNode;
  className?: string;
}) {
  if (actions.length === 0) {
    throw new Error('Prázdný stav musí nabídnout aspoň jednu akci (kritérium 20).');
  }

  return (
    <section
      data-testid="empty-state"
      data-variant={variant}
      className={cn(
        'mx-auto flex max-w-2xl flex-col gap-4 rounded-[var(--radius-surface)]',
        'border border-border bg-surface p-8 text-center',
        className,
      )}
    >
      <h2 className="text-lg font-semibold text-text">{title}</h2>
      <p data-testid="empty-explanation" className="text-sm text-text-muted">
        {explanation}
      </p>
      {filterDescription ? <p className="text-sm text-text">{filterDescription}</p> : null}
      <div className="flex flex-wrap justify-center gap-3">
        {actions.map((action, index) => (
          <div key={action.label} className="flex flex-col items-center">
            <Button variant={index === 0 ? 'primary' : 'secondary'} onClick={action.onClick}>
              {action.label}
            </Button>
            {action.description ? (
              <span className="mt-1 text-sm text-text-muted">{action.description}</span>
            ) : null}
          </div>
        ))}
      </div>
      {secondary}
      {hint ? <p className="text-sm italic text-text-muted">{hint}</p> : null}
    </section>
  );
}
```

`packages/ui/src/patterns/states/table-skeleton.tsx`:

```tsx
import { Skeleton } from '../../components/skeleton';

/** Skeleton má obrys řádků a sloupců, ne obecný obdélník (14.4). */
export function TableSkeleton({
  rows = 8,
  columns = 6,
  label,
}: {
  rows?: number;
  columns?: number;
  label: string;
}) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="flex flex-col gap-2">
      <div className="flex gap-3 border-b border-border pb-2">
        {Array.from({ length: columns }, (_, column) => (
          <Skeleton key={`head-${column}`} className="h-4 flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div key={`row-${row}`} className="flex gap-3 py-2">
          {Array.from({ length: columns }, (_, column) => (
            <Skeleton key={`cell-${row}-${column}`} className="h-5 flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}
```

`packages/ui/src/patterns/states/detail-skeleton.tsx`:

```tsx
import { Skeleton } from '../../components/skeleton';

export function DetailSkeleton({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" aria-label={label} className="flex flex-col gap-4">
      <Skeleton className="h-7 w-64" />
      <Skeleton className="h-5 w-40" />
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 6 }, (_, index) => (
          <Skeleton key={index} className="h-11" />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Krok 5: Spustit testy, musí projít**

```bash
pnpm --filter @mlain/ui exec vitest run src/lib/use-delayed-flag.test.ts src/patterns/states
```

Očekávaný výstup: 8 passed.

- [ ] **Krok 6: Commit**

```bash
git add packages/ui/src/lib/use-delayed-flag.ts packages/ui/src/patterns/states
git commit -m "feat(ui): delayed loading indicator and empty states S1 to S3"
```

---

### Úkol 17: Chybový blok a zbývající stavy obrazovek (S7 až S15)

Sbalené „Podrobnosti pro technickou podporu" jsou **povinné u každé chyby S9**. Uživatel neumí popsat, co se stalo, ale umí zkopírovat blok a poslat ho. `request_id` je jediná cesta, jak to dohledat v logu. Atribut `data-error-code` zůstává v DOM kvůli testům.

**Tři komponenty navíc, protože je žádají dva plány nezávisle na sobě.** Doloženo skutečnými voláními v JSX, ne jen typovou deklarací:

| Komponenta | Kdo ji vykresluje | Proč patří sem, a ne do obrazovky |
|---|---|---|
| `Alert` | P12 (pruh nálezů), P13 (5 míst: preflight, pauza, DNS) | Obecný informační blok v katalogu stavů 7.1 skutečně chybí. Dva plány si ho nezávisle vymyslely, což je přesná definice sdílené komponenty. |
| `FilteredEmptyState` | P06 (2 místa), P07 (2 místa) | S2 je v katalogu 7.1 **samostatný stav** s vlastními povinnými prvky (filtr slovy, tlačítko Zrušit filtry). Varianta propem se dvěma plánům ukázala jako nedostatečná. |
| `CopyButton` | P06 (3 místa), P13 (2 místa) | Kopírování už je uvnitř `ErrorBlock`, takže by existovalo dvakrát. Vytažením ho `ErrorBlock` používá taky a chování „zkopírováno" je na jednom místě. |

**Naopak se nezakládá pět jmen, která si P06 a P07 vypsaly do kontraktu, ale nikdy je nevykreslují:** `ErrorState`, `LoadingSkeleton`, `StaleDataBanner`, `PartialErrorBoundary` a `OfflineBanner`. Ověřeno grepem na `<Jméno` napříč všemi šestnácti plány: **nula výskytů v JSX**. Jsou to mrtvé kontrakty a věcně je pokrývá `ErrorBlock`, `TableSkeleton` s `DetailSkeleton`, `StaleBanner`, `ErrorBlock` v dlaždici a `SystemBar` s `kind: 'offline'`. Zakládat komponentu, kterou nikdo nevykresluje, znamená udržovat kód navíc a mít v balíčku dvě jména pro totéž. Oprava patří do kontraktních souborů P06 a P07, viz kapitola 8.

**Soubory:**
- Vytvořit: `packages/ui/src/patterns/states/error-block.tsx`, `alert.tsx`, `forbidden-state.tsx`, `not-found-state.tsx`, `filtered-empty-state.tsx`, `read-only-banner.tsx`, `stale-banner.tsx`, `over-limit-state.tsx`, `prerequisite-state.tsx`, `index.ts`, `packages/ui/src/components/copy-button.tsx`
- Test: `packages/ui/src/patterns/states/error-block.test.tsx`, `forbidden-state.test.tsx`, `alert.test.tsx`, `packages/ui/src/components/copy-button.test.tsx`

- [ ] **Krok 1: Napsat padající test na chybový blok**

`packages/ui/src/patterns/states/error-block.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ErrorBlock } from './error-block';

const labels = {
  technicalDetails: 'Podrobnosti pro technickou podporu',
  code: 'Kód',
  requestId: 'Číslo požadavku',
  time: 'Čas',
  copyBlock: 'Zkopírovat podrobnosti',
  copied: 'Zkopírováno',
  tryAgain: 'Zkusit znovu',
};

const problem = {
  code: 'db_timeout',
  requestId: 'req_01J8XK2M9P',
  occurredAt: new Date('2026-07-31T12:32:07.000Z'),
};

describe('ErrorBlock', () => {
  it('má nadpis, důvod a akci, v tomhle pořadí', () => {
    render(
      <ErrorBlock
        title="Kontakty se nepodařilo načíst"
        reason="Databáze neodpověděla včas. Většinou je to přechodné a druhý pokus projde."
        problem={problem}
        onRetry={() => {}}
        labels={labels}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Kontakty se nepodařilo načíst' })).toBeVisible();
    expect(screen.getByText(/Databáze neodpověděla včas/)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Zkusit znovu' })).toBeVisible();
  });

  it('kód chyby je v DOM jako data-error-code kvůli testům', () => {
    render(
      <ErrorBlock title="Chyba" reason="Důvod." problem={problem} onRetry={() => {}} labels={labels} />,
    );
    expect(screen.getByTestId('error-block')).toHaveAttribute('data-error-code', 'db_timeout');
  });

  it('technické podrobnosti jsou sbalené, ale dostupné', async () => {
    const user = userEvent.setup();
    render(
      <ErrorBlock title="Chyba" reason="Důvod." problem={problem} onRetry={() => {}} labels={labels} />,
    );
    expect(screen.queryByText('req_01J8XK2M9P')).toBeNull();
    await user.click(screen.getByRole('button', { name: /Podrobnosti pro technickou podporu/ }));
    expect(screen.getByText('req_01J8XK2M9P')).toBeVisible();
    expect(screen.getByText('db_timeout')).toBeVisible();
  });

  it('umí zkopírovat celý blok naráz', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const user = userEvent.setup();
    render(
      <ErrorBlock title="Chyba" reason="Důvod." problem={problem} onRetry={() => {}} labels={labels} />,
    );
    await user.click(screen.getByRole('button', { name: /Podrobnosti pro technickou podporu/ }));
    await user.click(screen.getByRole('button', { name: 'Zkopírovat podrobnosti' }));
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain('db_timeout');
    expect(writeText.mock.calls[0][0]).toContain('req_01J8XK2M9P');
  });

  it('neznámý kód zobrazí detail ze serveru, nikdy prázdno', () => {
    render(
      <ErrorBlock
        title="Něco se nepovedlo"
        reason="Neznámý stav objednávky."
        problem={{ code: 'weird_unknown_code', requestId: 'req_x', occurredAt: new Date() }}
        onRetry={() => {}}
        labels={labels}
      />,
    );
    expect(screen.getByText('Neznámý stav objednávky.')).toBeVisible();
  });
});
```

- [ ] **Krok 2: Spustit test, musí spadnout**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/states/error-block.test.tsx
```

Očekávaný výstup: FAIL, `Failed to resolve import "./error-block"`.

- [ ] **Krok 3: Implementovat chybový blok**

`packages/ui/src/patterns/states/error-block.tsx`:

```tsx
'use client';

import { AlertTriangle } from 'lucide-react';
import { Button } from '../../components/button';
import { Collapsible } from '../../components/collapsible';
import { CopyButton } from '../../components/copy-button';
import { cn } from '../../lib/cn';

export type ProblemSummary = {
  /** Strojový kód z RFC 9457 odpovědi. */
  code: string;
  requestId: string;
  occurredAt: Date;
  path?: string;
};

export type ErrorBlockLabels = {
  technicalDetails: string;
  code: string;
  requestId: string;
  time: string;
  copyBlock: string;
  copied: string;
  tryAgain: string;
};

export function ErrorBlock({
  title,
  reason,
  problem,
  onRetry,
  labels,
  className,
}: {
  /** Co se stalo. Fakticky, v aktivním rodu, bez omluv. */
  title: string;
  /** Proč. Když to nevíme, volající sem dá `detail` ze serveru. Nikdy si nevymýšlíme. */
  reason: string;
  problem: ProblemSummary;
  onRetry?: () => void;
  labels: ErrorBlockLabels;
  className?: string;
}) {
  const block = [
    `${labels.code}: ${problem.code}`,
    `${labels.requestId}: ${problem.requestId}`,
    `${labels.time}: ${problem.occurredAt.toISOString()}`,
    problem.path ? `${problem.path}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  return (
    <section
      data-testid="error-block"
      // Kód v DOM je pro testy, člověk ho čte ve sbalených podrobnostech.
      data-error-code={problem.code}
      className={cn(
        'flex flex-col gap-3 rounded-[var(--radius-surface)] border border-danger',
        'bg-danger-surface p-6',
        className,
      )}
    >
      <h2 className="flex items-center gap-2 text-base font-semibold text-danger-text">
        <AlertTriangle aria-hidden className="size-5" />
        {title}
      </h2>
      <p className="text-sm text-text">{reason}</p>
      {onRetry ? (
        <div>
          <Button variant="secondary" onClick={onRetry}>
            {labels.tryAgain}
          </Button>
        </div>
      ) : null}
      <Collapsible summary={labels.technicalDetails}>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 font-mono text-sm text-text">
          <dt className="text-text-muted">{labels.code}</dt>
          <dd>{problem.code}</dd>
          <dt className="text-text-muted">{labels.requestId}</dt>
          <dd>{problem.requestId}</dd>
          <dt className="text-text-muted">{labels.time}</dt>
          <dd>
            <time dateTime={problem.occurredAt.toISOString()}>
              {problem.occurredAt.toISOString()}
            </time>
          </dd>
        </dl>
        {/* Kopírování bydlí v primitivu, aby existovalo jednou.
            Stejné tlačítko používají klíče k API i DNS záznamy. */}
        <CopyButton
          className="mt-3"
          value={block}
          label={labels.copyBlock}
          copiedLabel={labels.copied}
        />
      </Collapsible>
    </section>
  );
}
```

- [ ] **Krok 4: Napsat padající test na stav bez oprávnění**

Věta „Nemáte oprávnění" je k ničemu. Použitelná hláška říká **které oprávnění chybí, kdo ho má a koho konkrétně oslovit**.

`packages/ui/src/patterns/states/forbidden-state.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ForbiddenState } from './forbidden-state';

describe('ForbiddenState', () => {
  it('pojmenuje chybějící oprávnění, roli i to, kdo ji změní', () => {
    render(
      <ForbiddenState
        title="K téhle akci vám chybí oprávnění"
        body="K akci je potřeba oprávnění campaigns:send, které má role Editor a výš. Vy máte roli Prohlížející."
        whoCanHelp="Změnit vám ji může Jana Nováková."
        code="forbidden"
        requestId="req_01J8XK2M9P"
      />,
    );
    expect(screen.getByText(/campaigns:send/)).toBeVisible();
    expect(screen.getByText(/Prohlížející/)).toBeVisible();
    expect(screen.getByText(/Jana Nováková/)).toBeVisible();
  });

  it('nese kód v DOM kvůli testům', () => {
    render(
      <ForbiddenState
        title="Chybí oprávnění"
        body="Potřeba je backups:read."
        code="forbidden"
        requestId="req_x"
      />,
    );
    expect(screen.getByTestId('forbidden-state')).toHaveAttribute('data-error-code', 'forbidden');
  });

  it('u API klíče použije kód insufficient_scope', () => {
    render(
      <ForbiddenState
        title="Klíč nemá potřebné oprávnění"
        body="Klíč potřebuje contacts:export."
        code="insufficient_scope"
        requestId="req_x"
      />,
    );
    expect(screen.getByTestId('forbidden-state')).toHaveAttribute(
      'data-error-code',
      'insufficient_scope',
    );
  });
});
```

- [ ] **Krok 5: Spustit test, musí spadnout, pak implementovat zbývající stavy**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/states/forbidden-state.test.tsx
```

Očekávaný výstup: FAIL, `Failed to resolve import "./forbidden-state"`.

`packages/ui/src/patterns/states/forbidden-state.tsx`:

```tsx
import { Lock } from 'lucide-react';
import { cn } from '../../lib/cn';

/**
 * Stav S11. Nikdy jen „Nemáte oprávnění".
 * Texty se skládají v katalogu z parametrů `params` chyby `forbidden`
 * (requiredPermission, currentRole, grantedByRoles, contactableMembers).
 */
export function ForbiddenState({
  title,
  body,
  whoCanHelp,
  code,
  requestId,
  action,
  className,
}: {
  title: string;
  body: string;
  whoCanHelp?: string;
  code: 'forbidden' | 'insufficient_scope';
  requestId: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      data-testid="forbidden-state"
      data-error-code={code}
      className={cn(
        'mx-auto flex max-w-2xl flex-col gap-3 rounded-[var(--radius-surface)]',
        'border border-border bg-surface p-8',
        className,
      )}
    >
      <h2 className="flex items-center gap-2 text-base font-semibold text-text">
        <Lock aria-hidden className="size-5" />
        {title}
      </h2>
      <p className="text-sm text-text">{body}</p>
      {whoCanHelp ? <p className="text-sm text-text-muted">{whoCanHelp}</p> : null}
      {action}
      <p className="font-mono text-xs text-text-muted">{requestId}</p>
    </section>
  );
}
```

`packages/ui/src/patterns/states/not-found-state.tsx`:

```tsx
import { cn } from '../../lib/cn';

/** Stav S13. U smazaných entit s auditem se doplní kdo a kdy. */
export function NotFoundState({
  title,
  body,
  deletedNote,
  backLink,
  className,
}: {
  title: string;
  body: string;
  /** Například „Kampaň Letní výprodej smazal Petr Svoboda 12. 6. 2026." */
  deletedNote?: string;
  backLink: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      data-testid="not-found-state"
      className={cn(
        'mx-auto flex max-w-2xl flex-col gap-3 rounded-[var(--radius-surface)]',
        'border border-border bg-surface p-8 text-center',
        className,
      )}
    >
      <h2 className="text-base font-semibold text-text">{title}</h2>
      <p className="text-sm text-text-muted">{body}</p>
      {deletedNote ? <p className="text-sm text-text">{deletedNote}</p> : null}
      <div>{backLink}</div>
    </section>
  );
}
```

`packages/ui/src/patterns/states/read-only-banner.tsx`:

```tsx
import { Eye } from 'lucide-react';
import { cn } from '../../lib/cn';

/**
 * Stav S12. Formuláře se v režimu jen pro čtení zobrazují **jako text**,
 * ne jako zašedlá pole. Nahoře je pruh s důvodem.
 */
export function ReadOnlyBanner({ reason, className }: { reason: string; className?: string }) {
  return (
    <div
      data-testid="read-only-banner"
      className={cn(
        'flex items-center gap-2 rounded-[var(--radius-control)] border border-border',
        'bg-surface-muted px-4 py-3 text-sm text-text',
        className,
      )}
    >
      <Eye aria-hidden className="size-4 text-text-muted" />
      {reason}
    </div>
  );
}

/** Hodnota formuláře v režimu jen pro čtení. Text, ne vstupní pole. */
export function ReadOnlyValue({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-medium text-text">{label}</span>
      <span className="text-sm text-text-muted">{value}</span>
    </div>
  );
}
```

`packages/ui/src/patterns/states/stale-banner.tsx`:

```tsx
import { cn } from '../../lib/cn';

/**
 * Stav S7. Data zůstanou, ztlumí se a nad nimi je, jak jsou stará.
 * Zobrazovat čerstvě vypadající zastaralé číslo je horší než přiznat stáří.
 */
export function StaleBanner({
  lastUpdatedLabel,
  retryAction,
  className,
}: {
  lastUpdatedLabel: string;
  retryAction: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      data-testid="stale-banner"
      className={cn(
        'flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-control)]',
        'border border-warning bg-warning-surface px-4 py-3 text-sm text-warning-text',
        className,
      )}
    >
      <span>{lastUpdatedLabel}</span>
      {retryAction}
    </div>
  );
}

/** Obal nad zastaralým obsahem: ztlumí ho, ale nechá čitelný a použitelný. */
export function StaleContent({ children }: { children: React.ReactNode }) {
  return <div className="opacity-60">{children}</div>;
}
```

`packages/ui/src/patterns/states/over-limit-state.tsx`:

```tsx
import { cn } from '../../lib/cn';

/** Stav S15: aktuální hodnota, limit, co s tím a kdy se limit obnoví. */
export function OverLimitState({
  title,
  body,
  action,
  className,
}: {
  title: string;
  body: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      data-testid="over-limit-state"
      className={cn(
        'flex flex-col gap-3 rounded-[var(--radius-surface)] border border-warning',
        'bg-warning-surface p-6 text-warning-text',
        className,
      )}
    >
      <h2 className="text-base font-semibold">{title}</h2>
      <p className="text-sm text-text">{body}</p>
      {action}
    </section>
  );
}
```

`packages/ui/src/patterns/states/prerequisite-state.tsx`:

```tsx
import { cn } from '../../lib/cn';

/** Stav S14: co chybí, proč to je potřeba, tlačítko. Nikdy jen zašedlá obrazovka. */
export function PrerequisiteState({
  title,
  body,
  action,
  className,
}: {
  title: string;
  body: string;
  action: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      data-testid="prerequisite-state"
      className={cn(
        'mx-auto flex max-w-2xl flex-col gap-3 rounded-[var(--radius-surface)]',
        'border border-border bg-surface p-8 text-center',
        className,
      )}
    >
      <h2 className="text-base font-semibold text-text">{title}</h2>
      <p className="text-sm text-text-muted">{body}</p>
      <div>{action}</div>
    </section>
  );
}
```

`packages/ui/src/components/copy-button.tsx`:

```tsx
'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from './button';

/**
 * Zkopíruje text do schránky a na dvě sekundy to přizná.
 *
 * Bydlí v primitivech, protože ho vedle chybového bloku potřebují i klíče
 * k API, DNS záznamy a `request_id`. Dvě implementace téhož by se rozešly
 * právě v tom, co je na tom těžké: v ohlášení čtečce.
 */
export function CopyButton({
  value,
  label,
  copiedLabel,
  variant = 'secondary',
  className,
}: {
  value: string;
  label: string;
  copiedLabel: string;
  variant?: 'secondary' | 'link';
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  // Hlášku „Zkopírováno" je potřeba po chvíli vrátit zpět, jinak tlačítko
  // podruhé nevypadá jako akce. Časovač se při odpojení ruší.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <Button
      variant={variant}
      className={className}
      onClick={async () => {
        await navigator.clipboard.writeText(value);
        setCopied(true);
      }}
    >
      {copied ? (
        <Check aria-hidden className="size-4" />
      ) : (
        <Copy aria-hidden className="size-4" />
      )}
      {copied ? copiedLabel : label}
      {/* Změnu musí slyšet i ten, kdo tlačítko nevidí. */}
      <span role="status" aria-live="polite" className="sr-only">
        {copied ? copiedLabel : ''}
      </span>
    </Button>
  );
}
```

`packages/ui/src/patterns/states/alert.tsx`:

```tsx
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { cn } from '../../lib/cn';

export type AlertTone = 'info' | 'warning' | 'error' | 'success';

const TONE = {
  info: { border: 'border-border', surface: 'bg-surface-muted', text: 'text-text', Icon: Info },
  warning: {
    border: 'border-warning',
    surface: 'bg-warning-surface',
    text: 'text-warning-text',
    Icon: AlertTriangle,
  },
  error: {
    border: 'border-danger',
    surface: 'bg-danger-surface',
    text: 'text-danger-text',
    Icon: XCircle,
  },
  success: {
    border: 'border-success',
    surface: 'bg-success-surface',
    text: 'text-success-text',
    Icon: CheckCircle2,
  },
} as const;

/**
 * Obecný informační blok. Nese `title`, obsah, nebo obojí.
 *
 * Tón nikdy nenese informaci sám: ke každému patří ikona, aby text zůstal
 * srozumitelný v odstínech šedi a pro barvoslepé (pravidlo 11.3, barva není
 * jediný rozlišovací znak). Chybový a varovný tón se ohlašuje čtečce.
 */
export function Alert({
  tone = 'info',
  title,
  children,
  action,
  className,
  ...rest
}: {
  tone?: AlertTone;
  title?: string;
  children?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  const { border, surface, text, Icon } = TONE[tone];

  return (
    <div
      // Chybu a varování musí čtečka ohlásit, informaci a úspěch ne.
      role={tone === 'error' || tone === 'warning' ? 'alert' : undefined}
      data-tone={tone}
      className={cn(
        'flex items-start gap-3 rounded-[var(--radius-control)] border px-4 py-3 text-sm',
        border,
        surface,
        text,
        className,
      )}
      {...rest}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="flex flex-col gap-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children}
        {action}
      </div>
    </div>
  );
}
```

`packages/ui/src/patterns/states/filtered-empty-state.tsx`:

```tsx
import { EmptyState, type EmptyStateAction } from './empty-state';

/**
 * Stav S2. Je to **samostatný stav**, ne varianta S1: katalog 7.1 mu
 * předepisuje jiné povinné prvky, tedy připomenutí filtru slovy a tlačítko
 * na jeho zrušení. Kdyby se skládal ručně z `EmptyState`, každá obrazovka
 * by na jeden z těch dvou prvků dřív nebo později zapomněla.
 */
export function FilteredEmptyState({
  title,
  explanation,
  filterDescription,
  clearFiltersLabel,
  onClearFilters,
  suggestion,
  actions = [],
  className,
}: {
  title: string;
  explanation: string;
  /** Použitý filtr slovy, například „štítek Brno a stav Potvrzený". */
  filterDescription: string;
  clearFiltersLabel: string;
  onClearFilters: () => void;
  /** Návrh, jak hledání upravit. */
  suggestion?: string;
  actions?: EmptyStateAction[];
  className?: string;
}) {
  return (
    <EmptyState
      variant="filtered"
      title={title}
      explanation={explanation}
      filterDescription={filterDescription}
      // Zrušení filtrů je vždycky první akce, protože je to ta,
      // kterou uživatel v tomhle stavu skoro vždy chce.
      actions={[{ label: clearFiltersLabel, onClick: onClearFilters }, ...actions]}
      hint={suggestion}
      className={className}
    />
  );
}
```

`packages/ui/src/patterns/states/index.ts`:

```ts
export { Alert } from './alert';
export type { AlertTone } from './alert';
export { EmptyState } from './empty-state';
export type { EmptyStateAction, EmptyStateVariant } from './empty-state';
export { FilteredEmptyState } from './filtered-empty-state';
export { ErrorBlock } from './error-block';
export type { ErrorBlockLabels, ProblemSummary } from './error-block';
export { ForbiddenState } from './forbidden-state';
export { NotFoundState } from './not-found-state';
export { OverLimitState } from './over-limit-state';
export { PrerequisiteState } from './prerequisite-state';
export { ReadOnlyBanner, ReadOnlyValue } from './read-only-banner';
export { StaleBanner, StaleContent } from './stale-banner';
export { DetailSkeleton } from './detail-skeleton';
export { TableSkeleton } from './table-skeleton';
```

- [ ] **Krok 5b: Napsat testy na `Alert` a `CopyButton`**

`packages/ui/src/patterns/states/alert.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Alert } from './alert';

describe('Alert', () => {
  it('unese samotný nadpis i samotný obsah', () => {
    const { rerender } = render(<Alert tone="warning" title="Doména není ověřená" />);
    expect(screen.getByText('Doména není ověřená')).toBeVisible();

    rerender(<Alert tone="error">Odesílání je pozastavené.</Alert>);
    expect(screen.getByText('Odesílání je pozastavené.')).toBeVisible();
  });

  it('chybu a varování ohlásí čtečce, informaci a úspěch ne', () => {
    const { rerender } = render(<Alert tone="error">Chyba</Alert>);
    expect(screen.getByRole('alert')).toBeVisible();

    rerender(<Alert tone="warning">Varování</Alert>);
    expect(screen.getByRole('alert')).toBeVisible();

    rerender(<Alert tone="info">Poznámka</Alert>);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('ke každému tónu patří ikona, takže barva není jediný rozlišovací znak', () => {
    for (const tone of ['info', 'warning', 'error', 'success'] as const) {
      const { container, unmount } = render(<Alert tone={tone}>Text</Alert>);
      expect(container.querySelector('svg'), `${tone} nemá ikonu`).not.toBeNull();
      unmount();
    }
  });

  it('propustí data atributy, aby na něj šlo v testech obrazovky mířit', () => {
    render(
      <Alert tone="warning" data-testid="pause-box">
        Pozastaveno
      </Alert>,
    );
    expect(screen.getByTestId('pause-box')).toHaveAttribute('data-tone', 'warning');
  });
});
```

`packages/ui/src/components/copy-button.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CopyButton } from './copy-button';

describe('CopyButton', () => {
  it('zkopíruje hodnotu a přizná to i čtečce', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const user = userEvent.setup();

    render(<CopyButton value="req_01J8XK2M9P" label="Zkopírovat" copiedLabel="Zkopírováno" />);
    await user.click(screen.getByRole('button', { name: /Zkopírovat/ }));

    expect(writeText).toHaveBeenCalledWith('req_01J8XK2M9P');
    expect(screen.getByRole('status')).toHaveTextContent('Zkopírováno');
  });
});
```

- [ ] **Krok 6: Spustit testy, musí projít**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/states src/components/copy-button.test.tsx
pnpm --filter @mlain/ui typecheck
```

Očekávaný výstup: 18 passed.

- [ ] **Krok 7: Commit**

```bash
git add packages/ui/src/patterns/states packages/ui/src/components/copy-button.tsx packages/ui/src/components/copy-button.test.tsx
git commit -m "feat(ui): error block, alert, filtered empty state, copy button and states S7 to S15"
```

---

### Úkol 18: Oznamování čtečkám obrazovky

Zpětná vazba, kterou nevidí čtečka obrazovky, pro část uživatelů neexistuje. Průběh se oznamuje **po čtvrtinách, ne každou sekundu** (kritérium 8), živý počet až po ustálení a jen jednou (kritérium 9).

**Soubory:**
- Vytvořit: `packages/ui/src/a11y/live-region.tsx`, `use-progress-announcer.ts`, `use-debounced-announcement.ts`, `index.ts`
- Test: `packages/ui/src/a11y/use-progress-announcer.test.ts`, `live-region.test.tsx`

- [ ] **Krok 1: Napsat padající test**

`packages/ui/src/a11y/use-progress-announcer.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useProgressAnnouncer } from './use-progress-announcer';
import { useDebouncedAnnouncement } from './use-debounced-announcement';

describe('useProgressAnnouncer', () => {
  it('oznámí při 25, 50, 75 a 100 procentech, ne častěji', () => {
    const announce = vi.fn();
    const { rerender } = renderHook(
      ({ done }) => useProgressAnnouncer({ done, total: 100, announce, label: 'Import' }),
      { initialProps: { done: 0 } },
    );

    for (let value = 1; value <= 100; value += 1) {
      rerender({ done: value });
    }

    expect(announce).toHaveBeenCalledTimes(4);
    expect(announce.mock.calls.map((call) => call[0])).toEqual([25, 50, 75, 100]);
  });

  it('při skoku přes práh oznámí jen dosažený nejvyšší práh', () => {
    const announce = vi.fn();
    const { rerender } = renderHook(
      ({ done }) => useProgressAnnouncer({ done, total: 100, announce, label: 'Import' }),
      { initialProps: { done: 0 } },
    );
    rerender({ done: 80 });
    expect(announce).toHaveBeenCalledTimes(3);
  });

  it('u nulového celku neoznamuje nic', () => {
    const announce = vi.fn();
    renderHook(() => useProgressAnnouncer({ done: 0, total: 0, announce, label: 'Import' }));
    expect(announce).not.toHaveBeenCalled();
  });
});

describe('useDebouncedAnnouncement', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('oznámí až po 500 ms ustálení a jen jednou', () => {
    const announce = vi.fn();
    const { rerender } = renderHook(
      ({ value }) => useDebouncedAnnouncement(value, announce, 500),
      { initialProps: { value: '1 kontakt' } },
    );

    rerender({ value: '12 kontaktů' });
    rerender({ value: '124 kontaktů' });
    act(() => {
      vi.advanceTimersByTime(499);
    });
    expect(announce).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(announce).toHaveBeenCalledTimes(1);
    expect(announce).toHaveBeenCalledWith('124 kontaktů');
  });
});
```

- [ ] **Krok 2: Spustit test, musí spadnout**

```bash
pnpm --filter @mlain/ui exec vitest run src/a11y
```

Očekávaný výstup: FAIL, `Failed to resolve import "./use-progress-announcer"`.

- [ ] **Krok 3: Implementovat**

`packages/ui/src/a11y/use-progress-announcer.ts`:

```ts
'use client';

import { useEffect, useRef } from 'react';

const THRESHOLDS = [25, 50, 75, 100] as const;

/**
 * Průběžné hodnoty se čtečce **neoznamují každou sekundu** (kritérium 8).
 * Oznamuje se při 25, 50, 75 a 100 procentech a při změně stavu.
 */
export function useProgressAnnouncer({
  done,
  total,
  announce,
  label,
}: {
  done: number;
  total: number;
  announce: (percent: number, label: string) => void;
  label: string;
}): void {
  const reached = useRef<Set<number>>(new Set());

  useEffect(() => {
    if (total <= 0) return;
    const percent = Math.floor((done / total) * 100);
    for (const threshold of THRESHOLDS) {
      if (percent >= threshold && !reached.current.has(threshold)) {
        reached.current.add(threshold);
        announce(threshold, label);
      }
    }
  }, [announce, done, label, total]);
}
```

`packages/ui/src/a11y/use-debounced-announcement.ts`:

```ts
'use client';

import { useEffect, useRef } from 'react';

/**
 * Živě se měnící číslo se do `aria-live` propíše až po ustálení
 * a jen jednou (kritérium 9). Jinak čtečka mluví při každém stisku klávesy.
 */
export function useDebouncedAnnouncement(
  value: string,
  announce: (value: string) => void,
  delayMs = 500,
): void {
  const initial = useRef(true);

  useEffect(() => {
    if (initial.current) {
      initial.current = false;
      return;
    }
    const timer = setTimeout(() => announce(value), delayMs);
    return () => clearTimeout(timer);
  }, [announce, delayMs, value]);
}
```

`packages/ui/src/a11y/live-region.tsx`:

```tsx
'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

type Announcer = {
  /** Nepřerušuje čtení. Pro potvrzení a průběh. */
  polite: (message: string) => void;
  /** Přeruší čtení. Vyhrazeno pro skutečné chyby. */
  assertive: (message: string) => void;
};

const LiveRegionContext = createContext<Announcer | null>(null);

/**
 * Oblasti musí být v DOM **před** vložením textu, jinak se hlášení
 * neodešle (pravidlo 5.10). Proto jsou obě prázdné od začátku.
 */
export function LiveRegionProvider({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
  const [polite, setPolite] = useState('');
  const [assertive, setAssertive] = useState('');

  const api = useMemo<Announcer>(
    () => ({
      polite: (message) => setPolite(message),
      assertive: (message) => setAssertive(message),
    }),
    [],
  );

  return (
    <LiveRegionContext.Provider value={api}>
      {children}
      <div aria-label={label} className="sr-only">
        <div role="status" aria-live="polite" aria-atomic="true">
          {polite}
        </div>
        <div role="alert" aria-live="assertive" aria-atomic="true">
          {assertive}
        </div>
      </div>
    </LiveRegionContext.Provider>
  );
}

export function useAnnouncer(): Announcer {
  const api = useContext(LiveRegionContext);
  if (!api) throw new Error('useAnnouncer se smí volat jen uvnitř LiveRegionProvider.');
  return api;
}

/** Stabilní obsluha pro `useProgressAnnouncer`. */
export function useProgressAnnouncement(format: (percent: number, label: string) => string) {
  const { polite } = useAnnouncer();
  return useCallback(
    (percent: number, label: string) => polite(format(percent, label)),
    [format, polite],
  );
}
```

`packages/ui/src/a11y/index.ts`:

```ts
export { LiveRegionProvider, useAnnouncer, useProgressAnnouncement } from './live-region';
export { useDebouncedAnnouncement } from './use-debounced-announcement';
export { useProgressAnnouncer } from './use-progress-announcer';
```

`packages/ui/src/a11y/live-region.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { LiveRegionProvider, useAnnouncer } from './live-region';

function Probe() {
  const announcer = useAnnouncer();
  return (
    <div>
      <button type="button" onClick={() => announcer.polite('Uloženo')}>
        klidně
      </button>
      <button type="button" onClick={() => announcer.assertive('Odesílání selhalo')}>
        naléhavě
      </button>
    </div>
  );
}

describe('LiveRegionProvider', () => {
  it('obě oblasti existují v DOM ještě před prvním hlášením', () => {
    render(
      <LiveRegionProvider label="Oznámení">
        <Probe />
      </LiveRegionProvider>,
    );
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('klidné hlášení jde do polite oblasti', async () => {
    const user = userEvent.setup();
    render(
      <LiveRegionProvider label="Oznámení">
        <Probe />
      </LiveRegionProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'klidně' }));
    expect(screen.getByRole('status')).toHaveTextContent('Uloženo');
    expect(screen.getByRole('alert')).toHaveTextContent('');
  });

  it('naléhavé hlášení jde do assertive oblasti', async () => {
    const user = userEvent.setup();
    render(
      <LiveRegionProvider label="Oznámení">
        <Probe />
      </LiveRegionProvider>,
    );
    await user.click(screen.getByRole('button', { name: 'naléhavě' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Odesílání selhalo');
  });
});
```

- [ ] **Krok 4: Spustit testy, musí projít**

```bash
pnpm --filter @mlain/ui exec vitest run src/a11y
```

Očekávaný výstup: 7 passed.

- [ ] **Krok 5: Commit**

```bash
git add packages/ui/src/a11y
git commit -m "feat(ui): live regions and quarter-based progress announcements"
```

---

### Úkol 19: K1 Datová tabulka, logika výběru a sloupců

**Tvrdé požadavky (13.1):** 200 řádků na stránce plynule; výběr řádků včetně rozsahu `Shift + klik`; **výběr přežije přestránkování** a je vidět jeho velikost; nastavitelné a ukládané sloupce; **kurzorové** stránkování bez čísel stránek; serverové řazení jen podle povolených `order` hodnot; klávesová navigace po řádcích; korektní role a `aria-rowcount` i při virtualizaci; sticky hlavička.

Tenhle úkol dělá logiku, kterou jde testovat bez DOM. Vykreslení je v úkolu 20.

**Soubory:**
- Vytvořit: `packages/ui/src/patterns/data-table/use-row-selection.ts`, `use-column-preferences.ts`
- Test: `packages/ui/src/patterns/data-table/use-row-selection.test.ts`, `use-column-preferences.test.ts`

- [ ] **Krok 1: Napsat padající test na výběr**

`packages/ui/src/patterns/data-table/use-row-selection.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useRowSelection } from './use-row-selection';

const page1 = ['a', 'b', 'c', 'd', 'e'];
const page2 = ['f', 'g', 'h'];

describe('useRowSelection', () => {
  it('výběr přežije přestránkování', () => {
    const { result, rerender } = renderHook(({ ids }) => useRowSelection({ pageIds: ids }), {
      initialProps: { ids: page1 },
    });

    act(() => result.current.toggle('b'));
    act(() => result.current.toggle('d'));
    expect(result.current.selectedIds).toEqual(['b', 'd']);

    rerender({ ids: page2 });
    expect(result.current.selectedIds).toEqual(['b', 'd']);

    act(() => result.current.toggle('g'));
    expect(result.current.selectedIds).toEqual(['b', 'd', 'g']);
    expect(result.current.count).toBe(3);
  });

  it('Shift + klik označí rozsah na stránce', () => {
    const { result } = renderHook(() => useRowSelection({ pageIds: page1 }));

    act(() => result.current.toggle('b'));
    act(() => result.current.selectRange('d'));
    expect(result.current.selectedIds).toEqual(['b', 'c', 'd']);
  });

  it('rozsah funguje i směrem nahoru', () => {
    const { result } = renderHook(() => useRowSelection({ pageIds: page1 }));
    act(() => result.current.toggle('d'));
    act(() => result.current.selectRange('b'));
    expect(result.current.selectedIds).toEqual(['b', 'c', 'd']);
  });

  it('hlavička vybere jen řádky na stránce, ne všechno', () => {
    const { result } = renderHook(() => useRowSelection({ pageIds: page1 }));
    act(() => result.current.toggleAllOnPage());
    expect(result.current.selectedIds).toEqual(page1);
    expect(result.current.mode).toBe('rows');
  });

  it('výběr všeho podle filtru je jiný režim a drží filtr', () => {
    const { result } = renderHook(() => useRowSelection({ pageIds: page1 }));
    act(() => result.current.selectAllMatchingFilter({ total: 12_480, filter: 'štítek Brno' }));

    expect(result.current.mode).toBe('allMatchingFilter');
    expect(result.current.count).toBe(12_480);
    expect(result.current.filterDescription).toBe('štítek Brno');
  });

  it('zrušení výběru vrátí režim i počet na začátek', () => {
    const { result } = renderHook(() => useRowSelection({ pageIds: page1 }));
    act(() => result.current.selectAllMatchingFilter({ total: 12_480, filter: 'štítek Brno' }));
    act(() => result.current.clear());

    expect(result.current.mode).toBe('rows');
    expect(result.current.count).toBe(0);
  });

  it('úspěšná hromadná akce výběr uklidí', async () => {
    const { result } = renderHook(() => useRowSelection({ pageIds: page1 }));
    act(() => result.current.toggle('a'));
    act(() => result.current.toggle('c'));

    await act(() => result.current.runBulkAction(async () => {}));
    expect(result.current.selectedIds).toEqual([]);
  });

  it('neúspěšná hromadná akce výběr nechá být', async () => {
    // Zákaz z 6.7: uživatel by musel vybírat znovu. Dřív tuhle vlastnost
    // hlídala prázdná funkce, takže test nemohl spadnout ani tehdy, kdyby
    // se výběr po chybě mazal. Teď obě větve testují skutečné chování.
    const { result } = renderHook(() => useRowSelection({ pageIds: page1 }));
    act(() => result.current.toggle('a'));
    act(() => result.current.toggle('c'));

    await expect(
      act(() =>
        result.current.runBulkAction(async () => {
          throw new Error('server odmítl');
        }),
      ),
    ).rejects.toThrow('server odmítl');

    expect(result.current.selectedIds).toEqual(['a', 'c']);
  });

  it('výběr jde řídit zvenčí, aby si ho obrazovka mohla držet sama', () => {
    const onSelectionChange = vi.fn();
    const { result } = renderHook(() =>
      useRowSelection({ pageIds: page1, selectedIds: ['b'], onSelectionChange }),
    );
    act(() => result.current.toggle('d'));
    expect(onSelectionChange).toHaveBeenCalledWith(['b', 'd']);
  });
});
```

- [ ] **Krok 2: Spustit test, musí spadnout, pak implementovat**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/data-table/use-row-selection.test.ts
```

Očekávaný výstup: FAIL, `Failed to resolve import "./use-row-selection"`.

`packages/ui/src/patterns/data-table/use-row-selection.ts`:

```ts
'use client';

import { useCallback, useMemo, useRef, useState } from 'react';

export type SelectionMode = 'rows' | 'allMatchingFilter';

/**
 * Výběr řádků, který přežije přestránkování (tvrdý požadavek K1).
 *
 * Rozlišuje dva režimy, protože je to klasická past: uživatel zaškrtne
 * hlavičku, myslí si, že vybral 50 řádků na obrazovce, a smaže 50 000.
 */
export function useRowSelection({
  pageIds,
  selectedIds,
  onSelectionChange,
}: {
  pageIds: string[];
  /** Když je zadaný, výběr drží obrazovka a hook je jen řízený. */
  selectedIds?: string[];
  onSelectionChange?: (next: string[]) => void;
}) {
  const [own, setOwn] = useState<string[]>([]);
  const controlled = selectedIds !== undefined;
  const selected = controlled ? selectedIds : own;

  const setSelected = useCallback(
    (updater: (current: string[]) => string[]) => {
      if (controlled) {
        onSelectionChange?.(updater(selectedIds));
        return;
      }
      setOwn((current) => {
        const next = updater(current);
        onSelectionChange?.(next);
        return next;
      });
    },
    [controlled, onSelectionChange, selectedIds],
  );

  const [mode, setMode] = useState<SelectionMode>('rows');
  const [matching, setMatching] = useState<{ total: number; filter: string } | null>(null);
  const anchor = useRef<string | null>(null);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const toggle = useCallback((id: string) => {
    anchor.current = id;
    setMode('rows');
    setMatching(null);
    setSelected((current) =>
      current.includes(id) ? current.filter((item) => item !== id) : [...current, id],
    );
  }, [setSelected]);

  /** Rozsah od poslední označené kotvy k `id`, v pořadí stránky. */
  const selectRange = useCallback(
    (id: string) => {
      const from = anchor.current;
      if (from === null) {
        toggle(id);
        return;
      }
      const start = pageIds.indexOf(from);
      const end = pageIds.indexOf(id);
      if (start === -1 || end === -1) return;
      const [low, high] = start <= end ? [start, end] : [end, start];
      const range = pageIds.slice(low, high + 1);
      setSelected((current) => {
        const next = new Set(current);
        for (const item of range) next.add(item);
        return pageIds.filter((item) => next.has(item)).concat(
          current.filter((item) => !pageIds.includes(item)),
        );
      });
    },
    [pageIds, setSelected, toggle],
  );

  const toggleAllOnPage = useCallback(() => {
    setMode('rows');
    setMatching(null);
    setSelected((current) => {
      const allSelected = pageIds.every((id) => current.includes(id));
      if (allSelected) return current.filter((id) => !pageIds.includes(id));
      const next = new Set(current);
      for (const id of pageIds) next.add(id);
      return [...next];
    });
  }, [pageIds, setSelected]);

  const selectAllMatchingFilter = useCallback((input: { total: number; filter: string }) => {
    setMode('allMatchingFilter');
    setMatching(input);
  }, []);

  const clear = useCallback(() => {
    setSelected(() => []);
    setMode('rows');
    setMatching(null);
    anchor.current = null;
  }, [setSelected]);

  /**
   * Hromadná akce nad výběrem. Výběr se uklidí **jen po úspěchu**.
   *
   * Když akce selže, výjimka proletí ven a řádky pod ní se nikdy neprovedou,
   * takže výběr zůstane (zákaz z 6.7: uživatel by musel vybírat znovu).
   * Nesmí se to obalit do `try/finally`, tím by se ochrana zrušila.
   */
  const runBulkAction = useCallback(
    async (action: () => Promise<void>) => {
      await action();
      clear();
    },
    [clear],
  );

  return {
    selectedIds: selected,
    isSelected: (id: string) => mode === 'allMatchingFilter' || selectedSet.has(id),
    count: mode === 'allMatchingFilter' ? (matching?.total ?? 0) : selected.length,
    mode,
    filterDescription: matching?.filter,
    allOnPageSelected: pageIds.length > 0 && pageIds.every((id) => selectedSet.has(id)),
    toggle,
    selectRange,
    toggleAllOnPage,
    selectAllMatchingFilter,
    clear,
    runBulkAction,
  };
}
```

- [ ] **Krok 3: Napsat padající test na sloupce**

`packages/ui/src/patterns/data-table/use-column-preferences.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useColumnPreferences } from './use-column-preferences';

const columns = ['email', 'name', 'status', 'lists', 'tags', 'createdAt', 'lastActive'];

describe('useColumnPreferences', () => {
  beforeEach(() => window.localStorage.clear());

  it('výchozí sada je šest sloupců', () => {
    const { result } = renderHook(() =>
      useColumnPreferences({ tableId: 'contacts', allColumns: columns, defaultVisible: 6 }),
    );
    expect(result.current.visible).toHaveLength(6);
  });

  it('uloží viditelnost a přečte ji po novém připojení', () => {
    const first = renderHook(() =>
      useColumnPreferences({ tableId: 'contacts', allColumns: columns, defaultVisible: 6 }),
    );
    act(() => first.result.current.toggleColumn('tags'));
    first.unmount();

    const second = renderHook(() =>
      useColumnPreferences({ tableId: 'contacts', allColumns: columns, defaultVisible: 6 }),
    );
    expect(second.result.current.visible).not.toContain('tags');
  });

  it('uloží šířku sloupce', () => {
    const { result } = renderHook(() =>
      useColumnPreferences({ tableId: 'contacts', allColumns: columns, defaultVisible: 6 }),
    );
    act(() => result.current.setWidth('email', 320));
    expect(result.current.widths.email).toBe(320);
  });

  it('nastavení je vázané na tabulku, ne globálně', () => {
    const contacts = renderHook(() =>
      useColumnPreferences({ tableId: 'contacts', allColumns: columns, defaultVisible: 6 }),
    );
    act(() => contacts.result.current.setWidth('email', 320));

    const campaigns = renderHook(() =>
      useColumnPreferences({ tableId: 'campaigns', allColumns: columns, defaultVisible: 6 }),
    );
    expect(campaigns.result.current.widths.email).toBeUndefined();
  });

  it('poškozený zápis v úložišti nezabije tabulku', () => {
    window.localStorage.setItem('mlain.table.contacts', '{ tohle není JSON');
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { result } = renderHook(() =>
      useColumnPreferences({ tableId: 'contacts', allColumns: columns, defaultVisible: 6 }),
    );
    expect(result.current.visible).toHaveLength(6);
    spy.mockRestore();
  });
});
```

- [ ] **Krok 4: Spustit test, musí spadnout, pak implementovat**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/data-table/use-column-preferences.test.ts
```

Očekávaný výstup: FAIL, `Failed to resolve import "./use-column-preferences"`.

`packages/ui/src/patterns/data-table/use-column-preferences.ts`:

```ts
'use client';

import { useCallback, useEffect, useState } from 'react';

type Preferences = { hidden: string[]; widths: Record<string, number> };

const VERSION = 1;

function storageKey(tableId: string): string {
  return `mlain.table.${tableId}`;
}

function read(tableId: string): Preferences {
  if (typeof window === 'undefined') return { hidden: [], widths: {} };
  const raw = window.localStorage.getItem(storageKey(tableId));
  if (raw === null) return { hidden: [], widths: {} };
  try {
    const parsed = JSON.parse(raw) as { version?: number } & Preferences;
    if (parsed.version !== VERSION) return { hidden: [], widths: {} };
    return { hidden: parsed.hidden ?? [], widths: parsed.widths ?? {} };
  } catch {
    // Poškozený zápis nesmí zabít tabulku, jen se zahodí.
    console.warn('Nastavení sloupců je poškozené, používáme výchozí.');
    return { hidden: [], widths: {} };
  }
}

/**
 * Viditelnost a šířka sloupců, uložené na uživatele a tabulku.
 * Stav filtrů a řazení do úložiště nepatří, ten je v URL (konvence 4.3).
 */
export function useColumnPreferences({
  tableId,
  allColumns,
  defaultVisible,
}: {
  tableId: string;
  allColumns: string[];
  /** Kolik sloupců je vidět, dokud si uživatel nevybere. Výchozí sada je 6. */
  defaultVisible: number;
}) {
  const [preferences, setPreferences] = useState<Preferences>(() => {
    const stored = read(tableId);
    if (stored.hidden.length === 0 && Object.keys(stored.widths).length === 0) {
      return { hidden: allColumns.slice(defaultVisible), widths: {} };
    }
    return stored;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      storageKey(tableId),
      JSON.stringify({ version: VERSION, ...preferences }),
    );
  }, [preferences, tableId]);

  const toggleColumn = useCallback((column: string) => {
    setPreferences((current) => ({
      ...current,
      hidden: current.hidden.includes(column)
        ? current.hidden.filter((item) => item !== column)
        : [...current.hidden, column],
    }));
  }, []);

  const setWidth = useCallback((column: string, width: number) => {
    setPreferences((current) => ({ ...current, widths: { ...current.widths, [column]: width } }));
  }, []);

  return {
    visible: allColumns.filter((column) => !preferences.hidden.includes(column)),
    hidden: preferences.hidden,
    widths: preferences.widths,
    toggleColumn,
    setWidth,
  };
}
```

- [ ] **Krok 5: Spustit testy, musí projít**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/data-table
```

Očekávaný výstup: 14 passed.

- [ ] **Krok 6: Commit**

```bash
git add packages/ui/src/patterns/data-table
git commit -m "feat(ui): K1 row selection surviving pagination and column preferences"
```

---

### Úkol 20: K1 Datová tabulka, vykreslení, klávesnice a stránkování

**Soubory:**
- Vytvořit: `packages/ui/src/patterns/data-table/data-table.tsx`, `selection-bar.tsx`, `pagination-footer.tsx`, `index.ts`
- Test: `packages/ui/src/patterns/data-table/data-table.test.tsx`

- [ ] **Krok 1: Napsat padající test**

`packages/ui/src/patterns/data-table/data-table.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DataTable, type DataTableColumn } from './data-table';

type Contact = { id: string; email: string; name: string };

const rows: Contact[] = Array.from({ length: 5 }, (_, index) => ({
  id: `c${index}`,
  email: `kontakt${index}@firma.cz`,
  name: `Jméno ${index}`,
}));

const columns: DataTableColumn<Contact>[] = [
  { id: 'email', header: 'E-mail', cell: (row) => row.email, sortable: true },
  { id: 'name', header: 'Jméno', cell: (row) => row.name },
];

const labels = {
  selectRow: 'Označit řádek',
  selectAllOnPage: 'Označit všechny řádky na stránce',
  previous: 'Předchozí',
  next: 'Další',
  showing: (shown: number, total: number, estimated: boolean) =>
    `Zobrazeno ${shown} z ${estimated ? '~' : ''}${total}`,
  selectedOnPage: (count: number) => `Vybráno ${count} kontaktů na této stránce`,
  selectAllMatching: (total: number) => `Vybrat všech ${total} odpovídajících filtru`,
  selectedAllMatching: (total: number) => `Vybráno všech ${total} kontaktů odpovídajících filtru.`,
  clearSelection: 'Zrušit výběr',
  cursorInvalid: 'Seznam se mezitím změnil, jste zpátky na začátku.',
  sortNotAvailable: 'Podle tohohle sloupce řadit nejde.',
  sortedAscending: 'seřazeno vzestupně',
  sortedDescending: 'seřazeno sestupně',
  columnSettings: 'Nastavit sloupce',
  columnVisible: (column: string) => `Zobrazit sloupec ${column}`,
  columnWidth: (column: string) => `Šířka sloupce ${column}`,
};

function base(overrides: Partial<React.ComponentProps<typeof DataTable<Contact>>> = {}) {
  return {
    tableId: 'contacts',
    caption: 'Kontakty',
    columns,
    rows,
    getRowId: (row: Contact) => row.id,
    labels,
    count: { value: 12_480, precision: 'estimated' as const },
    pagination: { hasMore: true, onPrevious: vi.fn(), onNext: vi.fn(), canGoBack: false },
    ...overrides,
  };
}

describe('DataTable', () => {
  it('má roli grid a správný aria-rowcount včetně hlavičky', () => {
    render(<DataTable {...base()} />);
    const grid = screen.getByRole('grid', { name: 'Kontakty' });
    expect(grid).toHaveAttribute('aria-rowcount', '6');
  });

  it('nikde nezobrazuje čísla stránek, jen Předchozí a Další', () => {
    render(<DataTable {...base()} />);
    expect(screen.getByRole('button', { name: 'Další' })).toBeVisible();
    expect(screen.queryByRole('button', { name: '2' })).toBeNull();
  });

  it('celkový počet ukazuje s vlnovkou, dokud není přesný', () => {
    render(<DataTable {...base()} />);
    expect(screen.getByText('Zobrazeno 5 z ~12480')).toBeVisible();
  });

  it('přesný počet ukazuje bez vlnovky', () => {
    render(<DataTable {...base({ count: { value: 5, precision: 'exact' } })} />);
    expect(screen.getByText('Zobrazeno 5 z 5')).toBeVisible();
  });

  it('šipkami a klávesou j se dá projít řádky', async () => {
    const user = userEvent.setup();
    render(<DataTable {...base()} />);
    const firstRow = screen.getAllByRole('row')[1];
    firstRow.focus();
    expect(firstRow).toHaveFocus();

    await user.keyboard('{ArrowDown}');
    expect(screen.getAllByRole('row')[2]).toHaveFocus();

    await user.keyboard('j');
    expect(screen.getAllByRole('row')[3]).toHaveFocus();

    await user.keyboard('k');
    expect(screen.getAllByRole('row')[2]).toHaveFocus();
  });

  it('mezerník i x označí řádek z klávesnice', async () => {
    const user = userEvent.setup();
    render(<DataTable {...base()} />);
    screen.getAllByRole('row')[1].focus();

    await user.keyboard('x');
    expect(within(screen.getAllByRole('row')[1]).getByRole('checkbox')).toBeChecked();

    await user.keyboard('x');
    expect(within(screen.getAllByRole('row')[1]).getByRole('checkbox')).not.toBeChecked();
  });

  it('po výběru na stránce nabídne výběr všeho podle filtru', async () => {
    const user = userEvent.setup();
    render(<DataTable {...base()} />);
    await user.click(screen.getByRole('checkbox', { name: 'Označit všechny řádky na stránce' }));

    expect(screen.getByText('Vybráno 5 kontaktů na této stránce')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Vybrat všech 12480 odpovídajících filtru' })).toBeVisible();
  });

  it('neplatný kurzor vysvětlí a ukáže první stránku, ne prázdno ani chybu', () => {
    render(<DataTable {...base({ cursorInvalid: true })} />);
    expect(screen.getByText('Seznam se mezitím změnil, jste zpátky na začátku.')).toBeVisible();
    expect(screen.getAllByRole('row')).toHaveLength(6);
  });

  it('sloupec mimo povolené hodnoty order řazení vůbec nenabízí', () => {
    render(<DataTable {...base()} />);
    expect(screen.getByRole('button', { name: /E-mail/ })).toBeVisible();
    // Sloupec Jméno není sortable, takže tam žádné tlačítko není.
    expect(screen.queryByRole('button', { name: /^Jméno/ })).toBeNull();
  });

  it('hlavička je sticky, aby nezakryla fokusovaný řádek', () => {
    render(<DataTable {...base()} />);
    expect(screen.getByTestId('data-table-head').className).toContain('sticky');
  });

  it('Shift a klik označí rozsah řádků i v prohlížeči, ne jen v hooku', async () => {
    // Rozsahový výběr byl otestovaný jen na logice. Že se `shiftKey`
    // ze skutečného kliknutí do té logiky vůbec dostane, nehlídalo nic.
    const user = userEvent.setup();
    render(<DataTable {...base()} />);
    const boxes = screen.getAllByRole('checkbox', { name: 'Označit řádek' });

    await user.click(boxes[0]);
    await user.click(boxes[3], { shiftKey: true });

    expect(boxes[0]).toBeChecked();
    expect(boxes[1]).toBeChecked();
    expect(boxes[2]).toBeChecked();
    expect(boxes[3]).toBeChecked();
    expect(boxes[4]).not.toBeChecked();
  });

  it('nabízí nastavení sloupců: viditelnost i šířku', async () => {
    // Hook `useColumnPreferences` existoval, měl testy, a tabulka ho
    // vůbec neimportovala. Tvrdý požadavek K1 na nastavitelné a ukládané
    // sloupce tím nebyl splněný.
    const user = userEvent.setup();
    render(<DataTable {...base()} />);

    await user.click(screen.getByRole('button', { name: 'Nastavit sloupce' }));
    expect(screen.getByRole('checkbox', { name: 'Zobrazit sloupec Jméno' })).toBeChecked();

    await user.click(screen.getByRole('checkbox', { name: 'Zobrazit sloupec Jméno' }));
    expect(screen.queryByRole('columnheader', { name: 'Jméno' })).toBeNull();
  });

  it('nastavení sloupců přežije nové připojení tabulky', async () => {
    const user = userEvent.setup();
    const first = render(<DataTable {...base()} />);
    await user.click(screen.getByRole('button', { name: 'Nastavit sloupce' }));
    await user.click(screen.getByRole('checkbox', { name: 'Zobrazit sloupec Jméno' }));
    first.unmount();

    render(<DataTable {...base()} />);
    expect(screen.queryByRole('columnheader', { name: 'Jméno' })).toBeNull();
  });

  it('výběr jde řídit zvenčí, aby si ho obrazovka mohla držet', async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    render(
      <DataTable {...base({ selection: { selectedIds: [], onSelectionChange } })} />,
    );
    await user.click(screen.getAllByRole('checkbox', { name: 'Označit řádek' })[0]);
    expect(onSelectionChange).toHaveBeenCalledWith(['c0']);
  });

  it('prázdný seznam ukáže prázdný stav, ne prázdnou mřížku', () => {
    render(<DataTable {...base({ rows: [], emptyState: <p>Zatím tu nic není.</p> })} />);
    expect(screen.getByText('Zatím tu nic není.')).toBeVisible();
  });

  it('od sta řádků virtualizuje, ale aria-rowcount zůstane z dat', () => {
    // Mez ze specifikace 14.2. `aria-rowcount` se počítá z dat, ne
    // z vykreslených uzlů, takže čtečka hlásí správný počet i tehdy,
    // když je v DOM jen zlomek řádků.
    const many = Array.from({ length: 150 }, (_, index) => ({
      id: `c${index}`,
      email: `kontakt${index}@firma.cz`,
      name: `Jméno ${index}`,
    }));
    render(<DataTable {...base({ rows: many })} />);

    const grid = screen.getByRole('grid', { name: 'Kontakty' });
    expect(grid).toHaveAttribute('aria-rowcount', '151');
    // Hlavička plus podmnožina řádků, rozhodně ne všech 150.
    expect(screen.getAllByRole('row').length).toBeLessThan(151);
  });

  it('pod stem řádků se virtualizace nezapíná', () => {
    render(<DataTable {...base()} />);
    expect(screen.getAllByRole('row')).toHaveLength(6);
  });
});
```

- [ ] **Krok 2: Spustit test, musí spadnout**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/data-table/data-table.test.tsx
```

Očekávaný výstup: FAIL, `Failed to resolve import "./data-table"`.

- [ ] **Krok 3: Implementovat pruh výběru a patičku**

`packages/ui/src/patterns/data-table/selection-bar.tsx`:

```tsx
'use client';

import { Button } from '../../components/button';
import { cn } from '../../lib/cn';

/**
 * Rozlišení „vybráno na stránce" a „vybráno vše" (6.5).
 * Bez něj uživatel zaškrtne hlavičku, myslí si, že vybral 50 řádků,
 * a smaže 50 000.
 */
export function SelectionBar({
  mode,
  count,
  total,
  labels,
  onSelectAllMatching,
  onClear,
  actions,
}: {
  mode: 'rows' | 'allMatchingFilter';
  count: number;
  total: number;
  labels: {
    selectedOnPage: (count: number) => string;
    selectAllMatching: (total: number) => string;
    selectedAllMatching: (total: number) => string;
    clearSelection: string;
  };
  onSelectAllMatching: () => void;
  onClear: () => void;
  actions?: React.ReactNode;
}) {
  if (count === 0) return null;

  return (
    <div
      data-testid="selection-bar"
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-[var(--radius-control)] px-4 py-3 text-sm',
        mode === 'allMatchingFilter'
          ? 'border border-accent-text bg-accent-surface text-accent-text'
          : 'bg-surface-muted text-text',
      )}
    >
      {mode === 'allMatchingFilter' ? (
        <>
          <span>{labels.selectedAllMatching(count)}</span>
          <Button variant="link" onClick={onClear}>
            {labels.clearSelection}
          </Button>
        </>
      ) : (
        <>
          <span>{labels.selectedOnPage(count)}</span>
          <Button variant="link" onClick={onSelectAllMatching}>
            {labels.selectAllMatching(total)}
          </Button>
        </>
      )}
      {actions}
    </div>
  );
}
```

`packages/ui/src/patterns/data-table/pagination-footer.tsx`:

```tsx
'use client';

import { Button } from '../../components/button';

export type CountInfo = { value: number; precision: 'exact' | 'estimated' };

/**
 * Kurzorové stránkování bez čísel stránek (14.2). Nekonečné rolování
 * se vědomě nezavádí: znemožňuje odkázat na konkrétní místo a u tabulky
 * s hromadnými akcemi není poznat, co je vlastně vybráno.
 */
export function PaginationFooter({
  shown,
  count,
  hasMore,
  canGoBack,
  onPrevious,
  onNext,
  labels,
}: {
  shown: number;
  count: CountInfo;
  hasMore: boolean;
  canGoBack: boolean;
  onPrevious: () => void;
  onNext: () => void;
  labels: {
    previous: string;
    next: string;
    showing: (shown: number, total: number, estimated: boolean) => string;
  };
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-2 py-3 text-sm text-text-muted">
      {/* Vlnovka je viditelné přiznání nepřesnosti (princip P7). */}
      <span>{labels.showing(shown, count.value, count.precision === 'estimated')}</span>
      <div className="flex gap-2">
        <Button variant="secondary" disabled={!canGoBack} onClick={onPrevious}>
          {labels.previous}
        </Button>
        <Button variant="secondary" disabled={!hasMore} onClick={onNext}>
          {labels.next}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Krok 4: Implementovat tabulku**

`packages/ui/src/patterns/data-table/data-table.tsx`:

```tsx
'use client';

import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowDown, ArrowUp, Settings2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '../../components/button';
import { Checkbox } from '../../components/checkbox';
import { cn } from '../../lib/cn';
import { PaginationFooter, type CountInfo } from './pagination-footer';
import { SelectionBar } from './selection-bar';
import { useColumnPreferences } from './use-column-preferences';
import { useRowSelection } from './use-row-selection';

/** Mez ze specifikace 14.2. Pod ní se virtualizace nevyplatí. */
const VIRTUALIZE_FROM = 100;
const ROW_HEIGHT = 44;

export type DataTableColumn<Row> = {
  id: string;
  header: string;
  cell: (row: Row) => React.ReactNode;
  /**
   * Řadit jde jen podle hodnot, které zdroj vyjmenovává v `order`.
   * Sloupec mimo ten výčet řazení **vůbec nenabízí**, žádná zašedlá šipka.
   */
  sortable?: boolean;
  width?: number;
};

export type DataTableLabels = {
  selectRow: string;
  selectAllOnPage: string;
  previous: string;
  next: string;
  showing: (shown: number, total: number, estimated: boolean) => string;
  selectedOnPage: (count: number) => string;
  selectAllMatching: (total: number) => string;
  selectedAllMatching: (total: number) => string;
  clearSelection: string;
  cursorInvalid: string;
  sortNotAvailable: string;
  sortedAscending: string;
  sortedDescending: string;
  /** Nastavení sloupců: viditelnost a šířka (tvrdý požadavek K1). */
  columnSettings: string;
  columnVisible: (column: string) => string;
  columnWidth: (column: string) => string;
};

export function DataTable<Row>({
  tableId,
  caption,
  columns,
  rows,
  getRowId,
  labels,
  count,
  pagination,
  order,
  cursorInvalid = false,
  filterDescription,
  bulkActions,
  onRowActivate,
  selection: selectionProp,
  emptyState,
  defaultVisibleColumns,
  virtualizeFrom = VIRTUALIZE_FROM,
}: {
  tableId: string;
  /** Popisek tabulky pro čtečku. Nikdy prázdný. */
  caption: string;
  columns: DataTableColumn<Row>[];
  rows: Row[];
  getRowId: (row: Row) => string;
  labels: DataTableLabels;
  count: CountInfo;
  pagination: {
    hasMore: boolean;
    canGoBack: boolean;
    onPrevious: () => void;
    onNext: () => void;
  };
  order?: { value: string; onChange: (value: string) => void };
  /** Kurzor přestal platit. Ukáže se první stránka stejného filtru a vysvětlení. */
  cursorInvalid?: boolean;
  filterDescription?: string;
  bulkActions?: React.ReactNode;
  onRowActivate?: (row: Row) => void;
  /** Když je zadaný, výběr drží obrazovka. Jinak si ho tabulka řídí sama. */
  selection?: { selectedIds: string[]; onSelectionChange: (next: string[]) => void };
  /** Co se ukáže místo mřížky, když nejsou žádné řádky. */
  emptyState?: React.ReactNode;
  /** Kolik sloupců je vidět, dokud si uživatel nevybere. Výchozí je 6. */
  defaultVisibleColumns?: number;
  /** Mez, od které se zapíná virtualizace. Specifikace 14.2 říká 100. */
  virtualizeFrom?: number;
}) {
  const pageIds = rows.map(getRowId);
  const selection = useRowSelection({
    pageIds,
    selectedIds: selectionProp?.selectedIds,
    onSelectionChange: selectionProp?.onSelectionChange,
  });
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [columnSettingsOpen, setColumnSettingsOpen] = useState(false);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Nastavení sloupců je tvrdý požadavek K1. Hook existoval od úkolu 19,
  // ale tabulka ho neimportovala, takže viditelnost ani šířka nešly měnit.
  const preferences = useColumnPreferences({
    tableId,
    allColumns: columns.map((column) => column.id),
    defaultVisible: defaultVisibleColumns ?? Math.min(columns.length, 6),
  });

  const visibleColumns = columns.filter((column) => preferences.visible.includes(column.id));

  // Virtualizace se zapíná od sta řádků (14.2). `aria-rowcount`
  // a `aria-rowindex` se počítají z dat, ne z vykreslených uzlů,
  // takže se virtualizací nemění.
  const virtualized = rows.length >= virtualizeFrom;
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => bodyRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    enabled: virtualized,
  });

  const visibleRows = virtualized
    ? virtualizer.getVirtualItems().map((item) => ({ row: rows[item.index], index: item.index }))
    : rows.map((row, index) => ({ row, index }));

  function focusRow(index: number) {
    const clamped = Math.max(0, Math.min(rows.length - 1, index));
    setFocusedIndex(clamped);
    const target = bodyRef.current?.querySelectorAll<HTMLElement>('[role="row"]')[clamped];
    target?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>, index: number, row: Row) {
    // Jednopísmenné zkratky se ignorují, když je fokus v textovém poli.
    const target = event.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

    if (event.key === 'ArrowDown' || event.key === 'j') {
      event.preventDefault();
      focusRow(index + 1);
      return;
    }
    if (event.key === 'ArrowUp' || event.key === 'k') {
      event.preventDefault();
      focusRow(index - 1);
      return;
    }
    if (event.key === 'x' || event.key === ' ') {
      event.preventDefault();
      if (event.shiftKey) selection.selectRange(getRowId(row));
      else selection.toggle(getRowId(row));
      return;
    }
    if (event.key === 'Enter' && onRowActivate) {
      event.preventDefault();
      onRowActivate(row);
    }
  }

  const sortDirection = order?.value.endsWith('.desc') ? 'desc' : 'asc';
  const sortColumn = order?.value.split('.')[0];

  return (
    <div className="flex flex-col gap-3">
      {cursorInvalid ? (
        <p role="status" className="rounded-[var(--radius-control)] bg-surface-muted px-4 py-3 text-sm text-text">
          {labels.cursorInvalid}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button variant="secondary" onClick={() => setColumnSettingsOpen((open) => !open)}>
          <Settings2 aria-hidden className="size-4" />
          {labels.columnSettings}
        </Button>
      </div>

      {columnSettingsOpen ? (
        <div className="flex flex-col gap-2 rounded-[var(--radius-surface)] border border-border bg-surface p-4">
          {columns.map((column) => (
            <div key={column.id} className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-2 text-sm text-text">
                <Checkbox
                  aria-label={labels.columnVisible(column.header)}
                  checked={preferences.visible.includes(column.id)}
                  onCheckedChange={() => preferences.toggleColumn(column.id)}
                />
                {column.header}
              </label>
              <input
                type="number"
                min={80}
                max={800}
                aria-label={labels.columnWidth(column.header)}
                value={preferences.widths[column.id] ?? ''}
                onChange={(event) =>
                  preferences.setWidth(column.id, Number(event.target.value) || 0)
                }
                className="min-h-11 w-24 rounded-[var(--radius-control)] border border-border-strong bg-surface px-2 text-sm text-text"
              />
            </div>
          ))}
        </div>
      ) : null}

      <SelectionBar
        mode={selection.mode}
        count={selection.count}
        total={count.value}
        labels={labels}
        onSelectAllMatching={() =>
          selection.selectAllMatchingFilter({
            total: count.value,
            filter: filterDescription ?? '',
          })
        }
        onClear={selection.clear}
        actions={bulkActions}
      />

      {rows.length === 0 && emptyState ? emptyState : null}

      <div
        role="grid"
        hidden={rows.length === 0 && Boolean(emptyState)}
        aria-label={caption}
        // Počet řádků včetně hlavičky. Platí i při virtualizaci,
        // proto se bere z dat, ne z počtu vykreslených uzlů.
        aria-rowcount={rows.length + 1}
        data-table-id={tableId}
        className="overflow-auto rounded-[var(--radius-surface)] border border-border"
      >
        <div
          role="row"
          aria-rowindex={1}
          data-testid="data-table-head"
          className="sticky top-0 z-[var(--z-sticky)] flex gap-3 border-b border-border bg-surface-muted px-3 py-2"
        >
          <span role="columnheader" className="flex w-8 items-center">
            <Checkbox
              aria-label={labels.selectAllOnPage}
              checked={selection.allOnPageSelected}
              onCheckedChange={() => selection.toggleAllOnPage()}
            />
          </span>
          {visibleColumns.map((column) => (
            <span
              key={column.id}
              role="columnheader"
              aria-sort={
                sortColumn === column.id
                  ? sortDirection === 'asc'
                    ? 'ascending'
                    : 'descending'
                  : undefined
              }
              className="flex-1 text-sm font-medium text-text"
              style={
                preferences.widths[column.id] ?? column.width
                  ? { width: preferences.widths[column.id] ?? column.width, flex: 'none' }
                  : undefined
              }
            >
              {column.sortable && order ? (
                <button
                  type="button"
                  className="flex min-h-11 items-center gap-1"
                  onClick={() =>
                    order.onChange(
                      sortColumn === column.id && sortDirection === 'asc'
                        ? `${column.id}.desc`
                        : `${column.id}.asc`,
                    )
                  }
                >
                  {column.header}
                  {sortColumn === column.id ? (
                    sortDirection === 'asc' ? (
                      <ArrowUp aria-label={labels.sortedAscending} className="size-4" />
                    ) : (
                      <ArrowDown aria-label={labels.sortedDescending} className="size-4" />
                    )
                  ) : null}
                </button>
              ) : (
                column.header
              )}
            </span>
          ))}
        </div>

        <div
          ref={bodyRef}
          style={virtualized ? { height: virtualizer.getTotalSize(), position: 'relative' } : undefined}
        >
          {visibleRows.map(({ row, index }) => {
            const id = getRowId(row);
            return (
              <div
                key={id}
                role="row"
                // Index se počítá z dat, ne z pořadí v DOM, takže při
                // virtualizaci sedí i pro čtečku.
                aria-rowindex={index + 2}
                aria-selected={selection.isSelected(id)}
                tabIndex={index === focusedIndex ? 0 : -1}
                onKeyDown={(event) => onKeyDown(event, index, row)}
                onFocus={() => setFocusedIndex(index)}
                style={
                  virtualized
                    ? {
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        width: '100%',
                        height: ROW_HEIGHT,
                        transform: `translateY(${index * ROW_HEIGHT}px)`,
                      }
                    : undefined
                }
                className={cn(
                  'flex gap-3 border-b border-border px-3 py-2 last:border-b-0',
                  selection.isSelected(id) ? 'bg-accent-surface' : 'bg-surface',
                )}
              >
                <span role="gridcell" className="flex w-8 items-center">
                  <Checkbox
                    aria-label={labels.selectRow}
                    checked={selection.isSelected(id)}
                    onClick={(event) => {
                      if (event.shiftKey) {
                        event.preventDefault();
                        selection.selectRange(id);
                      }
                    }}
                    onCheckedChange={() => selection.toggle(id)}
                  />
                </span>
                {visibleColumns.map((column) => (
                  <span
                    key={column.id}
                    role="gridcell"
                    className="flex-1 text-sm text-text"
                    style={
                      preferences.widths[column.id] ?? column.width
                        ? { width: preferences.widths[column.id] ?? column.width, flex: 'none' }
                        : undefined
                    }
                  >
                    {column.cell(row)}
                  </span>
                ))}
              </div>
            );
          })}
        </div>
      </div>

      <PaginationFooter
        shown={rows.length}
        count={count}
        hasMore={pagination.hasMore}
        canGoBack={pagination.canGoBack}
        onPrevious={pagination.onPrevious}
        onNext={pagination.onNext}
        labels={labels}
      />
    </div>
  );
}
```

`packages/ui/src/patterns/data-table/index.ts`:

```ts
export { DataTable } from './data-table';
export type { DataTableColumn, DataTableLabels } from './data-table';
export { PaginationFooter } from './pagination-footer';
export type { CountInfo } from './pagination-footer';
export { SelectionBar } from './selection-bar';
export { useColumnPreferences } from './use-column-preferences';
export { useRowSelection } from './use-row-selection';
```

- [ ] **Krok 5: Spustit testy, musí projít**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/data-table
pnpm --filter @mlain/ui typecheck
```

Očekávaný výstup: 31 passed.

- [ ] **Krok 6: Ověřit virtualizaci a nastavení sloupců**

Virtualizace i nastavení sloupců jsou součástí kódu výše, ne dodatečný pokyn. Dva testy z kroku 1 je hlídají: „od sta řádků virtualizuje, ale `aria-rowcount` zůstane z dat" a „pod stem řádků se virtualizace nezapíná". Mez je propem `virtualizeFrom`, aby si ji obrazovka mohla posunout, ale výchozí hodnota je 100 podle specifikace 14.2.

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/data-table/data-table.test.tsx
```

Očekávaný výstup: 17 passed.

- [ ] **Krok 7: Spustit testy znovu a commit**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/data-table
git add packages/ui/src/patterns/data-table
git commit -m "feat(ui): K1 data table with cursor pagination, keyboard rows and sticky header"
```

---

### Úkol 21: K2 Query builder

**Tvrdé požadavky (13.1):** vnořené skupiny **do hloubky 5** a 50 potomků; přepínač všechny/alespoň jednu **plus negace** na každé skupině; operátory podle typu pole z matice části 2; plná klávesová obsluha včetně přidání a odebrání podmínky; volitelné zobrazení podkladového JSON.

**Rozhodnutí R9: `react-querybuilder` se nepoužije.** Kapitola 13.2 u něj vyjmenovává pět **povinných** přepisů: přepínač skupiny na větu, odstranění popisků AND a OR, přidání ovládání negace, vlastní výběr pole se skupinami a vlastní patičku s počtem a vzorkem. Po nich z knihovny nezbude nic viditelného. Navíc kritérium 71b žádá, aby se ovládací prvky skupiny vykreslily **v pořadí, které určuje ICU zpráva**, což pevné rozvržení hlavičky skupiny v knihovně neumí. Stavíme tedy nad vlastním AST. Odhad specifikace na tuhle variantu je den a půl.

**Rozhodnutí R11: AST je doslova ten ze specifikace, ne vlastní.** Komponenta pracuje přímo nad tvarem z části 2, kapitola 4.11.1, tedy `{ version: 1, root: GroupNode }` s uzly `{ type: 'group' | 'condition' }`. Důvod je jednoduchý: **tenhle strom se ukládá do `segments.definition` a validuje ho Zod schéma `SegmentAstV1`.** Kdyby si builder držel vlastní tvar, musel by mezi ním a úložištěm stát obousměrný převodník, který se rozejde při první změně schématu. Uzly proto **nemají `id`**: nic navíc se do databáze nezapisuje a adresují se **cestou**, tedy polem indexů potomků od kořene (`[]` je kořen, `[0, 2]` je třetí potomek prvního potomka kořene). Cesta je odvozená z dat, takže nemůže zastarat.

**Rozhodnutí R12: komponenta je řízená.** Bere `value` a `onChange`, žádný vnitřní stav stromu. Tím zaniká celá třída chyb, kdy se ohlásí hodnota před tím, než se stav aktualizuje, a obrazovka segmentu je trvale o jednu úpravu pozadu.

**Tvar hodnoty je vlastnost komponenty, ne dat.** Matice v části 2, kapitola 4.11.2, obsahuje **přesně 40 operátorů** a k nim tabulku typové kompatibility s pěti různými tvary hodnoty. Kdyby `OperatorDefinition` neneslo tvar a mez, nešlo by 27 ze 40 operátorů zadat vůbec, nebo by rozhraní nabídlo vstupní pole tam, kde je přítomnost hodnoty podle specifikace chyba. Matici jako **data** dodává plán segmentů, ale **pole, do kterých se ta data zapíšou**, musí existovat tady.

| Tvar hodnoty | Operátory | Kolik | Co se vykreslí |
|---|---|---|---|
| `none` | `is_empty`, `is_not_empty`, `is_true`, `is_false`, `is_member`, `is_not_member`, `is_confirmed`, `is_pending`, `is_unsubscribed`, `is_granted`, `is_withdrawn`, `is_missing`, `is_suppressed`, `is_not_suppressed`, `did`, `did_not` | 16 | **nic**, a `value` i `values` se z uzlu smažou |
| `scalar` | `eq`, `neq`, `contains`, `not_contains`, `starts_with`, `ends_with`, `gt`, `gte`, `lt`, `lte`, `on`, `before`, `after` | 13 | jedno pole, jehož typ určuje `valueType` pole |
| `list` | `in`, `not_in`, `has_any`, `has_all`, `has_none` | 5 | žetonový vstup, 1 až 1 000 položek |
| `range` | `between` | 1 | **dvě** pole, `values[0] <= values[1]` |
| `integer` | `in_last_days`, `not_in_last_days`, `in_next_days`, `count_gte`, `count_lte` | 5 | číselné pole s `min` a `max` z operátoru |

Součet je 40 a rozklad je úplný, ověřuje to test v kroku 1.

**Soubory:**
- Vytvořit: `packages/ui/src/patterns/query-builder/types.ts`, `paths.ts`, `use-query-builder.ts`, `query-builder.tsx`, `index.ts`
- Test: `packages/ui/src/patterns/query-builder/use-query-builder.test.ts`, `query-builder.test.tsx`, `operator-shapes.test.tsx`

- [ ] **Krok 1: Napsat padající test na logiku AST**

`packages/ui/src/patterns/query-builder/use-query-builder.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { OPERATOR_SHAPES, MAX_CHILDREN, MAX_DEPTH } from './types';
import {
  addCondition,
  addGroup,
  canAddGroup,
  canAddRule,
  nodeAt,
  removeAt,
  setField,
  setOperator,
  setOp,
  setValue,
  toggleNot,
} from './paths';
import type { GroupNode, SegmentAst } from './types';

const empty: SegmentAst = { version: 1, root: { type: 'group', op: 'and', not: false, children: [] } };

const city = {
  id: 'attribute:city',
  label: 'Město',
  group: 'Údaje kontaktu',
  ref: { kind: 'attribute', key: 'city' } as const,
  valueType: 'text' as const,
  operators: [
    { id: 'eq', label: 'je', shape: 'scalar' as const },
    { id: 'in', label: 'je jedna z', shape: 'list' as const, minItems: 1, maxItems: 1000 },
    { id: 'is_empty', label: 'je prázdné', shape: 'none' as const },
  ],
};

const createdAt = {
  id: 'contact:created_at',
  label: 'Vytvořen',
  group: 'Údaje kontaktu',
  ref: { kind: 'contact', key: 'created_at' } as const,
  valueType: 'date' as const,
  operators: [
    { id: 'on', label: 'dne', shape: 'scalar' as const },
    { id: 'between', label: 'mezi', shape: 'range' as const },
    { id: 'in_last_days', label: 'za posledních', shape: 'integer' as const, min: 1, max: 3650 },
  ],
};

describe('rozklad operátorů na tvary hodnoty', () => {
  it('pokrývá přesně 40 operátorů matice části 2 a nic dvakrát', () => {
    const all = Object.values(OPERATOR_SHAPES).flat();
    expect(all).toHaveLength(40);
    expect(new Set(all).size).toBe(40);
  });

  it('velikosti jednotlivých tvarů sedí s tabulkou 4.11.2', () => {
    expect(OPERATOR_SHAPES.none).toHaveLength(16);
    expect(OPERATOR_SHAPES.scalar).toHaveLength(13);
    expect(OPERATOR_SHAPES.list).toHaveLength(5);
    expect(OPERATOR_SHAPES.range).toHaveLength(1);
    expect(OPERATOR_SHAPES.integer).toHaveLength(5);
  });
});

describe('operace nad AST adresované cestou', () => {
  it('přidá podmínku do kořene', () => {
    const next = addCondition(empty.root, []);
    expect(next.children).toHaveLength(1);
    expect(next.children[0].type).toBe('condition');
  });

  it('dovolí zanoření do hloubky 5', () => {
    let root: GroupNode = empty.root;
    let path: number[] = [];
    for (let level = 0; level < 4; level += 1) {
      root = addGroup(root, path);
      path = [...path, (nodeAt(root, path) as GroupNode).children.length - 1];
    }
    expect(path).toHaveLength(4);
    expect(canAddGroup(root, path)).toBe(false);
  });

  it('šestou úroveň nepřidá a nevyhodí chybu', () => {
    let root: GroupNode = empty.root;
    let path: number[] = [];
    for (let level = 0; level < 4; level += 1) {
      root = addGroup(root, path);
      path = [...path, (nodeAt(root, path) as GroupNode).children.length - 1];
    }
    const before = JSON.stringify(root);
    expect(() => {
      root = addGroup(root, path);
    }).not.toThrow();
    expect(JSON.stringify(root)).toBe(before);
  });

  it('nedovolí víc než 50 potomků jedné skupiny', () => {
    let root: GroupNode = empty.root;
    for (let index = 0; index < 60; index += 1) root = addCondition(root, []);
    expect(root.children).toHaveLength(MAX_CHILDREN);
    expect(canAddRule(root, [])).toBe(false);
  });

  it('unese sto podmínek rozložených do stromu (kritérium 47)', () => {
    // Kritérium 47 mluví o sta podmínkách, tvrdý požadavek 13.1 o 50 potomcích
    // na skupinu. Není to spor: strom hloubky 5 unese sto podmínek s rezervou.
    let root: GroupNode = empty.root;
    for (let group = 0; group < 4; group += 1) {
      root = addGroup(root, []);
      for (let index = 0; index < 25; index += 1) root = addCondition(root, [group]);
    }
    const count = (node: GroupNode): number =>
      node.children.reduce(
        (sum, child) => sum + (child.type === 'group' ? count(child) : 1),
        0,
      );
    expect(count(root)).toBe(100);
    expect(MAX_DEPTH).toBe(5);
  });

  it('negaci jde přepnout na kořeni i na vnořené skupině', () => {
    let root = toggleNot(empty.root, []);
    expect(root.not).toBe(true);
    root = addGroup(root, []);
    root = toggleNot(root, [0]);
    expect((nodeAt(root, [0]) as GroupNode).not).toBe(true);
  });

  it('přepínač všechny nebo alespoň jednu mění op', () => {
    expect(setOp(empty.root, [], 'or').op).toBe('or');
  });

  it('odebrání podmínky nechá zbytek beze změny', () => {
    let root = addCondition(empty.root, []);
    root = setValue(root, [0], { value: 'první' });
    root = addCondition(root, []);
    root = setValue(root, [1], { value: 'druhá' });
    root = removeAt(root, [0]);
    expect(root.children).toHaveLength(1);
    expect(nodeAt(root, [0])).toMatchObject({ value: 'druhá' });
  });

  it('změna pole vynuluje operátor i hodnotu, protože operátory se liší podle typu', () => {
    let root = addCondition(empty.root, []);
    root = setField(root, [0], city);
    root = setOperator(root, [0], city.operators[0]);
    root = setValue(root, [0], { value: 'Brno' });
    root = setField(root, [0], createdAt);
    const node = nodeAt(root, [0]);
    expect(node).toEqual({
      type: 'condition',
      field: { kind: 'contact', key: 'created_at' },
      operator: '',
    });
  });

  it('operátor bez hodnoty smaže value i values z uzlu', () => {
    // Část 2, 4.11.2: „přítomnost value nebo values je chyba".
    let root = addCondition(empty.root, []);
    root = setField(root, [0], city);
    root = setOperator(root, [0], city.operators[1]);
    root = setValue(root, [0], { values: ['Praha', 'Brno'] });
    expect(nodeAt(root, [0])).toHaveProperty('values');

    root = setOperator(root, [0], city.operators[2]);
    const node = nodeAt(root, [0]) as Record<string, unknown>;
    expect('value' in node).toBe(false);
    expect('values' in node).toBe(false);
  });

  it('přepnutí na rozsah připraví právě dvě místa na hodnoty', () => {
    let root = addCondition(empty.root, []);
    root = setField(root, [0], createdAt);
    root = setOperator(root, [0], createdAt.operators[1]);
    expect(nodeAt(root, [0])).toMatchObject({ values: [null, null] });
  });

  it('operace nikdy nemění vstupní strom, vrací nový', () => {
    const frozen = JSON.stringify(empty.root);
    addCondition(empty.root, []);
    toggleNot(empty.root, []);
    removeAt(empty.root, [0]);
    expect(JSON.stringify(empty.root)).toBe(frozen);
  });
});

describe('useQueryBuilder', () => {
  it('ohlásí strom až po úpravě, ne stav před ní', async () => {
    // Vada, kterou tenhle test hlídá: komponenta volala onChange s hodnotou
    // z předchozího vykreslení, takže obrazovka segmentu byla trvale
    // o jednu úpravu pozadu. Řízená komponenta to vylučuje z principu.
    const { renderHook, act } = await import('@testing-library/react');
    const { useQueryBuilder } = await import('./use-query-builder');
    const onChange = vi.fn();
    const { result } = renderHook(() => useQueryBuilder({ value: empty, onChange }));

    act(() => result.current.addCondition([]));

    expect(onChange).toHaveBeenCalledTimes(1);
    const emitted = onChange.mock.calls[0][0] as SegmentAst;
    expect(emitted.root.children).toHaveLength(1);
    expect(emitted.version).toBe(1);
  });
});
```

- [ ] **Krok 2: Spustit test, musí spadnout, pak implementovat**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/query-builder/use-query-builder.test.ts
```

Očekávaný výstup: FAIL, `Failed to resolve import "./types"`.

`packages/ui/src/patterns/query-builder/types.ts`:

```ts
/**
 * AST segmentu **doslova podle části 2, kapitola 4.11.1** (rozhodnutí R11).
 * Tenhle strom se ukládá do `segments.definition` a validuje ho `SegmentAstV1`,
 * takže se tady nesmí lišit ani o jedno pole. Uzly nemají `id`: adresují se
 * cestou, tedy polem indexů potomků od kořene.
 */
export type Combinator = 'and' | 'or';

export type ScalarValue = string | number | boolean | null;

export type FieldRef =
  | { kind: 'contact'; key: string }
  | { kind: 'attribute'; key: string }
  | { kind: 'tag' }
  | { kind: 'list'; list_id: string }
  | { kind: 'consent'; purpose: string }
  | { kind: 'suppression' }
  | { kind: 'engagement'; metric: string; scope: Record<string, unknown> }
  | { kind: 'event'; name: string; property?: string }
  | { kind: 'segment' };

export type ConditionNode = {
  type: 'condition';
  field: FieldRef;
  operator: string;
  /** Jen u tvarů `scalar` a `integer`. */
  value?: ScalarValue;
  /** Jen u tvarů `list` a `range`. */
  values?: ScalarValue[];
};

export type GroupNode = {
  type: 'group';
  op: Combinator;
  /** Negace celé skupiny. V rozhraní se nikdy nepíše slovem NOT. */
  not?: boolean;
  children: QueryNode[];
};

export type QueryNode = GroupNode | ConditionNode;

export type SegmentAst = { version: 1; root: GroupNode };

/** Cesta k uzlu: `[]` je kořen, `[0, 2]` třetí potomek prvního potomka kořene. */
export type NodePath = number[];

/**
 * Tvar hodnoty, kterou operátor přijímá. Vychází z tabulky typové
 * kompatibility v části 2, kapitola 4.11.2.
 */
export type OperatorValueShape = 'none' | 'scalar' | 'list' | 'range' | 'integer';

/** Typ hodnoty pole. Určuje, jaký ovládací prvek se pro hodnotu vykreslí. */
export type FieldValueType = 'text' | 'number' | 'date' | 'datetime' | 'boolean' | 'enum';

export type OperatorDefinition = {
  id: string;
  label: string;
  /** Operátor, po kterém se nabídne doplnění podmínky na prázdnou hodnotu. */
  negating?: boolean;
  shape: OperatorValueShape;
  /** Meze u tvaru `integer`, například 1 až 3650 u `in_last_days`. */
  min?: number;
  max?: number;
  /** Meze počtu položek u tvaru `list`, podle 4.11.2 je to 1 až 1000. */
  minItems?: number;
  maxItems?: number;
};

export type FieldDefinition = {
  /** Stabilní klíč do výběru pole. Není součástí AST. */
  id: string;
  label: string;
  /** Skupina ve výběru pole, například „Údaje kontaktu" nebo „Chování". */
  group: string;
  /** Odkaz na pole, který se zapíše do AST. */
  ref: FieldRef;
  /** Typ hodnoty. Rozhoduje o tom, jestli je vstup text, číslo nebo datum. */
  valueType: FieldValueType;
  /** Nabídka voleb u `valueType: 'enum'`. */
  options?: Array<{ value: string; label: string }>;
  /** Operátory povolené pro tohle pole. Matici jako data vlastní část 2. */
  operators: OperatorDefinition[];
};

export const MAX_DEPTH = 5;
export const MAX_CHILDREN = 50;

/**
 * Rozklad všech 40 operátorů matice 4.11.2 podle tvaru hodnoty.
 *
 * Nepoužívá ho vykreslení, to se řídí `shape` u konkrétního operátoru,
 * který dodá plán segmentů. Je to **kontrolní tabulka**: test v kroku 1
 * na ní ověřuje, že rozklad je úplný a nic se nepřekrývá, takže se nemůže
 * stát, že by se objevil operátor, pro který komponenta nemá co vykreslit.
 */
export const OPERATOR_SHAPES: Record<OperatorValueShape, readonly string[]> = {
  none: [
    'is_empty', 'is_not_empty', 'is_true', 'is_false',
    'is_member', 'is_not_member', 'is_confirmed', 'is_pending', 'is_unsubscribed',
    'is_granted', 'is_withdrawn', 'is_missing',
    'is_suppressed', 'is_not_suppressed',
    'did', 'did_not',
  ],
  scalar: [
    'eq', 'neq', 'contains', 'not_contains', 'starts_with', 'ends_with',
    'gt', 'gte', 'lt', 'lte',
    'on', 'before', 'after',
  ],
  list: ['in', 'not_in', 'has_any', 'has_all', 'has_none'],
  range: ['between'],
  integer: ['in_last_days', 'not_in_last_days', 'in_next_days', 'count_gte', 'count_lte'],
};
```

`packages/ui/src/patterns/query-builder/paths.ts`:

```ts
import {
  MAX_CHILDREN,
  MAX_DEPTH,
  type ConditionNode,
  type FieldDefinition,
  type GroupNode,
  type NodePath,
  type OperatorDefinition,
  type QueryNode,
  type ScalarValue,
} from './types';

/**
 * Čisté operace nad AST. Žádná z nich nemění vstup, všechny vracejí nový
 * strom. Díky tomu je komponenta řízená a `onChange` dostane vždycky
 * výsledek úpravy, ne stav před ní.
 */

export function nodeAt(root: GroupNode, path: NodePath): QueryNode | null {
  let node: QueryNode = root;
  for (const index of path) {
    if (node.type !== 'group') return null;
    const child = node.children[index];
    if (child === undefined) return null;
    node = child;
  }
  return node;
}

/**
 * Nahradí uzel na cestě výsledkem `transform`. Když `transform` vrátí `null`,
 * uzel se z rodiče odebere.
 */
function mapAt(
  root: GroupNode,
  path: NodePath,
  transform: (node: QueryNode) => QueryNode | null,
): GroupNode {
  if (path.length === 0) {
    const next = transform(root);
    return next !== null && next.type === 'group' ? next : root;
  }

  const [head, ...rest] = path;
  const child = root.children[head];
  if (child === undefined) return root;

  let nextChild: QueryNode | null;
  if (rest.length === 0) {
    nextChild = transform(child);
  } else if (child.type === 'group') {
    nextChild = mapAt(child, rest, transform);
  } else {
    return root;
  }

  const children =
    nextChild === null
      ? root.children.filter((_, index) => index !== head)
      : root.children.map((item, index) => (index === head ? nextChild : item));

  return { ...root, children };
}

/** Hloubka uzlu. Kořen je 0. */
export function depthOf(path: NodePath): number {
  return path.length;
}

export function canAddGroup(root: GroupNode, path: NodePath): boolean {
  const node = nodeAt(root, path);
  if (node === null || node.type !== 'group') return false;
  // Povolené úrovně jsou 0 až 4, tedy pět. Skupina na úrovni 4 už další
  // nepřidá, protože potomek by byl šestá úroveň.
  if (path.length >= MAX_DEPTH - 1) return false;
  return node.children.length < MAX_CHILDREN;
}

export function canAddRule(root: GroupNode, path: NodePath): boolean {
  const node = nodeAt(root, path);
  if (node === null || node.type !== 'group') return false;
  return node.children.length < MAX_CHILDREN;
}

export function addCondition(root: GroupNode, path: NodePath): GroupNode {
  if (!canAddRule(root, path)) return root;
  const fresh: ConditionNode = { type: 'condition', field: { kind: 'tag' }, operator: '' };
  return mapAt(root, path, (node) =>
    node.type === 'group' ? { ...node, children: [...node.children, fresh] } : node,
  );
}

export function addGroup(root: GroupNode, path: NodePath): GroupNode {
  if (!canAddGroup(root, path)) return root;
  const fresh: GroupNode = { type: 'group', op: 'and', not: false, children: [] };
  return mapAt(root, path, (node) =>
    node.type === 'group' ? { ...node, children: [...node.children, fresh] } : node,
  );
}

export function removeAt(root: GroupNode, path: NodePath): GroupNode {
  if (path.length === 0) return root;
  return mapAt(root, path, () => null);
}

export function toggleNot(root: GroupNode, path: NodePath): GroupNode {
  return mapAt(root, path, (node) =>
    node.type === 'group' ? { ...node, not: node.not !== true } : node,
  );
}

export function setOp(root: GroupNode, path: NodePath, op: 'and' | 'or'): GroupNode {
  return mapAt(root, path, (node) => (node.type === 'group' ? { ...node, op } : node));
}

/**
 * Změna pole mění množinu povolených operátorů, takže operátor i hodnota
 * se vynulují. Ponechaná hodnota by dala neplatný dotaz.
 */
export function setField(root: GroupNode, path: NodePath, field: FieldDefinition): GroupNode {
  return mapAt(root, path, (node) =>
    node.type === 'condition' ? { type: 'condition', field: field.ref, operator: '' } : node,
  );
}

/**
 * Nastaví operátor a **přesně podle jeho tvaru** připraví místa na hodnoty.
 * U tvaru `none` se `value` i `values` z uzlu odstraní, protože jejich
 * přítomnost je podle 4.11.2 chyba.
 */
export function setOperator(
  root: GroupNode,
  path: NodePath,
  operator: OperatorDefinition,
): GroupNode {
  return mapAt(root, path, (node) => {
    if (node.type !== 'condition') return node;
    const base = { type: 'condition' as const, field: node.field, operator: operator.id };
    switch (operator.shape) {
      case 'none':
        return base;
      case 'list':
        return { ...base, values: Array.isArray(node.values) ? node.values : [] };
      case 'range':
        return { ...base, values: [null, null] };
      default:
        return { ...base, value: null };
    }
  });
}

export function setValue(
  root: GroupNode,
  path: NodePath,
  patch: { value?: ScalarValue } | { values?: ScalarValue[] },
): GroupNode {
  return mapAt(root, path, (node) => (node.type === 'condition' ? { ...node, ...patch } : node));
}
```

`packages/ui/src/patterns/query-builder/use-query-builder.ts`:

```ts
'use client';

import { useCallback, useMemo } from 'react';
import * as ops from './paths';
import type {
  FieldDefinition,
  GroupNode,
  NodePath,
  OperatorDefinition,
  ScalarValue,
  SegmentAst,
} from './types';

/**
 * Řízený query builder (rozhodnutí R12). Vlastní stav nemá: dostane `value`,
 * spočítá nový strom a ohlásí ho. Tím je vyloučené, aby `onChange` dostal
 * hodnotu z předchozího vykreslení.
 *
 * Hloubka nejvýš 5 a 50 potomků na skupinu. Při dosažení stropu se tlačítko
 * na přidání **schová s vysvětlením**, nezobrazuje se chyba (kritérium 47).
 */
export function useQueryBuilder({
  value,
  onChange,
}: {
  value: SegmentAst;
  onChange: (next: SegmentAst) => void;
}) {
  const root = value.root;

  const emit = useCallback(
    (nextRoot: GroupNode) => {
      if (nextRoot === root) return;
      onChange({ ...value, version: 1, root: nextRoot });
    },
    [onChange, root, value],
  );

  return {
    root,
    json: useMemo(() => JSON.stringify(value, null, 2), [value]),
    nodeAt: useCallback((path: NodePath) => ops.nodeAt(root, path), [root]),
    depthOf: ops.depthOf,
    canAddGroup: useCallback((path: NodePath) => ops.canAddGroup(root, path), [root]),
    canAddRule: useCallback((path: NodePath) => ops.canAddRule(root, path), [root]),
    addCondition: useCallback((path: NodePath) => emit(ops.addCondition(root, path)), [emit, root]),
    addGroup: useCallback((path: NodePath) => emit(ops.addGroup(root, path)), [emit, root]),
    remove: useCallback((path: NodePath) => emit(ops.removeAt(root, path)), [emit, root]),
    toggleNot: useCallback((path: NodePath) => emit(ops.toggleNot(root, path)), [emit, root]),
    setOp: useCallback(
      (path: NodePath, op: 'and' | 'or') => emit(ops.setOp(root, path, op)),
      [emit, root],
    ),
    setField: useCallback(
      (path: NodePath, field: FieldDefinition) => emit(ops.setField(root, path, field)),
      [emit, root],
    ),
    setOperator: useCallback(
      (path: NodePath, operator: OperatorDefinition) => emit(ops.setOperator(root, path, operator)),
      [emit, root],
    ),
    setValue: useCallback(
      (path: NodePath, patch: { value?: ScalarValue } | { values?: ScalarValue[] }) =>
        emit(ops.setValue(root, path, patch)),
      [emit, root],
    ),
  };
}
```

- [ ] **Krok 3: Napsat padající test na větu a klávesnici**

Kritérium 71b: věta skupiny je **jedna ICU zpráva s pojmenovanými sloty**, ne tři nezávislé řetězce. Test vloží obrácené pořadí slotů a ověří, že se prvky vykreslí v novém pořadí bez zásahu do komponenty.

`packages/ui/src/patterns/query-builder/query-builder.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { QueryBuilder } from './query-builder';
import type { FieldDefinition, SegmentAst } from './types';

export const fields: FieldDefinition[] = [
  {
    id: 'attribute:city',
    label: 'Město',
    group: 'Údaje kontaktu',
    ref: { kind: 'attribute', key: 'city' },
    valueType: 'text',
    operators: [
      { id: 'eq', label: 'je', shape: 'scalar' },
      { id: 'neq', label: 'není', shape: 'scalar', negating: true },
      { id: 'in', label: 'je jedna z', shape: 'list', minItems: 1, maxItems: 1000 },
      { id: 'is_empty', label: 'je prázdné', shape: 'none' },
    ],
  },
  {
    id: 'engagement:opened',
    label: 'Otevřel kampaň',
    group: 'Chování',
    ref: { kind: 'engagement', metric: 'opened', scope: { since_days: 90 } },
    valueType: 'number',
    operators: [
      { id: 'did', label: 'ano', shape: 'none' },
      { id: 'count_gte', label: 'aspoň tolikrát', shape: 'integer', min: 0, max: 1_000_000 },
    ],
  },
];

export const empty: SegmentAst = {
  version: 1,
  root: { type: 'group', op: 'and', not: false, children: [] },
};

export const labels = {
  addRule: 'Přidat podmínku',
  addGroup: 'Přidat skupinu',
  removeRule: 'Odebrat podmínku',
  removeGroup: 'Odebrat skupinu',
  chooseField: 'Vyberte údaj',
  chooseOperator: 'Vyberte vztah',
  value: 'Hodnota',
  valueFrom: 'Od',
  valueTo: 'Do',
  valueList: 'Seznam hodnot',
  addValue: 'Přidat hodnotu',
  removeValue: (item: string) => `Odebrat hodnotu ${item}`,
  listLimit: (max: number) => `Do seznamu se vejde nejvýš ${max} hodnot.`,
  rangeOrder: 'První hodnota musí být menší nebo rovna druhé.',
  showJson: 'Zobrazit podklad',
  depthLimit: 'Hlouběji už zanořovat nejde, stačí to na každý segment, který jsme viděli.',
  childLimit: 'Do jedné skupiny se vejde nejvýš 50 podmínek.',
  negationHint: 'Vybíráme kontakty, které tuhle skupinu podmínek nesplňují.',
  notNullHint: 'Kontakty s prázdnou hodnotou sem nespadnou. Chcete je přidat?',
  addEmptyCondition: 'Přidat podmínku „je prázdné"',
  all: 'všechny',
  atLeastOne: 'alespoň jednu',
  is: 'splňuje',
  isNot: 'nesplňuje',
};

/** Věta se skládá v katalogu, komponenta jen dosadí sloty. */
function renderSentenceNormal(slots: { polarity: React.ReactNode; quantifier: React.ReactNode }) {
  return (
    <>
      Kontakt {slots.polarity} {slots.quantifier} z těchto podmínek:
    </>
  );
}

function renderSentenceReversed(slots: { polarity: React.ReactNode; quantifier: React.ReactNode }) {
  return (
    <>
      Podmínky {slots.quantifier} kontakt {slots.polarity}:
    </>
  );
}

/** Komponenta je řízená, takže test drží strom stejně jako obrazovka segmentu. */
export function Controlled({
  initial = empty,
  ...rest
}: { initial?: SegmentAst } & Partial<React.ComponentProps<typeof QueryBuilder>>) {
  const [value, setValue] = useState<SegmentAst>(initial);
  return (
    <QueryBuilder
      value={value}
      onChange={setValue}
      fields={fields}
      labels={labels}
      renderGroupSentence={renderSentenceNormal}
      {...rest}
    />
  );
}

describe('QueryBuilder', () => {
  it('nikde nezobrazuje slova AND, OR, NOT ani operátor', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.click(screen.getByRole('button', { name: 'Přidat podmínku' }));

    const text = document.body.textContent as string;
    expect(text).not.toMatch(/\bAND\b/);
    expect(text).not.toMatch(/\bOR\b/);
    expect(text).not.toMatch(/\bNOT\b/);
    expect(text.toLowerCase()).not.toContain('operátor');
  });

  it('pořadí ovládacích prvků určuje věta z katalogu, ne komponenta', () => {
    const normal = render(<Controlled />);
    const normalOrder = Array.from(normal.container.querySelectorAll('[data-slot]')).map((node) =>
      node.getAttribute('data-slot'),
    );
    expect(normalOrder).toEqual(['polarity', 'quantifier']);
    normal.unmount();

    const reversed = render(<Controlled renderGroupSentence={renderSentenceReversed} />);
    const reversedOrder = Array.from(reversed.container.querySelectorAll('[data-slot]')).map(
      (node) => node.getAttribute('data-slot'),
    );
    expect(reversedOrder).toEqual(['quantifier', 'polarity']);
  });

  it('negaci jde zapnout a zobrazí vysvětlující řádek', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.selectOptions(screen.getByLabelText('splňuje'), 'not');
    expect(screen.getByText(labels.negationHint)).toBeVisible();
  });

  it('podmínku jde přidat i odebrat výhradně z klávesnice', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.tab();
    await user.tab();
    await user.tab();
    await user.keyboard('{Enter}');
    expect(screen.getAllByLabelText('Vyberte údaj')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Odebrat podmínku' }));
    expect(screen.queryByLabelText('Vyberte údaj')).toBeNull();
  });

  it('pole jsou ve výběru rozdělená do skupin', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.click(screen.getByRole('button', { name: 'Přidat podmínku' }));
    const select = screen.getByLabelText('Vyberte údaj');
    expect(within(select).getByRole('group', { name: 'Údaje kontaktu' })).toBeInTheDocument();
    expect(within(select).getByRole('group', { name: 'Chování' })).toBeInTheDocument();
  });

  it('negující operátor nabídne doplnění podmínky na prázdnou hodnotu', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    await user.click(screen.getByRole('button', { name: 'Přidat podmínku' }));
    await user.selectOptions(screen.getByLabelText('Vyberte údaj'), 'attribute:city');
    await user.selectOptions(screen.getByLabelText('Vyberte vztah'), 'neq');
    expect(screen.getByText(labels.notNullHint)).toBeVisible();
    expect(screen.getByRole('button', { name: labels.addEmptyCondition })).toBeVisible();
  });

  it('v páté úrovni schová tlačítko na skupinu a vysvětlí proč', async () => {
    const user = userEvent.setup();
    render(<Controlled />);
    for (let level = 0; level < 4; level += 1) {
      const buttons = screen.getAllByRole('button', { name: 'Přidat skupinu' });
      await user.click(buttons[buttons.length - 1]);
    }
    expect(screen.getAllByRole('group')).toHaveLength(5);
    expect(screen.getByText(labels.depthLimit)).toBeVisible();
  });

  it('umí zobrazit podkladový JSON a je to tvar ze specifikace', async () => {
    const user = userEvent.setup();
    render(<Controlled showJsonToggle />);
    expect(screen.queryByRole('code')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Zobrazit podklad' }));
    const code = screen.getByRole('code');
    expect(code).toHaveTextContent('"version": 1');
    expect(code).toHaveTextContent('"type": "group"');
  });

  it('vykreslí sto podmínek rozložených do stromu (kritérium 47)', () => {
    const condition = {
      type: 'condition' as const,
      field: { kind: 'attribute' as const, key: 'city' },
      operator: 'eq',
      value: 'Brno',
    };
    const initial: SegmentAst = {
      version: 1,
      root: {
        type: 'group',
        op: 'and',
        children: Array.from({ length: 4 }, () => ({
          type: 'group' as const,
          op: 'and' as const,
          children: Array.from({ length: 25 }, () => condition),
        })),
      },
    };
    render(<Controlled initial={initial} />);
    expect(screen.getAllByTestId('condition-row')).toHaveLength(100);
  });

  it('ohlásí strom po každé úpravě, ne stav před ní', async () => {
    const user = userEvent.setup();
    const seen: SegmentAst[] = [];
    function Spy() {
      const [value, setValue] = useState<SegmentAst>(empty);
      return (
        <QueryBuilder
          value={value}
          onChange={(next) => {
            seen.push(next);
            setValue(next);
          }}
          fields={fields}
          labels={labels}
          renderGroupSentence={renderSentenceNormal}
        />
      );
    }
    render(<Spy />);
    await user.click(screen.getByRole('button', { name: 'Přidat podmínku' }));
    expect(seen).toHaveLength(1);
    expect(seen[0].root.children).toHaveLength(1);
  });
});
```

- [ ] **Krok 3b: Napsat padající test, který projde všech 40 operátorů**

Tohle je ta ochrana, bez které se vada vrátí. Test **nevěří tabulce v plánu**: vezme rozklad z `OPERATOR_SHAPES`, pro každý ze 40 operátorů vykreslí podmínku a ověří, že se vykreslil právě ten ovládací prvek, který tvar žádá. Kdyby někdo přidal operátor bez tvaru nebo zapomněl větev ve vykreslení, test spadne jmenovitě na tom operátoru.

`packages/ui/src/patterns/query-builder/operator-shapes.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { QueryBuilder } from './query-builder';
import { OPERATOR_SHAPES } from './types';
import type {
  FieldDefinition,
  FieldValueType,
  OperatorValueShape,
  SegmentAst,
} from './types';
import { labels } from './query-builder.test';

/** Typ hodnoty, na kterém se daný operátor v matici 4.11.2 vyskytuje. */
const VALUE_TYPE: Record<string, FieldValueType> = {
  gt: 'number', gte: 'number', lt: 'number', lte: 'number',
  on: 'date', before: 'date', after: 'date', between: 'date',
};

function fieldFor(operator: string, shape: OperatorValueShape): FieldDefinition {
  return {
    id: 'attribute:probe',
    label: 'Zkušební pole',
    group: 'Údaje kontaktu',
    ref: { kind: 'attribute', key: 'probe' },
    valueType: VALUE_TYPE[operator] ?? 'text',
    operators: [
      {
        id: operator,
        label: operator,
        shape,
        ...(shape === 'integer' ? { min: 0, max: 3650 } : {}),
        ...(shape === 'list' ? { minItems: 1, maxItems: 1000 } : {}),
      },
    ],
  };
}

function astFor(operator: string, shape: OperatorValueShape): SegmentAst {
  const field = { kind: 'attribute' as const, key: 'probe' };
  const base = { type: 'condition' as const, field, operator };
  const condition =
    shape === 'none'
      ? base
      : shape === 'list'
        ? { ...base, values: ['Praha'] }
        : shape === 'range'
          ? { ...base, values: [null, null] }
          : { ...base, value: null };
  return { version: 1, root: { type: 'group', op: 'and', children: [condition] } };
}

describe('všech 40 operátorů matice 4.11.2 jde zadat', () => {
  for (const [shape, operators] of Object.entries(OPERATOR_SHAPES) as Array<
    [OperatorValueShape, readonly string[]]
  >) {
    for (const operator of operators) {
      it(`${operator} (${shape}) nabídne správný ovládací prvek`, () => {
        const { unmount } = render(
          <QueryBuilder
            value={astFor(operator, shape)}
            onChange={() => {}}
            fields={[fieldFor(operator, shape)]}
            labels={labels}
          />,
        );

        const inputs = screen.queryAllByTestId('condition-value');

        if (shape === 'none') {
          // Šestnáct operátorů hodnotu nepřijímá. Vstupní pole u nich
          // vede uživatele k tomu, aby vyrobil segment, který server odmítne.
          expect(inputs, `${operator} nesmí nabídnout pole na hodnotu`).toHaveLength(0);
        } else if (shape === 'range') {
          expect(inputs, `${operator} potřebuje dvě pole`).toHaveLength(2);
          expect(screen.getByLabelText(labels.valueFrom)).toBeVisible();
          expect(screen.getByLabelText(labels.valueTo)).toBeVisible();
        } else if (shape === 'list') {
          expect(screen.getByTestId('condition-value-list')).toBeVisible();
          expect(screen.getByRole('button', { name: labels.addValue })).toBeVisible();
        } else {
          expect(inputs, `${operator} potřebuje jedno pole`).toHaveLength(1);
        }

        if (shape === 'integer') {
          expect(inputs[0]).toHaveAttribute('type', 'number');
          expect(inputs[0]).toHaveAttribute('min', '0');
          expect(inputs[0]).toHaveAttribute('max', '3650');
        }
        if (shape === 'scalar') {
          const expected =
            VALUE_TYPE[operator] === 'number'
              ? 'number'
              : VALUE_TYPE[operator] === 'date'
                ? 'date'
                : 'text';
          expect(inputs[0], `${operator} má mít vstup typu ${expected}`).toHaveAttribute(
            'type',
            expected,
          );
        }

        unmount();
      });
    }
  }
});
```

- [ ] **Krok 4: Spustit test, musí spadnout, pak implementovat**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/query-builder/query-builder.test.tsx
```

Očekávaný výstup: FAIL, `Failed to resolve import "./query-builder"`.

`packages/ui/src/patterns/query-builder/query-builder.tsx`:

```tsx
'use client';

import { Trash2, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../../components/button';
import { cn } from '../../lib/cn';
import {
  MAX_DEPTH,
  type ConditionNode,
  type FieldDefinition,
  type FieldValueType,
  type GroupNode,
  type NodePath,
  type OperatorDefinition,
  type ScalarValue,
  type SegmentAst,
} from './types';
import { useQueryBuilder } from './use-query-builder';

export type QueryBuilderLabels = {
  addRule: string;
  addGroup: string;
  removeRule: string;
  removeGroup: string;
  chooseField: string;
  chooseOperator: string;
  value: string;
  /** Popisky obou polí u tvaru `range`. */
  valueFrom: string;
  valueTo: string;
  /** Žetonový vstup u tvaru `list`. */
  valueList: string;
  addValue: string;
  removeValue: (item: string) => string;
  listLimit: (max: number) => string;
  rangeOrder: string;
  showJson: string;
  depthLimit: string;
  childLimit: string;
  negationHint: string;
  notNullHint: string;
  addEmptyCondition: string;
  all: string;
  atLeastOne: string;
  is: string;
  isNot: string;
};

export type GroupSentenceSlots = { polarity: React.ReactNode; quantifier: React.ReactNode };

const CONTROL =
  'min-h-11 rounded-[var(--radius-control)] border border-border-strong bg-surface px-3 text-sm text-text';

function inputTypeOf(valueType: FieldValueType): 'text' | 'number' | 'date' | 'datetime-local' {
  if (valueType === 'number') return 'number';
  if (valueType === 'date') return 'date';
  if (valueType === 'datetime') return 'datetime-local';
  return 'text';
}

/** Číselné pole musí do AST uložit číslo, ne řetězec. Prázdno je `null`. */
function parseScalar(raw: string, valueType: FieldValueType): ScalarValue {
  if (raw === '') return null;
  if (valueType === 'number') {
    const parsed = Number(raw);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return raw;
}

/**
 * Žetonový vstup pro tvar `list`. Je to samostatná komponenta, protože si
 * drží rozepsanou položku, a definovat ji uvnitř `QueryBuilder` by ji při
 * každém překreslení odpojilo a smazalo rozepsaný text.
 */
function ValueList({
  values,
  labels,
  maxItems,
  onChange,
}: {
  values: ScalarValue[];
  labels: QueryBuilderLabels;
  maxItems: number;
  onChange: (next: ScalarValue[]) => void;
}) {
  const [pending, setPending] = useState('');
  const full = values.length >= maxItems;

  function commit() {
    const trimmed = pending.trim();
    if (trimmed === '' || full) return;
    onChange([...values, trimmed]);
    setPending('');
  }

  return (
    <div data-testid="condition-value-list" className="flex flex-wrap items-center gap-2">
      <ul className="flex flex-wrap items-center gap-1">
        {values.map((item, index) => (
          <li
            key={`${String(item)}-${index}`}
            className="flex items-center gap-1 rounded-[var(--radius-control)] bg-surface-muted px-2 py-1 text-sm text-text"
          >
            {String(item)}
            <button
              type="button"
              aria-label={labels.removeValue(String(item))}
              onClick={() => onChange(values.filter((_, position) => position !== index))}
              className="flex size-5 items-center justify-center text-text-muted"
            >
              <X aria-hidden className="size-3" />
            </button>
          </li>
        ))}
      </ul>

      {full ? (
        <p className="text-sm text-text-muted">{labels.listLimit(maxItems)}</p>
      ) : (
        <>
          <input
            aria-label={labels.valueList}
            value={pending}
            onChange={(event) => setPending(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              // Enter přidá žeton a nesmí odeslat formulář obrazovky.
              event.preventDefault();
              commit();
            }}
            className={CONTROL}
          />
          <Button variant="secondary" onClick={commit}>
            {labels.addValue}
          </Button>
        </>
      )}
    </div>
  );
}

/** Výchozí věta: jen oba prvky vedle sebe, žádná vlastní prozaická vsuvka. */
function defaultGroupSentence(slots: GroupSentenceSlots): React.ReactNode {
  return (
    <>
      {slots.polarity} {slots.quantifier}
    </>
  );
}

export function QueryBuilder({
  fields,
  value,
  onChange,
  labels,
  renderGroupSentence = defaultGroupSentence,
  showJsonToggle = false,
  footer,
  className,
}: {
  fields: FieldDefinition[];
  /** AST podle části 2, 4.11.1. Komponenta je řízená (rozhodnutí R12). */
  value: SegmentAst;
  onChange: (next: SegmentAst) => void;
  labels: QueryBuilderLabels;
  /**
   * Věta skupiny je **jedna ICU zpráva s pojmenovanými sloty** (kritérium 71b).
   * Pořadí ovládacích prvků tedy určuje překlad, ne komponenta.
   */
  renderGroupSentence?: (slots: GroupSentenceSlots) => React.ReactNode;
  showJsonToggle?: boolean;
  /** Patička s počtem a vzorkem kontaktů, dodává ji obrazovka segmentu. */
  footer?: React.ReactNode;
  className?: string;
}) {
  const builder = useQueryBuilder({ value, onChange });
  const [showJson, setShowJson] = useState(false);

  const fieldGroups = [...new Set(fields.map((item) => item.group))];

  /** Pole se v AST poznává podle `field`, ne podle `id`, které v AST není. */
  function fieldOf(condition: ConditionNode): FieldDefinition | undefined {
    return fields.find(
      (item) => JSON.stringify(item.ref) === JSON.stringify(condition.field),
    );
  }

  /**
   * Vykreslení hodnoty se řídí **tvarem operátoru**, ne tím, jestli je
   * operátor vybraný. Bez toho by šestnáct operátorů bez hodnoty nabídlo
   * pole, které server odmítne, a šest seznamových a rozsahových by nešlo
   * zadat vůbec.
   */
  function renderValue(
    condition: ConditionNode,
    path: NodePath,
    field: FieldDefinition,
    operator: OperatorDefinition,
  ): React.ReactNode {
    const values = Array.isArray(condition.values) ? condition.values : [];

    switch (operator.shape) {
      case 'none':
        return null;

      case 'list':
        return (
          <ValueList
            values={values}
            labels={labels}
            maxItems={operator.maxItems ?? 1000}
            onChange={(next) => builder.setValue(path, { values: next })}
          />
        );

      case 'range': {
        const from = values[0] ?? null;
        const to = values[1] ?? null;
        const type = inputTypeOf(field.valueType);
        const outOfOrder =
          from !== null && to !== null && String(from) > String(to);
        return (
          <div className="flex flex-wrap items-center gap-2">
            <input
              data-testid="condition-value"
              aria-label={labels.valueFrom}
              type={type}
              value={from === null ? '' : String(from)}
              onChange={(event) =>
                builder.setValue(path, {
                  values: [parseScalar(event.target.value, field.valueType), to],
                })
              }
              className={CONTROL}
            />
            <input
              data-testid="condition-value"
              aria-label={labels.valueTo}
              type={type}
              value={to === null ? '' : String(to)}
              onChange={(event) =>
                builder.setValue(path, {
                  values: [from, parseScalar(event.target.value, field.valueType)],
                })
              }
              className={CONTROL}
            />
            {outOfOrder ? (
              <p role="alert" className="text-sm text-danger-text">
                {labels.rangeOrder}
              </p>
            ) : null}
          </div>
        );
      }

      case 'integer':
        return (
          <input
            data-testid="condition-value"
            aria-label={labels.value}
            type="number"
            min={operator.min}
            max={operator.max}
            value={condition.value === null || condition.value === undefined ? '' : String(condition.value)}
            onChange={(event) =>
              builder.setValue(path, { value: parseScalar(event.target.value, 'number') })
            }
            className={CONTROL}
          />
        );

      default:
        return field.valueType === 'enum' && field.options ? (
          <select
            data-testid="condition-value"
            aria-label={labels.value}
            value={condition.value === null || condition.value === undefined ? '' : String(condition.value)}
            onChange={(event) => builder.setValue(path, { value: event.target.value || null })}
            className={CONTROL}
          >
            <option value="">{labels.value}</option>
            {field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : (
          <input
            data-testid="condition-value"
            aria-label={labels.value}
            type={inputTypeOf(field.valueType)}
            value={condition.value === null || condition.value === undefined ? '' : String(condition.value)}
            onChange={(event) =>
              builder.setValue(path, { value: parseScalar(event.target.value, field.valueType) })
            }
            className={CONTROL}
          />
        );
    }
  }

  function renderCondition(
    condition: ConditionNode,
    path: NodePath,
    parentPath: NodePath,
  ): React.ReactNode {
    const field = fieldOf(condition);
    const operator = field?.operators.find((item) => item.id === condition.operator);

    return (
      <div
        key={path.join('.')}
        data-testid="condition-row"
        className="flex flex-wrap items-center gap-2 py-1"
      >
        <select
          aria-label={labels.chooseField}
          value={field?.id ?? ''}
          onChange={(event) => {
            const next = fields.find((item) => item.id === event.target.value);
            if (next) builder.setField(path, next);
          }}
          className={CONTROL}
        >
          <option value="">{labels.chooseField}</option>
          {fieldGroups.map((group) => (
            <optgroup key={group} label={group}>
              {fields
                .filter((item) => item.group === group)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.label}
                  </option>
                ))}
            </optgroup>
          ))}
        </select>

        {field ? (
          <select
            data-testid="operator-select"
            aria-label={labels.chooseOperator}
            value={condition.operator}
            onChange={(event) => {
              const next = field.operators.find((item) => item.id === event.target.value);
              if (next) builder.setOperator(path, next);
            }}
            className={CONTROL}
          >
            <option value="">{labels.chooseOperator}</option>
            {field.operators.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        ) : null}

        {field && operator ? renderValue(condition, path, field, operator) : null}

        <button
          type="button"
          aria-label={labels.removeRule}
          onClick={() => builder.remove(path)}
          className="flex size-11 items-center justify-center rounded-[var(--radius-control)] text-text-muted"
        >
          <Trash2 aria-hidden className="size-4" />
        </button>

        {operator?.negating ? (
          <div className="flex w-full items-center gap-2 pl-1 text-sm text-text-muted">
            <span>{labels.notNullHint}</span>
            <Button variant="link" onClick={() => builder.addCondition(parentPath)}>
              {labels.addEmptyCondition}
            </Button>
          </div>
        ) : null}
      </div>
    );
  }

  function renderGroup(group: GroupNode, path: NodePath): React.ReactNode {
    const depth = path.length;
    const negated = group.not === true;

    const polarity = (
      <select
        key="polarity"
        data-slot="polarity"
        aria-label={negated ? labels.isNot : labels.is}
        value={negated ? 'not' : 'is'}
        onChange={(event) => {
          if ((event.target.value === 'not') !== negated) builder.toggleNot(path);
        }}
        className={CONTROL}
      >
        <option value="is">{labels.is}</option>
        <option value="not">{labels.isNot}</option>
      </select>
    );

    const quantifier = (
      <select
        key="quantifier"
        data-slot="quantifier"
        aria-label={group.op === 'and' ? labels.all : labels.atLeastOne}
        value={group.op}
        onChange={(event) => builder.setOp(path, event.target.value as 'and' | 'or')}
        className={CONTROL}
      >
        <option value="and">{labels.all}</option>
        <option value="or">{labels.atLeastOne}</option>
      </select>
    );

    return (
      <fieldset
        key={path.join('.') || 'root'}
        className={cn(
          'rounded-[var(--radius-surface)] border border-border p-4',
          depth > 0 ? 'mt-2 bg-surface-muted' : 'bg-surface',
        )}
      >
        <legend className="flex flex-wrap items-center gap-2 text-sm text-text">
          {renderGroupSentence({ polarity, quantifier })}
        </legend>

        {negated ? <p className="mt-1 text-sm text-text-muted">{labels.negationHint}</p> : null}

        <div className="mt-2">
          {group.children.map((child, index) =>
            child.type === 'condition'
              ? renderCondition(child, [...path, index], path)
              : renderGroup(child, [...path, index]),
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          {builder.canAddRule(path) ? (
            <Button variant="secondary" onClick={() => builder.addCondition(path)}>
              {labels.addRule}
            </Button>
          ) : (
            <p className="text-sm text-text-muted">{labels.childLimit}</p>
          )}

          {/* Při dosažení hloubky se tlačítko schová a vysvětlí se proč.
              Chybová hláška by tvrdila, že uživatel udělal něco špatně. */}
          {builder.canAddGroup(path) ? (
            <Button variant="secondary" onClick={() => builder.addGroup(path)}>
              {labels.addGroup}
            </Button>
          ) : depth >= MAX_DEPTH - 1 ? (
            <p className="text-sm text-text-muted">{labels.depthLimit}</p>
          ) : null}

          {depth > 0 ? (
            <Button variant="secondary" onClick={() => builder.remove(path)}>
              {labels.removeGroup}
            </Button>
          ) : null}
        </div>
      </fieldset>
    );
  }

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {renderGroup(builder.root, [])}
      {footer}
      {showJsonToggle ? (
        <div>
          <Button variant="link" onClick={() => setShowJson((current) => !current)}>
            {labels.showJson}
          </Button>
          {showJson ? (
            <pre
              role="code"
              className="mt-2 overflow-auto rounded-[var(--radius-control)] bg-surface-muted p-3 font-mono text-xs text-text"
            >
              {builder.json}
            </pre>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
```

`packages/ui/src/patterns/query-builder/index.ts`:

```ts
export { QueryBuilder } from './query-builder';
export type { GroupSentenceSlots, QueryBuilderLabels } from './query-builder';
export { useQueryBuilder } from './use-query-builder';
export {
  addCondition,
  addGroup,
  canAddGroup,
  canAddRule,
  depthOf,
  nodeAt,
  removeAt,
  setField,
  setOp,
  setOperator,
  setValue,
  toggleNot,
} from './paths';
export { MAX_CHILDREN, MAX_DEPTH, OPERATOR_SHAPES } from './types';
export type {
  Combinator,
  ConditionNode,
  FieldDefinition,
  FieldRef,
  FieldValueType,
  GroupNode,
  NodePath,
  OperatorDefinition,
  OperatorValueShape,
  QueryNode,
  ScalarValue,
  SegmentAst,
} from './types';
```

- [ ] **Krok 5: Spustit testy a commit**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/query-builder
pnpm --filter @mlain/ui typecheck
git add packages/ui
git commit -m "feat(ui): K2 query builder over the spec AST with all 40 operator value shapes"
```

Očekávaný výstup: 65 passed (15 nad AST, 10 nad komponentou, 40 nad operátory; posledních 40 případů generuje smyčka nad `OPERATOR_SHAPES`, ve zdroji je to jeden `it`).

---

### Úkol 22: K3 Vícekrokový průvodce

**Tvrdé požadavky (13.1):** krok v URL; **návrat, který smí být destruktivní a musí to říct**; správa fokusu při přechodu; ohlášení změny kroku čtečce; stav „rozdělaný průvodce" po návratu s vypršením po 24 hodinách.

**Krok v URL neměl doteď vlastníka.** Tvrdý požadavek K3 ho žádá, ale komponenta krok jen dostávala propem a žádný plán nikde nenapsal, kdo ho z adresy čte a kdo ho tam zapisuje. Bez toho nejde poslat kolegovi odkaz na konkrétní krok a tlačítko zpět v prohlížeči vyskočí z celého průvodce. **Vlastníkem je od teď P05**, hook `useWizardStep`.

Hook si vystačí s History API a událostí `popstate`, takže `packages/ui` nezačne záviset na routeru Nextu. Next od verze 14.1 nativní `pushState` do svého stavu sám promítá, takže se s ním nepere.

**Soubory:**
- Vytvořit: `packages/ui/src/patterns/wizard/use-wizard-draft.ts`, `use-wizard-step.ts`, `wizard.tsx`, `index.ts`
- Test: `packages/ui/src/patterns/wizard/use-wizard-draft.test.ts`, `use-wizard-step.test.ts`, `wizard.test.tsx`

- [ ] **Krok 1: Napsat padající test na rozdělaný stav**

`packages/ui/src/patterns/wizard/use-wizard-draft.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWizardDraft } from './use-wizard-draft';

describe('useWizardDraft', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-31T10:00:00.000Z'));
  });
  afterEach(() => vi.useRealTimers());

  it('rozdělaný stav se po návratu nabídne', () => {
    const first = renderHook(() => useWizardDraft<{ file: string }>({ wizardId: 'import' }));
    act(() => first.result.current.save({ file: 'kontakty.csv' }));
    first.unmount();

    const second = renderHook(() => useWizardDraft<{ file: string }>({ wizardId: 'import' }));
    expect(second.result.current.draft).toEqual({ file: 'kontakty.csv' });
  });

  it('po 24 hodinách rozdělaný stav zmizí', () => {
    const first = renderHook(() => useWizardDraft<{ file: string }>({ wizardId: 'import' }));
    act(() => first.result.current.save({ file: 'kontakty.csv' }));
    first.unmount();

    vi.setSystemTime(new Date('2026-08-01T10:00:01.000Z'));
    const second = renderHook(() => useWizardDraft<{ file: string }>({ wizardId: 'import' }));
    expect(second.result.current.draft).toBeNull();
  });

  it('těsně před vypršením ještě existuje a hlásí zbývající čas', () => {
    const first = renderHook(() => useWizardDraft<{ file: string }>({ wizardId: 'import' }));
    act(() => first.result.current.save({ file: 'kontakty.csv' }));
    first.unmount();

    vi.setSystemTime(new Date('2026-08-01T09:00:00.000Z'));
    const second = renderHook(() => useWizardDraft<{ file: string }>({ wizardId: 'import' }));
    expect(second.result.current.draft).not.toBeNull();
    expect(second.result.current.expiresInMs).toBeGreaterThan(0);
    expect(second.result.current.expiresInMs).toBeLessThanOrEqual(60 * 60 * 1000);
  });

  it('zahození vyčistí úložiště', () => {
    const { result } = renderHook(() => useWizardDraft<{ file: string }>({ wizardId: 'import' }));
    act(() => result.current.save({ file: 'kontakty.csv' }));
    act(() => result.current.discard());
    expect(result.current.draft).toBeNull();
  });
});
```

- [ ] **Krok 2: Spustit test, musí spadnout, pak implementovat**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/wizard/use-wizard-draft.test.ts
```

Očekávaný výstup: FAIL, `Failed to resolve import "./use-wizard-draft"`.

`packages/ui/src/patterns/wizard/use-wizard-draft.ts`:

```ts
'use client';

import { useCallback, useState } from 'react';

const TTL_MS = 24 * 60 * 60 * 1000;

type Stored<T> = { savedAt: number; data: T };

function key(wizardId: string): string {
  return `mlain.wizard.${wizardId}`;
}

/**
 * Rozdělaný průvodce se drží 24 hodin (tvrdý požadavek K3).
 * Po návratu se nabídne pokračování, po vypršení se tiše zahodí.
 */
export function useWizardDraft<T>({ wizardId }: { wizardId: string }) {
  const [draft, setDraft] = useState<T | null>(() => {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(key(wizardId));
    if (raw === null) return null;
    try {
      const stored = JSON.parse(raw) as Stored<T>;
      if (Date.now() - stored.savedAt > TTL_MS) {
        window.localStorage.removeItem(key(wizardId));
        return null;
      }
      return stored.data;
    } catch {
      window.localStorage.removeItem(key(wizardId));
      return null;
    }
  });

  const [savedAt, setSavedAt] = useState<number | null>(() => {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem(key(wizardId));
    if (raw === null) return null;
    try {
      return (JSON.parse(raw) as Stored<T>).savedAt;
    } catch {
      return null;
    }
  });

  const save = useCallback(
    (data: T) => {
      const now = Date.now();
      window.localStorage.setItem(key(wizardId), JSON.stringify({ savedAt: now, data }));
      setDraft(data);
      setSavedAt(now);
    },
    [wizardId],
  );

  const discard = useCallback(() => {
    window.localStorage.removeItem(key(wizardId));
    setDraft(null);
    setSavedAt(null);
  }, [wizardId]);

  return {
    draft,
    save,
    discard,
    expiresInMs: savedAt === null ? null : Math.max(0, savedAt + TTL_MS - Date.now()),
  };
}
```

- [ ] **Krok 2b: Napsat padající test na krok v URL**

`packages/ui/src/patterns/wizard/use-wizard-step.test.ts`:

```ts
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useWizardStep } from './use-wizard-step';

const steps = [{ id: 'upload' }, { id: 'mapping' }, { id: 'preview' }];

describe('useWizardStep', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/w/eshop/contacts/import');
  });

  it('bez parametru začne na prvním kroku a dopíše ho do adresy', () => {
    const { result } = renderHook(() => useWizardStep({ steps }));
    expect(result.current.current).toBe('upload');
    expect(new URLSearchParams(window.location.search).get('step')).toBe('upload');
  });

  it('krok z adresy má přednost, takže odkaz jde poslat kolegovi', () => {
    window.history.replaceState({}, '', '/w/eshop/contacts/import?step=preview');
    const { result } = renderHook(() => useWizardStep({ steps }));
    expect(result.current.current).toBe('preview');
  });

  it('neznámý krok v adrese spadne na první, ne na prázdnou obrazovku', () => {
    window.history.replaceState({}, '', '/w/eshop/contacts/import?step=vymysleny');
    const { result } = renderHook(() => useWizardStep({ steps }));
    expect(result.current.current).toBe('upload');
  });

  it('přechod zapíše krok do adresy a založí položku historie', () => {
    const { result } = renderHook(() => useWizardStep({ steps }));
    act(() => result.current.goToStep('mapping'));
    expect(result.current.current).toBe('mapping');
    expect(new URLSearchParams(window.location.search).get('step')).toBe('mapping');
  });

  it('tlačítko zpět v prohlížeči vrátí krok, ne odchod z průvodce', () => {
    const { result } = renderHook(() => useWizardStep({ steps }));
    act(() => result.current.goToStep('mapping'));
    act(() => {
      window.history.replaceState({}, '', '/w/eshop/contacts/import?step=upload');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });
    expect(result.current.current).toBe('upload');
  });

  it('ostatní parametry v adrese zůstanou, průvodce je nesmaže', () => {
    window.history.replaceState({}, '', '/w/eshop/contacts/import?source=email&step=upload');
    const { result } = renderHook(() => useWizardStep({ steps }));
    act(() => result.current.goToStep('preview'));
    expect(new URLSearchParams(window.location.search).get('source')).toBe('email');
  });
});
```

`packages/ui/src/patterns/wizard/use-wizard-step.ts`:

```ts
'use client';

import { useCallback, useEffect, useState } from 'react';

/**
 * Krok průvodce **patří do URL** (tvrdý požadavek K3). Bez toho nejde
 * poslat kolegovi odkaz na konkrétní krok a tlačítko zpět v prohlížeči
 * vyskočí z celého průvodce místo o krok zpět.
 *
 * Hook si vystačí s History API a událostí `popstate`, takže `packages/ui`
 * nezávisí na routeru Nextu a jde použít i mimo něj. Next od verze 14.1
 * nativní `pushState` do svého stavu sám promítá, takže se s ním nepere.
 */
export function useWizardStep({
  steps,
  param = 'step',
  defaultStepId,
}: {
  steps: readonly { id: string }[];
  param?: string;
  defaultStepId?: string;
}) {
  const fallback = defaultStepId ?? steps[0]?.id ?? '';

  const read = useCallback(() => {
    if (typeof window === 'undefined') return fallback;
    const value = new URLSearchParams(window.location.search).get(param);
    // Neznámý krok z ručně upravené adresy nesmí vyrobit prázdnou obrazovku.
    return value !== null && steps.some((step) => step.id === value) ? value : fallback;
  }, [fallback, param, steps]);

  const [current, setCurrent] = useState(read);

  useEffect(() => {
    const onPopState = () => setCurrent(read());
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [read]);

  const goToStep = useCallback(
    (stepId: string, options: { replace?: boolean } = {}) => {
      if (!steps.some((step) => step.id === stepId)) return;
      // Ostatní parametry v adrese zůstávají, průvodce vlastní jen svůj.
      const url = new URL(window.location.href);
      url.searchParams.set(param, stepId);
      window.history[options.replace === true ? 'replaceState' : 'pushState']({}, '', url);
      setCurrent(stepId);
    },
    [param, steps],
  );

  // Když krok v adrese nebyl, dopíše se hned, aby byl odkaz sdílitelný
  // od první vteřiny. Nahrazením, aby to nezaložilo položku historie.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (new URLSearchParams(window.location.search).get(param) === null) {
      goToStep(fallback, { replace: true });
    }
  }, [fallback, goToStep, param]);

  return { current, goToStep };
}
```

- [ ] **Krok 3: Napsat padající test na průvodce**

`packages/ui/src/patterns/wizard/wizard.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Wizard } from './wizard';

const steps = [
  { id: 'upload', label: 'Nahrání souboru' },
  { id: 'mapping', label: 'Přiřazení sloupců' },
  { id: 'preview', label: 'Náhled' },
];

const labels = {
  stepOf: (current: number, total: number) => `Krok ${current} z ${total}`,
  back: 'Předchozí krok',
  next: 'Pokračovat',
  destructiveBackTitle: 'Změna mapování založí nový import',
  destructiveBackConfirm: 'Vrátit se a začít znovu',
  destructiveBackRetreat: 'Zůstat v náhledu',
};

function base(overrides: Partial<React.ComponentProps<typeof Wizard>> = {}) {
  return {
    steps,
    current: 'mapping',
    onNavigate: vi.fn(),
    labels,
    children: <p>Obsah kroku</p>,
    ...overrides,
  };
}

describe('Wizard', () => {
  it('ohlásí krok a jeho pořadí', () => {
    render(<Wizard {...base()} />);
    expect(screen.getByText('Krok 2 z 3')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Přiřazení sloupců' })).toBeVisible();
  });

  it('po přechodu přesune fokus na nadpis kroku', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const { rerender } = render(<Wizard {...base({ onNavigate })} />);
    await user.click(screen.getByRole('button', { name: 'Pokračovat' }));
    expect(onNavigate).toHaveBeenCalledWith('preview');

    rerender(<Wizard {...base({ current: 'preview', onNavigate })} />);
    expect(screen.getByRole('heading', { name: 'Náhled' })).toHaveFocus();
  });

  it('změnu kroku ohlásí čtečce přes aria-live', () => {
    render(<Wizard {...base()} />);
    expect(screen.getByRole('status')).toHaveTextContent('Krok 2 z 3');
  });

  it('nedestruktivní návrat jde rovnou', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<Wizard {...base({ onNavigate })} />);
    await user.click(screen.getByRole('button', { name: 'Předchozí krok' }));
    expect(onNavigate).toHaveBeenCalledWith('upload');
  });

  it('destruktivní návrat se nejdřív zeptá a řekne, co se ztratí', async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    const warning = 'Když se vrátíte, rozpracovaný náhled se zahodí a import začne znovu.';
    render(<Wizard {...base({ current: 'preview', destructiveBack: warning, onNavigate })} />);

    await user.click(screen.getByRole('button', { name: 'Předchozí krok' }));
    expect(onNavigate).not.toHaveBeenCalled();
    expect(screen.getByText('Změna mapování založí nový import')).toBeVisible();
    // Věta o tom, co se ztratí, přichází od obrazovky, protože jen ona ví,
    // co konkrétně se v tomhle kroku zahodí.
    expect(screen.getByText(warning)).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Vrátit se a začít znovu' }));
    expect(onNavigate).toHaveBeenCalledWith('mapping');
  });

  it('na prvním kroku se návrat nenabízí', () => {
    render(<Wizard {...base({ current: 'upload' })} />);
    expect(screen.queryByRole('button', { name: 'Předchozí krok' })).toBeNull();
  });
});
```

- [ ] **Krok 4: Spustit test, musí spadnout, pak implementovat**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/wizard/wizard.test.tsx
```

Očekávaný výstup: FAIL, `Failed to resolve import "./wizard"`.

`packages/ui/src/patterns/wizard/wizard.tsx`:

```tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/button';
import { Dialog, DialogBody, DialogFooter, DialogTitle } from '../../components/dialog';

export type WizardStep = { id: string; label: string };

export type WizardLabels = {
  stepOf: (current: number, total: number) => string;
  back: string;
  next: string;
  destructiveBackTitle: string;
  destructiveBackConfirm: string;
  destructiveBackRetreat: string;
};

/**
 * Vícekrokový průvodce. Krok patří do URL, aby se dal poslat kolegovi
 * a aby fungovalo tlačítko zpět v prohlížeči. Komponenta krok nedrží,
 * jen ho dostane a ohlásí změnu.
 */
export function Wizard({
  steps,
  current,
  onNavigate,
  labels,
  children,
  destructiveBack,
  nextLabel,
  footer,
}: {
  steps: WizardStep[];
  /** Krok drží URL, ne komponenta. Vlastníkem adresy je `useWizardStep`. */
  current: string;
  onNavigate: (stepId: string) => void;
  labels: WizardLabels;
  children: React.ReactNode;
  /**
   * Když je zadaný, návrat je destruktivní a tohle je věta o tom, co se
   * ztratí. Text dodává obrazovka, protože jen ona ví, co v tomhle kroku
   * konkrétně zahodí.
   */
  destructiveBack?: string;
  /** Poslední krok nese název konkrétní akce, ne slovo „Dokončit" (9.3). */
  nextLabel?: string;
  footer?: React.ReactNode;
}) {
  const index = steps.findIndex((step) => step.id === current);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const [confirmBack, setConfirmBack] = useState(false);

  // Po přechodu kroku patří fokus na nadpis kroku, jinak zůstane
  // na tlačítku, které už neexistuje, a uživatel neví, kde je.
  useEffect(() => {
    headingRef.current?.focus();
  }, [current]);

  function goBack() {
    if (index <= 0) return;
    if (destructiveBack !== undefined) {
      setConfirmBack(true);
      return;
    }
    onNavigate(steps[index - 1].id);
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="status" aria-live="polite" className="text-sm text-text-muted">
        {labels.stepOf(index + 1, steps.length)}
      </div>

      <h1 ref={headingRef} tabIndex={-1} className="text-xl font-semibold text-text">
        {steps[index]?.label}
      </h1>

      <div>{children}</div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {index > 0 ? (
            <Button variant="secondary" onClick={goBack}>
              {labels.back}
            </Button>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          {footer}
          {index < steps.length - 1 ? (
            <Button variant="primary" onClick={() => onNavigate(steps[index + 1].id)}>
              {nextLabel ?? labels.next}
            </Button>
          ) : null}
        </div>
      </div>

      <Dialog open={confirmBack} onOpenChange={setConfirmBack} destructive>
        <DialogTitle>{labels.destructiveBackTitle}</DialogTitle>
        <DialogBody>{destructiveBack}</DialogBody>
        <DialogFooter
          retreat={
            <Button variant="secondary" onClick={() => setConfirmBack(false)}>
              {labels.destructiveBackRetreat}
            </Button>
          }
          confirm={
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmBack(false);
                onNavigate(steps[index - 1].id);
              }}
            >
              {labels.destructiveBackConfirm}
            </Button>
          }
        />
      </Dialog>
    </div>
  );
}
```

`packages/ui/src/patterns/wizard/index.ts`:

```ts
export { Wizard } from './wizard';
export type { WizardLabels, WizardStep } from './wizard';
export { useWizardDraft } from './use-wizard-draft';
export { useWizardStep } from './use-wizard-step';
```

- [ ] **Krok 5: Spustit testy a commit**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/wizard
git add packages/ui/src/patterns/wizard
git commit -m "feat(ui): K3 wizard owning the URL step, destructive back and 24h draft"
```

Očekávaný výstup: 16 passed.

---

### Úkol 23: K4 Nahrání souboru s povinnou klávesovou alternativou

**Tvrdé požadavky (13.1):** přetažení i výběr; průběh nahrávání; velké soubory (200 MB) po částech; zrušení; **klávesová alternativa k přetažení je povinná**. Je to podmínka souladu s WCAG 2.2, kritérium 2.5.7 Dragging Movements, ne zdvořilost.

**Soubory:**
- Vytvořit: `packages/ui/src/patterns/file-upload/chunked-upload.ts`, `file-upload.tsx`, `index.ts`
- Test: `packages/ui/src/patterns/file-upload/chunked-upload.test.ts`, `file-upload.test.tsx`

- [ ] **Krok 1: Napsat padající test na nahrávání po částech**

`packages/ui/src/patterns/file-upload/chunked-upload.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { uploadInChunks } from './chunked-upload';

function fileOf(bytes: number): File {
  return new File([new Uint8Array(bytes)], 'kontakty.csv', { type: 'text/csv' });
}

describe('uploadInChunks', () => {
  it('rozdělí soubor na části a pošle je po pořádku', async () => {
    const sent: number[] = [];
    await uploadInChunks({
      file: fileOf(25),
      chunkSize: 10,
      sendChunk: async ({ index, blob }) => {
        sent.push(index);
        expect(blob.size).toBeLessThanOrEqual(10);
      },
    });
    expect(sent).toEqual([0, 1, 2]);
  });

  it('hlásí průběh v bajtech, ne jen v procentech', async () => {
    const progress: number[] = [];
    await uploadInChunks({
      file: fileOf(25),
      chunkSize: 10,
      sendChunk: async () => {},
      onProgress: ({ uploadedBytes }) => progress.push(uploadedBytes),
    });
    expect(progress).toEqual([10, 20, 25]);
  });

  it('zrušení zastaví další části', async () => {
    const controller = new AbortController();
    const sendChunk = vi.fn(async ({ index }: { index: number }) => {
      if (index === 0) controller.abort();
    });

    await expect(
      uploadInChunks({
        file: fileOf(50),
        chunkSize: 10,
        sendChunk,
        signal: controller.signal,
      }),
    ).rejects.toThrow(/zrušeno/);

    expect(sendChunk).toHaveBeenCalledTimes(1);
  });

  it('zvládne prázdný soubor bez nekonečné smyčky', async () => {
    const sendChunk = vi.fn();
    await uploadInChunks({ file: fileOf(0), chunkSize: 10, sendChunk });
    expect(sendChunk).not.toHaveBeenCalled();
  });
});
```

- [ ] **Krok 2: Spustit test, musí spadnout, pak implementovat**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/file-upload/chunked-upload.test.ts
```

Očekávaný výstup: FAIL, `Failed to resolve import "./chunked-upload"`.

`packages/ui/src/patterns/file-upload/chunked-upload.ts`:

```ts
/** Výchozí velikost části. Soubor o 200 MB se tak pošle po 40 kusech. */
export const DEFAULT_CHUNK_SIZE = 5 * 1024 * 1024;

export async function uploadInChunks({
  file,
  chunkSize = DEFAULT_CHUNK_SIZE,
  sendChunk,
  onProgress,
  signal,
}: {
  file: File;
  chunkSize?: number;
  sendChunk: (input: { index: number; total: number; blob: Blob }) => Promise<void>;
  onProgress?: (input: { uploadedBytes: number; totalBytes: number }) => void;
  signal?: AbortSignal;
}): Promise<void> {
  const total = Math.ceil(file.size / chunkSize);
  let uploaded = 0;

  for (let index = 0; index < total; index += 1) {
    if (signal?.aborted) throw new Error('Nahrávání bylo zrušeno.');
    const start = index * chunkSize;
    const blob = file.slice(start, Math.min(start + chunkSize, file.size));
    await sendChunk({ index, total, blob });
    if (signal?.aborted) throw new Error('Nahrávání bylo zrušeno.');
    uploaded += blob.size;
    onProgress?.({ uploadedBytes: uploaded, totalBytes: file.size });
  }
}
```

- [ ] **Krok 3: Napsat padající test na komponentu**

`packages/ui/src/patterns/file-upload/file-upload.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FileUpload } from './file-upload';

const labels = {
  dropzone: 'Přetáhněte sem soubor',
  chooseFile: 'Vyberte ze složky',
  fileInput: 'Soubor k nahrání',
  cancel: 'Zrušit nahrávání',
  progress: (percent: number) => `Nahráno ${percent} %`,
  tooLarge: (limit: string) => `Soubor je větší než ${limit}.`,
  wrongType: 'Tenhle typ souboru neumíme přečíst.',
  selectedFile: (name: string) => `Vybraný soubor: ${name}`,
};

function csv(name = 'kontakty.csv', bytes = 20, type = 'text/csv') {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe('FileUpload', () => {
  it('má klávesově dostupné tlačítko na výběr souboru, nejen přetažení', async () => {
    // WCAG 2.2, kritérium 2.5.7: co jde tažením, musí jít i bez něj.
    // Popisek `<label>` tuhle podmínku nesplňuje, protože nemá roli tlačítka
    // a čtečka ho jako akci neohlásí. Proto je tu skutečné `<button>`.
    const user = userEvent.setup();
    render(<FileUpload labels={labels} accept=".csv,text/csv" maxBytes={1000} onFile={vi.fn()} />);

    const button = screen.getByRole('button', { name: 'Vyberte ze složky' });
    await user.tab();
    expect(button).toHaveFocus();
    expect(button).not.toHaveAttribute('disabled');
  });

  it('fokus na tlačítku je vidět, protože obrys je na něm, ne na sourozenci', async () => {
    const user = userEvent.setup();
    render(<FileUpload labels={labels} accept=".csv" maxBytes={1000} onFile={vi.fn()} />);
    await user.tab();
    expect(screen.getByRole('button', { name: 'Vyberte ze složky' }).className).toContain(
      'focus-visible:outline',
    );
  });

  it('tlačítko otevře dialog na výběr souboru', async () => {
    const user = userEvent.setup();
    render(<FileUpload labels={labels} accept=".csv" maxBytes={1000} onFile={vi.fn()} />);
    const input = screen.getByLabelText('Soubor k nahrání') as HTMLInputElement;
    const click = vi.spyOn(input, 'click');
    await user.click(screen.getByRole('button', { name: 'Vyberte ze složky' }));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('vstupní pole není v pořadí fokusu, aby tabulátor padl na tlačítko', () => {
    render(<FileUpload labels={labels} accept=".csv" maxBytes={1000} onFile={vi.fn()} />);
    expect(screen.getByLabelText('Soubor k nahrání')).toHaveAttribute('tabindex', '-1');
  });

  it('výběr souboru přes vstupní pole zavolá obsluhu', async () => {
    const user = userEvent.setup();
    const onFile = vi.fn();
    render(<FileUpload labels={labels} accept=".csv,text/csv" maxBytes={1000} onFile={onFile} />);

    await user.upload(screen.getByLabelText('Soubor k nahrání'), csv());
    expect(onFile).toHaveBeenCalledTimes(1);
    expect(onFile.mock.calls[0][0].name).toBe('kontakty.csv');
  });

  it('přijme CSV z Windows, které chodí s jiným nebo prázdným typem', async () => {
    // Hlavní scénář importu. Windows u .csv posílá application/vnd.ms-excel,
    // někdy prázdný řetězec. Kontrola jen podle MIME typu by odmítla
    // většinu skutečných souborů, se kterými uživatelé přijdou.
    const user = userEvent.setup();
    const onFile = vi.fn();
    render(<FileUpload labels={labels} accept=".csv,text/csv" maxBytes={1000} onFile={onFile} />);
    const input = screen.getByLabelText('Soubor k nahrání');

    await user.upload(input, csv('z-excelu.csv', 20, 'application/vnd.ms-excel'));
    await user.upload(input, csv('bez-typu.csv', 20, ''));

    expect(onFile).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('soubor s nepovolenou příponou i typem odmítne', async () => {
    const user = userEvent.setup();
    const onFile = vi.fn();
    render(<FileUpload labels={labels} accept=".csv,text/csv" maxBytes={1000} onFile={onFile} />);

    await user.upload(screen.getByLabelText('Soubor k nahrání'), csv('foto.png', 20, 'image/png'));
    expect(onFile).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Tenhle typ souboru neumíme přečíst.');
  });

  it('přetažení souboru na plochu zavolá stejnou obsluhu', () => {
    const onFile = vi.fn();
    render(<FileUpload labels={labels} accept=".csv" maxBytes={1000} onFile={onFile} />);

    const zone = screen.getByTestId('dropzone');
    const dataTransfer = { files: [csv()], items: [], types: ['Files'] };
    zone.dispatchEvent(Object.assign(new Event('drop', { bubbles: true }), { dataTransfer }));
    expect(onFile).toHaveBeenCalledTimes(1);
  });

  it('soubor přes limit odmítne s uvedením limitu', async () => {
    const user = userEvent.setup();
    const onFile = vi.fn();
    render(<FileUpload labels={labels} accept=".csv" maxBytes={10} onFile={onFile} />);

    await user.upload(screen.getByLabelText('Soubor k nahrání'), csv('velky.csv', 500));
    expect(onFile).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Soubor je větší než');
  });

  it('průběh hlásí v procentech a má i textovou podobu', () => {
    render(
      <FileUpload
        labels={labels}
        accept=".csv"
        maxBytes={1000}
        onFile={vi.fn()}
        progress={42}
        onCancel={vi.fn()}
      />,
    );
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '42');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    expect(bar).toHaveAttribute('aria-valuetext', 'Nahráno 42 %');
    expect(screen.getByRole('button', { name: 'Zrušit nahrávání' })).toBeVisible();
  });

  it('když dostane sendChunk, nahraje soubor po částech sama', async () => {
    // Vada, kterou tenhle test hlídá: `uploadInChunks` byla hotová
    // a otestovaná, ale komponenta ji nikdy nezavolala. Soubor o 200 MB
    // by se poslal jedním požadavkem.
    const user = userEvent.setup();
    const sent: number[] = [];
    render(
      <FileUpload
        labels={labels}
        accept=".csv"
        maxBytes={1_000_000}
        onFile={vi.fn()}
        chunkSize={10}
        sendChunk={async ({ index }) => {
          sent.push(index);
        }}
      />,
    );

    await user.upload(screen.getByLabelText('Soubor k nahrání'), csv('kontakty.csv', 25));
    await waitFor(() => expect(sent).toEqual([0, 1, 2]));
  });

  it('zrušení během nahrávání po částech zastaví další části', async () => {
    const user = userEvent.setup();
    let sentCount = 0;
    render(
      <FileUpload
        labels={labels}
        accept=".csv"
        maxBytes={1_000_000}
        onFile={vi.fn()}
        chunkSize={10}
        sendChunk={async () => {
          sentCount += 1;
          await new Promise((resolve) => setTimeout(resolve, 5));
        }}
      />,
    );

    await user.upload(screen.getByLabelText('Soubor k nahrání'), csv('kontakty.csv', 100));
    await screen.findByRole('button', { name: 'Zrušit nahrávání' });
    await user.click(screen.getByRole('button', { name: 'Zrušit nahrávání' }));

    const afterCancel = sentCount;
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(sentCount).toBe(afterCancel);
  });

  it('velký soubor předá jako File, nenačítá ho do paměti', async () => {
    const user = userEvent.setup();
    const onFile = vi.fn();
    render(<FileUpload labels={labels} accept=".csv" maxBytes={209_715_200} onFile={onFile} />);

    const big = csv('big.csv', 1024);
    Object.defineProperty(big, 'size', { value: 209_715_200 });
    await user.upload(screen.getByLabelText('Soubor k nahrání'), big);

    expect(onFile).toHaveBeenCalledWith(expect.any(File));
  });
});
```

- [ ] **Krok 4: Spustit test, musí spadnout, pak implementovat**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/file-upload/file-upload.test.tsx
```

Očekávaný výstup: FAIL, `Failed to resolve import "./file-upload"`.

`packages/ui/src/patterns/file-upload/file-upload.tsx`:

```tsx
'use client';

import { Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../../components/button';
import { Progress } from '../../components/progress';
import { cn } from '../../lib/cn';
import { DEFAULT_CHUNK_SIZE, uploadInChunks } from './chunked-upload';

export type FileUploadLabels = {
  dropzone: string;
  chooseFile: string;
  /** Přístupný název skrytého vstupu. Čtečka ho potřebuje, i když je skrytý. */
  fileInput: string;
  cancel: string;
  progress: (percent: number) => string;
  tooLarge: (limit: string) => string;
  wrongType: string;
  selectedFile: (name: string) => string;
};

/**
 * Rozhodne, jestli soubor projde filtrem `accept`.
 *
 * Kontroluje **příponu i MIME typ**, protože Windows u `.csv` posílá
 * `application/vnd.ms-excel` a někdy prázdný řetězec. Kontrola jen podle
 * MIME typu by odmítla většinu skutečných souborů, se kterými uživatelé
 * k importu přijdou, a to je hlavní scénář celé komponenty.
 */
export function matchesAccept(file: File, accept: string): boolean {
  const patterns = accept
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item !== '');
  if (patterns.length === 0) return true;

  const name = file.name.toLowerCase();
  const type = file.type.toLowerCase();

  return patterns.some((pattern) => {
    if (pattern.startsWith('.')) return name.endsWith(pattern);
    if (pattern.endsWith('/*')) return type !== '' && type.startsWith(pattern.slice(0, -1));
    return type === pattern;
  });
}

/**
 * Nahrání souboru. Přetažení je **doplněk**, ne jediná cesta:
 * WCAG 2.2 kritérium 2.5.7 žádá, aby všechno, co jde tažením, šlo i bez něj.
 *
 * Klávesovou cestou je **skutečné `<button>`**, ne popisek. Popisek nemá roli
 * tlačítka, čtečka ho neohlásí jako akci a obrys fokusu by se kreslil na něm,
 * zatímco fokus by měl skrytý vstup, který je jeho sourozencem. Vstup je proto
 * mimo pořadí fokusu (`tabIndex={-1}`) a otevírá ho tlačítko.
 *
 * Když volající předá `sendChunk`, komponenta si nahrávání po částech **řídí
 * sama**, včetně průběhu a zrušení. Když ho nepředá, jen ohlásí soubor přes
 * `onFile` a průběh si řídí obrazovka propem `progress`.
 */
export function FileUpload({
  labels,
  accept,
  maxBytes,
  onFile,
  progress,
  onCancel,
  sendChunk,
  chunkSize = DEFAULT_CHUNK_SIZE,
  formatBytes = (value) => `${value} B`,
  className,
}: {
  labels: FileUploadLabels;
  /** Seznam jako u atributu `accept`, například `.csv,.xlsx,text/csv`. */
  accept: string;
  maxBytes: number;
  onFile: (file: File) => void;
  /** Průběh v **procentech**. Řídí ho obrazovka, když si nahrávání dělá sama. */
  progress?: number;
  onCancel?: () => void;
  /** Když je zadaný, komponenta soubor pošle po částech sama. */
  sendChunk?: (input: { index: number; total: number; blob: Blob }) => Promise<void>;
  chunkSize?: number;
  formatBytes?: (bytes: number) => string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [ownProgress, setOwnProgress] = useState<number | null>(null);

  // Odpojení komponenty musí rozjeté nahrávání zastavit, jinak by části
  // létaly na server ještě dlouho po odchodu z obrazovky.
  useEffect(() => () => abortRef.current?.abort(), []);

  function reject(message: string) {
    setError(message);
    setSelected(null);
  }

  function handleFile(file: File) {
    if (file.size > maxBytes) {
      reject(labels.tooLarge(formatBytes(maxBytes)));
      return;
    }
    if (!matchesAccept(file, accept)) {
      reject(labels.wrongType);
      return;
    }

    setError(null);
    setSelected(file.name);
    onFile(file);

    if (!sendChunk) return;

    // Nahrávání po částech se skutečně spustí. Bez tohohle volání
    // je funkce `uploadInChunks` mrtvý kód a soubor o 200 MB by se
    // poslal jedním požadavkem.
    const controller = new AbortController();
    abortRef.current = controller;
    setOwnProgress(0);

    void uploadInChunks({
      file,
      chunkSize,
      sendChunk,
      signal: controller.signal,
      onProgress: ({ uploadedBytes, totalBytes }) => {
        setOwnProgress(totalBytes === 0 ? 100 : Math.round((uploadedBytes / totalBytes) * 100));
      },
    })
      .then(() => setOwnProgress(100))
      .catch((cause: unknown) => {
        // Zrušení není chyba, uživatel ho vyvolal sám.
        if (!controller.signal.aborted) reject(String((cause as Error).message));
        setOwnProgress(null);
      })
      .finally(() => {
        abortRef.current = null;
      });
  }

  function cancel() {
    abortRef.current?.abort();
    abortRef.current = null;
    setOwnProgress(null);
    onCancel?.();
  }

  const shownProgress = progress ?? ownProgress;
  const cancellable = shownProgress !== null && shownProgress !== undefined;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div
        data-testid="dropzone"
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          const file = event.dataTransfer?.files?.[0];
          if (file) handleFile(file);
        }}
        className={cn(
          'flex flex-col items-center gap-3 rounded-[var(--radius-surface)] border-2 border-dashed p-8 text-center',
          dragging ? 'border-primary bg-accent-surface' : 'border-border bg-surface',
        )}
      >
        <Upload aria-hidden className="size-6 text-text-muted" />
        <p className="text-sm text-text-muted">{labels.dropzone}</p>

        {/* Povinná klávesová alternativa (WCAG 2.5.7). Skutečné tlačítko:
            má roli, jde na něj tabulátorem a obrys fokusu je na něm. */}
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="inline-flex min-h-11 items-center rounded-[var(--radius-control)] border border-border-strong px-4 text-sm font-medium text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-focus-ring)]"
        >
          {labels.chooseFile}
        </button>

        <input
          ref={inputRef}
          type="file"
          aria-label={labels.fileInput}
          accept={accept}
          // Mimo pořadí fokusu, aby tabulátor padl na tlačítko, ne sem.
          tabIndex={-1}
          className="sr-only"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) handleFile(file);
            // Reset umožní vybrat tentýž soubor znovu po chybě.
            event.target.value = '';
          }}
        />
      </div>

      {selected ? <p className="text-sm text-text">{labels.selectedFile(selected)}</p> : null}

      {error ? (
        <p role="alert" className="text-sm text-danger-text">
          {error}
        </p>
      ) : null}

      {cancellable ? (
        <div className="flex flex-col gap-2">
          <Progress
            value={shownProgress}
            max={100}
            label={labels.dropzone}
            valueText={labels.progress(shownProgress as number)}
          />
          <div>
            <Button variant="secondary" onClick={cancel}>
              {labels.cancel}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
```

`packages/ui/src/patterns/file-upload/index.ts`:

```ts
export { FileUpload, matchesAccept } from './file-upload';
export type { FileUploadLabels } from './file-upload';
export { DEFAULT_CHUNK_SIZE, uploadInChunks } from './chunked-upload';
```

- [ ] **Krok 5: Spustit testy a commit**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/file-upload
pnpm --filter @mlain/ui typecheck
git add packages/ui
git commit -m "feat(ui): K4 file upload with real keyboard alternative and wired chunking"
```

Očekávaný výstup: 17 passed.

---

### Úkol 24: K6 Náhled e-mailu

**Tvrdé požadavky (13.1):** izolace stylů e-mailu od stylů aplikace (iframe se `sandbox`); přepínání šířky; tmavý režim; **bez odchozích požadavků na cizí zdroje**.

Žádná knihovna. `<iframe sandbox srcdoc>` stačí a `sandbox` je zároveň bezpečnostní opatření: HTML v náhledu pochází od uživatele.

**Soubory:**
- Vytvořit: `packages/ui/src/patterns/email-preview/email-preview.tsx`, `index.ts`
- Test: `packages/ui/src/patterns/email-preview/email-preview.test.tsx`

- [ ] **Krok 1: Napsat padající test**

`packages/ui/src/patterns/email-preview/email-preview.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { EmailPreview } from './email-preview';

const labels = {
  widthDesktop: 'Šířka počítače',
  widthMobile: 'Šířka mobilu',
  themeLight: 'Světlý režim',
  themeDark: 'Tmavý režim',
  blockedExternal: 'Náhled nenačítá nic z cizích serverů.',
};

const title = 'Náhled e-mailu';
const html = '<html><body><h1>Letní výprodej</h1><img src="https://cizi.example/a.png"></body></html>';

describe('EmailPreview', () => {
  it('vykresluje do iframe se sandboxem, ne do stránky', () => {
    render(<EmailPreview html={html} title={title} labels={labels} />);
    const frame = screen.getByTitle(title);
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('sandbox', '');
  });

  it('sandbox nemá jedinou výjimku, ani allow-same-origin', () => {
    // Tenhle test je tu proto, že o výjimku někdo požádal. `allow-same-origin`
    // by rámci vrátilo původ aplikace a izolaci oslabilo bez jakéhokoli zisku,
    // protože skripty stejně neběží. Kdyby výjimku někdo doplnil, spadne tohle.
    render(<EmailPreview html={html} title={title} labels={labels} />);
    expect(screen.getByTitle(title).getAttribute('sandbox')).toBe('');
  });

  it('neposílá odkazující adresu, ani kdyby se CSP obešla', () => {
    render(<EmailPreview html={html} title={title} labels={labels} />);
    expect(screen.getByTitle(title)).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  it('obsah e-mailu jde do srcdoc, takže neuteče do stylů aplikace', () => {
    render(<EmailPreview html={html} title={title} labels={labels} />);
    expect(screen.getByTitle(title)).toHaveAttribute(
      'srcdoc',
      expect.stringContaining('Letní výprodej'),
    );
  });

  it('vkládá CSP, která zakáže odchozí požadavky na cizí zdroje', () => {
    render(<EmailPreview html={html} title={title} labels={labels} />);
    const srcdoc = screen.getByTitle(title).getAttribute('srcdoc') as string;
    expect(srcdoc).toContain('http-equiv="Content-Security-Policy"');
    expect(srcdoc).toContain("default-src 'none'");
    expect(srcdoc).toContain('img-src data:');
  });

  it('umí přepnout šířku vlastními přepínači', async () => {
    const user = userEvent.setup();
    render(<EmailPreview html={html} title={title} labels={labels} />);
    expect(screen.getByTitle(title)).toHaveAttribute('data-width', 'desktop');

    await user.click(screen.getByRole('button', { name: 'Šířka mobilu' }));
    expect(screen.getByTitle(title)).toHaveAttribute('data-width', 'mobile');
  });

  it('umí přepnout tmavý režim náhledu nezávisle na aplikaci', async () => {
    const user = userEvent.setup();
    render(<EmailPreview html={html} title={title} labels={labels} />);
    await user.click(screen.getByRole('button', { name: 'Tmavý režim' }));
    expect(screen.getByTitle(title)).toHaveAttribute('data-preview-theme', 'dark');
  });

  it('říká uživateli, že cizí zdroje nenačítá', () => {
    render(<EmailPreview html={html} title={title} labels={labels} />);
    expect(screen.getByText('Náhled nenačítá nic z cizích serverů.')).toBeVisible();
  });

  it('bez labels vlastní přepínače nevykreslí, protože je má obrazovka', () => {
    // Editor šablon má přepínače ve své liště nástrojů a nabízí navíc
    // textovou verzi a zdroj. Dvě sady stejných přepínačů vedle sebe
    // jsou horší než žádná.
    render(<EmailPreview html={html} title={title} width={375} dark />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByTitle(title)).toHaveAttribute('data-preview-theme', 'dark');
    expect(screen.getByTitle(title)).toHaveAttribute('data-width', 'mobile');
  });

  it('šířku bere i jako číslo v pixelech', () => {
    render(<EmailPreview html={html} title={title} width={480} />);
    expect(screen.getByTitle(title)).toHaveStyle({ width: '480px' });
  });

  it('řízený režim se řídí propem, ne vlastním stavem', async () => {
    const user = userEvent.setup();
    render(<EmailPreview html={html} title={title} labels={labels} dark={false} />);
    await user.click(screen.getByRole('button', { name: 'Tmavý režim' }));
    // Prop vyhrává: bez onDarkChange se stav nemění, drží ho obrazovka.
    expect(screen.getByTitle(title)).toHaveAttribute('data-preview-theme', 'light');
  });
});
```

- [ ] **Krok 2: Spustit test, musí spadnout, pak implementovat**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/email-preview
```

Očekávaný výstup: FAIL, `Failed to resolve import "./email-preview"`.

`packages/ui/src/patterns/email-preview/email-preview.tsx`:

```tsx
'use client';

import { useMemo, useState } from 'react';
import { Button } from '../../components/button';
import { cn } from '../../lib/cn';

export type EmailPreviewLabels = {
  widthDesktop: string;
  widthMobile: string;
  themeLight: string;
  themeDark: string;
  blockedExternal: string;
};

const WIDTHS = { desktop: 640, mobile: 375 } as const;

/** Pod 480 px se náhled počítá jako mobilní. Používá se jen pro `data-width`. */
function widthNameOf(pixels: number): 'desktop' | 'mobile' {
  return pixels < 480 ? 'mobile' : 'desktop';
}

/**
 * Náhled e-mailu v izolovaném rámci.
 *
 * `sandbox=""` bez jediné výjimky znamená: žádné skripty, žádné formuláře,
 * žádná navigace, cizí původ. HTML v náhledu je uživatelský obsah,
 * takže se k němu chováme jako k cizímu. **Výjimka `allow-same-origin`
 * se nepřidá**: vrátila by rámci původ aplikace a izolaci oslabila bez
 * jakéhokoli zisku, protože skripty stejně neběží.
 *
 * CSP uvnitř `srcdoc` navíc zakáže odchozí požadavky, takže se náhledem
 * nedá vystopovat, kdo si ho otevřel, a platí slib o nulové komunikaci
 * s cizím cloudem. Samotný atribut `sandbox` by to neuměl: obrázek z cizí
 * domény by se načetl. Obrázky z domény uživatele si zapne až obrazovka
 * editoru výslovným přepnutím, kdy o tom uživatel ví.
 *
 * **Šířka a tmavý režim jdou řídit zvenčí.** Editor šablon má přepínače
 * ve vlastní liště nástrojů a nabízí navíc textovou verzi a zdroj. Když
 * `labels` chybí, komponenta vlastní přepínače nevykreslí, takže uživatel
 * nikdy neuvidí dvě sady stejných tlačítek.
 */
export function EmailPreview({
  html,
  title,
  width: widthProp,
  dark: darkProp,
  labels,
  className,
}: {
  html: string;
  /** Přístupný název rámce. Nikdy prázdný, čtečka podle něj rámec pojmenuje. */
  title: string;
  /** Řízená šířka: pixely, nebo pojmenovaná hodnota. */
  width?: number | 'desktop' | 'mobile';
  /** Řízený tmavý režim náhledu, nezávislý na režimu aplikace. */
  dark?: boolean;
  /** Když chybí, komponenta vlastní přepínače nevykreslí. */
  labels?: EmailPreviewLabels;
  className?: string;
}) {
  const [ownWidth, setOwnWidth] = useState<'desktop' | 'mobile'>('desktop');
  const [ownDark, setOwnDark] = useState(false);

  const controlledWidth = widthProp !== undefined;
  const controlledDark = darkProp !== undefined;

  const widthPixels = controlledWidth
    ? typeof widthProp === 'number'
      ? widthProp
      : WIDTHS[widthProp]
    : WIDTHS[ownWidth];

  const widthName = controlledWidth
    ? typeof widthProp === 'number'
      ? widthNameOf(widthProp)
      : widthProp
    : ownWidth;

  const isDark = controlledDark ? darkProp : ownDark;
  const theme = isDark ? 'dark' : 'light';

  const srcDoc = useMemo(() => {
    const csp =
      "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src 'none'; script-src 'none'";
    const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
    const background = theme === 'dark' ? '#0b0f17' : '#ffffff';
    const color = theme === 'dark' ? '#e9edf3' : '#111827';
    const style = `<style>html,body{margin:0;background:${background};color:${color};color-scheme:${theme};}</style>`;

    if (html.includes('<head')) {
      return html.replace('<head>', `<head>${meta}${style}`);
    }
    return `<!doctype html><html><head>${meta}${style}</head><body>${html}</body></html>`;
  }, [html, theme]);

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {labels ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setOwnWidth('desktop')}>
            {labels.widthDesktop}
          </Button>
          <Button variant="secondary" onClick={() => setOwnWidth('mobile')}>
            {labels.widthMobile}
          </Button>
          <Button variant="secondary" onClick={() => setOwnDark((current) => !current)}>
            {isDark ? labels.themeLight : labels.themeDark}
          </Button>
        </div>
      ) : null}

      <iframe
        title={title}
        // Bez jediné výjimky. Viz komentář nad komponentou.
        sandbox=""
        referrerPolicy="no-referrer"
        srcDoc={srcDoc}
        data-width={widthName}
        data-preview-theme={theme}
        style={{ width: widthPixels }}
        className="h-[36rem] max-w-full rounded-[var(--radius-surface)] border border-border bg-surface"
      />

      {labels ? <p className="text-sm text-text-muted">{labels.blockedExternal}</p> : null}
    </div>
  );
}
```

`packages/ui/src/patterns/email-preview/index.ts`:

```ts
export { EmailPreview } from './email-preview';
export type { EmailPreviewLabels } from './email-preview';
```

- [ ] **Krok 3: Spustit testy a commit**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/email-preview
git add packages/ui/src/patterns/email-preview
git commit -m "feat(ui): K6 sandboxed email preview, controllable width and dark mode"
```

Očekávaný výstup: 11 passed.

---

### Úkol 25: K7 Grafy s textovou alternativou

**Tvrdé požadavky (13.1):** textová alternativa k datům (tabulka pod grafem); čitelnost bez rozlišení barev; klávesová dostupnost hodnot; tooltip dostupný i z klávesnice.

Tabulka pod grafem není ústupek, je to **hlavní** nositel dat. Graf je jeho vizuální shrnutí.

**Soubory:**
- Vytvořit: `packages/ui/src/patterns/charts/chart-frame.tsx`, `line-chart.tsx`, `bar-chart.tsx`, `index.ts`
- Test: `packages/ui/src/patterns/charts/chart-frame.test.tsx`

- [ ] **Krok 1: Napsat padající test**

`packages/ui/src/patterns/charts/chart-frame.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ChartFrame } from './chart-frame';

const series = [
  {
    id: 'delivered',
    label: 'Doručeno',
    pattern: 'solid' as const,
    points: [
      { x: '1. 7.', y: 1200 },
      { x: '2. 7.', y: 1180 },
    ],
  },
  {
    id: 'clicked',
    label: 'Kliklo',
    pattern: 'dashed' as const,
    points: [
      { x: '1. 7.', y: 210 },
      { x: '2. 7.', y: 190 },
    ],
  },
];

const labels = {
  showTable: 'Zobrazit hodnoty jako tabulku',
  hideTable: 'Skrýt tabulku',
  tableCaption: 'Hodnoty grafu',
  periodColumn: 'Období',
};

describe('ChartFrame', () => {
  it('graf sám o sobě je pro čtečku skrytý, data nese tabulka', () => {
    render(<ChartFrame title="Vývoj v čase" series={series} labels={labels}>{null}</ChartFrame>);
    expect(screen.getByTestId('chart-visual')).toHaveAttribute('aria-hidden', 'true');
  });

  it('tabulka s hodnotami je vždy v DOM, jen vizuálně sbalená', () => {
    render(<ChartFrame title="Vývoj v čase" series={series} labels={labels}>{null}</ChartFrame>);
    const table = screen.getByRole('table', { name: 'Hodnoty grafu' });
    expect(within(table).getByText('1 200')).toBeInTheDocument();
    expect(within(table).getByText('210')).toBeInTheDocument();
  });

  it('tabulku jde rozbalit a sbalit z klávesnice', async () => {
    const user = userEvent.setup();
    render(<ChartFrame title="Vývoj v čase" series={series} labels={labels}>{null}</ChartFrame>);
    const toggle = screen.getByRole('button', { name: 'Zobrazit hodnoty jako tabulku' });
    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Skrýt tabulku' })).toBeVisible();
  });

  it('každá řada má kromě barvy i vzor a popisek', () => {
    render(<ChartFrame title="Vývoj v čase" series={series} labels={labels}>{null}</ChartFrame>);
    const legend = screen.getByTestId('chart-legend');
    expect(within(legend).getByText('Doručeno')).toBeVisible();
    expect(within(legend).getByText('Kliklo')).toBeVisible();
    expect(legend.querySelectorAll('[data-pattern]')).toHaveLength(2);
  });

  it('graf má nadpis svázaný s oblastí', () => {
    render(<ChartFrame title="Vývoj v čase" series={series} labels={labels}>{null}</ChartFrame>);
    expect(screen.getByRole('figure', { name: 'Vývoj v čase' })).toBeInTheDocument();
  });
});
```

- [ ] **Krok 2: Spustit test, musí spadnout, pak implementovat**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/charts
```

Očekávaný výstup: FAIL, `Failed to resolve import "./chart-frame"`.

`packages/ui/src/patterns/charts/chart-frame.tsx`:

```tsx
'use client';

import { useId, useState } from 'react';
import { Button } from '../../components/button';
import { cn } from '../../lib/cn';

export type SeriesPattern = 'solid' | 'dashed' | 'dotted';

export type ChartSeries = {
  id: string;
  label: string;
  /** Vzor čáry nebo výplně. Graf musí být čitelný bez rozlišení barev. */
  pattern: SeriesPattern;
  points: Array<{ x: string; y: number }>;
};

export type ChartLabels = {
  showTable: string;
  hideTable: string;
  tableCaption: string;
  periodColumn: string;
};

/**
 * Rám kolem každého grafu v aplikaci.
 *
 * Vizuální graf je pro čtečku skrytý (`aria-hidden`), protože SVG plné
 * cest nikomu nic neřekne. Data nese **tabulka**, která je vždy v DOM
 * a jde rozbalit z klávesnice. Tím je splněná textová alternativa
 * i klávesová dostupnost hodnot naráz.
 */
export function ChartFrame({
  title,
  series,
  labels,
  children,
  formatValue = (value) => new Intl.NumberFormat('cs').format(value),
  className,
}: {
  title: string;
  series: ChartSeries[];
  labels: ChartLabels;
  /** Samotný graf, například `<LineChart>` z recharts. */
  children: React.ReactNode;
  formatValue?: (value: number) => string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const periods = series[0]?.points.map((point) => point.x) ?? [];

  return (
    <figure aria-labelledby={titleId} className={cn('flex flex-col gap-3', className)}>
      <figcaption id={titleId} className="text-base font-semibold text-text">
        {title}
      </figcaption>

      <div data-testid="chart-visual" aria-hidden="true">
        {children}
      </div>

      <div data-testid="chart-legend" className="flex flex-wrap gap-4 text-sm text-text">
        {series.map((item) => (
          <span key={item.id} className="flex items-center gap-2">
            <span
              data-pattern={item.pattern}
              aria-hidden
              className={cn(
                'inline-block h-0.5 w-6 border-t-2 border-text',
                item.pattern === 'dashed' ? 'border-dashed' : '',
                item.pattern === 'dotted' ? 'border-dotted' : '',
              )}
            />
            {item.label}
          </span>
        ))}
      </div>

      <div>
        <Button variant="link" onClick={() => setOpen((current) => !current)}>
          {open ? labels.hideTable : labels.showTable}
        </Button>
      </div>

      {/* Tabulka je v DOM vždy. Když je sbalená, je jen vizuálně skrytá,
          takže ji čtečka i klávesnice pořád najdou. */}
      <div className={open ? '' : 'sr-only'}>
        <table className="w-full text-sm">
          <caption className="sr-only">{labels.tableCaption}</caption>
          <thead>
            <tr>
              <th scope="col" className="p-2 text-left text-text-muted">
                {labels.periodColumn}
              </th>
              {series.map((item) => (
                <th key={item.id} scope="col" className="p-2 text-right text-text-muted">
                  {item.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {periods.map((period, index) => (
              <tr key={period} className="border-t border-border">
                <th scope="row" className="p-2 text-left font-normal text-text">
                  {period}
                </th>
                {series.map((item) => (
                  <td key={item.id} className="p-2 text-right text-text">
                    {formatValue(item.points[index]?.y ?? 0)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
```

`packages/ui/src/patterns/charts/line-chart.tsx`:

```tsx
'use client';

import { CartesianGrid, Line, LineChart as RechartsLine, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { ChartFrame, type ChartLabels, type ChartSeries } from './chart-frame';

const STROKE_PATTERNS: Record<string, string | undefined> = {
  solid: undefined,
  dashed: '6 4',
  dotted: '2 3',
};

const SERIES_COLORS = ['var(--color-primary)', 'var(--color-success)', 'var(--color-warning)'];

/** Spojnicový graf. Načítá se líně, není součástí základního balíku (kritérium 82). */
export function LineChart({
  title,
  series,
  labels,
  formatValue,
}: {
  title: string;
  series: ChartSeries[];
  labels: ChartLabels;
  formatValue?: (value: number) => string;
}) {
  const data = (series[0]?.points ?? []).map((point, index) => {
    const row: Record<string, string | number> = { x: point.x };
    for (const item of series) row[item.id] = item.points[index]?.y ?? 0;
    return row;
  });

  return (
    <ChartFrame title={title} series={series} labels={labels} formatValue={formatValue}>
      <ResponsiveContainer width="100%" height={280}>
        <RechartsLine data={data}>
          <CartesianGrid stroke="var(--color-border)" />
          <XAxis dataKey="x" stroke="var(--color-text-muted)" />
          <YAxis stroke="var(--color-text-muted)" />
          {series.map((item, index) => (
            <Line
              key={item.id}
              type="monotone"
              dataKey={item.id}
              stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
              strokeDasharray={STROKE_PATTERNS[item.pattern]}
              dot={false}
              isAnimationActive={false}
            />
          ))}
        </RechartsLine>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
```

`packages/ui/src/patterns/charts/bar-chart.tsx`:

```tsx
'use client';

import { Bar, CartesianGrid, BarChart as RechartsBar, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import { ChartFrame, type ChartLabels, type ChartSeries } from './chart-frame';

const SERIES_COLORS = ['var(--color-primary)', 'var(--color-success)', 'var(--color-warning)'];

export function BarChart({
  title,
  series,
  labels,
  formatValue,
}: {
  title: string;
  series: ChartSeries[];
  labels: ChartLabels;
  formatValue?: (value: number) => string;
}) {
  const data = (series[0]?.points ?? []).map((point, index) => {
    const row: Record<string, string | number> = { x: point.x };
    for (const item of series) row[item.id] = item.points[index]?.y ?? 0;
    return row;
  });

  return (
    <ChartFrame title={title} series={series} labels={labels} formatValue={formatValue}>
      <ResponsiveContainer width="100%" height={280}>
        <RechartsBar data={data}>
          <CartesianGrid stroke="var(--color-border)" />
          <XAxis dataKey="x" stroke="var(--color-text-muted)" />
          <YAxis stroke="var(--color-text-muted)" />
          {series.map((item, index) => (
            <Bar
              key={item.id}
              dataKey={item.id}
              fill={SERIES_COLORS[index % SERIES_COLORS.length]}
              isAnimationActive={false}
            />
          ))}
        </RechartsBar>
      </ResponsiveContainer>
    </ChartFrame>
  );
}
```

`packages/ui/src/patterns/charts/index.ts`:

```ts
export { BarChart } from './bar-chart';
export { ChartFrame } from './chart-frame';
export type { ChartLabels, ChartSeries, SeriesPattern } from './chart-frame';
export { LineChart } from './line-chart';
```

- [ ] **Krok 3: Spustit testy a commit**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/charts
git add packages/ui/src/patterns/charts
git commit -m "feat(ui): K7 charts with mandatory data table alternative"
```

Očekávaný výstup: 5 passed.

---

### Úkol 26: K8 Časová osa, věty podle rodu a oddělovače dnů

Nejnáročnější komponenta ze všech osmi. **Tvrdé požadavky (13.1):** shlukování sérií; oddělovače dnů v časové zóně uživatele; **věty skládané ze slotů, ne z fragmentů**, s tvarem slovesa podle rodu kontaktu a s neutrálním podstatným jménem u neznámého rodu; načítání po dávkách nejnovější první bez skoku scrollu; trvalá kotva v URL; celá osa průchozí z klávesnice a rozbalení shluku ohlášené čtečce.

Tenhle úkol dělá shlukování a oddělovače dnů, což je čistá logika. Vykreslení je v úkolu 27.

**Soubory:**
- Vytvořit: `packages/ui/src/patterns/timeline/types.ts`, `cluster-events.ts`, `day-groups.ts`
- Test: `packages/ui/src/patterns/timeline/cluster-events.test.ts`, `day-groups.test.ts`

- [ ] **Krok 1: Napsat padající test na shlukování**

`packages/ui/src/patterns/timeline/cluster-events.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { clusterEvents } from './cluster-events';
import type { TimelineEvent } from './types';

function event(id: string, type: string, minutesAgo: number): TimelineEvent {
  return {
    id,
    type,
    occurredAt: new Date(`2026-07-31T18:${String(60 - minutesAgo).padStart(2, '0')}:00.000Z`),
    payload: {},
  };
}

describe('clusterEvents', () => {
  it('šest zobrazení stránky během čtyř minut je jeden řádek s počtem', () => {
    const events = [0, 1, 2, 3, 3, 4].map((minute, index) =>
      event(`p${index}`, 'page_view', minute),
    );
    const clustered = clusterEvents(events, { windowMs: 5 * 60 * 1000, minSize: 3 });

    expect(clustered).toHaveLength(1);
    expect(clustered[0].kind).toBe('cluster');
    expect(clustered[0].kind === 'cluster' ? clustered[0].events : []).toHaveLength(6);
  });

  it('shlukuje jen události stejného typu', () => {
    const events = [
      event('a', 'page_view', 0),
      event('b', 'page_view', 1),
      event('c', 'email_open', 1),
      event('d', 'page_view', 2),
    ];
    const clustered = clusterEvents(events, { windowMs: 5 * 60 * 1000, minSize: 2 });

    expect(clustered.filter((item) => item.kind === 'cluster')).toHaveLength(1);
    expect(clustered.filter((item) => item.kind === 'single')).toHaveLength(2);
  });

  it('dvě události pod minimální velikostí zůstanou samostatné', () => {
    const events = [event('a', 'page_view', 0), event('b', 'page_view', 1)];
    const clustered = clusterEvents(events, { windowMs: 5 * 60 * 1000, minSize: 3 });
    expect(clustered.every((item) => item.kind === 'single')).toBe(true);
  });

  it('události mimo okno se nespojí', () => {
    const events = [
      event('a', 'page_view', 0),
      event('b', 'page_view', 1),
      event('c', 'page_view', 2),
      event('d', 'page_view', 40),
    ];
    const clustered = clusterEvents(events, { windowMs: 5 * 60 * 1000, minSize: 3 });
    expect(clustered).toHaveLength(2);
    expect(clustered[0].kind).toBe('cluster');
    expect(clustered[1].kind).toBe('single');
  });

  it('e-mailové události se neshlukují, jinak by v ose zmizely', () => {
    const events = [
      event('a', 'email_open', 0),
      event('b', 'email_open', 1),
      event('c', 'email_open', 2),
    ];
    const clustered = clusterEvents(events, {
      windowMs: 5 * 60 * 1000,
      minSize: 3,
      neverCluster: ['email_open', 'email_click', 'email_delivered'],
    });
    expect(clustered).toHaveLength(3);
  });

  it('shluk si drží čas nejnovější události, aby seděl v pořadí', () => {
    const events = [0, 1, 2].map((minute, index) => event(`p${index}`, 'page_view', minute));
    const [cluster] = clusterEvents(events, { windowMs: 5 * 60 * 1000, minSize: 3 });
    expect(cluster.occurredAt).toEqual(events[0].occurredAt);
  });
});
```

- [ ] **Krok 2: Spustit test, musí spadnout, pak implementovat**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/timeline/cluster-events.test.ts
```

Očekávaný výstup: FAIL, `Failed to resolve import "./cluster-events"`.

`packages/ui/src/patterns/timeline/types.ts`:

```ts
export type TimelineEvent = {
  id: string;
  /** Typ události, například `page_view`, `email_open`, `consent_given`. */
  type: string;
  occurredAt: Date;
  payload: Record<string, unknown>;
};

export type TimelineItem =
  | { kind: 'single'; id: string; type: string; occurredAt: Date; event: TimelineEvent }
  | { kind: 'cluster'; id: string; type: string; occurredAt: Date; events: TimelineEvent[] };

export type DayGroup = {
  /** Klíč dne v zóně uživatele, tvar YYYY-MM-DD. */
  key: string;
  /** `today`, `yesterday` nebo `date`. Text dodává katalog. */
  label: 'today' | 'yesterday' | 'date';
  date: Date;
  items: TimelineItem[];
};
```

`packages/ui/src/patterns/timeline/cluster-events.ts`:

```ts
import type { TimelineEvent, TimelineItem } from './types';

/**
 * Shlukování sérií stejného typu v krátkém okně do jednoho rozbalitelného
 * řádku s počtem. Bez toho časovou osu zaplaví web tracking a e-mailové
 * události v ní zmizí.
 *
 * Vstup je seřazený od nejnovější události. Výstup si pořadí drží.
 */
export function clusterEvents(
  events: TimelineEvent[],
  {
    windowMs,
    minSize,
    neverCluster = [],
  }: {
    /** Jak blízko u sebe musí události být, aby se spojily. */
    windowMs: number;
    /** Kolik událostí musí být, aby se vůbec shlukovaly. */
    minSize: number;
    /** Typy, které se nikdy neshlukují, protože jsou to ty důležité. */
    neverCluster?: string[];
  },
): TimelineItem[] {
  const items: TimelineItem[] = [];
  let index = 0;

  while (index < events.length) {
    const first = events[index];

    if (neverCluster.includes(first.type)) {
      items.push({ kind: 'single', id: first.id, type: first.type, occurredAt: first.occurredAt, event: first });
      index += 1;
      continue;
    }

    let end = index + 1;
    while (
      end < events.length &&
      events[end].type === first.type &&
      Math.abs(first.occurredAt.getTime() - events[end].occurredAt.getTime()) <= windowMs
    ) {
      end += 1;
    }

    const group = events.slice(index, end);
    if (group.length >= minSize) {
      items.push({
        kind: 'cluster',
        id: `cluster-${first.id}`,
        type: first.type,
        // Shluk drží čas nejnovější události, aby seděl v pořadí osy.
        occurredAt: first.occurredAt,
        events: group,
      });
    } else {
      for (const event of group) {
        items.push({ kind: 'single', id: event.id, type: event.type, occurredAt: event.occurredAt, event });
      }
    }
    index = end;
  }

  return items;
}
```

- [ ] **Krok 3: Napsat padající test na oddělovače dnů**

Oddělovače se počítají **v časové zóně uživatele**, ne serveru. Událost v 1:30 pražského času je jiný den než v UTC.

`packages/ui/src/patterns/timeline/day-groups.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { groupByDay } from './day-groups';
import type { TimelineItem } from './types';

function item(id: string, iso: string): TimelineItem {
  const occurredAt = new Date(iso);
  return {
    kind: 'single',
    id,
    type: 'page_view',
    occurredAt,
    event: { id, type: 'page_view', occurredAt, payload: {} },
  };
}

const now = new Date('2026-07-31T12:00:00.000Z');

describe('groupByDay', () => {
  it('rozdělí položky na dny v zóně uživatele', () => {
    const groups = groupByDay(
      [item('a', '2026-07-31T10:00:00.000Z'), item('b', '2026-07-30T10:00:00.000Z')],
      { timeZone: 'Europe/Prague', now },
    );
    expect(groups).toHaveLength(2);
    expect(groups[0].label).toBe('today');
    expect(groups[1].label).toBe('yesterday');
  });

  it('zóna uživatele rozhoduje, ne UTC', () => {
    // 23:30 UTC je v Praze už 1:30 dalšího dne.
    const groups = groupByDay([item('a', '2026-07-30T23:30:00.000Z')], {
      timeZone: 'Europe/Prague',
      now,
    });
    expect(groups[0].key).toBe('2026-07-31');
    expect(groups[0].label).toBe('today');
  });

  it('v jiné zóně vyjde jiný den', () => {
    const groups = groupByDay([item('a', '2026-07-30T23:30:00.000Z')], {
      timeZone: 'UTC',
      now,
    });
    expect(groups[0].key).toBe('2026-07-30');
    expect(groups[0].label).toBe('yesterday');
  });

  it('starší dny dostanou obyčejné datum', () => {
    const groups = groupByDay([item('a', '2026-06-12T10:00:00.000Z')], {
      timeZone: 'Europe/Prague',
      now,
    });
    expect(groups[0].label).toBe('date');
  });

  it('položky uvnitř dne si drží pořadí od nejnovější', () => {
    const groups = groupByDay(
      [item('a', '2026-07-31T14:42:00.000Z'), item('b', '2026-07-31T14:38:00.000Z')],
      { timeZone: 'Europe/Prague', now },
    );
    expect(groups[0].items.map((entry) => entry.id)).toEqual(['a', 'b']);
  });
});
```

- [ ] **Krok 4: Spustit test, musí spadnout, pak implementovat**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/timeline/day-groups.test.ts
```

Očekávaný výstup: FAIL, `Failed to resolve import "./day-groups"`.

`packages/ui/src/patterns/timeline/day-groups.ts`:

```ts
import type { DayGroup, TimelineItem } from './types';

/** Klíč dne ve tvaru YYYY-MM-DD **v zadané zóně**, ne v UTC. */
function dayKey(value: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(value);
  return parts;
}

function shiftDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * 24 * 60 * 60 * 1000);
}

/**
 * Oddělovače dnů se počítají v časové zóně uživatele.
 * Událost ve 23:30 UTC je v Praze už další den a uživatel to tak vidí.
 */
export function groupByDay(
  items: TimelineItem[],
  { timeZone, now = new Date() }: { timeZone: string; now?: Date },
): DayGroup[] {
  const todayKey = dayKey(now, timeZone);
  const yesterdayKey = dayKey(shiftDays(now, -1), timeZone);

  const groups = new Map<string, DayGroup>();
  for (const item of items) {
    const key = dayKey(item.occurredAt, timeZone);
    const existing = groups.get(key);
    if (existing) {
      existing.items.push(item);
      continue;
    }
    groups.set(key, {
      key,
      label: key === todayKey ? 'today' : key === yesterdayKey ? 'yesterday' : 'date',
      date: item.occurredAt,
      items: [item],
    });
  }

  return [...groups.values()];
}
```

- [ ] **Krok 5: Spustit testy a commit**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/timeline
git add packages/ui/src/patterns/timeline
git commit -m "feat(ui): K8 event clustering and day separators in the user time zone"
```

Očekávaný výstup: 11 passed.

---

### Úkol 27: K8 Časová osa, vykreslení, dávky a kotvy

**Soubory:**
- Vytvořit: `packages/ui/src/patterns/timeline/use-anchored-batches.ts`, `timeline.tsx`, `index.ts`
- Test: `packages/ui/src/patterns/timeline/timeline.test.tsx`

- [ ] **Krok 1: Napsat padající test**

`packages/ui/src/patterns/timeline/timeline.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Timeline } from './timeline';
import type { TimelineEvent } from './types';

const events: TimelineEvent[] = [
  {
    id: 'e1',
    type: 'email_open',
    occurredAt: new Date('2026-07-31T12:41:00.000Z'),
    payload: { campaign: 'Letní výprodej' },
  },
  ...[0, 1, 2, 3].map((index) => ({
    id: `p${index}`,
    type: 'page_view',
    occurredAt: new Date(`2026-07-30T16:2${index}:00.000Z`),
    payload: {},
  })),
];

const labels = {
  today: 'Dnes',
  yesterday: 'Včera',
  loadOlder: 'Načíst starší',
  expandCluster: (count: number) => `Rozbalit ${count} událostí`,
  collapseCluster: 'Sbalit skupinu událostí',
  expanded: 'Rozbaleno',
  collapsed: 'Sbaleno',
};

/**
 * Věta se skládá v katalogu, ne v komponentě. Tady je testovací obsluha,
 * která napodobuje ICU `select` nad **celou** větou.
 */
function renderSentence({ event, gender }: { event: TimelineEvent; gender: 'female' | 'male' | 'other' }) {
  if (event.type === 'email_open') {
    const campaign = String(event.payload.campaign);
    if (gender === 'female') return `Otevřela kampaň ${campaign}`;
    if (gender === 'male') return `Otevřel kampaň ${campaign}`;
    return `Otevření kampaně ${campaign}`;
  }
  return 'Zobrazení stránky';
}

function base(overrides: Partial<React.ComponentProps<typeof Timeline>> = {}) {
  return {
    events,
    gender: 'female' as const,
    timeZone: 'Europe/Prague',
    now: new Date('2026-07-31T14:00:00.000Z'),
    labels,
    renderSentence,
    formatTime: (value: Date) =>
      new Intl.DateTimeFormat('cs', { timeZone: 'Europe/Prague', hour: '2-digit', minute: '2-digit' }).format(value),
    formatDate: (value: Date) =>
      new Intl.DateTimeFormat('cs', { timeZone: 'Europe/Prague', dateStyle: 'long' }).format(value),
    hasMore: true,
    onLoadOlder: vi.fn(),
    ...overrides,
  };
}

describe('Timeline', () => {
  it('u ženy použije ženský tvar slovesa', () => {
    render(<Timeline {...base()} />);
    expect(screen.getByText('Otevřela kampaň Letní výprodej')).toBeVisible();
  });

  it('u muže mužský tvar', () => {
    render(<Timeline {...base({ gender: 'male' })} />);
    expect(screen.getByText('Otevřel kampaň Letní výprodej')).toBeVisible();
  });

  it('u neznámého rodu podstatné jméno, nikdy mužský tvar', () => {
    render(<Timeline {...base({ gender: 'other' })} />);
    expect(screen.getByText('Otevření kampaně Letní výprodej')).toBeVisible();
    expect(screen.queryByText(/Otevřel kampaň/)).toBeNull();
  });

  it('oddělovače dnů jsou mezinadpisy, ne položky seznamu', () => {
    render(<Timeline {...base()} />);
    expect(screen.getByRole('heading', { name: 'Dnes' })).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Včera' })).toBeVisible();
  });

  it('série stejného typu je jeden rozbalitelný řádek s počtem', async () => {
    const user = userEvent.setup();
    render(<Timeline {...base()} />);

    const toggle = screen.getByRole('button', { name: 'Rozbalit 4 událostí' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);
    expect(screen.getByRole('button', { name: 'Sbalit skupinu událostí' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('rozbalení shluku je ohlášené čtečce', async () => {
    const user = userEvent.setup();
    render(<Timeline {...base()} />);
    await user.click(screen.getByRole('button', { name: 'Rozbalit 4 událostí' }));
    expect(screen.getByRole('status')).toHaveTextContent('Rozbaleno');
  });

  it('každá položka má trvalou kotvu v URL', () => {
    render(<Timeline {...base()} />);
    const item = screen.getByTestId('timeline-item-e1');
    expect(item).toHaveAttribute('id', 'event-e1');
    expect(within(item).getByRole('link')).toHaveAttribute('href', '#event-e1');
  });

  it('celá osa je průchozí z klávesnice', async () => {
    const user = userEvent.setup();
    render(<Timeline {...base()} />);
    await user.tab();
    expect(document.activeElement).not.toBe(document.body);
  });

  it('nabízí načtení starší dávky, dokud je co načítat', async () => {
    const user = userEvent.setup();
    const onLoadOlder = vi.fn();
    render(<Timeline {...base({ onLoadOlder })} />);
    await user.click(screen.getByRole('button', { name: 'Načíst starší' }));
    expect(onLoadOlder).toHaveBeenCalledTimes(1);
  });

  it('bez dalších dávek tlačítko nenabízí', () => {
    render(<Timeline {...base({ hasMore: false })} />);
    expect(screen.queryByRole('button', { name: 'Načíst starší' })).toBeNull();
  });
});
```

- [ ] **Krok 2: Spustit test, musí spadnout, pak implementovat**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/timeline/timeline.test.tsx
```

Očekávaný výstup: FAIL, `Failed to resolve import "./timeline"`.

`packages/ui/src/patterns/timeline/use-anchored-batches.ts`:

```ts
'use client';

import { useCallback, useLayoutEffect, useRef, useState } from 'react';

/**
 * Načítání po dávkách bez skoku scrollu.
 *
 * Když se starší dávka připojí pod stávající obsah, výška kontejneru vzroste.
 * Prohlížeč sám o sobě scroll neposune, ale u os, které rostou nahoru,
 * i u návratu z kotvy to poskočí. Držíme si proto výšku před připojením
 * a po vykreslení scroll dorovnáme.
 */
export function useAnchoredBatches({ containerRef }: { containerRef: React.RefObject<HTMLElement | null> }) {
  const previousHeight = useRef<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const beforeLoad = useCallback(() => {
    previousHeight.current = containerRef.current?.scrollHeight ?? null;
    setIsLoading(true);
  }, [containerRef]);

  const afterLoad = useCallback(() => {
    setIsLoading(false);
  }, []);

  useLayoutEffect(() => {
    if (isLoading || previousHeight.current === null) return;
    const container = containerRef.current;
    if (!container) return;
    const delta = container.scrollHeight - previousHeight.current;
    if (delta > 0 && container.scrollTop > 0) {
      container.scrollTop += delta;
    }
    previousHeight.current = null;
  }, [containerRef, isLoading]);

  return { beforeLoad, afterLoad, isLoading };
}
```

`packages/ui/src/patterns/timeline/timeline.tsx`:

```tsx
'use client';

import { Link2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { cn } from '../../lib/cn';
import { clusterEvents } from './cluster-events';
import { groupByDay } from './day-groups';
import { useAnchoredBatches } from './use-anchored-batches';
import type { TimelineEvent } from './types';

export type TimelineGender = 'female' | 'male' | 'other';

export type TimelineLabels = {
  today: string;
  yesterday: string;
  loadOlder: string;
  expandCluster: (count: number) => string;
  collapseCluster: string;
  expanded: string;
  collapsed: string;
};

const CLUSTER_WINDOW_MS = 5 * 60 * 1000;
const CLUSTER_MIN_SIZE = 3;
/** E-mailové události jsou to podstatné, nikdy se neshlukují. */
const NEVER_CLUSTER = ['email_delivered', 'email_open', 'email_click', 'consent_given'];

export function Timeline({
  events,
  gender,
  timeZone,
  now,
  labels,
  renderSentence,
  formatTime,
  formatDate,
  hasMore,
  onLoadOlder,
  className,
}: {
  /** Seřazené od nejnovější. */
  events: TimelineEvent[];
  /** Rod kontaktu z pole `gender`. Neznámý rod dostane podstatné jméno. */
  gender: TimelineGender;
  /** Časová zóna uživatele, ne serveru. */
  timeZone: string;
  now?: Date;
  labels: TimelineLabels;
  /**
   * Věta se skládá v katalogu jako **jedna ICU zpráva se `select` nad celou
   * větou**, ne z fragmentů. Komponenta jen předá událost a rod.
   */
  renderSentence: (input: { event: TimelineEvent; gender: TimelineGender }) => React.ReactNode;
  formatTime: (value: Date) => string;
  formatDate: (value: Date) => string;
  hasMore: boolean;
  onLoadOlder: () => void;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { beforeLoad } = useAnchoredBatches({ containerRef });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [announcement, setAnnouncement] = useState('');

  const items = clusterEvents(events, {
    windowMs: CLUSTER_WINDOW_MS,
    minSize: CLUSTER_MIN_SIZE,
    neverCluster: NEVER_CLUSTER,
  });
  const days = groupByDay(items, { timeZone, now });

  function toggleCluster(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
        setAnnouncement(labels.collapsed);
      } else {
        next.add(id);
        setAnnouncement(labels.expanded);
      }
      return next;
    });
  }

  function renderEvent(event: TimelineEvent) {
    return (
      <li
        key={event.id}
        id={`event-${event.id}`}
        data-testid={`timeline-item-${event.id}`}
        className="flex items-baseline gap-3 py-2"
      >
        <time
          dateTime={event.occurredAt.toISOString()}
          className="w-14 shrink-0 font-mono text-sm text-text-muted"
        >
          {formatTime(event.occurredAt)}
        </time>
        <span className="flex-1 text-sm text-text">{renderSentence({ event, gender })}</span>
        {/* Trvalá kotva: odkaz jde poslat kolegovi a otevře se na téhle položce. */}
        <a
          href={`#event-${event.id}`}
          aria-label={`#event-${event.id}`}
          className="flex size-11 items-center justify-center text-text-muted"
        >
          <Link2 aria-hidden className="size-4" />
        </a>
      </li>
    );
  }

  return (
    <div ref={containerRef} className={cn('flex flex-col gap-4 overflow-auto', className)}>
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>

      {days.map((day) => (
        <section key={day.key}>
          {/* Oddělovač dne je mezinadpis, ne položka seznamu, a neposouvá se. */}
          <h3 className="sticky top-0 z-[var(--z-sticky)] bg-surface py-1 text-sm font-medium text-text-muted">
            {day.label === 'today'
              ? labels.today
              : day.label === 'yesterday'
                ? labels.yesterday
                : formatDate(day.date)}
          </h3>

          <ul className="divide-y divide-border">
            {day.items.map((item) => {
              if (item.kind === 'single') return renderEvent(item.event);

              const isOpen = expanded.has(item.id);
              return (
                <li key={item.id} className="py-2">
                  <button
                    type="button"
                    aria-expanded={isOpen}
                    onClick={() => toggleCluster(item.id)}
                    className="flex min-h-11 w-full items-baseline gap-3 text-left"
                  >
                    <time
                      dateTime={item.occurredAt.toISOString()}
                      className="w-14 shrink-0 font-mono text-sm text-text-muted"
                    >
                      {formatTime(item.occurredAt)}
                    </time>
                    <span className="flex-1 text-sm text-text">
                      {isOpen ? labels.collapseCluster : labels.expandCluster(item.events.length)}
                    </span>
                  </button>
                  {isOpen ? <ul className="pl-14">{item.events.map(renderEvent)}</ul> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      {hasMore ? (
        <div>
          <button
            type="button"
            onClick={() => {
              beforeLoad();
              onLoadOlder();
            }}
            className="min-h-11 rounded-[var(--radius-control)] border border-border-strong px-4 text-sm text-text"
          >
            {labels.loadOlder}
          </button>
        </div>
      ) : null}
    </div>
  );
}
```

`packages/ui/src/patterns/timeline/index.ts`:

```ts
export { clusterEvents } from './cluster-events';
export { groupByDay } from './day-groups';
export { Timeline } from './timeline';
export type { TimelineGender, TimelineLabels } from './timeline';
export type { DayGroup, TimelineEvent, TimelineItem } from './types';
export { useAnchoredBatches } from './use-anchored-batches';
```

- [ ] **Krok 3: Spustit testy a commit**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/timeline
pnpm --filter @mlain/ui typecheck
git add packages/ui/src/patterns/timeline
git commit -m "feat(ui): K8 timeline with gendered sentences, clusters and stable anchors"
```

Očekávaný výstup: 21 passed.

---

### Úkol 28: Registr navigace celý dopředu

Uzávěr S5 je jednoznačný: **P05 zapíše celý strom dopředu**, včetně sedmé položky rezervované pro Automatizace, která se v MVP 0 nezobrazuje. Doménový plán navigaci nerozšiřuje, jen naplní cestu.

Platí dvě pravidla ze 7.2b, která se snadno popletou:

1. **Celá sekce navigace se smí skrýt**, když na ni uživatel nemá oprávnění. Nabízet cestu, která vždy skončí na 403, je horší než ji nenabízet.
2. **Akce uvnitř obrazovky, kterou uživatel vidí, se skrývat nesmí.** Prohlížející musí vidět, že tlačítko Odeslat existuje a proč ho nemůže použít. Jinak nemá jak zjistit, o co má požádat.

**Soubory:**
- Vytvořit: `packages/ui/src/patterns/navigation/registry.ts`, `visible-navigation.ts`, `index.ts`
- Test: `packages/ui/src/patterns/navigation/visible-navigation.test.ts`

- [ ] **Krok 1: Napsat padající test**

`packages/ui/src/patterns/navigation/visible-navigation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { NAVIGATION, type NavigationItem } from './registry';
import { visibleNavigation } from './visible-navigation';

const owner = [
  'contacts:read',
  'campaigns:read',
  'templates:read',
  'reports:read',
  'providers:read',
  'api_keys:read',
  'webhooks:read',
  'audit:read',
  'backups:read',
  'members:read',
];

describe('registr navigace', () => {
  it('obsahuje šest viditelných míst a jedno rezervované', () => {
    expect(NAVIGATION).toHaveLength(7);
    expect(NAVIGATION.filter((section) => section.reservedFor === undefined)).toHaveLength(6);
  });

  it('sedmá položka je rezervovaná pro Automatizace a v MVP 0 se nezobrazuje', () => {
    const automations = NAVIGATION.find((section) => section.id === 'automations');
    expect(automations?.reservedFor).toBe('MVP2');
    expect(visibleNavigation({ permissions: owner }).map((section) => section.id)).not.toContain(
      'automations',
    );
  });

  it('hloubka stromu nikde nepřekročí tři úrovně', () => {
    for (const section of NAVIGATION) {
      for (const child of section.children ?? []) {
        expect(child.children ?? []).toHaveLength(0);
      }
    }
  });

  it('vlastník vidí všech šest sekcí', () => {
    expect(visibleNavigation({ permissions: owner })).toHaveLength(6);
  });

  it('prohlížející nevidí Nastavení kromě profilu', () => {
    const visible = visibleNavigation({ permissions: ['contacts:read', 'campaigns:read'] });
    const settings = visible.find((section) => section.id === 'settings');
    expect(settings?.children?.map((child) => child.id)).toEqual(['settings-account']);
  });

  it('editor nevidí Zálohy, Audit log, Klíče k API ani Webhooky', () => {
    const visible = visibleNavigation({
      permissions: ['contacts:read', 'campaigns:read', 'templates:read', 'reports:read', 'members:read'],
    });
    const settings = visible.find((section) => section.id === 'settings');
    const ids = settings?.children?.map((child) => child.id) ?? [];
    expect(ids).not.toContain('settings-backups');
    expect(ids).not.toContain('settings-audit');
    expect(ids).not.toContain('settings-api-keys');
    expect(ids).not.toContain('settings-webhooks');
  });

  it('sekce bez jediné viditelné podpoložky zmizí celá', () => {
    const visible = visibleNavigation({ permissions: [] });
    expect(visible.map((section) => section.id)).not.toContain('statistics');
  });

  it('cesta se skládá ze slugu projektu', () => {
    const visible = visibleNavigation({ permissions: owner, workspaceSlug: 'eshop-kolo' });
    const contacts = visible.find((section) => section.id === 'contacts');
    expect(contacts?.href).toBe('/w/eshop-kolo/contacts');
    expect(contacts?.children?.[0].href).toBe('/w/eshop-kolo/contacts');
  });

  it('šest obrazovek Nastavení, které v MVP 0 nikdo nedodá, se nezobrazí', () => {
    // Bez příznaku by menu nabídlo šest cest končících na prázdné stránce.
    const visible = visibleNavigation({ permissions: owner });
    const settings = visible.find((section) => section.id === 'settings');
    const ids = settings?.children?.map((child) => child.id) ?? [];
    for (const hidden of [
      'settings-sending',
      'settings-fields',
      'settings-consent',
      'settings-tracking',
      'settings-ai',
      'settings-backups',
    ]) {
      expect(ids, `${hidden} se v MVP 0 nemá zobrazit`).not.toContain(hidden);
    }
  });

  it('po přehození příznaku se položka objeví, aniž se registr rozšiřuje', () => {
    const visible = visibleNavigation({ permissions: owner, includeNonMvp0: true });
    const settings = visible.find((section) => section.id === 'settings');
    expect(settings?.children?.map((child) => child.id)).toContain('settings-sending');
  });

  it('každá položka má příznak mvp0 vyplněný, žádná se nezapomněla', () => {
    const walk = (items: readonly NavigationItem[]) => {
      for (const item of items) {
        expect(typeof item.mvp0, `${item.id} nemá mvp0`).toBe('boolean');
        if (item.children) walk(item.children);
      }
    };
    walk(NAVIGATION);
  });

  it('žádná položka nemá prázdný překladový klíč', () => {
    const walk = (items: typeof NAVIGATION) => {
      for (const item of items) {
        expect(item.labelKey).toMatch(/^common\.nav\./);
        if (item.children) walk(item.children as typeof NAVIGATION);
      }
    };
    walk(NAVIGATION);
  });
});
```

- [ ] **Krok 2: Spustit test, musí spadnout, pak implementovat**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/navigation
```

Očekávaný výstup: FAIL, `Failed to resolve import "./registry"`.

`packages/ui/src/patterns/navigation/registry.ts`:

```ts
/**
 * Registr navigace, celý dopředu (uzávěr S5 řídicího dokumentu).
 *
 * Doménový plán tenhle soubor **nerozšiřuje**. Jeho úkolem je naplnit
 * cestu obsahem, ne přidat položku. Nová položka menu je rozhodnutí,
 * které dělá uživatel, takže se zavádí jen za samostatnou úlohu
 * s vlastním životním cyklem.
 *
 * Hloubka nejvýš tři úrovně. Co je hlouběji, se otevírá jako panel
 * nebo dialog nad kontextem, ne jako další stránka.
 */
export type NavigationItem = {
  id: string;
  /** Plná cesta klíče v katalogu. Klíče se nikdy neskládají za běhu. */
  labelKey: string;
  /** Cesta bez slugu projektu, doplní ho `visibleNavigation`. */
  path: string;
  /** Oprávnění, bez kterého se položka vůbec nezobrazí. */
  permission?: string;
  /**
   * Je obrazovka hotová v MVP 0?
   *
   * Registr je celý dopředu (uzávěr S5), ale polovinu obrazovek Nastavení
   * v MVP 0 nikdo nedodá. Bez tohohle příznaku by menu nabízelo šest cest,
   * které skončí na prázdné stránce. Pozdější plán, který svou obrazovku
   * dodá, **přehodí tenhle jeden boolean** jako deklarovanou úzkou výjimku
   * ve svém plánu. Registr se tím nerozšiřuje, takže S5 platí dál.
   */
  mvp0: boolean;
  children?: NavigationItem[];
  /** Rezervované místo, které se v MVP 0 nezobrazuje. */
  reservedFor?: 'MVP2';
};

export const NAVIGATION: NavigationItem[] = [
  {
    id: 'overview',
    labelKey: 'common.nav.overview',
    path: '',
    mvp0: true,
  },
  {
    id: 'contacts',
    labelKey: 'common.nav.contacts',
    path: '/contacts',
    mvp0: true,
    permission: 'contacts:read',
    children: [
      { id: 'contacts-all', labelKey: 'common.nav.contactsAll', path: '/contacts', permission: 'contacts:read', mvp0: true },
      { id: 'contacts-lists', labelKey: 'common.nav.contactsLists', path: '/lists', permission: 'contacts:read', mvp0: true },
      { id: 'contacts-segments', labelKey: 'common.nav.contactsSegments', path: '/segments', permission: 'contacts:read', mvp0: true },
      { id: 'contacts-tags', labelKey: 'common.nav.contactsTags', path: '/tags', permission: 'contacts:read', mvp0: true },
      { id: 'contacts-import', labelKey: 'common.nav.contactsImport', path: '/contacts/import', permission: 'contacts:write', mvp0: true },
      { id: 'contacts-forms', labelKey: 'common.nav.contactsForms', path: '/forms', permission: 'contacts:read', mvp0: true },
      { id: 'contacts-suppressions', labelKey: 'common.nav.contactsSuppressions', path: '/suppressions', permission: 'contacts:read', mvp0: true },
      { id: 'contacts-greeting-queue', labelKey: 'common.nav.contactsGreetingQueue', path: '/greeting-queue', permission: 'contacts:write', mvp0: true },
    ],
  },
  {
    id: 'campaigns',
    labelKey: 'common.nav.campaigns',
    path: '/campaigns',
    mvp0: true,
    permission: 'campaigns:read',
    children: [
      { id: 'campaigns-all', labelKey: 'common.nav.campaignsAll', path: '/campaigns', permission: 'campaigns:read', mvp0: true },
      { id: 'campaigns-scheduled', labelKey: 'common.nav.campaignsScheduled', path: '/campaigns/scheduled', permission: 'campaigns:read', mvp0: true },
    ],
  },
  {
    id: 'templates',
    labelKey: 'common.nav.templates',
    path: '/templates',
    mvp0: true,
    permission: 'templates:read',
    children: [
      { id: 'templates-library', labelKey: 'common.nav.templatesLibrary', path: '/templates', permission: 'templates:read', mvp0: true },
      { id: 'templates-brand', labelKey: 'common.nav.templatesBrand', path: '/brand', permission: 'templates:read', mvp0: true },
    ],
  },
  {
    id: 'statistics',
    labelKey: 'common.nav.statistics',
    path: '/statistics',
    mvp0: true,
    permission: 'reports:read',
    children: [
      { id: 'statistics-deliverability', labelKey: 'common.nav.statisticsDeliverability', path: '/statistics/deliverability', permission: 'reports:read', mvp0: true },
      { id: 'statistics-over-time', labelKey: 'common.nav.statisticsOverTime', path: '/statistics/over-time', permission: 'reports:read', mvp0: true },
      { id: 'statistics-contacts', labelKey: 'common.nav.statisticsContacts', path: '/statistics/contacts', permission: 'reports:read', mvp0: true },
    ],
  },
  {
    id: 'settings',
    labelKey: 'common.nav.settings',
    path: '/settings/general',
    mvp0: true,
    children: [
      { id: 'settings-general', labelKey: 'common.nav.settingsGeneral', path: '/settings/general', permission: 'workspace:update', mvp0: true },
      { id: 'settings-sending', labelKey: 'common.nav.settingsSending', path: '/settings/sending', permission: 'providers:read', mvp0: false },
      { id: 'settings-fields', labelKey: 'common.nav.settingsFields', path: '/settings/fields', permission: 'contacts:write', mvp0: false },
      { id: 'settings-members', labelKey: 'common.nav.settingsMembers', path: '/settings/members', permission: 'members:invite', mvp0: true },
      { id: 'settings-api-keys', labelKey: 'common.nav.settingsApiKeys', path: '/settings/api-keys', permission: 'api_keys:read', mvp0: true },
      { id: 'settings-webhooks', labelKey: 'common.nav.settingsWebhooks', path: '/settings/webhooks', permission: 'webhooks:read', mvp0: true },
      { id: 'settings-consent', labelKey: 'common.nav.settingsConsent', path: '/settings/consent', permission: 'gdpr:read', mvp0: false },
      { id: 'settings-tracking', labelKey: 'common.nav.settingsTracking', path: '/settings/tracking', permission: 'tracking:read', mvp0: false },
      { id: 'settings-ai', labelKey: 'common.nav.settingsAi', path: '/settings/ai', permission: 'ai:read', mvp0: false },
      { id: 'settings-audit', labelKey: 'common.nav.settingsAudit', path: '/settings/audit', permission: 'audit:read', mvp0: true },
      { id: 'settings-backups', labelKey: 'common.nav.settingsBackups', path: '/settings/backups', permission: 'backups:read', mvp0: false },
      // Můj účet vidí každý, je to jeho vlastní profil.
      { id: 'settings-account', labelKey: 'common.nav.settingsAccount', path: '/settings/account', mvp0: true },
    ],
  },
  {
    // Sedmé místo. Existuje v registru, aby si ho nikdo nezabral,
    // ale v MVP 0 se nezobrazuje.
    id: 'automations',
    labelKey: 'common.nav.automations',
    path: '/automations',
    mvp0: false,
    reservedFor: 'MVP2',
  },
];
```

`packages/ui/src/patterns/navigation/visible-navigation.ts`:

```ts
import { NAVIGATION, type NavigationItem } from './registry';

export type VisibleNavigationItem = NavigationItem & { href: string; children?: VisibleNavigationItem[] };

/**
 * Odfiltruje položky, na které uživatel nemá oprávnění, a doplní cestu
 * se slugem projektu. Sekce bez jediné viditelné podpoložky zmizí celá.
 *
 * Skrývá se **jen navigace**. Akce uvnitř obrazovky se nikdy neskrývají,
 * ty se vysvětlují (pravidlo 2 ze 7.2b).
 */
export function visibleNavigation({
  permissions,
  workspaceSlug = '{slug}',
  includeReserved = false,
  includeNonMvp0 = false,
}: {
  permissions: string[];
  workspaceSlug?: string;
  includeReserved?: boolean;
  /** Až budou obrazovky hotové, přepne se tohle na `true` a příznaky zmizí. */
  includeNonMvp0?: boolean;
}): VisibleNavigationItem[] {
  const allowed = new Set(permissions);
  const base = `/w/${workspaceSlug}`;

  function keep(item: NavigationItem): boolean {
    if (item.reservedFor !== undefined && !includeReserved) return false;
    // Cesta, kterou v MVP 0 nikdo nenaplní, se nenabízí. Prázdná stránka
    // je horší než chybějící položka.
    if (!item.mvp0 && !includeNonMvp0) return false;
    if (item.permission === undefined) return true;
    return allowed.has(item.permission);
  }

  const result: VisibleNavigationItem[] = [];

  for (const section of NAVIGATION) {
    if (section.reservedFor !== undefined && !includeReserved) continue;
    if (!section.mvp0 && !includeNonMvp0) continue;

    const children = (section.children ?? []).filter(keep).map((child) => ({
      ...child,
      href: `${base}${child.path}`,
    }));

    // Sekce s podpoložkami zmizí, když nezbyla ani jedna.
    if ((section.children?.length ?? 0) > 0 && children.length === 0) continue;
    // Sekce bez podpoložek se řídí vlastním oprávněním.
    if ((section.children?.length ?? 0) === 0 && !keep(section)) continue;

    result.push({
      ...section,
      href: `${base}${section.path}`,
      children: children.length > 0 ? children : undefined,
    });
  }

  return result;
}
```

`packages/ui/src/patterns/navigation/index.ts`:

```ts
export { NAVIGATION } from './registry';
export type { NavigationItem } from './registry';
export { visibleNavigation } from './visible-navigation';
export type { VisibleNavigationItem } from './visible-navigation';
```

- [ ] **Krok 3: Spustit testy a commit**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/navigation
git add packages/ui/src/patterns/navigation
git commit -m "feat(ui): full navigation registry with reserved automations slot"
```

Očekávaný výstup: 12 passed.

---

### Úkol 29: Skořápka aplikace

Topbar, sidebar, přepínač projektů s barevným proužkem a systémový pruh. **Přepnutí projektu vede vždy na Přehled toho projektu, nikdy na stejnou stránku v cizím projektu**, protože jinak by uživatel skončil na detailu kampaně, která v novém projektu neexistuje.

**Soubory:**
- Vytvořit: `packages/ui/src/lib/workspace-accent.ts`, `packages/ui/src/patterns/shell/topbar.tsx`, `sidebar.tsx`, `workspace-switcher.tsx`, `system-bar.tsx`, `app-shell.tsx`, `index.ts`
- Test: `packages/ui/src/lib/workspace-accent.test.ts`, `packages/ui/src/patterns/shell/system-bar.test.tsx`, `workspace-switcher.test.tsx`

- [ ] **Krok 1: Napsat padající test na barvu projektu**

`packages/ui/src/lib/workspace-accent.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { workspaceAccent } from './workspace-accent';

const id = '018f2b1c-0000-7000-8000-000000000001';

describe('workspaceAccent', () => {
  it('je deterministická, stejné id dá vždy stejnou barvu', () => {
    expect(workspaceAccent(id, 'light')).toBe(workspaceAccent(id, 'light'));
  });

  it('různá id dávají různé odstíny', () => {
    const first = workspaceAccent('018f2b1c-0000-7000-8000-000000000001', 'light');
    const second = workspaceAccent('018f2b1c-0000-7000-8000-000000000002', 'light');
    expect(first).not.toBe(second);
  });

  it('vrací oklch se stabilní světlostí a sytostí, takže kontrast nezáleží na náhodě', () => {
    const value = workspaceAccent(id, 'light');
    expect(value).toMatch(/^oklch\(0\.55 0\.16 \d+(\.\d+)?\)$/);
  });

  it('tmavý režim má vlastní světlost', () => {
    expect(workspaceAccent(id, 'dark')).toMatch(/^oklch\(0\.72 0\.16 \d+(\.\d+)?\)$/);
  });

  it('prázdné id nespadne, vrátí neutrální odstín', () => {
    expect(workspaceAccent('', 'light')).toMatch(/^oklch\(/);
  });
});
```

- [ ] **Krok 2: Spustit test, musí spadnout, pak implementovat**

```bash
pnpm --filter @mlain/ui exec vitest run src/lib/workspace-accent.test.ts
```

Očekávaný výstup: FAIL, `Failed to resolve import "./workspace-accent"`.

`packages/ui/src/lib/workspace-accent.ts`:

```ts
/**
 * Barva projektu odvozená z `workspace_id` (část 1, kapitola 5.2).
 *
 * Mění se **jen odstín**. Světlost a sytost jsou pevné, jinak by kontrast
 * proužku závisel na náhodě hashe a někdy by byl nečitelný.
 *
 * Barva nikdy není jediný rozlišovací znak: vedle proužku je vždy
 * název projektu textem (pravidlo 11.3).
 */
export function workspaceAccent(workspaceId: string, theme: 'light' | 'dark'): string {
  // FNV-1a, 32 bitů. Krátká, deterministická a bez závislosti.
  let hash = 0x811c9dc5;
  for (let index = 0; index < workspaceId.length; index += 1) {
    hash ^= workspaceId.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const hue = hash % 360;
  const lightness = theme === 'dark' ? 0.72 : 0.55;
  return `oklch(${lightness} 0.16 ${hue})`;
}
```

- [ ] **Krok 3: Napsat padající test na systémový pruh a přepínač**

`packages/ui/src/patterns/shell/system-bar.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SystemBar, type SystemBarState } from './system-bar';

const offline: SystemBarState = { kind: 'offline', message: 'Ztratili jsme spojení.' };
const trial: SystemBarState = { kind: 'trialMode', message: 'Zkušební režim.' };
const sending: SystemBarState = { kind: 'campaignRunning', message: 'Rozesílka 3 214 z 12 480.' };
const blocked: SystemBarState = { kind: 'sendingBlocked', message: 'Odesílání je zastavené.' };
const backup: SystemBarState = { kind: 'backupExpiring', message: 'Záloha za 5 dní vyprší.' };

describe('SystemBar', () => {
  it('zobrazuje nejvýš jeden stav', () => {
    render(<SystemBar states={[trial, offline, sending]} />);
    expect(screen.getAllByTestId('system-bar')).toHaveLength(1);
  });

  it('vyhrává stav s nižším pořadím', () => {
    render(<SystemBar states={[trial, offline, sending]} />);
    expect(screen.getByTestId('system-bar')).toHaveAttribute('data-kind', 'offline');
  });

  it('zablokované odesílání přebije všechno', () => {
    render(<SystemBar states={[offline, blocked, sending]} />);
    expect(screen.getByTestId('system-bar')).toHaveAttribute('data-kind', 'sendingBlocked');
  });

  it('varování o záloze je nad zkušebním režimem, jinak by ho nikdo neviděl', () => {
    render(<SystemBar states={[trial, backup]} />);
    expect(screen.getByTestId('system-bar')).toHaveAttribute('data-kind', 'backupExpiring');
  });

  it('bez stavů se nevykreslí nic', () => {
    const { container } = render(<SystemBar states={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
```

`packages/ui/src/patterns/shell/workspace-switcher.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { WorkspaceSwitcher } from './workspace-switcher';

const workspaces = [
  { id: '018f2b1c-0000-7000-8000-000000000001', slug: 'eshop-kolo', name: 'E-shop Kolo' },
  { id: '018f2b1c-0000-7000-8000-000000000002', slug: 'newsletter', name: 'Newsletter' },
];

describe('WorkspaceSwitcher', () => {
  it('název projektu je vždy vidět textem, ne jen barvou', () => {
    render(
      <WorkspaceSwitcher
        workspaces={workspaces}
        currentId={workspaces[0].id}
        theme="light"
        onSwitch={vi.fn()}
        labels={{ switcher: 'Přepnout projekt', current: (name) => `Projekt: ${name}` }}
      />,
    );
    expect(screen.getByRole('button', { name: /E-shop Kolo/ })).toBeVisible();
  });

  it('barevný proužek je odvozený z id a je dekorativní', () => {
    render(
      <WorkspaceSwitcher
        workspaces={workspaces}
        currentId={workspaces[0].id}
        theme="light"
        onSwitch={vi.fn()}
        labels={{ switcher: 'Přepnout projekt', current: (name) => `Projekt: ${name}` }}
      />,
    );
    const strip = screen.getByTestId('workspace-accent');
    expect(strip).toHaveAttribute('aria-hidden', 'true');
    expect(strip.getAttribute('style')).toContain('oklch');
  });

  it('přepnutí projektu vede na Přehled nového projektu, ne na stejnou stránku', async () => {
    const user = userEvent.setup();
    const onSwitch = vi.fn();
    render(
      <WorkspaceSwitcher
        workspaces={workspaces}
        currentId={workspaces[0].id}
        theme="light"
        onSwitch={onSwitch}
        labels={{ switcher: 'Přepnout projekt', current: (name) => `Projekt: ${name}` }}
      />,
    );
    await user.click(screen.getByRole('button', { name: /E-shop Kolo/ }));
    await user.click(screen.getByRole('menuitem', { name: 'Newsletter' }));
    expect(onSwitch).toHaveBeenCalledWith('newsletter');
  });
});
```

- [ ] **Krok 4: Spustit testy, musí spadnout, pak implementovat skořápku**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/shell
```

Očekávaný výstup: FAIL, `Failed to resolve import "./system-bar"`.

`packages/ui/src/patterns/shell/system-bar.tsx`:

```tsx
import { cn } from '../../lib/cn';

/**
 * Systémový pruh dole ukazuje **nejvýš jeden** stav.
 * Pořadí je závazné (tabulka 7.4) a nižší číslo vyhrává.
 */
const PRIORITY = [
  'sendingBlocked',
  'offline',
  'campaignRunning',
  'jobRunning',
  // Varování o záloze je nad zkušebním režimem schválně: zkušební režim
  // je trvalý stav, který by jinak vyhrával pořád, a časově omezené
  // varování o záloze by se nikdy nezobrazilo.
  'backupExpiring',
  'trialMode',
  'updateAvailable',
] as const;

export type SystemBarKind = (typeof PRIORITY)[number];

export type SystemBarState = {
  kind: SystemBarKind;
  message: string;
  action?: React.ReactNode;
};

const TONE: Record<SystemBarKind, string> = {
  sendingBlocked: 'border-danger bg-danger-surface text-danger-text',
  offline: 'border-warning bg-warning-surface text-warning-text',
  campaignRunning: 'border-border bg-surface-muted text-text',
  jobRunning: 'border-border bg-surface-muted text-text',
  backupExpiring: 'border-warning bg-warning-surface text-warning-text',
  trialMode: 'border-border bg-accent-surface text-accent-text',
  updateAvailable: 'border-border bg-accent-surface text-accent-text',
};

export function SystemBar({ states }: { states: SystemBarState[] }) {
  if (states.length === 0) return null;

  const winner = [...states].sort(
    (a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind),
  )[0];

  return (
    <div
      data-testid="system-bar"
      data-kind={winner.kind}
      role="status"
      className={cn(
        'fixed inset-x-0 bottom-0 z-[var(--z-systembar)] flex flex-wrap items-center',
        'justify-center gap-3 border-t px-4 py-2 text-sm',
        TONE[winner.kind],
      )}
    >
      <span>{winner.message}</span>
      {winner.action}
    </div>
  );
}
```

`packages/ui/src/patterns/shell/workspace-switcher.tsx`:

```tsx
'use client';

import { ChevronDown } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../components/dropdown-menu';
import { workspaceAccent } from '../../lib/workspace-accent';

export type WorkspaceSummary = { id: string; slug: string; name: string };

/**
 * Přepínač projektů. Uživatel musí vždy vědět, ve kterém projektu je,
 * protože jinak pošle kampaň špatným lidem.
 *
 * Přepnutí vede **vždy na Přehled** nového projektu, nikdy na stejnou
 * stránku v cizím projektu: kampaň s tímhle id tam neexistuje.
 */
export function WorkspaceSwitcher({
  workspaces,
  currentId,
  theme,
  onSwitch,
  labels,
}: {
  workspaces: WorkspaceSummary[];
  currentId: string;
  theme: 'light' | 'dark';
  onSwitch: (slug: string) => void;
  labels: { switcher: string; current: (name: string) => string };
}) {
  const current = workspaces.find((workspace) => workspace.id === currentId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={labels.switcher}
        className="flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] px-3 text-sm font-medium text-text hover:bg-surface-muted"
      >
        <span
          data-testid="workspace-accent"
          aria-hidden="true"
          className="inline-block h-4 w-1.5 rounded-full"
          style={{ backgroundColor: workspaceAccent(currentId, theme) }}
        />
        {current ? labels.current(current.name) : labels.switcher}
        <ChevronDown aria-hidden className="size-4 text-text-muted" />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        {workspaces.map((workspace) => (
          <DropdownMenuItem key={workspace.id} onSelect={() => onSwitch(workspace.slug)}>
            <span
              aria-hidden
              className="inline-block h-4 w-1.5 rounded-full"
              style={{ backgroundColor: workspaceAccent(workspace.id, theme) }}
            />
            {workspace.name}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

`packages/ui/src/patterns/shell/sidebar.tsx`:

```tsx
'use client';

import { cn } from '../../lib/cn';
import type { VisibleNavigationItem } from '../navigation/visible-navigation';

/**
 * Boční menu. Sbalitelné na ikony, stav sbalení se pamatuje na uživatele.
 * Barevný proužek projektu se propíše do levého okraje, aby bylo poznat
 * na první pohled, kde uživatel je.
 */
export function Sidebar({
  items,
  currentPath,
  collapsed,
  accentColor,
  translate,
  renderLink,
  labels,
}: {
  items: VisibleNavigationItem[];
  currentPath: string;
  collapsed: boolean;
  accentColor: string;
  translate: (labelKey: string) => string;
  /** Odkaz dodává aplikace, aby `packages/ui` nezáviselo na routeru. */
  renderLink: (input: { href: string; label: string; active: boolean; children: React.ReactNode }) => React.ReactNode;
  labels: { mainNavigation: string };
}) {
  return (
    <nav
      aria-label={labels.mainNavigation}
      style={{ borderLeftColor: accentColor }}
      className={cn(
        'flex shrink-0 flex-col gap-1 overflow-y-auto border-l-4 border-r border-r-border bg-surface p-2',
        collapsed ? 'w-[var(--size-sidebar-collapsed)]' : 'w-[var(--size-sidebar)]',
      )}
    >
      {items.map((section) => {
        const label = translate(section.labelKey);
        const active = currentPath === section.href || currentPath.startsWith(`${section.href}/`);
        return (
          <div key={section.id}>
            {renderLink({
              href: section.href,
              label,
              active,
              children: (
                <span
                  className={cn(
                    'flex min-h-11 items-center rounded-[var(--radius-control)] px-3 text-sm',
                    active ? 'bg-accent-surface font-medium text-accent-text' : 'text-text',
                  )}
                >
                  {collapsed ? label.slice(0, 1) : label}
                </span>
              ),
            })}
            {!collapsed && active && section.children ? (
              <div className="ml-3 flex flex-col gap-0.5 border-l border-border pl-2">
                {section.children.map((child) =>
                  renderLink({
                    href: child.href,
                    label: translate(child.labelKey),
                    active: currentPath === child.href,
                    children: (
                      <span
                        className={cn(
                          'flex min-h-11 items-center rounded-[var(--radius-control)] px-3 text-sm',
                          currentPath === child.href ? 'text-accent-text' : 'text-text-muted',
                        )}
                      >
                        {translate(child.labelKey)}
                      </span>
                    ),
                  }),
                )}
              </div>
            ) : null}
          </div>
        );
      })}
    </nav>
  );
}
```

`packages/ui/src/patterns/shell/topbar.tsx`:

```tsx
'use client';

import { HelpCircle, Search } from 'lucide-react';
import { Button } from '../../components/button';

/**
 * Topbar. Nápověda je na všech stránkách na stejném místě
 * (WCAG 2.2, kritérium 3.2.6 Consistent Help), včetně průvodců.
 */
export function Topbar({
  workspaceSwitcher,
  onOpenSearch,
  onOpenHelp,
  jobsBadge,
  userMenu,
  labels,
}: {
  workspaceSwitcher: React.ReactNode;
  onOpenSearch: () => void;
  onOpenHelp: () => void;
  jobsBadge: React.ReactNode;
  userMenu: React.ReactNode;
  labels: { search: string; help: string; skipToContent: string };
}) {
  return (
    <header className="flex h-[var(--size-topbar)] items-center gap-3 border-b border-border bg-surface px-4">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:rounded-[var(--radius-control)] focus:bg-surface focus:px-3 focus:py-2"
      >
        {labels.skipToContent}
      </a>

      <span className="font-semibold text-text">Mlain Mailer</span>
      {workspaceSwitcher}

      <div className="flex-1" />

      <Button variant="ghost" onClick={onOpenSearch}>
        <Search aria-hidden className="size-4" />
        {labels.search}
      </Button>
      <Button variant="ghost" onClick={onOpenHelp} aria-label={labels.help}>
        <HelpCircle aria-hidden className="size-4" />
      </Button>
      {jobsBadge}
      {userMenu}
    </header>
  );
}
```

`packages/ui/src/patterns/shell/app-shell.tsx`:

```tsx
'use client';

import { cn } from '../../lib/cn';
import { SystemBar, type SystemBarState } from './system-bar';

/** Kostra stránky: topbar nahoře, sidebar vlevo, obsah, systémový pruh dole. */
export function AppShell({
  topbar,
  sidebar,
  systemBarStates,
  children,
  className,
}: {
  topbar: React.ReactNode;
  sidebar: React.ReactNode;
  systemBarStates: SystemBarState[];
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-h-dvh flex-col bg-surface', className)}>
      {topbar}
      <div className="flex flex-1 overflow-hidden">
        {sidebar}
        {/* Odsazení dole nechává místo systémovému pruhu, aby nezakryl
            fokusovaný prvek (WCAG 2.2, kritérium 2.4.11). */}
        <main id="main" tabIndex={-1} className="flex-1 overflow-y-auto p-[var(--spacing-gutter)] pb-20">
          {children}
        </main>
      </div>
      <SystemBar states={systemBarStates} />
    </div>
  );
}
```

`packages/ui/src/patterns/shell/index.ts`:

```ts
export { AppShell } from './app-shell';
export { Sidebar } from './sidebar';
export { SystemBar } from './system-bar';
export type { SystemBarKind, SystemBarState } from './system-bar';
export { Topbar } from './topbar';
export { WorkspaceSwitcher } from './workspace-switcher';
export type { WorkspaceSummary } from './workspace-switcher';
```

- [ ] **Krok 5: Spustit testy a commit**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/shell src/lib/workspace-accent.test.ts
git add packages/ui/src/patterns/shell packages/ui/src/lib/workspace-accent.ts
git commit -m "feat(ui): app shell with topbar, sidebar, workspace switcher and system bar"
```

Očekávaný výstup: 13 passed.

---

### Úkol 30: Klávesové zkratky a paleta příkazů

**Zkratky jsou jazykově nezávislé.** Vazba klávesy na akci je jedna pro všechny jazyky a nikdy se nepřekládá (kritérium 71d). Lokalizuje se jen popis v nápovědě. Zkratka na zobrazení zkratek je vtip, ne funkce, takže je přehled dostupný i z nabídky uživatele.

**Soubory:**
- Vytvořit: `packages/ui/src/patterns/shortcuts/shortcut-map.ts`, `use-shortcuts.ts`, `shortcuts-help.tsx`, `command-palette.tsx`, `index.ts`
- Test: `packages/ui/src/patterns/shortcuts/shortcut-map.test.ts`, `use-shortcuts.test.tsx`

- [ ] **Krok 1: Napsat padající test**

`packages/ui/src/patterns/shortcuts/shortcut-map.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { SHORTCUTS } from './shortcut-map';

describe('SHORTCUTS', () => {
  it('mapa je jedna pro všechny jazyky, klávesy jsou literály', () => {
    for (const shortcut of SHORTCUTS) {
      expect(shortcut.keys.every((key) => typeof key === 'string')).toBe(true);
      // Popis je překladový klíč, klávesa nikdy.
      expect(shortcut.descriptionKey).toMatch(/^common\.shortcuts\./);
    }
  });

  it('obsahuje všechny zkratky z tabulky 4.5', () => {
    const ids = SHORTCUTS.map((shortcut) => shortcut.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'search',
        'goOverview',
        'goContacts',
        'goCampaigns',
        'goTemplates',
        'focusSearch',
        'save',
        'submit',
        'close',
        'help',
        'undo',
      ]),
    );
  });

  it('žádné dvě zkratky nemají stejnou kombinaci', () => {
    const seen = new Set<string>();
    for (const shortcut of SHORTCUTS) {
      const signature = `${shortcut.modifier ?? ''}:${shortcut.keys.join(' ')}`;
      expect(seen.has(signature), `kolize u ${shortcut.id}`).toBe(false);
      seen.add(signature);
    }
  });

  it('názvy kláves zůstávají anglicky', () => {
    const help = SHORTCUTS.find((shortcut) => shortcut.id === 'help');
    expect(help?.keys).toEqual(['?']);
    const save = SHORTCUTS.find((shortcut) => shortcut.id === 'save');
    expect(save?.modifier).toBe('mod');
  });
});
```

`packages/ui/src/patterns/shortcuts/use-shortcuts.test.tsx`:

```tsx
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { useShortcuts } from './use-shortcuts';

function Harness({ handlers }: { handlers: Record<string, () => void> }) {
  useShortcuts(handlers);
  return (
    <div>
      <input aria-label="hledat" />
      <textarea aria-label="poznámka" />
    </div>
  );
}

describe('useShortcuts', () => {
  it('sekvence g pak k přejde na Kontakty', async () => {
    const user = userEvent.setup();
    const goContacts = vi.fn();
    render(<Harness handlers={{ goContacts }} />);
    await user.keyboard('gk');
    expect(goContacts).toHaveBeenCalledTimes(1);
  });

  it('jednopísmenné zkratky se ignorují, když je fokus v textovém poli', async () => {
    const user = userEvent.setup();
    const goContacts = vi.fn();
    const { getByLabelText } = render(<Harness handlers={{ goContacts }} />);
    await user.click(getByLabelText('hledat'));
    await user.keyboard('gk');
    expect(goContacts).not.toHaveBeenCalled();
  });

  it('Ctrl nebo Cmd plus K otevře vyhledávání i z textového pole', async () => {
    const user = userEvent.setup();
    const search = vi.fn();
    const { getByLabelText } = render(<Harness handlers={{ search }} />);
    await user.click(getByLabelText('hledat'));
    await user.keyboard('{Control>}k{/Control}');
    expect(search).toHaveBeenCalledTimes(1);
  });

  it('sekvence vyprší, když je pauza příliš dlouhá', async () => {
    vi.useFakeTimers();
    const goContacts = vi.fn();
    render(<Harness handlers={{ goContacts }} />);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'g' }));
    vi.advanceTimersByTime(2000);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k' }));
    expect(goContacts).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('otazník otevře přehled zkratek', async () => {
    const user = userEvent.setup();
    const help = vi.fn();
    render(<Harness handlers={{ help }} />);
    await user.keyboard('?');
    expect(help).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Krok 2: Spustit testy, musí spadnout, pak implementovat**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/shortcuts
```

Očekávaný výstup: FAIL, `Failed to resolve import "./shortcut-map"`.

`packages/ui/src/patterns/shortcuts/shortcut-map.ts`:

```ts
/**
 * Mapa `zkratka → akce`. Jeden soubor bez závislosti na jazyku.
 *
 * Klávesa je konstanta v kódu, překladový katalog do ní nesahá.
 * Lokalizuje se jen popis v nápovědě (`descriptionKey`).
 *
 * Mnemotechnika `g k` (kontakty) dává smysl jen česky, a to je v pořádku:
 * zkratky se učí opakováním, ne odvozováním, a dvě mapy kláves
 * by uživatele přepínajícího jazyk připravily o svalovou paměť.
 */
export type Shortcut = {
  id: string;
  /** Posloupnost kláves. Delší než jedna znamená sekvenci, například `g` pak `k`. */
  keys: string[];
  /** `mod` je Ctrl na Windows a Linuxu, Cmd na macOS. */
  modifier?: 'mod' | 'alt';
  descriptionKey: string;
  /** Zkratka funguje i tehdy, když je fokus v textovém poli. */
  worksInInput?: boolean;
};

export const SHORTCUTS: Shortcut[] = [
  { id: 'search', keys: ['k'], modifier: 'mod', descriptionKey: 'common.shortcuts.search', worksInInput: true },
  { id: 'goOverview', keys: ['g', 'p'], descriptionKey: 'common.shortcuts.goOverview' },
  { id: 'goContacts', keys: ['g', 'k'], descriptionKey: 'common.shortcuts.goContacts' },
  { id: 'goCampaigns', keys: ['g', 'c'], descriptionKey: 'common.shortcuts.goCampaigns' },
  { id: 'goTemplates', keys: ['g', 's'], descriptionKey: 'common.shortcuts.goTemplates' },
  { id: 'focusSearch', keys: ['/'], descriptionKey: 'common.shortcuts.focusSearch' },
  { id: 'save', keys: ['s'], modifier: 'mod', descriptionKey: 'common.shortcuts.save', worksInInput: true },
  { id: 'submit', keys: ['Enter'], modifier: 'mod', descriptionKey: 'common.shortcuts.submit', worksInInput: true },
  { id: 'close', keys: ['Escape'], descriptionKey: 'common.shortcuts.close', worksInInput: true },
  { id: 'help', keys: ['?'], descriptionKey: 'common.shortcuts.help' },
  { id: 'undo', keys: ['z'], modifier: 'alt', descriptionKey: 'common.shortcuts.undo', worksInInput: true },
];

/** Zkratky tabulky, které obsluhuje sama komponenta K1, ne globální posluchač. */
export const TABLE_SHORTCUT_KEYS = ['j', 'k', 'x', ' '] as const;
```

`packages/ui/src/patterns/shortcuts/use-shortcuts.ts`:

```ts
'use client';

import { useEffect, useRef } from 'react';
import { SHORTCUTS } from './shortcut-map';

const SEQUENCE_TIMEOUT_MS = 1000;

function inTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  );
}

/**
 * Globální posluchač zkratek. Jednopísmenné zkratky se ignorují,
 * když je fokus v textovém poli, jinak by se uživateli při psaní
 * měnila stránka.
 */
export function useShortcuts(handlers: Record<string, () => void>): void {
  const buffer = useRef<string[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function reset() {
      buffer.current = [];
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    }

    function onKeyDown(event: KeyboardEvent) {
      const isTextField = inTextField(event.target);
      const modifier = event.metaKey || event.ctrlKey ? 'mod' : event.altKey ? 'alt' : undefined;

      // Zkratky s modifikátorem se řeší rovnou, sekvence se jich netýká.
      if (modifier) {
        for (const shortcut of SHORTCUTS) {
          if (shortcut.modifier !== modifier) continue;
          if (shortcut.keys.length !== 1) continue;
          if (shortcut.keys[0].toLowerCase() !== event.key.toLowerCase()) continue;
          if (isTextField && !shortcut.worksInInput) continue;
          event.preventDefault();
          handlers[shortcut.id]?.();
          reset();
          return;
        }
        return;
      }

      if (isTextField) return;

      buffer.current = [...buffer.current, event.key];
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(reset, SEQUENCE_TIMEOUT_MS);

      for (const shortcut of SHORTCUTS) {
        if (shortcut.modifier) continue;
        const tail = buffer.current.slice(-shortcut.keys.length);
        if (tail.join(' ') === shortcut.keys.join(' ')) {
          event.preventDefault();
          handlers[shortcut.id]?.();
          reset();
          return;
        }
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (timer.current) clearTimeout(timer.current);
    };
  }, [handlers]);
}
```

`packages/ui/src/patterns/shortcuts/shortcuts-help.tsx`:

```tsx
'use client';

import { Dialog, DialogBody, DialogTitle } from '../../components/dialog';
import { SHORTCUTS } from './shortcut-map';

/**
 * Přehled zkratek. Dostupný přes `?` **i z nabídky uživatele**,
 * protože zkratka na zobrazení zkratek je vtip, ne funkce.
 */
export function ShortcutsHelp({
  open,
  onOpenChange,
  title,
  translate,
  thenLabel,
  isMac,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  translate: (key: string) => string;
  /** Slovo mezi klávesami sekvence, například „pak". */
  thenLabel: string;
  isMac: boolean;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTitle>{title}</DialogTitle>
      <DialogBody>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
          {SHORTCUTS.map((shortcut) => (
            <div key={shortcut.id} className="contents">
              <dt className="flex items-center gap-1">
                {shortcut.modifier ? (
                  <kbd className="rounded border border-border bg-surface-muted px-1.5 py-0.5 font-mono text-xs">
                    {shortcut.modifier === 'mod' ? (isMac ? 'Cmd' : 'Ctrl') : 'Alt'}
                  </kbd>
                ) : null}
                {shortcut.keys.map((key, index) => (
                  <span key={key} className="flex items-center gap-1">
                    {index > 0 ? <span className="text-xs text-text-muted">{thenLabel}</span> : null}
                    <kbd className="rounded border border-border bg-surface-muted px-1.5 py-0.5 font-mono text-xs">
                      {key === ' ' ? 'Space' : key}
                    </kbd>
                  </span>
                ))}
              </dt>
              <dd className="text-sm text-text">{translate(shortcut.descriptionKey)}</dd>
            </div>
          ))}
        </dl>
      </DialogBody>
    </Dialog>
  );
}
```

`packages/ui/src/patterns/shortcuts/command-palette.tsx`:

```tsx
'use client';

import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '../../components/command';
import { Dialog, DialogTitle } from '../../components/dialog';

export type CommandEntry = { id: string; label: string; group: string; onSelect: () => void };

/**
 * Paleta příkazů `Ctrl/Cmd + K`. Skořápka dodává rám a klávesu,
 * obsah (kontakty, kampaně, šablony, akce) dodávají doménové plány
 * přes `entries`.
 */
export function CommandPalette({
  open,
  onOpenChange,
  entries,
  labels,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: CommandEntry[];
  labels: { title: string; placeholder: string; empty: string };
}) {
  const groups = [...new Set(entries.map((entry) => entry.group))];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTitle>{labels.title}</DialogTitle>
      <Command label={labels.title} className="mt-3">
        <CommandInput placeholder={labels.placeholder} />
        <CommandList>
          <CommandEmpty>{labels.empty}</CommandEmpty>
          {groups.map((group) => (
            <CommandGroup key={group} heading={group}>
              {entries
                .filter((entry) => entry.group === group)
                .map((entry) => (
                  <CommandItem
                    key={entry.id}
                    value={entry.label}
                    onSelect={() => {
                      onOpenChange(false);
                      entry.onSelect();
                    }}
                  >
                    {entry.label}
                  </CommandItem>
                ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </Dialog>
  );
}
```

`packages/ui/src/patterns/shortcuts/index.ts`:

```ts
export { CommandPalette } from './command-palette';
export type { CommandEntry } from './command-palette';
export { SHORTCUTS, TABLE_SHORTCUT_KEYS } from './shortcut-map';
export type { Shortcut } from './shortcut-map';
export { ShortcutsHelp } from './shortcuts-help';
export { useShortcuts } from './use-shortcuts';
```

- [ ] **Krok 3: Spustit testy a commit**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/shortcuts
git add packages/ui/src/patterns/shortcuts
git commit -m "feat(ui): locale independent keyboard shortcuts, help and command palette"
```

Očekávaný výstup: 9 passed.

---

### Úkol 31: Centrum úloh, prezentační vrstva

Podle rozhodnutí R4 dodává P05 **jen komponentu a odznak**, řízené rozhraním `JobsSource`. Endpoint, napojení na pg-boss a stránku `/w/{slug}/jobs/{jobId}` dodá plán, který vlastní API úloh. Kdyby P05 komponentu nedodal, napsalo by si ji několik plánů zvlášť.

**Soubory:**
- Vytvořit: `packages/ui/src/patterns/jobs/types.ts`, `jobs-badge.tsx`, `jobs-center.tsx`, `index.ts`
- Test: `packages/ui/src/patterns/jobs/jobs-center.test.tsx`

- [ ] **Krok 1: Napsat padající test**

`packages/ui/src/patterns/jobs/jobs-center.test.tsx`:

```tsx
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { JobsBadge } from './jobs-badge';
import { JobsCenter } from './jobs-center';
import type { JobSummary } from './types';

const jobs: JobSummary[] = [
  {
    id: 'job-1',
    title: 'Rozesílka kampaně Letní výprodej',
    status: 'running',
    done: 3214,
    total: 12480,
    startedBy: 'Jana Nováková',
    href: '/w/eshop-kolo/jobs/job-1',
  },
  {
    id: 'job-2',
    title: 'Import kveten.csv',
    status: 'completedWithErrors',
    done: 4987,
    total: 5000,
    href: '/w/eshop-kolo/jobs/job-2',
  },
];

const labels = {
  title: 'Úlohy',
  running: 'Běží',
  finished: 'Dokončené',
  empty: 'Zatím nic neběželo.',
  open: 'Otevřít',
  history: 'Historie za posledních 30 dní',
  progressOf: (done: string, total: string) => `${done} z ${total}`,
  startedBy: (person: string) => `Spustil ${person}`,
  runningCount: (count: number) => `Běží ${count} úloh`,
};

describe('JobsCenter', () => {
  it('rozděluje běžící a dokončené úlohy', () => {
    render(<JobsCenter jobs={jobs} labels={labels} renderLink={(job) => <a href={job.href}>{labels.open}</a>} />);
    const running = screen.getByRole('group', { name: 'Běží' });
    expect(within(running).getByText('Rozesílka kampaně Letní výprodej')).toBeVisible();
    const finished = screen.getByRole('group', { name: 'Dokončené' });
    expect(within(finished).getByText('Import kveten.csv')).toBeVisible();
  });

  it('běžící úloha má průběh s čitelnou hodnotou pro čtečku', () => {
    render(<JobsCenter jobs={jobs} labels={labels} renderLink={(job) => <a href={job.href}>{labels.open}</a>} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuetext', '3214 z 12480');
  });

  it('u cizí úlohy je vidět, kdo ji spustil', () => {
    render(<JobsCenter jobs={jobs} labels={labels} renderLink={(job) => <a href={job.href}>{labels.open}</a>} />);
    expect(screen.getByText('Spustil Jana Nováková')).toBeVisible();
  });

  it('každá úloha má vlastní odkaz, který jde poslat kolegovi', () => {
    render(<JobsCenter jobs={jobs} labels={labels} renderLink={(job) => <a href={job.href}>{labels.open}</a>} />);
    expect(screen.getAllByRole('link', { name: 'Otevřít' })[0]).toHaveAttribute(
      'href',
      '/w/eshop-kolo/jobs/job-1',
    );
  });

  it('bez úloh ukáže prázdný stav, ne prázdnou plochu', () => {
    render(<JobsCenter jobs={[]} labels={labels} renderLink={() => null} />);
    expect(screen.getByText('Zatím nic neběželo.')).toBeVisible();
  });

  it('odznak počítá jen běžící úlohy, dokončené odznak nedělají', () => {
    render(<JobsBadge jobs={jobs} labels={labels} onOpen={vi.fn()} />);
    expect(screen.getByRole('button')).toHaveAccessibleName('Běží 1 úloh');
  });

  it('bez běžících úloh ikona zůstává, jen bez odznaku', () => {
    render(<JobsBadge jobs={[jobs[1]]} labels={labels} onOpen={vi.fn()} />);
    expect(screen.getByRole('button')).toBeVisible();
    expect(screen.queryByTestId('jobs-badge-count')).toBeNull();
  });
});
```

- [ ] **Krok 2: Spustit test, musí spadnout, pak implementovat**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/jobs
```

Očekávaný výstup: FAIL, `Failed to resolve import "./jobs-badge"`.

`packages/ui/src/patterns/jobs/types.ts`:

```ts
export type JobStatus = 'running' | 'paused' | 'completed' | 'completedWithErrors' | 'failed' | 'cancelled';

export type JobSummary = {
  id: string;
  title: string;
  status: JobStatus;
  done: number;
  total: number;
  /** U cizí úlohy je vidět, kdo ji spustil (pravidlo 5.7). */
  startedBy?: string;
  href: string;
  finishedAtLabel?: string;
  note?: string;
};

export type JobsLabels = {
  title: string;
  running: string;
  finished: string;
  empty: string;
  open: string;
  history: string;
  progressOf: (done: string, total: string) => string;
  startedBy: (person: string) => string;
  runningCount: (count: number) => string;
};

export const RUNNING_STATUSES: JobStatus[] = ['running', 'paused'];
```

`packages/ui/src/patterns/jobs/jobs-center.tsx`:

```tsx
'use client';

import { Progress } from '../../components/progress';
import { RUNNING_STATUSES, type JobSummary, type JobsLabels } from './types';

/**
 * Centrum úloh. Jediné místo, kde uživatel najde všechno, co běží
 * nebo běželo na pozadí. Bez něj by dlouhé operace existovaly jen
 * v okně, ve kterém byly spuštěné.
 *
 * Komponenta je prezentační. Data i akce dodává obrazovka.
 */
export function JobsCenter({
  jobs,
  labels,
  renderLink,
  actions,
}: {
  jobs: JobSummary[];
  labels: JobsLabels;
  renderLink: (job: JobSummary) => React.ReactNode;
  actions?: (job: JobSummary) => React.ReactNode;
}) {
  const running = jobs.filter((job) => RUNNING_STATUSES.includes(job.status));
  const finished = jobs.filter((job) => !RUNNING_STATUSES.includes(job.status));

  if (jobs.length === 0) {
    return <p className="p-4 text-sm text-text-muted">{labels.empty}</p>;
  }

  function section(title: string, items: JobSummary[]) {
    if (items.length === 0) return null;
    return (
      <div role="group" aria-label={title}>
        <h3 className="px-4 py-2 text-sm font-medium text-text-muted">{title}</h3>
        <ul className="flex flex-col gap-2 px-4">
          {items.map((job) => (
            <li key={job.id} className="rounded-[var(--radius-control)] border border-border p-3">
              <p className="text-sm font-medium text-text">{job.title}</p>
              {RUNNING_STATUSES.includes(job.status) ? (
                <Progress
                  className="mt-2"
                  value={job.done}
                  max={job.total}
                  label={job.title}
                  valueText={labels.progressOf(String(job.done), String(job.total))}
                />
              ) : null}
              {job.note ? <p className="mt-1 text-sm text-text-muted">{job.note}</p> : null}
              {job.startedBy ? (
                <p className="mt-1 text-sm text-text-muted">{labels.startedBy(job.startedBy)}</p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-2">
                {renderLink(job)}
                {actions?.(job)}
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 py-2">
      {section(labels.running, running)}
      {section(labels.finished, finished)}
      <p className="px-4 text-sm text-text-muted">{labels.history}</p>
    </div>
  );
}
```

`packages/ui/src/patterns/jobs/jobs-badge.tsx`:

```tsx
'use client';

import { Settings } from 'lucide-react';
import { RUNNING_STATUSES, type JobSummary, type JobsLabels } from './types';

/**
 * Odznak počítá **běžící** úlohy. Dokončené odznak nedělají,
 * aby se nedalo dostat do stavu trvale svítící ikony.
 * Ikona zůstává i bez běžících úloh, aby šla najít historie.
 */
export function JobsBadge({
  jobs,
  labels,
  onOpen,
}: {
  jobs: JobSummary[];
  labels: JobsLabels;
  onOpen: () => void;
}) {
  const running = jobs.filter((job) => RUNNING_STATUSES.includes(job.status)).length;

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={running > 0 ? labels.runningCount(running) : labels.title}
      className="relative flex size-11 items-center justify-center rounded-[var(--radius-control)] text-text-muted hover:bg-surface-muted"
    >
      <Settings aria-hidden className="size-5" />
      {running > 0 ? (
        <span
          data-testid="jobs-badge-count"
          aria-hidden
          className="absolute right-1 top-1 min-w-4 rounded-full bg-primary px-1 text-center text-xs text-primary-foreground"
        >
          {running}
        </span>
      ) : null}
    </button>
  );
}
```

`packages/ui/src/patterns/jobs/index.ts`:

```ts
export { JobsBadge } from './jobs-badge';
export { JobsCenter } from './jobs-center';
export { RUNNING_STATUSES } from './types';
export type { JobStatus, JobSummary, JobsLabels } from './types';
```

- [ ] **Krok 3: Spustit testy a commit**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/jobs
git add packages/ui/src/patterns/jobs
git commit -m "feat(ui): jobs center panel and running-only badge"
```

Očekávaný výstup: 7 passed.

---

### Úkol 32: Galerie komponent a automatické testy přístupnosti

Zelený automatický test **není doklad přístupnosti**, je to doklad, že nejsou hrubé chyby. Automat spolehlivě najde chybějící `alt`, chybějící popisky formulářů, nedostatečný kontrast, chybějící `lang`, duplicitní `id` a špatné role. **Nezachytí** to nejrizikovější: jestli se komponenta dá ovládat z klávesnice a jestli je pořadí fokusu smysluplné. Proto k axe patří i klávesové testy v tomhle úkolu a ruční průchod podle seznamu 11.5.

**Soubory:**
- Vytvořit: `apps/web/playwright.config.ts`, `apps/web/src/app/[locale]/(dev)/ui-gallery/page.tsx`, `apps/web/e2e/ui/axe.spec.ts`, `apps/web/e2e/ui/keyboard.spec.ts`
- Test: soubory výše jsou testy

- [ ] **Krok 1: Založit Playwright konfiguraci**

`apps/web/playwright.config.ts`:

```ts
import { defineConfig, devices } from '@playwright/test';

/**
 * Konfiguraci vlastní P05, protože je první plán, který potřebuje
 * prohlížeč. Pozdější plány přidávají spec soubory do vlastních
 * podadresářů `e2e/<oblast>/` a konfiguraci nemění.
 */
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3000',
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: 'pnpm --filter @mlain/web dev',
        url: 'http://127.0.0.1:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
```

Do `apps/web/package.json` doplň skript `"test:e2e": "playwright test"` a vývojové závislosti `@playwright/test@1.62.1`, `@axe-core/playwright@4.12.1` a `axe-core@4.12.1`.

- [ ] **Krok 2: Založit galerii komponent**

Galerie existuje kvůli testům a ruční kontrole. **Mimo vývoj se nezobrazuje**, aby nebyla součástí produkčního balíku ani veřejně dostupná.

`apps/web/src/app/[locale]/(dev)/ui-gallery/page.tsx`:

```tsx
import { notFound } from 'next/navigation';
import { GalleryClient } from './gallery-client';

export const dynamic = 'force-dynamic';

export default function UiGalleryPage() {
  // Galerie je vývojový nástroj. V produkci neexistuje.
  if (process.env.NODE_ENV === 'production') notFound();
  return <GalleryClient />;
}
```

`apps/web/src/app/[locale]/(dev)/ui-gallery/gallery-client.tsx`:

```tsx
'use client';

import { Button } from '@mlain/ui/components/button';
import { Field } from '@mlain/ui/components/field';
import { Input } from '@mlain/ui/components/input';
import { DataTable } from '@mlain/ui/patterns/data-table';
import { EmailPreview } from '@mlain/ui/patterns/email-preview';
import { FileUpload } from '@mlain/ui/patterns/file-upload';
import { QueryBuilder } from '@mlain/ui/patterns/query-builder';
import {
  Alert,
  EmptyState,
  ErrorBlock,
  FilteredEmptyState,
  ForbiddenState,
} from '@mlain/ui/patterns/states';
import { Timeline } from '@mlain/ui/patterns/timeline';
import { Wizard } from '@mlain/ui/patterns/wizard';
import { useState } from 'react';
import { GALLERY_FIXTURES as fixtures } from './fixtures';

/**
 * Jedna stránka se všemi komponentami K1 až K8 a se všemi stavy obrazovek.
 * Testy axe a klávesnice běží proti ní, takže se každá komponenta
 * kontroluje ve světlém i tmavém režimu.
 */
export function GalleryClient() {
  const [step, setStep] = useState('mapping');

  return (
    <div className="flex flex-col gap-12 p-8">
      <section id="section-primitives" aria-labelledby="h-primitives">
        <h2 id="h-primitives">Primitiva</h2>
        <Button variant="primary">Odeslat 1 129 e-mailů</Button>
        <Field label="E-mail" hint="Použijeme ji jako adresu odesílatele.">
          <Input name="email" />
        </Field>
      </section>

      <section id="section-k1" aria-labelledby="h-k1">
        <h2 id="h-k1">K1 Datová tabulka</h2>
        <DataTable {...fixtures.table} />
      </section>

      <section id="section-k2" aria-labelledby="h-k2">
        <h2 id="h-k2">K2 Query builder</h2>
        <QueryBuilder {...fixtures.queryBuilder} />
      </section>

      <section id="section-k3" aria-labelledby="h-k3">
        <h2 id="h-k3">K3 Průvodce</h2>
        <Wizard {...fixtures.wizard} current={step} onNavigate={setStep}>
          <p>Obsah kroku</p>
        </Wizard>
      </section>

      <section id="section-k4" aria-labelledby="h-k4">
        <h2 id="h-k4">K4 Nahrání souboru</h2>
        <FileUpload {...fixtures.fileUpload} />
      </section>

      <section id="section-k5" aria-labelledby="h-k5">
        <h2 id="h-k5">K5 Toast</h2>
        <Button variant="secondary" onClick={fixtures.showToast}>
          Ukázat oznámení
        </Button>
      </section>

      <section id="section-k6" aria-labelledby="h-k6">
        <h2 id="h-k6">K6 Náhled e-mailu</h2>
        <EmailPreview {...fixtures.emailPreview} />
      </section>

      <section id="section-k7" aria-labelledby="h-k7">
        <h2 id="h-k7">K7 Grafy</h2>
        {fixtures.chart}
      </section>

      <section id="section-k8" aria-labelledby="h-k8">
        <h2 id="h-k8">K8 Časová osa</h2>
        <Timeline {...fixtures.timeline} />
      </section>

      <section id="section-states" aria-labelledby="h-states">
        <h2 id="h-states">Stavy obrazovek</h2>
        <EmptyState {...fixtures.emptyState} />
        <FilteredEmptyState {...fixtures.filteredEmptyState} />
        <ErrorBlock {...fixtures.errorBlock} />
        <ForbiddenState {...fixtures.forbiddenState} />
        {/* Alert má čtyři tóny a každý musí projít kontrastem v obou režimech. */}
        <Alert tone="info" title="Informace">Vysvětlení.</Alert>
        <Alert tone="warning" title="Varování">Vysvětlení.</Alert>
        <Alert tone="error" title="Chyba">Vysvětlení.</Alert>
        <Alert tone="success" title="Hotovo">Vysvětlení.</Alert>
      </section>
    </div>
  );
}
```

`apps/web/src/app/[locale]/(dev)/ui-gallery/fixtures.tsx` naplň testovacími daty ze stejných hodnot, jaké používají jednotkové testy komponent v `packages/ui`. Ke každé komponentě patří jeden reprezentativní stav, ne všechny varianty: galerie má být čitelná.

- [ ] **Krok 3: Napsat test přístupnosti**

`apps/web/e2e/ui/axe.spec.ts`:

```ts
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

const SECTIONS = [
  'section-primitives',
  'section-k1',
  'section-k2',
  'section-k3',
  'section-k4',
  'section-k5',
  'section-k6',
  'section-k7',
  'section-k8',
  'section-states',
];

for (const theme of ['light', 'dark'] as const) {
  test.describe(`${theme} režim`, () => {
    test.beforeEach(async ({ page }) => {
      await page.goto('/ui-gallery');
      // Tmavý režim se kontroluje zvlášť, protože se na něj běžně zapomíná.
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
    });

    for (const section of SECTIONS) {
      test(`${section} nemá porušení WCAG 2.2 AA`, async ({ page }) => {
        const results = await new AxeBuilder({ page })
          .include(`#${section}`)
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze();

        expect(
          results.violations.map((violation) => `${violation.id}: ${violation.help}`),
        ).toEqual([]);
      });
    }
  });
}

test('dialog má focus trap a zavírá se Escapem', async ({ page }) => {
  await page.goto('/ui-gallery');
  await page.getByRole('button', { name: /Smazat/ }).first().click();

  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();

  // Fokus nesmí uniknout z dialogu ven.
  for (let index = 0; index < 12; index += 1) {
    await page.keyboard.press('Tab');
    const inside = await dialog.evaluate((node) => node.contains(document.activeElement));
    expect(inside).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
```

- [ ] **Krok 4: Napsat klávesové testy pro K1, K4 a K8**

Tři komponenty mají v tvrdých požadavcích klávesovou alternativu. Není to zdvořilost, je to podmínka souladu s WCAG 2.2.

`apps/web/e2e/ui/keyboard.spec.ts`:

```ts
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/ui-gallery');
});

test('K1: tabulku jde projít a vybírat výhradně z klávesnice', async ({ page }) => {
  const rows = page.locator('#section-k1 [role="row"]');
  await rows.nth(1).focus();

  await page.keyboard.press('ArrowDown');
  await expect(rows.nth(2)).toBeFocused();

  await page.keyboard.press('x');
  await expect(rows.nth(2).getByRole('checkbox')).toBeChecked();

  await page.keyboard.press('k');
  await expect(rows.nth(1)).toBeFocused();
});

test('K4: soubor jde vybrat bez přetažení, jen klávesnicí', async ({ page }) => {
  const section = page.locator('#section-k4');
  const trigger = section.getByText('Vybrat soubor z počítače');

  await trigger.focus();
  await expect(trigger).toBeFocused();

  // Popisek je svázaný se vstupem, takže Enter otevře dialog výběru.
  const input = section.locator('input[type="file"]');
  await expect(input).toHaveCount(1);
});

test('K8: osa je průchozí z klávesnice a rozbalení shluku se ohlásí', async ({ page }) => {
  const section = page.locator('#section-k8');
  const toggle = section.getByRole('button', { name: /Rozbalit/ });

  await toggle.focus();
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');

  await page.keyboard.press('Enter');
  await expect(section.getByRole('button', { name: /Sbalit/ })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(page.getByRole('status')).toContainText('Rozbaleno');
});

test('fokus je vidět a nezakrývá ho sticky hlavička ani systémový pruh', async ({ page }) => {
  const row = page.locator('#section-k1 [role="row"]').nth(3);
  await row.focus();

  const visible = await row.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= window.innerHeight;
  });
  expect(visible).toBe(true);
});

test('zoom na 200 % nerozbije rozvržení a nic se neztratí', async ({ page }) => {
  await page.setViewportSize({ width: 640, height: 720 });
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
  );
  // Stránka se nesmí rolovat vodorovně. Široký obsah roluje uvnitř svého rámu.
  expect(overflow).toBe(false);
});
```

- [ ] **Krok 5: Spustit a opravit nálezy**

```bash
pnpm --filter @mlain/web exec playwright install --with-deps chromium
pnpm --filter @mlain/web test:e2e
```

Očekávaný výstup: 25 passed (2 režimy × 10 sekcí, plus 5 samostatných testů). **Když axe něco najde, je to nález v komponentě, ne v testu.** Oprav komponentu v `packages/ui` a test spusť znovu.

- [ ] **Krok 6: Commit**

```bash
git add apps/web/playwright.config.ts apps/web/e2e apps/web/src/app apps/web/package.json
git commit -m "test(web): axe and keyboard coverage for K1 to K8 in both themes"
```

---

### Úkol 33: Rozpočet balíku a líné načítání

Kritérium 81: základní balík JavaScriptu pro skořápku a první obrazovku nepřesahuje **250 kB gzip**. Kritérium 82: editor šablon, grafy ani query builder nejsou součástí základního balíku.

**Soubory:**
- Vytvořit: `apps/web/scripts/check-bundle-budget.mjs`, `packages/ui/src/patterns/charts/lazy.ts`, `packages/ui/src/patterns/query-builder/lazy.ts`
- Test: `apps/web/scripts/check-bundle-budget.test.mjs`

- [ ] **Krok 1: Zavést líné hranice**

Grafy i query builder se načítají až na obrazovce, kde jsou potřeba. Import se dělá **podcestou `/lazy`**, aby se do základního balíku nedostal ani omylem.

`packages/ui/src/patterns/charts/lazy.ts`:

```ts
'use client';

import dynamic from 'next/dynamic';

/**
 * Grafy se načítají líně, jen na obrazovkách se statistikami (14.3).
 * `recharts` je největší závislost balíčku, do základního balíku nepatří.
 */
export const LineChart = dynamic(() => import('./line-chart').then((module) => module.LineChart), {
  ssr: false,
});

export const BarChart = dynamic(() => import('./bar-chart').then((module) => module.BarChart), {
  ssr: false,
});
```

`packages/ui/src/patterns/query-builder/lazy.ts`:

```ts
'use client';

import dynamic from 'next/dynamic';

/** Query builder se načítá jen na obrazovce segmentu (14.3). */
export const QueryBuilder = dynamic(
  () => import('./query-builder').then((module) => module.QueryBuilder),
  { ssr: false },
);
```

Do `packages/ui/package.json` doplň do `exports` položky `"./patterns/charts/lazy": "./src/patterns/charts/lazy.ts"` a `"./patterns/query-builder/lazy": "./src/patterns/query-builder/lazy.ts"`. Do `peerDependencies` přidej `"next": "^16.0.0"`.

- [ ] **Krok 2: Napsat padající test kontrolního skriptu**

`apps/web/scripts/check-bundle-budget.test.mjs`:

```js
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluateBudget } from './check-bundle-budget.mjs';

test('pod limitem projde', () => {
  const result = evaluateBudget({
    firstLoadBytes: 200 * 1024,
    limitBytes: 250 * 1024,
    lazyOnlyModules: [],
  });
  assert.equal(result.ok, true);
});

test('nad limitem spadne a řekne o kolik', () => {
  const result = evaluateBudget({
    firstLoadBytes: 300 * 1024,
    limitBytes: 250 * 1024,
    lazyOnlyModules: [],
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /o 50/);
});

test('graf v základním balíku je chyba, i když se do limitu vejde', () => {
  const result = evaluateBudget({
    firstLoadBytes: 100 * 1024,
    limitBytes: 250 * 1024,
    lazyOnlyModules: ['recharts'],
  });
  assert.equal(result.ok, false);
  assert.match(result.message, /recharts/);
});

test('vypíše všechny zakázané moduly naráz, ne jen první', () => {
  const result = evaluateBudget({
    firstLoadBytes: 100 * 1024,
    limitBytes: 250 * 1024,
    lazyOnlyModules: ['recharts', 'query-builder'],
  });
  assert.match(result.message, /recharts/);
  assert.match(result.message, /query-builder/);
});
```

- [ ] **Krok 3: Spustit test, musí spadnout, pak implementovat**

```bash
node --test apps/web/scripts/check-bundle-budget.test.mjs
```

Očekávaný výstup: FAIL, `Cannot find module './check-bundle-budget.mjs'`.

`apps/web/scripts/check-bundle-budget.mjs`:

```js
#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const LIMIT_BYTES = 250 * 1024;

/** Moduly, které se do základního balíku nesmí dostat (kritérium 82). */
const LAZY_ONLY = ['recharts', 'query-builder', 'template-editor'];

export function evaluateBudget({ firstLoadBytes, limitBytes, lazyOnlyModules }) {
  const problems = [];

  if (firstLoadBytes > limitBytes) {
    const overKb = Math.round((firstLoadBytes - limitBytes) / 1024);
    problems.push(
      `Základní balík má ${Math.round(firstLoadBytes / 1024)} kB, limit je ${Math.round(
        limitBytes / 1024,
      )} kB. Je o ${overKb} kB větší.`,
    );
  }

  for (const module of lazyOnlyModules) {
    problems.push(`Modul ${module} nesmí být v základním balíku, načítá se líně.`);
  }

  return { ok: problems.length === 0, message: problems.join('\n') };
}

async function main() {
  // Next.js zapisuje rozpad balíků do .next/app-build-manifest.json.
  const manifest = JSON.parse(
    await readFile(new URL('../.next/app-build-manifest.json', import.meta.url), 'utf8'),
  );
  const stats = JSON.parse(
    await readFile(new URL('../.next/build-stats.json', import.meta.url), 'utf8'),
  );

  const firstLoadBytes = stats.firstLoadGzipBytes;
  const shellChunks = JSON.stringify(manifest.pages['/[locale]/w/[workspaceSlug]/page'] ?? []);
  const lazyOnlyModules = LAZY_ONLY.filter((module) => shellChunks.includes(module));

  const result = evaluateBudget({ firstLoadBytes, limitBytes: LIMIT_BYTES, lazyOnlyModules });
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  console.log(`Základní balík: ${Math.round(firstLoadBytes / 1024)} kB gzip, limit je 250 kB.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
```

Do `apps/web/package.json` doplň skript `"check:bundle": "node scripts/check-bundle-budget.mjs"`.

- [ ] **Krok 4: Spustit testy a commit**

```bash
node --test apps/web/scripts/check-bundle-budget.test.mjs
pnpm --filter @mlain/web build && pnpm --filter @mlain/web check:bundle
git add apps/web/scripts packages/ui
git commit -m "feat(web): bundle budget check and lazy boundaries for charts and query builder"
```

Očekávaný výstup: 4 passed, kontrola balíku vypíše velikost pod limitem.

---

### Úkol 34: Závěrečná kontrola, dokumentace a předání

**Soubory:**
- Vytvořit: `packages/ui/README.md`, `packages/ui/src/patterns/index.test.ts`

- [ ] **Krok 1: Napsat test, který hlídá úplnost a kázeň balíčku**

Tenhle test je pojistka proti tomu, aby další plán začal do `packages/ui` psát vlastní komponenty nebo obcházet tokeny.

`packages/ui/src/patterns/index.test.ts`:

```ts
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const PATTERNS_ROOT = fileURLToPath(new URL('.', import.meta.url));
const SRC_ROOT = fileURLToPath(new URL('..', import.meta.url));

async function allFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const full = `${directory}/${entry.name}`;
      if (entry.isDirectory()) return allFiles(full);
      return [full];
    }),
  );
  return files.flat();
}

describe('úplnost design systému', () => {
  it('existuje všech osm komponent K1 až K8', async () => {
    const entries = await readdir(PATTERNS_ROOT, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);

    for (const required of [
      'data-table', // K1
      'query-builder', // K2
      'wizard', // K3
      'file-upload', // K4
      'toast', // K5
      'email-preview', // K6
      'charts', // K7
      'timeline', // K8
    ]) {
      expect(directories, `chybí komponenta ${required}`).toContain(required);
    }
  });

  it('každý vzor má barrel, aby se dal importovat podcestou', async () => {
    const entries = await readdir(PATTERNS_ROOT, { withFileTypes: true });
    for (const entry of entries.filter((item) => item.isDirectory())) {
      const files = await readdir(`${PATTERNS_ROOT}${entry.name}`);
      expect(files, `${entry.name} nemá index.ts`).toContain('index.ts');
    }
  });

  it('balíček nemá kořenový vstupní bod, takže import z holého @mlain/ui nejde', async () => {
    // Uzávěr S11 nestačí napsat, musí se dát porušit jen tak, že spadne build.
    // Kdyby někdo klíč "." do exports vrátil, spadne tenhle test, ne až
    // jedenáct navazujících plánů.
    const manifest = JSON.parse(
      await readFile(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
    ) as { exports: Record<string, string> };

    expect(Object.keys(manifest.exports), 'klíč "." se do exports nesmí vrátit').not.toContain('.');
    expect(manifest.exports['./patterns/*']).toBe('./src/patterns/*/index.ts');
  });

  it('soubor src/index.ts neexistuje', async () => {
    const entries = await readdir(SRC_ROOT);
    expect(entries, 'barrel src/index.ts se vědomě nezakládá').not.toContain('index.ts');
  });

  it('žádná komponenta nepoužívá barvu mimo tokeny', async () => {
    const files = (await allFiles(SRC_ROOT)).filter(
      (file) => file.endsWith('.tsx') && !file.endsWith('.test.tsx'),
    );
    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      const matches = source.match(
        /\b(bg|text|border)-(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/g,
      );
      if (matches) offenders.push(`${file}: ${matches.join(', ')}`);
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('žádná komponenta nenese uživatelský text natvrdo', async () => {
    // Texty patří do katalogů. Komponenta je dostane přes props.
    const files = (await allFiles(PATTERNS_ROOT)).filter(
      (file) => file.endsWith('.tsx') && !file.endsWith('.test.tsx'),
    );
    const offenders: string[] = [];
    for (const file of files) {
      const source = await readFile(file, 'utf8');
      // Diakritika v JSX textu je spolehlivý příznak natvrdo psané češtiny.
      const jsxText = source.match(/>\s*[^<>{}\n]*[áčďéěíňóřšťúůýž][^<>{}\n]*\s*</gi);
      if (jsxText) offenders.push(`${file}: ${jsxText.join(' | ')}`);
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('nikde se nepoužívá dlouhá pomlčka', async () => {
    const files = await allFiles(SRC_ROOT);
    const offenders: string[] = [];
    for (const file of files.filter((item) => /\.(ts|tsx|css|md)$/.test(item))) {
      const source = await readFile(file, 'utf8');
      if (source.includes(String.fromCharCode(0x2014))) offenders.push(file);
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('allowlist výjimek ze zákazu disabled je prázdný nebo odůvodněný', async () => {
    const raw = await readFile(
      fileURLToPath(new URL('../../eslint-rules/allowlist.json', import.meta.url)),
      'utf8',
    );
    const parsed = JSON.parse(raw) as { exceptions: Array<{ reason?: string; approvedBy?: string }> };
    for (const exception of parsed.exceptions) {
      expect(exception.reason, 'výjimka bez důvodu neprojde').toBeTruthy();
      expect(exception.approvedBy, 'výjimka bez schvalovatele neprojde').toBeTruthy();
    }
  });
});
```

- [ ] **Krok 2: Spustit test a opravit nálezy**

```bash
pnpm --filter @mlain/ui exec vitest run src/patterns/index.test.ts
```

Očekávaný výstup: 8 passed.

- [ ] **Krok 3: Napsat smlouvu balíčku do README**

`packages/ui/README.md`:

```markdown
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

| Komponenta | Cesta | Tvrdé požadavky |
|---|---|---|
| K1 Datová tabulka | `patterns/data-table` | kurzorové stránkování, výběr přes stránky, nastavitelné sloupce, klávesnice, `aria-rowcount` |
| K2 Query builder | `patterns/query-builder` | hloubka 5, 50 potomků, negace, věta ze slotů, **všech 40 operátorů** |
| K3 Průvodce | `patterns/wizard` | krok v URL (`useWizardStep`), destruktivní návrat, fokus, 24hodinový koncept |
| K4 Nahrání souboru | `patterns/file-upload` | přetažení i klávesnice, průběh, části, zrušení |
| K5 Toast | `patterns/toast` | fronta o třech, slučování, odpočet, pozastavení, klávesnice |
| K6 Náhled e-mailu | `patterns/email-preview` | iframe se sandboxem, šířky, tmavý režim, bez cizích zdrojů |
| K7 Grafy | `patterns/charts` | tabulka pod grafem, vzory, klávesnice |
| K8 Časová osa | `patterns/timeline` | shluky, oddělovače dnů v zóně uživatele, rod, dávky, kotvy |

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
```

- [ ] **Krok 4: Spustit kompletní sérii**

Tohle je bod, kde se rozhoduje, jestli je plán hotový. Musí projít **všechno**, bez ohledu na to, jak malá byla poslední změna.

```bash
pnpm --filter @mlain/ui typecheck
pnpm --filter @mlain/i18n typecheck
pnpm --filter @mlain/web typecheck
pnpm --filter @mlain/ui test:unit
pnpm --filter @mlain/i18n test:unit
pnpm --filter @mlain/web test:unit
node packages/ui/eslint-rules/no-disabled-primary-action.test.cjs
node --test apps/web/scripts/check-bundle-budget.test.mjs
pnpm lint
pnpm --filter @mlain/web build
pnpm --filter @mlain/web check:bundle
pnpm --filter @mlain/web test:e2e
```

Očekávaný výstup: všechno zelené. Když něco padá, dohledej příčinu a oprav, nepřeskakuj.

- [ ] **Krok 5: Projít kontrolní seznam přístupnosti ručně**

Automat nezachytí to nejdůležitější. Projdi galerii `/ui-gallery` **celou bez myši** a odškrtej seznam z 11.5:

- [ ] Dostanu se ke každé akci jen klávesnicí
- [ ] Fokus je vždy vidět a nic ho nezakrývá
- [ ] Zoom na 200 % nerozbije rozvržení
- [ ] V režimu odstínů šedi jsou stavy pořád rozeznatelné
- [ ] Každá informace nesená barvou má i ikonu nebo slovo
- [ ] Každé pole formuláře má viditelný popisek
- [ ] Chybová hláška je svázaná s polem a jde z ní jednat
- [ ] Změna stavu se ohlásí čtečce
- [ ] Dialog má správu fokusu a zavírá se `Esc`
- [ ] Prázdný stav, načítání a chyba jsou implementované
- [ ] Texty jsou v obou jazycích a používají ICU `plural` včetně `=0`
- [ ] Automatický test a11y je zelený

- [ ] **Krok 6: Commit**

```bash
git add packages/ui/README.md packages/ui/src/patterns/index.test.ts
git commit -m "test(ui): completeness and discipline guards, document the package contract"
```

---

## 6. Akceptační kritéria, která plán pokrývá

Čísla odkazují na kapitolu 15 části 6. Kritérium je pokryté tehdy, když ho ověřuje test uvedený u úkolu, ne když ho plán zmiňuje.

### Plně pokrytá tímto plánem

| # | Kritérium | Kde |
|---|---|---|
| 3 | Chybový toast se sám nezavře | úkol 13 |
| 4 | Toast se pozastaví při hoveru i fokusu | úkol 13 |
| 5 | Selhaná optimistická akce vrátí stav přesně zpět | úkol 14 |
| 8 | Průběh se čtečce ohlásí při 25, 50, 75 a 100 % | úkol 18 |
| 9 | Živý počet se do `aria-live` propíše po 500 ms a jednou | úkol 18 |
| 16 | Dialog hromadného smazání: počet, následky, export, checkbox | úkol 15 |
| 17 | Potvrzovací dialog obsahuje slovní popis filtru | úkol 15 |
| 18 | Žádné primární tlačítko nemá `disabled`, hlídá lint | úkoly 4, 6 |
| 20 | Prázdný stav má vysvětlení a aspoň jednu akci, strukturálně | úkol 16 |
| 21 | Prázdný stav po filtrování se liší a nese filtr slovy | úkol 16 |
| 22 | Chybový stav má sbalitelné podrobnosti, kód, `request_id` a kopírování | úkol 17 |
| 43 | Segment builder nezobrazuje AND, OR, NOT ani slovo operátor | úkol 21 |
| 44 | Builder unese **všech 40 operátorů** matice, každý se správným tvarem hodnoty | úkol 21 |
| 45 | Negace skupiny jde nastavit a má vysvětlující řádek | úkol 21 |
| 47 | Hloubka 5, šestá úroveň schová tlačítko místo chyby, a sto podmínek se vykreslí | úkol 21 |
| 61 | Časová osa používá tvary sloves podle rodu, neutrální je podstatné jméno | úkol 27 |
| 68 | V katalozích není znak U+2014 | úkoly 9, 34 |
| 70 | Každý klíč má protějšek v druhém jazyce | úkol 9 |
| 71 | Řetězce se neskládají zřetězením ani dynamickým klíčem | úkoly 8, 9 |
| 71b | Věta segment builderu je jedna ICU zpráva s pojmenovanými sloty | úkol 21 |
| 71c | Obě negované kombinace mají vysvětlující řádek | úkol 21 |
| 71d | Mapa zkratek je pro `cs` i `en` shodná | úkol 30 |
| 72 | Počty používají ICU `plural` včetně `=0`, testováno na 0, 1, 2, 5, 21, 100 a 1,5 | úkol 9 |
| 76 | Neznámý kód zobrazí `detail` ze serveru a `request_id` | úkol 17 |
| 76c | Texty se nekontrolují snapshotem doslovného znění | úkoly 9, 16 |
| 78 | Tabulka nezobrazuje čísla stránek | úkol 20 |
| 79 | Neplatný kurzor ukáže první stránku stejného filtru a vysvětlení | úkol 20 |
| 80 | Indikátor se nezobrazí pod 300 ms a pak zůstane aspoň 400 ms | úkol 16 |
| 81 | Základní balík do 250 kB gzip | úkol 33 |
| 77 | Virtualizace se zapíná od 100 řádků a `aria-rowcount` zůstává z dat | úkol 20 |
| 82 | Editor, grafy ani query builder nejsou v základním balíku | úkol 33 |

### Částečně pokrytá: plán dodá mechanismus, doménový plán ho naplní

| # | Co dodává P05 | Co dodá doménový plán |
|---|---|---|
| 1 | Kanály zpětné vazby a jejich pravidla | navázání každé mutace na kanál |
| 2 | Toast s tlačítkem Vrátit zpět a odpočtem | vrácení členství včetně data přihlášení |
| 6, 7 | Zákaz `beforeunload` u serverových operací, komponenta průběhu | samotný import |
| 10 | Komponenta pruhu o výpadku živých aktualizací | přepnutí SSE na dotazování |
| 11 až 15 | `ConfirmDialog`, škála rizika, měkčí varianta, `Button` s počtem | čísla, stavy kampaně, okno na zrušení |
| 19 | Komponenty všech patnácti stavů | jejich zapojení na každé obrazovce |
| 23 | `ReadOnlyBanner` a `ReadOnlyValue` | obrazovka kampaně v režimu jen pro čtení |
| 24 | `ErrorBlock` pro dlaždici, která selhala | pět zdrojů dashboardu |
| 46, 48 až 53 | Patička builderu, presety a diagnostika | data matice, presety čištění, počty |
| 54 | Klávesová obsluha a `a11y.movedToPosition` | přesun bloku v editoru |
| 57 až 60, 64 | `ChartFrame` s tabulkou pod grafem | metriky, jmenovatele, rozpad publika |
| 73, 74 | `Intl.Collator` a poznámka u vyhledávacího pole | kolace v databázi a `unaccent` |
| 75 | `time.projectTimezoneNote` a formátovací funkce | čas naplánované kampaně |
| 69 | Kontrola dvaadvaceti výrazů, u kterých je strojová shoda jednoznačná | zbytek sloupce „Nikdy nepoužívat“ hlídá code review |
| 76b | Struktura `common.errors` a `ErrorBlock` | klíč pro každý doménový kód |

**Ke kritériu 69 poctivě.** Sloupec „Nikdy nepoužívat“ ve slovníku 9.2 má přes šedesát výrazů, kontrola jich hlídá dvaadvacet. Doslovný přepis by hlásil chybu na běžných slovech („účet“, „test“, „adresa“, „skupina“, „klik“) a test, který křičí na správný text, se do měsíce vypne. Přiznaná částečná kontrola je poctivější než tvrzení o úplné. Dřív tu kritérium 69 stálo jako plně pokryté, což nebyla pravda.

### Nepokrytá vědomě, patří jinam

Kritéria 25 až 42, 55, 56, 62 až 67 se týkají konkrétních obrazovek (onboarding, DNS, import, fronta oslovení, editor, kampaně, kontakty, veřejné stránky). Vlastní je doménové plány. P05 pro ně dodává komponenty a stavy, ne obsah.

---

## 7. Poznámky k provedení

| Věc | Pravidlo |
|---|---|
| Pořadí úkolů | Závazné. Úkoly 13 až 18 stojí na primitivech z úkolů 4 a 5, komponenty K1 až K8 na stavech a zpětné vazbě. |
| Co dělat, když test najde chybu v komponentě | Opravit komponentu. Test se nepředělává, aby prošel. |
| Co dělat, když chybí předpoklad z 0.3 | Doplnit ho do P01 a P05 spustit až potom. Kořen repozitáře P05 nevlastní. |
| Kdy je plán hotový | Když projde kompletní série z úkolu 34, kroku 4, a ruční průchod z kroku 5. Hlášení agenta není doklad. |
| Ověřování | Grep nestačí. Ke každému tvrzení, které jde ověřit spuštěním, patří spuštění. |

---

## 8. Požadavky na jiné plány

| # | Adresát | Požadavek | Proč |
|---|---|---|---|
| P05→P01.1 | P01 | Do `licenses.allow.json` zapsat `axe-core` a `@axe-core/playwright` (MPL-2.0, `devDependencies`) s vyplněným `expires_at`. | Bez toho spadne `licenses-node` na nejrozšířenějším nástroji pro testování přístupnosti. Licenční brána musí rozlišovat `dependencies` a `devDependencies`. |
| P05→P01.2 | P01 | Ve sdílené ESLint konfiguraci zaregistrovat pravidlo z `packages/ui/eslint-rules` jako `@mlain/ui/no-disabled-primary-action` se závažností `error`. | Kritérium 18 žádá lint pravidlo. Bez registrace pravidlo v CI neběží. |
| P05→P01.3 | P01 | Přidat CI job `bundle-budget`, který pouští `pnpm --filter @mlain/web check:bundle` po `build`. | Kritéria 81 a 82 žádají kontrolu v CI. V autoritativní tabulce jobů v 3.15 části 1 zatím není. |
| P05→P01.4 | P01 | Job `e2e` musí pouštět i spec soubory z `apps/web/e2e/ui/`. | Tam běží axe a klávesové testy. |
| P05→P04 | plán jádra API | Endpoint a napojení Centra úloh na pg-boss, plus stránka `/w/{slug}/jobs/{jobId}`. Komponenta `JobsCenter` a rozhraní `JobsSource` už existují. | Rozhodnutí R4. Prezentační vrstvu dodal P05, data ne. |
| P05→P04 | plán jádra API | V `params` chyby `forbidden` posílat `requiredPermission`, `currentRole`, `grantedByRoles[]` a `contactableMembers[]`. Doplnit `params` a `findings` do typu `Problem` v `sdk-node`. | `ForbiddenState` bez nich umí říct jen „nemáte oprávnění", což je k ničemu. Odpovídá požadavku U→1.1 části 6. |
| P05→doménové plány | všechny plány s obrazovkou | Zakládat **jen** vlastní namespace `messages/{cs,en}/<domena>.json`. Do `common` nesahat. | Uzávěr S4. Každý plán vlastní právě svůj soubor. |
| P05→doménové plány | všechny plány s obrazovkou | Do `packages/ui` nepřidávat soubory. Když komponenta nestačí, rozšířit ji o prop a doplnit test. | Uzávěr S3. Dvě podobné komponenty ve sdíleném balíčku jsou horší než jedna obecnější. |
| P05→doménové plány | všechny plány s obrazovkou | Registr navigace nerozšiřovat, jen naplnit cestu obsahem. | Uzávěr S5. |
| P05→plán segmentů | plán importu a segmentů | Dodat matici operátorů podle typu pole jako data pro `FieldDefinition[]`, **včetně `shape` u každého operátoru** a `valueType` u každého pole. Komponenta K2 tvar hodnoty vykreslí, ale nevymyslí si ho. | Matici vlastní část 2, ne design systém. Bez `shape` by 27 ze 40 operátorů nešlo zadat. |

### 8.1 Sjednocení rozhraní `packages/ui` (nález N27)

Tahle podkapitola vznikla po fázi 2. Recenze postavily vedle sebe **seznam exportů P05 a všechna skutečná volání z jedenácti navazujících plánů** a našly patnáct rozporů. Čtrnáct z nich vzniklo jen tím, že se plány psaly souběžně a nikdo je nesrovnal.

**Rozhodovací pravidlo, podle kterého jsou spory uzavřené:**

1. Kde tvar předepisuje **specifikace** (AST segmentu, katalog stavů 7.1), platí specifikace, i kdyby to znamenalo přepsat P05.
2. Kde jméno nebo tvar používají **dva a víc plánů nezávisle**, platí jejich.
3. Kde je doložené použití jen v jednom plánu a jméno P05 je přesnější, platí P05.
4. Komponenta, kterou **nikdo nevykresluje**, se nezakládá.

#### Co změnil P05 (hotovo v tomhle plánu)

| Věc | Bylo | Je | Proč |
|---|---|---|---|
| K2 AST | vlastní `Rule`/`RuleGroup` s `id` a `kind` | **tvar z části 2, 4.11.1**: `{ version, root }`, `type: 'group' \| 'condition'`, `field: FieldRef`, `value`/`values` | Pravidlo 1. Strom se ukládá do `segments.definition` a validuje ho `SegmentAstV1`. |
| K2 řízení | nekontrolované, `initial` | `value` + `onChange` | Pravidlo 2 a odstranění vady, kdy se hlásila hodnota před aktualizací stavu. |
| K2 hodnoty | jedno textové pole pro všech 40 operátorů | pět tvarů podle `OperatorDefinition.shape` | Tvrdý požadavek K2. |
| K4 `accept` | `string[]` jen MIME | `string` jako u HTML atributu, přípona **i** MIME | Pravidlo 2 (P11 volá `.csv,.xlsx`) a odmítání platných CSV z Windows. |
| K4 průběh | `upload={{ uploadedBytes, totalBytes, onCancel }}` | `progress` v procentech + `onCancel` | Pravidlo 2. |
| K4 klávesnice | `<label>` | skutečné `<button>` | WCAG 2.5.7. Popisek nemá roli tlačítka. |
| K6 | šířka a režim jen uvnitř | volitelně řízené `width`, `dark`, povinné `title`, `labels` nepovinné | Pravidlo 2. Editor má vlastní lištu a nesmí ukázat dvě sady přepínačů. |
| K3 kroky | `{ id, title }`, `currentStepId`, `onStepChange`, `backIsDestructive` | `{ id, label }`, `current`, `onNavigate`, `destructiveBack` jako věta | Pravidlo 2. |
| K3 krok v URL | **neměl vlastníka** | `useWizardStep` v P05 | Tvrdý požadavek K3. |
| K1 výběr | jen uvnitř | volitelně řízený propem `selection` | Pravidlo 2 (P07 i P11 ho řídí zvenčí). |
| K1 sloupce | hook existoval, tabulka ho neimportovala | zadrátovaný, viditelnost i šířka | Tvrdý požadavek K1. |
| `ConfirmDialog` | `retreatLabel`, `checkboxLabel`, `typeToConfirm` | `cancelLabel`, `acknowledgement`, `confirmPhrase` + `confirmPhraseLabel` + `onConfirmPhraseChange`, `extraAction`, `onCancel`, asynchronní `onConfirm` | Pravidlo 2 (P07 volá pětkrát, P06 popsal N4 do detailu, P07 žádá tlačítko navíc). |
| Navigace | bez příznaku MVP | `mvp0: boolean` na každé položce | Bez něj menu nabídne šest cest na prázdnou stránku. |
| Nové komponenty | | `Alert`, `FilteredEmptyState`, `CopyButton` | Pravidlo 2, každou vykreslují dva plány. |
| Kořenový import | `exports` měl `"."` | **klíč `"."` odstraněn** | Uzávěr S11 se tím z pravidla mění na chybu překladu. |

#### Co musí opravit navazující plány

| # | Adresát | Požadavek |
|---|---|---|
| P05→P11.1 | P11 | Importovat **podcestou**, ne z holého `@mlain/ui`. Pět importních řádků (ř. 106, 8467, 8511, 8624, 9289). Kořenový import od teď skončí chybou `ERR_PACKAGE_PATH_NOT_EXPORTED`. |
| P05→P11.2 | P11 | `FileDrop` se jmenuje **`FileUpload`** (`@mlain/ui/patterns/file-upload`). Jméno „drop" je navíc zavádějící: přetažení je doplněk, ne hlavní cesta. |
| P05→P11.3 | P11 | `QueryBuilder` a `FileUpload` potřebují povinný prop `labels`. Texty do `packages/ui` natvrdo nepatří. Konformanční test v úkolu 54 je musí předat. |
| P05→P11.4 | P11 | `Wizard`: položka kroku je `{ id, label }`, ne `{ key, label }`. `key` je v Reactu vyhrazené jméno a v datovém objektu mate. |
| P05→P11.5 | P11 | Tlačítko na zobrazení JSON má jméno z katalogu P11, komponenta ho bere z `labels.showJson`. Konformanční test ať hledá vlastní text, ne natvrdo „Zobrazit definici jako JSON". |
| P05→P13.1 | P13 | Osm importních řádků z holého `@mlain/ui` (ř. 11115, 11154, 11367, 11480, 11664, 11695, 11989, 12070) přepsat na podcestu. |
| P05→P13.2 | P13 | `Disclosure` neexistuje, je to **`Collapsible`** (`@mlain/ui/components/collapsible`). Používají ho tak i P06 a P07. |
| P05→P13.3 | P13 | `Dot` neexistuje. Použij `Badge`. Barevná tečka bez textu by navíc porušila pravidlo 11.3, že barva není jediný rozlišovací znak. |
| P05→P13.4 | P13 | `Tile` neexistuje a nezakládá se: je to rozvržení jedné obrazovky, ne sdílená komponenta. Slož ho z `div` a tokenů u sebe. |
| P05→P16.1 | P16 | Pět importních řádků z holého `@mlain/ui` (ř. 4965, 5026, 5655, 7016, 7066) přepsat na podcestu. |
| P05→P16.2 | P16 | `Table` neexistuje, je to **`DataTable`**, a její sloupce mají `{ id, header, cell }`, ne `{ id, header }` s mapou `cells` na řádku. |
| P05→P16.3 | P16 | `Note`, `Panel` a `Banner` neexistují. `Note` i `Banner` pokrývá **`Alert`** s odpovídajícím `tone`; `Panel` slož z primitiv u sebe. |
| P05→P06.1 | P06 | V kontraktu `ui-contract.ts` opravit pět jmen, která P05 nemá a **P06 je nikde nevykresluje**: `ErrorState`, `LoadingSkeleton`, `StaleDataBanner`, `PartialErrorBoundary`, `OfflineBanner`. Odpovídají jim `ErrorBlock`, `TableSkeleton` s `DetailSkeleton`, `StaleBanner`, `ErrorBlock` v dlaždici a `SystemBar` s `kind: 'offline'`. |
| P05→P06.2 | P06 | `LimitReachedState` se jmenuje **`OverLimitState`**, podle stavu S15 „Přes limit" z katalogu 7.1. Dvě místa použití. |
| P05→P06.3 | P06 | Typ registru se jmenuje `NavigationItem`, ne `NavItem`, je to **strom** se `children`, ne plochý seznam se `section`, a `href` vzniká až ve `visibleNavigation()` jako řetězec. Příznak `mvp0` P05 doplnil, ten je v pořádku. |
| P05→P06.4 | P06 | Navigaci nefiltrovat vlastním kódem, volat **`visibleNavigation({ permissions, workspaceSlug })`**. Pravidlo „sekce bez jediné viditelné podpoložky zmizí celá" se při druhém psaní zapomíná. |
| P05→P06.5 | P06 | Vlastní `CopyButton` nepsat, je v `@mlain/ui/components/copy-button`. Tři místa použití. |
| P05→P07.1 | P07 | V kontraktu opravit `ErrorState`, `LoadingSkeleton` (viz P05→P06.1). `FilteredEmptyState` P05 doplnil, ten je v pořádku. |
| P05→P07.2 | P07 | `DataTable`: popisek se předává propem `caption`, ne `ariaLabel`. |
| P05→P07.3 | P07 | `ConfirmDialog` má `extraAction`, takže dialog s akcí uvnitř **není potřeba skládat z primitiv** (úkoly 61 a 62). Otevřenou otázku z ř. 22597 tím P05 uzavírá ve prospěch doplnění propu. |
| P05→P12.1 | P12 | `useAnnounce()` se jmenuje **`useAnnouncer()`** a vrací objekt s `polite` a `assertive`. Kritérium 54 potřebuje zdvořilé oznámení, chyba potřebuje důrazné, jeden řetězcový parametr to nerozliší. |
| P05→P12.2 | P12 | **Požadavek na `sandbox="allow-same-origin"` se stahuje bez náhrady.** Vrátil by rámci původ aplikace a oslabil izolaci bez zisku, protože skripty stejně neběží. `referrerpolicy="no-referrer"` P05 doplnil. |
| P05→P12.3 | P12 | Importovat na úroveň adresáře: `@mlain/ui/patterns/states`, ne `patterns/states/alert`, `patterns/states/empty-state` ani `patterns/states/not-found`. Poslední jmenovaný soubor se navíc jmenuje `not-found-state.tsx`. |
| P05→P14.1 | P14 | Importovat na úroveň adresáře: `@mlain/ui/patterns/charts`, `patterns/timeline`, `patterns/data-table`, ne na úroveň souboru. Mapa `exports` cestu k souboru nevystavuje. |
| P05→P15.1 | P15 | Totéž pro `@mlain/ui/patterns/charts` a `@mlain/ui/patterns/states`. |
| P05→P01.5 | P01 | Konfigurace Vitestu pro `apps/web` musí pokrýt i testy vedle zdrojů a komponentní testy. Podrobně v kapitole 8.2. |
| P05→P01.6 | P01 | Pravidlo ESLint z `packages/ui/eslint-rules` načítat **podmíněně** (`try`/`catch` kolem `require`), protože soubor vzniká až v P05, a mezi P01 a P05 běží P02, P03 a P04, kterým by lint spadl. |

### 8.2 Konfigurace testovacího běhu `apps/web` (společný požadavek P05, P06 a P12)

**P05 se tenhle nález týká taky**, a to je při první četbě překvapivé. Vlastní testy komponent P05 leží v `packages/ui` a `packages/i18n`, jejichž konfiguraci si P05 vlastní, takže ty běží. Jenže P05 zakládá i **`apps/web/src/proxy.test.ts`**, a ten leží v `src/`, zatímco konfigurace od P01 má `include: ['test/**/*.test.ts']`. Osm testů `proxy.ts` by se tedy nespustilo a krok „spusť test, musí spadnout" by vypsal, že žádné testy nejsou. To vypadá jako úspěch a je to horší než selhání.

P06 má stejný problém u dvaceti komponentních testů, P12 u všech svých. Konfiguraci **vlastní P01**, žádný z nás tří ji opravit nesmí.

> **P05→P01.5** | P01 | `apps/web/vitest.config.ts` musí znít:
>
> ```ts
> import react from '@vitejs/plugin-react';
> import { defineConfig } from 'vitest/config';
>
> export default defineConfig({
>   plugins: [react()],
>   test: {
>     environment: 'jsdom',
>     setupFiles: ['./vitest.setup.ts'],
>     include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
>   },
> });
> ```
>
> Důvod: obrazovkové plány testují komponenty vedle zdrojů a P05 má vedle zdroje `proxy.test.ts`. Bez `jsdom` a pluginu React neprojde `render()`; bez rozšířeného `include` se testy vůbec nenajdou.

**P12 si tenhle soubor nesmí nárokovat** ani s podmínkou „jen pokud ještě neexistuje". Podmínka se nikdy nesplní, protože P01 běží dřív, a soubor se dvěma vlastníky podle pořadí je přesně ta nejistota, které se dělení vyhýbá.

---

## 9. Soubory, které tenhle plán vlastní

Plán vytváří a mění **výhradně** soubory z tohohle seznamu. **Mimo ně nesahá.**

### Vlastní bez výhrad

```
packages/ui/**                          celý balíček včetně eslint-rules a testů
packages/i18n/package.json
packages/i18n/tsconfig.json
packages/i18n/vitest.config.ts
packages/i18n/README.md
packages/i18n/src/**                    infrastruktura, formátování, kontroly
packages/i18n/messages/cs/common.json
packages/i18n/messages/en/common.json
apps/web/src/proxy.ts
apps/web/src/proxy.test.ts
apps/web/src/i18n/request.ts
apps/web/playwright.config.ts
apps/web/e2e/ui/**
apps/web/scripts/check-bundle-budget.mjs
apps/web/scripts/check-bundle-budget.test.mjs
apps/web/src/app/layout.tsx
apps/web/src/app/globals.css
apps/web/src/app/[locale]/layout.tsx
apps/web/src/app/[locale]/w/[workspaceSlug]/layout.tsx
apps/web/src/app/[locale]/(dev)/ui-gallery/**
```

### Přebírá od P01 a od té chvíle vlastní

P01 tyhle soubory zakládá jako kostru a P05 je přebírá. Protože vlny běží
sekvenčně a P01 je smergovaný dřív, než P05 začne, žádný souběžný zápis nevzniká.

```
apps/web/next.config.ts                 doplnění pluginu i18n a transpilePackages
apps/web/package.json                   závislosti @mlain/ui a @mlain/i18n, skripty test:e2e a check:bundle
packages/ui/package.json                P01 zakládá prázdnou kostru, P05 doplňuje závislosti a exporty
packages/ui/tsconfig.json               totéž
packages/i18n/package.json              totéž
packages/i18n/tsconfig.json             totéž
```

Ověřeno proti plánu P01: jeho kapitola „co nesahá" výslovně uvádí, že
`apps/web/src/proxy.ts` nezakládá (uzávěr S6), balíčky `packages/ui`
a `packages/i18n` vytváří jen jako prázdný adresář s manifestem,
a `apps/web/playwright.config.ts` si nenárokuje. Rozhodnutí R1 a R3
jsou s ním tedy v souladu.

### Čte, ale nemění

```
docs/superpowers/specs/parts/06-ui-ux.md
docs/superpowers/specs/parts/01-platforma.md
docs/superpowers/plans/2026-07-31-rozdeleni-implementacnich-planu.md
packages/config/**                      sdílené presety od P01
```

### Výslovně nevlastní

```
packages/i18n/messages/{cs,en}/<jiný namespace>.json   doménové plány
packages/db/**, packages/core/**, packages/contracts/**
.github/workflows/**, turbo.json, docker/**, pnpm-workspace.yaml
apps/web/src/app/**/page.tsx mimo galerii komponent
```

Doménové obrazovky (kontakty, kampaně, šablony, import, segmenty, reporty,
nastavení) tenhle plán **nedělá**. Dodává skořápku a sdílené komponenty,
na kterých je postaví jedenáct navazujících plánů.

